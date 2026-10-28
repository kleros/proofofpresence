import { test } from "node:test";
import assert from "node:assert/strict";
import { createBatchPendingJournal } from "../public/batch-pending.js";

const origin = "https://synthetic-workbench.example.test";
const scope = {
  eventId: "event-a",
  instanceId: "instance-first",
  wallet: "0x" + "1".repeat(40),
  chainId: 10200,
  contract: "0x" + "2".repeat(40),
  contractVersion: "kleros-event-v8",
  action: "approve-admission",
};
const marker = () => ({
  version: 1,
  scope,
  id: "opaque-reviewed-token",
  nonce: "unique-request-1234",
  items: [{ participantId: "person-a", wallet: "0x" + "3".repeat(40) }],
  selectedCount: 1,
  phase: "submitting",
});
const storage = () => {
  const data = new Map();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
};

test("batch pending intent survives reload and external-backend restart without contacts or proof fabrication", () => {
  const store = storage(),
    first = createBatchPendingJournal(store, { origin });
  first.save(scope, {
    ...marker(),
    name: "Private contact",
    email: "private@example.test",
    signature: "private-signature",
    items: [
      {
        ...marker().items[0],
        name: "Private contact",
        email: "private@example.test",
      },
    ],
  });
  const raw = [...store.data.values()][0];
  for (const forbidden of [
    "Private contact",
    "private@example.test",
    "private-signature",
  ])
    assert.equal(raw.includes(forbidden), false);
  const reloaded = createBatchPendingJournal(store, { origin });
  const recovered = reloaded.load({
    ...scope,
    instanceId: "instance-restarted",
  });
  assert.equal(recovered.id, marker().id);
  assert.equal(recovered.scope.instanceId, "instance-first");
  assert.equal(recovered.phase, "submitting");
  assert.equal("result" in recovered, false);
  reloaded.save(scope, { ...marker(), phase: "unknown" });
  assert.equal(reloaded.load(scope).phase, "unknown");
  assert.equal(reloaded.remove(scope, "another-token"), false);
  assert.equal(reloaded.load(scope).id, marker().id);
  assert.equal(reloaded.remove(scope, marker().id), true);
  assert.equal(reloaded.load(scope), null);
});

test("pending batch scope isolates wallet/event/contract/chain/action/origin and ephemeral local resets", () => {
  const store = storage(),
    journal = createBatchPendingJournal(store, { origin });
  journal.save(scope, marker());
  for (const change of [
    { eventId: "event-b" },
    { wallet: "0x" + "4".repeat(40) },
    { contract: "0x" + "5".repeat(40) },
    { chainId: 1337 },
    { action: "check-in" },
  ])
    assert.equal(journal.load({ ...scope, ...change }), null);
  assert.equal(
    createBatchPendingJournal(store, {
      origin: "https://another.example.test",
    }).load(scope),
    null,
  );
  const local = { ...scope, chainId: 1337 };
  journal.save(local, { ...marker(), scope: local });
  assert.equal(journal.load({ ...local, instanceId: "new-local-world" }), null);
});

test("an unresolved batch cannot be overwritten, corrupted or silently dropped", () => {
  const store = storage(),
    journal = createBatchPendingJournal(store, { origin });
  journal.save(scope, marker());
  for (const changed of [
    { id: "new-token" },
    { nonce: "another-request-5678" },
    {
      items: [
        { participantId: "another-person", wallet: "0x" + "6".repeat(40) },
      ],
    },
  ])
    assert.throws(
      () => journal.save(scope, { ...marker(), ...changed }),
      /could not be verified/,
    );
  const key = [...store.data.keys()][0];
  store.data.set(key, "{broken");
  assert.throws(() => journal.load(scope), /could not be verified/);
  assert.equal(store.data.has(key), true);
  assert.throws(
    () => journal.remove(scope, marker().id),
    /could not be verified/,
  );
});

test("storage failures cannot masquerade as a safely journaled commit", () => {
  const broken = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  assert.throws(
    () => createBatchPendingJournal(broken, { origin }).save(scope, marker()),
    /could not be verified/,
  );
  const denied = {
    ...broken,
    setItem() {
      throw new Error("Storage unavailable");
    },
  };
  assert.throws(
    () => createBatchPendingJournal(denied, { origin }).save(scope, marker()),
    /Storage unavailable/,
  );
});
