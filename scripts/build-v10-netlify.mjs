// Git-based V10 frontend build only. No chain, backend, credentials or deployment.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { V10_FRONTEND_HEADERS } from "./prepare-v10-frontend.mjs";
import { verifyV10Frontend } from "./verify-v10-frontend.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export async function buildV10Netlify({ root = ROOT } = {}) {
  for (const file of ["public/index.html", "public/first-event/index.html",
    "public/vendor/walletconnect/2.26.0/walletconnect.bundle.js", "netlify/functions/workbench.mjs"]) {
    if (!(await fs.stat(path.join(root, file))).isFile()) throw Error(`Missing production frontend file: ${file}`);
  }
  // Keep the previous build intact when source syntax or local dependencies fail.
  await verifyV10Frontend({ root });
  const output = path.join(root, "dist/netlify-app");
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(path.join(root, "public"), output, { recursive: true });
  await fs.writeFile(path.join(output, "_headers"), V10_FRONTEND_HEADERS);
  return { publish: "dist/netlify-app", functions: "netlify/functions" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw Error("Use node scripts/build-v10-netlify.mjs without arguments.");
  const result = await buildV10Netlify();
  console.log(`Built production V10 frontend: ${result.publish}; gateway: ${result.functions}.`);
}
