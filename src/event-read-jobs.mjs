// Background transport only: existing authoritative methods execute once; results need fresh one-shot delivery.
import { createHash } from "node:crypto";
import { productionErrorResponse } from "./production-errors.mjs";
import { withReadJobScope } from "./read-job-scope.mjs";
const PROFILE = "kleros-event-v10-uups", PENDING_MS = 180000, READY_MS = 300000, FRESH_MS = 5000, DELIVERY_MS = 10000, MAX_RECORDS = 2048, MAX_BOOTSTRAPS = 256, MAX_QUEUED = 32;
const pureRead = operation => ["bootstrap", "deposit-inbox"].includes(operation);
const stable = (v, max = 160) => typeof v === "string" && new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(v);
const address = v => typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
const copy = v => structuredClone(v), own = (v, key) => v && typeof v === "object" ? Object.getOwnPropertyDescriptor(v, key)?.value : undefined;
const check = (ok, code, status, message) => { if (!ok) throw Object.assign(new Error(message), { code, status }); };
function exact(v, keys) {
  try { return v && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v)) &&
    Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")); } catch { return false; }
}
function payloadOf(body) {
  const operation = own(body, "operation");
  const factoryOnly = operation === "bootstrap" && Object.hasOwn(body, "factoryOnly");
  check(["bootstrap", "deposit", "validate", "confirm", "adopt-payer", "manage-draft", "participant-draft", "deposit-inbox"].includes(operation), "INVALID_INPUT", 400, "Choose an event read operation.");
  const keys = ["requestId", "operation", operation === "bootstrap" ? "selectedEventId" : "eventId",
    ...(["validate", "confirm"].includes(operation) ? ["draftId"] : []), ...(operation === "confirm" ? ["hash"] : []),
    ...(operation === "adopt-payer" ? ["wallet", "txHash", "confirmed", "note"] : []),
    ...(["manage-draft", "participant-draft"].includes(operation) ? ["action", "params"] : []), ...(operation === "deposit-inbox" ? ["refresh"] : []), ...(factoryOnly ? ["factoryOnly"] : [])];
  check(exact(body, keys) && stable(own(body, "requestId"), 100), "INVALID_INPUT", 400, "Use an exact scoped event request.");
  const eventId = own(body, operation === "bootstrap" ? "selectedEventId" : "eventId");
  check((operation === "bootstrap" && eventId === null) || stable(eventId), "INVALID_INPUT", 400, "Choose one stable event identity.");
  const payload = { operation, [operation === "bootstrap" ? "selectedEventId" : "eventId"]: eventId };
  if (factoryOnly) {
    check(eventId === null && own(body, "factoryOnly") === true, "INVALID_INPUT", 400, "Factory review cannot select an event.");
    payload.factoryOnly = true;
  }
  if (["validate", "confirm"].includes(operation)) {
    check(stable(own(body, "draftId")), "INVALID_INPUT", 400, "Choose the original event draft."); payload.draftId = own(body, "draftId");
  }
  if (operation === "confirm") {
    check(typeof own(body, "hash") === "string" && /^0x[0-9a-f]{64}$/i.test(own(body, "hash")), "INVALID_INPUT", 400, "Use the original transaction hash.");
    payload.hash = own(body, "hash").toLowerCase();
  }
  if (operation === "adopt-payer") {
    check(address(own(body, "wallet")) && typeof own(body, "txHash") === "string" && /^0x[0-9a-f]{64}$/i.test(own(body, "txHash")) &&
      own(body, "confirmed") === true && typeof own(body, "note") === "string" && own(body, "note").trim().length >= 8 && own(body, "note").length <= 1000,
      "INVALID_INPUT", 400, "Review the exact payer and canonical receipt.");
    Object.assign(payload, { wallet: own(body, "wallet"), txHash: own(body, "txHash").toLowerCase(), confirmed: true, note: own(body, "note") });
  }
  if (operation === "manage-draft") {
    const action = own(body, "action"), params = own(body, "params");
    check(["register", "reject", "postAttendance", "transferOwnership", "acceptOwnership"].includes(action) && params && typeof params === "object" && !Array.isArray(params),
      "INVALID_INPUT", 400, "Choose a reviewed registration, rejection or attendance action.");
    if (["transferOwnership", "acceptOwnership"].includes(action)) {
      check(action === "transferOwnership" ? exact(params, ["to"]) && address(own(params, "to")) : exact(params, []),
        "INVALID_INPUT", 400, "Choose one exact ownership transfer or acceptance.");
      Object.assign(payload, { action, params: copy(params) });
      return payload;
    }
    const manual = action === "postAttendance";
    check(exact(params, manual ? ["attendedWallets", "attendanceReview"] : ["wallets"]),
      "INVALID_INPUT", 400, "Use the exact selected-wallet review.");
    const wallets = own(params, manual ? "attendedWallets" : "wallets");
    check(Array.isArray(wallets) && wallets.length > 0 && wallets.length <= 150 && wallets.every(address) &&
      new Set(wallets.map(wallet => wallet.toLowerCase())).size === wallets.length,
      "INVALID_INPUT", 400, "Choose 1–150 unique wallets.");
    if (manual) {
      const review = own(params, "attendanceReview");
      check(exact(review, ["confirmed", "note"]) && own(review, "confirmed") === true && typeof own(review, "note") === "string" &&
        own(review, "note").trim().length >= 8 && own(review, "note").length <= 1000,
        "INVALID_INPUT", 400, "Explicitly confirm the organizer attendance review.");
    }
    Object.assign(payload, { action, params: copy(params) });
  }
  if (operation === "participant-draft") {
    const action = own(body, "action"), params = own(body, "params");
    check((action === "withdrawPending" && exact(params, [])) || (["challenge", "match", "resolve"].includes(action) &&
      (exact(params, []) || (action !== "challenge" && exact(params, ["wallet"]) && address(own(params, "wallet"))))),
      "INVALID_INPUT", 400, "Choose one exact participant challenge, matching, resolution or unused-credit recovery request.");
    Object.assign(payload, { action, params: copy(params) });
  }
  if (operation === "deposit-inbox") {
    check(typeof own(body, "refresh") === "boolean", "INVALID_INPUT", 400, "Choose whether to refresh the event deposit index.");
    payload.refresh = own(body, "refresh");
  }
  return payload;
}
function scopedRace(controller, fn) {
  const signal = controller.signal; signal.throwIfAborted(); let abort;
  const cancelled = new Promise((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true }); });
  let work; try { work = withReadJobScope(signal, fn); } catch (error) { work = Promise.reject(error); }
  const result = Promise.race([Promise.resolve(work), cancelled]), cleanup = () => signal.removeEventListener("abort", abort);
  result.then(cleanup, cleanup); return result;
}
const reason = () => Object.assign(new Error("Background read expired."), { code: "EVENT_READ_JOB_EXPIRED" });
function timer(controller, ms, expire) { const handle = setTimeout(() => { expire(); controller.abort(reason()); }, ms); handle.unref?.(); return handle; }

/** Trusted callbacks only. Wallet request IDs are permanent; expired pure-read bootstrap records have a separate bounded pool. */
export function createEventReadJobService({ instanceId, execute, deliver, isSessionCurrent, now = Date.now }) {
  check(stable(instanceId) && [execute, deliver, isSessionCurrent, now].every(v => typeof v === "function"),
    "INVALID_INPUT", 400, "Invalid event read service configuration.");
  const jobs = new Map(), bootstraps = new Map(), queue = [];
  let active = 0, lastTime = 0, reservation = null, pumpScheduled = false;
  function clock() { const value = now(); check(Number.isSafeInteger(value) && value >= 0, "INVALID_INPUT", 400, "Invalid event read clock."); return lastTime = Math.max(lastTime, value); }
  function actor(session, operation) {
    if (session === null) return operation === "bootstrap" ? { id: null, mode: null, wallet: null } : null;
    try { if (session && stable(session.id) && stable(session.mode) && isSessionCurrent(session) === true &&
      (operation === "bootstrap" || (session.mode === "wallet" && address(session.wallet))))
      return { id: session.id, mode: session.mode, wallet: address(session.wallet) ? session.wallet.toLowerCase() : null };
    } catch { /* Never disclose session diagnostics. */ } return null;
  }
  function belongs(job, session) { const current = job.session === session && actor(session, job.operation);
    return current && ["id", "mode", "wallet"].every(k => current[k] === job.owner[k]); }
  function requestPump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => { pumpScheduled = false; pump(); });
  }
  function releaseReservation(job) {
    if (reservation?.job !== job) return;
    clearTimeout(reservation.handle); reservation = null;
  }
  function expire(job) { job.state = "expired"; job.queued = false; delete job.result; delete job.error;
    delete job.payload;
    clearTimeout(job.timeout); releaseReservation(job);
    job.controller?.abort(reason()); job.deliveryController?.abort(reason()); requestPump(); }
  function deadline(job) {
    let end = job.completedAt + ((pureRead(job.operation) || job.operation === "validate") ? FRESH_MS : READY_MS);
    const draftExpiry = ["deposit", "manage-draft", "participant-draft"].includes(job.operation) ? job.result?.expiresAt : job.operation === "validate" ? job.result?.draft?.expiresAt ?? job.result?.d?.expiresAt : undefined;
    if (Number.isSafeInteger(draftExpiry)) end = Math.min(end, draftExpiry); return end;
  }
  function sweep(job) { const at = clock();
    if ((job.state === "pending" && at - job.startedAt >= PENDING_MS) ||
      (["ready", "delivering", "failed"].includes(job.state) && at >= deadline(job)) ||
      (job.state === "delivering" && at - job.deliveryStartedAt >= DELIVERY_MS)) expire(job);
  }
  function releaseElapsedReservation() {
    if (!reservation || clock() < reservation.until) return;
    const job = reservation.job; sweep(job); releaseReservation(job);
  }
  function reserveDelivery(job) {
    // Pollers normally return after one second. Give the completed result its
    // fresh delivery turn before another long execution can occupy the slot.
    // Unobserved drafts/receipts retain their original longer result deadlines.
    const until = Math.min(deadline(job), job.completedAt + FRESH_MS);
    const handle = setTimeout(() => {
      if (reservation?.job !== job) return;
      // The elapsed timer also bounds the reservation if the wall clock stalls.
      sweep(job); releaseReservation(job); requestPump();
    }, Math.max(0, until - clock()));
    handle.unref?.(); reservation = { job, until, handle };
  }
  function pump() {
    releaseElapsedReservation();
    if (active !== 0 || reservation) return;
    while (queue.length) {
      const job = queue.shift(); job.queued = false; sweep(job);
      if (job.state !== "pending") continue;
      if (!belongs(job, job.session)) { expire(job); continue; }
      job.running = true; active++;
      Promise.resolve().then(async () => {
        try {
          if (!belongs(job, job.session)) { expire(job); return; }
          const { operation, ...args } = copy(job.payload);
          const result = await scopedRace(job.controller, () => execute(operation,
            { session: job.session, ...args, signal: job.controller.signal }));
          job.completedAt = clock();
          if (job.state === "expired" || !belongs(job, job.session) || job.completedAt - job.startedAt >= PENDING_MS) expire(job);
          else { job.result = copy(result); job.state = "ready"; reserveDelivery(job); }
        } catch (error) { job.completedAt = clock();
          if (job.state === "expired" || !belongs(job, job.session) || job.completedAt - job.startedAt >= PENDING_MS) expire(job);
          else { job.error = productionErrorResponse(error).body; job.state = "failed"; }
        } finally {
          delete job.payload; clearTimeout(job.timeout); job.controller.abort(reason()); job.running = false; active--; requestPump();
        }
      }).catch(() => expire(job));
      return;
    }
  }
  const find = requestId => jobs.get(requestId) ?? bootstraps.get(requestId);
  function pruneBootstraps() { const at = clock();
    for (const [requestId, job] of bootstraps) {
      sweep(job);
      if (!job.running && !job.delivering && ["expired", "consumed"].includes(job.state) &&
        at >= (job.completedAt ?? job.startedAt) + FRESH_MS) bootstraps.delete(requestId);
    }
  }
  function envelope(job, state) { return { schemaVersion: 1, kind: "event-read-job", requestId: job.requestId, instanceId, chainId: 1, contractVersion: PROFILE,
      operation: job.operation, ...(job.eventId === null ? {} : { eventId: job.eventId }), ...(job.owner.wallet ? { wallet: job.owner.wallet } : {}), state,
      ...(state === "pending" ? { pollAfterMs: 1000 } : {}) }; }
  function metadata(job, error = false) { sweep(job); const state = ["ready", "delivering"].includes(job.state) ? "pending" : job.state === "consumed" ? "expired" : job.state;
    return copy({ ...envelope(job, state), ...(error && state === "failed" ? { error: job.error } : {}) }); }
  function lookup(session, requestId) { const job = stable(requestId, 100) ? find(requestId) : null, allowed = job && belongs(job, session);
    if (job && job.session === session && !allowed) expire(job);
    check(allowed, "EVENT_READ_JOB_NOT_FOUND", 404, "Event read not found."); return job; }
  return Object.freeze({
    start(session, body) {
      const payload = payloadOf(body), owner = actor(session, payload.operation), requestId = own(body, "requestId");
      const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex"), original = find(requestId);
      if (original && original.session === session && !belongs(original, session)) expire(original);
      check(owner, "UNAUTHENTICATED", 401, "Use the current wallet session for this operation.");
      pruneBootstraps(); const previous = find(requestId);
      if (previous) { lookup(session, requestId); check(previous.fingerprint === fingerprint, "EVENT_READ_JOB_CONFLICT", 409, "This request already has different immutable input."); return metadata(previous); }
      const records = pureRead(payload.operation) ? bootstraps : jobs, limit = pureRead(payload.operation) ? MAX_BOOTSTRAPS : MAX_RECORDS;
      check(records.size < limit, "EVENT_READ_JOB_CAPACITY", 503, "Event read capacity is full. Preserve existing request IDs.");
      check(queue.filter(job => job.queued && job.state === "pending").length < MAX_QUEUED,
        "EVENT_READ_JOB_CAPACITY", 503, "Event read queue is full. Preserve existing request IDs.");
      const job = { requestId, fingerprint, operation: payload.operation, eventId: payload.eventId ?? payload.selectedEventId,
        session, owner, payload: copy(payload), startedAt: clock(), state: "pending", running: false, queued: true, controller: new AbortController() };
      records.set(requestId, job); queue.push(job);
      job.timeout = timer(job.controller, PENDING_MS, () => expire(job)); pump();
      return metadata(job);
    },
    async status(session, requestId) {
      pruneBootstraps(); const job = lookup(session, requestId); sweep(job); releaseElapsedReservation();
      if (job.state !== "ready" || active !== 0 || (reservation && reservation.job !== job)) return metadata(job, true);
      releaseReservation(job);
      job.state = "delivering"; job.delivering = true; job.deliveryStartedAt = clock(); job.deliveryController = new AbortController(); active++;
      const timeout = timer(job.deliveryController, DELIVERY_MS, () => expire(job));
      try {
        const result = await scopedRace(job.deliveryController, () => deliver(job.operation, copy(job.result),
          { session, eventId: job.eventId, signal: job.deliveryController.signal }));
        // Fresh delivery is the last asynchronous boundary. Never expose a cached private result.
        const at = clock();
        if (job.state !== "delivering" || !belongs(job, session) || at >= deadline(job) || at - job.deliveryStartedAt >= DELIVERY_MS) { expire(job); return metadata(job); }
        const response = copy({ ...envelope(job, "ready"), result, expiresAt: deadline(job) });
        job.state = "consumed"; delete job.result; delete job.error; return response;
      } catch (error) {
        if (job.state === "expired" || !belongs(job, session)) { expire(job); return metadata(job); }
        expire(job); return { ...metadata(job), state: "failed", error: productionErrorResponse(error).body };
      } finally { clearTimeout(timeout); job.deliveryController.abort(reason()); job.delivering = false; active--; requestPump(); }
    },
  });
}
