// Read-only, explicit v9 trust verification. Importing this module never opens a wallet.
import fs from "node:fs";
import { ethers } from "ethers";
import { hash, lower, requireThat } from "./utils.mjs";
import { v9RuntimeCode } from "../scripts/mainnet/runtime-code.mjs";
import { verifyV9ArtifactSources } from "./upgrade-artifacts.mjs";

export const UPGRADEABLE_VERSION = "kleros-event-v9-uups";
export const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const MIN_UPGRADE_DELAY = 172800;
const EVENT_FAMILY = ethers.id("kleros.event.v9.uups");
const FACTORY_FAMILY = ethers.id("kleros.factory.v9.uups");
const EVENT_SCHEMA = ethers.id("kleros.event.v9.storage.1");
const FACTORY_SCHEMA = ethers.id("kleros.factory.v9.storage.1");
const check = (ok, message, code = "UPGRADE_TRUST_MISMATCH") =>
  requireThat(ok, message, code, 409);
const address = (value) => ethers.isAddress(value) && lower(value) !== lower(ethers.ZeroAddress);
const bytes32 = (value) => ethers.isHexString(value, 32);
const positiveBlock = (value) => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => lower(a) === lower(b);

export function loadUpgradeableArtifacts() {
  const read = (name) => JSON.parse(fs.readFileSync(new URL(`../build/contracts-v9/${name}.json`, import.meta.url), "utf8"));
  const manifest = read("manifest");
  check(manifest.profile === UPGRADEABLE_VERSION && manifest.version === 9 &&
    manifest.minimumUpgradeDelay === MIN_UPGRADE_DELAY && manifest.openzeppelin === "5.7.0",
  "Unexpected v9 compiler manifest");
  const result = { event: read("KlerosEventV9"), factory: read("KlerosEventFactoryV9"),
    timelock: read("KlerosUpgradeTimelockV9"), proxy: read("ERC1967Proxy") };
  for (const [key, name] of Object.entries({ event: "KlerosEventV9", factory: "KlerosEventFactoryV9",
    timelock: "KlerosUpgradeTimelockV9", proxy: "ERC1967Proxy" })) {
    const a = result[key], expected = manifest.contracts[name];
    check(a.compiler === manifest.compiler && expected &&
      ethers.keccak256(a.bytecode) === expected.creationCodeHash &&
      ethers.keccak256(a.deployedBytecode) === expected.unpatchedRuntimeCodeHash,
    "Compiled v9 artifact differs from its manifest");
  }
  return result;
}

/** Patch only the compiler-declared __self and exact timelock-runtime immutables. */
export function patchImmutableRuntime(artifact, implementation, timelockRuntimeHash) {
  check(address(implementation) && bytes32(timelockRuntimeHash), "Invalid runtime immutable inputs");
  check(ethers.isHexString(artifact.deployedBytecode) &&
    Object.keys(artifact.linkReferences ?? {}).length === 0, "Unlinked implementation artifact");
  const refs = artifact.immutableReferences ?? {}, values = artifact.immutableValues ?? {};
  check(Object.keys(refs).length === 2 && hash(Object.keys(refs).sort()) === hash(Object.keys(values).sort()),
    "Unexpected compiler immutable set");
  const names = Object.values(values).map((value) => value.name);
  check(new Set(names).size === 2 && names.includes("__self") && names.includes("_timelockCodeHash"),
    "Incomplete immutable names");
  try { return v9RuntimeCode(artifact, implementation, timelockRuntimeHash); }
  catch { check(false, "Invalid compiler runtime immutable metadata"); }
}

function validateRegistry(d) {
  check(d?.contractVersion === UPGRADEABLE_VERSION && d.abiVersion === UPGRADEABLE_VERSION && d.chainId === 1,
    "Upgradeable production requires exact v9 and Ethereum chain1", "WRONG_CHAIN");
  for (const name of ["contract", "factory", "creator", "owner", "implementation", "factoryImplementation",
    "initialImplementation", "initialFactoryImplementation", "upgradeAuthority", "projectMultisig", "resolver", "arbitrator"])
    check(address(d[name]), `Missing trusted ${name}`);
  for (const name of ["codeHash", "factoryCodeHash", "implementationCodeHash", "factoryImplementationCodeHash",
    "upgradeAuthorityCodeHash", "deploymentTxHash", "factoryDeploymentTxHash", "timelockDeploymentTxHash",
    "eventKey", "factoryEventId", "configurationHash"])
    check(bytes32(d[name]), `Missing trusted ${name}`);
  for (const name of ["deploymentBlock", "factoryDeploymentBlock", "timelockDeploymentBlock"])
    check(positiveBlock(d[name]), `Missing trusted ${name}`);
  check(same(d.owner, d.creator) && d.eventKey !== ethers.ZeroHash &&
    (d.implementationRevision === undefined || d.implementationRevision === 1) &&
    (d.factoryImplementationRevision === undefined || d.factoryImplementationRevision === 1),
  "Unreviewed initial owner or implementation revision");
  check(new Set([d.contract, d.factory, d.implementation, d.factoryImplementation, d.upgradeAuthority, d.projectMultisig].map(lower)).size === 6,
    "Proxy, implementation and governance identities must be distinct");
}

async function canonicalTransaction(provider, txHash, number, anchors) {
  const [tx, receipt, block] = await Promise.all([
    provider.getTransaction(txHash), provider.getTransactionReceipt(txHash), provider.getBlock(number),
  ]);
  check(tx && receipt?.status === 1 && receipt.blockNumber === number &&
    same(tx.hash, txHash) && same(receipt.hash ?? receipt.transactionHash, txHash) &&
    Number(tx.chainId) === 1 && block?.number === number && bytes32(block.hash) &&
    same(receipt.blockHash, block.hash) && tx.blockNumber === number && same(tx.blockHash, block.hash),
  "Creation transaction is missing, unsuccessful or noncanonical", "DEPLOYMENT_REORG");
  check(!anchors.has(number) || same(anchors.get(number), block.hash),
    "Conflicting creation block anchors", "DEPLOYMENT_REORG");
  anchors.set(number, block.hash);
  return { tx, receipt, block };
}

function parseLogs(receipt, target, iface, name) {
  return receipt.logs.filter((log) => same(log.address, target)).flatMap((log) => {
    try { const parsed = iface.parseLog(log); return parsed?.name === name ? [parsed] : []; }
    catch { return []; }
  });
}

function initialized(receipt, target, iface, implementation) {
  const ups = parseLogs(receipt, target, iface, "Upgraded");
  const inits = parseLogs(receipt, target, iface, "Initialized");
  check(ups.length === 1 && same(ups[0].args.implementation, implementation) &&
    inits.length === 1 && BigInt(inits[0].args.version) === 1n,
  "Proxy constructor did not initialize the reviewed implementation");
}

async function verifyRoles(provider, timelock, d, block, anchors, artifact) {
  const at = { blockTag: block.number };
  const roles = { admin: ethers.ZeroHash, proposer: ethers.id("PROPOSER_ROLE"),
    canceller: ethers.id("CANCELLER_ROLE"), executor: ethers.id("EXECUTOR_ROLE") };
  const desired = new Map([[roles.admin, [d.upgradeAuthority]], [roles.proposer, [d.projectMultisig]],
    [roles.canceller, [d.projectMultisig]], [roles.executor, [ethers.ZeroAddress]]]);
  const grants = new Map([...desired.keys()].map((role) => [role, new Set()]));
  const iface = new ethers.Interface(artifact.abi);
  const scheduled = new Map();
  const topics = ["RoleGranted", "RoleRevoked", "RoleAdminChanged", "CallScheduled", "CallExecuted", "Cancelled"]
    .map((name) => iface.getEvent(name).topicHash);
  let count = 0;
  for (let fromBlock = d.timelockDeploymentBlock; fromBlock <= block.number; fromBlock += 5000) {
    const logs = await provider.getLogs({ address: d.upgradeAuthority, fromBlock,
      toBlock: Math.min(fromBlock + 4999, block.number), topics: [topics] });
    check((count += logs.length) <= 10000, "Governance history exceeds reviewed bounds");
    const ordered = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || (a.index ?? a.logIndex) - (b.index ?? b.logIndex));
    for (const log of ordered) {
      check(same(log.address, d.upgradeAuthority) && !log.removed && log.blockNumber >= fromBlock &&
        log.blockNumber <= Math.min(fromBlock + 4999, block.number) && bytes32(log.blockHash), "Malformed governance log");
      const old = anchors.get(log.blockNumber);
      check(!old || same(old, log.blockHash), "Conflicting governance block anchors", "DEPLOYMENT_REORG");
      anchors.set(log.blockNumber, log.blockHash);
      const p = iface.parseLog(log);
      check(p, "Unrecognized governance log");
      if (p.name === "CallScheduled") {
        scheduled.set(`${p.args.id}:${p.args.index}`, { operationId: p.args.id,
          target: p.args.target, value: p.args.value, data: p.args.data });
        continue;
      }
      if (p.name === "CallExecuted" || p.name === "Cancelled") continue;
      check(grants.has(p.args.role), "Unexpected governance role");
      if (p.name === "RoleAdminChanged") {
        check(p.args.newAdminRole === ethers.ZeroHash, "Governance role administrator changed");
      } else if (p.name === "RoleGranted") grants.get(p.args.role).add(lower(p.args.account));
      else if (p.name === "RoleRevoked") grants.get(p.args.role).delete(lower(p.args.account));
      else check(false, "Unexpected governance log");
    }
  }
  for (const [role, accounts] of desired) {
    check(hash([...grants.get(role)].sort()) === hash(accounts.map(lower).sort()), "Timelock role membership differs from reviewed governance");
    const [adminRole, ...membership] = await Promise.all([
      timelock.getRoleAdmin(role, at), ...accounts.map((account) => timelock.hasRole(role, account, at)),
    ]);
    check(adminRole === ethers.ZeroHash && membership.every(Boolean), "Timelock role state differs from history");
  }
  const upgradeInterface = new ethers.Interface(["function upgradeToAndCall(address newImplementation,bytes data) payable"]);
  const pending = async (target) => {
    const entries = [];
    for (const call of scheduled.values()) {
      if (!same(call.target, target) || !call.data.startsWith(upgradeInterface.getFunction("upgradeToAndCall").selector)) continue;
      const [state, timestamp] = await Promise.all([
        timelock.getOperationState(call.operationId, at), timelock.getTimestamp(call.operationId, at),
      ]);
      check([0n, 1n, 2n, 3n].includes(state), "Unknown timelock operation state");
      if (state === 0n || state === 3n) continue;
      const decoded = upgradeInterface.parseTransaction({ data: call.data, value: call.value });
      check(decoded && address(decoded.args[0]) && call.value === 0n, "Malformed scheduled upgrade");
      check(timestamp > 1n && timestamp <= BigInt(Number.MAX_SAFE_INTEGER) &&
        (state === 1n ? block.timestamp < Number(timestamp) : block.timestamp >= Number(timestamp)),
      "Timelock operation deadline is inconsistent");
      entries.push({ operationId: call.operationId, newImplementation: decoded.args[0],
        eligibleAt: Number(timestamp), status: state === 1n ? "waiting" : "ready" });
    }
    check(entries.length <= 1, "Multiple queued upgrades require an explicit governance review");
    return entries[0] ?? null;
  };
  return { event: await pending(d.contract), factory: await pending(d.factory) };
}

async function verifyInitialUpgradeHistory(provider, d, block, anchors, artifact) {
  const iface = new ethers.Interface(artifact.abi), topic = iface.getEvent("Upgraded").topicHash;
  const expected = new Map([[lower(d.contract), { hash: d.deploymentTxHash, block: d.deploymentBlock, implementation: d.initialImplementation }],
    [lower(d.factory), { hash: d.factoryDeploymentTxHash, block: d.factoryDeploymentBlock, implementation: d.initialFactoryImplementation }]]);
  const seen = new Set();
  for (let fromBlock = Math.min(d.factoryDeploymentBlock, d.deploymentBlock); fromBlock <= block.number; fromBlock += 5000) {
    const logs = await provider.getLogs({ address: [d.contract, d.factory], fromBlock,
      toBlock: Math.min(fromBlock + 4999, block.number), topics: [topic] });
    for (const log of logs) {
      const birth = expected.get(lower(log.address));
      check(birth && !seen.has(lower(log.address)) && !log.removed && log.blockNumber === birth.block &&
        same(log.transactionHash, birth.hash) && same(log.blockHash, anchors.get(birth.block)) &&
        same(iface.parseLog(log)?.args.implementation, birth.implementation),
      "Unreviewed proxy upgrade history; revision1 accepts only constructor initialization", "UNREVIEWED_UPGRADE_HISTORY");
      seen.add(lower(log.address));
    }
  }
  check(seen.size === expected.size, "Incomplete proxy upgrade history", "UNREVIEWED_UPGRADE_HISTORY");
}

/**
 * Verify source-pinned initial v9 deployments at one fresh canonical block.
 * Later revisions need an explicit reviewed artifact update; a proxy code hash alone never suffices.
 * Returns stable metadata suitable for a financial draft fingerprint (no moving head/timestamp).
 */
export async function verifyUpgradeableDeployment(chain, d, { artifacts = loadUpgradeableArtifacts() } = {}) {
  validateRegistry(d);
  if (chain.production) {
    const approved = verifyV9ArtifactSources(chain.manifest?.provenance);
    for (const [key, name] of Object.entries({ event: "KlerosEventV9", factory: "KlerosEventFactoryV9",
      timelock: "KlerosUpgradeTimelockV9", proxy: "ERC1967Proxy" })) {
      const artifact = artifacts[key], expected = approved.contracts[name];
      check(expected && artifact.compiler === approved.compiler &&
        hash(artifact.abi) === expected.abiSha256 &&
        ethers.keccak256(artifact.bytecode) === expected.creationCodeHash &&
        ethers.keccak256(artifact.deployedBytecode) === expected.unpatchedRuntimeCodeHash &&
        hash(artifact.immutableReferences) === hash(expected.immutableReferences) &&
        hash(artifact.immutableValues) === hash(expected.immutableValues) &&
        hash(artifact.storageLayout) === expected.storageLayoutSha256 &&
        Object.keys(artifact.linkReferences ?? {}).length === 0,
      "Artifact metadata differs from the reviewed source-bound build");
    }
  }
  const governance = chain.governance;
  if (chain.production) check(governance?.kind === "project-multisig" &&
    same(governance.multisig, d.projectMultisig) && bytes32(governance.expectedCodeHash) &&
    Number.isSafeInteger(governance.minimumDelaySeconds) && governance.minimumDelaySeconds >= MIN_UPGRADE_DELAY,
  "Production governance is missing or differs from the reviewed manifest", "INVALID_GOVERNANCE");
  const provider = chain.provider;
  check(BigInt(await provider.send("eth_chainId", [])) === 1n, "RPC is not Ethereum mainnet", "WRONG_CHAIN");
  const block = await provider.getBlock("latest");
  check(block && positiveBlock(block.number) && bytes32(block.hash) &&
    Math.max(d.deploymentBlock, d.factoryDeploymentBlock, d.timelockDeploymentBlock) <= block.number,
  "Missing canonical verification head");
  const anchors = new Map([[block.number, block.hash]]), at = { blockTag: block.number };
  const timelockHash = ethers.keccak256(artifacts.timelock.deployedBytecode);
  const proxyHash = ethers.keccak256(artifacts.proxy.deployedBytecode);
  check(same(d.codeHash, proxyHash) && same(d.factoryCodeHash, proxyHash) &&
    same(d.upgradeAuthorityCodeHash, timelockHash), "Registry does not pin the compiled proxy/timelock");
  const expectedRuntime = (artifact, implementation) => patchImmutableRuntime(artifact, implementation, timelockHash);
  const codeTargets = [[d.contract, artifacts.proxy.deployedBytecode], [d.factory, artifacts.proxy.deployedBytecode],
    [d.implementation, expectedRuntime(artifacts.event, d.implementation)],
    [d.factoryImplementation, expectedRuntime(artifacts.factory, d.factoryImplementation)],
    [d.upgradeAuthority, artifacts.timelock.deployedBytecode]];
  const [codes, eventSlot, factorySlot, multisigCode] = await Promise.all([
    Promise.all(codeTargets.map(([target]) => provider.getCode(target, block.number))),
    provider.send("eth_getStorageAt", [d.contract, IMPLEMENTATION_SLOT, ethers.toQuantity(block.number)]),
    provider.send("eth_getStorageAt", [d.factory, IMPLEMENTATION_SLOT, ethers.toQuantity(block.number)]),
    provider.getCode(d.projectMultisig, block.number),
  ]);
  codes.forEach((code, i) => check(same(code, codeTargets[i][1]), "Proxy, implementation or timelock runtime differs from compiled source", "WRONG_CONTRACT"));
  check(bytes32(eventSlot) && bytes32(factorySlot) &&
    same(eventSlot, ethers.zeroPadValue(d.implementation, 32)) &&
    same(factorySlot, ethers.zeroPadValue(d.factoryImplementation, 32)), "ERC1967 implementation changed", "IMPLEMENTATION_CHANGED");
  check(same(ethers.keccak256(codes[2]), d.implementationCodeHash) &&
    same(ethers.keccak256(codes[3]), d.factoryImplementationCodeHash) && multisigCode !== "0x",
  "Implementation pin or project contract is invalid");
  if (chain.production) check(same(ethers.keccak256(multisigCode), governance.expectedCodeHash),
    "Project multisig runtime differs from the reviewed manifest", "INVALID_GOVERNANCE");
  const event = new ethers.Contract(d.contract, artifacts.event.abi, provider);
  const factory = new ethers.Contract(d.factory, artifacts.factory.abi, provider);
  const timelock = new ethers.Contract(d.upgradeAuthority, artifacts.timelock.abi, provider);
  const identities = await Promise.all([...[event, factory].map(async (c) => Promise.all([
    c.VERSION(at), c.UPGRADE_FAMILY(at), c.implementationRevision(at), c.storageSchema(at), c.upgradeAuthority(at),
  ])), event.originatingFactory(at), timelock.MIN_UPGRADE_DELAY(at), timelock.getMinDelay(at)]);
  for (const [i, family, schema] of [[0, EVENT_FAMILY, EVENT_SCHEMA], [1, FACTORY_FAMILY, FACTORY_SCHEMA]]) {
    const [version, actualFamily, revision, actualSchema, authority] = identities[i];
    check(version === 9n && actualFamily === family && revision === 1n && actualSchema === schema &&
      same(authority, d.upgradeAuthority), "Implementation family, schema, revision or authority differs");
  }
  check(same(identities[2], d.factory) && identities[3] === BigInt(MIN_UPGRADE_DELAY) &&
    identities[4] >= BigInt(chain.production ? governance.minimumDelaySeconds : MIN_UPGRADE_DELAY) &&
    identities[4] <= BigInt(Number.MAX_SAFE_INTEGER),
  "Originating factory or upgrade delay is invalid");
  const uuids = await Promise.all([
    new ethers.Contract(d.implementation, artifacts.event.abi, provider).proxiableUUID(at),
    new ethers.Contract(d.factoryImplementation, artifacts.factory.abi, provider).proxiableUUID(at),
  ]);
  check(uuids.every((uuid) => uuid === IMPLEMENTATION_SLOT), "Implementation is not the reviewed UUPS family");
  const pending = await verifyRoles(provider, timelock, d, block, anchors, artifacts.timelock);
  const births = await Promise.all([
    canonicalTransaction(provider, d.timelockDeploymentTxHash, d.timelockDeploymentBlock, anchors),
    canonicalTransaction(provider, d.factoryDeploymentTxHash, d.factoryDeploymentBlock, anchors),
    canonicalTransaction(provider, d.deploymentTxHash, d.deploymentBlock, anchors),
  ]);
  const [governanceBirth, factoryBirth, eventBirth] = births;
  for (const [birth, target, data] of [
    [governanceBirth, d.upgradeAuthority, artifacts.timelock.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address"], [d.projectMultisig]).slice(2)],
    [factoryBirth, d.factory, artifacts.proxy.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"],
      [d.initialFactoryImplementation, factory.interface.encodeFunctionData("initialize", [d.initialImplementation, d.upgradeAuthority])]).slice(2)],
  ]) check(birth.tx.to === null && birth.tx.value === 0n && same(birth.tx.data, data) &&
    same(birth.receipt.contractAddress, target) && same(ethers.getCreateAddress({ from: birth.tx.from, nonce: birth.tx.nonce }), target),
  "Historical constructor/initialization does not match reviewed source");
  initialized(factoryBirth.receipt, d.factory, factory.interface, d.initialFactoryImplementation);
  // Initial implementations are explicit historical pins, never inferred from mutable defaults.
  const historicalCodes = await Promise.all([
    provider.getCode(d.initialImplementation, d.factoryDeploymentBlock),
    provider.getCode(d.initialFactoryImplementation, d.factoryDeploymentBlock),
  ]);
  check(same(historicalCodes[0], expectedRuntime(artifacts.event, d.initialImplementation)) &&
    same(historicalCodes[1], expectedRuntime(artifacts.factory, d.initialFactoryImplementation)), "Historical implementation source is untrusted");
  const template = await event.metaEvidenceTemplate(at);
  const config = { depositAmount: d.depositWei, eventName: d.eventName, eventStart: d.eventStart, claimDeadline: d.claimDeadline,
    arbitration: { disputeResolver: d.resolver, extraData: d.arbitratorExtraData,
      metaEvidenceTemplate: [...template[0]], metaEvidenceSlots: template[1], policyURI: d.policyURI } };
  const configType = "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
  const configurationHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", configType], [d.creator, config]));
  const factoryId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address", "address", "bytes32"], [1, d.factory, d.creator, d.eventKey]));
  check(same(configurationHash, d.configurationHash) && same(factoryId, d.factoryEventId) &&
    same(eventBirth.tx.from, d.creator) && same(eventBirth.tx.to, d.factory) && eventBirth.tx.value === 0n &&
    same(eventBirth.tx.data, factory.interface.encodeFunctionData("createEvent", [d.eventKey, config])),
  "Event creation calldata/identity differs from reviewed configuration");
  const created = parseLogs(eventBirth.receipt, d.factory, factory.interface, "EventCreated");
  check(created.length === 1 && same(created[0].args.eventId, factoryId) && same(created[0].args.creator, d.creator) &&
    same(created[0].args.eventContract, d.contract) && same(created[0].args.eventKey, d.eventKey) &&
    created[0].args.version === 9n && same(created[0].args.configurationHash, configurationHash), "Missing exact factory EventCreated proof");
  initialized(eventBirth.receipt, d.contract, event.interface, d.initialImplementation);
  const actual = await Promise.all([event.depositAmount(at), event.eventName(at), event.eventStart(at), event.claimDeadline(at),
    event.disputeResolver(at), event.arbitrator(at), event.policyURI(at), event.arbitratorExtraData(at), event.metaEvidenceTemplate(at),
    event.CHALLENGE_PERIOD(at), event.MATCH_PERIOD(at), event.MAX_STAKERS(at), factory.isEvent(d.contract, at),
    factory.eventsById(factoryId, at), factory.eventId(d.creator, d.eventKey, at), factory.eventFor(d.creator, d.eventKey, at), factory.proxyCreationCodeHash(at)]);
  check(String(actual[0]) === d.depositWei && actual[1] === d.eventName && Number(actual[2]) === d.eventStart &&
    Number(actual[3]) === d.claimDeadline && same(actual[4], d.resolver) && same(actual[5], d.arbitrator) &&
    actual[6] === d.policyURI && actual[7] === d.arbitratorExtraData && hash([[...actual[8][0]], actual[8][1]]) === d.templateHash &&
    actual[9] === 86400n && actual[10] === 86400n && actual[11] === 150n && actual[12] &&
    same(actual[13], d.contract) && same(actual[14], factoryId) && same(actual[15], d.contract) &&
    same(actual[16], ethers.keccak256(artifacts.proxy.bytecode)), "Current event terms or factory membership differs");
  await verifyInitialUpgradeHistory(provider, d, block, anchors, artifacts.event);
  // Catch a reorg after all slow history/authority reads, before disclosing a positive proof.
  for (const [number, expected] of anchors) if (number !== block.number)
    check(same((await provider.getBlock(number))?.hash, expected),
      "Verification anchor is no longer canonical", "DEPLOYMENT_REORG");
  check(BigInt(await provider.send("eth_chainId", [])) === 1n, "RPC chain changed during verification", "WRONG_CHAIN");
  check(same((await provider.getBlock(block.number))?.hash, block.hash),
    "Verification head is no longer canonical", "DEPLOYMENT_REORG");
  return {
    anchor: { number: block.number, hash: block.hash, timestamp: block.timestamp },
    deploymentTrust: { status: "verified", contractVersion: UPGRADEABLE_VERSION,
      proxyCodeHash: proxyHash, factory: d.factory, factoryCodeHash: proxyHash, configurationHash,
      creationBlockHash: eventBirth.block.hash, factoryCreationBlockHash: factoryBirth.block.hash,
      timelockCreationBlockHash: governanceBirth.block.hash },
    upgrade: { kind: "uups", version: 9, verified: true, pending: pending.event, implementation: d.implementation, implementationCodeHash: d.implementationCodeHash,
      implementationRevision: 1, family: EVENT_FAMILY, storageSchema: EVENT_SCHEMA,
      authority: d.upgradeAuthority, authorityCodeHash: timelockHash, multisig: d.projectMultisig,
      delaySeconds: Number(identities[4]) },
    factoryUpgrade: { kind: "uups", version: 9, verified: true, pending: pending.factory, implementation: d.factoryImplementation, implementationCodeHash: d.factoryImplementationCodeHash,
      implementationRevision: 1, family: FACTORY_FAMILY, storageSchema: FACTORY_SCHEMA,
      authority: d.upgradeAuthority, authorityCodeHash: timelockHash, multisig: d.projectMultisig,
      delaySeconds: Number(identities[4]) },
  };
}
