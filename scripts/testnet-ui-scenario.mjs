import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ethers } from "ethers";
import {
  ROOT,
  PRIVATE_ROOT,
  DAY,
  EXTRA,
  check,
  sha256,
  publicJson,
  atomicJson,
  readJson,
  secureWalletFile,
  parseArgs,
  validateChain,
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

// This isolated scenario reuses the existing controlled stack. It has no code
// path for a new factory/resolver/arbitrator, fee changes, deposits or rulings.
export const UI_C = Object.freeze({
  purpose: "Disposable Chiado UI-deposit C rehearsal only",
  plan: path.join(PRIVATE_ROOT, "ui-c-plan.json"),
  wallets: path.join(PRIVATE_ROOT, "ui-c-wallets.json"),
  journal: path.join(PRIVATE_ROOT, "ui-c-journal.json"),
  manifest: path.join(ROOT, "registry/chiado-v8-ui-c.json"),
  sourceManifest: path.join(ROOT, "registry/chiado-v8-controlled.json"),
  sourceJournal: path.join(PRIVATE_ROOT, "chiado-deployment-journal.json"),
  lock: path.join(PRIVATE_ROOT, "chiado-operation.lock"),
  fundingWei: "10000000000000",
  depositWei: "1000000000000",
  maximumCreateGas: 8_000_000n,
});
const ROLES = ["owner", "alice", "bob"];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function validateUiOrigin(origin, primaryOrigin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    check(false, "An exact separate HTTPS C origin is required.");
  }
  check(
    url.protocol === "https:" &&
      url.origin === origin &&
      !url.username &&
      !url.password &&
      origin !== primaryOrigin,
    "Use a separate exact HTTPS C application origin; the A/B origin is protected.",
  );
  return origin;
}

export function validateUiCPlan(plan, source) {
  validateChain(plan.chain);
  validateUiOrigin(plan.publicOrigin, source.publicOrigin);
  check(
    plan.version === 1 &&
      plan.purpose === UI_C.purpose &&
      plan.environment === "testnet" &&
      /^[0-9a-f-]{36}$/i.test(plan.id),
    "Invalid isolated UI C plan.",
  );
  check(
    plan.arbitration?.mode === "controlled" &&
      publicJson(plan.chain) === publicJson(source.chain) &&
      publicJson(plan.arbitration) === publicJson(source.arbitration) &&
      same(plan.arbitration.resolver, source.arbitration.resolver) &&
      same(plan.arbitration.arbitrator, source.arbitration.arbitrator) &&
      same(plan.factory, source.factory) &&
      plan.sourceManifestSha256 === sha256(publicJson(source)) &&
      plan.sourcePlanFingerprint === source.planFingerprint &&
      plan.factoryCodeHash === source.factoryCodeHash &&
      publicJson(plan.provenance) === publicJson(source.provenance),
    "C must reuse the exact reviewed A/B controlled stack and source provenance.",
  );
  check(
    publicJson(plan.policy) === publicJson(source.policy),
    "C must use the already published generic policy and exact hash.",
  );
  const excluded = new Set(
    Object.values(source.rehearsalAddresses).map((a) => a.toLowerCase()),
  );
  check(
    Object.keys(plan.addresses ?? {})
      .sort()
      .join() === [...ROLES].sort().join() &&
      ROLES.every(
        (role) =>
          ethers.isAddress(plan.addresses[role]) &&
          !same(plan.addresses[role], ethers.ZeroAddress) &&
          !excluded.has(plan.addresses[role].toLowerCase()),
      ) &&
      new Set(ROLES.map((role) => plan.addresses[role].toLowerCase())).size ===
        3,
    "Use three new distinct disposable C role wallets, separate from A/B.",
  );
  check(
    plan.fundingWei === UI_C.fundingWei && plan.depositWei === UI_C.depositWei,
    "Only the reviewed 0.00001 XDAI role funding and 0.000001 XDAI deposit are allowed.",
  );
  const event = plan.event;
  check(
    event?.id === `chiado-ui-${plan.id}-c` &&
      event.version === "kleros-event-v8" &&
      event.ownerRole === "owner" &&
      event.eventKey === ethers.id(event.id) &&
      event.title === "Chiado UI deposit rehearsal C" &&
      Number.isSafeInteger(event.eventStart) &&
      event.eventEnd === event.eventStart + 12 * 3600 &&
      event.claimDeadline === event.eventStart + 7 * DAY &&
      event.eventStart >=
        Math.floor(Date.parse(plan.createdAt) / 1000) + 90 * 60 &&
      event.eventStart <=
        Math.floor(Date.parse(plan.createdAt) / 1000) + 120 * 60,
    "C must remain one new v8 event with a reviewed schedule and unchanged contract windows.",
  );
  check(
    plan.expectedFinalRuling === 1 &&
      plan.stackAnchors?.length === 3 &&
      plan.feeForJurorWei === "10000000000" &&
      plan.arbitrationCostWei === "30000000000",
    "The reviewed unchanged controlled fee and attended ruling1 scenario are required.",
  );
  return plan;
}

export function prepareUiCPlan({
  addresses,
  source,
  provenance,
  stack,
  publicOrigin,
  startInMinutes = 120,
  now = Math.floor(Date.now() / 1000),
  id = randomUUID(),
}) {
  check(
    Number.isSafeInteger(startInMinutes) &&
      startInMinutes >= 90 &&
      startInMinutes <= 120,
    "Choose a fresh C start90–120minutes after preparation.",
  );
  const eventId = `chiado-ui-${id}-c`;
  const plan = {
    version: 1,
    purpose: UI_C.purpose,
    id,
    environment: "testnet",
    createdAt: new Date(now * 1000).toISOString(),
    chain: source.chain,
    publicOrigin,
    addresses,
    fundingWei: UI_C.fundingWei,
    depositWei: UI_C.depositWei,
    factory: source.factory,
    factoryCodeHash: source.factoryCodeHash,
    arbitration: source.arbitration,
    policy: source.policy,
    provenance,
    sourceManifestSha256: sha256(publicJson(source)),
    sourcePlanFingerprint: source.planFingerprint,
    stackAnchors: stack.anchors,
    feeForJurorWei: stack.feeForJurorWei,
    arbitrationCostWei: stack.arbitrationCostWei,
    event: {
      id: eventId,
      version: "kleros-event-v8",
      ownerRole: "owner",
      eventKey: ethers.id(eventId),
      title: "Chiado UI deposit rehearsal C",
      eventStart: now + startInMinutes * 60,
      eventEnd: now + startInMinutes * 60 + 12 * 3600,
      claimDeadline: now + startInMinutes * 60 + 7 * DAY,
    },
    expectedFinalRuling: 1,
    steps: [
      "Fund only the three new C wallets",
      "Create only event C through the existing factory",
      "Alice and Bob deposit through C's public UI",
      "Owner admits both through the UI",
      "List Alice and omit Bob",
      "Bob challenges and owner matches through the UI",
      "After real deadlines release Alice's ordinary share while Bob's share stays held",
      "Deliver controlled attended ruling1",
      "Settle through the UI and pay the same Bob depositor",
    ],
    isolation:
      "Separate C manifest, wallets, plan, journal, backend service, volume and Netlify site. Shared operator lock; A/B files and financial state are protected.",
  };
  return validateUiCPlan(plan, source);
}

/** Verify original stack creation inputs, canonical receipts and unchanged runtimes. */
export async function verifyUiCStack({
  provider,
  source,
  sourceJournal,
  artifacts,
  provenance,
}) {
  await assertTestnet(provider, source.chain);
  check(
    source.environment === "testnet" &&
      source.arbitration.mode === "controlled" &&
      publicJson(source.provenance) === publicJson(provenance),
    "Source manifest and freshly compiled provenance differ.",
  );
  const rows = [
    [
      "deploy-arbitrator",
      "MockKlerosLiquid",
      source.arbitration.arbitrator,
      [],
    ],
    [
      "deploy-resolver",
      "MockArbitrableProxy",
      source.arbitration.resolver,
      [source.arbitration.arbitrator],
    ],
    ["deploy-factory", "KlerosEventFactoryV8", source.factory, []],
  ];
  check(
    sourceJournal.chainId === 10200 &&
      sourceJournal.planFingerprint === source.planFingerprint,
    "Original stack journal is not bound to the protected A/B source plan.",
  );
  const anchors = [];
  for (const [action, name, address, args] of rows) {
    const entry = sourceJournal.transactions[action];
    check(
      entry?.state === "confirmed" && ethers.isHexString(entry.hash, 32),
      "Original stack deployment needs a confirmed journaled hash.",
    );
    const [receipt, tx] = await Promise.all([
      provider.getTransactionReceipt(entry.hash),
      provider.getTransaction(entry.hash),
    ]);
    const expected = await new ethers.ContractFactory(
      artifacts[name].abi,
      artifacts[name].bytecode,
    ).getDeployTransaction(...args);
    check(
      receipt?.status === 1 &&
        tx &&
        tx.chainId === 10200n &&
        tx.to === null &&
        same(tx.from, source.rehearsalAddresses.ownerA) &&
        same(receipt.contractAddress, address) &&
        tx.data === expected.data &&
        tx.value === 0n &&
        receipt.blockHash === entry.blockHash &&
        receipt.blockNumber === entry.blockNumber,
      "Shared stack deployment does not match exact compiled creation inputs.",
    );
    const [block, originalCode, code] = await Promise.all([
      provider.getBlock(receipt.blockNumber),
      provider.getCode(address, receipt.blockNumber),
      provider.getCode(address),
    ]);
    check(
      block?.hash === receipt.blockHash &&
        code !== "0x" &&
        code === originalCode,
      "A shared stack creation anchor or runtime changed.",
    );
    anchors.push({
      action,
      contract: ethers.getAddress(address),
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      codeHash: ethers.keccak256(code),
    });
  }
  const factory = new ethers.Contract(
    source.factory,
    artifacts.KlerosEventFactoryV8.abi,
    provider,
  );
  const resolver = new ethers.Contract(
    source.arbitration.resolver,
    artifacts.MockArbitrableProxy.abi,
    provider,
  );
  const arbitrator = new ethers.Contract(
    source.arbitration.arbitrator,
    artifacts.MockKlerosLiquid.abi,
    provider,
  );
  const [version, creationCode, linkedArbitrator, fee, cost] =
    await Promise.all([
      factory.VERSION(),
      factory.eventCreationCode(),
      resolver.arbitrator(),
      arbitrator.feeForJuror(),
      arbitrator.arbitrationCost(EXTRA),
    ]);
  check(
    version === 8n &&
      creationCode === artifacts.KlerosEventV8.bytecode &&
      anchors[2].codeHash === source.factoryCodeHash &&
      same(linkedArbitrator, source.arbitration.arbitrator) &&
      fee === 10_000_000_000n &&
      cost === 30_000_000_000n,
    "The existing factory, resolver link, child creation code or controlled fee differs.",
  );
  return {
    anchors,
    feeForJurorWei: String(fee),
    arbitrationCostWei: String(cost),
  };
}

export function uiCCreateRequest(plan, artifacts) {
  const template = eventV8Template({
    eventName: plan.event.title,
    depositAmount: plan.depositWei,
    policyURI: plan.policy.uri,
    nativeCurrencySymbol: "XDAI",
  });
  const factory = new ethers.Interface(artifacts.KlerosEventFactoryV8.abi);
  const config = {
    depositAmount: plan.depositWei,
    eventName: plan.event.title,
    eventStart: plan.event.eventStart,
    claimDeadline: plan.event.claimDeadline,
    arbitration: {
      disputeResolver: plan.arbitration.resolver,
      extraData: EXTRA,
      metaEvidenceTemplate: template.pieces,
      metaEvidenceSlots: template.slots,
      policyURI: plan.policy.uri,
    },
  };
  return {
    template,
    config,
    request: {
      to: plan.factory,
      value: 0n,
      data: factory.encodeFunctionData("createEvent", [
        plan.event.eventKey,
        config,
      ]),
    },
    configurationHash: ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", factory.getFunction("createEvent").inputs[1]],
        [plan.addresses.owner, config],
      ),
    ),
  };
}

export function validateUiCBudget({
  balanceWei,
  maxFeePerGas,
  createGas,
  pendingFunding = 3,
  createPending = true,
}) {
  const gas = BigInt(createGas),
    fee = BigInt(maxFeePerGas);
  check(
    gas > 0n &&
      gas <= UI_C.maximumCreateGas &&
      fee > 0n &&
      Number.isInteger(pendingFunding) &&
      pendingFunding >= 0 &&
      pendingFunding <= 3,
    "C gas or funding count exceeds its exact boundary.",
  );
  const creationMaximumWei = createPending ? gas * fee : 0n;
  check(
    creationMaximumWei < BigInt(UI_C.fundingWei),
    "Current bounded child creation fees exceed the planned C owner funding.",
  );
  const remainingDeployerWei =
    BigInt(pendingFunding) * (BigInt(UI_C.fundingWei) + 21000n * fee);
  const protectedABGasReserveWei = pendingFunding > 0 ? 5_000_000_000_000n : 0n;
  check(
    BigInt(balanceWei) >= remainingDeployerWei + protectedABGasReserveWei,
    "Existing deployer balance cannot cover C funding, fees and the protected A/B gas reserve.",
  );
  return {
    createGas: String(gas),
    maxFeePerGas: String(fee),
    creationMaximumWei: String(creationMaximumWei),
    remainingDeployerWei: String(remainingDeployerWei),
    protectedABGasReserveWei: String(protectedABGasReserveWei),
    currentDeployerBalanceWei: String(balanceWei),
  };
}

function cWallets(filename, prepare = false) {
  check(
    path.resolve(filename) === path.resolve(UI_C.wallets),
    "C wallets must use the isolated fixed signing file.",
  );
  if (!fs.existsSync(filename)) {
    check(prepare, "Prepare the separate C signing file first.");
    const roles = Object.fromEntries(
      ROLES.map((role) => {
        const wallet = ethers.Wallet.createRandom();
        return [
          role,
          { address: wallet.address, privateKey: wallet.privateKey },
        ];
      }),
    );
    atomicJson(filename, { purpose: UI_C.purpose, chainId: 10200, roles });
  }
  const stat = fs.lstatSync(filename);
  check(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o077) === 0 &&
      (process.getuid === undefined || stat.uid === process.getuid()),
    "C signing file must be an owner-only regular0600file.",
  );
  const data = readJson(filename);
  check(
    data.purpose === UI_C.purpose &&
      data.chainId === 10200 &&
      Object.keys(data.roles ?? {})
        .sort()
        .join() === [...ROLES].sort().join() &&
      ROLES.every(
        (role) =>
          new ethers.Wallet(data.roles[role].privateKey).address ===
          data.roles[role].address,
      ),
    "C signing file has an unexpected purpose or role identity.",
  );
  return data;
}

export async function deployUiC({
  plan,
  source,
  stack,
  provider,
  artifacts,
  wallets,
  funder,
  journalPath = UI_C.journal,
  manifestPath = UI_C.manifest,
  send = sendOnce,
}) {
  validateUiCPlan(plan, source);
  await assertTestnet(provider, plan.chain);
  check(
    publicJson(stack.anchors) === publicJson(plan.stackAnchors) &&
      stack.feeForJurorWei === plan.feeForJurorWei &&
      stack.arbitrationCostWei === plan.arbitrationCostWei,
    "Current shared-stack anchors differ from the reviewed C plan.",
  );
  check(
    wallets.purpose === UI_C.purpose &&
      wallets.chainId === 10200 &&
      ROLES.every(
        (role) =>
          wallets.roles[role]?.address === plan.addresses[role] &&
          new ethers.Wallet(wallets.roles[role].privateKey).address ===
            plan.addresses[role],
      ) &&
      same(await funder.getAddress(), source.rehearsalAddresses.ownerA),
    "C role identities or existing authorized funder differ from the plan.",
  );
  check(
    (
      await Promise.all(
        ROLES.map((role) => provider.getCode(plan.addresses[role])),
      )
    ).every((code) => code === "0x"),
    "C funding is limited to the three reviewed disposable EOA wallets.",
  );
  if (fs.existsSync(manifestPath))
    check(
      readJson(manifestPath).planFingerprint === fingerprint(plan),
      "Existing C manifest belongs to another plan; preserve it.",
    );
  const journal = loadJournal(journalPath, plan);
  const createAction = `create-${plan.event.id}`;
  const latest = await provider.getBlock("latest");
  check(
    journal.transactions[createAction] ||
      latest.timestamp + 30 * 60 < plan.event.eventStart,
    "C needs at least30minutes of deposit margin at deployment; never silently change a started plan.",
  );
  const creation = uiCCreateRequest(plan, artifacts);
  const gas = UI_C.maximumCreateGas;
  const fees = await currentTransactionFees(provider);
  const quote = validateUiCBudget({
    balanceWei: await provider.getBalance(await funder.getAddress()),
    maxFeePerGas: fees.maxFeePerGas ?? fees.gasPrice,
    createGas: gas,
    pendingFunding: ROLES.filter(
      (role) => !journal.transactions[`fund-c-${role}`],
    ).length,
    createPending: !journal.transactions[createAction],
  });
  const perform = async (action, signer, request) => {
    if (
      ROLES.some((role) => action === `fund-c-${role}`) &&
      !journal.transactions[action]
    ) {
      // A recovered earlier transfer may have confirmed after the initial quote.
      // Reserve every still-unconfirmed grant against the current balance before
      // preparing any new funding transaction; known hashes remain receipt-only.
      const [currentFees, currentBalance] = await Promise.all([
        currentTransactionFees(provider),
        provider.getBalance(await signer.getAddress()),
      ]);
      validateUiCBudget({
        balanceWei: currentBalance,
        maxFeePerGas: currentFees.maxFeePerGas ?? currentFees.gasPrice,
        createGas: gas,
        createPending: !journal.transactions[createAction],
        pendingFunding: ROLES.filter(
          (role) =>
            journal.transactions[`fund-c-${role}`]?.state !== "confirmed",
        ).length,
      });
    }
    return send({ provider, signer, journal, journalPath, action, request });
  };
  for (const role of ROLES)
    await perform(`fund-c-${role}`, funder, {
      to: plan.addresses[role],
      value: BigInt(plan.fundingWei),
      gasLimit: 21000n,
    });
  const owner = new ethers.Wallet(wallets.roles.owner.privateKey, provider);
  const receipt = await perform(createAction, owner, {
    ...creation.request,
    gasLimit: gas,
  });
  const factory = new ethers.Interface(artifacts.KlerosEventFactoryV8.abi);
  const expectedId = factoryEventId({
    chainId: 10200,
    factory: plan.factory,
    creator: owner.address,
    eventKey: plan.event.eventKey,
  });
  const created = receipt.logs
    .filter((log) => same(log.address, plan.factory))
    .map((log) => factory.parseLog(log))
    .filter((event) => event?.name === "EventCreated");
  check(
    created.length === 1 &&
      created[0].args.version === 8n &&
      created[0].args.eventId === expectedId &&
      created[0].args.creator === owner.address &&
      created[0].args.eventKey === plan.event.eventKey &&
      created[0].args.configurationHash === creation.configurationHash,
    "C creation receipt does not match its exact owner/key/configuration.",
  );
  const address = created[0].args.eventContract;
  const child = new ethers.Contract(
    address,
    artifacts.KlerosEventV8.abi,
    provider,
  );
  const block = await provider.getBlock(receipt.blockNumber);
  const deployment = {
    eventId: plan.event.id,
    chainId: 10200,
    contract: address,
    deploymentBlock: receipt.blockNumber,
    deploymentTxHash: receipt.hash,
    contractVersion: "kleros-event-v8",
    abiVersion: "kleros-event-v8",
    depositWei: plan.depositWei,
    eventName: plan.event.title,
    eventStart: plan.event.eventStart,
    claimDeadline: plan.event.claimDeadline,
    depositOpensAt: block.timestamp,
    depositDeadline: plan.event.eventStart,
    owner: owner.address,
    creator: owner.address,
    resolver: plan.arbitration.resolver,
    arbitrator: plan.arbitration.arbitrator,
    arbitratorExtraData: EXTRA,
    policyURI: plan.policy.uri,
    templateHash: hash([creation.template.pieces, creation.template.slots]),
    codeHash: ethers.keccak256(await provider.getCode(address)),
    factory: plan.factory,
    factoryCodeHash: plan.factoryCodeHash,
    factoryEventId: expectedId,
    eventKey: plan.event.eventKey,
    configurationHash: creation.configurationHash,
    creationCodeHash: ethers.keccak256(artifacts.KlerosEventV8.bytecode),
    compiler: artifacts.KlerosEventV8.compiler,
    sourceCommit: `v8-source-sha256:${sha256(publicJson(plan.provenance.sources))}`,
  };
  const { verifyDeployment } = await import("../src/chain.mjs");
  await verifyDeployment({ provider }, deployment);
  check(
    (await child.phase()) === 0n &&
      (await child.pendingTotal()) === 0n &&
      (await child.stakerCount()) === 0n &&
      (await provider.getBalance(address)) === 0n,
    "New C must begin empty and Open; no CLI deposit or admission is permitted.",
  );
  const policy = fs.readFileSync(
    path.join(ROOT, "public/policies/v8-testnet.md"),
    "utf8",
  );
  check(
    sha256(policy) === plan.policy.sha256,
    "Local generic policy changed after C review.",
  );
  const definition = {
    id: plan.event.id,
    slug: `chiado-ui-c-${plan.id.slice(0, 8)}`,
    title: plan.event.title,
    description:
      "Synthetic public UI deposit-to-dispute rehearsal with a controlled test arbitrator.",
    startsAt: new Date(plan.event.eventStart * 1000).toISOString(),
    endsAt: new Date(plan.event.eventEnd * 1000).toISOString(),
    timezone: "UTC",
    location: "Synthetic C testnet venue",
    visibility: "public",
    editorialStatus: "published",
    registrationStatus: "open",
    organizers: [owner.address],
    staff: [],
  };
  const manifest = {
    version: 1,
    environment: "testnet",
    planId: plan.id,
    planFingerprint: fingerprint(plan),
    publicOrigin: plan.publicOrigin,
    chain: plan.chain,
    createdAt: new Date().toISOString(),
    arbitration: plan.arbitration,
    factory: plan.factory,
    factoryCodeHash: plan.factoryCodeHash,
    policy: plan.policy,
    provenance: plan.provenance,
    rehearsalAddresses: plan.addresses,
    scenario: { id: "ui-deposit-c", expectedFinalRuling: 1 },
    events: [
      {
        definition,
        deployment,
        policy,
        pieces: creation.template.pieces,
        slots: creation.template.slots,
      },
    ],
  };
  atomicJson(manifestPath, manifest, 0o644);
  return {
    manifest,
    quote,
    transactions: Object.fromEntries(
      Object.entries(journal.transactions).map(([action, entry]) => [
        action,
        {
          hash: entry.hash,
          state: entry.state,
          blockNumber: entry.blockNumber,
          blockHash: entry.blockHash,
        },
      ]),
    ),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, {
    "--prepare": "boolean",
    "--deploy": "boolean",
    "--origin": "value",
    "--start-in-minutes": "value",
    "--help": "boolean",
  });
  if (args["--help"]) {
    console.log(
      "Read-only review: node scripts/testnet-ui-scenario.mjs\nPrepare isolated local C files only: --prepare --origin https://SEPARATE_C_SITE --start-in-minutes 120\nFund three C wallets and create one child through the existing factory: --deploy\nNo CLI deposits, admissions, challenges, matching, payouts or rulings. No A/B edits or fresh stack deployment.",
    );
    return;
  }
  check(
    !(args["--prepare"] && args["--deploy"]),
    "Prepare and deploy are separate explicit commands.",
  );
  check(
    args["--prepare"] || (!args["--origin"] && !args["--start-in-minutes"]),
    "Origin and start delay are only accepted by explicit --prepare.",
  );
  const source = readJson(UI_C.sourceManifest);
  const { artifacts, provenance } = verifyCompiledInputs();
  const transport = new URL(process.env.TESTNET_RPC_URL ?? source.chain.rpcUrl);
  check(
    transport.protocol === "https:" &&
      !transport.username &&
      !transport.password &&
      !transport.search &&
      !transport.hash,
    "Use an explicit public HTTPS Chiado RPC without credentials.",
  );
  const { singleAttemptConnection } = await import(
    "../test/testnet-ui-c.e2e.mjs"
  );
  const provider = new ethers.JsonRpcProvider(
    singleAttemptConnection(transport.href),
    undefined,
    {
      cacheTimeout: -1,
      batchMaxCount: 1,
    },
  );
  const unlock =
    args["--deploy"] || args["--prepare"] ? acquireLock(UI_C.lock) : () => {};
  try {
    const stack = await verifyUiCStack({
      provider,
      source,
      sourceJournal: readJson(UI_C.sourceJournal),
      artifacts,
      provenance,
    });
    await verifyPolicy(source.policy);
    if (args["--prepare"]) {
      check(
        !fs.existsSync(UI_C.plan) &&
          !fs.existsSync(UI_C.journal) &&
          !fs.existsSync(UI_C.manifest),
        "C is already prepared or started; preserve its fixed schedule, keys and journals.",
      );
      validateUiOrigin(args["--origin"], source.publicOrigin);
      const startInMinutes = Number(args["--start-in-minutes"] ?? 120);
      check(
        Number.isSafeInteger(startInMinutes) &&
          startInMinutes >= 90 &&
          startInMinutes <= 120,
        "Choose a fresh C start90–120minutes after preparation.",
      );
      const wallets = cWallets(UI_C.wallets, true);
      const latest = await provider.getBlock("latest");
      const plan = prepareUiCPlan({
        addresses: Object.fromEntries(
          ROLES.map((role) => [role, wallets.roles[role].address]),
        ),
        source,
        provenance,
        stack,
        publicOrigin: args["--origin"],
        startInMinutes,
        now: latest.timestamp,
      });
      atomicJson(UI_C.plan, plan);
      console.log(
        publicJson({
          status: "prepared-local-only",
          planFingerprint: fingerprint(plan),
          plan,
          contractTransactionsSigned: 0,
          contractTransactionsBroadcast: 0,
        }),
      );
      return;
    }
    if (!fs.existsSync(UI_C.plan)) {
      const fees = await currentTransactionFees(provider);
      const quote = validateUiCBudget({
        balanceWei: await provider.getBalance(source.rehearsalAddresses.ownerA),
        maxFeePerGas: fees.maxFeePerGas ?? fees.gasPrice,
        createGas: UI_C.maximumCreateGas,
      });
      console.log(
        publicJson({
          status: "unprepared-read-only",
          sourceFactory: source.factory,
          stack,
          quote,
          policy: source.policy,
          requiredNextAction:
            "Prepare C after the reviewed application and harness are healthy and the separate destination is configured; keep a long real deposit margin for its first deployment.",
          contractTransactionsSigned: 0,
          contractTransactionsBroadcast: 0,
        }),
      );
      return;
    }
    const plan = validateUiCPlan(readJson(UI_C.plan), source);
    check(
      publicJson(stack.anchors) === publicJson(plan.stackAnchors),
      "Shared stack runtime anchors changed after C preparation.",
    );
    if (!args["--deploy"]) {
      console.log(
        publicJson({
          status: "review-read-only",
          planFingerprint: fingerprint(plan),
          plan,
          journal: loadJournal(UI_C.journal, plan),
          contractTransactionsSigned: 0,
          contractTransactionsBroadcast: 0,
        }),
      );
      return;
    }
    const wallets = cWallets(UI_C.wallets);
    const existing = secureWalletFile();
    const funder = new ethers.Wallet(
      existing.roles.ownerA.privateKey,
      provider,
    );
    const result = await deployUiC({
      plan,
      source,
      stack,
      provider,
      artifacts,
      wallets,
      funder,
    });
    console.log(
      publicJson({
        status: "deployed-or-canonical-receipts-recovered",
        ...result,
      }),
    );
  } finally {
    unlock();
    provider.destroy();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main().catch(safeFailure);
