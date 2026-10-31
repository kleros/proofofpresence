// Real entry/display modules with public SQL DTOs; guarded app handoff is a stub.
// Only a fake account-selection provider is available; no chain/signing API exists.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { EVENT } from '../public/first-event/event.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url)), PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'artifacts/first-event-db-actions', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(OUT, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const walletA = '0x' + 'a'.repeat(40), walletB = '0x' + 'd'.repeat(40), hashA = '0x' + 'b'.repeat(64), hashB = '0x' + 'e'.repeat(64), blockHash = '0x' + 'c'.repeat(64);
const snapshot = { schemaVersion: 1, kind: 'first-event-depositors', displayOnly: true, mode: 'hosted-production', instanceId: 'synthetic-db-actions',
  eventId: EVENT.id, chainId: 1, contract: EVENT.contract, status: 'current', checkedAt: '2026-10-30T07:00:00.000Z', blockNumber: 100, blockHash,
  depositors: [{ wallet: walletA, totalReceivedWei: '10000000000000000', deposits: [{ txHash: hashA, logIndex: 0, amountWei: '10000000000000000', blockNumber: 98, blockHash }] },
    { wallet: walletB, totalReceivedWei: '20000000000000000', deposits: [{ txHash: hashB, logIndex: 0, amountWei: '20000000000000000', blockNumber: 99, blockHash }] }] };
const proof = { kind: 'first-event-db-actions-browser', status: 'running', source: {}, checks: [], screenshots: [], requests: [], blocked: [], errors: [],
  limits: ['Real saved entry/display/canonical-page modules with synthetic public receipt DTO only. The fresh guarded app is an explicit handoff stub.', 'Only a fake eth_requestAccounts response is permitted. This verifies display/filter/routing, not authentication, authorization, current credit, attendance or transaction eligibility. No real wallet/chain/live API is used.'] };
const pass = (condition, label) => { assert(condition, label); proof.checks.push(label); };
const mime = file => ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] ?? 'text/plain');
let release, held = true, depositReads = 0;
const gate = new Promise(resolve => { release = resolve; });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  proof.requests.push({ method: req.method, pathname: url.pathname });
  if (req.method !== 'GET') { proof.blocked.push({ method: req.method, pathname: url.pathname }); res.writeHead(405).end(); return; }
  if (url.pathname === '/api/first-event/depositors') {
    depositReads++;
    if (held) await gate;
    if (!res.destroyed) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(snapshot)); }
    return;
  }
  if (url.pathname.startsWith('/api/')) { proof.blocked.push({ method: req.method, pathname: url.pathname }); res.writeHead(503).end(); return; }
  if (url.pathname === '/app.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end('export function startApp(){window.__guardedStarts=(window.__guardedStarts??0)+1;window.__guardedRoute=location.hash;}'); return;
  }
  const pathname = decodeURIComponent(url.pathname), file = path.resolve(PUBLIC, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(404).end(); return; }
  try { const bytes = await fs.readFile(file); proof.source[pathname] = sha(bytes); res.setHeader('content-type', mime(file)); res.end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port, walletMethods = [];
let browser, page;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.exposeBinding('__fakeAccountSelection', (_, request) => { walletMethods.push(request.method); assert.equal(request.method, 'eth_requestAccounts'); return [walletA]; });
  await context.addInitScript(() => Object.defineProperty(window, 'ethereum', { get() {
    window.__walletAccesses = (window.__walletAccesses ?? 0) + 1;
    return { request: request => window.__fakeAccountSelection(request), on() {}, removeListener() {} };
  } }));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') { proof.blocked.push({ method: request.method(), pathname: url.pathname }); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => proof.errors.push(error.message));
  const shot = async name => { await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }); proof.screenshots.push(name + '.png'); };
  await page.goto(origin + '/first-event/', { waitUntil: 'networkidle' });
  await page.locator('.deposit-details summary').click();
  const recovery = new URL(await page.getByRole('link', { name: 'Manage your deposit or recover unused credit' }).getAttribute('href'), origin);
  const recoveryParams = new URLSearchParams(recovery.hash.slice(1));
  pass(recoveryParams.get('event') === EVENT.id && recoveryParams.get('review') !== '1', 'Canonical deposit page opens the saved-data recovery view before any guarded review');
  await page.goto(origin + '/' + recovery.hash, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-first-event-display]')).toBeVisible();
  await expect(page.locator('[data-display-review]')).toBeVisible();
  await expect.poll(() => depositReads).toBe(1);
  pass(!proof.requests.some(row => row.pathname === '/app.js') && await page.evaluate(() => (window.__walletAccesses ?? 0) === 0),
    'Recovery view renders while SQL receipts are withheld, without app bootstrap, authentication or wallet access');
  await shot('database-recovery-before-receipts');
  held = false; release();
  await page.waitForLoadState('networkidle');
  const apiBeforeConnect = proof.requests.filter(row => row.pathname.startsWith('/api/')).length;
  await page.locator('[data-display-wallet-connect]').click();
  await expect(page.locator('[data-display-rows]')).toContainText('0.01');
  await expect(page.locator('[data-display-rows]')).toContainText(hashA);
  pass(walletMethods.length === 1 && walletMethods[0] === 'eth_requestAccounts' &&
    proof.requests.filter(row => row.pathname.startsWith('/api/')).length === apiBeforeConnect && !(await page.locator('[data-display-rows]').textContent()).includes(hashB),
    'Recovery Connect only selects a wallet and filters its saved receipts locally with zero API, signing or chain calls');
  const beforeReview = proof.requests.filter(row => row.pathname === '/app.js').length;
  await page.locator('[data-display-review]').click();
  await expect.poll(() => page.evaluate(() => window.__guardedStarts ?? 0)).toBe(1);
  const guardedRecovery = new URLSearchParams((await page.evaluate(() => window.__guardedRoute)).slice(1));
  pass(guardedRecovery.get('event') === EVENT.id && guardedRecovery.get('review') === '1' && proof.requests.filter(row => row.pathname === '/app.js').length === beforeReview + 1,
    'Only the explicit recovery action enters the guarded app with the exact event and fresh-review intent');

  // The handoff stub deliberately owns no subsequent hash navigation; start entry afresh.
  await page.goto('about:blank');
  await page.goto(origin + '/#' + new URLSearchParams({ event: EVENT.id, view: 'organizer' }), { waitUntil: 'networkidle' });
  await expect(page.locator('[data-display-rows]')).toContainText(walletA);
  await expect(page.locator('[data-display-rows]')).toContainText(walletB);
  const checkins = page.locator('[data-display-checkin]');
  await expect(checkins).toHaveCount(2);
  await expect(checkins.nth(0)).toBeVisible(); await expect(checkins.nth(1)).toBeVisible();
  pass(true, 'Every public depositor row exposes a visible Check in action without a wallet or fresh event scan');
  await shot('database-depositors-checkin-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  pass(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Database depositor actions fit the mobile viewport');
  await shot('database-depositors-checkin-mobile');
  await checkins.nth(1).click();
  await expect.poll(() => page.evaluate(() => window.__guardedStarts ?? 0)).toBe(1);
  const checkinRoute = await page.evaluate(() => window.__guardedRoute);
  const checkinParams = new URLSearchParams(checkinRoute.slice(1));
  pass(checkinParams.get('event') === EVENT.id && checkinParams.get('review') === '1' && checkinRoute.toLowerCase().includes(walletB.toLowerCase()),
    'Check in preserves the exact chosen payer/event and enters the guarded app before any private attendance action');
  await page.waitForLoadState('networkidle');
  pass(proof.requests.filter(row => row.pathname.startsWith('/api/')).every(row => row.pathname === '/api/first-event/depositors' && row.method === 'GET') &&
    proof.blocked.length === 0 && proof.errors.length === 0 && walletMethods.every(method => method === 'eth_requestAccounts') && await page.evaluate(() => (window.__walletAccesses ?? 0) === 0),
    'All display traffic is public receipt GET only; no chain/session/auth/transaction, external request or browser error occurs');
  proof.depositReads = depositReads; proof.walletMethods = walletMethods; proof.status = 'passed';
} catch (error) {
  proof.status = 'failed'; proof.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (page) { proof.visibleText = await page.locator('body').textContent().catch(() => null); await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {}); }
} finally {
  release(); await browser?.close(); await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, 'proof.json'), failure: proof.failure?.message }));
}
