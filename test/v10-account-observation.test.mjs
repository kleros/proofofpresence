import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { observeV10Account } from "../scripts/mainnet/observe-v10-account.mjs";

const block = { number: "0x64", timestamp: "0x64", hash: "0x" + "ab".repeat(32), baseFeePerGas: "0x10", gasLimit: "0x3938700" };
function transport(change = (_method, _params, value) => value) {
  const calls = [];
  return { calls, async request({ method, params }) {
    calls.push({ method, params });
    const value = method === "eth_chainId" ? "0x1" : method === "eth_getBlockByNumber" ? { ...block }
      : method === "eth_getCode" ? "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b"
        : method === "eth_getTransactionCount" ? "0x6" : method === "eth_getBalance" ? "0x1000000"
          : method === "eth_maxPriorityFeePerGas" ? "0x1" : assert.fail("Forbidden method");
    return change(method, params, value);
  } };
}
test("default account observer has no network/signing/journal access", () => {
  const child = spawnSync(process.execPath, ["scripts/mainnet/observe-v10-account.mjs"], { encoding: "utf8" });
  assert.equal(child.status, 0);
  const value = JSON.parse(child.stdout);
  for (const key of ["networkRequests", "privateFilesRead", "signatures", "broadcasts"]) assert.equal(value[key], 0);
});
test("preliminary account results bind the canonical public anchor and never approve deployment", async () => {
  const rpc = transport(), value = await observeV10Account(rpc);
  assert.equal(value.networkRequests, 10); assert.equal(value.account.category, "eip7702-delegated");
  assert.equal(value.account.delegate, "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B");
  assert.deepEqual(value.nonces, { pinned: "6", latest: "6", pending: "6" });
  assert.equal(value.anchor.number, 100); assert.equal(value.anchor.hash, block.hash);
  assert.equal(value.deploymentAuthorized, false); assert.equal(value.gasBudgetApproval, "NONE");
  assert.ok(rpc.calls.every(call => !/send|sign|accounts|debug|trace/i.test(call.method)));
});
test("unsafe block or timestamp conversion stops before any code/account read", async () => {
  for (const key of ["number", "timestamp"]) {
    const rpc = transport((method, _params, value) => method === "eth_getBlockByNumber" ? { ...value, [key]: "0x20000000000001" } : value);
    await assert.rejects(observeV10Account(rpc), { code: "RPC_HEADER_RANGE" });
    assert.equal(rpc.calls.length, 2);
  }
});
test("wrong chain, a changed canonical anchor and pending nonce disagreement stop", async () => {
  const wrong = transport((method, _params, value) => method === "eth_chainId" ? "0x2" : value);
  await assert.rejects(observeV10Account(wrong), { code: "WRONG_CHAIN" }); assert.equal(wrong.calls.length, 1);
  const reorg = transport((method, params, value) => method === "eth_getBlockByNumber" && params[0] !== "latest" ? { ...value, hash: "0x" + "cd".repeat(32) } : value);
  await assert.rejects(observeV10Account(reorg), { code: "CANONICAL_HEAD_CHANGED" });
  const pending = transport((method, params, value) => method === "eth_getTransactionCount" && params[1] === "pending" ? "0x7" : value);
  await assert.rejects(observeV10Account(pending), { code: "NONCE_CHANGED_OR_PENDING" });
});
