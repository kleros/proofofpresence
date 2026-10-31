import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../public/first-event/event.js';
import { createTransactionJournal } from '../public/transaction-context.js';
import { recordedDepositReference, savedDepositReference } from '../public/first-event/receipts.js';

const wallet = '0x' + '1'.repeat(40), stranger = '0x' + '2'.repeat(40), origin = 'https://synthetic-receipts.invalid';
const H = digit => '0x' + digit.repeat(64);
class MemoryStorage {
  map = new Map();
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
const context = (patch = {}) => ({ instanceId: 'old-instance', mode: EVENT.mode, eventId: EVENT.id,
  chainId: EVENT.chainId, contract: EVENT.contract, wallet, abiVersion: EVENT.abiVersion, ...patch });
const state = () => { const storage = new MemoryStorage(); return { storage, journal: createTransactionJournal(storage), wallet, origin }; };
function record(input, scope, hash, options = {}) {
  const { status = 'confirmed', action = 'deposit' } = options;
  const blockNumber = Object.hasOwn(options, 'blockNumber') ? options.blockNumber : 100;
  input.journal.record(scope, { hash, draftId: 'draft-' + hash.slice(-8), action });
  input.journal.update(scope, hash, { status, ...(blockNumber === undefined ? {} : { blockNumber }) });
}
function held(input, scope, patch = {}) {
  // Persisted v1 wire-format fixture; production creates it before opening a wallet request.
  const key = 'kleros-first-event-intent:v1:' + [origin, scope.instanceId, scope.mode, scope.eventId, scope.chainId,
    scope.contract.toLowerCase(), scope.wallet.toLowerCase(), scope.abiVersion].map(encodeURIComponent).join(':');
  input.storage.setItem(key, JSON.stringify({ phase: 'awaiting-wallet', draftId: 'original-wallet-request', ...patch }));
  return key;
}
const bytes = storage => JSON.stringify([...storage.map]);

test('confirmed deposit references survive server/token changes, choose the latest confirmed hash and never rewrite the journal', () => {
  const input = state(); record(input, context(), H('a'));
  record(input, context({ instanceId: 'new-instance' }), H('b'), { blockNumber: 101 });
  const before = bytes(input.storage), reference = recordedDepositReference(input);
  assert.equal(reference.status, 'confirmed'); assert.equal(reference.hash, H('b'));
  assert.equal(reference.context.instanceId, 'new-instance'); assert.equal(bytes(input.storage), before);
});

test('unresolved original hashes and unknown wallet requests take precedence across instances without erasing confirmed history', () => {
  for (const status of ['submitted', 'needs-confirmation']) {
    const input = state(); record(input, context({ instanceId: 'current-instance' }), H('a'));
    record(input, context(), H('b'), { status, blockNumber: undefined });
    const before = bytes(input.storage), reference = recordedDepositReference(input);
    assert.equal(reference.status, 'submitted'); assert.equal(reference.hash, H('b')); assert.equal(reference.context.instanceId, 'old-instance');
    assert.equal(bytes(input.storage), before);
    held(input, context({ instanceId: 'unknown-instance' }));
    const heldBefore = bytes(input.storage), unknown = recordedDepositReference(input);
    assert.equal(unknown.status, 'awaiting-wallet'); assert.equal(unknown.draftId, 'original-wallet-request'); assert.equal(unknown.hash, undefined);
    assert.equal(bytes(input.storage), heldBefore);
  }
});

test('another wallet/event/chain/contract/profile/environment or action can never supply this deposit reference', () => {
  for (const patch of [{ wallet: stranger }, { eventId: 'another-event' }, { chainId: 10200 },
    { contract: stranger }, { abiVersion: 'kleros-event-v9-uups' }, { mode: 'hosted-testnet' }]) {
    const input = state(); record(input, context(patch), H('a'));
    assert.equal(recordedDepositReference(input), null);
  }
  for (const options of [{ action: 'createEvent' }, { status: 'failed' }, { blockNumber: 0 }, { blockNumber: undefined }]) {
    const input = state(); record(input, context(), H('a'), options);
    assert.equal(recordedDepositReference(input), null);
  }
});

test('matching corrupt journals and unknown intent formats fail closed and preserve every stored byte', () => {
  for (const raw of ['not-json', JSON.stringify({ phase: 'different', draftId: 'original' })]) {
    const input = state(), key = held(input, context()); input.storage.setItem(key, raw);
    const before = bytes(input.storage); assert.throws(() => recordedDepositReference(input)); assert.equal(bytes(input.storage), before);
  }
  const input = state(); record(input, context(), H('a'));
  input.storage.setItem(input.storage.key(0), 'not-json');
  const before = bytes(input.storage); assert.throws(() => recordedDepositReference(input)); assert.equal(bytes(input.storage), before);
});

function sqlSnapshot() {
  return { schemaVersion: 1, kind: 'first-event-depositors', displayOnly: true, mode: EVENT.mode,
    eventId: EVENT.id, chainId: EVENT.chainId, contract: EVENT.contract, instanceId: 'restarted-sql-instance',
    status: 'current', checkedAt: new Date(Date.now() - 1000).toISOString(), blockNumber: 101, blockHash: H('c'),
    depositors: [{ wallet, totalReceivedWei: EVENT.depositWei, deposits: [
      { txHash: H('a'), logIndex: 0, amountWei: '4000000000000000', blockNumber: 100, blockHash: H('d') },
      { txHash: H('b'), logIndex: 1, amountWei: '6000000000000000', blockNumber: 101, blockHash: H('c') },
    ] }] };
}

test('manual SQL receipts suppress duplicate payment only for the exact payer with a full recorded commitment; no current authority is claimed', () => {
  for (const status of ['current', 'stale']) {
    const data = sqlSnapshot(); data.status = status; const before = JSON.stringify(data);
    assert.deepEqual(savedDepositReference(data, wallet), { hash: H('b'), status: 'recorded', instanceId: 'restarted-sql-instance' });
    assert.equal(savedDepositReference(data, stranger), null); assert.equal(JSON.stringify(data), before);
  }
  const partial = sqlSnapshot(); partial.depositors[0].deposits.pop(); partial.depositors[0].totalReceivedWei = '4000000000000000';
  assert.equal(savedDepositReference(partial, wallet), null, 'A partial manual payment still permits the checked remainder');
});

test('SQL scope, totals, receipt validity, duplicates and authority payload changes cannot be accepted as a saved payment', () => {
  for (const mutate of [
    d => { d.schemaVersion = 2; }, d => { d.kind = 'bootstrap'; }, d => { d.displayOnly = false; },
    d => { d.mode = 'hosted-testnet'; }, d => { d.eventId = 'another-event'; }, d => { d.chainId = 10200; },
    d => { d.contract = stranger; }, d => { d.instanceId = ''; }, d => { d.blockHash = '0x'; },
    d => { d.checkedAt = new Date(Date.now() + 60000).toISOString(); }, d => { d.blockNumber = 0; },
    d => { d.depositors[0].totalReceivedWei = '1'; }, d => { d.depositors[0].deposits[0].txHash = '0x'; },
    d => { d.depositors[0].deposits[0].blockNumber = 102; }, d => { d.depositors[0].deposits[0].amountWei = '-1'; },
    d => { d.depositors[0].deposits[0].logIndex = -1; }, d => { d.depositors.push(structuredClone(d.depositors[0])); },
    d => { d.depositors[0].deposits[1] = structuredClone(d.depositors[0].deposits[0]); },
    d => { d.session = { wallet }; }, d => { d.permissions = { owner: true }; },
  ]) {
    const data = sqlSnapshot(); mutate(data); const before = JSON.stringify(data);
    assert.throws(() => savedDepositReference(data, wallet)); assert.equal(JSON.stringify(data), before);
  }
});

test('a malformed unrelated payer cannot be hidden by selecting a valid payer first', () => {
  const data = sqlSnapshot(); data.depositors.push({ wallet: stranger, totalReceivedWei: EVENT.depositWei,
    deposits: [{ txHash: H('e'), logIndex: 0, amountWei: '1', blockNumber: 100, blockHash: H('d') }] });
  assert.throws(() => savedDepositReference(data, wallet));
});
