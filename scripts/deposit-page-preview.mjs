// Loopback-only presentation preview. Uses sample public projections, never wallets,
// RPC, private app state, credentials, or financial routes. This is not product code.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT } from '../public/first-event/event.js';

const PUBLIC = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
export const SAMPLE_WALLET = `0x${'1'.repeat(40)}`;
export const SAMPLE_HASH = `0x${'a'.repeat(64)}`;
const OWNER = `0x${'f'.repeat(40)}`, BLOCK_HASH = `0x${'c'.repeat(64)}`;
export const PREVIEW_SCENARIOS = Object.freeze({
  current: 'Published attendance · 14 attendees · 0.01 ETH return',
  'current-connect': 'Published attendance · connect a sample wallet',
  'current-ready': 'Published attendance · payout release ready',
  'current-stale': 'Published attendance · stale status needs refresh',
  'current-released': 'Published attendance · payout round released',
  before: 'Before the event',
  pending: 'Deposit recorded · admission pending',
  registered: 'Deposit recorded · registered',
  organizer: 'After event · organizer preparing attendance',
  'organizer-24h': 'PROPOSED 24-hour organizer window · not deployed',
  challenge: 'Attended · challenge window open',
  omitted: 'Omitted registered wallet · challenge available',
  'no-no-shows': 'Everyone attended · deposit only',
  waiting: 'Own challenge · waiting for a match',
  'own-court': 'Own matched Kleros case · share protected',
  'other-court': 'Another wallet in Court · ordinary payout ready',
  finalization: 'Challenge windows complete · release transaction needed',
  finalized: 'Payout round released · delivery not verified',
  'finalized-court': 'Payout round released · own Court share reserved',
  unregistered: 'Unregistered pending deposit · recovery',
  fallback: 'No attendance list · fallback recovery',
  stale: 'Stale post-event snapshot',
  'missing-payout': 'Legacy snapshot · amount unavailable',
  'invalid-payout': 'Invalid payout projection · amount unavailable',
  unavailable: 'Before event · snapshot unavailable',
  'post-unavailable': 'After event · snapshot unavailable',
});
const scenarioName = value => Object.hasOwn(PREVIEW_SCENARIOS, value) ? value : 'before';
const start = Date.parse(EVENT.startsAt) / 1000, end = Date.parse(EVENT.endsAt) / 1000;
// Public recorded timing mirrored in sample data only. Production reads its API;
// neither the 14 synthetic wallets nor this deadline enter the product modules.
const PUBLISHED_CHALLENGE_END = 1793927711;
const currentScenario = scenario => scenario.startsWith('current');
export function previewClock(scenario) {
  const clocks = {
    current: PUBLISHED_CHALLENGE_END - 23 * 3600, 'current-connect': PUBLISHED_CHALLENGE_END - 23 * 3600,
    'current-ready': PUBLISHED_CHALLENGE_END + 1, 'current-stale': PUBLISHED_CHALLENGE_END + 3600,
    'current-released': PUBLISHED_CHALLENGE_END + 3600,
    before: start - 3 * 86400 - 3661, pending: start - 2 * 86400, registered: start - 2 * 86400,
    organizer: end + 3600, 'organizer-24h': end + 3600,
    challenge: end + 3600, omitted: end + 3600, 'no-no-shows': end + 3600,
    waiting: end + 26 * 3600, 'own-court': end + 26 * 3600, 'other-court': end + 26 * 3600,
    finalization: end + 26 * 3600, finalized: end + 27 * 3600, 'finalized-court': end + 27 * 3600,
    unregistered: end + 3600, fallback: start + 7 * 86400 + 3600, stale: end + 26 * 3600,
    'missing-payout': end + 3600, 'invalid-payout': end + 3600,
    unavailable: start - 86400, 'post-unavailable': end + 3600,
  };
  return clocks[scenarioName(scenario)];
}
export const previewWallet = scenario => ['organizer', 'organizer-24h'].includes(scenarioName(scenario)) ? OWNER : SAMPLE_WALLET;
export function previewSnapshot(scenario = 'before') {
  scenario = scenarioName(scenario);
  const now = previewClock(scenario);
  const open = ['before', 'pending', 'registered', 'organizer', 'organizer-24h', 'fallback', 'unavailable', 'post-unavailable'].includes(scenario);
  const finalized = ['finalized', 'finalized-court', 'current-released'].includes(scenario);
  const current = currentScenario(scenario), stale = ['stale', 'current-stale'].includes(scenario);
  const wallets = Array.from({ length: current ? 14 : 10 }, (_, index) => `0x${(index + 1).toString(16).repeat(40)}`);
  const zeroChallenge = () => ({ state: 0, depositWei: '0', matchDeadline: 0, localId: '0' });
  const ownOmitted = ['omitted', 'waiting', 'own-court', 'finalized-court'].includes(scenario);
  const allAttended = scenario === 'no-no-shows' || current;
  const unregistered = ['pending', 'unregistered'].includes(scenario);
  const stakers = wallets.filter((_, index) => !(unregistered && index === 0)).map(wallet => {
    const index = wallets.indexOf(wallet);
    const attended = !open && (allAttended || (ownOmitted ? index >= 1 && index <= 8 : index < 8));
    return { wallet, status: finalized && attended ? 2 : 1, attended, challenge: zeroChallenge() };
  });
  const own = stakers.find(row => row.wallet === SAMPLE_WALLET), other = stakers.find(row => row.wallet === wallets[9]);
  if (scenario === 'waiting') own.challenge = { state: 1, depositWei: '1000000000000000', matchDeadline: end + 47 * 3600, localId: '0' };
  if (['own-court', 'finalized-court'].includes(scenario)) own.challenge = { state: 2, depositWei: '1000000000000000', matchDeadline: end + 47 * 3600, localId: '7' };
  if (scenario === 'other-court') other.challenge = { state: 2, depositWei: '1000000000000000', matchDeadline: end + 47 * 3600, localId: '7' };
  const data = {
    schemaVersion: 1, kind: 'first-event-depositors', displayOnly: true,
    mode: EVENT.mode, instanceId: 'local-sample-deposit-preview', eventId: EVENT.id,
    chainId: EVENT.chainId, contract: EVENT.contract, status: stale ? 'stale' : 'current',
    checkedAt: new Date((now - (stale ? 3600 : 0)) * 1000).toISOString(), blockNumber: current ? 200 : 100, blockHash: BLOCK_HASH,
    depositors: wallets.map((wallet, index) => ({ wallet, totalReceivedWei: EVENT.depositWei,
      deposits: [{ txHash: index === 0 ? SAMPLE_HASH : `0x${(index + 1).toString(16).padStart(64, '0')}`,
        logIndex: 0, amountWei: EVENT.depositWei, blockNumber: 90 + index, blockHash: BLOCK_HASH }] })),
    eventState: {
      phase: finalized ? 'Finalized' : open ? 'Open' : 'Listed',
      owner: OWNER, eventStart: start, endsAt: end,
      // Current source uses start+7d. Only the explicitly labeled proposal fixture differs.
      claimDeadline: scenario === 'organizer-24h' ? end + 86400 : start + 7 * 86400,
      challengeEndsAt: open ? 0 : current ? PUBLISHED_CHALLENGE_END : end + 24 * 3600,
      challengeDepositWei: '1000000000000000', chainTimestamp: now - (stale ? 3600 : 0), stakers,
    },
  };
  const attended = stakers.filter(row => row.attended).length, cases = stakers.filter(row => row.challenge.state === 2);
  const initialShare = finalized ? BigInt(EVENT.depositWei) * BigInt(stakers.length) / BigInt(attended + cases.length) : 0n;
  data.payoutState = {
    schemaVersion: 1, kind: 'first-event-payout-state', eventId: EVENT.id, chainId: EVENT.chainId, contract: EVENT.contract,
    blockNumber: data.blockNumber, blockHash: data.blockHash, depositWei: EVENT.depositWei,
    stakerCount: stakers.length, attendeeCount: attended, payoutShareWei: String(initialShare), heldBackWei: String(initialShare * BigInt(cases.length)),
    cases: cases.map(row => ({ wallet: row.wallet, arbitratorDisputeId: '42', heldShareWei: String(finalized ? initialShare : 0n) })),
  };
  if (scenario === 'missing-payout') delete data.payoutState;
  if (scenario === 'invalid-payout') data.payoutState.blockHash = `0x${'d'.repeat(64)}`;
  return data;
}

function previewController(scenario) {
  const selected = !['before', 'unavailable', 'post-unavailable', 'current-connect'].includes(scenario);
  return `import { setDepositWallet } from './journey.js';
import { renderDepositReceipt } from './receipt-card.js';
const wallet = ${JSON.stringify(previewWallet(scenario))}, hash = ${JSON.stringify(SAMPLE_HASH)};
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
  note.textContent = 'Sample wallet · ' + wallet.slice(0, 6) + '…' + wallet.slice(-4) + ' · no real wallet connected';
  connect.disabled = true;
};
connect.addEventListener('click', showWallet);
document.querySelector('[data-copy-address]').disabled = true;
document.querySelector('[data-copy-address]').title = 'Payments are disabled in this local sample.';
if (connected) {
  showWallet();
  for (const node of document.querySelectorAll('.manual-option,.divider,.manual-deposit,.address-box')) node.hidden = true;
  if (wallet === ${JSON.stringify(SAMPLE_WALLET)}) renderDepositReceipt(receipt, { message: ${JSON.stringify(previewClock(scenario) >= end ? 'Sample original deposit receipt. Your attendance and payout status appear above. This is a visual example, not a real transaction.' : 'Sample deposit receipt. Copy this transaction ID for Luma. This is a visual example, not a real transaction.')}, hash, status: 'confirmed', forRegistration: ${JSON.stringify(previewClock(scenario) < end)} });
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
// External actions remain disabled even during a manual local browser preview.
document.addEventListener('click', event => { const link = event.target.closest?.('a');
if (link) { const target = new URL(link.href, location.href);
if (target.origin !== location.origin) { event.preventDefault();
document.querySelector('[data-preview-notice]').textContent = 'Financial review and external navigation are disabled in this sample. No evidence or transaction was submitted.'; } } }, true);
</script>`;
  const proposal = scenario === 'organizer-24h' ? '<strong class="preview-proposal">PROPOSED TIMING ONLY · 24 hours after event end · not deployed or enforced by the current contract</strong>' : '';
  const bar = `<aside class="local-preview-bar" aria-label="Local sample preview">
<strong>Local preview · sample data · payments disabled</strong>${proposal}
<label>Sample timeline <select data-preview-scenario>${options}</select></label>
<span data-preview-notice>${currentScenario(scenario) ? '14 example attendee wallets · 0.14 ETH · recorded challenge deadline mirrored for this sample.' : '10 example depositor wallets · 0.1 ETH historical deposits.'} No real wallet, payment, or backend connection.</span>
</aside>`;
  const style = `<style>.local-preview-bar{padding:12px 24px;background:#2e1d4c;color:#eeeaf5;border-bottom:1px solid #84739e;font:12px/1.5 Geist,system-ui,sans-serif;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 18px}.local-preview-bar label{display:flex;gap:8px;align-items:center}.local-preview-bar select{max-width:100%;font:inherit;color:#eeeaf5;background:#120e1c;border:1px solid #84739e;border-radius:6px;padding:8px}.local-preview-bar span,.preview-proposal{flex-basis:100%;text-align:center;color:#cac5d5}.preview-proposal{color:#ffcf88}@media(max-width:600px){.local-preview-bar{padding:12px 16px}.local-preview-bar label{display:block;width:100%}.local-preview-bar select{display:block;width:100%;margin-top:4px}}</style>`;
  return html.replace('</head>', `${setup}${style}</head>`).replace('<body>', `<body>${bar}`);
}

function actionPreviewHtml(scenario) {
  const sample = previewSnapshot(scenario), state = sample.eventState, own = state.stakers.find(row => row.wallet === previewWallet(scenario));
  const matched = own?.challenge.state === 2 || scenario === 'other-court';
  const waiting = own?.challenge.state === 1;
  const data = { scenario, eventId: EVENT.id, contract: EVENT.contract, wallet: previewWallet(scenario),
    matched, waiting, unregistered: scenario === 'unregistered', fallback: scenario === 'fallback',
    finalized: ['finalized', 'finalized-court'].includes(scenario), payoutShareWei: sample.payoutState?.payoutShareWei ?? '0' };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local sample · Event action review</title><link rel="stylesheet" href="/first-event/styles.css"><style>
  .sample-action{max-width:620px;margin:32px auto;padding:0 20px}.sample-banner{background:#2e1d4c;border-bottom:1px solid #84739e;padding:14px 20px;font:12px/1.6 Geist,system-ui,sans-serif}.sample-action .deposit-card{margin:20px 0}.sample-action h1{font-size:44px}.sample-action h2{font-size:26px}.sample-action p{font-size:14px}.sample-facts{font-size:13px;overflow-wrap:anywhere}.sample-facts dt{color:var(--muted);margin-top:10px}.sample-facts dd{margin:0}.sample-action textarea{width:100%;min-height:110px;background:var(--deep);color:var(--ink);border:1px solid var(--boundary);border-radius:8px;padding:12px}.sample-actions{display:flex;flex-wrap:wrap;gap:10px}.sample-action dialog{max-width:540px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:14px;padding:24px}.sample-action dialog::backdrop{background:#090612bb}
  </style></head><body><aside class="sample-banner"><strong>LOCAL ACTION PREVIEW · sample data · all transactions and evidence submissions disabled</strong></aside><main class="sample-action"><a href="/first-event/?preview=${scenario}">← Back to sample event status</a><p class="eyebrow">EXISTING REVIEW FLOW · LOCAL DEMONSTRATION</p><h1 data-action-preview-title></h1><section class="deposit-card"><h2 data-action-preview-heading></h2><p data-action-preview-note></p><dl class="sample-facts"><dt>Event contract</dt><dd>${EVENT.contract}</dd><dt>Sample wallet</dt><dd>${previewWallet(scenario)}</dd><dt data-action-cost-label>Separate transaction value</dt><dd data-action-cost></dd></dl><div class="sample-actions"><button class="button button-primary" type="button" data-preview-review>Preview wallet review</button><a class="button button-secondary" href="/first-event/?preview=${scenario}">Return to status</a></div></section><section class="deposit-card" data-sample-evidence hidden><h2>Attendance evidence</h2><p>Example evidence could include a dated venue photo, check-in record or organizer messages. This local preview does not upload files, publish evidence or submit anything to Court.</p><dl class="sample-facts"><dt>Sample Court dispute ID</dt><dd>42</dd><dt>Sample resolver local ID</dt><dd>7</dd></dl><label>Sample evidence URI<textarea readonly>https://evidence.example.invalid/attendance.json</textarea></label><button class="button button-secondary" disabled>Evidence submission disabled in local preview</button></section><dialog data-sample-review><h2>Sample wallet transaction review</h2><p data-review-message></p><p>This is a visual example. No wallet is connected and no transaction can be sent.</p><div class="sample-actions"><button class="button button-primary" disabled>Wallet signing disabled</button><button class="button button-secondary" type="button" data-sample-close>Close</button><a class="button button-secondary" href="/first-event/?preview=waiting" data-sample-next hidden>Show sample waiting challenge</a></div></dialog></main><script>
  const sample = ${JSON.stringify(data)};
  if (!location.hash) location.replace('/first-event/?preview=before');
  const params = new URLSearchParams(location.hash.slice(1)), view = params.get('view');
  const title = document.querySelector('[data-action-preview-title]'), heading = document.querySelector('[data-action-preview-heading]'), note = document.querySelector('[data-action-preview-note]'), cost = document.querySelector('[data-action-cost]');
  let mode = 'payout';
  if (view === 'organizer') mode = 'organizer';
  else if (sample.matched && view === 'cases') mode = 'evidence';
  else if (view === 'participant') mode = sample.matched ? 'evidence' : sample.waiting ? 'matching' : sample.unregistered || sample.fallback || sample.finalized ? 'recovery' : 'challenge';
  const definitions = {
    organizer:['Publish final attendance','Owner attendance review','The current event owner selects registered attendees and signs one on-chain attendance list after the event. That transaction starts the 24-hour omission challenge window. This sample does not publish a list.','0 ETH plus network fee'],
    challenge:['Challenge missing attendance','Review a separate challenge payment','Only a registered wallet missing from the posted list can challenge before its omission deadline. Opening a challenge starts a separate 24-hour matching period. A Kleros Court case is created only if someone contests it by matching the challenge payment.','0.001 ETH sample challenge payment, plus network fee'],
    matching:['Challenge waiting for match','Separate matching window','This challenge has already been opened. A separate 24-hour matching period is running; a Court case does not exist until another wallet contests it by matching. Ordinary payout release waits while a matching window remains open.','No additional payment is requested to view this sample'],
    evidence:['Kleros case & evidence','Matched Court case · sample dispute 42','This sample challenge has been matched, so a Court case exists. Its provisional payout share remains protected while confirmed attendees can receive ordinary payouts after matching windows finish. Evidence submission is a separately reviewed transaction.','0 ETH for sample evidence review, plus network fee'],
    payout:['Release eligible payouts','One payout-release transaction',sample.waiting?'A challenge is still waiting for a match, so ordinary release must wait for its matching deadline.':sample.finalized?'The payout round is already marked released. This status does not prove delivery to a particular wallet. Only failed delivery becomes owed credit for a separate claim.':'Once the omission and waiting matching windows have finished, anyone can submit releasePayouts. The transaction sends ETH directly to confirmed attendees and reserves shares for unresolved matched cases. Time passing alone sends no ETH.','0 ETH plus network fee'],
    recovery:['Review deposit recovery',sample.unregistered?'Recover unused pending credit':sample.fallback?'No attendance list · registered deposit recovery':'Review a failed delivery',sample.unregistered?'A historical deposit receipt does not register this wallet. Its current unused pending credit must be checked before withdrawal.':sample.fallback?'After the actual organizer deadline passes without a list, a registered attendee can review emergency withdrawal of their own deposit.':'A finalized round does not prove that this wallet was paid. The live review checks owed credit before preparing a claim; this sample makes no delivery claim.','0 ETH plus network fee'],
  };
  const selected = definitions[mode]; title.textContent=selected[0];heading.textContent=selected[1];note.textContent=selected[2];cost.textContent=selected[3];document.querySelector('[data-sample-evidence]').hidden=mode!=='evidence';
  const dialog=document.querySelector('[data-sample-review]');document.querySelector('[data-preview-review]').addEventListener('click',()=>{document.querySelector('[data-review-message]').textContent=selected[1]+' · '+selected[3];document.querySelector('[data-sample-next]').hidden=mode!=='challenge';dialog.showModal();});document.querySelector('[data-sample-close]').addEventListener('click',()=>dialog.close());
  </script></body></html>`;
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
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end('Local preview: writes and payments disabled.'); return; }
    if (pathname === '/') { response.writeHead(200, { 'Content-Type': mime['.html'] }).end(actionPreviewHtml(scenario)); return; }
    if (pathname === '/api/first-event/depositors') {
      response.setHeader('Content-Type', 'application/json');
      if (['unavailable', 'post-unavailable'].includes(scenario)) { response.writeHead(503).end(JSON.stringify({ error: 'Sample unavailable snapshot' })); return; }
      response.end(JSON.stringify(previewSnapshot(scenario))); return;
    }
    if (pathname.startsWith('/api/')) { response.writeHead(404).end('No production API in this local preview.'); return; }
    if (pathname === '/first-event/wallet.js') { response.setHeader('Content-Type', mime['.js']); response.end(previewController(scenario)); return; }
    // Full financial routes are deliberately inert here. Their links can be inspected,
    // but this presentation fixture does not load the production app or a signer.
    if (pathname === '/index.html') { response.writeHead(200, { 'Content-Type': mime['.html'] }).end('<!doctype html><p>Local preview: financial actions disabled. Return to the deposit preview.</p>'); return; }
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
