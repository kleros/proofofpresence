// Reviewed Infura Ethereum credit costs, 29 October 2026:
// https://docs.infura.io/get-started/pricing/credit-cost/
// Only the application's explicit read methods are eligible for admission.
export const INFURA_READ_METHOD_CREDITS = Object.freeze({
  eth_chainId: 5,
  net_version: 5,
  eth_blockNumber: 80,
  eth_getBlockByNumber: 80,
  eth_getBlockByHash: 80,
  eth_getCode: 80,
  eth_call: 80,
  eth_getStorageAt: 80,
  eth_getBalance: 80,
  eth_getTransactionCount: 80,
  eth_getTransactionByHash: 80,
  eth_getTransactionReceipt: 80,
  eth_getLogs: 255,
  eth_gasPrice: 80,
  eth_maxPriorityFeePerGas: 80,
  eth_feeHistory: 80,
  eth_getProof: 150,
  eth_estimateGas: 300,
});

function schedulerError(code, message) {
  return Object.assign(new Error(message), { code });
}
const invalid = () =>
  schedulerError("INVALID_RPC_SCHEDULE", "Invalid RPC read scheduling bounds");
const aborted = () =>
  schedulerError("RPC_READ_ABORTED", "RPC read cancelled before admission");
const closedError = () =>
  schedulerError("RPC_SCHEDULER_CLOSED", "RPC read scheduler is closed");

export function infuraReadMethodCost(method) {
  if (!Object.hasOwn(INFURA_READ_METHOD_CREDITS, method))
    throw schedulerError(
      "FORBIDDEN_METHOD",
      "RPC scheduler accepts read methods only",
    );
  return INFURA_READ_METHOD_CREDITS[method];
}

/**
 * One provider-local FIFO gate for actual HTTP dispatches. Credits count at work
 * start in the rolling interval (now - windowMs, now], including failed requests.
 * The caller creates its timeout AbortSignal BEFORE scheduling and passes that
 * same signal to fetch. No payloads, responses, credentials or retry state are
 * retained here. maxQueued bounds waiting work separately from admitted work.
 * close() cancels queued work; admitted work remains caller-owned.
 */
export function createRpcReadScheduler({
  budget = 400,
  windowMs = 1000,
  maxQueued = 64,
  methodCost = infuraReadMethodCost,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (
    !Number.isSafeInteger(budget) ||
    budget < 1 ||
    budget > 500 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1000 ||
    windowMs > 60000 ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 1 ||
    maxQueued > 1024 ||
    typeof methodCost !== "function" ||
    typeof now !== "function" ||
    typeof setTimer !== "function" ||
    typeof clearTimer !== "function"
  )
    throw invalid();

  let lastTime = -Infinity;
  const clock = () => {
    const value = now();
    if (!Number.isFinite(value) || value < 0) throw invalid();
    return (lastTime = Math.max(lastTime, value));
  };
  clock();
  const queue = [],
    credits = [];
  let timer = null,
    closed = false,
    pumping = false;
  const clearWakeup = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const remove = (entry) => {
    entry.queued = false;
    entry.signal.removeEventListener("abort", entry.onAbort);
  };
  function pump() {
    if (pumping || closed) return;
    pumping = true;
    clearWakeup();
    try {
      while (!closed && queue.length) {
        const entry = queue[0];
        if (entry.signal.aborted) {
          queue.shift();
          remove(entry);
          entry.reject(aborted());
          continue;
        }
        const at = clock();
        while (credits.length && credits[0].at + windowMs <= at)
          credits.shift();
        const spent = credits.reduce((sum, item) => sum + item.cost, 0);
        if (spent + entry.cost > budget) {
          let released = 0,
            wakeAt;
          for (const credit of credits) {
            released += credit.cost;
            if (spent - released + entry.cost <= budget) {
              wakeAt = credit.at + windowMs;
              break;
            }
          }
          timer = setTimer(pump, Math.max(1, Math.ceil(wakeAt - at)));
          break;
        }
        queue.shift();
        remove(entry);
        credits.push({ at, cost: entry.cost });
        try {
          Promise.resolve(entry.work()).then(entry.resolve, entry.reject);
        } catch (error) {
          entry.reject(error);
        }
      }
    } finally {
      pumping = false;
    }
  }
  return Object.freeze({
    schedule(options, work) {
      return new Promise((resolve, reject) => {
        if (closed) return reject(closedError());
        const { method, signal } = options ?? {};
        let cost;
        try {
          // An injected cost function cannot admit accounts, signing or writes.
          infuraReadMethodCost(method);
          cost = methodCost(method);
          if (
            !Number.isSafeInteger(cost) ||
            cost < 1 ||
            cost > budget ||
            !(signal instanceof AbortSignal) ||
            typeof work !== "function"
          )
            throw invalid();
        } catch (error) {
          return reject(error?.code === "FORBIDDEN_METHOD" ? error : invalid());
        }
        if (signal.aborted) return reject(aborted());
        if (queue.length >= maxQueued)
          return reject(
            schedulerError("RPC_QUEUE_FULL", "RPC read queue capacity reached"),
          );
        const entry = { cost, signal, work, resolve, reject, queued: true };
        entry.onAbort = () => {
          if (!entry.queued) return;
          const index = queue.indexOf(entry);
          if (index !== -1) queue.splice(index, 1);
          remove(entry);
          reject(aborted());
          pump();
        };
        signal.addEventListener("abort", entry.onAbort, { once: true });
        queue.push(entry);
        pump();
      });
    },
    close() {
      if (closed) return;
      closed = true;
      clearWakeup();
      for (const entry of queue.splice(0)) {
        remove(entry);
        entry.reject(closedError());
      }
      credits.length = 0;
    },
  });
}
