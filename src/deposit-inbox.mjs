import { ethers } from "ethers";
import { isV8Version } from "./contracts-v8.mjs";
import { verifyDeployment } from "./chain.mjs";
import { projectPayments } from "./payments.mjs";
import { hash, lower, requireThat } from "./utils.mjs";
import { getLogsChunked } from "../references/kickback/scripts/lib.mjs";

export const DEPOSIT_INBOX_LIMITS = Object.freeze({
  historyBlocks: 50_000,
  chunkBlocks: 5_000,
  payers: 1_000,
  lots: 2_000,
  logs: 20_000,
  refreshMs: 30_000,
  manualMinimumMs: 5_000,
  timeoutMs: 30_000,
});

async function boundedMap(items, fn, signal) {
  const results = new Array(items.length);
  let next = 0,
    failure;
  await Promise.all(
    Array.from({ length: Math.min(8, items.length) }, async () => {
      while (next < items.length && !failure) {
        try {
          signal?.throwIfAborted();
          const index = next++;
          results[index] = await fn(items[index], index);
        } catch (error) {
          failure ??= error;
        }
      }
    }),
  );
  if (failure) throw failure;
  return results;
}

async function readAll(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return results.map((result) => result.value);
}

function sameLog(a, b) {
  return (
    lower(a.address) === lower(b.address) &&
    a.index === b.index &&
    a.blockNumber === b.blockNumber &&
    lower(a.blockHash) === lower(b.blockHash) &&
    lower(a.transactionHash) === lower(b.transactionHash) &&
    lower(a.data) === lower(b.data) &&
    JSON.stringify(a.topics.map(lower)) === JSON.stringify(b.topics.map(lower))
  );
}

// A payer is the event's Deposited.from, including a contract wallet making an
// internal call. The outer transaction sender never establishes guest identity.
async function verifyLogs(provider, contract, logs, blockNumber, signal) {
  const groups = new Map();
  const seen = new Set();
  for (const log of logs) {
    const key = `${lower(log.transactionHash)}:${log.index}`;
    requireThat(
      lower(log.address) === lower(contract.target) &&
        !log.removed &&
        log.blockNumber <= blockNumber &&
        !seen.has(key),
      "Deposit inbox log is outside its snapshot",
      "INBOX_RECEIPT",
      409,
    );
    seen.add(key);
    const group = groups.get(log.transactionHash) ?? [];
    group.push(log);
    groups.set(log.transactionHash, group);
  }
  await boundedMap(
    [...groups.entries()],
    async ([txHash, entries]) => {
      const [receipt, tx] = await readAll([
        provider.getTransactionReceipt(txHash),
        provider.getTransaction(txHash),
      ]);
      signal?.throwIfAborted();
      requireThat(
        receipt?.status === 1 &&
          tx &&
          lower(receipt.hash ?? receipt.transactionHash) === lower(txHash) &&
          lower(tx.hash) === lower(txHash) &&
          ethers.isAddress(tx.from) &&
          (tx.to === null || ethers.isAddress(tx.to)) &&
          typeof tx.value === "bigint" &&
          receipt.blockNumber <= blockNumber,
        "Deposit inbox receipt is not canonical and successful",
        "INBOX_RECEIPT",
        409,
      );
      const canonical = await provider.getBlock(receipt.blockNumber);
      requireThat(
        canonical?.hash === receipt.blockHash,
        "Deposit inbox receipt block changed",
        "INBOX_REORG",
        409,
      );
      const receiptLogs = new Map(receipt.logs.map((log) => [log.index, log]));
      requireThat(
        receiptLogs.size === receipt.logs.length,
        "Receipt contains duplicate log indices",
        "INBOX_RECEIPT",
        409,
      );
      for (const log of entries) {
        const member = receiptLogs.get(log.index);
        requireThat(
          log.blockHash === receipt.blockHash &&
            log.blockNumber === receipt.blockNumber &&
            member &&
            sameLog(log, member),
          "Deposit inbox log is absent from its canonical receipt",
          "INBOX_RECEIPT",
          409,
        );
      }
      const deposits = entries.flatMap((log) => {
        try {
          const parsed = contract.interface.parseLog(log);
          return parsed?.name === "Deposited" ? [parsed] : [];
        } catch {
          return [];
        }
      });
      // This stronger check applies only to a direct deposit/receive call. A
      // wrapper can deposit from its own balance with outer value zero.
      if (deposits.length && lower(tx.to) === lower(contract.target)) {
        let direct = tx.data === "0x";
        try {
          direct ||=
            contract.interface.parseTransaction(tx)?.name === "deposit";
        } catch {
          /* Unknown methods still require the canonical log checks above. */
        }
        if (direct)
          requireThat(
            deposits.length === 1 &&
              lower(deposits[0].args.from) === lower(tx.from) &&
              deposits[0].args.amount === tx.value,
            "Direct deposit transaction and emitted payer/value differ",
            "INBOX_RECEIPT",
            409,
          );
      }
    },
    signal,
  );
}

/** Read-only projection. Every mutable read targets one explicit block. */
export async function indexDepositInbox(
  w,
  eventId,
  {
    record = w.record(eventId),
    verify = verifyDeployment,
    payments = projectPayments,
    scan = getLogsChunked,
    limits = DEPOSIT_INBOX_LIMITS,
    signal,
  } = {},
) {
  const d = record.deployment,
    provider = w.provider;
  signal?.throwIfAborted();
  const contract = await verify(w.chain, d);
  signal?.throwIfAborted();
  const block = await provider.getBlock("latest");
  signal?.throwIfAborted();
  requireThat(
    block &&
      block.number >= d.deploymentBlock &&
      block.number - d.deploymentBlock + 1 <= limits.historyBlocks,
    "Deposit inbox history exceeds its bounded indexing window",
    "INBOX_HISTORY_LIMIT",
    409,
  );
  const logProvider = signal
    ? {
        getLogs(filter) {
          signal.throwIfAborted();
          return provider.getLogs(filter);
        },
      }
    : provider;
  const logs = await scan(
    logProvider,
    { address: d.contract },
    d.deploymentBlock,
    block.number,
    limits.chunkBlocks,
    { retries: 0, minStep: limits.chunkBlocks },
  );
  signal?.throwIfAborted();
  requireThat(
    logs.length <= limits.logs,
    "Deposit inbox log limit exceeded",
    "INBOX_LIMIT",
    409,
  );
  const deposits = logs.flatMap((log) => {
    try {
      const event = contract.interface.parseLog(log);
      return event?.name === "Deposited" ? [{ log, event }] : [];
    } catch {
      return [];
    }
  });
  requireThat(
    deposits.length <= limits.lots &&
      new Set(deposits.map(({ event }) => lower(event.args.from))).size <=
        limits.payers,
    "Deposit inbox payer or deposit limit exceeded",
    "INBOX_LIMIT",
    409,
  );
  await verifyLogs(provider, contract, logs, block.number, signal);
  const at = { blockTag: block.number };
  const [ledger, payment, phaseValue] = await readAll([
    w.depositLedger(eventId, block.number, { signal }),
    payments(w.chain, record, { blockTag: block.number, signal }),
    contract.phase(at),
  ]);
  signal?.throwIfAborted();
  requireThat(
    ledger.length <= limits.payers &&
      ledger.reduce((count, row) => count + row.transactions.length, 0) ===
        deposits.length,
    "Deposit inbox ledger does not match indexed deposit lots",
    "INBOX_ACCOUNTING",
    409,
  );
  const knownLots = new Map(
    deposits.map(({ log, event }) => [
      `${lower(log.transactionHash)}:${log.index}`,
      { log, wallet: event.args.from, amount: String(event.args.amount) },
    ]),
  );
  const v8 = isV8Version(d.contractVersion);
  const ledgerLots = new Set();
  const rows = await boundedMap(
    ledger,
    async (row) => {
      const [statusValue, owed, challenge, pending] = await readAll([
        contract.status(row.wallet, at),
        contract.owed(row.wallet, at),
        contract.challenges(row.wallet, at),
        v8 ? contract.pendingDeposits(row.wallet, at) : Promise.resolve(null),
      ]);
      signal?.throwIfAborted();
      const status = Number(statusValue);
      const transfers = payment.transfers.filter(
        (t) => lower(t.wallet) === lower(row.wallet) && t.successful,
      );
      const total = (types) =>
        transfers
          .filter((t) => types.includes(t.type))
          .reduce((sum, t) => sum + BigInt(t.amountWei), 0n);
      const creditWithdrawn = total(["pending-credit-withdrawal"]);
      const returned =
        total([
          "registered-principal-refund",
          "unregistered-deposit-return",
          "registered-no-list-refund",
          "spare-refund",
        ]) + creditWithdrawn;
      return {
        wallet: row.wallet,
        registered: [1, 2].includes(status),
        registrationState:
          ["unregistered", "active", "paid", "rejected"][status] ?? "unknown",
        pendingCreditWei: pending === null ? null : String(pending),
        committedPrincipalWei:
          Number(phaseValue) <= 1 && status === 1 ? d.depositWei : "0",
        registrationBasisWei: row.allocatedWei,
        receivedWei: row.receivedWei,
        returnedWei: String(returned),
        unallocatedWei: v8 ? String(pending) : row.unallocatedWei,
        owedWei: String(owed),
        heldShareWei: String(challenge.heldShare),
        attendancePaidWei: String(total(["attendance-payout"])),
        creditWithdrawnWei: String(creditWithdrawn),
        claimsPaidWei: String(total(["owed-claim"])),
        transactions: row.transactions.map((lot) => {
          const key = `${lower(lot.txHash)}:${lot.logIndex}`;
          const canonical = knownLots.get(key);
          requireThat(
            canonical &&
              !ledgerLots.has(key) &&
              lower(canonical.wallet) === lower(row.wallet) &&
              canonical.amount === lot.amountWei,
            "Deposit inbox lot differs from canonical Deposited log",
            "INBOX_ACCOUNTING",
            409,
          );
          ledgerLots.add(key);
          const confirmations = block.number - canonical.log.blockNumber + 1;
          return {
            txHash: lot.txHash,
            logIndex: lot.logIndex,
            amountWei: lot.amountWei,
            blockNumber: canonical.log.blockNumber,
            blockHash: canonical.log.blockHash,
            confirmations,
            status: confirmations >= 2 ? "confirmed" : "confirming",
          };
        }),
      };
    },
    signal,
  );
  const canonical = await provider.getBlock(block.number);
  signal?.throwIfAborted();
  requireThat(
    canonical?.hash === block.hash,
    "Deposit inbox snapshot changed while indexing",
    "INBOX_REORG",
    409,
  );
  return {
    source: "contract",
    eventId,
    chainId: d.chainId,
    contract: d.contract,
    contractVersion: d.contractVersion,
    indexedBlock: {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
    },
    latestBlock: block.number,
    rows,
  };
}

function timeout(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            Object.assign(new Error("Deposit inbox read timed out"), {
              code: "INBOX_TIMEOUT",
            }),
          ),
        milliseconds,
      );
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function publicError(error) {
  const known = /^INBOX_[A-Z_]+$/.test(error?.code ?? "");
  return {
    code: known ? error.code : "INBOX_UNAVAILABLE",
    message: known
      ? ({
          INBOX_REORG: "The indexed chain anchor changed; refresh is required.",
          INBOX_HISTORY_LIMIT:
            "The deployment history exceeds the inbox indexing window.",
          INBOX_LIMIT: "The inbox indexing limit was reached.",
          INBOX_TIMEOUT: "The chain read timed out. Previous rows are stale.",
          INBOX_RECEIPT: "A canonical receipt/log check failed.",
          INBOX_ACCOUNTING:
            "The indexed deposits do not match the canonical ledger.",
        }[error.code] ?? "The deposit inbox could not be verified.")
      : "The chain read could not be verified. Previous rows are stale.",
  };
}

/** Informational cache only: financial drafts never read this service.
 * @param {any} w @param {any} [options]
 */
export function createDepositInbox(
  w,
  {
    environment = "local-demo",
    instanceId,
    now = Date.now,
    limits = DEPOSIT_INBOX_LIMITS,
    verify = verifyDeployment,
    index = indexDepositInbox,
    indexOptions = {},
  } = {},
) {
  const entries = new Map();
  async function currentOwner(eventId, session) {
    try {
      return await timeout(w.owner(eventId, session), limits.timeoutMs);
    } catch (error) {
      if (
        ["UNAUTHENTICATED", "NOT_OWNER", "FORBIDDEN", "NOT_FOUND"].includes(
          error?.code,
        )
      )
        throw error;
      throw Object.assign(
        new Error(
          "Current contract ownership could not be verified; no inbox data was disclosed.",
        ),
        { code: "INBOX_OWNER_UNAVAILABLE", status: 503 },
      );
    }
  }
  function present(entry, record, latestBlock) {
    const snapshot = entry.snapshot ?? {
      source: "contract",
      eventId: record.deployment.eventId,
      chainId: record.deployment.chainId,
      contract: record.deployment.contract,
      contractVersion: record.deployment.contractVersion,
      indexedBlock: null,
      rows: [],
    };
    const stale = !!entry.error || !entry.snapshot;
    const rows = snapshot.rows.map((row) => {
      const p = [...record.participants.values()].find(
        (p) =>
          p.identityVerified === true &&
          p.eventId === snapshot.eventId &&
          lower(p.wallet) === lower(row.wallet),
      );
      return {
        ...row,
        participantId: p?.id ?? null,
        name: p?.name ?? null,
        email: p?.email ?? null,
        linked: !!p,
        receiptLinked: !!p?.deposit,
        actionable: !stale,
      };
    });
    return {
      ...snapshot,
      latestBlock: latestBlock ?? snapshot.latestBlock ?? null,
      lastSyncedAt: entry.syncedAt
        ? new Date(entry.syncedAt).toISOString()
        : null,
      nextRefreshAt: new Date(entry.nextAt).toISOString(),
      stale,
      error: entry.error ?? null,
      syncing: !!entry.flight,
      actionable: !stale,
      counts: {
        payers: rows.length,
        linked: rows.filter((row) => row.linked).length,
        unlinked: rows.filter((row) => !row.linked).length,
        transactions: new Set(
          rows.flatMap((row) =>
            row.transactions.map((lot) => lower(lot.txHash)),
          ),
        ).size,
      },
      rows,
    };
  }
  return {
    async read(eventId, session, { refresh = false } = {}) {
      // Authorize against the current financial owner before even cache access.
      const record = await currentOwner(eventId, session);
      const key = hash({
        environment,
        instanceId,
        eventId,
        deployment: record.deployment,
      });
      const entry = entries.get(key) ?? {
        snapshot: null,
        error: null,
        syncedAt: null,
        attemptedAt: -Infinity,
        nextAt: 0,
        flight: null,
      };
      entries.set(key, entry);
      // Install the singleflight before the first awaited RPC. All simultaneous
      // callers share this verification/index attempt, never financial state.
      // A client timeout aborts new batches but retains the actual pending job;
      // an uninterruptible in-flight RPC can never start overlapping index jobs.
      if (!entry.flight) {
        const controller = new AbortController();
        entry.controller = controller;
        entry.flight = (async () => {
          // Immutable and creation provenance checks are deliberately fresh on reuse.
          const actualChain = await w.provider.send("eth_chainId", []);
          controller.signal.throwIfAborted();
          requireThat(
            BigInt(actualChain) === BigInt(record.deployment.chainId),
            "Deposit inbox chain differs from deployment",
            "INBOX_CHAIN",
            409,
          );
          await verify(w.chain, record.deployment);
          controller.signal.throwIfAborted();
          const latestBlock = await w.provider.getBlock("latest");
          controller.signal.throwIfAborted();
          requireThat(
            latestBlock,
            "Deposit inbox latest block unavailable",
            "INBOX_REORG",
            409,
          );
          let reorg = false;
          if (entry.snapshot?.indexedBlock) {
            const anchor = await w.provider.getBlock(
              entry.snapshot.indexedBlock.number,
            );
            reorg =
              latestBlock.number < entry.snapshot.indexedBlock.number ||
              anchor?.hash !== entry.snapshot.indexedBlock.hash;
          }
          controller.signal.throwIfAborted();
          if (reorg) {
            // A proven orphan is not a usable last-good snapshot.
            entry.snapshot = null;
            entry.syncedAt = null;
            entry.reorgDetected = true;
            entry.error = publicError({ code: "INBOX_REORG" });
          }
          const due =
            reorg ||
            now() >= entry.nextAt ||
            (refresh && now() - entry.attemptedAt >= limits.manualMinimumMs);
          // A prior transient error cannot be cleared by checking only the anchor.
          const snapshot = due
            ? await index(w, eventId, {
                ...indexOptions,
                record,
                verify,
                limits,
                signal: controller.signal,
              })
            : null;
          controller.signal.throwIfAborted();
          return { snapshot, latestBlock: latestBlock.number, attempted: due };
        })()
          .then(({ snapshot, latestBlock, attempted }) => {
            entry.latestBlock = Math.max(
              latestBlock,
              snapshot?.latestBlock ?? 0,
            );
            if (snapshot) {
              entry.snapshot = snapshot;
              entry.syncedAt = now();
              entry.error = null;
              entry.reorgDetected = false;
            }
            if (attempted) {
              entry.attemptedAt = now();
              entry.nextAt = now() + limits.refreshMs;
            }
          })
          .catch((error) => {
            entry.error = publicError(
              entry.reorgDetected ? { code: "INBOX_REORG" } : error,
            );
            entry.attemptedAt = now();
            entry.nextAt = now() + limits.refreshMs;
          })
          .finally(() => {
            entry.flight = null;
          });
      }
      if (!entry.controller.signal.aborted) {
        try {
          await timeout(entry.flight, limits.timeoutMs);
        } catch (error) {
          entry.controller.abort(error);
          entry.error = publicError(error);
          entry.attemptedAt = now();
          entry.nextAt = now() + limits.refreshMs;
        }
      }
      // Ownership may change during a slow index. Reauthorize before disclosure.
      await currentOwner(eventId, session);
      return present(entry, record, entry.latestBlock);
    },
  };
}
