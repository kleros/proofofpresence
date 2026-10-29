// Synthetic in-process upgrade/custody acceptance. No network or signing files.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import ganache from "ganache";
import solc from "solc-hardened";
import { ethers } from "ethers";

const json = relative => JSON.parse(fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"));
const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const sha = value => createHash("sha256").update(value).digest("hex");
const send = async promise => (await promise).wait();
const DAY = 86400, D = ethers.parseEther("0.01"), GAS = { gasLimit: 8_000_000 };
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]);

test("V9 port retains every V8 financial body and prior ABI; reviewed historical sources stay pinned", () => {
  const old = read("contracts/KlerosEventV8.sol"), current = read("contracts/v9/KlerosEventV9.sol");
  assert.equal(sha(old), "e97e3f9a4adb2bb4a697adac609367e5ad2103379bb395a241d54cedc62a9769");
  assert.equal(sha(read("contracts/KlerosEventFactoryV8.sol")), "8488bb19f34f90c302afb08af99759b6308ef04199bc10dc973fa5ad35558505");
  assert.equal(current.slice(current.indexOf("    modifier onlyOwner()")), old.slice(old.indexOf("    modifier onlyOwner()")));
  const normalize = value => JSON.parse(JSON.stringify(value).replaceAll("KlerosEventV8", "KlerosEventV9"));
  const oldAbi = json("build/contracts/KlerosEventV8.json").abi.filter(entry => entry.type !== "constructor");
  const newAbi = json("build/contracts-v9/KlerosEventV9.json").abi;
  for (const entry of oldAbi)
    assert.ok(newAbi.some(candidate => JSON.stringify(normalize(entry)) === JSON.stringify(candidate)), `${entry.type} ${entry.name} unchanged`);
});

test("V9 timelocked upgrades preserve held/pending custody, factory registry and independent child implementations", { timeout: 120000 }, async () => {
  const input = json("build/contracts-v9/standard-input.json");
  input.sources["test/V9RevisionFixtures.sol"] = { content: `
    pragma solidity 0.8.38;
    import {KlerosEventV9} from "contracts/v9/KlerosEventV9.sol";
    import {KlerosEventFactoryV9} from "contracts/v9/KlerosEventFactoryV9.sol";
    contract EventRevision2 is KlerosEventV9 {
      uint256 public migrationMarker;
      function implementationRevision() public pure override returns(uint256){return 2;}
      function initializeV2(uint256 marker) external reinitializer(2) {
        require(msg.sender == upgradeAuthority(), UnauthorizedUpgrade()); migrationMarker = marker;
      }
    }
    contract FactoryRevision2 is KlerosEventFactoryV9 {
      uint256 public factoryMarker;
      function implementationRevision() public pure override returns(uint256){return 2;}
      function initializeV2(uint256 marker) external reinitializer(2) {
        require(msg.sender == upgradeAuthority(), UnauthorizedUpgrade()); factoryMarker = marker;
      }
    }
  ` };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.equal((output.errors ?? []).filter(e => e.severity === "error").length, 0);
  const fixtures = Object.fromEntries(Object.entries(output.contracts["test/V9RevisionFixtures.sol"])
    .map(([name, c]) => [name, { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object, storageLayout: c.storageLayout }]));
  const artifact = name => fixtures[name] ?? json(name.endsWith("V9") || name === "ERC1967Proxy"
    ? `build/contracts-v9/${name}.json` : `references/kickback/build/${name}.json`);
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000, timestampIncrement: 0 }, wallet: { totalAccounts: 6, defaultBalance: 1000 } });
  const provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  try {
    const [owner, alice, bob, matcher, beneficiary] = await Promise.all([0, 1, 2, 3, 4].map(i => provider.getSigner(i)));
    const deploy = async (name, ...args) => {
      const a = artifact(name), c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args, { gasLimit: 16_000_000 });
      await c.waitForDeployment(); return c;
    };
    const now = async () => Number(BigInt((await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp));
    const advance = async value => { await rpc.request({ method: "evm_setTime", params: [value * 1000] }); await rpc.request({ method: "evm_mine", params: [] }); };
    const governance = await deploy("TestWallet"), timelock = await deploy("KlerosUpgradeTimelockV9", governance.target);
    const eventImpl = await deploy("KlerosEventV9"), factoryImpl = await deploy("KlerosEventFactoryV9");
    const born = await deploy("ERC1967Proxy", factoryImpl.target,
      factoryImpl.interface.encodeFunctionData("initialize", [eventImpl.target, timelock.target]));
    const factory = new ethers.Contract(born.target, artifact("KlerosEventFactoryV9").abi, owner);
    assert.equal(await timelock.getMinDelay(), 172800n);
    assert.equal(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), owner.address), false);
    assert.equal(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), timelock.target), true);
    assert.equal(await factory.upgradeAuthority(), timelock.target);
    const liquid = await deploy("MockKlerosLiquid"), resolver = await deploy("MockArbitrableProxy", liquid.target);
    const create = async (label, creator = owner) => {
      const t = await now(), key = ethers.id(label), config = { depositAmount: D, eventName: label, eventStart: t + 60,
        claimDeadline: t + 8 * DAY, arbitration: [resolver.target, EXTRA,
          ['{"wallet":"', '","contract":"', '","organizer":"', '"}'], "0x010204", "https://example.invalid/v9-policy"] };
      const receipt = await send(factory.connect(creator).createEvent(key, config, GAS));
      const log = receipt.logs.filter(l => l.address.toLowerCase() === factory.target.toLowerCase())
        .map(l => factory.interface.parseLog(l)).find(l => l.name === "EventCreated");
      const c = new ethers.Contract(log.args.eventContract, artifact("KlerosEventV9").abi, owner);
      assert.equal(await c.VERSION(), 9n); assert.equal(await c.owner(), creator.address);
      assert.equal(await c.originatingFactory(), factory.target); assert.equal(await c.upgradeAuthority(), timelock.target);
      assert.equal(await c.CHALLENGE_PERIOD(), 86400n); assert.equal(await c.MATCH_PERIOD(), 86400n);
      assert.equal(await c.MAX_STAKERS(), 150n);
      return { c, id: log.args.eventId, key };
    };
    const { c, id } = await create("funded-upgrade"), control = await create("separate-control", matcher);
    await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
    await send(c.connect(bob).deposit({ value: D, ...GAS }));
    await send(control.c.connect(alice).deposit({ value: D, ...GAS }));
    await send(c.registerStakers([alice.address, bob.address], GAS));
    await advance(Number(await c.eventStart())); await send(c.postAttendance([alice.address], 2n * D, GAS));
    const fee = await c.challengeDeposit();
    await send(c.connect(bob).challenge({ value: fee, ...GAS }));
    await send(c.connect(matcher).matchChallenge(bob.address, { value: fee, ...GAS }));
    await advance(Number(await c.challengeEndsAt()) + 1); await send(c.releasePayouts(GAS));
    const snapshot = async () => JSON.stringify({ deposit: await c.depositAmount(), owner: await c.owner(), phase: await c.phase(),
      pending: await c.pendingTotal(), pendingAlice: await c.pendingDeposits(alice.address), held: await c.heldBack(),
      escrow: await c.challengeEscrow(), owed: await c.owedTotal(), reserved: await c.reserved(), balance: await provider.getBalance(c.target),
      stakers: await c.stakers(), attendees: await c.attendees(), challenge: [...await c.challenges(bob.address)],
      organizer: await c.caseOrganizer(bob.address), policy: await c.policyURI(), template: [...await c.metaEvidenceTemplate()],
      templateStore: await c.metaEvidenceStore(), authority: await c.upgradeAuthority() }, (_, v) => typeof v === "bigint" ? String(v) : v);
    const before = await snapshot(); assert.equal(await c.heldBack(), D); assert.equal(await c.pendingTotal(), D);
    const event2 = await deploy("EventRevision2"), factory2 = await deploy("FactoryRevision2");
    await assert.rejects(c.upgradeToAndCall.staticCall(event2.target, "0x"));
    await assert.rejects(factory.setEventImplementation.staticCall(event2.target));
    const targets = [c.target, factory.target, factory.target], values = [0, 0, 0], predecessor = ethers.ZeroHash,
      salt = ethers.id("synthetic-v9-custody-upgrade");
    const payloads = [c.interface.encodeFunctionData("upgradeToAndCall", [event2.target, event2.interface.encodeFunctionData("initializeV2", [77])]),
      factory.interface.encodeFunctionData("upgradeToAndCall", [factory2.target, factory2.interface.encodeFunctionData("initializeV2", [88])]),
      factory.interface.encodeFunctionData("setEventImplementation", [event2.target])];
    const operation = await timelock.hashOperationBatch(targets, values, payloads, predecessor, salt);
    await send(governance.exec(timelock.target, timelock.interface.encodeFunctionData("scheduleBatch",
      [targets, values, payloads, predecessor, salt, 172800]), GAS));
    const eta = Number(await timelock.getTimestamp(operation));
    await advance(eta - 1); await assert.rejects(timelock.executeBatch.staticCall(targets, values, payloads, predecessor, salt));
    await advance(eta); await send(timelock.connect(beneficiary).executeBatch(targets, values, payloads, predecessor, salt, GAS));
    assert.equal(await snapshot(), before, "every captured liability and case field survives upgrade");
    const upgraded = new ethers.Contract(c.target, fixtures.EventRevision2.abi, owner);
    assert.equal(await upgraded.migrationMarker(), 77n); assert.equal(await upgraded.implementationRevision(), 2n);
    assert.equal(await new ethers.Contract(factory.target, fixtures.FactoryRevision2.abi, owner).factoryMarker(), 88n);
    assert.equal(await factory.eventsById(id), c.target); assert.equal(await factory.eventCount(), 2n);
    assert.equal(await factory.eventImplementation(), event2.target);
    assert.equal(await control.c.implementationRevision(), 1n, "another child never follows a shared beacon");
    assert.equal(await control.c.pendingDeposits(alice.address), D);
    assert.equal(await provider.getBalance(control.c.target), D);
    const future = await create("future-revision"); assert.equal(await future.c.implementationRevision(), 2n);
    const challenge = await c.challenges(bob.address);
    await send(liquid.giveFinalRuling(challenge.arbitratorDisputeID, 1, GAS));
    const bobBefore = await provider.getBalance(bob.address); await send(c.resolveChallenge(bob.address, GAS));
    assert.equal(await provider.getBalance(bob.address), bobBefore + D + fee);
    assert.equal(await c.heldBack(), 0n); assert.equal(await c.challengeEscrow(), 0n); assert.equal(await c.reserved(), D);
    await send(c.connect(alice).withdrawPending(beneficiary.address, D, GAS));
    assert.equal(await provider.getBalance(c.target), 0n); assert.equal(await c.reserved(), 0n);
    assert.equal(await provider.getBalance(factory.target), 0n);
  } finally { provider.destroy(); await rpc.disconnect(); }
});
