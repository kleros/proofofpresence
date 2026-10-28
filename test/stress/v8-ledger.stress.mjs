// Independent state-machine stress of v8 payer custody. No RPC URLs or live configs.
// Synthetic balance injection models forced surplus explicitly; all contract actions
// execute normally on an in-process EVM. This is bounded randomized testing, not proof.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ganache from "ganache";
import { ethers } from "ethers";

const DAY = 86_400;
const GAS = { gasLimit: 2_000_000 };
const SEEDS = Number(process.env.V8_LEDGER_SEEDS ?? 32);
const STEPS = Number(process.env.V8_LEDGER_STEPS ?? 64);
const artifact = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(
        name === "KlerosEventV8"
          ? `../../build/contracts/${name}.json`
          : `../../references/kickback/build/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const root = fileURLToPath(new URL("../../", import.meta.url));
const outputDir = process.env.STRESS_OUTPUT_DIR
  ? path.resolve(process.env.STRESS_OUTPUT_DIR)
  : path.join(root, "artifacts/stress/manual-ledger");
fs.mkdirSync(outputDir, { recursive: true });
const OUT = path.join(outputDir, "v8-ledger-stress.json");
const stats = {
  status: "running",
  success: false,
  suite: "v8-ledger-state-machine",
  seeds: [],
  configuredSeeds: SEEDS,
  stepsPerSeed: STEPS,
  generatedActions: 0,
  attemptedActions: 0,
  successfulTransactions: 0,
  expectedStaticRejections: 0,
  minedExpectedRejections: 0,
  minedTransactions: 0,
  syntheticBalanceInjections: 0,
  invariantSnapshots: 0,
  invariantAssertions: 0,
  actionKinds: {},
  rejectionReasons: {},
  scope: "Synthetic in-process Ganache; no live RPC/config",
};
const started = Date.now();
const writeStats = () =>
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      stats,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ) + "\n",
  );
const eq = (actual, expected, message) => {
  ++stats.invariantAssertions;
  assert.deepEqual(actual, expected, message);
};
function rng(seed) {
  let n = seed >>> 0;
  return (max) => {
    n ^= n << 13;
    n ^= n >>> 17;
    n ^= n << 5;
    return (n >>> 0) % max;
  };
}

let rpc,
  provider,
  signers,
  liquid,
  proxy,
  c,
  model,
  trace = [],
  currentSeed,
  snapshot;
const actors = [1, 2, 3, 4, 5, 6];
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
async function deploy(name, ...params) {
  const art = artifact(name);
  const deployed = await new ethers.ContractFactory(
    art.abi,
    art.bytecode,
    signers[0],
  ).deploy(...params, { gasLimit: 12_000_000 });
  await deployed.waitForDeployment();
  return deployed;
}
const now = async () =>
  Number(
    (
      await rpc.request({
        method: "eth_getBlockByNumber",
        params: ["latest", false],
      })
    ).timestamp,
  );
async function warpTo(timestamp) {
  await rpc.request({
    method: "evm_increaseTime",
    params: [timestamp - (await now())],
  });
  await rpc.request({ method: "evm_mine", params: [] });
  model.time = await now();
  eq(model.time, timestamp, "exact synthetic boundary");
}
const address = (i) =>
  i === -1 ? ethers.ZeroAddress : i === -2 ? c.target : signers[i].address;
function clone(s) {
  return {
    ...s,
    credit: [...s.credit],
    status: [...s.status],
    history: [...s.history],
    balances: [...s.balances],
  };
}
function pending(s) {
  return s.credit.reduce((sum, credit) => sum + credit, 0n);
}
function reserve(s) {
  return pending(s) + (s.phase === 0 ? s.D * BigInt(s.count) : 0n);
}
function output(s, to, amount) {
  s.balance -= amount;
  s.outgoing += amount;
  if (to >= 0) s.balances[to] += amount;
}
function transition(action) {
  const s = clone(model);
  const fail = (error) => ({ error });
  const isOwner = action.caller === 0;
  const validTo = action.to !== -1 && action.to !== -2;
  if (action.kind === "force") {
    s.balance += action.amount;
    s.forced += action.amount;
    return { next: s };
  }
  if (
    ["register", "reject", "refund", "cancel", "sweep", "post"].includes(
      action.kind,
    ) &&
    !isOwner
  )
    return fail("NotOwner");
  if (
    ["deposit", "register", "cancel", "emergency", "post"].includes(
      action.kind,
    ) &&
    s.phase !== 0
  )
    return fail("NotOpen");
  if (
    ["register", "cancel", "post"].includes(action.kind) &&
    s.time > s.deadline
  )
    return fail("TooLate");
  if (action.kind === "deposit") {
    if (s.time >= s.start) return fail("TooLate");
    if (action.amount === 0n) return fail("ZeroDeposit");
    s.credit[action.caller] += action.amount;
    s.balance += action.amount;
    s.deposited += action.amount;
    s.balances[action.caller] -= action.amount;
  } else if (action.kind === "register") {
    for (const i of action.wallets) {
      if (i < 0) return fail("ZeroAddress");
      if (![0, 3].includes(s.status[i])) return fail("AlreadyRegistered");
      if (s.credit[i] < s.D) return fail("InsufficientPendingDeposit");
      if (!s.history.includes(i)) s.history.push(i);
      s.credit[i] -= s.D;
      s.status[i] = 1;
      ++s.count;
    }
  } else if (action.kind === "reject") {
    for (const i of action.wallets) {
      if (i < 0) return fail("ZeroAddress");
      if (s.status[i] === 1 && s.phase === 0) --s.count;
      else {
        if (![0, 3].includes(s.status[i])) return fail("CannotReject");
        if (s.credit[i] < s.D) return fail("InsufficientPendingDeposit");
        s.credit[i] -= s.D;
      }
      s.status[i] = 3;
      output(s, i, s.D);
    }
  } else if (action.kind === "withdraw") {
    if (action.amount === 0n) return fail("InvalidPendingWithdrawal");
    if (s.credit[action.caller] < action.amount)
      return fail("InsufficientPendingDeposit");
    if (!validTo) return fail("ZeroAddress");
    s.credit[action.caller] -= action.amount;
    output(s, action.to, action.amount);
  } else if (action.kind === "refund") {
    if (action.amount > s.balance - reserve(s))
      return fail("InsufficientBalance");
    if (!validTo) return fail("ZeroAddress");
    output(s, action.to, action.amount);
  } else if (action.kind === "cancel") {
    for (const i of s.history)
      if (s.status[i] === 1) {
        s.status[i] = 2;
        output(s, i, s.D);
      }
    s.phase = 3;
  } else if (action.kind === "emergency") {
    if (s.time <= s.deadline) return fail("TooEarly");
    if (s.status[action.caller] !== 1) return fail("NotAStaker");
    if (!validTo) return fail("ZeroAddress");
    s.status[action.caller] = 2;
    --s.count;
    output(s, action.to, s.D);
  } else if (action.kind === "claim") return fail("NothingToClaim");
  else if (action.kind === "post") {
    if (s.time < s.start) return fail("TooEarly");
    throw new Error("post action must not enter Listed in this custody model");
  } else if (action.kind === "release") return fail("NotListed");
  else if (action.kind === "sweep") {
    if (s.phase !== 3) return fail("NotSettled");
    if (!validTo) return fail("ZeroAddress");
    output(s, action.to, s.balance - reserve(s));
  } else throw new Error(`Unknown action ${action.kind}`);
  return { next: s };
}

function call(action, simulation) {
  const connected = c.connect(signers[action.caller]);
  const invoke = (name, args) =>
    simulation
      ? connected[name].staticCall(...args, GAS)
      : connected[name](...args, GAS);
  switch (action.kind) {
    case "deposit":
      return simulation
        ? connected.deposit.staticCall({ value: action.amount, ...GAS })
        : action.receive
          ? signers[action.caller].sendTransaction({
              to: c.target,
              value: action.amount,
              ...GAS,
            })
          : connected.deposit({ value: action.amount, ...GAS });
    case "register":
      return invoke("registerStakers", [action.wallets.map(address)]);
    case "reject":
      return invoke("rejectAndRefund", [action.wallets.map(address)]);
    case "withdraw":
      return invoke("withdrawPending", [address(action.to), action.amount]);
    case "refund":
      return invoke("refund", [address(action.to), action.amount]);
    case "cancel":
      return invoke("cancel", []);
    case "emergency":
      return invoke("emergencyWithdraw", [address(action.to)]);
    case "claim":
      return invoke("claim", [address(action.to)]);
    case "post":
      return invoke("postAttendance", [[signers[1].address], model.D]);
    case "release":
      return invoke("releasePayouts", []);
    case "sweep":
      return invoke("sweep", [address(action.to)]);
    default:
      throw new Error(`Cannot invoke ${action.kind}`);
  }
}
async function check() {
  ++stats.invariantSnapshots;
  const reads = await Promise.all([
    c.pendingTotal(),
    c.stakerCount(),
    c.stakers(),
    c.phase(),
    c.reserved(),
    c.spare(),
    provider.getBalance(c.target),
    c.owedTotal(),
    c.heldBack(),
    c.challengeEscrow(),
    Promise.all(signers.map((s) => c.pendingDeposits(s.address))),
    Promise.all(signers.map((s) => c.status(s.address))),
    Promise.all(signers.map((s) => provider.getBalance(s.address))),
    Promise.all(signers.map((s) => c.owed(s.address))),
  ]);
  eq(reads[0], pending(model), "sum of payer credits equals pendingTotal");
  eq(reads[1], BigInt(model.count), "admitted principal count");
  eq(
    [...reads[2]],
    model.history.map(address),
    "history unique and exact in first-admission order",
  );
  eq(reads[3], BigInt(model.phase), "phase");
  eq(
    reads[4],
    reserve(model),
    "reserved obligation exactly equals independent model",
  );
  eq(reads[5], model.balance - reserve(model), "spare is only forced surplus");
  eq(reads[6], model.balance, "exact contract balance");
  eq(reads[7], 0n, "no failed EOA payment creates owed");
  eq(reads[8], 0n, "no held shares before listing");
  eq(reads[9], 0n, "no challenge money before listing");
  eq([...reads[10]], model.credit, "every wallet credit");
  eq(reads[11].map(Number), model.status, "every wallet status");
  eq(
    [...reads[12]],
    model.balances,
    "each actual EOA balance includes exact transfers and gas costs",
  );
  eq(
    [...reads[13]],
    Array(signers.length).fill(0n),
    "individual owed balances",
  );
  eq(
    model.deposited + model.forced,
    model.outgoing + model.balance,
    "every accepted or forced wei is conserved",
  );
  if (model.phase === 0)
    eq(
      model.status.filter((s) => s === 1).length,
      model.count,
      "active status count matches principal while Open",
    );
  eq(
    new Set(model.history).size,
    model.history.length,
    "readmission cannot inflate history",
  );
}
async function perform(action, mineExpected = false) {
  ++stats.attemptedActions;
  stats.actionKinds[action.kind] = (stats.actionKinds[action.kind] ?? 0) + 1;
  const expected = transition(action);
  trace.push({
    ...action,
    amount: action.amount?.toString(),
    expected: expected.error ?? "success",
  });
  if (expected.error) {
    ++stats.expectedStaticRejections;
    stats.rejectionReasons[expected.error] =
      (stats.rejectionReasons[expected.error] ?? 0) + 1;
    await assert.rejects(call(action, true), (error) => {
      const data = error.data ?? error.info?.error?.data?.result;
      eq(
        c.interface.parseError(data)?.name,
        expected.error,
        "exact expected custom-error reason",
      );
      return true;
    });
    if (mineExpected) {
      let receipt;
      try {
        await (await call(action, false)).wait();
        assert.fail("Expected transaction rejection");
      } catch (error) {
        receipt = error.receipt;
        assert.ok(receipt, "mined revert receipt");
      }
      eq(receipt.status, 0, "expected mined rejection is atomic");
      model.balances[action.caller] -= receipt.fee;
      ++stats.minedExpectedRejections;
      ++stats.minedTransactions;
    }
  } else if (action.kind === "force") {
    await rpc.request({
      method: "evm_setAccountBalance",
      params: [c.target, ethers.toBeHex(expected.next.balance)],
    });
    model = expected.next;
    ++stats.syntheticBalanceInjections;
  } else {
    const receipt = await (await call(action, false)).wait();
    eq(receipt.status, 1, "successful transaction receipt");
    model = expected.next;
    model.balances[action.caller] -= receipt.fee;
    ++stats.successfulTransactions;
    ++stats.minedTransactions;
  }
  await check();
}

async function runSeed(seed, index) {
  currentSeed = seed;
  trace = [];
  const choose = rng(seed);
  const t = await now();
  const D =
    BigInt(1 + choose(11)) * 1_000_000_000_000n + BigInt(1 + choose(97));
  c = await deploy(
    "KlerosEventV8",
    D,
    `Synthetic ledger seed ${seed}`,
    signers[0].address,
    t + 7200,
    t + 8 * DAY,
    [
      proxy.target,
      EXTRA,
      ["wallet=", ";contract=", ";organizer=", ""],
      "0x010204",
      "/ipfs/SyntheticLedgerStress",
    ],
  );
  model = {
    D,
    start: t + 7200,
    deadline: t + 8 * DAY,
    time: await now(),
    phase: 0,
    count: 0,
    credit: Array(signers.length).fill(0n),
    status: Array(signers.length).fill(0),
    history: [],
    balance: 0n,
    deposited: 0n,
    forced: 0n,
    outgoing: 0n,
    balances: await Promise.all(
      signers.map((s) => provider.getBalance(s.address)),
    ),
  };
  await check();
  for (const caller of actors)
    await perform({
      kind: "deposit",
      caller,
      amount: D * BigInt(1 + choose(3)) + BigInt(choose(101)),
      receive: choose(2) === 0,
    });
  await perform({ kind: "register", caller: 0, wallets: actors.slice(0, 3) });
  for (let step = 0; step < STEPS; ++step) {
    const wallet = actors[choose(actors.length)];
    const to =
      choose(8) === 0 ? (choose(2) ? -1 : -2) : actors[choose(actors.length)];
    const n = choose(100);
    let action;
    if (n < 22)
      action = {
        kind: "deposit",
        caller: wallet,
        amount:
          choose(12) === 0 ? 0n : D * BigInt(choose(3)) + BigInt(choose(101)),
        receive: choose(2) === 0,
      };
    else if (n < 43) {
      const wallets = [wallet];
      if (choose(3) === 0)
        wallets.push(choose(3) === 0 ? wallet : actors[choose(actors.length)]);
      if (choose(18) === 0) wallets.push(choose(2) ? -1 : -2);
      action = { kind: "register", caller: choose(7) === 0 ? 7 : 0, wallets };
    } else if (n < 61) {
      const wallets = [wallet];
      if (choose(4) === 0)
        wallets.push(choose(2) === 0 ? wallet : actors[choose(actors.length)]);
      if (choose(20) === 0) wallets.push(-1);
      action = { kind: "reject", caller: choose(7) === 0 ? 7 : 0, wallets };
    } else if (n < 80) {
      const credit = model.credit[wallet];
      const which = choose(5);
      const amount =
        which === 0
          ? 0n
          : which === 1
            ? credit + D
            : credit === 0n
              ? 1n
              : which === 2
                ? credit
                : credit / 2n + 1n;
      action = { kind: "withdraw", caller: wallet, to, amount };
    } else if (n < 88)
      action = {
        kind: "refund",
        caller: choose(3) === 0 ? 7 : 0,
        to,
        amount: choose(2) ? model.balance - reserve(model) : D,
      };
    else if (n < 91)
      action = { kind: "force", caller: 0, amount: BigInt(1 + choose(997)) };
    else if (n < 94) action = { kind: "claim", caller: wallet, to };
    else if (n < 97) action = { kind: "post", caller: choose(2) ? 0 : 7 };
    else if (n < 99) action = { kind: "emergency", caller: wallet, to };
    else action = { kind: "sweep", caller: choose(2) ? 0 : 7, to };
    ++stats.generatedActions;
    await perform(action, choose(3) === 0);
  }
  if (index % 2 === 0) {
    await perform({ kind: "cancel", caller: 7 }, true);
    await perform({ kind: "cancel", caller: 0 });
    await perform({ kind: "cancel", caller: 0 }, true);
    await perform({ kind: "deposit", caller: 1, amount: D }, true);
    await perform({ kind: "register", caller: 0, wallets: [1] }, true);
    await perform({ kind: "emergency", caller: 1, to: 8 }, true);
  } else {
    await warpTo(model.start);
    await perform({ kind: "deposit", caller: 1, amount: 0n }, true);
    const eligible = actors.find(
      (i) => [0, 3].includes(model.status[i]) && model.credit[i] >= D,
    );
    if (eligible !== undefined)
      await perform({ kind: "register", caller: 0, wallets: [eligible] });
    await perform({ kind: "emergency", caller: 1, to: 8 }, true);
    await warpTo(model.deadline);
    await perform({ kind: "emergency", caller: 1, to: 8 }, true);
    await warpTo(model.deadline + 1);
    await perform({ kind: "register", caller: 0, wallets: [] }, true);
    await perform({ kind: "cancel", caller: 0 }, true);
    await perform({ kind: "post", caller: 0 }, true);
    for (const caller of actors.filter((i) => model.status[i] === 1)) {
      await perform({ kind: "emergency", caller, to: -2 }, true);
      await perform({ kind: "emergency", caller, to: 8 });
      await perform({ kind: "emergency", caller, to: 8 }, true);
    }
  }
  for (const caller of actors) {
    const amount = model.credit[caller];
    if (amount > 0n) await perform({ kind: "withdraw", caller, to: 8, amount });
    await perform({ kind: "withdraw", caller, to: 8, amount: D }, true);
  }
  if (model.phase === 3) await perform({ kind: "sweep", caller: 0, to: 8 });
  else
    await perform({
      kind: "refund",
      caller: 0,
      to: 8,
      amount: model.balance - reserve(model),
    });
  eq(model.balance, 0n, "all terminal obligations independently recovered");
  eq(reserve(model), 0n, "no terminal pending/principal remains");
  stats.seeds.push({
    seed,
    generatedActions: STEPS,
    totalActions: trace.length,
    terminalPhase: model.phase,
    finalBalance: "0",
  });
  if ((index + 1) % 4 === 0) {
    writeStats();
    console.log(
      `ledger stress: ${index + 1}/${SEEDS} seeds; ${stats.attemptedActions} actions, ${stats.invariantSnapshots} state checks`,
    );
  }
}

try {
  // Reset a prior manual result before validating options or touching the EVM.
  writeStats();
  assert.ok(Number.isInteger(SEEDS) && SEEDS > 0 && SEEDS <= 512);
  assert.ok(Number.isInteger(STEPS) && STEPS > 0 && STEPS <= 2048);
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: {
      chainId: 1337,
      hardfork: "shanghai",
      vmErrorsOnRPCResponse: false,
    },
    miner: { blockGasLimit: 60_000_000, timestampIncrement: 0 },
    wallet: { deterministic: true, totalAccounts: 9, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  signers = await Promise.all(
    Array.from({ length: 9 }, (_, i) => provider.getSigner(i)),
  );
  liquid = await deploy("MockKlerosLiquid");
  proxy = await deploy("MockArbitrableProxy", liquid.target);
  for (let index = 0; index < SEEDS; ++index) {
    snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
    await runSeed((0x9e3779b9 ^ (index + 1)) >>> 0, index);
    assert.equal(
      await rpc.request({ method: "evm_revert", params: [snapshot] }),
      true,
    );
  }
  stats.status = "passed";
  stats.success = true;
  stats.scenarios = stats.seeds.length;
  stats.sourceSha256 = createHash("sha256")
    .update(
      fs.readFileSync(
        new URL("../../contracts/KlerosEventV8.sol", import.meta.url),
      ),
    )
    .digest("hex");
  stats.durationMs = Date.now() - started;
  stats.elapsedMs = stats.durationMs;
  writeStats();
  console.log(
    `Ledger stress PASSED: ${SEEDS} seeds, ${stats.generatedActions} generated / ${stats.attemptedActions} total actions, ${stats.minedTransactions} mined transactions, ${stats.invariantAssertions} invariant assertions.`,
  );
} catch (error) {
  stats.status = "failed";
  stats.success = false;
  stats.failingSeed = currentSeed;
  stats.trace = trace;
  stats.error = error.stack ?? String(error);
  stats.durationMs = Date.now() - started;
  stats.elapsedMs = stats.durationMs;
  writeStats();
  console.error(error);
  process.exitCode = 1;
} finally {
  provider?.destroy();
  await rpc?.disconnect();
}
