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
let failTransactionRead = false, forgedType4 = false;
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
      const result = await value.apply(target, args);
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
