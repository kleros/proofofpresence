// A connected address is not an authenticated organizer. These opaque scopes
// can prepare only a public deposit or a new public event, never private actions.
const PROFILE = "kleros-event-v10-uups";
import { EVENT, LEGACY_EVENT } from "./first-event/event.js";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const stable = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const fail = (message, code = "PUBLIC_TRANSACTION_SCOPE") => { throw Object.assign(Error(message), { code }); };
const storageKey = (wallet, kind) => "kleros-public-transaction-v1:" + JSON.stringify([
  location.origin, kind, wallet.toLowerCase(),
  ...(kind === "deposit" && EVENT.id !== LEGACY_EVENT.id ? [EVENT.id, EVENT.contract.toLowerCase()] : []),
]);
export function resetCompletedPublicTransactionFlow({ wallet, kind, token = null, hash = null }) {
  const key = storageKey(wallet, kind);
  const saved = JSON.parse(localStorage.getItem(key) ?? "null");
  if (saved && (token ? saved.token !== token : !hash || !same(saved.hash, hash))) fail("The saved transaction flow changed.");
  localStorage.removeItem(key);
}
export function resetUnusedPublicTransactionFlow({ wallet, kind }) {
  const key = storageKey(wallet, kind);
  const saved = JSON.parse(localStorage.getItem(key) ?? "null");
  if (saved?.hash) fail("Keep the original transaction ID before starting another request.");
  localStorage.removeItem(key);
}

export async function createPublicTransactionFlow({ api, wallet, kind, contract = null, isCurrent = () => true, signal = undefined }) {
  if (!/^0x[0-9a-f]{40}$/i.test(wallet ?? "") || !["deposit", "create"].includes(kind)) fail("Connect your wallet first.");
  const current = () => { if (signal?.aborted || !isCurrent()) fail("The wallet or page changed. Connect again."); };
  const key = storageKey(wallet, kind);
  current(); let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) ?? "null"); }
  catch { fail("Saved wallet activity is unavailable. Keep any original transaction ID."); }
  const call = (path, options = {}) => api(path, { credentials: "omit", ...options });
  let info;
  if (saved) {
    if (!/^[0-9a-f]{64}$/.test(saved.token ?? "") || saved.kind !== kind || !same(saved.wallet, wallet)) fail("Saved wallet activity needs checking.");
    try { info = await call(`/api/public-transactions/${saved.token}`, { signal }); }
    catch (error) {
      // Never silently replace an expired original flow after a possible send.
      if (saved.hash) fail("Keep your transaction ID and use deposit recovery to check it.", "PUBLIC_TRANSACTION_EXPIRED");
      if (!["PUBLIC_TRANSACTION_EXPIRED", "PUBLIC_FLOW_NOT_FOUND", "NOT_FOUND"].includes(error.code) && error.status !== 404) throw error;
      localStorage.removeItem(key); saved = null;
    }
  }
  if (!info) info = await call("/api/public-transactions", { method: "POST", body: JSON.stringify({ wallet, kind }), signal });
  current();
  if (info?.kind !== "public-transaction-flow" || info.flowKind !== kind || info.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(info.token ?? "") ||
      !same(info.wallet, wallet) || info.mode !== "hosted-production" || info.chainId !== 1 || !stable(info.instanceId) ||
      info.contractVersion !== PROFILE || (saved && (info.token !== saved.token || info.instanceId !== saved.instanceId)) ||
      (kind === "deposit" && (info.eventId !== EVENT.id || !same(info.contract ?? info.target, EVENT.contract))) ||
      (contract && !same(info.contract ?? info.target, contract))) fail("The transaction belongs to another wallet, event or network.");
  const walletContext = info.walletContext;
  if (walletContext?.mode !== "hosted-production" || walletContext.instanceId !== info.instanceId ||
      walletContext.chain?.chainId !== 1 || walletContext.contractVersion !== PROFILE || walletContext.abiVersion !== PROFILE ||
      walletContext.capabilities?.transactionsReady !== false || walletContext.capabilities.createEvents !== false ||
      walletContext.capabilities.manageEvents !== false) fail("The wallet transaction context is unavailable.");
  saved = { kind, wallet, token: info.token, instanceId: info.instanceId, ...(saved?.hash ? { hash: saved.hash } : {}) };
  const persist = () => { const value = JSON.stringify(saved); localStorage.setItem(key, value); if (localStorage.getItem(key) !== value) fail("The browser could not retain your transaction activity."); };
  persist();
  const prefix = `/api/public-transactions/${info.token}`;
  const scopedApi = async (path, options = {}) => {
    let target;
    if (path === "/api/direct-deposit") target = prefix + "/direct-deposit";
    else if (path === "/api/direct-deposit/prepare") target = prefix + "/direct-deposit/prepare";
    else if (path === "/api/direct-deposit/validate") target = prefix + "/direct-deposit/validate";
    else if (/^\/api\/event-read-jobs(?:\/[A-Za-z0-9_-]+)?$/.test(path)) target = prefix + path.slice(4);
    else if (/^\/api\/organizer\/events\/jobs(?:\/[A-Za-z0-9_-]+)?$/.test(path)) target = prefix + "/organizer-jobs" + path.slice("/api/organizer/events/jobs".length);
    else {
      const matched = /^\/api\/(?:events\/[^/]+\/drafts|organizer\/events\/drafts)\/([A-Za-z0-9_-]+)\/submitted$/.exec(path);
      if (!matched) fail("This wallet connection cannot access private event actions.");
      const body = JSON.parse(options.body ?? "{}");
      if (!/^0x[0-9a-f]{64}$/i.test(body.hash ?? "") || (saved.hash && !same(saved.hash, body.hash))) fail("Keep the original transaction ID before continuing.");
      saved.hash = body.hash; persist();
      target = prefix + "/submitted";
      options = { ...options, body: JSON.stringify({ draftId: matched[1], hash: body.hash }) };
    }
    return call(target, options);
  };
  return Object.freeze({ ...info, walletContext, api: scopedApi });
}
