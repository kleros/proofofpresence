// Public transaction capabilities never authenticate a wallet-login session.
// Guard equivalence is exercised against actual local contracts in
// test/public-transaction-actor.test.mjs; the original financial methods remain.
import { randomBytes, randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { createEventReadJobService } from "./event-read-jobs.mjs";
import { createOrganizerJobService } from "./organizer-jobs.mjs";

const PROFILE = "kleros-event-v10-uups", TTL = 30 * 60 * 1000, MAX_FLOWS = 128, MAX_RETAINED = MAX_FLOWS + 4096, MAX_JOBS = 32;
const REQUESTER_ACTIVE = 16, MINT_BURST = 24, MINT_REFILL_MS = 1000, MAX_REQUESTERS = 4096;
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const check = (ok, code = "PUBLIC_FLOW_SCOPE", status = 403) => {
  if (!ok) throw Object.assign(new Error(code === "PUBLIC_FLOW_NOT_FOUND" ? "This transaction flow expired. Preserve any original transaction ID."
    : code === "PUBLIC_FLOW_CAPACITY" ? "Transaction preparation is busy. Preserve existing transaction IDs."
      : code === "PUBLIC_FLOW_RATE_LIMIT" ? "Too many wallet requests from this connection. Try again shortly."
        : code === "PUBLIC_FLOW_REQUESTER_UNAVAILABLE" ? "A trusted application connection is required."
      : "The transaction belongs to another flow, wallet or public target."), { code, status });
};
const exact = (v, keys) => v && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v)) &&
  Reflect.ownKeys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(v, key), "value"));

export function createPublicTransactionService(w, { origin, instanceId, walletContext, bootstrapDTO,
  onCreationConfirmed = async () => {}, now = Date.now }) {
  check(new URL(origin).origin === origin && new URL(origin).protocol === "https:" && typeof instanceId === "string" && instanceId &&
    typeof walletContext === "function" && typeof bootstrapDTO === "function");
  const flows = new Map(), actors = new WeakMap(), requesters = new Map();
  const unused = f => !f.prepareId && !f.draftId && !f.hash && f.jobs.size === 0;
  const discard = f => { flows.delete(f.token); actors.delete(f.actor); };
  function admit(requester) {
    check(typeof requester === "string" && /^[0-9a-f]{64}$/.test(requester), "PUBLIC_FLOW_REQUESTER_UNAVAILABLE", 503);
    const time = now();
    for (const f of flows.values()) if (time >= f.expiresAt) discard(f);
    for (const [key, bucket] of requesters)
      if (time - bucket.updatedAt >= MINT_BURST * MINT_REFILL_MS) requesters.delete(key);
    let bucket = requesters.get(requester);
    if (!bucket) {
      check(requesters.size < MAX_REQUESTERS, "PUBLIC_FLOW_CAPACITY", 503);
      bucket = { tokens: MINT_BURST, updatedAt: time }; requesters.set(requester, bucket);
    }
    bucket.tokens = Math.min(MINT_BURST, bucket.tokens + Math.max(0, time - bucket.updatedAt) / MINT_REFILL_MS);
    bucket.updatedAt = Math.max(bucket.updatedAt, time);
    check(bucket.tokens >= 1, "PUBLIC_FLOW_RATE_LIMIT", 429);
    // Confirmed capabilities retain their original tokens/actors/hash bindings,
    // but no longer occupy the preparation budget. Both pools stay bounded.
    const active = [...flows.values()].filter(f => !f.completed).length;
    const full = active >= MAX_FLOWS || flows.size >= MAX_RETAINED;
    const own = [...flows.values()].filter(f => f.requester === requester && !f.completed);
    // Never replace a draft, in-flight job or hash binding. An unopened capability
    // is safe to reclaim; a caller cannot monopolize capacity merely by minting.
    const reclaim = own.length >= REQUESTER_ACTIVE ? own.find(unused)
      : full ? [...flows.values()].find(unused) : null;
    check(own.length < REQUESTER_ACTIVE || reclaim, "PUBLIC_FLOW_RATE_LIMIT", 429);
    check(!full || reclaim, "PUBLIC_FLOW_CAPACITY", 503);
    if (reclaim) discard(reclaim);
    bucket.tokens -= 1;
  }
  const current = actor => { const f = actors.get(actor); return !!f && flows.get(f.token) === f && now() < f.expiresAt; };
  const bound = f => {
    check(f && current(f.actor), "PUBLIC_FLOW_NOT_FOUND", 404);
    const target = w.publicTransactionTarget(f.kind);
    check(same(target.contract, f.target.contract) && target.eventId === f.target.eventId);
    return f;
  };
  const find = token => { const f = /^[0-9a-f]{64}$/.test(token ?? "") ? flows.get(token) : null;
    check(f && current(f.actor), "PUBLIC_FLOW_NOT_FOUND", 404); return bound(f); };
  const ownDraft = (f, draftId) => check(typeof draftId === "string" && f.draftId === draftId);
  const original = (f, txHash) => {
    check(/^0x[0-9a-f]{64}$/i.test(txHash ?? ""));
    check(!f.hash || same(f.hash, txHash), "PUBLIC_FLOW_CONFLICT", 409);
    f.hash ??= txHash.toLowerCase();
  };
  const metadata = f => structuredClone({ schemaVersion: 1, kind: "public-transaction-flow", flowKind: f.kind, token: f.token,
    wallet: f.actor.wallet, mode: "hosted-production", instanceId, chainId: 1, contractVersion: PROFILE,
    ...f.target, expiresAt: f.expiresAt, walletContext: walletContext() });
  const eventJobs = createEventReadJobService({ instanceId, isSessionCurrent: current,
    execute: async (operation, { session: actor, eventId, draftId, hash }) => {
      const f = bound(actors.get(actor));
      if (operation === "bootstrap") return bootstrapDTO(await w.bootstrap(actor, { factoryOnly: true }), actor, false, actor);
      if (operation === "deposit") {
        const result = await w.createDepositReview(eventId, actor);
        f.draftId = result.id;
        return { ...result, depositReview: bootstrapDTO(Reflect.get(result, "depositReview"), actor, true, actor) };
      }
      ownDraft(f, draftId);
      if (operation === "validate") {
        const result = await w.validateDraft(eventId, actor, draftId);
        return { transaction: result.d.transaction, draft: { id: result.d.id, expiresAt: result.d.expiresAt } };
      }
      original(f, hash);
      f.completed = false;
      return w.reconcilePublicTransaction(actor, draftId, hash);
    },
    deliver: async (operation, result, { session: actor, eventId }) => {
      const f = bound(actors.get(actor));
      // An unseen hash is flow-local and has no global pending entry yet.
      if (operation === "confirm" && result.status === "pending" && !w.events.get(eventId)?.transactions.some(t => same(t.hash, result.hash)))
        return result;
      const disclosed = await w.finalizeReadResult(operation, result, actor, eventId);
      bound(f);
      if (operation === "confirm" && disclosed.status === "confirmed") f.completed = true;
      return operation === "bootstrap" ? bootstrapDTO(disclosed, actor, false, actor) : disclosed;
    },
  });
  const factory = w.publicTransactionTarget("create").contract;
  const organizerJobs = createOrganizerJobService({ instanceId, factory, contractVersion: PROFILE, isSessionCurrent: current, maxRecords: 4096,
    execute: async (operation, { session: actor, input, draftId, hash }) => {
      const f = bound(actors.get(actor));
      if (operation === "prepare") {
        const draft = await w.createFactoryDraft(actor, input); f.draftId = draft.id;
        return { ...draft, creationContext: bootstrapDTO(draft.creationContext, actor, false, actor) };
      }
      ownDraft(f, draftId);
      if (operation === "validate") { const draft = await w.validateFactoryDraft(actor, draftId); return { draft, transaction: draft.transaction }; }
      f.completed = false;
      let result;
      if (operation === "reconcile") { original(f, hash); result = await w.reconcilePublicTransaction(actor, draftId, hash); }
      else result = await w.reconcileFactoryReplacement(actor, draftId, hash);
      if (result.status === "confirmed") await onCreationConfirmed();
      if (result.status === "confirmed") f.completed = true;
      return { ...result, ...(result.status === "confirmed"
        ? { participantUrl: `${origin}/#event=${encodeURIComponent(result.eventId)}&view=participant` } : {}) };
    },
  });
  function reserveJob(f, body, kind) {
    check(typeof body?.requestId === "string");
    const key = `${kind}:${body.requestId}`;
    if (!f.jobs.has(key)) { check(f.jobs.size < MAX_JOBS, "PUBLIC_FLOW_CAPACITY", 503); f.jobs.add(key); }
    if ((kind === "event" && body.operation === "deposit") || (kind === "organizer" && body.operation === "prepare")) {
      check(!f.prepareId || f.prepareId === key, "PUBLIC_FLOW_CONFLICT", 409); f.prepareId ??= key;
    }
  }
  return Object.freeze({
    create(input, requester) {
      check(exact(input, ["wallet", "kind"]) && ethers.isAddress(input.wallet) && BigInt(input.wallet) !== 0n &&
        ["deposit", "create"].includes(input.kind));
      admit(requester);
      const token = randomBytes(32).toString("hex"), target = w.publicTransactionTarget(input.kind);
      const f = { token, kind: input.kind, target, requester, expiresAt: now() + TTL, jobs: new Set(), completed: false,
        actor: w.createPublicTransactionActor(input.wallet, `public-${randomUUID()}`, input.kind), draftId: null, hash: null, prepareId: null };
      flows.set(token, f); actors.set(f.actor, f);
      return metadata(f);
    },
    read: token => metadata(find(token)),
    async directDeposit(token, input) {
      const f = find(token);
      check(f.kind === "deposit" && exact(input, []));
      check(!f.prepareId && !f.hash, "PUBLIC_FLOW_CONFLICT", 409);
      f.prepareId = "direct-deposit";
      const draft = await w.createDirectDeposit(f.actor);
      bound(f); f.draftId = draft.id;
      return draft;
    },
    async directPrepare(token, input) {
      const f = find(token);
      check(f.kind === "deposit" && exact(input, []));
      check(!f.prepareId && !f.hash, "PUBLIC_FLOW_CONFLICT", 409);
      // Share the legacy preparation family: neither route can mint a second
      // draft for a flow that is already preparing or has possibly been sent.
      f.prepareId = "direct-deposit";
      const draft = await w.prepareDirectDeposit(f.actor);
      bound(f); f.draftId = draft.id;
      return draft;
    },
    async directValidate(token, input) {
      const f = find(token);
      check(f.kind === "deposit" && exact(input, ["draftId"])); ownDraft(f, input.draftId);
      check(f.prepareId === "direct-deposit" && !f.hash, "PUBLIC_FLOW_CONFLICT", 409);
      const result = await w.validateDirectDeposit(f.actor, input.draftId);
      bound(f); return result;
    },
    eventStart(token, body) {
      const f = find(token);
      check(f.kind === "deposit" ? ["deposit", "validate", "confirm"].includes(body?.operation) && body.eventId === f.target.eventId
        : body?.operation === "bootstrap" && body.selectedEventId === null && body.factoryOnly === true);
      if (["validate", "confirm"].includes(body.operation)) ownDraft(f, body.draftId);
      if (body.operation === "confirm") original(f, body.hash);
      reserveJob(f, body, "event"); return eventJobs.start(f.actor, body);
    },
    eventStatus(token, requestId) { const f = find(token); check(f.jobs.has(`event:${requestId}`)); return eventJobs.status(f.actor, requestId); },
    organizerStart(token, body) {
      const f = find(token); check(f.kind === "create" && ["prepare", "validate", "reconcile", "replacement"].includes(body?.operation));
      if (body.operation !== "prepare") ownDraft(f, body.draftId);
      if (body.operation === "reconcile") original(f, body.hash);
      reserveJob(f, body, "organizer"); return organizerJobs.start(f.actor, body);
    },
    organizerStatus(token, requestId) { const f = find(token); check(f.jobs.has(`organizer:${requestId}`)); return organizerJobs.status(f.actor, requestId); },
    async submitted(token, input) {
      const f = find(token); check(exact(input, ["draftId", "hash"])); ownDraft(f, input.draftId); original(f, input.hash);
      const result = await w.publicTransactionSubmitted(f.actor, input.draftId, input.hash);
      bound(f); return result;
    },
  });
}
