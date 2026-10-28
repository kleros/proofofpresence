// Security regressions for new v8 deployments. Historical v7 fixtures remain unchanged.
// Synthetic accounts, in-process chain and mock Court adjudication only; no RPC/config loads.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";

const DAY = 86_400;
const D = ethers.parseEther("0.01");
const GAS = { gasLimit: 4_000_000 };
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]);
const POLICY = "/ipfs/SyntheticV8SecurityPolicy";
const artifact = (name) => JSON.parse(fs.readFileSync(new URL(
  name === "KlerosEventV8" ? `../build/contracts/${name}.json` : `../references/kickback/build/${name}.json`,
  import.meta.url,
)));
const send = async (pending) => (await pending).wait();
let rpc, provider, signers, owner, alice, bob, carol, liquid, proxy;

async function deploy(name, ...args) {
  const a = artifact(name);
  const c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args, { gasLimit: 12_000_000 });
  await c.waitForDeployment();
  return c;
}
const now = async () => Number((await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp);
async function warp(seconds) {
  await rpc.request({ method: "evm_increaseTime", params: [seconds] });
  await rpc.request({ method: "evm_mine", params: [] });
}
async function fresh(template) {
  const t = await now();
  // Minimal immutable JSON template exercising all mandatory identity slots.
  const pieces = template?.pieces ?? ['{"wallet":"', '","contract":"', '","organizer":"', '"}'];
  return deploy("KlerosEventV8", D, "Synthetic v8 security event", owner.address,
    t + 3600, t + 8 * DAY, [proxy.target, EXTRA, pieces, template?.slots ?? "0x010204", POLICY]);
}
async function rejectsWith(pending, c, expected) {
  await assert.rejects(pending, (e) => {
    const data = e.data ?? e.info?.error?.data?.result;
    assert.equal(c.interface.parseError(data)?.name, expected);
    return true;
  });
}
async function solvent(c) {
  assert.ok(await provider.getBalance(c.target) >= await c.reserved(), "balance covers every reserved obligation");
}
before(async () => {
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 }, wallet: { totalAccounts: 155, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  signers = await Promise.all(Array.from({ length: 155 }, (_, i) => provider.getSigner(i)));
  [owner, alice, bob, carol] = signers;
  liquid = await deploy("MockKlerosLiquid");
  proxy = await deploy("MockArbitrableProxy", liquid.target);
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });

test("v8 reserves per-wallet pending credit: owner cannot redirect it or register a nonpayer", async () => {
  const c = await fresh();
  await send(c.connect(alice).deposit({ value: 3n * D, ...GAS }));
  assert.equal(await c.pendingDeposits(alice.address), 3n * D);
  assert.equal(await c.pendingTotal(), 3n * D);
  assert.equal(await c.reserved(), 3n * D);
  assert.equal(await c.spare(), 0n);
  await rejectsWith(c.refund.staticCall(bob.address, D), c, "InsufficientBalance");
  await rejectsWith(c.registerStakers.staticCall([bob.address]), c, "InsufficientPendingDeposit");
  await rejectsWith(c.connect(bob).withdrawPending.staticCall(bob.address, D), c, "InsufficientPendingDeposit");
  await assert.rejects(send(c.registerStakers([alice.address, bob.address], GAS)));
  assert.equal(await c.pendingDeposits(alice.address), 3n * D, "failed batch rolls back consumed collateral");
  assert.equal(await c.stakerCount(), 0n);
  await rejectsWith(c.registerStakers.staticCall([alice.address, alice.address]), c, "AlreadyRegistered");
  await send(c.registerStakers([alice.address], GAS));
  assert.equal(await c.pendingDeposits(alice.address), 2n * D);
  assert.equal(await c.pendingTotal(), 2n * D);
  assert.equal(await c.reserved(), 3n * D);
  await rejectsWith(c.registerStakers.staticCall([alice.address]), c, "AlreadyRegistered");
  assert.equal(await c.pendingDeposits(alice.address), 2n * D);
  await solvent(c);
});

test("v8 pending withdrawal supports partial/alternate recovery and reverts atomically on a failed recipient", async () => {
  const c = await fresh();
  const w = await deploy("TestWallet");
  await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(w.setMode(1)); // refuse ETH
  await assert.rejects(send(c.connect(alice).withdrawPending(w.target, D, GAS)));
  assert.equal(await c.pendingDeposits(alice.address), 2n * D);
  const before = await provider.getBalance(bob.address);
  await send(c.connect(alice).withdrawPending(bob.address, D, GAS));
  assert.equal(await provider.getBalance(bob.address), before + D);
  assert.equal(await c.pendingDeposits(alice.address), D);
  assert.equal(await c.pendingTotal(), D);
  await rejectsWith(c.connect(alice).withdrawPending.staticCall(bob.address, 2n * D), c, "InsufficientPendingDeposit");
  await send(c.cancel(GAS));
  await send(c.connect(alice).withdrawPending(bob.address, D, GAS));
  assert.equal(await c.pendingTotal(), 0n);
  assert.equal(await provider.getBalance(c.target), 0n);
});

test("v8 rejects reused credit and preserves principal plus excess through rejection/readmission/cancellation", async () => {
  const c = await fresh();
  await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(c.connect(bob).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([alice.address], GAS));
  const before = await provider.getBalance(alice.address);
  await send(c.rejectAndRefund([alice.address], GAS));
  assert.equal(await provider.getBalance(alice.address), before + D);
  assert.equal(await c.pendingDeposits(alice.address), D);
  await send(c.registerStakers([alice.address], GAS));
  assert.deepEqual([...await c.stakers()], [alice.address]);
  assert.equal(await c.pendingDeposits(alice.address), 0n);
  await send(c.rejectAndRefund([alice.address], GAS));
  await rejectsWith(c.registerStakers.staticCall([alice.address]), c, "InsufficientPendingDeposit");
  await rejectsWith(c.rejectAndRefund.staticCall([alice.address]), c, "InsufficientPendingDeposit");
  assert.equal(await c.pendingDeposits(bob.address), D);
  await send(c.registerStakers([bob.address], GAS));
  await send(c.cancel(GAS));
  assert.equal(await c.pendingTotal(), 0n);
  assert.equal(await c.reserved(), 0n);
  assert.equal(await provider.getBalance(c.target), 0n);
});

test("v8 deposit cutoff and no-list recovery preserve unregistered credit without organizer action", async () => {
  const c = await fresh();
  await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(c.connect(bob).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([alice.address], GAS));
  await warp(3601);
  await rejectsWith(c.connect(carol).deposit.staticCall({ value: D }), c, "TooLate");
  await assert.rejects(provider.call({ from: carol.address, to: c.target, value: D }));
  await warp(8 * DAY);
  await send(c.connect(alice).emergencyWithdraw(alice.address, GAS));
  assert.equal(await c.stakerCount(), 0n);
  assert.equal(await c.reserved(), 2n * D);
  assert.equal(await c.pendingTotal(), 2n * D);
  await send(c.connect(alice).withdrawPending(carol.address, D, GAS));
  await send(c.connect(bob).withdrawPending(carol.address, D, GAS));
  assert.equal(await c.reserved(), 0n);
  assert.equal(await provider.getBalance(c.target), 0n);
});

test("v8 pending withdrawal callback cannot reenter or spend another credit", async () => {
  const c = await fresh();
  const w = await deploy("TestWallet");
  await send(w.exec(c.target, c.interface.encodeFunctionData("deposit"), { value: 2n * D, ...GAS }));
  await send(w.setReentry(c.target, c.interface.encodeFunctionData("withdrawPending", [w.target, D]), 0));
  await send(w.exec(c.target, c.interface.encodeFunctionData("withdrawPending", [w.target, D]), GAS));
  assert.equal(await w.reentered(), true);
  assert.equal(await w.reentryOk(), false);
  assert.equal(c.interface.parseError(await w.reentryError()).name, "Reentrancy");
  assert.equal(await c.pendingDeposits(w.target), D);
  assert.equal(await c.pendingTotal(), D);
  await solvent(c);
});

test("v8 pending withdrawals during Listed leave admitted attendance collateral intact", async () => {
  const c = await fresh();
  await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(c.connect(bob).deposit({ value: D, ...GAS }));
  await send(c.connect(carol).deposit({ value: 2n * D, ...GAS }));
  await send(c.registerStakers([alice.address, bob.address], GAS));
  await warp(3601);
  await send(c.postAttendance([alice.address], 2n * D, GAS));
  await send(c.connect(alice).withdrawPending(carol.address, D, GAS));
  await send(c.connect(carol).withdrawPending(carol.address, 2n * D, GAS));
  assert.equal(await c.pendingTotal(), 0n);
  assert.equal(await c.reserved(), 2n * D);
  await warp(DAY + 1);
  const before = await provider.getBalance(alice.address);
  await send(c.releasePayouts(GAS));
  assert.equal(await provider.getBalance(alice.address), before + 2n * D);
  assert.equal(await c.reserved(), 0n);
});

test("v8 failed pending-payer rejection reserves owed principal independently from excess credit", async () => {
  const c = await fresh();
  const w = await deploy("TestWallet");
  await send(w.exec(c.target, c.interface.encodeFunctionData("deposit"), { value: 2n * D, ...GAS }));
  await send(w.setMode(1));
  await send(c.rejectAndRefund([w.target], GAS));
  assert.equal(await c.pendingDeposits(w.target), D);
  assert.equal(await c.pendingTotal(), D);
  assert.equal(await c.owed(w.target), D);
  assert.equal(await c.owedTotal(), D);
  assert.equal(await c.reserved(), 2n * D);
  await send(w.exec(c.target, c.interface.encodeFunctionData("withdrawPending", [bob.address, D]), GAS));
  assert.equal(await c.reserved(), D);
  await send(w.exec(c.target, c.interface.encodeFunctionData("claim", [bob.address]), GAS));
  assert.equal(await c.reserved(), 0n);
  assert.equal(await provider.getBalance(c.target), 0n);
});

test("v8 caps lifetime unique admissions and repeated readmission never grows settlement history", async () => {
  const c = await fresh();
  assert.equal(await c.MAX_STAKERS(), 150n);
  const entrants = signers.slice(1, 152);
  await Promise.all(entrants.map((s) => send(c.connect(s).deposit({ value: D, gasLimit: 200_000 }))));
  const wallets = entrants.map((s) => s.address);
  for (let i = 0; i < 150; i += 50) await send(c.registerStakers(wallets.slice(i, i + 50), { gasLimit: 6_000_000 }));
  assert.equal((await c.stakers()).length, 150);
  await rejectsWith(c.registerStakers.staticCall([wallets[150]]), c, "CapacityExceeded");
  // Rejection cannot free lifetime capacity for unbounded historical iterations.
  await send(c.rejectAndRefund([wallets[0]], GAS));
  await rejectsWith(c.registerStakers.staticCall([wallets[150]]), c, "CapacityExceeded");
  for (let i = 0; i < 3; ++i) {
    await send(c.connect(entrants[0]).deposit({ value: D, ...GAS }));
    await send(c.registerStakers([wallets[0]], GAS));
    assert.equal((await c.stakers()).length, 150);
    assert.equal(await c.stakerCount(), 150n);
    if (i < 2) await send(c.rejectAndRefund([wallets[0]], GAS));
  }
  assert.equal(await c.pendingDeposits(wallets[150]), D);
  await send(c.cancel({ gasLimit: 16_777_216 }));
  assert.equal(await c.reserved(), D);
  await send(c.connect(entrants[150]).withdrawPending(entrants[150].address, D, GAS));
  assert.equal(await provider.getBalance(c.target), 0n);
});

test("v8 final absent/refused rulings cannot be overridden by addAttendees inside the original window", async () => {
  for (const ruling of [0, 2]) {
    const c = await fresh();
    for (const s of [alice, bob]) await send(c.connect(s).deposit({ value: D, ...GAS }));
    await send(c.registerStakers([alice.address, bob.address], GAS));
    await warp(3601);
    await send(c.postAttendance([alice.address], 2n * D, GAS));
    const fee = await c.challengeDeposit();
    await send(c.connect(bob).challenge({ value: fee, ...GAS }));
    await send(c.matchChallenge(bob.address, { value: fee, ...GAS }));
    await send(liquid.giveFinalRuling((await c.challenges(bob.address)).arbitratorDisputeID, ruling, GAS));
    await send(c.resolveChallenge(bob.address, GAS));
    await rejectsWith(c.addAttendees.staticCall([bob.address]), c, "ResolvedChallenge");
    assert.equal(await c.attended(bob.address), false);
    assert.equal(await c.attendeeCount(), 1n);
    await solvent(c);
  }
});

test("v8 case organizer identity follows ownership before challenge and stays fixed afterward", async () => {
  const c = await fresh();
  for (const s of [alice, bob, carol]) await send(c.connect(s).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([alice.address, bob.address, carol.address], GAS));
  const [initial] = await c.caseMetaEvidence(alice.address);
  assert.equal(JSON.parse(initial).organizer, owner.address);
  await send(c.transferOwnership(bob.address));
  await send(c.connect(bob).acceptOwnership());
  const [preview] = await c.caseMetaEvidence(alice.address);
  assert.equal(JSON.parse(preview).organizer, bob.address);
  await warp(3601);
  await send(c.connect(bob).postAttendance([carol.address], 3n * D, GAS));
  const fee = await c.challengeDeposit();
  await send(c.connect(alice).challenge({ value: fee, ...GAS }));
  const fixed = [...await c.caseMetaEvidence(alice.address)];
  assert.equal(await c.caseOrganizer(alice.address), bob.address);
  await send(c.connect(bob).transferOwnership(owner.address));
  await send(c.acceptOwnership());
  assert.deepEqual([...await c.caseMetaEvidence(alice.address)], fixed);
  await send(c.connect(bob).challenge({ value: fee, ...GAS }));
  assert.equal(await c.caseOrganizer(bob.address), owner.address);
  assert.equal(JSON.parse((await c.caseMetaEvidence(bob.address))[0]).organizer, owner.address);
});

function maximumTemplate() {
  const slots = "0x010204" + "01".repeat(29);
  const pieces = Array.from({ length: 33 }, (_, i) => i === 0 ? '{"padding":"","wallet":"'
    : i === 1 ? '","contract":"' : i === 2 ? '","organizer":"'
    : i === 32 ? '"}' : `","wallet${i}":"`);
  const size = () => ethers.getBytes(ethers.AbiCoder.defaultAbiCoder().encode(["string[]", "bytes"], [pieces, slots])).length;
  const available = 12_288 - size();
  assert.ok(available >= 0 && available % 32 === 0);
  pieces[0] = '{"padding":"' + "x".repeat(available) + '","wallet":"';
  assert.equal(size(), 12_288);
  return { pieces, slots };
}

test("v8 metadata bounds reject excess size/slots and a maximal valid case matches below the gas cap", async () => {
  const t = await now();
  const tpl = maximumTemplate();
  const args = () => [D, "Synthetic metadata bounds", owner.address, t + 3600, t + 8 * DAY,
    [proxy.target, EXTRA, [...tpl.pieces], tpl.slots, POLICY]];
  for (const mutate of [
    (a) => { a[1] = "x".repeat(257); },
    (a) => { a[5][4] = "x".repeat(513); },
    (a) => { a[5][1] = "0x" + "00".repeat(129); },
    (a) => { a[5][2][0] += "x".repeat(32); },
    (a) => { a[5][2] = Array(34).fill(""); a[5][3] = "0x010204" + "01".repeat(30); },
  ]) {
    const a = args();
    mutate(a);
    await assert.rejects(deploy("KlerosEventV8", ...a));
  }
  const c = await fresh(tpl);
  assert.equal(await c.MAX_META_SLOTS(), 32n);
  assert.equal(await c.MAX_META_BYTES(), 12_288n);
  for (const s of [alice, bob]) await send(c.connect(s).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([alice.address, bob.address], GAS));
  await warp(3601);
  await send(c.postAttendance([alice.address], 2n * D, GAS));
  const fee = await c.challengeDeposit();
  await send(c.connect(bob).challenge({ value: fee, ...GAS }));
  const [text, uri] = await c.caseMetaEvidence(bob.address);
  assert.equal(JSON.parse(text).organizer, owner.address);
  assert.ok(uri.startsWith("/ipfs/Qm"));
  const r = await send(c.matchChallenge(bob.address, { value: fee, gasLimit: 16_777_216 }));
  assert.ok(r.gasUsed * 130n / 100n <= 16_777_216n, "maximal metadata match retains 30% gas headroom");
  console.log(`v8 maximal metadata match: ${r.gasUsed} gas, encoded template 12288 bytes / 32 slots`);
});

test("v8 rejects a resolver that names an EOA as its arbitrator", async () => {
  const broken = await deploy("MockArbitrableProxy", alice.address);
  const t = await now();
  const a = artifact("KlerosEventV8");
  const factory = new ethers.ContractFactory(a.abi, a.bytecode, owner);
  const tx = await factory.getDeployTransaction(D, "Synthetic invalid arbitrator", owner.address,
    t + 3600, t + 8 * DAY,
    [broken.target, EXTRA, ["wallet:", " contract:", " organizer:", ""], "0x010204", POLICY]);
  await rejectsWith(provider.call({ ...tx, from: owner.address, gasLimit: 12_000_000 }), factory, "InvalidArbitrator");
});

test("v8 bounded 150-recipient failure batches preserve pending reserves and fit the transaction cap", async (t) => {
  const c = await fresh(maximumTemplate());
  const entrants = signers.slice(1, 151);
  const wallets = entrants.map((s) => s.address);
  t.after(async () => Promise.all(wallets.map((a) => rpc.request({ method: "evm_setAccountCode", params: [a, "0x"] }))));
  await Promise.all(entrants.map((s) => send(c.connect(s).deposit({ value: D, gasLimit: 200_000 }))));
  await send(c.connect(signers[151]).deposit({ value: 2n * D, ...GAS }));
  for (let i = 0; i < 150; i += 50) await send(c.registerStakers(wallets.slice(i, i + 50), { gasLimit: 6_000_000 }));
  const snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
  // Synthetic account-code replacement models a previously funded account whose delegated
  // recipient code later consumes its full stipend. No production account is modified.
  const burn = async (list) => Promise.all(list.map((a) => rpc.request({ method: "evm_setAccountCode", params: [a, "0xfe"] })));
  const withinCap = (receipt, label) => {
    assert.ok(receipt.gasUsed * 130n / 100n <= 16_777_216n, `${label} retains 30% headroom under the transaction cap`);
    return receipt.gasUsed;
  };
  await warp(3601);
  await send(c.postAttendance(wallets, D, { gasLimit: 16_777_216 }));
  await burn(wallets);
  await warp(DAY + 1);
  const directGas = withinCap(await send(c.releasePayouts({ gasLimit: 16_777_216 })), "150-recipient release");
  assert.equal(await c.owedTotal(), 150n * D);
  assert.equal(await c.pendingTotal(), 2n * D);
  assert.equal(await c.reserved(), 152n * D);
  await solvent(c);
  assert.equal(await rpc.request({ method: "evm_revert", params: [snapshot] }), true);
  await warp(3601);
  const challenger = entrants[149];
  await send(c.postAttendance(wallets.slice(0, 149), 150n * D / 149n, { gasLimit: 16_777_216 }));
  const fee = await c.challengeDeposit();
  await send(c.connect(challenger).challenge({ value: fee, ...GAS }));
  await send(c.matchChallenge(challenger.address, { value: fee, gasLimit: 16_777_216 }));
  await burn(wallets.slice(0, 149));
  await warp(DAY + 1);
  const heldGas = withinCap(await send(c.releasePayouts({ gasLimit: 16_777_216 })), "149-recipient release with open case");
  assert.equal(await c.heldBack(), D);
  await send(liquid.giveFinalRuling((await c.challenges(challenger.address)).arbitratorDisputeID, 2, GAS));
  const lostGas = withinCap(await send(c.resolveChallenge(challenger.address, { gasLimit: 16_777_216 })), "lost-case redistribution");
  assert.equal(await c.heldBack(), 0n);
  assert.equal(await c.challengeEscrow(), 0n);
  assert.equal(await c.pendingTotal(), 2n * D);
  assert.equal(await c.reserved(), await c.owedTotal() + 2n * D);
  await solvent(c);
  console.log(`v8 worst failure gas: 150 release ${directGas}, open-case release ${heldGas}, lost-case settlement ${lostGas}`);
});

test("v8 seeded settlement orders conserve pool, pending reserves and equal held shares with failed-wallet claims", async () => {
  const scenarios = [[1, 2, 0], [2, 1, 1], [0, 0, 2], [1, 1, 1]];
  for (const [seed, rulings] of scenarios.entries()) {
    const c = await fresh();
    const w = await deploy("TestWallet");
    const guests = signers.slice(1, 6);
    for (const s of guests) await send(c.connect(s).deposit({ value: D, ...GAS }));
    await send(w.exec(c.target, c.interface.encodeFunctionData("deposit"), { value: D, ...GAS }));
    await send(w.setMode(1));
    await send(c.connect(signers[7]).deposit({ value: 2n * D, ...GAS }));
    const all = [w.target, ...guests.map((s) => s.address)];
    await send(c.registerStakers(all, GAS));
    await warp(3601);
    await send(c.postAttendance([w.target, guests[0].address], 3n * D, GAS));
    const cases = guests.slice(1, 4);
    const fee = await c.challengeDeposit();
    for (const s of cases) {
      await send(c.connect(s).challenge({ value: fee, ...GAS }));
      await send(c.matchChallenge(s.address, { value: fee, ...GAS }));
    }
    await warp(DAY + 1);
    const payments = new Map(all.map((a) => [a.toLowerCase(), 0n]));
    const record = (receipt) => {
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== c.target.toLowerCase()) continue;
        const e = c.interface.parseLog(log);
        if (e?.name === "Payout") payments.set(e.args.to.toLowerCase(), (payments.get(e.args.to.toLowerCase()) ?? 0n) + e.args.amount);
      }
    };
    const check = async () => {
      const held = await Promise.all(cases.map(async (s) => (await c.challenges(s.address)).heldShare));
      assert.equal(await c.heldBack(), held.reduce((a, b) => a + b, 0n));
      assert.equal(await c.pendingTotal(), 2n * D);
      await solvent(c);
      const totals = await Promise.all((await c.attendees()).map(async (a) => payments.get(a.toLowerCase()) + await c.owed(a)));
      assert.ok(totals.every((a) => a === totals[0]), "all attendees receive identical cumulative pool entitlements");
      for (const h of held) if (h > 0n) assert.equal(h, totals[0], "open cases hold one full cumulative attendee share");
    };
    record(await send(c.releasePayouts(GAS)));
    await check();
    // Deterministic pseudo-random settlement permutations, reproducible on failure.
    let state = seed + 271;
    const order = [0, 1, 2];
    for (let i = order.length - 1; i > 0; --i) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const i of order) {
      await send(liquid.giveFinalRuling((await c.challenges(cases[i].address)).arbitratorDisputeID, rulings[i], GAS));
      record(await send(c.resolveChallenge(cases[i].address, GAS)));
      await check();
    }
    assert.equal(await c.challengeEscrow(), 0n);
    assert.equal(await c.heldBack(), 0n);
    const atts = await c.attendees();
    const delivered = [...payments.values()].reduce((a, b) => a + b, 0n);
    const walletOwed = await c.owed(w.target);
    const dust = await c.spare();
    assert.equal(delivered + walletOwed + dust, 6n * D, "principal conserved including rounding dust and failed payments");
    assert.ok(dust < BigInt(atts.length * 4));
    const before = await provider.getBalance(signers[8].address);
    await send(w.exec(c.target, c.interface.encodeFunctionData("claim", [signers[8].address]), GAS));
    assert.equal(await provider.getBalance(signers[8].address), before + walletOwed);
    assert.equal(await c.owedTotal(), 0n);
    assert.equal(await c.reserved(), 2n * D);
    await send(c.connect(signers[7]).withdrawPending(signers[8].address, 2n * D, GAS));
    assert.equal(await c.reserved(), 0n);
    assert.equal(await provider.getBalance(c.target), dust);
  }
});
