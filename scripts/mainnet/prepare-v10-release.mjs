// Public, unsigned V10 CREATE planning only. This module has no network or signing transport.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import solc from "solc-hardened";
import { ethers } from "ethers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const V10_PROFILE = "kleros-event-v10-uups";
export const MAX_TRANSACTION_GAS = 16777216n;
export const V10_CONTRACT_NAMES = Object.freeze([
  "KlerosUpgradeControllerV10", "KlerosEventV10", "KlerosEventFactoryV10", "ERC1967Proxy",
]);
const VERIFIED_BUILDS = new WeakMap();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
class PlanningError extends Error { constructor(message) { super(message); this.name = "PlanningError"; } }
const check = (condition, message) => { if (!condition) throw new PlanningError(message); };
function record(value, keys, label) {
  check(value && typeof value === "object" && !Array.isArray(value), "Invalid " + label);
  check(Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)),
    "Unexpected or missing " + label + " field");
}
function address(value, label) {
  check(typeof value === "string" && ethers.isAddress(value) && BigInt(value) !== 0n, "Invalid " + label);
  return ethers.getAddress(value);
}
function positiveWei(value, label) {
  check(typeof value === "string" && /^[1-9][0-9]{0,77}$/.test(value), "Invalid " + label);
  const amount = BigInt(value);
  check(amount < 2n ** 256n, "Invalid " + label);
  return amount;
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Explicit public budgets and a new-family governance choice; no V9 delay rule is changed. */
export function validateV10ReleaseConfig(raw) {
  record(raw, ["schemaVersion", "version", "chainId", "contractVersion", "deployer", "deployerNonce",
    "governance", "fees", "gasLimits", "maxTotalGasCostWei"], "V10 release configuration");
  check(raw.schemaVersion === 1 && raw.version === 10 && raw.chainId === 1 && raw.contractVersion === V10_PROFILE,
    "Only Ethereum chain1 V10 release plans are supported");
  check(Number.isSafeInteger(raw.deployerNonce) && raw.deployerNonce >= 0 && raw.deployerNonce <= Number.MAX_SAFE_INTEGER - 4,
    "Invalid deployment nonce");
  const deployer = address(raw.deployer, "deployer");
  record(raw.governance, ["kind", "initialOwner", "upgradeDelaySeconds", "renounceable"], "governance");
  check(raw.governance.kind === "single-owner-immediate" && raw.governance.upgradeDelaySeconds === 0 && raw.governance.renounceable === true,
    "V10 requires explicitly renounceable immediate single-owner governance");
  const initialOwner = address(raw.governance.initialOwner, "initial upgrade owner");
  check(initialOwner === deployer, "The explicit deployment wallet must be the initial upgrade owner");
  record(raw.fees, ["maxFeePerGasWei", "maxPriorityFeePerGasWei"], "fee budget");
  const maxFee = positiveWei(raw.fees.maxFeePerGasWei, "maximum fee"), tip = positiveWei(raw.fees.maxPriorityFeePerGasWei, "priority fee");
  check(tip <= maxFee, "Priority fee exceeds maximum fee");
  record(raw.gasLimits, V10_CONTRACT_NAMES, "gas limits");
  let totalGas = 0n;
  for (const name of V10_CONTRACT_NAMES) {
    const gas = positiveWei(raw.gasLimits[name], name + " gas limit");
    check(gas >= 53000n && gas <= MAX_TRANSACTION_GAS, "Gas limit outside Ethereum transaction bounds");
    totalGas += gas;
  }
  const budget = positiveWei(raw.maxTotalGasCostWei, "total gas cost budget");
  check(totalGas * maxFee <= budget, "Explicit gas limits exceed the total ETH budget");
  return structuredClone({ ...raw, deployer, governance: { ...raw.governance, initialOwner } });
}

export function assertV10Artifact(name, compiled, artifact) {
  const bytecode = "0x" + compiled.evm.bytecode.object, runtime = "0x" + compiled.evm.deployedBytecode.object;
  check(/^0x(?:[0-9a-f]{2})+$/i.test(bytecode) && /^0x(?:[0-9a-f]{2})+$/i.test(runtime), "Invalid emitted bytecode");
  check(equal(artifact.abi, compiled.abi) && artifact.bytecode === bytecode && artifact.deployedBytecode === runtime,
    "Compiled artifact differs: " + name);
  check(equal(artifact.storageLayout, compiled.storageLayout), "Storage artifact differs: " + name);
  check(equal(artifact.immutableReferences, compiled.evm.deployedBytecode.immutableReferences ?? {}), "Immutable references differ: " + name);
  check(equal(artifact.linkReferences, compiled.evm.bytecode.linkReferences ?? {}), "Library references differ: " + name);
  check((bytecode.length - 2) / 2 <= 49152 && (runtime.length - 2) / 2 <= 24576, "EVM code limit exceeded: " + name);
  check(Object.keys(compiled.evm.bytecode.linkReferences ?? {}).length === 0, "Unresolved library links are unsupported");
  check(compiled.storageLayout, "Missing compiler storage layout: " + name);
  return { abi: compiled.abi, bytecode, deployedBytecode: runtime, storageLayout: compiled.storageLayout,
    immutableReferences: compiled.evm.deployedBytecode.immutableReferences ?? {} };
}

/** Patch only compiler-declared, independently identified immutable references; AST IDs are not hardcoded. */
export function v10RuntimeCode(artifact, implementation, controllerCodeHash) {
  address(implementation, "implementation address");
  check(/^0x[0-9a-f]{64}$/i.test(controllerCodeHash), "Invalid controller runtime hash");
  const code = ethers.getBytes(artifact.deployedBytecode), occupied = new Set();
  const references = artifact.immutableReferences ?? {}, values = artifact.immutableValues ?? {};
  check(equal(Object.keys(references).sort(), Object.keys(values).sort()), "Incomplete immutable metadata");
  for (const [id, locations] of Object.entries(references)) {
    const value = values[id];
    const encoded = value?.name === "__self" && value.type === "address" && value.value === "implementation-address"
      ? ethers.zeroPadValue(implementation, 32)
      : value?.name === "_controllerCodeHash" && value.type === "bytes32" && value.value === controllerCodeHash
        ? controllerCodeHash : null;
    check(encoded && Array.isArray(locations) && locations.length > 0, "Unknown immutable metadata");
    for (const location of locations) {
      record(location, ["start", "length"], "immutable location");
      const { start, length } = location;
      check(Number.isSafeInteger(start) && start >= 0 && length === 32 && start + length <= code.length, "Invalid immutable location");
      for (let i = start; i < start + length; i++) {
        check(!occupied.has(i) && code[i] === 0, "Overlapping or nonzero immutable template");
        occupied.add(i);
      }
      code.set(ethers.getBytes(encoded), start);
    }
  }
  return ethers.hexlify(code);
}

/** Recompile the complete saved inline input and verify current disk sources plus every emitted artifact. */
export function verifyV10Build({ artifactDirectory = path.join(ROOT, "build/contracts-v10") } = {}) {
  const files = new Map();
  const readPinned = filename => { const bytes = fs.readFileSync(filename); files.set(filename, sha(bytes)); return bytes; };
  const assertFresh = () => {
    for (const [filename, digest] of files) check(sha(fs.readFileSync(filename)) === digest, "Verified V10 source or build changed; verify again");
  };
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const installed = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@openzeppelin/contracts/package.json"), "utf8"));
  check(packageJson.dependencies?.["@openzeppelin/contracts"] === "5.7.0" && installed.version === "5.7.0", "OpenZeppelin must be pinned to 5.7.0");
  check(solc.version() === "0.8.38+commit.1835d247.Emscripten.clang", "Unexpected hardened compiler");
  const inputBytes = readPinned(path.join(artifactDirectory, "standard-input.json")), input = JSON.parse(inputBytes);
  record(input, ["language", "sources", "settings"], "compiler input");
  check(input.language === "Solidity" && input.sources && typeof input.sources === "object" && !Array.isArray(input.sources), "Invalid V10 inline input");
  record(input.settings, ["evmVersion", "optimizer", "viaIR", "outputSelection"], "compiler settings");
  record(input.settings.optimizer, ["enabled", "runs"], "optimizer settings");
  check(input.settings.evmVersion === "paris" && input.settings.optimizer.enabled === true && input.settings.optimizer.runs === 200 && input.settings.viaIR === true,
    "Unreviewed V10 compiler settings");
  check(equal(input.settings.outputSelection, { "*": { "": ["ast"], "*": ["abi", "storageLayout", "evm.bytecode.object", "evm.bytecode.linkReferences", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } }), "Unexpected compiler outputs");
  const manifestBytes = readPinned(path.join(artifactDirectory, "manifest.json")), manifest = JSON.parse(manifestBytes);
  check(manifest.profile === V10_PROFILE && manifest.version === 10 && manifest.compiler === solc.version() && manifest.openzeppelin === "5.7.0"
    && manifest.minimumUpgradeDelay === 0 && manifest.governanceKind === "single-owner-immediate" && manifest.renounceable === true,
  "V10 manifest identity differs");
  check(equal(manifest.settings, input.settings), "Manifest settings differ");
  const sourceHashes = {};
  for (const [name, source] of Object.entries(input.sources)) {
    check((/^contracts\/v10\/[A-Za-z0-9_]+\.sol$/.test(name) || /^@openzeppelin\/contracts\/[A-Za-z0-9_/-]+\.sol$/.test(name)) && !name.split("/").includes(".."),
      "Unexpected compiler source path");
    record(source, ["content"], "inline source");
    const disk = path.join(ROOT, name.startsWith("@openzeppelin/") ? "node_modules/" + name : name), bytes = readPinned(disk);
    check(source.content === bytes.toString("utf8"), "Saved compiler source differs: " + name);
    sourceHashes[name] = sha(bytes);
  }
  for (const name of V10_CONTRACT_NAMES.filter(name => name !== "ERC1967Proxy"))
    check(input.sources["contracts/v10/" + name + ".sol"], "Missing V10 source: " + name);
  check(equal(manifest.sources, sourceHashes), "Manifest source hashes differ");
  check(equal(Object.keys(manifest.contracts ?? {}).sort(), [...V10_CONTRACT_NAMES].sort()), "Unexpected manifest contracts");
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  check(!(output.errors ?? []).some(error => error.severity === "error"), "Independent V10 compilation failed");
  const immutableNames = {};
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "VariableDeclaration" && node.mutability === "immutable")
      immutableNames[node.id] = { name: node.name, type: node.typeDescriptions?.typeString };
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  Object.values(output.sources).forEach(source => visit(source.ast));
  const controllerCodeHash = ethers.keccak256("0x" + output.contracts["contracts/v10/KlerosUpgradeControllerV10.sol"].KlerosUpgradeControllerV10.evm.deployedBytecode.object);
  const contracts = {};
  for (const name of V10_CONTRACT_NAMES) {
    const matches = Object.values(output.contracts).flatMap(group => Object.entries(group)).filter(([key]) => key === name);
    check(matches.length === 1, "Ambiguous compiled contract: " + name);
    const compiled = matches[0][1], artifact = JSON.parse(readPinned(path.join(artifactDirectory, name + ".json")));
    check(artifact.compiler === solc.version(), "Artifact compiler differs: " + name);
    const verified = assertV10Artifact(name, compiled, artifact);
    const immutableValues = Object.fromEntries(Object.keys(verified.immutableReferences).map(id => {
      const variable = immutableNames[id];
      check(variable?.name === "__self" && variable.type === "address" || variable?.name === "_controllerCodeHash" && variable.type === "bytes32",
        "Unreviewed V10 immutable");
      return [id, { ...variable, value: variable.name === "__self" ? "implementation-address" : controllerCodeHash }];
    }));
    const expectedNames = name === "KlerosEventV10" || name === "KlerosEventFactoryV10" ? ["__self", "_controllerCodeHash"] : [];
    check(equal(Object.values(immutableValues).map(value => value.name).sort(), expectedNames.sort()), "Unexpected V10 immutable set");
    check(equal(artifact.immutableValues, immutableValues), "Immutable value metadata differs: " + name);
    check(equal(JSON.parse(readPinned(path.join(artifactDirectory, name + ".storage-layout.json"))), compiled.storageLayout),
      "Saved storage layout differs: " + name);
    const entry = manifest.contracts[name];
    check(entry.creationCodeHash === ethers.keccak256(verified.bytecode) && entry.unpatchedRuntimeCodeHash === ethers.keccak256(verified.deployedBytecode)
      && entry.abiSha256 === sha(JSON.stringify(compiled.abi)) && entry.creationBytes === (verified.bytecode.length - 2) / 2
      && entry.runtimeBytes === (verified.deployedBytecode.length - 2) / 2 && entry.storageLayoutSha256 === sha(JSON.stringify(compiled.storageLayout))
      && equal(entry.immutableReferences, verified.immutableReferences) && equal(entry.immutableValues, immutableValues), "Manifest contract differs: " + name);
    if (!expectedNames.length) check(entry.deployedCodeHash === ethers.keccak256(verified.deployedBytecode), "Deployed runtime hash differs: " + name);
    contracts[name] = { ...verified, immutableValues };
    v10RuntimeCode(contracts[name], "0x0000000000000000000000000000000000000001", controllerCodeHash);
  }
  const build = freeze({ profile: V10_PROFILE, version: 10, compiler: solc.version(), settings: input.settings, controllerCodeHash,
    standardInputSha256: sha(JSON.stringify(input)), standardInputFileSha256: sha(inputBytes), buildManifestSha256: sha(JSON.stringify(manifest)),
    buildManifestFileSha256: sha(manifestBytes), sourceHashes, contracts });
  assertFresh();
  VERIFIED_BUILDS.set(build, assertFresh);
  return build;
}

/** The four requests are proposals, not estimates, preflight results, authorization or signatures. */
export function prepareV10Release(raw, build) {
  const config = validateV10ReleaseConfig(raw);
  check(VERIFIED_BUILDS.has(build), "A freshly verified V10 build from verifyV10Build is required");
  VERIFIED_BUILDS.get(build)();
  const addresses = Object.fromEntries(V10_CONTRACT_NAMES.map((name, i) => [name, ethers.getCreateAddress({ from: config.deployer, nonce: config.deployerNonce + i })]));
  const initialize = new ethers.Interface(build.contracts.KlerosEventFactoryV10.abi).encodeFunctionData("initialize",
    [addresses.KlerosEventV10, addresses.KlerosUpgradeControllerV10]);
  const argumentsByName = { KlerosUpgradeControllerV10: [config.governance.initialOwner], KlerosEventV10: [], KlerosEventFactoryV10: [],
    ERC1967Proxy: [addresses.KlerosEventFactoryV10, initialize] };
  const transactions = V10_CONTRACT_NAMES.map((name, i) => {
    const artifact = build.contracts[name], data = artifact.bytecode + new ethers.Interface(artifact.abi).encodeDeploy(argumentsByName[name]).slice(2);
    const bytes = ethers.getBytes(data);
    check(bytes.length <= 49152, "Constructor inputs exceed EIP-3860");
    const intrinsic = 53000n + bytes.reduce((sum, byte) => sum + BigInt(byte === 0 ? 4 : 16), 0n) + 2n * BigInt(Math.ceil(bytes.length / 32));
    // EIP-7623 calldata floor on current Ethereum: 21,000 + 10 * calldata tokens.
    const floor = 21000n + bytes.reduce((sum, byte) => sum + BigInt(byte === 0 ? 10 : 40), 0n);
    check(BigInt(config.gasLimits[name]) >= intrinsic && BigInt(config.gasLimits[name]) >= floor, "Gas limit below deployment intrinsic/calldata floor: " + name);
    return { step: i + 1, contract: name, predictedAddress: addresses[name], from: config.deployer, to: null,
      chainId: 1, type: 2, nonce: config.deployerNonce + i, value: "0", data, gasLimit: config.gasLimits[name], ...config.fees,
      expectedRuntimeCodeHash: ethers.keccak256(v10RuntimeCode(artifact, addresses[name], build.controllerCodeHash)) };
  });
  return { schemaVersion: 1, version: 10, status: "unsigned-review-only", contractVersion: V10_PROFILE, chainId: 1,
    configuration: config, governance: config.governance, deployer: config.deployer, startingNonce: config.deployerNonce,
    addresses, factoryProxy: addresses.ERC1967Proxy, upgradeDelaySeconds: 0, transactions,
    maxTotalGasCostWei: config.maxTotalGasCostWei, gasLimitsStatus: "new-proposal-unapproved", gasEstimatesVerified: false,
    deploymentAuthorized: false, preflightVerified: false, finalizationAutomatic: false, guestEventCreated: false,
    provenance: { v10BuildManifestSha256: build.buildManifestSha256, v10BuildManifestFileSha256: build.buildManifestFileSha256,
      v10StandardInputSha256: build.standardInputSha256, v10StandardInputFileSha256: build.standardInputFileSha256 },
    compilation: { compiler: build.compiler, sourceHashes: build.sourceHashes },
    ownershipTransfer: { target: addresses.KlerosUpgradeControllerV10, steps: ["Current owner calls transferOwnership(newOwner)", "Proposed owner calls acceptOwnership()"] },
    renunciation: { target: addresses.KlerosUpgradeControllerV10, automatic: false, effect: "Permanently disables controller upgrades and future factory implementation selection" },
    requiredBeforeHumanSigning: ["Fresh chain1 and canonical block checks", "Fresh empty-code EOA account and direct CREATE envelope checks",
      "Exact latest and pending nonce checks with all predicted addresses unused", "Fresh balance, fees and explicit gas-cap review",
      "Canonical source-bound preflight and complete exact-bundle deployment rehearsal by the deployment bridge"],
    limitations: ["Offline gas limits are unapproved proposals; local rehearsal is not a mainnet preflight",
      "The controller owner can upgrade immediately until ownership is renounced", "Existing V9 events remain separate",
      "Policy publication, application integration and production hosting are separate actions"],
    networkRequests: 0, privateFilesRead: 0, signatures: 0, broadcasts: 0 };
}

async function main(argv) {
  if (!argv.length) return console.log(JSON.stringify({ status: "review-only", contractVersion: V10_PROFILE, version: 10, chainId: 1,
    instruction: "--plan registry/ethereum-v10-public-name.json [--output artifacts/v10-release/public-name.json]",
    networkRequests: 0, privateFilesRead: 0, signatures: 0, broadcasts: 0 }));
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    check(["--plan", "--output"].includes(key) && !Object.hasOwn(flags, key), "Unknown or duplicate unsigned planning option");
    flags[key] = argv[++i];
    check(typeof flags[key] === "string" && !flags[key].startsWith("--"), "Missing unsigned planning option value");
  }
  check(flags["--plan"], "Explicit public V10 plan required");
  const filename = path.resolve(ROOT, flags["--plan"]), registry = path.join(ROOT, "registry");
  check(path.dirname(filename) === registry && /^ethereum-v10-public-[a-z0-9-]+\.json$/.test(path.basename(filename)), "Only explicit public V10 registry inputs are accepted");
  check(fs.lstatSync(filename).isFile() && fs.realpathSync(filename) === filename, "Public V10 input must be a regular non-symlink file");
  const plan = prepareV10Release(JSON.parse(fs.readFileSync(filename, "utf8")), verifyV10Build()), bytes = JSON.stringify(plan, null, 2) + "\n";
  if (flags["--output"]) {
    const output = path.resolve(ROOT, flags["--output"]), directory = path.join(ROOT, "artifacts/v10-release");
    check(path.dirname(output) === directory && /^[a-z0-9-]+\.json$/.test(path.basename(output)), "Public V10 output must stay under artifacts/v10-release");
    fs.mkdirSync(directory, { recursive: true });
    check(fs.realpathSync(directory) === directory, "Public V10 output directory must not be a symlink");
    fs.writeFileSync(output, bytes, { flag: "wx" });
  }
  console.log(bytes);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof PlanningError ? "Unsigned V10 planning stopped: " + error.message : "Unsigned V10 planning stopped; check public inputs and the local build.");
    process.exitCode = 1;
  });
