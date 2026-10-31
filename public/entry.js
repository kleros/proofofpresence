// Fixed public identities only; discover the application graph after metadata.
import { EVENT, firstEventById, isPreviousFirstEvent } from "./first-event/event.js";
let fullRequested = false,
  epoch = 0,
  home = null,
  initialAbort = null,
  firstEventView = null,
  firstEventPending = false;
const homeRoute = () => {
  const route = new URLSearchParams(location.hash.slice(1));
  return !route.get("event") && route.get("setup") !== "kickback";
};
// Older recovery buttons produced this exact bookmark. Keep it on the saved-data
// recovery page; the withdrawal controller performs fresh checks when requested.
function normalizePreviousRecovery() {
  if (location.search) return;
  const route = new URLSearchParams(location.hash.slice(1));
  if (route.getAll("event").length !== 1 || route.getAll("view").length !== 1 ||
      route.getAll("review").length !== 1 || route.get("view") !== "participant" || route.get("review") !== "1" ||
      !isPreviousFirstEvent(firstEventById(route.get("event"))) ||
      [...route.keys()].some(key => !["event", "view", "review"].includes(key))) return;
  route.delete("review"); route.set("deposit", "manage");
  history.replaceState(null, "", "#" + route);
}
// Only simple public routes may bypass the guarded application. Preserve every
// additional action/recovery parameter for that application's original route.
function firstEventRouteView() {
  const route = new URLSearchParams(location.hash.slice(1));
  const recovery = route.get("view") === "participant" && route.getAll("deposit").length === 1 && route.get("deposit") === "manage";
  if (route.getAll("event").length !== 1 || route.getAll("view").length > 1 ||
      !firstEventById(route.get("event")) ||
      [...route.keys()].some(key => key !== "event" && key !== "view" && !(recovery && key === "deposit")) ||
      ![null, "participant", "organizer"].includes(route.get("view"))) return null;
  return recovery || route.get("event") !== EVENT.id ? "recovery" : route.get("view") ?? "participant";
}
function firstEventRoute() {
  return ["organizer", "recovery"].includes(firstEventRouteView());
}
function redirectFirstEventParticipant() {
  if (location.search || firstEventRouteView() !== "participant") return false;
  location.replace("/first-event/");
  return true;
}
function disposeFirstEvent() {
  firstEventView?.dispose();
  firstEventView = null;
  firstEventPending = false;
  document.querySelector("#refresh").onclick = null;
}
async function showFirstEvent() {
  if (fullRequested) return;
  const ownEpoch = ++epoch;
  home?.dispose(); home = null;
  initialAbort?.(); initialAbort = null;
  disposeFirstEvent();
  firstEventPending = true;
  try {
    const { mountFirstEventDisplay } = await import("./first-event-display.js");
    if (fullRequested || ownEpoch !== epoch || !firstEventRoute()) return;
    firstEventPending = false;
    const root = document.querySelector("#content");
    document.body.classList.add("launch-mode");
    document.body.classList.remove("initial-shell");
    document.querySelector("#loading").hidden = true;
    root.hidden = false; root.setAttribute("aria-busy", "false");
    document.querySelector("#environment").textContent = "ETHEREUM MAINNET";
    document.querySelector("#top-identity").hidden = true;
    const view = firstEventRouteView();
    firstEventView = mountFirstEventDisplay({ root, view, event: firstEventById(new URLSearchParams(location.hash.slice(1)).get("event")), onReview: (intent) => {
      if (fullRequested || ownEpoch !== epoch || !firstEventRoute()) return;
      const params = new URLSearchParams(location.hash.slice(1));
      params.delete("deposit");
      if (intent?.action === "checkin" && /^0x[0-9a-f]{40}$/i.test(intent.wallet ?? "")) params.set("checkin", intent.wallet);
      params.set("review", "1");
      history.replaceState(null, "", "#" + params);
      handoff();
    } });
    const refresh = document.querySelector("#refresh");
    refresh.disabled = false;
    refresh.title = "Refresh public depositor records";
    refresh.onclick = () => { void firstEventView?.refresh(); };
    document.title = view === "organizer" ? "Manage Event · Truth Pays" : "Your deposit · Truth Pays";
  } catch {
    if (!fullRequested && ownEpoch === epoch) { firstEventPending = false; failure(); }
  }
}
function loading() {
  const fallback = document.querySelector("#startup-fallback");
  if (fallback) fallback.hidden = !homeRoute();
  document.querySelector("#loading").hidden = false;
  document.querySelector("#content").hidden = true;
  document.querySelector("#loading-title").textContent =
    "Loading event details";
  document.querySelector("#loading-status").textContent =
    "Opening the current view…";
  document.querySelector("#refresh").disabled = true;
  document.querySelector("#content").setAttribute("aria-busy", "true");
}
function failure() {
  document.querySelector("#loading").hidden = true;
  const content = document.querySelector("#content");
  content.hidden = false;
  content.setAttribute("aria-busy", "false");
  content.innerHTML =
    '<section class="luma-launch"><h1>This view could not be opened.</h1><p class="error-panel" role="alert">An application file could not be loaded. Reload this page to try again.</p><button class="button button-primary" data-startup-reload>Reload page</button>' +
    (homeRoute() ? '<p><a class="button button-secondary" href="/first-event/" data-event-fallback>Open the Truth Pays deposit page</a></p>' : '') + '</section>';
  content
    .querySelector("[data-startup-reload]")
    .addEventListener("click", () => window.location.reload());
}
function stylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    const timer = setTimeout(
      () => reject(Error("Stylesheet unavailable")),
      35000,
    );
    link.addEventListener(
      "load",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    link.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(Error("Stylesheet unavailable"));
      },
      { once: true },
    );
    document.head.append(link);
  });
}
function handoff(options = {}) {
  if (fullRequested) return;
  fullRequested = true;
  disposeFirstEvent();
  const ownEpoch = ++epoch;
  const publicSearch = options.publicSearch ?? home?.snapshot() ?? null;
  home?.dispose();
  home = null;
  initialAbort?.();
  initialAbort = null;
  window.removeEventListener("hashchange", routeChanged);
  loading();
  Promise.all([
    import("./app.js"),
    stylesheet("/contract-inbox.css"),
    stylesheet("/batch-actions.css"),
  ])
    .then(([module]) => {
      if (!fullRequested || epoch !== ownEpoch) return;
      return module.startApp({
        legacyCatalogMissing: options.legacyCatalogMissing === true,
        publicSearch,
      });
    })
    .catch(() => {
      if (fullRequested && epoch === ownEpoch) failure();
    });
}
function routeChanged() {
  normalizePreviousRecovery();
  if (redirectFirstEventParticipant()) return;
  if (firstEventRoute()) void showFirstEvent();
  else if (!homeRoute()) handoff();
  else if (firstEventView || firstEventPending) { disposeFirstEvent(); void startHome(); }
}
async function startHome() {
  loading();
  const ownEpoch = ++epoch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  initialAbort = () => {
    clearTimeout(timer);
    controller.abort();
  };
  const initialResponse = fetch("/api/public-catalog", {
    credentials: "same-origin",
    signal: controller.signal,
  });
  // Renderer discovery can take longer than a failed request. Observe rejection now.
  initialResponse.catch(() => {});
  try {
    const module = await import("./public-home.js");
    if (fullRequested || ownEpoch !== epoch || !homeRoute()) {
      initialAbort?.();
      return;
    }
    home = module.mountPublicHome({
      initialResponse,
      abortInitial: initialAbort,
      isCurrent: () => !fullRequested && epoch === ownEpoch,
      onHandoff: handoff,
    });
  } catch {
    initialAbort?.();
    if (!fullRequested && ownEpoch === epoch && homeRoute()) failure();
  }
}
window.addEventListener("hashchange", routeChanged);
normalizePreviousRecovery();
if (redirectFirstEventParticipant()) { /* The canonical deposit page owns this route. */ }
else if (firstEventRoute()) void showFirstEvent();
else if (homeRoute()) void startHome();
else handoff();
