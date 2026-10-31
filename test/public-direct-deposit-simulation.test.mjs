// One actual isolated local CREATE for setup; every deposit operation below is
// read-only. RPC failures are injected only at the exact deposit eth_call.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";

test("direct deposit diagnostics preserve exact calls, canonical checks and zero deposit sends", { timeout: 180000 }, async t => {
  const managed = new Map(), f = await createV10AppFixture({ origin: "https://direct-simulation.example.invalid",
    firstEventManageScope: record => !!record && managed.get(record.definition.id)?.toLowerCase() === record.deployment.contract.toLowerCase() });
  t.after(() => f.close());
  const files = ["src/workbench.mjs", "src/direct-deposit-simulation.mjs", "src/production-errors.mjs"];
  const pins = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await fs.readFile(new URL("../" + file, import.meta.url))).digest("hex")])));
  const source = await pins(), out = new URL("../artifacts/direct-deposit-simulation/" + new Date().toISOString().replace(/[:.]/g, "-") + "/", import.meta.url);
  const proof = { kind: "actual-local-direct-deposit-simulation", status: "running", source, scenarios: [], eventCreateSends: 0, depositSends: 0,
    limits: ["Actual isolated Ganache V10 factory/event and HTTP production error boundary. Only one synthetic event CREATE is sent; deposit calls are validation simulations.", "RPC outages/revert/malformed reply and canonical/network changes are injected at the local provider. No public RPC, real wallet or signing files are used."] };
  let failure;
  try {
    const w = f.workbench(), owner = { id: "synthetic-simulation-owner", mode: "wallet", wallet: f.organizerAddress }, guest = await (await f.provider.getSigner(0)).getAddress();
    const empty = "0x000000000000000000000000000000000000dEaD", now = (await f.provider.getBlock("latest")).timestamp;
    const creation = await w.createFactoryDraft(owner, { title: "Synthetic simulation diagnostics", lumaUrl: "https://luma.com/synthetic-simulation",
      startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "UTC", depositEth: "0.01" });
    await w.validateFactoryDraft(owner, creation.id);
    const createdTx = await f.sendSyntheticTransaction(1, creation.transaction); proof.eventCreateSends++; await createdTx.wait();
    await w.recordFactorySubmitted(owner, creation.id, createdTx.hash);
    const created = await w.reconcileFactorySubmission(owner, creation.id, createdTx.hash); managed.set(created.eventId, created.contract);
    assert.equal(await f.provider.send("eth_getBalance", [empty, "latest"]), "0x0");
    const originalSend = f.provider.send; let mode = null, phase = null, calls = [], simulated = false;
    f.provider.send = async function(method, params) {
      if (["eth_sendTransaction", "eth_sendRawTransaction"].includes(method)) { proof.depositSends++; throw Error("No financial deposit sends are permitted in this test"); }
      if (phase) calls.push({ method, params });
      if (method === "eth_call" && params[0]?.to?.toLowerCase() === created.contract.toLowerCase() && params[0]?.data === "0xd0e30db0") {
        simulated = true;
        const secret = "DO_NOT_EXPOSE_https://rpc-user:password@private.invalid/key";
        if (mode === "funding-rpc") throw Object.assign(Error(secret), { code: "INSUFFICIENT_FUNDS" });
        if (mode === "outage" || mode === "network") throw Object.assign(Error(secret), { code: "TIMEOUT" });
        if (mode === "revert" || mode === "reorg") throw Object.assign(Error(secret), { code: "CALL_EXCEPTION", data: "0x" });
        if (mode === "rpc-revert") throw { code: "UNKNOWN_ERROR", info: { error: { code: 3, data: "0x12345678", message: secret } } };
        if (mode === "missing-revert") throw Object.assign(Error(secret), { code: "CALL_EXCEPTION", data: null });
        if (mode === "malformed") return "0x1234";
      }
      if (mode === "network" && simulated && method === "eth_chainId") return "0x2";
      const value = await originalSend.call(this, method, params);
      if (mode === "reorg" && simulated && method === "eth_getBlockByNumber" && params[0] !== "latest") return { ...value, hash: ethers.id("synthetic changed diagnostic anchor") };
      return value;
    };
    t.after(() => { f.provider.send = originalSend; });
    const request = async (path, body) => {
      const response = await f.forward(path, { method: "POST", body: JSON.stringify(body) });
      const data = JSON.parse(response.body.toString());
      assert(!response.body.toString().includes("DO_NOT_EXPOSE")); assert(!response.body.toString().includes("rpc-user"));
      return { status: response.status, data };
    };
    async function run(name, selected, injection, expectedCode, expectedStatus, balanceReads) {
      mode = phase = null; simulated = false;
      const flow = await request("/api/public-transactions", { wallet: selected, kind: "deposit" }); assert.equal(flow.status, 201);
      const base = "/api/public-transactions/" + flow.data.token;
      calls = []; phase = "prepare"; const quote = await request(base + "/direct-deposit", {}); phase = null;
      assert.equal(quote.status, 200, JSON.stringify(quote.data)); const prepareReads = calls.length; assert.equal(prepareReads, 5);
      calls = []; phase = "validate"; mode = injection; simulated = false;
      const result = await request(base + "/direct-deposit/validate", { draftId: quote.data.id }); mode = phase = null;
      assert.equal(result.status, expectedStatus, JSON.stringify(result.data));
      if (expectedCode) assert.equal(result.data.code, expectedCode, JSON.stringify(result.data));
      else assert.deepEqual(result.data.transaction, quote.data.transaction);
      const balances = calls.filter(call => call.method === "eth_getBalance"), deposit = calls.find(call => call.method === "eth_call" && call.params[0]?.data === "0xd0e30db0");
      assert(deposit); assert(balances.length <= 1); if (balanceReads !== undefined) assert.equal(balances.length, balanceReads);
      assert.deepEqual(deposit.params[0], { to: created.contract, from: selected, data: "0xd0e30db0", value: "0x2386f26fc10000" });
      for (const balance of balances) assert.deepEqual(balance.params, [selected, deposit.params[1]]);
      if (!expectedCode) { assert.equal(calls.length, 14); assert.equal(prepareReads + calls.length, 19); }
      assert(!calls.some(call => ["eth_getLogs", "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(call.method)));
      proof.scenarios.push({ name, status: result.status, code: result.data.code ?? null, prepareReads, validateReads: calls.length, balanceReads: balances.length });
      return result;
    }
    await run("funded normal exact simulation, unchanged 19 RPC hot path", guest, null, null, 200, 0);
    // Ganache may permit value-bearing eth_call from an unfunded account; this
    // observes that engine behavior, without pretending it is a production RPC.
    const emptyProbe = await f.provider.send("eth_call", [{ to: created.contract, from: empty, data: "0xd0e30db0", value: "0x2386f26fc10000" }, "latest"]).then(value => ({ result: value }), () => ({ rejected: true }));
    proof.unfundedEngineObservation = emptyProbe;
    await run("actual zero-balance EOA with injected strict-RPC funding rejection", empty, "funding-rpc", "INSUFFICIENT_ETH", 422, 1);
    await run("funded explicit EVM revert", guest, "revert", "DEPOSIT_SIMULATION_REVERTED", 409, 1);
    await run("funded structured RPC3 revert", guest, "rpc-revert", "DEPOSIT_SIMULATION_REVERTED", 409, 1);
    await run("funded RPC outage", guest, "outage", "DEPOSIT_SIMULATION_UNAVAILABLE", 503, 1);
    await run("missing revert data remains unavailable", guest, "missing-revert", "DEPOSIT_SIMULATION_UNAVAILABLE", 503, 1);
    await run("malformed void success response fails closed", guest, "malformed", "DEPOSIT_SIMULATION_INVALID_REPLY", 503, 0);
    await run("changed canonical block overrides diagnostic", empty, "reorg", "SELECTED_EVENT_REORG", 409, 1);
    await run("changed network overrides diagnostic", empty, "network", "SELECTED_EVENT_REORG", 409, 1);
    assert.equal(await w.contract(created.eventId).pendingDeposits(guest), 0n);
    assert.equal(await w.contract(created.eventId).pendingDeposits(empty), 0n);
    assert.equal(proof.eventCreateSends, 1); assert.equal(proof.depositSends, 0);
    assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
    assert.deepEqual(await pins(), source, "Product source changed during the focused local run");
    proof.status = "passed";
  } catch (error) { failure = error; proof.status = "failed"; proof.failure = error.message; }
  finally {
    await fs.mkdir(out, { recursive: true }); await fs.writeFile(new URL("proof.json", out), JSON.stringify(proof, null, 2) + "\n");
    t.diagnostic(JSON.stringify({ status: proof.status, scenarios: proof.scenarios.length, proof: new URL("proof.json", out).pathname, eventCreateSends: proof.eventCreateSends, depositSends: proof.depositSends }));
  }
  if (failure) throw failure;
});
