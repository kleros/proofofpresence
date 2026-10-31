// Lazy, mainnet-only WalletConnect transport. This never authenticates an app
// session or creates a transaction. Existing callers retain every action guard.
const PROJECT_ID = "8b91f364532b7b33d6d0c3dd105e2485";
const CURRENT_ORIGINS = new Set(["https://kleros-kickback.netlify.app", "https://kickback.kleros.io"]);
const BUNDLE = "/vendor/walletconnect/2.26.0/walletconnect.bundle.js";
const factories = new WeakMap();
const staleError = () => new DOMException("The page or wallet changed. Connect again.", "AbortError");
const connectionError = () => Object.assign(Error("Connect your wallet first."), { code: 4900 });
const cancelledError = () => Object.assign(Error("Wallet connection cancelled."), { code: 4001 });
function chainQuantity(value) {
  // The pinned UniversalProvider returns a number for eth_chainId. Present the
  // EIP-1193 hexadecimal quantity expected by unchanged account/sender guards.
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return "0x" + value.toString(16);
  if (typeof value === "string" && value.length <= 16 && /^0x[1-9a-f][0-9a-f]*$/i.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
    return "0x" + BigInt(value).toString(16);
  throw Object.assign(Error("The wallet returned incomplete chain metadata."), { code: 4900 });
}

function config(ownerDocument) {
  const page = new URL(ownerDocument.location.href), origin = page.origin;
  if (!CURRENT_ORIGINS.has(origin) || page.username || page.password) throw Error("WalletConnect is available on the production event site.");
  const metadata = { name: "Kleros Kickback", description: "Event deposits and attendance", url: origin,
    icons: [origin + "/first-event/assets/kleros-logo.svg"], redirect: { universal: page.href } };
  return {
    projectId: PROJECT_ID, optionalChains: [1], showQrModal: false,
    optionalMethods: ["eth_sendTransaction", "personal_sign", "wallet_switchEthereumChain", "wallet_addEthereumChain"],
    optionalEvents: ["accountsChanged", "chainChanged"],
    metadata, telemetryEnabled: false, disableProviderPing: true, logger: "silent",
    customStoragePrefix: "kleros-walletconnect-v1",
    modalOptions: {
      projectId: PROJECT_ID, metadata, allWallets: "SHOW", enableInjected: false, enableEIP6963: false,
      enableCoinbase: false, enableWalletConnect: true, enableReconnect: false, enableNetworkSwitch: false,
      themeMode: "dark", themeVariables: { "--w3m-font-family": "Geist, system-ui, sans-serif", "--w3m-accent": "#C2B5F2" },
      features: { analytics: false, email: false, socials: false, onramp: false, swaps: false,
        send: false, receive: false, history: false, connectMethodsOrder: ["wallet"] },
    },
  };
}
async function loadOfficialEthereumProvider(ownerDocument) {
  if (factories.has(ownerDocument)) return factories.get(ownerDocument);
  const pending = new Promise((resolve, reject) => {
    const script = ownerDocument.createElement("script");
    script.src = BUNDLE; script.async = true; script.dataset.walletconnectVendor = "";
    script.addEventListener("load", () => {
      const vendor = ownerDocument.defaultView.KlerosWalletConnectVendor;
      if (!vendor?.EthereumProvider?.init || typeof vendor.createAppKit !== "function") {
        reject(Error("The wallet connector could not be loaded.")); return;
      }
      let initialized = null;
      resolve({ init: options => {
        if (initialized) return initialized;
        let partial = null;
        initialized = (async () => {
        const { modalOptions, ...providerOptions } = options;
        const sdk = await vendor.EthereumProvider.init(providerOptions);
        partial = sdk;
        const mainnet = { id: 1, chainNamespace: "eip155", caipNetworkId: "eip155:1", name: "Ethereum",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://rpc.walletconnect.org/v1"] } },
          blockExplorers: { default: { name: "Etherscan", url: "https://etherscan.io" } } };
        // The same exported UniversalProvider/public AppKit wiring used by the
        // official EthereumProvider, with connection-only options set up front.
        const modal = vendor.createAppKit({ ...modalOptions, networks: [mainnet],
          universalProvider: sdk.signer, manualWCControl: true });
        let pairing = null, activeAttempt = null, reusableSession = null, cleanup = Promise.resolve();
        const abortConnection = () => {
          const attempt = activeAttempt;
          if (!attempt || attempt.cancelled) return;
          attempt.cancelled = true; attempt.reject(cancelledError());
          if (!sdk.session) {
            // abortPairingAttempt is a no-op in this pinned SDK. Its public
            // cleanup expires incomplete pairings before another explicit try.
            try { cleanup = Promise.resolve(sdk.signer.cleanupPendingPairings?.({ deletePairings: true })).catch(() => {}); }
            catch { cleanup = Promise.resolve(); }
          }
          void modal.close();
        };
        const enable = async () => {
          if (sdk.session && sdk.session === reusableSession) return sdk.request({ method: "eth_requestAccounts" });
          if (pairing) await pairing.catch(() => {});
          await cleanup;
          const attempt = { cancelled: false, reject: (_error) => {} };
          const cancellation = new Promise((_, reject) => { attempt.reject = reject; });
          cancellation.catch(() => {});
          activeAttempt = attempt;
          pairing = (async () => {
            let opened = false;
            const unsubscribe = modal.subscribeState(state => {
              if (state.open) opened = true;
              else if (opened && !sdk.session) abortConnection();
            });
            try {
              await modal.open({ view: "Connect" });
              if (attempt.cancelled) throw cancelledError();
              // Only a completed, current attempt may supply a reusable session.
              // A cancelled proposal can settle while its cleanup is in flight.
              await cleanup;
              if (sdk.session) {
                await sdk.disconnect();
                if (sdk.session) throw connectionError();
              }
              if (attempt.cancelled) throw cancelledError();
              const pending = Promise.resolve(sdk.enable());
              // A closed proposal can never become a later claimed connection.
              pending.then(() => {
                if (attempt.cancelled && sdk.session) {
                  reusableSession = null;
                  if (activeAttempt && activeAttempt !== attempt) abortConnection();
                  cleanup = Promise.resolve(sdk.disconnect()).catch(() => {});
                }
              }, () => {});
              const accounts = await Promise.race([pending, cancellation]);
              if (attempt.cancelled) throw cancelledError();
              reusableSession = sdk.session;
              return accounts;
            } catch (error) { throw attempt.cancelled ? cancelledError() : error; }
            finally {
              unsubscribe?.();
              if (activeAttempt === attempt) activeAttempt = null;
              await modal.close(); pairing = null;
            }
          })();
          return pairing;
        };
        return { enable, abortConnection, modal,
          request: args => sdk.request(args), on: (name, callback) => sdk.on(name, callback),
          removeListener: (name, callback) => sdk.removeListener(name, callback),
          disconnect: () => sdk.disconnect(), get session() { return sdk.session; }, get accounts() { return sdk.accounts; } };
        })().catch(async error => {
          if (partial && !partial.session) {
            try { partial.signer?.abortPairingAttempt?.(); await partial.disconnect?.(); } catch { /* Preserve the initialization error. */ }
          }
          initialized = null; throw error;
        });
        return initialized;
      } });
    }, { once: true });
    script.addEventListener("error", () => reject(Error("The wallet connector could not be loaded. Try again.")), { once: true });
    ownerDocument.head.append(script);
  });
  factories.set(ownerDocument, pending);
  try { return await pending; } catch (error) { factories.delete(ownerDocument); throw error; }
}

/** A stable EIP-1193 adapter; creation/listeners never load or initialize the SDK.
 * @param {{ownerDocument?: any, isCurrent?: () => boolean, signal?: AbortSignal, loadEthereumProvider?: (doc?: any) => Promise<any>}} [options]
 */
export function createWalletConnectProvider({ ownerDocument = document, isCurrent = () => Boolean(true), signal,
  loadEthereumProvider = loadOfficialEthereumProvider } = {}) {
  const options = config(ownerDocument);
  const listeners = new Map(), forwards = new Map();
  let sdk = null, loading = null, connecting = null, connected = false, disposed = false, cancelConnect = null;
  const current = () => !disposed && !signal?.aborted && isCurrent();
  const assertCurrent = () => { if (!current()) throw staleError(); };
  const emit = (name, payload) => { for (const callback of listeners.get(name) ?? []) callback(payload); };
  const detach = () => { for (const [name, callback] of forwards) sdk?.removeListener?.(name, callback); forwards.clear(); };
  const abort = () => {
    disposed = true; cancelConnect?.(staleError());
    if (!connected) sdk?.abortConnection?.();
    detach();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const ready = () => loading ??= (async () => {
    assertCurrent();
    const factory = await loadEthereumProvider(ownerDocument); assertCurrent();
    const initialized = await factory.init(options); sdk = initialized;
    if (!current()) { sdk.abortConnection?.(); throw staleError(); }
    for (const name of ["accountsChanged", "chainChanged", "connect", "message", "disconnect"]) {
      const callback = payload => {
        if (name === "disconnect") { connected = false; emit("disconnect", payload); emit("accountsChanged", []); }
        else emit(name, payload);
      };
      forwards.set(name, callback); sdk.on?.(name, callback);
    }
    return sdk;
  })();
  const accountRequest = () => {
    if (connecting) return connecting;
    connecting = (async () => {
      const remote = await ready(); assertCurrent();
      const hadSession = Boolean(remote.session);
      let rejectCancelled;
      const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
      cancelConnect = rejectCancelled;
      const attempt = Promise.resolve().then(() => remote.enable());
      // An approval arriving after cancellation must not become a claimed connection.
      attempt.then(() => { if (!current() && !hadSession && remote.session) void remote.disconnect(); }, () => {});
      const timer = setInterval(() => { if (!current()) { remote.abortConnection?.(); rejectCancelled(staleError()); } }, 100);
      try {
        const accounts = await Promise.race([attempt, cancelled]); assertCurrent();
        if (!Array.isArray(accounts) || !accounts.length || accounts.some(value => typeof value !== "string" || !/^0x[0-9a-f]{40}$/i.test(value)))
          throw Error("No Ethereum wallet account was selected.");
        connected = true; return accounts;
      } finally { clearInterval(timer); cancelConnect = null; }
    })().finally(() => { connecting = null; });
    return connecting;
  };
  const provider = {
    isWalletConnect: true,
    request(args) {
      try { assertCurrent(); } catch (error) { return Promise.reject(error); }
      if (args?.method === "eth_requestAccounts") return accountRequest();
      if (!connected || !sdk) return Promise.reject(connectionError());
      // Once dispatched, return the original wallet result even if the view
      // changes. The unchanged sender must be able to journal a returned hash.
      if (args?.method === "eth_chainId") return Promise.resolve(sdk.request(args)).then(chainQuantity);
      return sdk.request(args);
    },
    on(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); return provider; },
    removeListener(name, callback) { listeners.get(name)?.delete(callback); return provider; },
    async disconnect() { if (sdk) await sdk.disconnect(); connected = false; emit("accountsChanged", []); },
    dispose: abort,
    get session() { return sdk?.session; },
  };
  return provider;
}
