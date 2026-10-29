// Explicit isolated Chiado E operator. Default/import opens no runtime file or network.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ethers } from "ethers";
import { ROOT, PRIVATE_ROOT, CHIADO, DAY, EXTRA, sha256, publicJson, fingerprint,
  atomicJson, parseArgs, check, acquireLock, currentTransactionFees, sendOnce, safeFailure,
  verifyCompiledInputs, verifyPolicy } from "../src/testnet-config.mjs";
import { verifyV9Build } from "./mainnet/prepare-release.mjs";
import { v9RuntimeCode } from "./mainnet/runtime-code.mjs";
import { eventV8Template, factoryEventId } from "../src/contracts-v8.mjs";
import { hash } from "../src/utils.mjs";
import solc from "solc";

export const V9_E = Object.freeze({
  purpose: "Disposable Chiado original-window V9 E rehearsal only", profile: "kleros-event-v9-uups-chiado",
  chainId: 10200, numericVersion: 9, challengePeriod: DAY, matchPeriod: DAY, upgradeDelay: 2 * DAY,
  wallets: path.join(PRIVATE_ROOT, "v9-e-wallets.json"), stackPlan: path.join(PRIVATE_ROOT, "v9-e-stack-plan.json"),
  childPlan: path.join(PRIVATE_ROOT, "v9-e-child-plan.json"), journal: path.join(PRIVATE_ROOT, "v9-e-journal.json"),
  manifest: path.join(ROOT, "registry/chiado-v9-ui-e.json"), lock: path.join(PRIVATE_ROOT, "chiado-operation.lock"),
  policyPath: path.join(ROOT, "public/policies/v9-testnet.md"), depositWei: "1000000000000",
  feeForJurorWei: "10000000000", roles: Object.freeze(["owner", "alice", "bob"]),
});
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const address = (v) => ethers.isAddress(v) && !same(v, ethers.ZeroAddress);
const positive = (v) => typeof v === "string" && /^[1-9][0-9]*$/.test(v);
const GAS = Object.freeze({ "deploy-liquid": "1600000", "configure-fee": "100000", "deploy-resolver": "2500000",
  "deploy-timelock": "3000000", "deploy-event-implementation": "6500000", "deploy-factory-implementation": "3500000",
  "deploy-factory-proxy": "1000000", "fund-alice": "21000", "fund-bob": "21000" });
const PROTECTED_FILES = ["chiado-v8-controlled.json", "chiado-v8-ui-c.json", "chiado-v8-ui-d.json"];
const operatorHash = () => sha256(fs.readFileSync(new URL(import.meta.url)));
export function loadEArtifacts() {
  const build = verifyV9Build(), source = fs.readFileSync(path.join(ROOT, "references/kickback/test/MockKleros.sol"), "utf8");
  check(solc.version().startsWith("0.8.28+"), "E controlled mocks require the exact reviewed0.8.28 compiler.");
  const output = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "MockKleros.sol": { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } })));
  check(!(output.errors ?? []).some((e) => e.severity === "error"), "E mock source compilation failed.");
  const contracts = { ...build.contracts }, mockArtifactsSha256 = {};
  for (const name of ["MockKlerosLiquid", "MockArbitrableProxy"]) {
    const saved = JSON.parse(fs.readFileSync(path.join(ROOT, "references/kickback/build", name + ".json"), "utf8"));
    const compiled = output.contracts["MockKleros.sol"][name];
    check(saved.bytecode === "0x" + compiled.evm.bytecode.object && publicJson(saved.abi) === publicJson(compiled.abi),
      "E mock ABI/creation code differs from its exact source.");
    contracts[name] = { ...saved, deployedBytecode: "0x" + compiled.evm.deployedBytecode.object };
    mockArtifactsSha256[name] = sha256(JSON.stringify(saved));
  }
  return { contracts, provenance: { v9BuildManifestSha256: build.buildManifestSha256, v9StandardInputSha256: build.standardInputSha256 },
    controlledProvenance: { mockSourceSha256: sha256(source), mockArtifactsSha256 } };
}
export function readProtectedEInputs() {
  return PROTECTED_FILES.map((name) => {
    const filename = path.join(ROOT, "registry", name), bytes = fs.readFileSync(filename);
    const manifest = JSON.parse(bytes);
    check(manifest.environment === "testnet" && manifest.chain?.chainId === 10200 && manifest.events?.length,
      "Protect the canonical A/B/C/D manifests before preparing E.");
    return { filename: name, sha256: sha256(bytes), manifest };
  });
}
function protectedPins(inputs) { return inputs.map(({ filename, sha256 }) => ({ filename, sha256 })); }
function exactOrigin(origin, inputs) {
  let u; try { u = new URL(origin); } catch {}
  check(u?.protocol === "https:" && u.origin === origin && !u.username && !u.password &&
    inputs.every(({ manifest }) => manifest.publicOrigin !== origin), "E needs its own exact HTTPS origin.");
  return origin;
}
function artifactPins(artifacts) {
  return Object.fromEntries(Object.entries(artifacts.contracts).map(([name, a]) => [name, {
    abiSha256: sha256(JSON.stringify(a.abi)), creationCodeHash: ethers.keccak256(a.bytecode),
    runtimeTemplateHash: ethers.keccak256(a.deployedBytecode) }]));
}
export function eBudgetApproval(plan) { return sha256(publicJson({ fingerprint: fingerprint(plan), budget: plan.budget })); }
export function eStackRequests(plan, artifacts) {
  const a = artifacts.contracts, owner = plan.addresses.owner, nonce = plan.startingNonce;
  const predicts = { liquid: ethers.getCreateAddress({ from: owner, nonce }), resolver: ethers.getCreateAddress({ from: owner, nonce: nonce + 2 }),
    timelock: ethers.getCreateAddress({ from: owner, nonce: nonce + 3 }), implementation: ethers.getCreateAddress({ from: owner, nonce: nonce + 4 }),
    factoryImplementation: ethers.getCreateAddress({ from: owner, nonce: nonce + 5 }), factory: ethers.getCreateAddress({ from: owner, nonce: nonce + 6 }) };
  const init = new ethers.Interface(a.KlerosEventFactoryV9.abi).encodeFunctionData("initialize", [predicts.implementation, predicts.timelock]);
  const specs = [
    ["deploy-liquid", "MockKlerosLiquid", []], ["configure-fee", null, []],
    ["deploy-resolver", "MockArbitrableProxy", [predicts.liquid]],
    ["deploy-timelock", "KlerosUpgradeTimelockV9", [owner]], ["deploy-event-implementation", "KlerosEventV9", []],
    ["deploy-factory-implementation", "KlerosEventFactoryV9", []], ["deploy-factory-proxy", "ERC1967Proxy", [predicts.factoryImplementation, init]],
    ["fund-alice", null, []], ["fund-bob", null, []],
  ];
  const steps = specs.map(([action, name, args], i) => {
    let to = null, data = "0x", value = "0";
    if (name) data = a[name].bytecode + new ethers.Interface(a[name].abi).encodeDeploy(args).slice(2);
    if (action === "configure-fee") { to = predicts.liquid; data = new ethers.Interface(a.MockKlerosLiquid.abi).encodeFunctionData("setFeeForJuror", [V9_E.feeForJurorWei]); }
    if (action.startsWith("fund-")) { to = plan.addresses[action.slice(5)]; value = plan.budget.actorFundingWei; }
    return { action, artifact: name, from: owner, to, data, value, chainId: 10200, nonce: nonce + i, gasLimit: GAS[action] };
  });
  return { addresses: predicts, steps };
}
export function prepareEStackPlan({ addresses, artifacts, protectedInputs, publicOrigin, maxFeePerGasWei,
  maxTotalCostWei, actorFundingWei, startingNonce = 0, id = randomUUID(), createdAt = new Date().toISOString() }) {
  check(Object.keys(addresses ?? {}).sort().join() === [...V9_E.roles].sort().join() && V9_E.roles.every((r) => address(addresses[r])) &&
    new Set(Object.values(addresses).map((a) => a.toLowerCase())).size === 3, "E requires exactly three fresh role addresses.");
  const old = new Set(protectedInputs.flatMap(({ manifest }) => Object.values(manifest.rehearsalAddresses ?? {})).map((a) => a.toLowerCase()));
  check(Object.values(addresses).every((a) => !old.has(a.toLowerCase())), "E may not reuse protected rehearsal signing roles.");
  check(startingNonce === 0 && /^[a-f0-9-]{36}$/.test(id) && Number.isFinite(Date.parse(createdAt)), "Fresh E owner must begin at nonce0.");
  check([maxFeePerGasWei, maxTotalCostWei, actorFundingWei].every(positive), "Explicit E fee, total spend and actor grants are required.");
  const budget = { maxFeePerGasWei, maxTotalCostWei, actorFundingWei, childGas: "3000000", protocolReserveGas: "6000000" };
  check(BigInt(actorFundingWei) >= 2n * BigInt(V9_E.depositWei) + 1_000_000n * BigInt(maxFeePerGasWei),
    "Each E actor grant must cover principal and its reviewed transaction gas.");
  const plan = { version: 1, purpose: V9_E.purpose, phase: "stack", id, createdAt, chain: CHIADO,
    contractVersion: V9_E.profile, publicOrigin: exactOrigin(publicOrigin, protectedInputs), addresses, startingNonce,
    governance: { kind: "single-owner-timelock", initialOwner: addresses.owner, minimumDelaySeconds: 172800 },
    budget, provenance: artifacts.provenance, controlledProvenance: artifacts.controlledProvenance,
    artifacts: artifactPins(artifacts), protectedInputs: protectedPins(protectedInputs), operatorSha256: operatorHash(),
    notice: "Synthetic Chiado E only. New isolated mocks have publicly callable test controls; no independent jury. Upgrade owner is one transferable wallet behind a48-hour timelock." };
  const requests = eStackRequests(plan, artifacts);
  plan.contracts = requests.addresses; plan.steps = requests.steps;
  validateEBudget(plan, BigInt(maxTotalCostWei));
  return plan;
}
export function validateEStackPlan(plan, artifacts, protectedInputs) {
  const expected = prepareEStackPlan({ addresses: plan.addresses, artifacts, protectedInputs, publicOrigin: plan.publicOrigin,
    ...plan.budget, startingNonce: plan.startingNonce, id: plan.id, createdAt: plan.createdAt });
  check(publicJson(plan) === publicJson(expected), "E stack plan differs from reviewed source, steps, protection or budget.");
  return plan;
}
export function validateEBudget(plan, balance, remaining = plan.steps) {
  const b = plan.budget, gas = remaining.reduce((sum, s) => sum + BigInt(s.gasLimit), 0n) + BigInt(b.childGas) + BigInt(b.protocolReserveGas);
  const value = remaining.reduce((sum, s) => sum + BigInt(s.value), 0n), required = value + gas * BigInt(b.maxFeePerGasWei);
  check(required <= BigInt(b.maxTotalCostWei) && BigInt(balance) >= required, "E balance/explicit total budget cannot cover remaining stack, child and protocol reserve.");
  return { requiredWei: String(required), remainingValueWei: String(value), remainingGas: String(gas) };
}
function eJournal(filename, plan, create = false) {
  if (!fs.existsSync(filename)) {
    check(create, "Prepare E's separate journal explicitly before deployment.");
    writeNew(filename, { version: 1, purpose: V9_E.purpose, chainId: 10200, stackPlanFingerprint: fingerprint(plan),
      childPlanFingerprint: null, transactions: {} });
  }
  const journal = privateJson(filename);
  check(journal.version === 1 && journal.purpose === V9_E.purpose && journal.chainId === 10200 &&
    journal.stackPlanFingerprint === fingerprint(plan), "E journal belongs to another immutable stack plan.");
  return journal;
}
async function assertEChain(provider) { check(BigInt(await provider.send("eth_chainId", [])) === 10200n, "E operations accept only Chiado10200."); }
export async function protectedESnapshot(provider, protectedInputs) {
  const { chainState } = await import("../src/chain.mjs");
  const snapshots = [];
  for (const input of protectedInputs) for (const record of input.manifest.events) {
    const state = await chainState({ provider }, record, { includeBlockHash: true });
    const { now, blockNumber, blockHash, fingerprint: stateFingerprint, ...financial } = state;
    snapshots.push({ eventId: record.deployment.eventId, contract: record.deployment.contract,
      anchor: { number: blockNumber, hash: blockHash, timestamp: now }, financial });
  }
  return snapshots;
}
export function assertEProtectedUnchanged(before, after) {
  check(publicJson(before.map(({ eventId, contract, financial }) => ({ eventId, contract, financial }))) ===
    publicJson(after.map(({ eventId, contract, financial }) => ({ eventId, contract, financial }))), "Protected A/B/C/D financial state changed; stop E.");
}
function expectedCall(request) { return { from: request.from.toLowerCase(), to: request.to?.toLowerCase() ?? null,
  data: request.data, value: String(request.value) }; }
export async function canonicalEReceipt(provider, entry, request) {
  await assertEChain(provider);
  check(entry && ethers.isHexString(entry.hash, 32) && publicJson(entry.expected) === publicJson(expectedCall(request)), "E known hash conflicts with the exact planned request.");
  const [tx, receipt] = await Promise.all([provider.getTransaction(entry.hash), provider.getTransactionReceipt(entry.hash)]);
  check(tx && receipt?.status === 1 && (await receipt.confirmations()) >= 2 && tx.chainId === 10200n &&
    tx.nonce === request.nonce && same(tx.from, request.from) && same(tx.to, request.to) && tx.data === request.data &&
    tx.value === BigInt(request.value) && (await provider.getBlock(receipt.blockNumber))?.hash === receipt.blockHash,
  "E known transaction is pending, reverted, conflicting or noncanonical; receipt checks only, never replay.");
  return receipt;
}
export function boundedESigner(signer, { provider, plan, request, remaining }) {
  return { getAddress: () => signer.getAddress(), populateTransaction: (tx) => signer.populateTransaction(tx),
    signTransaction: async (tx) => {
      await assertEChain(provider);
      check(same(await signer.getAddress(), request.from) && same(tx.from ?? request.from, request.from) &&
        same(tx.to, request.to) && tx.data === request.data && BigInt(tx.value ?? 0) === BigInt(request.value) &&
        BigInt(tx.chainId) === 10200n && tx.nonce === request.nonce && BigInt(tx.gasLimit) === BigInt(request.gasLimit) &&
        BigInt(tx.maxFeePerGas ?? tx.gasPrice ?? 0) > 0n && BigInt(tx.maxFeePerGas ?? tx.gasPrice) <= BigInt(plan.budget.maxFeePerGasWei),
      "E populated request differs from exact chain/nonce/target/value/data/gas or approved fee; key unused.");
      check(await provider.getTransactionCount(request.from, "pending") === request.nonce &&
        await provider.getTransactionCount(request.from, "latest") === request.nonce,
      "E owner nonce changed before signing; no replacement or hidden pending transaction allowed.");
      validateEBudget(plan, await provider.getBalance(request.from), remaining);
      return signer.signTransaction(tx);
    } };
}
export async function verifyEStack(provider, plan, artifacts, journal, { complete = true } = {}) {
  await assertEChain(provider);
  const receipts = {};
  for (const request of plan.steps) {
    if (!journal.transactions[request.action]) { check(!complete, "E stack is not fully confirmed."); continue; }
    receipts[request.action] = await canonicalEReceipt(provider, journal.transactions[request.action], request);
  }
  if (!complete) return { receipts };
  const a = artifacts.contracts, c = plan.contracts;
  const timelockHash = ethers.keccak256(a.KlerosUpgradeTimelockV9.deployedBytecode);
  const expected = { liquid: a.MockKlerosLiquid.deployedBytecode, resolver: a.MockArbitrableProxy.deployedBytecode,
    timelock: a.KlerosUpgradeTimelockV9.deployedBytecode,
    implementation: v9RuntimeCode(a.KlerosEventV9, c.implementation, timelockHash),
    factoryImplementation: v9RuntimeCode(a.KlerosEventFactoryV9, c.factoryImplementation, timelockHash), factory: a.ERC1967Proxy.deployedBytecode };
  for (const [name, code] of Object.entries(expected)) check(same(await provider.getCode(c[name]), code), "E stack runtime differs from reviewed compiled source.");
  const timelock = new ethers.Contract(c.timelock, a.KlerosUpgradeTimelockV9.abi, provider);
  const factory = new ethers.Contract(c.factory, a.KlerosEventFactoryV9.abi, provider);
  const liquid = new ethers.Contract(c.liquid, a.MockKlerosLiquid.abi, provider), resolver = new ethers.Contract(c.resolver, a.MockArbitrableProxy.abi, provider);
  const slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const [delay, floor, authority, implementation, selected, arbitrator, fee, cost, currentOwner, pendingOwner] = await Promise.all([
    timelock.getMinDelay(), timelock.MIN_UPGRADE_DELAY(), factory.upgradeAuthority(),
    provider.getStorage(c.factory, slot), factory.eventImplementation(), resolver.arbitrator(), liquid.feeForJuror(),
    liquid.arbitrationCost(EXTRA), timelock.owner(), timelock.pendingOwner(),
  ]);
  check(delay >= 172800n && floor === 172800n && same(authority, c.timelock) &&
    same(implementation, ethers.zeroPadValue(c.factoryImplementation, 32)) && same(selected, c.implementation) &&
    same(arbitrator, c.liquid) && fee === BigInt(V9_E.feeForJurorWei) && cost === 3n * BigInt(V9_E.feeForJurorWei) &&
    address(currentOwner) && ethers.isAddress(pendingOwner), "E stack parameters, fee or upgrade authority differ.");
  return { receipts, codeHashes: Object.fromEntries(Object.entries(expected).map(([name, code]) => [name, ethers.keccak256(code)])),
    governance: { currentOwner, pendingOwner, delaySeconds: Number(delay) }, arbitrationCostWei: String(cost) };
}
function readEKeys(plan) {
  const wallets = privateJson(V9_E.wallets);
  check(publicJson(walletAddresses(wallets)) === publicJson(plan.addresses), "E signing identities differ from immutable plan.");
  return wallets;
}
/** Explicit execution dependency; tests can supply an ephemeral signer without opening real files. */
export async function deployEStack({ plan, artifacts, protectedInputs, provider, journal, journalPath = V9_E.journal,
  newAction, signerFactory = () => new ethers.Wallet(readEKeys(plan).roles.owner.privateKey, provider),
  snapshot = () => protectedESnapshot(provider, protectedInputs), send = sendOnce }) {
  check(false, "E financial execution is ON HOLD; no key or network access is permitted.");
  validateEStackPlan(plan, artifacts, protectedInputs);
  check(journal.stackPlanFingerprint === fingerprint(plan) && journal.chainId === 10200, "E journal plan binding differs.");
  const known = plan.steps.filter((step) => journal.transactions[step.action]);
  await verifyEStack(provider, plan, artifacts, journal, { complete: false });
  const missing = plan.steps.filter((step) => !journal.transactions[step.action]);
  check(!newAction || newAction === missing[0]?.action, "Explicit E continuation must name the exact next unseen action.");
  check(!missing.length || !Object.keys(journal.transactions).some((action) => action.startsWith("create-e-")),
    "An E child already exists; no stack signing is allowed.");
  if (known.length && !newAction) return { status: "receipt-only", signingFilesRead: 0, broadcasts: 0,
    confirmed: known.map((s) => s.action), nextAction: missing[0]?.action ?? null };
  const actions = newAction ? missing.slice(0, 1) : missing;
  if (!actions.length) return { status: "stack-already-confirmed", signingFilesRead: 0, broadcasts: 0 };
  const before = await snapshot();
  validateEBudget(plan, await provider.getBalance(plan.addresses.owner), missing);
  check(await provider.getCode(plan.addresses.owner) === "0x" &&
    await provider.getTransactionCount(plan.addresses.owner, "latest") === missing[0].nonce &&
    await provider.getTransactionCount(plan.addresses.owner, "pending") === missing[0].nonce,
  "E owner must remain a fresh EOA with the exact next nonce and no conflicting pending transaction.");
  const signer = signerFactory(); let broadcasts = 0;
  for (const request of actions) {
    const immediateBefore = await snapshot();
    const gas = await provider.estimateGas({ ...request, gasLimit: undefined });
    check(gas <= BigInt(request.gasLimit), "E current gas estimate exceeds its reviewed step ceiling.");
    const guarded = boundedESigner(signer, { provider, plan, request,
      remaining: plan.steps.filter((s) => !journal.transactions[s.action]) });
    await send({ provider, signer: guarded, journal, journalPath, action: request.action, request }); broadcasts++;
    assertEProtectedUnchanged(immediateBefore, await snapshot());
    console.log(publicJson({ status: "e-step-confirmed", action: request.action, hash: journal.transactions[request.action].hash }));
  }
  const after = await snapshot(); assertEProtectedUnchanged(before, after);
  const complete = plan.steps.every((step) => journal.transactions[step.action]);
  const stack = await verifyEStack(provider, plan, artifacts, journal, { complete });
  return { status: complete ? "stack-confirmed" : "partial-stack-confirmed", signingFilesRead: 1, broadcasts,
    planFingerprint: fingerprint(plan), protectedBefore: before, protectedAfter: after,
    stack: { contracts: plan.contracts, ...stack } };
}
export function prepareEChildPlan({ plan, artifacts, journal, publicOrigin, policy, now, ownerNonce, startInMinutes = 120,
  hostingVerified, sourceCommit }) {
  check(plan.publicOrigin === publicOrigin && hostingVerified === true && /^[a-f0-9]{40}$/.test(sourceCommit ?? ""),
    "Prepare E child only after the exact hosted source/origin is reviewed.");
  check(plan.steps.every((s) => journal.transactions[s.action]?.state === "confirmed") &&
    ownerNonce === plan.startingNonce + plan.steps.length && Number.isSafeInteger(now) &&
    Number.isSafeInteger(startInMinutes) && startInMinutes >= 60 && startInMinutes <= 240,
  "E child needs its confirmed stack, exact new nonce and fresh60–240minute lead.");
  check(policy.uri === publicOrigin + "/policies/v9-testnet.md" && digest(policy.sha256), "E child needs its exact published policy.");
  const id = `chiado-v9-${plan.id}-e`, eventStart = now + startInMinutes * 60;
  const template = eventV8Template({ eventName: "Chiado V9 E controlled rehearsal", depositAmount: V9_E.depositWei,
    policyURI: policy.uri, nativeCurrencySymbol: "XDAI" });
  const config = { depositAmount: V9_E.depositWei, eventName: "Chiado V9 E controlled rehearsal", eventStart,
    claimDeadline: eventStart + 7 * DAY, arbitration: { disputeResolver: plan.contracts.resolver, extraData: EXTRA,
      metaEvidenceTemplate: template.pieces, metaEvidenceSlots: template.slots, policyURI: policy.uri } };
  const iface = new ethers.Interface(artifacts.contracts.KlerosEventFactoryV9.abi), eventKey = ethers.id(id);
  return { version: 1, purpose: V9_E.purpose, phase: "child", stackPlanFingerprint: fingerprint(plan), createdAt: new Date(now * 1000).toISOString(),
    publicOrigin, sourceCommit, policy, event: { id, eventKey, title: config.eventName, eventStart, eventEnd: eventStart + 12 * 3600,
      claimDeadline: config.claimDeadline }, config, template,
    request: { action: `create-e-${plan.id}`, from: plan.addresses.owner, to: plan.contracts.factory,
      data: iface.encodeFunctionData("createEvent", [eventKey, config]), value: "0", chainId: 10200, nonce: ownerNonce, gasLimit: plan.budget.childGas } };
}
export function validateEChildPlan(child, plan, artifacts, journal) {
  const expected = prepareEChildPlan({ plan, artifacts, journal, publicOrigin: child.publicOrigin, policy: child.policy,
    now: Math.floor(Date.parse(child.createdAt) / 1000), ownerNonce: child.request.nonce,
    startInMinutes: (child.event.eventStart - Date.parse(child.createdAt) / 1000) / 60, hostingVerified: true, sourceCommit: child.sourceCommit });
  check(publicJson(child) === publicJson(expected), "E child plan changed after its separate review.");
}
export async function deployEChild({ plan, child, artifacts, protectedInputs, provider, journal, journalPath = V9_E.journal,
  manifestPath = V9_E.manifest, signerFactory = () => new ethers.Wallet(readEKeys(plan).roles.owner.privateKey, provider),
  snapshot = () => protectedESnapshot(provider, protectedInputs), send = sendOnce, verifyManifest }) {
  check(false, "E financial execution is ON HOLD; no key or network access is permitted.");
  validateEStackPlan(plan, artifacts, protectedInputs); validateEChildPlan(child, plan, artifacts, journal);
  check(journal.childPlanFingerprint === fingerprint(child), "E child journal binding differs.");
  const action = child.request.action, existing = journal.transactions[action];
  const stack = await verifyEStack(provider, plan, artifacts, journal);
  let receipt, before = await snapshot(), broadcasts = 0;
  if (existing) receipt = await canonicalEReceipt(provider, existing, child.request);
  else {
    await verifyPolicy(child.policy);
    check((await provider.getBlock("latest")).timestamp < child.event.eventStart - 1800,
      "E child needs at least30minutes remaining for reviewed UI deposits; immutable schedule is not changed.");
    const factory = new ethers.Contract(plan.contracts.factory, artifacts.contracts.KlerosEventFactoryV9.abi, provider);
    check(same(await factory.eventFor(plan.addresses.owner, child.event.eventKey), ethers.ZeroAddress), "E event key is already consumed.");
    check(await provider.estimateGas(child.request) <= BigInt(child.request.gasLimit), "E child gas exceeds its reviewed ceiling.");
    const guarded = boundedESigner(signerFactory(), { provider, plan, request: child.request, remaining: [] });
    receipt = await send({ provider, signer: guarded, journal, journalPath, action, request: child.request }); broadcasts = 1;
  }
  const factory = new ethers.Contract(plan.contracts.factory, artifacts.contracts.KlerosEventFactoryV9.abi, provider);
  const created = receipt.logs.filter((l) => same(l.address, plan.contracts.factory))
    .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).filter((l) => l?.name === "EventCreated");
  check(created.length === 1 && same(created[0].args.creator, plan.addresses.owner) &&
    same(created[0].args.eventKey, child.event.eventKey) && created[0].args.version === 9n, "E child lacks its exact creation event.");
  const contract = created[0].args.eventContract, c = plan.contracts, records = stack.receipts;
  const deployment = { eventId: child.event.id, chainId: 10200, contract, deploymentBlock: receipt.blockNumber, deploymentTxHash: receipt.hash,
    contractVersion: V9_E.profile, abiVersion: V9_E.profile, depositWei: V9_E.depositWei, eventName: child.event.title,
    eventStart: child.event.eventStart, claimDeadline: child.event.claimDeadline, depositOpensAt: (await provider.getBlock(receipt.blockNumber)).timestamp,
    depositDeadline: child.event.eventStart, owner: plan.addresses.owner, creator: plan.addresses.owner,
    resolver: c.resolver, arbitrator: c.liquid, arbitratorExtraData: EXTRA, policyURI: child.policy.uri,
    templateHash: hash([child.template.pieces, child.template.slots]), codeHash: stack.codeHashes.factory,
    factory: c.factory, factoryCodeHash: stack.codeHashes.factory, implementation: c.implementation,
    factoryImplementation: c.factoryImplementation, initialImplementation: c.implementation, initialFactoryImplementation: c.factoryImplementation,
    implementationCodeHash: stack.codeHashes.implementation, factoryImplementationCodeHash: stack.codeHashes.factoryImplementation,
    implementationRevision: 1, factoryImplementationRevision: 1, upgradeAuthority: c.timelock,
    upgradeAuthorityCodeHash: stack.codeHashes.timelock, initialUpgradeOwner: plan.addresses.owner,
    factoryDeploymentTxHash: records["deploy-factory-proxy"].hash, factoryDeploymentBlock: records["deploy-factory-proxy"].blockNumber,
    timelockDeploymentTxHash: records["deploy-timelock"].hash, timelockDeploymentBlock: records["deploy-timelock"].blockNumber,
    eventKey: child.event.eventKey, factoryEventId: created[0].args.eventId, configurationHash: created[0].args.configurationHash,
    sourceCommit: child.sourceCommit };
  const definition = { id: child.event.id, title: child.event.title, slug: `chiado-v9-e-${plan.id.slice(0, 8)}`,
    startsAt: new Date(child.event.eventStart * 1000).toISOString(), endsAt: new Date(child.event.eventEnd * 1000).toISOString(),
    timezone: "UTC", location: "Synthetic E testnet venue", description: "Original24-hour V9 windows; publicly controlled test Court and a transferable upgrade owner behind48hours.",
    visibility: "public", editorialStatus: "published", registrationStatus: "open", organizers: [plan.addresses.owner], staff: [] };
  const manifest = { version: 1, environment: "testnet", mode: "hosted-v9-testnet", publicOrigin: plan.publicOrigin,
    chain: plan.chain, contractVersion: V9_E.profile, provenance: plan.provenance, controlledProvenance: plan.controlledProvenance,
    governance: plan.governance, arbitration: { mode: "controlled", resolver: c.resolver, arbitrator: c.liquid, extraData: EXTRA,
      resolverCodeHash: stack.codeHashes.resolver, arbitratorCodeHash: stack.codeHashes.liquid,
      resolverDeploymentTxHash: records["deploy-resolver"].hash, resolverDeploymentBlock: records["deploy-resolver"].blockNumber,
      arbitratorDeploymentTxHash: records["deploy-liquid"].hash, arbitratorDeploymentBlock: records["deploy-liquid"].blockNumber },
    planFingerprint: fingerprint(plan), childPlanFingerprint: fingerprint(child), rehearsalAddresses: plan.addresses,
    policy: child.policy, events: [{ definition, deployment, pieces: child.template.pieces, slots: child.template.slots,
      policy: fs.readFileSync(V9_E.policyPath, "utf8") }] };
  if (verifyManifest) await verifyManifest(manifest);
  else {
    const { v9TestnetChain } = await import("../src/v9-testnet-runtime.mjs");
    const verified = await v9TestnetChain(manifest, plan.chain.rpcUrl); await verified.close();
  }
  const after = await snapshot(); assertEProtectedUnchanged(before, after);
  if (fs.existsSync(manifestPath)) check(publicJson(JSON.parse(fs.readFileSync(manifestPath, "utf8"))) === publicJson(manifest),
    "Existing E public manifest differs; preserve it and investigate.");
  else atomicJson(manifestPath, manifest, 0o644);
  return { status: "child-confirmed", broadcasts, signingFilesRead: broadcasts ? 1 : 0,
    hash: receipt.hash, contract, manifest, protectedBefore: before, protectedAfter: after };
}
function privateJson(filename) {
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 &&
    (!process.getuid || stat.uid === process.getuid()), "E runtime files must be owner-only regular files.");
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}
function writeNew(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename, publicJson(value) + "\n", { flag: "wx", mode: 0o600 });
}
function walletAddresses(wallets) {
  check(wallets?.version === 1 && wallets.purpose === V9_E.purpose && wallets.chainId === 10200 &&
    Object.keys(wallets.roles ?? {}).sort().join() === [...V9_E.roles].sort().join(), "Wrong isolated E wallet file.");
  const addresses = Object.fromEntries(V9_E.roles.map((role) => {
    const entry = wallets.roles[role];
    check(entry && ethers.isAddress(entry.address) && new ethers.Wallet(entry.privateKey).address === entry.address,
      "Invalid isolated E signing identity.");
    return [role, entry.address];
  }));
  check(new Set(Object.values(addresses).map((a) => a.toLowerCase())).size === 3, "E roles must be distinct.");
  return addresses;
}
/** Only explicit preparation writes NEW E keys; re-entry preserves every existing identity. */
export function prepareEWallets({ filename = V9_E.wallets } = {}) {
  let wallets;
  if (fs.existsSync(filename)) wallets = privateJson(filename);
  else {
    wallets = { version: 1, purpose: V9_E.purpose, chainId: 10200, createdAt: new Date().toISOString(),
      roles: Object.fromEntries(V9_E.roles.map((role) => {
        const wallet = ethers.Wallet.createRandom();
        return [role, { address: wallet.address, privateKey: wallet.privateKey }];
      })) };
    writeNew(filename, wallets);
  }
  return { status: "wallets-prepared-no-network", chainId: 10200, addresses: walletAddresses(wallets),
    networkRequests: 0, signatures: 0, broadcasts: 0 };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { "--prepare-wallets": "boolean", "--prepare-stack": "boolean", "--review-stack": "boolean",
    "--deploy-stack": "boolean", "--prepare-child": "boolean", "--review-child": "boolean", "--deploy-child": "boolean",
    "--origin": "value", "--max-fee-per-gas": "value", "--max-total-cost-wei": "value", "--funding-wei": "value",
    "--start-in-minutes": "value", "--budget-approval": "value", "--new-action": "value",
    "--hosting-ready": "boolean", "--source-commit": "value", "--help": "boolean" });
  const modes = ["--prepare-wallets", "--prepare-stack", "--review-stack", "--deploy-stack", "--prepare-child", "--review-child", "--deploy-child"];
  check(modes.filter((name) => args[name]).length <= 1, "Choose one explicit E preparation/review/deployment stage.");
  if (args["--help"] || !modes.some((name) => args[name])) {
    console.log(publicJson({ status: "review-only", chainId: 10200, contractVersion: V9_E.profile,
      challengePeriod: DAY, matchPeriod: DAY, upgradeDelay: 2 * DAY,
      runtimeFilesRead: 0, signingFilesRead: 0, networkRequests: 0, signatures: 0, broadcasts: 0,
      instruction: "E is ON HOLD. Only explicit --prepare-wallets is available; it preserves existing E identities. No deployment is enabled." }));
    return;
  }
  if (args["--prepare-wallets"]) {
    check(Object.keys(args).length === 1, "Wallet preparation takes no deployment, fee or network options.");
    console.log(publicJson(prepareEWallets())); return;
  }
  check(false, "E deployment is ON HOLD. No stack/child preparation, review, key loading or execution is enabled.");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch((error) => { console.error(publicJson({ status: "stopped", error: safeFailure(error) })); process.exitCode = 1; });
