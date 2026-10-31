// ROOT-only, anonymous production display readback. Default invocation does no
// I/O beyond this message; --execute performs one public DB GET per view.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { chromium, expect } from "@playwright/test";
import { compareAsset } from "../../test/v10-hosting-readonly.e2e.mjs";
import { EVENT as CURRENT_EVENT, LEGACY_EVENT } from "../../public/first-event/event.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ORIGIN = "https://kleros-kickback.netlify.app";
const EVENT = CURRENT_EVENT.id;
const CONTRACT = CURRENT_EVENT.contract;
const API = "/api/first-event/depositors";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const same = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

function validateProjection(data, event = CURRENT_EVENT) {
  assert.equal(data?.schemaVersion, 1); assert.equal(data.kind, "first-event-depositors");
  assert.equal(data.displayOnly, true); assert.equal(data.mode, "hosted-production");
  assert.equal(data.eventId, event.id); assert.equal(data.chainId, 1); assert(same(data.contract, event.contract));
  assert(/^[A-Za-z0-9_-]{1,160}$/.test(data.instanceId ?? ""));
  assert(["current", "stale"].includes(data.status));
  assert(Number.isFinite(Date.parse(data.checkedAt)) && Date.parse(data.checkedAt) <= Date.now() + 5000);
  assert(Number.isSafeInteger(data.blockNumber) && data.blockNumber > 0);
  assert(/^0x[0-9a-f]{64}$/i.test(data.blockHash ?? ""));
  for (const key of ["permissions", "capabilities", "session", "deploymentTrust", "actionable", "participants", "owner"])
    assert.equal(Object.hasOwn(data, key), false);
  assert(Array.isArray(data.depositors) && data.depositors.length <= 1000);
  const wallets = new Set(), receipts = new Set();
  for (const row of data.depositors) {
    assert(/^0x[0-9a-f]{40}$/i.test(row.wallet ?? "") && !wallets.has(row.wallet.toLowerCase())); wallets.add(row.wallet.toLowerCase());
    assert(/^(0|[1-9][0-9]{0,77})$/.test(row.totalReceivedWei ?? ""));
    assert(Array.isArray(row.deposits) && row.deposits.length > 0);
    assert.equal(Object.hasOwn(row, "name"), false); assert.equal(Object.hasOwn(row, "email"), false);
    let total = 0n;
    for (const lot of row.deposits) {
      assert(/^0x[0-9a-f]{64}$/i.test(lot.txHash ?? "") && /^0x[0-9a-f]{64}$/i.test(lot.blockHash ?? ""));
      assert(Number.isSafeInteger(lot.logIndex) && lot.logIndex >= 0);
      assert(Number.isSafeInteger(lot.blockNumber) && lot.blockNumber <= data.blockNumber);
      assert(/^(0|[1-9][0-9]{0,77})$/.test(lot.amountWei ?? ""));
      const key = `${lot.txHash}:${lot.logIndex}`.toLowerCase(); assert(!receipts.has(key)); receipts.add(key);
      total += BigInt(lot.amountWei);
    }
    assert.equal(total.toString(), row.totalReceivedWei);
  }
}

async function run() {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, maxBuffer: 20000000, stdio: ["ignore", "pipe", "ignore"] });
  const sourceCommit = git("rev-parse", "--verify", `${process.env.EXPECTED_RELEASE ?? "HEAD"}^{commit}`).toString().trim();
  assert(/^[0-9a-f]{40}$/.test(sourceCommit));
  const source = new Map(git("ls-tree", "-r", "--name-only", sourceCommit, "--", "public").toString().trim().split("\n")
    .filter(Boolean).map(file => ["/" + file.slice("public/".length), file]));
  const expected = name => git("show", `${sourceCommit}:public/${name}`);
  const OUT = path.join(ROOT, "artifacts/event-database/live", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(OUT, { recursive: true });
  const proof = { kind: "first-event-database-live-readonly", status: "running", startedAt: new Date().toISOString(), sourceCommit,
    origin: ORIGIN, eventId: EVENT, checks: [], assets: {}, requests: [], blocked: [], errors: [], screenshots: [],
    directChainRPCRequests: 0, walletRequests: 0, authRequests: 0, financialTransactionRequests: 0,
    limits: ["Actual published browser responses; the sole public depositor request is withheld until static content renders.",
      "Asset interception/comparison adds harness overhead to browser timing; no uninstrumented speed claim.",
      "Only browser-visible requests are counted; unrelated server background-indexer RPC is not measured."] };
  const pass = label => proof.checks.push(label);
  const releaseAPI = deferred(), finishedAPI = deferred(), participantAPI = deferred(), legacyAPI = deferred();
  const legacyQuery = "?eventId=" + LEGACY_EVENT.id;
  let browser, page, apiCount = 0, released = false;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", timezoneId: "Asia/Bangkok", serviceWorkers: "block" });
    page = await context.newPage();
    page.on("pageerror", error => proof.errors.push(error.message));
    await page.addInitScript(() => {
      window.__databaseDisplayTiming = { headingMs: null, termsMs: null, walletTouches: 0 };
      Object.defineProperty(window, "ethereum", { get() { window.__databaseDisplayTiming.walletTouches++; throw Error("Wallet access is forbidden during display readback"); } });
      const observe = () => {
        const timing = window.__databaseDisplayTiming, root = document.querySelector("[data-first-event-display]");
        if (!root) return;
        if (timing.headingMs === null && root.querySelector("h1")?.textContent === "Manage Event") timing.headingMs = performance.now();
        if (timing.termsMs === null && root.textContent.includes("0.01 ETH") && root.textContent.includes("ETHEREUM MAINNET")) timing.termsMs = performance.now();
      };
      new MutationObserver(observe).observe(document, { childList: true, subtree: true });
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      proof.requests.push({ path: url.pathname + url.search, method: request.method() });
      const legacyRequest = url.pathname === API && url.search === legacyQuery;
      const allowedAPI = url.pathname === API && (url.search === "" || legacyRequest) && request.method() === "GET";
      if (url.origin !== ORIGIN || request.method() !== "GET" || request.postData() ||
          url.pathname === "/app.js" || (url.pathname.startsWith("/api/") && !allowedAPI) ||
          (!allowedAPI && !["/", "/first-event/"].includes(url.pathname) && !source.has(url.pathname))) {
        proof.blocked.push({ origin: url.origin, path: url.pathname, method: request.method() });
        await route.abort(); return;
      }
      if (allowedAPI) {
        apiCount++;
        const participant = apiCount === 2 && page.url() === ORIGIN + "/first-event/";
        if (apiCount > 3 || (apiCount === 2 && !participant) || (apiCount === 3 && !legacyRequest) || (legacyRequest && apiCount !== 3)) {
          proof.blocked.push({ path: API, reason: "unexpected-public-request" }); await route.abort(); return;
        }
        const finished = legacyRequest ? legacyAPI : participant ? participantAPI : finishedAPI;
        await releaseAPI.promise;
        if (!released) { await route.abort(); return; }
        const started = performance.now();
        try {
          const response = await route.fetch({ timeout: 25000, maxRedirects: 0 });
          const bytes = await response.body();
          const data = JSON.parse(bytes.toString("utf8"));
          const observed = { status: response.status(), elapsedMs: Math.round(performance.now() - started), responseBytes: bytes.length,
            eventId: data.eventId, chainId: data.chainId, contract: data.contract, displayOnly: data.displayOnly,
            checkedAt: data.checkedAt, blockNumber: data.blockNumber, statusLabel: data.status, depositorWallets: data.depositors?.length,
            eventState: data.eventState ? { phase: data.eventState.phase, registeredWallets: data.eventState.stakers?.length,
              endsAt: data.eventState.endsAt, challengeEndsAt: data.eventState.challengeEndsAt } : null };
          if (legacyRequest) proof.legacyAPI = observed; else if (participant) proof.participantAPI = observed; else proof.api = observed;
          await route.fulfill({ response });
          finished.release({ data, status: response.status() });
        } catch (error) { proof.errors.push(error.message); finished.release({ error: error.message }); await route.abort().catch(() => {}); }
        return;
      }
      try {
        const response = await route.fetch({ timeout: 25000, maxRedirects: 0 });
        assert.equal(response.status(), 200, `Static asset ${url.pathname}`);
        if (["/", "/first-event/"].includes(url.pathname) || source.has(url.pathname)) {
          const name = url.pathname === "/" ? "index.html" : url.pathname === "/first-event/" ? "first-event/index.html" : url.pathname.slice(1);
          const comparison = compareAsset(name === "first-event/index.html" ? "index.html" : name, await response.body(), expected(name), ORIGIN);
          proof.assets[name] = { status: response.status(), ...comparison };
          assert.equal(comparison.matches, true, `Published ${name} differs from expected release`);
        }
        await route.fulfill({ response });
      } catch (error) { proof.errors.push(error.message); await route.abort().catch(() => {}); }
    });
    await page.goto(`${ORIGIN}/#event=${EVENT}&view=organizer`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await expect(page.getByRole("heading", { name: "Manage Event", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-first-event-display]")).toContainText("0.01 ETH");
    await expect(page.locator("[data-first-event-display]")).toContainText(CONTRACT);
    await expect(page.locator("#loading")).toBeHidden();
    await expect.poll(() => apiCount, { timeout: 15000 }).toBe(1);
    assert.equal(apiCount, 1); assert.equal(released, false);
    assert.equal(proof.requests.some(row => row.path === "/app.js" || row.path.startsWith("/api/bootstrap") || row.path.startsWith("/api/event-read-jobs") || row.path.startsWith("/api/session")), false);
    proof.renderBeforeAPI = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { ...window.__databaseDisplayTiming, firstContentfulPaintMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        domContentLoadedMs: performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? null };
    });
    assert(Number.isFinite(proof.renderBeforeAPI.headingMs) && Number.isFinite(proof.renderBeforeAPI.termsMs));
    assert.equal(proof.renderBeforeAPI.walletTouches, 0);
    proof.renderBeforeAPI.apiHeld = true; proof.renderBeforeAPI.apiRequestCountAtRender = apiCount;
    await page.screenshot({ path: path.join(OUT, "desktop-before-api.png"), fullPage: true }); proof.screenshots.push("desktop-before-api.png");
    pass("Manage Event heading and static terms rendered while actual depositor GET remained withheld");
    released = true; releaseAPI.release();
    const result = await finishedAPI.promise;
    assert.equal(result.error, undefined); assert.equal(result.status, 200); validateProjection(result.data);
    await expect(page.locator("[data-display-status]")).toContainText(`block ${result.data.blockNumber.toLocaleString("en-US")}`);
    await expect(page.locator("[data-display-rows] tbody tr")).toHaveCount(result.data.depositors.length);
    if (!result.data.depositors.length) await expect(page.locator("[data-display-rows]")).toContainText("No confirmed deposits at this snapshot");
    proof.renderedSnapshot = { checkedAt: result.data.checkedAt, status: await page.locator("[data-display-status]").innerText(),
      rowCount: await page.locator("[data-display-rows] tbody tr").count() };
    pass("One actual database projection matched exact event, chain, child and displayed depositor rows");
    await page.setViewportSize({ width: 375, height: 850 });
    await expect(page.getByRole("heading", { name: "Manage Event", exact: true })).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(OUT, "manage-mobile.png"), fullPage: true }); proof.screenshots.push("manage-mobile.png");
    assert.equal(apiCount, 1); pass("Mobile layout reused the same page and database result without another API request");
    await page.evaluate(id => { location.hash = `event=${id}&view=participant`; }, EVENT);
    await expect(page).toHaveURL(ORIGIN + "/first-event/");
    await expect(page.getByRole("heading", { name: "Truth Pays", exact: true })).toBeVisible();
    await expect(page.locator("[data-connect-wallet]")).toBeVisible();
    await expect(page.locator("[data-deposit]")).toBeHidden();
    await expect(page.locator("[data-contract-address]")).toContainText(CONTRACT);
    await expect(page.locator("[data-event-hours]")).toContainText("18:00–22:00 India (IST)");
    await expect(page.locator("[data-display-rows]")).toHaveCount(0);
    await page.screenshot({ path: path.join(OUT, "canonical-first-event-mobile.png"), fullPage: true }); proof.screenshots.push("canonical-first-event-mobile.png");
    const participantResult = await participantAPI.promise;
    assert.equal(participantResult.error, undefined); assert.equal(participantResult.status, 200); validateProjection(participantResult.data);
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    assert.equal(apiCount, 2); pass("Participant navigation uses the canonical first-event layout and one anonymous SQL receipt prefetch, without auth or wallet activity");
    if (LEGACY_EVENT.id !== EVENT) {
      await page.goto(`${ORIGIN}/#event=${LEGACY_EVENT.id}&view=participant&review=1`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await expect(page.getByRole("heading", { name: "Your deposit", exact: true })).toBeVisible({ timeout: 45000 });
      await expect(page).toHaveURL(`${ORIGIN}/#event=${LEGACY_EVENT.id}&view=participant&deposit=manage`);
      await expect(page.locator("[data-manage-withdraw]")).toBeVisible();
      await expect(page.locator("[data-manage-withdraw]")).toBeDisabled();
      await expect(page.locator("[data-first-event-display]")).toContainText("Previous event — recovery only");
      await expect(page.locator("[data-first-event-display]")).toContainText(LEGACY_EVENT.contract);
      const oldResult = await legacyAPI.promise;
      assert.equal(oldResult.error, undefined); assert.equal(oldResult.status, 200); validateProjection(oldResult.data, LEGACY_EVENT);
      await expect(page.locator("[data-display-status]")).toContainText(`block ${oldResult.data.blockNumber.toLocaleString("en-US")}`);
      await expect(page.locator("[data-display-rows]")).toHaveText("Connect your wallet to see its saved receipts.");
      await expect(page.locator("[data-display-rows] tbody tr")).toHaveCount(0);
      assert.equal(apiCount, 3);
      await page.screenshot({ path: path.join(OUT, "original-recovery-mobile.png"), fullPage: true }); proof.screenshots.push("original-recovery-mobile.png");
      pass("The old review bookmark opens saved recovery without the full app; withdrawal is visible and waits for the paying wallet");
    }
    for (const name of ["index.html", "entry.js", "first-event-display.js", "first-event/event.js", "first-event/index.html", "first-event/wallet.js"]) assert.equal(proof.assets[name]?.matches, true);
    assert.equal(await page.evaluate(() => window.__databaseDisplayTiming.walletTouches), 0);
    assert.deepEqual(proof.blocked, []); assert.deepEqual(proof.errors, []);
    assert(proof.requests.filter(row => row.path.startsWith("/api/")).every(row => [API, API + legacyQuery].includes(row.path) && row.method === "GET"));
    proof.status = "passed"; proof.completedAt = new Date().toISOString(); proof.apiRequests = apiCount;
    proof.sourcePins = Object.fromEntries(["index.html", "entry.js", "first-event-display.js", "first-event/event.js"].map(name => [name, sha(expected(name))]));
  } catch (error) { proof.status = "failed"; proof.failure = error.message; throw error; }
  finally {
    releaseAPI.release();
    await browser?.close();
    await fs.writeFile(path.join(OUT, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
    console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, sourceCommit, proofPath: path.join(OUT, "proof.json"),
      headingMs: proof.renderBeforeAPI?.headingMs, firstContentfulPaintMs: proof.renderBeforeAPI?.firstContentfulPaintMs,
      apiElapsedMs: proof.api?.elapsedMs, apiRequests: apiCount, failure: proof.failure }));
  }
}

if (process.argv.length === 2) console.log("Prepared read-only database display checker. ROOT may run --execute after publishing; no network performed by default.");
else {
  assert.deepEqual(process.argv.slice(2), ["--execute"], "Only explicit ROOT --execute is accepted");
  await run();
}
