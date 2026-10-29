// Real in-process Ethereum-chain1 deployments; only Court adjudication is mocked.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { loadV10UpgradeableArtifacts } from "../src/v10-upgrade-artifacts.mjs";
import {
  V10_MAINNET_SCOPE,
  V10_IMPLEMENTATION_SLOT,
  verifyV10FactoryDeployment,
  verifyV10Deployment,
} from "../src/v10-upgrade-verification.mjs";

let rpc,
  provider,
  owner,
  other,
  artifacts,
  controller,
  factory,
  event,
  d,
  F,
  configuration,
  config,
  deploy,
  baseline;
const receipt = async (tx) => (await tx).wait();
const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(`../references/kickback/build/${name}.json`, import.meta.url),
    ),
  );
const provenance = Object.fromEntries(
  [
    ["v10BuildManifestSha256", "manifest"],
    ["v10StandardInputSha256", "standard-input"],
  ].map(([key, file]) => [
    key,
    hash(
      JSON.parse(
        fs.readFileSync(
          new URL(`../build/contracts-v10/${file}.json`, import.meta.url),
        ),
      ),
    ),
  ]),
);
const code = (expected) => (error) => error.code === expected;
function context(overrides = {}) {
  return {
    production: true,
    chainId: 1,
    manifest: { provenance },
    governance: {
      kind: "single-owner-immediate",
      initialOwner: d.initialUpgradeOwner,
      upgradeDelaySeconds: 0,
      renounceable: true,
    },
    provider: new Proxy(provider, {
      get(target, key) {
        const value = overrides[key] ?? target[key];
        return typeof value === "function"
          ? (...args) => value.apply(target, args)
          : value;
      },
    }),
  };
}
async function isolated(run) {
  const snap = await rpc.request({ method: "evm_snapshot", params: [] });
  try {
    return await run();
  } finally {
    await rpc.request({ method: "evm_revert", params: [snap] });
  }
}
async function recordFor(txReceipt, creator, key) {
  const created = txReceipt.logs
    .filter((log) => log.address === factory.target)
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log) => log?.name === "EventCreated");
  const block = await provider.getBlock(txReceipt.blockNumber);
  return {
    ...F,
    eventId: `synthetic-${key.slice(2, 10)}`,
    contract: created.args.eventContract,
    owner: creator,
    creator,
    codeHash: ethers.keccak256(artifacts.proxy.deployedBytecode),
    deploymentTxHash: txReceipt.hash,
    deploymentBlock: txReceipt.blockNumber,
    eventKey: key,
    factoryEventId: created.args.eventId,
    configurationHash: created.args.configurationHash,
    depositWei: String(config.depositAmount),
    eventName: config.eventName,
    eventStart: config.eventStart,
    claimDeadline: config.claimDeadline,
    resolver: config.arbitration.disputeResolver,
    arbitrator: await configuration.arbitrator(),
    arbitratorExtraData: config.arbitration.extraData,
    policyURI: config.arbitration.policyURI,
    templateHash: hash([
      config.arbitration.metaEvidenceTemplate,
      config.arbitration.metaEvidenceSlots,
    ]),
    depositOpensAt: block.timestamp,
    depositDeadline: config.eventStart,
  };
}
before(async () => {
  artifacts = loadV10UpgradeableArtifacts();
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 },
    wallet: { totalAccounts: 3, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  owner = await provider.getSigner(0);
  other = await provider.getSigner(1);
  deploy = async (a, ...args) => {
    const c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(
      ...args,
      { gasLimit: 16_000_000 },
    );
    await c.waitForDeployment();
    return c;
  };
  controller = await deploy(artifacts.controller, owner.address);
  const implementation = await deploy(artifacts.event),
    factoryImplementation = await deploy(artifacts.factory),
    born = await deploy(
      artifacts.proxy,
      factoryImplementation.target,
      factoryImplementation.interface.encodeFunctionData("initialize", [
        implementation.target,
        controller.target,
      ]),
    );
  factory = new ethers.Contract(born.target, artifacts.factory.abi, owner);
  const factoryBirth = await born.deploymentTransaction().wait(),
    controllerBirth = await controller.deploymentTransaction().wait();
  F = {
    contractVersion: V10_MAINNET_SCOPE.profile,
    abiVersion: V10_MAINNET_SCOPE.profile,
    chainId: 1,
    factory: factory.target,
    factoryCodeHash: ethers.keccak256(await provider.getCode(factory.target)),
    implementation: implementation.target,
    implementationCodeHash: ethers.keccak256(
      await provider.getCode(implementation.target),
    ),
    factoryImplementation: factoryImplementation.target,
    factoryImplementationCodeHash: ethers.keccak256(
      await provider.getCode(factoryImplementation.target),
    ),
    initialImplementation: implementation.target,
    initialFactoryImplementation: factoryImplementation.target,
    upgradeAuthority: controller.target,
    upgradeAuthorityCodeHash: ethers.keccak256(
      await provider.getCode(controller.target),
    ),
    initialUpgradeOwner: owner.address,
    factoryDeploymentTxHash: factoryBirth.hash,
    factoryDeploymentBlock: factoryBirth.blockNumber,
    controllerDeploymentTxHash: controllerBirth.hash,
    controllerDeploymentBlock: controllerBirth.blockNumber,
  };
  const liquid = await deploy(fixture("MockKlerosLiquid"));
  configuration = await deploy(fixture("MockArbitrableProxy"), liquid.target);
  const now = (await provider.getBlock("latest")).timestamp;
  config = {
    depositAmount: 1000000000000n,
    eventName: "Synthetic V10 verification",
    eventStart: now + 3600,
    claimDeadline: now + 8 * 86400,
    arbitration: {
      disputeResolver: configuration.target,
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
      policyURI: "https://example.invalid/v10-synthetic-policy",
    },
  };
  // Empty factory is a valid verified setup: creating an event is a separate operation.
  d = { ...F };
  baseline = await verifyV10FactoryDeployment(context(), F);
  assert.equal(await factory.eventCount(), 0n);
  const key = ethers.id("synthetic-v10-verification"),
    created = await receipt(
      factory.createEvent(key, config, { gasLimit: 8_000_000 }),
    );
  d = await recordFor(created, owner.address, key);
  event = new ethers.Contract(d.contract, artifacts.event.abi, owner);
});
after(async () => {
  provider?.destroy();
  await rpc?.disconnect();
});

test("V10 factory-only and canonical direct child proofs expose truthful immediate governance", async () => {
  const a = await verifyV10FactoryDeployment(context(), F),
    b = await verifyV10Deployment(context(), d);
  for (const result of [baseline, a, b]) {
    assert.equal(result.upgrade.version, 10);
    assert.equal(result.upgrade.verified, true);
    assert.equal(result.upgrade.governanceKind, "single-owner-immediate");
    assert.equal(result.upgrade.delaySeconds, 0);
    assert.equal(result.upgrade.owner, owner.address);
    assert.equal(result.upgrade.pendingOwner, ethers.ZeroAddress);
    assert.equal(result.upgrade.upgradesDisabled, false);
    assert.equal(result.upgrade.finalizationVerified, false);
    assert.equal(Object.hasOwn(result.upgrade, "pendingOperationCount"), false);
  }
  assert.equal(a.upgrade.finalizationScope, "factory");
  assert.equal(b.upgrade.finalizationScope, "event");
  assert.equal(b.factoryUpgrade.finalizationScope, "factory-proxy");
  assert.equal(a.eventImplementation, d.implementation);
  assert.equal(b.deploymentTrust.configurationHash, d.configurationHash);
  assert.equal(await factory.eventCount(), 1n);
});
test("exact profile, chain, approved source, and V10 controller schema fail closed", async () => {
  await assert.rejects(
    verifyV10Deployment(context(), {
      ...d,
      contractVersion: "kleros-event-v9-uups",
    }),
    code("WRONG_CHAIN"),
  );
  await assert.rejects(
    verifyV10Deployment(context(), d, { ...V10_MAINNET_SCOPE }),
    code("WRONG_CHAIN"),
  );
  const c = context();
  c.governance = { ...c.governance, minimumDelaySeconds: 0 };
  await assert.rejects(verifyV10Deployment(c, d), code("INVALID_GOVERNANCE"));
  await assert.rejects(
    verifyV10Deployment(context(), {
      ...d,
      timelockDeploymentBlock: d.controllerDeploymentBlock,
    }),
    code("UPGRADE_TRUST_MISMATCH"),
  );
  const unapproved = context();
  unapproved.manifest.provenance = {
    ...provenance,
    v10BuildManifestSha256: "0".repeat(64),
  };
  await assert.rejects(
    verifyV10Deployment(unapproved, d),
    code("V10_ARTIFACT_PROVENANCE"),
  );
  await assert.rejects(
    verifyV10Deployment(
      context({
        send: async (m, p) =>
          m === "eth_chainId" ? "0x2800" : provider.send(m, p),
      }),
      d,
    ),
    code("WRONG_CHAIN"),
  );
});
test("reviewed event terms/template/birth metadata and canonical source/slots are independently required", async () => {
  for (const changed of [
    { eventName: "forged" },
    { templateHash: "0".repeat(64) },
    { depositOpensAt: d.depositOpensAt + 1 },
    { configurationHash: ethers.ZeroHash },
    { factoryEventId: ethers.ZeroHash },
  ])
    await assert.rejects(
      verifyV10Deployment(context(), { ...d, ...changed }),
      code("UPGRADE_TRUST_MISMATCH"),
    );
  await assert.rejects(
    verifyV10Deployment(
      context({
        getCode: async (target, tag) =>
          target === d.contract ? "0x00" : provider.getCode(target, tag),
      }),
      d,
    ),
    code("WRONG_CONTRACT"),
  );
  await assert.rejects(
    verifyV10Deployment(
      context({
        send: async (m, p) =>
          m === "eth_getStorageAt" && p[1] === V10_IMPLEMENTATION_SLOT
            ? ethers.zeroPadValue(other.address, 32)
            : provider.send(m, p),
      }),
      d,
    ),
    code("IMPLEMENTATION_CHANGED"),
  );
});
test("full ownership nomination/replacement/cancel/accept history survives restart and renunciation is selected-scope final", () =>
  isolated(async () => {
    await receipt(controller.transferOwnership(other.address));
    assert.equal(
      (await verifyV10Deployment(context(), d)).upgrade.pendingOwner,
      other.address,
    );
    await receipt(controller.cancelOwnershipTransfer());
    assert.equal(
      (await verifyV10FactoryDeployment(context(), F)).upgrade.pendingOwner,
      ethers.ZeroAddress,
    );
    await receipt(controller.transferOwnership(other.address));
    await receipt(controller.connect(other).acceptOwnership());
    const transfer = await verifyV10Deployment(context(), d);
    assert.equal(transfer.upgrade.owner, other.address);
    // Renunciation clears a live pending nomination as well as the owner.
    await receipt(controller.connect(other).transferOwnership(owner.address));
    await receipt(controller.connect(other).renounceOwnership());
    const final = await verifyV10Deployment(context(), d),
      factoryFinal = await verifyV10FactoryDeployment(context(), F);
    for (const r of [final, factoryFinal]) {
      assert.equal(r.upgrade.owner, ethers.ZeroAddress);
      assert.equal(r.upgrade.pendingOwner, ethers.ZeroAddress);
      assert.equal(r.upgrade.upgradesDisabled, true);
      assert.equal(r.upgrade.finalizationVerified, true);
    }
    assert.equal(factoryFinal.upgrade.finalizationScope, "factory");
    assert.equal(final.upgrade.finalizationScope, "event");
  }));
test("postbirth default/rollback history is rejected independently of getters and scoped away from existing children", () =>
  isolated(async () => {
    // The real contract rejects a same-revision default. An injected canonical log
    // then models an upgrade+rollback: current getters alone cannot prove history.
    await assert.rejects(
      controller.setEventImplementation.staticCall(d.factory, d.implementation),
    );
    const block = await provider.getBlock("latest"),
      encoded = controller.interface.encodeEventLog(
        controller.interface.getEvent("EventImplementationForwarded"),
        [d.factory, d.implementation],
      );
    const c = context({
      getLogs: async (filter) => {
        const logs = await provider.getLogs(filter),
          addresses = Array.isArray(filter.address)
            ? filter.address
            : [filter.address];
        if (
          addresses.some(
            (x) => x.toLowerCase() === d.upgradeAuthority.toLowerCase(),
          ) &&
          filter.fromBlock <= block.number &&
          filter.toBlock >= block.number
        )
          logs.push({
            address: d.upgradeAuthority,
            ...encoded,
            blockNumber: block.number,
            blockHash: block.hash,
            transactionHash: d.deploymentTxHash,
            index: 999,
            removed: false,
          });
        return logs;
      },
    });
    await assert.rejects(
      verifyV10FactoryDeployment(c, F),
      code("UNREVIEWED_UPGRADE_HISTORY"),
    );
    assert.equal(
      (await verifyV10Deployment(c, d)).upgrade.implementation,
      d.implementation,
    );
  }));
test("a canonical selected block does not hide an immediate authority change during the slow proof", () =>
  isolated(async () => {
    let changed = false;
    const c = context({
      getLogs: async (filter) => {
        const logs = await provider.getLogs(filter);
        if (!changed) {
          changed = true;
          await receipt(controller.transferOwnership(other.address));
        }
        return logs;
      },
    });
    await assert.rejects(
      verifyV10Deployment(c, d),
      code("IMPLEMENTATION_CHANGED"),
    );
    assert.equal(changed, true);
  }));
test("ownership change-and-cancel during proof is rejected even when closing owner/pending getters match", () =>
  isolated(async () => {
    let changed = false;
    const c = context({
      getLogs: async (filter) => {
        const logs = await provider.getLogs(filter);
        if (!changed) {
          changed = true;
          await receipt(controller.transferOwnership(other.address));
          await receipt(controller.cancelOwnershipTransfer());
        }
        return logs;
      },
    });
    await assert.rejects(
      verifyV10Deployment(c, d),
      code("UNREVIEWED_UPGRADE_HISTORY"),
    );
  }));
test("closing canonical guard detects changed authority block while all older birth blocks remain canonical", async () => {
  let latest = 0,
    guardNumber;
  const c = context({
    send: async (m, p) => {
      const raw = await provider.send(m, p);
      if (m === "eth_getBlockByNumber" && p[0] === "latest") {
        latest++;
        if (latest === 2) guardNumber = raw.number;
      }
      if (m === "eth_getBlockByNumber" && latest >= 2 && p[0] === guardNumber)
        return { ...raw, hash: ethers.id("orphaned guard") };
      return raw;
    },
  });
  await assert.rejects(verifyV10Deployment(c, d), code("DEPLOYMENT_REORG"));
});
test("wrapped real child birth requires a trusted exact factual intent proof; manifest/client proof never authorizes it", () =>
  isolated(async () => {
    const wrapper = await deploy(fixture("TestWallet")),
      key = ethers.id("v10-real-forwarded-child"),
      data = factory.interface.encodeFunctionData("createEvent", [key, config]),
      created = await receipt(
        wrapper.exec(d.factory, data, { gasLimit: 8_000_000 }),
      ),
      wrapped = await recordFor(created, wrapper.target, key);
    await assert.rejects(
      verifyV10Deployment(context(), {
        ...wrapped,
        assertTransactionIntent: () => true,
      }),
      code("UPGRADE_TRUST_MISMATCH"),
    );
    const c = context();
    let called = 0;
    c.assertTransactionIntent = async (actual, expected) => {
      called++;
      assert.equal(actual.to, wrapper.target);
      assert.equal(actual.hash, created.hash);
      assert.equal(expected.from, wrapper.target);
      assert.equal(expected.to, d.factory);
      assert.equal(expected.data, data);
      assert.equal(Object.isFrozen(expected), true);
      const decoded = wrapper.interface.parseTransaction({
        data: actual.data,
        value: actual.value,
      });
      assert.equal(decoded.name, "exec");
      assert.equal(decoded.args.target, d.factory);
      assert.equal(decoded.args.data, expected.data);
      return {
        verified: true,
        chainId: 1,
        transactionHash: actual.hash,
        from: expected.from,
        to: expected.to,
        valueWei: "0",
        dataHash: ethers.keccak256(expected.data),
      };
    };
    assert.equal(
      (await verifyV10Deployment(c, wrapped)).deploymentTrust.status,
      "verified",
    );
    assert.equal(called, 1);
    c.assertTransactionIntent = async () => ({
      verified: true,
      chainId: 1,
      transactionHash: ethers.ZeroHash,
    });
    await assert.rejects(
      verifyV10Deployment(c, wrapped),
      code("UPGRADE_TRUST_MISMATCH"),
    );
  }));

test("trusted hook cannot mutate the actual authorizationList while returning an exact intent proof", () =>
  isolated(async () => {
    const wrapper = await deploy(fixture("TestWallet")),
      key = ethers.id("v10-mutation-guard-child"),
      data = factory.interface.encodeFunctionData("createEvent", [key, config]),
      created = await receipt(
        wrapper.exec(d.factory, data, { gasLimit: 8_000_000 }),
      ),
      wrapped = await recordFor(created, wrapper.target, key),
      c = context();
    const exactProof = (actual, expected) => ({
      verified: true,
      chainId: 1,
      transactionHash: actual.hash,
      from: expected.from,
      to: expected.to,
      valueWei: "0",
      dataHash: ethers.keccak256(expected.data),
    });
    c.assertTransactionIntent = async (actual, expected) => {
      assert.equal(actual.hash, created.hash);
      assert.equal(actual.authorizationList, null);
      return exactProof(actual, expected);
    };
    assert.equal(
      (await verifyV10Deployment(c, wrapped)).deploymentTrust.status,
      "verified",
    );
    let mutated = false;
    c.assertTransactionIntent = async (actual, expected) => {
      const proof = exactProof(actual, expected);
      // The deliberately bad trusted adapter mutates only the additional envelope
      // field: every old hash/from/to/value/data/nonce check would still pass.
      actual.authorizationList = [
        { chainId: 1n, address: other.address, nonce: 0n },
      ];
      mutated = true;
      return proof;
    };
    await assert.rejects(
      verifyV10Deployment(c, wrapped),
      code("UPGRADE_TRUST_MISMATCH"),
    );
    assert.equal(mutated, true);
    // The test did not alter the node's canonical transaction or any chain state.
    assert.equal(
      (await provider.getTransaction(created.hash)).authorizationList,
      null,
    );
    assert.equal(await factory.eventFor(wrapper.target, key), wrapped.contract);
  }));
