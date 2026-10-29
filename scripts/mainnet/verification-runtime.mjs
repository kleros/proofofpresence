// Read-only verification capabilities. No wallets, journals, filesystem or broadcasts.
// `send` must return a decoded JSON-RPC result, as ethers provider.send does.
// Use a single-attempt, redirect-disabled transport: a timeout here cannot cancel
// a foreign adapter's hidden retries. Snapshot callbacks must await their reads.
export const VERIFICATION_PHASES = Object.freeze([
  "verification",
  "preflight",
  "deployment",
  "court",
  "snapshot",
  "receipt",
  "payments",
  "settlement",
  "evidence",
  "cleanup",
]);
const phases = new Set(VERIFICATION_PHASES);
const methods = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_call",
  "eth_getLogs",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_estimateGas",
]);
export const allowedVerificationMethod = (method) =>
  typeof method === "string" && methods.has(method);
const codes = new Set([
  "INVALID_INPUT",
  "FORBIDDEN_METHOD",
  "WRONG_CHAIN",
  "RPC_TIMEOUT",
  "RPC_NETWORK",
  "RPC_RATE_LIMIT",
  "RPC_UNAVAILABLE",
  "RPC_REVERT",
  "RPC_READ_FAILED",
  "SNAPSHOT_REORG",
  "REQUEST_MISMATCH",
  "RECEIPT_MISSING",
  "RECEIPT_UNCONFIRMED",
  "RECEIPT_REVERTED",
  "TRANSACTION_MISSING",
  "CLEANUP_FAILED",
]);
const phaseOf = (phase) => (phases.has(phase) ? phase : "verification");
const methodOf = (method) =>
  allowedVerificationMethod(method) ? method : "unsupported";
const hash = (value) =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const address = (value) =>
  typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const bytes = (value) =>
  typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value);
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();

// Never attach the underlying error, cause, URL, request parameters or raw message.
export class VerificationError extends Error {
  constructor(code, { phase, method, attempts = 0 } = {}) {
    const safeCode = codes.has(code) ? code : "RPC_READ_FAILED";
    super(`Verification stopped: ${safeCode}.`);
    this.name = "VerificationError";
    this.code = safeCode;
    this.phase = phaseOf(phase);
    this.method = methodOf(method);
    this.attempts =
      Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0;
  }
  toJSON() {
    return {
      code: this.code,
      phase: this.phase,
      method: this.method,
      attempts: this.attempts,
    };
  }
}
const fail = (code, context) => {
  throw new VerificationError(code, context);
};
function quantity(value, context) {
  if (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "bigint" && value >= 0n) ||
    (typeof value === "string" && /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value))
  )
    return BigInt(value);
  return fail("REQUEST_MISMATCH", context);
}
function integer(value, context) {
  const n = quantity(value, context);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail("REQUEST_MISMATCH", context);
  return Number(n);
}
const tag = (n) => "0x" + n.toString(16);
function header(raw, context) {
  if (!raw || !hash(raw.hash)) fail("REQUEST_MISMATCH", context);
  const number = integer(raw.number, context);
  return Object.freeze({
    number,
    hash: raw.hash,
    ...(raw.timestamp === undefined
      ? {}
      : { timestamp: integer(raw.timestamp, context) }),
  });
}

function errorClass(error) {
  if (error instanceof VerificationError)
    return { code: error.code, transient: false };
  // Classification uses finite codes/statuses only; messages are deliberately ignored.
  const nested = error?.error ?? error?.info?.error ?? error?.cause;
  const code = error?.code,
    rpcCode = nested?.code;
  if (
    code === "CALL_EXCEPTION" ||
    code === "ACTION_REJECTED" ||
    code === 3 ||
    rpcCode === 3
  )
    return { code: "RPC_REVERT", transient: false };
  if (
    [-32000, -32015, -32602].includes(code) ||
    [-32000, -32015, -32602].includes(rpcCode)
  )
    return { code: "RPC_READ_FAILED", transient: false };
  const status = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.response?.statusCode,
    error?.info?.response?.status,
    error?.info?.response?.statusCode,
    error?.info?.responseStatus,
  ].find(
    (v) => typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 599,
  );
  if (status === 429) return { code: "RPC_RATE_LIMIT", transient: true };
  if (code === -32005 || rpcCode === -32005)
    return { code: "RPC_READ_FAILED", transient: false };
  if (status >= 500 && status <= 599)
    return { code: "RPC_UNAVAILABLE", transient: true };
  const transportCode = typeof nested?.code === "string" ? nested.code : code;
  if (
    [
      "TIMEOUT",
      "ETIMEDOUT",
      "ESOCKETTIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
    ].includes(code) ||
    [
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
    ].includes(transportCode) ||
    error?.name === "TimeoutError"
  )
    return { code: "RPC_TIMEOUT", transient: true };
  if (
    [
      "NETWORK_ERROR",
      "ECONNRESET",
      "ECONNREFUSED",
      "EPIPE",
      "EAI_AGAIN",
      "ENOTFOUND",
      "UND_ERR_SOCKET",
    ].includes(transportCode)
  )
    return { code: "RPC_NETWORK", transient: true };
  return { code: "RPC_READ_FAILED", transient: false };
}
function classify(error) {
  try {
    return errorClass(error);
  } catch {
    return { code: "RPC_READ_FAILED", transient: false };
  }
}

export function createVerificationRuntime({
  send,
  expectedChainId = 1,
  maxAttempts = 3,
  maxSnapshotRestarts = 2,
  timeoutMs = 10_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (
    typeof send !== "function" ||
    typeof sleep !== "function" ||
    !Number.isSafeInteger(expectedChainId) ||
    expectedChainId <= 0 ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 5 ||
    !Number.isSafeInteger(maxSnapshotRestarts) ||
    maxSnapshotRestarts < 0 ||
    maxSnapshotRestarts > 3 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  )
    fail("INVALID_INPUT");
  const diagnostics = [];
  const record = (entry) => {
    diagnostics.push(Object.freeze(entry));
    if (diagnostics.length > 256) diagnostics.shift();
  };
  async function read(method, params, phase) {
    const context = { phase, method };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let timer;
      try {
        if (attempt > 1 && method !== "eth_chainId") {
          const chain = await read("eth_chainId", [], phase);
          if (quantity(chain, context) !== BigInt(expectedChainId))
            fail("WRONG_CHAIN", context);
        }
        return await Promise.race([
          Promise.resolve().then(() => send(method, structuredClone(params))),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject({ code: "TIMEOUT" }), timeoutMs);
          }),
        ]);
      } catch (error) {
        const classified = classify(error),
          retry = classified.transient && attempt < maxAttempts;
        record({ phase, method, code: classified.code, attempt, retry });
        if (!retry) fail(classified.code, { ...context, attempts: attempt });
        try {
          await sleep(Math.min(100 * 2 ** (attempt - 1), 1000));
        } catch {
          fail("RPC_READ_FAILED", { ...context, attempts: attempt });
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }
  async function request(method, params = [], { phase = "verification" } = {}) {
    const safePhase = phaseOf(phase),
      context = { phase: safePhase, method };
    if (!allowedVerificationMethod(method)) fail("FORBIDDEN_METHOD", context);
    if (!Array.isArray(params)) fail("INVALID_INPUT", context);
    let parameters;
    try {
      parameters = structuredClone(params);
    } catch {
      fail("INVALID_INPUT", context);
    }
    const chain = await read("eth_chainId", [], safePhase);
    if (quantity(chain, context) !== BigInt(expectedChainId))
      fail("WRONG_CHAIN", context);
    return method === "eth_chainId"
      ? chain
      : read(method, parameters, safePhase);
  }
  function pinnedRequest(block, phase) {
    const blockTag = tag(block.number),
      context = { phase };
    const stateIndex = {
      eth_call: 1,
      eth_getBalance: 1,
      eth_getCode: 1,
      eth_getTransactionCount: 1,
      eth_getStorageAt: 2,
      eth_estimateGas: 1,
    };
    const boundedTag = (selector, defaultTag = blockTag) => {
      if (selector === undefined || selector === "latest") return defaultTag;
      if (selector === "earliest") return "0x0";
      const n = integer(selector, context);
      if (n > block.number) fail("REQUEST_MISMATCH", context);
      return tag(n);
    };
    return async (method, params = []) => {
      if (!allowedVerificationMethod(method))
        fail("FORBIDDEN_METHOD", { phase, method });
      if (!Array.isArray(params)) fail("INVALID_INPUT", { phase, method });
      const args = structuredClone(params);
      if (Object.hasOwn(stateIndex, method)) {
        const i = stateIndex[method],
          selector = args[i];
        if (
          selector !== undefined &&
          selector !== "latest" &&
          selector !== blockTag &&
          selector !== block.number
        )
          fail("REQUEST_MISMATCH", { phase, method });
        args[i] = blockTag;
      } else if (method === "eth_getLogs") {
        const filter = args[0];
        if (!filter || typeof filter !== "object" || Array.isArray(filter))
          fail("INVALID_INPUT", { phase, method });
        if (filter.blockHash !== undefined) {
          if (
            !same(filter.blockHash, block.hash) ||
            filter.fromBlock !== undefined ||
            filter.toBlock !== undefined
          )
            fail("REQUEST_MISMATCH", { phase, method });
        } else {
          filter.fromBlock = boundedTag(filter.fromBlock);
          filter.toBlock = boundedTag(filter.toBlock);
          if (
            quantity(filter.fromBlock, context) >
            quantity(filter.toBlock, context)
          )
            fail("REQUEST_MISMATCH", { phase, method });
        }
      } else if (method === "eth_getBlockByNumber")
        args[0] = boundedTag(args[0]);
      else if (method === "eth_blockNumber") return blockTag;
      else if (
        ["eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory"].includes(
          method,
        )
      )
        fail("REQUEST_MISMATCH", { phase, method }); // Unpinned quotes belong in separate preflight reads.
      const result = await request(method, args, { phase });
      if (
        result &&
        ["eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(
          method,
        ) &&
        result.blockNumber !== null &&
        result.blockNumber !== undefined &&
        integer(result.blockNumber, context) > block.number
      )
        fail("REQUEST_MISMATCH", { phase, method });
      if (
        result &&
        ["eth_getBlockByHash", "eth_getBlockByNumber"].includes(method)
      ) {
        const selected = header(result, context);
        if (
          selected.number > block.number ||
          (method === "eth_getBlockByHash"
            ? !same(selected.hash, args[0])
            : selected.number !== integer(args[0], context))
        )
          fail("REQUEST_MISMATCH", { phase, method });
      }
      return result;
    };
  }
  async function canonicalSnapshot(phase, run) {
    const safePhase = phaseOf(phase),
      context = { phase: safePhase, method: "eth_getBlockByNumber" };
    if (typeof run !== "function") fail("INVALID_INPUT", context);
    for (let restarts = 0; restarts <= maxSnapshotRestarts; restarts++) {
      const block = header(
        await request("eth_getBlockByNumber", ["latest", false], {
          phase: safePhase,
        }),
        context,
      );
      try {
        const result = await run(block, {
          request: pinnedRequest(block, safePhase),
        });
        const current = header(
          await request("eth_getBlockByNumber", [tag(block.number), false], {
            phase: safePhase,
          }),
          context,
        );
        if (current.number !== block.number || !same(current.hash, block.hash))
          fail("SNAPSHOT_REORG", context);
        return { block, result, restarts };
      } catch (error) {
        if (
          !(error instanceof VerificationError) ||
          error.code !== "SNAPSHOT_REORG"
        ) {
          if (error instanceof VerificationError) throw error;
          fail(classify(error).code, { phase: safePhase });
        }
        record({
          phase: safePhase,
          method: "eth_getBlockByNumber",
          code: "SNAPSHOT_REORG",
          attempt: restarts + 1,
          retry: restarts < maxSnapshotRestarts,
        });
        if (restarts === maxSnapshotRestarts) throw error;
      }
    }
  }
  async function verifyExistingReceipt(
    transactionHash,
    expected,
    { confirmations = 2, phase = "receipt" } = {},
  ) {
    const safePhase = phaseOf(phase),
      context = { phase: safePhase, method: "eth_getTransactionReceipt" };
    try {
      expected = structuredClone(expected);
    } catch {
      fail("INVALID_INPUT", context);
    }
    if (
      !hash(transactionHash) ||
      !expected ||
      !address(expected.from) ||
      !(expected.to === null || address(expected.to)) ||
      !bytes(expected.data) ||
      !Number.isSafeInteger(confirmations) ||
      confirmations < 1
    )
      fail("INVALID_INPUT", context);
    const expectedValue = quantity(expected.value, context);
    if (
      expected.chainId !== undefined &&
      quantity(expected.chainId, context) !== BigInt(expectedChainId)
    )
      fail("WRONG_CHAIN", context);
    const snapshot = await canonicalSnapshot(
      safePhase,
      async (head, { request: readAt }) => {
        const receipt = await readAt("eth_getTransactionReceipt", [
          transactionHash,
        ]);
        if (!receipt) fail("RECEIPT_MISSING", context);
        const transaction = await readAt("eth_getTransactionByHash", [
          transactionHash,
        ]);
        if (!transaction) fail("TRANSACTION_MISSING", context);
        if (quantity(receipt.status, context) !== 1n)
          fail("RECEIPT_REVERTED", context);
        const number = integer(receipt.blockNumber, context);
        if (
          !same(receipt.transactionHash ?? receipt.hash, transactionHash) ||
          !same(transaction.hash, transactionHash) ||
          !hash(receipt.blockHash) ||
          !same(transaction.blockHash, receipt.blockHash) ||
          integer(transaction.blockNumber, context) !== number ||
          !same(transaction.from, expected.from) ||
          !(expected.to === null
            ? transaction.to === null
            : same(transaction.to, expected.to)) ||
          !bytes(transaction.input ?? transaction.data) ||
          !same(transaction.input ?? transaction.data, expected.data) ||
          (transaction.input !== undefined &&
            transaction.data !== undefined &&
            !same(transaction.input, transaction.data)) ||
          quantity(transaction.value, context) !== expectedValue ||
          quantity(transaction.chainId, context) !== BigInt(expectedChainId) ||
          (expected.nonce !== undefined &&
            quantity(transaction.nonce, context) !==
              quantity(expected.nonce, context))
        )
          fail("REQUEST_MISMATCH", context);
        const block = header(
          await readAt("eth_getBlockByNumber", [tag(number), false]),
          context,
        );
        if (block.number !== number || !same(block.hash, receipt.blockHash))
          fail("SNAPSHOT_REORG", context);
        const count = head.number - number + 1;
        if (count < confirmations) fail("RECEIPT_UNCONFIRMED", context);
        return {
          status: "confirmed",
          hash: transactionHash,
          receipt,
          transaction,
          block,
          confirmations: count,
        };
      },
    );
    return {
      ...snapshot.result,
      snapshotBlock: snapshot.block,
      restarts: snapshot.restarts,
    };
  }
  async function cleanup(fn, { phase = "cleanup" } = {}) {
    const safePhase = phaseOf(phase);
    let timer;
    try {
      if (typeof fn !== "function") fail("INVALID_INPUT", { phase: safePhase });
      await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new VerificationError("CLEANUP_FAILED", { phase: safePhase }),
              ),
            timeoutMs,
          );
        }),
      ]);
      return { status: "passed", phase: safePhase };
    } catch {
      const error = new VerificationError("CLEANUP_FAILED", {
        phase: safePhase,
      });
      record({
        phase: safePhase,
        method: "unsupported",
        code: error.code,
        attempt: 1,
        retry: false,
      });
      return {
        status: "cleanup-failed",
        phase: safePhase,
        error: error.toJSON(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    request,
    canonicalSnapshot,
    verifyExistingReceipt,
    cleanup,
    get diagnostics() {
      return diagnostics.map((entry) => ({ ...entry }));
    },
  });
}
