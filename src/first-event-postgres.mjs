// Dedicated public receipt read-model storage. No HTTP, chain, wallet or action authority.
import { Pool } from "pg";

// Two current/legacy indexer leases may be held while a public reader connects.
export const FIRST_EVENT_POSTGRES_POOL_MAX = 3;

export const FIRST_EVENT_POSTGRES_SCHEMA = `CREATE TABLE IF NOT EXISTS kleros_first_event_read_models (
  scope_key TEXT PRIMARY KEY CHECK (scope_key ~ '^[0-9a-f]{64}$'),
  binding JSONB NOT NULL,
  snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

const MAX_JSON_BYTES = 1024 * 1024;
const invalid = () => Object.assign(new Error("Invalid first-event snapshot storage input."), { code: "FIRST_EVENT_STORE_INVALID" });
const unavailable = () => Object.assign(new Error("First-event snapshot storage is unavailable."), { code: "FIRST_EVENT_STORE_UNAVAILABLE" });
function keyOf(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw invalid();
  return value.toLowerCase();
}
function jsonText(value) {
  const seen = new Set(); let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 100000 || depth > 32) throw invalid();
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || seen.has(item)) throw invalid();
    const array = Array.isArray(item);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw invalid();
    seen.add(item);
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) throw invalid();
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value") ||
        (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length))) throw invalid();
      visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) throw invalid();
  return text;
}
const detached = value => JSON.parse(jsonText(value));
const READ_SQL = "SELECT binding, snapshot FROM kleros_first_event_read_models WHERE scope_key = $1";
const WRITE_SQL = `INSERT INTO kleros_first_event_read_models (scope_key, binding, snapshot, updated_at)
VALUES ($1, $2::jsonb, $3::jsonb, NOW())
ON CONFLICT (scope_key) DO UPDATE SET binding = EXCLUDED.binding, snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`;
const LOCK_SQL = "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked";
const UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked";

/** Factory is lazy: initialization and all database I/O are explicit. */
export function createFirstEventPostgres({ connectionString, pool: injectedPool } = {}) {
  let pool = injectedPool, owned = false, closed = false;
  if (!pool) {
    let url;
    if (typeof connectionString !== "string" || connectionString.length === 0 || connectionString.length > 8192) throw invalid();
    try { url = new URL(connectionString); } catch { throw invalid(); }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".railway.internal")) throw invalid();
    pool = new Pool({ connectionString, max: FIRST_EVENT_POSTGRES_POOL_MAX, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
      statement_timeout: 5000, query_timeout: 5000 });
    // An idle client error must not emit credentials or crash the read-only cache service.
    pool.on("error", () => {}); owned = true;
  }
  if (typeof pool.query !== "function" || typeof pool.connect !== "function") throw invalid();
  const assertOpen = () => { if (closed) throw unavailable(); };
  async function query(executor, text, values = []) {
    assertOpen();
    try { return await executor.query(text, values); } catch { throw unavailable(); }
  }
  async function readFrom(executor, scopeKey) {
    const key = keyOf(scopeKey), result = await query(executor, READ_SQL, [key]);
    const row = result.rows?.[0];
    return row ? { binding: detached(row.binding), snapshot: detached(row.snapshot) } : null;
  }
  async function writeTo(executor, scopeKey, binding, snapshot) {
    const key = keyOf(scopeKey), bindingJson = jsonText(binding), snapshotJson = jsonText(snapshot);
    await query(executor, WRITE_SQL, [key, bindingJson, snapshotJson]);
  }
  return Object.freeze({
    async initialize() { await query(pool, FIRST_EVENT_POSTGRES_SCHEMA); },
    read: scopeKey => readFrom(pool, scopeKey),
    write: (scopeKey, binding, snapshot) => writeTo(pool, scopeKey, binding, snapshot),
    async withLease(scopeKey, callback) {
      const key = keyOf(scopeKey); assertOpen();
      if (typeof callback !== "function") throw invalid();
      let client, locked = false, transaction = false, usable = false, primaryError = null, destroy = false;
      try {
        try { client = await pool.connect(); } catch { throw unavailable(); }
        if (typeof client?.query !== "function" || typeof client?.release !== "function") throw unavailable();
        const executor = { query: async (text, values) => {
          try { return await client.query(text, values); }
          catch { destroy = true; throw unavailable(); }
        } };
        const result = await query(executor, LOCK_SQL, [key]);
        if (typeof result.rows?.[0]?.locked !== "boolean") { destroy = true; throw unavailable(); }
        locked = result.rows?.[0]?.locked === true;
        if (!locked) return null;
        await query(executor, "BEGIN"); transaction = true; usable = true;
        const scopedKey = value => {
          if (!usable) throw unavailable();
          if (keyOf(value) !== key) throw invalid();
          return key;
        };
        const scopedStore = Object.freeze({
          read: async value => readFrom(executor, scopedKey(value)),
          write: async (value, binding, snapshot) => writeTo(executor, scopedKey(value), binding, snapshot),
        });
        const value = await callback(scopedStore);
        usable = false;
        await query(executor, "COMMIT"); transaction = false;
        return value;
      } catch (error) {
        primaryError = error; usable = false;
        if (transaction) try { await query(client, "ROLLBACK"); } catch { destroy = true; }
        throw error;
      } finally {
        usable = false; let cleanupError = null;
        if (locked) try {
          const result = await query(client, UNLOCK_SQL, [key]);
          if (result.rows?.[0]?.unlocked !== true) { destroy = true; cleanupError = unavailable(); }
        } catch { destroy = true; cleanupError = unavailable(); }
        if (client?.release) try { client.release(destroy ? unavailable() : undefined); } catch { cleanupError = unavailable(); }
        if (cleanupError && !primaryError) throw cleanupError;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (owned) try { await pool.end(); } catch { throw unavailable(); }
    },
  });
}
