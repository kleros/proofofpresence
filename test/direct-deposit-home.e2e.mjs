// Actual protected local V10 CREATE + one-click direct deposit + connected home.
// Public RPC, real wallets and private signing files are never used.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { ethers } from 'ethers';
import { createFirstEventPostgres } from '../src/first-event-postgres.mjs';
import { EVENT as PINNED_EVENT } from '../public/first-event/event.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'artifacts/direct-deposit-home', new Date().toISOString().replace(/[:.]/g, '-'));
const ID = 'event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5', CHILD = '0xCd7418413fBFA814D41799C9dFaCc4654f295c11';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const redactedPath = pathname => pathname.replace(/(\/api\/public-transactions\/)[0-9a-f]{64}(?=\/|$)/g, '$1[flow]');
const mime = file => ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] ?? 'text/plain');
await fs.mkdir(OUT, { recursive: true });
const proof = { kind: 'actual-local-direct-deposit-home', status: 'running', checks: [], source: {}, screenshots: [], http: [], walletCalls: [], errors: [],
  publicNetworkRequests: 0, privateSigningFilesRead: 0,
  limits: ['Actual protected local chain1 wallet/factory/event and embedded PostgreSQL/PGlite; existing fixture mocks external Court runtime/adjudication.', 'Only trusted synthetic backend event scope and literal frontend event-ID/child configuration are adapted. Product guard/account/sender algorithms run as saved.', 'Saved receipt DTOs are empty or derived from the actual canonical local deposit; the clean-browser manual-payment branch uses that same receipt without any local journal. The production SQL indexer is not exercised here.', 'Direct pre-send follows the explicitly approved current-state/implementation checks rather than a full historical audit; original receipt verification follows the hash.', 'Public display GET is deliberately withheld for the final in-app Manage render check. No production auth, public RPC or real transaction is executed.'] };
const pass = (condition, label) => { assert(condition, label); proof.checks.push(label); };
let fixture, browser, page, db, synthetic = null;
try {
  for (const file of ['src/server.mjs', 'src/workbench.mjs', 'src/public-transactions.mjs', 'src/event-read-jobs.mjs', 'src/first-event-display.mjs', 'src/first-event-state.mjs', 'src/v10-factory-onboarding.mjs', 'src/v10-upgrade-verification.mjs', 'src/v10-read-batch.mjs', 'public/entry.js', 'public/app.js', 'public/first-event-display.js', 'public/first-event-manage.js', 'public/public-home.js', 'public/home-wallet.js', 'public/luma-setup.js', 'public/luma-factory.js', 'public/event-timezone.js', 'public/event-read.js', 'public/public-transactions.js', 'public/wallet-connection.js', 'public/wallet-connection.css', 'public/first-event/index.html', 'public/first-event/wallet.js', 'public/first-event/direct-deposit.js', 'public/first-event/receipts.js', 'public/transaction-context.js', 'public/v10-wallet-account.js'])
    proof.source[file] = sha(await fs.readFile(path.join(ROOT, file)));
  const original = await fs.readFile(path.join(ROOT, 'test/fixtures/v10-metamask-app-fixture.mjs'), 'utf8');
  const replacements = [
    ['Object.keys(options).every((key) => key === "origin"),', 'Object.keys(options).every((key) => ["origin", "firstEventStore", "firstEventManageScope"].includes(key)),'],
    ['      {\n        workbenchFactory: async (options) => {', '      {\n        firstEventStore: options.firstEventStore,\n        workbenchFactory: async (options) => {'],
    ['            productionRuntime: async () => runtime,', '            productionRuntime: async () => runtime,\n            firstEventManageScope: options.firstEventManageScope,'],
    ['      if (data.kind === "organizer-job" && data.state === "ready") {', '      if (method === "POST" && /\\/direct-deposit(?:\\/prepare)?$/.test(new URL(route, "https://fixture.invalid").pathname) && response.status === 200) review = data;\n      if (data.kind === "organizer-job" && data.state === "ready") {'],
  ];
  // Avoid shadowing the fixture options with the server workbench options.
  let adapted = original.replaceAll('../../', pathToFileURL(ROOT).href);
  for (const [before, after] of replacements) { assert(adapted.includes(before), 'Original protected fixture anchor changed'); adapted = adapted.replace(before, after); }
  adapted = adapted.replace('  const { origin = "https://v10-mm-browser.example.invalid" } = options;', '  const fixtureManageScope = options.firstEventManageScope;\n  const { origin = "https://v10-mm-browser.example.invalid" } = options;')
    .replace('firstEventManageScope: options.firstEventManageScope,', 'firstEventManageScope: fixtureManageScope,');
  const fixtureFile = path.join(OUT, 'synthetic-protected-public-fixture.mjs');
  await fs.writeFile(fixtureFile, adapted);
  proof.fixture = { originalSha256: sha(original), adaptedSha256: sha(adapted), adaptation: 'Absolute imports, injected local SQL store, trusted synthetic event scope, capture direct deposit draft for original arming. No account policy override.' };
  const { createV10MetaMaskAppFixture } = await import(pathToFileURL(fixtureFile).href);
  db = new PGlite();
  const store = createFirstEventPostgres({ pool: { query: (sql, values) => db.query(sql, values), connect() { throw Error('No display index lease needed for setup-only SQL.'); } } });
  const managed = new Map();
  // The injected test store survives an actual server restart; this runner owns the PGlite lifetime.
  fixture = await createV10MetaMaskAppFixture({ firstEventStore: { ...store, close: async () => {} },
    firstEventManageScope: record => !!record && managed.get(record.definition.id)?.toLowerCase() === record.deployment.contract.toLowerCase() });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  let badCode = false, blockDepositConfirm = false, withholdDisplay = false, displayRequests = 0;
  let tamperValidation = null, allowDirectSend = false, simulateWalletSwitch = false, directReplyCount = 0, walletSwitchAfterReply = 0;
  let delayedPreparedReply = false, latePreparedContinuation = false, legacyBackend = false, creationPreparation = null;
  let receiptMode = 'empty', selectedWalletOverride = null;
  const apiStarts = [];
  const rejectedDirect = [];
  const mints = [], resumed = [], publicJobs = [], deniedConfirm = [], setupReplies = [];
  const configured = (body, pathname) => {
    if (!synthetic) return body;
    if (pathname === '/first-event/event.js') return Buffer.from(body.toString().replace('export const EVENT = PROMOTED_EVENT ?? LEGACY_EVENT;', `export const EVENT = Object.freeze(${JSON.stringify(synthetic)});`));
    if (['/public-transactions.js', '/event-read.js', '/entry.js'].includes(pathname))
      return Buffer.from(body.toString().replaceAll(ID, synthetic.id).replaceAll(CHILD, synthetic.contract).replaceAll(PINNED_EVENT.id, synthetic.id).replaceAll(PINNED_EVENT.contract, synthetic.contract));
    if (pathname === '/first-event/wallet.js') return Buffer.from(body.toString().replace('await execute(prepared);', 'if (window.__delayPreparedContinuation) await new Promise(resolve => setTimeout(resolve, 1300)); await execute(prepared);'));
    if (pathname === '/first-event/index.html' || pathname === '/first-event/') return Buffer.from(body.toString().replaceAll(CHILD, synthetic.contract).replaceAll(PINNED_EVENT.contract, synthetic.contract));
    return body;
  };
  const routeHandler = async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), pathname = url.pathname;
    if (url.origin !== fixture.origin) { proof.publicNetworkRequests++; return route.abort(); }
    try {
      if (pathname.startsWith('/api/')) apiStarts.push({ method, pathname: redactedPath(pathname) });
      const input = method === 'POST' && request.postData() ? request.postDataJSON() : null;
      if (pathname === '/api/first-event/depositors' && withholdDisplay) {
        displayRequests++;
        proof.http.push({ method, pathname, status: 503, syntheticGate: true });
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic display intentionally withheld.' }) });
      }
      if (pathname === '/api/first-event/depositors' && synthetic) {
        if (receiptMode === 'unavailable') {
          proof.http.push({ method, pathname, status: 503, syntheticGate: true });
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic saved receipts unavailable.' }) });
        }
        const block = await fixture.provider.getBlock('latest');
        const data = { schemaVersion: 1, kind: 'first-event-depositors', displayOnly: true, mode: synthetic.mode,
          instanceId: 'synthetic-saved-receipts', eventId: synthetic.id, chainId: 1, contract: synthetic.contract,
          status: 'current', checkedAt: new Date().toISOString(), blockNumber: block.number, blockHash: block.hash, depositors: [] };
        if (receiptMode === 'actual') {
          const sent = fixture.stats.sent.find(tx => tx.action === 'deposit'), receipt = await fixture.provider.getTransactionReceipt(sent.hash);
          assert.equal(receipt.status, 1);
          const iface = new ethers.Interface(['event Deposited(address indexed from,uint256 amount)']);
          const lots = receipt.logs.filter(log => log.address.toLowerCase() === synthetic.contract.toLowerCase() && log.topics[0] === iface.getEvent('Deposited').topicHash).map(log => {
            const decoded = iface.parseLog(log); assert.equal(decoded.args.from, fixture.organizerAddress);
            return { txHash: receipt.hash, logIndex: log.index, amountWei: String(decoded.args.amount), blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
          });
          assert(lots.length > 0);
          data.depositors.push({ wallet: fixture.organizerAddress, totalReceivedWei: lots.reduce((sum, lot) => sum + BigInt(lot.amountWei), 0n).toString(), deposits: lots });
        }
        proof.http.push({ method, pathname, status: 200, syntheticReceiptPresentation: receiptMode });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (/^\/api\/public-transactions\/[0-9a-f]{64}\/event-read-jobs$/.test(pathname) && input?.operation === 'confirm' && blockDepositConfirm) {
        deniedConfirm.push(input.hash);
        proof.http.push({ method, pathname: redactedPath(pathname), status: 503, operation: 'confirm', syntheticGate: true });
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SYNTHETIC_CONFIRM_UNAVAILABLE', error: 'Synthetic receipt transport unavailable.' }) });
      }
      if (pathname.endsWith('/direct-deposit/prepare') && legacyBackend) {
        proof.http.push({ method, pathname: redactedPath(pathname), status: 405, syntheticLegacyBackend: true });
        return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ code: 'METHOD_NOT_ALLOWED', error: 'Method is not available' }) });
      }
      if (pathname.startsWith('/first-event/')) {
        const rel = decodeURIComponent(pathname.slice('/first-event/'.length)) || 'index.html';
        assert(!rel.includes('..'));
        const body = configured(await fs.readFile(path.join(ROOT, 'public/first-event', rel)), pathname);
        return route.fulfill({ status: 200, contentType: mime(rel), body });
      }
      const response = await fixture.forward(pathname + url.search, { method, headers: request.headers(), body: request.postDataBuffer() ?? undefined });
      let responseBody = response.body;
      if (pathname.includes('/organizer-jobs/') && response.status === 200) {
        const value = JSON.parse(responseBody);
        if (value.kind === 'organizer-job' && value.state === 'ready' && value.operation === 'prepare') creationPreparation = value.result;
      }
      if ((pathname.endsWith('/direct-deposit') || pathname.endsWith('/direct-deposit/prepare')) && method === 'POST' && response.status === 200) {
        directReplyCount++;
        const draft = fixture.reviewedDraft();
        assert.equal(draft.action, 'deposit');
        assert.equal(draft.directDepositContext.kind, 'direct-deposit-v1');
        if (allowDirectSend) fixture.armEventDraft(draft.id, 'deposit');
      }
      if ((pathname.endsWith('/direct-deposit/validate') || (pathname.endsWith('/direct-deposit/prepare') && !delayedPreparedReply && !latePreparedContinuation)) && response.status === 200 && tamperValidation) {
        const value = JSON.parse(responseBody);
        assert(value.transaction?.to && value.transaction?.value);
        if (tamperValidation === 'recipient') value.transaction.to = '0x1111111111111111111111111111111111111111';
        else value.transaction.value = '1';
        responseBody = Buffer.from(JSON.stringify(value));
      }
      if (pathname.endsWith('/direct-deposit/prepare') && response.status === 200 && delayedPreparedReply) await new Promise(resolve => setTimeout(resolve, 3300));
      proof.http.push({ method, pathname: redactedPath(pathname), status: response.status, ...(input?.operation ? { operation: input.operation } : {}) });
      if (pathname.startsWith('/api/public-transactions')) {
        assert.equal(response.headers['set-cookie'], undefined, 'Public flow must never create a login session');
        if (pathname === '/api/public-transactions' && method === 'POST' && response.status === 201) mints.push(input.kind);
        else if (/^\/api\/public-transactions\/[0-9a-f]{64}$/.test(pathname) && method === 'GET') resumed.push(response.status);
        if (input?.operation) publicJobs.push({ family: pathname.endsWith('/organizer-jobs') ? 'organizer' : 'event', operation: input.operation });
      }
      if (pathname === '/api/kickback-setup' && response.status === 200) setupReplies.push(JSON.parse(response.body));
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !['connection', 'transfer-encoding', 'content-length', 'date'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]));
      await route.fulfill({ status: response.status, headers, body: configured(responseBody, pathname) });
    } catch (error) { proof.errors.push({ stage: 'route', pathname: redactedPath(pathname), message: error.message }); await route.abort(); }
  };
  await context.route('**/*', routeHandler);
  page = await context.newPage();
  page.on('pageerror', error => proof.errors.push({ stage: 'browser', message: error.message }));
  const walletBinding = async ({ page: caller, frame }, request) => {
    assert.equal(caller, page); assert.equal(frame, page.mainFrame());
    proof.walletCalls.push(request.method);
    assert.notEqual(request.method, 'personal_sign', 'Simple public flow never asks for a sign-in signature');
    if (selectedWalletOverride && request.method === 'eth_requestAccounts') return [selectedWalletOverride];
    if (badCode && request.method === 'eth_getCode' && request.params[0].toLowerCase() === fixture.organizerAddress.toLowerCase()) {
      await fixture.wallet(request, page.url()); return '0x60006000';
    }
    if (simulateWalletSwitch && directReplyCount > walletSwitchAfterReply && request.method === 'eth_accounts') {
      await fixture.wallet(request, page.url()); return ['0x1111111111111111111111111111111111111111'];
    }
    if (request.method === 'eth_sendTransaction' && !synthetic) {
      const original = fixture.reviewedDraft();
      assert.equal(original.scopeKind, 'factory-create');
      assert.equal(original.transaction.to, fixture.manifest.factoryDeployment.factory);
      fixture.armCreation(original.id);
    }
    if (request.method === 'eth_sendTransaction' && synthetic) {
      assert(allowDirectSend, 'A negative direct-deposit case must not ask the wallet to send');
      const expected = { to: synthetic.contract, from: fixture.organizerAddress, value: '0x2386f26fc10000', data: '0xd0e30db0', chainId: '0x1' };
      assert.deepEqual(request.params, [expected]); proof.depositRequest = expected;
    }
    return fixture.wallet(request, page.url());
  };
  await page.exposeBinding('__localWallet', walletBinding);
  const walletInit = () => {
    window.ethereum = { request: request => window.__localWallet(request), on() {}, removeListener() {}, isMetaMask: true };
    window.__openedAppDialogs = [];
    new MutationObserver(records => {
      for (const record of records) if (record.type === 'attributes' && record.target instanceof HTMLDialogElement && record.target.open)
        window.__openedAppDialogs.push(record.target.className || record.target.id || 'dialog');
    }).observe(document, { attributes: true, attributeFilter: ['open'], subtree: true });
  };
  await page.addInitScript(walletInit);
  const shot = async name => { await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }); proof.screenshots.push(name + '.png'); };
  const apiCount = () => apiStarts.length;
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
  // Kathmandu's fixed +05:45 offset is deliberately independent of the UTC
  // browser and the product conversion helper used by the form.
  const eventTimezone = 'Asia/Kathmandu', wallTime = seconds => new Date((seconds + 345 * 60) * 1000).toISOString().slice(0, 16);
  for (const [selector, value] of [['#luma-title', 'Synthetic signature-free setup'], ['#luma-url', 'https://luma.com/synthetic-signature-free'], ['#luma-timezone', eventTimezone], ['#luma-start', wallTime(start)], ['#luma-end', wallTime(start + 7200)], ['#luma-deposit', '0.01']]) await page.locator(selector).fill(value);
  assert.equal(fixture.stats.walletRequests, 0);
  await page.locator('[data-luma-action="review"]').click();
  await expect(page.locator('[data-luma-created]')).toBeVisible({ timeout: 60000 });
  const createDraft = fixture.reviewedDraft();
  assert.equal(createDraft.scopeKind, 'factory-create'); assert.equal(createDraft.transaction.to, fixture.manifest.factoryDeployment.factory);
  assert.equal(creationPreparation.creationContext.kind, 'verified-creation-context-v1');
  assert.equal(creationPreparation.creationContext.draftId, createDraft.id); assert.equal(creationPreparation.creationContext.snapshot, createDraft.snapshot);
  assert(!publicJobs.some(job => job.family === 'event' && job.operation === 'bootstrap'), 'Creation consumes its existing successful prepare proof without a preliminary full bootstrap');
  pass(fixture.stats.walletRequests === 1 && fixture.stats.authSignatures === 0,
    'Current direct creation performs fresh factory/account validation and one protected wallet send after the explicit Create click without a login signature or app review dialog');
  const created = fixture.savedState().events.find(event => event.eventId === createDraft.eventId);
  const createdContract = new ethers.Contract(created.deployment.contract, ['function eventStart() view returns (uint256)', 'function claimDeadline() view returns (uint256)'], fixture.provider);
  pass(created.definition.timezone === eventTimezone && created.definition.startsAt === new Date(start * 1000).toISOString() &&
    created.definition.endsAt === new Date((start + 7200) * 1000).toISOString() && Number(await createdContract.eventStart()) === start &&
    Number(await createdContract.claimDeadline()) === start + 7 * 86400,
    'A Kathmandu wall time in a UTC browser preserves the chosen timezone and converts to the exact immutable on-chain UTC start and seven-day deadline');
  proof.eventTime = { browserTimezone: 'UTC', eventTimezone, wallStart: wallTime(start), startsAt: created.definition.startsAt,
    endsAt: created.definition.endsAt, eventStart: start, claimDeadline: start + 7 * 86400 };
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
  for (const fault of ['recipient', 'amount', 'wallet-switch', 'stale-response', 'late-continuation', 'legacy-backend']) {
    delayedPreparedReply = fault === 'stale-response'; latePreparedContinuation = fault === 'late-continuation'; legacyBackend = fault === 'legacy-backend';
    await page.evaluate(value => { window.__delayPreparedContinuation = value; }, latePreparedContinuation);
    tamperValidation = fault === 'wallet-switch' ? null : ['recipient', 'amount'].includes(fault) ? fault : 'amount';
    simulateWalletSwitch = fault === 'wallet-switch';
    const validationsBefore = proof.http.filter(row => row.pathname.endsWith('/direct-deposit/validate')).length;
    const repliesBefore = directReplyCount;
    walletSwitchAfterReply = repliesBefore;
    await page.locator('[data-deposit]').click();
    await expect.poll(() => directReplyCount, { timeout: 30000 }).toBeGreaterThan(repliesBefore);
    await expect(page.locator('[data-deposit]')).toBeEnabled({ timeout: 30000 });
    await expect(page.locator('[data-tx-status]')).toContainText(/differ|changed|wallet|review/i);
    pass(fixture.stats.walletRequests === 1, `Direct deposit rejects ${fault} before any wallet send`);
    if (['stale-response', 'late-continuation', 'legacy-backend'].includes(fault)) assert.equal(proof.http.filter(row => row.pathname.endsWith('/direct-deposit/validate')).length, validationsBefore + 1, `${fault} must obtain complete final validation`);
    rejectedDirect.push({ fault, status: await page.locator('[data-tx-status]').textContent() });
  }
  tamperValidation = null; simulateWalletSwitch = false; delayedPreparedReply = latePreparedContinuation = legacyBackend = false;
  await page.evaluate(() => { window.__delayPreparedContinuation = false; });
  const before = await fixture.financialSnapshot(synthetic.id);
  allowDirectSend = true; blockDepositConfirm = true;
  const directStart = proof.http.length;
  await page.locator('[data-deposit]').click();
  await expect.poll(() => deniedConfirm.length, { timeout: 60000 }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Check original deposit', exact: true })).toBeVisible();
  const depositDraft = fixture.reviewedDraft();
  assert.equal(depositDraft.action, 'deposit'); assert.equal(depositDraft.valueWei, synthetic.depositWei);
  const directRequests = proof.http.slice(directStart);
  assert.equal(directRequests.filter(row => row.pathname.endsWith('/direct-deposit/prepare')).length, 1);
  assert(!directRequests.some(row => row.pathname.endsWith('/direct-deposit') || row.pathname.endsWith('/direct-deposit/validate')), 'Immediate prepared transaction must not repeat a quote or complete validation');
  pass(await page.evaluate(() => window.__openedAppDialogs.length === 0) &&
    !directRequests.some(row => row.operation === 'deposit' || row.operation === 'validate') && fixture.stats.authSignatures === 0,
    'One Deposit click opens the exact protected wallet send without an app review dialog, login signature or legacy pre-send deposit/validate jobs');
  const sent = fixture.stats.sent.find(tx => tx.draftId === depositDraft.id);
  assert(sent); await expect(page.locator('[data-tx-status]')).toContainText(sent.hash);
  pass(fixture.stats.walletRequests === 2 && deniedConfirm.every(hash => hash.toLowerCase() === sent.hash.toLowerCase()) && proof.depositRequest,
    'Exact protected 0.01 ETH send occurs once; unavailable receipt transport preserves its original hash and offers original-deposit checking');
  await shot('deposit-original-hash-preserved');
  const mintsBeforeReload = mints.length, resumedBeforeReload = resumed.length, directBeforeReload = directReplyCount;
  await page.reload();
  await simpleConnect('[data-connect-wallet]', 'button:has-text("Check original deposit")', 'Reloaded pending deposit');
  await expect(page.getByRole('button', { name: 'Check original deposit', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-deposit]')).toBeHidden();
  await expect(page.locator('.wallet-review')).not.toBeVisible();
  pass(mints.length === mintsBeforeReload && resumed.length === resumedBeforeReload && directReplyCount === directBeforeReload && fixture.stats.walletRequests === 2,
    'Reload immediately restores the pending original hash and blocks Deposit without minting/resuming a flow or requesting another payment');
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

  // An actual backend restart expires the opaque token and changes instance ID.
  // The original confirmed journal must suffice without contacting that token.
  const oldFlow = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('kleros-public-transaction-v1:') && key.includes('deposit')))));
  assert(oldFlow?.token && oldFlow.hash === sent.hash);
  await fixture.restart();
  const expired = await fixture.forward('/api/public-transactions/' + oldFlow.token);
  assert.equal(expired.status, 404);
  const restartedSetup = JSON.parse((await fixture.forward('/api/kickback-setup')).body);
  assert.notEqual(restartedSetup.instanceId, oldFlow.instanceId);
  const beforeConfirmedReload = { mints: mints.length, resumes: resumed.length, direct: directReplyCount };
  receiptMode = 'unavailable';
  await page.reload({ waitUntil: 'networkidle' });
  await simpleConnect('[data-connect-wallet]', '[data-copy-tx]', 'Confirmed deposit after server restart');
  await expect(page.locator('[data-tx-status]')).toContainText(sent.hash);
  await expect(page.locator('[data-deposit]')).toBeHidden(); await expect(page.locator('[data-copy-address]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Check original deposit', exact: true })).toBeHidden();
  pass(mints.length === beforeConfirmedReload.mints && resumed.length === beforeConfirmedReload.resumes && directReplyCount === beforeConfirmedReload.direct && fixture.stats.walletRequests === 2,
    'A confirmed hash survives actual server/token expiry and unavailable SQL; reconnect shows hash/copy only with no new flow, preparation or payment');
  await shot('confirmed-after-expired-token-new-instance');

  // A clean browser has no local transaction journal: present the exact actual
  // canonical local receipt as the SQL DTO that a manual payment would produce.
  const originalPage = page;
  const manualContext = await browser.newContext({ viewport: { width: 1360, height: 1000 }, timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  await manualContext.route('**/*', routeHandler);
  page = await manualContext.newPage();
  page.on('pageerror', error => proof.errors.push({ stage: 'manual-receipt-browser', message: error.message }));
  await page.exposeBinding('__localWallet', walletBinding); await page.addInitScript(walletInit);
  receiptMode = 'actual'; selectedWalletOverride = '0x3333333333333333333333333333333333333333';
  await page.goto(fixture.origin + '/first-event/#event=' + synthetic.id, { waitUntil: 'networkidle' });
  await simpleConnect('[data-connect-wallet]', '[data-deposit]', 'A different wallet viewing saved receipts');
  await expect(page.locator('[data-copy-tx]')).toBeHidden();
  pass(!(await page.locator('[data-tx-status]').textContent()).includes(sent.hash), 'A different selected wallet never inherits the original payer receipt or confirmed-payment UI');
  selectedWalletOverride = null;
  await page.reload({ waitUntil: 'networkidle' });
  const beforeManual = { mints: mints.length, resumes: resumed.length, direct: directReplyCount };
  await simpleConnect('[data-connect-wallet]', '[data-copy-tx]', 'Saved manual receipt without a local journal');
  await expect(page.locator('[data-tx-status]')).toContainText(/recorded/i);
  await expect(page.locator('[data-tx-status]')).toContainText(sent.hash);
  await expect(page.locator('[data-deposit]')).toBeHidden(); await expect(page.locator('[data-copy-address]')).toBeHidden();
  pass(mints.length === beforeManual.mints && resumed.length === beforeManual.resumes && directReplyCount === beforeManual.direct && fixture.stats.walletRequests === 2 &&
    await page.evaluate(() => !Object.keys(localStorage).some(key => key.startsWith('kleros-transactions:v1:'))),
    'A full SQL receipt with no browser journal suppresses duplicate payment and shows only the exact recorded hash/copy, without granting current financial authority');
  await page.locator('[data-copy-tx]').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sent.hash);
  await shot('sql-receipt-without-local-journal');
  await manualContext.close(); page = originalPage; receiptMode = 'empty';
  proof.receiptPersistence = { actualRestart: true, expiredOriginalTokenStatus: expired.status, changedInstance: true,
    unavailableSqlStillShowsLocalConfirmation: true, cleanBrowserSqlReferenceUsesActualCanonicalReceipt: true, wrongWalletRejected: true };

  await page.goto(fixture.origin + '/#setup=kickback');
  await expect(page.locator('#luma-setup [data-connect-wallet]')).toBeVisible();
  await simpleConnect('#luma-setup [data-connect-wallet]', '[data-luma-action="new"]', 'Returning setup');
  const beforeNew = { apis: apiCount(), walletCalls: proof.walletCalls.length };
  await page.getByRole('button', { name: 'Create new event', exact: true }).click();
  await expect(page.locator('[data-luma-form]')).toBeVisible();
  const creationJournal = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('kleros-transactions:v1:')).flatMap(key => JSON.parse(localStorage.getItem(key)).transactions));
  pass(apiCount() === beforeNew.apis && proof.walletCalls.length === beforeNew.walletCalls &&
    creationJournal.some(entry => entry.hash === fixture.stats.sent[0].hash && entry.status === 'confirmed') && fixture.stats.walletRequests === 2,
    'Create new event opens a blank form from the recorded confirmed creation without server/wallet calls, preserving its original confirmed journal/hash');
  const setupReadsBeforeHome = setupReplies.length;
  await page.locator('[data-launch-root] > .back-link').click();
  await expect(page.locator('[data-home-connect-wallet]')).toBeVisible();
  await expect.poll(() => setupReplies.length).toBeGreaterThan(setupReadsBeforeHome);
  await simpleConnect('[data-home-connect-wallet]', '[data-home-event-row]', 'Home');
  await expect(page.locator('[data-home-event-row]')).toContainText(synthetic.title);
  const beforeManage = apiCount(); withholdDisplay = true;
  await page.locator('[data-home-event-manage]').click();
  await expect(page.locator('[data-first-event-display] h1')).toHaveText('Manage Event');
  await expect.poll(() => displayRequests).toBe(1);
  pass(!proof.http.slice().filter(row => row.pathname.startsWith('/api/')).slice(beforeManage).some(row => /bootstrap|event-read-jobs/.test(row.pathname)),
    'Bare Manage from the already-loaded full app renders immediately without a bootstrap or event job while the depositor list is unavailable');
  await shot('in-app-bare-manage');
  pass(!proof.http.some(row => /\/api\/auth\//.test(row.pathname)) && !proof.walletCalls.includes('personal_sign') && fixture.stats.authSignatures === 0 &&
    fixture.stats.backendSigningCalls === 0 && fixture.stats.publicNetworkRequests === 0 && proof.publicNetworkRequests === 0 && proof.errors.length === 0,
    'All public flows remain signature-free and session-free, local-only, with no backend signing or browser/route errors');
  proof.flows = { mintedKinds: mints, resumedResponses: resumed, jobs: publicJobs, directReplyCount, rejectedDirect, deliberatelyUnavailableConfirmations: deniedConfirm.length };
  proof.transactions = { eventId: synthetic.id, contract: synthetic.contract, creationHash: fixture.stats.sent[0].hash, depositHash: sent.hash, walletRequests: fixture.stats.walletRequests, before, after };
  for (const [file, expected] of Object.entries(proof.source)) assert.equal(sha(await fs.readFile(path.join(ROOT, file))), expected, `Source changed during the final protected run: ${file}`);
  proof.sourceMatchedAtCompletion = true;
  proof.status = 'passed';
} catch (error) {
  proof.status = 'failed'; proof.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (page) { proof.visibleStatus = await page.locator('body').textContent().catch(() => null); await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {}); }
} finally {
  await browser?.close(); await fixture?.close(); await db?.close();
  await fs.writeFile(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, 'proof.json'), failure: proof.failure?.message }));
}
