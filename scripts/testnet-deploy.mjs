import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ethers } from "ethers";
import { randomUUID } from "node:crypto";
import {
  ROOT,
  PRIVATE_ROOT,
  CHIADO,
  EXTRA,
  DAY,
  check,
  sha256,
  publicJson,
  atomicJson,
  readJson,
  secureWalletFile,
  parseArgs,
  validatePlan,
  fingerprint,
  verifyCompiledInputs,
  verifyPolicy,
  assertTestnet,
  currentTransactionFees,
  acquireLock,
  loadJournal,
  sendOnce,
  safeFailure,
} from "../src/testnet-config.mjs";
import { eventV8Template, factoryEventId } from "../src/contracts-v8.mjs";
import { hash } from "../src/utils.mjs";

export const DEFAULT_PLAN = path.join(PRIVATE_ROOT, "chiado-plan.json");
export const DEFAULT_MANIFEST = path.join(
  ROOT,
  "registry/chiado-v8-controlled.json",
);
export function preparePlan({
  wallet,
  provenance,
  publicOrigin,
  startInMinutes = 60,
  now = Math.floor(Date.now() / 1000),
  previous = null,
  policyBytes,
}) {
  const url = new URL(publicOrigin);
  check(
    url.protocol === "https:" &&
      url.origin === publicOrigin &&
      !url.username &&
      !url.password,
    "Use an exact HTTPS public application origin.",
  );
  check(
    Number.isSafeInteger(startInMinutes) &&
      startInMinutes >= 15 &&
      startInMinutes <= 10080,
    "Start delay must be15minutes through7days.",
  );
  const addresses = Object.fromEntries(
    Object.entries(wallet.roles).map(([role, entry]) => [role, entry.address]),
  );
  const planId = previous?.id ?? randomUUID();
  const eventStart = now + startInMinutes * 60;
  const plan = {
    version: 1,
    id: planId,
    environment: "testnet",
    createdAt: new Date(now * 1000).toISOString(),
    chain: CHIADO,
    publicOrigin,
    addresses,
    arbitration: {
      mode: "controlled",
      notice:
        "Public testnet transactions with a deliberately controllable test arbitrator. Anyone may use mock ruling/fee hooks. This is not Kleros jury arbitration.",
    },
    policy: {
      uri: publicOrigin + "/policies/v8-testnet.md",
      sha256: sha256(policyBytes),
    },
    provenance,
    feeForJurorWei: ethers.parseEther("0.00000001").toString(),
    ownerBGasFundingWei: ethers.parseEther("0.00001").toString(),
    participantFundingWei: ethers.parseEther("0.00002").toString(),
    recommendedDeployerFunding:
      "0.0002 test XDAI (estimate; recheck current network fees)",
    events: ["a", "b"].map((letter, i) => ({
      id: `chiado-${planId}-${letter}`,
      version: "kleros-event-v8",
      ownerRole: i ? "ownerB" : "ownerA",
      eventKey: ethers.id(`chiado-${planId}-${letter}`),
      title: `Chiado rehearsal ${letter.toUpperCase()}`,
      depositWei: ethers.parseEther(i ? "0.000002" : "0.000001").toString(),
      eventStart,
      claimDeadline: eventStart + 7 * DAY,
    })),
    steps: [
      "Deploy controlled MockKlerosLiquid",
      "Set synthetic arbitration fee",
      "Deploy controlled MockArbitrableProxy",
      "Deploy immutable v8 factory",
      "Fund disposable organizerB gas wallet",
      "Create isolated eventA",
      "Create isolated eventB",
    ],
    timing:
      "Unchanged contract windows: deposits close at eventStart, challenges and matching last1day, claim deadline is at least7days after eventStart. Public testnet time cannot be advanced.",
  };
  validatePlan(plan);
  return plan;
}

export async function deployPlan({
  plan,
  wallet,
  provider,
  artifacts,
  journalPath,
  manifestPath,
}) {
  validatePlan(plan);
  if (fs.existsSync(manifestPath))
    check(
      readJson(manifestPath).planFingerprint === fingerprint(plan),
      "An existing public manifest belongs to another plan; choose a separate output before deploying.",
    );
  await assertTestnet(provider, plan.chain);
  const journal = loadJournal(journalPath, plan);
  const signers = Object.fromEntries(
    Object.entries(wallet.roles).map(([role, entry]) => [
      role,
      new ethers.Wallet(entry.privateKey, provider),
    ]),
  );
  for (const [role, signer] of Object.entries(signers))
    check(
      signer.address === plan.addresses[role],
      "Prepared role wallet differs from the reviewed plan.",
    );
  const send = (action, signer, request) =>
    sendOnce({ provider, signer, journal, journalPath, action, request });
  const deploy = async (name, action, args = []) => {
    const artifact = artifacts[name];
    const factory = new ethers.ContractFactory(
      artifact.abi,
      artifact.bytecode,
      signers.ownerA,
    );
    const request = await factory.getDeployTransaction(...args);
    const receipt = await send(action, signers.ownerA, request);
    check(
      receipt.contractAddress &&
        (await provider.getCode(receipt.contractAddress)) !== "0x",
      "Deployment receipt did not produce contract code.",
    );
    return new ethers.Contract(
      receipt.contractAddress,
      artifact.abi,
      signers.ownerA,
    );
  };
  const liquid = await deploy("MockKlerosLiquid", "deploy-arbitrator");
  await send("configure-arbitrator-fee", signers.ownerA, {
    to: liquid.target,
    data: liquid.interface.encodeFunctionData("setFeeForJuror", [
      plan.feeForJurorWei,
    ]),
  });
  const resolver = await deploy("MockArbitrableProxy", "deploy-resolver", [
    liquid.target,
  ]);
  const factory = await deploy("KlerosEventFactoryV8", "deploy-factory");
  check(
    (await resolver.arbitrator()).toLowerCase() === liquid.target.toLowerCase(),
    "Controlled resolver points to an unexpected arbitrator.",
  );
  check(
    (await factory.VERSION()) === 8n &&
      (await factory.eventCreationCode()) === artifacts.KlerosEventV8.bytecode,
    "Factory creation code does not match the reviewed v8 artifact.",
  );
  await send("fund-organizer-b", signers.ownerA, {
    to: signers.ownerB.address,
    value: BigInt(plan.ownerBGasFundingWei),
  });
  const policy = fs.readFileSync(
    path.join(ROOT, "public/policies/v8-testnet.md"),
    "utf8",
  );
  check(
    sha256(policy) === plan.policy.sha256,
    "The local policy changed after review.",
  );
  const events = [];
  for (const event of plan.events) {
    const signer = signers[event.ownerRole];
    const template = eventV8Template({
      eventName: event.title,
      depositAmount: event.depositWei,
      policyURI: plan.policy.uri,
      nativeCurrencySymbol: "XDAI",
    });
    const config = {
      depositAmount: event.depositWei,
      eventName: event.title,
      eventStart: event.eventStart,
      claimDeadline: event.claimDeadline,
      arbitration: {
        disputeResolver: resolver.target,
        extraData: EXTRA,
        metaEvidenceTemplate: template.pieces,
        metaEvidenceSlots: template.slots,
        policyURI: plan.policy.uri,
      },
    };
    const configHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", factory.interface.getFunction("createEvent").inputs[1]],
        [signer.address, config],
      ),
    );
    const receipt = await send(`create-${event.id}`, signer, {
      to: factory.target,
      data: factory.interface.encodeFunctionData("createEvent", [
        event.eventKey,
        config,
      ]),
    });
    const created = receipt.logs
      .filter(
        (log) => log.address.toLowerCase() === factory.target.toLowerCase(),
      )
      .map((log) => factory.interface.parseLog(log))
      .find((log) => log?.name === "EventCreated");
    const id = factoryEventId({
      chainId: 10200,
      factory: factory.target,
      creator: signer.address,
      eventKey: event.eventKey,
    });
    check(
      created &&
        created.args.version === 8n &&
        created.args.eventId === id &&
        created.args.creator === signer.address &&
        created.args.configurationHash === configHash,
      "EventCreated does not match reviewed configuration.",
    );
    const address = created.args.eventContract;
    const child = new ethers.Contract(
      address,
      artifacts.KlerosEventV8.abi,
      provider,
    );
    check(
      (await child.VERSION()) === 8n &&
        (await child.owner()) === signer.address &&
        (await child.depositAmount()) === BigInt(event.depositWei) &&
        (await child.eventStart()) === BigInt(event.eventStart) &&
        (await child.claimDeadline()) === BigInt(event.claimDeadline) &&
        (await child.policyURI()) === plan.policy.uri,
      "Created event's immutable terms differ from the plan.",
    );
    const block = await provider.getBlock(receipt.blockNumber);
    const deployment = {
      eventId: event.id,
      chainId: 10200,
      contract: address,
      deploymentBlock: receipt.blockNumber,
      deploymentTxHash: receipt.hash,
      contractVersion: "kleros-event-v8",
      abiVersion: "kleros-event-v8",
      depositWei: event.depositWei,
      eventName: event.title,
      eventStart: event.eventStart,
      claimDeadline: event.claimDeadline,
      depositOpensAt: block.timestamp,
      depositDeadline: event.eventStart,
      owner: signer.address,
      creator: signer.address,
      resolver: resolver.target,
      arbitrator: liquid.target,
      arbitratorExtraData: EXTRA,
      policyURI: plan.policy.uri,
      templateHash: hash([template.pieces, template.slots]),
      codeHash: ethers.keccak256(await provider.getCode(address)),
      factory: factory.target,
      factoryCodeHash: ethers.keccak256(await provider.getCode(factory.target)),
      factoryEventId: id,
      eventKey: event.eventKey,
      configurationHash: configHash,
      creationCodeHash: ethers.keccak256(artifacts.KlerosEventV8.bytecode),
      compiler: artifacts.KlerosEventV8.compiler,
      sourceCommit: `v8-source-sha256:${sha256(publicJson(plan.provenance.sources))}`,
    };
    const definition = {
      id: event.id,
      slug: `chiado-rehearsal-${event.id.slice(7, 15)}-${event.ownerRole === "ownerA" ? "a" : "b"}`,
      title: event.title,
      description:
        "Synthetic public testnet rehearsal with a deliberately controlled arbitrator.",
      startsAt: new Date(event.eventStart * 1000).toISOString(),
      endsAt: new Date((event.eventStart + 3600) * 1000).toISOString(),
      timezone: "UTC",
      location: "Synthetic testnet venue",
      visibility: "public",
      editorialStatus: "published",
      registrationStatus: "open",
      organizers: [signer.address],
      staff: [],
    };
    events.push({
      definition,
      deployment,
      policy,
      pieces: template.pieces,
      slots: template.slots,
    });
  }
  const manifest = {
    version: 1,
    environment: "testnet",
    planId: plan.id,
    planFingerprint: fingerprint(plan),
    chain: plan.chain,
    publicOrigin: plan.publicOrigin,
    createdAt: new Date().toISOString(),
    arbitration: {
      mode: "controlled",
      resolver: resolver.target,
      arbitrator: liquid.target,
      notice: plan.arbitration.notice,
    },
    factory: factory.target,
    factoryCodeHash: ethers.keccak256(await provider.getCode(factory.target)),
    policy: plan.policy,
    provenance: plan.provenance,
    rehearsalAddresses: plan.addresses,
    events,
  };
  atomicJson(manifestPath, manifest, 0o644);
  return manifest;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, {
    "--prepare": "boolean",
    "--deploy": "boolean",
    "--plan": "value",
    "--manifest": "value",
    "--public-origin": "value",
    "--start-in-minutes": "value",
    "--help": "boolean",
  });
  if (args["--help"]) {
    console.log(
      "Prepare only: node scripts/testnet-deploy.mjs --prepare --public-origin https://YOUR_SITE\nReview: node scripts/testnet-deploy.mjs\nBroadcast/resume the exact plan: node scripts/testnet-deploy.mjs --deploy\nOnly Chiado10200; no automatic transaction replay. Private wallets remain ignored locally.",
    );
    return;
  }
  check(
    !(args["--prepare"] && args["--deploy"]),
    "Prepare and deploy are separate commands.",
  );
  const planPath = path.resolve(args["--plan"] ?? DEFAULT_PLAN);
  const journalPath = path.join(PRIVATE_ROOT, "chiado-deployment-journal.json");
  if (args["--prepare"]) {
    if (fs.existsSync(journalPath))
      check(
        Object.keys(readJson(journalPath).transactions ?? {}).length === 0,
        "Deployment has started; preserve its exact plan and resume known receipts.",
      );
    const wallet = secureWalletFile(undefined, true);
    const { provenance } = verifyCompiledInputs();
    const policyBytes = fs.readFileSync(
      path.join(ROOT, "public/policies/v8-testnet.md"),
    );
    const previous = fs.existsSync(planPath) ? readJson(planPath) : null;
    const plan = preparePlan({
      wallet,
      provenance,
      policyBytes,
      previous,
      publicOrigin: args["--public-origin"] ?? previous?.publicOrigin,
      startInMinutes: Number(args["--start-in-minutes"] ?? 60),
    });
    atomicJson(planPath, plan);
    console.log(
      publicJson({
        status: "prepared-no-broadcast",
        planPath,
        planFingerprint: fingerprint(plan),
        deployer: plan.addresses.ownerA,
        funding: plan.recommendedDeployerFunding,
        faucet: CHIADO.faucet,
        eventsStartAt: new Date(plan.events[0].eventStart * 1000).toISOString(),
        notice: plan.arbitration.notice,
      }),
    );
    return;
  }
  const plan = validatePlan(readJson(planPath));
  const { artifacts, provenance } = verifyCompiledInputs();
  check(
    JSON.stringify(provenance) === JSON.stringify(plan.provenance),
    "Compiled source provenance changed; the reviewed plan must not be reused.",
  );
  if (!args["--deploy"]) {
    console.log(
      publicJson({
        status: "review-only-no-broadcast",
        planFingerprint: fingerprint(plan),
        plan,
      }),
    );
    return;
  }
  const unlock = acquireLock(path.join(PRIVATE_ROOT, "chiado-operation.lock"));
  const provider = new ethers.JsonRpcProvider(plan.chain.rpcUrl, undefined, {
    cacheTimeout: -1,
  });
  provider.pollingInterval = 4000;
  try {
    await assertTestnet(provider, plan.chain);
    await verifyPolicy(plan.policy);
    const journal = loadJournal(journalPath, plan);
    if (!Object.keys(journal.transactions).length) {
      const block = await provider.getBlock("latest");
      check(
        plan.events.every((event) => event.eventStart > block.timestamp + 600),
        "The unsigned event start is too close or past; prepare a new future schedule before any transaction.",
      );
      const fees = await currentTransactionFees(provider);
      const maxFee = fees.maxFeePerGas ?? fees.gasPrice;
      check(maxFee && maxFee > 0n, "Current network fees are unavailable.");
      const rehearsalReserve =
        BigInt(plan.ownerBGasFundingWei) +
        3n * BigInt(plan.participantFundingWei) +
        50_000_000n * maxFee;
      check(
        (await provider.getBalance(plan.addresses.ownerA)) >= rehearsalReserve,
        `Disposable wallet needs at least ${ethers.formatEther(rehearsalReserve)}testXDAI at current fees before starting. No transaction was broadcast.`,
      );
    }
    const manifest = await deployPlan({
      plan,
      wallet: secureWalletFile(),
      provider,
      artifacts,
      journalPath,
      manifestPath: path.resolve(args["--manifest"] ?? DEFAULT_MANIFEST),
    });
    console.log(
      publicJson({
        status: "deployed-verified",
        chainId: 10200,
        manifest: args["--manifest"] ?? DEFAULT_MANIFEST,
        factory: manifest.factory,
        contracts: manifest.events.map((e) => e.deployment.contract),
        notice: manifest.arbitration.notice,
      }),
    );
  } finally {
    provider.destroy();
    unlock();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(safeFailure);
