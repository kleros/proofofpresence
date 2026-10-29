// Dedicated build output: this never overwrites production v8 ABI/bytecode.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import solc from "solc-hardened";
import { keccak256 } from "ethers";
import {
  checkTest15mSources,
  TEST15M_PROFILE,
  TEST15M_VERSION,
  TEST15M_CHAIN_ID,
  TEST15M_PERIOD,
} from "./generate-contracts-test15m.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sources = checkTest15mSources();
const input = {
  language: "Solidity",
  sources: Object.fromEntries(
    sources.map(({ filename, content }) => [filename, { content }]),
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
  throw new Error(`Unexpected test15m compiler ${solc.version()}`);
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const error of output.errors ?? []) console.error(error.formattedMessage);
if ((output.errors ?? []).some((error) => error.severity === "error"))
  process.exit(1);
const target = path.join(root, "build/contracts-test15m");
fs.mkdirSync(target, { recursive: true });
const manifest = {
  profile: TEST15M_PROFILE,
  version: TEST15M_VERSION,
  chainId: TEST15M_CHAIN_ID,
  challengePeriod: TEST15M_PERIOD,
  matchPeriod: TEST15M_PERIOD,
  compiler: solc.version(),
  settings: input.settings,
  productionSources: Object.fromEntries(
    sources.map((s) => [s.productionSource, s.productionSha256]),
  ),
  sources: Object.fromEntries(
    sources.map((s) => [
      s.filename,
      createHash("sha256").update(s.content).digest("hex"),
    ]),
  ),
  contracts: {},
};
for (const { filename } of sources) {
  const name = path.basename(filename, ".sol");
  const c = output.contracts[filename][name];
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
