// Fully routed browser test. Real chooser/wrapper, mocked vendor, zero external traffic.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'artifacts/walletconnect-lazy', new Date().toISOString().replace(/[:.]/g, '-'));
const PROD = 'https://kleros-kickback.netlify.app', CUSTOM = 'https://kickback.kleros.io';
const rejectedOrigins = ['https://kleros-luma-v10-ethereum.netlify.app', 'https://preview--kleros-kickback.netlify.app', 'http://127.0.0.1:3000', 'https://unknown.example.invalid'];
const origins = [PROD, CUSTOM, ...rejectedOrigins];
await fs.mkdir(OUT, { recursive: true });
const proof = { kind: 'walletconnect-lazy-mock-browser', status: 'running', checks: [], source: {}, requests: [], blocked: [], errors: [],
  limits: ['Real chooser and WalletConnect wrapper execute; vendor responses are a tiny mock. No actual SDK, relay, QR URI, wallet grant, signature or financial transaction is used.', 'Production/demo origins are virtual browser URLs: every request is fulfilled from local files or mocked content.'] };
const html = `<!doctype html><html><head><meta charset="utf-8"><title>WalletConnect lazy mock test</title></head><body><button id="connect">Connect</button><p id="status"></p><script type="module">
import {chooseWalletProvider} from '/wallet-connection.js';
window.effects={init:0,enable:0,open:0,requests:[]};
document.querySelector('#connect').onclick=async()=>{try{window.provider?.dispose?.();window.provider=await chooseWalletProvider();if(!window.provider){document.querySelector('#status').textContent='handoff';return;}window.accounts=await window.provider.request({method:'eth_requestAccounts'});document.querySelector('#status').textContent='connected';}catch(error){window.connectionError={code:error.code,message:error.message};document.querySelector('#status').textContent='cancelled';}};
window.requestAccounts=async()=>{window.accounts=await window.provider.request({method:'eth_requestAccounts'});};
window.ready=true;</script></body></html>`;
const vendor = `window.KlerosWalletConnectVendor={EthereumProvider:{init:async options=>{window.effects.init++;if(window.mockConnectMode==='init-fail')throw Error('Synthetic init failure');const sdk={accounts:['0x1111111111111111111111111111111111111111'],session:null,signer:{abortPairingAttempt(){},async cleanupPendingPairings(){}},enable:async()=>{window.effects.enable++;if(window.mockConnectMode==='cancel')throw Object.assign(Error('Synthetic cancel'),{code:4001});if(window.mockConnectMode==='abort')throw new DOMException('Synthetic abort','AbortError');sdk.session={namespaces:{eip155:{accounts:['eip155:1:'+sdk.accounts[0]]}}};return sdk.accounts;},request:async request=>{window.effects.requests.push(request.method);throw Error('No non-account mock requests');},on(){},removeListener(){},disconnect:async()=>{sdk.session=null;}};return sdk;}},createAppKit:options=>({subscribeState:()=>()=>{},open:async()=>{if(document.querySelector('[data-wallet-connection]'))throw Error('Native chooser must close before modal opens');window.effects.open++;},close:async()=>{}})};`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    if (location.search.includes('injected')) window.ethereum={request:async args=>{window.effects.requests.push(args.method);return ['0x2222222222222222222222222222222222222222'];},on(){},removeListener(){}};
    if (location.search.includes('telegram')) window.TelegramWebviewProxy={};
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    proof.requests.push({ origin: url.origin, pathname: url.pathname, method: request.method() });
    if (!origins.includes(url.origin) || request.method() !== 'GET') { proof.blocked.push({ origin: url.origin, pathname: url.pathname, method: request.method() }); return route.abort(); }
    if (url.pathname === '/' || url.pathname === '/first-event/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/vendor/walletconnect/2.26.0/walletconnect.bundle.js') return route.fulfill({ contentType: 'text/javascript', body: vendor });
    if (!['/wallet-connection.js', '/walletconnect.js', '/wallet-connection.css'].includes(url.pathname)) { proof.blocked.push({ origin: url.origin, pathname: url.pathname }); return route.abort(); }
    const body = await fs.readFile(path.join(ROOT, 'public', url.pathname.slice(1)));
    proof.source[url.pathname] = createHash('sha256').update(body).digest('hex');
    return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body });
  });
  const page = await context.newPage(); page.on('pageerror', error => proof.errors.push(error.message));
  await page.goto(PROD + '/', { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.ready);
  assert(!proof.requests.some(row => row.pathname === '/walletconnect.js' || row.pathname.includes('/vendor/')));
  proof.checks.push('Initial render has no wrapper/vendor load, WalletConnect API or wallet request');
  await page.locator('#connect').click(); await expect(page.locator('#status')).toHaveText('connected');
  await expect(page.locator('[data-wallet-connection]')).toHaveCount(0);
  assert(proof.requests.some(row => row.pathname === '/walletconnect.js'));
  proof.checks.push('The first no-provider Connect opens Reown directly through the original accounts request, with no native chooser or More wallets click');
  const effects = await page.evaluate(() => ({ ...window.effects, accounts: window.accounts }));
  assert.equal(proof.requests.filter(row => row.pathname.includes('/vendor/')).length, 1);
  assert.equal(effects.init, 1); assert.equal(effects.enable, 1); assert.equal(effects.open, 1); assert.deepEqual(effects.requests, []);
  assert.deepEqual(effects.accounts, ['0x1111111111111111111111111111111111111111']);
  proof.checks.push('The caller accounts request lazily loads one self-hosted vendor and returns the stable EIP1193 account without any sign/send request');

  for (const profile of ['', 'telegram']) {
    await page.goto(PROD + '/?' + profile, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.ready);
    await page.evaluate(() => { window.mockConnectMode='cancel'; });
    await page.locator('#connect').click(); await expect(page.locator('#status')).toHaveText('cancelled');
    await expect(page.locator('[data-wallet-connection]')).toHaveCount(0);
    assert.equal((await page.evaluate(() => window.connectionError)).code,4001);
    assert((await page.evaluate(() => window.connectionError.message)).includes('Connect again'));
    const beforeFallback=await page.evaluate(()=>({...window.effects}));
    await page.locator('#connect').click(); await expect(page.locator('[data-wallet-connection]')).toBeVisible();
    assert.equal(await page.locator('[data-wallet-app="metamask"]').getAttribute('href'),'https://link.metamask.io/dapp/'+page.url().slice(8));
    assert.equal(new URL(await page.locator('[data-wallet-app="trust"]').getAttribute('href')).searchParams.get('url'),page.url());
    assert.equal((await page.evaluate(()=>window.effects.enable)),beforeFallback.enable);
    await page.evaluate(()=>{window.mockConnectMode='success';});
    await page.locator('[data-wallet-more]').click();await expect(page.locator('#status')).toHaveText('connected');
    await expect(page.locator('[data-wallet-connection]')).toHaveCount(0);
    proof.checks.push((profile||'Safari')+' cancellation ends immediately; only the next explicit Connect offers browser links, and explicit More can retry Reown');
  }
  await page.goto(PROD+'/?injected', {waitUntil:'networkidle'});await page.waitForFunction(()=>window.ready);
  const beforeInjected=proof.requests.length;await page.locator('#connect').click();await expect(page.locator('#status')).toHaveText('connected');
  assert(!proof.requests.slice(beforeInjected).some(row=>row.pathname==='/walletconnect.js'||row.pathname.includes('/vendor/')));
  assert.deepEqual(await page.evaluate(()=>window.effects.requests),['eth_requestAccounts']);
  proof.checks.push('A current injected wallet stays first and never imports or opens Reown');

  await page.goto(PROD+'/?failure', {waitUntil:'networkidle'});await page.waitForFunction(()=>window.ready);
  await page.evaluate(()=>{window.mockConnectMode='init-fail';});await page.locator('#connect').click();await expect(page.locator('#status')).toHaveText('cancelled');
  assert.equal((await page.evaluate(()=>window.connectionError)).code,'WALLET_PICKER_UNAVAILABLE');
  await page.locator('#connect').click();await expect(page.locator('[data-wallet-connection]')).toBeVisible();
  await page.locator('[data-wallet-connection-cancel]').click();await expect(page.locator('#status')).toHaveText('cancelled');
  proof.checks.push('SDK initialization failure offers browser fallback only on an explicit subsequent Connect, without an automatic retry');

  await page.goto(PROD+'/?route#first', {waitUntil:'networkidle'});await page.waitForFunction(()=>window.ready);
  await page.evaluate(()=>{window.mockConnectMode='cancel';});await page.locator('#connect').click();await expect(page.locator('#status')).toHaveText('cancelled');
  await page.evaluate(()=>{location.hash='second';window.mockConnectMode='success';});
  await page.locator('#connect').click();await expect(page.locator('#status')).toHaveText('connected');
  await expect(page.locator('[data-wallet-connection]')).toHaveCount(0);
  proof.checks.push('Browser fallback is scoped to the exact cancelled page route and cannot follow navigation');
  await page.goto(PROD+'/?abort', {waitUntil:'networkidle'});await page.waitForFunction(()=>window.ready);
  await page.evaluate(()=>{window.mockConnectMode='abort';});await page.locator('#connect').click();await expect(page.locator('#status')).toHaveText('cancelled');
  await page.evaluate(()=>{window.mockConnectMode='success';});await page.locator('#connect').click();await expect(page.locator('#status')).toHaveText('connected');
  await expect(page.locator('[data-wallet-connection]')).toHaveCount(0);
  proof.checks.push('A disposed or aborted connection cannot arm browser fallback or trigger a second request automatically');
  const beforeCustom = proof.requests.length;
  await page.goto(CUSTOM+'/first-event/?ref=a%26b#event=synthetic&deposit=manage', {waitUntil:'networkidle'});await page.waitForFunction(()=>window.ready);
  await page.locator('#connect').click();await expect(page.locator('#status')).toHaveText('connected');
  await expect(page.locator('[data-wallet-connection]')).toHaveCount(0);
  assert(proof.requests.slice(beforeCustom).some(row=>row.pathname==='/walletconnect.js'&&row.origin===CUSTOM));
  assert.equal(new URL(page.url()).hash,'#event=synthetic&deposit=manage');
  proof.checks.push('The exact custom origin uses primary Reown and preserves the event route');
  for (const origin of rejectedOrigins) {
    const before = proof.requests.length;
    await page.goto(origin + '/', { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.ready);
    await page.locator('#connect').click(); await expect(page.locator('[data-wallet-connection]')).toBeVisible();
    await expect(page.locator('[data-wallet-more]')).toHaveCount(0);
    await page.locator('[data-wallet-connection-cancel]').click(); await expect(page.locator('#status')).toHaveText('cancelled');
    assert(!proof.requests.slice(before).some(row => row.pathname === '/walletconnect.js' || row.pathname.includes('/vendor/')));
  }
  proof.checks.push('Retired, unknown, preview and local origins expose no More wallets route and never import/load WalletConnect');
  assert.deepEqual(proof.blocked, []); assert.deepEqual(proof.errors, []);
  proof.effects = effects; proof.status = 'passed';
} catch (error) { proof.failure = { message: error.message, stack: error.stack }; proof.status = 'failed'; process.exitCode = 1; }
finally {
  await browser?.close(); await fs.writeFile(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, 'proof.json'), failure: proof.failure?.message }));
}
