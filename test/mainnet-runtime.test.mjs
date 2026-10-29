import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import {
  MAINNET_PROFILE,
  MAINNET_RUNTIME_READ_METHODS,
  mainnetChain,
  mainnetStateStore,
  validateMainnetManifest,
} from "../src/mainnet-runtime.mjs";
import {
  MAINNET_KLEROS,
  MAINNET_EXTRA_DATA,
} from "../scripts/mainnet/verify-kleros.mjs";

const address = (n) =>
  ethers.getAddress("0x" + n.toString(16).padStart(40, "0"));
const digest = (name) => ethers.id("synthetic-mainnet-runtime-" + name);
const code = (expected) => (error) => error.code === expected;
const clone = (value) => structuredClone(value);
function fixture() {
  const start = 2_000_000_000,
    multisig = address(12);
  const deployment = {
    eventId: "synthetic-production-a",
    chainId: 1,
    contract: address(1),
    contractVersion: MAINNET_PROFILE,
    abiVersion: MAINNET_PROFILE,
    deploymentBlock: 30,
    deploymentTxHash: digest("event-created"),
    codeHash: digest("event-proxy-code"),
    eventName: "Synthetic production A",
    depositWei: "10000000000000000",
    eventStart: start,
    depositDeadline: start,
    depositOpensAt: start - 3600,
    claimDeadline: start + 7 * 86400,
    owner: address(8),
    creator: address(8),
    factory: address(2),
    factoryCodeHash: digest("factory-proxy-code"),
    implementation: address(3),
    implementationCodeHash: digest("event-implementation"),
    factoryImplementation: address(4),
    factoryImplementationCodeHash: digest("factory-implementation"),
    initialImplementation: address(3),
    initialFactoryImplementation: address(4),
    upgradeAuthority: address(5),
    upgradeAuthorityCodeHash: digest("timelock-code"),
    projectMultisig: multisig,
    factoryDeploymentTxHash: digest("factory-created"),
    factoryDeploymentBlock: 20,
    timelockDeploymentTxHash: digest("timelock-created"),
    timelockDeploymentBlock: 10,
    resolver: MAINNET_KLEROS.resolver,
    arbitrator: MAINNET_KLEROS.arbitrator,
    arbitratorExtraData: MAINNET_EXTRA_DATA,
    policyURI: "https://policy.example.invalid/event-a.md",
    templateHash: digest("template"),
    sourceCommit: "synthetic-only",
  };
  return {
    schemaVersion: 1,
    environment: "production",
    provenance: Object.fromEntries(
      [
        ["v9BuildManifestSha256", "manifest"],
        ["v9StandardInputSha256", "standard-input"],
      ].map(([key, name]) => [
        key,
        createHash("sha256")
          .update(
            JSON.stringify(
              JSON.parse(
                fs.readFileSync(
                  new URL(
                    `../build/contracts-v9/${name}.json`,
                    import.meta.url,
                  ),
                  "utf8",
                ),
              ),
            ),
          )
          .digest("hex"),
      ]),
    ),
    chain: {
      chainId: 1,
      name: "Ethereum",
      rpcUrl: "https://ethereum.example.invalid",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
    arbitration: {
      mode: "kleros-v1",
      resolver: MAINNET_KLEROS.resolver,
      arbitrator: MAINNET_KLEROS.arbitrator,
      extraData: MAINNET_EXTRA_DATA,
    },
    governance: {
      kind: "project-multisig",
      multisig,
      expectedCodeHash: digest("multisig-code"),
      minimumDelaySeconds: 172800,
    },
    events: [
      {
        definition: {
          id: deployment.eventId,
          title: deployment.eventName,
          startsAt: new Date(start * 1000).toISOString(),
          endsAt: new Date((start + 3600) * 1000).toISOString(),
          organizers: [deployment.owner],
          staff: [],
          visibility: "private",
        },
        deployment,
        policy: "Synthetic public policy only",
        pieces: ["synthetic"],
        slots: "0x",
      },
    ],
  };
}
function fakeDependencies() {
  const calls = [],
    verified = [],
    courts = [];
  const raw = {
    chainId: "0x1",
    destroyed: 0,
    batches: 0,
    fail: null,
    send: async (method, params) => {
      calls.push({ method, params });
      if (raw.fail && method !== "eth_chainId") throw raw.fail;
      return method === "eth_chainId" ? raw.chainId : "0x7";
    },
    _send: async (payload) => {
      raw.batches++;
      return payload;
    },
    destroy: async () => {
      raw.destroyed++;
    },
  };
  const options = {
    maxAttempts: 1,
    providerFactory: async (endpoint, passed) => {
      raw.endpoint = endpoint;
      assert.equal(passed.maxAttempts, 1);
      return raw;
    },
    verifyCourt: async (input) => {
      courts.push(input);
      assert.equal(await input.transport.request("eth_chainId", []), "0x1");
      return {
        status: "verified-read-only",
        chainId: 1,
        resolver: {
          address: MAINNET_KLEROS.resolver,
          codeHash: MAINNET_KLEROS.resolverCodeHash,
        },
        arbitrator: {
          address: MAINNET_KLEROS.arbitrator,
          codeHash: MAINNET_KLEROS.arbitratorCodeHash,
        },
        upstream: { endpoint: input.transport.endpoint },
      };
    },
    verifyDeployment: async (context, deployment) => {
      verified.push({ context, deployment });
      assert.equal(context.production, true);
      assert.equal(context.chainId, 1);
      assert.equal(context.governance.kind, "project-multisig");
      assert.equal(await context.provider.send("eth_chainId", []), "0x1");
    },
  };
  return { raw, options, calls, verified, courts };
}

test("production manifest rejects wrong environment, profiles, duplicate custody, Court and governance before provider creation", async () => {
  const mutations = [
    (m) => (m.environment = "testnet"),
    (m) => (m.chain.chainId = 10200),
    (m) => (m.chain.nativeCurrency.symbol = "XDAI"),
    (m) => (m.chain.rpcUrl = "http://ethereum.example.invalid"),
    (m) => (m.chain.rpcUrl = "https://user:secret@ethereum.example.invalid"),
    (m) => (m.chain.rpcUrl += "/v3/private-key"),
    (m) => (m.chain.rpcUrl += "?token=secret"),
    (m) => (m.arbitration.mode = "controlled"),
    (m) => (m.arbitration.resolver = address(50)),
    (m) => (m.arbitration.arbitrator = address(51)),
    (m) => (m.governance.kind = "deployer"),
    (m) => (m.governance.minimumDelaySeconds = 172799),
    (m) => (m.governance.expectedCodeHash = ethers.ZeroHash),
    (m) => (m.provenance = undefined),
    (m) => (m.provenance.v9BuildManifestSha256 = "unapproved"),
    (m) => (m.provenance.v9StandardInputSha256 = undefined),
    (m) => (m.provenance.skip = true),
    (m) => (m.events[0].deployment.projectMultisig = address(60)),
    (m) => (m.events[0].deployment.abiVersion = "kleros-event-v8"),
    (m) =>
      (m.events[0].deployment.contractVersion = "kleros-event-v9-uups-other"),
    (m) => (m.events[0].deployment.chainId = 100),
    (m) => (m.events[0].definition.id = "different-event"),
    (m) => (m.events[0].definition.startsAt = new Date(0).toISOString()),
    (m) => (m.events[0].deployment.initialImplementation = undefined),
    (m) =>
      (m.events[0].deployment.implementation = m.events[0].deployment.contract),
    (m) => (m.events[0].deployment.upgradeAuthorityCodeHash = ethers.ZeroHash),
    (m) => m.events.push(clone(m.events[0])),
    (m) => (m.privateKey = "should-never-be-public"),
    (m) => (m.chain.apiKey = "should-never-be-public"),
  ];
  for (const mutate of mutations) {
    const m = fixture();
    mutate(m);
    let providers = 0;
    await assert.rejects(
      mainnetChain(m, undefined, {
        providerFactory: async () => {
          providers++;
          throw Error("must not run");
        },
      }),
    );
    assert.equal(providers, 0);
  }
  assert.equal(
    validateMainnetManifest(fixture()).events[0].deployment.contractVersion,
    MAINNET_PROFILE,
  );
  const cycle = fixture();
  cycle.self = cycle;
  assert.throws(() => validateMainnetManifest(cycle), code("INVALID_MANIFEST"));
});

test("keyless mainnet runtime invokes both verifiers and uses the reviewed actual array resolver ABI", async () => {
  const m = fixture(),
    dependencies = fakeDependencies();
  const chain = await mainnetChain(m, undefined, dependencies.options);
  try {
    assert.equal(chain.production, true);
    assert.equal(chain.chainId, 1);
    assert.equal(chain.financialModel, "v8");
    assert.deepEqual(chain.signers, []);
    assert.equal(chain.rpcUrl, m.chain.rpcUrl);
    assert.deepEqual(chain.governance, m.governance);
    assert.deepEqual(chain.arbitration, m.arbitration);
    assert.equal(dependencies.courts.length, 1);
    assert.equal(dependencies.verified.length, 1);
    assert.deepEqual(
      chain.eventVerification.get(m.events[0].deployment.eventId),
      { status: "verified" },
    );
    assert.equal(chain.resolver.target, MAINNET_KLEROS.resolver);
    assert.equal(chain.liquid.target, MAINNET_KLEROS.arbitrator);
    assert.ok(
      chain.resolver.interface.getFunction(
        "getTotalWithdrawableAmount(uint256,address,uint256[])",
      ),
    );
    assert.equal(
      chain.resolver.interface.getFunction(
        "getTotalWithdrawableAmount(uint256,address,uint256)",
      ),
      null,
    );
    assert.ok(
      chain.resolver.interface.getFunction(
        "withdrawFeesAndRewardsForAllRounds(uint256,address,uint256[])",
      ),
    );
    assert.equal(
      chain.immutableProvenanceCache,
      undefined,
      "Upgradeable identities are not cached as immutable proofs",
    );
    m.events[0].deployment.implementation = address(90);
    assert.notEqual(
      chain.manifest.events[0].deployment.implementation,
      m.events[0].deployment.implementation,
      "Runtime captures the reviewed manifest before awaits",
    );
  } finally {
    await chain.close();
  }
  await chain.close();
  assert.equal(dependencies.raw.destroyed, 1);
  assert.throws(
    () => chain.provider.send("eth_chainId", []),
    code("PROVIDER_CLOSED"),
  );
});

test("all signing, account enumeration, raw batch bypasses and chain drift are blocked before unsafe upstream access", async () => {
  const dependencies = fakeDependencies(),
    chain = await mainnetChain(fixture(), undefined, dependencies.options);
  try {
    for (const method of [
      "eth_sendRawTransaction",
      "eth_sendTransaction",
      "eth_sign",
      "eth_signTransaction",
      "personal_sign",
      "eth_accounts",
      "personal_unlockAccount",
      "wallet_sendCalls",
      "evm_mine",
      "debug_traceTransaction",
      "unknown_method",
    ]) {
      const before = dependencies.calls.length;
      await assert.rejects(
        chain.provider.send(method, []),
        code("FORBIDDEN_METHOD"),
      );
      assert.equal(dependencies.calls.length, before);
    }
    for (const method of ["getSigner", "listAccounts", "broadcastTransaction"])
      await assert.rejects(
        chain.provider[method]("private-data"),
        code("FORBIDDEN_METHOD"),
      );
    await assert.rejects(
      chain.provider._send([
        { method: "eth_chainId", params: [] },
        { method: "eth_sendRawTransaction", params: ["private-data"] },
      ]),
      code("FORBIDDEN_METHOD"),
    );
    assert.equal(dependencies.raw.batches, 0);
    assert.equal(
      await chain.provider.send("eth_getStorageAt", [
        address(1),
        ethers.ZeroHash,
        "latest",
      ]),
      "0x7",
    );
    dependencies.raw.chainId = "0x64";
    const before = dependencies.calls.length;
    await assert.rejects(
      chain.provider.send("eth_getBalance", [address(1), "latest"]),
      code("WRONG_CHAIN"),
    );
    assert.deepEqual(
      dependencies.calls.slice(before).map((call) => call.method),
      ["eth_chainId"],
    );
    assert.ok(MAINNET_RUNTIME_READ_METHODS.includes("eth_getStorageAt"));
    assert.ok(
      !MAINNET_RUNTIME_READ_METHODS.some((method) =>
        /send|sign|personal|wallet|evm|debug/i.test(method),
      ),
    );
  } finally {
    await chain.close();
  }
});

test("private HTTPS overrides stay out of public metadata and error diagnostics, with failed startup cleanup", async () => {
  const secret = "private-runtime-token",
    override = `https://rpc.example.invalid/v3/${secret}?key=${secret}`;
  const dependencies = fakeDependencies(),
    manifest = fixture();
  const chain = await mainnetChain(manifest, override, dependencies.options);
  try {
    assert.equal(dependencies.raw.endpoint, override);
    assert.equal(chain.rpcUrl, manifest.chain.rpcUrl);
    assert.equal(chain.court.upstream.endpoint, manifest.chain.rpcUrl);
    const metadata = {
      rpcUrl: chain.rpcUrl,
      manifest: chain.manifest,
      court: chain.court,
      governance: chain.governance,
      arbitration: chain.arbitration,
    };
    assert.equal(JSON.stringify(metadata).includes(secret), false);
    dependencies.raw.fail = Object.assign(
      new Error(override + " signed-data"),
      { code: "SERVER_ERROR" },
    );
    await assert.rejects(chain.provider.send("eth_getBalance", []), (error) => {
      assert.equal(
        (error.stack + JSON.stringify(error)).includes(secret),
        false,
      );
      assert.equal(error.cause, undefined);
      return true;
    });
  } finally {
    await chain.close();
  }
  for (const invalid of [
    "http://rpc.example.invalid",
    "https://user:secret@rpc.example.invalid",
    "https://rpc.example.invalid/#private",
  ]) {
    let called = false;
    await assert.rejects(
      mainnetChain(fixture(), invalid, {
        providerFactory: () => {
          called = true;
        },
      }),
      code("INVALID_RPC"),
    );
    assert.equal(called, false);
  }
  const failed = fakeDependencies();
  failed.options.verifyCourt = async () => {
    throw Object.assign(new Error(override), { code: "TOKEN_PRIVATE" });
  };
  await assert.rejects(
    mainnetChain(fixture(), override, failed.options),
    (error) => {
      assert.equal(error.code, "MAINNET_VERIFICATION_FAILED");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.equal(failed.raw.destroyed, 1);
});

test("default HTTP transport rejects redirects and remote error disclosure without public requests", async () => {
  const dependency = fakeDependencies(),
    observed = [];
  const secret = "offline-private-rpc-key",
    endpoint = `https://rpc.example.invalid/v3/${secret}?key=${secret}`;
  let failure = null;
  const fetcher = async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    const payload = JSON.parse(options.body),
      batch = Array.isArray(payload) ? payload : [payload];
    observed.push(...batch.map((item) => item.method));
    if (
      failure === "redirect" &&
      batch.some((item) => item.method !== "eth_chainId")
    )
      return { status: 302 };
    const values = batch.map((item) =>
      failure === "rpc" && item.method !== "eth_chainId"
        ? {
            jsonrpc: "2.0",
            id: item.id,
            error: { code: -32602, message: endpoint + " private diagnostics" },
          }
        : {
            jsonrpc: "2.0",
            id: item.id,
            result: item.method === "eth_chainId" ? "0x1" : "0x2a",
          },
    );
    return {
      status: 200,
      json: async () => (Array.isArray(payload) ? values : values[0]),
    };
  };
  const chain = await mainnetChain(fixture(), endpoint, {
    fetcher,
    maxAttempts: 1,
    verifyCourt: dependency.options.verifyCourt,
    verifyDeployment: dependency.options.verifyDeployment,
  });
  try {
    assert.equal(await chain.provider.getBalance(address(1)), 42n);
    const count = observed.length;
    await assert.rejects(
      chain.provider._send({
        id: 99,
        method: "eth_sendRawTransaction",
        params: ["forbidden"],
      }),
      code("FORBIDDEN_METHOD"),
    );
    assert.equal(observed.length, count);
    for (const mode of ["rpc", "redirect"]) {
      failure = mode;
      await assert.rejects(
        chain.provider.send("eth_getBalance", [address(1), "latest"]),
        (error) => {
          assert.equal(
            (error.stack + JSON.stringify(error)).includes(secret),
            false,
          );
          assert.equal(error.cause, undefined);
          return true;
        },
      );
    }
    assert.ok(
      observed.every((method) => MAINNET_RUNTIME_READ_METHODS.includes(method)),
    );
  } finally {
    await chain.close();
  }
});

test("wrong network or invalid court evidence cannot reach deployment verification, and skip flags are unsupported", async () => {
  const wrong = fakeDependencies();
  wrong.raw.chainId = "0x27d8";
  await assert.rejects(
    mainnetChain(fixture(), undefined, wrong.options),
    code("WRONG_CHAIN"),
  );
  assert.equal(wrong.verified.length, 0);
  assert.equal(wrong.raw.destroyed, 1);
  const bad = fakeDependencies();
  bad.options.verifyCourt = async () => ({
    status: "verified-read-only",
    chainId: 1,
    resolver: { address: MAINNET_KLEROS.resolver, codeHash: ethers.ZeroHash },
    arbitrator: { address: MAINNET_KLEROS.arbitrator },
  });
  await assert.rejects(
    mainnetChain(fixture(), undefined, bad.options),
    code("WRONG_ARBITRATION"),
  );
  assert.equal(bad.verified.length, 0);
  assert.equal(bad.raw.destroyed, 1);
  for (const options of [
    { skipVerification: true },
    { skipCourt: true },
    { timeoutMs: 0 },
    { maxAttempts: 6 },
    { verifyDeployment: "disabled" },
  ])
    await assert.rejects(
      mainnetChain(fixture(), undefined, options),
      code("INVALID_INPUT"),
    );
});

function twoEventFixture() {
  const m = fixture(),
    b = clone(m.events[0]);
  b.definition.id = b.deployment.eventId = "synthetic-production-b";
  b.definition.title = b.deployment.eventName = "Synthetic production B";
  b.deployment.contract = address(90);
  m.events.push(b);
  return m;
}

test("one unavailable event preserves verified B and keyless read-only recovery without softening global gates", async () => {
  const manifest = twoEventFixture(),
    dep = fakeDependencies(),
    checked = [];
  dep.options.verifyDeployment = async (context, d) => {
    checked.push(d.eventId);
    if (d.eventId === manifest.events[0].definition.id)
      throw Object.assign(
        new Error("private RPC diagnostics must not escape"),
        {
          code: "UNREVIEWED_UPGRADE_HISTORY",
          cause: { secret: "private cause" },
        },
      );
    assert.equal(context.production, true);
  };
  const chain = await mainnetChain(manifest, undefined, dep.options);
  try {
    assert.deepEqual(
      checked,
      manifest.events.map((r) => r.definition.id),
    );
    assert.deepEqual(
      [...chain.eventVerification],
      [
        [
          manifest.events[0].definition.id,
          { status: "unavailable", code: "UNREVIEWED_UPGRADE_HISTORY" },
        ],
        [manifest.events[1].definition.id, { status: "verified" }],
      ],
    );
    assert.deepEqual(chain.signers, []);
    assert.equal(
      await chain.provider.send("eth_getTransactionReceipt", [
        digest("known hash"),
      ]),
      "0x7",
    );
    await assert.rejects(
      chain.provider.send("eth_sendRawTransaction", ["forbidden"]),
      code("FORBIDDEN_METHOD"),
    );
    assert.equal(
      JSON.stringify([...chain.eventVerification]).includes("private"),
      false,
    );
    assert.equal(dep.calls.at(-1).method, "eth_getTransactionReceipt");
  } finally {
    await chain.close();
  }
});

test("all unavailable events still permit only keyless recovery and retry each deployment on the next runtime", async () => {
  const manifest = twoEventFixture(),
    dep = fakeDependencies();
  let checks = 0;
  dep.options.verifyDeployment = async () => {
    checks++;
    throw Object.assign(new Error("unavailable"), { code: "WRONG_CONTRACT" });
  };
  const first = await mainnetChain(manifest, undefined, dep.options);
  assert.equal(
    [...first.eventVerification.values()].every(
      (entry) => entry.status === "unavailable",
    ),
    true,
  );
  assert.equal(
    [...first.eventVerification.values()].some(
      (entry) => entry.status === "verified",
    ),
    false,
  );
  assert.deepEqual(first.signers, []);
  assert.equal(
    dep.calls.at(-1).method,
    "eth_chainId",
    "final network gate is mandatory even when all events failed",
  );
  await first.close();
  const next = fakeDependencies();
  next.options.verifyDeployment = async () => {
    checks++;
  };
  const second = await mainnetChain(manifest, undefined, next.options);
  try {
    assert.equal(checks, 4);
    assert.equal(
      [...second.eventVerification.values()].every(
        (entry) => entry.status === "verified",
      ),
      true,
    );
  } finally {
    await second.close();
  }
});

test("source approval, unknown verifier errors and chain drift always abort the whole runtime", async () => {
  const staticFailure = fakeDependencies(),
    changed = fixture();
  changed.provenance.v9BuildManifestSha256 = "f".repeat(64);
  await assert.rejects(
    mainnetChain(changed, undefined, staticFailure.options),
    code("V9_ARTIFACT_PROVENANCE"),
  );
  assert.equal(staticFailure.calls.length, 0);
  assert.equal(staticFailure.courts.length, 0);
  for (const failure of [
    new Error("unreviewed build inputs"),
    Object.assign(new Error("unreviewed source"), {
      code: "V9_ARTIFACT_PROVENANCE",
    }),
    Object.assign(new Error("wrong chain"), { code: "WRONG_CHAIN" }),
  ]) {
    const dep = fakeDependencies();
    dep.options.verifyDeployment = async () => {
      throw failure;
    };
    await assert.rejects(
      mainnetChain(twoEventFixture(), undefined, dep.options),
    );
    assert.equal(dep.raw.destroyed, 1);
  }
  const drift = fakeDependencies();
  drift.options.verifyDeployment = async () => {
    drift.raw.chainId = "0x64";
    throw Object.assign(new Error("unavailable event"), {
      code: "IMPLEMENTATION_CHANGED",
    });
  };
  await assert.rejects(
    mainnetChain(twoEventFixture(), undefined, drift.options),
    code("WRONG_CHAIN"),
  );
  assert.equal(drift.raw.destroyed, 1);
});

function storedRecord(manifest) {
  const record = clone(manifest.events[0]);
  return {
    ...record,
    revision: 1,
    observations: [],
    batches: [],
    transactions: [],
    participants: new Map([
      [
        "synthetic-person",
        {
          id: "synthetic-person",
          wallet: address(30),
          name: "Synthetic Alice",
        },
      ],
    ]),
    personal: new Map(),
    publications: new Map(),
    nonces: new Set(["synthetic-nonce"]),
  };
}
test("production state is atomic, owner-only, restart-stable and bound to every reviewed manifest field", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "mainnet-runtime-state-"),
  );
  try {
    const manifest = fixture(),
      filename = path.join(temporary, "private", "state.json"),
      record = storedRecord(manifest);
    const store = mainnetStateStore(filename, manifest),
      records = new Map([[record.deployment.eventId, record]]);
    assert.equal(store.load(), null);
    store.save(records, new Map());
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    const saved = mainnetStateStore(filename, clone(manifest)).load();
    assert.equal(saved.environment, "production");
    assert.equal(saved.chainId, 1);
    assert.equal(saved.events[0].participants[0][1].name, "Synthetic Alice");
    for (const mutate of [
      (m) => (m.chain.rpcUrl = "https://other.example.invalid"),
      (m) => (m.events[0].deployment.codeHash = digest("other-code")),
      (m) => (m.governance.minimumDelaySeconds = 259200),
      (m) => (m.events[0].definition.visibility = "public"),
      (m) => (m.provenance.v9BuildManifestSha256 = "f".repeat(64)),
    ]) {
      const changed = clone(manifest);
      mutate(changed);
      const changedStore = mainnetStateStore(filename, changed);
      assert.throws(() => changedStore.load(), code("STATE_SCOPE"));
      assert.throws(
        () => changedStore.save(records, new Map()),
        code("STATE_SCOPE"),
      );
    }
    const before = fs.readFileSync(filename);
    assert.throws(
      () => store.save(new Map([["wrong-key", record]]), new Map()),
      code("STATE_SCOPE"),
    );
    assert.deepEqual(fs.readFileSync(filename), before);
    fs.chmodSync(filename, 0o644);
    assert.throws(() => store.load(), code("STATE_PERMISSIONS"));
    assert.throws(
      () => store.save(records, new Map()),
      code("STATE_PERMISSIONS"),
    );
    fs.chmodSync(filename, 0o600);
    const link = path.join(temporary, "link.json");
    fs.symlinkSync(filename, link);
    assert.throws(
      () => mainnetStateStore(link, manifest).load(),
      code("STATE_PERMISSIONS"),
    );
    assert.throws(
      () => mainnetStateStore(link, manifest).save(records, new Map()),
      code("STATE_PERMISSIONS"),
    );
    fs.writeFileSync(filename, '{"privatePayload":"malformed', { mode: 0o600 });
    assert.throws(
      () => store.load(),
      (error) =>
        error.code === "STATE_INVALID" &&
        !error.message.includes("privatePayload"),
    );
    assert.deepEqual(
      fs.readdirSync(path.dirname(filename)),
      ["state.json"],
      "No incomplete temporary state remains",
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
