import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createWorkbench } from "../src/workbench.mjs";

// Actual synthetic v8 contracts on loopback Ganache. Only the malformed-history
// test substitutes a local RPC log response; no live service is consulted.
let w, owner, ownerB, people, pinned, originalDetail;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const sent = async (transaction) => (await transaction).wait();
const participant = (detail, person) =>
  detail.participants.find((row) => same(row.wallet, person.wallet));
const ledger = (detail, person) =>
  detail.deposits.find((row) => same(row.wallet, person.wallet));

before(async () => {
  w = await createWorkbench({ rpcPort: 0, contractVersion: "kleros-event-v8" });
  owner = w.session("organizer-a");
  ownerB = w.session("organizer-b");
  people = ["alice", "bob", "carol"].map((name) => w.session(name));
  for (const eventId of ["event-a", "event-b"]) {
    const d = BigInt(w.events.get(eventId).deployment.depositWei);
    for (const person of eventId === "event-a" ? people : people.slice(0, 1)) {
      const receipt = await sent(
        w.contract(eventId).connect(person.signer).deposit({ value: d }),
      );
      await w.linkDeposit(eventId, person, { txHash: receipt.hash });
    }
  }
});
after(async () => { if (w) await w.close(); });

async function observe(read, alter = null) {
  const original = w.provider.send.bind(w.provider), scans = [];
  w.provider.send = async (method, params) => {
    const result = await original(method, params);
    if (method === "eth_getLogs" && !params[0].topics?.length) {
      scans.push(params[0]);
      if (alter) return alter(result, params[0]);
    }
    return result;
  };
  try {
    return { value: await read(), scans };
  } finally {
    w.provider.send = original;
  }
}

function assertScans(scans, eventId, count) {
  const deployment = w.events.get(eventId).deployment;
  assert.equal(scans.length, count);
  assert.ok(scans.every((filter) => same(filter.address, deployment.contract)));
  assert.ok(scans.every((filter) => Number(BigInt(filter.fromBlock)) === deployment.deploymentBlock));
}

test("three linked v8 participants and organizer ledger share one pinned credit replay", async () => {
  pinned = await w.state("event-a");
  const { value, scans } = await observe(() => w.detail("event-a", owner, pinned));
  originalDetail = value;
  assertScans(scans, "event-a", 2);
  assert.ok(scans.every((filter) => Number(BigInt(filter.toBlock)) === pinned.blockNumber));
  assert.equal(value.participants.length, 3);
  assert.equal(value.deposits.length, 3);
  const d = w.events.get("event-a").deployment.depositWei;
  for (const person of people) {
    const p = participant(value, person), credit = ledger(value, person);
    assert.equal(p.deposit.verificationState, "current");
    assert.equal(p.deposit.verified, true);
    assert.equal(credit.pendingCreditWei, d);
    assert.equal(credit.receivedWei, d);
    assert.equal(credit.allocatedWei, "0");
    assert.equal(credit.transactions.length, 1);
    assert.equal(credit.transactions[0].txHash, p.deposit.txHash);
  }
  assert.equal(value.payments.pendingCreditWithdrawnWei, "0");
  assert.deepEqual(value.deposits, await w.depositLedger("event-a", pinned.blockNumber));
  // The old behavior used one complete credit replay per participant, one for
  // the ledger and a separate late payment replay: 3 + 1 + 1 = 5.
});

test("direct latest verification remains fresh and does not inherit the pinned reuse shortcut", async () => {
  const { value, scans } = await observe(() => w.detail("event-a", owner));
  assertScans(scans, "event-a", 5);
  assert.ok(value.participants.every((row) => row.deposit.verified));
});

test("new requests see recovered credit while an older pinned snapshot stays unchanged", async () => {
  const alice = people[0], d = BigInt(w.events.get("event-a").deployment.depositWei);
  await sent(w.contract("event-a").connect(alice.signer).withdrawPending(alice.wallet, d));
  const currentState = await w.state("event-a");
  assert.ok(currentState.blockNumber > pinned.blockNumber);
  const current = await observe(() => w.detail("event-a", owner, currentState));
  assertScans(current.scans, "event-a", 2);
  assert.equal(participant(current.value, alice).deposit.verificationState, "returned");
  assert.equal(participant(current.value, alice).deposit.verified, false);
  assert.equal(ledger(current.value, alice).pendingCreditWei, "0");
  assert.equal(ledger(current.value, alice).returnedWei, String(d));
  assert.equal(current.value.payments.pendingCreditWithdrawnWei, String(d));
  assert.ok(people.slice(1).every((person) => participant(current.value, person).deposit.verified));
  const historical = await observe(() => w.detail("event-a", owner, pinned));
  assertScans(historical.scans, "event-a", 2);
  assert.deepEqual(historical.value, originalDetail);
});

test("the same wallet in another event uses only that event's history", async () => {
  const state = await w.state("event-b");
  const { value, scans } = await observe(() => w.detail("event-b", ownerB, state));
  assertScans(scans, "event-b", 2);
  const alice = people[0], d = w.events.get("event-b").deployment.depositWei;
  assert.equal(participant(value, alice).deposit.verified, true);
  assert.equal(ledger(value, alice).pendingCreditWei, d);
  assert.notEqual(d, w.events.get("event-a").deployment.depositWei);
  assert.equal(value.payments.pendingCreditWithdrawnWei, "0");
  assert.equal(value.deposits.length, 1);
});

test("a rejected reconstruction fails closed and is not retained by the next request", async () => {
  const state = await w.state("event-b"), alice = people[0], c = w.contract("event-b");
  const d = BigInt(w.events.get("event-b").deployment.depositWei);
  const malformed = c.interface.encodeEventLog(c.interface.getEvent("PendingWithdrawn"), [alice.wallet, alice.wallet, 2n * d]);
  await assert.rejects(
    observe(() => w.detail("event-b", ownerB, state), (logs, filter) => {
      if (!same(filter.address, c.target)) return logs;
      assert.ok(logs.length);
      return [...logs, { ...logs.at(-1), ...malformed, logIndex: "0xffff" }];
    }),
    { code: "CREDIT_HISTORY" },
  );
  const recovered = await observe(() => w.detail("event-b", ownerB, state));
  assertScans(recovered.scans, "event-b", 2);
  assert.equal(participant(recovered.value, alice).deposit.verified, true);
  assert.equal(ledger(recovered.value, alice).pendingCreditWei, String(d));
});

test("another server instance with matching synthetic addresses and block height has separate history", async () => {
  const other = await createWorkbench({
    rpcPort: 0,
    contractVersion: "kleros-event-v8",
    serverInstanceId: "request-history-other-synthetic-server",
  });
  try {
    // The deterministic local fixture deliberately collides on event ID,
    // contract address, chain ID, wallet and numeric height across instances.
    assert.equal(other.contract("event-b").target, w.contract("event-b").target);
    const target = (await w.state("event-b")).blockNumber;
    while (await other.provider.getBlockNumber() < target)
      await other.provider.send("evm_mine", []);
    const state = await other.state("event-b");
    assert.equal(state.blockNumber, target);
    const view = await other.detail("event-b", other.session("organizer-b"), state);
    assert.equal(view.deposits.length, 0);
    assert.ok(view.participants.every((row) => row.deposit === null));
    assert.equal(view.payments.pendingCreditWithdrawnWei, "0");
  } finally {
    await other.close();
  }
});
