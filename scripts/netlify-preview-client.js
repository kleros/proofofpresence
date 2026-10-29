// @ts-check
// Static viewer only: the interactive local application is imported after this
// network boundary and its capture-phase control guards have been installed.
const originalFetch = window.fetch.bind(window);
const PREVIEW_ERROR = {
  error:
    "This is a read-only snapshot. Run the full local app for wallet, deposit, attendance and transaction workflows.",
  code: "READ_ONLY_PREVIEW",
};
let snapshots = null;
let identity = "anonymous";

const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
const owns = (object, key) => object && Object.hasOwn(object, key);
const clone = (value) => JSON.parse(JSON.stringify(value));

window.fetch = async (input, options = {}) => {
  let request;
  try {
    request = new Request(input, options);
  } catch {
    return response(
      { ...PREVIEW_ERROR, error: "Invalid preview request." },
      400,
    );
  }
  const url = new URL(request.url),
    method = request.method.toUpperCase();
  // Never forward a failed match to a server, public RPC or wallet service.
  if (url.origin !== location.origin) return response(PREVIEW_ERROR, 403);
  if (!snapshots)
    return response(
      { ...PREVIEW_ERROR, error: "The captured preview is still loading." },
      503,
    );
  if (url.pathname === "/api/session" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return response(
        { error: "Use a captured demo identity.", code: "INVALID_IDENTITY" },
        400,
      );
    }
    if (
      typeof body?.identity !== "string" ||
      !owns(snapshots.bootstrapByIdentity, body.identity) ||
      body.identity === "anonymous"
    )
      return response(
        {
          error: "This identity is not included in the captured preview.",
          code: "INVALID_IDENTITY",
        },
        400,
      );
    identity = body.identity;
    return response(clone(snapshots.bootstrapByIdentity[identity].session));
  }
  if (url.pathname === "/api/session" && method === "DELETE") {
    identity = "anonymous";
    return response({ ok: true });
  }
  if (url.pathname === "/api/bootstrap" && method === "GET") {
    const bootstrap = clone(snapshots.bootstrapByIdentity[identity]);
    bootstrap.mode = "read-only-preview";
    bootstrap.capabilities = { readOnly: true, browserWallet: false };
    if (bootstrap.chain) bootstrap.chain.rpcUrl = "";
    return response(bootstrap);
  }
  const detail = url.pathname.match(/^\/api\/events\/([^/]+)\/?$/);
  if (detail && method === "GET") {
    let eventId;
    try {
      eventId = decodeURIComponent(detail[1]);
    } catch {
      return response(
        { error: "Unknown captured event.", code: "NOT_FOUND" },
        404,
      );
    }
    const records = snapshots.detailsByIdentity[identity];
    return owns(records, eventId) && records[eventId]
      ? response(clone(records[eventId]))
      : response(
          {
            error: "This event is not available for this captured identity.",
            code: "NOT_FOUND",
          },
          404,
        );
  }
  if (
    method !== "GET" ||
    url.pathname === "/rpc" ||
    url.pathname.startsWith("/rpc/") ||
    url.pathname.startsWith("/local-")
  )
    return response(PREVIEW_ERROR, 403);
  return response(
    {
      ...PREVIEW_ERROR,
      error: "This endpoint is not part of the captured read-only preview.",
    },
    404,
  );
};

const mutatingButtons = [
  "[data-connect-wallet]",
  "[data-fund-wallet]",
  "[data-tx]",
  "[data-execute]",
  "[data-advance]",
  "[data-personal]",
  "[data-checkin]",
  "[data-publish]",
  "[data-ruling]",
  "[data-open-appeal]",
  "[data-create-event]",
  "[data-recovery]",
  "[data-correction]",
  "[data-edit-event]",
  "[data-import-preview]",
  "[data-import-commit]",
].join(",");
const allowedButton = (button) =>
  !button.matches(mutatingButtons) &&
  button.matches(
    [
      "#refresh",
      "#top-identity",
      "#demo-help",
      ".dialog-close",
      "[data-view]",
      "[data-close]",
      "[data-choose-identity]",
      "[data-logout]",
      "[data-demo-help]",
    ].join(","),
  );
const allowedInput = (element) =>
  element.matches("select[data-identity], select#event-switch");
function allowedLink(anchor) {
  const href = anchor.getAttribute("href");
  if (!href || anchor.hasAttribute("download")) return false;
  if (href.startsWith("#")) return true;
  try {
    const url = new URL(href, location.href);
    return (
      url.origin === location.origin &&
      url.pathname === location.pathname &&
      !url.search &&
      (url.hash !== "" || href === "/")
    );
  } catch {
    return false;
  }
}
function block(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// These execute before app listeners, including its wallet-provider access.
document.addEventListener(
  "click",
  (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (button && !allowedButton(button)) return block(event);
    const anchor = event.target.closest("a");
    if (anchor && !allowedLink(anchor)) return block(event);
  },
  true,
);
document.addEventListener(
  "submit",
  (event) => {
    if (
      !(event.target instanceof HTMLFormElement) ||
      event.target.method !== "dialog"
    )
      block(event);
  },
  true,
);
for (const type of ["change", "input"])
  document.addEventListener(
    type,
    (event) => {
      if (event.target instanceof Element && !allowedInput(event.target))
        block(event);
    },
    true,
  );

const style = document.createElement("style");
style.textContent = `
  #preview-banner {position:sticky;top:0;z-index:10000;display:block;padding:12px 24px;background:#fff1c8;color:#493500;border-bottom:1px solid #dec98a;font:12px/1.55 system-ui,sans-serif}
  #preview-banner strong {font-weight:750;margin-right:10px} #preview-banner span {font-size:11px}
  #preview-banner p {margin:3px 0 0;max-width:110ch;font-size:11px}
  @media(min-width:901px){.netlify-readonly-preview .sidebar {top:var(--preview-banner-height,80px);height:calc(100vh - var(--preview-banner-height,80px))}}
  [data-preview-blocked] {cursor:not-allowed!important;opacity:.5}
  #dialog-body .preview-dialog-notice {margin:0 0 16px;padding:10px 12px;background:#fff7df;color:#614600;border:1px solid #ead69e;border-radius:8px;font-size:11px}
  @media(max-width:600px){#preview-banner{padding:10px 18px}#preview-banner strong,#preview-banner span{display:block}}
`;
document.head.append(style);
const banner = document.createElement("aside");
banner.id = "preview-banner";
banner.setAttribute("aria-label", "Read-only online preview");
const title = document.createElement("strong");
title.textContent = "READ-ONLY PREVIEW";
const captured = document.createElement("span");
captured.textContent = "Loading captured synthetic v7 data…";
const explanation = document.createElement("p");
explanation.textContent =
  "Explore captured event views and switch demo identities. No live wallet connection, deposits, transactions or check-ins are available here. Run the full local app for interactive workflows.";
banner.append(title, captured, explanation);
document.body.prepend(banner);
document.body.classList.add("netlify-readonly-preview");
new ResizeObserver(() =>
  document.documentElement.style.setProperty(
    "--preview-banner-height",
    `${banner.getBoundingClientRect().height}px`,
  ),
).observe(banner);

function disable(element) {
  if ("disabled" in element && !element.disabled) element.disabled = true;
  if (element.getAttribute("aria-disabled") !== "true")
    element.setAttribute("aria-disabled", "true");
  if (!element.hasAttribute("data-preview-blocked"))
    element.setAttribute("data-preview-blocked", "");
  if (!element.hasAttribute("data-preview-disabled"))
    element.setAttribute("data-preview-disabled", "");
  if (element.title !== PREVIEW_ERROR.error)
    element.title = PREVIEW_ERROR.error;
}
function guards() {
  for (const button of document.querySelectorAll("button"))
    if (!allowedButton(button)) disable(button);
  for (const input of document.querySelectorAll("input,select,textarea"))
    if (!allowedInput(input)) disable(input);
  for (const editable of document.querySelectorAll(
    '[contenteditable="true"]',
  )) {
    editable.setAttribute("contenteditable", "false");
    disable(editable);
  }
  for (const anchor of document.querySelectorAll("a[href]"))
    if (!allowedLink(anchor)) {
      disable(anchor);
      anchor.removeAttribute("href");
    }
  const environment = document.querySelector("#environment");
  if (environment && environment.textContent !== "READ-ONLY SNAPSHOT")
    environment.textContent = "READ-ONLY SNAPSHOT";
  for (const label of document.querySelectorAll(
    'label[for="identity-select"],label[for="dialog-identity"]',
  ))
    if (label.textContent !== "CAPTURED DEMO IDENTITY")
      label.textContent = "CAPTURED DEMO IDENTITY";
  const dialogBody = document.querySelector("#dialog-body");
  if (
    dialogBody?.children.length &&
    !dialogBody.querySelector(".preview-dialog-notice")
  ) {
    const notice = document.createElement("p");
    notice.className = "preview-dialog-notice";
    notice.textContent =
      "Read-only snapshot: identity choices change captured views only. Wallets and all data or financial actions are disabled online.";
    dialogBody.prepend(notice);
  }
}
const observer = new MutationObserver(guards);
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["disabled", "href", "contenteditable"],
});
guards();

try {
  // The sole fetch forwarded to the static host is this packaged synthetic file.
  const result = await originalFetch("/preview-data.json", {
    cache: "no-store",
    credentials: "omit",
  });
  if (!result.ok)
    throw new Error("The captured preview data could not be loaded.");
  const data = await result.json();
  if (
    data.schemaVersion !== 1 ||
    !data.bootstrapByIdentity?.anonymous ||
    !data.detailsByIdentity?.anonymous
  )
    throw new Error("The preview snapshot has an unsupported format.");
  snapshots = clone(data);
  const at = new Date(data.capturedAt);
  captured.textContent = `Captured synthetic local v7 data · ${Number.isFinite(at.valueOf()) ? at.toISOString().replace("T", " ").replace(".000Z", " UTC") : "capture time unavailable"}`;
  const app = await import("/app.js");
  // Current bundles start explicitly; historical bundles start on import.
  // All snapshot transport and capture-phase guards are installed above first.
  if (typeof app.startApp === "function")
    await app.startApp({ legacyCatalogMissing: true });
  guards();
} catch (error) {
  captured.textContent = "Preview unavailable";
  const loading = document.querySelector("#loading");
  if (loading)
    loading.textContent =
      error instanceof Error ? error.message : String(error);
}
