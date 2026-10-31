// Prepared for ROOT review. NO browser/network unless explicitly run --execute.
// Anonymous pairing only: never approve a wallet, sign, pay, capture QR pixels,
// inspect pairing values, collect frames, or save browser traces/HAR/screenshots.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect, devices } from "@playwright/test";
import { V10_FRONTEND_HEADERS } from "../../scripts/prepare-v10-frontend.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ORIGIN = "https://kleros-luma-v10-ethereum.netlify.app";
const PAGE = ORIGIN + "/first-event/#event=event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5";
const MOBILE = process.argv.includes("--mobile");
// TEST-ONLY proposal. This script never writes production headers or site files.
const HTTPS = ["https://api.web3modal.org", "https://rpc.walletconnect.org", "https://verify.walletconnect.org"];
const WSS = ["wss://relay.walletconnect.org"];
const CSP = V10_FRONTEND_HEADERS.split("Content-Security-Policy: ")[1].trim();
const FILES = ["public/walletconnect.js", "public/wallet-connection.js", "public/wallet-connection.css",
  "public/first-event/wallet.js", "public/vendor/walletconnect/2.26.0/walletconnect.bundle.js"];
const hash = value => createHash("sha256").update(value).digest("hex");
const safeOrigin = value => { try { const url = new URL(value); return ["https:", "wss:"].includes(url.protocol) ? url.origin : url.protocol; } catch { return "invalid"; } };
const mime = file => ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json" }[path.extname(file)] ?? "application/octet-stream");

async function run() {
  const output = path.join(ROOT, MOBILE ? "artifacts/walletconnect/anonymous-mobile" : "artifacts/walletconnect/anonymous-smoke", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(output, { recursive: true });
  const proof = { kind: MOBILE ? "walletconnect-anonymous-mobile-catalog" : "walletconnect-anonymous-open-cancel-retry", status: "running", testOnlyCSP: CSP,
    source: {}, requests: [], sockets: [], blocked: [], passes: [], attempts: [], pageErrorNames: [],
    limits: ["Locally fulfilled candidate at canonical origin; deployed site and production CSP are untouched.",
      "Anonymous real SDK relay/catalog only; no wallet grant, authentication, signature or financial action.",
      "No QR screenshots, pairing values, query strings, message bodies, frames, trace or HAR are saved.",
      "Chromium viewport/user-agent proof does not prove physical phone pairing or app return behavior."] };
  for (const file of FILES) proof.source[file] = hash(await fs.readFile(path.join(ROOT, file)));
  let browser, page, stage = "browser-start";
  try {
    browser = await chromium.launch({ headless: true });
    const { defaultBrowserType: _unused, ...mobileDevice } = devices["Pixel 7"];
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, ...(MOBILE ? mobileDevice : {}), serviceWorkers: "block" });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.addInitScript(() => {
      window.__connectorSmoke = { violations: [], methods: {}, vendorLoads: 0, stages: [], modalStates: [], enableCalls: 0, uriEvents: 0 };
      Object.defineProperty(window, "ethereum", { value: undefined });
      const origin = value => { try { return new URL(value).origin; } catch { return String(value).split(":")[0]; } };
      document.addEventListener("securitypolicyviolation", event => {
        window.__connectorSmoke.violations.push({ directive: event.effectiveDirective, origin: origin(event.blockedURI) });
      });
      // Capture only method NAMES. Never inspect arguments, pairing URI or results.
      document.addEventListener("load", event => {
        if (!(event.target instanceof HTMLScriptElement) || !event.target.hasAttribute("data-walletconnect-vendor")) return;
        window.__connectorSmoke.vendorLoads++;
        const vendor = window.KlerosWalletConnectVendor, factory = vendor?.EthereumProvider;
        if (!factory?.init) return;
        const note = (stage, error) => window.__connectorSmoke.stages.push({ stage,
          ...(error ? { name: ["Error", "TypeError", "AbortError", "ReferenceError"].includes(error.name) ? error.name : "OtherError", code: typeof error.code === "number" ? error.code : null } : {}) });
        const wrap = (object, method, label) => {
          if (typeof object[method] !== "function") return;
          const originalMethod = object[method].bind(object);
          object[method] = async (...args) => {
            note(label + "-enter");
            try { const result = await originalMethod(...args); note(label + "-resolve"); return result; }
            catch (error) { note(label + "-fail", error); throw error; }
          };
        };
        const original = factory.init.bind(factory);
        factory.init = async options => {
          note("sdk-init-enter");
          let sdk;
          try { sdk = await original(options); note("sdk-init-resolve"); }
          catch (error) { note("sdk-init-fail", error); throw error; }
          const request = sdk.request.bind(sdk), enable = sdk.enable.bind(sdk);
          sdk.on("display_uri", () => { window.__connectorSmoke.uriEvents++; }); // Count only; never inspect the value.
          sdk.request = args => { const method = String(args?.method); window.__connectorSmoke.methods[method] = (window.__connectorSmoke.methods[method] ?? 0) + 1; return request(args); };
          sdk.enable = (...args) => { window.__connectorSmoke.enableCalls++; return enable(...args); };
          return sdk;
        };
        // Test-only facade over the same public exports; no vendor source edit.
        window.KlerosWalletConnectVendor = { ...vendor, createAppKit(options) {
          note("appkit-create-enter");
          let modal;
          try { modal = vendor.createAppKit(options); note("appkit-create-resolve"); }
          catch (error) { note("appkit-create-fail", error); throw error; }
          for (const method of ["ready", "open", "close"]) wrap(modal, method, "modal-" + method);
          modal.subscribeState(state => {
            if (window.__connectorSmoke.modalStates.length < 100) window.__connectorSmoke.modalStates.push({ open: state.open === true, loading: state.loading === true });
          });
          return modal;
        } };
      }, true);
    });
    page.on("pageerror", error => proof.pageErrorNames.push(error.name));
    page.on("websocket", socket => proof.sockets.push({ origin: safeOrigin(socket.url()) }));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      const record = { origin: url.origin, method: request.method(), type: request.resourceType() };
      proof.requests.push(record);
      if (url.origin === ORIGIN) {
        if (url.pathname === "/api/first-event/depositors" && request.method() === "GET") {
          record.publicSQLUnavailable = true;
          await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"code":"TEST_SQL_UNAVAILABLE"}}' }); return;
        }
        if (request.method() !== "GET" || url.pathname.startsWith("/api/")) {
          proof.blocked.push({ ...record, reason: "app-api-or-write" }); await route.abort(); return;
        }
        const relative = decodeURIComponent(url.pathname).replace(/^\//, "");
        const file = path.resolve(ROOT, "public", relative.endsWith("/") ? relative + "index.html" : relative);
        if (!file.startsWith(path.join(ROOT, "public") + path.sep)) { await route.abort(); return; }
        try { await route.fulfill({ status: 200, contentType: mime(file), body: await fs.readFile(file), headers: { "content-security-policy": CSP } }); }
        catch { proof.blocked.push({ ...record, reason: "unknown-static-file" }); await route.abort(); }
        return;
      }
      if (!HTTPS.includes(url.origin) || request.method() !== "GET") {
        proof.blocked.push({ ...record, reason: "outside-test-policy" }); await route.abort(); return;
      }
      await route.continue();
    });
    page.on("response", response => {
      const origin = safeOrigin(response.url());
      if (origin !== ORIGIN) proof.requests.push({ origin, status: response.status() });
    });
    stage = "static-mini-page";
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-connect-wallet]")).toBeVisible();
    assert.equal(proof.requests.filter(row => row.origin !== ORIGIN).length, 0);
    assert.equal(await page.locator("script[data-walletconnect-vendor]").count(), 0);
    proof.passes.push("Mini page starts without SDK or external requests");
    for (let number = 1; number <= (MOBILE ? 1 : 2); number++) {
      stage = `chooser-${number}`;
      await page.locator("[data-connect-wallet]").click();
      await expect(page.locator("dialog[data-wallet-connection]")).toBeVisible();
      if (number === 1) assert.equal(await page.locator("script[data-walletconnect-vendor]").count(), 0);
      await page.locator("[data-wallet-more]").click();
      stage = `sdk-modal-${number}`;
      await expect(page.locator("dialog[data-wallet-connection]")).toHaveCount(0);
      const modalClose = page.getByTestId("w3m-header-close").locator("button");
      await expect(modalClose).toBeVisible();
      const attempt = { number, nativeChooserClosed: true, sdkModalVisible: true };
      if (MOBILE) {
        stage = "mobile-catalog";
        await expect(page.locator("w3m-all-wallets-view")).toBeVisible();
        const choices = page.locator("w3m-all-wallets-list-item");
        await expect.poll(() => choices.evaluateAll(items => items.filter(item => {
          const box = item.getBoundingClientRect(); return box.width > 0 && box.height > 0;
        }).length)).toBeGreaterThan(1);
        proof.mobileCatalog = { allWalletsVisible: true, visibleWalletChoices: await choices.count() };
        attempt.mobileCatalogVisible = true;
      } else {
        stage = `qr-${number}`;
        // manualWCControl uses the basic QR view directly. Its initial skeleton
        // does not contain the full modal's wallet-list selector.
        await expect(page.getByTestId("wui-qr-code")).toBeVisible(); // Boolean only; never inspect URI/QR values or pixels.
        attempt.qrVisible = true;
      }
      await page.waitForFunction(expected => window.__connectorSmoke.uriEvents >= expected, number);
      stage = `cancel-${number}`;
      await modalClose.click();
      await expect(modalClose).not.toBeVisible();
      await expect(page.locator("[data-connect-wallet]")).toBeEnabled();
      await expect(page.locator("[data-connect-wallet]")).toBeVisible();
      await expect(page.locator("[data-deposit]")).not.toBeVisible();
      attempt.cancelledWithoutConnection = true; proof.attempts.push(attempt);
      proof.passes.push(`Anonymous ${MOBILE ? "mobile catalog" : "QR"} open/cancel ${number} returns to unconnected mini page`);
    }
    const observed = await page.evaluate(() => window.__connectorSmoke);
    proof.observed = observed;
    assert.equal(observed.vendorLoads, 1);
    assert.equal(observed.enableCalls, MOBILE ? 1 : 2); assert.equal(observed.uriEvents, MOBILE ? 1 : 2);
    for (const method of Object.keys(observed.methods)) assert.equal(/sign|send|wallet_switch|wallet_add/i.test(method), false);
    assert(proof.sockets.every(row => WSS.includes(row.origin)));
    assert.equal(proof.blocked.filter(row => row.reason === "app-api-or-write").length, 0);
    assert.equal(proof.pageErrorNames.length, 0);
    // AppKit's INITIALIZE is mandatory even with analytics:false. Do not permit
    // that telemetry host: report its CSP block while rejecting every other one.
    assert(observed.violations.every(row => row.directive === "connect-src" && row.origin === "https://pulse.walletconnect.org"));
    proof.blockedMandatoryTelemetry = observed.violations.length;
    for (const file of FILES) assert.equal(hash(await fs.readFile(path.join(ROOT, file))), proof.source[file]);
    proof.passes.push("One lazy vendor load, no sign/send/auth calls, unchanged source; mandatory telemetry remains blocked");
    proof.status = "pass";
  } catch (error) {
    proof.status = "fail"; proof.failure = { stage, name: error.name, code: typeof error.code === "number" ? error.code : null };
    // Deliberately omit exception message/stack, which a third-party SDK could fill with pairing data.
    process.exitCode = 1;
  } finally {
    if (page && !page.isClosed()) {
      proof.observed = await page.evaluate(() => window.__connectorSmoke).catch(() => null);
      proof.dom = { modalHost: await page.locator("w3m-modal").count() > 0,
        modalCard: await page.getByTestId("w3m-modal-card").count() > 0,
        closeControl: await page.getByTestId("w3m-header-close").count() > 0,
        closeButtonVisible: await page.getByTestId("w3m-header-close").locator("button").isVisible().catch(() => false),
        qrVisible: await page.getByTestId("wui-qr-code").isVisible().catch(() => false) };
    }
    await browser?.close();
    await fs.writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
    console.log(JSON.stringify({ status: proof.status, proof: path.join(output, "proof.json"), passes: proof.passes.length }));
  }
}

if (process.argv.includes("--execute")) await run();
else console.log(JSON.stringify({ status: "prepared-not-executed", requires: "ROOT review and explicit anonymous network authorization before --execute", testOnlyCSP: CSP, allowedHTTPS: HTTPS, allowedWSS: WSS }));
