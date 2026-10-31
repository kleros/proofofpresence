// Actual isolated V10 contracts and canonical chain. No public RPC or signing files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";
import { INFURA_READ_METHOD_CREDITS } from "../src/rpc-read-scheduler.mjs";

test("first-event role checks retain full provenance and fresh private authority without financial projections", { timeout: 180000 }, async t => {
  const managed = new Map(), f = await createV10AppFixture({ origin: "https://first-event-authority.example.invalid",
    firstEventManageScope: r => !!r && managed.get(r.definition.id)?.toLowerCase() === r.deployment.contract.toLowerCase() });
  t.after(() => f.close());
  assert(f.provider instanceof ethers.BrowserProvider);
  const w = f.workbench(), owner = { id: "synthetic-authority-owner", mode: "wallet", wallet: f.organizerAddress };
  const staff = { id: "synthetic-authority-staff", mode: "wallet", wallet: await (await f.provider.getSigner(2)).getAddress() };
  const now = (await f.provider.getBlock("latest")).timestamp;
  async function create(label) {
    const draft = await w.createFactoryDraft(owner, { title: `Synthetic authority ${label}`, lumaUrl: `https://luma.com/synthetic-authority-${label}`,
      startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "UTC", depositEth: "0.01" });
    await w.validateFactoryDraft(owner, draft.id);
    const sent = await f.sendSyntheticTransaction(1, draft.transaction); await sent.wait();
    await w.recordFactorySubmitted(owner, draft.id, sent.hash);
    const result = await w.reconcileFactorySubmission(owner, draft.id, sent.hash);
    assert.equal(result.status, "confirmed"); return { id: draft.eventId, contract: result.contract };
  }
  const event = await create("selected"), other = await create("other"); managed.set(event.id, event.contract);
  const r = w.events.get(event.id), c = w.contract(event.id);
  r.definition.visibility = "private"; r.definition.organizers = [];
  const rawSend = f.provider.send, profiles = {}; let phase = null;
  f.provider.send = async function(method, params) {
    if (phase) (profiles[phase] ??= []).push(method);
    return rawSend.call(this, method, params);
  };
  t.after(() => { f.provider.send = rawSend; });
  async function measure(label, run) { phase = label; try { return await run(); } finally { phase = null; } }
  const oldOwner = async () => {
    await w.state(event.id); const record = w.record(event.id, owner);
    assert.equal((await w.contract(event.id).owner()).toLowerCase(), owner.wallet.toLowerCase()); return record;
  };
  await measure("old-empty", oldOwner);
  assert.equal(await measure("current-empty", () => w.owner(event.id, owner)), r);
  for (let i = 0; i < 150; i++) {
    const wallet = ethers.getAddress(ethers.dataSlice(ethers.id(`synthetic-authority-person-${i}`), 12));
    r.participants.set(`person-${i}`, { id: `person-${i}`, eventId: event.id, wallet, name: null, email: null, identityVerified: false, deposit: null });
  }
  await measure("old-150-wallets", oldOwner);
  await measure("current-150-wallets", () => w.owner(event.id, owner)); r.participants.clear();
  assert(profiles["current-150-wallets"].length < profiles["old-150-wallets"].length);
  assert(profiles["current-150-wallets"].length <= profiles["current-empty"].length + 2);
  for (const method of ["eth_getLogs", "eth_getTransactionByHash", "eth_getTransactionReceipt"])
    assert.equal(profiles["current-empty"].filter(value => value === method).length,
      profiles["old-empty"].filter(value => value === method).length, "The complete provenance proof remains");
  await assert.rejects(() => w.owner(event.id, null), { code: "UNAUTHENTICATED" });
  const publicActor = w.createPublicTransactionActor(owner.wallet, "synthetic-public-owner", "create");
  await assert.rejects(() => w.owner(event.id, publicActor), { code: "PUBLIC_FLOW_SCOPE" });

  const next = ethers.Wallet.createRandom().connect(f.provider);
  await (await f.sendSyntheticTransaction(0, { to: next.address, value: ethers.parseEther("1") })).wait();
  await (await f.sendSyntheticTransaction(1, { to: event.contract, data: c.interface.encodeFunctionData("transferOwnership", [next.address]) })).wait();
  const nextSession = { id: "synthetic-authority-next", mode: "wallet", wallet: next.address };
  await assert.rejects(() => w.owner(event.id, nextSession), { code: "NOT_OWNER" });
  assert(r.financialAccess.some(wallet => wallet.toLowerCase() === next.address.toLowerCase()));
  await (await next.sendTransaction({ to: event.contract, data: c.interface.encodeFunctionData("acceptOwnership", []) })).wait();
  assert.equal(await w.owner(event.id, nextSession), r);
  await assert.rejects(() => w.owner(event.id, owner), error => ["NOT_OWNER", "FORBIDDEN"].includes(error.code));
  await (await next.sendTransaction({ to: event.contract, data: c.interface.encodeFunctionData("transferOwnership", [owner.wallet]) })).wait();
  await (await f.sendSyntheticTransaction(1, { to: event.contract, data: c.interface.encodeFunctionData("acceptOwnership", []) })).wait();
  assert.equal(await w.owner(event.id, owner), r);
  r.definition.staff = [staff.wallet];
  await assert.rejects(() => w.checkin(event.id, staff, { participantId: "missing" }), { code: "UNKNOWN_IDENTITY" });
  r.definition.staff = [];
  await assert.rejects(() => w.checkin(event.id, staff, { participantId: "missing" }), error => ["NOT_STAFF", "FORBIDDEN"].includes(error.code));
  await assert.rejects(() => w.checkin(other.id, staff, { participantId: "missing" }), { code: "NOT_STAFF" });

  const codeSnapshot = await f.provider.send("evm_snapshot", []);
  try {
    await f.provider.send("evm_setAccountCode", [r.deployment.implementation, "0x00"]);
    await assert.rejects(() => w.owner(event.id, owner));
  } finally { assert.equal(await f.provider.send("evm_revert", [codeSnapshot]), true); }
  const getBlock = f.provider.getBlock; let advanced = 0;
  f.provider.getBlock = async function(tag) {
    if (tag === "latest" && advanced++ === 0) await f.provider.send("evm_mine", []);
    return getBlock.call(this, tag);
  };
  try { assert.equal(await w.owner(event.id, owner), r); assert.equal(advanced, 2, "Only one complete read-only retry is allowed"); }
  finally { f.provider.getBlock = getBlock; }
  let unstable = 0;
  f.provider.getBlock = async function(tag) {
    if (tag === "latest") { unstable++; await f.provider.send("evm_mine", []); }
    return getBlock.call(this, tag);
  };
  try { await assert.rejects(() => w.owner(event.id, owner), { code: "SELECTED_EVENT_REORG" }); assert.equal(unstable, 2); }
  finally { f.provider.getBlock = getBlock; }
  const reorgSnapshot = await f.provider.send("evm_snapshot", []); await f.provider.send("evm_mine", []); let reverted = false;
  f.provider.getBlock = async function(tag) {
    if (typeof tag === "number" && !reverted) { reverted = true; assert.equal(await f.provider.send("evm_revert", [reorgSnapshot]), true); }
    return getBlock.call(this, tag);
  };
  try { await assert.rejects(() => w.owner(event.id, owner), { code: "SELECTED_EVENT_REORG" }); assert.equal(reverted, true); }
  finally { f.provider.getBlock = getBlock; }
  assert.equal(await w.owner(event.id, owner), r); assert.equal(r.observations.length, 0);
  assert.equal(f.stats.backendSigningCalls, 0);
  t.diagnostic(JSON.stringify({ kind: "actual-local-first-event-authority-profile",
    profiles: Object.fromEntries(Object.entries(profiles).map(([name, reads]) => [name, { rpc: reads.length,
      credits: reads.reduce((sum, method) => sum + INFURA_READ_METHOD_CREDITS[method], 0) }])) }));
});
