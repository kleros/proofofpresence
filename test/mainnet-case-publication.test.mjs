// Pure artifacts and mocked HTTP only. No public uploads, RPC, keys, sockets or real publication.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  MAINNET_CASE_PUBLICATION as C,
  prepareCaseArtifact,
  publishReviewedCase,
  verifyCaseAvailability,
} from "../src/mainnet-case-publication.mjs";

const scope = () => ({ environment: "production", instanceId: "synthetic-server-before-restart", chainId: 1,
  contractVersion: "kleros-event-v9-uups", eventId: "synthetic-event-a",
  contract: "0x1111111111111111111111111111111111111111", wallet: "0x2222222222222222222222222222222222222222",
  blockNumber: 100, blockHash: `0x${"a".repeat(64)}`, matched: true, localDisputeID: "0", arbitratorDisputeID: "1002" });
const vectors = [
  ["{}", "/ipfs/QmbJWAESqCsf4RFCqEY7jecCashj8usXiyDNfKtZCwwzGb"],
  ["{}\n", "/ipfs/QmfSnGmfexFsLDkbgN76Qhx2W8sxrNDobFEQZ6ER5qg2wW"],
  ['{ "name": "café", "description": "Attendance ☺" }\n', "/ipfs/QmTK1kAuQkbJtggeemS6vsdvWCt2XmM3xtrW6faR9zqvoZ"],
];
const artifact = (i = 0, patch = {}) => prepareCaseArtifact({ scope: { ...scope(), ...patch }, content: vectors[i][0], expectedURI: vectors[i][1] });
const responseFor = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
const uploaded = (a) => responseFor({ cids: [a.uri], inconsistentCids: [] });
const claimed = (intent) => ({ claimed: true, intentId: "synthetic-durable-intent-1",
  scopeHash: intent.scopeHash, sha256: intent.sha256, uri: intent.uri });
const publish = (a, options = {}) => publishReviewedCase({ artifact: a, approvedSha256: a.sha256, approvedScopeHash: a.scopeHash,
  persistIntent: async (intent) => claimed(intent), ...options });
const code = (expected) => (error) => error.code === expected;
const sha = (value) => createHash("sha256").update(value).digest("hex");
let realFetch;
before(() => { realFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("Real network disabled by this suite"); }; });
after(() => { globalThis.fetch = realFetch; });

test("golden UnixFS CIDv0 vectors preserve whitespace, Unicode and exact UTF-8 bytes", () => {
  for (let i = 0; i < vectors.length; i++) {
    const a = artifact(i);
    assert.equal(a.content, vectors[i][0]); assert.equal(a.uri, vectors[i][1]);
    assert.equal(a.sha256, sha(Buffer.from(vectors[i][0], "utf8")));
    assert.equal(a.byteLength, Buffer.byteLength(vectors[i][0], "utf8"));
    assert.equal(a.scopeHash, sha(JSON.stringify(a.scope)));
    assert.equal(Object.isFrozen(a), true); assert.equal(Object.isFrozen(a.scope), true);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  }
  assert.notEqual(artifact().uri, artifact(1).uri, "No trailing newline is inserted or removed");
  const waiting = artifact(0, { matched: false, localDisputeID: null, arbitratorDisputeID: null });
  assert.equal(waiting.scope.matched, false, "Waiting cases can be exported without a matching transaction");
});

test("wrong environment, event/wallet context, canonical anchors and dispute IDs are refused", () => {
  for (const patch of [
    { environment: "testnet" }, { chainId: 10200 }, { contractVersion: "kleros-event-v8" },
    { eventId: "../event-a" }, { instanceId: "/private/server" }, { instanceId: "" },
    { contract: "0x0000000000000000000000000000000000000000" }, { wallet: "not-an-address" },
    { blockNumber: 0 }, { blockNumber: 1.5 }, { blockHash: `0x${"0".repeat(64)}` },
    { blockHash: "0xabc" }, { matched: "true" }, { localDisputeID: 0 }, { localDisputeID: "01" },
    { arbitratorDisputeID: String(2n ** 256n) }, { matched: false }, { localDisputeID: null }, { extra: "metadata" },
  ]) assert.throws(() => artifact(0, patch), code("INVALID_CASE_SCOPE"));
  const s = scope(); delete s.instanceId;
  assert.throws(() => prepareCaseArtifact({ scope: s, content: "{}", expectedURI: vectors[0][1] }), code("INVALID_CASE_SCOPE"));
  const accessor = scope(); Object.defineProperty(accessor, "eventId", { get: () => "synthetic-event-a", enumerable: true });
  assert.throws(() => prepareCaseArtifact({ scope: accessor, content: "{}", expectedURI: vectors[0][1] }), code("INVALID_CASE_SCOPE"));
});

test("invalid JSON, lossy UTF-8, oversized multibyte content and nonexact contract CID are refused", () => {
  for (const content of ["", "not-json", "[]", "null", '"text"', '{"name":"\ud800"}', JSON.stringify({ x: "é".repeat(C.maximumArtifactBytes / 2) })])
    assert.throws(() => prepareCaseArtifact({ scope: scope(), content, expectedURI: vectors[0][1] }), code("INVALID_CASE_CONTENT"));
  for (const expectedURI of [vectors[1][1], `${vectors[0][1]}/case.json`, `https://cdn.kleros.link${vectors[0][1]}`, "ipfs://bad"])
    assert.throws(() => prepareCaseArtifact({ scope: scope(), content: "{}", expectedURI }), code("CASE_CID_MISMATCH"));
});

test("approval and a successful durable intent are required before any HTTP request", async () => {
  const a = artifact(); let calls = 0, intents = 0;
  const fetcher = async () => { calls++; return uploaded(a); };
  for (const approvedSha256 of [undefined, "", "0".repeat(64), a.sha256.toUpperCase()])
    await assert.rejects(publishReviewedCase({ artifact: a, approvedSha256, persistIntent: async () => { intents++; }, fetcher }), code("PUBLICATION_NOT_APPROVED"));
  await assert.rejects(publishReviewedCase({ artifact: a, approvedSha256: a.sha256, approvedScopeHash: a.scopeHash, fetcher }), code("PUBLICATION_INTENT_REQUIRED"));
  await assert.rejects(publish(a, { fetcher, persistIntent: async () => { throw Error("private database diagnostic"); } }),
    (e) => e.code === "PUBLICATION_INTENT_FAILED" && !e.message.includes("private database"));
  assert.equal(calls, 0); assert.equal(intents, 0);
  let release, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const done = publish(a, { fetcher, persistIntent: async (intent) => {
    assert.equal(Object.isFrozen(intent), true);
    assert.deepEqual(intent, { version: 1, scopeHash: a.scopeHash, sha256: a.sha256,
      uri: a.uri, byteLength: a.byteLength, endpoint: C.uploadEndpoint });
    started(); await new Promise((resolve) => { release = resolve; }); return claimed(intent);
  } });
  await waiting; assert.equal(calls, 0); release();
  assert.equal((await done).status, "published-unverified"); assert.equal(calls, 1);
});

test("artifact mutation and a context substitution during intent persistence cannot reach POST", async () => {
  const a = artifact(); let calls = 0;
  const fetcher = async () => { calls++; return uploaded(a); };
  for (const mutate of [
    (x) => { x.content += "\n"; }, (x) => { x.sha256 = "0".repeat(64); },
    (x) => { x.scope.eventId = "other-event"; }, (x) => { x.byteLength++; },
    (x) => { x.transaction = { to: "never-accepted" }; },
  ]) {
    const changed = structuredClone(a); mutate(changed);
    await assert.rejects(publish(changed, { fetcher }));
    await assert.rejects(verifyCaseAvailability({ artifact: changed, fetcher }));
  }
  const changed = structuredClone(a);
  await assert.rejects(publish(changed, { fetcher, persistIntent: async (intent) => { changed.content += "\n"; return claimed(intent); } }));
  const replaced = structuredClone(a), other = artifact(0, { eventId: "other-event" });
  await assert.rejects(publish(replaced, { fetcher, persistIntent: async (intent) => { Object.assign(replaced, other); return claimed(intent); } }), code("CASE_ARTIFACT_CHANGED"));
  assert.equal(calls, 0);
});

test("publication sends exactly one file with the reviewed bytes, fixed endpoint and no credentials or financial RPC", async () => {
  const a = artifact(2); const calls = [];
  const outcome = await publish(a, { fetcher: async (url, init) => {
    calls.push({ url, init });
    assert.equal(url, C.uploadEndpoint); assert.equal(init.method, "POST");
    assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    assert.equal(init.headers, undefined, "No authorization, payment or wallet headers");
    const form = await new Request(url, init).formData(), entries = [...form.entries()];
    assert.equal(entries.length, 1); assert.equal(entries[0][0], "file");
    const file = entries[0][1]; assert.equal(file.name, "case-metadata.json");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(Buffer.from(a.content, "utf8")));
    assert.equal(file.type, "application/json");
    return responseFor({ cids: [a.uri], inconsistentCids: [], urls: ["https://evil.invalid/never-follow-this"] });
  } });
  assert.equal(calls.length, 1); assert.equal(outcome.status, "published-unverified");
  assert.equal(outcome.uri, a.uri); assert.equal(outcome.sha256, a.sha256);
});

test("missing, extra, unexpected and inconsistent upload CIDs never count as publication success", async () => {
  const a = artifact();
  for (const payload of [
    {}, { cids: [], inconsistentCids: [] }, { cids: [a.uri, a.uri], inconsistentCids: [] },
    { cids: [vectors[1][1]], inconsistentCids: [] }, { cids: [a.uri], inconsistentCids: [a.uri] },
    { cids: [a.uri] }, { cids: [null], inconsistentCids: [] },
    { cids: [`${a.uri}/file.json`], inconsistentCids: [] },
  ]) {
    let calls = 0;
    const result = await publish(a, { fetcher: async () => { calls++; return responseFor(payload); } });
    assert.equal(result.status, "integrity-mismatch"); assert.equal(calls, 1);
  }
  assert.equal((await publish(a, { fetcher: async () => responseFor({ cids: [a.uri.slice(6)], inconsistentCids: [] }) })).status,
    "published-unverified", "Bare CID and protocol CID normalize to the exact expected identity");
});

test("unknown upload outcome is not retried; GET-only recovery verifies original bytes after restart", async () => {
  const a = artifact(2); const calls = [];
  const uploadedResult = await publish(a, { fetcher: async (url, init) => {
    calls.push([url, init.method]); throw Error("remote URL with secret diagnostic");
  } });
  assert.equal(uploadedResult.status, "upload-uncertain"); assert.equal(uploadedResult.reason, "UPLOAD_UNAVAILABLE");
  const restored = JSON.parse(JSON.stringify(a));
  const verified = await verifyCaseAvailability({ artifact: restored, fetcher: async (url, init) => {
    calls.push([url, init.method]);
    assert.equal(url, `${C.gateway}${a.uri}`); assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined); return new Response(a.content);
  } });
  assert.equal(verified.status, "verified"); assert.equal(restored.scope.instanceId, "synthetic-server-before-restart");
  assert.deepEqual(calls.map(([, method]) => method), ["POST", "GET"]);
});

test("gateway truncation, mutation and excess bytes are hard integrity failures with bounded cancellation", async () => {
  const a = artifact(2);
  for (const content of [a.content.slice(0, -1), a.content.replace("café", "cafe"), `${a.content}\n`, ""])
    assert.equal((await verifyCaseAvailability({ artifact: a, fetcher: async () => new Response(content) })).status, "integrity-mismatch");
  let cancelled = 0;
  const tooLarge = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(C.maximumArtifactBytes + 1)); },
    cancel() { cancelled++; },
  });
  const result = await verifyCaseAvailability({ artifact: a, fetcher: async () => new Response(tooLarge) });
  assert.equal(result.status, "integrity-mismatch"); assert.equal(cancelled, 1);
});

test("HTTP failures, malformed/oversized upload responses and redirects remain unconfirmed without retry", async () => {
  const a = artifact();
  for (const response of [new Response("", { status: 413 }), new Response("no JSON"),
    new Response("x".repeat(C.maximumUploadResponseBytes + 1)), new Response(null, { status: 302 })]) {
    let calls = 0;
    const result = await publish(a, { fetcher: async () => { calls++; return response; } });
    assert.equal(result.status, "upload-uncertain"); assert.equal(calls, 1);
  }
  for (const response of [new Response(null, { status: 404 }), new Response(null, { status: 503 }), new Response(null, { status: 302 })])
    assert.equal((await verifyCaseAvailability({ artifact: a, fetcher: async () => response })).status, "availability-unconfirmed");
  assert.equal((await verifyCaseAvailability({ artifact: a, fetcher: async () => { throw Error("private endpoint diagnostic"); } })).reason,
    "GATEWAY_UNAVAILABLE");
});

test("a stalled upload has a hard overall timeout even when the HTTP transport ignores abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = artifact(); let entered, calls = 0, signal;
  const started = new Promise((resolve) => { entered = resolve; });
  const work = publish(a, { fetcher: async (_url, init) => { calls++; signal = init.signal; entered(); return new Promise(() => {}); } });
  await started; t.mock.timers.tick(C.requestTimeoutMs);
  const result = await work;
  assert.equal(result.status, "upload-uncertain"); assert.equal(result.reason, "UPLOAD_TIMEOUT");
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});

test("a stalled gateway response stream is bounded by the same deadline and remains availability-unconfirmed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = artifact(); let entered, cancelled = 0;
  const started = new Promise((resolve) => { entered = resolve; });
  const stream = new ReadableStream({ pull() { entered(); return new Promise(() => {}); }, cancel() { cancelled++; } });
  const work = verifyCaseAvailability({ artifact: a, fetcher: async () => new Response(stream) });
  await started; await Promise.resolve(); t.mock.timers.tick(C.requestTimeoutMs);
  const result = await work;
  assert.equal(result.status, "availability-unconfirmed"); assert.equal(result.reason, "GATEWAY_TIMEOUT");
  assert.equal(cancelled, 1);
});

test("publication approval binds the reviewed scope even when another case has identical bytes", async () => {
  const a = artifact(), other = artifact(0, { eventId: "another-event", blockNumber: 101 });
  assert.equal(a.sha256, other.sha256); assert.notEqual(a.scopeHash, other.scopeHash);
  let requests = 0, claims = 0;
  for (const approvedScopeHash of [undefined, "", "0".repeat(64), a.scopeHash])
    await assert.rejects(publishReviewedCase({ artifact: other, approvedSha256: a.sha256, approvedScopeHash,
      persistIntent: async (intent) => { claims++; return claimed(intent); },
      fetcher: async () => { requests++; return uploaded(other); } }));
  assert.equal(claims, 0); assert.equal(requests, 0);
});

test("a no-op or mismatched durable claim proof cannot authorize POST", async () => {
  const a = artifact(); let requests = 0;
  const invalidClaims = [
    () => undefined, () => false, () => ({}), (intent) => ({ ...claimed(intent), claimed: false }),
    (intent) => ({ ...claimed(intent), intentId: "" }), (intent) => ({ ...claimed(intent), intentId: " " }),
    (intent) => ({ ...claimed(intent), scopeHash: "0".repeat(64) }),
    (intent) => ({ ...claimed(intent), sha256: "0".repeat(64) }),
    (intent) => ({ ...claimed(intent), uri: vectors[1][1] }),
  ];
  for (const persistIntent of invalidClaims)
    await assert.rejects(publishReviewedCase({ artifact: a, approvedScopeHash: a.scopeHash, approvedSha256: a.sha256,
      persistIntent, fetcher: async () => { requests++; return uploaded(a); } }));
  assert.equal(requests, 0);
});

test("one atomic claim permits only one POST across concurrent identical reviewed requests", async () => {
  const a = artifact(); let taken = false, requests = 0;
  const persistIntent = async (intent) => {
    if (taken) throw Error("Already claimed: inspect the original publication outcome");
    taken = true;
    return claimed(intent);
  };
  const attempt = () => publishReviewedCase({ artifact: a, approvedScopeHash: a.scopeHash, approvedSha256: a.sha256,
    persistIntent, fetcher: async () => { requests++; return uploaded(a); } });
  const results = await Promise.allSettled([attempt(), attempt()]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(requests, 1);
});

test("an uncertain durable claim remains consumed; independent GET recovers without another upload", async () => {
  const a = artifact(); let taken = false, requests = 0;
  const persistIntent = async (intent) => {
    if (taken) throw Error("Claim already consumed or uncertain");
    taken = true;
    return claimed(intent);
  };
  const attempt = () => publishReviewedCase({ artifact: a, approvedScopeHash: a.scopeHash, approvedSha256: a.sha256,
    persistIntent, fetcher: async () => { requests++; throw Error("Response lost after POST"); } });
  assert.equal((await attempt()).status, "upload-uncertain");
  await assert.rejects(attempt());
  assert.equal(requests, 1);
  assert.equal((await verifyCaseAvailability({ artifact: a, fetcher: async (_url, init) => {
    assert.equal(init.method, "GET"); return new Response(a.content);
  } })).status, "verified");
  assert.equal(requests, 1);
});
