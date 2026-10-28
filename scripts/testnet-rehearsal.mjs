import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ethers } from "ethers";
import {
  PRIVATE_ROOT,
  check,
  publicJson,
  atomicJson,
  readJson,
  secureWalletFile,
  parseArgs,
  validatePlan,
  fingerprint,
  verifyCompiledInputs,
  assertTestnet,
  acquireLock,
  loadJournal,
  sendOnce,
  safeFailure,
} from "../src/testnet-config.mjs";
import { DEFAULT_PLAN, DEFAULT_MANIFEST } from "./testnet-deploy.mjs";

export const STAGES = [
  "fund",
  "deposit",
  "recover-credit",
  "admit",
  "attendance",
  "challenge",
  "match",
  "payout",
  "ruling",
  "settle",
  "verify",
];
export function readyAfter(now, timestamp, label) {
  check(
    now > Number(timestamp),
    `${label} is not ready. Public testnet time must pass naturally; retry after ${new Date((Number(timestamp) + 1) * 1000).toISOString()}.`,
  );
}

// Challenge collateral uses _send and has no Payout event. Reconcile its actual
// recipient balances at the settlement block, accounting separately for gas and
// any log-explicit attendance payment in the same transaction. This is a bounded
// EOA fixture proof, not an assertion of a complete internal-call trace.
export async function proveCollateralDelivery({
  provider,
  event,
  challenge,
  bob,
  finalRuling,
  hash,
}) {
  check(
    [0, 1, 2].includes(finalRuling),
    "Unsupported final collateral ruling.",
  );
  const receipt = await provider.getTransactionReceipt(hash);
  const tx = await provider.getTransaction(hash);
  check(
    receipt?.status === 1 && tx && receipt.blockNumber > 0,
    "Collateral proof needs a successful settlement receipt.",
  );
  const [beforeBlock, afterBlock, rawBlock] = await Promise.all([
    provider.getBlock(receipt.blockNumber - 1),
    provider.getBlock(receipt.blockNumber),
    provider.send("eth_getBlockByNumber", [
      ethers.toQuantity(receipt.blockNumber),
      true,
    ]),
  ]);
  check(
    afterBlock?.hash === receipt.blockHash &&
      afterBlock.parentHash === beforeBlock?.hash,
    "Collateral proof block is not canonical.",
  );
  const expected = new Map();
  const add = (wallet, value) => {
    const key = wallet.toLowerCase();
    expected.set(key, (expected.get(key) ?? 0n) + value);
  };
  const remaining = 2n * challenge.deposit - challenge.arbitrationPaid;
  add(
    bob,
    finalRuling === 1 ? remaining : finalRuling === 0 ? remaining / 2n : 0n,
  );
  add(
    challenge.matcher,
    finalRuling === 2
      ? remaining
      : finalRuling === 0
        ? remaining - remaining / 2n
        : 0n,
  );
  check(
    rawBlock?.hash === afterBlock.hash &&
      Array.isArray(rawBlock?.transactions) &&
      !rawBlock.transactions.some(
        (other) =>
          other.hash.toLowerCase() !== hash.toLowerCase() &&
          (expected.has(String(other.from).toLowerCase()) ||
            expected.has(String(other.to).toLowerCase())),
      ),
    "Other direct recipient activity makes this block-balance collateral proof ambiguous.",
  );
  const delivered = new Map();
  for (const log of receipt.logs.filter(
    (item) => item.address.toLowerCase() === event.target.toLowerCase(),
  )) {
    const parsed = event.interface.parseLog(log);
    if (parsed?.name === "Payout") {
      const key = parsed.args.to.toLowerCase();
      delivered.set(key, (delivered.get(key) ?? 0n) + parsed.args.amount);
    }
  }
  const rows = await Promise.all(
    [...expected].map(async ([wallet, collateral]) => {
      check(
        (await provider.getCode(wallet, beforeBlock.number)) === "0x",
        "Block-balance collateral proof is limited to the planned EOA recipients.",
      );
      const [before, after] = await Promise.all([
        provider.getBalance(wallet, beforeBlock.number),
        provider.getBalance(wallet, afterBlock.number),
      ]);
      const gas =
        tx.from.toLowerCase() === wallet
          ? receipt.gasUsed * receipt.gasPrice
          : 0n;
      const explicitAttendance = delivered.get(wallet) ?? 0n;
      check(
        after - before + gas - explicitAttendance === collateral,
        "Actual recipient balance and gas do not prove the expected challenge collateral delivery.",
      );
      return {
        wallet: ethers.getAddress(wallet),
        beforeBalanceWei: String(before),
        afterBalanceWei: String(after),
        gasPaidWei: String(gas),
        explicitAttendancePaidWei: String(explicitAttendance),
        collateralDeliveredWei: String(collateral),
      };
    }),
  );
  check(
    (await provider.getBlock(afterBlock.number))?.hash === afterBlock.hash,
    "Settlement block changed while proving collateral delivery.",
  );
  return {
    method: "canonical-block-recipient-balance-and-gas",
    transactionHash: hash,
    blockNumber: afterBlock.number,
    blockHash: afterBlock.hash,
    parentBlockHash: beforeBlock.hash,
    totalChallengeCollateralWei: String(remaining),
    recipients: rows,
    scope:
      "Planned EOA recipients; no other direct recipient transaction in the settlement block. Log-explicit attendance payments are subtracted; this is not an internal-call trace.",
  };
}
export async function runStage({
  stage,
  execute,
  provider,
  plan,
  manifest,
  artifacts,
  wallet,
  journal,
  journalPath,
  ruling = 2,
  proofPath = path.join(PRIVATE_ROOT, "chiado-rehearsal-proof.json"),
}) {
  check(STAGES.includes(stage), "Choose a documented rehearsal stage.");
  check(
    manifest.planFingerprint === fingerprint(plan) &&
      manifest.environment === "testnet" &&
      manifest.chain.chainId === 10200 &&
      manifest.arbitration.mode === "controlled",
    "Manifest does not match the reviewed controlled Chiado plan.",
  );
  await assertTestnet(provider, plan.chain);
  const signers = Object.fromEntries(
    Object.entries(wallet.roles).map(([role, entry]) => [
      role,
      new ethers.Wallet(entry.privateKey, provider),
    ]),
  );
  const [aRecord, bRecord] = manifest.events;
  const a = new ethers.Contract(
    aRecord.deployment.contract,
    artifacts.KlerosEventV8.abi,
    provider,
  );
  const b = new ethers.Contract(
    bRecord.deployment.contract,
    artifacts.KlerosEventV8.abi,
    provider,
  );
  const liquid = new ethers.Contract(
    manifest.arbitration.arbitrator,
    artifacts.MockKlerosLiquid.abi,
    provider,
  );
  const resolver = new ethers.Contract(
    manifest.arbitration.resolver,
    artifacts.MockArbitrableProxy.abi,
    provider,
  );
  for (const [i, c] of [a, b].entries()) {
    const d = manifest.events[i].deployment;
    check(
      ethers.keccak256(await provider.getCode(c.target)) === d.codeHash &&
        (await c.VERSION()) === 8n &&
        (await c.disputeResolver()) === manifest.arbitration.resolver &&
        (await c.arbitrator()) === manifest.arbitration.arbitrator,
      "Testnet event code/provider differs from the verified manifest.",
    );
  }
  const operations = [];
  const queue = (action, role, target, method, args = [], value = 0n) =>
    operations.push({
      action,
      role,
      request: {
        to: target.target,
        data: target.interface.encodeFunctionData(method, args),
        value,
      },
    });
  const has = (action) => Boolean(journal.transactions[action]);
  const D = BigInt(aRecord.deployment.depositWei);
  const DB = BigInt(bRecord.deployment.depositWei);
  const now = (await provider.getBlock("latest")).timestamp;
  const bob = signers.bob.address;
  const alice = signers.alice.address;
  const carol = signers.carol.address;
  switch (stage) {
    case "fund":
      for (const role of ["alice", "bob", "carol"])
        operations.push({
          action: `fund-${role}`,
          role: "ownerA",
          request: {
            to: signers[role].address,
            value: BigInt(plan.participantFundingWei),
          },
        });
      break;
    case "deposit":
      check(
        now < aRecord.deployment.eventStart ||
          [
            "deposit-alice-a",
            "deposit-bob-a",
            "deposit-carol-a",
            "deposit-alice-b",
          ].every(has),
        "Deposits have closed at eventStart; only receipt checks for all four already-journaled operations may resume.",
      );
      queue("deposit-alice-a", "alice", a, "deposit", [], 2n * D);
      queue("deposit-bob-a", "bob", a, "deposit", [], D);
      queue("deposit-carol-a", "carol", a, "deposit", [], D);
      queue("deposit-alice-b", "alice", b, "deposit", [], DB);
      break;
    case "recover-credit":
      if (!has("recover-alice-a"))
        check(
          (await a.pendingDeposits(alice)) === 2n * D &&
            (await a.status(alice)) === 0n,
          "Credit recovery expects Alice's own two-deposit pending balance before admission.",
        );
      queue("recover-alice-a", "alice", a, "withdrawPending", [alice, D]);
      break;
    case "admit":
      if (!has("admit-a"))
        for (const person of [alice, bob, carol])
          check(
            (await a.pendingDeposits(person)) === D,
            "Each A participant must have their own exact deposit before admission.",
          );
      if (!has("admit-b"))
        check(
          (await b.pendingDeposits(alice)) === DB,
          "B admission requires Alice's independent B credit.",
        );
      queue("admit-a", "ownerA", a, "registerStakers", [[alice, bob, carol]]);
      queue("admit-b", "ownerB", b, "registerStakers", [[alice]]);
      break;
    case "attendance":
      check(
        now >= aRecord.deployment.eventStart,
        `Attendance opens at ${new Date(aRecord.deployment.eventStart * 1000).toISOString()}; public testnet time cannot be advanced.`,
      );
      check(
        (await a.stakerCount()) === 3n && (await b.stakerCount()) === 1n,
        "Rehearsal requires exactly three A stakers and one independent B staker.",
      );
      queue("attendance-a", "ownerA", a, "postAttendance", [
        [alice, carol],
        (3n * D) / 2n,
      ]);
      queue("attendance-b", "ownerB", b, "postAttendance", [[alice], DB]);
      break;
    case "challenge":
      queue(
        "challenge-bob-a",
        "bob",
        a,
        "challenge",
        [],
        has("challenge-bob-a")
          ? BigInt(journal.transactions["challenge-bob-a"].expected.value)
          : await a.challengeDeposit(),
      );
      break;
    case "match": {
      const challenge = await a.challenges(bob);
      check(
        challenge.state > 0n,
        "Bob must open a challenge before it can be matched.",
      );
      queue(
        "match-bob-a",
        "ownerA",
        a,
        "matchChallenge",
        [bob],
        challenge.deposit,
      );
      break;
    }
    case "payout": {
      readyAfter(
        now,
        await a.challengeEndsAt(),
        "The one-day challenge window",
      );
      const challenge = await a.challenges(bob);
      check(
        challenge.state === 2n &&
          !(await resolver.disputes(challenge.localDisputeID)).isRuled,
        "Keep the matched case open to exercise payouts with a held share.",
      );
      queue("payout-a-with-open-case", "ownerA", a, "releasePayouts");
      break;
    }
    case "ruling": {
      check([0, 1, 2].includes(ruling), "Controlled test rulings are0,1 or2.");
      const challenge = await a.challenges(bob);
      check(
        (await a.phase()) === 2n &&
          challenge.state === 2n &&
          challenge.heldShare > 0n,
        "Release normal payouts while holding Bob's open share before the controlled ruling.",
      );
      queue("controlled-ruling-a", "ownerA", liquid, "giveFinalRuling", [
        challenge.arbitratorDisputeID,
        ruling,
      ]);
      break;
    }
    case "settle": {
      const challenge = await a.challenges(bob);
      check(
        (await resolver.disputes(challenge.localDisputeID)).isRuled,
        "The resolver must record a final ruling before settlement.",
      );
      if (!journal.independentBBeforeSettlement) {
        journal.independentBBeforeSettlement = {
          balanceWei: String(await provider.getBalance(b.target)),
          stakerCount: String(await b.stakerCount()),
          phase: String(await b.phase()),
        };
        if (execute) atomicJson(journalPath, journal);
      }
      queue("settle-bob-a", "ownerA", a, "resolveChallenge", [bob]);
      break;
    }
    case "verify": {
      const challenge = await a.challenges(bob);
      check(
        (await a.phase()) === 2n &&
          challenge.state === 3n &&
          (await a.pendingChallenges()) === 0n &&
          (await a.pendingTotal()) === 0n &&
          (await a.heldBack()) === 0n &&
          (await a.challengeEscrow()) === 0n,
        "A has not completed the intended held-share settlement path.",
      );
      const before = journal.independentBBeforeSettlement;
      check(
        before &&
          before.balanceWei === String(await provider.getBalance(b.target)) &&
          before.stakerCount === String(await b.stakerCount()) &&
          before.phase === String(await b.phase()),
        "A settlement changed B or B was independently modified during the rehearsal.",
      );
      const paid = new Map();
      for (const entry of Object.values(journal.transactions)) {
        check(
          entry.state === "confirmed",
          "Every journaled operation must have a confirmed canonical receipt.",
        );
        const receipt = await provider.getTransactionReceipt(entry.hash);
        check(
          receipt?.status === 1 && receipt.blockHash === entry.blockHash,
          "A saved rehearsal receipt is no longer canonical.",
        );
        for (const log of receipt.logs.filter(
          (log) => log.address.toLowerCase() === a.target.toLowerCase(),
        )) {
          const event = a.interface.parseLog(log);
          if (event?.name === "Payout")
            paid.set(
              event.args.to.toLowerCase(),
              (paid.get(event.args.to.toLowerCase()) ?? 0n) + event.args.amount,
            );
        }
      }
      const finalRuling = Number(
        (await resolver.disputes(challenge.localDisputeID)).ruling,
      );
      const expected = finalRuling === 1 ? D : (3n * D) / 2n;
      check(
        paid.get(alice.toLowerCase()) === expected &&
          paid.get(carol.toLowerCase()) === expected,
        "Canonical payout logs do not show the expected equal kickbacks.",
      );
      const collateralDelivery = await proveCollateralDelivery({
        provider,
        event: a,
        challenge,
        bob,
        finalRuling,
        hash: journal.transactions["settle-bob-a"].hash,
      });
      const proof = {
        status: "passed",
        chainId: 10200,
        arbitrationMode: "controlled",
        finalRuling,
        eventA: a.target,
        eventB: b.target,
        verifiedAt: new Date().toISOString(),
        alicePayoutWei: String(paid.get(alice.toLowerCase())),
        carolPayoutWei: String(paid.get(carol.toLowerCase())),
        collateralDelivery,
        bUnchangedDuringASettlement: true,
        transactions: Object.fromEntries(
          Object.entries(journal.transactions).map(([key, entry]) => [
            key,
            {
              hash: entry.hash,
              blockNumber: entry.blockNumber,
              blockHash: entry.blockHash,
            },
          ]),
        ),
        notice:
          "Real public testnet custody/settlement; arbitrator votes are explicitly controlled. No production Court or mainnet action.",
      };
      if (execute) atomicJson(proofPath, proof, 0o644);
      return proof;
    }
  }
  if (!execute)
    return {
      status: "review-only-no-broadcast",
      stage,
      chainId: 10200,
      operations: operations.map(({ action, role, request }) => ({
        action,
        sender: signers[role].address,
        ...request,
      })),
      notice:
        "Add --execute only after reviewing this exact stage. Natural contract deadlines apply.",
    };
  for (const operation of operations)
    await sendOnce({
      provider,
      signer: signers[operation.role],
      journal,
      journalPath,
      action: operation.action,
      request: operation.request,
    });
  if (stage === "settle") {
    const before = journal.independentBBeforeSettlement;
    check(
      before.balanceWei === String(await provider.getBalance(b.target)) &&
        before.stakerCount === String(await b.stakerCount()) &&
        before.phase === String(await b.phase()),
      "Independent B state changed while settling A.",
    );
  }
  return {
    status: "stage-confirmed",
    stage,
    chainId: 10200,
    transactions: operations.map((op) => ({
      action: op.action,
      hash: journal.transactions[op.action].hash,
    })),
    nextStage: STAGES[STAGES.indexOf(stage) + 1] ?? null,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, {
    "--stage": "value",
    "--execute": "boolean",
    "--plan": "value",
    "--manifest": "value",
    "--ruling": "value",
    "--help": "boolean",
  });
  if (args["--help"]) {
    console.log(
      `Review a stage: node scripts/testnet-rehearsal.mjs --stage STAGE\nRun/resume that stage: add --execute\nStages: ${STAGES.join(", ")}\nDefault command reads current status. Never changes public testnet time or automatically rebroadcasts.`,
    );
    return;
  }
  const plan = validatePlan(
    readJson(path.resolve(args["--plan"] ?? DEFAULT_PLAN)),
  );
  const manifest = readJson(
    path.resolve(args["--manifest"] ?? DEFAULT_MANIFEST),
  );
  check(
    manifest.planFingerprint === fingerprint(plan),
    "Manifest belongs to another rehearsal plan.",
  );
  const { artifacts, provenance } = verifyCompiledInputs();
  check(
    JSON.stringify(provenance) === JSON.stringify(plan.provenance),
    "Source/artifact provenance changed since deployment.",
  );
  const provider = new ethers.JsonRpcProvider(plan.chain.rpcUrl, undefined, {
    cacheTimeout: -1,
  });
  provider.pollingInterval = 4000;
  const unlock = args["--execute"]
    ? acquireLock(path.join(PRIVATE_ROOT, "chiado-operation.lock"))
    : () => {};
  try {
    await assertTestnet(provider, plan.chain);
    const journalPath = path.join(
      PRIVATE_ROOT,
      "chiado-rehearsal-journal.json",
    );
    const journal = loadJournal(journalPath, plan);
    if (!args["--stage"]) {
      check(
        !args["--execute"],
        "Choose one explicit rehearsal stage before execution.",
      );
      console.log(
        publicJson({
          status: "read-only",
          chainId: 10200,
          now: (await provider.getBlock("latest")).timestamp,
          eventStart: plan.events[0].eventStart,
          stages: STAGES,
          confirmedActions: Object.keys(journal.transactions).filter(
            (key) => journal.transactions[key].state === "confirmed",
          ),
          notice: plan.arbitration.notice,
        }),
      );
      return;
    }
    console.log(
      publicJson(
        await runStage({
          stage: args["--stage"],
          execute: Boolean(args["--execute"]),
          provider,
          plan,
          manifest,
          artifacts,
          wallet: secureWalletFile(),
          journal,
          journalPath,
          ruling: Number(args["--ruling"] ?? 2),
        }),
      ),
    );
  } finally {
    provider.destroy();
    unlock();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(safeFailure);
