// Mock SDK only. No relay, pairing URI, wallet grant, signature or transaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWalletConnectProvider } from '../public/walletconnect.js';

const ORIGIN = 'https://kleros-kickback.netlify.app';
const WALLET = '0x1111111111111111111111111111111111111111';
const PROJECT = '8b91f364532b7b33d6d0c3dd105e2485';
const HASH = '0x' + 'a'.repeat(64);
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function documentAt(origin = ORIGIN) {
  const location = new URL(origin + '/first-event/');
  return { location, defaultView: { location, setTimeout, clearTimeout, setInterval, clearInterval } };
}
class MockSdk extends EventEmitter {
  chainId = 1;
  accounts = [WALLET];
  connected = false;
  session = undefined;
  enableCalls = 0;
  disconnectCalls = 0;
  requests = [];
  enableHook = null;
  requestHook = null;
  async enable() {
    this.enableCalls++;
    const accounts = this.enableHook ? await this.enableHook() : this.accounts;
    this.connected = true;
    this.session = { namespaces: { eip155: { accounts: accounts.map(wallet => 'eip155:1:' + wallet), chains: ['eip155:1'], methods: ['eth_sendTransaction', 'personal_sign'], events: ['chainChanged', 'accountsChanged'] } } };
    return accounts;
  }
  async request(request) { this.requests.push(request); return this.requestHook ? this.requestHook(request) : request.method === 'eth_chainId' ? '0x1' : 'mock-read-result'; }
  async disconnect() { this.disconnectCalls++; this.connected = false; this.session = undefined; }
}
function fixture(options = {}) {
  const sdk = options.sdk ?? new MockSdk(), optionsSeen = [], ownerDocument = options.ownerDocument ?? documentAt(options.origin), controller = new AbortController();
  let loads = 0, current = true;
  const factory = { init: async config => { optionsSeen.push(config); return sdk; } };
  const provider = createWalletConnectProvider({ ownerDocument, signal: controller.signal, isCurrent: () => current,
    loadEthereumProvider: async () => { loads++; return options.loader ? options.loader(factory) : factory; } });
  return { sdk, provider, ownerDocument, controller, optionsSeen, get loads() { return loads; }, stale() { current = false; } };
}

test('construction and preconnection reads cannot load the vendor or silently start a connection', async () => {
  const f = fixture(); assert.equal(f.loads, 0); assert.equal(f.sdk.enableCalls, 0);
  await assert.rejects(f.provider.request({ method: 'eth_chainId' }));
  await assert.rejects(f.provider.request({ method: 'eth_sendTransaction', params: [{}] }));
  await assert.rejects(f.provider.request({ method: 'personal_sign', params: ['0x00', WALLET] }));
  assert.equal(f.loads, 0); assert.deepEqual(f.sdk.requests, []); f.controller.abort();
});

test('one explicit accounts request initializes only the fixed mainnet/public-origin proposal and has no automatic signing or payment', async () => {
  const f = fixture();
  assert.deepEqual(await f.provider.request({ method: 'eth_requestAccounts' }), [WALLET]);
  assert.equal(f.loads, 1); assert.equal(f.optionsSeen.length, 1); assert.equal(f.sdk.enableCalls, 1);
  const config = f.optionsSeen[0], chains = [...(config.chains ?? []), ...(config.optionalChains ?? [])];
  assert(chains.length > 0 && chains.every(chain => chain === 1));
  assert.equal(config.projectId, PROJECT); assert.equal(new URL(config.metadata.url).origin, ORIGIN);
  assert.equal(config.showQrModal, false);
  assert.deepEqual(config.optionalMethods, ['eth_sendTransaction', 'personal_sign', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']);
  assert.deepEqual(config.optionalEvents, ['accountsChanged', 'chainChanged']);
  assert.equal(config.telemetryEnabled, false); assert.equal(config.logger, 'silent');
  assert(f.sdk.requests.every(request => request.method === 'eth_requestAccounts'));
  const features = config.modalOptions?.features;
  assert(features, 'Explicit modal feature flags are part of the wrapper contract');
  for (const key of ['analytics', 'email', 'onramp', 'swaps']) assert.equal(features[key], false, key);
  assert(features.socials === false || (Array.isArray(features.socials) && features.socials.length === 0));
  f.controller.abort();
});

test('concurrent account requests share a single SDK initialization and pairing', async () => {
  const sdk = new MockSdk(), ready = deferred(); sdk.enableHook = () => ready.promise;
  const f = fixture({ sdk });
  const first = f.provider.request({ method: 'eth_requestAccounts' }), second = f.provider.request({ method: 'eth_requestAccounts' });
  ready.resolve([WALLET]);
  assert.deepEqual(await first, [WALLET]); assert.deepEqual(await second, [WALLET]);
  assert.equal(f.loads, 1); assert.equal(sdk.enableCalls, 1); assert.deepEqual(sdk.requests, []); f.controller.abort();
});

test('public SDK redirect metadata preserves the exact current event route while Verify metadata keeps its canonical origin', async () => {
  const ownerDocument = documentAt(), sdk = new MockSdk();
  ownerDocument.location = new URL(ORIGIN + '/first-event/?ref=a%26b#event=synthetic&deposit=manage&transaction=original');
  let captured;
  const provider = createWalletConnectProvider({ ownerDocument, loadEthereumProvider: async () => ({ init: async options => { captured = options; return sdk; } }) });
  await provider.request({ method: 'eth_requestAccounts' });
  assert.equal(captured.metadata.url, ORIGIN);
  assert.equal(captured.metadata.redirect.universal, ownerDocument.location.href);
  assert.deepEqual(captured.modalOptions.metadata, captured.metadata);
  let loads = 0;
  const invalid = documentAt(); invalid.location = new URL(ORIGIN.replace('https://', 'https://synthetic:invalid@') + '/first-event/');
  assert.throws(() => createWalletConnectProvider({ ownerDocument: invalid, loadEthereumProvider: async () => { loads++; } }));
  assert.equal(loads, 0); provider.dispose();
});

test('the exact custom origin retains its own Verify metadata, icon and complete return route', async () => {
  const ownerDocument = documentAt('https://kickback.kleros.io');
  ownerDocument.location = new URL('https://kickback.kleros.io/first-event/?ref=a%26b#event=synthetic&deposit=manage&transaction=original');
  const f = fixture({ ownerDocument });
  assert.equal(f.loads, 0);
  assert.deepEqual(await f.provider.request({ method: 'eth_requestAccounts' }), [WALLET]);
  const metadata = f.optionsSeen[0].metadata;
  assert.equal(metadata.url, 'https://kickback.kleros.io');
  assert.deepEqual(metadata.icons, ['https://kickback.kleros.io/first-event/assets/kleros-logo.svg']);
  assert.equal(metadata.redirect.universal, f.ownerDocument.location.href);
  assert.deepEqual(f.sdk.requests, []); f.controller.abort();
});

test('SDK numeric chain IDs become canonical EIP1193 hex without changing guards or other results', async () => {
  const f = fixture(); await f.provider.request({ method: 'eth_requestAccounts' });
  for (const [raw, expected] of [[1, '0x1'], [10200, '0x27d8'], ['0x1', '0x1'], ['0XAA', '0xaa']]) {
    f.sdk.requestHook = request => { assert.equal(request.method, 'eth_chainId'); return raw; };
    assert.equal(await f.provider.request({ method: 'eth_chainId' }), expected);
  }
  for (const raw of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', '0x01', '0x0', '0xz', null, undefined, 1n]) {
    f.sdk.requestHook = () => raw;
    await assert.rejects(f.provider.request({ method: 'eth_chainId' }), error => error.code === 4900);
  }
  f.sdk.requestHook = () => HASH;
  assert.equal(await f.provider.request({ method: 'eth_sendTransaction', params: [{}] }), HASH);
  assert.equal(f.sdk.enableCalls, 1); f.controller.abort();
});

test('retired, demo, preview, local and lookalike origins cannot load or initialize WalletConnect', async () => {
  for (const origin of ['https://kleros-luma-v10-ethereum.netlify.app', 'https://demo.example.invalid', 'https://preview--kleros-kickback.netlify.app',
    'http://localhost:3000', 'https://kleros-kickback.netlify.app.evil.invalid', 'https://kickback.kleros.io.evil.invalid', 'https://www.kickback.kleros.io']) {
    let loads = 0, provider = null;
    try {
      provider = createWalletConnectProvider({ ownerDocument: documentAt(origin), loadEthereumProvider: async () => { loads++; throw Error('must not load'); } });
    } catch (error) { assert(error); }
    if (provider) await assert.rejects(provider.request({ method: 'eth_requestAccounts' }));
    assert.equal(loads, 0, origin);
  }
});

test('provider account/chain/disconnect events and explicit EIP1193 reads pass through unchanged', async () => {
  const f = fixture(), seen = [];
  await f.provider.request({ method: 'eth_requestAccounts' });
  const accountListener = value => seen.push(['accountsChanged', value]);
  const chainListener = value => seen.push(['chainChanged', value]);
  const disconnectListener = value => seen.push(['disconnect', value]);
  f.provider.on('accountsChanged', accountListener); f.provider.on('chainChanged', chainListener); f.provider.on('disconnect', disconnectListener);
  assert.equal(await f.provider.request({ method: 'eth_chainId' }), '0x1');
  assert.deepEqual(f.sdk.requests, [{ method: 'eth_chainId' }]);
  const accounts = ['0x2222222222222222222222222222222222222222'], disconnect = { code: 4900, message: 'Synthetic disconnect' };
  f.sdk.emit('accountsChanged', accounts); f.sdk.emit('chainChanged', '0xaa36a7');
  assert.deepEqual(seen, [['accountsChanged', accounts], ['chainChanged', '0xaa36a7']]);
  f.provider.removeListener('accountsChanged', accountListener); f.sdk.emit('accountsChanged', [WALLET]); assert.equal(seen.length, 2);
  f.sdk.emit('disconnect', disconnect);
  assert.deepEqual(seen, [['accountsChanged', accounts], ['chainChanged', '0xaa36a7'], ['disconnect', disconnect]]);
  f.controller.abort();
});

test('an aborted or stale pending loader cannot initialize a late SDK or ask for a wallet grant', { timeout: 1500 }, async () => {
  for (const cancel of ['abort', 'stale']) {
    const loaded = deferred(), f = fixture({ loader: factory => loaded.promise.then(() => factory) });
    const pending = f.provider.request({ method: 'eth_requestAccounts' });
    if (cancel === 'abort') f.controller.abort(); else f.stale();
    loaded.resolve();
    await assert.rejects(pending);
    assert.equal(f.optionsSeen.length, 0); assert.equal(f.sdk.enableCalls, 0); assert.deepEqual(f.sdk.requests, []);
    f.controller.abort();
  }
});

test('cancelling pending pairing rejects its late account result and cleans up without signing or payment', { timeout: 1500 }, async () => {
  const sdk = new MockSdk(), ready = deferred(); sdk.enableHook = () => ready.promise;
  const f = fixture({ sdk }), pending = f.provider.request({ method: 'eth_requestAccounts' });
  for (let i = 0; i < 10 && sdk.enableCalls === 0; i++) await Promise.resolve();
  assert.equal(sdk.enableCalls, 1); f.controller.abort(); ready.resolve([WALLET]);
  await assert.rejects(pending); assert(sdk.disconnectCalls > 0); assert.deepEqual(sdk.requests, []);
});

test('wallet rejection is surfaced without a signature, transaction or fabricated account connection', async () => {
  const sdk = new MockSdk(); sdk.enableHook = async () => { throw Object.assign(Error('Synthetic wallet cancelled'), { code: 4001 }); };
  const f = fixture({ sdk });
  await assert.rejects(f.provider.request({ method: 'eth_requestAccounts' }), error => Number(error.code) === 4001);
  assert.deepEqual(sdk.requests, []); assert.equal(sdk.connected, false); f.controller.abort();
});

test('a dispatched financial result is returned after staleness so the existing journal can retain its hash', async () => {
  const f = fixture(), sent = deferred(); await f.provider.request({ method: 'eth_requestAccounts' });
  f.sdk.requestHook = request => { assert.equal(request.method, 'eth_sendTransaction'); return sent.promise; };
  const request = { method: 'eth_sendTransaction', params: [{ from: WALLET, to: WALLET, value: '0x0', chainId: '0x1', data: '0x' }] };
  const result = f.provider.request(request);
  for (let i = 0; i < 10 && f.sdk.requests.length === 0; i++) await Promise.resolve();
  assert.equal(f.sdk.requests.length, 1); f.stale(); f.controller.abort(); sent.resolve(HASH);
  assert.equal(await result, HASH); assert.deepEqual(f.sdk.requests, [request]);
});

test('disposing an established adapter detaches its events and rejects later requests without replaying connection or payment', async () => {
  const f = fixture(), seen = [];
  await f.provider.request({ method: 'eth_requestAccounts' });
  f.provider.on('accountsChanged', value => seen.push(value));
  assert(f.sdk.listenerCount('accountsChanged') > 0);
  f.provider.dispose(); f.sdk.emit('accountsChanged', [WALLET]);
  assert.deepEqual(seen, []); assert.equal(f.sdk.listenerCount('accountsChanged'), 0);
  await assert.rejects(f.provider.request({ method: 'eth_requestAccounts' }));
  await assert.rejects(f.provider.request({ method: 'eth_sendTransaction', params: [{}] }));
  assert.equal(f.loads, 1); assert.equal(f.sdk.enableCalls, 1); assert.deepEqual(f.sdk.requests, []);
});

test('the actual default loader retries a failed shared SDK/modal initialization on a new adapter without loading another script', async () => {
  for (const failure of ['sdk-init', 'modal-init']) {
    const ownerDocument = documentAt(), scripts = [], sdks = [];
    let initCalls = 0, modalCalls = 0, opens = 0;
    ownerDocument.createElement = tag => {
      assert.equal(tag, 'script');
      const handlers = new Map(); return { dataset: {}, addEventListener: (name, callback) => handlers.set(name, callback), handlers };
    };
    ownerDocument.head = { append(script) { scripts.push(script); queueMicrotask(() => script.handlers.get('load')()); } };
    ownerDocument.defaultView.KlerosWalletConnectVendor = {
      EthereumProvider: { init: async () => {
        initCalls++; if (failure === 'sdk-init' && initCalls === 1) throw Error('Synthetic transient SDK init failure');
        const sdk = new MockSdk(); sdk.signer = { abortPairingAttempt() {} }; sdks.push(sdk); return sdk;
      } },
      createAppKit: () => {
        modalCalls++; if (failure === 'modal-init' && modalCalls === 1) throw Error('Synthetic transient modal init failure');
        return { open: async () => { opens++; }, close: async () => {}, subscribeState: () => () => {} };
      },
    };
    const first = createWalletConnectProvider({ ownerDocument });
    await assert.rejects(first.request({ method: 'eth_requestAccounts' })); first.dispose();
    const second = createWalletConnectProvider({ ownerDocument });
    assert.deepEqual(await second.request({ method: 'eth_requestAccounts' }), [WALLET]);
    assert.equal(scripts.length, 1); assert.equal(initCalls, 2); assert.equal(opens, 1);
    assert.equal(sdks.at(-1).enableCalls, 1); assert(sdks.every(sdk => sdk.requests.length === 0));
    if (failure === 'modal-init') assert(sdks[0].disconnectCalls > 0, 'Partially initialized unused SDK is cleaned up');
    second.dispose();
  }
});

test('default modal loading while closed is not cancellation; closing an opened pairing cleans up once', async () => {
  const ownerDocument = documentAt(), sdk = new MockSdk(), grant = deferred();
  let stateListener = null, aborts = 0, cleanups = 0, closeCalls = 0, open = false;
  sdk.enableHook = () => grant.promise;
  sdk.signer = { abortPairingAttempt() { aborts++; }, cleanupPendingPairings(options) { cleanups++; assert.deepEqual(options, { deletePairings: true }); } };
  ownerDocument.createElement = () => {
    const handlers = new Map(); return { dataset: {}, addEventListener: (name, callback) => handlers.set(name, callback), handlers };
  };
  ownerDocument.head = { append(script) { queueMicrotask(() => script.handlers.get('load')()); } };
  ownerDocument.defaultView.KlerosWalletConnectVendor = {
    EthereumProvider: { init: async () => sdk },
    createAppKit: () => ({
      subscribeState(callback) { stateListener = callback; return () => { stateListener = null; }; },
      async open() {
        stateListener({ open: false, loading: true });
        await Promise.resolve(); assert.equal(aborts, 0);
        open = true; stateListener({ open: true, loading: true });
      },
      async close() { closeCalls++; if (open) { open = false; stateListener?.({ open: false, loading: false }); } },
    }),
  };
  const provider = createWalletConnectProvider({ ownerDocument });
  const pending = provider.request({ method: 'eth_requestAccounts' });
  for (let i = 0; i < 30 && sdk.enableCalls === 0; i++) await Promise.resolve();
  assert.equal(sdk.enableCalls, 1); assert.equal(aborts, 0); assert.equal(open, true);
  stateListener({ open: false, loading: false });
  await assert.rejects(pending, error => Number(error.code) === 4001);
  assert.equal(aborts, 0); assert.equal(cleanups, 1); assert(closeCalls >= 1); assert.equal(stateListener, null);
  assert.equal(sdk.session, undefined); assert.deepEqual(sdk.requests, []); provider.dispose();
  grant.resolve([WALLET]);
  for (let i = 0; i < 20 && sdk.disconnectCalls === 0; i++) await Promise.resolve();
  assert.equal(sdk.disconnectCalls, 1); assert.equal(sdk.session, undefined);
});

test('default facade cancels promptly, waits cleanup before retry and invalidates a retry when an old grant arrives', async () => {
  const ownerDocument = documentAt(), sdk = new MockSdk();
  const firstGrant = deferred(), secondGrant = deferred(), cleanup = deferred();
  let stateListener = null, cleanupCalls = 0, opens = 0, opened = false;
  sdk.enableHook = () => sdk.enableCalls === 1 ? firstGrant.promise : secondGrant.promise;
  sdk.signer = { abortPairingAttempt() {}, cleanupPendingPairings(options) {
    cleanupCalls++; assert.deepEqual(options, { deletePairings: true }); return cleanup.promise;
  } };
  ownerDocument.createElement = () => {
    const handlers = new Map(); return { dataset: {}, addEventListener: (name, callback) => handlers.set(name, callback), handlers };
  };
  ownerDocument.head = { append(script) { queueMicrotask(() => script.handlers.get('load')()); } };
  ownerDocument.defaultView.KlerosWalletConnectVendor = {
    EthereumProvider: { init: async () => sdk },
    createAppKit: () => ({
      subscribeState(callback) { stateListener = callback; return () => { stateListener = null; }; },
      async open() { opens++; opened = true; stateListener({ open: true, loading: false }); },
      async close() { if (opened) { opened = false; stateListener?.({ open: false, loading: false }); } },
    }),
  };
  const first = createWalletConnectProvider({ ownerDocument });
  const firstRequest = first.request({ method: 'eth_requestAccounts' });
  for (let i = 0; i < 30 && sdk.enableCalls === 0; i++) await Promise.resolve();
  stateListener({ open: false, loading: false });
  await assert.rejects(firstRequest, error => Number(error.code) === 4001);
  assert.equal(cleanupCalls, 1); assert.equal(sdk.session, undefined);
  const second = createWalletConnectProvider({ ownerDocument });
  const secondRequest = second.request({ method: 'eth_requestAccounts' });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(opens, 1); assert.equal(sdk.enableCalls, 1, 'No new pairing while old cleanup is pending');
  cleanup.resolve();
  for (let i = 0; i < 30 && sdk.enableCalls < 2; i++) await Promise.resolve();
  assert.equal(opens, 2); assert.equal(sdk.enableCalls, 2);
  firstGrant.resolve([WALLET]);
  await assert.rejects(secondRequest, error => Number(error.code) === 4001);
  for (let i = 0; i < 30 && sdk.disconnectCalls === 0; i++) await Promise.resolve();
  assert.equal(sdk.disconnectCalls, 1, 'Late old approval is disconnected, not adopted');
  assert.equal(sdk.session, undefined);
  const nextWallet = '0x2222222222222222222222222222222222222222';
  secondGrant.resolve([nextWallet]);
  for (let i = 0; i < 30 && sdk.disconnectCalls < 2; i++) await Promise.resolve();
  assert.equal(sdk.disconnectCalls, 2); assert.equal(sdk.session, undefined); assert.deepEqual(sdk.requests, []);
  await assert.rejects(first.request({ method: 'eth_chainId' }));
  first.dispose(); second.dispose();
});

test('normal cancelled pairing cleanup permits one fresh retry with the same SDK and modal', async () => {
  const ownerDocument = documentAt(), sdk = new MockSdk(), firstGrant = deferred(), secondGrant = deferred();
  let stateListener = null, initCalls = 0, modalCalls = 0, cleanupCalls = 0, opened = false;
  sdk.enableHook = () => sdk.enableCalls === 1 ? firstGrant.promise : secondGrant.promise;
  sdk.signer = { abortPairingAttempt() {}, async cleanupPendingPairings(options) {
    cleanupCalls++; assert.deepEqual(options, { deletePairings: true });
    firstGrant.reject(Object.assign(Error('Synthetic expired unused pairing'), { code: 4001 }));
  } };
  ownerDocument.createElement = () => {
    const handlers = new Map(); return { dataset: {}, addEventListener: (name, callback) => handlers.set(name, callback), handlers };
  };
  ownerDocument.head = { append(script) { queueMicrotask(() => script.handlers.get('load')()); } };
  ownerDocument.defaultView.KlerosWalletConnectVendor = {
    EthereumProvider: { init: async () => { initCalls++; return sdk; } },
    createAppKit: () => { modalCalls++; return {
      subscribeState(callback) { stateListener = callback; return () => { stateListener = null; }; },
      async open() { opened = true; stateListener({ open: true, loading: false }); },
      async close() { if (opened) { opened = false; stateListener?.({ open: false, loading: false }); } },
    }; },
  };
  const first = createWalletConnectProvider({ ownerDocument });
  const pending = first.request({ method: 'eth_requestAccounts' });
  for (let i = 0; i < 40 && sdk.enableCalls === 0; i++) await Promise.resolve();
  stateListener({ open: false, loading: false });
  await assert.rejects(pending, error => Number(error.code) === 4001); first.dispose();
  const second = createWalletConnectProvider({ ownerDocument });
  const retry = second.request({ method: 'eth_requestAccounts' });
  for (let i = 0; i < 40 && sdk.enableCalls < 2; i++) await Promise.resolve();
  assert.equal(sdk.enableCalls, 2); secondGrant.resolve([WALLET]);
  assert.deepEqual(await retry, [WALLET]);
  assert.equal(initCalls, 1); assert.equal(modalCalls, 1); assert.equal(cleanupCalls, 1);
  assert.equal(sdk.disconnectCalls, 0); assert.deepEqual(sdk.requests, []); second.dispose();
});
