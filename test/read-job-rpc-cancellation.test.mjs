// Provider transport only: injected fetch never contacts a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadOnlyHttpProvider } from "../src/mainnet-runtime.mjs";
import { withReadJobScope } from "../src/read-job-scope.mjs";
const wallet = "0x" + "12".repeat(20);
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function response(payload, result) { return { status: 200, json: async () => ({ jsonrpc: "2.0", id: payload.id, result }) }; }

test("job abort stops in-flight fetch and late continuation; unscoped reads keep working", async () => {
  const entered = gate(), reads = [], abort = new AbortController();
  const provider = createReadOnlyHttpProvider("https://synthetic-rpc.example.invalid", { timeoutMs: 10000,
    fetcher: async (_url, options) => {
      const payload = JSON.parse(options.body); reads.push(payload.method);
      if (payload.method === "eth_chainId") return response(payload, "0x1");
      assert.equal(payload.method, "eth_getCode");
      entered.resolve();
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    } });
  try {
    assert.equal(await provider.send("eth_chainId", []), "0x1");
    const releaseLate = gate();
    const late = withReadJobScope(abort.signal, async () => { await releaseLate.promise; return provider.send("eth_getCode", [wallet, "latest"]); });
    const lateRejected = assert.rejects(late);
    const work = withReadJobScope(abort.signal, () => provider.send("eth_getCode", [wallet, "latest"]));
    await entered.promise; abort.abort(); await assert.rejects(work);
    const before = reads.length;
    releaseLate.resolve(); await lateRejected;
    assert.equal(reads.length, before);
    assert.equal(await provider.send("eth_chainId", []), "0x1");
  } finally { provider.destroy(); }
});

test("an expired job leaves the Infura admission queue without another fetch", async () => {
  const reads = [], abort = new AbortController();
  const provider = createReadOnlyHttpProvider("https://mainnet.infura.io/v3/synthetic-no-credentials", { timeoutMs: 10000,
    fetcher: async (_url, options) => {
      const payload = JSON.parse(options.body); reads.push(payload.method);
      return response(payload, payload.method === "eth_chainId" ? "0x1" : []);
    } });
  try {
    await provider.send("eth_chainId", []);
    await provider.send("eth_getLogs", [{}]); // 255 credits: a second255 cannot fit the same400-credit interval.
    const before = reads.length;
    const queued = withReadJobScope(abort.signal, () => provider.send("eth_getLogs", [{}]));
    await new Promise(done => setTimeout(done, 30));
    assert.equal(reads.length, before);
    abort.abort(); await assert.rejects(queued);
    assert.equal(reads.length, before);
    assert.equal(await provider.send("eth_chainId", []), "0x1");
  } finally { provider.destroy(); }
});
