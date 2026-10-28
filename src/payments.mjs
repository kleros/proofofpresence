// @ts-check
import { verifyDeployment } from "./chain.mjs";
import { lower, requireThat } from "./utils.mjs";
import { getLogsChunked } from "../references/kickback/scripts/lib.mjs";

/**
 * An explicit log-backed payment projection for the preserved v7 contract.
 *
 * attendancePaidWei means successful Payout events from attendance settlement,
 * including late held-share top-ups. It EXCLUDES later claims of fungible owed
 * credit: a Claim may combine attendance, principal and challenge credits.
 * principalRefundedWei includes successful registered cancellation/rejection/
 * no-list refunds and unregistered rejectAndRefund returns, with subsets below.
 * PayoutFailed is credit creation, never a completed transfer. claimedWei is
 * reported separately and must not be added to direct attendance paid as though
 * every claimed wei came from an attendance entitlement.
 *
 * Successful challenge reimbursements/remainders and arbitration/appeal payments
 * are not fully logged as Payout by v7. This is deliberately NOT a complete ETH
 * transfer history and never estimates transfers from pool minus balance.
 *
 * @param {any} chain
 * @param {any} record
 * @param {{blockTag?: number | "latest", signal?: AbortSignal}} [options]
 */
export async function projectPayments(
  chain,
  record,
  { blockTag = "latest", signal } = {},
) {
  signal?.throwIfAborted();
  const d = record.deployment;
  const contract = await verifyDeployment(chain, d);
  signal?.throwIfAborted();
  const block = await chain.provider.getBlock(blockTag);
  signal?.throwIfAborted();
  requireThat(
    block && block.number >= d.deploymentBlock,
    "Payment projection requires a canonical block after deployment",
    "PAYMENT_SNAPSHOT",
    409,
  );
  const logProvider = signal
    ? {
        getLogs(filter) {
          signal.throwIfAborted();
          return chain.provider.getLogs(filter);
        },
      }
    : chain.provider;
  const logs = await getLogsChunked(
    logProvider,
    { address: d.contract },
    d.deploymentBlock,
    block.number,
    5000,
    signal ? { retries: 0, minStep: 5000 } : undefined,
  );
  signal?.throwIfAborted();
  const ordered = logs
    .map((log) => {
      let event;
      try {
        event = contract.interface.parseLog(log);
      } catch {
        return null;
      }
      return event ? { log, event } : null;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.log.blockNumber - b.log.blockNumber || a.log.index - b.log.index,
    );
  /** @type {Map<string, {receipt: any, names: Set<string>, method: string | null}>} */
  const receipts = new Map();
  const paymentNames = new Set([
    "Payout",
    "PayoutFailed",
    "Claimed",
    "EmergencyWithdrawn",
    "Refunded",
    "Swept",
    "PendingWithdrawn",
  ]);
  for (const { log, event } of ordered) {
    signal?.throwIfAborted();
    if (!paymentNames.has(event.name) || receipts.has(log.transactionHash))
      continue;
    const [receipt, tx] = await Promise.all([
      chain.provider.getTransactionReceipt(log.transactionHash),
      chain.provider.getTransaction(log.transactionHash),
    ]);
    signal?.throwIfAborted();
    requireThat(
      receipt?.status === 1 &&
        receipt.blockHash === log.blockHash &&
        receipt.blockNumber <= block.number,
      "Payment receipt is not successful in the requested snapshot",
      "PAYMENT_RECEIPT",
      409,
    );
    const names = new Set(
      receipt.logs
        .filter((item) => lower(item.address) === lower(d.contract))
        .flatMap((item) => {
          try {
            const parsed = contract.interface.parseLog(item);
            return parsed ? [parsed.name] : [];
          } catch {
            return [];
          }
        }),
    );
    let method = null;
    if (tx && lower(tx.to) === lower(d.contract)) {
      try {
        method =
          contract.interface.parseTransaction({
            data: tx.data,
            value: tx.value,
          })?.name ?? null;
      } catch {
        /* wrapper or unknown call */
      }
    }
    receipts.set(log.transactionHash, { receipt, names, method });
  }
  const totals = {
    attendancePaidWei: 0n,
    principalRefundedWei: 0n,
    registeredPrincipalRefundedWei: 0n,
    unregisteredDepositReturnedWei: 0n,
    spareRefundedWei: 0n,
    spareSweptWei: 0n,
    failedPaymentsWei: 0n,
    claimedWei: 0n,
    unclassifiedPayoutWei: 0n,
    pendingCreditWithdrawnWei: 0n,
  };
  /** @type {Map<string, boolean>} */
  const registered = new Map();
  /** @type {Map<string, {wallet: string, amount: bigint, registered: boolean}>} */
  const rejected = new Map();
  /** @type {Array<{type: string, wallet: string, recipient: string | null, amountWei: string, txHash: string, blockNumber: number, logIndex: number, successful: boolean, sourceMethod: string | null}>} */
  const transfers = [];
  for (const { log, event } of ordered) {
    signal?.throwIfAborted();
    const a = event.args,
      key = log.transactionHash;
    if (event.name === "StakerRegistered") {
      registered.set(lower(a.staker), true);
      continue;
    }
    if (event.name === "Rejected") {
      rejected.set(key, {
        wallet: lower(a.wallet),
        amount: a.refunded,
        registered: registered.get(lower(a.wallet)) === true,
      });
      registered.set(lower(a.wallet), false);
      continue;
    }
    if (!paymentNames.has(event.name)) continue;
    const context = receipts.get(key);
    let type, wallet, recipient, amount;
    let successful = true;
    if (event.name === "Payout") {
      wallet = recipient = a.to;
      amount = a.amount;
      const rejection = rejected.get(key);
      if (
        rejection &&
        rejection.wallet === lower(wallet) &&
        rejection.amount === amount
      ) {
        type = rejection.registered
          ? "registered-principal-refund"
          : "unregistered-deposit-return";
        totals.principalRefundedWei += amount;
        totals[
          rejection.registered
            ? "registeredPrincipalRefundedWei"
            : "unregisteredDepositReturnedWei"
        ] += amount;
        rejected.delete(key);
      } else if (
        context.names.has("Cancelled") ||
        context.method === "cancel"
      ) {
        type = "registered-principal-refund";
        totals.principalRefundedWei += amount;
        totals.registeredPrincipalRefundedWei += amount;
      } else if (
        context.names.has("Finalized") ||
        context.names.has("ChallengeResolved") ||
        ["releasePayouts", "resolveChallenge"].includes(context.method)
      ) {
        type = "attendance-payout";
        totals.attendancePaidWei += amount;
      } else {
        type = "unclassified-payout";
        totals.unclassifiedPayoutWei += amount;
      }
    } else if (event.name === "PayoutFailed") {
      type = "failed-credit";
      wallet = recipient = a.to;
      amount = a.amount;
      successful = false;
      totals.failedPaymentsWei += amount;
      const rejection = rejected.get(key);
      if (
        rejection &&
        rejection.wallet === lower(wallet) &&
        rejection.amount === amount
      )
        rejected.delete(key);
    } else if (event.name === "Claimed") {
      type = "owed-claim";
      wallet = a.account;
      recipient = a.to;
      amount = a.amount;
      totals.claimedWei += amount;
    } else if (event.name === "EmergencyWithdrawn") {
      type = "registered-no-list-refund";
      wallet = a.staker;
      amount = a.amount;
      // v7 logs the entitled staker, not the chosen recipient. Never invent it.
      recipient = null;
      totals.principalRefundedWei += amount;
      totals.registeredPrincipalRefundedWei += amount;
      registered.set(lower(wallet), false);
    } else if (event.name === "PendingWithdrawn") {
      type = "pending-credit-withdrawal";
      wallet = a.payer;
      recipient = a.to;
      amount = a.amount;
      totals.pendingCreditWithdrawnWei += amount;
    } else if (event.name === "Refunded") {
      type = "spare-refund";
      wallet = recipient = a.to;
      amount = a.amount;
      totals.spareRefundedWei += amount;
    } else {
      type = "spare-sweep";
      wallet = recipient = a.to;
      amount = a.amount;
      totals.spareSweptWei += amount;
    }
    transfers.push({
      type,
      wallet,
      recipient,
      amountWei: String(amount),
      txHash: key,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      successful,
      sourceMethod: context.method,
    });
  }
  signal?.throwIfAborted();
  const canonical = await chain.provider.getBlock(block.number);
  requireThat(
    canonical?.hash === block.hash,
    "Payment snapshot changed; refresh",
    "PAYMENT_REORG",
    409,
  );
  requireThat(
    totals.failedPaymentsWei >= totals.claimedWei,
    "Claimed credits exceed the indexed failed payments",
    "PAYMENT_ACCOUNTING",
    409,
  );
  const owedTotal = await contract.owedTotal({ blockTag: block.number });
  requireThat(
    totals.failedPaymentsWei - totals.claimedWei === owedTotal,
    "Indexed credits do not match the authoritative owed balance",
    "PAYMENT_ACCOUNTING",
    409,
  );
  return {
    eventId: d.eventId,
    chainId: d.chainId,
    contract: d.contract,
    contractVersion: d.contractVersion,
    blockNumber: block.number,
    blockHash: block.hash,
    ...Object.fromEntries(
      Object.entries(totals).map(([name, amount]) => [name, String(amount)]),
    ),
    directAttendancePaidWei: String(totals.attendancePaidWei),
    outstandingCreditsWei: String(totals.failedPaymentsWei - totals.claimedWei),
    totalExplicitSuccessfulTransfersWei: String(
      totals.attendancePaidWei +
        totals.principalRefundedWei +
        totals.spareRefundedWei +
        totals.spareSweptWei +
        totals.claimedWei +
        totals.pendingCreditWithdrawnWei +
        totals.unclassifiedPayoutWei,
    ),
    scope: `Successful ${d.contractVersion} log-explicit attendance payments and returns; claims remain unattributed fungible credit. Successful challenge reimbursements/remainders, arbitration and appeal transfers are outside this projection.`,
    completeNativeTransferHistory: false,
    transfers,
  };
}
