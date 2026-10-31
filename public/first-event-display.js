// Public presentation only. No response from this module grants signing authority.
import { EVENT as DEFAULT_EVENT, firstEventById, firstEventDepositorsPath } from "./first-event/event.js";
import { mountFirstEventManage } from "./first-event-manage.js";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const address = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const hash = value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const eth = value => {
  const wei = BigInt(value), fraction = String(wei % 1000000000000000000n).padStart(18, "0").replace(/0+$/, "");
  return `${wei / 1000000000000000000n}${fraction ? "." + fraction : ""}`;
};
export function isFirstEventDisplayRoute(value = location.hash) {
  const params = new URLSearchParams(String(value).replace(/^#/, ""));
  return params.getAll("event").length === 1 && firstEventById(params.get("event")) !== null &&
    params.getAll("view").length <= 1 && [null, "participant", "organizer"].includes(params.get("view")) &&
    !params.has("setup") && params.get("review") !== "1";
}
function checkedSnapshot(data, EVENT = DEFAULT_EVENT) {
  if (!data || data.schemaVersion !== 1 || data.kind !== "first-event-depositors" || data.displayOnly !== true ||
    data.mode !== EVENT.mode || typeof data.instanceId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(data.instanceId) ||
    data.eventId !== EVENT.id || data.chainId !== EVENT.chainId || !same(data.contract, EVENT.contract) ||
    !["current", "stale"].includes(data.status) || typeof data.checkedAt !== "string" || !Number.isFinite(Date.parse(data.checkedAt)) ||
    !integer(data.blockNumber) || !hash(data.blockHash) || !Array.isArray(data.depositors) || data.depositors.length > 1000 ||
    ["permissions", "capabilities", "session", "deploymentTrust", "actionable"].some(key => Object.hasOwn(data, key)))
    throw Error("The depositor list belongs to another event or is unavailable.");
  const wallets = new Set(), receipts = new Set();
  let lots = 0;
  for (const row of data.depositors) {
    if (!address(row.wallet) || wallets.has(row.wallet.toLowerCase()) || !amount(row.totalReceivedWei) ||
      !Array.isArray(row.deposits) || row.deposits.length === 0 || (lots += row.deposits.length) > 2000)
      throw Error("The depositor list is incomplete.");
    wallets.add(row.wallet.toLowerCase());
    let total = 0n;
    for (const deposit of row.deposits) {
      const key = `${deposit.txHash}:${deposit.logIndex}`.toLowerCase();
      if (!hash(deposit.txHash) || !integer(deposit.logIndex) || !amount(deposit.amountWei) ||
        !integer(deposit.blockNumber) || deposit.blockNumber > data.blockNumber || !hash(deposit.blockHash) || receipts.has(key))
        throw Error("The deposit receipt list is incomplete.");
      receipts.add(key); total += BigInt(deposit.amountWei);
    }
    if (total !== BigInt(row.totalReceivedWei)) throw Error("The deposit totals do not match their receipts.");
  }
  if (data.eventState !== undefined) {
    const state = data.eventState, stakers = new Set();
    if (!state || !["Open", "Listed", "Finalized", "Cancelled"].includes(state.phase) || !address(state.owner) ||
        !["eventStart", "endsAt", "claimDeadline", "challengeEndsAt"].every(key => integer(state[key])) ||
        !amount(state.challengeDepositWei) || !Array.isArray(state.stakers) || state.stakers.length > 150 ||
        (state.chainTimestamp !== undefined && !integer(state.chainTimestamp)) ||
        Object.keys(state).some(key => !["phase", "owner", "eventStart", "endsAt", "claimDeadline", "challengeEndsAt", "challengeDepositWei", "stakers", "chainTimestamp"].includes(key)))
      throw Error("The saved attendance state is incomplete.");
    for (const staker of state.stakers) {
      const challenge = staker?.challenge;
      if (!address(staker?.wallet) || stakers.has(staker.wallet.toLowerCase()) || ![0, 1, 2, 3].includes(staker.status) || typeof staker.attended !== "boolean" ||
          Object.keys(staker).some(key => !["wallet", "status", "attended", "challenge"].includes(key)) ||
          !challenge || ![0, 1, 2, 3].includes(challenge.state) || !amount(challenge.depositWei) || !integer(challenge.matchDeadline) || !amount(challenge.localId) ||
          Object.keys(challenge).some(key => !["state", "depositWei", "matchDeadline", "localId"].includes(key)))
        throw Error("The saved staker state is incomplete.");
      stakers.add(staker.wallet.toLowerCase());
    }
  }
  return data;
}
export function mountFirstEventDisplay({ root, view = "participant", onReview, event: EVENT = DEFAULT_EVENT }) {
  if (!root || !["participant", "organizer", "recovery"].includes(view) || typeof onReview !== "function")
    throw Error("Choose the event view before opening it.");
  const known = firstEventById(EVENT?.id);
  if (!known || !same(known.contract, EVENT.contract) || EVENT.chainId !== known.chainId || EVENT.abiVersion !== known.abiVersion)
    throw Error("The saved event identity is unavailable.");
  const organizer = view === "organizer";
  const recovery = view === "recovery";
  let disposed = false, inflight = null, controller = null, instanceId = null, wallet = null, saved = null, manage = null;
  root.innerHTML = `<article class="luma-launch" data-first-event-display>
    <a class="back-link" href="#">← All events</a>
    <header class="luma-launch-event"><div class="eyebrow">ETHEREUM MAINNET · TRUTH PAYS</div>
      <h1>${organizer ? "Manage Event" : recovery ? "Your deposit" : "Truth Pays"}</h1>
      <p>${escape(EVENT.title)}</p><p>${escape(EVENT.dateLabel ?? "Event date unavailable")} · ${escape(EVENT.hoursLabel ?? "Event hours unavailable")}</p>
      ${EVENT.id !== DEFAULT_EVENT.id ? '<p class="field-help">Previous event — recovery only. These receipts and unused credits remain at this original contract; they have not moved to the replacement event.</p>' : ""}
      <dl class="details-list"><div><dt>Deposit per guest</dt><dd>0.01 ETH</dd></div>
      <div><dt>Event contract</dt><dd><a class="mono" href="https://etherscan.io/address/${EVENT.contract}" target="_blank" rel="noopener noreferrer">${EVENT.contract}</a></dd></div></dl>
    </header>
    ${organizer || recovery ? `<section class="panel" aria-labelledby="depositor-title"><div class="panel-header"><h2 id="depositor-title">${recovery ? "Your deposit receipts" : "Depositors"}</h2><button class="button button-secondary button-small" type="button" data-display-refresh>Refresh list</button></div>
      <p class="small muted" data-display-status role="status" aria-live="polite">Receipts are refreshed separately from these event details.</p>
      <div data-display-rows></div><p class="field-help">This public list shows confirmed amounts received. Admission, contract registration and refunds are checked separately when you review an action.</p></section>` : `<section class="panel"><h2>Your event deposit</h2><p>Deposit 0.01 ETH from the wallet you will use for this event, then finish your registration on Luma.</p><div class="button-row"><a class="button button-primary" href="/first-event/">Open deposit</a><a class="button button-secondary" href="${EVENT.lumaUrl}" target="_blank" rel="noopener noreferrer">Open event on Luma ↗</a></div></section>`}
    ${organizer || recovery ? '<div data-display-manage></div>' : ""}
    ${!organizer ? `<section class="panel"><button class="button button-secondary" type="button" ${recovery ? 'data-manage-action="withdrawPending" data-manage-withdraw disabled' : "data-display-review"}>${recovery ? "Recover unused deposit" : "Manage deposit or recover credit"}</button>
    <p class="field-help">${recovery ? "Connect the wallet that paid, then review recovery to that same wallet. Your current unused credit is checked before the transaction; past receipts are not your withdrawable balance." : "Current contract and wallet checks run before transaction reviews."}</p></section>
    ` : ""}
  </article>`;
  const refreshButton = root.querySelector("[data-display-refresh]");
  const status = root.querySelector("[data-display-status]");
  const rows = root.querySelector("[data-display-rows]");
  const reviewButton = root.querySelector("[data-display-review]");
  const current = () => !disposed && root.isConnected;
  const review = () => { if (current()) onReview(recovery ? { action: "recover", wallet } : undefined); };
  reviewButton?.addEventListener("click", review);
  function render(data) {
    saved = data;
    const time = new Date(data.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    status.textContent = `${data.status === "stale" ? "Saved snapshot; refresh unavailable. " : ""}Checked ${time} · block ${data.blockNumber.toLocaleString()}`;
    if (recovery) {
      const row = data.depositors.find(item => same(item.wallet, wallet));
      rows.innerHTML = !wallet ? "<p>Connect your wallet to see its saved receipts.</p>" : !row ? "<p>No saved deposit receipts for this wallet yet.</p>" : `<p>Total received: ${eth(row.totalReceivedWei)} ETH</p><ul>${row.deposits.map(lot => `<li>${eth(lot.amountWei)} ETH · <a href="https://etherscan.io/tx/${lot.txHash}" target="_blank" rel="noopener noreferrer">Transaction ${lot.txHash}</a></li>`).join("")}</ul>`;
      manage?.update(); return;
    }
    rows.innerHTML = data.depositors.length ? `<p class="small muted">${data.depositors.length} depositor ${data.depositors.length === 1 ? "wallet" : "wallets"}</p><div class="table-scroll"><table aria-label="Confirmed depositor wallets"><thead><tr><th scope="col">Wallet</th><th scope="col">Total received</th><th scope="col">Receipts</th><th scope="col">Admission</th><th scope="col">Door check-in</th><th scope="col">Owner attendance list</th></tr></thead><tbody>${data.depositors.map(row => {
      const staker = data.eventState?.stakers?.find(item => same(item.wallet, row.wallet));
      const registered = [1, "Staker"].includes(staker?.status);
      return `<tr><td data-label="Wallet"><a class="mono" href="https://etherscan.io/address/${row.wallet}" target="_blank" rel="noopener noreferrer">${row.wallet}</a></td><td data-label="Total received">${eth(row.totalReceivedWei)} ETH</td><td data-label="Receipts">${row.deposits.map((deposit, index) => `<a href="https://etherscan.io/tx/${deposit.txHash}" target="_blank" rel="noopener noreferrer">Receipt ${index + 1}</a>`).join(" · ")}</td><td data-label="Admission">${registered ? "Registered" : `<span data-manage-owner-register-hint>Owner approval required</span><button class="button button-secondary button-small" type="button" data-manage-register="${row.wallet}">Approve &amp; register</button>`}</td><td data-label="Door check-in"><span class="small" data-manage-checkin-state>Load permissions to view check-ins. </span><button class="button button-secondary button-small" type="button" data-manage-staff-checkin="${row.wallet}" hidden disabled>Check in</button></td><td data-label="Owner attendance list"><span data-manage-final-hint>Owner review required</span><label data-manage-final-label hidden><input type="checkbox" value="${row.wallet}" data-manage-attended disabled> Include in final list</label></td></tr>`;
    }).join("")}</tbody></table></div>` : "<p>No confirmed deposits at this snapshot.</p>";
    manage?.update();
  }
  function refresh() {
    if ((!organizer && !recovery) || !current()) return Promise.resolve(null);
    if (inflight) return inflight;
    controller = new AbortController();
    const ownController = controller;
    const timeout = setTimeout(() => ownController.abort(), 35000);
    refreshButton.disabled = true;
    inflight = (async () => {
      try {
        const response = await fetch(firstEventDepositorsPath(EVENT), { method: "GET", credentials: "omit", cache: "no-store", signal: ownController.signal });
        if (!response.ok) throw Error("The depositor list could not be refreshed.");
        const data = checkedSnapshot(await response.json(), EVENT);
        if (!current() || ownController.signal.aborted) return null;
        // A new backend instance starts a separate display context; do not retain
        // rows from its predecessor if the new response cannot be validated.
        if (instanceId && instanceId !== data.instanceId) rows.replaceChildren();
        instanceId = data.instanceId;
        render(data); return data;
      } catch {
        if (current()) status.textContent = "The depositor list could not be refreshed. Use Refresh list to try again. Any displayed rows are from the previous snapshot.";
        return null;
      } finally {
        clearTimeout(timeout);
        if (current()) refreshButton.disabled = false;
        if (controller === ownController) { controller = null; inflight = null; }
      }
    })();
    return inflight;
  }
  refreshButton?.addEventListener("click", refresh);
  if (organizer || recovery) manage = mountFirstEventManage({ root: root.querySelector("[data-display-manage]"), view, event: EVENT,
    getSnapshot: () => saved, isCurrent: current, onRefresh: refresh,
    onWallet: selected => { wallet = selected; if (saved && current()) render(saved); } });
  if (organizer || recovery) void refresh();
  return Object.freeze({ refresh, dispose() { disposed = true; controller?.abort(); manage?.dispose(); refreshButton?.removeEventListener("click", refresh); reviewButton?.removeEventListener("click", review); } });
}
