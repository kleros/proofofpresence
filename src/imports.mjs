// @ts-check
import { parse } from "csv-parse/sync";
import { ethers } from "ethers";
import { hash, id, lower, requireThat, text } from "./utils.mjs";

export const IMPORT_PARSER_VERSION = "csv-v2";
export const IMPORT_ORIGIN_LIMITATION =
  "Origin is organizer-reviewed; neither a CSV label nor a hash authenticates Luma.";

/** Review is an origin attestation, never an override of hard validation failures. */
export function provenanceReview(review) {
  requireThat(
    review?.confirmed === true && text(review?.note ?? "", 1000).length >= 8,
    "Raw CSV origin cannot be verified. Organizer must review source event and record a provenance note; hashes identify bytes, not origin.",
    "PROVENANCE_REVIEW_REQUIRED",
    409,
  );
  return text(review.note, 1000);
}

/** Read-only validation shared by previews and the legacy direct import path. */
export async function validateImportCsv(
  workbench,
  eventId,
  session,
  input,
  { requireReview = true, expected = null } = {},
) {
  // Own primitive inputs before any RPC await; caller objects are not trusted storage.
  const kind = input?.kind;
  const sourceEventId = input?.sourceEventId;
  text(input?.csv, 512_000, 1);
  const csv = input.csv;
  const review = input?.review
    ? { confirmed: input.review.confirmed, note: input.review.note }
    : undefined;
  const record = await workbench.owner(eventId, session);
  requireThat(["attendance", "guests"].includes(kind), "Unknown import kind");
  let rows;
  try {
    rows = parse(csv, {
      columns: (headers) => {
        const normalized = headers.map((h) =>
          h
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_"),
        );
        requireThat(
          new Set(normalized).size === normalized.length,
          "Duplicate CSV headers",
        );
        return normalized;
      },
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 10_000,
    });
  } catch {
    throw Object.assign(new Error("Invalid CSV format"), {
      code: "INVALID_CSV",
    });
  }
  requireThat(
    rows.length > 0 && rows.length <= 500,
    "CSV must contain 1–500 rows",
  );
  const d = record.deployment;
  const startingRevision = record.revision;
  const configHash = hash(d);
  const startingState = await workbench.state(eventId);
  if (expected)
    requireThat(
      startingRevision === expected.revision &&
        configHash === expected.configHash &&
        startingState.fingerprint === expected.snapshot &&
        hash(csv) === expected.sourceHash,
      "The reviewed import changed; prepare a fresh preview",
      "STALE_IMPORT_PREVIEW",
      409,
    );
  const seenParticipants = new Set(),
    seenFinancial = new Set();
  const planned = [];
  // Validate every row before mutating anything. Review can never override a mismatch.
  requireThat(
    !sourceEventId || sourceEventId === eventId,
    "Source event conflicts with selected event",
    "EVENT_MISMATCH",
    409,
  );
  for (const [index, row] of rows.entries()) {
    for (const key of ["event_id", "eventid"])
      if (row[key])
        requireThat(
          [eventId, record.definition.lumaEventId]
            .filter(Boolean)
            .includes(row[key]),
          `Row ${index + 1}: wrong event`,
          "EVENT_MISMATCH",
          409,
        );
    for (const key of ["luma_event_id", "event_api_id"])
      if (row[key])
        requireThat(
          row[key] === record.definition.lumaEventId,
          `Row ${index + 1}: wrong Luma association`,
          "EVENT_MISMATCH",
          409,
        );
    for (const key of ["event_url", "luma_url"])
      if (row[key])
        requireThat(
          row[key] === record.definition.lumaUrl,
          `Row ${index + 1}: wrong Luma URL`,
          "EVENT_MISMATCH",
          409,
        );
    for (const key of ["contract", "contract_address"])
      if (row[key])
        requireThat(
          lower(row[key]) === lower(d.contract),
          `Row ${index + 1}: wrong contract`,
          "CONTRACT_MISMATCH",
          409,
        );
    for (const key of ["chain_id", "chainid"])
      if (row[key])
        requireThat(
          Number(row[key]) === d.chainId,
          `Row ${index + 1}: wrong chain`,
          "CHAIN_MISMATCH",
          409,
        );
    let participant = row.participant_id
      ? record.participants.get(row.participant_id)
      : null;
    if (row.participant_id)
      requireThat(
        participant,
        "Supplied participant ID does not belong to this event",
        "IDENTITY_MISMATCH",
        409,
      );
    if (!row.participant_id && row.email)
      participant = [...record.participants.values()].find(
        (p) => lower(p.email) === lower(row.email),
      );
    requireThat(
      participant && participant.identityVerified,
      `Row ${index + 1}: no linked verified participant`,
      "UNKNOWN_IDENTITY",
    );
    if (row.email)
      requireThat(
        lower(row.email) === lower(participant.email),
        `Row ${index + 1}: conflicting email`,
        "IDENTITY_MISMATCH",
      );
    for (const key of ["wallet", "eth_address", "ethereum_address"])
      if (row[key])
        requireThat(
          ethers.isAddress(row[key]) &&
            lower(row[key]) === lower(participant.wallet),
          `Row ${index + 1}: conflicting wallet`,
          "IDENTITY_MISMATCH",
        );
    requireThat(
      !seenParticipants.has(participant.id),
      `Row ${index + 1}: duplicate participant`,
      "DUPLICATE_IDENTITY",
      409,
    );
    seenParticipants.add(participant.id);
    let deposit;
    if (row.tx_hash) {
      const key = lower(row.tx_hash);
      requireThat(
        !seenFinancial.has(key),
        "Duplicate financial evidence",
        "DUPLICATE_EVIDENCE",
        409,
      );
      seenFinancial.add(key);
      deposit = await workbench.verifyReceipt(
        eventId,
        participant,
        row.tx_hash,
        true,
      );
      const reused = [...record.participants.values()].find(
        (p) => p.id !== participant.id && lower(p.deposit?.txHash) === key,
      );
      requireThat(
        !reused,
        "Financial evidence is already linked",
        "DUPLICATE_EVIDENCE",
        409,
      );
    }
    if (kind === "attendance") {
      // A personal history or merch field is deliberately never accepted here.
      requireThat(
        row.checked_in_at &&
          Number.isFinite(Date.parse(row.checked_in_at)) &&
          /(Z|[+-]\d\d:\d\d)$/.test(row.checked_in_at),
        `Row ${index + 1}: checked_in_at with timezone required`,
      );
      const ts = Date.parse(row.checked_in_at) / 1000;
      requireThat(
        ts <= startingState.now,
        "A future timestamp is not attendance evidence",
        "ATTENDANCE_TIME_MISMATCH",
      );
      requireThat(
        ts >= Date.parse(record.definition.startsAt) / 1000 &&
          ts <= Date.parse(record.definition.endsAt) / 1000,
        `Row ${index + 1}: check-in time is outside this event`,
        "ATTENDANCE_TIME_MISMATCH",
      );
      planned.push({ participant, timestamp: ts, row });
    } else {
      requireThat(
        ["approved", "declined", "pending", "free"].includes(row.admission),
        `Row ${index + 1}: invalid admission`,
      );
      planned.push({ participant, row, deposit });
    }
  }
  const reviewNote = requireReview ? provenanceReview(review) : null;
  const sourceHash = hash(csv);
  // Preserve duplicate protection for in-memory batches written by the old trimmed-hash parser.
  const legacySourceHash = hash(csv.trim());
  requireThat(
    !record.batches.some(
      (b) =>
        b.kind === kind &&
        (b.sourceHash === sourceHash ||
          (b.parserVersion === "csv-v1" && b.sourceHash === legacySourceHash)),
    ),
    "This exact import was already applied",
    "DUPLICATE_IMPORT",
    409,
  );
  const snapshot = await workbench.state(eventId);
  requireThat(
    record.revision === startingRevision &&
      snapshot.fingerprint === startingState.fingerprint &&
      hash(record.deployment) === configHash,
    "State changed during import review; retry with fresh authoritative data",
    "STALE_IMPORT",
    409,
  );
  const stakers = new Set(snapshot.stakers.map(lower));
  const proposedRows = planned.map((item, index) => {
    const participant = item.participant;
    const deposit = item.deposit ?? participant.deposit;
    return {
      rowNumber: index + 1,
      eventId,
      participantId: participant.id,
      name: participant.name,
      email: participant.email,
      wallet: participant.wallet,
      identityVerified: participant.identityVerified,
      registered: stakers.has(lower(participant.wallet)),
      currentAdmission: participant.admission,
      proposedAdmission:
        kind === "guests" ? item.row.admission : participant.admission,
      deposit: deposit
        ? {
            txHash: deposit.txHash,
            logIndex: deposit.logIndex,
            amountWei: deposit.amountWei,
            verified: deposit.verified,
          }
        : null,
      checkedInAt:
        kind === "attendance"
          ? new Date(item.timestamp * 1000).toISOString()
          : null,
      alreadyObserved:
        kind === "attendance" &&
        record.observations.some((o) => o.participantId === participant.id),
      originReviewRequired: true,
    };
  });
  return {
    record,
    planned,
    proposedRows,
    csv,
    kind,
    sourceEventId,
    sourceHash,
    configHash,
    startingRevision,
    snapshot,
    reviewNote,
    parserVersion: IMPORT_PARSER_VERSION,
    originReviewRequired: true,
    limitation: IMPORT_ORIGIN_LIMITATION,
  };
}

/** No await may occur between the final stale check and the complete mutation. */
function applyValidatedImport(eventId, session, validated) {
  const {
    record,
    planned,
    kind,
    snapshot,
    configHash,
    startingRevision,
    sourceHash,
    reviewNote,
  } = validated;
  requireThat(
    record.revision === startingRevision &&
      hash(record.deployment) === configHash,
    "State changed before import commit; retry with fresh authoritative data",
    "STALE_IMPORT",
    409,
  );
  const batch = {
    id: id(),
    eventId,
    chainId: record.deployment.chainId,
    contract: record.deployment.contract,
    kind,
    sourceHash,
    parserVersion: IMPORT_PARSER_VERSION,
    configHash,
    snapshotBlock: snapshot.blockNumber,
    reviewer: session.wallet,
    reviewedAt: new Date().toISOString(),
    reviewNote,
    origin: "organizer-reviewed-unverified-export",
    rowCount: planned.length,
  };
  for (const item of planned) {
    if (kind === "attendance")
      record.observations.push({
        id: id(),
        eventId,
        participantId: item.participant.id,
        source: "reviewed-csv",
        reviewer: session.wallet,
        timestamp: item.timestamp,
        batchId: batch.id,
        sourceHash,
        note: reviewNote,
      });
    else {
      if (item.deposit) item.participant.deposit = item.deposit;
      item.participant.admission = item.row.admission;
    }
  }
  record.batches.push(batch);
  record.revision++;
  return {
    batch,
    rows: planned.length,
    errors: [],
    limitation: IMPORT_ORIGIN_LIMITATION,
  };
}

/** Compatibility route: validates and commits immediately after explicit provenance review. */
export async function importCsv(
  workbench,
  eventId,
  session,
  input,
  { expected = null, beforeCommit = () => {} } = {},
) {
  const validated = await validateImportCsv(
    workbench,
    eventId,
    session,
    input,
    { requireReview: true, expected },
  );
  beforeCommit();
  return applyValidatedImport(eventId, session, validated);
}
