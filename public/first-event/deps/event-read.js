// Background transport only. Every result still comes from the original server checks.
const profile = "kleros-event-v10-uups";
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
  instanceId = null, wallet = null, onPending = () => {}, requestId = crypto.randomUUID() }) {
  current(signal, isCurrent);
  if (!stable(requestId) || !["bootstrap", "deposit", "validate", "confirm"].includes(operation)) fail("Invalid event check.");
  let job = await api("/api/event-read-jobs", { method: "POST", body: JSON.stringify({ requestId, operation, ...payload }), signal });
  let selectedInstance = instanceId;
  const expectedEvent = operation === "bootstrap" ? payload.selectedEventId : payload.eventId;
  const deadline = Date.now() + 185000;
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

export async function eventBootstrap({ path, api, signal = undefined, isCurrent, onPending }) {
  const url = new URL(path, "https://event-read.invalid");
  url.searchParams.set("background", "1");
  const discovery = await api(url.pathname + url.search, { signal });
  // Older servers and other contract versions return their unchanged bootstrap.
  if (discovery?.kind !== "event-read-transport") return discovery;
  if (discovery.enabled !== true || discovery.chainId !== 1 || discovery.contractVersion !== profile || !stable(discovery.instanceId))
    fail("The background event check is unavailable.");
  return eventReadJob({ api, signal, isCurrent, onPending, instanceId: discovery.instanceId,
    operation: "bootstrap", payload: { selectedEventId: url.searchParams.get("selectedEventId") } });
}
