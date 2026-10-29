import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// TEST ONLY: component props are synthetic presentation facts, not backend/receipt authority.
const root = fileURLToPath(new URL("../", import.meta.url));
const hash = "0x" + "c".repeat(64);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const goodEvent = {
  id: "synthetic-progress-event",
  depositUrl: "/#event=synthetic-progress-event&view=participant",
  manageUrl: "/#event=synthetic-progress-event&view=organizer",
  verified: true,
};
async function run() {
  const { chromium, expect } = await import("@playwright/test");
  const out = path.join(
    root,
    "artifacts/setup-progress",
    new Date().toISOString().replaceAll(":", "-"),
  );
  await fs.mkdir(out, { recursive: true });
  const names = [
    "setup-progress.js",
    "styles.css",
    "luma-launch.css",
    "assets/geist-latin.woff2",
    "assets/geist-mono-latin.woff2",
    "assets/instrument-serif-regular.woff2",
  ];
  const assets = new Map(
    await Promise.all(
      names.map(async (name) => [
        name,
        await fs.readFile(path.join(root, "public", name)),
      ]),
    ),
  );
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic progress component test</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/luma-launch.css"><style>body{margin:0}main{max-width:960px;margin:auto;padding:24px 16px}.fixture-note{color:#ffcd70;font-size:14px}#outside{margin-bottom:16px}</style></head><body><main><p class="fixture-note">SYNTHETIC COMPONENT TEST · No wallet, receipt, public service or transaction.</p><button id="outside" class="button">Outside focus target</button><div id="fixture"></div></main><script type="module">import {mountSetupProgress} from '/setup-progress.js';window.__current=true;window.__copied=[];window.__checked=[];window.__mount=(callbacks=true)=>{window.__component?.dispose();window.__component=mountSetupProgress(document.querySelector('#fixture'),{isCurrent:()=>window.__current,...(callbacks?{onCopy:value=>window.__copied.push(value),onCheck:value=>window.__checked.push(value)}:{})});};window.__mount();window.__ready=true;</script></body></html>`;
  assets.set("index.html", Buffer.from(html));
  const result = {
    status: "running",
    harnessSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
    sourceSha256: Object.fromEntries(
      [...assets].map(([name, bytes]) => [name, sha(bytes)]),
    ),
    checks: [],
    staticRequests: [],
    blocked: [],
    pageErrors: [],
    screenshots: [],
    effects: null,
    limits: [
      "Only the real pure component and styles execute. All props/hashes/verified flags are synthetic; no backend, chain receipt, wallet support or ownership is established.",
      "Static loopback GETs are allowed. Component fetch/XHR/provider/storage/clipboard/timer/beacon access is counted separately and must remain zero. Native links are inspected, not followed.",
      "No real human transaction hash, API/job/session/auth route, RPC, signature, financial transaction or upload is used.",
    ],
  };
  await fs.copyFile(
    fileURLToPath(import.meta.url),
    path.join(out, "tested-harness.mjs.txt"),
  );
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1"),
      name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (req.method !== "GET" || url.search || !assets.has(name)) {
      result.blocked.push({ method: req.method, path: url.pathname });
      res.writeHead(405);
      res.end();
      return;
    }
    result.staticRequests.push(name);
    res.writeHead(200, {
      "content-type": mime[path.extname(name)],
      "cache-control": "no-store",
    });
    res.end(assets.get(name));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser, page;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) => {
      const req = route.request(),
        u = new URL(req.url());
      if (u.origin !== origin || req.method() !== "GET" || u.search) {
        result.blocked.push({ method: req.method(), url: req.url() });
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await context.routeWebSocket("**/*", (socket) => {
      result.blocked.push({ type: "WebSocket" });
      socket.close();
    });
    await context.addInitScript(() => {
      const effect = (window.__effects = {
        request: 0,
        provider: 0,
        storage: 0,
        clipboard: 0,
        timer: 0,
        beacon: 0,
      });
      window.fetch = () => {
        effect.request++;
        return Promise.reject(Error("No component transport"));
      };
      window.XMLHttpRequest = class {
        constructor() {
          effect.request++;
          throw Error("No component transport");
        }
      };
      Object.defineProperty(window, "ethereum", {
        get() {
          effect.provider++;
          throw Error("No provider access");
        },
      });
      for (const name of ["localStorage", "sessionStorage"])
        Object.defineProperty(window, name, {
          get() {
            effect.storage++;
            throw Error("No storage access");
          },
        });
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText() {
            effect.clipboard++;
            return Promise.reject(Error("Use the explicit fixture callback"));
          },
        },
      });
      navigator.sendBeacon = () => {
        effect.beacon++;
        return false;
      };
      const timeout = window.setTimeout.bind(window),
        interval = window.setInterval.bind(window);
      window.setTimeout = (...args) => {
        effect.timer++;
        return timeout(...args);
      };
      window.setInterval = (...args) => {
        effect.timer++;
        return interval(...args);
      };
    });
    page = await context.newPage();
    page.on("pageerror", (error) => result.pageErrors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ready === true);
    const update = (value) =>
      page.evaluate((props) => window.__component.update(props), value);
    const phase = page.locator("[data-setup-phase]");
    const internalLinks = () =>
      page
        .locator("#fixture a[href]")
        .evaluateAll((nodes) =>
          nodes
            .map((node) => node.href)
            .filter((url) =>
              new URLSearchParams(new URL(url).hash.slice(1)).has("event"),
            ),
        );
    const capture = async (name) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        );
      });
      await page.screenshot({
        path: path.join(out, name + ".png"),
        fullPage: true,
      });
      result.screenshots.push(name + ".png");
    };
    for (const value of [
      "preparing",
      "validating",
      "wallet-review",
      "submitted",
      "confirmations",
      "portal-verification",
    ]) {
      await update({
        phase: value,
        ...(value === "submitted" ||
        value === "confirmations" ||
        value === "portal-verification"
          ? { hash, chainId: 1 }
          : {}),
      });
      await expect(phase).toHaveAttribute("data-setup-phase", value);
      assert.deepEqual(await internalLinks(), []);
      await expect(
        page.locator("[data-setup-progress-status]"),
      ).toHaveAttribute("role", "status");
      assert(
        await page
          .locator("[data-setup-progress-status]")
          .evaluate((node) => !node.closest('[aria-busy="true"]')),
      );
    }
    result.checks.push(
      "Supported progress phases remain distinct and live status stays outside busy visual content",
    );
    await update({
      phase: "confirmations",
      hash,
      chainId: 1,
      confirmations: 1,
      requiredConfirmations: 2,
    });
    await expect(page.locator("#fixture")).toContainText(/1\s*(?:of|\/)\s*2/);
    for (const counts of [
      {},
      { confirmations: -1, requiredConfirmations: 2 },
      { confirmations: 1, requiredConfirmations: 0 },
    ]) {
      await update({ phase: "confirmations", hash, chainId: 1, ...counts });
      await expect(page.locator("[data-setup-progress-status]")).toContainText(
        counts.confirmations === 1
          ? "1 confirmations reported; the required count is not available."
          : "Confirmation count is not available yet.",
      );
    }
    await update({ phase: "not-a-real-phase", hash, chainId: 1 });
    assert.deepEqual(await internalLinks(), []);
    result.checks.push(
      "Only supplied valid confirmation counts display; missing or invalid counts remain explicitly unavailable and unknown phases cannot expose ready links",
    );
    await update({
      phase: "verification-failed",
      hash,
      chainId: 1,
      transactionConfirmed: true,
      message: '<img id="progress-xss" src=x onerror=alert(1)>',
      reasonCode: "TX_MISMATCH",
      event: goodEvent,
    });
    await expect(phase).toHaveAttribute(
      "data-setup-phase",
      "verification-failed",
    );
    await expect(page.locator("[data-setup-progress-hash]")).toHaveValue(hash);
    await expect(page.locator("#progress-xss")).toHaveCount(0);
    assert.deepEqual(await internalLinks(), []);
    await expect(page.locator("#fixture")).toContainText("TX_MISMATCH");
    result.checks.push(
      "A confirmed transaction with failed portal verification retains its exact hash and escaped reason without presenting a ready event",
    );
    await update({
      phase: "ready",
      hash,
      chainId: 1,
      transactionConfirmed: true,
      event: goodEvent,
    });
    assert.deepEqual(
      (await internalLinks()).sort(),
      [origin + goodEvent.depositUrl, origin + goodEvent.manageUrl].sort(),
    );
    for (const patch of [
      { transactionConfirmed: false },
      { event: { ...goodEvent, verified: false } },
      {
        event: {
          ...goodEvent,
          manageUrl:
            "https://foreign.test/#event=synthetic-progress-event&view=organizer",
        },
      },
      {
        event: {
          ...goodEvent,
          depositUrl:
            "/?wallet=private#event=synthetic-progress-event&view=participant",
        },
      },
      {
        event: { ...goodEvent, depositUrl: "/#event=foreign&view=participant" },
      },
      {
        event: {
          ...goodEvent,
          manageUrl:
            "/#event=synthetic-progress-event&view=organizer&extra=private",
        },
      },
    ]) {
      await update({
        phase: "ready",
        hash,
        chainId: 1,
        transactionConfirmed: true,
        event: goodEvent,
        ...patch,
      });
      assert.deepEqual(await internalLinks(), []);
      await expect(phase).not.toHaveAttribute("data-setup-phase", "ready");
    }
    result.checks.push(
      "Ready accepts only the explicit verified/confirmed tuple and exact same-origin scoped deposit/manage links; malformed or foreign links fail closed",
    );
    await update({
      phase: "verification-failed",
      hash,
      chainId: 1,
      transactionConfirmed: true,
    });
    assert.deepEqual(
      await page.evaluate(() => [window.__copied, window.__checked]),
      [[], []],
    );
    await page.locator('[data-setup-progress-action="copy"]').focus();
    await page.keyboard.press("Enter");
    await page.locator('[data-setup-progress-action="check"]').focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(
      await page.evaluate(() => [window.__copied, window.__checked]),
      [[hash], [{ hash, chainId: 1 }]],
    );
    await page.evaluate(() => {
      window.__oldCheck = document.querySelector(
        '[data-setup-progress-action="check"]',
      );
      window.__current = false;
      window.__component.update({ phase: "submitted" });
      window.__oldCheck.click();
      window.__component.dispose();
      window.__oldCheck.click();
    });
    assert.deepEqual(
      await page.evaluate(() => [window.__copied, window.__checked]),
      [[hash], [{ hash, chainId: 1 }]],
    );
    await page.evaluate(() => {
      window.__current = true;
      window.__mount(false);
    });
    await update({ phase: "submitted", hash, chainId: 1 });
    await expect(
      page.locator('[data-setup-progress-action="copy"]'),
    ).toBeHidden();
    await expect(
      page.locator('[data-setup-progress-action="check"]'),
    ).toBeHidden();
    result.checks.push(
      "Copy/check invoke only their explicit callbacks on keyboard activation; updates, stale scope, absent callbacks and dispose never invoke actions",
    );
    await page.evaluate(() => window.__mount());
    await update({ phase: "confirmations", hash, chainId: 1 });
    const reference = page.locator("[data-setup-progress-hash]");
    await reference.focus();
    await reference.evaluate((node) => {
      window.__referenceNode = node;
      node.setSelectionRange(3, 9);
    });
    await update({
      phase: "portal-verification",
      hash,
      chainId: 1,
      transactionConfirmed: true,
    });
    assert(
      await reference.evaluate(
        (node) => node === window.__referenceNode && node.value.length === 66,
      ),
    );
    await expect(reference).toBeFocused();
    await page.locator("#outside").focus();
    await update({ phase: "confirmations", hash, chainId: 1 });
    await expect(page.locator("#outside")).toBeFocused();
    await capture("desktop-progress");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture("mobile-progress");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const bounds = await page.locator("#fixture button").evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getClientRects().length)
        .map((node) => ({
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        })),
    );
    assert(bounds.every((box) => box.width >= 44 && box.height >= 44));
    assert(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    );
    const moving = await page
      .locator("#fixture,#fixture *")
      .evaluateAll((nodes) =>
        nodes.some((node) =>
          [null, "::before", "::after"].some((pseudo) => {
            const style = getComputedStyle(node, pseudo);
            return (
              style.animationName !== "none" &&
              style.animationDuration
                .split(",")
                .some((value) => parseFloat(value) > 0.001)
            );
          }),
        ),
      );
    assert.equal(moving, false);
    result.checks.push(
      "Full hash DOM/focus survives updates without stealing outside focus; desktop/mobile controls meet44px and reduced-motion disables decorative animation",
    );
    result.effects = await page.evaluate(() => window.__effects);
    assert.deepEqual(result.effects, {
      request: 0,
      provider: 0,
      storage: 0,
      clipboard: 0,
      timer: 0,
      beacon: 0,
    });
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(result.pageErrors, []);
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.failure = { message: error.message, stack: error.stack };
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
        .catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.writeFile(
      path.join(out, "results.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        {
          status: result.status,
          groups: result.checks.length,
          effects: result.effects,
          out,
        },
        null,
        2,
      ),
    );
  }
}
if (process.argv.length === 3 && process.argv[2] === "--run-loopback")
  await run();
else if (process.argv.length === 2)
  console.log(
    "Prepared pure progress-component fixture. --run-loopback requires component source-ready; no public origin is accepted.",
  );
else throw Error("Only --run-loopback is accepted.");
