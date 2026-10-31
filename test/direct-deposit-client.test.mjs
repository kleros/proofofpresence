import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT } from "../public/first-event/event.js";
import { assertDirectDepositDraft } from "../public/first-event/direct-deposit.js";
const origin = "https://synthetic-direct.invalid";
const scope = { wallet: "0x1111111111111111111111111111111111111111", instanceId: "synthetic-instance" };
function fixture(credit = "0") {
  const amount = (BigInt(EVENT.depositWei) - BigInt(credit)).toString();
  return { id: "synthetic-direct-draft", eventId: EVENT.id, chainId: 1, mode: EVENT.mode,
    abiVersion: EVENT.abiVersion, contractVersion: EVENT.abiVersion, origin,
    instanceId: scope.instanceId, wallet: scope.wallet, contract: EVENT.contract,
    action: "deposit", method: "deposit", args: [], valueWei: amount, snapshot: "synthetic-fresh-fingerprint",
    reviewBlock: 100, expiresAt: Date.now() + 60000,
    transaction: { from: scope.wallet, to: EVENT.contract, chainId: 1, data: "0xd0e30db0", value: amount },
    directDepositContext: { kind: "direct-deposit-v1", eventId: EVENT.id, chainId: 1,
      contract: EVENT.contract, wallet: scope.wallet, origin, instanceId: scope.instanceId,
      depositWei: EVENT.depositWei, amountWei: amount, pendingCreditWei: credit,
      blockNumber: 100, blockHash: "0x" + "ab".repeat(32), snapshot: "synthetic-fresh-fingerprint" } };
}
test("direct wallet intent keeps exact target/value and partial-credit top-ups without a full-audit claim", () => {
  for (const credit of ["0", "4000000000000000"]) {
    const d = fixture(credit); assert.equal(assertDirectDepositDraft(d, scope, origin), d);
    assert.equal(BigInt(d.valueWei) + BigInt(credit), BigInt(EVENT.depositWei));
    assert.equal(Object.hasOwn(d, "deploymentTrust"), false);
  }
});
test("changed wallet, recipient, value, source scope, snapshot and stale direct intents fail before a wallet request", () => {
  for (const mutate of [
    d => { d.transaction.to = scope.wallet; }, d => { d.transaction.from = EVENT.contract; },
    d => { d.transaction.value = "1"; }, d => { d.valueWei = "1"; },
    d => { d.directDepositContext.pendingCreditWei = "1"; }, d => { d.directDepositContext.depositWei = "1"; },
    d => { d.directDepositContext.amountWei = "0"; }, d => { d.directDepositContext.kind = "deposit-review-v1"; },
    d => { d.transaction.data = "0x"; }, d => { d.transaction.chainId = 10200; },
    d => { d.origin = "https://another.invalid"; }, d => { d.instanceId = "another-instance"; },
    d => { d.snapshot = "changed"; }, d => { d.reviewBlock++; },
    d => { d.directDepositContext.blockHash = "0x"; }, d => { d.expiresAt = 0; },
  ]) { const d = fixture(); mutate(d); assert.throws(() => assertDirectDepositDraft(d, scope, origin)); }
});
