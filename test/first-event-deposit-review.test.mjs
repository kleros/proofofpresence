// Actual isolated V10 contracts and the original full verifier/sender inputs.
// Only Court metadata is mocked by the existing fixture; no public RPC or keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";

test("a narrow deposit review reuses its exact authoritative state and preserves validation/top-ups", { timeout: 180000 }, async t => {
  const f = await createV10AppFixture({ origin: "https://deposit-review.example.invalid" });
  t.after(() => f.close());
  assert(f.provider instanceof ethers.BrowserProvider);
  const w = f.workbench(), owner = { id: "synthetic-review-owner", mode: "wallet", wallet: f.organizerAddress };
  const guest = { id: "synthetic-review-guest", mode: "wallet", wallet: await (await f.provider.getSigner(2)).getAddress() };
  const now = (await f.provider.getBlock("latest")).timestamp;
  const creation = await w.createFactoryDraft(owner, { title: "Synthetic scoped deposit review",
    lumaUrl: "https://luma.com/synthetic-deposit-review", startsAt: new Date((now + 3600) * 1000).toISOString(),
    endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "UTC", depositEth: "0.01" });
  await w.validateFactoryDraft(owner, creation.id);
  const createdTx = await f.sendSyntheticTransaction(1, creation.transaction); await createdTx.wait();
  await w.recordFactorySubmitted(owner, creation.id, createdTx.hash);
  const created = await w.reconcileFactorySubmission(owner, creation.id, createdTx.hash);
  assert.equal(created.status, "confirmed");
  await assert.rejects(() => w.createDepositReview(creation.eventId, null), { code: "UNAUTHENTICATED" });

  const originalSend = f.provider.send, counts = {};
  let phase = null;
  f.provider.send = async function(method, params) {
    if (phase) counts[phase] = (counts[phase] ?? 0) + 1;
    return originalSend.call(this, method, params);
  };
  t.after(() => { f.provider.send = originalSend; });
  phase = "selectedBootstrap";
  await w.bootstrap(guest, { selectedEventId: creation.eventId, selectedOnly: true });
  phase = "firstDepositReview";
  const result = await w.createDepositReview(creation.eventId, guest);
  phase = null;
  const review = result.depositReview, detail = review.selectedEvent.detail;
  assert.equal(result.valueWei, "10000000000000000");
  assert.equal(result.transaction.data, "0xd0e30db0");
  assert.equal(result.transaction.to.toLowerCase(), created.contract.toLowerCase());
  assert.equal(review.kind, "deposit-review-v1");
  assert.equal(review.origin, f.origin);
  assert.equal(review.instanceId, result.instanceId);
  assert.equal(detail.event.id, creation.eventId);
  assert.equal(detail.state.fingerprint, result.snapshot);
  assert.equal(detail.state.blockNumber, result.reviewBlock);
  assert.equal(detail.state.blockHash, (await f.provider.getBlock(result.reviewBlock)).hash);
  assert.equal(detail.deploymentTrust.status, "verified");
  assert.equal(detail.upgrade.verified, true);
  assert.equal(detail.ownWallet.depositAction.eligible, true);
  assert.equal(detail.ownWallet.depositAction.amountWei, result.valueWei);
  assert.equal(Object.hasOwn(detail, "payments"), false);
  assert.equal(Object.hasOwn(detail.ownWallet, "deposit"), false, "No receipt is invented by an unsigned review");
  assert.deepEqual(detail.participants, []);
  assert.deepEqual(detail.transactions, []);
  assert.equal((await w.finalizeReadResult("deposit", structuredClone(result), guest, creation.eventId)).id, result.id);
  const wrongWallet = { ...guest, id: owner.id, wallet: owner.wallet };
  await assert.rejects(() => w.finalizeReadResult("deposit", structuredClone(result), wrongWallet, creation.eventId), { code: "STALE_DRAFT" });
  for (const mutate of [
    value => { value.depositReview.origin = "https://other.example.invalid"; },
    value => { value.depositReview.instanceId = "other-instance"; },
    value => { value.depositReview.selectedEvent.detail.state.fingerprint = "changed"; },
    value => { value.depositReview.selectedEvent.detail.ownWallet.depositAction.amountWei = "1"; },
  ]) {
    const changed = structuredClone(result); mutate(changed);
    await assert.rejects(() => w.finalizeReadResult("deposit", changed, guest, creation.eventId), { code: "STALE_DRAFT" });
  }
  const reorg = structuredClone(result); reorg.depositReview.selectedEvent.detail.state.blockHash = ethers.id("synthetic-reorg");
  await assert.rejects(() => w.finalizeReadResult("deposit", reorg, guest, creation.eventId), { code: "SELECTED_EVENT_REORG" });
  phase = "validate";
  assert.deepEqual((await w.validateDraft(creation.eventId, guest, result.id)).d.transaction, result.transaction);
  phase = null;

  // A real manual partial deposit changes current credit and invalidates the old
  // review. A newly prepared review must request only the exact remaining D.
  const partial = await f.sendSyntheticTransaction(2, { to: created.contract, value: ethers.parseEther("0.004"), data: "0xd0e30db0" });
  await partial.wait();
  await assert.rejects(() => w.validateDraft(creation.eventId, guest, result.id), { code: "STALE_DRAFT" });
  phase = "warmDepositReview";
  const topup = await w.createDepositReview(creation.eventId, guest);
  phase = null;
  assert.equal(topup.valueWei, "6000000000000000");
  assert.equal(topup.depositReview.selectedEvent.detail.ownWallet.depositAction.amountWei, topup.valueWei);
  await w.validateDraft(creation.eventId, guest, topup.id);
  const deposit = await f.sendSyntheticTransaction(2, topup.transaction); await deposit.wait();
  await w.recordSubmitted(creation.eventId, guest, topup.id, deposit.hash);
  const confirmed = await w.reconcileSubmission(creation.eventId, guest, topup.id, deposit.hash);
  assert.equal(confirmed.status, "confirmed");
  await assert.rejects(() => w.createDepositReview(creation.eventId, guest), { code: "CREDIT_AVAILABLE" });
  assert.equal(f.stats.backendSigningCalls, 0);
  t.diagnostic(JSON.stringify({ kind: "actual-local-v10-deposit-review", rpc: counts,
    removedBootstrapRPC: counts.selectedBootstrap * 2, fullVerifierUnchanged: true }));
});
