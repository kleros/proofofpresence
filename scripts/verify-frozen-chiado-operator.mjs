// Read-only preservation check. Never opens keys, plans, journals or the network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const commit = "d4068ec24abc5494c699eb0b4b6a73c5b57c868c";
const frozen = path.join(root, ".runtime/operator-frozen-d4068ec");
const scopes = [
  "src", "public", "scripts", "test", "contracts", "registry",
  "package.json", "package-lock.json", "references/kickback/scripts",
  "references/kickback/contracts", "references/kickback/test",
  "references/kickback/abi", "references/kickback/docs/metaevidence.event-v1.template.json",
];
assert.equal(fs.realpathSync(frozen), frozen);
const entries = execFileSync("git", ["ls-tree", "-r", "-z", commit, "--", ...scopes],
  { cwd: root, maxBuffer: 10_000_000 }).toString().split("\0").filter(Boolean);
for (const entry of entries) {
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
  assert.ok(match, "Frozen source must contain only regular Git blobs");
  const filename = path.join(frozen, match[3]);
  assert.ok(fs.lstatSync(filename).isFile() && !fs.lstatSync(filename).isSymbolicLink());
  const bytes = fs.readFileSync(filename);
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(blob, match[2], `Frozen source changed: ${match[3]}`);
}
for (const name of [".runtime", "artifacts", "build", "node_modules", "references/kickback/build"]) {
  assert.ok(fs.lstatSync(path.join(frozen, name)).isSymbolicLink());
  assert.equal(fs.realpathSync(path.join(frozen, name)), fs.realpathSync(path.join(root, name)));
}
for (const filename of ["registry/chiado-v8-controlled.json", "registry/chiado-v8-ui-c.json"]) {
  assert.deepEqual(fs.readFileSync(path.join(root, filename)), fs.readFileSync(path.join(frozen, filename)),
    "Existing A/B/C manifest changed; review required");
}
console.log(JSON.stringify({ status: "passed-read-only", sourceCommit: commit, frozenRoot: frozen,
  sourceFilesVerified: entries.length, sharedCanonicalRuntimeAndProofs: true,
  signingFilesRead: 0, signatures: 0, broadcasts: 0 }));
