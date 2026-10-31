// Two source-selected SYNTHETIC identities, static assets and SQL DTOs only.
// No RPC, wallet signature, transaction, live registry or private state is read.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT as ACTUAL_EVENT, LEGACY_EVENT } from "../public/first-event/event.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url)), ORIGIN = "https://promotion.example.invalid";
const WALLET = "0x7777777777777777777777777777777777777777", HASH = "0x" + "a".repeat(64);
const CURRENT = { ...LEGACY_EVENT, id: "event-synthetic-replacement", contract: "0x9999999999999999999999999999999999999999",
  startsAt: "2026-11-04T12:30:00.000Z", endsAt: "2026-11-04T16:30:00.000Z", timezone: "Asia/Kolkata",
  hoursLabel: "18:00–22:00 India (IST)", depositClosesLabel: "4 November 2026, 18:00 India (IST)" };
function snapshot(event, digit) {
  return { schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, mode: event.mode, instanceId: "promotion-instance",
    eventId: event.id, chainId: 1, contract: event.contract, checkedAt: new Date().toISOString(), status: "current", blockNumber: 100,
    blockHash: "0x" + "c".repeat(64), depositors: [{ wallet: WALLET, totalReceivedWei: event.depositWei,
      deposits: [{ txHash: "0x" + digit.repeat(64), logIndex: 0, amountWei: event.depositWei, blockNumber: 100, blockHash: "0x" + "c".repeat(64) }] }] };
}

test("promoted and original pages, SQL receipts, tokens and pending records remain separately scoped", { timeout: 60000 }, async t => {
  const { chromium, expect } = await import("@playwright/test");
  const original = await fs.readFile(path.join(ROOT, "public/first-event/event.js"), "utf8");
  const promotion = /export const PROMOTED_EVENT = [\s\S]*?;\nexport const EVENT = /;
  assert(promotion.test(original));
  const config = original.replace(promotion, "export const PROMOTED_EVENT = Object.freeze(" + JSON.stringify(CURRENT) + ");\nexport const EVENT = ");
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const api = [], forbidden = [], errors = [];
  let wrongOldPayload = false, staleStatic = false;
  async function pageAt(url = "/test.html") {
    const page = await browser.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(wallet => { window.__walletCalls = []; window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async request => {
      window.__walletCalls.push(request.method);
      if (request.method !== "eth_requestAccounts") throw Error("Unexpected wallet action in promotion UI test");
      return [wallet];
    } }; }, WALLET);
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== ORIGIN || request.method() !== "GET") { forbidden.push(request.method() + " " + url.origin + url.pathname); return route.abort(); }
      if (url.pathname.startsWith("/api/")) {
        api.push(url.pathname + url.search);
        if (url.pathname === "/api/first-event/depositors") {
          const legacy = url.searchParams.get("eventId") === LEGACY_EVENT.id;
          return route.fulfill({ json: snapshot(legacy && !wrongOldPayload ? LEGACY_EVENT : CURRENT, legacy ? "1" : "2") });
        }
        if (url.pathname === "/api/kickback-setup") return route.fulfill({ json: { kind: "kickback-setup-display", displayOnly: true, mode: "hosted-production", instanceId: "promotion-instance",
          chain: { chainId: 1 }, environment: { chainId: 1, production: true, network: "ethereum-mainnet" }, contractVersion: "kleros-event-v10-uups", session: null,
          factory: { verified: false }, capabilities: { transactionsReady: false, createEvents: false, manageEvents: false },
          managedEvents: [CURRENT, LEGACY_EVENT].map(event => ({ ...event, creator: WALLET, visibility: "public", editorialStatus: "published" })) } });
        forbidden.push(url.pathname); return route.abort();
      }
      if (url.pathname === "/test.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><link rel=icon href='data:,'><main></main>" });
      if (url.pathname === "/first-event/event.js") return route.fulfill({ contentType: "text/javascript", body: config });
      const relative = url.pathname === "/" ? "index.html" : url.pathname === "/first-event/" ? "first-event/index.html" : url.pathname.slice(1);
      if (relative.includes("..")) throw Error("Unsafe static path");
      let body = await fs.readFile(path.join(ROOT, "public", relative));
      if (relative === "first-event/index.html" && !staleStatic) body = Buffer.from(body.toString().replaceAll(ACTUAL_EVENT.contract, CURRENT.contract));
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[path.extname(relative)] ?? "application/octet-stream";
      return route.fulfill({ contentType: type, body });
    });
    await page.goto(ORIGIN + url); return page;
  }

  let page = await pageAt("/#event=" + LEGACY_EVENT.id + "&view=participant");
  await expect(page.locator("[data-first-event-display] h1")).toHaveText("Your deposit");
  await expect(page.locator("[data-first-event-display]")).toContainText(LEGACY_EVENT.contract);
  await expect(page.locator("[data-first-event-display]")).toContainText("18:00–22:00 Bangkok");
  await expect.poll(() => api.includes("/api/first-event/depositors?eventId=" + LEGACY_EVENT.id)).toBe(true);
  assert.equal(new URL(page.url()).pathname, "/");
  assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
  await page.close();

  page = await pageAt("/#event=" + LEGACY_EVENT.id + "&view=organizer");
  await expect(page.locator("[data-first-event-display] h1")).toHaveText("Your deposit");
  await expect(page.locator("[data-first-event-display]")).toContainText("Previous event — recovery only");
  await expect(page.locator("[data-manage-attendance]")).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
  await page.close();

  staleStatic = true;
  page = await pageAt("/first-event/");
  await expect(page.locator("[data-copy-address]")).toBeDisabled();
  await expect(page.locator(".manual-deposit")).toBeHidden();
  await expect(page.locator(".address-box")).toBeHidden();
  await page.close(); staleStatic = false;

  wrongOldPayload = true;
  page = await pageAt("/#event=" + LEGACY_EVENT.id + "&view=participant&deposit=manage");
  await expect(page.locator("[data-display-status]")).toContainText("could not be refreshed");
  assert(!(await page.locator("[data-display-rows]").textContent()).includes(CURRENT.contract));
  await page.close(); wrongOldPayload = false;

  page = await pageAt("/#event=" + CURRENT.id + "&view=participant");
  await expect(page).toHaveURL(ORIGIN + "/first-event/");
  await expect(page.locator("[data-event-hours]")).toHaveText(CURRENT.hoursLabel);
  await expect(page.locator("[data-manage-event]")).toHaveAttribute("href", "/#event=" + CURRENT.id + "&view=participant&deposit=manage");
  await expect(page.locator("[data-legacy-event]")).toBeVisible();
  await expect(page.locator("[data-legacy-event] a")).toHaveAttribute("href", "/#event=" + LEGACY_EVENT.id + "&view=participant&deposit=manage");
  assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
  await page.close();

  page = await pageAt();
  const discovery = await page.evaluate(async () => {
    const { EVENT, LEGACY_EVENT } = await import("/first-event/event.js"), { validatePublicCatalog, publicEventSearchEntries, searchPublicEvents } = await import("/event-search.js"),
      { publicResultStatus, renderPublicResults } = await import("/public-home.js");
    const records = [EVENT, LEGACY_EVENT].map(event => ({ ...event, contractVersion: event.abiVersion,
      title: event.id === LEGACY_EVENT.id ? "Previous-only search term" : event.title, visibility: "public", editorialStatus: "published",
      adoption: { kind: "recorded-adoption", txHash: "0x" + "a".repeat(64), blockHash: "0x" + "b".repeat(64), blockNumber: 1 },
      contractProfile: { contractVersion: event.abiVersion, abiVersion: event.abiVersion, version: 10, financialModel: "v8", upgradeable: true,
        verified: true, testOnly: false, chainId: 1, challengeWindowSeconds: 86400, matchWindowSeconds: 86400 } }));
    const input = { schemaVersion: 1, kind: "public-catalog", mode: "hosted-production", instanceId: "promotion-instance", generatedAt: new Date().toISOString(),
      environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
      chain: { chainId: 1, name: "Ethereum", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrl: "https://rpc.example.invalid" },
      catalog: { metadataOnly: true, currentFinancialState: "not-loaded", source: "recorded-adoption" }, events: records };
    const catalog = validatePublicCatalog(input), projected = publicEventSearchEntries(records);
    const rendered = document.createElement("div");
    rendered.innerHTML = renderPublicResults([...catalog.events, { ...catalog.events[0], id: "event-synthetic-generic" }], "");
    const links = rendered.querySelectorAll("[data-public-event-open]");
    return { catalog: catalog.events.map(event => event.id), projected: projected.map(event => event.id),
      count: publicResultStatus(catalog.events, ""), previousSearch: searchPublicEvents(catalog.events, "Previous-only").length,
      currentHref: links[0]?.getAttribute("href"), genericHref: links[1]?.getAttribute("href"),
      oldRecordUnchanged: input.events[1].visibility === "public" && input.events[1].editorialStatus === "published" };
  });
  assert.deepEqual(discovery.catalog, [CURRENT.id]); assert.deepEqual(discovery.projected, [CURRENT.id]);
  assert.equal(discovery.count, "1 public event."); assert.equal(discovery.previousSearch, 0); assert(discovery.oldRecordUnchanged);
  assert.equal(discovery.currentHref, "/first-event/");
  assert.equal(discovery.genericHref, "#event=event-synthetic-generic&view=participant");
  await page.evaluate(async () => { const { renderHomeWallet, mountHomeWallet } = await import("/home-wallet.js"); const main = document.querySelector("main"); main.innerHTML = renderHomeWallet(); mountHomeWallet(main); });
  await page.locator("[data-home-connect-wallet]").click();
  await expect(page.locator("[data-home-deposit-row]")).toHaveCount(2);
  const legacyRow = page.locator(`[data-deposit-event="${LEGACY_EVENT.id}"]`);
  await expect(legacyRow).toContainText("Previous event — recovery only");
  await expect(legacyRow.locator("[data-home-deposit-manage]")).toContainText("Recover original");
  await expect(legacyRow.locator("[data-home-deposit-event]")).not.toHaveAttribute("href", "/first-event/");
  await expect(page.locator("[data-home-event-row]").filter({ hasText: "Previous event — recovery only" }).locator("[data-home-event-manage]")).toHaveText("Recover previous event");
  assert.deepEqual(await page.evaluate(() => window.__walletCalls), ["eth_requestAccounts"]);
  await page.close();

  page = await pageAt();
  const token = await page.evaluate(async ({ wallet, hash }) => {
    const { EVENT, LEGACY_EVENT } = await import("/first-event/event.js"), { createPublicTransactionFlow, resetUnusedPublicTransactionFlow } = await import("/public-transactions.js");
    const { createTransactionJournal } = await import("/transaction-context.js"), { recordedDepositReference } = await import("/first-event/receipts.js");
    const oldKey = "kleros-public-transaction-v1:" + JSON.stringify([location.origin, "deposit", wallet.toLowerCase()]);
    const old = JSON.stringify({ token: "a".repeat(64), hash, wallet, kind: "deposit", instanceId: "old-instance" }); localStorage.setItem(oldKey, old);
    const calls = [];
    const api = async (path, options) => { calls.push(path); return { schemaVersion: 1, kind: "public-transaction-flow", flowKind: "deposit", token: "b".repeat(64), wallet, mode: EVENT.mode,
      instanceId: "new-instance", chainId: 1, contractVersion: EVENT.abiVersion, eventId: EVENT.id, contract: EVENT.contract,
      walletContext: { mode: EVENT.mode, instanceId: "new-instance", chain: { chainId: 1 }, contractVersion: EVENT.abiVersion, abiVersion: EVENT.abiVersion,
        capabilities: { transactionsReady: false, createEvents: false, manageEvents: false } } }; };
    await createPublicTransactionFlow({ api, wallet, kind: "deposit" });
    resetUnusedPublicTransactionFlow({ wallet, kind: "deposit" });
    const journal = createTransactionJournal(localStorage), context = { eventId: LEGACY_EVENT.id, contract: LEGACY_EVENT.contract, chainId: 1,
      abiVersion: LEGACY_EVENT.abiVersion, mode: LEGACY_EVENT.mode, wallet, instanceId: "old-instance" };
    journal.record(context, { hash, draftId: "original-deposit-draft", action: "deposit" }); journal.update(context, hash, { status: "confirmed", blockNumber: 100 });
    const oldReference = recordedDepositReference({ storage: localStorage, journal, wallet, event: LEGACY_EVENT });
    const newReference = recordedDepositReference({ storage: localStorage, journal, wallet, event: EVENT });
    const { eventReadJob } = await import("/event-read.js"), reads = [];
    for (const event of [EVENT, LEGACY_EVENT]) await eventReadJob({ instanceId: "new-instance", wallet, expectedContext: event,
      requestId: "scope-" + event.id, operation: "manage-draft", payload: { eventId: event.id, action: "register", params: { wallets: [wallet] } },
      api: async (path, options) => { const body = JSON.parse(options.body); reads.push(body.eventId); return { kind: "event-read-job", schemaVersion: 1,
        requestId: body.requestId, operation: body.operation, chainId: 1, contractVersion: EVENT.abiVersion, instanceId: "new-instance", wallet,
        eventId: event.id, state: "ready", expiresAt: Date.now() + 10000, result: { selected: event.id } }; } });
    let crossRejected = false;
    try { await eventReadJob({ instanceId: "new-instance", wallet, expectedContext: LEGACY_EVENT, operation: "manage-draft",
      payload: { eventId: EVENT.id, action: "register", params: { wallets: [wallet] } }, api: async () => { throw Error("Cross-event job must not start"); } }); }
    catch { crossRejected = true; }
    return { calls, unchanged: localStorage.getItem(oldKey) === old, oldReference: oldReference?.hash, newReference, reads, crossRejected };
  }, { wallet: WALLET, hash: HASH });
  assert.deepEqual(token.calls, ["/api/public-transactions"]); assert(token.unchanged); assert.equal(token.oldReference, HASH); assert.equal(token.newReference, null);
  assert.deepEqual(token.reads, [CURRENT.id, LEGACY_EVENT.id]); assert(token.crossRejected);
  await page.close();

  for (const scenario of ["old-held-new-view", "new-held-old-view", "same-event-held", "same-event-malformed", "other-event-malformed", "unknown-event"]) {
    page = await pageAt();
    await page.evaluate(async ({ scenario, wallet }) => {
      const { EVENT, LEGACY_EVENT } = await import("/first-event/event.js"), { mountFirstEventManage } = await import("/first-event-manage.js");
      const view = scenario === "new-held-old-view" ? LEGACY_EVENT : EVENT;
      let held = scenario === "old-held-new-view" ? LEGACY_EVENT : scenario === "new-held-old-view" || scenario === "other-event-malformed" ? EVENT : view;
      if (scenario === "other-event-malformed") held = LEGACY_EVENT;
      const context = { eventId: held.id, chainId: 1, contract: held.contract, abiVersion: held.abiVersion, mode: held.mode, wallet, instanceId: "held-instance" };
      if (scenario === "unknown-event") context.eventId = "unknown-event";
      if (scenario.endsWith("malformed")) context.contract = "0x8888888888888888888888888888888888888888";
      const fields = [location.origin, context.instanceId, wallet.toLowerCase(), ...(scenario === "new-held-old-view" ? [held.id, held.contract.toLowerCase()] : [])];
      const key = "kleros-first-event-manage-intent:v1:" + fields.map(encodeURIComponent).join(":");
      const value = JSON.stringify({ phase: "awaiting-wallet", origin: location.origin, context, draftId: "held-draft" }); localStorage.setItem(key, value);
      const main = document.querySelector("main"); mountFirstEventManage({ root: main, event: view, view: "organizer", getSnapshot: () => null });
      window.__preserved = () => localStorage.getItem(key) === value;
    }, { scenario, wallet: WALLET });
    await page.locator("[data-manage-connect]").click();
    await expect(page.locator("[data-manage-wallet]")).toContainText("Connected");
    await page.evaluate(async () => { await Promise.all([import("/event-read.js"), import("/v10-wallet-account.js"), import("/transaction-context.js")]); await Promise.resolve(); });
    if (scenario === "same-event-held") await expect(page.locator("[data-manage-pending]")).toContainText("no recorded hash");
    else if (scenario.endsWith("malformed") || scenario === "unknown-event") await expect(page.locator("[data-manage-status]")).toContainText(/scope changed|scope.*changed/);
    else await expect(page.locator("[data-manage-pending]")).toBeEmpty();
    assert(await page.evaluate(() => window.__preserved()));
    assert.deepEqual(await page.evaluate(() => window.__walletCalls), ["eth_requestAccounts"]);
    await page.close();
  }
  assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
  t.diagnostic("Synthetic promotion only: current config is not changed; static QR payload is not regenerated or claimed verified by this test.");
});
