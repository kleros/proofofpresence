// Pure synthetic receipt transport/clock tests. No socket, provider or chain is contacted.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTransactionJournal,
  submitWalletDraft,
  waitForTransactionReceipt,
} from "../public/transaction-context.js";

const HASH = "0x" + "a".repeat(64), OTHER_HASH = "0x" + "b".repeat(64);
const WALLET = "0x" + "1".repeat(40), CONTRACT = "0x" + "2".repeat(40);
const CONTEXT = Object.freeze({
  eventId: "synthetic-event-a", wallet: WALLET, contract: CONTRACT,
  chainId: 1337, abiVersion: "truth-pays-v7", mode: "local-demo",
  instanceId: "synthetic-receipt-server",
});
const pending = (patch = {}) => ({
  status: "pending", hash: HASH, eventId: CONTEXT.eventId,
  wallet: WALLET, chainId: 1337, ...patch,
});
const terminal = (status = "confirmed", patch = {}) =>
  pending({ status, blockNumber: 42, ...patch });
const code = (expected) => (error) => error.code === expected;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.fail("Synthetic asynchronous receipt checkpoint was not reached");
}
const flush = () => new Promise(setImmediate);
function clock() {
  let time = 1000, nextId = 0;
  const timers = new Map();
  return {
    timers,
    settings: {
      now: () => time,
      setTimer: (callback, delay) => {
        const id = ++nextId;
        timers.set(id, { callback, at: time + delay, delay });
        return id;
      },
      clearTimer: (id) => timers.delete(id),
    },
    now: () => time,
    setTime: (next) => { time = next; },
    advance: (amount) => {
      time += amount;
      for (const [id, timer] of [...timers]) {
        if (timer.at > time) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    fire: (id) => {
      const timer = timers.get(id);
      assert.ok(timer, "Synthetic timer exists");
      timers.delete(id);
      timer.callback();
    },
  };
}
const options = (f, patch = {}) => ({
  context: CONTEXT, hash: HASH, check: async () => terminal(),
  ...f.settings, ...patch,
});

test("pending receipts use one immediate and six serial backed-off checks, then stop", async () => {
  const f = clock(), seen = [];
  let records = 0, active = 0, maxActive = 0;
  const waiting = waitForTransactionReceipt(options(f, {
    record: async () => { records++; },
    check: async () => {
      maxActive = Math.max(maxActive, ++active);
      seen.push(f.now());
      await Promise.resolve();
      active--;
      return pending();
    },
  }));
  const stopped = assert.rejects(waiting, code("TRANSACTION_RECEIPT_LIMIT"));
  await until(() => seen.length === 1 && f.timers.size === 2);
  for (const [index, delay] of [3000, 5000, 10000, 15000, 30000, 30000].entries()) {
    f.advance(delay - 1);
    await flush();
    assert.equal(seen.length, index + 1);
    f.advance(1);
    await until(() => seen.length === index + 2 && (index === 5 || f.timers.size === 2));
  }
  await stopped;
  assert.deepEqual(seen, [1000, 4000, 9000, 19000, 34000, 64000, 94000]);
  assert.equal(records, 1);
  assert.equal(maxActive, 1);
  assert.equal(f.timers.size, 0);
  f.advance(300000);
  await flush();
  assert.equal(seen.length, 7);
});

test("only pending responses and explicit TX_PENDING retry before canonical success", async () => {
  const f = clock();
  let calls = 0;
  const result = waitForTransactionReceipt(options(f, {
    check: async () => {
      calls++;
      if (calls === 1) throw Object.assign(Error("Not mined"), { code: "TX_PENDING" });
      return calls === 2 ? pending() : terminal();
    },
  }));
  await until(() => calls === 1 && f.timers.size === 2);
  f.advance(3000);
  await until(() => calls === 2 && f.timers.size === 2);
  f.advance(5000);
  assert.deepEqual(await result, terminal());
  assert.equal(calls, 3);
  assert.equal(f.timers.size, 0);
});

test("hung submitted acknowledgment consumes the same overall deadline without starting receipt reads", async () => {
  const f = clock(), held = deferred();
  let records = 0, checks = 0, signal;
  const waiting = waitForTransactionReceipt(options(f, {
    record: (currentSignal) => { records++; signal = currentSignal; return held.promise; },
    check: async () => { checks++; return terminal(); },
  }));
  const stopped = assert.rejects(waiting, code("TRANSACTION_RECEIPT_LIMIT"));
  await until(() => records === 1);
  f.advance(180000);
  await stopped;
  assert.equal(signal.aborted, true);
  assert.equal(checks, 0);
  held.resolve();
  await flush();
  assert.equal(checks, 0, "A late acknowledgment cannot restart stopped checking");
  assert.equal(records, 1);
  assert.equal(f.timers.size, 0);
});

test("hung receipt/body read is bounded, aborted once, and late rejection cannot start another read", async () => {
  const f = clock(), held = deferred();
  let calls = 0, aborts = 0;
  const waiting = waitForTransactionReceipt(options(f, {
    check: (signal) => {
      calls++;
      signal.addEventListener("abort", () => { aborts++; });
      return held.promise;
    },
  }));
  const stopped = assert.rejects(waiting, code("TRANSACTION_RECEIPT_LIMIT"));
  await until(() => calls === 1);
  f.advance(180000);
  await stopped;
  assert.equal(aborts, 1);
  held.reject(Error("Late synthetic body read failure"));
  await flush();
  f.advance(300000);
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
});

test("time spent recording the original hash is not reset for the following receipt read", async () => {
  const f = clock(), acknowledgment = deferred(), receipt = deferred();
  let records = 0, checks = 0;
  const waiting = waitForTransactionReceipt(options(f, {
    record: () => { records++; return acknowledgment.promise; },
    check: () => { checks++; return receipt.promise; },
  }));
  const stopped = assert.rejects(waiting, code("TRANSACTION_RECEIPT_LIMIT"));
  await until(() => records === 1);
  f.advance(179000);
  acknowledgment.resolve();
  await until(() => checks === 1);
  f.advance(1000);
  await stopped;
  assert.equal(records, 1);
  assert.equal(checks, 1);
  assert.equal(f.timers.size, 0);
  receipt.resolve(terminal());
  await flush();
});

test("a failed submitted acknowledgment is never retried as a receipt poll", async () => {
  const f = clock(), cause = Object.assign(Error("Acknowledgment unavailable"), { code: "TX_PENDING" });
  let records = 0, checks = 0;
  await assert.rejects(waitForTransactionReceipt(options(f, {
    record: async () => { records++; throw cause; },
    check: async () => { checks++; return terminal(); },
  })), (error) => error === cause);
  assert.equal(records, 1);
  assert.equal(checks, 0);
  assert.equal(f.timers.size, 0);
});

test("a record fallback checks elapsed budget even when the deadline timer was throttled", async () => {
  const f = clock(), acknowledgment = deferred();
  let records = 0, fallbacks = 0, checks = 0;
  const waiting = waitForTransactionReceipt(options(f, {
    record: async (_signal, assertBudget) => {
      records++;
      try {
        await acknowledgment.promise;
      } catch (cause) {
        assert.equal(cause.code, "DRAFT_SCOPE");
        assertBudget();
        fallbacks++;
      }
    },
    check: async () => { checks++; return terminal(); },
  }));
  const stopped = assert.rejects(waiting, code("TRANSACTION_RECEIPT_LIMIT"));
  await until(() => records === 1);
  f.setTime(181001); // The timer cannot enforce the limit until the browser resumes it.
  acknowledgment.reject(Object.assign(Error("Old review scope"), { code: "DRAFT_SCOPE" }));
  await stopped;
  assert.equal(records, 1);
  assert.equal(fallbacks, 0, "No recovery request may start after the elapsed budget");
  assert.equal(checks, 0);
  assert.equal(f.timers.size, 0);
});

test("late terminal response cannot confirm after elapsed deadline even when timer delivery is delayed", async () => {
  const f = clock(), held = deferred();
  let calls = 0;
  const waiting = waitForTransactionReceipt(options(f, { check: () => { calls++; return held.promise; } }));
  const stopped = assert.rejects(waiting, code("TRANSACTION_RECEIPT_LIMIT"));
  await until(() => calls === 1);
  f.setTime(181001); // Deliberately do not deliver the overdue timeout callback.
  held.resolve(terminal());
  await stopped;
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
});

test("a delayed backoff callback rechecks its budget before another request", async () => {
  const f = clock();
  let calls = 0;
  const waiting = waitForTransactionReceipt(options(f, { check: async () => { calls++; return pending(); } }));
  const stopped = assert.rejects(waiting, code("TRANSACTION_RECEIPT_LIMIT"));
  await until(() => calls === 1 && f.timers.size === 2);
  const next = [...f.timers].find(([, timer]) => timer.delay === 3000)?.[0];
  assert.ok(next);
  f.setTime(181001);
  f.fire(next);
  await stopped;
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
});

test("clock rollback stops checking without interpreting the transaction as failed", async () => {
  const f = clock(), held = deferred();
  let checks = 0;
  const waiting = waitForTransactionReceipt(options(f, {
    record: () => held.promise,
    check: async () => { checks++; return terminal(); },
  }));
  const stopped = assert.rejects(waiting, code("TRANSACTION_RECEIPT_UNAVAILABLE"));
  await until(() => f.timers.size === 1);
  f.setTime(999);
  held.resolve();
  await stopped;
  assert.equal(checks, 0);
  assert.equal(f.timers.size, 0);
});

test("network, authentication, scope, mismatch and reorg errors stop without automatic retry", async (t) => {
  for (const reason of ["NETWORK_UNAVAILABLE", "UNAUTHENTICATED", "DRAFT_SCOPE", "TX_MISMATCH", "TX_REORG"]) {
    await t.test(reason, async () => {
      const f = clock(), cause = Object.assign(Error(reason), { code: reason });
      let calls = 0;
      await assert.rejects(waitForTransactionReceipt(options(f, {
        check: async () => { calls++; throw cause; },
      })), (error) => error === cause);
      assert.equal(calls, 1);
      assert.equal(f.timers.size, 0);
    });
  }
});

test("pending facts for another hash, event, wallet or chain cannot authorize another retry", async (t) => {
  for (const patch of [
    { hash: OTHER_HASH }, { eventId: "synthetic-event-b" },
    { wallet: CONTRACT }, { chainId: 1 }, { hash: undefined }, { contract: WALLET },
  ]) {
    await t.test(Object.keys(patch)[0] + String(Object.values(patch)[0]), async () => {
      const f = clock();
      let calls = 0;
      await assert.rejects(waitForTransactionReceipt(options(f, {
        check: async () => { calls++; return pending(patch); },
      })), code("TRANSACTION_CONFIRMATION_MISMATCH"));
      assert.equal(calls, 1);
      assert.equal(f.timers.size, 0);
    });
  }
});

test("unknown receipt state stops as unconfirmed rather than guessing a terminal outcome", async () => {
  const f = clock();
  let calls = 0;
  await assert.rejects(waitForTransactionReceipt(options(f, {
    check: async () => { calls++; return pending({ status: "unknown" }); },
  })), code("TRANSACTION_UNCONFIRMED"));
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
});

test("pending facts from another review stop before another receipt request", async () => {
  const f = clock();
  let calls = 0;
  await assert.rejects(waitForTransactionReceipt(options(f, {
    draftId: "original-reviewed-draft",
    check: async () => { calls++; return pending({ draftId: "another-reviewed-draft" }); },
  })), code("TRANSACTION_CONFIRMATION_MISMATCH"));
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
});

test("explicit caller stop aborts the factual read without another request or chain-failure claim", async () => {
  const f = clock(), held = deferred(), controller = new AbortController();
  let calls = 0, signal;
  const waiting = waitForTransactionReceipt(options(f, {
    signal: controller.signal,
    check: (currentSignal) => { calls++; signal = currentSignal; return held.promise; },
  }));
  const stopped = assert.rejects(waiting, code("TRANSACTION_RECEIPT_STOPPED"));
  await until(() => calls === 1);
  controller.abort();
  await stopped;
  assert.equal(signal.aborted, true);
  held.resolve(terminal());
  await flush();
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
});

test("an already stopped caller does not make a submitted acknowledgment or receipt request", async () => {
  const f = clock(), controller = new AbortController();
  let records = 0, checks = 0;
  controller.abort();
  await assert.rejects(waitForTransactionReceipt(options(f, {
    signal: controller.signal,
    record: async () => { records++; },
    check: async () => { checks++; return terminal(); },
  })), code("TRANSACTION_RECEIPT_STOPPED"));
  assert.equal(records, 0);
  assert.equal(checks, 0);
  assert.equal(f.timers.size, 0);
});

function submissionFixture() {
  const values = new Map(), calls = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const draft = {
    id: "synthetic-reviewed-draft", eventId: CONTEXT.eventId, wallet: WALLET,
    chainId: CONTEXT.chainId, contract: CONTRACT, abiVersion: CONTEXT.abiVersion,
    action: "deposit", valueWei: "123",
    transaction: { to: CONTRACT, from: WALLET, data: "0x1234", value: "123", chainId: 1337 },
  };
  return {
    storage, calls, context: CONTEXT, draft, journal: createTransactionJournal(storage),
    validate: async () => draft.transaction,
    provider: { request: async ({ method }) => {
      calls.push(method);
      if (method === "eth_accounts") return [WALLET];
      if (method === "eth_chainId") return "0x539";
      if (method === "eth_sendTransaction") return HASH;
      throw Error("Unexpected synthetic wallet method");
    } },
  };
}

test("elapsed receipt limit preserves the original journal on reload and blocks a second wallet send", async () => {
  const f = clock(), submission = submissionFixture(), held = deferred();
  let checks = 0;
  const waiting = submitWalletDraft({
    ...submission,
    confirm: () => waitForTransactionReceipt(options(f, {
      record: async () => assert.equal(submission.journal.get(CONTEXT, HASH).status, "submitted"),
      check: () => { checks++; return held.promise; },
    })),
  });
  const stopped = assert.rejects(waiting, (error) =>
    error.code === "TRANSACTION_RECEIPT_LIMIT" && error.submittedHash === HASH);
  await until(() => checks === 1);
  f.advance(180000);
  await stopped;
  const reloaded = createTransactionJournal(submission.storage);
  assert.equal(reloaded.get(CONTEXT, HASH).status, "needs-confirmation");
  assert.equal(reloaded.get({ ...CONTEXT, eventId: "synthetic-event-b" }, HASH), null);
  const before = submission.calls.length;
  await assert.rejects(submitWalletDraft({ ...submission, journal: reloaded, confirm: async () => terminal() }),
    (error) => error.code === "TRANSACTION_ALREADY_SUBMITTED" && error.submittedHash === HASH);
  assert.equal(submission.calls.length, before);
  assert.equal(submission.calls.filter((method) => method === "eth_sendTransaction").length, 1);
  held.resolve(terminal());
  await flush();
  assert.equal(reloaded.get(CONTEXT, HASH).status, "needs-confirmation", "A late result does not undo the elapsed limit");
});

test("canonical failed terminal facts still pass through the sender's existing failure validation", async () => {
  const f = clock(), submission = submissionFixture();
  await assert.rejects(submitWalletDraft({
    ...submission, confirm: () => waitForTransactionReceipt(options(f, { check: async () => terminal("failed") })),
  }), (error) => error.code === "TRANSACTION_REVERTED" && error.submittedHash === HASH);
  assert.equal(submission.journal.get(CONTEXT, HASH).status, "failed");
  assert.equal(submission.journal.get(CONTEXT, HASH).blockNumber, 42);
  assert.equal(f.timers.size, 0);
});
