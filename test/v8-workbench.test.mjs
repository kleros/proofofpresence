import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkbench } from "../src/workbench.mjs";

test("v8 application reviews own-credit recovery, invalidates old receipts and settles a matched case with kickbacks", async () => {
  const w = await createWorkbench({ contractVersion: "kleros-event-v8" });
  try {
    const owner = w.session("organizer-a"),
      alice = w.session("alice"),
      bob = w.session("bob"),
      carol = w.session("carol");
    const action = async (who, name, params = {}) => {
      const draft = await w.createDraft("event-a", who, {
        action: name,
        params,
      });
      assert.equal(draft.contractVersion, "kleros-event-v8");
      const result = await w.executeDraft("event-a", who, draft.id);
      assert.equal(
        (await w.provider.getTransactionReceipt(result.hash)).status,
        1,
      );
      return result;
    };
    const boot = await w.bootstrap();
    assert.equal(boot.contractVersion, "kleros-event-v8");
    const first = await action(alice, "deposit");
    let view = await w.detail("event-a", alice);
    assert.equal(view.participants[0].pendingCreditWei, "10000000000000000");
    assert.equal(view.state.poolWei, "0");
    await assert.rejects(
      w.createDraft("event-a", bob, {
        action: "withdrawPending",
        params: {
          to: alice.wallet,
          amountWei: view.participants[0].pendingCreditWei,
        },
      }),
      /unused deposit credit/,
    );
    await action(alice, "withdrawPending", {
      to: alice.wallet,
      amountWei: "10000000000000000",
    });
    view = await w.detail("event-a", alice);
    assert.equal(view.participants[0].pendingCreditWei, "0");
    assert.equal(view.participants[0].deposit.verificationState, "returned");
    assert.equal(view.payments.pendingCreditWithdrawnWei, "10000000000000000");
    await assert.rejects(
      w.linkDeposit("event-a", alice, { txHash: first.hash }),
      /recovered or refunded/,
    );
    for (const who of [alice, bob, carol]) {
      await action(who, "deposit");
      if (who === alice) {
        await action(alice, "withdrawPending", {
          to: alice.wallet,
          amountWei: "5000000000000000",
        });
        await action(alice, "deposit");
      }
      const person = (await w.detail("event-a", who)).participants[0];
      await w.admit("event-a", owner, person.id, "approved");
    }
    await action(owner, "register");
    await action(alice, "withdrawPending", {
      to: alice.wallet,
      amountWei: "5000000000000000",
    });
    assert.equal(
      (await w.detail("event-a", alice)).participants[0].deposit.verified,
      true,
      "Recovering excess credit cannot invalidate an admitted principal sourced from multiple deposits",
    );
    view = await w.detail("event-a", owner);
    assert.equal(view.state.pendingTotalWei, "0");
    assert.equal(view.state.stakerCount, 3);
    await w.advance(3601);
    for (const who of [alice, carol]) {
      const person = view.participants.find((p) => p.wallet === who.wallet);
      await w.checkin("event-a", owner, {
        participantId: person.id,
        nonce: `v8-${person.id}`,
        source: "staff-door",
        note: "Synthetic attendance",
      });
    }
    await action(owner, "postAttendance");
    await action(bob, "challenge");
    await action(owner, "match", { wallet: bob.wallet });
    await w.advance(86401);
    await action(owner, "release");
    view = await w.detail("event-a", owner);
    assert.equal(view.state.phase, "Finalized");
    assert.equal(view.state.heldBackWei, "10000000000000000");
    assert.equal(view.payments.attendancePaidWei, "20000000000000000");
    await w.mockRuling("event-a", owner, bob.wallet, 1);
    await action(owner, "resolve", { wallet: bob.wallet });
    view = await w.detail("event-a", owner);
    assert.equal(view.state.heldBackWei, "0");
    assert.equal(view.payments.attendancePaidWei, "30000000000000000");
    const b = await w.detail("event-b", w.session("organizer-b"));
    assert.equal(b.state.poolWei, "0");
    assert.equal(b.state.pendingTotalWei, "0");
    assert.equal(b.state.stakerCount, 0);
  } finally {
    await w.close();
  }
});
