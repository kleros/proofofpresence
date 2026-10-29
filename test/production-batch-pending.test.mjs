import { test } from "node:test";
import assert from "node:assert/strict";
import { createBatchPendingJournal } from "../public/batch-pending.js";

test("chain1 pending batches remain bound to production mode, backend instance, event and wallet", () => {
  const data = new Map(),
    storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    };
  const journal = createBatchPendingJournal(storage, {
    origin: "https://synthetic.example.invalid",
  });
  const scope = {
    eventId: "production-event",
    instanceId: "server-one",
    wallet: "0x" + "1".repeat(40),
    chainId: 1,
    contract: "0x" + "2".repeat(40),
    contractVersion: "kleros-event-v9-uups",
    mode: "hosted-production",
    action: "approve-admission",
  };
  const marker = {
    version: 1,
    scope,
    id: "reviewed-token",
    nonce: "synthetic-request-123",
    selectedCount: 1,
    items: [{ participantId: "person-a", wallet: "0x" + "3".repeat(40) }],
    phase: "submitting",
  };
  journal.save(scope, marker);
  assert.equal(journal.load(scope).id, marker.id);
  for (const change of [
    { instanceId: "server-two" },
    { eventId: "other-event" },
    { wallet: "0x" + "4".repeat(40) },
    { contract: "0x" + "5".repeat(40) },
    { action: "check-in" },
  ])
    assert.equal(journal.load({ ...scope, ...change }), null);
  for (const mode of [undefined, "hosted-demo", "hosted-testnet", "production"])
    assert.throws(() => journal.load({ ...scope, mode }));
  for (const contractVersion of [
    "truth-pays-v7",
    "kleros-event-v8",
    "kleros-event-v8-test15m",
  ])
    assert.throws(() => journal.load({ ...scope, contractVersion }));
  assert.equal(
    createBatchPendingJournal(storage, {
      origin: "https://other.example.invalid",
    }).load(scope),
    null,
  );
  assert.equal(
    journal.load(scope).phase,
    "submitting",
    "mismatches never erase the original intent",
  );
});
