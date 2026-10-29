// In-memory transport jobs only: no workbench, provider, signer, sockets or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrganizerJobService } from "../src/organizer-jobs.mjs";

const factory = "0x1111111111111111111111111111111111111111";
const session = (n = 2, id = `synthetic-session-${n}`) => ({ id, wallet: `0x${String(n).repeat(40)}`, mode: "wallet" });
const terms = () => ({ title: "Synthetic organizer review", lumaUrl: "https://luma.com/synthetic-organizer",
  startsAt: "2030-11-04T11:00:00.000Z", endsAt: "2030-11-04T15:00:00.000Z", timezone: "Asia/Bangkok", depositEth: "0.001" });
const prepare = (requestId = "synthetic-request-1") => ({ requestId, operation: "prepare", input: terms() });
const errorCode = (code, status) => (error) => error.code === code && (status === undefined || error.status === status);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function fixture(options = {}) {
  const { execute: underlying, ...settings } = options;
  const current = new Set(), calls = []; let time = 1_000_000;
  const actor = session(); current.add(actor);
  const service = createOrganizerJobService({ instanceId: "synthetic-server-instance", factory,
    execute: (operation, args) => { calls.push({ operation, args }); return underlying?.(operation, args) ?? { draftId: "synthetic-ready-draft" }; },
    isSessionCurrent: (candidate) => current.has(candidate), now: () => time, ...settings });
  return { service, actor, current, calls, advance(ms) { time += ms; } };
}

test("start reserves synchronously, duplicate requests and repeated status never execute twice", async () => {
  const work = deferred(), f = fixture({ execute: () => work.promise });
  const body = prepare(), first = f.service.start(f.actor, body);
  assert.equal(first.state, "pending"); assert.equal(first.pollAfterMs, 1000); assert.equal(f.calls.length, 0);
  assert.deepEqual(f.service.start(f.actor, prepare()), first);
  for (let i = 0; i < 5; i++) assert.equal(f.service.status(f.actor, body.requestId).state, "pending");
  await settle(); assert.equal(f.calls.length, 1);
  body.input.title = "Caller mutation after start";
  assert.equal(f.calls[0].args.input.title, terms().title);
  assert.strictEqual(f.calls[0].args.session, f.actor);
  work.resolve({ id: "synthetic-draft", transaction: { to: factory, data: "0x1234", value: "0" } }); await settle();
  const ready = f.service.status(f.actor, body.requestId);
  assert.equal(ready.state, "ready"); assert.equal(ready.chainId, 1); assert.equal(ready.factory, factory);
  assert.equal(ready.contractVersion, "kleros-event-v9-uups"); assert.equal(ready.kind, "organizer-job");
  assert.deepEqual(f.service.start(f.actor, prepare()), ready); assert.equal(f.calls.length, 1);
  ready.result.transaction.data = "changed detached DTO";
  assert.equal(f.service.status(f.actor, body.requestId).result.transaction.data, "0x1234");
});

test("same request ID with changed terms or operation conflicts; foreign/missing/revoked status is generic", async () => {
  const work = deferred(), f = fixture({ execute: () => work.promise });
  f.service.start(f.actor, prepare());
  assert.throws(() => f.service.start(f.actor, { ...prepare(), input: { ...terms(), depositEth: "0.002" } }), errorCode("ORGANIZER_JOB_CONFLICT", 409));
  assert.throws(() => f.service.start(f.actor, { requestId: prepare().requestId, operation: "validate", draftId: "another-draft" }), errorCode("ORGANIZER_JOB_CONFLICT", 409));
  const foreign = session(3); f.current.add(foreign);
  const replacement = session(2, "replacement-session"); f.current.add(replacement);
  for (const actor of [foreign, replacement, null])
    assert.throws(() => f.service.status(actor, prepare().requestId), errorCode("ORGANIZER_JOB_NOT_FOUND", 404));
  assert.throws(() => f.service.status(f.actor, "missing-request"), errorCode("ORGANIZER_JOB_NOT_FOUND", 404));
  assert.throws(() => f.service.start(foreign, prepare()), errorCode("ORGANIZER_JOB_NOT_FOUND", 404));
  f.current.delete(f.actor);
  assert.throws(() => f.service.status(f.actor, prepare().requestId), errorCode("ORGANIZER_JOB_NOT_FOUND", 404));
  await settle(); assert.equal(f.calls.length, 0, "Revocation before scheduled work denies execution");
});

test("revocation during slow work hides its result and never retries the consumed request", async () => {
  const work = deferred(), f = fixture({ execute: () => work.promise });
  f.service.start(f.actor, prepare()); await settle(); assert.equal(f.calls.length, 1);
  f.current.delete(f.actor); work.resolve({ privateReview: "MUST NOT BE DISCLOSED" }); await settle();
  assert.throws(() => f.service.status(f.actor, prepare().requestId), errorCode("ORGANIZER_JOB_NOT_FOUND", 404));
  f.current.add(f.actor);
  const prior = f.service.start(f.actor, prepare()); assert.equal(prior.state, "expired");
  assert.equal(Object.hasOwn(prior, "result"), false); assert.equal(f.calls.length, 1);
});

test("exact payload and own primitive fields reject extras, inherited fields, accessors and invalid references", () => {
  const f = fixture(); let accessorReads = 0;
  const accessor = prepare(); Object.defineProperty(accessor, "operation", { get() { accessorReads++; return "prepare"; }, enumerable: true });
  const inputAccessor = prepare(); Object.defineProperty(inputAccessor.input, "title", { get() { accessorReads++; return "private"; }, enumerable: true });
  const bodies = [null, {}, { ...prepare(), factory }, { ...prepare(), requestId: "../private" },
    { ...prepare(), requestId: "x".repeat(101) }, { ...prepare(), input: { ...terms(), policyURI: "https://other.example.invalid" } },
    { ...prepare(), input: { ...terms(), depositEth: 0.001 } }, Object.create(prepare()), accessor, inputAccessor,
    { requestId: "a", operation: "validate", draftId: "../wrong" },
    { requestId: "a", operation: "reconcile", draftId: "original-draft", hash: "0x1234" },
    { requestId: "a", operation: "reconcile", draftId: "original-draft", hash: `0x${"ab".repeat(32)}`, input: terms() }];
  for (const body of bodies) assert.throws(() => f.service.start(f.actor, body), errorCode("INVALID_INPUT", 400));
  assert.equal(accessorReads, 0); assert.equal(f.calls.length, 0);
});

test("execution failures expose only the existing sanitized production error body", async () => {
  const f = fixture({ execute: () => { throw Object.assign(new Error("PRIVATE_RPC_PASSWORD_SIGNATURE_BUFFER"),
    { code: "STALE_DRAFT", status: 409, data: "private result", url: "https://user:password@example.invalid" }); } });
  f.service.start(f.actor, prepare()); await settle();
  const failed = f.service.status(f.actor, prepare().requestId);
  assert.equal(failed.state, "failed"); assert.equal(failed.error.code, "STALE_DRAFT");
  assert.deepEqual(Object.keys(failed.error).sort(), ["code", "error"]);
  assert.equal(/PRIVATE|PASSWORD|SIGNATURE|password|example.invalid|private result/.test(JSON.stringify(failed)), false);
  assert.equal(f.service.start(f.actor, prepare()).state, "failed"); assert.equal(f.calls.length, 1);
});

test("global admission and per-wallet locks remain active after the pending presentation expires", async () => {
  const work = deferred(), f = fixture({ execute: () => work.promise });
  f.service.start(f.actor, prepare()); await settle();
  const other = session(3); f.current.add(other);
  assert.throws(() => f.service.start(other, prepare("request-b")), errorCode("ORGANIZER_JOB_BUSY", 409));
  assert.throws(() => f.service.start(f.actor, prepare("request-c")), errorCode("ORGANIZER_JOB_BUSY", 409));
  f.advance(180_000);
  const expired = f.service.status(f.actor, prepare().requestId);
  assert.equal(expired.state, "expired"); assert.equal(Object.hasOwn(expired, "result"), false);
  assert.equal(f.service.start(f.actor, prepare()).state, "expired"); assert.equal(f.calls.length, 1);
  assert.throws(() => f.service.start(other, prepare("request-b")), errorCode("ORGANIZER_JOB_BUSY", 409));
  work.resolve({ completedTooLate: true }); await settle();
  assert.equal(f.service.status(f.actor, prepare().requestId).state, "expired");
  assert.equal(f.calls.length, 1);
});

test("validation results expose the exact five-second deadline and expire at its boundary", async () => {
  const f = fixture();
  const body = { requestId: "validation-request", operation: "validate", draftId: "original-draft" };
  f.service.start(f.actor, body); await settle();
  assert.equal(f.calls[0].operation, "validate"); assert.equal(f.calls[0].args.draftId, body.draftId);
  assert.equal(f.service.status(f.actor, body.requestId).state, "ready");
  assert.equal(f.service.status(f.actor, body.requestId).expiresAt, 1_005_000);
  f.advance(4999); assert.equal(f.service.status(f.actor, body.requestId).state, "ready");
  f.advance(1); const expired = f.service.status(f.actor, body.requestId);
  assert.equal(expired.state, "expired"); assert.equal(Object.hasOwn(expired, "result"), false);
  assert.equal(Object.hasOwn(expired, "expiresAt"), false);
  assert.equal(f.service.start(f.actor, body).state, "expired"); assert.equal(f.calls.length, 1);
});

test("completed prepare/reconcile TTL and bounded retained tombstones never permit automatic replay", async () => {
  const f = fixture({ maxRecords: 2 });
  f.service.start(f.actor, prepare()); await settle();
  const body = { requestId: "receipt-only-request", operation: "reconcile", draftId: "original-draft", hash: `0x${"AB".repeat(32)}` };
  f.service.start(f.actor, body); await settle();
  assert.equal(f.calls[1].operation, "reconcile"); assert.equal(f.calls[1].args.hash, body.hash.toLowerCase());
  assert.equal(f.service.status(f.actor, body.requestId).expiresAt, 1_300_000);
  f.advance(299_999); assert.equal(f.service.status(f.actor, body.requestId).state, "ready");
  f.advance(1); assert.equal(f.service.status(f.actor, body.requestId).state, "expired");
  f.advance(30 * 60_000);
  assert.equal(f.service.start(f.actor, prepare()).state, "expired"); assert.equal(f.calls.length, 2);
  assert.throws(() => f.service.start(f.actor, prepare("third-request")), errorCode("ORGANIZER_JOB_CAPACITY", 503));
  assert.equal(f.calls.length, 2, "Expired identities are not evicted and executed again");
});

test("ready prepare and validation deadlines are capped by their underlying draft expiry", async () => {
  for (const operation of ["prepare", "validate"]) {
    const result = operation === "prepare" ? { expiresAt: 1_001_250, id: "underlying-draft" }
      : { draft: { expiresAt: 1_001_250, id: "underlying-draft" }, transaction: { value: "0" } };
    const f = fixture({ execute: () => result });
    const body = operation === "prepare" ? prepare() : { requestId: "validation-request", operation, draftId: "original-draft" };
    f.service.start(f.actor, body); await settle();
    assert.equal(f.service.status(f.actor, body.requestId).expiresAt, 1_001_250);
    f.advance(1249); assert.equal(f.service.status(f.actor, body.requestId).state, "ready");
    f.advance(1); const expired = f.service.status(f.actor, body.requestId);
    assert.equal(expired.state, "expired"); assert.equal(Object.hasOwn(expired, "result"), false);
    assert.equal(Object.hasOwn(expired, "expiresAt"), false);
    assert.equal(f.service.start(f.actor, body).state, "expired"); assert.equal(f.calls.length, 1);
  }
});

test("a result completed after underlying draft expiry is never disclosed as ready", async () => {
  for (const operation of ["prepare", "validate"]) {
    const f = fixture({ execute: () => operation === "prepare" ? { expiresAt: 999_999 }
      : { draft: { expiresAt: 999_999 }, transaction: { value: "0" } } });
    const body = operation === "prepare" ? prepare() : { requestId: "validation-request", operation, draftId: "original-draft" };
    f.service.start(f.actor, body); await settle();
    const expired = f.service.status(f.actor, body.requestId);
    assert.equal(expired.state, "expired"); assert.equal(Object.hasOwn(expired, "result"), false);
    assert.equal(Object.hasOwn(expired, "expiresAt"), false);
  }
});

test("same wallet cannot overlap even if a reviewed configuration permits multiple globally active jobs", async () => {
  const work = deferred(), f = fixture({ maxActive: 2, execute: () => work.promise });
  f.service.start(f.actor, prepare()); await settle();
  assert.throws(() => f.service.start(f.actor, prepare("same-wallet-request")), errorCode("ORGANIZER_JOB_BUSY", 409));
  const other = session(3); f.current.add(other); f.service.start(other, prepare("other-wallet-request")); await settle();
  assert.equal(f.calls.length, 2); work.resolve({ ready: true }); await settle();
});
