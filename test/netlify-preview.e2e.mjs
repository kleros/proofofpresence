import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// This serves only generated static files. It deliberately has no workbench,
// Ganache process, session store, API or RPC implementation behind the preview.
const directory = path.resolve(
  process.env.NETLIFY_PREVIEW_DIR ??
    fileURLToPath(new URL("../dist/netlify-preview/", import.meta.url)),
);
try {
  await fs.access(path.join(directory, "index.html"));
} catch {
  throw new Error(
    "Build the static preview first: node scripts/build-netlify-preview.mjs",
  );
}
const snapshot = JSON.parse(
  await fs.readFile(path.join(directory, "preview-data.json"), "utf8"),
);
assert.equal(snapshot.schemaVersion, 1);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://static.invalid").pathname,
    );
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(403, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Static preview is read-only" }));
    }
    const filename = path.resolve(
      directory,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!filename.startsWith(directory + path.sep))
      throw new Error("Invalid path");
    const content = await fs.readFile(filename);
    res.writeHead(200, {
      "content-type":
        mime[path.extname(filename)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Static file not found" }));
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = process.env.NETLIFY_PREVIEW_URL
  ? new URL(process.env.NETLIFY_PREVIEW_URL).origin
  : `http://127.0.0.1:${address.port}`;
const failures = [],
  external = [],
  apiNetwork = [],
  assetErrors = [],
  checks = [];
let browser;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks.push(label);
};
const mutationControls = [
  "[data-tx]",
  "[data-recovery]",
  "[data-checkin]",
  "[data-admission]",
  "[data-advance]",
  "[data-ruling]",
  "[data-open-appeal]",
  "[data-publish]",
  "[data-fund-wallet]",
  "[data-connect-wallet]",
  "[data-edit-event]",
  "[data-create-event]",
  "[data-import-preview]",
  "[data-import-commit]",
  "form[data-form] button:not([data-close])",
].join(", ");

try {
  browser = await chromium.launch({ headless: true });
  const instrument = async (context) => {
    await context.addInitScript(() => {
      window.__previewWalletRequests = [];
      window.ethereum = {
        request: async (request) => {
          window.__previewWalletRequests.push(request);
          throw new Error("A read-only preview must not request a wallet");
        },
      };
    });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        external.push(url.href);
        return route.abort("blockedbyclient");
      }
      if (/^\/(api(?:\/|$)|rpc(?:\/|$))/.test(url.pathname)) {
        apiNetwork.push(`${route.request().method()} ${url.pathname}`);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await instrument(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      ["script", "stylesheet", "font", "image"].includes(
        response.request().resourceType(),
      )
    ) {
      assetErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  const localBootstrap = () =>
    page.evaluate(async () => (await fetch("/api/bootstrap")).json());
  const navigate = async (eventId, view) => {
    await page.evaluate(
      ({ eventId, view }) => {
        location.hash = new URLSearchParams({
          event: eventId,
          view,
        }).toString();
      },
      { eventId, view },
    );
    const title = snapshot.detailsByIdentity.anonymous[eventId].event.title;
    await expect(page.locator("h1")).toHaveText(title);
    await expect(page.locator("#event-switch")).toHaveValue(eventId);
    await expect(page.locator(`.tabs [data-view="${view}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#content")).toBeVisible();
  };
  const identity = async (id) => {
    await page.locator("#identity-select").selectOption(id);
    await expect(page.locator("#identity-select")).toHaveValue(id);
    await expect
      .poll(async () => (await localBootstrap()).session?.wallet)
      .toBe(snapshot.bootstrapByIdentity[id].session.wallet);
  };
  const disabled = async (label) => {
    await expect
      .poll(() =>
        page
          .locator(mutationControls)
          .evaluateAll((elements) =>
            elements
              .filter((element) => !element.disabled)
              .map((element) => element.outerHTML.slice(0, 180)),
          ),
      )
      .toEqual([]);
    await expect
      .poll(() =>
        page
          .locator(
            "input, textarea, select:not([data-identity]):not(#event-switch)",
          )
          .evaluateAll((elements) =>
            elements
              .filter((element) => !element.disabled)
              .map((element) => element.outerHTML.slice(0, 180)),
          ),
      )
      .toEqual([]);
    checks.push(label);
  };
  const noOverflow = async (label) => {
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
      label,
    );
  };

  await page.goto(origin);
  await expect(page.locator("#preview-banner")).toBeVisible();
  await expect(page.locator("#preview-banner")).toContainText(
    /read.only preview/i,
  );
  await expect(page.locator(".event-card")).toHaveCount(2);
  check(
    (await localBootstrap()).session,
    null,
    "Static directory opens anonymously with two real snapshot events",
  );
  await disabled("Directory create action is disabled");
  await page.locator("#top-identity").click();
  await expect(page.locator("[data-connect-wallet]")).toBeDisabled();
  await page.keyboard.press("Escape");
  checks.push("Wallet connection is disabled in the identity dialog");

  await navigate("event-a", "participant");
  await identity("alice");
  for (const eventId of ["event-a", "event-b"]) {
    for (const view of ["participant", "organizer", "cases"]) {
      await navigate(eventId, view);
      await disabled(`Alice ${eventId}/${view} remains read-only`);
    }
  }
  await navigate("event-a", "organizer");
  await identity("organizer-a");
  await expect(page.locator("#source-review")).toBeVisible();
  await disabled(
    "Organizer admission, CSV, check-in and financial controls are disabled",
  );
  const screenshots = fileURLToPath(
    new URL("../artifacts/screenshots/netlify-preview/", import.meta.url),
  );
  await fs.mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: path.join(screenshots, "desktop.png"),
    fullPage: true,
  });
  const advanced = page.locator(
    'a[href^="/finance/"], a[data-preview-disabled]',
  );
  check(
    await advanced.evaluateAll((elements) =>
      elements.every(
        (element) =>
          !element.getAttribute("href") ||
          element.getAttribute("aria-disabled") === "true",
      ),
    ),
    true,
    "Unavailable advanced financial links are inert",
  );
  for (const eventId of ["event-a", "event-b"]) {
    for (const view of ["participant", "organizer", "cases"]) {
      await navigate(eventId, view);
      await disabled(`Organizer A ${eventId}/${view} remains read-only`);
    }
  }
  const refused = await page.evaluate(async () => {
    const responses = await Promise.all([
      fetch("/api/events/event-a/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "deposit", params: {} }),
      }),
      fetch(
        new Request(location.origin + "/api/events/event-b/drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "cancel", params: {} }),
        }),
      ),
      fetch("/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendTransaction",
          params: [],
        }),
      }),
    ]);
    return Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: await response.json(),
      })),
    );
  });
  check(
    refused.map((response) => response.status),
    [403, 403, 403],
    "Direct string/Request draft writes and RPC writes are rejected locally",
  );
  check(
    refused.every((response) => typeof response.body.error === "string"),
    true,
    "Read-only refusals have explicit errors",
  );
  check(
    (await localBootstrap()).session.wallet,
    snapshot.bootstrapByIdentity["organizer-a"].session.wallet,
    "Forbidden writes cannot change the selected preview identity",
  );
  check(
    await context.cookies(),
    [],
    "Preview identity selection does not create a server session cookie",
  );

  const otherContext = await browser.newContext();
  await instrument(otherContext);
  const otherPage = await otherContext.newPage();
  otherPage.on("pageerror", (error) => failures.push(error.message));
  await otherPage.goto(origin);
  await expect(otherPage.locator(".event-card")).toHaveCount(2);
  check(
    await otherPage.evaluate(
      async () => (await (await fetch("/api/bootstrap")).json()).session,
    ),
    null,
    "A second browser context remains anonymous after first-browser role selection",
  );
  await otherContext.close();

  await page.setViewportSize({ width: 400, height: 800 });
  for (const view of ["participant", "organizer", "cases"]) {
    await navigate("event-a", view);
    await expect(page.locator("#preview-banner")).toBeVisible();
    await noOverflow(
      `Read-only ${view} preview has no mobile horizontal overflow`,
    );
  }
  await page.screenshot({
    path: path.join(screenshots, "mobile.png"),
    fullPage: true,
  });
  await page.locator("#demo-help").click();
  await expect(page.locator("#review-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  checks.push("Read-only walkthrough remains available");
  check(
    await page.evaluate(() => window.__previewWalletRequests),
    [],
    "Preview never requests wallet access, signatures or transactions",
  );
  check(apiNetwork, [], "No API or RPC request reaches the network");
  check(external, [], "No external request is attempted");
  check(
    assetErrors,
    [],
    "Static scripts, styles, fonts and images load successfully",
  );
  check(failures, [], "Preview raises no uncaught browser errors");
  console.log(
    `Netlify read-only preview browser checks passed: ${checks.length} assertions plus Playwright expectations.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
