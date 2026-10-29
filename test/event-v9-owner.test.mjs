// One deployment wallet and transferable timelock ownership; synthetic local execution only.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import solc from "solc-hardened";
import { ethers } from "ethers";

const DELAY = 172800, ZERO = ethers.ZeroHash, GAS = { gasLimit: 8000000 };
const json = relative => JSON.parse(fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"));
const send = async promise => (await promise).wait();
let rpc, provider, owner, next, other, fixture;
function artifact(name) { return fixture?.[name] ?? json(`build/contracts-v9/${name}.json`); }
async function deploy(name, ...args) {
  const a = artifact(name), c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args, { gasLimit: 16000000 });
  await c.waitForDeployment(); return c;
}
const clock = () => deploy("KlerosUpgradeTimelockV9", owner.address);
async function at(timestamp) { await rpc.request({ method: "evm_setTime", params: [Number(timestamp) * 1000] }); await rpc.request({ method: "evm_mine", params: [] }); }
async function queue(t, target = other.address, data = "0x", salt = ethers.hexlify(ethers.randomBytes(32))) {
  const id = await t.hashOperation(target, 0, data, ZERO, salt);
  await send(t.schedule(target, 0, data, ZERO, salt, DELAY, GAS));
  return { id, target, data, salt, eta: await t.getTimestamp(id) };
}
before(async () => {
  const input = json("build/contracts-v9/standard-input.json");
  input.sources["OwnerFixtures.sol"] = { content: `pragma solidity 0.8.38;
    import {KlerosEventV9} from "contracts/v9/KlerosEventV9.sol";
    import {KlerosEventFactoryV9} from "contracts/v9/KlerosEventFactoryV9.sol";
    contract OwnerEventRevision2 is KlerosEventV9 { function implementationRevision() public pure override returns(uint256){return 2;} }
    contract OwnerFactoryRevision2 is KlerosEventFactoryV9 { function implementationRevision() public pure override returns(uint256){return 2;} }
    contract FutureOwnerContract {
      address public immutable controller;
      constructor(address who){controller=who;}
      function exec(address target, bytes calldata data) external {
        require(msg.sender==controller); (bool ok,bytes memory result)=target.call(data);
        if(!ok)assembly("memory-safe"){revert(add(result,32),mload(result))}
      }
    }` };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.equal((output.errors ?? []).filter(e => e.severity === "error").length, 0);
  fixture = Object.fromEntries(Object.entries(output.contracts["OwnerFixtures.sol"])
    .map(([name, c]) => [name, { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }]));
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60000000, timestampIncrement: 0 }, wallet: { totalAccounts: 5, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  [owner, next, other] = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });

test("one EOA deploys all four contracts and controls event/factory upgrades only after48hours", async () => {
  const firstNonce = await provider.getTransactionCount(owner.address);
  const t = await clock(), event = await deploy("KlerosEventV9"), implementation = await deploy("KlerosEventFactoryV9");
  const proxy = await deploy("ERC1967Proxy", implementation.target,
    implementation.interface.encodeFunctionData("initialize", [event.target, t.target]));
  for (const [i, c] of [t, event, implementation, proxy].entries()) {
    const tx = c.deploymentTransaction(); assert.equal(tx.from, owner.address); assert.equal(tx.nonce, firstNonce + i);
    assert.equal(c.target, ethers.getCreateAddress({ from: owner.address, nonce: firstNonce + i }));
  }
  const f = new ethers.Contract(proxy.target, artifact("KlerosEventFactoryV9").abi, owner);
  assert.equal(await t.owner(), owner.address); assert.equal(await t.pendingOwner(), ethers.ZeroAddress);
  assert.equal(await t.hasRole(await t.PROPOSER_ROLE(), owner.address), true);
  assert.equal(await t.hasRole(await t.CANCELLER_ROLE(), owner.address), true);
  assert.equal(await t.hasRole(await t.DEFAULT_ADMIN_ROLE(), owner.address), false);
  assert.equal(await t.hasRole(await t.DEFAULT_ADMIN_ROLE(), t.target), true);
  assert.equal(await t.hasRole(await t.EXECUTOR_ROLE(), ethers.ZeroAddress), true);
  const futureFactory = await deploy("OwnerFactoryRevision2");
  await assert.rejects(f.upgradeToAndCall.staticCall(futureFactory.target, "0x"));
  const data = f.interface.encodeFunctionData("upgradeToAndCall", [futureFactory.target, "0x"]), op = await queue(t, f.target, data);
  assert.equal(await t.pendingOperationCount(), 1n);
  await at(op.eta - 1n); await assert.rejects(t.execute.staticCall(f.target, 0, data, ZERO, op.salt));
  await at(op.eta); await send(t.connect(other).execute(f.target, 0, data, ZERO, op.salt, GAS));
  assert.equal(await f.implementationRevision(), 2n); assert.equal(await f.eventImplementation(), event.target);
  assert.equal(await t.pendingOperationCount(), 0n); assert.equal(await t.executingOperationCount(), 0n);
});

test("two-step owner handover clears all old operations and removes all old proposal/cancel powers", async () => {
  const t = await clock(), a = await queue(t);
  const targets = [owner.address, other.address], values = [0, 0], payloads = ["0x", "0x"], salt = ethers.id("one-batch-operation");
  const b = await t.hashOperationBatch(targets, values, payloads, ZERO, salt);
  await send(t.scheduleBatch(targets, values, payloads, ZERO, salt, DELAY, GAS));
  assert.equal(await t.pendingOperationCount(), 2n, "a batch counts once");
  await send(t.transferOwnership(next.address, GAS));
  assert.equal(await t.owner(), owner.address); assert.equal(await t.pendingOwner(), next.address);
  assert.equal(await t.hasRole(await t.CANCELLER_ROLE(), next.address), true);
  assert.equal(await t.hasRole(await t.PROPOSER_ROLE(), next.address), false);
  await assert.rejects(t.connect(next).acceptOwnership.staticCall());
  await assert.rejects(t.connect(next).schedule.staticCall(other.address, 0, "0x", ZERO, ZERO, DELAY));
  await send(t.connect(next).cancel(a.id, GAS));
  await assert.rejects(t.connect(next).acceptOwnership.staticCall());
  await send(t.connect(next).cancel(b, GAS)); await send(t.connect(next).acceptOwnership(GAS));
  assert.equal(await t.owner(), next.address); assert.equal(await t.pendingOwner(), ethers.ZeroAddress);
  for (const role of [await t.PROPOSER_ROLE(), await t.CANCELLER_ROLE()]) {
    assert.equal(await t.hasRole(role, owner.address), false); assert.equal(await t.hasRole(role, next.address), true);
  }
  await assert.rejects(t.schedule.staticCall(other.address, 0, "0x", ZERO, ZERO, DELAY));
  await assert.rejects(t.cancelOwnershipTransfer.staticCall());
  const newSalt = ethers.id("new-owner"), data = "0x";
  await send(t.connect(next).schedule(other.address, 0, data, ZERO, newSalt, DELAY, GAS));
  assert.equal(await t.pendingOperationCount(), 1n);
});

test("replace/cancel pending owner revokes its cancellation role; zero/self and renunciation fail", async () => {
  const t = await clock(), op = await queue(t);
  for (const candidate of [ethers.ZeroAddress, owner.address, t.target]) await assert.rejects(t.transferOwnership.staticCall(candidate));
  await send(t.transferOwnership(next.address, GAS)); await send(t.transferOwnership(other.address, GAS));
  assert.equal(await t.hasRole(await t.CANCELLER_ROLE(), next.address), false);
  assert.equal(await t.hasRole(await t.CANCELLER_ROLE(), other.address), true);
  await assert.rejects(t.connect(next).cancel.staticCall(op.id)); await assert.rejects(t.connect(next).acceptOwnership.staticCall());
  await send(t.cancelOwnershipTransfer(GAS)); assert.equal(await t.pendingOwner(), ethers.ZeroAddress);
  assert.equal(await t.hasRole(await t.CANCELLER_ROLE(), other.address), false);
  await assert.rejects(t.renounceOwnership.staticCall());
  await assert.rejects(t.grantRole.staticCall(await t.PROPOSER_ROLE(), other.address));
  await assert.rejects(t.revokeRole.staticCall(await t.PROPOSER_ROLE(), owner.address));
  await assert.rejects(t.renounceRole.staticCall(await t.PROPOSER_ROLE(), owner.address));
  await send(t.cancel(op.id, GAS)); assert.equal(await t.pendingOperationCount(), 0n);
});

test("failed governance execution keeps its queue entry; later ownership can transfer to a contract", async () => {
  const t = await clock(), grant = t.interface.encodeFunctionData("grantRole", [await t.PROPOSER_ROLE(), other.address]);
  const op = await queue(t, t.target, grant); await at(op.eta);
  await assert.rejects(send(t.execute(t.target, 0, grant, ZERO, op.salt, GAS)));
  assert.equal(await t.pendingOperationCount(), 1n); assert.equal(await t.executingOperationCount(), 0n);
  assert.equal(await t.isOperationReady(op.id), true);
  await send(t.cancel(op.id, GAS));
  const future = await deploy("FutureOwnerContract", next.address);
  await send(t.transferOwnership(future.target, GAS));
  await send(future.connect(next).exec(t.target, t.interface.encodeFunctionData("acceptOwnership"), GAS));
  assert.equal(await t.owner(), future.target); assert.equal(await t.pendingOwner(), ethers.ZeroAddress);
  assert.equal(await t.hasRole(await t.PROPOSER_ROLE(), owner.address), false);
  const salt = ethers.id("contract-owner"), data = t.interface.encodeFunctionData("schedule", [other.address, 0, "0x", ZERO, salt, DELAY]);
  await send(future.connect(next).exec(t.target, data, GAS)); assert.equal(await t.pendingOperationCount(), 1n);
});

test("empty batches cannot create history-invisible operations or change queue counters", async () => {
  const t = await clock(), salt = ethers.id("empty-batch"), id = await t.hashOperationBatch([], [], [], ZERO, salt);
  await assert.rejects(t.scheduleBatch.staticCall([], [], [], ZERO, salt, DELAY), error => error.revert?.name === "EmptyOperation");
  await assert.rejects(send(t.scheduleBatch([], [], [], ZERO, salt, DELAY, GAS)));
  await assert.rejects(t.executeBatch.staticCall([], [], [], ZERO, salt), error => error.revert?.name === "EmptyOperation");
  await assert.rejects(send(t.executeBatch([], [], [], ZERO, salt, GAS)));
  assert.equal(await t.isOperation(id), false);
  assert.equal(await t.pendingOperationCount(), 0n); assert.equal(await t.executingOperationCount(), 0n);
  await send(t.transferOwnership(next.address, GAS)); await send(t.connect(next).acceptOwnership(GAS));
  assert.equal(await t.owner(), next.address, "rejected invisible operations cannot block a valid handover");
});
