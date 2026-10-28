import assert from "node:assert/strict";
import { test } from "node:test";
import { ethers } from "ethers";
import {
  createDepositInbox,
  indexDepositInbox,
  DEPOSIT_INBOX_LIMITS,
} from "../src/deposit-inbox.mjs";

const addr = (number) =>
  ethers.getAddress(`0x${number.toString(16).padStart(40, "0")}`);
const digest = (number) => `0x${number.toString(16).padStart(64, "0")}`;
function projectionFixture() {
  const iface = new ethers.Interface([
    "event Deposited(address indexed from,uint256 amount)",
    "function deposit() payable",
  ]);
  const encoded = iface.encodeEventLog(iface.getEvent("Deposited"), [
    addr(2),
    4n,
  ]);
  const log = {
    ...encoded,
    address: addr(1),
    index: 0,
    blockNumber: 11,
    blockHash: digest(11),
    transactionHash: digest(100),
    removed: false,
  };
  const receipt = {
    hash: digest(100),
    status: 1,
    blockNumber: 11,
    blockHash: digest(11),
    logs: [log],
  };
  const tx = {
    hash: digest(100),
    from: addr(2),
    to: addr(1),
    value: 4n,
    data: "0x",
  };
  const record = {
    deployment: {
      eventId: "a",
      chainId: 1337,
      contract: addr(1),
      contractVersion: "kleros-event-v8",
      deploymentBlock: 10,
      depositWei: "3",
    },
    participants: new Map(),
  };
  const contract = {
    target: addr(1),
    interface: iface,
    phase: async () => 0n,
    status: async () => 0n,
    owed: async () => 0n,
    challenges: async () => ({ heldShare: 0n }),
    pendingDeposits: async () => 4n,
  };
  const w = {
    chain: {},
    record: () => record,
    provider: {
      getBlock: async (n) => ({
        number: n === "latest" ? 12 : n,
        hash: digest(n === "latest" ? 12 : n),
        timestamp: 1000,
      }),
      getTransactionReceipt: async () => receipt,
      getTransaction: async () => tx,
    },
    depositLedger: async (id, block) => {
      assert.equal(id, "a");
      assert.equal(block, 12);
      return [
        {
          wallet: addr(2),
          receivedWei: "4",
          allocatedWei: "0",
          unallocatedWei: "4",
          transactions: [{ txHash: digest(100), logIndex: 0, amountWei: "4" }],
        },
      ];
    },
  };
  const options = {
    verify: async () => contract,
    payments: async (_chain, _record, options) => {
      assert.equal(options.blockTag, 12);
      return { transfers: [] };
    },
    scan: async (_provider, _filter, from, to, chunk) => {
      assert.deepEqual([from, to, chunk], [10, 12, 5000]);
      return [log];
    },
  };
  return { w, options, log, receipt, tx, contract, record };
}

test("inbox projection pins reads, validates exact canonical lots and accepts wrapper payers", async () => {
  const f = projectionFixture();
  const first = await indexDepositInbox(f.w, "a", f.options);
  assert.deepEqual(first.indexedBlock, {
    number: 12,
    hash: digest(12),
    timestamp: 1000,
  });
  assert.equal(first.rows[0].transactions[0].confirmations, 2);
  assert.equal(first.rows[0].transactions[0].status, "confirmed");
  assert.equal(first.rows[0].pendingCreditWei, "4");
  // Outer caller and target have no identity relationship to the inner payer.
  Object.assign(f.tx, {
    from: addr(99),
    to: addr(88),
    value: 0n,
    data: "0xabcd",
  });
  assert.equal(
    (await indexDepositInbox(f.w, "a", f.options)).rows[0].wallet,
    addr(2),
  );
});

test("inbox rejects missing/failed receipts, forged logs, duplicate lots and noncanonical blocks", async () => {
  for (const mutate of [
    (f) => {
      f.receipt.status = 0;
    },
    (f) => {
      f.receipt.logs = [];
    },
    (f) => {
      f.receipt.logs = [{ ...f.log, data: digest(999) }];
    },
    (f) => {
      f.receipt.blockHash = digest(999);
    },
    (f) => {
      f.tx.value = 3n;
    },
    (f) => {
      f.options.scan = async () => [f.log, f.log];
    },
  ]) {
    const f = projectionFixture();
    mutate(f);
    await assert.rejects(indexDepositInbox(f.w, "a", f.options), (e) =>
      /^INBOX_(RECEIPT|REORG)$/.test(e.code),
    );
  }
});

test("inbox refuses overlong history or excess lots before ledger/payment indexing", async () => {
  const f = projectionFixture();
  f.w.depositLedger = () =>
    assert.fail("must not index the financial ledger after a bound failure");
  await assert.rejects(
    indexDepositInbox(f.w, "a", {
      ...f.options,
      limits: { ...DEPOSIT_INBOX_LIMITS, historyBlocks: 2 },
    }),
    { code: "INBOX_HISTORY_LIMIT" },
  );
  await assert.rejects(
    indexDepositInbox(f.w, "a", {
      ...f.options,
      limits: { ...DEPOSIT_INBOX_LIMITS, lots: 0 },
    }),
    { code: "INBOX_LIMIT" },
  );
});

function cacheFixture() {
  let clock = 1_000_000,
    owner = "owner",
    calls = 0,
    verifications = 0;
  let anchor = digest(12),
    fail = false;
  const record = {
    deployment: {
      eventId: "a",
      chainId: 1337,
      contract: addr(1),
      contractVersion: "kleros-event-v8",
    },
    participants: new Map(),
  };
  const w = {
    chain: {},
    provider: {
      send: async () => "0x539",
      getBlock: async (n) => ({
        number: n === "latest" ? 13 : n,
        hash: n === 12 ? anchor : digest(13),
      }),
    },
    owner: async (id, session) => {
      assert.equal(id, "a");
      if (session !== owner)
        throw Object.assign(new Error("owner only"), { code: "NOT_OWNER" });
      return record;
    },
  };
  const options = {
    instanceId: "server1",
    now: () => clock,
    verify: async () => {
      verifications++;
    },
    index: async () => {
      calls++;
      await new Promise((resolve) => setImmediate(resolve));
      if (fail) throw new Error("secret-provider-url-and-private-internals");
      return {
        source: "contract",
        eventId: "a",
        chainId: 1337,
        contract: record.deployment.contract,
        contractVersion: "kleros-event-v8",
        indexedBlock: { number: 12, hash: anchor, timestamp: 10 },
        latestBlock: 13,
        rows: [
          {
            wallet: addr(2),
            transactions: [{ txHash: digest(100) }],
            pendingCreditWei: "4",
          },
        ],
      };
    },
  };
  return {
    w,
    options,
    record,
    get calls() {
      return calls;
    },
    get verifications() {
      return verifications;
    },
    tick: (ms) => {
      clock += ms;
    },
    reorg: () => {
      anchor = digest(99);
    },
    fail: () => {
      fail = true;
    },
    recover: () => {
      fail = false;
    },
    owner: (value) => {
      owner = value;
    },
  };
}

test("cache singleflight, manual cooldown, fresh provenance checks and exact contact joins", async () => {
  const f = cacheFixture(),
    service = createDepositInbox(f.w, f.options);
  const initial = await Promise.all([
    service.read("a", "owner"),
    service.read("a", "owner"),
    service.read("a", "owner"),
  ]);
  assert.equal(f.calls, 1);
  assert.equal(initial[0].counts.unlinked, 1);
  for (const p of [
    {
      id: "wrong-event",
      eventId: "b",
      wallet: addr(2),
      identityVerified: true,
      name: "Wrong",
    },
    {
      id: "unverified",
      eventId: "a",
      wallet: addr(2),
      identityVerified: false,
      name: "Unverified",
    },
  ])
    f.record.participants.set(p.id, p);
  let view = await service.read("a", "owner");
  assert.equal(view.rows[0].name, null);
  assert.equal(f.calls, 1);
  assert.ok(
    f.verifications >= 2,
    "cached index reuse still verifies provenance",
  );
  f.record.participants.set("linked", {
    id: "linked",
    eventId: "a",
    wallet: addr(2),
    identityVerified: true,
    name: "Synthetic linked",
    email: "synthetic@example.invalid",
    deposit: null,
  });
  view = await service.read("a", "owner", { refresh: true });
  assert.equal(f.calls, 1);
  assert.equal(view.rows[0].linked, true);
  assert.equal(view.rows[0].receiptLinked, false);
  assert.equal(view.rows[0].participantId, "linked");
  f.tick(4999);
  await service.read("a", "owner", { refresh: true });
  assert.equal(f.calls, 1);
  f.tick(1);
  await service.read("a", "owner", { refresh: true });
  assert.equal(f.calls, 2);
  f.tick(30000);
  await service.read("a", "owner");
  assert.equal(f.calls, 3);
});

test("a known reorg hides orphaned rows even when rebuilding fails, without leaking errors", async () => {
  const f = cacheFixture(),
    service = createDepositInbox(f.w, f.options);
  const initial = await service.read("a", "owner");
  f.reorg();
  f.fail();
  const stale = await service.read("a", "owner");
  assert.equal(f.calls, 2);
  assert.equal(stale.stale, true);
  assert.equal(stale.actionable, false);
  assert.deepEqual(stale.rows, []);
  assert.equal(stale.indexedBlock, null);
  assert.equal(stale.error.code, "INBOX_REORG");
  assert.doesNotMatch(JSON.stringify(stale), /secret-provider/);
  f.recover();
  f.tick(30000);
  const rebuilt = await service.read("a", "owner");
  assert.equal(rebuilt.stale, false);
  assert.equal(rebuilt.indexedBlock.hash, digest(99));
});

test("cache is registry scoped and current ownership is checked even before cached access", async () => {
  const f = cacheFixture(),
    service = createDepositInbox(f.w, f.options);
  await service.read("a", "owner");
  f.owner("new-owner");
  await assert.rejects(service.read("a", "owner"), { code: "NOT_OWNER" });
  await service.read("a", "new-owner");
  assert.equal(f.calls, 1);
  f.record.deployment.contract = addr(55);
  const changed = await service.read("a", "new-owner");
  assert.equal(f.calls, 2);
  assert.equal(changed.contract, addr(55));
  const otherServer = createDepositInbox(f.w, {
    ...f.options,
    instanceId: "server2",
  });
  await otherServer.read("a", "new-owner");
  assert.equal(f.calls, 3);
});

test("unavailable current ownership never discloses cached contacts, and a wrong chain fails cache reuse closed", async () => {
  const f = cacheFixture(),
    service = createDepositInbox(f.w, f.options);
  await service.read("a", "owner");
  f.w.provider.send = async () => "0x1";
  const wrongChain = await service.read("a", "owner");
  assert.equal(wrongChain.stale, true);
  assert.equal(wrongChain.error.code, "INBOX_CHAIN");
  assert.equal(wrongChain.rows[0].actionable, false);
  assert.equal(f.calls, 1);
  f.w.owner = async () => {
    throw new Error("private-provider-internals");
  };
  await assert.rejects(service.read("a", "owner"), (error) => {
    assert.equal(error.code, "INBOX_OWNER_UNAVAILABLE");
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /private-provider/);
    return true;
  });
});

test("first index failure returns an explicit empty stale status and recovers only through a successful bounded index", async () => {
  const f = cacheFixture(),
    service = createDepositInbox(f.w, f.options);
  f.fail();
  let view = await service.read("a", "owner");
  assert.equal(view.stale, true);
  assert.equal(view.indexedBlock, null);
  assert.deepEqual(view.rows, []);
  assert.equal(view.lastSyncedAt, null);
  assert.deepEqual(view.counts, {
    payers: 0,
    linked: 0,
    unlinked: 0,
    transactions: 0,
  });
  f.recover();
  view = await service.read("a", "owner");
  assert.equal(view.stale, true);
  assert.equal(f.calls, 1);
  f.tick(30000);
  view = await service.read("a", "owner");
  assert.equal(view.stale, false);
  assert.equal(view.error, null);
  assert.equal(f.calls, 2);
});

test("transient indexing failure preserves still-canonical last-good rows as explicitly non-actionable", async () => {
  const f = cacheFixture(),
    service = createDepositInbox(f.w, f.options);
  const before = await service.read("a", "owner");
  f.fail();
  f.tick(30000);
  const stale = await service.read("a", "owner");
  assert.deepEqual(stale.indexedBlock, before.indexedBlock);
  assert.equal(stale.rows.length, 1);
  assert.equal(stale.rows[0].actionable, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.error.code, "INBOX_UNAVAILABLE");
});

test("client timeout aborts new work and retains underlying singleflight until the actual operation ends", async () => {
  const f = cacheFixture();
  let release,
    starts = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const base = f.options.index;
  const service = createDepositInbox(f.w, {
    ...f.options,
    limits: { ...DEPOSIT_INBOX_LIMITS, timeoutMs: 10 },
    index: async (...args) => {
      starts++;
      if (starts === 1) await gate;
      return base(...args);
    },
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    let view = await service.read("a", "owner");
    assert.equal(view.error.code, "INBOX_TIMEOUT");
    assert.equal(view.syncing, true);
    assert.equal(view.stale, true);
    assert.equal(starts, 1);
    f.tick(30000);
    view = await service.read("a", "owner", { refresh: true });
    assert.equal(
      starts,
      1,
      "a timed-out but pending RPC must not start another index job",
    );
    assert.equal(view.syncing, true);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    // The late result was aborted, not silently committed as a successful index.
    view = await service.read("a", "owner");
    assert.equal(view.stale, true);
    assert.equal(view.indexedBlock, null);
    f.tick(30000);
    view = await service.read("a", "owner");
    assert.equal(starts, 2);
    assert.equal(view.stale, false);
  } finally {
    clearTimeout(keepAlive);
    release();
  }
});

test("ownership changing during an awaited index prevents final contact disclosure", async () => {
  const f = cacheFixture(),
    base = f.options.index;
  const service = createDepositInbox(f.w, {
    ...f.options,
    index: async (...args) => {
      const snapshot = await base(...args);
      f.owner("new-owner");
      return snapshot;
    },
  });
  await assert.rejects(service.read("a", "owner"), { code: "NOT_OWNER" });
  assert.equal((await service.read("a", "new-owner")).stale, false);
});
