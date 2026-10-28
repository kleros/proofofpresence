import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist/netlify-app");
await fs.rm(output, { recursive: true, force: true });
await fs.cp(path.join(root, "public"), output, { recursive: true });
await fs.writeFile(
  path.join(output, "_headers"),
  "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: SAMEORIGIN\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'\n",
);
console.log(
  "Built interactive frontend; financial API requires the configured persistent demo backend.",
);
