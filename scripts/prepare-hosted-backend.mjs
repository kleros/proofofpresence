import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const sourceCommit = execFileSync(
  "git",
  ["rev-parse", "--verify", `${process.argv[2] ?? "HEAD"}^{commit}`],
  { cwd: root, encoding: "utf8" },
).trim();
const destination = path.join(root, ".runtime/hosted-backend-context");
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
for (const registryFile of [
  "registry/chiado-v8-controlled.json",
  "registry/chiado-v8-ui-c.json",
  "registry/chiado-v8-ui-d.json",
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
