// Public creator metadata is a navigation aid, never organizer authority.
import { chooseWalletProvider } from "./wallet-connection.js";
import { EVENT, FIRST_EVENTS, firstEventById, firstEventDepositorsPath, firstEventRecoveryPath } from "./first-event/event.js";
import { savedDepositReference } from "./first-event/receipts.js";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const address = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const stable = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const hash = value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const eth = value => { const wei = BigInt(value), fraction = String(wei % 10n ** 18n).padStart(18, "0").replace(/0+$/, ""); return `${wei / 10n ** 18n}${fraction ? "." + fraction : ""}`; };

export function homeDepositSnapshot(value, expectedInstance = null, event = EVENT) {
  // This validator checks every receipt and total even when its wallet does not
  // match. Its full-deposit eligibility result is deliberately not used here:
  // a smaller completed payment is still a received payment worth displaying.
  savedDepositReference(value, event.contract, event);
  if (expectedInstance && value.instanceId !== expectedInstance) throw Error("Your saved deposit receipts belong to another server instance.");
  return Object.freeze({ status: value.status, checkedAt: value.checkedAt,
    rows: Object.freeze(value.depositors.filter(row => BigInt(row.totalReceivedWei) > 0n).map(row => Object.freeze({
      wallet: row.wallet, totalReceivedWei: row.totalReceivedWei,
      deposits: Object.freeze(row.deposits.map(lot => Object.freeze({ hash: lot.txHash, amountWei: lot.amountWei }))),
    }))) });
}

function managedEvents(value, expectedInstance) {
  if (value?.kind !== "kickback-setup-display" || value.displayOnly !== true || value.mode !== "hosted-production" ||
      !stable(value.instanceId) || (expectedInstance && value.instanceId !== expectedInstance) ||
      value.chain?.chainId !== 1 || value.environment?.chainId !== 1 || value.environment.production !== true ||
      value.environment.network !== "ethereum-mainnet" || value.contractVersion !== "kleros-event-v10-uups" ||
      value.session !== null || value.factory?.verified !== false || value.capabilities?.transactionsReady !== false ||
      value.capabilities.createEvents !== false || value.capabilities.manageEvents !== false || !Array.isArray(value.managedEvents))
    throw Error("Your events are unavailable.");
  const visible = value.managedEvents.filter(event => event?.visibility === "public" && event.editorialStatus === "published");
  const counts = new Map();
  for (const event of visible) if (stable(event.id)) counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
  return Object.freeze(visible.flatMap(event => {
    if (!stable(event.id) || counts.get(event.id) !== 1 || !address(event.creator) ||
        typeof event.title !== "string" || !event.title.trim() || event.title.length > 256) return [];
    return [Object.freeze({ id: event.id, creator: event.creator, title: event.title.trim(),
      startsAt: typeof event.startsAt === "string" && Number.isFinite(Date.parse(event.startsAt)) ? event.startsAt : null,
      timezone: typeof event.timezone === "string" && event.timezone.length <= 100 ? event.timezone : null })];
  }));
}
function date(event) {
  if (!event.startsAt || !event.timezone) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short", timeZone: event.timezone }).format(new Date(event.startsAt));
  } catch { return "Date unavailable"; }
}
export function renderHomeWallet() {
  return '<div data-home-wallet><section class="luma-launch-card"><h2>Your events</h2><button class="button button-secondary" type="button" data-home-connect-wallet>Connect wallet</button><p class="field-help mono" data-home-wallet-status role="status" aria-live="polite"></p><div data-home-events aria-live="polite"></div></section><section class="luma-launch-card" data-home-deposits-panel hidden><h2>Your deposits</h2><div data-home-deposits aria-live="polite"></div><p class="field-help">Saved payment receipts only. Admission, attendance and current withdrawable credit are checked separately.</p><p class="field-help" data-home-deposit-copy-status role="status"></p></section></div>';
}
export function mountHomeWallet(root, { isCurrent = () => Boolean(true), instanceId = null } = {}) {
  const section = root.querySelector("[data-home-wallet]");
  if (!section) return { dispose() {} };
  const button = section.querySelector("[data-home-connect-wallet]"), status = section.querySelector("[data-home-wallet-status]"), list = section.querySelector("[data-home-events]");
  const depositPanel = section.querySelector("[data-home-deposits-panel]"), depositList = section.querySelector("[data-home-deposits]"), copyStatus = section.querySelector("[data-home-deposit-copy-status]");
  const controller = new AbortController();
  const depositController = new AbortController();
  const walletController = new AbortController();
  let alive = true, revision = 0, busy = false, wallet = null, provider = null, events = null, unavailable = false, message = "";
  const depositSnapshots = new Map();
  let depositResults = 0, depositsUnavailable = false;
  const current = () => alive && root.isConnected && root.contains(section) && isCurrent();
  const paintDeposits = () => {
    depositPanel.hidden = wallet === null;
    copyStatus.textContent = "";
    depositList.setAttribute("aria-busy", String(Boolean(wallet && depositResults < FIRST_EVENTS.length)));
    if (!wallet) { depositList.replaceChildren(); return; }
    const matches = FIRST_EVENTS.flatMap(event => {
      const snapshot = depositSnapshots.get(event.id), row = snapshot?.rows.find(item => same(item.wallet, wallet));
      return row ? [{ event, snapshot, row }] : [];
    });
    if (!matches.length) {
      depositList.innerHTML = depositResults < FIRST_EVENTS.length ? '<p class="field-help">Loading your saved deposits…</p>' : depositsUnavailable
        ? '<p class="field-help">Saved deposit receipts are unavailable. Open your event to check your original transaction.</p>'
        : '<p class="field-help">No saved Truth Pays deposit receipts for this wallet yet.</p>';
      return;
    }
    depositList.innerHTML = `<ul class="public-event-list">${matches.map(({ event, snapshot, row }) => {
      const legacy = event.id !== EVENT.id, recovery = firstEventRecoveryPath(event).slice(1);
      return `<li class="public-event-row" data-home-deposit-row data-deposit-event="${event.id}"><div class="public-event-copy"><h3><a href="${legacy ? recovery : "/first-event/"}" data-home-deposit-event>${escape(event.title)}</a></h3>${legacy ? '<p class="field-help">Previous event — recovery only. Credit and receipts remain at the original contract.</p>' : ""}${snapshot.status === "stale" ? '<p class="field-help">Saved snapshot; the latest refresh is unavailable.</p>' : ""}<p>Saved total received: ${eth(row.totalReceivedWei)} ETH</p><ul>${row.deposits.map(lot => `<li><p>${eth(lot.amountWei)} ETH received · <a class="mono" href="https://etherscan.io/tx/${lot.hash}" target="_blank" rel="noopener noreferrer">${lot.hash}</a></p><button class="button button-secondary button-small" type="button" data-home-deposit-copy="${lot.hash}">Copy transaction ID</button><input class="mono" aria-label="Deposit transaction ID" readonly value="${lot.hash}" data-home-deposit-hash="${lot.hash}" hidden></li>`).join("")}</ul></div><a class="button button-secondary" data-home-deposit-manage href="${recovery}">${legacy ? "Recover original deposit" : "Manage attendance"}</a></li>`;
    }).join("")}</ul>`;
  };
  const paint = () => {
    if (!current()) return;
    button.disabled = busy;
    button.hidden = wallet !== null;
    status.textContent = wallet ? `Connected · ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : message;
    paintDeposits();
    list.setAttribute("aria-busy", String(Boolean(wallet && events === null && !unavailable)));
    if (!wallet) { list.replaceChildren(); return; }
    if (unavailable) { list.innerHTML = '<p class="field-help">Your events are unavailable.</p>'; return; }
    if (events === null) { list.innerHTML = '<p class="field-help">Loading your events…</p>'; return; }
    const rows = events.filter(event => same(event.creator, wallet));
    list.innerHTML = rows.length ? `<ul class="public-event-list">${rows.map(event => { const previous = firstEventById(event.id) && event.id !== EVENT.id; return `<li class="public-event-row" data-home-event-row><div class="public-event-copy"><h3>${escape(event.title)}</h3><p class="public-event-date">${escape(date(event))}</p><span class="badge">${previous ? "Previous event — recovery only" : "Public · Published"}</span></div><a class="button button-secondary" data-home-event-manage href="${previous ? firstEventRecoveryPath(firstEventById(event.id)).slice(1) : "#" + new URLSearchParams({ event: event.id, view: "organizer" })}" aria-label="${previous ? "Recover previous event" : "Manage event"}: ${escape(event.title)}">${previous ? "Recover previous event" : "Manage event"}</a></li>`; }).join("")}</ul>` : '<p class="field-help">No events for this wallet yet.</p>';
  };
  const copy = async event => {
    const target = event.target.closest?.("[data-home-deposit-copy]"), value = target?.dataset.homeDepositCopy, captured = wallet;
    if (!current() || !address(captured) || !hash(value) || ![...depositSnapshots.values()].some(snapshot => snapshot.rows.some(row => same(row.wallet, captured) && row.deposits.some(lot => same(lot.hash, value))))) return;
    const stillCurrent = () => current() && same(wallet, captured) && depositList.contains(target);
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (stillCurrent()) copyStatus.textContent = "Transaction ID copied.";
    } catch {
      if (stillCurrent()) {
        const input = [...depositList.querySelectorAll("[data-home-deposit-hash]")].find(item => same(item.dataset.homeDepositHash, value));
        if (input) { input.hidden = false; input.focus(); input.select(); copyStatus.textContent = "Copy the selected transaction ID."; }
      }
    }
  };
  const changed = () => { revision++; wallet = null; busy = false; message = ""; paint(); };
  const detach = () => {
    provider?.removeListener?.("accountsChanged", changed);
    provider?.removeListener?.("chainChanged", changed);
  };
  const connect = async () => {
    if (!current() || busy) return;
    const ownRevision = ++revision;
    busy = true; message = ""; detach(); paint();
    try {
      const selectedProvider = await chooseWalletProvider({ ownerDocument: root.ownerDocument,
        isCurrent: () => current() && revision === ownRevision, signal: walletController.signal });
      if (!selectedProvider) return;
      const accounts = await selectedProvider.request({ method: "eth_requestAccounts" });
      if (!current() || revision !== ownRevision) return;
      if (!address(accounts?.[0])) throw Error("No wallet account was selected.");
      wallet = accounts[0]; provider = selectedProvider;
      provider.on?.("accountsChanged", changed);
      provider.on?.("chainChanged", changed);
    } catch (error) {
      if (current() && revision === ownRevision) { wallet = null; message = Number(error.code) === 4001 ? "Wallet connection cancelled." : error.message || "Wallet connection could not finish."; }
    } finally {
      if (current() && revision === ownRevision) { busy = false; paint(); }
    }
  };
  button.addEventListener("click", connect);
  depositList.addEventListener("click", copy);
  // Starts independently on mount. Connect never starts or repeats this read.
  const timer = setTimeout(() => controller.abort(), 35000);
  fetch("/api/kickback-setup", { credentials: "omit", cache: "no-store", signal: controller.signal })
    .then(async response => {
      if (!response.ok) throw Error("Your events are unavailable.");
      const value = await response.json();
      if (!current()) return;
      events = managedEvents(value, instanceId); paint();
    }).catch(() => { if (current()) { unavailable = true; events = null; paint(); } })
    .finally(() => clearTimeout(timer));
  const depositTimer = setTimeout(() => depositController.abort(), 35000);
  Promise.allSettled(FIRST_EVENTS.map(event => fetch(firstEventDepositorsPath(event), { credentials: "omit", cache: "no-store", signal: depositController.signal })
    .then(async response => {
      if (!response.ok) throw Error("Saved deposit receipts are unavailable.");
      const value = await response.json();
      if (!current()) return;
      depositSnapshots.set(event.id, homeDepositSnapshot(value, instanceId, event));
    }).catch(() => { if (current()) { depositsUnavailable = true; depositSnapshots.delete(event.id); } })
    .finally(() => { depositResults++; if (current()) paint(); })))
    .finally(() => clearTimeout(depositTimer));
  paint();
  return { dispose() { alive = false; revision++; controller.abort(); depositController.abort(); walletController.abort(); clearTimeout(timer); clearTimeout(depositTimer); detach(); button.removeEventListener("click", connect); depositList.removeEventListener("click", copy); } };
}
