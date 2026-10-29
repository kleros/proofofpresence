import { test } from "node:test";
import assert from "node:assert/strict";
import { productionErrorResponse } from "../src/production-errors.mjs";
import { ProductionWalletError } from "../src/production-wallets.mjs";
import { requireThat } from "../src/utils.mjs";

// Public DTO formatting only. No server, provider, mainnet manifest, signing key
// or network connection is created here; root owns server configuration wiring.
const sensitive = [
  "SYNTHETIC_PRIVATE_SIGNATURE_0xdeadbeef",
  "https://operator:private-password@rpc.example.invalid/token-secret",
  "PRIVATE_CALLDATA_0xaabbccddeeff",
  "PRIVATE_AUTH_NONCE_123456789",
];
const payload = sensitive.join(" ");
const generic = {
  status: 503,
  body: {
    error: "The service is temporarily unavailable. Try again later.",
    code: "SERVICE_UNAVAILABLE",
  },
};

function poisoned(code, status = 500) {
  return Object.assign(new Error(payload), {
    code,
    status,
    shortMessage: payload,
    signature: payload,
    calldata: payload,
    cause: { message: payload, signature: payload },
    info: { request: { params: [payload] }, response: { body: payload } },
  });
}

function safeDTO(response) {
  assert.deepEqual(Object.keys(response).sort(), ["body", "status"]);
  assert.deepEqual(Object.keys(response.body).sort(), ["code", "error"]);
  assert.equal(typeof response.body.error, "string");
  assert.equal(typeof response.body.code, "string");
  assert(Number.isInteger(response.status));
  assert(response.status >= 400 && response.status <= 599);
  for (const value of sensitive)
    assert(!JSON.stringify(response).includes(value));
  return response;
}

test("auth errors expose fixed public messages and preserve reviewed401/403 semantics", () => {
  assert.deepEqual(productionErrorResponse(poisoned("UNAUTHENTICATED")), {
    status: 401,
    body: {
      code: "UNAUTHENTICATED",
      error: "Sign in with your wallet before continuing.",
    },
  });
  assert.deepEqual(productionErrorResponse(poisoned("BAD_SIGNATURE")), {
    status: 403,
    body: {
      code: "BAD_SIGNATURE",
      error: "Wallet ownership could not be verified. Authenticate again.",
    },
  });
  assert.deepEqual(productionErrorResponse(poisoned("BAD_NONCE")), {
    status: 403,
    body: {
      code: "BAD_NONCE",
      error: "The sign-in request expired or is invalid. Authenticate again.",
    },
  });
});

test("EOA guard errors keep reviewed typed status without trusting their messages", () => {
  for (const [code, status] of [
    ["INVALID_WALLET", 422],
    ["UNSUPPORTED_WALLET", 422],
    ["WALLET_RPC_UNAVAILABLE", 503],
    ["WALLET_REORG", 409],
  ]) {
    const response = safeDTO(
      productionErrorResponse(new ProductionWalletError(code, status, payload)),
    );
    assert.equal(response.status, status);
    assert.equal(response.body.code, code);
    assert.deepEqual(response, productionErrorResponse(poisoned(code, 200)));
  }
});

test("draft, canonical receipt and deployment errors retain safe action semantics", () => {
  for (const code of [
    "STALE_DRAFT",
    "DRAFT_SCOPE",
    "SUBMITTED_DRAFT",
    "TX_REORG",
    "TX_MISMATCH",
    "TX_PREDATES_REVIEW",
    "TX_FAILED",
    "DUPLICATE_TRANSACTION",
    "DEPLOYMENT_MISMATCH",
    "DEPLOYMENT_REORG",
    "UPGRADE_TRUST_MISMATCH",
    "WRONG_CONTRACT",
    "WRONG_FACTORY",
    "REWARDS_NOT_READY",
    "SIMULATION_FAILED",
  ]) {
    const response = safeDTO(productionErrorResponse(poisoned(code)));
    assert.equal(response.status, 409);
    assert.equal(response.body.code, code);
    assert.deepEqual(
      response,
      productionErrorResponse({ code, message: "Different unsafe detail" }),
    );
  }
  assert.match(
    productionErrorResponse({ code: "SUBMITTED_DRAFT" }).body.error,
    /existing hash/,
  );
  assert.match(
    productionErrorResponse({ code: "REWARDS_NOT_READY" }).body.error,
    /delivered resolver finality/,
  );
});

test("access and ingress failures keep their intended public status", () => {
  for (const [code, status] of [
    ["NOT_FOUND", 404],
    ["FORBIDDEN", 403],
    ["NOT_OWNER", 403],
    ["NOT_STAFF", 403],
    ["WALLET_REQUIRED", 403],
    ["RPC_METHOD_FORBIDDEN", 403],
    ["RPC_TRANSACTION_FORBIDDEN", 403],
    ["BAD_HOST", 403],
    ["BAD_ORIGIN", 403],
    ["PROXY_REQUIRED", 403],
    ["TOO_LARGE", 413],
    ["BAD_CONTENT_TYPE", 415],
    ["INVALID_INPUT", 400],
    ["UNKNOWN_VERSION", 400],
    ["WRONG_VERSION", 409],
    ["UNKNOWN_ACTION", 400],
  ]) {
    const response = safeDTO(productionErrorResponse(poisoned(code)));
    assert.equal(response.status, status);
    assert.equal(response.body.code, code);
  }
});

test("real requireThat error objects are formatted using public semantics, not raw text", () => {
  for (const [code, status] of [
    ["FORBIDDEN", 403],
    ["STALE_DRAFT", 409],
    ["IDENTITY_MISMATCH", 400],
    ["ATTENDANCE_TIME_MISMATCH", 409],
  ]) {
    let error;
    try {
      requireThat(false, payload, code, status);
    } catch (caught) {
      error = caught;
    }
    const response = safeDTO(productionErrorResponse(error));
    assert.equal(response.status, status);
    assert.equal(response.body.code, code);
  }
});

test("only explicit per-code alternate statuses survive; arbitrary status fields do not", () => {
  for (const [code, allowed, fallback] of [
    ["IDENTITY_MISMATCH", [400, 409], 409],
    ["ATTENDANCE_TIME_MISMATCH", [400, 409], 409],
    ["WRONG_CHAIN", [400, 409], 409],
    ["WALLET_SIGNATURE_REQUIRED", [403, 409], 403],
  ]) {
    for (const status of allowed)
      assert.equal(
        productionErrorResponse(poisoned(code, status)).status,
        status,
      );
    for (const status of [200, 301, 418, 500, 503, 600, NaN, "400", null])
      assert.equal(
        productionErrorResponse(poisoned(code, status)).status,
        fallback,
      );
  }
  for (const status of [200, 401, 404, 503, "403"])
    assert.equal(
      productionErrorResponse(poisoned("FORBIDDEN", status)).status,
      403,
    );
});

test("scoped batch, import and inbox errors keep useful non-sensitive semantics", () => {
  for (const [code, status] of [
    ["BATCH_SCOPE", 409],
    ["STALE_BATCH", 409],
    ["BATCH_IN_PROGRESS", 409],
    ["BATCH_LIMIT", 429],
    ["IMPORT_PREVIEW_SCOPE", 409],
    ["IMPORT_PREVIEW_EXPIRED", 409],
    ["IMPORT_PREVIEW_NOT_FOUND", 404],
    ["INBOX_REORG", 409],
    ["INBOX_OWNER_UNAVAILABLE", 503],
    ["SELECTED_EVENT_SESSION_CHANGED", 401],
    ["SELECTED_EVENT_ACCESS_CHANGED", 409],
    ["SELECTED_EVENT_UNAVAILABLE", 503],
  ]) {
    const response = safeDTO(productionErrorResponse(poisoned(code)));
    assert.equal(response.status, status);
    assert.equal(response.body.code, code);
  }
});

test("unknown ethers, transport and numeric RPC codes have one sanitized503 response", () => {
  for (const code of [
    undefined,
    null,
    -32000,
    3,
    "CALL_EXCEPTION",
    "INVALID_ARGUMENT",
    "SERVER_ERROR",
    "NETWORK_ERROR",
    "TIMEOUT",
    "ECONNRESET",
    "UNSUPPORTED_WALLET_" + payload,
    "FORBIDDEN " + payload,
  ]) {
    const response = safeDTO(productionErrorResponse(poisoned(code, 422)));
    assert.deepEqual(response, generic);
  }
});

test("arbitrary thrown values and circular provider payloads are never reflected", () => {
  const circular = poisoned("CALL_EXCEPTION");
  circular.cause = circular;
  for (const error of [
    payload,
    null,
    undefined,
    17,
    true,
    Symbol(payload),
    circular,
  ])
    assert.deepEqual(safeDTO(productionErrorResponse(error)), generic);
});

test("messages, shortMessage, nested causes and accessors are never read", () => {
  let reads = 0;
  const guarded = { code: "FORBIDDEN" };
  for (const key of ["message", "shortMessage", "cause", "info", "status"])
    Object.defineProperty(guarded, key, {
      get() {
        reads++;
        throw new Error(payload);
      },
    });
  assert.equal(productionErrorResponse(guarded).status, 403);
  const codeAccessor = Object.defineProperty({}, "code", {
    get() {
      reads++;
      throw new Error(payload);
    },
  });
  assert.deepEqual(productionErrorResponse(codeAccessor), generic);
  const alternateAccessor = Object.defineProperty(
    { code: "WRONG_CHAIN" },
    "status",
    {
      get() {
        reads++;
        throw new Error(payload);
      },
    },
  );
  assert.equal(productionErrorResponse(alternateAccessor).status, 409);
  assert.equal(reads, 0);
});

test("hostile prototypes, coercions and proxy traps cannot escape the formatter", () => {
  for (const code of ["__proto__", "constructor", "toString", "hasOwnProperty"])
    assert.deepEqual(productionErrorResponse(poisoned(code)), generic);
  const inherited = Object.create({ code: "FORBIDDEN", status: 403 });
  assert.deepEqual(productionErrorResponse(inherited), generic);
  const coercion = {
    code: {
      toString() {
        throw new Error(payload);
      },
    },
  };
  assert.deepEqual(productionErrorResponse(coercion), generic);
  const proxy = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error(payload);
      },
    },
  );
  assert.deepEqual(productionErrorResponse(proxy), generic);
});

test("frozen errors are not mutated and callers cannot change future public responses", () => {
  const input = Object.freeze(poisoned("STALE_DRAFT", 409));
  const first = productionErrorResponse(input);
  const expected = structuredClone(first);
  first.status = 200;
  first.body.code = payload;
  first.body.error = payload;
  assert.deepEqual(productionErrorResponse(input), expected);
  const fallback = productionErrorResponse(new Error(payload));
  fallback.body.error = payload;
  assert.deepEqual(productionErrorResponse(null), generic);
  assert.equal(input.message, payload);
  assert.equal(input.code, "STALE_DRAFT");
});
