// Actual new v9 factory/proxies/timelock on an in-process chain1. Court is a synthetic fixture;
// public runtime/Court address verification and browser prompts are covered separately.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { createFactoryOnboardingService, validateOrganizerTerms } from "../src/factory-onboarding.mjs";
import { loadUpgradeableArtifacts } from "../src/upgrade-verification.mjs";
import { assertProductionEOAWallet } from "../src/production-wallets.mjs";
import { mainnetStateStore } from "../src/mainnet-runtime.mjs";
import { MAINNET_KLEROS } from "../scripts/mainnet/verify-kleros.mjs";
import { V9_LUMA_ATTENDANCE_STANDARD } from "../src/contracts-v9-luma.mjs";

const PROFILE = "kleros-event-v9-uups", GAS = { gasLimit: 8_000_000 }, send = async (p) => (await p).wait();
const policy = { uri: "https://example.invalid/approved-v9-policy", text: "Synthetic published attendance policy. No external publication occurred." };
policy.sha256 = hash(policy.text);
let rpc, provider, chain, f, factory, timelock, organizer, guest, session, outsider, service, stateStore, temporary, stateFile, saved = 0;
let events = new Map(), drafts = new Map();
const faults = { receiptCreator: false, factoryCode: false, forbidEOA: false,
  eoaMutationAt: null, didMutate: false, transactionGate: null };
let eoaChecks = 0, forbiddenCalls = 0;
const lower = (s) => String(s).toLowerCase();
const termsAt = (timestamp) => ({ title: "Synthetic organizer event", lumaUrl: "https://luma.com/synthetic-event",
  startsAt: new Date((timestamp + 3600) * 1000).toISOString(), endsAt: new Date((timestamp + 7200) * 1000).toISOString(),
  timezone: "Asia/Bangkok", depositEth: "0.000001" });
const freshTerms = async () => termsAt((await provider.getBlock("latest")).timestamp);
async function checkWallet(wallet) {
  eoaChecks++; assert.equal(faults.forbidEOA, false, "Receipt recovery must not call the signing guard");
  const result = await assertProductionEOAWallet(chain.provider, wallet);
  if (faults.eoaMutationAt === eoaChecks) {
    await send(timelock.transferOwnership(guest.address, GAS)); faults.didMutate = true;
  }
  return result;
}

before(async () => {
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 }, wallet: { totalAccounts: 4, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  const owner = await provider.getSigner(0);
  [organizer, guest] = Object.values(rpc.getInitialAccounts()).slice(1, 3).map((v) => new ethers.Wallet(v.secretKey, provider));
  const a = loadUpgradeableArtifacts();
  const legacy = (name) => JSON.parse(fs.readFileSync(new URL(`../references/kickback/build/${name}.json`, import.meta.url)));
  const deploy = async (artifact, ...args) => {
    const c = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner).deploy(...args, { gasLimit: 16_000_000 });
    await c.waitForDeployment(); return c;
  };
  timelock = await deploy(a.timelock, owner.address);
  const implementation = await deploy(a.event), factoryImplementation = await deploy(a.factory);
  const proxy = await deploy(a.proxy, factoryImplementation.target,
    factoryImplementation.interface.encodeFunctionData("initialize", [implementation.target, timelock.target]));
  factory = new ethers.Contract(proxy.target, a.factory.abi, owner);
  // Canonical address metadata is needed by the strict private-store validator. Only this
  // in-process chain receives mock code at those addresses; no public chain is contacted.
  const liquidCode = await deploy(legacy("MockKlerosLiquid"));
  const resolverCode = await deploy(legacy("MockArbitrableProxy"), MAINNET_KLEROS.arbitrator);
  await rpc.request({ method: "evm_setAccountCode", params: [MAINNET_KLEROS.arbitrator, await provider.getCode(liquidCode.target)] });
  await rpc.request({ method: "evm_setAccountCode", params: [MAINNET_KLEROS.resolver, await provider.getCode(resolverCode.target)] });
  const liquid = new ethers.Contract(MAINNET_KLEROS.arbitrator, liquidCode.interface, owner);
  const resolver = new ethers.Contract(MAINNET_KLEROS.resolver, resolverCode.interface, owner);
  await send(liquid.setFeeForJuror(10000000000n));
  const factoryBirth = await proxy.deploymentTransaction().wait(), timelockBirth = await timelock.deploymentTransaction().wait();
  f = { contractVersion: PROFILE, abiVersion: PROFILE, chainId: 1, factory: factory.target,
    factoryCodeHash: ethers.keccak256(await provider.getCode(factory.target)),
    factoryImplementation: factoryImplementation.target, factoryImplementationCodeHash: ethers.keccak256(await provider.getCode(factoryImplementation.target)),
    initialFactoryImplementation: factoryImplementation.target, initialImplementation: implementation.target,
    implementation: implementation.target, implementationCodeHash: ethers.keccak256(await provider.getCode(implementation.target)),
    upgradeAuthority: timelock.target, upgradeAuthorityCodeHash: ethers.keccak256(await provider.getCode(timelock.target)), initialUpgradeOwner: owner.address,
    factoryDeploymentTxHash: factoryBirth.hash, factoryDeploymentBlock: factoryBirth.blockNumber,
    timelockDeploymentTxHash: timelockBirth.hash, timelockDeploymentBlock: timelockBirth.blockNumber,
    policy: { ...policy }, policyStatus: "published" };
  const backend = new Proxy(provider, { get(target, key) {
    if (["broadcastTransaction", "getSigner", "listAccounts"].includes(key)) return async () => { forbiddenCalls++; throw Error("No backend signing"); };
    if (key === "getCode") return async (address, tag) => faults.factoryCode && lower(address) === lower(factory.target) ? "0x00" : provider.getCode(address, tag);
    if (key === "getTransaction") return async (txHash) => {
      if (faults.transactionGate?.hash === txHash) {
        faults.transactionGate.entered(); await faults.transactionGate.wait;
      }
      return provider.getTransaction(txHash);
    };
    if (key === "getTransactionReceipt") return async (txHash) => {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt || !faults.receiptCreator) return receipt;
      return { ...receipt, logs: receipt.logs.map((log) => {
        if (lower(log.address) !== lower(factory.target)) return log;
        let p; try { p = factory.interface.parseLog(log); } catch { return log; }
        if (p?.name !== "EventCreated") return log;
        return { ...log, ...factory.interface.encodeEventLog(factory.interface.getEvent("EventCreated"),
          [p.args.eventId, guest.address, p.args.eventContract, p.args.eventKey, p.args.version, p.args.configurationHash]) };
      }) };
    };
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  const extraData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]);
  const manifest = { environment: "production", chain: { chainId: 1, name: "Ethereum", rpcUrl: "https://ethereum-rpc.publicnode.com",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }, factoryDeployment: f, events: [],
    governance: { kind: "single-owner-timelock", initialOwner: owner.address, minimumDelaySeconds: 172800 },
    arbitration: { mode: "kleros-v1", resolver: resolver.target, arbitrator: liquid.target, extraData },
    provenance: { v9BuildManifestSha256: hash(JSON.parse(fs.readFileSync(new URL("../build/contracts-v9/manifest.json", import.meta.url)))),
      v9StandardInputSha256: hash(JSON.parse(fs.readFileSync(new URL("../build/contracts-v9/standard-input.json", import.meta.url)))) } };
  chain = { provider: backend, chainId: 1, production: true, signers: [],
    governance: { kind: "single-owner-timelock", initialOwner: owner.address, minimumDelaySeconds: 172800 },
    resolver: new ethers.Contract(resolver.target, resolver.interface, backend), liquid: new ethers.Contract(liquid.target, liquid.interface, backend),
    manifest };
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kleros-factory-onboarding-"));
  stateFile = path.join(temporary, "production-state.json");
  stateStore = mainnetStateStore(stateFile, manifest);
  session = { id: "synthetic-wallet-session", wallet: organizer.address, mode: "wallet" };
  outsider = { id: "another-wallet-session", wallet: guest.address, mode: "wallet" };
  service = createFactoryOnboardingService({ chain, factoryDeployment: f, events, drafts, instanceId: "synthetic-server-instance",
    store: { save: (e, d) => { stateStore.save(e, d); saved++; } }, assertWallet: checkWallet });
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); });

test("terms reject page/host masquerades, invalid amounts/dates and caller policy overrides", () => {
  const now = Date.parse("2026-10-29T00:00:00Z") / 1000, input = termsAt(now);
  assert.equal(validateOrganizerTerms(input, policy, now).claimDeadline, now + 3600 + 7 * 86400);
  for (const lumaUrl of ["https://evil.invalid/event", "https://luma.com.evil.invalid/event", "https://luma.com@evil.invalid/event",
    "https://luma.com/", "https://luma.com/calendar/other", "https://luma.com/pricing", "https://luma.com:8443/event", "https://luma.com/event?next=https://evil.invalid"])
    assert.throws(() => validateOrganizerTerms({ ...input, lumaUrl }, policy, now));
  for (const patch of [{ depositEth: "0" }, { depositEth: "1e-3" }, { depositEth: "0.0000000000000000001" },
    { startsAt: "2026-02-30T12:00:00Z" }, { startsAt: "2026-12-01T12:00:00" }, { timezone: "Not/A_Zone" },
    { policyURI: "https://evil.invalid/policy" }, { claimDeadline: "2030-01-01T00:00:00Z" }])
    assert.throws(() => validateOrganizerTerms({ ...input, ...patch }, policy, now));
});

test("unpublished policy and unreviewed factory stop creation before reserving any event", async () => {
  f.policyStatus = "unpublished";
  try { await assert.rejects(service.createDraft(session, await freshTerms()), (e) => e.code === "POLICY_UNAVAILABLE"); }
  finally { f.policyStatus = "published"; }
  faults.factoryCode = true;
  try { await assert.rejects(service.createDraft(session, await freshTerms())); }
  finally { faults.factoryCode = false; }
  assert.equal(events.size, 0); assert.equal(drafts.size, 0);
  await assert.rejects(service.createDraft({ ...session, mode: "demo" }, await freshTerms()), (e) => e.status === 401);
});

test("actual wallet creation is reviewed exactly, persisted only after full child provenance and supports wallet-first plain deposit", { timeout: 60000 }, async () => {
  const draft = await service.createDraft(session, await freshTerms());
  assert.equal(events.size, 0); assert.equal(draft.factoryFingerprint, hash(f));
  assert.equal(draft.transaction.to, factory.target); assert.equal(draft.transaction.from, organizer.address);
  assert.equal(draft.transaction.value, "0"); assert.equal(draft.transaction.chainId, 1);
  assert.equal(draft.mode, "hosted-production"); assert.equal(draft.action, "createEvent");
  assert.equal(draft.contract, factory.target); assert.equal(draft.valueWei, "0");
  assert.equal(draft.terms.capacity, 150); assert.equal(draft.terms.claimDays, 7);
  assert.equal(draft.terms.challengeWindowSeconds, 86400); assert.equal(draft.terms.matchWindowSeconds, 86400);
  assert.deepEqual(draft.terms.attendanceStandard, V9_LUMA_ATTENDANCE_STANDARD);
  assert.ok(BigInt(draft.transaction.gasLimit) > 0n); assert.equal(draft.terms.policySha256, policy.sha256);
  assert.equal(draft.terms.claimDeadline, draft.terms.eventStart + 7 * 86400);
  const reviewed = await service.validateDraft(session, draft.id);
  assert.deepEqual(reviewed.transaction, draft.transaction);
  reviewed.transaction.to = guest.address;
  assert.equal((await service.validateDraft(session, draft.id)).transaction.to, factory.target, "DTO mutation never changes stored review");
  await assert.rejects(service.validateDraft(outsider, draft.id), (e) => e.code === "DRAFT_SCOPE");
  const transaction = await organizer.sendTransaction(draft.transaction), receipt = await transaction.wait();
  assert.equal(receipt.status, 1);
  await service.recordSubmitted(session, draft.id, transaction.hash);
  assert.equal(events.size, 0, "Mined/submitted hash alone is not event registration");
  faults.receiptCreator = true;
  try { await assert.rejects(service.reconcile(session, draft.id, transaction.hash), (e) => e.code === "TX_MISMATCH"); }
  finally { faults.receiptCreator = false; }
  assert.equal(events.size, 0, "Forged creator cannot create an app event");
  const beforeGuardCalls = eoaChecks;
  const actualNow = Date.now;
  Date.now = () => draft.expiresAt + 1;
  await rpc.request({ method: "evm_setAccountCode", params: [organizer.address, "0x00"] });
  faults.forbidEOA = true;
  let result;
  try {
    await assert.rejects(service.validateDraft(session, draft.id), (e) => e.code === "STALE_DRAFT");
    result = await service.reconcile({ ...session, id: "new-session-same-wallet" }, draft.id, transaction.hash);
  } finally { Date.now = actualNow; faults.forbidEOA = false; await rpc.request({ method: "evm_setAccountCode", params: [organizer.address, "0x"] }); }
  assert.equal(eoaChecks, beforeGuardCalls); assert.equal(result.status, "confirmed");
  assert.equal(result.eventId, draft.eventId); assert.equal(events.size, 1);
  assert.equal(result.wallet, organizer.address); assert.equal(result.chainId, 1); assert.equal(result.blockNumber, receipt.blockNumber);
  const record = events.get(result.eventId), child = new ethers.Contract(result.contract, loadUpgradeableArtifacts().event.abi, provider);
  assert.equal(record.dynamic, true, "First adopted response has the same source-bound dynamic marker as reload");
  assert.equal(record.deployment.contract, result.contract); assert.equal(record.deployment.owner, organizer.address);
  assert.equal(record.definition.lumaUrl, draft.terms.lumaUrl); assert.equal(record.participants.size, 0);
  assert.equal(await child.owner(), organizer.address); assert.equal(await child.originatingFactory(), factory.target);
  assert.equal(await child.upgradeAuthority(), f.upgradeAuthority); assert.equal(await child.CHALLENGE_PERIOD(), 86400n);
  assert.equal(await child.MATCH_PERIOD(), 86400n);
  const metaevidence = JSON.parse((await child.caseMetaEvidence(guest.address))[0]);
  assert.deepEqual(metaevidence.lumaAttendance, { schemaVersion: 1, lumaUrl: draft.terms.lumaUrl,
    startsAt: draft.terms.startsAt, endsAt: draft.terms.endsAt, timezone: draft.terms.timezone,
    ...V9_LUMA_ATTENDANCE_STANDARD, policySha256: policy.sha256 });
  assert.equal(metaevidence.fileURI, policy.uri);
  assert.match(metaevidence.description, /participation for the whole event is not required/);
  const again = await service.reconcile(session, draft.id, transaction.hash);
  assert.deepEqual(again, result); assert.equal(events.size, 1);
  assert.equal((await service.recordSubmitted(session, draft.id, transaction.hash)).status, "confirmed");
  assert.equal(service.getDraft(session, draft.id).status, "confirmed");
  assert.equal(service.getDraft(session, draft.id).contract, factory.target);
  assert.equal(service.getDraft(session, draft.id).createdContract, result.contract);
  await send(guest.sendTransaction({ to: result.contract, value: BigInt(draft.terms.depositWei), gasLimit: 100000 }));
  assert.equal(await child.pendingDeposits(guest.address), BigInt(draft.terms.depositWei));
  assert.equal(record.participants.size, 0, "Deposit does not invent a name/email registration");
  assert.equal(saved > 0, true); assert.equal(forbiddenCalls, 0);
  const restored = stateStore.load();
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  assert.equal(restored.events[0].dynamic, true);
  assert.equal(restored.events[0].deployment.contract, result.contract);
  assert.equal(restored.drafts.find(([key]) => key === draft.id)[1].confirmedHash, transaction.hash);
});

test("factory governance change invalidates an unsigned review without affecting the confirmed event", { timeout: 60000 }, async () => {
  const draft = await service.createDraft(session, await freshTerms()), existing = [...events.keys()];
  await send(timelock.transferOwnership(guest.address, GAS));
  try { await assert.rejects(service.validateDraft(session, draft.id), (e) => e.code === "STALE_DRAFT"); }
  finally { await send(timelock.cancelOwnershipTransfer(GAS)); }
  assert.deepEqual([...events.keys()], existing); assert.equal(forbiddenCalls, 0);
});

test("canonical failed creation is consumed and recorded without adding a phantom event", { timeout: 60000 }, async () => {
  const input = await freshTerms(), now = (await provider.getBlock("latest")).timestamp;
  input.startsAt = new Date((now + 120) * 1000).toISOString(); input.endsAt = new Date((now + 7200) * 1000).toISOString();
  const draft = await service.createDraft(session, input), before = events.size;
  await rpc.request({ method: "evm_setTime", params: [(draft.terms.eventStart + 1) * 1000] });
  await rpc.request({ method: "evm_mine", params: [] });
  const transaction = await organizer.sendTransaction({ ...draft.transaction, ...GAS });
  let receipt; try { await transaction.wait(); } catch (error) { receipt = error.receipt; }
  assert.equal(receipt.status, 0);
  await service.recordSubmitted(session, draft.id, transaction.hash);
  assert.equal((await service.reconcile({ ...session, id: "recovery-session" }, draft.id, transaction.hash)).status, "failed");
  assert.equal(events.size, before); assert.equal(drafts.get(draft.id).used, true);
  assert.equal((await service.recordSubmitted(session, draft.id, transaction.hash)).status, "failed");
  assert.equal(service.getDraft(session, draft.id).status, "failed");
  await assert.rejects(service.validateDraft(session, draft.id), (e) => e.code === "STALE_DRAFT");
});

test("governance changed during the final EOA check rejects create and validate at the resealed block", { timeout: 60000 }, async () => {
  const arm = () => { faults.eoaMutationAt = eoaChecks + 2; faults.didMutate = false; };
  const clear = async () => { faults.eoaMutationAt = null; if (faults.didMutate) await send(timelock.cancelOwnershipTransfer(GAS)); };
  const before = drafts.size;
  try {
    arm();
    await assert.rejects(service.createDraft(session, await freshTerms()), (e) => e.code === "STALE_DRAFT");
    assert.equal(faults.didMutate, true); assert.equal(drafts.size, before);
  } finally { await clear(); }
  const draft = await service.createDraft(session, await freshTerms());
  try {
    arm();
    await assert.rejects(service.validateDraft(session, draft.id), (e) => e.code === "STALE_DRAFT");
    assert.equal(faults.didMutate, true); assert.equal(service.getDraft(session, draft.id).submittedHash, undefined);
  } finally { await clear(); }
});

test("a fresh instance recovers the persisted known hash after expiry and a child provenance failure", { timeout: 60000 }, async () => {
  const draft = await service.createDraft(session, await freshTerms()), before = events.size;
  const transaction = await organizer.sendTransaction(draft.transaction); assert.equal((await transaction.wait()).status, 1);
  faults.factoryCode = true;
  try {
    await assert.rejects(service.reconcile(session, draft.id, transaction.hash));
    assert.equal(events.size, before);
    const persisted = stateStore.load().drafts.find(([key]) => key === draft.id)[1];
    assert.equal(persisted.submittedHash, transaction.hash); assert.equal(persisted.adoptionStatus, "unavailable");
    const callsBefore = eoaChecks;
    const reloaded = service.getDraft({ ...session, id: "fresh-read-only-session" }, draft.id);
    assert.equal(reloaded.submittedHash, transaction.hash); assert.equal(eoaChecks, callsBefore);
    assert.throws(() => service.getDraft(outsider, draft.id), (e) => e.code === "DRAFT_SCOPE");
  } finally { faults.factoryCode = false; }
  const stored = stateStore.load(), previousEvents = events, previousDrafts = drafts;
  events = new Map(stored.events.map((record) => [record.eventId, { ...record,
    participants: new Map(record.participants), personal: new Map(record.personal),
    publications: new Map(record.publications), nonces: new Set(record.nonces) }]));
  drafts = new Map(stored.drafts);
  assert.notEqual(events, previousEvents); assert.notEqual(drafts, previousDrafts);
  service = createFactoryOnboardingService({ chain, factoryDeployment: f, events, drafts, instanceId: "fresh-restarted-server-instance",
    store: { save: (e, d) => { stateStore.save(e, d); saved++; } }, assertWallet: checkWallet });
  const actualNow = Date.now, checksBeforeRecovery = eoaChecks;
  Date.now = () => draft.expiresAt + 1; faults.forbidEOA = true;
  let recovered;
  try {
    await assert.rejects(service.validateDraft({ ...session, id: "recovery-only-session" }, draft.id), (e) => e.code === "STALE_DRAFT");
    recovered = await service.reconcile({ ...session, id: "recovery-only-session" }, draft.id, transaction.hash);
  } finally { Date.now = actualNow; faults.forbidEOA = false; }
  assert.equal(recovered.status, "confirmed"); assert.equal(events.size, before + 1);
  assert.equal(eoaChecks, checksBeforeRecovery); assert.equal(recovered.hash, transaction.hash);
  assert.equal(stateStore.load().events.find((record) => record.eventId === draft.eventId).deployment.contract, recovered.contract);
});

test("concurrent submitted/reconcile calls preserve the first draft hash across slow RPC", { timeout: 60000 }, async () => {
  const draft = await service.createDraft(outsider, await freshTerms()), firstHash = ethers.id("first-synthetic-pending-hash"), otherHash = ethers.id("conflicting-synthetic-pending-hash");
  let release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  faults.transactionGate = { hash: firstHash, entered, wait: new Promise((resolve) => { release = resolve; }) };
  const first = service.recordSubmitted(outsider, draft.id, firstHash);
  await started;
  const second = service.recordSubmitted(outsider, draft.id, otherHash), third = service.reconcile(outsider, draft.id, otherHash);
  release();
  try {
    assert.equal((await first).hash, firstHash);
    await assert.rejects(second, (e) => e.code === "TX_MISMATCH");
    await assert.rejects(third, (e) => e.code === "TX_MISMATCH");
    assert.equal(service.getDraft(outsider, draft.id).submittedHash, firstHash);
    assert.equal(stateStore.load().drafts.find(([key]) => key === draft.id)[1].submittedHash, firstHash);
  } finally { faults.transactionGate = null; }
});
