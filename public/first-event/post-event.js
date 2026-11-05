// Public saved-state presentation only. Links open existing fresh wallet reviews.
// No result here grants permission, prepares a transaction or proves ETH delivery.
import { EVENT, firstEventRecoveryPath } from './event.js';
import { depositSnapshotSummary } from './receipts.js';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const uint = value => Number.isSafeInteger(value) && value >= 0;
const walletAddress = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
const amount = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const formatPostEventEth = value => {
  const wei = BigInt(value), fraction = String(wei % 10n ** 18n).padStart(18, '0').replace(/0+$/, '');
  return `${wei / 10n ** 18n}${fraction ? '.' + fraction : ''}`;
};
export const eventReviewPath = (event = EVENT, view = 'participant') => '/#' + new URLSearchParams({ event: event.id, view, review: '1' });
export function savedEventState(snapshot, event = EVENT) {
  const state = snapshot?.eventState;
  if (!state || !['Open', 'Listed', 'Finalized', 'Cancelled'].includes(state.phase) || !walletAddress(state.owner) ||
      !['eventStart', 'endsAt', 'claimDeadline', 'challengeEndsAt'].every(key => uint(state[key])) ||
      state.eventStart !== Date.parse(event.startsAt) / 1000 || state.endsAt !== Date.parse(event.endsAt) / 1000 ||
      state.claimDeadline <= state.endsAt || !Array.isArray(state.stakers) || state.stakers.length > 150) return null;
  const seen = new Set();
  for (const row of state.stakers) {
    if (!walletAddress(row?.wallet) || seen.has(row.wallet.toLowerCase()) || ![0, 1, 2, 3].includes(row.status) ||
        typeof row.attended !== 'boolean' || !row.challenge || ![0, 1, 2, 3].includes(row.challenge.state) || !uint(row.challenge.matchDeadline)) return null;
    seen.add(row.wallet.toLowerCase());
  }
  if (['Listed', 'Finalized'].includes(state.phase) && !state.challengeEndsAt) return null;
  return state;
}
export function savedPayoutState(snapshot, event = EVENT) {
  const state = savedEventState(snapshot, event), p = snapshot?.payoutState;
  if (!state || !exact(p, ['schemaVersion', 'kind', 'eventId', 'chainId', 'contract', 'blockNumber', 'blockHash', 'depositWei',
      'stakerCount', 'attendeeCount', 'payoutShareWei', 'heldBackWei', 'cases']) ||
      p.schemaVersion !== 1 || p.kind !== 'first-event-payout-state' || p.eventId !== event.id || p.chainId !== event.chainId ||
      !same(p.contract, event.contract) || p.blockNumber !== snapshot.blockNumber || p.blockHash !== snapshot.blockHash || !hash(p.blockHash) ||
      p.depositWei !== event.depositWei || !amount(p.depositWei) || !uint(p.stakerCount) || p.stakerCount > 150 ||
      !uint(p.attendeeCount) || p.attendeeCount > p.stakerCount || !amount(p.payoutShareWei) || !amount(p.heldBackWei) ||
      !Array.isArray(p.cases) || p.cases.length > 150) return null;
  const seen = new Set();
  for (const row of p.cases) {
    if (!exact(row, ['wallet', 'arbitratorDisputeId', 'heldShareWei']) || !walletAddress(row.wallet) || seen.has(row.wallet.toLowerCase()) ||
        !amount(row.arbitratorDisputeId) || !amount(row.heldShareWei) ||
        !state.stakers.some(staker => same(staker.wallet, row.wallet) && staker.challenge.state === 2)) return null;
    seen.add(row.wallet.toLowerCase());
  }
  const disputed = state.stakers.filter(row => row.challenge.state === 2);
  if (disputed.length !== p.cases.length || BigInt(p.heldBackWei) !== p.cases.reduce((sum, row) => sum + BigInt(row.heldShareWei), 0n)) return null;
  const active = state.stakers.filter(row => ['Open', 'Listed'].includes(state.phase) ? row.status === 1 : state.phase === 'Cancelled' ? row.status === 2 : [1, 2].includes(row.status));
  if (state.phase === 'Cancelled' && state.stakers.some(row => row.status === 1)) return null;
  if (active.length !== p.stakerCount || state.stakers.filter(row => row.attended).length !== p.attendeeCount ||
      state.stakers.some(row => row.attended && ![1, 2].includes(row.status))) return null;
  const waiting = state.stakers.filter(row => row.challenge.state === 1);
  if (state.stakers.some(row => [1, 2].includes(row.challenge.state) && (row.status !== 1 || row.attended)) ||
      p.attendeeCount + waiting.length + p.cases.length > p.stakerCount) return null;
  const pool = BigInt(p.depositWei) * BigInt(p.stakerCount), share = BigInt(p.payoutShareWei), held = BigInt(p.heldBackWei);
  if (pool >= 2n ** 256n || held > pool || share * BigInt(p.attendeeCount) + held > pool) return null;
  if (['Open', 'Cancelled'].includes(state.phase) && (p.attendeeCount !== 0 || waiting.length || p.cases.length || p.payoutShareWei !== '0' || held !== 0n)) return null;
  if (state.phase === 'Listed' && (p.attendeeCount === 0 || p.payoutShareWei !== '0' || held !== 0n || p.cases.some(row => row.heldShareWei !== '0'))) return null;
  if (state.phase === 'Finalized' && (p.attendeeCount === 0 || waiting.length || share < BigInt(p.depositWei) || share > pool ||
      p.cases.some(row => BigInt(row.heldShareWei) < share))) return null;
  return p;
}
function snapshotValid(snapshot, event) {
  try { depositSnapshotSummary(snapshot, event); return true; } catch { return false; }
}
const button = (label, href) => ({ label, href });
export function postEventState(snapshot, wallet = null, { now = Date.now() / 1000, event = EVENT } = {}) {
  const end = Date.parse(event.endsAt) / 1000;
  const valid = snapshotValid(snapshot, event), state = valid ? savedEventState(snapshot, event) : null;
  const visible = now >= end || ['Listed', 'Finalized', 'Cancelled'].includes(state?.phase);
  if (!visible) return { visible: false };
  const stale = !!snapshot && (snapshot.status === 'stale' || now - Date.parse(snapshot.checkedAt) / 1000 > 60 || Date.parse(snapshot.checkedAt) / 1000 > now + 5);
  const recovery = firstEventRecoveryPath(event), payouts = eventReviewPath(event, 'cases'), cases = eventReviewPath(event, 'cases');
  const model = { visible: true, state: 'unavailable', stale, title: 'Attendance status is unavailable',
    message: 'The event has ended. Refresh for its recorded attendance and challenge deadlines. No payment estimate is available yet.',
    deadlineLabel: '', target: null, stats: [], amountWei: null, amountLabel: '', amountNote: '',
    walletKind: wallet ? 'unavailable' : 'disconnected', walletTitle: wallet ? 'Your status needs a fresh update' : 'Connect to see your attendance',
    walletNote: wallet ? 'Your wallet connection alone does not establish registration, attendance or payment.' : 'Use the wallet that made your deposit. Connecting sends no transaction.',
    releaseLabel: '', releaseAt: null, releaseNote: '',
    primary: button('Manage your deposit', recovery), secondary: button('Review payout & recovery', eventReviewPath(event, 'participant')) };
  if (!state) return model;
  const payout = savedPayoutState(snapshot, event), row = walletAddress(wallet) ? state.stakers.find(item => same(item.wallet, wallet)) : null;
  const registered = row && [1, 2].includes(row.status), waiting = state.stakers.filter(item => item.challenge.state === 1);
  const openCases = state.stakers.filter(item => item.challenge.state === 2), lastMatch = waiting.reduce((max, item) => Math.max(max, item.challenge.matchDeadline), 0);
  model.state = state.phase === 'Open' ? now > state.claimDeadline ? 'no-list' : 'awaiting-attendance'
    : state.phase === 'Cancelled' ? 'cancelled' : state.phase === 'Finalized' ? 'finalized'
      : now <= state.challengeEndsAt ? 'challenge-open' : now <= lastMatch ? 'matching-open'
        : !stale && uint(state.chainTimestamp) && state.chainTimestamp > Math.max(state.challengeEndsAt, lastMatch) ? 'release-ready' : 'awaiting-update';
  if (model.state === 'awaiting-attendance') {
    model.title = 'The organizer is preparing attendance';
    model.message = 'The owner must post the registered attendees who were present. Your 24-hour challenge window starts when that list is posted on-chain.';
    model.deadlineLabel = 'Organizer publication deadline'; model.target = state.claimDeadline;
    model.amountNote = 'This event uses its existing contract deadline shown above. Attendance has not been posted, so no one is marked as a no-show here.';
    model.primary = button('View attendance management', '/#' + new URLSearchParams({ event: event.id, view: 'organizer' }));
  } else if (model.state === 'no-list') {
    model.title = 'Attendance was not posted by the deadline';
    model.message = 'The contract is still Open after the organizer deadline. Registered wallets can review no-list recovery; unused pending credit has its own recovery route.';
    model.primary = button('Review deposit recovery', eventReviewPath(event, 'participant'));
  } else if (model.state === 'cancelled') {
    model.title = 'This event was cancelled';
    model.message = 'Check your wallet for a refund. Failed deliveries and any unused pending credit can be reviewed separately.';
    model.primary = button('Review refunds & recovery', eventReviewPath(event, 'participant'));
  } else if (model.state === 'finalized') {
    model.title = 'The payout round has been released';
    model.message = 'The release transaction attempted payment to established attendees. A saved payout status does not prove ETH reached your wallet.';
    model.primary = button('Review transfers & failed payments', payouts);
    model.amountNote = 'If a delivery failed, that payment remains owed to the recipient and can be claimed through the reviewed recovery flow.';
  } else if (model.state === 'awaiting-update') {
    model.title = 'Refresh to check payout availability';
    model.message = 'The last recorded deadline has passed on your device. Refresh to check the latest on-chain attendance and any challenge matching windows.';
    model.amountNote = 'The countdown reaching zero does not release ETH. A fresh status check and a payout-release transaction are still required.';
    model.primary = button('View payout details', payouts);
  } else {
    const challengesOpen = model.state === 'challenge-open', matchingOpen = model.state === 'matching-open';
    model.title = challengesOpen ? 'Attendance is posted · challenge window open' : matchingOpen ? 'A challenge is waiting for a match' : 'Attendance payouts are ready for review';
    model.message = challengesOpen ? 'Check whether your registered wallet is on the attendance list. If you attended and were omitted, raise a challenge before the deadline.'
      : matchingOpen ? 'Each attendance challenge has its own 24-hour matching window. Payout release waits for any unexpired matching window.'
        : 'The challenge and matching windows have cleared in this snapshot. Someone must submit the payout-release transaction before ETH is sent.';
    model.deadlineLabel = challengesOpen ? 'Challenge window closes' : matchingOpen ? 'Latest matching window closes' : '';
    model.target = challengesOpen ? state.challengeEndsAt : matchingOpen ? lastMatch : null;
    model.amountNote = openCases.length ? 'Open Kleros cases reserve their shares. Other established attendees can receive ETH once the time windows permit release; they do not wait for the Court ruling.'
      : 'The payout-release transaction sends ETH directly to established attendees. Normal recipients do not make a separate claim.';
    model.primary = button(challengesOpen ? 'Review your attendance' : matchingOpen ? 'Review attendance challenges' : 'Review payout release', challengesOpen ? recovery : matchingOpen ? cases : payouts);
  }
  if (payout) model.stats = state.phase === 'Open'
    ? [{ label: 'Registered wallets', value: String(payout.stakerCount) }]
    : [
      { label: 'Registered wallets', value: String(payout.stakerCount) },
      { label: 'On attendance list', value: String(payout.attendeeCount) },
      { label: 'Not on attendance list', value: String(payout.stakerCount - payout.attendeeCount) },
      { label: 'Open Court cases', value: String(openCases.length) },
    ];
  if (!wallet) return model;
  if (state.phase === 'Cancelled') {
    model.walletKind = 'cancelled'; model.walletTitle = 'Review your refund or recovery';
    model.walletNote = 'A historical deposit receipt does not prove a refund was delivered or show your current unused credit.'; return model;
  }
  if (model.state === 'awaiting-attendance' && same(wallet, state.owner)) {
    model.walletKind = 'organizer'; model.walletTitle = 'Review and publish the attendance list';
    model.walletNote = 'Your connected wallet matches the organizer in this saved snapshot. Open attendance management to check current permissions, review who attended and post the on-chain list. The challenge window starts after publication.';
    return model;
  }
  if (!registered) {
    if (model.state === 'awaiting-attendance') model.secondary = model.primary;
    model.walletKind = 'unregistered'; model.walletTitle = row?.status === 3 ? 'Your registration was declined' : 'Your wallet is not registered';
    model.walletNote = 'Depositing alone does not put a wallet in the attendance/reward pool. Check unused pending credit with the original wallet; an unregistered wallet cannot challenge an attendance omission.';
    model.primary = button('Review unused deposit', recovery); return model;
  }
  if (state.phase === 'Open') {
    model.walletKind = 'registered-waiting'; model.walletTitle = model.state === 'no-list' ? 'Review no-list recovery' : 'Your wallet is registered · awaiting attendance';
    model.walletNote = model.state === 'no-list' ? 'No financial attendance list was posted by the contract deadline. Review recovery rather than an attendance challenge.'
      : 'Your final attendance status appears after the owner posts the on-chain list. The challenge clock has not started.'; return model;
  }
  const challenge = row.challenge;
  if (row.attended) {
    model.walletKind = 'attended'; model.walletTitle = state.phase === 'Finalized' ? 'Your attendance is included in the payout round' : 'You are on the attendance list';
    model.walletNote = state.phase === 'Finalized' ? 'Check actual wallet transfers. If delivery failed, review the reserved owed payment; this screen does not confirm delivery.'
      : 'You do not need to challenge your attendance. Your deposit and any kickback are sent when someone releases the payout round.';
    if (state.phase === 'Listed') {
      if (model.state === 'challenge-open') {
        model.title = 'Attendance confirmed';
        model.message = 'You are on the attendance list. No action is needed during the challenge period.';
      }
      model.releaseLabel = model.state === 'release-ready' ? 'Ready for payout release'
        : model.state === 'awaiting-update' ? 'Payout availability needs an update' : 'Earliest payout release';
      model.releaseAt = ['challenge-open', 'matching-open'].includes(model.state) ? Math.max(state.challengeEndsAt, lastMatch) : null;
      model.releaseNote = model.state === 'awaiting-update'
        ? 'Refresh status before relying on payout availability. No payout has been confirmed by this snapshot.'
        : model.state === 'release-ready'
          ? 'A payout-release transaction is required to send ETH to your wallet. No separate claim is needed if the transfer succeeds.'
          : 'A payout-release transaction is required after this time. It sends ETH to your wallet; no separate claim is needed if the transfer succeeds.';
      if (openCases.length) model.releaseNote += ' Unresolved Court cases keep their own shares reserved.';
      if (model.state !== 'release-ready') model.primary = button('View payout details', payouts);
    } else {
      model.releaseLabel = 'Payout round released';
      model.releaseNote = 'Check your wallet for the transfer. If it failed, the existing recovery screen checks whether a payment is owed before preparing a claim.';
    }
    if (payout && !stale) {
      if (state.phase === 'Finalized') {
        model.amountWei = payout.payoutShareWei; model.amountLabel = 'Initial payout share';
        model.amountNote += ' Later dispute settlements may add top-ups. This amount is not a delivery receipt.';
      } else {
        const shares = payout.attendeeCount + waiting.length + openCases.length;
        if (shares > 0 && shares <= payout.stakerCount) {
          model.amountWei = String(BigInt(payout.depositWei) * BigInt(payout.stakerCount) / BigInt(shares));
          model.amountLabel = 'Estimated return';
          model.amountNote += payout.attendeeCount === payout.stakerCount ? ' Everyone registered is currently on the list: the expected return is the original deposit, with no no-show kickback.'
            : ' This estimate assumes every current waiting challenge is accepted or reserves a share. Accepted challenges and later Court results can change it. “Not on the list” is provisional while challenges remain possible.';
        }
      }
    }
  } else if (challenge.state === 1) {
    model.walletKind = 'waiting'; model.walletTitle = 'Your attendance challenge is waiting for a match';
    model.walletNote = now <= challenge.matchDeadline ? 'No Court case exists yet. Another wallet may match the challenge payment before its matching deadline. An unmatched challenge can be accepted after that window.'
      : 'Your matching window expired without a match. A settlement or payout-release transaction must accept the challenge; the clock alone does not send ETH.';
    model.primary = button('Review your challenge', cases);
  } else if (challenge.state === 2) {
    model.walletKind = 'disputed'; model.walletTitle = 'Your attendance is being decided by Kleros Court';
    model.walletNote = 'Review the matched case and submit your attendance evidence through the reviewed evidence flow. Your share stays protected while ordinary attendees can receive their payouts after the time windows.';
    model.primary = button('Review case & attendance evidence', cases);
    model.releaseLabel = 'Your payout waits for the Court decision';
    model.releaseNote = 'Your disputed share remains reserved. There is no confirmed payout date for this wallet while its case is unresolved.';
    const held = payout?.cases.find(item => same(item.wallet, wallet));
    if (held && state.phase === 'Finalized' && !stale && BigInt(held.heldShareWei) > 0n) { model.amountWei = held.heldShareWei; model.amountLabel = 'Your protected disputed share'; }
  } else if (challenge.state === 3) {
    model.walletKind = 'resolved-absent'; model.walletTitle = 'Your attendance challenge has been settled';
    model.walletNote = 'Your wallet is not included as attended in this snapshot. Review the case result and any challenge-payment transfers separately.';
    model.primary = button('Review settled case', cases);
  } else {
    const canChallenge = state.phase === 'Listed' && now <= state.challengeEndsAt;
    model.walletKind = 'omitted'; model.walletTitle = canChallenge ? 'You are not on the attendance list' : 'The attendance challenge deadline has passed';
    model.walletNote = canChallenge ? 'If you attended, challenge this omission before the deadline. Raising a challenge requires a separate payment. Matching that challenge opens a Kleros Court case; evidence can then be submitted.'
      : 'A new attendance challenge cannot be opened after this deadline. Review the on-chain list and any existing case or recovery options.';
    model.primary = button(canChallenge ? 'Challenge incorrect absence' : 'Review attendance & recovery', canChallenge ? recovery : payouts);
  }
  if (!payout) model.amountNote += ' Payout amounts and registration totals are unavailable in this saved snapshot.';
  if (stale) {
    model.amountWei = null; model.amountLabel = '';
    if (model.releaseAt !== null) { model.releaseLabel = 'Last recorded payout timing'; model.releaseNote = 'This is saved information. Refresh to check the latest time windows and payout availability.'; }
    model.amountNote += ' Saved snapshot: refresh before relying on deadlines or amounts. Existing action screens perform fresh checks.';
  }
  return model;
}

export function renderPostEvent(root, model, { now = Date.now() / 1000, event = EVENT, checkedAt = null } = {}) {
  const panel = root.querySelector('[data-post-event]'); if (!panel) return;
  panel.hidden = !model.visible;
  const host = root.documentElement ?? root;
  host.classList.toggle('post-event-view', !!model.visible);
  const heading = root.querySelector('[data-event-page-label]'); if (heading) heading.textContent = model.visible ? 'EVENT STATUS' : 'YOUR EVENT DEPOSIT';
  const skip = root.querySelector('.skip-link'); if (skip) skip.textContent = model.visible ? 'Skip to attendance and payout status' : 'Skip to deposit';
  if (typeof root.title === 'string') root.title = model.visible ? 'Truth Pays · Attendance & payout' : 'Truth Pays · Event deposit';
  const closed = now >= Date.parse(event.startsAt) / 1000 || !!model.visible;
  host.classList.toggle('deposit-closed-view', closed);
  const closure = root.querySelector('[data-deposit-closed-note]'); if (closure) closure.hidden = !closed || !!model.visible;
  const copy = root.querySelector('[data-copy-address]'); if (closed && copy) copy.disabled = true;
  const card = root.querySelector('.deposit-card'); if (card) card.setAttribute('aria-labelledby', model.visible ? 'post-event-title' : 'deposit-title');
  const receipt = root.querySelector('[data-post-event-receipt]');
  if (receipt && model.visible && !receipt.dataset.statusView) { receipt.open = false; receipt.dataset.statusView = 'true'; }
  if (!model.visible) return;
  panel.dataset.state = model.state; panel.dataset.walletState = model.walletKind;
  const put = (key, value) => { const node = panel.querySelector(`[data-post-event-${key}]`); if (node) node.textContent = value; };
  const personal = !['attended', 'disconnected', 'unavailable', 'organizer'].includes(model.walletKind);
  const title = model.walletKind === 'disconnected' ? 'Check your attendance' : personal ? model.walletTitle : model.title;
  const message = model.walletKind === 'disconnected' ? 'Connect the wallet you used to deposit.' : personal ? model.walletNote : model.message;
  put('title', `${model.stale ? 'Saved status · ' : ''}${title}`); put('message', message);
  const deadline = model.target ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone }).format(new Date(model.target * 1000)) : '';
  const left = model.target ? Math.max(0, Math.ceil(model.target - now)) : 0;
  const hours = Math.floor(left / 3600), minutes = Math.floor(left % 3600 / 60);
  const remaining = `${hours}h ${String(minutes).padStart(2, '0')}m remaining`;
  put('countdown', model.target ? model.walletKind === 'attended' && model.releaseAt === model.target
    ? `${model.deadlineLabel} · ${remaining}` : `${model.deadlineLabel} · ${deadline} (${event.timezone}) · ${remaining}` : '');
  panel.querySelector('[data-post-event-countdown]').hidden = !model.target;
  put('wallet-title', model.walletTitle); put('wallet-note', model.walletNote);
  const stats = panel.querySelector('[data-post-event-stats]'); stats.replaceChildren();
  for (const item of model.stats) { const group = document.createElement('div'), term = document.createElement('dt'), value = document.createElement('dd'); term.textContent = item.label; value.textContent = item.value; group.append(term, value); stats.append(group); }
  stats.hidden = !model.stats.length;
  put('amount', model.amountWei === null ? '' : `${formatPostEventEth(model.amountWei)} ETH`);
  put('amount-label', model.amountLabel); put('estimate-note', model.amountNote);
  panel.querySelector('[data-post-event-estimate]').hidden = model.amountWei === null;
  const release = panel.querySelector('[data-post-event-release]');
  if (release) {
    release.hidden = !model.releaseLabel;
    put('release-label', model.releaseLabel); put('release-note', model.releaseNote);
    const time = panel.querySelector('[data-post-event-release-date]');
    time.hidden = !model.releaseAt;
    if (model.releaseAt) {
      time.dateTime = new Date(model.releaseAt * 1000).toISOString();
      const zone = event.timezone === 'Asia/Kolkata' ? 'IST' : event.timezone;
      time.textContent = `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium', timeZone: event.timezone }).format(new Date(model.releaseAt * 1000))} (${zone})`;
    } else { time.removeAttribute('datetime'); time.textContent = ''; }
    const local = panel.querySelector('[data-post-event-release-local]'), localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    local.hidden = !model.releaseAt || localZone === event.timezone;
    local.textContent = local.hidden ? '' : `Your local time · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(model.releaseAt * 1000))}`;
  }
  for (const key of ['primary', 'secondary']) { const node = panel.querySelector(`[data-post-event-${key}]`), action = model[key]; node.hidden = !action || (key === 'primary' && (model.walletKind === 'disconnected' || model.walletKind === 'attended' && !['release-ready', 'finalized'].includes(model.state))); if (action) { node.textContent = action.label; node.href = action.href; } }
  put('snapshot', checkedAt ? `${model.stale ? 'Saved status' : 'Last checked'} · ${new Date(checkedAt).toLocaleString()}` : 'Latest on-chain status is unavailable.');
}
