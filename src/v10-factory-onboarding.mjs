// Separate V10 organizer creation; historical V9 onboarding remains unchanged.
// Organizer creation is an unsigned review followed by verification of an already-signed fact.
// There is deliberately no signer, execute or broadcast capability in this service.
import { ethers } from "ethers";
import { hash, id, json, lower, requireThat, text, associations } from "./utils.mjs";
import { factoryEventId } from "./contracts-v8.mjs";
import { eventV10LumaTemplate, V10_LUMA_ATTENDANCE_STANDARD } from "./contracts-v10-luma.mjs";
import { loadV10UpgradeableArtifacts } from "./v10-upgrade-artifacts.mjs";
import { V10_MAINNET_SCOPE, V10_IMPLEMENTATION_SLOT, verifyV10FactoryDeployment } from "./v10-upgrade-verification.mjs";
import { V10_POLICY_SHA256 } from "./v10-mainnet-runtime.mjs";
import { METAMASK_V130 } from "./v10-wallet-compatibility.mjs";
import { assertProductionEOAWallet } from "./production-wallets.mjs";
import { verifyDeployment } from "./chain.mjs";

const PROFILE = "kleros-event-v10-uups", DAY = 86400, TTL = 300000;
const copy = (value) => JSON.parse(json(value));
const transactionSnapshot = tx => hash(Object.fromEntries(["hash", "chainId", "from", "to", "value", "data", "nonce",
  "blockHash", "blockNumber", "type", "authorizationList", "accessList", "signature", "gasLimit", "gasPrice",
  "maxFeePerGas", "maxPriorityFeePerGas", "maxFeePerBlobGas", "blobVersionedHashes"].map(key => [key, tx[key]])));
const same = (a, b) => lower(a) === lower(b);
const check = (condition, message, code = "INVALID_INPUT", status = 400) => requireThat(condition, message, code, status);
const INPUT_KEYS = ["title", "lumaUrl", "startsAt", "endsAt", "timezone", "depositEth"];
const SOURCE_KEYS = ["chainId", "contractVersion", "abiVersion", "factory", "factoryCodeHash", "factoryImplementation",
  "factoryImplementationCodeHash", "initialFactoryImplementation", "initialImplementation", "implementation", "implementationCodeHash",
  "upgradeAuthority", "upgradeAuthorityCodeHash", "initialUpgradeOwner", "factoryDeploymentTxHash", "factoryDeploymentBlock",
  "controllerDeploymentTxHash", "controllerDeploymentBlock"];
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

export function validateV10OrganizerTerms(input, policy, now) {
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
    matchWindowSeconds: DAY, attendanceStandard: { ...V10_LUMA_ATTENDANCE_STANDARD },
    policyURI: policy.uri, policySha256: policy.sha256 };
}

/** All injected dependencies are trusted server code, never request/manifest-selected callbacks. */
export function createV10FactoryOnboardingService({ chain, factoryDeployment, events, drafts, store,
  instanceId = id(), origin = null, receiptContext = null, assertWallet, verifyFactory } = {}) {
  check(chain?.provider && factoryDeployment && events instanceof Map && drafts instanceof Map,
    "Factory onboarding needs a reviewed runtime, factory and scoped stores", "FACTORY_UNAVAILABLE", 503);
  check((assertWallet === undefined || typeof assertWallet === "function") &&
    (verifyFactory === undefined || typeof verifyFactory === "function"), "Trusted wallet/factory dependencies must be functions");
  assertWallet ??= async (wallet, observation) => {
    if (!observation) return assertProductionEOAWallet(chain.provider, wallet);
    check(observation.code === "0x", "This account is outside the reviewed financial wallet profile", "UNSUPPORTED_WALLET", 422);
    return { wallet: ethers.getAddress(wallet), blockNumber: observation.blockNumber, blockHash: observation.blockHash,
      codeHash: ethers.keccak256(observation.code), financialEligible: true, accountType: "eoa" };
  };
  const artifacts = loadV10UpgradeableArtifacts(), iface = new ethers.Interface(artifacts.factory.abi), pending = new Map();
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
    check(factoryDeployment.policyStatus === "published" && policy && policy.contractVersion === PROFILE &&
      typeof policy.text === "string" && policy.sha256 === V10_POLICY_SHA256 && hash(policy.text) === V10_POLICY_SHA256,
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
      "Only the reviewed Ethereum v10 factory is supported", "FACTORY_UNAVAILABLE", 503);
  }
  async function proof() {
    await network();
    const verify = verifyFactory ?? (async (runtime, f) => {
      return verifyV10FactoryDeployment(runtime, f, V10_MAINNET_SCOPE);
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
      hash(draft.terms.attendanceStandard) === hash(V10_LUMA_ATTENDANCE_STANDARD) &&
      draft.config.depositAmount === draft.terms.depositWei && draft.config.eventName === draft.terms.title &&
      draft.config.eventStart === draft.terms.eventStart && draft.config.claimDeadline === draft.terms.claimDeadline &&
      draft.config.arbitration.policyURI === draft.terms.policyURI &&
      hash(draft.config.arbitration.metaEvidenceTemplate) === hash(template.pieces) &&
      draft.config.arbitration.metaEvidenceSlots === template.slots &&
      draft.transaction.data === iface.encodeFunctionData("createEvent", [draft.eventKey, draft.config]),
    "Creation review content does not match its immutable terms", "DRAFT_SCOPE", 409);
  }
  function templateFor(terms) {
    return eventV10LumaTemplate({ eventName: terms.title, depositAmount: terms.depositWei,
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
    await assertWallet(actor.wallet);
    await network();
    const head = await chain.provider.getBlock("latest"), f = source(), tag = ethers.toQuantity(head.number), at = { blockTag: head.number };
    const controller = new ethers.Contract(f.upgradeAuthority, artifacts.controller.abi, chain.provider);
    const factory = new ethers.Contract(f.factory, artifacts.factory.abi, chain.provider);
    const implementation = new ethers.Contract(f.implementation, artifacts.event.abi, chain.provider);
    const [code, slot, factoryCode, implementationCode, factoryImplementationCode, controllerCode,
      selected, owner, pendingOwner, disabled, controllerVersion, factoryVersion, eventVersion, delay] = await Promise.all([
      chain.provider.getCode(actor.wallet, head.number),
      chain.provider.send("eth_getStorageAt", [f.factory, V10_IMPLEMENTATION_SLOT, tag]),
      chain.provider.getCode(f.factory, head.number), chain.provider.getCode(f.implementation, head.number),
      chain.provider.getCode(f.factoryImplementation, head.number), chain.provider.getCode(f.upgradeAuthority, head.number),
      factory.eventImplementation(at), controller.owner(at), controller.pendingOwner(at), controller.upgradesDisabled(at),
      controller.VERSION(at), factory.VERSION(at), implementation.VERSION(at), controller.UPGRADE_DELAY_SECONDS(at),
    ]);
    check(ethers.isHexString(slot, 32) && same(slot, ethers.zeroPadValue(f.factoryImplementation, 32)) &&
      ethers.keccak256(factoryCode) === f.factoryCodeHash && ethers.keccak256(implementationCode) === f.implementationCodeHash &&
      ethers.keccak256(factoryImplementationCode) === f.factoryImplementationCodeHash && ethers.keccak256(controllerCode) === f.upgradeAuthorityCodeHash &&
      same(selected, f.implementation) && controllerVersion === 10n && factoryVersion === 10n && eventVersion === 10n && delay === 0n,
      "Factory changed after provenance review", "STALE_DRAFT", 409);
    const governance = latest.result.upgrade;
    check(governance && governance.version === 10 && governance.delaySeconds === 0 &&
      same(owner, governance.owner) && same(pendingOwner, governance.pendingOwner ?? ethers.ZeroAddress) &&
      disabled === governance.upgradesDisabled && disabled === governance.finalizationVerified &&
      (!disabled || (same(owner, ethers.ZeroAddress) && same(pendingOwner, ethers.ZeroAddress))),
      "Upgrade governance changed after wallet verification; review again", "STALE_DRAFT", 409);
    const walletProof = await assertWallet(actor.wallet, { blockNumber: head.number, blockHash: head.hash, code });
    const knownCode = walletProof?.accountType === "eoa" ? code === "0x" :
      walletProof?.accountType === "metamask-protected-self-v1.3" &&
      same(code, "0xef0100" + METAMASK_V130.delegate.slice(2));
    check(walletProof && Object.keys(walletProof).length === 6 && same(walletProof.wallet, actor.wallet) &&
      walletProof.blockNumber === head.number && same(walletProof.blockHash, head.hash) &&
      walletProof.codeHash === ethers.keccak256(code) && walletProof.financialEligible === true && knownCode,
      "Wallet compatibility changed during review", "UNSUPPORTED_WALLET", 422);
    check((await chain.provider.getBlock(head.number))?.hash === head.hash,
      "Factory/wallet verification snapshot changed", "FACTORY_REORG", 409);
    return walletProof;
  }
  async function createDraft(session, input) {
    const actor = auth(session); await network(); await assertWallet(actor.wallet);
    check(![...drafts.values()].some((d) => d.scopeKind === "factory-create" && same(d.wallet, actor.wallet) &&
      same(d.factory, factoryDeployment.factory) && d.status === "pending"),
    "Reconcile your submitted event creation before preparing another", "PENDING_FACTORY_CREATION", 409);
    const policy = approvedPolicy(), verified = await proof();
    const terms = validateV10OrganizerTerms(input, policy, verified.result.anchor.timestamp);
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
      ...(receiptContext ? { origin } : {}),
      terms, config, template, transaction, factorySource: source(), policyText: policy.text,
      factoryFingerprint: factoryHash(), registryHash: hash(source()), snapshot: verified.snapshot,
      createdAt: Date.now(), expiresAt: Date.now() + TTL, reviewBlock: verified.result.anchor.number, status: "reviewed", used: false };
    draft.transaction.gasLimit = String(await simulate(draft));
    await finishSigningChecks(actor, draft);
    drafts.set(draft.id, draft);
    try { if (receiptContext) receiptContext.sealDraft(draft); await persist(); }
    catch (error) { drafts.delete(draft.id); throw error; }
    return dto(draft);
  }
  async function validateFact(session, draftId) {
    const { actor, draft } = find(session, draftId, true); approvedPolicy();
    if (receiptContext) receiptContext.sealDraft(draft);
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
    if (tx) {
      check(same(tx.hash, txHash) && Number(tx.chainId) === 1, "Transaction left its reviewed chain or hash", "TX_MISMATCH", 409);
      const direct = same(tx.from, draft.wallet) && same(tx.to, draft.factory) && tx.data === draft.transaction.data && tx.value === 0n;
      if (!direct || Number(tx.type) === 4) {
        check(typeof chain.assertTransactionIntent === "function", "Transaction differs from the reviewed creation", "TX_MISMATCH", 409);
        const expected = Object.freeze({ chainId: 1, transactionHash: txHash, from: draft.wallet, to: draft.factory,
          valueWei: "0", data: draft.transaction.data });
        const actualSnapshot = transactionSnapshot(tx);
        const proof = receiptContext
          ? await receiptContext.inspectDraftTransaction(draft, tx, { canonical: Number.isSafeInteger(tx.blockNumber) })
          : await chain.assertTransactionIntent(tx, expected);
        check(transactionSnapshot(tx) === actualSnapshot && proof && Object.keys(proof).length === 7 && proof.verified === true && proof.chainId === 1 &&
          same(proof.transactionHash, txHash) && same(proof.from, draft.wallet) && same(proof.to, draft.factory) &&
          proof.valueWei === "0" && same(proof.dataHash, ethers.keccak256(draft.transaction.data)),
          "Trusted transaction proof differs from the reviewed creation", "TX_MISMATCH", 409);
      }
    }
    return tx;
  }
  async function retainSubmission(draft, txHash) {
    check(/^0x[0-9a-fA-F]{64}$/.test(txHash ?? ""), "Use a valid transaction hash");
    if (receiptContext) receiptContext.sealDraft(draft);
    check(!draft.submittedHash || same(draft.submittedHash, txHash), "A different transaction already belongs to this review", "TX_MISMATCH", 409);
    check(!draft.confirmedHash || same(draft.confirmedHash, txHash), "A different confirmed transaction belongs to this review", "TX_MISMATCH", 409);
    check(![...drafts.values()].some(d => d !== draft && [d.submittedHash, d.confirmedHash].some(value => value && same(value, txHash))),
      "Transaction hash already belongs to another review", "TX_MISMATCH", 409);
    draft.submittedHash = txHash;
    if (!draft.used) draft.status = "pending";
    await persist(); // Preserve the original once-only hash before any RPC or inspection.
  }
  async function recordSubmittedFact(session, draftId, txHash) {
    const { draft } = find(session, draftId);
    check(!draft.submittedHash || same(draft.submittedHash, txHash), "A different transaction already belongs to this review", "TX_MISMATCH", 409);
    await retainSubmission(draft, txHash);
    await exactTransaction(draft, txHash);
    check(!draft.submittedHash || same(draft.submittedHash, txHash), "A different transaction already belongs to this review", "TX_MISMATCH", 409);
    if (draft.used) return { status: draft.status, hash: txHash, eventId: draft.eventId, wallet: draft.wallet, chainId: 1,
      blockNumber: draft.blockNumber, ...(draft.createdContract ? { contract: draft.createdContract } : {}) };
    check(![...drafts.values()].some((d) => d.id !== draft.id && same(d.submittedHash ?? "", txHash)), "Transaction hash already belongs to another creation", "TX_MISMATCH", 409);
    return { status: "pending", hash: txHash, eventId: draft.eventId, wallet: draft.wallet, chainId: 1 };
  }
  function recordSubmitted(session, draftId, txHash) { return serial(draftId, () => recordSubmittedFact(session, draftId, txHash)); }
  async function reconcileFact(session, draftId, txHash) {
    const { draft } = find(session, draftId);
    if (receiptContext) check(draft.submittedHash || draft.confirmedHash,
      "The original wallet submission must be recorded first; the saved review is preserved", "ORIGINAL_HASH_NOT_RECORDED", 409);
    check(!draft.submittedHash || same(draft.submittedHash, txHash), "A different transaction already belongs to this review", "TX_MISMATCH", 409);
    await retainSubmission(draft, txHash);
    await network(); const tx = await exactTransaction(draft, txHash);
    check(tx, "Transaction is not visible yet; preserve its hash and retry the read", "TX_UNAVAILABLE", 409);
    check(!draft.submittedHash || same(draft.submittedHash, txHash), "A different transaction already belongs to this review", "TX_MISMATCH", 409);
    const receipt = await chain.provider.getTransactionReceipt(txHash);
    if (!receipt) return { status: "pending", hash: txHash, eventId: draft.eventId, wallet: draft.wallet, chainId: 1 };
    const receiptHeader = await chain.provider.getBlock(receipt.blockNumber);
    check(same(tx.hash, txHash) && same(receipt.hash ?? receipt.transactionHash, txHash) &&
      receipt.blockNumber === tx.blockNumber && receipt.blockHash === tx.blockHash && receipt.blockNumber > draft.reviewBlock &&
      receiptHeader?.hash === receipt.blockHash,
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
    check(logs.length === 1 && same(logs[0].args.creator, draft.wallet) && logs[0].args.version === 10n &&
      logs[0].args.eventKey === draft.eventKey && logs[0].args.eventId === expectedId &&
      logs[0].args.configurationHash === configurationHash && ethers.isAddress(logs[0].args.eventContract),
    "Creation receipt does not contain the exact reviewed EventCreated event", "TX_MISMATCH", 409);
    const contract = ethers.getAddress(logs[0].args.eventContract), f = draft.factorySource, terms = draft.terms;
    const deployment = { ...f, eventId: draft.eventId, contract, deploymentTxHash: txHash, deploymentBlock: receipt.blockNumber,
      owner: draft.wallet, creator: draft.wallet, eventName: terms.title, depositWei: terms.depositWei, eventStart: terms.eventStart,
      claimDeadline: terms.claimDeadline, depositOpensAt: receiptHeader.timestamp,
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
