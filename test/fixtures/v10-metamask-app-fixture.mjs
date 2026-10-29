// Actual loopback V10 app/protocol fixture. No public RPC or persisted synthetic key.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { ethers } from "ethers";
import { hash } from "../../src/utils.mjs";
import { createWorkbench } from "../../src/workbench.mjs";
import { startServer } from "../../src/server.mjs";
import { loadV10UpgradeableArtifacts } from "../../src/v10-upgrade-artifacts.mjs";
import { createV10ProductionWallets } from "../../src/v10-production-wallets.mjs";
import {
  MAINNET_KLEROS,
  MAINNET_EXTRA_DATA,
  MAINNET_READ_METHODS,
} from "../../scripts/mainnet/verify-kleros.mjs";
import {
  METAMASK_V130,
  METAMASK_DELEGATION_DOMAIN,
  METAMASK_DELEGATION_TYPES,
  METAMASK_ROOT_AUTHORITY,
} from "../../src/v10-wallet-compatibility.mjs";

export const V10_MM_APP_PROFILE = "kleros-event-v10-uups";
const BINARY =
  "/private/tmp/kleros-v10-anvil-MpZaXr/node_modules/@foundry-rs/anvil-darwin-arm64/bin/anvil";
const readMethods = new Set(MAINNET_READ_METHODS),
  read = (name) =>
    JSON.parse(fs.readFileSync(new URL(`../../${name}`, import.meta.url)));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const s = net.createServer();
  await new Promise((resolve, reject) => {
    s.once("error", reject);
    s.listen(0, "127.0.0.1", resolve);
  });
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}
export async function createV10MetaMaskAppFixture(options = {}) {
  assert(
    Object.keys(options).every((key) => key === "origin"),
    "No injected account policy is permitted in the normal-service fixture",
  );
  const { origin = "https://v10-mm-browser.example.invalid" } = options;
  assert.equal(new URL(origin).origin, origin);
  assert.equal(new URL(origin).protocol, "https:");
  const backendOrigin = "https://v10-mm-loopback-backend.example.invalid",
    proxySecret = "synthetic_v10_mm_proxy_" + "0123456789abcdef".repeat(4),
    stats = {
      providerReads: 0,
      backendSigningCalls: 0,
      authSignatures: 0,
      walletRequests: 0,
      walletReadOnlyCalls: [],
      accountPolicyDependencyOverrides: 0,
      sent: [],
      initializationTransactions: [],
      publicNetworkRequests: 0,
    };
  let child,
    signerProvider,
    readProvider,
    endpoint,
    app,
    w,
    organizer,
    dir,
    stateFile,
    manifest,
    runtime,
    auth = null,
    review = null,
    armed = null,
    salt = 1n;
  const usedNonces = new Set(),
    walletReadTags = new Set(),
    abi = loadV10UpgradeableArtifacts();
  async function assertLocal() {
    assert(child && child.exitCode === null && child.signalCode === null);
    assert.equal(new URL(endpoint).hostname, "127.0.0.1");
    assert.equal(signerProvider._getConnection().url, endpoint);
    const [info, client, chain] = await Promise.all([
      signerProvider.send("anvil_nodeInfo", []),
      signerProvider.send("web3_clientVersion", []),
      signerProvider.send("eth_chainId", []),
    ]);
    assert.match(client, /^anvil\/v1\.7\.1\b/i);
    assert.equal(BigInt(chain), 1n);
    assert.equal(BigInt(info.environment.chainId), 1n);
    assert.equal(String(info.hardFork).toLowerCase(), "prague");
    assert.equal(info.forkConfig.forkUrl, null);
    assert.equal(info.forkConfig.forkBlockNumber, null);
  }
  async function local(method, params) {
    await assertLocal();
    return signerProvider.send(method, params);
  }
  async function send(wallet, tx, label) {
    await assertLocal();
    const nonce = await signerProvider.getTransactionCount(
        wallet.address,
        "pending",
      ),
      sent = await wallet.sendTransaction({
        type: 2,
        chainId: 1,
        nonce,
        gasLimit: 16000000n,
        maxFeePerGas: 3000000000n,
        maxPriorityFeePerGas: 1000000000n,
        ...tx,
      });
    stats.initializationTransactions.push({ hash: sent.hash, label });
    const receipt = await sent.wait();
    assert.equal(receipt.status, 1);
    return receipt;
  }
  async function close() {
    await app?.close();
    app = null;
    signerProvider?.destroy();
    readProvider?.destroy();
    if (child?.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        wait(1000),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  try {
    assert.match(
      execFileSync(BINARY, ["--version"], { encoding: "utf8" }),
      /^anvil Version: 1\.7\.1\b/,
    );
    endpoint = `http://127.0.0.1:${await freePort()}/`;
    child = spawn(
      BINARY,
      [
        "--silent",
        "--host",
        "127.0.0.1",
        "--port",
        new URL(endpoint).port,
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
    signerProvider = new ethers.JsonRpcProvider(
      endpoint,
      { chainId: 1, name: "v10-mm-local-signer" },
      { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 },
    );
    signerProvider.pollingInterval = 10;
    let ready = false;
    for (let i = 0; i < 80; i++) {
      assert.equal(child.exitCode, null);
      try {
        await signerProvider.send("anvil_nodeInfo", []);
        ready = true;
        break;
      } catch {
        await wait(50);
      }
    }
    assert(ready);
    await assertLocal();
    assert.equal(await signerProvider.getBlockNumber(), 0);
    assert.deepEqual(await signerProvider.send("eth_accounts", []), []);
    const owner = ethers.Wallet.createRandom().connect(signerProvider);
    organizer = ethers.Wallet.createRandom().connect(signerProvider);
    for (const wallet of [owner, organizer])
      await local("anvil_setBalance", [
        wallet.address,
        ethers.toQuantity(ethers.parseEther("100")),
      ]);
    const deploy = async (a, args, label) => {
      const tx = await new ethers.ContractFactory(
          a.abi,
          a.bytecode,
        ).getDeployTransaction(...args),
        r = await send(owner, { to: null, value: 0n, data: tx.data }, label);
      return {
        contract: new ethers.Contract(r.contractAddress, a.abi, signerProvider),
        receipt: r,
      };
    };
    const controller = await deploy(
        abi.controller,
        [owner.address],
        "controller",
      ),
      implementation = await deploy(abi.event, [], "event implementation"),
      factoryImpl = await deploy(abi.factory, [], "factory implementation"),
      proxy = await deploy(
        abi.proxy,
        [
          factoryImpl.contract.target,
          factoryImpl.contract.interface.encodeFunctionData("initialize", [
            implementation.contract.target,
            controller.contract.target,
          ]),
        ],
        "factory proxy",
      ),
      liquid = await deploy(
        read("references/kickback/build/MockKlerosLiquid.json"),
        [],
        "local Court liquid fixture",
      ),
      resolver = await deploy(
        read("references/kickback/build/MockArbitrableProxy.json"),
        [MAINNET_KLEROS.arbitrator],
        "local Court resolver fixture",
      );
    // Court hooks/metadata alone are mocked at canonical addresses, never public Court behavior.
    for (const [target, code] of [
      [
        MAINNET_KLEROS.arbitrator,
        await signerProvider.getCode(liquid.contract.target),
      ],
      [
        MAINNET_KLEROS.resolver,
        await signerProvider.getCode(resolver.contract.target),
      ],
    ])
      await local("anvil_setCode", [target, code]);
    const observed = read(
        "artifacts/v10-integration/metamask-runtime-observed.json",
      ),
      fixed = {
        manager: METAMASK_V130.manager,
        delegate: METAMASK_V130.delegate,
        nativeBalanceEnforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
      };
    for (const [name, target] of Object.entries(fixed)) {
      const rows = observed.contracts.filter((x) => x.name === name);
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(ethers.getAddress(row.address), target);
      assert.equal(ethers.keccak256(row.code), row.codeHash);
      await local("anvil_setCode", [target, row.code]);
    }
    assert.equal(await signerProvider.getCode(organizer.address), "0x");
    const nonce = await signerProvider.getTransactionCount(
        organizer.address,
        "pending",
      ),
      authorization = await organizer.authorize({
        chainId: 1,
        address: METAMASK_V130.delegate,
        nonce: nonce + 1,
      }),
      authReceipt = await send(
        organizer,
        {
          type: 4,
          to: owner.address,
          value: 0n,
          gasLimit: 150000n,
          authorizationList: [authorization],
        },
        "real type4 organizer selfauthorization",
      );
    assert.equal(
      (await signerProvider.getCode(organizer.address)).toLowerCase(),
      ("0xef0100" + METAMASK_V130.delegate.slice(2)).toLowerCase(),
    );
    assert.equal(
      await signerProvider.getTransactionCount(organizer.address, "pending"),
      nonce + 2,
    );
    stats.authorizationInstalledByActualType4 = true;
    stats.authorizationHash = authReceipt.hash;
    stats.walletCodeSetByCheat = false;
    const policyText = fs.readFileSync(
        new URL(
          "../../docs/contracts/v10-luma-generic-policy.md",
          import.meta.url,
        ),
        "utf8",
      ),
      F = {
        chainId: 1,
        contractVersion: V10_MM_APP_PROFILE,
        abiVersion: V10_MM_APP_PROFILE,
        factory: proxy.contract.target,
        factoryCodeHash: ethers.keccak256(
          await signerProvider.getCode(proxy.contract.target),
        ),
        implementation: implementation.contract.target,
        implementationCodeHash: ethers.keccak256(
          await signerProvider.getCode(implementation.contract.target),
        ),
        initialImplementation: implementation.contract.target,
        factoryImplementation: factoryImpl.contract.target,
        factoryImplementationCodeHash: ethers.keccak256(
          await signerProvider.getCode(factoryImpl.contract.target),
        ),
        initialFactoryImplementation: factoryImpl.contract.target,
        upgradeAuthority: controller.contract.target,
        upgradeAuthorityCodeHash: ethers.keccak256(
          await signerProvider.getCode(controller.contract.target),
        ),
        initialUpgradeOwner: owner.address,
        factoryDeploymentTxHash: proxy.receipt.hash,
        factoryDeploymentBlock: proxy.receipt.blockNumber,
        controllerDeploymentTxHash: controller.receipt.hash,
        controllerDeploymentBlock: controller.receipt.blockNumber,
        policy: {
          contractVersion: V10_MM_APP_PROFILE,
          uri: "https://policy.example.invalid/v10.md",
          sha256: hash(policyText),
          text: policyText,
        },
        policyStatus: "published",
      },
      governance = {
        kind: "single-owner-immediate",
        initialOwner: owner.address,
        upgradeDelaySeconds: 0,
        renounceable: true,
      };
    manifest = {
      environment: "production",
      chain: {
        chainId: 1,
        name: "Ethereum",
        rpcUrl: "https://ethereum.example.invalid",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
      factoryDeployment: F,
      events: [],
      governance,
      arbitration: {
        mode: "kleros-v1",
        resolver: MAINNET_KLEROS.resolver,
        arbitrator: MAINNET_KLEROS.arbitrator,
        extraData: MAINNET_EXTRA_DATA,
      },
      provenance: Object.fromEntries(
        [
          ["v10BuildManifestSha256", "manifest"],
          ["v10StandardInputSha256", "standard-input"],
        ].map(([key, file]) => [
          key,
          hash(read(`build/contracts-v10/${file}.json`)),
        ]),
      ),
    };
    readProvider = new ethers.JsonRpcProvider(
      endpoint,
      { chainId: 1, name: "v10-mm-keyless-backend" },
      { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 },
    );
    readProvider.pollingInterval = 10;
    const originalSend = readProvider.send.bind(readProvider),
      originalBatch = readProvider._send.bind(readProvider);
    const assertRead = (method) => {
      if (!readMethods.has(method)) {
        stats.backendSigningCalls++;
        throw Error("Backend read-only method guard");
      }
    };
    readProvider.send = async (method, params) => {
      assertRead(method);
      stats.providerReads++;
      return originalSend(method, params);
    };
    readProvider._send = async (payload) => {
      for (const p of Array.isArray(payload) ? payload : [payload])
        assertRead(p.method);
      return originalBatch(payload);
    };
    for (const method of ["getSigner", "listAccounts", "broadcastTransaction"])
      readProvider[method] = async () => {
        stats.backendSigningCalls++;
        throw Error("No backend signing or broadcasting");
      };
    runtime = {
      provider: readProvider,
      chainId: 1,
      production: true,
      signers: [],
      financialModel: "v8",
      governance,
      manifest,
      factoryDeployment: F,
      eventVerification: new Map(),
      resolver: new ethers.Contract(
        MAINNET_KLEROS.resolver,
        resolver.contract.interface,
        readProvider,
      ),
      liquid: new ethers.Contract(
        MAINNET_KLEROS.arbitrator,
        liquid.contract.interface,
        readProvider,
      ),
      close: async () => {},
    };
    const facts = await createV10ProductionWallets({
      chain: runtime,
      origin,
      instanceId: "fixture-source-proof-only",
    }).classifyWallet(organizer.address);
    assert.equal(facts.accountType, "metamask-protected-self-v1.3");
    assert.equal(facts.financialEligible, false);
    stats.sourceVerifiedRuntimeHashes = facts.framework.map(
      ({ name, address, codeHash }) => ({ name, address, codeHash }),
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "v10-mm-app-"));
    stateFile = path.join(dir, "v10-state.json");
    await launch();
  } catch (error) {
    await close();
    throw error;
  }
  async function launch() {
    app = await startServer(
      {
        port: 0,
        rpcPort: 0,
        production: { manifest, stateFile },
        deployment: {
          mode: "hosted-production",
          publicOrigin: origin,
          backendOrigin,
          proxySecret,
          runtimeRoot: dir,
        },
      },
      {
        workbenchFactory: async (options) => {
          w = await createWorkbench(options, {
            productionRuntime: async () => runtime,
          });
          return w;
        },
      },
    );
  }
  async function forward(route, { method = "GET", headers = {}, body } = {}) {
    const url = new URL(route, app.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.protocol, "http:");
    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        url,
        {
          method,
          agent: false,
          headers: {
            host: new URL(backendOrigin).host,
            "x-kleros-proxy-key": proxySecret,
            ...(headers.cookie ? { cookie: headers.cookie } : {}),
            ...(method === "GET"
              ? {}
              : { origin, "content-type": "application/json" }),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
    if (response.headers["content-type"]?.startsWith("application/json")) {
      const data = JSON.parse(response.body.toString());
      if (
        route === "/api/auth/challenge" &&
        method === "POST" &&
        response.status === 200
      )
        auth = data;
      if (data.kind === "organizer-job" && data.state === "ready") {
        if (data.operation === "prepare") review = data.result;
        if (data.operation === "validate") review = data.result.draft;
      }
      if (
        method === "POST" &&
        /^\/api\/events\/[^/]+\/drafts$/.test(
          new URL(route, "https://fixture.invalid").pathname,
        ) &&
        [200, 201].includes(response.status)
      )
        review = data;
    }
    return response;
  }
  async function wallet(request, callerURL) {
    const url = new URL(callerURL);
    assert.equal(url.origin, origin);
    const { method, params = [] } = request;
    assert(Array.isArray(params));
    await assertLocal();
    if (["eth_accounts", "eth_requestAccounts"].includes(method)) {
      assert.equal(params.length, 0);
      stats.walletReadOnlyCalls.push({ method });
      return [organizer.address];
    }
    if (method === "eth_chainId") {
      assert.equal(params.length, 0);
      stats.walletReadOnlyCalls.push({ method });
      return signerProvider.send(method, params);
    }
    if (method === "eth_getBlockByNumber") {
      assert.equal(params.length, 2);
      assert.equal(params[1], false);
      assert(
        params[0] === "latest" || walletReadTags.has(params[0]),
        "Only a fresh or previously captured wallet head may be read",
      );
      const block = await signerProvider.send(method, params);
      assert(
        /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(block?.number ?? "") &&
          ethers.isHexString(block?.hash, 32),
      );
      if (params[0] !== "latest")
        assert.equal(BigInt(block.number), BigInt(params[0]));
      assert(BigInt(block.number) <= BigInt(Number.MAX_SAFE_INTEGER));
      walletReadTags.add(block.number);
      assert(walletReadTags.size <= 256);
      stats.walletReadOnlyCalls.push({
        method,
        blockNumber: Number(BigInt(block.number)),
        kind: params[0] === "latest" ? "fresh" : "canonical-recheck",
      });
      return block;
    }
    if (method === "eth_getCode") {
      assert.equal(params.length, 2);
      assert(ethers.isAddress(params[0]) && walletReadTags.has(params[1]));
      const permitted = {
          wallet: organizer.address,
          manager: METAMASK_V130.manager,
          delegate: METAMASK_V130.delegate,
          nativeBalanceEnforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
        },
        target = Object.entries(permitted).find(
          ([, address]) => address.toLowerCase() === params[0].toLowerCase(),
        );
      assert(
        target,
        "Wallet code reads are limited to the actor and the three source-pinned framework contracts",
      );
      stats.walletReadOnlyCalls.push({
        method,
        target: target[0],
        blockNumber: Number(BigInt(params[1])),
      });
      return signerProvider.send(method, params);
    }
    if (method === "personal_sign") {
      assert(auth && auth.expiresAt > Date.now());
      assert.equal(params.length, 2);
      const message = ethers.toUtf8String(params[0]);
      assert.equal(message, auth.message);
      assert.equal(ethers.getAddress(params[1]), organizer.address);
      assert(message.startsWith("Kleros Ethereum mainnet workbench\n"));
      assert(
        message.includes(
          `\nDomain: ${new URL(origin).host}\nURI: ${origin}\nChain ID: 1\nWallet: ${organizer.address}\n`,
        ),
      );
      assert(!usedNonces.has(auth.nonce));
      usedNonces.add(auth.nonce);
      stats.authSignatures++;
      return organizer.signMessage(message);
    }
    assert.equal(method, "eth_sendTransaction");
    assert.equal(params.length, 1);
    assert(review && armed === review.id && review.expiresAt > Date.now());
    const action =
      review.action ??
      (review.scopeKind === "factory-create" ? "createEvent" : null);
    assert(["createEvent", "deposit", "withdrawPending"].includes(action));
    const tx = params[0],
      value = BigInt(review.transaction.value);
    assert.deepEqual(tx, {
      to: review.transaction.to,
      from: review.transaction.from,
      data: review.transaction.data,
      value: ethers.toQuantity(value),
      chainId: "0x1",
    });
    assert.equal(tx.from, organizer.address);
    if (action === "createEvent") {
      assert.equal(review.scopeKind, "factory-create");
      assert.equal(tx.to, manifest.factoryDeployment.factory);
    } else {
      assert.equal(
        new URLSearchParams(url.hash.slice(1)).get("event"),
        review.eventId,
      );
      assert.equal(tx.to, w.events.get(review.eventId).deployment.contract);
    }
    await assertLocal();
    assert.equal(
      (await signerProvider.getCode(organizer.address)).toLowerCase(),
      ("0xef0100" + METAMASK_V130.delegate.slice(2)).toLowerCase(),
    );
    const delegation = {
        delegate: organizer.address,
        delegator: organizer.address,
        authority: METAMASK_ROOT_AUTHORITY,
        caveats: [
          {
            enforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
            terms: ethers.solidityPacked(
              ["uint8", "address", "uint256"],
              [1, organizer.address, value],
            ),
            args: "0x",
          },
        ],
        salt: salt++,
      },
      signature = await organizer.signTypedData(
        METAMASK_DELEGATION_DOMAIN,
        METAMASK_DELEGATION_TYPES,
        {
          ...delegation,
          caveats: delegation.caveats.map(({ enforcer, terms }) => ({
            enforcer,
            terms,
          })),
        },
      ),
      permission = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "tuple(address delegate,address delegator,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]",
        ],
        [[{ ...delegation, signature }]],
      ),
      manager = new ethers.Interface([
        "function redeemDelegations(bytes[],bytes32[],bytes[])",
      ]),
      data = manager.encodeFunctionData("redeemDelegations", [
        [permission],
        [ethers.ZeroHash],
        [
          ethers.solidityPacked(
            ["address", "uint256", "bytes"],
            [tx.to, value, tx.data],
          ),
        ],
      ]),
      nonce = await signerProvider.getTransactionCount(
        organizer.address,
        "pending",
      ),
      authorization = await organizer.authorize({
        chainId: 1,
        address: METAMASK_V130.delegate,
        nonce: nonce + 1,
      }),
      walletBalanceBefore = await signerProvider.getBalance(organizer.address);
    await assertLocal();
    assert.equal(
      await signerProvider.getTransactionCount(organizer.address, "pending"),
      nonce,
    );
    armed = null;
    stats.walletRequests++;
    const sent = await organizer.sendTransaction({
      type: 4,
      chainId: 1,
      nonce,
      to: METAMASK_V130.manager,
      value: 0n,
      data,
      authorizationList: [authorization],
      gasLimit: 12000000n,
      maxFeePerGas: 3000000000n,
      maxPriorityFeePerGas: 1000000000n,
    });
    // No await between actual hash acknowledgement and its Node-side contactless journal.
    stats.sent.push({
      hash: sent.hash,
      draftId: review.id,
      eventId: review.eventId,
      action,
      reviewedValueWei: String(value),
      walletBalanceBeforeWei: String(walletBalanceBefore),
      outerValueWei: "0",
      type: 4,
    });
    return sent.hash;
  }
  async function financialSnapshot(eventId) {
    const record = w.events.get(eventId);
    assert(record);
    const c = new ethers.Contract(
        record.deployment.contract,
        abi.event.abi,
        readProvider,
      ),
      block = await readProvider.getBlock("latest"),
      at = { blockTag: block.number };
    return {
      blockNumber: block.number,
      blockHash: block.hash,
      walletBalanceWei: String(
        await readProvider.getBalance(organizer.address, block.number),
      ),
      eventBalanceWei: String(
        await readProvider.getBalance(c.target, block.number),
      ),
      pendingWei: String(await c.pendingDeposits(organizer.address, at)),
      pendingTotalWei: String(await c.pendingTotal(at)),
      stakerCount: String(await c.stakerCount(at)),
      managerBalanceWei: String(
        await readProvider.getBalance(METAMASK_V130.manager, block.number),
      ),
      delegateBalanceWei: String(
        await readProvider.getBalance(METAMASK_V130.delegate, block.number),
      ),
    };
  }
  return {
    origin,
    manifest,
    provider: readProvider,
    stats,
    organizerAddress: organizer.address,
    forward,
    wallet,
    financialSnapshot,
    reviewedDraft: () => structuredClone(review),
    armCreation: (id) => {
      assert(
        review && review.id === id && review.scopeKind === "factory-create",
      );
      armed = id;
    },
    armEventDraft: (id, action) => {
      assert(review && review.id === id && review.action === action);
      armed = id;
    },
    workbench: () => w,
    savedState: () =>
      fs.existsSync(stateFile)
        ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
        : null,
    restart: async () => {
      await app.close();
      app = null;
      auth = null;
      review = null;
      armed = null;
      await launch();
    },
    close,
  };
}
