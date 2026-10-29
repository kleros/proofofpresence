// No static imports: request public metadata before discovering the application graph.
let fullRequested = false,
  epoch = 0,
  home = null,
  initialAbort = null;
const homeRoute = () => {
  const route = new URLSearchParams(location.hash.slice(1));
  return !route.get("event") && route.get("setup") !== "kickback";
};
function loading() {
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
    '<section class="luma-launch"><h1>This view could not be opened.</h1><p class="error-panel" role="alert">An application file could not be loaded. Reload this page to try again.</p><button class="button button-primary" data-startup-reload>Reload page</button></section>';
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
  if (!homeRoute()) handoff();
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
if (homeRoute()) void startHome();
else handoff();
