// Cached receipts render the page. Every signed action obtains fresh private
// authority through the original scoped jobs; this module never bootstraps an event.
import { EVENT as DEFAULT_EVENT, firstEventById, firstEventRecoveryPath } from "./first-event/event.js";
import { chooseWalletProvider } from "./wallet-connection.js";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const address = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
const stable = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const hash = value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const wei = value => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const eth = value => { const amount = BigInt(value), fraction = String(amount % 10n ** 18n).padStart(18, "0").replace(/0+$/, ""); return `${amount / 10n ** 18n}${fraction ? "." + fraction : ""}`; };
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const fail = message => { throw Error(message); };
const word = value => BigInt(value).toString(16).padStart(64, "0");
const addressWord = value => { if (!address(value)) fail("Choose an exact wallet address."); return value.slice(2).toLowerCase().padStart(64, "0"); };
const walletsEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => same(value, b[i]));
const intentPrefix = "kleros-first-event-manage-intent:v1:";
const depositIntentPrefix = "kleros-first-event-intent:v1:";
const names = { transferOwnership: "Transfer event ownership", acceptOwnership: "Accept event ownership", register: "Approve & register", postAttendance: "Post attendance", challenge: "Challenge incorrect absence", match: "Contest challenge · open Kleros case", resolve: "Resolve original challenge", withdrawPending: "Recover unused deposit" };
function contextMatches(context, wallet, EVENT = DEFAULT_EVENT) {
  return context?.eventId === EVENT.id && context.chainId === 1 && same(context.contract, EVENT.contract) &&
    context.mode === EVENT.mode && context.abiVersion === EVENT.abiVersion && same(context.wallet, wallet) && stable(context.instanceId);
}
function encoded(action, args) {
  if (action === "transferOwnership") return "0xf2fde38b" + addressWord(args[0]);
  if (action === "acceptOwnership") return "0x79ba5097";
  if (action === "withdrawPending") return "0x8033b09f" + addressWord(args[0]) + word(args[1]);
  if (action === "challenge") return "0xd2ef7398";
  if (action === "match" || action === "resolve") return (action === "match" ? "0x6d6df455" : "0x32064dac") + addressWord(args[0]);
  const list = args[0], tail = word(list.length) + list.map(addressWord).join("");
  return action === "register" ? "0xab50d54e" + word(32) + tail : "0x5d95e1d2" + word(64) + word(args[1]) + tail;
}
export function assertFirstEventManageDraft(draft, context, action, params, origin = location.origin, EVENT = DEFAULT_EVENT) {
  const known = firstEventById(EVENT?.id);
  if (!known || !same(known.contract, EVENT.contract) || !contextMatches(context, context?.wallet, EVENT) || !names[action] || draft?.action !== action || !stable(draft.id) ||
      draft.eventId !== EVENT.id || draft.chainId !== 1 || !same(draft.contract, EVENT.contract) || !same(draft.wallet, context.wallet) ||
      draft.mode !== EVENT.mode || draft.instanceId !== context.instanceId || draft.origin !== origin ||
      draft.contractVersion !== EVENT.abiVersion || draft.abiVersion !== EVENT.abiVersion || draft.scopeKind !== "event-call" ||
      !stable(draft.snapshot) || !Number.isSafeInteger(draft.expiresAt) || Date.now() >= draft.expiresAt || !wei(draft.valueWei) || !Array.isArray(draft.args))
    fail("This review belongs to another event, wallet or server, or has expired.");
  const methods = { transferOwnership: "transferOwnership", acceptOwnership: "acceptOwnership", register: "registerStakers", postAttendance: "postAttendance", challenge: "challenge", match: "matchChallenge", resolve: "resolveChallenge", withdrawPending: "withdrawPending" };
  const args = draft.args;
  if (draft.method !== methods[action]) fail("The reviewed contract method changed.");
  if (action === "register" || action === "postAttendance") {
    const expected = action === "register" ? params.wallets : params.attendedWallets;
    if (!walletsEqual(args[0], expected) || !expected.length || expected.length > 150 ||
        new Set(expected.map(value => value.toLowerCase())).size !== expected.length || !expected.every(address) ||
        args.length !== (action === "register" ? 1 : 2) || (action === "postAttendance" && !wei(String(args[1]))) || draft.valueWei !== "0")
      fail("The reviewed wallet list or transaction amount changed.");
  } else if (action === "transferOwnership") {
    if (!params || Object.keys(params).length !== 1 || !address(params.to) || args.length !== 1 ||
        !same(args[0], params.to) || draft.valueWei !== "0" || !draft.params ||
        Object.keys(draft.params).length !== 1 || !same(draft.params.to, params.to))
      fail("The exact new event owner or transaction amount changed.");
  } else if (action === "acceptOwnership") {
    if (!params || Object.keys(params).length || args.length || draft.valueWei !== "0" ||
        !draft.params || Object.keys(draft.params).length) fail("The ownership acceptance changed.");
  } else if (action === "withdrawPending") {
    if (!params || Object.keys(params).length || args.length !== 2 || !same(args[0], context.wallet) ||
        !wei(String(args[1])) || BigInt(args[1]) <= 0n || draft.valueWei !== "0" ||
        !draft.params || Object.keys(draft.params).length !== 2 || !same(draft.params.to, context.wallet) ||
        draft.params.amountWei !== String(args[1])) fail("The recovery amount or destination changed. Recover only your own unused credit to this wallet.");
  } else if (action === "challenge") {
    if (args.length || BigInt(draft.valueWei) <= 0n) fail("The challenge payment review is incomplete.");
  } else if (args.length !== 1 || !same(args[0], params.wallet ?? context.wallet) ||
      (action === "resolve" ? draft.valueWei !== "0" : BigInt(draft.valueWei) <= 0n)) fail("The original challenge or amount changed.");
  const tx = draft.transaction;
  if (!same(tx?.to, EVENT.contract) || !same(tx?.from, context.wallet) || Number(tx?.chainId) !== 1 ||
      String(tx?.value) !== draft.valueWei || !same(tx?.data, encoded(action, args)))
    fail("The transaction differs from the exact reviewed contract call.");
  return draft;
}
// This private DTO controls which tools are shown. It never replaces the
// fresh contract owner/source checks used by the reviewed transaction sender.
export function assertFirstEventAccess(data, context, EVENT = DEFAULT_EVENT) {
  const zero = "0x" + "0".repeat(40), roles = ["owner", "pending-owner", "admin", "staff", "participant"];
  if (!contextMatches(context, context?.wallet, EVENT) || data?.kind !== "event-access" || data.eventId !== EVENT.id ||
      data.chainId !== 1 || !same(data.contract, EVENT.contract) || data.instanceId !== context.instanceId ||
      !same(data.wallet, context.wallet) || !address(data.owner) || !(same(data.pendingOwner, zero) || address(data.pendingOwner)) ||
      !roles.includes(data.role) || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(data.admins) || !Array.isArray(data.staff) || !Array.isArray(data.checkins) ||
      data.admins.length > 1000 || data.staff.length > 1000 || data.checkins.length > 1000)
    fail("The event permissions belong to another wallet, event or server.");
  for (const list of [data.admins, data.staff]) if (!list.every(address) || new Set(list.map(value => value.toLowerCase())).size !== list.length)
    fail("The event access list is incomplete.");
  const expected = same(data.wallet, data.owner) ? "owner" : same(data.wallet, data.pendingOwner) ? "pending-owner" :
    data.admins.some(value => same(value, data.wallet)) ? "admin" : data.staff.some(value => same(value, data.wallet)) ? "staff" : "participant";
  if (data.role !== expected || (data.role === "participant" && (data.admins.length || data.staff.length || data.checkins.length)))
    fail("The event role does not match this wallet's permissions.");
  const checked = new Set();
  for (const item of data.checkins) {
    if (!item || !address(item.wallet) || !address(item.actorWallet) || checked.has(item.wallet.toLowerCase()) ||
        typeof item.recordedAt !== "string" || !Number.isFinite(Date.parse(item.recordedAt)) ||
        Object.keys(item).some(key => !["wallet", "actorWallet", "recordedAt"].includes(key)))
      fail("The event check-in list is incomplete.");
    checked.add(item.wallet.toLowerCase());
  }
  return data;
}
export function mountFirstEventManage({ root, view, getSnapshot, onWallet = () => {}, onRefresh = async () => {}, isCurrent = () => true, event: EVENT = DEFAULT_EVENT }) {
  if (!root || typeof getSnapshot !== "function") fail("Choose the event before managing it.");
  const known = firstEventById(EVENT?.id);
  if (!known || !same(known.contract, EVENT.contract) || EVENT.chainId !== known.chainId || EVENT.abiVersion !== known.abiVersion)
    fail("The saved event identity is unavailable.");
  let disposed = false, revision = 0, provider = null, wallet = null, authenticated = false, policy = null, context = null;
  let busy = false, draft = null, reviewed = null, servicePromise = null, receipt = null, access = null;
  const accessEnabled = view === "organizer" && EVENT.id === DEFAULT_EVENT.id;
  const checkinNonces = new Map();
  const abort = new AbortController(), selected = new Set();
  root.innerHTML = `<section class="panel" data-first-event-manage><h2>${view === "organizer" ? "Manage attendance" : view === "recovery" ? "Your deposit & attendance" : "Your attendance & challenges"}</h2>
    <button type="button" class="button button-primary" data-manage-connect>Connect wallet</button><p class="mono small" data-manage-wallet></p>
    <p class="small" data-manage-state>Saved event details are for display. Your current role and contract rules are checked when you review an action.</p>
    ${accessEnabled ? '<section data-manage-access><h3>Event access</h3><button type="button" class="button button-secondary" data-manage-access-load disabled>Load event permissions</button><p class="small" data-manage-access-status>Connect your wallet, then load private event permissions when needed.</p><div data-manage-access-controls></div></section>' : ""}
    ${view === "organizer" ? `<form data-manage-attendance><p>The contract owner selects registered wallets for the final attendance list, then posts it after the event ends. Recorded door check-ins stay separate from this selection.</p>
      <label>Attendance review note<textarea name="note" maxlength="1000" minlength="8" required placeholder="Explain how you verified attendance during the event."></textarea></label>
      <label><input type="checkbox" name="confirmed" required> I confirm the selected registered wallets attended during the event. Omitted wallets retain their challenge rights.</label>
      <button type="submit" class="button button-primary" data-manage-post disabled>Review attendance list</button></form>` : ""}
    <div data-manage-participant></div><p class="field-help">Attendance posting opens a 24-hour omission challenge window. Each challenge has a separate 24-hour matching period. Matching pays the reviewed amount and opens a real Kleros case; it is a separate action.</p>
    <p class="small mono" data-manage-status role="status" aria-live="polite"></p><div data-manage-pending></div></section>`;
  const panel = root.querySelector("[data-first-event-manage]"), label = root.querySelector("[data-manage-wallet]"), status = root.querySelector("[data-manage-status]");
  const connectButton = root.querySelector("[data-manage-connect]"), participant = root.querySelector("[data-manage-participant]");
  const dialog = root.ownerDocument.createElement("dialog"); dialog.className = "wallet-review"; dialog.dataset.manageReview = ""; root.ownerDocument.body.append(dialog);
  const current = captured => !disposed && root.isConnected && isCurrent() && (captured === undefined || captured === revision);
  const say = message => { if (current()) status.textContent = message; };
  const services = () => servicePromise ??= Promise.all([import("./event-read.js"), import("./v10-wallet-account.js"), import("./transaction-context.js")]).then(([read, account, transactions]) => ({ ...read, ...account, ...transactions, journal: transactions.createTransactionJournal(localStorage) }));
  const api = async (path, options = {}) => {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...options.headers } });
    const data = await response.json();
    if (!response.ok) { if (response.status === 401) authenticated = false; throw Object.assign(Error(data.error ?? "The event action could not finish."), { code: data.code, status: response.status }); }
    return data;
  };
  function pendingFromStorage(journal) {
    if (!wallet) return null;
    if (!Number.isSafeInteger(localStorage.length) || localStorage.length > 4096) fail("Preserve transaction storage and check your previous wallet activity.");
    let held = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("kleros-transactions:v1:") && !key?.startsWith(intentPrefix) && !key?.startsWith(depositIntentPrefix)) continue;
      const depositIntent = key.startsWith(depositIntentPrefix), manageIntent = key.startsWith(intentPrefix);
      let fields;
      try { fields = key.slice(depositIntent ? depositIntentPrefix.length : manageIntent ? intentPrefix.length : "kleros-transactions:v1:".length).split(":").map(decodeURIComponent); }
      catch { continue; }
      if (depositIntent ? fields.length !== 8 || fields[0] !== location.origin || fields[2] !== EVENT.mode || fields[3] !== EVENT.id || fields[4] !== "1" || !same(fields[5], EVENT.contract) || !same(fields[6], wallet) || fields[7] !== EVENT.abiVersion : manageIntent ? ![3, 5].includes(fields.length) || fields[0] !== location.origin || !same(fields[2], wallet) :
        fields.length !== 7 || fields[1] !== EVENT.mode || fields[2] !== EVENT.id || fields[3] !== "1" ||
          !same(fields[4], EVENT.contract) || !same(fields[5], wallet) || fields[6] !== EVENT.abiVersion) continue;
      let raw; try { raw = JSON.parse(localStorage.getItem(key)); } catch { fail("A wallet request record is unreadable. Preserve storage and check the original wallet activity."); }
      if (depositIntent) {
        if (raw?.phase !== "awaiting-wallet" || !stable(raw.draftId) || !stable(fields[1])) fail("The original deposit wallet request record is invalid. Preserve it and check wallet activity.");
        held = { ...raw, status: "awaiting-wallet", action: "deposit", context: { eventId: EVENT.id, chainId: 1, contract: EVENT.contract, wallet, mode: EVENT.mode, abiVersion: EVENT.abiVersion, instanceId: fields[1] } };
        continue;
      }
      if (manageIntent) {
        const other = firstEventById(raw?.context?.eventId);
        const exactOther = other && other.id !== EVENT.id && contextMatches(raw.context, wallet, other) &&
          Object.keys(raw.context).length === 7 && Object.keys(raw).length === 4 && raw.context.instanceId === fields[1] &&
          raw.origin === location.origin && raw.phase === "awaiting-wallet" && stable(raw.draftId) &&
          (fields.length === 3 || (fields[3] === other.id && same(fields[4], other.contract)));
        if (exactOther) continue;
        if (fields.length === 5 && (fields[3] !== EVENT.id || !same(fields[4], EVENT.contract)))
          fail("The original wallet request event scope changed. Preserve it and check wallet activity.");
      }
      if (!contextMatches(raw?.context, wallet, EVENT) || raw.context.instanceId !== fields[manageIntent ? 1 : 0]) fail("The original transaction storage scope changed. Preserve it and check wallet activity.");
      if (manageIntent) {
        if (raw.origin !== location.origin || raw.phase !== "awaiting-wallet" || !stable(raw.draftId)) fail("The previous wallet request record is invalid. Preserve it and check wallet activity.");
        held = { ...raw, status: "awaiting-wallet" };
      } else {
        const expected = "kleros-transactions:v1:" + [raw.context.instanceId, raw.context.mode, raw.context.eventId, String(raw.context.chainId), raw.context.contract.toLowerCase(), raw.context.wallet.toLowerCase(), raw.context.abiVersion].map(encodeURIComponent).join(":");
        if (expected !== key) fail("The original transaction journal namespace changed. Preserve it and check wallet activity.");
        const entry = journal.list(raw.context).find(item => !["confirmed", "failed"].includes(item.status));
        if (entry) return { ...entry, context: raw.context };
      }
    }
    return held;
  }
  function paintPending(value) {
    receipt = value;
    const host = root.querySelector("[data-manage-pending]");
    host.innerHTML = value ? `<p>${value.hash ? "Original submitted transaction" : "An earlier wallet request has no recorded hash. Check your wallet activity before another action."}</p>${value.hash ? `<p class="mono"><a href="https://etherscan.io/tx/${value.hash}" target="_blank" rel="noopener noreferrer">${value.hash}</a></p><button type="button" class="button button-secondary button-small" data-manage-copy-hash>Copy transaction ID</button><input aria-label="Original transaction ID" value="${value.hash}" readonly hidden>` : ""}${value.action === "deposit" ? `<a class="button button-secondary" href="${EVENT.id === DEFAULT_EVENT.id ? "/first-event/" : firstEventRecoveryPath(EVENT)}" data-manage-original-deposit>${EVENT.id === DEFAULT_EVENT.id ? "Check original deposit" : "Open original event recovery"}</a>` : value.hash ? '<button type="button" class="button button-secondary" data-manage-check-original>Check original transaction</button>' : ""}` : "";
    update();
  }
  function currentAccess() {
    return access && wallet && same(access.wallet, wallet) && context && access.instanceId === context.instanceId &&
      (!getSnapshot()?.instanceId || access.instanceId === getSnapshot().instanceId) ? access : null;
  }
  function renderAccess() {
    if (!accessEnabled) return;
    const value = currentAccess(), load = root.querySelector("[data-manage-access-load]");
    load.disabled = !wallet || busy;
    const text = root.querySelector("[data-manage-access-status]"), host = root.querySelector("[data-manage-access-controls]");
    if (!value) {
      text.textContent = wallet ? "Load event permissions to manage access or record check-ins. Sign-in is requested only here or before a contract action." : "Connect your wallet, then load private event permissions when needed.";
      host.replaceChildren(); return;
    }
    const labels = { owner: "Contract owner", admin: "Admin", staff: "Check-in staff", "pending-owner": "Pending owner", participant: "Participant" };
    text.textContent = `${labels[value.role]} · permissions revision ${value.revision}`;
    const grants = ["owner", "admin"].includes(value.role);
    const list = (role, items) => `<h4>${role === "admin" ? "Admins" : "Check-in staff"}</h4>${items.length ? `<ul>${items.map(item => `<li><span class="mono">${escape(item)}</span>${value.role === "owner" || value.role === "admin" && role === "staff" ? ` <button type="button" class="button button-secondary button-small" data-manage-access-revoke="${role}" data-manage-target="${item}">Revoke ${role}</button>` : ""}</li>`).join("")}</ul>` : "<p>None assigned.</p>"}`;
    host.innerHTML = `<p>Current contract owner: <span class="mono">${escape(value.owner)}</span></p>
      ${value.pendingOwner !== "0x" + "0".repeat(40) ? `<p>Pending owner: <span class="mono">${escape(value.pendingOwner)}</span></p>` : ""}
      ${value.role !== "participant" ? list("admin", value.admins) + list("staff", value.staff) : "<p>This wallet has no event team access.</p>"}
      ${grants ? `<form data-manage-access-form><label>Wallet address<input name="wallet" required autocomplete="off" spellcheck="false" pattern="0x[a-fA-F0-9]{40}" placeholder="0x…"></label><label>Access<select name="role">${value.role === "owner" ? '<option value="admin">Admin</option>' : ""}<option value="staff">Check-in staff</option></select></label><button type="submit" class="button button-secondary">Grant access</button></form>` : ""}
      ${value.role === "owner" ? `<form data-manage-transfer-form><h4>Transfer event ownership</h4><p>The nominated wallet must accept the transfer in its wallet. Team permissions must be assigned under the new owner.</p><label>New owner wallet<input name="to" required autocomplete="off" spellcheck="false" pattern="0x[a-fA-F0-9]{40}" placeholder="0x…"></label><button type="submit" class="button button-secondary" ${receipt ? "disabled" : ""}>Review ownership transfer</button></form>` : ""}
      ${value.role === "pending-owner" ? `<button type="button" class="button button-primary" data-manage-action="acceptOwnership" ${receipt ? "disabled" : ""}>Review ownership acceptance</button>` : ""}`;
    host.querySelectorAll("button,input,select").forEach(input => { if (busy) input.disabled = true; });
  }
  function acceptAccess(value, captured) {
    if (!current(captured)) fail("The selected wallet or event changed.");
    access = assertFirstEventAccess(value, context, EVENT);
    if (access.role !== "owner") selected.clear();
    draft = reviewed = null;
    update();
  }
  async function loadAccess() {
    if (!accessEnabled || busy) return;
    const captured = revision; busy = true; update(); say("Loading event permissions…");
    try {
      await privateScope(captured, true);
      const value = await api(`/api/events/${encodeURIComponent(EVENT.id)}/access`, { signal: abort.signal });
      acceptAccess(value, captured); say("Event permissions loaded.");
    } catch (error) { if (current(captured)) { access = null; say(error.message); } }
    finally { busy = false; update(); }
  }
  async function changeAccess(role, target, enabled) {
    const prior = currentAccess();
    if (busy || !prior || !address(target) || !["admin", "staff"].includes(role) ||
        !(prior.role === "owner" || prior.role === "admin" && role === "staff")) return;
    const captured = revision; busy = true; update(); say("Updating event access…");
    try {
      await privateScope(captured, true);
      const value = await api(`/api/events/${encodeURIComponent(EVENT.id)}/access`, { method: "PATCH",
        body: JSON.stringify({ role, wallet: target, enabled, revision: prior.revision }), signal: abort.signal });
      acceptAccess(value, captured); say(enabled ? "Event access granted." : "Event access revoked.");
    } catch (error) { if (current(captured)) { access = null; say(error.message + " Load event permissions before trying again."); } }
    finally { busy = false; update(); }
  }
  async function recordCheckin(target) {
    const prior = currentAccess(), snapshot = getSnapshot(), state = snapshot?.eventState;
    if (busy || !prior || !["owner", "admin", "staff"].includes(prior.role) || !address(target) ||
        !snapshot?.depositors?.some(item => same(item.wallet, target)) ||
        !state?.stakers?.some(item => same(item.wallet, target) && item.status === 1) ||
        prior.checkins.some(item => same(item.wallet, target))) return;
    const note = "Verified this registered wallet was present at the event.";
    const captured = revision; busy = true; update(); say("Recording door check-in…");
    const key = [location.origin, prior.instanceId, EVENT.id, EVENT.contract.toLowerCase(), wallet.toLowerCase(), target.toLowerCase()].join(":");
    try {
      const nonce = checkinNonces.get(key) ?? crypto.randomUUID(); checkinNonces.set(key, nonce);
      await privateScope(captured, true);
      const value = await api(`/api/events/${encodeURIComponent(EVENT.id)}/staff-checkins`, { method: "POST",
        body: JSON.stringify({ wallet: target, nonce, note }), signal: abort.signal });
      acceptAccess(value, captured); checkinNonces.delete(key); say("Door check-in recorded. The owner still reviews the final attendance list.");
    } catch (error) { if (current(captured)) { access = null; say(error.message + " Load event permissions to check the saved result."); } }
    finally { busy = false; update(); }
  }
  function update() {
    if (!current()) return;
    const snapshot = getSnapshot(), state = snapshot?.eventState, permissions = currentAccess(), isOwner = permissions?.role === "owner";
    renderAccess();
    const owner = root.closest("[data-first-event-display]") ?? root;
    owner.querySelectorAll("[data-manage-attended]").forEach(input => {
      const registered = state?.stakers?.some(item => same(item.wallet, input.value) && item.status === 1);
      if (!registered) selected.delete(input.value);
      input.disabled = !isOwner || !registered || busy || Boolean(receipt);
      input.checked = selected.has(input.value);
      const label = input.closest("[data-manage-final-label]"), hint = input.parentElement?.parentElement?.querySelector("[data-manage-final-hint]");
      if (label) label.hidden = !isOwner;
      if (hint) hint.hidden = isOwner;
    });
    owner.querySelectorAll("[data-manage-register]").forEach(button => {
      button.hidden = !isOwner; button.disabled = !isOwner || busy || Boolean(receipt);
      const hint = button.parentElement.querySelector("[data-manage-owner-register-hint]"); if (hint) hint.hidden = isOwner;
    });
    owner.querySelectorAll("[data-manage-withdraw]").forEach(button => { button.disabled = !wallet || busy || Boolean(receipt); });
    owner.querySelectorAll("[data-manage-staff-checkin]").forEach(button => {
      const checked = permissions?.checkins.find(item => same(item.wallet, button.dataset.manageStaffCheckin));
      const registered = state?.stakers?.some(item => same(item.wallet, button.dataset.manageStaffCheckin) && item.status === 1);
      button.hidden = !permissions || !["owner", "admin", "staff"].includes(permissions.role) || !registered || Boolean(checked);
      button.disabled = busy || !registered || Boolean(checked);
      const label = button.parentElement.querySelector("[data-manage-checkin-state]");
      if (label) label.textContent = checked ? `Recorded ${new Date(checked.recordedAt).toLocaleString()} by ${checked.actorWallet}` : permissions ? "No door check-in recorded. " : "Load permissions to view check-ins. ";
    });
    const post = root.querySelector("[data-manage-post]");
    if (post) { post.closest("form").hidden = !isOwner; post.disabled = !isOwner || busy || Boolean(receipt) || !state || ![0, "Open"].includes(state.phase) || !Number.isSafeInteger(state.endsAt) || Date.now() < state.endsAt * 1000 || selected.size === 0; }
    const stateLabel = root.querySelector("[data-manage-state]");
    stateLabel.textContent = state ? `Saved contract phase: ${state.phase}. ${state.endsAt ? "Event ends " + new Date(state.endsAt * 1000).toLocaleString() + ". " : ""}Every action checks current contract state.` : "Current attendance state is not indexed yet. Registration can be reviewed now; refresh the list for attendance controls. Current role and contract rules are checked on every action.";
    if (!wallet) { participant.replaceChildren(); return; }
    const own = state?.stakers?.find(item => same(item.wallet, wallet));
    participant.innerHTML = `<h3>Your wallet</h3><p class="mono">${escape(wallet)}</p>${own ? `<p>Saved status: ${own.status}${own.attended ? " · included in attendance" : " · not included in attendance"}</p>` : "<p>No registered staker status in the saved snapshot.</p>"}
      ${state?.challengeEndsAt ? `<p>Saved omission challenge deadline: ${escape(new Date(state.challengeEndsAt * 1000).toLocaleString())}.</p>` : ""}
      <button type="button" class="button button-secondary" data-manage-action="challenge">Review incorrect absence</button>
      ${(state?.stakers ?? []).filter(item => item.challenge && ![0, "None"].includes(item.challenge.state)).map(item => `<div><p class="mono">Challenge: ${escape(item.wallet)}</p>${item.challenge.matchDeadline ? `<p>Saved matching deadline: ${escape(new Date(item.challenge.matchDeadline * 1000).toLocaleString())}.</p>` : ""}<button type="button" class="button button-secondary button-small" data-manage-action="match" data-manage-target="${item.wallet}">Review contest / Kleros case</button> <button type="button" class="button button-secondary button-small" data-manage-action="resolve" data-manage-target="${item.wallet}">Review resolution</button></div>`).join("")}`;
    participant.querySelectorAll("button").forEach(button => { button.disabled = busy || Boolean(receipt); });
  }
  const changed = () => {
    revision++; authenticated = false; policy = context = draft = reviewed = access = null; selected.clear(); wallet = null;
    if (dialog.open) dialog.close(); dialog.replaceChildren(); connectButton.hidden = false; label.textContent = "";
    paintPending(null); onWallet(null); update();
  };
  async function connect() {
    const captured = ++revision; connectButton.disabled = true;
    try {
      const selectedProvider = await chooseWalletProvider({ ownerDocument: root.ownerDocument, signal: abort.signal, isCurrent: () => current(captured) });
      if (!selectedProvider) return;
      const accounts = await selectedProvider.request({ method: "eth_requestAccounts" });
      if (!current(captured)) return;
      if (!address(accounts?.[0])) fail("Choose a wallet account.");
      provider?.removeListener?.("accountsChanged", changed); provider?.removeListener?.("chainChanged", changed);
      provider = selectedProvider; wallet = accounts[0]; authenticated = false; policy = context = access = null;
      provider.on?.("accountsChanged", changed); provider.on?.("chainChanged", changed);
      connectButton.hidden = true; label.textContent = `Connected · ${wallet}`; onWallet(wallet); update();
      // Local journal reads do not initialize a wallet policy or call an API.
      const { journal } = await services(); if (current(captured)) paintPending(pendingFromStorage(journal));
    } catch (error) { say(error.message); }
    finally { if (current()) connectButton.disabled = false; }
  }
  async function privateScope(captured, allowPending = false) {
    if (!wallet || !provider) fail("Connect your wallet first. Signing in happens only when you review an action.");
    const s = await services();
    policy = await s.eventWalletContext({ api, signal: abort.signal, isCurrent: () => current(captured), instanceId: getSnapshot()?.instanceId ?? null });
    if (!current(captured)) fail("The selected wallet or event changed.");
    context = Object.freeze({ eventId: EVENT.id, wallet, chainId: 1, contract: EVENT.contract, abiVersion: EVENT.abiVersion, mode: EVENT.mode, instanceId: policy.instanceId });
    const pending = pendingFromStorage(s.journal); paintPending(pending);
    if (pending && !allowPending) fail("Check the original wallet request or transaction before preparing another action.");
    if (!authenticated) {
      const metadata = await api("/api/kickback-setup", { signal: abort.signal });
      if (metadata?.kind !== "kickback-setup-display" || metadata.mode !== EVENT.mode || metadata.instanceId !== context.instanceId) fail("The sign-in server changed. Refresh the saved list.");
      authenticated = metadata.session?.mode === "wallet" && same(metadata.session.wallet, wallet);
    }
    if (!authenticated) {
      say("Sign in to review this action. The signature does not send a transaction.");
      const challenge = await api("/api/auth/challenge", { method: "POST", body: JSON.stringify({ wallet }), signal: abort.signal });
      if (typeof challenge?.message !== "string" || !challenge.message.length || typeof challenge.nonce !== "string") fail("The sign-in challenge is unavailable.");
      await s.assertV10WalletAccount({ provider, wallet, bootstrap: policy });
      if (!current(captured)) fail("The selected wallet changed before sign-in.");
      const message = "0x" + [...new TextEncoder().encode(challenge.message)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const signature = await provider.request({ method: "personal_sign", params: [message, wallet] });
      if (!current(captured)) fail("The selected wallet changed during sign-in.");
      const verified = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ nonce: challenge.nonce, signature }), signal: abort.signal });
      if (!same(verified?.wallet, wallet)) fail("The sign-in response belongs to another wallet.");
      authenticated = true;
    }
    if (!current(captured)) fail("The selected wallet or event changed.");
    return s;
  }
  const job = (s, operation, payload, captured, original = context, signal = abort.signal) => s.eventReadJob({ api, operation, payload: { eventId: EVENT.id, ...payload },
    expectedContext: EVENT, instanceId: original.instanceId, wallet: original.wallet, signal,
    isCurrent: () => current(captured) && same(wallet, original.wallet), onPending: () => say("Checking current permissions and contract state…") });
  function openReview(value, action, params, captured) {
    draft = value; reviewed = { action, params: structuredClone(params), captured, context, policy };
    dialog.innerHTML = `<h2>${escape(names[action])}</h2><p>${escape(value.summary)}</p><dl class="details-list"><div><dt>Event contract</dt><dd class="mono">${EVENT.contract}</dd></div><div><dt>Signing wallet</dt><dd class="mono">${escape(wallet)}</dd></div><div><dt>ETH sent</dt><dd>${eth(value.valueWei)} ETH</dd></div>${action === "transferOwnership" ? `<div><dt>New event owner</dt><dd class="mono">${escape(value.args[0])}</dd></div>` : action === "acceptOwnership" ? `<div><dt>New event owner</dt><dd class="mono">${escape(wallet)}</dd></div>` : ""}${action === "withdrawPending" ? `<div><dt>Unused deposit returned</dt><dd>${eth(value.args[1])} ETH</dd></div><div><dt>Return to your wallet</dt><dd class="mono">${escape(value.args[0])}</dd></div>` : ""}</dl>
      ${action === "postAttendance" || action === "register" ? `<p>Exact reviewed wallets:</p><ul>${value.args[0].map(item => `<li class="mono">${escape(item)}</li>`).join("")}</ul>` : ""}
      <p>${action === "match" ? "This separate payment opens a real Kleros case on Ethereum Mainnet." : "Confirm this exact contract action in your wallet."}</p><div class="button-row"><button type="button" class="button button-primary" data-manage-confirm>Confirm in wallet</button><button type="button" class="button button-secondary" data-manage-close>Close</button></div>`;
    dialog.showModal();
  }
  async function prepare(action, params, adoption = null) {
    if (busy) return;
    if (["register", "postAttendance", "transferOwnership"].includes(action) && currentAccess()?.role !== "owner" ||
        action === "acceptOwnership" && currentAccess()?.role !== "pending-owner") { say("Load event permissions for the wallet authorized to review this action."); return; }
    const captured = revision; busy = true; update(); say("Checking current permissions and contract state…");
    try {
      const s = await privateScope(captured);
      if (adoption) {
        const result = await job(s, "adopt-payer", adoption, captured);
        if (!current(captured) || result?.kind !== "owner-reviewed-payer" || result.eventId !== EVENT.id || result.chainId !== 1 ||
            !same(result.contract, EVENT.contract) || !same(result.wallet, adoption.wallet) || !stable(result.participantId)) fail("The canonical payer review changed.");
        await api(`/api/events/${encodeURIComponent(EVENT.id)}/participants/${encodeURIComponent(result.participantId)}`, { method: "PATCH", body: JSON.stringify({ admission: "approved" }), signal: abort.signal });
      }
      const value = await job(s, ["register", "postAttendance", "transferOwnership", "acceptOwnership"].includes(action) ? "manage-draft" : "participant-draft", { action, params }, captured);
      if (!current(captured)) return;
      assertFirstEventManageDraft(value, context, action, params, location.origin, EVENT); openReview(value, action, params, captured); say("Review the exact transaction before confirming in your wallet.");
    } catch (error) { say(error.message); }
    finally { busy = false; update(); }
  }
  async function execute() {
    if (busy || !draft || !reviewed) return;
    const value = draft, review = reviewed, original = review.context, captured = review.captured;
    busy = true; update(); dialog.querySelectorAll("button").forEach(button => { button.disabled = true; });
    let requested = false, submitted = false, ownIntent = null;
    const key = intentPrefix + [location.origin, original.instanceId, original.wallet.toLowerCase(), original.eventId, original.contract.toLowerCase()].map(encodeURIComponent).join(":");
    const releaseIntent = () => { if (ownIntent && localStorage.getItem(key) === ownIntent) localStorage.removeItem(key); };
    try {
      const s = await services(); assertFirstEventManageDraft(value, original, review.action, review.params, location.origin, EVENT);
      if (pendingFromStorage(s.journal)) fail("Reconcile the original wallet request before another send.");
      const guarded = { request: async request => {
        if (request.method === "eth_sendTransaction") {
          await s.assertV10WalletAccount({ provider, wallet: original.wallet, bootstrap: review.policy });
          if (!current(captured) || !same(wallet, original.wallet)) fail("The signing wallet changed.");
          assertFirstEventManageDraft(value, original, review.action, review.params, location.origin, EVENT);
          if (localStorage.getItem(key) !== null) fail("An earlier wallet request is unresolved. Check its original wallet activity.");
          const held = JSON.stringify({ phase: "awaiting-wallet", origin: location.origin, context: original, draftId: value.id });
          localStorage.setItem(key, held); ownIntent = held; if (localStorage.getItem(key) !== held) fail("Durable wallet request storage is unavailable.");
          requested = true; say("Confirm the reviewed transaction in your wallet. Do not submit it twice.");
        }
        return provider.request(request);
      } };
      const result = await s.submitWalletDraft({ draft: value, context: original, provider: guarded, journal: s.journal,
        isCurrentContext: () => current(captured) && same(wallet, original.wallet) && context === original,
        validate: async () => (await job(s, "validate", { draftId: value.id }, captured, original)).transaction,
        recordSubmitted: (_eventId, _draftId, txHash) => { submitted = true; releaseIntent(); if (current(captured)) { paintPending({ hash: txHash, draftId: value.id, context: original, status: "submitted" }); say(`Transaction submitted: ${txHash}. Checking its original receipt…`); } },
        confirm: (_eventId, _draftId, txHash) => s.waitForTransactionReceipt({ context: original, hash: txHash, draftId: value.id, signal: abort.signal,
          record: signal => api(`/api/events/${encodeURIComponent(EVENT.id)}/drafts/${encodeURIComponent(value.id)}/submitted`, { method: "POST", body: JSON.stringify({ hash: txHash }), signal }).catch(error => {
            if (["DRAFT_SCOPE", "STALE_DRAFT"].includes(error.code)) return job(s, "confirm", { draftId: value.id, hash: txHash }, captured, original, signal);
            throw error;
          }),
          check: signal => job(s, "confirm", { draftId: value.id, hash: txHash }, captured, original, signal) }) });
      if (current(captured)) { say(`Confirmed transaction: ${result.hash}`); paintPending(null); draft = reviewed = null; if (["transferOwnership", "acceptOwnership"].includes(review.action)) { access = null; selected.clear(); } dialog.close(); await onRefresh(); }
    } catch (error) {
      if (error.submittedHash) { submitted = true; releaseIntent(); if (current(captured)) paintPending({ hash: error.submittedHash, draftId: value.id, context: original, status: "submitted" }); }
      if (!requested || (!submitted && error.code === 4001)) releaseIntent();
      if (current(captured)) say(error.message + (requested && !submitted && error.code !== 4001 ? " Check the original wallet activity; no automatic resend is allowed." : ""));
      draft = reviewed = null; if (dialog.open) dialog.close();
    } finally {
      if (current(captured)) {
        try { const { journal } = await services(); paintPending(pendingFromStorage(journal)); }
        catch { paintPending({ status: "awaiting-wallet" }); say("Preserve the original transaction storage and check wallet activity before another action."); }
      }
      busy = false; update();
    }
  }
  async function checkOriginal() {
    if (busy || !receipt?.hash || receipt.action === "deposit") return; const original = receipt, captured = revision; busy = true; update();
    try {
      const s = await privateScope(captured, true);
      // No prepare or wallet send occurs here. Keep the captured original scope.
      const result = await job(s, "confirm", { draftId: original.draftId, hash: original.hash }, captured, original.context);
      if (result?.status !== "confirmed" || !same(result.hash, original.hash) || result.eventId !== EVENT.id || !same(result.wallet, original.context.wallet) || !Number.isSafeInteger(result.blockNumber) || result.blockNumber <= 0)
        fail("The original transaction does not yet have a verified confirmation.");
      s.journal.update(original.context, original.hash, { status: "confirmed", blockNumber: result.blockNumber, error: null });
      if (current(captured)) { say(`Confirmed original transaction: ${original.hash}`); paintPending(null); await onRefresh(); }
    } catch (error) { say(error.message); }
    finally { busy = false; update(); }
  }
  function payerReview(target) {
    if (busy || currentAccess()?.role !== "owner") return;
    const row = getSnapshot()?.depositors?.find(item => same(item.wallet, target));
    if (!row?.deposits?.length) { say("Refresh the canonical receipt list first."); return; }
    const txHash = row.deposits[0].txHash;
    dialog.innerHTML = `<h2>Approve & register this payer</h2><p class="mono">${escape(target)}</p><p class="mono">Canonical receipt: ${escape(txHash)}</p><p>This is a payer wallet record. No Luma name or email is verified.</p><form data-manage-payer-form><label>Review note<textarea name="note" minlength="8" maxlength="1000" required>Reviewed the canonical payer receipt for event admission.</textarea></label><label><input type="checkbox" name="confirmed" required> I approve this exact payer for admission and contract registration.</label><div class="button-row"><button class="button button-primary" type="submit">Review registration</button><button class="button button-secondary" type="button" data-manage-close>Close</button></div></form>`;
    dialog.querySelector("form").addEventListener("submit", event => {
      event.preventDefault(); const fields = new FormData(event.target), note = String(fields.get("note") ?? "").trim();
      if (fields.get("confirmed") !== "on" || note.length < 8 || note.length > 1000) return;
      dialog.close(); void prepare("register", { wallets: [target] }, { wallet: target, txHash, confirmed: true, note });
    }); dialog.showModal();
  }
  const click = event => {
    const target = event.target.closest?.("button"); if (!target || !current()) return;
    if (target.matches("[data-manage-connect]")) void connect();
    else if (target.matches("[data-manage-access-load]")) void loadAccess();
    else if (target.matches("[data-manage-access-revoke]")) void changeAccess(target.dataset.manageAccessRevoke, target.dataset.manageTarget, false);
    else if (target.matches("[data-manage-staff-checkin]")) void recordCheckin(target.dataset.manageStaffCheckin);
    else if (target.matches("[data-manage-register]")) payerReview(target.dataset.manageRegister);
    else if (target.matches("[data-manage-action]")) void prepare(target.dataset.manageAction, target.dataset.manageTarget ? { wallet: target.dataset.manageTarget } : {});
    else if (target.matches("[data-manage-check-original]")) void checkOriginal();
    else if (target.matches("[data-manage-copy-hash]") && hash(receipt?.hash)) {
      const original = receipt.hash;
      void Promise.resolve().then(() => navigator.clipboard.writeText(original)).then(() => { if (current() && receipt?.hash === original) target.textContent = "Transaction ID copied"; }).catch(() => {
        const input = root.querySelector('[aria-label="Original transaction ID"]'); if (input && current() && receipt?.hash === original) { input.hidden = false; input.focus(); input.select(); }
      });
    }
  };
  const selection = event => {
    const input = event.target.closest?.("[data-manage-attended]"); if (!input || busy || currentAccess()?.role !== "owner" || !address(input.value)) return;
    input.checked ? selected.add(input.value) : selected.delete(input.value); draft = reviewed = null; update();
  };
  const attendance = event => {
    event.preventDefault(); if (busy || currentAccess()?.role !== "owner") return;
    const data = new FormData(event.target), note = String(data.get("note") ?? "").trim();
    if (data.get("confirmed") !== "on" || note.length < 8 || note.length > 1000 || !selected.size) { say("Select registered attendees and explicitly confirm the attendance review."); return; }
    void prepare("postAttendance", { attendedWallets: [...selected], attendanceReview: { confirmed: true, note } });
  };
  const dialogClick = event => { if (event.target.closest?.("[data-manage-confirm]")) void execute(); else if (!busy && event.target.closest?.("[data-manage-close]")) { draft = reviewed = null; dialog.close(); } };
  const dialogCancel = event => { if (busy) event.preventDefault(); else draft = reviewed = null; };
  // Delegation includes the surrounding saved-receipt table without moving it.
  const owner = root.closest("[data-first-event-display]") ?? root;
  owner.addEventListener("click", click); owner.addEventListener("change", selection);
  const formSubmit = event => {
    if (event.target.matches("[data-manage-attendance]")) return attendance(event);
    if (!event.target.matches("[data-manage-access-form],[data-manage-transfer-form]")) return;
    event.preventDefault();
    const fields = new FormData(event.target);
    if (event.target.matches("[data-manage-access-form]")) void changeAccess(String(fields.get("role")), String(fields.get("wallet") ?? "").trim(), true);
    else if (address(String(fields.get("to") ?? "").trim())) void prepare("transferOwnership", { to: String(fields.get("to")).trim() });
  };
  root.addEventListener("submit", formSubmit);
  dialog.addEventListener("click", dialogClick); dialog.addEventListener("cancel", dialogCancel);
  update();
  return Object.freeze({ update, dispose() {
    disposed = true; revision++; abort.abort(); owner.removeEventListener("click", click); owner.removeEventListener("change", selection);
    provider?.removeListener?.("accountsChanged", changed); provider?.removeListener?.("chainChanged", changed);
    root.removeEventListener("submit", formSubmit); dialog.removeEventListener("click", dialogClick); dialog.removeEventListener("cancel", dialogCancel); dialog.remove();
  } });
}
