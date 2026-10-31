// Database-role authorization and commit boundaries; no chain or network.
import test from "node:test";
import assert from "node:assert/strict";
import { createEventAccessService, eventAccessRole, validateEventAccessState } from "../src/event-access.mjs";
import { hash } from "../src/utils.mjs";
const wallet = n => "0x" + n.toString(16).padStart(40, "0"), ZERO = wallet(0);
const owner = { id: "owner", mode: "wallet", wallet: wallet(1) }, admin = { id: "admin", mode: "wallet", wallet: wallet(2) };
const staff = { id: "staff", mode: "wallet", wallet: wallet(3) }, pending = { id: "pending", mode: "wallet", wallet: wallet(4) };
const guest = { id: "guest", mode: "wallet", wallet: wallet(5) }, origin = "https://event-access.example.invalid";
function fixture() {
  const r = { definition: { id: "current-event", startsAt: new Date(1000 * 1000).toISOString(), endsAt: new Date(2000 * 1000).toISOString() },
    deployment: { eventId: "current-event", chainId: 1, contract: wallet(20) }, revision: 0,
    participants: new Map([["guest", { id: "guest", wallet: guest.wallet }]]), observations: [], nonces: new Set() };
  let current = { owner: owner.wallet, pendingOwner: ZERO, now: 1500 }, saved = structuredClone(r), reads = 0, saves = 0;
  const deps = { origin, instanceId: "instance-test", record(id) { assert.equal(id, "current-event"); return r; },
    authenticate(s) { if (!s?.wallet || s.mode !== "wallet") throw Object.assign(Error("sign in"), { code: "UNAUTHENTICATED" }); },
    async authority() { reads++; return { ...current }; }, async persist(id, next) { assert.equal(id, r.definition.id); saves++; saved = structuredClone(next); },
    appendCheckin(next, s, input, timestamp) {
      assert.equal(input.source, "staff-door"); assert.equal(input.participantId, "guest");
      if (next.nonces.has(input.nonce)) throw Object.assign(Error("replay"), { code: "REPLAY" });
      const observation = { id: "observation-1", eventId: next.definition.id, participantId: "guest", source: input.source, reviewer: s.wallet, timestamp, note: input.note, nonce: input.nonce };
      next.nonces.add(input.nonce); next.observations.push(observation); next.revision++; return observation;
    } };
  const service = createEventAccessService(deps);
  return { r, deps, service, setAuthority: value => { current = { ...current, ...value }; }, saved: () => saved, stats: () => ({ reads, saves }) };
}
const patch = (f, actor, role, target, enabled = true) => f.service.patch("current-event", actor,
  { role, wallet: target.wallet, enabled, revision: f.r.revision });

test("owner/admin/staff permissions, list privacy, bounded revisions and pending-owner precedence", async () => {
  const f = fixture();
  await patch(f, owner, "admin", admin); await patch(f, admin, "staff", staff);
  const view = await f.service.read("current-event", staff);
  assert.equal(view.role, "staff"); assert.deepEqual(view.admins.map(x => x.toLowerCase()), [admin.wallet]);
  assert.deepEqual(view.staff.map(x => x.toLowerCase()), [staff.wallet]);
  const participant = await f.service.read("current-event", guest);
  assert.equal(participant.role, "participant"); assert.deepEqual([participant.admins, participant.staff, participant.checkins], [[], [], []]);
  await assert.rejects(patch(f, admin, "admin", guest), { code: "EVENT_ACCESS_FORBIDDEN" });
  await assert.rejects(patch(f, staff, "staff", guest), { code: "EVENT_ACCESS_FORBIDDEN" });
  await assert.rejects(f.service.patch("current-event", owner, { role: "staff", wallet: guest.wallet, enabled: true, revision: 0 }), { code: "STALE_EVENT_ACCESS" });
  await assert.rejects(f.service.patch("current-event", owner, { role: "owner", wallet: guest.wallet, enabled: true, revision: f.r.revision }), { code: "INVALID_EVENT_ACCESS" });
  await assert.rejects(f.service.patch("current-event", owner, { role: "staff", wallet: ZERO, enabled: true, revision: f.r.revision }), { code: "INVALID_EVENT_ACCESS" });
  f.setAuthority({ pendingOwner: admin.wallet });
  assert.equal((await f.service.read("current-event", admin)).role, "pending-owner");
  await assert.rejects(patch(f, admin, "staff", guest), { code: "EVENT_ACCESS_FORBIDDEN" });
  await assert.rejects(f.service.checkin("current-event", admin, { wallet: guest.wallet, nonce: "pending-1", note: "Checked at the door" }), { code: "NOT_STAFF" });
  f.setAuthority({ pendingOwner: ZERO }); await patch(f, owner, "staff", staff, false);
  assert.equal((await f.service.read("current-event", staff)).role, "participant");
});

test("ownership change invalidates saved grants without rewriting them; explicit new-owner grant starts empty", async () => {
  const f = fixture(); await patch(f, owner, "admin", admin); await patch(f, admin, "staff", staff);
  const old = structuredClone(f.r.eventAccess); f.setAuthority({ owner: pending.wallet });
  assert.equal((await f.service.read("current-event", admin)).role, "participant");
  assert.deepEqual((await f.service.read("current-event", pending)).admins, []);
  assert.deepEqual(f.r.eventAccess, old, "An authority read cannot rewrite owner-bound roles");
  await assert.rejects(patch(f, admin, "staff", guest), { code: "EVENT_ACCESS_FORBIDDEN" });
  await patch(f, pending, "staff", guest);
  assert.equal(f.r.eventAccess.authorityOwner, pending.wallet); assert.deepEqual(f.r.eventAccess.admins, []);
  assert.deepEqual(f.r.eventAccess.staff.map(x => x.toLowerCase()), [guest.wallet]);
  const record = structuredClone(f.r);
  assert.equal(eventAccessRole(record, guest.wallet, { owner: pending.wallet, pendingOwner: ZERO }, origin), "staff");
  assert.equal(eventAccessRole(record, guest.wallet, { owner: pending.wallet, pendingOwner: ZERO }, "https://other.example.invalid"), "participant");
  assert.throws(() => validateEventAccessState({ ...record.eventAccess, contract: wallet(99) }, { ...record.deployment, registryHash: hash(record.deployment) }), { code: "STATE_SCOPE" });
});

test("fresh authority/session changes and failed persistence leave grants and observations unchanged", async () => {
  const f = fixture(); let calls = 0;
  f.deps.authority = async () => ({ owner: ++calls === 1 ? owner.wallet : pending.wallet, pendingOwner: ZERO, now: 1500 });
  f.service = createEventAccessService(f.deps);
  await assert.rejects(patch(f, owner, "admin", admin), { code: "STALE_EVENT_ACCESS" });
  assert.equal(f.r.revision, 0); assert.equal(f.r.eventAccess, undefined); assert.equal(f.stats().saves, 0);
  let valid = true; f.deps.authority = async () => { valid = false; return { owner: owner.wallet, pendingOwner: ZERO, now: 1500 }; };
  // The service captures callbacks, so construct independent instances for fault injections.
  const sessionService = createEventAccessService(f.deps);
  await assert.rejects(sessionService.patch("current-event", owner, { role: "admin", wallet: admin.wallet, enabled: true, revision: 0 },
    () => { if (!valid) throw Object.assign(Error("session changed"), { code: "UNAUTHENTICATED" }); }), { code: "UNAUTHENTICATED" });
  f.deps.authority = async () => ({ owner: owner.wallet, pendingOwner: ZERO, now: 1500 });
  let attempts = 0, durable = null;
  f.deps.persist = async (_id, next) => { durable = structuredClone(next); if (++attempts === 1) throw Error("synthetic save failure"); };
  const failed = createEventAccessService(f.deps);
  await assert.rejects(failed.patch("current-event", owner, { role: "admin", wallet: admin.wallet, enabled: true, revision: 0 }), /synthetic save failure/);
  assert.equal(f.r.revision, 0); assert.equal(f.r.eventAccess, undefined); assert.equal(durable.eventAccess, undefined);
  assert.equal(attempts, 2, "A failed/ambiguous write restores the current committed record");
});

test("same-event saves serialize, strict bodies reject extras and role capacities stay bounded", async () => {
  const f = fixture(); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  f.deps.authority = async () => { entered(); await gate; return { owner: owner.wallet, pendingOwner: ZERO, now: 1500 }; };
  const service = createEventAccessService(f.deps), body = { role: "admin", wallet: admin.wallet, enabled: true, revision: 0 };
  const first = service.patch("current-event", owner, body); await started;
  await assert.rejects(service.patch("current-event", owner, body), { code: "EVENT_ACCESS_BUSY" }); release(); await first;
  await assert.rejects(service.patch("current-event", owner, { ...body, revision: 1, scope: "other" }), { code: "INVALID_EVENT_ACCESS" });
  f.r.eventAccess.admins = Array.from({ length: 32 }, (_v, i) => wallet(i + 100));
  await assert.rejects(service.patch("current-event", owner, { ...body, revision: f.r.revision }), { code: "EVENT_ACCESS_CAPACITY" });
  assert.equal(f.r.eventAccess.admins.length, 32);
});

test("only authorized off-chain check-ins reach the door helper and its committed audit is wallet-only", async () => {
  const f = fixture(); await patch(f, owner, "staff", staff);
  const input = { wallet: guest.wallet, nonce: "door-nonce-123", note: "Observed at the event door" };
  await assert.rejects(f.service.checkin("current-event", guest, input), { code: "NOT_STAFF" });
  for (const value of [{ ...input, nonce: 12345678 }, { ...input, note: ["not a string"] }])
    await assert.rejects(f.service.checkin("current-event", staff, value), { code: "INVALID_EVENT_ACCESS" });
  const result = await f.service.checkin("current-event", staff, input);
  assert.deepEqual(result.checkins, [{ wallet: guest.wallet, actorWallet: staff.wallet, recordedAt: new Date(1500000).toISOString() }]);
  assert.equal(f.saved().observations.length, 1);
  await assert.rejects(f.service.checkin("current-event", staff, input), { code: "REPLAY" });
});

test("legacy door adapter preserves observation shape and optional note with the same save/session boundary", async () => {
  const f = fixture(); await patch(f, owner, "staff", staff);
  f.deps.resolveParticipant = (r, _s, id) => { assert.equal(id, "guest"); return r.participants.get(id); };
  const service = createEventAccessService(f.deps), input = { participantId: "guest", source: "staff-door", nonce: "old-door-nonce" };
  await assert.rejects(service.legacyCheckin("current-event", staff, { ...input, source: "manual" }), { code: "UNTRUSTED_SOURCE" });
  let authorized = true;
  f.deps.authority = async () => { authorized = false; return { owner: owner.wallet, pendingOwner: ZERO, now: 1500 }; };
  const revoked = createEventAccessService(f.deps);
  await assert.rejects(revoked.legacyCheckin("current-event", staff, input, () => {
    if (!authorized) throw Object.assign(Error("session changed"), { code: "UNAUTHENTICATED" });
  }), { code: "UNAUTHENTICATED" });
  assert.equal(f.r.observations.length, 0);
  const observation = await service.legacyCheckin("current-event", staff, input);
  assert.deepEqual(observation, { id: "observation-1", eventId: "current-event", participantId: "guest", source: "staff-door",
    reviewer: staff.wallet, timestamp: 1500, note: "", nonce: input.nonce });
  assert.equal(f.r.observations.length, 1); assert.equal(f.saved().observations.length, 1);
  await assert.rejects(service.checkin("current-event", staff, { wallet: guest.wallet, nonce: input.nonce, note: "Other door transport" }), { code: "REPLAY" });
});
