import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INFURA_READ_METHOD_CREDITS,
  infuraReadMethodCost,
  createRpcReadScheduler,
} from "../src/rpc-read-scheduler.mjs";

const code = (expected) => (error) => error?.code === expected;
const signal = () => new AbortController().signal;
function clock() {
  let at = 0,
    nextId = 0;
  const timers = new Map();
  return {
    now: () => at,
    setTimer(fn, delay) {
      const id = ++nextId;
      timers.set(id, { fn, at: at + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = at + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        at = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      at = target;
    },
    pending: () => timers.size,
  };
}

test("reviewed credit table covers only the application's exact read methods", () => {
  assert.equal(Object.isFrozen(INFURA_READ_METHOD_CREDITS), true);
  assert.deepEqual(Object.entries(INFURA_READ_METHOD_CREDITS), [
    ["eth_chainId", 5],
    ["net_version", 5],
    ["eth_blockNumber", 80],
    ["eth_getBlockByNumber", 80],
    ["eth_getBlockByHash", 80],
    ["eth_getCode", 80],
    ["eth_call", 80],
    ["eth_getStorageAt", 80],
    ["eth_getBalance", 80],
    ["eth_getTransactionCount", 80],
    ["eth_getTransactionByHash", 80],
    ["eth_getTransactionReceipt", 80],
    ["eth_getLogs", 255],
    ["eth_gasPrice", 80],
    ["eth_maxPriorityFeePerGas", 80],
    ["eth_feeHistory", 80],
    ["eth_getProof", 150],
    ["eth_estimateGas", 300],
  ]);
  for (const method of [
    "eth_accounts",
    "personal_sign",
    "eth_sendTransaction",
    "eth_sendRawTransaction",
    "eth_subscribe",
    "__proto__",
  ])
    assert.throws(() => infuraReadMethodCost(method), code("FORBIDDEN_METHOD"));
});

test("parallel reads obey the rolling credit budget and FIFO without altering work or block tags", async () => {
  const time = clock(),
    scheduler = createRpcReadScheduler(time),
    methods = [
      "eth_getLogs",
      "eth_call",
      "eth_getCode",
      "eth_chainId",
      "eth_estimateGas",
      "eth_getProof",
    ],
    requests = methods.map((method, id) => ({
      jsonrpc: "2.0",
      id,
      method,
      params:
        method === "eth_getLogs"
          ? [
              {
                fromBlock: "0x191443e",
                toBlock: "0x1914618",
                topics: ["synthetic-topic"],
              },
            ]
          : [
              { to: "synthetic-address", data: "private-calldata" },
              "0x1914618",
            ],
    })),
    before = structuredClone(requests),
    started = [];
  try {
    const results = requests.map((request) =>
      scheduler.schedule({ method: request.method, signal: signal() }, () => {
        started.push({ at: time.now(), request });
        return request;
      }),
    );
    assert.deepEqual(
      started.map((row) => row.request.method),
      methods.slice(0, 2),
    );
    time.advance(999);
    assert.equal(started.length, 2);
    time.advance(1);
    assert.deepEqual(
      started.map((row) => row.request.method),
      methods.slice(0, 5),
    );
    time.advance(1000);
    const values = await Promise.all(results);
    assert.deepEqual(
      started.map((row) => row.at),
      [0, 0, 1000, 1000, 1000, 2000],
    );
    assert.deepEqual(requests, before);
    values.forEach((value, index) => assert.equal(value, requests[index]));
    for (const row of started) {
      const spent = started
        .filter((item) => item.at > row.at - 1000 && item.at <= row.at)
        .reduce(
          (sum, item) => sum + infuraReadMethodCost(item.request.method),
          0,
        );
      assert.ok(spent <= 400, `rolling credits ${spent}`);
    }
    assert.equal(time.pending(), 0);
  } finally {
    scheduler.close();
  }
});

test("aborting a queued head removes it without charging credits or allowing a late dispatch", async () => {
  const time = clock(),
    scheduler = createRpcReadScheduler(time),
    controller = new AbortController(),
    dispatched = [];
  try {
    await scheduler.schedule({ method: "eth_getLogs", signal: signal() }, () =>
      dispatched.push("first"),
    );
    const blocked = scheduler.schedule(
        { method: "eth_getLogs", signal: controller.signal },
        () => dispatched.push("cancelled"),
      ),
      rejected = assert.rejects(blocked, code("RPC_READ_ABORTED")),
      smaller = scheduler.schedule(
        { method: "eth_call", signal: signal() },
        () => dispatched.push("after-cancel"),
      );
    assert.deepEqual(dispatched, ["first"]);
    controller.abort(new Error("private credential-bearing abort reason"));
    await rejected;
    await smaller;
    assert.deepEqual(dispatched, ["first", "after-cancel"]);
    time.advance(10000);
    assert.deepEqual(dispatched, ["first", "after-cancel"]);
    assert.equal(time.pending(), 0);
  } finally {
    scheduler.close();
  }
});

test("the original timeout signal expires while queued and prevents HTTP work", async () => {
  const scheduler = createRpcReadScheduler();
  let calls = 0;
  try {
    await scheduler.schedule(
      { method: "eth_getLogs", signal: signal() },
      () => calls++,
    );
    const original = AbortSignal.timeout(15);
    await assert.rejects(
      scheduler.schedule(
        { method: "eth_getLogs", signal: original },
        () => calls++,
      ),
      code("RPC_READ_ABORTED"),
    );
    assert.equal(original.aborted, true);
    assert.equal(calls, 1);
  } finally {
    scheduler.close();
  }
});

test("close cancels queued and future reads while leaving already-dispatched work caller-owned", async () => {
  const time = clock(),
    scheduler = createRpcReadScheduler({ ...time, budget: 80 });
  let finish,
    calls = 0;
  const active = scheduler.schedule(
      { method: "eth_call", signal: signal() },
      () => {
        calls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    ),
    queued = scheduler.schedule(
      { method: "eth_getCode", signal: signal() },
      () => calls++,
    ),
    rejected = assert.rejects(queued, code("RPC_SCHEDULER_CLOSED"));
  scheduler.close();
  scheduler.close();
  await rejected;
  await assert.rejects(
    scheduler.schedule({ method: "eth_call", signal: signal() }, () => calls++),
    code("RPC_SCHEDULER_CLOSED"),
  );
  time.advance(10000);
  assert.equal(calls, 1);
  assert.equal(time.pending(), 0);
  const response = { status: 200 };
  finish(response);
  assert.equal(await active, response);
});

test("waiting capacity excludes active work, fails closed on overflow and recovers after abort", async () => {
  const time = clock(),
    scheduler = createRpcReadScheduler({ ...time, budget: 80, maxQueued: 2 }),
    cancel = new AbortController(),
    dispatched = [];
  let finish;
  const active = scheduler.schedule(
    { method: "eth_call", signal: signal() },
    () => {
      dispatched.push("active");
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  try {
    const firstWaiting = scheduler.schedule(
        { method: "eth_call", signal: cancel.signal },
        () => dispatched.push("aborted"),
      ),
      rejected = assert.rejects(firstWaiting, code("RPC_READ_ABORTED")),
      secondWaiting = scheduler.schedule(
        { method: "eth_call", signal: signal() },
        () => dispatched.push("second"),
      );
    await assert.rejects(
      scheduler.schedule({ method: "eth_call", signal: signal() }, () =>
        dispatched.push("overflow-https://private.invalid/secret"),
      ),
      (error) =>
        error.code === "RPC_QUEUE_FULL" &&
        !String(error).includes("private.invalid") &&
        !String(error).includes("secret"),
    );
    assert.deepEqual(
      dispatched,
      ["active"],
      "neither queued job counts as active",
    );
    cancel.abort();
    await rejected;
    const replacement = scheduler.schedule(
        { method: "eth_call", signal: signal() },
        () => dispatched.push("replacement"),
      ),
      closed = assert.rejects(replacement, code("RPC_SCHEDULER_CLOSED"));
    time.advance(1000);
    await secondWaiting;
    assert.deepEqual(dispatched, ["active", "second"]);
    scheduler.close();
    await closed;
    time.advance(10000);
    assert.deepEqual(
      dispatched,
      ["active", "second"],
      "overflow, cancelled and closed work never dispatch later",
    );
    assert.equal(time.pending(), 0);
  } finally {
    scheduler.close();
    finish("already dispatched");
    assert.equal(await active, "already dispatched");
  }
});

test("failed reads consume credits once and explicit retries share the same gate", async () => {
  const time = clock(),
    scheduler = createRpcReadScheduler({ ...time, budget: 80 }),
    originalError = new Error("synthetic transport failure"),
    started = [];
  try {
    await assert.rejects(
      scheduler.schedule({ method: "eth_call", signal: signal() }, () => {
        started.push(time.now());
        throw originalError;
      }),
      (error) => error === originalError,
    );
    const retry = scheduler.schedule(
      { method: "eth_call", signal: signal() },
      () => {
        started.push(time.now());
        return "explicit retry";
      },
    );
    assert.deepEqual(started, [0]);
    time.advance(1000);
    assert.equal(await retry, "explicit retry");
    assert.deepEqual(started, [0, 1000]);
    time.advance(10000);
    assert.deepEqual(
      started,
      [0, 1000],
      "the scheduler never retries work itself",
    );
  } finally {
    scheduler.close();
  }
});

test("invalid bounds, write methods, missing signals and pre-aborted work cannot dispatch or leak diagnostics", async () => {
  for (const options of [
    { budget: 0 },
    { budget: 501 },
    { budget: 1.5 },
    { windowMs: 999 },
    { windowMs: Infinity },
    { maxQueued: 0 },
    { maxQueued: 1025 },
    { maxQueued: 1.5 },
    { maxQueued: NaN },
    { methodCost: 1 },
    { now: () => NaN },
    { setTimer: null },
    { clearTimer: false },
  ])
    assert.throws(
      () => createRpcReadScheduler(options),
      code("INVALID_RPC_SCHEDULE"),
    );
  let calls = 0;
  const scheduler = createRpcReadScheduler({ methodCost: () => 1 }),
    controller = new AbortController(),
    secret = "https://private.invalid/key?secret";
  controller.abort(new Error(secret));
  try {
    for (const method of ["eth_sendRawTransaction", "eth_accounts", secret])
      await assert.rejects(
        scheduler.schedule({ method, signal: signal() }, () => calls++),
        (error) =>
          error.code === "FORBIDDEN_METHOD" && !String(error).includes(secret),
      );
    await assert.rejects(
      scheduler.schedule({ method: "eth_call" }, () => calls++),
      code("INVALID_RPC_SCHEDULE"),
    );
    await assert.rejects(
      scheduler.schedule(
        { method: "eth_call", signal: controller.signal },
        () => calls++,
      ),
      (error) =>
        error.code === "RPC_READ_ABORTED" && !String(error).includes(secret),
    );
    for (const cost of [0, -1, 1.5, NaN, 401]) {
      const invalidCost = createRpcReadScheduler({ methodCost: () => cost });
      await assert.rejects(
        invalidCost.schedule(
          { method: "eth_call", signal: signal() },
          () => calls++,
        ),
        code("INVALID_RPC_SCHEDULE"),
      );
      invalidCost.close();
    }
    assert.equal(calls, 0);
  } finally {
    scheduler.close();
  }
});
