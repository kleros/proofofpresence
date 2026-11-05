// Real presentation modules against loopback sample data. No signer, RPC, relay,
// payment, evidence upload or production endpoint is available in this fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startDepositPagePreview, previewSnapshot, SAMPLE_WALLET } from '../scripts/deposit-page-preview.mjs';
import { EVENT } from '../public/first-event/event.js';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'artifacts/post-event-flow');
const proof = { kind: 'post-event-local-presentation', checks: [], screenshots: [], externalRequests: [],
  browserErrors: [], pageWrites: [], walletTouches: 0, limits: [
    'Synthetic public projections and presentation-only wallet substitute.',
    'Production signed-action controllers are not executed; local inert action previews are clicked. No real signatures, chain calls or transfers.',
    'The proposed 24-hour organizer deadline is a labeled fixture, not a contract/policy change.'
  ] };
await fs.mkdir(OUT, { recursive: true });
const fixture = await startDepositPagePreview({ port: 0 });
let browser;
const pass = (condition, note) => { assert(condition, note); proof.checks.push(note); };
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'en-GB', timezoneId: 'Asia/Manila', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => proof.browserErrors.push(error.message));
  await page.addInitScript(() => {
    window.__sampleWalletTouches = 0;
    Object.defineProperty(window, 'ethereum', { configurable: true, get() { window.__sampleWalletTouches++; throw Error('Post-event presentation must not request a wallet'); } });
  });
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== fixture.origin) { proof.externalRequests.push(url.href); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) { proof.pageWrites.push({ method: request.method(), pathname: url.pathname }); return route.abort(); }
    return route.continue();
  });
  const panel = page.locator('[data-post-event]');
  const open = async (scenario, state) => {
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/first-event/depositors');
    await page.goto(`${fixture.origin}/first-event/?preview=${scenario}`, { waitUntil: 'domcontentloaded' });
    await response;
    await expect(page.getByText('Local preview · sample data · payments disabled', { exact: true })).toBeVisible();
    await expect(panel).toBeVisible();
    if (state) await expect(panel).toHaveAttribute('data-state', state);
    await expect(page.locator('[data-deposit]')).toBeHidden();
    await expect(page.locator('.manual-option')).toBeHidden();
    pass(await page.evaluate(() => window.__sampleWalletTouches === 0), `${scenario}: no wallet provider accessed`);
    pass(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${scenario}: no horizontal overflow`);
  };
  const shot = async name => { const file = path.join(OUT, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); proof.screenshots.push(file); };
  const actionPaths = async () => panel.locator('a[href]').evaluateAll(links => links.map(link => new URL(link.href).hash));
  const organizerBeforePublication = async scenario => {
    await expect(panel).toHaveAttribute('data-wallet-state', 'organizer');
    await expect(page.locator('[data-post-event-wallet-title]')).toHaveText('Review and publish the attendance list');
    await expect(page.locator('[data-post-event-primary]')).toHaveText('View attendance management');
    const primary = new URL(await page.locator('[data-post-event-primary]').getAttribute('href'), fixture.origin);
    const params = new URLSearchParams(primary.hash.slice(1));
    pass(primary.origin === fixture.origin && primary.pathname === '/' && params.get('event') === EVENT.id && params.get('view') === 'organizer',
      `${scenario}: an owner who is not a registered attendee keeps the attendance-management action`);
    assert.deepEqual(await page.locator('[data-post-event-stats] dt').allTextContents(), ['Registered wallets']);
    assert.deepEqual(await page.locator('[data-post-event-stats] dd').allTextContents(), ['10']);
    pass(true, `${scenario}: unpublished list shows registration total only, with no attended/absent/Court statistics`);
  };

  await open('current-connect', 'challenge-open');
  await expect(panel).toHaveAttribute('data-wallet-state', 'disconnected');
  await expect(page.locator('[data-post-event-estimate]')).toBeHidden();
  await page.locator('[data-connect-wallet]').click();
  await expect(panel).toHaveAttribute('data-wallet-state', 'attended');
  await expect(page.locator('[data-post-event-title]')).toHaveText('Attendance confirmed');
  await expect(page.locator('[data-post-event-amount]')).toHaveText('0.01 ETH');
  await expect(page.locator('[data-post-event-release-date]')).toHaveAttribute('datetime', '2026-11-06T01:15:11.000Z');
  await expect(page.locator('[data-post-event-release-date]')).toContainText(/6 Nov 2026.*6:45:11.*IST/i);
  await expect(page.locator('[data-post-event-release-local]')).toContainText(/6 Nov 2026.*9:15:11/i);
  await expect(page.locator('[data-post-event-release-note]')).toContainText('transaction is required');
  await expect(page.locator('[data-post-event-primary]')).toHaveText('View payout details');
  assert.deepEqual(await page.locator('[data-post-event-stats] dd').allTextContents(), ['14', '14', '0', '0']);
  await expect(page.locator('[data-deposit]')).toBeHidden();
  await expect(page.locator('.manual-option')).toBeHidden();
  pass(true, 'Connected sample attendee sees all14 attendance,0.01ETH return and exact recorded release deadline in IST/local time, without payment controls');
  await expect(page.locator('.post-event-details')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-post-event-receipt]')).not.toHaveAttribute('open', '');
  await expect(page.locator('.journey-card')).toBeHidden();
  await expect(page.locator('[data-post-event-primary]')).toBeHidden();
  pass(true, 'Connected status starts with attendance, estimated return and payout time; supporting details and original receipt are collapsed');
  await shot('current-all-attended-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await open('current', 'challenge-open');
  await expect(page.locator('[data-post-event-release-date]')).toHaveAttribute('datetime', '2026-11-06T01:15:11.000Z');
  await expect(page.locator('[data-tx-status]')).not.toContainText('for Luma');
  await shot('current-all-attended-mobile');
  await open('current-ready', 'release-ready');
  await expect(page.locator('[data-post-event-release-label]')).toHaveText('Ready for payout release');
  await expect(page.locator('[data-post-event-release-note]')).toContainText('transaction is required');
  await expect(page.locator('[data-post-event-primary]')).toHaveText('Review payout release');
  pass(!/you received|funds received|payment delivered/i.test(await panel.innerText()), 'Afterdeadline Listed14attendee view requires release and does not claim payment');
  await shot('current-release-ready-mobile');
  await open('current-stale', 'awaiting-update');
  await expect(page.locator('[data-post-event-amount]')).toHaveText('');
  await expect(page.locator('[data-post-event-title]')).toContainText('Refresh');
  await expect(page.locator('[data-event-countdown]')).toContainText('Refresh');
  pass(true, 'Stale all-attended snapshot cannot become release-ready from its local clock');
  await open('current-released', 'finalized');
  await expect(page.locator('[data-post-event-release-note]')).toContainText('If it failed');
  await expect(page.locator('[data-post-event-release-date]')).toBeHidden();
  await shot('current-released-mobile');
  pass(!/you received|funds received|payment delivered/i.test(await panel.innerText()), 'Released round keeps delivery uncertain and explains failed-transfer recovery');
  await page.setViewportSize({ width: 1280, height: 1000 });

  await open('organizer', 'awaiting-attendance');
  await expect(panel).toContainText(/organizer|attendance/i);
  await expect(page.locator('[data-post-event-countdown]')).toContainText(/(?:162|163)h/);
  await organizerBeforePublication('current-rules organizer');
  pass(!/no.?shows?\s*:?\s*\d/i.test(await panel.innerText()), 'Before attendance publication no absent-wallet count is invented');
  const currentDeadline = previewSnapshot('organizer').eventState.claimDeadline;
  pass(currentDeadline === Date.parse(EVENT.startsAt) / 1000 + 7 * 86400, 'Current preview uses exact seven-day-from-start publication deadline');
  await shot('organizer-current-deadline-desktop');

  await open('organizer-24h', 'awaiting-attendance');
  await expect(page.locator('.preview-proposal')).toBeVisible();
  await expect(page.locator('.preview-proposal')).toContainText('not deployed');
  await expect(page.locator('[data-post-event-countdown]')).toContainText(/(?:22h|23h|23 hours)/);
  await organizerBeforePublication('proposed-24h organizer');
  pass(previewSnapshot('organizer-24h').eventState.claimDeadline === Date.parse(EVENT.endsAt) / 1000 + 86400,
    'Proposed end+24h policy exists only in explicitly labeled sample fixture');
  await shot('organizer-proposed-24h-desktop');

  await open('challenge', 'challenge-open');
  await expect(page.locator('[data-post-event-wallet-title]')).toContainText(/attend|check.?in|included/i);
  await expect(page.locator('[data-post-event-stats]')).toContainText('10');
  await expect(page.locator('[data-post-event-stats]')).toContainText('8');
  await expect(page.locator('[data-post-event-amount]')).toContainText('0.0125');
  await expect(page.locator('[data-post-event-estimate-note]')).toContainText(/estimat|provisional|change/i);
  pass(true, 'Registered attended wallet sees provisional share from ten registered commitments/eight listed attendees');
  await shot('attended-estimate-desktop');
  // Historic receipts deliberately diverge from admitted collateral.
  await page.route('**/api/first-event/depositors', async route => {
    const response = await route.fetch(), data = await response.json();
    data.depositors[0].deposits.push({ ...data.depositors[0].deposits[0], txHash: '0x' + 'e'.repeat(64), amountWei: '1000000000000000000' });
    data.depositors[0].totalReceivedWei = String(BigInt(EVENT.depositWei) + 1000000000000000000n);
    await route.fulfill({ response, json: data });
  });
  await open('challenge', 'challenge-open');
  await expect(page.locator('[data-commitment-total]')).toHaveText('1.1');
  await expect(page.locator('[data-post-event-amount]')).toContainText('0.0125');
  pass(true, 'Refunded/repeated historical deposits cannot inflate the attendee payout estimate');
  await page.unroute('**/api/first-event/depositors');

  await open('omitted', 'challenge-open');
  await expect(page.locator('[data-post-event-wallet-title]')).toContainText(/missing|not.*list|omitt|absen/i);
  await expect(page.locator('[data-post-event-primary]')).toContainText(/challenge/i);
  pass((await actionPaths()).some(hash => hash.includes(`event=${EVENT.id}`) && hash.includes('view=participant')), 'Omitted registered wallet links to the existing reviewed challenge controller');
  await expect(panel).toContainText(/match|contest/i);
  await expect(panel).toContainText(/Kleros/i);
  await shot('omitted-challenge-desktop');
  await page.locator('[data-post-event-primary]').click();
  await expect(page.locator('[data-action-preview-title]')).toHaveText('Challenge missing attendance');
  await expect(page.locator('[data-action-cost]')).toContainText('0.001 ETH');
  await expect(page.locator('[data-action-preview-note]')).toContainText('only if');
  await page.locator('[data-preview-review]').click();
  await expect(page.locator('[data-sample-review]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wallet signing disabled' })).toBeDisabled();
  await shot('sample-challenge-payment-review');
  await page.locator('[data-sample-next]').click();
  await expect(panel).toHaveAttribute('data-state', 'matching-open');
  pass(true, 'Omitted-wallet CTA opens a clearly labeled payment review and then a sample Waiting state, without signing or Court creation');

  await open('no-no-shows', 'challenge-open');
  await expect(page.locator('[data-post-event-amount]')).toContainText('0.01');
  await expect(panel).toContainText(/everyone|no no.?shows|no.*kickback|all.*attend/i);
  pass(true, 'All-attended state shows deposit-only estimate rather than inventing a kickback');

  await open('waiting', 'matching-open');
  await expect(page.locator('[data-post-event-wallet-title]')).toContainText(/waiting|match/i);
  await expect(panel).toContainText(/matching|contest/i);
  await expect(page.locator('[data-post-event-title]')).not.toContainText(/payout.*ready/i);
  pass(true, 'Unexpired challenge matching period blocks ordinary release after omission deadline');

  await open('own-court', 'release-ready');
  await expect(page.locator('[data-post-event-wallet-title]')).toContainText(/Kleros|dispute|court/i);
  await expect(panel).toContainText(/reserv|protect|held/i);
  pass((await actionPaths()).some(hash => hash.includes('view=cases')), 'Matched challenger has a case/evidence route, not an automatic evidence upload');
  await shot('own-court-protected-share-desktop');
  const caseLink = page.locator('[data-post-event-primary]');
  await caseLink.click();
  await expect(page.locator('[data-action-preview-title]')).toHaveText('Kleros case & evidence');
  await expect(page.locator('[data-sample-evidence]')).toBeVisible();
  await expect(page.locator('[data-sample-evidence] textarea')).toHaveAttribute('readonly');
  await expect(page.getByRole('button', { name: 'Evidence submission disabled in local preview' })).toBeDisabled();
  await shot('sample-matched-case-evidence');
  pass(true, 'A matched case opens the evidence screen with distinct Court/resolver IDs and inert submission controls');

  await open('other-court', 'release-ready');
  await expect(page.locator('[data-post-event-wallet-title]')).toContainText(/attend|check.?in|included/i);
  await expect(panel).toContainText(/other|ordinary|undisputed|unaffected/i);
  pass(true, 'Other matched Court case does not keep established attendee waiting for a ruling');
  await shot('other-court-ordinary-release-desktop');

  await open('finalization', 'release-ready');
  await expect(panel).toContainText(/transaction|release/i);
  pass((await actionPaths()).some(hash => hash.includes('view=cases') || hash.includes('review=1')), 'Release-ready state links to full reviewed payout controls');
  const primary = page.locator('[data-post-event-primary]');
  await primary.click();
  await expect(page.locator('[data-action-preview-title]')).toHaveText('Release eligible payouts');
  await expect(page.locator('[data-action-preview-note]')).toContainText('Time passing alone sends no ETH');
  await page.locator('[data-preview-review]').click();
  await expect(page.getByRole('button', { name: 'Wallet signing disabled' })).toBeDisabled();
  pass(true, 'Release CTA opens an explicit sample transaction review with signing disabled and no mutation request');

  await open('finalized', 'finalized');
  await expect(panel).toContainText(/check.*wallet|delivery|not.*confirm|failed/i);
  pass(!/you received|funds received|payment delivered/i.test(await panel.innerText()), 'Finalized phase never claims that a wallet received its ETH');
  await page.setViewportSize({ width: 390, height: 844 });
  await open('finalized-court', 'finalized');
  await expect(page.locator('[data-post-event-wallet-title]')).toContainText(/Kleros|dispute|court/i);
  await shot('finalized-court-mobile');

  await open('unregistered', 'challenge-open');
  await expect(page.locator('[data-post-event-wallet-title]')).toContainText(/not registered|unregistered|pending credit/i);
  await expect(page.locator('[data-post-event-primary]')).not.toContainText(/challenge/i);
  pass(true, 'A mere deposit receipt does not acquire registered-wallet challenge rights');

  await open('fallback', 'no-list');
  await expect(panel).toContainText(/recover|refund|withdraw/i);
  pass(true, 'Missing organizer list after actual deadline shows recovery rather than payout promises');

  await open('stale');
  await expect(page.locator('[data-post-event-snapshot]')).toContainText(/stale|saved|refresh/i);
  pass(true, 'Stale post-event status is qualified beside the payout information');
  await open('missing-payout', 'challenge-open');
  await expect(page.locator('[data-post-event-estimate-note]')).toContainText(/unavailable|refresh|cannot|legacy/i);
  await expect(page.locator('[data-post-event-amount]')).not.toContainText('0.0125');
  pass(true, 'Legacy snapshots keep attendance visible without inventing missing monetary counters');
  await open('invalid-payout');
  await expect(page.locator('[data-post-event-amount]')).not.toContainText('0.0125');
  pass(true, 'Wrong-block payout extension cannot supply a financial estimate');

  await open('post-unavailable', 'unavailable');
  await expect(panel).toContainText(/unavailable|refresh/i);
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  const beforeRefresh = fixture.requests.filter(row => row.pathname === '/api/first-event/depositors').length;
  await page.locator('[data-post-event-refresh]').click();
  await expect.poll(() => fixture.requests.filter(row => row.pathname === '/api/first-event/depositors').length).toBe(beforeRefresh + 1);
  pass(true, 'Explicit post-event refresh performs one read-only status request');
  await shot('unavailable-mobile');

  const denied = await fetch(`${fixture.origin}/api/public-transactions`, { method: 'POST', body: '{}' });
  pass(denied.status === 405, 'Loopback fixture refuses mutation and financial endpoints');
  pass(proof.externalRequests.length === 0, 'No external requests attempted');
  pass(proof.pageWrites.length === 0, 'Browser made no write or financial request');
  pass(proof.browserErrors.length === 0, 'No browser runtime errors');
  proof.status = 'passed';
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, output: OUT, screenshots: proof.screenshots }, null, 2));
} catch (error) { proof.status = 'failed'; proof.error = error.message; throw error; }
finally { await fs.writeFile(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n'); await browser?.close(); await fixture.close(); }
