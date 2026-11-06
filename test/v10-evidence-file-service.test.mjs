// Mock canonical case reads, stale-writer-safe storage and HTTP. No live actions.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createV10EvidenceFileService, V10_EVIDENCE_FILE_RESOLVER } from "../src/v10-evidence-file-service.mjs";
import { PRODUCTION_EVIDENCE_FILE as C } from "../src/production-evidence-file.mjs";
const copy = value => structuredClone(value), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wallet = "0x2222222222222222222222222222222222222222", author = "0x3333333333333333333333333333333333333333";
const base64 = Buffer.from("{}").toString("base64"), input = () => ({ fileName: "proof.json", mediaType: "application/json", base64 });
const select = dto => ({ sha256: dto.artifact.sha256, scopeHash: dto.artifact.scopeHash, base64 });
const code = expected => error => error.code === expected;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let realFetch;
before(() => { realFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("Real network disabled"); }; });
after(() => { globalThis.fetch = realFetch; });
function fixture({ durable = new Map(), fetcher } = {}) {
  const f = { durable, record: copy(durable.get("case") ?? null), authorized: true, open: true, orphaned: false,
    requests: [], reads: 0, saves: 0, block: 100, instance: "synthetic-original-server", localID: "0", beforeRead: null, beforeSave: null,
    evidenceAuthors: [wallet, author, "0x4444444444444444444444444444444444444444"] };
  f.ctx = { eventId: "synthetic-event", wallet, session: { id: "synthetic-session", mode: "wallet", wallet: author },
    assertSession() { if (!f.authorized) throw Object.assign(Error("private auth diagnostic"), { code: "UNAUTHENTICATED" }); } };
  f.callbacks = {
    readCase: async (ctx, saved) => {
      ctx.assertSession(); f.reads++; if (f.beforeRead) await f.beforeRead(); ctx.assertSession();
      if (f.orphaned && saved) throw Object.assign(Error("Orphaned original block"), { code: "CASE_REORG" });
      return { scope: { environment: "production", instanceId: f.instance, chainId: 1, contractVersion: "kleros-event-v10-uups",
        eventId: ctx.eventId, contract: "0x1111111111111111111111111111111111111111", wallet: ctx.wallet,
        blockNumber: f.block, blockHash: "0x" + String(f.block % 10).repeat(64), matched: true, localDisputeID: f.localID, arbitratorDisputeID: "51" },
      evidenceOpen: f.open, evidenceAuthors: copy(f.evidenceAuthors) };
    },
    ensureCase: async ctx => { ctx.assertSession(); if (!f.record) { f.record = { productionCase: true, artifact: { kind: "synthetic-case-export" } }; durable.set("case", copy(f.record)); } },
    readRecord: () => copy(f.record), writeRecord: (_ctx, value) => { f.record = copy(value); },
    persist: () => {
      f.saves++; if (f.beforeSave) f.beforeSave(); const previous = durable.get("case");
      for (const [key, item] of Object.entries(previous?.fileArtifacts ?? {})) {
        const next = f.record.fileArtifacts?.[key];
        if (!next || !same(item.artifact, next.artifact) || Object.hasOwn(item, "intent") && !same(item.intent, next.intent))
          throw Object.assign(Error("stale writer"), { code: "STATE_SCOPE" });
      }
      durable.set("case", copy(f.record));
    },
    fetcher: async (url, init) => {
      f.requests.push({ url, method: init.method });
      assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
      if (init.method === "POST") {
        assert.equal(url, C.uploadEndpoint);
        const entry = Object.values(durable.get("case").fileArtifacts).find(item => item.intent);
        assert(entry?.intent, "Exclusive durable intent must exist before POST");
      }
      if (fetcher) return fetcher(url, init, f);
      if (init.method === "GET") return new Response("{}");
      const file = Object.values(durable.get("case").fileArtifacts).find(item => item.intent);
      return new Response(JSON.stringify({ cids: [file.artifact.uri], inconsistentCids: [] }));
    }, now: () => 1000,
  };
  f.service = createV10EvidenceFileService(f.callbacks); return f;
}

test("prepare is local-only, binds exact author/resolver/case and stores no file bytes or base64", async () => {
  const f = fixture(); f.block = 101;
  const first = await f.service.prepare(f.ctx, input());
  assert.equal(first.artifact.scope.uploaderWallet, author); assert.equal(first.artifact.scope.wallet, wallet);
  assert.equal(first.artifact.scope.resolver, V10_EVIDENCE_FILE_RESOLVER); assert.equal(first.artifact.scope.localDisputeID, "0");
  assert.equal(first.publication.status, "exported"); assert.equal(first.publication.canPublish, true);
  assert.deepEqual(f.requests, []); assert.equal(Object.keys(f.durable.get("case").fileArtifacts).length, 1);
  const saved = JSON.stringify(f.durable.get("case")); assert.doesNotMatch(saved, /base64|e30=|"bytes"/);
  f.block = 102; const again = await f.service.prepare(f.ctx, input()); assert.deepEqual(again.artifact, first.artifact);
  const restarted = fixture({ durable: f.durable }); restarted.block = 103; restarted.instance = "synthetic-new-server";
  const resumed = await restarted.service.prepare(restarted.ctx, input()); assert.deepEqual(resumed.artifact, first.artifact);
  assert.equal(resumed.currentCase.instanceId, "synthetic-new-server"); assert.deepEqual(restarted.requests, []);
});

test("noncanonical base64, extra fields and missing explicit public consent never reach upload", async () => {
  const f = fixture(); f.block = 101;
  for (const encoded of ["", "e30", "e30=\n", "e31=", "-___", "A".repeat(349532)])
    await assert.rejects(f.service.prepare(f.ctx, { ...input(), base64: encoded }), code("INVALID_EVIDENCE_FILE"));
  await assert.rejects(f.service.prepare(f.ctx, { ...input(), endpoint: "https://example.invalid" }), code("INVALID_INPUT"));
  assert.equal(f.record, null);
  const dto = await f.service.prepare(f.ctx, input());
  for (const bad of [{ ...select(dto) }, { ...select(dto), consent: false }, { ...select(dto), consent: true, author },
    { ...select(dto), consent: true, sha256: "0".repeat(64) }]) await assert.rejects(f.service.publish(f.ctx, bad));
  assert.deepEqual(f.requests, []);
});

test("a wallet change during case export cannot prepare an attachment under the previous author", async () => {
  const f = fixture(); f.block = 101;
  const service = createV10EvidenceFileService({ ...f.callbacks, ensureCase: async ctx => {
    await f.callbacks.ensureCase(ctx); ctx.session.wallet = wallet;
  } });
  await assert.rejects(service.prepare(f.ctx, input()), code("UNAUTHENTICATED"));
  assert.equal(Object.hasOwn(f.durable.get("case"), "fileArtifacts"), false); assert.deepEqual(f.requests, []);
});

test("only freshly proved case parties may use hosted preparation or recovery and one party cannot consume another party's capacity", async () => {
  const f = fixture(); f.block = 101;
  f.ctx.session.wallet = "0x5555555555555555555555555555555555555555";
  await assert.rejects(f.service.prepare(f.ctx, input()), code("EVIDENCE_AUTHOR_FORBIDDEN"));
  assert.equal(Object.hasOwn(f.durable.get("case"), "fileArtifacts"), false);
  f.ctx.session.wallet = author;
  for (let i = 0; i < 10; i++) await f.service.prepare(f.ctx, { ...input(), fileName: `party-proof-${i}.json` });
  await assert.rejects(f.service.prepare(f.ctx, { ...input(), fileName: "over-author-limit.json" }), code("PUBLICATION_CAPACITY"));
  f.ctx.session.wallet = wallet;
  const own = await f.service.prepare(f.ctx, input());
  assert.equal(Object.keys(f.durable.get("case").fileArtifacts).length, 11);
  f.evidenceAuthors = [author];
  await assert.rejects(f.service.availability(f.ctx, select(own)), code("EVIDENCE_AUTHOR_FORBIDDEN"));
  await assert.rejects(f.service.publish(f.ctx, { ...select(own), consent: true }), code("EVIDENCE_AUTHOR_FORBIDDEN"));
  assert.deepEqual(f.requests, []);
});

test("one explicit publish persists before POST; identical concurrent publish uses only GET recovery", async () => {
  const entered = deferred(), wait = deferred(), f = fixture({ fetcher: async (_url, init, state) => {
    if (init.method === "GET") return new Response("{}"); entered.resolve(); await wait.promise;
    const item = Object.values(state.durable.get("case").fileArtifacts)[0];
    return new Response(JSON.stringify({ cids: [item.artifact.uri], inconsistentCids: [] }));
  } }); f.block = 101;
  const dto = await f.service.prepare(f.ctx, input()), approval = { ...select(dto), consent: true };
  const first = f.service.publish(f.ctx, approval); await entered.promise;
  const second = f.service.publish(f.ctx, approval); wait.resolve();
  assert.equal((await first).publication.status, "published-unverified");
  assert.equal((await second).publication.status, "verified");
  assert.deepEqual(f.requests.map(r => r.method), ["POST", "GET"]);
  assert.equal(Object.hasOwn(Object.values(f.durable.get("case").fileArtifacts)[0], "intent"), true);
});

test("an unknown upload remains consumed across restart and can be checked after the evidence period closes", async () => {
  const f = fixture({ fetcher: async () => { throw Error("private transport diagnostic"); } }); f.block = 101;
  const dto = await f.service.prepare(f.ctx, input());
  const result = await f.service.publish(f.ctx, { ...select(dto), consent: true }); assert.equal(result.publication.status, "upload-uncertain");
  const restart = fixture({ durable: f.durable }); restart.block = 102; restart.open = false;
  const verified = await restart.service.publish(restart.ctx, { ...select(dto), consent: true });
  assert.equal(verified.publication.status, "verified"); assert.equal(verified.publication.canPublish, false);
  assert.deepEqual(restart.requests.map(r => r.method), ["GET"]);
  assert.equal((await restart.service.availability(restart.ctx, select(dto))).publication.status, "verified");
  assert.deepEqual(restart.requests.map(r => r.method), ["GET", "GET"]);
});

test("closed case, changed author/IDs, corrupted bytes and orphaned original scope block a new upload", async () => {
  for (const mutate of [f => { f.open = false; }, f => { f.ctx.session.wallet = wallet; },
    f => { f.localID = "1"; }, f => { f.orphaned = true; }]) {
    const f = fixture(); f.block = 101; const dto = await f.service.prepare(f.ctx, input()); mutate(f);
    await assert.rejects(f.service.publish(f.ctx, { ...select(dto), consent: true })); assert.deepEqual(f.requests, []);
  }
  const f = fixture(); f.block = 101; const dto = await f.service.prepare(f.ctx, input());
  await assert.rejects(f.service.publish(f.ctx, { ...select(dto), base64: Buffer.from("[]").toString("base64"), consent: true }));
  assert.deepEqual(f.requests, []);
});

test("fresh authorization loss after POST leaves the intent unknown and prevents cached disclosure or reupload", async () => {
  const f = fixture({ fetcher: async (_url, _init, state) => { state.authorized = false; return new Response("{}"); } }); f.block = 101;
  const dto = await f.service.prepare(f.ctx, input());
  await assert.rejects(f.service.publish(f.ctx, { ...select(dto), consent: true }), code("UNAUTHENTICATED"));
  assert.equal(f.requests.length, 1); const saved = Object.values(f.durable.get("case").fileArtifacts)[0];
  assert(saved.intent); assert.equal(saved.status, "upload-uncertain");
  const restart = fixture({ durable: f.durable }); restart.block = 102;
  assert.equal((await restart.service.publish(restart.ctx, { ...select(dto), consent: true })).publication.status, "verified");
  assert.deepEqual(restart.requests.map(r => r.method), ["GET"]);
});

test("a stale process cannot overwrite a consumed file intent or send a second POST", async () => {
  const f = fixture(); f.block = 101; const dto = await f.service.prepare(f.ctx, input());
  const stale = fixture({ durable: f.durable }); stale.block = 102;
  await f.service.publish(f.ctx, { ...select(dto), consent: true });
  await assert.rejects(stale.service.publish(stale.ctx, { ...select(dto), consent: true }), code("EVIDENCE_INTENT_FAILED"));
  assert.equal(stale.requests.length, 0); assert.equal(f.requests.filter(r => r.method === "POST").length, 1);
});

test("failed or asynchronous persistence cannot authorize a transport", async () => {
  const f = fixture(); f.block = 101; const dto = await f.service.prepare(f.ctx, input());
  f.beforeSave = () => { throw Error("private persistence diagnostic"); };
  await assert.rejects(f.service.publish(f.ctx, { ...select(dto), consent: true }), code("EVIDENCE_INTENT_FAILED"));
  assert.deepEqual(f.requests, []);
  const g = fixture(); g.block = 101; const prepared = await g.service.prepare(g.ctx, input());
  const service = createV10EvidenceFileService({ ...g.callbacks, persist: () => Promise.resolve() });
  await assert.rejects(service.publish(g.ctx, { ...select(prepared), consent: true }), code("EVIDENCE_INTENT_FAILED"));
  assert.deepEqual(g.requests, []);
});
