import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.length > 4 || (process.argv[3] && process.argv[3] !== "--mainnet-context"))
  throw new Error("Use a commit and optional --mainnet-context");
const sourceCommit = execFileSync(
  "git",
  ["rev-parse", "--verify", `${process.argv[2] ?? "HEAD"}^{commit}`],
  { cwd: root, encoding: "utf8" },
).trim();
const destination = path.join(root, ".runtime",
  process.argv[3] === "--mainnet-context" ? "mainnet-backend-context" : "hosted-backend-context");
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
for (const v9Path of ["scripts/compile-contracts-v9.mjs", "scripts/mainnet"]) {
  if (
    execFileSync("git", ["ls-tree", "--name-only", sourceCommit, "--", v9Path],
      { cwd: root, encoding: "utf8" }).trim()
  ) items.push(v9Path);
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
