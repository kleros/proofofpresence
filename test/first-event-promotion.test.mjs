// Synthetic records/receipts and actual local SQL only. No deployment, wallet,
// signing file, public RPC or financial transaction is created by these tests.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { PGlite } from "@electric-sql/pglite";
import { createFirstEventPostgres } from "../src/first-event-postgres.mjs";
import { createFirstEventDisplay } from "../src/first-event-display.mjs";
import { FIRST_EVENT_MANAGE_SCOPE, LEGACY_FIRST_EVENT_SCOPES, firstEventManageMatches, firstEventDisplayScopes,
  firstEventDisplayScopeForQuery, isLegacyFirstEvent, assertFirstEventDepositTarget } from "../src/first-event-manage-scope.mjs";
import { productionErrorResponse } from "../src/production-errors.mjs";
const old = LEGACY_FIRST_EVENT_SCOPES[0], promoted = Object.freeze({ eventId: "synthetic-promoted-ist-event", contract: "0x" + "1".repeat(40), chainId: 1, contractVersion: "kleros-event-v10-uups" });
const record = scope => ({ definition: { id: scope.eventId }, deployment: { ...scope } });
const hash = number => "0x" + number.toString(16).padStart(64, "0"), payer = "0x" + "2".repeat(40);
test("local current pin selects the recorded IST replacement and preserves explicit old recovery", () => {
  // Public recorded-adoption facts; independent full-source verification and
  // publication remain separate release gates, not assertions made by this test.
  assert.equal(FIRST_EVENT_MANAGE_SCOPE.eventId, "event-3aac5a07-5074-4241-9246-2798d4111039");
  assert.equal(FIRST_EVENT_MANAGE_SCOPE.contract, "0xc069A460c5B1c577791Ee61E7F9ADcb7866068df");
  assert.equal(firstEventDisplayScopeForQuery("").eventId, FIRST_EVENT_MANAGE_SCOPE.eventId);
  assert.equal(firstEventDisplayScopeForQuery("?eventId=" + old.eventId).contract, old.contract);
  assert.equal(firstEventDisplayScopes().length, 2);
  assert.equal(isLegacyFirstEvent(record(old)), true);
  assert.throws(() => assertFirstEventDepositTarget(record(old)), error => error.code === "EVENT_REPLACED");
  assert.doesNotThrow(() => assertFirstEventDepositTarget(record(FIRST_EVENT_MANAGE_SCOPE)));
});
test("source scopes retain original identity and deduplicate until a verified current promotion", () => {
  assert.equal(old.eventId, "event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5");
  assert.equal(old.contract, "0xCd7418413fBFA814D41799C9dFaCc4654f295c11");
  assert(Object.isFrozen(LEGACY_FIRST_EVENT_SCOPES) && Object.isFrozen(old));
  assert.equal(firstEventDisplayScopes(old, [old]).length, 1);
  assert.deepEqual(firstEventDisplayScopes(promoted, [old]).map(scope => scope.eventId), [promoted.eventId, old.eventId]);
  assert.throws(() => firstEventDisplayScopes(promoted, [{ ...old, eventId: promoted.eventId }]), error => error.code === "FIRST_EVENT_SCOPE");
  assert.throws(() => firstEventDisplayScopes(promoted, [{ ...old, contract: promoted.contract }]), error => error.code === "FIRST_EVENT_SCOPE");
  // Merely preparing scaffolding must not retire the currently reviewed pin.
  assert.equal(isLegacyFirstEvent(record(FIRST_EVENT_MANAGE_SCOPE)), false);
});
test("SQL endpoint accepts only exact current/default or explicitly allowlisted legacy identity", () => {
  const scopes = firstEventDisplayScopes(promoted, [old]);
  assert.equal(firstEventDisplayScopeForQuery("", scopes).eventId, promoted.eventId);
  assert.equal(firstEventDisplayScopeForQuery("?eventId=" + promoted.eventId, scopes).contract, promoted.contract);
  assert.equal(firstEventDisplayScopeForQuery("?eventId=" + old.eventId, scopes).contract, old.contract);
  for (const query of ["?eventId=x&eventId=y", "?eventId=" + old.eventId + "&contract=" + promoted.contract, "?wallet=" + payer])
    assert.throws(() => firstEventDisplayScopeForQuery(query, scopes), error => error.code === "INVALID_INPUT" && error.status === 400);
  assert.throws(() => firstEventDisplayScopeForQuery("?eventId=private-or-unreviewed", scopes), error => error.code === "NOT_FOUND" && error.status === 404);
});
test("old deposits are refused only after promotion; original recovery identity is untouched", () => {
  const legacyRecord = record(old), currentRecord = record(promoted);
  assert.equal(firstEventManageMatches(legacyRecord, promoted), false);
  assert.equal(isLegacyFirstEvent(legacyRecord, promoted, [old]), true);
  assert.throws(() => assertFirstEventDepositTarget(legacyRecord, promoted, [old]), error => error.code === "EVENT_REPLACED" && error.status === 409);
  assert.doesNotThrow(() => assertFirstEventDepositTarget(currentRecord, promoted, [old]));
  assert.doesNotThrow(() => assertFirstEventDepositTarget(legacyRecord, old, [old]));
  const body = productionErrorResponse({ code: "EVENT_REPLACED", message: "private provider text" });
  assert.equal(body.status, 409); assert(!JSON.stringify(body).includes("private provider text"));
  assert.equal(legacyRecord.deployment.contract, old.contract);
});
test("dual receipt workers use separate real SQL keys, preserve old rows across reload and serve zero-RPC reads", async t => {
  const db = new PGlite(), query = (sql, values) => sql.includes("pg_try_advisory_lock") ? Promise.resolve({ rows: [{ locked: true }] }) :
    sql.includes("pg_advisory_unlock") ? Promise.resolve({ rows: [{ unlocked: true }] }) : db.query(sql, values);
  const store = createFirstEventPostgres({ pool: { query, connect: async () => ({ query, release() {} }) } });
  await store.initialize(); t.after(async () => { await store.close(); await db.close(); });
  const iface = new ethers.Interface(["event Deposited(address indexed from,uint256 amount)"]), scopes = [promoted, old], records = new Map(), entries = [], logs = [], receipts = new Map(), calls = [];
  let instanceId = "synthetic-promotion-before-reload";
  for (const [index, scope] of scopes.entries()) {
    const birth = 10 + index * 5, r = record(scope); r.deployment.deploymentBlock = birth; r.deployment.deploymentTxHash = hash(birth); records.set(scope.eventId, r);
    entries.push({ id: scope.eventId, chainId: 1, contract: scope.contract, contractVersion: scope.contractVersion, visibility: "public", editorialStatus: "published",
      adoption: { kind: "recorded-adoption", txHash: hash(birth), blockNumber: birth, blockHash: hash(birth) } });
    const encoded = iface.encodeEventLog(iface.getEvent("Deposited"), [payer, BigInt(7 + index)]), txHash = hash(100 + index);
    const log = { ...encoded, address: scope.contract, index: 0, blockNumber: 20 + index, blockHash: hash(20 + index), transactionHash: txHash, removed: false };
    logs.push(log); receipts.set(txHash, { status: 1, hash: txHash, blockNumber: log.blockNumber, blockHash: log.blockHash, logs: [log] });
  }
  const w = { publicCatalog: () => ({ instanceId, mode: "hosted-production", environment: { production: true, chainId: 1 }, events: entries }),
    record: id => records.get(id), firstEventManageAvailable: id => { calls.push(["source-availability", id]); return id === promoted.eventId; },
    provider: { send: async method => { calls.push([method]); assert.equal(method, "eth_chainId"); return "0x1"; },
      getBlock: async number => { calls.push(["block", number]); return { number: number === "latest" ? 30 : number, hash: hash(number === "latest" ? 30 : number) }; },
      getLogs: async filter => { calls.push(["logs", filter]); return logs.filter(log => log.address.toLowerCase() === filter.address.toLowerCase() && log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock); },
      getTransactionReceipt: async txHash => { calls.push(["receipt", txHash]); return receipts.get(txHash); } } };
  const make = (scope, recoveryOnly) => createFirstEventDisplay(w, { instanceId, origin: "https://promotion.example.invalid", store, eventScope: scope, recoveryOnly, now: () => 100000 });
  const oldWorker = make(old, true), currentWorker = make(promoted, false);
  await oldWorker.refresh(); const oldBefore = await oldWorker.read();
  const firstRow = (await db.query("SELECT scope_key, binding, snapshot FROM kleros_first_event_read_models")).rows[0];
  await currentWorker.refresh(); const current = await currentWorker.read(), oldAfter = await oldWorker.read();
  assert.equal(current.contract.toLowerCase(), promoted.contract.toLowerCase()); assert.equal(current.depositors[0].totalReceivedWei, "7");
  assert.equal(oldAfter.contract.toLowerCase(), old.contract.toLowerCase()); assert.equal(oldAfter.depositors[0].totalReceivedWei, "8");
  assert.deepEqual(oldBefore, oldAfter);
  const rows = (await db.query("SELECT scope_key, binding, snapshot FROM kleros_first_event_read_models")).rows;
  assert.equal(rows.length, 2); assert.deepEqual(rows.find(row => row.scope_key === firstRow.scope_key), firstRow);
  assert.notEqual(rows[0].scope_key, rows[1].scope_key);
  const rpcCalls = () => calls.filter(([method]) => method !== "source-availability").length, before = rpcCalls();
  await currentWorker.read(); await oldWorker.read(); assert.equal(rpcCalls(), before);
  assert(!calls.some(([method, id]) => method === "source-availability" && id === old.eventId));
  await currentWorker.close(); await oldWorker.close(); instanceId = "synthetic-promotion-after-reload";
  const restartedOld = make(old, true), restartedCurrent = make(promoted, false); t.after(() => restartedOld.close()); t.after(() => restartedCurrent.close());
  assert.equal((await restartedOld.read()).instanceId, instanceId); assert.equal((await restartedCurrent.read()).instanceId, instanceId); assert.equal(rpcCalls(), before);
  // No missing adoption is fabricated and no current row falls back to old data.
  entries.splice(entries.findIndex(entry => entry.id === promoted.eventId), 1);
  await assert.rejects(restartedCurrent.read(), error => error.code === "NOT_FOUND");
  assert.equal((await restartedOld.read()).contract.toLowerCase(), old.contract.toLowerCase()); assert.equal(rpcCalls(), before);
});
