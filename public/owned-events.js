import {
  PRODUCTION_CONTRACT_VERSION,
  isVerifiedProductionEvent,
  isVerifiedProductionProfile,
} from "./contract-profiles.js";

const address = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-f]{40}$/i.test(value) &&
  !/^0x0{40}$/i.test(value);
const instance = (value) =>
  typeof value === "string" &&
  value.trim() === value &&
  value.length > 0 &&
  value.length <= 200 &&
  !/[\u0000-\u001f\u007f]/.test(value);
const stableId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
function timezone(value) {
  if (typeof value !== "string" || !value || value.length > 100) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}
function timestamp(value) {
  return typeof value === "string" &&
    value.length <= 100 &&
    /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : null;
}

/** Call only with a newly received authoritative bootstrap in the caller's current
 * generation. This projection cannot establish freshness or authenticate a wallet.
 * It supports the existing wallet-session DTO only; future account/recovery DTOs
 * require a separately reviewed adapter. Public catalog metadata is not accepted.
 */
export function projectOwnedEvents(bootstrap, expectedScope) {
  if (
    expectedScope?.mode !== "hosted-production" ||
    bootstrap?.mode !== expectedScope.mode ||
    !instance(expectedScope.instanceId) ||
    bootstrap.instanceId !== expectedScope.instanceId ||
    !address(expectedScope.wallet) ||
    bootstrap.session?.mode !== "wallet" ||
    !address(bootstrap.session.wallet) ||
    bootstrap.session.wallet.toLowerCase() !==
      expectedScope.wallet.toLowerCase() ||
    bootstrap.chain?.chainId !== 1 ||
    bootstrap.environment?.production !== true ||
    bootstrap.environment?.network !== "ethereum-mainnet" ||
    bootstrap.environment?.chainId !== 1 ||
    bootstrap.contractVersion !== PRODUCTION_CONTRACT_VERSION ||
    (bootstrap.abiVersion !== undefined &&
      bootstrap.abiVersion !== PRODUCTION_CONTRACT_VERSION) ||
    !isVerifiedProductionProfile(bootstrap.contractProfile) ||
    !Array.isArray(bootstrap.events)
  )
    return null;
  const records = bootstrap.events.filter(
    (event) => event?.role === "organizer",
  );
  const counts = new Map();
  for (const event of records)
    if (stableId(event.id))
      counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
  return Object.freeze(
    records.flatMap((event) => {
      if (
        !stableId(event.id) ||
        counts.get(event.id) !== 1 ||
        !isVerifiedProductionEvent(event) ||
        !address(event.contract) ||
        typeof event.title !== "string" ||
        !event.title.trim() ||
        event.title.length > 256 ||
        !["public", "private"].includes(event.visibility) ||
        !["published", "draft"].includes(event.editorialStatus)
      )
        return [];
      return [
        Object.freeze({
          id: event.id,
          title: event.title.trim(),
          startsAt: timestamp(event.startsAt),
          timezone: timezone(event.timezone),
          visibility: event.visibility,
          editorialStatus: event.editorialStatus,
        }),
      ];
    }),
  );
}
function date(event) {
  if (!event.startsAt || !event.timezone) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: event.timezone,
    }).format(new Date(event.startsAt));
  } catch {
    return "Date unavailable";
  }
}
/** Pure markup for projectOwnedEvents output. Links open a fresh guarded event view;
 * neither this renderer nor a displayed organizer role grants financial permission.
 */
export function renderOwnedEvents(view) {
  if (!Array.isArray(view))
    return '<section class="luma-launch-card" data-owned-events data-owned-state="unavailable"><h2>Your events</h2><p role="status">Owned events are unavailable. Sign in with the intended wallet and refresh the current event list.</p></section>';
  if (!view.length)
    return '<section class="luma-launch-card" data-owned-events data-owned-state="empty"><h2>Your events</h2><p role="status">No verified events available for this wallet yet.</p></section>';
  return `<section class="luma-launch-card" data-owned-events data-owned-state="ready"><h2>Your events</h2><ul class="public-event-list">${view.map((event) => `<li class="public-event-row" data-owned-event-row><div class="public-event-copy"><h3>${escape(event.title)}</h3><p class="public-event-date">${escape(date(event))}</p><span class="badge">${event.visibility === "private" ? "Private" : "Public"} · ${event.editorialStatus === "draft" ? "Draft" : "Published"}</span></div><a class="button button-secondary" data-owned-event-manage href="#${new URLSearchParams({ event: event.id, view: "organizer" })}" aria-label="Manage event: ${escape(event.title)}">Manage event</a></li>`).join("")}</ul></section>`;
}
