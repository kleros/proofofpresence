import { test } from "node:test";
import assert from "node:assert/strict";
import { assertDemoChainInstance } from "../public/hosted-wallet.js";
const marker = { blockNumber: 17, blockHash: "0x" + "ab".repeat(32) };
const rpc = "https://demo.invalid/rpc";
test("hosted wallet accepts only the captured instance block hash", async () => {
  const calls = [];
  await assertDemoChainInstance(
    {
      request: async (request) => {
        calls.push(request);
        return { hash: marker.blockHash.toUpperCase() };
      },
    },
    marker,
    rpc,
  );
  assert.deepEqual(calls, [
    { method: "eth_getBlockByNumber", params: ["0x11", false] },
  ]);
});
test("another chain1337 instance is rejected before signing", async () => {
  await assert.rejects(
    assertDemoChainInstance(
      { request: async () => ({ hash: "0x" + "cd".repeat(32) }) },
      marker,
      rpc,
    ),
    /different chain1337 instance.*https:\/\/demo.invalid\/rpc/,
  );
});
test("missing or failed wallet block reads fail closed", async () => {
  for (const provider of [
    { request: async () => null },
    {
      request: async () => {
        throw new Error("RPC offline");
      },
    },
  ])
    await assert.rejects(
      assertDemoChainInstance(provider, marker, rpc),
      /No transaction was requested/,
    );
});
test("missing instance metadata fails before any wallet request", async () => {
  let called = false;
  await assert.rejects(
    assertDemoChainInstance(
      {
        request: async () => {
          called = true;
        },
      },
      null,
      rpc,
    ),
    /identity is unavailable/,
  );
  assert.equal(called, false);
});
