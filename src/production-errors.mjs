// @ts-check

// These are public semantics, not diagnostic text. Never interpolate a thrown
// message, provider shortMessage, URL, signature or request into a production reply.
/** @type {Map<string, {status: number, message: string, alternatives?: number[]}>} */
const responses = new Map();

/** @param {number} status @param {string} message @param {string[]} codes @param {number[]} [alternatives] */
function define(status, message, codes, alternatives) {
  for (const code of codes)
    responses.set(code, { status, message, alternatives });
}

define(401, "Sign in with your wallet before continuing.", ["UNAUTHENTICATED"]);
define(403, "The sign-in request expired or is invalid. Authenticate again.", [
  "BAD_NONCE",
]);
define(403, "Wallet ownership could not be verified. Authenticate again.", [
  "BAD_SIGNATURE",
]);
define(403, "You do not have permission to perform this action.", [
  "FORBIDDEN",
]);
define(
  403,
  "Only this event's current contract owner can perform this action.",
  ["NOT_OWNER"],
);
define(403, "This action requires current staff access to this event.", [
  "NOT_STAFF",
]);
define(403, "A signed wallet session is required.", ["WALLET_REQUIRED"]);
define(
  403,
  "Review and sign this transaction in your browser wallet.",
  ["WALLET_SIGNATURE_REQUIRED"],
  [403, 409],
);
define(422, "Use a valid Ethereum wallet address.", ["INVALID_WALLET"]);
define(
  422,
  "This production app supports wallets without deployed code. Contract wallets and delegated wallets are unsupported.",
  ["UNSUPPORTED_WALLET"],
);
define(
  503,
  "Wallet compatibility could not be checked. Try again with a fresh chain read.",
  ["WALLET_RPC_UNAVAILABLE"],
);
define(
  409,
  "The chain changed during the wallet check. Request a fresh check.",
  ["WALLET_REORG"],
);

define(403, "This request is not allowed from the current origin.", [
  "BAD_ORIGIN",
]);
define(403, "This request is not allowed on the current host.", ["BAD_HOST"]);
define(403, "Use the configured application gateway for this request.", [
  "PROXY_REQUIRED",
]);
define(415, "Use the required content type for this request.", [
  "BAD_CONTENT_TYPE",
]);
define(413, "The request is too large.", ["TOO_LARGE"]);
define(404, "The requested resource was not found or is unavailable.", [
  "NOT_FOUND",
  "ORGANIZER_JOB_NOT_FOUND",
]);
define(409, "This check belongs to different event terms. Preserve the original check.", ["ORGANIZER_JOB_CONFLICT"]);
define(409, "An organizer check is already running. Check its status before starting another.", ["ORGANIZER_JOB_BUSY"]);
define(503, "Organizer checks are at capacity. Keep your form and try again later.", ["ORGANIZER_JOB_CAPACITY"]);
define(403, "This RPC operation is not permitted.", [
  "RPC_METHOD_FORBIDDEN",
  "RPC_TRANSACTION_FORBIDDEN",
]);
define(403, "This demonstration operation is unavailable in production.", [
  "DEMO_ONLY",
  "TESTNET_FAUCET",
  "TESTNET_TIME",
]);

define(409, "The deployment identity changed or could not be verified.", [
  "DEPLOYMENT_MISMATCH",
  "WRONG_CONTRACT",
  "WRONG_FACTORY",
]);
define(409, "The deployment block changed. Request a fresh verification.", [
  "DEPLOYMENT_REORG",
]);
define(
  409,
  "The deployment's upgrade trust changed. Verify it before reviewing a new transaction.",
  ["UPGRADE_TRUST_MISMATCH"],
);
define(
  409,
  "The chain does not match the configured deployment.",
  ["WRONG_CHAIN"],
  [400, 409],
);
define(400, "This contract or ABI version is unsupported.", [
  "UNKNOWN_VERSION",
]);
define(409, "This action is unavailable for the configured contract version.", [
  "WRONG_VERSION",
]);
define(409, "Refresh the event and review a new transaction before signing.", [
  "STALE_DRAFT",
]);
define(
  409,
  "This transaction review does not belong to the current wallet and event.",
  ["DRAFT_SCOPE"],
);
define(
  409,
  "This review already has a submitted transaction. Check its existing hash.",
  ["SUBMITTED_DRAFT"],
);
define(409, "The transaction does not match the reviewed terms.", [
  "TX_MISMATCH",
]);
define(409, "The transaction predates the reviewed snapshot.", [
  "TX_PREDATES_REVIEW",
]);
define(
  409,
  "The transaction receipt changed. Verify the existing hash again.",
  ["TX_REORG"],
);
define(
  409,
  "The transaction failed. Inspect its existing hash before proceeding.",
  ["TX_FAILED"],
);
define(409, "This transaction is already recorded. Check its existing hash.", [
  "DUPLICATE_TRANSACTION",
]);
define(
  409,
  "Another event action is in progress. Check its status before continuing.",
  ["BUSY"],
);
define(
  409,
  "The contract could not confirm this action in its current state. Refresh and review again.",
  ["SIMULATION_FAILED"],
);
define(
  409,
  "Appeal rewards are not ready. Wait for delivered resolver finality.",
  ["REWARDS_NOT_READY"],
);
define(409, "This case is not ready for the requested action.", [
  "NOT_MATCHED_CASE",
]);
define(409, "The event's immutable Luma terms cannot be edited.", ["IMMUTABLE_EVENT_TERMS"]);
define(409, "The reviewed factory is unavailable. Preserve any existing creation hash.", ["FACTORY_UNAVAILABLE", "FACTORY_CHANGED"]);
define(409, "A verified published policy is required before creating an event.", ["POLICY_UNPUBLISHED", "POLICY_UNAVAILABLE"]);
define(400, "Review and approve the exact case file and scope before publishing.", ["PUBLICATION_NOT_APPROVED"]);
define(400, "The case export or its scope is invalid. Request a fresh export.", [
  "INVALID_CASE_SCOPE", "INVALID_CASE_CONTENT", "INVALID_CASE_ARTIFACT",
]);
define(409, "The original case bytes or canonical provenance changed. Preserve the export for review.", [
  "CASE_CID_MISMATCH", "CASE_ARTIFACT_CHANGED", "CASE_PUBLICATION_CHANGED", "PUBLICATION_RECORD_CHANGED",
]);
define(409, "This case already has a publication attempt. Verify the existing file without uploading again.", [
  "PUBLICATION_ALREADY_CLAIMED", "PUBLICATION_INTENT_IMMUTABLE",
]);
define(503, "Publication storage is unavailable. Preserve the existing attempt and use read-only verification.", [
  "PUBLICATION_STORAGE_UNAVAILABLE", "PUBLICATION_INTENT_FAILED", "PUBLICATION_INTENT_REQUIRED",
]);
define(409, "Another state save is in progress. Preserve the current request and check its status.", ["STATE_BUSY"]);
define(409, "The requested amount exceeds the available pending credit.", [
  "INSUFFICIENT_CREDIT",
]);

define(409, "The selected event changed. Refresh before continuing.", [
  "SELECTED_EVENT_ACCESS_CHANGED",
  "SELECTED_EVENT_REORG",
]);
define(401, "The wallet session changed. Authenticate again.", [
  "SELECTED_EVENT_SESSION_CHANGED",
]);
define(503, "The selected event is temporarily unavailable. Try again later.", [
  "SELECTED_EVENT_UNAVAILABLE",
]);
define(
  409,
  "The deposit is not yet confirmed for this event. Verify its existing hash.",
  ["DEPOSIT_UNCONFIRMED"],
);
define(409, "The deposit receipt changed. Verify its existing hash again.", [
  "DEPOSIT_REORG",
]);
define(
  409,
  "This deposit does not match the event's required wallet and amount.",
  ["WRONG_DEPOSIT", "SHORT_DEPOSIT"],
);
define(409, "This deposit was returned or recovered and cannot be reused.", [
  "RETURNED_DEPOSIT",
]);
define(409, "The deposit is outside this event's deposit window.", [
  "OUTSIDE_DEPOSIT_WINDOW",
]);
define(409, "Review the existing deposit before making another deposit.", [
  "PENDING_DEPOSIT",
  "DUPLICATE_DEPOSIT",
]);
define(409, "Deposit history could not be verified against the contract.", [
  "CREDIT_HISTORY",
]);
define(403, "A verified current deposit is required before admission.", [
  "UNVERIFIED_STAKER",
]);
define(409, "Resolve the selected admission records before continuing.", [
  "UNRESOLVED_ADMISSION",
]);
define(400, "No eligible attendees are available for this action.", [
  "NO_ATTENDEES",
]);
define(400, "Verify attendance before continuing.", ["UNVERIFIED_ATTENDANCE"]);
define(
  409,
  "Payment facts could not be verified against the canonical contract state.",
  [
    "PAYMENT_SNAPSHOT",
    "PAYMENT_RECEIPT",
    "PAYMENT_REORG",
    "PAYMENT_ACCOUNTING",
  ],
);

define(
  400,
  "The request is invalid. Review the supplied fields and try again.",
  ["INVALID_INPUT", "INVALID_BATCH", "INVALID_CSV", "INVALID_V8_PARAMETERS"],
);
define(400, "This action is unsupported.", ["UNKNOWN_ACTION"]);
define(400, "A verified linked participant is required for this action.", [
  "UNKNOWN_IDENTITY",
]);
define(400, "This attendance source is not trusted.", ["UNTRUSTED_SOURCE"]);
define(
  409,
  "The selected identity does not match the verified record.",
  ["IDENTITY_MISMATCH"],
  [400, 409],
);
define(
  409,
  "The attendance observation is outside the allowed event hours.",
  ["ATTENDANCE_TIME_MISMATCH"],
  [400, 409],
);
define(409, "This identity or evidence is already recorded.", [
  "DUPLICATE_IDENTITY",
  "DUPLICATE_EVIDENCE",
  "DUPLICATE_CHECKIN",
]);
define(409, "The reviewed records changed. Prepare a new preview.", [
  "STALE_BATCH",
  "STALE_IMPORT",
  "STALE_IMPORT_PREVIEW",
  "IMPORT_PREVIEW_EXPIRED",
]);
define(
  409,
  "This preview does not belong to the current event, wallet or session.",
  ["BATCH_SCOPE", "IMPORT_PREVIEW_SCOPE"],
);
define(
  409,
  "A save is already in progress. Check its status before continuing.",
  ["BATCH_IN_PROGRESS", "IMPORT_PREVIEW_BUSY"],
);
define(
  429,
  "Too many batch reviews are pending. Wait before preparing another.",
  ["BATCH_LIMIT"],
);
define(409, "This request was already processed. Check the existing result.", [
  "REPLAY",
  "IMPORT_PREVIEW_USED",
  "DUPLICATE_IMPORT",
]);
define(404, "The import preview was not found. Prepare a fresh preview.", [
  "IMPORT_PREVIEW_NOT_FOUND",
]);
define(409, "Review the source provenance before saving this import.", [
  "PROVENANCE_REVIEW_REQUIRED",
]);
define(
  409,
  "The imported event, contract or chain does not match this event.",
  ["EVENT_MISMATCH", "CONTRACT_MISMATCH", "CHAIN_MISMATCH"],
);
define(
  409,
  "The deposit inbox could not be verified. Refresh before continuing.",
  [
    "INBOX_RECEIPT",
    "INBOX_REORG",
    "INBOX_HISTORY_LIMIT",
    "INBOX_LIMIT",
    "INBOX_ACCOUNTING",
    "INBOX_CHAIN",
  ],
);
define(
  503,
  "The deposit inbox is temporarily unavailable. No current owner data was disclosed.",
  ["INBOX_TIMEOUT", "INBOX_UNAVAILABLE", "INBOX_OWNER_UNAVAILABLE"],
);

/** Read only own data properties; hostile getters and prototypes are not diagnostics. @param {unknown} error @param {string} key */
function ownValue(error, key) {
  if (!error || typeof error !== "object") return undefined;
  try {
    return Object.getOwnPropertyDescriptor(error, key)?.value;
  } catch {
    return undefined;
  }
}

/**
 * Format only the production API error response. Diagnostic details must remain
 * outside this DTO. Other environments retain their existing formatting policy.
 * @param {unknown} error
 * @returns {{status: number, body: {error: string, code: string}}}
 */
export function productionErrorResponse(error) {
  const code = ownValue(error, "code");
  const entry = typeof code === "string" ? responses.get(code) : undefined;
  if (!entry)
    return {
      status: 503,
      body: {
        error: "The service is temporarily unavailable. Try again later.",
        code: "SERVICE_UNAVAILABLE",
      },
    };
  const candidate = entry.alternatives ? ownValue(error, "status") : undefined;
  const status = entry.alternatives?.includes(candidate)
    ? candidate
    : entry.status;
  return { status, body: { error: entry.message, code } };
}
