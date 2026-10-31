import { EVENT } from "./event.js";
import { assertDirectDepositDraft } from "./direct-deposit.js";
import { recordedDepositReference, savedDepositReference } from "./receipts.js";
import { chooseWalletProvider } from "../wallet-connection.js";
import { eventReadJob } from "../event-read.js";
import { createPublicTransactionFlow, resetUnusedPublicTransactionFlow } from "../public-transactions.js";
import { selectedEventResult } from "./deps/selected-event.js";
import { productionContextIssue } from "./deps/environment.js";
import { assertV10WalletAccount } from "./deps/v10-wallet-account.js";
import {
  createTransactionJournal,
  submitWalletDraft,
  waitForTransactionReceipt,
} from "./deps/transaction-context.js";
import {
  knownAttendanceStandard,
  attendanceStandardText,
  participantDeposit,
  lumaReturnUrl,
} from "./deps/luma-launch.js";

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const fail = (message) => { throw new Error(message); };
const exact = (value, expected) => value === expected || fail("The event identity or network does not match this page.");
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eth = (value) => {
  const amount = BigInt(value), fraction = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${amount / 10n ** 18n}${fraction ? `.${fraction}` : ""}`;
};

// Public identity pins never replace current server authority, implementation or wallet checks.
export function assertEventBundle(bootstrap, wallet = null) {
  exact(bootstrap?.mode, EVENT.mode);
  exact(bootstrap?.contractVersion, EVENT.abiVersion);
  exact(bootstrap?.chain?.chainId, EVENT.chainId);
  const selected = selectedEventResult(bootstrap, {
    eventId: EVENT.id,
    capturedWallet: wallet,
    hasCapturedSession: wallet !== null,
  });
  if (selected?.error) fail(selected.error.message);
  const detail = selected?.detail;
  if (!detail) fail("The current event could not be verified. Check again before sending any ETH.");
  const event = detail.event;
  exact(event.id, EVENT.id);
  exact(event.chainId, EVENT.chainId);
  exact(event.abiVersion, EVENT.abiVersion);
  exact(event.contractVersion, EVENT.abiVersion);
  if (!same(event.contract, EVENT.contract)) fail("The contract does not match this event.");
  exact(event.depositWei, EVENT.depositWei);
  exact(detail.state?.depositWei, EVENT.depositWei);
  exact(lumaReturnUrl(event.lumaUrl), EVENT.lumaUrl);
  if (!knownAttendanceStandard(event.attendanceStandard)) fail("The verified attendance terms are unavailable.");
  const issue = productionContextIssue(bootstrap, detail, { requireTransactions: true, requireWallet: wallet !== null });
  if (issue) fail(issue);
  if (bootstrap.capabilities?.eventReadJobs !== true || bootstrap.capabilities?.lumaDepositPortal !== true ||
      bootstrap.capabilities?.walletFirstDeposits !== true)
    fail("The protected event deposit service is unavailable. No transaction has been requested.");
  if (wallet && !same(bootstrap.session?.wallet, wallet)) fail("The authenticated wallet changed. Reconnect before continuing.");
  return detail;
}

function actionFor(detail, wallet) {
  if (!same(detail?.ownWallet?.wallet, wallet)) fail("The wallet's current event status is unavailable.");
  const action = detail.ownWallet.depositAction;
  if (!action || typeof action.eligible !== "boolean" || typeof action.amountWei !== "string" || !/^\d+$/.test(action.amountWei))
    fail("The current deposit eligibility could not be verified.");
  if (action.eligible && (BigInt(action.amountWei) <= 0n || BigInt(action.amountWei) > BigInt(EVENT.depositWei)))
    fail("The current deposit amount is invalid.");
  return action;
}

export function assertDepositDraft(draft, bootstrap, detail, wallet, origin = location.origin) {
  assertEventBundle(bootstrap, wallet);
  if (detail?.kind === "deposit-review-v1" &&
      (bootstrap.kind !== "deposit-review-v1" || bootstrap.origin !== origin ||
        draft?.reviewBlock !== detail.state.blockNumber ||
        typeof detail.state.blockHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(detail.state.blockHash)))
    fail("The deposit review anchor or origin changed. Prepare a fresh review.");
  const action = actionFor(detail, wallet);
  if (!action.eligible) fail(action.reason || "This wallet is not eligible for another deposit.");
  if (draft?.action !== "deposit" || draft.method !== "deposit" || !Array.isArray(draft.args) || draft.args.length ||
      draft.eventId !== EVENT.id || draft.chainId !== EVENT.chainId || !same(draft.wallet, wallet) ||
      !same(draft.contract, EVENT.contract) || draft.abiVersion !== EVENT.abiVersion ||
      draft.contractVersion !== EVENT.abiVersion || draft.mode !== EVENT.mode || draft.instanceId !== bootstrap.instanceId ||
      draft.origin !== origin || draft.valueWei !== action.amountWei || draft.snapshot !== detail.state.fingerprint ||
      typeof draft.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(draft.id) ||
      !Number.isSafeInteger(draft.expiresAt) || Date.now() >= draft.expiresAt)
    fail("The deposit review expired or differs from this event and wallet. Prepare a fresh review.");
  const tx = draft.transaction;
  if (!same(tx?.to, EVENT.contract) || !same(tx?.from, wallet) || Number(tx?.chainId) !== EVENT.chainId ||
      tx?.data?.toLowerCase() !== "0xd0e30db0" || String(tx?.value) !== draft.valueWei)
    fail("The transaction differs from the exact reviewed deposit.");
  return draft;
}

const $ = (selector) => document.querySelector(selector);
const connectButton = $("[data-connect-wallet]"), depositButton = $("[data-deposit]");
const walletStatus = $("[data-wallet-status]"), transactionStatus = $("[data-tx-status]");
let epoch = 0, busy = false, bootstrap = null, detail = null, wallet = null, draft = null;
// Wallet selection is local. A server scope is bound only on an explicit action.
let connection = null;
let transactionFlow = null;
let provider = null, journal = null, readController = new AbortController(), listeningProvider = null;
let confirmedHash = null;
let paymentReference = null, receiptSnapshot = null;
const checkButton = document.createElement("button");
checkButton.type = "button";
checkButton.className = "button button-secondary";
checkButton.textContent = "Check original deposit";
checkButton.hidden = true;
transactionStatus?.after(checkButton);

const dialog = document.createElement("dialog");
dialog.className = "wallet-review";
dialog.setAttribute("aria-labelledby", "wallet-review-title");
document.body.append(dialog);
dialog.addEventListener("cancel", event => {
  if (busy) {
    event.preventDefault();
    status("Finish the open wallet request or wait for this original transaction check. Do not send a second deposit.");
  }
});
// Closing the review invalidates an unsigned intent. Already returned hashes stay journaled.
dialog.addEventListener("close", () => {
  draft = null;
  try { resetUnsignedFlow(); }
  catch (error) { txStatus(error.message); depositButton.hidden = true; }
});

const status = (text) => { if (walletStatus) walletStatus.textContent = text; };
const txStatus = (text, hash = null) => {
  if (!transactionStatus) return;
  transactionStatus.replaceChildren(document.createTextNode(text));
  if (typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash)) {
    const link = document.createElement("a");
    link.href = `https://etherscan.io/tx/${hash}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = ` View transaction ${hash}`;
    transactionStatus.append(link);
    const copy = document.createElement("button"), fallback = document.createElement("input"), copyStatus = document.createElement("span");
    copy.type = "button";
    copy.className = "button button-secondary";
    copy.dataset.copyTx = "";
    copy.textContent = "Copy transaction ID";
    fallback.type = "text";
    fallback.readOnly = true;
    fallback.value = hash;
    fallback.hidden = true;
    fallback.setAttribute("aria-label", "Transaction ID to copy");
    copyStatus.setAttribute("role", "status");
    copyStatus.setAttribute("aria-live", "polite");
    copy.addEventListener("click", async () => {
      copy.disabled = true;
      const stillCurrent = () => copy.isConnected && copy.parentElement === transactionStatus;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(hash);
        if (stillCurrent()) { copy.textContent = "Transaction ID copied"; copyStatus.textContent = " Paste this transaction ID into Luma."; }
      } catch {
        if (stillCurrent()) {
          fallback.hidden = false;
          fallback.focus();
          fallback.select();
          copyStatus.textContent = " Copy the selected transaction ID, then paste it into Luma.";
        }
      } finally { if (stillCurrent()) copy.disabled = false; }
    });
    transactionStatus.append(copy, fallback, copyStatus);
  }
};
function scope() {
  if (!wallet || !connection || connection.epoch !== epoch || !same(connection.wallet, wallet) ||
      !connection.instanceId || connection.mode !== EVENT.mode || !transactionFlow)
    fail("Connect your wallet and prepare this deposit first.");
  return Object.freeze({ eventId: EVENT.id, wallet, chainId: EVENT.chainId, contract: EVENT.contract,
    abiVersion: EVENT.abiVersion, mode: connection.mode, instanceId: connection.instanceId });
}
function current(capturedEpoch, captured = null) {
  return capturedEpoch === epoch && (!connection || connection.epoch === capturedEpoch) &&
    (!captured || (connection && same(wallet, captured.wallet) && same(connection.wallet, captured.wallet) &&
      connection.instanceId === captured.instanceId && connection.mode === captured.mode &&
      captured.eventId === EVENT.id && captured.chainId === EVENT.chainId &&
      same(captured.contract, EVENT.contract) && captured.abiVersion === EVENT.abiVersion));
}
const intentKey = (captured) => "kleros-first-event-intent:v1:" +
  [location.origin, captured.instanceId, captured.mode, captured.eventId, captured.chainId,
    captured.contract.toLowerCase(), captured.wallet.toLowerCase(), captured.abiVersion].map(encodeURIComponent).join(":");
function heldIntent(captured) {
  const raw = localStorage.getItem(intentKey(captured));
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { fail("The wallet request record is unreadable. Preserve storage and check your wallet activity."); }
  if (value?.phase !== "awaiting-wallet" || typeof value.draftId !== "string")
    fail("The wallet request record is invalid. Preserve storage and check your wallet activity.");
  return value;
}
function holdIntent(captured, id) {
  const key = intentKey(captured), raw = JSON.stringify({ phase: "awaiting-wallet", draftId: id });
  localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw) fail("Durable wallet request storage is unavailable. No transaction was requested.");
}
function pending(captured) {
  return journal.list(captured).find(entry => entry.action === "deposit" && !["confirmed", "failed"].includes(entry.status)) ?? null;
}
function resetUnsignedFlow() {
  if (busy || !transactionFlow || !connection?.instanceId || confirmedHash) return;
  const captured = scope();
  if (heldIntent(captured) || pending(captured)) return;
  resetUnusedPublicTransactionFlow({ wallet: captured.wallet, kind: "deposit" });
  transactionFlow = null;
  bootstrap = detail = draft = null;
  connection = Object.freeze({ wallet, provider, epoch });
  paint();
}
function checkEarlierScopes(captured) {
  const count = localStorage.length;
  if (!Number.isSafeInteger(count) || count > 4096)
    fail("Preserve transaction storage and check earlier deposits before continuing.");
  for (let index = 0; index < count; index++) {
    const key = localStorage.key(index);
    const intent = key?.startsWith("kleros-first-event-intent:v1:");
    const prefix = intent ? "kleros-first-event-intent:v1:" : "kleros-transactions:v1:";
    if (!key?.startsWith(prefix)) continue;
    let parts;
    try { parts = key.slice(prefix.length).split(":").map(decodeURIComponent); } catch { continue; }
    if (intent && parts.shift() !== location.origin) continue;
    const [instanceId, mode, eventId, chainId, contract, owner, abiVersion] = parts;
    if (parts.length !== 7 || instanceId === captured.instanceId || mode !== captured.mode ||
        eventId !== captured.eventId || chainId !== String(captured.chainId) ||
        !same(contract, captured.contract) || !same(owner, captured.wallet) || abiVersion !== captured.abiVersion) continue;
    const original = { ...captured, instanceId };
    const entry = intent ? heldIntent(original) : pending(original);
    if (entry) {
      throw Object.assign(new Error("Check the earlier deposit using Manage your deposit in Deposit details. Its original record has been preserved."), { hash: entry.hash });
    }
  }
}
function showPaymentComplete(complete) {
  connectButton.hidden = complete || connection !== null;
  for (const node of document.querySelectorAll(".divider,.manual-deposit,.address-box")) node.hidden = complete;
}
function restorePaymentReference() {
  if (!wallet || !journal) return;
  paymentReference = recordedDepositReference({ storage: localStorage, journal, wallet });
  if (!paymentReference && receiptSnapshot) paymentReference = savedDepositReference(receiptSnapshot, wallet);
  confirmedHash = ["confirmed", "recorded"].includes(paymentReference?.status) ? paymentReference.hash : null;
}
function paint() {
  showPaymentComplete(false);
  depositButton.hidden = true;
  depositButton.disabled = busy;
  connectButton.disabled = busy;
  checkButton.hidden = true;
  checkButton.disabled = busy;
  if (!wallet || !connection || !journal) return;
  if (confirmedHash) {
    showPaymentComplete(true);
    txStatus(paymentReference?.status === "recorded" ? "Deposit transaction recorded. Copy this transaction ID for Luma." : "Deposit confirmed. Copy this transaction ID for Luma.", confirmedHash);
    return;
  }
  if (!connection.instanceId && paymentReference) {
    txStatus(paymentReference.status === "awaiting-wallet" ? "A wallet request may still be open. Check your original wallet activity before continuing." : "Transaction submitted. Keep this original transaction ID while confirmation is checked.", paymentReference.hash);
    checkButton.hidden = paymentReference.status !== "submitted";
    return;
  }
  if (!connection.instanceId) {
    depositButton.textContent = `Deposit ${eth(EVENT.depositWei)} ETH`;
    depositButton.hidden = false;
    return;
  }
  const captured = scope(), entry = pending(captured);
  if (entry) {
    txStatus("Transaction submitted", entry.hash);
    checkButton.hidden = false;
    return;
  }
  if (heldIntent(captured)) {
    txStatus("A wallet request may still be open. Check your wallet activity before continuing; no second deposit will be requested here.");
    return;
  }
  if (!bootstrap || !detail) {
    // This is a preparation button, not an eligibility claim. Its explicit click
    // obtains a fresh event proof before any draft or wallet send.
    depositButton.textContent = `Deposit ${eth(EVENT.depositWei)} ETH`;
    depositButton.hidden = false;
    return;
  }
  if (detail.kind === "deposit-review-v1") {
    const action = actionFor(detail, wallet);
    if (!action.eligible) { txStatus(action.reason || "No new deposit is needed."); return; }
    // A narrow authoritative review has no payment-history projection. Do not
    // infer a receipt or admission result from its fresh deposit eligibility.
    depositButton.textContent = `Review ${eth(action.amountWei)} ETH deposit`;
    depositButton.hidden = false;
    return;
  }
  const receipt = participantDeposit(detail, wallet);
  const action = actionFor(detail, wallet);
  if (receipt.status === "confirmed" && !action.eligible) {
    if (!["CREDIT_AVAILABLE", "ALREADY_REGISTERED"].includes(action.reasonCode)) {
      txStatus(`${action.reason || "No new deposit is available."} A historical receipt does not prove your funds are still committed.`, receipt.hash);
      return;
    }
    confirmedHash = receipt.hash;
    showPaymentComplete(true);
    txStatus("Your deposit transaction is confirmed. Return to Luma to finish registration. Host admission is separate.", receipt.hash);
    return;
  }
  if (receipt.status === "submitted") {
    txStatus("This wallet already has a submitted deposit. Use the existing portal to check its original transaction.", receipt.hash);
    return;
  }
  if (receipt.status === "unavailable") fail("The wallet's deposit receipt status is unavailable. No new payment can be reviewed.");
  if (!action.eligible) { txStatus(action.reason || "No new deposit is needed."); return; }
  depositButton.textContent = `Review ${eth(action.amountWei)} ETH deposit`;
  depositButton.hidden = false;
}

async function api(path, options = {}) {
  const controller = new AbortController(), outer = options.signal ?? readController.signal;
  const abort = () => controller.abort();
  outer?.addEventListener("abort", abort, { once: true });
  if (outer?.aborted) abort();
  const timer = setTimeout(abort, 28000);
  try {
    const response = await fetch(path, { credentials: "same-origin", ...options, signal: controller.signal,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    let data;
    try { data = await response.json(); } catch { fail(`The event service returned HTTP ${response.status}. Keep any original transaction ID.`); }
    if (!response.ok) throw Object.assign(new Error(data.error || `The event service returned HTTP ${response.status}.`), { code: data.code, status: response.status });
    return data;
  } finally { clearTimeout(timer); outer?.removeEventListener("abort", abort); }
}
function invalidate() {
  epoch++;
  readController.abort();
  readController = new AbortController();
  bootstrap = detail = wallet = draft = null;
  connection = null;
  transactionFlow = null;
  confirmedHash = null;
  paymentReference = null;
  showPaymentComplete(false);
  depositButton.hidden = true;
  checkButton.hidden = true;
  if (dialog.open) dialog.close();
  status("Your wallet account or network changed. Reconnect before reviewing a payment.");
  txStatus("Saved transaction hashes remain in this browser. Reconnect the original wallet to check them.");
}
const connectionLost = error => ["UNAUTHENTICATED", "SELECTED_EVENT_SESSION_CHANGED", "EVENT_READ_CONTEXT_CHANGED", "EVENT_READ_JOB_NOT_FOUND", "PUBLIC_FLOW_NOT_FOUND", "PUBLIC_FLOW_SCOPE"].includes(error?.code);
function reconnectAfter(error, hash = null) {
  invalidate();
  status(`${error.message || "The wallet session changed."} Connect the original wallet again to continue.`);
  if (hash) txStatus("Keep this original transaction ID. Reconnecting and checking its receipt will not send it again.", hash);
}
async function connect() {
  if (busy) return;
  busy = true;
  const capturedEpoch = ++epoch;
  readController.abort();
  readController = new AbortController();
  listeningProvider?.removeListener?.("accountsChanged", invalidate);
  listeningProvider?.removeListener?.("chainChanged", invalidate);
  listeningProvider = null;
  bootstrap = detail = wallet = draft = null;
  connection = null;
  transactionFlow = null;
  confirmedHash = null;
  paymentReference = null;
  depositButton.hidden = true;
  checkButton.hidden = true;
  txStatus("");
  try {
    connectButton.disabled = true;
    provider = await chooseWalletProvider({ ownerDocument: document, isCurrent: () => current(capturedEpoch), signal: readController.signal });
    if (!provider) return;
    status("");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!current(capturedEpoch)) fail("The wallet changed. Connect again.");
    const selectedWallet = accounts?.[0];
    if (typeof selectedWallet !== "string" || !/^0x[0-9a-f]{40}$/i.test(selectedWallet) || /^0x0{40}$/i.test(selectedWallet))
      fail("No wallet account was selected.");
    if (listeningProvider !== provider) {
      listeningProvider?.removeListener?.("accountsChanged", invalidate);
      listeningProvider?.removeListener?.("chainChanged", invalidate);
      provider.on?.("accountsChanged", invalidate);
      provider.on?.("chainChanged", invalidate);
      listeningProvider = provider;
    }
    journal = createTransactionJournal(localStorage);
    wallet = selectedWallet;
    connection = Object.freeze({ wallet: selectedWallet, provider, epoch: capturedEpoch });
    restorePaymentReference();
    status(`Connected · ${wallet.slice(0, 6)}…${wallet.slice(-4)}`);
  } catch (error) {
    if (current(capturedEpoch)) { status(error.message || "Wallet connection could not finish."); bootstrap = detail = wallet = draft = null; connection = null; }
  } finally {
    busy = false;
    if (current(capturedEpoch)) { try { paint(); } catch (error) { status(error.message); depositButton.hidden = true; } }
    connectButton.disabled = false;
  }
}

function job(operation, payload, capturedEpoch, captured, signal = readController.signal) {
  if (!transactionFlow || transactionFlow.instanceId !== captured.instanceId || !same(transactionFlow.wallet, captured.wallet))
    fail("The deposit connection changed. Prepare this deposit again.");
  return eventReadJob({ api: transactionFlow.api, operation, payload, signal, expectedContext: EVENT, instanceId: captured.instanceId, wallet: captured.wallet,
    isCurrent: () => current(capturedEpoch, captured) });
}
async function prepare() {
  if (busy) return;
  busy = true;
  const capturedEpoch = epoch;
  const selectedWallet = wallet, selectedProvider = provider;
  const connected = () => current(capturedEpoch) && connection &&
    same(wallet, selectedWallet) && same(connection.wallet, selectedWallet) &&
    provider === selectedProvider && connection.provider === selectedProvider;
  let captured = null;
  let preparationFailed = false;
  try {
    if (!connected()) fail("Connect your wallet first.");
    await savedReceiptsReady;
    if (!connected()) fail("The wallet changed. Connect again.");
    restorePaymentReference();
    if (confirmedHash || paymentReference) { paint(); return; }
    paint();
    txStatus("Preparing deposit…");
    let chain = await selectedProvider.request({ method: "eth_chainId" });
    if (!connected()) fail("The wallet changed. Connect again.");
    if (Number(BigInt(chain)) !== EVENT.chainId) {
      // Ignore only the network switch requested by this explicit payment action.
      selectedProvider.removeListener?.("chainChanged", invalidate);
      try {
        await selectedProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
      } finally {
        if (connected()) selectedProvider.on?.("chainChanged", invalidate);
      }
      if (!connected()) fail("The wallet changed. Connect again.");
      chain = await selectedProvider.request({ method: "eth_chainId" });
      if (!connected()) fail("The wallet changed. Connect again.");
    }
    if (Number(BigInt(chain)) !== EVENT.chainId) fail("Select Ethereum Mainnet before depositing.");
    const flow = transactionFlow ?? await createPublicTransactionFlow({ api, wallet: selectedWallet, kind: "deposit",
      isCurrent: connected, signal: readController.signal });
    if (!connected()) fail("The wallet changed. Connect again.");
    if (typeof flow?.api !== "function" || flow.mode !== EVENT.mode || !same(flow.wallet, selectedWallet) ||
        typeof flow.instanceId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(flow.instanceId))
      fail("The deposit connection belongs to another wallet or server.");
    transactionFlow = flow;
    connection = Object.freeze({ wallet: selectedWallet, provider: selectedProvider,
      instanceId: flow.instanceId, mode: flow.mode, epoch: capturedEpoch });
    captured = scope();
    checkEarlierScopes(captured);
    paint();
    if (pending(captured)) return;
    if (heldIntent(captured)) fail("Check the original wallet request before another payment.");
    let reviewed, prepared = null;
    try {
      reviewed = await transactionFlow.api("/api/direct-deposit/prepare", { method: "POST", body: "{}", signal: readController.signal });
      prepared = { draft: reviewed, receivedAt: performance.now() };
      if (reviewed?.directDepositContext?.verification !== "ready-to-send" || reviewed.params?.preparation !== "ready-to-send")
        fail("The deposit preparation could not be verified. Try again.");
    } catch (error) {
      // An older backend rejects the new suffix before preparing anything.
      // Retain its complete quote/validate path during a frontend rollback.
      if (error.status !== 405 || error.code !== "METHOD_NOT_ALLOWED") throw error;
      reviewed = await transactionFlow.api("/api/direct-deposit", { method: "POST", body: "{}", signal: readController.signal });
    }
    if (!current(capturedEpoch, captured)) fail("The wallet or page changed. Connect again.");
    assertDirectDepositDraft(reviewed, captured);
    draft = reviewed;
    // This response already passed the complete current-state validation.
    // The shared sender still checks the account and durably retains hashes.
    busy = false;
    await execute(prepared);
  } catch (error) {
    preparationFailed = true;
    if (current(capturedEpoch, captured)) {
      if (connectionLost(error)) reconnectAfter(error);
      else txStatus(error.message || "The deposit review could not finish.", error.hash);
    }
  }
  finally { busy = false; connectButton.disabled = false;
    if (preparationFailed && current(capturedEpoch, captured)) {
      try { resetUnsignedFlow(); } catch { /* Preserve any submitted or uncertain request. */ }
    }
    if (current(capturedEpoch, captured)) { try { paint(); } catch (error) { status(error.message); depositButton.hidden = true; } } }
}

function observe(capturedEpoch, captured, id, hash) {
  const scopedApi = transactionFlow?.api;
  if (!scopedApi) fail("Reconnect the original wallet to check this deposit.");
  const reconcile = signal => job("confirm", { eventId: EVENT.id, draftId: id, hash }, capturedEpoch, captured, signal);
  return waitForTransactionReceipt({ context: captured, hash, draftId: id, signal: readController.signal,
    record: (signal, assertBudget) => scopedApi(`/api/events/${EVENT.id}/drafts/${encodeURIComponent(id)}/submitted`,
      { method: "POST", body: JSON.stringify({ hash }), signal }).catch(error => {
        assertBudget();
        if (["DRAFT_SCOPE", "STALE_DRAFT"].includes(error.code)) return reconcile(signal);
        throw error;
      }),
    check: reconcile });
}

async function execute(prepared = null) {
  if (busy || !draft) return;
  busy = true;
  const capturedEpoch = epoch, captured = scope(), reviewed = draft, rawProvider = provider;
  let submittedHash = null, walletRequested = false, rejectedUnsigned = false, retryUnused = false;
  const isCurrent = () => current(capturedEpoch, captured) && draft?.id === reviewed.id && provider === rawProvider;
  const progress = (message) => { if (isCurrent()) { txStatus(message, submittedHash); const node = dialog.querySelector("[data-review-status]"); if (node) node.textContent = message; } };
  try {
    paint();
    const confirmButton = dialog.querySelector("[data-confirm-deposit]");
    if (confirmButton) confirmButton.disabled = true;
    const closeButton = dialog.querySelector("[data-close-review]");
    if (closeButton) closeButton.disabled = true;
    checkEarlierScopes(captured);
    if (pending(captured) || heldIntent(captured)) fail("An earlier deposit request is unresolved. Check it before another payment.");
    assertDirectDepositDraft(reviewed, captured);
    progress("Preparing deposit…");
    const guardedProvider = { request: async request => {
      if (request.method === "eth_sendTransaction") {
        assertDirectDepositDraft(reviewed, captured);
        const checkedFlow = transactionFlow;
        await assertV10WalletAccount({ provider: rawProvider, wallet: captured.wallet, bootstrap: checkedFlow.walletContext });
        if (!isCurrent() || transactionFlow !== checkedFlow) fail("The wallet or event changed. Try again.");
        assertDirectDepositDraft(reviewed, captured);
        holdIntent(captured, reviewed.id);
        walletRequested = true;
        progress("Confirm in wallet");
      }
      return rawProvider.request(request);
    } };
    const result = await submitWalletDraft({ draft: reviewed, context: captured, provider: guardedProvider, journal,
      isCurrentContext: isCurrent,
      validate: async (_eventId, id) => {
        const age = performance.now() - prepared?.receivedAt;
        const serverAge = Date.now() - reviewed.createdAt;
        // createdAt is sealed only after preflight completes. Bound it as well
        // as local continuation time so a suspended/delayed response cannot be
        // reused as fresh authority. Clock skew takes the full-validation path.
        if (prepared?.draft === reviewed && reviewed.id === id && Number.isFinite(age) && age >= 0 && age <= 1000 &&
            Number.isSafeInteger(reviewed.createdAt) && serverAge >= 0 && serverAge <= 3000 && isCurrent()) {
          assertDirectDepositDraft(reviewed, captured);
          if (reviewed.directDepositContext.verification !== "ready-to-send" || reviewed.params?.preparation !== "ready-to-send")
            fail("The deposit preparation changed. Try again.");
          return reviewed.transaction;
        }
        // A delayed/resumed continuation must obtain a new complete preflight.
        return (await transactionFlow.api("/api/direct-deposit/validate", { method: "POST", body: JSON.stringify({ draftId: id }), signal: readController.signal })).transaction;
      },
      recordSubmitted: (_eventId, _id, hash) => {
        submittedHash = hash;
        // The unchanged sender has already durably recorded this hash before this callback.
        localStorage.removeItem(intentKey(captured));
        if (isCurrent()) progress("Transaction submitted");
      },
      confirm: (_eventId, id, hash) => observe(capturedEpoch, captured, id, hash),
    });
    if (current(capturedEpoch, captured)) {
      confirmedHash = result.hash;
      progress("Deposit confirmed");
      showPaymentComplete(true);
      draft = null;
      dialog.close();
    }
  } catch (error) {
    retryUnused = !walletRequested && !submittedHash && !error.submittedHash && !error.hash;
    if (!submittedHash && walletRequested && Number(error.code) === 4001) {
      localStorage.removeItem(intentKey(captured));
      rejectedUnsigned = true;
    }
    if (current(capturedEpoch, captured)) {
      const hash = submittedHash || error.hash;
      if (hash) txStatus(confirmedHash === hash ? "The deposit was confirmed. The latest event refresh is unavailable; keep its original receipt." : "Receipt checking stopped. The outcome remains unverified. Keep and check this original hash before another deposit.", hash);
      if (!hash) txStatus(error.message || "The deposit could not finish. Check your original wallet request.");
      draft = null;
      if (dialog.open) dialog.close();
      if (connectionLost(error) && !confirmedHash) reconnectAfter(error, hash);
    }
  } finally {
    busy = false;
    connectButton.disabled = false;
    if ((rejectedUnsigned || retryUnused) && current(capturedEpoch, captured)) {
      try { resetUnsignedFlow(); }
      catch (error) { txStatus(error.message); depositButton.hidden = true; }
    }
    const close = dialog.querySelector("[data-close-review]");
    if (close) close.disabled = false;
    if (current(capturedEpoch, captured)) { try { paint(); } catch (error) { status(error.message); depositButton.hidden = true; } }
  }
}

async function checkOriginal() {
  if (busy) return;
  busy = true;
  const capturedEpoch = epoch;
  let captured = null, entry = null;
  try {
    if (!connection?.instanceId) {
      const selectedWallet = wallet, selectedProvider = provider;
      const connected = () => current(capturedEpoch) && connection && same(wallet, selectedWallet) && provider === selectedProvider;
      const flow = await createPublicTransactionFlow({ api, wallet: selectedWallet, kind: "deposit", isCurrent: connected, signal: readController.signal });
      if (!connected() || flow.mode !== EVENT.mode || !same(flow.wallet, selectedWallet)) fail("The original deposit connection changed.");
      transactionFlow = flow;
      connection = Object.freeze({ wallet: selectedWallet, provider: selectedProvider, instanceId: flow.instanceId, mode: flow.mode, epoch: capturedEpoch });
      checkEarlierScopes(scope());
    }
    captured = scope();
    entry = pending(captured);
    paint();
    if (!entry) return;
    txStatus("Checking original transaction…", entry.hash);
    const result = await observe(capturedEpoch, captured, entry.draftId, entry.hash);
    if (result.hash !== entry.hash || result.eventId !== EVENT.id || !same(result.wallet, captured.wallet) || result.chainId !== EVENT.chainId)
      fail("The receipt does not match the original deposit.");
    journal.update(captured, entry.hash, { status: result.status, blockNumber: result.blockNumber, error: null });
    if (current(capturedEpoch, captured)) {
      if (result.status === "confirmed") { confirmedHash = entry.hash; showPaymentComplete(true); }
      txStatus(result.status === "confirmed" ? "Deposit confirmed" : "The original deposit transaction reverted on chain.", entry.hash);
    }
  } catch (error) {
    if (current(capturedEpoch, captured)) {
      if (connectionLost(error) && !confirmedHash) reconnectAfter(error, entry?.hash);
      else { status(error.message); if (entry) txStatus("Keep this original deposit reference. No new payment has been requested.", entry.hash); }
    }
  }
  finally { busy = false; connectButton.disabled = false;
    if (current(capturedEpoch, captured)) { try { paint(); } catch (error) { status(error.message); depositButton.hidden = true; } } }
}

connectButton?.addEventListener("click", connect);
depositButton?.addEventListener("click", prepare);
checkButton.addEventListener("click", checkOriginal);
// One anonymous database read starts before wallet selection, so returning guests
// can copy their receipt without a new transaction flow or a blockchain scan.
const savedReceiptsReady = (async () => {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch("/api/first-event/depositors", { method: "GET", credentials: "omit", cache: "no-store", signal: controller.signal });
    if (!response.ok) return;
    receiptSnapshot = await response.json();
    if (wallet && !busy) { restorePaymentReference(); paint(); }
  } catch { /* Fresh transaction validation remains the final payment gate. */ }
  finally { clearTimeout(timeout); }
})();
// No provider, account request, authentication or financial action runs on load.
