// Fast public presentation only. No wallet, transaction authority or chain reads.
import { EVENT, firstEventDepositorsPath } from './event.js';
import { depositSnapshotSummary } from './receipts.js';
import { savedEventState, postEventState, renderPostEvent } from './post-event.js';
export { savedEventState } from './post-event.js';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const uint = value => Number.isSafeInteger(value) && value >= 0;
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
export const formatEth = value => {
  const wei = BigInt(value), fraction = String(wei % 10n ** 18n).padStart(18, '0').replace(/0+$/, '');
  return `${wei / 10n ** 18n}${fraction ? '.' + fraction : ''}`;
};
let snapshotPromise, snapshotInFlight;
export function loadDepositSnapshot({ refresh = false } = {}) {
  if (snapshotInFlight) return snapshotInFlight;
  if (!refresh && snapshotPromise) return snapshotPromise;
  snapshotPromise = snapshotInFlight = (async () => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(firstEventDepositorsPath(EVENT), { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal });
      if (!response.ok) return null;
      // Each consumer validates its projection. The wallet retains its original
      // fail-closed receipt validation, including malformed/cross-event data.
      return await response.json();
    } catch { return null; }
    finally { clearTimeout(timeout); }
  })().finally(() => { snapshotInFlight = null; });
  return snapshotPromise;
}
const dateLabel = (seconds, event) => new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: event.timezone,
}).format(new Date(seconds * 1000));
export function timelineState(state, now = Date.now() / 1000, event = EVENT, { stale = false } = {}) {
  const start = Date.parse(event.startsAt) / 1000, end = Date.parse(event.endsAt) / 1000;
  const result = { countdownLabel: now < start ? 'Event starts in' : now < end ? 'Event ends in' : 'Event finished',
    target: now < start ? start : now < end ? end : null,
    event: `${event.dateLabel} · ${event.hoursLabel}`,
    attendance: 'Attend the event. Once attendance is posted, you have 24 hours to challenge a missing entry.',
    claim: 'After the challenge and matching windows, a payout-release transaction sends your deposit + any kickback to your wallet.',
    deadline: 'Payout time depends on attendance being finalized, not just the event ending.' };
  if (now >= end) result.countdownLabel = state ? 'Awaiting attendance list' : 'Attendance status not yet available';
  if (now >= end && state?.phase === 'Open' && now <= state.claimDeadline) {
    result.target = state.claimDeadline; result.countdownLabel = 'Organizer publication deadline';
    result.deadline = 'This is the existing on-chain deadline for this event. The 24-hour omission challenge window starts only after attendance is posted.';
  }
  if (state?.phase === 'Cancelled') return { ...result, countdownLabel: 'Event cancelled', target: null,
    attendance: 'Attendance is no longer being collected for this event.', claim: 'Open Manage deposit to check available refund or recovery.', deadline: 'Current funds are checked before any recovery transaction.' };
  if (state?.phase === 'Open' && now > state.claimDeadline) {
    result.countdownLabel = 'Attendance was not posted'; result.target = null;
    result.claim = 'Fallback recovery is now available. Open Manage deposit to check your refund.';
  }
  if (['Listed', 'Finalized'].includes(state?.phase)) {
    const lastMatch = state.stakers.filter(row => row.challenge.state === 1)
      .reduce((latest, row) => Math.max(latest, row.challenge.matchDeadline), 0);
    const remainingMatch = lastMatch >= now ? lastMatch : 0;
    result.attendance = `Attendance posted · challenge deadline ${dateLabel(state.challengeEndsAt, event)} (${event.timezone}). Each challenge has its own 24-hour matching window.`;
    if (state.phase === 'Finalized') {
      result.countdownLabel = 'Payouts released'; result.target = null;
      result.claim = 'The payout round has been released. Check your wallet; only disputed shares stay reserved. Failed delivery can be recovered in Manage deposit.';
      result.deadline = 'This saved event status does not prove a payment reached your wallet.';
    } else if (now <= state.challengeEndsAt) {
      result.countdownLabel = 'Challenge window closes in'; result.target = state.challengeEndsAt;
      result.deadline = 'Missing from the attendance list? Open Manage deposit before this deadline.';
    } else if (remainingMatch) {
      result.countdownLabel = 'Latest challenge matching window closes in'; result.target = remainingMatch;
      result.deadline = 'Each waiting challenge must finish its matching window before the payout round can start.';
    } else if (stale || !uint(state.chainTimestamp) || state.chainTimestamp <= Math.max(state.challengeEndsAt, lastMatch)) {
      result.countdownLabel = 'Refresh to check payout availability'; result.target = null;
      result.deadline = 'A fresh on-chain snapshot must confirm the time windows have ended. Time passing alone does not send ETH.';
    } else {
      result.countdownLabel = 'Awaiting payout release'; result.target = null;
      result.deadline = 'Open Kleros cases reserve their shares; other attendees can receive their payouts.';
    }
  }
  return result;
}
export function admissionState(snapshot, wallet, event = EVENT) {
  if (!wallet) return { title: 'Connect to see your status', note: 'Commit with a deposit, then add your details on Luma so the organizer can match your wallet and confirm your place.' };
  const state = savedEventState(snapshot, event), row = state?.stakers.find(item => same(item.wallet, wallet));
  if (state?.phase === 'Cancelled') return { title: 'Event cancelled · check your refund', note: 'Check your wallet or open Manage deposit for refund recovery. A saved status does not confirm delivery.', status: 'cancelled' };
  if ([1, 2].includes(row?.status)) return { title: 'Registered on contract', note: 'Your wallet is on the saved registration list. Attendance and payout are separate.', status: 'registered' };
  if (row?.status === 3) return { title: 'Registration declined on contract', note: 'Open Manage deposit to check recovery. Confirm event admission with the organizer.', status: 'declined' };
  const paid = snapshot?.depositors?.some(item => same(item.wallet, wallet));
  return { title: paid ? 'Commitment received · confirmation pending' : 'Your commitment starts here',
    note: paid ? 'Your deposit is recorded. Add your details and transaction ID on Luma so the organizer can confirm your place. Your place is confirmed when your wallet is registered.'
      : 'Deposit to record your commitment, then add your details on Luma. Your place is confirmed when the organizer registers your wallet.', status: 'pending' };
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
  let snapshot = null, disposed = false, previouslySaved = null, refreshFailed = false, refreshing = false;
  const put = (selector, text) => { const node = document.querySelector(selector); if (node && node.textContent !== text) node.textContent = text; };
  const snapshotNote = () => snapshot ? `${snapshot.status === 'stale' ? 'Saved snapshot · ' : ''}${new Date(snapshot.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : '';
  const savedStatus = () => snapshot && (refreshFailed || snapshot.status === 'stale' || Date.now() - Date.parse(snapshot.checkedAt) > 60000);
  const renderAfterEvent = () => {
    if (disposed) return;
    const display = snapshot && refreshFailed ? { ...snapshot, status: 'stale' } : snapshot;
    const model = postEventState(display, selectedWallet);
    renderPostEvent(document, model, { checkedAt: display?.checkedAt ?? null });
  };
  const renderAdmission = () => {
    if (disposed) return;
    const admission = admissionState(snapshot, selectedWallet);
    put('[data-admission-status]', `${selectedWallet && savedStatus() ? 'Saved status · ' : ''}${admission.title}`);
    put('[data-admission-note]', admission.note + (snapshot && selectedWallet ? ` Snapshot: ${snapshotNote()}.` : ''));
    const node = document.querySelector('[data-admission-status]'); if (node) node.dataset.status = admission.status ?? '';
    renderAfterEvent();
  };
  const tick = () => {
    if (disposed) return;
    const now = Date.now() / 1000, state = savedEventState(snapshot), timeline = timelineState(state, now, EVENT, { stale: !!savedStatus() });
    const fromSnapshot = state && (state.phase !== 'Open' || now >= state.endsAt);
    put('[data-event-countdown]', `${fromSnapshot && savedStatus() ? 'Saved status · ' : ''}${timeline.countdownLabel}${timeline.target ? ' · ' + duration(timeline.target - now) : ''}`);
    put('[data-timeline-event]', timeline.event); put('[data-timeline-attendance]', timeline.attendance);
    put('[data-timeline-claim]', timeline.claim);
    put('[data-timeline-deadline]', timeline.deadline + (snapshot ? ` Snapshot: ${snapshotNote()}.` : ''));
    if (previouslySaved !== savedStatus()) { previouslySaved = savedStatus(); renderAdmission(); }
    else renderAfterEvent();
  };
  tick(); renderAdmission();
  const timer = setInterval(tick, 1000);
  const onPageHide = event => { if (!event.persisted) mount.dispose(); };
  activeMount = { renderAdmission, dispose() { disposed = true; clearInterval(timer); window.removeEventListener('pagehide', onPageHide); } };
  const mount = activeMount;
  const refreshButton = document.querySelector('[data-post-event-refresh]');
  const refresh = async (force = true) => {
    if (disposed || refreshing) return;
    refreshing = true; if (refreshButton) refreshButton.disabled = true;
    try {
      const data = await loadDepositSnapshot({ refresh: force });
      if (disposed) return;
      if (!data) throw Error('Snapshot unavailable');
      depositSnapshotSummary(data); snapshot = data; refreshFailed = false;
      const summary = depositSnapshotSummary(snapshot);
      put('[data-commitment-count]', summary.walletCount.toLocaleString());
      put('[data-commitment-total]', formatEth(summary.totalReceivedWei));
      put('[data-pool-note]', `Unique depositor wallets · ETH deposited to date, including any later refunds. Not the current reward pool. ${snapshotNote()}.`);
    } catch {
      if (disposed) return;
      refreshFailed = true;
      if (!snapshot) put('[data-pool-note]', 'Deposit totals are temporarily unavailable. Event details and your original transaction references remain available.');
    } finally {
      refreshing = false; if (refreshButton) refreshButton.disabled = false;
      if (!disposed) { tick(); renderAdmission(); }
    }
  };
  const refreshClick = () => { void refresh(); };
  refreshButton?.addEventListener('click', refreshClick);
  const poll = setInterval(() => { if (!document.hidden && Date.now() >= Date.parse(EVENT.endsAt)) void refresh(); }, 60000);
  const visibility = () => { if (!document.hidden && Date.now() >= Date.parse(EVENT.endsAt)) void refresh(); };
  document.addEventListener('visibilitychange', visibility);
  const dispose = mount.dispose;
  mount.dispose = () => { dispose(); clearInterval(poll); refreshButton?.removeEventListener('click', refreshClick); document.removeEventListener('visibilitychange', visibility); };
  void refresh(false);
  window.addEventListener('pagehide', onPageHide);
  return mount;
}
