import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
if (
  process.argv.length > 4 ||
  (process.argv[3] && process.argv[3] !== "--mainnet-context")
)
  throw new Error("Use a commit and optional --mainnet-context");
const sourceCommit = execFileSync(
  "git",
  ["rev-parse", "--verify", `${process.argv[2] ?? "HEAD"}^{commit}`],
  { cwd: root, encoding: "utf8" },
).trim();
const destination = path.join(
  root,
  ".runtime",
  process.argv[3] === "--mainnet-context"
    ? "mainnet-backend-context"
    : "hosted-backend-context",
);
await fs.rm(destination, { recursive: true, force: true });
await fs.mkdir(destination, { recursive: true });
const items = [
  "Dockerfile",
  ".dockerignore",
  "package.json",
  "package-lock.json",
  "src",
  "public",
  "scripts/build.mjs",
  "scripts/compile-contracts.mjs",
  "scripts/compile-contracts-test15m.mjs",
  "scripts/generate-contracts-test15m.mjs",
  "contracts",
  "references/kickback/scripts",
  "references/kickback/contracts",
  "references/kickback/abi",
  "references/kickback/site/index.html",
  "references/kickback/console/index.html",
  "references/kickback/docs/metaevidence.event-v1.template.json",
];
// Historical rehearsal checkpoints predate V9. Include only these reviewed
// public build/runtime paths when present in the selected immutable commit.
for (const v9Path of [
  "scripts/compile-contracts-v9.mjs",
  "scripts/compile-contracts-v10.mjs",
  "scripts/mainnet",
]) {
  if (
    execFileSync(
      "git",
      ["ls-tree", "--name-only", sourceCommit, "--", v9Path],
      { cwd: root, encoding: "utf8" },
    ).trim()
  )
    items.push(v9Path);
}
// The V10 account policy reads these public source/evidence bytes for exact hash
// checks. They are never imported as runtime test code and contain no wallet keys.
if (
  execFileSync(
    "git",
    [
      "ls-tree",
      "--name-only",
      sourceCommit,
      "--",
      "src/v10-production-wallets.mjs",
    ],
    { cwd: root, encoding: "utf8" },
  ).trim()
) {
  for (const file of [
    "artifacts/v10-integration/metamask-source-verification-6ea176ca-3ea1-49eb-a290-1013d6492a15.json",
    "artifacts/v10-integration/eip7702/2026-10-29T16-40-03.581Z-d5123ece-de5d-4d69-a5a0-1d5a2236535c/proof.json",
    "artifacts/v10-integration/type4-protected/2026-10-29T17-19-46.899Z-0d5838d5-4291-4ba5-990d-e72bba6a65e8/proof.json",
    "artifacts/v10-integration/metamask-runtime-observed.json",
    "scripts/verify-metamask-v1.3-runtime.mjs",
    "test/v10-eip7702.e2e.mjs",
    "test/v10-type4-protected.e2e.mjs",
  ]) {
    if (
      !execFileSync(
        "git",
        ["ls-tree", "--name-only", sourceCommit, "--", file],
        { cwd: root, encoding: "utf8" },
      ).trim()
    )
      throw new Error(`Missing pinned public V10 runtime evidence: ${file}`);
    items.push(file);
  }
}
for (const registryFile of [
  "registry/chiado-v8-controlled.json",
  "registry/chiado-v8-ui-c.json",
  "registry/chiado-v8-ui-d.json",
  "registry/ethereum-v9-luma-mainnet.json",
]) {
  if (
    execFileSync(
      "git",
      ["ls-tree", "--name-only", sourceCommit, "--", registryFile],
      { cwd: root, encoding: "utf8" },
    ).trim()
  )
    items.push(registryFile);
}
const tracked = execFileSync(
  "git",
  [
    "ls-tree",
    "-r",
    "--name-only",
    sourceCommit,
    "--",
    "references/kickback/test",
  ],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n");
items.push(...tracked.filter((file) => file.endsWith(".sol")));
const archive = execFileSync(
  "git",
  ["archive", "--format=tar", sourceCommit, "--", ...items],
  { cwd: root, maxBuffer: 20_000_000 },
);
execFileSync("tar", ["-x", "-C", destination], { input: archive });
// Docker COPY requires the directory even before a public testnet manifest exists.
await fs.mkdir(path.join(destination, "registry"), { recursive: true });
console.log(
  `Prepared whitelisted backend context from ${sourceCommit}: ${destination}`,
);
console.log(
  "No user attachments, environment files, original live configs, runtime data or Git history included.",
);
