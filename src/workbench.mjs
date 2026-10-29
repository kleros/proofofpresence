// @ts-check
import { ethers } from "ethers";
import { eventV8Profile, isV8Version } from "./contracts-v8.mjs";
import {
  localChain,
  deployEvent,
  contractFor,
  chainState,
  verifyDeployment,
  DAY,
} from "./chain.mjs";
import { importCsv } from "./imports.mjs";
import { createImportPreviewService } from "./import-preview.mjs";
import { createBatchService, participantBatchEligibility } from "./batches.mjs";
import { projectPayments } from "./payments.mjs";
import { v8DepositCredits } from "./v8-deposits.mjs";
import { testnetChain, testnetStateStore } from "./testnet-runtime.mjs";
import { mainnetChain, mainnetStateStore } from "./mainnet-runtime.mjs";
import { assertProductionEOAWallet } from "./production-wallets.mjs";
import { IMPLEMENTATION_SLOT, verifyV9FactoryDeployment } from "./upgrade-verification.mjs";
import { createFactoryOnboardingService } from "./factory-onboarding.mjs";
import { eventV9LumaTemplate, V9_LUMA_ATTENDANCE_STANDARD } from "./contracts-v9-luma.mjs";
import { createProductionCasePublicationService } from "./production-case-publication.mjs";
import {
  hash,
  id,
  json,
  lower,
  requireThat,
  text,
  email,
  associations,
  hasVerifiedParticipantWallet,
} from "./utils.mjs";
import { pairReturns, depKey } from "../references/kickback/scripts/lib.mjs";

const names = [
  "organizer-a",
  "organizer-b",
  "staff-a",
  "alice",
  "bob",
  "carol",
];
const labels = [
  "Organizer A · Maya",
  "Organizer B · Arun",
  "Door staff · Event A",
  "Alice · participant",
  "Bob · participant",
  "Carol · participant",
];
const ownerActions = new Set([
  "register",
  "reject",
  "postAttendance",
  "addAttendees",
  "cancel",
  "refund",
  "sweep",
  "transferOwnership",
]);

export async function createWorkbench({
  rpcPort = 0,
  contractVersion = "truth-pays-v7",
  testnet = null,
  production = null,
  serverInstanceId = id(),
} = {}, { productionRuntime = mainnetChain, productionStore = mainnetStateStore } = {}) {
  requireThat(
    contractVersion === "truth-pays-v7" || isV8Version(contractVersion),
    "Unsupported contract version",
  );
  requireThat(!(testnet && production), "Choose one external environment");
  const external = !!(testnet || production);
  const externalConfig = production || testnet;
  const activeContractVersion = production ? "kleros-event-v9-uups"
    : external ? externalConfig.manifest.events[0].deployment.contractVersion : contractVersion;
  requireThat(external || !eventV8Profile(contractVersion)?.upgradeable,
    "Upgradeable production events require an explicit reviewed production manifest");
  const nativeSymbol = external
    ? (externalConfig.manifest?.chain?.nativeCurrency?.symbol ?? "native token")
    : "ETH";
  const chain = production
    ? await productionRuntime(production.manifest, production.rpcUrl)
    : external
    ? await testnetChain(externalConfig.manifest, testnet.rpcUrl)
    : await localChain(rpcPort);
  const store = production
    ? productionStore(production.stateFile, production.manifest)
    : external
    ? testnetStateStore(testnet.stateFile, externalConfig.manifest)
    : null;
  const factoryDeployment = production ? production.manifest.factoryDeployment ?? Reflect.get(chain, "factoryDeployment") : null;
  async function refreshFactory() {
    if (!factoryDeployment) return;
    try {
      Reflect.set(chain, "factoryTrust", await verifyV9FactoryDeployment(chain, factoryDeployment));
      Reflect.set(chain, "verifiedFactory", true);
    } catch {
      Reflect.set(chain, "factoryTrust", null);
      Reflect.set(chain, "verifiedFactory", false);
    }
  }
  async function assertWallet(wallet) {
    if (!production) return null;
    requireThat(BigInt(await chain.provider.send("eth_chainId", [])) === 1n,
      "Production RPC chain changed", "WRONG_CHAIN", 409);
    const result = await assertProductionEOAWallet(chain.provider, wallet);
    requireThat(BigInt(await chain.provider.send("eth_chainId", [])) === 1n,
      "Production RPC chain changed", "WRONG_CHAIN", 409);
    return result;
  }
  async function assertDraftDeployment(r, st) {
    if (!production) return;
    await verifyDeployment(chain, r.deployment);
    const trust = Reflect.get(chain, "deploymentTrust")?.get(hash(r.deployment));
    requireThat(trust && hash(trust.upgrade) === hash(st.upgrade),
      "Upgrade governance changed; review a fresh draft", "STALE_DRAFT", 409);
  }
  async function finishDraftChecks(r, st, wallet) {
    if (!production) return;
    await assertDraftDeployment(r, st);
    // Wallet compatibility closes the slow provenance scan, then implementation
    // slots are read at that same block before its final canonical recheck.
    const checked = await assertWallet(wallet);
    const tag = ethers.toQuantity(checked.blockNumber);
    const [eventSlot, factorySlot] = await Promise.all([
      chain.provider.send("eth_getStorageAt", [r.deployment.contract, IMPLEMENTATION_SLOT, tag]),
      chain.provider.send("eth_getStorageAt", [r.deployment.factory, IMPLEMENTATION_SLOT, tag]),
    ]);
    const canonical = await chain.provider.send("eth_getBlockByNumber", [tag, false]);
    requireThat(ethers.isHexString(eventSlot, 32) && ethers.isHexString(factorySlot, 32) &&
      BigInt(eventSlot) === BigInt(r.deployment.implementation) &&
      BigInt(factorySlot) === BigInt(r.deployment.factoryImplementation) &&
      canonical?.hash?.toLowerCase() === checked.blockHash,
      "Production wallet or implementation snapshot changed", "UPGRADE_TRUST_MISMATCH", 409);
  }
  function externalMetadata(s = null) {
    if (!production) return external ? {
      arbitration: { mode: "controlled", notice: "Controlled test arbitrator; no independent jury" },
    } : {};
    return {
      environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
      arbitration: { ...production.manifest.arbitration, verified: true,
        label: "Kleros V1 · Ethereum", notice: "Real Kleros arbitration on Ethereum mainnet" },
      walletSupport: { type: "eoa-only", eoa: true, erc1271: false, eip7702: false,
        notice: "Use a standard wallet account. Smart contract and delegated accounts are not supported." },
      contractProfile: { ...eventV8Profile("kleros-event-v9-uups"), verified: true },
      governance: { ...production.manifest.governance },
      ...(factoryDeployment ? {
        factory: { chainId: 1, address: factoryDeployment.factory, contractVersion: activeContractVersion,
          abiVersion: activeContractVersion, verified: Reflect.get(chain, "verifiedFactory") === true,
          deploymentTrust: Reflect.get(chain, "factoryTrust")?.deploymentTrust ?? { status: "unavailable" },
          upgrade: Reflect.get(chain, "factoryTrust")?.upgrade ?? null },
        organizerSetup: { policyURI: factoryDeployment.policy?.uri ?? null,
          policySha256: factoryDeployment.policy?.sha256 ?? null,
          policyStatus: factoryDeployment.policyStatus === "published" && factoryDeployment.policy?.uri ? "verified" : "unpublished",
          attendanceStandard: { ...V9_LUMA_ATTENDANCE_STANDARD },
          challengeWindowSeconds: 86400, matchWindowSeconds: 86400, minimumClaimDays: 7 },
      } : {}),
      // Only a wallet's own saved reviews reveal these minimal identities.
      // They authorize receipt lookup, never a fresh financial action.
      recoveryEvents: s?.wallet ? [...new Set([...drafts.values()]
        .filter(d => lower(d.wallet) === lower(s.wallet)).map(d => d.eventId))]
        .map(eventId => events.get(eventId)).filter(Boolean).map(r => ({
          id: r.definition.id, chainId: r.deployment.chainId,
          contract: r.deployment.contract, contractVersion: r.deployment.contractVersion,
          abiVersion: r.deployment.abiVersion,
        })) : [],
    };
  }
  const events = new Map(),
    drafts = new Map(),
    locks = new Set();
  const identities = await Promise.all(
    (external ? [] : names).map(async (name, i) => ({
      id: name,
      label: labels[i],
      wallet: await chain.signers[i].getAddress(),
      mode: "demo",
      signer: chain.signers[i],
    })),
  );
  const session = (identity) => {
    const found = identities.find((x) => x.id === identity);
    requireThat(found, "Unknown demo identity");
    return found;
  };
  function authenticated(s) {
    requireThat(
      s?.wallet && ethers.isAddress(s.wallet),
      "Sign in first",
      "UNAUTHENTICATED",
      401,
    );
  }
  function record(eventId, s) {
    const r = events.get(eventId);
    requireThat(r, "Unknown event", "NOT_FOUND", 404);
    if (
      r.definition.visibility === "private" ||
      r.definition.editorialStatus === "draft"
    )
      requireThat(
        s &&
          [
            r.definition.organizers,
            r.definition.staff,
            [...r.participants.values()].map((p) => p.wallet),
            r.financialAccess ?? [],
          ]
            .flat()
            .some((x) => lower(x) === lower(s.wallet)),
        "Private or unpublished event",
        "FORBIDDEN",
        403,
      );
    return r;
  }
  const contract = (eventId) => {
    const r = events.get(eventId);
    requireThat(r, "Unknown event", "NOT_FOUND", 404);
    return contractFor(chain, r.deployment);
  };
  const state = async (eventId, options = {}) => {
    const r = events.get(eventId);
    requireThat(r, "Unknown event", "NOT_FOUND", 404);
    const result = await chainState(chain, r, options);
    r.financialAccess = [result.owner, result.pendingOwner];
    return result;
  };
  async function owner(eventId, s) {
    authenticated(s);
    await state(eventId);
    const r = record(eventId, s);
    requireThat(
      lower(await contractFor(chain, r.deployment).owner()) === lower(s.wallet),
      "Only this event’s current contract owner can do that",
      "NOT_OWNER",
      403,
    );
    return r;
  }
  async function staff(eventId, s) {
    authenticated(s);
    await state(eventId);
    const r = record(eventId, s);
    requireThat(
      r.definition.staff.some((x) => lower(x) === lower(s.wallet)) ||
        lower(await contractFor(chain, r.deployment).owner()) ===
          lower(s.wallet),
      "Staff access is scoped to this event",
      "NOT_STAFF",
      403,
    );
    return r;
  }
  function participantFor(r, s, participantId) {
    const p = participantId
      ? r.participants.get(participantId)
      : [...r.participants.values()].find(
          (x) => lower(x.wallet) === lower(s.wallet),
        );
    requireThat(p, "Register a linked participant first", "UNKNOWN_IDENTITY");
    return p;
  }
  function ensureWalletParticipant(r, s) {
    authenticated(s);
    const existing = [...r.participants.values()].find(p => lower(p.wallet) === lower(s.wallet));
    if (existing) return existing;
    requireThat(production && s.mode === "wallet", "A verified wallet is required", "WALLET_REQUIRED", 403);
    const person = { id: id(), eventId: r.definition.id, wallet: ethers.getAddress(s.wallet),
      name: null, email: null, walletVerified: true, identityVerified: false,
      identitySource: "signed-wallet-nonce", lumaIdentity: null, admission: "pending", deposit: null };
    r.participants.set(person.id, person);
    r.revision++;
    return person;
  }
  async function productionDepositAction(r, s, st, creditValue = null) {
    const c = contract(r.definition.id), at = { blockTag: st.blockNumber };
    const [status, credit] = await Promise.all([
      c.status(s.wallet, at), creditValue === null ? c.pendingDeposits(s.wallet, at) : BigInt(creditValue),
    ]);
    const amount = BigInt(r.deployment.depositWei) > credit ? BigInt(r.deployment.depositWei) - credit : 0n;
    let reasonCode = null, reason = null;
    if (st.phase !== "Open") { reasonCode = "DEPOSIT_CLOSED"; reason = "This event no longer accepts deposits."; }
    else if (st.now < r.deployment.depositOpensAt || st.now >= r.deployment.depositDeadline) {
      reasonCode = "OUTSIDE_DEPOSIT_WINDOW"; reason = "Deposits close when the event starts.";
    } else if (r.definition.registrationStatus !== "open") { reasonCode = "DEPOSIT_CLOSED"; reason = "The organizer has closed deposits."; }
    else if ([1, 2].includes(Number(status))) { reasonCode = "ALREADY_REGISTERED"; reason = "Your commitment is already registered. No further deposit is needed."; }
    else if (Number(status) === 3) { reasonCode = "REGISTRATION_REJECTED"; reason = "This wallet cannot be admitted again. Any unused credit remains withdrawable."; }
    else if (r.transactions.some(t => t.action === "deposit" && lower(t.wallet) === lower(s.wallet) && ["pending", "mined"].includes(t.status))) {
      reasonCode = "PENDING_DEPOSIT"; reason = "Check your submitted deposit before preparing another payment.";
    } else if (amount === 0n) { reasonCode = "CREDIT_AVAILABLE"; reason = "Your deposit is fully funded. Organizer approval and admission are separate."; }
    return { eligible: reasonCode === null, amountWei: reasonCode === null ? String(amount) : "0", reasonCode, reason };
  }
  async function createEvent(s, input, seedId) {
    authenticated(s);
    requireThat(
      !external && s.mode === "demo",
      "New deployments are local demo only",
      "DEMO_ONLY",
      403,
    );
    const title = text(input.title, 160, 2),
      slug = text(input.slug, 80, 2);
    requireThat(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
        ![...events.values()].some((r) => r.definition.slug === slug),
      "Slug must be unique lowercase words",
    );
    const startsAt = text(input.startsAt, 40, 1),
      endsAt = text(input.endsAt, 40, 1);
    const start = Date.parse(startsAt) / 1000,
      end = Date.parse(endsAt) / 1000;
    const now = (await chain.provider.getBlock("latest")).timestamp;
    requireThat(
      Number.isInteger(start) &&
        end > start &&
        start > now &&
        /(Z|[+-]\d\d:\d\d)$/.test(startsAt) &&
        /(Z|[+-]\d\d:\d\d)$/.test(endsAt),
      "Schedule must have explicit timezone and start in local chain future",
    );
    const timezone = text(input.timezone, 100, 1);
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      requireThat(false, "Use an IANA timezone");
    }
    let depositWei;
    try {
      depositWei = ethers.parseEther(String(input.depositEth));
    } catch {
      requireThat(false, "Invalid ETH deposit");
    }
    requireThat(
      depositWei > 0n && depositWei <= ethers.parseEther("1"),
      "Local deposit must be >0 and <=1 ETH",
    );
    requireThat(
      !Object.hasOwn(input, "_seedId") &&
        !Object.hasOwn(input, "id") &&
        !Object.hasOwn(input, "eventId"),
      "Stable event IDs are assigned by the registry",
      "RESERVED_EVENT_ID",
      403,
    );
    const eventId = seedId ?? id();
    requireThat(
      !events.has(eventId),
      "Event identity already exists",
      "DUPLICATE_EVENT",
      409,
    );
    const definition = {
      id: eventId,
      slug,
      title,
      description: text(input.description ?? "", 2000),
      startsAt,
      endsAt,
      timezone,
      location: text(input.location, 200, 1),
      visibility: input.visibility === "private" ? "private" : "public",
      editorialStatus: "published",
      registrationStatus: "open",
      organizers: [s.wallet],
      staff: [],
      ...associations(input),
    };
    const financial = await deployEvent(
      chain,
      definition,
      s.signer,
      depositWei,
      start,
      end + 14 * DAY,
      { contractVersion },
    );
    const r = {
      definition,
      ...financial,
      financialAccess: [s.wallet],
      participants: new Map(),
      observations: [],
      batches: [],
      personal: new Map(),
      publications: new Map(),
      transactions: [],
      nonces: new Set(),
      revision: 0,
    };
    events.set(eventId, r);
    return {
      ...definition,
      ...financial.deployment,
      financialPhase: "Open",
      depositWei: String(depositWei),
    };
  }
  const initial = (await chain.provider.getBlock("latest")).timestamp;
  for (const [i, eventId] of (external
    ? []
    : ["event-a", "event-b"]
  ).entries()) {
    const start = initial + (i + 1) * 3600;
    await createEvent(
      identities[i],
      {
        title: i ? "Open Justice Workshop" : "Proof of Presence",
        slug: i ? "open-justice-workshop" : "proof-of-presence",
        description: i
          ? "A hands-on workshop on dispute resolution. An independent event with its own organizer and deposit pool."
          : "Meet the people building fairer systems. Choose a free request or a refundable committed spot.",
        startsAt: new Date(start * 1000).toISOString(),
        endsAt: new Date((start + 4 * 3600) * 1000).toISOString(),
        timezone: i ? "Asia/Bangkok" : "Asia/Kolkata",
        location: i
          ? "Studio B · Bangkok (synthetic)"
          : "Forum A · Mumbai (synthetic)",
        depositEth: i ? "0.02" : "0.01",
      },
      eventId,
    );
    const r = events.get(eventId);
    if (!i) r.definition.staff = [identities[2].wallet];
    for (const p of identities.slice(3))
      r.participants.set(`${eventId}-${p.id}`, {
        id: `${eventId}-${p.id}`,
        eventId,
        name: p.id[0].toUpperCase() + p.id.slice(1),
        email: `${p.id}@example.test`,
        wallet: p.wallet,
        identityVerified: true,
        identitySource: "local-demo-signer",
        admission: "pending",
        deposit: null,
      });
  }
  if (external) {
    for (const initial of externalConfig.manifest.events) {
      const eventId = initial.definition.id;
      requireThat(!events.has(eventId), "Duplicate external event ID");
      events.set(eventId, {
        ...initial,
        financialAccess: [],
        participants: new Map(),
        observations: [],
        batches: [],
        personal: new Map(),
        publications: new Map(),
        transactions: [],
        nonces: new Set(),
        revision: 0,
      });
    }
    const saved = store.load();
    if (saved) {
      for (const item of saved.events) {
        if (production && item.dynamic === true && !events.has(item.eventId)) {
          events.set(item.eventId, { definition: item.definition, deployment: item.deployment,
            dynamic: true, policy: item.policy, pieces: item.pieces, slots: item.slots,
            financialAccess: [], participants: new Map(), observations: [], batches: [], personal: new Map(),
            publications: new Map(), transactions: [], nonces: new Set(), revision: 0 });
        }
        const r = events.get(item.eventId);
        requireThat(
          r && item.definition.id === item.eventId,
          "Persisted event identity mismatch",
        );
        requireThat(
          item.definition.title === r.definition.title &&
            item.definition.startsAt === r.definition.startsAt &&
            item.definition.endsAt === r.definition.endsAt,
          "Persisted event schedule or title differs from its manifest",
        );
        const definition = { ...r.definition };
        for (const key of [
          "description",
          "location",
          "visibility",
          "editorialStatus",
          "registrationStatus",
          "lumaEventId",
          "lumaUrl",
          "contentEventId",
          "contentUrl",
        ])
          if (Object.hasOwn(item.definition, key))
            definition[key] = item.definition[key];
        Object.assign(r, {
          definition,
          revision: item.revision,
          observations: item.observations,
          batches: item.batches,
          transactions: item.transactions,
          participants: new Map(item.participants),
          personal: new Map(item.personal),
          publications: new Map(item.publications),
          nonces: new Set(item.nonces),
        });
      }
      for (const [key, value] of saved.drafts) drafts.set(key, value);
    }
  }
  const factoryService = factoryDeployment ? createFactoryOnboardingService(/** @type {any} */ ({
    chain, factoryDeployment, events, drafts, store, instanceId: serverInstanceId, assertWallet,
    verifyFactory: (context, deployment) => verifyV9FactoryDeployment(context, deployment),
  })) : null;
  function onboarding() {
    requireThat(factoryService, "A verified factory is required", "FACTORY_UNAVAILABLE", 503);
    return factoryService;
  }
  async function summary(r, s, knownState = null) {
    const st = knownState ?? (await chainState(chain, r));
    let immutableLuma = {};
    if (production && r.dynamic === true) {
      const template = eventV9LumaTemplate({ eventName: r.deployment.eventName, depositAmount: r.deployment.depositWei,
        policyURI: r.deployment.policyURI, policySha256: hash(r.policy), lumaUrl: r.definition.lumaUrl,
        startsAt: r.definition.startsAt, endsAt: r.definition.endsAt, timezone: r.definition.timezone });
      requireThat(hash([template.pieces, template.slots]) === r.deployment.templateHash,
        "The Luma destination or event terms differ from the verified contract", "IMMUTABLE_EVENT_TERMS", 409);
      immutableLuma = { attendanceStandard: { ...V9_LUMA_ATTENDANCE_STANDARD },
        immutableTerms: { lumaUrl: r.definition.lumaUrl, startsAt: r.definition.startsAt, endsAt: r.definition.endsAt,
          timezone: r.definition.timezone, policySha256: hash(r.policy) } };
    }
    const role =
      s && lower(s.wallet) === lower(st.owner)
        ? "organizer"
        : s && r.definition.staff.some((x) => lower(x) === lower(s.wallet))
          ? "staff"
          : "participant";
    return {
      ...r.definition,
      ...immutableLuma,
      depositWei: r.deployment.depositWei,
      contract: r.deployment.contract,
      chainId: r.deployment.chainId,
      deploymentBlock: r.deployment.deploymentBlock,
      contractVersion: r.deployment.contractVersion,
      abiVersion: r.deployment.abiVersion,
      ...(production
        ? { contractProfile: { ...eventV8Profile(r.deployment.contractVersion), verified: st.deploymentTrust?.status === "verified" } }
        : eventV8Profile(r.deployment.contractVersion)?.testOnly
        ? { contractProfile: eventV8Profile(r.deployment.contractVersion) }
        : {}),
      claimDeadline: r.deployment.claimDeadline,
      policyURI: r.deployment.policyURI,
      templateHash: r.deployment.templateHash,
      depositOpensAt: r.deployment.depositOpensAt,
      depositDeadline: r.deployment.depositDeadline,
      resolver: r.deployment.resolver,
      arbitrator: r.deployment.arbitrator,
      financialPhase: st.phase,
      role,
    };
  }
  async function bootstrap(s, options = {}) {
    await refreshFactory();
    if (Object.hasOwn(options, "selectedEventId"))
      return selectedBootstrap(s, options.selectedEventId);
    if (production) {
      const { selectedEvent, ...directory } = await selectedBootstrap(s, "");
      return directory;
    }
    await Promise.all(
      [...events.values()]
        .filter(
          (r) =>
            r.definition.visibility === "private" ||
            r.definition.editorialStatus === "draft",
        )
        .map((r) => state(r.definition.id)),
    );
    const visible = [...events.values()].filter((r) => {
      try {
        record(r.definition.id, s);
        return true;
      } catch {
        return false;
      }
    });
    return {
      mode: production ? "hosted-production" : external ? "testnet" : "local-demo",
      identities: identities.map(({ signer, ...x }) => x),
      session: s ? { wallet: s.wallet, label: s.label, mode: s.mode } : null,
      events: await Promise.all(visible.map((r) => summary(r, s))),
      chain: external
        ? externalConfig.manifest.chain
        : {
            chainId: Number((await chain.provider.getNetwork()).chainId),
            rpcUrl: chain.rpcUrl,
            name: "Local demo",
            nativeCurrency: { name: "Demo Ether", symbol: "ETH", decimals: 18 },
          },
      contractVersion: external
        ? activeContractVersion
        : contractVersion,
      ...(eventV8Profile(external ? activeContractVersion : contractVersion)?.testOnly
        ? { contractProfile: eventV8Profile(external ? activeContractVersion : contractVersion) }
        : {}),
      ...externalMetadata(s),
      now: (await chain.provider.getBlock("latest")).timestamp,
    };
  }
  // This map exists for one response only. It never survives a request, wallet
  // change, ownership change or server instance; its snapshots are all fresh.
  async function selectedBootstrap(s, selectedEventId) {
    const snapshots = new Map();
    const failed = new Set();
    const snapshot = (eventId) => {
      if (!snapshots.has(eventId))
        snapshots.set(
          eventId,
          state(eventId, { includeBlockHash: true }).catch((error) => {
            failed.add(eventId);
            throw error;
          }),
        );
      return snapshots.get(eventId);
    };
    const selected = (async () => {
      requireThat(
        typeof selectedEventId === "string" &&
          /^[a-zA-Z0-9_-]{1,160}$/.test(selectedEventId),
        "Choose one stable event identity",
        "INVALID_INPUT",
        400,
      );
      const st = await snapshot(selectedEventId);
      const result = await detail(selectedEventId, s, st);
      return {
        eventId: selectedEventId,
        wallet: s?.wallet ?? null,
        detail: result,
      };
    })().catch((error) => ({
      eventId: selectedEventId,
      wallet: s?.wallet ?? null,
      detail: null,
      error: selectedError(error),
    }));
    await Promise.all(
      [...events.values()]
        .filter(
          (r) =>
            r.definition.visibility === "private" ||
            r.definition.editorialStatus === "draft",
        )
        .map((r) =>
          snapshot(r.definition.id).catch((error) => {
            if (!production && r.definition.id !== selectedEventId) throw error;
          }),
        ),
    );
    const visible = [...events.values()].filter((r) => {
      if (failed.has(r.definition.id)) return false;
      try {
        record(r.definition.id, s);
        return true;
      } catch {
        return false;
      }
    });
    const summaries = Promise.all(
      visible.map(async (r) => {
        if (r.definition.id === selectedEventId)
          return (await selected).detail?.event ?? null;
        try {
          return await summary(r, s, await snapshot(r.definition.id));
        } catch (error) {
          if (!production && r.definition.id !== selectedEventId) throw error;
          return null;
        }
      }),
    );
    const [directory, initialSelection, nowBlock, network] = await Promise.all([
      summaries,
      selected,
      chain.provider.getBlock("latest"),
      external ? Promise.resolve(null) : chain.provider.getNetwork(),
    ]);
    // Final authority reads cover the whole bundle, after every slow directory
    // and metadata read. No other asynchronous work follows disclosure checks.
    const disclosed = await selectedDisclosure(
      s,
      directory.filter(Boolean),
      initialSelection,
      initialSelection.detail ? await snapshot(selectedEventId) : null,
    );
    return {
      mode: production ? "hosted-production" : external ? "testnet" : "local-demo",
      identities: identities.map(({ signer, ...x }) => x),
      session: s ? { wallet: s.wallet, label: s.label, mode: s.mode } : null,
      events: disclosed.directory,
      chain: external
        ? externalConfig.manifest.chain
        : {
            chainId: Number(network.chainId),
            rpcUrl: chain.rpcUrl,
            name: "Local demo",
            nativeCurrency: { name: "Demo Ether", symbol: "ETH", decimals: 18 },
          },
      contractVersion: external
        ? activeContractVersion
        : contractVersion,
      ...(eventV8Profile(
        external
          ? activeContractVersion
          : contractVersion,
      )?.testOnly
        ? {
            contractProfile: eventV8Profile(
              external
                ? activeContractVersion
                : contractVersion,
            ),
          }
        : {}),
      ...externalMetadata(s),
      now: nowBlock.timestamp,
      selectedEvent: disclosed.selectedEvent,
    };
  }
  function selectedError(error) {
    const known = {
      NOT_FOUND: [404, "Unknown event"],
      FORBIDDEN: [403, "Private or unpublished event"],
      INVALID_INPUT: [400, "Choose one stable event identity"],
      SELECTED_EVENT_ACCESS_CHANGED: [
        409,
        "Event access changed; refresh and try again",
      ],
      SELECTED_EVENT_REORG: [
        409,
        "Event snapshot changed; refresh and try again",
      ],
    };
    const code = Object.hasOwn(known, error?.code)
      ? error.code
      : "SELECTED_EVENT_UNAVAILABLE";
    const [status, message] = known[code] ?? [
      503,
      "Selected event is temporarily unavailable",
    ];
    return { code, status, message };
  }
  async function selectedDisclosure(s, directory, selection, st) {
    const deniedSelection = (error) => ({
      eventId: selection.eventId,
      wallet: s?.wallet ?? null,
      detail: null,
      error: selectedError(error),
    });
    const targets = new Map(
      directory.map((item) => [item.id, events.get(item.id)]),
    );
    if (selection.detail)
      targets.set(selection.eventId, events.get(selection.eventId));
    let rows, canonical;
    try {
      const current = await chain.provider.getBlock("latest");
      [rows, canonical] = await Promise.all([
        Promise.all(
          [...targets].map(async ([eventId, r]) => {
            try {
              const c = contract(eventId);
              const [owner, pendingOwner] = await Promise.all([
                c.owner({ blockTag: current.number }),
                c.pendingOwner({ blockTag: current.number }),
              ]);
              return {
                eventId,
                r,
                owner,
                pendingOwner,
                available: true,
                error: null,
              };
            } catch (error) {
              return {
                eventId,
                r,
                owner: null,
                pendingOwner: null,
                available: false,
                error,
              };
            }
          }),
        ),
        st ? chain.provider.getBlock(st.blockNumber) : Promise.resolve(null),
      ]);
      // Owner/pending-owner results are valid only while their newer authority
      // block remains canonical; the older selected payment block is separate.
      const authorityBlock = await chain.provider.getBlock(current.number);
      requireThat(
        authorityBlock?.number === current.number &&
          authorityBlock.hash === current.hash,
        "Current event authority snapshot changed",
        "SELECTED_EVENT_REORG",
        409,
      );
    } catch (error) {
      return {
        directory: [],
        selectedEvent: selection.detail ? deniedSelection(error) : selection,
      };
    }
    // All authority data is now available. Synchronous checks below observe the
    // latest app visibility/staff lists without awaiting another event's RPCs.
    const authority = new Map(rows.map((row) => [row.eventId, row]));
    for (const row of rows)
      if (row.available) row.r.financialAccess = [row.owner, row.pendingOwner];
    const roleOf = (row) =>
      s && lower(s.wallet) === lower(row.owner)
        ? "organizer"
        : s &&
            row.r.definition.staff.some(
              (wallet) => lower(wallet) === lower(s.wallet),
            )
          ? "staff"
          : "participant";
    let selectedEvent = selection;
    if (selection.detail) {
      try {
        const row = authority.get(selection.eventId);
        if (!row.available) throw row.error;
        record(selection.eventId, s);
        requireThat(
          roleOf(row) === selection.detail.event.role,
          "Event access changed",
          "SELECTED_EVENT_ACCESS_CHANGED",
          409,
        );
        requireThat(
          canonical?.hash === st.blockHash &&
            selection.detail.payments.blockHash === st.blockHash,
          "Selected event snapshot changed",
          "SELECTED_EVENT_REORG",
          409,
        );
      } catch (error) {
        selectedEvent = deniedSelection(error);
      }
    }
    const visible = directory.filter((item) => {
      if (item.id === selection.eventId && !selectedEvent.detail) return false;
      const row = authority.get(item.id);
      if (!row?.available) return false;
      try {
        record(item.id, s);
      } catch {
        return false;
      }
      // Keep immutable financial fields from the snapshot. Refresh only current
      // access metadata and role; selected summary remains detail.event itself.
      Object.assign(item, {
        visibility: row.r.definition.visibility,
        editorialStatus: row.r.definition.editorialStatus,
        staff: row.r.definition.staff,
        organizers: row.r.definition.organizers,
        role: roleOf(row),
      });
      return true;
    });
    return { directory: visible, selectedEvent };
  }

  async function detail(eventId, s, knownState = null) {
    const st = knownState ?? (await state(eventId)),
      r = record(eventId, s),
      event = await summary(r, s, st);
    // Wallet-owned recovery is independent of names, contact records or admission.
    // Its values use the same canonical block as the surrounding financial state.
    /** @type {{wallet:string,owedWei:string,pendingCreditWei?:string,deposit?:any,depositAction?:any}|null} */
    const ownWallet = s?.wallet
      ? {
          wallet: s.wallet,
          owedWei: String(
            await contract(eventId).owed(s.wallet, {
              blockTag: st.blockNumber,
            }),
          ),
          ...(isV8Version(r.deployment.contractVersion)
            ? {
                pendingCreditWei: String(
                  await contract(eventId).pendingDeposits(s.wallet, {
                    blockTag: st.blockNumber,
                  }),
                ),
              }
            : {}),
        }
      : null;
    const privileged = event.role !== "participant";
    const participants = await Promise.all(
      [...r.participants.values()]
        .filter((p) => privileged || (s && lower(p.wallet) === lower(s.wallet)))
        .map(async (p) => {
          const status = Number(
            await contract(eventId).status(p.wallet, {
              blockTag: st.blockNumber,
            }),
          );
          let verificationState = p.deposit ? "current" : "missing",
            verificationError = null;
          if (p.deposit)
            try {
              await verifyReceipt(
                eventId,
                p,
                p.deposit.txHash,
                true,
                knownState ? st.blockNumber : "latest",
              );
            } catch (e) {
              verificationState =
                e.code === "RETURNED_DEPOSIT" ? "returned" : "unavailable";
              verificationError = e.code ?? "VERIFICATION_UNAVAILABLE";
            }
          return {
            ...p,
            status,
            registrationState: ["unregistered", "active", "paid", "rejected"][
              status
            ],
            deposit: p.deposit
              ? {
                  ...p.deposit,
                  receiptVerified: true,
                  verified: verificationState === "current",
                  verificationState,
                  verificationError,
                }
              : null,
            batchEligibility: Object.fromEntries(
              ["approve-admission", "check-in"].map((action) => [
                action,
                participantBatchEligibility(r, p, st, action, {
                  depositVerification: verificationState,
                }),
              ]),
            ),
            registered: [1, 2].includes(status),
            attended: await contract(eventId).attended(p.wallet, {
              blockTag: st.blockNumber,
            }),
            owedWei: String(
              await contract(eventId).owed(p.wallet, {
                blockTag: st.blockNumber,
              }),
            ),
            ...(isV8Version(r.deployment.contractVersion)
              ? {
                  pendingCreditWei: st.pendingCredits?.[lower(p.wallet)] ?? "0",
                }
              : {}),
          };
        }),
    );
    const deposits = privileged
      ? await depositLedger(eventId, st.blockNumber)
      : [];
    if (production && ownWallet) {
      const person = participants.find(p => lower(p.wallet) === lower(s.wallet));
      const transaction = [...r.transactions].reverse().find(t => t.action === "deposit" && lower(t.wallet) === lower(s.wallet));
      ownWallet.deposit = person?.deposit?.verificationState === "current"
        ? { status: "confirmed", hash: person.deposit.txHash, amountWei: person.deposit.amountWei,
            blockNumber: person.deposit.blockNumber }
        : transaction?.status === "failed" ? { status: "failed", hash: transaction.hash }
        : transaction && ["pending", "mined"].includes(transaction.status)
          ? { status: "submitted", hash: transaction.hash } : { status: "none" };
      Object.assign(ownWallet.deposit, { wallet: s.wallet, eventId, chainId: r.deployment.chainId,
        contract: r.deployment.contract, abiVersion: r.deployment.abiVersion });
      ownWallet.depositAction = await productionDepositAction(r, s, st, ownWallet.pendingCreditWei);
    }
    const stateDTO = knownState
      ? Object.fromEntries(Object.entries(st).filter(([key]) => key !== "blockHash"))
      : { ...st };
    if (production) {
      stateDTO.cases = await Promise.all(st.cases.map(async item => {
        if (!item.matched) return item;
        const rewardsReady = item.finalRuling !== null;
        const withdrawableWei = rewardsReady && s?.wallet
          ? String(await chain.resolver.getTotalWithdrawableAmount(
              item.localDisputeID, s.wallet, [0, 1, 2], { blockTag: st.blockNumber }))
          : null;
        return { ...item, rewardsReady,
          appeal: { ...item.appeal, rewardsReady, withdrawableWei } };
      }));
    }
    return {
      event,
      state: stateDTO,
      payments: await projectPayments(chain, r, { blockTag: st.blockNumber }),
      ...(production ? { deploymentTrust: st.deploymentTrust, upgrade: st.upgrade } : {}),
      ownWallet,
      participants,
      deposits,
      unmatched: deposits.filter((x) => BigInt(x.unallocatedWei) > 0n),
      imports: privileged ? r.batches : [],
      attendance: privileged
        ? r.observations
        : r.observations.filter((o) =>
            participants.some((p) => p.id === o.participantId),
          ),
      personal: s ? (r.personal.get(lower(s.wallet)) ?? null) : null,
      transactions: r.transactions.filter(
        (t) => privileged || (s && lower(t.wallet) === lower(s.wallet)),
      ),
      permissions: {
        owner: event.role === "organizer",
        staff: privileged,
        authenticated: !!s,
      },
      now: st.now,
    };
  }
  /** @param {string} eventId @param {number | "latest"} [blockTag]
   * @param {{signal?: AbortSignal}} [options]
   */
  async function depositLedger(eventId, blockTag = "latest", { signal } = {}) {
    signal?.throwIfAborted();
    const r = events.get(eventId),
      c = contract(eventId),
      from = r.deployment.deploymentBlock,
      end =
        blockTag === "latest"
          ? await chain.provider.getBlockNumber()
          : blockTag,
      at = { blockTag: end };
    if (isV8Version(r.deployment.contractVersion)) {
      const credits = await v8DepositCredits(c, r.deployment, end, { signal });
      return Promise.all(
        [...credits.values()].map(async (e) => {
          signal?.throwIfAborted();
          const pending = await c.pendingDeposits(e.wallet, at);
          const projected = e.lots.reduce((sum, lot) => sum + lot.pending, 0n);
          requireThat(
            pending === projected,
            "v8 credit projection differs from contract",
            "CREDIT_HISTORY",
            409,
          );
          const received = e.lots.reduce((sum, lot) => sum + lot.amount, 0n);
          const committed = e.lots.reduce(
            (sum, lot) => sum + lot.committed,
            0n,
          );
          const p = [...r.participants.values()].find(
            (p) => lower(p.wallet) === lower(e.wallet),
          );
          return {
            eventId,
            wallet: e.wallet,
            participantId: p?.id ?? null,
            receivedWei: String(received),
            returnedWei: String(received - pending - committed),
            allocatedWei: String(committed),
            unallocatedWei: String(pending),
            pendingCreditWei: String(pending),
            linked: !!p?.deposit,
            transactions: e.lots.map((lot) => ({
              txHash: lot.txHash,
              logIndex: lot.logIndex,
              amountWei: String(lot.amount),
              blockNumber: lot.blockNumber,
              blockHash: lot.blockHash,
            })),
            note: `Unused credit belongs to this payer and can be recovered directly; it is never organizer spare ${nativeSymbol}.`,
          };
        }),
      );
    }
    const [deposited, rejected, refunded] = await Promise.all([
      c.queryFilter(c.filters.Deposited(), from, end),
      c.queryFilter(c.filters.Rejected(), from, end),
      c.queryFilter(c.filters.Refunded(), from, end),
    ]);
    signal?.throwIfAborted();
    /** @type {Map<string,{wallet:string,received:bigint,returned:bigint,transactions:object[]}>} */
    const ledger = new Map();
    const entry = (wallet) => {
      const key = lower(wallet);
      if (!ledger.has(key))
        ledger.set(key, {
          wallet,
          received: 0n,
          returned: 0n,
          transactions: [],
        });
      return ledger.get(key);
    };
    for (const l of deposited) {
      if (!("args" in l)) continue;
      const e = entry(l.args.from);
      e.received += l.args.amount;
      e.transactions.push({
        txHash: l.transactionHash,
        logIndex: l.index,
        amountWei: String(l.args.amount),
        blockNumber: l.blockNumber,
        blockHash: l.blockHash,
      });
    }
    for (const l of rejected) {
      if ("args" in l) entry(l.args.wallet).returned += l.args.refunded;
    }
    for (const l of refunded) {
      if ("args" in l) entry(l.args.to).returned += l.args.amount;
    }
    return Promise.all(
      [...ledger.values()].map(async (e) => {
        const status = Number(await c.status(e.wallet, at)),
          allocated = [1, 2].includes(status)
            ? BigInt(r.deployment.depositWei)
            : 0n;
        const unallocated = e.received - e.returned - allocated;
        const p = [...r.participants.values()].find(
          (p) => lower(p.wallet) === lower(e.wallet),
        );
        return {
          eventId,
          wallet: e.wallet,
          participantId: p?.id ?? null,
          receivedWei: String(e.received),
          returnedWei: String(e.returned),
          allocatedWei: String(allocated),
          unallocatedWei: String(unallocated > 0n ? unallocated : 0n),
          linked: !!p?.deposit,
          transactions: e.transactions,
          note: !p
            ? "No verified participant identity is linked"
            : !p.deposit
              ? "Receipt is not yet linked to this participant"
              : status === 0
                ? "Admission/registration still required"
                : "Registered principal excluded from spare returns",
        };
      }),
    );
  }
  async function registerParticipant(eventId, s, input) {
    authenticated(s);
    if (production) return ensureWalletParticipant(record(eventId, s), s);
    const r = record(eventId, s);
    requireThat(
      r.definition.registrationStatus === "open",
      "Registration is closed",
    );
    requireThat(
      ![...r.participants.values()].some(
        (p) => lower(p.wallet) === lower(s.wallet),
      ),
      "This wallet is already linked",
      "DUPLICATE_IDENTITY",
      409,
    );
    const contact = email(input.email);
    requireThat(
      ![...r.participants.values()].some((p) => p.email === contact),
      "Email is already linked in this event",
      "DUPLICATE_IDENTITY",
      409,
    );
    const p = {
      id: id(),
      eventId,
      name: text(input.name, 100, 1),
      email: contact,
      wallet: ethers.getAddress(s.wallet),
      identityVerified: true,
      identitySource:
        s.mode === "demo" ? "local-demo-signer" : "signed-wallet-nonce",
      admission: "pending",
      deposit: null,
    };
    r.participants.set(p.id, p);
    r.revision++;
    return p;
  }
  async function admit(eventId, s, participantId, admission) {
    const r = await owner(eventId, s);
    requireThat(
      ["pending", "approved", "declined", "free"].includes(admission),
      "Invalid admission",
    );
    const p = participantFor(r, s, participantId);
    requireThat(
      (await state(eventId)).phase === "Open",
      "Admission is closed after attendance posting",
    );
    p.admission = admission;
    r.revision++;
    return p;
  }
  /** @param {string} eventId @param {any} p @param {string} txHash
   * @param {boolean} [allowLinked] @param {number | "latest"} [blockTag]
   */
  async function verifyReceipt(
    eventId,
    p,
    txHash,
    allowLinked = false,
    blockTag = "latest",
  ) {
    requireThat(
      /^0x[0-9a-fA-F]{64}$/.test(txHash ?? ""),
      "A transaction hash is required",
    );
    const r = events.get(eventId),
      d = r.deployment,
      c = contract(eventId);
    requireThat(
      Number((await chain.provider.getNetwork()).chainId) === d.chainId,
      "Wrong chain",
      "WRONG_CHAIN",
      409,
    );
    const receipt = await chain.provider.getTransactionReceipt(txHash);
    requireThat(
      receipt && receipt.status === 1,
      "Deposit is pending, missing, or failed",
      "DEPOSIT_UNCONFIRMED",
      409,
    );
    const receiptBlock = await chain.provider.getBlock(receipt.blockNumber);
    requireThat(
      receipt.blockNumber >= d.deploymentBlock &&
        (blockTag === "latest" || receipt.blockNumber <= blockTag) &&
        receiptBlock?.hash === receipt.blockHash,
      "Deposit is not canonical for this deployment",
      "DEPOSIT_REORG",
      409,
    );
    requireThat(
      receiptBlock.timestamp >= d.depositOpensAt &&
        receiptBlock.timestamp < d.depositDeadline,
      "Deposit is outside this event’s registration window; organizer must review its return",
      "OUTSIDE_DEPOSIT_WINDOW",
      409,
    );
    const logs = receipt.logs
      .filter((l) => lower(l.address) === lower(d.contract))
      .map((l) => {
        try {
          return { log: l, parsed: c.interface.parseLog(l) };
        } catch {
          return null;
        }
      })
      .filter(
        (l) =>
          l?.parsed?.name === "Deposited" &&
          lower(l.parsed.args.from) === lower(p.wallet),
      );
    requireThat(
      logs.length === 1,
      "Receipt has no unique deposit from this participant to this contract",
      "WRONG_DEPOSIT",
      409,
    );
    const log = logs[0];
    requireThat(
      production && d.contractVersion === "kleros-event-v9-uups"
        ? log.parsed.args.amount > 0n
        : log.parsed.args.amount >= BigInt(d.depositWei),
      "Deposit amount is too small",
      "SHORT_DEPOSIT",
      409,
    );
    if (isV8Version(d.contractVersion)) {
      const person = (await v8DepositCredits(c, d, blockTag)).get(
        lower(p.wallet),
      );
      const lot = person?.lots.find(
        (lot) =>
          lower(lot.txHash) === lower(txHash) && lot.logIndex === log.log.index,
      );
      const committed =
        person?.lots.reduce((sum, item) => sum + item.committed, 0n) ?? 0n;
      const aggregatePending = person?.lots.reduce((sum, item) => sum + item.pending, 0n) ?? 0n;
      requireThat(
        lot &&
          ((production && d.contractVersion === "kleros-event-v9-uups"
            ? lot.pending > 0n && aggregatePending >= BigInt(d.depositWei)
            : lot.pending >= BigInt(d.depositWei)) ||
            (lot.committed > 0n && committed === BigInt(d.depositWei))),
        "This deposit credit was recovered or refunded and cannot be reused",
        "RETURNED_DEPOSIT",
        409,
      );
      const pending = person.lots.reduce((sum, lot) => sum + lot.pending, 0n);
      requireThat(
        pending === (await c.pendingDeposits(p.wallet, { blockTag })),
        "v8 credit history differs from contract",
        "CREDIT_HISTORY",
        409,
      );
    } else {
      // Preserve historical v7 pairing: spare returns do not erase held principal.
      const [deposited, rejected, refunded, registered] = await Promise.all([
        c.queryFilter(
          c.filters.Deposited(p.wallet),
          d.deploymentBlock,
          blockTag,
        ),
        c.queryFilter(
          c.filters.Rejected(p.wallet),
          d.deploymentBlock,
          blockTag,
        ),
        c.queryFilter(
          c.filters.Refunded(p.wallet),
          d.deploymentBlock,
          blockTag,
        ),
        c.queryFilter(
          c.filters.StakerRegistered(p.wallet),
          d.deploymentBlock,
          blockTag,
        ),
      ]);
      const deposits = deposited
        .filter((x) => "args" in x)
        .map((x) => ({
          tx: x.transactionHash,
          from: p.wallet,
          amount: /** @type {import('ethers').EventLog} */ (x).args.amount,
          block: x.blockNumber,
          logIndex: x.index,
        }));
      const returnEvents = [...rejected, ...refunded, ...registered]
        .filter((x) => "args" in x)
        .map((x) => {
          const l = /** @type {import('ethers').EventLog} */ (x);
          return {
            type: l.eventName,
            wallet: p.wallet,
            amount: l.eventName === "StakerRegistered" ? 0n : l.args[1],
            block: l.blockNumber,
            logIndex: l.index,
            tx: l.transactionHash,
          };
        });
      const status = Number(await c.status(p.wallet, { blockTag }));
      const paired = pairReturns(deposits, returnEvents, {
        deposit: BigInt(d.depositWei),
        prefer: new Set(
          [...r.participants.values()]
            .map((x) => lower(x.deposit?.txHash))
            .concat(lower(txHash)),
        ),
        stakers: new Set([1, 2].includes(status) ? [lower(p.wallet)] : []),
      });
      const held = paired.byDeposit.get(depKey(txHash, p.wallet));
      requireThat(
        held && held.remaining >= BigInt(d.depositWei),
        "Deposit principal was returned and cannot be reused",
        "RETURNED_DEPOSIT",
        409,
      );
    }
    const used = [...r.participants.values()].find(
      (x) =>
        x.deposit &&
        lower(x.deposit.txHash) === lower(txHash) &&
        x.deposit.logIndex === log.log.index,
    );
    requireThat(
      !used || (allowLinked && used.id === p.id),
      "Deposit log is already claimed",
      "DUPLICATE_EVIDENCE",
      409,
    );
    return {
      eventId,
      chainId: d.chainId,
      contract: d.contract,
      txHash,
      logIndex: log.log.index,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      amountWei: String(log.parsed.args.amount),
      wallet: p.wallet,
      verified: true,
    };
  }
  async function linkDeposit(eventId, s, input) {
    authenticated(s);
    const r = record(eventId, s);
    if (input.participantId) await owner(eventId, s);
    const p = participantFor(r, s, input.participantId);
    p.deposit = await verifyReceipt(eventId, p, input.txHash);
    const submitted = r.transactions.find(
      (t) =>
        lower(t.hash) === lower(input.txHash) &&
        t.action === "deposit" &&
        lower(t.wallet) === lower(p.wallet),
    );
    if (submitted) {
      submitted.status = "confirmed";
      submitted.blockNumber = p.deposit.blockNumber;
      const draft = drafts.get(submitted.draftId);
      if (draft) {
        draft.used = true;
        draft.confirmedHash = input.txHash;
      }
    }
    r.revision++;
    return p;
  }
  async function checkin(eventId, s, input) {
    const r = await staff(eventId, s),
      p = participantFor(r, s, input.participantId);
    requireThat(hasVerifiedParticipantWallet(r, p), "Participant wallet must be verified");
    requireThat(
      input.source === "staff-door",
      "Only authenticated door observations can use this endpoint",
      "UNTRUSTED_SOURCE",
    );
    const nonce = text(input.nonce, 100, 8);
    requireThat(
      !r.nonces.has(nonce),
      "Check-in nonce was already used",
      "REPLAY",
      409,
    );
    const timestamp = (await chain.provider.getBlock("latest")).timestamp;
    requireThat(
      timestamp >= Date.parse(r.definition.startsAt) / 1000 &&
        timestamp <= Date.parse(r.definition.endsAt) / 1000,
      "Door check-in is outside event hours",
      "ATTENDANCE_TIME_MISMATCH",
      409,
    );
    requireThat(
      !r.observations.some((o) => o.participantId === p.id),
      "Participant already checked in",
      "DUPLICATE_CHECKIN",
      409,
    );
    const o = {
      id: id(),
      eventId,
      participantId: p.id,
      source: "staff-door",
      reviewer: s.wallet,
      timestamp,
      nonce,
      note: text(input.note ?? "", 500),
    };
    r.observations.push(o);
    r.nonces.add(nonce);
    r.revision++;
    return o;
  }
  function personal(eventId, s, input) {
    authenticated(s);
    const r = record(eventId, s);
    r.personal.set(lower(s.wallet), {
      attended: input.attended === true,
      source: "self-reported",
    });
    return r.personal.get(lower(s.wallet));
  }

  async function actionSpec(eventId, s, action, params, st) {
    authenticated(s);
    const r = record(eventId, s),
      c = contract(eventId);
    if (ownerActions.has(action)) await owner(eventId, s);
    let target = c,
      method,
      args = [],
      value = 0n,
      summaryText;
    const wallet = () => ethers.getAddress(params.wallet ?? s.wallet);
    const to = () => ethers.getAddress(params.to ?? s.wallet);
    const eligible = async (admission) => {
      let candidates = [...r.participants.values()].filter(
        (p) => p.admission === admission && p.deposit && hasVerifiedParticipantWallet(r, p),
      );
      if (params.wallets) {
        requireThat(
          Array.isArray(params.wallets) &&
            params.wallets.length > 0 &&
            params.wallets.every((wallet) => ethers.isAddress(wallet)) &&
            new Set(params.wallets.map(lower)).size === params.wallets.length,
          "Select unique valid wallets",
        );
        candidates = params.wallets.map((wallet) => {
          const person = candidates.find(
            (candidate) => lower(candidate.wallet) === lower(wallet),
          );
          requireThat(
            person,
            "Wallet lacks approved verified evidence",
            "UNVERIFIED_STAKER",
            403,
          );
          return person;
        });
      }
      const result = [];
      for (const p of candidates) {
        const status = Number(await c.status(p.wallet));
        if (
          (admission === "approved" && status === 1) ||
          (admission === "declined" && status === 3)
        )
          continue;
        await verifyReceipt(eventId, p, p.deposit.txHash, true);
        result.push(p.wallet);
      }
      if (params.wallets) {
        requireThat(
          Array.isArray(params.wallets) && params.wallets.length > 0,
          "Select wallets",
        );
        return params.wallets.map((w) => {
          requireThat(
            result.some((x) => lower(x) === lower(w)),
            "Wallet lacks approved verified evidence",
            "UNVERIFIED_STAKER",
            403,
          );
          return ethers.getAddress(w);
        });
      }
      return result;
    };
    switch (action) {
      case "deposit": {
        requireThat(
          !r.transactions.some(
            (t) =>
              t.action === "deposit" &&
              lower(t.wallet) === lower(s.wallet) &&
              ["pending", "mined"].includes(t.status),
          ),
          "An earlier deposit is submitted; verify its receipt before preparing another",
          "PENDING_DEPOSIT",
          409,
        );
        requireThat(
          st.now >= r.deployment.depositOpensAt &&
            st.now < r.deployment.depositDeadline,
          "Committed deposits close at the event start",
          "OUTSIDE_DEPOSIT_WINDOW",
          409,
        );
        const depositAction = production ? await productionDepositAction(r, s, st) : null;
        if (production) requireThat(depositAction.eligible, depositAction.reason, depositAction.reasonCode, 409);
        const p = production ? ensureWalletParticipant(r, s) : participantFor(r, s);
        if (!production && p.deposit) {
          let returned = false;
          try {
            await verifyReceipt(eventId, p, p.deposit.txHash, true);
          } catch (e) {
            if (e.code === "RETURNED_DEPOSIT") returned = true;
            else throw e;
          }
          requireThat(
            returned,
            "An existing deposit is already linked",
            "DUPLICATE_DEPOSIT",
            409,
          );
        }
        requireThat(
          r.definition.registrationStatus === "open",
          "Registration closed",
        );
        method = "deposit";
        value = production ? BigInt(depositAction.amountWei) : BigInt(r.deployment.depositWei);
        summaryText = production
          ? `Pay the remaining ${ethers.formatEther(value)} ETH toward this event's deposit. Organizer approval, contract admission and Luma registration remain separate.`
          : `Deposit exactly this event’s ${nativeSymbol} commitment. Payment is separate from organizer approval and contract registration.`;
        break;
      }
      case "register":
        method = "registerStakers";
        args = [await eligible("approved")];
        requireThat(
          args[0].length > 0,
          "No approved, verified unregistered participants",
        );
        summaryText =
          "Register only wallets with confirmed unreturned deposit evidence and approved admission.";
        break;
      case "reject":
        method = "rejectAndRefund";
        args = [await eligible("declined")];
        requireThat(args[0].length > 0, "No declined deposits to refund");
        summaryText =
          "Return one deposit to each declined wallet. Failed transfers become claimable owed balances.";
        break;
      case "postAttendance": {
        for (const p of r.participants.values())
          if (
            p.deposit &&
            p.admission !== "approved" &&
            Number(await c.status(p.wallet)) !== 3
          )
            requireThat(
              false,
              "Resolve pending/free/declined paid registrations and refunds before posting",
              "UNRESOLVED_ADMISSION",
              409,
            );
        const list = [
          ...new Set(
            r.observations
              .map((o) => r.participants.get(o.participantId)?.wallet)
              .filter(Boolean),
          ),
        ].filter((w) => st.activeStakers.some((x) => lower(x) === lower(w)));
        requireThat(
          list.length > 0,
          "No registered trusted attendees; use cancellation or no-list recovery for zero attendance",
          "NO_ATTENDEES",
        );
        method = "postAttendance";
        args = [list, BigInt(st.poolWei) / BigInt(list.length)];
        summaryText =
          eventV8Profile(r.deployment.contractVersion)?.testOnly
            ? "TEST ONLY: post reviewed trusted attendance and open a 15-minute challenge window on Chiado. Follow the actual on-chain deadline. Personal history and merch have no effect."
            : "Post reviewed trusted attendance and open the one-day challenge window. Personal history and merch have no effect.";
        break;
      }
      case "challenge":
        method = "challenge";
        value = BigInt(st.challengeDepositWei);
        summaryText =
          eventV8Profile(r.deployment.contractVersion)?.testOnly
            ? "TEST ONLY: challenge your omission on Chiado. A separate 15-minute matching period starts; follow its on-chain deadline. Unmatched expired challenges count as attended."
            : "Challenge your omission. A separate one-day matching period starts; unmatched expired challenges count as attended.";
        break;
      case "match": {
        const ch = await c.challenges(wallet());
        method = "matchChallenge";
        args = [wallet()];
        value = ch.deposit;
        summaryText = production
          ? "Match this challenge to open a real Kleros V1 case on Ethereum mainnet. One provisional share may remain reserved during payouts."
          : external
          ? "Match this challenge to open a controlled Chiado mock-arbitration case. There is no independent Kleros jury. One provisional share may remain reserved during payouts."
          : "Match this challenge to open a local mock V1 Court case. One provisional share may be reserved during payouts.";
        break;
      }
      case "addAttendees": {
        requireThat(
          Array.isArray(params.wallets) && params.wallets.length,
          "Select attendees",
        );
        const eligibleWallets = r.observations.map(
          (o) => r.participants.get(o.participantId)?.wallet,
        );
        requireThat(
          params.wallets.every((w) =>
            eligibleWallets.some((x) => lower(x) === lower(w)),
          ),
          "Corrections need a trusted reviewed observation",
          "UNVERIFIED_ATTENDANCE",
        );
        method = "addAttendees";
        args = [params.wallets];
        summaryText =
          "Correct trusted omitted attendees before matching. Already matched cases require evidence and a final ruling.";
        break;
      }
      case "resolve":
        method = "resolveChallenge";
        args = [wallet()];
        summaryText =
          "Apply an expired unmatched challenge or final resolver ruling. Ruling 0 excludes and splits remaining challenge deposits.";
        break;
      case "release":
        method = "releasePayouts";
        summaryText =
          "Pay established attendees now, reserving a complete provisional share for each open matched case.";
        break;
      case "cancel":
        method = "cancel";
        summaryText =
          "Cancel while Open and within the posting deadline; return each registered deposit. Unregistered payers need separate returns.";
        break;
      case "emergencyWithdraw":
        method = "emergencyWithdraw";
        args = [to()];
        summaryText =
          "Withdraw your registered deposit only after the posting deadline if no attendance list was posted.";
        break;
      case "claim":
        method = "claim";
        args = [to()];
        summaryText =
          "Collect your owed failed payment at this destination. This is separate from ordinary batch payouts.";
        break;
      case "withdrawPending": {
        requireThat(
          isV8Version(r.deployment.contractVersion),
          "Independent unused-credit recovery requires v8",
          "WRONG_VERSION",
          409,
        );
        const amount = BigInt(params.amountWei ?? "0");
        const credit = await c.pendingDeposits(s.wallet);
        requireThat(
          amount > 0n && amount <= credit,
          "Choose an amount within your unused deposit credit",
          "INSUFFICIENT_CREDIT",
          409,
        );
        method = "withdrawPending";
        args = [to(), amount];
        summaryText =
          "Recover your own unused deposit credit to this address. This does not withdraw an admitted commitment or anyone else's funds.";
        break;
      }
      case "refund":
        method = "refund";
        args = [to(), BigInt(params.amountWei)];
        summaryText = `Return spare ${nativeSymbol} only. ${isV8Version(r.deployment.contractVersion) ? "Unused payer credit, the registered pool" : "The registered pool"}, held shares, owed payments and challenge escrow remain reserved.`;
        break;
      case "sweep":
        method = "sweep";
        args = [to()];
        summaryText =
          "Collect available rounding dust after settlement, preserving all reserves.";
        break;
      case "transferOwnership":
        method = "transferOwnership";
        args = [to()];
        if (production) await assertWallet(args[0]);
        summaryText =
          "Begin two-step ownership transfer; new wallet must accept.";
        break;
      case "acceptOwnership":
        method = "acceptOwnership";
        summaryText = "Accept pending ownership from this wallet.";
        break;
      case "passPeriod":
      case "deliverRuling": {
        const ch = await c.challenges(wallet());
        requireThat(
          Number(ch.state) === 2,
          "A matched unresolved case is required",
        );
        target = chain.liquid;
        method = action === "passPeriod" ? "passPeriod" : "executeRuling";
        args = [ch.arbitratorDisputeID];
        summaryText =
          action === "passPeriod"
            ? "Advance the arbitrator after its appeal deadline. Only the arbitrator case ID is used; no vote or resolver ruling is overridden."
            : "Deliver the final arbitrator vote to the V1 resolver. Its one-sided appeal funding override still determines the final ruling; event settlement remains a separate action.";
        break;
      }
      case "evidence":
      case "fundAppeal":
      case "appealRewards": {
        const ch = await c.challenges(wallet());
        requireThat(
          Number(ch.state) >= 2 &&
            lower(ch.matcher) !== lower(ethers.ZeroAddress),
          "A matched Court case is required",
          "NOT_MATCHED_CASE",
          409,
        );
        target = chain.resolver;
        const localId = ch.localDisputeID;
        if (action === "evidence") {
          requireThat(
            (production ? /^\/ipfs\/[A-Za-z0-9/._-]+$/ : /^\/(ipfs|local-evidence)\/[A-Za-z0-9/._-]+$/).test(
              params.uri ?? "",
            ),
            "Evidence must use an IPFS or local evidence URI",
          );
          method = "submitEvidence";
          args = [localId, params.uri];
          summaryText =
            "Submit evidence under the resolver LOCAL ID from your own wallet.";
        }
        if (action === "fundAppeal") {
          requireThat(
            [0, 1, 2].includes(Number(params.side)),
            "Invalid appeal side",
          );
          method = "fundAppeal";
          args = [localId, Number(params.side)];
          value = BigInt(params.amountWei);
          requireThat(value > 0n, "Appeal contribution must be positive");
          summaryText =
            "Contribute directly from your wallet to the resolver. Ruling 0 funded alone can win and counts as excluded.";
        }
        if (action === "appealRewards") {
          if (production) {
            const resolverCase = await chain.resolver.disputes(localId);
            requireThat(resolverCase.isRuled === true,
              "Appeal rewards are available only after the resolver delivers its final ruling",
              "REWARDS_NOT_READY", 409);
          }
          requireThat(
            Array.isArray(params.sides) &&
              params.sides.every((x) => [0, 1, 2].includes(x)),
            "Invalid sides",
          );
          method = "withdrawFeesAndRewardsForAllRounds";
          args = [localId, s.wallet, params.sides];
          summaryText =
            "Collect your resolver appeal refunds/rewards, separately from the event pool.";
        }
        break;
      }
      default:
        requireThat(false, "Unsupported action", "UNKNOWN_ACTION");
    }
    return { target, method, args, value, summary: summaryText };
  }
  async function createDraft(eventId, s, { action, params = {} }) {
    authenticated(s);
    await assertWallet(s.wallet);
    let st = await state(eventId);
    const r = record(eventId, s);
    if (production && action === "deposit" && ![...r.participants.values()].some(p => lower(p.wallet) === lower(s.wallet))) {
      ensureWalletParticipant(r, s);
      // Observer membership changes the pending-credit projection even at zero.
      // Bind the review to the same wallet-aware snapshot validation will read.
      st = await state(eventId);
    }
    const spec = await actionSpec(eventId, s, action, params, st);
    const tx = {
      to: spec.target.target,
      from: s.wallet,
      data: spec.target.interface.encodeFunctionData(spec.method, spec.args),
      value: spec.value,
      chainId: r.deployment.chainId,
    };
    try {
      await chain.provider.call(tx);
    } catch (e) {
      throw Object.assign(
        new Error(
          `Contract refused ${spec.method}: ${e.revert?.name ?? e.shortMessage ?? "invalid current state"}`,
        ),
        { code: "SIMULATION_FAILED", status: 409 },
      );
    }
    await finishDraftChecks(r, st, s.wallet);
    const draft = {
      id: id(),
      eventId,
      action,
      params,
      wallet: s.wallet,
      sessionId: s.id,
      chainId: r.deployment.chainId,
      contract: r.deployment.contract,
      abiVersion: r.deployment.abiVersion,
      contractVersion: r.deployment.contractVersion,
      valueWei: String(spec.value),
      method: spec.method,
      args: JSON.parse(json(spec.args)),
      summary: spec.summary,
      createdAt: Date.now(),
      reviewBlock: st.blockNumber,
      expiresAt: Date.now() + 300_000,
      snapshot: st.fingerprint,
      revision: r.revision,
      registryHash: hash(r.deployment),
      transaction: JSON.parse(json(tx)),
      used: false,
    };
    drafts.set(draft.id, draft);
    return { ...draft };
  }
  async function validateDraft(eventId, s, draftId) {
    authenticated(s);
    await assertWallet(s.wallet);
    const r = record(eventId, s),
      d = drafts.get(draftId);
    requireThat(
      d &&
        d.eventId === eventId &&
        lower(d.wallet) === lower(s.wallet) &&
        d.sessionId === s.id,
      "Draft belongs to a different event or wallet",
      "DRAFT_SCOPE",
      409,
    );
    requireThat(
      !d.used && !d.submittedHash && d.expiresAt > Date.now(),
      "Draft expired or already consumed",
      "STALE_DRAFT",
      409,
    );
    const st = await state(eventId);
    requireThat(
      d.registryHash === hash(r.deployment) &&
        d.snapshot === st.fingerprint &&
        d.revision === r.revision,
      "Authoritative event state changed; review a fresh draft",
      "STALE_DRAFT",
      409,
    );
    const spec = await actionSpec(eventId, s, d.action, d.params, st);
    requireThat(
      spec.target.interface.encodeFunctionData(spec.method, spec.args) ===
        d.transaction.data && String(spec.value) === d.valueWei,
      "Transaction terms changed",
      "STALE_DRAFT",
      409,
    );
    await chain.provider.call(d.transaction);
    await finishDraftChecks(r, st, s.wallet);
    return { d, spec, r };
  }
  async function executeDraft(eventId, s, draftId) {
    requireThat(!production, "Production transactions require a browser wallet",
      "WALLET_SIGNATURE_REQUIRED", 403);
    requireThat(
      !locks.has(eventId),
      "Another event action is in flight",
      "BUSY",
      409,
    );
    locks.add(eventId);
    try {
      const { d, spec, r } = await validateDraft(eventId, s, draftId);
      requireThat(
        s.mode === "demo" && s.signer,
        "A browser wallet must sign this transaction",
        "WALLET_SIGNATURE_REQUIRED",
        409,
      );
      d.used = true;
      const estimate = await chain.provider.estimateGas(d.transaction);
      const gasLimit = (estimate * 130n) / 100n;
      requireThat(
        gasLimit <= 16_777_216n,
        "Transaction exceeds tested gas limit",
      );
      const sent = await s.signer.sendTransaction({
        ...d.transaction,
        gasLimit,
      });
      d.submittedHash = sent.hash;
      const tx = {
        hash: sent.hash,
        status: "pending",
        action: d.action,
        wallet: s.wallet,
        eventId,
        draftId: d.id,
      };
      r.transactions.push(tx);
      const receipt = await sent.wait().catch((error) => {
        if (error.receipt?.status === 0) {
          tx.status = "failed";
          tx.blockNumber = error.receipt.blockNumber;
        }
        throw error;
      });
      requireThat(receipt.status === 1, "Transaction failed", "TX_FAILED", 409);
      tx.status = "confirmed";
      d.confirmedHash = sent.hash;
      tx.blockNumber = receipt.blockNumber;
      r.revision++;
      if (["transferOwnership", "acceptOwnership"].includes(d.action))
        await state(eventId);
      if (d.action === "deposit")
        await linkDeposit(eventId, s, { txHash: sent.hash });
      return { ...tx };
    } finally {
      locks.delete(eventId);
    }
  }
  async function confirmDraft(eventId, s, draftId, txHash) {
    // External wallets can only confirm the exact reviewed transaction, with a canonical successful receipt.
    authenticated(s);
    const r = record(eventId, s),
      d = drafts.get(draftId);
    requireThat(
      d &&
        d.eventId === eventId &&
        d.sessionId === s.id &&
        lower(d.wallet) === lower(s.wallet) &&
        !d.used,
      "Invalid draft",
      "DRAFT_SCOPE",
      409,
    );
    requireThat(
      d.expiresAt > Date.now() &&
        d.registryHash === hash(r.deployment) &&
        d.revision === r.revision,
      "Review expired or event metadata changed",
      "STALE_DRAFT",
      409,
    );
    requireThat(
      !d.submittedHash || lower(d.submittedHash) === lower(txHash),
      "Confirmation differs from the submitted hash",
      "TX_MISMATCH",
      409,
    );
    requireThat(
      !r.transactions.some(
        (t) => lower(t.hash) === lower(txHash) && t.status === "confirmed",
      ),
      "This transaction was already recorded",
      "DUPLICATE_TRANSACTION",
      409,
    );
    const tx = await chain.provider.getTransaction(txHash),
      receipt = await chain.provider.getTransactionReceipt(txHash);
    requireThat(
      tx &&
        receipt?.status === 1 &&
        lower(tx.from) === lower(s.wallet) &&
        lower(tx.to) === lower(d.transaction.to) &&
        tx.data === d.transaction.data &&
        String(tx.value) === d.valueWei &&
        Number(tx.chainId) === d.chainId,
      "Transaction does not match reviewed draft",
      "TX_MISMATCH",
      409,
    );
    requireThat(
      receipt.blockNumber > d.reviewBlock,
      "Transaction predates this review",
      "TX_PREDATES_REVIEW",
      409,
    );
    requireThat(
      (await chain.provider.getBlock(receipt.blockNumber)).hash ===
        receipt.blockHash,
      "Noncanonical transaction",
    );
    d.used = true;
    d.confirmedHash = txHash;
    r.revision++;
    const result = {
      hash: txHash,
      status: "confirmed",
      action: d.action,
      wallet: s.wallet,
      eventId,
      blockNumber: receipt.blockNumber,
    };
    const pending = r.transactions.find((t) => lower(t.hash) === lower(txHash));
    if (pending) Object.assign(pending, result);
    else r.transactions.push(result);
    if (d.action === "deposit") await linkDeposit(eventId, s, { txHash });
    return result;
  }
  async function recordSubmitted(eventId, s, draftId, txHash) {
    authenticated(s);
    const r = record(eventId, s),
      d = drafts.get(draftId);
    requireThat(
      d &&
        d.eventId === eventId &&
        d.sessionId === s.id &&
        lower(d.wallet) === lower(s.wallet) &&
        !d.used,
      "Submission belongs to another review or wallet",
      "DRAFT_SCOPE",
      409,
    );
    requireThat(
      /^0x[0-9a-fA-F]{64}$/.test(txHash ?? ""),
      "Invalid transaction hash",
    );
    requireThat(
      d.expiresAt > Date.now(),
      "Review expired; preserve the submitted hash and verify its receipt",
      "STALE_DRAFT",
      409,
    );
    requireThat(
      !d.submittedHash || lower(d.submittedHash) === lower(txHash),
      "This review already has another submitted transaction",
      "SUBMITTED_DRAFT",
      409,
    );
    const tx = await chain.provider.getTransaction(txHash);
    if (tx)
      requireThat(
        lower(tx.from) === lower(d.wallet) &&
          lower(tx.to) === lower(d.transaction.to) &&
          tx.data === d.transaction.data &&
          String(tx.value) === d.valueWei &&
          Number(tx.chainId) === d.chainId,
        "Submitted transaction differs from the reviewed transaction",
        "TX_MISMATCH",
        409,
      );
    const existing = r.transactions.find(
      (t) => lower(t.hash) === lower(txHash),
    );
    if (existing) {
      requireThat(
        existing.draftId === draftId,
        "Transaction hash is already recorded",
        "DUPLICATE_TRANSACTION",
        409,
      );
      return { ...existing };
    }
    d.submittedHash = txHash;
    const entry = {
      hash: txHash,
      status: "pending",
      action: d.action,
      wallet: d.wallet,
      eventId,
      draftId,
      chainId: d.chainId,
      contract: d.contract,
      submittedAt: Date.now(),
    };
    r.transactions.push(entry);
    return { ...entry };
  }
  async function submissionStatus(eventId, s, txHash) {
    authenticated(s);
    const r = record(eventId, s),
      entry = r.transactions.find((t) => lower(t.hash) === lower(txHash));
    requireThat(
      entry && lower(entry.wallet) === lower(s.wallet),
      "No submission for this wallet/event",
      "NOT_FOUND",
      404,
    );
    const receipt = await chain.provider.getTransactionReceipt(txHash);
    if (!receipt) return { ...entry, receiptStatus: "pending" };
    requireThat(
      (await chain.provider.getBlock(receipt.blockNumber))?.hash ===
        receipt.blockHash,
      "Receipt is not canonical",
      "TX_REORG",
      409,
    );
    if (entry.status !== "confirmed")
      entry.status = receipt.status === 1 ? "mined" : "failed";
    return {
      ...entry,
      receiptStatus: receipt.status === 1 ? "confirmed" : "failed",
      blockNumber: receipt.blockNumber,
    };
  }
  async function reconcileSubmission(eventId, s, draftId, txHash) {
    // This records an already-signed on-chain fact. It never revives signing authority.
    authenticated(s);
    const r = record(eventId, s),
      d = drafts.get(draftId);
    requireThat(
      d && d.eventId === eventId && lower(d.wallet) === lower(s.wallet),
      "No review for this wallet/event",
      "DRAFT_SCOPE",
      409,
    );
    requireThat(
      /^0x[0-9a-fA-F]{64}$/.test(txHash ?? ""),
      "Invalid transaction hash",
    );
    requireThat(
      d.registryHash === hash(r.deployment),
      "Deployment identity changed",
      "DEPLOYMENT_MISMATCH",
      409,
    );
    requireThat(
      !d.submittedHash || lower(d.submittedHash) === lower(txHash),
      "Another hash belongs to this review",
      "TX_MISMATCH",
      409,
    );
    requireThat(
      !d.used || lower(d.confirmedHash ?? d.submittedHash) === lower(txHash),
      "Consumed review cannot record another transaction",
      "DRAFT_SCOPE",
      409,
    );
    const [tx, receipt] = await Promise.all([
      chain.provider.getTransaction(txHash),
      chain.provider.getTransactionReceipt(txHash),
    ]);
    requireThat(
      tx &&
        lower(tx.from) === lower(s.wallet) &&
        lower(tx.to) === lower(d.transaction.to) &&
        tx.data === d.transaction.data &&
        String(tx.value) === d.valueWei &&
        Number(tx.chainId) === d.chainId,
      "Transaction differs from the original reviewed terms",
      "TX_MISMATCH",
      409,
    );
    let status = "pending";
    if (receipt) {
      requireThat(
        receipt.blockNumber > d.reviewBlock,
        "Transaction predates this review",
        "TX_PREDATES_REVIEW",
        409,
      );
      requireThat(
        (await chain.provider.getBlock(receipt.blockNumber))?.hash ===
          receipt.blockHash,
        "Receipt is not canonical",
        "TX_REORG",
        409,
      );
      status = receipt.status === 1 ? "confirmed" : "failed";
    }
    d.submittedHash = txHash;
    const entry = r.transactions.find(
      (t) => lower(t.hash) === lower(txHash),
    ) ?? {
      hash: txHash,
      action: d.action,
      eventId,
      wallet: d.wallet,
      draftId,
      chainId: d.chainId,
      contract: d.contract,
    };
    Object.assign(entry, {
      hash: txHash,
      eventId,
      wallet: d.wallet,
      draftId,
      chainId: d.chainId,
      contract: d.contract,
      status,
      recovered: true,
      ...(receipt ? { blockNumber: receipt.blockNumber } : {}),
    });
    if (!r.transactions.includes(entry)) r.transactions.push(entry);
    if (receipt) {
      d.used = true;
      d.confirmedHash = txHash;
    }
    if (status === "confirmed" && d.action === "deposit") {
      const p = [...r.participants.values()].find(
        (p) => lower(p.wallet) === lower(s.wallet),
      );
      let mayLink =
        p && (!p.deposit || lower(p.deposit.txHash) === lower(txHash));
      if (p && !mayLink)
        try {
          await verifyReceipt(eventId, p, p.deposit.txHash, true);
        } catch (error) {
          if (error.code === "RETURNED_DEPOSIT") mayLink = true;
        }
      if (p && mayLink)
        try {
          const evidence = await verifyReceipt(eventId, p, txHash, true);
          if (!p.deposit || lower(p.deposit.txHash) !== lower(txHash)) {
            p.deposit = evidence;
            r.revision++;
          }
        } catch (error) {
          entry.verificationError = error.code ?? "VERIFICATION_UNAVAILABLE";
        }
    }
    return { ...entry };
  }
  async function advance(seconds) {
    requireThat(
      !external,
      "Public testnet time cannot be advanced",
      "TESTNET_TIME",
      403,
    );
    requireThat(
      Number.isInteger(seconds) && seconds > 0 && seconds <= 30 * DAY,
      "Advance 1 second to 30 days",
    );
    await chain.provider.send("evm_increaseTime", [seconds]);
    await chain.provider.send("evm_mine", []);
    return { now: (await chain.provider.getBlock("latest")).timestamp };
  }
  async function mockRuling(eventId, s, wallet, ruling) {
    requireThat(
      !external,
      "Testnet rulings require a reviewed wallet transaction",
      "WALLET_REQUIRED",
      403,
    );
    await owner(eventId, s);
    requireThat([0, 1, 2].includes(ruling), "Invalid ruling");
    const c = await contract(eventId).challenges(wallet);
    requireThat(Number(c.state) === 2, "Only matched cases can be ruled");
    await (
      await chain.liquid.connect(s.signer).getFunction("giveFinalRuling")(
        c.arbitratorDisputeID,
        ruling,
        { gasLimit: 600_000 },
      )
    ).wait();
    return {
      ruling,
      localDisputeID: String(c.localDisputeID),
      arbitratorDisputeID: String(c.arbitratorDisputeID),
    };
  }
  async function mockAppeal(eventId, s, wallet, ruling, duration = 3600) {
    requireThat(
      !external,
      "Testnet arbitration requires a reviewed wallet transaction",
      "WALLET_REQUIRED",
      403,
    );
    await owner(eventId, s);
    requireThat(
      [0, 1, 2].includes(ruling) &&
        Number.isInteger(duration) &&
        duration > 0 &&
        duration <= 7 * DAY,
      "Invalid mock appeal",
    );
    const c = await contract(eventId).challenges(wallet);
    requireThat(Number(c.state) === 2, "Matched case required");
    await (
      await chain.liquid.connect(s.signer).getFunction("startAppealPeriod")(
        c.arbitratorDisputeID,
        ruling,
        duration,
        { gasLimit: 600_000 },
      )
    ).wait();
    return { ruling, duration };
  }
  async function publish(eventId, s, wallet) {
    authenticated(s);
    const r = record(eventId, s),
      c = await contract(eventId).challenges(wallet);
    requireThat(
      Number(c.state) >= 2 && lower(c.matcher) !== lower(ethers.ZeroAddress),
      "Matched Court case required",
      "NOT_MATCHED_CASE",
      409,
    );
    const [content, uri] = await contract(eventId).caseMetaEvidence(wallet);
    const publication = {
      uri,
      status: "local-only",
      sha256: hash(content),
      content,
      at: Date.now(),
    };
    r.publications.set(lower(wallet), publication);
    return publication;
  }
  function caseContext(eventId, s, wallet, assertSession = () => {}) {
    requireThat(production, "Production case publication requires Ethereum V9", "FORBIDDEN", 403);
    requireThat(typeof wallet === "string" && ethers.isAddress(wallet), "Choose a challenged wallet");
    return { eventId, session: s, wallet: ethers.getAddress(wallet), assertSession };
  }
  function caseRecord(context) {
    context.assertSession();
    authenticated(context.session);
    const r = events.get(context.eventId);
    requireThat(r, "Unknown event", "NOT_FOUND", 404);
    requireThat(r.deployment.contractVersion === "kleros-event-v9-uups" &&
      r.deployment.chainId === 1, "Unsupported case environment", "WRONG_CHAIN", 409);
    return r;
  }
  function caseAccess(context) {
    caseRecord(context);
    return record(context.eventId, context.session);
  }
  async function readProductionCase(context, savedArtifact) {
    const r = caseRecord(context);
    const st = await state(context.eventId, { includeBlockHash: true });
    caseAccess(context);
    const at = { blockTag: st.blockNumber }, c = contract(context.eventId);
    const [challenge, metadata, organizer] = await Promise.all([
      c.challenges(context.wallet, at), c.caseMetaEvidence(context.wallet, at),
      c.caseOrganizer(context.wallet, at),
    ]);
    caseAccess(context);
    requireThat(Number(challenge.state) > 0 && organizer !== ethers.ZeroAddress,
      "An opened attendance challenge is required", "NOT_MATCHED_CASE", 409);
    const matched = Number(challenge.state) >= 2 && lower(challenge.matcher) !== lower(ethers.ZeroAddress);
    if (savedArtifact) requireThat(savedArtifact.scope?.eventId === context.eventId &&
      lower(savedArtifact.scope?.contract) === lower(r.deployment.contract) &&
      lower(savedArtifact.scope?.wallet) === lower(context.wallet) &&
      Number.isSafeInteger(savedArtifact.scope?.blockNumber) && savedArtifact.scope.blockNumber > 0,
      "The saved case artifact belongs to another scope", "CASE_ARTIFACT_CHANGED", 409);
    // A historical case snapshot can remain canonical while financial ownership
    // changes. Close private disclosure against fresh current authority too.
    const authorityHead = await chain.provider.send("eth_getBlockByNumber", ["latest", false]);
    context.assertSession();
    authenticated(context.session);
    requireThat(authorityHead?.number && ethers.isHexString(authorityHead.hash, 32),
      "Current event authority is unavailable", "CASE_ARTIFACT_CHANGED", 409);
    const authorityAt = { blockTag: Number(BigInt(authorityHead.number)) };
    const [network, block, originalBlock, currentOwner, pendingOwner] = await Promise.all([
      chain.provider.send("eth_chainId", []),
      chain.provider.send("eth_getBlockByNumber", [ethers.toQuantity(st.blockNumber), false]),
      savedArtifact ? chain.provider.send("eth_getBlockByNumber",
        [ethers.toQuantity(savedArtifact.scope.blockNumber), false]) : Promise.resolve(null),
      c.owner(authorityAt), c.pendingOwner(authorityAt),
    ]);
    const authorityCanonical = await chain.provider.send("eth_getBlockByNumber", [authorityHead.number, false]);
    context.assertSession();
    authenticated(context.session);
    requireThat(BigInt(network) === 1n && lower(block?.hash) === lower(st.blockHash) &&
      (!savedArtifact || lower(originalBlock?.hash) === lower(savedArtifact.scope.blockHash)) &&
      lower(authorityCanonical?.hash) === lower(authorityHead.hash),
      "The canonical case snapshot changed; keep the original export for review", "CASE_ARTIFACT_CHANGED", 409);
    r.financialAccess = [currentOwner, pendingOwner];
    caseAccess(context);
    return {
      scope: { environment: "production", instanceId: serverInstanceId, chainId: 1,
        contractVersion: "kleros-event-v9-uups", eventId: context.eventId,
        contract: r.deployment.contract, wallet: context.wallet, blockNumber: st.blockNumber,
        blockHash: st.blockHash, matched,
        localDisputeID: matched ? String(challenge.localDisputeID) : null,
        arbitratorDisputeID: matched ? String(challenge.arbitratorDisputeID) : null },
      content: metadata[0], expectedURI: metadata[1],
    };
  }
  const casePublications = production ? createProductionCasePublicationService({
    readCase: readProductionCase,
    // Stored bytes stay internal until readCase refreshes authority. Cached or
    // empty access metadata must not reject a newly transferred private owner.
    readRecord: (context) => caseRecord(context).publications.get(lower(context.wallet)) ?? null,
    writeRecord: (context, publication) => {
      caseAccess(context).publications.set(lower(context.wallet), publication);
    },
    persist: () => store.save(events, drafts),
  }) : null;
  const w = {
    chain,
    events,
    provider: chain.provider,
    assertWallet,
    session,
    record,
    contract,
    state,
    owner,
    bootstrap,
    detail,
    depositLedger,
    createEvent,
    registerParticipant,
    admit,
    verifyReceipt,
    linkDeposit,
    checkin,
    personal,
    createDraft,
    validateDraft,
    executeDraft,
    confirmDraft,
    recordSubmitted,
    submissionStatus,
    reconcileSubmission,
    createFactoryDraft: (s, input) => onboarding().createDraft(s, input),
    validateFactoryDraft: (s, draftId) => onboarding().validateDraft(s, draftId),
    recordFactorySubmitted: (s, draftId, txHash) => onboarding().recordSubmitted(s, draftId, txHash),
    reconcileFactorySubmission: (s, draftId, txHash) => onboarding().reconcile(s, draftId, txHash),
    getFactoryDraft: (s, draftId) => onboarding().getDraft(s, draftId),
    advance,
    mockRuling,
    mockAppeal,
    publish,
    caseArtifact: (eventId, s, wallet, assertSession) => casePublications.exportCase(caseContext(eventId, s, wallet, assertSession)),
    publishCaseArtifact: (eventId, s, wallet, approval, assertSession) => casePublications.publishCase(caseContext(eventId, s, wallet, assertSession), approval),
    verifyCaseArtifact: (eventId, s, wallet, assertSession) => casePublications.verifyCase(caseContext(eventId, s, wallet, assertSession)),
    close: async () => {
      store?.save(events, drafts);
      await chain.close();
    },
    persist: () => store?.save(events, drafts),
  };
  w.importCsv = (eventId, s, input) => importCsv(w, eventId, s, input);
  const previews = createImportPreviewService(w);
  w.previewImport = previews.preview;
  w.commitImport = previews.commit;
  const batches = createBatchService(w, { authorizeStaff: staff });
  w.previewBatch = batches.preview;
  w.commitBatch = batches.commit;
  w.batchStatus = batches.status;
  if (store)
    for (const name of [
      "registerParticipant",
      "admit",
      "linkDeposit",
      "checkin",
      "personal",
      "createDraft",
      "executeDraft",
      "confirmDraft",
      "recordSubmitted",
      "reconcileSubmission",
      "publish",
      "importCsv",
      "commitImport",
    ]) {
      const original = w[name];
      w[name] = async (...args) => {
        try {
          return await original(...args);
        } finally {
          store.save(events, drafts);
        }
      };
    }
  return w;
}
