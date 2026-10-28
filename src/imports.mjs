// @ts-check
import { parse } from "csv-parse/sync";
import { ethers } from "ethers";
import { hash, id, lower, requireThat, text } from "./utils.mjs";

/** Raw CSV metadata detects conflicts; it does not authenticate the export's origin. */
export async function importCsv(workbench, eventId, session, input) {
  const record = workbench.record(eventId, session);
  await workbench.owner(eventId, session);
  requireThat(
    ["attendance", "guests"].includes(input.kind),
    "Unknown import kind",
  );
  const csv = text(input.csv, 512_000, 1);
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
  const startingState = await workbench.state(eventId);
  const seenParticipants = new Set(),
    seenFinancial = new Set();
  const planned = [];
  // Validate every row before mutating anything. Review can never override a mismatch.
  requireThat(
    !input.sourceEventId || input.sourceEventId === eventId,
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
    if (input.kind === "attendance") {
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
  requireThat(
    input.review?.confirmed === true &&
      text(input.review?.note ?? "", 1000).length >= 8,
    "Raw CSV origin cannot be verified. Organizer must review source event and record a provenance note; hashes identify bytes, not origin.",
    "PROVENANCE_REVIEW_REQUIRED",
    409,
  );
  const sourceHash = hash(csv);
  requireThat(
    !record.batches.some(
      (b) => b.sourceHash === sourceHash && b.kind === input.kind,
    ),
    "This exact import was already applied",
    "DUPLICATE_IMPORT",
    409,
  );
  const snapshot = await workbench.state(eventId);
  requireThat(
    record.revision === startingRevision &&
      snapshot.fingerprint === startingState.fingerprint,
    "State changed during import review; retry with fresh authoritative data",
    "STALE_IMPORT",
    409,
  );
  const batch = {
    id: id(),
    eventId,
    chainId: d.chainId,
    contract: d.contract,
    kind: input.kind,
    sourceHash,
    parserVersion: "csv-v1",
    configHash: hash(d),
    snapshotBlock: snapshot.blockNumber,
    reviewer: session.wallet,
    reviewedAt: new Date().toISOString(),
    reviewNote: input.review.note,
    origin: "organizer-reviewed-unverified-export",
    rowCount: rows.length,
  };
  // Deposits have all been verified above; committing rows is atomic in this single process.
  for (const item of planned) {
    if (input.kind === "attendance")
      record.observations.push({
        id: id(),
        eventId,
        participantId: item.participant.id,
        source: "reviewed-csv",
        reviewer: session.wallet,
        timestamp: item.timestamp,
        batchId: batch.id,
        sourceHash,
        note: input.review.note,
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
    rows: rows.length,
    errors: [],
    limitation:
      "Origin is organizer-reviewed; neither a CSV label nor a hash authenticates Luma.",
  };
}
