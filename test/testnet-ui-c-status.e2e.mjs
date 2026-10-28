import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ethers } from "ethers";
import {
  ROOT,
  readJson,
  publicJson,
  sha256,
  fingerprint,
  acquireLock,
  loadJournal,
  verifyCompiledInputs,
  assertTestnet,
} from "../src/testnet-config.mjs";
import {
  UI_C,
  validateUiCPlan,
  uiCCreateRequest,
} from "../scripts/testnet-ui-scenario.mjs";
import {
  assertPlanDeployment,
  assertNonce,
  assertBootstrap,
  assertPublishedAsset,
  stateOf,
  singleAttemptConnection,
} from "./testnet-ui-c.e2e.mjs";

// Independent observer. Auth nonces only; no transaction-signing/sending API.
export const C_STATUS_PHASES = [
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
export const allowedStatusHttp = (method, pathname, api, files) =>
  (method === "GET" &&
    (files.has(pathname === "/" ? "/index.html" : pathname) ||
      ["/api/bootstrap", api, api + "/deposit-inbox"].includes(pathname))) ||
  (method === "POST" &&
    ["/api/auth/challenge", "/api/auth/verify"].includes(pathname));

export function assertCStatusPhase(phase, state, payments, scope) {
  must(C_STATUS_PHASES.includes(phase), "Unknown C status phase");
  const D = BigInt(scope.depositWei),
    c = state.bobCase,
    paid = { alice: 0n, bob: 0n };
  must(
    scope.chainId === 10200 &&
      D === 1_000_000_000_000n &&
      same(state.owner, scope.owner),
    "Wrong C chain, principal or owner",
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
    must(role, "Unexpected C attendance recipient");
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
      "C collateral or matcher differs",
    );
  const expectedEscrow = settled ? 0n : escrow;
  const expectedReserved =
    (settled ? 0n : ordinary ? D : 2n * D) + expectedEscrow;
  must(
    state.challengeEscrow === String(expectedEscrow) &&
      state.reserved === String(expectedReserved) &&
      state.balance === String(expectedReserved) &&
      state.payoutShare === (ordinary || settled ? String(D) : "0"),
    "C pool, collateral, balance and protected reserves do not reconcile",
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
      "C is not admitted before attendance",
    );
  else {
    must(
      /^\d+$/.test(c.localDisputeID) && /^\d+$/.test(c.arbitratorDisputeID),
      "Dynamic C dispute IDs are missing",
    );
    must(
      state.attended.alice === true &&
        state.attended.bob === settled &&
        state.attendeeCount === (settled ? 2 : 1),
      "C attendance differs from the planned same-Bob case",
    );
    must(
      state.phase === (phase === "matched" ? "Listed" : "Finalized") &&
        c.state === (settled ? 3 : 2) &&
        c.finalRuling === (phase === "ruled" || settled ? 1 : null),
      "Ruling, ordinary batch and settlement are distinct C phases",
    );
    must(
      state.status.alice === (phase === "matched" ? 1 : 2) &&
        state.status.bob === (settled ? 2 : 1),
      "C registration/payment status differs",
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
        "C obligations remain after settlement",
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

export function assertCStatusDetail(data, role, state, summary, scope) {
  must(
    data.event?.id === scope.eventId &&
      same(data.event.contract, scope.contract) &&
      data.event.chainId === 10200 &&
      data.event.contractVersion === "kleros-event-v8" &&
      data.event.abiVersion === "kleros-event-v8",
    "API detail left the selected C deployment",
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
      `API C ${api} differs from pinned chain state`,
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
            p.name === `Synthetic UI C ${r === "alice" ? "Alice" : "Bob"}` &&
            p.email === `ui-c-${r}@example.test`,
        ),
      ),
    "C participant privacy or verified synthetic links differ",
  );
  const cases = data.state.cases;
  must(Array.isArray(cases), "C cases unavailable");
  if (state.bobCase.state === 0)
    must(cases.length === 0, "An admitted-only C view cannot invent a case");
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
      "API dynamic C dispute pair, finality or held share differs",
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
    "API C snapshot block/hash/time is not canonical and fresh",
  );
}

export function selfTest() {
  const scope = {
    chainId: 10200,
    depositWei: "1000000000000",
    owner: "owner",
    alice: "alice",
    bob: "bob",
    contract: "child-c",
    eventId: "event-c",
  };
  let accepted = 0,
    rejected = 0;
  for (const phase of C_STATUS_PHASES) {
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
    const summary = assertCStatusPhase(phase, s, p, scope);
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
      assert.throws(() => assertCStatusPhase(phase, bad, p, scope));
      rejected++;
    }
    const badPayment = clone(p);
    badPayment.attendancePaidWei = "999";
    assert.throws(() => assertCStatusPhase(phase, s, badPayment, scope));
    rejected++;
    const data = {
      event: {
        id: scope.eventId,
        contract: scope.contract,
        chainId: 10200,
        contractVersion: "kleros-event-v8",
        abiVersion: "kleros-event-v8",
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
          name: "Synthetic UI C Alice",
          email: "ui-c-alice@example.test",
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
    assertCStatusDetail(data, "alice", s, summary, scope);
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
      assert.throws(() => assertCStatusDetail(bad, "alice", s, summary, scope));
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
          assertCStatusDetail(bad, "alice", s, summary, scope),
        );
        rejected++;
      }
  }
  const files = new Set(["/index.html", "/app.js"]),
    api = "/api/events/event-c";
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
  console.log(
    publicJson({
      status: "passed",
      accepted,
      rejected,
      networkRequests: 0,
      signingFilesRead: 0,
      signatures: 0,
      broadcasts: 0,
    }),
  );
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--self-test") return selfTest();
  if (!argv.length)
    return console.log(
      publicJson({
        status: "review-only",
        phases: C_STATUS_PHASES,
        networkRequests: 0,
        signingFilesRead: 0,
        signatures: 0,
        broadcasts: 0,
        instruction:
          "After operator GO, UI_C_STATUS_EXECUTE=1 UI_C_APP_URL=exact-C-origin node test/testnet-ui-c-status.e2e.mjs --phase PHASE. Auth+GET only.",
      }),
    );
  must(
    argv.length === 2 &&
      argv[0] === "--phase" &&
      C_STATUS_PHASES.includes(argv[1]),
    "Choose one exact C status phase",
  );
  must(
    process.env.UI_C_STATUS_EXECUTE === "1",
    "C status execution is disabled; operator GO is required before any access",
  );
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
      },
      failures: [],
    };
  let provider, browser, unlock, output;
  try {
    const source = readJson(UI_C.sourceManifest),
      plan = validateUiCPlan(readJson(UI_C.plan), source),
      manifest = readJson(UI_C.manifest);
    must(
      process.env.UI_C_APP_URL === plan.publicOrigin &&
        manifest.publicOrigin === plan.publicOrigin &&
        manifest.events.length === 1 &&
        manifest.planFingerprint === fingerprint(plan),
      "Only the exact plan-bound separate C origin is allowed",
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
    unlock = acquireLock(UI_C.lock);
    const { artifacts, provenance } = verifyCompiledInputs();
    must(
      publicJson(provenance) === publicJson(manifest.provenance),
      "C compiled source provenance changed",
    );
    assertPlanDeployment(
      record,
      plan,
      loadJournal(UI_C.journal, plan),
      uiCCreateRequest(plan, artifacts),
      ethers.keccak256(artifacts.KlerosEventV8.bytecode),
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
    const summary = assertCStatusPhase(phase, before, payments, scope);
    const publicFiles = new Map();
    const walk = (folder) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile())
          publicFiles.set(
            "/" +
              path
                .relative(path.join(ROOT, "public"), file)
                .split(path.sep)
                .join("/"),
            sha256(fs.readFileSync(file)),
          );
      }
    };
    walk(path.join(ROOT, "public"));
    const origin = plan.publicOrigin,
      api = `/api/events/${encodeURIComponent(scope.eventId)}`;
    const get = async (client, pathname) => {
      must(["/api/bootstrap", api].includes(pathname), "Unexpected API read");
      proof.counts.http++;
      const response = await client.get(origin + pathname, {
        maxRedirects: 0,
        timeout: 60000,
      });
      must(response.status() === 200, "C read/health response failed");
      return response.json();
    };
    const preflight = await fetch(origin + "/api/bootstrap", {
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    must(preflight.status === 200, "C public readiness failed");
    proof.counts.http++;
    const bootstrap = assertBootstrap(await preflight.json(), manifest),
      instanceId = bootstrap.instanceId;
    const stat = fs.lstatSync(UI_C.wallets);
    must(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        (stat.mode & 0o077) === 0 &&
        (!process.getuid || stat.uid === process.getuid()),
      "C role keys must be owner-only regular files",
    );
    const keys = readJson(UI_C.wallets);
    must(
      keys.purpose === UI_C.purpose &&
        keys.chainId === 10200 &&
        Object.keys(keys.roles).sort().join() === "alice,bob,owner" &&
        ["alice", "bob", "owner"].every(
          (role) =>
            keys.roles[role].address === scope[role] &&
            new ethers.Wallet(keys.roles[role].privateKey).address ===
              scope[role],
        ),
      "C role key identities changed",
    );
    output = path.join(
      ROOT,
      "artifacts/ui-c",
      `status-${phase}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.mkdirSync(output, { recursive: false });
    proof.source = {
      origin,
      instanceId,
      planFingerprint: fingerprint(plan),
      manifestSha256: sha256(publicJson(manifest)),
      sourceManifestSha256: sha256(publicJson(source)),
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
        nonceVerified = 0;
      const refuse = (message) => {
        proof.failures.push(message);
        throw new Error(message);
      };
      await context.exposeBinding(
        "__cStatusWallet",
        async ({ frame }, method, params = []) => {
          must(
            !proof.failures.length &&
              new URL(frame.url()).origin === origin &&
              !frame.parentFrame(),
            "Wrong C wallet frame or prior failure",
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
            "Wrong exact C auth nonce",
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
              window.__cStatusWallet(method, params),
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
        try {
          must(
            !proof.failures.length &&
              u.origin === origin &&
              !u.search &&
              !u.username &&
              !u.password,
            "Unexpected origin/query or prior failure",
          );
          must(
            allowedStatusHttp(method, u.pathname, api, publicFiles),
            "Non-auth mutation or foreign C read forbidden",
          );
          const sourcePath = u.pathname === "/" ? "/index.html" : u.pathname;
          if (method === "GET" && publicFiles.has(sourcePath)) {
            const response = await route.fetch({
              maxRedirects: 0,
              timeout: 60000,
              headers: { "cache-control": "no-cache" },
            });
            must(response.status() === 200, "Static C source unavailable");
            proof.assetAudit.push(
              assertPublishedAsset(
                await response.body(),
                u.pathname,
                publicFiles.get(sourcePath),
              ),
            );
            return route.fulfill({ response });
          }
          if (
            method === "GET" &&
            ["/api/bootstrap", api, api + "/deposit-inbox"].includes(u.pathname)
          )
            return route.continue();
          const body = request.postDataJSON();
          if (method === "POST" && u.pathname === "/api/auth/challenge") {
            must(
              exact(body, ["wallet"]) &&
                same(body.wallet, wallet.address) &&
                nonceIssued++ === 0,
              "Wrong/extra C nonce request",
            );
            const response = await route.fetch({ maxRedirects: 0 });
            must(response.status() === 200, "C auth challenge failed");
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
              "Wrong/extra C auth verification",
            );
            const response = await route.fetch({ maxRedirects: 0 });
            must(response.status() === 200, "C auth verification failed");
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
          "C session cookie flags changed",
        );
        if (await page.locator("#review-dialog").isVisible())
          await page.locator("#review-dialog [data-close]").last().click();
        await loaded(role === "owner" ? "organizer" : "participant");
        const detail = await get(context.request, api);
        assertCStatusDetail(detail, role, before, summary, scope);
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
          const payout = page
            .locator(".state-fact")
            .filter({ has: page.locator("dt", { hasText: /^Payout$/ }) });
          await expect(payout).toContainText(
            summary.paid[role] === "0"
              ? "No direct payout recorded"
              : units(summary.paid[role]) + " directly paid",
          );
          const attendance = page
            .locator(".state-fact")
            .filter({
              has: page.locator("dt", { hasText: /^Financial attendance$/ }),
            });
          await expect(attendance).toContainText(
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
        await page.locator('[data-view="cases"]').click();
        await loaded("cases");
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
        must(
          !proof.failures.length && nonceSigned === 1,
          "C role UI had a request/runtime/privacy failure",
        );
        proof.roleProofs.push({
          role,
          wallet: wallet.address,
          ownWallet: detail.ownWallet,
          permissions: detail.permissions,
          uiBlock: detail.state.blockNumber,
          nonceSignatures: nonceSigned,
          participantWallets: detail.participants.map((p) => p.wallet),
        });
      } finally {
        await context.close();
      }
    }
    const after = await stateOf(c, provider, scope, resolver);
    must(
      quiet(before) === quiet(after),
      "C chain state changed during the read-only audit",
    );
    must(
      (await provider.getBlock(before.indexedBlock.number))?.hash ===
        before.indexedBlock.hash,
      "C snapshot anchor reorganized during audit",
    );
    proof.chainAfter = after;
    proof.status = "passed";
    proof.notice =
      "Nonce-authenticated role UI versus canonical C state; no financial signatures, broadcasts or guest-record writes.";
  } catch {
    proof.error =
      "C status audit stopped; signing/transport details redacted. No financial action exists in this auditor.";
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
      "C status auditor stopped before access; no financial action is supported.",
    );
    process.exitCode = 1;
  });
