import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ganache from "ganache";
import solc from "solc-hardened";
import { ethers } from "ethers";

const started = performance.now();
const outDir =
  process.env.STRESS_OUTPUT_DIR ?? "artifacts/stress/manual-hostile";
fs.mkdirSync(outDir, { recursive: true });
const stats = {
  suite: "hostile",
  success: false,
  callbackPaths: 0,
  callbackAttempts: 0,
  callbackVectors: 0,
  blockedReentries: 0,
  gasProbes: 0,
  gasProbeSuccesses: 0,
  gasProbeReverts: 0,
  hostileRecipientScenarios: 0,
  largeReturnDataScenarios: 0,
  feeScenarios: 0,
  feeGuardMinedReverts: 0,
  invariantChecks: 0,
};
const trace = [];
const record = () =>
  fs.writeFileSync(
    path.join(outDir, "v8-hostile-stress.json"),
    JSON.stringify(
      { ...stats, elapsedMs: Math.round(performance.now() - started), trace },
      null,
      2,
    ) + "\n",
  );
const D = 101n;
const FEE = 21n;
const DAY = 86400;
const CAP = 16_777_216;
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
const MODE = {
  accept: 0,
  refuse: 1,
  burn: 2,
  returns: 3,
  reverts: 4,
  reenter: 5,
};
const artifact = (name) =>
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
let completed = 0;
function checkedTest(name, run) {
  test(name, async () => {
    try {
      await run();
      completed++;
    } catch (error) {
      stats.failure = {
        test: name,
        message: error.message,
        stack: error.stack,
      };
      record();
      throw error;
    }
  });
}
let rpc, provider, owner, ordinary, omitted, other, liquid, proxy, fixtures;
const send = async (pending) => (await pending).wait();
const now = async () =>
  Number(
    (
      await rpc.request({
        method: "eth_getBlockByNumber",
        params: ["latest", false],
      })
    ).timestamp,
  );
async function warp(seconds) {
  await rpc.request({ method: "evm_increaseTime", params: [seconds] });
  await rpc.request({ method: "evm_mine", params: [] });
}
async function deploy(a, ...args) {
  const c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(
    ...args,
    { gasLimit: CAP },
  );
  await c.waitForDeployment();
  return c;
}
async function fresh() {
  const t = await now();
  return deploy(
    artifact("KlerosEventV8"),
    D,
    "Hostile local stress",
    owner.address,
    t + 3600,
    t + 8 * DAY,
    [
      proxy.target,
      EXTRA,
      ["wallet:", " contract:", " organizer:", ""],
      "0x010204",
      "/ipfs/SyntheticHostileStress",
    ],
  );
}
const encode = (c, fn, args = []) => c.interface.encodeFunctionData(fn, args);
const invoke = (wallet, c, fn, args = [], value = 0n) =>
  send(wallet.execute(c.target, encode(c, fn, args), { value, gasLimit: CAP }));
async function solvent(c) {
  const r = await c.reserved();
  const phase = await c.phase();
  const expected =
    (phase === 0n || phase === 1n
      ? D * (await c.stakerCount())
      : await c.heldBack()) +
    (await c.pendingTotal()) +
    (await c.owedTotal()) +
    (await c.challengeEscrow());
  assert.equal(r, expected);
  assert.ok((await provider.getBalance(c.target)) >= r);
  stats.invariantChecks += 2;
}
async function setup(kind) {
  const c = await fresh();
  const wallet = await deploy(fixtures.StressWallet);
  await invoke(wallet, c, "deposit", [], 3n * D);
  await send(c.connect(ordinary).deposit({ value: D }));
  await send(c.connect(omitted).deposit({ value: D }));
  await send(
    c.registerStakers([wallet.target, ordinary.address, omitted.address], {
      gasLimit: CAP,
    }),
  );
  let outer;
  if (kind === "pending")
    outer = () => invoke(wallet, c, "withdrawPending", [wallet.target, D]);
  if (kind === "reject")
    outer = () => send(c.rejectAndRefund([wallet.target], { gasLimit: CAP }));
  if (kind === "cancel") outer = () => send(c.cancel({ gasLimit: CAP }));
  if (kind === "claim") {
    await send(wallet.configure(MODE.refuse, c.target, "0x", 0));
    await send(c.rejectAndRefund([wallet.target], { gasLimit: CAP }));
    assert.equal(await c.owed(wallet.target), D);
    outer = () => invoke(wallet, c, "claim", [wallet.target]);
  }
  if (kind === "emergency") {
    await warp(8 * DAY + 1);
    outer = () => invoke(wallet, c, "emergencyWithdraw", [wallet.target]);
  }
  if (
    [
      "payout",
      "challenge-refund",
      "unmatched-refund",
      "match-refund",
      "held-winner",
    ].includes(kind)
  ) {
    await warp(3601);
    await send(
      c.postAttendance(
        kind === "payout"
          ? [wallet.target, ordinary.address]
          : [ordinary.address],
        kind === "payout" ? (3n * D) / 2n : 3n * D,
        { gasLimit: CAP },
      ),
    );
    if (kind === "challenge-refund")
      outer = () => invoke(wallet, c, "challenge", [], FEE + 1n);
    if (kind === "unmatched-refund") {
      await invoke(wallet, c, "challenge", [], FEE);
      await warp(DAY + 1);
      outer = () => send(c.resolveChallenge(wallet.target, { gasLimit: CAP }));
    }
    if (kind === "match-refund") {
      await send(c.connect(omitted).challenge({ value: FEE }));
      outer = () =>
        invoke(wallet, c, "matchChallenge", [omitted.address], FEE + 1n);
    }
    if (kind === "held-winner") {
      await invoke(wallet, c, "challenge", [], FEE);
      await send(
        c.matchChallenge(wallet.target, { value: FEE, gasLimit: CAP }),
      );
      await warp(DAY + 1);
      await send(c.releasePayouts({ gasLimit: CAP }));
      const challenge = await c.challenges(wallet.target);
      await send(
        liquid.giveFinalRuling(challenge.arbitratorDisputeID, 1, {
          gasLimit: 500_000,
        }),
      );
      outer = () => send(c.resolveChallenge(wallet.target, { gasLimit: CAP }));
    }
    if (kind === "payout") {
      await warp(DAY + 1);
      outer = () => send(c.releasePayouts({ gasLimit: CAP }));
    }
  }
  return { c, wallet, outer };
}
function vectors(c, wallet) {
  return [
    ["receive", "0x"],
    ["deposit", encode(c, "deposit")],
    ["register", encode(c, "registerStakers", [[other.address]])],
    ["reject", encode(c, "rejectAndRefund", [[wallet.target]])],
    ["pending", encode(c, "withdrawPending", [wallet.target, 1n])],
    ["refund", encode(c, "refund", [wallet.target, 1n])],
    ["token", encode(c, "returnToken", [wallet.target, wallet.target, 0])],
    ["post", encode(c, "postAttendance", [[wallet.target], D])],
    ["add", encode(c, "addAttendees", [[wallet.target]])],
    ["challenge", encode(c, "challenge")],
    ["match", encode(c, "matchChallenge", [wallet.target])],
    ["resolve", encode(c, "resolveChallenge", [wallet.target])],
    ["release", encode(c, "releasePayouts")],
    ["cancel", encode(c, "cancel")],
    ["claim", encode(c, "claim", [wallet.target])],
    ["emergency", encode(c, "emergencyWithdraw", [wallet.target])],
    ["sweep", encode(c, "sweep", [wallet.target])],
  ];
}
before(async () => {
  const input = {
    language: "Solidity",
    sources: {
      "Adversaries.sol": {
        content: fs.readFileSync(
          new URL("Adversaries.sol", import.meta.url),
          "utf8",
        ),
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.equal(
    (output.errors ?? []).filter((e) => e.severity === "error").length,
    0,
  );
  fixtures = Object.fromEntries(
    Object.entries(output.contracts["Adversaries.sol"]).map(([n, a]) => [
      n,
      { abi: a.abi, bytecode: "0x" + a.evm.bytecode.object },
    ]),
  );
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 31339, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 },
    wallet: { totalAccounts: 8, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  [owner, ordinary, omitted, other] = await Promise.all(
    [0, 1, 2, 3].map((i) => provider.getSigner(i)),
  );
  liquid = await deploy(artifact("MockKlerosLiquid"));
  await send(liquid.setFeeForJuror(7n));
  proxy = await deploy(artifact("MockArbitrableProxy"), liquid.target);
});
after(async () => {
  record();
  provider?.destroy();
  await rpc?.disconnect();
});

checkedTest(
  "callback matrix blocks every balance-sensitive entry during every payment path",
  async () => {
    for (const kind of [
      "pending",
      "reject",
      "cancel",
      "claim",
      "emergency",
      "challenge-refund",
      "unmatched-refund",
      "match-refund",
      "payout",
      "held-winner",
    ]) {
      const { c, wallet, outer } = await setup(kind);
      let snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
      stats.callbackPaths++;
      for (const [name, data] of vectors(c, wallet)) {
        trace.push({ kind, vector: name });
        await send(wallet.configure(MODE.reenter, c.target, data, 0));
        await outer();
        assert.equal(await wallet.callbackOK(), false, `${kind}/${name}`);
        assert.equal(
          await wallet.callbackSelector(),
          c.interface.getError("Reentrancy").selector,
          `${kind}/${name}`,
        );
        assert.ok((await wallet.calls()) > 1n);
        const attempts = Number(await wallet.callbackAttempts()) - 1;
        const blocked = Number(await wallet.blockedCallbacks()) - 1;
        assert.ok(attempts >= 1);
        assert.equal(
          blocked,
          attempts,
          "Every callback must be blocked, including multiple payments",
        );
        assert.equal(
          await wallet.successfulCallbacks(),
          1n,
          "No earlier successful callback may be masked",
        );
        stats.callbackVectors++;
        stats.callbackAttempts += attempts;
        stats.blockedReentries += blocked;
        await solvent(c);
        assert.equal(
          await rpc.request({ method: "evm_revert", params: [snapshot] }),
          true,
        );
        snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
      }
    }
  },
);

checkedTest(
  "large success/revert return data and gas burners cannot block unrelated payees",
  async () => {
    for (const mode of [MODE.refuse, MODE.burn, MODE.returns, MODE.reverts]) {
      const { c, wallet } = await setup("pending");
      await send(wallet.configure(mode, c.target, "0x", 0));
      await warp(3601);
      await send(
        c.postAttendance([wallet.target, ordinary.address], (3n * D) / 2n, {
          gasLimit: CAP,
        }),
      );
      await warp(DAY + 1);
      const before = await provider.getBalance(ordinary.address);
      await send(c.releasePayouts({ gasLimit: 1_000_000 }));
      assert.equal(await provider.getBalance(ordinary.address), before + 151n);
      assert.equal(await c.pendingDeposits(wallet.target), 2n * D);
      const expectedOwed = mode === MODE.returns ? 0n : 151n;
      assert.equal(await c.owed(wallet.target), expectedOwed);
      assert.equal(await c.pendingTotal(), 2n * D);
      await solvent(c);
      await send(wallet.configure(MODE.accept, c.target, "0x", 0));
      if (expectedOwed) {
        await invoke(wallet, c, "claim", [other.address]);
        await assert.rejects(invoke(wallet, c, "claim", [other.address]));
      }
      await invoke(wallet, c, "withdrawPending", [other.address, 2n * D]);
      assert.equal(await c.reserved(), 0n);
      assert.equal(await provider.getBalance(c.target), 1n);
      stats.hostileRecipientScenarios++;
      if (mode === MODE.returns || mode === MODE.reverts)
        stats.largeReturnDataScenarios++;
    }
  },
);

checkedTest(
  "low-gas execution either commits the full liability or reverts atomically",
  async () => {
    const { c, wallet } = await setup("payout");
    await send(wallet.configure(MODE.burn, c.target, "0x", 0));
    let snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
    for (let limit = 25_000; limit <= 250_000; limit += 5_000) {
      const before = await provider.getBalance(c.target);
      const r = await c.reserved();
      const eoaBefore = await provider.getBalance(ordinary.address);
      let succeeded = false;
      try {
        await send(c.releasePayouts({ gasLimit: limit }));
        succeeded = true;
      } catch (e) {
        assert.equal(
          e.receipt?.status,
          0,
          "Only a mined failed transaction counts as an atomic revert",
        );
      }
      if (succeeded) {
        assert.equal(await c.phase(), 2n);
        assert.equal(await c.owed(wallet.target), 151n);
        assert.equal(
          await provider.getBalance(ordinary.address),
          eoaBefore + 151n,
        );
        assert.equal(await c.reserved(), 2n * D + 151n);
        stats.gasProbeSuccesses++;
      } else {
        assert.equal(await c.phase(), 1n);
        assert.equal(await c.owedTotal(), 0n);
        assert.equal(await provider.getBalance(c.target), before);
        assert.equal(await c.reserved(), r);
        assert.equal(await provider.getBalance(ordinary.address), eoaBefore);
        stats.gasProbeReverts++;
      }
      stats.gasProbes++;
      await solvent(c);
      await rpc.request({ method: "evm_revert", params: [snapshot] });
      snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
    }
    assert.ok(stats.gasProbeSuccesses > 0 && stats.gasProbeReverts > 0);
  },
);

checkedTest(
  "forcibly sent ETH is spare without changing another event or payer liabilities",
  async () => {
    const c = await fresh(),
      independent = await fresh();
    await send(c.connect(ordinary).deposit({ value: D }));
    await send(independent.connect(ordinary).deposit({ value: 2n * D }));
    const force = await new ethers.ContractFactory(
      fixtures.ForcedEther.abi,
      fixtures.ForcedEther.bytecode,
      owner,
    ).deploy({ value: 17n, gasLimit: CAP });
    await force.waitForDeployment();
    await send(force.force(c.target));
    assert.equal(await c.spare(), 17n);
    assert.equal(await c.pendingDeposits(ordinary.address), D);
    assert.equal(await c.reserved(), D);
    assert.equal(await independent.spare(), 0n);
    assert.equal(await independent.pendingTotal(), 2n * D);
    await send(c.refund(other.address, 17n));
    await assert.rejects(c.refund.staticCall(other.address, 1n));
    await solvent(c);
    await solvent(independent);
  },
);

checkedTest(
  "fee changes from zero through maximum uint256 preserve collateral or reject atomically",
  async () => {
    for (const perJuror of [
      0n,
      1n,
      5n,
      7n,
      10n,
      14n,
      15n,
      10_000n,
      ethers.MaxUint256 / 3n,
    ]) {
      const cost = 3n * perJuror;
      for (const ruling of cost <= 2n * FEE ? [0, 1, 2] : [undefined]) {
        await send(liquid.setFeeForJuror(7n));
        const { c, wallet } = await setup("challenge-refund");
        await invoke(wallet, c, "challenge", [], FEE);
        await send(liquid.setFeeForJuror(perJuror));
        if (cost > 2n * FEE) {
          await assert.rejects(
            c
              .connect(other)
              .matchChallenge.staticCall(wallet.target, { value: FEE }),
            (error) => {
              assert.equal(
                c.interface.parseError(error.data)?.name,
                "ArbitrationCostTooHigh",
              );
              return true;
            },
          );
          const balance = await provider.getBalance(c.target);
          await assert.rejects(
            send(
              c
                .connect(other)
                .matchChallenge(wallet.target, { value: FEE, gasLimit: CAP }),
            ),
            (error) => {
              assert.equal(error.receipt?.status, 0);
              return true;
            },
          );
          stats.feeGuardMinedReverts++;
          assert.equal(await provider.getBalance(c.target), balance);
          assert.equal(await c.challengeEscrow(), FEE);
          assert.equal((await c.challenges(wallet.target)).state, 1n);
          await warp(DAY + 1);
          await send(c.resolveChallenge(wallet.target, { gasLimit: CAP }));
          assert.equal(await c.attended(wallet.target), true);
        } else {
          await send(
            c
              .connect(other)
              .matchChallenge(wallet.target, { value: FEE, gasLimit: CAP }),
          );
          const remaining = 2n * FEE - cost;
          assert.equal(await c.challengeEscrow(), remaining);
          const challenge = await c.challenges(wallet.target);
          assert.equal(challenge.arbitrationPaid, cost);
          await send(
            liquid.giveFinalRuling(challenge.arbitratorDisputeID, ruling, {
              gasLimit: 500_000,
            }),
          );
          const beforeWallet = await provider.getBalance(wallet.target);
          const beforeMatcher = await provider.getBalance(other.address);
          await send(c.resolveChallenge(wallet.target, { gasLimit: CAP }));
          const walletAward =
            ruling === 1 ? remaining : ruling === 0 ? remaining / 2n : 0n;
          assert.equal(
            await provider.getBalance(wallet.target),
            beforeWallet + walletAward,
          );
          assert.equal(
            await provider.getBalance(other.address),
            beforeMatcher + remaining - walletAward,
          );
          assert.equal(await c.attended(wallet.target), ruling === 1);
        }
        assert.equal(await c.challengeEscrow(), 0n);
        assert.equal(await c.pendingTotal(), 2n * D);
        await solvent(c);
        await warp(DAY + 1);
        await send(c.releasePayouts({ gasLimit: CAP }));
        await invoke(wallet, c, "withdrawPending", [other.address, 2n * D]);
        assert.equal(await c.reserved(), 0n);
        assert.equal(
          await provider.getBalance(c.target),
          (await c.attended(wallet.target)) ? 1n : 0n,
        );
        stats.feeScenarios++;
        trace.push({
          feePerJuror: perJuror.toString(),
          ruling: ruling ?? "guarded-unmatched",
        });
      }
    }
    await send(liquid.setFeeForJuror(7n));
  },
);

test("hostile suite completed with all invariants intact", () => {
  assert.equal(completed, 5);
  stats.success = true;
  record();
});
