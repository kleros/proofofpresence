import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createReadOnlyHttpProvider } from "../src/mainnet-runtime.mjs";

// Offline transport integration: no real provider, credential or chain request.
const endpoint = "https://mainnet.infura.io/v3/offline-test-only";
const payload = (id) => ({ jsonrpc: "2.0", id, method: "eth_call",
  params: [{ to: "0x0000000000000000000000000000000000000001", data: "0x" }, "0x1234"] });
function fixture(timeoutMs = 5000) {
  const seen = [];
  const provider = createReadOnlyHttpProvider(endpoint, { timeoutMs, fetcher: async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.redirect, "error");
    assert.equal(options.signal.aborted, false);
    const request = JSON.parse(options.body);
    seen.push({ at: performance.now(), request });
    return { status: 200, json: async () => ({ jsonrpc: "2.0", id: request.id, result: "0x" }) };
  } });
  return { provider, seen };
}

test("Infura transport budgets concurrent actual HTTP reads without changing payloads", async () => {
  const { provider, seen } = fixture();
  const requests = Array.from({ length: 6 }, (_, index) => payload(index + 1));
  try {
    await Promise.all(requests.map((request) => provider._send(request)));
    assert.deepEqual(seen.map((entry) => entry.request), requests);
    assert.ok(seen[5].at - seen[0].at >= 1000, "the sixth80-credit request waits for the next budget window");
    for (const end of seen) {
      const credits = seen.filter((entry) => entry.at > end.at - 1090 && entry.at <= end.at).length * 80;
      assert.ok(credits <= 400);
    }
  } finally { provider.destroy(); }
});

test("timed-out queued transport reads never dispatch later", async () => {
  const { provider, seen } = fixture(60);
  try {
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => provider._send(payload(index + 1))));
    assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 5);
    assert.equal(results[5].status, "rejected");
    await new Promise((resolve) => setTimeout(resolve, 1150));
    assert.equal(seen.length, 5);
  } finally { provider.destroy(); }
});

test("provider destroy closes queued admission and aborts active transport signals", async () => {
  const signals = [], seen = [];
  const provider = createReadOnlyHttpProvider(endpoint, { timeoutMs: 5000, fetcher: async (_url, options) => {
    const request = JSON.parse(options.body); signals.push(options.signal); seen.push(request.id);
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort",
      () => reject(new Error("Offline transport aborted")), { once: true }));
  } });
  const pending = Promise.allSettled(Array.from({ length: 6 }, (_, index) => provider._send(payload(index + 1))));
  await new Promise((resolve) => setTimeout(resolve, 30));
  provider.destroy();
  const results = await pending;
  assert.ok(results.every((entry) => entry.status === "rejected"));
  assert.equal(results[5].status, "rejected");
  await new Promise((resolve) => setTimeout(resolve, 1150));
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(signals.length, 5);
  assert.ok(signals.every((signal) => signal.aborted));
});
