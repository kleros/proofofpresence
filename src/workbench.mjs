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
import { createPayerAdoptionService, manualAttendanceWallets, bindManualAttendanceReview } from "./first-event-manage.mjs";
import { FIRST_EVENT_MANAGE_SCOPE, firstEventManageMatches, firstEventDisplayScopes, assertFirstEventDepositTarget } from "./first-event-manage-scope.mjs";
import { projectPayments } from "./payments.mjs";
import { v8DepositCredits } from "./v8-deposits.mjs";
import { testnetChain, testnetStateStore } from "./testnet-runtime.mjs";
import { mainnetChain, mainnetStateStore } from "./mainnet-runtime.mjs";
import { v10MainnetChain, v10MainnetStateStore } from "./v10-mainnet-runtime.mjs";
import { assertProductionEOAWallet } from "./production-wallets.mjs";
import { IMPLEMENTATION_SLOT, verifyV9FactoryDeployment } from "./upgrade-verification.mjs";
import { createFactoryOnboardingService } from "./factory-onboarding.mjs";
import { createV10FactoryOnboardingService } from "./v10-factory-onboarding.mjs";
import { createV10ReceiptContext } from "./v10-receipt-context.mjs";
import { V10_WALLET_SUPPORT } from "./v10-production-wallets.mjs";
import { verifyV10FactoryDeployment } from "./v10-upgrade-verification.mjs";
import { createFactoryCreationRecovery } from "./creation-recovery.mjs";
import { eventV9LumaTemplate, V9_LUMA_ATTENDANCE_STANDARD } from "./contracts-v9-luma.mjs";
import { eventV10LumaTemplate, V10_LUMA_ATTENDANCE_STANDARD } from "./contracts-v10-luma.mjs";
import { createProductionCasePublicationService } from "./production-case-publication.mjs";
import { createFactoryRefresh } from "./shared-factory-refresh.mjs";
import { publicCatalogSnapshot } from "./public-catalog.mjs";
import { v10ReadBatch, v10CodeHashBatch } from "./v10-read-batch.mjs";
import { directDepositSimulation } from "./direct-deposit-simulation.mjs";
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
// Production recovery is source-pinned to current/legacy children. The existing
// trusted function dependency remains available only for isolated local tests.
export const firstEventCreditRecoveryMatches = (record, trustedCurrentScope = FIRST_EVENT_MANAGE_SCOPE) =>
  firstEventDisplayScopes().some(scope => firstEventManageMatches(record, scope)) ||
  (typeof trustedCurrentScope === "function" && firstEventManageMatches(record, trustedCurrentScope));

export async function createWorkbench({
  rpcPort = 0,
  contractVersion = "truth-pays-v7",
  testnet = null,
  production = null,
  serverInstanceId = id(),
  productionOrigin = null,
} = {}, { productionRuntime = null, productionStore = null, assertWallet: trustedAssertWallet = null,
  firstEventManageScope = FIRST_EVENT_MANAGE_SCOPE } = {}) {
  requireThat(
    contractVersion === "truth-pays-v7" || isV8Version(contractVersion),
    "Unsupported contract version",
  );
  requireThat(!(testnet && production), "Choose one external environment");
  const external = !!(testnet || production);
  const externalConfig = production || testnet;
  const productionProfile = production ? production.manifest?.factoryDeployment?.contractVersion ??
    production.manifest?.events?.[0]?.deployment?.contractVersion : null;
  requireThat(!production || ["kleros-event-v9-uups", "kleros-event-v10-uups"].includes(productionProfile),
    "Choose one exact reviewed production profile", "DEPLOYMENT_MISMATCH", 409);
  requireThat(trustedAssertWallet === null || typeof trustedAssertWallet === "function",
    "Wallet policy must be a trusted server dependency", "INVALID_INPUT", 400);
  const productionV10 = productionProfile === "kleros-event-v10-uups";
  // Trusted test dependency only; ordinary runtime/config and HTTP always use the fixed scope.
  const manageScope = typeof firstEventManageScope === "function" ? firstEventManageScope : Object.freeze({ ...firstEventManageScope });
  const verifiedParticipantWallet = (record, person) => hasVerifiedParticipantWallet(record, person, manageScope);
  const productionFactoryVerifier = productionV10 ? verifyV10FactoryDeployment : verifyV9FactoryDeployment;
  const attendanceTemplate = productionV10 ? eventV10LumaTemplate : eventV9LumaTemplate;
  const attendanceStandard = productionV10 ? V10_LUMA_ATTENDANCE_STANDARD : V9_LUMA_ATTENDANCE_STANDARD;
  const activeContractVersion = production ? productionProfile
    : external ? externalConfig.manifest.events[0].deployment.contractVersion : contractVersion;
  requireThat(external || !eventV8Profile(contractVersion)?.upgradeable,
    "Upgradeable production events require an explicit reviewed production manifest");
  const nativeSymbol = external
    ? (externalConfig.manifest?.chain?.nativeCurrency?.symbol ?? "native token")
    : "ETH";
  const chain = production
    ? await (productionRuntime ?? (productionV10 ? v10MainnetChain : mainnetChain))(production.manifest, production.rpcUrl)
    : external
    ? await testnetChain(externalConfig.manifest, testnet.rpcUrl)
    : await localChain(rpcPort);
  const store = production
    ? (productionStore ?? (productionV10 ? v10MainnetStateStore : mainnetStateStore))(production.stateFile, production.manifest)
    : external
    ? testnetStateStore(testnet.stateFile, externalConfig.manifest)
    : null;
  const factoryDeployment = production ? production.manifest.factoryDeployment ?? Reflect.get(chain, "factoryDeployment") : null;
  // These actors are capabilities held only by the public transaction adapter.
  // They are never wallet-login sessions and cannot authorize private/owner work.
  const publicTransactionActors = new WeakMap();
  const publicActor = s => s && typeof s === "object" ? publicTransactionActors.get(s) : null;
  // Overlapping public bootstrap requests share one complete factory read. There
  // is no TTL or saved-result shortcut; financial draft checks remain separate.
  const refreshFactory = createFactoryRefresh(chain, factoryDeployment, productionFactoryVerifier);
  async function assertWallet(wallet, observation = null) {
    if (!production) return null;
    requireThat(BigInt(await chain.provider.send("eth_chainId", [])) === 1n,
      "Production RPC chain changed", "WRONG_CHAIN", 409);
    let result;
    if (trustedAssertWallet) result = await trustedAssertWallet(wallet, observation);
    else if (productionV10) result = await v10Receipts.assertWallet(wallet, observation);
    else {
      result = await assertProductionEOAWallet(chain.provider, wallet);
      if (productionV10) result = { ...result, codeHash: ethers.keccak256("0x"), financialEligible: true, accountType: "eoa" };
    }
    if (productionV10) requireThat(result && Object.keys(result).length === 6 && lower(result.wallet) === lower(wallet) &&
      Number.isSafeInteger(result.blockNumber) && result.blockNumber >= 0 && ethers.isHexString(result.blockHash, 32) &&
      ethers.isHexString(result.codeHash, 32) && result.financialEligible === true &&
      ["eoa", "metamask-protected-self-v1.3"].includes(result.accountType),
      "The V10 wallet has no verified financial account policy", "UNSUPPORTED_WALLET", 422);
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
  function externalMetadata(s = null, includeFactory = true) {
    if (!production) return external ? {
      arbitration: { mode: "controlled", notice: "Controlled test arbitrator; no independent jury" },
    } : {};
    return {
      environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
      arbitration: { ...production.manifest.arbitration, verified: true,
        label: "Kleros V1 · Ethereum", notice: "Real Kleros arbitration on Ethereum mainnet" },
      walletSupport: productionV10 ? { ...V10_WALLET_SUPPORT,
        notice: "Use a standard Ethereum account or the source-verified MetaMask v1.3 protected-self account. Other contract and delegated accounts are unsupported." } : { type: "eoa-only", eoa: true, erc1271: false, eip7702: false,
        notice: "Use a standard wallet account. Smart contract and delegated accounts are not supported." },
      contractProfile: { ...eventV8Profile(activeContractVersion), verified: true },
      ...(productionV10 ? { abiVersion: activeContractVersion } : {}),
      governance: { ...production.manifest.governance },
      ...(factoryDeployment && includeFactory ? {
        factory: { chainId: 1, address: factoryDeployment.factory, contractVersion: activeContractVersion,
          abiVersion: activeContractVersion, verified: Reflect.get(chain, "verifiedFactory") === true,
          deploymentTrust: Reflect.get(chain, "factoryTrust")?.deploymentTrust ?? { status: "unavailable" },
          upgrade: Reflect.get(chain, "factoryTrust")?.upgrade ?? null },
        organizerSetup: { policyURI: factoryDeployment.policy?.uri ?? null,
          policySha256: factoryDeployment.policy?.sha256 ?? null,
          policyStatus: factoryDeployment.policyStatus === "published" && factoryDeployment.policy?.uri ? "verified" : "unpublished",
          attendanceStandard: { ...attendanceStandard },
          challengeWindowSeconds: 86400, matchWindowSeconds: 86400, minimumClaimDays: 7 },
      } : {}),
      ...(productionV10 ? { features: { casePublication: false, originalCreationRecovery: false } } : {}),
      // Only a wallet's own saved reviews reveal these minimal identities.
      // They authorize receipt lookup, never a fresh financial action.
      recoveryEvents: s?.wallet && !publicActor(s) ? [...new Set([...drafts.values()]
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
    if (publicActor(s)) requireThat(r.definition.visibility === "public" && r.definition.editorialStatus === "published",
      "Public transaction flows cannot access private events", "PUBLIC_FLOW_SCOPE", 403);
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
  const ownCreditRecovery = (r, s, action, params) => productionV10 &&
    s?.mode === "wallet" && !publicActor(s) && ethers.isAddress(s.wallet) &&
    firstEventCreditRecoveryMatches(r, manageScope) && r.definition.visibility === "public" &&
    r.definition.editorialStatus === "published" && action === "withdrawPending" &&
    params && Object.keys(params).sort().join(",") === "amountWei,to" && lower(params.to) === lower(s.wallet);
  function recoveryFinancial(r, s, owner, pendingOwner, credit) {
    requireThat(ethers.isAddress(owner) && ethers.isAddress(pendingOwner) && typeof credit === "bigint" &&
      credit >= 0n && credit < 2n ** 256n, "Current unused credit is unavailable", "SELECTED_EVENT_REORG", 409);
    return { kind: "own-unused-credit-quote-v1", registryHash: hash(r.deployment), wallet: lower(s.wallet),
      owner, pendingOwner, pendingCreditWei: String(credit) };
  }
  async function creditRecoveryQuote(eventId, s) {
    const r = events.get(eventId), registryHash = hash(r.deployment), c = contract(eventId);
    requireThat(BigInt(await chain.provider.send("eth_chainId", [])) === 1n,
      "Production RPC chain changed", "WRONG_CHAIN", 409);
    const block = await directDepositBlock("latest");
    requireThat(block.number >= r.deployment.deploymentBlock,
      "The unused-credit quote block is unavailable", "SELECTED_EVENT_REORG", 409);
    const [owner, pendingOwner, credit] = await v10ReadBatch(chain.provider, [
      { contract: c, method: "owner" }, { contract: c, method: "pendingOwner" },
      { contract: c, method: "pendingDeposits", args: [s.wallet] },
    ], block.number);
    const financial = recoveryFinancial(r, s, owner, pendingOwner, credit);
    const [canonical, network] = await Promise.all([
      directDepositBlock(ethers.toQuantity(block.number)), chain.provider.send("eth_chainId", []),
    ]);
    requireThat(hash(r.deployment) === registryHash && canonical.hash === block.hash && BigInt(network) === 1n,
      "The unused-credit quote changed", "SELECTED_EVENT_REORG", 409);
    // A sealed amount/recipient quote grants no signing authority. Validation
    // must independently prove the full source history and current contract.
    return { ...financial, fingerprint: hash(financial), blockNumber: block.number, blockHash: block.hash,
      depositWei: r.deployment.depositWei, upgrade: null, deploymentTrust: null, now: block.timestamp };
  }
  async function creditRecoveryState(eventId, s) {
    const r = events.get(eventId), d = r.deployment, registryHash = hash(d);
    // Keep the full source/history proof. An unused-credit withdrawal does not
    // depend on anybody else's registration, payouts, attendance or disputes.
    const c = await verifyDeployment(chain, d);
    const trust = Reflect.get(chain, "deploymentTrust")?.get(registryHash), block = trust?.anchor;
    requireThat(trust?.deploymentTrust?.status === "verified" && block &&
      Number.isSafeInteger(block.number) && block.number > 0 && ethers.isHexString(block.hash, 32),
      "Current recovery authority is unavailable", "SELECTED_EVENT_REORG", 409);
    const [owner, pendingOwner, credit] = await v10ReadBatch(chain.provider, [
      { contract: c, method: "owner" }, { contract: c, method: "pendingOwner" },
      { contract: c, method: "pendingDeposits", args: [s.wallet] },
    ], block.number);
    const financial = recoveryFinancial(r, s, owner, pendingOwner, credit);
    // Preserve chainState's current implementation and canonical-anchor close.
    const head = await chain.provider.send("eth_getBlockByNumber", ["latest", false]);
    requireThat(head?.number && BigInt(head.number) >= BigInt(block.number),
      "Production snapshot head moved backwards", "DEPLOYMENT_REORG", 409);
    const [eventSlot, factorySlot, implementationCode, canonical] = await Promise.all([
      chain.provider.send("eth_getStorageAt", [d.contract, IMPLEMENTATION_SLOT, head.number]),
      chain.provider.send("eth_getStorageAt", [d.factory, IMPLEMENTATION_SLOT, head.number]),
      chain.provider.send("eth_getCode", [d.implementation, head.number]),
      chain.provider.send("eth_getBlockByNumber", [ethers.toQuantity(block.number), false]),
    ]);
    requireThat(hash(r.deployment) === registryHash && ethers.isHexString(eventSlot, 32) && ethers.isHexString(factorySlot, 32) &&
      BigInt(eventSlot) === BigInt(d.implementation) && BigInt(factorySlot) === BigInt(d.factoryImplementation) &&
      ethers.keccak256(implementationCode) === d.implementationCodeHash && canonical?.hash === block.hash,
      "Production implementation or recovery snapshot changed", "UPGRADE_TRUST_MISMATCH", 409);
    r.financialAccess = [owner, pendingOwner];
    return { ...financial, fingerprint: hash(financial), blockNumber: block.number,
      blockHash: block.hash, depositWei: d.depositWei, upgrade: trust.upgrade,
      deploymentTrust: trust.deploymentTrust, now: block.timestamp };
  }
  async function firstEventAuthority(eventId) {
    const r = events.get(eventId);
    requireThat(productionV10 && firstEventManageMatches(r, manageScope),
      "Current authority requires the exact first event", "FIRST_EVENT_SCOPE", 404);
    const binding = hash(r.deployment);
    for (let attempt = 0; attempt < 2; attempt++) {
      // Each attempt runs the complete original provenance verifier. No role
      // result, successful proof or financial snapshot is reused across calls.
      const c = await verifyDeployment(chain, r.deployment);
      const trust = Reflect.get(chain, "deploymentTrust")?.get(binding), anchor = trust?.anchor;
      requireThat(trust?.deploymentTrust?.status === "verified" && anchor &&
        Number.isSafeInteger(anchor.number) && anchor.number > 0 && ethers.isHexString(anchor.hash, 32),
        "Current event authority is unavailable", "SELECTED_EVENT_REORG", 409);
      const [currentOwner, pendingOwner] = await v10ReadBatch(chain.provider,
        [{ contract: c, method: "owner" }, { contract: c, method: "pendingOwner" }], anchor.number);
      const [canonical, latest, network] = await Promise.all([
        chain.provider.getBlock(anchor.number), chain.provider.getBlock("latest"), chain.provider.send("eth_chainId", []),
      ]);
      requireThat(BigInt(network) === 1n && canonical?.hash === anchor.hash &&
        ethers.isAddress(currentOwner) && ethers.isAddress(pendingOwner) && hash(r.deployment) === binding &&
        firstEventManageMatches(r, manageScope),
        "Current event authority changed", "SELECTED_EVENT_REORG", 409);
      if (latest?.number > anchor.number && attempt === 0) continue;
      requireThat(latest?.number === anchor.number && latest.hash === anchor.hash,
        "A new event block arrived; refresh the current action", "SELECTED_EVENT_REORG", 409);
      r.financialAccess = [currentOwner, pendingOwner];
      return { owner: currentOwner, pendingOwner };
    }
    throw Object.assign(new Error("Current event authority changed"), { code: "SELECTED_EVENT_REORG", status: 409 });
  }
  async function owner(eventId, s) {
    requireThat(!publicActor(s), "Authenticate organizer access separately", "PUBLIC_FLOW_SCOPE", 403);
    authenticated(s);
    if (productionV10 && firstEventManageMatches(events.get(eventId), manageScope)) {
      const authority = await firstEventAuthority(eventId), r = record(eventId, s);
      requireThat(lower(authority.owner) === lower(s.wallet),
        "Only this event's current contract owner can do that", "NOT_OWNER", 403);
      return r;
    }
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
    requireThat(!publicActor(s), "Authenticate staff access separately", "PUBLIC_FLOW_SCOPE", 403);
    authenticated(s);
    if (productionV10 && firstEventManageMatches(events.get(eventId), manageScope)) {
      const authority = await firstEventAuthority(eventId), r = record(eventId, s);
      requireThat(r.definition.staff.some(wallet => lower(wallet) === lower(s.wallet)) || lower(authority.owner) === lower(s.wallet),
        "Staff access is scoped to this event", "NOT_STAFF", 403);
      return r;
    }
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
    // Requesting accounts and preparing a transaction do not prove ownership.
    // No shared participant/identity record is created until a signed receipt.
    if (publicActor(s)) return { wallet: s.wallet, eventId: r.definition.id };
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
  const v10Receipts = productionV10 ? createV10ReceiptContext({
    chain, origin: productionOrigin, instanceId: serverInstanceId, drafts,
  }) : null;
  if (v10Receipts) Reflect.set(chain, "assertTransactionIntent", v10Receipts.assertTransactionIntent);
  const factoryService = factoryDeployment ? (productionV10 ? createV10FactoryOnboardingService : createFactoryOnboardingService)(/** @type {any} */ ({
    chain, factoryDeployment, events, drafts, store, instanceId: serverInstanceId, assertWallet,
    ...(productionV10 ? { origin: productionOrigin, receiptContext: v10Receipts } : {}),
    verifyFactory: (context, deployment) => productionFactoryVerifier(context, deployment),
  })) : null;
  // Factual recovery has no onboarding or financial authority.
  const creationRecovery = production && !productionV10 && factoryDeployment
    ? createFactoryCreationRecovery({ chain, factoryDeployment, drafts, instanceId: serverInstanceId })
    : null;
  function onboarding() {
    requireThat(factoryService, "A verified factory is required", "FACTORY_UNAVAILABLE", 503);
    return factoryService;
  }
  async function summary(r, s, knownState = null) {
    const st = knownState ?? (await chainState(chain, r));
    let immutableLuma = {};
    if (production && r.dynamic === true) {
      const template = attendanceTemplate({ eventName: r.deployment.eventName, depositAmount: r.deployment.depositWei,
        policyURI: r.deployment.policyURI, policySha256: hash(r.policy), lumaUrl: r.definition.lumaUrl,
        startsAt: r.definition.startsAt, endsAt: r.definition.endsAt, timezone: r.definition.timezone });
      requireThat(hash([template.pieces, template.slots]) === r.deployment.templateHash,
        "The Luma destination or event terms differ from the verified contract", "IMMUTABLE_EVENT_TERMS", 409);
      immutableLuma = { attendanceStandard: { ...attendanceStandard },
        immutableTerms: { lumaUrl: r.definition.lumaUrl, startsAt: r.definition.startsAt, endsAt: r.definition.endsAt,
          timezone: r.definition.timezone, policySha256: hash(r.policy) } };
    }
    const role = publicActor(s) ? "participant" :
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
    // An existing V10 event verifies its own factory provenance below. Future
    // child creation/default checks belong only to the separate setup page.
    const selectedV10Only = productionV10 && options.selectedOnly === true && Object.hasOwn(options, "selectedEventId");
    if (!selectedV10Only) await refreshFactory();
    if (productionV10 && options.factoryOnly === true) return {
      mode: "hosted-production", identities: [], events: [],
      session: s ? { wallet: s.wallet, label: s.label, mode: s.mode } : null,
      chain: production.manifest.chain, contractVersion: activeContractVersion,
      ...externalMetadata(s), now: (await chain.provider.getBlock("latest")).timestamp,
    };
    if (Object.hasOwn(options, "selectedEventId"))
      return selectedBootstrap(s, options.selectedEventId, production && options.selectedOnly === true);
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
  async function selectedBootstrap(s, selectedEventId, selectedOnly = false) {
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
    if (!selectedOnly) await Promise.all(
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
    const visible = selectedOnly ? [] : [...events.values()].filter((r) => {
      if (failed.has(r.definition.id)) return false;
      try {
        record(r.definition.id, s);
        return true;
      } catch {
        return false;
      }
    });
    // An event deep link needs only its own financial state. The public catalog
    // and organizer inventory retain their separate, existing request paths.
    const summaries = selectedOnly
      ? selected.then(({ detail }) => detail ? [detail.event] : [])
      : Promise.all(
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
      ...externalMetadata(s, !(productionV10 && selectedOnly)),
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

  // A queued read cannot retain a past access decision until a later poll.
  // Reuse the existing final disclosure checks immediately before delivery.
  async function finalizeReadResult(operation, result, s, eventId) {
    requireThat(productionV10, "Event background reads require V10", "NOT_FOUND", 404);
    if (operation === "bootstrap") {
      const selection = result.selectedEvent ?? { eventId: "", wallet: s?.wallet ?? null, detail: null };
      let originalState = null;
      if (selection.detail) {
        const state = selection.detail.state, payments = selection.detail.payments;
        const deployment = events.get(selection.eventId)?.deployment;
        // Selected detail omits state.blockHash, but its payments projection was
        // made at that exact state block. Bind that existing execution anchor
        // to the same event before the normal canonical disclosure check.
        requireThat(deployment && state && payments && Number.isSafeInteger(state.blockNumber) && state.blockNumber > 0 &&
          payments.blockNumber === state.blockNumber && ethers.isHexString(payments.blockHash, 32) &&
          payments.eventId === selection.eventId && payments.chainId === deployment.chainId &&
          payments.contractVersion === deployment.contractVersion && lower(payments.contract) === lower(deployment.contract) &&
          (state.blockHash === undefined || state.blockHash === payments.blockHash),
          "Selected event execution anchor changed", "SELECTED_EVENT_REORG", 409);
        originalState = { ...state, blockHash: payments.blockHash };
      }
      const disclosed = await selectedDisclosure(s, result.events ?? [], selection, originalState);
      return { ...result, events: disclosed.directory,
        ...(result.selectedEvent ? { selectedEvent: disclosed.selectedEvent } : {}),
        session: s ? { wallet: s.wallet, label: s.label, mode: s.mode } : null,
        ...externalMetadata(s, Object.hasOwn(result, "factory")) };
    }
    if (operation === "confirm") {
      // A known-hash fact belongs to its original wallet even after private
      // event access changes. Bind the stored review directly, without record().
      authenticated(s);
      const r = events.get(eventId), d = drafts.get(result?.draftId);
      const entry = r?.transactions.find(item => lower(item.hash) === lower(result?.hash));
      requireThat(r && d && entry && d.eventId === eventId && result.eventId === eventId &&
        result.chainId === 1 && d.chainId === 1 && d.contractVersion === "kleros-event-v10-uups" &&
        lower(d.wallet) === lower(s.wallet) && lower(result.wallet) === lower(d.wallet) &&
        lower(result.contract) === lower(d.contract) && lower(d.contract) === lower(r.deployment.contract) &&
        result.action === d.action && d.id === result.draftId && entry.draftId === d.id && entry.eventId === eventId &&
        entry.chainId === d.chainId && lower(entry.contract) === lower(d.contract) && entry.action === d.action && lower(entry.wallet) === lower(d.wallet) &&
        d.registryHash === hash(r.deployment) && /^0x[0-9a-fA-F]{64}$/.test(result.hash ?? "") &&
        ["pending", "confirmed", "failed"].includes(result.status),
        "Known transaction belongs to another wallet, review or event", "DRAFT_SCOPE", 409);
      requireOriginalV10Hash(d, result.hash);
      if (v10Receipts) v10Receipts.sealDraft(d);
      const [receipt, network] = await Promise.all([
        chain.provider.getTransactionReceipt(result.hash), chain.provider.send("eth_chainId", []),
      ]);
      requireThat(BigInt(network) === 1n, "Production RPC chain changed", "WRONG_CHAIN", 409);
      const terminal = result.status !== "pending";
      requireThat(!terminal || (receipt && Number.isSafeInteger(result.blockNumber) && result.blockNumber > 0 &&
        ethers.isHexString(result.blockHash, 32) && receipt.blockHash === result.blockHash &&
        receipt.blockNumber === result.blockNumber && receipt.status === (result.status === "confirmed" ? 1 : 0)),
        "Known transaction receipt changed", "TX_REORG", 409);
      if (receipt) {
        requireThat(lower(receipt.hash ?? receipt.transactionHash) === lower(result.hash) &&
          lower(receipt.from) === lower(d.wallet) && [0, 1].includes(receipt.status) &&
          Number.isSafeInteger(receipt.blockNumber) && receipt.blockNumber > 0 && ethers.isHexString(receipt.blockHash, 32) &&
          (result.blockHash === undefined || result.blockHash === receipt.blockHash),
          "Known transaction receipt differs from its original scope", "TX_REORG", 409);
        const [canonical, closingNetwork] = await Promise.all([
          chain.provider.getBlock(receipt.blockNumber), chain.provider.send("eth_chainId", []),
        ]);
        requireThat(BigInt(closingNetwork) === 1n && canonical?.number === receipt.blockNumber && canonical.hash === receipt.blockHash,
          "Known transaction receipt is no longer canonical", "TX_REORG", 409);
        requireOriginalV10Hash(d, result.hash);
        // Do not promote a previously pending result without its normal reconciliation.
        return terminal ? { ...result, blockHash: receipt.blockHash } : result;
      }
      const pending = { ...result }; delete pending.blockNumber; delete pending.blockHash;
      return pending;
    }
    if (operation !== "confirm") {
      // Refresh financial owner/private membership for unsigned reviews. This
      // grants no signing authority and does not replace normal draft validation.
      // This is a directory authority check, not a selected-detail response.
      // The empty selection keeps the ordinary current access checks without
      // treating the deliberately absent detail as a denied selected event.
      const disclosed = await selectedDisclosure(s, [{ id: eventId }],
        { eventId: "", wallet: s?.wallet ?? null, detail: null }, null);
      requireThat(disclosed.directory.some(item => item.id === eventId),
        "Private or unpublished event", "FORBIDDEN", 403);
      if (operation === "participant-draft") {
        if (result?.action === "withdrawPending") {
          const r = events.get(eventId), d = drafts.get(result.id), amount = d?.args?.[1];
          requireThat(productionV10 && firstEventCreditRecoveryMatches(r, manageScope) && s?.mode === "wallet" && !publicActor(s) &&
            d && hash(result) === hash(d) && d.eventId === eventId && d.sessionId === s.id && lower(d.wallet) === lower(s.wallet) &&
            d.instanceId === serverInstanceId && d.origin === productionOrigin && d.chainId === 1 &&
            d.contractVersion === "kleros-event-v10-uups" && d.abiVersion === "kleros-event-v10-uups" &&
            lower(d.contract) === lower(r.deployment.contract) && d.action === "withdrawPending" && d.method === "withdrawPending" &&
            d.valueWei === "0" && d.transaction?.value === "0" && d.transaction.chainId === 1 &&
            lower(d.transaction.to) === lower(r.deployment.contract) && lower(d.transaction.from) === lower(s.wallet) &&
            Array.isArray(d.args) && d.args.length === 2 && lower(d.args[0]) === lower(s.wallet) &&
            typeof amount === "string" && /^[1-9][0-9]{0,77}$/.test(amount) && BigInt(amount) < 2n ** 256n &&
            d.params && Object.keys(d.params).sort().join(",") === "amountWei,to" &&
            lower(d.params.to) === lower(s.wallet) && d.params.amountWei === amount &&
            d.transaction.data === contract(eventId).interface.encodeFunctionData("withdrawPending", [s.wallet, amount]) &&
            !d.used && !d.submittedHash && !d.confirmedHash && d.expiresAt > Date.now(),
          "The original credit withdrawal review changed", "DRAFT_SCOPE", 409);
          v10Receipts.sealDraft(d);
        } else requireThat(firstEventManageMatches(events.get(eventId), manageScope),
          "Participant reviews require this first event", "FIRST_EVENT_SCOPE", 404);
      }
      if (["adopt-payer", "manage-draft", "deposit-inbox"].includes(operation)) {
        requireThat(firstEventManageMatches(events.get(eventId), manageScope) &&
          disclosed.directory.some(item => item.id === eventId && item.role === "organizer"),
          "Only this event's current financial owner may receive the organizer review", "NOT_OWNER", 403);
      }
      if (operation === "deposit" && result?.depositReview) {
        const d = drafts.get(result.id), review = result.depositReview;
        const selected = review.selectedEvent, detail = selected?.detail;
        const { depositReview: ignored, ...returnedDraft } = result;
        requireThat(d && hash(returnedDraft) === hash(d) && d.eventId === eventId &&
          d.action === "deposit" && d.sessionId === s?.id && lower(d.wallet) === lower(s?.wallet) &&
          d.instanceId === serverInstanceId && d.origin === productionOrigin &&
          !d.used && !d.submittedHash && d.expiresAt > Date.now() &&
          review.kind === "deposit-review-v1" && review.instanceId === serverInstanceId &&
          review.origin === productionOrigin && review.mode === "hosted-production" &&
          lower(review.session?.wallet) === lower(d.wallet) && selected?.eventId === eventId &&
          lower(selected.wallet) === lower(d.wallet) && detail?.kind === "deposit-review-v1" &&
          detail.state?.fingerprint === d.snapshot && detail.state.blockNumber === d.reviewBlock &&
          ethers.isHexString(detail.state.blockHash, 32) &&
          detail.ownWallet?.depositAction?.eligible === true &&
          detail.ownWallet.depositAction.amountWei === d.valueWei &&
          (publicActor(s) ? detail.event?.role === "participant" :
            disclosed.directory.find(item => item.id === eventId)?.role === detail.event?.role),
          "Deposit review scope changed", "STALE_DRAFT", 409);
        v10Receipts.sealDraft(d);
        const [canonical, network] = await Promise.all([
          chain.provider.getBlock(detail.state.blockNumber), chain.provider.send("eth_chainId", []),
        ]);
        requireThat(BigInt(network) === 1n && canonical?.hash === detail.state.blockHash,
          "Deposit review snapshot is no longer canonical", "SELECTED_EVENT_REORG", 409);
      }
    }
    return result;
  }

  async function detail(eventId, s, knownState = null) {
    const st = knownState ?? (await state(eventId)),
      r = record(eventId, s),
      event = await summary(r, s, st);
    // A pinned response can replay this event's credit history once for all
    // participants and its ledger. Keep latest reads fresh, and never retain
    // histories beyond this detail call or share them with mutation checks.
    const creditHistories = new Map();
    const readCreditHistory = (blockTag) => {
      if (blockTag === "latest")
        return v8DepositCredits(contract(eventId), r.deployment, blockTag);
      if (!creditHistories.has(blockTag))
        creditHistories.set(
          blockTag,
          v8DepositCredits(contract(eventId), r.deployment, blockTag),
        );
      return creditHistories.get(blockTag);
    };
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
                { readCreditHistory },
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
      ? await depositLedger(eventId, st.blockNumber, { readCreditHistory })
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
      ...(production ? { deploymentTrust: st.deploymentTrust, upgrade: st.upgrade,
        ...(productionV10 ? { features: { casePublication: false, originalCreationRecovery: false } } : {}) } : {}),
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
   * @param {{signal?: AbortSignal, readCreditHistory?: (blockTag: number) => Promise<Map<any, any>>}} [options]
   */
  async function depositLedger(eventId, blockTag = "latest", { signal, readCreditHistory } = {}) {
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
      const credits = await (readCreditHistory
        ? readCreditHistory(end)
        : v8DepositCredits(c, r.deployment, end, { signal }));
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
   * @param {{readCreditHistory?: (blockTag: number) => Promise<Map<any, any>>}} [options]
   */
  async function verifyReceipt(
    eventId,
    p,
    txHash,
    allowLinked = false,
    blockTag = "latest",
    { readCreditHistory } = {},
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
      production && ["kleros-event-v9-uups", "kleros-event-v10-uups"].includes(d.contractVersion)
        ? log.parsed.args.amount > 0n
        : log.parsed.args.amount >= BigInt(d.depositWei),
      "Deposit amount is too small",
      "SHORT_DEPOSIT",
      409,
    );
    if (isV8Version(d.contractVersion)) {
      const person = (await (typeof blockTag === "number" && readCreditHistory
        ? readCreditHistory(blockTag)
        : v8DepositCredits(c, d, blockTag))).get(
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
          ((production && ["kleros-event-v9-uups", "kleros-event-v10-uups"].includes(d.contractVersion)
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
    requireThat(verifiedParticipantWallet(r, p), "Participant wallet must be verified");
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
        (p) => p.admission === admission && p.deposit && verifiedParticipantWallet(r, p),
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
        if (productionV10) assertFirstEventDepositTarget(r);
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
        const manual = Object.hasOwn(params, "attendedWallets") || Object.hasOwn(params, "attendanceReview");
        if (manual) requireThat(productionV10 && firstEventManageMatches(r, manageScope),
          "Manual organizer attendance is limited to the first reviewed Truth Pays event.", "FIRST_EVENT_SCOPE", 404);
        const list = manual ? manualAttendanceWallets(r, st, params) : [
          ...new Set(
            r.observations
              .map((o) => r.participants.get(o.participantId)?.wallet)
              .filter(Boolean),
          ),
        ].filter((w) => st.activeStakers.some((x) => lower(x) === lower(w)));
        if (manual) {
          for (const wallet of list) {
            const person = [...r.participants.values()].find(person => lower(person.wallet) === lower(wallet));
            requireThat(person && person.eventId === eventId && verifiedParticipantWallet(r, person) &&
              person.admission === "approved" && person.deposit,
              "Every selected attendee needs an approved canonical payer record and existing contract registration.",
              "UNVERIFIED_ATTENDEE", 409);
            await verifyReceipt(eventId, person, person.deposit.txHash, true);
          }
        }
        requireThat(
          list.length > 0,
          "No registered trusted attendees; use cancellation or no-list recovery for zero attendance",
          "NO_ATTENDEES",
        );
        method = "postAttendance";
        args = [list, BigInt(st.poolWei) / BigInt(list.length)];
        summaryText = manual
          ? `Record this owner's present review that exactly ${list.length} registered wallets attended during ${r.definition.startsAt} through ${r.definition.endsAt}. No historical staff check-in is created. Publishing opens the one-day omission challenge window.`
          :
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
        const credit = st.kind === "own-unused-credit-quote-v1" && st.wallet === lower(s.wallet)
          ? BigInt(st.pendingCreditWei) : await c.pendingDeposits(s.wallet);
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
  async function createDraft(eventId, s, { action, params = {}, depositReview = false }) {
    if (publicActor(s)) requireThat(publicActor(s).kind === "deposit" && action === "deposit" &&
      publicActor(s).eventId === eventId, "Public flows can only prepare their exact deposit", "PUBLIC_FLOW_SCOPE", 403);
    requireThat(!depositReview || (productionV10 && action === "deposit"),
      "A deposit review requires the production V10 deposit flow", "DRAFT_SCOPE", 409);
    const manualAttendance = action === "postAttendance" && (Object.hasOwn(params, "attendedWallets") || Object.hasOwn(params, "attendanceReview"));
    if (manualAttendance)
      params = structuredClone(params);
    authenticated(s);
    const recovery = ownCreditRecovery(events.get(eventId), s, action, params);
    // Recovery preparation quotes only the amount/recipient. The unchanged
    // validation pipeline proves current source, wallet and simulation before send.
    if (!recovery) await assertWallet(s.wallet);
    let st = recovery ? await creditRecoveryQuote(eventId, s) : await state(eventId, { includeBlockHash: depositReview });
    const r = record(eventId, s);
    if (manualAttendance) {
      requireThat(productionV10 && firstEventManageMatches(r, manageScope),
        "Manual organizer attendance is limited to the first reviewed Truth Pays event.", "FIRST_EVENT_SCOPE", 404);
      params = bindManualAttendanceReview(r, s, params);
    }
    if (production && action === "deposit" && ![...r.participants.values()].some(p => lower(p.wallet) === lower(s.wallet))) {
      ensureWalletParticipant(r, s);
      // Observer membership changes the pending-credit projection even at zero.
      // Bind the review to the same wallet-aware snapshot validation will read.
      st = await state(eventId, { includeBlockHash: depositReview });
    }
    const spec = await actionSpec(eventId, s, action, params, st);
    const tx = {
      to: spec.target.target,
      from: s.wallet,
      data: spec.target.interface.encodeFunctionData(spec.method, spec.args),
      value: spec.value,
      chainId: r.deployment.chainId,
    };
    if (!recovery) {
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
    }
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
      summary: recovery ? `Review ${ethers.formatEther(spec.args[1])} ETH of unused deposit to return to this wallet. The amount and contract are checked when you confirm.` : spec.summary,
      createdAt: Date.now(),
      reviewBlock: st.blockNumber,
      expiresAt: Date.now() + 300_000,
      snapshot: st.fingerprint,
      revision: r.revision,
      registryHash: hash(r.deployment),
      transaction: JSON.parse(json(tx)),
      used: false,
      ...(productionV10 ? { scopeKind: "event-call", mode: "hosted-production", instanceId: serverInstanceId, origin: productionOrigin } : {}),
    };
    drafts.set(draft.id, draft);
    if (v10Receipts) {
      try { v10Receipts.sealDraft(draft); await store?.save(events, drafts); }
      catch (error) { drafts.delete(draft.id); throw error; }
    }
    if (!depositReview) return { ...draft };
    // This is the exact state and action that produced the sealed review, not a
    // display cache or a second full event/payment projection. Validation still
    // repeats the original fresh financial and provenance checks before send.
    let event = await summary(r, s, st);
    if (publicActor(s)) {
      // Public transaction review discloses only the immutable public terms and
      // fields required by the exact client review checks, never staff/contacts.
      const fields = ["id", "title", "lumaUrl", "startsAt", "endsAt", "timezone", "visibility", "editorialStatus",
        "depositWei", "contract", "chainId", "deploymentBlock", "contractVersion", "abiVersion", "contractProfile",
        "claimDeadline", "policyURI", "templateHash", "depositOpensAt", "depositDeadline", "resolver", "arbitrator",
        "financialPhase", "role", "attendanceStandard", "immutableTerms"];
      event = Object.fromEntries(fields.filter(key => Object.hasOwn(event, key)).map(key => [key, event[key]]));
    }
    const depositAction = await productionDepositAction(r, s, st);
    requireThat(depositAction.eligible && depositAction.amountWei === draft.valueWei,
      "Deposit eligibility changed; prepare a fresh review", "STALE_DRAFT", 409);
    const reviewDetail = { kind: "deposit-review-v1", event,
      state: { blockNumber: st.blockNumber, blockHash: st.blockHash,
        fingerprint: st.fingerprint, depositWei: st.depositWei },
      deploymentTrust: st.deploymentTrust, upgrade: st.upgrade,
      ownWallet: { wallet: s.wallet, depositAction }, participants: [], transactions: [] };
    return { ...draft, depositReview: {
      kind: "deposit-review-v1", mode: "hosted-production", instanceId: serverInstanceId,
      origin: productionOrigin, chain: production.manifest.chain, contractVersion: activeContractVersion,
      session: { wallet: s.wallet, mode: s.mode, label: s.label }, events: [event],
      selectedEvent: { eventId, wallet: s.wallet, detail: reviewDetail },
      ...externalMetadata(s, false), now: st.now,
    } };
  }
  async function validateDraft(eventId, s, draftId) {
    authenticated(s);
    const original = drafts.get(draftId), recovery = ownCreditRecovery(events.get(eventId), s, original?.action, original?.params);
    if (!recovery) await assertWallet(s.wallet);
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
    if (v10Receipts) {
      requireThat(d.instanceId === serverInstanceId && d.origin === productionOrigin,
        "The V10 review belongs to another server instance", "STALE_DRAFT", 409);
      v10Receipts.sealDraft(d);
    }
    const st = recovery ? await creditRecoveryState(eventId, s) : await state(eventId);
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
  async function retainV10Submission(r, d, txHash) {
    requireThat(/^0x[0-9a-fA-F]{64}$/.test(txHash ?? ""), "Invalid transaction hash");
    v10Receipts.sealDraft(d);
    requireThat(!d.submittedHash || lower(d.submittedHash) === lower(txHash),
      "Another hash belongs to this review", "TX_MISMATCH", 409);
    requireThat(!d.confirmedHash || lower(d.confirmedHash) === lower(txHash),
      "Another confirmed hash belongs to this review", "TX_MISMATCH", 409);
    requireThat(![...drafts.values()].some(other => other !== d &&
      [other.submittedHash, other.confirmedHash].some(value => value && lower(value) === lower(txHash))),
      "This hash belongs to another review", "DUPLICATE_TRANSACTION", 409);
    let entry = r.transactions.find(t => lower(t.hash) === lower(txHash));
    requireThat(!entry || entry.draftId === d.id, "Transaction hash is already recorded", "DUPLICATE_TRANSACTION", 409);
    d.submittedHash = txHash;
    if (!entry) {
      entry = { hash: txHash, status: "pending", action: d.action, wallet: d.wallet,
        eventId: d.eventId, draftId: d.id, chainId: d.chainId, contract: d.contract, submittedAt: Date.now() };
      r.transactions.push(entry);
    }
    // The original hash and once fence reach durable storage before any RPC.
    await store?.save(events, drafts);
    return entry;
  }
  async function assertReviewedTransaction(d, tx, canonical) {
    requireThat(tx && lower(tx.from) === lower(d.wallet) && Number(tx.chainId) === d.chainId,
      "Transaction differs from the original reviewed wallet or chain", "TX_MISMATCH", 409);
    if (v10Receipts) requireThat(lower(tx.hash) === lower(d.submittedHash ?? d.confirmedHash),
      "Transaction differs from the original recorded hash", "TX_MISMATCH", 409);
    const direct = lower(tx.to) === lower(d.transaction.to) && tx.data === d.transaction.data && String(tx.value) === d.valueWei;
    if (v10Receipts && (Number(tx.type) === 4 || !direct))
      return v10Receipts.inspectDraftTransaction(d, tx, { canonical });
    requireThat(direct, "Transaction differs from the original reviewed terms", "TX_MISMATCH", 409);
  }
  function requireOriginalV10Hash(d, txHash) {
    if (!v10Receipts) return;
    requireThat(d.submittedHash || d.confirmedHash,
      "The original wallet submission must be recorded first; the saved review is preserved",
      "ORIGINAL_HASH_NOT_RECORDED", 409);
    requireThat([d.submittedHash, d.confirmedHash].filter(Boolean).every(value => lower(value) === lower(txHash)),
      "Another hash belongs to this review", "TX_MISMATCH", 409);
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
    requireOriginalV10Hash(d, txHash);
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
    if (v10Receipts) await retainV10Submission(r, d, txHash);
    const tx = await chain.provider.getTransaction(txHash),
      receipt = await chain.provider.getTransactionReceipt(txHash);
    requireThat(
      tx &&
        receipt?.status === 1 &&
        lower(tx.from) === lower(s.wallet),
      "Transaction does not match reviewed draft",
      "TX_MISMATCH",
      409,
    );
    await assertReviewedTransaction(d, tx, true);
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
    const retained = v10Receipts ? await retainV10Submission(r, d, txHash) : null;
    const tx = await chain.provider.getTransaction(txHash);
    if (tx)
      await assertReviewedTransaction(d, tx, Number.isSafeInteger(tx.blockNumber));
    if (retained) return { ...retained };
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
    requireOriginalV10Hash(d, txHash);
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
    const retained = v10Receipts ? await retainV10Submission(r, d, txHash) : null;
    const [tx, receipt] = await Promise.all([
      chain.provider.getTransaction(txHash),
      chain.provider.getTransactionReceipt(txHash),
    ]);
    if (!tx && retained && !receipt) return { ...retained };
    await assertReviewedTransaction(d, tx, !!receipt);
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
      ...(receipt ? { blockNumber: receipt.blockNumber, ...(productionV10 ? { blockHash: receipt.blockHash } : {}) } : {}),
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
  function publicTransactionTarget(kind) {
    requireThat(productionV10 && ["deposit", "create"].includes(kind),
      "Public transactions require the reviewed V10 environment", "PUBLIC_FLOW_SCOPE", 403);
    if (kind === "create") {
      requireThat(factoryDeployment?.chainId === 1 && factoryDeployment.contractVersion === activeContractVersion &&
        ethers.isAddress(factoryDeployment.factory), "The reviewed factory is unavailable", "PUBLIC_FLOW_SCOPE", 403);
      return { contract: factoryDeployment.factory, target: factoryDeployment.factory };
    }
    const r = [...events.values()].find(item => firstEventManageMatches(item, manageScope));
    requireThat(r && r.definition.visibility === "public" && r.definition.editorialStatus === "published",
      "The public first event is unavailable", "PUBLIC_FLOW_SCOPE", 403);
    return { eventId: r.definition.id, contract: r.deployment.contract, target: r.deployment.contract };
  }
  function createPublicTransactionActor(wallet, actorId, kind) {
    const target = publicTransactionTarget(kind);
    requireThat(ethers.isAddress(wallet) && BigInt(wallet) !== 0n && typeof actorId === "string" && actorId.length > 0,
      "Choose a transaction wallet", "PUBLIC_FLOW_SCOPE", 403);
    const actor = Object.freeze({ id: actorId, wallet: ethers.getAddress(wallet), mode: "wallet", label: "Transaction-only wallet" });
    publicTransactionActors.set(actor, Object.freeze({ kind, ...target }));
    return actor;
  }
  // Explicitly approved public direct-deposit policy: fresh present-state pins
  // and financial eligibility, without claiming a historical provenance scan.
  // The original full verifier and all other signing flows remain unchanged.
  async function directDepositBlock(tag) {
    const block = await chain.provider.send("eth_getBlockByNumber", [tag, false]);
    requireThat(block && /^0x[0-9a-f]+$/i.test(block.number ?? "") && /^0x[0-9a-f]+$/i.test(block.timestamp ?? "") &&
      ethers.isHexString(block.hash, 32), "The direct deposit block is unavailable", "SELECTED_EVENT_REORG", 409);
    const number = Number(BigInt(block.number)), timestamp = Number(BigInt(block.timestamp));
    requireThat(Number.isSafeInteger(number) && number > 0 && Number.isSafeInteger(timestamp) && timestamp > 0,
      "The direct deposit block is invalid", "SELECTED_EVENT_REORG", 409);
    return { number, timestamp, hash: block.hash };
  }
  async function directDepositPreflight(actor) {
    const scope = publicActor(actor);
    requireThat(scope?.kind === "deposit", "Direct deposits require the public first-event flow", "PUBLIC_FLOW_SCOPE", 403);
    const target = publicTransactionTarget("deposit"), r = record(scope.eventId, actor), d = r.deployment;
    requireThat(target.eventId === scope.eventId && lower(target.contract) === lower(scope.contract),
      "The direct deposit target changed", "PUBLIC_FLOW_SCOPE", 403);
    const registryHash = hash(d), revision = r.revision, c = contract(scope.eventId);
    const eligibleRecord = () => requireThat(r.definition.visibility === "public" && r.definition.editorialStatus === "published" &&
      r.definition.registrationStatus === "open" && hash(r.deployment) === registryHash && r.revision === revision &&
      !r.transactions.some(t => t.action === "deposit" && lower(t.wallet) === lower(actor.wallet) && ["pending", "mined"].includes(t.status)),
      "A deposit is closed, changed or already submitted", "PENDING_DEPOSIT", 409);
    eligibleRecord();
    requireThat(BigInt(await chain.provider.send("eth_chainId", [])) === 1n, "Production RPC chain changed", "WRONG_CHAIN", 409);
    const block = await directDepositBlock("latest");
    requireThat(block && Number.isSafeInteger(block.number) && block.number >= d.deploymentBlock &&
      ethers.isHexString(block.hash, 32), "A current canonical deposit block is unavailable", "SELECTED_EVENT_REORG", 409);
    const tag = ethers.toQuantity(block.number), factory = new ethers.Contract(d.factory,
      ["function upgradeAuthority() view returns(address)", "function isEvent(address) view returns(bool)"], chain.provider);
    const addresses = [d.contract, d.implementation, d.factory, d.factoryImplementation, d.upgradeAuthority];
    const expectedHashes = [d.codeHash, d.implementationCodeHash, d.factoryCodeHash,
      d.factoryImplementationCodeHash, d.upgradeAuthorityCodeHash];
    requireThat(addresses.every(ethers.isAddress) && expectedHashes.every(value => ethers.isHexString(value, 32)),
      "The direct deposit source pins are unavailable", "UPGRADE_TRUST_MISMATCH", 409);
    const [values, codeHashes, eventSlot, factorySlot] = await Promise.all([
      v10ReadBatch(chain.provider, [
        { contract: c, method: "depositAmount" }, { contract: c, method: "eventStart" },
        { contract: c, method: "phase" }, { contract: c, method: "status", args: [actor.wallet] },
        { contract: c, method: "pendingDeposits", args: [actor.wallet] },
        { contract: c, method: "originatingFactory" }, { contract: c, method: "upgradeAuthority" },
        { contract: factory, method: "isEvent", args: [d.contract] }, { contract: factory, method: "upgradeAuthority" },
      ], block.number),
      v10CodeHashBatch(chain.provider, addresses, block.number),
      chain.provider.send("eth_getStorageAt", [d.contract, IMPLEMENTATION_SLOT, tag]),
      chain.provider.send("eth_getStorageAt", [d.factory, IMPLEMENTATION_SLOT, tag]),
    ]);
    requireThat(codeHashes.every((value, i) => lower(value) === lower(expectedHashes[i])) &&
      ethers.isHexString(eventSlot, 32) && BigInt(eventSlot) === BigInt(d.implementation) &&
      ethers.isHexString(factorySlot, 32) && BigInt(factorySlot) === BigInt(d.factoryImplementation) &&
      lower(values[5]) === lower(d.factory) && lower(values[6]) === lower(d.upgradeAuthority) &&
      values[7] === true && lower(values[8]) === lower(d.upgradeAuthority),
      "Current deposit implementation or source pins changed", "UPGRADE_TRUST_MISMATCH", 409);
    const [depositWei, start, phase, status, credit] = values;
    requireThat(String(depositWei) === d.depositWei && Number(start) === d.eventStart &&
      d.depositDeadline === d.eventStart, "Current deposit terms differ from this event", "UPGRADE_TRUST_MISMATCH", 409);
    requireThat(Number(phase) === 0 && block.timestamp >= d.depositOpensAt && block.timestamp < d.depositDeadline,
      "Deposits close at the event start", "OUTSIDE_DEPOSIT_WINDOW", 409);
    requireThat(![1, 2].includes(Number(status)), "This wallet is already registered", "ALREADY_REGISTERED", 409);
    requireThat(Number(status) !== 3, "This wallet was rejected", "REGISTRATION_REJECTED", 409);
    requireThat(credit < depositWei, "The deposit is already fully funded", "CREDIT_AVAILABLE", 409);
    const amountWei = String(depositWei - credit), transaction = { to: d.contract, from: actor.wallet,
      data: c.interface.encodeFunctionData("deposit", []), value: amountWei, chainId: 1 };
    const simulationFailure = await directDepositSimulation(chain.provider, transaction, tag);
    const [canonical, network] = await Promise.all([
      directDepositBlock(tag), chain.provider.send("eth_chainId", []),
    ]);
    requireThat(BigInt(network) === 1n && canonical?.hash === block.hash,
      "The direct deposit block changed", "SELECTED_EVENT_REORG", 409);
    eligibleRecord();
    requireThat(!simulationFailure, "The exact deposit simulation could not be verified.",
      simulationFailure?.code, simulationFailure?.status);
    const snapshot = hash({ registryHash, revision, wallet: lower(actor.wallet), depositWei: String(depositWei),
      pendingCreditWei: String(credit), status: String(status), phase: String(phase), eventStart: String(start) });
    return { r, registryHash, revision, transaction, context: { kind: "direct-deposit-v1", eventId: scope.eventId,
      chainId: 1, contract: d.contract, wallet: actor.wallet, origin: productionOrigin, instanceId: serverInstanceId,
      depositWei: String(depositWei), amountWei, pendingCreditWei: String(credit),
      blockNumber: block.number, blockHash: block.hash, snapshot } };
  }
  async function createDirectDeposit(actor) {
    const scope = publicActor(actor);
    requireThat(scope?.kind === "deposit", "Direct deposits require the public first-event flow", "PUBLIC_FLOW_SCOPE", 403);
    const target = publicTransactionTarget("deposit"), r = record(scope.eventId, actor), d = r.deployment;
    requireThat(target.eventId === scope.eventId && lower(target.contract) === lower(scope.contract),
      "The direct deposit target changed", "PUBLIC_FLOW_SCOPE", 403);
    const registryHash = hash(d), revision = r.revision, c = contract(scope.eventId);
    const currentRecord = () => requireThat(r.definition.visibility === "public" && r.definition.editorialStatus === "published" &&
      r.definition.registrationStatus === "open" && hash(r.deployment) === registryHash && r.revision === revision &&
      !r.transactions.some(t => t.action === "deposit" && lower(t.wallet) === lower(actor.wallet) && ["pending", "mined"].includes(t.status)),
      "A deposit is closed, changed or already submitted", "PENDING_DEPOSIT", 409);
    currentRecord();
    // This is an amount quote, not signing authority. The unchanged final
    // directDepositPreflight below checks every current code/slot/financial pin
    // and simulates the exact sealed transaction before the sender may proceed.
    requireThat(BigInt(await chain.provider.send("eth_chainId", [])) === 1n, "Production RPC chain changed", "WRONG_CHAIN", 409);
    const block = await directDepositBlock("latest"), tag = ethers.toQuantity(block.number);
    requireThat(block.number >= d.deploymentBlock && block.timestamp >= d.depositOpensAt && block.timestamp < d.depositDeadline,
      "Deposits close at the event start", "OUTSIDE_DEPOSIT_WINDOW", 409);
    const rawCredit = await chain.provider.send("eth_call", [{ to: d.contract,
      data: c.interface.encodeFunctionData("pendingDeposits", [actor.wallet]) }, tag]);
    const credit = c.interface.decodeFunctionResult("pendingDeposits", rawCredit)[0], depositWei = BigInt(d.depositWei);
    requireThat(credit < depositWei, "The deposit is already fully funded", "CREDIT_AVAILABLE", 409);
    const [canonical, network] = await Promise.all([directDepositBlock(tag), chain.provider.send("eth_chainId", [])]);
    requireThat(BigInt(network) === 1n && canonical.hash === block.hash,
      "The direct deposit quote block changed", "SELECTED_EVENT_REORG", 409);
    currentRecord();
    const amountWei = String(depositWei - credit);
    // The quote seals the required Open/unregistered state, rather than claiming
    // those getters were checked here. Final validation must prove this same
    // fingerprint using its fresh complete current-state preflight.
    const snapshot = hash({ registryHash, revision, wallet: lower(actor.wallet), depositWei: String(depositWei),
      pendingCreditWei: String(credit), status: "0", phase: "0", eventStart: String(d.eventStart) });
    const context = { kind: "direct-deposit-v1", verification: "amount-quote", eventId: scope.eventId, chainId: 1,
      contract: d.contract, wallet: actor.wallet, origin: productionOrigin, instanceId: serverInstanceId,
      depositWei: String(depositWei), amountWei, pendingCreditWei: String(credit),
      blockNumber: block.number, blockHash: block.hash, snapshot };
    const transaction = { to: d.contract, from: actor.wallet, data: c.interface.encodeFunctionData("deposit", []), value: amountWei, chainId: 1 };
    const draft = { scopeKind: "event-call", id: id(), eventId: context.eventId, action: "deposit", params: { directDeposit: true, preparation: "amount-quote" },
      wallet: actor.wallet, sessionId: actor.id, chainId: 1, contract: d.contract, abiVersion: d.abiVersion,
      contractVersion: d.contractVersion, valueWei: context.amountWei, method: "deposit", args: [],
      summary: `Deposit ${ethers.formatEther(context.amountWei)} ETH toward this event's commitment.`,
      createdAt: Date.now(), expiresAt: Date.now() + 300_000, reviewBlock: context.blockNumber,
      snapshot: context.snapshot, revision, registryHash,
      transaction, used: false, mode: "hosted-production", instanceId: serverInstanceId,
      origin: productionOrigin, directDepositContext: context };
    drafts.set(draft.id, draft);
    try { v10Receipts.sealDraft(draft); await store?.save(events, drafts); }
    catch (error) { drafts.delete(draft.id); throw error; }
    return structuredClone(draft);
  }
  async function validateDirectDeposit(actor, draftId) {
    const { d } = publicReview(actor, draftId);
    requireThat(d.params?.directDeposit === true && !d.used && !d.submittedHash && !d.publicFlowHash && d.expiresAt > Date.now(),
      "The direct deposit request expired or was already submitted", "STALE_DRAFT", 409);
    const checked = await directDepositPreflight(actor);
    requireThat(d.snapshot === checked.context.snapshot && d.registryHash === checked.registryHash &&
      d.revision === checked.revision && hash(d.transaction) === hash(checked.transaction),
      "The deposit amount or current state changed", "STALE_DRAFT", 409);
    const canonical = await directDepositBlock(ethers.toQuantity(d.reviewBlock));
    requireThat(canonical?.hash === d.directDepositContext?.blockHash,
      "The original direct deposit block changed", "SELECTED_EVENT_REORG", 409);
    return { transaction: structuredClone(d.transaction) };
  }
  function publicReview(actor, draftId) {
    const scope = publicActor(actor), d = drafts.get(draftId);
    requireThat(scope && d && d.sessionId === actor.id && lower(d.wallet) === lower(actor.wallet) &&
      d.instanceId === serverInstanceId && d.origin === productionOrigin &&
      (scope.kind === "deposit" ? d.action === "deposit" && d.eventId === scope.eventId : d.action === "createEvent") &&
      lower(d.contract) === lower(scope.contract), "The review belongs to another public flow", "PUBLIC_FLOW_SCOPE", 403);
    v10Receipts.sealDraft(d);
    return { scope, d };
  }
  async function inspectPublicSubmission(actor, draftId, txHash) {
    const { scope, d } = publicReview(actor, draftId);
    requireThat(/^0x[0-9a-f]{64}$/i.test(txHash ?? "") &&
      (!d.publicFlowHash || lower(d.publicFlowHash) === lower(txHash)),
      "Keep the original transaction hash for this flow", "PUBLIC_FLOW_CONFLICT", 409);
    // Persist the original hash without setting global pending state, reserving
    // somebody else's hash, or claiming the address has signed anything.
    if (!d.publicFlowHash) { d.publicFlowHash = txHash.toLowerCase(); await store?.save(events, drafts); }
    const tx = await chain.provider.getTransaction(txHash);
    if (!tx) return { scope, d, visible: false };
    // Run the unchanged signed-transaction inspector against a detached sealed
    // review. The real shared review is not promoted until that proof succeeds.
    const inspectedDraft = structuredClone(d);
    inspectedDraft.submittedHash = txHash.toLowerCase();
    const inspectedDrafts = new Map(drafts); inspectedDrafts.set(d.id, inspectedDraft);
    const inspector = createV10ReceiptContext({ chain, origin: productionOrigin, instanceId: serverInstanceId, drafts: inspectedDrafts });
    await inspector.inspectDraftTransaction(inspectedDraft, tx, { canonical: Number.isSafeInteger(tx.blockNumber) });
    publicReview(actor, draftId);
    return { scope, d, visible: true };
  }
  const publicPending = (d, txHash) => ({ status: "pending", hash: txHash.toLowerCase(), wallet: d.wallet,
    eventId: d.eventId, chainId: 1, contract: d.contract, action: d.action, draftId: d.id });
  async function publicTransactionSubmitted(actor, draftId, txHash) {
    const { scope, d, visible } = await inspectPublicSubmission(actor, draftId, txHash);
    if (!visible) return publicPending(d, txHash);
    return scope.kind === "create" ? onboarding().recordSubmitted(actor, draftId, txHash)
      : recordSubmitted(scope.eventId, actor, draftId, txHash);
  }
  async function reconcilePublicTransaction(actor, draftId, txHash) {
    const { scope, d, visible } = await inspectPublicSubmission(actor, draftId, txHash);
    if (!visible) return publicPending(d, txHash);
    // The original submission endpoint runs once. Further receipt checks keep
    // its saved-hash reconciliation, including already terminal results.
    if (!d.submittedHash) await publicTransactionSubmitted(actor, draftId, txHash);
    const result = scope.kind === "create" ? await onboarding().reconcile(actor, draftId, txHash)
      : await reconcileSubmission(scope.eventId, actor, draftId, txHash);
    if (scope.kind === "deposit" && result.status === "confirmed") {
      const r = record(scope.eventId, actor);
      let person = [...r.participants.values()].find(p => lower(p.wallet) === lower(actor.wallet));
      const candidate = person ?? { id: id(), eventId: scope.eventId, wallet: actor.wallet,
        name: null, email: null, walletVerified: false, identityVerified: false,
        identitySource: "signed-transaction-receipt", lumaIdentity: null, admission: "pending", deposit: null };
      const evidence = await verifyReceipt(scope.eventId, candidate, txHash, true);
      if (!person) { r.participants.set(candidate.id, candidate); person = candidate; r.revision++; }
      if (!person.deposit || lower(person.deposit.txHash) === lower(txHash)) {
        person.deposit = evidence;
        if (!person.walletVerified) { person.walletVerified = true; person.identitySource = "signed-transaction-receipt"; }
        await store?.save(events, drafts);
      }
    }
    return result;
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
    requireThat(!productionV10, "V10 case publication is not enabled", "NOT_FOUND", 404);
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
  const casePublications = production && !productionV10 ? createProductionCasePublicationService({
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
    publicTransactionTarget,
    createPublicTransactionActor,
    createDirectDeposit,
    validateDirectDeposit,
    publicTransactionSubmitted,
    reconcilePublicTransaction,
    session,
    record,
    contract,
    state,
    owner,
    bootstrap,
    finalizeReadResult,
    publicCatalog: () => {
      requireThat(production, "Not found", "NOT_FOUND", 404);
      return publicCatalogSnapshot({ manifest: production.manifest, events, drafts,
        instanceId: serverInstanceId });
    },
    setupMetadata: () => {
      requireThat(productionV10 && factoryDeployment, "Not found", "NOT_FOUND", 404);
      const metadata = externalMetadata(null);
      const managedEvents = publicCatalogSnapshot({ manifest: production.manifest, events, drafts,
        instanceId: serverInstanceId }).events.map(({ id, title, startsAt, timezone, visibility, editorialStatus }) => ({
          id, title, startsAt, timezone, visibility, editorialStatus, creator: events.get(id)?.deployment.creator,
        }));
      return { mode: "hosted-production", identities: [], events: [], session: null,
        chain: production.manifest.chain, contractVersion: activeContractVersion, ...metadata, managedEvents,
        // Configuration for rendering and sign-in only. Current chain trust is
        // obtained separately by the original verifier on explicit Review.
        factory: { chainId: 1, address: factoryDeployment.factory,
          contractVersion: activeContractVersion, abiVersion: activeContractVersion,
          verified: false, deploymentTrust: { status: "unavailable" }, upgrade: null },
        recoveryEvents: [], now: 0 };
    },
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
    createDepositReview: (eventId, s) => createDraft(eventId, s, { action: "deposit", params: {}, depositReview: true }),
    validateDraft,
    executeDraft,
    confirmDraft,
    recordSubmitted,
    submissionStatus,
    reconcileSubmission,
    createFactoryDraft: async (s, input) => {
      const draft = await onboarding().createDraft(s, input);
      if (!productionV10) return draft;
      const context = draft.creationContext;
      requireThat(context?.kind === "verified-creation-context-v1" && context.draftId === draft.id &&
        context.snapshot === draft.snapshot && context.instanceId === serverInstanceId && context.origin === productionOrigin &&
        lower(context.wallet) === lower(s.wallet) && lower(context.factory?.address) === lower(factoryDeployment.factory),
        "Creation context differs from its successful review", "DRAFT_SCOPE", 409);
      return { ...draft, creationContext: { mode: "hosted-production", identities: [], events: [],
        chain: production.manifest.chain, contractVersion: activeContractVersion, ...externalMetadata(s),
        session: { wallet: s.wallet, label: s.label, mode: s.mode }, ...context } };
    },
    validateFactoryDraft: (s, draftId) => onboarding().validateDraft(s, draftId),
    recordFactorySubmitted: (s, draftId, txHash) => onboarding().recordSubmitted(s, draftId, txHash),
    reconcileFactorySubmission: (s, draftId, txHash) => onboarding().reconcile(s, draftId, txHash),
    reconcileFactoryReplacement: (s, draftId, txHash) => {
      const service = onboarding();
      requireThat(typeof service.reconcileReplacement === "function", "Fee-replacement recovery requires V10", "NOT_FOUND", 404);
      return service.reconcileReplacement(s, draftId, txHash);
    },
    getFactoryDraft: (s, draftId) => onboarding().getDraft(s, draftId),
    creationRecoveryScope: (wallet, txHash) => {
      requireThat(creationRecovery, "Creation recovery is unavailable", "NOT_FOUND", 404);
      return creationRecovery.scopeFor(wallet, txHash);
    },
    inspectCreationRecovery: (s) => {
      requireThat(creationRecovery, "Creation recovery is unavailable", "NOT_FOUND", 404);
      return creationRecovery.inspect(s);
    },
    advance,
    mockRuling,
    mockAppeal,
    publish,
    caseArtifact: (eventId, s, wallet, assertSession) => { const context = caseContext(eventId, s, wallet, assertSession); return casePublications.exportCase(context); },
    publishCaseArtifact: (eventId, s, wallet, approval, assertSession) => { const context = caseContext(eventId, s, wallet, assertSession); return casePublications.publishCase(context, approval); },
    verifyCaseArtifact: (eventId, s, wallet, assertSession) => { const context = caseContext(eventId, s, wallet, assertSession); return casePublications.verifyCase(context); },
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
  w.firstEventManageAvailable = eventId => productionV10 && firstEventManageMatches(events.get(eventId), manageScope);
  w.firstEventCreditRecoveryAvailable = eventId => productionV10 && firstEventCreditRecoveryMatches(events.get(eventId), manageScope);
  w.adoptPayer = createPayerAdoptionService(w, manageScope);
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
