import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import solc from "solc-hardened";
import { keccak256 } from "ethers";

const root = fileURLToPath(new URL("..", import.meta.url));
const filenames = ["KlerosEventV8.sol", "KlerosEventFactoryV8.sol"];
const input = {
  language: "Solidity",
  sources: Object.fromEntries(
    filenames.map((name) => [
      `contracts/${name}`,
      { content: fs.readFileSync(path.join(root, "contracts", name), "utf8") },
    ]),
  ),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};
if (!solc.version().startsWith("0.8.38+"))
  throw new Error(`Unexpected v8 compiler ${solc.version()}`);
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const error of output.errors ?? []) console.error(error.formattedMessage);
if ((output.errors ?? []).some((error) => error.severity === "error"))
  process.exit(1);
const target = path.join(root, "build/contracts");
fs.mkdirSync(target, { recursive: true });
const manifest = {
  version: 8,
  compiler: solc.version(),
  settings: input.settings,
  sources: Object.fromEntries(
    Object.entries(input.sources).map(([name, source]) => [
      name,
      createHash("sha256").update(source.content).digest("hex"),
    ]),
  ),
  contracts: {},
};
for (const filename of filenames) {
  const name = filename.replace(".sol", "");
  const c = output.contracts[`contracts/${filename}`][name];
  const bytecode = `0x${c.evm.bytecode.object}`;
  const runtime = `0x${c.evm.deployedBytecode.object}`;
  const creationBytes = (bytecode.length - 2) / 2;
  const runtimeBytes = (runtime.length - 2) / 2;
  if (creationBytes > 49_152 || runtimeBytes > 24_576)
    throw new Error(`${name} exceeds EVM code limits`);
  fs.writeFileSync(
    path.join(target, `${name}.json`),
    JSON.stringify(
      {
        abi: c.abi,
        bytecode,
        deployedBytecode: runtime,
        compiler: solc.version(),
      },
      null,
      2,
    ) + "\n",
  );
  manifest.contracts[name] = {
    creationBytes,
    runtimeBytes,
    creationCodeHash: keccak256(bytecode),
  };
  console.log(
    `Compiled ${name}: creation ${creationBytes}, runtime ${runtimeBytes} bytes`,
  );
}
fs.writeFileSync(
  path.join(target, "standard-input.json"),
  JSON.stringify(input, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(target, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
