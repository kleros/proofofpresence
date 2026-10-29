// Fresh V10 acceptance: all transactions, jury fixtures and time changes stay in-process.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import ganache from "ganache";
import solc from "solc-hardened";
import { ethers } from "ethers";

const json = path => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sha = value => createHash("sha256").update(value).digest("hex");
const send = async promise => (await promise).wait();
const DAY = 86400, D = ethers.parseEther("0.01"), GAS = { gasLimit: 8000000 };
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]);
let rpc, provider, owner, alice, bob, matcher, beneficiary, fixtures;
const artifact = name => fixtures?.[name] ?? json(name.endsWith("V10") || name === "ERC1967Proxy"
  ? `build/contracts-v10/${name}.json` : `references/kickback/build/${name}.json`);
async function deploy(name, ...args) {
  const a = artifact(name), contract = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args, { gasLimit: 16000000 });
  await contract.waitForDeployment(); return contract;
}
const now = async () => Number(BigInt((await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp));
async function advance(timestamp) {
  await rpc.request({ method: "evm_setTime", params: [timestamp * 1000] }); await rpc.request({ method: "evm_mine", params: [] });
}
async function setup() {
  const controller = await deploy("KlerosUpgradeControllerV10", owner.address), eventImpl = await deploy("KlerosEventV10"),
    factoryImpl = await deploy("KlerosEventFactoryV10");
  const proxy = await deploy("ERC1967Proxy", factoryImpl.target,
    factoryImpl.interface.encodeFunctionData("initialize", [eventImpl.target, controller.target]));
  const factory = new ethers.Contract(proxy.target, artifact("KlerosEventFactoryV10").abi, owner);
  const liquid = await deploy("MockKlerosLiquid"), resolver = await deploy("MockArbitrableProxy", liquid.target);
  async function create(label, creator = owner) {
    const time = await now(), config = { depositAmount: D, eventName: label, eventStart: time + 60,
      claimDeadline: time + 8 * DAY, arbitration: [resolver.target, EXTRA,
        ['{"wallet":"', '","contract":"', '","organizer":"', '"}'], "0x010204", "https://example.invalid/v10-policy"] };
    const receipt = await send(factory.connect(creator).createEvent(ethers.id(label), config, GAS));
    const log = receipt.logs.filter(item => item.address.toLowerCase() === factory.target.toLowerCase())
      .map(item => factory.interface.parseLog(item)).find(item => item.name === "EventCreated");
    assert.equal(log.args.version, 10n);
    const c = new ethers.Contract(log.args.eventContract, artifact("KlerosEventV10").abi, creator);
    assert.equal(await c.VERSION(), 10n); assert.equal(await c.owner(), creator.address);
    assert.equal(await c.upgradeAuthority(), controller.target); assert.equal(await c.originatingFactory(), factory.target);
    assert.equal(await c.CHALLENGE_PERIOD(), 86400n); assert.equal(await c.MATCH_PERIOD(), 86400n);
    assert.equal(await c.MAX_STAKERS(), 150n);
    return { c, id: log.args.eventId };
  }
  return { controller, eventImpl, factoryImpl, factory, liquid, resolver, create };
}

before(async () => {
  const input = json("build/contracts-v10/standard-input.json");
  for (const [path, source] of Object.entries(input.sources))
    assert.equal(source.content, read((path.startsWith("@openzeppelin/") ? "node_modules/" : "") + path));
  input.sources["test/V10BasicFixtures.sol"] = { content: `pragma solidity 0.8.38;
    import {KlerosEventV10} from "contracts/v10/KlerosEventV10.sol";
    import {KlerosEventFactoryV10} from "contracts/v10/KlerosEventFactoryV10.sol";
    contract EventRevision2 is KlerosEventV10 {
      uint256 public migrationMarker;
      function implementationRevision() public pure override returns(uint256){return 2;}
      function initializeV2(uint256 marker) external reinitializer(2) {
        require(msg.sender == upgradeAuthority(), UnauthorizedUpgrade()); migrationMarker = marker;
      }
    }
    contract FactoryRevision2 is KlerosEventFactoryV10 {
      uint256 public factoryMarker;
      function implementationRevision() public pure override returns(uint256){return 2;}
      function initializeV2(uint256 marker) external reinitializer(2) {
        require(msg.sender == upgradeAuthority(), UnauthorizedUpgrade()); factoryMarker = marker;
      }
    }` };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.equal((output.errors ?? []).filter(error => error.severity === "error").length, 0);
  fixtures = Object.fromEntries(Object.entries(output.contracts["test/V10BasicFixtures.sol"])
    .map(([name, c]) => [name, { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }]));
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60000000, timestampIncrement: 0 }, wallet: { totalAccounts: 6, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  [owner, alice, bob, matcher, beneficiary] = await Promise.all([0, 1, 2, 3, 4].map(i => provider.getSigner(i)));
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });

test("V10 retains the exact reviewed V9 financial body and uses its separate build/family/authority namespace", () => {
  const v9 = read("contracts/v9/KlerosEventV9.sol"), v10 = read("contracts/v10/KlerosEventV10.sol");
  assert.equal(sha(v9), "e3d9f947537165d885878c89e86114e6901d0665f4d4b00bf20b9da227a9e11b");
  assert.equal(v10.slice(v10.indexOf("    modifier onlyOwner()")), v9.slice(v9.indexOf("    modifier onlyOwner()")));
  assert.equal(sha(read("contracts/v9/KlerosEventFactoryV9.sol")), "4ce1c30a8ebf383c41718ac2b48bda03ffc719d718447cdd3678e9c067fedbe9");
  assert.equal(sha(read("contracts/v9/KlerosUpgradeGateV9.sol")), "0197602754ac7296f01b645f4331d3b6f09faf2c78181df4ed702ba1a24bd365");
  assert.equal(sha(read("contracts/v9/KlerosUpgradeTimelockV9.sol")), "bd0c37a72bbfb0341530768896035046dab67e01870fadd03e406a618c04926e");
  const manifest = json("build/contracts-v10/manifest.json");
  assert.equal(manifest.profile, "kleros-event-v10-uups"); assert.equal(manifest.minimumUpgradeDelay, 0);
  assert.equal(manifest.governanceKind, "single-owner-immediate"); assert.equal(manifest.renounceable, true);
  const root = BigInt(ethers.keccak256(ethers.toUtf8Bytes("kleros.storage.UpgradeGateV10"))) - 1n;
  const namespace = ethers.toBeHex(BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [root]))) & ~255n, 32);
  assert.ok(read("contracts/v10/KlerosUpgradeGateV10.sol").includes(namespace));
  assert.ok(!Object.keys(manifest.sources).some(path => path.includes("contracts/v9/")));
});

test("one EOA immediately upgrades independent proxies and changes only future children's default implementation", async () => {
  const startingNonce = await provider.getTransactionCount(owner.address), s = await setup();
  for (const [offset, c] of [s.controller, s.eventImpl, s.factoryImpl].entries())
    assert.equal(c.deploymentTransaction().nonce, startingNonce + offset);
  assert.equal(await s.controller.VERSION(), 10n); assert.equal(await s.controller.UPGRADE_DELAY_SECONDS(), 0n);
  assert.equal(await s.controller.upgradesDisabled(), false);
  const a = await s.create("immediate-a"), b = await s.create("immediate-b", matcher);
  const event2 = await deploy("EventRevision2"), factory2 = await deploy("FactoryRevision2");
  await assert.rejects(a.c.upgradeToAndCall.staticCall(event2.target, "0x"));
  await assert.rejects(s.factory.setEventImplementation.staticCall(event2.target));
  await assert.rejects(s.controller.connect(alice).upgrade.staticCall(a.c.target, event2.target, "0x"));
  const startTime = await now();
  const eventReceipt = await send(s.controller.upgrade(a.c.target, event2.target, event2.interface.encodeFunctionData("initializeV2", [77]), GAS));
  const factoryReceipt = await send(s.controller.upgrade(s.factory.target, factory2.target, factory2.interface.encodeFunctionData("initializeV2", [88]), GAS));
  const defaultReceipt = await send(s.controller.setEventImplementation(s.factory.target, event2.target, GAS));
  assert.equal(await now(), startTime, "no timelock or clock advancement is required");
  assert.equal(await new ethers.Contract(a.c.target, fixtures.EventRevision2.abi, owner).migrationMarker(), 77n);
  assert.equal(await new ethers.Contract(s.factory.target, fixtures.FactoryRevision2.abi, owner).factoryMarker(), 88n);
  assert.equal(await b.c.implementationRevision(), 1n); assert.equal(await a.c.implementationRevision(), 2n);
  assert.equal(await s.factory.eventsById(a.id), a.c.target); assert.equal(await s.factory.eventsById(b.id), b.c.target);
  const c = await s.create("immediate-c"); assert.equal(await c.c.implementationRevision(), 2n);
  console.log(JSON.stringify({ eventUpgradeGas: String(eventReceipt.gasUsed), factoryUpgradeGas: String(factoryReceipt.gasUsed), defaultSelectionGas: String(defaultReceipt.gasUsed) }));
});

test("two-step transfer/cancel works; renunciation clears the nominee and permanently rejects every former control path", async () => {
  const s = await setup(), a = await s.create("freeze-existing"), event2 = await deploy("EventRevision2");
  for (const candidate of [ethers.ZeroAddress, owner.address, s.controller.target])
    await assert.rejects(s.controller.transferOwnership.staticCall(candidate));
  await send(s.controller.transferOwnership(alice.address, GAS));
  await assert.rejects(s.controller.connect(alice).upgrade.staticCall(a.c.target, event2.target, "0x"));
  await send(s.controller.cancelOwnershipTransfer(GAS)); assert.equal(await s.controller.pendingOwner(), ethers.ZeroAddress);
  await assert.rejects(s.controller.connect(alice).acceptOwnership.staticCall());
  await send(s.controller.transferOwnership(alice.address, GAS)); await send(s.controller.connect(alice).acceptOwnership(GAS));
  assert.equal(await s.controller.owner(), alice.address);
  await assert.rejects(s.controller.upgrade.staticCall(a.c.target, event2.target, "0x"));
  await send(s.controller.connect(alice).transferOwnership(bob.address, GAS));
  await send(s.controller.connect(alice).renounceOwnership(GAS));
  assert.equal(await s.controller.owner(), ethers.ZeroAddress); assert.equal(await s.controller.pendingOwner(), ethers.ZeroAddress);
  assert.equal(await s.controller.upgradesDisabled(), true);
  for (const signer of [owner, alice, bob]) {
    const controller = s.controller.connect(signer);
    await assert.rejects(controller.upgrade.staticCall(a.c.target, event2.target, "0x"));
    await assert.rejects(controller.setEventImplementation.staticCall(s.factory.target, event2.target));
    await assert.rejects(controller.transferOwnership.staticCall(beneficiary.address));
    await assert.rejects(controller.acceptOwnership.staticCall());
    await assert.rejects(controller.cancelOwnershipTransfer.staticCall());
    await assert.rejects(controller.renounceOwnership.staticCall());
  }
  const future = await s.create("freeze-future", matcher);
  assert.equal(await future.c.upgradeAuthority(), s.controller.target); assert.equal(await future.c.implementationRevision(), 1n);
  await send(future.c.connect(bob).deposit({ value: D, ...GAS }));
  await send(future.c.registerStakers([bob.address], GAS));
  await send(future.c.cancel(GAS));
  assert.equal(await provider.getBalance(future.c.target), 0n, "organizer financial cancellation remains operable after upgrade renunciation");
});

for (const ruling of [1, 0]) test(`held share, excess pending credit and ruling${ruling} economics survive immediate upgrade then renunciation`, async () => {
  const s = await setup(), a = await s.create(`funded-${ruling}`), control = await s.create(`funded-control-${ruling}`, matcher), c = a.c;
  await send(c.connect(alice).deposit({ value: 2n * D, ...GAS })); await send(c.connect(bob).deposit({ value: D, ...GAS }));
  await send(control.c.connect(alice).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([alice.address, bob.address], GAS));
  await advance(Number(await c.eventStart())); await send(c.postAttendance([alice.address], 2n * D, GAS));
  const fee = await c.challengeDeposit(); await send(c.connect(bob).challenge({ value: fee, ...GAS }));
  await send(c.connect(matcher).matchChallenge(bob.address, { value: fee, ...GAS }));
  await advance(Number(await c.challengeEndsAt()) + 1); await send(c.releasePayouts(GAS));
  const snapshot = async () => JSON.stringify({ owner: await c.owner(), phase: await c.phase(), pending: await c.pendingTotal(),
    pendingAlice: await c.pendingDeposits(alice.address), held: await c.heldBack(), escrow: await c.challengeEscrow(),
    owed: await c.owedTotal(), reserved: await c.reserved(), balance: await provider.getBalance(c.target), stakers: await c.stakers(),
    attendees: await c.attendees(), challenge: [...await c.challenges(bob.address)], organizer: await c.caseOrganizer(bob.address),
    policy: await c.policyURI(), template: [...await c.metaEvidenceTemplate()], authority: await c.upgradeAuthority() },
  (_, value) => typeof value === "bigint" ? String(value) : value);
  const before = await snapshot(); assert.equal(await c.heldBack(), D); assert.equal(await c.pendingTotal(), D);
  const event2 = await deploy("EventRevision2"); await send(s.controller.upgrade(c.target, event2.target, "0x", GAS));
  await send(s.controller.transferOwnership(beneficiary.address, GAS)); await send(s.controller.renounceOwnership(GAS));
  assert.equal(await snapshot(), before, "upgrade/finalization changes no captured financial or case field");
  const challenge = await c.challenges(bob.address), remaining = 2n * challenge.deposit - challenge.arbitrationPaid;
  await send(s.liquid.giveFinalRuling(challenge.arbitratorDisputeID, ruling, GAS));
  const bobBefore = await provider.getBalance(bob.address), matcherBefore = await provider.getBalance(matcher.address), aliceBefore = await provider.getBalance(alice.address);
  await send(c.resolveChallenge(bob.address, GAS));
  assert.equal(await provider.getBalance(bob.address), bobBefore + (ruling === 1 ? D + remaining : remaining / 2n));
  assert.equal(await provider.getBalance(matcher.address), matcherBefore + (ruling === 0 ? remaining - remaining / 2n : 0n));
  assert.equal(await provider.getBalance(alice.address), aliceBefore + (ruling === 0 ? D : 0n));
  assert.equal(await c.heldBack(), 0n); assert.equal(await c.challengeEscrow(), 0n); assert.equal(await c.reserved(), D);
  await send(c.connect(alice).withdrawPending(beneficiary.address, D, GAS));
  assert.equal(await provider.getBalance(c.target), 0n); assert.equal(await c.reserved(), 0n);
  assert.equal(await control.c.pendingDeposits(alice.address), D); assert.equal(await provider.getBalance(control.c.target), D);
  assert.equal(await control.c.implementationRevision(), 1n); assert.equal(await c.owner(), owner.address);
});
