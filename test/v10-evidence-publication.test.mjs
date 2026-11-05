import { test } from "node:test";
import assert from "node:assert/strict";
import { createV10EvidencePublicationService } from "../src/v10-evidence-publication.mjs";

const author = "0x1111111111111111111111111111111111111111", challenger = "0x2222222222222222222222222222222222222222";
const scope = { environment: "production", instanceId: "synthetic-evidence", chainId: 1,
  contractVersion: "kleros-event-v10-uups", eventId: "synthetic-event", contract: "0x3333333333333333333333333333333333333333",
  wallet: challenger, blockNumber: 100, blockHash: "0x" + "a".repeat(64), matched: true, localDisputeID: "7", arbitratorDisputeID: "42" };
const ctx = { eventId: scope.eventId, wallet: challenger, session: { mode: "wallet", wallet: author }, assertSession() {} };
const input = { title: "Attendance", description: "I attended the sample event.", attachmentURI: "" };
const clone = x => structuredClone(x);
function fixture({ durable = { productionCase: true, artifact: { test: true } }, fetcher } = {}) {
  const f = { durable: clone(durable), local: clone(durable), calls: [], current: clone(scope) };
  f.service = createV10EvidencePublicationService({
    ensureCase: async () => {},
    readCase: async context => { context.assertSession(); return { scope: clone(f.current), evidenceOpen: f.evidenceOpen !== false, evidenceAuthors: [author, challenger] }; },
    readRecord: () => clone(f.local),
    writeRecord: (_context, record) => { f.local = clone(record); },
    persist: () => {
      for (const [key, old] of Object.entries(f.durable.evidenceArtifacts ?? {})) {
        const next = f.local.evidenceArtifacts?.[key];
        assert.deepEqual(next?.artifact, old.artifact);
        if (Object.hasOwn(old, "intent")) assert.deepEqual(next?.intent, old.intent);
      }
      f.durable = clone(f.local);
    },
    fetcher: async (url, init) => {
      f.calls.push(init.method);
      if (fetcher) return fetcher(url, init, f);
      if (init.method === "GET") return new Response(Object.values(f.durable.evidenceArtifacts)[0].artifact.content);
      const artifact = Object.values(f.durable.evidenceArtifacts)[0].artifact;
      assert.ok(Object.values(f.durable.evidenceArtifacts)[0].intent, "intent persisted before POST");
      return new Response(JSON.stringify({ cids: [artifact.uri], inconsistentCids: [] }));
    }, now: () => 1000,
  });
  return f;
}
const selection = dto => ({ sha256: dto.artifact.sha256, scopeHash: dto.artifact.scopeHash });

test("matched V10 evidence is authored from the signed-in wallet and requires explicit consent", async () => {
  const f = fixture(), prepared = await f.service.prepare(ctx, input);
  assert.equal(prepared.publication.status, "exported"); assert.deepEqual(f.calls, []);
  assert.equal(JSON.parse(prepared.artifact.content).submitter, author);
  await assert.rejects(f.service.publish(ctx, selection(prepared)), { code: "PUBLICATION_NOT_APPROVED" });
  assert.deepEqual(f.calls, []);
  const result = await f.service.publish(ctx, { ...selection(prepared), consent: true });
  assert.equal(result.publication.status, "published-unverified");
  assert.equal((await f.service.availability(ctx, selection(prepared))).publication.status, "verified");
  assert.deepEqual(f.calls, ["POST", "GET"]);
});

test("unmatched, wrong-author, modified-case, oversized and unsafe attachment inputs cannot upload", async () => {
  const f = fixture(); f.current.matched = false;
  await assert.rejects(f.service.prepare(ctx, input), { code: "CASE_PUBLICATION_CHANGED" });
  f.current.matched = true;
  for (const bad of [{ ...input, description: "" }, { ...input, description: "a".repeat(8001) },
    { ...input, attachmentURI: "https://example.invalid/file" }, { ...input, attachmentURI: "/ipfs/abc/../secret" },
    { ...input, attachmentURI: "/ipfs/abc/./secret" }, { ...input, attachmentURI: "/ipfs/abc/file.pdf?x=1" },
    { ...input, attachmentURI: "/ipfs/abc/%2e%2e/file" }])
    await assert.rejects(f.service.prepare(ctx, bad), { code: "INVALID_INPUT" });
  const prepared = await f.service.prepare(ctx, input);
  await assert.rejects(f.service.publish({ ...ctx, session: { mode: "wallet", wallet: challenger } },
    { ...selection(prepared), consent: true }), { code: "PUBLICATION_RECORD_CHANGED" });
  f.current.localDisputeID = "8";
  await assert.rejects(f.service.publish(ctx, { ...selection(prepared), consent: true }), { code: "CASE_PUBLICATION_CHANGED" });
  assert.deepEqual(f.calls, []);
});

test("ordinary dotted attachment filenames are accepted, without accepting a changed author during export", async () => {
  const f = fixture();
  const prepared = await f.service.prepare(ctx, { ...input, attachmentURI: "/ipfs/abc/evidence.pdf" });
  assert.equal(JSON.parse(prepared.artifact.content).fileURI, "/ipfs/abc/evidence.pdf");
  const local = { ...ctx, session: { ...ctx.session } };
  const g = fixture();
  const svc = createV10EvidencePublicationService({ ensureCase: async () => { local.session.wallet = challenger; },
    readCase: async () => ({ scope: clone(scope), evidenceOpen: true, evidenceAuthors: [author, challenger] }), readRecord: () => clone(g.local),
    writeRecord: (_c, value) => { g.local = clone(value); }, persist: () => {}, fetcher: async () => { throw Error("no network"); } });
  await assert.rejects(svc.prepare(local, input), { code: "CASE_PUBLICATION_CHANGED" });
  assert.equal(g.local.evidenceArtifacts, undefined);
});

test("unrelated wallets cannot fill hosted storage and one case party cannot consume another party's capacity", async () => {
  const f = fixture(), outsider = "0x4444444444444444444444444444444444444444";
  await assert.rejects(f.service.prepare({ ...ctx, session: { mode: "wallet", wallet: outsider } }, input), { code: "FORBIDDEN" });
  for (let i = 0; i < 10; i++) await f.service.prepare(ctx, { ...input, title: `Evidence ${i}` });
  await assert.rejects(f.service.prepare(ctx, { ...input, title: "Evidence 11" }), { code: "PUBLICATION_CAPACITY" });
  const otherParty = { ...ctx, session: { mode: "wallet", wallet: challenger } };
  assert.equal((await f.service.prepare(otherParty, input)).publication.status, "exported");
  assert.equal(Object.keys(f.durable.evidenceArtifacts).length, 11);
  assert.deepEqual(f.calls, []);
});

test("an uncertain evidence upload survives service restart and permits GET recovery only", async () => {
  const first = fixture({ fetcher: async () => { throw Error("synthetic lost response"); } });
  const prepared = await first.service.prepare(ctx, input);
  const outcome = await first.service.publish(ctx, { ...selection(prepared), consent: true });
  assert.equal(outcome.publication.status, "upload-uncertain"); assert.deepEqual(first.calls, ["POST"]);
  const restarted = fixture({ durable: first.durable });
  const recovered = await restarted.service.publish(ctx, { ...selection(prepared), consent: true });
  assert.equal(recovered.publication.status, "verified"); assert.deepEqual(restarted.calls, ["GET"]);
});

test("two stale services cannot both upload the same reviewed evidence", async () => {
  let durable = { productionCase: true, artifact: { test: true } }, localA = clone(durable), localB;
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; }); let posts = 0;
  function service(readLocal, writeLocal) {
    return createV10EvidencePublicationService({
      ensureCase: async () => {}, readCase: async () => ({ scope: clone(scope), evidenceOpen: true, evidenceAuthors: [author, challenger] }),
      readRecord: () => clone(readLocal()), writeRecord: (_ctx, record) => writeLocal(clone(record)),
      persist: () => {
        const next = readLocal();
        for (const [key, old] of Object.entries(durable.evidenceArtifacts ?? {})) {
          assert.deepEqual(next.evidenceArtifacts?.[key]?.artifact, old.artifact);
          if (Object.hasOwn(old, "intent")) assert.deepEqual(next.evidenceArtifacts?.[key]?.intent, old.intent);
        }
        durable = clone(next);
      },
      fetcher: async (_url, init) => {
        if (init.method === "POST") { posts++; entered(); await held;
          return new Response(JSON.stringify({ cids: [Object.values(durable.evidenceArtifacts)[0].artifact.uri], inconsistentCids: [] })); }
        return new Response(Object.values(durable.evidenceArtifacts)[0].artifact.content);
      }, now: () => 1000,
    });
  }
  const first = service(() => localA, value => { localA = value; });
  const prepared = await first.prepare(ctx, input); localB = clone(durable);
  const second = service(() => localB, value => { localB = value; });
  const running = first.publish(ctx, { ...selection(prepared), consent: true });
  await started;
  await assert.rejects(second.publish(ctx, { ...selection(prepared), consent: true }), { code: "PUBLICATION_INTENT_FAILED" });
  assert.equal(posts, 1); release(); assert.equal((await running).publication.status, "published-unverified");
});

test("unavailable or incorrect gateway content never becomes verified and never retries an upload", async () => {
  const f = fixture({ fetcher: async (_url, init) => {
    if (init.method === "POST") throw Error("uncertain");
    return new Response("wrong evidence bytes");
  } });
  const prepared = await f.service.prepare(ctx, input);
  assert.equal((await f.service.publish(ctx, { ...selection(prepared), consent: true })).publication.status, "upload-uncertain");
  assert.equal((await f.service.availability(ctx, selection(prepared))).publication.status, "integrity-mismatch");
  assert.deepEqual(f.calls, ["POST", "GET"]);
});


test("after a ruling new evidence POST is refused while old uncertain upload remains verifiable", async () => {
  const f = fixture({ fetcher: async (_url, init, state) => {
    if (init.method === "POST") throw Error("response lost");
    return new Response(Object.values(state.durable.evidenceArtifacts)[0].artifact.content);
  } });
  const original = await f.service.prepare(ctx, input);
  const next = await f.service.prepare(ctx, { ...input, description: "another evidence item" });
  assert.equal((await f.service.publish(ctx, { ...selection(original), consent: true })).publication.status, "upload-uncertain");
  f.evidenceOpen = false;
  await assert.rejects(f.service.publish(ctx, { ...selection(next), consent: true }), { code: "CASE_PUBLICATION_CHANGED" });
  assert.equal((await f.service.availability(ctx, selection(original))).publication.status, "verified");
  assert.deepEqual(f.calls, ["POST", "GET"]);
});

test("ERC-1497 attachment hash and file extension come from CID and verified own-file record", async () => {
  const cid = "QmbJWAESqCsf4RFCqEY7jecCashj8usXiyDNfKtZCwwzGb", uri = "/ipfs/" + cid;
  const f = fixture();
  f.durable.fileArtifacts = { item: { author, status: "verified", artifact: { uri, fileName: "attendance.pdf" } } };
  f.local = clone(f.durable);
  const verified = JSON.parse((await f.service.prepare(ctx, { ...input, attachmentURI: uri })).artifact.content);
  assert.equal(verified.fileURI, uri); assert.equal(verified.fileHash, cid); assert.equal(verified.fileTypeExtension, "pdf");
  const other = fixture(); other.durable.fileArtifacts = { item: { author: challenger, status: "verified", artifact: { uri, fileName: "not-trusted.pdf" } } };
  other.local = clone(other.durable);
  const externallyHosted = JSON.parse((await other.service.prepare(ctx, { ...input, attachmentURI: uri })).artifact.content);
  assert.equal(externallyHosted.fileHash, cid); assert.equal(externallyHosted.fileTypeExtension, undefined);
});
