// Loopback-only presentation preview. Uses sample SQL projections, never wallets,
// RPC, private app state, credentials, or financial routes.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT } from '../public/first-event/event.js';

const PUBLIC = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
export const SAMPLE_WALLET = `0x${'1'.repeat(40)}`;
export const SAMPLE_HASH = `0x${'a'.repeat(64)}`;
const BLOCK_HASH = `0x${'c'.repeat(64)}`;
export const PREVIEW_SCENARIOS = Object.freeze({
  before: 'Before the event',
  pending: 'Deposit recorded · admission pending',
  registered: 'Deposit recorded · registered',
  challenge: 'Attendance challenge window',
  finalization: 'Awaiting organizer payout release',
  finalized: 'Payouts released',
  unavailable: 'Snapshot temporarily unavailable',
});
const scenarioName = value => Object.hasOwn(PREVIEW_SCENARIOS, value) ? value : 'before';
const start = Date.parse(EVENT.startsAt) / 1000, end = Date.parse(EVENT.endsAt) / 1000;
export function previewClock(scenario) {
  return ({ before: start - 3 * 86400 - 3661, pending: start - 2 * 86400, registered: start - 2 * 86400,
    challenge: end + 3600, finalization: end + 26 * 3600, finalized: end + 27 * 3600,
    unavailable: start - 86400 })[scenarioName(scenario)];
}
export function previewSnapshot(scenario = 'before') {
  scenario = scenarioName(scenario);
  const now = previewClock(scenario), listed = ['challenge', 'finalization', 'finalized'].includes(scenario);
  const wallets = Array.from({ length: 10 }, (_, index) => `0x${(index + 1).toString(16).repeat(40)}`);
  const zeroChallenge = () => ({ state: 0, depositWei: '0', matchDeadline: 0, localId: '0' });
  return {
    schemaVersion: 1, kind: 'first-event-depositors', displayOnly: true,
    mode: EVENT.mode, instanceId: 'local-sample-deposit-preview', eventId: EVENT.id,
    chainId: EVENT.chainId, contract: EVENT.contract, status: 'current',
    checkedAt: new Date(now * 1000).toISOString(), blockNumber: 100, blockHash: BLOCK_HASH,
    depositors: wallets.map((wallet, index) => ({ wallet, totalReceivedWei: EVENT.depositWei,
      deposits: [{ txHash: index === 0 ? SAMPLE_HASH : `0x${(index + 1).toString(16).padStart(64, '0')}`,
        logIndex: 0, amountWei: EVENT.depositWei, blockNumber: 90 + index, blockHash: BLOCK_HASH }] })),
    eventState: {
      phase: scenario === 'finalized' ? 'Finalized' : listed ? 'Listed' : 'Open',
      owner: `0x${'f'.repeat(40)}`, eventStart: start, endsAt: end,
      claimDeadline: end + 7 * 86400,
      challengeEndsAt: listed ? end + 24 * 3600 : 0,
      challengeDepositWei: '1000000000000000', chainTimestamp: now,
      stakers: wallets.map((wallet, index) => ({ wallet,
        status: scenario === 'pending' && index === 0 ? 0 : scenario === 'finalized' && index < 8 ? 2 : 1,
        attended: listed && index < 8, challenge: zeroChallenge() })),
    },
  };
}

function previewController(scenario) {
  const selected = !['before', 'unavailable'].includes(scenario);
  return `import { setDepositWallet } from './journey.js';
import { renderDepositReceipt } from './receipt-card.js';
const wallet = ${JSON.stringify(SAMPLE_WALLET)}, hash = ${JSON.stringify(SAMPLE_HASH)};
const connected = ${JSON.stringify(selected)};
const connect = document.querySelector('[data-connect-wallet]');
const deposit = document.querySelector('[data-deposit]');
const note = document.querySelector('[data-wallet-status]');
const receipt = document.querySelector('[data-tx-status]');
connect.textContent = connected ? 'Sample wallet connected' : 'Preview wallet';
connect.disabled = connected;
deposit.hidden = true;
const showWallet = () => {
  setDepositWallet(wallet);
  note.textContent = 'Sample wallet · 0x1111…1111 · no real wallet connected';
  connect.disabled = true;
};
connect.addEventListener('click', showWallet);
document.querySelector('[data-copy-address]').disabled = true;
document.querySelector('[data-copy-address]').title = 'Payments are disabled in this local sample.';
if (connected) {
  showWallet();
  for (const node of document.querySelectorAll('.manual-option,.divider,.manual-deposit,.address-box')) node.hidden = true;
  renderDepositReceipt(receipt, { message: 'Sample deposit receipt. Copy this transaction ID for Luma. This is a visual example, not a real transaction.', hash, status: 'confirmed' });
}
`;
}

function decorateHtml(html, scenario) {
  const options = Object.entries(PREVIEW_SCENARIOS).map(([value, label]) =>
    `<option value="${value}"${value === scenario ? ' selected' : ''}>${label}</option>`).join('');
  const clock = previewClock(scenario) * 1000;
  const setup = `<script>
// Presentation-only sample clock; this code is never part of the product build.
{ const NativeDate = Date, base = performance.now(), sample = ${clock};
window.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [sample + performance.now() - base])); }
  static now() { return sample + performance.now() - base; }
}; }
document.addEventListener('DOMContentLoaded', () => {
document.querySelector('[data-preview-scenario]').addEventListener('change', event => {
  const url = new URL(location.href); url.searchParams.set('preview', event.target.value); location.assign(url);
});
});
</script>`;
  const bar = `<aside class="local-preview-bar" aria-label="Local sample preview">
<strong>Local preview · sample data · payments disabled</strong>
<label>Sample timeline <select data-preview-scenario>${options}</select></label>
<span>10 example depositor wallets · 0.1 ETH deposited. No real wallet, payment, or backend connection.</span>
</aside>`;
  const style = `<style>.local-preview-bar{padding:12px 24px;background:#2e1d4c;color:#eeeaf5;border-bottom:1px solid #84739e;font:12px/1.5 Geist,system-ui,sans-serif;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 18px}.local-preview-bar label{display:flex;gap:8px;align-items:center}.local-preview-bar select{max-width:100%;font:inherit;color:#eeeaf5;background:#120e1c;border:1px solid #84739e;border-radius:6px;padding:8px}.local-preview-bar span{flex-basis:100%;text-align:center;color:#cac5d5}@media(max-width:600px){.local-preview-bar{padding:12px 16px}.local-preview-bar label{display:block;width:100%}.local-preview-bar select{display:block;width:100%;margin-top:4px}}</style>`;
  return html.replace('</head>', `${setup}${style}</head>`).replace('<body>', `<body>${bar}`);
}

export async function startDepositPagePreview({ port = 8790 } = {}) {
  const requests = [];
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1'), pathname = url.pathname;
    const referrer = new URL(request.headers.referer || '/', 'http://127.0.0.1');
    const scenario = scenarioName(url.searchParams.get('preview') || referrer.searchParams.get('preview'));
    requests.push({ method: request.method, pathname, scenario });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Local-Preview', 'sample-data-payments-disabled');
    response.setHeader('Referrer-Policy', 'same-origin');
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end('Local preview: writes and payments disabled.'); return; }
    if (pathname === '/') { response.writeHead(302, { Location: '/first-event/' }).end(); return; }
    if (pathname === '/api/first-event/depositors') {
      response.setHeader('Content-Type', 'application/json');
      if (scenario === 'unavailable') { response.writeHead(503).end(JSON.stringify({ error: 'Sample unavailable snapshot' })); return; }
      response.end(JSON.stringify(previewSnapshot(scenario))); return;
    }
    if (pathname.startsWith('/api/')) { response.writeHead(404).end('No production API in this local preview.'); return; }
    if (pathname === '/first-event/wallet.js') { response.setHeader('Content-Type', mime['.js']); response.end(previewController(scenario)); return; }
    const target = path.resolve(PUBLIC, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!target.startsWith(PUBLIC + path.sep)) { response.writeHead(404).end(); return; }
    try {
      let content = await fs.readFile(target);
      if (pathname === '/first-event/' || pathname === '/first-event/index.html') content = Buffer.from(decorateHtml(content.toString(), scenario));
      response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
      response.end(content);
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, requests, origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = await startDepositPagePreview({ port: Number(process.env.DEPOSIT_PREVIEW_PORT || 8790) });
  console.log(`Local sample preview (payments disabled): ${preview.origin}/first-event/`);
}
