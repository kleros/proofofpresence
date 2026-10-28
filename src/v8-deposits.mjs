// v8 collateral is payer-owned credit, consumed by admission or withdrawal.
// Replay its explicit events instead of applying v7's aggregate spare-money rules.
import { lower, requireThat } from "./utils.mjs";
import { getLogsChunked } from "../references/kickback/scripts/lib.mjs";

/** @param {any} contract @param {any} deployment @param {number | "latest"} [blockTag]
 * @param {{signal?: AbortSignal}} [options]
 */
export async function v8DepositCredits(
  contract,
  deployment,
  blockTag = "latest",
  { signal } = {},
) {
  signal?.throwIfAborted();
  const provider = contract.runner.provider ?? contract.runner;
  const end =
    blockTag === "latest" ? await provider.getBlockNumber() : blockTag;
  signal?.throwIfAborted();
  const logProvider = signal
    ? {
        getLogs(filter) {
          signal.throwIfAborted();
          return provider.getLogs(filter);
        },
      }
    : provider;
  const logs = await getLogsChunked(
    logProvider,
    { address: contract.target },
    deployment.deploymentBlock,
    end,
    5000,
    signal ? { retries: 0, minStep: 5000 } : undefined,
  );
  signal?.throwIfAborted();
  const wallets = new Map();
  const entry = (wallet) => {
    const key = lower(wallet);
    if (!wallets.has(key))
      wallets.set(key, { wallet, lots: [], committed: [] });
    return wallets.get(key);
  };
  const consume = (person, amount, commit = false) => {
    let remaining = amount;
    for (const lot of person.lots) {
      const used = lot.pending < remaining ? lot.pending : remaining;
      lot.pending -= used;
      if (commit && used) {
        lot.committed += used;
        person.committed.push({ lot, amount: used });
      }
      remaining -= used;
      if (!remaining) break;
    }
    requireThat(
      remaining === 0n,
      "v8 credit history is incomplete",
      "CREDIT_HISTORY",
      409,
    );
  };
  const retire = (person) => {
    for (const item of person.committed) item.lot.committed -= item.amount;
    person.committed = [];
  };
  for (const log of logs.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.index - b.index,
  )) {
    signal?.throwIfAborted();
    let event;
    try {
      event = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (!event) continue;
    const a = event.args;
    if (event.name === "Deposited")
      entry(a.from).lots.push({
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        amount: a.amount,
        pending: a.amount,
        committed: 0n,
      });
    if (event.name === "PendingWithdrawn") consume(entry(a.payer), a.amount);
    if (event.name === "StakerRegistered")
      consume(entry(a.staker), BigInt(deployment.depositWei), true);
    if (event.name === "Rejected") {
      const person = entry(a.wallet);
      if (person.committed.length) retire(person);
      else consume(person, a.refunded);
    }
    if (event.name === "EmergencyWithdrawn") retire(entry(a.staker));
    if (event.name === "Cancelled")
      for (const person of wallets.values()) retire(person);
  }
  return wallets;
}
