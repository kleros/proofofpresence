// Cross-document coordination only. Durable intents/journals remain authoritative
// after a document closes; a released browser lock never clears those records.
import { EVENT } from "./first-event/event.js";

const leases = new WeakMap();
const fail = (message, code) => { throw Object.assign(new Error(message), { code }); };
function scopeKey({ wallet, event = EVENT, origin = location.origin }) {
  if (!/^0x[0-9a-f]{40}$/i.test(wallet ?? "") || /^0x0{40}$/i.test(wallet) ||
      !/^0x[0-9a-f]{40}$/i.test(event?.contract ?? "") ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(event?.id ?? "") || event.chainId !== 1 || event.mode !== "hosted-production" ||
      typeof origin !== "string" || new URL(origin).origin !== origin)
    fail("Connect the intended event wallet before continuing.", "DEPOSIT_OWNERSHIP_SCOPE");
  // Web Locks are already origin-isolated. Include the origin explicitly and
  // omit instance/draft IDs so a backend restart cannot create a second seat.
  return "kleros-deposit-ownership-v1:" + JSON.stringify([
    origin, event.mode, event.chainId, event.id, event.contract.toLowerCase(), wallet.toLowerCase(),
  ]);
}
export function assertDepositOwnership(ownership, scope) {
  if (!ownership || leases.get(ownership) !== scopeKey(scope))
    fail("This deposit request no longer owns its payment slot. Check the original request.", "DEPOSIT_OWNERSHIP_LOST");
  return ownership;
}

/**
 * @param {{wallet:string,event?:any,origin?:string,locks?:any,isCurrent?:()=>boolean}} options
 * @returns {Promise<any>}
 */
export async function acquireDepositOwnership({ wallet, event = EVENT, origin = location.origin,
  locks = globalThis.navigator?.locks, isCurrent = () => true }) {
  const key = scopeKey({ wallet, event, origin });
  if (!locks || typeof locks.request !== "function")
    fail("This browser cannot safely coordinate app payments. Use a current browser or the manual QR/address option. No wallet transaction was requested.", "DEPOSIT_OWNERSHIP_UNAVAILABLE");
  if (!isCurrent()) fail("The wallet or page changed. Connect again.", "DEPOSIT_OWNERSHIP_STALE");
  let grant, deny, unlock;
  const acquired = new Promise((resolve, reject) => { grant = resolve; deny = reject; });
  const released = new Promise(resolve => { unlock = resolve; });
  let ownership = null, finished;
  finished = Promise.resolve().then(() => locks.request(key, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) fail("Another tab is preparing or sending this deposit. Finish or check that original request before trying again.", "DEPOSIT_REQUEST_BUSY");
    if (!isCurrent()) fail("The wallet or page changed. Connect again.", "DEPOSIT_OWNERSHIP_STALE");
    ownership = Object.freeze({ nonce: crypto.randomUUID(), release() {
      if (leases.has(ownership)) { leases.delete(ownership); unlock(); }
      return finished;
    } });
    leases.set(ownership, key); grant(ownership);
    await released;
  })).catch(error => {
    if (ownership) leases.delete(ownership);
    deny(error);
  });
  return acquired;
}
