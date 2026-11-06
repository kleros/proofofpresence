// In-memory transport/cancellation only; no provider, socket, signer or public RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventReadJobService } from "../src/event-read-jobs.mjs";
import { withReadJobScope, readJobSignal } from "../src/read-job-scope.mjs";
import { FIRST_EVENT_MANAGE_SCOPE, LEGACY_FIRST_EVENT_SCOPES } from "../src/first-event-manage-scope.mjs";
const session = (n = 2) => ({ id: `session-${n}`, mode: "wallet", wallet: `0x${String(n).repeat(40)}` });
const body = (operation = "deposit", requestId = "request-one", eventId = "event-one") => ({ requestId, operation,
  ...(operation === "bootstrap" ? { selectedEventId: eventId } : { eventId }),
  ...(["validate", "confirm"].includes(operation) ? { draftId: "original-draft" } : {}),
  ...(operation === "confirm" ? { hash: `0x${"ab".repeat(32)}` } : {}) });
const code = expected => error => error.code === expected;
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(execute = () => ({ fact: "synthetic" }), deliver = (_, result) => result) {
  let time = 1000000; const actor = session(), current = new Set([actor]), calls = [], deliveries = [];
  const service = createEventReadJobService({ instanceId: "synthetic-instance", now: () => time,
    isSessionCurrent: value => current.has(value), execute: (operation, context) => { calls.push({ operation, context }); return execute(operation, context); },
    deliver: (operation, result, context) => { deliveries.push({ operation, context }); return deliver(operation, result, context); } });
  return { actor, current, calls, deliveries, service, advance: ms => time += ms };
}

test("start is metadata-only; slow work executes once and ready delivery consumes the result", async () => {
  const pending = deferred(), f = fixture(() => pending.promise), request = body("confirm");
  assert.equal(f.service.start(f.actor, request).state, "pending");
  assert.equal(f.calls.length, 0); f.service.start(f.actor, structuredClone(request)); await settle();
  request.eventId = "changed-after-start"; request.hash = `0x${"cd".repeat(32)}`;
  assert.equal(f.calls[0].context.eventId, "event-one"); assert.equal(f.calls[0].context.hash, body("confirm").hash);
  f.advance(35000); assert.equal((await f.service.status(f.actor, "request-one")).state, "pending");
  pending.resolve({ receipt: { originalHash: body("confirm").hash } }); await settle();
  const retry = f.service.start(f.actor, body("confirm")); assert.equal(retry.state, "pending"); assert.equal(Object.hasOwn(retry, "result"), false);
  assert.equal(f.deliveries.length, 0);
  const result = await f.service.status(f.actor, "request-one"); assert.equal(result.state, "ready");
  assert.equal(result.kind, "event-read-job"); assert.equal(result.chainId, 1); assert.equal(result.eventId, "event-one");
  assert.strictEqual(f.deliveries[0].context.session, f.actor); assert.equal(f.deliveries[0].context.eventId, "event-one");
  assert.equal((await f.service.status(f.actor, "request-one")).state, "expired");
  assert.equal(f.service.start(f.actor, body("confirm")).state, "expired"); assert.equal(f.calls.length, 1); assert.equal(f.deliveries.length, 1);
});

test("participant reviews accept only scoped challenge, match and resolve arguments", async () => {
  const f = fixture();
  for (const [index, [action, params]] of [["challenge", {}], ["match", {}], ["match", { wallet: session(3).wallet }],
    ["resolve", {}], ["resolve", { wallet: session(3).wallet }]].entries()) {
    f.service.start(f.actor, { ...body("participant-draft", `participant-${index}`), action, params });
  }
  for (const [index, [action, params]] of [["register", {}], ["cancel", {}], ["challenge", { wallet: session(3).wallet }],
    ["match", { wallet: "0x" + "0".repeat(40) }], ["resolve", { wallet: "invalid" }], ["resolve", { wallet: session(3).wallet, note: "extra" }]].entries())
    assert.throws(() => f.service.start(f.actor, { ...body("participant-draft", `invalid-participant-${index}`), action, params }), code("INVALID_INPUT"));
  await settle();
  assert(f.calls.every(call => call.operation === "participant-draft"));
});

test("participant settlement and evidence reviews keep exact event, actor and one-shot request identities", async () => {
  const f = fixture((_, context) => ({ action: context.action, params: context.params, expiresAt: 1004000 }));
  const uri = "/ipfs/Qm" + "a".repeat(44) + "/evidence.json";
  for (const [index, [action, params]] of [["release", {}], ["claim", {}], ["emergencyWithdraw", {}],
    ["evidence", { wallet: session(3).wallet, uri }]].entries()) {
    const request = { ...body("participant-draft", `settlement-${index}`), action, params };
    assert.throws(() => f.service.start(null, request), code("UNAUTHENTICATED"));
    assert.equal(f.service.start(f.actor, request).state, "pending"); await settle();
    const result = await f.service.status(f.actor, request.requestId);
    assert.equal(result.state, "ready"); assert.equal(result.eventId, "event-one");
    assert.equal(result.wallet, f.actor.wallet); assert.equal(result.expiresAt, 1004000);
    assert.deepEqual(result.result, { action, params, expiresAt: 1004000 });
    assert.strictEqual(f.calls[index].context.session, f.actor);
    assert.equal(f.calls[index].context.eventId, "event-one");
    assert.equal(f.service.start(f.actor, request).state, "expired", "Consumed reviews cannot execute again");
  }
  assert.equal(f.calls.length, 4); assert.equal(f.deliveries.length, 4);
});

test("participant settlement cannot choose recipients, value, resolver IDs or ambiguous evidence paths", () => {
  const f = fixture(), uri = "/ipfs/Qm" + "a".repeat(44), wallet = session(3).wallet;
  const invalid = [
    ["release", { value: "1" }], ["release", { wallet }], ["claim", { to: wallet }],
    ["emergencyWithdraw", { to: wallet }], ["claim", { amountWei: "1" }],
    ["evidence", {}], ["evidence", { uri }], ["evidence", { wallet, uri, localDisputeID: "0" }],
    ["evidence", { wallet, uri, target: wallet }], ["evidence", { wallet, uri, value: "0" }],
    ["evidence", { wallet: "0x" + "0".repeat(40), uri }],
  ];
  for (const bad of ["https://example.invalid/evidence.json", "ipfs://Qmexample", "/ipfs/", "/ipfs/Qm/root/../evidence.json",
    "/ipfs/Qm/./evidence.json", "/ipfs/Qm/evidence.json?key=x", "/ipfs/Qm/evidence.json#fragment", "/ipfs/Qm/%2e%2e/file",
    "/ipfs/Qm\\evidence.json", "/ipfs/Qm//evidence.json", "/ipfs/Qm/" + "a".repeat(4096), null])
    invalid.push(["evidence", { wallet, uri: bad }]);
  let getterReads = 0;
  const accessor = { wallet }; Object.defineProperty(accessor, "uri", { enumerable: true, get() { getterReads++; return uri; } });
  invalid.push(["evidence", accessor]);
  for (const [index, [action, params]] of invalid.entries())
    assert.throws(() => f.service.start(f.actor, { ...body("participant-draft", `invalid-settlement-${index}`), action, params }), code("INVALID_INPUT"));
  assert.equal(getterReads, 0); assert.equal(f.calls.length, 0);
});

test("accepted evidence is copied before queuing and its original event, wallet and URI cannot be replaced", async () => {
  const pause = deferred(), f = fixture((_, context) => context.action === "release" ? pause.promise : { params: context.params });
  const holding = { ...body("participant-draft", "holding-release"), action: "release", params: {} };
  const original = { ...body("participant-draft", "original-evidence"), action: "evidence",
    params: { wallet: session(3).wallet, uri: "/ipfs/Qm" + "a".repeat(44) + "/evidence.json" } };
  const request = structuredClone(original);
  f.service.start(f.actor, holding); f.service.start(f.actor, request); await settle();
  request.eventId = "event-two"; request.params.wallet = session(4).wallet; request.params.uri = "/ipfs/changed";
  assert.throws(() => f.service.start(f.actor, request), code("EVENT_READ_JOB_CONFLICT"));
  pause.resolve({ released: false }); await settle();
  assert.equal((await f.service.status(f.actor, holding.requestId)).state, "ready"); await settle();
  const result = await f.service.status(f.actor, original.requestId);
  assert.equal(result.state, "ready"); assert.deepEqual(result.result.params, original.params);
  assert.equal(f.calls[1].context.eventId, "event-one"); assert.deepEqual(f.calls[1].context.params, original.params);
  assert.equal(f.calls.length, 2); assert.equal(f.deliveries.length, 2);
});

test("advanced case reviews bind a challenged wallet and exact appeal side/wei without accepting IDs or rewards recipients", async () => {
  const f = fixture((_, context) => ({ action: context.action, params: context.params })), wallet = session(3).wallet;
  const allowed = [["passPeriod", { wallet }], ["deliverRuling", { wallet }], ["appealRewards", { wallet }],
    ...[0, 1, 2].map(side => ["fundAppeal", { wallet, side, amountWei: "1" }])];
  for (const [index, [action, params]] of allowed.entries()) {
    const request = { ...body("participant-draft", `advanced-case-${index}`), action, params };
    f.service.start(f.actor, request); await settle();
    assert.deepEqual((await f.service.status(f.actor, request.requestId)).result, { action, params });
    assert.equal(f.service.start(f.actor, request).state, "expired");
  }
  const invalid = [["passPeriod", {}], ["deliverRuling", { wallet, arbitratorDisputeID: "1" }],
    ["appealRewards", { wallet, sides: [0, 1, 2] }], ["appealRewards", { wallet, to: f.actor.wallet }],
    ["fundAppeal", { wallet, side: 1, amountWei: "1", localDisputeID: "1" }]];
  for (const side of [-1, 3, "1", null]) invalid.push(["fundAppeal", { wallet, side, amountWei: "1" }]);
  for (const amountWei of ["0", "01", "-1", "1.0", "1e18", 1, String(2n ** 256n)]) invalid.push(["fundAppeal", { wallet, side: 1, amountWei }]);
  for (const [index, [action, params]] of invalid.entries())
    assert.throws(() => f.service.start(f.actor, { ...body("participant-draft", `invalid-advanced-${index}`), action, params }), code("INVALID_INPUT"));
  assert.equal(f.calls.length, allowed.length);
});

test("known current and legacy participant reviews retain distinct event identities without promoting arbitrary events", async () => {
  const scopes = [FIRST_EVENT_MANAGE_SCOPE, ...LEGACY_FIRST_EVENT_SCOPES], allowed = new Map(scopes.map(scope => [scope.eventId, scope]));
  let drafts = 0;
  const f = fixture((_, context) => {
    // Mirrors the server's trusted reviewed-event gate. Transport cannot turn a
    // stable identifier into contract authority or replace either saved child.
    const selected = allowed.get(context.eventId);
    if (!selected) throw Object.assign(Error("Unreviewed event"), { code: "FIRST_EVENT_SCOPE" });
    drafts++; return { eventId: selected.eventId, contract: selected.contract, action: context.action };
  });
  const actions = [["release", {}], ["claim", {}], ["emergencyWithdraw", {}], ["withdrawPending", {}],
    ["evidence", { wallet: session(3).wallet, uri: "/ipfs/Qm" + "a".repeat(44) }], ["passPeriod", { wallet: session(3).wallet }],
    ["deliverRuling", { wallet: session(3).wallet }], ["appealRewards", { wallet: session(3).wallet }],
    ["fundAppeal", { wallet: session(3).wallet, side: 1, amountWei: "1" }]];
  for (const [scopeIndex, selected] of scopes.entries()) for (const [actionIndex, [action, params]] of actions.entries()) {
    const request = { ...body("participant-draft", `known-${scopeIndex}-${actionIndex}`, selected.eventId), action, params };
    f.service.start(f.actor, request); await settle();
    const result = await f.service.status(f.actor, request.requestId);
    assert.equal(result.state, "ready"); assert.equal(result.eventId, selected.eventId);
    assert.equal(result.result.contract, selected.contract); assert.equal(result.result.action, action);
    assert.throws(() => f.service.start(f.actor, { ...request, eventId: scopes[1 - scopeIndex].eventId }), code("EVENT_READ_JOB_CONFLICT"));
    assert.throws(() => f.service.start(f.actor, { ...request, requestId: `wrong-child-${scopeIndex}-${actionIndex}`, contract: selected.contract }), code("INVALID_INPUT"));
  }
  assert.equal(drafts, actions.length * scopes.length);
  const request = { ...body("participant-draft", "unreviewed-stable-event", "event-arbitrary"), action: "release", params: {} };
  f.service.start(f.actor, request); await settle(); assert.equal((await f.service.status(f.actor, request.requestId)).state, "failed");
  assert.equal(drafts, actions.length * scopes.length, "Only the trusted known-event gate may authorize a draft");
});

test("authenticated deposit inbox reads expire in the pure-read pool without consuming permanent wallet records", async () => {
  const f = fixture();
  const inbox = requestId => ({ requestId, operation: "deposit-inbox", eventId: "event-one", refresh: false });
  assert.throws(() => f.service.start(null, inbox("anonymous-inbox")), code("UNAUTHENTICATED"));
  for (let i = 0; i < 260; i++) {
    const request = inbox(`inbox-${i}`);
    assert.equal(f.service.start(f.actor, request).state, "pending");
    await settle();
    assert.equal((await f.service.status(f.actor, request.requestId)).state, "ready");
    f.advance(5001);
  }
  assert.equal(f.service.start(f.actor, body("deposit", "wallet-after-inbox")).state, "pending");
  await settle();
  assert.equal((await f.service.status(f.actor, "wallet-after-inbox")).state, "ready");
  await assert.rejects(f.service.status(f.actor, "inbox-0"), code("EVENT_READ_JOB_NOT_FOUND"));
});

test("private bootstrap data is freshly redacted after access changes between execution and polling", async () => {
  let allowed = true;
  const f = fixture(() => ({ publicTitle: "Synthetic", privateStaff: "MUST_NOT_LEAK" }), (_, result) =>
    allowed ? result : { publicTitle: result.publicTitle });
  const request = body("bootstrap"); f.service.start(f.actor, request); await settle(); allowed = false;
  const post = f.service.start(f.actor, request); assert.equal(Object.hasOwn(post, "result"), false);
  const result = await f.service.status(f.actor, request.requestId);
  assert.deepEqual(result.result, { publicTitle: "Synthetic" }); assert.doesNotMatch(JSON.stringify(result), /MUST_NOT_LEAK/);
  assert.equal((await f.service.status(f.actor, request.requestId)).state, "expired"); assert.equal(f.deliveries.length, 1);
});

test("a fresh permission denial consumes cached data without exposing it or repeating delivery", async () => {
  const f = fixture(() => ({ privateOwner: "MUST_NOT_LEAK" }), () => { throw Object.assign(Error("PRIVATE_PROVIDER_DATA"), { code: "FORBIDDEN" }); });
  const request = body("bootstrap"); f.service.start(f.actor, request); await settle();
  const denied = await f.service.status(f.actor, request.requestId); assert.equal(denied.state, "failed"); assert.equal(denied.error.code, "FORBIDDEN");
  assert.doesNotMatch(JSON.stringify(denied), /MUST_NOT_LEAK|PRIVATE_PROVIDER_DATA/);
  assert.equal((await f.service.status(f.actor, request.requestId)).state, "expired"); assert.equal(f.calls.length, 1); assert.equal(f.deliveries.length, 1);
});

test("only explicit anonymous bootstrap works without the original current session reference", async () => {
  const f = fixture(); f.service.start(null, body("bootstrap", "public-global", null)); await settle();
  const result = await f.service.status(null, "public-global"); assert.equal(result.state, "ready"); assert.equal(Object.hasOwn(result, "wallet"), false);
  assert.equal(Object.hasOwn(result, "eventId"), false); assert.equal(f.calls[0].context.selectedEventId, null);
  for (const operation of ["deposit", "validate", "confirm"]) assert.throws(() => f.service.start(null, body(operation)), code("UNAUTHENTICATED"));
  assert.throws(() => f.service.start(undefined, body("bootstrap", "undefined-session")), code("UNAUTHENTICATED"));
  const request = body(); f.service.start(f.actor, request); await settle();
  const replacement = { ...f.actor }; f.current.add(replacement);
  await assert.rejects(f.service.status(replacement, request.requestId), code("EVENT_READ_JOB_NOT_FOUND"));
  assert.throws(() => f.service.start(replacement, request), code("EVENT_READ_JOB_NOT_FOUND"));
  f.current.delete(f.actor); await assert.rejects(f.service.status(f.actor, request.requestId), code("EVENT_READ_JOB_NOT_FOUND"));
  f.current.add(f.actor); assert.equal(f.service.start(f.actor, request).state, "expired");
});

test("session change during fresh delivery and concurrent polling cannot disclose a second result", async () => {
  const pending = deferred(), f = fixture(() => ({ privateResult: "MUST_NOT_LEAK" }), () => pending.promise), request = body();
  f.service.start(f.actor, request); await settle(); const first = f.service.status(f.actor, request.requestId); await settle();
  const concurrent = await f.service.status(f.actor, request.requestId); assert.equal(concurrent.state, "pending"); assert.equal(Object.hasOwn(concurrent, "result"), false);
  f.current.delete(f.actor); pending.resolve({ privateResult: "MUST_NOT_LEAK" }); const stopped = await first;
  assert.equal(stopped.state, "expired"); assert.equal(Object.hasOwn(stopped, "result"), false); assert.equal(f.deliveries.length, 1);
});

test("automatic pending timeout releases capacity while ignored late work stays cancelled", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred(); let oldScope;
  const f = fixture(async (_, context) => { if (f.calls.length !== 1) return { newResult: true };
    oldScope = readJobSignal(); assert.strictEqual(oldScope, context.signal); await pending.promise;
    assert.strictEqual(readJobSignal(), oldScope); return { privateLate: "MUST_NOT_LEAK" }; });
  const request = body(); f.service.start(f.actor, request); await settle();
  t.mock.timers.tick(180000); await settle(); assert.equal(oldScope.aborted, true);
  const next = body("deposit", "new-request"); f.service.start(f.actor, next); await settle();
  assert.equal((await f.service.status(f.actor, next.requestId)).state, "ready");
  pending.resolve(); await settle(); assert.equal((await f.service.status(f.actor, request.requestId)).state, "expired");
  assert.equal(f.service.start(f.actor, request).state, "expired"); assert.equal(f.calls.length, 2);
});

test("ten-second delivery deadline bounds a hung callback and ignores its later completion", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred(), f = fixture(() => ({ fact: true }), () => pending.promise), request = body("confirm");
  f.service.start(f.actor, request); await settle(); const first = f.service.status(f.actor, request.requestId); await settle();
  const signal = f.deliveries[0].context.signal;
  assert.equal(f.service.start(f.actor, body("deposit", "new-request")).state, "pending");
  await settle(); assert.equal(f.calls.length, 1, "Queued execution cannot overlap delivery");
  t.mock.timers.tick(10000); assert.equal((await first).state, "expired"); assert.equal(signal.aborted, true);
  f.service.start(f.actor, body("deposit", "new-request")); await settle();
  pending.resolve({ privateLate: "MUST_NOT_LEAK" }); await settle();
  assert.equal((await f.service.status(f.actor, request.requestId)).state, "expired"); assert.equal(f.calls.length, 2);
});

test("payload scope is immutable and rejects getters, extra parameters and changed event IDs", () => {
  const f = fixture(); let reads = 0; const accessor = body();
  Object.defineProperty(accessor, "operation", { enumerable: true, get() { reads++; return "deposit"; } });
  for (const invalid of [null, {}, Object.create(body()), accessor, { ...body(), params: {} }, { ...body(), wallet: session(3).wallet },
    { ...body(), eventId: "../event-two" }, { ...body("bootstrap"), selectedEventId: undefined },
    { ...body("confirm"), hash: "0x1234" }, { ...body(), operation: "payout" }]) assert.throws(() => f.service.start(f.actor, invalid), code("INVALID_INPUT"));
  assert.equal(reads, 0); assert.equal(f.calls.length, 0); f.service.start(f.actor, body());
  assert.throws(() => f.service.start(f.actor, body("deposit", "request-one", "event-two")), code("EVENT_READ_JOB_CONFLICT"));
});

test("bootstrap/validation freshness and draft deadlines expire before delivery without reruns", async () => {
  for (const [operation, result, ttl] of [["validate", { draft: { expiresAt: 1200000 } }, 5000],
    ["validate", { draft: { expiresAt: 1001250 } }, 1250], ["deposit", { expiresAt: 1002000 }, 2000],
    ["bootstrap", { metadata: true }, 5000], ["confirm", { status: "pending" }, 300000]]) {
    const f = fixture(() => result), request = body(operation); f.service.start(f.actor, request); await settle(); f.advance(ttl);
    if (operation === "bootstrap") await assert.rejects(f.service.status(f.actor, request.requestId), code("EVENT_READ_JOB_NOT_FOUND"));
    else { assert.equal((await f.service.status(f.actor, request.requestId)).state, "expired");
      f.advance(-100000); assert.equal(f.service.start(f.actor, request).state, "expired"); }
    assert.equal(f.deliveries.length, 0); assert.equal(f.calls.length, 1);
  }
});

test("execution failures expose only existing sanitized errors", async () => {
  const f = fixture(() => { throw Object.assign(Error("PRIVATE_URL_KEY_SIGNATURE"), { code: "TX_REORG" }); }), request = body("confirm");
  f.service.start(f.actor, request); await settle(); const failed = await f.service.status(f.actor, request.requestId);
  assert.equal(failed.state, "failed"); assert.equal(failed.error.code, "TX_REORG"); assert.doesNotMatch(JSON.stringify(failed), /PRIVATE|SIGNATURE/);
  assert.equal(Object.hasOwn(f.service.start(f.actor, request), "error"), false); assert.equal(f.calls.length, 1);
});

test("cancellation scope stays isolated across interleaved async reads", async () => {
  const a = new AbortController(), b = new AbortController(), pause = deferred(); assert.equal(readJobSignal(), undefined);
  const first = withReadJobScope(a.signal, async () => { await pause.promise; assert.strictEqual(readJobSignal(), a.signal); });
  await withReadJobScope(b.signal, async () => { await Promise.resolve(); assert.strictEqual(readJobSignal(), b.signal); a.abort(Error("expired")); assert.equal(b.signal.aborted, false); });
  pause.resolve(); await first; assert.equal(readJobSignal(), undefined);
  assert.throws(() => withReadJobScope(a.signal, () => assert.fail("Aborted scope executed")), /expired/);
});

test("an exhausted anonymous bootstrap pool cannot consume wallet operation capacity", async () => {
  const f = fixture();
  for (let i = 0; i < 256; i++) {
    const request = body("bootstrap", `public-${i}`);
    f.service.start(null, request); await settle();
    assert.equal((await f.service.status(null, request.requestId)).state, "ready");
  }
  assert.throws(() => f.service.start(null, body("bootstrap", "public-overflow")), code("EVENT_READ_JOB_CAPACITY"));
  for (const operation of ["deposit", "validate", "confirm"]) {
    const request = body(operation, `wallet-${operation}`); f.service.start(f.actor, request); await settle();
    assert.equal((await f.service.status(f.actor, request.requestId)).state, "ready");
  }
  assert.equal(f.calls.length, 259);
  f.advance(5000); f.service.start(null, body("bootstrap", "public-after-cleanup")); await settle();
  f.advance(300000);
  const before = f.calls.length;
  assert.equal(f.service.start(f.actor, body("confirm", "wallet-confirm")).state, "expired");
  assert.throws(() => f.service.start(null, body("bootstrap", "wallet-confirm")), code("EVENT_READ_JOB_NOT_FOUND"));
  assert.throws(() => f.service.start(f.actor, body("bootstrap", "wallet-confirm")), code("EVENT_READ_JOB_CONFLICT"));
  assert.equal(f.calls.length, before, "Bootstrap cleanup never evicts or overwrites a consumed wallet request");
});

test("terminal bootstrap identity is retained for five seconds, then only an explicit new start can reread", async () => {
  const f = fixture(), request = body("bootstrap", "public-retention");
  f.service.start(null, request); await settle(); assert.equal((await f.service.status(null, request.requestId)).state, "ready");
  f.advance(4999);
  assert.equal(f.service.start(null, request).state, "expired"); assert.equal((await f.service.status(null, request.requestId)).state, "expired");
  assert.equal(f.calls.length, 1);
  f.advance(1); await assert.rejects(f.service.status(null, request.requestId), code("EVENT_READ_JOB_NOT_FOUND"));
  await settle(); assert.equal(f.calls.length, 1, "Cleanup and polling never schedule a replacement read");
  f.service.start(null, request); await settle(); assert.equal(f.calls.length, 2, "Only an explicit pure-read start can reuse an evicted identity");
});

test("bootstrap cleanup cannot evict pending execution or a current delivery", async () => {
  const pending = deferred(), f = fixture(() => pending.promise), request = body("bootstrap", "public-running");
  f.service.start(null, request); await settle(); f.advance(4999);
  assert.equal(f.service.start(null, body("bootstrap", "another-public")).state, "pending");
  assert.equal(f.calls.length, 1);
  assert.equal((await f.service.status(null, request.requestId)).state, "pending");
  pending.resolve({ public: true }); await settle(); assert.equal((await f.service.status(null, request.requestId)).state, "ready");
  const delivery = deferred(), g = fixture(() => ({ public: true }), () => delivery.promise), other = body("bootstrap", "public-delivering");
  g.service.start(null, other); await settle(); const first = g.service.status(null, other.requestId); await settle(); g.advance(4999);
  assert.equal(g.service.start(null, body("bootstrap", "another-public")).state, "pending");
  assert.equal(g.calls.length, 1);
  assert.equal((await g.service.status(null, other.requestId)).state, "pending");
  delivery.resolve({ public: true }); assert.equal((await first).state, "ready"); assert.equal(g.deliveries.length, 1);
});

test("occupied starts join one FIFO and duplicate queued identities execute only once", async () => {
  const held = deferred(), f = fixture((_, context) => context.eventId === "first-event" ? held.promise : { eventId: context.eventId });
  const first = body("deposit", "fifo-first", "first-event"), second = body("validate", "fifo-second", "second-event"),
    third = body("confirm", "fifo-third", "third-event");
  for (const request of [first, second, third]) assert.equal(f.service.start(f.actor, request).state, "pending");
  assert.equal(f.service.start(f.actor, structuredClone(second)).state, "pending");
  assert.throws(() => f.service.start(f.actor, { ...second, eventId: "different-event" }), code("EVENT_READ_JOB_CONFLICT"));
  second.eventId = "changed-after-queue";
  await settle(); assert.deepEqual(f.calls.map(call => call.context.eventId), ["first-event"]);
  held.resolve({ eventId: "first-event" }); await settle();
  assert.equal((await f.service.status(f.actor, "fifo-second")).state, "pending");
  assert.equal(f.calls.length, 1, "Ready first result gets delivery before the next execution");
  assert.equal((await f.service.status(f.actor, "fifo-first")).state, "ready"); await settle();
  assert.deepEqual(f.calls.map(call => call.context.eventId), ["first-event", "second-event"]);
  assert.equal((await f.service.status(f.actor, "fifo-second")).state, "ready"); await settle();
  assert.equal((await f.service.status(f.actor, "fifo-third")).state, "ready");
  assert.deepEqual(f.calls.map(call => call.context.eventId), ["first-event", "second-event", "third-event"]);
  assert.equal(f.service.start(f.actor, body("validate", "fifo-second", "second-event")).state, "expired");
  assert.equal(f.calls.length, 3);
});

test("a completed fresh bootstrap cannot be starved by the next long execution", async () => {
  const held = deferred(), f = fixture((_, context) => context.selectedEventId === "slow-event" ? held.promise : { title: "first" });
  f.service.start(f.actor, body("bootstrap", "ready-first", "first-event")); await settle();
  assert.equal(f.service.start(f.actor, body("bootstrap", "slow-second", "slow-event")).state, "pending");
  await settle(); f.advance(4000);
  assert.equal(f.calls.length, 1);
  const fresh = await f.service.status(f.actor, "ready-first"); assert.equal(fresh.state, "ready");
  assert.equal(fresh.result.title, "first"); await settle(); assert.equal(f.calls.length, 2);
  held.resolve({ title: "second" }); await settle();
  assert.equal((await f.service.status(f.actor, "slow-second")).state, "ready");
});

test("an abandoned fresh result releases its bounded reservation without replaying execution", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.service.start(null, body("bootstrap", "unobserved-public")); await settle();
  f.service.start(f.actor, body("confirm", "queued-original-hash")); await settle();
  f.advance(4999); t.mock.timers.tick(4999); await settle(); assert.equal(f.calls.length, 1);
  f.advance(1); t.mock.timers.tick(1); await settle(); assert.equal(f.calls.length, 2);
  const result = await f.service.status(f.actor, "queued-original-hash"); assert.equal(result.state, "ready");
  assert.equal(f.calls[1].context.hash, body("confirm").hash);
  await assert.rejects(f.service.status(null, "unobserved-public"), code("EVENT_READ_JOB_NOT_FOUND"));
  assert.equal(f.calls.length, 2);
});

test("longer original receipt retention survives release of the delivery reservation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture((operation, context) => ({ operation, originalHash: context.hash }));
  f.service.start(f.actor, body("confirm", "original-receipt")); await settle();
  f.service.start(f.actor, body("deposit", "next-review")); await settle();
  f.advance(5000); t.mock.timers.tick(5000); await settle(); assert.equal(f.calls.length, 2);
  assert.equal((await f.service.status(f.actor, "next-review")).state, "ready");
  const original = await f.service.status(f.actor, "original-receipt");
  assert.equal(original.state, "ready"); assert.equal(original.result.originalHash, body("confirm").hash);
  assert.equal(f.calls.length, 2); assert.equal(f.deliveries.length, 2);
});

test("the ready reservation is bounded by elapsed time even if the wall clock stops advancing", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.service.start(f.actor, body("confirm", "wall-clock-first")); await settle();
  f.service.start(f.actor, body("deposit", "wall-clock-next")); await settle();
  assert.equal(f.calls.length, 1);
  t.mock.timers.tick(5000); await settle();
  assert.equal(f.calls.length, 2, "A stopped clock cannot retain the execution slot indefinitely");
  assert.equal((await f.service.status(f.actor, "wall-clock-next")).state, "ready");
  assert.equal((await f.service.status(f.actor, "wall-clock-first")).state, "ready");
});

test("queue capacity is bounded and overflow never executes or replaces accepted work", async () => {
  const held = deferred(), f = fixture(() => held.promise);
  f.service.start(f.actor, body("confirm", "active-original")); await settle();
  for (let i = 0; i < 32; i++) assert.equal(f.service.start(f.actor, body("deposit", `queued-${i}`)).state, "pending");
  assert.throws(() => f.service.start(f.actor, body("deposit", "queue-overflow")), code("EVENT_READ_JOB_CAPACITY"));
  assert.equal(f.service.start(f.actor, body("deposit", "queued-0")).state, "pending", "Exact accepted identity remains observable at capacity");
  await settle(); assert.equal(f.calls.length, 1);
  f.current.delete(f.actor); held.resolve({ late: true }); await settle();
  assert.equal(f.calls.length, 1, "Invalid queued actors never execute when the slot becomes free");
});

test("queued sessions are checked again before execution and cannot be replaced by equal-valued actors", async () => {
  const held = deferred(), f = fixture((_, context) => context.eventId === "first-event" ? held.promise : { secret: "MUST_NOT_LEAK" });
  const secondActor = session(3); f.current.add(secondActor);
  f.service.start(f.actor, body("deposit", "active-first", "first-event"));
  const request = body("confirm", "revoked-queued", "second-event"); f.service.start(secondActor, request); await settle();
  const replacement = { ...secondActor }; f.current.add(replacement);
  await assert.rejects(f.service.status(replacement, request.requestId), code("EVENT_READ_JOB_NOT_FOUND"));
  f.current.delete(secondActor); held.resolve({ safe: true }); await settle();
  assert.equal((await f.service.status(f.actor, "active-first")).state, "ready"); await settle();
  assert.equal(f.calls.length, 1); f.current.add(secondActor);
  assert.equal(f.service.start(secondActor, request).state, "expired");
  assert.equal(f.calls.length, 1);
});

test("the pending deadline includes queue waiting and a timed-out identity cannot be replayed", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = deferred(), f = fixture(() => held.promise);
  f.service.start(f.actor, body("confirm", "timeout-active"));
  const queued = body("deposit", "timeout-queued"); f.service.start(f.actor, queued); await settle();
  f.advance(180000); t.mock.timers.tick(180000); await settle();
  assert.equal(f.calls.length, 1);
  assert.equal((await f.service.status(f.actor, queued.requestId)).state, "expired");
  assert.equal(f.service.start(f.actor, queued).state, "expired");
  held.resolve({ late: "MUST_NOT_LEAK" }); await settle();
  assert.equal(f.calls.length, 1);
});

test("permission denial during reserved fresh delivery releases the queue without cached disclosure", async () => {
  const f = fixture(() => ({ privateValue: "MUST_NOT_LEAK" }), operation => {
    if (operation === "bootstrap") throw Object.assign(Error("PRIVATE_DIAGNOSTIC"), { code: "FORBIDDEN" });
    return { allowed: true };
  });
  f.service.start(f.actor, body("bootstrap", "private-first")); await settle();
  f.service.start(f.actor, body("deposit", "after-denial")); await settle();
  const denied = await f.service.status(f.actor, "private-first");
  assert.equal(denied.state, "failed"); assert.equal(denied.error.code, "FORBIDDEN");
  assert.doesNotMatch(JSON.stringify(denied), /MUST_NOT_LEAK|PRIVATE_DIAGNOSTIC/);
  await settle(); assert.equal((await f.service.status(f.actor, "after-denial")).state, "ready");
  assert.equal(f.calls.length, 2);
});
