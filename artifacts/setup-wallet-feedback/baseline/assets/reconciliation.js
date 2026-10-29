// @ts-check
// Presentation-only checks. The existing import service verifies every receipt,
// current permission and revision again before applying an atomic batch.
const normalized = (value) => String(value ?? "").toLowerCase();
const address = (value) => /^0x[0-9a-f]{40}$/i.test(String(value ?? ""));
const receiptHash = (value) => /^0x[0-9a-f]{64}$/i.test(String(value ?? ""));

/** Parse the supported CSV format without contacting a server or changing rows.
 * Quoted commas, CRLF, embedded newlines, doubled quotes and an initial BOM are
 * supported. Malformed quoting, duplicate normalized headers and ragged records
 * fail closed so this preview cannot silently reinterpret a source file.
 * @param {string} csv
 * @returns {Record<string, string>[]}
 */
export function parseCsv(csv) {
  if (typeof csv !== "string" || !csv.trim())
    throw new Error("Choose a CSV with at least one data row.");
  if (csv.length > 512_000 || new TextEncoder().encode(csv).length > 512_000)
    throw new Error("CSV must be at most 512,000 bytes.");
  const source = csv.replace(/^\uFEFF/, "");
  const records = [];
  let fields = [],
    value = "",
    quoted = false,
    closed = false,
    recordSize = 0;
  const finishField = () => {
    fields.push(closed ? value : value.trim());
    value = "";
    closed = false;
  };
  const finishRecord = () => {
    const hasRecord = fields.length > 0 || value.trim().length > 0 || closed;
    finishField();
    if (hasRecord) records.push(fields);
    fields = [];
    recordSize = 0;
  };
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (++recordSize > 10_000)
      throw new Error("A CSV record exceeds 10,000 characters.");
    if (quoted) {
      if (character === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i++;
          recordSize++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += character;
      continue;
    }
    if (character === '"') {
      if (closed || value.trim())
        throw new Error("Invalid quote in CSV field.");
      value = "";
      quoted = true;
    } else if (character === ",") finishField();
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[i + 1] === "\n") i++;
      finishRecord();
    } else if (closed) {
      if (!/[\t ]/.test(character))
        throw new Error("Unexpected text after a quoted CSV field.");
    } else value += character;
  }
  if (quoted) throw new Error("A quoted CSV field is not closed.");
  if (value.length || fields.length || closed) finishRecord();
  const headers = records.shift()?.map((header) =>
    header
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
  if (!headers?.length || headers.some((header) => !header))
    throw new Error("Every CSV column needs a header.");
  if (new Set(headers).size !== headers.length)
    throw new Error("Duplicate CSV headers after normalization.");
  if (records.length < 1 || records.length > 500)
    throw new Error("CSV must contain 1–500 data rows.");
  return records.map((record, index) => {
    if (record.length !== headers.length)
      throw new Error(
        `Row ${index + 1}: column count does not match the headers.`,
      );
    return Object.fromEntries(headers.map((header, i) => [header, record[i]]));
  });
}

/** Give the organizer a reviewable preview; this never approves financial eligibility.
 * A row is never discarded, edited or promoted into verified receipt evidence.
 * @param {{csv: string, kind: string, sourceEventId?: string}} input
 * @param {any} detail Current event-scoped projection from the existing API.
 */
export function analyzeImport(input, detail) {
  const result = {
    rows: [],
    errors: [],
    warnings: [],
    eligibleCount: 0,
    excludedCount: 0,
    receiptChecksRequired: 0,
    rowCount: 0,
  };
  let sourceRows;
  try {
    sourceRows = parseCsv(input.csv);
  } catch (error) {
    result.errors.push(error.message);
    return result;
  }
  const event = detail?.event ?? {};
  const people = detail?.participants ?? [];
  const seenPeople = new Set(),
    seenReceipts = new Set();
  const globalIssues = [];
  if (!["attendance", "guests"].includes(input.kind))
    globalIssues.push("Choose a supported import type.");
  if (!event.id || !event.contract || !event.chainId)
    globalIssues.push(
      "Event deployment is unavailable. Refresh before reviewing.",
    );
  if (input.sourceEventId && input.sourceEventId !== event.id)
    globalIssues.push("Source event conflicts with the selected event.");
  result.errors.push(...globalIssues);
  for (const [index, row] of sourceRows.entries()) {
    const issues = [...globalIssues];
    for (const key of ["event_id", "eventid"])
      if (
        row[key] &&
        ![event.id, event.lumaEventId].filter(Boolean).includes(row[key])
      )
        issues.push("Wrong event identity.");
    for (const key of ["luma_event_id", "event_api_id"])
      if (row[key] && row[key] !== event.lumaEventId)
        issues.push("Wrong Luma event association.");
    for (const key of ["event_url", "luma_url"])
      if (row[key] && row[key] !== event.lumaUrl)
        issues.push("Wrong Luma event URL.");
    for (const key of ["contract", "contract_address"])
      if (row[key] && normalized(row[key]) !== normalized(event.contract))
        issues.push("Wrong event contract.");
    for (const key of ["chain_id", "chainid"])
      if (row[key] && Number(row[key]) !== Number(event.chainId))
        issues.push("Wrong chain.");
    // Match the backend's exact identity path. A foreign ID must never fall back
    // to a matching email or wallet from another event.
    const person = row.participant_id
      ? people.find((person) => person.id === row.participant_id)
      : row.email
        ? people.find(
            (person) => normalized(person.email) === normalized(row.email),
          )
        : null;
    const displayMatch =
      person ??
      (!row.participant_id && !row.email
        ? people.find(
            (person) => normalized(person.wallet) === normalized(row.wallet),
          )
        : null);
    if (row.participant_id && !person)
      issues.push("Participant ID does not belong to this event.");
    if (!person?.identityVerified)
      issues.push(
        "Linked verified participant ID or email is required; a wallet alone is insufficient.",
      );
    if (
      person &&
      row.email &&
      normalized(row.email) !== normalized(person.email)
    )
      issues.push("Email conflicts with the linked participant.");
    for (const key of ["wallet", "eth_address", "ethereum_address"])
      if (
        row[key] &&
        (!address(row[key]) ||
          !person ||
          normalized(row[key]) !== normalized(person.wallet))
      )
        issues.push("Wallet conflicts with the linked participant.");
    if (person) {
      if (seenPeople.has(person.id))
        issues.push("Duplicate participant in this batch.");
      seenPeople.add(person.id);
    }
    let receipt = person?.deposit?.verified
      ? "Existing verified receipt; server rechecks current state"
      : "No verified receipt";
    if (row.tx_hash) {
      receipt = "Server verification required";
      result.receiptChecksRequired++;
      if (!receiptHash(row.tx_hash)) issues.push("Invalid transaction hash.");
      const key = normalized(row.tx_hash);
      if (seenReceipts.has(key))
        issues.push("Duplicate financial evidence in this batch.");
      seenReceipts.add(key);
      if (
        people.some(
          (other) =>
            other.id !== person?.id &&
            normalized(other.deposit?.txHash) === key,
        )
      )
        issues.push(
          "Financial evidence is already linked to another participant.",
        );
    }
    if (input.kind === "attendance") {
      const timestamp = Date.parse(row.checked_in_at ?? "") / 1000;
      if (
        !row.checked_in_at ||
        !Number.isFinite(timestamp) ||
        !/(Z|[+-]\d\d:\d\d)$/.test(row.checked_in_at)
      )
        issues.push(
          "checked_in_at with a timezone is required; personal history and merch are not attendance evidence.",
        );
      else {
        const now = Number(detail?.state?.now ?? detail?.now);
        if (!Number.isFinite(now))
          issues.push("Chain time is unavailable. Refresh before reviewing.");
        else if (timestamp > now)
          issues.push("Check-in timestamp is in the future.");
        if (
          timestamp < Date.parse(event.startsAt) / 1000 ||
          timestamp > Date.parse(event.endsAt) / 1000
        )
          issues.push("Check-in timestamp is outside this event.");
      }
    } else if (
      !["approved", "declined", "pending", "free"].includes(row.admission)
    )
      issues.push("Admission must be approved, declined, pending or free.");
    const admission =
      input.kind === "guests" ? row.admission : person?.admission;
    const exclusionReason =
      input.kind === "attendance"
        ? person?.registered
          ? ""
          : "Observation only; wallet is not currently a registered staker."
        : admission === "free"
          ? "Approved free participation stays outside the reward pool."
          : admission === "pending"
            ? "Admission remains pending; no financial registration is approved."
            : admission === "declined"
              ? "Declined admission stays outside the reward pool; any payer return needs separate review."
              : !person?.deposit?.verified && !row.tx_hash
                ? "No verified deposit; admission alone does not register a staker."
                : "";
    const entry = {
      line: index + 1,
      participantLabel:
        displayMatch?.name ||
        row.email ||
        row.participant_id ||
        "Unknown participant",
      wallet: displayMatch?.wallet ?? row.wallet ?? "",
      receipt,
      txHash: row.tx_hash ?? person?.deposit?.txHash ?? "",
      admission: admission ?? "Not established",
      status: issues.length
        ? "Blocked"
        : exclusionReason
          ? "Outside reward pool"
          : "Ready for server verification",
      issues,
      exclusionReason,
    };
    result.rows.push(entry);
    result.errors.push(
      ...issues
        .filter((issue) => !globalIssues.includes(issue))
        .map((issue) => `Row ${index + 1}: ${issue}`),
    );
    if (issues.length || exclusionReason) result.excludedCount++;
    else result.eligibleCount++;
  }
  result.rowCount = result.rows.length;
  result.warnings.push(
    "This is a source preview. The server rechecks authority, linked identities, receipts, duplicate evidence and current state before applying the entire batch.",
  );
  result.warnings.push(
    "A CSV label or hash identifies source bytes; it does not authenticate their event origin. Organizer provenance review is still required.",
  );
  return result;
}
