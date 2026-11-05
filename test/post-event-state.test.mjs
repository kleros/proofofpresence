import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../public/first-event/event.js';
import { postEventState, savedPayoutState, eventReviewPath } from '../public/first-event/post-event.js';
const now = Math.floor(Date.now() / 1000), W = n => '0x' + n.toString(16).repeat(40), H = n => '0x' + n.repeat(64);
const event = { ...EVENT, startsAt: new Date((now - 5 * 3600) * 1000).toISOString(), endsAt: new Date((now - 3600) * 1000).toISOString() };
const absent = () => ({ state: 0, depositWei: '0', matchDeadline: 0, localId: '0' });
function fixture(phase = 'Listed') {
  const rows = Array.from({ length: 10 }, (_, i) => ({ wallet: W(i + 1), status: phase === 'Finalized' && i < 8 ? 2 : 1, attended: phase !== 'Open' && i < 8, challenge: absent() }));
  const state = { phase, owner: W(15), eventStart: now - 5 * 3600, endsAt: now - 3600, claimDeadline: now + 6 * 86400,
    challengeEndsAt: ['Listed', 'Finalized'].includes(phase) ? now + 86400 : 0, chainTimestamp: now, stakers: rows };
  return { schemaVersion: 1, kind: 'first-event-depositors', displayOnly: true, mode: event.mode, instanceId: 'synthetic-post-event',
    eventId: event.id, chainId: 1, contract: event.contract, status: 'current', checkedAt: new Date(now * 1000).toISOString(), blockNumber: 100, blockHash: H('b'),
    eventState: state, depositors: rows.map((row, i) => ({ wallet: row.wallet, totalReceivedWei: event.depositWei,
      deposits: [{ txHash: '0x' + String(i + 1).padStart(64, '0'), logIndex: 0, amountWei: event.depositWei, blockNumber: 90 + i, blockHash: H('c') }] })),
    payoutState: { schemaVersion: 1, kind: 'first-event-payout-state', eventId: event.id, chainId: 1, contract: event.contract,
      blockNumber: 100, blockHash: H('b'), depositWei: event.depositWei, stakerCount: 10, attendeeCount: phase === 'Open' ? 0 : 8,
      payoutShareWei: phase === 'Finalized' ? '12500000000000000' : '0', heldBackWei: '0', cases: [] } };
}
const model = (data, wallet = W(1), at = now) => postEventState(data, wallet, { now: at, event });
function challenge(data, n, state = 1, deadline = now + 86400) {
  data.eventState.stakers[n - 1].challenge = { state, depositWei: '1000000000000000', matchDeadline: deadline, localId: String(n) };
  if (state === 2) data.payoutState.cases.push({ wallet: W(n), arbitratorDisputeId: String(n), heldShareWei: data.eventState.phase === 'Finalized' ? data.payoutState.payoutShareWei : '0' });
  data.payoutState.heldBackWei = data.payoutState.cases.reduce((total, row) => total + BigInt(row.heldShareWei), 0n).toString();
}
test('organizer publication uses exact existing deadline and no invented 24-hour post-event clock', () => {
  const data = fixture('Open'), view = model(data);
  assert.equal(view.state, 'awaiting-attendance'); assert.equal(view.target, data.eventState.claimDeadline);
  assert.equal(view.walletKind, 'registered-waiting'); assert.equal(view.amountWei, null);
  assert.match(view.message, /starts when that list is posted/); assert.match(view.amountNote, /existing contract deadline/);
  assert.equal(model(data, W(1), data.eventState.claimDeadline + 1).state, 'no-list');
  assert.match(model(data, W(1), data.eventState.claimDeadline + 1).primary.href, /view=participant&review=1/);
});
test('unpublished attendance never labels registrants as absent and keeps organizer management accessible', () => {
  const data = fixture('Open'), owner = model(data, data.eventState.owner);
  assert.equal(owner.walletKind, 'organizer'); assert.match(owner.walletTitle, /publish the attendance list/);
  assert.match(owner.walletNote, /saved snapshot/); assert.match(owner.walletNote, /check current permissions/);
  assert.equal(owner.primary.label, 'View attendance management'); assert.match(owner.primary.href, /view=organizer/);
  assert.deepEqual(owner.stats, [{ label: 'Registered wallets', value: '10' }]); assert.equal(owner.amountWei, null);
  for (const wallet of [W(1), W(14), null]) {
    const view = model(data, wallet); assert.deepEqual(view.stats.map(item => item.label), ['Registered wallets']);
    assert(!view.stats.some(item => /attendance list|Court/.test(item.label)));
  }
  const unregistered = model(data, W(14));
  assert.equal(unregistered.walletKind, 'unregistered'); assert.equal(unregistered.primary.label, 'Review unused deposit');
  assert.equal(unregistered.secondary.label, 'View attendance management'); assert.match(unregistered.secondary.href, /view=organizer/);
});
test('only verified same-block payout counters produce a provisional return; historic deposits cannot set the pool', () => {
  const data = fixture(), view = model(data);
  assert.equal(view.walletKind, 'attended'); assert.equal(view.amountWei, '12500000000000000');
  assert.equal(view.stats.find(row => row.label === 'Not on attendance list').value, '2');
  assert.match(view.amountLabel, /Provisional/); assert.match(view.amountNote, /can change/);
  data.depositors[0].deposits.push({ ...data.depositors[0].deposits[0], txHash: H('d') }); data.depositors[0].totalReceivedWei = String(BigInt(event.depositWei) * 2n);
  assert.equal(model(data).amountWei, '12500000000000000');
  delete data.payoutState; assert.equal(model(data).amountWei, null); assert.deepEqual(model(data).stats, []);
});
test('no no-shows means deposit only, without advertising a bonus or an automatic timed payment', () => {
  const data = fixture(); data.eventState.stakers.forEach(row => row.attended = true); data.payoutState.attendeeCount = 10;
  const view = model(data); assert.equal(view.amountWei, event.depositWei); assert.match(view.amountNote, /no no-show kickback/);
  assert.match(view.walletNote, /when someone releases/);
});
test('an omitted registered wallet gets existing challenge review, while unregistered receipt holders get recovery', () => {
  const data = fixture(); const omitted = model(data, W(10));
  assert.equal(omitted.walletKind, 'omitted'); assert.equal(omitted.primary.label, 'Challenge incorrect absence');
  assert.match(omitted.primary.href, /view=participant&deposit=manage/); assert.match(omitted.walletNote, /separate payment/);
  assert.match(omitted.walletNote, /Matching.*opens a Kleros/);
  data.eventState.stakers.pop(); data.payoutState.stakerCount--;
  const unregistered = model(data, W(10)); assert.equal(unregistered.walletKind, 'unregistered'); assert.match(unregistered.primary.label, /unused deposit/);
  assert.match(unregistered.walletNote, /cannot challenge/); assert.equal(unregistered.amountWei, null);
});
test('challenge and independent matching deadlines block release; a Court case reserves only its share', () => {
  const data = fixture(); data.eventState.challengeEndsAt = now - 1; challenge(data, 10, 1, now + 3600);
  const waiting = model(data, W(10)); assert.equal(waiting.state, 'matching-open'); assert.equal(waiting.target, now + 3600); assert.equal(waiting.walletKind, 'waiting');
  assert.equal(model(data, W(10), now + 3600).state, 'matching-open');
  assert.match(waiting.walletNote, /No Court case exists yet/);
  assert.equal(model(data).amountWei, '11111111111111111');
  data.eventState.stakers[9].challenge.state = 2; data.payoutState.cases = [{ wallet: W(10), arbitratorDisputeId: '0', heldShareWei: '0' }];
  const attended = model(data), disputed = model(data, W(10));
  assert.equal(attended.state, 'release-ready'); assert.match(attended.primary.href, /view=cases&review=1/);
  assert.match(attended.amountNote, /do not wait for the Court ruling/);
  assert.equal(disputed.walletKind, 'disputed'); assert.match(disputed.primary.label, /evidence/); assert.match(disputed.primary.href, /view=cases/);
});
test('expired unmatched challenge still needs settlement and a new challenge is never offered after its window', () => {
  const data = fixture(); data.eventState.challengeEndsAt = now - 3600; challenge(data, 10, 1, now - 1);
  assert.equal(model(data, W(10)).state, 'release-ready'); assert.match(model(data, W(10)).walletNote, /clock alone does not send ETH/);
  assert.doesNotMatch(model(data, W(9)).primary.label, /^Challenge/);
});
test('finalized status preserves uncertain ETH delivery and points claims to existing financial controls', () => {
  const data = fixture('Finalized'); data.eventState.challengeEndsAt = now - 3600;
  const paid = model(data); assert.equal(paid.state, 'finalized'); assert.equal(paid.amountWei, '12500000000000000');
  assert.equal(paid.amountLabel, 'Initial payout share'); assert.match(paid.walletNote, /does not confirm delivery/);
  assert.match(paid.primary.href, /view=cases&review=1/); assert.match(paid.amountNote, /not a delivery receipt/);
  data.payoutState.payoutShareWei = '11111111111111111'; challenge(data, 10, 2, now - 1800);
  const held = model(data, W(10)); assert.equal(held.walletKind, 'disputed'); assert.equal(held.amountWei, '11111111111111111');
  assert.equal(held.amountLabel, 'Your protected disputed share');
});
test('invalid, cross-event, mixed-checkpoint and impossible payout data suppress all financial estimates', () => {
  for (const mutate of [
    d => d.payoutState.eventId = 'different-event', d => d.payoutState.contract = W(14), d => d.payoutState.blockNumber++,
    d => d.payoutState.blockHash = H('d'), d => d.payoutState.depositWei = '1', d => d.payoutState.stakerCount++,
    d => d.payoutState.attendeeCount = 11, d => d.payoutState.attendeeCount = 7,
    d => d.payoutState.cases.push({ wallet: W(10), arbitratorDisputeId: '2', heldShareWei: '0' }),
    d => d.payoutState.heldBackWei = '1', d => d.payoutState.extra = true,
  ]) { const data = fixture(); mutate(data); assert.equal(savedPayoutState(data, event), null); assert.equal(model(data).amountWei, null); }
  for (const mutate of [d => d.payoutState.payoutShareWei = '100000000000000001', d => d.payoutState.payoutShareWei = '1',
    d => { challenge(d, 10, 2); d.payoutState.cases[0].heldShareWei = '1'; d.payoutState.heldBackWei = '1'; },
    d => challenge(d, 10, 1),
  ]) { const data = fixture('Finalized'); mutate(data); assert.equal(savedPayoutState(data, event), null); }
  for (const mutate of [d => d.eventId = 'other', d => d.chainId = 2, d => d.contract = W(14), d => d.eventState.eventStart++]) {
    const data = fixture(); mutate(data); assert.equal(model(data).state, 'unavailable'); assert.equal(model(data).amountWei, null);
  }
});
test('stale snapshots never present an amount as current; cancelled and disconnected views remain honest', () => {
  const data = fixture(); data.status = 'stale'; assert.equal(model(data).amountWei, null); assert.equal(model(data).stale, true);
  const disconnected = model(fixture(), null); assert.equal(disconnected.walletKind, 'disconnected'); assert.equal(disconnected.amountWei, null);
  const cancelled = fixture('Open'); cancelled.eventState.phase = 'Cancelled'; cancelled.eventState.stakers.forEach(row => row.status = 2);
  assert.equal(model(cancelled).state, 'cancelled'); assert.equal(model(cancelled).amountWei, null);
  assert.equal(eventReviewPath(event, 'cases'), '/#' + new URLSearchParams({ event: event.id, view: 'cases', review: '1' }));
});
test('release readiness needs a fresh chain checkpoint strictly past the challenge boundary', () => {
  const data = fixture(); data.eventState.challengeEndsAt = now + 1;
  assert.equal(model(data, W(1), now).state, 'challenge-open');
  assert.equal(model(data, W(1), now + 1).state, 'challenge-open');
  assert.equal(model(data, W(1), now + 2).state, 'awaiting-update', 'fast local clock cannot establish chain readiness');
  data.eventState.chainTimestamp = now + 2; data.checkedAt = new Date((now + 2) * 1000).toISOString();
  assert.equal(model(data, W(1), now + 2).state, 'release-ready');
  data.status = 'stale';
  const stale = model(data, W(1), now + 2);
  assert.equal(stale.state, 'awaiting-update'); assert.equal(stale.amountWei, null);
  assert.doesNotMatch(stale.title, /ready for review/); assert.match(stale.releaseNote, /Refresh/);
});
test('payout timing follows challenge and matching gates, while a disputed wallet has no promised payout date', () => {
  const data = fixture();
  const attendee = model(data);
  assert.equal(attendee.releaseAt, data.eventState.challengeEndsAt); assert.match(attendee.releaseLabel, /Earliest payout release/);
  assert.match(attendee.releaseNote, /transaction is required/); assert.match(attendee.primary.label, /payout details/);
  data.eventState.challengeEndsAt = now - 1; challenge(data, 10, 1, now + 3600);
  assert.equal(model(data).releaseAt, now + 3600);
  data.eventState.stakers[9].challenge.state = 2; data.payoutState.cases = [{ wallet: W(10), arbitratorDisputeId: '42', heldShareWei: '0' }];
  const disputed = model(data, W(10));
  assert.equal(disputed.releaseAt, null); assert.match(disputed.releaseNote, /no confirmed payout date/);
  const paid = fixture('Finalized'); paid.eventState.challengeEndsAt = now - 1;
  assert.match(model(paid).releaseLabel, /round released/); assert.match(model(paid).releaseNote, /If it failed/);
});
