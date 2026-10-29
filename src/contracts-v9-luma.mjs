// Explicit V9 Luma policy configuration. Historical templates stay unchanged.
import { ethers } from "ethers";

export const V9_LUMA_ATTENDANCE_STANDARD = Object.freeze({
  attendanceMode: "event-participation",
  attendanceRule: "presence-during-immutable-interval-v1",
  evidenceRule: "balance-of-probabilities-with-case-organizer-confirmation-v1",
});

const DAY_MS = 86400_000;
const INPUT_KEYS = ["eventName", "depositAmount", "policyURI", "policySha256", "lumaUrl", "startsAt", "endsAt", "timezone"];
const RESERVED_LUMA_PATHS = new Set(["home", "discover", "events", "event", "calendar", "calendars", "signin", "sign-in", "login", "logout",
  "settings", "pricing", "features", "about", "terms", "privacy", "contact", "help", "create"]);
const SLOT_KINDS = { wallet: 1, contract: 2, walletLower: 3, organizer: 4, organizerLower: 5 };
const check = (condition, message) => { if (!condition) throw new Error(message); };

function utf8Text(value, maximum, field) {
  check(typeof value === "string" && value.trim().length > 0, `Invalid ${field}`);
  let length;
  try { length = ethers.toUtf8Bytes(value).length; } catch { throw new Error(`Invalid ${field} UTF-8`); }
  check(length >= 1 && length <= maximum, `Invalid ${field} length`);
  return value;
}

function httpsURL(value, maximum, field) {
  utf8Text(value, maximum, field);
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${field}`); }
  check(url.protocol === "https:" && !url.username && !url.password && !url.hash && url.href === value, `Invalid canonical ${field}`);
  return url;
}

function canonicalTime(value) {
  check(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value), "Use canonical whole-second UTC timestamps");
  const milliseconds = Date.parse(value);
  check(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value, "Invalid calendar timestamp");
  return milliseconds;
}

/** Build ERC-1497 metadata with immutable Luma terms and contract-filled case identities. */
export function eventV9LumaTemplate(input) {
  check(input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).length === INPUT_KEYS.length && Object.keys(input).every(key => INPUT_KEYS.includes(key)), "Use exactly the V9 Luma template inputs");
  for (const value of Object.values(input))
    check(typeof value !== "string" || !/\{\{[\s\S]*?\}\}/.test(value), "Metadata cannot contain runtime template markers");
  const { eventName, depositAmount, policyURI, policySha256, lumaUrl, startsAt, endsAt, timezone } = input;
  utf8Text(eventName, 256, "event name");
  check((typeof depositAmount === "bigint") || (typeof depositAmount === "string" && /^[1-9][0-9]{0,77}$/.test(depositAmount)), "Use a positive uint256 wei deposit");
  const deposit = BigInt(depositAmount);
  check(deposit > 0n && deposit < 2n ** 256n, "Deposit must be a positive uint256");
  httpsURL(policyURI, 512, "policy URI");
  check(typeof policySha256 === "string" && /^[a-f0-9]{64}$/.test(policySha256), "Use a lowercase policy SHA-256");
  const luma = httpsURL(lumaUrl, 512, "Luma URL");
  check(luma.origin === "https://luma.com" && !luma.search && /^\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(luma.pathname) &&
    !RESERVED_LUMA_PATHS.has(luma.pathname.slice(1).toLowerCase()), "Use a specific canonical Luma event URL");
  const start = canonicalTime(startsAt), end = canonicalTime(endsAt);
  check(end > start && end - start <= 7 * DAY_MS, "Event interval must be positive and at most seven days");
  utf8Text(timezone, 100, "timezone");
  check(!/^[+-]/.test(timezone), "Use an IANA timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new Error("Use a valid IANA timezone"); }

  const document = {
    category: "Event attendance",
    title: `Did wallet {{wallet}} attend ${eventName}?`,
    description: `This case concerns the registered depositor {{wallet}} at ${eventName}. The event contract is {{contract}}, the native ETH deposit is ${ethers.formatEther(deposit)} ETH. ` +
      `The immutable Luma event URL is ${lumaUrl}. The fixed attendance interval is ${startsAt} through ${endsAt}, with event timezone ${timezone}. ` +
      `The authoritative organizer for THIS case is {{organizer}}, recorded by caseOrganizer(wallet) when the challenge opened. Ownership rotation affects future challenges; it cannot change this case's organizer identity or description. ` +
      `Apply the immutable attached policy, SHA-256 ${policySha256}. Credible, verifiable presence or participation at any point during this fixed interval, in person or online, qualifies as Attended; participation for the whole event is not required. ` +
      `Explicit confirmation of that presence or participation by the named case organizer means Attended. Otherwise, the challenger must prove presence or participation during the interval more likely than not, on the balance of probabilities, using credible contemporaneous online or physical evidence. ` +
      `A missing door scan alone does not prove absence. A Luma RSVP, deposit or personal check-in mark alone is not proof of presence or participation.`,
    question: `Did the person registered with {{wallet}} attend or participate in ${eventName} during the immutable interval?`,
    rulingOptions: {
      type: "single-select",
      titles: ["Attended", "Did not attend"],
      descriptions: [
        "Presence or participation in person or online at any point during the immutable interval, explicitly confirmed by the case organizer or otherwise proven more likely than not.",
        "Absent or presence or participation during the immutable interval not proven under the attached policy.",
      ],
    },
    fileURI: policyURI,
    aliases: {
      "{{wallet}}": "Challenger",
      "{{walletLower}}": "Challenger",
      "{{organizer}}": "Organizer for this case",
      "{{organizerLower}}": "Organizer for this case",
    },
    lumaAttendance: { schemaVersion: 1, lumaUrl, startsAt, endsAt, timezone,
      ...V9_LUMA_ATTENDANCE_STANDARD, policySha256 },
  };
  const raw = JSON.stringify(document), pieces = [], slots = [];
  let cursor = 0;
  for (const match of raw.matchAll(/\{\{(wallet|contract|walletLower|organizer|organizerLower)\}\}/g)) {
    pieces.push(raw.slice(cursor, match.index)); slots.push(SLOT_KINDS[match[1]]);
    cursor = match.index + match[0].length;
  }
  pieces.push(raw.slice(cursor));
  const encodedSlots = ethers.hexlify(Uint8Array.from(slots));
  check(slots.length <= 32 && [1, 2, 4].every(slot => slots.includes(slot)), "Invalid V9 metadata slots");
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["string[]", "bytes"], [pieces, encodedSlots]);
  check(ethers.getBytes(encoded).length <= 12288, "V9 metadata exceeds the contract template limit");
  return { pieces, slots: encodedSlots };
}
