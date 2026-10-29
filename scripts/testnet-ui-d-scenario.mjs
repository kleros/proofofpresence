import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ethers } from "ethers";
import { ROOT, PRIVATE_ROOT, DAY, EXTRA, check, sha256, publicJson, atomicJson,
  readJson, secureWalletFile, parseArgs, validateChain, fingerprint,
  verifyCompiledInputs, verifyPolicy, assertTestnet, currentTransactionFees,
  acquireLock, loadJournal, sendOnce, safeFailure } from "../src/testnet-config.mjs";
import { eventV8Template, factoryEventId } from "../src/contracts-v8.mjs";
import { hash } from "../src/utils.mjs";
import { verifyUiCStack } from "./testnet-ui-scenario.mjs";
import { protectedFacts, singleAttemptConnection } from "../test/testnet-ui-c.e2e.mjs";

// Separate opt-in test profile. Import/default review never opens runtime files.
export const UI_D = Object.freeze({
  purpose: "Disposable Chiado 15-minute UI-deposit D rehearsal only",
  contractVersion: "kleros-event-v8-test15m", numericVersion: 80015,
  challengePeriod: 900, matchPeriod: 900,
  eventArtifact: "KlerosEventV8Test15m", factoryArtifact: "KlerosEventFactoryV8Test15m",
  plan: path.join(PRIVATE_ROOT, "ui-d-plan.json"),
  wallets: path.join(PRIVATE_ROOT, "ui-d-wallets.json"),
  journal: path.join(PRIVATE_ROOT, "ui-d-journal.json"),
  manifest: path.join(ROOT, "registry/chiado-v8-ui-d.json"),
  sourceManifest: path.join(ROOT, "registry/chiado-v8-controlled.json"),
  sourceJournal: path.join(PRIVATE_ROOT, "chiado-deployment-journal.json"),
  protectedCManifest: path.join(ROOT, "registry/chiado-v8-ui-c.json"),
  policyPath: path.join(ROOT, "public/policies/v8-test15m.md"),
  lock: path.join(PRIVATE_ROOT, "chiado-operation.lock"),
  fundingWei: "10000000000000", depositWei: "1000000000000",
  maximumFactoryGas: 12_000_000n, maximumCreateGas: 8_000_000n,
  protectedABCReserveWei: "10000000000000",
});
const ROLES = ["owner", "alice", "bob"];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const digest = (v) => /^[0-9a-f]{64}$/i.test(v ?? "");
const profileArtifacts = (artifacts) => {
  const event = artifacts[UI_D.eventArtifact], factory = artifacts[UI_D.factoryArtifact];
  check(event?.bytecode && factory?.bytecode && event.abi && factory.abi,
    "Compile and verify the exact separate 80015 test-profile artifacts first.");
  return { event, factory };
};
export function assertUiDArtifacts(plan, artifacts, provenance) {
  const { event, factory } = profileArtifacts(artifacts);
  check(publicJson(provenance) === publicJson(plan.provenance) &&
    ethers.keccak256(factory.bytecode) === plan.factoryCreationCodeHash &&
    ethers.keccak256(factory.bytecode) === plan.provenance.creationCodeHashes[UI_D.factoryArtifact] &&
    ethers.keccak256(event.bytecode) === plan.provenance.creationCodeHashes[UI_D.eventArtifact],
    "D current exact provenance and both creation artifacts must match the immutable plan before funding.");
}

export function validateUiDOrigin(origin, primaryOrigin, cOrigin) {
  let url;
  try { url = new URL(origin); } catch { check(false, "An exact separate HTTPS D origin is required."); }
  check(url.protocol === "https:" && url.origin === origin && !url.username && !url.password &&
    origin !== primaryOrigin && origin !== cOrigin,
    "D must use an exact separate HTTPS origin, distinct from both protected applications.");
  return origin;
}
function validateSources(source, protectedC) {
  check(source?.environment === "testnet" && source.chain?.chainId === 10200 &&
    source.arbitration?.mode === "controlled" && source.events?.length === 2 &&
    protectedC?.environment === "testnet" && protectedC.events?.length === 1 &&
    publicJson(source.chain) === publicJson(protectedC.chain) &&
    publicJson(source.arbitration) === publicJson(protectedC.arbitration) &&
    [...source.events, ...protectedC.events].every(r => r.deployment.chainId === 10200 &&
      r.deployment.contractVersion === "kleros-event-v8"),
    "D protects the exact existing two A/B and one C production-window children.");
}

export function uiDBudgetApproval(plan) {
  return sha256(publicJson({ planFingerprint: fingerprint(plan), budget: plan.deploymentBudget }));
}
export function preparationFeeCeiling(value, currentFee) {
  const current = BigInt(currentFee);
  check(current > 0n && (value === undefined || /^[1-9][0-9]*$/.test(value)),
    "D preparation fee ceiling must be an explicit positive integer in wei.");
  const ceiling = value === undefined ? 2n * current : BigInt(value);
  check(ceiling >= current, "D preparation fee ceiling is below the current bounded fee quote.");
  validateUiDBudget({ balanceWei: 3n * BigInt(UI_D.fundingWei) + 63000n * ceiling +
    BigInt(UI_D.protectedABCReserveWei), maxFeePerGas: ceiling });
  return ceiling;
}
export function validateUiDBudget({ balanceWei, maxFeePerGas, factoryGas = UI_D.maximumFactoryGas,
  createGas = UI_D.maximumCreateGas, pendingFunding = 3, factoryPending = true, createPending = true }) {
  const fee = BigInt(maxFeePerGas), fg = BigInt(factoryGas), cg = BigInt(createGas);
  check(fee > 0n && fg > 0n && fg <= UI_D.maximumFactoryGas && cg > 0n && cg <= UI_D.maximumCreateGas &&
    Number.isInteger(pendingFunding) && pendingFunding >= 0 && pendingFunding <= 3,
    "D fee, gas or grant count exceeds its reviewed boundary.");
  const ownerMaximumWei = ((factoryPending ? fg : 0n) + (createPending ? cg : 0n)) * fee;
  check(ownerMaximumWei + 1_000_000_000_000n <= BigInt(UI_D.fundingWei),
    "D owner grant cannot cover factory, child and remaining protocol gas reserve.");
  const remainingFundingWei = BigInt(pendingFunding) * (BigInt(UI_D.fundingWei) + 21000n * fee);
  check(BigInt(balanceWei) >= remainingFundingWei + BigInt(UI_D.protectedABCReserveWei),
    "D grants and transfer fees would consume the protected A/B+C native gas reserve.");
  return { maxFeePerGas: String(fee), factoryGas: String(fg), createGas: String(cg),
    ownerMaximumWei: String(ownerMaximumWei), remainingFundingWei: String(remainingFundingWei),
    protectedABCReserveWei: UI_D.protectedABCReserveWei };
}

export function validateUiDPlan(plan, source, protectedC) {
  validateSources(source, protectedC);
  validateChain(plan.chain);
  validateUiDOrigin(plan.publicOrigin, source.publicOrigin, protectedC.publicOrigin);
  check(plan.version === 1 && plan.purpose === UI_D.purpose && plan.environment === "testnet" &&
    /^[0-9a-f-]{36}$/i.test(plan.id) && Number.isFinite(Date.parse(plan.createdAt)), "Invalid isolated D plan.");
  check(publicJson(plan.profile) === publicJson({ contractVersion: UI_D.contractVersion,
    numericVersion: 80015, challengePeriod: 900, matchPeriod: 900 }) &&
    publicJson(plan.chain) === publicJson(source.chain) &&
    publicJson(plan.arbitration) === publicJson(source.arbitration) &&
    plan.sourceManifestSha256 === sha256(publicJson(source)) &&
    plan.protectedCManifestSha256 === sha256(publicJson(protectedC)) &&
    plan.sourcePlanFingerprint === source.planFingerprint &&
    plan.protectedCPlanFingerprint === protectedC.planFingerprint &&
    publicJson(plan.protectedContracts) === publicJson([...source.events, ...protectedC.events].map(r => r.deployment.contract)) &&
    ethers.isHexString(plan.factoryCreationCodeHash, 32) &&
    same(plan.factory, ethers.getCreateAddress({ from: plan.addresses?.owner, nonce: 0 })) &&
    plan.factoryCodeHash === null && plan.factoryNonce === 0,
    "D profile, protected manifests or predicted new-factory creation changed.");
  const excluded = new Set([...Object.values(source.rehearsalAddresses),
    ...Object.values(protectedC.rehearsalAddresses)].map(a => a.toLowerCase()));
  check(Object.keys(plan.addresses ?? {}).sort().join() === [...ROLES].sort().join() &&
    ROLES.every(r => ethers.isAddress(plan.addresses[r]) && !same(plan.addresses[r], ethers.ZeroAddress) &&
      !excluded.has(plan.addresses[r].toLowerCase())) &&
    new Set(ROLES.map(r => plan.addresses[r].toLowerCase())).size === 3,
    "D requires three fresh distinct role wallets separate from A/B+C.");
  const event = plan.event, lead = event?.eventStart - Math.floor(Date.parse(plan.createdAt) / 1000);
  check(event?.id === `chiado-ui-${plan.id}-d` && event.version === UI_D.contractVersion &&
    event.ownerRole === "owner" && event.eventKey === ethers.id(event.id) &&
    event.title === "Chiado fast UI deposit rehearsal D (15-minute windows)" &&
    Number.isSafeInteger(event.eventStart) && event.eventEnd === event.eventStart + 12 * 3600 &&
    event.claimDeadline === event.eventStart + 7 * DAY && lead >= 60 * 60 && lead <= 240 * 60 &&
    plan.fundingWei === UI_D.fundingWei && plan.depositWei === UI_D.depositWei &&
    plan.expectedFinalRuling === 1 && plan.stackAnchors?.length === 3 &&
    plan.feeForJurorWei === "10000000000" && plan.arbitrationCostWei === "30000000000",
    "D schedule, exact principal, controlled fees or attended-ruling fixture changed.");
  check(plan.policy?.uri === plan.publicOrigin + "/policies/v8-test15m.md" && digest(plan.policy.sha256) &&
    publicJson(plan.policy) !== publicJson(source.policy), "D requires its separate explicit 15-minute policy.");
  const b = plan.deploymentBudget;
  check(b && b.factoryGas === String(UI_D.maximumFactoryGas) && b.createGas === String(UI_D.maximumCreateGas) &&
    b.protectedABCReserveWei === UI_D.protectedABCReserveWei && BigInt(b.maxFeePerGas) > 0n,
    "D needs an exact reviewed deployment fee/gas ceiling and A/B+C reserve.");
  validateUiDBudget({ balanceWei: BigInt(UI_D.fundingWei) * 3n + 63000n * BigInt(b.maxFeePerGas) +
    BigInt(UI_D.protectedABCReserveWei), maxFeePerGas: b.maxFeePerGas });
  check(plan.provenance?.sources && plan.provenance?.creationCodeHashes?.[UI_D.factoryArtifact] ===
    plan.factoryCreationCodeHash, "D must pin the selected factory creation artifact provenance.");
  return plan;
}

export function prepareUiDPlan({ addresses, source, protectedC, provenance, artifacts, stack,
  publicOrigin, policy, maxFeePerGas, startInMinutes = 120,
  now = Math.floor(Date.now() / 1000), id = randomUUID() }) {
  check(Number.isSafeInteger(startInMinutes) && startInMinutes >= 60 && startInMinutes <= 240,
    "D needs a fresh60–240minute lead for hosting and actual UI deposits.");
  const { factory } = profileArtifacts(artifacts), eventId = `chiado-ui-${id}-d`;
  const plan = { version: 1, purpose: UI_D.purpose, id, environment: "testnet",
    createdAt: new Date(now * 1000).toISOString(), chain: source.chain, publicOrigin, addresses,
    profile: { contractVersion: UI_D.contractVersion, numericVersion: 80015, challengePeriod: 900, matchPeriod: 900 },
    fundingWei: UI_D.fundingWei, depositWei: UI_D.depositWei,
    factory: ethers.getCreateAddress({ from: addresses.owner, nonce: 0 }), factoryNonce: 0,
    factoryCodeHash: null, factoryCreationCodeHash: ethers.keccak256(factory.bytecode),
    arbitration: source.arbitration, policy, provenance,
    sourceManifestSha256: sha256(publicJson(source)), protectedCManifestSha256: sha256(publicJson(protectedC)),
    sourcePlanFingerprint: source.planFingerprint, protectedCPlanFingerprint: protectedC.planFingerprint,
    protectedContracts: [...source.events, ...protectedC.events].map(r => r.deployment.contract),
    stackAnchors: stack.anchors, feeForJurorWei: stack.feeForJurorWei, arbitrationCostWei: stack.arbitrationCostWei,
    deploymentBudget: { maxFeePerGas: String(maxFeePerGas), factoryGas: String(UI_D.maximumFactoryGas),
      createGas: String(UI_D.maximumCreateGas), protectedABCReserveWei: UI_D.protectedABCReserveWei },
    event: { id: eventId, version: UI_D.contractVersion, ownerRole: "owner", eventKey: ethers.id(eventId),
      title: "Chiado fast UI deposit rehearsal D (15-minute windows)", eventStart: now + startInMinutes * 60,
      eventEnd: now + startInMinutes * 60 + 12 * 3600, claimDeadline: now + startInMinutes * 60 + 7 * DAY },
    expectedFinalRuling: 1,
    isolation: "Separate D site/backend/volume/manifest/roles/plan/journal. Shared operation lock; A/B+C unchanged.",
  };
  return validateUiDPlan(plan, source, protectedC);
}

export function uiDCreateRequest(plan, artifacts) {
  const { factory } = profileArtifacts(artifacts);
  const template = eventV8Template({ eventName: plan.event.title, depositAmount: plan.depositWei,
    policyURI: plan.policy.uri, nativeCurrencySymbol: "XDAI" });
  const iface = new ethers.Interface(factory.abi), config = { depositAmount: plan.depositWei,
    eventName: plan.event.title, eventStart: plan.event.eventStart, claimDeadline: plan.event.claimDeadline,
    arbitration: { disputeResolver: plan.arbitration.resolver, extraData: EXTRA,
      metaEvidenceTemplate: template.pieces, metaEvidenceSlots: template.slots, policyURI: plan.policy.uri } };
  return { template, config, request: { to: plan.factory, value: 0n,
    data: iface.encodeFunctionData("createEvent", [plan.event.eventKey, config]) },
    configurationHash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", iface.getFunction("createEvent").inputs[1]], [plan.addresses.owner, config])) };
}

export async function protectedDContext(source, protectedC, provider, legacyArtifacts) {
  validateSources(source, protectedC);
  return Promise.all([...source.events.map(r => [r, source.rehearsalAddresses]),
    ...protectedC.events.map(r => [r, protectedC.rehearsalAddresses])]
    .map(([record, addresses]) => protectedFacts(record, provider, legacyArtifacts.KlerosEventV8.abi, addresses)));
}
export function assertProtectedDUnchanged(before, after) {
  check(before?.length === 3 && after?.length === 3 &&
    [...before, ...after].every(x => ethers.isAddress(x?.financial?.contract)) &&
    new Set(before.map(x => x.financial.contract.toLowerCase())).size === 3 &&
    publicJson(before.map(x => x.financial)) === publicJson(after.map(x => x.financial)),
    "D operation changed a protected A/B+C financial snapshot.");
}
export async function verifyUiDStack({ provider, source, protectedC, sourceJournal,
  legacyArtifacts, legacyProvenance, artifacts, provenance }) {
  validateSources(source, protectedC);
  profileArtifacts(artifacts);
  check(provenance.creationCodeHashes?.[UI_D.factoryArtifact] && provenance.creationCodeHashes?.[UI_D.eventArtifact],
    "D selected test-profile provenance is missing.");
  if (!legacyArtifacts || !legacyProvenance) {
    const legacy = verifyCompiledInputs(ROOT);
    legacyArtifacts = legacy.artifacts;
    legacyProvenance = legacy.provenance;
  }
  const stack = await verifyUiCStack({ provider, source, sourceJournal,
    artifacts: legacyArtifacts, provenance: legacyProvenance });
  const { verifyDeployment } = await import("../src/chain.mjs");
  for (const record of [...source.events, ...protectedC.events])
    await verifyDeployment({ provider }, record.deployment);
  return stack;
}
export function assertUiDDeployment(record, plan, journal, creation, artifacts) {
  const d = record.deployment, { event, factory } = profileArtifacts(artifacts);
  const born = journal.transactions["deploy-d-factory"], entry = journal.transactions[`create-${plan.event.id}`];
  check(born?.state === "confirmed" && born.nonce === 0 && born.expected?.to === null &&
    ethers.keccak256(factory.bytecode) === plan.factoryCreationCodeHash &&
    ethers.keccak256(event.bytecode) === plan.provenance.creationCodeHashes[UI_D.eventArtifact] &&
    born.expected.from === plan.addresses.owner.toLowerCase() && born.expected.value === "0" &&
    born.expected.data === factory.bytecode && d.factoryDeploymentTxHash === born.hash &&
    d.factoryDeploymentBlock === born.blockNumber && ethers.isHexString(d.factoryCodeHash, 32) &&
    entry?.state === "confirmed" && entry.expected?.from === plan.addresses.owner.toLowerCase() &&
    entry.expected.to === plan.factory.toLowerCase() && entry.expected.value === "0" &&
    entry.expected.data === creation.request.data && entry.hash === d.deploymentTxHash &&
    entry.blockNumber === d.deploymentBlock, "D factory/child creation must match their exact confirmed once-journal anchors.");
  check(d.eventId === plan.event.id && record.definition.id === plan.event.id && d.chainId === 10200 &&
    d.contractVersion === UI_D.contractVersion && d.abiVersion === UI_D.contractVersion &&
    same(d.owner, plan.addresses.owner) && same(d.creator, plan.addresses.owner) && same(d.factory, plan.factory) &&
    same(d.resolver, plan.arbitration.resolver) && same(d.arbitrator, plan.arbitration.arbitrator) &&
    d.arbitratorExtraData === EXTRA && d.policyURI === plan.policy.uri && d.depositWei === plan.depositWei &&
    d.eventName === plan.event.title && d.eventStart === plan.event.eventStart &&
    d.depositDeadline === plan.event.eventStart && d.claimDeadline === plan.event.claimDeadline &&
    d.eventKey === plan.event.eventKey && d.configurationHash === creation.configurationHash &&
    d.creationCodeHash === ethers.keccak256(event.bytecode) &&
    d.factoryEventId === factoryEventId({ chainId: 10200, factory: plan.factory,
      creator: plan.addresses.owner, eventKey: plan.event.eventKey }) &&
    publicJson(record.pieces) === publicJson(creation.template.pieces) &&
    publicJson(record.slots) === publicJson(creation.template.slots) &&
    d.templateHash === hash([creation.template.pieces, creation.template.slots]) &&
    sha256(record.policy) === plan.policy.sha256 && d.challengePeriodSeconds === 900 && d.matchPeriodSeconds === 900 &&
    record.definition.startsAt === new Date(plan.event.eventStart * 1000).toISOString() &&
    record.definition.endsAt === new Date(plan.event.eventEnd * 1000).toISOString(),
    "D child/profile/roles/policy/template/calendar/configuration differs from the exact80015 plan.");
  return entry;
}
export async function verifyUiDFactory({ provider, plan, artifacts, journal }) {
  const { factory: artifact, event } = profileArtifacts(artifacts), entry = journal.transactions["deploy-d-factory"];
  check(entry?.state === "confirmed" && entry.expected?.to === null && entry.expected.value === "0" &&
    entry.expected.data === artifact.bytecode && entry.expected.from === plan.addresses.owner.toLowerCase() &&
    entry.nonce === 0, "D factory must be the exact confirmed owner-nonce0 artifact deployment.");
  const [receipt, tx] = await Promise.all([provider.getTransactionReceipt(entry.hash), provider.getTransaction(entry.hash)]);
  const [block, code, originalCode] = await Promise.all([provider.getBlock(entry.blockNumber),
    provider.getCode(plan.factory), provider.getCode(plan.factory, entry.blockNumber)]);
  check(receipt?.status === 1 && (await receipt.confirmations()) >= 2 && tx?.to === null && tx.chainId === 10200n &&
    tx.nonce === 0 && tx.value === 0n && same(tx.from, plan.addresses.owner) && tx.data === artifact.bytecode &&
    same(receipt.contractAddress, plan.factory) && receipt.blockHash === entry.blockHash &&
    receipt.blockNumber === entry.blockNumber && block?.hash === receipt.blockHash &&
    code !== "0x" && code === originalCode && ethers.keccak256(tx.data) === plan.factoryCreationCodeHash,
    "D factory constructor, canonical receipt, predicted address or immutable runtime changed.");
  const factory = new ethers.Contract(plan.factory, artifact.abi, provider);
  check((await factory.VERSION()) === 80015n && (await factory.eventCreationCode()) === event.bytecode,
    "D factory must expose version80015 and exactly the selected15-minute child creation code.");
  return { factory, codeHash: ethers.keccak256(code), deploymentTxHash: receipt.hash,
    deploymentBlock: receipt.blockNumber, blockHash: receipt.blockHash };
}

export function dWallets(filename = UI_D.wallets, prepare = false) {
  check(path.resolve(filename) === path.resolve(UI_D.wallets), "Only the fixed isolated D signing path is allowed.");
  if (!fs.existsSync(filename)) {
    check(prepare, "Prepare D signing identities explicitly first.");
    const roles = Object.fromEntries(ROLES.map(role => { const w = ethers.Wallet.createRandom();
      return [role, { address: w.address, privateKey: w.privateKey }]; }));
    atomicJson(filename, { purpose: UI_D.purpose, chainId: 10200, roles });
  }
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 &&
    (!process.getuid || stat.uid === process.getuid()), "D keys require a same-user regular0600file.");
  const keys = readJson(filename);
  check(keys.purpose === UI_D.purpose && keys.chainId === 10200 &&
    Object.keys(keys.roles ?? {}).sort().join() === [...ROLES].sort().join() &&
    ROLES.every(role => new ethers.Wallet(keys.roles[role].privateKey).address === keys.roles[role].address),
    "D keyfile purpose or role identities differ.");
  return keys;
}

/** Recheck the actual populated transaction immediately before the underlying key can sign. */
export function boundedDSigner(signer, { provider, plan, journal, action, request }) {
  return {
    getAddress: () => signer.getAddress(),
    populateTransaction: (tx) => signer.populateTransaction(tx),
    signTransaction: async (tx) => {
      const address = await signer.getAddress(), fee = BigInt(tx.maxFeePerGas ?? tx.gasPrice ?? 0),
        gas = BigInt(tx.gasLimit ?? 0), ceiling = BigInt(plan.deploymentBudget.maxFeePerGas),
        funding = action.startsWith("fund-d-"), factory = action === "deploy-d-factory";
      check(BigInt(tx.chainId ?? 0) === 10200n && same(tx.from ?? address, address) &&
        (tx.to ?? null)?.toLowerCase() === (request.to ?? null)?.toLowerCase() &&
        (tx.data ?? "0x") === (request.data ?? "0x") && BigInt(tx.value ?? 0) === BigInt(request.value ?? 0) &&
        fee > 0n && fee <= ceiling && gas > 0n && gas <= BigInt(request.gasLimit) &&
        BigInt(tx.maxPriorityFeePerGas ?? 0) <= fee &&
        (funding || tx.nonce === (factory ? 0 : 1)),
        "D populated transaction exceeds its exact request, chain, nonce, gas or approved fee ceiling; key not used.");
      const balance = await provider.getBalance(address);
      if ((funding || factory) && !journal.transactions["deploy-d-factory"])
        check((await provider.getTransactionCount(plan.addresses.owner, "pending")) === 0 &&
          (await provider.getCode(plan.factory)) === "0x", "D owner nonce/predicted factory address changed before signing; key not used.");
      if (funding) validateUiDBudget({ balanceWei: balance, maxFeePerGas: ceiling,
        pendingFunding: ROLES.filter(r => journal.transactions[`fund-d-${r}`]?.state !== "confirmed").length,
        factoryPending: !journal.transactions["deploy-d-factory"],
        createPending: !journal.transactions[`create-${plan.event.id}`] });
      else check(balance >= BigInt(tx.value ?? 0) + gas * fee + 1_000_000_000_000n +
        (factory ? UI_D.maximumCreateGas * ceiling : 0n),
        "D signing would consume child-deployment or remaining protocol gas reserves.");
      return signer.signTransaction(tx);
    },
  };
}

export async function deployUiD({ plan, source, protectedC, stack, provider, artifacts, legacyArtifacts,
  provenance, wallets, funder, budgetApproval, journalPath = UI_D.journal, manifestPath = UI_D.manifest,
  policyText = fs.readFileSync(UI_D.policyPath, "utf8"), send = sendOnce }) {
  validateUiDPlan(plan, source, protectedC);
  assertUiDArtifacts(plan, artifacts, provenance);
  await assertTestnet(provider, plan.chain);
  const { event: eventArtifact, factory: factoryArtifact } = profileArtifacts(artifacts);
  check(budgetApproval === uiDBudgetApproval(plan), "Review and explicitly approve the exact D deployment budget hash first.");
  check(publicJson(stack.anchors) === publicJson(plan.stackAnchors) &&
    wallets.purpose === UI_D.purpose && wallets.chainId === 10200 &&
    ROLES.every(r => wallets.roles[r]?.address === plan.addresses[r] &&
      new ethers.Wallet(wallets.roles[r].privateKey).address === plan.addresses[r]) &&
    same(await funder.getAddress(), source.rehearsalAddresses.ownerA), "D stack, funding identity or role keys differ.");
  check(sha256(policyText) === plan.policy.sha256, "D fast-policy bytes changed after preparation.");
  check((await Promise.all(ROLES.map(r => provider.getCode(plan.addresses[r])))).every(code => code === "0x"),
    "D grants are restricted to the three prepared disposable EOA identities.");
  if (fs.existsSync(manifestPath)) check(readJson(manifestPath).planFingerprint === fingerprint(plan),
    "An existing D manifest belongs to another immutable plan.");
  const journal = loadJournal(journalPath, plan), createAction = `create-${plan.event.id}`;
  if (!journal.transactions["deploy-d-factory"])
    check((await provider.getTransactionCount(plan.addresses.owner, "pending")) === 0 &&
      (await provider.getCode(plan.factory)) === "0x", "D owner nonce/predicted factory address is occupied; no grants are permitted.");
  check(journal.transactions[createAction] || (await provider.getBlock("latest")).timestamp + 45 * 60 < plan.event.eventStart,
    "Fresh D deployment needs45minutes of real hosting/deposit margin; never change a started plan.");
  const quote = async () => {
    const fees = await currentTransactionFees(provider), fee = fees.maxFeePerGas ?? fees.gasPrice;
    check(BigInt(fee) <= BigInt(plan.deploymentBudget.maxFeePerGas), "D current fee exceeds its explicitly approved ceiling.");
    return validateUiDBudget({ balanceWei: await provider.getBalance(await funder.getAddress()), maxFeePerGas: fee,
      pendingFunding: ROLES.filter(r => journal.transactions[`fund-d-${r}`]?.state !== "confirmed").length,
      factoryPending: !journal.transactions["deploy-d-factory"], createPending: !journal.transactions[createAction] });
  };
  const initialQuote = await quote();
  const perform = async (action, signer, request) => {
    await quote();
    const before = await protectedDContext(source, protectedC, provider, legacyArtifacts);
    const guarded = boundedDSigner(signer, { provider, plan, journal, action, request });
    const receipt = await send({ provider, signer: guarded, journal, journalPath, action, request });
    assertProtectedDUnchanged(before, await protectedDContext(source, protectedC, provider, legacyArtifacts));
    return receipt;
  };
  for (const role of ROLES) await perform(`fund-d-${role}`, funder,
    { to: plan.addresses[role], value: BigInt(plan.fundingWei), gasLimit: 21000n });
  const owner = new ethers.Wallet(wallets.roles.owner.privateKey, provider);
  if (!journal.transactions["deploy-d-factory"])
    check((await provider.getTransactionCount(owner.address, "pending")) === 0 &&
      (await provider.getCode(plan.factory)) === "0x", "D factory owner nonce or predicted address is already occupied.");
  await perform("deploy-d-factory", owner, { data: factoryArtifact.bytecode, value: 0n,
    gasLimit: UI_D.maximumFactoryGas });
  const factoryAnchor = await verifyUiDFactory({ provider, plan, artifacts, journal });
  const creation = uiDCreateRequest(plan, artifacts);
  const receipt = await perform(createAction, owner, { ...creation.request, gasLimit: UI_D.maximumCreateGas });
  const expectedId = factoryEventId({ chainId: 10200, factory: plan.factory, creator: owner.address, eventKey: plan.event.eventKey });
  const iface = new ethers.Interface(factoryArtifact.abi);
  const created = receipt.logs.filter(l => same(l.address, plan.factory)).map(l => iface.parseLog(l))
    .filter(l => l?.name === "EventCreated");
  check(created.length === 1 && created[0].args.version === 80015n && created[0].args.eventId === expectedId &&
    same(created[0].args.creator, owner.address) && created[0].args.eventKey === plan.event.eventKey &&
    created[0].args.configurationHash === creation.configurationHash, "D child creation receipt differs from its exact plan.");
  const address = created[0].args.eventContract, block = await provider.getBlock(receipt.blockNumber);
  const child = new ethers.Contract(address, eventArtifact.abi, provider);
  check((await child.VERSION()) === 80015n && (await child.CHALLENGE_PERIOD()) === 900n &&
    (await child.MATCH_PERIOD()) === 900n && (await child.phase()) === 0n &&
    (await child.pendingTotal()) === 0n && (await child.stakerCount()) === 0n &&
    (await provider.getBalance(address)) === 0n, "New D must be empty80015/Open with exact900second windows.");
  const deployment = { eventId: plan.event.id, chainId: 10200, contract: address,
    deploymentBlock: receipt.blockNumber, deploymentTxHash: receipt.hash,
    contractVersion: UI_D.contractVersion, abiVersion: UI_D.contractVersion, depositWei: plan.depositWei,
    eventName: plan.event.title, eventStart: plan.event.eventStart, claimDeadline: plan.event.claimDeadline,
    depositOpensAt: block.timestamp, depositDeadline: plan.event.eventStart, owner: owner.address, creator: owner.address,
    resolver: plan.arbitration.resolver, arbitrator: plan.arbitration.arbitrator, arbitratorExtraData: EXTRA,
    policyURI: plan.policy.uri, templateHash: hash([creation.template.pieces, creation.template.slots]),
    codeHash: ethers.keccak256(await provider.getCode(address)), factory: plan.factory,
    factoryCodeHash: factoryAnchor.codeHash, factoryDeploymentTxHash: factoryAnchor.deploymentTxHash,
    factoryDeploymentBlock: factoryAnchor.deploymentBlock, factoryEventId: expectedId, eventKey: plan.event.eventKey,
    configurationHash: creation.configurationHash, creationCodeHash: ethers.keccak256(eventArtifact.bytecode),
    challengePeriodSeconds: 900, matchPeriodSeconds: 900, compiler: eventArtifact.compiler,
    sourceCommit: `v8-test15m-source-sha256:${sha256(publicJson(plan.provenance.sources))}` };
  const { verifyDeployment } = await import("../src/chain.mjs");
  await verifyDeployment({ provider }, deployment);
  const definition = { id: plan.event.id, slug: `chiado-ui-d-${plan.id.slice(0, 8)}`, title: plan.event.title,
    description: "Synthetic15-minute test profile with controlled arbitration; independent from immutable A/B+C.",
    startsAt: new Date(plan.event.eventStart * 1000).toISOString(), endsAt: new Date(plan.event.eventEnd * 1000).toISOString(),
    timezone: "UTC", location: "Synthetic D testnet venue", visibility: "public", editorialStatus: "published",
    registrationStatus: "open", organizers: [owner.address], staff: [] };
  const manifest = { version: 1, environment: "testnet", planId: plan.id, planFingerprint: fingerprint(plan),
    publicOrigin: plan.publicOrigin, chain: plan.chain, createdAt: new Date().toISOString(), arbitration: plan.arbitration,
    factory: plan.factory, factoryCodeHash: factoryAnchor.codeHash, factoryDeploymentTxHash: factoryAnchor.deploymentTxHash,
    factoryDeploymentBlock: factoryAnchor.deploymentBlock, policy: plan.policy, provenance: plan.provenance,
    profile: plan.profile, rehearsalAddresses: plan.addresses, scenario: { id: "ui-deposit-d", expectedFinalRuling: 1 },
    protectedManifestSha256: plan.sourceManifestSha256, protectedCManifestSha256: plan.protectedCManifestSha256,
    events: [{ definition, deployment, policy: policyText, pieces: creation.template.pieces, slots: creation.template.slots }] };
  atomicJson(manifestPath, manifest, 0o644);
  return { manifest, quote: initialQuote, budgetApproval,
    transactions: Object.fromEntries(Object.entries(journal.transactions).map(([action, e]) =>
      [action, { hash: e.hash, state: e.state, blockNumber: e.blockNumber, blockHash: e.blockHash }])) };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { "--prepare": "boolean", "--deploy": "boolean", "--review": "boolean",
    "--origin": "value", "--start-in-minutes": "value", "--max-fee-per-gas": "value",
    "--budget-approval": "value", "--help": "boolean" });
  check(args["--prepare"] || args["--max-fee-per-gas"] === undefined,
    "An explicit D fee ceiling is accepted only during preparation; an immutable plan cannot be changed.");
  check([args["--prepare"], args["--deploy"], args["--review"]].filter(Boolean).length <= 1,
    "D preparation, review and deployment are separate explicit commands.");
  if (args["--help"] || !(args["--prepare"] || args["--deploy"] || args["--review"])) {
    console.log(publicJson({ status: "review-only", contractVersion: UI_D.contractVersion, version: 80015,
      challengePeriod: 900, matchPeriod: 900, runtimeFilesRead: 0, signingFilesRead: 0,
      networkRequests: 0, signatures: 0, broadcasts: 0,
      instruction: "After code/source/hosting readiness GO: --prepare --origin exact-separate-D --start-in-minutes120. Review its budget hash, then explicit --deploy --budget-approval HASH. No protocol CLI actions." }));
    return;
  }
  check(args["--prepare"] || (!args["--origin"] && !args["--start-in-minutes"]), "Schedule/origin belongs only to explicit preparation.");
  check(!args["--deploy"] || digest(args["--budget-approval"]), "Explicit D deployment requires the reviewed budget approval hash.");
  const source = readJson(UI_D.sourceManifest), protectedC = readJson(UI_D.protectedCManifest);
  const selected = verifyCompiledInputs(ROOT, UI_D.contractVersion), legacy = verifyCompiledInputs(ROOT);
  const transport = new URL(process.env.TESTNET_RPC_URL ?? source.chain.rpcUrl);
  check(transport.protocol === "https:" && !transport.username && !transport.password && !transport.search && !transport.hash,
    "D transport must be public HTTPS without credentials or redirects.");
  const provider = new ethers.JsonRpcProvider(singleAttemptConnection(transport.href), undefined,
    { cacheTimeout: -1, batchMaxCount: 1 });
  const unlock = acquireLock(UI_D.lock);
  try {
    const stack = await verifyUiDStack({ provider, source, protectedC, sourceJournal: readJson(UI_D.sourceJournal),
      legacyArtifacts: legacy.artifacts, legacyProvenance: legacy.provenance, ...selected });
    if (args["--prepare"]) {
      check([UI_D.plan, UI_D.journal, UI_D.manifest].every(f => !fs.existsSync(f)),
        "D already has prepared or started files; preserve its identities, schedule and journals.");
      validateUiDOrigin(args["--origin"], source.publicOrigin, protectedC.publicOrigin);
      const startInMinutes = Number(args["--start-in-minutes"] ?? 120);
      check(Number.isSafeInteger(startInMinutes) && startInMinutes >= 60 && startInMinutes <= 240,
        "D needs60–240minutes before any signing identity is prepared.");
      const policy = { uri: args["--origin"] + "/policies/v8-test15m.md", sha256: sha256(fs.readFileSync(UI_D.policyPath)) };
      const fees = await currentTransactionFees(provider),
        ceiling = preparationFeeCeiling(args["--max-fee-per-gas"], fees.maxFeePerGas ?? fees.gasPrice);
      validateUiDBudget({ balanceWei: await provider.getBalance(source.rehearsalAddresses.ownerA), maxFeePerGas: ceiling });
      const wallets = dWallets(UI_D.wallets, true), latest = await provider.getBlock("latest");
      const plan = prepareUiDPlan({ addresses: Object.fromEntries(ROLES.map(r => [r, wallets.roles[r].address])),
        source, protectedC, ...selected, stack, publicOrigin: args["--origin"], policy,
        maxFeePerGas: ceiling, startInMinutes, now: latest.timestamp });
      atomicJson(UI_D.plan, plan);
      console.log(publicJson({ status: "prepared-local-only", plan, planFingerprint: fingerprint(plan),
        budgetApproval: uiDBudgetApproval(plan), signatures: 0, broadcasts: 0 }));
      return;
    }
    const plan = validateUiDPlan(readJson(UI_D.plan), source, protectedC);
    if (args["--review"]) {
      console.log(publicJson({ status: "review-read-only", plan, planFingerprint: fingerprint(plan),
        budgetApproval: uiDBudgetApproval(plan), journal: loadJournal(UI_D.journal, plan), signingFilesRead: 0, broadcasts: 0 }));
      return;
    }
    check(args["--budget-approval"] === uiDBudgetApproval(plan), "D approval does not match its immutable plan and exact budget.");
    await verifyPolicy(plan.policy);
    const wallets = dWallets(), existing = secureWalletFile();
    const funder = new ethers.Wallet(existing.roles.ownerA.privateKey, provider);
    console.log(publicJson({ status: "deployed-or-known-receipts-recovered", ...(await deployUiD({ plan, source, protectedC,
      stack, provider, artifacts: selected.artifacts, legacyArtifacts: legacy.artifacts, wallets, funder,
      provenance: selected.provenance,
      budgetApproval: args["--budget-approval"] })) }));
  } finally { unlock(); provider.destroy(); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(safeFailure);
