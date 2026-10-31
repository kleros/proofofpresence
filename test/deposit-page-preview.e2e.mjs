// Focused presentation checks against loopback-only sample fixtures. No RPC,
// wallet connection, financial submission, or production service is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startDepositPagePreview, SAMPLE_HASH, SAMPLE_WALLET } from '../scripts/deposit-page-preview.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'artifacts/deposit-page-preview');
const proof = { kind: 'local-deposit-page-presentation', checks: [], screenshots: [],
  externalRequests: [], browserErrors: [], walletAccesses: 0, financialRequests: 0,
  limits: ['Synthetic SQL display data and read-only wallet-controller substitute.',
    'Presentation and status boundaries only; no production transaction or payout verified.'] };
const pass = (value, label) => { assert(value, label); proof.checks.push(label); };
await fs.mkdir(OUT, { recursive: true });
const fixture = await startDepositPagePreview({ port: 0 });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => proof.browserErrors.push(error.message));
  await page.addInitScript(() => {
    window.__previewWalletTouches = 0;
    Object.defineProperty(window, 'ethereum', { configurable: true, get() { window.__previewWalletTouches++; throw Error('Local presentation preview must not access a wallet'); } });
  });
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== fixture.origin) { proof.externalRequests.push(url.href); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) proof.financialRequests++;
    return route.continue();
  });
  const open = async scenario => {
    const before = fixture.requests.filter(row => row.pathname === '/api/first-event/depositors').length;
    const snapshotResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/first-event/depositors');
    await page.goto(`${fixture.origin}/first-event/?preview=${scenario}`, { waitUntil: 'domcontentloaded' });
    await snapshotResponse;
    await expect(page.getByText('Local preview · sample data · payments disabled', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Truth Pays', exact: true })).toBeVisible();
    const after = fixture.requests.filter(row => row.pathname === '/api/first-event/depositors').length;
    pass(after === before + 1, `${scenario}: exactly one shared display GET`);
    pass(await page.evaluate(() => window.__previewWalletTouches === 0), `${scenario}: no real wallet accessed`);
  };
  const screenshot = async name => {
    const file = path.join(OUT, name + '.png'); await page.screenshot({ path: file, fullPage: true }); proof.screenshots.push(file);
  };

  await open('before');
  await expect(page.locator('[data-commitment-count]')).toHaveText('10');
  await expect(page.locator('[data-commitment-total]')).toHaveText('0.1');
  await expect(page.locator('[data-pool-note]')).toContainText('Not the current reward pool');
  await expect(page.locator('[data-event-countdown]')).toContainText('Event starts in');
  await expect(page.locator('[data-event-countdown]')).toContainText('3d');
  await expect(page.locator('[data-admission-status]')).toHaveText('Connect to see your status');
  await expect(page.locator('[data-timeline-claim]')).toContainText('automatically');
  await expect(page.locator('[data-timeline-attendance]')).toContainText('24 hours');
  await expect(page.locator('body')).toContainText('0.0125');
  await expect(page.getByRole('heading', { name: 'How it works', exact: true })).toHaveCount(1);
  await expect(page.locator('.timeline-list > li')).toHaveCount(3);
  await expect(page.locator('.manual-option')).not.toHaveAttribute('open');
  await expect(page.locator('[data-qr-contract]')).toBeHidden();
  await page.locator('.manual-option > summary').click();
  await expect(page.locator('[data-qr-contract]')).toBeVisible();
  await page.locator('.manual-option > summary').click();
  pass(true, 'One three-step journey; optional QR expands without replacing the deposit action');
  const countdownBeforeBack = await page.locator('[data-event-countdown]').innerText();
  await page.evaluate(async wallet => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    const { setDepositWallet } = await import('/first-event/journey.js'); setDepositWallet(wallet);
  }, SAMPLE_WALLET);
  await expect(page.locator('[data-admission-status]')).toHaveText('Registered on contract');
  await expect.poll(() => page.locator('[data-event-countdown]').innerText(), { timeout: 4000 }).not.toBe(countdownBeforeBack);
  pass(true, 'BFCache-preserved page keeps the countdown and admission renderer active');
  await page.evaluate(async () => (await import('/first-event/journey.js')).setDepositWallet(null));
  pass(await page.locator('[data-commitment-count]').evaluate(node =>
    !!(document.querySelector('[data-event-date]').compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Pool summary appears after event timezone');
  await screenshot('before-event-desktop');

  await open('pending');
  await expect(page.locator('[data-admission-status]')).toHaveText('Deposit received · admission not confirmed');
  await expect(page.locator('.deposit-receipt')).toHaveAttribute('data-status', 'confirmed');
  await expect(page.locator('.receipt-hash').first()).toHaveAttribute('href', `https://etherscan.io/tx/${SAMPLE_HASH}`);
  await expect(page.locator('.receipt-hash').first()).toHaveText(SAMPLE_HASH);
  await expect(page.locator('.manual-option')).toBeHidden();
  await screenshot('deposit-receipt-desktop');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw Error('Synthetic unavailable clipboard'); } },
  }));
  await page.locator('[data-copy-tx]').click();
  await expect(page.getByRole('textbox', { name: 'Transaction ID to copy' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Transaction ID to copy' })).toHaveValue(SAMPLE_HASH);
  pass(await page.getByRole('textbox', { name: 'Transaction ID to copy' }).evaluate(node =>
    document.activeElement === node && node.selectionStart === 0 && node.selectionEnd === node.value.length), 'Copy fallback selects the exact original hash inside the styled card');
  await page.evaluate(async hash => {
    const { renderDepositReceipt } = await import('/first-event/receipt-card.js');
    renderDepositReceipt(document.querySelector('[data-tx-status]'), { hash, status: 'submitted', message: 'Sample pending original. No second payment.' });
  }, SAMPLE_HASH);
  await expect(page.locator('.deposit-receipt')).toHaveAttribute('data-status', 'submitted');
  await expect(page.locator('.receipt-state')).toHaveText('Transaction submitted');
  pass(!(await page.locator('.deposit-receipt').innerText()).includes('Deposit confirmed'), 'A pending hash is not presented as a confirmed deposit');

  await open('registered');
  await expect(page.locator('[data-admission-status]')).toHaveText('Registered on contract');
  await expect(page.locator('[data-admission-note]')).toContainText('Attendance and payout are separate');
  await page.setViewportSize({ width: 390, height: 844 });
  pass(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile receipt/admission view has no horizontal overflow');
  await screenshot('deposit-receipt-mobile');

  await open('challenge');
  await expect(page.locator('[data-event-countdown]')).toContainText('Challenge window closes in');
  await expect(page.locator('[data-event-countdown]')).toContainText(/(?:22|23)h/);
  await expect(page.locator('[data-timeline-attendance]')).toContainText('Each challenge has its own 24-hour matching window');
  await screenshot('challenge-countdown-mobile');
  await page.route('**/api/first-event/depositors', async route => {
    const response = await route.fetch(); const data = await response.json(); data.status = 'stale';
    await route.fulfill({ response, json: data });
  });
  await open('challenge');
  await expect(page.locator('[data-event-countdown]')).toContainText('Saved status · Challenge window');
  await expect(page.locator('[data-admission-status]')).toContainText('Saved status · Registered');
  pass(true, 'Stale deadline and admission are qualified in their primary status labels');
  await page.unroute('**/api/first-event/depositors');

  await open('finalization');
  await expect(page.locator('[data-event-countdown]')).toHaveText('Awaiting organizer payout release');
  await expect(page.locator('[data-timeline-deadline]')).toContainText('Open Kleros cases reserve their shares');
  pass(!(await page.locator('[data-event-countdown]').innerText()).match(/\d+h/), 'After the challenge window, no invented payout countdown is shown');

  await open('finalized');
  await expect(page.locator('[data-event-countdown]')).toHaveText('Payouts released');
  await expect(page.locator('[data-timeline-claim]')).toContainText('Failed delivery can be recovered');
  await expect(page.locator('[data-timeline-deadline]')).toContainText('does not prove a payment reached your wallet');

  await open('unavailable');
  await expect(page.locator('[data-pool-note]')).toContainText('temporarily unavailable');
  await expect(page.locator('[data-commitment-count]')).not.toHaveText('0');
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  pass(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Unavailable snapshot preserves immediate mobile event details');

  const denied = await fetch(`${fixture.origin}/api/direct-deposit`, { method: 'POST', body: '{}' });
  pass(denied.status === 405, 'Local preview server refuses financial/write endpoints');
  pass(proof.externalRequests.length === 0, 'No external request was attempted');
  pass(proof.financialRequests === 0, 'Page made no write or financial request');
  pass(proof.browserErrors.length === 0, 'No browser page errors');
  proof.status = 'passed';
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, screenshots: proof.screenshots, output: OUT }, null, 2));
} catch (error) {
  proof.status = 'failed'; proof.error = error.message; throw error;
} finally {
  await fs.writeFile(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  await browser?.close(); await fixture.close();
}
