// Read-only, explicit v9 trust verification. Importing this module never opens a wallet.
import fs from "node:fs";
import { ethers } from "ethers";
import { hash, lower, requireThat } from "./utils.mjs";
import { v9RuntimeCode } from "../scripts/mainnet/runtime-code.mjs";
import { verifyV9ArtifactSources } from "./upgrade-artifacts.mjs";

export const UPGRADEABLE_VERSION = "kleros-event-v9-uups";
export const V9_MAINNET_SCOPE = Object.freeze({
  profile: UPGRADEABLE_VERSION,
  chainId: 1,
});
export const V9_CHIADO_SCOPE = Object.freeze({
  profile: "kleros-event-v9-uups-chiado",
  chainId: 10200,
});
export const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const MIN_UPGRADE_DELAY = 172800;
const EVENT_FAMILY = ethers.id("kleros.event.v9.uups");
const FACTORY_FAMILY = ethers.id("kleros.factory.v9.uups");
const EVENT_SCHEMA = ethers.id("kleros.event.v9.storage.1");
const FACTORY_SCHEMA = ethers.id("kleros.factory.v9.storage.1");
const check = (ok, message, code = "UPGRADE_TRUST_MISMATCH") =>
  requireThat(ok, message, code, 409);
const address = (value) =>
  ethers.isAddress(value) && lower(value) !== lower(ethers.ZeroAddress);
const bytes32 = (value) => ethers.isHexString(value, 32);
const positiveBlock = (value) => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => lower(a) === lower(b);

export function loadUpgradeableArtifacts() {
  const read = (name) =>
    JSON.parse(
      fs.readFileSync(
        new URL(`../build/contracts-v9/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  const manifest = read("manifest");
  check(
    manifest.profile === UPGRADEABLE_VERSION &&
      manifest.version === 9 &&
      manifest.minimumUpgradeDelay === MIN_UPGRADE_DELAY &&
      manifest.openzeppelin === "5.7.0",
    "Unexpected v9 compiler manifest",
  );
  const result = {
    event: read("KlerosEventV9"),
    factory: read("KlerosEventFactoryV9"),
    timelock: read("KlerosUpgradeTimelockV9"),
    proxy: read("ERC1967Proxy"),
  };
  for (const [key, name] of Object.entries({
    event: "KlerosEventV9",
    factory: "KlerosEventFactoryV9",
    timelock: "KlerosUpgradeTimelockV9",
    proxy: "ERC1967Proxy",
  })) {
    const a = result[key],
      expected = manifest.contracts[name];
    check(
      a.compiler === manifest.compiler &&
        expected &&
        ethers.keccak256(a.bytecode) === expected.creationCodeHash &&
        ethers.keccak256(a.deployedBytecode) ===
          expected.unpatchedRuntimeCodeHash,
      "Compiled v9 artifact differs from its manifest",
    );
  }
  return result;
}

/** Patch only the compiler-declared __self and exact timelock-runtime immutables. */
export function patchImmutableRuntime(
  artifact,
  implementation,
  timelockRuntimeHash,
) {
  check(
    address(implementation) && bytes32(timelockRuntimeHash),
    "Invalid runtime immutable inputs",
  );
  check(
    ethers.isHexString(artifact.deployedBytecode) &&
      Object.keys(artifact.linkReferences ?? {}).length === 0,
    "Unlinked implementation artifact",
  );
  const refs = artifact.immutableReferences ?? {},
    values = artifact.immutableValues ?? {};
  check(
    Object.keys(refs).length === 2 &&
      hash(Object.keys(refs).sort()) === hash(Object.keys(values).sort()),
    "Unexpected compiler immutable set",
  );
  const names = Object.values(values).map((value) => value.name);
  check(
    new Set(names).size === 2 &&
      names.includes("__self") &&
      names.includes("_timelockCodeHash"),
    "Incomplete immutable names",
  );
  try {
    return v9RuntimeCode(artifact, implementation, timelockRuntimeHash);
  } catch {
    check(false, "Invalid compiler runtime immutable metadata");
  }
}

function validateRegistry(d, scope) {
  check(
    scope === V9_MAINNET_SCOPE || scope === V9_CHIADO_SCOPE,
    "An exact approved v9 verification scope is required",
    "WRONG_CHAIN",
  );
  check(
    d?.contractVersion === scope.profile &&
      d.abiVersion === scope.profile &&
      d.chainId === scope.chainId,
    "Upgradeable deployment profile differs from its approved chain",
    "WRONG_CHAIN",
  );
  for (const name of [
    "contract",
    "factory",
    "creator",
    "owner",
    "implementation",
    "factoryImplementation",
    "initialImplementation",
    "initialFactoryImplementation",
    "upgradeAuthority",
    "initialUpgradeOwner",
    "resolver",
    "arbitrator",
  ])
    check(address(d[name]), `Missing trusted ${name}`);
  for (const name of [
    "codeHash",
    "factoryCodeHash",
    "implementationCodeHash",
    "factoryImplementationCodeHash",
    "upgradeAuthorityCodeHash",
    "deploymentTxHash",
    "factoryDeploymentTxHash",
    "timelockDeploymentTxHash",
    "eventKey",
    "factoryEventId",
    "configurationHash",
  ])
    check(bytes32(d[name]), `Missing trusted ${name}`);
  for (const name of [
    "deploymentBlock",
    "factoryDeploymentBlock",
    "timelockDeploymentBlock",
  ])
    check(positiveBlock(d[name]), `Missing trusted ${name}`);
  check(
    same(d.owner, d.creator) &&
      d.eventKey !== ethers.ZeroHash &&
      (d.implementationRevision === undefined ||
        d.implementationRevision === 1) &&
      (d.factoryImplementationRevision === undefined ||
        d.factoryImplementationRevision === 1),
    "Unreviewed initial owner or implementation revision",
  );
  check(
    !Object.hasOwn(d, "projectMultisig"),
    "Legacy multisig governance is not the reviewed single-owner timelock",
  );
  check(
    new Set(
      [
        d.contract,
        d.factory,
        d.implementation,
        d.factoryImplementation,
        d.upgradeAuthority,
        d.initialUpgradeOwner,
      ].map(lower),
    ).size === 6,
    "Proxy, implementation and governance identities must be distinct",
  );
}

async function canonicalTransaction(provider, txHash, number, anchors, scope) {
  const [tx, receipt, block] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
    provider.getBlock(number),
  ]);
  check(
    tx &&
      receipt?.status === 1 &&
      receipt.blockNumber === number &&
      same(tx.hash, txHash) &&
      same(receipt.hash ?? receipt.transactionHash, txHash) &&
      Number(tx.chainId) === scope.chainId &&
      block?.number === number &&
      bytes32(block.hash) &&
      same(receipt.blockHash, block.hash) &&
      tx.blockNumber === number &&
      same(tx.blockHash, block.hash),
    "Creation transaction is missing, unsuccessful or noncanonical",
    "DEPLOYMENT_REORG",
  );
  check(
    !anchors.has(number) || same(anchors.get(number), block.hash),
    "Conflicting creation block anchors",
    "DEPLOYMENT_REORG",
  );
  anchors.set(number, block.hash);
  return { tx, receipt, block };
}

function parseLogs(receipt, target, iface, name) {
  return receipt.logs
    .filter((log) => same(log.address, target))
    .flatMap((log) => {
      try {
        const parsed = iface.parseLog(log);
        return parsed?.name === name ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function initialized(receipt, target, iface, implementation) {
  const ups = parseLogs(receipt, target, iface, "Upgraded");
  const inits = parseLogs(receipt, target, iface, "Initialized");
  check(
    ups.length === 1 &&
      same(ups[0].args.implementation, implementation) &&
      inits.length === 1 &&
      BigInt(inits[0].args.version) === 1n,
    "Proxy constructor did not initialize the reviewed implementation",
  );
}

async function verifyRoles(provider, timelock, d, block, anchors, artifact) {
  const at = { blockTag: block.number };
  const roles = {
    admin: ethers.ZeroHash,
    proposer: ethers.id("PROPOSER_ROLE"),
    canceller: ethers.id("CANCELLER_ROLE"),
    executor: ethers.id("EXECUTOR_ROLE"),
  };
  const grants = new Map(Object.values(roles).map((role) => [role, new Set()]));
  const observed = new Map(
    Object.values(roles).map((role) => [role, new Set()]),
  );
  const iface = new ethers.Interface(artifact.abi);
  const topics = [
    "RoleGranted",
    "RoleRevoked",
    "RoleAdminChanged",
    "OwnershipTransferred",
    "OwnershipTransferStarted",
    "CallScheduled",
    "CallSalt",
    "CallExecuted",
    "Cancelled",
  ].map((name) => iface.getEvent(name).topicHash);
  const operations = new Map(),
    cycles = [],
    active = new Set(),
    seenLogs = new Set();
  const ownersSeen = new Set(
    [d.initialUpgradeOwner, d.upgradeAuthority, ethers.ZeroAddress].map(lower),
  );
  const headers = new Map([[block.number, block]]);
  let owner = null,
    pendingOwner = null,
    count = 0;
  const headerAt = async (number) => {
    if (!headers.has(number))
      headers.set(number, await provider.getBlock(number));
    const header = headers.get(number);
    check(
      header?.number === number &&
        Number.isSafeInteger(header.timestamp) &&
        header.timestamp >= 0 &&
        same(header.hash, anchors.get(number)),
      "Governance block is not canonical",
      "DEPLOYMENT_REORG",
    );
    return header;
  };
  for (
    let fromBlock = d.timelockDeploymentBlock;
    fromBlock <= block.number;
    fromBlock += 5000
  ) {
    const end = Math.min(fromBlock + 4999, block.number);
    const logs = await provider.getLogs({
      address: d.upgradeAuthority,
      fromBlock,
      toBlock: end,
      topics: [topics],
    });
    check(
      (count += logs.length) <= 10000,
      "Governance history exceeds reviewed bounds",
    );
    const ordered = [...logs].sort(
      (a, b) =>
        a.blockNumber - b.blockNumber ||
        (a.index ?? a.logIndex) - (b.index ?? b.logIndex),
    );
    for (const log of ordered) {
      const index = log.index ?? log.logIndex,
        key = `${log.blockNumber}:${index}`;
      check(
        same(log.address, d.upgradeAuthority) &&
          !log.removed &&
          positiveBlock(log.blockNumber) &&
          log.blockNumber >= fromBlock &&
          log.blockNumber <= end &&
          bytes32(log.blockHash) &&
          bytes32(log.transactionHash) &&
          Number.isSafeInteger(index) &&
          index >= 0 &&
          !seenLogs.has(key),
        "Malformed or duplicate governance log",
      );
      seenLogs.add(key);
      const previousHash = anchors.get(log.blockNumber);
      check(
        !previousHash || same(previousHash, log.blockHash),
        "Conflicting governance block anchors",
        "DEPLOYMENT_REORG",
      );
      anchors.set(log.blockNumber, log.blockHash);
      const p = iface.parseLog(log);
      check(p, "Unrecognized governance log");
      if (p.name === "OwnershipTransferred") {
        check(
          address(p.args.newOwner) &&
            !same(p.args.newOwner, d.upgradeAuthority),
          "Invalid timelock owner",
        );
        if (owner === null) {
          check(
            same(p.args.previousOwner, ethers.ZeroAddress) &&
              same(p.args.newOwner, d.initialUpgradeOwner) &&
              log.blockNumber === d.timelockDeploymentBlock &&
              same(log.transactionHash, d.timelockDeploymentTxHash),
            "Initial upgrade owner differs from constructor history",
          );
        } else {
          check(
            same(p.args.previousOwner, owner) &&
              pendingOwner &&
              same(p.args.newOwner, pendingOwner) &&
              active.size === 0,
            "Ownership acceptance requires the proposed owner and an empty operation queue",
          );
        }
        owner = p.args.newOwner;
        pendingOwner = null;
        continue;
      }
      if (p.name === "OwnershipTransferStarted") {
        check(
          owner && same(p.args.previousOwner, owner),
          "Ownership proposal differs from the current owner",
        );
        if (same(p.args.newOwner, ethers.ZeroAddress)) {
          check(
            pendingOwner !== null,
            "No ownership proposal exists to cancel",
          );
          pendingOwner = null;
        } else {
          check(
            address(p.args.newOwner) &&
              !same(p.args.newOwner, owner) &&
              !same(p.args.newOwner, d.upgradeAuthority),
            "Invalid pending upgrade owner",
          );
          pendingOwner = p.args.newOwner;
          ownersSeen.add(lower(pendingOwner));
        }
        continue;
      }
      if (p.name === "CallScheduled") {
        const id = lower(p.args.id),
          callIndex = Number(p.args.index);
        let operation = operations.get(id);
        if (callIndex === 0) {
          check(
            !operation || operation.status === "canceled",
            "Operation was scheduled twice without cancellation",
          );
          check(
            p.args.delay >= BigInt(MIN_UPGRADE_DELAY),
            "Scheduled delay is below the permanent floor",
          );
          operation = {
            id: p.args.id,
            calls: [],
            predecessor: p.args.predecessor,
            delay: p.args.delay,
            salt: ethers.ZeroHash,
            saltSeen: false,
            scheduleBlock: log.blockNumber,
            scheduleHash: log.transactionHash,
            status: "pending",
            executed: new Set(),
            executionHash: null,
          };
          operations.set(id, operation);
          cycles.push(operation);
          active.add(id);
        }
        check(
          operation?.status === "pending" &&
            operation.scheduleBlock === log.blockNumber &&
            same(operation.scheduleHash, log.transactionHash) &&
            callIndex === operation.calls.length &&
            callIndex < 10000 &&
            operation.predecessor === p.args.predecessor &&
            operation.delay === p.args.delay &&
            !operation.saltSeen,
          "Incomplete or inconsistent scheduled operation",
        );
        operation.calls.push({
          target: p.args.target,
          value: p.args.value,
          data: p.args.data,
        });
        continue;
      }
      if (p.name === "CallSalt") {
        const operation = operations.get(lower(p.args.id));
        check(
          operation?.status === "pending" &&
            operation.calls.length > 0 &&
            !operation.saltSeen &&
            operation.scheduleBlock === log.blockNumber &&
            same(operation.scheduleHash, log.transactionHash) &&
            p.args.salt !== ethers.ZeroHash,
          "Missing or duplicate scheduled operation salt",
        );
        operation.salt = p.args.salt;
        operation.saltSeen = true;
        continue;
      }
      if (p.name === "CallExecuted") {
        const id = lower(p.args.id),
          operation = operations.get(id),
          callIndex = Number(p.args.index);
        const call = operation?.calls[callIndex];
        check(
          operation?.status === "pending" &&
            call &&
            !operation.executed.has(callIndex) &&
            same(call.target, p.args.target) &&
            call.value === p.args.value &&
            same(call.data, p.args.data) &&
            (!operation.executionHash ||
              same(operation.executionHash, log.transactionHash)),
          "Execution differs from the complete scheduled operation",
        );
        const scheduledAt = await headerAt(operation.scheduleBlock),
          executedAt = await headerAt(log.blockNumber);
        check(
          BigInt(executedAt.timestamp) >=
            BigInt(scheduledAt.timestamp) + operation.delay,
          "Operation execution predates its timelock",
        );
        if (operation.predecessor !== ethers.ZeroHash)
          check(
            operations.get(lower(operation.predecessor))?.status === "done",
            "Operation predecessor is not executed",
          );
        operation.executionHash = log.transactionHash;
        operation.executed.add(callIndex);
        if (operation.executed.size === operation.calls.length) {
          operation.status = "done";
          active.delete(id);
        }
        continue;
      }
      if (p.name === "Cancelled") {
        const id = lower(p.args.id),
          operation = operations.get(id);
        check(
          operation?.status === "pending" && operation.executed.size === 0,
          "Cancellation has no complete pending scheduling history",
        );
        operation.status = "canceled";
        active.delete(id);
        continue;
      }
      check(grants.has(p.args.role), "Unexpected governance role");
      if (p.name === "RoleAdminChanged") {
        check(
          p.args.previousAdminRole === ethers.ZeroHash &&
            p.args.newAdminRole === ethers.ZeroHash,
          "Governance role administrator changed",
        );
        continue;
      }
      const account = lower(p.args.account),
        role = p.args.role;
      const currentOwner = owner ?? d.initialUpgradeOwner;
      const allowed =
        role === roles.admin
          ? same(account, d.upgradeAuthority)
          : role === roles.executor
            ? same(account, ethers.ZeroAddress)
            : role === roles.proposer
              ? same(account, currentOwner)
              : same(account, currentOwner) ||
                (pendingOwner !== null && same(account, pendingOwner));
      check(allowed, "Unexpected governance role holder");
      observed.get(role).add(account);
      if (p.name === "RoleGranted") {
        check(
          !grants.get(role).has(account),
          "Duplicate governance role grant",
        );
        grants.get(role).add(account);
      } else {
        check(
          p.name === "RoleRevoked" &&
            role !== roles.admin &&
            role !== roles.executor &&
            grants.get(role).has(account),
          "Unexpected governance role revocation",
        );
        grants.get(role).delete(account);
      }
    }
  }
  check(owner !== null, "Initial ownership history is missing");
  const desired = new Map([
    [roles.admin, [d.upgradeAuthority]],
    [roles.proposer, [owner]],
    [roles.canceller, pendingOwner ? [owner, pendingOwner] : [owner]],
    [roles.executor, [ethers.ZeroAddress]],
  ]);
  for (const [role, accounts] of desired) {
    const expected = new Set(accounts.map(lower));
    check(
      hash([...grants.get(role)].sort()) === hash([...expected].sort()),
      "Timelock role membership differs from owner history",
    );
    const seen = [
      ...new Set([...observed.get(role), ...expected, ...ownersSeen]),
    ];
    const [adminRole, ...membership] = await Promise.all([
      timelock.getRoleAdmin(role, at),
      ...seen.map((account) => timelock.hasRole(role, account, at)),
    ]);
    check(
      adminRole === ethers.ZeroHash &&
        membership.every((member, i) => member === expected.has(seen[i])),
      "Timelock role state differs from history",
    );
  }
  const [actualOwner, actualPendingOwner, pendingCount, executingCount] =
    await Promise.all([
      timelock.owner(at),
      timelock.pendingOwner(at),
      timelock.pendingOperationCount(at),
      timelock.executingOperationCount(at),
    ]);
  check(
    same(actualOwner, owner) &&
      same(actualPendingOwner, pendingOwner ?? ethers.ZeroAddress) &&
      pendingCount === BigInt(active.size) &&
      executingCount === 0n,
    "Owner, pending owner or operation counts differ from complete history",
  );

  for (const operation of cycles) {
    const calls = operation.calls,
      predecessor = operation.predecessor,
      salt = operation.salt;
    const single =
      calls.length === 1
        ? ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["address", "uint256", "bytes", "bytes32", "bytes32"],
              [
                calls[0].target,
                calls[0].value,
                calls[0].data,
                predecessor,
                salt,
              ],
            ),
          )
        : null;
    const batch = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address[]", "uint256[]", "bytes[]", "bytes32", "bytes32"],
        [
          calls.map((call) => call.target),
          calls.map((call) => call.value),
          calls.map((call) => call.data),
          predecessor,
          salt,
        ],
      ),
    );
    check(
      operation.id === single || operation.id === batch,
      "Operation hash does not match its complete scheduling history",
    );
  }
  const pendingCalls = [];
  for (const operation of operations.values()) {
    const [state, timestamp] = await Promise.all([
      timelock.getOperationState(operation.id, at),
      timelock.getTimestamp(operation.id, at),
    ]);
    if (operation.status === "pending") {
      const scheduledAt = await headerAt(operation.scheduleBlock);
      check(
        (state === 1n || state === 2n) &&
          timestamp === BigInt(scheduledAt.timestamp) + operation.delay &&
          timestamp > 1n &&
          timestamp <= BigInt(Number.MAX_SAFE_INTEGER) &&
          (state === 1n
            ? block.timestamp < Number(timestamp)
            : block.timestamp >= Number(timestamp)),
        "Pending operation state or deadline differs from history",
      );
      for (const call of operation.calls)
        pendingCalls.push({
          ...call,
          operationId: operation.id,
          eligibleAt: Number(timestamp),
          status: state === 1n ? "waiting" : "ready",
        });
    } else
      check(
        (operation.status === "done" && state === 3n && timestamp === 1n) ||
          (operation.status === "canceled" && state === 0n && timestamp === 0n),
        "Final operation state differs from history",
      );
  }
  const upgradeInterface = new ethers.Interface([
    "function upgradeToAndCall(address newImplementation,bytes data) payable",
  ]);
  const pending = (target) => {
    const entries = [];
    for (const call of pendingCalls) {
      if (
        !same(call.target, target) ||
        !call.data.startsWith(
          upgradeInterface.getFunction("upgradeToAndCall").selector,
        )
      )
        continue;
      let decoded;
      try {
        decoded = upgradeInterface.parseTransaction({
          data: call.data,
          value: call.value,
        });
      } catch {
        check(false, "Malformed scheduled upgrade");
      }
      check(
        decoded && address(decoded.args[0]) && call.value === 0n,
        "Malformed scheduled upgrade",
      );
      entries.push({
        operationId: call.operationId,
        newImplementation: decoded.args[0],
        eligibleAt: call.eligibleAt,
        status: call.status,
      });
    }
    check(
      entries.length <= 1,
      "Multiple queued upgrades require an explicit governance review",
    );
    return entries[0] ?? null;
  };
  return {
    event: pending(d.contract),
    factory: pending(d.factory),
    owner,
    pendingOwner,
    pendingOperationCount: Number(pendingCount),
    executingOperationCount: 0,
  };
}

async function verifyInitialUpgradeHistory(
  provider,
  d,
  block,
  anchors,
  artifact,
) {
  const iface = new ethers.Interface(artifact.abi),
    topic = iface.getEvent("Upgraded").topicHash;
  const expected = new Map([
    [
      lower(d.contract),
      {
        hash: d.deploymentTxHash,
        block: d.deploymentBlock,
        implementation: d.initialImplementation,
      },
    ],
    [
      lower(d.factory),
      {
        hash: d.factoryDeploymentTxHash,
        block: d.factoryDeploymentBlock,
        implementation: d.initialFactoryImplementation,
      },
    ],
  ]);
  const seen = new Set();
  for (
    let fromBlock = Math.min(d.factoryDeploymentBlock, d.deploymentBlock);
    fromBlock <= block.number;
    fromBlock += 5000
  ) {
    const logs = await provider.getLogs({
      address: [d.contract, d.factory],
      fromBlock,
      toBlock: Math.min(fromBlock + 4999, block.number),
      topics: [topic],
    });
    for (const log of logs) {
      const birth = expected.get(lower(log.address));
      check(
        birth &&
          !seen.has(lower(log.address)) &&
          !log.removed &&
          log.blockNumber === birth.block &&
          same(log.transactionHash, birth.hash) &&
          same(log.blockHash, anchors.get(birth.block)) &&
          same(iface.parseLog(log)?.args.implementation, birth.implementation),
        "Unreviewed proxy upgrade history; revision1 accepts only constructor initialization",
        "UNREVIEWED_UPGRADE_HISTORY",
      );
      seen.add(lower(log.address));
    }
  }
  check(
    seen.size === expected.size,
    "Incomplete proxy upgrade history",
    "UNREVIEWED_UPGRADE_HISTORY",
  );
}

function verifySourceArtifacts(chain, artifacts) {
  const approved = verifyV9ArtifactSources(chain.manifest?.provenance);
  for (const [key, name] of Object.entries({
    event: "KlerosEventV9",
    factory: "KlerosEventFactoryV9",
    timelock: "KlerosUpgradeTimelockV9",
    proxy: "ERC1967Proxy",
  })) {
    const artifact = artifacts[key],
      expected = approved.contracts[name];
    check(
      expected &&
        artifact.compiler === approved.compiler &&
        hash(artifact.abi) === expected.abiSha256 &&
        ethers.keccak256(artifact.bytecode) === expected.creationCodeHash &&
        ethers.keccak256(artifact.deployedBytecode) ===
          expected.unpatchedRuntimeCodeHash &&
        hash(artifact.immutableReferences) ===
          hash(expected.immutableReferences) &&
        hash(artifact.immutableValues) === hash(expected.immutableValues) &&
        hash(artifact.storageLayout) === expected.storageLayoutSha256 &&
        Object.keys(artifact.linkReferences ?? {}).length === 0,
      "Artifact metadata differs from the reviewed source-bound build",
    );
  }
}

function reviewedGovernance(chain, d) {
  const governance = chain.governance;
  check(
    governance?.kind === "single-owner-timelock" &&
      same(governance.initialOwner, d.initialUpgradeOwner) &&
      Number.isSafeInteger(governance.minimumDelaySeconds) &&
      governance.minimumDelaySeconds >= MIN_UPGRADE_DELAY,
    "Single-owner governance is missing or differs from the reviewed historical owner",
    "INVALID_GOVERNANCE",
  );
  return governance;
}

/**
 * Verify source-pinned initial v9 deployments at one fresh canonical block.
 * Later revisions need an explicit reviewed artifact update; a proxy code hash alone never suffices.
 * Returns stable metadata suitable for a financial draft fingerprint (no moving head/timestamp).
 */
export async function verifyV9Deployment(
  chain,
  d,
  scope,
  { artifacts = loadUpgradeableArtifacts() } = {},
) {
  validateRegistry(d, scope);
  verifySourceArtifacts(chain, artifacts);
  const governance = reviewedGovernance(chain, d);
  const provider = chain.provider;
  check(
    BigInt(await provider.send("eth_chainId", [])) === BigInt(scope.chainId),
    "RPC differs from the approved chain",
    "WRONG_CHAIN",
  );
  const block = await provider.getBlock("latest");
  check(
    block &&
      positiveBlock(block.number) &&
      bytes32(block.hash) &&
      Math.max(
        d.deploymentBlock,
        d.factoryDeploymentBlock,
        d.timelockDeploymentBlock,
      ) <= block.number,
    "Missing canonical verification head",
  );
  const anchors = new Map([[block.number, block.hash]]),
    at = { blockTag: block.number };
  const timelockHash = ethers.keccak256(artifacts.timelock.deployedBytecode);
  const proxyHash = ethers.keccak256(artifacts.proxy.deployedBytecode);
  check(
    same(d.codeHash, proxyHash) &&
      same(d.factoryCodeHash, proxyHash) &&
      same(d.upgradeAuthorityCodeHash, timelockHash),
    "Registry does not pin the compiled proxy/timelock",
  );
  const expectedRuntime = (artifact, implementation) =>
    patchImmutableRuntime(artifact, implementation, timelockHash);
  const codeTargets = [
    [d.contract, artifacts.proxy.deployedBytecode],
    [d.factory, artifacts.proxy.deployedBytecode],
    [d.implementation, expectedRuntime(artifacts.event, d.implementation)],
    [
      d.factoryImplementation,
      expectedRuntime(artifacts.factory, d.factoryImplementation),
    ],
    [d.upgradeAuthority, artifacts.timelock.deployedBytecode],
  ];
  const [codes, eventSlot, factorySlot] = await Promise.all([
    Promise.all(
      codeTargets.map(([target]) => provider.getCode(target, block.number)),
    ),
    provider.send("eth_getStorageAt", [
      d.contract,
      IMPLEMENTATION_SLOT,
      ethers.toQuantity(block.number),
    ]),
    provider.send("eth_getStorageAt", [
      d.factory,
      IMPLEMENTATION_SLOT,
      ethers.toQuantity(block.number),
    ]),
  ]);
  codes.forEach((code, i) =>
    check(
      same(code, codeTargets[i][1]),
      "Proxy, implementation or timelock runtime differs from compiled source",
      "WRONG_CONTRACT",
    ),
  );
  check(
    bytes32(eventSlot) &&
      bytes32(factorySlot) &&
      same(eventSlot, ethers.zeroPadValue(d.implementation, 32)) &&
      same(factorySlot, ethers.zeroPadValue(d.factoryImplementation, 32)),
    "ERC1967 implementation changed",
    "IMPLEMENTATION_CHANGED",
  );
  check(
    same(ethers.keccak256(codes[2]), d.implementationCodeHash) &&
      same(ethers.keccak256(codes[3]), d.factoryImplementationCodeHash),
    "Implementation pin is invalid",
  );
  const event = new ethers.Contract(d.contract, artifacts.event.abi, provider);
  const factory = new ethers.Contract(
    d.factory,
    artifacts.factory.abi,
    provider,
  );
  const timelock = new ethers.Contract(
    d.upgradeAuthority,
    artifacts.timelock.abi,
    provider,
  );
  const identities = await Promise.all([
    ...[event, factory].map(async (c) =>
      Promise.all([
        c.VERSION(at),
        c.UPGRADE_FAMILY(at),
        c.implementationRevision(at),
        c.storageSchema(at),
        c.upgradeAuthority(at),
      ]),
    ),
    event.originatingFactory(at),
    timelock.MIN_UPGRADE_DELAY(at),
    timelock.getMinDelay(at),
  ]);
  for (const [i, family, schema] of [
    [0, EVENT_FAMILY, EVENT_SCHEMA],
    [1, FACTORY_FAMILY, FACTORY_SCHEMA],
  ]) {
    const [version, actualFamily, revision, actualSchema, authority] =
      identities[i];
    check(
      version === 9n &&
        actualFamily === family &&
        revision === 1n &&
        actualSchema === schema &&
        same(authority, d.upgradeAuthority),
      "Implementation family, schema, revision or authority differs",
    );
  }
  check(
    same(identities[2], d.factory) &&
      identities[3] === BigInt(MIN_UPGRADE_DELAY) &&
      identities[4] >= BigInt(governance.minimumDelaySeconds) &&
      identities[4] <= BigInt(Number.MAX_SAFE_INTEGER),
    "Originating factory or upgrade delay is invalid",
  );
  const uuids = await Promise.all([
    new ethers.Contract(
      d.implementation,
      artifacts.event.abi,
      provider,
    ).proxiableUUID(at),
    new ethers.Contract(
      d.factoryImplementation,
      artifacts.factory.abi,
      provider,
    ).proxiableUUID(at),
  ]);
  check(
    uuids.every((uuid) => uuid === IMPLEMENTATION_SLOT),
    "Implementation is not the reviewed UUPS family",
  );
  const pending = await verifyRoles(
    provider,
    timelock,
    d,
    block,
    anchors,
    artifacts.timelock,
  );
  const births = await Promise.all([
    canonicalTransaction(
      provider,
      d.timelockDeploymentTxHash,
      d.timelockDeploymentBlock,
      anchors,
      scope,
    ),
    canonicalTransaction(
      provider,
      d.factoryDeploymentTxHash,
      d.factoryDeploymentBlock,
      anchors,
      scope,
    ),
    canonicalTransaction(
      provider,
      d.deploymentTxHash,
      d.deploymentBlock,
      anchors,
      scope,
    ),
  ]);
  const [governanceBirth, factoryBirth, eventBirth] = births;
  for (const [birth, target, data] of [
    [
      governanceBirth,
      d.upgradeAuthority,
      artifacts.timelock.bytecode +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(["address"], [d.initialUpgradeOwner])
          .slice(2),
    ],
    [
      factoryBirth,
      d.factory,
      artifacts.proxy.bytecode +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(
            ["address", "bytes"],
            [
              d.initialFactoryImplementation,
              factory.interface.encodeFunctionData("initialize", [
                d.initialImplementation,
                d.upgradeAuthority,
              ]),
            ],
          )
          .slice(2),
    ],
  ])
    check(
      birth.tx.to === null &&
        birth.tx.value === 0n &&
        same(birth.tx.data, data) &&
        same(birth.receipt.contractAddress, target) &&
        same(
          ethers.getCreateAddress({
            from: birth.tx.from,
            nonce: birth.tx.nonce,
          }),
          target,
        ),
      "Historical constructor/initialization does not match reviewed source",
    );
  initialized(
    factoryBirth.receipt,
    d.factory,
    factory.interface,
    d.initialFactoryImplementation,
  );
  // Initial implementations are explicit historical pins, never inferred from mutable defaults.
  const historicalCodes = await Promise.all([
    provider.getCode(d.initialImplementation, d.factoryDeploymentBlock),
    provider.getCode(d.initialFactoryImplementation, d.factoryDeploymentBlock),
  ]);
  check(
    same(
      historicalCodes[0],
      expectedRuntime(artifacts.event, d.initialImplementation),
    ) &&
      same(
        historicalCodes[1],
        expectedRuntime(artifacts.factory, d.initialFactoryImplementation),
      ),
    "Historical implementation source is untrusted",
  );
  const template = await event.metaEvidenceTemplate(at);
  const config = {
    depositAmount: d.depositWei,
    eventName: d.eventName,
    eventStart: d.eventStart,
    claimDeadline: d.claimDeadline,
    arbitration: {
      disputeResolver: d.resolver,
      extraData: d.arbitratorExtraData,
      metaEvidenceTemplate: [...template[0]],
      metaEvidenceSlots: template[1],
      policyURI: d.policyURI,
    },
  };
  const configType =
    "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
  const configurationHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", configType],
      [d.creator, config],
    ),
  );
  const factoryId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "bytes32"],
      [scope.chainId, d.factory, d.creator, d.eventKey],
    ),
  );
  check(
    same(configurationHash, d.configurationHash) &&
      same(factoryId, d.factoryEventId) &&
      same(eventBirth.tx.from, d.creator) &&
      same(eventBirth.tx.to, d.factory) &&
      eventBirth.tx.value === 0n &&
      same(
        eventBirth.tx.data,
        factory.interface.encodeFunctionData("createEvent", [
          d.eventKey,
          config,
        ]),
      ),
    "Event creation calldata/identity differs from reviewed configuration",
  );
  const created = parseLogs(
    eventBirth.receipt,
    d.factory,
    factory.interface,
    "EventCreated",
  );
  check(
    created.length === 1 &&
      same(created[0].args.eventId, factoryId) &&
      same(created[0].args.creator, d.creator) &&
      same(created[0].args.eventContract, d.contract) &&
      same(created[0].args.eventKey, d.eventKey) &&
      created[0].args.version === 9n &&
      same(created[0].args.configurationHash, configurationHash),
    "Missing exact factory EventCreated proof",
  );
  initialized(
    eventBirth.receipt,
    d.contract,
    event.interface,
    d.initialImplementation,
  );
  const actual = await Promise.all([
    event.depositAmount(at),
    event.eventName(at),
    event.eventStart(at),
    event.claimDeadline(at),
    event.disputeResolver(at),
    event.arbitrator(at),
    event.policyURI(at),
    event.arbitratorExtraData(at),
    event.metaEvidenceTemplate(at),
    event.CHALLENGE_PERIOD(at),
    event.MATCH_PERIOD(at),
    event.MAX_STAKERS(at),
    factory.isEvent(d.contract, at),
    factory.eventsById(factoryId, at),
    factory.eventId(d.creator, d.eventKey, at),
    factory.eventFor(d.creator, d.eventKey, at),
    factory.proxyCreationCodeHash(at),
  ]);
  check(
    String(actual[0]) === d.depositWei &&
      actual[1] === d.eventName &&
      Number(actual[2]) === d.eventStart &&
      Number(actual[3]) === d.claimDeadline &&
      same(actual[4], d.resolver) &&
      same(actual[5], d.arbitrator) &&
      actual[6] === d.policyURI &&
      actual[7] === d.arbitratorExtraData &&
      hash([[...actual[8][0]], actual[8][1]]) === d.templateHash &&
      actual[9] === 86400n &&
      actual[10] === 86400n &&
      actual[11] === 150n &&
      actual[12] &&
      same(actual[13], d.contract) &&
      same(actual[14], factoryId) &&
      same(actual[15], d.contract) &&
      same(actual[16], ethers.keccak256(artifacts.proxy.bytecode)),
    "Current event terms or factory membership differs",
  );
  await verifyInitialUpgradeHistory(
    provider,
    d,
    block,
    anchors,
    artifacts.event,
  );
  // Catch a reorg after all slow history/authority reads, before disclosing a positive proof.
  for (const [number, expected] of anchors)
    if (number !== block.number)
      check(
        same((await provider.getBlock(number))?.hash, expected),
        "Verification anchor is no longer canonical",
        "DEPLOYMENT_REORG",
      );
  check(
    BigInt(await provider.send("eth_chainId", [])) === BigInt(scope.chainId),
    "RPC chain changed during verification",
    "WRONG_CHAIN",
  );
  check(
    same((await provider.getBlock(block.number))?.hash, block.hash),
    "Verification head is no longer canonical",
    "DEPLOYMENT_REORG",
  );
  return {
    anchor: {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
    },
    deploymentTrust: {
      status: "verified",
      contractVersion: scope.profile,
      proxyCodeHash: proxyHash,
      factory: d.factory,
      factoryCodeHash: proxyHash,
      configurationHash,
      creationBlockHash: eventBirth.block.hash,
      factoryCreationBlockHash: factoryBirth.block.hash,
      timelockCreationBlockHash: governanceBirth.block.hash,
    },
    upgrade: {
      kind: "uups",
      version: 9,
      verified: true,
      pending: pending.event,
      implementation: d.implementation,
      implementationCodeHash: d.implementationCodeHash,
      implementationRevision: 1,
      family: EVENT_FAMILY,
      storageSchema: EVENT_SCHEMA,
      authority: d.upgradeAuthority,
      authorityCodeHash: timelockHash,
      governanceKind: "single-owner-timelock",
      initialOwner: d.initialUpgradeOwner,
      owner: pending.owner,
      pendingOwner: pending.pendingOwner,
      pendingOperationCount: pending.pendingOperationCount,
      executingOperationCount: pending.executingOperationCount,
      delaySeconds: Number(identities[4]),
    },
    factoryUpgrade: {
      kind: "uups",
      version: 9,
      verified: true,
      pending: pending.factory,
      implementation: d.factoryImplementation,
      implementationCodeHash: d.factoryImplementationCodeHash,
      implementationRevision: 1,
      family: FACTORY_FAMILY,
      storageSchema: FACTORY_SCHEMA,
      authority: d.upgradeAuthority,
      authorityCodeHash: timelockHash,
      governanceKind: "single-owner-timelock",
      initialOwner: d.initialUpgradeOwner,
      owner: pending.owner,
      pendingOwner: pending.pendingOwner,
      pendingOperationCount: pending.pendingOperationCount,
      executingOperationCount: pending.executingOperationCount,
      delaySeconds: Number(identities[4]),
    },
  };
}

// Historical public mainnet API remains a strict wrapper, never a chain-id switch.
export async function verifyUpgradeableDeployment(chain, d, options = {}) {
  return verifyV9Deployment(chain, d, V9_MAINNET_SCOPE, options);
}

function validateFactoryRegistry(d, scope) {
  check(
    scope === V9_MAINNET_SCOPE || scope === V9_CHIADO_SCOPE,
    "An exact approved v9 verification scope is required",
    "WRONG_CHAIN",
  );
  check(
    d?.contractVersion === scope.profile &&
      d.abiVersion === scope.profile &&
      d.chainId === scope.chainId,
    "Factory profile differs from its approved chain",
    "WRONG_CHAIN",
  );
  for (const key of [
    "factory",
    "factoryImplementation",
    "implementation",
    "initialFactoryImplementation",
    "initialImplementation",
    "upgradeAuthority",
    "initialUpgradeOwner",
  ])
    check(address(d[key]), `Missing trusted factory ${key}`);
  for (const key of [
    "factoryCodeHash",
    "factoryImplementationCodeHash",
    "implementationCodeHash",
    "upgradeAuthorityCodeHash",
    "factoryDeploymentTxHash",
    "timelockDeploymentTxHash",
  ])
    check(bytes32(d[key]), `Missing trusted factory ${key}`);
  for (const key of ["factoryDeploymentBlock", "timelockDeploymentBlock"])
    check(positiveBlock(d[key]), `Missing trusted factory ${key}`);
  check(
    !Object.hasOwn(d, "projectMultisig") &&
      (d.factoryImplementationRevision === undefined ||
        d.factoryImplementationRevision === 1) &&
      (d.implementationRevision === undefined ||
        d.implementationRevision === 1),
    "Unreviewed factory implementation revision or legacy governance",
  );
  check(
    new Set(
      [
        d.factory,
        d.factoryImplementation,
        d.implementation,
        d.upgradeAuthority,
        d.initialUpgradeOwner,
      ].map(lower),
    ).size === 5,
    "Factory, implementations and governance identities must be distinct",
  );
}

async function verifyFactoryInitialHistory(
  provider,
  d,
  block,
  anchors,
  artifact,
  initialEventHash,
) {
  const iface = new ethers.Interface(artifact.abi);
  const topics = ["Upgraded", "EventImplementationSelected"].map(
    (name) => iface.getEvent(name).topicHash,
  );
  const seen = new Set();
  for (
    let fromBlock = d.factoryDeploymentBlock;
    fromBlock <= block.number;
    fromBlock += 5000
  ) {
    const logs = await provider.getLogs({
      address: d.factory,
      fromBlock,
      toBlock: Math.min(fromBlock + 4999, block.number),
      topics: [topics],
    });
    for (const log of logs) {
      check(
        same(log.address, d.factory) &&
          !log.removed &&
          log.blockNumber === d.factoryDeploymentBlock &&
          same(log.transactionHash, d.factoryDeploymentTxHash) &&
          same(log.blockHash, anchors.get(d.factoryDeploymentBlock)),
        "Unreviewed factory proxy or event-default history",
        "UNREVIEWED_UPGRADE_HISTORY",
      );
      const parsed = iface.parseLog(log);
      check(
        parsed && !seen.has(parsed.name),
        "Duplicate or missing initial factory history",
        "UNREVIEWED_UPGRADE_HISTORY",
      );
      seen.add(parsed.name);
      if (parsed.name === "Upgraded")
        check(
          same(parsed.args.implementation, d.initialFactoryImplementation),
          "Factory initial implementation differs from history",
          "UNREVIEWED_UPGRADE_HISTORY",
        );
      else
        check(
          parsed.name === "EventImplementationSelected" &&
            same(parsed.args.implementation, d.initialImplementation) &&
            same(parsed.args.codeHash, initialEventHash) &&
            parsed.args.revision === 1n,
          "Factory initial event default differs from source",
          "UNREVIEWED_UPGRADE_HISTORY",
        );
    }
  }
  check(
    seen.size === 2,
    "Incomplete initial factory history",
    "UNREVIEWED_UPGRADE_HISTORY",
  );
}

/** Verify a source-pinned factory before any child exists. This proof intentionally
 * reads the mutable future-child default; existing-child proofs never depend on it. */
export async function verifyV9FactoryDeployment(
  chain,
  d,
  scope = V9_MAINNET_SCOPE,
  { artifacts = loadUpgradeableArtifacts() } = {},
) {
  validateFactoryRegistry(d, scope);
  verifySourceArtifacts(chain, artifacts);
  const governance = reviewedGovernance(chain, d),
    provider = chain.provider;
  check(
    BigInt(await provider.send("eth_chainId", [])) === BigInt(scope.chainId),
    "Factory RPC differs from the approved chain",
    "WRONG_CHAIN",
  );
  const block = await provider.getBlock("latest");
  check(
    block &&
      positiveBlock(block.number) &&
      bytes32(block.hash) &&
      Math.max(d.factoryDeploymentBlock, d.timelockDeploymentBlock) <=
        block.number,
    "Missing canonical factory verification head",
  );
  const anchors = new Map([[block.number, block.hash]]),
    at = { blockTag: block.number };
  const timelockHash = ethers.keccak256(artifacts.timelock.deployedBytecode),
    proxyHash = ethers.keccak256(artifacts.proxy.deployedBytecode);
  check(
    same(d.factoryCodeHash, proxyHash) &&
      same(d.upgradeAuthorityCodeHash, timelockHash),
    "Factory registry does not pin the compiled proxy and timelock",
  );
  const expectedRuntime = (artifact, implementation) =>
    patchImmutableRuntime(artifact, implementation, timelockHash);
  const targets = [
    [d.factory, artifacts.proxy.deployedBytecode],
    [
      d.factoryImplementation,
      expectedRuntime(artifacts.factory, d.factoryImplementation),
    ],
    [d.implementation, expectedRuntime(artifacts.event, d.implementation)],
    [d.upgradeAuthority, artifacts.timelock.deployedBytecode],
  ];
  const [codes, slot] = await Promise.all([
    Promise.all(
      targets.map(([target]) => provider.getCode(target, block.number)),
    ),
    provider.send("eth_getStorageAt", [
      d.factory,
      IMPLEMENTATION_SLOT,
      ethers.toQuantity(block.number),
    ]),
  ]);
  codes.forEach((code, i) =>
    check(
      same(code, targets[i][1]),
      "Factory source runtime differs from its reviewed build",
      "WRONG_CONTRACT",
    ),
  );
  check(
    bytes32(slot) &&
      same(slot, ethers.zeroPadValue(d.factoryImplementation, 32)),
    "Factory ERC1967 implementation changed",
    "IMPLEMENTATION_CHANGED",
  );
  check(
    same(ethers.keccak256(codes[1]), d.factoryImplementationCodeHash) &&
      same(ethers.keccak256(codes[2]), d.implementationCodeHash),
    "Factory implementation code pins differ",
  );
  const factory = new ethers.Contract(
    d.factory,
    artifacts.factory.abi,
    provider,
  );
  const eventDefault = new ethers.Contract(
    d.implementation,
    artifacts.event.abi,
    provider,
  );
  const factoryImplementation = new ethers.Contract(
    d.factoryImplementation,
    artifacts.factory.abi,
    provider,
  );
  const timelock = new ethers.Contract(
    d.upgradeAuthority,
    artifacts.timelock.abi,
    provider,
  );
  const [
    factoryIdentity,
    eventIdentity,
    authority,
    selected,
    minimum,
    delay,
    uuids,
    proxyCreationHash,
  ] = await Promise.all([
    Promise.all([
      factory.VERSION(at),
      factory.UPGRADE_FAMILY(at),
      factory.implementationRevision(at),
      factory.storageSchema(at),
    ]),
    Promise.all([
      eventDefault.VERSION(at),
      eventDefault.UPGRADE_FAMILY(at),
      eventDefault.implementationRevision(at),
      eventDefault.storageSchema(at),
    ]),
    factory.upgradeAuthority(at),
    factory.eventImplementation(at),
    timelock.MIN_UPGRADE_DELAY(at),
    timelock.getMinDelay(at),
    Promise.all([
      factoryImplementation.proxiableUUID(at),
      eventDefault.proxiableUUID(at),
    ]),
    factory.proxyCreationCodeHash(at),
  ]);
  for (const [identity, family, schema] of [
    [factoryIdentity, FACTORY_FAMILY, FACTORY_SCHEMA],
    [eventIdentity, EVENT_FAMILY, EVENT_SCHEMA],
  ])
    check(
      identity[0] === 9n &&
        identity[1] === family &&
        identity[2] === 1n &&
        identity[3] === schema,
      "Factory or event-default family, schema or revision differs",
    );
  check(
    same(authority, d.upgradeAuthority) &&
      same(selected, d.implementation) &&
      minimum === BigInt(MIN_UPGRADE_DELAY) &&
      delay >= BigInt(governance.minimumDelaySeconds) &&
      delay <= BigInt(Number.MAX_SAFE_INTEGER) &&
      uuids.every((uuid) => uuid === IMPLEMENTATION_SLOT) &&
      same(proxyCreationHash, ethers.keccak256(artifacts.proxy.bytecode)),
    "Factory default, authority, delay or UUPS identity differs",
  );
  const pending = await verifyRoles(
    provider,
    timelock,
    d,
    block,
    anchors,
    artifacts.timelock,
  );
  const [timelockBirth, factoryBirth] = await Promise.all([
    canonicalTransaction(
      provider,
      d.timelockDeploymentTxHash,
      d.timelockDeploymentBlock,
      anchors,
      scope,
    ),
    canonicalTransaction(
      provider,
      d.factoryDeploymentTxHash,
      d.factoryDeploymentBlock,
      anchors,
      scope,
    ),
  ]);
  for (const [birth, target, data] of [
    [
      timelockBirth,
      d.upgradeAuthority,
      artifacts.timelock.bytecode +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(["address"], [d.initialUpgradeOwner])
          .slice(2),
    ],
    [
      factoryBirth,
      d.factory,
      artifacts.proxy.bytecode +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(
            ["address", "bytes"],
            [
              d.initialFactoryImplementation,
              factory.interface.encodeFunctionData("initialize", [
                d.initialImplementation,
                d.upgradeAuthority,
              ]),
            ],
          )
          .slice(2),
    ],
  ])
    check(
      birth.tx.to === null &&
        birth.tx.value === 0n &&
        same(birth.tx.data, data) &&
        same(birth.receipt.contractAddress, target) &&
        same(
          ethers.getCreateAddress({
            from: birth.tx.from,
            nonce: birth.tx.nonce,
          }),
          target,
        ),
      "Factory historical constructor or atomic initialization differs",
    );
  initialized(
    factoryBirth.receipt,
    d.factory,
    factory.interface,
    d.initialFactoryImplementation,
  );
  const historical = await Promise.all([
    provider.getCode(d.initialFactoryImplementation, d.factoryDeploymentBlock),
    provider.getCode(d.initialImplementation, d.factoryDeploymentBlock),
  ]);
  const initialEventRuntime = expectedRuntime(
    artifacts.event,
    d.initialImplementation,
  );
  check(
    same(
      historical[0],
      expectedRuntime(artifacts.factory, d.initialFactoryImplementation),
    ) && same(historical[1], initialEventRuntime),
    "Factory historical implementations differ from source",
  );
  await verifyFactoryInitialHistory(
    provider,
    d,
    block,
    anchors,
    artifacts.factory,
    ethers.keccak256(initialEventRuntime),
  );
  for (const [number, expected] of anchors)
    if (number !== block.number)
      check(
        same((await provider.getBlock(number))?.hash, expected),
        "Factory verification anchor changed",
        "DEPLOYMENT_REORG",
      );
  check(
    BigInt(await provider.send("eth_chainId", [])) === BigInt(scope.chainId),
    "Factory RPC chain changed",
    "WRONG_CHAIN",
  );
  check(
    same((await provider.getBlock(block.number))?.hash, block.hash),
    "Factory verification head changed",
    "DEPLOYMENT_REORG",
  );
  return {
    anchor: {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
    },
    deploymentTrust: {
      status: "verified",
      contractVersion: scope.profile,
      chainId: scope.chainId,
      factory: d.factory,
      proxyCodeHash: proxyHash,
      factoryCodeHash: proxyHash,
      factoryCreationBlockHash: factoryBirth.block.hash,
      timelockCreationBlockHash: timelockBirth.block.hash,
    },
    upgrade: {
      kind: "uups",
      version: 9,
      verified: true,
      pending: pending.factory,
      implementation: d.factoryImplementation,
      implementationCodeHash: d.factoryImplementationCodeHash,
      implementationRevision: 1,
      family: FACTORY_FAMILY,
      storageSchema: FACTORY_SCHEMA,
      authority: d.upgradeAuthority,
      authorityCodeHash: timelockHash,
      governanceKind: "single-owner-timelock",
      initialOwner: d.initialUpgradeOwner,
      owner: pending.owner,
      pendingOwner: pending.pendingOwner,
      pendingOperationCount: pending.pendingOperationCount,
      executingOperationCount: pending.executingOperationCount,
      delaySeconds: Number(delay),
    },
    eventImplementation: selected,
  };
}
