// Scripted read-only RPC/temporary state fixtures only: no wallets, signatures or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import {
  V9_TESTNET_PROFILE,
  V9_TESTNET_MODE,
  V9_TESTNET_EXTRA_DATA,
  verifyControlledV9Artifacts,
  verifyV9TestnetCourt,
  validateV9TestnetManifest,
  v9TestnetChain,
  v9TestnetStateStore,
} from "../src/v9-testnet-runtime.mjs";

const addr = (n) => ethers.getAddress("0x" + n.toString(16).padStart(40, "0"));
const h = (name) => ethers.id("scripted-v9-testnet-" + name);
const canonicalSha = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const controlledPins = () => ({
  mockSourceSha256: createHash("sha256")
    .update(
      fs.readFileSync(
        new URL("../references/kickback/test/MockKleros.sol", import.meta.url),
      ),
    )
    .digest("hex"),
  mockArtifactsSha256: Object.fromEntries(
    ["MockKlerosLiquid", "MockArbitrableProxy"].map((name) => [
      name,
      canonicalSha(json(`references/kickback/build/${name}.json`)),
    ]),
  ),
});
const code = (expected) => (error) => error.code === expected;

function courtFixture() {
  const artifacts = verifyControlledV9Artifacts(controlledPins());
  const creator = addr(7),
    addresses = {
      resolver: ethers.getCreateAddress({ from: creator, nonce: 2 }),
      arbitrator: ethers.getCreateAddress({ from: creator, nonce: 1 }),
    };
  const a = {
    mode: "controlled",
    ...addresses,
    extraData: V9_TESTNET_EXTRA_DATA,
    resolverCodeHash: ethers.keccak256("0x6001"),
    arbitratorCodeHash: ethers.keccak256("0x6000"),
    resolverDeploymentTxHash: h("resolver-birth"),
    arbitratorDeploymentTxHash: h("arbitrator-birth"),
    resolverDeploymentBlock: 3,
    arbitratorDeploymentBlock: 2,
  };
  const txs = new Map(),
    receipts = new Map(),
    calls = [];
  const blocks = new Map(
    [2, 3, 50].map((number) => [
      number,
      { number, hash: h(`block-${number}`), timestamp: 2_000_000_000 + number },
    ]),
  );
  for (const [name, artifact, args, nonce] of [
    ["arbitrator", artifacts.MockKlerosLiquid, [], 1],
    ["resolver", artifacts.MockArbitrableProxy, [a.arbitrator], 2],
  ]) {
    const txHash = a[`${name}DeploymentTxHash`],
      number = a[`${name}DeploymentBlock`];
    txs.set(txHash, {
      hash: txHash,
      from: creator,
      nonce,
      to: null,
      value: 0n,
      chainId: 10200n,
      blockNumber: number,
      blockHash: blocks.get(number).hash,
      data:
        artifact.bytecode +
        new ethers.Interface(artifact.abi).encodeDeploy(args).slice(2),
    });
    receipts.set(txHash, {
      hash: txHash,
      status: 1,
      blockNumber: number,
      blockHash: blocks.get(number).hash,
      contractAddress: a[name],
    });
  }
  const resolver = new ethers.Interface(artifacts.MockArbitrableProxy.abi),
    liquid = new ethers.Interface(artifacts.MockKlerosLiquid.abi);
  const provider = {
    send: async (method) => {
      calls.push(method);
      assert.equal(method, "eth_chainId");
      return "0x27d8";
    },
    getBlock: async (tag) => {
      calls.push("getBlock");
      return blocks.get(tag === "latest" ? 50 : tag);
    },
    getTransaction: async (txHash) => {
      calls.push("getTransaction");
      return txs.get(txHash);
    },
    getTransactionReceipt: async (txHash) => {
      calls.push("getTransactionReceipt");
      return receipts.get(txHash);
    },
    getCode: async (address, block) => {
      calls.push("getCode");
      assert.equal(block, 50);
      return address.toLowerCase() === a.resolver.toLowerCase()
        ? "0x6001"
        : "0x6000";
    },
    call: async (tx) => {
      calls.push("call");
      assert.equal(tx.blockTag, 50);
      const iface =
        tx.to.toLowerCase() === a.resolver.toLowerCase() ? resolver : liquid;
      const parsed = iface.parseTransaction(tx);
      return iface.encodeFunctionResult(
        parsed.name,
        parsed.name === "arbitrator"
          ? [a.arbitrator]
          : parsed.name === "getMultipliers"
            ? [10000, 20000, 5000, 10000]
            : [30_000_000_000n],
      );
    },
  };
  return {
    context: { provider, arbitration: a },
    artifacts,
    calls,
    txs,
    receipts,
    blocks,
  };
}

test("normal V9 controlled test alias and approved legacy mock artifacts are explicit and compiler-free", () => {
  assert.equal(V9_TESTNET_PROFILE, "kleros-event-v9-uups-chiado");
  assert.equal(V9_TESTNET_MODE, "hosted-v9-testnet");
  const pins = controlledPins();
  assert.ok(
    verifyControlledV9Artifacts(pins).MockArbitrableProxy.abi.length > 0,
  );
  for (const mutate of [
    (p) => (p.mockSourceSha256 = "f".repeat(64)),
    (p) => (p.mockArtifactsSha256.MockKlerosLiquid = "e".repeat(64)),
    (p) => delete p.mockArtifactsSha256.MockArbitrableProxy,
  ]) {
    const changed = structuredClone(pins);
    mutate(changed);
    assert.throws(
      () => verifyControlledV9Artifacts(changed),
      code("CONTROLLED_ARTIFACT_PROVENANCE"),
    );
  }
});

test("controlled Court proves exact constructor calldata, canonical births, current code/link/multipliers at one head", async () => {
  const f = courtFixture(),
    result = await verifyV9TestnetCourt(f.context, f.artifacts);
  assert.equal(result.status, "verified-controlled");
  assert.equal(result.chainId, 10200);
  assert.equal(result.arbitrationCostWei, "30000000000");
  assert.deepEqual(result.block, f.blocks.get(50));
  assert.ok(
    f.calls.every((method) =>
      [
        "eth_chainId",
        "getBlock",
        "getTransaction",
        "getTransactionReceipt",
        "getCode",
        "call",
      ].includes(method),
    ),
  );
});

test("controlled Court refuses another network, wrong constructor/runtime/link and late canonical reorg", async () => {
  for (const kind of [
    "chain",
    "constructor",
    "receipt",
    "runtime",
    "link",
    "reorg",
  ]) {
    const f = courtFixture(),
      p = f.context.provider;
    if (kind === "chain") p.send = async () => "0x1";
    if (kind === "constructor")
      f.txs.get(f.context.arbitration.resolverDeploymentTxHash).data += "00";
    if (kind === "receipt")
      f.receipts.get(
        f.context.arbitration.arbitratorDeploymentTxHash,
      ).blockHash = h("orphan");
    if (kind === "runtime") p.getCode = async () => "0x6002";
    if (kind === "link")
      p.call = async (tx) =>
        new ethers.Interface(
          f.artifacts.MockArbitrableProxy.abi,
        ).encodeFunctionResult("arbitrator", [addr(9)]);
    if (kind === "reorg") {
      const original = p.getBlock;
      let heads = 0;
      p.getBlock = async (tag) => {
        const b = await original(tag);
        return tag === 50 && ++heads >= 1 ? { ...b, hash: h("reorg") } : b;
      };
    }
    await assert.rejects(verifyV9TestnetCourt(f.context, f.artifacts));
  }
});

function manifestFixture() {
  const { arbitration } = courtFixture().context,
    start = 2_000_003_600;
  const d = {
    eventId: "synthetic-v9-chiado-e",
    chainId: 10200,
    contractVersion: V9_TESTNET_PROFILE,
    abiVersion: V9_TESTNET_PROFILE,
    contract: addr(40),
    owner: addr(41),
    creator: addr(41),
    initialUpgradeOwner: addr(41),
    factory: addr(42),
    implementation: addr(43),
    factoryImplementation: addr(44),
    initialImplementation: addr(43),
    initialFactoryImplementation: addr(44),
    upgradeAuthority: addr(45),
    codeHash: h("proxy-code"),
    factoryCodeHash: h("factory-code"),
    implementationCodeHash: h("event-implementation"),
    factoryImplementationCodeHash: h("factory-implementation"),
    upgradeAuthorityCodeHash: h("timelock-code"),
    deploymentTxHash: h("event-birth"),
    factoryDeploymentTxHash: h("factory-birth"),
    timelockDeploymentTxHash: h("timelock-birth"),
    eventKey: h("key"),
    factoryEventId: h("factory-id"),
    configurationHash: h("configuration"),
    templateHash: canonicalSha([["synthetic"], "0x"]),
    deploymentBlock: 10,
    factoryDeploymentBlock: 8,
    timelockDeploymentBlock: 5,
    eventName: "Synthetic controlled V9 E",
    eventStart: start,
    claimDeadline: start + 7 * 86400,
    depositOpensAt: start - 3600,
    depositDeadline: start,
    depositWei: "1000000000000",
    resolver: arbitration.resolver,
    arbitrator: arbitration.arbitrator,
    arbitratorExtraData: V9_TESTNET_EXTRA_DATA,
    policyURI: "https://example.invalid/policies/synthetic-v9-testnet.md",
  };
  return {
    environment: "testnet",
    mode: V9_TESTNET_MODE,
    chain: {
      chainId: 10200,
      name: "Chiado",
      rpcUrl: "https://chiado.example.invalid",
      nativeCurrency: { name: "Chiado xDAI", symbol: "XDAI", decimals: 18 },
    },
    arbitration,
    governance: {
      kind: "single-owner-timelock",
      initialOwner: addr(41),
      minimumDelaySeconds: 172800,
    },
    provenance: {
      v9BuildManifestSha256: canonicalSha(
        json("build/contracts-v9/manifest.json"),
      ),
      v9StandardInputSha256: canonicalSha(
        json("build/contracts-v9/standard-input.json"),
      ),
    },
    controlledProvenance: controlledPins(),
    events: [
      {
        definition: {
          id: d.eventId,
          title: d.eventName,
          startsAt: new Date(start * 1000).toISOString(),
          endsAt: new Date((start + 12 * 3600) * 1000).toISOString(),
          visibility: "private",
          organizers: [d.owner],
          staff: [],
        },
        deployment: d,
        policy: "Synthetic test policy",
        pieces: ["synthetic"],
        slots: "0x",
      },
    ],
  };
}

function dependencies(manifest) {
  const calls = [],
    checks = [],
    raw = {
      chainId: "0x27d8",
      destroyed: 0,
      endpoint: null,
      send: async (method, params) => {
        calls.push([method, params]);
        return method === "eth_chainId" ? raw.chainId : "0x7";
      },
      _send: async (payload) => {
        calls.push(["raw-batch", payload]);
        return payload;
      },
      destroy: async () => {
        raw.destroyed++;
      },
    };
  let sources = 0;
  const options = {
    maxAttempts: 1,
    providerFactory: async (rpc) => {
      raw.endpoint = rpc;
      return raw;
    },
    verifyArtifactSources: (provenance) => {
      sources++;
      assert.deepEqual(provenance, manifest.provenance);
    },
    verifyCourt: async (context) => ({
      status: "verified-controlled",
      chainId: 10200,
      resolver: {
        address: context.arbitration.resolver,
        codeHash: context.arbitration.resolverCodeHash,
      },
      arbitrator: {
        address: context.arbitration.arbitrator,
        codeHash: context.arbitration.arbitratorCodeHash,
      },
    }),
    verifyDeployment: async (context, d) => {
      checks.push(d.eventId);
      assert.equal(context.production, false);
      assert.equal(context.testnet, true);
      assert.equal(context.chainId, 10200);
    },
  };
  return { options, raw, calls, checks, sources: () => sources };
}

test("strict new alias/chain/governance manifest rejects production and historical test scopes before provider creation", async () => {
  for (const mutate of [
    (m) => (m.environment = "production"),
    (m) => (m.mode = "hosted-production"),
    (m) => (m.chain.chainId = 1),
    (m) => (m.chain.nativeCurrency.symbol = "ETH"),
    (m) => (m.chain.rpcUrl = "http://chiado.example.invalid"),
    (m) => (m.chain.rpcUrl += "/secret-path"),
    (m) => (m.chain.rpcUrl += "?key=secret"),
    (m) => (m.arbitration.mode = "kleros-v1"),
    (m) => delete m.arbitration.resolverDeploymentTxHash,
    (m) => (m.governance.kind = "controlled-test-governor"),
    (m) => (m.governance.kind = "project-multisig"),
    (m) => (m.governance.minimumDelaySeconds = 900),
    (m) => (m.governance.multisig = addr(2)),
    (m) => (m.events[0].deployment.contractVersion = "kleros-event-v9-uups"),
    (m) => (m.events[0].deployment.abiVersion = "kleros-event-v8-test15m"),
    (m) => (m.events[0].deployment.chainId = 1),
    (m) => (m.events[0].deployment.initialUpgradeOwner = addr(88)),
    (m) => (m.events[0].deployment.projectMultisig = addr(88)),
    (m) =>
      (m.events[0].deployment.claimDeadline =
        m.events[0].deployment.eventStart + 900),
    (m) => m.events.push(structuredClone(m.events[0])),
    (m) => (m.privateKey = "never-public"),
    (m) => (m.provenance.v9BuildManifestSha256 = "unreviewed"),
  ]) {
    const m = manifestFixture();
    mutate(m);
    let providers = 0;
    await assert.rejects(
      v9TestnetChain(m, undefined, {
        providerFactory: async () => {
          providers++;
        },
      }),
    );
    assert.equal(providers, 0);
  }
  const m = manifestFixture();
  assert.equal(
    validateV9TestnetManifest(m).events[0].deployment.contractVersion,
    V9_TESTNET_PROFILE,
  );
});

test("new runtime verifies globally, has no signer/mutable RPC, checks Chiado afresh and isolates unavailable events", async () => {
  const m = manifestFixture(),
    second = structuredClone(m.events[0]);
  second.definition.id = second.deployment.eventId = "synthetic-v9-chiado-f";
  second.deployment.contract = addr(90);
  m.events.push(second);
  const d = dependencies(m);
  d.options.verifyDeployment = async (_context, deployment) => {
    d.checks.push(deployment.eventId);
    if (deployment.eventId === m.events[0].definition.id)
      throw Object.assign(new Error("private RPC details"), {
        code: "IMPLEMENTATION_CHANGED",
      });
  };
  const chain = await v9TestnetChain(
    m,
    "https://chiado.example.invalid/v3/private?key=hidden",
    d.options,
  );
  try {
    assert.equal(d.sources(), 1);
    assert.deepEqual(
      d.checks,
      m.events.map((r) => r.definition.id),
    );
    assert.deepEqual(chain.eventVerification.get(m.events[0].definition.id), {
      status: "unavailable",
      code: "IMPLEMENTATION_CHANGED",
    });
    assert.deepEqual(chain.eventVerification.get(second.definition.id), {
      status: "verified",
    });
    assert.deepEqual(chain.signers, []);
    assert.equal(chain.production, false);
    assert.equal(chain.financialModel, "v8");
    assert.equal(chain.rpcUrl, m.chain.rpcUrl);
    assert.equal(
      JSON.stringify({ manifest: chain.manifest, court: chain.court }).includes(
        "hidden",
      ),
      false,
    );
    for (const method of [
      "eth_sendTransaction",
      "eth_sendRawTransaction",
      "eth_sign",
      "personal_sign",
      "eth_accounts",
      "evm_increaseTime",
      "wallet_switchEthereumChain",
      "debug_traceTransaction",
    ]) {
      const before = d.calls.length;
      await assert.rejects(
        chain.provider.send(method, []),
        code("FORBIDDEN_METHOD"),
      );
      assert.equal(d.calls.length, before);
    }
    for (const name of ["getSigner", "listAccounts", "broadcastTransaction"])
      await assert.rejects(chain.provider[name](), code("FORBIDDEN_METHOD"));
    await assert.rejects(
      chain.provider._send([
        { id: 7, method: "eth_sendRawTransaction", params: [] },
      ]),
      code("FORBIDDEN_METHOD"),
    );
    assert.equal(
      await chain.provider.send("eth_getTransactionReceipt", [h("known")]),
      "0x7",
    );
    d.raw.chainId = "0x1";
    await assert.rejects(
      chain.provider.send("eth_getBalance", [addr(1), "latest"]),
      code("WRONG_CHAIN"),
    );
  } finally {
    await chain.close();
    await chain.close();
  }
  assert.equal(d.raw.destroyed, 1);
  assert.throws(
    () => chain.provider.send("eth_chainId", []),
    code("PROVIDER_CLOSED"),
  );
});

test("global source/Court/chain failure and unknown deployment errors abort with cleanup and redaction", async () => {
  for (const kind of ["source", "court", "chain", "unknown", "late-chain"]) {
    const m = manifestFixture(),
      d = dependencies(m),
      secret = "hidden-private-key-url";
    if (kind === "source")
      d.options.verifyArtifactSources = () => {
        throw Object.assign(new Error(secret), {
          code: "V9_ARTIFACT_PROVENANCE",
        });
      };
    if (kind === "court")
      d.options.verifyCourt = async () => {
        throw new Error(secret);
      };
    if (kind === "chain") d.raw.chainId = "0x1";
    if (kind === "unknown")
      d.options.verifyDeployment = async () => {
        throw new Error(secret);
      };
    if (kind === "late-chain")
      d.options.verifyDeployment = async () => {
        d.raw.chainId = "0x1";
        throw Object.assign(new Error(secret), { code: "WRONG_CONTRACT" });
      };
    await assert.rejects(v9TestnetChain(m, undefined, d.options), (error) => {
      return (
        !error.message.includes(secret) &&
        (kind !== "source" || error.code === "V9_ARTIFACT_PROVENANCE")
      );
    });
    assert.equal(d.raw.destroyed, kind === "source" ? 0 : 1);
  }
});

test("default HTTP transport independently enforces chain10200 and redacts private override errors", async () => {
  const m = manifestFixture(),
    d = dependencies(m),
    seen = [],
    rpc = "https://chiado.example.invalid/v3/secret?key=hidden";
  let bad = false;
  const fetcher = async (url, init) => {
    assert.equal(url, rpc);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const request = JSON.parse(init.body),
      list = Array.isArray(request) ? request : [request];
    seen.push(...list.map((item) => item.method));
    const values = list.map((item) => ({
      jsonrpc: "2.0",
      id: item.id,
      ...(bad && item.method !== "eth_chainId"
        ? { error: { code: -32602, message: rpc } }
        : { result: item.method === "eth_chainId" ? "0x27d8" : "0x2a" }),
    }));
    return {
      status: 200,
      json: async () => (Array.isArray(request) ? values : values[0]),
    };
  };
  delete d.options.providerFactory;
  const chain = await v9TestnetChain(m, rpc, { ...d.options, fetcher });
  try {
    assert.equal(await chain.provider.getBalance(addr(1)), 42n);
    bad = true;
    await assert.rejects(
      chain.provider.send("eth_getBalance", [addr(1), "latest"]),
      (error) => !(error.stack + JSON.stringify(error)).includes("hidden"),
    );
    assert.ok(
      seen.every((method) =>
        ["eth_chainId", "eth_getBalance"].includes(method),
      ),
    );
  } finally {
    await chain.close();
  }
});

test("V9 Chiado private state is0600, restart-stable and cannot cross another manifest/profile/environment", () => {
  const m = manifestFixture(),
    temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-v9-chiado-state-"),
    );
  try {
    const filename = path.join(temporary, "state.json"),
      record = {
        ...m.events[0],
        revision: 1,
        observations: [],
        batches: [],
        transactions: [],
        participants: new Map([["synthetic", { name: "Synthetic Alice" }]]),
        personal: new Map(),
        publications: new Map(),
        nonces: new Set(),
      };
    const store = v9TestnetStateStore(filename, m),
      records = new Map([[record.definition.id, record]]);
    assert.equal(store.load(), null);
    store.save(records, new Map());
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.equal(
      v9TestnetStateStore(filename, structuredClone(m)).load().events[0]
        .participants[0][1].name,
      "Synthetic Alice",
    );
    const changed = structuredClone(m);
    changed.chain.rpcUrl = "https://other.example.invalid";
    assert.throws(
      () => v9TestnetStateStore(filename, changed).load(),
      code("STATE_SCOPE"),
    );
    const saved = jsonTemp(filename);
    saved.contractVersion = "kleros-event-v9-uups";
    fs.writeFileSync(filename, JSON.stringify(saved), { mode: 0o600 });
    assert.throws(() => store.load(), code("STATE_SCOPE"));
    fs.rmSync(filename);
    store.save(records, new Map());
    const link = path.join(temporary, "link.json");
    fs.symlinkSync(filename, link);
    assert.throws(
      () => v9TestnetStateStore(link, m).load(),
      code("STATE_PERMISSIONS"),
    );
    fs.chmodSync(filename, 0o644);
    assert.throws(() => store.load(), code("STATE_PERMISSIONS"));
    fs.chmodSync(filename, 0o600);
    const before = fs.readFileSync(filename);
    assert.throws(
      () => store.save(new Map([["wrong-event", record]]), new Map()),
      code("STATE_SCOPE"),
    );
    assert.deepEqual(fs.readFileSync(filename), before);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
function jsonTemp(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}
