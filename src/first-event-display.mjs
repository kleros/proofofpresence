// Public historical receipts only. Database rows never grant financial or organizer authority.
import { ethers } from "ethers";
import { FIRST_EVENT_MANAGE_SCOPE, firstEventManageMatches, checkedFirstEventScope } from "./first-event-manage-scope.mjs";
import { hash, requireThat } from "./utils.mjs";
import { withReadJobScope } from "./read-job-scope.mjs";
import { collectFirstEventState, publicFirstEventState } from "./first-event-state.mjs";

const iface = new ethers.Interface(["event Deposited(address indexed from,uint256 amount)"]);
const depositedTopic = iface.getEvent("Deposited").topicHash;
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const digest = value => typeof value === "string" && ethers.isHexString(value, 32) && value !== ethers.ZeroHash;
const validBlock = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === "string" && value.length <= 100 && /^(0|[1-9][0-9]*)$/.test(value);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const copy = value => structuredClone(value);
const check = (ok, message = "Public deposit history is temporarily unavailable.") =>
  requireThat(ok, message, "PUBLIC_DEPOSITS_UNAVAILABLE", 503);
const unavailable = () => Object.assign(new Error("Public depositor refresh unavailable."), { code: "PUBLIC_DEPOSITS_UNAVAILABLE", status: 503 });
const matchesLog = (a, b) => same(a.address, b.address) && a.index === b.index &&
  a.blockNumber === b.blockNumber && same(a.blockHash, b.blockHash) &&
  same(a.transactionHash, b.transactionHash) && same(a.data, b.data) &&
  Array.isArray(a.topics) && Array.isArray(b.topics) && a.topics.length === b.topics.length &&
  a.topics.every((topic, i) => same(topic, b.topics[i]));

/** read() is database-only; refresh() is the bounded receipt index worker.
 * @param {any} w
 * @param {{instanceId:string,origin:string,store:any,now?:()=>number,freshMs?:number,intervalMs?:number,timeoutMs?:number,
 * setTimer?:typeof setTimeout,clearTimer?:typeof clearTimeout,eventScope?:any,recoveryOnly?:boolean}} options
 */
export function createFirstEventDisplay(w, { instanceId, origin, store, now = Date.now,
  freshMs = 30000, intervalMs = 15000, timeoutMs = 180000, setTimer = setTimeout, clearTimer = clearTimeout,
  eventScope = FIRST_EVENT_MANAGE_SCOPE, recoveryOnly = false }) {
  check(typeof instanceId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(instanceId));
  let parsedOrigin;
  try { parsedOrigin = new URL(origin); } catch { check(false); }
  check(parsedOrigin.protocol === "https:" && parsedOrigin.origin === origin &&
    store && ["read", "write", "withLease"].every(key => typeof store[key] === "function") &&
    [freshMs, intervalMs, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0) && intervalMs >= 1000);
  const expected = checkedFirstEventScope(eventScope);
  check(typeof recoveryOnly === "boolean");
  let inFlight = null, timer = null, started = false, closed = false;
  function scope() {
    const catalog = w.publicCatalog();
    const entry = catalog?.events?.find(row => row.id === expected.eventId);
    const record = entry ? w.record(expected.eventId) : null;
    requireThat(!closed && catalog?.instanceId === instanceId && catalog.mode === "hosted-production" &&
      catalog.environment?.production === true && catalog.environment.chainId === 1 &&
      entry?.visibility === "public" && entry.editorialStatus === "published" &&
      entry.chainId === 1 && entry.contractVersion === expected.contractVersion &&
      same(entry.contract, expected.contract) && firstEventManageMatches(record, expected) &&
      (recoveryOnly || w.firstEventManageAvailable?.(expected.eventId) === true),
    "Not found", "NOT_FOUND", 404);
    const d = record.deployment, adoption = entry.adoption;
    check(validBlock(d.deploymentBlock) && d.deploymentBlock > 0 && digest(d.deploymentTxHash) &&
      adoption?.kind === "recorded-adoption" && adoption.blockNumber === d.deploymentBlock &&
      same(adoption.txHash, d.deploymentTxHash) && digest(adoption.blockHash));
    const binding = { schemaVersion: 1, origin, mode: "hosted-production", eventId: expected.eventId,
      chainId: 1, contract: expected.contract.toLowerCase(), contractVersion: expected.contractVersion,
      adoption: { txHash: adoption.txHash.toLowerCase(), blockNumber: adoption.blockNumber, blockHash: adoption.blockHash.toLowerCase() } };
    return { record, binding, scopeKey: hash(canonical(binding)) };
  }
  function current(selected, signal = null) {
    signal?.throwIfAborted();
    const latest = scope();
    check(latest.scopeKey === selected.scopeKey);
    return latest;
  }
  function storedSnapshot(stored, selected) {
    check(stored && canonical(stored.binding) === canonical(selected.binding));
    const value = stored.snapshot, d = selected.record.deployment;
    check(value?.schemaVersion === 1 && value.kind === "first-event-depositors" && value.displayOnly === true &&
      value.mode === "hosted-production" && value.eventId === selected.binding.eventId && value.chainId === 1 &&
      same(value.contract, d.contract) && validBlock(value.blockNumber) && value.blockNumber >= d.deploymentBlock &&
      digest(value.blockHash) && typeof value.checkedAt === "string" && Number.isFinite(Date.parse(value.checkedAt)) &&
      Date.parse(value.checkedAt) <= now() && Array.isArray(value.depositors) && value.depositors.length <= 1000);
    const seenWallets = new Set(), seenLots = new Set();
    const depositors = value.depositors.map(row => {
      check(ethers.isAddress(row?.wallet) && !same(row.wallet, ethers.ZeroAddress) && amount(row.totalReceivedWei) &&
        !seenWallets.has(row.wallet.toLowerCase()) && Array.isArray(row.deposits));
      seenWallets.add(row.wallet.toLowerCase());
      let total = 0n;
      const deposits = row.deposits.map(lot => {
        const key = String(lot?.txHash).toLowerCase() + ":" + lot?.logIndex;
        check(digest(lot?.txHash) && Number.isSafeInteger(lot.logIndex) && lot.logIndex >= 0 && amount(lot.amountWei) &&
          validBlock(lot.blockNumber) && lot.blockNumber >= d.deploymentBlock && lot.blockNumber <= value.blockNumber &&
          digest(lot.blockHash) && !seenLots.has(key) && seenLots.size < 2000);
        seenLots.add(key); total += BigInt(lot.amountWei);
        return { txHash: lot.txHash, logIndex: lot.logIndex, amountWei: lot.amountWei,
          blockNumber: lot.blockNumber, blockHash: lot.blockHash };
      });
      check(total.toString() === row.totalReceivedWei && deposits.length > 0);
      return { wallet: ethers.getAddress(row.wallet), totalReceivedWei: row.totalReceivedWei, deposits };
    });
    // Explicit whitelist: stored diagnostics, contact data and authority fields cannot enter HTTP.
    const eventState = publicFirstEventState(value.eventState, selected.record);
    return { schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, mode: "hosted-production",
      eventId: selected.binding.eventId, chainId: 1, contract: d.contract,
      checkedAt: value.checkedAt, blockNumber: value.blockNumber, blockHash: value.blockHash, depositors,
      ...(eventState ? { eventState } : {}) };
  }
  async function index(selected, prior, signal) {
    const provider = w.provider, d = selected.record.deployment;
    const guard = () => current(selected, signal);
    guard();
    check(BigInt(await provider.send("eth_chainId", [])) === 1n); guard();
    const block = await provider.getBlock("latest"); guard();
    check(validBlock(block?.number) && digest(block.hash) && block.number >= d.deploymentBlock);
    const birth = await provider.getBlock(d.deploymentBlock); guard();
    check(birth?.number === d.deploymentBlock && same(birth.hash, selected.binding.adoption.blockHash));
    let incremental = false;
    if (prior && prior.blockNumber <= block.number) {
      const checkpoint = await provider.getBlock(prior.blockNumber); guard();
      incremental = checkpoint?.number === prior.blockNumber && same(checkpoint.hash, prior.blockHash);
    }
    const from = incremental ? prior.blockNumber + 1 : d.deploymentBlock;
    check(block.number - from + 1 <= 50000);
    const payers = new Map(), seen = new Set();
    if (incremental) for (const row of prior.depositors) {
      payers.set(row.wallet.toLowerCase(), copy(row));
      for (const lot of row.deposits) seen.add(lot.txHash.toLowerCase() + ":" + lot.logIndex);
    }
    const receipts = new Map(), headers = new Map();
    for (let fromBlock = from; fromBlock <= block.number; fromBlock += 5000) {
      const logs = await provider.getLogs({ address: d.contract, topics: [depositedTopic],
        fromBlock, toBlock: Math.min(block.number, fromBlock + 4999) }); guard();
      check(Array.isArray(logs) && seen.size + logs.length <= 2000);
      for (const log of logs) {
        const key = String(log.transactionHash).toLowerCase() + ":" + log.index;
        check(same(log.address, d.contract) && !log.removed && validBlock(log.blockNumber) &&
          log.blockNumber >= fromBlock && log.blockNumber <= Math.min(block.number, fromBlock + 4999) &&
          digest(log.blockHash) && digest(log.transactionHash) && Number.isSafeInteger(log.index) && log.index >= 0 &&
          !seen.has(key) && same(log.topics?.[0], depositedTopic));
        seen.add(key);
        let receipt = receipts.get(log.transactionHash.toLowerCase());
        if (!receipt) {
          receipt = await provider.getTransactionReceipt(log.transactionHash); guard();
          check(receipt?.status === 1 && same(receipt.hash ?? receipt.transactionHash, log.transactionHash) &&
            receipt.blockNumber === log.blockNumber && same(receipt.blockHash, log.blockHash) && Array.isArray(receipt.logs) &&
            receipt.logs.every(member => Number.isSafeInteger(member.index) && member.index >= 0) &&
            new Set(receipt.logs.map(member => member.index)).size === receipt.logs.length);
          receipts.set(log.transactionHash.toLowerCase(), receipt);
        }
        check(receipt.blockNumber === log.blockNumber && same(receipt.blockHash, log.blockHash) &&
          receipt.logs.some(member => matchesLog(log, member)));
        let header = headers.get(log.blockNumber);
        if (!header) { header = await provider.getBlock(log.blockNumber); guard(); headers.set(log.blockNumber, header); }
        check(header?.number === log.blockNumber && same(header.hash, log.blockHash));
        const parsed = iface.parseLog(log);
        check(parsed?.name === "Deposited" && ethers.isAddress(parsed.args.from) &&
          !same(parsed.args.from, ethers.ZeroAddress) && parsed.args.amount >= 0n);
        const wallet = ethers.getAddress(parsed.args.from), row = payers.get(wallet.toLowerCase()) ??
          { wallet, totalReceivedWei: "0", deposits: [] };
        row.totalReceivedWei = (BigInt(row.totalReceivedWei) + parsed.args.amount).toString();
        row.deposits.push({ txHash: log.transactionHash, logIndex: log.index, amountWei: parsed.args.amount.toString(),
          blockNumber: log.blockNumber, blockHash: log.blockHash });
        payers.set(wallet.toLowerCase(), row); check(payers.size <= 1000);
      }
    }
    let eventState;
    try { eventState = await collectFirstEventState({ provider, chain: w.chain, record: selected.record, block, signal, assertCurrent: guard }); }
    catch { signal?.throwIfAborted(); guard(); } // Optional hints never poison canonical receipt refresh.
    const closing = await provider.getBlock(block.number); guard();
    check(closing?.number === block.number && same(closing.hash, block.hash));
    check(BigInt(await provider.send("eth_chainId", [])) === 1n); guard();
    return { schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, mode: "hosted-production",
      eventId: selected.binding.eventId, chainId: 1, contract: d.contract,
      checkedAt: new Date(now()).toISOString(), blockNumber: block.number, blockHash: block.hash,
      depositors: [...payers.values()].sort((a, b) => a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase())),
      ...(eventState ? { eventState } : {}) };
  }
  function refresh() {
    const selected = scope();
    if (inFlight) {
      if (inFlight.scopeKey !== selected.scopeKey) inFlight.controller.abort(unavailable());
      return inFlight.promise;
    }
    const controller = new AbortController(), job = { scopeKey: selected.scopeKey, controller, promise: null };
    let expiry;
    const stopped = new Promise((_, reject) => {
      const abort = () => reject(controller.signal.reason ?? unavailable());
      controller.signal.addEventListener("abort", abort, { once: true });
      expiry = setTimer(() => controller.abort(unavailable()), timeoutMs);
      expiry.unref?.();
    });
    const work = withReadJobScope(controller.signal, async () => store.withLease(selected.scopeKey, async leased => {
      current(selected, controller.signal);
      const stored = await leased.read(selected.scopeKey); current(selected, controller.signal);
      const prior = stored ? storedSnapshot(stored, selected) : null;
      const snapshot = await index(selected, prior, controller.signal);
      current(selected, controller.signal);
      await leased.write(selected.scopeKey, copy(selected.binding), copy(snapshot));
      current(selected, controller.signal);
      return copy(snapshot);
    }));
    job.promise = Promise.race([work, stopped]);
    inFlight = job;
    // Retain the once-only flight until its actual lease callback exits, even if
    // observation times out while an uninterruptible provider call is finishing.
    Promise.resolve(work).finally(() => {
      clearTimer(expiry);
      if (inFlight === job) inFlight = null;
      controller.abort(unavailable());
    }).catch(() => {});
    return job.promise;
  }
  function schedule(delay) {
    timer = setTimer(() => {
      timer = null;
      if (closed || !started) return;
      Promise.resolve().then(refresh).catch(() => {}).finally(() => { if (!closed && started) schedule(intervalMs); });
    }, delay);
    timer.unref?.();
  }
  return Object.freeze({
    async read() {
      const selected = scope();
      let stored;
      try { stored = await store.read(selected.scopeKey); }
      catch { current(selected); throw unavailable(); }
      current(selected);
      const snapshot = storedSnapshot(stored, selected);
      return { ...copy(snapshot), instanceId, status: now() - Date.parse(snapshot.checkedAt) > freshMs ? "stale" : "current" };
    },
    refresh,
    start() { if (!closed && !started) { started = true; schedule(0); } },
    async close() { closed = true; started = false; if (timer !== null) clearTimer(timer); timer = null;
      const flight = inFlight; flight?.controller.abort(unavailable()); await flight?.promise.catch(() => {}); },
  });
}
