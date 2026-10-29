import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertDManifest,
  assertDPhase,
  assertDWindowEvent,
  parseDObserverArgs,
} from "../scripts/chiado-ui-d-flow-audit.mjs";
import {
  expectedUi,
  reconcileTransfers,
} from "../scripts/chiado-flow-audit.mjs";

const addr = (x) => "0x" + x.repeat(40);
const roles = { owner: addr("1"), alice: addr("2"), bob: addr("3") };
const D = "1000000000000";
const id = "12345678-1234-1234-1234-123456789abc";
const PROFILE = "kleros-event-v8-test15m";
const sha = (x) => createHash("sha256").update(x).digest("hex");
function manifestFixture() {
  const policy = "Synthetic fast test policy";
  const origin = "https://synthetic-fast-d.example";
  const deployment = {
    eventId: `chiado-ui-${id}-d`,
    contract: addr("4"),
    chainId: 10200,
    contractVersion: PROFILE,
    abiVersion: PROFILE,
    depositWei: D,
    challengePeriodSeconds: 900,
    matchPeriodSeconds: 900,
    eventStart: 1000,
    claimDeadline: 605800,
    owner: roles.owner,
    factory: addr("5"),
    factoryCodeHash: "0x" + "a".repeat(64),
    factoryDeploymentTxHash: "0x" + "b".repeat(64),
    factoryDeploymentBlock: 10,
  };
  const manifest = {
    environment: "testnet",
    chain: { chainId: 10200 },
    planId: id,
    planFingerprint: "a".repeat(64),
    publicOrigin: origin,
    scenario: { id: "ui-deposit-d", expectedFinalRuling: 1 },
    arbitration: { mode: "controlled" },
    rehearsalAddresses: structuredClone(roles),
    profile: {
      contractVersion: PROFILE,
      numericVersion: 80015,
      challengePeriod: 900,
      matchPeriod: 900,
    },
    factory: deployment.factory,
    factoryCodeHash: deployment.factoryCodeHash,
    factoryDeploymentTxHash: deployment.factoryDeploymentTxHash,
    factoryDeploymentBlock: deployment.factoryDeploymentBlock,
    events: [{ definition: { id: deployment.eventId }, deployment, policy }],
    policy: { uri: origin + "/policies/v8-test15m.md", sha256: sha(policy) },
    provenance: {
      creationCodeHashes: {
        KlerosEventV8Test15m:
          "0x5bf9454fa2653055199c63aded037886758c4f1e0b276e9290b6424cab5771c0",
        KlerosEventFactoryV8Test15m:
          "0x263f1f460ceb46abe9e77222d4fcfd0ffbf16f027522aea4fbac2b41391fc433",
      },
    },
  };
  const bytes = JSON.stringify(manifest);
  return {
    manifest,
    bytes,
    expected: {
      manifestSha256: sha(bytes),
      planId: id,
      planFingerprint: manifest.planFingerprint,
      origin,
      eventId: deployment.eventId,
      contract: deployment.contract,
    },
  };
}
function payment(wallet) {
  return {
    type: "attendance-payout",
    wallet,
    recipient: wallet,
    amountWei: D,
    successful: true,
    txHash: "0x" + "a".repeat(64),
    logIndex: wallet === roles.bob ? 1 : 0,
    blockNumber: 100,
    sourceMethod: wallet === roles.bob ? "resolveChallenge" : "releasePayouts",
  };
}
function current(phase) {
  const settled = phase === "settled";
  return {
    state: {
      phase: "Finalized",
      stakerCount: 2,
      pendingTotalWei: "0",
      owedTotalWei: "0",
      attendeeCount: settled ? 2 : 1,
      pendingChallenges: settled ? 0 : 1,
      heldBackWei: settled ? "0" : D,
      challengeEscrowWei: settled ? "0" : "30000000000",
      reservedWei: settled ? "0" : "1030000000000",
      balanceWei: settled ? "0" : "1030000000000",
      cases: [
        {
          wallet: roles.bob,
          matched: true,
          localDisputeID: "2",
          arbitratorDisputeID: "1002",
          matcher: roles.owner,
          caseOrganizer: roles.owner,
          state: settled ? "Resolved" : "Disputed",
          finalRuling: phase === "ordinary" ? null : 1,
          heldShareWei: settled ? "0" : D,
        },
      ],
    },
    payments: {
      transfers: settled
        ? [payment(roles.alice), payment(roles.bob)]
        : [payment(roles.alice)],
    },
    roles: {
      alice: {
        wallet: roles.alice,
        pendingWei: "0",
        owedWei: "0",
        status: 2,
        attended: true,
      },
      bob: {
        wallet: roles.bob,
        pendingWei: "0",
        owedWei: "0",
        status: settled ? 2 : 1,
        attended: settled,
      },
    },
    expectedUi: { allFinancialObligationsComplete: settled },
  };
}

function prePayout(phase, now = 1100) {
  const value = current("ordinary");
  Object.assign(value.state, {
    phase: "Listed",
    now,
    challengeEndsAt: 1900,
    attendeeCount: 1,
    pendingChallenges: phase === "waiting" ? 1 : 0,
    heldBackWei: "0",
    payoutShareWei: "0",
    challengeEscrowWei: phase === "waiting" ? "30000000000" : "0",
    reservedWei: phase === "waiting" ? "2030000000000" : "2000000000000",
    balanceWei: phase === "waiting" ? "2030000000000" : "2000000000000",
  });
  value.state.cases =
    phase === "waiting"
      ? [
          {
            ...value.state.cases[0],
            state: "Waiting",
            matched: false,
            matcher: addr("0"),
            matchEndsAt: 1905,
            localDisputeID: null,
            arbitratorDisputeID: null,
            finalRuling: null,
            heldShareWei: "0",
            depositWei: "30000000000",
            caseURI: null,
            appeal: null,
          },
        ]
      : [];
  value.roles.alice.status = 1;
  value.payments.transfers = [];
  value.expectedUi = expectedUi({
    ...value.state,
    eventStart: 900,
    arbitrationMode: "controlled",
  });
  return value;
}

test("D observer requires externally reviewed exact plan/origin/child/raw-manifest pins", () => {
  const fixture = manifestFixture();
  assertDManifest(fixture.manifest, fixture.expected, fixture.bytes);
  for (const field of [
    "manifestSha256",
    "planId",
    "planFingerprint",
    "origin",
    "eventId",
    "contract",
  ]) {
    const expected = {
      ...fixture.expected,
      [field]: field === "contract" ? addr("8") : "wrong",
    };
    assert.throws(
      () => assertDManifest(fixture.manifest, expected, fixture.bytes),
      field,
    );
  }
  assert.throws(() =>
    assertDManifest(fixture.manifest, fixture.expected, fixture.bytes + "\n"),
  );
});

test("matching raw hash cannot authorize mainnet, production ABI or incorrect timers", () => {
  for (const mutate of [
    (m) => {
      m.chain.chainId = 100;
    },
    (m) => {
      m.events[0].deployment.chainId = 1;
    },
    (m) => {
      m.events[0].deployment.abiVersion = "kleros-event-v8";
    },
    (m) => {
      m.events[0].deployment.challengePeriodSeconds = 86400;
    },
    (m) => {
      m.profile.numericVersion = 8;
    },
    (m) => {
      m.rehearsalAddresses.bob = roles.alice;
    },
    (m) => {
      m.provenance.creationCodeHashes.KlerosEventV8Test15m =
        "0x" + "0".repeat(64);
    },
  ]) {
    const f = manifestFixture();
    mutate(f.manifest);
    const bytes = JSON.stringify(f.manifest);
    assert.throws(() =>
      assertDManifest(
        f.manifest,
        { ...f.expected, manifestSha256: sha(bytes) },
        bytes,
      ),
    );
  }
});

test("D CLI cannot run with omitted, duplicate or unknown public pins or phases", () => {
  const f = manifestFixture();
  const argv = [
    "--phase",
    "settled",
    "--manifest-sha256",
    f.expected.manifestSha256,
    "--plan-id",
    id,
    "--plan-fingerprint",
    f.expected.planFingerprint,
    "--origin",
    f.expected.origin,
    "--event-id",
    f.expected.eventId,
    "--contract",
    f.expected.contract,
  ];
  assert.deepEqual(parseDObserverArgs(argv).expected, f.expected);
  assert.throws(() => parseDObserverArgs([]));
  assert.throws(() => parseDObserverArgs(argv.concat(["--phase", "settled"])));
  assert.throws(() => parseDObserverArgs(argv.concat(["--execute", "1"])));
  assert.throws(() =>
    parseDObserverArgs(["--phase", "finished", ...argv.slice(2)]),
  );
});

test("ordinary and delivered-ruling checkpoints preserve unpaid Bob held share", () => {
  for (const phase of ["ordinary", "ruled"]) {
    const state = current(phase);
    assertDPhase(phase, state, roles, D);
    const paidEarly = structuredClone(state);
    paidEarly.payments.transfers.push(payment(roles.bob));
    assert.throws(() => assertDPhase(phase, paidEarly, roles, D));
    const wrongRuling = structuredClone(state);
    wrongRuling.state.cases[0].finalRuling = phase === "ordinary" ? 1 : null;
    assert.throws(() => assertDPhase(phase, wrongRuling, roles, D));
  }
});

test("listed checkpoint proves Alice-only attendance and an intact unpaid two-deposit pool", () => {
  const value = prePayout("listed");
  assertDPhase("listed", value, roles, D);
  for (const mutate of [
    (x) => {
      x.state.cases = [{ state: "Waiting" }];
    },
    (x) => {
      x.state.pendingChallenges = 1;
    },
    (x) => {
      x.roles.bob.attended = true;
    },
    (x) => {
      x.roles.alice.status = 2;
    },
    (x) => {
      x.state.challengeEscrowWei = "1";
    },
    (x) => {
      x.state.reservedWei = "1999999999999";
    },
    (x) => {
      x.state.balanceWei = "1999999999999";
    },
    (x) => {
      x.payments.transfers.push(payment(roles.alice));
    },
  ]) {
    const wrong = structuredClone(value);
    mutate(wrong);
    assert.throws(() => assertDPhase("listed", wrong, roles, D));
  }
  const expired = prePayout("listed", 1901);
  assert.equal(expired.expectedUi.canReleaseOnChain, true);
  assertDPhase("listed", expired, roles, D);
});

test("waiting checkpoint keeps unknown Court IDs null and reserves Bob's exact collateral", () => {
  const value = prePayout("waiting");
  assertDPhase("waiting", value, roles, D);
  for (const mutate of [
    (x) => {
      x.state.cases[0].localDisputeID = "0";
    },
    (x) => {
      x.state.cases[0].arbitratorDisputeID = "0";
    },
    (x) => {
      x.state.cases[0].finalRuling = 0;
    },
    (x) => {
      x.state.cases[0].matched = true;
    },
    (x) => {
      x.state.cases[0].state = "Disputed";
    },
    (x) => {
      x.state.cases[0].caseOrganizer = roles.bob;
    },
    (x) => {
      x.state.cases[0].depositWei = "29999999999";
    },
    (x) => {
      x.state.challengeEscrowWei = "0";
    },
    (x) => {
      x.state.balanceWei = "2000000000000";
    },
    (x) => {
      x.state.pendingChallenges = 0;
    },
  ]) {
    const wrong = structuredClone(value);
    mutate(wrong);
    assert.throws(() => assertDPhase("waiting", wrong, roles, D));
  }
  const expired = prePayout("waiting", 1906);
  assert.equal(expired.expectedUi.canReleaseOnChain, true);
  assert.equal(expired.expectedUi.cases[0].canResolveOnChain, true);
  assertDPhase("waiting", expired, roles, D);
});

test("canonical posting/challenge receipts bind both 900-second deadlines", () => {
  const state = prePayout("waiting").state;
  assertDWindowEvent("AttendancePosted", 1000, [1n, 1900n], state);
  assertDWindowEvent(
    "Challenged",
    1005,
    [roles.bob, 30000000000n, 1905n],
    state,
  );
  assert.throws(() =>
    assertDWindowEvent("AttendancePosted", 1000, [1n, 1901n], state),
  );
  assert.throws(() =>
    assertDWindowEvent("AttendancePosted", 999, [1n, 1900n], state),
  );
  assert.throws(() =>
    assertDWindowEvent("AttendancePosted", 1000, [1n, 1900n], {
      ...state,
      challengeEndsAt: 1901,
    }),
  );
  assert.throws(() =>
    assertDWindowEvent(
      "Challenged",
      1005,
      [roles.bob, 30000000000n, 1906n],
      state,
    ),
  );
  assert.throws(() =>
    assertDWindowEvent(
      "Challenged",
      1005,
      [roles.alice, 30000000000n, 1905n],
      state,
    ),
  );
  const wrong = structuredClone(state);
  wrong.cases[0].matchEndsAt = 1906;
  assert.throws(() =>
    assertDWindowEvent(
      "Challenged",
      1005,
      [roles.bob, 30000000000n, 1905n],
      wrong,
    ),
  );
});

test("settled proof requires exact Bob attendance delivery, correct recipient and cleared liabilities", () => {
  const state = current("settled");
  assertDPhase("settled", state, roles, D);
  for (const mutate of [
    (s) => {
      s.payments.transfers[1].recipient = roles.alice;
    },
    (s) => {
      s.payments.transfers[1].type = "pending-credit-withdrawal";
    },
    (s) => {
      s.payments.transfers[1].type = "owed-claim";
    },
    (s) => {
      s.payments.transfers[1].successful = false;
    },
    (s) => {
      s.payments.transfers[1].amountWei = "999999999999";
    },
    (s) => {
      s.state.owedTotalWei = "1";
    },
    (s) => {
      s.state.challengeEscrowWei = "1";
    },
    (s) => {
      s.state.cases[0].finalRuling = 0;
    },
    (s) => {
      s.expectedUi.allFinancialObligationsComplete = false;
    },
  ]) {
    const wrong = structuredClone(state);
    mutate(wrong);
    assert.throws(() => assertDPhase("settled", wrong, roles, D));
  }
});

test("payment reconciliation rejects altered amount, receipt, recipient and duplicates", () => {
  const transfers = [payment(roles.alice), payment(roles.bob)];
  reconcileTransfers(transfers, transfers);
  for (const field of [
    "wallet",
    "recipient",
    "amountWei",
    "txHash",
    "logIndex",
    "sourceMethod",
    "successful",
  ]) {
    const wrong = structuredClone(transfers);
    wrong[1][field] =
      field === "logIndex" ? 3 : field === "successful" ? false : "changed";
    assert.throws(() => reconcileTransfers(wrong, transfers));
  }
  assert.throws(() =>
    reconcileTransfers([transfers[0], transfers[0]], transfers),
  );
});
