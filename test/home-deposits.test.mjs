import test from "node:test";
import assert from "node:assert/strict";
import { homeDepositSnapshot } from "../public/home-wallet.js";
import { EVENT } from "../public/first-event/event.js";
const wallet = "0x" + "1".repeat(40), hash = "0x" + "2".repeat(64), blockHash = "0x" + "3".repeat(64);
const fixture = () => ({ schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, mode: EVENT.mode, instanceId: "synthetic-home-deposits",
  eventId: EVENT.id, chainId: 1, contract: EVENT.contract, status: "current", checkedAt: "2000-01-01T00:00:00.000Z", blockNumber: 100, blockHash,
  depositors: [{ wallet, totalReceivedWei: EVENT.depositWei, deposits: [{ txHash: hash, logIndex: 0, amountWei: EVENT.depositWei, blockNumber: 99, blockHash }] }] });
test("home uses exact public receipt scope and copies a bounded presentation model", () => {
  const source = fixture(), result = homeDepositSnapshot(source, source.instanceId);
  assert.deepEqual(result.rows, [{ wallet, totalReceivedWei: EVENT.depositWei, deposits: [{ hash, amountWei: EVENT.depositWei }] }]);
  assert(Object.isFrozen(result.rows[0].deposits[0]));
  source.depositors[0].deposits[0].txHash = blockHash;
  assert.equal(result.rows[0].deposits[0].hash, hash);
  assert(!Object.hasOwn(result.rows[0], "admission"));
});
test("partial completed payments remain visible without implying full deposit eligibility", () => {
  const source = fixture(); source.depositors[0].totalReceivedWei = source.depositors[0].deposits[0].amountWei = "1";
  assert.equal(homeDepositSnapshot(source).rows[0].totalReceivedWei, "1");
  source.depositors[0].totalReceivedWei = source.depositors[0].deposits[0].amountWei = "0";
  assert.deepEqual(homeDepositSnapshot(source).rows, []);
});
test("empty and stale public receipt snapshots stay presentation only", () => {
  const source = fixture(); source.status = "stale";
  assert.equal(homeDepositSnapshot(source).status, "stale");
  source.depositors = []; assert.deepEqual(homeDepositSnapshot(source).rows, []);
});
test("wrong event, network, contract, mode and instance are rejected", () => {
  for (const change of [source => { source.eventId = "different-event"; }, source => { source.chainId = 10200; }, source => { source.contract = wallet; },
    source => { source.mode = "demo"; }, source => { source.instanceId = "invalid/instance"; }]) {
    const source = fixture(); change(source); assert.throws(() => homeDepositSnapshot(source));
  }
  assert.throws(() => homeDepositSnapshot(fixture(), "different-current-server"));
});
test("incomplete or duplicated receipts and mismatched totals reject the snapshot", () => {
  for (const change of [source => { source.depositors[0].totalReceivedWei = "99"; }, source => { source.depositors.push(structuredClone(source.depositors[0])); },
    source => { source.depositors[0].deposits.push(structuredClone(source.depositors[0].deposits[0])); }, source => { source.depositors[0].deposits[0].blockNumber = 101; },
    source => { source.depositors[0].deposits[0].txHash = "0x1234"; }, source => { source.blockNumber = 0; }, source => { source.checkedAt = "not a date"; }]) {
    const source = fixture(); change(source); assert.throws(() => homeDepositSnapshot(source));
  }
});
test("session, financial authority and future snapshot timestamps are rejected", () => {
  for (const key of ["session", "permissions", "capabilities", "deploymentTrust", "actionable"]) {
    const source = fixture(); source[key] = {}; assert.throws(() => homeDepositSnapshot(source));
  }
  const source = fixture(); source.checkedAt = new Date(Date.now() + 60000).toISOString(); assert.throws(() => homeDepositSnapshot(source));
});
