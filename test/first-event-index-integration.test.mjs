// Actual embedded PostgreSQL DDL, JSONB, persistence and lease SQL. Chain reads
// use an explicit synthetic public-log provider; no wallet, key or network exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { ethers } from "ethers";
import { createFirstEventPostgres } from "../src/first-event-postgres.mjs";
import { createFirstEventDisplay } from "../src/first-event-display.mjs";
import { FIRST_EVENT_MANAGE_SCOPE as scope } from "../src/first-event-manage-scope.mjs";

const hash = n => `0x${n.toString(16).padStart(64, "0")}`;
const payer = ethers.getAddress("0x0000000000000000000000000000000000000002");
const iface = new ethers.Interface(["event Deposited(address indexed from,uint256 amount)"]);
const topic = iface.getEvent("Deposited").topicHash;

function chainFixture() {
  const calls = [], scans = [], blocks = new Map([[10, hash(10)], [11, hash(11)], [12, hash(12)]]);
  const receipts = new Map();
  let height = 12, logs = [];
  function deposit(blockNumber, transactionNumber, amount) {
    const txHash = hash(transactionNumber), blockHash = blocks.get(blockNumber);
    const encoded = iface.encodeEventLog(iface.getEvent("Deposited"), [payer, amount]);
    const log = { ...encoded, address: scope.contract, index: 0, blockNumber, blockHash,
      transactionHash: txHash, removed: false };
    logs.push(log);
    receipts.set(txHash, { status: 1, hash: txHash, blockNumber, blockHash, logs: [log] });
    return txHash;
  }
  const firstHash = deposit(11, 100, 7n);
  const provider = {
    async send(method, params) { calls.push([method, params]); assert.equal(method, "eth_chainId"); return "0x1"; },
    async getBlock(value) { calls.push(["getBlock", value]); const number = value === "latest" ? height : value;
      return blocks.has(number) ? { number, hash: blocks.get(number) } : null; },
    async getLogs(filter) {
      calls.push(["getLogs", filter]); scans.push(structuredClone(filter));
      assert.equal(filter.address, scope.contract); assert.deepEqual(filter.topics, [topic]);
      return structuredClone(logs.filter(log => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock));
    },
    async getTransactionReceipt(txHash) { calls.push(["getTransactionReceipt", txHash]); return structuredClone(receipts.get(txHash) ?? null); },
  };
  const record = { definition: { id: scope.eventId }, deployment: { ...scope, eventId: scope.eventId,
    deploymentBlock: 10, deploymentTxHash: hash(10) } };
  const entry = { id: scope.eventId, chainId: 1, contract: scope.contract, contractVersion: scope.contractVersion,
    visibility: "public", editorialStatus: "published", adoption: { kind: "recorded-adoption", txHash: hash(10), blockNumber: 10, blockHash: hash(10) } };
  const forbidden = () => { throw Error("Financial/private state must not be read by the public index"); };
  function workbench(instanceId) {
    return { provider, record: () => record, firstEventManageAvailable: id => id === scope.eventId,
      publicCatalog: () => ({ mode: "hosted-production", instanceId, environment: { production: true, chainId: 1 }, events: [entry] }),
      owner: forbidden, state: forbidden, depositLedger: forbidden, createDraft: forbidden };
  }
  return { calls, scans, firstHash, workbench,
    addNext() { height = 13; blocks.set(13, hash(13)); return deposit(13, 101, 5n); },
    reorgLast() { height = 14; blocks.set(13, hash(1013)); blocks.set(14, hash(1014));
      logs = logs.filter(log => log.blockNumber < 13); receipts.delete(hash(101)); },
  };
}

test("PostgreSQL-backed public index survives restart, reads without RPC and replaces orphaned receipts", { timeout: 90000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "first-event-postgres-index-"));
  const dbPath = path.join(directory, "pgdata"), chain = chainFixture(), sql = [];
  let db = new PGlite(dbPath), store, api, releases = 0;
  function poolFor(database) {
    const query = async (text, values = []) => { sql.push(text); return database.query(text, values); };
    // PGlite has one embedded SQL session. These tests use real advisory SQL,
    // but do not claim cross-process lease contention coverage.
    return { query, async connect() { return { query, release() { releases++; } }; } };
  }
  function indexer(instanceId) { return createFirstEventDisplay(chain.workbench(instanceId), {
    instanceId, origin: "https://first-event-index.example.invalid", store, now: () => 1000000,
  }); }
  t.after(async () => { await api?.close(); await store?.close(); await db?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  store = createFirstEventPostgres({ pool: poolFor(db) });
  await store.initialize(); api = indexer("sql-index-first");
  await api.refresh();
  const firstRPCs = chain.calls.length;
  const first = await api.read();
  assert.equal(first.depositors[0].wallet, payer);
  assert.equal(first.depositors[0].totalReceivedWei, "7");
  assert.equal(first.depositors[0].deposits[0].txHash, chain.firstHash);
  assert.equal(chain.calls.length, firstRPCs, "HTTP display reads must not make even one chain request");
  const metadata = await db.query("SELECT jsonb_typeof(binding) AS binding_type, jsonb_typeof(snapshot) AS snapshot_type FROM kleros_first_event_read_models");
  assert.deepEqual(metadata.rows, [{ binding_type: "object", snapshot_type: "object" }]);
  first.depositors[0].totalReceivedWei = "999";
  assert.equal((await api.read()).depositors[0].totalReceivedWei, "7", "Rows are detached from actual stored JSONB");
  assert.equal(chain.calls.length, firstRPCs);

  await api.close(); await store.close(); await db.close();
  db = new PGlite(dbPath); store = createFirstEventPostgres({ pool: poolFor(db) });
  await store.initialize(); api = indexer("sql-index-restarted");
  const restarted = await api.read();
  assert.equal(restarted.instanceId, "sql-index-restarted");
  assert.equal(restarted.depositors[0].totalReceivedWei, "7");
  assert.equal(chain.calls.length, firstRPCs, "A restarted worker serves persisted rows without a cold chain scan");

  await db.query("UPDATE kleros_first_event_read_models SET snapshot = jsonb_set(snapshot || $1::jsonb, '{depositors,0,email}', to_jsonb($2::text))", [
    JSON.stringify({ permissions: { owner: true }, capabilities: { transactionsReady: true }, session: { wallet: payer } }), "synthetic-private@example.invalid",
  ]);
  const publicOnly = await api.read();
  for (const key of ["permissions", "capabilities", "session", "deploymentTrust", "owner", "eligibility", "participants"])
    assert.equal(Object.hasOwn(publicOnly, key), false);
  assert.equal(JSON.stringify(publicOnly).includes("synthetic-private"), false);
  assert.equal(chain.calls.length, firstRPCs);

  const nextHash = chain.addNext();
  await api.refresh();
  const next = await api.read();
  assert.equal(next.depositors[0].totalReceivedWei, "12");
  assert.equal(next.depositors[0].deposits.length, 2);
  assert.deepEqual(chain.scans.map(scan => [scan.fromBlock, scan.toBlock]), [[10, 12], [13, 13]]);
  await api.refresh();
  const repeated = await api.read();
  assert.equal(repeated.depositors[0].totalReceivedWei, "12");
  assert.equal(repeated.depositors[0].deposits.filter(lot => lot.txHash === nextHash).length, 1);
  assert.equal(chain.scans.length, 2, "An unchanged checkpoint never scans the same history again");

  chain.reorgLast(); await api.refresh();
  const repaired = await api.read();
  assert.equal(repaired.blockNumber, 14);
  assert.equal(repaired.depositors[0].totalReceivedWei, "7");
  assert.deepEqual(repaired.depositors[0].deposits.map(lot => lot.txHash), [chain.firstHash]);
  assert.deepEqual(chain.scans.map(scan => [scan.fromBlock, scan.toBlock]), [[10, 12], [13, 13], [10, 14]]);
  const stored = await db.query("SELECT snapshot -> 'depositors' AS depositors FROM kleros_first_event_read_models");
  assert.equal(JSON.stringify(stored.rows).includes(nextHash), false, "The orphaned lot is removed in persisted SQL, not merely hidden in UI");
  const afterRefreshRPCs = chain.calls.length;
  await api.read(); assert.equal(chain.calls.length, afterRefreshRPCs);
  assert.equal(releases, 4);
  assert(sql.some(text => text.includes("pg_try_advisory_lock")));
  assert(sql.some(text => text === "BEGIN") && sql.some(text => text === "COMMIT"));
  t.diagnostic(JSON.stringify({ kind: "actual-embedded-postgres-index-integration", checks: 6,
    actualSQL: true, actualJSONB: true, persistedEngineRestart: true, advisoryShim: false,
    chain: "synthetic read-only canonical log fixture", scanRanges: chain.scans.map(scan => [scan.fromBlock, scan.toBlock]),
    coldRPCs: firstRPCs, restartedDisplayRPCs: 0, warmDisplayRPCs: 0, externalNetworkRequests: 0, walletRequests: 0 }));
});
