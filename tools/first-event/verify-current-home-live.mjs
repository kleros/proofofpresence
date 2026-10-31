// Anonymous public GETs only. Default is inert; no wallet or transaction access.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { compareAsset } from "../../test/v10-hosting-readonly.e2e.mjs";
import { EVENT, LEGACY_EVENT } from "../../public/first-event/event.js";
const ROOT = fileURLToPath(new URL("../../", import.meta.url)), ORIGIN = "https://kleros-kickback.netlify.app";
async function run() {
  assert(/^[0-9a-f]{40}$/.test(process.env.EXPECTED_RELEASE ?? ""));
  const sourceCommit = process.env.EXPECTED_RELEASE;
  const git = args => execFileSync("git", args, { cwd: ROOT, maxBuffer: 20000000 });
  const files = new Map(git(["ls-tree", "-r", "--name-only", sourceCommit, "--", "public"]).toString().trim().split("\n").map(file => ["/" + file.slice(7), file]));
  const out = path.join(ROOT, "artifacts/truth-pays-ist", "home-live-" + new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(out, { recursive: true });
  const proof = { status: "running", sourceCommit, requests: [], assets: {}, errors: [], blocked: [], checks: [] };
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__walletTouches = 0; Object.defineProperty(window, "ethereum", { get() { window.__walletTouches++; throw Error("Wallet forbidden in anonymous check"); } }); });
    const page = await context.newPage();
    page.on("pageerror", error => proof.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      proof.requests.push({ path: url.pathname + url.search, method: request.method() });
      const api = url.pathname.startsWith("/api/");
      const allowedAPI = ["/api/public-catalog", "/api/kickback-setup"].includes(url.pathname) && !url.search ||
        url.pathname === "/api/first-event/depositors" && ["", "?eventId=" + LEGACY_EVENT.id].includes(url.search);
      if (url.origin !== ORIGIN || request.method() !== "GET" || request.postData() || api && !allowedAPI || !api && url.pathname !== "/" && !files.has(url.pathname)) {
        proof.blocked.push({ path: url.pathname, method: request.method() }); await route.abort(); return;
      }
      try {
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30000 });
        assert.equal(response.status(), 200, url.pathname);
        const bytes = await response.body();
        if (api && url.pathname === "/api/public-catalog") {
          const value = JSON.parse(bytes); const row = value.events.find(event => event.id === EVENT.id);
          assert.equal(row.contract, EVENT.contract); assert.deepEqual(row.adoption, EVENT.adoption);
          proof.catalogInstanceId = value.instanceId;
        } else if (!api) {
          const file = url.pathname === "/" ? "public/index.html" : files.get(url.pathname);
          const comparison = compareAsset(file.slice(7), bytes, git(["show", `${sourceCommit}:${file}`]), ORIGIN);
          assert(comparison.matches, file); proof.assets[file] = comparison;
        }
        await route.fulfill({ response, body: bytes });
      } catch (error) { proof.errors.push(error.message); await route.abort().catch(() => {}); }
    });
    await page.goto(ORIGIN + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await expect(page.locator("[data-public-event-row]")).toHaveCount(1, { timeout: 45000 });
    await expect(page.locator("[data-public-event-status]")).toHaveText("1 public event.");
    assert.equal(await page.locator("[data-public-event-open]").getAttribute("href"), "#event=" + EVENT.id + "&view=participant");
    assert.equal(await page.locator(`[data-public-event-results] a[href*="${LEGACY_EVENT.id}"]`).count(), 0);
    await page.locator("[data-public-event-search]").fill("Truth Pays");
    await expect(page.locator("[data-public-event-row]")).toHaveCount(1);
    proof.checks.push("One current replacement appears in discovery/counts/search; original is absent from new-deposit choices");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__walletTouches), 0);
    assert.equal(await page.locator("script[data-walletconnect-vendor]").count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(proof.errors, []); assert.deepEqual(proof.blocked, []);
    await page.screenshot({ path: path.join(out, "home-mobile.png"), fullPage: true });
    proof.checks.push("Mobile homepage fits; anonymous load performs no wallet or SDK initialization");
    proof.status = "passed";
  } catch (error) { proof.status = "failed"; proof.failure = error.message; process.exitCode = 1; }
  finally { await browser?.close(); await fs.writeFile(path.join(out, "proof.json"), JSON.stringify(proof, null, 2) + "\n"); console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(out, "proof.json"), failure: proof.failure })); }
}
if (process.argv.length === 2) console.log("Prepared anonymous current-event home check; default performs no network or browser actions.");
else { assert.deepEqual(process.argv.slice(2), ["--execute"]); await run(); }
