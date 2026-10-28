import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkbench } from "../src/workbench.mjs";

const browserSession = (identity, id) => ({ ...identity, id, mode: "wallet", signer: null });

test("manual deposit receipt recovery retires the pending reference and permits a fresh deposit after refund", async () => {
  const w = await createWorkbench({ rpcPort: 0 });
  try {
    const alice = w.session("alice"), owner = w.session("organizer-a");
    const first = browserSession(alice, "recovery-old-session");
    const current = browserSession(alice, "recovery-new-session");
    const draft = await w.createDraft("event-a", first, { action: "deposit" });
    const sent = await alice.signer.sendTransaction(draft.transaction);
    await sent.wait();
    await w.recordSubmitted("event-a", first, draft.id, sent.hash);
    await w.linkDeposit("event-a", current, { txHash: sent.hash });
    const verified = await w.detail("event-a", current);
    assert.equal(verified.participants[0].deposit.verified, true);
    assert.equal(verified.transactions.find(tx => tx.hash === sent.hash).status, "confirmed");
    await w.admit("event-a", owner, verified.participants[0].id, "declined");
    const rejection = await w.createDraft("event-a", owner, { action: "reject" });
    await w.executeDraft("event-a", owner, rejection.id);
    const returned = await w.detail("event-a", current);
    assert.equal(returned.participants[0].deposit.verificationState, "returned");
    assert.equal(returned.participants[0].deposit.verified, false);
    await w.admit("event-a", owner, verified.participants[0].id, "approved");
    const fresh = await w.createDraft("event-a", current, { action: "deposit" });
    assert.notEqual(fresh.id, draft.id);
    assert.equal(fresh.action, "deposit");
    await assert.rejects(() => w.validateDraft("event-a", first, draft.id), e => e.code === "STALE_DRAFT");
  } finally { await w.close(); }
});

test("expired non-deposit submissions reconcile across same-wallet sessions without restoring signing authority or resending", async () => {
  const w = await createWorkbench({ rpcPort: 0 });
  try {
    const owner = w.session("organizer-a"), bob = w.session("bob");
    const old = browserSession(owner, "owner-old-session"), current = browserSession(owner, "owner-new-session");
    const c = w.contract("event-a");
    await (await c.connect(bob.signer).deposit({ value: 1000n })).wait();
    const to = bob.wallet;
    const historical = await c.connect(owner.signer).refund(to, 1n);
    await historical.wait();
    const review = await w.createDraft("event-a", old, { action: "refund", params: { to, amountWei: "1" } });
    await assert.rejects(() => w.reconcileSubmission("event-a", current, review.id, historical.hash), e => e.code === "TX_PREDATES_REVIEW");
    const sent = await owner.signer.sendTransaction(review.transaction);
    await sent.wait();
    await w.recordSubmitted("event-a", old, review.id, sent.hash);
    await assert.rejects(() => w.reconcileSubmission("event-a", browserSession(bob, "wrong-wallet"), review.id, sent.hash));
    await assert.rejects(() => w.reconcileSubmission("event-b", current, review.id, sent.hash));
    await assert.rejects(() => w.confirmDraft("event-a", current, review.id, sent.hash), e => e.code === "DRAFT_SCOPE");
    const beforeNonce = await w.provider.getTransactionCount(owner.wallet);
    const realNow = Date.now;
    let recovered;
    try {
      Date.now = () => realNow() + 301_000;
      recovered = await w.reconcileSubmission("event-a", current, review.id, sent.hash);
    } finally { Date.now = realNow; }
    assert.equal(recovered.status, "confirmed");
    assert.equal(recovered.hash, sent.hash);
    assert.equal(await w.provider.getTransactionCount(owner.wallet), beforeNonce, "reconciliation must not submit another transaction");
    const detail = await w.detail("event-a", current);
    assert.equal(detail.transactions.filter(tx => tx.hash === sent.hash).length, 1);
    assert.equal(detail.transactions.find(tx => tx.hash === sent.hash).status, "confirmed");
    await assert.rejects(() => w.validateDraft("event-a", old, review.id), e => e.code === "STALE_DRAFT");
  } finally { await w.close(); }
});

test("a canonical reverted submission reconciles as failed without inventing payment or owed credit", async () => {
  const w = await createWorkbench({ rpcPort: 0 });
  try {
    const owner = w.session("organizer-a"), bob = w.session("bob");
    const old = browserSession(owner, "failed-old-session"), current = browserSession(owner, "failed-new-session");
    const c = w.contract("event-a");
    await (await c.connect(bob.signer).deposit({ value: 1000n })).wait();
    const review = await w.createDraft("event-a", old, { action: "refund", params: { to: bob.wallet, amountWei: "1" } });
    await (await c.connect(owner.signer).refund(bob.wallet, 1000n)).wait();
    const sent = await owner.signer.sendTransaction({ ...review.transaction, gasLimit: 300_000 });
    await assert.rejects(() => sent.wait());
    assert.equal((await w.provider.getTransactionReceipt(sent.hash)).status, 0);
    await w.recordSubmitted("event-a", old, review.id, sent.hash);
    const recovered = await w.reconcileSubmission("event-a", current, review.id, sent.hash);
    assert.equal(recovered.status, "failed");
    const detail = await w.detail("event-a", current);
    assert.equal(detail.transactions.find(tx => tx.hash === sent.hash).status, "failed");
    assert.equal(detail.payments.failedPaymentsWei, "0", "a reverted call is not a failed recipient payment");
    assert.equal(detail.state.owedTotalWei, "0");
  } finally { await w.close(); }
});

test("a deposit signed after cancellation recovers as failed without funding A or blocking B", async () => {
  const w = await createWorkbench({ rpcPort: 0 });
  try {
    const alice = w.session("alice"), owner = w.session("organizer-a");
    const old = browserSession(alice, "cancelled-deposit-old-session");
    const current = browserSession(alice, "cancelled-deposit-new-session");
    const review = await w.createDraft("event-a", old, { action: "deposit" });
    const cancel = await w.createDraft("event-a", owner, { action: "cancel" });
    await w.executeDraft("event-a", owner, cancel.id);
    const before = await w.detail("event-a", current);
    assert.equal(before.state.phase, "Cancelled");
    const sent = await alice.signer.sendTransaction({ ...review.transaction, gasLimit: 300_000 });
    await assert.rejects(() => sent.wait());
    assert.equal((await w.provider.getTransactionReceipt(sent.hash)).status, 0);
    await w.recordSubmitted("event-a", old, review.id, sent.hash);
    const recovered = await w.reconcileSubmission("event-a", current, review.id, sent.hash);
    assert.equal(recovered.status, "failed");
    const after = await w.detail("event-a", current);
    assert.equal(after.transactions.find(tx => tx.hash === sent.hash).status, "failed");
    assert.equal(after.participants[0].deposit, null);
    assert.equal(after.state.poolWei, before.state.poolWei);
    assert.equal(after.state.balanceWei, before.state.balanceWei);
    await assert.rejects(() => w.validateDraft("event-a", old, review.id), e => e.code === "STALE_DRAFT");
    const b = await w.createDraft("event-b", current, { action: "deposit" });
    assert.equal(b.eventId, "event-b");
    assert.equal(b.action, "deposit");
  } finally { await w.close(); }
});
