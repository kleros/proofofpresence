import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { eventV9LumaTemplate, V9_LUMA_ATTENDANCE_STANDARD } from "../src/contracts-v9-luma.mjs";
import { eventV8Template } from "../src/contracts-v8.mjs";

const terms = Object.freeze({ eventName: "Synthetic Luma meetup", depositAmount: "1000000000000000",
  policyURI: "https://example.invalid/immutable-policy.json", policySha256: "a".repeat(64),
  lumaUrl: "https://luma.com/synthetic-meetup", startsAt: "2026-11-05T10:00:00.000Z",
  endsAt: "2026-11-05T12:00:00.000Z", timezone: "Asia/Bangkok" });
const wallet = ethers.getAddress("0x11111111111111111111111111111111111111a1"),
  contract = ethers.getAddress("0x22222222222222222222222222222222222222b2"),
  organizer = ethers.getAddress("0x33333333333333333333333333333333333333c3");
function materialize(template, caseOrganizer = organizer) {
  const values = { 1: wallet, 2: contract, 3: wallet.toLowerCase(), 4: caseOrganizer, 5: caseOrganizer.toLowerCase() };
  const slots = ethers.getBytes(template.slots);
  assert.equal(template.pieces.length, slots.length + 1);
  const raw = template.pieces.map((piece, i) => piece + (i < slots.length ? values[slots[i]] : "")).join("");
  assert.doesNotMatch(raw, /\{\{[^}]*\}\}/);
  return JSON.parse(raw);
}
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("materialized ERC1497 metadata binds immutable Luma terms and contract-filled case identities", () => {
  const template = eventV9LumaTemplate(terms), doc = materialize(template);
  assert.deepEqual(doc.lumaAttendance, { schemaVersion: 1, lumaUrl: terms.lumaUrl, startsAt: terms.startsAt,
    endsAt: terms.endsAt, timezone: terms.timezone, attendanceMode: "event-participation",
    attendanceRule: "presence-during-immutable-interval-v1",
    evidenceRule: "balance-of-probabilities-with-case-organizer-confirmation-v1", policySha256: terms.policySha256 });
  assert.equal(doc.fileURI, terms.policyURI); assert.equal(doc.category, "Event attendance");
  assert.deepEqual(doc.rulingOptions.titles, ["Attended", "Did not attend"]);
  for (const text of [terms.eventName, "0.001 ETH", wallet, contract, organizer,
    terms.lumaUrl, terms.startsAt, terms.endsAt, terms.timezone, terms.policySha256]) assert.ok(doc.description.includes(text), text);
  for (const phrase of ["caseOrganizer(wallet) when the challenge opened", "Ownership rotation affects future challenges",
    "any point during this fixed interval, in person or online", "participation for the whole event is not required", "Explicit confirmation",
    "more likely than not", "balance of probabilities", "missing door scan alone does not prove absence",
    "credible contemporaneous online or physical evidence", "Luma RSVP, deposit or personal check-in mark alone is not proof"])
    assert.ok(doc.description.includes(phrase), phrase);
  assert.deepEqual(V9_LUMA_ATTENDANCE_STANDARD, { attendanceMode: "event-participation",
    attendanceRule: "presence-during-immutable-interval-v1",
    evidenceRule: "balance-of-probabilities-with-case-organizer-confirmation-v1" });
  assert.equal(Object.isFrozen(V9_LUMA_ATTENDANCE_STANDARD), true);
  assert.throws(() => { V9_LUMA_ATTENDANCE_STANDARD.attendanceMode = "in-person"; }, TypeError);
  for (const kind of [1, 2, 4]) assert.ok(ethers.getBytes(template.slots).includes(kind));
  assert.equal(doc.aliases[organizer], "Organizer for this case");
  const replacement = ethers.getAddress("0x44444444444444444444444444444444444444d4");
  assert.ok(materialize(template, replacement).description.includes(replacement));
  assert.ok(!materialize(template, replacement).description.includes(organizer), "identity comes only from the case snapshot slot");
});

test("JSON escaping preserves hostile event text without injecting metadata or changing slots", () => {
  const eventName = 'Meetup "]},"lumaAttendance":{"schemaVersion":999},"x":"\\\n🧪';
  const template = eventV9LumaTemplate({ ...terms, eventName }), doc = materialize(template);
  assert.equal(doc.title, `Did wallet ${wallet} attend ${eventName}?`);
  assert.ok(doc.description.includes(eventName)); assert.equal(doc.lumaAttendance.schemaVersion, 1);
  assert.equal(doc.x, undefined); assert.equal(template.slots, eventV9LumaTemplate(terms).slots);
});

test("changing each immutable event fact changes both the encoded template and materialized terms", () => {
  const baseline = eventV9LumaTemplate(terms);
  for (const [field, value] of Object.entries({ lumaUrl: "https://luma.com/another-meetup", startsAt: "2026-11-05T10:30:00.000Z",
    endsAt: "2026-11-05T13:00:00.000Z", timezone: "Europe/Paris", policySha256: "b".repeat(64) })) {
    const changed = eventV9LumaTemplate({ ...terms, [field]: value }), doc = materialize(changed);
    assert.notDeepEqual(changed, baseline, field); assert.equal(doc.lumaAttendance[field], value);
    assert.ok(doc.description.includes(value), field);
  }
  assert.notDeepEqual(eventV9LumaTemplate({ ...terms, policyURI: "https://example.invalid/another-policy.json" }), baseline);
});

test("generation is deterministic and leaves historical V8 template bytes unchanged", () => {
  const baseline = eventV9LumaTemplate(terms);
  assert.deepEqual(eventV9LumaTemplate(terms), baseline);
  assert.deepEqual(eventV9LumaTemplate(Object.fromEntries(Object.entries(terms).reverse())), baseline);
  assert.deepEqual(eventV9LumaTemplate({ ...terms, depositAmount: BigInt(terms.depositAmount) }), baseline);
  assert.equal(digest(eventV8Template({ eventName: "Historical synthetic event", depositAmount: "1000000000000000",
    policyURI: "https://example.invalid/v8-policy.json" })), "a51fe212f3db2377ebeb68ea1cbc4d20e1b1943dff6ac307c6ecfce52ac2fa04");
});

test("every supplied runtime marker is rejected before tokenization", () => {
  for (const field of Object.keys(terms))
    for (const marker of ["{{wallet}}", "{{organizerLower}}", "{{unknown}}", "{{line\nbreak}}"])
      assert.throws(() => eventV9LumaTemplate({ ...terms, [field]: marker }), /runtime template markers/, `${field}: ${marker}`);
  assert.throws(() => eventV9LumaTemplate({ ...terms, extra: "{{wallet}}" }));
});

test("canonical URLs, SHA, IANA zone and UTF8/uint256 boundaries are validated", () => {
  for (const lumaUrl of ["https://luma.com", "https://luma.com/", "https://luma.com/pricing", "https://luma.com/EVENT",
    "https://luma.com/a/b", "https://luma.com/a/", "https://luma.com/a?x=1", "https://luma.com/a#x",
    "https://luma.com:443/a", "https://luma.com:8443/a", "https://LUMA.COM/a", "https://user@luma.com/a",
    "https://luma.com.evil.invalid/a", "https://evil.invalid/a", "http://luma.com/a", "https://luma.com/%61"])
    assert.throws(() => eventV9LumaTemplate({ ...terms, lumaUrl }), lumaUrl);
  for (const policyURI of ["http://example.invalid/p", "https://user:password@example.invalid/p", "https://example.invalid/p#x",
    "https://example.invalid:443/p", "https://example.invalid/" + "a".repeat(513)])
    assert.throws(() => eventV9LumaTemplate({ ...terms, policyURI }));
  for (const policySha256 of ["a".repeat(63), "A".repeat(64), "0x" + "a".repeat(64), "g".repeat(64)])
    assert.throws(() => eventV9LumaTemplate({ ...terms, policySha256 }));
  for (const timezone of ["", "Invalid/Zone", "+07:00", " Asia/Bangkok", "a".repeat(101)])
    assert.throws(() => eventV9LumaTemplate({ ...terms, timezone }));
  for (const eventName of ["", " ", "a".repeat(257), "🧪".repeat(65), "\ud800"])
    assert.throws(() => eventV9LumaTemplate({ ...terms, eventName }));
  for (const depositAmount of [0n, -1n, 2n ** 256n, "0", "-1", "01", "1.0", "1e18", "0x01", 1, null])
    assert.throws(() => eventV9LumaTemplate({ ...terms, depositAmount }));
  const maximum = eventV9LumaTemplate({ ...terms, eventName: "🧪".repeat(64), depositAmount: (2n ** 256n - 1n).toString(),
    policyURI: "https://example.invalid/" + "p".repeat(512 - "https://example.invalid/".length) });
  assert.ok(ethers.getBytes(maximum.slots).length <= 32);
  assert.ok(ethers.getBytes(ethers.AbiCoder.defaultAbiCoder().encode(["string[]", "bytes"], [maximum.pieces, maximum.slots])).length <= 12288);
  assert.equal(materialize(maximum).fileURI.length, 512);
  for (const invalid of [undefined, null, [], {}, { ...terms, missing: true }]) assert.throws(() => eventV9LumaTemplate(invalid));
});

test("UTC calendar timestamps and fixed positive interval enforce the exact seven-day boundary", () => {
  for (const startsAt of ["2026-11-05T10:00:00Z", "2026-11-05T10:00:00.001Z", "2026-11-05T17:00:00.000+07:00",
    "2026-02-30T10:00:00.000Z", "2026-13-05T10:00:00.000Z", "2026-11-05T24:00:00.000Z"])
    assert.throws(() => eventV9LumaTemplate({ ...terms, startsAt }));
  for (const endsAt of [terms.startsAt, "2026-11-05T09:59:59.000Z", "2026-11-12T10:00:01.000Z"])
    assert.throws(() => eventV9LumaTemplate({ ...terms, endsAt }));
  assert.equal(materialize(eventV9LumaTemplate({ ...terms, endsAt: "2026-11-12T10:00:00.000Z" })).lumaAttendance.endsAt,
    "2026-11-12T10:00:00.000Z");
});
