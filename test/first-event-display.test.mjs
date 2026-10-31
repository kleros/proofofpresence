import assert from "node:assert/strict";
import { test } from "node:test";
import { ethers } from "ethers";
import { createFirstEventDisplay } from "../src/first-event-display.mjs";
import { FIRST_EVENT_MANAGE_SCOPE as scope } from "../src/first-event-manage-scope.mjs";

const hash = n => "0x" + n.toString(16).padStart(64, "0");
const wallet = ethers.getAddress("0x0000000000000000000000000000000000000002");
const secondWallet = ethers.getAddress("0x0000000000000000000000000000000000000003");
const unavailable = error => error.code === "PUBLIC_DEPOSITS_UNAVAILABLE" && error.status === 503;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function memoryStore() {
  const rows = new Map(), locks = new Set();
  let reads = 0, writes = 0, leases = 0;
  return { rows, locks, beforeRead: null,
    get reads() { return reads; }, get writes() { return writes; }, get leases() { return leases; },
    async initialize() {},
    async read(key) { reads++; if (this.beforeRead) await this.beforeRead(); return structuredClone(rows.get(key) ?? null); },
    async write(key, binding, snapshot) { writes++; rows.set(key, structuredClone({ binding, snapshot })); },
    async withLease(key, callback) {
      if (locks.has(key)) return null;
      locks.add(key); leases++;
      try { return await callback(this); } finally { locks.delete(key); }
    },
    async close() {},
  };
}
function fixture(options = {}) {
  const iface = new ethers.Interface(["event Deposited(address indexed from,uint256 amount)"]);
  const logs = [], receipts = new Map(), headers = new Map();
  const record = { definition: { id: scope.eventId }, deployment: { ...scope, eventId: scope.eventId,
    deploymentBlock: 10, deploymentTxHash: hash(10) } };
  const entry = { id: scope.eventId, chainId: 1, contract: scope.contract,
    contractVersion: scope.contractVersion, visibility: "public", editorialStatus: "published",
    adoption: { kind: "recorded-adoption", txHash: hash(10), blockNumber: 10, blockHash: hash(10) } };
  let at = 100000, publish = true, head = 12, gate = null, failed = false, closingReorg = false, instanceId = "test-instance", chain = 1;
  const calls = [], store = options.store ?? memoryStore();
  const provider = {
    send: async (method, params) => { calls.push([method, params]); return "0x" + chain.toString(16); },
    getBlock: async number => {
      calls.push(["block", number]); const selected = number === "latest" ? head : number;
      return { number: selected, hash: headers.get(selected) ?? hash(selected + (closingReorg && number === head ? 100 : 0)) };
    },
    getLogs: async filter => {
      calls.push(["logs", filter]); if (gate) await gate;
      if (failed) throw Error("private upstream diagnostics");
      return logs.filter(log => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock);
    },
    getTransactionReceipt: async txHash => { calls.push(["receipt", txHash]); return receipts.get(txHash.toLowerCase()); },
  };
  const w = { provider, publicCatalog: () => ({ mode: "hosted-production", instanceId,
    environment: { production: true, chainId: 1 }, events: publish ? [entry] : [] }),
    record: () => record, firstEventManageAvailable: id => id === scope.eventId,
    owner: () => { throw Error("Owner verification must not run for public display"); },
    state: () => { throw Error("Private financial state must not load"); },
    depositLedger: () => { throw Error("Private ledger must not load"); },
  };
  function create(id = instanceId, extra = {}) {
    instanceId = id;
    return createFirstEventDisplay(w, { instanceId: id, origin: "https://display.example.invalid", store, now: () => at, ...extra });
  }
  function add(blockNumber, value = 7n, payer = wallet, tx = 100, index = 0) {
    const encoded = iface.encodeEventLog(iface.getEvent("Deposited"), [payer, value]);
    const log = { ...encoded, address: scope.contract, index, blockNumber, blockHash: headers.get(blockNumber) ?? hash(blockNumber),
      transactionHash: hash(tx), removed: false };
    logs.push(log);
    const receipt = { status: 1, hash: hash(tx), blockNumber, blockHash: log.blockHash, logs: [log] };
    receipts.set(hash(tx).toLowerCase(), receipt);
    return { log, receipt };
  }
  const original = add(11);
  return { api: create(), create, w, calls, store, record, entry, iface, logs, receipts, headers, add,
    log: original.log, receipt: original.receipt,
    get scans() { return calls.filter(([method]) => method === "logs").length; },
    time: n => { at += n; }, publish: value => { publish = value; }, fail: value => { failed = value; },
    head: value => { head = value; }, chain: value => { chain = value; },
    reorgClosing: value => { closingReorg = value; }, wait: value => { gate = value; } };
}

test("HTTP display reads only the database, never bootstraps the chain or invents an empty result", async () => {
  const f = fixture();
  await assert.rejects(f.api.read(), unavailable);
  assert.equal(f.calls.length, 0);
  await f.api.refresh();
  const readsBefore = f.calls.length, result = await f.api.read();
  assert.equal(f.calls.length, readsBefore);
  assert.equal(result.displayOnly, true); assert.equal(result.status, "current");
  assert.equal(result.blockNumber, 12); assert.equal(result.instanceId, "test-instance");
  assert.equal(result.depositors[0].wallet, wallet);
  assert.equal(result.depositors[0].totalReceivedWei, "7");
  assert.deepEqual(result.depositors[0].deposits[0], { txHash: hash(100), logIndex: 0,
    amountWei: "7", blockNumber: 11, blockHash: hash(11) });
  const filter = f.calls.find(([method]) => method === "logs")[1];
  assert.equal(filter.address, scope.contract); assert.deepEqual(filter.topics, [f.iface.getEvent("Deposited").topicHash]);
  assert.equal(filter.fromBlock, 10); assert.equal(filter.toBlock, 12);
  for (const key of ["permissions", "participants", "capabilities", "owner", "eligibility", "deploymentTrust"])
    assert.equal(Object.hasOwn(result, key), false);
  result.depositors.length = 0;
  assert.equal((await f.api.read()).depositors.length, 1);
  assert.equal(f.calls.length, readsBefore);
});

test("worker indexes only blocks after its canonical checkpoint and verifies only new receipts", async () => {
  const f = fixture(); await f.api.refresh();
  const receiptsBefore = f.calls.filter(([method]) => method === "receipt").length;
  f.time(16000); f.head(14); f.add(13, 5n, wallet, 101); f.add(14, 3n, secondWallet, 102);
  await f.api.refresh();
  const filter = f.calls.filter(([method]) => method === "logs").at(-1)[1];
  assert.equal(filter.fromBlock, 13); assert.equal(filter.toBlock, 14);
  assert.equal(f.calls.filter(([method]) => method === "receipt").length, receiptsBefore + 2);
  const result = await f.api.read();
  assert.equal(result.depositors[0].totalReceivedWei, "12");
  assert.equal(result.depositors[1].totalReceivedWei, "3");
  const scansBefore = f.scans;
  f.time(16000); await f.api.refresh();
  assert.equal(f.scans, scansBefore, "An unchanged canonical head does not trigger another log scan");
  assert.equal((await f.api.read()).status, "current");
});

test("reorged or rewound checkpoints trigger full birth backfill and remove orphaned rows", async () => {
  const f = fixture(); f.add(12, 9n, secondWallet, 103); await f.api.refresh();
  assert.equal((await f.api.read()).depositors.length, 2);
  f.headers.set(12, hash(212)); f.logs.splice(1); f.head(13); f.time(16000);
  await f.api.refresh();
  assert.equal(f.calls.filter(([method]) => method === "logs").at(-1)[1].fromBlock, 10);
  assert.equal((await f.api.read()).depositors.length, 1);
  f.head(11); f.time(16000); await f.api.refresh();
  assert.equal(f.calls.filter(([method]) => method === "logs").at(-1)[1].fromBlock, 10);
  assert.equal((await f.api.read()).blockNumber, 11);
});

test("stale observations survive worker failure while HTTP remains chain-free and diagnostics-free", async () => {
  const f = fixture(); await f.api.refresh(); const original = await f.api.read();
  f.time(30001); f.head(13); f.fail(true);
  await assert.rejects(f.api.refresh());
  const count = f.calls.length, stale = await f.api.read();
  assert.equal(stale.status, "stale"); assert.equal(stale.checkedAt, original.checkedAt);
  assert.deepEqual(stale.depositors, original.depositors);
  assert.equal(f.calls.length, count); assert.equal(JSON.stringify(stale).includes("private upstream"), false);
  assert.equal(f.store.writes, 1);
});

test("database binding and snapshot must match exact origin, event, chain, child and adoption", async () => {
  const f = fixture(); await f.api.refresh();
  const [key, original] = [...f.store.rows][0], callsBefore = f.calls.length;
  for (const change of [
    row => { row.binding.origin = "https://foreign.example.invalid"; },
    row => { row.binding.chainId = 2; },
    row => { row.binding.contract = wallet; },
    row => { row.binding.adoption.blockHash = hash(999); },
    row => { row.snapshot.eventId = "foreign-event"; },
    row => { row.snapshot.depositors[0].totalReceivedWei = "999"; },
  ]) {
    const bad = structuredClone(original); change(bad); f.store.rows.set(key, bad);
    await assert.rejects(f.api.read(), unavailable);
    assert.equal(f.calls.length, callsBefore);
  }
  const safe = structuredClone(original);
  safe.snapshot.owner = "MUST_NOT_LEAK"; safe.snapshot.depositors[0].email = "MUST_NOT_LEAK";
  safe.binding = Object.fromEntries(Object.entries(safe.binding).reverse());
  safe.binding.adoption = Object.fromEntries(Object.entries(safe.binding.adoption).reverse());
  f.store.rows.set(key, safe);
  assert.equal(JSON.stringify(await f.api.read()).includes("MUST_NOT_LEAK"), false);
});

test("database read failure is a sanitized503 and performs no RPC or refresh", async () => {
  const f = fixture();
  f.store.read = async () => { throw Error("private SQL connection diagnostics"); };
  await assert.rejects(f.api.read(), error => unavailable(error) && !error.message.includes("private SQL"));
  assert.equal(f.calls.length, 0); assert.equal(f.store.writes, 0);
});

test("private/unpublished scope is checked both before and after awaiting database reads", async () => {
  const f = fixture(); await f.api.refresh(); const before = f.calls.length;
  f.publish(false); await assert.rejects(f.api.read(), { code: "NOT_FOUND" });
  assert.equal(f.calls.length, before);
  f.publish(true); let release;
  f.store.beforeRead = () => new Promise(resolve => { release = resolve; });
  const response = f.api.read(); await settle(); f.publish(false); release();
  await assert.rejects(response, { code: "NOT_FOUND" });
  assert.equal(f.calls.length, before);
});

test("parallel worker instances share one database lease and restart serves persisted rows with a new instance ID", async () => {
  const f = fixture(); let release;
  f.wait(new Promise(resolve => { release = resolve; }));
  const first = f.api.refresh(), sameFlight = f.api.refresh(); assert.equal(first, sameFlight);
  const other = f.create();
  await settle();
  assert.equal(await other.refresh(), null);
  assert.equal(f.scans, 1);
  release(); await first;
  assert.equal(f.store.writes, 1);
  await f.api.close(); await other.close();
  const reopened = f.create("restarted-instance");
  const before = f.calls.length, result = await reopened.read();
  assert.equal(result.instanceId, "restarted-instance"); assert.equal(result.depositors.length, 1);
  assert.equal(f.calls.length, before);
  assert.equal(f.store.rows.size, 1, "Ephemeral server instance is excluded from persistent binding");
  await reopened.close();
});

test("canonical receipt, duplicate, chain and closing-anchor failures never replace a successful database snapshot", async () => {
  for (const defect of ["receipt", "duplicate", "closing", "chain"]) {
    const f = fixture(); await f.api.refresh(); const previous = structuredClone([...f.store.rows][0]);
    f.head(13); const added = f.add(13, 4n, wallet, 104); f.time(16000);
    if (defect === "receipt") added.receipt.status = 0;
    if (defect === "duplicate") f.logs.push(added.log);
    if (defect === "closing") f.reorgClosing(true);
    if (defect === "chain") f.chain(2);
    await assert.rejects(f.api.refresh());
    assert.deepEqual([...f.store.rows][0], previous); assert.equal(f.store.writes, 1);
  }
});

test("background startup never blocks an existing DB read and close prevents late worker writes or replay", async () => {
  const f = fixture(); await f.api.refresh();
  let release, entered;
  const begun = new Promise(resolve => { entered = resolve; });
  f.head(13); f.add(13, 2n, wallet, 105);
  f.wait(new Promise(resolve => { release = resolve; }));
  const getLogs = f.w.provider.getLogs;
  f.w.provider.getLogs = async filter => { entered(); return getLogs(filter); };
  f.api.start(); f.api.start();
  await begun;
  const callsBefore = f.calls.length;
  assert.equal((await f.api.read()).depositors[0].totalReceivedWei, "7");
  assert.equal(f.calls.length, callsBefore);
  await f.api.close(); release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.writes, 1);
  f.api.start(); await assert.rejects(f.api.read(), { code: "NOT_FOUND" });
});

test("wrong creation anchor and excessive backfill range fail before accepting public history", async () => {
  const f = fixture(); f.headers.set(10, hash(210)); await assert.rejects(f.api.refresh(), unavailable); assert.equal(f.scans, 0);
  const g = fixture(); g.head(60000); await assert.rejects(g.api.refresh(), unavailable); assert.equal(g.scans, 0);
  await assert.rejects(g.api.read(), unavailable); assert.equal(g.store.writes, 0);
});
