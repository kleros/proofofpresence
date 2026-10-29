import { searchPublicEvents, validatePublicCatalog } from "./event-search.js";
import { focusMain } from "./ui-keyboard.js";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const eth = (value) => {
  const amount = BigInt(value),
    fraction = (amount % 10n ** 18n)
      .toString()
      .padStart(18, "0")
      .replace(/0+$/, "");
  return `${amount / 10n ** 18n}${fraction ? `.${fraction}` : ""}`;
};
function date(entry) {
  if (!entry.startsAt || !entry.timezone) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: entry.timezone,
    }).format(new Date(entry.startsAt));
  } catch {
    return "Date unavailable";
  }
}
export function publicResultStatus(entries, query) {
  if (!entries.length) return "No public events yet.";
  const count = searchPublicEvents(entries, query).length;
  return query.trim()
    ? `${count} matching public ${count === 1 ? "event" : "events"}.`
    : `${count} public ${count === 1 ? "event" : "events"}.`;
}
export function renderPublicResults(entries, query) {
  if (!entries.length)
    return '<p class="public-event-empty">No public events yet.</p>';
  const matches = searchPublicEvents(entries, query);
  if (!matches.length)
    return `<p class="public-event-empty">No events match “${escape(query)}”. Try another name or clear your search.</p>`;
  return `<ul class="public-event-list">${matches.map((event) => `<li class="public-event-row" data-public-event-row><div class="public-event-copy"><h3>${escape(event.title)}</h3><p class="public-event-date">${escape(date(event))}</p><div class="public-event-meta"><span>${event.depositWei === null ? "Deposit unavailable" : `Event deposit: ${eth(event.depositWei)} ETH`}</span><span class="badge">${escape(event.statusLabel)}</span></div></div><a class="button button-secondary" data-public-event-open href="#${new URLSearchParams({ event: event.id, view: "participant" })}" aria-label="Open event: ${escape(event.title)}">Open event</a></li>`).join("")}</ul>`;
}
export function renderPublicHome({ entries, query, metadataOnly }) {
  return `<section class="luma-launch" data-launch-root ${metadataOnly ? "data-public-catalog-screen" : ""}><div class="luma-launch-heading"><div class="eyebrow">KLEROS KICKBACK</div><h1>A deposit for your Luma event.</h1><p>Find your event, review its deposit and return to Luma.</p></div><section class="luma-launch-card public-event-search"><h2>Find your event</h2>${metadataOnly ? '<p class="field-help" data-public-catalog-note>Recorded event details only. Current status and wallet actions are checked when you open an event.</p>' : ""}<label for="public-event-search">Search by event name</label><div class="public-event-controls"><input id="public-event-search" type="search" data-public-event-search maxlength="120" autocomplete="off" placeholder="Event name" value="${escape(query)}" aria-controls="public-event-results"><button class="button button-secondary" type="button" data-public-event-clear ${query ? "" : "hidden"}>Clear search</button></div><p class="public-event-status" data-public-event-status role="status" aria-live="polite" aria-atomic="true">${escape(publicResultStatus(entries, query))}</p><div id="public-event-results" data-public-event-results>${renderPublicResults(entries, query)}</div></section><section class="luma-launch-card"><h2>Organizing an event?</h2><p>Connect your Luma event to its own reviewed kickback contract.</p><a class="button button-secondary" href="#setup=kickback">Set up kickback</a></section></section>`;
}

// This controller owns only public metadata. No wallet, storage or bootstrap is read.
export function mountPublicHome({
  initialResponse,
  abortInitial,
  isCurrent,
  onHandoff,
}) {
  const $ = (selector) => document.querySelector(selector);
  let alive = true,
    generation = 0,
    catalog = null,
    query = "",
    active = null,
    abort = abortInitial;
  const current = () => {
    const route = new URLSearchParams(location.hash.slice(1));
    return (
      alive &&
      isCurrent() &&
      !route.get("event") &&
      route.get("setup") !== "kickback"
    );
  };
  const busy = (value) => {
    if (!current()) return;
    $("#refresh").disabled = value;
    $("#refresh").setAttribute("aria-busy", String(value));
    $("#content").setAttribute("aria-busy", String(value));
  };
  const snapshot = () =>
    catalog
      ? Object.freeze({
          mode: catalog.mode,
          instanceId: catalog.instanceId,
          query,
        })
      : null;
  const chrome = () => {
    document.body.classList.remove("initial-shell", "hosted-shared-demo");
    document.body.classList.add("launch-mode");
    $("#sidebar-events").replaceChildren();
    $("#event-count").textContent = "—";
    $("#environment").textContent = "EVENT DIRECTORY";
    $("#breadcrumb").textContent = "Find your event";
    const identity = $("#top-identity");
    identity.hidden = true;
    identity.disabled = true;
    identity.onclick = null;
  };
  const results = () => {
    if (!current() || !catalog) return;
    $("[data-public-event-results]").innerHTML = renderPublicResults(
      catalog.events,
      query,
    );
    $("[data-public-event-status]").textContent = publicResultStatus(
      catalog.events,
      query,
    );
    $("[data-public-event-clear]").hidden = !query;
  };
  const read = (responsePromise) => {
    if (!current()) return Promise.resolve();
    const id = ++generation;
    const finish = abort;
    const focused = document.activeElement;
    const retryFocused =
      focused instanceof Element &&
      focused.hasAttribute("data-public-catalog-retry");
    const mayRestoreFocus = () =>
      document.activeElement === document.body ||
      document.activeElement === focused;
    busy(true);
    if (!catalog) {
      $("#loading-title").textContent = "Loading event details";
      $("#loading-status").textContent = "Reading public event details…";
      $("#loading").hidden = false;
      $("#content").hidden = true;
    }
    const pending = (async () => {
      try {
        const response = await responsePromise;
        if (!current() || generation !== id) return;
        if (response.status === 404) {
          onHandoff({ legacyCatalogMissing: true, publicSearch: snapshot() });
          return;
        }
        if (!response.ok)
          throw Error(
            `The public event directory returned HTTP ${response.status}. Try again for fresh event details.`,
          );
        const value = await response.json();
        if (!current() || generation !== id) return;
        const fresh = validatePublicCatalog(value);
        const restoreRetry = retryFocused && mayRestoreFocus();
        const sameScope =
          catalog?.mode === fresh.mode &&
          catalog?.instanceId === fresh.instanceId;
        if (!sameScope) query = "";
        catalog = fresh;
        chrome();
        if (sameScope && $("[data-public-catalog-screen]")) results();
        else
          $("#content").innerHTML = renderPublicHome({
            entries: catalog.events,
            query,
            metadataOnly: true,
          });
        $("#loading").hidden = true;
        $("#content").hidden = false;
        if (restoreRetry && !focused.isConnected)
          $("[data-public-event-search]")?.focus();
        document.title = "Find your event · Kleros";
      } catch (error) {
        if (!current() || generation !== id) return;
        const restore = mayRestoreFocus();
        $("#loading").hidden = true;
        $("#content").hidden = false;
        $("#content").innerHTML =
          `<section class="luma-launch"><div class="luma-launch-heading"><h1>We couldn’t load the event directory.</h1></div><p class="error-panel" role="alert">${escape(error.message)}</p><button class="button button-primary" data-reload data-public-catalog-retry>Try again</button></section>`;
        catalog = null;
        if (restore) $("[data-public-catalog-retry]")?.focus();
      } finally {
        // Abort only this read after its body has been consumed; a newer read
        // owns a different controller and deadline.
        finish?.();
        if (current() && generation === id) {
          active = null;
          busy(false);
          if (
            focused === $("#refresh") &&
            document.activeElement === document.body
          )
            focused.focus();
        }
      }
    })();
    active = pending;
    return pending;
  };
  const refresh = () => {
    if (!current() || active) return active;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    abort = () => {
      clearTimeout(timer);
      controller.abort();
    };
    const response = fetch("/api/public-catalog", {
      credentials: "same-origin",
      signal: controller.signal,
    });
    response.catch(() => {});
    return read(response);
  };
  const input = (event) => {
    if (!current() || event.target !== $("[data-public-event-search]")) return;
    query = event.target.value.slice(0, 120);
    results();
  };
  const click = (event) => {
    if (!current() || !(event.target instanceof Element)) return;
    const target = event.target.closest("button");
    if (target?.hasAttribute("data-public-event-clear")) {
      query = "";
      const field = $("[data-public-event-search]");
      field.value = "";
      results();
      field.focus();
    } else if (target?.hasAttribute("data-public-catalog-retry"))
      void refresh();
  };
  const refreshClick = () => void refresh();
  const skip = (event) => focusMain(event, $("#main"));
  document.addEventListener("input", input);
  document.addEventListener("click", click);
  $("#refresh").addEventListener("click", refreshClick);
  $(".skip").addEventListener("click", skip);
  void read(initialResponse);
  return {
    snapshot,
    dispose() {
      alive = false;
      generation++;
      abort?.();
      document.removeEventListener("input", input);
      document.removeEventListener("click", click);
      $("#refresh").removeEventListener("click", refreshClick);
      $(".skip").removeEventListener("click", skip);
    },
  };
}
