// Public source collection and local compilation only. Never performs a chain/RPC call.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { METAMASK_V130 } from "../src/v10-wallet-compatibility.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_COMMIT = "bfbdf9795a976833ed2fa000baf42fbb83958b03";
const SOLC_VERSION = "0.8.23+commit.f704f362";
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const MANAGER_INITIAL_OWNER = "0xB0403B32f54d0Bd752113f4009e8B534C6669f44";
const REPOS = Object.freeze({
  "": ["MetaMask/delegation-framework", SOURCE_COMMIT],
  "lib/openzeppelin-contracts": ["OpenZeppelin/openzeppelin-contracts", "105fa4e1b0832a6a40cb7ba6e545bb844f02a711"],
  "lib/account-abstraction": ["eth-infinitism/account-abstraction", "7af70c8993a6f42973f520ae0752386a5032abe7"],
  "lib/erc7579-implementation": ["erc7579/erc7579-implementation", "16138d1afd4e9711f6c1425133538837bd7787b5"],
});
const SPECS = Object.freeze([
  { name: "manager", contractName: "DelegationManager", file: "src/DelegationManager.sol", address: METAMASK_V130.manager, metadataChain: 1,
    script: "DeployDelegationFramework.s.sol", constructorArguments: [MANAGER_INITIAL_OWNER], domainName: "DelegationManager" },
  { name: "delegate", contractName: "EIP7702StatelessDeleGator", file: "src/EIP7702/EIP7702StatelessDeleGator.sol", address: METAMASK_V130.delegate, metadataChain: 1,
    script: "DeployEIP7702StatelessDeleGator.s.sol", constructorArguments: [METAMASK_V130.manager, ENTRY_POINT], domainName: "EIP7702StatelessDeleGator" },
  { name: "nativeBalanceEnforcer", contractName: "NativeBalanceChangeEnforcer", file: "src/enforcers/NativeBalanceChangeEnforcer.sol", address: METAMASK_V130.nativeBalanceChangeEnforcer, metadataChain: 10,
    script: "DeployCaveatEnforcers.s.sol", constructorArguments: [], domainName: null },
]);
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const hex = (v) => typeof v === "string" && /^0x(?:[a-f0-9]{2})*$/i.test(v);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const jsonHash = (v) => sha(JSON.stringify(v));
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const check = (ok, code, message) => { if (!ok) fail(code, message); };

function publicJson(fetchImpl, ledger) {
  const cache = new Map();
  return async (url) => {
    if (cache.has(url)) return cache.get(url);
    const task = (async () => {
      const u = new URL(url);
      check(u.protocol === "https:" && ["api.github.com", "raw.githubusercontent.com", "sourcify.dev"].includes(u.hostname) &&
        !u.username && !u.password, "SOURCE_ORIGIN", "Source collection origin is not approved.");
      let response;
      try { response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(30000), headers: { accept: "application/json" } }); }
      catch { fail("SOURCE_UNAVAILABLE", "Public source metadata could not be retrieved."); }
      check(response.status === 200, "SOURCE_UNAVAILABLE", "Public source metadata is unavailable.");
      const text = await response.text();
      check(Buffer.byteLength(text) <= 12_000_000, "SOURCE_TOO_LARGE", "Public source metadata exceeds the bounded input size.");
      ledger.push({ url, sha256: sha(text), byteLength: Buffer.byteLength(text) });
      try { return JSON.parse(text); } catch { fail("SOURCE_JSON", "Public source metadata is not valid JSON."); }
    })();
    cache.set(url, task); return task;
  };
}

function sourcePins(input, trees) {
  const remappings = (input.settings.remappings ?? []).map((value) => {
    check(typeof value === "string", "SOURCE_REMAP", "Invalid compiler remapping.");
    const [prefix, target, extra] = value.replace(/^:/, "").split("=");
    check(prefix && target && extra === undefined && !prefix.includes(":") && !target.includes(".."), "SOURCE_REMAP", "Unreviewed compiler remapping.");
    return [prefix, target];
  }).sort((a, b) => b[0].length - a[0].length);
  const pins = [];
  for (const [compilerPath, value] of Object.entries(input.sources)) {
    check(value && typeof value.content === "string" && Object.keys(value).every((key) => key === "content"), "SOURCE_CONTENT", "Every compiler input must contain explicit source bytes.");
    const remap = remappings.find(([prefix]) => compilerPath.startsWith(prefix));
    const fullPath = remap ? remap[1] + compilerPath.slice(remap[0].length) : compilerPath;
    check(!fullPath.includes("..") && !fullPath.startsWith("/"), "SOURCE_PATH", "Unreviewed source path.");
    const prefix = Object.keys(REPOS).filter(Boolean).find((key) => fullPath.startsWith(key + "/")) ?? "";
    const officialPath = prefix ? fullPath.slice(prefix.length + 1) : fullPath;
    const content = Buffer.from(value.content), blob = createHash("sha1").update(Buffer.from(`blob ${content.length}\0`)).update(content).digest("hex");
    check(trees.get(prefix)?.get(officialPath) === blob, "SOURCE_BLOB_MISMATCH", "Compiler source bytes differ from the reviewed official release/submodule tree.");
    pins.push({ compilerPath, officialRepository: REPOS[prefix][0], officialCommit: REPOS[prefix][1], officialPath,
      gitBlobSha1: blob, sha256: sha(content), keccak256: ethers.keccak256(content) });
  }
  return pins;
}

function immutableDeclarations(output) {
  const names = new Map();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "VariableDeclaration" && node.mutability === "immutable") names.set(String(node.id), node.name);
    for (const child of Object.values(node)) if (child && typeof child === "object") {
      if (Array.isArray(child)) child.forEach(visit); else visit(child);
    }
  };
  for (const source of Object.values(output.sources ?? {})) visit(source.ast);
  return names;
}
function shortString(value) {
  const bytes = Buffer.from(value, "utf8");
  check(bytes.length < 32, "IMMUTABLE_VALUE", "EIP712 short string does not fit its declared representation.");
  return "0x" + bytes.toString("hex").padEnd(62, "0") + bytes.length.toString(16).padStart(2, "0");
}
function immutableValue(spec, name) {
  const wordAddress = (value) => ethers.zeroPadValue(value, 32).toLowerCase();
  const values = {
    _cachedDomainSeparator: spec.domainName ? ethers.TypedDataEncoder.hashDomain({ name: spec.domainName, version: "1", chainId: 1, verifyingContract: spec.address }) : null,
    _cachedChainId: ethers.zeroPadValue("0x01", 32), _cachedThis: wordAddress(spec.address),
    _hashedName: spec.domainName ? ethers.id(spec.domainName) : null, _hashedVersion: ethers.id("1"),
    _name: spec.domainName ? shortString(spec.domainName) : null, _version: shortString("1"),
    __self: wordAddress(spec.address), delegationManager: wordAddress(METAMASK_V130.manager), entryPoint: wordAddress(ENTRY_POINT),
  };
  const allowed = spec.name === "manager" ? ["_cachedDomainSeparator", "_cachedChainId", "_cachedThis", "_hashedName", "_hashedVersion", "_name", "_version"]
    : spec.name === "delegate" ? Object.keys(values) : [];
  check(allowed.includes(name) && hex(values[name]) && values[name].length === 66, "IMMUTABLE_UNKNOWN", "An undeclared framework immutable requires independent review.");
  return values[name];
}
export function patchDeclaredImmutables(specName, artifact, output) {
  const spec = SPECS.find((s) => s.name === specName);
  check(spec, "IMMUTABLE_TARGET", "Unknown framework compilation target.");
  const object = "0x" + artifact.evm.deployedBytecode.object;
  check(hex(object), "UNLINKED_RUNTIME", "Compiled framework runtime has unresolved links.");
  const code = Buffer.from(object.slice(2), "hex"), names = immutableDeclarations(output), used = new Set(), patches = [];
  for (const [id, references] of Object.entries(artifact.evm.deployedBytecode.immutableReferences ?? {})) {
    const name = names.get(id), value = immutableValue(spec, name), bytes = Buffer.from(value.slice(2), "hex");
    for (const { start, length } of references) {
      check(Number.isSafeInteger(start) && start >= 0 && length === 32 && start + length <= code.length, "IMMUTABLE_RANGE", "Invalid declared immutable range.");
      for (let i = start; i < start + length; i++) {
        check(!used.has(i) && code[i] === 0, "IMMUTABLE_OVERLAP", "Immutable references overlap or replace nonplaceholder code."); used.add(i);
      }
      bytes.copy(code, start); patches.push({ id, name, start, length, value });
    }
  }
  check(spec.name !== "nativeBalanceEnforcer" || patches.length === 0, "IMMUTABLE_UNKNOWN", "Balance enforcer must have no constructor immutables.");
  return { code: "0x" + code.toString("hex"), patches };
}

/** Trusted local compiler and operator-supplied public runtime observations; no provider/RPC dependency. */
export async function verifyMetaMaskV130Runtime({ solc, observed, fetchImpl = fetch }) {
  check(solc && typeof solc.compile === "function" && typeof solc.version === "function" &&
    solc.version() === SOLC_VERSION + ".Emscripten.clang", "COMPILER_VERSION", "Exact solc0.8.23+f704f362 is required.");
  check(observed?.kind === "observed-metamask-v1.3-runtime" && observed.chainId === 1 && Array.isArray(observed.contracts) && observed.contracts.length === 3,
    "OBSERVED_SCOPE", "Use the explicit three-contract public Ethereum runtime observation.");
  for (const spec of SPECS) {
    const found = observed.contracts.filter((c) => c.name === spec.name && same(c.address, spec.address));
    check(found.length === 1 && hex(found[0].code) && found[0].code !== "0x" && same(ethers.keccak256(found[0].code), found[0].codeHash),
      "OBSERVED_RUNTIME", "Observed runtime code and hash are inconsistent.");
  }
  const sources = [], get = publicJson(fetchImpl, sources), trees = new Map();
  const mainTree = await get(`https://api.github.com/repos/MetaMask/delegation-framework/git/trees/${SOURCE_COMMIT}?recursive=1`);
  check(Array.isArray(mainTree.tree) && !mainTree.truncated, "SOURCE_TREE", "Official release tree is incomplete.");
  trees.set("", new Map(mainTree.tree.filter((node) => node.type === "blob").map((node) => [node.path, node.sha])));
  for (const [prefix, [repo, commit]] of Object.entries(REPOS).filter(([prefix]) => prefix)) {
    check(mainTree.tree.some((node) => node.path === prefix && node.type === "commit" && node.sha === commit), "SOURCE_SUBMODULE", "Official release submodule identity changed.");
    const tree = await get(`https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`);
    check(Array.isArray(tree.tree) && !tree.truncated, "SOURCE_TREE", "Official dependency tree is incomplete.");
    trees.set(prefix, new Map(tree.tree.filter((node) => node.type === "blob").map((node) => [node.path, node.sha])));
  }
  const contracts = [];
  for (const spec of SPECS) {
    const metadataUrl = `https://sourcify.dev/server/v2/contract/${spec.metadataChain}/${spec.address}?fields=all`;
    const metadata = await get(metadataUrl), input = metadata.stdJsonInput;
    check(metadata.match === "exact_match" && metadata.runtimeMatch === "exact_match" && metadata.compilation?.compilerVersion === SOLC_VERSION &&
      metadata.compilation.fullyQualifiedName === `${spec.file}:${spec.contractName}` && input?.language === "Solidity" &&
      input.settings?.optimizer?.enabled === true && input.settings.optimizer.runs === 200 && input.settings.evmVersion === "london" &&
      (input.settings.viaIR === undefined || input.settings.viaIR === false) && Object.keys(input.settings.libraries ?? {}).length === 0,
      "SOURCE_COMPILATION", "Verified source metadata differs from the reviewed compiler profile.");
    const pins = sourcePins(input, trees), originalInputHash = jsonHash(input);
    const broadcastUrl = `https://raw.githubusercontent.com/MetaMask/delegation-framework/${SOURCE_COMMIT}/broadcast/${spec.script}/1/run-latest.json`;
    const broadcast = await get(broadcastUrl);
    const records = broadcast.transactions?.filter((tx) => tx.contractName === spec.contractName && same(tx.contractAddress, spec.address));
    check(broadcast.chain === 1 && records?.length === 1 && JSON.stringify((records[0].arguments ?? []).map((s) => s.toLowerCase())) ===
      JSON.stringify(spec.constructorArguments.map((s) => s.toLowerCase())), "CONSTRUCTOR_SOURCE", "Official deployment constructor arguments differ from the reviewed values.");
    const expectedArgs = ethers.AbiCoder.defaultAbiCoder().encode(spec.constructorArguments.map(() => "address"), spec.constructorArguments);
    check(same(metadata.creationBytecode?.transformationValues?.constructorArguments ?? "0x", expectedArgs), "CONSTRUCTOR_SOURCE", "Compiler metadata constructor arguments differ from the official deployment.");
    const compileInput = structuredClone(input);
    compileInput.settings.outputSelection = { "*": { "": ["ast"] }, [spec.file]: { [spec.contractName]: ["abi", "metadata", "evm.bytecode", "evm.deployedBytecode"] } };
    let output;
    try { output = JSON.parse(solc.compile(JSON.stringify(compileInput))); } catch { fail("COMPILATION_FAILED", "Exact framework source compilation failed."); }
    check(!output.errors?.some((error) => error.severity === "error"), "COMPILATION_FAILED", "Exact framework source compilation contains an error.");
    const artifact = output.contracts?.[spec.file]?.[spec.contractName];
    check(artifact?.evm?.deployedBytecode && same("0x" + artifact.evm.deployedBytecode.object, metadata.runtimeBytecode.recompiledBytecode),
      "COMPILED_TEMPLATE_MISMATCH", "Full compiled runtime, including metadata, differs from verified compiler output.");
    const compiled = patchDeclaredImmutables(spec.name, artifact, output);
    const observation = observed.contracts.find((c) => c.name === spec.name);
    check(same(compiled.code, metadata.runtimeBytecode.onchainBytecode) && same(compiled.code, observation.code),
      "RUNTIME_MISMATCH", "Independently compiled complete runtime differs from the supplied Ethereum observation.");
    contracts.push({ name: spec.name, address: spec.address, sourceVerified: true, compiler: solc.version(),
      sourceInputSha256: originalInputHash, compilationInputSha256: jsonHash(compileInput), sourceCount: pins.length, sourcePins: pins,
      metadataUrl, metadataVerificationChain: spec.metadataChain, actualObservedChain: 1, crossChainAddressAssumptionUsed: false,
      runtimeCodeHash: ethers.keccak256(compiled.code), runtimeByteLength: (compiled.code.length - 2) / 2,
      immutablePatches: compiled.patches, officialBirthTransaction: records[0].hash, broadcastRecordedCommit: broadcast.commit,
      constructorArguments: spec.constructorArguments, compiledTemplateMatches: true, fullObservedRuntimeMatches: true });
  }
  return { schemaVersion: 1, kind: "metamask-v1.3-source-runtime-verification", status: "verified", checkedAt: new Date().toISOString(),
    sourceVerified: true, financialEligible: false, chainId: 1, officialSourceCommit: SOURCE_COMMIT,
    observedAnchor: { number: observed.anchor?.number ?? observed.anchor?.blockNumber ?? null, hash: observed.anchor?.hash ?? observed.anchor?.blockHash ?? null },
    canonicalRpcReadByThisScript: false, compiler: solc.version(), contracts, publicSourceFetches: sources,
    limits: ["No RPC, signing, authorization-context inspection, deployment or financial execution occurs.",
      "Observed code/anchor is supplied by the operator; this script does not independently establish its canonical RPC provenance.",
      "Exact runtime/source equality does not establish wallet authentication, permission freshness or actual EIP7702/native-value/custody compatibility."] };
}

function artifactPath(value) {
  const full = path.resolve(ROOT, value), allowed = path.join(ROOT, "artifacts/v10-integration") + path.sep;
  check(full.startsWith(allowed) && full.endsWith(".json"), "ARTIFACT_PATH", "Use an explicit public V10 integration JSON artifact path.");
  return full;
}
async function main(args) {
  if (!args.includes("--verify")) {
    console.log(JSON.stringify({ status: "review-only", networkRequests: 0, rpcRequests: 0, sourceVerified: false, financialEligible: false,
      compiler: SOLC_VERSION, contracts: SPECS.map(({ name, address }) => ({ name, address })),
      run: "--verify --solc-module /absolute/local/solc0.8.23 --observed artifacts/v10-integration/metamask-runtime-observed.json --output artifacts/v10-integration/metamask-source-verification.json" }, null, 2));
    return;
  }
  const allowed = new Set(["--verify", "--solc-module", "--observed", "--output"]), options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]; check(allowed.has(flag) && options[flag] === undefined, "ARGUMENTS", "Use only the documented source-verification flags.");
    options[flag] = flag === "--verify" ? true : args[++index];
  }
  check(typeof options["--solc-module"] === "string" && path.isAbsolute(options["--solc-module"]) && typeof options["--observed"] === "string" &&
    typeof options["--output"] === "string", "ARGUMENTS", "Explicit local compiler, observed artifact and new output artifact are required.");
  const observedPath = artifactPath(options["--observed"]), outputPath = artifactPath(options["--output"]);
  const stat = await fs.lstat(observedPath); check(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1_000_000, "OBSERVED_FILE", "Use a regular bounded public runtime artifact.");
  const observed = JSON.parse(await fs.readFile(observedPath, "utf8"));
  const solc = createRequire(import.meta.url)(options["--solc-module"]);
  let proof;
  try { proof = await verifyMetaMaskV130Runtime({ solc, observed }); }
  catch (error) {
    proof = { schemaVersion: 1, kind: "metamask-v1.3-source-runtime-verification", status: "unverified", sourceVerified: false,
      financialEligible: false, checkedAt: new Date().toISOString(), code: /^[A-Z_]{1,64}$/.test(error.code ?? "") ? error.code : "VERIFICATION_FAILED",
      message: "Source/runtime verification did not complete. No financial support is established." };
    process.exitCode = 1;
  }
  await fs.writeFile(outputPath, JSON.stringify(proof, null, 2) + "\n", { flag: "wx", mode: 0o644 });
  console.log(JSON.stringify({ status: proof.status, sourceVerified: proof.sourceVerified, financialEligible: false, outputPath,
    code: proof.code, contracts: proof.contracts?.map(({ name, runtimeCodeHash, sourceCount }) => ({ name, runtimeCodeHash, sourceCount })) }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(JSON.stringify({ status: "unverified", sourceVerified: false, financialEligible: false,
    code: /^[A-Z_]{1,64}$/.test(error.code ?? "") ? error.code : "VERIFICATION_FAILED" })); process.exitCode = 1; }
}
