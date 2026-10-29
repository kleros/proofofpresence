// Pure synthetic recorded-adoption fixtures only. No RPC, live state, accounts, keys or files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { publicCatalogSnapshot } from "../src/public-catalog.mjs";
import { hash } from "../src/utils.mjs";
import { eventV9LumaTemplate, V9_LUMA_ATTENDANCE_STANDARD } from "../src/contracts-v9-luma.mjs";
import { MAINNET_KLEROS, MAINNET_EXTRA_DATA } from "../scripts/mainnet/verify-kleros.mjs";

const clone = (value) => structuredClone(value);
const address = (n) => ethers.getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const digest = (value) => ethers.id(`synthetic-public-catalog-${value}`);
const PROFILE = "kleros-event-v9-uups", NOW = 1_800_000_000_000;
const TYPE = "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
const iface = new ethers.Interface([`function createEvent(bytes32 eventKey,${TYPE} config) returns(address)`]);

function fixture() {
  const source = { chainId: 1, contractVersion: PROFILE, abiVersion: PROFILE, factory: address(2),
    factoryCodeHash: digest("factory-code"), factoryImplementation: address(4), factoryImplementationCodeHash: digest("factory-implementation"),
    initialFactoryImplementation: address(4), initialImplementation: address(3), implementation: address(3),
    implementationCodeHash: digest("event-implementation"), upgradeAuthority: address(5), upgradeAuthorityCodeHash: digest("timelock-code"),
    initialUpgradeOwner: address(12), factoryDeploymentTxHash: digest("factory-birth"), factoryDeploymentBlock: 20,
    timelockDeploymentTxHash: digest("timelock-birth"), timelockDeploymentBlock: 10 };
  const factory = { ...source, resolver: MAINNET_KLEROS.resolver, arbitrator: MAINNET_KLEROS.arbitrator,
    arbitratorExtraData: MAINNET_EXTRA_DATA, policyStatus: "published",
    policy: { uri: "https://policy.example.invalid/synthetic.md", text: "Synthetic public policy only", sha256: hash("Synthetic public policy only") } };
  const manifest = { schemaVersion: 1, environment: "production", provenance: { v9BuildManifestSha256: "a".repeat(64), v9StandardInputSha256: "b".repeat(64) },
    chain: { chainId: 1, name: "Ethereum", rpcUrl: "https://ethereum.example.invalid", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
    arbitration: { mode: "kleros-v1", resolver: MAINNET_KLEROS.resolver, arbitrator: MAINNET_KLEROS.arbitrator, extraData: MAINNET_EXTRA_DATA },
    governance: { kind: "single-owner-timelock", initialOwner: source.initialUpgradeOwner, minimumDelaySeconds: 172800 }, factoryDeployment: factory, events: [] };
  const eventId = "event-synthetic-public-catalog-a", start = 2_000_000_000;
  const definition = { id: eventId, title: "Synthetic public event", startsAt: new Date(start * 1000).toISOString(),
    endsAt: new Date((start + 3600) * 1000).toISOString(), timezone: "UTC", lumaUrl: "https://luma.com/synthetic-catalog",
    visibility: "public", editorialStatus: "published", organizers: [address(8)], staff: [address(9)] };
  const deployment = { ...source, eventId, contract: address(90), codeHash: digest("child-proxy-code"),
    deploymentTxHash: digest("child-created"), deploymentBlock: 30, eventName: definition.title,
    depositWei: "10000000000000000", eventStart: start, depositDeadline: start, depositOpensAt: start - 3600,
    claimDeadline: start + 7 * 86400, creator: address(8), owner: address(8), resolver: MAINNET_KLEROS.resolver,
    arbitrator: MAINNET_KLEROS.arbitrator, arbitratorExtraData: MAINNET_EXTRA_DATA, policyURI: factory.policy.uri,
    eventKey: ethers.id(eventId) };
  const template = eventV9LumaTemplate({ eventName: deployment.eventName, depositAmount: deployment.depositWei,
    policyURI: deployment.policyURI, policySha256: factory.policy.sha256, lumaUrl: definition.lumaUrl,
    startsAt: definition.startsAt, endsAt: definition.endsAt, timezone: definition.timezone });
  deployment.templateHash = hash([template.pieces, template.slots]);
  deployment.factoryEventId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "address", "bytes32"], [1, source.factory, deployment.creator, deployment.eventKey]));
  const config = { depositAmount: deployment.depositWei, eventName: definition.title, eventStart: start, claimDeadline: deployment.claimDeadline,
    arbitration: { disputeResolver: deployment.resolver, extraData: deployment.arbitratorExtraData,
      metaEvidenceTemplate: template.pieces, metaEvidenceSlots: template.slots, policyURI: deployment.policyURI } };
  deployment.configurationHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", TYPE], [deployment.creator, config]));
  const record = { dynamic: true, definition, deployment, policy: factory.policy.text, ...template,
    participants: new Map([["private-guest", { name: "PRIVATE NAME", email: "private@example.test", wallet: address(22) }]]),
    financialAccess: [address(8)], currentFinancialState: "PRIVATE_CURRENT_STATE" };
  const draft = { id: "synthetic-factory-review", scopeKind: "factory-create", eventId, eventKey: deployment.eventKey,
    wallet: deployment.creator, chainId: 1, contractVersion: PROFILE, abiVersion: PROFILE, mode: "hosted-production", action: "createEvent",
    method: "createEvent", valueWei: "0", contract: source.factory, factory: source.factory, factorySource: source,
    factoryFingerprint: hash(factory), createdContract: deployment.contract, status: "confirmed", used: true, adoptionStatus: "verified",
    submittedHash: deployment.deploymentTxHash, confirmedHash: deployment.deploymentTxHash,
    blockNumber: deployment.deploymentBlock, blockHash: digest("confirmed-creation-block"), reviewBlock: 25,
    template, policyText: record.policy, config, args: [deployment.eventKey, config],
    transaction: { chainId: 1, value: "0", from: deployment.creator, to: source.factory,
      data: iface.encodeFunctionData("createEvent", [deployment.eventKey, config]) },
    terms: { title: definition.title, depositWei: deployment.depositWei, eventStart: start, claimDeadline: deployment.claimDeadline,
      lumaUrl: definition.lumaUrl, startsAt: definition.startsAt, endsAt: definition.endsAt, timezone: definition.timezone,
      policyURI: deployment.policyURI, policySha256: factory.policy.sha256, attendanceStandard: clone(V9_LUMA_ATTENDANCE_STANDARD) },
    sessionId: "PRIVATE_SESSION", instanceId: "old-server-instance" };
  return { manifest, events: new Map([[eventId, record]]), drafts: new Map([[draft.id, draft]]),
    instanceId: "current-server-instance", now: NOW, record, draft, eventId };
}

test("recorded adoption projects only detached public display fields with no current authority or private data", () => {
  const f = fixture(), before = clone(f);
  const snapshot = publicCatalogSnapshot(f);
  assert.deepEqual(snapshot.catalog, { metadataOnly: true, currentFinancialState: "not-loaded", source: "recorded-adoption" });
  assert.equal(snapshot.generatedAt, new Date(NOW).toISOString()); assert.equal(snapshot.kind, "public-catalog");
  assert.equal(snapshot.mode, "hosted-production"); assert.deepEqual(snapshot.environment, { production: true, network: "ethereum-mainnet", chainId: 1 });
  assert.deepEqual(snapshot.chain, f.manifest.chain);
  assert.equal(snapshot.events.length, 1);
  const row = snapshot.events[0];
  assert.deepEqual(Object.keys(row).sort(), ["id", "title", "startsAt", "endsAt", "timezone", "depositWei", "chainId", "contract",
    "contractVersion", "abiVersion", "visibility", "editorialStatus", "adoption"].sort());
  assert.deepEqual(row.adoption, { kind: "recorded-adoption", txHash: f.draft.confirmedHash, blockNumber: 30, blockHash: f.draft.blockHash });
  for (const field of ["session", "wallet", "role", "owner", "staff", "organizers", "participants", "recoveryEvents", "financialPhase", "upgrade", "capabilities"])
    assert.equal(Object.hasOwn(snapshot, field) || Object.hasOwn(row, field), false, field);
  assert.equal(/PRIVATE|private@example|verified|eligible/.test(JSON.stringify(snapshot)), false);
  assert.deepEqual(f, before, "Projection never mutates current records, drafts or manifest");
  row.title = "Detached mutation"; snapshot.chain.nativeCurrency.symbol = "bad";
  assert.equal(f.record.definition.title, before.record.definition.title); assert.equal(f.manifest.chain.nativeCurrency.symbol, "ETH");
});

test("private and draft flags are filtered before titles, deployments or index data are read", () => {
  const f = fixture(); let forbiddenReads = 0;
  for (const [id, visibility, editorialStatus] of [["private-b", "private", "published"], ["draft-c", "public", "draft"], ["unknown-d", undefined, "published"]]) {
    f.events.set(id, { definition: { visibility, editorialStatus, get title() { forbiddenReads++; throw Error("Private title read"); } },
      get deployment() { forbiddenReads++; throw Error("Private deployment read"); } });
  }
  f.events.set("malformed-e", { get definition() { throw Error("Malformed local record is omitted"); } });
  assert.deepEqual(publicCatalogSnapshot(f).events.map((row) => row.id), [f.eventId]); assert.equal(forbiddenReads, 0);
  f.record.definition.visibility = "private"; assert.deepEqual(publicCatalogSnapshot(f).events, []);
  f.record.definition.visibility = "public"; f.record.definition.editorialStatus = "draft";
  assert.deepEqual(publicCatalogSnapshot(f).events, []);
});

test("pending, failed, unadopted, duplicate and absent factory reviews cannot create catalog rows", () => {
  for (const mutate of [(f) => { f.drafts.clear(); }, (f) => { f.draft.status = "pending"; },
    (f) => { f.draft.status = "failed"; }, (f) => { f.draft.used = false; },
    (f) => { delete f.draft.adoptionStatus; }, (f) => { f.draft.adoptionStatus = "unavailable"; },
    (f) => { f.draft.scopeKind = "event"; }, (f) => { f.record.dynamic = false; },
    (f) => { f.drafts.set("duplicate", { ...clone(f.draft), id: "duplicate" }); }]) {
    const f = fixture(); mutate(f); assert.deepEqual(publicCatalogSnapshot(f).events, []);
  }
});

test("foreign/tampered source, identities, exact call, hashes, anchors and immutable terms are omitted", () => {
  const mutations = [
    (f) => { f.draft.factoryFingerprint = "0".repeat(64); }, (f) => { f.draft.factorySource.implementation = address(77); },
    (f) => { f.draft.factory = address(77); }, (f) => { f.draft.contractVersion = "kleros-event-v8"; },
    (f) => { f.draft.chainId = 10200; }, (f) => { f.draft.eventKey = digest("wrong-key"); },
    (f) => { f.draft.createdContract = address(77); }, (f) => { f.draft.wallet = address(77); },
    (f) => { f.draft.submittedHash = digest("other-tx"); }, (f) => { f.draft.confirmedHash = digest("other-tx"); },
    (f) => { f.draft.blockNumber++; }, (f) => { f.draft.blockHash = ethers.ZeroHash; },
    (f) => { f.draft.reviewBlock = f.draft.blockNumber; }, (f) => { f.draft.id = "other-id"; },
    (f) => { f.draft.transaction.to = address(77); }, (f) => { f.draft.transaction.from = address(77); },
    (f) => { f.draft.transaction.value = "1"; }, (f) => { f.draft.transaction.data += "00"; },
    (f) => { f.draft.config.eventName += "changed"; }, (f) => { f.draft.args[0] = digest("other-key"); },
    (f) => { f.draft.terms.title += "changed"; }, (f) => { f.draft.terms.timezone = "Asia/Bangkok"; },
    (f) => { f.draft.terms.policySha256 = "f".repeat(64); }, (f) => { f.draft.policyText += "changed"; },
    (f) => { f.record.definition.lumaUrl = "https://luma.com/changed"; }, (f) => { f.record.definition.title += "changed"; },
    (f) => { f.record.definition.endsAt = new Date(2_000_010_000_000).toISOString(); },
    (f) => { f.record.policy += "changed"; }, (f) => { f.record.pieces[0] += "changed"; },
    (f) => { f.record.deployment.configurationHash = digest("other-config"); },
    (f) => { f.events = new Map([["different-stable-id", f.record]]); },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.deepEqual(publicCatalogSnapshot(f).events, [], mutate.toString()); }
});

test("projection has no provider/fetch/session dependency and does not interpret current financial state", () => {
  const f = fixture(); let calls = 0;
  Object.defineProperties(f, { provider: { get() { calls++; throw Error("Provider access"); } },
    session: { get() { calls++; throw Error("Session access"); } }, signer: { get() { calls++; throw Error("Signer access"); } } });
  Object.defineProperty(f.record, "currentState", { get() { calls++; throw Error("Financial state access"); } });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => { calls++; throw Error("Network access"); };
    const first = publicCatalogSnapshot(f);
    f.record.financialAccess = [address(77)]; f.record.participants.clear(); f.record.definition.staff = [address(88)];
    assert.deepEqual(publicCatalogSnapshot(f), first); assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("current instance changes do not replace a recorded adoption; corrupted scopes fail closed", () => {
  const f = fixture(), initial = publicCatalogSnapshot(f);
  const replay = publicCatalogSnapshot({ ...f, instanceId: "restarted-server" });
  assert.equal(replay.instanceId, "restarted-server"); assert.deepEqual(replay.events, initial.events);
  for (const patch of [{ instanceId: "../private" }, { now: -1 }, { events: [] }, { drafts: [] }])
    assert.throws(() => publicCatalogSnapshot({ ...fixture(), ...patch }), (error) => error.code === "PUBLIC_CATALOG_SCOPE");
  const wrong = fixture(); wrong.manifest.chain.chainId = 10200;
  assert.throws(() => publicCatalogSnapshot(wrong));
});
