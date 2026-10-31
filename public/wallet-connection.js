// Provider selection only: no account/chain/signature requests, API or storage.
// App links follow MetaMask/Trust's official dapp-browser documentation.
const active = new WeakMap();
const discoveries = new WeakMap();
const browserFallback = new WeakMap();
const CURRENT_ORIGINS = new Set(["https://kleros-kickback.netlify.app", "https://kickback.kleros.io"]);
const validProvider = value => value && typeof value.request === "function";
const cancelled = () => Object.assign(Error("Wallet selection cancelled."), { code: 4001 });
const aborted = () => new DOMException("The page changed. Connect again.", "AbortError");

async function reownProvider(ownerDocument, current, signal) {
  const fallback = error => {
    if (!current() || error?.name === "AbortError") return aborted();
    browserFallback.set(ownerDocument, ownerDocument.location.href);
    return Object.assign(Error(error?.code === 4001
      ? "Wallet connection cancelled. Connect again for wallet browser options."
      : "Wallet picker unavailable. Connect again for wallet browser options."),
    { code: error?.code === 4001 ? 4001 : "WALLET_PICKER_UNAVAILABLE" });
  };
  let provider;
  try {
    const { createWalletConnectProvider } = await import("./walletconnect.js");
    if (!current()) throw aborted();
    provider = createWalletConnectProvider({ ownerDocument, isCurrent: current, signal });
  } catch (error) { throw fallback(error); }
  const request = provider.request.bind(provider);
  provider.request = args => args?.method === "eth_requestAccounts"
    ? request(args).catch(error => { throw fallback(error); })
    : request(args);
  return provider;
}

function browserLinks(ownerDocument) {
  const current = new URL(ownerDocument.location.href);
  if (current.protocol !== "https:" || current.username || current.password) return [];
  // Only this document's current URL is ever handed off; no caller-supplied redirect.
  const page = current.href;
  return [
    { id: "metamask", name: "Open MetaMask", href: "https://link.metamask.io/dapp/" + page.slice("https://".length) },
    { id: "trust", name: "Open Trust Wallet", href: "https://link.trustwallet.com/open_url?coin_id=60&url=" + encodeURIComponent(page) },
  ];
}
function legacyName(provider) {
  return provider.isCoinbaseWallet ? "Coinbase Wallet" : provider.isTrust || provider.isTrustWallet ? "Trust Wallet" :
    provider.isMetaMask ? "MetaMask" : "Browser wallet";
}
function browserProvider(win, providers, add) {
  try {
    const legacy = win.ethereum;
    const choices = (Array.isArray(legacy?.providers) ? legacy.providers : [legacy]).filter(validProvider);
    for (const provider of choices) if (!providers.some(item => item.provider === provider)) add(provider, legacyName(provider));
    // A singular provider supplied by the current browser takes precedence over
    // old passive announcements. Multiple injected wallets still get a choice.
    return choices.length === 1 ? choices[0] : null;
  } catch { return null; }
}
function discovery(win) {
  if (discoveries.has(win)) return discoveries.get(win);
  const providers = [], subscribers = new Set();
  const add = (provider, name) => {
    if (!validProvider(provider) || providers.length >= 20) return false;
    const known = providers.find(item => item.provider === provider);
    const label = typeof name === "string" && name.trim() && name.length <= 100 ? name.trim() : "Browser wallet";
    if (known) { if (known.name === label) return false; known.name = label; }
    else providers.push({ provider, name: label });
    return true;
  };
  // EIP-6963 requires this passive listener to remain for the page lifetime.
  win.addEventListener("eip6963:announceProvider", event => {
    try { if (add(event.detail?.provider, event.detail?.info?.name)) for (const update of subscribers) update(); }
    catch { /* Ignore invalid announcements. No icons or executable metadata are used. */ }
  });
  const value = { providers, add, subscribers }; discoveries.set(win, value); return value;
}
/** @param {{ownerDocument?: Document, isCurrent?: () => boolean, signal?: AbortSignal}} [options] */
export async function chooseWalletProvider({ ownerDocument = document, isCurrent = () => Boolean(true), signal } = {}) {
  const win = ownerDocument.defaultView;
  const pageURL = ownerDocument.location.href;
  const current = () => !signal?.aborted && isCurrent() && ownerDocument.location.href === pageURL;
  if (!win || !current()) throw aborted();
  active.get(ownerDocument)?.();
  const showBrowserFallback = browserFallback.get(ownerDocument) === pageURL;
  browserFallback.delete(ownerDocument);
  const { providers, add, subscribers } = discovery(win);
  win.dispatchEvent(new Event("eip6963:requestProvider"));
  let injected = browserProvider(win, providers, add);
  // EIP-6963 announcements can be delivered by the provider in a microtask.
  await Promise.resolve();
  if (!current()) throw aborted();
  if (injected) return injected;
  if (providers.length === 0) {
    // Mobile wallet browsers can inject after the first turn. Wait briefly only
    // when no provider exists, then keep late discovery available in the chooser.
    await new Promise((resolve, reject) => {
      let settled = false, timer, deadline;
      const finish = (error = null) => {
        if (settled) return; settled = true;
        clearInterval(timer); clearTimeout(deadline); subscribers.delete(scan);
        win.removeEventListener("ethereum#initialized", scan); signal?.removeEventListener("abort", abort);
        if (active.get(ownerDocument) === cancel) active.delete(ownerDocument);
        if (error) reject(error); else resolve(null);
      };
      const scan = () => { if (!current()) return finish(aborted()); injected = browserProvider(win, providers, add); if (injected || providers.length) finish(); };
      const abort = () => finish(aborted()), cancel = () => finish(cancelled());
      active.set(ownerDocument, cancel); subscribers.add(scan); win.addEventListener("ethereum#initialized", scan);
      signal?.addEventListener("abort", abort, { once: true }); timer = setInterval(scan, 30); deadline = setTimeout(() => finish(), 180); scan();
    });
    if (!current()) throw aborted();
    if (injected) return injected;
  }
  if (providers.length === 1) return providers[0].provider;
  if (providers.length === 0 && !showBrowserFallback && CURRENT_ORIGINS.has(ownerDocument.location.origin))
    return reownProvider(ownerDocument, current, signal);
  return new Promise((resolve, reject) => {
    if (!ownerDocument.querySelector("[data-wallet-connection-style]")) {
      const style = ownerDocument.createElement("link");
      style.rel = "stylesheet"; style.href = "/wallet-connection.css"; style.dataset.walletConnectionStyle = "";
      ownerDocument.head.append(style);
    }
    const previous = ownerDocument.activeElement;
    const dialog = ownerDocument.createElement("dialog");
    dialog.className = "wallet-connection-dialog";
    dialog.dataset.walletConnection = "";
    dialog.setAttribute("aria-labelledby", "wallet-connection-title");
    dialog.innerHTML = '<div class="wallet-connection-body"><button class="button button-secondary wallet-connection-close" type="button" data-wallet-connection-cancel>Close</button><h2 id="wallet-connection-title" tabindex="-1"></h2><div data-wallet-provider-list></div><div data-wallet-apps><h3>Open in your wallet app</h3><p>Open this page in your wallet app, then tap Connect wallet.</p><div class="wallet-connection-options" data-wallet-app-list></div></div><p class="wallet-connection-other">Other wallet? Copy this page link into its browser.</p><label for="wallet-connection-url">Page link</label><input id="wallet-connection-url" data-wallet-page-url readonly /><button type="button" class="button button-secondary" data-wallet-copy-page>Copy page link</button><p data-wallet-copy-status role="status" aria-live="polite"></p></div>';
    const heading = dialog.querySelector("h2"), providerList = dialog.querySelector("[data-wallet-provider-list]");
    dialog.querySelector("[data-wallet-page-url]").value = ownerDocument.location.href;
    let settled = false;
    const cleanup = (defer = false) => {
      subscribers.delete(update);
      win.removeEventListener("hashchange", stale); win.removeEventListener("popstate", stale);
      win.removeEventListener("ethereum#initialized", scanBrowser);
      signal?.removeEventListener("abort", stale); clearInterval(timer);
      if (active.get(ownerDocument) === cancel) active.delete(ownerDocument);
      const remove = () => { if (dialog.open) dialog.close(); dialog.remove(); if (current() && previous?.isConnected && typeof previous.focus === "function") previous.focus(); };
      if (defer) setTimeout(remove, 0); else remove();
    };
    const finish = (value, error = null, handoff = false) => {
      if (settled) return;
      settled = true; cleanup(handoff); if (error) reject(error); else resolve(value);
    };
    const stale = () => finish(null, aborted());
    const cancel = () => finish(null, cancelled());
    const timer = setInterval(() => { if (!current() || !dialog.isConnected) stale(); else scanBrowser(); }, 100);
    active.set(ownerDocument, cancel);
    const update = () => {
      if (settled) return;
      heading.textContent = providers.length ? "Choose your wallet" : "Open in your wallet app";
      dialog.querySelector("[data-wallet-apps] h3").hidden = providers.length === 0;
      providerList.replaceChildren();
      for (const entry of providers) {
        const button = ownerDocument.createElement("button");
        button.type = "button"; button.className = "button button-secondary"; button.dataset.walletProvider = ""; button.textContent = entry.name;
        button.addEventListener("click", () => { if (!current()) stale(); else finish(entry.provider); });
        providerList.append(button);
      }
    };
    const scanBrowser = () => { const before = providers.length; browserProvider(win, providers, add); if (providers.length !== before) update(); };
    subscribers.add(update);
    for (const entry of browserLinks(ownerDocument)) {
      const link = ownerDocument.createElement("a");
      link.className = "button button-secondary"; link.href = entry.href; link.dataset.walletApp = entry.id; link.textContent = entry.name; link.rel = "noreferrer";
      link.addEventListener("click", event => { if (!current()) { event.preventDefault(); stale(); } else finish(null, null, true); });
      dialog.querySelector("[data-wallet-app-list]").append(link);
    }
    if (CURRENT_ORIGINS.has(ownerDocument.location.origin)) {
      const more = ownerDocument.createElement("button");
      more.type = "button"; more.className = "button button-secondary"; more.dataset.walletMore = ""; more.textContent = "More wallets";
      more.addEventListener("click", async () => {
        if (!current()) return stale();
        more.disabled = true; more.textContent = "Opening wallets…";
        try {
          const provider = await reownProvider(ownerDocument, current, signal);
          if (settled) return;
          if (!current()) return stale();
          // Close the native top layer before the caller's account request can
          // load/open AppKit. Its controls must not remain behind an inert page.
          finish(provider);
        } catch (error) { finish(null, error); }
      });
      dialog.querySelector("[data-wallet-app-list]").append(more);
    }
    dialog.querySelector("[data-wallet-copy-page]").addEventListener("click", async () => {
      if (!current()) return stale();
      const input = dialog.querySelector("[data-wallet-page-url]"), label = dialog.querySelector("[data-wallet-copy-status]");
      try { await win.navigator.clipboard.writeText(input.value); if (!settled && current()) label.textContent = "Page link copied."; }
      catch { if (!settled && current()) { input.focus(); input.select(); label.textContent = "Copy the selected page link."; } }
    });
    dialog.querySelector("[data-wallet-connection-cancel]").addEventListener("click", cancel);
    dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
    dialog.addEventListener("close", cancel);
    win.addEventListener("hashchange", stale); win.addEventListener("popstate", stale);
    win.addEventListener("ethereum#initialized", scanBrowser);
    signal?.addEventListener("abort", stale, { once: true });
    ownerDocument.body.append(dialog); update(); dialog.showModal(); heading.focus();
    if (!current()) stale();
  });
}
