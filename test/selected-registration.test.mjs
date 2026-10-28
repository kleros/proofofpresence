import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkbench } from "../src/workbench.mjs";

test("selected registration verifies only the reviewed wallets while an unrelated approved payer has recovered credit", async () => {
  const w = await createWorkbench({ contractVersion: "kleros-event-v8" });
  try {
    const owner = w.session("organizer-a"),
      alice = w.session("alice"),
      bob = w.session("bob");
    const action = async (who, name, params = {}) => {
      const draft = await w.createDraft("event-a", who, {
        action: name,
        params,
      });
      return w.executeDraft("event-a", who, draft.id);
    };
    for (const person of [alice, bob]) {
      await action(person, "deposit");
      const linked = (await w.detail("event-a", person)).participants[0];
      await w.admit("event-a", owner, linked.id, "approved");
    }
    const beforeB = await w.state("event-b");
    await action(bob, "withdrawPending", {
      to: bob.wallet,
      amountWei: "10000000000000000",
    });
    const selected = await w.createDraft("event-a", owner, {
      action: "register",
      params: { wallets: [alice.wallet] },
    });
    assert.deepEqual(selected.args, [[alice.wallet]]);
    await w.executeDraft("event-a", owner, selected.id);
    assert.equal(await w.contract("event-a").status(alice.wallet), 1n);
    assert.equal(await w.contract("event-a").status(bob.wallet), 0n);
    assert.equal((await w.state("event-a")).poolWei, "10000000000000000");
    await assert.rejects(
      w.createDraft("event-a", owner, {
        action: "register",
        params: { wallets: [bob.wallet] },
      }),
      /recovered or refunded/,
    );
    await assert.rejects(
      w.createDraft("event-a", owner, {
        action: "register",
        params: { wallets: [alice.wallet, alice.wallet] },
      }),
      /unique valid/,
    );
    const afterB = await w.state("event-b");
    assert.equal(afterB.fingerprint, beforeB.fingerprint);
  } finally {
    await w.close();
  }
});
