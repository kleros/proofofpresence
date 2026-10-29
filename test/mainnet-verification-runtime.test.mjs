// Synthetic decoded RPC responses only: no public RPC, wallets, journal or real sends.
import test from "node:test";
import assert from "node:assert/strict";
import { FetchResponse } from "ethers";
import { readOnlyMainnetRpc } from "../scripts/mainnet/verify-kleros.mjs";
import {
  createVerificationRuntime,
  VerificationError,
  allowedVerificationMethod,
} from "../scripts/mainnet/verification-runtime.mjs";

const h = (n) => "0x" + n.toString(16).padStart(64, "0");
const a = (n) => "0x" + n.toString(16).padStart(40, "0");
const q = (n) => "0x" + n.toString(16);
const block = (n, hash = h(n)) => ({
  number: q(n),
  hash,
  timestamp: q(100 + n),
});
const transactionHash = h(100);
const expected = {
  from: a(1),
  to: a(2),
  data: "0x1234",
  value: "17",
  nonce: 2,
  chainId: 1,
};
const tx = () => ({
  hash: transactionHash,
  from: a(1),
  to: a(2),
  input: "0x1234",
  value: "0x11",
  nonce: "0x2",
  chainId: "0x1",
  blockNumber: "0x9",
  blockHash: h(9),
});
const receipt = () => ({
  transactionHash,
  status: "0x1",
  blockNumber: "0x9",
  blockHash: h(9),
  logs: [],
});
const noSleep = async () => {};
const hasCode = (code) => (error) =>
  error instanceof VerificationError && error.code === code;
function fixture(override, options = {}) {
  const calls = [];
  const send = async (method, params) => {
    calls.push({ method, params: structuredClone(params) });
    if (override) {
      const result = await override(method, params);
      if (result !== undefined) return result;
    }
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber")
      return block(params[0] === "latest" ? 10 : Number(BigInt(params[0])));
    if (method === "eth_getTransactionReceipt") return receipt();
    if (method === "eth_getTransactionByHash") return tx();
    if (["eth_getBalance", "eth_gasPrice", "eth_estimateGas"].includes(method))
      return "0x11";
    if (method === "eth_call" || method === "eth_getCode") return "0x";
    if (method === "eth_getLogs") return [];
    throw Error("Unexpected synthetic request");
  };
  return {
    calls,
    runtime: createVerificationRuntime({ send, sleep: noSleep, ...options }),
  };
}

test("transient timeout,429,5xx and network reads retry within a fixed budget without exposing payloads", async () => {
  for (const fault of [
    { code: "TIMEOUT" },
    { status: 429 },
    { status: 503 },
    { code: "ECONNRESET" },
  ]) {
    let attempts = 0;
    const { runtime, calls } = fixture((method) => {
      if (method === "eth_getBalance" && ++attempts < 3)
        throw Object.assign(
          Error(
            "SENSITIVE_SYNTHETIC_SENTINEL https://credential.invalid signed-bytes",
          ),
          fault,
        );
    });
    assert.equal(
      await runtime.request("eth_getBalance", [a(1), "latest"], {
        phase: "payments",
      }),
      "0x11",
    );
    assert.equal(calls.filter((c) => c.method === "eth_getBalance").length, 3);
    assert.equal(runtime.diagnostics.length, 2);
    assert.ok(
      runtime.diagnostics.every((d) => d.phase === "payments" && d.retry),
    );
    assert.doesNotMatch(
      JSON.stringify(runtime.diagnostics),
      /SENSITIVE|credential|signed-bytes|params|https/,
    );
  }
});

test("hung transport attempts time out and stop at maxAttempts", async () => {
  const { runtime, calls } = fixture(
    (method) =>
      method === "eth_getBalance" ? new Promise(() => {}) : undefined,
    { maxAttempts: 2, timeoutMs: 3 },
  );
  await assert.rejects(
    runtime.request("eth_getBalance", [a(1)]),
    (error) => hasCode("RPC_TIMEOUT")(error) && error.attempts === 2,
  );
  assert.equal(calls.filter((c) => c.method === "eth_getBalance").length, 2);
  assert.equal(runtime.diagnostics.at(-1).retry, false);
});

test("actual ethers HTTP error objects retain retryable429/503 classifications", async () => {
  for (const status of [429, 503]) {
    let fault;
    try {
      new FetchResponse(
        status,
        "Synthetic unavailable",
        {},
        new Uint8Array(),
      ).assertOk();
    } catch (error) {
      fault = error;
    }
    assert.ok(fault);
    let attempts = 0;
    const { runtime } = fixture((method) => {
      if (method === "eth_getBalance" && ++attempts === 1) throw fault;
    });
    assert.equal(await runtime.request("eth_getBalance", [a(1)]), "0x11");
    assert.equal(attempts, 2);
    assert.equal(
      runtime.diagnostics[0].code,
      status === 429 ? "RPC_RATE_LIMIT" : "RPC_UNAVAILABLE",
    );
  }
});

test("mainnet single-attempt HTTP adapter preserves retry classifications without public network access", async () => {
  for (const status of [429, 503]) {
    let reads = 0;
    const transport = readOnlyMainnetRpc("https://synthetic.invalid", {
      fetcher: async (_, options) => {
        const body = JSON.parse(options.body);
        if (body.method === "eth_getBalance" && ++reads === 1)
          return { ok: false, status };
        return {
          ok: true,
          json: async () => ({
            result: body.method === "eth_chainId" ? "0x1" : "0x11",
          }),
        };
      },
    });
    const runtime = createVerificationRuntime({
      send: transport.request,
      sleep: noSleep,
    });
    assert.equal(
      await runtime.request("eth_getBalance", [a(1), "latest"]),
      "0x11",
    );
    assert.equal(reads, 2);
    assert.equal(
      runtime.diagnostics[0].code,
      status === 429 ? "RPC_RATE_LIMIT" : "RPC_UNAVAILABLE",
    );
  }
});

test("business reverts and ambiguous execution errors never retry even with a server status", async () => {
  for (const fault of [
    { code: "CALL_EXCEPTION", status: 503 },
    { error: { code: 3 }, status: 503 },
    { error: { code: -32000 }, status: 503 },
    { error: { code: -32602 }, status: 429 },
    { code: -32005 },
    { error: { code: -32005 }, status: 503 },
  ]) {
    const { runtime, calls } = fixture((method) => {
      if (method === "eth_call") throw fault;
    });
    await assert.rejects(
      runtime.request("eth_call", [{ to: a(1), data: "0x" }, "latest"]),
      (error) => ["RPC_REVERT", "RPC_READ_FAILED"].includes(error.code),
    );
    assert.equal(calls.filter((c) => c.method === "eth_call").length, 1);
  }
});

test("mutable/private RPC methods are rejected before any transport access", async () => {
  const { runtime, calls } = fixture();
  for (const method of [
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "eth_sign",
    "personal_sign",
    "eth_accounts",
    "eth_signTransaction",
    "wallet_switchEthereumChain",
    "evm_mine",
    "evm_increaseTime",
    "__proto__",
  ]) {
    assert.equal(allowedVerificationMethod(method), false);
    await assert.rejects(
      runtime.request(method, ["SYNTHETIC_SECRET"]),
      hasCode("FORBIDDEN_METHOD"),
    );
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(Object.keys(runtime).sort(), [
    "canonicalSnapshot",
    "cleanup",
    "diagnostics",
    "request",
    "verifyExistingReceipt",
  ]);
});

test("wrong chain stops before the requested read; gas quotes and estimation remain read-only capabilities", async () => {
  const wrong = fixture((method) =>
    method === "eth_chainId" ? "0x64" : undefined,
  );
  await assert.rejects(
    wrong.runtime.request("eth_getBalance", [a(1)]),
    hasCode("WRONG_CHAIN"),
  );
  assert.deepEqual(
    wrong.calls.map((c) => c.method),
    ["eth_chainId"],
  );
  const { runtime, calls } = fixture();
  assert.equal(await runtime.request("eth_gasPrice"), "0x11");
  assert.equal(
    await runtime.request("eth_estimateGas", [
      { from: a(1), to: a(2), data: "0x1234" },
    ]),
    "0x11",
  );
  assert.ok(calls.every((c) => allowedVerificationMethod(c.method)));
});

test("a provider chain change during a transient failure stops before the retry read", async () => {
  let chain = "0x1",
    reads = 0;
  const { runtime } = fixture((method) => {
    if (method === "eth_chainId") return chain;
    if (method === "eth_getBalance") {
      reads++;
      chain = "0x64";
      throw { code: "TIMEOUT" };
    }
  });
  await assert.rejects(
    runtime.request("eth_getBalance", [a(1)]),
    hasCode("WRONG_CHAIN"),
  );
  assert.equal(reads, 1);
});

test("snapshot pins state and log reads to one canonical block without mutating caller parameters", async () => {
  const { runtime, calls } = fixture(),
    filter = { address: a(1), fromBlock: "0x0", toBlock: "latest" };
  const snapshot = await runtime.canonicalSnapshot(
    "payments",
    async (head, { request }) => {
      assert.equal(head.number, 10);
      const balance = await request("eth_getBalance", [a(1), "latest"]);
      await request("eth_call", [{ to: a(1), data: "0x1234" }]);
      await request("eth_getLogs", [filter]);
      return balance;
    },
  );
  assert.equal(snapshot.result, "0x11");
  assert.equal(snapshot.restarts, 0);
  assert.equal(snapshot.block.hash, h(10));
  assert.equal(filter.toBlock, "latest");
  assert.equal(
    calls.find((c) => c.method === "eth_getBalance").params[1],
    "0xa",
  );
  assert.equal(calls.find((c) => c.method === "eth_call").params[1], "0xa");
  assert.equal(
    calls.find((c) => c.method === "eth_getLogs").params[0].toBlock,
    "0xa",
  );
});

test("a reorg discards the entire group and only returns a new stable snapshot", async () => {
  let heads = 0,
    groups = 0;
  const { runtime, calls } = fixture((method, params) => {
    if (method === "eth_getBlockByNumber") {
      if (params[0] === "latest") return block(++heads === 1 ? 10 : 11);
      if (params[0] === "0xa") return block(10, h(999));
    }
    if (method === "eth_getBalance") return params[1] === "0xa" ? "0x1" : "0x2";
  });
  const result = await runtime.canonicalSnapshot(
    "snapshot",
    async (_, { request }) => {
      groups++;
      return request("eth_getBalance", [a(1)]);
    },
  );
  assert.equal(groups, 2);
  assert.equal(result.restarts, 1);
  assert.equal(result.result, "0x2");
  assert.deepEqual(
    calls.filter((c) => c.method === "eth_getBalance").map((c) => c.params[1]),
    ["0xa", "0xb"],
  );
  assert.equal(runtime.diagnostics[0].code, "SNAPSHOT_REORG");
});

test("snapshot header mutation cannot relabel already pinned reads", async () => {
  const { runtime, calls } = fixture();
  const result = await runtime.canonicalSnapshot(
    "payments",
    async (head, { request }) => {
      await request("eth_getBalance", [a(1)]);
      assert.ok(Object.isFrozen(head));
      assert.throws(() => {
        head.number = 9;
      }, TypeError);
      assert.throws(() => {
        head.hash = h(9);
      }, TypeError);
      return "pinned-at-ten";
    },
  );
  assert.equal(result.block.number, 10);
  assert.equal(result.block.hash, h(10));
  assert.equal(
    calls.find((c) => c.method === "eth_getBalance").params[1],
    "0xa",
  );
});

test("caller and transport mutation cannot change parameters between read retries", async () => {
  const params = [a(1), "latest"],
    seen = [];
  const runtime = createVerificationRuntime({
    sleep: noSleep,
    send: async (method, args) => {
      if (method === "eth_chainId") {
        params[0] = a(9);
        return "0x1";
      }
      seen.push(structuredClone(args));
      args[0] = a(8);
      if (seen.length === 1) throw { status: 503 };
      return "0x11";
    },
  });
  await runtime.request("eth_getBalance", params);
  assert.deepEqual(seen, [
    [a(1), "latest"],
    [a(1), "latest"],
  ]);
});

test("repeated reorgs exhaust the group budget; incompatible selectors never run or restart", async () => {
  let groups = 0;
  const unstable = fixture(
    (method, params) =>
      method === "eth_getBlockByNumber" && params[0] !== "latest"
        ? block(10, h(999))
        : undefined,
    { maxSnapshotRestarts: 1 },
  );
  await assert.rejects(
    unstable.runtime.canonicalSnapshot("snapshot", async () => {
      groups++;
    }),
    hasCode("SNAPSHOT_REORG"),
  );
  assert.equal(groups, 2);
  for (const [method, params] of [
    ["eth_call", [{ to: a(1), data: "0x" }, "pending"]],
    ["eth_getBalance", [a(1), "0x9"]],
    ["eth_getLogs", [{ toBlock: "0xb" }]],
    ["eth_gasPrice", []],
  ]) {
    const { runtime, calls } = fixture();
    let runs = 0;
    await assert.rejects(
      runtime.canonicalSnapshot("payments", async (_, { request }) => {
        runs++;
        await request(method, params);
      }),
      hasCode("REQUEST_MISMATCH"),
    );
    assert.equal(runs, 1);
    assert.equal(calls.filter((c) => c.method === method).length, 0);
  }
});

test("known receipt verifies exact request, chain, canonical block and observed confirmations", async () => {
  const { runtime, calls } = fixture();
  const result = await runtime.verifyExistingReceipt(transactionHash, expected);
  assert.equal(result.status, "confirmed");
  assert.equal(result.confirmations, 2);
  assert.equal(result.block.number, 9);
  assert.equal(result.snapshotBlock.number, 10);
  assert.equal(result.restarts, 0);
  assert.ok(calls.every((c) => allowedVerificationMethod(c.method)));
});

test("missing, unconfirmed and reverted receipts never prepare, poll or broadcast a replacement", async () => {
  for (const [value, code] of [
    [null, "RECEIPT_MISSING"],
    [
      { ...receipt(), blockNumber: "0xa", blockHash: h(10) },
      "RECEIPT_UNCONFIRMED",
    ],
    [{ ...receipt(), status: "0x0" }, "RECEIPT_REVERTED"],
  ]) {
    const { runtime, calls } = fixture((method) => {
      if (method === "eth_getTransactionReceipt") return value;
      if (
        method === "eth_getTransactionByHash" &&
        code === "RECEIPT_UNCONFIRMED"
      )
        return { ...tx(), blockNumber: "0xa", blockHash: h(10) };
    });
    await assert.rejects(
      runtime.verifyExistingReceipt(transactionHash, expected),
      hasCode(code),
    );
    assert.equal(
      calls.filter((c) => c.method === "eth_getTransactionReceipt").length,
      1,
    );
    assert.ok(calls.every((c) => allowedVerificationMethod(c.method)));
  }
});

test("receipt recovery rejects foreign calldata, sender, recipient, value, nonce and chain", async () => {
  for (const patch of [
    { data: "0x5678" },
    { from: a(9) },
    { to: a(9) },
    { value: "18" },
    { nonce: 3 },
  ]) {
    const { runtime } = fixture();
    await assert.rejects(
      runtime.verifyExistingReceipt(transactionHash, { ...expected, ...patch }),
      hasCode("REQUEST_MISMATCH"),
    );
  }
  const foreign = fixture((method) =>
    method === "eth_getTransactionByHash"
      ? { ...tx(), chainId: "0x64" }
      : undefined,
  );
  await assert.rejects(
    foreign.runtime.verifyExistingReceipt(transactionHash, expected),
    hasCode("REQUEST_MISMATCH"),
  );
  const { runtime } = fixture();
  await assert.rejects(
    runtime.verifyExistingReceipt(transactionHash, {
      ...expected,
      chainId: 100,
    }),
    hasCode("WRONG_CHAIN"),
  );
});

test("receipt request identity is captured before asynchronous verification", async () => {
  const original = { ...expected };
  const { runtime } = fixture((method) => {
    if (method === "eth_chainId") original.from = a(9);
  });
  const result = await runtime.verifyExistingReceipt(transactionHash, original);
  assert.equal(result.transaction.from, expected.from);
  assert.equal(original.from, a(9));
});

test("receipt canonicality mismatch restarts read verification and cannot reuse the old branch", async () => {
  let receipts = 0;
  const { runtime } = fixture((method, params) => {
    if (method === "eth_getTransactionReceipt") {
      receipts++;
      return { ...receipt(), blockHash: receipts === 1 ? h(9) : h(900) };
    }
    if (method === "eth_getTransactionByHash")
      return { ...tx(), blockHash: receipts === 1 ? h(9) : h(900) };
    if (method === "eth_getBlockByNumber" && params[0] === "0x9")
      return block(9, h(900));
  });
  const result = await runtime.verifyExistingReceipt(transactionHash, expected);
  assert.equal(receipts, 2);
  assert.equal(result.restarts, 1);
  assert.equal(result.receipt.blockHash, h(900));
});

test("cleanup failure or timeout has its own result and cannot overwrite confirmed financial evidence", async () => {
  const { runtime } = fixture(undefined, { timeoutMs: 3 });
  const financial = Object.freeze({
    status: "confirmed",
    hash: transactionHash,
  });
  for (const fn of [
    async () => {
      throw Error("SENSITIVE_SYNTHETIC_CLEANUP_PAYLOAD");
    },
    () => new Promise(() => {}),
  ]) {
    const cleanup = await runtime.cleanup(fn);
    assert.equal(cleanup.status, "cleanup-failed");
    assert.equal(cleanup.error.code, "CLEANUP_FAILED");
    assert.equal(financial.status, "confirmed");
    assert.doesNotMatch(JSON.stringify(cleanup), /SENSITIVE|PAYLOAD/);
  }
  assert.deepEqual(await runtime.cleanup(async () => {}), {
    status: "passed",
    phase: "cleanup",
  });
});

test("diagnostics contain only finite classifications and safe phase/method names", async () => {
  const hostile = Object.defineProperty({}, "code", {
    get() {
      throw Error("SENSITIVE_GETTER");
    },
  });
  const { runtime } = fixture((method) => {
    if (method === "eth_call") throw hostile;
  });
  await assert.rejects(
    runtime.request("eth_call", [{ to: a(1), data: "0x" }], {
      phase: "SENSITIVE_PHASE https://secret.invalid",
    }),
    (error) => {
      assert.equal(error.phase, "verification");
      assert.equal(error.code, "RPC_READ_FAILED");
      assert.deepEqual(Object.keys(error.toJSON()).sort(), [
        "attempts",
        "code",
        "method",
        "phase",
      ]);
      assert.doesNotMatch(
        JSON.stringify(error),
        /SENSITIVE|secret|cause|params|https/,
      );
      return true;
    },
  );
  assert.doesNotMatch(
    JSON.stringify(runtime.diagnostics),
    /SENSITIVE|secret|cause|params|https/,
  );
});

test("invalid retry and timeout budgets cannot enable unbounded verification", () => {
  for (const options of [
    { maxAttempts: 0 },
    { maxAttempts: 99 },
    { maxSnapshotRestarts: 9 },
    { timeoutMs: 0 },
    { expectedChainId: 0 },
    { sleep: null },
  ])
    assert.throws(
      () => createVerificationRuntime({ send: async () => "0x1", ...options }),
      hasCode("INVALID_INPUT"),
    );
});
