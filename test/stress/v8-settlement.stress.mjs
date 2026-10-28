// A bounded deterministic settlement campaign, backed by an independent money/holder ledger.
// Synthetic in-process Ganache only. Court adjudication alone uses retained V1 mocks.
// Recipient failures are modeled by replacing synthetic recipient code with INVALID, then restoring it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import ganache from "ganache";
import { ethers } from "ethers";

const DAY = 86_400;
const GAS = { gasLimit: 8_000_000 };
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
const count = Number(process.env.V8_SETTLEMENT_SCENARIOS ?? 64);
assert.ok(
  Number.isInteger(count) && count >= 2 && count <= 256 && count % 2 === 0,
  "V8_SETTLEMENT_SCENARIOS must be an even number from 2 to 256",
);
const output = path.resolve(
  process.env.STRESS_OUTPUT_DIR ?? "artifacts/stress/manual-settlement",
);
fs.mkdirSync(output, { recursive: true });
const reportPath = path.join(output, "v8-settlement-stress.json");
const loadArtifact = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(
        name === "KlerosEventV8"
          ? `../../build/contracts/${name}.json`
          : `../../references/kickback/build/${name}.json`,
        import.meta.url,
      ),
    ),
  );
const artifacts = Object.fromEntries(
  ["KlerosEventV8", "MockKlerosLiquid", "MockArbitrableProxy"].map((name) => [
    name,
    loadArtifact(name),
  ]),
);
const artifact = (name) => artifacts[name];
const sourceSha256 = createHash("sha256")
  .update(
    fs.readFileSync(
      new URL("../../contracts/KlerosEventV8.sol", import.meta.url),
    ),
  )
  .digest("hex");
const creationCodeHash = ethers.keccak256(artifact("KlerosEventV8").bytecode);
const key = (address) => address.toLowerCase();
const sum = (values) => [...values].reduce((total, value) => total + value, 0n);
const rng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
};
const shuffled = (values, random) => {
  const out = [...values];
  for (let i = out.length - 1; i > 0; --i) {
    const j = random() % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const stats = {
  scenarios: 0,
  seeds: 0,
  transactions: 0,
  expectedRejections: 0,
  invariantChecks: 0,
  assertions: 0,
  matchedCases: 0,
  unmatchedCases: 0,
  rulings0: 0,
  rulings1: 0,
  rulings2: 0,
  earlySettlements: 0,
  lateSettlements: 0,
  failedRecipientPayments: 0,
  alternateClaims: 0,
  pendingWithdrawals: 0,
};
const completed = [];
let activeTrace = [],
  activeSeed,
  activeVariant;
const json = (value) =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n";
const eq = (actual, expected, message) => {
  ++stats.assertions;
  assert.equal(actual, expected, message);
};
const ok = (value, message) => {
  ++stats.assertions;
  assert.ok(value, message);
};

test(
  `${count} seeded settlement scenarios conserve custody and compare paired settlement permutations`,
  { timeout: 600_000 },
  async () => {
    const started = performance.now();
    const rpc = ganache.provider({
      logging: { quiet: true },
      chain: { chainId: 31339, hardfork: "shanghai" },
      miner: { blockGasLimit: 60_000_000 },
      wallet: { totalAccounts: 16, defaultBalance: 1000 },
    });
    const provider = new ethers.BrowserProvider(rpc, undefined, {
      cacheTimeout: -1,
    });
    provider.pollingInterval = 10;
    try {
      const signers = await Promise.all(
        Array.from({ length: 16 }, (_, i) => provider.getSigner(i)),
      );
      const [owner, matcher, beneficiary, ...guests] = signers;
      const deploy = async (name, ...args) => {
        const a = artifact(name);
        const c = await new ethers.ContractFactory(
          a.abi,
          a.bytecode,
          owner,
        ).deploy(...args, { gasLimit: 14_000_000 });
        await c.waitForDeployment();
        ++stats.transactions;
        return c;
      };
      const liquid = await deploy("MockKlerosLiquid");
      const proxy = await deploy("MockArbitrableProxy", liquid.target);
      const timestamp = async () =>
        Number(
          (
            await rpc.request({
              method: "eth_getBlockByNumber",
              params: ["latest", false],
            })
          ).timestamp,
        );
      const warpTo = async (time) => {
        const current = await timestamp();
        if (time > current)
          await rpc.request({
            method: "evm_increaseTime",
            params: [time - current],
          });
        await rpc.request({ method: "evm_mine", params: [] });
      };

      async function scenario(seed, variant) {
        activeSeed = seed;
        activeVariant = variant;
        activeTrace = [];
        const random = rng(seed);
        const n = 4 + (random() % 7);
        const deposit = BigInt(1 + (random() % 100_003));
        const baseCount = 1 + (random() % Math.floor(n / 2));
        const feePerJuror = BigInt(1 + (random() % 7));
        const fee = 3n * feePerJuror;
        const participants = guests.slice(0, n);
        const extraPayer = guests[n];
        const all = [...participants, extraPayer, matcher, beneficiary];
        const initial = new Map(
          await Promise.all(
            all.map(async (s) => [
              key(s.address),
              await provider.getBalance(s.address),
            ]),
          ),
        );
        const gasSpent = new Map(all.map((s) => [key(s.address), 0n]));
        const inputs = new Map(all.map((s) => [key(s.address), 0n]));
        const outputs = new Map(all.map((s) => [key(s.address), 0n]));
        const credits = new Map(all.map((s) => [key(s.address), 0n]));
        const owed = new Map(all.map((s) => [key(s.address), 0n]));
        const expectedPoolPayments = new Map(
          all.map((s) => [key(s.address), 0n]),
        );
        const failedHistory = new Map(all.map((s) => [key(s.address), 0n]));
        const actualPoolPayments = new Map(
          all.map((s) => [key(s.address), 0n]),
        );
        const actualFailureEvents = new Map(
          all.map((s) => [key(s.address), 0n]),
        );
        const poolEntitlement = new Map(
          participants.map((s) => [key(s.address), 0n]),
        );
        const attending = new Set(
          participants.slice(0, baseCount).map((s) => key(s.address)),
        );
        const failures = new Set(
          participants
            .filter(() => random() % 4 === 0)
            .map((s) => key(s.address)),
        );
        if (random() % 4 === 0) failures.add(key(matcher.address));
        const extras = participants.map(() => BigInt(random() % 13));
        const cases = [];
        for (let i = baseCount; i < n; ++i) {
          // At least two late cases ensure each paired reversal actually changes settlement order.
          // Remaining omissions may be early cases, unmatched challenges or unchallenged no-shows.
          const mandatoryLate = i < baseCount + 2;
          const kind = mandatoryLate ? 2 : random() % 3;
          if (kind !== 0)
            cases.push({
              wallet: key(participants[i].address),
              signer: participants[i],
              kind: kind === 1 ? "unmatched" : "matched",
              ruling: random() % 3,
              pre: mandatoryLate ? false : random() % 3 === 0,
              individual: random() % 2 === 0,
              resolved: false,
              held: 0n,
              id: undefined,
              matchEndsAt: 0,
            });
        }
        // Same seed fixes outcomes, participants and recipients; only the late permutation changes.
        const lateOrder = shuffled(
          cases.filter((c) => c.kind === "matched" && !c.pre),
          random,
        );
        if (variant === 1) lateOrder.reverse();
        let cash = 0n,
          pool = 0n,
          phase = 0,
          failuresActive = false,
          eventAddress;
        const eventInterface = new ethers.Interface(
          artifact("KlerosEventV8").abi,
        );

        const note = (action, details = {}) =>
          activeTrace.push({ action, ...details });
        const tx = async (pending, action) => {
          const r = await (await pending).wait();
          ++stats.transactions;
          const from = key(r.from);
          if (gasSpent.has(from))
            gasSpent.set(from, gasSpent.get(from) + r.fee);
          for (const log of r.logs) {
            if (key(log.address) !== eventAddress) continue;
            const parsed = eventInterface.parseLog(log);
            if (parsed?.name === "Payout") {
              const recipient = key(parsed.args.to);
              ok(
                actualPoolPayments.has(recipient),
                "pool event recipient belongs to modeled participants",
              );
              actualPoolPayments.set(
                recipient,
                actualPoolPayments.get(recipient) + parsed.args.amount,
              );
            } else if (parsed?.name === "PayoutFailed") {
              const recipient = key(parsed.args.to);
              ok(
                actualFailureEvents.has(recipient),
                "failed-payment recipient belongs to modeled accounts",
              );
              actualFailureEvents.set(
                recipient,
                actualFailureEvents.get(recipient) + parsed.args.amount,
              );
            }
          }
          note(action, { gas: r.gasUsed });
          return r;
        };
        const incoming = (wallet, amount) => {
          inputs.set(wallet, inputs.get(wallet) + amount);
          cash += amount;
        };
        const payment = (wallet, amount, isPool = false) => {
          if (amount === 0n) return;
          if (isPool)
            poolEntitlement.set(wallet, poolEntitlement.get(wallet) + amount);
          if (failuresActive && failures.has(wallet)) {
            owed.set(wallet, owed.get(wallet) + amount);
            failedHistory.set(wallet, failedHistory.get(wallet) + amount);
            ++stats.failedRecipientPayments;
          } else {
            outputs.set(wallet, outputs.get(wallet) + amount);
            if (isPool)
              expectedPoolPayments.set(
                wallet,
                expectedPoolPayments.get(wallet) + amount,
              );
            cash -= amount;
          }
        };
        const reject = async (pending, expected, child) => {
          await assert.rejects(pending, (error) => {
            const data = error.data ?? error.info?.error?.data?.result;
            eq(
              child.interface.parseError(data)?.name,
              expected,
              "expected rejection kind",
            );
            return true;
          });
          ++stats.expectedRejections;
          note("rejected", { expected });
        };

        await tx(
          liquid.setFeeForJuror(feePerJuror, GAS),
          "set synthetic Court fee",
        );
        const start = (await timestamp()) + 3600;
        const child = await deploy(
          "KlerosEventV8",
          deposit,
          `Settlement stress ${seed}/${variant}`,
          owner.address,
          start,
          start + 8 * DAY,
          [
            proxy.target,
            EXTRA,
            ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
            "0x010204",
            "/ipfs/SyntheticSettlementStress",
          ],
        );
        eventAddress = key(child.target);
        const checkpoint = async (label) => {
          ++stats.invariantChecks;
          const unresolved = cases.filter((c) => !c.resolved);
          const escrow = sum(
            unresolved.map((c) => (c.kind === "unmatched" ? fee : fee)),
          );
          const holds = sum(cases.map((c) => c.held));
          const pending = sum(credits.values());
          const unpaid = sum(owed.values());
          const required =
            (phase <= 1 ? pool : holds) + pending + unpaid + escrow;
          eq(await child.phase(), BigInt(phase), `${label}: phase`);
          eq(await child.pendingTotal(), pending, `${label}: pending sum`);
          eq(await child.owedTotal(), unpaid, `${label}: owed sum`);
          eq(
            await child.challengeEscrow(),
            escrow,
            `${label}: challenge collateral`,
          );
          eq(await child.heldBack(), holds, `${label}: held-share sum`);
          eq(
            await child.pendingChallenges(),
            BigInt(unresolved.length),
            `${label}: unsettled cases`,
          );
          eq(
            await child.reserved(),
            required,
            `${label}: exact reserve formula`,
          );
          eq(
            await provider.getBalance(child.target),
            cash,
            `${label}: independent cash conservation`,
          );
          ok(cash >= required, `${label}: solvency`);
          eq(
            await child.spare(),
            cash - required,
            `${label}: only rounding is spare`,
          );
          if (phase !== 0)
            eq(
              await child.attendeeCount(),
              BigInt(attending.size),
              `${label}: attendance`,
            );
          for (const s of all) {
            const wallet = key(s.address);
            eq(
              await child.pendingDeposits(s.address),
              credits.get(wallet),
              `${label}: wallet credit`,
            );
            eq(
              await child.owed(s.address),
              owed.get(wallet),
              `${label}: wallet failed-payment credit`,
            );
            eq(
              actualPoolPayments.get(wallet),
              expectedPoolPayments.get(wallet),
              `${label}: pool payment event history`,
            );
            eq(
              actualFailureEvents.get(wallet),
              failedHistory.get(wallet),
              `${label}: failed-payment event history`,
            );
          }
          for (const c of cases) {
            const actual = await child.challenges(c.wallet);
            eq(
              actual.state,
              c.resolved ? 3n : c.kind === "matched" ? 2n : 1n,
              `${label}: case state`,
            );
            eq(actual.heldShare, c.held, `${label}: per-case reserve`);
          }
        };

        // Cases do not exist until opened. Build the model list incrementally for checkpoints.
        const scheduled = [...cases];
        cases.length = 0;
        for (let i = 0; i < participants.length; ++i) {
          const s = participants[i];
          const amount = deposit + extras[i];
          await tx(
            child.connect(s).deposit({ value: amount, ...GAS }),
            "deposit own collateral",
          );
          incoming(key(s.address), amount);
          credits.set(key(s.address), amount);
        }
        const unrelated = 2n * deposit + BigInt(random() % 5);
        await tx(
          child.connect(extraPayer).deposit({ value: unrelated, ...GAS }),
          "unadmitted payer credit",
        );
        incoming(key(extraPayer.address), unrelated);
        credits.set(key(extraPayer.address), unrelated);
        await checkpoint("unadmitted credits");
        await tx(
          child.registerStakers(
            participants.map((s) => s.address),
            GAS,
          ),
          "admit funded participants",
        );
        pool = deposit * BigInt(n);
        for (const s of participants)
          credits.set(key(s.address), credits.get(key(s.address)) - deposit);
        await checkpoint("admitted principal");
        await reject(
          child
            .connect(extraPayer)
            .postAttendance.staticCall([participants[0].address], pool),
          "NotOwner",
          child,
        );
        await warpTo(start + 1);
        await tx(
          child.postAttendance(
            participants.slice(0, baseCount).map((s) => s.address),
            pool / BigInt(baseCount),
            GAS,
          ),
          "post attendance",
        );
        phase = 1;
        await reject(child.releasePayouts.staticCall(), "TooEarly", child);

        for (const c of scheduled) {
          await tx(
            child.connect(c.signer).challenge({ value: fee, ...GAS }),
            "open challenge",
          );
          incoming(c.wallet, fee);
          cases.push(c);
          let actual = await child.challenges(c.wallet);
          c.matchEndsAt = Number(actual.matchEndsAt);
          if (c.kind === "matched") {
            await tx(
              child
                .connect(matcher)
                .matchChallenge(c.wallet, { value: fee, ...GAS }),
              "match challenge",
            );
            incoming(key(matcher.address), fee);
            cash -= fee; // paid directly to the immutable resolver/Court
            actual = await child.challenges(c.wallet);
            c.id = actual.arbitratorDisputeID;
            ok(
              actual.arbitratorDisputeID !== actual.localDisputeID,
              "Court and resolver IDs differ",
            );
            await reject(
              child.resolveChallenge.staticCall(c.wallet),
              "NotRuled",
              child,
            );
            ++stats.matchedCases;
          } else {
            await reject(
              child.resolveChallenge.staticCall(c.wallet),
              "TooEarly",
              child,
            );
            ++stats.unmatchedCases;
          }
          await checkpoint("challenge collateral admitted");
        }

        const challengePayment = (c) => {
          const remainder = fee; // two identical deposits less one identical arbitration fee
          if (c.ruling === 1) payment(c.wallet, remainder);
          else if (c.ruling === 2) payment(key(matcher.address), remainder);
          else {
            payment(c.wallet, remainder / 2n);
            payment(key(matcher.address), remainder - remainder / 2n);
          }
        };
        const settleModel = (c) => {
          c.resolved = true;
          if (phase === 1 && c.ruling === 1) attending.add(c.wallet);
          if (c.held !== 0n) {
            const amount = c.held;
            c.held = 0n;
            if (c.ruling === 1) {
              attending.add(c.wallet);
              payment(c.wallet, amount, true);
            } else {
              // Independent holders ledger: distribute only to currently eligible holders.
              const otherHolds = cases.filter(
                (other) => !other.resolved && other.kind === "matched",
              );
              const holders = attending.size + otherHolds.length;
              const each = amount / BigInt(holders);
              for (const wallet of attending) payment(wallet, each, true);
              for (const other of otherHolds) other.held += each;
            }
          }
          challengePayment(c);
          ++stats[`rulings${c.ruling}`];
        };
        for (const c of cases.filter((c) => c.kind === "matched" && c.pre)) {
          await tx(
            liquid.giveFinalRuling(c.id, c.ruling, GAS),
            "deliver early final ruling",
          );
          await tx(
            child.resolveChallenge(c.wallet, GAS),
            "settle before payout",
          );
          settleModel(c);
          ++stats.earlySettlements;
          await checkpoint("early resolution");
          if (c.ruling !== 1)
            await reject(
              child.addAttendees.staticCall([c.wallet]),
              "ResolvedChallenge",
              child,
            );
        }
        const end = Math.max(
          Number(await child.challengeEndsAt()),
          ...cases.map((c) => c.matchEndsAt),
        );
        await warpTo(end + 1);
        for (const wallet of failures)
          await rpc.request({
            method: "evm_setAccountCode",
            params: [wallet, "0xfe"],
          });
        failuresActive = true;
        for (const c of cases.filter(
          (c) => c.kind === "unmatched" && c.individual,
        )) {
          await tx(
            child.resolveChallenge(c.wallet, GAS),
            "individually accept expired challenge",
          );
          c.resolved = true;
          attending.add(c.wallet);
          payment(c.wallet, fee);
          await checkpoint("individual unmatched acceptance");
        }
        await tx(child.releasePayouts(GAS), "permissionless pool release");
        for (const c of cases.filter(
          (c) => c.kind === "unmatched" && !c.resolved,
        )) {
          c.resolved = true;
          attending.add(c.wallet);
          payment(c.wallet, fee);
        }
        const open = cases.filter((c) => !c.resolved);
        const share = pool / BigInt(attending.size + open.length);
        phase = 2;
        for (const c of open) c.held = share;
        for (const wallet of attending) payment(wallet, share, true);
        eq(
          await child.payoutShare(),
          share,
          "initial provisional share follows model",
        );
        await checkpoint("initial pool release");
        await reject(child.releasePayouts.staticCall(), "NotListed", child);
        for (const c of lateOrder) {
          await tx(
            liquid.giveFinalRuling(c.id, c.ruling, GAS),
            "deliver late final ruling",
          );
          await tx(child.resolveChallenge(c.wallet, GAS), "settle held share");
          settleModel(c);
          ++stats.lateSettlements;
          await checkpoint("late resolution");
          await reject(
            child.resolveChallenge.staticCall(c.wallet),
            "WrongChallengeState",
            child,
          );
        }
        for (const c of cases.filter((c) => c.kind === "unmatched")) {
          await reject(
            child.resolveChallenge.staticCall(c.wallet),
            "WrongChallengeState",
            child,
          );
        }
        const actualPoolCredits = [...attending].map((wallet) =>
          poolEntitlement.get(wallet),
        );
        const perHead = actualPoolCredits[0];
        for (const total of actualPoolCredits)
          eq(
            total,
            perHead,
            "every final attendee has equal cumulative pool entitlement",
          );
        const ideal = pool / BigInt(attending.size);
        ok(perHead <= ideal, "rounding cannot overpay equal final share");
        const losses = cases.filter(
          (c) => c.kind === "matched" && c.ruling !== 1,
        ).length;
        ok(
          ideal - perHead <= BigInt(losses + 1),
          "rounding loss is bounded by settlement rounds",
        );
        const dust = cash - sum(credits.values()) - sum(owed.values());
        eq(
          dust,
          pool - perHead * BigInt(attending.size),
          "all unallocated principal is rounding dust",
        );

        for (const wallet of failures)
          await rpc.request({
            method: "evm_setAccountCode",
            params: [wallet, "0x"],
          });
        failures.clear();
        failuresActive = false;
        for (const s of all) {
          const wallet = key(s.address);
          if (owed.get(wallet) !== 0n) {
            const amount = owed.get(wallet);
            await tx(
              child.connect(s).claim(beneficiary.address, GAS),
              "alternate-recipient owed claim",
            );
            owed.set(wallet, 0n);
            outputs.set(
              key(beneficiary.address),
              outputs.get(key(beneficiary.address)) + amount,
            );
            cash -= amount;
            ++stats.alternateClaims;
            await checkpoint("owed recovery");
          }
          if (credits.get(wallet) !== 0n) {
            const amount = credits.get(wallet);
            await tx(
              child.connect(s).withdrawPending(s.address, amount, GAS),
              "unused credit recovery after settlement",
            );
            credits.set(wallet, 0n);
            outputs.set(wallet, outputs.get(wallet) + amount);
            cash -= amount;
            ++stats.pendingWithdrawals;
            await checkpoint("pending recovery");
          }
        }
        await tx(
          child.sweep(owner.address, GAS),
          "sweep only final rounding dust",
        );
        cash -= dust;
        await checkpoint("completed settlement");
        eq(cash, 0n, "no unexplained terminal balance");
        for (const s of all) {
          const wallet = key(s.address);
          eq(
            await provider.getBalance(s.address),
            initial.get(wallet) -
              inputs.get(wallet) +
              outputs.get(wallet) -
              gasSpent.get(wallet),
            "independent external wallet conservation includes transaction fees",
          );
        }
        ++stats.scenarios;
        return {
          seed,
          variant,
          participants: n,
          initialAttendees: baseCount,
          deposit,
          fee,
          cases: cases.map((c) => ({
            wallet: c.wallet,
            kind: c.kind,
            ruling: c.ruling,
            beforePayout: c.pre,
          })),
          finalAttendees: attending.size,
          perHead,
          dust,
          losses,
          traceActions: activeTrace.length,
        };
      }

      for (let pair = 0; pair < count / 2; ++pair) {
        const seed = (0x51eed000 + pair) >>> 0;
        const pairResults = [];
        for (let variant = 0; variant < 2; ++variant) {
          const snapshot = await rpc.request({
            method: "evm_snapshot",
            params: [],
          });
          try {
            const result = await scenario(seed, variant);
            completed.push(result);
            pairResults.push(result);
          } finally {
            await rpc.request({ method: "evm_revert", params: [snapshot] });
          }
        }
        eq(
          pairResults[0].finalAttendees,
          pairResults[1].finalAttendees,
          "settlement order cannot change attendance outcome",
        );
        const delta =
          pairResults[0].perHead > pairResults[1].perHead
            ? pairResults[0].perHead - pairResults[1].perHead
            : pairResults[1].perHead - pairResults[0].perHead;
        ok(
          delta <= BigInt(pairResults[0].losses + 1),
          "paired settlement orders differ only within bounded rounding dust",
        );
        ++stats.seeds;
        if ((pair + 1) % 8 === 0)
          console.log(
            `Settlement stress: ${stats.scenarios}/${count} scenarios, ${stats.transactions} transactions, ${stats.invariantChecks} invariant checkpoints`,
          );
      }
      const result = {
        suite: "v8-settlement",
        success: true,
        seedBase: 0x51eed000,
        sourceSha256,
        creationCodeHash,
        stats,
        elapsedMs: Math.round(performance.now() - started),
        scenarios: completed,
        model:
          "Independent exact integer holder/cash ledger, external balances including gas, paired reverse late orders",
        environment:
          "In-process Shanghai Ganache, synthetic code replacement for recipient failure, mock V1 adjudication only",
      };
      fs.writeFileSync(reportPath, json(result));
      console.log(`Settlement stress passed: ${json(stats).trim()}`);
    } catch (error) {
      fs.writeFileSync(
        reportPath,
        json({
          suite: "v8-settlement",
          success: false,
          stats,
          elapsedMs: Math.round(performance.now() - started),
          sourceSha256,
          creationCodeHash,
          seed: activeSeed,
          variant: activeVariant,
          error: error.stack ?? String(error),
          trace: activeTrace,
          completed,
        }),
      );
      throw error;
    } finally {
      provider.destroy();
      await rpc.disconnect();
    }
  },
);
