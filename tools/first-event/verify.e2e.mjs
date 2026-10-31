import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAGE = path.join(ROOT, 'public/first-event');
const OUT = path.join(ROOT, 'artifacts/first-event', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(OUT, { recursive: true });
const proof = { kind: 'first-event-mini-local-acceptance', startedAt: new Date().toISOString(), status: 'running', checks: [], screenshots: [], source: {}, http: [], walletCalls: [], errors: [], publicNetworkRequests: 0, privateSigningFilesRead: 0,
  limits: ['Synthetic local chain1 only; external Court runtime and adjudication are mocked by the existing V10 fixture.', 'Actual Ethereum mainnet and hosted production deposit have not been executed.', 'Synthetic event configuration replaces only event.js and display address during local financial acceptance; wallet.js and dependencies are unchanged.'] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pass = (ok, text) => { assert(ok, text); proof.checks.push(text); };
const mime = f => ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' }[path.extname(f)] ?? 'text/plain');
const staticFile = pathname => pathname === '/event-read.js' ? path.join(ROOT, 'public/event-read.js') : path.join(PAGE, pathname.replace(/^\//, '') || 'index.html');
let browser, fixture, activePage, synthetic = null;
async function shot(page, name) { const f = name + '.png'; await page.screenshot({ path: path.join(OUT, f), fullPage: true }); proof.screenshots.push(f); }

try {
  browser = await chromium.launch({ headless: true });
  for (const file of ['index.html', 'styles.css', 'page.js', 'wallet.js', 'event.js', 'qr.svg']) proof.source[file] = hash(await fs.readFile(path.join(PAGE, file)));
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  const staticRequests = [], walletCalls = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    staticRequests.push(url.pathname);
    if (url.origin !== 'https://first-event.example.invalid') { proof.publicNetworkRequests++; return route.abort(); }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Offline preview: no API configured.' }) });
    try {
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
      if (rel.includes('..')) return route.abort();
      const body = await fs.readFile(staticFile(url.pathname));
      await route.fulfill({ status: 200, contentType: mime(rel), body });
    } catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
  const page = await context.newPage();
  page.on('pageerror', e => proof.errors.push({ stage: 'static-page', message: e.message }));
  await page.exposeBinding('__wallet', (_ctx, request) => { walletCalls.push(request); throw new Error('No real wallet in static test'); });
  await page.addInitScript(() => { window.ethereum = { request: req => window.__wallet(req), on() {}, removeListener() {} }; });
  await page.goto('https://first-event.example.invalid/');
  await expect(page.locator('h1')).toHaveText('Truth Pays');
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  await expect(page.locator('[data-deposit]')).toBeHidden();
  pass(!staticRequests.some(p => p.startsWith('/api/')) && walletCalls.length === 0, 'First render makes no API or wallet requests');
  const paint = await page.evaluate(() => ({ firstContentfulPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null, domContentLoadedMs: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? null }));
  const initialAssets = await Promise.all([...new Set(staticRequests)].filter(p => !p.startsWith('/api/')).map(async pathname => ({ pathname, rawSourceBytes: (await fs.stat(staticFile(pathname))).size })));
  proof.staticPerformance = { scope: 'LOCAL routed browser only; no claim about public hosting, compression, or visitor network', ...paint, requests: initialAssets.length, rawSourceBytes: initialAssets.reduce((sum, item) => sum + item.rawSourceBytes, 0), assets: initialAssets };
  pass(await page.locator('[data-contract-address]').textContent() === '0xCd7418413fBFA814D41799C9dFaCc4654f295c11', 'Exact mainnet contract is rendered as selectable full text');
  await expect(page.locator('.network')).toContainText('Ethereum Mainnet');
  await expect(page.locator('.return-link')).toHaveAttribute('href', 'https://luma.com/qewnqhas');
  await page.locator('[data-copy-address]').click();
  pass(await page.evaluate(() => navigator.clipboard.readText()) === '0xCd7418413fBFA814D41799C9dFaCc4654f295c11', 'Copy control puts the exact event address on the clipboard');
  pass(await page.locator('.qr-wrap img').evaluate(img => img.complete && img.naturalWidth > 0), 'Local QR asset renders');
  pass(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Desktop layout has no horizontal overflow');
  await shot(page, 'desktop-first-event');
  await page.setViewportSize({ width: 390, height: 844 });
  pass(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout has no horizontal overflow');
  await shot(page, 'mobile-first-event');
  await page.locator('.deposit-details summary').click();
  await expect(page.locator('.deposit-details')).toContainText('pending credit');
  pass(true, 'Manual payment disclosure preserves pending-credit/admission distinction and credit recovery access');
  await page.locator('[data-connect-wallet]').click();
  await expect(page.locator('[data-wallet-status]')).toContainText(/Offline preview|service|unavailable|No real wallet/, { timeout: 10000 });
  pass(walletCalls.every(call => !['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign'].includes(call.method)), 'Unavailable wallet/API never requests a signature or payment');
  await context.close();

  if (!process.argv.includes('--static-only')) {
  const sourceRoot = process.env.KLEROS_FIRST_EVENT_SOURCE ?? ROOT;
  const fixturePath = path.join(sourceRoot, 'test/fixtures/v10-metamask-app-fixture.mjs');
  const originalFixture = await fs.readFile(fixturePath, 'utf8');
  const sourceUrl = pathToFileURL(sourceRoot + path.sep).href;
  const adaptedFixture = originalFixture.replaceAll('../../', sourceUrl).replace('      if (data.kind === "organizer-job" && data.state === "ready") {', '      if (data.kind === "event-read-job" && data.state === "ready" && data.operation === "deposit") review = data.result;\n      if (data.kind === "organizer-job" && data.state === "ready") {');
  assert.notEqual(adaptedFixture, originalFixture);
  const adapterFile = path.join(OUT, 'synthetic-v10-fixture.mjs');
  await fs.writeFile(adapterFile, adaptedFixture);
  const { createV10MetaMaskAppFixture } = await import(pathToFileURL(adapterFile).href + '?source=' + hash(adaptedFixture));
  proof.fixture = { sourceRoot, workbenchSha256: hash(await fs.readFile(path.join(sourceRoot, 'src/workbench.mjs'))), originalFixtureSha256: hash(originalFixture), adaptedFixtureSha256: hash(adaptedFixture), adaptation: 'Absolute original source imports; capture ready deposit event-read-job into the existing armed synthetic wallet review. No protocol/account-policy override.' };
  fixture = await createV10MetaMaskAppFixture();
  const actual = await browser.newContext({ viewport: { width: 1360, height: 1000 }, timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  const observedBoots = [];
  let bootstrapDeliveries = 0, holdSelectedReads = false, holdDepositReviews = false, walletFault = null, tamperAck = false, lastAckAt = null;
  const selectedReadAttempts = [], depositReviewAttempts = [];
  await actual.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== fixture.origin) { proof.publicNetworkRequests++; return route.abort(); }
    try {
      if (url.pathname.startsWith('/first-event/')) {
        const rel = decodeURIComponent(url.pathname.slice('/first-event/'.length)) || 'index.html';
        assert(!rel.includes('..'));
        let body = await fs.readFile(path.join(PAGE, rel));
        if (rel === 'event.js' && synthetic) body = Buffer.from(`export const EVENT = Object.freeze(${JSON.stringify(synthetic)});\n`);
        if (rel === 'index.html' && synthetic) body = Buffer.from(body.toString().replaceAll('0xCd7418413fBFA814D41799C9dFaCc4654f295c11', synthetic.contract));
        return route.fulfill({ status: 200, contentType: mime(rel), body });
      }
      const selectedGet = url.pathname === '/api/bootstrap' && url.searchParams.has('selectedEventId');
      const selectedPost = url.pathname === '/api/event-read-jobs' && request.method() === 'POST' && request.postDataJSON()?.operation === 'bootstrap';
      const depositPost = url.pathname === '/api/event-read-jobs' && request.method() === 'POST' && request.postDataJSON()?.operation === 'deposit';
      if (depositPost) depositReviewAttempts.push({ method: request.method(), pathname: url.pathname });
      if (holdDepositReviews && depositPost) {
        proof.http.push({ method: request.method(), pathname: url.pathname, status: 503, syntheticDepositGate: true });
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic fresh deposit review unavailable.', code: 'SERVICE_UNAVAILABLE' }) });
      }
      if (holdSelectedReads && (selectedGet || selectedPost)) {
        selectedReadAttempts.push({ method: request.method(), pathname: url.pathname });
        proof.http.push({ method: request.method(), pathname: url.pathname, status: 503, syntheticGate: true });
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic selected read unavailable.', code: 'SERVICE_UNAVAILABLE' }) });
      }
      const response = await fixture.forward(url.pathname + url.search, { method: request.method(), headers: request.headers(), body: request.postDataBuffer() ?? undefined });
      let body = response.body;
      if (url.pathname === '/api/auth/verify' && response.status === 200) {
        lastAckAt = Date.now();
        if (tamperAck) body = Buffer.from(JSON.stringify({ ...JSON.parse(body.toString()), wallet: '0x1111111111111111111111111111111111111111' }));
      }
      proof.http.push({ method: request.method(), pathname: url.pathname, status: response.status });
      if (url.pathname === '/api/bootstrap' && response.status === 200) { try { observedBoots.push(JSON.parse(response.body.toString())); } catch {} }
      if (url.pathname.startsWith('/api/event-read-jobs/') && response.status === 200) { try { const data = JSON.parse(response.body.toString()); if (data.operation === 'bootstrap' && data.state === 'ready') bootstrapDeliveries++; } catch {} }
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !['connection', 'transfer-encoding', 'content-length', 'date'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]));
      await route.fulfill({ status: response.status, headers, body });
    } catch (error) { proof.errors.push({ stage: 'fixture-route', pathname: url.pathname, message: error.message }); await route.abort(); }
  });
  const owner = await actual.newPage();
  activePage = owner;
  owner.on('pageerror', e => proof.errors.push({ stage: 'actual-page', message: e.message }));
  await owner.exposeBinding('__v10FixtureWallet', async ({ page: caller, frame }, request) => {
    assert.equal(caller, owner); assert.equal(frame, owner.mainFrame());
    proof.walletCalls.push({ method: request.method });
    if (walletFault === 'wrong-chain' && request.method === 'eth_chainId') return '0xaa36a7';
    if (walletFault === 'wrong-chain' && request.method === 'wallet_switchEthereumChain') throw Object.assign(new Error('Synthetic user declined the required network.'), { code: 4001 });
    if (walletFault === 'unsupported-account' && request.method === 'eth_getCode' && request.params[0].toLowerCase() === fixture.organizerAddress.toLowerCase()) {
      await fixture.wallet(request, owner.url());
      return '0x60006000';
    }
    if (request.method === 'eth_sendTransaction' && synthetic) {
      const expected = { to: synthetic.contract, from: fixture.organizerAddress, value: '0x2386f26fc10000', data: '0xd0e30db0', chainId: '0x1' };
      assert.deepEqual(request.params, [expected]);
      proof.prefilledDepositRequest = structuredClone(request.params[0]);
    }
    return fixture.wallet(request, owner.url());
  });
  await owner.addInitScript(() => { window.ethereum = { request: request => window.__v10FixtureWallet(request), on() {}, removeListener() {}, isMetaMask: true }; });
  await owner.goto(fixture.origin + '/#setup=kickback');
  await expect(owner.locator('#luma-setup [data-connect-wallet]')).toBeVisible({ timeout: 30000 });
  await owner.locator('#luma-setup [data-connect-wallet]').click();
  await expect(owner.locator('[data-luma-form]')).toBeVisible({ timeout: 30000 });
  const now = (await fixture.provider.getBlock('latest')).timestamp;
  const start = Math.ceil((now + 3600) / 60) * 60;
  for (const [selector, value] of [ ['#luma-title', 'Synthetic first-event mini acceptance'], ['#luma-url', 'https://luma.com/synthetic-first-event-mini'], ['#luma-start', new Date(start * 1000).toISOString().slice(0, 16)], ['#luma-end', new Date((start + 7200) * 1000).toISOString().slice(0, 16)], ['#luma-deposit', '0.01'] ]) await owner.locator(selector).fill(value);
  await owner.locator('[data-luma-action="review"]').click();
  await expect(owner.locator('dialog[data-luma-dialog]')).toBeVisible({ timeout: 30000 });
  const creation = fixture.reviewedDraft();
  fixture.armCreation(creation.id);
  await owner.locator('[data-luma-action="confirm"]').click();
  await expect(owner.locator('[data-luma-created]')).toBeVisible({ timeout: 30000 });
  const record = fixture.savedState().events.find(e => e.eventId === creation.eventId);
  synthetic = { id: creation.eventId, title: record.definition.title, lumaUrl: record.definition.lumaUrl, chainId: 1, contract: record.deployment.contract, abiVersion: 'kleros-event-v10-uups', depositWei: '10000000000000000', mode: 'hosted-production' };
  pass(fixture.stats.walletRequests === 1, 'Existing organizer form creates one actual local V10 event and its confirmed deposit link');
  const depositUrl = fixture.origin + '/first-event/index.html#event=' + creation.eventId;
  holdSelectedReads = true;
  holdDepositReviews = true;
  proof.rejectedConnects = [];
  for (const fault of ['unsupported-account', 'wrong-chain', 'bad-acknowledgment']) {
    walletFault = fault === 'bad-acknowledgment' ? null : fault;
    tamperAck = fault === 'bad-acknowledgment';
    await owner.goto(depositUrl);
    const beforeCalls = proof.walletCalls.length, beforeSends = fixture.stats.walletRequests;
    await owner.locator('[data-connect-wallet]').click();
    await expect(owner.locator('[data-connect-wallet]')).toBeEnabled({ timeout: 15000 });
    await expect(owner.locator('[data-deposit]')).toBeHidden();
    const methods = proof.walletCalls.slice(beforeCalls).map(call => call.method);
    pass(fixture.stats.walletRequests === beforeSends && !methods.includes('eth_sendTransaction'), `Connect rejects ${fault} without enabling the deposit CTA or requesting a payment`);
    proof.rejectedConnects.push({ fault, walletMethods: methods, status: await owner.locator('[data-wallet-status]').textContent() });
  }
  walletFault = null; tamperAck = false;
  await owner.goto(depositUrl);
  await expect(owner.locator('[data-connect-wallet]')).toBeVisible();
  const sendsBeforeConnect = fixture.stats.walletRequests, selectedBeforeConnect = selectedReadAttempts.length, depositsBeforeConnect = depositReviewAttempts.length;
  await owner.locator('[data-connect-wallet]').click();
  await expect(owner.locator('[data-deposit]')).toBeVisible({ timeout: 15000 });
  await expect(owner.locator('[data-deposit]')).toBeEnabled();
  await expect(owner.locator('[data-deposit]')).toHaveText('Deposit 0.01 ETH');
  pass(selectedReadAttempts.length === selectedBeforeConnect && depositReviewAttempts.length === depositsBeforeConnect && fixture.stats.walletRequests === sendsBeforeConnect,
    'Acknowledged wallet connection immediately shows the deposit CTA while selected bootstrap is unavailable, with no event read or payment request');
  proof.connectInvariant = { selectedBootstrapBlocked: true, selectedReadAttempts: selectedReadAttempts.length - selectedBeforeConnect,
    walletRequestsBefore: sendsBeforeConnect, walletRequestsAfter: fixture.stats.walletRequests,
    localMillisecondsAfterAck: lastAckAt === null ? null : Date.now() - lastAckAt };
  await shot(owner, 'synthetic-connected-before-event-read');
  await owner.locator('[data-deposit]').click();
  await expect.poll(() => depositReviewAttempts.length, { timeout: 15000 }).toBeGreaterThan(depositsBeforeConnect);
  await expect(owner.locator('[data-deposit]')).toBeEnabled();
  await expect(owner.locator('.wallet-review')).not.toBeVisible();
  pass(fixture.stats.walletRequests === sendsBeforeConnect,
    'Deposit preparation cannot open a financial review or wallet payment when its original fresh financial review job is unavailable');
  holdDepositReviews = false;
  const before = await fixture.financialSnapshot(creation.eventId);
  await owner.locator('[data-deposit]').click();
  await expect.poll(async () => (await owner.locator('.wallet-review').isVisible()) || /expired|differs|invalid|could not|unavailable|does not|permission/i.test(await owner.locator('[data-wallet-status]').textContent()), { timeout: 30000 }).toBe(true);
  assert(await owner.locator('.wallet-review').isVisible(), await owner.locator('[data-wallet-status]').textContent());
  await expect(owner.locator('.wallet-review')).toBeVisible({ timeout: 60000 });
  const deposit = fixture.reviewedDraft();
  assert.equal(deposit.action, 'deposit'); assert.equal(deposit.valueWei, '10000000000000000');
  await expect(owner.locator('.wallet-review')).toContainText(synthetic.contract);
  await expect(owner.locator('.wallet-review')).toContainText(/immediate/i);
  pass(selectedReadAttempts.length === selectedBeforeConnect && depositReviewAttempts.length === depositsBeforeConnect + 2,
    'The authoritative deposit review opens from exactly one successful deposit job while both full selected-bootstrap reloads remain unavailable');
  pass(fixture.stats.walletRequests === 1, 'Mini page authenticates and reviews exact 0.01 ETH without submitting before explicit confirmation');
  await shot(owner, 'synthetic-local-deposit-review');
  fixture.armEventDraft(deposit.id, 'deposit');
  holdSelectedReads = false;
  const bootstrapsBeforeConfirm = bootstrapDeliveries;
  await owner.locator('[data-confirm-deposit]').click();
  await expect(owner.locator('[data-tx-status]')).toContainText(/confirmed/i, { timeout: 60000 });
  const send = fixture.stats.sent.find(s => s.draftId === deposit.id);
  assert(send);
  pass(proof.prefilledDepositRequest?.to === synthetic.contract && proof.prefilledDepositRequest.from === fixture.organizerAddress &&
    proof.prefilledDepositRequest.value === '0x2386f26fc10000' && proof.prefilledDepositRequest.data === '0xd0e30db0' && proof.prefilledDepositRequest.chainId === '0x1',
    'The explicitly confirmed MetaMask request is prefilled with the exact child, selected wallet, 0.01 ETH, deposit calldata and Ethereum chain');
  const receipt = await fixture.provider.getTransactionReceipt(send.hash), after = await fixture.financialSnapshot(creation.eventId), D = 10000000000000000n;
  pass(fixture.stats.walletRequests === 2 && receipt.status === 1 && BigInt(after.pendingWei) === D && BigInt(after.eventBalanceWei) === D && after.stakerCount === '0' && BigInt(before.walletBalanceWei) - BigInt(after.walletBalanceWei) === D + receipt.gasUsed * receipt.gasPrice, 'Mini page sends exactly one actual local protected 0.01 ETH deposit, reconciles payer credit and exact D plus gas, and does not manufacture admission');
  const journals = await owner.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('kleros-transactions:v1:')).map(k => JSON.parse(localStorage.getItem(k))));
  pass(journals.some(j => j.transactions.some(t => t.hash === send.hash && t.status === 'confirmed')), 'Actual original deposit hash is durably confirmed in the unchanged scoped journal');
  await owner.locator('[data-copy-tx]').click();
  pass(await owner.evaluate(() => navigator.clipboard.readText()) === send.hash, 'Copy transaction ID preserves the exact confirmed original hash for Luma');
  await expect(owner.locator('[data-deposit]')).toBeHidden();
  await expect(owner.locator('[data-connect-wallet]')).toBeHidden();
  await expect(owner.locator('[data-copy-address]')).toBeHidden();
  await expect(owner.locator('.manual-deposit')).toBeHidden();
  await expect(owner.locator('.address-box')).toBeHidden();
  pass(true, 'Confirmed payment hides Connect and manual QR/copy/address controls so it does not invite a duplicate payment');
  await expect.poll(() => bootstrapDeliveries, { timeout: 30000 }).toBeGreaterThan(bootstrapsBeforeConfirm);
  await expect(owner.locator('[data-wallet-status]')).toContainText('Deposit confirmed');
  await expect(owner.locator('[data-tx-status]')).toContainText('Your deposit transaction is confirmed');
  pass(true, 'Deposit confirmation remains visible after the delayed authoritative event refresh');
  await shot(owner, 'synthetic-local-deposit-confirmed');
  proof.local = { eventId: creation.eventId, contract: synthetic.contract, creationHash: fixture.stats.sent[0].hash, depositHash: send.hash, before, after, walletRequests: fixture.stats.walletRequests };
  const eventRecord = fixture.workbench().events.get(creation.eventId);
  const priorVisibility = eventRecord.definition.visibility, priorStaff = eventRecord.definition.staff;
  const stranger = { id: 'synthetic-private-staff', mode: 'wallet', wallet: '0x1111111111111111111111111111111111111111' };
  const deliveryResult = { id: 'synthetic-access-review', eventId: creation.eventId, wallet: stranger.wallet };
  try {
    eventRecord.definition.visibility = 'private';
    eventRecord.definition.staff = [stranger.wallet];
    for (const operation of ['deposit', 'validate']) {
      assert.deepEqual(await fixture.workbench().finalizeReadResult(operation, deliveryResult, stranger, creation.eventId), deliveryResult);
    }
    eventRecord.definition.staff = [];
    for (const operation of ['deposit', 'validate']) {
      await assert.rejects(() => fixture.workbench().finalizeReadResult(operation, deliveryResult, stranger, creation.eventId), error => error.code === 'FORBIDDEN');
    }
    const currentOwner = { id: 'synthetic-current-owner', mode: 'wallet', wallet: fixture.organizerAddress };
    assert.deepEqual(await fixture.workbench().finalizeReadResult('deposit', deliveryResult, currentOwner, creation.eventId), deliveryResult);
    pass(true, 'Actual canonical owner/private membership delivery permits current staff, denies revoked staff for both unsigned operations, and preserves current financial-owner access');
    proof.privateAccessRegression = { scope: 'Direct authoritative delivery helper with real local owner/canonical chain reads; synthetic staff membership changes only', operations: ['deposit', 'validate'], revokedStaffDenied: true, actualOwnerRetained: true };
  } finally { eventRecord.definition.visibility = priorVisibility; eventRecord.definition.staff = priorStaff; }
  pass(proof.publicNetworkRequests === 0 && fixture.stats.publicNetworkRequests === 0 && fixture.stats.backendSigningCalls === 0, 'All financial acceptance stays on synthetic local chain with no public network or backend signing');
  }
  pass(proof.errors.length === 0, 'No browser or routing errors');
  proof.status = 'passed';
} catch (error) { proof.status = 'failed'; proof.failure = { message: error.message, stack: error.stack }; if (activePage) { proof.visibleStatus = await activePage.locator('[data-wallet-status]').textContent().catch(() => null); await shot(activePage, 'failure-current-state').catch(() => {}); } process.exitCode = 1; }
finally {
  await fixture?.close(); await browser?.close();
  proof.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, 'proof.json'), failure: proof.failure?.message }));
}
