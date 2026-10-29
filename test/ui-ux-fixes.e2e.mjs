import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

// Real current DOM/CSS on loopback. The fixture is rendering data only: no app
// server, RPC, wallet, session API, financial route, or writable endpoint exists.
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "artifacts/ui-ux-audit/fixes");
await fs.mkdir(out, { recursive: true });
const base = "99ffe139193edc8f372f7527f7f94dc3f830ab46";
const fixture = (await import("./fixtures/ui-audit-synthetic.js")).default;
const baselineOnly = process.argv.includes("--baseline-only");
const evidence = {
  baselineCommit: base,
  mode: baselineOnly ? "baseline-only" : "current-regression",
  checks: [],
  measurements: [],
  requests: [],
  writes: [],
  external: [],
  errors: [],
  walletCalls: [],
  screenshots: [],
  limitations: [
    "Synthetic historical snapshot adapted for presentation; no financial or authorization assertions.",
    "Chromium loopback with deterministic delayed GETs; CLS is not a field measurement.",
    "Doubled computed text tests text enlargement, not browser zoom.",
    "One transport deliberately ignores abort to test stale-response defense separately from real network cancellation.",
  ],
};
let role = "alice",
  profile = { bootstrapMs: 0, eventMs: 0 },
  serial = 0;
const syntheticBoot = () => ({
  ...structuredClone(fixture.bootstrap),
  instanceId: "ui-ux-fixes-synthetic",
  mode: "hosted-testnet",
  identities: [],
  session: {
    ...fixture.bootstrap.identities.find((x) => x.id === role),
    mode: "audit-fixture",
    label: "Synthetic wallet",
  },
  capabilities: {
    browserWallet: false,
    contractInbox: false,
    batchActions: false,
  },
  arbitration: {
    mode: "controlled",
    notice: "Synthetic UI test only; no independent jury",
  },
  chain: {
    chainId: 10200,
    name: "Chiado",
    nativeCurrency: { symbol: "XDAI", decimals: 18 },
  },
  events: fixture.bootstrap.events.map((e) => ({
    ...e,
    chainId: 10200,
    contractVersion: "kleros-event-v8",
    abiVersion: "kleros-event-v8",
  })),
});
const syntheticDetail = (id) => {
  const d = structuredClone(fixture.events[id]),
    identity = fixture.bootstrap.identities.find((x) => x.id === role);
  d.event = {
    ...d.event,
    chainId: 10200,
    contractVersion: "kleros-event-v8",
    abiVersion: "kleros-event-v8",
  };
  d.permissions = {
    authenticated: true,
    owner: identity.wallet.toLowerCase() === d.state.owner.toLowerCase(),
    staff: role === "staff-a",
  };
  d.ownWallet = {
    wallet: identity.wallet,
    pendingCreditWei: "2000000000000",
    owedWei: "0",
  };
  if (!d.permissions.owner && !d.permissions.staff) {
    d.participants = d.participants.filter(
      (person) => person.wallet.toLowerCase() === identity.wallet.toLowerCase(),
    );
    d.deposits = [];
    d.unmatched = [];
    d.imports = [];
    d.attendance = d.attendance.filter((observation) =>
      d.participants.some((person) => person.id === observation.participantId),
    );
    d.transactions = d.transactions.filter(
      (tx) => tx.wallet?.toLowerCase() === identity.wallet.toLowerCase(),
    );
  }
  d.state.pendingCreditTotalWei = "2000000000000";
  return d;
};
const baselineAssets = new Map(),
  currentAssets = new Map();
async function asset(rel, baseline) {
  if (rel.includes("..")) throw Error("Invalid asset");
  const cache = baseline ? baselineAssets : currentAssets;
  if (!cache.has(rel)) {
    const value = baseline
      ? execFileSync("git", ["show", base + ":public/" + rel], {
          cwd: root,
          maxBuffer: 16 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        })
      : await fs.readFile(path.join(root, "public", rel));
    cache.set(rel, value);
  }
  return cache.get(rel);
}
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"),
    record = {
      id: ++serial,
      method: req.method,
      path: url.pathname,
      baseline: req.headers["x-ui-baseline"] === "1",
      startedAt: Date.now(),
      closedEarly: false,
    };
  evidence.requests.push(record);
  res.on("close", () => {
    if (!res.writableEnded) record.closedEarly = true;
  });
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      evidence.writes.push(record);
      res.writeHead(405);
      return res.end("Every mutation is blocked in this test");
    }
    if (url.pathname.startsWith("/api/")) {
      const p = { ...profile };
      let value, delay;
      if (url.pathname === "/api/bootstrap") {
        value = syntheticBoot();
        const selected = url.searchParams.get("selectedEventId");
        if (p.bundle && ["event-a", "event-b"].includes(selected)) {
          value.capabilities.selectedEventBootstrap = true;
          value.selectedEvent = {
            eventId: selected,
            instanceId: value.instanceId,
            wallet: value.session.wallet,
            detail: syntheticDetail(selected),
          };
          record.bundledEventId = selected;
        }
        delay = p.bootstrapMs ?? 0;
      } else if (/^\/api\/events\/event-[ab]$/.test(url.pathname)) {
        value = syntheticDetail(url.pathname.split("/").at(-1));
        delay =
          p[url.pathname.endsWith("event-a") ? "eventAMs" : "eventBMs"] ??
          p.eventMs ??
          0;
      } else {
        res.writeHead(404);
        return res.end("{}");
      }
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      record.respondedAt = Date.now();
      if (res.destroyed) return;
      if (p.errorPath === url.pathname) {
        res.writeHead(503, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            error: "Synthetic source unavailable. Please retry.",
          }),
        );
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
      return;
    }
    const rel =
      url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname.slice(1));
    const bytes = await asset(rel, record.baseline);
    res.writeHead(200, {
      "content-type": mime[path.extname(rel)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(bytes);
  } catch (error) {
    record.error = error.message;
    res.writeHead(404);
    res.end("Test asset unavailable");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
let browser, page;
const mark = (label) => evidence.checks.push(label);
const check = (value, label) => {
  assert.ok(value, label);
  mark(label);
};
const count = (p, since = 0) =>
  evidence.requests.slice(since).filter((x) => x.path === p).length;
try {
  browser = await chromium.launch({ headless: true });
  async function makePage({ baseline = false, mobile = true } = {}) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: "reduce",
      extraHTTPHeaders: baseline ? { "X-UI-Baseline": "1" } : {},
    });
    await context.route("**/*", (route) => {
      const req = route.request();
      if (new URL(req.url()).origin !== origin) {
        evidence.external.push({ method: req.method(), url: req.url() });
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await context.addInitScript(() => {
      window.__ux = {
        shifts: [],
        fetches: [],
        aborts: [],
        ignored: [],
        walletCalls: [],
        sockets: [],
      };
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries())
            if (!e.hadRecentInput)
              window.__ux.shifts.push({
                value: e.value,
                time: e.startTime,
                sources: e.sources.map((s) => ({
                  tag: s.node?.tagName,
                  id: s.node?.id,
                  cls: s.node?.className,
                  previous: s.previousRect,
                  current: s.currentRect,
                })),
              });
        }).observe({ type: "layout-shift", buffered: true });
      } catch {}
      const originalFetch = window.fetch;
      window.fetch = function (input, options = {}) {
        const requestPath = new URL(
          typeof input === "string" ? input : input.url,
          location.href,
        ).pathname;
        window.__ux.fetches.push({
          path: requestPath,
          signal: !!options.signal,
        });
        options.signal?.addEventListener(
          "abort",
          () =>
            window.__ux.aborts.push({
              path: requestPath,
              time: performance.now(),
            }),
          { once: true },
        );
        if (window.__ignoreAbortFor === requestPath) {
          window.__ux.ignored.push(requestPath);
          options = { ...options, signal: undefined };
        }
        return originalFetch.call(this, input, options);
      };
      Object.defineProperty(window, "ethereum", {
        configurable: true,
        get() {
          window.__ux.walletCalls.push("ethereum getter");
          return undefined;
        },
      });
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url, ...args) {
          window.__ux.sockets.push(String(url));
          super(url, ...args);
        }
      };
    });
    const p = await context.newPage();
    p.on("pageerror", (error) => evidence.errors.push(error.message));
    return p;
  }
  const capture = async (p, name) => {
    const file = name + ".png";
    await p.screenshot({ path: path.join(out, file), fullPage: false });
    evidence.screenshots.push(file);
  };
  const ready = async (p, event = "event-b") => {
    await expect(p.locator("#content")).toBeVisible();
    await expect(p.locator("#event-switch")).toHaveValue(event);
    await expect(p.locator("#loading")).toBeHidden();
  };
  const visit = async (p, view = "participant", event = "event-b") => {
    await p.goto(origin + "/#" + new URLSearchParams({ event, view }));
    await ready(p, event);
  };
  const cls = async (p) =>
    p.evaluate(() => {
      const shifts = window.__ux.shifts;
      let max = 0,
        sum = 0,
        start = 0,
        last = 0;
      for (const e of shifts) {
        if (e.time - last > 1000 || e.time - start > 5000) {
          sum = 0;
          start = e.time;
        }
        sum += e.value;
        max = Math.max(max, sum);
        last = e.time;
      }
      return { cls: max, sum: shifts.reduce((n, e) => n + e.value, 0), shifts };
    });
  for (const baseline of baselineOnly ? [true] : [true, false])
    for (let run = 1; run <= 2; run++) {
      role = "alice";
      profile = { bootstrapMs: 800, eventMs: 900 };
      const p = await makePage({ baseline });
      await p.goto(origin + "/#event=event-b&view=participant", {
        waitUntil: "domcontentloaded",
      });
      await p.waitForTimeout(150);
      if (run === 1)
        await capture(p, (baseline ? "baseline" : "fixed") + "-mobile-loading");
      const initial = await p.locator(".topbar").boundingBox();
      if (!baseline) {
        await expect(p.locator("#loading")).toBeVisible();
        await expect(p.locator("#loading-status")).toHaveAttribute(
          "role",
          "status",
        );
        await expect(p.locator("#loading-status")).toHaveAttribute(
          "aria-live",
          "polite",
        );
        await expect(p.locator("#content")).toHaveAttribute(
          "aria-busy",
          "true",
        );
        await expect(p.locator("#refresh")).toBeDisabled();
        await expect(p.locator("#loading-status")).toContainText(
          "Reading the selected event",
        );
        if (run === 1)
          mark(
            "Loading phases remain announced outside busy content while refresh is locked",
          );
      }
      await ready(p);
      await p.waitForTimeout(450);
      const value = await cls(p),
        final = await p.locator(".topbar").boundingBox();
      evidence.measurements.push({
        baseline,
        run,
        viewport: "390x844",
        bootstrapDelayMs: 800,
        eventDelayMs: 900,
        initialTopbar: initial,
        finalTopbar: final,
        ...value,
      });
      if (run === 1)
        await capture(p, (baseline ? "baseline" : "fixed") + "-mobile-ready");
      evidence.walletCalls.push(
        ...(await p.evaluate(() => window.__ux.walletCalls)),
      );
      await p.context().close();
    }
  if (baselineOnly) {
    console.log("Baseline CLS captured without changing application assets.");
  } else {
    const baseline = evidence.measurements
        .filter((x) => x.baseline)
        .map((x) => x.cls),
      fixed = evidence.measurements
        .filter((x) => !x.baseline)
        .map((x) => x.cls);
    check(
      fixed.every((x) => x < 0.1),
      "Two cold mobile loads remain below 0.1 real measured CLS under delayed reads",
    );
    check(
      Math.max(...fixed) < Math.min(...baseline),
      "Fixed cold mobile CLS improves over both frozen baseline runs",
    );
    profile = { bootstrapMs: 0, eventMs: 0 };
    page = await makePage({ mobile: false });
    await visit(page);
    const hash = await page.evaluate(() => location.hash);
    await page.locator(".skip").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => location.hash), hash);
    await expect(page.locator("#main")).toBeFocused();
    await expect(page.locator("#event-switch")).toHaveValue("event-b");
    mark(
      "Skip link preserves event/view, selected content and lasting main focus",
    );
    const sameTabReads = evidence.requests.filter((x) =>
      x.path.startsWith("/api/"),
    ).length;
    await page.locator("[data-view=participant]").click();
    await page.waitForTimeout(120);
    assert.equal(
      evidence.requests.filter((x) => x.path.startsWith("/api/")).length,
      sameTabReads,
    );
    mark("Reactivating the selected tab performs no duplicate reads");
    await page.locator("[data-view=organizer]").click();
    await expect(page.locator("[data-view=organizer]")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("[data-view=organizer]")).toBeFocused();
    mark(
      "Clicked event tabs keep focus on the corresponding selected tab after replacement",
    );
    await page.locator("[data-view=organizer]").press("End");
    await expect(page.locator("[data-view=cases]")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.locator("[data-view=participant]")).toBeFocused();
    mark("Arrow-tab Home/End focus remains coherent");
    await page.locator("#event-switch").focus();
    await page.locator("#event-switch").selectOption("event-a");
    await ready(page, "event-a");
    await expect(page.locator("#event-switch")).toBeFocused();
    mark("Changing event preserves focus on the current event selector");
    role = "organizer-b";
    await page.reload();
    await page.goto(origin + "/#event=event-b&view=cases");
    await ready(page);
    await page.locator("[data-edit-event]").click();
    const dialog = page.locator("#review-dialog"),
      summary = dialog.locator("details summary");
    await expect(dialog).toBeVisible();
    await summary.focus();
    await page.keyboard.press("Tab");
    await expect(dialog.locator("[data-close]")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(summary).toBeFocused();
    mark(
      "Closed settings disclosure skips hidden fields in both Tab directions",
    );
    await summary.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.locator("#settings-luma-id")).toBeFocused();
    mark(
      "Opening settings disclosure restores its first visible field to the native order",
    );
    await dialog.locator("details .form-grid").evaluate((grid) => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML =
        '<details open id="fixture-outer"><summary>Outer synthetic disclosure</summary><details id="fixture-inner"><summary>Inner synthetic disclosure</summary><label for="fixture-hidden-input">Nested hidden input</label><input id="fixture-hidden-input"></details><label for="fixture-visible-input">Nested visible input</label><input id="fixture-visible-input"></details>';
      grid.append(wrapper);
    });
    await page.locator("#fixture-inner summary").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#fixture-visible-input")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#fixture-inner summary")).toBeFocused();
    await page.locator("#fixture-outer > summary").focus();
    await page.locator("#fixture-outer > summary").press("Enter");
    await page.keyboard.press("Tab");
    await expect(dialog.locator("[data-close]")).toBeFocused();
    mark(
      "Nested closed disclosures exclude hidden descendants while preserving adjacent visible controls",
    );
    const controls = await dialog.locator("button:visible").all();
    await controls.at(-1).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.locator(".dialog-close")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(controls.at(-1)).toBeFocused();
    mark("Modal focus wraps only at true visible ends");
    await capture(page, "desktop-settings-keyboard");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator("[data-edit-event]")).toBeFocused();
    mark("Escape and trigger restoration remain native and scoped");
    // Test the actual helper in a separate temporary native dialog, never an app save.
    const helperChecks = await page.evaluate(async () => {
      const { trapDialogTab, focusMain } = await import("/ui-keyboard.js");
      const d = document.createElement("dialog");
      d.innerHTML =
        '<h2 tabindex="-1">Synthetic empty dialog</h2><details><summary hidden>Hidden summary</summary><input></details>';
      document.body.append(d);
      d.showModal();
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        cancelable: true,
      });
      trapDialogTab(event, d);
      const fallback =
        document.activeElement === d.querySelector("h2") &&
        event.defaultPrevented;
      d.close();
      d.remove();
      const main = document.querySelector("#main"),
        modified = new MouseEvent("click", { ctrlKey: true, cancelable: true });
      const untouched =
        !focusMain(modified, main) && !modified.defaultPrevented;
      return { fallback, untouched };
    });
    check(
      helperChecks.fallback,
      "A dialog with no sequential controls retains a visible heading focus fallback",
    );
    check(
      helperChecks.untouched,
      "Modified skip-link clicks retain browser link behavior",
    );
    await page.goto(origin + "/#event=event-b&view=participant");
    await ready(page);
    profile = { bootstrapMs: 250, eventMs: 300 };
    const beforeBurst = evidence.requests.length;
    await page.locator("#refresh").evaluate((button) => {
      for (let i = 0; i < 8; i++)
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => count("/api/events/event-b", beforeBurst)).toBe(1);
    await ready(page);
    await page.waitForTimeout(400);
    assert.equal(count("/api/bootstrap", beforeBurst), 1);
    assert.equal(count("/api/events/event-b", beforeBurst), 1);
    mark(
      "Eight same-scope refresh intents share one bootstrap/detail GET flight",
    );
    profile = { bootstrapMs: 150, eventMs: 200 };
    await page.locator("#refresh").focus();
    await page.locator("#refresh").click();
    await expect(page.locator("#refresh")).toBeDisabled();
    await ready(page);
    await expect(page.locator("#refresh")).toBeEnabled();
    await expect(page.locator("#refresh")).toBeFocused();
    mark(
      "An explicitly focused manual refresh returns focus to the enabled Refresh control",
    );
    await page.locator("#refresh").click();
    await expect(page.locator("#refresh")).toBeDisabled();
    await page.locator("#demo-help").focus();
    await ready(page);
    await expect(page.locator("#demo-help")).toBeFocused();
    mark(
      "A pending refresh does not steal focus after the user moves to another stable control",
    );
    for (const ignoreAbort of [false, true]) {
      profile = { bootstrapMs: 0, eventAMs: 900, eventBMs: 0 };
      const start = evidence.requests.length;
      if (ignoreAbort)
        await page.evaluate(
          () => (window.__ignoreAbortFor = "/api/events/event-a"),
        );
      await page.evaluate(
        () => (location.hash = "event=event-a&view=participant"),
      );
      await expect.poll(() => count("/api/events/event-a", start)).toBe(1);
      await page.evaluate(
        () => (location.hash = "event=event-b&view=participant"),
      );
      await ready(page, "event-b");
      await page.waitForTimeout(1050);
      await expect(page.locator("#event-switch")).toHaveValue("event-b");
      await expect(page.locator(".event-heading h1")).toContainText(
        "Open Justice Workshop",
      );
      const trace = await page.evaluate(() => ({
        aborts: window.__ux.aborts,
        ignored: window.__ux.ignored,
      }));
      assert(trace.aborts.some((x) => x.path === "/api/events/event-a"));
      if (ignoreAbort) assert(trace.ignored.includes("/api/events/event-a"));
      else
        assert(
          evidence.requests
            .slice(start)
            .some((x) => x.path === "/api/events/event-a" && x.closedEarly),
        );
      mark(
        ignoreAbort
          ? "A late Event A response cannot repaint Event B even when a test transport ignores abort"
          : "Superseding an Event A GET cancels the actual request before Event B renders",
      );
      await page.evaluate(() => delete window.__ignoreAbortFor);
    }
    profile = { bootstrapMs: 0, eventMs: 0, errorPath: "/api/events/event-b" };
    await page.locator("#refresh").click();
    const alert = page
      .locator("[role=alert]")
      .filter({ hasText: "Synthetic source unavailable" });
    await expect(alert).toBeVisible();
    await expect(page.locator("[data-reload]")).toBeVisible();
    check(
      (await alert.getAttribute("role")) === "alert",
      "Retryable GET failure has an explicit alert announcement",
    );
    profile = { bootstrapMs: 0, eventMs: 0 };
    await page.locator("[data-reload]").click();
    await ready(page);
    check(
      (await page
        .locator("[role=alert]")
        .filter({ hasText: "Synthetic source unavailable" })
        .count()) === 0,
      "Retry performs fresh reads and removes the stale error",
    );
    profile = { bootstrapMs: 50, eventMs: 0, bundle: true };
    const beforeBundle = evidence.requests.length;
    await page.reload();
    await ready(page);
    assert.equal(count("/api/bootstrap", beforeBundle), 1);
    assert.equal(count("/api/events/event-b", beforeBundle), 0);
    assert(
      evidence.requests
        .slice(beforeBundle)
        .some((x) => x.bundledEventId === "event-b"),
    );
    mark(
      "A matching optional selected-event bundle renders the event with one GET and no fallback detail request",
    );
    profile = { bootstrapMs: 0, eventMs: 0 };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await ready(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.body.scrollWidth > innerWidth,
    );
    check(
      !overflow,
      "Fixed mobile content has no horizontal overflow at 390x844",
    );
    await capture(page, "fixed-mobile-final");
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll("body,body *")].map((e) => [
        e,
        parseFloat(getComputedStyle(e).fontSize),
      ]);
      for (const [e, size] of sizes)
        if (e instanceof HTMLElement && Number.isFinite(size))
          e.style.setProperty("font-size", size * 2 + "px", "important");
    });
    check(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.body.scrollWidth <= innerWidth,
      ),
      "Current mobile content reflows at actual doubled computed text",
    );
    await capture(page, "fixed-mobile-200-text");
    evidence.walletCalls.push(
      ...(await page.evaluate(() => window.__ux.walletCalls)),
    );
    const sockets = await page.evaluate(() => window.__ux.sockets);
    assert.deepEqual(sockets, []);
    mark("No WebSocket or wallet provider is used by the regression fixture");
    assert.deepEqual(evidence.writes, []);
    assert.deepEqual(evidence.external, []);
    assert.deepEqual(evidence.walletCalls, []);
    assert.deepEqual(evidence.errors, []);
    mark(
      "All regression requests are isolated GETs with no external request, wallet access or uncaught error",
    );
    console.log(
      "UI UX fixes regression passed: " +
        evidence.checks.length +
        " meaningful checks.",
    );
  }
  evidence.status = "passed";
  await fs.rm(path.join(out, "failure.png"), { force: true });
} catch (error) {
  evidence.status = "failed";
  evidence.failure = { message: error.message, stack: error.stack };
  if (page)
    try {
      await page.screenshot({ path: path.join(out, "failure.png") });
    } catch {}
  throw error;
} finally {
  evidence.assetSha256 = Object.fromEntries(
    [...currentAssets]
      .filter(([name]) => /\.(js|css|html)$/.test(name))
      .map(([name, value]) => [
        name,
        createHash("sha256").update(value).digest("hex"),
      ]),
  );
  await fs.writeFile(
    path.join(out, baselineOnly ? "baseline-results.json" : "results.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
