// Independent V9 upgrade attack regressions. Everything runs on an in-process chain.
// The project signer and Court adjudication below are synthetic test fixtures only.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ganache from "ganache";
import { ethers } from "ethers";
import solc from "solc-hardened";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DAY = 86_400;
const DELAY = 2 * DAY;
const D = ethers.parseEther("0.01");
const ZERO = ethers.ZeroHash;
const SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const GAS = { gasLimit: 6_000_000 };
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
const FIXTURE_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
import {KlerosEventV9} from "contracts/v9/KlerosEventV9.sol";
import {KlerosEventFactoryV9} from "contracts/v9/KlerosEventFactoryV9.sol";

// Deliberately a single-controller fixture, never a production multisig proposal.
contract SecurityProjectSigner {
    address public immutable controller;
    constructor(address account) { controller = account; }
    function exec(address target, bytes calldata data) external returns (bytes memory result) {
        require(msg.sender == controller, "synthetic controller only");
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
    }
}
contract SecurityEventRevision2 is KlerosEventV9 {
    uint256 public migrationMarker;
    function implementationRevision() public pure override returns (uint256) { return 2; }
    function migrate(uint256 marker) external reinitializer(2) {
        require(msg.sender == upgradeAuthority(), "migration authority only");
        migrationMarker = marker;
    }
    function revertingMigration() external reinitializer(2) {
        require(msg.sender == upgradeAuthority(), "migration authority only");
        migrationMarker = 999;
        revert("synthetic migration failure");
    }
}
contract SecurityFactoryRevision2 is KlerosEventFactoryV9 {
    function implementationRevision() public pure override returns (uint256) { return 2; }
}
contract SecurityWrongSchema is KlerosEventV9 {
    function implementationRevision() public pure override returns (uint256) { return 2; }
    function storageSchema() public pure override returns (bytes32) { return keccak256("wrong-schema"); }
}
contract SecurityNonUUPS { }
contract SecurityWrongUUID {
    function VERSION() external pure returns (uint256) { return 9; }
    function UPGRADE_FAMILY() external pure returns (bytes32) { return keccak256("kleros.event.v9.uups"); }
    function implementationRevision() external pure returns (uint256) { return 2; }
    function storageSchema() external pure returns (bytes32) { return keccak256("kleros.event.v9.storage.1"); }
    function proxiableUUID() external pure returns (bytes32) { return bytes32(0); }
}
contract SecurityFakeDelayAuthority {
    function MIN_UPGRADE_DELAY() external pure returns (uint256) { return 48 hours; }
    function getMinDelay() external pure returns (uint256) { return 48 hours; }
    function exec(address target, bytes calldata data) external returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call(data);
        require(ok, "facade forwarded call failed");
    }
}
`;

let rpc, provider, governor, organizer, alice, bob, attacker, beneficiary;
let court,
  resolver,
  fixtures,
  serial = 0;
const send = async (pending) => (await pending).wait();

function artifact(name) {
  if (fixtures?.[name]) return fixtures[name];
  const folder = [
    "MockKlerosLiquid",
    "MockArbitrableProxy",
    "TestWallet",
  ].includes(name)
    ? "references/kickback/build"
    : "build/contracts-v9";
  return JSON.parse(fs.readFileSync(path.join(ROOT, folder, `${name}.json`)));
}

function compileFixtures() {
  const input = JSON.parse(
    fs.readFileSync(path.join(ROOT, "build/contracts-v9/standard-input.json")),
  );
  assert.ok(solc.version().startsWith("0.8.38+"));
  for (const [name, source] of Object.entries(input.sources)) {
    const filename = path.join(
      ROOT,
      name.startsWith("@openzeppelin/") ? "node_modules" : "",
      name,
    );
    assert.equal(
      source.content,
      fs.readFileSync(filename, "utf8"),
      `compiled source binding: ${name}`,
    );
  }
  input.sources["SecurityFixtures.sol"] = { content: FIXTURE_SOURCE };
  input.settings.outputSelection = {
    "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
  };
  const result = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (name) => {
        const allowed = name.startsWith("contracts/v9/")
          ? path.join(ROOT, name)
          : name.startsWith("@openzeppelin/contracts/")
            ? path.join(ROOT, "node_modules", name)
            : undefined;
        return allowed
          ? { contents: fs.readFileSync(allowed, "utf8") }
          : { error: `Unexpected fixture import ${name}` };
      },
    }),
  );
  const errors = (result.errors ?? []).filter((e) => e.severity === "error");
  assert.deepEqual(
    errors.map((e) => e.formattedMessage),
    [],
  );
  assert.equal(
    `0x${result.contracts["contracts/v9/KlerosUpgradeTimelockV9.sol"].KlerosUpgradeTimelockV9.evm.deployedBytecode.object}`,
    artifact("KlerosUpgradeTimelockV9").deployedBytecode,
    "fixture build retains the exact authority runtime code hash",
  );
  for (const name of ["KlerosEventV9", "KlerosEventFactoryV9"]) {
    assert.equal(
      `0x${result.contracts[`contracts/v9/${name}.sol`][name].evm.bytecode.object}`,
      artifact(name).bytecode,
      `deployment artifact binding: ${name}`,
    );
  }
  return Object.fromEntries(
    Object.entries(result.contracts["SecurityFixtures.sol"]).map(
      ([name, c]) => [
        name,
        { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` },
      ],
    ),
  );
}

async function deploy(name, args = [], signer = governor) {
  const a = artifact(name);
  const c = await new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(
    ...args,
    { gasLimit: 15_000_000 },
  );
  await c.waitForDeployment();
  return c;
}

async function now() {
  const block = await rpc.request({
    method: "eth_getBlockByNumber",
    params: ["latest", false],
  });
  return Number(block.timestamp);
}

async function warpTo(timestamp) {
  assert.ok(timestamp >= (await now()), "test clock only advances");
  await rpc.request({ method: "evm_setTime", params: [timestamp * 1000] });
  await rpc.request({ method: "evm_mine", params: [] });
  assert.equal(await now(), timestamp);
}

async function implementation(c) {
  const value = await rpc.request({
    method: "eth_getStorageAt",
    params: [c.target, SLOT, "latest"],
  });
  return ethers.getAddress(`0x${value.slice(-40)}`);
}

async function setup() {
  const signer = await deploy("SecurityProjectSigner", [governor.address]);
  const timelock = await deploy("KlerosUpgradeTimelockV9", [signer.target]);
  const eventImpl = await deploy("KlerosEventV9");
  const factoryImpl = await deploy("KlerosEventFactoryV9");
  const data = factoryImpl.interface.encodeFunctionData("initialize", [
    eventImpl.target,
    timelock.target,
  ]);
  const factoryProxy = await deploy("ERC1967Proxy", [factoryImpl.target, data]);
  const factory = new ethers.Contract(
    factoryProxy.target,
    artifact("KlerosEventFactoryV9").abi,
    organizer,
  );
  return { signer, timelock, eventImpl, factoryImpl, factory };
}

async function parameters(startIn = 3600) {
  const start = (await now()) + startIn;
  return {
    depositAmount: D,
    eventName: "Synthetic V9 upgrade attack test",
    eventStart: start,
    claimDeadline: start + 30 * DAY,
    arbitration: [
      resolver.target,
      EXTRA,
      ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
      "0x010204",
      "/ipfs/SyntheticV9UpgradeSecurityPolicy",
    ],
  };
}

async function createEvent(s, config) {
  const key = ethers.id(`independent-security-event-${++serial}`);
  const p = config ?? (await parameters());
  await send(s.factory.createEvent(key, p, GAS));
  const address = await s.factory.eventFor(organizer.address, key);
  return new ethers.Contract(address, artifact("KlerosEventV9").abi, organizer);
}

async function queue(s, target, data, delay) {
  const salt = ethers.id(`independent-operation-${++serial}`);
  const actualDelay = delay ?? (await s.timelock.getMinDelay());
  await send(
    s.signer.exec(
      s.timelock.target,
      s.timelock.interface.encodeFunctionData("schedule", [
        target,
        0,
        data,
        ZERO,
        salt,
        actualDelay,
      ]),
      GAS,
    ),
  );
  const args = [target, 0, data, ZERO, salt];
  const id = await s.timelock.hashOperation(...args);
  return { args, id, eta: Number(await s.timelock.getTimestamp(id)) };
}

async function execute(s, operation) {
  return send(s.timelock.connect(attacker).execute(...operation.args, GAS));
}

async function upgrade(s, c, candidate, data = "0x") {
  const operation = await queue(
    s,
    c.target,
    c.interface.encodeFunctionData("upgradeToAndCall", [
      candidate.target,
      data,
    ]),
  );
  await warpTo(operation.eta);
  await execute(s, operation);
  return operation;
}

async function snapshot(c, wallets) {
  const fields = [
    "depositAmount",
    "eventStart",
    "claimDeadline",
    "disputeResolver",
    "arbitrator",
    "arbitratorExtraData",
    "metaEvidenceStore",
    "policyURI",
    "eventName",
    "owner",
    "pendingOwner",
    "phase",
    "stakerCount",
    "pendingTotal",
    "attendeeCount",
    "challengeEndsAt",
    "pendingChallenges",
    "challengeEscrow",
    "payoutShare",
    "heldBack",
    "owedTotal",
    "reserved",
    "spare",
    "upgradeAuthority",
    "originatingFactory",
    "stakers",
    "attendees",
    "challengers",
    "metaEvidenceTemplate",
  ];
  const normalized = (value) =>
    Array.isArray(value) ? Array.from(value, normalized) : value;
  const values = {};
  for (const field of fields) values[field] = normalized(await c[field]());
  values.balance = BigInt(
    await rpc.request({
      method: "eth_getBalance",
      params: [c.target, "latest"],
    }),
  );
  values.wallets = {};
  for (const wallet of wallets) {
    const address = wallet.address ?? wallet.target;
    const challenge = await c.challenges(address);
    values.wallets[address] = {
      status: await c.status(address),
      pending: await c.pendingDeposits(address),
      attended: await c.attended(address),
      owed: await c.owed(address),
      challenge: [...challenge],
      caseOrganizer: await c.caseOrganizer(address),
    };
    if (challenge.state >= 2n) {
      values.wallets[address].resolver = [
        ...(await resolver.disputes(challenge.localDisputeID)),
      ];
      values.wallets[address].evidence = [
        ...(await c.caseMetaEvidence(address)),
      ];
    }
  }
  return values;
}

before(async () => {
  fixtures = compileFixtures();
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000, timestampIncrement: 0 },
    wallet: { totalAccounts: 8, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  [governor, organizer, alice, bob, attacker, beneficiary] = await Promise.all(
    Array.from({ length: 6 }, (_, i) => provider.getSigner(i)),
  );
  court = await deploy("MockKlerosLiquid");
  resolver = await deploy("MockArbitrableProxy", [court.target]);
});

after(async () => {
  provider?.destroy();
  await rpc?.disconnect();
});

test("V9 work preserves the exact immutable production V8 source inputs", () => {
  for (const [file, expected] of [
    [
      "contracts/KlerosEventV8.sol",
      "e97e3f9a4adb2bb4a697adac609367e5ad2103379bb395a241d54cedc62a9769",
    ],
    [
      "contracts/KlerosEventFactoryV8.sol",
      "8488bb19f34f90c302afb08af99759b6308ef04199bc10dc973fa5ad35558505",
    ],
  ]) {
    assert.equal(
      createHash("sha256")
        .update(fs.readFileSync(path.join(ROOT, file)))
        .digest("hex"),
      expected,
      file,
    );
  }
});

test("implementation locks, atomic child initialization and timelock provenance prevent takeover", async () => {
  const s = await setup();
  const p = await parameters(10 * DAY);
  const child = await createEvent(s, p);
  const args = [
    p.depositAmount,
    p.eventName,
    organizer.address,
    p.eventStart,
    p.claimDeadline,
    p.arbitration,
    s.factory.target,
  ];
  assert.equal(await child.owner(), organizer.address);
  assert.equal(await child.upgradeAuthority(), s.timelock.target);
  assert.equal(await child.MAX_STAKERS(), 150n);
  assert.equal(await child.CHALLENGE_PERIOD(), BigInt(DAY));
  assert.equal(await child.MATCH_PERIOD(), BigInt(DAY));
  await assert.rejects(s.eventImpl.initialize.staticCall(...args));
  await assert.rejects(
    s.factoryImpl.initialize.staticCall(s.eventImpl.target, s.timelock.target),
  );
  await assert.rejects(child.connect(attacker).initialize.staticCall(...args));
  await assert.rejects(
    s.factory
      .connect(attacker)
      .initialize.staticCall(s.eventImpl.target, s.timelock.target),
  );
  await assert.rejects(deploy("ERC1967Proxy", [s.factoryImpl.target, "0x"]));
  const eoaClock = await deploy("KlerosUpgradeTimelockV9", [governor.address]);
  assert.equal(await eoaClock.owner(), governor.address);
  await assert.rejects(deploy("KlerosUpgradeTimelockV9", [ethers.ZeroAddress]));
  const fake = await deploy("SecurityFakeDelayAuthority");
  for (const authority of [attacker.address, fake.target]) {
    const data = s.factoryImpl.interface.encodeFunctionData("initialize", [
      s.eventImpl.target,
      authority,
    ]);
    await assert.rejects(deploy("ERC1967Proxy", [s.factoryImpl.target, data]));
  }
  const count = await s.factory.eventCount();
  const key = ethers.id(`invalid-atomic-child-${++serial}`);
  await assert.rejects(
    send(s.factory.createEvent(key, { ...p, depositAmount: 0 }, GAS)),
  );
  assert.equal(await s.factory.eventCount(), count);
  assert.equal(
    await s.factory.eventFor(organizer.address, key),
    ethers.ZeroAddress,
  );
  // The failed attempt cannot reserve the key or leave the factory locked.
  await send(s.factory.createEvent(key, p, GAS));
  assert.equal(await s.factory.eventCount(), count + 1n);
});

test("EOA, organizer, direct implementation, wrong family/UUID/schema and non-UUPS upgrades fail", async () => {
  const s = await setup();
  const child = await createEvent(s, await parameters(10 * DAY));
  const next = await deploy("SecurityEventRevision2");
  await assert.rejects(
    child.connect(attacker).upgradeToAndCall.staticCall(next.target, "0x"),
  );
  await assert.rejects(child.upgradeToAndCall.staticCall(next.target, "0x"));
  await assert.rejects(
    child.upgradeToAndCall.staticCall(next.target, "0x", { value: 1n }),
  );
  await assert.rejects(
    s.eventImpl.upgradeToAndCall.staticCall(next.target, "0x"),
  );
  await assert.rejects(child.proxiableUUID());
  assert.equal(await s.eventImpl.proxiableUUID(), SLOT);
  await send(child.transferOwnership(attacker.address, GAS));
  await send(child.connect(attacker).acceptOwnership(GAS));
  await assert.rejects(
    child.connect(attacker).upgradeToAndCall.staticCall(next.target, "0x"),
  );
  assert.equal(await child.upgradeAuthority(), s.timelock.target);
  const bad = [
    attacker.address,
    (await deploy("SecurityNonUUPS")).target,
    s.factoryImpl.target,
    (await deploy("SecurityWrongUUID")).target,
    (await deploy("SecurityWrongSchema")).target,
    s.eventImpl.target,
    child.target,
  ];
  const operations = [];
  for (const candidate of bad)
    operations.push(
      await queue(
        s,
        child.target,
        child.interface.encodeFunctionData("upgradeToAndCall", [
          candidate,
          "0x",
        ]),
      ),
    );
  // Cross-family rejection is required in both directions.
  operations.push(
    await queue(
      s,
      s.factory.target,
      s.factory.interface.encodeFunctionData("upgradeToAndCall", [
        next.target,
        "0x",
      ]),
    ),
  );
  await warpTo(Math.max(...operations.map((o) => o.eta)));
  for (const operation of operations) {
    await assert.rejects(execute(s, operation));
    assert.equal(await s.timelock.isOperationDone(operation.id), false);
  }
  assert.equal(await implementation(child), s.eventImpl.target);
  assert.equal(await implementation(s.factory), s.factoryImpl.target);
});

test("timelock requires scheduled governance, exact ETA and a permanent 48-hour floor", async () => {
  const s = await setup();
  const child = await createEvent(s, await parameters(10 * DAY));
  const next = await deploy("SecurityEventRevision2");
  const admin = await s.timelock.DEFAULT_ADMIN_ROLE();
  const proposer = await s.timelock.PROPOSER_ROLE();
  assert.equal(await s.timelock.getMinDelay(), BigInt(DELAY));
  assert.equal(await s.timelock.hasRole(admin, s.timelock.target), true);
  for (const account of [
    governor.address,
    organizer.address,
    attacker.address,
    s.signer.target,
  ])
    assert.equal(await s.timelock.hasRole(admin, account), false);
  assert.equal(await s.timelock.hasRole(proposer, s.signer.target), true);
  await assert.rejects(
    s.timelock.grantRole.staticCall(proposer, attacker.address),
  );
  await assert.rejects(s.timelock.updateDelay.staticCall(DELAY));
  const data = child.interface.encodeFunctionData("upgradeToAndCall", [
    next.target,
    "0x",
  ]);
  await assert.rejects(
    s.timelock
      .connect(attacker)
      .schedule.staticCall(child.target, 0, data, ZERO, ZERO, DELAY),
  );
  await assert.rejects(queue(s, child.target, data, DELAY - 1));
  await assert.rejects(
    s.timelock.execute.staticCall(child.target, 0, data, ZERO, ZERO),
  );
  const operation = await queue(s, child.target, data);
  await warpTo(operation.eta - 1);
  await assert.rejects(s.timelock.execute.staticCall(...operation.args));
  assert.equal(await implementation(child), s.eventImpl.target);
  await warpTo(operation.eta);
  const receipt = await execute(s, operation);
  const block = await provider.getBlock(receipt.blockNumber);
  assert.equal(block.timestamp, operation.eta, "upgrade succeeds at exact ETA");
  assert.equal(await implementation(child), next.target);
  await assert.rejects(
    execute(s, operation),
    "completed operations cannot replay",
  );
  const floor = await queue(
    s,
    s.timelock.target,
    s.timelock.interface.encodeFunctionData("updateDelay", [DELAY - 1]),
  );
  await warpTo(floor.eta);
  await assert.rejects(execute(s, floor));
  assert.equal(await s.timelock.getMinDelay(), BigInt(DELAY));
  const increase = await queue(
    s,
    s.timelock.target,
    s.timelock.interface.encodeFunctionData("updateDelay", [3 * DAY]),
  );
  await warpTo(increase.eta);
  await execute(s, increase);
  assert.equal(await s.timelock.getMinDelay(), 3n * BigInt(DAY));
  const restore = await queue(
    s,
    s.timelock.target,
    s.timelock.interface.encodeFunctionData("updateDelay", [DELAY]),
  );
  await warpTo(restore.eta);
  await execute(s, restore);
  assert.equal(await s.timelock.getMinDelay(), BigInt(DELAY));
});

test("factory changes apply to future children and individual upgrades leave other events intact", async () => {
  const s = await setup();
  const p = await parameters(20 * DAY);
  const a = await createEvent(s, p);
  const b = await createEvent(s, p);
  await send(a.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(b.connect(bob).deposit({ value: D, ...GAS }));
  const beforeB = await snapshot(b, [bob]);
  const eventNext = await deploy("SecurityEventRevision2");
  const factoryNext = await deploy("SecurityFactoryRevision2");
  await upgrade(s, a, eventNext);
  assert.equal(await implementation(a), eventNext.target);
  assert.equal(await implementation(b), s.eventImpl.target);
  assert.deepEqual(await snapshot(b, [bob]), beforeB);
  await upgrade(s, s.factory, factoryNext);
  assert.equal(await s.factory.eventCount(), 2n);
  assert.equal(await s.factory.isEvent(a.target), true);
  assert.equal(await s.factory.isEvent(b.target), true);
  assert.equal(await s.factory.eventImplementation(), s.eventImpl.target);
  await assert.rejects(
    s.factory.setEventImplementation.staticCall(eventNext.target),
  );
  const selection = await queue(
    s,
    s.factory.target,
    s.factory.interface.encodeFunctionData("setEventImplementation", [
      eventNext.target,
    ]),
  );
  await warpTo(selection.eta);
  await execute(s, selection);
  const c = await createEvent(s, p);
  assert.equal(await implementation(c), eventNext.target);
  assert.equal(await c.upgradeAuthority(), s.timelock.target);
  assert.equal(await c.owner(), organizer.address);
  assert.equal(await implementation(b), s.eventImpl.target);
  assert.deepEqual(await snapshot(b, [bob]), beforeB);
  assert.equal(await provider.getBalance(s.factory.target), 0n);
  const revision2Child = new ethers.Contract(
    c.target,
    eventNext.interface,
    attacker,
  );
  await assert.rejects(
    revision2Child.migrate.staticCall(73),
    /migration authority only/,
  );
  const migration = await queue(
    s,
    c.target,
    eventNext.interface.encodeFunctionData("migrate", [73]),
  );
  await warpTo(migration.eta);
  await execute(s, migration);
  assert.equal(
    await revision2Child.migrationMarker(),
    73n,
    "an unauthorized migration cannot consume the reinitializer version",
  );
});

test("a funded open event preserves pending and owed credits; reverting migration is atomic and successful migration cannot replay", async () => {
  const s = await setup();
  const c = await createEvent(s, await parameters(15 * DAY));
  const refusing = await deploy("TestWallet");
  await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(c.connect(bob).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([alice.address, bob.address], GAS));
  await send(
    refusing.exec(c.target, c.interface.encodeFunctionData("deposit"), {
      value: 2n * D,
      ...GAS,
    }),
  );
  await send(refusing.setMode(1));
  await send(c.rejectAndRefund([refusing.target], GAS));
  const next = await deploy("SecurityEventRevision2");
  const beforeState = await snapshot(c, [alice, bob, refusing]);
  const reverting = await queue(
    s,
    c.target,
    c.interface.encodeFunctionData("upgradeToAndCall", [
      next.target,
      next.interface.encodeFunctionData("revertingMigration"),
    ]),
  );
  await warpTo(reverting.eta);
  await assert.rejects(execute(s, reverting));
  assert.equal(await implementation(c), s.eventImpl.target);
  assert.equal(await s.timelock.isOperationDone(reverting.id), false);
  assert.deepEqual(await snapshot(c, [alice, bob, refusing]), beforeState);
  await upgrade(s, c, next, next.interface.encodeFunctionData("migrate", [42]));
  assert.deepEqual(await snapshot(c, [alice, bob, refusing]), beforeState);
  const migrated = new ethers.Contract(c.target, next.interface, organizer);
  assert.equal(await migrated.migrationMarker(), 42n);
  await assert.rejects(migrated.connect(attacker).migrate.staticCall(100));
  const replay = await queue(
    s,
    c.target,
    next.interface.encodeFunctionData("migrate", [100]),
  );
  await warpTo(replay.eta);
  await assert.rejects(execute(s, replay));
  assert.equal(await migrated.migrationMarker(), 42n);
  // Existing admission history and user-owned credits still function after upgrading.
  await send(
    refusing.exec(
      c.target,
      c.interface.encodeFunctionData("claim", [beneficiary.address]),
      GAS,
    ),
  );
  await send(
    refusing.exec(
      c.target,
      c.interface.encodeFunctionData("withdrawPending", [
        beneficiary.address,
        D,
      ]),
      GAS,
    ),
  );
  await send(c.connect(alice).withdrawPending(beneficiary.address, D, GAS));
  await send(c.cancel(GAS));
  assert.equal(await c.reserved(), 0n);
  assert.equal(await provider.getBalance(c.target), 0n);
});

test("a recipient callback cannot execute an already-ready authorized upgrade during a financial payment", async () => {
  const s = await setup();
  const c = await createEvent(s, await parameters(10 * DAY));
  const wallet = await deploy("TestWallet");
  await send(
    wallet.exec(c.target, c.interface.encodeFunctionData("deposit"), {
      value: D,
      ...GAS,
    }),
  );
  await send(c.registerStakers([wallet.target], GAS));
  await send(wallet.setMode(1));
  await send(c.cancel(GAS));
  assert.equal(await c.owed(wallet.target), D);
  const next = await deploy("SecurityEventRevision2");
  const operation = await queue(
    s,
    c.target,
    c.interface.encodeFunctionData("upgradeToAndCall", [next.target, "0x"]),
  );
  await warpTo(operation.eta);
  await send(
    wallet.setReentry(
      s.timelock.target,
      s.timelock.interface.encodeFunctionData("execute", operation.args),
      0,
    ),
  );
  // claim forwards gas, so rejection must come from the financial lock, not a 40k stipend.
  await send(
    wallet.exec(
      c.target,
      c.interface.encodeFunctionData("claim", [wallet.target]),
      GAS,
    ),
  );
  assert.equal(await wallet.reentered(), true);
  assert.equal(await wallet.reentryOk(), false);
  assert.equal(
    c.interface.parseError(await wallet.reentryError()).name,
    "UpgradeWhileBusy",
  );
  assert.equal(await implementation(c), s.eventImpl.target);
  assert.equal(await s.timelock.isOperationDone(operation.id), false);
  assert.equal(await c.owed(wallet.target), 0n);
  assert.equal(await provider.getBalance(c.target), 0n);
  await execute(s, operation);
  assert.equal(
    await implementation(c),
    next.target,
    "the same scheduled operation remains executable once the payment finishes",
  );
});

test("a waiting challenge retains exact state through upgrade and can finish without matching", async () => {
  const s = await setup();
  const c = await createEvent(s);
  for (const guest of [alice, bob])
    await send(c.connect(guest).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([alice.address, bob.address], GAS));
  await warpTo(Number(await c.eventStart()));
  await send(c.postAttendance([alice.address], 2n * D, GAS));
  const fee = await c.challengeDeposit();
  await send(c.connect(bob).challenge({ value: fee, ...GAS }));
  const beforeState = await snapshot(c, [alice, bob]);
  const next = await deploy("SecurityEventRevision2");
  await upgrade(s, c, next);
  assert.deepEqual(await snapshot(c, [alice, bob]), beforeState);
  await send(c.resolveChallenge(bob.address, GAS));
  await send(c.releasePayouts(GAS));
  assert.equal(await c.attended(bob.address), true);
  assert.equal(await c.pendingChallenges(), 0n);
  assert.equal(await c.reserved(), 0n);
  assert.equal(await provider.getBalance(c.target), 0n);
});

test("funded disputed and delivered-but-unsettled upgrades retain held shares, case identity and ruling 0/1/2 economics", async () => {
  for (const ruling of [0, 1, 2]) {
    const s = await setup();
    const c = await createEvent(s);
    const refusing = await deploy("TestWallet");
    await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
    await send(c.connect(bob).deposit({ value: D, ...GAS }));
    await send(
      refusing.exec(c.target, c.interface.encodeFunctionData("deposit"), {
        value: D,
        ...GAS,
      }),
    );
    await send(
      c.registerStakers([alice.address, bob.address, refusing.target], GAS),
    );
    await warpTo(Number(await c.eventStart()));
    await send(
      c.postAttendance([alice.address, refusing.target], (3n * D) / 2n, GAS),
    );
    const fee = await c.challengeDeposit();
    await send(c.connect(bob).challenge({ value: fee, ...GAS }));
    await send(
      c.connect(attacker).matchChallenge(bob.address, { value: fee, ...GAS }),
    );
    const challenge = await c.challenges(bob.address);
    assert.notEqual(challenge.arbitratorDisputeID, challenge.localDisputeID);
    await send(c.transferOwnership(beneficiary.address, GAS));
    await send(c.connect(beneficiary).acceptOwnership(GAS));
    await send(refusing.setMode(1));
    await warpTo(Number(await c.challengeEndsAt()) + 1);
    await send(c.releasePayouts(GAS));
    assert.equal(await c.heldBack(), D);
    assert.equal(await c.owed(refusing.target), D);
    const next = await deploy("SecurityEventRevision2");
    // Ruling 1 is delivered before the upgrade; 0 and 2 remain unruled until after it.
    if (ruling === 1)
      await send(
        court.giveFinalRuling(challenge.arbitratorDisputeID, ruling, GAS),
      );
    const beforeState = await snapshot(c, [alice, bob, refusing]);
    await upgrade(s, c, next);
    assert.deepEqual(await snapshot(c, [alice, bob, refusing]), beforeState);
    assert.equal(await c.caseOrganizer(bob.address), organizer.address);
    assert.equal(await c.owner(), beneficiary.address);
    if (ruling !== 1)
      await send(
        court.giveFinalRuling(challenge.arbitratorDisputeID, ruling, GAS),
      );
    const aliceBefore = await provider.getBalance(alice.address);
    const bobBefore = await provider.getBalance(bob.address);
    const matcherBefore = await provider.getBalance(attacker.address);
    await send(c.resolveChallenge(bob.address, GAS));
    assert.equal(await c.attended(bob.address), ruling === 1);
    assert.equal(await c.challengeEscrow(), 0n);
    assert.equal(await c.heldBack(), 0n);
    assert.equal(await c.pendingChallenges(), 0n);
    assert.equal(
      await provider.getBalance(alice.address),
      aliceBefore + (ruling === 1 ? 0n : D / 2n),
    );
    assert.equal(
      await provider.getBalance(bob.address),
      bobBefore + (ruling === 1 ? D + fee : ruling === 0 ? fee / 2n : 0n),
    );
    assert.equal(
      await provider.getBalance(attacker.address),
      matcherBefore + (ruling === 2 ? fee : ruling === 0 ? fee - fee / 2n : 0n),
    );
    assert.equal(
      await c.owed(refusing.target),
      ruling === 1 ? D : (3n * D) / 2n,
    );
    assert.equal(await c.pendingDeposits(alice.address), D);
    await send(
      refusing.exec(
        c.target,
        c.interface.encodeFunctionData("claim", [beneficiary.address]),
        GAS,
      ),
    );
    await send(c.connect(alice).withdrawPending(beneficiary.address, D, GAS));
    assert.equal(await c.reserved(), 0n);
    assert.equal(await provider.getBalance(c.target), 0n);
  }
});
