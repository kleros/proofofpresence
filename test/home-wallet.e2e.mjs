// Actual thin entry/home/controller; synthetic loopback SQL-display responses only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { EVENT, LEGACY_EVENT, firstEventDepositorsPath } from "../public/first-event/event.js";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const output = process.env.HOME_WALLET_OUTPUT ?? "/tmp/kleros-home-wallet-proof";
const walletA = "0x" + "a".repeat(40), walletB = "0x" + "b".repeat(40);
const instanceId = "synthetic-home-instance";
const environment = { production: true, network: "ethereum-mainnet", chainId: 1 };
const chain = { chainId: 1, name: "Ethereum Mainnet", rpcUrl: "https://example.invalid", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } };
const catalog = { schemaVersion: 1, kind: "public-catalog", mode: "hosted-production", instanceId, environment, chain,
  generatedAt: "2026-10-30T05:00:00.000Z", catalog: { metadataOnly: true, currentFinancialState: "not-loaded", source: "recorded-adoption" }, events: [] };
const event = (id, creator, patch = {}) => ({ id, creator, title: id === "home-a" ? "Wallet A event" : "Wallet B event", startsAt: "2026-11-04T11:00:00.000Z", timezone: "Asia/Bangkok", visibility: "public", editorialStatus: "published", ...patch });
const setup = { kind: "kickback-setup-display", displayOnly: true, mode: "hosted-production", instanceId, chain, environment,
  contractVersion: "kleros-event-v10-uups", session: null, factory: { verified: false },
  capabilities: { transactionsReady: false, createEvents: false, manageEvents: false },
  managedEvents: [event("home-a", walletA), event("home-b", walletB), event("private", walletA, { visibility: "private", title: "Private title must stay hidden" }),
    event("draft", walletA, { editorialStatus: "draft" }), event("duplicate", walletA), event("duplicate", walletA), event("bad/id", walletA)] };
const hashA = "0x" + "1".repeat(64), hashB = "0x" + "2".repeat(64), blockHash = "0x" + "3".repeat(64);
const deposits = { schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, mode: EVENT.mode, instanceId,
  eventId: EVENT.id, chainId: 1, contract: EVENT.contract, status: "current", checkedAt: "2000-01-01T00:00:00.000Z", blockNumber: 100, blockHash,
  depositors: [{ wallet: walletA, totalReceivedWei: EVENT.depositWei, deposits: [{ txHash: hashA, logIndex: 0, amountWei: EVENT.depositWei, blockNumber: 99, blockHash }] },
    { wallet: walletB, totalReceivedWei: "1", deposits: [{ txHash: hashB, logIndex: 0, amountWei: "1", blockNumber: 99, blockHash }] }] };
let depositResponse = deposits;
let releaseSetup; const setupGate = new Promise(resolve => { releaseSetup = resolve; });
let releaseDeposits; const depositGate = new Promise(resolve => { releaseDeposits = resolve; });
const requests = [], errors = [], external = [];
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer(async (req, res) => {
  requests.push({ path: req.url, method: req.method });
  const json = value => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
  if (req.url === "/api/public-catalog") return json(catalog);
  if (req.url === "/api/kickback-setup") { await setupGate; if (!res.destroyed) json(setup); return; }
  if (req.url === "/api/first-event/depositors") { await depositGate; if (!res.destroyed) json(depositResponse); return; }
  if (req.url === firstEventDepositorsPath(LEGACY_EVENT)) { await depositGate; if (!res.destroyed) json({ ...depositResponse, eventId: LEGACY_EVENT.id, contract: LEGACY_EVENT.contract, depositors: [] }); return; }
  if (req.url === "/app.js") { res.setHeader("content-type", "application/javascript"); res.end("export function startApp(){window.__fullAppStarted=true;}"); return; }
  if (req.url.startsWith("/api/")) { res.writeHead(500).end("Unexpected API"); return; }
  const pathname = new URL(req.url, "http://localhost").pathname;
  const target = path.resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
  if (!target.startsWith(root)) { res.writeHead(404).end(); return; }
  try { res.setHeader("content-type", mime[path.extname(target)] ?? "application/octet-stream"); res.end(await fs.readFile(target)); }
  catch { res.writeHead(404).end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const copied = [];
  await page.exposeFunction("__copyHash", value => { copied.push(value); });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ walletA, walletB }) => {
    let account = walletA;
    const listeners = new Map(); window.__walletCalls = [];
    window.ethereum = {
      request: async payload => { window.__walletCalls.push(payload.method); if (payload.method !== "eth_requestAccounts") throw Error("Unexpected wallet method"); return [account]; },
      on: (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
      removeListener: (event, callback) => listeners.get(event)?.delete(callback),
    };
    window.__walletChanged = event => { account = walletB; for (const callback of listeners.get(event) ?? []) callback(event === "accountsChanged" ? [account] : "0x2"); };
    Object.defineProperty(navigator, "clipboard", { value: { writeText: value => window.__copyHash(value) } });
  }, { walletA, walletB });
  await page.route("**/*", route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-home-connect-wallet]")).toBeVisible();
  await expect.poll(() => requests.filter(row => row.path === "/api/kickback-setup").length).toBe(1);
  await expect.poll(() => requests.filter(row => row.path === "/api/first-event/depositors").length).toBe(1);
  assert.deepEqual(await page.locator(".luma-launch-card > h2:visible").allTextContents(), ["Find your event", "Your events", "Organizing an event?"]);
  assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
  const beforeConnect = requests.filter(row => row.path.startsWith("/api/")).length;
  await page.locator("[data-home-connect-wallet]").click();
  await expect(page.locator("[data-home-wallet-status]")).toContainText("Connected · 0xaaaa");
  await expect(page.locator("[data-home-events]")).toContainText("Loading your events…");
  await expect(page.locator("[data-home-deposits]")).toContainText("Loading your saved deposits…");
  assert.equal(requests.filter(row => row.path.startsWith("/api/")).length, beforeConnect);
  assert.deepEqual(await page.evaluate(() => window.__walletCalls), ["eth_requestAccounts"]);
  releaseSetup();
  await expect(page.locator("[data-home-event-row]")).toHaveCount(1);
  await expect(page.locator("[data-home-event-row]")).toContainText("Wallet A event");
  await expect(page.locator("[data-home-event-manage]")).toHaveAttribute("href", "#event=home-a&view=organizer");
  await expect(page.locator("[data-home-events]")).not.toContainText("Private title");
  await expect(page.locator("[data-home-deposits]")).toContainText("Loading your saved deposits…");
  await page.locator("[data-public-event-search]").fill("search preserved");
  await page.locator("#refresh").click();
  await expect(page.locator("[data-public-event-search]")).toHaveValue("search preserved");
  await expect(page.locator("[data-home-event-row]")).toHaveCount(1);
  assert.equal(requests.filter(row => row.path === "/api/kickback-setup").length, 1);
  assert.equal(requests.filter(row => row.path === "/api/first-event/depositors").length, 1);
  await page.evaluate(() => window.__walletChanged("accountsChanged"));
  await expect(page.locator("[data-home-event-row]")).toHaveCount(0);
  await expect(page.locator("[data-home-connect-wallet]")).toBeVisible();
  const beforeReconnect = requests.filter(row => row.path.startsWith("/api/")).length;
  await page.locator("[data-home-connect-wallet]").click();
  await expect(page.locator("[data-home-event-row]")).toContainText("Wallet B event");
  assert.equal(requests.filter(row => row.path.startsWith("/api/")).length, beforeReconnect);
  releaseDeposits();
  await expect(page.locator("[data-home-deposit-row]")).toHaveCount(1);
  await expect(page.locator("[data-home-deposits]")).toContainText(hashB);
  await expect(page.locator("[data-home-deposits]")).not.toContainText(hashA);
  await expect(page.locator("[data-home-deposits]")).toContainText("0.000000000000000001 ETH");
  await expect(page.locator("[data-home-deposit-event]")).toHaveAttribute("href", "/first-event/");
  await expect(page.locator("[data-home-deposit-manage]")).toHaveAttribute("href", `#event=${EVENT.id}&view=participant&deposit=manage`);
  await page.locator("[data-home-deposit-copy]").click(); await expect(page.locator("[data-home-deposit-copy-status]")).toContainText("copied");
  assert.deepEqual(copied, [hashB]);
  await page.evaluate(() => window.__walletChanged("chainChanged"));
  await expect(page.locator("[data-home-event-row]")).toHaveCount(0);
  await expect(page.locator("[data-home-deposits-panel]")).toBeHidden();
  await expect(page.locator("[data-home-connect-wallet]")).toBeVisible();
  await page.locator("[data-home-connect-wallet]").click();
  await expect(page.locator("[data-home-event-row]")).toContainText("Wallet B event");
  await page.setViewportSize({ width: 375, height: 850 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "home-mobile.png"), fullPage: true });
  depositResponse = { ...deposits, depositors: [] };
  await page.reload({ waitUntil: "networkidle" }); await page.locator("[data-home-connect-wallet]").click();
  await expect(page.locator("[data-home-deposits]")).toContainText("No saved Truth Pays deposit receipts");
  await expect(page.locator("[data-home-event-row]")).toContainText("Wallet A event");
  depositResponse = { ...deposits, contract: walletA };
  await page.reload({ waitUntil: "networkidle" }); await page.locator("[data-home-connect-wallet]").click();
  await expect(page.locator("[data-home-deposits]")).toContainText("Saved deposit receipts are unavailable");
  await expect(page.locator("[data-home-deposit-row]")).toHaveCount(0);
  depositResponse = { ...deposits, status: "stale" };
  await page.reload({ waitUntil: "networkidle" }); await page.locator("[data-home-connect-wallet]").click();
  await expect(page.locator("[data-home-deposits]")).toContainText("Saved snapshot; the latest refresh is unavailable");
  await expect(page.locator("[data-home-deposits]")).toContainText(hashA);
  await expect(page.locator("[data-home-deposits]")).not.toContainText(hashB);
  await page.evaluate(() => { location.hash = "setup=kickback"; });
  await expect.poll(() => page.evaluate(() => window.__fullAppStarted ?? false)).toBe(true);
  const walletCount = (await page.evaluate(() => window.__walletCalls)).length;
  await page.evaluate(() => { window.__walletChanged("accountsChanged"); document.querySelector("[data-home-connect-wallet]").click(); });
  assert.equal((await page.evaluate(() => window.__walletCalls)).length, walletCount);
  assert(requests.filter(row => row.path.startsWith("/api/")).every(row => row.method === "GET" && ["/api/public-catalog", "/api/kickback-setup", "/api/first-event/depositors", firstEventDepositorsPath(LEGACY_EVENT)].includes(row.path)));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const proof = { status: "passed", checks: 15, noLiveNetwork: true, noAuth: true, noTransactions: true,
    checksPassed: ["home section order", "both SQL metadata reads independent of Connect", "Connect only eth_requestAccounts and zero API", "public creator rows only with Manage link", "private/draft/duplicate/invalid rows excluded", "search refresh preserves wallet without another read", "account/network changes clear creator and deposit rows", "mobile fits", "handoff disposes wallet listeners", "late receipt response filters newly selected wallet", "completed partial payment visible without admission/balance claim", "copy uses exact original transaction ID", "deposit event and DB attendance links", "empty and invalid scope receipts handled independently of creator list", "stale snapshot labelled and same-wallet receipts only"] };
  await fs.writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ ...proof, output }));
} finally { releaseSetup?.(); releaseDeposits?.(); await browser?.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
