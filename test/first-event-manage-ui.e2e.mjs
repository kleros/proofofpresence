import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Synthetic transport DTOs exercise the actual inbox UI. No wallet, chain,
// production backend or public-network request is available to this harness.
const root = fileURLToPath(new URL("../public/", import.meta.url));
const wallet = `0x${"a".repeat(40)}`, owner = `0x${"b".repeat(40)}`, hash = `0x${"c".repeat(64)}`;
const snapshot = { source: "contract", eventId: "synthetic-event", instanceId: "synthetic-instance", chainId: 1,
  contract: `0x${"d".repeat(40)}`, contractVersion: "kleros-event-v10-uups", actionable: true, stale: false,
  indexedBlock: { number: 100, hash: `0x${"e".repeat(64)}`, timestamp: 1793804400 }, lastSyncedAt: "2026-11-04T15:00:00.000Z",
  rows: [{ wallet, name: null, email: null, participantId: null, linked: false, registered: false,
    registrationState: "Not registered", receivedWei: "10000000000000000", pendingCreditWei: "10000000000000000",
    committedPrincipalWei: "0", heldShareWei: "0", owedWei: "0", transactions: [
      { txHash: hash, status: "confirmed", confirmations: 3, amountWei: "10000000000000000", blockNumber: 98, logIndex: 0 },
    ] }] };
const harness = `<!doctype html><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/contract-inbox.css"><main style="padding:24px"><div id="inbox"></div></main><script type="module">
import { mountContractInbox } from '/contract-inbox.js';
window.snapshot=${JSON.stringify(snapshot)};window.adoptions=[];window.current=true;
window.controller=mountContractInbox(document.querySelector('#inbox'),{
  eventId:'synthetic-event',instanceId:'synthetic-instance',wallet:'${owner}',chainId:1,contract:'${snapshot.contract}',
  contractVersion:'kleros-event-v10-uups',currencySymbol:'ETH',canManage:true,isCurrent:()=>window.current,
  request:async()=>structuredClone(window.snapshot),onAdoptPayer:async(input)=>{window.adoptions.push(input);
    Object.assign(window.snapshot.rows[0],{linked:true,participantId:'synthetic-payer'});}
});</script>`;
const server = http.createServer(async (req, res) => {
  if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end(harness); return; }
  const file = req.url.slice(1).split("?")[0];
  if (!/^(styles\.css|contract-inbox\.(js|css)|assets\/[a-zA-Z0-9_.-]+)$/.test(file)) { res.writeHead(404).end(); return; }
  try { res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream");
    res.end(await fs.readFile(root + file)); } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [], external = [];
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => { if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(origin);
  await expect(page.locator("[data-contract-rows]")).toContainText("0.01 ETH received");
  await expect(page.locator("[data-contract-rows]")).toContainText("Not registered");
  await page.locator('[data-contract-action="review"]').click();
  await expect(page.locator("[data-contract-dialog]")).toContainText("No verified guest name or email");
  await expect(page.locator("[data-contract-adopt-note]")).toHaveValue(`Canonical deposit for event synthetic-event; payer ${wallet}; receipt ${hash}.`);
  await expect(page.locator("[data-contract-adopt-confirmed]")).not.toBeChecked();
  await page.locator('[data-contract-action="adopt"]').click();
  await expect(page.locator("[data-contract-adopt-status]")).toContainText("Confirm this exact payer review");
  assert.deepEqual(await page.evaluate(() => window.adoptions), []);
  await page.locator("[data-contract-adopt-note]").fill("Owner reviewed the original canonical receipt");
  await page.locator("[data-contract-adopt-confirmed]").check();
  await page.locator('[data-contract-action="adopt"]').click();
  await expect(page.locator("[data-contract-dialog]")).not.toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.adoptions), [{ wallet, txHash: hash, confirmed: true, note: "Owner reviewed the original canonical receipt" }]);
  await expect(page.locator("[data-contract-rows]")).toContainText("Wallet-only payer");
  await page.locator('[data-contract-action="review"]').click();
  await expect(page.locator("[data-contract-dialog]")).toContainText("No Luma name, email or signed wallet identity");
  await expect(page.locator('[data-contract-action="adopt"]')).toHaveCount(0);
  await page.locator('[data-contract-action="close"]').click();
  await page.evaluate(async () => { Object.assign(window.snapshot.rows[0],{linked:false,participantId:null}); await window.controller.refresh(); });
  await page.locator('[data-contract-action="review"]').click();
  await page.evaluate(async () => { window.snapshot.stale=true; await window.controller.refresh(); });
  await expect(page.locator('[data-contract-action="adopt"]')).toBeDisabled();
  await page.evaluate(() => { window.current=false; window.controller.refresh(); });
  await expect(page.locator("#inbox")).toBeEmpty();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ status: "passed", checks: 7, scope: "actual inbox UI, synthetic transport only", externalRequests: 0, walletRequests: 0 }));
} finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
