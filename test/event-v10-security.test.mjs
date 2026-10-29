// Independent V10 attack tests. Synthetic accounts and an in-process chain only.
// The deliberately malicious implementation below is a trust-boundary counterexample,
// never a deployment candidate. Metadata compatibility cannot establish honest code.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ganache from "ganache";
import { ethers } from "ethers";
import solc from "solc-hardened";
import legacySolc from "solc";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DAY = 86400,
  D = ethers.parseEther("0.01");
const SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const GAS = { gasLimit: 6_000_000 };
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
const SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
import {KlerosEventV10} from "contracts/v10/KlerosEventV10.sol";
import {KlerosEventFactoryV10} from "contracts/v10/KlerosEventFactoryV10.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
interface IImmediateController {
    function upgrade(address,address,bytes calldata) external;
    function setEventImplementation(address,address) external;
    function transferOwnership(address) external;
    function acceptOwnership() external;
    function cancelOwnershipTransfer() external;
    function renounceOwnership() external;
}
contract SecurityEventV10R2 is KlerosEventV10 {
    uint256 public marker;
    function implementationRevision() public pure virtual override returns (uint256) { return 2; }
    function migrate(uint256 value) external reinitializer(2) {
        require(msg.sender == upgradeAuthority()); marker = value;
    }
    function revertingMigration(address payable recipient) external reinitializer(2) {
        require(msg.sender == upgradeAuthority()); marker = 999;
        (bool ok,) = recipient.call{value: address(this).balance / 4}(""); require(ok);
        revert("synthetic atomic migration failure");
    }
}
contract SecurityEventV10R3 is SecurityEventV10R2 {
    function implementationRevision() public pure override returns (uint256) { return 3; }
}
contract SecurityFactoryV10R2 is KlerosEventFactoryV10 {
    function implementationRevision() public pure virtual override returns (uint256) { return 2; }
}
contract SecurityFactoryV10R3 is SecurityFactoryV10R2 {
    function implementationRevision() public pure override returns (uint256) { return 3; }
}
contract SecurityWrongSchemaV10 is SecurityEventV10R2 {
    function storageSchema() public pure override returns (bytes32) { return keccak256("wrong-schema"); }
}
contract SecurityNonUUPSV10 { }
contract SecurityWrongUUIDV10 {
    function VERSION() external pure returns (uint256) { return 10; }
    function UPGRADE_FAMILY() external pure returns (bytes32) { return keccak256("kleros.event.v10.uups"); }
    function storageSchema() external pure returns (bytes32) { return keccak256("kleros.event.v10.storage.1"); }
    function implementationRevision() external pure returns (uint256) { return 2; }
    function proxiableUUID() external pure returns (bytes32) { return bytes32(0); }
}
contract SecurityWrongVersionV10 {
    function VERSION() external pure returns (uint256) { return 9; }
    function UPGRADE_FAMILY() external pure returns (bytes32) { return keccak256("kleros.event.v10.uups"); }
    function storageSchema() external pure returns (bytes32) { return keccak256("kleros.event.v10.storage.1"); }
    function implementationRevision() external pure returns (uint256) { return 2; }
    function proxiableUUID() external pure returns (bytes32) { return ${SLOT}; }
}
contract SecurityFakeControllerV10 {
    function upgradesDisabled() external pure returns (bool) { return false; }
    function VERSION() external pure returns (uint256) { return 10; }
    function UPGRADE_DELAY_SECONDS() external pure returns (uint256) { return 0; }
}
contract SecurityOwnerActorV10 {
    address public immutable driver;
    address public authority;
    address public target;
    address public candidate;
    address public factory;
    address public peer;
    bytes public paymentData;
    bool public paymentOK;
    bytes public paymentError;
    constructor(address account) { driver = account; }
    modifier onlyDriver() { require(msg.sender == driver, "synthetic driver only"); _; }
    function configure(address authority_, address target_, address candidate_, address factory_, address peer_) external onlyDriver {
        authority = authority_; target = target_; candidate = candidate_; factory = factory_; peer = peer_;
    }
    function forward(address recipient, bytes calldata data) external payable onlyDriver returns (bytes memory result) {
        bool ok; (ok,result) = recipient.call{value: msg.value}(data);
        if (!ok) assembly ("memory-safe") { revert(add(result,32),mload(result)) }
    }
    function acceptViaPeer() external { require(msg.sender == peer); IImmediateController(authority).acceptOwnership(); }
    function perform(uint256 mode) external {
        require(msg.sender == target);
        IImmediateController controller = IImmediateController(authority);
        if (mode == 0) controller.renounceOwnership();
        else if (mode == 1) controller.transferOwnership(peer);
        else if (mode == 2) controller.cancelOwnershipTransfer();
        else if (mode == 3) controller.upgrade(target,candidate,"");
        else if (mode == 4) controller.setEventImplementation(factory,candidate);
        else if (mode == 5) SecurityOwnerActorV10(payable(peer)).acceptViaPeer();
        else revert("unknown callback");
    }
    function setPaymentData(bytes calldata data) external onlyDriver { paymentData = data; paymentOK = false; paymentError = hex"00"; }
    receive() external payable {
        if (paymentData.length > 0) (paymentOK,paymentError) = authority.call(paymentData);
    }
}
contract SecurityCallbackEventV10R2 is SecurityEventV10R2 {
    error CallbackResult(uint256 mode, bool accepted, bytes reason);
    function callbackAndRevert(address actor, uint256 mode) external reinitializer(2) {
        require(msg.sender == upgradeAuthority());
        (bool ok,bytes memory reason) = actor.call(abi.encodeCall(SecurityOwnerActorV10.perform,(mode)));
        revert CallbackResult(mode,ok,reason);
    }
}
// Intentionally unsafe, authorized fixture. It truthfully shows why an allowlisted
// family/schema/revision/UUID is not a substitute for review of implementation code.
contract SecurityMaliciousMetadataV10 is SecurityEventV10R2 {
    function unguardedInstall(address implementation) external { ERC1967Utils.upgradeToAndCall(implementation,""); }
}
`;

let rpc,
  provider,
  upgradeOwner,
  organizer,
  alice,
  bob,
  pending,
  outsider,
  beneficiary;
let fixtures,
  mocks,
  court,
  resolver,
  serial = 0;
const send = async (pendingTx) => (await pendingTx).wait();
function artifact(name) {
  if (fixtures?.[name]) return fixtures[name];
  if (mocks?.[name]) return mocks[name];
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "build/contracts-v10", `${name}.json`)),
  );
}
function compileFixtures() {
  const input = JSON.parse(
    fs.readFileSync(path.join(ROOT, "build/contracts-v10/standard-input.json")),
  );
  assert(solc.version().startsWith("0.8.38+"));
  for (const [filename, source] of Object.entries(input.sources))
    assert.equal(
      source.content,
      fs.readFileSync(
        path.join(
          ROOT,
          filename.startsWith("@openzeppelin/") ? "node_modules" : "",
          filename,
        ),
        "utf8",
      ),
      filename,
    );
  input.sources["SecurityV10Fixtures.sol"] = { content: SOURCE };
  input.settings.outputSelection = {
    "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.deepEqual(
    (output.errors ?? [])
      .filter((e) => e.severity === "error")
      .map((e) => e.formattedMessage),
    [],
  );
  for (const name of [
    "KlerosUpgradeControllerV10",
    "KlerosEventV10",
    "KlerosEventFactoryV10",
  ]) {
    const c = output.contracts[`contracts/v10/${name}.sol`][name];
    assert.equal(
      ethers.keccak256(`0x${c.evm.bytecode.object}`),
      ethers.keccak256(artifact(name).bytecode),
      `current ${name} deployment artifact`,
    );
  }
  return Object.fromEntries(
    Object.entries(output.contracts["SecurityV10Fixtures.sol"]).map(
      ([name, c]) => [
        name,
        { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` },
      ],
    ),
  );
}
function compileMocks() {
  assert(legacySolc.version().startsWith("0.8.28+"));
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      ["MockKleros", "TestWallet"].map((name) => [
        `${name}.sol`,
        {
          content: fs.readFileSync(
            path.join(ROOT, "references/kickback/test", `${name}.sol`),
            "utf8",
          ),
        },
      ]),
    ),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(legacySolc.compile(JSON.stringify(input)));
  assert.deepEqual(
    (output.errors ?? [])
      .filter((e) => e.severity === "error")
      .map((e) => e.formattedMessage),
    [],
  );
  return Object.fromEntries(
    Object.values(output.contracts).flatMap((group) =>
      Object.entries(group).map(([name, c]) => [
        name,
        { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` },
      ]),
    ),
  );
}
async function deploy(name, args = [], signer = upgradeOwner) {
  const a = artifact(name),
    c = await new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(
      ...args,
      { gasLimit: 16_000_000 },
    );
  await c.waitForDeployment();
  return c;
}
async function now() {
  return Number(
    (
      await rpc.request({
        method: "eth_getBlockByNumber",
        params: ["latest", false],
      })
    ).timestamp,
  );
}
async function warpTo(timestamp) {
  assert(timestamp >= (await now()));
  await rpc.request({ method: "evm_setTime", params: [timestamp * 1000] });
  await rpc.request({ method: "evm_mine", params: [] });
  assert.equal(await now(), timestamp);
}
async function slot(c) {
  const value = await rpc.request({
    method: "eth_getStorageAt",
    params: [c.target, SLOT, "latest"],
  });
  return ethers.getAddress(`0x${value.slice(-40)}`);
}
async function setup(ownerAddress = upgradeOwner.address) {
  const controller = await deploy("KlerosUpgradeControllerV10", [ownerAddress]);
  const eventImpl = await deploy("KlerosEventV10"),
    factoryImpl = await deploy("KlerosEventFactoryV10");
  const proxy = await deploy("ERC1967Proxy", [
    factoryImpl.target,
    factoryImpl.interface.encodeFunctionData("initialize", [
      eventImpl.target,
      controller.target,
    ]),
  ]);
  const factory = new ethers.Contract(
    proxy.target,
    artifact("KlerosEventFactoryV10").abi,
    organizer,
  );
  return { controller, eventImpl, factoryImpl, factory };
}
async function parameters(startOffset = 3600) {
  const start = (await now()) + startOffset;
  return {
    depositAmount: D,
    eventName: "Synthetic immediate V10 security",
    eventStart: start,
    claimDeadline: start + 8 * DAY,
    arbitration: [
      resolver.target,
      EXTRA,
      ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
      "0x010204",
      "/ipfs/SyntheticV10SecurityPolicy",
    ],
  };
}
async function child(s, config) {
  const key = ethers.id(`security-v10-${++serial}`);
  await send(s.factory.createEvent(key, config ?? (await parameters()), GAS));
  return new ethers.Contract(
    await s.factory.eventFor(organizer.address, key),
    artifact("KlerosEventV10").abi,
    organizer,
  );
}
async function state(c, wallets = [alice, bob]) {
  const normalize = (value) => Array.isArray(value) ? Array.from(value, normalize) : value;
  const result = { balance: await provider.getBalance(c.target) };
  for (const field of [
    "owner",
    "pendingOwner",
    "phase",
    "depositAmount",
    "eventStart",
    "claimDeadline",
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
    "disputeResolver",
    "arbitrator",
    "arbitratorExtraData",
    "metaEvidenceStore",
    "policyURI",
    "eventName",
  ])
    result[field] = await c[field]();
  for (const field of [
    "stakers",
    "attendees",
    "challengers",
    "metaEvidenceTemplate",
  ])
    result[field] = normalize(await c[field]());
  result.wallets = {};
  for (const wallet of wallets) {
    const address = wallet.address ?? wallet.target;
    result.wallets[address] = {
      pending: await c.pendingDeposits(address),
      owed: await c.owed(address),
      status: await c.status(address),
      attended: await c.attended(address),
      organizer: await c.caseOrganizer(address),
      challenge: [...(await c.challenges(address))],
    };
  }
  return result;
}
const errorData = (e) => e.data ?? e.info?.error?.data?.result;
async function rejectsAs(promise, c, name) {
  await assert.rejects(promise, (e) => {
    assert.equal(c.interface.parseError(errorData(e))?.name, name);
    return true;
  });
}

before(async () => {
  fixtures = compileFixtures();
  mocks = compileMocks();
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000, timestampIncrement: 0 },
    wallet: { totalAccounts: 8, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  [upgradeOwner, organizer, alice, bob, pending, outsider, beneficiary] =
    await Promise.all(
      Array.from({ length: 7 }, (_, i) => provider.getSigner(i)),
    );
  court = await deploy("MockKlerosLiquid");
  resolver = await deploy("MockArbitrableProxy", [court.target]);
});
after(async () => {
  provider?.destroy();
  await rpc?.disconnect();
});

test("V9 sources stay immutable and V10 exposes no alternate queue, admin, arbitrary-call or restoration surface", async () => {
  for (const [file, expected] of [
    [
      "KlerosUpgradeTimelockV9.sol",
      "bd0c37a72bbfb0341530768896035046dab67e01870fadd03e406a618c04926e",
    ],
    [
      "KlerosUpgradeGateV9.sol",
      "0197602754ac7296f01b645f4331d3b6f09faf2c78181df4ed702ba1a24bd365",
    ],
    [
      "KlerosEventV9.sol",
      "e3d9f947537165d885878c89e86114e6901d0665f4d4b00bf20b9da227a9e11b",
    ],
    [
      "KlerosEventFactoryV9.sol",
      "4ce1c30a8ebf383c41718ac2b48bda03ffc719d718447cdd3678e9c067fedbe9",
    ],
  ])
    assert.equal(
      createHash("sha256")
        .update(fs.readFileSync(path.join(ROOT, "contracts/v9", file)))
        .digest("hex"),
      expected,
    );
  const c = await deploy("KlerosUpgradeControllerV10", [upgradeOwner.address]);
  assert.equal(await c.VERSION(), 10n);
  assert.equal(await c.UPGRADE_DELAY_SECONDS(), 0n);
  assert.equal(await c.upgradesDisabled(), false);
  const methods = artifact("KlerosUpgradeControllerV10")
    .abi.filter((x) => x.type === "function")
    .map((x) => x.name)
    .sort();
  assert.deepEqual(
    methods,
    [
      "UPGRADE_DELAY_SECONDS",
      "VERSION",
      "acceptOwnership",
      "cancelOwnershipTransfer",
      "owner",
      "pendingOwner",
      "renounceOwnership",
      "setEventImplementation",
      "transferOwnership",
      "upgrade",
      "upgradesDisabled",
    ].sort(),
  );
  for (const signature of [
    "grantRole(bytes32,address)",
    "schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
    "execute(address,uint256,bytes,bytes32,bytes32)",
    "restoreOwnership(address)",
    "upgradeToAndCall(address,bytes)",
    "initialize(address)",
  ])
    await assert.rejects(
      send(
        upgradeOwner.sendTransaction({
          to: c.target,
          data: ethers.id(signature).slice(0, 10),
          ...GAS,
        }),
      ),
    );
});

test("initializers lock implementations, reject authority facades and roll failed children back atomically", async () => {
  const s = await setup(),
    p = await parameters(10 * DAY),
    a = await child(s, p);
  assert.equal(await a.VERSION(), 10n);
  assert.equal(await a.owner(), organizer.address);
  assert.equal(await a.upgradeAuthority(), s.controller.target);
  const args = [
    p.depositAmount,
    p.eventName,
    organizer.address,
    p.eventStart,
    p.claimDeadline,
    p.arbitration,
    s.factory.target,
  ];
  await assert.rejects(s.eventImpl.initialize.staticCall(...args));
  await assert.rejects(a.connect(outsider).initialize.staticCall(...args));
  await assert.rejects(
    s.factoryImpl.initialize.staticCall(
      s.eventImpl.target,
      s.controller.target,
    ),
  );
  await assert.rejects(
    s.factory.initialize.staticCall(s.eventImpl.target, s.controller.target),
  );
  await assert.rejects(deploy("ERC1967Proxy", [s.factoryImpl.target, "0x"]));
  const facade = await deploy("SecurityFakeControllerV10");
  for (const authority of [outsider.address, facade.target])
    await assert.rejects(
      deploy("ERC1967Proxy", [
        s.factoryImpl.target,
        s.factoryImpl.interface.encodeFunctionData("initialize", [
          s.eventImpl.target,
          authority,
        ]),
      ]),
    );
  const count = await s.factory.eventCount(),
    key = ethers.id(`invalid-v10-${++serial}`);
  await assert.rejects(
    send(s.factory.createEvent(key, { ...p, depositAmount: 0 }, GAS)),
  );
  assert.equal(await s.factory.eventCount(), count);
  assert.equal(
    await s.factory.eventFor(organizer.address, key),
    ethers.ZeroAddress,
  );
  await send(s.factory.createEvent(key, p, GAS));
  assert.equal(await s.factory.eventCount(), count + 1n);
});

test("only the accepted controller owner upgrades immediately; unsafe versions, families, schemas, revisions and UUIDs are rejected", async () => {
  const s = await setup(),
    a = await child(s, await parameters(10 * DAY)),
    r2 = await deploy("SecurityEventV10R2");
  for (const actor of [organizer, pending, outsider])
    await assert.rejects(
      s.controller.connect(actor).upgrade.staticCall(a.target, r2.target, "0x"),
    );
  await assert.rejects(a.upgradeToAndCall.staticCall(r2.target, "0x"));
  await assert.rejects(
    s.eventImpl.upgradeToAndCall.staticCall(r2.target, "0x"),
  );
  await assert.rejects(a.proxiableUUID());
  assert.equal(await s.eventImpl.proxiableUUID(), SLOT);
  const bad = [
    outsider.address,
    (await deploy("SecurityNonUUPSV10")).target,
    s.factoryImpl.target,
    (await deploy("SecurityWrongVersionV10")).target,
    (await deploy("SecurityWrongUUIDV10")).target,
    (await deploy("SecurityWrongSchemaV10")).target,
    s.eventImpl.target,
    a.target,
  ];
  for (const candidate of bad) {
    await assert.rejects(
      send(s.controller.upgrade(a.target, candidate, "0x", GAS)),
    );
    assert.equal(await slot(a), s.eventImpl.target);
  }
  await assert.rejects(
    s.controller.upgrade.staticCall(s.factory.target, r2.target, "0x"),
  );
  await assert.rejects(
    s.controller.setEventImplementation.staticCall(a.target, r2.target),
  );
  await assert.rejects(
    s.controller.upgrade.staticCall(outsider.address, r2.target, "0x"),
  );
  for (const recipient of [
    ethers.ZeroAddress,
    upgradeOwner.address,
    s.controller.target,
  ])
    await rejectsAs(
      s.controller.transferOwnership.staticCall(recipient),
      s.controller,
      "InvalidUpgradeOwner",
    );
  await send(s.controller.transferOwnership(pending.address, GAS));
  await assert.rejects(
    s.controller.connect(pending).upgrade.staticCall(a.target, r2.target, "0x"),
  );
  await send(s.controller.cancelOwnershipTransfer(GAS));
  await assert.rejects(
    s.controller.connect(pending).acceptOwnership.staticCall(),
  );
  await send(s.controller.transferOwnership(pending.address, GAS));
  await send(s.controller.connect(pending).acceptOwnership(GAS));
  await assert.rejects(
    s.controller.upgrade.staticCall(a.target, r2.target, "0x"),
  );
  const timestamp = await now();
  await send(
    s.controller.connect(pending).upgrade(a.target, r2.target, "0x", GAS),
  );
  assert.equal(
    await now(),
    timestamp,
    "no delay or time travel for immediate upgrade",
  );
  assert.equal(await slot(a), r2.target);
});

test("shared renunciation clears pending ownership and freezes factory/default/A/B while existing and new financial events remain usable", async () => {
  const s = await setup(),
    p = await parameters(),
    a = await child(s, p),
    b = await child(s, p);
  await send(a.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(a.registerStakers([alice.address], GAS));
  await send(b.connect(bob).deposit({ value: D, ...GAS }));
  const r2 = await deploy("SecurityEventV10R2"),
    r3 = await deploy("SecurityEventV10R3"),
    f2 = await deploy("SecurityFactoryV10R2"),
    f3 = await deploy("SecurityFactoryV10R3");
  await send(s.controller.upgrade(a.target, r2.target, "0x", GAS));
  await send(s.controller.upgrade(s.factory.target, f2.target, "0x", GAS));
  await send(
    s.controller.setEventImplementation(s.factory.target, r2.target, GAS),
  );
  const beforeA = await state(a),
    beforeB = await state(b);
  await send(s.controller.transferOwnership(pending.address, GAS));
  await send(s.controller.renounceOwnership(GAS));
  assert.equal(await s.controller.owner(), ethers.ZeroAddress);
  assert.equal(await s.controller.pendingOwner(), ethers.ZeroAddress);
  assert.equal(await s.controller.upgradesDisabled(), true);
  for (const actor of [upgradeOwner, pending, organizer, outsider]) {
    const c = s.controller.connect(actor);
    for (const action of [
      () => c.upgrade(a.target, r3.target, "0x", GAS),
      () => c.upgrade(b.target, r2.target, "0x", GAS),
      () => c.upgrade(s.factory.target, f3.target, "0x", GAS),
      () => c.setEventImplementation(s.factory.target, r3.target, GAS),
      () => c.transferOwnership(actor.address, GAS),
      () => c.acceptOwnership(GAS),
      () => c.cancelOwnershipTransfer(GAS),
      () => c.renounceOwnership(GAS),
    ])
      await assert.rejects(send(action()));
  }
  assert.equal(await slot(a), r2.target);
  assert.equal(await slot(b), s.eventImpl.target);
  assert.equal(await slot(s.factory), f2.target);
  assert.equal(await s.factory.eventImplementation(), r2.target);
  assert.deepEqual(await state(a), beforeA);
  assert.deepEqual(await state(b), beforeB);
  const c = await child(s, await parameters());
  assert.equal(await slot(c), r2.target);
  assert.equal(await c.upgradeAuthority(), s.controller.target);
  assert.equal(await c.owner(), organizer.address);
  assert.equal(await s.factory.eventCount(), 3n);
  await send(c.connect(bob).deposit({ value: D, ...GAS }));
  await send(c.registerStakers([bob.address], GAS));
  await send(c.cancel(GAS));
  assert.equal(await provider.getBalance(c.target), 0n);
  await warpTo(p.eventStart);
  await send(a.postAttendance([alice.address], D, GAS));
  await warpTo(Number(await a.challengeEndsAt()) + 1);
  const paidBefore = await provider.getBalance(alice.address);
  await send(a.releasePayouts(GAS));
  assert.equal(await provider.getBalance(alice.address), paidBefore + D);
  await send(a.connect(alice).withdrawPending(beneficiary.address, D, GAS));
  await send(b.connect(bob).withdrawPending(beneficiary.address, D, GAS));
  assert.equal(await a.reserved(), 0n);
  assert.equal(await b.reserved(), 0n);
  assert.equal(await a.owner(), organizer.address);
  assert.equal(await s.controller.upgradesDisabled(), true);
});

test("all owner mutations and nested forwarding reject inside an upgrade callback; reverting migration restores slots, balances and controller usability", async () => {
  const actor = await deploy("SecurityOwnerActorV10", [upgradeOwner.address]),
    peer = await deploy("SecurityOwnerActorV10", [upgradeOwner.address]);
  const s = await setup(actor.target),
    a = await child(s, await parameters(10 * DAY));
  await send(a.connect(alice).deposit({ value: 2n * D, ...GAS }));
  const candidate = await deploy("SecurityCallbackEventV10R2"),
    r3 = await deploy("SecurityEventV10R3");
  await send(
    actor.configure(
      s.controller.target,
      a.target,
      candidate.target,
      s.factory.target,
      peer.target,
      GAS,
    ),
  );
  await send(
    peer.configure(
      s.controller.target,
      a.target,
      candidate.target,
      s.factory.target,
      actor.target,
      GAS,
    ),
  );
  await send(
    actor.forward(
      s.controller.target,
      s.controller.interface.encodeFunctionData("transferOwnership", [
        peer.target,
      ]),
      GAS,
    ),
  );
  const before = await state(a);
  for (const mode of [0, 1, 2, 3, 4, 5]) {
    const upgrade = s.controller.interface.encodeFunctionData("upgrade", [
      a.target,
      candidate.target,
      candidate.interface.encodeFunctionData("callbackAndRevert", [
        actor.target,
        mode,
      ]),
    ]);
    await assert.rejects(
      actor.forward.staticCall(s.controller.target, upgrade),
      (error) => {
        const result = candidate.interface.parseError(errorData(error));
        assert.equal(result.name, "CallbackResult");
        assert.equal(result.args.mode, BigInt(mode));
        assert.equal(result.args.accepted, false);
        assert.equal(
          s.controller.interface.parseError(result.args.reason).name,
          "ControllerBusy",
        );
        return true;
      },
    );
    await assert.rejects(
      send(actor.forward(s.controller.target, upgrade, GAS)),
    );
    assert.equal(await slot(a), s.eventImpl.target);
    assert.deepEqual(await state(a), before);
    assert.equal(await s.controller.owner(), actor.target);
    assert.equal(await s.controller.pendingOwner(), peer.target);
  }
  const recipientBefore = await provider.getBalance(beneficiary.address);
  await assert.rejects(
    send(
      actor.forward(
        s.controller.target,
        s.controller.interface.encodeFunctionData("upgrade", [
          a.target,
          candidate.target,
          candidate.interface.encodeFunctionData("revertingMigration", [
            beneficiary.address,
          ]),
        ]),
        GAS,
      ),
    ),
  );
  assert.equal(await provider.getBalance(beneficiary.address), recipientBefore);
  assert.deepEqual(await state(a), before);
  assert.equal(await slot(a), s.eventImpl.target);
  await send(
    actor.forward(
      s.controller.target,
      s.controller.interface.encodeFunctionData("upgrade", [
        a.target,
        candidate.target,
        candidate.interface.encodeFunctionData("migrate", [123]),
      ]),
      GAS,
    ),
  );
  assert.equal(
    await new ethers.Contract(
      a.target,
      candidate.interface,
      organizer,
    ).marker(),
    123n,
  );
  await send(
    actor.forward(
      s.controller.target,
      s.controller.interface.encodeFunctionData("renounceOwnership"),
      GAS,
    ),
  );
  assert.equal(await s.controller.upgradesDisabled(), true);
  assert.equal(await s.controller.pendingOwner(), ethers.ZeroAddress);
  await assert.rejects(
    send(
      peer.forward(
        s.controller.target,
        s.controller.interface.encodeFunctionData("acceptOwnership"),
        GAS,
      ),
    ),
  );
  await assert.rejects(
    send(
      actor.forward(
        s.controller.target,
        s.controller.interface.encodeFunctionData("upgrade", [
          a.target,
          r3.target,
          "0x",
        ]),
        GAS,
      ),
    ),
  );
});

test("a payment callback cannot upgrade a busy event even when the recipient owns the immediate controller", async () => {
  const actor = await deploy("SecurityOwnerActorV10", [upgradeOwner.address]);
  const s = await setup(actor.target),
    a = await child(s, await parameters(10 * DAY));
  const next = await deploy("SecurityEventV10R2");
  await send(
    actor.configure(
      s.controller.target,
      a.target,
      next.target,
      s.factory.target,
      ethers.ZeroAddress,
      GAS,
    ),
  );
  await send(
    actor.forward(a.target, a.interface.encodeFunctionData("deposit"), {
      value: D,
      ...GAS,
    }),
  );
  await send(a.registerStakers([actor.target], GAS));
  // Pending withdrawal forwards gas to the controller owner. Rejection must be
  // UpgradeWhileBusy, not exhaustion of the fixed batch recipient stipend.
  await send(a.connect(bob).deposit({ value: D, ...GAS }));
  await send(
    actor.setPaymentData(
      s.controller.interface.encodeFunctionData("upgrade", [
        a.target,
        next.target,
        "0x",
      ]),
      GAS,
    ),
  );
  await send(a.connect(bob).withdrawPending(actor.target, D, GAS));
  assert.equal(await actor.paymentOK(), false);
  assert.equal(
    a.interface.parseError(await actor.paymentError()).name,
    "UpgradeWhileBusy",
  );
  assert.equal(await slot(a), s.eventImpl.target);
  assert.equal(await s.controller.upgradesDisabled(), false);
  await send(
    actor.forward(
      s.controller.target,
      s.controller.interface.encodeFunctionData("upgrade", [
        a.target,
        next.target,
        "0x",
      ]),
      GAS,
    ),
  );
  assert.equal(await slot(a), next.target);
});

test("finalizing upgrades preserves held cases, owed transfers and pending credit; ordinary organizer settlement still pays the same Bob", async () => {
  const s = await setup(),
    a = await child(s),
    wallet = await deploy("TestWallet");
  await send(a.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(a.connect(bob).deposit({ value: D, ...GAS }));
  await send(
    wallet.exec(a.target, a.interface.encodeFunctionData("deposit"), {
      value: D,
      ...GAS,
    }),
  );
  await send(
    a.registerStakers([alice.address, bob.address, wallet.target], GAS),
  );
  await warpTo(Number(await a.eventStart()));
  await send(
    a.postAttendance([alice.address, wallet.target], (3n * D) / 2n, GAS),
  );
  const fee = await a.challengeDeposit();
  await send(a.connect(bob).challenge({ value: fee, ...GAS }));
  await send(a.matchChallenge(bob.address, { value: fee, ...GAS }));
  const challenge = await a.challenges(bob.address);
  await send(wallet.setMode(1));
  await warpTo(Number(await a.challengeEndsAt()) + 1);
  await send(a.releasePayouts(GAS));
  assert.equal(await a.heldBack(), D);
  assert.equal(await a.owed(wallet.target), D);
  assert.equal(await a.pendingTotal(), D);
  const before = await state(a, [alice, bob, wallet]);
  await send(s.controller.transferOwnership(pending.address, GAS));
  await send(s.controller.renounceOwnership(GAS));
  assert.deepEqual(await state(a, [alice, bob, wallet]), before);
  assert.equal(await s.controller.pendingOwner(), ethers.ZeroAddress);
  await send(court.giveFinalRuling(challenge.arbitratorDisputeID, 1, GAS));
  const bobBefore = await provider.getBalance(bob.address),
    nonce = await provider.getTransactionCount(bob.address);
  await send(a.resolveChallenge(bob.address, GAS));
  assert.equal(await provider.getBalance(bob.address), bobBefore + D + fee);
  assert.equal(await provider.getTransactionCount(bob.address), nonce);
  await send(
    wallet.exec(
      a.target,
      a.interface.encodeFunctionData("claim", [beneficiary.address]),
      GAS,
    ),
  );
  await send(a.connect(alice).withdrawPending(beneficiary.address, D, GAS));
  assert.equal(await a.reserved(), 0n);
  assert.equal(await provider.getBalance(a.target), 0n);
  assert.equal(await a.owner(), organizer.address);
  assert.equal(await s.controller.upgradesDisabled(), true);
});

test("counterexample: an authorized malicious implementation can bypass a frozen controller despite correct family/schema/version metadata", async () => {
  const s = await setup(),
    a = await child(s, await parameters(10 * DAY)),
    malicious = await deploy("SecurityMaliciousMetadataV10"),
    r3 = await deploy("SecurityEventV10R3");
  await send(a.connect(alice).deposit({ value: D, ...GAS }));
  assert.equal(await malicious.VERSION(), 10n);
  assert.equal(await malicious.UPGRADE_FAMILY(), await a.UPGRADE_FAMILY());
  assert.equal(await malicious.storageSchema(), await a.storageSchema());
  await send(s.controller.upgrade(a.target, malicious.target, "0x", GAS));
  await send(s.controller.renounceOwnership(GAS));
  assert.equal(await s.controller.upgradesDisabled(), true);
  await assert.rejects(
    s.controller
      .connect(outsider)
      .upgrade.staticCall(a.target, r3.target, "0x"),
  );
  const compromised = new ethers.Contract(
    a.target,
    malicious.interface,
    outsider,
  );
  await send(compromised.unguardedInstall(r3.target, GAS));
  assert.equal(
    await slot(a),
    r3.target,
    "the malicious fixture exposes an alternate slot-write path",
  );
  assert.equal(await a.pendingDeposits(alice.address), D);
  assert.equal(await s.controller.upgradesDisabled(), true);
});
