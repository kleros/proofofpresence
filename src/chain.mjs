// @ts-check
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash, lower, requireThat } from "./utils.mjs";
import { caseTemplate } from "../references/kickback/scripts/lib.mjs";
import {
  EVENT_V8_VERSION,
  EVENT_V8_CAPACITY,
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
            : loadArtifact(name);
    const contract = await new ethers.ContractFactory(
      artifact.abi,
      artifact.bytecode,
      signer,
    ).deploy(
      ...args,
      ...(name.startsWith("KlerosEvent") ? [{ gasLimit: 16_777_216n }] : []),
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
    ["truth-pays-v7", EVENT_V8_VERSION].includes(contractVersion),
    "Unsupported contract/ABI version",
    "UNKNOWN_VERSION",
  );
  if (contractVersion === EVENT_V8_VERSION)
    return deployV8Event(
      chain,
      definition,
      signer,
      depositWei,
      start,
      deadline,
      factory,
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
) {
  const artifacts = loadV8Artifacts();
  const chainId = Number((await chain.provider.getNetwork()).chainId);
  const creator = await signer.getAddress();
  const policy = `Local synthetic v8 policy for ${definition.id}: attendance at ${definition.location}; ${definition.startsAt}. Unadmitted or excess deposits are reserved credits withdrawable by their payer. Admission commits exactly one deposit from that payer. Deposits close at eventStart. Maximum lifetime admissions: ${EVENT_V8_CAPACITY}. Case organizer identity is fixed when challenged. Rulings: 1 attended; 2 absent; 0 excluded and challenge remainder split. Held-share rules unchanged. Mock Court only; not a public policy publication.`;
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
  const factory = suppliedFactory
    ? typeof suppliedFactory === "string"
      ? new ethers.Contract(suppliedFactory, artifacts.factory.abi, signer)
      : suppliedFactory
    : await (chain.v8FactoryPromise ??= chain.deploy(
        "KlerosEventFactoryV8",
        chain.signers?.[0] ?? signer,
      ));
  requireThat(
    (await factory.VERSION()) === 8n &&
      (await factory.eventCreationCode()) === artifacts.event.bytecode,
    "Factory does not deploy the trusted v8 implementation",
    "WRONG_FACTORY",
    409,
  );
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
      created.args.version === 8n &&
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
    contractVersion: EVENT_V8_VERSION,
    abiVersion: EVENT_V8_VERSION,
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
    sourceCommit: "unpublished-v8",
  };
  return { deployment, policy, pieces, slots };
}

export function contractFor(chain, deployment, runner = chain.provider) {
  requireThat(
    Object.hasOwn(ABI, deployment.abiVersion) &&
      deployment.contractVersion === deployment.abiVersion,
    "Unsupported contract/ABI version",
    "UNKNOWN_VERSION",
  );
  const artifact = ABI[deployment.abiVersion];
  return new ethers.Contract(deployment.contract, artifact.abi, runner);
}

export async function verifyDeployment(chain, d) {
  // Only an explicitly initialized external testnet context may reuse positive
  // immutable proofs. Local demos and unknown/changed registry entries always
  // execute the complete verification below.
  const registryKey = hash(d);
  const proofKey =
    d.contractVersion === EVENT_V8_VERSION
      ? chain.immutableDeploymentEntries?.get(registryKey)
      : null;
  const cache = proofKey ? chain.immutableProvenanceCache : null;
  const cached = cache?.get(proofKey);
  if (cached) {
    const [actualChain, code, factoryCode, creationBlock] = await Promise.all([
      chain.provider.send("eth_chainId", []),
      chain.provider.getCode(d.contract),
      chain.provider.getCode(d.factory),
      chain.provider.getBlock(d.deploymentBlock),
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
  if (d.contractVersion === EVENT_V8_VERSION) {
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
  const artifacts = loadV8Artifacts();
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
    chain.provider.getCode(d.factory),
    factory.VERSION(),
    factory.eventCreationCode(),
    factory.isEvent(d.contract),
    factory.eventsById(d.factoryEventId),
    chain.provider.getTransactionReceipt(d.deploymentTxHash),
  ]);
  requireThat(
    version === 8n &&
      factoryVersion === 8n &&
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
      creation.args.version === 8n &&
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
  return { creationBlockHash: canonicalCreationBlock.hash };
}

export async function chainState(chain, record) {
  const d = record.deployment;
  const v8 = d.contractVersion === EVENT_V8_VERSION;
  const c = await verifyDeployment(chain, d);
  const block = await chain.provider.getBlock("latest");
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
  const values = await Promise.all(keys.map((k) => c[k](at)));
  const raw = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
  const stakerHistory = [...(await c.stakers(at))];
  const uniqueStakers = [...new Set(stakerHistory.map(lower))];
  const activeStatuses = await Promise.all(
    uniqueStakers.map((wallet) => c.status(wallet, at)),
  );
  const activeStakers = uniqueStakers
    .filter((_, i) => Number(activeStatuses[i]) === 1)
    .map(ethers.getAddress);
  const stakers = uniqueStakers
    .filter((_, i) => [1, 2].includes(Number(activeStatuses[i])))
    .map(ethers.getAddress);
  const attendees = [...(await c.attendees(at))];
  const challengers = [...(await c.challengers(at))];
  const cases = await Promise.all(
    challengers.map(async (wallet) => {
      const challenge = await c.challenges(wallet, at);
      let finalRuling = null,
        appeal = null,
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
        if (Number(challenge.state) === 2) {
          const a = await c.appealStatus(wallet, at);
          appeal = {
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
      };
    }),
  );
  const balanceWei = String(
    await chain.provider.getBalance(d.contract, block.number),
  );
  const creditWallets = v8
    ? [
        ...new Set(
          [
            ...uniqueStakers,
            ...[...(record.participants?.values() ?? [])].map((p) =>
              lower(p.wallet),
            ),
          ].filter((wallet) => ethers.isAddress(wallet)),
        ),
      ]
    : [];
  const pendingCreditValues = v8
    ? await Promise.all(
        creditWallets.map((wallet) => c.pendingDeposits(wallet, at)),
      )
    : [];
  const state = {
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
          pendingTotalWei: String(await c.pendingTotal(at)),
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
  return {
    ...state,
    fingerprint: hash(state),
    blockNumber: block.number,
    now: block.timestamp,
  };
}
