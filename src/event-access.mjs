// Database roles authorize off-chain administration only, never contract calls.
import { ethers } from "ethers";
import { hash, lower, requireThat, text } from "./utils.mjs";

const MAX_ADMINS = 32, MAX_STAFF = 150, MAX_CHECKINS = 150;
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(v).length === keys.length &&
  keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(v, key) ?? {}, "value"));
const address = v => typeof v === "string" && ethers.isAddress(v) && BigInt(v) !== 0n;
const check = (ok, code = "INVALID_EVENT_ACCESS", status = 400) =>
  requireThat(ok, "The event access request or current authority changed", code, status);
const same = (a, b) => typeof a === "string" && typeof b === "string" && lower(a) === lower(b);
const STATE_KEYS = ["schemaVersion", "eventId", "chainId", "contract", "registryHash", "origin", "authorityOwner", "admins", "staff"];

export function validateEventAccessState(value, { eventId, chainId, contract, registryHash }) {
  check(exact(value, STATE_KEYS) && value.schemaVersion === 1 && value.eventId === eventId && value.chainId === chainId &&
    same(value.contract, contract) && value.registryHash === registryHash && address(value.authorityOwner), "STATE_SCOPE", 409);
  let origin;
  try { origin = new URL(value.origin); } catch { /* Rejected below. */ }
  check(origin?.protocol === "https:" && origin.origin === value.origin && !origin.username && !origin.password, "STATE_SCOPE", 409);
  for (const [key, limit] of [["admins", MAX_ADMINS], ["staff", MAX_STAFF]]) {
    const wallets = value[key];
    check(Array.isArray(wallets) && wallets.length <= limit && wallets.every(address) &&
      new Set(wallets.map(lower)).size === wallets.length, "STATE_SCOPE", 409);
  }
  return value;
}

export function eventAccessRole(record, wallet, authority, origin) {
  if (!address(wallet)) return "participant";
  if (same(wallet, authority?.owner)) return "owner";
  if (same(wallet, authority?.pendingOwner)) return "pending-owner";
  const saved = record.eventAccess;
  if (!saved) return "participant";
  validateEventAccessState(saved, { eventId: record.definition.id, ...record.deployment, registryHash: hash(record.deployment) });
  if (saved.origin !== origin || !same(saved.authorityOwner, authority?.owner)) return "participant";
  if (saved.admins.some(item => same(item, wallet))) return "admin";
  return saved.staff.some(item => same(item, wallet)) ? "staff" : "participant";
}

export function createEventAccessService({ record, authority, authenticate, persist, appendCheckin, resolveParticipant, origin, instanceId }) {
  const active = new Set();
  const current = (s, assertSession) => { authenticate(s); assertSession(); };
  function dto(r, s, a) {
    const role = eventAccessRole(r, s.wallet, a, origin), visible = role !== "participant";
    const saved = r.eventAccess, effective = saved && saved.origin === origin && same(saved.authorityOwner, a.owner);
    const checkins = visible ? r.observations.filter(item => item.source === "staff-door").map(item => {
      const person = r.participants.get(item.participantId);
      check(person && address(person.wallet) && address(item.reviewer) && Number.isSafeInteger(item.timestamp) && item.timestamp > 0,
        "STATE_SCOPE", 409);
      return { wallet: person.wallet, actorWallet: item.reviewer, recordedAt: new Date(item.timestamp * 1000).toISOString() };
    }) : [];
    check(checkins.length <= MAX_CHECKINS, "EVENT_ACCESS_CAPACITY", 409);
    return { kind: "event-access", eventId: r.definition.id, chainId: 1, contract: r.deployment.contract,
      instanceId, wallet: s.wallet, owner: a.owner, pendingOwner: a.pendingOwner, role, revision: r.revision,
      admins: visible && effective ? [...saved.admins] : [], staff: visible && effective ? [...saved.staff] : [], checkins };
  }
  async function read(eventId, s, assertSession = () => {}) {
    current(s, assertSession); const r = record(eventId), binding = hash(r.deployment);
    const a = await authority(eventId); current(s, assertSession);
    check(record(eventId) === r && hash(r.deployment) === binding, "STALE_EVENT_ACCESS", 409);
    return dto(r, s, a);
  }
  async function mutate(eventId, s, input, operation, assertSession = () => {}) {
    current(s, assertSession);
    check(!active.has(eventId), "EVENT_ACCESS_BUSY", 409); active.add(eventId);
    let r, attempted = false;
    try {
      r = record(eventId); const revision = r.revision, binding = hash(r.deployment);
      check(Number.isSafeInteger(revision) && revision >= 0 && revision < Number.MAX_SAFE_INTEGER, "STATE_SCOPE", 409);
      const a = await authority(eventId); current(s, assertSession);
      const role = eventAccessRole(r, s.wallet, a, origin);
      const unchanged = () => check(record(eventId) === r && r.revision === revision && hash(r.deployment) === binding,
        "STALE_EVENT_ACCESS", 409);
      unchanged();
      const next = { ...r, observations: [...r.observations], nonces: new Set(r.nonces) };
      if (operation === "roles") {
        check(exact(input, ["role", "wallet", "enabled", "revision"]) && ["admin", "staff"].includes(input.role) &&
          address(input.wallet) && typeof input.enabled === "boolean" && Number.isSafeInteger(input.revision) && input.revision >= 0);
        check(input.revision === revision, "STALE_EVENT_ACCESS", 409);
        check(role === "owner" || (role === "admin" && input.role === "staff"), "EVENT_ACCESS_FORBIDDEN", 403);
        const previous = r.eventAccess, reuse = previous && previous.origin === origin && same(previous.authorityOwner, a.owner);
        next.eventAccess = { schemaVersion: 1, eventId, chainId: 1, contract: r.deployment.contract,
          registryHash: binding, origin, authorityOwner: a.owner,
          admins: reuse ? [...previous.admins] : [], staff: reuse ? [...previous.staff] : [] };
        const key = input.role === "admin" ? "admins" : "staff", wallet = ethers.getAddress(input.wallet);
        next.eventAccess[key] = next.eventAccess[key].filter(item => !same(item, wallet));
        if (input.enabled) next.eventAccess[key].push(wallet);
        check(next.eventAccess.admins.length <= MAX_ADMINS && next.eventAccess.staff.length <= MAX_STAFF, "EVENT_ACCESS_CAPACITY", 409);
        validateEventAccessState(next.eventAccess, { ...r.deployment, eventId, registryHash: binding });
        next.revision++;
      } else {
        check(["owner", "admin", "staff"].includes(role), "NOT_STAFF", 403);
        const legacy = operation === "legacy-checkin";
        const keys = legacy ? ["source", "nonce", ...(Object.hasOwn(input ?? {}, "participantId") ? ["participantId"] : []),
          ...(Object.hasOwn(input ?? {}, "note") ? ["note"] : [])] : ["wallet", "nonce", "note"];
        check(exact(input, keys) && typeof input.nonce === "string" &&
          (input.note === undefined ? legacy : typeof input.note === "string") && (legacy || address(input.wallet)));
        if (legacy) check(input.source === "staff-door", "UNTRUSTED_SOURCE", 400);
        const note = text(input.note ?? "", 500, legacy ? 0 : 8), nonce = text(input.nonce, 100, 8);
        check(next.observations.length < MAX_CHECKINS, "EVENT_ACCESS_CAPACITY", 409);
        const people = legacy ? [resolveParticipant(r, s, input.participantId)]
          : [...r.participants.values()].filter(person => same(person.wallet, input.wallet));
        check(people.length === 1, "UNKNOWN_IDENTITY", 400);
        next.observationResult = appendCheckin(next, s, { participantId: people[0].id, nonce, note, source: "staff-door" }, a.now);
      }
      const closing = await authority(eventId); current(s, assertSession); unchanged();
      check(same(closing.owner, a.owner) && same(closing.pendingOwner, a.pendingOwner) &&
        eventAccessRole(r, s.wallet, closing, origin) === role, "STALE_EVENT_ACCESS", 409);
      // The immutable interval is checked again at the closing current block.
      if (operation !== "roles") check(closing.now >= Date.parse(r.definition.startsAt) / 1000 &&
        closing.now <= Date.parse(r.definition.endsAt) / 1000, "ATTENDANCE_TIME_MISMATCH", 409);
      const view = dto(next, s, closing), result = operation === "legacy-checkin" ? structuredClone(next.observationResult) : view;
      delete next.observationResult;
      attempted = true; await persist(eventId, next); current(s, assertSession); unchanged();
      Object.assign(r, { eventAccess: next.eventAccess, observations: next.observations, nonces: next.nonces, revision: next.revision });
      return result;
    } catch (error) {
      if (attempted && r) {
        try { await persist(eventId, r); } catch { throw Object.assign(Error("Event access persistence requires review"), { code: "EVENT_ACCESS_SAVE_FAILED", status: 503 }); }
      }
      throw error;
    } finally { active.delete(eventId); }
  }
  return { read, patch: (id, s, input, assertSession) => mutate(id, s, input, "roles", assertSession),
    checkin: (id, s, input, assertSession) => mutate(id, s, input, "checkin", assertSession),
    legacyCheckin: (id, s, input, assertSession) => mutate(id, s, input, "legacy-checkin", assertSession) };
}
