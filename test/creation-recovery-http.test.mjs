// Local HTTP routing and real synthetic ECDSA only. No financial engine, RPC, key files or public requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";

const publicOrigin = "https://creation-recovery.example.invalid";
const backendOrigin = "https://creation-recovery-backend.example.invalid";
const proxySecret = "synthetic_recovery_proxy_" + "0123456789abcdef".repeat(4);
const factory = "0x" + "11".repeat(20), child = "0x" + "22".repeat(20);
const originalHash = "0x" + "34".repeat(32), eventId = "synthetic-original-creation", draftId = "synthetic-original-review";
const PRIVATE = "PRIVATE_ORIGINAL_CREATION_MUST_NOT_LEAK";
const clone = (value) => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function fixture(t) {
  const wallet = ethers.Wallet.createRandom(), other = ethers.Wallet.createRandom(), calls = [];
  const scope = { kind: "factory-creation-recovery", chainId: 1, factory, contractVersion: "kleros-event-v9-uups",
    wallet: wallet.address, hash: originalHash, draftId, eventId, instanceId: "initialized-by-server" };
  const inspection = { schemaVersion: 1, kind: "original-creation-recovery", status: "original-transaction-confirmed", scope: clone(scope),
    hash: originalHash, contract: child, title: PRIVATE, provenance: "not-verified",
    capabilities: { createEvents: false, walletTransactions: false, manageEvents: false, adoptEvent: false } };
  const track = (method) => calls.push(method);
  const forbidden = (method) => async () => { track(method); throw Error("A denied recovery request reached the workbench"); };
  const provider = { send: forbidden("forwardedRPC") };
  const w = {
    chain: { chainId: 1, production: true, signers: [], provider, factoryDeployment: { factory } }, provider,
    events: new Map(), coded: true, inspectGate: null,
    async assertWallet() {
      track("assertWallet");
      if (w.coded) throw Object.assign(new Error("Synthetic delegated code is unsupported"), { code: "UNSUPPORTED_WALLET", status: 422 });
      return { wallet: wallet.address, blockNumber: 100, blockHash: `0x${"ab".repeat(32)}` };
    },
    creationRecoveryScope(address, hash) {
      track("creationRecoveryScope");
      if (address?.toLowerCase() !== wallet.address.toLowerCase() || hash?.toLowerCase() !== originalHash)
        throw Object.assign(new Error("No original creation"), { code: "NOT_FOUND", status: 404 });
      return clone(scope);
    },
    async inspectCreationRecovery(session) {
      track("inspectCreationRecovery");
      assert.equal(session.mode, "recovery-only"); assert.deepEqual(session.recoveryScope, scope);
      if (w.inspectGate) { w.inspectGate.entered.resolve(); await w.inspectGate.release.promise; }
      return clone(inspection);
    },
    publicCatalog() {
      track("publicCatalog");
      return { schemaVersion: 1, kind: "public-catalog", mode: "hosted-production", events: [],
        catalog: { metadataOnly: true, currentFinancialState: "not-loaded", source: "recorded-adoption" } };
    },
    persist() { track("persist"); }, async close() {},
  };
  for (const method of ["bootstrap", "state", "record", "owner", "staff", "detail", "session", "createEvent", "advance",
    "mockRuling", "mockAppeal", "createDraft", "validateDraft", "executeDraft", "confirmDraft", "recordSubmitted",
    "submissionStatus", "reconcileSubmission", "createFactoryDraft", "validateFactoryDraft", "getFactoryDraft",
    "recordFactorySubmitted", "reconcileFactorySubmission", "registerParticipant", "admit", "linkDeposit", "checkin",
    "personal", "previewImport", "commitImport", "previewBatch", "commitBatch", "batchStatus", "publish",
    "caseArtifact", "publishCaseArtifact", "verifyCaseArtifact", "depositLedger"])
    w[method] = forbidden(method);
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kleros-creation-recovery-http-"));
  const app = await startServer({ port: 0, rpcPort: 0, contractVersion: "kleros-event-v9-uups",
    production: { manifest: { syntheticBoundaryFixture: true }, stateFile: path.join(runtimeRoot, "unused-state.json") },
    deployment: { mode: "hosted-production", publicOrigin, backendOrigin, proxySecret, runtimeRoot } },
  { workbenchFactory: async (options) => { scope.instanceId = options.serverInstanceId; inspection.scope = clone(scope); return w; } });
  t.after(async () => { await app.close(); await fs.rm(runtimeRoot, { recursive: true, force: true }); });
  async function request(route, { method = "GET", payload, cookie, headers: extra = {} } = {}) {
    const url = new URL(route, app.url);
    assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.protocol, "http:");
    const headers = { host: new URL(backendOrigin).host, "x-kleros-proxy-key": proxySecret,
      ...(method !== "GET" ? { origin: publicOrigin, "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}), ...extra };
    return new Promise((resolve, reject) => {
      const req = http.request(url, { method, headers, agent: false }, (res) => {
        const chunks = []; res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => { const raw = Buffer.concat(chunks).toString("utf8"); let data;
          try { data = JSON.parse(raw); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, raw, data }); });
      });
      req.on("error", reject); req.end(payload === undefined ? undefined : JSON.stringify(payload));
    });
  }
  const post = (route, payload = {}, extra = {}) => request(route, { ...extra, method: "POST", payload });
  async function challenge() {
    const response = await post("/api/recovery/auth/challenge", { wallet: wallet.address, hash: originalHash });
    assert.equal(response.status, 200, response.raw);
    assert.equal(typeof response.data.nonce, "string"); assert.equal(typeof response.data.message, "string");
    assert.ok(response.data.message.includes(publicOrigin)); assert.ok(response.data.message.includes(wallet.address));
    assert.ok(response.data.message.includes(originalHash)); assert.match(response.data.message, /Chain ID: 1/);
    assert.match(response.data.message, /recovery/i);
    return response.data;
  }
  async function login() {
    const issued = await challenge(), signature = await wallet.signMessage(issued.message);
    const verified = await post("/api/recovery/auth/verify", { nonce: issued.nonce, signature });
    assert.equal(verified.status, 200, verified.raw);
    assert.equal(verified.data.wallet, wallet.address); assert.equal(verified.data.mode, "recovery-only");
    assert.equal(typeof verified.data.instanceId, "string"); assert.ok(verified.data.instanceId.length > 0);
    const cookie = verified.headers["set-cookie"]?.[0]; assert.ok(cookie);
    for (const attribute of ["HttpOnly", "SameSite=Strict", "Secure", "Path=/"]) assert.ok(cookie.includes(attribute));
    return { issued, signature, verified, cookie: cookie.split(";")[0] };
  }
  const count = (method) => calls.filter((value) => value === method).length;
  return { app, w, wallet, other, scope, inspection, request, post, challenge, login, calls, count };
}

test("a coded wallet signs only the exact recovery nonce and receives metadata-only inspection", async (t) => {
  const f = await fixture(t);
  const blocked = await f.post("/api/auth/challenge", { wallet: f.wallet.address });
  assert.equal(blocked.status, 422); assert.equal(blocked.data.code, "UNSUPPORTED_WALLET");
  const guards = f.count("assertWallet"), login = await f.login();
  assert.equal(f.count("assertWallet"), guards, "Recovery challenge/verification must not run a financial EOA guard");
  const inspected = await f.request("/api/recovery/original-creation", { cookie: login.cookie });
  assert.equal(inspected.status, 200, inspected.raw); assert.equal(inspected.data.kind, "original-creation-recovery");
  assert.equal(inspected.data.mode, "hosted-production"); assert.equal(inspected.data.instanceId, login.verified.data.instanceId);
  assert.deepEqual(inspected.data.session, { wallet: f.wallet.address, mode: "recovery-only" });
  assert.equal(inspected.data.provenance, "not-verified"); assert.equal(inspected.data.hash, originalHash);
  assert.ok(Object.values(inspected.data.capabilities).length > 0);
  assert.ok(Object.values(inspected.data.capabilities).every((value) => value === false));
  for (const key of ["transaction", "draft", "signer", "privateKey"]) assert.equal(Object.hasOwn(inspected.data, key), false);
  assert.equal(f.count("inspectCreationRecovery"), 1); assert.equal(f.count("assertWallet"), guards);
  assert.equal(f.count("forwardedRPC"), 0);
});

test("nonce purpose crossing, forgery, replay and expiry fail even when code changes", async (t) => {
  const f = await fixture(t);
  f.w.coded = false;
  const normal = await f.post("/api/auth/challenge", { wallet: f.wallet.address }); assert.equal(normal.status, 200);
  f.w.coded = true;
  const normalToRecovery = await f.post("/api/recovery/auth/verify", { nonce: normal.data.nonce,
    signature: await f.wallet.signMessage(normal.data.message) });
  assert.equal(normalToRecovery.status, 403); assert.equal(normalToRecovery.data.code, "BAD_NONCE");
  const recovery = await f.challenge(), beforeGuard = f.count("assertWallet");
  const recoveryToNormal = await f.post("/api/auth/verify", { nonce: recovery.nonce, signature: await f.wallet.signMessage(recovery.message) });
  assert.equal(recoveryToNormal.status, 403); assert.equal(recoveryToNormal.data.code, "BAD_NONCE");
  assert.equal(f.count("assertWallet"), beforeGuard, "Purpose mismatch must be rejected before an EOA check");
  const forged = await f.challenge();
  const rejected = await f.post("/api/recovery/auth/verify", { nonce: forged.nonce, signature: await f.other.signMessage(forged.message) });
  assert.equal(rejected.status, 403); assert.equal(rejected.data.code, "BAD_SIGNATURE"); assert.equal(rejected.headers["set-cookie"], undefined);
  const login = await f.login();
  const replay = await f.post("/api/recovery/auth/verify", { nonce: login.issued.nonce, signature: login.signature });
  assert.equal(replay.status, 403); assert.equal(replay.data.code, "BAD_NONCE");
  const expiring = await f.challenge(), signature = await f.wallet.signMessage(expiring.message), realNow = Date.now;
  assert.ok(Number.isSafeInteger(expiring.expiresAt));
  try {
    Date.now = () => expiring.expiresAt + 1;
    const expired = await f.post("/api/recovery/auth/verify", { nonce: expiring.nonce, signature });
    assert.equal(expired.status, 403); assert.equal(expired.data.code, "BAD_NONCE");
  } finally { Date.now = realNow; }
  f.w.coded = false;
  const issued = await f.post("/api/auth/challenge", { wallet: f.wallet.address }); assert.equal(issued.status, 200);
  f.w.coded = true;
  const normalVerify = await f.post("/api/auth/verify", { nonce: issued.data.nonce, signature: await f.wallet.signMessage(issued.data.message) });
  assert.equal(normalVerify.status, 422); assert.equal(normalVerify.data.code, "UNSUPPORTED_WALLET");
});

test("recovery cookies default-deny every other API and financial route before workbench effects", async (t) => {
  const f = await fixture(t), { cookie } = await f.login(), base = f.calls.length;
  const event = `/api/events/${eventId}`;
  const routes = [
    ["GET", "/api/bootstrap"], ["GET", `/api/bootstrap?selectedEventId=${eventId}`],
    ["GET", event], ["GET", `${event}/exports/participants.csv`], ["GET", `${event}/fixture`],
    ["GET", `${event}/deposit-inbox`], ["GET", `${event}/submissions/${originalHash}`],
    ["GET", `/api/organizer/events/drafts/${draftId}`], ["GET", "/api/organizer/events/jobs/a-review"],
    ["POST", "/api/organizer/events/drafts", {}],
    ["POST", `/api/organizer/events/drafts/${draftId}/validate`, {}],
    ["POST", `/api/organizer/events/drafts/${draftId}/submitted`, { hash: originalHash }],
    ["POST", `/api/organizer/events/drafts/${draftId}/reconcile`, { hash: originalHash }],
    ["POST", "/api/organizer/events/jobs", { requestId: "recovery-should-not-start", operation: "prepare", input: {} }],
    ["PATCH", event, { visibility: "private" }], ["POST", `${event}/participants`, { name: "Synthetic", email: "synthetic@example.test" }],
    ["PATCH", `${event}/participants/synthetic`, { admission: "approved" }], ["POST", `${event}/deposits`, { hash: originalHash }],
    ["POST", `${event}/checkins`, { participantId: "synthetic" }], ["POST", `${event}/imports/preview`, {}],
    ["POST", `${event}/batches/preview`, {}], ["POST", `${event}/drafts`, { action: "deposit" }],
    ["POST", `${event}/drafts/${draftId}/validate`, {}], ["POST", `${event}/drafts/${draftId}/execute`, {}],
    ["POST", `${event}/drafts/${draftId}/submitted`, { hash: originalHash }],
    ["POST", `${event}/submissions/reconcile`, { draftId, hash: originalHash }],
    ["POST", "/api/auth/challenge", { wallet: f.wallet.address }], ["POST", "/api/auth/verify", { nonce: "bad", signature: "bad" }],
    ["POST", "/api/recovery/auth/challenge", { wallet: f.wallet.address, hash: originalHash }],
    ["POST", "/rpc", { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: factory, data: "0x" }, "latest"] }],
    ["GET", "/local-ipfs/synthetic"], ["GET", "/local-policy/synthetic"], ["POST", "/local-upload", {}],
    ["GET", `/finance/${eventId}/console`], ["GET", "/api/recovery/original-creation?eventId=other"],
    ["GET", "/api/recovery/original-creation/extra"],
  ];
  for (const [method, route, payload] of routes) {
    const response = await f.request(route, { method, payload, cookie });
    assert.ok(response.status >= 400 && response.status < 500, `${method} ${route}: ${response.status}`);
    assert.equal(response.raw.includes(PRIVATE), false);
  }
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.calls.slice(base), [], "Central denial must precede state/owner/import/job/RPC/other workbench effects");
  const catalog = await f.request("/api/public-catalog", { cookie }); assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.data.events, []); assert.equal(f.count("publicCatalog"), 1);
  const asset = await f.request("/app.js", { cookie }); assert.equal(asset.status, 200);
  assert.equal(f.count("inspectCreationRecovery"), 0);
  const logout = await f.request("/api/session", { method: "DELETE", cookie }); assert.equal(logout.status, 200);
  assert.ok(logout.headers["set-cookie"][0].includes("Max-Age=0"));
  const after = await f.request("/api/recovery/original-creation", { cookie }); assert.equal(after.status, 401);
  assert.equal(f.count("inspectCreationRecovery"), 0);
});

test("logout during a delayed inspection withholds its result after the workbench await", async (t) => {
  const f = await fixture(t), { cookie } = await f.login();
  f.w.inspectGate = { entered: deferred(), release: deferred() };
  const pending = f.request("/api/recovery/original-creation", { cookie });
  await f.w.inspectGate.entered.promise;
  const logout = await f.request("/api/session", { method: "DELETE", cookie }); assert.equal(logout.status, 200);
  f.w.inspectGate.release.resolve(); const withheld = await pending;
  assert.equal(withheld.status, 401); assert.equal(withheld.raw.includes(PRIVATE), false);
  assert.equal(withheld.raw.includes(originalHash), false); assert.equal(withheld.raw.includes(child), false);
  assert.equal(f.count("inspectCreationRecovery"), 1);
});

test("cookie expiry during delayed inspection is rechecked before disclosing metadata", async (t) => {
  const f = await fixture(t), { cookie } = await f.login(), realNow = Date.now;
  f.w.inspectGate = { entered: deferred(), release: deferred() };
  const pending = f.request("/api/recovery/original-creation", { cookie }); await f.w.inspectGate.entered.promise;
  try {
    Date.now = () => realNow() + 9 * 3600_000;
    f.w.inspectGate.release.resolve(); const withheld = await pending;
    assert.equal(withheld.status, 401); assert.equal(withheld.raw.includes(PRIVATE), false);
  } finally { Date.now = realNow; }
});

test("proxy, host, origin and actual saved-scope selection remain mandatory", async (t) => {
  const f = await fixture(t), payload = { wallet: f.wallet.address, hash: originalHash };
  for (const [headers, code] of [[{ "x-kleros-proxy-key": "" }, "PROXY_REQUIRED"],
    [{ host: "other.example.invalid" }, "BAD_HOST"], [{ origin: "https://other.example.invalid" }, "BAD_ORIGIN"]]) {
    const denied = await f.post("/api/recovery/auth/challenge", payload, { headers });
    assert.equal(denied.status, 403); assert.equal(denied.data.code, code);
  }
  assert.equal(f.count("creationRecoveryScope"), 0);
  for (const [wrong, signer] of [[{ wallet: f.other.address, hash: originalHash }, f.other],
    [{ wallet: f.wallet.address, hash: ethers.id("unknown saved creation") }, f.wallet]]) {
    const issued = await f.post("/api/recovery/auth/challenge", wrong);
    assert.equal(issued.status, 200, "A nonce alone must not disclose whether a saved creation exists");
    const denied = await f.post("/api/recovery/auth/verify", { nonce: issued.data.nonce,
      signature: await signer.signMessage(issued.data.message) });
    assert.equal(denied.status, 404); assert.equal(denied.raw.includes(PRIVATE), false);
    assert.equal(denied.raw.includes(originalHash), false);
  }
  const { cookie } = await f.login(), before = f.count("inspectCreationRecovery");
  const direct = await f.request("/api/recovery/original-creation", { cookie, headers: { "x-kleros-proxy-key": "" } });
  assert.equal(direct.status, 403); assert.equal(direct.data.code, "PROXY_REQUIRED");
  assert.equal(f.count("inspectCreationRecovery"), before);
});
