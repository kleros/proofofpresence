// New v8 lifecycle regressions against in-process Ganache and the retained V1 Court/resolver mocks.
// Adjudication is mocked; custody, appeals integration, finality and ETH accounting execute locally.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";

const DAY = 86_400;
const D = ethers.parseEther("0.01");
const GAS = { gasLimit: 4_000_000 };
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]);
const artifact = (name) => JSON.parse(fs.readFileSync(new URL(
  name === "KlerosEventV8" ? `../build/contracts/${name}.json` : `../references/kickback/build/${name}.json`,
  import.meta.url,
)));
const send = async (pending) => (await pending).wait();
let rpc, provider, owner, alice, bob, carol, matcher, crowd, beneficiary, liquid, proxy;

async function deploy(name, ...args) {
  const a = artifact(name);
  const c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args, { gasLimit: 12_000_000 });
  await c.waitForDeployment();
  return c;
}
async function warp(seconds) {
  await rpc.request({ method: "evm_increaseTime", params: [seconds] });
  await rpc.request({ method: "evm_mine", params: [] });
}
async function fresh() {
  const t = Number((await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp);
  return deploy("KlerosEventV8", D, "Synthetic v8 arbitration", owner.address, t + 3600, t + 8 * DAY,
    [proxy.target, EXTRA, ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
      "0x010204", "/ipfs/SyntheticV8ArbitrationPolicy"]);
}
async function rejectsWith(pending, c, expected) {
  await assert.rejects(pending, (e) => {
    const data = e.data ?? e.info?.error?.data?.result;
    assert.equal(c.interface.parseError(data)?.name, expected);
    return true;
  });
}
async function matched() {
  const c = await fresh();
  await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
  for (const s of [bob, carol]) await send(c.connect(s).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([alice.address, bob.address, carol.address], GAS));
  await warp(3601);
  await send(c.postAttendance([alice.address], 3n * D, GAS));
  const fee = await c.challengeDeposit();
  await send(c.connect(bob).challenge({ value: fee, ...GAS }));
  await send(c.connect(matcher).matchChallenge(bob.address, { value: fee, ...GAS }));
  const challenge = await c.challenges(bob.address);
  assert.notEqual(challenge.arbitratorDisputeID, challenge.localDisputeID, "Court and resolver IDs differ");
  await warp(DAY + 1);
  await send(c.releasePayouts(GAS));
  assert.equal(await c.heldBack(), 3n * D / 2n);
  assert.equal(await c.pendingTotal(), D);
  return { c, fee, id: challenge.arbitratorDisputeID, local: challenge.localDisputeID };
}
async function claimAppeal(local, funder, expected) {
  const before = await provider.getBalance(funder.address);
  await send(proxy.withdrawFeesAndRewardsForAllRounds(local, funder.address, [1, 2], GAS));
  assert.equal(await provider.getBalance(funder.address), before + expected,
    "third-party withdrawal pays the contributor, independently from the event escrow");
  assert.equal(await proxy.getTotalWithdrawableAmount(local, funder.address, [1, 2]), 0n);
}
before(async () => {
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 }, wallet: { totalAccounts: 8, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  [owner, alice, bob, carol, matcher, crowd, beneficiary] = await Promise.all(
    Array.from({ length: 7 }, (_, i) => provider.getSigner(i)),
  );
  liquid = await deploy("MockKlerosLiquid");
  proxy = await deploy("MockArbitrableProxy", liquid.target);
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });

test("v8 waits for delivered final ruling across a funded appeal and rewards actual contributors directly", async () => {
  const { c, fee, id, local } = await matched();
  const eventBalance = await provider.getBalance(c.target);
  await send(liquid.startAppealPeriod(id, 2, 3 * DAY, GAS));
  await rejectsWith(c.resolveChallenge.staticCall(bob.address), c, "NotRuled");
  const cost = await liquid.appealCost(id, EXTRA);
  const status = await c.appealStatus(bob.address);
  assert.equal(status.ruling, 2n);
  assert.equal(status.costAttended, 3n * cost);
  assert.equal(status.costAbsent, 2n * cost);
  assert.equal(status.loserEnd, status.start + (status.end - status.start) / 2n);
  await send(proxy.connect(crowd).fundAppeal(local, 1, { value: cost, ...GAS }));
  // Deliberate surplus: the resolver must record only the missing contribution and return excess.
  const bobBefore = await provider.getBalance(bob.address);
  const funded = await send(proxy.connect(bob).fundAppeal(local, 1, { value: 3n * cost, ...GAS }));
  assert.equal(await provider.getBalance(bob.address), bobBefore - 2n * cost - funded.fee);
  await send(proxy.connect(matcher).fundAppeal(local, 2, { value: 2n * cost, ...GAS }));
  assert.equal(await liquid.rounds(id), 2n);
  assert.equal((await c.appealStatus(bob.address)).end, 0n);
  assert.equal(await provider.getBalance(c.target), eventBalance, "appeals never use event reserves");
  const contributions = await proxy.queryFilter(proxy.filters.Contribution(local));
  assert.deepEqual(contributions.map((l) => [l.args.contributor, l.args.ruling, l.args.amount]), [
    [crowd.address, 1n, cost], [bob.address, 1n, 2n * cost], [matcher.address, 2n, 2n * cost],
  ]);
  await rejectsWith(c.resolveChallenge.staticCall(bob.address), c, "NotRuled");
  await send(liquid.startAppealPeriod(id, 1, DAY, GAS));
  await warp(DAY + 1);
  await rejectsWith(c.resolveChallenge.staticCall(bob.address), c, "NotRuled");
  await send(liquid.passPeriod(id, GAS));
  await rejectsWith(c.resolveChallenge.staticCall(bob.address), c, "NotRuled");
  await send(liquid.executeRuling(id, GAS));
  assert.equal((await proxy.disputes(local)).ruling, 1n);
  const rewards = 4n * cost; // 3x + 2x contributions, less the 1x appeal fee.
  await claimAppeal(local, crowd, rewards / 3n);
  await claimAppeal(local, bob, rewards * 2n / 3n);
  assert.equal(await proxy.getTotalWithdrawableAmount(local, matcher.address, [1, 2]), 0n);
  assert.equal(await proxy.getTotalWithdrawableAmount(local, c.target, [1, 2]), 0n);
  assert.equal(await provider.getBalance(c.target), eventBalance);
  const beforeSettlement = await provider.getBalance(bob.address);
  await send(c.resolveChallenge(bob.address, GAS));
  assert.equal(await provider.getBalance(bob.address), beforeSettlement + 3n * D / 2n + fee);
  assert.equal(await c.attended(bob.address), true);
  assert.equal(await c.heldBack(), 0n);
  assert.equal(await c.challengeEscrow(), 0n);
  assert.equal(await c.reserved(), D, "pending payer credit survives Court settlement");
  await rejectsWith(c.resolveChallenge.staticCall(bob.address), c, "WrongChallengeState");
});

test("v8 follows one-sided appeal funding override and leaves contributor reimbursements outside custody", async () => {
  const { c, fee, id, local } = await matched();
  const eventBalance = await provider.getBalance(c.target);
  await send(liquid.startAppealPeriod(id, 2, 2 * DAY, GAS));
  const cost = await liquid.appealCost(id, EXTRA);
  await send(proxy.connect(crowd).fundAppeal(local, 1, { value: cost, ...GAS }));
  await send(proxy.connect(bob).fundAppeal(local, 1, { value: 2n * cost, ...GAS }));
  await send(proxy.connect(matcher).fundAppeal(local, 2, { value: cost, ...GAS }));
  await warp(Math.floor(1.5 * DAY));
  await assert.rejects(proxy.connect(crowd).fundAppeal.staticCall(local, 1, { value: 1n }),
    /Funding must be made within the appeal period/);
  await warp(DAY);
  await assert.rejects(proxy.connect(matcher).fundAppeal.staticCall(local, 2, { value: cost }),
    /Funding must be made within the appeal period/);
  await rejectsWith(c.resolveChallenge.staticCall(bob.address), c, "NotRuled");
  await send(liquid.passPeriod(id, GAS));
  await send(liquid.executeRuling(id, GAS));
  assert.equal(await liquid.rounds(id), 1n);
  assert.equal(await liquid.currentRuling(id), 2n, "juror vote remains absent");
  assert.equal((await proxy.disputes(local)).ruling, 1n, "only attended was fully funded");
  for (const [funder, paid] of [[crowd, cost], [bob, 2n * cost], [matcher, cost]]) {
    await claimAppeal(local, funder, paid);
  }
  assert.equal(await provider.getBalance(c.target), eventBalance);
  const before = await provider.getBalance(bob.address);
  await send(c.resolveChallenge(bob.address, GAS));
  assert.equal(await provider.getBalance(bob.address), before + 3n * D / 2n + fee);
  assert.equal(await c.attended(bob.address), true);
  assert.equal(await c.reserved(), D);
  assert.equal(await c.pendingTotal(), D);
});

test("v8 ruling zero excludes the challenger, splits challenge escrow and redistributes its held share while retaining pending credit", async () => {
  const originalFee = await liquid.feeForJuror();
  // An odd total exercises the existing one-wei remainder paid to the matcher on ruling zero.
  await send(liquid.setFeeForJuror(originalFee + 1n, GAS));
  try {
    const { c, fee, id } = await matched();
    assert.equal(fee % 2n, 1n);
    await send(liquid.giveFinalRuling(id, 0, GAS));
    const aliceBefore = await provider.getBalance(alice.address);
    const bobBefore = await provider.getBalance(bob.address);
    const matcherBefore = await provider.getBalance(matcher.address);
    await send(c.resolveChallenge(bob.address, GAS));
    assert.equal(await provider.getBalance(alice.address), aliceBefore + 3n * D / 2n);
    assert.equal(await provider.getBalance(bob.address), bobBefore + fee / 2n);
    assert.equal(await provider.getBalance(matcher.address), matcherBefore + fee - fee / 2n);
    assert.equal(await c.attended(bob.address), false);
    assert.equal(await c.attendeeCount(), 1n);
    assert.equal(await c.challengeEscrow(), 0n);
    assert.equal(await c.heldBack(), 0n);
    assert.equal(await c.pendingTotal(), D);
    assert.equal(await c.reserved(), D);
    assert.equal(await c.spare(), 0n);
    await rejectsWith(c.refund.staticCall(owner.address, 1n), c, "InsufficientBalance");
    await send(c.connect(alice).withdrawPending(beneficiary.address, D, GAS));
    assert.equal(await provider.getBalance(c.target), 0n);
  } finally {
    await send(liquid.setFeeForJuror(originalFee, GAS));
  }
});

test("v8 cancellation and subsequent owed claims resist recipient callbacks without consuming pending credit", async () => {
  const c = await fresh();
  const callback = await deploy("TestWallet");
  const refusing = await deploy("TestWallet");
  for (const w of [callback, refusing]) {
    await send(w.exec(c.target, c.interface.encodeFunctionData("deposit"), { value: 2n * D, ...GAS }));
  }
  await send(c.connect(alice).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([callback.target, refusing.target, alice.address], GAS));
  await send(callback.setReentry(c.target, c.interface.encodeFunctionData("deposit"), D));
  await send(refusing.setMode(1));
  const aliceBefore = await provider.getBalance(alice.address);
  await send(c.cancel(GAS));
  assert.equal(await provider.getBalance(alice.address), aliceBefore + D);
  assert.equal(await callback.reentered(), true);
  assert.equal(await callback.reentryOk(), false);
  assert.equal(c.interface.parseError(await callback.reentryError()).name, "Reentrancy");
  assert.equal(await c.owed(refusing.target), D);
  assert.equal(await c.pendingDeposits(callback.target), D);
  assert.equal(await c.pendingDeposits(refusing.target), D);
  assert.equal(await c.reserved(), 3n * D);
  await send(callback.setReentry(c.target, c.interface.encodeFunctionData("claim", [beneficiary.address]), 0));
  const callbackBefore = await provider.getBalance(callback.target);
  await send(refusing.exec(c.target, c.interface.encodeFunctionData("claim", [callback.target]), GAS));
  assert.equal(await provider.getBalance(callback.target), callbackBefore + D);
  assert.equal(await callback.reentered(), true);
  assert.equal(await callback.reentryOk(), false);
  assert.equal(c.interface.parseError(await callback.reentryError()).name, "Reentrancy");
  assert.equal(await c.owedTotal(), 0n);
  assert.equal(await c.pendingTotal(), 2n * D);
  assert.equal(await c.reserved(), 2n * D);
  for (const w of [callback, refusing]) {
    await send(w.exec(c.target, c.interface.encodeFunctionData("withdrawPending", [beneficiary.address, D]), GAS));
  }
  assert.equal(await c.reserved(), 0n);
  assert.equal(await provider.getBalance(c.target), 0n);
});
