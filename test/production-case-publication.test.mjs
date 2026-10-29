// Mock canonical readers/storage/HTTP only: no RPC, signing, sockets, public upload or keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProductionCasePublicationService } from "../src/production-case-publication.mjs";
import { MAINNET_CASE_PUBLICATION as C } from "../src/mainnet-case-publication.mjs";

const clone = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wallet = "0x2222222222222222222222222222222222222222";
const otherWallet = "0x3333333333333333333333333333333333333333";
const contract = "0x1111111111111111111111111111111111111111";
const uri = "/ipfs/QmbJWAESqCsf4RFCqEY7jecCashj8usXiyDNfKtZCwwzGb";
const uriNewline = "/ipfs/QmfSnGmfexFsLDkbgN76Qhx2W8sxrNDobFEQZ6ER5qg2wW";
const context = (patch = {}) => ({ eventId: "synthetic-event-a", wallet, ...patch });
const sourceScope = () => ({ environment: "production", instanceId: "synthetic-original-instance", chainId: 1,
  contractVersion: "kleros-event-v9-uups", eventId: "synthetic-event-a", contract, wallet,
  blockNumber: 100, blockHash: `0x${"a".repeat(64)}`, matched: false,
  localDisputeID: null, arbitratorDisputeID: null });
const err = (code, status = 409) => Object.assign(new Error(code), { code, status });
const code = (...codes) => (error) => codes.includes(error.code);
const key = (ctx) => `${ctx.eventId}:${ctx.wallet.toLowerCase()}`;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const approval = (dto) => ({ sha256: dto.artifact.sha256, scopeHash: dto.artifact.scopeHash });

function fixture({ durable = new Map(), source = sourceScope(), fetcher, initialRecords, persistHook } = {}) {
  const f = { durable, source, content: "{}", uri, authorized: true, reads: 0, writes: 0, saves: 0,
    requests: [], orphans: new Set(), records: new Map(initialRecords || [...durable].map(([k, v]) => [k, clone(v)])),
    onRead: null, beforePersist: persistHook, now: 1000 };
  const callbacks = {
    readCase: async (ctx, saved) => {
      f.reads++;
      if (ctx.assertSession) ctx.assertSession();
      if (!f.authorized) throw err("UNAUTHENTICATED", 401);
      if (ctx.eventId !== f.source.eventId || ctx.wallet.toLowerCase() !== f.source.wallet.toLowerCase())
        throw err("FORBIDDEN", 403);
      if (saved && f.orphans.has(saved.scope.blockHash)) throw err("CASE_REORG");
      if (f.onRead) await f.onRead(ctx, saved);
      return { scope: clone(f.source), content: f.content, expectedURI: f.uri };
    },
    readRecord: (ctx) => clone(f.records.get(key(ctx))),
    writeRecord: (ctx, record) => { f.writes++; f.records.set(key(ctx), clone(record)); },
    persist: () => {
      f.saves++;
      if (f.beforePersist) f.beforePersist(f);
      // Models the integration owner's cross-process check/fsync/rename store guard.
      for (const [k, next] of f.records) {
        const prior = durable.get(k);
        if (prior && !same(prior.artifact, next.artifact)) throw err("STATE_SCOPE");
        if (prior && Object.hasOwn(prior, "intent") &&
          (!Object.hasOwn(next, "intent") || !same(prior.intent, next.intent))) throw err("STATE_SCOPE");
      }
      for (const [k, next] of f.records) durable.set(k, clone(next));
    },
    fetcher: async (url, init) => {
      f.requests.push({ url, method: init.method });
      assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
      if (fetcher) return fetcher(url, init, f);
      if (init.method === "GET") return new Response(f.content);
      assert.equal(url, C.uploadEndpoint);
      const saved = durable.get(key(context()));
      assert.ok(saved?.intent, "An exact durable intent exists before POST");
      assert.equal(saved.intent.sha256, saved.artifact.sha256);
      assert.equal(saved.intent.scopeHash, saved.artifact.scopeHash);
      return new Response(JSON.stringify({ cids: [f.uri], inconsistentCids: [] }));
    },
    now: () => f.now,
  };
  f.service = createProductionCasePublicationService(callbacks);
  f.callbacks = callbacks;
  return f;
}

test("construction/export perform no HTTP; original waiting artifact survives restart, new head and actual match IDs", async () => {
  const f = fixture();
  assert.equal(f.reads, 0); assert.equal(f.saves, 0); assert.deepEqual(f.requests, []);
  const ctx = context({ assertSession() {} });
  const first = await f.service.exportCase(ctx);
  assert.equal(first.publication.status, "exported"); assert.equal(first.artifact.scope.matched, false);
  assert.equal(first.publication.uploadAttempted, false); assert.equal(first.publication.canPublish, true);
  assert.equal(first.artifact.scope.localDisputeID, null); assert.equal(first.artifact.scope.arbitratorDisputeID, null);
  assert.deepEqual(Object.keys(first).sort(), ["artifact", "currentCase", "publication"]);
  assert.ok(!JSON.stringify(first).includes("assertSession"));
  first.artifact.content = "tampered detached DTO";
  const original = clone(f.durable.get(key(ctx)).artifact);
  const restart = fixture({ durable: f.durable, source: { ...sourceScope(), instanceId: "synthetic-restart",
    blockNumber: 110, blockHash: `0x${"b".repeat(64)}`, matched: true,
    localDisputeID: "7", arbitratorDisputeID: "1009" } });
  let checkedOriginal = 0;
  restart.onRead = (_ctx, saved) => { if (saved?.scope.blockNumber === 100) checkedOriginal++; };
  const again = await restart.service.exportCase(ctx);
  assert.deepEqual(again.artifact, original);
  assert.equal(again.currentCase.instanceId, "synthetic-restart");
  assert.equal(again.currentCase.localDisputeID, "7"); assert.equal(again.currentCase.arbitratorDisputeID, "1009");
  assert.ok(checkedOriginal > 0); assert.deepEqual(restart.requests, []);
});

test("parallel reviewed publishes serialize to exactly one POST; a returned CID is still not gateway verification", async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ fetcher: async (_url, init, state) => {
    if (init.method === "GET") return new Response(state.content);
    assert.ok(state.durable.get(key(context()))?.intent);
    entered.resolve(); await release.promise;
    return new Response(JSON.stringify({ cids: [state.uri], inconsistentCids: [] }));
  } });
  const reviewed = await f.service.exportCase(context());
  const first = f.service.publishCase(context(), approval(reviewed));
  await entered.promise;
  const second = f.service.publishCase(context(), approval(reviewed));
  assert.deepEqual(f.requests.map((x) => x.method), ["POST"]);
  release.resolve();
  const [published, recovered] = await Promise.all([first, second]);
  assert.equal(published.publication.status, "published-unverified");
  assert.equal(recovered.publication.status, "verified");
  assert.equal(published.publication.uploadAttempted, true); assert.equal(published.publication.canPublish, false);
  assert.equal(recovered.publication.uploadAttempted, true); assert.equal(recovered.publication.canPublish, false);
  assert.deepEqual(f.requests.map((x) => x.method), ["POST", "GET"]);
  assert.equal(Object.hasOwn(published, "intent"), false);
  assert.equal(Object.hasOwn(published.publication, "intentId"), false);
  const intent = f.durable.get(key(context())).intent;
  assert.match(intent.intentId, /^[A-Za-z0-9_-]{1,160}$/);
  assert.equal(intent.uri, reviewed.artifact.uri); assert.equal(intent.scopeHash, reviewed.artifact.scopeHash);
});

test("unknown POST outcome survives a true fresh-service restart and permits GET recovery only", async () => {
  const f = fixture({ fetcher: async () => { throw Error("Response lost; internal transport detail"); } });
  const reviewed = await f.service.exportCase(context());
  const uncertain = await f.service.publishCase(context(), approval(reviewed));
  assert.equal(uncertain.publication.status, "upload-uncertain");
  assert.equal(uncertain.publication.reason, "UPLOAD_UNAVAILABLE");
  const marker = clone(f.durable.get(key(context())).intent);
  const restarted = fixture({ durable: f.durable, source: { ...sourceScope(), instanceId: "fresh-instance",
    blockNumber: 120, blockHash: `0x${"c".repeat(64)}` } });
  const recovered = await restarted.service.publishCase(context(), approval(reviewed));
  assert.equal(recovered.publication.status, "verified");
  assert.deepEqual(restarted.requests.map((x) => x.method), ["GET"]);
  assert.deepEqual(f.requests.map((x) => x.method), ["POST"]);
  assert.deepEqual(restarted.durable.get(key(context())).intent, marker);
  assert.deepEqual(recovered.artifact, reviewed.artifact);
});

test("approval binds the original scope as well as exact bytes; export and verify never imply approval", async () => {
  const f = fixture(); const reviewed = await f.service.exportCase(context());
  const accessor = { ...approval(reviewed) };
  Object.defineProperty(accessor, "sha256", { get() { throw Error("Do not evaluate caller accessors"); }, enumerable: true });
  const inherited = Object.create(approval(reviewed));
  const symbol = { ...approval(reviewed), [Symbol("extra")]: true };
  for (const input of [{}, { sha256: reviewed.artifact.sha256 },
    { ...approval(reviewed), sha256: "0".repeat(64) }, { ...approval(reviewed), scopeHash: "0".repeat(64) },
    { ...approval(reviewed), extra: true }, accessor, inherited, symbol])
    await assert.rejects(f.service.publishCase(context(), input), code("PUBLICATION_NOT_APPROVED"));
  assert.deepEqual(f.requests, []); assert.equal(Object.hasOwn(f.durable.get(key(context())), "intent"), false);
  assert.equal((await f.service.verifyCase(context())).publication.status, "verified");
  assert.deepEqual(f.requests.map((x) => x.method), ["GET"]);
  const stillPublishable = await f.service.exportCase(context());
  assert.equal(stillPublishable.publication.uploadAttempted, false);
  assert.equal(stillPublishable.publication.canPublish, true, "GET verification does not consume the upload capability");
  const other = fixture({ source: { ...sourceScope(), eventId: "synthetic-event-b" } });
  const otherCtx = context({ eventId: "synthetic-event-b" });
  const b = await other.service.exportCase(otherCtx);
  assert.equal(b.artifact.sha256, reviewed.artifact.sha256);
  await assert.rejects(other.service.publishCase(otherCtx, approval(reviewed)), code("PUBLICATION_NOT_APPROVED"));
  assert.deepEqual(other.requests, []);
});

test("unconfirmed availability before any upload remains publishable, then an intent permits only GET recovery", async () => {
  let gatewayReady = false;
  const f = fixture({ fetcher: async (_url, init, state) => {
    if (init.method === "GET") return gatewayReady ? new Response(state.content) : new Response(null, { status: 404 });
    return new Response(JSON.stringify({ cids: [state.uri], inconsistentCids: [] }));
  } });
  const reviewed = await f.service.exportCase(context());
  const missing = await f.service.verifyCase(context());
  assert.equal(missing.publication.status, "availability-unconfirmed");
  assert.equal(missing.publication.uploadAttempted, false); assert.equal(missing.publication.canPublish, true);
  const sent = await f.service.publishCase(context(), approval(reviewed));
  assert.equal(sent.publication.status, "published-unverified");
  assert.equal(sent.publication.uploadAttempted, true); assert.equal(sent.publication.canPublish, false);
  gatewayReady = true;
  const repeat = await f.service.publishCase(context(), approval(reviewed));
  assert.equal(repeat.publication.status, "verified");
  assert.equal(repeat.publication.uploadAttempted, true); assert.equal(repeat.publication.canPublish, false);
  assert.deepEqual(f.requests.map((x) => x.method), ["GET", "POST", "GET"]);
});

test("wallet, event, child, profile, chain and content substitutions cannot reuse an exported artifact", async () => {
  for (const patch of [{ wallet: otherWallet }, { eventId: "synthetic-event-b" },
    { contract: otherWallet }, { chainId: 10200 }, { contractVersion: "kleros-event-v8" }]) {
    const f = fixture(); const reviewed = await f.service.exportCase(context());
    Object.assign(f.source, patch);
    await assert.rejects(f.service.publishCase(context(), approval(reviewed)));
    assert.deepEqual(f.requests, []); assert.equal(Object.hasOwn(f.durable.get(key(context())), "intent"), false);
  }
  const f = fixture(); const reviewed = await f.service.exportCase(context());
  f.content = "{}\n"; f.uri = uriNewline;
  await assert.rejects(f.service.publishCase(context(), approval(reviewed)), code("CASE_PUBLICATION_CHANGED"));
  await assert.rejects(f.service.verifyCase(context()), code("CASE_PUBLICATION_CHANGED"));
  assert.deepEqual(f.requests, []);
  await assert.rejects(f.service.exportCase(context({ wallet: otherWallet })), code("FORBIDDEN"));
});

test("revoked auth or changed content after remote await stops disclosure and leaves the intent consumed", async () => {
  for (const mode of ["auth", "content"]) {
    const f = fixture({ fetcher: async (_url, _init, state) => {
      if (mode === "auth") state.authorized = false;
      else { state.content = "{}\n"; state.uri = uriNewline; }
      return new Response(JSON.stringify({ cids: [uri], inconsistentCids: [] }));
    } });
    const reviewed = await f.service.exportCase(context());
    await assert.rejects(f.service.publishCase(context(), approval(reviewed)),
      code(mode === "auth" ? "UNAUTHENTICATED" : "CASE_PUBLICATION_CHANGED"));
    assert.deepEqual(f.requests.map((x) => x.method), ["POST"]);
    assert.equal(f.durable.get(key(context())).status, "upload-uncertain");
    assert.ok(f.durable.get(key(context())).intent);
    f.authorized = true; f.content = "{}"; f.uri = uri;
    f.callbacks.fetcher = async () => { throw Error("Not used: factory captures its own transport"); };
    const restart = fixture({ durable: f.durable });
    assert.equal((await restart.service.verifyCase(context())).publication.status, "verified");
    assert.deepEqual(restart.requests.map((x) => x.method), ["GET"]);
  }
});

test("a fourth-read authorization or canonical failure before the claim retains its original code without intent or POST", async () => {
  for (const [failure, status] of [["FORBIDDEN", 403], ["UNAUTHENTICATED", 401], ["CASE_PUBLICATION_CHANGED", 409]]) {
    const f = fixture(); const reviewed = await f.service.exportCase(context());
    assert.equal(f.reads, 2);
    f.onRead = () => { if (f.reads === 4) throw err(failure, status); };
    await assert.rejects(f.service.publishCase(context(), approval(reviewed)),
      (error) => error.code === failure && error.status === status);
    assert.equal(f.reads, 4, "Failure occurs in persistIntent's fresh canonical authorization read");
    assert.deepEqual(f.requests, []);
    assert.equal(Object.hasOwn(f.records.get(key(context())), "intent"), false);
    assert.equal(Object.hasOwn(f.durable.get(key(context())), "intent"), false);
    assert.equal(f.durable.get(key(context())).status, "exported");
  }
});

test("a transient canonical-read failure during HTTP cannot be swallowed as an ordinary transport result", async () => {
  const f = fixture({ fetcher: async (_url, _init, state) => {
    let once = true;
    state.onRead = () => {
      if (once) { once = false; state.onRead = null; throw err("CASE_REORG"); }
    };
    return new Response(JSON.stringify({ cids: [uri], inconsistentCids: [] }));
  } });
  const reviewed = await f.service.exportCase(context());
  await assert.rejects(f.service.publishCase(context(), approval(reviewed)), code("CASE_REORG"));
  assert.equal(f.durable.get(key(context())).status, "upload-uncertain");
  assert.deepEqual(f.requests.map((x) => x.method), ["POST"]);
});

test("the original block must remain canonical across later heads and restarts", async () => {
  const f = fixture(); const reviewed = await f.service.exportCase(context());
  f.source.blockNumber = 150; f.source.blockHash = `0x${"d".repeat(64)}`;
  f.orphans.add(reviewed.artifact.scope.blockHash);
  await assert.rejects(f.service.exportCase(context()), code("CASE_REORG"));
  await assert.rejects(f.service.publishCase(context(), approval(reviewed)), code("CASE_REORG"));
  await assert.rejects(f.service.verifyCase(context()), code("CASE_REORG"));
  assert.deepEqual(f.requests, []);
});

test("an expired upload deadline during canonical authorization cannot later reach a transport that ignores abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(), entered = deferred(), release = deferred();
  const reviewed = await f.service.exportCase(context());
  let held = false;
  f.onRead = async () => {
    if (!held && f.records.get(key(context()))?.intent) {
      held = true; entered.resolve(); await release.promise;
    }
  };
  const work = f.service.publishCase(context(), approval(reviewed));
  await entered.promise;
  t.mock.timers.tick(C.requestTimeoutMs);
  const outcome = await work;
  assert.equal(outcome.publication.status, "upload-uncertain");
  assert.equal(outcome.publication.reason, "UPLOAD_TIMEOUT");
  release.resolve();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.requests, [], "Even a transport ignoring AbortSignal never receives a late POST");
  assert.ok(f.durable.get(key(context())).intent);
});

test("claim save failure is not retried or rolled back, even when commit outcome is uncertain", async () => {
  const f = fixture(); const reviewed = await f.service.exportCase(context());
  f.beforePersist = () => { throw Error("Lost storage result, never expose this internal diagnostic"); };
  await assert.rejects(f.service.publishCase(context(), approval(reviewed)), code("PUBLICATION_INTENT_FAILED"));
  assert.deepEqual(f.requests, []);
  const marker = clone(f.records.get(key(context())).intent);
  assert.ok(marker); assert.equal(f.durable.get(key(context())).intent, undefined);
  f.beforePersist = null;
  const recovery = await f.service.publishCase(context(), approval(reviewed));
  assert.equal(recovery.publication.status, "verified");
  assert.deepEqual(f.requests.map((x) => x.method), ["GET"]);
  assert.deepEqual(f.durable.get(key(context())).intent, marker);
});

test("a status save failure after POST retains the durable original intent for fresh-instance GET-only recovery", async () => {
  const f = fixture(); const reviewed = await f.service.exportCase(context());
  f.beforePersist = (state) => { if (state.saves === 3) throw err("STATE_SCOPE"); };
  await assert.rejects(f.service.publishCase(context(), approval(reviewed)), code("PUBLICATION_STORAGE_UNAVAILABLE"));
  assert.deepEqual(f.requests.map((x) => x.method), ["POST"]);
  const marker = clone(f.durable.get(key(context())).intent);
  assert.equal(f.durable.get(key(context())).status, "upload-uncertain");
  const restart = fixture({ durable: f.durable });
  const done = await restart.service.publishCase(context(), approval(reviewed));
  assert.equal(done.publication.status, "verified"); assert.deepEqual(restart.requests.map((x) => x.method), ["GET"]);
  assert.deepEqual(restart.durable.get(key(context())).intent, marker);
});

test("independent stale services rely on the atomic durable guard and cannot both POST", async () => {
  const durable = new Map(); const a = fixture({ durable });
  const reviewed = await a.service.exportCase(context());
  const b = fixture({ durable });
  const results = await Promise.allSettled([
    a.service.publishCase(context(), approval(reviewed)), b.service.publishCase(context(), approval(reviewed)),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.filter((x) => x.status === "rejected").length, 1);
  assert.equal([...a.requests, ...b.requests].filter((x) => x.method === "POST").length, 1);
  assert.ok(durable.get(key(context())).intent);
});

test("an unknown intent marker is consumed, and tampered stored artifacts fail without HTTP", async () => {
  const f = fixture(); const reviewed = await f.service.exportCase(context());
  f.records.get(key(context())).intent = null;
  f.durable.set(key(context()), clone(f.records.get(key(context()))));
  const checked = await f.service.publishCase(context(), approval(reviewed));
  assert.equal(checked.publication.status, "verified");
  assert.equal(checked.publication.uploadAttempted, true); assert.equal(checked.publication.canPublish, false);
  assert.deepEqual(f.requests.map((x) => x.method), ["GET"]);
  assert.equal(f.durable.get(key(context())).intent, null);
  f.records.get(key(context())).artifact.scope.blockNumber++;
  await assert.rejects(f.service.exportCase(context()));
  assert.deepEqual(f.requests.map((x) => x.method), ["GET"]);
});
