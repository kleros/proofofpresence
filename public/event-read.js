// Background transport only. Every result still comes from the original server checks.
const profile = "kleros-event-v10-uups";
import { EVENT, firstEventById } from "./first-event/event.js";
export const FIRST_EVENT_READ_CONTEXT = Object.freeze({ id: EVENT.id, chainId: EVENT.chainId,
  contract: EVENT.contract, abiVersion: EVENT.abiVersion, mode: EVENT.mode });
const stable = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
function fail(message, code = "EVENT_READ_UNAVAILABLE") { throw Object.assign(new Error(message), { code }); }
function current(signal, isCurrent) {
  if (signal?.aborted) throw new DOMException("The view changed.", "AbortError");
  if (!isCurrent()) fail("The event or wallet changed. Check the current view again.", "EVENT_READ_CONTEXT_CHANGED");
}
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("The view changed.", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export async function eventReadJob({ api, operation, payload, signal = undefined, isCurrent = () => true,
  instanceId = null, wallet = null, expectedContext = null, onPending = () => {}, requestId = crypto.randomUUID() }) {
  current(signal, isCurrent);
  if (!stable(requestId) || !["bootstrap", "deposit", "validate", "confirm", "deposit-inbox", "adopt-payer", "manage-draft", "participant-draft"].includes(operation)) fail("Invalid event check.");
  const expectedEvent = operation === "bootstrap" ? payload.selectedEventId : payload.eventId;
  const selectedFirstEvent = firstEventById(expectedEvent);
  const firstEventScope = selectedFirstEvent && stable(instanceId) &&
    expectedContext?.id === selectedFirstEvent.id && expectedContext.chainId === 1 &&
    same(expectedContext.contract, selectedFirstEvent.contract) &&
    expectedContext.abiVersion === profile && expectedContext.mode === "hosted-production";
  if (["deposit-inbox", "adopt-payer", "manage-draft", "participant-draft"].includes(operation) && !firstEventScope)
    fail("First-event organizer checks are unavailable for this event.");
  const body = JSON.stringify({ requestId, operation, ...payload });
  const startDeadline = Date.now() + 30000;
  const deadline = Date.now() + 185000;
  const busyWaits = [750, 1500, 2500, 4000, 5000, 5000, 5000];
  let job, attempt = 0;
  // BUSY is a sanitized pre-execution rejection from this one endpoint. Keep the
  // identical request identity/body; no wallet, auth or submission call retries.
  for (;;) {
    current(signal, isCurrent);
    try {
      job = await api("/api/event-read-jobs", { method: "POST", body, signal });
      break;
    } catch (error) {
      current(signal, isCurrent);
      const wait = busyWaits[attempt++];
      if (!firstEventScope || error?.code !== "EVENT_READ_JOB_BUSY" || wait === undefined || Date.now() + wait > startDeadline) throw error;
      await pause(wait, signal);
      current(signal, isCurrent);
    }
  }
  let selectedInstance = instanceId;
  for (;;) {
    current(signal, isCurrent);
    if (job?.kind !== "event-read-job" || job.schemaVersion !== 1 || job.requestId !== requestId ||
      job.operation !== operation || job.chainId !== 1 || job.contractVersion !== profile || !stable(job.instanceId) ||
      (selectedInstance && job.instanceId !== selectedInstance) ||
      (expectedEvent === null ? job.eventId !== undefined : job.eventId !== expectedEvent) ||
      (wallet && !same(job.wallet, wallet))) fail("The event check returned a different wallet, event or server.", "EVENT_READ_CONTEXT_CHANGED");
    selectedInstance ??= job.instanceId;
    if (job.state === "ready") {
      if (!Number.isSafeInteger(job.expiresAt) || Date.now() >= job.expiresAt) fail("This check expired. Request a fresh review.", "EVENT_READ_EXPIRED");
      return job.result;
    }
    if (job.state === "failed") fail(job.error?.error ?? "The event check could not finish.", job.error?.code ?? "EVENT_READ_UNAVAILABLE");
    if (job.state === "expired") fail("This check expired. Keep any submitted transaction ID and check again.", "EVENT_READ_EXPIRED");
    if (job.state !== "pending" || !Number.isSafeInteger(job.pollAfterMs) || job.pollAfterMs < 500 || job.pollAfterMs > 5000)
      fail("The event check returned an invalid status.");
    if (Date.now() >= deadline) fail("The event check is still running. Keep its request and transaction IDs.", "EVENT_READ_EXPIRED");
    onPending(job);
    await pause(job.pollAfterMs, signal); current(signal, isCurrent);
    job = await api(`/api/event-read-jobs/${encodeURIComponent(requestId)}`, { signal });
  }
}

export async function eventBootstrap({ path, api, signal = undefined, isCurrent, onPending, expectedContext = null,
  instanceId = null, wallet = null }) {
  const url = new URL(path, "https://event-read.invalid");
  url.searchParams.set("background", "1");
  const discovery = await api(url.pathname + url.search, { signal });
  // Older servers and other contract versions return their unchanged bootstrap.
  if (discovery?.kind !== "event-read-transport") return discovery;
  if (discovery.enabled !== true || discovery.chainId !== 1 || discovery.contractVersion !== profile || !stable(discovery.instanceId))
    fail("The background event check is unavailable.");
  if (firstEventById(expectedContext?.id) && instanceId && instanceId !== discovery.instanceId)
    fail("The event server changed. Reconnect before checking this event.", "EVENT_READ_CONTEXT_CHANGED");
  return eventReadJob({ api, signal, isCurrent, onPending, expectedContext, wallet, instanceId: discovery.instanceId,
    operation: "bootstrap", payload: { selectedEventId: url.searchParams.get("selectedEventId") } });
}

// Public account-policy metadata only. This does not load an event, establish a
// session or grant transaction authority. Callers still verify the exact account
// and obtain a fresh authenticated event bundle before enabling any payment.
export async function eventWalletContext({ api, signal = undefined, isCurrent = () => true, instanceId = null }) {
  current(signal, isCurrent);
  const discovery = await api("/api/bootstrap?background=1", { signal });
  current(signal, isCurrent);
  const context = discovery?.walletContext;
  if (discovery?.kind !== "event-read-transport" || discovery.enabled !== true || discovery.chainId !== 1 ||
      discovery.contractVersion !== profile || !stable(discovery.instanceId) || !context)
    fail("The public wallet sign-in context is unavailable.");
  if ((instanceId && discovery.instanceId !== instanceId) || context.instanceId !== discovery.instanceId ||
      context.mode !== "hosted-production" || context.contractVersion !== profile || context.abiVersion !== profile ||
      context.chain?.chainId !== 1 || context.environment?.chainId !== 1 || context.environment.production !== true ||
      context.environment.network !== "ethereum-mainnet" || context.contractProfile?.verified !== true ||
      context.capabilities?.transactionsReady !== false || context.capabilities.createEvents !== false ||
      context.capabilities.manageEvents !== false || !context.walletSupport ||
      ["session", "events", "selectedEvent", "factory", "role", "ownWallet"].some(key => Object.hasOwn(context, key)))
    fail("The wallet sign-in context belongs to a different server or network, or includes event authority.", "EVENT_READ_CONTEXT_CHANGED");
  return context;
}
