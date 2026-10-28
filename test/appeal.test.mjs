import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkbench } from "../src/workbench.mjs";

test("reviewed Court delivery respects a one-sided appeal override and direct contributor rewards", async () => {
  const w = await createWorkbench({ rpcPort: 0 });
  try {
    const owner = w.session("organizer-a"),
      other = w.session("organizer-b"),
      alice = w.session("alice"),
      bob = w.session("bob");
    const transact = async (s, action, params = {}) => {
      const draft = await w.createDraft("event-a", s, { action, params });
      const receipt = await w.executeDraft("event-a", s, draft.id);
      assert.equal(receipt.status, "confirmed");
      return { draft, receipt };
    };
    for (const p of [alice, bob]) {
      await transact(p, "deposit");
      await w.admit("event-a", owner, `event-a-${p.id}`, "approved");
    }
    await transact(owner, "register");
    await w.advance(3601);
    await w.checkin("event-a", w.session("staff-a"), {
      participantId: "event-a-alice",
      nonce: "appeal-door-alice",
      source: "staff-door",
      note: "Synthetic trusted observation",
    });
    await transact(owner, "postAttendance");
    await transact(bob, "challenge");
    await transact(other, "match", { wallet: bob.wallet });
    await w.mockAppeal("event-a", owner, bob.wallet, 2, 600);
    const details = await w.detail("event-a", owner),
      caseInfo = details.state.cases.find(
        (c) => c.wallet.toLowerCase() === bob.wallet.toLowerCase(),
      );
    const funded = await transact(bob, "fundAppeal", {
      wallet: bob.wallet,
      side: 1,
      amountWei: caseInfo.appeal.costAttended,
    });
    assert.equal(
      funded.draft.transaction.to.toLowerCase(),
      w.chain.resolver.target.toLowerCase(),
      "appeal money goes directly to the resolver",
    );
    assert.equal(funded.draft.args[0], caseInfo.localDisputeID);
    assert.notEqual(caseInfo.localDisputeID, caseInfo.arbitratorDisputeID);
    const fundingReceipt = await w.provider.getTransactionReceipt(
      funded.receipt.hash,
    );
    const contribution = fundingReceipt.logs
      .filter(
        (l) =>
          l.address.toLowerCase() === w.chain.resolver.target.toLowerCase(),
      )
      .map((l) => w.chain.resolver.interface.parseLog(l))
      .find((l) => l?.name === "Contribution");
    assert.equal(contribution.args.contributor, bob.wallet);
    await assert.rejects(
      () =>
        w.createDraft("event-a", alice, {
          action: "passPeriod",
          params: { wallet: bob.wallet },
        }),
      "appeal cannot be delivered before its deadline",
    );
    await w.advance(601);
    const advanced = await transact(alice, "passPeriod", {
      wallet: bob.wallet,
    });
    assert.equal(
      advanced.draft.args[0],
      caseInfo.arbitratorDisputeID,
      "arbitrator operations use its own dispute ID",
    );
    await transact(alice, "deliverRuling", { wallet: bob.wallet });
    const final = await w.chain.resolver.disputes(caseInfo.localDisputeID);
    assert.equal(final.isRuled, true);
    assert.equal(
      final.ruling,
      1n,
      "the only fully funded answer wins despite the previous absent vote",
    );
    await transact(alice, "resolve", { wallet: bob.wallet });
    assert.equal(await w.contract("event-a").attended(bob.wallet), true);
    assert.ok(
      (await w.chain.resolver.getTotalWithdrawableAmount(
        caseInfo.localDisputeID,
        bob.wallet,
        [1],
      )) > 0n,
    );
    await transact(bob, "appealRewards", { wallet: bob.wallet, sides: [1] });
    assert.equal(
      await w.chain.resolver.getTotalWithdrawableAmount(
        caseInfo.localDisputeID,
        bob.wallet,
        [1],
      ),
      0n,
    );
  } finally {
    await w.close();
  }
});
