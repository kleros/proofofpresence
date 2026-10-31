// Saved references control presentation only. They never authorize a transaction.
import { EVENT } from "./event.js";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const hash = value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const address = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const amount = value => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const stable = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
export function recordedDepositReference({ storage, journal, wallet, event = EVENT, origin = location.origin }) {
  if (!address(wallet) || !Number.isSafeInteger(storage.length) || storage.length > 4096)
    throw Error("Saved transaction storage is unavailable. Preserve your original transaction ID.");
  const references = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    const intent = key?.startsWith("kleros-first-event-intent:v1:");
    const prefix = intent ? "kleros-first-event-intent:v1:" : "kleros-transactions:v1:";
    if (!key?.startsWith(prefix)) continue;
    let parts;
    try { parts = key.slice(prefix.length).split(":").map(decodeURIComponent); } catch { continue; }
    if (intent && parts.shift() !== origin) continue;
    const [instanceId, mode, eventId, chainId, contract, owner, abiVersion] = parts;
    if (parts.length !== 7 || !stable(instanceId) || mode !== event.mode || eventId !== event.id ||
        chainId !== String(event.chainId) || !same(contract, event.contract) || !same(owner, wallet) || abiVersion !== event.abiVersion) continue;
    const context = { instanceId, mode, eventId, chainId: event.chainId, contract, wallet: owner, abiVersion };
    if (intent) {
      let held;
      try { held = JSON.parse(storage.getItem(key)); } catch { throw Error("Your wallet request record is unreadable. Preserve storage and check the original wallet activity."); }
      if (held?.phase !== "awaiting-wallet" || typeof held.draftId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(held.draftId))
        throw Error("Your wallet request record is invalid. Preserve storage and check the original wallet activity.");
      references.push({ status: "awaiting-wallet", context, draftId: held.draftId });
      continue;
    }
    for (const entry of journal.list(context)) {
      if (entry.action !== "deposit" || entry.status === "failed") continue;
      if (entry.status === "confirmed" && (!integer(entry.blockNumber) || entry.blockNumber === 0)) continue;
      references.push({ hash: entry.hash, status: entry.status === "confirmed" ? "confirmed" : "submitted", context,
        draftId: entry.draftId, blockNumber: entry.blockNumber ?? 0, submittedAt: entry.submittedAt ?? 0 });
    }
  }
  // An unknown original wallet request always takes precedence over old history.
  return references.find(item => item.status === "awaiting-wallet") ?? references.find(item => item.status === "submitted") ??
    references.sort((a, b) => b.blockNumber - a.blockNumber || b.submittedAt - a.submittedAt)[0] ?? null;
}
export function savedDepositReference(data, wallet, event = EVENT) {
  if (!address(wallet) || data?.schemaVersion !== 1 || data.kind !== "first-event-depositors" || data.displayOnly !== true ||
      data.mode !== event.mode || !stable(data.instanceId) || data.eventId !== event.id || data.chainId !== event.chainId ||
      !same(data.contract, event.contract) || !["current", "stale"].includes(data.status) ||
      !Number.isFinite(Date.parse(data.checkedAt)) || Date.parse(data.checkedAt) > Date.now() + 5000 ||
      !integer(data.blockNumber) || data.blockNumber === 0 || !hash(data.blockHash) ||
      !Array.isArray(data.depositors) || data.depositors.length > 1000 ||
      ["permissions", "capabilities", "session", "deploymentTrust", "actionable"].some(key => Object.hasOwn(data, key)))
    throw Error("The saved deposit receipts belong to another event or are unavailable.");
  const wallets = new Set(), receipts = new Set();
  let found = null, count = 0;
  for (const row of data.depositors) {
    if (!address(row.wallet) || wallets.has(row.wallet.toLowerCase()) || !amount(row.totalReceivedWei) ||
        !Array.isArray(row.deposits) || !row.deposits.length || (count += row.deposits.length) > 2000)
      throw Error("The saved deposit receipts are incomplete.");
    wallets.add(row.wallet.toLowerCase());
    let total = 0n, latest = null;
    for (const lot of row.deposits) {
      const key = `${lot.txHash}:${lot.logIndex}`.toLowerCase();
      if (!hash(lot.txHash) || !hash(lot.blockHash) || !integer(lot.blockNumber) || lot.blockNumber > data.blockNumber ||
          !integer(lot.logIndex) || !amount(lot.amountWei) || receipts.has(key)) throw Error("The saved deposit receipts are incomplete.");
      receipts.add(key); total += BigInt(lot.amountWei);
      if (!latest || lot.blockNumber > latest.blockNumber || (lot.blockNumber === latest.blockNumber && lot.logIndex > latest.logIndex)) latest = lot;
    }
    if (total !== BigInt(row.totalReceivedWei)) throw Error("The saved deposit totals do not match their receipts.");
    if (same(row.wallet, wallet) && total >= BigInt(event.depositWei)) found = { hash: latest.txHash, status: "recorded", instanceId: data.instanceId };
  }
  return found;
}
