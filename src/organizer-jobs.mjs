// Async transport for existing unsigned organizer work. No provider, signer, retry or transaction sender.
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { productionErrorResponse } from "./production-errors.mjs";

const PROFILE = "kleros-event-v9-uups", PENDING_MS = 180_000, READY_MS = 300_000, VALIDATION_MS = 5_000;
const stable = (value, max = 100) => typeof value === "string" && new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(value);
const copy = (value) => structuredClone(value);
const fail = (code, status, message) => { throw Object.assign(new Error(message), { code, status }); };
const check = (ok, code, status, message) => { if (!ok) fail(code, status, message); };
function exact(value, keys) {
  return value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
}
function payloadOf(body) {
  const operation = body && typeof body === "object" ? Object.getOwnPropertyDescriptor(body, "operation")?.value : undefined;
  check(["prepare", "validate", "reconcile", "replacement"].includes(operation), "INVALID_INPUT", 400, "Choose an organizer review operation.");
  const keys = body.operation === "prepare" ? ["requestId", "operation", "input"]
    : body.operation === "validate" ? ["requestId", "operation", "draftId"] : ["requestId", "operation", "draftId", "hash"];
  check(exact(body, keys) && stable(body.requestId), "INVALID_INPUT", 400, "Use an exact scoped organizer request.");
  if (body.operation === "prepare") {
    const limits = { title: 160, lumaUrl: 1000, startsAt: 40, endsAt: 40, timezone: 100, depositEth: 100 };
    check(exact(body.input, Object.keys(limits)) && Object.entries(limits).every(([key, limit]) =>
      typeof body.input[key] === "string" && body.input[key].length <= limit), "INVALID_INPUT", 400, "Use the six organizer event terms.");
    return { operation: "prepare", input: Object.fromEntries(Object.keys(limits).map((key) => [key, body.input[key]])) };
  }
  check(stable(body.draftId, 160), "INVALID_INPUT", 400, "Choose the original organizer draft.");
  if (body.operation === "validate") return { operation: "validate", draftId: body.draftId };
  check(typeof body.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(body.hash), "INVALID_INPUT", 400, "Use the exact submitted transaction hash.");
  return { operation: body.operation, draftId: body.draftId, hash: body.hash.toLowerCase() };
}

/**
 * Jobs live only in this server instance and never evict consumed identities. Capacity exhaustion fails closed.
 * isSessionCurrent is synchronous and must check the trusted server's original session, never a supplied actor claim.
 * @param {{instanceId:string,factory:string,execute:(operation:string,context:any)=>any,
 * isSessionCurrent:(session:any)=>boolean,contractVersion?:string,now?:()=>number,maxActive?:number,maxRecords?:number}} options
 */
export function createOrganizerJobService({ instanceId, factory, execute, isSessionCurrent, contractVersion = PROFILE, now = Date.now, maxActive = 1, maxRecords = 128 }) {
  check(stable(instanceId, 160) && ethers.isAddress(factory) && factory.toLowerCase() !== ethers.ZeroAddress &&
    typeof execute === "function" && typeof isSessionCurrent === "function" && typeof now === "function" &&
    Number.isSafeInteger(maxActive) && maxActive >= 1 && maxActive <= 64 &&
    Number.isSafeInteger(maxRecords) && maxRecords >= 1 && maxRecords <= 4096 &&
    [PROFILE, "kleros-event-v10-uups"].includes(contractVersion),
  "INVALID_INPUT", 400, "Invalid organizer job configuration.");
  factory = ethers.getAddress(factory);
  const jobs = new Map(); let active = 0, lastTime = 0;
  function clock() {
    const value = now(); check(Number.isSafeInteger(value) && value >= 0, "INVALID_INPUT", 400, "Invalid organizer job clock.");
    return (lastTime = Math.max(lastTime, value));
  }
  function actor(session) {
    try {
      if (session?.mode === "wallet" && stable(session.id, 160) && ethers.isAddress(session.wallet) &&
        session.wallet.toLowerCase() !== ethers.ZeroAddress && isSessionCurrent(session) === true)
        return { id: session.id, wallet: ethers.getAddress(session.wallet) };
    } catch { /* Session failures disclose no job identity or result. */ }
    return null;
  }
  function belongs(job, session) {
    const current = actor(session);
    return current && job.sessionId === current.id && job.wallet === current.wallet;
  }
  function dto(job) {
    const at = clock(), age = at - (job.completedAt ?? job.startedAt);
    let expiresAt = job.completedAt === undefined ? null : job.completedAt + (job.operation === "validate" ? VALIDATION_MS : READY_MS);
    const draftExpiry = job.operation === "prepare" ? job.result?.expiresAt
      : job.operation === "validate" ? job.result?.draft?.expiresAt : undefined;
    if (expiresAt !== null && Number.isSafeInteger(draftExpiry) && draftExpiry >= 0)
      expiresAt = Math.min(expiresAt, draftExpiry);
    const expired = job.state === "expired" || (job.state === "pending" && age >= PENDING_MS) ||
      (expiresAt !== null && at >= expiresAt);
    const state = expired ? "expired" : job.state;
    return copy({ schemaVersion: 1, kind: "organizer-job", requestId: job.requestId, instanceId,
      operation: job.operation, chainId: 1, factory, contractVersion, wallet: job.wallet, state,
      ...(state === "pending" ? { pollAfterMs: 1000 } : {}),
      ...(state === "ready" ? { result: job.result, expiresAt } : {}),
      ...(state === "failed" ? { error: job.error } : {}) });
  }
  function lookup(session, requestId) {
    const job = stable(requestId) ? jobs.get(requestId) : null;
    check(job && belongs(job, session), "ORGANIZER_JOB_NOT_FOUND", 404, "Organizer job not found.");
    return job;
  }
  return Object.freeze({
    start(session, body) {
      const owner = actor(session);
      check(owner, "UNAUTHENTICATED", 401, "Sign in with your wallet first.");
      const payload = payloadOf(body), requestId = body.requestId;
      check(payload.operation !== "replacement" || contractVersion === "kleros-event-v10-uups",
        "INVALID_INPUT", 400, "Fee-replacement recovery requires the reviewed V10 profile.");
      const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      const prior = jobs.get(requestId);
      if (prior) {
        check(belongs(prior, session), "ORGANIZER_JOB_NOT_FOUND", 404, "Organizer job not found.");
        check(prior.fingerprint === fingerprint, "ORGANIZER_JOB_CONFLICT", 409, "This organizer request already has different immutable input.");
        return dto(prior); // Includes completed/expired tombstones; never invoke execute again.
      }
      check(jobs.size < maxRecords, "ORGANIZER_JOB_CAPACITY", 503, "Organizer review capacity is full. Preserve existing request IDs.");
      check(active < maxActive && ![...jobs.values()].some((job) => job.running && job.wallet === owner.wallet),
        "ORGANIZER_JOB_BUSY", 409, "An organizer operation is still running. Check its existing request ID.");
      const job = { requestId, fingerprint, operation: payload.operation, sessionId: owner.id, wallet: owner.wallet,
        startedAt: clock(), state: "pending", running: true };
      jobs.set(requestId, job); active++; // Reserve synchronously before scheduling any execution.
      Promise.resolve().then(async () => {
        try {
          if (!belongs(job, session)) { job.state = "expired"; return; }
          const { operation, ...args } = copy(payload);
          const result = await execute(operation, { session, ...args });
          const returnedProfile = operation === "validate" ? result?.draft?.contractVersion : result?.contractVersion;
          check(returnedProfile === undefined || returnedProfile === contractVersion,
            "DRAFT_SCOPE", 409, "The organizer result belongs to another contract profile.");
          job.completedAt = clock();
          if (!belongs(job, session) || job.completedAt - job.startedAt >= PENDING_MS) job.state = "expired";
          else { job.result = copy(result); job.state = "ready"; }
        } catch (error) {
          job.completedAt = clock();
          if (!belongs(job, session) || job.completedAt - job.startedAt >= PENDING_MS) job.state = "expired";
          else { job.error = productionErrorResponse(error).body; job.state = "failed"; }
        } finally { job.running = false; active--; }
      }).catch(() => { job.state = "expired"; job.running = false; });
      return dto(job);
    },
    status(session, requestId) { return dto(lookup(session, requestId)); },
  });
}
