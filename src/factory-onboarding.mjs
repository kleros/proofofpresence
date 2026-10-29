// Organizer creation is an unsigned review followed by verification of an already-signed fact.
// There is deliberately no signer, execute or broadcast capability in this service.
import { ethers } from "ethers";
import { hash, id, json, lower, requireThat, text, associations } from "./utils.mjs";
import { factoryEventId } from "./contracts-v8.mjs";
import { eventV9LumaTemplate, V9_LUMA_ATTENDANCE_STANDARD } from "./contracts-v9-luma.mjs";
import { loadUpgradeableArtifacts, V9_MAINNET_SCOPE, IMPLEMENTATION_SLOT } from "./upgrade-verification.mjs";
import { assertProductionEOAWallet } from "./production-wallets.mjs";
import { verifyDeployment } from "./chain.mjs";

const PROFILE = "kleros-event-v9-uups", DAY = 86400, TTL = 300000;
const copy = (value) => JSON.parse(json(value));
const same = (a, b) => lower(a) === lower(b);
const check = (condition, message, code = "INVALID_INPUT", status = 400) => requireThat(condition, message, code, status);
const INPUT_KEYS = ["title", "lumaUrl", "startsAt", "endsAt", "timezone", "depositEth"];
const SOURCE_KEYS = ["chainId", "contractVersion", "abiVersion", "factory", "factoryCodeHash", "factoryImplementation",
  "factoryImplementationCodeHash", "initialFactoryImplementation", "initialImplementation", "implementation", "implementationCodeHash",
  "upgradeAuthority", "upgradeAuthorityCodeHash", "initialUpgradeOwner", "factoryDeploymentTxHash", "factoryDeploymentBlock",
  "timelockDeploymentTxHash", "timelockDeploymentBlock"];
const reservedLumaPaths = new Set(["home", "discover", "events", "event", "calendar", "calendars", "signin", "sign-in", "login", "logout",
  "settings", "pricing", "features", "about", "terms", "privacy", "contact", "help", "create"]);

function isoTime(value) {
  check(typeof value === "string" && value.length <= 40, "Use an ISO timestamp with an explicit timezone");
  const p = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/);
  check(p, "Use an ISO timestamp with an explicit timezone");
  const [year, month, day, hour, minute, second] = p.slice(1, 7).map((part) => Number(part ?? 0));
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  check(year >= 2000 && calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day && calendar.getUTCHours() === hour && calendar.getUTCMinutes() === minute && calendar.getUTCSeconds() === second,
  "Invalid calendar date or time");
  const milliseconds = Date.parse(value);
  check(Number.isFinite(milliseconds) && milliseconds % 1000 === 0, "Event times must use whole seconds");
  return { iso: new Date(milliseconds).toISOString(), seconds: milliseconds / 1000 };
}

export function validateOrganizerTerms(input, policy, now) {
  check(input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).length === INPUT_KEYS.length && Object.keys(input).every((key) => INPUT_KEYS.includes(key)),
  "Use only title, Luma URL, start/end, timezone and ETH deposit");
  const title = text(input.title, 160, 2), lumaUrl = associations({ lumaUrl: input.lumaUrl }).lumaUrl;
  let luma; try { luma = new URL(lumaUrl); } catch {}
  check(luma?.origin === "https://luma.com" && /^\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(luma.pathname) &&
    !reservedLumaPaths.has(luma.pathname.slice(1).toLowerCase()), "Use a specific Luma event URL");
  const start = isoTime(input.startsAt), end = isoTime(input.endsAt);
  check(start.seconds > now && end.seconds > start.seconds && end.seconds <= start.seconds + 7 * DAY,
    "Choose future event hours ending within the seven-day posting term");
  const timezone = text(input.timezone, 100, 1);
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { check(false, "Choose a valid IANA timezone"); }
  check(typeof input.depositEth === "string" && input.depositEth.length <= 80 && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(input.depositEth),
    "Use a positive ETH amount with at most18 decimal places");
  let deposit; try { deposit = ethers.parseEther(input.depositEth); } catch { check(false, "Invalid ETH deposit"); }
  check(deposit > 0n && deposit < 2n ** 256n, "Deposit must be positive and fit the contract");
  return { title, lumaUrl, startsAt: start.iso, endsAt: end.iso, timezone,
    depositEth: ethers.formatEther(deposit), depositWei: String(deposit), eventStart: start.seconds,
    claimDeadline: start.seconds + 7 * DAY, claimDays: 7, capacity: 150, challengeWindowSeconds: DAY,
    matchWindowSeconds: DAY, attendanceStandard: { ...V9_LUMA_ATTENDANCE_STANDARD },
    policyURI: policy.uri, policySha256: policy.sha256 };
}

/** All injected dependencies are trusted server code, never request/manifest-selected callbacks. */
export function createFactoryOnboardingService({ chain, factoryDeployment, events, drafts, store,
  instanceId = id(), assertWallet = (wallet) => assertProductionEOAWallet(chain.provider, wallet), verifyFactory } = {}) {
  check(chain?.provider && factoryDeployment && events instanceof Map && drafts instanceof Map,
    "Factory onboarding needs a reviewed runtime, factory and scoped stores", "FACTORY_UNAVAILABLE", 503);
  const artifacts = loadUpgradeableArtifacts(), iface = new ethers.Interface(artifacts.factory.abi), pending = new Map();
  function serial(draftId, work) {
    const previous = pending.get(draftId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    pending.set(draftId, next);
    return next.finally(() => { if (pending.get(draftId) === next) pending.delete(draftId); });
  }
  const source = () => copy(Object.fromEntries(SOURCE_KEYS.map((key) => [key, factoryDeployment[key]])));
  const factoryHash = () => hash(factoryDeployment);
  function auth(session) {
    check(session?.mode === "wallet" && typeof session.id === "string" && session.id.length > 0 && ethers.isAddress(session.wallet),
      "Authenticate your browser wallet first", "UNAUTHENTICATED", 401);
    return { id: session.id, wallet: ethers.getAddress(session.wallet), mode: "wallet" };
  }
  function approvedPolicy() {
    const policy = factoryDeployment.policy;
    check(factoryDeployment.policyStatus === "published" && policy && typeof policy.text === "string" && policy.text.length > 0 &&
      /^[a-f0-9]{64}$/.test(policy.sha256 ?? "") && hash(policy.text) === policy.sha256,
    "The event policy must be approved and published before creation", "POLICY_UNAVAILABLE", 503);
    let u; try { u = new URL(policy.uri); } catch {}
    check(u?.protocol === "https:" && !u.username && !u.password && !u.hash && u.href === policy.uri,
      "Use the approved published HTTPS policy", "POLICY_UNAVAILABLE", 503);
    return copy(policy);
  }
  async function network() {
    check(BigInt(await chain.provider.send("eth_chainId", [])) === 1n, "Organizer creation requires Ethereum mainnet", "WRONG_CHAIN", 409);
    const f = source();
    check(f.chainId === 1 && f.contractVersion === PROFILE && f.abiVersion === PROFILE && ethers.isAddress(f.factory),
      "Only the reviewed Ethereum v9 factory is supported", "FACTORY_UNAVAILABLE", 503);
  }
  async function proof() {
    await network();
    const verify = verifyFactory ?? (async (runtime, f) => {
      const engine = await import("./upgrade-verification.mjs");
      check(typeof engine.verifyV9FactoryDeployment === "function", "Factory provenance verifier is unavailable", "FACTORY_UNAVAILABLE", 503);
      return engine.verifyV9FactoryDeployment(runtime, f, V9_MAINNET_SCOPE);
    });
    const result = await verify(chain, source());
    check(result?.anchor && result.deploymentTrust?.status === "verified" &&
      Number.isSafeInteger(result.anchor.number) && ethers.isHexString(result.anchor.hash, 32),
    "Factory provenance is unavailable", "FACTORY_UNAVAILABLE", 503);
    check((await chain.provider.getBlock(result.anchor.number))?.hash === result.anchor.hash,
      "Factory verification snapshot changed", "FACTORY_REORG", 409);
    return { result, snapshot: hash({ factory: source(), upgrade: result.upgrade ?? result.factoryUpgrade,
      eventImplementation: result.eventImplementation ?? source().implementation }) };
  }
  async function persist() { if (store?.save) await store.save(events, drafts); }
  function find(session, draftId, signing = false) {
    const actor = auth(session), draft = drafts.get(draftId);
    check(draft?.scopeKind === "factory-create" && same(draft.wallet, actor.wallet) && draft.chainId === 1 &&
      draft.contractVersion === PROFILE && same(draft.factory, factoryDeployment.factory),
    "Creation review belongs to another wallet or factory", "DRAFT_SCOPE", 409);
    if (signing) check(draft.sessionId === actor.id && draft.instanceId === instanceId &&
      !draft.used && !draft.submittedHash && draft.expiresAt > Date.now(),
    "Creation review expired, changed session or was already submitted", "STALE_DRAFT", 409);
    return { actor, draft };
  }
  function dto(draft) {
    const { factorySource, policyText, ...publicDraft } = draft;
    return copy(publicDraft);
  }
  function exactReview(draft) {
    const template = templateFor(draft.terms);
    check(draft.eventKey === ethers.id(draft.eventId) && draft.method === "createEvent" &&
      draft.transaction.chainId === 1 && same(draft.transaction.from, draft.wallet) && same(draft.transaction.to, draft.factory) &&
      String(draft.transaction.value) === "0" && hash(template) === hash(draft.template) &&
      hash(draft.terms.attendanceStandard) === hash(V9_LUMA_ATTENDANCE_STANDARD) &&
      draft.config.depositAmount === draft.terms.depositWei && draft.config.eventName === draft.terms.title &&
      draft.config.eventStart === draft.terms.eventStart && draft.config.claimDeadline === draft.terms.claimDeadline &&
      draft.config.arbitration.policyURI === draft.terms.policyURI &&
      hash(draft.config.arbitration.metaEvidenceTemplate) === hash(template.pieces) &&
      draft.config.arbitration.metaEvidenceSlots === template.slots &&
      draft.transaction.data === iface.encodeFunctionData("createEvent", [draft.eventKey, draft.config]),
    "Creation review content does not match its immutable terms", "DRAFT_SCOPE", 409);
  }
  function templateFor(terms) {
    return eventV9LumaTemplate({ eventName: terms.title, depositAmount: terms.depositWei,
      policyURI: terms.policyURI, policySha256: terms.policySha256, lumaUrl: terms.lumaUrl,
      startsAt: terms.startsAt, endsAt: terms.endsAt, timezone: terms.timezone });
  }
  async function simulate(draft) {
    await chain.provider.call(draft.transaction);
    const estimate = await chain.provider.estimateGas(draft.transaction);
    const gas = (estimate * 130n + 99n) / 100n;
    check(gas > 0n && gas <= 16777216n, "Event creation exceeds the reviewed transaction gas limit", "GAS_LIMIT", 409);
    return gas;
  }
  async function finishSigningChecks(actor, draft) {
    const latest = await proof();
    check(draft.factoryFingerprint === factoryHash() && latest.snapshot === draft.snapshot,
      "Factory implementation or governance changed; review again", "STALE_DRAFT", 409);
    const checked = await assertWallet(actor.wallet);
    await network();
    // A final code-presence check closes the provenance/EOA guard race, without granting signing power.
    const head = await chain.provider.getBlock("latest"), f = source(), tag = ethers.toQuantity(head.number), at = { blockTag: head.number };
    const timelock = new ethers.Contract(f.upgradeAuthority, artifacts.timelock.abi, chain.provider);
    const queued = latest.result.upgrade?.pending;
    const [code, slot, factoryCode, selected, owner, pendingOwner, pendingCount, executingCount, delay, operationState, operationTime] = await Promise.all([
      chain.provider.getCode(actor.wallet, head.number),
      chain.provider.send("eth_getStorageAt", [f.factory, IMPLEMENTATION_SLOT, tag]),
      chain.provider.getCode(f.factory, head.number),
      new ethers.Contract(f.factory, artifacts.factory.abi, chain.provider).eventImplementation({ blockTag: head.number }),
      timelock.owner(at), timelock.pendingOwner(at), timelock.pendingOperationCount(at), timelock.executingOperationCount(at), timelock.getMinDelay(at),
      queued ? timelock.getOperationState(queued.operationId, at) : Promise.resolve(null),
      queued ? timelock.getTimestamp(queued.operationId, at) : Promise.resolve(null),
    ]);
    check((await chain.provider.getBlock(head.number))?.hash === head.hash,
      "Factory/wallet verification snapshot changed", "FACTORY_REORG", 409);
    check(code === "0x", "Wallet compatibility changed during review", "UNSUPPORTED_WALLET", 422);
    check(ethers.isHexString(slot, 32) && same(slot, ethers.zeroPadValue(f.factoryImplementation, 32)) &&
      ethers.keccak256(factoryCode) === f.factoryCodeHash && same(selected, f.implementation),
    "Factory changed after provenance review", "STALE_DRAFT", 409);
    const governance = latest.result.upgrade;
    check(governance && same(owner, governance.owner) && same(pendingOwner, governance.pendingOwner ?? ethers.ZeroAddress) &&
      Number(pendingCount) === governance.pendingOperationCount && Number(executingCount) === governance.executingOperationCount &&
      Number(delay) === governance.delaySeconds && (!queued ||
        (operationTime === BigInt(queued.eligibleAt) && operationState === (queued.status === "waiting" ? 1n : 2n))),
    "Upgrade governance changed after wallet verification; review again", "STALE_DRAFT", 409);
    return checked;
  }
  async function createDraft(session, input) {
    const actor = auth(session); await network(); await assertWallet(actor.wallet);
    check(![...drafts.values()].some((d) => d.scopeKind === "factory-create" && same(d.wallet, actor.wallet) &&
      same(d.factory, factoryDeployment.factory) && d.status === "pending"),
    "Reconcile your submitted event creation before preparing another", "PENDING_FACTORY_CREATION", 409);
    const policy = approvedPolicy(), verified = await proof();
    const terms = validateOrganizerTerms(input, policy, verified.result.anchor.timestamp);
    const eventId = `event-${id()}`, eventKey = ethers.id(eventId);
    check(!events.has(eventId), "Event identity collision", "EVENT_CONFLICT", 409);
    const template = templateFor(terms);
    const config = { depositAmount: terms.depositWei, eventName: terms.title, eventStart: terms.eventStart, claimDeadline: terms.claimDeadline,
      arbitration: { disputeResolver: factoryDeployment.resolver ?? chain.resolver?.target,
        extraData: factoryDeployment.arbitratorExtraData ?? chain.manifest?.arbitration?.extraData ??
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]),
        metaEvidenceTemplate: template.pieces, metaEvidenceSlots: template.slots, policyURI: terms.policyURI } };
    check(ethers.isAddress(config.arbitration.disputeResolver) && ethers.isHexString(config.arbitration.extraData),
      "Reviewed arbitration configuration is unavailable", "FACTORY_UNAVAILABLE", 503);
    const transaction = { from: actor.wallet, to: factoryDeployment.factory, data: iface.encodeFunctionData("createEvent", [eventKey, config]), value: "0", chainId: 1 };
    const draft = { scopeKind: "factory-create", id: id(), eventId, eventKey, wallet: actor.wallet, sessionId: actor.id, instanceId,
      chainId: 1, contractVersion: PROFILE, abiVersion: PROFILE, factory: factoryDeployment.factory, method: "createEvent", args: [eventKey, config],
      mode: "hosted-production", action: "createEvent", contract: factoryDeployment.factory, valueWei: "0",
      terms, config, template, transaction, factorySource: source(), policyText: policy.text,
      factoryFingerprint: factoryHash(), registryHash: hash(source()), snapshot: verified.snapshot,
      createdAt: Date.now(), expiresAt: Date.now() + TTL, reviewBlock: verified.result.anchor.number, status: "reviewed", used: false };
    draft.transaction.gasLimit = String(await simulate(draft));
    await finishSigningChecks(actor, draft);
    drafts.set(draft.id, draft); await persist(); return dto(draft);
  }
  async function validateFact(session, draftId) {
    const { actor, draft } = find(session, draftId, true); approvedPolicy();
    exactReview(draft);
    await assertWallet(actor.wallet);
    check(await simulate(draft) <= BigInt(draft.transaction.gasLimit), "Creation gas changed; review again", "STALE_DRAFT", 409);
    await finishSigningChecks(actor, draft);
    return dto(draft);
  }
  function validateDraft(session, draftId) { return serial(draftId, () => validateFact(session, draftId)); }
  async function exactTransaction(draft, txHash) {
    exactReview(draft);
    check(/^0x[0-9a-fA-F]{64}$/.test(txHash ?? ""), "Use a valid transaction hash");
    const tx = await chain.provider.getTransaction(txHash);
    if (tx) check(same(tx.from, draft.wallet) && same(tx.to, draft.factory) && tx.data === draft.transaction.data &&
      tx.value === 0n && Number(tx.chainId) === 1, "Transaction differs from the reviewed creation", "TX_MISMATCH", 409);
    return tx;
  }
  async function recordSubmittedFact(session, draftId, txHash) {
    const { draft } = find(session, draftId);
    check(!draft.submittedHash || same(draft.submittedHash, txHash), "A different transaction already belongs to this review", "TX_MISMATCH", 409);
    await exactTransaction(draft, txHash);
    check(!draft.submittedHash || same(draft.submittedHash, txHash), "A different transaction already belongs to this review", "TX_MISMATCH", 409);
    if (draft.used) return { status: draft.status, hash: txHash, eventId: draft.eventId, wallet: draft.wallet, chainId: 1,
      blockNumber: draft.blockNumber, ...(draft.createdContract ? { contract: draft.createdContract } : {}) };
    check(![...drafts.values()].some((d) => d.id !== draft.id && same(d.submittedHash ?? "", txHash)), "Transaction hash already belongs to another creation", "TX_MISMATCH", 409);
    draft.submittedHash = txHash; draft.status = "pending"; await persist();
    return { status: "pending", hash: txHash, eventId: draft.eventId, wallet: draft.wallet, chainId: 1 };
  }
  function recordSubmitted(session, draftId, txHash) { return serial(draftId, () => recordSubmittedFact(session, draftId, txHash)); }
  async function reconcileFact(session, draftId, txHash) {
    const { draft } = find(session, draftId);
    check(!draft.submittedHash || same(draft.submittedHash, txHash), "A different transaction already belongs to this review", "TX_MISMATCH", 409);
    await network(); const tx = await exactTransaction(draft, txHash);
    check(tx, "Transaction is not visible yet; preserve its hash and retry the read", "TX_UNAVAILABLE", 409);
    check(!draft.submittedHash || same(draft.submittedHash, txHash), "A different transaction already belongs to this review", "TX_MISMATCH", 409);
    // Bind the validated known hash durably before receipt/source reads can fail.
    draft.submittedHash = txHash; if (!draft.used) draft.status = "pending"; await persist();
    const receipt = await chain.provider.getTransactionReceipt(txHash);
    if (!receipt) return { status: "pending", hash: txHash, eventId: draft.eventId, wallet: draft.wallet, chainId: 1 };
    check(same(tx.hash, txHash) && same(receipt.hash ?? receipt.transactionHash, txHash) &&
      receipt.blockNumber === tx.blockNumber && receipt.blockHash === tx.blockHash && receipt.blockNumber > draft.reviewBlock &&
      (await chain.provider.getBlock(receipt.blockNumber))?.hash === receipt.blockHash,
    "Creation receipt predates the review or is noncanonical", "TX_REORG", 409);
    check(!draft.used || (draft.blockNumber === receipt.blockNumber && draft.blockHash === receipt.blockHash),
      "A terminal creation receipt changed; preserve the original record", "TX_REORG", 409);
    if (receipt.status !== 1) {
      check(draft.status !== "confirmed", "Confirmed creation receipt changed", "TX_REORG", 409);
      draft.status = "failed"; draft.used = true; draft.confirmedHash = txHash; draft.blockNumber = receipt.blockNumber; draft.blockHash = receipt.blockHash; await persist();
      return { status: "failed", hash: txHash, eventId: draft.eventId, wallet: draft.wallet, chainId: 1, blockNumber: receipt.blockNumber };
    }
    const logs = receipt.logs.filter((log) => same(log.address, draft.factory)).flatMap((log) => {
      try { const p = iface.parseLog(log); return p?.name === "EventCreated" ? [p] : []; } catch { return []; }
    });
    const configType = "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
    const configurationHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", configType], [draft.wallet, draft.config]));
    const expectedId = factoryEventId({ chainId: 1, factory: draft.factory, creator: draft.wallet, eventKey: draft.eventKey });
    check(logs.length === 1 && same(logs[0].args.creator, draft.wallet) && logs[0].args.version === 9n &&
      logs[0].args.eventKey === draft.eventKey && logs[0].args.eventId === expectedId &&
      logs[0].args.configurationHash === configurationHash && ethers.isAddress(logs[0].args.eventContract),
    "Creation receipt does not contain the exact reviewed EventCreated event", "TX_MISMATCH", 409);
    const contract = ethers.getAddress(logs[0].args.eventContract), f = draft.factorySource, terms = draft.terms;
    const deployment = { ...f, eventId: draft.eventId, contract, deploymentTxHash: txHash, deploymentBlock: receipt.blockNumber,
      owner: draft.wallet, creator: draft.wallet, eventName: terms.title, depositWei: terms.depositWei, eventStart: terms.eventStart,
      claimDeadline: terms.claimDeadline, depositOpensAt: (await chain.provider.getBlock(receipt.blockNumber)).timestamp,
      depositDeadline: terms.eventStart, resolver: draft.config.arbitration.disputeResolver,
      arbitrator: factoryDeployment.arbitrator ?? chain.liquid?.target, arbitratorExtraData: draft.config.arbitration.extraData,
      policyURI: terms.policyURI, templateHash: hash([draft.template.pieces, draft.template.slots]),
      eventKey: draft.eventKey, factoryEventId: expectedId, configurationHash,
      codeHash: ethers.keccak256(await chain.provider.getCode(contract)) };
    try { await verifyDeployment(chain, deployment); }
    catch (error) {
      draft.adoptionStatus = "unavailable";
      draft.verificationError = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
        ? error.code : "PROVENANCE_UNAVAILABLE";
      await persist(); throw error;
    }
    check((await chain.provider.getBlock(receipt.blockNumber))?.hash === receipt.blockHash,
      "Creation receipt changed during provenance verification", "TX_REORG", 409);
    const existing = events.get(draft.eventId);
    check(!existing || same(existing.deployment?.contract, contract), "Stable event identity already belongs to another contract", "EVENT_CONFLICT", 409);
    check(![...events.values()].some((r) => r.deployment?.eventId !== draft.eventId && same(r.deployment?.contract, contract)),
      "Child already belongs to another event identity", "EVENT_CONFLICT", 409);
    if (!existing) events.set(draft.eventId, { dynamic: true,
      definition: { id: draft.eventId, title: terms.title, slug: draft.eventId, description: "", location: "", lumaUrl: terms.lumaUrl,
        startsAt: terms.startsAt, endsAt: terms.endsAt, timezone: terms.timezone, visibility: "public", editorialStatus: "published",
        registrationStatus: "open", organizers: [draft.wallet], staff: [] }, deployment,
      policy: draft.policyText, pieces: draft.template.pieces, slots: draft.template.slots, financialAccess: [draft.wallet],
      participants: new Map(), observations: [], batches: [], personal: new Map(), publications: new Map(),
      transactions: [], nonces: new Set(), revision: 0,
    });
    draft.used = true; draft.status = "confirmed"; draft.confirmedHash = txHash; draft.createdContract = contract;
    draft.blockNumber = receipt.blockNumber; draft.blockHash = receipt.blockHash; draft.adoptionStatus = "verified"; delete draft.verificationError;
    await persist(); return { status: "confirmed", hash: txHash, eventId: draft.eventId, contract, wallet: draft.wallet, chainId: 1, blockNumber: receipt.blockNumber };
  }
  function reconcile(session, draftId, txHash) { return serial(draftId, () => reconcileFact(session, draftId, txHash)); }
  function getDraft(session, draftId) { return dto(find(session, draftId).draft); }
  return { createDraft, validateDraft, recordSubmitted, reconcile, getDraft };
}
