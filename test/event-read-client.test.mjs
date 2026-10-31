// Pure background-client guards. No browser, chain, wallet, socket or financial action.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventReadJob, eventBootstrap, eventWalletContext, FIRST_EVENT_READ_CONTEXT } from "../public/event-read.js";
const PROFILE = "kleros-event-v10-uups", wallet = "0x" + "1".repeat(40);
const firstEventId = FIRST_EVENT_READ_CONTEXT.id;
const BASE = { kind: "event-read-job", schemaVersion: 1, requestId: "original-request", operation: "bootstrap",
  chainId: 1, contractVersion: PROFILE, instanceId: "server-one", eventId: "event-a", wallet };
const ready = extra => ({ ...BASE, state: "ready", expiresAt: Date.now() + 60000, result: { synthetic: true }, ...extra });
const publicWalletDiscovery = () => ({ kind: "event-read-transport", enabled: true, chainId: 1,
  contractVersion: PROFILE, instanceId: "server-one", walletContext: {
    mode: "hosted-production", instanceId: "server-one", chain: { chainId: 1 },
    environment: { chainId: 1, production: true, network: "ethereum-mainnet" },
    contractVersion: PROFILE, abiVersion: PROFILE, contractProfile: { verified: true }, walletSupport: { synthetic: true },
    capabilities: { transactionsReady: false, createEvents: false, manageEvents: false },
  } });
function options(api, patch = {}) { return { api, operation: "bootstrap", payload: { selectedEventId: "event-a" },
  instanceId: "server-one", wallet, requestId: BASE.requestId, ...patch }; }
function instantClock(t, initial = 1000000) {
  let now = initial, elapsed = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setTimeout", (callback, ms) => { queueMicrotask(() => { now += ms; elapsed += ms; callback(); }); return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  return () => elapsed;
}
test("public wallet policy discovery performs one GET and never creates a selected bootstrap job", async () => {
  const calls = [], discovery = publicWalletDiscovery();
  const context = await eventWalletContext({ api: async (path, init) => { calls.push({ path, method: init.method ?? "GET", body: init.body }); return discovery; } });
  assert.equal(context, discovery.walletContext);
  assert.deepEqual(calls, [{ path: "/api/bootstrap?background=1", method: "GET", body: undefined }]);
  assert.equal(context.capabilities.transactionsReady, false);
  assert.equal(Object.hasOwn(context, "session"), false);
});
test("wallet policy rejects absent context, foreign server/chain/profile and projected event authority", async () => {
  const mutations = [
    d => delete d.walletContext,
    d => d.walletContext.instanceId = "another-server",
    d => d.walletContext.chain.chainId = 10200,
    d => d.walletContext.environment.production = false,
    d => d.walletContext.abiVersion = "kleros-event-v9-uups",
    d => d.walletContext.capabilities.transactionsReady = true,
    d => d.walletContext.events = [],
    d => d.walletContext.session = { wallet },
  ];
  for (const mutate of mutations) {
    const discovery = publicWalletDiscovery(); mutate(discovery); let calls = 0;
    await assert.rejects(eventWalletContext({ api: async () => { calls++; return discovery; } }));
    assert.equal(calls, 1);
  }
  await assert.rejects(eventWalletContext({ instanceId: "previous-server", api: async () => publicWalletDiscovery() }), { code: "EVENT_READ_CONTEXT_CHANGED" });
});
test("wallet policy checks abort and current context before and after its GET", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(eventWalletContext({ signal: controller.signal, api: async () => { calls++; return publicWalletDiscovery(); } }), { name: "AbortError" });
  assert.equal(calls, 0);
  let current = true;
  await assert.rejects(eventWalletContext({ isCurrent: () => current, api: async () => { current = false; return publicWalletDiscovery(); } }), { code: "EVENT_READ_CONTEXT_CHANGED" });
});
test("V10 discovery preserves selected scope and starts exactly one background job", async () => {
  const calls = [], result = { selectedEvent: { eventId: "event-a" } };
  const value = await eventBootstrap({ path: "/api/bootstrap?selectedEventId=event-a", api: async (path, init = {}) => {
    calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    if (path.startsWith("/api/bootstrap")) return { kind: "event-read-transport", enabled: true, chainId: 1, contractVersion: PROFILE, instanceId: "server-one" };
    const body = JSON.parse(init.body);
    return ready({ requestId: body.requestId, result });
  } });
  assert.equal(value, result);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/api/bootstrap?selectedEventId=event-a&background=1");
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(Object.keys(calls[1].body).sort(), ["operation", "requestId", "selectedEventId"]);
  assert.equal(calls[1].body.operation, "bootstrap");
  assert.equal(calls[1].body.selectedEventId, "event-a");
});
test("non-V10 discovery returns the original bootstrap unchanged without any POST", async () => {
  for (const version of ["truth-pays-v7", "kleros-event-v8", "kleros-event-v9-uups"]) {
    const bootstrap = { contractVersion: version, original: { retained: true } }, calls = [];
    const result = await eventBootstrap({ path: "/api/bootstrap", api: async (path, init = {}) => { calls.push({ path, method: init.method }); return bootstrap; } });
    assert.equal(result, bootstrap); assert.deepEqual(calls, [{ path: "/api/bootstrap?background=1", method: undefined }]);
  }
});
test("deposit, validation and confirmation transport keep the exact event and original transaction payload", async () => {
  for (const operation of ["deposit", "validate", "confirm"]) {
    const payload = { eventId: "event-a", ...(operation !== "deposit" ? { draftId: "draft-one" } : {}),
      ...(operation === "confirm" ? { hash: "0x" + "9".repeat(64) } : {}) }, calls = [];
    const result = await eventReadJob(options(async (path, init) => { calls.push({ path, body: JSON.parse(init.body) });
      return ready({ operation, result: { operation, verified: true } }); }, { operation, payload }));
    assert.deepEqual(result, { operation, verified: true });
    assert.deepEqual(calls, [{ path: "/api/event-read-jobs", body: { requestId: BASE.requestId, operation, ...payload } }]);
  }
});
test("global bootstrap keeps event scope absent and rejects a selected-event substitution", async () => {
  const received = [];
  const result = await eventReadJob(options(async (_path, init) => { received.push(JSON.parse(init.body)); return ready({ eventId: undefined }); },
    { payload: { selectedEventId: null } }));
  assert.deepEqual(result, { synthetic: true }); assert.equal(received[0].selectedEventId, null);
  await assert.rejects(eventReadJob(options(async () => ready(), { payload: { selectedEventId: null } })), { code: "EVENT_READ_CONTEXT_CHANGED" });
});
test("outer server, actor, event, operation and request guards reject cross-context results", async () => {
  for (const patch of [{ instanceId: "foreign-server" }, { wallet: "0x" + "2".repeat(40) }, { eventId: "event-b" },
    { operation: "deposit" }, { requestId: "another-request" }, { chainId: 10200 }, { contractVersion: "kleros-event-v9-uups" },
    { kind: "organizer-job" }, { schemaVersion: 2 }]) {
    let count = 0;
    await assert.rejects(eventReadJob(options(async () => { count++; return ready(patch); })), { code: "EVENT_READ_CONTEXT_CHANGED" });
    assert.equal(count, 1);
  }
});
test("one request can remain pending beyond thirty simulated seconds without an HTTP-timeout failure", async t => {
  const elapsed = instantClock(t), calls = [], requestIds = [], expected = { result: "fresh after 40 seconds" };
  const result = await eventReadJob(options(async (path, init = {}) => {
    calls.push({ path, method: init.method ?? "GET" });
    if (init.body) requestIds.push(JSON.parse(init.body).requestId);
    return calls.length <= 8 ? { ...BASE, state: "pending", pollAfterMs: 5000 } : ready({ result: expected });
  }));
  assert.equal(result, expected); assert.equal(elapsed(), 40000);
  assert.deepEqual(requestIds, [BASE.requestId]);
  assert.equal(calls.filter(c => c.method === "POST").length, 1);
  assert(calls.slice(1).every(c => c.path === "/api/event-read-jobs/" + BASE.requestId && c.method === "GET"));
});
test("expired and failed IDs stop without automatically creating another request", async t => {
  instantClock(t);
  for (const terminal of [{ ...BASE, state: "expired" }, ready({ expiresAt: Date.now() }),
    { ...BASE, state: "failed", error: { code: "SYNTHETIC_CHECK_FAILED", error: "Synthetic failure" } }]) {
    const calls = [];
    const promise = eventReadJob(options(async (path, init = {}) => { calls.push({ path, method: init.method ?? "GET" });
      return calls.length === 1 ? { ...BASE, state: "pending", pollAfterMs: 500 } : terminal; }));
    await assert.rejects(promise, { code: terminal.state === "failed" ? "SYNTHETIC_CHECK_FAILED" : "EVENT_READ_EXPIRED" });
    assert.equal(calls.filter(c => c.method === "POST").length, 1); assert.equal(calls.length, 2);
  }
});
test("aborts and route/session changes cannot release stale results or start replacement jobs", async t => {
  instantClock(t);
  const aborted = new AbortController(); aborted.abort(); let apiCalls = 0;
  await assert.rejects(eventReadJob(options(async () => { apiCalls++; return ready(); }, { signal: aborted.signal })), { name: "AbortError" });
  assert.equal(apiCalls, 0);
  for (const change of ["route", "abort"]) {
    const controller = new AbortController(); let current = true, calls = 0;
    const promise = eventReadJob(options(async () => { calls++; return { ...BASE, state: "pending", pollAfterMs: 500 }; },
      { signal: controller.signal, isCurrent: () => current, onPending: () => change === "route" ? current = false : controller.abort() }));
    await assert.rejects(promise, change === "route" ? { code: "EVENT_READ_CONTEXT_CHANGED" } : { name: "AbortError" });
    assert.equal(calls, 1);
  }
  let stillCurrent = true, release;
  const pending = eventReadJob(options(() => new Promise(resolve => { release = resolve; }), { isCurrent: () => stillCurrent }));
  stillCurrent = false; release(ready());
  await assert.rejects(pending, { code: "EVENT_READ_CONTEXT_CHANGED" });
});
test("disabled or foreign discovery cannot start an asynchronous financial check", async () => {
  for (const patch of [{ enabled: false }, { chainId: 1, contractVersion: "kleros-event-v9-uups" }, { chainId: 10200 }, { instanceId: "bad instance" }]) {
    let calls = 0;
    await assert.rejects(eventBootstrap({ path: "/api/bootstrap", api: async () => { calls++; return {
      kind: "event-read-transport", enabled: true, chainId: 1, contractVersion: PROFILE, instanceId: "server-one", ...patch }; } }), { code: "EVENT_READ_UNAVAILABLE" });
    assert.equal(calls, 1);
  }
});
test("busy start rejection retries only the exact immutable body and request ID", async t => {
  const elapsed = instantClock(t), calls = [], payload = { eventId: firstEventId, action: "register", params: { wallets: [wallet] } };
  const result = await eventReadJob(options(async (path, init) => {
    calls.push({ path, method: init.method, body: init.body });
    payload.eventId = "changed-by-caller";
    if (calls.length < 3) throw Object.assign(new Error("Busy before execution"), { code: "EVENT_READ_JOB_BUSY" });
    return ready({ operation: "manage-draft", eventId: firstEventId });
  }, { operation: "manage-draft", payload, expectedContext: FIRST_EVENT_READ_CONTEXT }));
  assert.deepEqual(result, { synthetic: true });
  assert.equal(calls.length, 3); assert.equal(elapsed(), 2250);
  assert(calls.every(call => call.path === "/api/event-read-jobs" && call.method === "POST" && call.body === calls[0].body));
  assert.equal(JSON.parse(calls[0].body).eventId, firstEventId);
});
test("busy backoff is bounded, does not retry other errors or poll failures, and observes context/abort before retry", async t => {
  instantClock(t);
  let calls = 0;
  await assert.rejects(eventReadJob(options(async () => { calls++; throw Object.assign(new Error("Busy"), { code: "EVENT_READ_JOB_BUSY" }); },
    { payload: { selectedEventId: firstEventId }, expectedContext: FIRST_EVENT_READ_CONTEXT })), { code: "EVENT_READ_JOB_BUSY" });
  assert.equal(calls, 8);
  for (const code of ["OWNER_REQUIRED", "EVENT_READ_UNAVAILABLE", "FETCH_TIMEOUT"]) {
    calls = 0;
    await assert.rejects(eventReadJob(options(async () => { calls++; throw Object.assign(new Error(code), { code }); })), { code });
    assert.equal(calls, 1);
  }
  calls = 0;
  await assert.rejects(eventReadJob(options(async (_path, init = {}) => {
    calls++; if (init.method === "POST") return { ...BASE, state: "pending", pollAfterMs: 500 };
    throw Object.assign(new Error("Poll busy"), { code: "EVENT_READ_JOB_BUSY" });
  })), { code: "EVENT_READ_JOB_BUSY" });
  assert.equal(calls, 2);
  for (const change of ["route", "abort"]) {
    calls = 0; let current = true; const controller = new AbortController();
    await assert.rejects(eventReadJob(options(async () => { calls++;
      if (change === "route") current = false; else controller.abort();
      throw Object.assign(new Error("Busy"), { code: "EVENT_READ_JOB_BUSY" });
    }, { isCurrent: () => current, signal: controller.signal })), change === "route" ? { code: "EVENT_READ_CONTEXT_CHANGED" } : { name: "AbortError" });
    assert.equal(calls, 1);
  }
});
test("first-event retry and management transports do not widen other event or global behavior", async t => {
  instantClock(t);
  for (const selectedEventId of [null, "event-a", "another-event"]) {
    let calls = 0;
    await assert.rejects(eventReadJob(options(async () => { calls++; throw Object.assign(new Error("Busy"), { code: "EVENT_READ_JOB_BUSY" }); },
      { payload: { selectedEventId } })), { code: "EVENT_READ_JOB_BUSY" });
    assert.equal(calls, 1);
  }
  for (const operation of ["deposit-inbox", "adopt-payer", "manage-draft"]) {
    let calls = 0;
    await assert.rejects(eventReadJob(options(async () => { calls++; return ready(); }, { operation, payload: { eventId: "another-event" } })), { code: "EVENT_READ_UNAVAILABLE" });
    assert.equal(calls, 0);
  }
});
test("a context change or abort during busy waiting prevents the next initial POST", async t => {
  for (const change of ["route", "abort"]) {
    let current = true, calls = 0; const controller = new AbortController();
    t.mock.method(globalThis, "setTimeout", (callback) => {
      queueMicrotask(() => { if (change === "route") current = false; else controller.abort(); callback(); }); return 1;
    });
    t.mock.method(globalThis, "clearTimeout", () => {});
    await assert.rejects(eventReadJob(options(async () => { calls++; throw Object.assign(new Error("Busy"), { code: "EVENT_READ_JOB_BUSY" }); },
      { payload: { selectedEventId: firstEventId }, expectedContext: FIRST_EVENT_READ_CONTEXT, isCurrent: () => current, signal: controller.signal })),
      change === "route" ? { code: "EVENT_READ_CONTEXT_CHANGED" } : { name: "AbortError" });
    assert.equal(calls, 1);
  }
});
test("missing or foreign first-event deployment metadata cannot enable a retry or organizer operation", async t => {
  instantClock(t);
  for (const expectedContext of [null, { ...FIRST_EVENT_READ_CONTEXT, chainId: 10200 },
    { ...FIRST_EVENT_READ_CONTEXT, contract: `0x${"f".repeat(40)}` },
    { ...FIRST_EVENT_READ_CONTEXT, abiVersion: "kleros-event-v9-uups" },
    { ...FIRST_EVENT_READ_CONTEXT, mode: "hosted-demo" }]) {
    let calls = 0;
    const api = async () => { calls++; throw Object.assign(new Error("Busy"), { code: "EVENT_READ_JOB_BUSY" }); };
    await assert.rejects(eventReadJob(options(api, { payload: { selectedEventId: firstEventId }, expectedContext })), { code: "EVENT_READ_JOB_BUSY" });
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(eventReadJob(options(api, { operation: "manage-draft", payload: { eventId: firstEventId }, expectedContext })), { code: "EVENT_READ_UNAVAILABLE" });
    assert.equal(calls, 0);
  }
});
