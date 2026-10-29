// @ts-check

const JOURNAL_VERSION = 1;
const PREFIX = "kleros-transactions:v1:";
const UINT256_MAX = (1n << 256n) - 1n;
const activeSubmissions = new WeakMap();
const journalStorage = new WeakMap();
const statuses = new Set(["submitted", "confirmed", "failed", "needs-confirmation"]);

function fail(message, code) {
  throw Object.assign(new Error(message), { code });
}

function stringField(value, name, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(`A valid ${name} is required.`, "INVALID_TRANSACTION_CONTEXT");
  return value;
}

function address(value, name) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/i.test(value))
    fail(`A valid ${name} address is required.`, "INVALID_TRANSACTION_CONTEXT");
  return value;
}

function quantity(value, name) {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || value < 0)
  ) fail(`${name} must be an exact nonnegative integer.`, "INVALID_TRANSACTION_VALUE");
  if (
    typeof value !== "bigint" && typeof value !== "number" &&
    (typeof value !== "string" || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value))
  ) fail(`${name} must be an integer quantity.`, "INVALID_TRANSACTION_VALUE");
  const number = BigInt(value);
  if (number < 0n || number > UINT256_MAX)
    fail(`${name} is outside the uint256 range.`, "INVALID_TRANSACTION_VALUE");
  return number;
}

function chainId(value) {
  const number = quantity(value, "Chain ID");
  if (number === 0n) fail("A positive chain ID is required.", "INVALID_TRANSACTION_CONTEXT");
  return number;
}

function sameAddress(a, b) { return a.toLowerCase() === b.toLowerCase(); }

function captureContext(context) {
  const chain = chainId(context?.chainId);
  return Object.freeze({
    eventId: stringField(context?.eventId, "stable event ID"),
    wallet: address(context?.wallet, "wallet"),
    chainId: typeof context.chainId === "bigint" ? chain.toString() : context.chainId,
    contract: address(context?.contract, "event contract"),
    abiVersion: stringField(context?.abiVersion, "ABI version", 100),
    mode: stringField(context?.mode, "environment mode", 100),
    instanceId: stringField(context?.instanceId, "server instance ID", 200),
  });
}

function namespace(context) {
  const c = captureContext(context);
  return PREFIX + [c.instanceId, c.mode, c.eventId, chainId(c.chainId).toString(),
    c.contract.toLowerCase(), c.wallet.toLowerCase(), c.abiVersion]
    .map(encodeURIComponent).join(":");
}

function transactionHash(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value))
    fail("The wallet did not return a valid transaction hash.", "INVALID_TRANSACTION_HASH");
  return value.toLowerCase();
}

function detached(value) { return JSON.parse(JSON.stringify(value)); }

function storageError(error) {
  return Object.assign(new Error("Transaction storage is unavailable. Restore storage before signing; no transaction was requested."),
    { code: "TRANSACTION_STORAGE_UNAVAILABLE", cause: error });
}

/**
 * A synchronous journal scoped to a server instance and financial deployment.
 * Reads return copies. Corrupt/incompatible records fail closed rather than being
 * silently discarded, because discarding them could encourage a duplicate send.
 */
export function createTransactionJournal(storage) {
  if (!storage || !["getItem", "setItem", "removeItem"].every(key => typeof storage[key] === "function"))
    throw storageError(new Error("A writable Storage-compatible object is required."));

  function probe() {
    const key = `${PREFIX}probe:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
      storage.setItem(key, "probe");
      if (storage.getItem(key) !== "probe") throw new Error("Storage did not retain the probe.");
      storage.removeItem(key);
    } catch (error) {
      try { storage.removeItem(key); } catch { /* Preserve the original storage failure. */ }
      throw storageError(error);
    }
    return true;
  }

  function read(context) {
    const key = namespace(context);
    let raw;
    try { raw = storage.getItem(key); } catch (error) { throw storageError(error); }
    if (raw === null) return { version: JOURNAL_VERSION, context: captureContext(context), transactions: [] };
    let value;
    try { value = JSON.parse(raw); }
    catch { fail("The transaction journal is unreadable. Preserve it and reconcile submitted hashes before signing again.", "TRANSACTION_JOURNAL_CORRUPT"); }
    if (value?.version !== JOURNAL_VERSION || !Array.isArray(value.transactions))
      fail("The transaction journal has an incompatible format.", "TRANSACTION_JOURNAL_CORRUPT");
    try {
      if (namespace(value.context) !== key) throw new Error("Wrong journal scope.");
      const hashes = new Set();
      for (const entry of value.transactions) {
        const hash = transactionHash(entry.hash);
        if (hashes.has(hash) || !statuses.has(entry.status)) throw new Error("Invalid journal entry.");
        hashes.add(hash);
        stringField(entry.draftId, "draft ID");
      }
    } catch { fail("The transaction journal contains invalid or cross-context entries.", "TRANSACTION_JOURNAL_CORRUPT"); }
    return value;
  }

  function write(context, value) {
    try { storage.setItem(namespace(context), JSON.stringify(value)); }
    catch (error) { throw storageError(error); }
  }

  function list(context) { return detached(read(context).transactions); }

  function get(context, hash) {
    const wanted = transactionHash(hash);
    return list(context).find(entry => entry.hash === wanted) ?? null;
  }

  function record(context, entry) {
    const state = read(context), hash = transactionHash(entry?.hash);
    const draftId = stringField(entry?.draftId, "draft ID");
    const existing = state.transactions.find(item => item.hash === hash);
    if (existing) {
      if (existing.draftId !== draftId)
        fail("This transaction hash is already associated with another draft.", "TRANSACTION_ALREADY_RECORDED");
      return detached(existing);
    }
    if (state.transactions.some(item => item.draftId === draftId))
      fail("This reviewed draft already has a submitted transaction. Reconcile it before another send.", "TRANSACTION_ALREADY_SUBMITTED");
    const at = Date.now();
    const item = {
      hash, draftId, status: "submitted", submittedAt: at, updatedAt: at,
      ...(typeof entry.action === "string" ? { action: entry.action.slice(0, 100) } : {}),
    };
    state.transactions.push(item);
    write(context, state);
    return detached(item);
  }

  function update(context, hash, patch) {
    const state = read(context), wanted = transactionHash(hash);
    const item = state.transactions.find(entry => entry.hash === wanted);
    if (!item) fail("The submitted transaction was not found in this context.", "TRANSACTION_NOT_RECORDED");
    if (patch.status !== undefined) {
      if (!statuses.has(patch.status)) fail("Invalid transaction journal status.", "INVALID_TRANSACTION_STATUS");
      if (item.status === "confirmed" && patch.status !== "confirmed")
        fail("A confirmed transaction cannot be demoted by a stale response.", "TRANSACTION_ALREADY_CONFIRMED");
      if (item.status === "failed" && patch.status !== "failed")
        fail("A failed transaction cannot be changed by a stale response.", "TRANSACTION_ALREADY_FAILED");
      item.status = patch.status;
    }
    if (patch.blockNumber !== undefined) {
      if (!Number.isSafeInteger(patch.blockNumber) || patch.blockNumber < 0)
        fail("A valid confirmed block number is required.", "INVALID_TRANSACTION_STATUS");
      item.blockNumber = patch.blockNumber;
    }
    if (typeof patch.error === "string") item.error = patch.error.slice(0, 500);
    if (patch.error === null) delete item.error;
    item.updatedAt = Date.now();
    if (item.status === "confirmed") item.confirmedAt = item.updatedAt;
    if (item.status === "failed") item.failedAt = item.updatedAt;
    write(context, state);
    return detached(item);
  }

  const journal = { probe, list, get, record, update };
  journalStorage.set(journal, storage);
  return journal;
}

function captureTransaction(transaction, context) {
  const to = address(transaction?.to, "transaction recipient");
  const from = address(transaction?.from, "transaction sender");
  const chain = chainId(transaction?.chainId);
  if (!sameAddress(from, context.wallet) || chain !== chainId(context.chainId))
    fail("The reviewed transaction belongs to a different wallet or chain.", "TRANSACTION_CONTEXT_MISMATCH");
  const data = transaction?.data;
  if (typeof data !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(data))
    fail("Reviewed transaction calldata must be exact hexadecimal bytes.", "INVALID_TRANSACTION_DATA");
  return Object.freeze({ to, from, data, value: quantity(transaction.value, "Transaction value"), chainId: chain });
}

function captureDraft(draft, context) {
  if (draft?.eventId !== context.eventId || !sameAddress(address(draft?.wallet, "draft wallet"), context.wallet) ||
      chainId(draft?.chainId) !== chainId(context.chainId) || !sameAddress(address(draft?.contract, "draft event contract"), context.contract) ||
      (draft.abiVersion !== undefined && draft.abiVersion !== context.abiVersion) ||
      (draft.mode !== undefined && draft.mode !== context.mode) ||
      (draft.instanceId !== undefined && draft.instanceId !== context.instanceId))
    fail("The reviewed draft belongs to a different event, wallet, deployment or environment.", "TRANSACTION_CONTEXT_MISMATCH");
  const transaction = captureTransaction(draft.transaction, context);
  if (draft.valueWei !== undefined && quantity(draft.valueWei, "Reviewed wei") !== transaction.value)
    fail("The reviewed wei amount disagrees with its calldata transaction.", "TRANSACTION_REVIEW_MISMATCH");
  return Object.freeze({
    id: stringField(draft.id, "draft ID"),
    action: typeof draft.action === "string" ? draft.action : "transaction",
    transaction,
  });
}

function sameTransaction(a, b) {
  return sameAddress(a.to, b.to) && sameAddress(a.from, b.from) &&
    a.data.toLowerCase() === b.data.toLowerCase() && a.value === b.value && a.chainId === b.chainId;
}

function submittedError(error, hash, context, draftId) {
  const message = error instanceof Error ? error.message : String(error);
  let wrapped = Object.assign(new Error(message), {
    cause: error,
    ...(/** @type {any} */ (error)?.code !== undefined ? { code: /** @type {any} */ (error).code } : {}),
  });
  if (/** @type {any} */ (error)?.code === "TRANSACTION_STORAGE_UNAVAILABLE")
    wrapped = Object.assign(new Error(`The wallet submitted ${hash}, but durable storage failed. Save this hash and reconcile it before sending again.`),
      { code: "TRANSACTION_STORAGE_UNAVAILABLE", cause: error });
  return Object.assign(wrapped, {
    submittedHash: hash, transactionContext: context, draftId,
  });
}

/**
 * Send one reviewed EIP-1193 transaction. There is deliberately no automatic send,
 * confirmation retry, or replay. After send, every callback uses the captured
 * original context even if the interface has switched to another event/wallet.
 */
export async function submitWalletDraft({
  draft, context, provider, validate, confirm, recordSubmitted,
  journal, isCurrentContext = (_context) => true,
}) {
  const original = captureContext(context);
  const reviewed = captureDraft(draft, original);
  if (!provider || typeof provider.request !== "function" || typeof validate !== "function" || typeof confirm !== "function" ||
      typeof isCurrentContext !== "function" || (recordSubmitted !== undefined && typeof recordSubmitted !== "function"))
    fail("Wallet, validation and confirmation callbacks are required.", "INVALID_TRANSACTION_CLIENT");
  if (!journal || !journalStorage.has(journal))
    fail("A durable transaction journal is required before signing.", "TRANSACTION_STORAGE_UNAVAILABLE");
  const storage = journalStorage.get(journal);
  let active = activeSubmissions.get(storage);
  if (!active) { active = new Set(); activeSubmissions.set(storage, active); }
  const lock = `${namespace(original)}:${encodeURIComponent(reviewed.id)}`;
  if (active.has(lock)) fail("This reviewed draft already has a wallet request in progress.", "TRANSACTION_SUBMISSION_BUSY");
  active.add(lock);
  let hash;
  try {
    // A blocked/quota-disabled store is detected before a financial wallet prompt.
    journal.probe();
    const prior = journal.list(original).find(item => item.draftId === reviewed.id);
    if (prior) throw submittedError(Object.assign(new Error("This draft was already submitted. Reconcile its recorded hash; it will not be sent again."),
      { code: "TRANSACTION_ALREADY_SUBMITTED" }), prior.hash, original, reviewed.id);
    const assertCurrent = async () => {
      if (!(await isCurrentContext(original)))
        fail("The selected event, wallet or environment changed. Prepare a fresh review.", "TRANSACTION_CONTEXT_CHANGED");
    };
    await assertCurrent();
    const validated = captureTransaction(await validate(original.eventId, reviewed.id), original);
    if (!sameTransaction(reviewed.transaction, validated))
      fail("Authoritative transaction terms differ from the reviewed transaction.", "TRANSACTION_REVIEW_MISMATCH");
    await assertCurrent();
    const [accounts, actualChain] = await Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ]);
    if (!Array.isArray(accounts) || !accounts[0] || !sameAddress(address(accounts[0], "connected wallet"), original.wallet))
      fail("The connected wallet changed. Authenticate and review again.", "WRONG_WALLET");
    if (chainId(actualChain) !== chainId(original.chainId))
      fail("The wallet network differs from the reviewed event network.", "WRONG_CHAIN");
    await assertCurrent();
    hash = transactionHash(await provider.request({ method: "eth_sendTransaction", params: [{
      to: validated.to, from: validated.from, data: validated.data,
      value: `0x${validated.value.toString(16)}`, chainId: `0x${validated.chainId.toString(16)}`,
    }] }));

    // Do not insert an await here: the submitted hash survives a subsequent
    // confirmation failure, context switch, or document reload.
    journal.record(original, { hash, draftId: reviewed.id, action: reviewed.action });
    if (recordSubmitted) await recordSubmitted(original.eventId, reviewed.id, hash, original);
    const result = await confirm(original.eventId, reviewed.id, hash);
    if (result?.status !== "confirmed" && result?.status !== "failed")
      fail("The transaction is submitted but has no verified confirmation yet. Reconcile its recorded hash.", "TRANSACTION_UNCONFIRMED");
    const failed = result.status === "failed";
    if ((failed && (typeof result.hash !== "string" || typeof result.eventId !== "string" ||
          typeof result.wallet !== "string" || !Number.isSafeInteger(result.blockNumber) || result.blockNumber < 0)) ||
        (result.hash !== undefined && transactionHash(result.hash) !== hash) ||
        (result.eventId !== undefined && result.eventId !== original.eventId) ||
        (result.wallet !== undefined && !sameAddress(address(result.wallet, "receipt wallet"), original.wallet)) ||
        (result.chainId !== undefined && chainId(result.chainId) !== chainId(original.chainId)))
      fail("The confirmation does not match the submitted event transaction.", "TRANSACTION_CONFIRMATION_MISMATCH");
    if (failed) {
      journal.update(original, hash, { status: "failed", blockNumber: result.blockNumber,
        error: "The submitted transaction reverted on chain." });
      fail("The submitted transaction reverted on chain. Review current event state before preparing a new action.", "TRANSACTION_REVERTED");
    }
    journal.update(original, hash, { status: "confirmed", ...(result.blockNumber !== undefined ? { blockNumber: result.blockNumber } : {}), error: null });
    return { ...result, hash, context: original };
  } catch (error) {
    if (hash) {
      try { journal.update(original, hash, { status: "needs-confirmation", error: error instanceof Error ? error.message : String(error) }); }
      catch { /* A post-send storage failure must never hide the submitted hash. */ }
      throw submittedError(error, hash, original, reviewed.id);
    }
    throw error;
  } finally {
    active.delete(lock);
  }
}
