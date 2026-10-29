// TEST ONLY. All addresses, receipts and financial snapshots are synthetic.
// This single contract object contains the confirmed core metadata; no deployed v9 ABI is exercised.
export const PRODUCTION_UI_CONTRACT = Object.freeze({
  confirmed: true, // Exact core schema confirmed; ROOT app-ready is still required before running.
  modes: ["hosted-production"],
  profile: {
    contractVersion: "kleros-event-v9-uups",
    abiVersion: "kleros-event-v9-uups",
    contractProfile: {
      contractVersion: "kleros-event-v9-uups",
      abiVersion: "kleros-event-v9-uups",
      version: 9,
      financialModel: "v8",
      upgradeable: true,
      testOnly: false,
      verified: true,
      challengeWindowSeconds: 86400,
      matchWindowSeconds: 86400,
      chainId: 1,
    },
  },
  capabilities: {
    production: true,
    browserWallet: true,
    walletTransactions: true,
    serverSigning: false,
    financialInterface: "kleros-native-v1",
    transactionsReady: true,
    supportedAccountTypes: ["eoa"],
    contractWallets: false,
    erc1271: false,
    eip7702: false,
    sharedDemo: false,
    createEvents: false,
    timeControls: false,
    reset: false,
    timeTravel: false,
    mockRulings: false,
    contractInbox: false,
    batchActions: false,
  },
  bootstrapContext: {
    environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
    arbitration: {
      mode: "kleros-v1",
      verified: true,
      label: "Kleros V1 · Ethereum",
      notice: "Real Kleros arbitration on Ethereum mainnet",
      resolver: "0x" + "6".repeat(40),
      arbitrator: "0x" + "7".repeat(40),
    },
    walletSupport: {
      type: "eoa-only",
      eoa: true,
      erc1271: false,
      eip7702: false,
      notice:
        "Use a standard wallet account. Smart contract and delegated accounts are not supported.",
    },
  },
  eventContext: {},
  detailContext: {
    deploymentTrust: { status: "verified" },
    upgrade: {
      kind: "uups",
      implementation: "0x" + "a".repeat(40),
      implementationCodeHash: "0x" + "b".repeat(64),
      version: 9,
      authority: "0x" + "8".repeat(40),
      multisig: "0x" + "9".repeat(40),
      delaySeconds: 172800,
      pending: null,
      verified: true,
    },
  },
  invalidContexts: [
    {
      name: "unavailable-deployment",
      detail: { deploymentTrust: { status: "unavailable" } },
      warning: /production|deployment|unavailable|verified/i,
    },
    {
      name: "changed-deployment",
      detail: { deploymentTrust: { status: "changed" } },
      warning: /production|deployment|changed|verified/i,
    },
    {
      name: "transactions-not-ready",
      bootstrap: { capabilities: { transactionsReady: false } },
      warning: /production|transaction|available|verified/i,
    },
    {
      name: "bootstrap-profile-version8",
      bootstrap: { contractProfile: { version: 8 } },
      warning: /production|profile|version|verified/i,
    },
    {
      name: "credential-bearing-rpc",
      bootstrap: {
        chain: {
          rpcUrl: "https://user:password@rpc.production-fixture.invalid",
        },
      },
      warning: /production|RPC|credential|network|verified/i,
    },
    {
      name: "detail-resolver-mismatch",
      event: { resolver: "0x" + "8".repeat(40) },
      warning: /production|resolver|arbitration|verified/i,
    },
    {
      name: "incomplete-governance-delay",
      detail: { upgrade: { delaySeconds: 0 } },
      warning: /production|upgrade|governance|delay|verified/i,
    },
    {
      name: "malformed-native-metadata",
      bootstrap: { chain: { nativeCurrency: { symbol: "XDAI" } } },
      warning: /production|currency|Ethereum|ETH|verified/i,
    },
  ],
  freshEOAFailure: {
    status: 422,
    code: "UNSUPPORTED_WALLET",
    error:
      "This production app supports wallets without deployed code. Contract wallets and delegated wallets are unsupported.",
  },
});
export const FIXTURE_EVENT_ID = "production-ui-synthetic-event";
export const FIXTURE_WALLET = "0x" + "1".repeat(40);
export const FIXTURE_OWNER = "0x" + "2".repeat(40);
export const FIXTURE_OTHER = "0x" + "3".repeat(40);
export const FIXTURE_CONTRACT = "0x" + "4".repeat(40);
export const FIXTURE_ALTERNATE = "0x" + "5".repeat(40);
export const FIXTURE_DEPOSIT_WEI = "10000000000000000";
export const PRODUCTION_SCENARIOS = [
  "before-deposit",
  "deposit-pending",
  "unused-credit",
  "staff-observed",
  "attendance-listed",
  "waiting",
  "matched-unruled",
  "final-unsettled",
  "paid",
  "owed",
];
const copy = (value) => structuredClone(value);
const h = (digit) => "0x" + digit.repeat(64);
export function patchFixture(target, patch) {
  const result = copy(target);
  for (const [key, value] of Object.entries(patch ?? {}))
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? patchFixture(
            result[key] && typeof result[key] === "object" ? result[key] : {},
            value,
          )
        : copy(value);
  return result;
}
export function requireConfirmedProductionContract(
  core = PRODUCTION_UI_CONTRACT,
) {
  if (
    core.confirmed !== true ||
    !Array.isArray(core.modes) ||
    !core.modes.length ||
    !core.profile?.contractVersion ||
    !core.profile?.abiVersion ||
    !core.capabilities ||
    core.bootstrapContext === null ||
    core.eventContext === null ||
    !Array.isArray(core.invalidContexts) ||
    core.invalidContexts.length < 2 ||
    !core.invalidContexts.every(
      (x) => x.name && x.warning && (x.bootstrap || x.event || x.detail),
    ) ||
    !Number.isInteger(core.freshEOAFailure?.status) ||
    !core.freshEOAFailure.code ||
    !core.freshEOAFailure.error
  )
    throw new Error(
      "Production UI fixture contract is awaiting exact core mode/profile/trust/capability/EOA confirmation; no browser run authorized by this scaffold.",
    );
  return core;
}
export function makeProductionFixture(
  scenario,
  {
    core = PRODUCTION_UI_CONTRACT,
    mode = core.modes[0],
    authenticated = true,
    appealQuoteWei = undefined,
    readinessOverride = null,
  } = {},
) {
  if (!PRODUCTION_SCENARIOS.includes(scenario))
    throw new Error("Unknown production UI fixture scenario");
  const now = 1800000000,
    D = FIXTURE_DEPOSIT_WEI;
  const profile = core.profile ?? { contractVersion: null, abiVersion: null };
  let event = {
    id: FIXTURE_EVENT_ID,
    slug: "production-ui-fixture",
    title: "Ethereum event presentation fixture",
    description:
      "Synthetic loopback projection. No live contract or funds are connected.",
    visibility: "public",
    editorialStatus: "published",
    registrationStatus: "open",
    startsAt: new Date((now + 3600) * 1000).toISOString(),
    endsAt: new Date((now + 7200) * 1000).toISOString(),
    timezone: "UTC",
    location: "Fixture venue",
    depositWei: D,
    chainId: 1,
    contract: FIXTURE_CONTRACT,
    deploymentBlock: 100,
    policyURI: "/policies/fixture-only.md",
    templateHash: h("a"),
    depositOpensAt: now - 3600,
    depositDeadline: now + 3500,
    claimDeadline: now + 86400,
    role: "participant",
    resolver: "0x" + "6".repeat(40),
    arbitrator: "0x" + "7".repeat(40),
    ...copy(profile),
  };
  event = patchFixture(event, core.eventContext);
  const person = {
    id: "synthetic-person",
    eventId: event.id,
    wallet: FIXTURE_WALLET,
    name: "Fixture participant",
    email: "fixture-participant@example.test",
    identityVerified: true,
    admission: "pending",
    registered: false,
    attended: false,
    owedWei: "0",
    pendingCreditWei: "0",
    deposit: null,
  };
  const state = {
    phase: "Open",
    owner: FIXTURE_OWNER,
    pendingOwner: "0x" + "0".repeat(40),
    depositWei: D,
    poolWei: "0",
    balanceWei: "0",
    reservedWei: "0",
    spareWei: "0",
    heldBackWei: "0",
    owedTotalWei: "0",
    pendingTotalWei: "0",
    challengeEscrowWei: "0",
    payoutShareWei: "0",
    stakerCount: 0,
    attendeeCount: 0,
    challengeEndsAt: 0,
    pendingChallenges: 0,
    challengeDepositWei: "30000000000000",
    blockNumber: 110,
    fingerprint: h("b"),
    now,
    stakers: [],
    activeStakers: [],
    stakerHistory: [],
    attendees: [],
    cases: [],
  };
  const ownWallet = {
    wallet: FIXTURE_WALLET,
    pendingCreditWei: "0",
    owedWei: "0",
  };
  const payments = {
    chainId: 1,
    contract: FIXTURE_CONTRACT,
    blockNumber: 110,
    blockHash: h("c"),
    attendancePaidWei: "0",
    directAttendancePaidWei: "0",
    outstandingCreditsWei: "0",
    failedPaymentsWei: "0",
    claimedWei: "0",
    principalRefundedWei: "0",
    pendingCreditWithdrawnWei: "0",
    transfers: [],
  };
  let detail = {
    event,
    state,
    now,
    permissions: { authenticated, owner: false, staff: false },
    ownWallet: authenticated ? ownWallet : null,
    participants: authenticated ? [person] : [],
    deposits: [],
    unmatched: [],
    imports: [],
    attendance: [],
    personal: null,
    transactions: [],
    payments,
  };
  const register = () => {
    person.admission = "approved";
    person.registered = true;
    state.stakerCount = 1;
    state.stakers = [FIXTURE_WALLET];
    state.activeStakers = [FIXTURE_WALLET];
    state.poolWei = D;
    state.balanceWei = D;
    state.reservedWei = D;
  };
  const receipt = () => {
    person.deposit = {
      eventId: event.id,
      chainId: 1,
      contract: FIXTURE_CONTRACT,
      wallet: FIXTURE_WALLET,
      txHash: h("d"),
      amountWei: D,
      verified: true,
      receiptVerified: true,
      verificationState: "current",
      blockNumber: 105,
      blockHash: h("e"),
      logIndex: 0,
    };
  };
  if (scenario !== "before-deposit") receipt();
  if (
    [
      "unused-credit",
      "staff-observed",
      "attendance-listed",
      "waiting",
      "matched-unruled",
      "final-unsettled",
      "paid",
      "owed",
    ].includes(scenario)
  )
    register();
  if (scenario === "deposit-pending") {
    ownWallet.pendingCreditWei = D;
    person.pendingCreditWei = D;
    state.pendingTotalWei = D;
    state.balanceWei = D;
    state.reservedWei = D;
  }
  if (scenario === "unused-credit") {
    ownWallet.pendingCreditWei = "2000000000000000";
    person.pendingCreditWei = ownWallet.pendingCreditWei;
    state.pendingTotalWei = ownWallet.pendingCreditWei;
    state.balanceWei = "12000000000000000";
    state.reservedWei = state.balanceWei;
  }
  if (
    ["staff-observed", "attendance-listed", "paid", "owed"].includes(scenario)
  )
    detail.attendance = [
      {
        id: "synthetic-door",
        eventId: event.id,
        participantId: person.id,
        source: "staff-door",
        reviewer: FIXTURE_OWNER,
        timestamp: now - 10,
        nonce: "fixture-door-observation",
      },
    ];
  if (["attendance-listed", "paid", "owed"].includes(scenario)) {
    person.attended = true;
    state.attendees = [FIXTURE_WALLET];
    state.attendeeCount = 1;
  }
  if (["attendance-listed", "waiting"].includes(scenario)) {
    state.phase = "Listed";
    state.challengeEndsAt = now + 3600;
  }
  if (["waiting", "matched-unruled", "final-unsettled"].includes(scenario)) {
    const waiting = scenario === "waiting";
    state.phase = waiting ? "Listed" : "Finalized";
    state.challengeEndsAt = waiting ? now + 3600 : now - 3600;
    state.pendingChallenges = 1;
    state.cases = [
      {
        wallet: FIXTURE_WALLET,
        state: waiting ? "Waiting" : "Disputed",
        matched: !waiting,
        finalRuling: scenario === "final-unsettled" ? 1 : null,
        localDisputeID: waiting ? null : "7",
        arbitratorDisputeID: waiting ? null : "1007",
        caseOrganizer: FIXTURE_OWNER,
        depositWei: "30000000000000",
        heldShareWei: waiting ? "0" : D,
        matchEndsAt: now + 7200,
        caseURI: "/fixture-case-only",
        publication: "not-published",
        rewardsReady: scenario === "final-unsettled",
        appeal: waiting
          ? null
          : {
              rewardsReady: scenario === "final-unsettled",
              withdrawableWei: null,
              ruling: 0,
              start: now - 10,
              end: now + 3600,
              loserEnd: now + 1800,
              costAttended: "0",
              costAbsent: "0",
            },
      },
    ];
    if (!waiting) {
      state.heldBackWei = D;
      state.payoutShareWei = D;
      state.attendees = [FIXTURE_OTHER];
      state.attendeeCount = 1;
      payments.attendancePaidWei = D;
      payments.directAttendancePaidWei = D;
      payments.transfers = [
        {
          type: "attendance-payout",
          wallet: FIXTURE_OTHER,
          amountWei: D,
          successful: true,
          txHash: h("f"),
        },
      ];
    }
  }
  if (["paid", "owed"].includes(scenario)) {
    const paid = scenario === "paid";
    state.phase = "Finalized";
    state.payoutShareWei = D;
    state.poolWei = D;
    state.balanceWei = paid ? "0" : D;
    state.reservedWei = state.balanceWei;
    payments.transfers = [
      {
        type: "attendance-payout",
        wallet: FIXTURE_WALLET,
        amountWei: D,
        successful: paid,
        txHash: h("f"),
      },
    ];
    if (paid) {
      state.cases = [
        {
          wallet: FIXTURE_WALLET,
          state: "Resolved",
          matched: true,
          finalRuling: 1,
          localDisputeID: "7",
          arbitratorDisputeID: "1007",
          caseOrganizer: FIXTURE_OWNER,
          depositWei: "30000000000000",
          heldShareWei: "0",
          matchEndsAt: now - 10,
          caseURI: "/fixture-case-only",
          publication: "not-published",
          appeal: null,
          rewardsReady: true,
        },
      ];
      payments.attendancePaidWei = D;
      payments.directAttendancePaidWei = D;
    } else {
      ownWallet.owedWei = D;
      person.owedWei = D;
      state.owedTotalWei = D;
      payments.outstandingCreditsWei = D;
      payments.failedPaymentsWei = D;
    }
  }
  if (appealQuoteWei !== undefined || readinessOverride) {
    if (
      scenario !== "paid" ||
      !authenticated ||
      (appealQuoteWei !== undefined && !/^\d+$/.test(appealQuoteWei))
    )
      throw new Error(
        "Reward quote fixtures require the final authenticated synthetic paid case",
      );
    const item = state.cases[0];
    item.appeal = {
      rewardsReady: true,
      withdrawableWei: appealQuoteWei ?? null,
      ruling: 1,
      start: 0,
      end: 0,
      loserEnd: 0,
      costAttended: "0",
      costAbsent: "0",
    };
    if (readinessOverride) {
      item.rewardsReady = readinessOverride.case;
      item.appeal.rewardsReady = readinessOverride.appeal;
    }
  }
  detail = patchFixture(detail, core.detailContext);
  const base = {
    mode,
    instanceId: "production-ui-loopback-only",
    now,
    contractVersion: profile.contractVersion,
    contractProfile: copy(profile.contractProfile ?? null),
    identities: [],
    session: authenticated
      ? { wallet: FIXTURE_WALLET, label: "Fixture wallet", mode: "wallet" }
      : null,
    chain: {
      chainId: 1,
      name: "Ethereum",
      rpcUrl: "https://rpc.production-fixture.invalid",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
    capabilities: {
      selectedEventBootstrap: true,
      ...copy(core.capabilities ?? {}),
    },
    arbitration: {
      mode: "fixture-provider",
      notice:
        "Fixture provider metadata only; no deployed arbitration is asserted.",
    },
    events: [copy(event)],
  };
  const bootstrap = patchFixture(base, core.bootstrapContext);
  bootstrap.selectedEvent = {
    eventId: event.id,
    instanceId: bootstrap.instanceId,
    wallet: bootstrap.session?.wallet ?? null,
    detail,
    error: null,
  };
  return { bootstrap, detail };
}
export function invalidProductionFixture(base, patch) {
  const detail = patchFixture(patchFixture(base.detail, patch.detail), {
    event: patchFixture(base.detail.event, patch.event),
  });
  const bootstrap = patchFixture(base.bootstrap, patch.bootstrap);
  bootstrap.events = [copy(detail.event)];
  bootstrap.selectedEvent = {
    eventId: detail.event.id,
    instanceId: bootstrap.instanceId,
    wallet: bootstrap.session?.wallet ?? null,
    detail,
    error: null,
  };
  return { bootstrap, detail };
}

// TEST ONLY: models the authenticated backend's minimal identity projection when
// an untrusted deployment is absent from the normal event catalog. No event data
// or permission is restored by this receipt-recovery identity.
export function recoveryOnlyProductionFixture(base, code, variant = "minimal") {
  const result = copy(base),
    bootstrap = result.bootstrap;
  const event = result.detail.event;
  const identity = Object.fromEntries(
    ["id", "chainId", "contract", "contractVersion", "abiVersion"].map(
      (key) => [key, event[key]],
    ),
  );
  bootstrap.events = [];
  bootstrap.recoveryEvents = [identity];
  bootstrap.selectedEvent = {
    ...bootstrap.selectedEvent,
    detail: null,
    error: {
      status: 409,
      code,
      message: "Synthetic event deployment verification is unavailable",
    },
  };
  if (variant === "malformed")
    bootstrap.recoveryEvents[0].contract = "unverified-address";
  else if (variant === "duplicate")
    bootstrap.recoveryEvents.push(copy(identity));
  else if (variant === "other-wallet") {
    bootstrap.session.wallet = FIXTURE_OTHER;
    bootstrap.selectedEvent.wallet = FIXTURE_OTHER;
  } else if (variant === "selected-wallet-mismatch")
    bootstrap.selectedEvent.wallet = FIXTURE_OTHER;
  else if (variant === "other-instance") {
    bootstrap.instanceId += "-other";
    bootstrap.selectedEvent.instanceId = bootstrap.instanceId;
  } else if (variant !== "minimal")
    throw Error("Unknown recovery fixture variant");
  return result;
}
