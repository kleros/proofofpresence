// Synthetic bytes and mocked fetch only. No RPC, socket, signature or public upload.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PRODUCTION_EVIDENCE_FILE as C, prepareEvidenceFile, publishReviewedEvidenceFile, verifyEvidenceFile } from "../src/production-evidence-file.mjs";
const sha = value => createHash("sha256").update(value).digest("hex");
const bytes = value => new Uint8Array(Buffer.from(value));
const scope = () => ({ environment: "production", instanceId: "synthetic-original-server", chainId: 1,
  contractVersion: "kleros-event-v10-uups", eventId: "synthetic-event", contract: "0x1111111111111111111111111111111111111111",
  wallet: "0x2222222222222222222222222222222222222222", uploaderWallet: "0x3333333333333333333333333333333333333333",
  resolver: "0x4444444444444444444444444444444444444444", localDisputeID: "0", arbitratorDisputeID: "51", blockNumber: 100, blockHash: "0x" + "a".repeat(64) });
const input = (patch = {}) => ({ scope: scope(), fileName: "evidence.json", mediaType: "application/json", bytes: bytes("{}"), ...patch });
const artifact = (patch = {}) => prepareEvidenceFile(input(patch));
const claim = intent => ({ claimed: true, intentId: "synthetic-exclusive-intent", scopeHash: intent.scopeHash, sha256: intent.sha256, uri: intent.uri });
const uploaded = a => new Response(JSON.stringify({ cids: [a.uri], inconsistentCids: [] }));
const publish = (a = artifact(), options = {}) => publishReviewedEvidenceFile({ artifact: a, bytes: bytes("{}"),
  approvedSha256: a.sha256, approvedScopeHash: a.scopeHash, persistIntent: async intent => claim(intent), fetcher: async () => uploaded(a), ...options });
const code = expected => error => error.code === expected;
let realFetch;
before(() => { realFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("Real network disabled"); }; });
after(() => { globalThis.fetch = realFetch; });

test("deterministic UnixFS CIDv0 preserves exact bytes and consent binds author, case, filename and type", () => {
  const a = artifact();
  assert.equal(a.uri, "/ipfs/QmbJWAESqCsf4RFCqEY7jecCashj8usXiyDNfKtZCwwzGb");
  assert.equal(a.sha256, sha(bytes("{}"))); assert.equal(a.byteLength, 2);
  assert(Object.isFrozen(a)); assert(Object.isFrozen(a.scope));
  assert.equal(Object.hasOwn(a, "bytes"), false); assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.notEqual(artifact({ bytes: bytes("{}\n") }).uri, a.uri);
  const moved = artifact({ scope: { ...scope(), uploaderWallet: "0x5555555555555555555555555555555555555555" } });
  assert.equal(moved.sha256, a.sha256); assert.notEqual(moved.scopeHash, a.scopeHash);
  assert.notEqual(artifact({ fileName: "different.json" }).scopeHash, a.scopeHash);
  assert.notEqual(artifact({ fileName: "evidence.txt", mediaType: "text/plain" }).scopeHash, a.scopeHash);
  assert.notEqual(artifact({ scope: { ...scope(), localDisputeID: "1" } }).scopeHash, a.scopeHash);
});

test("only exact canonical matched V10 case and author scope is accepted without accessor execution", () => {
  for (const patch of [{ chainId: 10200 }, { environment: "testnet" }, { contractVersion: "kleros-event-v9-uups" },
    { eventId: "../event" }, { instanceId: "" }, { wallet: "0x" + "0".repeat(40) }, { uploaderWallet: "invalid" },
    { resolver: "invalid" }, { localDisputeID: null }, { localDisputeID: "01" }, { arbitratorDisputeID: String(2n ** 256n) },
    { blockNumber: 0 }, { blockHash: "0x" + "0".repeat(64) }, { extra: "private" }])
    assert.throws(() => artifact({ scope: { ...scope(), ...patch } }), code("INVALID_EVIDENCE_SCOPE"));
  let reads = 0; const value = scope(); Object.defineProperty(value, "eventId", { enumerable: true, get() { reads++; return "synthetic-event"; } });
  assert.throws(() => artifact({ scope: value }), code("INVALID_EVIDENCE_SCOPE")); assert.equal(reads, 0);
});

test("supported file signatures and UTF8 formats have exact size and filename/type boundaries", () => {
  const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZ0AAAAASUVORK5CYII=", "base64"));
  const values = [input(), input({ fileName: "proof.png", mediaType: "image/png", bytes: png }),
    input({ fileName: "proof.jpeg", mediaType: "image/jpeg", bytes: Uint8Array.from([255, 216, 255, 224, 0, 2, 255, 217]) }),
    input({ fileName: "proof.pdf", mediaType: "application/pdf", bytes: bytes("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n") }),
    input({ fileName: "statement.txt", mediaType: "text/plain", bytes: bytes("Public attendance proof — café\n") })];
  for (const value of values) assert.equal(prepareEvidenceFile(value).sha256, sha(value.bytes));
  assert.equal(artifact({ fileName: "boundary.txt", mediaType: "text/plain", bytes: new Uint8Array(C.maximumFileBytes).fill(97) }).byteLength, C.maximumFileBytes);
  for (const value of [new Uint8Array(), new Uint8Array(C.maximumFileBytes + 1), "{}", new Uint8Array(new SharedArrayBuffer(2))])
    assert.throws(() => artifact({ bytes: value }), code("INVALID_EVIDENCE_FILE"));
  for (const fileName of ["../proof.json", "proof/one.json", "proof\\one.json", "proof.html.json", "proof.json\r\nX: value",
    " proof.json", "proof.json.", "CON.json", "proof.svg", "proof.html", "proof.exe", "a".repeat(81) + ".json"])
    assert.throws(() => artifact({ fileName }), code("INVALID_EVIDENCE_TYPE"));
  for (const mediaType of ["text/html", "image/svg+xml", "application/octet-stream", "application/json; charset=utf-8", "image/png"])
    assert.throws(() => artifact({ mediaType }), code("INVALID_EVIDENCE_TYPE"));
});

test("spoofed binary signatures, invalid text/JSON and visibly active PDF content are refused", () => {
  for (const value of [input({ fileName: "proof.png", mediaType: "image/png" }), input({ fileName: "proof.jpg", mediaType: "image/jpeg" }),
    input({ fileName: "proof.pdf", mediaType: "application/pdf" }), input({ bytes: bytes("not JSON") }),
    input({ bytes: Uint8Array.from([0xff]) }), input({ fileName: "proof.txt", mediaType: "text/plain", bytes: bytes("hi\0") }),
    input({ fileName: "proof.txt", mediaType: "text/plain", bytes: bytes("<script>alert(1)</script>") })])
    assert.throws(() => prepareEvidenceFile(value), code("INVALID_EVIDENCE_CONTENT"));
  for (const name of ["JavaScript", "J#61vaScript", "JS", "Launch", "EmbeddedFile", "RichMedia", "OpenAction", "AcroForm", "XFA"])
    assert.throws(() => artifact({ fileName: "proof.pdf", mediaType: "application/pdf", bytes: bytes(`%PDF-1.7\n/${name} 1 0 R\n%%EOF\n`) }), code("INVALID_EVIDENCE_CONTENT"));
});

test("exact SHA and full scope consent plus a successful exclusive durable claim precede any POST", async () => {
  const a = artifact(); let posts = 0, claims = 0;
  const fetcher = async () => { posts++; return uploaded(a); };
  for (const options of [{ approvedSha256: undefined }, { approvedSha256: "0".repeat(64) }, { approvedScopeHash: undefined },
    { approvedScopeHash: artifact({ fileName: "other.json" }).scopeHash }])
    await assert.rejects(publish(a, { ...options, fetcher, persistIntent: async intent => { claims++; return claim(intent); } }), code("EVIDENCE_PUBLICATION_NOT_APPROVED"));
  await assert.rejects(publish(a, { persistIntent: undefined, fetcher }), code("EVIDENCE_INTENT_REQUIRED"));
  await assert.rejects(publish(a, { persistIntent: async () => { throw Error("private secret"); }, fetcher }),
    e => e.code === "EVIDENCE_INTENT_FAILED" && !e.message.includes("secret"));
  for (const invalid of [undefined, {}, { ...claim(a), claimed: false }, { ...claim(a), intentId: "bad/id" }, { ...claim(a), sha256: "0".repeat(64) }])
    await assert.rejects(publish(a, { persistIntent: async () => invalid, fetcher }), code("EVIDENCE_INTENT_INVALID"));
  assert.equal(posts, 0); assert.equal(claims, 0);
});

test("only exact reviewed file bytes go to the fixed credential-free multipart endpoint", async () => {
  const a = artifact(), calls = []; let persisted = false;
  const result = await publish(a, { persistIntent: async intent => {
    assert(Object.isFrozen(intent)); assert.equal(intent.fileName, a.fileName); assert.equal(intent.mediaType, a.mediaType);
    assert.equal(intent.byteLength, 2); assert.equal(intent.endpoint, C.uploadEndpoint); persisted = true; return claim(intent);
  }, fetcher: async (url, init) => {
    assert(persisted); calls.push(init.method); assert.equal(url, C.uploadEndpoint);
    assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store"); assert.equal(init.headers, undefined);
    const entries = [...(await new Request(url, init).formData()).entries()]; assert.equal(entries.length, 1); assert.equal(entries[0][0], "file");
    const file = entries[0][1]; assert.equal(file.name, a.fileName); assert.equal(file.type, a.mediaType);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes("{}")); return uploaded(a);
  } });
  assert.equal(result.status, "published-unverified"); assert.deepEqual(calls, ["POST"], "No implicit verification request or retry");
});

test("file, author and metadata mutation during intent persistence fail closed before POST", async () => {
  let posts = 0;
  for (const change of [(a, b) => { b[0] = 91; }, a => { a.fileName = "renamed.json"; }, a => { a.scope.uploaderWallet = a.scope.wallet; }]) {
    const a = structuredClone(artifact()), b = bytes("{}");
    await assert.rejects(publish(a, { bytes: b, persistIntent: async intent => { change(a, b); return claim(intent); },
      fetcher: async () => { posts++; return uploaded(a); } }));
  }
  assert.equal(posts, 0);
});

test("exclusive callback guards concurrent requests and unknown attempts across restart; recovery is GET-only", async () => {
  const a = artifact(); let consumed = false, posts = 0;
  const persistIntent = async intent => { if (consumed) throw Error("already started or uncertain"); consumed = true; return claim(intent); };
  const request = () => publish(a, { persistIntent, fetcher: async () => { posts++; throw Error("private transport URL"); } });
  const results = await Promise.allSettled([request(), request()]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(posts, 1);
  assert.equal(results.find(r => r.status === "fulfilled").value.status, "upload-uncertain");
  await assert.rejects(request(), code("EVIDENCE_INTENT_FAILED")); assert.equal(posts, 1);
  let gets = 0; const restored = JSON.parse(JSON.stringify(a));
  const result = await verifyEvidenceFile({ artifact: restored, bytes: bytes("{}"), fetcher: async (url, init) => {
    gets++; assert.equal(url, C.gateway + a.uri); assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
    assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error"); return new Response(bytes("{}"));
  } });
  assert.equal(result.status, "verified"); assert.equal(gets, 1); assert.equal(posts, 1);
});

test("wrong upload CID or unexpected response cannot establish publication or redirect transport", async () => {
  const a = artifact();
  for (const payload of [{}, { cids: [], inconsistentCids: [] }, { cids: [a.uri, a.uri], inconsistentCids: [] },
    { cids: [artifact({ bytes: bytes("{}\n") }).uri], inconsistentCids: [] }, { cids: [a.uri], inconsistentCids: [a.uri] }]) {
    let calls = 0; const result = await publish(a, { fetcher: async () => { calls++; return new Response(JSON.stringify(payload)); } });
    assert.equal(result.status, "integrity-mismatch"); assert.equal(calls, 1);
  }
  for (const response of [new Response("", { status: 302 }), new Response("", { status: 403 }), new Response("invalid JSON"),
    new Response("x".repeat(C.maximumUploadResponseBytes + 1)), new Response("{}", { headers: { "content-length": String(C.maximumUploadResponseBytes + 1) } })])
    assert.equal((await publish(a, { fetcher: async () => response })).status, "upload-uncertain");
});

test("separate gateway reads require exact length, bytes, SHA and CID without trusting returned MIME or URLs", async () => {
  const a = artifact();
  for (const content of ["", "{", "[]", "{}\n"])
    assert.equal((await verifyEvidenceFile({ artifact: a, bytes: bytes("{}"), fetcher: async () => new Response(content) })).status, "integrity-mismatch");
  for (const response of [new Response("", { status: 404 }), new Response("", { status: 302 })])
    assert.equal((await verifyEvidenceFile({ artifact: a, bytes: bytes("{}"), fetcher: async () => response })).status, "availability-unconfirmed");
  let cancelled = 0;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes("{}x")); }, cancel() { cancelled++; } });
  assert.equal((await verifyEvidenceFile({ artifact: a, bytes: bytes("{}"), fetcher: async () => new Response(stream) })).status, "integrity-mismatch");
  assert.equal(cancelled, 1);
});

test("overall deadlines bound a transport or response stream that never resolves, with no retries", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = artifact(); let entered, calls = 0, signal;
  const started = new Promise(resolve => { entered = resolve; });
  const work = publish(a, { fetcher: async (_url, init) => { calls++; signal = init.signal; entered(); return new Promise(() => {}); } });
  await started; t.mock.timers.tick(C.requestTimeoutMs);
  assert.equal((await work).reason, "UPLOAD_TIMEOUT"); assert.equal(calls, 1); assert.equal(signal.aborted, true);
  let pulled, cancelled = 0;
  const ready = new Promise(resolve => { pulled = resolve; });
  const stream = new ReadableStream({ pull() { pulled(); return new Promise(() => {}); }, cancel() { cancelled++; } });
  const checking = verifyEvidenceFile({ artifact: a, bytes: bytes("{}"), fetcher: async () => new Response(stream) });
  await ready; await Promise.resolve(); t.mock.timers.tick(C.requestTimeoutMs);
  assert.equal((await checking).reason, "GATEWAY_TIMEOUT"); assert.equal(cancelled, 1);
});
