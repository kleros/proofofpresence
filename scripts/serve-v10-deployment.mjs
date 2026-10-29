// Dedicated public-plan V10 review bridge. Only explicit --serve permits a loopback listener/read RPC.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createV10WalletDeployment,
  startV10WalletDeploymentServer,
} from "../src/v10-wallet-deployment.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const flags = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (
    ![
      "--review-only",
      "--serve",
      "--plan",
      "--port",
      "--enable-wallet-signing",
      "--approval-hash",
      "--rpc",
      "--delegated-review",
      "--delegated-review-sha256",
      "--recovery-grant",
      "--recovery-grant-sha256",
    ].includes(key) ||
    Object.hasOwn(flags, key)
  )
    throw Error("Unknown or duplicate V10 review option");
  flags[key] = ["--review-only", "--serve", "--enable-wallet-signing"].includes(
    key,
  )
    ? true
    : process.argv[++i];
  if (
    !flags[key] ||
    (typeof flags[key] === "string" && flags[key].startsWith("--"))
  )
    throw Error("Missing V10 review option value");
}
if (flags["--review-only"] && flags["--serve"])
  throw Error("Choose review-only or serve");
if (
  !flags["--serve"] &&
  ["--enable-wallet-signing", "--approval-hash", "--rpc", "--port"].some(
    (k) => flags[k],
  )
)
  throw Error("Network or signing options require explicit --serve");
if (
  Boolean(flags["--enable-wallet-signing"]) !==
  Boolean(flags["--approval-hash"])
)
  throw Error(
    "Signing requires both the explicit flag and exact human approval hash",
  );
if (
  Boolean(flags["--delegated-review"]) !==
  Boolean(flags["--delegated-review-sha256"])
)
  throw Error("Supply both delegated review file and exact hash");
if (
  Boolean(flags["--recovery-grant"]) !==
  Boolean(flags["--recovery-grant-sha256"])
)
  throw Error("Supply both public recovery grant and exact SHA-256");
const filename = path.resolve(
  ROOT,
  flags["--plan"] ??
    "artifacts/v10-release/user-2bb-nonce6-reviewed-account-proposed.json",
);
const release = path.join(ROOT, "artifacts/v10-release") + path.sep;
if (!filename.startsWith(release) || !filename.endsWith(".json"))
  throw Error("Use the explicit public V10 plan");
const stat = fs.lstatSync(filename);
if (
  !stat.isFile() ||
  stat.isSymbolicLink() ||
  stat.size > 2 * 1024 * 1024 ||
  fs.realpathSync(filename) !== filename
)
  throw Error("Use a bounded regular nonsymlink public plan");
const options = {
  plan: JSON.parse(fs.readFileSync(filename, "utf8")),
  ...(flags["--delegated-review"]
    ? {
        delegatedCreateReview: {
          file: flags["--delegated-review"],
          sha256: flags["--delegated-review-sha256"],
        },
      }
    : {}),
};
if (flags["--recovery-grant"]) {
  const target = path.resolve(ROOT, flags["--recovery-grant"]),
    stat = fs.lstatSync(target);
  if (
    !target.startsWith(release) ||
    !target.endsWith(".json") ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 16384 ||
    fs.realpathSync(target) !== target ||
    !/^[a-f0-9]{64}$/.test(flags["--recovery-grant-sha256"])
  )
    throw Error("Use the exact bounded public recovery grant");
  const bytes = fs.readFileSync(target);
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    flags["--recovery-grant-sha256"]
  )
    throw Error("The reviewed recovery grant changed");
  options.lostPageRecoveryGrant = JSON.parse(bytes);
}
if (!flags["--serve"]) {
  const service = createV10WalletDeployment(options),
    review = service.plan();
  console.log(
    JSON.stringify(
      {
        status: "review-only",
        ...review,
        networkRequests: 0,
        journalWrites: 0,
        privateSigningFilesRead: 0,
        signatures: 0,
        broadcasts: 0,
      },
      null,
      2,
    ),
  );
  await service.close();
} else {
  const port = Number(flags["--port"] ?? 8788);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid V10 loopback port");
  const app = await startV10WalletDeploymentServer({
    ...options,
    port,
    enableWalletSigning: flags["--enable-wallet-signing"] === true,
    approvalHash: flags["--approval-hash"],
    ...(flags["--rpc"] ? { rpcUrl: flags["--rpc"] } : {}),
  });
  const review = app.service.plan();
  console.log(
    JSON.stringify({
      status: "v10-loopback-review-ready",
      origin: app.origin,
      planSha256: review.planSha256,
      approvalHash: review.approvalHash,
      bridgeSourceSha256: review.bridgeSourceSha256,
      delegatedCreateReview: review.delegatedCreateReview,
      signingEnabled: review.signingEnabled,
      backendSigners: 0,
      backendBroadcastCapability: false,
    }),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
