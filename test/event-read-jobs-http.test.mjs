// HTTP transport boundaries with trusted synthetic workbench results. No RPC or financial engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";
const V10 = "kleros-event-v10-uups", V9 = "kleros-event-v9-uups";
const origin = "https://event-read-boundary.example.invalid", backend = "https://event-read-backend.example.invalid";
const secret = "synthetic_event_read_proxy_" + "0123456789abcdef".repeat(4);
const eventId = "synthetic-private-event", contract = "0x" + "12".repeat(20), factory = "0x" + "ab".repeat(20);
const txHash = "0x" + "34".repeat(32), privateText = "SYNTHETIC_PRIVATE_EVENT_RESULT";
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, profile = V10) {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "event-read-http-")), calls = [], handlers = {};
  const track = (method, args) => calls.push({ method, args });
  const w = {
    chain: { chainId: 1, production: true, signers: [], factoryDeployment: { factory, contractVersion: profile, abiVersion: profile },
      provider: { send: async (...args) => { track("RPC", args); throw Error("No RPC is permitted in this boundary fixture"); } } },
    events: new Map(), assertWallet: async () => {}, close: async () => {},
    publicTransactionTarget: kind => ({ contract: factory, target: factory }),
    bootstrap: async (session, selection) => {
      track("bootstrap", [session, selection]); if (handlers.bootstrap) await handlers.bootstrap();
      return { contractVersion: profile, chain: { chainId: 1, rpcUrl: "https://public-rpc.example.invalid" },
        session: session ? { wallet: session.wallet, mode: session.mode } : null, events: [],
        ...(selection ? { selectedEvent: { eventId: selection.selectedEventId, wallet: session?.wallet ?? null,
          detail: { text: session ? privateText : "synthetic public detail" }, error: null } } : {}) };
    },
    finalizeReadResult: async (operation, result, session, selected) => {
      track("finalizeReadResult", [operation, session, selected]);
      return handlers.finalize ? handlers.finalize(operation, result, session, selected) : structuredClone(result);
    },
    createDraft: async (selected, session, input) => {
      track("createDraft", [selected, session, input]);
      assert.equal(selected, eventId); assert.equal(session.mode, "wallet"); assert.deepEqual(input, { action: "deposit", params: {} });
      return { id: "synthetic-review", eventId, wallet: session.wallet, sessionId: session.id,
        action: "deposit", expiresAt: Date.now() + 300000, chainId: 1, contractVersion: profile,
        transaction: { from: session.wallet, to: contract, data: "0x", value: "1000000000000", chainId: 1 } };
    },
    createDepositReview: async (selected, session) => {
      const draft = await w.createDraft(selected, session, { action: "deposit", params: {} });
      return { ...draft, depositReview: { kind: "deposit-review-v1", contractVersion: profile,
        chain: { chainId: 1, rpcUrl: "https://public-rpc.example.invalid" },
        session: { wallet: session.wallet, mode: session.mode }, events: [],
        selectedEvent: { eventId: selected, wallet: session.wallet,
          detail: { kind: "deposit-review-v1", text: privateText } } } };
    },
    validateDraft: async (selected, session, draftId) => {
      track("validateDraft", [selected, session, draftId]);
      assert.equal(selected, eventId); assert.equal(draftId, "synthetic-review");
      return { d: { id: draftId, expiresAt: Date.now() + 300000, transaction: { from: session.wallet, to: contract, data: "0x", value: "1000000000000", chainId: 1 } },
        spec: { private: "MUST_NOT_SERIALIZE_INTERNAL_SPEC" }, r: { private: "MUST_NOT_SERIALIZE_EVENT_RECORD" } };
    },
    reconcileSubmission: async (selected, session, draftId, hash) => {
      track("reconcileSubmission", [selected, session, draftId, hash]);
      assert.equal(selected, eventId); assert.equal(draftId, "synthetic-review"); assert.equal(hash, txHash);
      return { eventId, wallet: session.wallet, chainId: 1, contract, hash, status: "confirmed", blockNumber: 123 };
    },
    recordSubmitted: async (selected, session, draftId, hash) => {
      track("recordSubmitted", [selected, session, draftId, hash]); return { eventId, wallet: session.wallet, hash, status: "pending" };
    },
    state: async selected => { track("state", [selected]); return {}; },
    record: (selected, session) => { track("record", [selected, session]); return { definition: { id: selected } }; },
    detail: async (selected, session) => { track("detail", [selected, session]); w.record(selected, session); await w.state(selected); return { event: { eventId: selected }, state: {} }; },
    confirmDraft: async () => { track("confirmDraft", []); throw Error("The transport must preserve reconcileSubmission semantics"); },
    executeDraft: async () => { track("executeDraft", []); throw Error("No financial sender is allowed"); },
  };
  const app = await startServer({ port: 0, rpcPort: 0, production: { manifest: { factoryDeployment: { factory, contractVersion: profile } }, stateFile: path.join(runtimeRoot, "unused.json") },
    deployment: { mode: "hosted-production", publicOrigin: origin, backendOrigin: backend, proxySecret: secret, runtimeRoot } }, { workbenchFactory: async () => w });
  t.after(async () => { await app.close(); await fs.rm(runtimeRoot, { recursive: true, force: true }); });
  async function request(route, { method = "GET", payload, cookie, headers: extra = {} } = {}) {
    const url = new URL(route, app.url); assert.equal(url.hostname, "127.0.0.1");
    const headers = { host: new URL(backend).host, "x-kleros-proxy-key": secret,
      ...(method === "GET" ? {} : { origin, "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...extra };
    return new Promise((resolve, reject) => {
      const req = http.request(url, { method, headers, agent: false }, res => {
        const chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => { const raw = Buffer.concat(chunks).toString();
          let data; try { data = JSON.parse(raw); } catch {} resolve({ status: res.statusCode, data, raw, headers: res.headers }); });
      });
      req.on("error", reject); req.end(payload === undefined ? undefined : JSON.stringify(payload));
    });
  }
  const post = (route, payload, cookie, headers) => request(route, { method: "POST", payload, cookie, headers });
  async function login(wallet = ethers.Wallet.createRandom()) {
    const challenge = await post("/api/auth/challenge", { wallet: wallet.address }); assert.equal(challenge.status, 200, challenge.raw);
    const response = await post("/api/auth/verify", { nonce: challenge.data.nonce, signature: await wallet.signMessage(challenge.data.message) });
    assert.equal(response.status, 200, response.raw); return { wallet, cookie: response.headers["set-cookie"][0].split(";")[0] };
  }
  async function ready(requestId, cookie) {
    for (let i = 0; i < 20; i++) {
      const response = await request("/api/event-read-jobs/" + requestId, { cookie });
      if (response.status !== 200 || response.data.state !== "pending") return response;
      await new Promise(done => setImmediate(done));
    }
    throw Error("Synthetic job did not settle");
  }
  return { w, calls, handlers, request, post, login, ready, count: method => calls.filter(c => c.method === method).length };
}

test("V10 discovery and slow reads return promptly, preserve exact results, and hide stale-session data", { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const discovery = await f.request("/api/bootstrap?selectedEventId=" + eventId + "&background=1");
  assert.equal(discovery.status, 200); assert.equal(discovery.data.kind, "event-read-transport"); assert.equal(discovery.data.chainId, 1);
  assert.equal(f.count("bootstrap"), 0); assert.equal(f.count("RPC"), 0);
  const policy = discovery.data.walletContext;
  assert.equal(policy.instanceId, discovery.data.instanceId);
  assert.equal(policy.mode, "hosted-production");
  assert.equal(policy.contractVersion, V10); assert.equal(policy.abiVersion, V10);
  assert.equal(policy.chain.chainId, 1); assert.equal(policy.contractProfile.verified, true);
  assert.equal(policy.walletSupport.accountPolicyVersion, "v10-metamask-self-v1.3-1");
  assert.equal(policy.capabilities.transactionsReady, false);
  assert.equal(policy.capabilities.createEvents, false); assert.equal(policy.capabilities.manageEvents, false);
  for (const key of ["events", "selectedEvent", "session", "factory", "recoveryEvents"])
    assert.equal(Object.hasOwn(policy, key), false, "Account policy cannot project event or session authority");
  const duplicateSelection = await f.request("/api/bootstrap?selectedEventId=" + eventId + "&selectedEventId=other&background=1");
  assert.equal(duplicateSelection.status, 400); assert.equal(f.count("bootstrap"), 0);
  const missingProxy = await f.request("/api/bootstrap?background=1", { headers: { "x-kleros-proxy-key": "invalid" } });
  assert.equal(missingProxy.status, 403); assert.equal(f.count("bootstrap"), 0);
  const badOrigin = await f.post("/api/event-read-jobs", { requestId: "bad-origin", operation: "bootstrap", selectedEventId: null }, null, { origin: "https://foreign.invalid" });
  assert.equal(badOrigin.status, 403); assert.equal(f.count("bootstrap"), 0);
  const slow = gate(); f.handlers.bootstrap = () => slow.promise;
  let timeout;
  try {
    const started = await Promise.race([f.post("/api/event-read-jobs", { requestId: "slow-bootstrap", operation: "bootstrap", selectedEventId: eventId }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error("202 waited for the slow authoritative read")), 1000); })]);
    clearTimeout(timeout); assert.equal(started.status, 202, started.raw); assert.equal(started.data.kind, "event-read-job"); assert.equal(started.data.state, "pending");
    const repeat = await f.post("/api/event-read-jobs", { requestId: "slow-bootstrap", operation: "bootstrap", selectedEventId: eventId });
    assert.equal(repeat.status, 202); assert.equal(repeat.data.result, undefined); assert.equal(f.count("bootstrap"), 1);
    const pending = await f.request("/api/event-read-jobs/slow-bootstrap"); assert.equal(pending.data.state, "pending"); assert.equal(pending.data.result, undefined);
  } finally { clearTimeout(timeout); slow.resolve(); }
  const completed = await f.ready("slow-bootstrap");
  assert.equal(completed.status, 200); assert.equal(completed.data.state, "ready", completed.raw);
  assert.equal(completed.data.result.selectedEvent.detail.text, "synthetic public detail");
  assert.equal(completed.data.result.capabilities.eventReadJobs, true);
  assert.equal(completed.data.result.instanceId, discovery.data.instanceId);
  assert.equal(completed.data.result.selectedEvent.instanceId, discovery.data.instanceId);
  assert.equal(f.count("bootstrap"), 1);
  f.handlers.bootstrap = null;
  const global = await f.post("/api/event-read-jobs", { requestId: "global-bootstrap", operation: "bootstrap", selectedEventId: null }); assert.equal(global.status, 202);
  const globalResult = await f.ready("global-bootstrap"); assert.equal(globalResult.data.state, "ready"); assert.equal(globalResult.data.result.selectedEvent, undefined);
  const a = await f.login(), privateGate = gate(); f.handlers.bootstrap = () => privateGate.promise;
  await f.post("/api/event-read-jobs", { requestId: "private-bootstrap", operation: "bootstrap", selectedEventId: eventId }, a.cookie);
  await f.request("/api/session", { method: "DELETE", payload: {}, cookie: a.cookie });
  const b = await f.login(a.wallet); privateGate.resolve();
  const old = await f.ready("private-bootstrap", a.cookie), fresh = await f.ready("private-bootstrap", b.cookie);
  for (const response of [old, fresh]) { assert.equal(response.status, 404, response.raw); assert(!response.raw.includes(privateText)); assert.equal(response.data.result, undefined); }
  assert.equal(f.count("bootstrap"), 3); assert.equal(f.count("executeDraft"), 0); assert.equal(f.count("RPC"), 0);
});

test("event deposit, validation and known-hash reconciliation execute once with unchanged session/origin guards", async t => {
  const f = await fixture(t), auth = await f.login();
  const depositBody = { requestId: "deposit-once", operation: "deposit", eventId };
  const start = await f.post("/api/event-read-jobs", depositBody, auth.cookie); assert.equal(start.status, 202);
  const deposit = await f.ready("deposit-once", auth.cookie); assert.equal(deposit.data.state, "ready", deposit.raw); assert.equal(deposit.data.result.action, "deposit");
  assert.equal(deposit.data.result.depositReview.kind, "deposit-review-v1");
  assert.equal(deposit.data.result.depositReview.session.wallet, auth.wallet.address);
  assert.equal(deposit.data.result.depositReview.instanceId, deposit.data.instanceId);
  await f.post("/api/event-read-jobs", depositBody, auth.cookie); assert.equal(f.count("createDraft"), 1);
  const rejected = await f.post("/api/event-read-jobs", { ...depositBody, requestId: "foreign-input", signer: "forbidden" }, auth.cookie);
  assert.equal(rejected.status, 400); assert.equal(f.count("createDraft"), 1);
  await f.post("/api/event-read-jobs", { requestId: "validate-once", operation: "validate", eventId, draftId: "synthetic-review" }, auth.cookie);
  const validated = await f.ready("validate-once", auth.cookie); assert.equal(validated.data.state, "ready", validated.raw);
  assert.equal(validated.data.result.transaction.value, "1000000000000"); assert.equal(validated.data.result.draft.id, "synthetic-review");
  assert(!validated.raw.includes("MUST_NOT_SERIALIZE")); assert.equal(f.count("validateDraft"), 1);
  await f.post("/api/event-read-jobs", { requestId: "confirm-once", operation: "confirm", eventId, draftId: "synthetic-review", hash: txHash }, auth.cookie);
  const confirmed = await f.ready("confirm-once", auth.cookie); assert.equal(confirmed.data.state, "ready", confirmed.raw); assert.equal(confirmed.data.result.hash, txHash);
  assert.equal(f.count("reconcileSubmission"), 1); assert.equal(f.count("confirmDraft"), 0);
  const submitted = await f.post(`/api/events/${eventId}/drafts/synthetic-review/submitted`, { hash: txHash }, auth.cookie);
  assert.equal(submitted.status, 200, submitted.raw); assert.equal(f.count("recordSubmitted"), 1); assert.equal(f.count("state"), 0);
  const detail = await f.request("/api/events/" + eventId, { cookie: auth.cookie }); assert.equal(detail.status, 200, detail.raw);
  assert.equal(f.count("detail"), 1); assert.equal(f.count("state"), 1); assert.equal(f.count("record"), 1);
  const other = await f.login(); const denied = await f.request("/api/event-read-jobs/confirm-once", { cookie: other.cookie });
  assert.equal(denied.status, 404, denied.raw); assert.equal(denied.data.result, undefined);
  assert.equal(f.count("executeDraft"), 0); assert.equal(f.count("RPC"), 0);
});

test("first-event manage operations require the exact server scope and preserve immutable owner job input", async t => {
  const f = await fixture(t), auth = await f.login();
  const adopt = { requestId: "adopt-canonical-payer", operation: "adopt-payer", eventId,
    wallet: contract, txHash, confirmed: true, note: "Reviewed this exact canonical payer receipt." };
  const unavailable = await f.post("/api/event-read-jobs", adopt, auth.cookie);
  assert.equal(unavailable.status, 404); assert.equal(unavailable.data.code, "FIRST_EVENT_SCOPE");
  let adopted = 0, prepared = 0;
  f.w.firstEventManageAvailable = selected => selected === eventId;
  f.w.owner = async selected => { assert.equal(selected, eventId); return {}; };
  f.w.adoptPayer = async (selected, session, input, assertSession) => {
    assertSession(); assert.equal(selected, eventId); assert.equal(session.wallet, auth.wallet.address);
    assert.deepEqual(input, { wallet: contract, txHash, confirmed: true, note: adopt.note });
    adopted++;
    return { kind: "owner-reviewed-payer", eventId, wallet: contract, participantId: "canonical-payer", private: privateText };
  };
  f.w.createDraft = async (selected, session, input) => {
    assert.equal(selected, eventId); assert.equal(session.wallet, auth.wallet.address);
    assert.deepEqual(input, { action: "postAttendance", params: {
      attendedWallets: [contract], attendanceReview: { confirmed: true, note: "Actual organizer attendance review." },
    } });
    prepared++;
    return { id: "owner-attendance-review", eventId, action: input.action, params: input.params, expiresAt: Date.now() + 300000 };
  };
  assert.equal((await f.post("/api/event-read-jobs", { ...adopt, eventId: "other-event" }, auth.cookie)).status, 404);
  assert.equal((await f.post("/api/event-read-jobs", { ...adopt, requestId: "no-confirm", confirmed: false }, auth.cookie)).status, 400);
  assert.equal((await f.post("/api/event-read-jobs", { ...adopt, requestId: "extra-contact", email: "unverified@example.invalid" }, auth.cookie)).status, 400);
  assert.equal((await f.post("/api/event-read-jobs", adopt)).status, 401);
  assert.equal((await f.post("/api/event-read-jobs", adopt, auth.cookie)).status, 202);
  const result = await f.ready(adopt.requestId, auth.cookie);
  assert.equal(result.data.state, "ready", result.raw);
  assert.equal(result.data.result.participantId, "canonical-payer");
  await f.post("/api/event-read-jobs", adopt, auth.cookie);
  assert.equal(adopted, 1);
  const changed = await f.post("/api/event-read-jobs", { ...adopt, note: "A different immutable note." }, auth.cookie);
  assert.equal(changed.status, 409); assert.equal(adopted, 1);
  const attendance = { requestId: "manual-attendance-review", operation: "manage-draft", eventId, action: "postAttendance",
    params: { attendedWallets: [contract], attendanceReview: { confirmed: true, note: "Actual organizer attendance review." } } };
  assert.equal((await f.post("/api/event-read-jobs", { ...attendance, requestId: "unconfirmed-attendance",
    params: { ...attendance.params, attendanceReview: { confirmed: false, note: "Actual organizer attendance review." } } }, auth.cookie)).status, 400);
  assert.equal((await f.post("/api/event-read-jobs", { ...attendance, requestId: "duplicate-attendance",
    params: { ...attendance.params, attendedWallets: [contract, contract] } }, auth.cookie)).status, 400);
  assert.equal((await f.post("/api/event-read-jobs", { ...attendance, requestId: "unknown-managed-action", action: "release" }, auth.cookie)).status, 400);
  await f.post("/api/event-read-jobs", attendance, auth.cookie);
  const review = await f.ready(attendance.requestId, auth.cookie);
  assert.equal(review.data.state, "ready", review.raw); assert.equal(review.data.result.action, "postAttendance"); assert.equal(prepared, 1);
  // A current-owner delivery failure cannot disclose the completed private result.
  f.handlers.finalize = () => { throw Object.assign(Error("Owner changed"), { code: "NOT_OWNER", status: 403 }); };
  await f.post("/api/event-read-jobs", { ...adopt, requestId: "owner-changed-before-delivery" }, auth.cookie);
  const revoked = await f.ready("owner-changed-before-delivery", auth.cookie);
  assert.equal(revoked.data.state, "failed", revoked.raw); assert.equal(revoked.data.result, undefined);
  assert(!revoked.raw.includes(privateText));
});

test("V9 ignores discovery opt-in and retains the synchronous route", async t => {
  const f = await fixture(t, V9);
  const normal = await f.request("/api/bootstrap?background=1"); assert.equal(normal.status, 200);
  assert.equal(normal.data.contractVersion, V9); assert.equal(normal.data.kind, undefined); assert.equal(normal.data.capabilities.eventReadJobs, undefined);
  assert.equal(f.count("bootstrap"), 1);
  const unavailable = await f.post("/api/event-read-jobs", { requestId: "unsupported", operation: "bootstrap", selectedEventId: null });
  assert.equal(unavailable.status, 404); assert.equal(f.count("bootstrap"), 1);
});


test("ready POST exposes metadata only and GET freshly enforces changed private-event access", async t => {
  const f = await fixture(t), auth = await f.login();
  const body = { requestId: "fresh-private-disclosure", operation: "bootstrap", selectedEventId: eventId };
  await f.post("/api/event-read-jobs", body, auth.cookie);
  await new Promise(done => setImmediate(done));
  const metadata = await f.post("/api/event-read-jobs", body, auth.cookie);
  assert.equal(metadata.status, 202); assert.equal(metadata.data.result, undefined); assert(!metadata.raw.includes(privateText));
  f.handlers.finalize = async () => { throw Object.assign(new Error("Synthetic permission changed"), { code: "FORBIDDEN", status: 403 }); };
  const denied = await f.ready(body.requestId, auth.cookie);
  assert.equal(denied.status, 200); assert.equal(denied.data.state, "failed", denied.raw); assert.equal(denied.data.result, undefined);
  assert(!denied.raw.includes(privateText)); assert.equal(f.count("bootstrap"), 1); assert.equal(f.count("finalizeReadResult"), 1);
});

test("logout during async delivery prevents the previously ready private DTO from reaching HTTP", { timeout: 10000 }, async t => {
  const f = await fixture(t), auth = await f.login(), started = gate(), finish = gate();
  const body = { requestId: "logout-during-delivery", operation: "bootstrap", selectedEventId: eventId };
  await f.post("/api/event-read-jobs", body, auth.cookie);
  f.handlers.finalize = async (_operation, result) => { started.resolve(); await finish.promise; return result; };
  const delivering = f.ready(body.requestId, auth.cookie);
  await started.promise;
  await f.request("/api/session", { method: "DELETE", payload: {}, cookie: auth.cookie });
  finish.resolve();
  const denied = await delivering;
  assert.equal(denied.status, 401, denied.raw); assert.equal(denied.data.result, undefined); assert(!denied.raw.includes(privateText));
  assert.equal(f.count("bootstrap"), 1); assert.equal(f.count("finalizeReadResult"), 1);
});
