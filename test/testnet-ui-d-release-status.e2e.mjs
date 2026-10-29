import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { selectedEventResult } from "../public/selected-event.js";

// Separate post-release observer. Historical auditor and financial operator are unchanged.
export const COPIED_D_STATUS_SOURCE_SHA256 =
  "85588a44bc3445779ff35fd3eaae946564b85b70f62b9467d052415a70e39468";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const readJson = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const publicJson = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v), 2) +
  "\n";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
let ethers,
  fingerprint,
  acquireLock,
  loadJournal,
  verifyCompiledInputs,
  assertTestnet;
let UI_D, validateUiDPlan, uiDCreateRequest;
let assertPlanDeployment,
  assertNonce,
  assertBootstrap,
  assertPublishedAsset,
  stateOf,
  singleAttemptConnection;
// No runtime/scenario/operator module is imported by default or --self-test.
async function loadExecutionHelpers() {
  ({ ethers } = await import("ethers"));
  ({
    fingerprint,
    acquireLock,
    loadJournal,
    verifyCompiledInputs,
    assertTestnet,
  } = await import("../src/testnet-config.mjs"));
  ({ UI_D, validateUiDPlan, uiDCreateRequest } = await import(
    "../scripts/testnet-ui-d-scenario.mjs"
  ));
  // Pure exported helpers only. Its financial main is never called.
  ({
    assertPlanDeployment,
    assertNonce,
    assertBootstrap,
    assertPublishedAsset,
    stateOf,
    singleAttemptConnection,
  } = await import("./testnet-ui-d.e2e.mjs"));
}

// Independent observer. Auth nonces only; no transaction-signing/sending API.
export const D_STATUS_PHASES = [
  "admitted",
  "matched",
  "ordinary",
  "ruled",
  "settled",
];
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const must = (condition, message) => {
  if (!condition) throw new Error(message);
};
const clone = (value) => JSON.parse(publicJson(value));
const quiet = (state) =>
  publicJson(
    Object.fromEntries(
      Object.entries(state).filter(
        ([k]) => !["now", "indexedBlock"].includes(k),
      ),
    ),
  );
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k));
const units = (value) =>
  `${ethers.formatEther(value).replace(/\.0$/, "")} XDAI`;
export const allowedStatusWallet = (method) =>
  [
    "eth_chainId",
    "eth_accounts",
    "eth_requestAccounts",
    "personal_sign",
  ].includes(method);
export const allowedStatusHttp = (
  method,
  pathname,
  api,
  files,
  search = "",
) => {
  if (pathname === "/api/bootstrap" && method === "GET") {
    if (!search) return true; // Deliberate readiness/session polls remain bare.
    const query = new URLSearchParams(search),
      keys = [...query.keys()];
    return (
      keys.length === 1 &&
      keys[0] === "selectedEventId" &&
      query.get("selectedEventId") ===
        decodeURIComponent(api.slice("/api/events/".length))
    );
  }
  if (search) return false;
  return (
    (method === "GET" &&
      (files.has(pathname === "/" ? "/index.html" : pathname) ||
        pathname === api + "/deposit-inbox")) ||
    (method === "POST" &&
      ["/api/auth/challenge", "/api/auth/verify"].includes(pathname))
  );
};

export function assertStatusSession(bootstrap, role, scope, instanceId) {
  const authenticated = role !== null;
  must(
    role === null || ["alice", "bob", "owner"].includes(role),
    "Unknown release-status role",
  );
  const expectedWallet = authenticated ? scope[role] : null;
  must(
    typeof instanceId === "string" &&
      instanceId &&
      bootstrap?.instanceId === instanceId,
    "Selected D bootstrap changed backend instance",
  );
  must(
    authenticated
      ? bootstrap.session?.mode === "wallet" &&
          same(bootstrap.session.wallet, expectedWallet)
      : bootstrap.session == null,
    "Selected D bootstrap belongs to another session actor",
  );
  return expectedWallet;
}
export function assertStatusAuthAck(status, ack, role, scope) {
  must(
    status === 200 &&
      ["alice", "bob", "owner"].includes(role) &&
      ack?.mode === "wallet" &&
      same(ack.wallet, scope[role]),
    "D nonce verification did not acknowledge the exact signing role",
  );
  return true;
}
export function assertBoundStatusBootstrap(bootstrap, role, scope, instanceId) {
  const authenticated = role !== null;
  const expectedWallet = assertStatusSession(
    bootstrap,
    role,
    scope,
    instanceId,
  );
  const selected = selectedEventResult(bootstrap, {
    eventId: scope.eventId,
    capturedWallet: expectedWallet,
    hasCapturedSession: true,
  });
  must(
    selected?.detail && !selected.error,
    "Selected D bootstrap is missing, rejected or an error",
  );
  const detail = selected.detail;
  must(
    same(detail.event.contract, scope.contract) &&
      detail.event.chainId === 10200 &&
      detail.event.contractVersion === "kleros-event-v8-test15m" &&
      detail.event.abiVersion === "kleros-event-v8-test15m",
    "Selected D bundle left the reviewed test deployment",
  );
  must(
    detail.permissions?.authenticated === authenticated &&
      detail.permissions.owner === (role === "owner") &&
      detail.permissions.staff === (role === "owner"),
    "Selected D bundle role permissions differ from the nonce-authenticated actor",
  );
  if (authenticated)
    must(
      same(detail.ownWallet?.wallet, expectedWallet),
      "Selected D own-wallet facts belong to another actor",
    );
  return detail;
}

export function statusControlExpectations(phase, now, challengeEndsAt) {
  must(
    D_STATUS_PHASES.includes(phase) &&
      Number.isSafeInteger(now) &&
      now >= 0 &&
      Number.isSafeInteger(challengeEndsAt) &&
      challengeEndsAt >= 0,
    "Invalid D control snapshot",
  );
  return {
    release: phase === "matched" && now > challengeEndsAt,
    resolve: phase === "ruled",
    caseCount: phase === "admitted" ? 0 : 1,
  };
}

export function assertDStatusPhase(phase, state, payments, scope) {
  must(D_STATUS_PHASES.includes(phase), "Unknown D status phase");
  const D = BigInt(scope.depositWei),
    c = state.bobCase,
    paid = { alice: 0n, bob: 0n };
  must(
    scope.chainId === 10200 &&
      D === 1_000_000_000_000n &&
      same(state.owner, scope.owner),
    "Wrong D chain, principal or owner",
  );
  must(
    state.stakerCount === 2 &&
      state.pendingTotal === "0" &&
      state.owedTotal === "0" &&
      state.pending.alice === "0" &&
      state.pending.bob === "0" &&
      state.owed.alice === "0" &&
      state.owed.bob === "0" &&
      payments.outstandingCreditsWei === "0",
    "Two admitted principals, unused credit and owed balances must remain separate",
  );
  for (const t of payments.transfers.filter(
    (t) => t.type === "attendance-payout",
  )) {
    must(
      t.successful === true,
      "Owed or failed credit cannot count as delivered attendance",
    );
    const role = ["alice", "bob"].find((r) => same(t.wallet, scope[r]));
    must(role, "Unexpected D attendance recipient");
    paid[role] += BigInt(t.amountWei);
  }
  const ordinary = ["ordinary", "ruled"].includes(phase),
    settled = phase === "settled";
  const expectedSent = settled ? 2n * D : ordinary ? D : 0n;
  const escrow =
    phase === "admitted"
      ? 0n
      : 2n * BigInt(c.deposit) - BigInt(c.arbitrationPaid);
  if (phase !== "admitted")
    must(
      c.deposit === "30000000000" &&
        c.arbitrationPaid === "30000000000" &&
        same(c.matcher, scope.owner),
      "D collateral or matcher differs",
    );
  const expectedEscrow = settled ? 0n : escrow;
  const expectedReserved =
    (settled ? 0n : ordinary ? D : 2n * D) + expectedEscrow;
  must(
    state.challengeEscrow === String(expectedEscrow) &&
      state.reserved === String(expectedReserved) &&
      state.balance === String(expectedReserved) &&
      state.payoutShare === (ordinary || settled ? String(D) : "0"),
    "D pool, collateral, balance and protected reserves do not reconcile",
  );
  must(
    BigInt(payments.attendancePaidWei) === expectedSent &&
      paid.alice === (ordinary || settled ? D : 0n) &&
      paid.bob === (settled ? D : 0n),
    "Canonical Alice/Bob attendance payments do not match this phase",
  );
  if (phase === "admitted")
    must(
      state.phase === "Open" &&
        state.attendeeCount === 0 &&
        c.state === 0 &&
        c.finalRuling === null &&
        state.status.alice === 1 &&
        state.status.bob === 1 &&
        state.pendingChallenges === "0" &&
        state.heldBack === "0",
      "D is not admitted before attendance",
    );
  else {
    must(
      /^\d+$/.test(c.localDisputeID) && /^\d+$/.test(c.arbitratorDisputeID),
      "Dynamic D dispute IDs are missing",
    );
    must(
      state.attended.alice === true &&
        state.attended.bob === settled &&
        state.attendeeCount === (settled ? 2 : 1),
      "D attendance differs from the planned same-Bob case",
    );
    must(
      state.phase === (phase === "matched" ? "Listed" : "Finalized") &&
        c.state === (settled ? 3 : 2) &&
        c.finalRuling === (phase === "ruled" || settled ? 1 : null),
      "Ruling, ordinary batch and settlement are distinct D phases",
    );
    must(
      state.status.alice === (phase === "matched" ? 1 : 2) &&
        state.status.bob === (settled ? 2 : 1),
      "D registration/payment status differs",
    );
    must(
      state.pendingChallenges === (settled ? "0" : "1") &&
        state.heldBack === (ordinary ? String(D) : "0") &&
        c.heldShare === (ordinary ? String(D) : "0"),
      "Bob's protected share differs from this phase",
    );
    if (settled)
      must(
        state.challengeEscrow === "0" &&
          state.reserved === "0" &&
          state.balance === "0",
        "D obligations remain after settlement",
      );
  }
  return {
    paid: Object.fromEntries(
      Object.entries(paid).map(([k, v]) => [k, String(v)]),
    ),
    sentWei: String(expectedSent),
    heldWei: state.heldBack,
    owedWei: state.owedTotal,
    poolWei: String(2n * D),
    case: c,
  };
}

export function assertDStatusDetail(data, role, state, summary, scope) {
  must(
    data.event?.id === scope.eventId &&
      same(data.event.contract, scope.contract) &&
      data.event.chainId === 10200 &&
      data.event.contractVersion === "kleros-event-v8-test15m" &&
      data.event.abiVersion === "kleros-event-v8-test15m",
    "API detail left the selected D deployment",
  );
  must(
    data.permissions?.owner === (role === "owner") &&
      same(data.ownWallet?.wallet, scope[role]) &&
      data.ownWallet.pendingCreditWei === "0" &&
      data.ownWallet.owedWei === "0",
    "Own-wallet identity or role-specific credit differs",
  );
  const fields = {
    phase: "phase",
    stakerCount: "stakerCount",
    attendeeCount: "attendeeCount",
    pendingChallenges: "pendingChallenges",
    balanceWei: "balance",
    heldBackWei: "heldBack",
    owedTotalWei: "owedTotal",
    challengeEscrowWei: "challengeEscrow",
    pendingTotalWei: "pendingTotal",
    payoutShareWei: "payoutShare",
    reservedWei: "reserved",
    challengeEndsAt: "challengeEndsAt",
    challengeDepositWei: "challengeDepositWei",
  };
  for (const [api, chain] of Object.entries(fields))
    must(
      String(data.state?.[api]) === String(state[chain]),
      `API D ${api} differs from pinned chain state`,
    );
  must(
    data.state.poolWei === summary.poolWei &&
      data.payments?.attendancePaidWei === summary.sentWei &&
      data.payments.outstandingCreditsWei === "0" &&
      data.payments.contract === scope.contract &&
      data.payments.chainId === 10200 &&
      data.payments.blockNumber === data.state.blockNumber,
    "API pool, delivery, pinned payment block or owed projection differs",
  );
  const allowed = role === "owner" ? ["alice", "bob"] : [role];
  must(
    data.participants?.length === allowed.length &&
      allowed.every((r) =>
        data.participants.some(
          (p) =>
            same(p.wallet, scope[r]) &&
            p.eventId === scope.eventId &&
            p.identityVerified === true &&
            p.admission === "approved" &&
            p.deposit?.verified === true &&
            p.name === `Synthetic UI D ${r === "alice" ? "Alice" : "Bob"}` &&
            p.email === `ui-d-${r}@example.test`,
        ),
      ),
    "D participant privacy or verified synthetic links differ",
  );
  const cases = data.state.cases;
  must(Array.isArray(cases), "D cases unavailable");
  if (state.bobCase.state === 0)
    must(cases.length === 0, "An admitted-only D view cannot invent a case");
  else
    must(
      cases.length === 1 &&
        same(cases[0].wallet, scope.bob) &&
        cases[0].matched === true &&
        cases[0].localDisputeID === state.bobCase.localDisputeID &&
        cases[0].arbitratorDisputeID === state.bobCase.arbitratorDisputeID &&
        cases[0].state ===
          (state.bobCase.state === 3 ? "Resolved" : "Disputed") &&
        cases[0].finalRuling === state.bobCase.finalRuling &&
        cases[0].heldShareWei === state.bobCase.heldShare,
      "API dynamic D dispute pair, finality or held share differs",
    );
}
export function assertApiSnapshot(data, block, head, minimumBlock) {
  must(
    Number.isSafeInteger(data.state?.blockNumber) &&
      data.state.blockNumber >= minimumBlock &&
      block &&
      head &&
      block.number === data.state.blockNumber &&
      data.payments.blockNumber === block.number &&
      data.payments.blockHash === block.hash &&
      data.state.now === block.timestamp &&
      data.now === block.timestamp &&
      head.number >= block.number &&
      head.number - block.number <= 24 &&
      head.timestamp >= block.timestamp &&
      head.timestamp - block.timestamp <= 120,
    "API D snapshot block/hash/time is not canonical and fresh",
  );
}

export function selfTest() {
  const scope = {
    chainId: 10200,
    depositWei: "1000000000000",
    owner: "owner",
    alice: "alice",
    bob: "bob",
    contract: "child-d",
    eventId: "event-d",
  };
  let accepted = 0,
    rejected = 0;
  for (const phase of D_STATUS_PHASES) {
    const ordinary = ["ordinary", "ruled"].includes(phase),
      settled = phase === "settled";
    const s = {
      owner: "owner",
      phase:
        phase === "admitted"
          ? "Open"
          : phase === "matched"
            ? "Listed"
            : "Finalized",
      stakerCount: 2,
      attendeeCount: phase === "admitted" ? 0 : settled ? 2 : 1,
      pendingTotal: "0",
      owedTotal: "0",
      owed: { alice: "0", bob: "0" },
      pending: { alice: "0", bob: "0" },
      status: {
        alice: ["admitted", "matched"].includes(phase) ? 1 : 2,
        bob: settled ? 2 : 1,
      },
      attended: { alice: phase !== "admitted", bob: settled },
      pendingChallenges: ["admitted", "settled"].includes(phase) ? "0" : "1",
      heldBack: ordinary ? scope.depositWei : "0",
      challengeEscrow: ["admitted", "settled"].includes(phase)
        ? "0"
        : "30000000000",
      reserved: settled
        ? "0"
        : String(
            (ordinary ? 1n : 2n) * BigInt(scope.depositWei) +
              (phase === "admitted" ? 0n : 30000000000n),
          ),
      payoutShare: ordinary || settled ? scope.depositWei : "0",
      challengeEndsAt: phase === "admitted" ? 0 : 300,
      challengeDepositWei: "30000000000",
      bobCase: {
        state: phase === "admitted" ? 0 : settled ? 3 : 2,
        finalRuling: ["ruled", "settled"].includes(phase) ? 1 : null,
        localDisputeID: "17",
        arbitratorDisputeID: "1017",
        heldShare: ordinary ? scope.depositWei : "0",
        deposit: "30000000000",
        arbitrationPaid: "30000000000",
        matcher: "owner",
      },
    };
    s.balance = s.reserved;
    const p = {
      attendancePaidWei: settled
        ? "2000000000000"
        : ordinary
          ? scope.depositWei
          : "0",
      outstandingCreditsWei: "0",
      transfers: (settled ? ["alice", "bob"] : ordinary ? ["alice"] : []).map(
        (wallet) => ({
          wallet,
          amountWei: scope.depositWei,
          type: "attendance-payout",
          successful: true,
        }),
      ),
    };
    const summary = assertDStatusPhase(phase, s, p, scope);
    accepted++;
    assert.deepEqual(statusControlExpectations(phase, 301, s.challengeEndsAt), {
      release: phase === "matched",
      resolve: phase === "ruled",
      caseCount: phase === "admitted" ? 0 : 1,
    });
    accepted++;
    for (const change of [
      (x) => (x.owner = "foreign"),
      (x) => (x.owedTotal = "1"),
      (x) => (x.pendingTotal = "1"),
      (x) => (x.heldBack = "99"),
      (x) => (x.bobCase.finalRuling = 2),
      (x) => (x.reserved = "1"),
      (x) => (x.balance = "1"),
      (x) => (x.challengeEscrow = "99"),
    ]) {
      const bad = clone(s);
      change(bad);
      assert.throws(() => assertDStatusPhase(phase, bad, p, scope));
      rejected++;
    }
    const badPayment = clone(p);
    badPayment.attendancePaidWei = "999";
    assert.throws(() => assertDStatusPhase(phase, s, badPayment, scope));
    rejected++;
    const data = {
      event: {
        id: scope.eventId,
        contract: scope.contract,
        chainId: 10200,
        contractVersion: "kleros-event-v8-test15m",
        abiVersion: "kleros-event-v8-test15m",
      },
      permissions: { owner: false },
      ownWallet: { wallet: "alice", pendingCreditWei: "0", owedWei: "0" },
      participants: [
        {
          wallet: "alice",
          eventId: scope.eventId,
          identityVerified: true,
          admission: "approved",
          deposit: { verified: true },
          name: "Synthetic UI D Alice",
          email: "ui-d-alice@example.test",
        },
      ],
      state: {
        phase: s.phase,
        stakerCount: 2,
        attendeeCount: s.attendeeCount,
        pendingChallenges: s.pendingChallenges,
        balanceWei: s.balance,
        heldBackWei: s.heldBack,
        owedTotalWei: "0",
        challengeEscrowWei: s.challengeEscrow,
        pendingTotalWei: "0",
        poolWei: summary.poolWei,
        payoutShareWei: s.payoutShare,
        reservedWei: s.reserved,
        challengeEndsAt: s.challengeEndsAt,
        challengeDepositWei: s.challengeDepositWei,
        blockNumber: 10,
        cases:
          phase === "admitted"
            ? []
            : [
                {
                  wallet: "bob",
                  matched: true,
                  localDisputeID: "17",
                  arbitratorDisputeID: "1017",
                  finalRuling: s.bobCase.finalRuling,
                  heldShareWei: s.bobCase.heldShare,
                  state: settled ? "Resolved" : "Disputed",
                },
              ],
      },
      payments: {
        attendancePaidWei: summary.sentWei,
        outstandingCreditsWei: "0",
        contract: scope.contract,
        chainId: 10200,
        blockNumber: 10,
      },
    };
    assertDStatusDetail(data, "alice", s, summary, scope);
    accepted++;
    for (const change of [
      (d) => (d.event.id = "other"),
      (d) => (d.event.contract = "other"),
      (d) => (d.ownWallet.wallet = "bob"),
      (d) => (d.permissions.owner = true),
      (d) => d.participants.push({ wallet: "bob" }),
      (d) => (d.state.poolWei = "1"),
      (d) => (d.payments.attendancePaidWei = "99"),
      (d) => (d.state.heldBackWei = "99"),
    ]) {
      const bad = clone(data);
      change(bad);
      assert.throws(() => assertDStatusDetail(bad, "alice", s, summary, scope));
      rejected++;
    }
    if (phase !== "admitted")
      for (const change of [
        (d) => (d.state.cases[0].localDisputeID = "0"),
        (d) => (d.state.cases[0].arbitratorDisputeID = "1000"),
        (d) => (d.state.cases[0].state = "Waiting"),
      ]) {
        const bad = clone(data);
        change(bad);
        assert.throws(() =>
          assertDStatusDetail(bad, "alice", s, summary, scope),
        );
        rejected++;
      }
  }
  const files = new Set(["/index.html", "/app.js"]),
    api = "/api/events/event-d";
  for (const now of [299, 300]) {
    assert.equal(statusControlExpectations("matched", now, 300).release, false);
    accepted++;
  }
  for (const args of [
    ["unknown", 301, 300],
    ["matched", NaN, 300],
    ["matched", 301, -1],
    ["matched", "301", 300],
  ]) {
    assert.throws(() => statusControlExpectations(...args));
    rejected++;
  }
  for (const method of [
    "eth_sendTransaction",
    "eth_signTransaction",
    "eth_signTypedData_v4",
    "eth_sendRawTransaction",
    "evm_mine",
  ]) {
    assert.equal(allowedStatusWallet(method), false);
    rejected++;
  }
  for (const [method, pathname] of [
    ["POST", api + "/drafts"],
    ["POST", api + "/batches/preview"],
    ["POST", api + "/checkins"],
    ["GET", "/api/events/other"],
    ["DELETE", "/api/session"],
  ]) {
    assert.equal(allowedStatusHttp(method, pathname, api, files), false);
    rejected++;
  }
  const data = {
    state: { blockNumber: 10, now: 1000 },
    now: 1000,
    payments: { blockNumber: 10, blockHash: "canonical" },
  };
  const block = { number: 10, hash: "canonical", timestamp: 1000 },
    head = { number: 12, timestamp: 1010 };
  assertApiSnapshot(data, block, head, 10);
  accepted++;
  for (const change of [
    (d) => (d.payments.blockHash = "forged"),
    (d) => (d.state.now = 999),
    (d) => (d.now = 999),
    (d) => (d.state.blockNumber = 13),
  ]) {
    const bad = clone(data);
    change(bad);
    assert.throws(() => assertApiSnapshot(bad, block, head, 10));
    rejected++;
  }
  for (const [h, min] of [
    [{ number: 40, timestamp: 1200 }, 10],
    [head, 11],
  ]) {
    assert.throws(() => assertApiSnapshot(data, block, h, min));
    rejected++;
  }
  const guardScope = {
    eventId: "synthetic-release-d",
    contract: "0x" + "d".repeat(40),
    owner: "0x" + "a".repeat(40),
    alice: "0x" + "b".repeat(40),
    bob: "0x" + "c".repeat(40),
  };
  const guardApi = "/api/events/" + guardScope.eventId;
  const guardFiles = new Set([
    "/index.html",
    "/app.js",
    "/loading.css",
    "/ui-keyboard.js",
    "/selected-event.js",
  ]);
  for (const [method, pathname, search] of [
    ["GET", "/api/bootstrap", ""],
    ["GET", "/api/bootstrap", "?selectedEventId=" + guardScope.eventId],
    ["POST", "/api/auth/challenge", ""],
    ["POST", "/api/auth/verify", ""],
    ["GET", "/loading.css", ""],
    ["GET", "/ui-keyboard.js", ""],
    ["GET", "/selected-event.js", ""],
  ]) {
    assert.equal(
      allowedStatusHttp(method, pathname, guardApi, guardFiles, search),
      true,
    );
    accepted++;
  }
  for (const [method, pathname, search] of [
    ["GET", "/api/bootstrap", "?selectedEventId=other"],
    [
      "GET",
      "/api/bootstrap",
      "?selectedEventId=" +
        guardScope.eventId +
        "&selectedEventId=" +
        guardScope.eventId,
    ],
    [
      "GET",
      "/api/bootstrap",
      "?selectedEventId=" + guardScope.eventId + "&wallet=" + guardScope.bob,
    ],
    ["GET", "/api/bootstrap", "?wallet=" + guardScope.bob],
    ["GET", "/api/bootstrap", "?selectedeventid=" + guardScope.eventId],
    ["POST", "/api/auth/challenge", "?selectedEventId=" + guardScope.eventId],
    ["GET", "/loading.css", "?unknown=1"],
    ["GET", guardApi, ""],
    ["GET", guardApi, "?wallet=" + guardScope.owner],
    [
      "GET",
      guardApi + "/deposit-inbox",
      "?selectedEventId=" + guardScope.eventId,
    ],
    ["POST", guardApi + "/drafts", ""],
    ["DELETE", "/api/session", ""],
  ]) {
    assert.equal(
      allowedStatusHttp(method, pathname, guardApi, guardFiles, search),
      false,
    );
    rejected++;
  }
  const envelope = (role) => {
    const event = {
      id: guardScope.eventId,
      contract: guardScope.contract,
      chainId: 10200,
      deploymentBlock: 1,
      contractVersion: "kleros-event-v8-test15m",
      abiVersion: "kleros-event-v8-test15m",
      policyURI: "/synthetic-release-policy",
      templateHash: "e".repeat(64),
    };
    const auth = role !== null,
      owner = role === "owner";
    const person = (r) => ({
      wallet: guardScope[r],
      eventId: event.id,
      name: "Synthetic " + r,
      email: r + "@example.test",
    });
    const detail = {
      event,
      state: { blockNumber: 10 },
      participants: owner
        ? [person("alice"), person("bob")]
        : auth
          ? [person(role)]
          : [],
      permissions: { owner, staff: owner, authenticated: auth },
      ownWallet: auth
        ? { wallet: guardScope[role], pendingCreditWei: "0", owedWei: "0" }
        : null,
      deposits: [],
      unmatched: [],
      imports: [],
      attendance: [],
      transactions: [],
      personal: null,
    };
    return {
      instanceId: "synthetic-release-instance",
      chain: { chainId: 10200 },
      events: [event],
      session: auth ? { mode: "wallet", wallet: guardScope[role] } : null,
      capabilities: { selectedEventBootstrap: true },
      selectedEvent: {
        eventId: event.id,
        instanceId: "synthetic-release-instance",
        wallet: auth ? guardScope[role] : null,
        detail,
        error: null,
      },
    };
  };
  for (const role of [null, "alice", "bob", "owner"]) {
    const boot = envelope(role);
    assert.equal(
      assertBoundStatusBootstrap(
        boot,
        role,
        guardScope,
        "synthetic-release-instance",
      ),
      boot.selectedEvent.detail,
    );
    accepted++;
  }
  for (const edit of [
    (b) => (b.instanceId = "foreign-instance"),
    (b) => (b.selectedEvent.instanceId = "foreign-instance"),
    (b) => (b.selectedEvent.eventId = "foreign-event"),
    (b) => (b.selectedEvent.detail.event.contract = guardScope.owner),
    (b) => (b.session.wallet = guardScope.bob),
    (b) => (b.selectedEvent.wallet = guardScope.bob),
    (b) => (b.selectedEvent.detail.ownWallet.wallet = guardScope.bob),
    (b) => (b.selectedEvent.detail.permissions.owner = true),
    (b) => (b.selectedEvent.detail.permissions.staff = true),
    (b) => (b.selectedEvent.detail.permissions.authenticated = false),
    (b) =>
      b.selectedEvent.detail.participants.push({
        wallet: guardScope.bob,
        email: "foreign@example.test",
      }),
    (b) => (b.capabilities.selectedEventBootstrap = false),
    (b) => {
      b.selectedEvent.detail = null;
      b.selectedEvent.error = {
        status: 503,
        message: "Synthetic source unavailable",
      };
    },
  ]) {
    const bad = envelope("alice");
    edit(bad);
    assert.throws(() =>
      assertBoundStatusBootstrap(
        bad,
        "alice",
        guardScope,
        "synthetic-release-instance",
      ),
    );
    rejected++;
  }
  for (const field of [
    "participants",
    "deposits",
    "unmatched",
    "imports",
    "attendance",
    "transactions",
    "personal",
    "ownWallet",
  ]) {
    const bad = envelope(null);
    bad.selectedEvent.detail[field] = ["personal", "ownWallet"].includes(field)
      ? { wallet: guardScope.alice, private: true }
      : [{ wallet: guardScope.alice, email: "private@example.test" }];
    assert.throws(() =>
      assertBoundStatusBootstrap(
        bad,
        null,
        guardScope,
        "synthetic-release-instance",
      ),
    );
    rejected++;
  }
  // Failed or mismatched verify never promotes the expected actor.
  let acknowledged = false;
  for (const [status, ack] of [
    [403, { mode: "wallet", wallet: guardScope.alice }],
    [200, { mode: "wallet", wallet: guardScope.bob }],
    [200, { mode: "demo", wallet: guardScope.alice }],
  ]) {
    assert.throws(() => {
      acknowledged = assertStatusAuthAck(status, ack, "alice", guardScope);
    });
    assert.equal(acknowledged, false);
    assert.throws(() =>
      assertBoundStatusBootstrap(
        envelope("alice"),
        acknowledged ? "alice" : null,
        guardScope,
        "synthetic-release-instance",
      ),
    );
    rejected++;
  }
  acknowledged = assertStatusAuthAck(
    200,
    { mode: "wallet", wallet: guardScope.alice },
    "alice",
    guardScope,
  );
  assert.equal(acknowledged, true);
  accepted++;
  for (const role of ["alice", "bob", "owner"]) {
    assert.throws(() =>
      assertStatusSession(
        envelope(role),
        null,
        guardScope,
        "synthetic-release-instance",
      ),
    );
    assert.throws(() =>
      assertBoundStatusBootstrap(
        envelope(role),
        null,
        guardScope,
        "synthetic-release-instance",
      ),
    );
    rejected++;
  }
  assert.throws(() =>
    assertBoundStatusBootstrap(
      envelope(null),
      "alice",
      guardScope,
      "synthetic-release-instance",
    ),
  );
  rejected++;
  for (const role of ["bob", "owner", "unknown"]) {
    assert.throws(() =>
      assertBoundStatusBootstrap(
        envelope("alice"),
        role,
        guardScope,
        "synthetic-release-instance",
      ),
    );
    rejected++;
  }
  console.log(
    publicJson({
      status: "passed",
      accepted,
      rejected,
      networkRequests: 0,
      signingFilesRead: 0,
      signatures: 0,
      broadcasts: 0,
      copiedHistoricalSourceSha256: COPIED_D_STATUS_SOURCE_SHA256,
    }),
  );
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--self-test") return selfTest();
  if (!argv.length)
    return console.log(
      publicJson({
        status: "review-only",
        phases: D_STATUS_PHASES,
        networkRequests: 0,
        signingFilesRead: 0,
        signatures: 0,
        broadcasts: 0,
        instruction:
          "After primary D-complete/new-deploy GO only: UI_D_RELEASE_STATUS_EXECUTE=1 UI_D_APP_URL=exact-D-origin node test/testnet-ui-d-release-status.e2e.mjs --phase settled --source FULL_GIT_SHA. Auth+GET only.",
      }),
    );
  must(
    argv.length === 4 &&
      argv[0] === "--phase" &&
      D_STATUS_PHASES.includes(argv[1]) &&
      argv[2] === "--source" &&
      /^[a-f0-9]{40}$/.test(argv[3]),
    "Choose one exact D status phase and full reviewed release Git source",
  );
  must(
    process.env.UI_D_RELEASE_STATUS_EXECUTE === "1",
    "D status execution is disabled; operator GO is required before any access",
  );
  const sourceCommit = argv[3];
  must(
    execFileSync("git", ["rev-parse", "--verify", `${sourceCommit}^{commit}`], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim() === sourceCommit,
    "Release source must be the exact reviewed Git commit",
  );
  const publicFiles = new Map();
  const sourcePaths = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", sourceCommit, "--", "public"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const filename of sourcePaths) {
    must(
      filename.startsWith("public/") && !filename.includes(".."),
      "Invalid reviewed public source path",
    );
    publicFiles.set(
      "/" + filename.slice(7),
      sha256(
        execFileSync("git", ["show", `${sourceCommit}:${filename}`], {
          cwd: ROOT,
          maxBuffer: 20_000_000,
        }),
      ),
    );
  }
  for (const name of [
    "/app.js",
    "/index.html",
    "/loading.css",
    "/ui-keyboard.js",
    "/selected-event.js",
  ])
    must(
      publicFiles.has(name),
      "Reviewed release is missing a required new static asset",
    );
  must(
    sha256(fs.readFileSync(path.join(ROOT, "public/selected-event.js"))) ===
      publicFiles.get("/selected-event.js"),
    "Imported selected-event validator differs from reviewed release Git source",
  );
  await loadExecutionHelpers();
  const phase = argv[1],
    proof = {
      status: "stopped",
      phase,
      roleProofs: [],
      screenshots: [],
      assetAudit: [],
      counts: {
        http: 0,
        nonceSignatures: 0,
        financialSignatures: 0,
        broadcasts: 0,
        browserSerialDetailReads: 0,
      },
      failures: [],
    };
  let provider, browser, unlock, output;
  try {
    const source = readJson(UI_D.sourceManifest),
      protectedC = readJson(UI_D.protectedCManifest),
      plan = validateUiDPlan(readJson(UI_D.plan), source, protectedC),
      manifest = readJson(UI_D.manifest);
    must(
      process.env.UI_D_APP_URL === plan.publicOrigin &&
        manifest.publicOrigin === plan.publicOrigin &&
        manifest.events.length === 1 &&
        manifest.planFingerprint === fingerprint(plan),
      "Only the exact plan-bound separate D origin is allowed",
    );
    const record = manifest.events[0],
      d = record.deployment,
      scope = {
        chainId: 10200,
        contract: d.contract,
        eventId: d.eventId,
        depositWei: plan.depositWei,
        ...plan.addresses,
      };
    unlock = acquireLock(UI_D.lock);
    const { artifacts, provenance } = verifyCompiledInputs(
      ROOT,
      UI_D.contractVersion,
    );
    must(
      publicJson(provenance) === publicJson(manifest.provenance),
      "D compiled source provenance changed",
    );
    assertPlanDeployment(
      record,
      plan,
      loadJournal(UI_D.journal, plan),
      uiDCreateRequest(plan, artifacts),
      artifacts,
    );
    const url = new URL(process.env.TESTNET_RPC_URL ?? plan.chain.rpcUrl);
    must(
      url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash,
      "Only a public HTTPS Chiado transport is allowed",
    );
    provider = new ethers.JsonRpcProvider(
      singleAttemptConnection(url.href),
      undefined,
      { cacheTimeout: -1, batchMaxCount: 1 },
    );
    const send = provider.send.bind(provider),
      methods = new Set([
        "eth_chainId",
        "net_version",
        "eth_blockNumber",
        "eth_getCode",
        "eth_getLogs",
        "eth_call",
        "eth_getBalance",
        "eth_getBlockByNumber",
        "eth_getBlockByHash",
        "eth_getTransactionByHash",
        "eth_getTransactionReceipt",
      ]);
    provider.send = (method, params) => {
      must(
        methods.has(method),
        "Mutable RPC is forbidden in the status auditor",
      );
      return send(method, params);
    };
    provider.broadcastTransaction = async () => {
      throw new Error("Broadcasts are forbidden in the status auditor");
    };
    const { verifyDeployment } = await import("../src/chain.mjs"),
      { projectPayments } = await import("../src/payments.mjs");
    await assertTestnet(provider, plan.chain);
    const c = await verifyDeployment({ provider }, d);
    const resolver = new ethers.Contract(
      d.resolver,
      artifacts.MockArbitrableProxy.abi,
      provider,
    );
    const before = await stateOf(c, provider, scope, resolver);
    const payments = await projectPayments({ provider }, record, {
      blockTag: before.indexedBlock.number,
    });
    const summary = assertDStatusPhase(phase, before, payments, scope);
    const origin = plan.publicOrigin,
      api = `/api/events/${encodeURIComponent(scope.eventId)}`;
    const get = async (client, pathname) => {
      must(["/api/bootstrap", api].includes(pathname), "Unexpected API read");
      proof.counts.http++;
      const response = await client.get(origin + pathname, {
        maxRedirects: 0,
        timeout: 60000,
      });
      must(response.status() === 200, "D read/health response failed");
      return response.json();
    };
    const preflight = await fetch(origin + "/api/bootstrap", {
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    must(preflight.status === 200, "D public readiness failed");
    proof.counts.http++;
    const bootstrap = assertBootstrap(await preflight.json(), manifest),
      instanceId = bootstrap.instanceId;
    assertStatusSession(bootstrap, null, scope, instanceId);
    must(
      bootstrap.selectedEvent == null,
      "Bare readiness must not return an unsolicited private selected payload",
    );
    const stat = fs.lstatSync(UI_D.wallets);
    must(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        (stat.mode & 0o077) === 0 &&
        (!process.getuid || stat.uid === process.getuid()),
      "D role keys must be owner-only regular files",
    );
    const keys = readJson(UI_D.wallets);
    must(
      keys.purpose === UI_D.purpose &&
        keys.chainId === 10200 &&
        Object.keys(keys.roles).sort().join() === "alice,bob,owner" &&
        ["alice", "bob", "owner"].every(
          (role) =>
            keys.roles[role].address === scope[role] &&
            new ethers.Wallet(keys.roles[role].privateKey).address ===
              scope[role],
        ),
      "D role key identities changed",
    );
    output = path.join(
      ROOT,
      "artifacts/release-status",
      `status-${phase}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.mkdirSync(output, { recursive: false });
    proof.source = {
      origin,
      instanceId,
      reviewedReleaseSource: sourceCommit,
      copiedHistoricalAuditorSha256: COPIED_D_STATUS_SOURCE_SHA256,
      selectedValidatorSha256: publicFiles.get("/selected-event.js"),
      planFingerprint: fingerprint(plan),
      manifestSha256: sha256(publicJson(manifest)),
      sourceManifestSha256: sha256(publicJson(source)),
      protectedCManifestSha256: sha256(publicJson(protectedC)),
      harnessSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
      provenance,
      contract: d.contract,
      codeHash: d.codeHash,
      creationTransaction: d.deploymentTxHash,
      publicFiles: Object.fromEntries(publicFiles),
    };
    proof.chainBefore = before;
    proof.canonicalPayments = payments;
    proof.summary = summary;
    const { chromium, expect: baseExpect } = await import("@playwright/test"),
      expect = baseExpect.configure({ timeout: 90000 });
    browser = await chromium.launch({ headless: true });
    for (const role of ["alice", "bob", "owner"]) {
      const wallet = new ethers.Wallet(keys.roles[role].privateKey),
        context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
      context.setDefaultTimeout(90000);
      let nonce,
        signature,
        nonceIssued = 0,
        nonceSigned = 0,
        nonceVerified = 0,
        authAcknowledged = false;
      const roleAssetStart = proof.assetAudit.length;
      const boundBundles = [];
      const currentBundledDetail = () => {
        const last = boundBundles.at(-1);
        must(
          last?.role === role && same(last.wallet, wallet.address),
          "No current authenticated UI bundle was captured",
        );
        return last.detail;
      };
      const refuse = (message) => {
        proof.failures.push(message);
        throw new Error(message);
      };
      await context.exposeBinding(
        "__dStatusWallet",
        async ({ frame }, method, params = []) => {
          must(
            !proof.failures.length &&
              new URL(frame.url()).origin === origin &&
              !frame.parentFrame(),
            "Wrong D wallet frame or prior failure",
          );
          if (!allowedStatusWallet(method))
            return refuse("Financial wallet method forbidden");
          if (method === "eth_chainId") return "0x27d8";
          if (["eth_accounts", "eth_requestAccounts"].includes(method))
            return [wallet.address];
          if (
            method !== "personal_sign" ||
            params.length !== 2 ||
            !same(params[1], wallet.address) ||
            nonceSigned++
          )
            return refuse("Financial/extra wallet method forbidden");
          const message = ethers.toUtf8String(params[0]);
          must(
            nonce && assertNonce(nonce, wallet.address, origin) === message,
            "Wrong exact D auth nonce",
          );
          signature = await wallet.signMessage(message);
          proof.counts.nonceSignatures++;
          return signature;
        },
      );
      await context.addInitScript(
        ({ address }) => {
          window.ethereum = {
            selectedAddress: address,
            request: ({ method, params = [] }) =>
              window.__dStatusWallet(method, params),
            on() {},
            removeListener() {},
          };
        },
        { address: wallet.address },
      );
      await context.route("**/*", async (route) => {
        const request = route.request(),
          u = new URL(request.url()),
          method = request.method();
        proof.counts.http++;
        if (method === "GET" && u.pathname === api)
          proof.counts.browserSerialDetailReads++;
        try {
          must(
            !proof.failures.length &&
              u.origin === origin &&
              !u.username &&
              !u.password,
            "Unexpected origin/query or prior failure",
          );
          must(
            allowedStatusHttp(method, u.pathname, api, publicFiles, u.search),
            "Non-auth mutation or foreign D read forbidden",
          );
          must(
            !(method === "GET" && u.pathname === api),
            "Release UI attempted serial detail fallback instead of consuming the validated selected bootstrap",
          );
          const sourcePath = u.pathname === "/" ? "/index.html" : u.pathname;
          if (method === "GET" && publicFiles.has(sourcePath)) {
            const response = await route.fetch({
              maxRedirects: 0,
              timeout: 60000,
              headers: { "cache-control": "no-cache" },
            });
            must(response.status() === 200, "Static D source unavailable");
            proof.assetAudit.push(
              assertPublishedAsset(
                await response.body(),
                u.pathname,
                publicFiles.get(sourcePath),
              ),
            );
            return route.fulfill({ response });
          }
          if (method === "GET" && u.pathname === "/api/bootstrap" && u.search) {
            const response = await route.fetch({
              maxRedirects: 0,
              timeout: 60000,
            });
            must(response.status() === 200, "Selected D bootstrap read failed");
            const envelope = assertBootstrap(
              await response.json(),
              manifest,
              instanceId,
            );
            const capturedRole = authAcknowledged ? role : null;
            const detail = assertBoundStatusBootstrap(
              envelope,
              capturedRole,
              scope,
              instanceId,
            );
            boundBundles.push({
              role: capturedRole,
              wallet: envelope.session?.wallet ?? null,
              detail,
            });
            return route.fulfill({ response });
          }
          if (method === "GET" && u.pathname === "/api/bootstrap") {
            const response = await route.fetch({
              maxRedirects: 0,
              timeout: 60000,
            });
            must(response.status() === 200, "Bare D bootstrap read failed");
            const envelope = assertBootstrap(
              await response.json(),
              manifest,
              instanceId,
            );
            assertStatusSession(
              envelope,
              authAcknowledged ? role : null,
              scope,
              instanceId,
            );
            must(
              envelope.selectedEvent == null,
              "Bare bootstrap returned an unsolicited selected payload",
            );
            return route.fulfill({ response });
          }
          if (method === "GET" && u.pathname === api + "/deposit-inbox")
            return route.continue();
          const body = request.postDataJSON();
          if (method === "POST" && u.pathname === "/api/auth/challenge") {
            must(
              exact(body, ["wallet"]) &&
                same(body.wallet, wallet.address) &&
                nonceIssued++ === 0,
              "Wrong/extra D nonce request",
            );
            const response = await route.fetch({ maxRedirects: 0 });
            must(response.status() === 200, "D auth challenge failed");
            nonce = await response.json();
            assertNonce(nonce, wallet.address, origin);
            return route.fulfill({ response });
          }
          if (method === "POST" && u.pathname === "/api/auth/verify") {
            must(
              exact(body, ["nonce", "signature"]) &&
                body.nonce === nonce?.nonce &&
                body.signature === signature &&
                nonceVerified++ === 0,
              "Wrong/extra D auth verification",
            );
            const response = await route.fetch({ maxRedirects: 0 });
            must(response.status() === 200, "D auth verification failed");
            authAcknowledged = assertStatusAuthAck(
              response.status(),
              await response.json(),
              role,
              scope,
            );
            return route.fulfill({ response });
          }
          throw new Error("All non-auth HTTP mutations are forbidden");
        } catch {
          proof.failures.push(`${method} ${u.pathname} refused`);
          return route.abort("blockedbyclient");
        }
      });
      try {
        const page = await context.newPage();
        page.on("pageerror", () =>
          proof.failures.push("Browser runtime error"),
        );
        page.on("response", (response) => {
          if (response.status() >= 400)
            proof.failures.push(
              `HTTP${response.status()} ${new URL(response.url()).pathname}`,
            );
        });
        const loaded = async (view) => {
          await expect(page.locator("#loading")).toBeHidden();
          await expect(page.locator("#content")).toBeVisible();
          await expect(page.locator("#testnet-banner")).toContainText(
            "15-MINUTE TEST ONLY",
          );
          await expect(page.locator("#testnet-banner")).toContainText(
            "15-minute omission and matching windows",
          );
          await expect(page.locator("#event-switch")).toHaveValue(
            scope.eventId,
          );
          await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute(
            "aria-selected",
            "true",
          );
          await expect(
            page.locator(".identity-panel .identity-address"),
          ).toHaveText(wallet.address);
        };
        await page.goto(
          origin +
            `/#event=${encodeURIComponent(scope.eventId)}&view=${role === "owner" ? "organizer" : "participant"}`,
        );
        await expect(page.locator("#loading")).toBeHidden();
        await expect(page.locator("#content")).toBeVisible();
        await expect(page.locator("#event-switch")).toHaveValue(scope.eventId);
        await page.locator("#top-identity").click();
        const authenticated = page.waitForResponse(
          (r) => r.url() === origin + "/api/auth/verify",
        );
        await page.locator("#review-dialog [data-connect-wallet]").click();
        must(
          (await authenticated).status() === 200,
          "Wallet nonce login failed",
        );
        await expect
          .poll(async () => {
            const b = assertBootstrap(
              await get(context.request, "/api/bootstrap"),
              manifest,
              instanceId,
            );
            must(
              authAcknowledged,
              "Bare auth poll started before nonce acknowledgement",
            );
            assertStatusSession(b, role, scope, instanceId);
            must(
              b.selectedEvent == null,
              "Bare auth poll returned an unsolicited selected payload",
            );
            return (
              b.session?.mode === "wallet" &&
              same(b.session.wallet, wallet.address)
            );
          })
          .toBe(true);
        const cookie = (await context.cookies(origin)).find(
          (c) => c.name === "kleros_session",
        );
        must(
          cookie?.secure && cookie.httpOnly && cookie.sameSite === "Strict",
          "D session cookie flags changed",
        );
        if (await page.locator("#review-dialog").isVisible())
          await page.locator("#review-dialog [data-close]").last().click();
        await loaded(role === "owner" ? "organizer" : "participant");
        const detail = currentBundledDetail();
        assertDStatusDetail(detail, role, before, summary, scope);
        const [apiBlock, head] = await Promise.all([
          provider.getBlock(detail.state.blockNumber),
          provider.getBlock("latest"),
        ]);
        assertApiSnapshot(detail, apiBlock, head, before.indexedBlock.number);
        await expect(page.locator("#deployment-details summary")).toBeVisible();
        await page.locator("#deployment-details summary").click();
        await expect(page.locator("#deployment-details")).toContainText(
          scope.contract,
        );
        if (role !== "owner") {
          await page.locator(".status-details summary").click();
          const participantFact = (label) =>
            page
              .locator(".state-fact")
              .filter({
                has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }),
              })
              .locator("dd strong");
          for (const [label, value] of [
            ["Admission", "Approved by host"],
            ["Contract registration", "Registered in this event contract"],
            ["Deposit receipt", units(scope.depositWei) + " · confirmed"],
          ])
            await expect(participantFact(label)).toHaveText(value);
          await expect(page.locator(".credit-summary strong")).toHaveText(
            "0 XDAI unused credit",
          );
          await expect(
            page.locator(
              '[data-tx="deposit"]:visible, [data-recovery="withdrawPending"]:visible',
            ),
          ).toHaveCount(0);
          await expect(participantFact("Attendance dispute")).toHaveText(
            role === "alice" || phase === "admitted"
              ? "No attendance challenge"
              : phase === "settled"
                ? "Challenge settled"
                : phase === "ruled"
                  ? "Final result · settlement pending"
                  : "Matched controlled test dispute · awaiting final result",
          );
          await expect(participantFact("Payout")).toHaveText(
            summary.paid[role] === "0"
              ? "No direct payout recorded"
              : units(summary.paid[role]) + " directly paid",
          );
          await expect(participantFact("Financial attendance")).toHaveText(
            phase === "admitted"
              ? "Not established on chain"
              : role === "alice" || phase === "settled"
                ? "Included in on-chain attendance"
                : "Under attendance challenge",
          );
        } else
          await expect(page.locator("#people-review tbody tr")).toHaveCount(2);
        const capture = async (suffix) => {
          await page.evaluate(() => scrollTo(0, 0));
          await page.evaluate(
            () =>
              new Promise((r) =>
                requestAnimationFrame(() => requestAnimationFrame(r)),
              ),
          );
          const file = path.join(output, `${role}-${suffix}.png`);
          await page.screenshot({ path: file, fullPage: true });
          proof.screenshots.push(path.relative(ROOT, file));
        };
        await capture(role === "owner" ? "manage" : "spot");
        const beforeCasesBundle = boundBundles.length;
        await page.locator('[data-view="cases"]').click();
        await loaded("cases");
        must(
          boundBundles.length > beforeCasesBundle,
          "Cases view did not capture a fresh selected bootstrap",
        );
        const casesDetail = currentBundledDetail();
        assertDStatusDetail(casesDetail, role, before, summary, scope);
        const [casesBlock, casesHead] = await Promise.all([
          provider.getBlock(casesDetail.state.blockNumber),
          provider.getBlock("latest"),
        ]);
        assertApiSnapshot(
          casesDetail,
          casesBlock,
          casesHead,
          before.indexedBlock.number,
        );
        const controls = statusControlExpectations(
          phase,
          casesDetail.now,
          casesDetail.state.challengeEndsAt,
        );
        await expect(page.locator('[data-tx="release"]')).toBeEnabled({
          enabled: controls.release,
        });
        await expect(page.locator(".case-card")).toHaveCount(
          controls.caseCount,
        );
        if (controls.caseCount)
          await expect(
            page.locator('.case-card [data-tx="resolve"]'),
          ).toBeEnabled({ enabled: controls.resolve });
        else await expect(page.locator('[data-tx="resolve"]')).toHaveCount(0);
        await expect(page.locator(".money-summary")).toBeVisible();
        for (const [label, value] of [
          ["Sent", summary.sentWei],
          ["Reserved case shares", summary.heldWei],
          ["Still owed", summary.owedWei],
        ])
          await expect(
            page
              .locator(".money-card")
              .filter({
                has: page.locator(".stat-label", {
                  hasText: new RegExp(`^${label}$`),
                }),
              })
              .locator("strong"),
          ).toHaveText(units(value));
        if (phase !== "admitted") {
          const fact = (label) =>
            page
              .locator(".case-card .details-list > div")
              .filter({
                has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }),
              })
              .locator("dd");
          await expect(fact("Resolver local ID")).toHaveText(
            before.bobCase.localDisputeID,
          );
          await expect(fact("Arbitrator dispute ID")).toHaveText(
            before.bobCase.arbitratorDisputeID,
          );
          await expect(fact("Final ruling")).toHaveText(
            before.bobCase.finalRuling === null ? "Not final" : "1 · Attended",
          );
          await expect(fact("Reserved share")).toHaveText(
            units(before.bobCase.heldShare),
          );
          await expect(page.locator(".case-card h3")).toContainText(
            phase === "settled"
              ? "Challenge settled"
              : phase === "ruled"
                ? "Final result available"
                : "Matched controlled test dispute",
          );
        } else await expect(page.locator(".case-card")).toHaveCount(0);
        if (["ordinary", "ruled"].includes(phase)) {
          await expect(page.locator("#event-panel")).toContainText(
            "Ordinary batch processed",
          );
          await expect(page.locator("#event-panel")).toContainText(
            "A Finalized phase does not establish that every case or payment is complete.",
          );
        }
        must(
          (await page.locator("[data-ruling]").count()) === 0,
          "A controlled operator ruling must never be represented as a UI jury control",
        );
        await capture("cases");
        for (const name of [
          "/loading.css",
          "/ui-keyboard.js",
          "/selected-event.js",
        ])
          must(
            proof.assetAudit
              .slice(roleAssetStart)
              .some(
                (audit) =>
                  audit.pathname === name &&
                  audit.verifiedSha256 === publicFiles.get(name),
              ),
            "A required new release asset was not observed and source-matched for this role",
          );
        must(
          !proof.failures.length && nonceSigned === 1,
          "D role UI had a request/runtime/privacy failure",
        );
        proof.roleProofs.push({
          role,
          wallet: wallet.address,
          ownWallet: detail.ownWallet,
          permissions: detail.permissions,
          uiBlock: detail.state.blockNumber,
          nonceSignatures: nonceSigned,
          participantWallets: detail.participants.map((p) => p.wallet),
          internallyBoundUiSnapshots: boundBundles
            .filter((bundle) => bundle.role === role)
            .map((bundle) => ({
              wallet: bundle.wallet,
              blockNumber: bundle.detail.state.blockNumber,
              paymentBlockHash: bundle.detail.payments.blockHash,
            })),
        });
      } finally {
        await context.close();
      }
    }
    must(
      proof.counts.browserSerialDetailReads === 0 &&
        proof.roleProofs.length === 3 &&
        proof.screenshots.length === 6 &&
        proof.counts.nonceSignatures === 3 &&
        proof.counts.financialSignatures === 0 &&
        proof.counts.broadcasts === 0,
      "Release status proof must include three authenticated roles, six captures and no serial fallback or financial action",
    );
    const after = await stateOf(c, provider, scope, resolver);
    must(
      quiet(before) === quiet(after),
      "D chain state changed during the read-only audit",
    );
    must(
      (await provider.getBlock(before.indexedBlock.number))?.hash ===
        before.indexedBlock.hash,
      "D snapshot anchor reorganized during audit",
    );
    proof.chainAfter = after;
    proof.status = "passed";
    proof.notice =
      "Nonce-authenticated role UI versus canonical D state; no financial signatures, broadcasts or guest-record writes.";
  } catch {
    proof.error =
      "D status audit stopped; signing/transport details redacted. No financial action exists in this auditor.";
    process.exitCode = 1;
  } finally {
    try {
      await browser?.close();
    } catch {
      proof.status = "stopped";
      proof.failures.push("Browser cleanup failed");
    }
    try {
      provider?.destroy();
    } finally {
      unlock?.();
    }
  }
  if (output)
    fs.writeFileSync(path.join(output, "proof.json"), publicJson(proof), {
      mode: 0o644,
      flag: "wx",
    });
  console.log(
    publicJson({
      status: proof.status,
      phase,
      proof: output
        ? path.relative(ROOT, path.join(output, "proof.json"))
        : null,
      counts: proof.counts,
      failures: proof.failures,
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "D status auditor stopped before access; no financial action is supported.",
    );
    process.exitCode = 1;
  });
