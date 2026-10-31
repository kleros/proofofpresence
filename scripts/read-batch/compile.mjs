// Development-only reproducible constant generation. No provider or deployment.
import fs from "node:fs";
import { createHash } from "node:crypto";
import solc from "solc-hardened";
const source = fs.readFileSync(new URL("./V10ReadBatch.sol", import.meta.url), "utf8");
const sha = value => createHash("sha256").update(value).digest("hex");
if (solc.version() !== "0.8.38+commit.1835d247.Emscripten.clang") throw Error("Unexpected read-batch compiler");
const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "paris",
  metadata: { bytecodeHash: "none", appendCBOR: false }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } };
const output = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "V10ReadBatch.sol": { content: source } }, settings })));
const errors = (output.errors ?? []).filter(error => error.severity === "error");
if (errors.length) throw Error(errors.map(error => error.formattedMessage).join("\n"));
const bytecode = "0x" + output.contracts["V10ReadBatch.sol"].V10ReadBatch.evm.bytecode.object;
const provenance = { compiler: solc.version(), sourceSha256: sha(source), bytecodeSha256: sha(Buffer.from(bytecode.slice(2), "hex")), settings };
const filename = new URL("../../src/v10-read-batch.mjs", import.meta.url);
const original = fs.readFileSync(filename, "utf8");
const begin = "// BEGIN GENERATED READ BATCH", end = "// END GENERATED READ BATCH";
const start = original.indexOf(begin), finish = original.indexOf(end, start);
if (start < 0 || finish < start) throw Error("Read-batch generation markers missing");
const generated = `${begin}\nexport const V10_READ_BATCH_SOURCE = ${JSON.stringify(source)};\nexport const V10_READ_BATCH_BYTECODE = ${JSON.stringify(bytecode)};\nexport const V10_READ_BATCH_BUILD = Object.freeze(${JSON.stringify(provenance)});\n${end}`;
fs.writeFileSync(filename, original.slice(0, start) + generated + original.slice(finish + end.length));
console.log(JSON.stringify({ ...provenance, settings: undefined, creationBytes: (bytecode.length - 2) / 2 }));
