import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ethers } from 'ethers';
import { chromium, expect } from '@playwright/test';
import { createV10AppFixture } from '../../test/fixtures/v10-app-fixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = ROOT;
const OUT = path.join(ROOT, 'artifacts/first-event-manage', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(OUT, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const layoutOnly = process.argv.includes('--layout-only');
const proof = { kind: 'first-event-manage-actual-local-browser', status: 'running', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SOURCE, encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), checks: [], screenshots: [], source: {}, http: [], walletCalls: [], sends: [], errors: [], publicNetworkRequests: 0, privateSigningFilesRead: 0,
  limits: ['Actual isolated in-process Ganache chain1, actual V10 factory/event/controller/store/app; only external Court code is mocked.', 'Frontend exact Truth Pays ID/child constants are replaced in routed JS with the synthetic adopted event; algorithms stay unchanged.', 'Fixture extends only explicitly armed register/postAttendance browser wallet sends; synthetic signing keys remain in Node.', 'Synthetic LOCAL chain time advances after registration; no public chain or wallet is accessed.'] };
const pass = (ok, label) => { assert(ok, label); proof.checks.push(label); };
let f, browser, page, currentReview = null, armed = null;
async function capture(name) { const file = name + '.png'; await page.screenshot({ path: path.join(OUT, file), fullPage: true }); proof.screenshots.push(file); }
try {
  for (const file of ['src/workbench.mjs', 'src/server.mjs', 'src/first-event-manage.mjs', 'src/event-read-jobs.mjs', 'public/app.js', 'public/contract-inbox.js', 'public/event-read.js', 'public/transaction-context.js', 'test/fixtures/v10-app-fixture.mjs']) {
    try { proof.source[file] = sha(await fs.readFile(path.join(SOURCE, file))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const managed = new Map();
  f = await createV10AppFixture({ origin: 'https://first-event-manage-browser.example.invalid', firstEventManageScope: r => managed.get(r.definition.id)?.toLowerCase() === r.deployment.contract.toLowerCase() });
  const w = f.workbench(), D = ethers.parseEther('0.01');
  const payer = await (await f.provider.getSigner(0)).getAddress();
  const ownerSession = { id: 'synthetic-manage-browser-setup', mode: 'wallet', wallet: f.organizerAddress };
  const now = (await f.provider.getBlock('latest')).timestamp;
  const startsAt = new Date((now + 3600) * 1000).toISOString(), endsAt = new Date((now + 7200) * 1000).toISOString();
  const setup = await w.createFactoryDraft(ownerSession, { title: 'Synthetic first-event Manage browser acceptance', lumaUrl: 'https://luma.com/synthetic-first-event-manage-browser', startsAt, endsAt, timezone: 'UTC', depositEth: '0.01' });
  await w.validateFactoryDraft(ownerSession, setup.id);
  const creation = await f.sendSyntheticTransaction(1, setup.transaction); await creation.wait();
  await w.recordFactorySubmitted(ownerSession, setup.id, creation.hash);
  const adopted = await w.reconcileFactorySubmission(ownerSession, setup.id, creation.hash);
  assert.equal(adopted.status, 'confirmed');
  const event = { id: setup.eventId, contract: adopted.contract };
  managed.set(event.id, event.contract);
  const c = w.contract(event.id), record = w.events.get(event.id);
  const plain = await f.sendSyntheticTransaction(0, { to: event.contract, value: D }); const plainReceipt = await plain.wait();
  // The actual inbox requires two canonical confirmations before payer adoption.
  await f.provider.send('evm_mine', []);
  pass(plainReceipt.status === 1 && await c.pendingDeposits(payer) === D && record.participants.size === 0, 'Actual local plain ETH transfer credits payer0 without fabricating a participant or Luma identity');
  proof.synthetic = { event, payer, owner: f.organizerAddress, startsAt, endsAt, creationHash: creation.hash, plainDepositHash: plain.hash, depositWei: String(D) };

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, timezoneId: 'UTC', serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== f.origin) { proof.publicNetworkRequests++; return route.abort(); }
    try {
      const response = await f.forward(url.pathname + url.search, { method: request.method(), headers: request.headers(), body: request.postDataBuffer() ?? undefined });
      proof.http.push({ method: request.method(), pathname: url.pathname, status: response.status });
      let body = response.body;
      if (response.headers['content-type']?.startsWith('application/json')) {
        const data = JSON.parse(body.toString());
        if (data.kind === 'event-read-job' && data.state === 'ready' && data.operation === 'manage-draft') currentReview = data.result;
        if (data.kind === 'event-read-job' && data.state === 'failed') proof.errors.push({ stage: 'event-job', operation: data.operation, error: data.error });
      }
      if (url.pathname.endsWith('.js')) body = Buffer.from(body.toString().replaceAll('event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5', event.id).replaceAll('0xCd7418413fBFA814D41799C9dFaCc4654f295c11', event.contract));
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !['content-length', 'transfer-encoding', 'connection', 'date'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]));
      await route.fulfill({ status: response.status, headers, body });
    } catch (error) { proof.errors.push({ stage: 'route', pathname: url.pathname, message: error.message }); await route.abort(); }
  });
  await context.routeWebSocket('**/*', socket => { proof.publicNetworkRequests++; socket.close(); });
  page = await context.newPage();
  page.on('pageerror', error => proof.errors.push({ stage: 'page', message: error.message }));
  await page.exposeBinding('__manageSyntheticWallet', async ({ page: caller, frame }, request) => {
    assert.equal(caller, page); assert.equal(frame, page.mainFrame());
    proof.walletCalls.push({ method: request.method });
    if (request.method !== 'eth_sendTransaction') return f.wallet(request, page.url());
    assert(currentReview && armed === currentReview.id && ['register', 'postAttendance'].includes(currentReview.action));
    assert.equal(currentReview.eventId, event.id); assert.equal(currentReview.wallet, f.organizerAddress);
    assert.equal(currentReview.chainId, 1); assert.equal(currentReview.valueWei, '0'); assert(currentReview.expiresAt > Date.now());
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('event'), event.id);
    const tx = currentReview.transaction;
    assert.equal(tx.to, event.contract); assert.equal(tx.from, f.organizerAddress);
    assert.deepEqual(request.params, [{ to: tx.to, from: tx.from, data: tx.data, value: '0x0', chainId: '0x1' }]);
    const reviewed = structuredClone(currentReview); armed = null;
    const sent = await f.sendSyntheticTransaction(1, tx);
    proof.sends.push({ action: reviewed.action, draftId: reviewed.id, hash: sent.hash, args: reviewed.args, params: reviewed.params });
    return sent.hash;
  });
  await page.addInitScript(() => { window.ethereum = { request: r => window.__manageSyntheticWallet(r), on() {}, removeListener() {}, isMetaMask: true }; });
  await page.goto(f.origin + '/#event=' + event.id + '&view=organizer');
  await expect(page.locator('#top-identity')).toBeVisible({ timeout: 30000 });
  await page.locator('#top-identity').click();
  await expect(page.locator('#review-dialog [data-connect-wallet]')).toBeVisible();
  await page.locator('#review-dialog [data-connect-wallet]').click();
  await expect(page.locator('[data-contract-action="review"]').first()).toBeAttached({ timeout: 60000 });
  if (layoutOnly) {
    proof.mode = 'layout-only-before-adoption';
    const placement = await page.locator('#deposit-review').evaluate(node => {
      const container = node.closest('details');
      return { summary: container?.querySelector(':scope > summary')?.textContent?.trim(), open: container?.open === true };
    });
    pass(placement.summary === 'Depositor wallets & host approvals' && placement.open, 'Contract deposit inbox remains inside its open Depositor wallets & host approvals section');
    await expect(page.locator('[data-contract-action="review"]').first()).toBeVisible();
    pass(true, 'Review deposits is visible without opening the separate People/attendance section');
    pass(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Desktop Manage Event layout has no horizontal overflow');
    await capture('manage-inbox-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-contract-action="review"]').first()).toBeVisible();
    pass(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile Manage Event layout has no horizontal overflow');
    await capture('manage-inbox-mobile');
    pass(record.participants.size === 0 && proof.sends.length === 0 && proof.publicNetworkRequests === 0 && f.stats.backendSigningCalls === 0 && proof.errors.length === 0, 'Layout-only smoke stops before adoption and browser financial sends, with no public network or page errors');
  } else {
  if (!(await page.locator('[data-contract-action="review"]').first().isVisible())) await page.locator('details:has(#deposit-review) > summary').click();
  await expect(page.locator('[data-contract-action="review"]').first()).toBeVisible({ timeout: 60000 });
  await page.locator('[data-contract-action="review"]').first().click();
  await expect(page.locator('[data-contract-adopt-confirmed]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-contract-adopt-note]')).toHaveValue(new RegExp(payer));
  await page.locator('[data-contract-adopt-confirmed]').check();
  await page.locator('[data-contract-action="adopt"]').click();
  await expect.poll(() => [...record.participants.values()].length, { timeout: 60000 }).toBe(1);
  const person = [...record.participants.values()][0];
  pass(person.wallet.toLowerCase() === payer.toLowerCase() && person.name === null && person.email === null && person.identityVerified === false && person.walletVerified === false && person.payerVerified === true && person.identitySource === 'owner-reviewed-canonical-payer' && person.deposit.txHash === plain.hash && person.admission === 'pending' && await c.status(payer) === 0n && proof.sends.length === 0, 'Browser current owner adopts the original canonical plain-transfer payer as wallet-only review, without admission or any financial send');
  await expect(page.locator('#toast')).toContainText('Canonical payer added for host review.', { timeout: 60000 });
  const peopleSummary = page.locator('details:has(#people-review) > summary');
  if (!(await page.locator('select[data-admission]').isVisible())) await peopleSummary.click();
  await expect(page.locator('select[data-admission]')).toBeVisible({ timeout: 30000 });
  await capture('owner-adopted-plain-payer');
  await page.locator('select[data-admission]').selectOption('approved');
  await expect.poll(() => person.admission, { timeout: 30000 }).toBe('approved');
  await expect(page.locator('#toast')).toContainText('Admission decision saved.', { timeout: 60000 });
  await expect(page.locator('[data-launch-register]')).toBeEnabled({ timeout: 30000 });
  if (!(await page.locator('[data-launch-register]').isVisible())) await peopleSummary.click();
  await page.locator('[data-launch-register]').click();
  await expect(page.locator('#review-dialog #execute-transaction')).toBeVisible({ timeout: 60000 });
  assert.equal(currentReview.action, 'register'); assert.deepEqual(currentReview.args[0], [payer]);
  pass(proof.sends.length === 0 && await c.status(payer) === 0n, 'Host approval is separate from the exact guarded registration review and sends nothing before confirmation');
  armed = currentReview.id;
  await page.locator('#execute-transaction').click();
  await expect.poll(async () => String(await c.status(payer)), { timeout: 60000 }).toBe('1');
  await expect(page.locator('#review-dialog')).not.toBeVisible({ timeout: 60000 });
  const form = page.locator('form[data-form="owner-attendance"]');
  if (!(await form.isVisible())) await peopleSummary.click();
  await expect(form.locator('input[name="attendedWallets"]')).toBeDisabled({ timeout: 30000 });
  await expect(form.locator('button[type="submit"]')).toBeDisabled();
  pass(proof.sends.length === 1 && proof.sends[0].action === 'register' && await c.pendingDeposits(payer) === 0n && await c.stakerCount() === 1n, 'Explicit browser registration confirms once and manual attendance is disabled before the immutable event ends');
  await capture('registered-before-event-end');
  const localBefore = await f.provider.getBlock('latest');
  await f.provider.send('evm_increaseTime', [Math.max(1, Math.ceil(Date.parse(endsAt) / 1000) + 1 - localBefore.timestamp)]);
  await f.provider.send('evm_mine', []);
  proof.synthetic.timeAdvance = { localOnly: true, before: localBefore.timestamp, after: (await f.provider.getBlock('latest')).timestamp };
  await page.locator('#refresh').click();
  await expect(form.locator('input[name="attendedWallets"]')).toBeEnabled({ timeout: 60000 });
  if (!(await form.locator('input[name="attendedWallets"]').isVisible())) await peopleSummary.click();
  await form.locator('input[name="attendedWallets"]').check();
  const attendanceNote = 'I personally confirmed this synthetic payer attended during the immutable event interval.';
  await form.locator('textarea[name="note"]').fill(attendanceNote);
  await form.locator('input[name="confirmed"]').check();
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#review-dialog #execute-transaction')).toBeVisible({ timeout: 60000 });
  assert.equal(currentReview.action, 'postAttendance'); assert.deepEqual(currentReview.args[0], [payer]);
  assert.deepEqual(currentReview.params.attendedWallets, [payer]); assert.equal(currentReview.params.attendanceReview.note, attendanceNote); assert.equal(currentReview.params.attendanceReview.confirmed, true);
  await expect(page.locator('#review-dialog')).toContainText(payer);
  await expect(page.locator('#review-dialog')).toContainText('Unselected registered wallets remain omitted and retain challenge rights.');
  pass(proof.sends.length === 1 && record.observations.length === 0 && await c.attended(payer) === false, 'Manual checkbox plus explicit note/attestation prepares the exact selected list without fabricating check-in or sending before confirmation');
  await capture('owner-attendance-guarded-review');
  const balanceBeforeAttendance = await f.provider.getBalance(event.contract);
  const attendanceDraft = structuredClone(currentReview); armed = attendanceDraft.id;
  await page.locator('#execute-transaction').click();
  await expect.poll(async () => String(await c.phase()), { timeout: 60000 }).toBe('1');
  await expect(page.locator('#review-dialog')).not.toBeVisible({ timeout: 60000 });
  const sent = proof.sends.find(s => s.action === 'postAttendance');
  const receipt = await f.provider.getTransactionReceipt(sent.hash);
  const saved = f.savedState().drafts.find(([id]) => id === attendanceDraft.id)[1];
  pass(proof.sends.length === 2 && receipt.status === 1 && await c.attended(payer) === true && await c.status(payer) === 1n && record.observations.length === 0 && await f.provider.getBalance(event.contract) === balanceBeforeAttendance && saved.submittedHash === sent.hash && saved.confirmedHash === sent.hash && saved.params.attendanceReview.note === attendanceNote, 'One explicit standard guarded attendance transaction confirms exact list/original receipt while preserving custody, registered status and no fabricated door observations');
  await capture('owner-attendance-confirmed');
  pass(proof.publicNetworkRequests === 0 && f.stats.backendSigningCalls === 0 && proof.errors.length === 0, 'Browser acceptance uses zero public network requests, zero backend signing and zero page errors');
  }
  proof.status = 'passed';
} catch (error) {
  proof.status = 'failed'; proof.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (page) { proof.visibleText = (await page.locator('body').innerText().catch(() => '')).slice(-12000); await capture('failure-state').catch(() => {}); }
} finally {
  await f?.close(); await browser?.close(); proof.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, 'proof.json'), failure: proof.failure?.message }));
}
