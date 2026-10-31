// Browser mocks only: no wallet apps, extensions, API, signatures or transactions.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const origin = "https://wallet-connection.example.test";
const pageURL = origin + "/first-event/?ref=a%26b#event=synthetic&view=organizer&transaction=original";
const output = "/tmp/kleros-wallet-connection-proof";
const errors = [], forbidden = [], checks = [];
const browser = await chromium.launch({ headless: true });
async function create(mode, profile = "default") {
  const page = await browser.newPage({ viewport: { width: 375, height: 850 }, ...(profile !== "default" ? { userAgent: devices["iPhone 13"].userAgent } : {}) });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || route.request().method() !== "GET" || url.pathname.startsWith("/api/")) { forbidden.push(url.href); return route.abort(); }
    if (url.pathname === "/first-event/") return route.fulfill({ contentType: "text/html", body: "<!doctype html><link rel=icon href='data:,'><button id=connect>Connect wallet</button>" });
    if (!["/wallet-connection.js", "/wallet-connection.css"].includes(url.pathname)) { forbidden.push(url.href); return route.abort(); }
    return route.fulfill({ contentType: url.pathname.endsWith(".css") ? "text/css" : "application/javascript", body: await fs.readFile(path.join(root, url.pathname.slice(1))) });
  });
  await page.addInitScript(({ mode, telegram }) => {
    if (telegram) window.TelegramWebviewProxy = {};
    window.__calls = []; window.__reads = 0; window.__copied = []; window.__alive = true;
    const make = id => ({ id, isMetaMask: id === "A", request: async payload => { window.__calls.push({ id, method: payload.method }); if (payload.method !== "eth_requestAccounts") throw Error("Unexpected wallet method"); return ["0x" + "a".repeat(40)]; } });
    const a = make("A"), b = make("B");
    let legacy = ["legacy", "cached-and-legacy"].includes(mode) ? a : mode === "legacy-multiple" ? { providers: [a, b] } : null;
    Object.defineProperty(window, "ethereum", { get() { window.__reads++; return legacy; } });
    window.__announce = (provider, name) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: provider.id, name, icon: "https://untrusted.invalid/icon.svg", rdns: "invalid.wallet" }, provider } }));
    if (mode === "eip-multiple") window.addEventListener("eip6963:requestProvider", () => { window.__announce(a, "Wallet A"); window.__announce(b, "Wallet B"); });
    if (mode === "cached-and-legacy") window.addEventListener("eip6963:requestProvider", () => window.__announce(b, "Other extension"));
    if (mode === "legacy-late") window.addEventListener("eip6963:requestProvider", () => setTimeout(() => {
      legacy = a; window.dispatchEvent(new Event("ethereum#initialized"));
    }, 70));
    if (mode === "eip-delayed") window.addEventListener("eip6963:requestProvider", () => setTimeout(() => window.__announce(b, "Delayed browser wallet"), 70));
    window.__injectLegacy = () => { legacy = a; window.dispatchEvent(new Event("ethereum#initialized")); };
    window.__lateWallet = () => window.__announce(b, "Late wallet");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => window.__copied.push(value) } });
  }, { mode, telegram: profile === "telegram" });
  await page.goto(pageURL);
  await page.evaluate(async () => {
    const { chooseWalletProvider } = await import("/wallet-connection.js");
    window.__controller = new AbortController(); window.__done = false;
    window.__start = async () => {
      window.__done = false; window.__error = null; window.__handoff = false; window.__provider = null;
      try {
        const provider = await chooseWalletProvider({ ownerDocument: document, signal: window.__controller.signal, isCurrent: () => window.__alive });
        if (provider) { window.__provider = provider.id; await provider.request({ method: "eth_requestAccounts" }); }
        else window.__handoff = true;
      } catch (error) { window.__error = { code: error.code ?? null, name: error.name }; }
      finally { window.__done = true; }
    };
    document.querySelector("#connect").addEventListener("click", () => { void window.__start(); });
  });
  assert.equal(await page.evaluate(() => window.__reads), 0, "import does not query a provider");
  return page;
}
try {
  let page = await create("legacy");
  await page.locator("#connect").click(); await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
  assert.deepEqual(await page.evaluate(() => window.__calls), [{ id: "A", method: "eth_requestAccounts" }]);
  await expect(page.locator("[data-wallet-connection]")).toHaveCount(0); await page.close();
  checks.push("single legacy provider remains account-only without chooser");

  for (const mode of ["legacy-late", "eip-delayed", "cached-and-legacy"]) {
    page = await create(mode); await page.locator("#connect").click();
    await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
    assert.equal(await page.evaluate(() => window.__provider), mode === "eip-delayed" ? "B" : "A");
    assert.deepEqual(await page.evaluate(() => window.__calls), [{ id: mode === "eip-delayed" ? "B" : "A", method: "eth_requestAccounts" }]);
    assert.equal(page.url(), pageURL); await expect(page.locator("[data-wallet-connection]")).toHaveCount(0); await page.close();
    checks.push(mode + " uses the current injected wallet without an app handoff or route change");
  }

  page = await create("none"); await page.locator("#connect").click(); await expect(page.locator("[data-wallet-connection]")).toBeVisible();
  await page.evaluate(() => window.__injectLegacy()); await expect(page.locator("[data-wallet-provider]")).toHaveCount(1);
  assert.deepEqual(await page.evaluate(() => window.__calls), []);
  await page.locator("[data-wallet-provider]").click(); await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
  assert.equal(await page.evaluate(() => window.__provider), "A"); assert.equal(page.url(), pageURL); await page.close();
  checks.push("late ethereum initialized event adds the in-browser wallet without an unsolicited account request");

  page = await create("legacy-late"); await page.locator("#connect").click(); await page.evaluate(() => window.__controller.abort());
  await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
  await page.waitForTimeout(100); assert.deepEqual(await page.evaluate(() => window.__calls), []);
  assert.equal((await page.evaluate(() => window.__error)).name, "AbortError"); await page.close();
  checks.push("cancelling delayed discovery cannot open accounts after injection arrives");

  for (const profile of ["safari", "telegram"]) {
    page = await create("legacy-late", profile); await page.locator("#connect").click();
    await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
    assert.equal(await page.evaluate(() => window.__provider), "A"); assert.equal(page.url(), pageURL);
    assert.deepEqual(await page.evaluate(() => window.__calls), [{ id: "A", method: "eth_requestAccounts" }]); await page.close();
    page = await create("none", profile); await page.locator("#connect").click();
    await expect(page.locator("[data-wallet-connection]")).toBeVisible();
    assert.equal(await page.locator('[data-wallet-app="metamask"]').getAttribute("href"), "https://link.metamask.io/dapp/" + pageURL.slice(8));
    assert.equal(new URL(await page.locator('[data-wallet-app="trust"]').getAttribute("href")).searchParams.get("url"), pageURL);
    await page.locator("[data-wallet-connection-cancel]").click(); await page.close();
    checks.push(profile + " iPhone UA retains path/query/hash and prefers delayed browser injection without an external handoff");
  }

  for (const mode of ["eip-multiple", "legacy-multiple"]) {
    page = await create(mode); await page.locator("#connect").click();
    await expect(page.locator("[data-wallet-provider]")).toHaveCount(2);
    assert.deepEqual(await page.evaluate(() => window.__calls), []);
    await page.locator("[data-wallet-provider]").nth(1).click();
    await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
    assert.equal(await page.evaluate(() => window.__provider), "B");
    assert.deepEqual(await page.evaluate(() => window.__calls), [{ id: "B", method: "eth_requestAccounts" }]);
    await page.close(); checks.push(mode + " selects only the chosen provider");
  }
  page = await create("none"); await page.locator("#connect").click();
  await expect(page.getByRole("heading", { name: "Open in your wallet app", exact: true })).toBeVisible();
  assert.equal(await page.locator('[data-wallet-app="metamask"]').getAttribute("href"), "https://link.metamask.io/dapp/" + pageURL.slice(8));
  assert.equal(new URL(await page.locator('[data-wallet-app="trust"]').getAttribute("href")).searchParams.get("url"), pageURL);
  assert.equal(new URL(await page.locator('[data-wallet-app="trust"]').getAttribute("href")).searchParams.get("coin_id"), "60");
  await page.locator("[data-wallet-copy-page]").click(); assert.deepEqual(await page.evaluate(() => window.__copied), [pageURL]);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await fs.mkdir(output, { recursive: true }); await page.screenshot({ path: path.join(output, "mobile-chooser.png"), fullPage: true });
  // Suppress native app launch; exercise the helper's exact-link/caller callback only.
  await page.evaluate(() => document.querySelector('[data-wallet-app="metamask"]').addEventListener("click", event => { window.__openedLink = event.currentTarget.href; event.preventDefault(); }));
  await page.locator('[data-wallet-app="metamask"]').click();
  await expect.poll(() => page.evaluate(() => window.__handoff)).toBe(true);
  assert.equal(await page.evaluate(() => window.__openedLink), "https://link.metamask.io/dapp/" + pageURL.slice(8));
  assert.deepEqual(await page.evaluate(() => window.__calls), []); await page.close();
  checks.push("mobile link/copy preserve exact current URL and hash; mocked handoff requests no account");

  page = await create("none"); await page.locator("#connect").click(); await expect(page.locator("[data-wallet-connection]")).toBeVisible();
  await page.evaluate(() => window.__lateWallet()); await expect(page.locator("[data-wallet-provider]")).toHaveCount(1);
  await expect(page.locator("[data-wallet-connection] img")).toHaveCount(0);
  await page.locator("[data-wallet-provider]").click(); await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
  assert.equal(await page.evaluate(() => window.__provider), "B"); await page.close();
  checks.push("late EIP-6963 announcement works without loading untrusted icons");

  page = await create("none"); await page.locator("#connect").click();
  await page.locator("[data-wallet-connection-cancel]").click(); await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
  await page.evaluate(() => window.__lateWallet());
  assert.deepEqual(await page.evaluate(() => window.__calls), []);
  await page.locator("#connect").click(); await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
  assert.equal(await page.evaluate(() => window.__provider), "B");
  assert.deepEqual(await page.evaluate(() => window.__calls), [{ id: "B", method: "eth_requestAccounts" }]); await page.close();
  checks.push("persistent discovery after cancel stays passive until next explicit Connect");

  for (const mode of ["cancel", "escape", "abort", "dispose", "navigation"]) {
    page = await create("none"); await page.locator("#connect").click(); await expect(page.locator("[data-wallet-connection]")).toBeVisible();
    if (mode === "cancel") await page.locator("[data-wallet-connection-cancel]").click();
    else if (mode === "escape") await page.keyboard.press("Escape");
    else if (mode === "abort") await page.evaluate(() => window.__controller.abort());
    else if (mode === "dispose") await page.evaluate(() => { window.__alive = false; });
    else await page.evaluate(() => { location.hash = "different-route"; });
    await expect.poll(() => page.evaluate(() => window.__done)).toBe(true);
    await expect(page.locator("[data-wallet-connection]")).toHaveCount(0);
    const error = await page.evaluate(() => window.__error);
    if (["cancel", "escape"].includes(mode)) assert.equal(error.code, 4001); else assert.equal(error.name, "AbortError");
    if (mode === "dispose") await page.evaluate(() => window.__lateWallet());
    assert.deepEqual(await page.evaluate(() => window.__calls), []); await page.close(); checks.push(mode + " removes chooser without requesting accounts");
  }
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
  const sources = Object.fromEntries(await Promise.all(["wallet-connection.js", "wallet-connection.css"].map(async file => [file, createHash("sha256").update(await fs.readFile(path.join(root, file))).digest("hex")])));
  const proof = { status: "passed", checks: checks.length, checksPassed: checks, sources, noAPI: true, noRealWallet: true,
    limitation: "Synthetic EIP-1193/EIP-6963 providers; app-link default navigation is prevented and its exact URL/callback is checked. This does not establish installed-app behavior on a physical phone.",
    officialDocs: ["https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks/", "https://developer.trustwallet.com/developer/develop-for-trust/deeplinking"] };
  await fs.writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n"); console.log(JSON.stringify({ ...proof, output }));
} finally { await browser.close(); }
