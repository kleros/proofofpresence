// Actual first-event wallet controller, synthetic public snapshot and injected
// provider. Every network response is local; all write/auth/send APIs are denied.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { EVENT } from '../public/first-event/event.js';

const PUBLIC = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const ORIGIN = 'http://127.0.0.1:43144', PREFERENCE = 'kleros-wallet-preference:v1';
const CHALLENGE_END = 1793927711, NOW = CHALLENGE_END - 7200;
assert.equal(new Date(CHALLENGE_END * 1000).toISOString(), '2026-11-06T01:15:11.000Z');
const wallets = Array.from({ length: 14 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
const known = wallets[0], unknown = `0x${'e'.repeat(40)}`, hash = `0x${'a'.repeat(64)}`, blockHash = `0x${'c'.repeat(64)}`;
const snapshot = {
  schemaVersion: 1, kind: 'first-event-depositors', displayOnly: true, mode: EVENT.mode,
  instanceId: 'synthetic-post-event-status', eventId: EVENT.id, chainId: 1, contract: EVENT.contract,
  status: 'current', checkedAt: new Date((NOW - 1) * 1000).toISOString(), blockNumber: 26345274, blockHash,
  depositors: wallets.map((wallet, i) => ({ wallet, totalReceivedWei: EVENT.depositWei, deposits: [{
    txHash: i === 0 ? hash : `0x${(i + 1).toString(16).padStart(64, '0')}`, logIndex: i,
    amountWei: EVENT.depositWei, blockNumber: 26340000 + i, blockHash,
  }] })),
  eventState: {
    phase: 'Listed', owner: `0x${'f'.repeat(40)}`, eventStart: Date.parse(EVENT.startsAt) / 1000,
    endsAt: Date.parse(EVENT.endsAt) / 1000, claimDeadline: Date.parse(EVENT.startsAt) / 1000 + 7 * 86400,
    challengeEndsAt: CHALLENGE_END, challengeDepositWei: '1000000000000000', chainTimestamp: NOW - 1,
    stakers: wallets.map(wallet => ({ wallet, status: 1, attended: true,
      challenge: { state: 0, depositWei: '0', matchDeadline: 0, localId: '0' } })),
  },
  payoutState: {
    schemaVersion: 1, kind: 'first-event-payout-state', eventId: EVENT.id, chainId: 1, contract: EVENT.contract,
    blockNumber: 26345274, blockHash, depositWei: EVENT.depositWei, stakerCount: 14, attendeeCount: 14,
    payoutShareWei: '0', heldBackWei: '0', cases: [],
  },
};

const checks = [], external = [], forbidden = [], errors = [];
const browser = await chromium.launch({ headless: true });
let activeContext;
async function open({ remembered = false, account = known, chain = '0x1', holdChain = false, heldIntent = false } = {}) {
  await activeContext?.close();
  const context = activeContext = await browser.newContext({ locale: 'en-GB', timezoneId: 'UTC', serviceWorkers: 'block',
    viewport: { width: 390, height: 844 } });
  const requests = [];
  await context.addInitScript(({ now, remembered, account, chain, holdChain, heldIntent, preference, origin, event }) => {
    const NativeDate = Date, began = performance.now();
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [now * 1000 + performance.now() - began])); }
      static now() { return now * 1000 + performance.now() - began; }
    };
    if (remembered) localStorage.setItem(preference, JSON.stringify({ version: 1, type: 'injected', name: 'MetaMask', rdns: null }));
    if (heldIntent) {
      const parts = [origin, 'synthetic-original-instance', event.mode, event.id, event.chainId,
        event.contract.toLowerCase(), account.toLowerCase(), event.abiVersion];
      window.originalIntentKey = 'kleros-first-event-intent:v1:' + parts.map(encodeURIComponent).join(':');
      window.originalIntentValue = JSON.stringify({ phase: 'awaiting-wallet', draftId: 'synthetic-original-deposit', owner: 'synthetic-owner' });
      localStorage.setItem(window.originalIntentKey, window.originalIntentValue);
    }
    let selected = account, selectedChain = chain;
    const listeners = new Map(); window.providerTouches = 0; window.walletMethods = [];
    const provider = { isMetaMask: true,
      on(name, callback) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
      removeListener(name, callback) { listeners.get(name)?.delete(callback); },
      async request({ method }) {
        window.walletMethods.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return selected ? [selected] : [];
        if (method === 'eth_chainId') {
          if (holdChain) { window.chainReadWaiting = true; await new Promise(resolve => window.releaseChainRead = resolve); }
          return selectedChain;
        }
        throw Error('Forbidden provider request: ' + method);
      },
    };
    Object.defineProperty(window, 'ethereum', { configurable: true, get() { window.providerTouches++; return provider; } });
    window.emitWallet = (name, value) => {
      if (name === 'accountsChanged') selected = value[0] ?? null;
      if (name === 'chainChanged') selectedChain = value;
      for (const callback of Array.from(listeners.get(name) ?? [])) callback(value);
    };
  }, { now: NOW, remembered, account, chain, holdChain, heldIntent, preference: PREFERENCE, origin: ORIGIN, event: EVENT });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== ORIGIN) { external.push(url.href); return route.abort(); }
    requests.push({ method: request.method(), path: url.pathname });
    if (!['GET', 'HEAD'].includes(request.method())) {
      forbidden.push({ method: request.method(), path: url.pathname });
      return route.fulfill({ status: 405, contentType: 'application/json', body: '{"error":"Read only fixture"}' });
    }
    if (url.pathname === '/api/first-event/depositors') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot) });
    if (url.pathname.startsWith('/api/')) {
      forbidden.push({ method: request.method(), path: url.pathname });
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"No action API"}' });
    }
    const pathname = url.pathname === '/first-event/' ? '/first-event/index.html' : url.pathname;
    const filename = path.resolve(PUBLIC, '.' + pathname); assert(filename.startsWith(PUBLIC + path.sep));
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(filename)] ?? 'application/octet-stream';
    return route.fulfill({ contentType: type, body: await fs.readFile(filename) });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(ORIGIN + '/first-event/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-state', 'challenge-open');
  await expect(page.locator('[data-deposit]')).toBeHidden();
  await expect(page.locator('.manual-option')).toBeHidden();
  return { page, requests };
}
const methods = page => page.evaluate(() => window.walletMethods);
const assertNoFinancialMethods = async page => {
  const calls = await methods(page);
  assert(calls.every(method => ['eth_accounts', 'eth_chainId', 'eth_requestAccounts'].includes(method)));
};

try {
  // No remembered preference means no provider discovery or prompt on cold load.
  let { page, requests } = await open();
  assert.deepEqual(await methods(page), []); assert.equal(await page.evaluate(() => window.providerTouches), 0);
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  checks.push('Cold post-event load without a preference touches no provider and offers status-only connection');
  await page.locator('[data-connect-wallet]').click();
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-wallet-state', 'attended');
  await expect(page.locator('[data-post-event-amount]')).toHaveText('0.01 ETH');
  await expect(page.locator('[data-post-event-release-date]')).toHaveAttribute('datetime', '2026-11-06T01:15:11.000Z');
  await expect(page.locator('[data-post-event-release-date]')).toContainText('6 Nov 2026');
  await expect(page.locator('[data-post-event-release-date]')).toContainText('06:45:11');
  await expect(page.locator('[data-post-event-countdown]')).toContainText('remaining');
  await expect(page.locator('[data-post-event-stats]')).toContainText('14');
  await expect(page.locator('.receipt-hash').first()).toHaveAttribute('href', 'https://etherscan.io/tx/' + hash);
  await expect(page.locator('.receipt-message')).toContainText('attendance and payout status');
  await expect(page.locator('.receipt-message')).not.toContainText('Luma');
  await page.locator('[data-deposit]').dispatchEvent('click');
  await expect(page.locator('[data-deposit]')).toBeHidden();
  assert.deepEqual(await methods(page), ['eth_requestAccounts']);
  assert(requests.every(row => row.method === 'GET'));
  checks.push('Explicit selection shows all-attended status, exact deadline, deposit-only estimate and original receipt without a financial request');

  await page.evaluate(wallet => window.emitWallet('accountsChanged', [wallet]), unknown);
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  await expect(page.locator('.deposit-receipt')).toHaveCount(0);
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-wallet-state', 'disconnected');
  assert.equal(await page.evaluate(preference => localStorage.getItem(preference), PREFERENCE), null);
  await page.locator('[data-connect-wallet]').click();
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-wallet-state', 'unregistered');
  await expect(page.locator('[data-post-event-estimate]')).toBeHidden();
  await expect(page.locator('.deposit-receipt')).toHaveCount(0);
  await expect(page.locator('[data-deposit]')).toBeHidden();
  await expect(page.locator('.manual-option')).toBeHidden();
  await page.evaluate(() => window.emitWallet('chainChanged', '0x89'));
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-wallet-state', 'disconnected');
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  await assertNoFinancialMethods(page);
  checks.push('Account and chain changes discard the old receipt/status; an unknown wallet cannot borrow the attendee estimate');

  ({ page } = await open({ remembered: true }));
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-wallet-state', 'attended');
  await expect(page.locator('[data-connect-wallet]')).toBeHidden();
  await expect(page.locator('[data-post-event-amount]')).toHaveText('0.01 ETH');
  assert.deepEqual(await methods(page), ['eth_accounts', 'eth_chainId']);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-wallet-state', 'attended');
  assert.deepEqual(await methods(page), ['eth_accounts', 'eth_chainId']);
  checks.push('A remembered home wallet restores and revalidates after reload using only live account/network reads, without another Connect prompt');

  ({ page } = await open({ remembered: true, chain: '0x89' }));
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-wallet-state', 'disconnected');
  assert.deepEqual(await methods(page), ['eth_accounts', 'eth_chainId']);
  checks.push('A remembered provider on another network is not adopted and never requests accounts automatically');

  ({ page } = await open({ remembered: true, account: null }));
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  assert.deepEqual(await methods(page), ['eth_accounts']);
  checks.push('A locked or disconnected remembered wallet keeps an explicit Connect action without issuing an account prompt');

  ({ page } = await open({ remembered: true, holdChain: true }));
  await expect.poll(() => page.evaluate(() => window.chainReadWaiting === true)).toBe(true);
  await page.evaluate(wallet => { window.emitWallet('accountsChanged', [wallet]); window.releaseChainRead(); }, unknown);
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-wallet-state', 'disconnected');
  await expect(page.locator('[data-post-event-estimate]')).toBeHidden();
  assert.deepEqual(await methods(page), ['eth_accounts', 'eth_chainId']);
  checks.push('An account change during the restoration chain read prevents the stale wallet from being adopted');

  ({ page } = await open({ remembered: true, heldIntent: true }));
  await expect(page.locator('[data-post-event]')).toHaveAttribute('data-wallet-state', 'attended');
  await expect(page.locator('[data-tx-status]')).toContainText('A wallet request may still be open');
  await expect(page.locator('[data-post-event-receipt]')).toHaveAttribute('open', '');
  assert.equal(await page.evaluate(() => localStorage.getItem(window.originalIntentKey) === window.originalIntentValue), true);
  await page.locator('[data-deposit]').dispatchEvent('click');
  assert.equal(await page.evaluate(() => localStorage.getItem(window.originalIntentKey) === window.originalIntentValue), true);
  await expect(page.locator('[data-deposit]')).toBeHidden();
  assert.deepEqual(await methods(page), ['eth_accounts', 'eth_chainId']);
  checks.push('Status restoration preserves an unknown original deposit intent and cannot create a second flow or wallet request');

  assert.deepEqual(external, []); assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, details: checks,
    externalRequests: external.length, forbiddenRequests: forbidden.length, browserErrors: errors, realTransactions: 0 }));
} finally { await activeContext?.close(); await browser.close(); }
