// Actual entry + display modules, synthetic loopback API. No chain, account or live service.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { EVENT } from "../public/first-event/event.js";
const root = fileURLToPath(new URL("../public/", import.meta.url));
const output = process.env.FIRST_EVENT_DISPLAY_OUTPUT ? path.resolve(process.env.FIRST_EVENT_DISPLAY_OUTPUT) : fileURLToPath(new URL("../artifacts/event-display/", import.meta.url));
const payer = `0x${"a".repeat(40)}`, txHash = `0x${"b".repeat(64)}`, blockHash = `0x${"c".repeat(64)}`;
const fixture = { schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, mode: "hosted-production",
  instanceId: "synthetic-display-instance", eventId: EVENT.id, chainId: 1, contract: EVENT.contract,
  status: "current", checkedAt: "2026-10-30T05:00:00.000Z", blockNumber: 100, blockHash,
  depositors: [{ wallet: payer, totalReceivedWei: "10000000000000000", deposits: [{ txHash, logIndex: 0,
    amountWei: "10000000000000000", blockNumber: 98, blockHash }] }] };
const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
let payload = structuredClone(fixture), gate = deferred(), apiCount = 0;
const requests = [], external = [], wallet = [], errors = [];
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer(async (req, res) => {
  requests.push({ path: req.url, method: req.method });
  if (req.url === "/api/first-event/depositors") {
    apiCount++; const ownPayload = structuredClone(payload), ownGate = gate;
    if (ownGate) await ownGate.promise;
    if (!res.destroyed) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(ownPayload)); }
    return;
  }
  if (req.url === "/api/public-catalog") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ schemaVersion: 1, kind: "public-catalog", mode: "hosted-production", instanceId: "synthetic-display-instance",
      environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
      chain: { chainId: 1, name: "Ethereum Mainnet", rpcUrl: "https://example.invalid", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
      generatedAt: "2026-10-30T05:00:00.000Z", catalog: { metadataOnly: true, currentFinancialState: "not-loaded", source: "recorded-adoption" }, events: [] })); return;
  }
  if (req.url === "/api/kickback-setup") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ kind: "kickback-setup-display", displayOnly: true, mode: "hosted-production", instanceId: "synthetic-display-instance",
      chain: { chainId: 1 }, environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
      contractVersion: "kleros-event-v10-uups", session: null, factory: { verified: false },
      capabilities: { transactionsReady: false, createEvents: false, manageEvents: false }, managedEvents: [] })); return;
  }
  if (req.url === "/app.js") {
    res.setHeader("content-type", "application/javascript");
    res.end("export function startApp(){window.__reviewStarted=(window.__reviewStarted??0)+1;window.__reviewRoute=location.hash;}"); return;
  }
  if (req.url.startsWith("/api/")) { res.writeHead(500).end("Unexpected API"); return; }
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const target = path.resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
  if (!target.startsWith(root)) { res.writeHead(404).end(); return; }
  try { res.setHeader("content-type", mime[path.extname(target)] ?? "application/octet-stream"); res.end(await fs.readFile(target)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const organizer = `${origin}/#event=${EVENT.id}&view=organizer`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, "ethereum", { get() { window.__walletTouched = true; throw Error("Unexpected wallet access"); } }));
  await page.route("**/*", route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(organizer, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Manage Event", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Depositors", exact: true })).toBeVisible();
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("[data-display-rows]")).toBeEmpty();
  assert.equal(apiCount, 1);
  assert.equal(requests.some(row => row.path === "/app.js" || row.path.startsWith("/api/bootstrap") || row.path.startsWith("/api/session")), false);
  assert.equal(await page.evaluate(() => window.__walletTouched ?? false), false);
  gate.release(); gate = null;
  await expect(page.locator("[data-display-rows]")).toContainText("0.01 ETH");
  await expect(page.locator("[data-display-rows] a").first()).toHaveAttribute("href", `https://etherscan.io/address/${payer}`);
  await expect(page.locator("[data-display-status]")).toContainText("block 100");

  payload = { ...structuredClone(fixture), eventId: "another-event" };
  await page.locator("[data-display-refresh]").click();
  await expect(page.locator("[data-display-status]")).toContainText("could not be refreshed");
  await expect(page.locator("[data-display-rows]")).toContainText("0.01 ETH");
  payload = { ...structuredClone(fixture), status: "stale" };
  await page.locator("[data-display-refresh]").click();
  await expect(page.locator("[data-display-status]")).toContainText("Saved snapshot; refresh unavailable");
  payload = { ...structuredClone(fixture), depositors: [] };
  await page.locator("[data-display-refresh]").click();
  await expect(page.locator("[data-display-rows]")).toContainText("No confirmed deposits at this snapshot");

  payload = structuredClone(fixture); gate = deferred();
  const before = apiCount;
  await page.locator("[data-display-refresh]").click();
  await expect(page.locator("[data-display-refresh]")).toBeDisabled();
  await page.locator("#refresh").click();
  await expect.poll(() => apiCount).toBe(before + 1);
  await page.evaluate(id => { location.hash = `event=${id}&view=participant`; }, EVENT.id);
  await expect(page).toHaveURL(`${origin}/first-event/`);
  await expect(page.getByRole("heading", { name: "Truth Pays", exact: true })).toBeVisible();
  gate.release(); gate = null;
  await expect(page.locator("[data-display-rows]")).toHaveCount(0);
  await expect(page.locator("[data-connect-wallet]")).toBeVisible();
  await expect(page.locator("[data-copy-address]")).toBeVisible();
  await expect(page.locator("[data-contract-address]")).toHaveText(EVENT.contract);
  assert.equal(apiCount, before + 1);
  assert.equal(requests.some(row => row.path === "/app.js"), false);
  assert.equal(await page.evaluate(() => window.__walletTouched ?? false), false);

  // The omitted participant view resolves to the exact same layout with no API.
  const participantRequests = requests.length;
  await page.goto(`${origin}/#event=${EVENT.id}`, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(`${origin}/first-event/`);
  await expect(page.locator("[data-connect-wallet]")).toBeVisible();
  assert.equal(requests.slice(participantRequests).some(row => row.path.startsWith("/api/") || row.path === "/app.js"), false);
  assert.equal(await page.evaluate(() => window.__walletTouched ?? false), false);

  // Database recovery preserves an explicit transaction handoff to the guarded app, avoiding
  // the canonical participant redirect and retaining the original transaction.
  await page.locator(".deposit-details summary").click();
  const recoveryLink = page.getByRole("link", { name: "Manage your deposit or recover unused credit" });
  const recoveryURL = new URL(await recoveryLink.getAttribute("href"));
  assert.equal(new URLSearchParams(recoveryURL.hash.slice(1)).get("deposit"), "manage");
  assert.equal(new URLSearchParams(recoveryURL.hash.slice(1)).get("review"), null);
  await page.goto(`${origin}/${recoveryURL.hash}&txHash=${txHash}`, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => window.__reviewStarted ?? 0)).toBe(1);
  assert.equal(await page.evaluate(() => window.__reviewRoute), `${recoveryURL.hash}&txHash=${txHash}`);
  assert.equal(requests.filter(row => row.path === "/app.js").length, 1);

  const guardedRoutes = [
    `/#event=${EVENT.id}&view=participant&recovery=1&transaction=${txHash}`,
    `/#event=${EVENT.id}&view=cases&txHash=${txHash}`,
    `/#event=${EVENT.id}&view=participant&setup=kickback&txHash=${txHash}`,
    `/?txHash=${txHash}#event=${EVENT.id}&view=participant`,
    `/#event=${EVENT.id}&view=participant&draft=original-draft`,
    `/#event=${EVENT.id}&event=${EVENT.id}&view=participant`,
  ];
  for (const route of guardedRoutes) {
    // Each case exercises entry startup; the full-app stub intentionally does
    // not implement the legacy application's own subsequent hash navigation.
    await page.goto("about:blank");
    const requestStart = requests.length;
    await page.goto(origin + route, { waitUntil: "networkidle" });
    await expect.poll(() => page.evaluate(() => window.__reviewStarted ?? 0)).toBe(1);
    assert.equal(page.url(), origin + route);
    assert.equal(await page.evaluate(() => window.__reviewRoute), new URL(origin + route).hash);
    assert.equal(requests.slice(requestStart).some(row => row.path.startsWith("/api/")), false);
    assert.equal(await page.evaluate(() => window.__walletTouched ?? false), false);
  }

  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto(organizer.replace("/#", "/?mobile=1#"), { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-display-rows]")).toContainText(payer);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const routeChecks = await page.evaluate(async id => {
    const { isFirstEventDisplayRoute: matches } = await import("/first-event-display.js");
    return [matches(`#event=${id}`), matches(`#event=${id}&view=organizer`), !matches(`#event=${id}&review=1`),
      !matches(`#event=${id}&view=cases`), !matches(`#event=${id}&setup=kickback`), !matches(`#event=${id}&event=${id}`), !matches("#event=other")];
  }, EVENT.id);
  assert(routeChecks.every(Boolean));
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "manage-mobile.png"), fullPage: true });
  // A route change must win even while the display module itself is still downloading.
  const racePage = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  racePage.on("pageerror", error => errors.push(error.message));
  const moduleGate = deferred(); let moduleRequested = false;
  await racePage.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    if (url.pathname === "/first-event-display.js") { moduleRequested = true; await moduleGate.promise; }
    return route.continue();
  });
  await racePage.goto(organizer.replace("/#", "/?module-race=1#"), { waitUntil: "domcontentloaded" });
  await expect.poll(() => moduleRequested).toBe(true);
  await racePage.evaluate(() => { location.hash = ""; });
  await expect(racePage.getByRole("heading", { name: "Find your event", exact: true })).toBeVisible();
  moduleGate.release();
  await racePage.evaluate(async () => { await import("/first-event-display.js"); });
  await expect(racePage.getByRole("heading", { name: "Find your event", exact: true })).toBeVisible();
  await expect(racePage.locator("[data-first-event-display]")).toHaveCount(0);
  await racePage.close();
  assert(requests.filter(row => row.path.startsWith("/api/")).every(row => ["/api/first-event/depositors", "/api/public-catalog", "/api/kickback-setup"].includes(row.path) && row.method === "GET"));
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(wallet, []);
  const proof = { status: "passed", checks: 13, scope: "actual index/entry/display/canonical deposit page; synthetic loopback public depositor DTO; full app handoff stub only",
    noLiveRPC: true, noWallet: true, noAuth: true, immediateContentWithAPIWithheld: true, requestMethods: [...new Set(requests.filter(row => row.path.startsWith("/api/")).map(row => row.method))],
    checksPassed: ["display before API", "one public API only", "valid scoped receipts", "bad scope retains stale list", "stale/empty labels", "refresh coalescing", "late disposed response ignored", "canonical participant redirect without API or wallet", "default participant view uses same canonical page", "explicit credit recovery retains transaction and enters guarded app", "query/action/case/setup/duplicate routes preserve intent", "mobile and route scope", "pending module cannot replace newer home route"] };
  await fs.writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof));
} finally {
  gate?.release();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
