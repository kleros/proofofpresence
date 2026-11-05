// Actual isolated V10 state and matched mock Court; no public RPC or real wallet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { createV10AppFixture } from './fixtures/v10-app-fixture.mjs';
import { collectFirstEventDisplayState } from '../src/first-event-state.mjs';

test('actual post-event projection preserves a Court share while ordinary attendees are paid', { timeout: 180000 }, async t => {
  const f = await createV10AppFixture(); t.after(() => f.close());
  const w = f.workbench(), wallets = await Promise.all([0, 1, 2].map(async i => (await f.provider.getSigner(i)).getAddress()));
  const actor = { id: 'synthetic-postevent-projection', mode: 'wallet', wallet: wallets[1] };
  const first = await f.provider.getBlock('latest'), start = first.timestamp + 3600, end = start + 3600;
  const draft = await w.createFactoryDraft(actor, { title: 'Synthetic post-event settlement projection', lumaUrl: 'https://luma.com/synthetic-postevent-projection',
    startsAt: new Date(start * 1000).toISOString(), endsAt: new Date(end * 1000).toISOString(), timezone: 'UTC', depositEth: '0.000001' });
  await w.validateFactoryDraft(actor, draft.id);
  let sends = 0;
  const send = async (index, transaction) => { const tx = await f.sendSyntheticTransaction(index, transaction); const receipt = await tx.wait(); assert.equal(receipt.status, 1); sends++; return tx; };
  const creation = await send(1, draft.transaction);
  await w.recordFactorySubmitted(actor, draft.id, creation.hash);
  const created = await w.reconcileFactorySubmission(actor, draft.id, creation.hash);
  assert.equal(created.status, 'confirmed');
  const contract = w.contract(draft.eventId), deposit = ethers.parseEther('0.000001');
  const action = (index, method, args = [], value = 0n) => send(index, { to: created.contract, data: contract.interface.encodeFunctionData(method, args), value, gasLimit: 8000000 });
  const collect = async () => collectFirstEventDisplayState({ provider: w.provider, chain: w.chain, record: w.record(draft.eventId), block: await f.provider.getBlock('latest') });
  const advance = async target => { const block = await f.provider.getBlock('latest'); if (target > block.timestamp) await f.provider.send('evm_increaseTime', [target - block.timestamp]); await f.provider.send('evm_mine', []); };
  await action(0, 'deposit', [], deposit); await action(2, 'deposit', [], deposit);
  assert.equal(await contract.pendingTotal(), 2n * deposit);
  await action(1, 'registerStakers', [[wallets[0], wallets[2]]]);
  await advance(end + 1);
  await action(1, 'postAttendance', [[wallets[0]], 2n * deposit]);
  const challengeDeposit = await contract.challengeDeposit();
  await action(2, 'challenge', [], challengeDeposit);
  await action(1, 'matchChallenge', [wallets[2]], challengeDeposit);
  const listed = await collect();
  assert.equal(listed.eventState.phase, 'Listed');
  assert.equal(listed.payoutState.stakerCount, 2); assert.equal(listed.payoutState.attendeeCount, 1);
  assert.equal(listed.payoutState.payoutShareWei, '0'); assert.equal(listed.payoutState.heldBackWei, '0');
  assert.equal(listed.payoutState.cases.length, 1); assert.equal(listed.payoutState.cases[0].wallet.toLowerCase(), wallets[2].toLowerCase());
  const challenge = await contract.challenges(wallets[2]);
  assert.equal(listed.payoutState.cases[0].arbitratorDisputeId, challenge.arbitratorDisputeID.toString());
  await advance(Number(await contract.challengeEndsAt()) + 1);
  const balanceBefore = await f.provider.getBalance(wallets[0]);
  // A different local caller pays release gas, so the attendee's balance delta is exact.
  await action(1, 'releasePayouts');
  const finalized = await collect();
  assert.equal(finalized.eventState.phase, 'Finalized');
  assert.equal(finalized.payoutState.stakerCount, 2); assert.equal(finalized.payoutState.attendeeCount, 1);
  assert.equal(finalized.payoutState.payoutShareWei, deposit.toString());
  assert.equal(finalized.payoutState.heldBackWei, deposit.toString());
  assert.equal(finalized.payoutState.cases[0].heldShareWei, deposit.toString());
  assert.equal(Number((await contract.challenges(wallets[2])).state), 2, 'Court case remains disputed');
  assert.equal(await f.provider.getBalance(wallets[0]), balanceBefore + deposit, 'ordinary attendee receives ETH while disputed share stays reserved');
  assert.equal(await contract.pendingTotal(), 0n);
  assert.equal(f.stats.backendSigningCalls, 0);
  t.diagnostic(JSON.stringify({ kind: 'actual-local-postevent-payout-projection', sends, matchedCourtCases: 1, ordinaryAttendeePaid: true, reservedCaseShare: true,
    publicRpcCalls: 0, realWalletActions: 0, productionChanges: 0 }));
});
