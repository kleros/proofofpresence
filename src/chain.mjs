// @ts-check
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash, lower, requireThat } from "./utils.mjs";
import { caseTemplate } from "../references/kickback/scripts/lib.mjs";
import { verifyUpgradeableDeployment, IMPLEMENTATION_SLOT } from "./upgrade-verification.mjs";
import {
  EVENT_V8_VERSION,
  EVENT_V8_TEST15M_VERSION,
  EVENT_V9_VERSION,
  EVENT_V8_CAPACITY,
  eventV8Profile,
  isV8Version,
  eventV8Template,
  factoryEventId,
  loadV8Artifacts,
} from "./contracts-v8.mjs";

const base = new URL("../references/kickback/", import.meta.url);
export const V7 = JSON.parse(
  fs.readFileSync(new URL("abi/v7/TruthPaysKickback.json", base), "utf8"),
);
// Keep artifact loading lazy: historical v7 deployments do not depend on a v8 build.
export const ABI = {
  "truth-pays-v7": V7,
  get "kleros-event-v8"() {
    return loadV8Artifacts().event;
  },
  get "kleros-event-v8-test15m"() {
    return loadV8Artifacts(EVENT_V8_TEST15M_VERSION).event;
  },
  get "kleros-event-v9-uups"() {
    return loadV8Artifacts(EVENT_V9_VERSION).event;
  },
};
export const sourceCommit = "57fc1c8233c60e31c1b5988c631ef57d7c3f1b81";
export const loadArtifact = (name) =>
  JSON.parse(fs.readFileSync(new URL(`build/${name}.json`, base), "utf8"));
export const PHASES = ["Open", "Listed", "Finalized", "Cancelled"];
export const DAY = 86400;
export const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);

export async function localChain(port = 0, { chainId = 1337 } = {}) {
  requireThat(
    Number.isSafeInteger(chainId) && chainId > 0,
    "Invalid synthetic chain ID",
  );
  const server = ganache.server({
    logging: { quiet: true },
    chain: {
      chainId,
      time: new Date("2026-10-28T12:00:00Z"),
      hardfork: "shanghai",
    },
    wallet: {
      seed: "kleros-synthetic-local-demo-only",
      totalAccounts: 12,
      defaultBalance: 100,
    },
    miner: { blockGasLimit: 30_000_000 },
  });
  await server.listen(port, "127.0.0.1");
  const rpcUrl = `http://127.0.0.1:${server.address().port}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
    cacheTimeout: -1,
  });
  provider.pollingInterval = 30;
  const signers = await provider.listAccounts();
  const deploy = async (name, signer, ...args) => {
    const artifact =
      name === "TruthPaysKickback"
        ? V7
        : name === "KlerosEventV8"
          ? loadV8Artifacts().event
          : name === "KlerosEventFactoryV8"
            ? loadV8Artifacts().factory
            : name === "KlerosEventV8Test15m"
              ? loadV8Artifacts(EVENT_V8_TEST15M_VERSION).event
              : name === "KlerosEventFactoryV8Test15m"
                ? loadV8Artifacts(EVENT_V8_TEST15M_VERSION).factory
                : loadArtifact(name);
    const contract = await new ethers.ContractFactory(
      artifact.abi,
      artifact.bytecode,
      signer,
    ).deploy(
      ...args,
      ...([
        "KlerosEventV8",
        "KlerosEventFactoryV8",
        "KlerosEventV8Test15m",
        "KlerosEventFactoryV8Test15m",
      ].includes(name)
        ? [{ gasLimit: 16_777_216n }]
        : []),
    );
    await contract.waitForDeployment();
    // Ethers' factory type omits runtime ABI methods; retain its deployment receipt.
    return /** @type {import('ethers').Contract} */ (
      /** @type {unknown} */ (contract)
    );
  };
  const liquid = await deploy("MockKlerosLiquid", signers[0]);
  const resolver = await deploy(
    "MockArbitrableProxy",
    signers[0],
    liquid.target,
  );
  return {
    server,
    provider,
    chainId,
    rpcUrl,
    signers,
    deploy,
    liquid,
    resolver,
    close: async () => {
      provider.destroy();
      await server.close();
    },
  };
}

export async function deployEvent(
  chain,
  definition,
  signer,
  depositWei,
  start,
  deadline,
  { contractVersion = "truth-pays-v7", factory = null } = {},
) {
  requireThat(
    contractVersion === "truth-pays-v7" || isV8Version(contractVersion),
    "Unsupported contract/ABI version",
    "UNKNOWN_VERSION",
  );
  if (isV8Version(contractVersion))
    return deployV8Event(
      chain,
      definition,
      signer,
      depositWei,
      start,
      deadline,
      factory,
      eventV8Profile(contractVersion),
    );
  // Per-event text is immutable at deployment; historical policy/template is never edited.
  const policy = `Local synthetic policy for ${definition.id}: attendance at ${definition.location}; ${definition.startsAt}. v7 rulings: 1 attended; 2 absent; 0 excluded and challenge remainder split. Held-share rules unchanged.`;
  const policyURI = `/local-policy/${hash(policy)}`;
  const owner = await signer.getAddress();
  const { pieces, slots } = caseTemplate(
    {
      eventId: definition.id,
      eventName: definition.title,
      depositUnits: depositWei,
      chainName: "Local demo ETH",
      eventStart: definition.startsAt,
      timezone: definition.timezone,
      venue: definition.location,
      explorer: "http://127.0.0.1",
      owner,
      kleros: { policyURI },
    },
    owner,
  );
  const contract = await chain.deploy(
    "TruthPaysKickback",
    signer,
    depositWei,
    definition.title,
    owner,
    start,
    deadline,
    [chain.resolver.target, EXTRA, pieces, slots, policyURI],
  );
  const receipt = await contract.deploymentTransaction().wait();
  const deployedAt = (await chain.provider.getBlock(receipt.blockNumber))
    .timestamp;
  const deployment = {
    eventId: definition.id,
    chainId: Number((await chain.provider.getNetwork()).chainId),
    contract: contract.target,
    deploymentBlock: receipt.blockNumber,
    contractVersion: "truth-pays-v7",
    abiVersion: "truth-pays-v7",
    depositWei: String(depositWei),
    eventStart: start,
    claimDeadline: deadline,
    depositOpensAt: deployedAt,
    depositDeadline: start,
    owner,
    resolver: chain.resolver.target,
    arbitrator: chain.liquid.target,
    policyURI,
    templateHash: hash([pieces, slots]),
    codeHash: ethers.keccak256(await chain.provider.getCode(contract.target)),
    sourceCommit,
  };
  return { deployment, policy, pieces, slots };
}

async function deployV8Event(
  chain,
  definition,
  signer,
  depositWei,
  start,
  deadline,
  suppliedFactory,
  profile,
) {
  const chainId = Number((await chain.provider.getNetwork()).chainId);
  requireThat(!profile.upgradeable,
    "Upgradeable production deployments require the separately reviewed unsigned deployment plan",
    "DEPLOYMENT_MISMATCH", 409);
  requireProfileChain(profile, chainId);
  const artifacts = loadV8Artifacts(profile.contractVersion);
  const creator = await signer.getAddress();
  const policy = `Local synthetic ${profile.testOnly ? profile.contractVersion : "v8"} policy for ${definition.id}: attendance at ${definition.location}; ${definition.startsAt}. Unadmitted or excess deposits are reserved credits withdrawable by their payer. Admission commits exactly one deposit from that payer. Deposits close at eventStart. Maximum lifetime admissions: ${EVENT_V8_CAPACITY}.${profile.testOnly ? ` TEST ONLY: Chiado chain10200; challenge period ${profile.challengeWindowSeconds} seconds; match period ${profile.matchWindowSeconds} seconds.` : ""} Case organizer identity is fixed when challenged. Rulings: 1 attended; 2 absent; 0 excluded and challenge remainder split. Held-share rules unchanged. Mock Court only; not a public policy publication.`;
  const policyURI = `/local-policy/${hash(policy)}`;
  const { pieces, slots } = eventV8Template({
    eventName: definition.title,
    depositAmount: depositWei,
    policyURI,
  });
  requireThat(
    BigInt(depositWei) > 0n &&
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(deadline) &&
      deadline >= start + 7 * DAY &&
      ethers.toUtf8Bytes(definition.title).length <= 256 &&
      ethers.toUtf8Bytes(policyURI).length <= 512 &&
      ethers.getBytes(slots).length <= 32 &&
      ethers.getBytes(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string[]", "bytes"],
          [pieces, slots],
        ),
      ).length <= 12_288,
    "v8 event parameters exceed contract bounds",
    "INVALID_V8_PARAMETERS",
  );
  // One permissionless registry per synthetic chain; each child retains isolated custody.
  const factoryCacheKey = profile.testOnly
    ? "v8Test15mFactoryPromise"
    : "v8FactoryPromise";
  const factory = suppliedFactory
    ? typeof suppliedFactory === "string"
      ? new ethers.Contract(suppliedFactory, artifacts.factory.abi, signer)
      : suppliedFactory
    : await (chain[factoryCacheKey] ??= chain.deploy(
        profile.factoryName,
        chain.signers?.[0] ?? signer,
      ));
  requireThat(
    (await factory.VERSION()) === BigInt(profile.version) &&
      (await factory.eventCreationCode()) === artifacts.event.bytecode,
    "Factory does not deploy the trusted v8 implementation",
    "WRONG_FACTORY",
    409,
  );
  let factoryBirth;
  if (profile.testOnly) {
    const factoryTx = factory.deploymentTransaction?.();
    requireThat(
      factoryTx,
      "Test profile factory requires its original creation transaction before child creation",
      "DEPLOYMENT_MISMATCH",
      409,
    );
    const factoryReceipt = await factoryTx.wait();
    factoryBirth = {
      factory: factory.target,
      factoryDeploymentTxHash: factoryReceipt.hash,
      factoryDeploymentBlock: factoryReceipt.blockNumber,
    };
    await verifyFactoryConstructor(chain, factoryBirth, artifacts);
  }
  const eventKey = ethers.id(definition.id);
  const config = {
    depositAmount: depositWei,
    eventName: definition.title,
    eventStart: start,
    claimDeadline: deadline,
    arbitration: {
      disputeResolver: chain.resolver.target,
      extraData: EXTRA,
      metaEvidenceTemplate: pieces,
      metaEvidenceSlots: slots,
      policyURI,
    },
  };
  const configurationHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", factory.interface.getFunction("createEvent").inputs[1]],
      [creator, config],
    ),
  );
  const receipt = await (
    await factory
      .connect(signer)
      .createEvent(eventKey, config, { gasLimit: 16_777_216n })
  ).wait();
  const created = receipt.logs
    .filter((log) => lower(log.address) === lower(factory.target))
    .map((log) => factory.interface.parseLog(log))
    .find((log) => log?.name === "EventCreated");
  const expectedId = factoryEventId({
    chainId,
    factory: factory.target,
    creator,
    eventKey,
  });
  requireThat(
    created &&
      created.args.eventId === expectedId &&
      created.args.version === BigInt(profile.version) &&
      lower(created.args.creator) === lower(creator) &&
      created.args.configurationHash === configurationHash,
    "Factory creation receipt does not match the requested event",
    "DEPLOYMENT_MISMATCH",
    409,
  );
  const contract = created.args.eventContract;
  const deployedAt = (await chain.provider.getBlock(receipt.blockNumber))
    .timestamp;
  const deployment = {
    eventId: definition.id,
    chainId,
    contract,
    deploymentBlock: receipt.blockNumber,
    deploymentTxHash: receipt.hash,
    contractVersion: profile.contractVersion,
    abiVersion: profile.contractVersion,
    depositWei: String(depositWei),
    eventName: definition.title,
    eventStart: start,
    claimDeadline: deadline,
    depositOpensAt: deployedAt,
    depositDeadline: start,
    owner: creator,
    creator,
    resolver: chain.resolver.target,
    arbitrator: chain.liquid.target,
    arbitratorExtraData: EXTRA,
    policyURI,
    templateHash: hash([pieces, slots]),
    codeHash: ethers.keccak256(await chain.provider.getCode(contract)),
    factory: factory.target,
    factoryCodeHash: ethers.keccak256(
      await chain.provider.getCode(factory.target),
    ),
    factoryEventId: expectedId,
    eventKey,
    configurationHash,
    creationCodeHash: ethers.keccak256(artifacts.event.bytecode),
    compiler: artifacts.event.compiler,
    // The source is a separately compiled local candidate, not the historical v7 commit.
    sourceCommit: profile.testOnly
      ? "unpublished-v8-test15m"
      : "unpublished-v8",
  };
  if (factoryBirth) Object.assign(deployment, factoryBirth);
  return { deployment, policy, pieces, slots };
}

function requireProfileChain(profile, chainId) {
  requireThat(
    !profile?.chainId || chainId === profile.chainId,
    profile?.testOnly ? "This test contract profile is restricted to Chiado chain10200" : "Contract profile does not match the configured chain",
    "WRONG_CHAIN",
    409,
  );
}

async function verifyFactoryConstructor(chain, d, artifacts) {
  requireThat(
    Number.isSafeInteger(d.factoryDeploymentBlock) &&
      d.factoryDeploymentBlock > 0 &&
      (!d.deploymentBlock || d.factoryDeploymentBlock <= d.deploymentBlock) &&
      ethers.isHexString(d.factoryDeploymentTxHash, 32),
    "Test profile requires canonical factory constructor provenance",
    "DEPLOYMENT_MISMATCH",
    409,
  );
  const [factoryTx, factoryReceipt, factoryBlock] = await Promise.all([
    chain.provider.getTransaction(d.factoryDeploymentTxHash),
    chain.provider.getTransactionReceipt(d.factoryDeploymentTxHash),
    chain.provider.getBlock(d.factoryDeploymentBlock),
  ]);
  requireThat(
    factoryTx?.chainId === 10200n &&
      factoryTx.to === null &&
      factoryTx.value === 0n &&
      factoryTx.data === artifacts.factory.bytecode &&
      factoryReceipt?.status === 1 &&
      factoryReceipt.blockNumber === d.factoryDeploymentBlock &&
      lower(factoryReceipt.contractAddress) === lower(d.factory) &&
      lower(
        ethers.getCreateAddress({
          from: factoryTx.from,
          nonce: factoryTx.nonce,
        }),
      ) === lower(d.factory) &&
      factoryBlock?.hash === factoryReceipt.blockHash,
    "Test profile factory constructor differs from the compiled profile",
    "DEPLOYMENT_MISMATCH",
    409,
  );
  return factoryBlock.hash;
}

export function contractFor(chain, deployment, runner = chain.provider) {
  requireThat(
    Object.hasOwn(ABI, deployment.abiVersion) &&
      deployment.contractVersion === deployment.abiVersion,
    "Unsupported contract/ABI version",
    "UNKNOWN_VERSION",
  );
  requireProfileChain(
    eventV8Profile(deployment.contractVersion),
    deployment.chainId,
  );
  const artifact = ABI[deployment.abiVersion];
  return new ethers.Contract(deployment.contract, artifact.abi, runner);
}

export async function verifyDeployment(chain, d) {
  requireThat(
    Object.hasOwn(ABI, d.abiVersion) && d.contractVersion === d.abiVersion,
    "Unsupported contract/ABI version",
    "UNKNOWN_VERSION",
  );
  const profile = eventV8Profile(d.contractVersion);
  requireProfileChain(profile, d.chainId);
  if (profile?.upgradeable) {
    const trust = await verifyUpgradeableDeployment(chain, d);
    chain.deploymentTrust ??= new Map();
    chain.deploymentTrust.set(hash(d), trust);
    return contractFor(chain, d);
  }
  // Only an explicitly initialized external testnet context may reuse positive
  // immutable proofs. Local demos and unknown/changed registry entries always
  // execute the complete verification below.
  const registryKey = hash(d);
  const proofKey = isV8Version(d.contractVersion)
    ? chain.immutableDeploymentEntries?.get(registryKey)
    : null;
  const cache = proofKey ? chain.immutableProvenanceCache : null;
  const cached = cache?.get(proofKey);
  if (cached) {
    const [
      actualChain,
      code,
      factoryCode,
      creationBlock,
      factoryCreationBlock,
    ] = await Promise.all([
      chain.provider.send("eth_chainId", []),
      chain.provider.getCode(d.contract),
      chain.provider.getCode(d.factory),
      chain.provider.getBlock(d.deploymentBlock),
      profile.testOnly
        ? chain.provider.getBlock(d.factoryDeploymentBlock)
        : Promise.resolve(null),
    ]);
    requireThat(
      BigInt(actualChain) === BigInt(d.chainId),
      "Wrong chain",
      "WRONG_CHAIN",
      409,
    );
    requireThat(
      ethers.keccak256(code) === d.codeHash,
      "Contract code does not match trusted deployment",
      "WRONG_CONTRACT",
      409,
    );
    requireThat(
      ethers.keccak256(factoryCode) === d.factoryCodeHash,
      "Factory code does not match trusted deployment",
      "WRONG_FACTORY",
      409,
    );
    requireThat(
      creationBlock?.hash === cached.creationBlockHash,
      "Deployment creation block is no longer canonical",
      "DEPLOYMENT_REORG",
      409,
    );
    requireThat(
      !profile.testOnly ||
        factoryCreationBlock?.hash === cached.factoryCreationBlockHash,
      "Factory creation block is no longer canonical",
      "DEPLOYMENT_REORG",
      409,
    );
    return contractFor(chain, d);
  }
  requireThat(
    Number((await chain.provider.getNetwork()).chainId) === d.chainId,
    "Wrong chain",
    "WRONG_CHAIN",
    409,
  );
  requireThat(
    ethers.keccak256(await chain.provider.getCode(d.contract)) === d.codeHash,
    "Contract code does not match trusted deployment",
    "WRONG_CONTRACT",
    409,
  );
  const c = contractFor(chain, d);
  const [deposit, start, deadline, resolver, arbitrator, policy, template] =
    await Promise.all([
      c.depositAmount(),
      c.eventStart(),
      c.claimDeadline(),
      c.disputeResolver(),
      c.arbitrator(),
      c.policyURI(),
      c.metaEvidenceTemplate(),
    ]);
  requireThat(
    String(deposit) === d.depositWei &&
      Number(start) === d.eventStart &&
      Number(deadline) === d.claimDeadline &&
      lower(resolver) === lower(d.resolver) &&
      lower(arbitrator) === lower(d.arbitrator) &&
      policy === d.policyURI &&
      hash([[...template[0]], template[1]]) === d.templateHash,
    "Deployment terms do not match registry",
    "DEPLOYMENT_MISMATCH",
    409,
  );
  if (profile) {
    const proof = await verifyV8Provenance(chain, d, c, template);
    if (cache) cache.set(proofKey, proof);
  }
  return c;
}

async function verifyV8Provenance(chain, d, c, template) {
  requireThat(
    ethers.isAddress(d.factory) &&
      ethers.isAddress(d.creator) &&
      lower(d.owner) === lower(d.creator) &&
      ethers.isHexString(d.eventKey, 32) &&
      d.eventKey !== ethers.ZeroHash &&
      ethers.isHexString(d.configurationHash, 32) &&
      ethers.isHexString(d.factoryEventId, 32) &&
      ethers.isHexString(d.creationCodeHash, 32) &&
      ethers.isHexString(d.deploymentTxHash, 32) &&
      ethers.isHexString(d.factoryCodeHash, 32) &&
      typeof d.eventName === "string" &&
      ethers.isHexString(d.arbitratorExtraData),
    "v8 deployment requires trusted factory provenance and parameters",
    "DEPLOYMENT_MISMATCH",
    409,
  );
  const profile = eventV8Profile(d.contractVersion);
  const artifacts = loadV8Artifacts(profile.contractVersion);
  const factory = new ethers.Contract(
    d.factory,
    artifacts.factory.abi,
    chain.provider,
  );
  const [
    version,
    eventName,
    extraData,
    maximum,
    challengePeriod,
    matchPeriod,
    factoryCode,
    factoryVersion,
    creationCode,
    isEvent,
    registered,
    creationReceipt,
  ] = await Promise.all([
    c.VERSION(),
    c.eventName(),
    c.arbitratorExtraData(),
    c.MAX_STAKERS(),
    c.CHALLENGE_PERIOD(),
    c.MATCH_PERIOD(),
    chain.provider.getCode(d.factory),
    factory.VERSION(),
    factory.eventCreationCode(),
    factory.isEvent(d.contract),
    factory.eventsById(d.factoryEventId),
    chain.provider.getTransactionReceipt(d.deploymentTxHash),
  ]);
  requireThat(
    version === BigInt(profile.version) &&
      factoryVersion === BigInt(profile.version) &&
      challengePeriod === BigInt(profile.challengeWindowSeconds) &&
      matchPeriod === BigInt(profile.matchWindowSeconds) &&
      maximum === BigInt(EVENT_V8_CAPACITY) &&
      eventName === d.eventName &&
      extraData === d.arbitratorExtraData &&
      ethers.keccak256(factoryCode) === d.factoryCodeHash &&
      creationCode === artifacts.event.bytecode &&
      ethers.keccak256(creationCode) === d.creationCodeHash &&
      isEvent &&
      lower(registered) === lower(d.contract) &&
      d.factoryEventId ===
        factoryEventId({
          chainId: d.chainId,
          factory: d.factory,
          creator: d.creator,
          eventKey: d.eventKey,
        }),
    "v8 factory membership or immutable implementation does not match registry",
    "DEPLOYMENT_MISMATCH",
    409,
  );
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
  const configHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", factory.interface.getFunction("createEvent").inputs[1]],
      [d.creator, config],
    ),
  );
  const creation = creationReceipt?.logs
    .filter((log) => lower(log.address) === lower(d.factory))
    .map((log) => factory.interface.parseLog(log))
    .find((log) => log?.name === "EventCreated");
  requireThat(
    creationReceipt?.status === 1 &&
      creationReceipt.blockNumber === d.deploymentBlock &&
      creation &&
      creation.args.eventId === d.factoryEventId &&
      lower(creation.args.eventContract) === lower(d.contract) &&
      lower(creation.args.creator) === lower(d.creator) &&
      creation.args.eventKey === d.eventKey &&
      creation.args.version === BigInt(profile.version) &&
      creation.args.configurationHash === configHash &&
      configHash === d.configurationHash,
    "v8 creation receipt does not match registry",
    "DEPLOYMENT_MISMATCH",
    409,
  );
  const canonicalCreationBlock = await chain.provider.getBlock(
    d.deploymentBlock,
  );
  requireThat(
    canonicalCreationBlock?.hash === creationReceipt.blockHash,
    "Deployment creation receipt is no longer canonical",
    "DEPLOYMENT_REORG",
    409,
  );
  let factoryCreationBlockHash;
  if (profile.testOnly) {
    requireThat(
      Number.isSafeInteger(d.factoryDeploymentBlock) &&
        d.factoryDeploymentBlock > 0 &&
        d.factoryDeploymentBlock <= d.deploymentBlock &&
        ethers.isHexString(d.factoryDeploymentTxHash, 32) &&
        d.compiler === artifacts.event.compiler,
      "Test profile requires its exact compiler and factory constructor provenance",
      "DEPLOYMENT_MISMATCH",
      409,
    );
    const [factoryBlockHash, creationTx] = await Promise.all([
      verifyFactoryConstructor(chain, d, artifacts),
      chain.provider.getTransaction(d.deploymentTxHash),
    ]);
    requireThat(
      creationTx?.chainId === 10200n &&
        lower(creationTx.from) === lower(d.creator) &&
        lower(creationTx.to) === lower(d.factory) &&
        creationTx.value === 0n &&
        creationTx.data ===
          factory.interface.encodeFunctionData("createEvent", [
            d.eventKey,
            config,
          ]),
      "Test profile factory constructor or child creation input differs from the compiled profile",
      "DEPLOYMENT_MISMATCH",
      409,
    );
    factoryCreationBlockHash = factoryBlockHash;
  }
  return {
    creationBlockHash: canonicalCreationBlock.hash,
    ...(profile.testOnly ? { factoryCreationBlockHash } : {}),
  };
}

export async function chainState(
  chain,
  record,
  { includeBlockHash = false } = {},
) {
  const d = record.deployment;
  const v8 = isV8Version(d.contractVersion);
  const c = await verifyDeployment(chain, d);
  const trust = eventV8Profile(d.contractVersion)?.upgradeable
    ? chain.deploymentTrust.get(hash(d)) : null;
  const block = trust?.anchor ?? await chain.provider.getBlock("latest");
  const at = { blockTag: block.number };
  const keys = [
    "phase",
    "owner",
    "pendingOwner",
    "stakerCount",
    "attendeeCount",
    "challengeEndsAt",
    "pendingChallenges",
    "payoutShare",
    "heldBack",
    "owedTotal",
    "challengeEscrow",
    "reserved",
    "spare",
    "challengeDeposit",
  ];
  // These reads are independent and all target the same freshly selected block.
  // Batching reduces remote-RPC latency without reusing any mutable snapshot.
  const [values, history, attendeeList, challengerList, balance, pendingTotal] =
    await Promise.all([
      Promise.all(keys.map((key) => c[key](at))),
      c.stakers(at),
      c.attendees(at),
      c.challengers(at),
      chain.provider.getBalance(d.contract, block.number),
      v8 ? c.pendingTotal(at) : Promise.resolve(0n),
    ]);
  const raw = Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  const stakerHistory = [...history];
  const uniqueStakers = [...new Set(stakerHistory.map(lower))];
  const creditWallets = v8
    ? [
        ...new Set(
          [
            ...uniqueStakers,
            ...[...(record.participants?.values() ?? [])].map((person) =>
              lower(person.wallet),
            ),
          ].filter((wallet) => ethers.isAddress(wallet)),
        ),
      ]
    : [];
  const [activeStatuses, pendingCreditValues] = await Promise.all([
    Promise.all(uniqueStakers.map((wallet) => c.status(wallet, at))),
    Promise.all(creditWallets.map((wallet) => c.pendingDeposits(wallet, at))),
  ]);
  const activeStakers = uniqueStakers
    .filter((_, i) => Number(activeStatuses[i]) === 1)
    .map(ethers.getAddress);
  const stakers = uniqueStakers
    .filter((_, i) => [1, 2].includes(Number(activeStatuses[i])))
    .map(ethers.getAddress);
  const attendees = [...attendeeList];
  const challengers = [...challengerList];
  const cases = await Promise.all(
    challengers.map(async (wallet) => {
      const challenge = await c.challenges(wallet, at);
      let finalRuling = null,
        appeal = null,
        rewardsReady = false,
        caseURI = null;
      const matched = lower(challenge.matcher) !== lower(ethers.ZeroAddress);
      if (matched && Number(challenge.state) >= 2) {
        const resolver =
          lower(chain.resolver?.target ?? "") === lower(d.resolver)
            ? chain.resolver
            : new ethers.Contract(
                d.resolver,
                loadArtifact("MockArbitrableProxy").abi,
                chain.provider,
              );
        const resolverCase = await resolver.disputes(
          challenge.localDisputeID,
          at,
        );
        finalRuling = resolverCase.isRuled ? Number(resolverCase.ruling) : null;
        rewardsReady = resolverCase.isRuled === true;
        if (Number(challenge.state) === 2) {
          const a = await c.appealStatus(wallet, at);
          appeal = {
            ...(chain.production ? { rewardsReady, withdrawableWei: null } : {}),
            ruling: Number(a.ruling),
            start: Number(a.start),
            end: Number(a.end),
            loserEnd: Number(a.loserEnd),
            costAttended: String(a.costAttended),
            costAbsent: String(a.costAbsent),
          };
        }
        caseURI = (await c.caseMetaEvidence(wallet, at))[1];
      }
      return {
        wallet,
        matched,
        outcome:
          !matched && Number(challenge.state) === 3
            ? "attended-unmatched"
            : null,
        state: ["None", "Waiting", "Disputed", "Resolved"][
          Number(challenge.state)
        ],
        matcher: challenge.matcher,
        matchEndsAt: Number(challenge.matchEndsAt),
        depositWei: String(challenge.deposit),
        localDisputeID: matched ? String(challenge.localDisputeID) : null,
        arbitratorDisputeID: matched
          ? String(challenge.arbitratorDisputeID)
          : null,
        heldShareWei: String(challenge.heldShare),
        ...(v8 ? { caseOrganizer: await c.caseOrganizer(wallet, at) } : {}),
        finalRuling,
        caseURI,
        publication: matched
          ? (record.publications?.get(lower(wallet))?.status ?? "unpublished")
          : "not-applicable",
        appeal,
        ...(chain.production ? { rewardsReady } : {}),
      };
    }),
  );
  const balanceWei = String(balance);
  const state = {
    ...(trust ? { upgrade: trust.upgrade } : {}),
    phase: PHASES[Number(raw.phase)],
    owner: raw.owner,
    pendingOwner: raw.pendingOwner,
    stakers,
    activeStakers,
    stakerHistory,
    attendees,
    cases,
    depositWei: d.depositWei,
    poolWei: String(BigInt(d.depositWei) * raw.stakerCount),
    balanceWei,
    reservedWei: String(raw.reserved),
    spareWei: String(raw.spare),
    heldBackWei: String(raw.heldBack),
    owedTotalWei: String(raw.owedTotal),
    challengeEscrowWei: String(raw.challengeEscrow),
    payoutShareWei: String(raw.payoutShare),
    stakerCount: Number(raw.stakerCount),
    attendeeCount: Number(raw.attendeeCount),
    challengeEndsAt: Number(raw.challengeEndsAt),
    pendingChallenges: Number(raw.pendingChallenges),
    challengeDepositWei: String(raw.challengeDeposit),
    ...(v8
      ? {
          pendingTotalWei: String(pendingTotal),
          pendingCredits: Object.fromEntries(
            creditWallets.map((wallet, i) => [
              wallet,
              String(pendingCreditValues[i]),
            ]),
          ),
          maxStakers: EVENT_V8_CAPACITY,
          lifetimeAdmittedCount: uniqueStakers.length,
          remainingAdmissionSlots: EVENT_V8_CAPACITY - uniqueStakers.length,
        }
      : {}),
  };
  if (trust) {
    const head = await chain.provider.send("eth_getBlockByNumber", ["latest", false]);
    requireThat(head?.number && BigInt(head.number) >= BigInt(block.number),
      "Production snapshot head moved backwards", "DEPLOYMENT_REORG", 409);
    const [eventSlot, factorySlot, implementationCode, canonical] = await Promise.all([
      chain.provider.send("eth_getStorageAt", [d.contract, IMPLEMENTATION_SLOT, head.number]),
      chain.provider.send("eth_getStorageAt", [d.factory, IMPLEMENTATION_SLOT, head.number]),
      chain.provider.send("eth_getCode", [d.implementation, head.number]),
      chain.provider.send("eth_getBlockByNumber", [ethers.toQuantity(block.number), false]),
    ]);
    requireThat(ethers.isHexString(eventSlot, 32) && ethers.isHexString(factorySlot, 32) &&
      BigInt(eventSlot) === BigInt(d.implementation) &&
      BigInt(factorySlot) === BigInt(d.factoryImplementation) &&
      ethers.keccak256(implementationCode) === d.implementationCodeHash && canonical?.hash === block.hash,
      "Production implementation or snapshot changed", "UPGRADE_TRUST_MISMATCH", 409);
  }
  return {
    ...state,
    ...(trust ? { deploymentTrust: trust.deploymentTrust } : {}),
    fingerprint: hash(state),
    blockNumber: block.number,
    ...(includeBlockHash ? { blockHash: block.hash } : {}),
    now: block.timestamp,
  };
}
