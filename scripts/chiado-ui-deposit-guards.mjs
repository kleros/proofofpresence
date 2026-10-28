// Pure, independently reviewed pre-send guards for the new UI-deposit scenario.
// No files, network, signer, browser, journal mutation or broadcast is supported.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ethers } from "ethers";

const SELECTOR = ethers.id("deposit()").slice(0, 10);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
function quantity(value) {
  assert.ok(
    typeof value === "bigint" ||
      (typeof value === "number" && Number.isSafeInteger(value)) ||
      (typeof value === "string" && /^(0x[0-9a-f]+|[0-9]+)$/i.test(value)),
    "Exact integer transaction quantity required",
  );
  const n = BigInt(value);
  assert.ok(n >= 0n && n < 1n << 256n, "Quantity must fit uint256");
  return n;
}

export function assertDepositScope(scope) {
  assert.equal(scope.chainId, 10200, "Only Chiado is authorized");
  assert.ok(ethers.isAddress(scope.wallet) && ethers.isAddress(scope.contract));
  assert.ok(!same(scope.contract, ethers.ZeroAddress));
  assert.ok(!same(scope.wallet, ethers.ZeroAddress));
  assert.ok(typeof scope.eventId === "string" && scope.eventId.length > 0);
  assert.ok(
    quantity(scope.valueWei) > 0n,
    "A positive exact deposit is required",
  );
  assert.ok(Number.isSafeInteger(scope.depositOpensAt));
  assert.ok(Number.isSafeInteger(scope.eventStart));
  assert.ok(scope.eventStart > scope.depositOpensAt);
}

export function assertUiDepositRequest(request, scope) {
  assertDepositScope(scope);
  assert.ok(request && typeof request === "object" && !Array.isArray(request));
  assert.ok(
    Object.keys(request).every((key) =>
      ["from", "to", "data", "value", "chainId"].includes(key),
    ),
    "Unreviewed wallet fields are refused",
  );
  assert.equal(quantity(request.chainId), 10200n);
  assert.ok(same(request.from, scope.wallet), "Exact reviewed payer required");
  assert.ok(same(request.to, scope.contract), "Exact reviewed child required");
  assert.equal(
    request.data?.toLowerCase(),
    SELECTOR,
    "Only deposit() calldata",
  );
  assert.equal(quantity(request.value), quantity(scope.valueWei));
  return {
    from: ethers.getAddress(scope.wallet),
    to: ethers.getAddress(scope.contract),
    data: SELECTOR,
    value: quantity(request.value),
    chainId: 10200,
  };
}

export function assertUiDepositDraft(draft, scope, nowMs = Date.now()) {
  assertDepositScope(scope);
  assert.ok(typeof draft?.id === "string" && draft.id.length > 0);
  assert.equal(draft.eventId, scope.eventId);
  assert.equal(draft.action, "deposit");
  assert.equal(draft.method, "deposit");
  assert.equal(draft.abiVersion, "kleros-event-v8");
  assert.equal(draft.contractVersion, "kleros-event-v8");
  assert.deepEqual(draft.args, []);
  assert.ok(same(draft.wallet, scope.wallet));
  assert.ok(same(draft.contract, scope.contract));
  assert.equal(quantity(draft.chainId), 10200n);
  assert.equal(quantity(draft.valueWei), quantity(scope.valueWei));
  assert.ok(
    Number.isSafeInteger(draft.expiresAt) &&
      draft.expiresAt > nowMs &&
      draft.expiresAt <= nowMs + 301_000,
    "Fresh review required",
  );
  assert.match(draft.snapshot ?? "", /^[0-9a-f]{64}$/i);
  assertUiDepositRequest(draft.transaction, scope);
  return draft;
}

export function assertUiDepositReadiness(state, scope, actionEntry) {
  assertDepositScope(scope);
  assert.equal(state.phase, "Open");
  assert.ok(
    Number.isSafeInteger(state.now) &&
      state.now >= scope.depositOpensAt &&
      state.now < scope.eventStart,
    "Deposits close strictly at eventStart",
  );
  assert.equal(state.depositWei, quantity(scope.valueWei).toString());
  assert.equal(
    actionEntry,
    undefined,
    "Existing journal action allows receipt recovery only",
  );
}

function selfTest() {
  const scope = {
    chainId: 10200,
    eventId: "synthetic-ui-deposit",
    wallet: "0x0000000000000000000000000000000000000001",
    contract: "0x0000000000000000000000000000000000000002",
    valueWei: "1000000000000",
    depositOpensAt: 100,
    eventStart: 200,
  };
  const request = {
    from: scope.wallet,
    to: scope.contract,
    data: SELECTOR,
    value: ethers.toQuantity(scope.valueWei),
    chainId: "0x27d8",
  };
  const draft = {
    id: "synthetic",
    eventId: scope.eventId,
    action: "deposit",
    method: "deposit",
    abiVersion: "kleros-event-v8",
    contractVersion: "kleros-event-v8",
    args: [],
    wallet: scope.wallet,
    contract: scope.contract,
    chainId: 10200,
    valueWei: scope.valueWei,
    expiresAt: 61_000,
    snapshot: "a".repeat(64),
    transaction: request,
  };
  assert.equal(
    assertUiDepositRequest(request, scope).value.toString(),
    scope.valueWei,
  );
  assertUiDepositDraft(draft, scope, 1000);
  assertUiDepositReadiness(
    { phase: "Open", now: 100, depositWei: scope.valueWei },
    scope,
  );
  let rejected = 0;
  const refuses = (fn) => {
    assert.throws(fn);
    rejected++;
  };
  for (const patch of [
    { chainId: "0x1" },
    { from: scope.contract },
    { to: scope.wallet },
    { data: "0x" },
    { data: SELECTOR + "00" },
    { value: "1" },
    { nonce: 0 },
    { gas: "0xffffff" },
    { value: 1.1 },
  ])
    refuses(() => assertUiDepositRequest({ ...request, ...patch }, scope));
  for (const patch of [
    { eventId: "other-event" },
    { wallet: scope.contract },
    { action: "challenge" },
    { args: [scope.wallet] },
    { snapshot: "" },
    { expiresAt: 1000 },
    { expiresAt: 400_000 },
    { contractVersion: "truth-pays-v7" },
  ])
    refuses(() => assertUiDepositDraft({ ...draft, ...patch }, scope, 1000));
  for (const patch of [
    { now: 99 },
    { now: 200 },
    { phase: "Listed" },
    { depositWei: "1" },
  ])
    refuses(() =>
      assertUiDepositReadiness(
        { phase: "Open", now: 199, depositWei: scope.valueWei, ...patch },
        scope,
      ),
    );
  refuses(() =>
    assertUiDepositReadiness(
      { phase: "Open", now: 199, depositWei: scope.valueWei },
      scope,
      { state: "prepared" },
    ),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      scope: "pure UI-deposit pre-send guards",
      accepted: 3,
      rejected,
      networkRequests: 0,
      signatures: 0,
      broadcasts: 0,
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.ok(
    process.argv.includes("--self-test"),
    "Only --self-test is supported; this file never submits deposits",
  );
  selfTest();
}
