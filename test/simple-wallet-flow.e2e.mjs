// Actual protected local V10 CREATE + deposit through signature-free public transport.
// Public RPC, real wallets and private signing files are never used.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { createFirstEventPostgres } from '../src/first-event-postgres.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'artifacts/simple-wallet-flow', new Date().toISOString().replace(/[:.]/g, '-'));
const ID = 'event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5', CHILD = '0xCd7418413fBFA814D41799C9dFaCc4654f295c11';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const redactedPath = pathname => pathname.replace(/(\/api\/public-transactions\/)[0-9a-f]{64}(?=\/|$)/g, '$1[flow]');
const mime = file => ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] ?? 'text/plain');
await fs.mkdir(OUT, { recursive: true });
const proof = { kind: 'actual-local-simple-wallet-flow', status: 'running', checks: [], source: {}, screenshots: [], http: [], walletCalls: [], errors: [],
  publicNetworkRequests: 0, privateSigningFilesRead: 0,
  limits: ['Actual protected local chain1 wallet/factory/event and embedded PostgreSQL/PGlite; existing fixture mocks external Court runtime/adjudication.', 'Only trusted synthetic backend event scope and literal frontend event-ID/child configuration are adapted. Financial/account/source/sender algorithms are unchanged.', 'Public display GET is deliberately withheld for the final in-app Manage render check. No production auth, public RPC or real transaction is executed.'] };
const pass = (condition, label) => { assert(condition, label); proof.checks.push(label); };
let fixture, browser, page, db, synthetic = null;
try {
  for (const file of ['src/server.mjs', 'src/workbench.mjs', 'src/public-transactions.mjs', 'public/app.js', 'public/luma-setup.js', 'public/public-transactions.js', 'public/first-event/wallet.js', 'public/transaction-context.js', 'public/v10-wallet-account.js'])
    proof.source[file] = sha(await fs.readFile(path.join(ROOT, file)));
  const original = await fs.readFile(path.join(ROOT, 'test/fixtures/v10-metamask-app-fixture.mjs'), 'utf8');
  const replacements = [
    ['Object.keys(options).every((key) => key === "origin"),', 'Object.keys(options).every((key) => ["origin", "firstEventStore", "firstEventManageScope"].includes(key)),'],
    ['      {\n        workbenchFactory: async (options) => {', '      {\n        firstEventStore: options.firstEventStore,\n        workbenchFactory: async (options) => {'],
    ['            productionRuntime: async () => runtime,', '            productionRuntime: async () => runtime,\n            firstEventManageScope: options.firstEventManageScope,'],
    ['      if (data.kind === "organizer-job" && data.state === "ready") {', '      if (data.kind === "event-read-job" && data.state === "ready" && data.operation === "deposit") review = data.result;\n      if (data.kind === "organizer-job" && data.state === "ready") {'],
  ];
  // Avoid shadowing the fixture options with the server workbench options.
  let adapted = original.replaceAll('../../', pathToFileURL(ROOT).href);
  for (const [before, after] of replacements) { assert(adapted.includes(before), 'Original protected fixture anchor changed'); adapted = adapted.replace(before, after); }
  adapted = adapted.replace('  const { origin = "https://v10-mm-browser.example.invalid" } = options;', '  const fixtureManageScope = options.firstEventManageScope;\n  const { origin = "https://v10-mm-browser.example.invalid" } = options;')
    .replace('firstEventManageScope: options.firstEventManageScope,', 'firstEventManageScope: fixtureManageScope,');
  const fixtureFile = path.join(OUT, 'synthetic-protected-public-fixture.mjs');
  await fs.writeFile(fixtureFile, adapted);
  proof.fixture = { originalSha256: sha(original), adaptedSha256: sha(adapted), adaptation: 'Absolute imports, injected local SQL store, trusted synthetic event scope, capture ready public deposit draft for original arming. No account policy override.' };
  const { createV10MetaMaskAppFixture } = await import(pathToFileURL(fixtureFile).href);
  db = new PGlite();
  const store = createFirstEventPostgres({ pool: { query: (sql, values) => db.query(sql, values), connect() { throw Error('No display index lease needed for setup-only SQL.'); } } });
  const managed = new Map();
  fixture = await createV10MetaMaskAppFixture({ firstEventStore: store,
    firstEventManageScope: record => !!record && managed.get(record.definition.id)?.toLowerCase() === record.deployment.contract.toLowerCase() });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  let badCode = false, blockDepositConfirm = false, withholdDisplay = false, displayRequests = 0;
  const mints = [], resumed = [], publicJobs = [], deniedConfirm = [], setupReplies = [];
  const configured = (body, pathname) => {
    if (!synthetic) return body;
    if (pathname === '/first-event/event.js') return Buffer.from(`export const EVENT = Object.freeze(${JSON.stringify(synthetic)});\n`);
    if (['/public-transactions.js', '/event-read.js', '/entry.js'].includes(pathname))
      return Buffer.from(body.toString().replaceAll(ID, synthetic.id).replaceAll(CHILD, synthetic.contract));
    if (pathname === '/first-event/index.html' || pathname === '/first-event/') return Buffer.from(body.toString().replaceAll(CHILD, synthetic.contract));
    return body;
  };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), pathname = url.pathname;
    if (url.origin !== fixture.origin) { proof.publicNetworkRequests++; return route.abort(); }
    try {
      const input = method === 'POST' && request.postData() ? request.postDataJSON() : null;
      if (pathname === '/api/first-event/depositors' && withholdDisplay) {
        displayRequests++;
        proof.http.push({ method, pathname, status: 503, syntheticGate: true });
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic display intentionally withheld.' }) });
      }
      if (/^\/api\/public-transactions\/[0-9a-f]{64}\/event-read-jobs$/.test(pathname) && input?.operation === 'confirm' && blockDepositConfirm) {
        deniedConfirm.push(input.hash);
        proof.http.push({ method, pathname: redactedPath(pathname), status: 503, operation: 'confirm', syntheticGate: true });
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SYNTHETIC_CONFIRM_UNAVAILABLE', error: 'Synthetic receipt transport unavailable.' }) });
      }
      if (pathname.startsWith('/first-event/')) {
        const rel = decodeURIComponent(pathname.slice('/first-event/'.length)) || 'index.html';
        assert(!rel.includes('..'));
        const body = configured(await fs.readFile(path.join(ROOT, 'public/first-event', rel)), pathname);
        return route.fulfill({ status: 200, contentType: mime(rel), body });
      }
      const response = await fixture.forward(pathname + url.search, { method, headers: request.headers(), body: request.postDataBuffer() ?? undefined });
      proof.http.push({ method, pathname: redactedPath(pathname), status: response.status, ...(input?.operation ? { operation: input.operation } : {}) });
      if (pathname.startsWith('/api/public-transactions')) {
        assert.equal(response.headers['set-cookie'], undefined, 'Public flow must never create a login session');
        if (pathname === '/api/public-transactions' && method === 'POST' && response.status === 201) mints.push(input.kind);
        else if (/^\/api\/public-transactions\/[0-9a-f]{64}$/.test(pathname) && method === 'GET') resumed.push(response.status);
        if (input?.operation) publicJobs.push({ family: pathname.endsWith('/organizer-jobs') ? 'organizer' : 'event', operation: input.operation });
      }
      if (pathname === '/api/kickback-setup' && response.status === 200) setupReplies.push(JSON.parse(response.body));
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !['connection', 'transfer-encoding', 'content-length', 'date'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]));
      await route.fulfill({ status: response.status, headers, body: configured(response.body, pathname) });
    } catch (error) { proof.errors.push({ stage: 'route', pathname: redactedPath(pathname), message: error.message }); await route.abort(); }
  });
  page = await context.newPage();
  page.on('pageerror', error => proof.errors.push({ stage: 'browser', message: error.message }));
  await page.exposeBinding('__localWallet', async ({ page: caller, frame }, request) => {
    assert.equal(caller, page); assert.equal(frame, page.mainFrame());
    proof.walletCalls.push(request.method);
    assert.notEqual(request.method, 'personal_sign', 'Simple public flow never asks for a sign-in signature');
    if (badCode && request.method === 'eth_getCode' && request.params[0].toLowerCase() === fixture.organizerAddress.toLowerCase()) {
      await fixture.wallet(request, page.url()); return '0x60006000';
    }
    if (request.method === 'eth_sendTransaction' && synthetic) {
      const expected = { to: synthetic.contract, from: fixture.organizerAddress, value: '0x2386f26fc10000', data: '0xd0e30db0', chainId: '0x1' };
      assert.deepEqual(request.params, [expected]); proof.depositRequest = expected;
    }
    return fixture.wallet(request, page.url());
  });
  await page.addInitScript(() => { window.ethereum = { request: request => window.__localWallet(request), on() {}, removeListener() {}, isMetaMask: true }; });
  const shot = async name => { await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }); proof.screenshots.push(name + '.png'); };
  const apiCount = () => proof.http.filter(row => row.pathname.startsWith('/api/')).length;
  const simpleConnect = async (selector, ready, label) => {
    const apis = apiCount(), calls = proof.walletCalls.length;
    await page.locator(selector).click(); await expect(page.locator(ready)).toBeVisible();
    assert.deepEqual(proof.walletCalls.slice(calls), ['eth_requestAccounts']);
    pass(apiCount() === apis, `${label} Connect only selects the wallet: exactly eth_requestAccounts, zero API/auth/chain/code/signature calls`);
  };
  await page.goto(fixture.origin + '/#setup=kickback');
  await expect(page.locator('#luma-setup [data-connect-wallet]')).toBeVisible();
  await simpleConnect('#luma-setup [data-connect-wallet]', '[data-luma-form]', 'Setup');
  const now = (await fixture.provider.getBlock('latest')).timestamp, start = Math.ceil((now + 3600) / 60) * 60;
  for (const [selector, value] of [['#luma-title', 'Synthetic signature-free setup'], ['#luma-url', 'https://luma.com/synthetic-signature-free'], ['#luma-start', new Date(start * 1000).toISOString().slice(0, 16)], ['#luma-end', new Date((start + 7200) * 1000).toISOString().slice(0, 16)], ['#luma-deposit', '0.01']]) await page.locator(selector).fill(value);
  badCode = true;
  await page.locator('[data-luma-action="review"]').click();
  await expect(page.locator('[data-luma-error]')).toContainText(/outside|unsupported|reviewed V10/i, { timeout: 15000 });
  await expect(page.locator('[data-luma-action="review"]')).toBeEnabled();
  pass(fixture.stats.walletRequests === 0 && publicJobs.length === 0, 'Unsupported setup account connects but is rejected at explicit transaction preparation before a draft or send');
  badCode = false;
  await page.locator('[data-luma-action="review"]').click();
  await expect(page.locator('dialog[data-luma-dialog]')).toBeVisible({ timeout: 60000 });
  const createDraft = fixture.reviewedDraft();
  assert.equal(createDraft.scopeKind, 'factory-create'); assert.equal(createDraft.transaction.to, fixture.manifest.factoryDeployment.factory);
  pass(fixture.stats.walletRequests === 0 && fixture.stats.authSignatures === 0, 'Fresh factory/account verification and exact creation review finish without a login signature or premature wallet send');
  await shot('creation-review');
  fixture.armCreation(createDraft.id);
  await page.locator('[data-luma-action="confirm"]').click();
  await expect(page.locator('[data-luma-created]')).toBeVisible({ timeout: 60000 });
  const created = fixture.savedState().events.find(event => event.eventId === createDraft.eventId);
  synthetic = { id: created.eventId, title: created.definition.title, lumaUrl: created.definition.lumaUrl, chainId: 1,
    contract: created.deployment.contract, abiVersion: 'kleros-event-v10-uups', depositWei: '10000000000000000', mode: 'hosted-production' };
  managed.set(synthetic.id, synthetic.contract);
  await expect(page.locator('[data-owned-event-row]')).toContainText(synthetic.title);
  pass(fixture.stats.walletRequests === 1 && fixture.stats.authSignatures === 0 && setupReplies.at(-1).managedEvents.some(event => event.id === synthetic.id),
    'One actual protected local CREATE produces the deposit link and updates SQL-backed Your events without personal_sign');
  await shot('creation-and-your-events');

  await page.goto(fixture.origin + '/first-event/#event=' + synthetic.id);
  await expect(page.locator('[data-connect-wallet]')).toBeVisible();
  await simpleConnect('[data-connect-wallet]', '[data-deposit]', 'Deposit');
  await expect(page.locator('[data-deposit]')).toHaveText('Deposit 0.01 ETH');
  badCode = true;
  await page.locator('[data-deposit]').click();
  await expect(page.locator('[data-tx-status]')).toContainText(/outside|unsupported|reviewed V10/i, { timeout: 15000 });
  await expect(page.locator('[data-deposit]')).toBeEnabled();
  await expect(page.locator('.wallet-review')).not.toBeVisible();
  pass(fixture.stats.walletRequests === 1, 'Unsupported deposit account connects but fails at Deposit preparation without opening a financial review or payment');
  badCode = false;
  const before = await fixture.financialSnapshot(synthetic.id);
  await page.locator('[data-deposit]').click();
  await expect(page.locator('.wallet-review')).toBeVisible({ timeout: 60000 });
  const depositDraft = fixture.reviewedDraft();
  assert.equal(depositDraft.action, 'deposit'); assert.equal(depositDraft.valueWei, synthetic.depositWei);
  pass(fixture.stats.walletRequests === 1 && fixture.stats.authSignatures === 0, 'Public deposit flow retains fresh account/event/draft checks and exact 0.01 ETH review before confirmation');
  await shot('deposit-review');
  fixture.armEventDraft(depositDraft.id, 'deposit'); blockDepositConfirm = true;
  await page.locator('[data-confirm-deposit]').click();
  await expect.poll(() => deniedConfirm.length, { timeout: 60000 }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Check original deposit', exact: true })).toBeVisible();
  const sent = fixture.stats.sent.find(tx => tx.draftId === depositDraft.id);
  assert(sent); await expect(page.locator('[data-tx-status]')).toContainText(sent.hash);
  pass(fixture.stats.walletRequests === 2 && deniedConfirm.every(hash => hash.toLowerCase() === sent.hash.toLowerCase()) && proof.depositRequest,
    'Exact protected 0.01 ETH send occurs once; unavailable receipt transport preserves its original hash and offers original-deposit checking');
  await shot('deposit-original-hash-preserved');
  const mintsBeforeReload = mints.length;
  await page.reload();
  await simpleConnect('[data-connect-wallet]', '[data-deposit]', 'Reloaded deposit');
  await page.locator('[data-deposit]').click();
  await expect(page.getByRole('button', { name: 'Check original deposit', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.wallet-review')).not.toBeVisible();
  pass(mints.length === mintsBeforeReload && resumed.length > 0 && fixture.stats.walletRequests === 2,
    'Reload restores the same opaque flow and pending journal, blocking a second review/send and retaining the original transaction');
  blockDepositConfirm = false;
  await page.getByRole('button', { name: 'Check original deposit', exact: true }).click();
  await expect(page.locator('[data-tx-status]')).toContainText('Deposit confirmed', { timeout: 60000 });
  await expect(page.locator('[data-tx-status]')).toContainText(sent.hash);
  const receipt = await fixture.provider.getTransactionReceipt(sent.hash), after = await fixture.financialSnapshot(synthetic.id), D = 10000000000000000n;
  const journals = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('kleros-transactions:v1:')).flatMap(key => JSON.parse(localStorage.getItem(key)).transactions));
  pass(fixture.stats.walletRequests === 2 && receipt.status === 1 && BigInt(after.eventBalanceWei) === D && BigInt(after.pendingWei) === D && after.stakerCount === '0' &&
    BigInt(before.walletBalanceWei) - BigInt(after.walletBalanceWei) === D + receipt.gasUsed * receipt.gasPrice && journals.some(entry => entry.hash === sent.hash && entry.status === 'confirmed'),
    'Original-hash recovery confirms the actual receipt and journal, exact D plus gas and payer credit, without manufacturing admission or another send');
  await page.locator('[data-copy-tx]').click();
  pass(await page.evaluate(() => navigator.clipboard.readText()) === sent.hash, 'Transaction ID copy preserves the exact original confirmed deposit hash');
  await expect(page.locator('[data-deposit]')).toBeHidden(); await expect(page.locator('[data-copy-address]')).toBeHidden();
  await shot('deposit-confirmed');

  await page.goto(fixture.origin + '/#setup=kickback');
  await expect(page.locator('#luma-setup [data-connect-wallet]')).toBeVisible();
  await simpleConnect('#luma-setup [data-connect-wallet]', '[data-owned-event-row]', 'Returning setup');
  await expect(page.locator('[data-owned-event-row]')).toContainText(synthetic.title);
  const beforeManage = apiCount(); withholdDisplay = true;
  await page.locator('[data-owned-event-manage]').click();
  await expect(page.locator('[data-first-event-display] h1')).toHaveText('Manage Event');
  await expect.poll(() => displayRequests).toBe(1);
  pass(!proof.http.slice().filter(row => row.pathname.startsWith('/api/')).slice(beforeManage).some(row => /bootstrap|event-read-jobs/.test(row.pathname)),
    'Bare Manage from the already-loaded full app renders immediately without a bootstrap or event job while the depositor list is unavailable');
  await shot('in-app-bare-manage');
  pass(!proof.http.some(row => /\/api\/auth\//.test(row.pathname)) && !proof.walletCalls.includes('personal_sign') && fixture.stats.authSignatures === 0 &&
    fixture.stats.backendSigningCalls === 0 && fixture.stats.publicNetworkRequests === 0 && proof.publicNetworkRequests === 0 && proof.errors.length === 0,
    'All public flows remain signature-free and session-free, local-only, with no backend signing or browser/route errors');
  proof.flows = { mintedKinds: mints, resumedResponses: resumed, jobs: publicJobs, deliberatelyUnavailableConfirmations: deniedConfirm.length };
  proof.transactions = { eventId: synthetic.id, contract: synthetic.contract, creationHash: fixture.stats.sent[0].hash, depositHash: sent.hash, walletRequests: fixture.stats.walletRequests, before, after };
  proof.status = 'passed';
} catch (error) {
  proof.status = 'failed'; proof.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (page) { proof.visibleStatus = await page.locator('body').textContent().catch(() => null); await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {}); }
} finally {
  await browser?.close(); await fixture?.close(); await db?.close();
  await fs.writeFile(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, 'proof.json'), failure: proof.failure?.message }));
}
