import { EVENT } from "./event.js";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const uint = value => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const fail = () => { throw Error("The deposit changed or belongs to another wallet. Try again before confirming in your wallet."); };

// Current-contract checks are deliberately distinct from the full historical
// verification. MetaMask is the review screen; the sender/journal remain shared.
export function assertDirectDepositDraft(draft, scope, origin = location.origin) {
  const c = draft?.directDepositContext;
  if (!scope || c?.kind !== "direct-deposit-v1" || c.eventId !== EVENT.id || c.chainId !== 1 ||
      c.origin !== origin || c.instanceId !== scope.instanceId || !same(c.wallet, scope.wallet) ||
      !same(c.contract, EVENT.contract) || c.depositWei !== EVENT.depositWei ||
      !uint(c.pendingCreditWei) || !uint(c.amountWei) || BigInt(c.amountWei) <= 0n ||
      BigInt(c.pendingCreditWei) >= BigInt(EVENT.depositWei) ||
      BigInt(c.amountWei) !== BigInt(EVENT.depositWei) - BigInt(c.pendingCreditWei) ||
      !Number.isSafeInteger(c.blockNumber) || c.blockNumber <= 0 || !/^0x[0-9a-f]{64}$/i.test(c.blockHash ?? "") ||
      typeof c.snapshot !== "string" || !c.snapshot ||
      draft.eventId !== EVENT.id || draft.chainId !== 1 || draft.mode !== EVENT.mode ||
      draft.abiVersion !== EVENT.abiVersion || draft.contractVersion !== EVENT.abiVersion ||
      draft.origin !== origin || draft.instanceId !== scope.instanceId || !same(draft.wallet, scope.wallet) ||
      !same(draft.contract, EVENT.contract) || draft.action !== "deposit" || draft.method !== "deposit" ||
      !Array.isArray(draft.args) || draft.args.length !== 0 || draft.valueWei !== c.amountWei ||
      draft.snapshot !== c.snapshot || draft.reviewBlock !== c.blockNumber ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(draft.id ?? "") || !Number.isSafeInteger(draft.expiresAt) || Date.now() >= draft.expiresAt)
    fail();
  const tx = draft.transaction;
  if (!same(tx?.from, scope.wallet) || !same(tx?.to, EVENT.contract) || Number(tx?.chainId) !== 1 ||
      tx.data?.toLowerCase() !== "0xd0e30db0" || String(tx.value) !== c.amountWei) fail();
  return draft;
}
