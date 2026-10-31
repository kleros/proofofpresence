import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../public/first-event/event.js';
import { depositSnapshotSummary } from '../public/first-event/receipts.js';
import { savedEventState, timelineState, admissionState, formatEth } from '../public/first-event/journey.js';
const wallet = '0x' + '1'.repeat(40), H = digit => '0x' + digit.repeat(64);
const start = Date.parse(EVENT.startsAt) / 1000, end = Date.parse(EVENT.endsAt) / 1000;
const state = () => ({ phase: 'Open', owner: '0x' + '2'.repeat(40), eventStart: start, endsAt: end,
  claimDeadline: end + 7 * 86400, challengeEndsAt: 0, stakers: [] });
const fixture = () => ({ schemaVersion: 1, kind: 'first-event-depositors', displayOnly: true, mode: EVENT.mode,
  instanceId: 'synthetic-journey', eventId: EVENT.id, chainId: 1, contract: EVENT.contract,
  status: 'current', checkedAt: new Date().toISOString(), blockNumber: 100, blockHash: H('b'), eventState: state(),
  depositors: [{ wallet, totalReceivedWei: EVENT.depositWei, deposits: [{ txHash: H('a'), logIndex: 0,
    amountWei: EVENT.depositWei, blockNumber: 99, blockHash: H('c') }] }] });
test('unique historical payers and exact bigint totals do not multiply commitments for repeat payments', () => {
  const data = fixture(); data.depositors[0].deposits.push({ ...data.depositors[0].deposits[0], txHash: H('d') });
  data.depositors[0].totalReceivedWei = String(BigInt(EVENT.depositWei) * 2n);
  const summary = depositSnapshotSummary(data);
  assert.equal(summary.walletCount, 1); assert.equal(summary.totalReceivedWei, '20000000000000000');
  assert.equal(formatEth(summary.totalReceivedWei), '0.02');
  for (const change of [d => d.eventId = 'other', d => d.contract = wallet, d => d.depositors[0].totalReceivedWei = '1',
    d => d.depositors[0].deposits[1].txHash = H('a')]) {
    const bad = structuredClone(data); change(bad); assert.throws(() => depositSnapshotSummary(bad));
  }
});
test('event end never invents a challenge or payout countdown; posting begins its actual deadline', () => {
  const s = state();
  assert.equal(timelineState(s, start - 60).target, start);
  assert.equal(timelineState(s, start + 60).target, end);
  assert.equal(timelineState(s, end + 60).target, null);
  assert.match(timelineState(s, end + 60).countdownLabel, /Awaiting attendance/);
  s.phase = 'Listed'; s.challengeEndsAt = end + 5 * 86400;
  assert.equal(timelineState(s, end + 60).target, s.challengeEndsAt);
  assert.match(timelineState(s, s.challengeEndsAt + 1).countdownLabel, /Awaiting organizer/);
  s.stakers.push({ challenge: { state: 1, matchDeadline: s.challengeEndsAt + 1800 } });
  assert.equal(timelineState(s, s.challengeEndsAt + 1).target, s.challengeEndsAt + 1800);
  s.phase = 'Finalized';
  assert.equal(timelineState(s, s.challengeEndsAt + 2).target, null);
  assert.match(timelineState(s, s.challengeEndsAt + 2).deadline, /does not prove a payment/);
});
test('deposit receipts alone never become admission, attendance or payment confirmation', () => {
  const data = fixture();
  assert.match(admissionState(data, wallet).title, /admission not confirmed/);
  data.eventState.stakers.push({ wallet, status: 1, attended: false, challenge: { state: 0, matchDeadline: 0 } });
  assert.equal(admissionState(data, wallet).title, 'Registered on contract');
  assert.match(admissionState(data, null).title, /Connect/);
  const wrongTerms = structuredClone(data); wrongTerms.eventState.eventStart++;
  assert.equal(savedEventState(wrongTerms), null);
  assert.match(admissionState(wrongTerms, wallet).title, /admission not confirmed/);
});
test('fallback threshold opens recovery and a cancelled Paid row is never advertised as active admission', () => {
  const data = fixture();
  const refund = timelineState(data.eventState, data.eventState.claimDeadline + 1);
  assert.match(refund.claim, /Fallback recovery is now available/);
  assert.doesNotMatch(refund.claim, /deadline has passed/);
  data.eventState.phase = 'Cancelled';
  data.eventState.stakers.push({ wallet, status: 2, attended: false, challenge: { state: 0, matchDeadline: 0 } });
  assert.match(admissionState(data, wallet).title, /Event cancelled/);
  assert.doesNotMatch(admissionState(data, wallet).title, /Registered/);
});
