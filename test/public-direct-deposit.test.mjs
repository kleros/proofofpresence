// Actual isolated Ganache V10 contracts; no public RPC or real signing files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";
import { IMPLEMENTATION_SLOT } from "../src/upgrade-verification.mjs";

test("direct public deposits retain current pins, exact credit, scope, window and canonical receipts", { timeout: 180000 }, async t => {
  const managed = new Map(), f = await createV10AppFixture({ origin: "https://direct-deposit.example.invalid",
    firstEventManageScope: r => !!r && managed.get(r.definition.id)?.toLowerCase() === r.deployment.contract.toLowerCase() });
  t.after(() => f.close());
  const w = f.workbench(), owner = { id: "synthetic-direct-owner", mode: "wallet", wallet: f.organizerAddress };
  const guest = await (await f.provider.getSigner(0)).getAddress(), other = await (await f.provider.getSigner(2)).getAddress();
  const now = (await f.provider.getBlock("latest")).timestamp;
  const creation = await w.createFactoryDraft(owner, { title: "Synthetic direct deposit", lumaUrl: "https://luma.com/synthetic-direct",
    startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "UTC", depositEth: "0.01" });
  await w.validateFactoryDraft(owner, creation.id);
  const createdTx = await f.sendSyntheticTransaction(1, creation.transaction); await createdTx.wait();
  await w.recordFactorySubmitted(owner, creation.id, createdTx.hash);
  const created = await w.reconcileFactorySubmission(owner, creation.id, createdTx.hash);
  managed.set(created.eventId, created.contract);
  const r = w.events.get(created.eventId), d = r.deployment, BASE = "/api/public-transactions";
  async function request(path, payload) {
    const response = await f.forward(path, { method: "POST", body: JSON.stringify(payload) });
    assert.equal(response.headers["set-cookie"], undefined);
    return { status: response.status, data: JSON.parse(response.body.toString()) };
  }
  async function mint(wallet = guest, kind = "deposit") {
    const response = await request(BASE, { wallet, kind }); assert.equal(response.status, 201);
    return `${BASE}/${response.data.token}`;
  }
  const send = f.provider.send, profiles = {}; let phase = null;
  f.provider.send = async function(method, params) {
    if (phase) (profiles[phase] ??= []).push(method);
    return send.call(this, method, params);
  };
  t.after(() => { f.provider.send = send; });
  const path = await mint(); phase = "prepare";
  const prepared = await request(path + "/direct-deposit", {}); phase = null;
  assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
  const first = prepared.data, c = first.directDepositContext;
  assert.equal(c.kind, "direct-deposit-v1"); assert.equal(c.eventId, created.eventId);
  assert.equal(c.verification, "amount-quote");
  assert.equal(c.origin, f.origin); assert.equal(c.wallet, guest); assert.equal(c.snapshot, first.snapshot);
  assert.equal(c.pendingCreditWei, "0"); assert.equal(first.valueWei, "10000000000000000");
  assert.equal(first.transaction.data, "0xd0e30db0"); assert(first.v10Intent);
  assert.equal(first.transaction.to.toLowerCase(), created.contract.toLowerCase());
  assert.equal((await f.provider.getBlock(c.blockNumber)).hash, c.blockHash); assert.equal(r.participants.size, 0);
  phase = "validate"; const valid = await request(path + "/direct-deposit/validate", { draftId: first.id }); phase = null;
  assert.equal(valid.status, 200, JSON.stringify(valid.data)); assert.deepEqual(valid.data.transaction, first.transaction);
  t.diagnostic(JSON.stringify({ initialDirectProfile: Object.fromEntries(Object.entries(profiles).map(([key, reads]) => [key,
    { count: reads.length, methods: Object.fromEntries([...new Set(reads)].map(method => [method, reads.filter(value => value === method).length])) }])) }));
  assert.equal(profiles.prepare.length, 5); assert.equal(profiles.validate.length, 14);
  assert.equal(Object.values(profiles).reduce((sum, reads) => sum + reads.length, 0), 19);
  assert(!Object.values(profiles).flat().some(m => ["eth_getLogs", "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(m)));
  const partial = await f.sendSyntheticTransaction(0, { to: created.contract, data: "0xd0e30db0", value: ethers.parseEther("0.004") }); await partial.wait();
  assert.equal((await request(path + "/direct-deposit/validate", { draftId: first.id })).data.code, "STALE_DRAFT");
  for (const address of [d.contract, d.implementation, d.factory, d.factoryImplementation, d.upgradeAuthority]) {
    const target = await mint(other), quote = await request(target + "/direct-deposit", {}); assert.equal(quote.status, 200);
    const snapshot = await f.provider.send("evm_snapshot", []);
    try {
      await f.provider.send("evm_setAccountCode", [address, "0x00"]);
      assert((await request(target + "/direct-deposit/validate", { draftId: quote.data.id })).status >= 400);
    } finally { assert.equal(await f.provider.send("evm_revert", [snapshot]), true); }
  }
  for (const address of [d.contract, d.factory]) {
    const target = await mint(other), quote = await request(target + "/direct-deposit", {}); assert.equal(quote.status, 200);
    const snapshot = await f.provider.send("evm_snapshot", []);
    try {
      await f.provider.send("evm_setAccountStorageAt", [address, IMPLEMENTATION_SLOT, ethers.ZeroHash]);
      assert((await request(target + "/direct-deposit/validate", { draftId: quote.data.id })).status >= 400);
    } finally { assert.equal(await f.provider.send("evm_revert", [snapshot]), true); }
  }
  const windowTarget = await mint(other), windowQuote = await request(windowTarget + "/direct-deposit", {});
  assert.equal(windowQuote.status, 200);
  const snapshot = await f.provider.send("evm_snapshot", []);
  try {
    await f.provider.send("evm_increaseTime", [7200]); await f.provider.send("evm_mine", []);
    assert.equal((await request(windowTarget + "/direct-deposit/validate", { draftId: windowQuote.data.id })).data.code, "OUTSIDE_DEPOSIT_WINDOW");
  } finally { assert.equal(await f.provider.send("evm_revert", [snapshot]), true); }
  const statusTarget = await mint(other), statusQuote = await request(statusTarget + "/direct-deposit", {});
  assert.equal(statusQuote.status, 200);
  const statusSnapshot = await f.provider.send("evm_snapshot", []);
  try {
    const funded = await f.sendSyntheticTransaction(2, { to: created.contract, data: "0xd0e30db0", value: ethers.parseEther("0.01") }); await funded.wait();
    const registered = await f.sendSyntheticTransaction(1, { to: created.contract,
      data: w.contract(created.eventId).interface.encodeFunctionData("registerStakers", [[other]]) }); await registered.wait();
    assert.equal((await request(statusTarget + "/direct-deposit/validate", { draftId: statusQuote.data.id })).data.code, "ALREADY_REGISTERED");
  } finally { assert.equal(await f.provider.send("evm_revert", [statusSnapshot]), true); }
  const createPath = await mint(other, "create"); assert.equal((await request(createPath + "/direct-deposit", {})).status, 403);
  const reorgTarget = await mint(other), reorgQuote = await request(reorgTarget + "/direct-deposit", {}); assert.equal(reorgQuote.status, 200);
  const rpcSend = f.provider.send;
  f.provider.send = async function(method, params) { const block = await rpcSend.call(this, method, params);
    return method === "eth_getBlockByNumber" && params[0] !== "latest" && block
      ? { ...block, hash: ethers.id("synthetic-direct-reorg") } : block; };
  try { assert.equal((await request(reorgTarget + "/direct-deposit/validate", { draftId: reorgQuote.data.id })).data.code, "SELECTED_EVENT_REORG"); }
  finally { f.provider.send = rpcSend; }
  const target = await mint(), topup = await request(target + "/direct-deposit", {});
  assert.equal(topup.status, 200); assert.equal(topup.data.valueWei, "6000000000000000");
  assert.equal(topup.data.directDepositContext.pendingCreditWei, "4000000000000000");
  assert.equal((await request(target + "/direct-deposit/validate", { draftId: first.id })).status, 403);
  assert.equal((await request(target + "/direct-deposit/validate", { draftId: topup.data.id })).status, 200);
  const sent = await f.sendSyntheticTransaction(0, topup.data.transaction); await sent.wait();
  assert.equal((await request(target + "/submitted", { draftId: topup.data.id, hash: sent.hash })).status, 200);
  assert.equal(r.participants.size, 0);
  const duplicate = await mint(); assert.equal((await request(duplicate + "/direct-deposit", {})).data.code, "PENDING_DEPOSIT");
  const actorId = f.savedState().drafts.find(([id]) => id === topup.data.id)[1].sessionId;
  // The HTTP flow's actor remains private. Exercise its normal public confirm job.
  const requestId = "direct-confirm-original", start = await request(target + "/event-read-jobs", {
    requestId, operation: "confirm", eventId: created.eventId, draftId: topup.data.id, hash: sent.hash });
  assert.equal(start.status, 202); assert(actorId);
  let terminal;
  for (let i = 0; i < 400; i++) {
    const response = await f.forward(target + "/event-read-jobs/" + requestId), value = JSON.parse(response.body.toString());
    if (value.state !== "pending") { terminal = value; break; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(terminal?.state, "ready", JSON.stringify(terminal)); assert.equal(terminal.result.status, "confirmed");
  assert.equal(terminal.result.hash, sent.hash); assert.equal([...r.participants.values()][0].identitySource, "signed-transaction-receipt");
  assert.equal(await w.contract(created.eventId).pendingDeposits(guest), ethers.parseEther("0.01"));
  const funded = await mint(); assert.equal((await request(funded + "/direct-deposit", {})).data.code, "CREDIT_AVAILABLE");
  assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
  t.diagnostic(JSON.stringify({ kind: "actual-local-direct-deposit-profile", rpc: Object.fromEntries(Object.entries(profiles).map(([key, reads]) => [key, reads.length])) }));
});
