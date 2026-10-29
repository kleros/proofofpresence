import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { ethers } from "ethers";
import ganache from "ganache";
import {
  MAINNET_PROFILE,
  MAINNET_RUNTIME_READ_METHODS,
  mainnetChain,
  mainnetStateStore,
  validateMainnetManifest,
  validateMainnetDynamicEvent,
} from "../src/mainnet-runtime.mjs";
import { hash } from "../src/utils.mjs";
import {
  eventV9LumaTemplate,
  V9_LUMA_ATTENDANCE_STANDARD,
} from "../src/contracts-v9-luma.mjs";
import { loadUpgradeableArtifacts } from "../src/upgrade-verification.mjs";
import {
  MAINNET_KLEROS,
  MAINNET_EXTRA_DATA,
} from "../scripts/mainnet/verify-kleros.mjs";
import {
  prepareCaseArtifact,
  MAINNET_CASE_PUBLICATION,
} from "../src/mainnet-case-publication.mjs";
import { ipfsPathOf } from "../references/kickback/scripts/lib.mjs";

const address = (n) =>
  ethers.getAddress("0x" + n.toString(16).padStart(40, "0"));
const digest = (name) => ethers.id("synthetic-mainnet-runtime-" + name);
const code = (expected) => (error) => error.code === expected;
const clone = (value) => structuredClone(value);
function fixture() {
  const start = 2_000_000_000,
    initialOwner = address(12);
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
    initialUpgradeOwner: initialOwner,
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
      kind: "single-owner-timelock",
      initialOwner,
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
      assert.equal(context.governance.kind, "single-owner-timelock");
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
    (m) => (m.governance.initialOwner = ethers.ZeroAddress),
    (m) => (m.provenance = undefined),
    (m) => (m.provenance.v9BuildManifestSha256 = "unapproved"),
    (m) => (m.provenance.v9StandardInputSha256 = undefined),
    (m) => (m.provenance.skip = true),
    (m) => (m.events[0].deployment.initialUpgradeOwner = address(60)),
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

function factoryFixture() {
  const m = fixture(),
    d = m.events[0].deployment;
  const fields = [
    "contractVersion",
    "abiVersion",
    "chainId",
    "factory",
    "factoryCodeHash",
    "factoryImplementation",
    "factoryImplementationCodeHash",
    "initialFactoryImplementation",
    "initialImplementation",
    "implementation",
    "implementationCodeHash",
    "upgradeAuthority",
    "upgradeAuthorityCodeHash",
    "initialUpgradeOwner",
    "factoryDeploymentTxHash",
    "factoryDeploymentBlock",
    "timelockDeploymentTxHash",
    "timelockDeploymentBlock",
  ];
  m.factoryDeployment = Object.fromEntries(
    fields.map((name) => [name, d[name]]),
  );
  m.events = [];
  return m;
}

test("factory-only chain1 startup verifies the reviewed empty factory without child identities or server signers", async () => {
  const m = factoryFixture(),
    d = fakeDependencies();
  let factories = 0;
  d.options.verifyFactory = async (chain, factory, scope) => {
    factories++;
    assert.equal(scope.chainId, 1);
    assert.equal(scope.profile, MAINNET_PROFILE);
    assert.equal(chain.production, true);
    assert.deepEqual(factory, m.factoryDeployment);
    assert.equal(factory.contract, undefined);
    return {
      anchor: { number: 50, hash: digest("head") },
      deploymentTrust: { status: "verified" },
      eventImplementation: factory.implementation,
      upgrade: { governanceKind: "single-owner-timelock" },
    };
  };
  const chain = await mainnetChain(m, undefined, d.options);
  try {
    assert.equal(factories, 1);
    assert.equal(d.courts.length, 1);
    assert.equal(d.verified.length, 0);
    assert.equal(chain.verifiedFactory, true);
    assert.deepEqual(chain.factoryDeployment, m.factoryDeployment);
    assert.equal(chain.factoryTrust.deploymentTrust.status, "verified");
    assert.equal(chain.eventVerification.size, 0);
    assert.deepEqual(chain.signers, []);
    assert.equal(d.calls.at(-1).method, "eth_chainId");
  } finally {
    await chain.close();
  }
  for (const mutate of [
    (f) => (f.chainId = 10200),
    (f) => (f.contractVersion = "kleros-event-v9-uups-chiado"),
    (f) => (f.initialUpgradeOwner = address(90)),
    (f) => delete f.factoryDeploymentTxHash,
    (f) => (f.projectMultisig = address(99)),
  ]) {
    const invalid = factoryFixture();
    mutate(invalid.factoryDeployment);
    assert.throws(() => validateMainnetManifest(invalid));
  }
  const missing = factoryFixture();
  delete missing.factoryDeployment;
  assert.throws(() => validateMainnetManifest(missing));
});

test("factory-only startup cannot soften unverified factory results, source gates or wrong-chain failures", async () => {
  for (const kind of ["rejected", "false-positive", "wrong-default", "chain"]) {
    const m = factoryFixture(),
      d = fakeDependencies();
    d.options.verifyFactory = async (_chain, f) => {
      if (kind === "rejected")
        throw Object.assign(new Error("private RPC diagnostic"), {
          code: "DEPLOYMENT_MISMATCH",
        });
      if (kind === "chain") d.raw.chainId = "0x27d8";
      return {
        deploymentTrust: {
          status: kind === "false-positive" ? "unavailable" : "verified",
        },
        eventImplementation:
          kind === "wrong-default" ? address(88) : f.implementation,
      };
    };
    await assert.rejects(
      mainnetChain(m, undefined, d.options),
      (error) => !error.message.includes("private"),
    );
    assert.equal(d.raw.destroyed, 1);
    assert.equal(d.verified.length, 0);
  }
});

function creationFields(record) {
  const d = record.deployment;
  return {
    depositAmount: d.depositWei,
    eventName: d.eventName,
    eventStart: d.eventStart,
    claimDeadline: d.claimDeadline,
    arbitration: {
      disputeResolver: d.resolver,
      extraData: d.arbitratorExtraData,
      metaEvidenceTemplate: record.pieces,
      metaEvidenceSlots: record.slots,
      policyURI: d.policyURI,
    },
  };
}
const createType =
  "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
function dynamicRecord(m) {
  const record = storedRecord(fixture()),
    d = record.deployment;
  record.definition.id = d.eventId = "event-dynamic-mainnet";
  d.contract = address(90);
  d.eventKey = digest("dynamic event key");
  record.definition.lumaUrl = "https://luma.com/synthetic-runtime-event";
  record.definition.timezone = "UTC";
  const template = eventV9LumaTemplate({
    eventName: d.eventName,
    depositAmount: d.depositWei,
    policyURI: d.policyURI,
    policySha256: hash(record.policy),
    lumaUrl: record.definition.lumaUrl,
    startsAt: record.definition.startsAt,
    endsAt: record.definition.endsAt,
    timezone: record.definition.timezone,
  });
  record.pieces = template.pieces;
  record.slots = template.slots;
  d.templateHash = hash([record.pieces, record.slots]);
  d.factoryEventId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "bytes32"],
      [1, d.factory, d.creator, d.eventKey],
    ),
  );
  d.configurationHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", createType],
      [d.creator, creationFields(record)],
    ),
  );
  assert.equal(d.factory, m.factoryDeployment.factory);
  return record;
}

test("dynamic events persist full immutable records only within the reviewed chain1 factory and survive restart", () => {
  const m = factoryFixture(),
    temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-dynamic-production-"),
    );
  try {
    const filename = path.join(temporary, "state.json"),
      record = dynamicRecord(m);
    validateMainnetDynamicEvent(record, m);
    const store = mainnetStateStore(filename, m),
      records = new Map([[record.definition.id, record]]);
    store.save(records, new Map());
    const raw = fs.readFileSync(filename),
      loaded = mainnetStateStore(filename, clone(m)).load();
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.equal(loaded.events[0].dynamic, true);
    for (const name of [
      "definition",
      "deployment",
      "policy",
      "pieces",
      "slots",
    ])
      assert.deepEqual(loaded.events[0][name], record[name]);
    assert.equal(loaded.events[0].participants[0][1].name, "Synthetic Alice");
    assert.throws(() => store.save(new Map(), new Map()), code("STATE_SCOPE"));
    assert.deepEqual(fs.readFileSync(filename), raw);
    const altered = { ...record, policy: record.policy + "changed" };
    assert.throws(
      () => store.save(new Map([[record.definition.id, altered]]), new Map()),
      code("STATE_SCOPE"),
    );
    for (const mutate of [
      (r) => (r.deployment.factory = address(91)),
      (r) => (r.deployment.chainId = 10200),
      (r) => (r.deployment.initialUpgradeOwner = address(92)),
      (r) => (r.deployment.abiVersion = "truth-pays-v7"),
      (r) => (r.pieces = ["other template"]),
      (r) => (r.deployment.configurationHash = digest("other config")),
      (r) =>
        (r.definition.lumaUrl = "https://luma.com/another-synthetic-event"),
      (r) => (r.definition.timezone = "Asia/Bangkok"),
      (r) =>
        (r.definition.endsAt = new Date(
          Date.parse(r.definition.endsAt) + 3600000,
        ).toISOString()),
      (r) => {
        r.pieces = r.pieces.map((piece) =>
          piece.replace(
            "presence-during-immutable-interval-v1",
            "forged-presence-rule",
          ),
        );
        r.deployment.templateHash = hash([r.pieces, r.slots]);
        r.deployment.configurationHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", createType],
            [r.deployment.creator, creationFields(r)],
          ),
        );
      },
    ]) {
      const saved = JSON.parse(raw);
      mutate(saved.events[0]);
      fs.writeFileSync(filename, JSON.stringify(saved), { mode: 0o600 });
      assert.throws(() => store.load(), code("STATE_SCOPE"));
      fs.writeFileSync(filename, raw, { mode: 0o600 });
    }
    const anotherFactory = clone(m);
    anotherFactory.factoryDeployment.factory = address(93);
    assert.throws(
      () => mainnetStateStore(filename, anotherFactory).load(),
      code("STATE_SCOPE"),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

function factoryDraft(m, record) {
  const config = creationFields(record),
    iface = new ethers.Interface([
      `function createEvent(bytes32 eventKey,${createType} config) returns(address)`,
    ]);
  return {
    scopeKind: "factory-create",
    id: "factory-draft-synthetic",
    eventId: "reserved-event-mainnet",
    eventKey: record.deployment.eventKey,
    wallet: record.deployment.creator,
    sessionId: "synthetic-auth-session",
    instanceId: "synthetic-server-instance",
    chainId: 1,
    contractVersion: MAINNET_PROFILE,
    abiVersion: MAINNET_PROFILE,
    factory: m.factoryDeployment.factory,
    factoryFingerprint: hash(m.factoryDeployment),
    config,
    template: { pieces: record.pieces, slots: record.slots },
    terms: {
      title: record.deployment.eventName,
      depositWei: record.deployment.depositWei,
      eventStart: record.deployment.eventStart,
      claimDeadline: record.deployment.claimDeadline,
      policyURI: record.deployment.policyURI,
      policySha256: hash(record.policy),
      lumaUrl: record.definition.lumaUrl,
      startsAt: record.definition.startsAt,
      endsAt: record.definition.endsAt,
      timezone: record.definition.timezone,
      attendanceStandard: clone(V9_LUMA_ATTENDANCE_STANDARD),
    },
    transaction: {
      from: record.deployment.creator,
      to: m.factoryDeployment.factory,
      chainId: 1,
      value: "0",
      gasLimit: "8000000",
      data: iface.encodeFunctionData("createEvent", [
        record.deployment.eventKey,
        config,
      ]),
    },
    createdAt: 1,
    expiresAt: 2,
    used: false,
    status: "pending",
    submittedHash: digest("pending known factory receipt"),
  };
}

test("pending factory drafts retain reserved IDs and exact submitted requests without admitting an event early", () => {
  const m = factoryFixture(),
    temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-factory-pending-"),
    );
  try {
    const filename = path.join(temporary, "state.json"),
      record = dynamicRecord(m),
      draft = factoryDraft(m, record);
    const store = mainnetStateStore(filename, m);
    store.save(new Map(), new Map([[draft.id, draft]]));
    const loaded = mainnetStateStore(filename, clone(m)).load(),
      before = fs.readFileSync(filename);
    assert.equal(loaded.events.length, 0);
    assert.deepEqual(loaded.drafts[0], [draft.id, draft]);
    assert.throws(() => store.save(new Map(), new Map()), code("STATE_SCOPE"));
    for (const mutate of [
      (r) => (r.wallet = address(50)),
      (r) => (r.chainId = 10200),
      (r) => (r.factoryFingerprint = "f".repeat(64)),
      (r) => (r.transaction.to = address(51)),
      (r) => (r.transaction.value = "1"),
      (r) => (r.transaction.data += "00"),
      (r) => (r.config.arbitration.disputeResolver = address(52)),
      (r) => (r.terms.lumaUrl = "https://luma.com/another-synthetic-event"),
      (r) => (r.terms.policySha256 = "f".repeat(64)),
      (r) => (r.terms.attendanceStandard.attendanceMode = "door-scan-only"),
    ]) {
      const changed = clone(draft);
      mutate(changed);
      assert.throws(
        () => store.save(new Map(), new Map([[draft.id, changed]])),
        code("STATE_SCOPE"),
      );
      assert.deepEqual(fs.readFileSync(filename), before);
      const persisted = JSON.parse(before);
      persisted.drafts[0][1] = changed;
      fs.writeFileSync(filename, JSON.stringify(persisted), { mode: 0o600 });
      assert.throws(() => store.load(), code("STATE_SCOPE"));
      fs.writeFileSync(filename, before, { mode: 0o600 });
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("static manifest records remain authoritative beside durable dynamic events and immutable factory reviews", () => {
  const m = factoryFixture();
  m.events = fixture().events;
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "kleros-mixed-production-"),
  );
  try {
    const filename = path.join(temporary, "state.json"),
      store = mainnetStateStore(filename, m);
    const initial = storedRecord(m),
      dynamic = dynamicRecord(m),
      draft = factoryDraft(m, dynamic);
    const records = new Map([
      [initial.definition.id, initial],
      [dynamic.definition.id, dynamic],
    ]);
    store.save(records, new Map([[draft.id, draft]]));
    const loaded = store.load();
    assert.equal(loaded.events.length, 2);
    assert.equal(
      loaded.events.find((r) => r.eventId === initial.definition.id).deployment,
      undefined,
    );
    assert.equal(
      loaded.events.find((r) => r.eventId === dynamic.definition.id).dynamic,
      true,
    );
    const before = fs.readFileSync(filename);
    const forged = {
      ...initial,
      deployment: { ...initial.deployment, contract: address(95) },
    };
    assert.throws(
      () =>
        store.save(
          new Map([
            [initial.definition.id, forged],
            [dynamic.definition.id, dynamic],
          ]),
          new Map([[draft.id, draft]]),
        ),
      code("STATE_SCOPE"),
    );
    const rewritten = clone(draft);
    rewritten.wallet = rewritten.transaction.from = address(96);
    assert.throws(
      () => store.save(records, new Map([[draft.id, rewritten]])),
      code("STATE_SCOPE"),
    );
    assert.deepEqual(fs.readFileSync(filename), before);
    const confirmed = {
      ...draft,
      status: "confirmed",
      used: true,
      confirmedHash: draft.submittedHash,
      blockNumber: 60,
      contract: dynamic.deployment.contract,
    };
    store.save(records, new Map([[draft.id, confirmed]]));
    assert.equal(store.load().drafts[0][1].status, "confirmed");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("factory-only runtime invokes the real factory verifier against actual in-process chain1 proxies", async () => {
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 },
    wallet: { totalAccounts: 1, defaultBalance: 1000 },
  });
  const provider = new ethers.BrowserProvider(rpc, undefined, {
    cacheTimeout: -1,
  });
  provider.pollingInterval = 10;
  let runtime;
  try {
    const signer = await provider.getSigner(),
      artifacts = loadUpgradeableArtifacts();
    const deploy = async (artifact, ...args) => {
      const c = await new ethers.ContractFactory(
        artifact.abi,
        artifact.bytecode,
        signer,
      ).deploy(...args, { gasLimit: 16_000_000 });
      await c.waitForDeployment();
      return c;
    };
    const timelock = await deploy(artifacts.timelock, signer.address),
      implementation = await deploy(artifacts.event),
      factoryImplementation = await deploy(artifacts.factory);
    const factoryProxy = await deploy(
      artifacts.proxy,
      factoryImplementation.target,
      factoryImplementation.interface.encodeFunctionData("initialize", [
        implementation.target,
        timelock.target,
      ]),
    );
    const fBirth = await factoryProxy.deploymentTransaction().wait(),
      tBirth = await timelock.deploymentTransaction().wait();
    const m = factoryFixture();
    m.governance.initialOwner = signer.address;
    m.factoryDeployment = {
      contractVersion: MAINNET_PROFILE,
      abiVersion: MAINNET_PROFILE,
      chainId: 1,
      factory: factoryProxy.target,
      factoryCodeHash: ethers.keccak256(
        await provider.getCode(factoryProxy.target),
      ),
      implementation: implementation.target,
      implementationCodeHash: ethers.keccak256(
        await provider.getCode(implementation.target),
      ),
      factoryImplementation: factoryImplementation.target,
      factoryImplementationCodeHash: ethers.keccak256(
        await provider.getCode(factoryImplementation.target),
      ),
      initialImplementation: implementation.target,
      initialFactoryImplementation: factoryImplementation.target,
      upgradeAuthority: timelock.target,
      upgradeAuthorityCodeHash: ethers.keccak256(
        await provider.getCode(timelock.target),
      ),
      initialUpgradeOwner: signer.address,
      factoryDeploymentTxHash: fBirth.hash,
      factoryDeploymentBlock: fBirth.blockNumber,
      timelockDeploymentTxHash: tBirth.hash,
      timelockDeploymentBlock: tBirth.blockNumber,
    };
    const court = fakeDependencies();
    runtime = await mainnetChain(m, undefined, {
      providerFactory: async () => provider,
      verifyCourt: court.options.verifyCourt,
      maxAttempts: 1,
    });
    assert.equal(runtime.verifiedFactory, true);
    assert.equal(runtime.factoryTrust.upgrade.owner, signer.address);
    assert.equal(runtime.factoryTrust.upgrade.pendingOwner, null);
    assert.equal(runtime.eventVerification.size, 0);
    assert.equal(
      await new ethers.Contract(
        factoryProxy.target,
        artifacts.factory.abi,
        runtime.provider,
      ).eventCount(),
      0n,
    );
    assert.deepEqual(runtime.signers, []);
    await assert.rejects(
      runtime.provider.send("eth_sendTransaction", []),
      code("FORBIDDEN_METHOD"),
    );
  } finally {
    if (runtime) await runtime.close();
    else provider.destroy();
    await rpc.disconnect();
  }
});

function casePublication(record, instanceId = "publication-instance-a") {
  const wallet = address(66).toLowerCase(),
    content = JSON.stringify({ category: "Synthetic case", wallet });
  const artifact = prepareCaseArtifact({
    scope: {
      environment: "production",
      instanceId,
      chainId: 1,
      contractVersion: MAINNET_PROFILE,
      eventId: record.definition.id,
      contract: record.deployment.contract,
      wallet,
      blockNumber: 50,
      blockHash: digest("case-canonical-block"),
      matched: true,
      localDisputeID: "0",
      arbitratorDisputeID: "1000",
    },
    content,
    expectedURI: ipfsPathOf(content),
  });
  return {
    wallet,
    value: {
      productionCase: true,
      artifact,
      status: "upload-intent",
      intent: {
        version: 1,
        scopeHash: artifact.scopeHash,
        sha256: artifact.sha256,
        uri: artifact.uri,
        byteLength: artifact.byteLength,
        endpoint: MAINNET_CASE_PUBLICATION.uploadEndpoint,
      },
    },
  };
}
function copyRecord(record) {
  return {
    ...record,
    definition: clone(record.definition),
    deployment: clone(record.deployment),
    publications: new Map(
      [...record.publications].map(([key, value]) => [key, clone(value)]),
    ),
  };
}

test("durable production case exports cannot be erased or replaced before their first upload intent", () => {
  const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-case-export-durable-"),
    ),
    m = fixture();
  try {
    const filename = path.join(temporary, "state.json"),
      store = mainnetStateStore(filename, m),
      record = storedRecord(m),
      publication = casePublication(record);
    delete publication.value.intent;
    publication.value.status = "reviewed";
    record.publications.set(publication.wallet, publication.value);
    store.save(new Map([[record.definition.id, record]]), new Map());
    const before = fs.readFileSync(filename),
      restarted = mainnetStateStore(filename, clone(m)),
      replacement = casePublication(record, "another-server-instance");
    assert.deepEqual(
      new Map(restarted.load().events[0].publications).get(publication.wallet),
      publication.value,
    );
    for (const mutate of [
      (r) => r.publications.delete(publication.wallet),
      (r) => delete r.publications.get(publication.wallet).artifact,
      (r) => (r.publications.get(publication.wallet).productionCase = false),
      (r) =>
        (r.publications.get(publication.wallet).artifact =
          replacement.value.artifact),
      (r) => {
        r.publications.get(publication.wallet).artifact =
          replacement.value.artifact;
        r.publications.get(publication.wallet).intent =
          replacement.value.intent;
      },
    ]) {
      const changed = copyRecord(record);
      mutate(changed);
      assert.throws(
        () =>
          restarted.save(
            new Map([[changed.definition.id, changed]]),
            new Map(),
          ),
        code("PUBLICATION_INTENT_IMMUTABLE"),
      );
      assert.deepEqual(fs.readFileSync(filename), before);
    }
    const claimed = copyRecord(record),
      intent = casePublication(record).value.intent;
    claimed.publications.get(publication.wallet).intent = intent;
    claimed.publications.get(publication.wallet).status = "upload-intent";
    restarted.save(new Map([[claimed.definition.id, claimed]]), new Map());
    assert.deepEqual(
      new Map(
        mainnetStateStore(filename, clone(m)).load().events[0].publications,
      ).get(publication.wallet),
      claimed.publications.get(publication.wallet),
    );
    assert.throws(
      () => store.save(new Map([[record.definition.id, record]]), new Map()),
      code("PUBLICATION_INTENT_IMMUTABLE"),
      "a stale pre-claim writer cannot erase the first durable intent",
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("own null or unfamiliar consumed production case intents cannot be removed, replaced or reset", () => {
  for (const consumed of [null, false, 0, "", "unknown-object"]) {
    const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), "kleros-case-consumed-intent-"),
      ),
      m = fixture();
    try {
      const filename = path.join(temporary, "state.json"),
        store = mainnetStateStore(filename, m),
        record = storedRecord(m),
        publication = casePublication(record),
        validIntent = clone(publication.value.intent);
      publication.value.intent =
        consumed === "unknown-object"
          ? { ...validIntent, version: 999, consumed: "unfamiliar" }
          : consumed;
      publication.value.status = "upload-uncertain";
      record.publications.set(publication.wallet, publication.value);
      store.save(new Map([[record.definition.id, record]]), new Map());
      const before = fs.readFileSync(filename),
        restarted = mainnetStateStore(filename, clone(m)),
        restored = new Map(restarted.load().events[0].publications).get(
          publication.wallet,
        );
      assert.equal(Object.hasOwn(restored, "intent"), true);
      assert.deepEqual(restored.intent, publication.value.intent);
      for (const mutate of [
        (r) => r.publications.delete(publication.wallet),
        (r) => delete r.publications.get(publication.wallet).intent,
        (r) => (r.publications.get(publication.wallet).intent = validIntent),
        (r) =>
          (r.publications.get(publication.wallet).intent =
            consumed === null ? "null" : null),
      ]) {
        const changed = copyRecord(record);
        mutate(changed);
        assert.throws(
          () =>
            restarted.save(
              new Map([[changed.definition.id, changed]]),
              new Map(),
            ),
          code("PUBLICATION_INTENT_IMMUTABLE"),
        );
        assert.deepEqual(fs.readFileSync(filename), before);
      }
      const statusUpdate = copyRecord(record);
      statusUpdate.publications.get(publication.wallet).status = "unavailable";
      restarted.save(
        new Map([[statusUpdate.definition.id, statusUpdate]]),
        new Map(),
      );
      assert.deepEqual(
        new Map(
          mainnetStateStore(filename, clone(m)).load().events[0].publications,
        ).get(publication.wallet).intent,
        publication.value.intent,
      );
      assert.deepEqual(fs.readdirSync(temporary), ["state.json"]);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test("durable publication intent survives restart, forbids immutable replacement/deletion and permits verified status", () => {
  const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-case-intent-durable-"),
    ),
    m = fixture();
  try {
    const filename = path.join(temporary, "state.json"),
      store = mainnetStateStore(filename, m),
      record = storedRecord(m),
      publication = casePublication(record),
      legacyWallet = address(67).toLowerCase();
    record.publications.set(legacyWallet, {
      status: "local-only",
      content: "legacy bytes",
    });
    record.publications.set(publication.wallet, publication.value);
    store.save(new Map([[record.definition.id, record]]), new Map());
    const before = fs.readFileSync(filename),
      restarted = mainnetStateStore(filename, clone(m)).load();
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.deepEqual(
      new Map(restarted.events[0].publications).get(publication.wallet),
      publication.value,
    );
    for (const mutate of [
      (r) => r.publications.delete(publication.wallet),
      (r) => (r.publications.get(publication.wallet).productionCase = false),
      (r) => delete r.publications.get(publication.wallet).intent,
      (r) =>
        (r.publications.get(publication.wallet).intent.endpoint =
          "https://example.invalid/another-upload"),
      (r) => r.publications.get(publication.wallet).intent.byteLength++,
      (r) => (r.publications.get(publication.wallet).artifact.content += " "),
      (r) =>
        r.publications.get(publication.wallet).artifact.scope.blockNumber++,
      (r) =>
        (r.publications.get(publication.wallet).artifact.scope.instanceId =
          "new-instance"),
    ]) {
      const changed = copyRecord(record);
      mutate(changed);
      assert.throws(
        () =>
          store.save(new Map([[changed.definition.id, changed]]), new Map()),
        code("PUBLICATION_INTENT_IMMUTABLE"),
      );
      assert.deepEqual(fs.readFileSync(filename), before);
    }
    const verified = copyRecord(record),
      value = verified.publications.get(publication.wallet);
    value.status = "verified";
    value.verification = {
      status: "verified",
      uri: value.artifact.uri,
      sha256: value.artifact.sha256,
    };
    verified.publications.delete(legacyWallet); // Existing local/demo publication rows retain their previous behavior.
    store.save(new Map([[verified.definition.id, verified]]), new Map());
    const final = new Map(
      mainnetStateStore(filename, clone(m)).load().events[0].publications,
    );
    assert.equal(final.get(publication.wallet).status, "verified");
    assert.deepEqual(
      final.get(publication.wallet).artifact,
      publication.value.artifact,
    );
    assert.deepEqual(
      final.get(publication.wallet).intent,
      publication.value.intent,
    );
    assert.equal(final.has(legacyWallet), false);
    assert.deepEqual(
      fs.readdirSync(temporary),
      ["state.json"],
      "failed writes leave no temp files or writer locks",
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("independently loaded stale state cannot erase or replace a newer case upload intent", () => {
  const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-case-intent-stale-"),
    ),
    m = fixture();
  try {
    const filename = path.join(temporary, "state.json"),
      firstStore = mainnetStateStore(filename, m),
      record = storedRecord(m);
    firstStore.save(new Map([[record.definition.id, record]]), new Map());
    const secondStore = mainnetStateStore(filename, clone(m)),
      stale = copyRecord(record);
    secondStore.load(); // A separate process may have loaded this snapshot before the first upload began.
    const original = casePublication(record, "server-a"),
      competitor = casePublication(record, "server-b");
    record.publications.set(original.wallet, original.value);
    firstStore.save(new Map([[record.definition.id, record]]), new Map());
    assert.throws(
      () =>
        secondStore.save(new Map([[stale.definition.id, stale]]), new Map()),
      code("PUBLICATION_INTENT_IMMUTABLE"),
    );
    stale.publications.set(competitor.wallet, competitor.value);
    assert.throws(
      () =>
        secondStore.save(new Map([[stale.definition.id, stale]]), new Map()),
      code("PUBLICATION_INTENT_IMMUTABLE"),
    );
    assert.deepEqual(
      new Map(firstStore.load().events[0].publications).get(original.wallet),
      original.value,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("simultaneous separate state writers commit at most one competing immutable publication intent", async () => {
  const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-case-intent-race-"),
    ),
    m = fixture(),
    workers = [];
  try {
    const filename = path.join(temporary, "state.json"),
      store = mainnetStateStore(filename, m),
      record = storedRecord(m);
    store.save(new Map([[record.definition.id, record]]), new Map());
    const recordData = {
      ...record,
      participants: [...record.participants],
      personal: [...record.personal],
      publications: [],
      nonces: [...record.nonces],
    };
    const script = `const {parentPort,workerData}=require('node:worker_threads');
      (async()=>{const {mainnetStateStore}=await import(workerData.module);
      const r=workerData.record;r.participants=new Map(r.participants);r.personal=new Map(r.personal);
      r.publications=new Map([[workerData.publication.wallet,workerData.publication.value]]);r.nonces=new Set(r.nonces);
      const s=mainnetStateStore(workerData.filename,workerData.manifest);s.load();
      parentPort.once('message',()=>{try{s.save(new Map([[r.definition.id,r]]),new Map());parentPort.postMessage({ok:true});}
      catch(e){parentPort.postMessage({ok:false,code:e.code});}});parentPort.postMessage({ready:true});})();`;
    const ready = [],
      results = [];
    for (const instance of ["concurrent-server-a", "concurrent-server-b"]) {
      const worker = new Worker(script, {
        eval: true,
        workerData: {
          module: new URL("../src/mainnet-runtime.mjs", import.meta.url).href,
          filename,
          manifest: m,
          record: recordData,
          publication: casePublication(record, instance),
        },
      });
      workers.push(worker);
      ready.push(
        new Promise((resolve, reject) => {
          worker.on("message", (v) => {
            if (v.ready) resolve();
          });
          worker.on("error", reject);
        }),
      );
      results.push(
        new Promise((resolve, reject) => {
          worker.on("message", (v) => {
            if (Object.hasOwn(v, "ok")) resolve(v);
          });
          worker.on("error", reject);
        }),
      );
    }
    await Promise.all(ready);
    workers.forEach((worker) => worker.postMessage("save"));
    const outcomes = await Promise.all(results);
    assert.equal(outcomes.filter((value) => value.ok).length, 1);
    assert.ok(
      outcomes
        .filter((value) => !value.ok)
        .every((value) =>
          ["STATE_BUSY", "PUBLICATION_INTENT_IMMUTABLE"].includes(value.code),
        ),
    );
    const saved = new Map(
      mainnetStateStore(filename, clone(m)).load().events[0].publications,
    )
      .values()
      .next().value;
    assert.equal(saved.productionCase, true);
    assert.equal(saved.status, "upload-intent");
    assert.equal(saved.intent.scopeHash, saved.artifact.scopeHash);
    assert.deepEqual(fs.readdirSync(temporary), ["state.json"]);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
