// @ts-check
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash, lower, requireThat } from "./utils.mjs";
import { caseTemplate } from "../references/kickback/scripts/lib.mjs";

const base = new URL("../references/kickback/", import.meta.url);
export const V7 = JSON.parse(
  fs.readFileSync(new URL("abi/v7/TruthPaysKickback.json", base), "utf8"),
);
export const ABI = { "truth-pays-v7": V7 };
export const sourceCommit = "57fc1c8233c60e31c1b5988c631ef57d7c3f1b81";
export const loadArtifact = (name) =>
  JSON.parse(fs.readFileSync(new URL(`build/${name}.json`, base), "utf8"));
export const PHASES = ["Open", "Listed", "Finalized", "Cancelled"];
export const DAY = 86400;
export const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);

export async function localChain(port = 0) {
  const server = ganache.server({
    logging: { quiet: true },
    chain: {
      chainId: 1337,
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
    const artifact = name === "TruthPaysKickback" ? V7 : loadArtifact(name);
    const contract = await new ethers.ContractFactory(
      artifact.abi,
      artifact.bytecode,
      signer,
    ).deploy(...args);
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
) {
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
    chainId: 1337,
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

export function contractFor(chain, deployment, runner = chain.provider) {
  const artifact = ABI[deployment.abiVersion];
  requireThat(
    artifact && deployment.contractVersion === deployment.abiVersion,
    "Unsupported contract/ABI version",
    "UNKNOWN_VERSION",
  );
  return new ethers.Contract(deployment.contract, artifact.abi, runner);
}

export async function verifyDeployment(chain, d) {
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
  return c;
}

export async function chainState(chain, record) {
  const d = record.deployment;
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
      if (Number(challenge.state) >= 2) {
        const resolverCase = await chain.resolver.disputes(
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
        state: ["None", "Waiting", "Disputed", "Resolved"][
          Number(challenge.state)
        ],
        matcher: challenge.matcher,
        matchEndsAt: Number(challenge.matchEndsAt),
        depositWei: String(challenge.deposit),
        localDisputeID: String(challenge.localDisputeID),
        arbitratorDisputeID: String(challenge.arbitratorDisputeID),
        heldShareWei: String(challenge.heldShare),
        finalRuling,
        caseURI,
        publication:
          record.publications?.get(lower(wallet))?.status ?? "unpublished",
        appeal,
      };
    }),
  );
  const balanceWei = String(
    await chain.provider.getBalance(d.contract, block.number),
  );
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
  };
  return {
    ...state,
    fingerprint: hash(state),
    blockNumber: block.number,
    now: block.timestamp,
  };
}
