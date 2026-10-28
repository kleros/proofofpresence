// Independent read-only receipt/state proof. UI initiation must be established
// separately by the browser trace/screenshots; a chain receipt cannot prove it.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { verifyDeployment } from "../src/chain.mjs";
import { assertUiDepositRequest } from "./chiado-ui-deposit-guards.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const OBSERVER_SHA256 = sha(fs.readFileSync(fileURLToPath(import.meta.url)));
const PHASES = ["Open", "Listed", "Finalized", "Cancelled"];
const json = (data) =>
  JSON.stringify(data, (_, v) => (typeof v === "bigint" ? String(v) : v), 2) +
  "\n";

export async function auditDeposit({ manifestFile, eventId, wallet, txHash }) {
  const file = path.resolve(ROOT, manifestFile);
  assert.equal(
    path.dirname(file),
    path.join(ROOT, "registry"),
    "Use a reviewed public registry file",
  );
  assert.match(path.basename(file), /^chiado-[a-zA-Z0-9_-]+\.json$/);
  assert.ok(ethers.isAddress(wallet));
  assert.ok(ethers.isHexString(txHash, 32));
  const bytes = fs.readFileSync(file),
    manifest = JSON.parse(bytes);
  assert.equal(manifest.chain.chainId, 10200);
  assert.equal(manifest.environment, "testnet");
  assert.equal(manifest.arbitration.mode, "controlled");
  assert.equal(manifest.chain.rpcUrl, "https://rpc.chiadochain.net");
  const origin = new URL(manifest.publicOrigin);
  assert.ok(
    origin.protocol === "https:" &&
      origin.hostname.endsWith(".netlify.app") &&
      origin.pathname === "/" &&
      !origin.username &&
      !origin.password &&
      !origin.search &&
      !origin.hash,
    "Exact public Netlify test origin required",
  );
  const record = manifest.events.find((item) => item.definition.id === eventId);
  assert.ok(record, "Exact scenario event must exist");
  const d = record.deployment;
  assert.equal(d.eventId, eventId);
  assert.equal(d.chainId, 10200);
  assert.equal(d.contractVersion, "kleros-event-v8");
  assert.equal(d.abiVersion, "kleros-event-v8");
  const request = new ethers.FetchRequest(manifest.chain.rpcUrl);
  request.timeout = 60_000;
  const provider = new ethers.JsonRpcProvider(request, 10200, {
    cacheTimeout: -1,
  });
  try {
    assert.equal(Number((await provider.getNetwork()).chainId), 10200);
    const c = await verifyDeployment({ provider }, d);
    const [receipt, tx] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getTransaction(txHash),
    ]);
    assert.ok(receipt && tx, "Deposit must actually be mined");
    assert.equal(receipt.status, 1);
    assert.ok(same(tx.from, wallet) && same(receipt.from, wallet));
    assert.ok(same(receipt.to, d.contract));
    const normalized = assertUiDepositRequest(
      {
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        chainId: tx.chainId,
      },
      {
        chainId: 10200,
        eventId,
        wallet,
        contract: d.contract,
        valueWei: d.depositWei,
        depositOpensAt: d.depositOpensAt,
        eventStart: d.eventStart,
      },
    );
    const [block, head] = await Promise.all([
      provider.getBlock(receipt.blockNumber),
      provider.getBlock("latest"),
    ]);
    assert.equal(receipt.blockHash, block.hash);
    assert.ok(
      head.number - block.number + 1 >= 2,
      "At least two confirmations required",
    );
    assert.ok(
      block.timestamp >= d.depositOpensAt && block.timestamp < d.eventStart,
      "Canonical block lies inside deposit window",
    );
    const logs = receipt.logs
      .filter((log) => same(log.address, d.contract))
      .map((log) => ({ log, event: c.interface.parseLog(log) }));
    assert.equal(
      logs.length,
      1,
      "A plain UI deposit has exactly one child log",
    );
    assert.equal(logs[0].event.name, "Deposited");
    assert.ok(same(logs[0].event.args.from, wallet));
    assert.equal(String(logs[0].event.args.amount), d.depositWei);
    const sameBlock = await provider.getLogs({
      address: d.contract,
      fromBlock: block.number,
      toBlock: block.number,
    });
    assert.ok(
      sameBlock.every((log) => same(log.transactionHash, txHash)),
      "Other child operations in this block require transaction-level tracing; block-delta proof cannot assume isolation",
    );
    const snapshot = async (n) => {
      const at = { blockTag: n };
      const [credit, pending, count, phase, status, reserve, balance, owed] =
        await Promise.all([
          c.pendingDeposits(wallet, at),
          c.pendingTotal(at),
          c.stakerCount(at),
          c.phase(at),
          c.status(wallet, at),
          c.reserved(at),
          provider.getBalance(d.contract, n),
          c.owedTotal(at),
        ]);
      return { credit, pending, count, phase, status, reserve, balance, owed };
    };
    const [before, after] = await Promise.all([
      snapshot(block.number - 1),
      snapshot(block.number),
    ]);
    for (const field of ["credit", "pending", "reserve", "balance"])
      assert.equal(
        after[field] - before[field],
        normalized.value,
        `Exact deposit increases ${field}`,
      );
    for (const field of ["count", "phase", "status", "owed"])
      assert.equal(
        after[field],
        before[field],
        `Deposit is separate from ${field}`,
      );
    assert.equal(after.phase, 0n, "Deposit remains Open");
    assert.ok(after.balance >= after.reserve);
    const response = await fetch(
      new URL(`/api/events/${encodeURIComponent(eventId)}`, origin),
      {
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      },
    );
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.event.id, eventId);
    assert.ok(same(detail.event.contract, d.contract));
    assert.equal(detail.event.chainId, 10200);
    assert.equal(detail.event.contractVersion, "kleros-event-v8");
    assert.equal(detail.event.abiVersion, "kleros-event-v8");
    assert.equal(detail.event.depositWei, d.depositWei);
    assert.equal(detail.event.depositOpensAt, d.depositOpensAt);
    assert.equal(detail.event.depositDeadline, d.eventStart);
    assert.ok(same(detail.event.resolver, d.resolver));
    assert.ok(same(detail.event.arbitrator, d.arbitrator));
    const apiBlock = await provider.getBlock(detail.state.blockNumber);
    assert.ok(
      apiBlock.number >= block.number,
      "App must not be behind the confirmed deposit",
    );
    assert.equal(apiBlock.timestamp, detail.state.now);
    const current = await snapshot(apiBlock.number);
    assert.equal(detail.state.phase, PHASES[Number(current.phase)]);
    assert.equal(detail.event.financialPhase, PHASES[Number(current.phase)]);
    assert.equal(detail.state.pendingTotalWei, String(current.pending));
    assert.equal(detail.state.stakerCount, Number(current.count));
    assert.equal(detail.state.depositWei, d.depositWei);
    assert.equal(
      detail.state.poolWei,
      String(current.count * BigInt(d.depositWei)),
    );
    assert.equal(detail.state.owedTotalWei, String(current.owed));
    assert.equal(detail.state.balanceWei, String(current.balance));
    assert.equal(detail.state.reservedWei, String(current.reserve));
    const apiHead = await provider.getBlock("latest");
    assert.ok(
      apiHead.number >= apiBlock.number &&
        apiHead.number - apiBlock.number <= 20 &&
        apiHead.timestamp - apiBlock.timestamp <= 90,
      "Public app checkpoint is near current head",
    );
    if (apiHead.number > apiBlock.number)
      assert.equal(
        (
          await provider.getLogs({
            address: d.contract,
            fromBlock: apiBlock.number + 1,
            toBlock: apiHead.number,
          })
        ).length,
        0,
        "No newer child activity may be omitted by the app; refresh if this fails",
      );
    const headSnapshot = await snapshot(apiHead.number);
    assert.deepEqual(
      headSnapshot,
      current,
      "Checked financial facts still agree at head, including forced ETH without child logs",
    );
    assert.equal(
      (await provider.getBlock(block.number)).hash,
      block.hash,
      "Deposit remains canonical",
    );
    assert.equal(
      (await provider.getBlock(apiBlock.number)).hash,
      apiBlock.hash,
      "App checkpoint remains canonical",
    );
    assert.equal(
      (await provider.getBlock(apiHead.number)).hash,
      apiHead.hash,
      "Head comparison remains canonical",
    );
    return {
      status: "passed-deposit-chain-and-public-api-only",
      checkedAt: new Date().toISOString(),
      observerSha256: OBSERVER_SHA256,
      manifestSha256: sha(bytes),
      manifestFile: path.relative(ROOT, file),
      origin: origin.origin,
      chainId: 10200,
      eventId,
      contract: d.contract,
      wallet: ethers.getAddress(wallet),
      txHash,
      blockNumber: block.number,
      blockHash: block.hash,
      logIndex: logs[0].log.index,
      blockTimestamp: block.timestamp,
      confirmationsAtCheck: head.number - block.number + 1,
      amountWei: d.depositWei,
      before,
      after,
      appBlockNumber: apiBlock.number,
      appSnapshot: current,
      appHeadNumber: apiHead.number,
      appHeadHash: apiHead.hash,
      uiInitiationVerified: false,
      signatures: 0,
      broadcasts: 0,
      notice:
        "Canonical receipt and block-delta proof only. Same-block child operations are rejected as ambiguous. Unchanged count/status proves on-chain registration only; off-chain approval needs authenticated evidence. Actual UI initiation, review, single wallet submission and role screenshots need separate browser evidence. The fresh API snapshot may reflect subsequent registration; the historical credit checkpoint remains precise.",
    };
  } finally {
    provider.destroy();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    opts = {};
  assert.equal(
    args.length,
    8,
    "Use --manifest registry/chiado-....json --event-id ID --wallet ADDRESS --tx HASH",
  );
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(
      ["--manifest", "--event-id", "--wallet", "--tx"].includes(args[i]) &&
        !Object.hasOwn(opts, args[i]),
    );
    opts[args[i]] = args[i + 1];
  }
  const out = path.join(ROOT, "artifacts/chiado-deposit-receipt-audit");
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(
    out,
    new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomUUID() +
      ".json",
  );
  try {
    const result = await auditDeposit({
      manifestFile: opts["--manifest"],
      eventId: opts["--event-id"],
      wallet: opts["--wallet"],
      txHash: opts["--tx"],
    });
    fs.writeFileSync(file, json(result), { flag: "wx" });
    console.log(
      json({
        status: result.status,
        evidence: file,
        uiInitiationVerified: false,
        signatures: 0,
        broadcasts: 0,
      }),
    );
  } catch (error) {
    fs.writeFileSync(
      file,
      json({
        status: "failed",
        checkedAt: new Date().toISOString(),
        observerSha256: OBSERVER_SHA256,
        error: error.message,
        uiInitiationVerified: false,
        signatures: 0,
        broadcasts: 0,
      }),
      { flag: "wx" },
    );
    console.error(error.message);
    process.exitCode = 1;
  }
}
