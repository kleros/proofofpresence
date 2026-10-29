import { productionContextIssue, isVerifiedV9Upgrade } from "./environment.js";
import { PRODUCTION_CONTRACT_VERSION } from "./contract-profiles.js";
import { knownAttendanceStandard } from "./luma-launch.js";
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const address = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-f]{40}$/i.test(value) &&
  !/^0x0{40}$/i.test(value);
const sha = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
const bytes32 = (value) =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const text = (value, max = 2000) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const id = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const must = (condition, message) => {
  if (!condition) throw new Error(message);
};
export function lumaEventUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      url.hostname === "luma.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname !== "/"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function depositWei(value) {
  must(
    typeof value === "string" && /^\d+(?:\.\d{1,18})?$/.test(value),
    "Enter an ETH amount with at most 18 decimal places.",
  );
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  must(
    amount > 0n && amount < 1n << 256n,
    "The event deposit must be a positive exact ETH amount.",
  );
  return amount.toString();
}
export function factorySetupIssue(bootstrap, { requireWallet = false } = {}) {
  const issue = productionContextIssue(bootstrap, null, {
    requireWallet,
    requireTransactions: false,
  });
  if (issue) return issue;
  const setup = bootstrap.organizerSetup,
    factory = bootstrap.factory;
  if (setup?.policyStatus !== "verified")
    return "Event creation is unavailable until the event policy is published and verified.";
  if (!knownAttendanceStandard(setup.attendanceStandard))
    return "The verified attendance standard is missing or unsupported. Event creation is unavailable.";
  if (
    !text(setup.policyURI) ||
    !sha(setup.policySha256) ||
    setup.challengeWindowSeconds !== 86400 ||
    setup.matchWindowSeconds !== 86400 ||
    setup.minimumClaimDays !== 7
  )
    return "Verified event policy and immutable terms are unavailable.";
  if (
    bootstrap.capabilities.lumaDepositPortal !== true ||
    bootstrap.capabilities.walletFirstDeposits !== true ||
    bootstrap.capabilities.createEvents !== true
  )
    return "This environment does not currently permit event creation.";
  if (
    factory?.chainId !== 1 ||
    !address(factory.address) ||
    factory.contractVersion !== PRODUCTION_CONTRACT_VERSION ||
    factory.abiVersion !== PRODUCTION_CONTRACT_VERSION ||
    factory.verified !== true ||
    factory.deploymentTrust?.status !== "verified" ||
    !isVerifiedV9Upgrade(factory.upgrade)
  )
    return "The event factory could not be verified. New event creation is unavailable.";
  return null;
}
// These facts scope known-hash receipt reads even when current factory trust is unavailable.
export function factoryReadScope(bootstrap) {
  must(
    bootstrap?.mode === "hosted-production" &&
      bootstrap.chain?.chainId === 1 &&
      bootstrap.session?.mode === "wallet" &&
      address(bootstrap.session.wallet) &&
      text(bootstrap.instanceId, 200) &&
      address(bootstrap.factory?.address) &&
      bootstrap.factory.abiVersion === PRODUCTION_CONTRACT_VERSION,
    "Authenticate the original factory wallet and environment to check this transaction.",
  );
  return Object.freeze({
    wallet: bootstrap.session.wallet,
    chainId: 1,
    contract: bootstrap.factory.address,
    abiVersion: PRODUCTION_CONTRACT_VERSION,
    mode: "hosted-production",
    instanceId: bootstrap.instanceId,
  });
}
export function creationContext(bootstrap, draft) {
  const scope = factoryReadScope(bootstrap);
  must(id(draft?.eventId), "The event draft has no stable event identity.");
  return Object.freeze({ ...scope, eventId: draft.eventId });
}
export function assertCreationDraft(
  draft,
  bootstrap,
  input = null,
  now = Date.now(),
) {
  const issue = factorySetupIssue(bootstrap, { requireWallet: true });
  must(!issue, issue);
  const context = creationContext(bootstrap, draft),
    tx = draft.transaction,
    terms = draft.terms;
  must(
    id(draft.id) &&
      bytes32(draft.eventKey) &&
      draft.method === "createEvent" &&
      draft.action === "createEvent" &&
      same(draft.wallet, context.wallet) &&
      same(draft.contract, context.contract) &&
      draft.chainId === 1 &&
      draft.abiVersion === context.abiVersion &&
      draft.contractVersion === PRODUCTION_CONTRACT_VERSION &&
      draft.mode === context.mode &&
      draft.instanceId === context.instanceId &&
      text(draft.sessionId, 200),
    "The factory draft does not match this authenticated environment.",
  );
  must(
    integer(draft.createdAt) &&
      integer(draft.expiresAt) &&
      draft.expiresAt > draft.createdAt &&
      draft.expiresAt > now &&
      draft.createdAt <= now + 30000 &&
      integer(draft.reviewBlock) &&
      sha(draft.factoryFingerprint) &&
      sha(draft.snapshot),
    "The factory review expired or has incomplete verification facts.",
  );
  must(
    tx &&
      same(tx.from, context.wallet) &&
      same(tx.to, context.contract) &&
      Number(tx.chainId) === 1 &&
      /^(?:0x)?0+$/.test(String(tx.value)) &&
      /^(?:0x)?0+$/.test(String(draft.valueWei)) &&
      typeof tx.data === "string" &&
      /^0x(?:[0-9a-f]{2}){4,}$/i.test(tx.data) &&
      /^[0-9]+$/.test(String(tx.gasLimit)) &&
      BigInt(tx.gasLimit) > 0n &&
      Array.isArray(draft.args) &&
      draft.args.length > 0,
    "The reviewed factory transaction is incomplete or differs from event creation.",
  );
  must(
    terms &&
      text(terms.title, 120) &&
      lumaEventUrl(terms.lumaUrl) &&
      text(terms.timezone, 100) &&
      Number.isFinite(Date.parse(terms.startsAt)) &&
      Date.parse(terms.endsAt) > Date.parse(terms.startsAt) &&
      String(terms.depositWei) === depositWei(terms.depositEth) &&
      terms.capacity === 150 &&
      terms.claimDays === 7 &&
      terms.challengeWindowSeconds === 86400 &&
      terms.matchWindowSeconds === 86400 &&
      integer(terms.eventStart) &&
      terms.eventStart === Date.parse(terms.startsAt) / 1000 &&
      integer(terms.claimDeadline) &&
      terms.claimDeadline >= terms.eventStart + 7 * 86400 &&
      terms.policyURI === bootstrap.organizerSetup.policyURI &&
      same(terms.policySha256, bootstrap.organizerSetup.policySha256),
    "The immutable event terms do not match the verified policy.",
  );
  must(
    knownAttendanceStandard(terms.attendanceStandard) &&
      ["attendanceMode", "attendanceRule", "evidenceRule"].every(
        (field) =>
          terms.attendanceStandard[field] ===
          bootstrap.organizerSetup.attendanceStandard[field],
      ),
    "The event attendance standard differs from the verified policy. Prepare a fresh event review.",
  );
  if (input)
    must(
      terms.title === input.title &&
        lumaEventUrl(terms.lumaUrl) === input.lumaUrl &&
        terms.timezone === input.timezone &&
        Date.parse(terms.startsAt) === Date.parse(input.startsAt) &&
        Date.parse(terms.endsAt) === Date.parse(input.endsAt) &&
        terms.depositWei === depositWei(input.depositEth),
      "The returned event terms differ from the form you reviewed.",
    );
  return draft;
}
export function assertCreationValidation(response, reviewed, bootstrap) {
  const fresh = assertCreationDraft(response?.draft, bootstrap);
  must(
    fresh.id === reviewed.id &&
      fresh.eventId === reviewed.eventId &&
      fresh.eventKey === reviewed.eventKey &&
      fresh.factoryFingerprint === reviewed.factoryFingerprint &&
      fresh.snapshot === reviewed.snapshot &&
      JSON.stringify(fresh.terms) === JSON.stringify(reviewed.terms) &&
      JSON.stringify(fresh.args) === JSON.stringify(reviewed.args),
    "The factory or reviewed terms changed. Prepare a fresh event review.",
  );
  must(
    response.transaction &&
      same(response.transaction.to, fresh.transaction.to) &&
      same(response.transaction.from, fresh.transaction.from) &&
      response.transaction.data === fresh.transaction.data &&
      String(response.transaction.value) === String(fresh.transaction.value) &&
      Number(response.transaction.chainId) === 1,
    "The validated transaction differs from the displayed factory review.",
  );
  return response.transaction;
}
export function canonicalParticipantUrl(value, eventId, origin) {
  try {
    const url = new URL(value, origin),
      keys = [...new URLSearchParams(url.hash.slice(1)).keys()],
      params = new URLSearchParams(url.hash.slice(1));
    return url.origin === origin &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      keys.length === 2 &&
      keys.includes("event") &&
      keys.includes("view") &&
      params.get("event") === eventId &&
      params.get("view") === "participant"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function assertCreationReceipt(result, context, hash, origin) {
  must(
    result &&
      ["pending", "failed", "confirmed"].includes(result.status) &&
      same(result.hash, hash) &&
      result.eventId === context.eventId &&
      (result.chainId === undefined || result.chainId === 1) &&
      (result.wallet === undefined || same(result.wallet, context.wallet)),
    "The transaction status does not match the original event creation.",
  );
  if (result.status === "pending") return result;
  must(
    result.chainId === 1 &&
      same(result.wallet, context.wallet) &&
      integer(result.blockNumber),
    "The canonical receipt context is incomplete.",
  );
  if (result.status === "failed") return result;
  const participantUrl = canonicalParticipantUrl(
    result.participantUrl,
    context.eventId,
    origin,
  );
  must(
    address(result.contract) &&
      !same(result.contract, context.contract) &&
      participantUrl,
    "The event receipt is not yet canonically onboarded. Keep the transaction reference and check again.",
  );
  return { ...result, participantUrl };
}
