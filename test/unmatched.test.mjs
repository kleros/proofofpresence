import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkbench } from "../src/workbench.mjs";

test("resolved unmatched challenge never borrows another event’s resolver case zero", async () => {
  const w = await createWorkbench({ rpcPort: 0 });
  try {
    const a = w.session("organizer-a"),
      b = w.session("organizer-b"),
      alice = w.session("alice"),
      bob = w.session("bob");
    const tx = async (e, s, action, params = {}) => {
      const d = await w.createDraft(e, s, { action, params });
      return w.executeDraft(e, s, d.id);
    };
    for (const [eventId, owner] of [
      ["event-a", a],
      ["event-b", b],
    ]) {
      for (const p of [alice, bob]) {
        await tx(eventId, p, "deposit");
        await w.admit(eventId, owner, `${eventId}-${p.id}`, "approved");
      }
      await tx(eventId, owner, "register");
    }
    await w.advance(7201);
    for (const [e, owner, person] of [
      ["event-a", a, alice],
      ["event-b", b, bob],
    ]) {
      await w.checkin(e, owner, {
        participantId: `${e}-${person.id}`,
        nonce: `${e}-synthetic-door`,
        source: "staff-door",
        note: "Synthetic present guest",
      });
      await tx(e, owner, "postAttendance");
    }
    await tx("event-a", bob, "challenge");
    await tx("event-a", a, "match", { wallet: bob.wallet });
    await w.mockRuling("event-a", a, bob.wallet, 2);
    await tx("event-a", a, "resolve", { wallet: bob.wallet });
    assert.equal((await w.chain.resolver.disputes(0)).ruling, 2n);
    await tx("event-b", alice, "challenge");
    await w.advance(86401);
    await tx("event-b", b, "resolve", { wallet: alice.wallet });
    const detail = await w.detail("event-b", alice),
      unmatched = detail.state.cases.find(
        (c) => c.wallet.toLowerCase() === alice.wallet.toLowerCase(),
      );
    assert.equal(await w.contract("event-b").attended(alice.wallet), true);
    assert.equal(unmatched.matched, false);
    assert.equal(unmatched.outcome, "attended-unmatched");
    assert.equal(unmatched.localDisputeID, null);
    assert.equal(unmatched.arbitratorDisputeID, null);
    assert.equal(unmatched.finalRuling, null);
    assert.equal(unmatched.appeal, null);
    assert.equal(unmatched.caseURI, null);
    for (const action of ["evidence", "fundAppeal", "appealRewards"])
      await assert.rejects(
        () =>
          w.createDraft("event-b", alice, {
            action,
            params: {
              wallet: alice.wallet,
              uri: "/ipfs/synthetic",
              side: 1,
              amountWei: "1",
              sides: [1],
            },
          }),
        (e) => e.code === "NOT_MATCHED_CASE",
      );
    await assert.rejects(
      () => w.publish("event-b", alice, alice.wallet),
      (e) => e.code === "NOT_MATCHED_CASE",
    );
  } finally {
    await w.close();
  }
});
