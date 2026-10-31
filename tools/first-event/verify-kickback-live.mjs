// Anonymous readback only. --execute is required; no wallet/auth/job/transaction calls.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { compareAsset } from "../../test/v10-hosting-readonly.e2e.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ORIGIN = "https://kleros-kickback.netlify.app";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function run() {
  assert([undefined, "truth-pays-ist"].includes(process.env.VERIFY_SETUP_VARIANT));
  const replacement = process.env.VERIFY_SETUP_VARIANT === "truth-pays-ist";
  const git = args => execFileSync("git", args, { cwd: ROOT, maxBuffer: 20000000 });
  const sourceCommit = git(["rev-parse", "--verify", `${process.env.EXPECTED_RELEASE ?? "HEAD"}^{commit}`]).toString().trim();
  const source = new Map(git(["ls-tree", "-r", "--name-only", sourceCommit, "--", "public"]).toString().trim().split("\n").map(file => ["/" + file.slice(7), file]));
  const out = path.join(ROOT, "artifacts/kickback-fast/live", new Date().toISOString().replace(/[:.]/g, "-") + (replacement ? "-truth-pays-ist" : ""));
  await fs.mkdir(out, { recursive: true });
  const proof = { kind: "anonymous-kickback-live", status: "running", sourceCommit, variant: replacement ? "truth-pays-ist" : "standard", checks: [], requests: [], assets: {}, errors: [], blocked: [],
    limits: ["Anonymous production setup and source-byte comparison only. No wallet authentication or financial behavior is exercised.", "Browser timings include source comparison overhead. Server background indexer RPC is not measured."] };
  let browser, page, failure = null, routeFailure = null, closing = false;
  const routes = new Set();
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    context.setDefaultTimeout(45000);
    await context.addInitScript(() => { window.__anonymousWalletAccesses = 0; Object.defineProperty(window, "ethereum", { get() { window.__anonymousWalletAccesses++; throw Error("Wallet access forbidden in anonymous readback"); } }); });
    page = await context.newPage(); let displayCalls = 0;
    page.on("pageerror", error => proof.errors.push(error.message));
    await page.route("**/*", route => {
      const task = (async () => {
      const req = route.request(), url = new URL(req.url()), api = url.pathname.startsWith("/api/");
      proof.requests.push({ method: req.method(), path: url.pathname + url.search });
      if (url.origin !== ORIGIN || req.method() !== "GET" || (api && (url.pathname !== "/api/kickback-setup" || url.search))) {
        proof.blocked.push({ path: url.pathname, method: req.method() }); return route.abort();
      }
      // No redirects or automatic request retries can cross this read-only gate.
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30000 }); assert.equal(response.status(), 200, url.pathname);
      const bytes = await response.body();
      if (api) {
        displayCalls++;
        const data = JSON.parse(bytes);
        assert.equal(data.kind, "kickback-setup-display"); assert.equal(data.displayOnly, true);
        assert.equal(data.mode, "hosted-production"); assert.equal(data.chain.chainId, 1);
        assert.equal(data.contractVersion, "kleros-event-v10-uups"); assert.equal(data.session, null);
        assert.equal(data.factory.verified, false); assert.deepEqual(data.events, []);
        for (const field of ["transactionsReady", "createEvents", "manageEvents"]) assert.equal(data.capabilities[field], false);
        proof.display = { instanceId: data.instanceId, factory: data.factory.address, transactionCapabilities: false };
      } else {
        const filename = url.pathname === "/" ? "public/index.html" : source.get(url.pathname);
        assert(filename, `Untracked public asset ${url.pathname}`);
        const expected = git(["show", `${sourceCommit}:${filename}`]);
        const comparison = compareAsset(filename.slice(7), bytes, expected, ORIGIN);
        assert(comparison.matches, `Published bytes differ: ${filename}`); proof.assets[filename] = comparison;
      }
      await route.fulfill({ response, body: bytes });
      })().catch(async error => {
        if (!closing) {
          routeFailure ??= error;
          proof.errors.push(`Asset/readback ${new URL(route.request().url()).pathname}: ${error.message}`);
        }
        // An async routing rejection otherwise escapes the runner and can hide
        // its original assertion/timeout before the evidence file is written.
        try { await route.abort(); } catch { /* The context may already be closed. */ }
      });
      routes.add(task);
      void task.finally(() => routes.delete(task));
      return task;
    });
    proof.stage = "opening-setup";
    const opened = Date.now(); await page.goto(ORIGIN + "/#setup=kickback" + (replacement ? "&replacement=truth-pays-ist" : ""), { waitUntil: "domcontentloaded", timeout: 45000 });
    await expect(page.locator("#luma-setup h1")).toHaveText("Set up kickback.", { timeout: 45000 });
    await expect(page.locator("#luma-setup [data-connect-wallet]")).toBeVisible({ timeout: 45000 });
    if (replacement) {
      await expect(page.locator("[data-luma-replacement-preset]")).toContainText("Creating this replacement event makes a new contract and deposit link.", { timeout: 45000 });
      assert.equal(new URL(await page.locator("[data-luma-replacement-preset] a").getAttribute("href"), ORIGIN).href,
        ORIGIN + "/#event=event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5&view=participant&deposit=manage");
      proof.checks.push("Replacement notice and original recovery link render before any wallet action on the exact reviewed IST route");
    }
    proof.observedRenderMs = Date.now() - opened;
    proof.stage = "waiting-for-assets";
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await Promise.allSettled([...routes]);
    if (routeFailure) throw routeFailure;
    proof.walletGetterAccesses = await page.evaluate(() => window.__anonymousWalletAccesses);
    assert.equal(proof.walletGetterAccesses, 0);
    assert.equal(displayCalls, 1); assert.equal(proof.blocked.length, 0); assert.equal(proof.errors.length, 0);
    proof.checks.push("Actual published setup renders with exact source assets and one display-only SQL GET", "No bootstrap/job/auth/wallet/transaction requests");
    await page.screenshot({ path: path.join(out, "desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#luma-setup [data-connect-wallet]")).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(out, "mobile.png"), fullPage: true });
    assert.equal(displayCalls, 1); assert.equal(proof.blocked.length, 0); assert.equal(proof.errors.length, 0);
    proof.checks.push("Mobile setup fits the viewport without another API read"); proof.stage = "complete"; proof.status = "passed";
  } catch (error) {
    failure = routeFailure ?? error; proof.status = "failed"; proof.failure = failure.message;
    if (page && !page.isClosed()) {
      proof.visibleText = await page.locator("body").textContent({ timeout: 1500 }).catch(() => null);
      await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true, timeout: 5000 }).catch(() => {});
    }
  }
  finally {
    // Let bounded in-flight comparison requests settle before browser teardown.
    await Promise.allSettled([...routes]);
    closing = true;
    try { await browser?.close(); } catch (error) { proof.closeError = error.message; }
    await fs.writeFile(path.join(out, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
    console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, sourceCommit, proof: path.join(out, "proof.json") })); }
  if (failure) throw failure;
}
if (process.argv.includes("--execute")) await run();
else console.log("Read-only verification prepared. Use --execute after an explicitly approved release; default performs no browser/network access.");
