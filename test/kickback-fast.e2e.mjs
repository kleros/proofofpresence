// Actual Chromium -> local production server -> PGlite display -> protected V10 CREATE.
// Every browser request stays on the synthetic fixture origin; no public chain or signing file.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { createFirstEventPostgres } from '../src/first-event-postgres.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'artifacts/kickback-fast', new Date().toISOString().replace(/[:.]/g, '-'));
const sha = value => createHash('sha256').update(value).digest('hex');
await fs.mkdir(OUT, { recursive: true });
const proof = { kind: 'actual-local-kickback-fast', status: 'running', checks: [], screenshots: [], source: {}, http: [], walletCalls: [], errors: [], blocked: [],
  limits: ['Synthetic local chain1 and actual PGlite SQL only; existing fixture mocks external Court runtime and adjudication.', 'Actual Ethereum, hosted auth and production event creation were not executed. Keys stay in the existing Node-only disposable fixture.'], publicNetworkRequests: 0, privateSigningFilesRead: 0 };
const pass = (condition, label) => { assert(condition, label); proof.checks.push(label); };
let fixture, browser, page, db, releaseReview;
try {
  for (const name of ['src/server.mjs', 'src/workbench.mjs', 'src/kickback-display.mjs', 'src/first-event-postgres.mjs', 'public/app.js', 'public/luma-setup.js', 'public/transaction-context.js', 'public/v10-wallet-account.js'])
    proof.source[name] = sha(await fs.readFile(path.join(ROOT, name)));
  const original = await fs.readFile(path.join(ROOT, 'test/fixtures/v10-metamask-app-fixture.mjs'), 'utf8');
  // The copied harness adds only an injected SQL store and bootstrap observations.
  // All wallet/account/source/nonce/creation/sender algorithms remain the original fixture.
  const replacements = [
    ['Object.keys(options).every((key) => key === "origin"),', 'Object.keys(options).every((key) => ["origin", "firstEventStore"].includes(key)),'],
    ['      {\n        workbenchFactory: async (options) => {', '      {\n        firstEventStore: options.firstEventStore,\n        workbenchFactory: async (options) => {'],
    ['          return w;\n', '          stats.bootstrapCalls ??= [];\n          const originalBootstrap = w.bootstrap.bind(w);\n          w.bootstrap = (...args) => { stats.bootstrapCalls.push({ wallet: args[0]?.wallet ?? null, options: structuredClone(args[1] ?? {}) }); return originalBootstrap(...args); };\n          return w;\n'],
  ];
  let adapted = original.replaceAll('../../', pathToFileURL(ROOT).href);
  for (const [before, after] of replacements) { assert(adapted.includes(before), 'Fixture adaptation anchor changed'); adapted = adapted.replace(before, after); }
  const fixtureFile = path.join(OUT, 'synthetic-v10-sql-fixture.mjs');
  await fs.writeFile(fixtureFile, adapted);
  proof.fixture = { originalSha256: sha(original), adaptedSha256: sha(adapted), adaptation: 'Absolute original imports; explicit injected SQL store; record calls to unchanged bootstrap implementation.' };
  const { createV10MetaMaskAppFixture } = await import(pathToFileURL(fixtureFile).href);
  db = new PGlite();
  const store = createFirstEventPostgres({ pool: { query: (sql, values) => db.query(sql, values), connect() { throw Error('No display lease is needed for setup metadata.'); } } });
  fixture = await createV10MetaMaskAppFixture({ firstEventStore: store });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block' });
  let readGate = 'deny', heldReview = false, freshFactoryDelivered = false;
  const readAttempts = [], setupReplies = [], organizerRequests = [];
  const reviewReady = new Promise(resolve => { releaseReview = resolve; });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname, method = request.method();
    if (url.origin !== fixture.origin) { proof.publicNetworkRequests++; proof.blocked.push({ method, pathname }); return route.abort(); }
    try {
      const isRead = pathname === '/api/bootstrap' || (pathname === '/api/event-read-jobs' && method === 'POST');
      const input = method === 'POST' && request.postData() ? request.postDataJSON() : null;
      if (isRead) {
        readAttempts.push({ method, pathname, input });
        if (readGate === 'deny') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SYNTHETIC_FRESH_READ_UNAVAILABLE', error: 'Fresh reads are unavailable in this test stage.' }) });
        if (readGate === 'hold') {
          assert.equal(pathname, '/api/event-read-jobs');
          assert.equal(input.operation, 'bootstrap');
          assert.equal(input.selectedEventId, null);
          assert.equal(input.factoryOnly, true);
          heldReview = true;
          await reviewReady;
        }
      }
      if (pathname === '/api/organizer/events/jobs' && method === 'POST') {
        assert(freshFactoryDelivered, 'Organizer operation must follow the fresh factory result');
        organizerRequests.push(input.operation);
      }
      const beforeReads = fixture.stats.providerReads;
      const response = await fixture.forward(pathname + url.search, { method, headers: request.headers(), body: request.postDataBuffer() ?? undefined });
      proof.http.push({ method, pathname, status: response.status, backendRpcReads: fixture.stats.providerReads - beforeReads });
      if (response.headers['content-type']?.startsWith('application/json')) {
        const value = JSON.parse(response.body.toString());
        if (pathname === '/api/kickback-setup') {
          setupReplies.push(value);
          assert.equal(fixture.stats.providerReads, beforeReads, 'Setup display GET must not read blockchain');
        }
        if (value.kind === 'event-read-job' && value.operation === 'bootstrap' && value.eventId === undefined && value.state === 'ready') {
          assert.equal(value.result.factory.verified, true);
          assert.equal(value.result.capabilities.createEvents, true);
          assert.equal(value.result.events.length, 0);
          freshFactoryDelivered = true;
        }
      }
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !['connection', 'transfer-encoding', 'content-length', 'date'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]));
      await route.fulfill({ status: response.status, headers, body: response.body });
    } catch (error) { proof.errors.push({ stage: 'route', method, pathname, message: error.message }); await route.abort(); }
  });
  page = await context.newPage();
  page.on('pageerror', error => proof.errors.push({ stage: 'browser', message: error.message }));
  await page.exposeBinding('__localWallet', ({ page: caller, frame }, request) => {
    assert.equal(caller, page); assert.equal(frame, page.mainFrame());
    proof.walletCalls.push({ method: request.method });
    return fixture.wallet(request, page.url());
  });
  await page.addInitScript(() => { window.ethereum = { request: request => window.__localWallet(request), on() {}, removeListener() {}, isMetaMask: true }; });
  const screenshot = async name => { await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }); proof.screenshots.push(name + '.png'); };
  const beforePage = { rpc: fixture.stats.providerReads, bootstrap: fixture.stats.bootstrapCalls.length };
  const openedAt = Date.now();
  await page.goto(fixture.origin + '/#setup=kickback');
  await expect(page.locator('#luma-setup h1')).toHaveText('Set up kickback.');
  await expect(page.locator('#luma-setup [data-connect-wallet]')).toBeVisible();
  await expect(page.locator('[data-luma-setup-deferred]')).toBeVisible();
  pass(readAttempts.length === 0 && fixture.stats.providerReads === beforePage.rpc && fixture.stats.bootstrapCalls.length === beforePage.bootstrap && proof.walletCalls.length === 0,
    'Setup heading and Connect render from actual SQL with zero event/factory/bootstrap RPC or wallet calls');
  proof.localRenderMs = Date.now() - openedAt;
  assert(setupReplies.length === 1 && setupReplies[0].factory.verified === false && setupReplies[0].capabilities.createEvents === false && setupReplies[0].capabilities.transactionsReady === false);
  pass(true, 'Saved setup response explicitly carries no verified factory or transaction/create authority');
  await screenshot('setup-before-connect');
  const beforeConnect = { reads: readAttempts.length, bootstrap: fixture.stats.bootstrapCalls.length, sends: fixture.stats.walletRequests };
  await page.locator('#luma-setup [data-connect-wallet]').click();
  await expect(page.locator('[data-luma-form]')).toBeVisible({ timeout: 30000 });
  pass(setupReplies.length === 2 && setupReplies[1].session.wallet === fixture.organizerAddress && readAttempts.length === beforeConnect.reads && fixture.stats.bootstrapCalls.length === beforeConnect.bootstrap && fixture.stats.walletRequests === beforeConnect.sends,
    'Nonce-authenticated setup Connect opens the form using SQL only, without event/factory bootstrap or transaction request');
  await expect(page.locator('[data-luma-action="review"]')).toBeEnabled();
  await screenshot('setup-connected');
  const now = (await fixture.provider.getBlock('latest')).timestamp, start = Math.ceil((now + 3600) / 60) * 60;
  for (const [selector, value] of [['#luma-title', 'Synthetic fast setup QA'], ['#luma-url', 'https://luma.com/synthetic-fast-setup-qa'], ['#luma-start', new Date(start * 1000).toISOString().slice(0, 16)], ['#luma-end', new Date((start + 7200) * 1000).toISOString().slice(0, 16)], ['#luma-deposit', '0.01']]) await page.locator(selector).fill(value);
  readGate = 'hold';
  await page.locator('[data-luma-action="review"]').click();
  await expect.poll(() => heldReview).toBe(true);
  await expect(page.locator('[data-luma-progress-host]')).toBeVisible();
  await expect(page.locator('[data-setup-phase="preparing"]')).toBeVisible();
  await expect(page.locator('dialog[data-luma-dialog]')).not.toBeVisible();
  pass(organizerRequests.length === 0 && fixture.stats.walletRequests === 0 && fixture.stats.bootstrapCalls.length === beforeConnect.bootstrap,
    'Explicit Review shows preparing progress while fresh factory verification is withheld; no organizer draft or wallet transaction starts');
  await screenshot('setup-review-fresh-check-held');
  readGate = 'allow'; releaseReview();
  await expect(page.locator('dialog[data-luma-dialog]')).toBeVisible({ timeout: 60000 });
  const draft = fixture.reviewedDraft();
  assert.equal(draft.scopeKind, 'factory-create'); assert.equal(draft.transaction.to, fixture.manifest.factoryDeployment.factory);
  assert.equal(draft.transaction.value, '0');
  pass(freshFactoryDelivered && fixture.stats.bootstrapCalls.length === beforeConnect.bootstrap + 1 && fixture.stats.bootstrapCalls.at(-1).options.factoryOnly === true && organizerRequests.includes('prepare') && fixture.stats.walletRequests === 0,
    'Only a fresh verified factory-only result unlocks the original scoped organizer review, with no event inventory or pre-confirm send');
  await expect(page.locator('dialog[data-luma-dialog]')).toContainText('0.01 ETH');
  await screenshot('setup-authoritative-review');
  fixture.armCreation(draft.id);
  await page.locator('[data-luma-action="confirm"]').click();
  await expect(page.locator('[data-luma-created]')).toBeVisible({ timeout: 60000 });
  const created = fixture.savedState().events.find(event => event.eventId === draft.eventId);
  pass(fixture.stats.walletRequests === 1 && created?.deployment?.contract && fixture.stats.sent[0].draftId === draft.id,
    'Explicit confirmation runs the unchanged guarded sender once and returns an actual locally created V10 deposit page');
  await screenshot('setup-created');

  // Reconnect from a real owner view containing a synthetic private contact canary.
  const record = fixture.workbench().events.get(draft.eventId);
  record.participants.set('synthetic-private-canary', { id: 'synthetic-private-canary', eventId: draft.eventId, wallet: fixture.organizerAddress,
    name: 'Synthetic private contact canary', email: 'private-canary@example.test', identityVerified: true, identitySource: 'synthetic-local-fixture', admission: 'pending', deposit: null });
  await page.goto(fixture.origin + '/#' + new URLSearchParams({ event: draft.eventId, view: 'organizer', review: '1' }));
  await expect(page.locator('#content')).toContainText('Synthetic fast setup QA', { timeout: 60000 });
  await expect(page.locator('#content')).toContainText('Synthetic private contact canary');
  const beforeReconnect = { reads: readAttempts.length, bootstrap: fixture.stats.bootstrapCalls.length, sends: fixture.stats.walletRequests };
  readGate = 'deny';
  await page.locator('#top-identity').click();
  await page.locator('#review-dialog [data-connect-wallet]').click();
  await expect(page.locator('#content h1')).toHaveText('Wallet connected', { timeout: 30000 });
  await expect(page.locator('#review-dialog')).not.toBeVisible();
  await expect(page.locator('#content [data-reload]')).toHaveText('Manage event');
  const visibleShell = await page.locator('body').textContent();
  pass(readAttempts.length === beforeReconnect.reads && fixture.stats.bootstrapCalls.length === beforeReconnect.bootstrap && fixture.stats.walletRequests === beforeReconnect.sends,
    'Full-app reconnect ends at authentication ACK with no event/factory read or extra transaction');
  pass(!visibleShell.includes('private-canary@example.test') && !visibleShell.includes('Synthetic private contact canary') && !visibleShell.includes('Synthetic fast setup QA') && await page.locator('#content [data-tx],#content [data-form],#content [data-admission]').count() === 0,
    'Connected shell removes the prior event title, private contact data and organizer/payment controls before offering explicit Manage event');
  await screenshot('full-app-authenticated-shell');
  await page.locator('#content [data-reload]').click();
  await expect.poll(() => readAttempts.length).toBeGreaterThan(beforeReconnect.reads);
  pass(fixture.stats.walletRequests === 1, 'Continuing from the auth-only shell requires a new event read and cannot send a transaction when that read is unavailable');
  proof.transport = { setupGets: setupReplies.length, readAttempts, organizerRequests, bootstrapCalls: fixture.stats.bootstrapCalls };
  proof.creation = { eventId: draft.eventId, contract: created.deployment.contract, hash: fixture.stats.sent[0].hash, walletRequests: fixture.stats.walletRequests };
  pass(proof.publicNetworkRequests === 0 && fixture.stats.publicNetworkRequests === 0 && fixture.stats.backendSigningCalls === 0 && proof.errors.length === 0,
    'All acceptance remains on actual local SQL/local chain, with no public network, backend signing or browser/route errors');
  proof.status = 'passed';
} catch (error) {
  proof.status = 'failed'; proof.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (page) { proof.visibleStatus = await page.locator('body').textContent().catch(() => null); await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {}); }
} finally {
  releaseReview?.(); await browser?.close(); await fixture?.close(); await db?.close();
  await fs.writeFile(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, 'proof.json'), failure: proof.failure?.message }));
}
