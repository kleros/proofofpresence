// Independent observer for the existing controlled Chiado rehearsal.
// GET-only app access + public RPC reads. No auth, private files, signer or broadcast.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ethers } from "ethers";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ORIGIN = "https://kleros-event-workbench-preview.netlify.app";
const PHASES = ["Open", "Listed", "Finalized", "Cancelled"];
const CASES = ["None", "Waiting", "Disputed", "Resolved"];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const textJson = (data) =>
  JSON.stringify(
    data,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ) + "\n";
const sum = (values) => values.reduce((total, n) => total + BigInt(n), 0n);
const knownRuling = (value) =>
  Number.isInteger(value) && [0, 1, 2].includes(value);
const OBSERVER_SHA256 = createHash("sha256")
  .update(fs.readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");

export function reconcileTransfers(actual, expected) {
  const canonical = (row) => ({
    ...Object.fromEntries(
      [
        "type",
        "amountWei",
        "blockNumber",
        "logIndex",
        "successful",
        "sourceMethod",
      ].map((k) => [k, row[k]]),
    ),
    wallet: row.wallet.toLowerCase(),
    recipient: row.recipient?.toLowerCase() ?? null,
    txHash: row.txHash.toLowerCase(),
  });
  const key = (row) => `${row.txHash.toLowerCase()}:${row.logIndex}`;
  assert.equal(
    actual.length,
    expected.length,
    "Every canonical payment has exactly one API row",
  );
  assert.equal(
    new Set(actual.map(key)).size,
    actual.length,
    "No duplicate payment rows",
  );
  const order = (rows) =>
    rows.map(canonical).sort((a, b) => key(a).localeCompare(key(b)));
  assert.deepEqual(
    order(actual),
    order(expected),
    "Every payment wallet, recipient, amount and receipt agrees",
  );
}

export function expectedUi(state) {
  const waiting = state.cases.filter((c) => c.state === "Waiting");
  return {
    depositsOpen: state.phase === "Open" && state.now < state.eventStart,
    ordinaryBatchProcessed: state.phase === "Finalized",
    canReleaseOnChain:
      state.phase === "Listed" &&
      state.now > state.challengeEndsAt &&
      waiting.every((c) => state.now > c.matchEndsAt),
    allFinancialObligationsComplete:
      ["Finalized", "Cancelled"].includes(state.phase) &&
      state.pendingChallenges === 0 &&
      [
        "heldBackWei",
        "challengeEscrowWei",
        "owedTotalWei",
        "pendingTotalWei",
      ].every((key) => BigInt(state[key]) === 0n),
    cases: state.cases.map((c) => ({
      wallet: c.wallet,
      label:
        c.finalRuling !== null &&
        c.finalRuling !== undefined &&
        !knownRuling(c.finalRuling)
          ? "Final ruling unavailable · refresh status"
          : c.state === "Waiting"
            ? state.now > c.matchEndsAt
              ? "Unmatched window expired · settlement available"
              : "Challenge waiting for a match"
            : c.state === "Disputed"
              ? knownRuling(c.finalRuling)
                ? "Final result available · settlement pending"
                : state.arbitrationMode === "controlled"
                  ? "Matched controlled test dispute · awaiting final result"
                  : "Matched Court case open"
              : c.state === "Resolved"
                ? "Challenge settled"
                : "No challenge",
      canResolveOnChain:
        c.finalRuling !== null &&
        c.finalRuling !== undefined &&
        !knownRuling(c.finalRuling)
          ? false
          : c.state === "Waiting"
            ? state.now > c.matchEndsAt
            : c.state === "Disputed" && knownRuling(c.finalRuling),
      localDisputeID: c.matched ? c.localDisputeID : null,
      arbitratorDisputeID: c.matched ? c.arbitratorDisputeID : null,
    })),
  };
}

function selfTest() {
  const base = {
    phase: "Listed",
    now: 100,
    eventStart: 10,
    challengeEndsAt: 99,
    pendingChallenges: 1,
    heldBackWei: "0",
    challengeEscrowWei: "21",
    owedTotalWei: "0",
    pendingTotalWei: "0",
    cases: [
      {
        wallet: "synthetic",
        state: "Waiting",
        matched: false,
        matchEndsAt: 101,
        localDisputeID: "0",
        arbitratorDisputeID: "0",
        finalRuling: null,
      },
    ],
  };
  assert.equal(expectedUi(base).canReleaseOnChain, false);
  assert.equal(expectedUi(base).cases[0].localDisputeID, null);
  assert.equal(expectedUi({ ...base, now: 102 }).canReleaseOnChain, true);
  assert.equal(
    expectedUi({ ...base, now: 102 }).cases[0].label,
    "Unmatched window expired · settlement available",
  );
  const ruled = {
    ...base,
    cases: [
      {
        ...base.cases[0],
        state: "Disputed",
        matched: true,
        localDisputeID: "0",
        arbitratorDisputeID: "1000",
        finalRuling: 0,
      },
    ],
  };
  assert.equal(
    expectedUi(ruled).cases[0].label,
    "Final result available · settlement pending",
  );
  assert.equal(expectedUi(ruled).cases[0].canResolveOnChain, true);
  assert.equal(expectedUi(ruled).cases[0].localDisputeID, "0");
  for (const finalRuling of [3, -1, "0", NaN])
    assert.equal(
      expectedUi({ ...ruled, cases: [{ ...ruled.cases[0], finalRuling }] })
        .cases[0].canResolveOnChain,
      false,
    );
  assert.equal(
    expectedUi({
      ...base,
      arbitrationMode: "controlled",
      cases: [{ ...ruled.cases[0], finalRuling: null }],
    }).cases[0].label,
    "Matched controlled test dispute · awaiting final result",
  );
  assert.equal(
    expectedUi({
      ...ruled,
      cases: [{ ...ruled.cases[0], finalRuling: undefined }],
    }).cases[0].canResolveOnChain,
    false,
  );
  assert.equal(
    expectedUi({ ...ruled, phase: "Finalized", heldBackWei: "101" })
      .allFinancialObligationsComplete,
    false,
  );
  assert.equal(
    expectedUi({
      ...base,
      phase: "Finalized",
      pendingChallenges: 0,
      challengeEscrowWei: "0",
      cases: [],
    }).allFinancialObligationsComplete,
    true,
  );
  assert.equal(
    expectedUi({ ...base, phase: "Open", now: 10, cases: [] }).depositsOpen,
    false,
  );
  const payment = {
    type: "attendance-payout",
    wallet: "0xabc",
    recipient: "0xabc",
    amountWei: "100",
    txHash: "0x123",
    blockNumber: 1,
    logIndex: 0,
    successful: true,
    sourceMethod: "releasePayouts",
  };
  reconcileTransfers([payment], [payment]);
  assert.throws(() =>
    reconcileTransfers([{ ...payment, wallet: "0xdef" }], [payment]),
  );
  assert.throws(() => reconcileTransfers([payment, payment], [payment]));
  console.log(
    "Observer self-test passed: deadline boundaries, valid local ID0, final ruling0, held obligations and deposit cutoff. No network requests.",
  );
}

export async function audit() {
  const manifestPath = path.join(ROOT, "registry/chiado-v8-controlled.json");
  const bytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.chain.chainId, 10200);
  assert.equal(manifest.arbitration.mode, "controlled");
  assert.equal(manifest.publicOrigin, ORIGIN);
  assert.equal(new URL(manifest.chain.rpcUrl).protocol, "https:");
  const artifact = JSON.parse(
    fs.readFileSync(path.join(ROOT, "build/contracts/KlerosEventV8.json")),
  );
  assert.equal(
    ethers.keccak256(artifact.bytecode),
    manifest.provenance.creationCodeHashes.KlerosEventV8,
  );
  const request = new ethers.FetchRequest(manifest.chain.rpcUrl);
  request.timeout = 60_000;
  const provider = new ethers.JsonRpcProvider(request, 10200, {
    cacheTimeout: -1,
  });
  let checks = 0;
  const eq = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    checks++;
  };
  const readApp = async (relative) => {
    const url = new URL(relative, ORIGIN);
    eq(url.origin, ORIGIN, "Fixed authorized app origin");
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    eq(response.status, 200, "Public app responds");
    return response.json();
  };
  try {
    eq(Number((await provider.getNetwork()).chainId), 10200, "RPC is Chiado");
    const boot = await readApp("/api/bootstrap");
    eq(boot.mode, "hosted-testnet", "Live app mode");
    eq(boot.chain.chainId, 10200, "Live UI network");
    eq(boot.chain.rpcUrl, manifest.chain.rpcUrl, "UI RPC binding");
    eq(
      boot.chain.nativeCurrency,
      manifest.chain.nativeCurrency,
      "UI native currency and decimals",
    );
    eq(
      boot.arbitration.mode,
      "controlled",
      "Controlled arbitration is explicit",
    );
    eq(boot.identities, [], "No demo impersonation identities");
    const events = [];
    for (const record of manifest.events) {
      const d = await readApp(
        "/api/events/" + encodeURIComponent(record.definition.id),
      );
      const s = d.state,
        deployment = record.deployment;
      eq(d.event.id, record.definition.id, "Stable event identity");
      eq(
        d.event.contract.toLowerCase(),
        deployment.contract.toLowerCase(),
        "Exact child",
      );
      eq(d.event.contractVersion, "kleros-event-v8", "Explicit version");
      for (const field of [
        "abiVersion",
        "chainId",
        "depositWei",
        "depositOpensAt",
        "depositDeadline",
        "claimDeadline",
      ])
        eq(d.event[field], deployment[field], `UI event ${field}`);
      eq(d.event.startsAt, record.definition.startsAt, "UI event start");
      eq(d.participants, [], "Anonymous view protects participant records");
      eq(
        d.transactions,
        [],
        "Anonymous view protects wallet submission journals",
      );
      eq(d.permissions.authenticated, false, "Observer has no signing session");
      if (Object.hasOwn(d, "ownWallet"))
        eq(
          d.ownWallet,
          null,
          "Anonymous observer cannot read private wallet credit",
        );
      const block = await provider.getBlock(s.blockNumber);
      assert.ok(block);
      checks++;
      eq(block.timestamp, s.now, "API snapshot uses actual chain timestamp");
      eq(
        d.payments.blockNumber,
        block.number,
        "Payments share the state block",
      );
      eq(d.payments.blockHash, block.hash, "Payments use the canonical block");
      const at = { blockTag: block.number };
      const c = new ethers.Contract(
        deployment.contract,
        artifact.abi,
        provider,
      );
      eq(
        ethers.keccak256(await provider.getCode(c.target, block.number)),
        deployment.codeHash,
        "Reviewed child runtime",
      );
      eq(
        ethers.keccak256(
          await provider.getCode(deployment.factory, block.number),
        ),
        deployment.factoryCodeHash,
        "Reviewed factory runtime",
      );
      const names = [
        "owner",
        "pendingOwner",
        "stakerCount",
        "attendeeCount",
        "challengeEndsAt",
        "pendingChallenges",
        "heldBack",
        "pendingTotal",
        "owedTotal",
        "reserved",
        "spare",
        "payoutShare",
        "depositAmount",
        "eventStart",
        "claimDeadline",
        "disputeResolver",
        "arbitrator",
        "challengeDeposit",
      ];
      const values = await Promise.all(names.map((name) => c[name](at)));
      const v = Object.fromEntries(names.map((name, i) => [name, values[i]]));
      const [phase, history, attendees, challengers, balance] =
        await Promise.all([
          c.phase(at),
          c.stakers(at),
          c.attendees(at),
          c.challengers(at),
          provider.getBalance(c.target, block.number),
        ]);
      eq(s.phase, PHASES[Number(phase)], "API phase");
      eq(s.owner.toLowerCase(), v.owner.toLowerCase(), "Fresh owner");
      eq(
        s.pendingOwner.toLowerCase(),
        v.pendingOwner.toLowerCase(),
        "Fresh pending owner",
      );
      for (const key of [
        "stakerCount",
        "attendeeCount",
        "challengeEndsAt",
        "pendingChallenges",
      ])
        eq(s[key], Number(v[key]), key);
      for (const [field, name] of Object.entries({
        heldBackWei: "heldBack",
        pendingTotalWei: "pendingTotal",
        owedTotalWei: "owedTotal",
        reservedWei: "reserved",
        spareWei: "spare",
        payoutShareWei: "payoutShare",
        depositWei: "depositAmount",
        challengeDepositWei: "challengeDeposit",
      }))
        eq(s[field], v[name].toString(), field);
      eq(s.balanceWei, balance.toString(), "Native custody");
      eq(
        v.eventStart.toString(),
        String(deployment.eventStart),
        "Immutable deposit cutoff",
      );
      eq(
        v.claimDeadline.toString(),
        String(deployment.claimDeadline),
        "Immutable claim deadline",
      );
      eq(
        v.disputeResolver.toLowerCase(),
        deployment.resolver.toLowerCase(),
        "Bound resolver",
      );
      eq(
        v.arbitrator.toLowerCase(),
        deployment.arbitrator.toLowerCase(),
        "Bound arbitrator",
      );
      eq(
        [...history].map((x) => x.toLowerCase()),
        s.stakerHistory.map((x) => x.toLowerCase()),
        "Lifetime history",
      );
      const statuses = await Promise.all(
        history.map((wallet) => c.status(wallet, at)),
      );
      for (const [field, allowed] of [
        ["activeStakers", [1]],
        ["stakers", [1, 2]],
      ])
        eq(
          s[field].map((wallet) => wallet.toLowerCase()),
          history
            .filter((_, i) => allowed.includes(Number(statuses[i])))
            .map((wallet) => wallet.toLowerCase()),
          `On-chain ${field}`,
        );
      eq(
        [...attendees].map((x) => x.toLowerCase()),
        s.attendees.map((x) => x.toLowerCase()),
        "Attendance list",
      );
      eq(s.lifetimeAdmittedCount, history.length, "Lifetime admission count");
      eq(
        s.remainingAdmissionSlots,
        150 - history.length,
        "Lifetime admission slots",
      );
      eq(
        s.poolWei,
        (v.stakerCount * v.depositAmount).toString(),
        "Original committed pool, not unpaid balance",
      );
      const cases = [];
      const resolver = new ethers.Contract(
        deployment.resolver,
        [
          "function disputes(uint256) view returns(bytes arbitratorExtraData,bool isRuled,uint256 ruling,uint256 disputeIDOnArbitratorSide)",
        ],
        provider,
      );
      for (const wallet of challengers) {
        const on = await c.challenges(wallet, at);
        const api = s.cases.find((item) => same(item.wallet, wallet));
        assert.ok(api);
        checks++;
        const matched = !same(on.matcher, ethers.ZeroAddress);
        eq(api.state, CASES[Number(on.state)], "Case state");
        eq(api.matched, matched, "Matched identity");
        for (const [field, value] of Object.entries({
          matcher: on.matcher,
          matchEndsAt: Number(on.matchEndsAt),
          depositWei: on.deposit.toString(),
          heldShareWei: on.heldShare.toString(),
          caseOrganizer: await c.caseOrganizer(wallet, at),
        }))
          eq(api[field], value, field);
        eq(
          api.localDisputeID,
          matched ? on.localDisputeID.toString() : null,
          "Local ID0 exists only for a matched case",
        );
        eq(
          api.arbitratorDisputeID,
          matched ? on.arbitratorDisputeID.toString() : null,
          "Court ID",
        );
        let finalRuling = null;
        if (matched && Number(on.state) >= 2) {
          const resolved = await resolver.disputes(on.localDisputeID, at);
          eq(
            resolved.disputeIDOnArbitratorSide.toString(),
            on.arbitratorDisputeID.toString(),
            "Resolver/Court ID linkage",
          );
          finalRuling = resolved.isRuled ? Number(resolved.ruling) : null;
          eq(
            api.caseURI,
            (await c.caseMetaEvidence(wallet, at))[1],
            "Immutable case evidence URI",
          );
        }
        eq(
          api.finalRuling,
          finalRuling,
          "Only delivered final ruling, including0",
        );
        cases.push({
          ...api,
          arbitrationPaidWei: on.arbitrationPaid.toString(),
        });
      }
      eq(
        s.cases.length,
        challengers.length,
        "All case records are scoped to this event",
      );
      eq(
        Number(v.pendingChallenges),
        cases.filter((item) => ["Waiting", "Disputed"].includes(item.state))
          .length,
        "Pending case count",
      );
      const escrow = sum(
        cases.map((item) =>
          item.state === "Waiting"
            ? item.depositWei
            : item.state === "Disputed"
              ? 2n * BigInt(item.depositWei) - BigInt(item.arbitrationPaidWei)
              : 0n,
        ),
      );
      eq(
        escrow.toString(),
        s.challengeEscrowWei,
        "Independent challenge collateral",
      );
      eq(
        sum(cases.map((item) => item.heldShareWei)).toString(),
        s.heldBackWei,
        "Individual held shares sum",
      );
      const reserve =
        (Number(phase) <= 1 ? v.stakerCount * v.depositAmount : v.heldBack) +
        v.pendingTotal +
        v.owedTotal +
        escrow;
      eq(reserve.toString(), s.reservedWei, "Independent reserve formula");
      assert.ok(balance >= reserve, "Balance covers protected liabilities");
      checks++;
      eq((balance - reserve).toString(), s.spareWei, "Only surplus is spare");
      const logs = [];
      for (
        let from = deployment.deploymentBlock;
        from <= block.number;
        from += 2500
      )
        logs.push(
          ...(await provider.getLogs({
            address: c.target,
            fromBlock: from,
            toBlock: Math.min(from + 2499, block.number),
          })),
        );
      const known = [];
      for (const log of logs) {
        try {
          const parsed = c.interface.parseLog(log);
          if (parsed) known.push({ log, parsed });
        } catch {}
      }
      known.sort(
        (a, b) =>
          a.log.blockNumber - b.log.blockNumber || a.log.index - b.log.index,
      );
      const receipts = new Map();
      const operations = [];
      const expectedTransfers = [];
      const registered = new Set();
      const rejected = new Map();
      const totals = {
        attendance: 0n,
        failed: 0n,
        claimed: 0n,
        pending: 0n,
        successful: 0n,
      };
      for (const { log, parsed } of known) {
        let proof = receipts.get(log.transactionHash);
        if (!proof) {
          const [receipt, tx, canonical] = await Promise.all([
            provider.getTransactionReceipt(log.transactionHash),
            provider.getTransaction(log.transactionHash),
            provider.getBlock(log.blockNumber),
          ]);
          eq(receipt.status, 1, "Canonical successful event receipt");
          eq(receipt.blockHash, log.blockHash, "Receipt/log block");
          eq(canonical.hash, log.blockHash, "Receipt remains canonical");
          let method = null;
          try {
            if (same(tx.to, c.target))
              method = c.interface.parseTransaction({
                data: tx.data,
                value: tx.value,
              }).name;
          } catch {}
          const names = receipt.logs
            .filter((item) => same(item.address, c.target))
            .flatMap((item) => {
              try {
                return [c.interface.parseLog(item).name];
              } catch {
                return [];
              }
            });
          proof = {
            txHash: log.transactionHash,
            blockNumber: receipt.blockNumber,
            blockHash: receipt.blockHash,
            from: tx.from,
            to: tx.to,
            valueWei: tx.value.toString(),
            method,
            names,
          };
          receipts.set(log.transactionHash, proof);
        }
        operations.push({
          event: parsed.name,
          ...proof,
          logIndex: log.index,
          args: [...parsed.args].map((value) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        });
        const a = parsed.args;
        const row = {
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          sourceMethod: proof.method,
          successful: true,
        };
        let payment = null;
        if (parsed.name === "StakerRegistered")
          registered.add(a.staker.toLowerCase());
        if (parsed.name === "Rejected") {
          rejected.set(log.transactionHash, {
            wallet: a.wallet.toLowerCase(),
            amount: a.refunded,
            registered: registered.has(a.wallet.toLowerCase()),
          });
          registered.delete(a.wallet.toLowerCase());
        }
        if (parsed.name === "Payout") {
          const rejection = rejected.get(log.transactionHash);
          let type = "unclassified-payout";
          if (
            rejection &&
            same(rejection.wallet, a.to) &&
            rejection.amount === a.amount
          ) {
            type = rejection.registered
              ? "registered-principal-refund"
              : "unregistered-deposit-return";
            rejected.delete(log.transactionHash);
          } else if (
            proof.method === "cancel" ||
            proof.names.includes("Cancelled")
          )
            type = "registered-principal-refund";
          else if (
            ["releasePayouts", "resolveChallenge"].includes(proof.method) ||
            proof.names.some((name) =>
              ["Finalized", "ChallengeResolved"].includes(name),
            )
          )
            type = "attendance-payout";
          payment = {
            type,
            wallet: a.to,
            recipient: a.to,
            amountWei: a.amount.toString(),
          };
        } else if (parsed.name === "PayoutFailed") {
          payment = {
            type: "failed-credit",
            wallet: a.to,
            recipient: a.to,
            amountWei: a.amount.toString(),
            successful: false,
          };
          const rejection = rejected.get(log.transactionHash);
          if (
            rejection &&
            same(rejection.wallet, a.to) &&
            rejection.amount === a.amount
          )
            rejected.delete(log.transactionHash);
        } else if (parsed.name === "Claimed")
          payment = {
            type: "owed-claim",
            wallet: a.account,
            recipient: a.to,
            amountWei: a.amount.toString(),
          };
        else if (parsed.name === "PendingWithdrawn")
          payment = {
            type: "pending-credit-withdrawal",
            wallet: a.payer,
            recipient: a.to,
            amountWei: a.amount.toString(),
          };
        else if (parsed.name === "EmergencyWithdrawn") {
          payment = {
            type: "registered-no-list-refund",
            wallet: a.staker,
            recipient: null,
            amountWei: a.amount.toString(),
          };
          registered.delete(a.staker.toLowerCase());
        } else if (["Refunded", "Swept"].includes(parsed.name))
          payment = {
            type: parsed.name === "Refunded" ? "spare-refund" : "spare-sweep",
            wallet: a.to,
            recipient: a.to,
            amountWei: a.amount.toString(),
          };
        if (payment) expectedTransfers.push({ ...row, ...payment });
        if (parsed.name === "Payout") {
          totals.successful += parsed.args.amount;
          if (
            ["releasePayouts", "resolveChallenge"].includes(proof.method) ||
            proof.names.some((name) =>
              ["Finalized", "ChallengeResolved"].includes(name),
            )
          )
            totals.attendance += parsed.args.amount;
        }
        if (parsed.name === "PayoutFailed") totals.failed += parsed.args.amount;
        if (parsed.name === "Claimed") {
          totals.claimed += parsed.args.amount;
          totals.successful += parsed.args.amount;
        }
        if (parsed.name === "PendingWithdrawn") {
          totals.pending += parsed.args.amount;
          totals.successful += parsed.args.amount;
        }
        if (["EmergencyWithdrawn", "Refunded", "Swept"].includes(parsed.name))
          totals.successful += parsed.args.amount;
      }
      eq(
        d.payments.attendancePaidWei,
        totals.attendance.toString(),
        "Log-backed direct attendance payments",
      );
      reconcileTransfers(d.payments.transfers, expectedTransfers);
      checks++;
      eq(
        d.payments.failedPaymentsWei,
        totals.failed.toString(),
        "Failures are credits, not sent",
      );
      eq(
        d.payments.claimedWei,
        totals.claimed.toString(),
        "Claimed credit separately indexed",
      );
      eq(
        d.payments.pendingCreditWithdrawnWei,
        totals.pending.toString(),
        "Pending withdrawal is not kickback",
      );
      eq(
        d.payments.totalExplicitSuccessfulTransfersWei,
        totals.successful.toString(),
        "Explicit logged native deliveries",
      );
      eq(
        (totals.failed - totals.claimed).toString(),
        s.owedTotalWei,
        "Indexed owed liability",
      );
      eq(
        (await provider.getBlock(block.number)).hash,
        block.hash,
        "Snapshot remained canonical",
      );
      const head = await provider.getBlock("latest");
      assert.ok(
        head.number >= block.number &&
          head.number - block.number <= 20 &&
          head.timestamp - block.timestamp <= 90,
        "API snapshot is near current chain head",
      );
      checks++;
      if (head.number > block.number)
        eq(
          (
            await provider.getLogs({
              address: [c.target, deployment.resolver, deployment.arbitrator],
              fromBlock: block.number + 1,
              toBlock: head.number,
            })
          ).length,
          0,
          "No newer protocol activity omitted by API snapshot; refresh if this fails",
        );
      eq(
        (await c.challengeDeposit({ blockTag: head.number })).toString(),
        s.challengeDepositWei,
        "Current challenge amount still matches UI, including eventless fee changes",
      );
      const [headBalance, headReserved, headSpare] = await Promise.all([
        provider.getBalance(c.target, head.number),
        c.reserved({ blockTag: head.number }),
        c.spare({ blockTag: head.number }),
      ]);
      eq(
        headBalance.toString(),
        s.balanceWei,
        "Current custody still agrees, including forced ETH without child logs",
      );
      eq(
        headReserved.toString(),
        s.reservedWei,
        "Current reserve still agrees",
      );
      eq(headSpare.toString(), s.spareWei, "Current surplus still agrees");
      eq(
        (await provider.getBlock(head.number)).hash,
        head.hash,
        "Head comparison remains canonical",
      );
      events.push({
        eventId: d.event.id,
        contract: c.target,
        blockNumber: block.number,
        blockHash: block.hash,
        now: block.timestamp,
        observedHead: {
          blockNumber: head.number,
          blockHash: head.hash,
          now: head.timestamp,
        },
        state: s,
        expectedUi: expectedUi({
          ...s,
          eventStart: Number(v.eventStart),
          arbitrationMode: manifest.arbitration.mode,
        }),
        payments: d.payments,
        operations,
      });
    }
    const controlFile = path.join(
      ROOT,
      "artifacts/chiado-flow-audit",
      `${manifest.planId}-control-baseline.json`,
    );
    const b = events[1];
    const control = Object.fromEntries(
      [
        "phase",
        "owner",
        "pendingOwner",
        "stakerCount",
        "attendeeCount",
        "challengeEndsAt",
        "pendingChallenges",
        "heldBackWei",
        "pendingTotalWei",
        "owedTotalWei",
        "reservedWei",
        "spareWei",
        "payoutShareWei",
        "depositWei",
        "balanceWei",
        "poolWei",
        "challengeEscrowWei",
        "stakerHistory",
        "attendees",
        "cases",
      ].map((key) => [key, b.state[key]]),
    );
    const manifestSha256 = createHash("sha256").update(bytes).digest("hex");
    if (!fs.existsSync(controlFile)) {
      assert.ok(
        events[0].state.phase === "Listed" &&
          events[0].state.cases.some(
            (item) =>
              item.state === "Disputed" &&
              item.matched &&
              item.finalRuling === null,
          ) &&
          b.state.phase === "Listed",
        "Capture the unchanged B baseline before ordinary payout, not retrospectively",
      );
      fs.mkdirSync(path.dirname(controlFile), { recursive: true });
      fs.writeFileSync(
        controlFile,
        textJson({
          planId: manifest.planId,
          manifestSha256,
          eventId: b.eventId,
          contract: b.contract,
          blockNumber: b.blockNumber,
          blockHash: b.blockHash,
          state: control,
        }),
        { flag: "wx" },
      );
    }
    const baseline = JSON.parse(fs.readFileSync(controlFile));
    eq(
      baseline.manifestSha256,
      manifestSha256,
      "Control baseline manifest binding",
    );
    eq(baseline.eventId, b.eventId, "Control baseline event binding");
    eq(baseline.contract, b.contract, "Control baseline contract binding");
    eq(
      (await provider.getBlock(baseline.blockNumber)).hash,
      baseline.blockHash,
      "Control baseline remains canonical",
    );
    eq(
      control,
      baseline.state,
      "Event B remains financially unchanged through A stages",
    );
    return {
      status: "passed-current-checkpoint",
      checkedAt: new Date().toISOString(),
      origin: ORIGIN,
      chainId: 10200,
      arbitration: "controlled",
      instanceId: boot.instanceId,
      manifestSha256,
      controlBaseline: {
        file: path.relative(ROOT, controlFile),
        blockNumber: baseline.blockNumber,
        sha256: createHash("sha256")
          .update(fs.readFileSync(controlFile))
          .digest("hex"),
      },
      checks,
      readOnly: true,
      signatures: 0,
      broadcasts: 0,
      observerSha256: OBSERVER_SHA256,
      events,
      notice:
        "This observer verifies public API and canonical chain facts. UI screenshots and authenticated role assertions are separate evidence; waiting stages are not completed.",
    };
  } finally {
    provider.destroy();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes("--self-test")) selfTest();
  else {
    const out = path.join(ROOT, "artifacts/chiado-flow-audit");
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(
      out,
      new Date().toISOString().replace(/[:.]/g, "-") + ".json",
    );
    try {
      const result = await audit();
      fs.writeFileSync(file, textJson(result));
      fs.writeFileSync(
        path.join(ROOT, "artifacts/chiado-flow-status.json"),
        textJson({ ...result, evidenceFile: path.relative(ROOT, file) }),
      );
      console.log(
        textJson({
          status: result.status,
          checks: result.checks,
          evidence: file,
          events: result.events.map((e) => ({
            eventId: e.eventId,
            phase: e.state.phase,
            expectedUi: e.expectedUi,
          })),
        }),
      );
    } catch (error) {
      const failure = {
        status: "failed",
        checkedAt: new Date().toISOString(),
        readOnly: true,
        signatures: 0,
        broadcasts: 0,
        observerSha256: OBSERVER_SHA256,
        error: error.message,
        evidenceFile: path.relative(ROOT, file),
      };
      fs.writeFileSync(file, textJson(failure));
      fs.writeFileSync(
        path.join(ROOT, "artifacts/chiado-flow-status.json"),
        textJson(failure),
      );
      console.error(
        `Read-only Chiado audit failed: ${error.message}. Evidence: ${file}`,
      );
      process.exitCode = 1;
    }
  }
}
