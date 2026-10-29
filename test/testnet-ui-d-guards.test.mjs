import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { assertUiDSigningBudget, operationFor } from "./testnet-ui-d.e2e.mjs";

test("D UI checks final fees, nonce and exact payer/call before signing", () => {
  const a = n => ethers.getAddress("0x" + n.toString(16).padStart(40, "0"));
  const scope = { chainId: 10200, eventId: "synthetic-d", contract: a(1), alice: a(2), bob: a(3), owner: a(4), depositWei: "1000000000000", depositOpensAt: 100, eventStart: 200 };
  const op = operationFor("deposits", "bob", scope, {});
  const tx = { chainId: 10200, from: scope.bob, to: scope.contract, value: op.value,
    data: ethers.id("deposit()").slice(0, 10), gasLimit: 100_000n,
    maxFeePerGas: 100n, maxPriorityFeePerGas: 2n, nonce: 0 };
  const plan = { deploymentBudget: { maxFeePerGas: "100" } };
  assertUiDSigningBudget(tx, op, scope, plan, 10_000_000_000_000n, 0);
  for (const patch of [ { maxFeePerGas: 101n }, { maxPriorityFeePerGas: 101n },
    { gasLimit: 2_000_001n }, { gasLimit: 0n }, { nonce: 1 }, { chainId: 1 },
    { chainId: 100 }, { to: scope.alice }, { from: scope.alice },
    { data: "0x" }, { value: 1n } ]) {
    assert.throws(() => assertUiDSigningBudget({ ...tx, ...patch }, op, scope, plan, 10_000_000_000_000n, 0));
  }
  assert.throws(() => assertUiDSigningBudget(tx, op, scope, plan, op.value, 0));
});
