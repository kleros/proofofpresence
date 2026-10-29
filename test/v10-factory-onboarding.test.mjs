// Actual V10 factory/proxies/controller on in-process chain1; Court adjudication is mocked.
// The trusted envelope-adapter case is a synthetic boundary test, not real EIP-7702 support proof.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { createV10FactoryOnboardingService, validateV10OrganizerTerms } from "../src/v10-factory-onboarding.mjs";
import { loadV10UpgradeableArtifacts } from "../src/v10-upgrade-artifacts.mjs";
import { v10MainnetStateStore } from "../src/v10-mainnet-runtime.mjs";
import { assertProductionEOAWallet } from "../src/production-wallets.mjs";
import { V10_LUMA_ATTENDANCE_STANDARD } from "../src/contracts-v10-luma.mjs";
import { MAINNET_KLEROS } from "../scripts/mainnet/verify-kleros.mjs";

const PROFILE = "kleros-event-v10-uups", gas = { gasLimit: 8_000_000 }, send = async tx => (await tx).wait();
const policy = { contractVersion: PROFILE, uri: "https://example.invalid/approved-v10-policy",
  text: fs.readFileSync(new URL("../docs/contracts/v10-luma-generic-policy.md", import.meta.url), "utf8") };
policy.sha256 = hash(policy.text);
const code = expected => error => error.code === expected;
let rpc, provider, owner, organizer, guest, controller, factory, F, chain, artifacts, backend, walletChecks = 0, forbiddenCalls = 0;
let faults = {};
const lower = value => String(value).toLowerCase();
before(async () => {
  artifacts = loadV10UpgradeableArtifacts();
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 }, wallet: { totalAccounts: 4, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  owner = await provider.getSigner(0);
  [organizer, guest] = Object.values(rpc.getInitialAccounts()).slice(1, 3).map(value => new ethers.Wallet(value.secretKey, provider));
  const deploy = async (a, ...args) => { const c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args, { gasLimit: 16_000_000 }); await c.waitForDeployment(); return c; };
  controller = await deploy(artifacts.controller, owner.address);
  const eventImpl = await deploy(artifacts.event), factoryImpl = await deploy(artifacts.factory),
    proxy = await deploy(artifacts.proxy, factoryImpl.target, factoryImpl.interface.encodeFunctionData("initialize", [eventImpl.target, controller.target]));
  factory = new ethers.Contract(proxy.target, artifacts.factory.abi, owner);
  // Exact canonical Court addresses satisfy the strict local durable validator only.
  const mock = name => JSON.parse(fs.readFileSync(new URL(`../references/kickback/build/${name}.json`, import.meta.url)));
  const liquidCode = await deploy(mock("MockKlerosLiquid")), resolverCode = await deploy(mock("MockArbitrableProxy"), MAINNET_KLEROS.arbitrator);
  await rpc.request({ method: "evm_setAccountCode", params: [MAINNET_KLEROS.arbitrator, await provider.getCode(liquidCode.target)] });
  await rpc.request({ method: "evm_setAccountCode", params: [MAINNET_KLEROS.resolver, await provider.getCode(resolverCode.target)] });
  const factoryBirth = await proxy.deploymentTransaction().wait(), controllerBirth = await controller.deploymentTransaction().wait();
  F = { contractVersion: PROFILE, abiVersion: PROFILE, chainId: 1, factory: factory.target,
    factoryCodeHash: ethers.keccak256(await provider.getCode(factory.target)), factoryImplementation: factoryImpl.target,
    factoryImplementationCodeHash: ethers.keccak256(await provider.getCode(factoryImpl.target)), initialFactoryImplementation: factoryImpl.target,
    implementation: eventImpl.target, implementationCodeHash: ethers.keccak256(await provider.getCode(eventImpl.target)), initialImplementation: eventImpl.target,
    upgradeAuthority: controller.target, upgradeAuthorityCodeHash: ethers.keccak256(await provider.getCode(controller.target)), initialUpgradeOwner: owner.address,
    factoryDeploymentTxHash: factoryBirth.hash, factoryDeploymentBlock: factoryBirth.blockNumber,
    controllerDeploymentTxHash: controllerBirth.hash, controllerDeploymentBlock: controllerBirth.blockNumber, policy: { ...policy }, policyStatus: "published" };
  backend = new Proxy(provider, { get(target, key) {
    if (["broadcastTransaction", "getSigner", "listAccounts"].includes(key)) return async () => { forbiddenCalls++; throw Error("No backend signing"); };
    if (key === "getCode") return async (address, tag) => faults.factoryCode && lower(address) === lower(factory.target) ? "0x00" : provider.getCode(address, tag);
    if (key === "getBlock") return async tag => {
      const block = await provider.getBlock(tag);
      if (faults.reorgArmed && typeof tag === "number") return { ...block, hash: ethers.id("synthetic-replaced-header") };
      return block;
    };
    if (key === "getTransaction") return async hash => {
      const tx = await provider.getTransaction(hash); faults.txReads = (faults.txReads ?? 0) + 1;
      if (tx && faults.envelopeHash === hash) return { ...tx, to: MAINNET_KLEROS.resolver, data: "0x1234" };
      return tx;
    };
    if (key === "getTransactionReceipt") return async hash => {
      if (faults.nullReceipt) return null;
      const r = await provider.getTransactionReceipt(hash);
      if (!r || !faults.creator) return r;
      return { ...r, logs: r.logs.map(log => {
        if (lower(log.address) !== lower(factory.target)) return log;
        let p; try { p = factory.interface.parseLog(log); } catch { return log; }
        if (p?.name !== "EventCreated") return log;
        return { ...log, ...factory.interface.encodeEventLog(factory.interface.getEvent("EventCreated"),
          [p.args.eventId, guest.address, p.args.eventContract, p.args.eventKey, p.args.version, p.args.configurationHash]) };
      }) };
    };
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  const governance = { kind: "single-owner-immediate", initialOwner: owner.address, upgradeDelaySeconds: 0, renounceable: true },
    arbitration = { mode: "kleros-v1", resolver: MAINNET_KLEROS.resolver, arbitrator: MAINNET_KLEROS.arbitrator,
      extraData: ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]) };
  chain = { provider: backend, chainId: 1, production: true, signers: [], governance,
    resolver: new ethers.Contract(arbitration.resolver, resolverCode.interface, backend), liquid: new ethers.Contract(arbitration.arbitrator, liquidCode.interface, backend),
    manifest: { environment: "production", chain: { chainId: 1, name: "Ethereum", rpcUrl: "https://ethereum-rpc.publicnode.com",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }, factoryDeployment: F, events: [], governance, arbitration,
      provenance: Object.fromEntries([["v10BuildManifestSha256", "manifest"], ["v10StandardInputSha256", "standard-input"]]
        .map(([key, file]) => [key, hash(JSON.parse(fs.readFileSync(new URL(`../build/contracts-v10/${file}.json`, import.meta.url))))])) } };
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });
async function isolated(work) {
  const snapshot = await rpc.request({ method: "evm_snapshot", params: [] }), dir = fs.mkdtempSync(path.join(os.tmpdir(), "v10-onboarding-"));
  faults = {}; walletChecks = 0; delete chain.assertTransactionIntent;
  const events = new Map(), drafts = new Map(), filename = path.join(dir, "state.json"), store = v10MainnetStateStore(filename, chain.manifest);
  const assertWallet = async (wallet, observation) => {
    walletChecks++; assert.equal(faults.forbidWallet, undefined, "Known-hash recovery cannot call signing guards");
    if (!observation) {
      const result = await assertProductionEOAWallet(backend, wallet);
      if (faults.mutateAt === walletChecks) await send(controller.transferOwnership(guest.address, gas));
      if (faults.codeAt === walletChecks) await rpc.request({ method: "evm_setAccountCode", params: [wallet, "0x00"] });
      return result;
    }
    if (faults.finalReorg) faults.reorgArmed = true;
    return { wallet: ethers.getAddress(wallet), blockNumber: observation.blockNumber, blockHash: observation.blockHash,
      codeHash: ethers.keccak256(observation.code), financialEligible: observation.code === "0x", accountType: "eoa" };
  };
  const options = { chain, factoryDeployment: F, events, drafts, store, instanceId: "synthetic-v10-instance", assertWallet },
    service = createV10FactoryOnboardingService(options), session = { id: "synthetic-v10-session", wallet: organizer.address, mode: "wallet" };
  const terms = async () => { const now = (await provider.getBlock("latest")).timestamp; return { title: "Synthetic V10 event", lumaUrl: "https://luma.com/synthetic-v10-onboarding",
    startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "Asia/Bangkok", depositEth: "0.000001" }; };
  try { return await work({ service, session, events, drafts, store, filename, options, terms }); }
  finally { faults = {}; delete chain.assertTransactionIntent; F.policyStatus = "published"; await rpc.request({ method: "evm_revert", params: [snapshot] }); fs.rmSync(dir, { recursive: true, force: true }); }
}

test("V10 terms/policy/profile reject overrides before a review or event is reserved", async () => isolated(async f => {
  const input = await f.terms(), now = (await provider.getBlock("latest")).timestamp;
  assert.deepEqual(validateV10OrganizerTerms(input, policy, now).attendanceStandard, V10_LUMA_ATTENDANCE_STANDARD);
  for (const patch of [{ lumaUrl: "https://luma.com.evil.invalid/event" }, { lumaUrl: "https://luma.com/pricing" },
    { depositEth: "0" }, { policyURI: "https://evil.invalid/old-policy" }, { timezone: "Not/A_Zone" }])
    assert.throws(() => validateV10OrganizerTerms({ ...input, ...patch }, policy, now));
  F.policyStatus = "unpublished"; await assert.rejects(f.service.createDraft(f.session, input), code("POLICY_UNAVAILABLE")); F.policyStatus = "published";
  const old = F.policy.contractVersion; F.policy.contractVersion = "kleros-event-v9-uups";
  try { await assert.rejects(f.service.createDraft(f.session, input), code("POLICY_UNAVAILABLE")); } finally { F.policy.contractVersion = old; }
  assert.equal(f.events.size, 0); assert.equal(f.drafts.size, 0);
}));

test("actual V10 reviewed creation adopts only a canonical VERSION10 receipt and immutable full child proof", async () => isolated(async f => {
  f.service = createV10FactoryOnboardingService({ ...f.options, assertWallet: undefined });
  const draft = await f.service.createDraft(f.session, await f.terms());
  assert.equal(draft.contractVersion, PROFILE); assert.equal(draft.terms.policySha256, policy.sha256);
  assert.equal(draft.factoryFingerprint, hash(F)); assert.equal(draft.terms.challengeWindowSeconds, 86400);
  assert.equal(draft.factorySource, undefined); assert.equal(draft.policyText, undefined); assert.equal(f.events.size, 0);
  const validated = await f.service.validateDraft(f.session, draft.id); assert.deepEqual(validated.transaction, draft.transaction);
  validated.transaction.to = guest.address; assert.equal((await f.service.validateDraft(f.session, draft.id)).transaction.to, factory.target);
  const tx = await organizer.sendTransaction(draft.transaction), receipt = await tx.wait(); await f.service.recordSubmitted(f.session, draft.id, tx.hash);
  faults.creator = true; await assert.rejects(f.service.reconcile(f.session, draft.id, tx.hash), code("TX_MISMATCH")); delete faults.creator;
  assert.equal(f.events.size, 0);
  const result = await f.service.reconcile(f.session, draft.id, tx.hash), r = f.events.get(draft.eventId), child = new ethers.Contract(result.contract, artifacts.event.abi, provider);
  assert.equal(result.status, "confirmed"); assert.equal(result.blockNumber, receipt.blockNumber); assert.equal(await child.VERSION(), 10n);
  assert.equal(r.definition.visibility, "public"); assert.equal(r.definition.editorialStatus, "published"); assert.equal(r.dynamic, true); assert.equal(r.participants.size, 0);
  const metadata = JSON.parse((await child.caseMetaEvidence(guest.address))[0]); assert.equal(metadata.contractProfile.version, 10);
  assert.equal(metadata.upgradeGovernance.delaySeconds, 0); assert.equal(metadata.fileURI, policy.uri);
  assert.equal(r.deployment.controllerDeploymentTxHash, F.controllerDeploymentTxHash); assert.equal(r.deployment.timelockDeploymentTxHash, undefined);
  assert.deepEqual(await f.service.reconcile(f.session, draft.id, tx.hash), result);
  assert.equal((await f.service.recordSubmitted(f.session, draft.id, tx.hash)).status, "confirmed"); assert.equal(forbiddenCalls, 0);
}));

test("pending and provenance-failed V10 creation preserves one hash and recovers after restart/expiry without a signing guard", async () => isolated(async f => {
  const draft = await f.service.createDraft(f.session, await f.terms()), tx = await organizer.sendTransaction(draft.transaction); await tx.wait();
  await f.service.recordSubmitted(f.session, draft.id, tx.hash); faults.nullReceipt = true;
  assert.equal((await f.service.reconcile(f.session, draft.id, tx.hash)).status, "pending"); delete faults.nullReceipt;
  await assert.rejects(f.service.createDraft(f.session, await f.terms()), code("PENDING_FACTORY_CREATION"));
  const readCount = faults.txReads; await assert.rejects(f.service.recordSubmitted(f.session, draft.id, ethers.id("different-hash")), code("TX_MISMATCH")); assert.equal(faults.txReads, readCount);
  faults.factoryCode = true; await assert.rejects(f.service.reconcile(f.session, draft.id, tx.hash)); delete faults.factoryCode;
  assert.equal(f.events.size, 0); const saved = f.store.load(); assert.equal(saved.drafts[0][1].submittedHash, tx.hash); assert.equal(saved.drafts[0][1].adoptionStatus, "unavailable");
  const freshEvents = new Map(), freshDrafts = new Map(saved.drafts), restarted = createV10FactoryOnboardingService({ ...f.options, events: freshEvents, drafts: freshDrafts, instanceId: "restarted-instance" });
  const originalExpiry = saved.drafts[0][1].expiresAt, clock = Date.now;
  Date.now = () => originalExpiry + 1;
  await rpc.request({ method: "evm_setAccountCode", params: [organizer.address, "0x00"] }); faults.forbidWallet = true;
  const checks = walletChecks;
  try {
    const result = await restarted.reconcile({ ...f.session, id: "fresh-session" }, draft.id, tx.hash); assert.equal(result.status, "confirmed");
    assert.equal(freshEvents.size, 1); assert.equal(walletChecks, checks); assert.equal(restarted.getDraft(f.session, draft.id).submittedHash, tx.hash);
  } finally { Date.now = clock; }
}));

test("late controller ownership, code acquisition and canonical-header changes reject new V10 signing reviews", async () => {
  for (const fault of ["mutateAt", "codeAt", "finalReorg"]) await isolated(async f => {
    faults[fault] = fault === "finalReorg" ? true : 2;
    await assert.rejects(f.service.createDraft(f.session, await f.terms()), code(fault === "mutateAt" ? "STALE_DRAFT" : fault === "codeAt" ? "UNSUPPORTED_WALLET" : "FACTORY_REORG"));
    assert.equal(f.drafts.size, 0); assert.equal(f.events.size, 0);
  });
});

test("verified renounced V10 controller still permits permissionless creation without restoring upgrade authority", async () => isolated(async f => {
  await send(controller.renounceOwnership(gas)); assert.equal(await controller.owner(), ethers.ZeroAddress); assert.equal(await controller.upgradesDisabled(), true);
  const draft = await f.service.createDraft(f.session, await f.terms()), tx = await organizer.sendTransaction(draft.transaction); await tx.wait();
  const result = await f.service.reconcile(f.session, draft.id, tx.hash); assert.equal(result.status, "confirmed");
  assert.equal(await controller.owner(), ethers.ZeroAddress); assert.equal(await controller.pendingOwner(), ethers.ZeroAddress);
}));

test("non-direct creation requires an exact trusted factual proof; raw transaction stays unchanged and no wallet eligibility is inferred", async () => isolated(async f => {
  const draft = await f.service.createDraft(f.session, await f.terms()), tx = await organizer.sendTransaction(draft.transaction); await tx.wait();
  faults.envelopeHash = tx.hash; await assert.rejects(f.service.recordSubmitted(f.session, draft.id, tx.hash), code("TX_MISMATCH"));
  let bad = true, mutate = false, proofs = 0;
  chain.assertTransactionIntent = async (actual, expected) => {
    proofs++; assert.equal(actual.to, MAINNET_KLEROS.resolver); assert.equal(actual.data, "0x1234"); assert.equal(Object.isFrozen(expected), true);
    const canonical = await provider.getTransaction(expected.transactionHash);
    assert.equal(canonical.from, expected.from); assert.equal(canonical.to, expected.to); assert.equal(canonical.data, expected.data);
    if (mutate) actual.authorizationList = [];
    return { verified: true, chainId: 1, transactionHash: expected.transactionHash, from: expected.from, to: expected.to,
      valueWei: "0", dataHash: bad ? ethers.ZeroHash : ethers.keccak256(expected.data) };
  };
  await assert.rejects(f.service.recordSubmitted(f.session, draft.id, tx.hash), code("TX_MISMATCH")); assert.equal(f.drafts.get(draft.id).submittedHash, tx.hash);
  bad = false; mutate = true;
  await assert.rejects(f.service.recordSubmitted(f.session, draft.id, tx.hash), code("TX_MISMATCH")); assert.equal(f.drafts.get(draft.id).submittedHash, tx.hash);
  mutate = false; await f.service.recordSubmitted(f.session, draft.id, tx.hash);
  const result = await f.service.reconcile(f.session, draft.id, tx.hash); assert.equal(result.status, "confirmed"); assert.ok(proofs >= 3);
  assert.equal((await backend.getTransaction(tx.hash)).data, "0x1234"); assert.equal(forbiddenCalls, 0);
}));
