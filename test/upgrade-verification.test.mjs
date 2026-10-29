// In-process chain1 fixture only. No public RPC, real wallet files or deployment resources.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import {
  IMPLEMENTATION_SLOT,
  UPGRADEABLE_VERSION,
  loadUpgradeableArtifacts,
  patchImmutableRuntime,
  verifyUpgradeableDeployment,
  verifyV9Deployment,
  verifyV9FactoryDeployment,
  V9_MAINNET_SCOPE,
  V9_CHIADO_SCOPE,
} from "../src/upgrade-verification.mjs";

const h = (n) => ethers.toBeHex(n, 32);
const changed = (code) =>
  code.slice(0, -2) + (code.endsWith("00") ? "01" : "00");
const send = async (promise) => (await promise).wait();
let rpc, provider, artifacts, d, owner, factory, event, timelock;
const calls = [];
function context(overrides = {}) {
  return {
    chainId: 1,
    production: true,
    manifest: {
      provenance: {
        v9BuildManifestSha256: hash(
          JSON.parse(
            fs.readFileSync(
              new URL("../build/contracts-v9/manifest.json", import.meta.url),
            ),
          ),
        ),
        v9StandardInputSha256: hash(
          JSON.parse(
            fs.readFileSync(
              new URL(
                "../build/contracts-v9/standard-input.json",
                import.meta.url,
              ),
            ),
          ),
        ),
      },
    },
    governance: {
      kind: "single-owner-timelock",
      initialOwner: d.initialUpgradeOwner,
      minimumDelaySeconds: 172800,
    },
    provider: new Proxy(provider, {
      get(target, key) {
        const value = overrides[key] ?? target[key];
        if (typeof value !== "function") return value;
        return (...args) => {
          calls.push(key);
          return value.apply(target, args);
        };
      },
    }),
  };
}
const reject = (code) => (error) => error.code === code;

before(async () => {
  artifacts = loadUpgradeableArtifacts();
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 },
    wallet: { totalAccounts: 3, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  owner = await provider.getSigner(0);
  const deploy = async (a, ...args) => {
    const contract = await new ethers.ContractFactory(
      a.abi,
      a.bytecode,
      owner,
    ).deploy(...args, { gasLimit: 16_000_000 });
    await contract.waitForDeployment();
    return contract;
  };
  const fixture = (name) =>
    JSON.parse(
      fs.readFileSync(
        new URL(`../references/kickback/build/${name}.json`, import.meta.url),
      ),
    );
  timelock = await deploy(artifacts.timelock, owner.address);
  const implementation = await deploy(artifacts.event),
    factoryImplementation = await deploy(artifacts.factory);
  const born = await deploy(
    artifacts.proxy,
    factoryImplementation.target,
    factoryImplementation.interface.encodeFunctionData("initialize", [
      implementation.target,
      timelock.target,
    ]),
  );
  factory = new ethers.Contract(born.target, artifacts.factory.abi, owner);
  const liquid = await deploy(fixture("MockKlerosLiquid")),
    resolver = await deploy(fixture("MockArbitrableProxy"), liquid.target);
  const now = (await provider.getBlock("latest")).timestamp;
  const config = {
    depositAmount: 1000000000000n,
    eventName: "Synthetic upgrade verification",
    eventStart: now + 3600,
    claimDeadline: now + 8 * 86400,
    arbitration: {
      disputeResolver: resolver.target,
      extraData: ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256"],
        [0, 3],
      ),
      metaEvidenceTemplate: [
        '{"wallet":"',
        '","contract":"',
        '","organizer":"',
        '"}',
      ],
      metaEvidenceSlots: "0x010204",
      policyURI: "https://example.invalid/synthetic-v9-policy",
    },
  };
  const key = ethers.id("synthetic-upgrade-verification");
  const receipt = await send(
    factory.createEvent(key, config, { gasLimit: 8_000_000 }),
  );
  const created = receipt.logs
    .filter((log) => log.address === factory.target)
    .map((log) => factory.interface.parseLog(log))
    .find((log) => log?.name === "EventCreated");
  event = new ethers.Contract(
    created.args.eventContract,
    artifacts.event.abi,
    owner,
  );
  const factoryBirth = await born.deploymentTransaction().wait(),
    timelockBirth = await timelock.deploymentTransaction().wait();
  d = {
    eventId: "synthetic-v9",
    contractVersion: UPGRADEABLE_VERSION,
    abiVersion: UPGRADEABLE_VERSION,
    chainId: 1,
    contract: event.target,
    factory: factory.target,
    creator: owner.address,
    owner: owner.address,
    implementation: implementation.target,
    factoryImplementation: factoryImplementation.target,
    initialImplementation: implementation.target,
    initialFactoryImplementation: factoryImplementation.target,
    implementationRevision: 1,
    factoryImplementationRevision: 1,
    implementationCodeHash: ethers.keccak256(
      await provider.getCode(implementation.target),
    ),
    factoryImplementationCodeHash: ethers.keccak256(
      await provider.getCode(factoryImplementation.target),
    ),
    upgradeAuthority: timelock.target,
    upgradeAuthorityCodeHash: ethers.keccak256(
      await provider.getCode(timelock.target),
    ),
    initialUpgradeOwner: owner.address,
    codeHash: ethers.keccak256(await provider.getCode(event.target)),
    factoryCodeHash: ethers.keccak256(await provider.getCode(factory.target)),
    factoryDeploymentTxHash: factoryBirth.hash,
    factoryDeploymentBlock: factoryBirth.blockNumber,
    timelockDeploymentTxHash: timelockBirth.hash,
    timelockDeploymentBlock: timelockBirth.blockNumber,
    deploymentTxHash: receipt.hash,
    deploymentBlock: receipt.blockNumber,
    eventKey: key,
    factoryEventId: created.args.eventId,
    configurationHash: created.args.configurationHash,
    depositWei: String(config.depositAmount),
    eventName: config.eventName,
    eventStart: config.eventStart,
    claimDeadline: config.claimDeadline,
    resolver: resolver.target,
    arbitrator: liquid.target,
    arbitratorExtraData: config.arbitration.extraData,
    policyURI: config.arbitration.policyURI,
    templateHash: hash([
      config.arbitration.metaEvidenceTemplate,
      config.arbitration.metaEvidenceSlots,
    ]),
  };
});
after(async () => {
  provider?.destroy();
  await rpc?.disconnect();
});

test("request-local template reuse reads once per pinned verification and preserves independent configuration checks", async () => {
  const snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
  try {
  const selector = event.interface.getFunction("metaEvidenceTemplate").selector;
  const phases = [];
  for (let invocation = 0; invocation < 2; invocation++) {
    if (invocation) await rpc.request({ method: "evm_mine", params: [] });
    const reads = { templates: [], heads: [], chains: 0, slots: [], births: [] };
    const result = await verifyUpgradeableDeployment(context({
      call: async (tx) => {
        if (tx.to === d.contract && tx.data.startsWith(selector)) reads.templates.push(tx.blockTag);
        return provider.call(tx);
      },
      getBlock: async (tag) => { reads.heads.push(tag); return provider.getBlock(tag); },
      send: async (method, args) => {
        if (method === "eth_chainId") reads.chains++;
        if (method === "eth_getStorageAt") reads.slots.push(args[0]);
        return provider.send(method, args);
      },
      getTransaction: async (txHash) => { reads.births.push(txHash); return provider.getTransaction(txHash); },
    }), d);
    assert.equal(reads.templates.length, 1, "One template eth_call supplies both creation and current-term validations");
    assert.equal(Number(reads.templates[0]), result.anchor.number, "The reused value remains pinned to this invocation's snapshot");
    assert.equal(reads.heads.filter((tag) => tag === "latest").length, 1);
    assert.ok(reads.heads.includes(result.anchor.number), "Final canonical-head check still executes");
    assert.equal(reads.chains, 2, "Opening and closing chain checks remain fresh");
    assert.ok(reads.slots.includes(d.contract) && reads.slots.includes(d.factory));
    assert.deepEqual(new Set(reads.births), new Set([d.timelockDeploymentTxHash, d.factoryDeploymentTxHash, d.deploymentTxHash]));
    phases.push(result.anchor.number);
  }
  assert.ok(phases[1] > phases[0], "A subsequent phase reads a new snapshot and template rather than reusing a previous result");
  await assert.rejects(verifyUpgradeableDeployment(context({ call: async (tx) =>
    tx.to === d.contract && tx.data.startsWith(selector)
      ? event.interface.encodeFunctionResult("metaEvidenceTemplate", [["altered", '"}'], "0x01"])
      : provider.call(tx) }), d));
  await assert.rejects(verifyUpgradeableDeployment(context(), { ...d, configurationHash: h(151) }));
  await assert.rejects(verifyUpgradeableDeployment(context(), { ...d, templateHash: "f".repeat(64) }),
    /Current event terms or factory membership differs/);
  } finally { await rpc.request({ method: "evm_revert", params: [snapshot] }); }
});

test("real synthetic chain1 proxies prove source, constructors, init, family, governance and stable metadata", async () => {
  calls.length = 0;
  const result = await verifyUpgradeableDeployment(context(), d);
  assert.equal(result.deploymentTrust.status, "verified");
  assert.equal(result.upgrade.implementation, d.implementation);
  assert.equal(result.upgrade.delaySeconds, 172800);
  assert.equal(
    result.upgrade.storageSchema,
    ethers.id("kleros.event.v9.storage.1"),
  );
  assert.equal(
    result.factoryUpgrade.family,
    ethers.id("kleros.factory.v9.uups"),
  );
  assert.deepEqual(await verifyUpgradeableDeployment(context(), d), result);
  assert.equal(result.upgrade.pending, null);
  assert.equal(result.upgrade.kind, "uups");
  assert.equal(result.upgrade.verified, true);
  assert.equal(
    (await provider.getBlock(result.anchor.number)).hash,
    result.anchor.hash,
  );
  assert.ok(
    !JSON.stringify(result).includes("blockNumber"),
    "head movement is not financial state",
  );
  assert.ok(
    calls.every((name) =>
      [
        "send",
        "call",
        "resolveName",
        "getBlock",
        "getCode",
        "getTransaction",
        "getTransactionReceipt",
        "getLogs",
      ].includes(name),
    ),
  );
  assert.equal(
    provider.listenerCount ? await provider.listenerCount("pending") : 0,
    0,
  );
});

test("profile, explicit initial identities and immutable metadata reject before provider access", async () => {
  for (const patch of [
    { chainId: 10200 },
    { contractVersion: "kleros-event-v8" },
    { initialImplementation: undefined },
    { initialUpgradeOwner: d.factory },
    { factoryImplementationRevision: 2 },
  ]) {
    calls.length = 0;
    await assert.rejects(
      verifyUpgradeableDeployment(context(), { ...d, ...patch }),
    );
    assert.equal(calls.length, 0);
  }
  const artifact = structuredClone(artifacts.event),
    timelockHash = ethers.keccak256(artifacts.timelock.deployedBytecode);
  const id = Object.keys(artifact.immutableValues)[0];
  artifact.immutableValues[id].name = "unreviewed";
  assert.throws(() =>
    patchImmutableRuntime(artifact, d.implementation, timelockHash),
  );
  assert.equal(
    ethers.keccak256(
      patchImmutableRuntime(artifacts.event, d.implementation, timelockHash),
    ),
    d.implementationCodeHash,
  );
});

test("fresh code, implementation slot, delay, family and revision changes fail closed", async () => {
  await assert.rejects(
    verifyUpgradeableDeployment(
      context({
        send: async (method, params) =>
          method === "eth_chainId" ? "0x64" : provider.send(method, params),
      }),
      d,
    ),
    reject("WRONG_CHAIN"),
  );
  await assert.rejects(
    verifyUpgradeableDeployment(
      context({
        getCode: async (target, tag) =>
          target === d.implementation
            ? changed(await provider.getCode(target, tag))
            : provider.getCode(target, tag),
      }),
      d,
    ),
    reject("WRONG_CONTRACT"),
  );
  await assert.rejects(
    verifyUpgradeableDeployment(
      context({
        send: async (method, params) =>
          method === "eth_getStorageAt" && params[0] === d.contract
            ? h(7)
            : provider.send(method, params),
      }),
      d,
    ),
    reject("IMPLEMENTATION_CHANGED"),
  );
  for (const [target, iface, method, output] of [
    [d.upgradeAuthority, timelock.interface, "getMinDelay", [172799]],
    [d.contract, event.interface, "UPGRADE_FAMILY", [ethers.ZeroHash]],
    [d.contract, event.interface, "implementationRevision", [2]],
    [d.implementation, event.interface, "proxiableUUID", [ethers.ZeroHash]],
  ])
    await assert.rejects(
      verifyUpgradeableDeployment(
        context({
          call: async (tx) =>
            tx.to === target &&
            tx.data.startsWith(iface.getFunction(method).selector)
              ? iface.encodeFunctionResult(method, output)
              : provider.call(tx),
        }),
        d,
      ),
    );
});

test("source-matching proxy birth still requires exact reviewed initialization and canonical receipt", async () => {
  await assert.rejects(
    verifyUpgradeableDeployment(
      context({
        getTransaction: async (txHash) => {
          const tx = await provider.getTransaction(txHash);
          return txHash === d.factoryDeploymentTxHash
            ? { ...tx, data: changed(tx.data) }
            : tx;
        },
      }),
      d,
    ),
  );
  await assert.rejects(
    verifyUpgradeableDeployment(
      context({
        getTransactionReceipt: async (txHash) => {
          const receipt = await provider.getTransactionReceipt(txHash);
          return txHash === d.deploymentTxHash
            ? { ...receipt, blockHash: h(777) }
            : receipt;
        },
      }),
      d,
    ),
    reject("DEPLOYMENT_REORG"),
  );
  await assert.rejects(
    verifyUpgradeableDeployment(context(), { ...d, configurationHash: h(5) }),
  );
  await assert.rejects(
    verifyUpgradeableDeployment(context(), {
      ...d,
      initialImplementation: d.creator,
    }),
  );
});

test("extra governance authority is rejected by full canonical role history", async () => {
  const log = timelock.interface.encodeEventLog(
    timelock.interface.getEvent("RoleGranted"),
    [ethers.ZeroHash, d.creator, d.upgradeAuthority],
  );
  await assert.rejects(
    verifyUpgradeableDeployment(
      context({
        getLogs: async (filter) => {
          const logs = await provider.getLogs(filter),
            block = await provider.getBlock(d.deploymentBlock);
          return [
            ...logs,
            {
              ...log,
              address: d.upgradeAuthority,
              blockNumber: block.number,
              blockHash: block.hash,
              transactionHash: d.deploymentTxHash,
              index: 999,
              removed: false,
            },
          ];
        },
      }),
      d,
    ),
    /role/,
  );
});

test("late verification-head reorg fails even while historical birth anchors remain canonical", async () => {
  const head = await provider.getBlock("latest");
  let pinnedHeadReads = 0;
  await assert.rejects(
    verifyUpgradeableDeployment(
      context({
        getBlock: async (tag) => {
          const b = await provider.getBlock(tag);
          if (tag === head.number && ++pinnedHeadReads >= 2)
            return { ...b, hash: h(888) };
          return b;
        },
      }),
      d,
    ),
    reject("DEPLOYMENT_REORG"),
  );
});

test("existing child never depends on factory default implementation for future events", async () => {
  const selector = factory.interface.getFunction(
    "eventImplementation",
  ).selector;
  const result = await verifyUpgradeableDeployment(
    context({
      call: async (tx) => {
        assert.ok(
          !(tx.to === d.factory && tx.data.startsWith(selector)),
          "mutable future-child default is not an existing child trust gate",
        );
        return provider.call(tx);
      },
    }),
    d,
  );
  assert.equal(result.upgrade.implementation, d.implementation);
  assert.ok(!Object.hasOwn(result.factoryUpgrade, "eventImplementation"));
});

test("fresh scheduled upgrade notice is verified, canceled operations disappear, and history failure is never false absence", async () => {
  const before = await verifyUpgradeableDeployment(context(), d);
  const candidate = (await provider.getSigner(2)).address;
  const data = event.interface.encodeFunctionData("upgradeToAndCall", [
    candidate,
    "0x",
  ]);
  const salt = ethers.id("synthetic-upgrade-notice"),
    predecessor = ethers.ZeroHash;
  await send(
    timelock.schedule(d.contract, 0, data, predecessor, salt, 172800, {
      gasLimit: 1000000,
    }),
  );
  const operationId = await timelock.hashOperation(
    d.contract,
    0,
    data,
    predecessor,
    salt,
  );
  const queued = await verifyUpgradeableDeployment(context(), d);
  assert.deepEqual(queued.upgrade.pending, {
    operationId,
    newImplementation: candidate,
    eligibleAt: Number(await timelock.getTimestamp(operationId)),
    status: "waiting",
  });
  assert.notEqual(hash(queued.upgrade), hash(before.upgrade));
  assert.equal(queued.factoryUpgrade.pending, null);
  await assert.rejects(
    verifyUpgradeableDeployment(
      context({
        getLogs: async () => {
          throw Error("Synthetic history unavailable");
        },
      }),
      d,
    ),
  );
  await send(timelock.cancel(operationId, { gasLimit: 1000000 }));
  const canceled = await verifyUpgradeableDeployment(context(), d);
  assert.equal(canceled.upgrade.pending, null);
  assert.deepEqual(
    canceled.upgrade,
    before.upgrade,
    "head movement alone is excluded from financial metadata",
  );
});

test("production pins the historical initial upgrade owner and reviewed delay floor", async () => {
  const production = (patch = {}) => {
    const chain = context();
    return { ...chain, governance: { ...chain.governance, ...patch } };
  };
  assert.equal(
    (await verifyUpgradeableDeployment(production(), d)).upgrade.verified,
    true,
  );
  for (const patch of [
    { initialOwner: d.factory },
    { kind: "project-multisig" },
    { minimumDelaySeconds: 1 },
  ])
    await assert.rejects(
      verifyUpgradeableDeployment(production(patch), d),
      reject("INVALID_GOVERNANCE"),
    );
  await assert.rejects(
    verifyUpgradeableDeployment(production({ minimumDelaySeconds: 172801 }), d),
    /upgrade delay/,
  );
  await assert.rejects(
    verifyUpgradeableDeployment({ ...context(), governance: undefined }, d),
    reject("INVALID_GOVERNANCE"),
  );
});

test("unreviewed upgrade-and-return history rejects even when current source, slots and state still match", async () => {
  // A malicious intermediate implementation could bypass the legitimate +1 revision gate.
  // Model only its public logs; current canonical code/storage remain the real known fixture.
  const head = await provider.getBlock("latest"),
    topic = event.interface.getEvent("Upgraded").topicHash;
  const candidate = (await provider.getSigner(2)).address;
  await assert.rejects(
    verifyUpgradeableDeployment(
      context({
        getLogs: async (filter) => {
          const logs = await provider.getLogs(filter);
          if (filter.topics?.[0] !== topic) return logs;
          return [
            ...logs,
            ...[candidate, d.implementation].map((implementation, index) => ({
              ...event.interface.encodeEventLog(
                event.interface.getEvent("Upgraded"),
                [implementation],
              ),
              address: d.contract,
              transactionHash: h(777 + index),
              blockNumber: head.number,
              blockHash: head.hash,
              index: 100 + index,
              removed: false,
            })),
          ];
        },
      }),
      d,
    ),
    reject("UNREVIEWED_UPGRADE_HISTORY"),
  );
});

async function snapshotRun(work) {
  const snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
  try {
    return await work();
  } finally {
    assert.equal(
      await rpc.request({ method: "evm_revert", params: [snapshot] }),
      true,
    );
  }
}
async function queueNoop(saltName, batch = false) {
  const salt = ethers.id(saltName),
    predecessor = ethers.ZeroHash;
  if (batch) {
    const targets = [owner.address, (await provider.getSigner(2)).address],
      values = [0, 0],
      data = ["0x", "0x"];
    await send(
      timelock.scheduleBatch(targets, values, data, predecessor, salt, 172800, {
        gasLimit: 1000000,
      }),
    );
    return {
      id: await timelock.hashOperationBatch(
        targets,
        values,
        data,
        predecessor,
        salt,
      ),
      targets,
      values,
      data,
      predecessor,
      salt,
    };
  }
  await send(
    timelock.schedule(owner.address, 0, "0x", predecessor, salt, 172800, {
      gasLimit: 1000000,
    }),
  );
  return {
    id: await timelock.hashOperation(owner.address, 0, "0x", predecessor, salt),
    target: owner.address,
    value: 0,
    data: "0x",
    predecessor,
    salt,
  };
}

test("only the two frozen verification scope identities are accepted; the mainnet wrapper never broadens", async () => {
  assert(Object.isFrozen(V9_MAINNET_SCOPE));
  assert(Object.isFrozen(V9_CHIADO_SCOPE));
  for (const scope of [
    undefined,
    null,
    { ...V9_MAINNET_SCOPE },
    { ...V9_CHIADO_SCOPE },
    { profile: UPGRADEABLE_VERSION, chainId: 1 },
  ]) {
    calls.length = 0;
    await assert.rejects(
      verifyV9Deployment(context(), d, scope),
      reject("WRONG_CHAIN"),
    );
    assert.equal(calls.length, 0);
  }
  calls.length = 0;
  await assert.rejects(
    verifyV9Deployment(context(), d, V9_CHIADO_SCOPE),
    reject("WRONG_CHAIN"),
  );
  assert.equal(calls.length, 0);
  const chiado = {
    ...d,
    chainId: 10200,
    contractVersion: V9_CHIADO_SCOPE.profile,
    abiVersion: V9_CHIADO_SCOPE.profile,
  };
  calls.length = 0;
  await assert.rejects(
    verifyUpgradeableDeployment(context(), chiado),
    reject("WRONG_CHAIN"),
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    verifyV9Deployment(context(), chiado, V9_CHIADO_SCOPE),
    reject("WRONG_CHAIN"),
  );
  await assert.rejects(
    verifyV9Deployment(
      context(),
      { ...chiado, contractVersion: UPGRADEABLE_VERSION },
      V9_CHIADO_SCOPE,
    ),
    reject("WRONG_CHAIN"),
  );
});

test("both scopes require the exact reviewed source provenance before any provider read", async () => {
  for (const [scope, registry] of [
    [V9_MAINNET_SCOPE, d],
    [
      V9_CHIADO_SCOPE,
      {
        ...d,
        chainId: 10200,
        contractVersion: V9_CHIADO_SCOPE.profile,
        abiVersion: V9_CHIADO_SCOPE.profile,
      },
    ],
  ]) {
    const chain = context();
    chain.manifest.provenance.v9StandardInputSha256 = "0".repeat(64);
    calls.length = 0;
    await assert.rejects(
      verifyV9Deployment(chain, registry, scope),
      reject("V9_ARTIFACT_PROVENANCE"),
    );
    assert.equal(calls.length, 0);
  }
});

test("proposed owner is cancellation-only and queue-empty acceptance preserves the historical manifest owner", async () =>
  snapshotRun(async () => {
    const next = await provider.getSigner(1),
      op = await queueNoop("ownership-loaded-queue");
    await send(timelock.transferOwnership(next.address, { gasLimit: 1000000 }));
    const proposed = await verifyUpgradeableDeployment(context(), d);
    assert.equal(proposed.upgrade.governanceKind, "single-owner-timelock");
    assert.equal(proposed.upgrade.initialOwner, d.initialUpgradeOwner);
    assert.equal(proposed.upgrade.owner, owner.address);
    assert.equal(proposed.upgrade.pendingOwner, next.address);
    assert.equal(proposed.upgrade.pendingOperationCount, 1);
    assert.equal(proposed.upgrade.executingOperationCount, 0);
    assert.equal(
      await timelock.hasRole(await timelock.CANCELLER_ROLE(), next.address),
      true,
    );
    assert.equal(
      await timelock.hasRole(await timelock.PROPOSER_ROLE(), next.address),
      false,
    );
    await assert.rejects(
      send(timelock.connect(next).acceptOwnership({ gasLimit: 1000000 })),
    );
    await send(timelock.connect(next).cancel(op.id, { gasLimit: 1000000 }));
    await send(timelock.connect(next).acceptOwnership({ gasLimit: 1000000 }));
    const accepted = await verifyUpgradeableDeployment(context(), d);
    assert.equal(accepted.upgrade.owner, next.address);
    assert.equal(accepted.upgrade.pendingOwner, null);
    assert.equal(accepted.upgrade.pendingOperationCount, 0);
    assert.equal(
      accepted.upgrade.initialOwner,
      owner.address,
      "Constructor identity never follows a later owner",
    );
    assert.equal(accepted.factoryUpgrade.owner, next.address);
    assert(!Object.hasOwn(accepted.upgrade, "multisig"));
    assert.equal(
      await timelock.hasRole(await timelock.PROPOSER_ROLE(), owner.address),
      false,
    );
    assert.equal(
      await timelock.hasRole(await timelock.CANCELLER_ROLE(), owner.address),
      false,
    );
  }));

test("replacement and canceled ownership proposals revoke the previous pending cancellation role", async () =>
  snapshotRun(async () => {
    const first = await provider.getSigner(1),
      second = await provider.getSigner(2);
    await send(
      timelock.transferOwnership(first.address, { gasLimit: 1000000 }),
    );
    await send(
      timelock.transferOwnership(second.address, { gasLimit: 1000000 }),
    );
    const replaced = await verifyUpgradeableDeployment(context(), d);
    assert.equal(replaced.upgrade.pendingOwner, second.address);
    assert.equal(
      await timelock.hasRole(await timelock.CANCELLER_ROLE(), first.address),
      false,
    );
    await send(timelock.cancelOwnershipTransfer({ gasLimit: 1000000 }));
    const canceled = await verifyUpgradeableDeployment(context(), d);
    assert.equal(canceled.upgrade.owner, owner.address);
    assert.equal(canceled.upgrade.pendingOwner, null);
    assert.equal(
      await timelock.hasRole(await timelock.CANCELLER_ROLE(), second.address),
      false,
    );
  }));

test("single and batch operation queues reconcile complete scheduled, executed, canceled and rescheduled history", async () =>
  snapshotRun(async () => {
    const single = await queueNoop("operation-replay-single"),
      batch = await queueNoop("operation-replay-batch", true);
    const queued = await verifyUpgradeableDeployment(context(), d);
    assert.equal(
      queued.upgrade.pendingOperationCount,
      2,
      "Two-call batch is one queued operation",
    );
    await send(timelock.cancel(single.id, { gasLimit: 1000000 }));
    await send(
      timelock.schedule(
        single.target,
        single.value,
        single.data,
        single.predecessor,
        single.salt,
        172800,
        { gasLimit: 1000000 },
      ),
    );
    assert.equal(
      (await verifyUpgradeableDeployment(context(), d)).upgrade
        .pendingOperationCount,
      2,
    );
    await rpc.request({ method: "evm_increaseTime", params: [172801] });
    await rpc.request({ method: "evm_mine", params: [] });
    await send(
      timelock.execute(
        single.target,
        single.value,
        single.data,
        single.predecessor,
        single.salt,
        { gasLimit: 1000000 },
      ),
    );
    assert.equal(
      (await verifyUpgradeableDeployment(context(), d)).upgrade
        .pendingOperationCount,
      1,
    );
    await send(
      timelock.executeBatch(
        batch.targets,
        batch.values,
        batch.data,
        batch.predecessor,
        batch.salt,
        { gasLimit: 1000000 },
      ),
    );
    const executed = await verifyUpgradeableDeployment(context(), d);
    assert.equal(executed.upgrade.pendingOperationCount, 0);
    assert.equal(executed.upgrade.executingOperationCount, 0);
  }));

test("omitted operation salt, missing batch calls or state counters never become verified governance", async () =>
  snapshotRun(async () => {
    await queueNoop("bounded-complete-history", true);
    for (const name of ["CallSalt", "CallScheduled"]) {
      const topic = timelock.interface.getEvent(name).topicHash;
      await assert.rejects(
        verifyUpgradeableDeployment(
          context({
            getLogs: async (filter) => {
              const logs = await provider.getLogs(filter);
              if (!sameAddress(filter.address, d.upgradeAuthority)) return logs;
              return logs.filter(
                (log) =>
                  log.topics[0] !== topic ||
                  (name === "CallScheduled" &&
                    timelock.interface.parseLog(log).args.index === 0n),
              );
            },
          }),
          d,
        ),
      );
    }
    for (const [method, output] of [
      ["pendingOperationCount", [0]],
      ["executingOperationCount", [1]],
      ["owner", [(await provider.getSigner(1)).address]],
      ["pendingOwner", [(await provider.getSigner(1)).address]],
    ]) {
      await assert.rejects(
        verifyUpgradeableDeployment(
          context({
            call: async (tx) =>
              sameAddress(tx.to, d.upgradeAuthority) &&
              tx.data.startsWith(
                timelock.interface.getFunction(method).selector,
              )
                ? timelock.interface.encodeFunctionResult(method, output)
                : provider.call(tx),
          }),
          d,
        ),
      );
    }
  }));

function sameAddress(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    a.toLowerCase() === b.toLowerCase()
  );
}

test("a dropped cancellation cannot hide the loaded queue at historical ownership acceptance", async () =>
  snapshotRun(async () => {
    const next = await provider.getSigner(1),
      op = await queueNoop("acceptance-history-queue");
    await send(timelock.transferOwnership(next.address, { gasLimit: 1000000 }));
    await send(timelock.connect(next).cancel(op.id, { gasLimit: 1000000 }));
    await send(timelock.connect(next).acceptOwnership({ gasLimit: 1000000 }));
    assert.equal(
      (await verifyUpgradeableDeployment(context(), d)).upgrade.owner,
      next.address,
    );
    const canceled = timelock.interface.getEvent("Cancelled").topicHash;
    await assert.rejects(
      verifyUpgradeableDeployment(
        context({
          getLogs: async (filter) => {
            const logs = await provider.getLogs(filter);
            return sameAddress(filter.address, d.upgradeAuthority)
              ? logs.filter((log) => log.topics[0] !== canceled)
              : logs;
          },
        }),
        d,
      ),
      /empty operation queue/,
    );
  }));

test("pending owner cannot acquire proposer or admin membership outside replayed ownership roles", async () =>
  snapshotRun(async () => {
    const next = await provider.getSigner(1);
    await send(timelock.transferOwnership(next.address, { gasLimit: 1000000 }));
    for (const role of [ethers.ZeroHash, ethers.id("PROPOSER_ROLE")]) {
      await assert.rejects(
        verifyUpgradeableDeployment(
          context({
            call: async (tx) => {
              if (
                sameAddress(tx.to, d.upgradeAuthority) &&
                tx.data.startsWith(
                  timelock.interface.getFunction("hasRole").selector,
                )
              ) {
                const args = timelock.interface.decodeFunctionData(
                  "hasRole",
                  tx.data,
                );
                if (args[0] === role && sameAddress(args[1], next.address))
                  return timelock.interface.encodeFunctionResult("hasRole", [
                    true,
                  ]);
              }
              return provider.call(tx);
            },
          }),
          d,
        ),
        /role state/,
      );
    }
  }));

async function emptyFactoryRegistry() {
  const implementation = new ethers.Contract(
    d.initialFactoryImplementation,
    artifacts.factory.abi,
    owner,
  );
  const proxy = await new ethers.ContractFactory(
    artifacts.proxy.abi,
    artifacts.proxy.bytecode,
    owner,
  ).deploy(
    d.initialFactoryImplementation,
    implementation.interface.encodeFunctionData("initialize", [
      d.initialImplementation,
      d.upgradeAuthority,
    ]),
    { gasLimit: 16000000 },
  );
  await proxy.waitForDeployment();
  const receipt = await proxy.deploymentTransaction().wait();
  const keys = [
    "contractVersion",
    "abiVersion",
    "chainId",
    "factoryImplementation",
    "factoryImplementationCodeHash",
    "implementation",
    "implementationCodeHash",
    "initialFactoryImplementation",
    "initialImplementation",
    "upgradeAuthority",
    "upgradeAuthorityCodeHash",
    "initialUpgradeOwner",
    "timelockDeploymentTxHash",
    "timelockDeploymentBlock",
  ];
  const registry = Object.fromEntries(keys.map((key) => [key, d[key]]));
  Object.assign(registry, {
    factory: proxy.target,
    factoryCodeHash: ethers.keccak256(await provider.getCode(proxy.target)),
    factoryDeploymentTxHash: receipt.hash,
    factoryDeploymentBlock: receipt.blockNumber,
  });
  assert.equal(
    await new ethers.Contract(
      proxy.target,
      artifacts.factory.abi,
      provider,
    ).eventCount(),
    0n,
  );
  return registry;
}

test("factory-only proof verifies actual source-pinned empty factory with no child fields or child reads", async () =>
  snapshotRun(async () => {
    const F = await emptyFactoryRegistry();
    assert.equal(F.contract, undefined);
    assert.equal(F.deploymentBlock, undefined);
    const result = await verifyV9FactoryDeployment(
      context({
        getCode: async (target, tag) => {
          assert.notEqual(
            target.toLowerCase(),
            d.contract.toLowerCase(),
            "Factory startup must never require an existing child",
          );
          return provider.getCode(target, tag);
        },
      }),
      F,
    );
    assert.equal(result.deploymentTrust.status, "verified");
    assert.equal(result.deploymentTrust.factory, F.factory);
    assert.equal(result.deploymentTrust.contractVersion, UPGRADEABLE_VERSION);
    assert.equal(result.eventImplementation, F.implementation);
    assert.equal(result.upgrade.implementation, F.factoryImplementation);
    assert.equal(result.upgrade.governanceKind, "single-owner-timelock");
    assert.equal(result.upgrade.owner, owner.address);
    assert.equal(result.upgrade.pendingOwner, null);
    assert.equal(result.upgrade.pendingOperationCount, 0);
    assert.equal(result.upgrade.delaySeconds, 172800);
    assert(!Object.hasOwn(result.upgrade, "multisig"));
  }));

test("factory-only proof rejects profile, chain, source and implementation-slot mismatches", async () =>
  snapshotRun(async () => {
    const F = await emptyFactoryRegistry();
    for (const scope of [{ ...V9_MAINNET_SCOPE }, V9_CHIADO_SCOPE]) {
      calls.length = 0;
      await assert.rejects(
        verifyV9FactoryDeployment(context(), F, scope),
        reject("WRONG_CHAIN"),
      );
      assert.equal(calls.length, 0);
    }
    const unpinned = context();
    unpinned.manifest.provenance.v9StandardInputSha256 = "0".repeat(64);
    calls.length = 0;
    await assert.rejects(
      verifyV9FactoryDeployment(unpinned, F),
      reject("V9_ARTIFACT_PROVENANCE"),
    );
    assert.equal(calls.length, 0);
    await assert.rejects(
      verifyV9FactoryDeployment(
        context({
          send: async (method, params) =>
            method === "eth_chainId" ? "0x27d8" : provider.send(method, params),
        }),
        F,
      ),
      reject("WRONG_CHAIN"),
    );
    await assert.rejects(
      verifyV9FactoryDeployment(
        context({
          send: async (method, params) =>
            method === "eth_getStorageAt" && sameAddress(params[0], F.factory)
              ? h(7)
              : provider.send(method, params),
        }),
        F,
      ),
      reject("IMPLEMENTATION_CHANGED"),
    );
    await assert.rejects(
      verifyV9FactoryDeployment(
        context({
          getCode: async (target, tag) =>
            sameAddress(target, F.implementation)
              ? changed(await provider.getCode(target, tag))
              : provider.getCode(target, tag),
        }),
        F,
      ),
      reject("WRONG_CONTRACT"),
    );
  }));

test("new-child factory proof checks the actual default while existing-child proofs ignore it", async () =>
  snapshotRun(async () => {
    const F = await emptyFactoryRegistry(),
      selector = factory.interface.getFunction("eventImplementation").selector;
    const chain = context({
      call: async (tx) =>
        tx.data.startsWith(selector)
          ? factory.interface.encodeFunctionResult("eventImplementation", [
              d.factoryImplementation,
            ])
          : provider.call(tx),
    });
    await assert.rejects(verifyV9FactoryDeployment(chain, F), /default/);
    assert.equal(
      (await verifyUpgradeableDeployment(chain, d)).deploymentTrust.status,
      "verified",
    );
    for (const [method, output] of [
      ["VERSION", [8]],
      ["UPGRADE_FAMILY", [ethers.ZeroHash]],
      ["implementationRevision", [2]],
      ["storageSchema", [ethers.ZeroHash]],
    ]) {
      const iface = new ethers.Interface(artifacts.event.abi);
      await assert.rejects(
        verifyV9FactoryDeployment(
          context({
            call: async (tx) =>
              sameAddress(tx.to, F.implementation) &&
              tx.data.startsWith(iface.getFunction(method).selector)
                ? iface.encodeFunctionResult(method, output)
                : provider.call(tx),
          }),
          F,
        ),
      );
    }
  }));

test("factory-only proof requires exact direct constructor, atomic initialization and complete initial default history", async () =>
  snapshotRun(async () => {
    const F = await emptyFactoryRegistry();
    await assert.rejects(
      verifyV9FactoryDeployment(
        context({
          getTransaction: async (txHash) => {
            const tx = await provider.getTransaction(txHash);
            return txHash === F.factoryDeploymentTxHash
              ? { ...tx, data: changed(tx.data) }
              : tx;
          },
        }),
        F,
      ),
      /constructor|initialization/,
    );
    await assert.rejects(
      verifyV9FactoryDeployment(
        context({
          getTransaction: async (txHash) => {
            const tx = await provider.getTransaction(txHash);
            return txHash === F.timelockDeploymentTxHash
              ? { ...tx, chainId: 10200n }
              : tx;
          },
        }),
        F,
      ),
      reject("DEPLOYMENT_REORG"),
    );
    const selectedTopic = factory.interface.getEvent(
      "EventImplementationSelected",
    ).topicHash;
    await assert.rejects(
      verifyV9FactoryDeployment(
        context({
          getLogs: async (filter) => {
            const logs = await provider.getLogs(filter);
            return sameAddress(filter.address, F.factory)
              ? logs.filter((log) => log.topics[0] !== selectedTopic)
              : logs;
          },
        }),
        F,
      ),
      reject("UNREVIEWED_UPGRADE_HISTORY"),
    );
    const head = await provider.getBlock("latest");
    await assert.rejects(
      verifyV9FactoryDeployment(
        context({
          getLogs: async (filter) => {
            const logs = await provider.getLogs(filter);
            if (!sameAddress(filter.address, F.factory)) return logs;
            return [
              ...logs,
              {
                ...factory.interface.encodeEventLog(
                  factory.interface.getEvent("Upgraded"),
                  [F.factoryImplementation],
                ),
                address: F.factory,
                transactionHash: h(88),
                blockNumber: head.number,
                blockHash: head.hash,
                index: 999,
                removed: false,
              },
            ];
          },
        }),
        F,
      ),
      reject("UNREVIEWED_UPGRADE_HISTORY"),
    );
  }));

test("factory-only proof follows queue-empty owner handover without rebinding its initial owner", async () =>
  snapshotRun(async () => {
    const F = await emptyFactoryRegistry(),
      next = await provider.getSigner(1);
    await send(timelock.transferOwnership(next.address, { gasLimit: 1000000 }));
    const pending = await verifyV9FactoryDeployment(context(), F);
    assert.equal(pending.upgrade.owner, owner.address);
    assert.equal(pending.upgrade.pendingOwner, next.address);
    await send(timelock.connect(next).acceptOwnership({ gasLimit: 1000000 }));
    const accepted = await verifyV9FactoryDeployment(context(), F);
    assert.equal(accepted.upgrade.owner, next.address);
    assert.equal(accepted.upgrade.initialOwner, F.initialUpgradeOwner);
    assert.equal(accepted.upgrade.pendingOwner, null);
    assert.equal(accepted.upgrade.pendingOperationCount, 0);
  }));

test("factory-only proof rechecks its final canonical head and raw chain after slow history reads", async () =>
  snapshotRun(async () => {
    const F = await emptyFactoryRegistry(),
      head = await provider.getBlock("latest");
    let headReads = 0;
    await assert.rejects(
      verifyV9FactoryDeployment(
        context({
          getBlock: async (tag) => {
            const block = await provider.getBlock(tag);
            return tag === head.number && ++headReads >= 2
              ? { ...block, hash: h(1234567) }
              : block;
          },
        }),
        F,
      ),
      reject("DEPLOYMENT_REORG"),
    );
    let chainReads = 0;
    await assert.rejects(
      verifyV9FactoryDeployment(
        context({
          send: async (method, params) => {
            if (method === "eth_chainId" && ++chainReads >= 2) return "0x27d8";
            return provider.send(method, params);
          },
        }),
        F,
      ),
      reject("WRONG_CHAIN"),
    );
  }));
