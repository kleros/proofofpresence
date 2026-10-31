// Actual local V10 proxies/onboarding/workbench and HTTP nonce auth. Court code is mocked locally;
// trusted runtime injection bypasses public RPC/Court verification. No public network or user keys.
import { before, after, test } from "node:test";
import { productionContextIssue } from "../public/environment.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { createWorkbench } from "../src/workbench.mjs";
import { startServer } from "../src/server.mjs";
import { createOrganizerJobService } from "../src/organizer-jobs.mjs";
import { V10_WALLET_CAPABILITIES, V10_WALLET_SUPPORT } from "../src/v10-production-wallets.mjs";
import { v10MainnetStateStore } from "../src/v10-mainnet-runtime.mjs";
import { loadV10UpgradeableArtifacts } from "../src/v10-upgrade-artifacts.mjs";
import { publicCatalogSnapshot } from "../src/public-catalog.mjs";
import { MAINNET_KLEROS, MAINNET_EXTRA_DATA } from "../scripts/mainnet/verify-kleros.mjs";

const PROFILE = "kleros-event-v10-uups", publicOrigin = "https://v10-app.example.invalid", backendOrigin = "https://v10-backend.example.invalid";
const proxySecret = "synthetic_v10_proxy_" + "1234567890abcdef".repeat(4);
let rpc, provider, runtime, manifest, app, w, dir, stateFile, organizer, guest, ownerWallet, cookie, draft, created, reads = 0, forbidden = 0;
let failTransactionRead = false, forgedType4 = false, deliveryReceiptHidden = false, deliveryReorgBlock = null, deliveryReceiptReorgHash = null;
let observedBirth = null, observedBirthReads = 0, failLateBirthRead = false;
before(async () => {
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" }, miner: { blockGasLimit: 60000000 }, wallet: { totalAccounts: 4, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  const owner = await provider.getSigner(0), a = loadV10UpgradeableArtifacts();
  [organizer, guest] = Object.values(rpc.getInitialAccounts()).slice(1, 3).map(row => new ethers.Wallet(row.secretKey, provider));
  ownerWallet = new ethers.Wallet(Object.values(rpc.getInitialAccounts())[0].secretKey, provider);
  const deploy = async (artifact, ...args) => { const c = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner).deploy(...args, { gasLimit: 16000000 }); await c.waitForDeployment(); return c; };
  const controller = await deploy(a.controller, owner.address), eventImpl = await deploy(a.event), factoryImpl = await deploy(a.factory),
    proxy = await deploy(a.proxy, factoryImpl.target, factoryImpl.interface.encodeFunctionData("initialize", [eventImpl.target, controller.target]));
  const mock = name => JSON.parse(fs.readFileSync(new URL(`../references/kickback/build/${name}.json`, import.meta.url)));
  const liquidCode = await deploy(mock("MockKlerosLiquid")), resolverCode = await deploy(mock("MockArbitrableProxy"), MAINNET_KLEROS.arbitrator);
  await rpc.request({ method: "evm_setAccountCode", params: [MAINNET_KLEROS.arbitrator, await provider.getCode(liquidCode.target)] });
  await rpc.request({ method: "evm_setAccountCode", params: [MAINNET_KLEROS.resolver, await provider.getCode(resolverCode.target)] });
  const birth = await proxy.deploymentTransaction().wait(), controllerBirth = await controller.deploymentTransaction().wait(),
    policyText = fs.readFileSync(new URL("../docs/contracts/v10-luma-generic-policy.md", import.meta.url), "utf8");
  const F = { chainId: 1, contractVersion: PROFILE, abiVersion: PROFILE, factory: proxy.target, factoryCodeHash: ethers.keccak256(await provider.getCode(proxy.target)),
    factoryImplementation: factoryImpl.target, factoryImplementationCodeHash: ethers.keccak256(await provider.getCode(factoryImpl.target)), initialFactoryImplementation: factoryImpl.target,
    implementation: eventImpl.target, implementationCodeHash: ethers.keccak256(await provider.getCode(eventImpl.target)), initialImplementation: eventImpl.target,
    upgradeAuthority: controller.target, upgradeAuthorityCodeHash: ethers.keccak256(await provider.getCode(controller.target)), initialUpgradeOwner: owner.address,
    factoryDeploymentTxHash: birth.hash, factoryDeploymentBlock: birth.blockNumber, controllerDeploymentTxHash: controllerBirth.hash, controllerDeploymentBlock: controllerBirth.blockNumber,
    policy: { contractVersion: PROFILE, uri: "https://policy.example.invalid/v10.md", sha256: hash(policyText), text: policyText }, policyStatus: "published" };
  const governance = { kind: "single-owner-immediate", initialOwner: owner.address, upgradeDelaySeconds: 0, renounceable: true };
  manifest = { environment: "production", chain: { chainId: 1, name: "Ethereum", rpcUrl: "https://ethereum.example.invalid", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
    factoryDeployment: F, events: [], governance, arbitration: { mode: "kleros-v1", resolver: MAINNET_KLEROS.resolver, arbitrator: MAINNET_KLEROS.arbitrator, extraData: MAINNET_EXTRA_DATA },
    provenance: Object.fromEntries([["v10BuildManifestSha256", "manifest"], ["v10StandardInputSha256", "standard-input"]]
      .map(([key, file]) => [key, hash(JSON.parse(fs.readFileSync(new URL(`../build/contracts-v10/${file}.json`, import.meta.url))))])) };
  const backend = new Proxy(provider, { get(target, key) {
    if (["getSigner", "listAccounts", "broadcastTransaction"].includes(key)) return async () => { forbidden++; throw Error("No backend signing"); };
    const value = target[key]; return typeof value === "function" ? async (...args) => { reads++;
      if (key === "getTransaction" && failTransactionRead) throw Error("Synthetic transaction read failure");
      if (key === "getTransactionReceipt" && deliveryReceiptHidden) return null;
      if (key === "getTransactionReceipt" && args[0] === observedBirth) {
        observedBirthReads++;
        if (failLateBirthRead && observedBirthReads === 2) throw Error("Synthetic late provenance failure");
      }
      const result = await value.apply(target, args);
      if (key === "getTransactionReceipt" && deliveryReceiptReorgHash !== null && result)
        return { ...result, blockHash: deliveryReceiptReorgHash };
      if (key === "getBlock" && deliveryReorgBlock !== null && Number(args[0]) === deliveryReorgBlock && result)
        return { ...result, hash: ethers.id("synthetic-confirm-delivery-reorg") };
      return key === "getTransaction" && forgedType4 && result ? new Proxy(result, { get(tx, name) { return name === "type" ? 4 : Reflect.get(tx, name); } }) : result;
    } : value;
  } });
  runtime = { provider: backend, chainId: 1, production: true, signers: [], financialModel: "v8", governance, manifest,
    factoryDeployment: F, eventVerification: new Map(), resolver: new ethers.Contract(MAINNET_KLEROS.resolver, resolverCode.interface, backend),
    liquid: new ethers.Contract(MAINNET_KLEROS.arbitrator, liquidCode.interface, backend), close: async () => {} };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "v10-app-dispatch-")); stateFile = path.join(dir, "v10-state.json"); await launch();
});
after(async () => { await app?.close(); provider?.destroy(); await rpc?.disconnect(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
async function launch() {
  app = await startServer({ port: 0, rpcPort: 0, production: { manifest, stateFile },
    deployment: { mode: "hosted-production", publicOrigin, backendOrigin, proxySecret, runtimeRoot: dir } }, {
    workbenchFactory: async options => { w = await createWorkbench(options, { productionRuntime: async () => runtime }); return w; },
  });
}
async function request(route, { method = "GET", payload, session = cookie } = {}) {
  const url = new URL(route, app.url); assert.equal(url.hostname, "127.0.0.1");
  const headers = { host: new URL(backendOrigin).host, "x-kleros-proxy-key": proxySecret,
    ...(method === "GET" ? {} : { origin: publicOrigin, "content-type": "application/json" }), ...(session ? { cookie: session } : {}) };
  return new Promise((resolve, reject) => { const req = http.request(url, { method, headers, agent: false }, res => {
    const chunks = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => { const raw = Buffer.concat(chunks).toString();
      resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(raw) }); });
  }); req.on("error", reject); req.end(payload === undefined ? undefined : JSON.stringify(payload)); });
}
async function login(wallet = organizer) {
  const challenge = await request("/api/auth/challenge", { method: "POST", payload: { wallet: wallet.address }, session: null }); assert.equal(challenge.status, 200);
  const verified = await request("/api/auth/verify", { method: "POST", payload: { nonce: challenge.data.nonce, signature: await wallet.signMessage(challenge.data.message) }, session: null });
  assert.equal(verified.status, 200); return verified.headers["set-cookie"][0].split(";")[0];
}
async function job(body) {
  const requestId = randomUUID(), initial = await request("/api/organizer/events/jobs", { method: "POST", payload: { requestId, ...body } });
  assert.equal(initial.status, 202); assert.equal(initial.data.contractVersion, PROFILE);
  for (let i = 0; i < 400; i++) { const result = await request("/api/organizer/events/jobs/" + requestId); assert.equal(result.status, 200);
    if (result.data.state !== "pending") { assert.equal(result.data.state, "ready", JSON.stringify(result.data)); return result.data; }
    await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.fail("Local organizer job did not complete");
}

test("V10 factory-only bootstrap uses immediate metadata, exact jobs profile, source-owned wallet policy and no V9 recovery authority", async () => {
  const boot = await request("/api/bootstrap", { session: null }); assert.equal(boot.status, 200);
  assert.equal(boot.data.contractVersion, PROFILE); assert.equal(boot.data.contractProfile.version, 10); assert.equal(boot.data.factory.verified, true);
  assert.equal(boot.data.abiVersion, PROFILE);
  assert.equal(productionContextIssue(boot.data), null);
  assert.deepEqual(boot.data.governance, manifest.governance); assert.equal(boot.data.factory.upgrade.delaySeconds, 0);
  assert.equal(boot.data.factory.upgrade.governanceKind, "single-owner-immediate"); assert.equal(boot.data.factory.upgrade.pending, undefined);
  assert.equal(boot.data.capabilities.serverSigning, false); assert.equal(boot.data.capabilities.eip7702, V10_WALLET_CAPABILITIES.eip7702);
  for (const [key, value] of Object.entries(V10_WALLET_SUPPORT)) assert.deepEqual(boot.data.walletSupport[key], value);
  assert.match(boot.data.walletSupport.notice, /source-verified MetaMask/);
  assert.deepEqual(boot.data.capabilities.supportedAccountTypes, V10_WALLET_CAPABILITIES.supportedAccountTypes); assert.equal(boot.data.capabilities.casePublication, false);
  assert.equal(boot.data.capabilities.originalCreationRecovery, false);
  const recovery = await request("/api/recovery/auth/challenge", { method: "POST", session: null, payload: { wallet: organizer.address, hash: ethers.id("old") } }); assert.equal(recovery.status, 404);
  await rpc.request({ method: "evm_setAccountCode", params: [guest.address, "0x00"] });
  try { assert.equal((await request("/api/auth/challenge", { method: "POST", session: null, payload: { wallet: guest.address } })).status, 422); }
  finally { await rpc.request({ method: "evm_setAccountCode", params: [guest.address, "0x"] }); }
  cookie = await login(); assert.equal((await request("/api/public-catalog", { session: null })).data.events.length, 0);
});

test("V10 organizer prepare/validate jobs and canonical adoption appear in Your events and strict public recorded catalog", async () => {
  const now = (await provider.getBlock("latest")).timestamp, prepared = await job({ operation: "prepare", input: {
    title: "Synthetic V10 app event", lumaUrl: "https://luma.com/synthetic-v10-app", startsAt: new Date((now + 3600) * 1000).toISOString(),
    endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "UTC", depositEth: "0.000001" } });
  draft = prepared.result; assert.equal(draft.contractVersion, PROFILE); assert.equal(draft.terms.policySha256, manifest.factoryDeployment.policy.sha256);
  assert.equal(draft.origin, publicOrigin); assert.equal(draft.v10Intent.scope.origin, publicOrigin);
  const unboundState = fs.readFileSync(stateFile), unboundReads = reads;
  await assert.rejects(w.reconcileFactorySubmission({ mode: "wallet", wallet: organizer.address, id: "fresh-readonly-session" }, draft.id, ethers.id("unbound-factory-candidate")), { code: "ORIGINAL_HASH_NOT_RECORDED" });
  assert.equal(reads, unboundReads); assert.deepEqual(fs.readFileSync(stateFile), unboundState);
  const validated = await job({ operation: "validate", draftId: draft.id }); assert.deepEqual(validated.result.transaction, draft.transaction);
  const sent = await organizer.sendTransaction(draft.transaction); await sent.wait();
  assert.equal((await request(`/api/organizer/events/drafts/${draft.id}/submitted`, { method: "POST", payload: { hash: sent.hash } })).status, 200);
  const reconciled = await job({ operation: "reconcile", draftId: draft.id, hash: sent.hash }); created = reconciled.result;
  assert.equal(created.status, "confirmed"); assert.equal(created.participantUrl, publicOrigin + "/#event=" + draft.eventId + "&view=participant");
  const boot = await request("/api/bootstrap"); assert.equal(boot.data.events.length, 1); assert.equal(boot.data.events[0].role, "organizer");
  assert.equal(boot.data.events[0].contractVersion, PROFILE); assert.equal(boot.data.events[0].contractProfile.version, 10);
  const startReads = reads, catalog = await request("/api/public-catalog", { session: null }); assert.equal(reads, startReads, "Public catalog must perform zero provider calls");
  assert.equal(catalog.data.contractVersion, PROFILE); assert.equal(catalog.data.events[0].id, draft.eventId); assert.equal(catalog.data.events[0].adoption.txHash, sent.hash);
  assert.equal(catalog.data.events[0].contract, created.contract); assert.equal(catalog.data.catalog.currentFinancialState, "not-loaded");
  assert.equal(catalog.data.events[0].role, undefined); assert.equal(catalog.data.events[0].participants, undefined);
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).namespace, "ethereum-mainnet-v10"); assert.equal(forbidden, 0);
});

test("V10 financial hashes persist before RPC failure and forged direct type4 cannot bypass the sealed adapter", async () => {
  const guestCookie = await login(guest), eventId = draft.eventId;
  const prepared = await request(`/api/events/${eventId}/drafts`, { method: "POST", session: guestCookie, payload: { action: "deposit", params: {} } });
  assert.equal(prepared.status, 201); const deposit = prepared.data;
  assert.equal(deposit.scopeKind, "event-call"); assert.equal(deposit.mode, "hosted-production");
  assert.equal(deposit.origin, publicOrigin); assert.equal(deposit.v10Intent.scope.contract, created.contract);
  const unboundState = fs.readFileSync(stateFile), unboundReads = reads;
  await assert.rejects(w.reconcileSubmission(eventId, { mode: "wallet", wallet: guest.address, id: "fresh-readonly-session" }, deposit.id, ethers.id("unbound-event-candidate")), { code: "ORIGINAL_HASH_NOT_RECORDED" });
  await assert.rejects(w.confirmDraft(eventId, { mode: "wallet", wallet: guest.address, id: deposit.sessionId }, deposit.id, ethers.id("unbound-event-candidate")), { code: "ORIGINAL_HASH_NOT_RECORDED" });
  assert.equal(reads, unboundReads); assert.deepEqual(fs.readFileSync(stateFile), unboundState);
  const sent = await guest.sendTransaction(deposit.transaction); await sent.wait();
  forgedType4 = true;
  try { assert.notEqual((await request(`/api/events/${eventId}/drafts/${deposit.id}/submitted`, { method: "POST", session: guestCookie, payload: { hash: sent.hash } })).status, 200); }
  finally { forgedType4 = false; }
  let saved = JSON.parse(fs.readFileSync(stateFile));
  assert.equal(saved.drafts.find(([key]) => key === deposit.id)[1].submittedHash, sent.hash);
  assert.equal(saved.events.find(row => row.definition.id === eventId).transactions.find(tx => tx.hash === sent.hash).status, "pending");
  const reconciled = await request(`/api/events/${eventId}/submissions/reconcile`, { method: "POST", session: guestCookie, payload: { draftId: deposit.id, hash: sent.hash } });
  assert.equal(reconciled.status, 200); assert.equal(reconciled.data.status, "confirmed");
  assert.equal((await request(`/api/events/${eventId}`, { session: guestCookie })).data.ownWallet.deposit.status, "confirmed");
  await assert.rejects(runtime.assertTransactionIntent(await provider.getTransaction(sent.hash), {
    chainId: 1, transactionHash: sent.hash, from: guest.address, to: manifest.factoryDeployment.factory,
    valueWei: deposit.valueWei, data: deposit.transaction.data,
  }), { code: "V10_RECEIPT_CONTEXT_MISMATCH" });
  const ownerCookie = await login(ownerWallet);
  const other = await request(`/api/events/${eventId}/drafts`, { method: "POST", session: ownerCookie, payload: { action: "deposit", params: {} } });
  assert.equal(other.status, 201); const unknown = ethers.id("synthetic-unknown-v10-submission");
  failTransactionRead = true;
  try { assert.notEqual((await request(`/api/events/${eventId}/drafts/${other.data.id}/submitted`, { method: "POST", session: ownerCookie, payload: { hash: unknown } })).status, 200); }
  finally { failTransactionRead = false; }
  saved = JSON.parse(fs.readFileSync(stateFile));
  assert.equal(saved.drafts.find(([key]) => key === other.data.id)[1].submittedHash, unknown);
  assert.equal(saved.events.find(row => row.definition.id === eventId).transactions.find(tx => tx.hash === unknown).status, "pending");
  const boundState = fs.readFileSync(stateFile), boundReads = reads;
  await assert.rejects(w.reconcileSubmission(eventId, { mode: "wallet", wallet: ownerWallet.address, id: "fresh-readonly-session" }, other.data.id, ethers.id("foreign-typo-candidate")), { code: "TX_MISMATCH" });
  assert.equal(reads, boundReads); assert.deepEqual(fs.readFileSync(stateFile), boundState);
  const store = v10MainnetStateStore(stateFile, manifest);
  for (const mutate of [
    map => { delete map.get(other.data.id).submittedHash; },
    map => map.delete(other.data.id),
    map => map.get(other.data.id).transaction.data = "0x12345678",
  ]) {
    const rewritten = new Map(structuredClone(saved.drafts)); mutate(rewritten);
    assert.throws(() => store.save(w.events, rewritten), { code: "STATE_SCOPE" });
  }
  const pending = await request(`/api/events/${eventId}/submissions/reconcile`, { method: "POST", session: ownerCookie, payload: { draftId: other.data.id, hash: unknown } });
  assert.equal(pending.status, 200); assert.equal(pending.data.status, "pending");
  assert.equal((await request(`/api/events/${eventId}/drafts/${other.data.id}/validate`, { method: "POST", session: ownerCookie, payload: {} })).status, 409);
});

test("V10 nonce-verified payer can receive owner approval and an unsigned exact-wallet registration review without fake contact identity", async () => {
  const eventId = draft.eventId, before = await request(`/api/events/${eventId}`);
  assert.equal(before.status, 200);
  const person = before.data.participants.find(row => row.wallet.toLowerCase() === guest.address.toLowerCase());
  assert(person); assert.equal(person.name, null); assert.equal(person.email, null);
  assert.equal(person.walletVerified, true); assert.equal(person.identityVerified, false); assert.equal(person.deposit.verified, true);
  const countBefore = await provider.getTransactionCount(organizer.address), balanceBefore = await provider.getBalance(created.contract);
  const approved = await request(`/api/events/${eventId}/participants/${person.id}`, { method: "PATCH", payload: { admission: "approved" } });
  assert.equal(approved.status, 200);
  const prepared = await request(`/api/events/${eventId}/drafts`, { method: "POST", payload: { action: "register", params: { wallets: [guest.address] } } });
  assert.equal(prepared.status, 201); assert.equal(prepared.data.action, "register");
  assert.deepEqual(prepared.data.args[0], [guest.address]); assert.equal(prepared.data.valueWei, "0");
  const tx = new ethers.Interface(loadV10UpgradeableArtifacts().event.abi).parseTransaction({ data: prepared.data.transaction.data });
  assert.equal(tx.name, "registerStakers"); assert.deepEqual([...tx.args[0]], [guest.address]);
  const after = await request(`/api/events/${eventId}`), retained = after.data.participants.find(row => row.id === person.id);
  assert.equal(retained.admission, "approved"); assert.equal(retained.identityVerified, false); assert.equal(retained.name, null); assert.equal(retained.email, null);
  assert.equal(retained.registered, false); assert.equal(after.data.state.poolWei, "0");
  assert.equal(after.data.state.pendingTotalWei, before.data.state.pendingTotalWei);
  assert.equal(await provider.getBalance(created.contract), balanceBefore);
  assert.equal(await provider.getTransactionCount(organizer.address), countBefore, "Preparing the review must not sign or register anyone");
});

test("V10 public/private/mixed inventory and immutable template bindings never cross into another profile", async () => {
  const r = w.events.get(draft.eventId), start = reads;
  const privateRecord = { definition: { visibility: "private", get editorialStatus() { throw Error("Private content access"); } } };
  const foreign = structuredClone(r); foreign.definition.id = foreign.deployment.eventId = "foreign-v9"; foreign.deployment.contractVersion = foreign.deployment.abiVersion = "kleros-event-v9-uups";
  const projected = publicCatalogSnapshot({ manifest, events: new Map([[draft.eventId, r], ["private", privateRecord], ["foreign-v9", foreign]]),
    drafts: new Map(JSON.parse(fs.readFileSync(stateFile)).drafts), instanceId: "versioned-public-catalog" });
  assert.deepEqual(projected.events.map(row => row.id), [draft.eventId]); assert.equal(reads, start);
  r.definition.visibility = "private";
  assert.deepEqual((await request("/api/public-catalog", { session: null })).data.events, []);
  const hidden = await request("/api/bootstrap", { session: null }); assert.deepEqual(hidden.data.events, []);
  assert.equal((await request("/api/bootstrap")).data.events[0].role, "organizer");
  assert.throws(() => w.creationRecoveryScope(organizer.address, created.hash), { code: "NOT_FOUND" });
  assert.throws(() => w.caseArtifact(draft.eventId, { mode: "wallet", id: "own", wallet: organizer.address }, organizer.address), { code: "NOT_FOUND" });
});

test("selected V10 async bootstrap delivers the original canonical payments anchor successfully", async () => {
  const eventId = draft.eventId, requestId = randomUUID();
  const started = await request("/api/event-read-jobs", { method: "POST", payload: { requestId, operation: "bootstrap", selectedEventId: eventId } });
  assert.equal(started.status, 202); assert.equal(started.data.kind, "event-read-job"); assert.equal(started.data.result, undefined);
  let delivered;
  for (let i = 0; i < 400; i++) {
    const polled = await request("/api/event-read-jobs/" + requestId); assert.equal(polled.status, 200);
    if (polled.data.state !== "pending") { delivered = polled.data; break; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(delivered?.state, "ready", JSON.stringify(delivered));
  const result = delivered.result, selected = result.selectedEvent, detail = selected.detail;
  assert(detail, JSON.stringify(selected.error)); assert.equal(selected.error, undefined);
  assert.equal(detail.event.id, eventId); assert.equal(detail.event.role, "organizer");
  assert.equal(detail.state.blockHash, undefined, "Selected detail intentionally omits the private state hash");
  assert.equal(detail.payments.blockNumber, detail.state.blockNumber);
  assert.equal(detail.payments.blockHash, (await provider.getBlock(detail.state.blockNumber)).hash);
  assert.equal(detail.payments.contract.toLowerCase(), created.contract.toLowerCase());
  assert.equal(detail.payments.chainId, 1); assert.equal(detail.payments.contractVersion, PROFILE);
  assert.equal(result.capabilities.eventReadJobs, true); assert.equal(selected.instanceId, result.instanceId);
  const same = { id: "delivery-anchor-review", mode: "wallet", wallet: organizer.address };
  for (const mutate of [
    value => { value.selectedEvent.detail.payments.blockNumber++; },
    value => { value.selectedEvent.detail.payments.contract = manifest.factoryDeployment.factory; },
  ]) {
    const changed = structuredClone(result); mutate(changed);
    await assert.rejects(() => w.finalizeReadResult("bootstrap", changed, same, eventId), { code: "SELECTED_EVENT_REORG" });
  }
  const reorged = structuredClone(result); reorged.selectedEvent.detail.payments.blockHash = ethers.id("synthetic-noncanonical-delivery-anchor");
  const rejected = await w.finalizeReadResult("bootstrap", reorged, same, eventId);
  assert.equal(rejected.selectedEvent.detail, null); assert.equal(rejected.selectedEvent.error.code, "SELECTED_EVENT_REORG");
  const consumed = await request("/api/event-read-jobs/" + requestId);
  assert.equal(consumed.data.state, "expired"); assert.equal(consumed.data.result, undefined);
});

test("queued V10 delivery refreshes public, staff and financial-owner access before returning private detail", async () => {
  const eventId = draft.eventId, r = w.events.get(eventId), originalVisibility = r.definition.visibility;
  const own = { id: "queued-original-owner", mode: "wallet", wallet: organizer.address };
  // The earlier ownerWallet deposit test made that wallet a legitimate private
  // participant. Use an unlinked wallet so this test isolates staff revocation.
  const staff = { id: "queued-staff", mode: "wallet", wallet: await (await provider.getSigner(3)).getAddress() };
  const a = loadV10UpgradeableArtifacts(), c = new ethers.Contract(r.deployment.contract, a.event.abi, organizer);
  try {
    r.definition.visibility = "public";
    const publicRead = structuredClone(await w.bootstrap(null, { selectedEventId: eventId }));
    assert.ok(publicRead.selectedEvent.detail);
    r.definition.visibility = "private";
    const hidden = await w.finalizeReadResult("bootstrap", publicRead, null, eventId);
    assert.equal(hidden.selectedEvent.detail, null); assert.deepEqual(hidden.events, []);
    r.definition.staff = [staff.wallet];
    const staffRead = structuredClone(await w.bootstrap(staff, { selectedEventId: eventId }));
    assert.equal(staffRead.selectedEvent.detail.event.role, "staff");
    r.definition.staff = [];
    assert.equal((await w.finalizeReadResult("bootstrap", staffRead, staff, eventId)).selectedEvent.detail, null);
    await assert.rejects(() => w.finalizeReadResult("deposit", { id: "unsigned" }, staff, eventId), { code: "FORBIDDEN" });
    const ownerRead = structuredClone(await w.bootstrap(own, { selectedEventId: eventId }));
    assert.equal(ownerRead.selectedEvent.detail.event.role, "organizer");
    await (await c.transferOwnership(guest.address)).wait();
    await (await c.connect(guest).acceptOwnership()).wait();
    assert.equal((await w.finalizeReadResult("bootstrap", ownerRead, own, eventId)).selectedEvent.detail, null);
    await (await c.connect(guest).transferOwnership(organizer.address)).wait();
    await (await c.acceptOwnership()).wait();
    await w.state(eventId);
  } finally { r.definition.visibility = originalVisibility; r.definition.staff = []; }
});

test("known-hash delivery rejects a removed or reorged receipt and survives current private access loss", async () => {
  const eventId = draft.eventId, r = w.events.get(eventId);
  const confirmed = structuredClone(r.transactions.find(item => item.action === "deposit" && item.status === "confirmed" &&
    item.wallet.toLowerCase() === guest.address.toLowerCase()));
  assert(confirmed?.draftId); assert(ethers.isHexString(confirmed.blockHash, 32));
  assert.equal(confirmed.blockHash, (await provider.getBlock(confirmed.blockNumber)).hash);
  const original = { id: "known-hash-original-wallet", mode: "wallet", wallet: guest.address };
  const visibility = r.definition.visibility, participants = r.participants;
  try {
    r.definition.visibility = "private";
    r.participants = new Map([...participants].filter(([, person]) => person.wallet.toLowerCase() !== guest.address.toLowerCase()));
    assert.throws(() => w.record(eventId, original), { code: "FORBIDDEN" });
    const saved = fs.readFileSync(stateFile), before = forbidden;
    const valid = await w.finalizeReadResult("confirm", confirmed, original, eventId);
    assert.equal(valid.status, "confirmed"); assert.equal(valid.hash, confirmed.hash);
    assert.equal(valid.blockNumber, confirmed.blockNumber); assert.equal(valid.blockHash, (await provider.getBlock(valid.blockNumber)).hash);
    assert.deepEqual(fs.readFileSync(stateFile), saved); assert.equal(forbidden, before);
    await assert.rejects(() => w.finalizeReadResult("confirm", confirmed,
      { ...original, wallet: organizer.address }, eventId), { code: "DRAFT_SCOPE" });
    deliveryReceiptHidden = true;
    await assert.rejects(() => w.finalizeReadResult("confirm", confirmed, original, eventId), { code: "TX_REORG" });
    deliveryReceiptHidden = false; deliveryReorgBlock = confirmed.blockNumber;
    await assert.rejects(() => w.finalizeReadResult("confirm", confirmed, original, eventId), { code: "TX_REORG" });
    // Same hash and height can be included again after a reorg: both fresh RPC
    // answers agree, but the original execution anchor still must not change.
    deliveryReceiptReorgHash = ethers.id("synthetic-confirm-delivery-reorg");
    await assert.rejects(() => w.finalizeReadResult("confirm", confirmed, original, eventId), { code: "TX_REORG" });
    deliveryReorgBlock = null; deliveryReceiptReorgHash = null;
    await assert.rejects(() => w.finalizeReadResult("confirm", { ...confirmed, status: "failed" }, original, eventId), { code: "TX_REORG" });
    assert.equal((await w.finalizeReadResult("confirm", confirmed, original, eventId)).hash, confirmed.hash);
    assert.deepEqual(fs.readFileSync(stateFile), saved); assert.equal(forbidden, before);
  } finally { r.definition.visibility = visibility; r.participants = participants; deliveryReceiptHidden = false; deliveryReorgBlock = null; deliveryReceiptReorgHash = null; }
});

test("V10 durable restart retains the same private owned event and hash while old cookie/job/session cannot be reused", async () => {
  const oldCookie = cookie; await app.close(); app = null; await launch();
  assert.equal((await request("/api/bootstrap", { session: oldCookie })).data.session, null);
  assert.deepEqual((await request("/api/public-catalog", { session: null })).data.events, []);
  cookie = await login(); const boot = await request("/api/bootstrap"); assert.equal(boot.data.events[0].id, draft.eventId);
  const saved = await request(`/api/organizer/events/drafts/${draft.id}`); assert.equal(saved.data.submittedHash, created.hash); assert.equal(saved.data.contractVersion, PROFILE);
  assert.equal((await request(`/api/organizer/events/drafts/${draft.id}/validate`, { method: "POST", payload: {} })).status, 409);
  const repeated = await job({ operation: "reconcile", draftId: draft.id, hash: created.hash }); assert.equal(repeated.result.contract, created.contract);
  assert.equal(w.events.size, 1); assert.equal(forbidden, 0);
});

test("organizer job scope defaults to V9 but exact V10 is isolated and rejects cross-profile results and inactive wallet policies", async () => {
  const session = { id: "isolated-session", mode: "wallet", wallet: organizer.address }, input = { title: "AB", lumaUrl: "https://luma.com/synthetic", startsAt: "2030", endsAt: "2031", timezone: "UTC", depositEth: "1" };
  const config = { instanceId: "isolation-instance", factory: manifest.factoryDeployment.factory, isSessionCurrent: () => true, execute: async () => ({ contractVersion: "kleros-event-v9-uups" }) };
  const old = createOrganizerJobService(config); assert.equal(old.start(session, { requestId: "same-id", operation: "prepare", input }).contractVersion, "kleros-event-v9-uups");
  const modern = createOrganizerJobService({ ...config, contractVersion: PROFILE }); modern.start(session, { requestId: "same-id", operation: "prepare", input });
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(modern.status(session, "same-id").state, "failed");
  assert.equal(modern.status(session, "same-id").contractVersion, PROFILE); assert.throws(() => modern.status({ ...session, id: "replaced" }, "same-id"), { code: "ORGANIZER_JOB_NOT_FOUND" });
  assert.throws(() => createOrganizerJobService({ ...config, contractVersion: "kleros-event-v11-uups" }), { code: "INVALID_INPUT" });
  const separate = await createWorkbench({ productionOrigin: publicOrigin, production: { manifest, stateFile: path.join(dir, "false-policy-state.json") } }, {
    productionRuntime: async () => runtime, assertWallet: async () => ({ wallet: organizer.address, blockNumber: 1, blockHash: ethers.id("x"),
      codeHash: ethers.keccak256("0x"), financialEligible: false, accountType: "eoa" }) });
  try { await assert.rejects(separate.assertWallet(organizer.address), { code: "UNSUPPORTED_WALLET" }); }
  finally { await separate.close(); }
});

test("V10 selected-only HTTP bootstrap returns the verified private event without inspecting unrelated inventory", async () => {
  const eventId = draft.eventId, unrelated = "unrelated-private-inventory";
  const record = w.events.get(eventId), secret = "UNRELATED_PRIVATE_METADATA_MUST_NOT_BE_READ";
  const readOnlyRecord = {
    get definition() { throw Error(secret); },
    get deployment() { throw Error(secret); },
  };
  w.events.set(unrelated, readOnlyRecord);
  try {
    const boot = await request(`/api/bootstrap?selectedEventId=${eventId}&selectedOnly=1`);
    assert.equal(boot.status, 200);
    assert.deepEqual(boot.data.events.map(event => event.id), [eventId]);
    assert.deepEqual(boot.data.events[0], boot.data.selectedEvent.detail.event);
    assert.equal(boot.data.selectedEvent.detail.deploymentTrust.status, "verified");
    assert.equal(boot.data.selectedEvent.detail.event.contractVersion, PROFILE);
    assert.equal(JSON.stringify(boot.data).includes(secret), false);
    const denied = await request(`/api/bootstrap?selectedEventId=${eventId}&selectedOnly=1`, { session: null });
    assert.equal(denied.data.selectedEvent.detail, null);
    assert.equal(denied.data.selectedEvent.error.code, "FORBIDDEN");
    assert.deepEqual(denied.data.events, []);
    assert.equal(JSON.stringify(denied.data).includes(record.definition.title), false);
    assert.equal(forbidden, 0);
  } finally { w.events.delete(unrelated); }
});

test("direct V10 event GET removes only the duplicate state pass and retains late payment verification", async () => {
  const eventId = draft.eventId, record = w.events.get(eventId);
  const session = { id: "synthetic-original-handler-sequence", mode: "wallet", wallet: organizer.address };
  observedBirth = record.deployment.deploymentTxHash;
  try {
    // The original HTTP handler performed this state/access preflight before detail().
    observedBirthReads = 0;
    await w.state(eventId);
    w.record(eventId, session);
    const original = await w.detail(eventId, session);
    assert.equal(observedBirthReads, 3, "Original sequence performs three full child provenance passes");

    observedBirthReads = 0;
    const response = await request(`/api/events/${eventId}`);
    assert.equal(response.status, 200);
    assert.equal(observedBirthReads, 2, "Direct GET keeps initial state and late payment provenance");
    assert.deepEqual(response.data, original, "The response and latest receipt semantics are unchanged");

    observedBirthReads = 0;
    failLateBirthRead = true;
    const rejected = await request(`/api/events/${eventId}`);
    assert.notEqual(rejected.status, 200, "Late verification failure cannot return the assembled private response");
    assert.equal(observedBirthReads, 2);
    assert.equal(JSON.stringify(rejected.data).includes(record.definition.title), false);
    assert.equal(forbidden, 0);
  } finally {
    observedBirth = null;
    observedBirthReads = 0;
    failLateBirthRead = false;
  }
});

test("direct V10 detail hydrates fresh financial ownership before private access checks", async () => {
  const eventId = draft.eventId, record = w.events.get(eventId), c = w.contract(eventId);
  const originalOrganizers = record.definition.organizers;
  record.definition.organizers = [];
  try {
    await (await c.connect(organizer).transferOwnership(ownerWallet.address)).wait();
    await (await c.connect(ownerWallet).acceptOwnership()).wait();
    const nextOwnerCookie = await login(ownerWallet);
    const next = await request(`/api/events/${eventId}`, { session: nextOwnerCookie });
    assert.equal(next.status, 200);
    assert.equal(next.data.permissions.owner, true);
    assert.equal(next.data.state.owner, ownerWallet.address);
    const previous = await request(`/api/events/${eventId}`);
    assert.equal(previous.status, 403);
    assert.equal(previous.data.code, "FORBIDDEN");
    assert.equal(JSON.stringify(previous.data).includes(record.definition.title), false);
  } finally { record.definition.organizers = originalOrganizers; }
});
