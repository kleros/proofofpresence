// V10 owner curation only. Canonical payer attribution never establishes a Luma identity.
import { ethers } from "ethers";
import { hash, id, lower, requireThat, text } from "./utils.mjs";
import { readJobSignal } from "./read-job-scope.mjs";
import { FIRST_EVENT_MANAGE_SCOPE, firstEventManageMatches } from "./first-event-manage-scope.mjs";

const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const check = (condition, message, code = "INVALID_MANAGE_REVIEW", status = 400) => requireThat(condition, message, code, status);
export const CANONICAL_PAYER_SOURCE = "owner-reviewed-canonical-payer";

export function bindManualAttendanceReview(record, session, params) {
  check(exact(params, ["attendedWallets", "attendanceReview"]) &&
    exact(params.attendanceReview, ["confirmed", "note"]) && params.attendanceReview.confirmed === true,
    "Explicitly confirm your exact selected-wallet attendance review.");
  const note = text(params.attendanceReview.note, 1000, 8);
  return { attendedWallets: structuredClone(params.attendedWallets), attendanceReview: {
    confirmed: true, note, attestedAt: Date.now(), actorWallet: session.wallet,
    interval: { startsAt: record.definition.startsAt, endsAt: record.definition.endsAt, timezone: record.definition.timezone },
  } };
}

export function manualAttendanceWallets(record, state, params) {
  check(exact(params, ["attendedWallets", "attendanceReview"]), "Review the exact attended wallets and organizer confirmation.");
  const review = params.attendanceReview;
  check(exact(review, ["confirmed", "note", "attestedAt", "actorWallet", "interval"]) && review.confirmed === true &&
    Number.isSafeInteger(review.attestedAt) && review.attestedAt > 0 && review.attestedAt <= Date.now() &&
    lower(review.actorWallet) === lower(state.owner) &&
    hash(review.interval) === hash({ startsAt: record.definition.startsAt, endsAt: record.definition.endsAt, timezone: record.definition.timezone }),
    "Explicitly confirm your organizer attendance review.");
  text(review.note, 1000, 8);
  const end = Date.parse(record.definition.endsAt) / 1000;
  check(Number.isSafeInteger(end) && Number.isFinite(state.now) && state.now >= end,
    "Review actual attendance after this event's immutable interval ends.", "ATTENDANCE_INTERVAL_OPEN", 409);
  const wallets = params.attendedWallets;
  check(Array.isArray(wallets) && wallets.length > 0 && wallets.length <= 150 &&
    wallets.every(wallet => ethers.isAddress(wallet) && BigInt(wallet) !== 0n) &&
    new Set(wallets.map(lower)).size === wallets.length,
    "Select 1–150 unique actual attendee wallets.");
  check(wallets.every(wallet => state.activeStakers.some(active => lower(active) === lower(wallet))),
    "Every selected attendee must already be registered in this event's contract.", "ATTENDEE_NOT_REGISTERED", 409);
  return wallets.map(ethers.getAddress);
}

export function createPayerAdoptionService(workbench, scope = FIRST_EVENT_MANAGE_SCOPE) {
  const active = new Set();
  return async function adoptPayer(eventId, session, input, assertSession = () => {}) {
    check(exact(input, ["wallet", "txHash", "confirmed", "note"]) && input.confirmed === true &&
      ethers.isAddress(input.wallet) && BigInt(input.wallet) !== 0n &&
      typeof input.txHash === "string" && /^0x[0-9a-f]{64}$/i.test(input.txHash),
      "Review the exact canonical payer wallet, original deposit receipt and confirmation.");
    const note = text(input.note, 1000, 8), wallet = ethers.getAddress(input.wallet), txHash = input.txHash.toLowerCase();
    const record = await workbench.owner(eventId, session);
    check(record.deployment.contractVersion === "kleros-event-v10-uups" && record.deployment.chainId === 1 &&
      firstEventManageMatches(record, scope),
      "This organizer review is available only for the first reviewed Truth Pays event.", "FIRST_EVENT_SCOPE", 404);
    check(!active.has(eventId), "Another payer review is being saved. Refresh its current status.", "MANAGE_BUSY", 409);
    active.add(eventId);
    try {
      const revision = record.revision, deploymentHash = hash(record.deployment);
      const matches = [...record.participants.values()].filter(person => lower(person.wallet) === lower(wallet));
      check(matches.length <= 1, "This wallet has conflicting event records.", "PAYER_LINK_CONFLICT", 409);
      const existing = matches[0];
      check(!existing || existing.eventId === eventId, "The payer record belongs to another event.", "EVENT_MISMATCH", 409);
      check(!existing?.deposit || lower(existing.deposit.txHash) === txHash,
        "Preserve the original linked deposit receipt. Review that transaction instead.", "PAYER_RECEIPT_CONFLICT", 409);
      const person = existing ?? { id: id(), eventId, wallet, name: null, email: null,
        walletVerified: false, payerVerified: true, identityVerified: false,
        identitySource: CANONICAL_PAYER_SOURCE, lumaIdentity: null, admission: "pending", deposit: null };
      const evidence = await workbench.verifyReceipt(eventId, person, txHash, true);
      // The same authoritative receipt verifier excludes recovered/refunded credit and
      // requires this payer's full pending collateral or registered commitment.
      await workbench.owner(eventId, session);
      const state = await workbench.state(eventId, { includeBlockHash: true }), contract = workbench.contract(eventId), at = { blockTag: state.blockNumber };
      const [credit, status, receiptBlock, closing] = await Promise.all([
        contract.pendingDeposits(wallet, at), contract.status(wallet, at),
        workbench.provider.getBlock(evidence.blockNumber), workbench.provider.getBlock(state.blockNumber),
      ]);
      check(lower(state.owner) === lower(session.wallet) && closing?.hash === state.blockHash &&
        receiptBlock?.hash === evidence.blockHash &&
        (credit >= BigInt(record.deployment.depositWei) || [1, 2].includes(Number(status))),
        "The payer's current credit, receipt or owner changed. Refresh before adoption.", "PAYER_CREDIT_CHANGED", 409);
      assertSession();
      readJobSignal()?.throwIfAborted();
      check(record.revision === revision && hash(record.deployment) === deploymentHash &&
        workbench.record(eventId, session) === record,
        "Event or payer records changed during review. Refresh and review again.", "STALE_MANAGE_REVIEW", 409);
      if (existing?.payerReview && existing.deposit && lower(existing.deposit.txHash) === txHash)
        return { kind: "owner-reviewed-payer", eventId, chainId: 1, contract: record.deployment.contract,
          participantId: existing.id, wallet, deposit: evidence, review: structuredClone(existing.payerReview), replayed: true };
      const review = { id: id(), kind: "canonical-payer-attribution", eventId, chainId: 1,
        contract: record.deployment.contract, wallet, txHash,
        receiptBlock: evidence.blockNumber, receiptBlockHash: evidence.blockHash,
        actorWallet: session.wallet, recordedAt: new Date().toISOString(), note,
        identityNotice: "Canonical payer only; no Luma identity or contact verification." };
      const adopted = { ...person, deposit: evidence, payerReview: review };
      if (!existing) adopted.payerVerified = true;
      record.participants.set(adopted.id, adopted);
      record.revision++;
      try { await workbench.persist(); }
      catch (error) {
        if (record.revision === revision + 1 && record.participants.get(adopted.id) === adopted) {
          if (existing) record.participants.set(existing.id, existing); else record.participants.delete(adopted.id);
          record.revision = revision;
        }
        throw error;
      }
      return { kind: "owner-reviewed-payer", eventId, chainId: 1, contract: record.deployment.contract,
        participantId: adopted.id, wallet, deposit: evidence, review: structuredClone(review), replayed: false };
    } finally { active.delete(eventId); }
  };
}
