// Offline immutable frontend packaging only. Never links a site, builds HEAD or deploys.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const V10_FRONTEND_HEADERS =
  "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: SAMEORIGIN\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://api.web3modal.org; font-src 'self'; connect-src 'self' https://api.web3modal.org https://rpc.walletconnect.org https://verify.walletconnect.org wss://relay.walletconnect.org; frame-src 'self' https://verify.walletconnect.org; frame-ancestors 'self'; base-uri 'self'; form-action 'self'\n";
const check = (ok, message) => {
  if (!ok) throw Error(message);
};

/** root is a trusted offline fixture option, never environment or HTTP input. */
export async function prepareV10Frontend(sourceCommit, { root = ROOT } = {}) {
  check(
    typeof sourceCommit === "string" && /^[a-f0-9]{40}$/.test(sourceCommit),
    "Supply one explicit full Git commit; HEAD and working-tree packaging are unavailable",
  );
  const git = (args) =>
    execFileSync("git", args, { cwd: root, maxBuffer: 32_000_000 });
  check(
    git(["rev-parse", "--verify", `${sourceCommit}^{commit}`])
      .toString()
      .trim() === sourceCommit,
    "The exact source commit is unavailable",
  );
  const destination = path.join(
    root,
    ".runtime/mainnet-v10",
    `frontend-context-${sourceCommit}`,
  );
  try {
    await fs.lstat(destination);
    throw Error(
      "This immutable V10 frontend context already exists; reuse or inspect it without resetting it",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const selected = ["public", "netlify/functions", "netlify.toml"];
  const entries = git([
    "ls-tree",
    "-r",
    "--full-tree",
    sourceCommit,
    "--",
    ...selected,
  ])
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      check(match, "Frontend archive requires regular tracked files only");
      const filename = match[3];
      check(
        !filename
          .split("/")
          .some(
            (part) =>
              [".git", ".runtime", "node_modules"].includes(part) ||
              part.startsWith(".env"),
          ),
        "Runtime, environment, Git and dependency directories are excluded",
      );
      return filename;
    });
  for (const required of [
    "public/index.html",
    "netlify/functions/workbench.mjs",
    "netlify.toml",
  ])
    check(
      entries.includes(required),
      `Missing source-bound frontend file: ${required}`,
    );
  const sourceConfig = git(["show", `${sourceCommit}:netlify.toml`]).toString();
  let build = false;
  const config = sourceConfig
    .split("\n")
    .filter((line) => {
      if (/^\s*\[/.test(line)) build = /^\s*\[build\]\s*$/.test(line);
      return !(build && /^\s*command\s*=/.test(line));
    })
    .join("\n");
  const section =
    /^\[build\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(config)?.[1] ?? "";
  check(
    /^\s*publish\s*=\s*"dist\/netlify-app"\s*$/m.test(section) &&
      /^\s*functions\s*=\s*"netlify\/functions"\s*$/m.test(section) &&
      !/^\s*command\s*=/m.test(config),
    "Use the reviewed publish/functions paths without a build command",
  );
  const sourceHashes = {};
  for (const filename of entries) {
    const bytes = git(["show", `${sourceCommit}:${filename}`]);
    sourceHashes[filename] = sha256(bytes);
    if (
      filename.startsWith("netlify/functions/") &&
      /\.[cm]?js$/.test(filename)
    ) {
      const text = bytes.toString();
      for (const match of text.matchAll(
        /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\()\s*["']([^"']+)["']/g,
      )) {
        const name = match[1];
        if (name.startsWith("node:")) continue;
        check(
          name.startsWith("."),
          "Gateway gained an external dependency; review package/lock bundling before release",
        );
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(filename), name),
        );
        check(
          resolved.startsWith("netlify/functions/") &&
            entries.includes(resolved),
          "Gateway imports must stay within the same source-bound function archive",
        );
      }
    }
  }
  const archive = git([
    "archive",
    "--format=tar",
    sourceCommit,
    "--",
    ...selected,
  ]);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination); // Atomic no-overwrite guard, including concurrent invocations.
  execFileSync("tar", ["-x", "-C", destination], { input: archive });
  for (const filename of entries)
    check(
      sha256(await fs.readFile(path.join(destination, filename))) ===
        sourceHashes[filename],
      "Archived frontend bytes differ from their source commit",
    );
  await fs.mkdir(path.join(destination, "dist"));
  await fs.rename(
    path.join(destination, "public"),
    path.join(destination, "dist/netlify-app"),
  );
  await fs.writeFile(
    path.join(destination, "dist/netlify-app/_headers"),
    V10_FRONTEND_HEADERS,
  );
  await fs.writeFile(path.join(destination, "netlify.toml"), config);
  const manifest = {
    schemaVersion: 1,
    kind: "v10-frontend-context",
    sourceCommit,
    publish: "dist/netlify-app",
    functions: "netlify/functions",
    buildCommand: null,
    sourceHashes,
    generatedHeadersSha256: sha256(V10_FRONTEND_HEADERS),
    sourceConfigSha256: sha256(sourceConfig),
    effectiveConfigSha256: sha256(config),
    packageDependencies: [],
    deploymentPerformed: false,
  };
  const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
  await fs.writeFile(
    path.join(destination, "frontend-context.json"),
    manifestBytes,
  );
  return {
    contextPath: destination,
    manifestSha256: sha256(manifestBytes),
    ...manifest,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.length === 2)
    console.log(
      JSON.stringify({
        status: "review-only",
        usage: "node scripts/prepare-v10-frontend.mjs FULL_COMMIT",
        contextWrites: 0,
        networkRequests: 0,
        deployments: 0,
      }),
    );
  else {
    check(
      process.argv.length === 3,
      "Supply only one explicit full source commit",
    );
    const prepared = await prepareV10Frontend(process.argv[2]);
    console.log(
      JSON.stringify({
        status: "v10-frontend-context-ready",
        contextPath: prepared.contextPath,
        sourceCommit: prepared.sourceCommit,
        publish: prepared.publish,
        functions: prepared.functions,
        manifestSha256: prepared.manifestSha256,
        cliArguments: [
          "--dir",
          prepared.publish,
          "--functions",
          prepared.functions,
          "--no-build",
        ],
        networkRequests: 0,
        deployments: 0,
      }),
    );
  }
}
