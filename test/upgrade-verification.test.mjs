// In-process chain1 fixture only. No public RPC, real wallet files or deployment resources.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { IMPLEMENTATION_SLOT, UPGRADEABLE_VERSION, loadUpgradeableArtifacts,
  patchImmutableRuntime, verifyUpgradeableDeployment } from "../src/upgrade-verification.mjs";

const h = (n) => ethers.toBeHex(n, 32);
const changed = (code) => code.slice(0, -2) + (code.endsWith("00") ? "01" : "00");
const send = async (promise) => (await promise).wait();
let rpc, provider, artifacts, d, owner, factory, event, timelock, governance;
const calls = [];
function context(overrides = {}) {
  return { provider: new Proxy(provider, { get(target, key) {
    const value = overrides[key] ?? target[key];
    if (typeof value !== "function") return value;
    return (...args) => { calls.push(key); return value.apply(target, args); };
  } }) };
}
const reject = (code) => (error) => error.code === code;

before(async () => {
  artifacts = loadUpgradeableArtifacts();
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 }, wallet: { totalAccounts: 3, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  owner = await provider.getSigner(0);
  const deploy = async (a, ...args) => {
    const contract = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args, { gasLimit: 16_000_000 });
    await contract.waitForDeployment();
    return contract;
  };
  const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../references/kickback/build/${name}.json`, import.meta.url)));
  governance = await deploy(fixture("TestWallet"));
  timelock = await deploy(artifacts.timelock, governance.target);
  const implementation = await deploy(artifacts.event), factoryImplementation = await deploy(artifacts.factory);
  const born = await deploy(artifacts.proxy, factoryImplementation.target,
    factoryImplementation.interface.encodeFunctionData("initialize", [implementation.target, timelock.target]));
  factory = new ethers.Contract(born.target, artifacts.factory.abi, owner);
  const liquid = await deploy(fixture("MockKlerosLiquid")), resolver = await deploy(fixture("MockArbitrableProxy"), liquid.target);
  const now = (await provider.getBlock("latest")).timestamp;
  const config = { depositAmount: 1000000000000n, eventName: "Synthetic upgrade verification", eventStart: now + 3600,
    claimDeadline: now + 8 * 86400, arbitration: { disputeResolver: resolver.target,
      extraData: ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]),
      metaEvidenceTemplate: ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
      metaEvidenceSlots: "0x010204", policyURI: "https://example.invalid/synthetic-v9-policy" } };
  const key = ethers.id("synthetic-upgrade-verification");
  const receipt = await send(factory.createEvent(key, config, { gasLimit: 8_000_000 }));
  const created = receipt.logs.filter((log) => log.address === factory.target)
    .map((log) => factory.interface.parseLog(log)).find((log) => log?.name === "EventCreated");
  event = new ethers.Contract(created.args.eventContract, artifacts.event.abi, owner);
  const factoryBirth = await born.deploymentTransaction().wait(), timelockBirth = await timelock.deploymentTransaction().wait();
  d = { eventId: "synthetic-v9", contractVersion: UPGRADEABLE_VERSION, abiVersion: UPGRADEABLE_VERSION,
    chainId: 1, contract: event.target, factory: factory.target, creator: owner.address, owner: owner.address,
    implementation: implementation.target, factoryImplementation: factoryImplementation.target,
    initialImplementation: implementation.target, initialFactoryImplementation: factoryImplementation.target,
    implementationRevision: 1, factoryImplementationRevision: 1,
    implementationCodeHash: ethers.keccak256(await provider.getCode(implementation.target)),
    factoryImplementationCodeHash: ethers.keccak256(await provider.getCode(factoryImplementation.target)),
    upgradeAuthority: timelock.target, upgradeAuthorityCodeHash: ethers.keccak256(await provider.getCode(timelock.target)),
    projectMultisig: governance.target, codeHash: ethers.keccak256(await provider.getCode(event.target)),
    factoryCodeHash: ethers.keccak256(await provider.getCode(factory.target)),
    factoryDeploymentTxHash: factoryBirth.hash, factoryDeploymentBlock: factoryBirth.blockNumber,
    timelockDeploymentTxHash: timelockBirth.hash, timelockDeploymentBlock: timelockBirth.blockNumber,
    deploymentTxHash: receipt.hash, deploymentBlock: receipt.blockNumber, eventKey: key,
    factoryEventId: created.args.eventId, configurationHash: created.args.configurationHash,
    depositWei: String(config.depositAmount), eventName: config.eventName, eventStart: config.eventStart,
    claimDeadline: config.claimDeadline, resolver: resolver.target, arbitrator: liquid.target,
    arbitratorExtraData: config.arbitration.extraData, policyURI: config.arbitration.policyURI,
    templateHash: hash([config.arbitration.metaEvidenceTemplate, config.arbitration.metaEvidenceSlots]) };
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });

test("real synthetic chain1 proxies prove source, constructors, init, family, governance and stable metadata", async () => {
  calls.length = 0;
  const result = await verifyUpgradeableDeployment(context(), d);
  assert.equal(result.deploymentTrust.status, "verified");
  assert.equal(result.upgrade.implementation, d.implementation);
  assert.equal(result.upgrade.delaySeconds, 172800);
  assert.equal(result.upgrade.storageSchema, ethers.id("kleros.event.v9.storage.1"));
  assert.equal(result.factoryUpgrade.family, ethers.id("kleros.factory.v9.uups"));
  assert.deepEqual(await verifyUpgradeableDeployment(context(), d), result);
  assert.equal(result.upgrade.pending, null);
  assert.equal(result.upgrade.kind, "uups");
  assert.equal(result.upgrade.verified, true);
  assert.equal((await provider.getBlock(result.anchor.number)).hash, result.anchor.hash);
  assert.ok(!JSON.stringify(result).includes("blockNumber"), "head movement is not financial state");
  assert.ok(calls.every((name) => ["send", "call", "resolveName", "getBlock", "getCode", "getTransaction", "getTransactionReceipt", "getLogs"].includes(name)));
  assert.equal(provider.listenerCount ? await provider.listenerCount("pending") : 0, 0);
});

test("profile, explicit initial identities and immutable metadata reject before provider access", async () => {
  for (const patch of [{ chainId: 10200 }, { contractVersion: "kleros-event-v8" }, { initialImplementation: undefined },
    { projectMultisig: d.factory }, { factoryImplementationRevision: 2 }]) {
    calls.length = 0;
    await assert.rejects(verifyUpgradeableDeployment(context(), { ...d, ...patch }));
    assert.equal(calls.length, 0);
  }
  const artifact = structuredClone(artifacts.event), timelockHash = ethers.keccak256(artifacts.timelock.deployedBytecode);
  const id = Object.keys(artifact.immutableValues)[0];
  artifact.immutableValues[id].name = "unreviewed";
  assert.throws(() => patchImmutableRuntime(artifact, d.implementation, timelockHash));
  assert.equal(ethers.keccak256(patchImmutableRuntime(artifacts.event, d.implementation, timelockHash)), d.implementationCodeHash);
});

test("fresh code, implementation slot, delay, family and revision changes fail closed", async () => {
  await assert.rejects(verifyUpgradeableDeployment(context({ send: async (method, params) =>
    method === "eth_chainId" ? "0x64" : provider.send(method, params) }), d), reject("WRONG_CHAIN"));
  await assert.rejects(verifyUpgradeableDeployment(context({ getCode: async (target, tag) =>
    target === d.implementation ? changed(await provider.getCode(target, tag)) : provider.getCode(target, tag) }), d), reject("WRONG_CONTRACT"));
  await assert.rejects(verifyUpgradeableDeployment(context({ send: async (method, params) =>
    method === "eth_getStorageAt" && params[0] === d.contract ? h(7) : provider.send(method, params) }), d), reject("IMPLEMENTATION_CHANGED"));
  for (const [target, iface, method, output] of [
    [d.upgradeAuthority, timelock.interface, "getMinDelay", [172799]],
    [d.contract, event.interface, "UPGRADE_FAMILY", [ethers.ZeroHash]],
    [d.contract, event.interface, "implementationRevision", [2]],
    [d.implementation, event.interface, "proxiableUUID", [ethers.ZeroHash]],
  ]) await assert.rejects(verifyUpgradeableDeployment(context({ call: async (tx) =>
    tx.to === target && tx.data.startsWith(iface.getFunction(method).selector)
      ? iface.encodeFunctionResult(method, output) : provider.call(tx) }), d));
});

test("source-matching proxy birth still requires exact reviewed initialization and canonical receipt", async () => {
  await assert.rejects(verifyUpgradeableDeployment(context({ getTransaction: async (txHash) => {
    const tx = await provider.getTransaction(txHash);
    return txHash === d.factoryDeploymentTxHash ? { ...tx, data: changed(tx.data) } : tx;
  } }), d));
  await assert.rejects(verifyUpgradeableDeployment(context({ getTransactionReceipt: async (txHash) => {
    const receipt = await provider.getTransactionReceipt(txHash);
    return txHash === d.deploymentTxHash ? { ...receipt, blockHash: h(777) } : receipt;
  } }), d), reject("DEPLOYMENT_REORG"));
  await assert.rejects(verifyUpgradeableDeployment(context(), { ...d, configurationHash: h(5) }));
  await assert.rejects(verifyUpgradeableDeployment(context(), { ...d, initialImplementation: d.creator }));
});

test("extra governance authority is rejected by full canonical role history", async () => {
  const log = timelock.interface.encodeEventLog(timelock.interface.getEvent("RoleGranted"),
    [ethers.ZeroHash, d.creator, d.upgradeAuthority]);
  await assert.rejects(verifyUpgradeableDeployment(context({ getLogs: async (filter) => {
    const logs = await provider.getLogs(filter), block = await provider.getBlock(d.deploymentBlock);
    return [...logs, { ...log, address: d.upgradeAuthority, blockNumber: block.number, blockHash: block.hash,
      index: 999, removed: false }];
  } }), d), /role membership/);
});

test("late verification-head reorg fails even while historical birth anchors remain canonical", async () => {
  const head = await provider.getBlock("latest");
  let pinnedHeadReads = 0;
  await assert.rejects(verifyUpgradeableDeployment(context({ getBlock: async (tag) => {
    const b = await provider.getBlock(tag);
    if (tag === head.number && ++pinnedHeadReads >= 2) return { ...b, hash: h(888) };
    return b;
  } }), d), reject("DEPLOYMENT_REORG"));
});

test("existing child never depends on factory default implementation for future events", async () => {
  const selector = factory.interface.getFunction("eventImplementation").selector;
  const result = await verifyUpgradeableDeployment(context({ call: async (tx) => {
    assert.ok(!(tx.to === d.factory && tx.data.startsWith(selector)), "mutable future-child default is not an existing child trust gate");
    return provider.call(tx);
  } }), d);
  assert.equal(result.upgrade.implementation, d.implementation);
  assert.ok(!Object.hasOwn(result.factoryUpgrade, "eventImplementation"));
});


test("fresh scheduled upgrade notice is verified, canceled operations disappear, and history failure is never false absence", async () => {
  const before = await verifyUpgradeableDeployment(context(), d);
  const candidate = (await provider.getSigner(2)).address;
  const data = event.interface.encodeFunctionData("upgradeToAndCall", [candidate, "0x"]);
  const salt = ethers.id("synthetic-upgrade-notice"), predecessor = ethers.ZeroHash;
  await send(governance.exec(timelock.target, timelock.interface.encodeFunctionData("schedule",
    [d.contract, 0, data, predecessor, salt, 172800]), { gasLimit: 1000000 }));
  const operationId = await timelock.hashOperation(d.contract, 0, data, predecessor, salt);
  const queued = await verifyUpgradeableDeployment(context(), d);
  assert.deepEqual(queued.upgrade.pending, { operationId, newImplementation: candidate,
    eligibleAt: Number(await timelock.getTimestamp(operationId)), status: "waiting" });
  assert.notEqual(hash(queued.upgrade), hash(before.upgrade));
  assert.equal(queued.factoryUpgrade.pending, null);
  await assert.rejects(verifyUpgradeableDeployment(context({ getLogs: async () => { throw Error("Synthetic history unavailable"); } }), d));
  await send(governance.exec(timelock.target, timelock.interface.encodeFunctionData("cancel", [operationId]), { gasLimit: 1000000 }));
  const canceled = await verifyUpgradeableDeployment(context(), d);
  assert.equal(canceled.upgrade.pending, null);
  assert.deepEqual(canceled.upgrade, before.upgrade, "head movement alone is excluded from financial metadata");
});


test("production binds the exact manifest multisig runtime and stricter reviewed delay floor", async () => {
  const provenance = { v9BuildManifestSha256: hash(JSON.parse(fs.readFileSync(new URL("../build/contracts-v9/manifest.json", import.meta.url)))),
    v9StandardInputSha256: hash(JSON.parse(fs.readFileSync(new URL("../build/contracts-v9/standard-input.json", import.meta.url)))) };
  const governance = { kind: "project-multisig", multisig: d.projectMultisig,
    expectedCodeHash: ethers.keccak256(await provider.getCode(d.projectMultisig)), minimumDelaySeconds: 172800 };
  const production = (patch = {}) => ({ ...context(), production: true, manifest: { provenance }, governance: { ...governance, ...patch } });
  assert.equal((await verifyUpgradeableDeployment(production(), d)).upgrade.verified, true);
  for (const patch of [{ expectedCodeHash: h(99) }, { multisig: d.creator }, { kind: "eoa" }, { minimumDelaySeconds: 1 }])
    await assert.rejects(verifyUpgradeableDeployment(production(patch), d), reject("INVALID_GOVERNANCE"));
  await assert.rejects(verifyUpgradeableDeployment(production({ minimumDelaySeconds: 172801 }), d), /upgrade delay/);
  await assert.rejects(verifyUpgradeableDeployment({ ...context(), production: true, manifest: { provenance } }, d), reject("INVALID_GOVERNANCE"));
});

test("unreviewed upgrade-and-return history rejects even when current source, slots and state still match", async () => {
  // A malicious intermediate implementation could bypass the legitimate +1 revision gate.
  // Model only its public logs; current canonical code/storage remain the real known fixture.
  const head = await provider.getBlock("latest"), topic = event.interface.getEvent("Upgraded").topicHash;
  const candidate = (await provider.getSigner(2)).address;
  await assert.rejects(verifyUpgradeableDeployment(context({ getLogs: async (filter) => {
    const logs = await provider.getLogs(filter);
    if (filter.topics?.[0] !== topic) return logs;
    return [...logs, ...[candidate, d.implementation].map((implementation, index) => ({
      ...event.interface.encodeEventLog(event.interface.getEvent("Upgraded"), [implementation]),
      address: d.contract, transactionHash: h(777 + index), blockNumber: head.number,
      blockHash: head.hash, index: 100 + index, removed: false,
    }))];
  } }), d), reject("UNREVIEWED_UPGRADE_HISTORY"));
});
