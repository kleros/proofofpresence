// Separate UUPS family; historical v7/v8 builds are never overwritten.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import solc from "solc-hardened";
import { keccak256 } from "ethers";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha256 = value => createHash("sha256").update(value).digest("hex");
const entryNames = ["KlerosEventV9", "KlerosEventFactoryV9", "KlerosUpgradeTimelockV9"];
const sources = {};
function addSource(filename) {
  if (sources[filename]) return;
  const disk = filename.startsWith("@openzeppelin/") ? path.join(root, "node_modules", filename) : path.join(root, filename);
  const content = fs.readFileSync(disk, "utf8"); sources[filename] = { content };
  for (const match of content.matchAll(/import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']\s*;/g)) {
    const dependency = match[1].startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(filename), match[1])) : match[1];
    addSource(dependency);
  }
}
for (const name of entryNames) addSource(`contracts/v9/${name}.sol`);
addSource("@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol");
if (JSON.parse(fs.readFileSync(path.join(root, "node_modules/@openzeppelin/contracts/package.json"))).version !== "5.7.0")
  throw new Error("V9 requires exact OpenZeppelin Contracts5.7.0");
if (!solc.version().startsWith("0.8.38+")) throw new Error(`Unexpected V9 compiler ${solc.version()}`);
const input = { language: "Solidity", sources, settings: {
  optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "paris",
  outputSelection: { "*": { "": ["ast"], "*": ["abi", "storageLayout", "evm.bytecode.object", "evm.bytecode.linkReferences",
    "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } },
} };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const error of output.errors ?? []) console.error(error.formattedMessage);
if ((output.errors ?? []).some(error => error.severity === "error")) process.exit(1);
const target = path.join(root, "build/contracts-v9");
fs.mkdirSync(target, { recursive: true });
const astNames = {};
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.nodeType === "VariableDeclaration") astNames[node.id] = { name: node.name, type: node.typeDescriptions?.typeString };
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
}
for (const source of Object.values(output.sources)) visit(source.ast);
const selected = [...entryNames.map(name => [`contracts/v9/${name}.sol`, name]),
  ["@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol", "ERC1967Proxy"]];
const timelockRuntime = "0x" + output.contracts["contracts/v9/KlerosUpgradeTimelockV9.sol"].KlerosUpgradeTimelockV9.evm.deployedBytecode.object;
const manifest = { profile: "kleros-event-v9-uups", version: 9, compiler: solc.version(),
  openzeppelin: "5.7.0", minimumUpgradeDelay: 172800, settings: input.settings,
  sources: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, sha256(source.content)])), contracts: {} };
for (const [filename, name] of selected) {
  const c = output.contracts[filename][name], bytecode = "0x" + c.evm.bytecode.object,
    runtime = "0x" + c.evm.deployedBytecode.object;
  const creationBytes = (bytecode.length - 2) / 2, runtimeBytes = (runtime.length - 2) / 2;
  if (creationBytes > 49152 || runtimeBytes > 24576) throw new Error(`${name} exceeds EVM code limits: ${creationBytes}/${runtimeBytes}`);
  const immutableReferences = c.evm.deployedBytecode.immutableReferences;
  const immutableValues = Object.fromEntries(Object.keys(immutableReferences ?? {}).map(id => [id, {
    ...astNames[id], value: astNames[id]?.name === "_timelockCodeHash" ? keccak256(timelockRuntime) :
      astNames[id]?.name === "__self" ? "implementation-address" : null,
  }]));
  if (Object.values(immutableValues).some(value => value.value === null)) throw new Error(`${name} has an unknown runtime immutable`);
  const artifact = { abi: c.abi, bytecode, deployedBytecode: runtime, compiler: solc.version(),
    immutableReferences, immutableValues, linkReferences: c.evm.bytecode.linkReferences, storageLayout: c.storageLayout };
  fs.writeFileSync(path.join(target, `${name}.json`), JSON.stringify(artifact, null, 2) + "\n");
  fs.writeFileSync(path.join(target, `${name}.storage-layout.json`), JSON.stringify(c.storageLayout, null, 2) + "\n");
  manifest.contracts[name] = { creationBytes, runtimeBytes, creationCodeHash: keccak256(bytecode),
    abiSha256: sha256(JSON.stringify(c.abi)),
    unpatchedRuntimeCodeHash: keccak256(runtime), ...(Object.keys(immutableReferences).length ? {} : { deployedCodeHash: keccak256(runtime) }),
    immutableReferences, immutableValues, storageLayoutSha256: sha256(JSON.stringify(c.storageLayout)) };
  console.log(`Compiled ${name}: creation ${creationBytes}, runtime ${runtimeBytes} bytes`);
}
fs.writeFileSync(path.join(target, "standard-input.json"), JSON.stringify(input, null, 2) + "\n");
fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
