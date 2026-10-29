// Synthetic injected reads and temporary local state only; no live chain, wallet or signing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { V10_MAINNET_PROFILE as PROFILE, V10_POLICY_SHA256, validateV10MainnetManifest, validateV10MainnetDynamicEvent,
  v10MainnetChain, v10MainnetStateStore } from "../src/v10-mainnet-runtime.mjs";
import { eventV10LumaTemplate, V10_LUMA_ATTENDANCE_STANDARD } from "../src/contracts-v10-luma.mjs";
import { mainnetStateStore } from "../src/mainnet-runtime.mjs";
import { MAINNET_KLEROS, MAINNET_EXTRA_DATA } from "../scripts/mainnet/verify-kleros.mjs";

const addr = n => ethers.getAddress("0x" + n.toString(16).padStart(40, "0"));
const digest = value => ethers.id("synthetic-v10-runtime-" + value), code = expected => error => error.code === expected;
const policy = fs.readFileSync(new URL("../docs/contracts/v10-luma-generic-policy.md", import.meta.url), "utf8");
const type = "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
function manifest(published = true) {
  const F = { chainId: 1, contractVersion: PROFILE, abiVersion: PROFILE, factory: addr(1), factoryCodeHash: digest("proxy"),
    implementation: addr(2), implementationCodeHash: digest("event-implementation"), initialImplementation: addr(2),
    factoryImplementation: addr(3), factoryImplementationCodeHash: digest("factory-implementation"), initialFactoryImplementation: addr(3),
    upgradeAuthority: addr(4), upgradeAuthorityCodeHash: digest("controller"), initialUpgradeOwner: addr(5),
    factoryDeploymentTxHash: digest("factory-birth"), factoryDeploymentBlock: 20,
    controllerDeploymentTxHash: digest("controller-birth"), controllerDeploymentBlock: 10,
    policy: { contractVersion: PROFILE, uri: published ? "https://policy.example.invalid/v10.md" : null, sha256: hash(policy), text: policy },
    policyStatus: published ? "published" : "unpublished" };
  return { schemaVersion: 1, environment: "production", chain: { chainId: 1, name: "Ethereum", rpcUrl: "https://ethereum.example.invalid",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
    arbitration: { mode: "kleros-v1", resolver: MAINNET_KLEROS.resolver, arbitrator: MAINNET_KLEROS.arbitrator, extraData: MAINNET_EXTRA_DATA },
    governance: { kind: "single-owner-immediate", initialOwner: addr(5), upgradeDelaySeconds: 0, renounceable: true },
    provenance: Object.fromEntries([["v10BuildManifestSha256", "manifest"], ["v10StandardInputSha256", "standard-input"]]
      .map(([key, name]) => [key, hash(JSON.parse(fs.readFileSync(new URL(`../build/contracts-v10/${name}.json`, import.meta.url), "utf8")))])),
    factoryDeployment: F, events: [] };
}
function record(m, suffix = "a", child = 9) {
  const F = m.factoryDeployment, start = 2_000_000_000;
  const d = { ...Object.fromEntries(Object.entries(F).filter(([key]) => !["policy", "policyStatus"].includes(key))),
    eventId: "synthetic-v10-" + suffix, contract: addr(child), codeHash: digest("child-proxy"), deploymentTxHash: digest("child-" + suffix),
    deploymentBlock: 30, owner: addr(8), creator: addr(8), eventName: "Synthetic V10 " + suffix, depositWei: "10000000000000000",
    eventStart: start, depositDeadline: start, depositOpensAt: start - 3600, claimDeadline: start + 7 * 86400,
    resolver: m.arbitration.resolver, arbitrator: m.arbitration.arbitrator, arbitratorExtraData: MAINNET_EXTRA_DATA,
    policyURI: F.policy.uri, eventKey: digest("event-key-" + suffix), sourceCommit: "synthetic-only" };
  const definition = { id: d.eventId, title: d.eventName, startsAt: new Date(start * 1000).toISOString(),
    endsAt: new Date((start + 3600) * 1000).toISOString(), timezone: "UTC", lumaUrl: "https://luma.com/synthetic-v10-" + suffix,
    organizers: [d.owner], staff: [], visibility: "private" };
  const template = eventV10LumaTemplate({ eventName: d.eventName, depositAmount: d.depositWei, policyURI: d.policyURI, policySha256: hash(policy),
    lumaUrl: definition.lumaUrl, startsAt: definition.startsAt, endsAt: definition.endsAt, timezone: definition.timezone });
  d.templateHash = hash([template.pieces, template.slots]);
  d.factoryEventId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address", "address", "bytes32"], [1, d.factory, d.creator, d.eventKey]));
  const r = { definition, deployment: d, policy, ...template, dynamic: true, revision: 1, observations: [], batches: [], transactions: [],
    participants: new Map([["synthetic-person", { id: "synthetic-person", wallet: addr(30), name: "Synthetic Alice" }]]),
    personal: new Map(), publications: new Map(), nonces: new Set(["synthetic-nonce"]) };
  d.configurationHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", type], [d.creator, fields(r)]));
  return r;
}
function fields(r) { const d = r.deployment; return { depositAmount: d.depositWei, eventName: d.eventName, eventStart: d.eventStart,
  claimDeadline: d.claimDeadline, arbitration: { disputeResolver: d.resolver, extraData: d.arbitratorExtraData,
    metaEvidenceTemplate: r.pieces, metaEvidenceSlots: r.slots, policyURI: d.policyURI } }; }
function draft(m, r) {
  const d = r.deployment, config = fields(r);
  return { scopeKind: "factory-create", id: "synthetic-factory-review", eventId: d.eventId, eventKey: d.eventKey, wallet: d.creator,
    instanceId: "synthetic-server", sessionId: "synthetic-session", chainId: 1, contractVersion: PROFILE, abiVersion: PROFILE,
    factory: d.factory, factoryFingerprint: hash(m.factoryDeployment), config, template: { pieces: r.pieces, slots: r.slots }, policyText: policy,
    terms: { title: d.eventName, depositWei: d.depositWei, eventStart: d.eventStart, claimDeadline: d.claimDeadline, policyURI: d.policyURI,
      policySha256: hash(policy), lumaUrl: r.definition.lumaUrl, startsAt: r.definition.startsAt, endsAt: r.definition.endsAt,
      timezone: r.definition.timezone, attendanceStandard: structuredClone(V10_LUMA_ATTENDANCE_STANDARD) },
    transaction: { from: d.creator, to: d.factory, chainId: 1, value: "0", gasLimit: "8000000",
      data: new ethers.Interface([`function createEvent(bytes32 eventKey,${type} config) returns(address)`]).encodeFunctionData("createEvent", [d.eventKey, config]) },
    createdAt: 1, expiresAt: 2, status: "pending", used: false, submittedHash: digest("known-submitted") };
}
function dependencies() {
  const calls = [], events = [], factories = [];
  const raw = { chain: "0x1", destroyed: 0, async send(method, params) { calls.push({ method, params }); return method === "eth_chainId" ? raw.chain : "0x7"; },
    async _send(payload) { return payload; }, async destroy() { raw.destroyed++; } };
  const options = { maxAttempts: 1, providerFactory: async () => raw,
    verifyCourt: async () => ({ status: "verified-read-only", chainId: 1,
      resolver: { address: MAINNET_KLEROS.resolver, codeHash: MAINNET_KLEROS.resolverCodeHash },
      arbitrator: { address: MAINNET_KLEROS.arbitrator, codeHash: MAINNET_KLEROS.arbitratorCodeHash } }),
    verifyFactory: async (chain, F, scope) => { factories.push({ F, scope }); assert.equal(chain.production, true);
      assert.equal(scope.profile, PROFILE); return { deploymentTrust: { status: "verified" }, eventImplementation: F.implementation }; },
    verifyDeployment: async (_chain, d, scope) => { events.push(d.eventId); assert.equal(scope.profile, PROFILE); } };
  return { calls, events, factories, raw, options };
}
const temporary = work => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v10-runtime-")); try { return work(path.join(dir, "state.json")); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };

test("V10 manifests reject V9 identity, timelock aliases, callbacks, wrong Court and relabeled old policy", () => {
  assert.equal(hash(policy), V10_POLICY_SHA256);
  const changes = [m => m.chain.chainId = 10200, m => m.chain.nativeCurrency.symbol = "XDAI", m => m.arbitration.mode = "controlled",
    m => m.factoryDeployment.contractVersion = "kleros-event-v9-uups", m => m.factoryDeployment.timelockDeploymentBlock = 10,
    m => delete m.factoryDeployment.controllerDeploymentTxHash, m => m.governance.kind = "single-owner-timelock", m => m.governance.upgradeDelaySeconds = 172800,
    m => m.governance.minimumDelaySeconds = 172800, m => m.governance.renounceable = false, m => m.assertTransactionIntent = "untrusted",
    m => m.factoryDeployment.policy.contractVersion = "kleros-event-v9-uups", m => m.factoryDeployment.policy.text = "Relabeled V9 text",
    m => m.factoryDeployment.policy.sha256 = "0".repeat(64), m => m.factoryDeployment.policy.uri = "https://user:secret@example.invalid/policy",
    m => m.factoryDeployment.policyStatus = "unpublished", m => m.provenance = { v9BuildManifestSha256: "a".repeat(64), v9StandardInputSha256: "b".repeat(64) }];
  for (const change of changes) { const m = manifest(); change(m); assert.throws(() => validateV10MainnetManifest(m)); }
  const m = manifest(), validated = validateV10MainnetManifest(m); m.governance.initialOwner = addr(99);
  assert.equal(validated.governance.initialOwner, addr(5));
  const unpublished = manifest(false); validateV10MainnetManifest(unpublished);
  unpublished.events.push(record(manifest())); assert.throws(() => validateV10MainnetManifest(unpublished), code("V10_POLICY_MISMATCH"));
});

test("factory-only unpublished V10 boots keylessly through independent Court/factory checks with no financial readiness", async () => {
  const dep = dependencies(), chain = await v10MainnetChain(manifest(false), undefined, dep.options);
  try {
    assert.equal(chain.production, true); assert.equal(chain.chainId, 1); assert.deepEqual(chain.signers, []);
    assert.equal(chain.financeReady, false); assert.equal(chain.verifiedFactory, true); assert.equal(dep.factories.length, 1); assert.deepEqual(dep.events, []);
    assert.equal(chain.assertTransactionIntent, undefined);
    for (const method of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "personal_sign", "eth_accounts"])
      await assert.rejects(chain.provider.send(method, []));
    for (const method of ["getSigner", "listAccounts", "broadcastTransaction"]) await assert.rejects(chain.provider[method](), code("FORBIDDEN_METHOD"));
    await assert.rejects(chain.provider._send({ method: "eth_sendRawTransaction", params: ["0x"] }), code("FORBIDDEN_METHOD"));
  } finally { await chain.close(); }
  assert.equal(dep.raw.destroyed, 1); assert.throws(() => chain.provider.send("eth_chainId", []), code("PROVIDER_CLOSED"));
});

test("V10 source pins fail before provider creation; factory/Court false positives clean up without event use", async () => {
  const m = manifest(), dep = dependencies(); m.provenance.v10BuildManifestSha256 = "a".repeat(64);
  let providers = 0; dep.options.providerFactory = async () => { providers++; return dep.raw; };
  await assert.rejects(v10MainnetChain(m, undefined, dep.options), code("V10_ARTIFACT_PROVENANCE")); assert.equal(providers, 0);
  for (const failure of ["court", "factory"]) {
    const d = dependencies();
    if (failure === "court") d.options.verifyCourt = async () => ({ status: "verified-read-only", chainId: 10200 });
    else d.options.verifyFactory = async (_chain, F) => ({ deploymentTrust: { status: "unavailable" }, eventImplementation: F.implementation });
    await assert.rejects(v10MainnetChain(manifest(), undefined, d.options)); assert.equal(d.raw.destroyed, 1); assert.deepEqual(d.events, []);
  }
});

test("V10 unavailable A does not hide separately verified B or soften the closing network check", async () => {
  const m = manifest(), a = record(m), b = record(m, "b", 10); m.events = [a, b];
  const dep = dependencies(); dep.options.verifyDeployment = async (_chain, d) => {
    dep.events.push(d.eventId); if (d.eventId === a.definition.id) throw Object.assign(Error("withheld"), { code: "UNREVIEWED_UPGRADE_HISTORY" });
  };
  const chain = await v10MainnetChain(m, undefined, dep.options);
  try { assert.deepEqual([...chain.eventVerification], [[a.definition.id, { status: "unavailable", code: "UNREVIEWED_UPGRADE_HISTORY" }], [b.definition.id, { status: "verified" }]]); }
  finally { await chain.close(); }
  const wrong = dependencies(); wrong.options.verifyDeployment = async () => { wrong.raw.chain = "0x27d8"; };
  await assert.rejects(v10MainnetChain(m, undefined, wrong.options)); assert.equal(wrong.raw.destroyed, 1);
});

test("V10 trusted intent hook proves only exact factual calldata scope and never establishes wallet eligibility", async () => {
  const dep = dependencies(), expected = { chainId: 1, transactionHash: digest("receipt"), from: addr(8), to: addr(1), valueWei: "0", data: "0x1234" };
  const actual = { untouched: true }; let bad = false;
  dep.options.assertTransactionIntent = async (tx, input) => { assert.equal(tx, actual); assert.deepEqual(input, expected);
    return { verified: true, chainId: 1, transactionHash: input.transactionHash, from: input.from, to: input.to, valueWei: "0", dataHash: bad ? ethers.ZeroHash : ethers.keccak256(input.data) }; };
  const chain = await v10MainnetChain(manifest(), undefined, dep.options);
  try {
    const proof = await chain.assertTransactionIntent(actual, expected); assert.equal(proof.verified, true); assert.equal(chain.financeReady, false);
    bad = true; await assert.rejects(chain.assertTransactionIntent(actual, expected), code("TRANSACTION_INTENT_MISMATCH"));
    await assert.rejects(chain.assertTransactionIntent(actual, { ...expected, chainId: 10200 }), code("TRANSACTION_INTENT_MISMATCH"));
  } finally { await chain.close(); }
});

test("V10 dynamic records preserve policy, template, owner/controller and configuration across restart", () => temporary(filename => {
  const m = manifest(), r = record(m); validateV10MainnetDynamicEvent(r, m);
  const store = v10MainnetStateStore(filename, m), events = new Map([[r.definition.id, r]]); store.save(events, new Map());
  const before = fs.readFileSync(filename), loaded = v10MainnetStateStore(filename, structuredClone(m)).load();
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600); assert.equal(loaded.namespace, "ethereum-mainnet-v10"); assert.equal(loaded.contractVersion, PROFILE);
  assert.deepEqual(loaded.events[0].deployment, r.deployment); assert.equal(loaded.events[0].participants[0][1].name, "Synthetic Alice");
  for (const change of [x => x.policy += "changed", x => x.deployment.controllerDeploymentTxHash = digest("other-controller"),
    x => x.definition.lumaUrl = "https://luma.com/changed", x => x.deployment.contractVersion = "kleros-event-v9-uups",
    x => x.pieces = ["old template"], x => x.deployment.configurationHash = digest("other")]) {
    const changed = structuredClone(r); change(changed);
    assert.throws(() => store.save(new Map([[r.definition.id, changed]]), new Map()), code("STATE_SCOPE")); assert.deepEqual(fs.readFileSync(filename), before);
  }
  assert.throws(() => store.save(new Map(), new Map()), code("STATE_SCOPE")); assert.deepEqual(fs.readFileSync(filename), before);
}));

test("V10 submitted factory reviews retain immutable request/hash and restart recovery without overwriting another namespace", () => temporary(filename => {
  const m = manifest(), r = record(m), d = draft(m, r), store = v10MainnetStateStore(filename, m), drafts = new Map([[d.id, d]]);
  store.save(new Map(), drafts); const before = fs.readFileSync(filename);
  assert.equal(v10MainnetStateStore(filename, m).load().drafts[0][1].submittedHash, d.submittedHash);
  for (const change of [x => x.submittedHash = digest("replacement"), x => x.transaction.data += "00", x => x.wallet = addr(77),
    x => x.factoryFingerprint = digest("foreign-factory"), x => x.contractVersion = "kleros-event-v9-uups"]) {
    const changed = structuredClone(d); change(changed);
    assert.throws(() => store.save(new Map(), new Map([[changed.id, changed]])), code("STATE_SCOPE")); assert.deepEqual(fs.readFileSync(filename), before);
  }
  assert.throws(() => store.save(new Map(), new Map()), code("STATE_SCOPE"));
  const foreign = JSON.parse(before); foreign.namespace = "ethereum-mainnet-v9"; fs.writeFileSync(filename, JSON.stringify(foreign));
  const foreignBytes = fs.readFileSync(filename); assert.throws(() => store.save(new Map(), drafts), code("STATE_SCOPE")); assert.deepEqual(fs.readFileSync(filename), foreignBytes);
  fs.writeFileSync(filename, before); fs.chmodSync(filename, 0o644); assert.throws(() => store.save(new Map(), drafts), code("STATE_PERMISSIONS"));
  fs.chmodSync(filename, 0o600);
  const confirmed = structuredClone(d); confirmed.status = "confirmed"; confirmed.used = true; confirmed.confirmedHash = confirmed.submittedHash;
  store.save(new Map(), new Map([[confirmed.id, confirmed]])); const confirmedBytes = fs.readFileSync(filename);
  assert.throws(() => store.save(new Map(), drafts), code("STATE_SCOPE")); assert.deepEqual(fs.readFileSync(filename), confirmedBytes);
  fs.writeFileSync(filename, before); fs.writeFileSync(filename + ".write-lock", "held", { mode: 0o600 });
  assert.throws(() => store.save(new Map(), drafts), code("STATE_BUSY")); assert.deepEqual(fs.readFileSync(filename), before);
}));

test("a real V9 durable store cannot be opened or overwritten under the V10 namespace", () => temporary(filename => {
  const old = manifest(); old.governance = { kind: "single-owner-timelock", initialOwner: addr(5), minimumDelaySeconds: 172800 };
  old.factoryDeployment.contractVersion = old.factoryDeployment.abiVersion = "kleros-event-v9-uups";
  old.factoryDeployment.timelockDeploymentTxHash = old.factoryDeployment.controllerDeploymentTxHash;
  old.factoryDeployment.timelockDeploymentBlock = old.factoryDeployment.controllerDeploymentBlock;
  delete old.factoryDeployment.controllerDeploymentTxHash; delete old.factoryDeployment.controllerDeploymentBlock;
  delete old.factoryDeployment.policy; delete old.factoryDeployment.policyStatus;
  old.provenance = Object.fromEntries([["v9BuildManifestSha256", "manifest"], ["v9StandardInputSha256", "standard-input"]]
    .map(([key, name]) => [key, hash(JSON.parse(fs.readFileSync(new URL(`../build/contracts-v9/${name}.json`, import.meta.url), "utf8")))]));
  mainnetStateStore(filename, old).save(new Map(), new Map()); const before = fs.readFileSync(filename);
  assert.throws(() => v10MainnetStateStore(filename, manifest()).load(), code("STATE_SCOPE"));
  assert.throws(() => v10MainnetStateStore(filename, manifest()).save(new Map(), new Map()), code("STATE_SCOPE"));
  assert.deepEqual(fs.readFileSync(filename), before); assert.equal(mainnetStateStore(filename, old).load().contractVersion, "kleros-event-v9-uups");
}));

test("V10 production publication intents remain consumed and immutable under stale independent writers", () => temporary(filename => {
  const m = manifest(), r = record(m), wallet = addr(30).toLowerCase(), artifact = { scope: { environment: "production", chainId: 1,
    contractVersion: PROFILE, eventId: r.definition.id, contract: r.deployment.contract, wallet }, scopeHash: hash("scope"), sha256: hash("bytes"), uri: "https://example.invalid/case", byteLength: 10 };
  r.publications.set(wallet, { productionCase: true, artifact, status: "prepared" });
  const events = new Map([[r.definition.id, r]]), store = v10MainnetStateStore(filename, m); store.save(events, new Map());
  const stale = structuredClone(r); r.publications.get(wallet).intent = null; store.save(events, new Map()); const before = fs.readFileSync(filename);
  assert.throws(() => v10MainnetStateStore(filename, m).save(new Map([[stale.definition.id, stale]]), new Map()), code("PUBLICATION_INTENT_IMMUTABLE"));
  assert.deepEqual(fs.readFileSync(filename), before);
}));
