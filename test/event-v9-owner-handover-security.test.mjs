// Independent adversarial ownership-handover tests. Local synthetic chain only.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { ethers } from "ethers";
import solc from "solc-hardened";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DELAY = 172800;
const DAY = 86400;
const ZERO = ethers.ZeroHash;
const D = ethers.parseEther("0.01");
const GAS = { gasLimit: 6_000_000 };
const SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
import {KlerosEventV9} from "contracts/v9/KlerosEventV9.sol";
interface IHandoverClock {
    function pendingOperationCount() external view returns (uint256);
    function executingOperationCount() external view returns (uint256);
    function cancel(bytes32) external;
    function transferOwnership(address) external;
    function acceptOwnership() external;
}
contract HandoverCounter {
    uint256 public value;
    uint256 public observedDepth;
    uint256 public observedPending;
    error SyntheticFailure();
    function bump() external { value++; }
    function fail() external pure { revert SyntheticFailure(); }
    function observe(address clock) external {
        value++;
        observedDepth = IHandoverClock(clock).executingOperationCount();
        observedPending = IHandoverClock(clock).pendingOperationCount();
    }
}
contract HandoverActor {
    address public immutable controller;
    address public peer;
    bytes32 public operationId;
    bytes public sameOperationExecution;
    uint256 public beforeDepth;
    uint256 public beforePending;
    uint256 public afterDepth;
    uint256 public afterPending;
    bool public nestedOK;
    bytes public nestedError;
    bool private entered;
    error CallbackProbe(uint256 pending, uint256 depth, bool accepted, bytes reason);
    error SyntheticOuterFailure();
    constructor(address account) { controller = account; }
    modifier onlyController() { require(msg.sender == controller, "synthetic controller only"); _; }
    function exec(address target, bytes calldata data) external onlyController returns (bytes memory result) {
        bool ok;
        (ok,result) = target.call(data);
        if (!ok) assembly ("memory-safe") { revert(add(result,32), mload(result)) }
    }
    function configure(bytes32 id, address peer_, bytes calldata execution) external onlyController {
        operationId = id; peer = peer_; sameOperationExecution = execution;
    }
    function acceptViaPeer(address clock) external {
        require(msg.sender == peer, "synthetic peer only");
        IHandoverClock(clock).acceptOwnership();
    }
    function cancelAndProbe(address clock) external {
        require(msg.sender == clock, "scheduled callback only");
        IHandoverClock(clock).cancel(operationId);
        (bool ok, bytes memory reason) = clock.call(abi.encodeCall(IHandoverClock.acceptOwnership, ()));
        revert CallbackProbe(IHandoverClock(clock).pendingOperationCount(),
            IHandoverClock(clock).executingOperationCount(), ok, reason);
    }
    function cancelTransferAndProbe(address clock) external {
        require(msg.sender == clock, "scheduled callback only");
        IHandoverClock(clock).cancel(operationId);
        IHandoverClock(clock).transferOwnership(peer);
        (bool ok, bytes memory reason) = peer.call(abi.encodeCall(this.acceptViaPeer, (clock)));
        revert CallbackProbe(IHandoverClock(clock).pendingOperationCount(),
            IHandoverClock(clock).executingOperationCount(), ok, reason);
    }
    function nested(address clock, bytes calldata execution, bool failAfter) external {
        require(msg.sender == clock, "scheduled callback only");
        beforeDepth = IHandoverClock(clock).executingOperationCount();
        beforePending = IHandoverClock(clock).pendingOperationCount();
        (nestedOK,nestedError) = clock.call(execution);
        afterDepth = IHandoverClock(clock).executingOperationCount();
        afterPending = IHandoverClock(clock).pendingOperationCount();
        if (failAfter) revert SyntheticOuterFailure();
    }
    function reenterSame(address clock) external {
        require(msg.sender == clock, "scheduled callback only");
        if (entered || sameOperationExecution.length == 0) return;
        entered = true;
        (nestedOK,nestedError) = clock.call(sameOperationExecution);
        entered = false;
    }
}
contract HandoverRevision2 is KlerosEventV9 {
    function implementationRevision() public pure override returns (uint256) { return 2; }
}
contract HandoverHostileRevision2 is KlerosEventV9 {
    function implementationRevision() public pure override returns (uint256) { return 2; }
    function drain(address payable recipient) external {
        require(msg.sender == upgradeAuthority());
        (bool ok,) = recipient.call{value: address(this).balance}(""); require(ok);
    }
}
`;

let rpc, provider, owner, nextOwner, other, stranger, alice, bob, compiled;
let serial = 0;
const send = async (pending) => (await pending).wait();
function artifact(name) {
  if (compiled?.[name]) return compiled[name];
  const directory = name.startsWith("Mock")
    ? "references/kickback/build"
    : "build/contracts-v9";
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, directory, `${name}.json`)),
  );
}
function compileFixtures() {
  const input = JSON.parse(
    fs.readFileSync(path.join(ROOT, "build/contracts-v9/standard-input.json")),
  );
  for (const [name, source] of Object.entries(input.sources)) {
    assert.equal(
      source.content,
      fs.readFileSync(
        path.join(
          ROOT,
          name.startsWith("@openzeppelin/") ? "node_modules" : "",
          name,
        ),
        "utf8",
      ),
      name,
    );
  }
  input.sources["HandoverAttackFixtures.sol"] = { content: SOURCE };
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
    "KlerosUpgradeTimelockV9",
    "KlerosEventV9",
    "KlerosEventFactoryV9",
  ]) {
    const c = output.contracts[`contracts/v9/${name}.sol`][name];
    assert.equal(
      `0x${c.evm.bytecode.object}`,
      artifact(name).bytecode,
      `current artifact ${name}`,
    );
  }
  return Object.fromEntries(
    Object.entries(output.contracts["HandoverAttackFixtures.sol"]).map(
      ([name, c]) => [
        name,
        { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` },
      ],
    ),
  );
}
async function deploy(name, args = []) {
  const a = artifact(name);
  const c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(
    ...args,
    { gasLimit: 15_000_000 },
  );
  await c.waitForDeployment();
  return c;
}
async function freshClock(initialOwner = owner.address) {
  return deploy("KlerosUpgradeTimelockV9", [initialOwner]);
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
  assert.ok(timestamp >= (await now()));
  await rpc.request({ method: "evm_setTime", params: [timestamp * 1000] });
  await rpc.request({ method: "evm_mine", params: [] });
  assert.equal(await now(), timestamp);
}
async function counts(clock, pending, executing = 0) {
  assert.equal(await clock.pendingOperationCount(), BigInt(pending));
  assert.equal(await clock.executingOperationCount(), BigInt(executing));
}
function revertData(error) {
  return error.data ?? error.info?.error?.data?.result;
}
async function rejectsAs(pending, c, expected) {
  await assert.rejects(pending, (error) => {
    assert.equal(c.interface.parseError(revertData(error))?.name, expected);
    return true;
  });
}
async function schedule(clock, target, payload, options = {}) {
  const salt = options.salt ?? ethers.id(`handover-operation-${++serial}`);
  const args = [target, 0, payload, options.predecessor ?? ZERO, salt];
  const scheduleArgs = [...args, options.delay ?? DELAY];
  if (options.actor)
    await send(
      options.actor.exec(
        clock.target,
        clock.interface.encodeFunctionData("schedule", scheduleArgs),
        GAS,
      ),
    );
  else
    await send(
      clock.connect(options.by ?? owner).schedule(...scheduleArgs, GAS),
    );
  const id = await clock.hashOperation(...args);
  return { args, id, eta: Number(await clock.getTimestamp(id)), scheduleArgs };
}
async function scheduleBatch(clock, targets, payloads, options = {}) {
  const args = [
    targets,
    targets.map(() => 0),
    payloads,
    ZERO,
    ethers.id(`handover-batch-${++serial}`),
  ];
  await send(
    clock.connect(options.by ?? owner).scheduleBatch(...args, DELAY, GAS),
  );
  const id = await clock.hashOperationBatch(...args);
  return { args, id, eta: Number(await clock.getTimestamp(id)) };
}
const execute = (clock, operation) =>
  send(clock.connect(stranger).execute(...operation.args, GAS));
const executeBatch = (clock, operation) =>
  send(clock.connect(stranger).executeBatch(...operation.args, GAS));
async function roles(clock, account, proposer, canceller) {
  assert.equal(
    await clock.hasRole(await clock.PROPOSER_ROLE(), account),
    proposer,
  );
  assert.equal(
    await clock.hasRole(await clock.CANCELLER_ROLE(), account),
    canceller,
  );
}
async function slot(c) {
  const value = await rpc.request({
    method: "eth_getStorageAt",
    params: [c.target, SLOT, "latest"],
  });
  return ethers.getAddress(`0x${value.slice(-40)}`);
}
async function funds(c) {
  return {
    balance: await provider.getBalance(c.target),
    reserve: await c.reserved(),
    pending: await c.pendingTotal(),
    alice: await c.pendingDeposits(alice.address),
    bob: await c.pendingDeposits(bob.address),
    stakers: [...(await c.stakers())],
    stakerCount: await c.stakerCount(),
    owed: await c.owedTotal(),
    held: await c.heldBack(),
    escrow: await c.challengeEscrow(),
    phase: await c.phase(),
    owner: await c.owner(),
    authority: await c.upgradeAuthority(),
    factory: await c.originatingFactory(),
  };
}

before(async () => {
  compiled = compileFixtures();
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000, timestampIncrement: 0 },
    wallet: { totalAccounts: 8, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  [owner, nextOwner, other, stranger, alice, bob] = await Promise.all(
    Array.from({ length: 6 }, (_, i) => provider.getSigner(i)),
  );
});
after(async () => {
  provider?.destroy();
  await rpc?.disconnect();
});

test("handover validates recipients, revokes replaced/cancelled pending roles and leaves no old-owner authority", async () => {
  const clock = await freshClock();
  await roles(clock, owner.address, true, true);
  assert.equal(await clock.owner(), owner.address);
  assert.equal(
    await clock.hasRole(await clock.DEFAULT_ADMIN_ROLE(), owner.address),
    false,
  );
  assert.equal(
    await clock.hasRole(await clock.DEFAULT_ADMIN_ROLE(), clock.target),
    true,
  );
  assert.equal(
    await clock.hasRole(await clock.EXECUTOR_ROLE(), ethers.ZeroAddress),
    true,
  );
  for (const address of [ethers.ZeroAddress, owner.address, clock.target])
    await rejectsAs(
      clock.transferOwnership.staticCall(address),
      clock,
      "InvalidUpgradeOwner",
    );
  await rejectsAs(
    clock.connect(stranger).transferOwnership.staticCall(nextOwner.address),
    clock,
    "OwnableUnauthorizedAccount",
  );
  await rejectsAs(
    clock.connect(stranger).acceptOwnership.staticCall(),
    clock,
    "OwnableUnauthorizedAccount",
  );
  await rejectsAs(
    clock.cancelOwnershipTransfer.staticCall(),
    clock,
    "NoPendingOwnershipTransfer",
  );
  await send(clock.transferOwnership(nextOwner.address, GAS));
  await roles(clock, nextOwner.address, false, true);
  const target = await deploy("HandoverCounter");
  await assert.rejects(
    clock
      .connect(nextOwner)
      .schedule.staticCall(target.target, 0, "0x", ZERO, ZERO, DELAY),
  );
  await rejectsAs(
    clock.connect(nextOwner).transferOwnership.staticCall(other.address),
    clock,
    "OwnableUnauthorizedAccount",
  );
  await send(clock.transferOwnership(other.address, GAS));
  await roles(clock, nextOwner.address, false, false);
  await roles(clock, other.address, false, true);
  await rejectsAs(
    clock.connect(nextOwner).acceptOwnership.staticCall(),
    clock,
    "OwnableUnauthorizedAccount",
  );
  await rejectsAs(
    clock.connect(stranger).cancelOwnershipTransfer.staticCall(),
    clock,
    "OwnableUnauthorizedAccount",
  );
  await send(clock.cancelOwnershipTransfer(GAS));
  assert.equal(await clock.pendingOwner(), ethers.ZeroAddress);
  await roles(clock, other.address, false, false);
  await rejectsAs(
    clock.connect(other).acceptOwnership.staticCall(),
    clock,
    "OwnableUnauthorizedAccount",
  );
  await send(clock.transferOwnership(nextOwner.address, GAS));
  await send(clock.connect(nextOwner).acceptOwnership(GAS));
  assert.equal(await clock.owner(), nextOwner.address);
  assert.equal(await clock.pendingOwner(), ethers.ZeroAddress);
  await roles(clock, owner.address, false, false);
  await roles(clock, nextOwner.address, true, true);
  await rejectsAs(
    clock.acceptOwnership.staticCall(),
    clock,
    "OwnableUnauthorizedAccount",
  );
  await rejectsAs(
    clock.transferOwnership.staticCall(other.address),
    clock,
    "OwnableUnauthorizedAccount",
  );
  for (const actor of [owner, nextOwner, stranger]) {
    for (const method of ["grantRole", "revokeRole", "renounceRole"])
      await rejectsAs(
        clock
          .connect(actor)
          [method].staticCall(await clock.PROPOSER_ROLE(), stranger.address),
        clock,
        "RoleManagementDisabled",
      );
    await rejectsAs(
      clock.connect(actor).renounceOwnership.staticCall(),
      clock,
      "OwnershipRenunciationDisabled",
    );
  }
  await counts(clock, 0);
});

test("old queued hostile upgrade blocks acceptance until cancelled; new owner upgrades only A after 48h without changing funded A/B", async () => {
  const clock = await freshClock(),
    eventImpl = await deploy("KlerosEventV9"),
    factoryImpl = await deploy("KlerosEventFactoryV9");
  const proxy = await deploy("ERC1967Proxy", [
    factoryImpl.target,
    factoryImpl.interface.encodeFunctionData("initialize", [
      eventImpl.target,
      clock.target,
    ]),
  ]);
  const factory = new ethers.Contract(
    proxy.target,
    artifact("KlerosEventFactoryV9").abi,
    owner,
  );
  const court = await deploy("MockKlerosLiquid"),
    resolver = await deploy("MockArbitrableProxy", [court.target]);
  const start = (await now()) + 20 * DAY;
  const config = {
    depositAmount: D,
    eventName: "Synthetic owner handover",
    eventStart: start,
    claimDeadline: start + 8 * DAY,
    arbitration: [
      resolver.target,
      ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]),
      ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
      "0x010204",
      "/ipfs/SyntheticHandover",
    ],
  };
  const children = [];
  for (const label of ["A", "B"]) {
    const key = ethers.id(`funded-handover-${label}-${++serial}`);
    await send(factory.createEvent(key, config, GAS));
    children.push(
      new ethers.Contract(
        await factory.eventFor(owner.address, key),
        eventImpl.interface,
        owner,
      ),
    );
  }
  const [a, b] = children;
  await send(a.connect(alice).deposit({ value: 2n * D, ...GAS }));
  await send(a.registerStakers([alice.address], GAS));
  await send(b.connect(bob).deposit({ value: D, ...GAS }));
  const beforeA = await funds(a),
    beforeB = await funds(b);
  const hostile = await deploy("HandoverHostileRevision2");
  const queued = await schedule(
    clock,
    a.target,
    a.interface.encodeFunctionData("upgradeToAndCall", [
      hostile.target,
      hostile.interface.encodeFunctionData("drain", [owner.address]),
    ]),
  );
  await send(clock.transferOwnership(nextOwner.address, GAS));
  await rejectsAs(
    clock.connect(nextOwner).acceptOwnership.staticCall(),
    clock,
    "OwnershipTransferBlocked",
  );
  await counts(clock, 1);
  await warpTo(queued.eta);
  await rejectsAs(
    clock.connect(nextOwner).acceptOwnership.staticCall(),
    clock,
    "OwnershipTransferBlocked",
  );
  await send(clock.connect(nextOwner).cancel(queued.id, GAS));
  await counts(clock, 0);
  await send(clock.connect(nextOwner).acceptOwnership(GAS));
  await roles(clock, owner.address, false, false);
  await assert.rejects(clock.schedule.staticCall(...queued.scheduleArgs));
  await assert.rejects(clock.cancel.staticCall(queued.id));
  await warpTo(queued.eta);
  await assert.rejects(execute(clock, queued));
  assert.deepEqual(await funds(a), beforeA);
  assert.deepEqual(await funds(b), beforeB);
  const next = await deploy("HandoverRevision2");
  await assert.rejects(
    a.connect(nextOwner).upgradeToAndCall.staticCall(next.target, "0x"),
  );
  const approved = await schedule(
    clock,
    a.target,
    a.interface.encodeFunctionData("upgradeToAndCall", [next.target, "0x"]),
    { by: nextOwner },
  );
  await warpTo(approved.eta - 1);
  await assert.rejects(clock.execute.staticCall(...approved.args));
  await warpTo(approved.eta);
  await execute(clock, approved);
  assert.equal(await slot(a), next.target);
  assert.equal(await slot(b), eventImpl.target);
  assert.deepEqual(await funds(a), beforeA);
  assert.deepEqual(await funds(b), beforeB);
  assert.equal(await factory.eventCount(), 2n);
  await send(a.connect(alice).withdrawPending(other.address, D, GAS));
  await send(b.connect(bob).withdrawPending(other.address, D, GAS));
  assert.equal(await a.reserved(), D);
  assert.equal(await b.reserved(), 0n);
  await counts(clock, 0);
});

test("operation counts track each nonempty batch once and reject unobservable empty batches without counter changes", async () => {
  const clock = await freshClock(),
    target = await deploy("HandoverCounter"),
    data = target.interface.encodeFunctionData("bump");
  await counts(clock, 0);
  await rejectsAs(
    clock.scheduleBatch.staticCall([], [], [], ZERO, ZERO, DELAY),
    clock,
    "EmptyOperation",
  );
  await assert.rejects(
    send(clock.scheduleBatch([], [], [], ZERO, ZERO, DELAY, GAS)),
  );
  await counts(clock, 0);
  await rejectsAs(
    clock.executeBatch.staticCall([], [], [], ZERO, ZERO),
    clock,
    "EmptyOperation",
  );
  await assert.rejects(send(clock.executeBatch([], [], [], ZERO, ZERO, GAS)));
  await counts(clock, 0);
  const one = await schedule(clock, target.target, data);
  const batch = await scheduleBatch(
    clock,
    [target.target, target.target],
    [data, data],
  );
  await counts(clock, 2);
  await assert.rejects(send(clock.schedule(...one.scheduleArgs, GAS)));
  await assert.rejects(
    send(clock.scheduleBatch([target.target], [], [], ZERO, ZERO, DELAY, GAS)),
  );
  await assert.rejects(execute(clock, one));
  await counts(clock, 2);
  await send(clock.cancel(one.id, GAS));
  await counts(clock, 1);
  await assert.rejects(send(clock.cancel(one.id, GAS)));
  await counts(clock, 1);
  await send(clock.schedule(...one.scheduleArgs, GAS));
  await counts(clock, 2);
  await warpTo(Math.max(one.eta, batch.eta));
  await executeBatch(clock, batch);
  await counts(clock, 1);
  await execute(clock, one);
  await counts(clock, 0);
  assert.equal(await target.value(), 3n);
  await assert.rejects(execute(clock, one));
  await assert.rejects(executeBatch(clock, batch));
  await counts(clock, 0);
  const secondBatch = await scheduleBatch(clock, [target.target], [data]);
  await send(clock.transferOwnership(nextOwner.address, GAS));
  await rejectsAs(
    clock.connect(nextOwner).acceptOwnership.staticCall(),
    clock,
    "OwnershipTransferBlocked",
  );
  await warpTo(secondBatch.eta);
  await executeBatch(clock, secondBatch);
  await counts(clock, 0);
  assert.equal(await clock.isOperationDone(secondBatch.id), true);
  await send(clock.connect(nextOwner).acceptOwnership(GAS));
});

test("pending-owner and current-owner callbacks cannot accept after cancelling the currently executing operation", async () => {
  for (const ownerIsActor of [false, true]) {
    const actor = await deploy("HandoverActor", [owner.address]);
    const peer = await deploy("HandoverActor", [owner.address]);
    const clock = await freshClock(ownerIsActor ? actor.target : owner.address);
    const method = ownerIsActor ? "cancelTransferAndProbe" : "cancelAndProbe";
    const operation = await schedule(
      clock,
      actor.target,
      actor.interface.encodeFunctionData(method, [clock.target]),
      ownerIsActor ? { actor } : {},
    );
    await send(actor.configure(operation.id, peer.target, "0x", GAS));
    await send(peer.configure(ZERO, actor.target, "0x", GAS));
    if (!ownerIsActor) await send(clock.transferOwnership(actor.target, GAS));
    await warpTo(operation.eta);
    await assert.rejects(
      clock.execute.staticCall(...operation.args),
      (error) => {
        const probe = actor.interface.parseError(revertData(error));
        assert.equal(probe.name, "CallbackProbe");
        assert.equal(probe.args.pending, 0n);
        assert.equal(probe.args.depth, 1n);
        assert.equal(probe.args.accepted, false);
        assert.equal(
          clock.interface.parseError(probe.args.reason).name,
          "OwnershipTransferBlocked",
        );
        return true;
      },
    );
    await assert.rejects(execute(clock, operation));
    await counts(clock, 1);
    assert.equal(
      await clock.owner(),
      ownerIsActor ? actor.target : owner.address,
    );
    assert.equal(
      await clock.pendingOwner(),
      ownerIsActor ? ethers.ZeroAddress : actor.target,
    );
    assert.equal(await clock.isOperationReady(operation.id), true);
    if (ownerIsActor)
      await send(
        actor.exec(
          clock.target,
          clock.interface.encodeFunctionData("cancel", [operation.id]),
          GAS,
        ),
      );
    else await send(clock.connect(owner).cancel(operation.id, GAS));
    await counts(clock, 0);
  }
});

test("nested execution preserves execution depth, rolls failed inner calls back and never double-counts one operation", async () => {
  const clock = await freshClock(),
    actor = await deploy("HandoverActor", [owner.address]),
    counter = await deploy("HandoverCounter");
  const inner = await schedule(
    clock,
    counter.target,
    counter.interface.encodeFunctionData("observe", [clock.target]),
  );
  const outer = await schedule(
    clock,
    actor.target,
    actor.interface.encodeFunctionData("nested", [
      clock.target,
      clock.interface.encodeFunctionData("execute", inner.args),
      false,
    ]),
  );
  await warpTo(Math.max(inner.eta, outer.eta));
  await execute(clock, outer);
  await counts(clock, 0);
  assert.equal(await counter.observedDepth(), 2n);
  assert.equal(await counter.observedPending(), 2n);
  assert.equal(await actor.beforeDepth(), 1n);
  assert.equal(await actor.beforePending(), 2n);
  assert.equal(await actor.afterDepth(), 1n);
  assert.equal(await actor.afterPending(), 1n);
  assert.equal(await actor.nestedOK(), true);
  const failedInner = await schedule(
    clock,
    counter.target,
    counter.interface.encodeFunctionData("fail"),
  );
  const swallowingOuter = await schedule(
    clock,
    actor.target,
    actor.interface.encodeFunctionData("nested", [
      clock.target,
      clock.interface.encodeFunctionData("execute", failedInner.args),
      false,
    ]),
  );
  await warpTo(Math.max(failedInner.eta, swallowingOuter.eta));
  await execute(clock, swallowingOuter);
  await counts(clock, 1);
  assert.equal(await actor.nestedOK(), false);
  assert.equal(await actor.afterDepth(), 1n);
  assert.equal(await actor.afterPending(), 2n);
  assert.equal(await clock.isOperationReady(failedInner.id), true);
  await send(clock.cancel(failedInner.id, GAS));
  const recursive = await schedule(
    clock,
    actor.target,
    actor.interface.encodeFunctionData("reenterSame", [clock.target]),
  );
  await send(
    actor.configure(
      recursive.id,
      ethers.ZeroAddress,
      clock.interface.encodeFunctionData("execute", recursive.args),
      GAS,
    ),
  );
  await warpTo(recursive.eta);
  await assert.rejects(execute(clock, recursive));
  await counts(clock, 1);
  assert.equal(await clock.isOperationReady(recursive.id), true);
  await send(actor.configure(recursive.id, ethers.ZeroAddress, "0x", GAS));
  await execute(clock, recursive);
  await counts(clock, 0);
});

test("failed outer operations and batches roll back executed children, target state and handover counters atomically", async () => {
  const clock = await freshClock(),
    actor = await deploy("HandoverActor", [owner.address]),
    counter = await deploy("HandoverCounter");
  const inner = await schedule(
    clock,
    counter.target,
    counter.interface.encodeFunctionData("bump"),
  );
  const outer = await schedule(
    clock,
    actor.target,
    actor.interface.encodeFunctionData("nested", [
      clock.target,
      clock.interface.encodeFunctionData("execute", inner.args),
      true,
    ]),
  );
  const batch = await scheduleBatch(
    clock,
    [counter.target, counter.target],
    [
      counter.interface.encodeFunctionData("bump"),
      counter.interface.encodeFunctionData("fail"),
    ],
  );
  await warpTo(Math.max(inner.eta, outer.eta, batch.eta));
  await assert.rejects(execute(clock, outer));
  await assert.rejects(executeBatch(clock, batch));
  await counts(clock, 3);
  assert.equal(await counter.value(), 0n);
  for (const operation of [inner, outer, batch])
    assert.equal(await clock.isOperationReady(operation.id), true);
  await send(clock.transferOwnership(nextOwner.address, GAS));
  await rejectsAs(
    clock.connect(nextOwner).acceptOwnership.staticCall(),
    clock,
    "OwnershipTransferBlocked",
  );
  for (const operation of [inner, outer, batch])
    await send(clock.connect(nextOwner).cancel(operation.id, GAS));
  await counts(clock, 0);
  await send(clock.connect(nextOwner).acceptOwnership(GAS));
});

test("ownership does not provide a delayed role-management bypass or reduce the 48-hour floor", async () => {
  const clock = await freshClock();
  const proposer = await clock.PROPOSER_ROLE();
  const operations = [];
  for (const [name, args] of [
    ["grantRole", [proposer, other.address]],
    ["revokeRole", [proposer, owner.address]],
    ["renounceRole", [proposer, clock.target]],
    ["updateDelay", [DELAY - 1]],
    ["renounceOwnership", []],
  ])
    operations.push(
      await schedule(
        clock,
        clock.target,
        clock.interface.encodeFunctionData(name, args),
      ),
    );
  await warpTo(Math.max(...operations.map((o) => o.eta)));
  for (const operation of operations) {
    await assert.rejects(execute(clock, operation));
    assert.equal(await clock.isOperationReady(operation.id), true);
  }
  await counts(clock, operations.length);
  assert.equal(await clock.getMinDelay(), BigInt(DELAY));
  await roles(clock, owner.address, true, true);
  await roles(clock, other.address, false, false);
  for (const operation of operations)
    await send(clock.cancel(operation.id, GAS));
  await counts(clock, 0);
});
