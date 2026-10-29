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
import {
  makeLumaLaunchFixture,
  makeLumaSetupFixture,
  LUMA_FACTORY_ADDRESS,
  LUMA_CREATED_EVENT_ID,
  LUMA_LAUNCH_HASH,
} from "./fixtures/luma-launch-fixture.mjs";
import { FIXTURE_WALLET as wallet } from "./fixtures/production-ui-fixture.mjs";
import { createTransactionJournal } from "../public/transaction-context.js";

// TEST ONLY: immutable/current static UI; synthetic loopback GETs and one exact fake signout.
const root = fileURLToPath(new URL("../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const protocol = Object.freeze({
  catalogDelayMs: 1500,
  staticDelayMs: 80,
  viewport: [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ],
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  cpu: "unthrottled",
  compression: "none",
  cache: "no-store",
});
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const initialJS = [
  "entry.js",
  "public-home.js",
  "event-search.js",
  "contract-profiles.js",
  "ui-keyboard.js",
].sort();
const initialCSS = ["styles.css", "loading.css", "luma-launch.css"].sort();
async function assetsAt(dir, prefix = "", map = new Map()) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      await assetsAt(path.join(dir, entry.name), name + "/", map);
    else if (mime[path.extname(name)])
      map.set(name, await fs.readFile(path.join(dir, entry.name)));
  }
  return map;
}
function allowed(origin, url, method, body, names) {
  const u = new URL(url);
  if (u.origin !== origin) return false;
  if (method === "DELETE")
    return u.pathname === "/api/session" && !u.search && body === "{}";
  if (method !== "GET" || body) return false;
  if (u.pathname === "/api/bootstrap")
    return !u.search || u.search === "?selectedEventId=" + PUBLIC_SEARCH_A;
  return (
    !u.search &&
    (["/", "/api/public-catalog"].includes(u.pathname) ||
      names.has(u.pathname.slice(1)))
  );
}
function catalogFor(fixture) {
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
    environment: fixture.bootstrap.environment,
    chain: fixture.bootstrap.chain,
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
function seedRecovery(bootstrap) {
  const data = new Map(),
    storage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    };
  const context = {
    eventId: LUMA_CREATED_EVENT_ID,
    wallet,
    chainId: 1,
    contract: LUMA_FACTORY_ADDRESS,
    abiVersion: "kleros-event-v9-uups",
    mode: "hosted-production",
    instanceId: bootstrap.instanceId,
  };
  createTransactionJournal(storage).record(context, {
    hash: LUMA_LAUNCH_HASH,
    draftId: "synthetic-startup-saved-review",
    action: "createEvent",
  });
  const markerKey =
    "kleros-factory-creation:v1:" +
    [
      context.instanceId,
      context.mode,
      context.chainId,
      context.contract.toLowerCase(),
      wallet.toLowerCase(),
      context.abiVersion,
    ]
      .map(encodeURIComponent)
      .join(":");
  data.set(
    markerKey,
    JSON.stringify({
      version: 1,
      draftId: "synthetic-startup-saved-review",
      eventId: context.eventId,
      phase: "submitted",
      hash: LUMA_LAUNCH_HASH,
    }),
  );
  return [...data];
}
async function run(baseline) {
  const { chromium, expect } = await import("@playwright/test");
  const out = path.join(
    root,
    "artifacts/lean-startup",
    (baseline ? "baseline-run-" : "candidate-") +
      new Date().toISOString().replaceAll(":", "-"),
  );
  await fs.mkdir(out, { recursive: true });
  const assets = await assetsAt(
      path.join(
        root,
        baseline ? "artifacts/lean-startup/baseline/assets" : "public",
      ),
    ),
    names = new Set(assets.keys());
  const fixture = makePublicEventSearchFixture(),
    setup = makeLumaSetupFixture(),
    catalog = catalogFor(fixture);
  const result = {
    status: "running",
    baseline,
    protocol,
    protocolSha256: sha(JSON.stringify(protocol)),
    harnessSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
    assetSha256: Object.fromEntries(
      [...assets].map(([name, bytes]) => [name, sha(bytes)]),
    ),
    checks: [],
    metrics: [],
    requests: [],
    blocked: [],
    errors: [],
    providerRequests: [],
    screenshots: [],
    limits: [
      "Synthetic source-bound loopback only.1500ms catalog and80ms EVERY static response are fixed server wait models, not real network/provider latency, throughput, cache or field Web Vitals.",
      "Ordinary browser route.continue; no route.fetch or source/body replacement in browser transport.",
      "No wallet request, auth POST, financial endpoint, RPC, key, signature, upload or broadcast is allowed. Only exact fake local DELETEsession is permitted in the isolated invalidation case.",
      "Baseline uses immutable exact tracked public bytes fromb0208ea/LIVE9cac8df includingwidget829d8c31. No older timing sample substitutes for it.",
    ],
  };
  await fs.copyFile(
    fileURLToPath(import.meta.url),
    path.join(out, "tested-harness.mjs.txt"),
  );
  let sample = "none",
    catalogStatus = 200,
    malformed = false,
    signed = false,
    bootKind = "catalog",
    catalogDelay = protocol.catalogDelayMs,
    staticFailure = null,
    bodyHeld = false,
    browser;
  const held = new Set(),
    gates = new Map();
  const gate = (key) =>
    held.has(key)
      ? new Promise((resolve) =>
          gates.set(key, [...(gates.get(key) ?? []), resolve]),
        )
      : Promise.resolve();
  const release = (key) => {
    held.delete(key);
    for (const resolve of gates.get(key) ?? []) resolve();
    gates.delete(key);
  };
  const server = http.createServer(async (req, res) => {
    const body = Buffer.concat(await Array.fromAsync(req)).toString(),
      url = new URL(req.url, "http://127.0.0.1");
    const item = {
      sample,
      method: req.method,
      path: url.pathname,
      query: url.search,
      body,
      receivedAt: Date.now(),
    };
    result.requests.push(item);
    const send = (status, value) => {
      item.status = status;
      item.respondedAt = Date.now();
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    if (
      !allowed(
        "http://" + req.headers.host,
        "http://" + req.headers.host + req.url,
        req.method,
        body,
        names,
      )
    ) {
      result.blocked.push(item);
      send(405, {});
      return;
    }
    if (url.pathname === "/api/session") {
      signed = false;
      send(200, { ok: true });
      return;
    }
    if (url.pathname === "/api/public-catalog") {
      const status = catalogStatus,
        value = structuredClone(catalog);
      if (malformed) value.schemaVersion = 99;
      await new Promise((resolve) => setTimeout(resolve, catalogDelay));
      await gate("catalog");
      if (bodyHeld && status === 200) {
        item.status = 200;
        item.headersSent = true;
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.flushHeaders();
        await gate("catalog-body");
        item.respondedAt = Date.now();
        res.end(JSON.stringify(value));
        return;
      }
      send(
        status,
        status === 200
          ? value
          : { error: "Synthetic catalog unavailable. Try again." },
      );
      return;
    }
    if (url.pathname === "/api/bootstrap") {
      const eventId = url.searchParams.get("selectedEventId");
      const value = structuredClone(
        eventId
          ? makeLumaLaunchFixture(signed ? "ready" : "anonymous", { eventId })
              .bootstrap
          : bootKind === "setup"
            ? setup.bootstrap
            : fixture.bootstrap,
      );
      value.session = signed
        ? { wallet, label: "Synthetic owner", mode: "wallet" }
        : null;
      if (eventId) {
        const full = makeLumaLaunchFixture(signed ? "ready" : "anonymous", {
          eventId,
        });
        value.capabilities.selectedEventBootstrap = true;
        value.events = [full.detail.event];
        value.selectedEvent = {
          eventId,
          instanceId: value.instanceId,
          wallet: signed ? wallet : null,
          detail: full.detail,
        };
      }
      item.actor = value.session?.wallet ?? null;
      send(200, value);
      return;
    }
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1),
      bytes = assets.get(name);
    await new Promise((resolve) => setTimeout(resolve, protocol.staticDelayMs));
    await gate(name);
    if (staticFailure === name) {
      staticFailure = null;
      item.status = 503;
      res.writeHead(503);
      res.end("Synthetic module failure");
      return;
    }
    item.status = 200;
    item.bytes = bytes.length;
    item.respondedAt = Date.now();
    res.writeHead(200, {
      "content-type": mime[path.extname(name)],
      "cache-control": "no-store",
    });
    res.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const requestsSince = (start) =>
    result.requests
      .slice(start)
      .filter((item) => item.path.startsWith("/api/"));
  const reset = () => {
    catalogStatus = 200;
    malformed = false;
    signed = false;
    bootKind = "catalog";
    catalogDelay = 10;
    staticFailure = null;
    bodyHeld = false;
    for (const key of [...held]) release(key);
  };
  try {
    browser = await chromium.launch({ headless: true });
    result.browser = browser.version();
    async function makePage(viewport, seeded = []) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      await context.route("**/*", (route) => {
        const req = route.request();
        if (!allowed(origin, req.url(), req.method(), req.postData(), names)) {
          result.blocked.push({ sample, method: req.method(), url: req.url() });
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      await context.routeWebSocket("**/*", (socket) => {
        result.blocked.push({ sample, type: "WebSocket" });
        socket.close();
      });
      await context.addInitScript((pairs) => {
        for (const [key, value] of pairs) localStorage.setItem(key, value);
        const trace = (window.__leanTrace = {
          usableMs: null,
          loadingMs: null,
          lcp: null,
          shifts: [],
          longTasks: [],
          providerAccess: 0,
          providerRequests: [],
          storageReads: [],
        });
        const nativeGet = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (/^kleros-(transactions|factory-creation|batch)/.test(key))
            trace.storageReads.push(key);
          return nativeGet.call(this, key);
        };
        const handlers = new Map();
        const provider = {
          on(name, callback) {
            const list = handlers.get(name) ?? [];
            list.push(callback);
            handlers.set(name, list);
          },
          async request(payload) {
            trace.providerRequests.push(payload.method);
            throw Error("No provider request allowed in lean startup test");
          },
        };
        Object.defineProperty(window, "ethereum", {
          get() {
            trace.providerAccess++;
            return provider;
          },
        });
        window.__leanEmit = (name, payload) => {
          for (const callback of handlers.get(name) ?? []) callback(payload);
        };
        let queued = false;
        const probe = () => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            const content = document.querySelector("#content"),
              loading = document.querySelector("#loading"),
              search = document.querySelector("[data-public-event-search]"),
              status = document.querySelector("[data-public-event-status]");
            if (
              trace.loadingMs === null &&
              loading &&
              !loading.hidden &&
              loading.getClientRects().length
            )
              trace.loadingMs = performance.now();
            if (
              trace.usableMs === null &&
              document.querySelector("[data-public-catalog-screen]") &&
              content &&
              !content.hidden &&
              content.getAttribute("aria-busy") === "false" &&
              search &&
              !search.disabled &&
              search.getClientRects().length &&
              status?.textContent === "2 public events."
            )
              trace.usableMs = performance.now();
          });
        };
        new MutationObserver(probe).observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        probe();
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              trace.lcp = { ms: e.startTime, tag: e.element?.tagName ?? null };
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              if (!e.hadRecentInput)
                trace.shifts.push({ time: e.startTime, value: e.value });
          }).observe({ type: "layout-shift", buffered: true });
          new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              trace.longTasks.push({ time: e.startTime, duration: e.duration });
          }).observe({ type: "longtask", buffered: true });
        } catch {}
      }, seeded);
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      page.on("pageerror", (error) => result.errors.push(error.message));
      return page;
    }
    const ready = async (page, hasQuery = false) => {
      await expect(page.locator("[data-public-event-status]")).toHaveText(
        hasQuery ? "2 matching public events." : "2 public events.",
      );
      await expect(page.locator("#loading")).toBeHidden();
      await expect(page.locator("#content")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    };
    const capture = async (page, name) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        );
      });
      await page.screenshot({ path: path.join(out, name + ".png") });
      result.screenshots.push(name + ".png");
    };
    const closePage = async (page) => {
      result.providerRequests.push(
        ...(await page.evaluate(() => window.__leanTrace.providerRequests)),
      );
      await page.context().close();
    };
    for (const viewport of protocol.viewport) {
      sample = (viewport.width === 390 ? "mobile" : "desktop") + "-cold";
      catalogDelay = protocol.catalogDelayMs;
      const page = await makePage(viewport),
        start = result.requests.length;
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#loading")).toBeVisible();
      await capture(page, sample + "-loading");
      await ready(page);
      await page.waitForFunction(() => window.__leanTrace.usableMs !== null);
      await capture(page, sample + "-ready");
      await page.waitForTimeout(100);
      const metrics = await page.evaluate(() => {
        const t = window.__leanTrace,
          resources = performance.getEntriesByType("resource").map((e) => ({
            path: new URL(e.name).pathname,
            startMs: e.startTime,
            firstByteMs: e.responseStart,
            bodyEndMs: e.responseEnd,
            durationMs: e.duration,
            decodedBytes: e.decodedBodySize,
            transferBytes: e.transferSize,
          }));
        let cls = 0,
          sum = 0,
          first = 0,
          last = 0;
        for (const e of t.shifts) {
          if (e.time - last > 1000 || e.time - first > 5000) {
            sum = 0;
            first = e.time;
          }
          sum += e.value;
          cls = Math.max(cls, sum);
          last = e.time;
        }
        return {
          fcpMs:
            performance.getEntriesByName("first-contentful-paint")[0]
              ?.startTime ?? null,
          loadingMs: t.loadingMs,
          usableMs: t.usableMs,
          lcp: t.lcp,
          cls,
          resources,
          longTasks: t.longTasks,
          providerAccess: t.providerAccess,
          storageReads: t.storageReads,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      const api = requestsSince(start);
      assert.deepEqual(
        api.map((item) => item.path),
        ["/api/public-catalog"],
      );
      assert.equal(metrics.providerAccess, 0);
      assert.deepEqual(metrics.storageReads, []);
      assert.equal(metrics.overflow, false);
      const catalogResource = metrics.resources.find(
        (item) => item.path === "/api/public-catalog",
      );
      assert(catalogResource);
      metrics.renderAfterCatalogMs =
        metrics.usableMs - catalogResource.bodyEndMs;
      metrics.catalog = catalogResource;
      metrics.js = metrics.resources.filter((item) =>
        item.path.endsWith(".js"),
      );
      metrics.css = metrics.resources.filter((item) =>
        item.path.endsWith(".css"),
      );
      metrics.jsBytes = metrics.js.reduce(
        (n, item) => n + item.decodedBytes,
        0,
      );
      metrics.cssBytes = metrics.css.reduce(
        (n, item) => n + item.decodedBytes,
        0,
      );
      if (!baseline) {
        assert.deepEqual(
          metrics.js.map((item) => item.path.slice(1)).sort(),
          initialJS,
        );
        assert.deepEqual(
          metrics.css.map((item) => item.path.slice(1)).sort(),
          initialCSS,
        );
        assert(
          catalogResource.startMs <=
            metrics.js.find((item) => item.path === "/public-home.js").startMs,
        );
      }
      result.metrics.push({ sample, viewport, ...metrics });
      result.checks.push(
        sample +
          ": exact enabled-search/catalog/status readiness, one catalog, no bootstrap/provider/journal; source-bound graph and timings captured",
      );
      await closePage(page);
    }
    if (!baseline) {
      reset();
      sample = "privacy-keyboard-search";
      let page = await makePage({ width: 1440, height: 900 });
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await ready(page);
      for (const title of PRIVATE_SEARCH_TITLES)
        assert(!(await page.locator("body").textContent()).includes(title));
      await expect(page.locator("#public-event-search-xss")).toHaveCount(0);
      const hashBeforeSkip = new URL(page.url()).hash;
      await page.locator(".skip").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main")).toBeFocused();
      assert.equal(new URL(page.url()).hash, hashBeforeSkip);
      const field = page.locator("[data-public-event-search]");
      await field.fill("ALPHA");
      await field.evaluate((node) => {
        window.__searchNode = node;
        node.setSelectionRange(2, 2);
      });
      catalogDelay = 100;
      let start = result.requests.length;
      await page.locator("#refresh").evaluate((node) => node.click());
      await ready(page, true);
      await expect(field).toBeFocused();
      assert(
        await field.evaluate(
          (node) => node === window.__searchNode && node.selectionStart === 2,
        ),
      );
      assert.deepEqual(
        requestsSince(start).map((item) => item.path),
        ["/api/public-catalog"],
      );
      start = result.requests.length;
      await field.fill("no matching public title");
      await expect(page.locator("[data-public-event-row]")).toHaveCount(0);
      await expect(field).toBeFocused();
      await page.locator("[data-public-event-clear]").click();
      await expect(field).toHaveValue("");
      assert.equal(result.requests.length, start);
      await expect(field).toBeFocused();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        const sizes = [...document.querySelectorAll("body,body *")].map(
          (node) => [node, parseFloat(getComputedStyle(node).fontSize)],
        );
        for (const [node, size] of sizes)
          if (node instanceof HTMLElement && Number.isFinite(size))
            node.style.setProperty("font-size", size * 2 + "px", "important");
      });
      await field.scrollIntoViewIfNeeded();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        );
      });
      await page
        .locator(".public-event-search")
        .screenshot({ path: path.join(out, "mobile-200-text-component.png") });
      result.screenshots.push("mobile-200-text-component.png");
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      result.checks.push(
        "Lean public projection excludes private/malformed entries and markup; Skip/query/clear/caret/focus work locally; same-scope refresh retains input and enlarged mobile text reflows",
      );
      await closePage(page);

      reset();
      sample = "errors-retry";
      page = await makePage({ width: 1440, height: 900 });
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await ready(page);
      catalogStatus = 503;
      start = result.requests.length;
      await page.locator("#refresh").focus();
      await page.locator("#refresh").click();
      await expect(page.locator('[role="alert"]')).toBeVisible();
      await expect(page.locator("[data-public-catalog-retry]")).toBeFocused();
      assert.deepEqual(
        requestsSince(start).map((item) => item.path),
        ["/api/public-catalog"],
      );
      catalogStatus = 200;
      await page.keyboard.press("Enter");
      await ready(page);
      await expect(page.locator("[data-public-event-search]")).toBeFocused();
      malformed = true;
      start = result.requests.length;
      await page.locator("#refresh").click();
      await expect(page.locator('[role="alert"]')).toBeVisible();
      assert.deepEqual(
        requestsSince(start).map((item) => item.path),
        ["/api/public-catalog"],
      );
      assert.equal(
        result.requests.filter(
          (item) => item.sample === sample && item.path === "/app.js",
        ).length,
        0,
      );
      result.checks.push(
        "503 and malformed catalog errors never import full app or fall back; explicit keyboard retry restores search focus",
      );
      await closePage(page);

      reset();
      sample = "404-one-shot";
      catalogStatus = 404;
      page = await makePage({ width: 1440, height: 900 });
      start = result.requests.length;
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await ready(page);
      assert.deepEqual(
        requestsSince(start).map((item) => item.path),
        ["/api/public-catalog", "/api/bootstrap"],
      );
      catalogStatus = 200;
      await page.locator("#refresh").click();
      await ready(page);
      await expect(page.locator("[data-public-catalog-screen]")).toBeVisible();
      assert.deepEqual(
        requestsSince(start).map((item) => item.path),
        ["/api/public-catalog", "/api/bootstrap", "/api/public-catalog"],
      );
      assert.equal(
        result.requests.slice(start).filter((item) => item.path === "/app.js")
          .length,
        1,
      );
      result.checks.push(
        "404 consumes one legacy hint and one full-app bootstrap; later refresh retries catalog without persistent skip or repeated app import",
      );
      await closePage(page);

      reset();
      sample = "journal-session-handoff";
      signed = true;
      bootKind = "setup";
      page = await makePage(
        { width: 1440, height: 900 },
        seedRecovery(setup.bootstrap),
      );
      start = result.requests.length;
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await ready(page);
      assert(
        !(await page.locator("body").textContent()).includes(LUMA_LAUNCH_HASH),
      );
      assert.deepEqual(
        await page.evaluate(() => window.__leanTrace.storageReads),
        [],
      );
      await page.locator("[data-public-event-search]").fill("ALPHA");
      await page.locator('a[href="#setup=kickback"]').click();
      await expect(page.locator("[data-luma-recovery]")).toContainText(
        LUMA_LAUNCH_HASH,
      );
      await expect(page.locator('[data-luma-action="review"]')).toHaveCount(0);
      assert(
        (await page.evaluate(() => window.__leanTrace.storageReads)).length > 0,
      );
      await page.locator(".mobile-brand").click();
      await ready(page, true);
      await expect(page.locator("[data-public-event-search]")).toHaveValue(
        "ALPHA",
      );
      const sessionStart = result.requests.length;
      await page.evaluate(() =>
        window.__leanEmit("accountsChanged", ["0x" + "9".repeat(40)]),
      );
      await expect
        .poll(
          () =>
            requestsSince(sessionStart).filter(
              (item) => item.method === "DELETE",
            ).length,
        )
        .toBe(1);
      await ready(page, true);
      await page.locator('a[href="#setup=kickback"]').click();
      await expect(
        page.locator("#luma-setup [data-connect-wallet]"),
      ).toBeVisible();
      assert(
        !(await page.locator("body").textContent()).includes(LUMA_LAUNCH_HASH),
      );
      assert.equal(
        result.requests.slice(start).filter((item) => item.path === "/app.js")
          .length,
        1,
      );
      assert.deepEqual(
        requestsSince(start)
          .filter((item) => item.method !== "GET")
          .map((item) => [item.method, item.path, item.body]),
        [["DELETE", "/api/session", "{}"]],
      );
      result.checks.push(
        "One native setup handoff initializes recovery before creation, preserves pending hash privately, carries only same-context query and retains negative wallet invalidation with one fake logout",
      );
      await closePage(page);

      reset();
      sample = "cold-deep-links";
      for (const route of [
        "#event=" + PUBLIC_SEARCH_A + "&view=participant",
        "#setup=kickback",
      ]) {
        bootKind = "setup";
        page = await makePage({ width: 1440, height: 900 });
        start = result.requests.length;
        await page.goto(origin + "/" + route, {
          waitUntil: "domcontentloaded",
        });
        await expect(
          page.locator(
            route.startsWith("#event") ? "[data-luma-launch]" : "#luma-setup",
          ),
        ).toBeVisible();
        assert.equal(requestsSince(start).length, 1);
        assert.equal(requestsSince(start)[0].path, "/api/bootstrap");
        assert.equal(
          result.requests.slice(start).filter((item) => item.path === "/app.js")
            .length,
          1,
        );
        await expect(page.locator("[data-public-catalog-screen]")).toHaveCount(
          0,
        );
        await closePage(page);
      }
      result.checks.push(
        "Cold selected-event and setup URLs load full app directly once, with one fresh scoped bootstrap, no catalog request and no lean catalog screen",
      );

      reset();
      sample = "late-catalog-latest-hash";
      bootKind = "setup";
      held.add("catalog");
      held.add("app.js");
      page = await makePage({ width: 1440, height: 900 });
      start = result.requests.length;
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await expect
        .poll(
          () =>
            requestsSince(start).filter(
              (item) => item.path === "/api/public-catalog",
            ).length,
        )
        .toBe(1);
      await page.evaluate(() => {
        location.hash = "setup=kickback";
      });
      await expect
        .poll(
          () =>
            result.requests
              .slice(start)
              .filter((item) => item.path === "/app.js").length,
        )
        .toBe(1);
      await page.evaluate((id) => {
        location.hash = "event=" + id + "&view=participant";
      }, PUBLIC_SEARCH_A);
      release("app.js");
      await expect(page.locator("[data-luma-launch]")).toBeVisible();
      release("catalog");
      await page.waitForTimeout(100);
      await expect(page.locator("[data-luma-launch]")).toBeVisible();
      await expect(page.locator("[data-public-catalog-screen]")).toHaveCount(0);
      assert.deepEqual(
        requestsSince(start).map((item) => [item.path, item.query]),
        [
          ["/api/public-catalog", ""],
          ["/api/bootstrap", "?selectedEventId=" + PUBLIC_SEARCH_A],
        ],
      );
      result.checks.push(
        "Sticky handoff uses latest hash while app import is held; late aborted home response cannot repaint selected event",
      );
      await closePage(page);

      reset();
      sample = "import-failure";
      bootKind = "setup";
      staticFailure = "app.js";
      page = await makePage({ width: 1440, height: 900 });
      start = result.requests.length;
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await ready(page);
      await page.locator('a[href="#setup=kickback"]').click();
      await expect(page.locator('[role="alert"]')).toBeVisible();
      await expect(page.locator("[data-startup-reload]")).toBeVisible();
      assert.equal(
        requestsSince(start).filter((item) => item.path === "/api/bootstrap")
          .length,
        0,
      );
      await page.locator("[data-startup-reload]").click();
      await expect(
        page.locator("#luma-setup [data-connect-wallet]"),
      ).toBeVisible();
      assert.equal(
        requestsSince(start).filter((item) => item.path === "/api/bootstrap")
          .length,
        1,
      );
      result.checks.push(
        "Full-app import failure exposes explicit reload without bootstrap, signing or automatic retry; user reload safely resumes setup",
      );
      await closePage(page);

      reset();
      sample = "headers-body-deadline";
      bodyHeld = true;
      held.add("catalog-body");
      page = await makePage({ width: 1440, height: 900 });
      await page.clock.install();
      start = result.requests.length;
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await expect
        .poll(
          () =>
            result.requests
              .slice(start)
              .find((item) => item.path === "/api/public-catalog")?.headersSent,
        )
        .toBe(true);
      await expect(page.locator("#loading-status")).toHaveText(
        "Reading public event details…",
      );
      await page.clock.fastForward(35050);
      await expect(page.locator('[role="alert"]')).toBeVisible();
      await expect(page.locator("[data-public-catalog-retry]")).toBeVisible();
      assert.deepEqual(
        requestsSince(start).map((item) => item.path),
        ["/api/public-catalog"],
      );
      bodyHeld = false;
      release("catalog-body");
      await page.locator("[data-public-catalog-retry]").click();
      await ready(page);
      result.checks.push(
        "The35s deadline covers a held JSON body after200headers; clock-driven expiry exposes explicit retry with no bootstrap fallback",
      );
      await closePage(page);
    }
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.providerRequests, []);
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.failure = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    for (const key of [...held]) release(key);
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    result.completedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(out, "results.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        {
          status: result.status,
          groups: result.checks.length,
          protocolSha256: result.protocolSha256,
          metrics: result.metrics.map(
            ({
              sample,
              fcpMs,
              usableMs,
              renderAfterCatalogMs,
              cls,
              jsBytes,
              cssBytes,
              js,
              catalog,
            }) => ({
              sample,
              fcpMs,
              usableMs,
              renderAfterCatalogMs,
              cls,
              jsBytes,
              cssBytes,
              jsCount: js.length,
              catalogStartMs: catalog.startMs,
            }),
          ),
          out,
        },
        null,
        2,
      ),
    );
  }
}
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--baseline") await run(true);
else if (args.length === 1 && args[0] === "--candidate") await run(false);
else if (!args.length)
  console.log(
    "Prepared source-pinned loopback-only lean startup test. --baseline serves archivedLIVE9cac bytes; --candidate requires source-ready. No public origin configurable.",
  );
else
  throw Error(
    "Only --baseline or --candidate accepted; no public origin, provider or financial mode exists.",
  );
