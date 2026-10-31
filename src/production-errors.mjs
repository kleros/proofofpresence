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
define(404, "This transaction flow expired. Keep your original transaction ID.", ["PUBLIC_FLOW_NOT_FOUND"]);
define(403, "This wallet connection cannot access that event or action.", ["PUBLIC_FLOW_SCOPE"]);
define(409, "Keep the original review and transaction ID for this wallet request.", ["PUBLIC_FLOW_CONFLICT"]);
define(409, "This wallet's deposit is already fully funded.", ["CREDIT_AVAILABLE"]);
define(409, "This event was replaced. Its original receipts and unused credit remain on its original recovery page. Open the current event before making a new deposit.", ["EVENT_REPLACED"]);
define(422, "This wallet needs enough native ETH on Ethereum Mainnet for the deposit plus the network fee. ETH on another network cannot fund this transaction.", ["INSUFFICIENT_ETH"]);
define(409, "The event contract reverted during the exact deposit simulation. No transaction was requested. Check the current event state before trying again.", ["DEPOSIT_SIMULATION_REVERTED"]);
define(503, "The Ethereum deposit simulation service is unavailable. No transaction was requested. Try again later.", ["DEPOSIT_SIMULATION_UNAVAILABLE"]);
define(503, "The Ethereum deposit simulation returned an invalid reply. No transaction was requested. Try again later.", ["DEPOSIT_SIMULATION_INVALID_REPLY"]);
define(409, "This wallet is already registered for the event.", ["ALREADY_REGISTERED"]);
define(409, "This wallet's registration was rejected. Unused credit can be recovered.", ["REGISTRATION_REJECTED"]);
define(503, "Transaction preparation is busy. Try again shortly.", ["PUBLIC_FLOW_CAPACITY"]);
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
  "This read-only session can inspect only its original event creation. Sign out before using other wallet actions.",
  ["RECOVERY_ONLY"],
);
define(
  409,
  "The original creation or its saved review changed. Preserve its transaction ID for review.",
  ["RECOVERY_SCOPE", "RECOVERY_REVIEW_CHANGED"],
);
define(
  401,
  "The read-only recovery session changed. Sign in again to inspect the original transaction.",
  ["RECOVERY_SESSION_CHANGED"],
);
define(
  404,
  "No matching saved creation is available for this wallet and transaction.",
  ["CREATION_RECOVERY_NOT_FOUND"],
);
define(403, "This recovery session does not match the original creation.", [
  "CREATION_RECOVERY_SCOPE",
]);
define(
  409,
  "The original transaction differs from its saved review. Preserve its transaction ID for review.",
  ["CREATION_RECOVERY_MISMATCH"],
);
define(
  409,
  "The original creation receipt changed. Check its existing transaction ID again.",
  ["CREATION_RECOVERY_REORG"],
);
define(
  503,
  "The original creation could not be checked. Preserve its transaction ID and check again later.",
  ["CREATION_RECOVERY_UNAVAILABLE"],
);

define(
  403,
  "Review and sign this transaction in your browser wallet.",
  ["WALLET_SIGNATURE_REQUIRED"],
  [403, 409],
);
define(422, "Use a valid Ethereum wallet address.", ["INVALID_WALLET"]);
define(409, "The fee replacement is not confirmed yet. Keep both transaction IDs and check again.", ["REPLACEMENT_UNCONFIRMED", "REPLACEMENT_NONCE_NOT_CONSUMED"]);
define(409, "The replacement does not match the saved original call. Keep both transaction IDs for review.", [
  "REPLACEMENT_SCOPE", "REPLACEMENT_MISMATCH", "REPLACEMENT_ORIGINAL_CHANGED", "REPLACEMENT_WRONG_CHAIN",
  "V10_FACTORY_SUBMISSION_CHANGED", "V10_FACTORY_SUBMISSION_UNSEALED", "V10_FACTORY_REPLACEMENT_CHANGED",
  "V10_FACTORY_REPLACEMENT_UNSEALED", "V10_FACTORY_REPLACEMENT_MISMATCH",
]);
define(422, "Use a valid same-call fee-replacement transaction ID.", ["REPLACEMENT_INPUT"]);
define(409, "The original nonce was not retained. Preserve both transaction IDs for review.", ["REPLACEMENT_ORIGINAL_UNAVAILABLE"]);
define(409, "The original creation already has a receipt. Check its original transaction ID.", ["REPLACEMENT_ORIGINAL_CONFIRMED"]);
define(409, "The replacement receipt changed. Preserve both IDs and request a fresh check.", ["REPLACEMENT_REORG"]);
define(409, "The replacement transaction failed. Preserve both transaction IDs for review.", ["REPLACEMENT_REVERTED"]);
define(422, "The replacement used an unsupported wallet execution profile. Preserve both IDs for review.", ["REPLACEMENT_WALLET_PROFILE"]);
define(503, "The fee replacement could not be checked. Keep both transaction IDs and check again later.", ["REPLACEMENT_UNAVAILABLE"]);
define(
  422,
  "This wallet is outside the account profiles supported by this application.",
  ["UNSUPPORTED_WALLET"],
);
define(
  409,
  "The original wallet submission must be recorded first; the saved review is preserved.",
  ["ORIGINAL_HASH_NOT_RECORDED"],
);
define(
  503,
  "Wallet compatibility could not be checked. Try again with a fresh chain read.",
  ["V10_WALLET_UNAVAILABLE"],
);
define(
  409,
  "The original transaction is not confirmed yet. Preserve its existing transaction ID.",
  ["V10_TRANSACTION_UNCONFIRMED"],
);
define(
  409,
  "The chain or account changed during verification. Preserve the original transaction ID and check again.",
  ["V10_WALLET_REORG", "V10_TRANSACTION_REORG", "V10_WALLET_FRAMEWORK_CHANGED"],
);
define(
  409,
  "Your wallet requested permissions this app cannot verify. Keep any submitted transaction ID and check it before paying again.",
  ["V10_PERMISSION_UNSUPPORTED"],
);
define(
  409,
  "The transaction does not match its original saved V10 review or supported account profile.",
  [
    "V10_WALLET_SCOPE",
    "V10_WALLET_EVIDENCE",
    "V10_TRANSACTION_CODEC",
    "V10_INTENT_MISMATCH",
    "V10_RECEIPT_CONTEXT_SCOPE",
    "V10_RECEIPT_CONTEXT_CHANGED",
    "V10_RECEIPT_CONTEXT_UNSEALED",
    "V10_RECEIPT_CONTEXT_MISMATCH",
    "V10_RECEIPT_CONTEXT_UNKNOWN_HASH",
    "V10_RECEIPT_CONTEXT_PROOF",
    "V10_RECEIPT_CONTEXT_AMBIGUOUS",
    "V10_RECEIPT_CONTEXT_MUTATED",
  ],
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
define(404, "This event check is unavailable for the current session.", ["EVENT_READ_JOB_NOT_FOUND"]);
define(409, "This check belongs to different event terms. Preserve the original check.", ["EVENT_READ_JOB_CONFLICT"]);
define(409, "An event check is still running. Wait for its status before starting another.", ["EVENT_READ_JOB_BUSY"]);
define(503, "Event checks are at capacity. Keep any submitted transaction IDs and check later.", ["EVENT_READ_JOB_CAPACITY"]);
define(404, "This organizer review is available only for the first reviewed Truth Pays event.", ["FIRST_EVENT_SCOPE"]);
define(400, "Review the exact selected wallets, confirmation and organizer note before continuing.", ["INVALID_MANAGE_REVIEW"]);
define(409, "Another payer review is being saved. Check its existing status before continuing.", ["MANAGE_BUSY"]);
define(409, "The payer has conflicting records or another original receipt. Preserve the existing link for review.", ["PAYER_LINK_CONFLICT", "PAYER_RECEIPT_CONFLICT"]);
define(409, "The current payer credit, receipt or owner changed. Refresh before reviewing again.", ["PAYER_CREDIT_CHANGED", "STALE_MANAGE_REVIEW"]);
define(409, "Review actual attendance after the immutable event interval ends.", ["ATTENDANCE_INTERVAL_OPEN"]);
define(409, "Every selected attendee needs approved canonical payer evidence and existing contract registration.", ["ATTENDEE_NOT_REGISTERED", "UNVERIFIED_ATTENDEE"]);
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
