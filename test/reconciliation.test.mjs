import assert from "node:assert/strict";
import test from "node:test";
import { analyzeImport, parseCsv } from "../public/reconciliation.js";

const walletA = `0x${"a".repeat(40)}`;
const walletB = `0x${"b".repeat(40)}`;
const hashA = `0x${"1".repeat(64)}`;
const hashB = `0x${"2".repeat(64)}`;
const detail = {
  event: {
    id: "event-a",
    chainId: 1337,
    contract: `0x${"c".repeat(40)}`,
    startsAt: "2026-10-28T12:00:00Z",
    endsAt: "2026-10-28T14:00:00Z",
    lumaEventId: "evt-a",
    lumaUrl: "https://luma.example/event-a",
  },
  now: Date.parse("2026-10-28T15:00:00Z") / 1000,
  participants: [
    {
      id: "a-alice",
      name: "Alice",
      email: "alice@example.invalid",
      wallet: walletA,
      identityVerified: true,
      registered: true,
      admission: "approved",
      deposit: { verified: true, txHash: hashA },
    },
    {
      id: "a-bob",
      name: "Bob",
      email: "bob@example.invalid",
      wallet: walletB,
      identityVerified: true,
      registered: false,
      admission: "pending",
      deposit: null,
    },
  ],
};
const review = (csv, kind = "guests", extra = {}) =>
  analyzeImport(
    { csv, kind, sourceEventId: "event-a", ...extra },
    structuredClone(detail),
  );

test("CSV parser preserves quoted commas, newlines, escaped quotes and BOM", () => {
  assert.deepEqual(
    parseCsv(
      '\uFEFFParticipant ID,Review Note\r\na-alice,"Door, east\r\nSaid ""present"""\r\n',
    ),
    [
      {
        participant_id: "a-alice",
        review_note: 'Door, east\r\nSaid "present"',
      },
    ],
  );
});

test("CSV parser rejects malformed quoting, ragged records and normalized duplicate headers", () => {
  for (const csv of [
    'id,note\na,"unfinished',
    "id,note\na,b,c",
    "Participant ID,participant-id\na,b",
    'id,note\na,"hello"text',
  ])
    assert.throws(() => parseCsv(csv));
  assert.throws(() => parseCsv("id\n"), /1–500/);
  assert.throws(() => parseCsv(`id\n${"x\n".repeat(501)}`), /1–500/);
  assert.throws(() => parseCsv(`id\n${"x".repeat(10_001)}`), /10,000/);
  assert.throws(() => parseCsv(`id\n${"é".repeat(256_001)}`), /512,000/);
});

test("known event, chain, contract and Luma conflicts stay hard-blocked despite provenance", () => {
  for (const [header, value, message] of [
    ["event_id", "event-b", "Wrong event"],
    ["chain_id", "1", "Wrong chain"],
    ["contract", walletB, "Wrong event contract"],
    ["luma_event_id", "evt-b", "Wrong Luma"],
    ["luma_url", "https://luma.example/event-b", "Wrong Luma"],
  ]) {
    const result = review(
      `${header},participant_id,admission\n${value},a-alice,approved`,
      "guests",
      { review: { confirmed: true, note: "Reviewed source" } },
    );
    assert.match(result.errors.join(" "), new RegExp(message));
    assert.equal(result.rows[0].status, "Blocked");
  }
  assert.match(
    review("participant_id,admission\na-alice,approved", "guests", {
      sourceEventId: "event-b",
    }).errors.join(" "),
    /Source event conflicts/,
  );
});

test("foreign participant ID cannot fall back to a matching event email or wallet", () => {
  const result = review(
    `participant_id,email,wallet,admission\nb-alice,alice@example.invalid,${walletA},approved`,
  );
  assert.match(result.errors.join(" "), /does not belong/);
  assert.equal(result.rows[0].status, "Blocked");
});

test("email identity matching is case-insensitive and wallet-only rows require supported identity", () => {
  const email = review(
    `email,wallet,admission\nALICE@EXAMPLE.INVALID,${walletA.toUpperCase().replace("0X", "0x")},approved`,
  );
  assert.deepEqual(email.errors, []);
  assert.equal(email.rows[0].participantLabel, "Alice");
  const walletOnly = review(`wallet,admission\n${walletA},approved`);
  assert.equal(walletOnly.rows[0].participantLabel, "Alice");
  assert.match(walletOnly.errors.join(" "), /wallet alone is insufficient/);
});

test("duplicate participants, reused and malformed receipt evidence are visible and block whole review", () => {
  const repeated = review(
    `participant_id,tx_hash,admission\na-alice,${hashA},approved\na-alice,${hashA.toUpperCase().replace("0X", "0x")},approved`,
  );
  assert.equal(repeated.rowCount, 2);
  assert.match(repeated.errors.join(" "), /Duplicate participant/);
  assert.match(repeated.errors.join(" "), /Duplicate financial evidence/);
  const reused = review(
    `participant_id,tx_hash,admission\na-bob,${hashA},approved`,
  );
  assert.match(reused.errors.join(" "), /already linked/);
  assert.match(
    review(
      "participant_id,tx_hash,admission\na-alice,0xabc,approved",
    ).errors.join(" "),
    /Invalid transaction hash/,
  );
});

test("new receipt references remain explicitly unverified; preview never mutates supplied projections", () => {
  const before = structuredClone(detail);
  const result = analyzeImport(
    {
      csv: `participant_id,tx_hash,admission\na-bob,${hashB},approved`,
      kind: "guests",
    },
    detail,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].receipt, "Server verification required");
  assert.equal(result.receiptChecksRequired, 1);
  assert.deepEqual(detail, before);
});

test("free, pending, declined and missing-deposit rows remain visible outside reward-pool registration", () => {
  for (const admission of ["free", "pending", "declined", "approved"]) {
    const result = review(`participant_id,admission\na-bob,${admission}`);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].status, "Outside reward pool");
    assert.equal(result.excludedCount, 1);
    assert.ok(result.rows[0].exclusionReason);
  }
  assert.match(
    review("participant_id,admission\na-bob,confirmed").errors.join(" "),
    /Admission must be/,
  );
});

test("personal history or merch cannot substitute for trusted attendance timestamp", () => {
  const result = review(
    "participant_id,attended,merch_delivered\na-alice,true,true",
    "attendance",
  );
  assert.match(
    result.errors.join(" "),
    /personal history and merch are not attendance evidence/,
  );
  assert.equal(result.rows[0].status, "Blocked");
});

test("trusted observations respect timezone, current chain time and this event's time window", () => {
  for (const [timestamp, message] of [
    ["2026-10-28T13:00:00", "timezone"],
    ["2026-10-28T16:00:00Z", "future"],
    ["2026-10-28T11:00:00Z", "outside this event"],
  ])
    assert.match(
      review(
        `participant_id,checked_in_at\na-alice,${timestamp}`,
        "attendance",
      ).errors.join(" "),
      new RegExp(message),
    );
  const result = review(
    "participant_id,checked_in_at\na-alice,2026-10-28T13:00:00Z\na-bob,2026-10-28T13:05:00+00:00",
    "attendance",
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].status, "Ready for server verification");
  assert.equal(result.rows[1].status, "Outside reward pool");
  assert.match(result.rows[1].exclusionReason, /Observation only/);
});
