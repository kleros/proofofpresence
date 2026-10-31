// Fast public presentation only. No wallet, transaction authority or chain reads.
import { EVENT, firstEventDepositorsPath } from './event.js';
import { depositSnapshotSummary } from './receipts.js';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const uint = value => Number.isSafeInteger(value) && value >= 0;
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
export const formatEth = value => {
  const wei = BigInt(value), fraction = String(wei % 10n ** 18n).padStart(18, '0').replace(/0+$/, '');
  return `${wei / 10n ** 18n}${fraction ? '.' + fraction : ''}`;
};
let snapshotPromise;
export function loadDepositSnapshot() {
  return snapshotPromise ??= (async () => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(firstEventDepositorsPath(EVENT), { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal });
      if (!response.ok) return null;
      // Each consumer validates its projection. The wallet retains its original
      // fail-closed receipt validation, including malformed/cross-event data.
      return await response.json();
    } catch { return null; }
    finally { clearTimeout(timeout); }
  })();
}
export function savedEventState(snapshot, event = EVENT) {
  const s = snapshot?.eventState;
  if (!s || !['Open', 'Listed', 'Finalized', 'Cancelled'].includes(s.phase) || !address(s.owner) ||
      !['eventStart', 'endsAt', 'claimDeadline', 'challengeEndsAt'].every(key => uint(s[key])) ||
      s.eventStart !== Date.parse(event.startsAt) / 1000 || s.endsAt !== Date.parse(event.endsAt) / 1000 ||
      s.claimDeadline <= s.endsAt || !Array.isArray(s.stakers) || s.stakers.length > 150) return null;
  const seen = new Set();
  for (const row of s.stakers) {
    const c = row?.challenge;
    if (!address(row?.wallet) || seen.has(row.wallet.toLowerCase()) || ![0, 1, 2, 3].includes(row.status) ||
        typeof row.attended !== 'boolean' || !c || ![0, 1, 2, 3].includes(c.state) || !uint(c.matchDeadline)) return null;
    seen.add(row.wallet.toLowerCase());
  }
  if (['Listed', 'Finalized'].includes(s.phase) && !s.challengeEndsAt) return null;
  return s;
}
const dateLabel = (seconds, event) => new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: event.timezone,
}).format(new Date(seconds * 1000));
export function timelineState(state, now = Date.now() / 1000, event = EVENT) {
  const start = Date.parse(event.startsAt) / 1000, end = Date.parse(event.endsAt) / 1000;
  const result = { countdownLabel: now < start ? 'Event starts in' : now < end ? 'Event ends in' : 'Event finished',
    target: now < start ? start : now < end ? end : null,
    event: `${event.dateLabel} · ${event.hoursLabel}`,
    attendance: 'Attend the event. Once attendance is posted, you have 24 hours to challenge a missing entry.',
    claim: 'After the challenge and matching windows, your deposit + any kickback is sent automatically when payouts are released.',
    deadline: 'Payout time depends on attendance being finalized, not just the event ending.' };
  if (now >= end) result.countdownLabel = state ? 'Awaiting attendance list' : 'Attendance status not yet available';
  if (state?.phase === 'Cancelled') return { ...result, countdownLabel: 'Event cancelled', target: null,
    attendance: 'Attendance is no longer being collected for this event.', claim: 'Open Manage deposit to check available refund or recovery.', deadline: 'Current funds are checked before any recovery transaction.' };
  if (state?.phase === 'Open' && now > state.claimDeadline) {
    result.countdownLabel = 'Attendance was not posted';
    result.claim = 'Fallback recovery is now available. Open Manage deposit to check your refund.';
  }
  if (['Listed', 'Finalized'].includes(state?.phase)) {
    const remainingMatch = state.stakers.filter(row => row.challenge.state === 1 && row.challenge.matchDeadline > now)
      .reduce((latest, row) => Math.max(latest, row.challenge.matchDeadline), 0);
    result.attendance = `Attendance posted · challenge deadline ${dateLabel(state.challengeEndsAt, event)} (${event.timezone}). Each challenge has its own 24-hour matching window.`;
    if (state.phase === 'Finalized') {
      result.countdownLabel = 'Payouts released'; result.target = null;
      result.claim = 'The organizer has released payouts. Check your wallet; only disputed shares stay reserved. Failed delivery can be recovered in Manage deposit.';
      result.deadline = 'This saved event status does not prove a payment reached your wallet.';
    } else if (now < state.challengeEndsAt) {
      result.countdownLabel = 'Challenge window closes in'; result.target = state.challengeEndsAt;
      result.deadline = 'Missing from the attendance list? Open Manage deposit before this deadline.';
    } else if (remainingMatch) {
      result.countdownLabel = 'Latest challenge matching window closes in'; result.target = remainingMatch;
      result.deadline = 'Each waiting challenge must finish its matching window before the payout round can start.';
    } else {
      result.countdownLabel = 'Awaiting organizer payout release'; result.target = null;
      result.deadline = 'Open Kleros cases reserve their shares; other attendees can receive their payouts.';
    }
  }
  return result;
}
export function admissionState(snapshot, wallet, event = EVENT) {
  if (!wallet) return { title: 'Connect to see your status', note: 'A deposit and event admission are separate. Complete your registration on Luma.' };
  const state = savedEventState(snapshot, event), row = state?.stakers.find(item => same(item.wallet, wallet));
  if (state?.phase === 'Cancelled') return { title: 'Event cancelled · check your refund', note: 'Check your wallet or open Manage deposit for refund recovery. A saved status does not confirm delivery.', status: 'cancelled' };
  if ([1, 2].includes(row?.status)) return { title: 'Registered on contract', note: 'Your wallet is on the saved registration list. Attendance and payout are separate.', status: 'registered' };
  if (row?.status === 3) return { title: 'Registration declined on contract', note: 'Open Manage deposit to check recovery. Confirm event admission with the organizer.', status: 'declined' };
  const paid = snapshot?.depositors?.some(item => same(item.wallet, wallet));
  return { title: paid ? 'Deposit received · admission not confirmed' : 'Admission not confirmed',
    note: 'Complete your Luma registration. The organizer must approve and register your wallet; payment alone does not reserve admission.', status: 'pending' };
}
let selectedWallet = null, activeMount = null;
export function setDepositWallet(wallet) {
  selectedWallet = address(wallet) ? wallet : null;
  activeMount?.renderAdmission();
}
const duration = seconds => {
  const total = Math.max(0, Math.ceil(seconds)), days = Math.floor(total / 86400), hours = Math.floor(total % 86400 / 3600),
    minutes = Math.floor(total % 3600 / 60), secs = total % 60;
  return `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
};
export function mountDepositJourney() {
  activeMount?.dispose();
  let snapshot = null, disposed = false, previouslySaved = null;
  const put = (selector, text) => { const node = document.querySelector(selector); if (node && node.textContent !== text) node.textContent = text; };
  const snapshotNote = () => snapshot ? `${snapshot.status === 'stale' ? 'Saved snapshot · ' : ''}${new Date(snapshot.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : '';
  const savedStatus = () => snapshot && (snapshot.status === 'stale' || Date.now() - Date.parse(snapshot.checkedAt) > 60000);
  const renderAdmission = () => {
    if (disposed) return;
    const admission = admissionState(snapshot, selectedWallet);
    put('[data-admission-status]', `${selectedWallet && savedStatus() ? 'Saved status · ' : ''}${admission.title}`);
    put('[data-admission-note]', admission.note + (snapshot && selectedWallet ? ` Snapshot: ${snapshotNote()}.` : ''));
    const node = document.querySelector('[data-admission-status]'); if (node) node.dataset.status = admission.status ?? '';
  };
  const tick = () => {
    if (disposed) return;
    const now = Date.now() / 1000, state = savedEventState(snapshot), timeline = timelineState(state, now);
    const fromSnapshot = state && (state.phase !== 'Open' || now >= state.endsAt);
    put('[data-event-countdown]', `${fromSnapshot && savedStatus() ? 'Saved status · ' : ''}${timeline.countdownLabel}${timeline.target ? ' · ' + duration(timeline.target - now) : ''}`);
    put('[data-timeline-event]', timeline.event); put('[data-timeline-attendance]', timeline.attendance);
    put('[data-timeline-claim]', timeline.claim);
    put('[data-timeline-deadline]', timeline.deadline + (snapshot ? ` Snapshot: ${snapshotNote()}.` : ''));
    if (previouslySaved !== savedStatus()) { previouslySaved = savedStatus(); renderAdmission(); }
  };
  tick(); renderAdmission();
  const timer = setInterval(tick, 1000);
  const onPageHide = event => { if (!event.persisted) mount.dispose(); };
  activeMount = { renderAdmission, dispose() { disposed = true; clearInterval(timer); window.removeEventListener('pagehide', onPageHide); } };
  const mount = activeMount;
  void loadDepositSnapshot().then(data => {
    if (disposed) return;
    try { if (data) depositSnapshotSummary(data); snapshot = data; }
    catch { snapshot = null; }
    if (snapshot) {
      const summary = depositSnapshotSummary(snapshot);
      put('[data-commitment-count]', summary.walletCount.toLocaleString());
      put('[data-commitment-total]', formatEth(summary.totalReceivedWei));
      put('[data-pool-note]', `Unique depositor wallets · ETH deposited to date, including any later refunds. Not the current reward pool. ${snapshotNote()}.`);
    } else put('[data-pool-note]', 'Deposit totals are temporarily unavailable. Event details and your deposit controls remain available.');
    tick(); renderAdmission();
  });
  window.addEventListener('pagehide', onPageHide);
  return mount;
}
