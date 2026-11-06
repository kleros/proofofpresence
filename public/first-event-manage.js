// Cached receipts render the page. Every signed action obtains fresh private
// authority through the original scoped jobs; this module never bootstraps an event.
import { EVENT as DEFAULT_EVENT, firstEventById, firstEventRecoveryPath } from "./first-event/event.js";
import { chooseWalletProvider, rememberWalletProvider, restoreWalletProvider, forgetWalletProvider } from "./wallet-connection.js";
import { savedPayoutState } from "./first-event/post-event.js";
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
const RESOLVER = "0x4B89e798B10478A839Ea0Abcf86C4B94A3C782A4";
const ARBITRATOR = "0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069";
const ipfsURI = value => typeof value === "string" && value.length <= 4096 && /^\/ipfs\/[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(value) && !value.slice(1).split("/").some(part => part === "." || part === ".." || part === "");
const names = { transferOwnership: "Transfer event ownership", acceptOwnership: "Accept event ownership", register: "Approve & register", postAttendance: "Post attendance", challenge: "Challenge incorrect absence", match: "Contest challenge · open Kleros case", resolve: "Resolve original challenge", withdrawPending: "Recover unused deposit", release: "Release eligible payouts", claim: "Recover a failed payment", emergencyWithdraw: "Recover deposit without an attendance list", evidence: "Submit attendance evidence", passPeriod: "Advance an expired Court period", deliverRuling: "Deliver the final Court ruling", fundAppeal: "Contribute to a Court appeal", appealRewards: "Recover your appeal contribution rewards" };
const caseActions = new Set(["evidence", "passPeriod", "deliverRuling", "fundAppeal", "appealRewards"]);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
const concat = (...arrays) => Uint8Array.from(arrays.flatMap(value => [...value]));
function varint(number) { const out = []; do { out.push((number & 127) | (number >= 128 ? 128 : 0)); number = Math.floor(number / 128); } while (number); return out; }
async function contentURI(bytes) {
  const size = varint(bytes.length), file = concat([8, 2, 18], size, bytes, [24], size), node = concat([10], varint(file.length), file);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", node)), alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt("0x1220" + [...hash].map(byte => byte.toString(16).padStart(2, "0")).join("")), encoded = "";
  while (value) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  return "/ipfs/" + encoded;
}
function contextMatches(context, wallet, EVENT = DEFAULT_EVENT) {
  return context?.eventId === EVENT.id && context.chainId === 1 && same(context.contract, EVENT.contract) &&
    context.mode === EVENT.mode && context.abiVersion === EVENT.abiVersion && same(context.wallet, wallet) && stable(context.instanceId);
}
function encoded(action, args) {
  if (action === "transferOwnership") return "0xf2fde38b" + addressWord(args[0]);
  if (action === "acceptOwnership") return "0x79ba5097";
  if (action === "withdrawPending") return "0x8033b09f" + addressWord(args[0]) + word(args[1]);
  if (action === "release") return "0x766f8426";
  if (["claim", "emergencyWithdraw"].includes(action)) return (action === "claim" ? "0x1e83409a" : "0x6ff1c9bc") + addressWord(args[0]);
  if (["passPeriod", "deliverRuling"].includes(action)) return (action === "passPeriod" ? "0x115d5376" : "0x8bb04875") + word(args[0]);
  if (action === "fundAppeal") return "0x4b2f0ea0" + word(args[0]) + word(args[1]);
  if (action === "appealRewards") return "0x0e274e4c" + word(args[0]) + addressWord(args[1]) + word(96) + word(3) + [0, 1, 2].map(word).join("");
  if (action === "evidence") {
    const bytes = new TextEncoder().encode(args[1]), data = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return "0xa6a7f0eb" + word(args[0]) + word(64) + word(bytes.length) + data.padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  }
  if (action === "challenge") return "0xd2ef7398";
  if (action === "match" || action === "resolve") return (action === "match" ? "0x6d6df455" : "0x32064dac") + addressWord(args[0]);
  const list = args[0], tail = word(list.length) + list.map(addressWord).join("");
  return action === "register" ? "0xab50d54e" + word(32) + tail : "0x5d95e1d2" + word(64) + word(args[1]) + tail;
}
export function assertFirstEventManageDraft(draft, context, action, params, origin = location.origin, EVENT = DEFAULT_EVENT, expectedCase = null) {
  const known = firstEventById(EVENT?.id);
  if (!known || !same(known.contract, EVENT.contract) || !contextMatches(context, context?.wallet, EVENT) || !names[action] || draft?.action !== action || !stable(draft.id) ||
      draft.eventId !== EVENT.id || draft.chainId !== 1 || !same(draft.contract, EVENT.contract) || !same(draft.wallet, context.wallet) ||
      draft.mode !== EVENT.mode || draft.instanceId !== context.instanceId || draft.origin !== origin ||
      draft.contractVersion !== EVENT.abiVersion || draft.abiVersion !== EVENT.abiVersion || draft.scopeKind !== "event-call" ||
      !stable(draft.snapshot) || !Number.isSafeInteger(draft.expiresAt) || Date.now() >= draft.expiresAt || !wei(draft.valueWei) || !Array.isArray(draft.args))
    fail("This review belongs to another event, wallet or server, or has expired.");
  const methods = { transferOwnership: "transferOwnership", acceptOwnership: "acceptOwnership", register: "registerStakers", postAttendance: "postAttendance", challenge: "challenge", match: "matchChallenge", resolve: "resolveChallenge", withdrawPending: "withdrawPending", release: "releasePayouts", claim: "claim", emergencyWithdraw: "emergencyWithdraw", evidence: "submitEvidence", passPeriod: "passPeriod", deliverRuling: "executeRuling", fundAppeal: "fundAppeal", appealRewards: "withdrawFeesAndRewardsForAllRounds" };
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
  } else if (action === "release") {
    if (!params || Object.keys(params).length || args.length || draft.valueWei !== "0" ||
        !draft.params || Object.keys(draft.params).length) fail("The payout release review changed.");
  } else if (["claim", "emergencyWithdraw"].includes(action)) {
    if (!params || Object.keys(params).length || args.length !== 1 || !same(args[0], context.wallet) || draft.valueWei !== "0" ||
        !draft.params || Object.keys(draft.params).length !== 1 || !same(draft.params.to, context.wallet))
      fail("Recovery must return only this wallet's funds to the same wallet.");
  } else if (action === "evidence") {
    if (!params || Object.keys(params).sort().join(",") !== "uri,wallet" || !address(params.wallet) || !ipfsURI(params.uri) ||
        !expectedCase || !same(expectedCase.wallet, params.wallet) || !wei(expectedCase.localId) || args.length !== 2 ||
        String(args[0]) !== expectedCase.localId || args[1] !== params.uri || draft.valueWei !== "0" ||
        !draft.params || Object.keys(draft.params).sort().join(",") !== "uri,wallet" ||
        !same(draft.params.wallet, params.wallet) || draft.params.uri !== params.uri)
      fail("The evidence URI or original resolver case changed. Refresh the case before reviewing it.");
  } else if (caseActions.has(action)) {
    if (!expectedCase || !same(expectedCase.wallet, params?.wallet) || !wei(expectedCase.localId) || !wei(expectedCase.arbitratorId))
      fail("Load this exact Court case before reviewing its next action.");
    const directCourt = ["passPeriod", "deliverRuling"].includes(action);
    if (String(args[0]) !== (directCourt ? expectedCase.arbitratorId : expectedCase.localId)) fail("The original Court case ID changed.");
    if (action === "fundAppeal") {
      if (Object.keys(params).sort().join(",") !== "amountWei,side,wallet" || ![0, 1, 2].includes(params.side) || !wei(params.amountWei) || BigInt(params.amountWei) <= 0n ||
          args.length !== 2 || Number(args[1]) !== params.side || draft.valueWei !== params.amountWei ||
          !draft.params || Object.keys(draft.params).sort().join(",") !== "amountWei,side,wallet" || !same(draft.params.wallet, params.wallet) || draft.params.side !== params.side || draft.params.amountWei !== params.amountWei)
        fail("The exact appeal side or contribution changed.");
    } else if (action === "appealRewards") {
      if (Object.keys(params).join(",") !== "wallet" || args.length !== 3 || !same(args[1], context.wallet) || JSON.stringify(args[2]) !== "[0,1,2]" || draft.valueWei !== "0" ||
          !draft.params || Object.keys(draft.params).sort().join(",") !== "sides,wallet" || !same(draft.params.wallet, params.wallet) || JSON.stringify(draft.params.sides) !== "[0,1,2]")
        fail("Appeal rewards must return to this wallet using the fixed ruling sides.");
    } else if (Object.keys(params).join(",") !== "wallet" || args.length !== 1 || draft.valueWei !== "0" || !draft.params || Object.keys(draft.params).join(",") !== "wallet" || !same(draft.params.wallet, params.wallet)) fail("The Court progression action changed.");
  } else if (args.length !== 1 || !same(args[0], params.wallet ?? context.wallet) ||
      (action === "resolve" ? draft.valueWei !== "0" : BigInt(draft.valueWei) <= 0n)) fail("The original challenge or amount changed.");
  const tx = draft.transaction;
  const target = ["passPeriod", "deliverRuling"].includes(action) ? ARBITRATOR : ["evidence", "fundAppeal", "appealRewards"].includes(action) ? RESOLVER : EVENT.contract;
  if (!same(tx?.to, target) || !same(tx?.from, context.wallet) || Number(tx?.chainId) !== 1 ||
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
  let busy = false, draft = null, reviewed = null, servicePromise = null, receipt = null, access = null, needsSignIn = false;
  let permissionLoadRevision = null;
  let artifactReview = null;
  const documents = new Map(), evidenceInputs = new Map();
  const accessEnabled = view === "organizer" && EVENT.id === DEFAULT_EVENT.id;
  const checkinNonces = new Map();
  const abort = new AbortController(), selected = new Set();
  root.innerHTML = `<section class="luma-manage-grid" data-first-event-manage>
    <section class="luma-wallet-bar" aria-label="Event wallet"><div class="luma-wallet-summary"><p class="eyebrow">${view === "organizer" ? "ORGANIZER WALLET" : "YOUR WALLET"}</p><h2>${view === "organizer" ? "Manage attendance" : view === "recovery" ? "Your deposit & attendance" : "Your attendance & challenges"}</h2><p class="mono small" data-manage-wallet></p>${accessEnabled ? '<p class="small" data-manage-access-status>Connect your wallet, then load private event permissions when needed.</p>' : ""}</div>
      <div class="luma-wallet-actions"><button type="button" class="button button-primary" data-manage-connect>Connect wallet</button>${accessEnabled ? '<button type="button" class="button button-secondary" data-manage-access-load disabled>Load event permissions</button>' : ""}</div></section>
    <p class="small mono luma-manage-feedback" data-manage-status role="status" aria-live="polite"></p><div class="luma-manage-pending" data-manage-pending></div>
    <div class="luma-manage-guests" data-manage-guests></div>
    <p class="small luma-snapshot-note" data-manage-state>Saved event details are for display. Your current role and contract rules are checked when you review an action.</p>
    <section class="luma-manage-section luma-settlement" data-manage-settlement aria-labelledby="manage-settlement-heading"><div class="section-heading"><p class="eyebrow">AFTER THE EVENT</p><h3 id="manage-settlement-heading">Payouts &amp; recovery</h3></div><div data-manage-settlement-state></div></section>
    ${view === "organizer" ? `<form class="luma-manage-section luma-attendance-review" data-manage-attendance><div class="section-heading"><p class="eyebrow">OWNER REVIEW</p><h3>Final attendance list</h3></div><p>The contract owner selects registered wallets for the final attendance list, then posts it after the event ends. Recorded door check-ins stay separate from this selection.</p>
      <label>Attendance review note<textarea name="note" maxlength="1000" minlength="8" required placeholder="Explain how you verified attendance during the event."></textarea></label>
      <label class="luma-confirmation"><input type="checkbox" name="confirmed" required> I confirm the selected registered wallets attended during the event. Omitted wallets retain their challenge rights.</label>
      <button type="submit" class="button button-primary" data-manage-post disabled>Review attendance list</button></form>` : ""}
    <div class="luma-manage-secondary">${accessEnabled ? '<details class="luma-manage-section luma-team-panel" data-manage-access><summary>Team &amp; ownership</summary><div class="luma-manage-section-body" data-manage-access-controls></div></details>' : ""}
      <details class="luma-manage-section luma-participant-tools" data-manage-participant-tools><summary>Participant tools</summary><div class="luma-manage-section-body"><div data-manage-participant></div><p class="field-help">Attendance posting opens a 24-hour omission challenge window. Each challenge has a separate 24-hour matching period. Matching pays the reviewed amount and opens a real Kleros case; it is a separate action.</p></div></details>
    </div></section>`;
  const panel = root.querySelector("[data-first-event-manage]"), label = root.querySelector("[data-manage-wallet]"), status = root.querySelector("[data-manage-status]");
  const connectButton = root.querySelector("[data-manage-connect]"), participant = root.querySelector("[data-manage-participant]");
  const dialog = root.ownerDocument.createElement("dialog"); dialog.className = "wallet-review"; dialog.dataset.manageReview = ""; root.ownerDocument.body.append(dialog);
  const current = captured => !disposed && root.isConnected && isCurrent() && (captured === undefined || captured === revision);
  const say = message => { if (current()) status.textContent = message; };
  const caseBinding = target => {
    const snapshot = getSnapshot(), row = snapshot?.eventState?.stakers?.find(item => same(item.wallet, target));
    if (!address(target) || !row || ![2, 3].includes(row.challenge?.state) || !wei(row.challenge.localId))
      fail("Refresh the matched case before reviewing its actions. Waiting challenges do not have a Court case yet.");
    const saved = documents.get("case:" + target.toLowerCase())?.currentCase;
    const projected = savedPayoutState(snapshot, EVENT)?.cases.find(item => same(item.wallet, target));
    const arbitratorId = projected?.arbitratorDisputeId ?? (saved?.matched && saved.localDisputeID === row.challenge.localId ? saved.arbitratorDisputeID : null);
    return Object.freeze({ wallet: row.wallet, localId: row.challenge.localId, arbitratorId });
  };
  function publicationKey(item) {
    return "kleros-first-event-publication-ui:v1:" + [location.origin, item.artifact.scope.instanceId, EVENT.id, EVENT.contract.toLowerCase(), wallet.toLowerCase(), item.artifact.scope.wallet.toLowerCase(), item.kind, item.artifact.sha256].map(encodeURIComponent).join(":");
  }
  async function checkedDocument(result, target, kind, author, prior = null, source = null) {
    const a = result?.artifact, scope = a?.scope, latest = result?.currentCase, p = result?.publication;
    const scopesMatch = (value, currentInstance) => value?.environment === "production" && stable(value.instanceId) && (!currentInstance || value.instanceId === context?.instanceId) && value.chainId === 1 && value.contractVersion === EVENT.abiVersion && value.eventId === EVENT.id && same(value.contract, EVENT.contract) && same(value.wallet, target) && Number.isSafeInteger(value.blockNumber) && value.blockNumber > 0 && hash(value.blockHash) && typeof value.matched === "boolean" && (value.matched ? wei(value.localDisputeID) && wei(value.arbitratorDisputeID) : value.localDisputeID === null && value.arbitratorDisputeID === null);
    if (!a || !scopesMatch(kind === "file" ? { ...scope, matched: true } : scope, false) || !scopesMatch(latest, true) || kind !== "file" && typeof a.content !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256 ?? "") || !/^[a-f0-9]{64}$/.test(a.scopeHash ?? "") || !ipfsURI(a.uri) || !p || !["exported", "published-unverified", "upload-uncertain", "integrity-mismatch", "availability-unconfirmed", "verified"].includes(p.status) || p.uri !== a.uri || p.sha256 !== a.sha256 || p.scopeHash !== a.scopeHash || p.byteLength !== a.byteLength || typeof p.uploadAttempted !== "boolean" || typeof p.canPublish !== "boolean" || p.canPublish && p.uploadAttempted)
      fail("The document review belongs to another event, case or server.");
    const base64 = source?.base64 ?? prior?.base64;
    const bytes = kind === "file" ? Uint8Array.from(atob(base64 ?? ""), char => char.charCodeAt(0)) : new TextEncoder().encode(a.content);
    const boundScope = kind === "file" ? { kind: a.kind, scope, fileName: a.fileName, mediaType: a.mediaType } : scope;
    if (kind === "file" && (a.schemaVersion !== 1 || a.kind !== "erc1497-evidence-attachment" || !same(scope.uploaderWallet, author) || !same(scope.resolver, RESOLVER) || a.fileName !== (source?.fileName ?? prior?.artifact.fileName) || a.mediaType !== (source?.mediaType ?? prior?.artifact.mediaType))) fail("The selected file, author or original Court case changed.");
    if (bytes.length === 0 || bytes.length > 262144 || a.byteLength !== bytes.length || await digest(bytes) !== a.sha256 || await digest(new TextEncoder().encode(JSON.stringify(boundScope))) !== a.scopeHash || await contentURI(bytes) !== a.uri || prior && (prior.artifact.sha256 !== a.sha256 || prior.artifact.scopeHash !== a.scopeHash || prior.artifact.content !== a.content))
      fail("The exact document bytes or IPFS address changed.");
    const parsed = kind === "file" ? null : JSON.parse(a.content);
    if (kind === "evidence" && (!latest.matched || !same(parsed.submitter, author))) fail("The evidence author or matched Court case changed.");
    const row = getSnapshot()?.eventState?.stakers?.find(item => same(item.wallet, target));
    if (latest.matched && (!row || ![2, 3].includes(row.challenge?.state) || row.challenge.localId !== latest.localDisputeID)) fail("Refresh the case list before relying on these Court IDs.");
    return { ...result, kind, author, ...(kind === "file" ? { base64 } : {}) };
  }
  function documentDialog(item) {
    artifactReview = item; draft = reviewed = null;
    const consumed = localStorage.getItem(publicationKey(item)) !== null || item.publication.uploadAttempted;
    const verified = item.publication.status === "verified", type = item.kind === "case" ? "Court case document" : item.kind === "file" ? "Evidence attachment" : "Attendance evidence";
    dialog.innerHTML = `<h2>${type} · exact public document</h2><p>Review these exact bytes before publication. Publishing puts this document on public IPFS; copies may remain permanently available. No wallet transaction is sent by publishing.</p><dl class="details-list"><div><dt>Event contract</dt><dd class="mono">${EVENT.contract}</dd></div><div><dt>Challenged wallet</dt><dd class="mono">${escape(item.artifact.scope.wallet)}</dd></div>${item.kind === "file" ? `<div><dt>Selected attachment</dt><dd>${escape(item.artifact.fileName)} · ${escape(item.artifact.mediaType)} · ${item.artifact.byteLength} bytes</dd></div>` : ""}<div><dt>IPFS URI</dt><dd class="mono">${escape(item.artifact.uri)}</dd></div><div><dt>SHA256</dt><dd class="mono">${escape(item.artifact.sha256)}</dd></div><div><dt>Publication</dt><dd>${escape(item.publication.status)}</dd></div></dl>${item.kind === "file" && ["image/png", "image/jpeg"].includes(item.artifact.mediaType) ? `<img class="luma-evidence-preview" alt="Selected evidence attachment preview" src="data:${item.artifact.mediaType};base64,${item.base64}">` : `<pre class="luma-document-bytes" data-manage-document-bytes>${escape(item.kind === "file" ? ["text/plain", "application/json"].includes(item.artifact.mediaType) ? new TextDecoder().decode(Uint8Array.from(atob(item.base64), char => char.charCodeAt(0))) : "Binary attachment. Check the selected file before publishing; the exact byte count and hash are shown above." : item.artifact.content)}</pre>`}<p role="status" data-manage-document-status>${verified ? "Exact document availability was verified. Chain submission remains a separate reviewed action." : consumed ? "An upload intent already exists. Check availability; do not publish the same document again." : !item.publication.canPublish ? "Publication is unavailable in the current case state. Preserve this document and use availability checks for an existing copy." : "Not published. Review sent it to the app for checks; no public IPFS upload occurred."}</p>${item.publication.canPublish && !consumed && !verified ? '<label class="luma-public-consent"><input type="checkbox" data-manage-public-consent> I approve publishing this exact document publicly and understand it may remain available permanently.</label><button type="button" class="button button-primary" data-manage-document-publish>Publish reviewed document</button>' : ""}<div class="button-row"><button type="button" class="button button-secondary" data-manage-document-availability>Check document availability</button>${verified && item.kind === "evidence" ? '<button type="button" class="button button-primary" data-manage-document-submit>Review evidence transaction</button>' : verified && item.kind === "file" ? '<button type="button" class="button button-primary" data-manage-document-attach>Use verified attachment</button>' : ""}<button type="button" class="button button-secondary" data-manage-document-close>Close</button></div>`;
    if (!dialog.open) dialog.showModal();
  }
  async function reviewDocument(target, kind, input = null) {
    if (busy) return;
    const captured = revision, author = wallet; busy = true; update(); say("Preparing the exact document. Nothing is being published.");
    try {
      await privateScope(captured);
      const path = `/api/events/${encodeURIComponent(EVENT.id)}/cases/${target}/${kind === "evidence" ? "evidence/" : kind === "file" ? "files/" : ""}artifact`;
      const result = await api(path, { method: "POST", body: JSON.stringify(input ?? {}), signal: abort.signal });
      const item = await checkedDocument(result, target, kind, author, null, kind === "file" ? input : null);
      if (!current(captured) || !same(wallet, author)) return;
      documents.set(kind + ":" + target.toLowerCase(), item); documentDialog(item); say("Review the exact public document before publishing.");
    } catch (error) { if (current(captured)) say(error.message); }
    finally { busy = false; update(); }
  }
  async function reviewFile(file, target) {
    if (busy) return;
    const captured = revision, author = wallet, types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf", txt: "text/plain", json: "application/json" };
    if (!file || file.size === 0 || file.size > 262144 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}\.[A-Za-z0-9]+$/.test(file.name)) { say("Choose one nonempty PNG, JPEG, PDF, TXT or JSON file with a simple filename, at most 256 KiB."); return; }
    const mediaType = types[file.name.split(".").at(-1).toLowerCase()];
    if (!mediaType || file.type && file.type !== mediaType) { say("The selected filename and supported file type must agree."); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!current(captured) || !same(wallet, author)) return;
      let binary = ""; for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.slice(at, at + 8192));
      await reviewDocument(target, "file", { fileName: file.name, mediaType, base64: btoa(binary) });
    } catch (error) { if (current(captured)) say(error.message); }
  }
  async function documentAction(publish) {
    if (busy || !artifactReview) return;
    const item = artifactReview, captured = revision, author = wallet;
    if (publish && !item.publication.canPublish) { dialog.querySelector("[data-manage-document-status]").textContent = "Publication is unavailable in the current case state. Nothing was uploaded."; return; }
    if (publish && !dialog.querySelector("[data-manage-public-consent]")?.checked) { dialog.querySelector("[data-manage-document-status]").textContent = "Approve the public and permanent publication consent before publishing."; return; }
    busy = true; dialog.querySelectorAll("button").forEach(button => { button.disabled = true; }); update();
    try {
      await privateScope(captured);
      if (!same(author, item.author) || artifactReview !== item) fail("The document author changed. Review it again.");
      if (publish) {
        const key = publicationKey(item);
        if (localStorage.getItem(key) !== null || item.publication.uploadAttempted) fail("Check the existing publication attempt instead of uploading again.");
        const held = JSON.stringify({ phase: "requested", sha256: item.artifact.sha256, scopeHash: item.artifact.scopeHash });
        localStorage.setItem(key, held); if (localStorage.getItem(key) !== held) fail("Durable publication storage is unavailable. Nothing was uploaded.");
      }
      const path = `/api/events/${encodeURIComponent(EVENT.id)}/cases/${item.artifact.scope.wallet}/${item.kind === "evidence" ? "evidence/" : item.kind === "file" ? "files/" : ""}${publish ? "publish" : "availability"}`;
      const result = await api(path, { method: "POST", body: JSON.stringify(item.kind === "case" && !publish ? {} : { sha256: item.artifact.sha256, scopeHash: item.artifact.scopeHash, ...(item.kind === "file" ? { base64: item.base64 } : {}), ...(publish && item.kind !== "case" ? { consent: true } : {}) }), signal: abort.signal });
      const next = await checkedDocument(result, item.artifact.scope.wallet, item.kind, author, item);
      if (!current(captured) || !same(wallet, author)) return;
      documents.set(item.kind + ":" + item.artifact.scope.wallet.toLowerCase(), next); documentDialog(next);
    } catch (error) {
      if (current(captured)) { documentDialog(item); dialog.querySelector("[data-manage-document-status]").textContent = error.message + " Preserve the original document and check availability before another action."; }
    } finally { busy = false; if (current(captured) && dialog.open) dialog.querySelectorAll("button").forEach(button => { button.disabled = false; }); update(); }
  }
  const services = () => servicePromise ??= Promise.all([import("./event-read.js"), import("./v10-wallet-account.js"), import("./transaction-context.js")]).then(([read, account, transactions]) => ({ ...read, ...account, ...transactions, journal: transactions.createTransactionJournal(localStorage) }));
  const api = async (path, options = {}) => {
    const requestRevision = revision;
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...options.headers } });
    const data = await response.json();
    if (!response.ok) {
      if ([401, 403].includes(response.status) && current(requestRevision)) { authenticated = false; access = draft = reviewed = null; selected.clear(); needsSignIn = response.status === 401; update(); }
      throw Object.assign(Error(data.error ?? "The event action could not finish."), { code: data.code, status: response.status });
    }
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
    load.textContent = needsSignIn ? "Sign in to manage" : "Refresh permissions";
    const text = root.querySelector("[data-manage-access-status]"), host = root.querySelector("[data-manage-access-controls]");
    if (!value) {
      text.textContent = wallet ? needsSignIn ? "Sign in once to load your private event permissions. This signature sends no transaction." : busy ? "Checking your event permissions…" : "Event permissions are unavailable. Refresh to check again." : "Connect your wallet to manage this event. An existing connection is restored automatically.";
      host.replaceChildren(); return;
    }
    const labels = { owner: "Contract owner", admin: "Event admin", staff: "Check-in staff", "pending-owner": "Pending owner", participant: "Participant" };
    text.textContent = `${labels[value.role]} · permissions revision ${value.revision}`;
    const grants = ["owner", "admin"].includes(value.role);
    const list = (role, items) => `<h4>${role === "admin" ? "Event admins" : "Check-in staff"}</h4>${items.length ? `<ul class="luma-access-list">${items.map(item => `<li class="luma-access-row"><span class="mono">${escape(item)}</span>${value.role === "owner" || value.role === "admin" && role === "staff" ? ` <button type="button" class="button button-secondary button-small" data-manage-access-revoke="${role}" data-manage-target="${item}">Revoke ${role}</button>` : ""}</li>`).join("")}</ul>` : "<p>None assigned.</p>"}`;
    host.innerHTML = `<div class="luma-access-owner"><p>Current contract owner: <span class="mono">${escape(value.owner)}</span></p>
      ${value.pendingOwner !== "0x" + "0".repeat(40) ? `<p>Pending owner: <span class="mono">${escape(value.pendingOwner)}</span></p>` : ""}
      </div><p>Team permissions are saved securely on the server. No contract transaction is required. Only the event owner can register attendees, post final attendance or transfer ownership. Event admins can manage check-in staff and record door check-ins.</p><div class="luma-access-roster">${value.role !== "participant" ? list("admin", value.admins) + list("staff", value.staff) : "<p>This wallet has no event team access.</p>"}</div>
      ${grants ? `<form class="luma-team-form" data-manage-access-form><label>Wallet address<input name="wallet" required autocomplete="off" spellcheck="false" pattern="0x[a-fA-F0-9]{40}" placeholder="0x…"></label><label>Access<select name="role">${value.role === "owner" ? '<option value="admin">Event admin</option>' : ""}<option value="staff">Check-in staff</option></select></label><button type="submit" class="button button-secondary">Grant access</button></form>` : ""}
      ${value.role === "owner" ? `<form class="luma-ownership-panel" data-manage-transfer-form><h4>Transfer event ownership</h4><p>The nominated wallet must accept the transfer in its wallet. Team permissions must be assigned under the new owner.</p><label>New owner wallet<input name="to" required autocomplete="off" spellcheck="false" pattern="0x[a-fA-F0-9]{40}" placeholder="0x…"></label><button type="submit" class="button button-secondary" ${receipt ? "disabled" : ""}>Review ownership transfer</button></form>` : ""}
      ${value.role === "pending-owner" ? `<button type="button" class="button button-primary" data-manage-action="acceptOwnership" ${receipt ? "disabled" : ""}>Review ownership acceptance</button>` : ""}`;
    if (value.role === "pending-owner") root.querySelector("[data-manage-access]").open = true;
    host.querySelectorAll("button,input,select").forEach(input => { if (busy) input.disabled = true; });
  }
  function acceptAccess(value, captured) {
    if (!current(captured)) fail("The selected wallet or event changed.");
    access = assertFirstEventAccess(value, context, EVENT);
    needsSignIn = false;
    if (access.role !== "owner") selected.clear();
    draft = reviewed = null;
    update();
  }
  async function loadAccess(allowSignIn = true) {
    if (!accessEnabled || busy) return;
    const captured = revision; permissionLoadRevision = captured; busy = true; update(); say("Loading event permissions…");
    try {
      await privateScope(captured, true, allowSignIn);
      const value = await api(`/api/events/${encodeURIComponent(EVENT.id)}/access`, { signal: abort.signal });
      acceptAccess(value, captured); say("Event permissions loaded.");
    } catch (error) { if (current(captured)) { access = null; if (error.code === "SIGN_IN_REQUIRED") needsSignIn = true; say(error.message); } }
    finally { if (permissionLoadRevision === captured && current(captured)) { permissionLoadRevision = null; busy = false; update(); } }
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
      const now = Math.floor(Date.now() / 1000);
      const duringEvent = Number.isSafeInteger(state?.eventStart) && Number.isSafeInteger(state?.endsAt) && now >= state.eventStart && now <= state.endsAt;
      button.disabled = busy || !registered || Boolean(checked) || !duringEvent;
      const label = button.parentElement.querySelector("[data-manage-checkin-state]");
      if (label) label.textContent = checked ? `Recorded ${new Date(checked.recordedAt).toLocaleString()} by ${checked.actorWallet}` : permissions ? duringEvent ? "No door check-in recorded. " : "Door check-ins are recorded during event hours. Afterward, the owner reviews final attendance. " : "Load permissions to view check-ins. ";
    });
    const post = root.querySelector("[data-manage-post]");
    if (post) { post.closest("form").hidden = !isOwner; post.disabled = !isOwner || busy || Boolean(receipt) || !state || ![0, "Open"].includes(state.phase) || !Number.isSafeInteger(state.endsAt) || Date.now() < state.endsAt * 1000 || selected.size === 0; }
    const stateLabel = root.querySelector("[data-manage-state]");
    stateLabel.textContent = state ? `Saved contract phase: ${state.phase}. ${state.endsAt ? "Event ends " + new Date(state.endsAt * 1000).toLocaleString() + ". " : ""}Every action checks current contract state.` : "Current attendance state is not indexed yet. Registration can be reviewed now; refresh the list for attendance controls. Current role and contract rules are checked on every action.";
    const settlement = root.querySelector("[data-manage-settlement-state]"), currentEvent = Boolean(firstEventById(EVENT.id));
    const blocked = !wallet || busy || Boolean(receipt), phase = state?.phase;
    const chainNow = Number.isSafeInteger(state?.chainTimestamp) ? state.chainTimestamp : null;
    const waiting = (state?.stakers ?? []).filter(item => item.challenge?.state === 1);
    const releaseAfter = Math.max(state?.challengeEndsAt ?? 0, ...waiting.map(item => item.challenge.matchDeadline));
    const checkedAt = Date.parse(snapshot?.checkedAt), fresh = snapshot?.status === "current" && Number.isFinite(checkedAt) && Date.now() - checkedAt <= 60000 && checkedAt <= Date.now() + 5000;
    const releaseReady = fresh && currentEvent && phase === "Listed" && state.challengeEndsAt > 0 && chainNow !== null && chainNow > releaseAfter;
    const date = seconds => new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: EVENT.timezone }) + ` (${EVENT.timezone})`;
    // A stale or absent display snapshot must never claim readiness. The button
    // below requests a fresh server-side chain check and simulation only; the
    // separate reviewed wallet request remains gated by validation and consent.
    const releaseCheck = `<button type="button" class="button button-primary" data-manage-action="release" ${blocked ? "disabled" : ""}>${releaseReady ? "Review payout release" : "Check payout eligibility"}</button><p class="field-help">This checks the current contract first. It does not send a transaction; any supported connected wallet can request the check.</p>`;
    settlement.innerHTML = !state || phase === "Listed" && (!Number.isSafeInteger(state.challengeEndsAt) || state.challengeEndsAt <= 0) ? `<p>Attendance or payout deadline is unavailable. Check the contract before relying on this saved status.</p>${currentEvent ? releaseCheck : ""}` : !currentEvent ? '<p>This previous event retains its original receipts and unused-credit recovery. It does not share the current event’s payout round.</p>' : `<p>${phase === "Finalized" ? "The payout round was released. This does not prove every transfer succeeded; a failed transfer stays owed to its recipient." : phase === "Listed" ? "One payout-release transaction sends ETH to confirmed attendees after the challenge and matching windows. Unresolved Court cases keep their own shares reserved." : phase === "Cancelled" ? "The event was cancelled. Registered refunds and unused payer credit remain separate; failed transfers can be recovered below." : "The owner must publish attendance before normal payouts. No attendance list means a separate deposit recovery rule applies."}</p>
      ${phase === "Listed" ? `<p class="field-help">${releaseReady ? "The saved chain timestamp is past the time windows. A fresh contract check is still required." : `Saved earliest release: ${escape(date(releaseAfter))}. The current contract must confirm eligibility; the clock does not send ETH.`}</p>${releaseCheck}` : ""}
      <details class="luma-recovery-tools" ${phase === "Cancelled" || phase === "Finalized" ? "open" : ""}><summary>Failed payments &amp; no-list recovery</summary><p>These checks prepare a transaction only when the contract confirms funds are available to your wallet. Returns go to this same wallet.</p><div class="button-row"><button type="button" class="button button-secondary" data-manage-action="claim" ${blocked ? "disabled" : ""}>Check failed payment</button>${phase === "Open" ? `<button type="button" class="button button-secondary" data-manage-action="emergencyWithdraw" ${blocked || chainNow === null || chainNow <= state.claimDeadline ? "disabled" : ""}>Review no-list deposit recovery</button>` : ""}</div>${phase === "Open" ? `<p class="field-help">No-list recovery requires the contract to remain Open past ${escape(date(state.claimDeadline))}. Deposits not registered in the pool use Recover unused deposit.</p>` : ""}</details>`;
    if (!wallet) { participant.innerHTML = '<p>Connect your deposit wallet to see attendance and case actions. Connecting alone does not sign in or send a transaction.</p>'; return; }
    if (!state) { participant.innerHTML = '<p>Your attendance status is unavailable. Refresh the list; missing saved data does not mean you were unregistered or absent.</p>'; return; }
    const own = state?.stakers?.find(item => same(item.wallet, wallet));
    // Arriving from the deposit page's omission/case link should expose the
    // existing reviewed controls without triggering a signature or payment.
    if (view === "recovery" && own && (state?.phase === "Listed" || own.challenge?.state > 0))
      root.querySelector("[data-manage-participant-tools]").open = true;
    const omitted = currentEvent && phase === "Listed" && own?.status === 1 && !own.attended && own.challenge?.state === 0;
    const canChallenge = omitted && fresh && chainNow !== null && state.challengeEndsAt > 0 && chainNow <= state.challengeEndsAt;
    const expanded = new Set();
    for (const card of participant.querySelectorAll("[data-manage-case]")) [...card.querySelectorAll("details")].forEach((node, index) => { if (node.open) expanded.add(card.dataset.manageCase + ":" + index); });
    participant.innerHTML = `<h3>Your attendance</h3><p class="mono">${escape(wallet)}</p>${own ? `<p>${own.attended ? "Your wallet is included in attendance." : "Your registered wallet is not included in attendance."}</p>` : "<p>This wallet is not registered in the saved attendance list. Unused credit has its own recovery action.</p>"}
      ${state?.challengeEndsAt ? `<p>Saved omission challenge deadline: ${escape(new Date(state.challengeEndsAt * 1000).toLocaleString())}.</p>` : ""}
      ${omitted ? `<p>${canChallenge ? "Attended but left out? Review the current challenge payment. This starts a 24-hour matching window; it does not create a Court case by itself." : "A fresh on-chain timestamp within the omission deadline is required. Refresh the list; an expired deadline cannot be extended by this screen."}</p><button type="button" class="button button-primary" data-manage-action="challenge" ${canChallenge ? "" : "disabled data-manage-unavailable"}>Review incorrect absence</button>` : ""}
      ${currentEvent ? (state?.stakers ?? []).filter(item => item.challenge && [1, 2, 3].includes(item.challenge.state)).map(item => {
        const challenge = item.challenge, matched = challenge.state === 2, pending = challenge.state === 1;
        const document = documents.get("case:" + item.wallet.toLowerCase()), verified = document?.publication.status === "verified";
        let ids = null; try { ids = caseBinding(item.wallet); } catch { /* Waiting has no Court IDs. */ }
        const courtIDs = ids && wei(ids.arbitratorId);
        const input = evidenceInputs.get(item.wallet.toLowerCase()) ?? { title: "", description: "", attachmentURI: "" };
        return `<article class="luma-attendance-case" data-manage-case="${escape(item.wallet)}"><h4>${matched ? "Kleros Court case" : pending ? "Challenge waiting for a match" : "Settled attendance challenge"}</h4><p class="mono">${escape(item.wallet)}</p><button type="button" class="button button-secondary" data-manage-case-document="${escape(item.wallet)}">Review exact Court case document</button><p class="field-help">Case document: ${verified ? "exact availability verified" : "publication and availability need verification"}. Preparing a document does not upload it.</p>${pending ? `<p>No Court case exists yet. A separate matching payment contests the attendance claim. Evidence submission becomes available only if this challenge is contested and a Court case opens.</p><p>Matching deadline: ${escape(date(challenge.matchDeadline))}</p><button type="button" class="button button-secondary" data-manage-action="match" data-manage-target="${escape(item.wallet)}" ${verified && fresh && chainNow !== null && chainNow <= challenge.matchDeadline ? "" : "disabled data-manage-unavailable"}>Review contest / Kleros case</button><p class="field-help">Publish and verify the exact case document before opening Court. The matching window must still be open in a fresh snapshot.</p>` : matched ? `<p>Resolver local case ID: <strong>${escape(challenge.localId)}</strong>${courtIDs ? ` · Court dispute ID: <strong>${escape(ids.arbitratorId)}</strong>` : ""}. The case’s payout share remains protected until the final ruling is settled.</p>` : '<p>The challenge is settled. Refresh to check attendance and any payment recovery separately.</p>'}
        ${pending || matched ? `<button type="button" class="button button-secondary" data-manage-action="resolve" data-manage-target="${escape(item.wallet)}">Review resolution</button>` : ""}
        ${matched ? `<form data-manage-file-form data-case-wallet="${escape(item.wallet)}"><h4>Attach a picture or document</h4><p>Selecting stays in this browser. Review sends the selected file to the app for checks; the server stores only its descriptor. Only the challenged wallet, recorded case organizer or matcher can use this app’s evidence preparation. Permission is checked on review; public IPFS upload requires a separate approval.</p><label>Evidence attachment<input name="file" type="file" accept="image/png,image/jpeg,application/pdf,text/plain,application/json" required data-manage-file-input></label><p class="field-help">One PNG, JPEG, PDF, TXT or JSON file, maximum 256 KiB. Use a simple filename such as attendance.jpg. Keep the original file to check an unfinished upload later; reselecting identical bytes recovers its existing intent. Never include private details without permission.</p><button type="submit" class="button button-secondary">Review selected attachment</button></form><form data-manage-evidence-text data-case-wallet="${escape(item.wallet)}"><h4>Write your attendance evidence</h4><p>Describe why you attended. Only the challenged wallet, recorded case organizer or matcher can prepare evidence here; connecting alone gives no permission. Review checks access and sends this text to the app for storage. Only a separate Publish approval uploads it to public IPFS, where copies may remain permanently. Court submission is another reviewed transaction.</p><label>Evidence title<input name="title" required maxlength="100" value="${escape(input.title)}" placeholder="Attendance at this event"></label><label>Attendance evidence<textarea name="description" required maxlength="8000" rows="5" placeholder="Explain what happened and how your evidence supports attendance.">${escape(input.description)}</textarea></label><label>Already published attachment URI (optional)<input name="attachmentURI" maxlength="2048" value="${escape(input.attachmentURI)}" placeholder="/ipfs/CID/photo" autocomplete="off"></label><p class="field-help">This form does not upload attachments. Use an attachment already published on IPFS, or leave it blank. Attachment availability is not verified by checking this document. Avoid private contact details.</p><button type="submit" class="button button-primary">Review exact evidence document</button></form><details><summary>Use an already published evidence document</summary><form data-manage-evidence-form data-case-wallet="${escape(item.wallet)}"><label>Published evidence URI<input name="uri" required maxlength="4096" placeholder="/ipfs/CID/evidence.json" autocomplete="off"></label><button type="submit" class="button button-secondary">Review evidence submission</button></form></details>` : ""}
        ${matched || challenge.state === 3 ? `<details class="luma-court-advanced"><summary>Court deadlines, appeals &amp; rewards</summary><p>Every action checks the actual Court period, final ruling and contribution records before a transaction is prepared. A provisional vote is not final settlement.</p>${courtIDs ? "" : '<p class="field-help">Court IDs are unavailable in this snapshot. Review the exact case document to load canonical IDs before using these actions.</p>'}<div class="button-row">${["passPeriod", "deliverRuling", "appealRewards"].map(action => `<button type="button" class="button button-secondary" data-manage-action="${action}" data-manage-target="${escape(item.wallet)}" ${courtIDs ? "" : "disabled data-manage-unavailable"}>${escape(names[action])}</button>`).join("")}</div><form data-manage-appeal-form data-case-wallet="${escape(item.wallet)}"><label>Appeal side<select name="side"><option value="1">Attended</option><option value="2">Absent</option><option value="0">Refused</option></select></label><label>Contribution in ETH<input name="amount" required inputmode="decimal" placeholder="Exact ETH contribution"></label><button type="submit" class="button button-secondary" ${courtIDs ? "" : "disabled data-manage-unavailable"}>Review appeal contribution</button></form></details>` : ""}</article>`;
      }).join("") : ""}`;
    participant.querySelectorAll("button").forEach(button => { button.disabled = button.hasAttribute("data-manage-unavailable") || busy || Boolean(receipt); });
    for (const card of participant.querySelectorAll("[data-manage-case]")) [...card.querySelectorAll("details")].forEach((node, index) => { if (expanded.has(card.dataset.manageCase + ":" + index)) node.open = true; });
  }
  const changed = () => {
    // An obsolete read must not keep the new wallet waiting or unlock a newer
    // permission read when its old response eventually arrives.
    if (permissionLoadRevision === revision) { permissionLoadRevision = null; busy = false; }
    revision++; forgetWalletProvider(root.ownerDocument); authenticated = false; needsSignIn = false; policy = context = draft = reviewed = access = null; selected.clear(); wallet = null;
    artifactReview = null; documents.clear(); evidenceInputs.clear();
    if (dialog.open) dialog.close(); dialog.replaceChildren(); connectButton.hidden = false; label.textContent = "";
    paintPending(null); onWallet(null); update();
  };
  async function connected(selectedProvider, account, captured, restored = null) {
    if (!current(captured)) return;
    provider?.removeListener?.("accountsChanged", changed); provider?.removeListener?.("chainChanged", changed); provider?.removeListener?.("disconnect", changed);
    provider = selectedProvider; wallet = account; authenticated = false; policy = context = access = null; needsSignIn = false;
    provider.on?.("accountsChanged", changed); provider.on?.("chainChanged", changed); provider.on?.("disconnect", changed);
    if (restored && !restored.valid()) { changed(); return; }
    connectButton.hidden = true; label.textContent = `Connected · ${wallet}`; onWallet(wallet); update();
    const { journal } = await services();
    if (current(captured)) { paintPending(pendingFromStorage(journal)); if (accessEnabled) await loadAccess(false); }
  }
  async function connect() {
    const captured = ++revision; connectButton.disabled = true;
    try {
      const selectedProvider = await chooseWalletProvider({ ownerDocument: root.ownerDocument, signal: abort.signal, isCurrent: () => current(captured) });
      if (!selectedProvider) return;
      const accounts = await selectedProvider.request({ method: "eth_requestAccounts" });
      if (!current(captured)) return;
      if (!address(accounts?.[0])) fail("Choose a wallet account.");
      rememberWalletProvider(selectedProvider, root.ownerDocument);
      await connected(selectedProvider, accounts[0], captured);
    } catch (error) { say(error.message); }
    finally { if (current()) connectButton.disabled = false; }
  }
  async function privateScope(captured, allowPending = false, allowSignIn = true) {
    if (!wallet || !provider) fail("Connect your wallet first. Signing in happens only when you review an action.");
    const s = await services();
    const checkedPolicy = await s.eventWalletContext({ api, signal: abort.signal, isCurrent: () => current(captured), instanceId: getSnapshot()?.instanceId ?? null });
    if (!current(captured)) fail("The selected wallet or event changed.");
    policy = checkedPolicy;
    context = Object.freeze({ eventId: EVENT.id, wallet, chainId: 1, contract: EVENT.contract, abiVersion: EVENT.abiVersion, mode: EVENT.mode, instanceId: policy.instanceId });
    const pending = pendingFromStorage(s.journal); paintPending(pending);
    if (pending && !allowPending) fail("Check the original wallet request or transaction before preparing another action.");
    if (!authenticated) {
      const metadata = await api("/api/kickback-setup", { signal: abort.signal });
      if (!current(captured)) fail("The selected wallet or event changed during sign-in.");
      if (metadata?.kind !== "kickback-setup-display" || metadata.mode !== EVENT.mode || metadata.instanceId !== context.instanceId) fail("The sign-in server changed. Refresh the saved list.");
      authenticated = metadata.session?.mode === "wallet" && same(metadata.session.wallet, wallet);
    }
    if (!authenticated) {
      if (!allowSignIn) throw Object.assign(Error("Sign in to load your event permissions. The signature does not send a transaction."), { code: "SIGN_IN_REQUIRED" });
      say("Sign in to review this action. The signature does not send a transaction.");
      const challenge = await api("/api/auth/challenge", { method: "POST", body: JSON.stringify({ wallet }), signal: abort.signal });
      if (!current(captured)) fail("The selected wallet changed before sign-in.");
      if (typeof challenge?.message !== "string" || !challenge.message.length || typeof challenge.nonce !== "string") fail("The sign-in challenge is unavailable.");
      await s.assertV10WalletAccount({ provider, wallet, bootstrap: policy });
      if (!current(captured)) fail("The selected wallet changed before sign-in.");
      const message = "0x" + [...new TextEncoder().encode(challenge.message)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const signature = await provider.request({ method: "personal_sign", params: [message, wallet] });
      if (!current(captured)) fail("The selected wallet changed during sign-in.");
      const verified = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ nonce: challenge.nonce, signature }), signal: abort.signal });
      if (!current(captured)) fail("The selected wallet changed during sign-in.");
      if (!same(verified?.wallet, wallet)) fail("The sign-in response belongs to another wallet.");
      authenticated = true;
    }
    if (!current(captured)) fail("The selected wallet or event changed.");
    return s;
  }
  const job = (s, operation, payload, captured, original = context, signal = abort.signal) => s.eventReadJob({ api, operation, payload: { eventId: EVENT.id, ...payload },
    expectedContext: EVENT, instanceId: original.instanceId, wallet: original.wallet, signal,
    isCurrent: () => current(captured) && same(wallet, original.wallet), onPending: () => say("Checking current permissions and contract state…") });
  function openReview(value, action, params, captured, expectedCase = null) {
    artifactReview = null; draft = value; reviewed = { action, params: structuredClone(params), captured, context, policy, expectedCase };
    dialog.innerHTML = `<h2>${escape(names[action])}</h2><p>${escape(value.summary)}</p><dl class="details-list"><div><dt>Event contract</dt><dd class="mono">${EVENT.contract}</dd></div><div><dt>Signing wallet</dt><dd class="mono">${escape(wallet)}</dd></div><div><dt>ETH sent</dt><dd>${eth(value.valueWei)} ETH</dd></div>${action === "transferOwnership" ? `<div><dt>New event owner</dt><dd class="mono">${escape(value.args[0])}</dd></div>` : action === "acceptOwnership" ? `<div><dt>New event owner</dt><dd class="mono">${escape(wallet)}</dd></div>` : ""}${action === "withdrawPending" ? `<div><dt>Unused deposit returned</dt><dd>${eth(value.args[1])} ETH</dd></div><div><dt>Return to your wallet</dt><dd class="mono">${escape(value.args[0])}</dd></div>` : ""}</dl>
      ${action === "postAttendance" || action === "register" ? `<p>Exact reviewed wallets:</p><ul>${value.args[0].map(item => `<li class="mono">${escape(item)}</li>`).join("")}</ul>` : ""}
      ${caseActions.has(action) ? `<p>Transaction target: <span class="mono">${escape(value.transaction.to)}</span></p><p>Resolver local ID: ${escape(expectedCase.localId)}${wei(expectedCase.arbitratorId) ? ` · Court dispute ID: ${escape(expectedCase.arbitratorId)}` : ""}</p>${action === "evidence" ? `<p class="mono">Evidence URI: ${escape(params.uri)}</p><p>This transaction references your published document. It does not upload files.</p>` : ""}` : ""}
      <p>${action === "match" ? "This separate payment opens a real Kleros case on Ethereum Mainnet." : "Confirm this exact contract action in your wallet."}</p><div class="button-row"><button type="button" class="button button-primary" data-manage-confirm>Confirm in wallet</button><button type="button" class="button button-secondary" data-manage-close>Close</button></div>`;
    dialog.showModal();
  }
  async function prepare(action, params, adoption = null) {
    if (busy) return;
    if (["register", "postAttendance", "transferOwnership"].includes(action) && currentAccess()?.role !== "owner" ||
        action === "acceptOwnership" && currentAccess()?.role !== "pending-owner") { say("Load event permissions for the wallet authorized to review this action."); return; }
    const captured = revision; busy = true; update(); say("Checking current permissions and contract state…");
    try {
      if (action === "match" && documents.get("case:" + params.wallet.toLowerCase())?.publication.status !== "verified") fail("Publish and verify the exact Court case document before reviewing matching.");
      const expectedCase = caseActions.has(action) ? caseBinding(params.wallet) : null;
      const s = await privateScope(captured);
      if (adoption) {
        const result = await job(s, "adopt-payer", adoption, captured);
        if (!current(captured) || result?.kind !== "owner-reviewed-payer" || result.eventId !== EVENT.id || result.chainId !== 1 ||
            !same(result.contract, EVENT.contract) || !same(result.wallet, adoption.wallet) || !stable(result.participantId)) fail("The canonical payer review changed.");
        await api(`/api/events/${encodeURIComponent(EVENT.id)}/participants/${encodeURIComponent(result.participantId)}`, { method: "PATCH", body: JSON.stringify({ admission: "approved" }), signal: abort.signal });
      }
      const value = await job(s, ["register", "postAttendance", "transferOwnership", "acceptOwnership"].includes(action) ? "manage-draft" : "participant-draft", { action, params }, captured);
      if (!current(captured)) return;
      assertFirstEventManageDraft(value, context, action, params, location.origin, EVENT, expectedCase); openReview(value, action, params, captured, expectedCase); say("Review the exact transaction before confirming in your wallet.");
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
      const s = await services(); assertFirstEventManageDraft(value, original, review.action, review.params, location.origin, EVENT, review.expectedCase);
      if (pendingFromStorage(s.journal)) fail("Reconcile the original wallet request before another send.");
      const guarded = { request: async request => {
        if (request.method === "eth_sendTransaction") {
          await s.assertV10WalletAccount({ provider, wallet: original.wallet, bootstrap: review.policy });
          if (!current(captured) || !same(wallet, original.wallet)) fail("The signing wallet changed.");
          assertFirstEventManageDraft(value, original, review.action, review.params, location.origin, EVENT, review.expectedCase);
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
    else if (target.matches("[data-manage-case-document]")) void reviewDocument(target.dataset.manageCaseDocument, "case");
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
  const dialogClick = event => {
    if (event.target.closest?.("[data-manage-document-publish]")) void documentAction(true);
    else if (event.target.closest?.("[data-manage-document-availability]")) void documentAction(false);
    else if (!busy && event.target.closest?.("[data-manage-document-submit]") && artifactReview?.kind === "evidence" && artifactReview.publication.status === "verified") {
      const item = artifactReview; artifactReview = null; dialog.close(); void prepare("evidence", { wallet: item.artifact.scope.wallet, uri: item.artifact.uri });
    } else if (!busy && event.target.closest?.("[data-manage-document-attach]") && artifactReview?.kind === "file" && artifactReview.publication.status === "verified") {
      const item = artifactReview, key = item.artifact.scope.wallet.toLowerCase(), input = evidenceInputs.get(key) ?? { title: "", description: "", attachmentURI: "" };
      evidenceInputs.set(key, { ...input, attachmentURI: item.artifact.uri }); artifactReview = null; dialog.close(); update(); say("Verified attachment added to the evidence form. Review and publish the evidence document separately, then review its Court transaction.");
    } else if (!busy && event.target.closest?.("[data-manage-document-close]")) { artifactReview = null; dialog.close(); }
    else if (event.target.closest?.("[data-manage-confirm]")) void execute();
    else if (!busy && event.target.closest?.("[data-manage-close]")) { draft = reviewed = null; dialog.close(); }
  };
  const dialogCancel = event => { if (busy) event.preventDefault(); else { draft = reviewed = null; artifactReview = null; } };
  // Delegation includes the surrounding saved-receipt table without moving it.
  const owner = root.closest("[data-first-event-display]") ?? root;
  owner.addEventListener("click", click); owner.addEventListener("change", selection);
  const formSubmit = event => {
    if (event.target.matches("[data-manage-file-form]")) {
      event.preventDefault(); void reviewFile(event.target.querySelector("input[type=file]").files?.[0], event.target.dataset.caseWallet); return;
    }
    if (event.target.matches("[data-manage-evidence-text]")) {
      event.preventDefault(); const fields = new FormData(event.target), target = event.target.dataset.caseWallet;
      const input = { title: String(fields.get("title") ?? "").trim(), description: String(fields.get("description") ?? "").trim(), attachmentURI: String(fields.get("attachmentURI") ?? "").trim() };
      if (!input.title || !input.description || input.attachmentURI && !ipfsURI(input.attachmentURI)) { say("Enter your evidence text and an optional already-published IPFS attachment URI."); return; }
      evidenceInputs.set(target.toLowerCase(), input); void reviewDocument(target, "evidence", input); return;
    }
    if (event.target.matches("[data-manage-evidence-form]")) {
      event.preventDefault(); const uri = String(new FormData(event.target).get("uri") ?? "").trim();
      if (!ipfsURI(uri)) { say("Use an already published /ipfs/ evidence URI without queries or traversal."); return; }
      void prepare("evidence", { wallet: event.target.dataset.caseWallet, uri }); return;
    }
    if (event.target.matches("[data-manage-appeal-form]")) {
      event.preventDefault(); const fields = new FormData(event.target), amount = String(fields.get("amount") ?? "").trim(), side = Number(fields.get("side"));
      if (!/^(0|[1-9][0-9]{0,59})(\.[0-9]{1,18})?$/.test(amount) || ![0, 1, 2].includes(side)) { say("Enter an exact positive ETH amount with at most 18 decimal places."); return; }
      const [whole, fraction = ""] = amount.split("."), amountWei = String(BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0")));
      if (!wei(amountWei) || BigInt(amountWei) <= 0n) { say("Enter a positive appeal contribution within the supported amount."); return; }
      void prepare("fundAppeal", { wallet: event.target.dataset.caseWallet, side, amountWei }); return;
    }
    if (event.target.matches("[data-manage-attendance]")) return attendance(event);
    if (!event.target.matches("[data-manage-access-form],[data-manage-transfer-form]")) return;
    event.preventDefault();
    const fields = new FormData(event.target);
    if (event.target.matches("[data-manage-access-form]")) void changeAccess(String(fields.get("role")), String(fields.get("wallet") ?? "").trim(), true);
    else if (address(String(fields.get("to") ?? "").trim())) void prepare("transferOwnership", { to: String(fields.get("to")).trim() });
  };
  const evidenceInput = event => {
    const form = event.target.closest?.("[data-manage-evidence-text]"); if (!form) return;
    const values = new FormData(form); evidenceInputs.set(form.dataset.caseWallet.toLowerCase(), { title: String(values.get("title") ?? ""), description: String(values.get("description") ?? ""), attachmentURI: String(values.get("attachmentURI") ?? "") });
  };
  root.addEventListener("submit", formSubmit);
  root.addEventListener("input", evidenceInput);
  dialog.addEventListener("click", dialogClick); dialog.addEventListener("cancel", dialogCancel);
  update();
  const restoreRevision = revision;
  void restoreWalletProvider({ ownerDocument: root.ownerDocument, signal: abort.signal, isCurrent: () => current(restoreRevision) })
    .then(async restored => {
      if (!restored) return;
      try { if (restored.valid() && current(restoreRevision)) await connected(restored.provider, restored.wallet, restoreRevision, restored); }
      finally { restored.release(); }
    })
    .catch(error => { if (current(restoreRevision)) say(error.message); });
  return Object.freeze({ update, dispose() {
    disposed = true; revision++; abort.abort(); owner.removeEventListener("click", click); owner.removeEventListener("change", selection);
    provider?.removeListener?.("accountsChanged", changed); provider?.removeListener?.("chainChanged", changed); provider?.removeListener?.("disconnect", changed);
    root.removeEventListener("submit", formSubmit); root.removeEventListener("input", evidenceInput); dialog.removeEventListener("click", dialogClick); dialog.removeEventListener("cancel", dialogCancel); dialog.remove();
  } });
}
