import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkbench } from "../src/workbench.mjs";

test("submitted wallet hash stays event scoped, blocks duplicate deposit and reconciles one confirmed record", async () => {
  const w = await createWorkbench({ rpcPort: 0 });
  try {
    const identity = w.session("alice"),
      browser = {
        ...identity,
        id: "browser-session-1",
        mode: "wallet",
        signer: null,
      };
    const d = await w.createDraft("event-a", browser, { action: "deposit" });
    const sent = await identity.signer.sendTransaction(d.transaction);
    await sent.wait();
    const pending = await w.recordSubmitted(
      "event-a",
      browser,
      d.id,
      sent.hash,
    );
    assert.equal(pending.status, "pending");
    assert.equal(
      (await w.recordSubmitted("event-a", browser, d.id, sent.hash)).hash,
      sent.hash,
    );
    await assert.rejects(
      () => w.createDraft("event-a", browser, { action: "deposit" }),
      (e) => e.code === "PENDING_DEPOSIT",
    );
    await assert.rejects(
      () => w.validateDraft("event-a", browser, d.id),
      (e) => e.code === "STALE_DRAFT",
    );
    await assert.rejects(
      () => w.recordSubmitted("event-b", browser, d.id, sent.hash),
      (e) => e.code === "DRAFT_SCOPE",
    );
    await assert.rejects(
      () => w.submissionStatus("event-a", w.session("bob"), sent.hash),
      (e) => e.code === "NOT_FOUND",
    );
    const status = await w.submissionStatus("event-a", browser, sent.hash);
    assert.equal(status.receiptStatus, "confirmed");
    assert.equal(status.status, "mined");
    assert.equal(
      (await w.detail("event-a", browser)).participants[0].deposit,
      null,
      "a submitted hash alone does not verify a deposit",
    );
    const confirmed = await w.confirmDraft("event-a", browser, d.id, sent.hash);
    assert.equal(confirmed.status, "confirmed");
    const detail = await w.detail("event-a", browser);
    assert.equal(detail.transactions.length, 1);
    assert.equal(detail.transactions[0].status, "confirmed");
    assert.equal(detail.participants[0].deposit.verified, true);
    assert.equal(detail.participants[0].registered, false);
    await assert.rejects(
      () => w.confirmDraft("event-a", browser, d.id, sent.hash),
      (e) => e.code === "DRAFT_SCOPE",
    );
  } finally {
    await w.close();
  }
});

test("a concurrent submission record cannot receive another demo transaction’s receipt status", async () => {
  const w = await createWorkbench({ rpcPort: 0 });
  try {
    const bob = w.session("bob"),
      carol = w.session("carol");
    const bobDraft = await w.createDraft("event-a", bob, { action: "deposit" });
    const carolDraft = await w.createDraft("event-a", carol, {
      action: "deposit",
    });
    const original = bob.signer.sendTransaction.bind(bob.signer),
      unresolved = "0x" + "a".repeat(64);
    bob.signer.sendTransaction = async (request) => {
      const sent = await original(request);
      await w.recordSubmitted("event-a", carol, carolDraft.id, unresolved);
      return sent;
    };
    await w.executeDraft("event-a", bob, bobDraft.id);
    const detail = await w.detail("event-a", w.session("organizer-a"));
    assert.equal(
      detail.transactions.find((t) => t.wallet === bob.wallet).status,
      "confirmed",
    );
    assert.equal(
      detail.transactions.find((t) => t.wallet === carol.wallet).status,
      "pending",
    );
    assert.equal(
      detail.transactions.find((t) => t.wallet === carol.wallet).hash,
      unresolved,
    );
  } finally {
    await w.close();
  }
});
