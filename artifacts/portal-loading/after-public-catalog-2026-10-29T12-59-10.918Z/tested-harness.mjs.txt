import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  makePublicEventSearchFixture,
  PRIVATE_SEARCH_TITLES,
  PUBLIC_SEARCH_A,
} from "./fixtures/public-event-search-fixture.mjs";

// TEST ONLY: actual static UI, synthetic anonymous GET-only loopback catalog.
// No production origin, provider, key, auth or writable endpoint is accepted.
const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const delayMs = 1500;
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
function allowed(origin, url, method, assetNames) {
  const parsed = new URL(url);
  if (method !== "GET" || parsed.origin !== origin) return false;
  if (parsed.pathname === "/api/bootstrap") {
    return (
      !parsed.search || parsed.search === "?selectedEventId=" + PUBLIC_SEARCH_A
    );
  }
  return (
    !parsed.search &&
    (parsed.pathname === "/api/public-catalog" ||
      parsed.pathname === "/" ||
      assetNames.has(parsed.pathname.slice(1)))
  );
}
function makeCatalog(fixture) {
  const fields = [
    "id",
    "title",
    "startsAt",
    "endsAt",
    "timezone",
    "depositWei",
    "chainId",
    "contract",
    "contractVersion",
    "abiVersion",
    "visibility",
    "editorialStatus",
  ];
  return {
    schemaVersion: 1,
    kind: "public-catalog",
    mode: "hosted-production",
    instanceId: fixture.bootstrap.instanceId,
    environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
    chain: structuredClone(fixture.bootstrap.chain),
    generatedAt: new Date().toISOString(),
    catalog: {
      metadataOnly: true,
      currentFinancialState: "not-loaded",
      source: "recorded-adoption",
    },
    events: fixture.bootstrap.events.map((event) => ({
      ...Object.fromEntries(
        fields
          .filter((key) => Object.hasOwn(event, key))
          .map((key) => [key, event[key]]),
      ),
      adoption: {
        kind: "recorded-adoption",
        txHash: "0x" + "a".repeat(64),
        blockNumber: 100,
        blockHash: "0x" + "b".repeat(64),
      },
    })),
  };
}
async function readAssets(directory, prefix = "", assets = new Map()) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      await readAssets(path.join(directory, entry.name), name + "/", assets);
    else if (mime[path.extname(name)])
      assets.set(name, await fs.readFile(path.join(directory, entry.name)));
  }
  return assets;
}
function selfTest() {
  const names = new Set(["app.js"]),
    origin = "http://127.0.0.1:12345";
  const tests = [
    [origin + "/", "GET", true],
    [origin + "/app.js", "GET", true],
    [origin + "/api/bootstrap", "GET", true],
    [origin + "/api/public-catalog", "GET", true],
    [origin + "/api/bootstrap?selectedEventId=" + PUBLIC_SEARCH_A, "GET", true],
    [origin + "/api/bootstrap", "POST", false],
    [origin + "/api/auth/verify", "GET", false],
    [origin + "/api/bootstrap?wallet=foreign", "GET", false],
    [origin + "/api/public-catalog?wallet=foreign", "GET", false],
    [origin + "/api/bootstrap?selectedEventId=foreign", "GET", false],
    ["https://example.test/app.js", "GET", false],
    [origin + "/api/events/foreign", "GET", false],
  ];
  for (const [url, method, expected] of tests)
    assert.equal(allowed(origin, url, method, names), expected);
  assert.equal(makePublicEventSearchFixture().bootstrap.session, null);
  console.log(
    JSON.stringify({
      status: "passed",
      guards: tests.length + 1,
      networkRequests: 0,
      browserLaunches: 0,
    }),
  );
}
async function run(label) {
  const { chromium, expect } = await import("@playwright/test");
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const output = path.join(
    root,
    "artifacts/portal-loading",
    label + "-" + stamp,
  );
  await fs.mkdir(output, { recursive: true });
  const assets = await readAssets(path.join(root, "public"));
  await fs.copyFile(
    fileURLToPath(import.meta.url),
    path.join(output, "tested-harness.mjs.txt"),
  );
  const fixture = makePublicEventSearchFixture();
  const catalog = makeCatalog(fixture);
  assert.equal(fixture.bootstrap.session, null);
  const evidence = {
    status: "running",
    label,
    startedAt: new Date().toISOString(),
    harnessSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
    fixtureSha256: hash(
      await fs.readFile(
        path.join(root, "test/fixtures/public-event-search-fixture.mjs"),
      ),
    ),
    assetSha256: Object.fromEntries(
      [...assets].map(([name, bytes]) => [name, hash(bytes)]),
    ),
    catalogDelayMs: delayMs,
    browser: null,
    measurements: [],
    recovery: null,
    checks: [],
    requests: [],
    blocked: [],
    errors: [],
    providerAccess: [],
    screenshots: [],
    limits: [
      "Synthetic anonymous loopback catalog/bootstrap and unchanged actual static bytes. No backend/RPC latency or economic behavior is simulated.",
      "Fresh Chromium contexts; unthrottled local network/CPU, no-store responses, viewport emulation only. Not field Core Web Vitals.",
      "Browser request routing only checks GET/same-origin/allowlist then continues. No route.fetch, body/hash validation or substitution occurs in the request path.",
      "FCP/LCP are separate from authoritative content usable. Usable is first animation frame with visible enabled public search, final public count and non-busy content.",
      "Controlled503 recovery is counted separately from initial navigation readiness. No signing, auth, wallet methods, external HTTP, WebSocket or service worker is allowed.",
    ],
  };
  let sample = "none",
    responseStatus = 200,
    malformedCatalog = false,
    requestDelayMs = delayMs,
    browser;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const record = {
      sample,
      method: req.method,
      path: url.pathname,
      query: url.search,
      receivedAt: Date.now(),
    };
    evidence.requests.push(record);
    try {
      if (
        !allowed(
          "http://" + req.headers.host,
          "http://" + req.headers.host + req.url,
          req.method,
          new Set(assets.keys()),
        )
      ) {
        evidence.blocked.push(record);
        res.writeHead(405);
        res.end();
        return;
      }
      if (["/api/bootstrap", "/api/public-catalog"].includes(url.pathname)) {
        const isCatalog = url.pathname === "/api/public-catalog";
        const status = isCatalog ? responseStatus : 200;
        let value = structuredClone(isCatalog ? catalog : fixture.bootstrap);
        if (isCatalog && malformedCatalog) value.schemaVersion = 99;
        if (!isCatalog && url.searchParams.has("selectedEventId")) {
          const eventId = url.searchParams.get("selectedEventId");
          value.capabilities.selectedEventBootstrap = true;
          value.selectedEvent = {
            eventId,
            instanceId: value.instanceId,
            wallet: null,
            detail: structuredClone(fixture.publicDetails[eventId]),
          };
        }
        await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
        record.status = status;
        record.respondedAt = Date.now();
        res.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-fixture": "synthetic-loopback-only",
        });
        res.end(
          JSON.stringify(
            status === 200
              ? value
              : { error: "Synthetic catalog unavailable. Please retry." },
          ),
        );
        return;
      }
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!assets.has(name)) {
        evidence.blocked.push(record);
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": mime[path.extname(name)],
        "cache-control": "no-store",
        "x-fixture": "synthetic-loopback-only",
      });
      res.end(assets.get(name));
    } catch (error) {
      evidence.errors.push(error.message);
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    browser = await chromium.launch({ headless: true });
    evidence.browser = browser.version();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      sample = viewport.width === 390 ? "mobile-cold" : "desktop-cold";
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      await context.route("**/*", (route) => {
        const request = route.request();
        if (
          !allowed(
            origin,
            request.url(),
            request.method(),
            new Set(assets.keys()),
          )
        ) {
          evidence.blocked.push({
            sample,
            method: request.method(),
            url: request.url(),
          });
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      await context.routeWebSocket("**/*", (socket) => {
        evidence.blocked.push({ sample, type: "WebSocket" });
        socket.close();
      });
      await context.addInitScript(() => {
        window.__portalLoading = {
          loadingMs: null,
          usableMs: null,
          lcp: null,
          shifts: [],
          providerAccess: [],
        };
        const nativeFetch = window.fetch;
        window.fetch = (input, options = {}) => {
          const url = new URL(
            typeof input === "string" ? input : input.url,
            location.href,
          );
          if (
            window.__ignoreCatalogAbort &&
            url.pathname === "/api/public-catalog"
          )
            options = { ...options, signal: undefined };
          return nativeFetch.call(window, input, options);
        };
        Object.defineProperty(window, "ethereum", {
          configurable: false,
          get() {
            window.__portalLoading.providerAccess.push("get");
            return undefined;
          },
          set() {
            window.__portalLoading.providerAccess.push("set");
          },
        });
        window.WebSocket = class {
          constructor() {
            throw Error("No WebSocket in local loading test");
          }
        };
        const visible = (element) =>
          element &&
          !element.hidden &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden";
        let scheduled = false;
        const probe = () => {
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            const trace = window.__portalLoading;
            if (
              trace.loadingMs === null &&
              visible(document.querySelector("#loading"))
            )
              trace.loadingMs = performance.now();
            const content = document.querySelector("#content"),
              search = document.querySelector("[data-public-event-search]"),
              status = document.querySelector("[data-public-event-status]");
            if (
              trace.usableMs === null &&
              visible(content) &&
              content.getAttribute("aria-busy") !== "true" &&
              visible(search) &&
              !search.disabled &&
              status?.textContent === "2 public events."
            )
              trace.usableMs = performance.now();
          });
        };
        new MutationObserver(probe).observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
        });
        try {
          new PerformanceObserver((entries) => {
            for (const entry of entries.getEntries())
              window.__portalLoading.lcp = {
                ms: entry.startTime,
                tag: entry.element?.tagName ?? null,
              };
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((entries) => {
            for (const entry of entries.getEntries())
              if (!entry.hadRecentInput)
                window.__portalLoading.shifts.push({
                  time: entry.startTime,
                  value: entry.value,
                });
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}
        probe();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on("pageerror", (error) => evidence.errors.push(error.message));
      await page.goto(origin + "/", {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
      await expect(page.locator("#loading")).toBeVisible();
      await expect(page.locator("#loading-status")).toHaveAttribute(
        "role",
        "status",
      );
      await expect(page.locator("#loading-status")).toHaveAttribute(
        "aria-live",
        "polite",
      );
      await expect(page.locator("#content")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(page.locator("[data-public-event-row]")).toHaveCount(0);
      await page.screenshot({
        path: path.join(output, sample + "-loading.png"),
      });
      evidence.screenshots.push(sample + "-loading.png");
      await expect(page.locator("[data-public-event-status]")).toHaveText(
        "2 public events.",
      );
      await expect(page.locator("#loading")).toBeHidden();
      await page.waitForFunction(
        () => window.__portalLoading.usableMs !== null,
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        );
      });
      await page.waitForTimeout(100);
      const metrics = await page.evaluate(() => {
        const trace = window.__portalLoading,
          boot = performance
            .getEntriesByType("resource")
            .filter(
              (entry) => new URL(entry.name).pathname === "/api/public-catalog",
            );
        let cls = 0,
          sum = 0,
          first = 0,
          last = 0;
        for (const shift of trace.shifts) {
          if (shift.time - last > 1000 || shift.time - first > 5000) {
            sum = 0;
            first = shift.time;
          }
          sum += shift.value;
          cls = Math.max(cls, sum);
          last = shift.time;
        }
        return {
          fcpMs:
            performance.getEntriesByName("first-contentful-paint")[0]
              ?.startTime ?? null,
          loadingMs: trace.loadingMs,
          usableMs: trace.usableMs,
          lcp: trace.lcp,
          cls,
          providerAccess: trace.providerAccess,
          catalog: boot.map((entry) => ({
            startMs: entry.startTime,
            requestMs: entry.requestStart,
            firstByteMs: entry.responseStart,
            bodyEndMs: entry.responseEnd,
            durationMs: entry.duration,
            bytes: entry.decodedBodySize,
          })),
          navigation: performance
            .getEntriesByType("navigation")
            .map((entry) => ({
              firstByteMs: entry.responseStart,
              domContentLoadedMs: entry.domContentLoadedEventEnd,
            })),
          horizontalOverflow:
            document.documentElement.scrollWidth > innerWidth ||
            document.body.scrollWidth > innerWidth,
        };
      });
      assert.equal(metrics.catalog.length, 1);
      assert.equal(
        evidence.requests.filter(
          (entry) => entry.sample === sample && entry.path === "/api/bootstrap",
        ).length,
        0,
      );
      for (const title of PRIVATE_SEARCH_TITLES)
        assert(!(await page.locator("body").textContent()).includes(title));
      await expect(page.locator("[data-public-event-row] .badge")).toHaveText([
        "Check status on open",
        "Check status on open",
      ]);
      assert.equal(metrics.horizontalOverflow, false);
      assert.equal(typeof metrics.fcpMs, "number");
      assert(metrics.fcpMs < metrics.catalog[0].bodyEndMs);
      assert(metrics.loadingMs < metrics.catalog[0].bodyEndMs);
      assert(metrics.usableMs >= metrics.catalog[0].bodyEndMs);
      metrics.renderAfterResponseMs =
        metrics.usableMs - metrics.catalog[0].bodyEndMs;
      evidence.measurements.push({ sample, viewport, ...metrics });
      evidence.providerAccess.push(...metrics.providerAccess);
      await page.screenshot({ path: path.join(output, sample + "-ready.png") });
      evidence.screenshots.push(sample + "-ready.png");
      evidence.checks.push(
        sample +
          ": painted announced loading precedes metadata-only public content; one catalog GET, zero bootstrap, no overflow",
      );
      if (viewport.width === 1440) {
        sample = "desktop-recovery";
        const before = evidence.requests.length;
        responseStatus = 503;
        await page.locator("#refresh").focus();
        await page.locator("#refresh").click();
        await expect(page.locator('[role="alert"]')).toContainText(
          "Synthetic catalog unavailable",
        );
        await expect(page.locator("[data-public-event-row]")).toHaveCount(0);
        await expect(page.locator("[data-reload]")).toBeFocused();
        assert.equal(
          evidence.requests
            .slice(before)
            .filter((entry) => entry.path === "/api/public-catalog").length,
          1,
        );
        responseStatus = 200;
        await page.keyboard.press("Enter");
        await expect(page.locator("[data-public-event-status]")).toHaveText(
          "2 public events.",
        );
        await expect(page.locator('[role="alert"]')).toHaveCount(0);
        const reads = evidence.requests
          .slice(before)
          .filter((entry) => entry.path === "/api/public-catalog");
        assert.deepEqual(
          reads.map((entry) => entry.status),
          [503, 200],
        );
        evidence.recovery = {
          catalogRequests: reads.length,
          statuses: reads.map((entry) => entry.status),
          automaticRetries: 0,
          errorAnnounced: true,
          retryFocusedAndKeyboardActivated: true,
        };
        evidence.checks.push(
          "Controlled503 announces failure, clears stale rows and focuses explicit retry; one fresh keyboard retry restores public content",
        );
      }
      if (viewport.width === 390) {
        await page.evaluate(() => {
          const sizes = [...document.querySelectorAll("body,body *")].map(
            (element) => [
              element,
              parseFloat(getComputedStyle(element).fontSize),
            ],
          );
          for (const [element, size] of sizes)
            if (element instanceof HTMLElement && Number.isFinite(size))
              element.style.setProperty(
                "font-size",
                size * 2 + "px",
                "important",
              );
        });
        await page
          .locator("[data-public-event-search]")
          .scrollIntoViewIfNeeded();
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          );
        });
        await page.locator(".public-event-search").screenshot({
          path: path.join(output, "mobile-200-text-component.png"),
        });
        evidence.screenshots.push("mobile-200-text-component.png");
        assert(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <= innerWidth &&
              document.body.scrollWidth <= innerWidth,
          ),
        );
      } else {
        requestDelayMs = 20;
        sample = "desktop-local-search";
        const beforeSearch = evidence.requests.length;
        await page.locator("[data-public-event-search]").fill("ALPHA");
        await expect(page.locator("[data-public-event-row]")).toHaveCount(2);
        await expect(page.locator("[data-public-event-search]")).toBeFocused();
        await page.locator("[data-public-event-clear]").click();
        assert.equal(evidence.requests.length, beforeSearch);
        evidence.checks.push(
          "Catalog search and clear retain local behavior with no new GET",
        );
        sample = "desktop-malformed-catalog";
        malformedCatalog = true;
        let before = evidence.requests.length;
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator('[role="alert"]')).toBeVisible();
        await expect(page.locator("[data-public-event-row]")).toHaveCount(0);
        assert.deepEqual(
          evidence.requests
            .slice(before)
            .filter((entry) => entry.path.startsWith("/api/"))
            .map((entry) => entry.path),
          ["/api/public-catalog"],
        );
        malformedCatalog = false;
        evidence.checks.push(
          "Malformed catalog fails closed with no bootstrap fallback or stale public rows",
        );
        sample = "desktop-404-fallback";
        responseStatus = 404;
        before = evidence.requests.length;
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator("[data-public-event-status]")).toHaveText(
          "2 public events.",
        );
        assert.deepEqual(
          evidence.requests
            .slice(before)
            .filter((entry) => entry.path.startsWith("/api/"))
            .map((entry) => [entry.path, entry.status]),
          [
            ["/api/public-catalog", 404],
            ["/api/bootstrap", 200],
          ],
        );
        evidence.checks.push(
          "Exactly404 permits one legacy bootstrap fallback; other catalog failures do not",
        );
        sample = "desktop-fresh-navigation";
        responseStatus = 200;
        await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
        await expect(
          page.locator("[data-public-catalog-screen]"),
        ).toBeVisible();
        before = evidence.requests.length;
        await page.locator('a[href="#setup=kickback"]').click();
        await expect(page.locator("#luma-setup")).toBeVisible();
        assert.deepEqual(
          evidence.requests
            .slice(before)
            .filter((entry) => entry.path.startsWith("/api/"))
            .map((entry) => entry.path),
          ["/api/bootstrap"],
        );
        await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
        await expect(
          page.locator("[data-public-catalog-screen]"),
        ).toBeVisible();
        before = evidence.requests.length;
        await page
          .locator(
            '[data-public-event-open][href="#event=' +
              PUBLIC_SEARCH_A +
              '&view=participant"]',
          )
          .click();
        await expect(page.locator("[data-luma-launch]")).toBeVisible();
        assert.deepEqual(
          evidence.requests
            .slice(before)
            .filter((entry) => entry.path.startsWith("/api/"))
            .map((entry) => [entry.path, entry.query]),
          [["/api/bootstrap", "?selectedEventId=" + PUBLIC_SEARCH_A]],
        );
        evidence.checks.push(
          "Setup and selected event each fetch fresh scoped bootstrap; metadata-only catalog is never financial authority",
        );
        sample = "desktop-late-catalog";
        await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
        await expect(
          page.locator("[data-public-catalog-screen]"),
        ).toBeVisible();
        before = evidence.requests.length;
        requestDelayMs = 600;
        await page.evaluate(() => {
          window.__ignoreCatalogAbort = true;
        });
        await page.locator("#refresh").click();
        await expect
          .poll(
            () =>
              evidence.requests
                .slice(before)
                .filter((entry) => entry.path === "/api/public-catalog").length,
          )
          .toBe(1);
        requestDelayMs = 20;
        await page.evaluate(() => {
          location.hash = "setup=kickback";
        });
        await expect(page.locator("#luma-setup")).toBeVisible();
        await page.waitForTimeout(650);
        await expect(page.locator("#luma-setup")).toBeVisible();
        await expect(page.locator("[data-public-catalog-screen]")).toHaveCount(
          0,
        );
        assert.deepEqual(
          evidence.requests
            .slice(before)
            .filter((entry) => entry.path.startsWith("/api/"))
            .map((entry) => entry.path),
          ["/api/public-catalog", "/api/bootstrap"],
        );
        evidence.checks.push(
          "A late catalog response cannot repaint setup even when the test transport ignores abort",
        );
      }
      await context.close();
    }
    assert.deepEqual(evidence.blocked, []);
    assert.deepEqual(evidence.errors, []);
    assert.deepEqual(evidence.providerAccess, []);
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.failure = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    evidence.completedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        {
          status: evidence.status,
          output,
          checks: evidence.checks.length,
          measurements: evidence.measurements.map(
            ({
              sample,
              fcpMs,
              loadingMs,
              usableMs,
              renderAfterResponseMs,
              cls,
            }) => ({
              sample,
              fcpMs,
              loadingMs,
              usableMs,
              renderAfterResponseMs,
              cls,
            }),
          ),
          recovery: evidence.recovery,
        },
        null,
        2,
      ),
    );
  }
}
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--self-test") selfTest();
else if (
  args.length === 3 &&
  args[0] === "--run-loopback" &&
  args[1] === "--label" &&
  /^[a-z0-9][a-z0-9-]{0,63}$/.test(args[2])
)
  await run(args[2]);
else if (!args.length)
  console.log(
    "Prepared loopback-only test. --self-test is offline; --run-loopback --label <reviewed-source-label> records a unique local evidence directory.",
  );
else
  throw Error(
    "Only --self-test or --run-loopback --label <lowercase-slug> is accepted. No public origin is configurable.",
  );
