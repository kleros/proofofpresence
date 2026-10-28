import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect as baseExpect } from "@playwright/test";
import { ethers } from "ethers";
import { loadV8Artifacts } from "../src/contracts-v8.mjs";

// Strict read-only phase audit. The only signatures are exact server-issued
// EIP191 wallet-login challenges; no contract signing, sending, fixture updates,
// publication, time travel or other API mutation is supported.
// node test/testnet-status.e2e.mjs --phase matched|ordinary|ruled|settled
// node test/testnet-status.e2e.mjs --self-test  (pure local guards, no private keys/network)
const ORIGIN = "https://kleros-event-workbench-preview.netlify.app";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const expect = baseExpect.configure({ timeout: 60_000 });
const STAGES = ["matched", "ordinary", "ruled", "settled"];
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
class AuditFailure extends Error {
  constructor(message, code = "AUDIT_FAILED") {
    super(message);
    this.code = code;
  }
}
const must = (condition, message, code) => {
  if (!condition) throw new AuditFailure(message, code);
};
let checks = 0;
const check = (condition, message, code) => {
  must(condition, message, code);
  checks++;
};
const amount = (value) => BigInt(value ?? "0");
const readJson = (relative) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
function financialSummary(detail) {
  const s = detail.state;
  return Object.fromEntries(
    [
      "phase",
      "stakerCount",
      "poolWei",
      "balanceWei",
      "pendingTotalWei",
      "pendingChallenges",
      "heldBackWei",
      "owedTotalWei",
      "challengeEscrowWei",
      "payoutShareWei",
      "challengeEndsAt",
    ].map((k) => [k, s[k]]),
  );
}
export function auditPhase(phase, a, b, baseline, addresses) {
  must(STAGES.includes(phase), "Choose a documented audit phase");
  const s = a.state,
    c = s.cases.find((item) => same(item.wallet, addresses.bob));
  must(
    c?.matched === true &&
      c.localDisputeID === baseline.resolverLocalDisputeId &&
      c.arbitratorDisputeID === baseline.arbitratorDisputeId,
    "The target is Bob’s exact matched resolver/Court case",
  );
  const observed =
    s.phase === "Listed" && c.state === "Disputed" && c.finalRuling === null
      ? "matched"
      : s.phase === "Finalized" &&
          c.state === "Disputed" &&
          c.finalRuling === null
        ? "ordinary"
        : s.phase === "Finalized" &&
            c.state === "Disputed" &&
            [0, 1, 2].includes(c.finalRuling)
          ? "ruled"
          : s.phase === "Finalized" &&
              c.state === "Resolved" &&
              [0, 1, 2].includes(c.finalRuling)
            ? "settled"
            : "unexpected";
  must(
    observed === phase,
    `Expected ${phase}; observed ${observed}. No transaction was attempted.`,
    "PHASE_MISMATCH",
  );
  const D = amount(s.depositWei),
    sent = amount(a.payments.attendancePaidWei);
  must(
    D > 0n &&
      s.stakerCount === 3 &&
      amount(s.poolWei) === 3n * D &&
      amount(s.pendingTotalWei) === 0n,
    "The reviewed three-person committed pool is intact",
  );
  for (const key of [
    "phase",
    "stakerCount",
    "poolWei",
    "balanceWei",
    "pendingChallenges",
    "heldBackWei",
    "owedTotalWei",
    "pendingTotalWei",
    "challengeEscrowWei",
  ])
    must(
      b.state[key] === baseline.eventB.state[key],
      `Event B ${key} changed from the independent matched checkpoint`,
    );
  must(
    b.state.cases.length === 0 && amount(b.payments.attendancePaidWei) === 0n,
    "Event B has no case or attendance payout from A’s progression",
  );
  if (phase === "matched")
    must(
      sent === 0n &&
        amount(s.heldBackWei) === 0n &&
        amount(s.payoutShareWei) === 0n &&
        s.pendingChallenges === 1,
      "Before the ordinary batch, sent and held shares are zero while the pool is reserved",
    );
  if (["ordinary", "ruled"].includes(phase))
    must(
      sent === 2n * D &&
        amount(s.heldBackWei) === D &&
        amount(c.heldShareWei) === D &&
        amount(s.payoutShareWei) === D &&
        s.pendingChallenges === 1,
      "Ordinary attendees received two shares while Bob’s full unresolved share remains held",
    );
  if (phase === "settled")
    must(
      sent === 3n * D &&
        amount(s.heldBackWei) === 0n &&
        amount(c.heldShareWei) === 0n &&
        s.pendingChallenges === 0 &&
        amount(s.challengeEscrowWei) === 0n,
      "Settlement releases or redistributes the held share and completes the case",
    );
  must(
    amount(s.owedTotalWei) === 0n &&
      amount(a.payments.outstandingCreditsWei) === 0n,
    "Failed-transfer credits remain separately reported; this planned EOA rehearsal requires none outstanding",
  );
  const paid = {};
  for (const transfer of a.payments.transfers.filter(
    (t) => t.type === "attendance-payout",
  )) {
    must(
      transfer.successful === true,
      "A failed transfer cannot be counted as a successful kickback",
    );
    const key = String(transfer.wallet).toLowerCase();
    paid[key] = (paid[key] ?? 0n) + amount(transfer.amountWei);
  }
  const expectedEach =
    phase === "matched"
      ? 0n
      : phase !== "settled" || c.finalRuling === 1
        ? D
        : (3n * D) / 2n;
  must(
    (paid[addresses.alice.toLowerCase()] ?? 0n) === expectedEach &&
      (paid[addresses.carol.toLowerCase()] ?? 0n) === expectedEach,
    "Alice and Carol have the expected equal canonical attendance entitlements",
  );
  must(
    (paid[addresses.bob.toLowerCase()] ?? 0n) ===
      (phase === "settled" && c.finalRuling === 1 ? D : 0n),
    "Bob’s attendance share follows the final ruling separately from Court collateral",
  );
  return {
    observed,
    case: c,
    expectedEachWei: String(expectedEach),
    sentAttendanceWei: String(sent),
    owedWei: String(s.owedTotalWei),
    eventA: financialSummary(a),
    eventB: financialSummary(b),
  };
}
function selfTest() {
  const addresses = { alice: "alice", bob: "bob", carol: "carol" };
  const B = {
    phase: "Listed",
    stakerCount: 1,
    poolWei: "2",
    balanceWei: "2",
    pendingChallenges: 0,
    heldBackWei: "0",
    owedTotalWei: "0",
    pendingTotalWei: "0",
    challengeEscrowWei: "0",
    cases: [],
  };
  const baseline = {
    resolverLocalDisputeId: "0",
    arbitratorDisputeId: "1000",
    eventB: { state: B },
  };
  const state = {
    phase: "Listed",
    depositWei: "10",
    stakerCount: 3,
    poolWei: "30",
    pendingTotalWei: "0",
    heldBackWei: "0",
    payoutShareWei: "0",
    owedTotalWei: "0",
    pendingChallenges: 1,
    challengeEscrowWei: "3",
    cases: [
      {
        wallet: "bob",
        matched: true,
        localDisputeID: "0",
        arbitratorDisputeID: "1000",
        state: "Disputed",
        finalRuling: null,
        heldShareWei: "0",
      },
    ],
  };
  const fixture = {
      state,
      payments: {
        attendancePaidWei: "0",
        outstandingCreditsWei: "0",
        transfers: [],
      },
    },
    independent = { state: B, payments: { attendancePaidWei: "0" } };
  let assertions = 0;
  const validate = (phase, data = fixture, b = independent) => {
    auditPhase(phase, data, b, baseline, addresses);
    assertions++;
  };
  validate("matched");
  const ordinary = structuredClone(fixture);
  Object.assign(ordinary.state, {
    phase: "Finalized",
    heldBackWei: "10",
    payoutShareWei: "10",
  });
  ordinary.state.cases[0].heldShareWei = "10";
  ordinary.payments.attendancePaidWei = "20";
  ordinary.payments.transfers = ["alice", "carol"].map((wallet) => ({
    wallet,
    type: "attendance-payout",
    successful: true,
    amountWei: "10",
  }));
  validate("ordinary", ordinary);
  const ruled = structuredClone(ordinary);
  ruled.state.cases[0].finalRuling = 2;
  validate("ruled", ruled);
  for (const ruling of [0, 1, 2]) {
    const settled = structuredClone(ruled);
    Object.assign(settled.state, {
      heldBackWei: "0",
      pendingChallenges: 0,
      challengeEscrowWei: "0",
    });
    Object.assign(settled.state.cases[0], {
      state: "Resolved",
      finalRuling: ruling,
      heldShareWei: "0",
    });
    settled.payments.attendancePaidWei = "30";
    settled.payments.transfers = [
      "alice",
      "carol",
      ...(ruling === 1 ? ["bob"] : []),
    ].map((wallet) => ({
      wallet,
      type: "attendance-payout",
      successful: true,
      amountWei: ruling === 1 ? "10" : "15",
    }));
    validate("settled", settled);
  }
  for (const mutate of [
    (x) => (x.state.cases[0].localDisputeID = "1000"),
    (x) => (x.state.cases[0].matched = false),
    (x) => (x.state.heldBackWei = "10"),
    (x) => (x.state.owedTotalWei = "1"),
    (x) => (x.payments.attendancePaidWei = "10"),
  ]) {
    const bad = structuredClone(fixture);
    mutate(bad);
    let rejected = false;
    try {
      validate("matched", bad);
    } catch {
      rejected = true;
    }
    must(rejected, "A negative local guard was not rejected");
    assertions++;
  }
  let wrongPhase = false;
  try {
    validate("settled", ruled);
  } catch {
    wrongPhase = true;
  }
  must(wrongPhase, "Final resolver ruling cannot imply event settlement");
  assertions++;
  let drift = false;
  try {
    validate("matched", fixture, {
      ...independent,
      state: { ...B, balanceWei: "1" },
    });
  } catch {
    drift = true;
  }
  must(drift, "Independent event drift cannot pass silently");
  assertions++;
  console.log(
    JSON.stringify(
      {
        status: "passed",
        scope: "pure local read-only phase guards",
        assertions,
        networkRequests: 0,
        contractTransactions: 0,
      },
      null,
      2,
    ),
  );
}
async function main(phase) {
  let browser;
  const actors = [],
    walletMethods = [],
    networkFailures = [],
    pageFailures = [],
    httpFailures = [];
  let navigation = 0,
    stage = "configuration";
  const runId = `${phase}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const screenshotRelative = `artifacts/screenshots/testnet-status/${runId}`;
  const screenshots = path.join(ROOT, screenshotRelative);
  const archivedProof = `artifacts/testnet-status/${runId}/proof.json`;
  const out = path.join(ROOT, `artifacts/testnet-status-${phase}.json`);
  const capturedScreenshots = [];
  const sourceContext = {};
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const saveProof = (proof) => {
    Object.assign(proof, { runId, archivedProof, sourceContext, httpFailures });
    fs.mkdirSync(path.dirname(path.join(ROOT, archivedProof)), {
      recursive: true,
    });
    const bytes = JSON.stringify(proof, null, 2) + "\n";
    fs.writeFileSync(path.join(ROOT, archivedProof), bytes, { flag: "wx" });
    const temp = `${out}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, bytes, { flag: "wx" });
    fs.renameSync(temp, out);
  };
  try {
    const configured = new URL(process.env.TESTNET_APP_URL ?? ORIGIN);
    check(
      configured.origin === ORIGIN &&
        configured.pathname === "/" &&
        !configured.search &&
        !configured.hash &&
        !configured.username &&
        !configured.password,
      "Only the designated HTTPS application is allowed",
    );
    const manifest = readJson("registry/chiado-v8-controlled.json"),
      baseline = readJson("artifacts/chiado-dispute-proof.json");
    check(
      manifest.environment === "testnet" &&
        manifest.chain.chainId === 10200 &&
        manifest.arbitration.mode === "controlled" &&
        baseline.chainId === 10200 &&
        same(
          baseline.eventA.contract,
          manifest.events[0].deployment.contract,
        ) &&
        same(baseline.eventB.contract, manifest.events[1].deployment.contract),
      "Manifest and matched checkpoint identify this exact controlled Chiado deployment",
    );
    const [recordA, recordB] = manifest.events,
      addresses = manifest.rehearsalAddresses;
    sourceContext.manifestSha256 = digest(
      fs.readFileSync(path.join(ROOT, "registry/chiado-v8-controlled.json")),
    );
    sourceContext.matchedCheckpointSha256 = digest(
      fs.readFileSync(path.join(ROOT, "artifacts/chiado-dispute-proof.json")),
    );
    sourceContext.harnessSha256 = digest(
      fs.readFileSync(fileURLToPath(import.meta.url)),
    );
    const target = (relative) => {
      const u = new URL(relative, ORIGIN);
      check(
        u.origin === ORIGIN && !u.username && !u.password,
        "Requests remain on the designated application origin",
      );
      return u.href;
    };
    const publicGet = async (relative) => {
      const started = performance.now();
      const response = await fetch(target(relative), {
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = /^[A-Z][A-Z0-9_]{0,60}$/.test(body?.code ?? "")
          ? body.code
          : "UNAVAILABLE";
        const failure = {
          path: new URL(target(relative)).pathname,
          status: response.status,
          code,
          elapsedMs: Math.round(performance.now() - started),
        };
        httpFailures.push(failure);
        check(
          false,
          `GET ${failure.path} returned HTTP${failure.status}, code ${failure.code}, after ${failure.elapsedMs}ms`,
        );
      }
      return response.json();
    };
    const rpc = async (calls) => {
      check(
        calls.length > 0 &&
          calls.length <= 50 &&
          calls.every((c) =>
            [
              "eth_chainId",
              "eth_call",
              "eth_getBalance",
              "eth_getBlockByNumber",
              "eth_getTransactionReceipt",
              "eth_getTransactionByHash",
            ].includes(c.method),
          ),
        "RPC helper accepts bounded reads only",
      );
      const response = await fetch(target("/rpc"), {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(
          calls.map((c, i) => ({
            jsonrpc: "2.0",
            id: i,
            method: c.method,
            params: c.params ?? [],
          })),
        ),
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
      check(response.ok, `Read-only RPC returned HTTP${response.status}`);
      const results = await response.json();
      check(
        Array.isArray(results) &&
          results.length === calls.length &&
          results.every((r) => !r.error),
        "Every read-only RPC call returns a result",
      );
      return calls.map((_, i) => results.find((r) => r.id === i).result);
    };
    const frontendResponse = await fetch(target("/app.js"), {
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    check(frontendResponse.ok, "The audited live frontend source is available");
    sourceContext.liveFrontendSha256 = digest(
      new Uint8Array(await frontendResponse.arrayBuffer()),
    );
    const bootstrap = await publicGet("/api/bootstrap");
    sourceContext.backendInstanceId = bootstrap.instanceId;
    sourceContext.eventA = recordA.deployment.contract;
    sourceContext.eventB = recordB.deployment.contract;
    check(
      bootstrap.mode === "hosted-testnet" &&
        bootstrap.chain.chainId === 10200 &&
        bootstrap.chain.nativeCurrency.symbol === "XDAI" &&
        bootstrap.arbitration.mode === "controlled",
      "Live app identifies controlled v8 Chiado/XDAI",
    );
    const [a, b] = await Promise.all([
      publicGet(`/api/events/${recordA.definition.id}`),
      publicGet(`/api/events/${recordB.definition.id}`),
    ]);
    for (const [detail, record] of [
      [a, recordA],
      [b, recordB],
    ])
      check(
        detail.event.id === record.definition.id &&
          detail.event.chainId === 10200 &&
          detail.event.contractVersion === "kleros-event-v8" &&
          detail.event.abiVersion === "kleros-event-v8" &&
          same(detail.event.contract, record.deployment.contract),
        "Every audited API event is its exact trusted v8 child on Chiado",
      );
    sourceContext.eventASnapshotBlock = a.state.blockNumber;
    sourceContext.eventASnapshotHash = a.payments.blockHash;
    sourceContext.eventBSnapshotBlock = b.state.blockNumber;
    sourceContext.eventBSnapshotHash = b.payments.blockHash;
    const summary = auditPhase(phase, a, b, baseline, addresses);
    check(
      same(
        summary.case.caseOrganizer,
        baseline.eventA.state.cases[0].caseOrganizer,
      ),
      "The case retains its organizer snapshot from the canonical matching checkpoint",
    );
    checks++;
    const eventInterface = new ethers.Interface(loadV8Artifacts().event.abi),
      resolverInterface = new ethers.Interface(
        readJson("references/kickback/build/MockArbitrableProxy.json").abi,
      );
    const block = ethers.toQuantity(a.state.blockNumber),
      call = (name, args = []) => ({
        method: "eth_call",
        params: [
          {
            to: recordA.deployment.contract,
            data: eventInterface.encodeFunctionData(name, args),
          },
          block,
        ],
      });
    stage = "canonical pinned public-chain state";
    const names = [
      "phase",
      "pendingChallenges",
      "heldBack",
      "owedTotal",
      "challengeEscrow",
      "payoutShare",
      "pendingTotal",
      "challengeEndsAt",
    ];
    const raw = await rpc([
      { method: "eth_chainId" },
      ...names.map((n) => call(n)),
      call("challenges", [addresses.bob]),
      {
        method: "eth_getBalance",
        params: [recordA.deployment.contract, block],
      },
      { method: "eth_getBlockByNumber", params: [block, false] },
    ]);
    check(BigInt(raw[0]) === 10200n, "Public RPC is Chiado10200");
    const decoded = Object.fromEntries(
      names.map((n, i) => [
        n,
        eventInterface.decodeFunctionResult(n, raw[i + 1])[0],
      ]),
    );
    check(
      Number(decoded.phase) === (a.state.phase === "Listed" ? 1 : 2) &&
        String(decoded.pendingChallenges) === String(a.state.pendingChallenges),
      "API phase and pending count equal pinned chain state",
    );
    for (const [method, field] of [
      ["heldBack", "heldBackWei"],
      ["owedTotal", "owedTotalWei"],
      ["challengeEscrow", "challengeEscrowWei"],
      ["payoutShare", "payoutShareWei"],
      ["pendingTotal", "pendingTotalWei"],
      ["challengeEndsAt", "challengeEndsAt"],
    ])
      check(
        String(decoded[method]) === String(a.state[field]),
        `${field} equals the pinned chain call`,
      );
    const challenge = eventInterface.decodeFunctionResult(
      "challenges",
      raw[names.length + 1],
    );
    check(
      Number(challenge.state) === (phase === "settled" ? 3 : 2) &&
        String(challenge.localDisputeID) === summary.case.localDisputeID &&
        String(challenge.arbitratorDisputeID) ===
          summary.case.arbitratorDisputeID &&
        String(challenge.heldShare) === summary.case.heldShareWei,
      "Matched IDs, state and held share equal the exact target contract",
    );
    check(
      String(BigInt(raw[names.length + 2])) === a.state.balanceWei &&
        same(raw[names.length + 3].hash, a.payments.blockHash) &&
        Number(BigInt(raw[names.length + 3].timestamp)) === a.state.now,
      "API money snapshot uses a canonical block and exact chain time",
    );
    const [resolverData] = await rpc([
      {
        method: "eth_call",
        params: [
          {
            to: recordA.deployment.resolver,
            data: resolverInterface.encodeFunctionData("disputes", [
              summary.case.localDisputeID,
            ]),
          },
          block,
        ],
      },
    ]);
    const dispute = resolverInterface.decodeFunctionResult(
      "disputes",
      resolverData,
    );
    check(
      dispute.isRuled === ["ruled", "settled"].includes(phase) &&
        (!dispute.isRuled ||
          Number(dispute.ruling) === summary.case.finalRuling),
      "A final resolver result and event settlement remain separate facts",
    );
    const transfers = a.payments.transfers.filter(
      (t) => t.type === "attendance-payout",
    );
    const receipts = new Map();
    for (const hash of new Set(transfers.map((t) => t.txHash))) {
      const [receipt, tx] = await rpc([
        { method: "eth_getTransactionReceipt", params: [hash] },
        { method: "eth_getTransactionByHash", params: [hash] },
      ]);
      check(
        receipt &&
          BigInt(receipt.status) === 1n &&
          tx &&
          BigInt(tx.chainId) === 10200n &&
          same(tx.to, recordA.deployment.contract),
        "Attendance transfer has an actual successful transaction to this child",
      );
      const [canonical] = await rpc([
        {
          method: "eth_getBlockByNumber",
          params: [receipt.blockNumber, false],
        },
      ]);
      check(
        same(canonical.hash, receipt.blockHash),
        "Attendance transfer receipt remains canonical",
      );
      receipts.set(hash, receipt);
    }
    for (const transfer of transfers) {
      const log = receipts
        .get(transfer.txHash)
        .logs.find(
          (l) =>
            Number(BigInt(l.logIndex)) === transfer.logIndex &&
            same(l.address, recordA.deployment.contract),
        );
      const parsed = log ? eventInterface.parseLog(log) : null;
      check(
        parsed?.name === "Payout" &&
          same(parsed.args.to, transfer.wallet) &&
          String(parsed.args.amount) === transfer.amountWei,
        "The sent total is backed by exact successful Payout logs, not contract balance",
      );
    }
    const keyPath = path.join(ROOT, ".runtime/testnet/chiado-deployer.json"),
      info = fs.lstatSync(keyPath);
    check(
      info.isFile() &&
        !info.isSymbolicLink() &&
        (info.mode & 0o077) === 0 &&
        (process.getuid === undefined || info.uid === process.getuid()),
      "Disposable login keys stay in the owner-only local signing file",
    );
    const secret = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    check(
      secret.chainId === 10200 &&
        secret.purpose === "Disposable Chiado controlled rehearsal only",
      "Only dedicated testnet wallets may sign login messages",
    );
    browser = await chromium.launch();
    for (const role of ["bob", "ownerA", "alice"]) {
      const view = role === "alice" ? "participant" : "cases";
      stage = `${role}: read-only wallet login and loaded ${view} view`;
      const wallet = new ethers.Wallet(secret.roles[role].privateKey);
      check(
        same(wallet.address, addresses[role]),
        "Login wallet matches the public rehearsal role",
      );
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      context.setDefaultTimeout(60000);
      actors.push(context);
      const issued = new Map();
      await context.exposeBinding(
        "__statusAuditWallet",
        async ({ frame }, method, params) => {
          check(
            new URL(frame.url()).origin === ORIGIN,
            "Wallet requests originate only at the audited app",
          );
          walletMethods.push(method);
          if (method === "eth_chainId") return "0x27d8";
          if (["eth_accounts", "eth_requestAccounts"].includes(method))
            return [wallet.address];
          check(
            method === "personal_sign",
            "No contract transaction signing or submission is supported",
          );
          check(
            Array.isArray(params) &&
              params.length === 2 &&
              same(params[1], wallet.address),
            "Signature request uses this exact role wallet",
          );
          const message = ethers.toUtf8String(params[0]),
            challenge = issued.get(message);
          check(
            challenge &&
              challenge.expiresAt > Date.now() &&
              message.startsWith("Kleros Chiado testnet workbench\n") &&
              message.includes(`Domain: ${new URL(ORIGIN).host}\n`) &&
              message.includes(`URI: ${ORIGIN}\n`) &&
              message.includes("Chain ID: 10200\n") &&
              message.includes(`Wallet: ${wallet.address}\n`) &&
              message.endsWith(
                "Authenticate this testnet wallet. No financial transaction.",
              ),
            "Only an exact fresh origin/chain/wallet-bound login challenge may be signed",
          );
          issued.delete(message);
          return wallet.signMessage(message);
        },
      );
      await context.addInitScript(() => {
        window.ethereum = {
          request: ({ method, params = [] }) =>
            window.__statusAuditWallet(method, params),
          on() {},
          removeListener() {},
        };
      });
      await context.route("**/*", async (route) => {
        const request = route.request(),
          u = new URL(request.url());
        try {
          check(
            u.origin === ORIGIN,
            "Browser network stays on the audited app origin",
          );
          if (!["GET", "HEAD"].includes(request.method())) {
            check(
              request.method() === "POST" &&
                ["/api/auth/challenge", "/api/auth/verify"].includes(
                  u.pathname,
                ),
              "Only wallet authentication may mutate application session state",
            );
            if (u.pathname === "/api/auth/challenge") {
              const body = request.postDataJSON();
              check(
                same(body.wallet, wallet.address),
                "Challenge belongs to this role",
              );
              const response = await route.fetch({ maxRedirects: 0 });
              check(
                response.status() === 200,
                "Actual app issues the nonce challenge",
              );
              const bodyResponse = await response.json();
              issued.set(bodyResponse.message, bodyResponse);
              return route.fulfill({ response });
            }
          }
          return route.continue();
        } catch {
          networkFailures.push("Unexpected destination or mutation blocked");
          return route.abort("blockedbyclient");
        }
      });
      const page = await context.newPage();
      page.on("pageerror", () => pageFailures.push("Browser runtime error"));
      page.on("response", (response) => {
        const u = new URL(response.url());
        if (
          u.origin === ORIGIN &&
          u.pathname.startsWith("/api/") &&
          response.status() >= 400
        )
          httpFailures.push({ path: u.pathname, status: response.status() });
        if (
          response.status() >= 400 &&
          ["script", "stylesheet", "font", "image"].includes(
            response.request().resourceType(),
          )
        )
          pageFailures.push("Missing asset");
      });
      stage = `${role}: initial public navigation`;
      await page.goto(
        target(
          `/?status_audit=${phase}-${role}-${++navigation}#${new URLSearchParams({ event: recordA.definition.id, view })}`,
        ),
      );
      stage = `${role}: initial public content loaded`;
      await expect(page.locator("#content")).toBeVisible();
      await expect(page.locator("#loading")).toBeHidden();
      await expect(page.locator(`#tab-${view}`)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      if (view === "cases")
        await expect(
          page.getByRole("heading", {
            name: "Kickbacks & payments",
            exact: true,
          }),
        ).toBeVisible();
      else await expect(page.locator(".next-action")).toBeVisible();
      await expect(page.locator("#testnet-banner")).toContainText(
        /controlled.*arbitrat|no independent jury/i,
      );
      stage = `${role}: open wallet login dialog`;
      await page.locator("#top-identity").click();
      const verified = page.waitForResponse(
        (r) =>
          r.url() === target("/api/auth/verify") &&
          r.request().method() === "POST",
      );
      stage = `${role}: submit and wait for exact signed wallet login`;
      await page.locator("#review-dialog [data-connect-wallet]").click();
      const verifiedResponse = await verified;
      check(
        verifiedResponse.status() === 200,
        `Wallet login returned HTTP${verifiedResponse.status()}`,
      );
      stage = `${role}: verified wallet label and loaded authenticated content`;
      await expect(page.locator("#top-identity")).toHaveText(
        "Verified browser wallet",
      );
      await expect(page.locator("#loading")).toBeHidden();
      const modal = page.locator("#review-dialog");
      if (await modal.isVisible())
        await page.locator("#review-dialog [data-close]").last().click();
      stage = `${role}: authenticated bootstrap and isolated session cookie`;
      const sessionResponse = await context.request.get(
        target("/api/bootstrap"),
        { maxRedirects: 0, timeout: 60000 },
      );
      check(
        sessionResponse.status() === 200,
        "Authenticated bootstrap is available",
      );
      const session = await sessionResponse.json();
      check(
        session.session?.mode === "wallet" &&
          same(session.session.wallet, wallet.address),
        "Each browser context has only its own real signed wallet session",
      );
      const cookie = (await context.cookies(ORIGIN)).find(
        (c) => c.name === "kleros_session",
      );
      check(
        cookie?.secure && cookie.httpOnly && cookie.sameSite === "Strict",
        "Session cookie is secure and isolated",
      );
      stage = `${role}: authenticated event and own-wallet facts`;
      const roleResponse = await context.request.get(
        target(`/api/events/${recordA.definition.id}`),
        { maxRedirects: 0, timeout: 60000 },
      );
      check(
        roleResponse.status() === 200,
        "Authenticated event detail is available for this role",
      );
      const roleDetail = await roleResponse.json();
      check(
        roleDetail.event.id === recordA.definition.id &&
          roleDetail.event.chainId === 10200 &&
          roleDetail.event.contractVersion === "kleros-event-v8" &&
          same(roleDetail.event.contract, recordA.deployment.contract),
        "Each authenticated role is bound to the exact selected event and child",
      );
      check(
        same(roleDetail.ownWallet?.wallet, wallet.address),
        "Loaded own-wallet facts belong to the authenticated wallet",
      );
      if (role !== "ownerA")
        check(
          roleDetail.participants.length === 1 &&
            roleDetail.participants[0].eventId === recordA.definition.id &&
            same(roleDetail.participants[0].wallet, wallet.address),
          "The loaded participant is this signed wallet in this event, never an anonymous or foreign zero-value view",
        );
      auditPhase(phase, roleDetail, b, baseline, addresses);
      const assertView = async (requested) => {
        stage = `${role}: loaded ${requested} UI with exact event, wallet and contract`;
        await expect(page.locator("#content")).toBeVisible();
        await expect(page.locator("#loading")).toBeHidden();
        await expect(page.locator("#event-switch")).toHaveValue(
          recordA.definition.id,
        );
        await expect(page.locator(`#tab-${requested}`)).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(page.locator(".identity-address")).toContainText(
          wallet.address,
        );
        await expect(page.locator("#deployment-details")).toContainText(
          recordA.deployment.contract,
        );
      };
      const assertParticipant = async (personRole) => {
        await assertView("participant");
        const status = page.locator(".status-details");
        if (!(await status.evaluate((element) => element.open)))
          await status.locator("summary").click();
        const fact = (label) =>
          page
            .locator(".state-fact")
            .filter({ has: page.getByText(label, { exact: true }) })
            .locator("dd strong");
        const expected =
          personRole === "alice"
            ? amount(summary.expectedEachWei)
            : phase === "settled" && summary.case.finalRuling === 1
              ? amount(a.state.depositWei)
              : 0n;
        if (expected === 0n)
          await expect(fact("Payout")).toHaveText("No direct payout recorded");
        else {
          const text = await fact("Payout").innerText();
          check(
            /^\d+(\.\d{1,18})? XDAI directly paid$/.test(text) &&
              ethers.parseEther(text.split(" ")[0]) === expected,
            "The participant’s actual direct attendance payment matches this phase",
          );
        }
        if (personRole === "bob") {
          await expect(fact("Financial attendance")).toHaveText(
            phase === "settled"
              ? summary.case.finalRuling === 1
                ? "Included in on-chain attendance"
                : "Excluded after final case settlement"
              : "Under attendance challenge",
          );
          await expect(fact("Attendance dispute")).toHaveText(
            phase === "settled"
              ? "Challenge settled"
              : phase === "ruled"
                ? "Final result · settlement pending"
                : "Matched controlled test dispute · awaiting final result",
          );
        }
        if (personRole === "alice")
          await expect(fact("Financial attendance")).toHaveText(
            "Included in on-chain attendance",
          );
      };
      await assertView(view);
      if (role === "alice") {
        await assertParticipant("alice");
        const status = page.locator(".status-details");
        await expect(status).toBeVisible();
        if (!(await status.evaluate((element) => element.open)))
          await status.locator("summary").click();
        const payout = page
          .locator(".state-fact")
          .filter({ has: page.getByText("Payout", { exact: true }) })
          .locator("dd strong");
        const text = await payout.innerText();
        const expected = amount(summary.expectedEachWei);
        if (expected === 0n)
          await expect(payout).toHaveText("No direct payout recorded");
        else {
          check(
            /^\d+(\.\d{1,18})? XDAI directly paid$/.test(text),
            "Alice’s delivered payment is labeled as a direct canonical transfer",
          );
          check(
            ethers.parseEther(text.split(" ")[0]) === expected,
            "Alice’s participant view matches her actual cumulative attendance payment",
          );
        }
        if (["ordinary", "ruled"].includes(phase)) {
          await expect(
            page.locator(".participation-steps li").last(),
          ).toContainText("Payment recorded · top-ups may follow");
          check(
            !/fully settled|all payments complete/i.test(
              await page.locator(".participation-steps").innerText(),
            ),
            "An ordinary payment cannot imply final settlement before top-ups",
          );
        }
      } else {
        stage = `${role}: case IDs, real deadlines and exact financial UI facts`;
        const card = page.locator(".case-card");
        await expect(card).toHaveCount(1);
        const datum = (label) =>
          card
            .locator("dl.details-list > div")
            .filter({ has: page.getByText(label, { exact: true }) })
            .locator("dd");
        await expect(datum("Resolver local ID")).toHaveText(
          summary.case.localDisputeID,
        );
        await expect(datum("Arbitrator dispute ID")).toHaveText(
          summary.case.arbitratorDisputeID,
        );
        const time = new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
          timeZone: a.event.timezone ?? "UTC",
        }).format(new Date(summary.case.matchEndsAt * 1000));
        await expect(datum("Matching deadline")).toHaveText(time);
        const omissionTime = new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
          timeZone: a.event.timezone ?? "UTC",
        }).format(new Date(a.state.challengeEndsAt * 1000));
        const omissionExactTime = new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
          timeZone: a.event.timezone ?? "UTC",
        }).format(new Date(a.state.challengeEndsAt * 1000));
        await expect(
          page
            .locator(".event-main dl.details-list > div")
            .filter({
              has: page.getByText("Omission challenge ends", { exact: true }),
            })
            .locator("dd"),
        ).toHaveText(omissionTime);
        const cardWei = async (label) => {
          const text = await page
            .locator(".money-card")
            .filter({ has: page.getByText(label, { exact: true }) })
            .locator("strong")
            .innerText();
          check(
            /^\d+(\.\d{1,18})? XDAI$/.test(text),
            "Money cards use precise native XDAI amounts",
          );
          return ethers.parseEther(text.split(" ")[0]);
        };
        check(
          (await cardWei("Sent")) === amount(a.payments.attendancePaidWei),
          "UI Sent matches canonical attendance transfers",
        );
        check(
          (await cardWei("Reserved case shares")) ===
            amount(a.state.heldBackWei),
          "UI reserved case shares match actual heldBack",
        );
        check(
          (await cardWei("Still owed")) === amount(a.state.owedTotalWei),
          "UI owed credit stays separate from sent and held shares",
        );
        const mayRelease =
          a.state.phase === "Listed" && a.state.now > a.state.challengeEndsAt;
        check(
          (await page.locator('[data-tx="release"]').isDisabled()) ===
            !mayRelease,
          "Normal payout review follows the actual contract phase and real challenge deadline",
        );
        check(
          (await card.locator('[data-tx="resolve"]').isDisabled()) !==
            (phase === "ruled"),
          "Only a final unsettled result enables settlement review",
        );
        if (["matched", "ordinary"].includes(phase)) {
          await expect(datum("Final ruling")).toHaveText("Not final");
          await expect(card.getByRole("heading")).toContainText(
            "Matched controlled test dispute",
          );
        }
        if (phase === "matched" && a.state.now <= a.state.challengeEndsAt)
          await expect(page.locator(".payout-wait-reason")).toContainText(
            omissionExactTime,
          );
        if (["ruled", "settled"].includes(phase))
          await expect(datum("Final ruling")).toHaveText(
            ["0 · Refused / excluded", "1 · Attended", "2 · Absent"][
              summary.case.finalRuling
            ],
          );
        if (phase === "ruled")
          await expect(card.getByRole("heading")).toContainText(
            /settlement pending/i,
          );
        if (phase === "settled")
          await expect(card.getByRole("heading")).toHaveText(
            "Challenge settled",
          );
      }
      check(
        (await page
          .locator(
            "#identity-select,[data-fund-wallet],[data-advance],[data-ruling],[data-open-appeal]",
          )
          .count()) === 0,
        "No impersonation, time travel, faucet or mock-ruling control is present",
      );
      const capture = async (suffix) => {
        fs.mkdirSync(screenshots, { recursive: true });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await expect(page.locator("#content")).toBeVisible();
        await expect(page.locator("#loading")).toBeHidden();
        for (const [size, viewport] of [
          ["desktop", { width: 1440, height: 1000 }],
          ["mobile", { width: 390, height: 844 }],
        ]) {
          await page.setViewportSize(viewport);
          await page.evaluate(() => {
            if (document.activeElement instanceof HTMLElement)
              document.activeElement.blur();
            window.scrollTo(0, 0);
          });
          await page.waitForFunction(() => window.scrollY === 0);
          check(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            "The fully loaded audited view fits its viewport",
          );
          const filename = `${phase}-${suffix}-${size}.png`;
          await page.screenshot({
            path: path.join(screenshots, filename),
            fullPage: true,
          });
          capturedScreenshots.push(`${screenshotRelative}/${filename}`);
        }
      };
      await capture(role);
      if (role === "bob") {
        stage = "bob: authenticated participant outcome and payment";
        await page.goto(
          target(
            `/?status_audit=${phase}-bob-participant-${++navigation}#${new URLSearchParams({ event: recordA.definition.id, view: "participant" })}`,
          ),
        );
        await assertParticipant("bob");
        await capture("bob-participant");
      }
      await context.close();
      actors.pop();
    }
    check(
      walletMethods.filter((m) => m === "personal_sign").length === 3 &&
        walletMethods.every((m) =>
          [
            "eth_accounts",
            "eth_requestAccounts",
            "eth_chainId",
            "personal_sign",
          ].includes(m),
        ),
      "Exactly three login signatures occurred with zero transaction signing requests",
    );
    check(
      networkFailures.length === 0 && pageFailures.length === 0,
      "Read-only browser audit has no unexpected writes, external requests, missing assets or runtime errors",
    );
    const proof = {
      status: "passed",
      phase,
      chainId: 10200,
      origin: ORIGIN,
      arbitration: "controlled test arbitrator; no independent jury",
      checkedAt: new Date().toISOString(),
      checks,
      ...summary,
      case: summary.case,
      canonicalAttendanceTransfers: transfers,
      deadlines: {
        omissionChallengeEndsAt: a.state.challengeEndsAt,
        matchingEndsAt: summary.case.matchEndsAt,
      },
      contractTransactionsSigned: 0,
      contractTransactionsBroadcast: 0,
      apiWrites: "wallet authentication only",
      uiRoles: ["bob", "ownerA", "alice"],
      screenshots: capturedScreenshots,
      limitations: [
        "Disposable Node-held wallets supplied login signatures through a restricted EIP1193 test provider; no normal wallet extension was used",
        "Attendance sent, reserved case shares and failed-transfer credit are verified separately; claims are not relabeled as attendance payouts",
      ],
    };
    saveProof(proof);
    console.log(JSON.stringify(proof, null, 2));
  } catch (error) {
    const errorText = String(error?.message ?? "");
    const selector = errorText.match(/locator\('([^']{1,180})'\)/)?.[1];
    const proof = {
      status: "failed",
      phase,
      stage,
      code:
        error instanceof AuditFailure
          ? error.code
          : "REDACTED_TRANSPORT_OR_BROWSER",
      error:
        error instanceof AuditFailure
          ? error.message
          : "Read-only audit stopped; wallet/session/transport diagnostics were redacted",
      diagnostic: {
        kind: /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(error?.name ?? "")
          ? error.name
          : "Error",
        timedOut: /timeout|timed out/i.test(errorText),
        ...(selector && !/0x[0-9a-f]{64,}/i.test(selector) ? { selector } : {}),
      },
      checks,
      contractTransactionsSigned: 0,
      contractTransactionsBroadcast: 0,
      apiWrites: "wallet authentication only",
    };
    saveProof(proof);
    console.error(JSON.stringify(proof, null, 2));
    process.exitCode = 1;
  } finally {
    await Promise.allSettled(actors.map((context) => context.close()));
    await browser?.close();
  }
}
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--self-test") selfTest();
else if (args.length === 2 && args[0] === "--phase" && STAGES.includes(args[1]))
  await main(args[1]);
else {
  console.error(
    "Use --phase matched|ordinary|ruled|settled, or --self-test. This audit never sends a contract transaction.",
  );
  process.exitCode = 1;
}
