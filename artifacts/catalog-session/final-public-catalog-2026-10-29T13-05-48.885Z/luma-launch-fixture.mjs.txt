import {
  makeProductionFixture,
  FIXTURE_WALLET,
  FIXTURE_CONTRACT,
  FIXTURE_OWNER,
  FIXTURE_DEPOSIT_WEI,
} from "./production-ui-fixture.mjs";

// TEST ONLY. Current production DTO projections; no Luma API, live wallet or chain.
export const LUMA_ATTENDANCE_STANDARD = Object.freeze({
  attendanceMode: "event-participation",
  attendanceRule: "presence-during-immutable-interval-v1",
  evidenceRule: "balance-of-probabilities-with-case-organizer-confirmation-v1",
});
export const LUMA_LAUNCH_EVENT_ID = "luma-launch-synthetic-event";
export const LUMA_LAUNCH_URL = "https://luma.com/synthetic-committed-spot";
export const LUMA_LAUNCH_HASH = "0x" + "9".repeat(64);
export const LUMA_LAUNCH_SCENARIOS = [
  "root",
  "anonymous",
  "ready",
  "submitted",
  "failed",
  "confirmed",
  "credit",
  "partial-credit",
  "returned",
  "cancelled",
  "owed",
  "unsettled",
  "organizer",
];
export function makeLumaLaunchFixture(
  scenario = "ready",
  {
    lumaUrl = LUMA_LAUNCH_URL,
    eventId = LUMA_LAUNCH_EVENT_ID,
    receiptPatch = null,
    walletAddress = FIXTURE_WALLET,
    instanceId = null,
    attendanceStandard = LUMA_ATTENDANCE_STANDARD,
  } = {},
) {
  if (!LUMA_LAUNCH_SCENARIOS.includes(scenario))
    throw Error("Unknown Luma launch fixture");
  const source =
    scenario === "owed"
      ? "owed"
      : scenario === "unsettled"
        ? "final-unsettled"
        : "before-deposit";
  const value = makeProductionFixture(source, {
    authenticated: !["root", "anonymous"].includes(scenario),
  });
  const { bootstrap, detail } = value;
  Object.assign(bootstrap.capabilities, {
    lumaDepositPortal: true,
    walletFirstDeposits: true,
    createEvents: false,
  });
  Object.assign(detail.event, {
    id: eventId,
    slug: "luma-launch-fixture",
    title: "Luma committed spot fixture",
    lumaUrl,
  });
  bootstrap.organizerSetup = {
    attendanceStandard: structuredClone(LUMA_ATTENDANCE_STANDARD),
  };
  if (attendanceStandard === null) delete detail.event.attendanceStandard;
  else detail.event.attendanceStandard = structuredClone(attendanceStandard);
  // Faithful wallet-first projection: no participant application, contact, signup or import.
  for (const key of [
    "participants",
    "deposits",
    "unmatched",
    "imports",
    "attendance",
    "transactions",
  ])
    detail[key] = [];
  detail.personal = null;
  if (detail.ownWallet) {
    detail.ownWallet.wallet = FIXTURE_WALLET;
    detail.ownWallet.deposit = { status: "none" };
    detail.ownWallet.depositAction = {
      eligible: true,
      amountWei: FIXTURE_DEPOSIT_WEI,
      reasonCode: "DEPOSIT_REQUIRED",
      reason: "Synthetic backend-authorized remaining commitment",
    };
    if (
      [
        "submitted",
        "failed",
        "confirmed",
        "credit",
        "partial-credit",
        "returned",
        "owed",
        "unsettled",
      ].includes(scenario)
    ) {
      detail.ownWallet.deposit = {
        status: ["submitted", "failed"].includes(scenario)
          ? scenario
          : "confirmed",
        hash: LUMA_LAUNCH_HASH,
      };
      if (detail.ownWallet.deposit.status === "confirmed")
        Object.assign(detail.ownWallet.deposit, {
          amountWei: FIXTURE_DEPOSIT_WEI,
          blockNumber: 105,
        });
    }
    if (["confirmed", "credit", "owed", "unsettled"].includes(scenario))
      detail.ownWallet.depositAction = {
        eligible: false,
        amountWei: "0",
        reasonCode:
          scenario === "owed" || scenario === "unsettled"
            ? "REGISTERED"
            : "ALREADY_FUNDED",
        reason: "Synthetic backend says no additional deposit is eligible",
      };
    if (
      [
        "confirmed",
        "credit",
        "partial-credit",
        "returned",
        "owed",
        "unsettled",
      ].includes(scenario)
    )
      detail.participants = [
        {
          id: "minimal-wallet-person",
          eventId,
          wallet: FIXTURE_WALLET,
          walletVerified: true,
          identityVerified: false,
          admission: "pending",
          registered: ["owed", "unsettled"].includes(scenario),
        },
      ];
    if (scenario === "partial-credit") {
      detail.ownWallet.pendingCreditWei = "5000000000000000";
      detail.ownWallet.deposit.amountWei = "5000000000000000";
      detail.ownWallet.depositAction = {
        eligible: true,
        amountWei: "5000000000000000",
        reasonCode: "DEPOSIT_REQUIRED",
        reason: "Synthetic exact remaining amount from backend",
      };
    }
    if (scenario === "cancelled") {
      detail.ownWallet.deposit = {
        status: "confirmed",
        hash: LUMA_LAUNCH_HASH,
        amountWei: FIXTURE_DEPOSIT_WEI,
        blockNumber: 105,
      };
      detail.state.phase = "Cancelled";
      detail.ownWallet.depositAction = {
        eligible: false,
        amountWei: "0",
        reasonCode: "EVENT_CANCELLED",
        reason: "Synthetic event cancelled; deposits are closed",
      };
    }
    if (["confirmed", "credit"].includes(scenario)) {
      detail.ownWallet.pendingCreditWei = FIXTURE_DEPOSIT_WEI;
      Object.assign(detail.state, {
        balanceWei: FIXTURE_DEPOSIT_WEI,
        pendingTotalWei: FIXTURE_DEPOSIT_WEI,
        reservedWei: FIXTURE_DEPOSIT_WEI,
      });
    }
  }
  if (scenario === "organizer") {
    walletAddress = FIXTURE_OWNER;
    Object.assign(detail.permissions, {
      authenticated: true,
      owner: true,
      staff: true,
    });
    detail.event.role = "owner";
    detail.participants = [
      {
        id: "minimal-peer",
        eventId,
        wallet: FIXTURE_WALLET,
        walletVerified: true,
        identityVerified: false,
        admission: "pending",
        registered: false,
        deposit: {
          verified: true,
          amountWei: FIXTURE_DEPOSIT_WEI,
          txHash: LUMA_LAUNCH_HASH,
        },
      },
    ];
  }
  if (detail.ownWallet) {
    detail.ownWallet.wallet = walletAddress;
    Object.assign(detail.ownWallet.deposit, {
      wallet: walletAddress,
      eventId,
      chainId: 1,
      contract: FIXTURE_CONTRACT,
      abiVersion: detail.event.abiVersion,
    });
    if (receiptPatch)
      Object.assign(detail.ownWallet.deposit, structuredClone(receiptPatch));
    if (scenario !== "organizer")
      for (const person of detail.participants) person.wallet = walletAddress;
  }
  if (bootstrap.session) bootstrap.session.wallet = walletAddress;
  if (instanceId) bootstrap.instanceId = instanceId;
  bootstrap.events = scenario === "root" ? [] : [structuredClone(detail.event)];
  if (scenario === "root") delete bootstrap.selectedEvent;
  else
    bootstrap.selectedEvent = {
      eventId,
      instanceId: bootstrap.instanceId,
      wallet: bootstrap.session?.wallet ?? null,
      detail,
      error: null,
    };
  return value;
}

export function makeLumaParticipantDraft(
  fixture,
  {
    id = "synthetic-luma-deposit-draft",
    amountWei = fixture.detail.ownWallet.depositAction.amountWei,
  } = {},
) {
  const { event, state } = fixture.detail,
    wallet = fixture.bootstrap.session.wallet;
  return {
    id,
    eventId: event.id,
    action: "deposit",
    params: {},
    wallet,
    chainId: event.chainId,
    contract: event.contract,
    contractVersion: event.contractVersion,
    abiVersion: event.abiVersion,
    mode: fixture.bootstrap.mode,
    instanceId: fixture.bootstrap.instanceId,
    valueWei: amountWei,
    method: "deposit",
    args: [],
    summary: "SYNTHETIC LOOPBACK DEPOSIT REVIEW — no real simulation or funds",
    createdAt: Date.now(),
    expiresAt: Date.now() + 300000,
    reviewBlock: state.blockNumber,
    snapshot: state.fingerprint,
    transaction: {
      to: event.contract,
      from: wallet,
      chainId: event.chainId,
      value: amountWei,
      data: "0x12345678",
    },
  };
}

export const LUMA_FACTORY_ADDRESS = "0x" + "6".repeat(40);
export const LUMA_CREATED_EVENT_ID = "created-luma-synthetic-event";
export function makeLumaSetupFixture({
  attendanceStandard = LUMA_ATTENDANCE_STANDARD,
} = {}) {
  const value = makeLumaLaunchFixture("ready");
  const { bootstrap, detail } = value;
  bootstrap.events = [];
  delete bootstrap.selectedEvent;
  Object.assign(bootstrap.capabilities, {
    createEvents: true,
    transactionsReady: false,
  });
  bootstrap.organizerSetup = {
    policyStatus: "verified",
    policyURI: "ipfs://SYNTHETIC_TEST_POLICY",
    policySha256: "e".repeat(64),
    challengeWindowSeconds: 86400,
    matchWindowSeconds: 86400,
    minimumClaimDays: 7,
    ...(attendanceStandard === null
      ? {}
      : { attendanceStandard: structuredClone(attendanceStandard) }),
  };
  bootstrap.factory = {
    address: LUMA_FACTORY_ADDRESS,
    chainId: 1,
    contractVersion: detail.event.contractVersion,
    abiVersion: detail.event.abiVersion,
    verified: true,
    deploymentTrust: { status: "verified" },
    upgrade: structuredClone(detail.upgrade),
  };
  return value;
}
export function makeLumaFactoryDraft(bootstrap, input, now = Date.now()) {
  const startsAt = new Date(input.startsAt).toISOString(),
    endsAt = new Date(input.endsAt).toISOString();
  const eventStart = Date.parse(startsAt) / 1000;
  return {
    id: "synthetic-organizer-draft",
    eventId: LUMA_CREATED_EVENT_ID,
    eventKey: "0x" + "b".repeat(64),
    action: "createEvent",
    method: "createEvent",
    wallet: bootstrap.session.wallet,
    sessionId: "synthetic-session",
    chainId: 1,
    contract: LUMA_FACTORY_ADDRESS,
    contractVersion: "kleros-event-v9-uups",
    abiVersion: "kleros-event-v9-uups",
    mode: "hosted-production",
    instanceId: bootstrap.instanceId,
    valueWei: "0",
    args: ["SYNTHETIC_CREATE_EVENT_ONLY"],
    createdAt: now,
    expiresAt: now + 300000,
    reviewBlock: 110,
    factoryFingerprint: "a".repeat(64),
    snapshot: "b".repeat(64),
    terms: {
      ...structuredClone(input),
      startsAt,
      endsAt,
      depositWei: FIXTURE_DEPOSIT_WEI,
      eventStart,
      claimDeadline: eventStart + 7 * 86400,
      claimDays: 7,
      policyURI: bootstrap.organizerSetup.policyURI,
      policySha256: bootstrap.organizerSetup.policySha256,
      challengeWindowSeconds: 86400,
      matchWindowSeconds: 86400,
      capacity: 150,
      attendanceStandard: structuredClone(
        bootstrap.organizerSetup.attendanceStandard,
      ),
    },
    transaction: {
      to: LUMA_FACTORY_ADDRESS,
      from: bootstrap.session.wallet,
      chainId: 1,
      value: "0",
      data: "0x12345678",
      gasLimit: "500000",
    },
  };
}
