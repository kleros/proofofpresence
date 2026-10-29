// Real v9 proxies and workbench financial methods on an in-process chain1 only.
// Trusted dependency injection bypasses public mainnet configuration/Court verification;
// those have separate runtime/fork tests. Only Court adjudication is controlled here.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import { createWorkbench } from "../src/workbench.mjs";
import { hash } from "../src/utils.mjs";
import { loadUpgradeableArtifacts, UPGRADEABLE_VERSION } from "../src/upgrade-verification.mjs";
import { isVerifiedProductionEvent } from "../public/contract-profiles.js";

const D = 1000000000000n, DAY = 86400, A = "production-local-a", B = "production-local-b";
const GAS = { gasLimit: 8_000_000 }, send = async (p) => (await p).wait();
let rpc, provider, w, owner, alice, bob, credit, sessions, records, liquid, resolver, runtime;
let persisted = 0;
const reads = [], forbiddenBackendCalls = [];
const race = { wallet: null, provenanceReads: 0, triggered: false };
const trustFault = { contract: null };
const lower = (s) => String(s).toLowerCase();
const attendancePaid = (projection, wallet) => projection.transfers
  .filter((t) => t.type === "attendance-payout" && t.successful && lower(t.recipient) === lower(wallet))
  .reduce((sum, t) => sum + BigInt(t.amountWei), 0n);

before(async () => {
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 }, wallet: { totalAccounts: 6, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  // Ephemeral synthetic account material is created by Ganache in this process only.
  [owner, alice, bob, credit] = Object.values(rpc.getInitialAccounts()).slice(0, 4)
    .map((account) => new ethers.Wallet(account.secretKey, provider));
  const artifacts = loadUpgradeableArtifacts();
  const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../references/kickback/build/${name}.json`, import.meta.url)));
  const deploy = async (artifact, ...args) => {
    const c = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner).deploy(...args, { gasLimit: 16_000_000 });
    await c.waitForDeployment(); return c;
  };
  const governance = await deploy(fixture("TestWallet"));
  const timelock = await deploy(artifacts.timelock, governance.target);
  const eventImplementation = await deploy(artifacts.event), factoryImplementation = await deploy(artifacts.factory);
  const proxy = await deploy(artifacts.proxy, factoryImplementation.target,
    factoryImplementation.interface.encodeFunctionData("initialize", [eventImplementation.target, timelock.target]));
  const factory = new ethers.Contract(proxy.target, artifacts.factory.abi, owner);
  liquid = await deploy(fixture("MockKlerosLiquid"));
  resolver = await deploy(fixture("MockArbitrableProxy"), liquid.target);
  const factoryBirth = await proxy.deploymentTransaction().wait(), timelockBirth = await timelock.deploymentTransaction().wait();
  const now = (await provider.getBlock("latest")).timestamp;
  const extra = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]);
  records = [];
  for (const eventId of [A, B]) {
    const definition = { id: eventId, title: `Synthetic ${eventId}`, slug: eventId, description: "In-process test only",
      location: "Synthetic local fixture", timezone: "UTC", visibility: "public", editorialStatus: "published",
      registrationStatus: "open", organizers: [owner.address], staff: [],
      startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 12 * 3600) * 1000).toISOString() };
    const pieces = ['{"wallet":"', '","contract":"', '","organizer":"', '"}'], slots = "0x010204";
    const policy = "https://example.invalid/local-production-policy", key = ethers.id(eventId);
    const config = { depositAmount: D, eventName: definition.title, eventStart: now + 3600, claimDeadline: now + 8 * DAY,
      arbitration: { disputeResolver: resolver.target, extraData: extra, metaEvidenceTemplate: pieces,
        metaEvidenceSlots: slots, policyURI: policy } };
    const receipt = await send(factory.createEvent(key, config, GAS));
    const created = receipt.logs.filter((log) => lower(log.address) === lower(factory.target))
      .map((log) => factory.interface.parseLog(log)).find((log) => log?.name === "EventCreated");
    const deployment = { eventId, contractVersion: UPGRADEABLE_VERSION, abiVersion: UPGRADEABLE_VERSION, chainId: 1,
      contract: created.args.eventContract, factory: factory.target, creator: owner.address, owner: owner.address,
      implementation: eventImplementation.target, factoryImplementation: factoryImplementation.target,
      initialImplementation: eventImplementation.target, initialFactoryImplementation: factoryImplementation.target,
      implementationRevision: 1, factoryImplementationRevision: 1,
      implementationCodeHash: ethers.keccak256(await provider.getCode(eventImplementation.target)),
      factoryImplementationCodeHash: ethers.keccak256(await provider.getCode(factoryImplementation.target)),
      upgradeAuthority: timelock.target, upgradeAuthorityCodeHash: ethers.keccak256(await provider.getCode(timelock.target)),
      projectMultisig: governance.target, codeHash: ethers.keccak256(await provider.getCode(created.args.eventContract)),
      factoryCodeHash: ethers.keccak256(await provider.getCode(factory.target)),
      factoryDeploymentTxHash: factoryBirth.hash, factoryDeploymentBlock: factoryBirth.blockNumber,
      timelockDeploymentTxHash: timelockBirth.hash, timelockDeploymentBlock: timelockBirth.blockNumber,
      deploymentTxHash: receipt.hash, deploymentBlock: receipt.blockNumber, eventKey: key,
      factoryEventId: created.args.eventId, configurationHash: created.args.configurationHash,
      depositWei: String(D), eventName: definition.title, eventStart: config.eventStart, claimDeadline: config.claimDeadline,
      depositOpensAt: now, depositDeadline: config.eventStart, resolver: resolver.target, arbitrator: liquid.target,
      arbitratorExtraData: extra, policyURI: policy, templateHash: hash([pieces, slots]) };
    records.push({ definition, deployment, pieces, slots, policy: "Synthetic immutable policy" });
  }
  await send(credit.sendTransaction({ to: records[1].deployment.contract, value: D, gasLimit: 100000 }));
  const backendProvider = new Proxy(provider, { get(target, key) {
    if (["broadcastTransaction", "getSigner", "listAccounts"].includes(key)) return async () => {
      forbiddenBackendCalls.push(key); throw Error("Backend must remain keyless");
    };
    if (key === "send") return async (method, params) => {
      reads.push({ method, address: method === "eth_getCode" ? params[0] : null });
      assert.ok(!/^(eth_send|eth_sign|personal_|evm_)/.test(method), "No mutable runtime RPC");
      return provider.send(method, params);
    };
    if (key === "getLogs") return async (filter) => {
      const logs = await provider.getLogs(filter);
      // There are two complete provenance checks per unsigned create/validate.
      // Acquire actual account code while the SECOND check is still awaiting history.
      if (race.wallet && Array.isArray(filter.address) && ++race.provenanceReads === 2) {
        await rpc.request({ method: "evm_setAccountCode", params: [race.wallet, "0x00"] });
        race.triggered = true;
      }
      return logs;
    };
    if (key === "getCode") return async (address, tag) => lower(address) === lower(trustFault.contract)
      ? "0x00" : provider.getCode(address, tag);
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  const manifest = { environment: "production", chain: { chainId: 1, name: "Ethereum",
    rpcUrl: "https://synthetic.invalid", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
    provenance: { v9BuildManifestSha256: hash(JSON.parse(fs.readFileSync(new URL("../build/contracts-v9/manifest.json", import.meta.url)))),
      v9StandardInputSha256: hash(JSON.parse(fs.readFileSync(new URL("../build/contracts-v9/standard-input.json", import.meta.url)))) },
    arbitration: { mode: "kleros-v1", resolver: resolver.target, arbitrator: liquid.target },
    governance: { kind: "project-multisig", multisig: governance.target,
      expectedCodeHash: ethers.keccak256(await provider.getCode(governance.target)), minimumDelaySeconds: 172800 }, events: records };
  runtime = { provider: backendProvider, chainId: 1, production: true, financialModel: "v8", governance: manifest.governance, manifest,
    rpcUrl: manifest.chain.rpcUrl, signers: [], resolver: new ethers.Contract(resolver.target, resolver.interface, backendProvider),
    liquid: new ethers.Contract(liquid.target, liquid.interface, backendProvider), close: async () => {} };
  w = await createWorkbench({ contractVersion: UPGRADEABLE_VERSION, production: { manifest, stateFile: "/unused-test-store" } },
    { productionRuntime: async () => runtime, productionStore: () => ({ load: () => null, save: () => { persisted++; } }) });
  sessions = Object.fromEntries(await Promise.all(Object.entries({ owner, alice, bob, credit }).map(async ([role, wallet]) => {
    const message = `Synthetic workbench ${role} session only`;
    assert.equal(ethers.verifyMessage(message, await wallet.signMessage(message)), wallet.address);
    return [role, { id: `synthetic-${role}`, wallet: wallet.address, label: role, mode: "wallet" }];
  })));
});
after(async () => { await w?.close(); provider?.destroy(); await rpc?.disconnect(); });

async function walletAction(eventId, role, action, params = {}, reconcile = false) {
  const s = sessions[role], signer = { owner, alice, bob, credit }[role];
  const draft = await w.createDraft(eventId, s, { action, params });
  const validated = await w.validateDraft(eventId, s, draft.id);
  assert.equal(validated.d.transaction.from, signer.address);
  assert.equal(validated.d.transaction.chainId, 1);
  assert.equal(validated.d.snapshot, (await w.state(eventId)).fingerprint);
  const sent = await signer.sendTransaction({ ...validated.d.transaction, ...GAS });
  const submitted = await w.recordSubmitted(eventId, s, draft.id, sent.hash);
  assert.equal(submitted.status, "pending");
  const receipt = await sent.wait(); assert.equal(receipt.status, 1);
  const result = reconcile ? await w.reconcileSubmission(eventId, s, draft.id, sent.hash)
    : await w.confirmDraft(eventId, s, draft.id, sent.hash);
  assert.equal(result.status, "confirmed");
  return { draft, receipt, hash: sent.hash };
}

test("actual production bootstrap and detail DTOs satisfy the verified UI profile contract", { timeout: 60000 }, async () => {
  const bundle = await w.bootstrap(sessions.owner, { selectedEventId: B });
  assert.equal(bundle.mode, "hosted-production");
  assert.equal(bundle.selectedEvent.detail.deploymentTrust.status, "verified");
  assert.equal(bundle.selectedEvent.detail.upgrade.kind, "uups");
  const summary = bundle.events.find((event) => event.id === B), detail = await w.detail(B, sessions.owner);
  for (const event of [summary, bundle.selectedEvent.detail.event, detail.event]) {
    assert.equal(event.contractVersion, UPGRADEABLE_VERSION);
    assert.equal(event.abiVersion, UPGRADEABLE_VERSION);
    assert.equal(event.contractProfile.verified, true);
    assert.equal(event.contractProfile.version, 9);
    assert.equal(event.contractProfile.challengeWindowSeconds, DAY);
    assert.equal(event.contractProfile.matchWindowSeconds, DAY);
    assert.equal(isVerifiedProductionEvent(event), true, "Real API DTO must pass actual UI gate");
  }
});

test("an unreviewed private A cannot deny valid B or disclose private A in production bootstrap", { timeout: 60000 }, async () => {
  const a = w.record(A, sessions.owner), original = { visibility: a.definition.visibility, description: a.definition.description };
  const secret = "PRIVATE_A_UNREVIEWED_METADATA_SENTINEL";
  try {
    a.definition.visibility = "private"; a.definition.description = secret;
    trustFault.contract = a.deployment.contract;
    const selectedB = await w.bootstrap(sessions.owner, { selectedEventId: B });
    assert.equal(selectedB.selectedEvent.detail.event.id, B);
    assert.equal(selectedB.selectedEvent.detail.deploymentTrust.status, "verified");
    assert.deepEqual(selectedB.events.map((event) => event.id), [B]);
    const selectedA = await w.bootstrap(sessions.owner, { selectedEventId: A });
    assert.equal(selectedA.selectedEvent.detail, null);
    assert.equal(selectedA.selectedEvent.error.code, "SELECTED_EVENT_UNAVAILABLE");
    assert.deepEqual(selectedA.events.map((event) => event.id), [B]);
    const directory = await w.bootstrap(sessions.owner);
    assert.deepEqual(directory.events.map((event) => event.id), [B]);
    for (const response of [selectedB, selectedA, directory]) {
      const encoded = JSON.stringify(response);
      assert.equal(encoded.includes(secret), false);
      assert.equal(encoded.includes(a.definition.title), false);
      assert.equal(encoded.includes(a.deployment.contract), false);
    }
  } finally { trustFault.contract = null; Object.assign(a.definition, original); }
  assert.equal((await w.detail(A, sessions.owner)).deploymentTrust.status, "verified", "Restore before financial execution");
});

test("proxy-backed production workbench completes deposits to held share to same-wallet paid settlement", { timeout: 90000 }, async () => {
  assert.deepEqual(w.chain.signers, []);
  const a = await w.registerParticipant(A, sessions.alice, { name: "Synthetic Alice", email: "alice@example.test" });
  const b = await w.registerParticipant(A, sessions.bob, { name: "Synthetic Bob", email: "bob@example.test" });
  await walletAction(A, "alice", "deposit");
  await walletAction(A, "bob", "deposit", {}, true);
  assert.equal((await w.detail(A, sessions.alice)).ownWallet.pendingCreditWei, String(D));
  const bBefore = await w.state(B);
  await w.admit(A, sessions.owner, a.id, "approved");
  await w.admit(A, sessions.owner, b.id, "approved");
  await walletAction(A, "owner", "register", { wallets: [alice.address, bob.address] });
  assert.equal((await w.state(A)).poolWei, String(2n * D));
  assert.equal((await w.state(A)).pendingTotalWei, "0");
  await assert.rejects(w.executeDraft(A, sessions.owner, "anything"), (e) => e.code === "WALLET_SIGNATURE_REQUIRED");
  await assert.rejects(w.advance(DAY), (e) => e.status === 403);
  await assert.rejects(w.mockRuling(A, sessions.owner, bob.address, 1), (e) => e.status === 403);
  await rpc.request({ method: "evm_setTime", params: [records[0].deployment.eventStart * 1000] });
  await rpc.request({ method: "evm_mine", params: [] });
  await w.checkin(A, sessions.owner, { participantId: a.id, source: "staff-door", nonce: "synthetic-production-alice" });
  await walletAction(A, "owner", "postAttendance");
  await walletAction(A, "bob", "challenge", {}, true);
  await walletAction(A, "owner", "match", { wallet: bob.address });
  const listed = await w.state(A), challenge = listed.cases[0];
  assert.equal(challenge.state, "Disputed"); assert.equal(challenge.finalRuling, null);
  assert.ok(challenge.localDisputeID !== null && challenge.arbitratorDisputeID !== null);
  await rpc.request({ method: "evm_setTime", params: [(listed.challengeEndsAt + 1) * 1000] });
  await rpc.request({ method: "evm_mine", params: [] });
  const aliceBefore = await provider.getBalance(alice.address);
  await walletAction(A, "owner", "release");
  const ordinary = await w.state(A);
  assert.equal((await provider.getBalance(alice.address)) - aliceBefore, D);
  assert.equal(ordinary.heldBackWei, String(D)); assert.equal(ordinary.cases[0].finalRuling, null);
  assert.equal(ordinary.owedTotalWei, "0");
  const paidBeforeRuling = (await w.detail(A, sessions.bob)).payments;
  assert.equal(paidBeforeRuling.directAttendancePaidWei, String(D));
  assert.equal(attendancePaid(paidBeforeRuling, alice.address), D);
  assert.equal(attendancePaid(paidBeforeRuling, bob.address), 0n);
  // This is the sole controlled adjudication step; every event financial action above/below uses drafts.
  await send(liquid.giveFinalRuling(challenge.arbitratorDisputeID, 1, GAS));
  assert.equal((await w.state(A)).cases[0].finalRuling, 1);
  assert.equal((await w.state(A)).heldBackWei, String(D));
  const bobBefore = await provider.getBalance(bob.address), bobNonce = await provider.getTransactionCount(bob.address);
  await walletAction(A, "owner", "resolve", { wallet: bob.address }, true);
  const detail = await w.detail(A, sessions.bob), state = detail.state;
  assert.equal((await provider.getBalance(bob.address)) - bobBefore, D + BigInt(challenge.depositWei));
  assert.equal(await provider.getTransactionCount(bob.address), bobNonce, "Owner pays settlement gas, same Bob receives funds");
  assert.equal(detail.payments.directAttendancePaidWei, String(2n * D));
  assert.equal(attendancePaid(detail.payments, alice.address), D);
  assert.equal(attendancePaid(detail.payments, bob.address), D);
  for (const key of ["balanceWei", "reservedWei", "heldBackWei", "owedTotalWei", "challengeEscrowWei", "pendingTotalWei"])
    assert.equal(state[key], "0", key);
  assert.equal(state.pendingChallenges, 0); assert.equal(state.cases[0].state, "Resolved");
  assert.equal(detail.deploymentTrust.status, "verified"); assert.equal(detail.upgrade.kind, "uups");
  assert.equal((await w.state(B)).fingerprint, bBefore.fingerprint, "Independent proxy credit remains untouched");
  assert.deepEqual(forbiddenBackendCalls, []); assert.ok(persisted > 0);
});

test("code acquired during final provenance await rejects unsigned production create and validate", { timeout: 60000 }, async () => {
  const params = { to: credit.address, amountWei: "1" };
  const acquireDuringFinalProvenance = () => Object.assign(race, { wallet: credit.address, provenanceReads: 0, triggered: false });
  const clear = async () => { race.wallet = null; await rpc.request({ method: "evm_setAccountCode", params: [credit.address, "0x"] }); };
  try {
    acquireDuringFinalProvenance();
    await assert.rejects(w.createDraft(B, sessions.credit, { action: "withdrawPending", params }), (e) => e.code === "UNSUPPORTED_WALLET");
    assert.equal(race.triggered, true); await clear();
    const draft = await w.createDraft(B, sessions.credit, { action: "withdrawPending", params });
    acquireDuringFinalProvenance();
    await assert.rejects(w.validateDraft(B, sessions.credit, draft.id), (e) => e.code === "UNSUPPORTED_WALLET");
    assert.equal(race.triggered, true);
    assert.equal(await w.contract(B).pendingDeposits(credit.address), D, "Rejected drafts move no money");
  } finally { await clear(); }
});

test("already signed canonical hash reconciles for now-coded wallet without invoking EOA signing guard", { timeout: 60000 }, async () => {
  const draft = await w.createDraft(B, sessions.credit, { action: "withdrawPending", params: { to: credit.address, amountWei: "1" } });
  const reviewed = await w.validateDraft(B, sessions.credit, draft.id);
  const sent = await credit.sendTransaction({ ...reviewed.d.transaction, ...GAS });
  await w.recordSubmitted(B, sessions.credit, draft.id, sent.hash);
  assert.equal((await sent.wait()).status, 1);
  await rpc.request({ method: "evm_setAccountCode", params: [credit.address, "0x00"] });
  try {
    const before = reads.filter((read) => read.method === "eth_getCode" && lower(read.address) === lower(credit.address)).length;
    const refreshedSession = { ...sessions.credit, id: "new-signed-session-same-wallet" };
    const result = await w.reconcileSubmission(B, refreshedSession, draft.id, sent.hash);
    assert.equal(result.status, "confirmed");
    assert.equal(result.hash, sent.hash);
    assert.equal(await w.contract(B).pendingDeposits(credit.address), D - 1n);
    assert.equal(reads.filter((read) => read.method === "eth_getCode" && lower(read.address) === lower(credit.address)).length, before);
    assert.deepEqual(forbiddenBackendCalls, []);
  } finally { await rpc.request({ method: "evm_setAccountCode", params: [credit.address, "0x"] }); }
});

test("production recovery identities disclose only the current wallet's own saved reviews", { timeout: 60000 }, async () => {
  // Reuse actual A financial reviews and B credit-recovery reviews from this fixture.
  // No new draft, financial call, deployment or session-auth implementation is introduced.
  const a = w.record(A, sessions.owner), original = {
    visibility: a.definition.visibility, title: a.definition.title, description: a.definition.description,
  };
  const privateTitle = "PRIVATE_A_RECOVERY_TITLE", privateDescription = "PRIVATE_A_RECOVERY_FINANCIAL_METADATA";
  const identity = (eventId) => {
    const { deployment: d } = records.find((r) => r.definition.id === eventId);
    return { id: eventId, chainId: d.chainId, contract: d.contract,
      contractVersion: d.contractVersion, abiVersion: d.abiVersion };
  };
  const assertRecovery = (response, eventIds) => {
    assert.deepEqual(response.recoveryEvents, eventIds.map(identity));
    for (const item of response.recoveryEvents)
      assert.deepEqual(Object.keys(item).sort(), ["abiVersion", "chainId", "contract", "contractVersion", "id"],
        "Saved review discovery exposes no title, participant, financial state or governance data");
    assert.equal(JSON.stringify(response).includes(privateTitle), false);
    assert.equal(JSON.stringify(response).includes(privateDescription), false);
  };
  try {
    a.definition.visibility = "private"; a.definition.title = privateTitle; a.definition.description = privateDescription;
    trustFault.contract = a.deployment.contract;
    const replacement = { ...sessions.credit, id: "replacement-wallet-session", wallet: await (await provider.getSigner(4)).getAddress() };
    const [ownDirectory, ownSelected, foreignDirectory, foreignSelected, anonymousDirectory, anonymousSelected, replacementDirectory, replacementSelected] = await Promise.all([
      w.bootstrap(sessions.alice),
      w.bootstrap({ ...sessions.alice, id: "refreshed-session-same-wallet" }, { selectedEventId: A }),
      w.bootstrap(sessions.credit),
      w.bootstrap(sessions.credit, { selectedEventId: A }),
      w.bootstrap(null), w.bootstrap(null, { selectedEventId: B }),
      w.bootstrap(replacement), w.bootstrap(replacement, { selectedEventId: B }),
    ]);
    for (const response of [ownDirectory, ownSelected]) assertRecovery(response, [A]);
    assert.equal(ownSelected.selectedEvent.detail, null, "A saved identity cannot restore trust or authorize a new financial action");
    for (const response of [foreignDirectory, foreignSelected]) {
      assertRecovery(response, [B]);
      assert.equal(JSON.stringify(response).includes(a.deployment.contract), false, "Another wallet's private review identity must not leak");
    }
    for (const response of [anonymousDirectory, anonymousSelected, replacementDirectory, replacementSelected]) {
      assertRecovery(response, []);
      assert.equal(JSON.stringify(response).includes(a.deployment.contract), false);
    }
    assert.equal(replacementSelected.selectedEvent.wallet, replacement.wallet);
    await assert.rejects(w.createDraft(A, sessions.alice, { action: "claim", params: { to: alice.address } }),
      (error) => error.code === "WRONG_CONTRACT" && error.status === 409,
      "Minimal recovery identity must never bypass the production implementation-trust gate");
    assert.deepEqual(forbiddenBackendCalls, []);
  } finally { trustFault.contract = null; Object.assign(a.definition, original); }
});
