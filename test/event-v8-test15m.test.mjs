// Fast-profile custody executes on an isolated in-process chain10200. Only Court adjudication
// is mocked. These tests never load a public RPC, signing file, manifest or operator journal.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";

const PROFILE = "kleros-event-v8-test15m";
const VERSION = 80015n;
const PERIOD = 900;
const DAY = 86_400;
const D = ethers.parseEther("0.01");
const GAS = { gasLimit: 4_000_000 };
const DEPLOY_GAS = { gasLimit: 16_777_216 };
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]);
const artifact = (name) => JSON.parse(fs.readFileSync(new URL(
  name.endsWith("Test15m") ? `../build/contracts-test15m/${name}.json`
    : `../references/kickback/build/${name}.json`, import.meta.url,
)));
const eventArtifact = artifact("KlerosEventV8Test15m");
const factoryArtifact = artifact("KlerosEventFactoryV8Test15m");
const send = async (pending) => (await pending).wait();
let rpc, provider, owner, alice, bob, matcher, beneficiary, liquid, proxy;

function localChain(chainId) {
  return ganache.provider({
    logging: { quiet: true },
    chain: { chainId, hardfork: "shanghai", time: new Date("2026-10-01T00:00:00Z") },
    miner: { blockGasLimit: 60_000_000, timestampIncrement: 0 },
    wallet: { totalAccounts: 7, defaultBalance: 1000 },
  });
}
function browserProvider(rpc) {
  const p = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  p.pollingInterval = 10;
  return p;
}
async function deploy(a, signer, ...args) {
  const c = await new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(...args, DEPLOY_GAS);
  await c.waitForDeployment();
  return c;
}
const now = async () => Number((await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp);
// This clock belongs to the isolated Ganache provider above; public-chain time is never altered.
async function advanceTo(timestamp) {
  assert.ok(timestamp >= await now(), "local test clock moves forward only");
  await rpc.request({ method: "evm_setTime", params: [timestamp * 1000] });
  await rpc.request({ method: "evm_mine", params: [] });
  assert.equal(await now(), timestamp);
}
function params(t, resolver = proxy.target, organizer = owner.address) {
  return {
    depositAmount: D, eventName: "Synthetic Chiado-only 15-minute event",
    eventStart: t + 60, claimDeadline: t + 8 * DAY,
    arbitration: [resolver, EXTRA,
      ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
      "0x010204", "/ipfs/SyntheticTest15mPolicy"],
    organizer,
  };
}
const eventArgs = (p) => [p.depositAmount, p.eventName, p.organizer, p.eventStart, p.claimDeadline, p.arbitration];
async function fresh() { return deploy(eventArtifact, owner, ...eventArgs(params(await now()))); }
function parsedLogs(receipt, contract, name) {
  return receipt.logs.filter((log) => log.address.toLowerCase() === contract.target.toLowerCase())
    .map((log) => contract.interface.parseLog(log)).filter((log) => log?.name === name);
}
async function create(factory, creator, key, p) {
  const receipt = await send(factory.connect(creator).createEvent(key,
    [p.depositAmount, p.eventName, p.eventStart, p.claimDeadline, p.arbitration], DEPLOY_GAS));
  const [event] = parsedLogs(receipt, factory, "EventCreated");
  assert.ok(event);
  return { child: new ethers.Contract(event.args.eventContract, eventArtifact.abi, creator), event };
}
async function rejectsWith(pending, contract, expected, expectedArgs) {
  await assert.rejects(pending, (error) => {
    const data = error.data ?? error.info?.error?.data?.result;
    const parsed = contract.interface.parseError(data);
    assert.equal(parsed?.name, expected);
    if (expectedArgs) assert.deepEqual([...parsed.args], expectedArgs);
    return true;
  });
}
async function listed() {
  const c = await fresh();
  await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(c.connect(bob).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([alice.address, bob.address], GAS));
  await advanceTo(Number(await c.eventStart()));
  const receipt = await send(c.postAttendance([alice.address], 2n * D, GAS));
  const block = await provider.getBlock(receipt.blockNumber);
  assert.equal(await c.challengeEndsAt(), BigInt(block.timestamp + PERIOD));
  return c;
}
async function matched() {
  const c = await listed();
  const fee = await c.challengeDeposit();
  const receipt = await send(c.connect(bob).challenge({ value: fee, ...GAS }));
  const block = await provider.getBlock(receipt.blockNumber);
  assert.equal((await c.challenges(bob.address)).matchEndsAt, BigInt(block.timestamp + PERIOD));
  await send(c.connect(matcher).matchChallenge(bob.address, { value: fee, ...GAS }));
  const challenge = await c.challenges(bob.address);
  assert.equal(challenge.state, 2n);
  assert.notEqual(challenge.localDisputeID, challenge.arbitratorDisputeID);
  await advanceTo(Number(await c.challengeEndsAt()) + 1);
  const before = await provider.getBalance(alice.address);
  const release = await send(c.releasePayouts(GAS));
  assert.equal(await provider.getBalance(alice.address), before + D);
  assert.deepEqual(parsedLogs(release, c, "Payout").map((log) => [log.args.to, log.args.amount]), [[alice.address, D]]);
  assert.equal(await c.heldBack(), D);
  assert.equal((await c.challenges(bob.address)).heldShare, D);
  assert.equal(await c.pendingTotal(), D);
  assert.equal(await c.challengeEscrow(), fee);
  assert.equal(await c.reserved(), 2n * D + fee);
  await rejectsWith(c.resolveChallenge.staticCall(bob.address), c, "NotRuled");
  return { c, fee, challenge };
}

before(async () => {
  rpc = localChain(10200);
  provider = browserProvider(rpc);
  [owner, alice, bob, matcher, beneficiary] = await Promise.all([0, 1, 2, 3, 4].map((i) => provider.getSigner(i)));
  liquid = await deploy(artifact("MockKlerosLiquid"), owner);
  proxy = await deploy(artifact("MockArbitrableProxy"), owner, liquid.target);
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });

test("test15m factory fixes version, 900-second windows and exact child code within EVM size limits", async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../build/contracts-test15m/manifest.json", import.meta.url)));
  assert.equal(manifest.version, Number(VERSION));
  assert.equal(manifest.profile, PROFILE);
  assert.equal(manifest.chainId, 10200);
  assert.equal(manifest.challengePeriod, PERIOD);
  assert.equal(manifest.matchPeriod, PERIOD);
  const factory = await deploy(factoryArtifact, owner);
  assert.equal(await factory.VERSION(), VERSION);
  assert.equal(await factory.eventCreationCode(), eventArtifact.bytecode);
  assert.equal(await factory.creationCodeHash(), ethers.keccak256(eventArtifact.bytecode));
  assert.equal(await factory.creationCodeLength(), BigInt((eventArtifact.bytecode.length - 2) / 2));
  for (const a of [eventArtifact, factoryArtifact]) {
    assert.ok((a.bytecode.length - 2) / 2 <= 49_152);
    assert.ok((a.deployedBytecode.length - 2) / 2 <= 24_576);
  }
  for (const address of [await factory.creationCodeStore0(), await factory.creationCodeStore1()]) {
    if (address === ethers.ZeroAddress) continue;
    const code = await provider.getCode(address);
    assert.ok(code.startsWith("0x00"));
    assert.ok((code.length - 2) / 2 <= 24_576);
  }
  const { child, event } = await create(factory, owner, ethers.id("fast-profile"), params(await now()));
  assert.equal(event.args.version, VERSION);
  assert.equal(await child.VERSION(), VERSION);
  assert.equal(await child.CHALLENGE_PERIOD(), BigInt(PERIOD));
  assert.equal(await child.MATCH_PERIOD(), BigInt(PERIOD));
  assert.equal(await child.owner(), owner.address);
});

test("test15m factory and direct child constructors reject Ethereum, Gnosis and ordinary local chain IDs", async () => {
  for (const chainId of [1, 100, 1337]) {
    const wrongRpc = localChain(chainId);
    const wrongProvider = browserProvider(wrongRpc);
    try {
      const signer = await wrongProvider.getSigner(0);
      const liquid = await deploy(artifact("MockKlerosLiquid"), signer);
      const proxy = await deploy(artifact("MockArbitrableProxy"), signer, liquid.target);
      const p = params(1_790_812_800, proxy.target, signer.address);
      for (const [a, args] of [[factoryArtifact, []], [eventArtifact, eventArgs(p)]]) {
        const factory = new ethers.ContractFactory(a.abi, a.bytecode, signer);
        const request = await factory.getDeployTransaction(...args, DEPLOY_GAS);
        await rejectsWith(wrongProvider.call({ ...request, from: signer.address }),
          { interface: factory.interface }, "UnsupportedTestChain", [BigInt(chainId)]);
        // Also execute a real local deployment transaction and prove its constructor reverts.
        const failed = await factory.deploy(...args, DEPLOY_GAS);
        await assert.rejects(failed.waitForDeployment());
        assert.equal(await wrongProvider.getCode(failed.target), "0x");
      }
    } finally {
      wrongProvider.destroy();
      await wrongRpc.disconnect();
    }
  }
});

test("test15m factory events isolate creators, deposits, pending credits and owner permissions", async () => {
  const factory = await deploy(factoryArtifact, owner);
  const key = ethers.id("same-fast-event-key");
  const p = params(await now());
  const a = await create(factory, owner, key, p);
  const b = await create(factory, matcher, key, p);
  assert.notEqual(a.child.target, b.child.target);
  assert.notEqual(a.event.args.eventId, b.event.args.eventId);
  assert.equal(await factory.eventCount(), 2n);
  assert.equal(await factory.isEvent(a.child.target), true);
  assert.equal(await factory.eventFor(owner.address, key), a.child.target);
  assert.equal(await factory.eventFor(matcher.address, key), b.child.target);
  await send(a.child.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(b.child.connect(alice).deposit({ value: D, ...GAS }));
  await send(a.child.registerStakers([alice.address], GAS));
  assert.equal(await a.child.stakerCount(), 1n);
  assert.equal(await a.child.pendingDeposits(alice.address), D);
  assert.equal(await b.child.stakerCount(), 0n);
  assert.equal(await b.child.pendingDeposits(alice.address), D);
  await rejectsWith(b.child.connect(owner).registerStakers.staticCall([alice.address]), b.child, "NotOwner");
  await send(a.child.connect(alice).withdrawPending(beneficiary.address, D, GAS));
  assert.equal(await a.child.pendingTotal(), 0n);
  assert.equal(await b.child.pendingTotal(), D);
  assert.equal(await provider.getBalance(factory.target), 0n);
  assert.equal(await provider.getBalance(a.child.target), D);
  assert.equal(await provider.getBalance(b.child.target), D);
});

test("test15m payout remains too early at the exact 900-second boundary and pays immediately after", async () => {
  const c = await listed();
  const deadline = Number(await c.challengeEndsAt());
  await advanceTo(deadline - 1);
  await rejectsWith(c.releasePayouts.staticCall(), c, "TooEarly");
  await advanceTo(deadline);
  await rejectsWith(c.releasePayouts.staticCall(), c, "TooEarly");
  assert.equal(await c.phase(), 1n);
  await advanceTo(deadline + 1);
  const before = await provider.getBalance(alice.address);
  const receipt = await send(c.releasePayouts(GAS));
  assert.equal(await provider.getBalance(alice.address), before + 2n * D);
  assert.deepEqual(parsedLogs(receipt, c, "Payout").map((log) => [log.args.to, log.args.amount]), [[alice.address, 2n * D]]);
  assert.equal(await c.phase(), 2n);
  assert.equal(await c.pendingTotal(), D);
  assert.equal(await c.reserved(), D);
  await rejectsWith(c.releasePayouts.staticCall(), c, "NotListed");
});

test("test15m unmatched challenge gets a full 900 seconds and only resolves after its exact boundary", async () => {
  const c = await listed();
  await advanceTo(Number(await c.challengeEndsAt()) - 10);
  const fee = await c.challengeDeposit();
  const receipt = await send(c.connect(bob).challenge({ value: fee, ...GAS }));
  const block = await provider.getBlock(receipt.blockNumber);
  const deadline = Number((await c.challenges(bob.address)).matchEndsAt);
  assert.equal(deadline, block.timestamp + PERIOD);
  await advanceTo(Number(await c.challengeEndsAt()) + 1);
  await rejectsWith(c.releasePayouts.staticCall(), c, "ChallengesPending");
  await advanceTo(deadline);
  await rejectsWith(c.resolveChallenge.staticCall(bob.address), c, "TooEarly");
  await c.connect(matcher).matchChallenge.staticCall(bob.address, { value: fee });
  await advanceTo(deadline + 1);
  await rejectsWith(c.connect(matcher).matchChallenge.staticCall(bob.address, { value: fee }), c, "TooLate");
  const before = await provider.getBalance(bob.address);
  await send(c.resolveChallenge(bob.address, GAS));
  assert.equal(await provider.getBalance(bob.address), before + fee);
  assert.equal(await c.attended(bob.address), true);
  assert.equal(await c.pendingChallenges(), 0n);
  await send(c.releasePayouts(GAS));
  assert.equal(await c.heldBack(), 0n);
  assert.equal(await c.payoutShare(), D);
});

test("test15m ordinary batch holds Bob's share until delivered ruling1 and pays that same Bob", async () => {
  const { c, fee, challenge } = await matched();
  assert.equal((await c.challenges(bob.address)).state, 2n);
  assert.equal((await c.queryFilter(c.filters.Payout(bob.address))).length, 0);
  await send(liquid.giveFinalRuling(challenge.arbitratorDisputeID, 1, GAS));
  assert.equal((await c.challenges(bob.address)).state, 2n, "delivery is distinct from event settlement");
  assert.equal(await c.heldBack(), D);
  const before = await provider.getBalance(bob.address);
  const receipt = await send(c.resolveChallenge(bob.address, GAS));
  assert.equal(await provider.getBalance(bob.address), before + D + fee,
    "Bob receives attendance kickback plus separate remaining challenge collateral; owner pays gas");
  assert.deepEqual(parsedLogs(receipt, c, "Payout").map((log) => [log.args.to, log.args.amount]), [[bob.address, D]]);
  assert.equal(await c.attended(bob.address), true);
  assert.equal((await c.challenges(bob.address)).state, 3n);
  assert.equal((await c.challenges(bob.address)).heldShare, 0n);
  assert.equal(await c.pendingChallenges(), 0n);
  assert.equal(await c.heldBack(), 0n);
  assert.equal(await c.challengeEscrow(), 0n);
  assert.equal(await c.owed(bob.address), 0n);
  assert.equal(await c.pendingTotal(), D);
  assert.equal(await c.reserved(), D);
  await rejectsWith(c.resolveChallenge.staticCall(bob.address), c, "WrongChallengeState");
  await send(c.connect(alice).withdrawPending(beneficiary.address, D, GAS));
  assert.equal(await provider.getBalance(c.target), 0n);
});

test("test15m ruling0 retains production refusal economics, odd collateral split and protected pending credit", async () => {
  const original = await liquid.feeForJuror();
  await send(liquid.setFeeForJuror(original + 1n, GAS));
  try {
    const { c, fee, challenge } = await matched();
    assert.equal(fee % 2n, 1n);
    await send(liquid.giveFinalRuling(challenge.arbitratorDisputeID, 0, GAS));
    const [aliceBefore, bobBefore, matcherBefore] = await Promise.all(
      [alice, bob, matcher].map((s) => provider.getBalance(s.address)));
    const receipt = await send(c.resolveChallenge(bob.address, GAS));
    assert.equal(await provider.getBalance(alice.address), aliceBefore + D);
    assert.equal(await provider.getBalance(bob.address), bobBefore + fee / 2n);
    assert.equal(await provider.getBalance(matcher.address), matcherBefore + fee - fee / 2n);
    assert.deepEqual(parsedLogs(receipt, c, "Payout").map((log) => [log.args.to, log.args.amount]), [[alice.address, D]]);
    assert.equal(await c.attended(bob.address), false);
    assert.equal(await c.attendeeCount(), 1n);
    assert.equal(await c.pendingChallenges(), 0n);
    assert.equal(await c.challengeEscrow(), 0n);
    assert.equal(await c.heldBack(), 0n);
    assert.equal(await c.pendingDeposits(alice.address), D);
    assert.equal(await c.reserved(), D);
    assert.equal(await c.spare(), 0n);
    await rejectsWith(c.refund.staticCall(owner.address, 1n), c, "InsufficientBalance");
    await send(c.connect(alice).withdrawPending(beneficiary.address, D, GAS));
    assert.equal(await provider.getBalance(c.target), 0n);
  } finally {
    await send(liquid.setFeeForJuror(original, GAS));
  }
});
