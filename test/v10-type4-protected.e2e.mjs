// Explicit local-only protocol/custody experiment. Default review never opens files or a socket.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import {
  loadV10UpgradeableArtifacts,
  verifyV10ArtifactSources,
} from "../src/v10-upgrade-artifacts.mjs";
import { verifyV10Deployment } from "../src/v10-upgrade-verification.mjs";
import {
  createV10WalletCompatibility,
  METAMASK_V130,
  METAMASK_DELEGATION_DOMAIN,
  METAMASK_DELEGATION_TYPES,
  METAMASK_ROOT_AUTHORITY,
} from "../src/v10-wallet-compatibility.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BINARY =
  "/private/tmp/kleros-v10-anvil-MpZaXr/node_modules/@foundry-rs/anvil-darwin-arm64/bin/anvil";
const OBSERVED = "artifacts/v10-integration/metamask-runtime-observed.json";
const DELEGATIONS =
  "tuple(address delegate,address delegator,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]";
const MANAGER = new ethers.Interface([
  "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)",
]);
const SECP_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
function assertCodecView(raw, view) {
  assert.deepEqual(Object.keys(raw).sort(), [
    "address",
    "chainId",
    "nonce",
    "r",
    "s",
    "yParity",
  ]);
  assert.deepEqual(Object.keys(view).sort(), Object.keys(raw).sort());
  for (const key of ["address", "chainId", "nonce", "yParity"])
    assert.equal(view[key], raw[key]);
  for (const key of ["r", "s"]) {
    assert.ok(
      typeof raw[key] === "string" &&
        /^0x(?:0|[1-9a-f][a-f0-9]*)$/i.test(raw[key]) &&
        raw[key].length <= 66,
      "authorization scalar must be a canonical at-most32B RPC quantity",
    );
    const value = BigInt(raw[key]);
    assert.ok(
      value > 0n && (key === "r" ? value < SECP_N : value <= SECP_N / 2n),
      "authorization scalar range/lowS required",
    );
    assert.ok(ethers.isHexString(view[key], 32));
    assert.equal(
      BigInt(view[key]),
      value,
      "codec projection must preserve scalar value",
    );
  }
}
function codecAuthorization(raw) {
  const view = {
    ...raw,
    r: ethers.toBeHex(BigInt(raw.r), 32),
    s: ethers.toBeHex(BigInt(raw.s), 32),
  };
  assertCodecView(raw, view);
  return view;
}
function signedType4Hash(raw, authorizations) {
  const parity = Number(BigInt(raw.yParity ?? raw.v)),
    signature = {
      r: raw.r,
      s: raw.s,
      yParity: parity >= 27 ? parity - 27 : parity,
    };
  const transaction = ethers.Transaction.from({
    type: 4,
    chainId: BigInt(raw.chainId),
    nonce: Number(BigInt(raw.nonce)),
    to: raw.to,
    value: BigInt(raw.value),
    data: raw.input,
    gasLimit: BigInt(raw.gas),
    maxFeePerGas: BigInt(raw.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(raw.maxPriorityFeePerGas),
    accessList: raw.accessList,
    authorizationList: authorizations.map((a) => ({
      address: a.address,
      chainId: BigInt(a.chainId),
      nonce: BigInt(a.nonce),
      signature: { r: a.r, s: a.s, yParity: Number(BigInt(a.yParity)) },
    })),
    signature,
  });
  // Serialized signatures exist only within this Node call; neither bytes nor signature fields leave it.
  return ethers.keccak256(transaction.serialized);
}
const args = process.argv.slice(2);
if (!args.length || (args.length === 1 && args[0] === "--review-only")) {
  console.log(
    JSON.stringify({
      kind: "v10-type4-protected-loopback-review",
      execution: false,
      network: "none",
      flags: ["--run-loopback"],
      scope:
        "Fresh no-fork local Anvil Prague chain1; real type4 authorization; fixture contract runtimes; synthetic keys only in Node memory.",
    }),
  );
} else if (args.length === 1 && args[0] === "--run-loopback") await run();
else
  throw new Error(
    "Use --review-only or --run-loopback only; no RPC URL is accepted.",
  );

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function read(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
}
async function run() {
  const stamp = new Date().toISOString().replaceAll(":", "-"),
    runId = `${stamp}-${randomUUID()}`,
    out = path.join(ROOT, "artifacts/v10-integration/type4-protected", runId),
    proof = {
      kind: "v10-type4-protected-local-protocol-custody",
      schemaVersion: 1,
      runId,
      startedAt: new Date().toISOString(),
      passed: false,
      chainId: 1,
      environment: "fresh-loopback-anvil-prague-no-fork",
      publicNetworkRequests: 0,
      keysPersisted: false,
      walletCodeFixtureShortcut: false,
      frameworkSourceVerified: false,
      source: {},
      fixtures: [],
      checks: [],
      transactions: [],
      limits: [
        "Framework contract code is installed from observed public runtime; this does not itself prove its source.",
        "No mainnet transaction, current user wallet, live state adoption, app authorization or financial activation is performed.",
        "Only pending native deposits/recovery are exercised; the separate contract suite covers adjudication and held-share economics.",
      ],
    };
  let child,
    provider,
    stage = "reviewed-local-inputs",
    broadcastCount = 0;
  const check = (condition, label) => {
    assert.ok(condition, label);
    proof.checks.push(label);
  };
  try {
    const observed = read(OBSERVED),
      fixed = {
        manager: METAMASK_V130.manager,
        delegate: METAMASK_V130.delegate,
        nativeBalanceEnforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
      };
    assert.equal(observed.chainId, 1);
    assert.equal(observed.contracts.length, 3);
    const runtimes = {};
    for (const [name, target] of Object.entries(fixed)) {
      const rows = observed.contracts.filter((x) => x.name === name);
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(ethers.getAddress(row.address), target);
      assert.ok(ethers.isHexString(row.code) && row.code.length > 4);
      assert.equal(ethers.keccak256(row.code), row.codeHash);
      runtimes[name] = row.code;
      proof.fixtures.push({
        name,
        address: target,
        codeHash: row.codeHash,
        bytes: ethers.getBytes(row.code).length,
      });
    }
    const sourceProofPath =
        "artifacts/v10-integration/metamask-source-verification-6ea176ca-3ea1-49eb-a290-1013d6492a15.json",
      sourceProofBytes = fs.readFileSync(path.join(ROOT, sourceProofPath)),
      sourceProof = JSON.parse(sourceProofBytes);
    assert.equal(
      hash(sourceProofBytes),
      "7108974bc07ca8b46964d855887d9c26c1891386d21c5cf1bdb3f628fb7cb17c",
    );
    assert.equal(
      hash(
        fs.readFileSync(
          path.join(ROOT, "scripts/verify-metamask-v1.3-runtime.mjs"),
        ),
      ),
      "ed5a6bdaff07ac3cbae55e8f58899df738dace1ce42b48fb018c709649cea50c",
    );
    assert.equal(sourceProof.sourceVerified, true);
    assert.equal(sourceProof.chainId, 1);
    assert.equal(sourceProof.status, "verified");
    for (const row of proof.fixtures) {
      const matched = sourceProof.contracts.filter((x) => x.name === row.name);
      assert.equal(matched.length, 1);
      assert.equal(matched[0].runtimeCodeHash, row.codeHash);
      assert.equal(matched[0].compiledTemplateMatches, true);
      assert.equal(matched[0].fullObservedRuntimeMatches, true);
      assert.equal(ethers.getAddress(matched[0].address), row.address);
    }
    proof.frameworkSourceVerified = true;
    proof.frameworkSourceProofSha256 = hash(sourceProofBytes);
    const scalarFixture = {
      address: METAMASK_V130.delegate,
      chainId: "0x1",
      nonce: "0x5",
      yParity: "0x0",
      r: "0x1",
      s: "0x1",
    };
    codecAuthorization(scalarFixture);
    for (const malformed of [
      { ...scalarFixture, r: "0x" + "1".repeat(66) },
      { ...scalarFixture, r: "0x0" },
      { ...scalarFixture, s: ethers.toQuantity(SECP_N / 2n + 1n) },
      { ...scalarFixture, r: "0x01" },
    ])
      assert.throws(() => codecAuthorization(malformed));
    assert.throws(() =>
      assertCodecView(scalarFixture, {
        ...codecAuthorization(scalarFixture),
        r: ethers.toBeHex(2, 32),
      }),
    );
    proof.checks.push(
      "pure codec rejects bad width, zero, highS, noncanonical quantity and numerical value changes",
    );
    const provenance = {
      v10BuildManifestSha256: hash(read("build/contracts-v10/manifest.json")),
      v10StandardInputSha256: hash(
        read("build/contracts-v10/standard-input.json"),
      ),
    };
    verifyV10ArtifactSources(provenance);
    proof.source = {
      harnessSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
      observedRuntimeFileSha256: hash(
        fs.readFileSync(path.join(ROOT, OBSERVED)),
      ),
      compatibilitySha256: hash(
        fs.readFileSync(path.join(ROOT, "src/v10-wallet-compatibility.mjs")),
      ),
      ...provenance,
    };
    const version = execFileSync(BINARY, ["--version"], { encoding: "utf8" });
    assert.match(version, /^anvil Version: 1\.7\.1\b/);
    proof.anvil = {
      version: "1.7.1",
      binarySha256: hash(fs.readFileSync(BINARY)),
      hardfork: "prague",
      noFork: true,
    };
    const port = await freePort(),
      url = `http://127.0.0.1:${port}/`;
    child = spawn(
      BINARY,
      [
        "--silent",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--chain-id",
        "1",
        "--hardfork",
        "prague",
        "--accounts",
        "0",
        "--gas-limit",
        "60000000",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    provider = new ethers.JsonRpcProvider(
      url,
      { chainId: 1, name: "local-v10-eip7702" },
      { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 },
    );
    provider.pollingInterval = 10;
    stage = "fresh-loopback-node";
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null)
        throw new Error("Local Anvil exited before readiness");
      try {
        await provider.send("anvil_nodeInfo", []);
        ready = true;
        break;
      } catch {
        await sleep(50);
      }
    }
    assert.ok(ready, "local Anvil ready");
    async function assertLocal() {
      const endpoint = new URL(provider._getConnection().url);
      assert.equal(endpoint.href, url);
      assert.equal(endpoint.hostname, "127.0.0.1");
      assert.equal(endpoint.protocol, "http:");
      assert.ok(
        !endpoint.username &&
          !endpoint.password &&
          !endpoint.search &&
          child.exitCode === null,
      );
      const [info, client, chain] = await Promise.all([
        provider.send("anvil_nodeInfo", []),
        provider.send("web3_clientVersion", []),
        provider.send("eth_chainId", []),
      ]);
      assert.match(client, /anvil\/v1\.7\.1/i);
      assert.equal(BigInt(chain), 1n);
      assert.equal(BigInt(info.environment.chainId), 1n);
      assert.equal(String(info.hardFork).toLowerCase(), "prague");
      assert.ok(
        info.forkConfig &&
          info.forkConfig.forkUrl === null &&
          info.forkConfig.forkBlockNumber === null,
        "no fork configured",
      );
      return info;
    }
    await assertLocal();
    check(true, "fresh official local Anvil1.7.1 chain1 Prague with no fork");
    // Only the three contract fixture addresses are setCode. Authority code is installed by a real type4 transaction below.
    for (const [name, target] of Object.entries(fixed)) {
      await assertLocal();
      await provider.send("anvil_setCode", [target, runtimes[name]]);
      assert.equal(
        ethers.keccak256(await provider.getCode(target)),
        ethers.keccak256(runtimes[name]),
      );
    }
    const authority = ethers.Wallet.createRandom().connect(provider),
      outsider = ethers.Wallet.createRandom().connect(provider),
      safe = ethers.Wallet.createRandom().address;
    for (const wallet of [authority, outsider]) {
      await assertLocal();
      await provider.send("anvil_setBalance", [
        wallet.address,
        ethers.toQuantity(ethers.parseEther("100")),
      ]);
    }
    check(
      (await provider.getCode(authority.address)) === "0x",
      "synthetic authority begins as empty-code EOA",
    );
    const fee = {
      maxFeePerGas: 3_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    };
    async function send(wallet, transaction, label, expectSuccess = true) {
      await assertLocal();
      const nonce = await provider.getTransactionCount(
        wallet.address,
        "pending",
      );
      const response = await wallet.sendTransaction({
        ...fee,
        gasLimit: 12_000_000n,
        type: 2,
        ...transaction,
        chainId: 1,
        nonce,
      });
      broadcastCount++;
      let mined;
      try {
        mined = await response.wait();
      } catch (error) {
        mined = error.receipt;
        if (!mined)
          throw Object.assign(new Error("Local transaction has no receipt"), {
            code: "LOCAL_RECEIPT_MISSING",
          });
      }
      assert.equal(mined.status, expectSuccess ? 1 : 0, label);
      const canonical = await provider.getBlock(mined.blockNumber);
      assert.equal(canonical.hash, mined.blockHash);
      proof.transactions.push({
        label,
        hash: response.hash,
        type: response.type,
        blockNumber: mined.blockNumber,
        blockHash: mined.blockHash,
        status: mined.status,
        gasUsed: String(mined.gasUsed),
        effectiveGasPriceWei: String(mined.gasPrice),
        from: wallet.address,
        to: response.to,
        valueWei: String(response.value),
      });
      proof.checks.push(label);
      return mined;
    }
    const designation = ethers.concat(["0xef0100", METAMASK_V130.delegate]);
    check(
      (await provider.getTransactionCount(authority.address, "pending")) === 0,
      "fresh authority nonce starts at zero",
    );
    async function sendAuthorized(transaction, label) {
      await assertLocal();
      const nonce = await provider.getTransactionCount(
          authority.address,
          "pending",
        ),
        authorization = await authority.authorize({
          address: METAMASK_V130.delegate,
          chainId: 1,
          nonce: nonce + 1,
        });
      return send(
        authority,
        { ...transaction, type: 4, authorizationList: [authorization] },
        label,
      );
    }
    const artifacts = loadV10UpgradeableArtifacts(),
      births = [];
    async function create(a, constructorArgs, label, deployer = authority) {
      const unsigned = await new ethers.ContractFactory(
          a.abi,
          a.bytecode,
        ).getDeployTransaction(...constructorArgs),
        r = await send(
          deployer,
          { to: null, data: unsigned.data, value: 0n },
          label,
        );
      assert.ok(r.contractAddress);
      births.push(r);
      return new ethers.Contract(r.contractAddress, a.abi, provider);
    }
    stage = "four-direct-v10-creates";
    const controller = await create(
        artifacts.controller,
        [authority.address],
        "initial EOA direct CREATE controller",
      ),
      implementation = await create(
        artifacts.event,
        [],
        "initial EOA direct CREATE event implementation",
      ),
      factoryImplementation = await create(
        artifacts.factory,
        [],
        "initial EOA direct CREATE factory implementation",
      ),
      proxy = await create(
        artifacts.proxy,
        [
          factoryImplementation.target,
          factoryImplementation.interface.encodeFunctionData("initialize", [
            implementation.target,
            controller.target,
          ]),
        ],
        "initial EOA direct CREATE factory proxy",
      );
    check(
      (await controller.owner()) === authority.address &&
        (await controller.UPGRADE_DELAY_SECONDS()) === 0n,
      "actual initial EOA deployer controls immediate V10 controller",
    );
    const factory = new ethers.Contract(
      proxy.target,
      artifacts.factory.abi,
      provider,
    );
    check(
      (await factory.upgradeAuthority()) === controller.target &&
        (await factory.eventCount()) === 0n,
      "four setup CREATEs alone do not create an event",
    );
    // Mock only Court adjudication dependencies; framework and V10 runtime are actual code.
    const mock = (name) => read(`references/kickback/build/${name}.json`),
      liquid = await create(
        mock("MockKlerosLiquid"),
        [],
        "local Court fixture liquid",
        outsider,
      ),
      resolver = await create(
        mock("MockArbitrableProxy"),
        [liquid.target],
        "local Court fixture resolver",
        outsider,
      );
    const pins = {
      schemaVersion: 1,
      framework: METAMASK_V130.framework,
      version: METAMASK_V130.version,
      chainId: 1,
      manager: METAMASK_V130.manager,
      delegate: METAMASK_V130.delegate,
      nativeBalanceChangeEnforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
      managerRuntimeHash: ethers.keccak256(runtimes.manager),
      delegateRuntimeHash: ethers.keccak256(runtimes.delegate),
      nativeBalanceChangeRuntimeHash: ethers.keccak256(
        runtimes.nativeBalanceEnforcer,
      ),
      reviewId: proof.source.observedRuntimeFileSha256,
    };
    const compatibility = createV10WalletCompatibility({
        reviewedRuntimePins: pins,
      }),
      D = 1_000_000_000_000n;
    let salt = 1n;
    async function wrapped(target, data, value = 0n, options = {}) {
      const termsValue = options.maxDecrease ?? value,
        delegation = {
          delegate: authority.address,
          delegator: authority.address,
          authority: METAMASK_ROOT_AUTHORITY,
          caveats: [
            {
              enforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
              terms: ethers.solidityPacked(
                ["uint8", "address", "uint256"],
                [1, authority.address, termsValue],
              ),
              args: "0x",
            },
          ],
          salt: salt++,
          signature: "0x",
        };
      const typed = {
        ...delegation,
        caveats: delegation.caveats.map(({ enforcer, terms }) => ({
          enforcer,
          terms,
        })),
      };
      delete typed.signature;
      delegation.signature = await authority.signTypedData(
        METAMASK_DELEGATION_DOMAIN,
        METAMASK_DELEGATION_TYPES,
        typed,
      );
      if (options.badSignature)
        delegation.signature = await outsider.signTypedData(
          METAMASK_DELEGATION_DOMAIN,
          METAMASK_DELEGATION_TYPES,
          typed,
        );
      const permission = ethers.AbiCoder.defaultAbiCoder().encode(
          [DELEGATIONS],
          [[delegation]],
        ),
        execution = ethers.solidityPacked(
          ["address", "uint256", "bytes"],
          [target, value, data],
        );
      return {
        to: METAMASK_V130.manager,
        value: 0n,
        data: MANAGER.encodeFunctionData("redeemDelegations", [
          [permission],
          [ethers.ZeroHash],
          [execution],
        ]),
      };
    }
    function inspect(outer, target, data, value, action) {
      const scope = {
          contractVersion: "kleros-event-v10-uups",
          abiVersion: "kleros-event-v10-uups",
          chainId: 1,
          mode: "hosted-production",
          origin: "https://synthetic.invalid",
          instanceId: runId.replaceAll(".", "-"),
          wallet: authority.address,
          eventId: "local-eip7702",
          draftId: `draft-${action}`,
          action,
          contract: target,
        },
        account = compatibility.classifyAccount({
          scope,
          walletCode: designation,
          delegateRuntimeCode: runtimes.delegate,
          managerRuntimeCode: runtimes.manager,
          nativeBalanceChangeRuntimeCode: runtimes.nativeBalanceEnforcer,
        }),
        intent = compatibility.canonicalIntent({
          scope,
          transaction: {
            from: authority.address,
            to: target,
            data,
            value: String(value),
            chainId: 1,
          },
        });
      return compatibility.inspectTransactionIntent({
        account,
        intent,
        transaction: {
          from: authority.address,
          hash: ethers.id("unsent-local-intent"),
          chainId: 1,
          type: 2,
          nonce: 0,
          ...outer,
        },
      });
    }
    async function inspectCanonical(txHash, target, data, value, action) {
      const raw = await provider.send("eth_getTransactionByHash", [txHash]),
        beforeHash = hash(raw);
      assert.equal(raw.hash, txHash);
      assert.equal(raw.type, "0x4");
      assert.equal(raw.authorizationList.length, 1);
      const authorization = raw.authorizationList[0];
      assert.equal(BigInt(authorization.chainId), 1n);
      assert.equal(
        ethers.getAddress(authorization.address),
        METAMASK_V130.delegate,
      );
      assert.equal(BigInt(authorization.nonce), BigInt(raw.nonce) + 1n);
      const signer = ethers.verifyAuthorization(
        {
          address: authorization.address,
          chainId: BigInt(authorization.chainId),
          nonce: BigInt(authorization.nonce),
        },
        {
          r: authorization.r,
          s: authorization.s,
          yParity: Number(BigInt(authorization.yParity)),
        },
      );
      assert.equal(signer, authority.address);
      // This is a field projection of the unchanged canonical raw transaction.
      // input→data is JSON-RPC nomenclature; signatures/authorization fields are not relabeled or synthesized.
      const projected = {
        hash: raw.hash,
        from: raw.from,
        to: raw.to,
        data: raw.input,
        value: raw.value,
        chainId: raw.chainId,
        type: raw.type,
        nonce: raw.nonce,
        authorizationList: raw.authorizationList.map(codecAuthorization),
      };
      assert.equal(signedType4Hash(raw, raw.authorizationList), raw.hash);
      assert.equal(signedType4Hash(raw, projected.authorizationList), raw.hash);
      const projectedSigner = ethers.verifyAuthorization(
        {
          address: authorization.address,
          chainId: BigInt(authorization.chainId),
          nonce: BigInt(authorization.nonce),
        },
        {
          r: projected.authorizationList[0].r,
          s: projected.authorizationList[0].s,
          yParity: Number(BigInt(authorization.yParity)),
        },
      );
      assert.equal(projectedSigner, signer);
      proof.authorizationShapeChecks ??= [];
      proof.authorizationShapeChecks.push({
        hash: txHash,
        fields: Object.keys(authorization).sort(),
        rIsBytes32: ethers.isHexString(authorization.r, 32),
        sIsBytes32: ethers.isHexString(authorization.s, 32),
        canonicalChainQuantity: /^0x(?:0|[1-9a-f][a-f0-9]*)$/i.test(
          authorization.chainId,
        ),
        canonicalNonceQuantity: /^0x(?:0|[1-9a-f][a-f0-9]*)$/i.test(
          authorization.nonce,
        ),
        canonicalParityQuantity: /^0x(?:0|[1-9a-f][a-f0-9]*)$/i.test(
          authorization.yParity,
        ),
        canonicalTransactionNonce: /^0x(?:0|[1-9a-f][a-f0-9]*)$/i.test(
          raw.nonce,
        ),
      });
      const inspection = inspect(projected, target, data, value, action),
        expected = Object.freeze({
          chainId: 1,
          transactionHash: raw.hash,
          from: authority.address,
          to: target,
          valueWei: String(value),
          data,
        }),
        factual = compatibility.factualIntentProof({ inspection, expected });
      assert.equal(inspection.authorizationSignatureMatched, true);
      assert.equal(inspection.permission.signatureMatched, true);
      assert.equal(Object.keys(factual).length, 7);
      assert.equal(factual.verified, true);
      assert.equal(factual.dataHash, ethers.keccak256(data));
      assert.equal(hash(raw), beforeHash);
      proof.authorizationChecks ??= [];
      if (!proof.authorizationChecks.some((x) => x.hash === txHash))
        proof.authorizationChecks.push({
          hash: txHash,
          chainId: 1,
          delegate: METAMASK_V130.delegate,
          outerNonce: Number(BigInt(raw.nonce)),
          authorizationNonce: Number(BigInt(authorization.nonce)),
          signerMatchesAuthority: true,
          canonicalRawUnchanged: true,
          factualIntentFields: 7,
          codecProjection:
            "RPC quantity r/s to fixed32B view; integer and recovered signer unchanged",
          signedTransactionHashBeforeAndAfterMatchesCanonical: true,
        });
      return { inspection, projected };
    }
    const now = (await provider.getBlock("latest")).timestamp,
      config = {
        depositAmount: D,
        eventName: "Synthetic Prague delegated custody",
        eventStart: now + 3600,
        claimDeadline: now + 8 * 86400,
        arbitration: {
          disputeResolver: resolver.target,
          extraData: ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "uint256"],
            [0, 3],
          ),
          metaEvidenceTemplate: [
            '{"wallet":"',
            '","contract":"',
            '","organizer":"',
            '"}',
          ],
          metaEvidenceSlots: "0x010204",
          policyURI: "https://example.invalid/v10-local-only",
        },
      },
      eventKey = ethers.id(`local-delegated-${runId}`),
      createData = factory.interface.encodeFunctionData("createEvent", [
        eventKey,
        config,
      ]),
      creation = await wrapped(factory.target, createData);
    stage = "same-transaction-type4-protected-self-create";
    check(
      (await provider.getCode(authority.address)) === "0x" &&
        (await provider.getTransactionCount(authority.address, "pending")) ===
          4,
      "authority remains EOA at nonce4 after exact four setup CREATEs",
    );
    check(
      inspect(creation, factory.target, createData, 0n, "createEvent")
        .permission.signatureMatched,
      "protected self creation signature and exact zero-value guard match",
    );
    const created = await sendAuthorized(
        creation,
        "actual type4 manager protected-self creates V10 child",
      ),
      log = created.logs
        .filter((l) => l.address === factory.target)
        .map((l) => factory.interface.parseLog(l))
        .find((l) => l?.name === "EventCreated"),
      event = new ethers.Contract(
        log.args.eventContract,
        artifacts.event.abi,
        provider,
      );
    check(
      log.args.creator === authority.address &&
        (await event.owner()) === authority.address,
      "factory creator and child owner are authority wallet, not manager/delegate",
    );
    check(
      (await factory.eventFor(authority.address, eventKey)) === event.target &&
        (await event.originatingFactory()) === factory.target,
      "canonical child membership binds original authority",
    );
    check(
      (await provider.getCode(authority.address)).toLowerCase() ===
        designation.toLowerCase(),
      "first protected execution actually installed protocol designation",
    );
    const canonicalCreation = await inspectCanonical(
      created.hash,
      factory.target,
      createData,
      0n,
      "createEvent",
    );
    check(
      canonicalCreation.inspection.authorizationSignatureMatched,
      "same type4 transaction proves selfauthorization signature and protected creation intent",
    );
    assert.equal(proof.authorizationChecks[0].outerNonce, 4);
    assert.equal(proof.authorizationChecks[0].authorizationNonce, 5);
    const configTuple =
        "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)",
      configHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", configTuple],
          [authority.address, config],
        ),
      );
    check(
      log.args.configurationHash === configHash && log.args.version === 10n,
      "wrapped creation preserves original V10 config hash and version",
    );
    stage = "actual-native-deposit-custody";
    const depositData = event.interface.encodeFunctionData("deposit"),
      deposit = await wrapped(event.target, depositData, D),
      depositInspection = inspect(
        deposit,
        event.target,
        depositData,
        D,
        "deposit",
      );
    check(
      depositInspection.permission.maxDecreaseWei === String(D),
      "deposit guard maxDecrease equals exact inner native value",
    );
    const before = await provider.getBalance(authority.address),
      managerBefore = await provider.getBalance(METAMASK_V130.manager),
      delegateBefore = await provider.getBalance(METAMASK_V130.delegate),
      deposited = await sendAuthorized(
        deposit,
        "actual type4 protected-self deposit transfers native D from authority to event",
      ),
      after = await provider.getBalance(authority.address),
      feePaid = deposited.gasUsed * deposited.gasPrice;
    await inspectCanonical(
      deposited.hash,
      event.target,
      depositData,
      D,
      "deposit",
    );
    check(
      true,
      "same type4 deposit proves canonical selfauthorization plus exact protected native intent",
    );
    check(
      before - after === D + feePaid,
      "authority native decrease reconciles exact deposit D plus gas",
    );
    check(
      (await provider.getBalance(event.target)) === D &&
        (await event.pendingDeposits(authority.address)) === D &&
        (await event.pendingTotal()) === D,
      "event custody equals D and pending credit belongs to authority wallet",
    );
    check(
      (await event.pendingDeposits(METAMASK_V130.manager)) === 0n &&
        (await event.pendingDeposits(METAMASK_V130.delegate)) === 0n &&
        (await event.stakerCount()) === 0n,
      "manager/delegate receive no participant credit or admission",
    );
    check(
      (await provider.getBalance(METAMASK_V130.manager)) === managerBefore &&
        (await provider.getBalance(METAMASK_V130.delegate)) === delegateBefore,
      "manager/delegate retain no native deposit custody",
    );
    stage = "onchain-negative-boundaries";
    const financialBefore = [
      String(await provider.getBalance(event.target)),
      String(await event.pendingDeposits(authority.address)),
      String(await event.pendingTotal()),
    ];
    await send(
      authority,
      await wrapped(event.target, depositData, D, { maxDecrease: 0n }),
      "actual enforcer rejects deposit exceeding maxDecrease",
      false,
    );
    await send(
      authority,
      await wrapped(event.target, depositData, D, { badSignature: true }),
      "actual manager rejects another wallet signature",
      false,
    );
    await send(
      authority,
      await wrapped(event.target, "0xdeadbeef", 0n),
      "actual wrapped malformed inner call reverts",
      false,
    );
    await send(
      outsider,
      {
        to: event.target,
        value: 0n,
        data: event.interface.encodeFunctionData("registerStakers", [
          [authority.address],
        ]),
      },
      "actual unrelated wallet cannot exercise owner admission",
      false,
    );
    check(
      JSON.stringify(financialBefore) ===
        JSON.stringify([
          String(await provider.getBalance(event.target)),
          String(await event.pendingDeposits(authority.address)),
          String(await event.pendingTotal()),
        ]),
      "all failed operations preserve canonical pending credit/custody",
    );
    // Pure exact-shape boundaries are separate from protocol reverts: a generic framework may allow richer routes, this app does not.
    const decoded = MANAGER.decodeFunctionData(
        "redeemDelegations",
        deposit.data,
      ),
      badInputs = [
        { ...deposit, to: METAMASK_V130.delegate },
        { ...deposit, value: 1n },
        {
          ...deposit,
          data: MANAGER.encodeFunctionData("redeemDelegations", [
            [decoded[0][0], decoded[0][0]],
            [ethers.ZeroHash, ethers.ZeroHash],
            [decoded[2][0], decoded[2][0]],
          ]),
        },
        { ...deposit, data: deposit.data + "00" },
      ];
    for (const candidate of badInputs)
      assert.throws(() =>
        inspect(candidate, event.target, depositData, D, "deposit"),
      );
    check(
      true,
      "pure app guards reject wrong manager, outer native value, extra execution and malformed trailing calldata",
    );
    stage = "actual-native-credit-recovery";
    const withdrawalData = event.interface.encodeFunctionData(
        "withdrawPending",
        [authority.address, D],
      ),
      withdrawal = await wrapped(event.target, withdrawalData, 0n);
    check(
      inspect(withdrawal, event.target, withdrawalData, 0n, "withdrawPending")
        .permission.maxDecreaseWei === "0",
      "withdrawal review allows zero native decrease only",
    );
    const walletBeforeReturn = await provider.getBalance(authority.address),
      recovered = await sendAuthorized(
        withdrawal,
        "actual type4 protected-self withdrawPending returns D to authority",
      ),
      walletAfterReturn = await provider.getBalance(authority.address);
    await inspectCanonical(
      recovered.hash,
      event.target,
      withdrawalData,
      0n,
      "withdrawPending",
    );
    check(
      true,
      "same type4 withdrawal proves canonical selfauthorization plus exact recovery intent",
    );
    check(
      walletAfterReturn + recovered.gasUsed * recovered.gasPrice ===
        walletBeforeReturn + D,
      "withdrawal native return reconciles exact D less wallet gas",
    );
    check(
      (await provider.getBalance(event.target)) === 0n &&
        (await event.pendingDeposits(authority.address)) === 0n &&
        (await event.pendingTotal()) === 0n &&
        (await event.stakerCount()) === 0n,
      "credit recovery leaves zero event balance/credit/principal and no admission",
    );
    stage = "authorization-list-negative-boundaries";
    const originalProjection = canonicalCreation.projected,
      originalHash = hash(originalProjection),
      originalAuthorization = originalProjection.authorizationList[0];
    const foreign = await outsider.authorize({
      address: METAMASK_V130.delegate,
      chainId: 1,
      nonce: Number(BigInt(originalProjection.nonce)) + 1,
    });
    const mutations = [
      (x) => (x.chainId = "0x2"),
      (x) => (x.address = safe),
      (x) => (x.nonce = ethers.toQuantity(BigInt(x.nonce) + 1n)),
      (x) => {
        x.r = foreign.signature.r;
        x.s = foreign.signature.s;
        x.yParity = ethers.toQuantity(foreign.signature.yParity);
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(originalProjection);
      mutate(changed.authorizationList[0]);
      assert.throws(
        () => inspect(changed, factory.target, createData, 0n, "createEvent"),
        (e) => e.code === "V10_AUTHORIZATION_UNKNOWN",
      );
    }
    check(
      hash(originalProjection) === originalHash,
      "wrong authorization chain/delegate/nonce/signer reject without changing canonical transaction",
    );
    const foreignNonce = await provider.getTransactionCount(
        outsider.address,
        "pending",
      ),
      foreignActual = await outsider.authorize({
        address: METAMASK_V130.delegate,
        chainId: 1,
        nonce: foreignNonce,
      }),
      foreignReceipt = await send(
        authority,
        {
          type: 4,
          to: safe,
          value: 0n,
          authorizationList: [foreignActual],
          gasLimit: 150000n,
        },
        "protocol can apply another independently signed authority; app guard still rejects it",
      ),
      foreignRaw = await provider.send("eth_getTransactionByHash", [
        foreignReceipt.hash,
      ]),
      foreignAuth = foreignRaw.authorizationList[0];
    assert.equal(
      ethers.verifyAuthorization(
        {
          address: foreignAuth.address,
          chainId: BigInt(foreignAuth.chainId),
          nonce: BigInt(foreignAuth.nonce),
        },
        {
          r: foreignAuth.r,
          s: foreignAuth.s,
          yParity: Number(BigInt(foreignAuth.yParity)),
        },
      ),
      outsider.address,
    );
    assert.equal(
      (await provider.getCode(outsider.address)).toLowerCase(),
      designation.toLowerCase(),
    );
    assert.throws(
      () =>
        inspect(
          {
            hash: foreignRaw.hash,
            from: foreignRaw.from,
            to: foreignRaw.to,
            data: foreignRaw.input,
            value: foreignRaw.value,
            chainId: foreignRaw.chainId,
            type: foreignRaw.type,
            nonce: foreignRaw.nonce,
            authorizationList: structuredClone(foreignRaw.authorizationList),
          },
          safe,
          "0x",
          0n,
          "deposit",
        ),
      (e) => e.code === "V10_AUTHORIZATION_UNKNOWN",
    );
    check(
      true,
      "actual foreign authority authorization is protocol-valid but cannot satisfy app wallet ownership profile",
    );
    stage = "strict-canonical-verifier-with-trusted-factual-intent";
    const createdBlock = await provider.getBlock(created.blockNumber),
      d = {
        contractVersion: "kleros-event-v10-uups",
        abiVersion: "kleros-event-v10-uups",
        chainId: 1,
        eventId: "local-eip7702",
        contract: event.target,
        owner: authority.address,
        creator: authority.address,
        factory: factory.target,
        implementation: implementation.target,
        implementationCodeHash: ethers.keccak256(
          await provider.getCode(implementation.target),
        ),
        initialImplementation: implementation.target,
        factoryImplementation: factoryImplementation.target,
        factoryImplementationCodeHash: ethers.keccak256(
          await provider.getCode(factoryImplementation.target),
        ),
        initialFactoryImplementation: factoryImplementation.target,
        codeHash: ethers.keccak256(await provider.getCode(event.target)),
        factoryCodeHash: ethers.keccak256(
          await provider.getCode(factory.target),
        ),
        upgradeAuthority: controller.target,
        upgradeAuthorityCodeHash: ethers.keccak256(
          await provider.getCode(controller.target),
        ),
        initialUpgradeOwner: authority.address,
        controllerDeploymentTxHash: births[0].hash,
        controllerDeploymentBlock: births[0].blockNumber,
        factoryDeploymentTxHash: births[3].hash,
        factoryDeploymentBlock: births[3].blockNumber,
        deploymentTxHash: created.hash,
        deploymentBlock: created.blockNumber,
        eventKey,
        factoryEventId: log.args.eventId,
        configurationHash: configHash,
        depositWei: String(D),
        eventName: config.eventName,
        eventStart: config.eventStart,
        claimDeadline: config.claimDeadline,
        resolver: resolver.target,
        arbitrator: liquid.target,
        arbitratorExtraData: config.arbitration.extraData,
        policyURI: config.arbitration.policyURI,
        templateHash: hash([
          config.arbitration.metaEvidenceTemplate,
          config.arbitration.metaEvidenceSlots,
        ]),
        depositOpensAt: createdBlock.timestamp,
        depositDeadline: config.eventStart,
      },
      chain = {
        provider,
        production: true,
        chainId: 1,
        manifest: { provenance },
        governance: {
          kind: "single-owner-immediate",
          initialOwner: authority.address,
          upgradeDelaySeconds: 0,
          renounceable: true,
        },
      };
    await assert.rejects(
      verifyV10Deployment(chain, d),
      (e) => e.code === "UPGRADE_TRUST_MISMATCH",
    );
    check(
      true,
      "normal verifier still rejects wrapped birth without trusted hook",
    );
    chain.assertTransactionIntent = async (actual, expected) => {
      assert.equal(actual.hash, created.hash);
      const { inspection } = await inspectCanonical(
        actual.hash,
        expected.to,
        expected.data,
        0n,
        "createEvent",
      );
      return compatibility.factualIntentProof({ inspection, expected });
    };
    const verified = await verifyV10Deployment(chain, d);
    check(
      verified.deploymentTrust.status === "verified" &&
        verified.upgrade.owner === authority.address,
      "canonical V10 full source/history verifier accepts actual wrapper only with trusted exact proof",
    );
    proof.result = {
      actualType4ProtectedExecution: true,
      firstProtectedNonce: 4,
      firstAuthorizationNonce: 5,
      directSetupCreates: 4,
      wrappedChild: event.target,
      nativeDepositWei: String(D),
      nativeReturnedWei: String(D),
      endingPendingWei: "0",
      endingCustodyWei: "0",
      financialEligibility: false,
    };
    proof.passed = true;
    stage = "passed";
  } catch (error) {
    proof.stopped = {
      stage,
      code:
        typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
          ? error.code
          : "LOCAL_ASSERTION_OR_PROTOCOL_FAILURE",
    };
  } finally {
    proof.finishedAt = new Date().toISOString();
    proof.actualBroadcasts = broadcastCount;
    if (provider) provider.destroy();
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        sleep(1000),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, "proof.json");
    fs.writeFileSync(file, JSON.stringify(proof, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        passed: proof.passed,
        stage,
        checks: proof.checks.length,
        actualBroadcasts: broadcastCount,
        proof: file,
        proofSha256: hash(fs.readFileSync(file)),
        stoppedCode: proof.stopped?.code,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
}
