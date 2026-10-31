// Actual two-actor loopback V10 financial-flow fixture. No public RPC or persisted key.
// Financial calls are available only through one explicitly armed browser review.
// The only Node-side protocol actions exposed are bounded local time and mock Court ruling.
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

export const V10_MM_FLOW_PROFILE = "kleros-event-v10-uups";
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
export async function createV10MetaMaskFlowFixture(options = {}) {
  assert(
    Object.keys(options).every((key) => key === "origin"),
    "No injected account policy is permitted in the normal-service fixture",
  );
  const { origin = "https://v10-mm-flow.example.invalid" } = options;
  assert.equal(new URL(origin).origin, origin);
  assert.equal(new URL(origin).protocol, "https:");
  const backendOrigin = "https://v10-mm-flow-backend.example.invalid",
    proxySecret = "synthetic_v10_mm_flow_proxy_" + "0123456789abcdef".repeat(4),
    stats = {
      providerReads: 0,
      backendSigningCalls: 0,
      authSignatures: 0,
      walletRequests: 0,
      walletReadOnlyCalls: [],
      accountPolicyDependencyOverrides: 0,
      sent: [],
      initializationTransactions: [],
      controlledCourtTransactions: [],
      localTimeChanges: [],
      actors: {
        alice: { authSignatures: 0, walletRequests: 0 },
        bob: { authSignatures: 0, walletRequests: 0 },
      },
      publicNetworkRequests: 0,
    };
  let child,
    signerProvider,
    readProvider,
    endpoint,
    app,
    w,
    organizer,
    bob,
    courtOperator,
    dir,
    stateFile,
    manifest,
    runtime,
    salt = 1n;
  const actorStates = new Map(),
    abi = loadV10UpgradeableArtifacts();
  function actorState(actor = "alice") {
    assert(["alice", "bob"].includes(actor), "Exact fixture actor required");
    const state = actorStates.get(actor);
    assert(state, "Fixture actor is not initialized");
    return state;
  }
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
    if (label !== "controlled local Court attended ruling only")
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
    courtOperator = owner;
    organizer = ethers.Wallet.createRandom().connect(signerProvider);
    bob = ethers.Wallet.createRandom().connect(signerProvider);
    for (const [name, wallet] of [
      ["alice", organizer],
      ["bob", bob],
    ])
      actorStates.set(name, {
        wallet,
        auth: null,
        review: null,
        armed: null,
        usedNonces: new Set(),
        walletReadTags: new Set(),
      });
    for (const wallet of [owner, organizer, bob])
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
    // Installing mock runtime does not run constructor storage initializers.
    // Set only its public Court test hooks through actual local transactions.
    await send(
      owner,
      {
        to: MAINNET_KLEROS.arbitrator,
        value: 0n,
        data: liquid.contract.interface.encodeFunctionData("setFeeForJuror", [
          10000000000n,
        ]),
      },
      "local controlled Court fee fixture",
    );
    await send(
      owner,
      {
        to: MAINNET_KLEROS.arbitrator,
        value: 0n,
        data: liquid.contract.interface.encodeFunctionData(
          "setJurorsForCourtJump",
          [511],
        ),
      },
      "local controlled Court appeal ceiling fixture",
    );
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
    for (const [actor, state] of actorStates) {
      const wallet = state.wallet;
      assert.equal(await signerProvider.getCode(wallet.address), "0x");
      const nonce = await signerProvider.getTransactionCount(
          wallet.address,
          "pending",
        ),
        authorization = await wallet.authorize({
          chainId: 1,
          address: METAMASK_V130.delegate,
          nonce: nonce + 1,
        }),
        authReceipt = await send(
          wallet,
          {
            type: 4,
            to: owner.address,
            value: 0n,
            gasLimit: 150000n,
            authorizationList: [authorization],
          },
          `real type4 ${actor} selfauthorization`,
        );
      assert.equal(
        (await signerProvider.getCode(wallet.address)).toLowerCase(),
        ("0xef0100" + METAMASK_V130.delegate.slice(2)).toLowerCase(),
      );
      assert.equal(
        await signerProvider.getTransactionCount(wallet.address, "pending"),
        nonce + 2,
      );
      stats.actors[actor].authorizationHash = authReceipt.hash;
    }
    stats.authorizationInstalledByActualType4 = true;
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
        contractVersion: V10_MM_FLOW_PROFILE,
        abiVersion: V10_MM_FLOW_PROFILE,
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
          contractVersion: V10_MM_FLOW_PROFILE,
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
    for (const [actor, state] of actorStates) {
      const facts = await createV10ProductionWallets({
        chain: runtime,
        origin,
        instanceId: "fixture-source-proof-only",
      }).classifyWallet(state.wallet.address);
      assert.equal(facts.accountType, "metamask-protected-self-v1.3");
      assert.equal(facts.financialEligible, false);
      const framework = facts.framework.map(({ name, address, codeHash }) => ({
        name,
        address,
        codeHash,
      }));
      if (actor === "alice") stats.sourceVerifiedRuntimeHashes = framework;
      else assert.deepEqual(framework, stats.sourceVerifiedRuntimeHashes);
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "v10-mm-flow-"));
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
  async function forward(
    route,
    { method = "GET", headers = {}, body, actor = "alice" } = {},
  ) {
    const state = actorState(actor);
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
        state.auth = data;
      if (data.kind === "organizer-job" && data.state === "ready") {
        if (data.operation === "prepare") state.review = data.result;
        if (data.operation === "validate") state.review = data.result.draft;
      }
      if (
        method === "POST" &&
        /^\/api\/events\/[^/]+\/drafts$/.test(
          new URL(route, "https://fixture.invalid").pathname,
        ) &&
        [200, 201].includes(response.status)
      )
        state.review = data;
    }
    return response;
  }
  async function wallet(request, callerURL, actor = "alice") {
    const state = actorState(actor),
      walletSigner = state.wallet,
      { auth, review, walletReadTags, usedNonces } = state;
    const url = new URL(callerURL);
    assert.equal(url.origin, origin);
    const { method, params = [] } = request;
    assert(Array.isArray(params));
    await assertLocal();
    if (["eth_accounts", "eth_requestAccounts"].includes(method)) {
      assert.equal(params.length, 0);
      stats.walletReadOnlyCalls.push({ method });
      return [walletSigner.address];
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
          wallet: walletSigner.address,
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
      assert.equal(ethers.getAddress(params[1]), walletSigner.address);
      assert(message.startsWith("Kleros Ethereum mainnet workbench\n"));
      assert(
        message.includes(
          `\nDomain: ${new URL(origin).host}\nURI: ${origin}\nChain ID: 1\nWallet: ${walletSigner.address}\n`,
        ),
      );
      assert(!usedNonces.has(auth.nonce));
      usedNonces.add(auth.nonce);
      stats.authSignatures++;
      stats.actors[actor].authSignatures++;
      return walletSigner.signMessage(message);
    }
    assert.equal(method, "eth_sendTransaction");
    assert.equal(params.length, 1);
    assert(
      review && state.armed === review.id && review.expiresAt > Date.now(),
    );
    const action =
      review.action ??
      (review.scopeKind === "factory-create" ? "createEvent" : null);
    assert(
      [
        "createEvent",
        "deposit",
        "register",
        "postAttendance",
        "challenge",
        "match",
        "release",
        "resolve",
      ].includes(action),
    );
    if (
      [
        "createEvent",
        "register",
        "postAttendance",
        "match",
        "release",
        "resolve",
      ].includes(action)
    )
      assert.equal(
        actor,
        "alice",
        "Only the actual event owner may perform fixture owner actions",
      );
    if (action === "challenge") assert.equal(actor, "bob");
    const tx = params[0],
      value = BigInt(review.transaction.value);
    assert.deepEqual(tx, {
      to: review.transaction.to,
      from: review.transaction.from,
      data: review.transaction.data,
      value: ethers.toQuantity(value),
      chainId: "0x1",
    });
    assert.equal(tx.from, walletSigner.address);
    assert(
      !stats.sent.some((item) => item.draftId === review.id),
      "A review may be sent only once",
    );
    if (action === "createEvent") {
      assert.equal(review.scopeKind, "factory-create");
      assert.equal(tx.to, manifest.factoryDeployment.factory);
    } else {
      assert.equal(
        new URLSearchParams(url.hash.slice(1)).get("event"),
        review.eventId,
      );
      const record = w.events.get(review.eventId);
      assert(record && w.events.size === 1);
      assert.equal(tx.to, record.deployment.contract);
      const parsed = new ethers.Interface(abi.event.abi).parseTransaction({
        data: tx.data,
        value,
      });
      assert(parsed);
      const methods = {
        deposit: "deposit",
        register: "registerStakers",
        postAttendance: "postAttendance",
        challenge: "challenge",
        match: "matchChallenge",
        release: "releasePayouts",
        resolve: "resolveChallenge",
      };
      assert.equal(parsed.name, methods[action]);
      if (action === "deposit") {
        assert.equal(value, BigInt(record.deployment.depositWei));
        assert(
          !stats.sent.some(
            (item) => item.actor === actor && item.action === "deposit",
          ),
        );
      } else if (["match", "resolve"].includes(action))
        assert.equal(parsed.args[0], bob.address);
      else if (action === "register") {
        assert(parsed.args[0].length > 0 && parsed.args[0].length <= 2);
        assert.equal(
          new Set(parsed.args[0].map((x) => x.toLowerCase())).size,
          parsed.args[0].length,
        );
        for (const address of parsed.args[0])
          assert([organizer.address, bob.address].includes(address));
      } else if (action === "postAttendance") {
        assert.deepEqual([...parsed.args[0]], [organizer.address]);
        assert.equal(parsed.args[1], 2n * BigInt(record.deployment.depositWei));
      }
      if (["register", "postAttendance", "release", "resolve"].includes(action))
        assert.equal(value, 0n);
    }
    await assertLocal();
    assert.equal(
      (await signerProvider.getCode(walletSigner.address)).toLowerCase(),
      ("0xef0100" + METAMASK_V130.delegate.slice(2)).toLowerCase(),
    );
    const delegation = {
        delegate: walletSigner.address,
        delegator: walletSigner.address,
        authority: METAMASK_ROOT_AUTHORITY,
        caveats: [
          {
            enforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
            terms: ethers.solidityPacked(
              ["uint8", "address", "uint256"],
              [1, walletSigner.address, value],
            ),
            args: "0x",
          },
        ],
        salt: salt++,
      },
      signature = await walletSigner.signTypedData(
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
        walletSigner.address,
        "pending",
      ),
      authorization = await walletSigner.authorize({
        chainId: 1,
        address: METAMASK_V130.delegate,
        nonce: nonce + 1,
      }),
      beforeBlock = await signerProvider.getBlock("latest"),
      walletBalancesBeforeWei = Object.fromEntries(
        await Promise.all(
          [...actorStates].map(async ([name, entry]) => [
            name,
            String(
              await signerProvider.getBalance(
                entry.wallet.address,
                beforeBlock.number,
              ),
            ),
          ]),
        ),
      ),
      walletBalanceBefore = BigInt(walletBalancesBeforeWei[actor]);
    await assertLocal();
    assert.equal(
      await signerProvider.getTransactionCount(walletSigner.address, "pending"),
      nonce,
    );
    assert.equal(state.review, review);
    assert.equal(state.armed, review.id);
    state.armed = null;
    stats.walletRequests++;
    stats.actors[actor].walletRequests++;
    const sent = await walletSigner.sendTransaction({
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
      actor,
      draftId: review.id,
      eventId: review.eventId,
      action,
      reviewedValueWei: String(value),
      walletBalanceBeforeWei: String(walletBalanceBefore),
      walletBalancesBeforeWei,
      beforeBlockNumber: beforeBlock.number,
      beforeBlockHash: beforeBlock.hash,
      outerValueWei: "0",
      type: 4,
    });
    return sent.hash;
  }
  async function financialSnapshot(eventId, actor = "alice") {
    actorState(actor);
    const record = w.events.get(eventId);
    assert(
      record && w.events.size === 1,
      "Exactly one created fixture event is required",
    );
    const c = new ethers.Contract(
        record.deployment.contract,
        abi.event.abi,
        readProvider,
      ),
      block = await readProvider.getBlock("latest"),
      at = { blockTag: block.number },
      names = [
        "phase",
        "depositAmount",
        "eventStart",
        "claimDeadline",
        "challengeEndsAt",
        "stakerCount",
        "attendeeCount",
        "pendingChallenges",
        "pendingTotal",
        "heldBack",
        "owedTotal",
        "challengeEscrow",
        "reserved",
        "payoutShare",
      ],
      values = await Promise.all(names.map((name) => c.getFunction(name)(at))),
      current = Object.fromEntries(names.map((name, i) => [name, values[i]])),
      logs = await readProvider.getLogs({
        address: c.target,
        fromBlock: record.deployment.deploymentBlock,
        toBlock: block.number,
      }),
      parsed = logs.flatMap((log) => {
        try {
          const event = c.interface.parseLog(log);
          return event ? [{ log, event }] : [];
        } catch {
          return [];
        }
      }),
      receiptNames = new Map();
    for (const { log, event } of parsed) {
      if (!receiptNames.has(log.transactionHash))
        receiptNames.set(log.transactionHash, new Set());
      receiptNames.get(log.transactionHash).add(event.name);
    }
    const attendancePaid = (receiptHash, wallet) =>
      parsed
        .filter(
          ({ log, event }) =>
            (!receiptHash || log.transactionHash === receiptHash) &&
            event.name === "Payout" &&
            event.args.to.toLowerCase() === wallet.toLowerCase() &&
            (receiptNames.get(log.transactionHash).has("Finalized") ||
              receiptNames.get(log.transactionHash).has("ChallengeResolved")),
        )
        .reduce((sum, { event }) => sum + event.args.amount, 0n);
    const operations = [];
    for (const sent of stats.sent.filter((item) => item.eventId === eventId)) {
      const receipt = await readProvider.getTransactionReceipt(sent.hash);
      if (!receipt || receipt.blockNumber > block.number) continue;
      assert.equal(
        receipt.status,
        1,
        "A fixture UI operation must be successful",
      );
      const header = await readProvider.getBlock(receipt.blockNumber);
      assert.equal(header.hash, receipt.blockHash);
      const gasWei = receipt.gasUsed * receipt.gasPrice,
        perActor = {};
      for (const [name, entry] of actorStates) {
        const before = await readProvider.getBalance(
            entry.wallet.address,
            receipt.blockNumber - 1,
          ),
          after = await readProvider.getBalance(
            entry.wallet.address,
            receipt.blockNumber,
          ),
          delta = after - before,
          adjusted = delta + (name === sent.actor ? gasWei : 0n),
          paid = attendancePaid(sent.hash, entry.wallet.address),
          resolved = parsed.some(
            ({ log, event }) =>
              log.transactionHash === sent.hash &&
              event.name === "ChallengeResolved" &&
              event.args.staker.toLowerCase() ===
                entry.wallet.address.toLowerCase(),
          );
        perActor[name] = {
          wallet: entry.wallet.address,
          beforeBalanceWei: String(before),
          afterBalanceWei: String(after),
          nativeDeltaWei: String(delta),
          gasAdjustedDeltaWei: String(adjusted),
          attendancePaidWei: String(paid),
          // The resolver remainder is a separate actual transfer, never a Payout attendance event.
          collateralReceivedWei:
            sent.action === "resolve" && resolved
              ? String(adjusted - paid)
              : "0",
        };
        assert(BigInt(perActor[name].collateralReceivedWei) >= 0n);
      }
      operations.push({
        hash: sent.hash,
        actor: sent.actor,
        action: sent.action,
        draftId: sent.draftId,
        eventId,
        reviewedValueWei: sent.reviewedValueWei,
        type: sent.type,
        outerValueWei: sent.outerValueWei,
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        gasUsed: String(receipt.gasUsed),
        gasPriceWei: String(receipt.gasPrice),
        gasWei: String(gasWei),
        perActor,
      });
    }
    const actors = {};
    for (const [name, entry] of actorStates) {
      const wallet = entry.wallet.address,
        [balance, pending, status, attended, owed, challenge] =
          await Promise.all([
            readProvider.getBalance(wallet, block.number),
            c.pendingDeposits(wallet, at),
            c.status(wallet, at),
            c.attended(wallet, at),
            c.owed(wallet, at),
            c.challenges(wallet, at),
          ]),
        matched =
          Number(challenge.state) >= 2 &&
          challenge.matcher !== ethers.ZeroAddress;
      let isRuled = false,
        finalRuling = null;
      if (matched) {
        const resolverCase = await runtime.resolver.disputes(
          challenge.localDisputeID,
          at,
        );
        assert.equal(
          resolverCase.disputeIDOnArbitratorSide,
          challenge.arbitratorDisputeID,
        );
        assert.equal(
          await runtime.resolver.externalIDtoLocalID(
            challenge.arbitratorDisputeID,
            at,
          ),
          challenge.localDisputeID,
        );
        isRuled = resolverCase.isRuled;
        if (isRuled) finalRuling = Number(resolverCase.ruling);
      }
      actors[name] = {
        wallet,
        walletBalanceWei: String(balance),
        pendingWei: String(pending),
        status: Number(status),
        registered: [1, 2].includes(Number(status)),
        attended,
        owedWei: String(owed),
        heldShareWei: String(challenge.heldShare),
        directAttendancePaidWei: String(attendancePaid(null, wallet)),
        sentGasWei: String(
          operations
            .filter((op) => op.actor === name)
            .reduce((sum, op) => sum + BigInt(op.gasWei), 0n),
        ),
        challengeCollateralPaidWei: String(
          operations
            .filter(
              (op) =>
                op.actor === name && ["challenge", "match"].includes(op.action),
            )
            .reduce((sum, op) => sum + BigInt(op.reviewedValueWei), 0n),
        ),
        challengeCollateralReceivedWei: String(
          operations.reduce(
            (sum, op) => sum + BigInt(op.perActor[name].collateralReceivedWei),
            0n,
          ),
        ),
        challenge: {
          state: Number(challenge.state),
          matcher: challenge.matcher,
          matchEndsAt: Number(challenge.matchEndsAt),
          depositWei: String(challenge.deposit),
          arbitrationPaidWei: String(challenge.arbitrationPaid),
          localDisputeID: matched ? String(challenge.localDisputeID) : null,
          arbitratorDisputeID: matched
            ? String(challenge.arbitratorDisputeID)
            : null,
          isRuled,
          finalRuling,
        },
      };
    }
    const result = {
      eventId,
      contract: c.target,
      blockNumber: block.number,
      blockHash: block.hash,
      timestamp: block.timestamp,
      phase: Number(current.phase),
      depositWei: String(current.depositAmount),
      eventStart: Number(current.eventStart),
      claimDeadline: Number(current.claimDeadline),
      challengeEndsAt: Number(current.challengeEndsAt),
      stakerCount: String(current.stakerCount),
      attendeeCount: String(current.attendeeCount),
      pendingChallenges: String(current.pendingChallenges),
      poolWei: String(current.depositAmount * current.stakerCount),
      pendingTotalWei: String(current.pendingTotal),
      heldBackWei: String(current.heldBack),
      owedTotalWei: String(current.owedTotal),
      challengeEscrowWei: String(current.challengeEscrow),
      reservedWei: String(current.reserved),
      payoutShareWei: String(current.payoutShare),
      eventBalanceWei: String(
        await readProvider.getBalance(c.target, block.number),
      ),
      managerBalanceWei: String(
        await readProvider.getBalance(METAMASK_V130.manager, block.number),
      ),
      delegateBalanceWei: String(
        await readProvider.getBalance(METAMASK_V130.delegate, block.number),
      ),
      actors,
      operations,
      walletBalanceWei: actors[actor].walletBalanceWei,
      pendingWei: actors[actor].pendingWei,
      directAttendancePaidWei: String(
        Object.values(actors).reduce(
          (sum, entry) => sum + BigInt(entry.directAttendancePaidWei),
          0n,
        ),
      ),
      currentObligationsWei: String(current.reserved),
      arbitrationPaidWei: actors.bob.challenge.arbitrationPaidWei,
    };
    assert.equal((await readProvider.getBlock(block.number)).hash, block.hash);
    assert(BigInt(result.eventBalanceWei) >= BigInt(result.reservedWei));
    return result;
  }
  async function timeTo(timestamp) {
    await assertLocal();
    assert(Number.isSafeInteger(timestamp));
    assert.equal(w.events.size, 1);
    const eventId = [...w.events.keys()][0],
      snapshot = await financialSnapshot(eventId),
      caseEnd = Math.max(
        snapshot.challengeEndsAt,
        snapshot.actors.bob.challenge.matchEndsAt,
      ),
      allowedStart =
        snapshot.phase === 0 &&
        [snapshot.eventStart, snapshot.eventStart + 1].includes(timestamp),
      allowedPayout =
        snapshot.phase === 1 &&
        snapshot.actors.bob.challenge.state === 2 &&
        timestamp === caseEnd + 1;
    assert(
      allowedStart || allowedPayout,
      "Only the actual event start or post-case payout boundary may be advanced",
    );
    assert(
      timestamp > snapshot.timestamp && timestamp < snapshot.claimDeadline,
    );
    await local("evm_setNextBlockTimestamp", [timestamp]);
    await local("evm_mine", []);
    const block = await readProvider.getBlock("latest");
    assert.equal(block.timestamp, timestamp);
    const fact = {
      eventId,
      from: snapshot.timestamp,
      to: timestamp,
      reason: allowedStart
        ? "actual-event-start"
        : "actual-challenge-and-match-deadlines",
      blockNumber: block.number,
      blockHash: block.hash,
    };
    stats.localTimeChanges.push(fact);
    return fact;
  }
  async function controlledAttendedRuling(eventId, bobAddress) {
    await assertLocal();
    assert.equal(ethers.getAddress(bobAddress), bob.address);
    const before = await financialSnapshot(eventId),
      ch = before.actors.bob.challenge,
      record = w.events.get(eventId),
      c = new ethers.Contract(
        record.deployment.contract,
        abi.event.abi,
        readProvider,
      );
    assert.equal(
      before.phase,
      2,
      "Only after ordinary payout may this controlled Court helper be used",
    );
    assert.equal(before.stakerCount, "2");
    assert.equal(before.attendeeCount, "1");
    assert.equal(before.pendingChallenges, "1");
    assert.equal(ch.state, 2);
    assert.equal(ch.isRuled, false);
    assert.equal(before.heldBackWei, before.depositWei);
    assert.equal(before.actors.bob.heldShareWei, before.depositWei);
    assert.equal(before.actors.bob.directAttendancePaidWei, "0");
    assert.equal(
      before.actors.alice.directAttendancePaidWei,
      before.depositWei,
    );
    assert.equal(before.owedTotalWei, "0");
    assert.equal(await c.disputeResolver(), MAINNET_KLEROS.resolver);
    assert.equal(await c.arbitrator(), MAINNET_KLEROS.arbitrator);
    assert(
      ethers.isHexString(
        ch.localDisputeID === null
          ? ""
          : ethers.toBeHex(BigInt(ch.localDisputeID)),
      ),
    );
    assert(ch.arbitratorDisputeID !== null);
    assert.equal(
      await runtime.resolver.externalIDtoLocalID(ch.arbitratorDisputeID),
      BigInt(ch.localDisputeID),
    );
    const resolverCase = await runtime.resolver.disputes(ch.localDisputeID),
      liquidCase = await runtime.liquid.disputes(ch.arbitratorDisputeID);
    assert.equal(
      resolverCase.disputeIDOnArbitratorSide,
      BigInt(ch.arbitratorDisputeID),
    );
    assert.equal(resolverCase.isRuled, false);
    assert.equal(liquidCase.arbitrated, MAINNET_KLEROS.resolver);
    assert.equal(liquidCase.ruled, false);
    const receipt = await send(
        courtOperator,
        {
          to: MAINNET_KLEROS.arbitrator,
          value: 0n,
          data: runtime.liquid.interface.encodeFunctionData("giveFinalRuling", [
            ch.arbitratorDisputeID,
            1,
          ]),
          gasLimit: 1000000n,
        },
        "controlled local Court attended ruling only",
      ),
      after = await financialSnapshot(eventId);
    assert.equal(after.actors.bob.challenge.finalRuling, 1);
    assert.equal(after.actors.bob.challenge.isRuled, true);
    assert.equal(after.actors.bob.challenge.state, 2);
    assert.equal(after.actors.bob.directAttendancePaidWei, "0");
    for (const key of [
      "phase",
      "pendingChallenges",
      "eventBalanceWei",
      "heldBackWei",
      "owedTotalWei",
      "challengeEscrowWei",
      "directAttendancePaidWei",
    ])
      assert.equal(
        after[key],
        before[key],
        "Court delivery must not settle or pay the event",
      );
    const fact = {
      eventId,
      challenger: bob.address,
      localDisputeID: ch.localDisputeID,
      arbitratorDisputeID: ch.arbitratorDisputeID,
      ruling: 1,
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      gasUsed: String(receipt.gasUsed),
      gasPriceWei: String(receipt.gasPrice),
      controlledMockCourt: true,
      eventSettlementPerformed: false,
    };
    stats.controlledCourtTransactions.push(fact);
    return { ...fact, before, after };
  }
  return {
    origin,
    manifest,
    provider: readProvider,
    stats,
    actors: Object.freeze({
      alice: Object.freeze({ address: organizer.address }),
      bob: Object.freeze({ address: bob.address }),
    }),
    organizerAddress: organizer.address,
    forward,
    wallet,
    financialSnapshot,
    timeTo,
    controlledAttendedRuling,
    reviewedDraft: (actor = "alice") =>
      structuredClone(actorState(actor).review),
    armCreation: (id, actor = "alice") => {
      const state = actorState(actor);
      assert.equal(actor, "alice");
      assert(
        state.review &&
          state.review.id === id &&
          state.review.scopeKind === "factory-create",
      );
      state.armed = id;
    },
    armEventDraft: (id, action, actor = "alice") => {
      const state = actorState(actor);
      assert(
        state.review &&
          state.review.id === id &&
          state.review.action === action,
      );
      state.armed = id;
    },
    workbench: () => w,
    savedState: () =>
      fs.existsSync(stateFile)
        ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
        : null,
    restart: async () => {
      await app.close();
      app = null;
      for (const state of actorStates.values()) {
        state.auth = null;
        state.review = null;
        state.armed = null;
      }
      await launch();
    },
    close,
  };
}
