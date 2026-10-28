import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { keccak256 } from "ethers";

const root = fileURLToPath(new URL("../", import.meta.url));
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const output = path.join(root, "artifacts/stress", runId);
fs.mkdirSync(output, { recursive: true });
const allSuites = ["ledger", "settlement", "capacity", "hostile"];
const suites = (process.env.V8_STRESS_SUITES ?? allSuites.join(","))
  .split(",")
  .map((name) => name.trim());
const files = [
  "contracts/KlerosEventV8.sol",
  "contracts/KlerosEventFactoryV8.sol",
  "src/contracts-v8.mjs",
  "scripts/compile-contracts.mjs",
  "references/kickback/scripts/compile.mjs",
  "references/kickback/test/MockKleros.sol",
  "references/kickback/test/TestWallet.sol",
  "references/kickback/contracts/TruthPaysKickback.sol",
  "test/stress/Adversaries.sol",
  "scripts/stress-contracts.mjs",
  ...allSuites.map((name) => `test/stress/v8-${name}.stress.mjs`),
];
const artifactFiles = [
  "build/contracts/manifest.json",
  "build/contracts/standard-input.json",
  "build/contracts/KlerosEventV8.json",
  "build/contracts/KlerosEventFactoryV8.json",
  ...[
    "MockKlerosLiquid",
    "MockArbitrableProxy",
    "TestWallet",
    "GasBurners",
  ].map((name) => `references/kickback/build/${name}.json`),
];
const sha = (file) =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(root, file)))
    .digest("hex");
const sourceHashes = {};
const artifactHashes = {};
const started = performance.now();
const summary = {
  runId,
  startedAt: new Date().toISOString(),
  success: false,
  status: "preflight",
  requestedSuites: suites,
  scope:
    "In-process synthetic Ganache; Court adjudication mocked; no live RPC or deployment",
  sourceHashes,
  artifactHashes,
  suites: {},
};
const save = () =>
  fs.writeFileSync(
    path.join(output, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
const publish = () =>
  fs.writeFileSync(
    path.join(root, "artifacts/v8-stress-latest.json"),
    JSON.stringify(
      {
        runId,
        success: summary.success,
        status: summary.status,
        requestedSuites: suites,
        summary: path.relative(root, path.join(output, "summary.json")),
      },
      null,
      2,
    ) + "\n",
  );
save();
publish();
try {
  if (
    !suites.length ||
    new Set(suites).size !== suites.length ||
    suites.some((name) => !allSuites.includes(name))
  )
    throw new Error("Invalid V8_STRESS_SUITES selection");
  for (const file of files) sourceHashes[file] = sha(file);
  for (const file of artifactFiles) artifactHashes[file] = sha(file);
  summary.compiler = JSON.parse(
    fs.readFileSync(path.join(root, "build/contracts/manifest.json"), "utf8"),
  );
  summary.historicalV7Sha256 = sha(
    "references/kickback/contracts/TruthPaysKickback.sol",
  );
  for (const [file, expected] of Object.entries(
    summary.compiler.sources ?? {},
  )) {
    if (sha(file) !== expected)
      throw new Error(`Stale compiled stress artifact: ${file}`);
  }
  if (!summary.compiler.sources)
    throw new Error("Rebuild with npm run compile:v8 before stress testing");
  const expectedV7 = JSON.parse(
    fs.readFileSync(
      path.join(root, "references/kickback/abi/v7/manifest.json"),
      "utf8",
    ),
  );
  if (summary.historicalV7Sha256 !== expectedV7.sourceSha256)
    throw new Error("Historical v7 source changed");
  for (const [name, expected] of Object.entries(summary.compiler.contracts)) {
    const artifact = JSON.parse(
      fs.readFileSync(path.join(root, `build/contracts/${name}.json`), "utf8"),
    );
    if (keccak256(artifact.bytecode) !== expected.creationCodeHash)
      throw new Error(`Mismatched compiled artifact: ${name}`);
  }
  summary.status = "running";
  save();
  publish();
} catch (error) {
  summary.status = "failed-preflight";
  summary.error = error.message;
  summary.elapsedMs = Math.round(performance.now() - started);
  save();
  publish();
  console.error(`Stress preflight failed: ${error.message}`);
  process.exit(1);
}
console.log(`Stress run ${runId}`);

async function run(name) {
  const logPath = path.join(output, `v8-${name}-stress.log`);
  const descriptor = fs.openSync(logPath, "w");
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        "--test-timeout=900000",
        `test/stress/v8-${name}.stress.mjs`,
      ],
      {
        cwd: root,
        env: { ...process.env, STRESS_OUTPUT_DIR: output },
        stdio: ["ignore", descriptor, descriptor],
      },
    );
    let error;
    child.once("error", (e) => {
      error = e.message;
    });
    child.once("close", (code, signal) => {
      fs.closeSync(descriptor);
      resolve({ code, signal, error });
    });
  });
  let metrics;
  let parseError;
  const metricsPath = path.join(output, `v8-${name}-stress.json`);
  try {
    metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
  } catch (e) {
    parseError = e.message;
  }
  const passed = result.code === 0 && metrics?.success === true;
  summary.suites[name] = {
    passed,
    ...result,
    parseError,
    log: path.relative(root, logPath),
    metrics: path.relative(root, metricsPath),
  };
  save();
  console.log(
    `${name}: ${passed ? "PASS" : "FAIL"} — ${path.relative(root, logPath)}`,
  );
  return passed;
}

const passed = await Promise.allSettled(suites.map(run));
try {
  summary.sourceHashesUnchanged = files.every(
    (file) => sha(file) === sourceHashes[file],
  );
  summary.artifactHashesUnchanged = artifactFiles.every(
    (file) => sha(file) === artifactHashes[file],
  );
} catch (error) {
  summary.error = error.message;
}
summary.elapsedMs = Math.round(performance.now() - started);
summary.completedAt = new Date().toISOString();
summary.success =
  passed.every(
    (result) => result.status === "fulfilled" && result.value === true,
  ) &&
  summary.sourceHashesUnchanged &&
  summary.artifactHashesUnchanged;
summary.status = summary.success ? "passed" : "failed";
save();
publish();
console.log(
  `${summary.success ? "All stress suites passed" : "Stress failures recorded"} in ${(summary.elapsedMs / 1000).toFixed(1)}s`,
);
if (!summary.success) process.exitCode = 1;
