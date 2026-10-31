// Actual wallet controller with a synthetic account and SQL receipt; no wallet send.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { startDepositPagePreview, previewSnapshot, SAMPLE_WALLET, SAMPLE_HASH } from '../scripts/deposit-page-preview.mjs';
const preview = await startDepositPagePreview({ port: 0 });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const calls = [], errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== preview.origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const actual = await fs.readFile(new URL('../public/first-event/wallet.js', import.meta.url), 'utf8');
  await page.route('**/first-event/wallet.js', route => route.fulfill({ contentType: 'text/javascript', body: actual }));
  await page.exposeFunction('recordCall', method => calls.push(method));
  await page.addInitScript(wallet => {
    window.ethereum = { isMetaMask: true, on(name, callback) { if(name === 'accountsChanged') window.changeAccount = callback; }, removeListener() {},
      async request({method}) { await window.recordCall(method); if(method === 'eth_requestAccounts') return [wallet]; throw Error('Unexpected wallet call: ' + method); } };
  }, SAMPLE_WALLET);
  await page.goto(preview.origin + '/first-event/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-commitment-count]')).toHaveText('10');
  await page.locator('[data-connect-wallet]').click();
  await expect(page.locator('.receipt-state')).toHaveText('Deposit recorded');
  await expect(page.locator('.receipt-hash').first()).toHaveAttribute('href', 'https://etherscan.io/tx/' + SAMPLE_HASH);
  await expect(page.locator('[data-deposit]')).toBeHidden();
  await expect(page.locator('.manual-option')).toBeHidden();
  await expect(page.locator('[data-admission-status]')).toHaveText('Registered on contract');
  assert.deepEqual(calls, ['eth_requestAccounts']);
  assert.equal(preview.requests.filter(row => row.pathname === '/api/first-event/depositors').length, 1);
  await page.evaluate(() => window.changeAccount([]));
  await expect(page.locator('.deposit-receipt')).toHaveCount(0);
  await expect(page.locator('[data-admission-status]')).toHaveText('Connect to see your status');
  await expect(page.locator('.manual-option')).toBeVisible();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert.equal(preview.requests.some(row => row.method !== 'GET'), false);
  // A late malformed response remains contained, and an explicit Deposit still
  // fails closed before creating a transaction flow or making a wallet request.
  let releaseSnapshot;
  const snapshotGate = new Promise(resolve => { releaseSnapshot = resolve; });
  await page.route('**/api/first-event/depositors', async route => {
    await snapshotGate;
    const data = previewSnapshot(); data.eventId = 'another-event';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-connect-wallet]').click();
  await expect(page.locator('[data-deposit]')).toBeVisible();
  releaseSnapshot();
  await expect(page.locator('[data-pool-note]')).toContainText('temporarily unavailable');
  await page.locator('[data-deposit]').click();
  await expect(page.locator('[data-tx-status]')).toContainText('belong to another event');
  assert.deepEqual(calls, ['eth_requestAccounts', 'eth_requestAccounts']);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert.equal(preview.requests.some(row => row.method !== 'GET'), false);
  console.log('PASS actual wallet controller: saved receipt, admission, single SQL read, account invalidation; one synthetic account request, no signing/send/session.');
  console.log('PASS late cross-event receipt response: no unhandled rejection and explicit Deposit fails closed before any transaction flow.');
} finally { await browser?.close(); await preview.close(); }
