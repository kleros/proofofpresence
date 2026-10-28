import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
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
  "references/kickback/scripts",
  "references/kickback/contracts",
  "references/kickback/abi",
  "references/kickback/site/index.html",
  "references/kickback/console/index.html",
  "references/kickback/docs/metaevidence.event-v1.template.json",
];
for (const file of await fs.readdir(
  path.join(root, "references/kickback/test"),
))
  if (file.endsWith(".sol")) items.push(`references/kickback/test/${file}`);
for (const item of items) {
  await fs.mkdir(path.dirname(path.join(destination, item)), {
    recursive: true,
  });
  await fs.cp(path.join(root, item), path.join(destination, item), {
    recursive: true,
  });
}
console.log(`Prepared whitelisted backend context: ${destination}`);
console.log(
  "No user attachments, environment files, original live configs, runtime data or Git history included.",
);
