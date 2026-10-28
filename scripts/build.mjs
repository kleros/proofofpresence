import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const v7 = JSON.parse(
  fs.readFileSync(
    new URL(
      "../references/kickback/abi/v7/TruthPaysKickback.json",
      import.meta.url,
    ),
  ),
);
const built = JSON.parse(
  fs.readFileSync(
    new URL(
      "../references/kickback/build/TruthPaysKickback.json",
      import.meta.url,
    ),
  ),
);
if (JSON.stringify(v7) !== JSON.stringify(built))
  throw new Error(
    "Compiled contract diverges from pinned v7. Create a new explicit version; do not overwrite historical ABI.",
  );
for (const file of [
  "src/server.mjs",
  "src/chain.mjs",
  "src/workbench.mjs",
  "src/imports.mjs",
  "public/app.js",
])
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
for (const file of ["public/index.html", "public/styles.css"])
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync(
  "artifacts/build-manifest.json",
  JSON.stringify(
    {
      contractVersion: "truth-pays-v7",
      sourceCommit: "57fc1c8233c60e31c1b5988c631ef57d7c3f1b81",
      contractSha256: createHash("sha256")
        .update(
          fs.readFileSync(
            "references/kickback/contracts/TruthPaysKickback.sol",
          ),
        )
        .digest("hex"),
      abiSha256: createHash("sha256")
        .update(JSON.stringify(v7.abi))
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Build verified: static app, Node modules, pinned v7 ABI + bytecode match.",
);
