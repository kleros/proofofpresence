// V10-only canonical provenance. V9 timelock rules and verifiers are never dispatched here.
import { ethers } from "ethers";
import { hash } from "./utils.mjs";
import {
  verifyV10ArtifactSources,
  loadV10UpgradeableArtifacts,
} from "./v10-upgrade-artifacts.mjs";
import { v10RuntimeCode } from "../scripts/mainnet/v10-runtime-code.mjs";
import { v10ReadBatch, v10CodeHashBatch } from "./v10-read-batch.mjs";

export const V10_MAINNET_SCOPE = Object.freeze({
  profile: "kleros-event-v10-uups",
  chainId: 1,
});
export const V10_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EVENT_FAMILY = ethers.id("kleros.event.v10.uups"),
  FACTORY_FAMILY = ethers.id("kleros.factory.v10.uups"),
  EVENT_SCHEMA = ethers.id("kleros.event.v10.storage.1"),
  FACTORY_SCHEMA = ethers.id("kleros.factory.v10.storage.1");
const CONFIG =
  "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
const read = (contract, method, args = []) => ({ contract, method, args });
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const address = (x) => ethers.isAddress(x) && !same(x, ethers.ZeroAddress),
  bytes32 = (x) => ethers.isHexString(x, 32),
  positive = (x) => Number.isSafeInteger(x) && x > 0;
const check = (ok, message, code = "UPGRADE_TRUST_MISMATCH") => {
  if (!ok) throw Object.assign(new Error(message), { code, status: 409 });
};
function registry(chain, d, scope, child) {
  check(
    scope === V10_MAINNET_SCOPE &&
      d?.contractVersion === scope.profile &&
      d.abiVersion === scope.profile &&
      d.chainId === 1,
    "Only the exact Ethereum V10 verification profile is supported",
    "WRONG_CHAIN",
  );
  for (const key of [
    "factory",
    "implementation",
    "factoryImplementation",
    "initialImplementation",
    "initialFactoryImplementation",
    "upgradeAuthority",
    "initialUpgradeOwner",
    ...(child
      ? ["contract", "owner", "creator", "resolver", "arbitrator"]
      : []),
  ])
    check(address(d[key]), "Missing trusted V10 address");
  for (const key of [
    "factoryCodeHash",
    "implementationCodeHash",
    "factoryImplementationCodeHash",
    "upgradeAuthorityCodeHash",
    "factoryDeploymentTxHash",
    "controllerDeploymentTxHash",
    ...(child
      ? [
          "codeHash",
          "deploymentTxHash",
          "eventKey",
          "factoryEventId",
          "configurationHash",
        ]
      : []),
  ])
    check(bytes32(d[key]), "Missing trusted V10 digest");
  for (const key of [
    "factoryDeploymentBlock",
    "controllerDeploymentBlock",
    ...(child ? ["deploymentBlock"] : []),
  ])
    check(positive(d[key]), "Missing V10 birth block");
  check(
    !Object.hasOwn(d, "timelockDeploymentBlock") &&
      !Object.hasOwn(d, "timelockDeploymentTxHash") &&
      !Object.hasOwn(d, "projectMultisig") &&
      (d.implementationRevision === undefined ||
        d.implementationRevision === 1) &&
      (d.factoryImplementationRevision === undefined ||
        d.factoryImplementationRevision === 1),
    "Unreviewed V10 registry revision or governance aliases",
  );
  const identities = [
    d.factory,
    d.implementation,
    d.factoryImplementation,
    d.upgradeAuthority,
    d.initialUpgradeOwner,
    ...(child ? [d.contract] : []),
  ];
  check(
    new Set(identities.map((x) => x.toLowerCase())).size ===
      identities.length &&
      (!child || (same(d.owner, d.creator) && d.eventKey !== ethers.ZeroHash)),
    "V10 proxy, implementation and authority identities must be distinct",
  );
  const g = chain.governance;
  check(
    g &&
      Object.keys(g).sort().join() ===
        "initialOwner,kind,renounceable,upgradeDelaySeconds" &&
      g.kind === "single-owner-immediate" &&
      same(g.initialOwner, d.initialUpgradeOwner) &&
      g.upgradeDelaySeconds === 0 &&
      g.renounceable === true,
    "V10 requires explicitly reviewed immediate owner governance",
    "INVALID_GOVERNANCE",
  );
}
async function blockAt(provider, tag) {
  const raw = await provider.send("eth_getBlockByNumber", [
    typeof tag === "number" ? ethers.toQuantity(tag) : tag,
    false,
  ]);
  check(
    raw && bytes32(raw.hash) && raw.number && raw.timestamp,
    "V10 canonical block is unavailable",
    "DEPLOYMENT_REORG",
  );
  const number = Number(BigInt(raw.number)),
    timestamp = Number(BigInt(raw.timestamp));
  check(
    positive(number) && Number.isSafeInteger(timestamp) && timestamp >= 0,
    "Malformed V10 canonical block",
    "DEPLOYMENT_REORG",
  );
  return { number, hash: raw.hash, timestamp };
}
function anchor(anchors, number, blockHash) {
  check(
    positive(number) &&
      bytes32(blockHash) &&
      (!anchors.has(number) || same(anchors.get(number), blockHash)),
    "Conflicting V10 canonical anchors",
    "DEPLOYMENT_REORG",
  );
  anchors.set(number, blockHash);
}
async function birth(provider, txHash, number, anchors) {
  const [tx, receipt, block] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
    blockAt(provider, number),
  ]);
  check(
    tx &&
      receipt?.status === 1 &&
      same(tx.hash, txHash) &&
      same(receipt.hash ?? receipt.transactionHash, txHash) &&
      BigInt(tx.chainId) === 1n &&
      tx.blockNumber === number &&
      receipt.blockNumber === number &&
      same(tx.blockHash, block.hash) &&
      same(receipt.blockHash, block.hash),
    "V10 birth transaction is not canonical",
    "DEPLOYMENT_REORG",
  );
  anchor(anchors, number, block.hash);
  return { tx, receipt, block };
}
function logsIn(receipt, target, iface, name) {
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
function initialized(b, target, iface, implementation) {
  const upgraded = logsIn(b.receipt, target, iface, "Upgraded"),
    init = logsIn(b.receipt, target, iface, "Initialized");
  check(
    upgraded.length === 1 &&
      same(upgraded[0].args.implementation, implementation) &&
      init.length === 1 &&
      init[0].args.version === 1n,
    "V10 proxy atomic initialization differs from source",
  );
}
async function scan(provider, targets, topics, from, to, anchors) {
  const out = [],
    seen = new Set();
  for (let start = from; start <= to; start += 5000) {
    const end = Math.min(start + 4999, to),
      rows = await provider.getLogs({
        address: targets,
        topics: [topics],
        fromBlock: start,
        toBlock: end,
      });
    check(
      out.length + rows.length <= 10000,
      "V10 history exceeds reviewed bounds",
    );
    for (const log of rows) {
      const number = log.blockNumber,
        index = log.index ?? log.logIndex,
        key = `${number}:${index}`;
      check(
        (Array.isArray(targets) ? targets : [targets]).some((target) =>
          same(target, log.address),
        ) &&
          !log.removed &&
          positive(number) &&
          number >= start &&
          number <= end &&
          bytes32(log.transactionHash) &&
          bytes32(log.blockHash) &&
          Number.isSafeInteger(index) &&
          index >= 0 &&
          !seen.has(key),
        "Malformed or duplicate V10 history log",
      );
      anchor(anchors, number, log.blockHash);
      seen.add(key);
      out.push(log);
    }
  }
  return out.sort(
    (a, b) =>
      a.blockNumber - b.blockNumber ||
      (a.index ?? a.logIndex) - (b.index ?? b.logIndex),
  );
}
const CONTROLLER_EVENTS = [
  "OwnershipTransferred",
  "OwnershipTransferStarted",
  "UpgradeForwarded",
  "EventImplementationForwarded",
];
function relevantController(parsed, d, child) {
  return (
    parsed.name.startsWith("Ownership") ||
    (parsed.name === "UpgradeForwarded" &&
      (same(parsed.args.proxy, d.factory) ||
        (child && same(parsed.args.proxy, d.contract)))) ||
    (!child &&
      parsed.name === "EventImplementationForwarded" &&
      same(parsed.args.factory, d.factory))
  );
}
async function controllerState(provider, controller, artifact, at) {
  const idle = artifact.storageLayout.storage.find(
    (item) => item.label === "_locked",
  );
  check(idle && idle.offset === 0, "Controller idle storage layout differs");
  const [[owner, pendingOwner, disabled, version, delay], lock] =
    await Promise.all([
      v10ReadBatch(provider, ["owner", "pendingOwner", "upgradesDisabled", "VERSION", "UPGRADE_DELAY_SECONDS"].map(method => read(controller, method)), at.blockTag),
      provider.send("eth_getStorageAt", [
        controller.target,
        ethers.toQuantity(BigInt(idle.slot)),
        ethers.toQuantity(at.blockTag),
      ]),
    ]);
  check(
    ethers.isAddress(owner) &&
      ethers.isAddress(pendingOwner) &&
      version === 10n &&
      delay === 0n &&
      disabled === same(owner, ethers.ZeroAddress) &&
      (!disabled || same(pendingOwner, ethers.ZeroAddress)) &&
      BigInt(lock) === 1n,
    "V10 controller current authority or disabled state differs",
  );
  return { owner, pendingOwner, upgradesDisabled: disabled };
}
async function controllerHistory(
  provider,
  controller,
  d,
  block,
  anchors,
  artifact,
  child,
) {
  const topics = CONTROLLER_EVENTS.map(
      (name) => controller.interface.getEvent(name).topicHash,
    ),
    logs = await scan(
      provider,
      d.upgradeAuthority,
      topics,
      d.controllerDeploymentBlock,
      block.number,
      anchors,
    );
  let owner = null,
    pendingOwner = ethers.ZeroAddress;
  for (const log of logs) {
    const parsed = controller.interface.parseLog(log);
    check(parsed, "Unknown V10 controller log");
    if (parsed.name === "OwnershipTransferred") {
      if (owner === null) {
        check(
          same(parsed.args.previousOwner, ethers.ZeroAddress) &&
            same(parsed.args.newOwner, d.initialUpgradeOwner) &&
            log.blockNumber === d.controllerDeploymentBlock &&
            same(log.transactionHash, d.controllerDeploymentTxHash),
          "V10 initial controller ownership differs",
        );
      } else
        check(
          !same(owner, ethers.ZeroAddress) &&
            same(parsed.args.previousOwner, owner) &&
            (same(parsed.args.newOwner, ethers.ZeroAddress) ||
              (!same(pendingOwner, ethers.ZeroAddress) &&
                same(parsed.args.newOwner, pendingOwner))),
          "V10 ownership acceptance or renunciation history differs",
        );
      owner = parsed.args.newOwner;
      pendingOwner = ethers.ZeroAddress;
    } else if (parsed.name === "OwnershipTransferStarted") {
      check(
        owner &&
          !same(owner, ethers.ZeroAddress) &&
          same(parsed.args.previousOwner, owner) &&
          (same(parsed.args.newOwner, ethers.ZeroAddress)
            ? !same(pendingOwner, ethers.ZeroAddress)
            : address(parsed.args.newOwner) &&
              !same(parsed.args.newOwner, owner) &&
              !same(parsed.args.newOwner, d.upgradeAuthority)),
        "V10 nomination/cancellation history differs",
      );
      pendingOwner = parsed.args.newOwner;
    } else {
      check(
        owner && !same(owner, ethers.ZeroAddress),
        "V10 controller forwarded after renunciation",
      );
      check(
        !relevantController(parsed, d, child),
        "Unreviewed V10 forwarded upgrade or factory default history",
        "UNREVIEWED_UPGRADE_HISTORY",
      );
    }
  }
  check(owner !== null, "V10 initial controller ownership is missing");
  const current = await controllerState(provider, controller, artifact, {
    blockTag: block.number,
  });
  check(
    same(current.owner, owner) && same(current.pendingOwner, pendingOwner),
    "V10 current owner differs from complete controller history",
  );
  return current;
}
async function proxyHistory(
  provider,
  d,
  block,
  anchors,
  factory,
  child,
  initialEventHash,
) {
  const expected = new Map([
    [
      d.factory.toLowerCase(),
      {
        block: d.factoryDeploymentBlock,
        txHash: d.factoryDeploymentTxHash,
        implementation: d.initialFactoryImplementation,
      },
    ],
    ...(child
      ? [
          [
            d.contract.toLowerCase(),
            {
              block: d.deploymentBlock,
              txHash: d.deploymentTxHash,
              implementation: d.initialImplementation,
            },
          ],
        ]
      : []),
  ]);
  const topics = [
      factory.interface.getEvent("Upgraded").topicHash,
      ...(!child
        ? [factory.interface.getEvent("EventImplementationSelected").topicHash]
        : []),
    ],
    from = Math.min(...[...expected.values()].map((item) => item.block)),
    seen = new Set(),
    logs = await scan(
      provider,
      [...expected.keys()],
      topics,
      from,
      block.number,
      anchors,
    );
  for (const log of logs) {
    const entry = expected.get(log.address.toLowerCase()),
      parsed = factory.interface.parseLog(log),
      key = `${log.address.toLowerCase()}:${parsed?.name}`;
    check(
      parsed &&
        entry &&
        !seen.has(key) &&
        log.blockNumber === entry.block &&
        same(log.transactionHash, entry.txHash),
      "Unreviewed V10 proxy/default history",
      "UNREVIEWED_UPGRADE_HISTORY",
    );
    seen.add(key);
    if (parsed.name === "Upgraded")
      check(
        same(parsed.args.implementation, entry.implementation),
        "V10 initial implementation history differs",
      );
    else
      check(
        !child &&
          same(log.address, d.factory) &&
          same(parsed.args.implementation, d.initialImplementation) &&
          same(parsed.args.codeHash, initialEventHash) &&
          parsed.args.revision === 1n,
        "V10 initial default history differs",
      );
  }
  check(
    seen.size === expected.size + (child ? 0 : 1),
    "V10 initial upgrade/default history is incomplete",
    "UNREVIEWED_UPGRADE_HISTORY",
  );
}
const transactionSnapshot = (tx) =>
  hash(
    Object.fromEntries(
      [
        "hash",
        "chainId",
        "from",
        "to",
        "value",
        "data",
        "nonce",
        "blockHash",
        "blockNumber",
        "type",
        "authorizationList",
        "accessList",
        "signature",
        "gasLimit",
        "gasPrice",
        "maxFeePerGas",
        "maxPriorityFeePerGas",
        "maxFeePerBlobGas",
        "blobVersionedHashes",
      ].map((key) => [key, tx[key]]),
    ),
  );
async function transactionIntent(chain, tx, expected) {
  if (
    same(tx.from, expected.from) &&
    (expected.to === null ? tx.to === null : same(tx.to, expected.to)) &&
    tx.value === 0n &&
    same(tx.data, expected.data)
  )
    return;
  check(
    typeof chain.assertTransactionIntent === "function",
    "V10 creation calldata/identity differs from the reviewed direct intent",
  );
  const snapshot = transactionSnapshot(tx),
    intent = Object.freeze({
      chainId: 1,
      transactionHash: tx.hash,
      from: expected.from,
      to: expected.to,
      valueWei: "0",
      data: expected.data,
    }),
    proof = await chain.assertTransactionIntent(tx, intent);
  check(
    snapshot === transactionSnapshot(tx) &&
      proof?.verified === true &&
      proof.chainId === 1 &&
      same(proof.transactionHash, tx.hash) &&
      same(proof.from, expected.from) &&
      (expected.to === null
        ? proof.to === null
        : same(proof.to, expected.to)) &&
      proof.valueWei === "0" &&
      same(proof.dataHash, ethers.keccak256(expected.data)),
    "Trusted V10 transaction-intent proof differs from the canonical transaction",
  );
}

async function verify(chain, d, scope, child) {
  registry(chain, d, scope, child);
  const approved = verifyV10ArtifactSources(chain.manifest?.provenance),
    artifacts = loadV10UpgradeableArtifacts();
  for (const [key, name] of [
    ["event", "KlerosEventV10"],
    ["factory", "KlerosEventFactoryV10"],
    ["controller", "KlerosUpgradeControllerV10"],
    ["proxy", "ERC1967Proxy"],
  ]) {
    const a = artifacts[key],
      pin = approved.contracts[name];
    check(
      ethers.keccak256(a.bytecode) === pin.creationCodeHash &&
        ethers.keccak256(a.deployedBytecode) === pin.unpatchedRuntimeCodeHash &&
        hash(a.abi) === pin.abiSha256 &&
        hash(a.storageLayout) === pin.storageLayoutSha256 &&
        hash(a.immutableReferences) === hash(pin.immutableReferences) &&
        hash(a.immutableValues) === hash(pin.immutableValues),
      "V10 loaded artifacts left approved pins",
    );
  }
  const provider = chain.provider;
  check(
    BigInt(await provider.send("eth_chainId", [])) === 1n,
    "V10 RPC is not Ethereum",
    "WRONG_CHAIN",
  );
  const block = await blockAt(provider, "latest"),
    anchors = new Map([[block.number, block.hash]]),
    at = { blockTag: block.number };
  check(
    Math.max(
      d.controllerDeploymentBlock,
      d.factoryDeploymentBlock,
      child ? d.deploymentBlock : 0,
    ) <= block.number,
    "V10 birth is ahead of canonical head",
  );
  const controllerHash = ethers.keccak256(
      artifacts.controller.deployedBytecode,
    ),
    proxyHash = ethers.keccak256(artifacts.proxy.deployedBytecode),
    runtime = (a, implementation) =>
      v10RuntimeCode(a, implementation, controllerHash),
    factory = new ethers.Contract(d.factory, artifacts.factory.abi, provider),
    controller = new ethers.Contract(
      d.upgradeAuthority,
      artifacts.controller.abi,
      provider,
    ),
    event = new ethers.Contract(
      child ? d.contract : d.implementation,
      artifacts.event.abi,
      provider,
    ),
    eventImplementation = new ethers.Contract(
      d.implementation,
      artifacts.event.abi,
      provider,
    ),
    factoryImplementation = new ethers.Contract(
      d.factoryImplementation,
      artifacts.factory.abi,
      provider,
    );
  check(
    same(d.factoryCodeHash, proxyHash) &&
      same(d.upgradeAuthorityCodeHash, controllerHash) &&
      (!child || same(d.codeHash, proxyHash)),
    "V10 proxy/controller source pins differ",
  );
  const targets = [
      [d.factory, artifacts.proxy.deployedBytecode],
      [d.implementation, runtime(artifacts.event, d.implementation)],
      [
        d.factoryImplementation,
        runtime(artifacts.factory, d.factoryImplementation),
      ],
      [d.upgradeAuthority, artifacts.controller.deployedBytecode],
      ...(child ? [[d.contract, artifacts.proxy.deployedBytecode]] : []),
    ],
    proxies = [d.factory, ...(child ? [d.contract] : [])];
  const currentCode = async (number) => {
    const [codes, slots] = await Promise.all([
      v10CodeHashBatch(provider, targets.map(([target]) => target), number),
      Promise.all(
        proxies.map((target) =>
          provider.send("eth_getStorageAt", [
            target,
            V10_IMPLEMENTATION_SLOT,
            ethers.toQuantity(number),
          ]),
        ),
      ),
    ]);
    codes.forEach((code, i) =>
      check(
        same(code, ethers.keccak256(targets[i][1])),
        "V10 current runtime differs from reviewed source",
        "WRONG_CONTRACT",
      ),
    );
    slots.forEach((slot, i) =>
      check(
        bytes32(slot) &&
          same(
            slot,
            ethers.zeroPadValue(
              i === 0 ? d.factoryImplementation : d.implementation,
              32,
            ),
          ),
        "V10 implementation slot changed",
        "IMPLEMENTATION_CHANGED",
      ),
    );
    check(
      same(codes[1], d.implementationCodeHash) &&
        same(codes[2], d.factoryImplementationCodeHash),
      "V10 implementation digest differs",
    );
  };
  await currentCode(block.number);
  const identities = await v10ReadBatch(provider, [
    ...[event, factory].flatMap(c => ["VERSION", "UPGRADE_FAMILY", "implementationRevision", "storageSchema"].map(method => read(c, method))),
    read(factory, "upgradeAuthority"),
    read(child ? event : factory, "upgradeAuthority"),
    read(eventImplementation, "proxiableUUID"),
    read(factoryImplementation, "proxiableUUID"),
    read(factory, "proxyCreationCodeHash"),
    ...(!child ? [read(factory, "eventImplementation")] : []),
  ], block.number);
  const eventIdentity = identities.slice(0, 4), factoryIdentity = identities.slice(4, 8),
    [authority, eventAuthority, eventUuid, factoryUuid, creationHash, selected = null] = identities.slice(8),
    uuids = [eventUuid, factoryUuid];
  for (const [result, family, schema] of [
    [eventIdentity, EVENT_FAMILY, EVENT_SCHEMA],
    [factoryIdentity, FACTORY_FAMILY, FACTORY_SCHEMA],
  ])
    check(
      result[0] === 10n &&
        result[1] === family &&
        result[2] === 1n &&
        result[3] === schema,
      "V10 family/schema/version/revision differs",
    );
  check(
    same(authority, d.upgradeAuthority) &&
      same(eventAuthority, d.upgradeAuthority) &&
      uuids.every((value) => value === V10_IMPLEMENTATION_SLOT) &&
      same(creationHash, ethers.keccak256(artifacts.proxy.bytecode)) &&
      (child || same(selected, d.implementation)),
    "V10 authority, UUID or future-child default differs",
  );
  const governance = await controllerHistory(
      provider,
      controller,
      d,
      block,
      anchors,
      artifacts.controller,
      child,
    ),
    births = await Promise.all([
      birth(
        provider,
        d.controllerDeploymentTxHash,
        d.controllerDeploymentBlock,
        anchors,
      ),
      birth(
        provider,
        d.factoryDeploymentTxHash,
        d.factoryDeploymentBlock,
        anchors,
      ),
      ...(child
        ? [birth(provider, d.deploymentTxHash, d.deploymentBlock, anchors)]
        : []),
    ]),
    [controllerBirth, factoryBirth, eventBirth] = births;
  for (const [b, target, data] of [
    [
      controllerBirth,
      d.upgradeAuthority,
      artifacts.controller.bytecode +
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
  ]) {
    check(
      b.tx.to === null &&
        b.tx.value === 0n &&
        same(b.tx.from, d.initialUpgradeOwner) &&
        same(b.tx.data, data) &&
        same(b.receipt.contractAddress, target) &&
        same(
          ethers.getCreateAddress({ from: b.tx.from, nonce: b.tx.nonce }),
          target,
        ),
      "V10 historical constructor/atomic initialization differs",
    );
  }
  initialized(
    factoryBirth,
    d.factory,
    factory.interface,
    d.initialFactoryImplementation,
  );
  const initialEventCode = runtime(artifacts.event, d.initialImplementation),
    initialFactoryCode = runtime(
      artifacts.factory,
      d.initialFactoryImplementation,
    ),
    historyTargets = [
      [d.initialImplementation, d.factoryDeploymentBlock, initialEventCode],
      [
        d.initialFactoryImplementation,
        d.factoryDeploymentBlock,
        initialFactoryCode,
      ],
      [
        d.upgradeAuthority,
        d.controllerDeploymentBlock,
        artifacts.controller.deployedBytecode,
      ],
      [d.factory, d.factoryDeploymentBlock, artifacts.proxy.deployedBytecode],
      ...(child
        ? [[d.contract, d.deploymentBlock, artifacts.proxy.deployedBytecode]]
        : []),
    ];
  const historicalBlocks = [...new Set(historyTargets.map(([, number]) => number))];
  await Promise.all(historicalBlocks.map(async number => {
    const rows = historyTargets.filter(([, block]) => block === number);
    const codes = await v10CodeHashBatch(provider, rows.map(([target]) => target), number);
    codes.forEach((code, i) => check(same(code, ethers.keccak256(rows[i][2])),
      "V10 historical runtime differs from source", "WRONG_CONTRACT"));
  }));
  const initial = logsIn(
    factoryBirth.receipt,
    d.factory,
    factory.interface,
    "EventImplementationSelected",
  );
  check(
    initial.length === 1 &&
      same(initial[0].args.implementation, d.initialImplementation) &&
      same(initial[0].args.codeHash, ethers.keccak256(initialEventCode)) &&
      initial[0].args.revision === 1n,
    "V10 original factory default differs",
  );
  if (child) {
    const template = await event.metaEvidenceTemplate(at),
      cfg = {
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
      },
      configurationHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", CONFIG],
          [d.creator, cfg],
        ),
      ),
      factoryId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32"],
          [1, d.factory, d.creator, d.eventKey],
        ),
      );
    check(
      same(configurationHash, d.configurationHash) &&
        same(factoryId, d.factoryEventId) &&
        hash([[...template[0]], template[1]]) === d.templateHash,
      "V10 original event configuration/template differs",
    );
    await transactionIntent(chain, eventBirth.tx, {
      from: d.creator,
      to: d.factory,
      data: factory.interface.encodeFunctionData("createEvent", [
        d.eventKey,
        cfg,
      ]),
    });
    const created = logsIn(
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
        created[0].args.version === 10n &&
        same(created[0].args.configurationHash, configurationHash),
      "V10 exact factory EventCreated proof is missing",
    );
    initialized(
      eventBirth,
      d.contract,
      event.interface,
      d.initialImplementation,
    );
    const values = await v10ReadBatch(provider, [
      ...["depositAmount", "eventName", "eventStart", "claimDeadline", "disputeResolver", "arbitrator", "policyURI", "arbitratorExtraData", "CHALLENGE_PERIOD", "MATCH_PERIOD", "MAX_STAKERS", "originatingFactory"].map(method => read(event, method)),
      read(factory, "isEvent", [d.contract]),
      read(factory, "eventsById", [factoryId]),
      read(factory, "eventId", [d.creator, d.eventKey]),
      read(factory, "eventFor", [d.creator, d.eventKey]),
    ], block.number);
    check(
      String(values[0]) === d.depositWei &&
        values[1] === d.eventName &&
        Number(values[2]) === d.eventStart &&
        Number(values[3]) === d.claimDeadline &&
        same(values[4], d.resolver) &&
        same(values[5], d.arbitrator) &&
        values[6] === d.policyURI &&
        values[7] === d.arbitratorExtraData &&
        values[8] === 86400n &&
        values[9] === 86400n &&
        values[10] === 150n &&
        same(values[11], d.factory) &&
        values[12] &&
        same(values[13], d.contract) &&
        same(values[14], factoryId) &&
        same(values[15], d.contract),
      "V10 current event terms, origin or factory membership differs",
    );
    check(
      d.depositOpensAt === eventBirth.block.timestamp &&
        d.depositDeadline === d.eventStart,
      "V10 deposit time metadata differs from birth",
    );
  }
  await proxyHistory(
    provider,
    d,
    block,
    anchors,
    factory,
    child,
    ethers.keccak256(initialEventCode),
  );
  // Immediate upgrades can happen during the slow proof while M remains canonical.
  const current = await blockAt(provider, "latest");
  check(
    current.number >= block.number,
    "V10 head moved behind the proof",
    "DEPLOYMENT_REORG",
  );
  anchor(anchors, current.number, current.hash);
  await currentCode(current.number);
  const closingGovernance = await controllerState(
    provider,
    controller,
    artifacts.controller,
    { blockTag: current.number },
  );
  check(
    hash(closingGovernance) === hash(governance),
    "V10 authority changed during verification",
    "IMPLEMENTATION_CHANGED",
  );
  if (!child)
    check(
      same(
        await factory.eventImplementation({ blockTag: current.number }),
        d.implementation,
      ),
      "V10 default changed during verification",
      "IMPLEMENTATION_CHANGED",
    );
  if (current.number > block.number) {
    const delta = await scan(
      provider,
      d.upgradeAuthority,
      CONTROLLER_EVENTS.map(
        (name) => controller.interface.getEvent(name).topicHash,
      ),
      block.number + 1,
      current.number,
      anchors,
    );
    check(
      delta.every(
        (log) =>
          !relevantController(controller.interface.parseLog(log), d, child),
      ),
      "V10 authority/forwarding history changed during verification",
      "UNREVIEWED_UPGRADE_HISTORY",
    );
    const changes = await scan(
      provider,
      proxies,
      [
        factory.interface.getEvent("Upgraded").topicHash,
        ...(!child
          ? [
              factory.interface.getEvent("EventImplementationSelected")
                .topicHash,
            ]
          : []),
      ],
      block.number + 1,
      current.number,
      anchors,
    );
    check(
      changes.length === 0,
      "V10 proxy/default changed during verification",
      "UNREVIEWED_UPGRADE_HISTORY",
    );
  }
  check(
    BigInt(await provider.send("eth_chainId", [])) === 1n,
    "V10 RPC chain changed",
    "WRONG_CHAIN",
  );
  await Promise.all(
    [...anchors].map(async ([number, expected]) =>
      check(
        same((await blockAt(provider, number)).hash, expected),
        "V10 verification anchor is no longer canonical",
        "DEPLOYMENT_REORG",
      ),
    ),
  );
  const upgrade = (
    implementation,
    codeHash,
    family,
    schema,
    selectedScope,
  ) => ({
    kind: "uups",
    version: 10,
    verified: true,
    governanceKind: "single-owner-immediate",
    implementation,
    implementationCodeHash: codeHash,
    implementationRevision: 1,
    family,
    storageSchema: schema,
    authority: d.upgradeAuthority,
    authorityCodeHash: controllerHash,
    initialOwner: d.initialUpgradeOwner,
    owner: governance.owner,
    pendingOwner: governance.pendingOwner,
    upgradesDisabled: governance.upgradesDisabled,
    delaySeconds: 0,
    finalizationVerified: governance.upgradesDisabled,
    finalizationScope: selectedScope,
  });
  return {
    anchor: current,
    deploymentTrust: {
      status: "verified",
      contractVersion: scope.profile,
      chainId: 1,
      factory: d.factory,
      factoryCodeHash: proxyHash,
      proxyCodeHash: proxyHash,
      factoryCreationBlockHash: factoryBirth.block.hash,
      controllerCreationBlockHash: controllerBirth.block.hash,
      ...(child
        ? {
            creationBlockHash: eventBirth.block.hash,
            configurationHash: d.configurationHash,
          }
        : {}),
    },
    upgrade: child
      ? upgrade(
          d.implementation,
          d.implementationCodeHash,
          EVENT_FAMILY,
          EVENT_SCHEMA,
          "event",
        )
      : upgrade(
          d.factoryImplementation,
          d.factoryImplementationCodeHash,
          FACTORY_FAMILY,
          FACTORY_SCHEMA,
          "factory",
        ),
    ...(child
      ? {
          factoryUpgrade: upgrade(
            d.factoryImplementation,
            d.factoryImplementationCodeHash,
            FACTORY_FAMILY,
            FACTORY_SCHEMA,
            "factory-proxy",
          ),
        }
      : { eventImplementation: d.implementation }),
  };
}

export function verifyV10FactoryDeployment(
  chain,
  factory,
  scope = V10_MAINNET_SCOPE,
) {
  return verify(chain, factory, scope, false);
}
export function verifyV10Deployment(
  chain,
  deployment,
  scope = V10_MAINNET_SCOPE,
) {
  return verify(chain, deployment, scope, true);
}
