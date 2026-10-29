// Produces public, UNSIGNED deployment requests only. No signer or send RPC exists here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import solc from "solc-hardened";
import { ethers } from "ethers";
import { MAINNET_KLEROS, readOnlyMainnetRpc, verifyKleros } from "./verify-kleros.mjs";
import { createVerificationRuntime } from "./verification-runtime.mjs";
import { v9RuntimeCode } from "./runtime-code.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const V9_PROFILE = "kleros-event-v9-uups";
export const MIN_UPGRADE_DELAY = 172800;
export const MAX_TRANSACTION_GAS = 16777216n;
const names = ["KlerosUpgradeTimelockV9", "KlerosEventV9", "KlerosEventFactoryV9", "ERC1967Proxy"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
class PlanningError extends Error { constructor(message) { super(message); this.name = "PlanningError"; } }
const check = (condition, message) => { if (!condition) throw new PlanningError(message); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
function record(value, keys, label) {
  check(value && typeof value === "object" && !Array.isArray(value), `Invalid ${label}`);
  check(Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)), `Unexpected or missing ${label} field`);
}
function publicAddress(value, label) {
  check(typeof value === "string" && ethers.isAddress(value) && BigInt(value) !== 0n, `Invalid ${label}`);
  return ethers.getAddress(value);
}
function positiveWei(value, label) {
  check(typeof value === "string" && /^[1-9][0-9]{0,77}$/.test(value), `Invalid ${label}`);
  const n = BigInt(value);
  check(n < 2n ** 256n, `Invalid ${label}`);
  return n;
}

export function assertV9Artifact(name, compiled, artifact) {
  const bytecode = `0x${compiled.evm.bytecode.object}`, runtime = `0x${compiled.evm.deployedBytecode.object}`;
  check(JSON.stringify(artifact.abi) === JSON.stringify(compiled.abi) && artifact.bytecode === bytecode && artifact.deployedBytecode === runtime, `Compiled artifact differs: ${name}`);
  check(JSON.stringify(artifact.storageLayout) === JSON.stringify(compiled.storageLayout), `Storage artifact differs: ${name}`);
  check(JSON.stringify(artifact.immutableReferences) === JSON.stringify(compiled.evm.deployedBytecode.immutableReferences ?? {}), `Immutable references differ: ${name}`);
  check(JSON.stringify(artifact.linkReferences) === JSON.stringify(compiled.evm.bytecode.linkReferences ?? {}), `Library references differ: ${name}`);
  check((bytecode.length - 2) / 2 <= 49152 && (runtime.length - 2) / 2 <= 24576, `EVM code limit exceeded: ${name}`);
  check(Object.values(compiled.evm.bytecode.linkReferences ?? {}).length === 0, "Unresolved library links are not supported");
  check(compiled.storageLayout, `Missing compiler storage layout: ${name}`);
  return { abi: compiled.abi, bytecode, deployedBytecode: runtime, storageLayout: compiled.storageLayout,
    immutableReferences: compiled.evm.deployedBytecode.immutableReferences ?? {} };
}

/** All inputs are public. Explicit budgets are required; no testnet budget is inherited. */
export function validateReleaseConfig(raw) {
  record(raw, ["schemaVersion", "chainId", "contractVersion", "deployer", "deployerNonce", "governance", "fees", "gasLimits", "maxTotalGasCostWei"], "release configuration");
  check(raw.schemaVersion === 1 && raw.chainId === 1 && raw.contractVersion === V9_PROFILE, "Only Ethereum mainnet V9 release plans are supported");
  check(Number.isSafeInteger(raw.deployerNonce) && raw.deployerNonce >= 0 && raw.deployerNonce <= Number.MAX_SAFE_INTEGER - 4, "Invalid deployment nonce");
  const deployer = publicAddress(raw.deployer, "deployer");
  record(raw.governance, ["kind", "initialOwner", "minimumDelaySeconds"], "governance");
  check(raw.governance.kind === "single-owner-timelock" && raw.governance.minimumDelaySeconds === MIN_UPGRADE_DELAY, "Single-owner governance with the fixed 48-hour floor is required");
  const initialOwner = publicAddress(raw.governance.initialOwner, "initial upgrade owner");
  check(same(initialOwner, deployer), "The one deployment wallet must be the initial upgrade owner");
  record(raw.fees, ["maxFeePerGasWei", "maxPriorityFeePerGasWei"], "fee budget");
  const maxFee = positiveWei(raw.fees.maxFeePerGasWei, "maximum fee"), tip = positiveWei(raw.fees.maxPriorityFeePerGasWei, "priority fee");
  check(tip <= maxFee, "Priority fee exceeds maximum fee");
  record(raw.gasLimits, names, "gas limits");
  let totalGas = 0n;
  for (const name of names) {
    const gas = positiveWei(raw.gasLimits[name], `${name} gas limit`);
    check(gas >= 53000n && gas <= MAX_TRANSACTION_GAS, "Deployment gas limit exceeds Ethereum transaction limits or is too low");
    totalGas += gas;
  }
  const maxCost = positiveWei(raw.maxTotalGasCostWei, "total gas cost budget");
  check(totalGas * maxFee <= maxCost, "Deployment gas limits exceed the explicit ETH budget");
  return structuredClone({ ...raw, deployer, governance: { ...raw.governance, initialOwner } });
}

/** Recompile saved inputs and compare every emitted artifact to the current pinned sources. */
export function verifyV9Build({ artifactDirectory = path.join(ROOT, "build/contracts-v9") } = {}) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const installed = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@openzeppelin/contracts/package.json"), "utf8"));
  check(packageJson.dependencies?.["@openzeppelin/contracts"] === "5.7.0" && installed.version === "5.7.0", "OpenZeppelin must be pinned to exactly 5.7.0");
  check(solc.version().startsWith("0.8.38+"), "Unexpected production compiler");
  const inputBytes = fs.readFileSync(path.join(artifactDirectory, "standard-input.json"));
  const input = JSON.parse(inputBytes);
  record(input, ["language", "sources", "settings"], "compiler input");
  check(input.language === "Solidity" && input.sources, "Invalid standalone V9 compiler input");
  record(input.settings, ["evmVersion", "optimizer", "viaIR", "outputSelection"], "compiler settings");
  record(input.settings.optimizer, ["enabled", "runs"], "optimizer settings");
  check(input.settings.evmVersion === "paris" && input.settings.optimizer.enabled === true && input.settings.optimizer.runs === 200 && input.settings.viaIR === true, "Unreviewed V9 compiler settings");
  const manifest = JSON.parse(fs.readFileSync(path.join(artifactDirectory, "manifest.json"), "utf8"));
  check(manifest.profile === V9_PROFILE && manifest.version === 9 && manifest.compiler === solc.version() && manifest.openzeppelin === "5.7.0" && manifest.minimumUpgradeDelay === MIN_UPGRADE_DELAY, "V9 manifest identity differs");
  check(JSON.stringify(manifest.settings) === JSON.stringify(input.settings), "V9 manifest settings differ");
  const sourceHashes = {};
  for (const [name, source] of Object.entries(input.sources)) {
    check((/^contracts\/v9\/[A-Za-z0-9_]+\.sol$/.test(name) || /^@openzeppelin\/contracts\/[A-Za-z0-9_/-]+\.sol$/.test(name)) && !name.split("/").includes(".."), "Unexpected compiler source path");
    const filename = path.join(ROOT, name.startsWith("@openzeppelin/") ? `node_modules/${name}` : name);
    const bytes = fs.readFileSync(filename);
    check(source && Object.keys(source).length === 1 && source.content === bytes.toString("utf8"), `Saved compiler source differs: ${name}`);
    sourceHashes[name] = sha(bytes);
  }
  for (const name of names.filter(name => name !== "ERC1967Proxy"))
    check(input.sources[`contracts/v9/${name}.sol`], `Missing V9 source: ${name}`);
  check(JSON.stringify(manifest.sources) === JSON.stringify(sourceHashes), "V9 manifest source hashes differ");
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  check(!(output.errors ?? []).some(error => error.severity === "error"), "Independent V9 compilation failed");
  const immutableNames = {};
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "VariableDeclaration" && node.mutability === "immutable")
      immutableNames[node.id] = { name: node.name, type: node.typeDescriptions?.typeString };
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  Object.values(output.sources).forEach(source => visit(source.ast));
  const timelockCodeHash = ethers.keccak256(`0x${output.contracts["contracts/v9/KlerosUpgradeTimelockV9.sol"].KlerosUpgradeTimelockV9.evm.deployedBytecode.object}`);
  const contracts = {};
  for (const name of names) {
    const matches = Object.values(output.contracts ?? {}).flatMap(group => Object.entries(group)).filter(([key]) => key === name);
    check(matches.length === 1, `Ambiguous compiled contract: ${name}`);
    const compiled = matches[0][1], artifact = JSON.parse(fs.readFileSync(path.join(artifactDirectory, `${name}.json`), "utf8"));
    const verified = assertV9Artifact(name, compiled, artifact);
    const immutableValues = Object.fromEntries(Object.keys(verified.immutableReferences).map(id => {
      const variable = immutableNames[id];
      check(variable?.name === "__self" && variable.type === "address" || variable?.name === "_timelockCodeHash" && variable.type === "bytes32", "Unreviewed production immutable");
      return [id, { ...variable, value: variable.name === "__self" ? "implementation-address" : timelockCodeHash }];
    }));
    check(JSON.stringify(artifact.immutableValues) === JSON.stringify(immutableValues), `Immutable value metadata differs: ${name}`);
    const savedLayout = JSON.parse(fs.readFileSync(path.join(artifactDirectory, `${name}.storage-layout.json`), "utf8"));
    check(JSON.stringify(savedLayout) === JSON.stringify(compiled.storageLayout), `Saved storage layout differs: ${name}`);
    const entry = manifest.contracts?.[name];
    check(entry && entry.creationCodeHash === ethers.keccak256(verified.bytecode) && entry.unpatchedRuntimeCodeHash === ethers.keccak256(verified.deployedBytecode)
      && entry.abiSha256 === sha(JSON.stringify(compiled.abi))
      && entry.creationBytes === (verified.bytecode.length - 2) / 2 && entry.runtimeBytes === (verified.deployedBytecode.length - 2) / 2
      && entry.storageLayoutSha256 === sha(JSON.stringify(compiled.storageLayout))
      && JSON.stringify(entry.immutableReferences) === JSON.stringify(verified.immutableReferences)
      && JSON.stringify(entry.immutableValues) === JSON.stringify(immutableValues), `V9 manifest contract differs: ${name}`);
    if (!Object.keys(immutableValues).length) check(entry.deployedCodeHash === ethers.keccak256(verified.deployedBytecode), "V9 deployed hash differs");
    contracts[name] = { ...verified, immutableValues };
  }
  return { compiler: solc.version(), settings: input.settings, standardInputSha256: sha(JSON.stringify(input)),
    standardInputFileSha256: sha(inputBytes), buildManifestSha256: sha(JSON.stringify(manifest)), sourceHashes, contracts };
}

/** Build unsigned CREATE requests. This does not estimate gas, deploy or authorize deployment. */
export function prepareRelease(raw, build) {
  const config = validateReleaseConfig(raw);
  check(build?.contracts && names.every(name => build.contracts[name]?.bytecode && build.contracts[name]?.abi), "Verified V9 build required");
  const addresses = Object.fromEntries(names.map((name, index) => [name, ethers.getCreateAddress({ from: config.deployer, nonce: config.deployerNonce + index })]));
  const factoryInit = new ethers.Interface(build.contracts.KlerosEventFactoryV9.abi).encodeFunctionData("initialize", [addresses.KlerosEventV9, addresses.KlerosUpgradeTimelockV9]);
  const argumentsByName = {
    KlerosUpgradeTimelockV9: [config.governance.initialOwner], KlerosEventV9: [], KlerosEventFactoryV9: [],
    ERC1967Proxy: [addresses.KlerosEventFactoryV9, factoryInit],
  };
  const transactions = names.map((name, index) => {
    const artifact = build.contracts[name], iface = new ethers.Interface(artifact.abi);
    const data = artifact.bytecode + iface.encodeDeploy(argumentsByName[name]).slice(2);
    check((data.length - 2) / 2 <= 49152, "Constructor inputs exceed EIP-3860");
    const bytes = ethers.getBytes(data);
    const intrinsic = 53000n + BigInt(bytes.reduce((sum, byte) => sum + (byte === 0 ? 4 : 16), 0)) + 2n * BigInt(Math.ceil(bytes.length / 32));
    check(BigInt(config.gasLimits[name]) >= intrinsic, `Gas limit is below deployment intrinsic gas: ${name}`);
    const timelockHash = ethers.keccak256(build.contracts.KlerosUpgradeTimelockV9.deployedBytecode);
    const expectedRuntimeCodeHash = ethers.keccak256(v9RuntimeCode(artifact, addresses[name], timelockHash));
    return { step: index + 1, contract: name, predictedAddress: addresses[name], expectedRuntimeCodeHash, from: config.deployer, to: null,
      chainId: 1, type: 2, nonce: config.deployerNonce + index, value: "0", data, gasLimit: config.gasLimits[name], ...config.fees };
  });
  return { schemaVersion: 1, status: "unsigned-review-only", contractVersion: V9_PROFILE, chainId: 1,
    configuration: config, governance: config.governance, deployer: config.deployer, startingNonce: config.deployerNonce, addresses,
    factoryProxy: addresses.ERC1967Proxy, minimumDelaySeconds: MIN_UPGRADE_DELAY, transactions,
    maxTotalGasCostWei: config.maxTotalGasCostWei, gasEstimatesVerified: false, deploymentAuthorized: false,
    provenance: { v9BuildManifestSha256: build.buildManifestSha256, v9StandardInputSha256: build.standardInputSha256 },
    compilation: { compiler: build.compiler, standardInputSha256: build.standardInputSha256,
      ...(build.standardInputFileSha256 ? { standardInputFileSha256: build.standardInputFileSha256 } : {}), sourceHashes: build.sourceHashes },
    ownershipTransfer: { target: addresses.KlerosUpgradeTimelockV9, steps: ["Current owner calls transferOwnership(newOwner)", "Clear all queued operations; the proposed owner may cancel them", "Proposed owner calls acceptOwnership()"], zeroQueuedAndExecutingOperationsRequired: true },
    limitations: ["Gas limits require a complete local-fork deployment rehearsal", "One wallet controls upgrades until a two-step ownership transfer completes", "Policy publication and production hosting are separate reviewed actions"],
    signatures: 0, broadcasts: 0 };
}

/** Fresh, canonical public reads only; the produced requests remain unsigned. */
export async function preflightRelease(plan, { transport, rpcUrl = "https://ethereum-rpc.publicnode.com", build = verifyV9Build() } = {}) {
  plan = structuredClone(plan);
  check(plan?.status === "unsigned-review-only" && plan.chainId === 1 && plan.contractVersion === V9_PROFILE, "Unsigned V9 plan required");
  check(JSON.stringify(plan) === JSON.stringify(prepareRelease(plan.configuration, build)), "Unsigned plan differs from its verified build and public configuration");
  const rpc = transport ?? readOnlyMainnetRpc(rpcUrl), verifier = createVerificationRuntime({ send: rpc.request, expectedChainId: 1 });
  const checkPendingNonce = async () => {
    const pending = await verifier.request("eth_getTransactionCount", [plan.deployer, "pending"], { phase: "preflight" });
    check(BigInt(pending) === BigInt(plan.startingNonce), "Deployment account has a conflicting pending nonce; rebuild after it is resolved");
  };
  await checkPendingNonce();
  const court = await verifyKleros({ transport: { ...rpc, request: (method, params = []) => verifier.request(method, params, { phase: "court" }) } });
  const snapshot = await verifier.canonicalSnapshot("preflight", async (block, { request }) => {
    const [nonce, deployerCode, balance, header, courtHeader] = await Promise.all([
      request("eth_getTransactionCount", [plan.deployer]), request("eth_getCode", [plan.deployer]), request("eth_getBalance", [plan.deployer]),
      request("eth_getBlockByNumber", [block.number, false]),
      request("eth_getBlockByNumber", [court.block.number, false]),
    ]);
    check(same(courtHeader.hash, court.block.hash), "Court verification block is no longer canonical; repeat preflight");
    check(BigInt(nonce) === BigInt(plan.startingNonce), "Deployment nonce changed; rebuild the entire unsigned plan");
    check(deployerCode === "0x", "Deployment account must be a supported EOA");
    const base = BigInt(header.baseFeePerGas ?? 0);
    check(base > 0n, "Ethereum base fee unavailable");
    check(plan.transactions.every(tx => BigInt(tx.maxFeePerGasWei) >= base + BigInt(tx.maxPriorityFeePerGasWei)), "Fee budget is below the current base fee plus priority fee");
    const worstCost = plan.transactions.reduce((sum, tx) => sum + BigInt(tx.gasLimit) * BigInt(tx.maxFeePerGasWei), 0n);
    check(BigInt(balance) >= worstCost, "Deployment account cannot cover the worst-case explicit gas budget");
    for (const address of Object.values(plan.addresses))
      check(await request("eth_getCode", [address]) === "0x" && BigInt(await request("eth_getTransactionCount", [address])) === 0n, "A predicted deployment address is already occupied");
    return { nonce: Number(BigInt(nonce)), balanceWei: String(BigInt(balance)), baseFeePerGasWei: String(base), worstCaseGasCostWei: String(worstCost), initialUpgradeOwner: plan.governance.initialOwner, initialOwnerCodeHash: ethers.keccak256(deployerCode) };
  });
  await checkPendingNonce();
  return { ...plan, preflight: { status: "passed-read-only", checkedAt: new Date().toISOString(), repeatBeforeSigning: true, block: snapshot.block, ...snapshot.result, court, diagnostics: verifier.diagnostics },
    signatures: 0, broadcasts: 0 };
}

async function main(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    check(["--plan", "--preflight", "--rpc", "--output"].includes(key) && !Object.hasOwn(flags, key), "Unknown or duplicate unsigned planning option");
    flags[key] = key === "--preflight" ? true : argv[++i];
    check(flags[key], "Missing unsigned planning option value");
  }
  if (!argv.length) return console.log(JSON.stringify({ status: "review-only", contractVersion: V9_PROFILE, chainId: 1,
    instruction: "--plan registry/ethereum-v9-public-plan.json [--preflight] [--rpc public-root-https] [--output artifacts/mainnet-release/name.json]",
    networkRequests: 0, privateFilesRead: 0, signatures: 0, broadcasts: 0 }));
  check(flags["--plan"] && (!flags["--rpc"] || flags["--preflight"]), "Explicit public plan required; RPC requires --preflight");
  const filename = path.resolve(ROOT, flags["--plan"]);
  check(path.dirname(filename) === path.join(ROOT, "registry") && /^ethereum-v9-[a-z0-9-]+\.json$/.test(path.basename(filename)), "Only explicit public registry/ethereum-v9-*.json planning inputs are accepted");
  const build = verifyV9Build();
  let plan = prepareRelease(JSON.parse(fs.readFileSync(filename, "utf8")), build);
  if (flags["--preflight"]) plan = await preflightRelease(plan, { build, ...(flags["--rpc"] ? { rpcUrl: flags["--rpc"] } : {}) });
  const bytes = JSON.stringify(plan, null, 2) + "\n";
  if (flags["--output"]) {
    const output = path.resolve(ROOT, flags["--output"]), parent = path.join(ROOT, "artifacts/mainnet-release");
    check(path.dirname(output) === parent && /^[a-z0-9-]+\.json$/.test(path.basename(output)), "Public plan output must stay under artifacts/mainnet-release");
    fs.mkdirSync(parent, { recursive: true }); fs.writeFileSync(output, bytes, { flag: "wx" });
  }
  console.log(bytes);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof PlanningError ? `Unsigned release planning stopped: ${error.message}`
      : "Unsigned release planning stopped; check the public inputs, build or read-only preflight.");
    process.exitCode = 1;
  });
