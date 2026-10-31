// Actual embedded PostgreSQL DDL/JSONB/transactions/persistence. Only session advisory locks are simulated.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { createFirstEventPostgres, FIRST_EVENT_POSTGRES_POOL_MAX } from "../src/first-event-postgres.mjs";

const A = "ab".repeat(32), B = "cd".repeat(32);
const binding = { environment: "synthetic-test", event: "first-event", source: "reviewed-source" };
const snapshot = { schemaVersion: 1, kind: "first-event-depositors", displayOnly: true,
  checkedAt: "2026-10-30T00:00:00.000Z", depositors: [{ wallet: "0x1111111111111111111111111111111111111111", totalReceivedWei: "7" }] };
const invalid = error => error.code === "FIRST_EVENT_STORE_INVALID";
const unavailable = error => error.code === "FIRST_EVENT_STORE_UNAVAILABLE";
const sourcePins = async () => Object.fromEntries(await Promise.all(["src/first-event-postgres.mjs", "test/first-event-postgres.test.mjs"].map(async file =>
  [file, createHash("sha256").update(await fs.readFile(new URL("../" + file, import.meta.url))).digest("hex")])));

test("actual pg.Pool reproduces two-lease reader timeout at max2 and preserves a reader seat at configured max3", { timeout: 5000 }, async t => {
  const pins = await sourcePins(), scenarios = [], connectionTimeoutMillis = 50;
  assert.equal(FIRST_EVENT_POSTGRES_POOL_MAX, 3);
  for (const max of [2, FIRST_EVENT_POSTGRES_POOL_MAX]) {
    const locks = new Map(), readClients = [];
    let connections = 0, heldLeases = 0, queuedReadersObserved = 0, readerTimedOut = false, readerCompletedWhileBothHeld = false;
    // Only transport and SQL results are synthetic. Connection admission, queueing,
    // timeout, release and reuse below are the installed pg.Pool implementation.
    class SyntheticClient extends EventEmitter {
      constructor() { super(); this.id = ++connections; this._queryable = true; }
      connect(callback) { queueMicrotask(() => callback(null)); }
      query(sql, values = [], callback) {
        if (typeof values === "function") { callback = values; values = []; }
        const result = Promise.resolve().then(() => {
          if (sql.includes("pg_try_advisory_lock")) {
            const owner = locks.get(values[0]), locked = owner === undefined || owner === this.id;
            if (locked) locks.set(values[0], this.id);
            return { rows: [{ locked }] };
          }
          if (sql.includes("pg_advisory_unlock")) {
            const unlocked = locks.get(values[0]) === this.id;
            if (unlocked) locks.delete(values[0]);
            return { rows: [{ unlocked }] };
          }
          if (sql.startsWith("SELECT binding, snapshot FROM kleros_first_event_read_models")) {
            assert.equal(values[0], A); readClients.push(this.id);
            return { rows: [structuredClone({ binding, snapshot })] };
          }
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
          assert.fail("Unexpected SQL in synthetic connection-capacity fixture");
        });
        if (callback) { void result.then(value => callback(null, value), error => callback(error)); return; }
        return result;
      }
      end(callback) { this._ending = true; queueMicrotask(() => { this.emit("end"); callback?.(); }); }
    }
    const pool = new Pool({ Client: SyntheticClient, max, connectionTimeoutMillis, idleTimeoutMillis: 0 });
    const store = createFirstEventPostgres({ pool });
    const latch = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
    const gates = [latch(), latch()], entered = [latch(), latch()];
    const leases = [A, B].map((key, index) => store.withLease(key, async () => {
      heldLeases++; entered[index].release();
      try { await gates[index].promise; } finally { heldLeases--; }
    }));
    let read;
    try {
      await Promise.all(entered.map(value => value.promise));
      assert.equal(heldLeases, 2); assert.equal(pool.totalCount, 2); assert.equal(pool.idleCount, 0);
      read = store.read(A); void read.catch(() => {});
      await new Promise(resolve => setImmediate(resolve));
      queuedReadersObserved = pool.waitingCount;
      if (max === 2) {
        assert.equal(queuedReadersObserved, 1);
        // pg-pool unrefs checkout timeouts; keep this transport-free assertion alive.
        const keepAlive = setTimeout(() => {}, connectionTimeoutMillis * 4);
        try { await assert.rejects(read, unavailable); } finally { clearTimeout(keepAlive); }
        readerTimedOut = true;
        assert.equal(readClients.length, 0); assert.equal(pool.totalCount, 2);
      } else {
        assert.deepEqual(await read, { binding, snapshot });
        readerCompletedWhileBothHeld = heldLeases === 2;
        assert(readerCompletedWhileBothHeld); assert.equal(pool.totalCount, 3); assert.equal(pool.waitingCount, 0);
        assert.equal(readClients.length, 1); assert(![...locks.values()].includes(readClients[0]), "The read uses a third client, not either leased session");
      }
      assert.equal(heldLeases, 2); assert.equal(locks.size, 2, "Reading or timing out does not release either worker lease");
      scenarios.push({ max, connections, queuedReadersObserved, readerTimedOut, readerCompletedWhileBothHeld,
        heldLeasesAtObservation: heldLeases, readerSqlExecutions: readClients.length });
    } finally {
      gates.forEach(gate => gate.release());
      await Promise.allSettled([...leases, ...(read ? [read] : [])]);
      await store.close(); await pool.end();
    }
    assert.equal(locks.size, 0);
  }
  assert.deepEqual(await sourcePins(), pins);
  t.diagnostic(JSON.stringify({ kind: "actual-pg-pool-reader-capacity", configuredMax: FIRST_EVENT_POSTGRES_POOL_MAX,
    syntheticConnectionTimeoutMillis: connectionTimeoutMillis, scenarios, sourcePins: pins,
    limits: ["Actual installed pg.Pool scheduling with synthetic Client/SQL responses; no PostgreSQL network connection.",
      "Existing PGlite tests separately verify real PostgreSQL SQL/JSONB/transactions; no production latency claim."] }));
});
function adapter(db) {
  const locks = new Map(), calls = [], releases = [];
  let sequence = 0, ends = 0, failUnlock = false;
  async function run(clientId, sql, values = []) {
    calls.push({ clientId, sql, values });
    if (sql.includes("pg_try_advisory_lock")) {
      const owner = locks.get(values[0]), locked = owner === undefined || owner === clientId;
      if (locked) locks.set(values[0], clientId);
      return { rows: [{ locked }] };
    }
    if (sql.includes("pg_advisory_unlock")) {
      if (failUnlock) throw Error("Synthetic private connection failure must not escape");
      const unlocked = locks.get(values[0]) === clientId;
      if (unlocked) locks.delete(values[0]);
      return { rows: [{ unlocked }] };
    }
    return db.query(sql, values);
  }
  const pool = {
    query: (sql, values) => run("pool", sql, values),
    connect: async () => {
      const clientId = ++sequence;
      return { query: (sql, values) => run(clientId, sql, values), release: error => {
        releases.push({ clientId, destroyed: !!error });
        if (error) for (const [key, owner] of locks) if (owner === clientId) locks.delete(key);
      } };
    },
    end: async () => { ends++; },
  };
  return { pool, calls, releases, locks, get ends() { return ends; }, failUnlock: value => { failUnlock = value; } };
}
async function fixture() {
  const db = new PGlite(), a = adapter(db), store = createFirstEventPostgres({ pool: a.pool });
  return { db, ...a, adapter: a, store, close: async () => { await store.close(); await db.close(); } };
}

test("initialization is explicit and idempotent; actual JSONB reads and atomic UPSERTs remain detached and parameterized", async t => {
  const f = await fixture(); t.after(() => f.close());
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.store.read(A), unavailable);
  await f.store.initialize(); await f.store.initialize();
  assert.equal(await f.store.read(A), null);
  const first = structuredClone(snapshot); first.note = "'); DROP TABLE kleros_first_event_read_models; --";
  const pending = f.store.write(A.toUpperCase(), binding, first); first.note = "changed after write call"; await pending;
  const loaded = await f.store.read(A);
  assert.deepEqual(loaded.binding, binding); assert.notEqual(loaded.snapshot.note, first.note);
  loaded.binding.source = "changed by caller"; loaded.snapshot.depositors.length = 0;
  assert.equal((await f.store.read(A)).snapshot.depositors.length, 1);
  await f.store.write(A, "binding may be a plain JSON string", { ...snapshot, revision: 2 });
  assert.equal((await f.store.read(A)).snapshot.revision, 2);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM kleros_first_event_read_models")).rows[0].count, 1);
  const upsert = f.calls.find(call => call.sql.startsWith("INSERT"));
  assert.equal(upsert.values[0], A); assert.equal(upsert.values.length, 3);
  assert(!upsert.sql.includes("DROP TABLE"));
});

test("lease callback reads and commits through one client and never exposes another scope", async t => {
  const f = await fixture(); t.after(() => f.close()); await f.store.initialize();
  let captured;
  const result = await f.store.withLease(A, async scoped => {
    captured = scoped;
    assert.equal(await scoped.read(A), null);
    await assert.rejects(scoped.read(B), invalid);
    await scoped.write(A, binding, snapshot);
    assert.deepEqual((await scoped.read(A)).snapshot, snapshot);
    return "complete";
  });
  assert.equal(result, "complete"); assert.deepEqual((await f.store.read(A)).snapshot, snapshot);
  const acquired = f.calls.find(call => call.sql.includes("pg_try_advisory_lock"));
  const throughCommit = f.calls.slice(f.calls.indexOf(acquired), f.calls.findIndex(call => call.sql === "COMMIT") + 1);
  assert(throughCommit.every(call => call.clientId === acquired.clientId));
  assert.equal(f.locks.size, 0); assert.deepEqual(f.releases, [{ clientId: acquired.clientId, destroyed: false }]);
  await assert.rejects(captured.read(A), unavailable);
});

test("callback failure rolls back actual SQL and always unlocks/releases without replacing the original exception", async t => {
  const f = await fixture(); t.after(() => f.close()); await f.store.initialize(); await f.store.write(A, binding, snapshot);
  const original = new Error("Synthetic callback rejected before commit");
  await assert.rejects(f.store.withLease(A, async scoped => {
    await scoped.write(A, { other: true }, { ...snapshot, revision: "must roll back" });
    throw original;
  }), error => error === original);
  assert.deepEqual(await f.store.read(A), { binding, snapshot });
  assert(f.calls.some(call => call.sql === "ROLLBACK")); assert.equal(f.locks.size, 0);
  assert.equal(f.releases.length, 1); assert.equal(f.releases[0].destroyed, false);
  assert.equal(await f.store.withLease(A, async () => "next owner"), "next owner");
});

test("a competing lease returns null and does not run the callback or open a transaction", async t => {
  const f = await fixture(); t.after(() => f.close()); await f.store.initialize();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const first = f.store.withLease(A, async scoped => { await scoped.write(A, binding, snapshot); entered(); await gate; return "first"; });
  await ready; let called = false;
  assert.equal(await f.store.withLease(A, async () => { called = true; }), null);
  assert.equal(called, false); assert.equal(f.calls.filter(call => call.sql === "BEGIN").length, 1);
  release(); assert.equal(await first, "first"); assert.equal(f.locks.size, 0); assert.equal(f.releases.length, 2);
});

test("unlock failure destroys the client and returns only a generic storage error", async t => {
  const f = await fixture(); t.after(() => f.close()); await f.store.initialize(); f.failUnlock(true);
  await assert.rejects(f.store.withLease(A, async scoped => { await scoped.write(A, binding, snapshot); }), error =>
    unavailable(error) && !/private connection|postgres:|password/i.test(error.message));
  assert.equal(f.releases.length, 1); assert.equal(f.releases[0].destroyed, true);
  assert.equal(f.locks.size, 0); assert.deepEqual((await f.store.read(A)).snapshot, snapshot);
});

test("invalid keys, non-plain JSON, getters and oversized UTF8 snapshots are rejected before SQL", async t => {
  const f = await fixture(); t.after(() => f.close()); await f.store.initialize(); const before = f.calls.length;
  let getterCalls = 0; const accessor = {};
  Object.defineProperty(accessor, "secret", { enumerable: true, get() { getterCalls++; return "must not run"; } });
  const cyclic = {}; cyclic.self = cyclic;
  for (const key of ["", "a".repeat(63), "a".repeat(65), "x".repeat(64), "';DROP TABLE x;--"])
    await assert.rejects(f.store.write(key, binding, snapshot), invalid);
  for (const value of [accessor, cyclic, new Date(), { bad: undefined }, { bad: 1n }, { bad: NaN }, { bad: Infinity }, new Array(2),
    { toJSON() { getterCalls++; return "must not run"; } }, { payload: "😀".repeat(262145) }])
    await assert.rejects(f.store.write(A, binding, value), invalid);
  assert.equal(getterCalls, 0); assert.equal(f.calls.length, before);
});

test("SQL and connection errors are sanitized, and injected pools are never closed", async () => {
  let ends = 0;
  const secret = "postgres://private-user:private-password@private-host";
  const pool = { query: async () => { throw Error(secret); }, connect: async () => { throw Error(secret); }, end: async () => { ends++; } };
  const store = createFirstEventPostgres({ pool });
  for (const operation of [() => store.initialize(), () => store.read(A), () => store.write(A, binding, snapshot), () => store.withLease(A, async () => {})])
    await assert.rejects(operation(), error => unavailable(error) && !error.message.includes(secret) && !Object.hasOwn(error, "cause"));
  await store.close(); await store.close(); assert.equal(ends, 0);
  await assert.rejects(store.read(A), unavailable);
});

test("an uncertain advisory-lock query failure destroys its client instead of pooling a possibly held lock", async () => {
  let released = null;
  const store = createFirstEventPostgres({ pool: { query: async () => ({ rows: [] }), connect: async () => ({
    query: async () => { throw Error("Synthetic network timeout after lock may have been accepted"); },
    release: error => { released = error; },
  }) } });
  await assert.rejects(store.withLease(A, async () => assert.fail("Callback must not run")), unavailable);
  assert(released); assert.equal(released.code, "FIRST_EVENT_STORE_UNAVAILABLE");
  assert.doesNotMatch(released.message, /Synthetic network|timeout after lock/);
  await store.close();
});

test("only a private Railway URL can create an owned lazy pool, which closes without connecting", async () => {
  for (const connectionString of [undefined, "", "http://db.railway.internal/db", "postgres://user:synthetic@public.example/db"])
    assert.throws(() => createFirstEventPostgres({ connectionString }), invalid);
  const store = createFirstEventPostgres({ connectionString: "postgresql://synthetic:unused@postgres.railway.internal:5432/test" });
  await store.close(); await store.close();
});

test("actual on-disk PostgreSQL JSONB survives process-store restart without reinitializing or changing scope", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kleros-first-event-postgres-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const firstDb = new PGlite(directory), firstAdapter = adapter(firstDb), first = createFirstEventPostgres({ pool: firstAdapter.pool });
  await first.initialize(); await first.write(A, binding, snapshot); await first.close(); assert.equal(firstAdapter.ends, 0); await firstDb.close();
  const secondDb = new PGlite(directory), second = createFirstEventPostgres({ pool: adapter(secondDb).pool });
  try { assert.deepEqual(await second.read(A), { binding, snapshot }); assert.equal(await second.read(B), null); }
  finally { await second.close(); await secondDb.close(); }
});
