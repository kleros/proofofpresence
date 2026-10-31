import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { createFirstEventPostgres } from "../src/first-event-postgres.mjs";
import { createKickbackDisplay } from "../src/kickback-display.mjs";
import { createEventReadJobService } from "../src/event-read-jobs.mjs";

const metadata = () => ({ mode: "hosted-production", chain: { chainId: 1, name: "Synthetic Ethereum" },
  contractVersion: "kleros-event-v10-uups", session: null, events: [],
  factory: { address: "0x1111111111111111111111111111111111111111", verified: false },
  organizerSetup: { minimumClaimDays: 7 }, recoveryEvents: [] });
const origin = "https://synthetic.invalid";

test("actual PostgreSQL JSONB setup reads survive key reordering and restart, without a chain or wallet", async t => {
  const db = new PGlite(); t.after(() => db.close());
  const store = createFirstEventPostgres({ pool: { query: (sql, values) => db.query(sql, values), connect() { throw Error("no lease needed"); } } });
  await store.initialize();
  const w = { setupMetadata: metadata, provider: new Proxy({}, { get() { throw Error("chain access forbidden"); } }) };
  const display = createKickbackDisplay(w, { store, origin }); await display.initialize();
  const read = await display.read(); assert.deepEqual(read, metadata());
  assert.equal(read.factory.verified, false); assert.equal(read.session, null);
  read.factory.verified = true;
  assert.equal((await createKickbackDisplay(w, { store, origin }).read()).factory.verified, false);
  const row = (await db.query("SELECT snapshot FROM kleros_first_event_read_models")).rows[0];
  assert.deepEqual(row.snapshot, metadata());
});

test("setup cache rejects another origin/configuration, missing rows and corrupted configuration", async t => {
  const db = new PGlite(); t.after(() => db.close());
  const store = createFirstEventPostgres({ pool: { query: (sql, values) => db.query(sql, values), connect() {} } });
  await store.initialize();
  const w = { setupMetadata: metadata }, display = createKickbackDisplay(w, { store, origin });
  const denied = error => error.code === "KICKBACK_DISPLAY_UNAVAILABLE";
  await assert.rejects(display.read(), denied); await display.initialize();
  await assert.rejects(createKickbackDisplay(w, { store, origin: "https://another.invalid" }).read(), denied);
  await assert.rejects(createKickbackDisplay({ setupMetadata: () => ({ ...metadata(), organizerSetup: { minimumClaimDays: 8 } }) }, { store, origin }).read(), denied);
  await db.query("UPDATE kleros_first_event_read_models SET snapshot = jsonb_set(snapshot, '{factory,verified}', 'true')");
  await assert.rejects(display.read(), denied);
});

test("factory-only background review is explicit, scoped, one-shot and cannot select an event", async () => {
  const actor = { id: "synthetic-wallet", mode: "wallet", wallet: "0x2222222222222222222222222222222222222222" };
  const calls = [];
  const service = createEventReadJobService({ instanceId: "synthetic-instance", isSessionCurrent: s => s === actor,
    execute: async (op, input) => { calls.push({ op, factoryOnly: input.factoryOnly, selectedEventId: input.selectedEventId }); return { fresh: true }; }, deliver: (_, result) => result });
  const request = { operation: "bootstrap", requestId: "setup-review", selectedEventId: null, factoryOnly: true };
  assert.equal(service.start(actor, request).state, "pending");
  for (let i = 0; i < 24; i++) await Promise.resolve();
  assert.deepEqual(calls, [{ op: "bootstrap", factoryOnly: true, selectedEventId: null }]);
  assert.equal((await service.status(actor, request.requestId)).state, "ready");
  assert.equal((await service.status(actor, request.requestId)).state, "expired");
  for (const patch of [{ selectedEventId: "event-one" }, { factoryOnly: false }])
    assert.throws(() => service.start(actor, { ...request, ...patch, requestId: "invalid-review" }), e => e.code === "INVALID_INPUT");
});
