import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startMainnetWalletDeploymentServer,
  verifyWalletDeploymentPlan,
  walletDeploymentApproval,
} from "../src/mainnet-wallet-deployment.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const flags = {};
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (
    ![
      "--review-only",
      "--serve",
      "--plan",
      "--port",
      "--enable-wallet-signing",
      "--approval-hash",
      "--rpc",
    ].includes(flag) ||
    Object.hasOwn(flags, flag)
  )
    throw new Error("Unknown or duplicate local deployment option");
  flags[flag] = [
    "--review-only",
    "--serve",
    "--enable-wallet-signing",
  ].includes(flag)
    ? true
    : process.argv[++i];
  if (!flags[flag]) throw new Error("Missing local deployment option value");
}
if (flags["--review-only"] && flags["--serve"])
  throw new Error("Choose review-only or serve");
if (
  !flags["--serve"] &&
  (flags["--enable-wallet-signing"] ||
    flags["--approval-hash"] ||
    flags["--rpc"] ||
    flags["--port"])
)
  throw new Error("Wallet/network options require explicit --serve");
const filename = path.resolve(
  ROOT,
  flags["--plan"] ??
    "artifacts/mainnet-release/user-2bb03593-four-create-proposed.json",
);
if (
  !filename.startsWith(
    path.join(ROOT, "artifacts/mainnet-release") + path.sep,
  ) ||
  !filename.endsWith(".json")
)
  throw new Error("Use a reviewed public plan under artifacts/mainnet-release");
const info = fs.lstatSync(filename);
if (
  !info.isFile() ||
  info.isSymbolicLink() ||
  info.size > 2 * 1024 * 1024 ||
  !fs
    .realpathSync(filename)
    .startsWith(
      fs.realpathSync(path.join(ROOT, "artifacts/mainnet-release")) + path.sep,
    )
)
  throw new Error(
    "The public plan must be a bounded regular file in the reviewed release directory",
  );
const plan = JSON.parse(fs.readFileSync(filename, "utf8"));
if (!flags["--serve"]) {
  verifyWalletDeploymentPlan(plan);
  console.log(
    JSON.stringify(
      {
        status: "review-only",
        ...walletDeploymentApproval(plan),
        chainId: 1,
        deployer: plan.deployer,
        setupTransactions: 4,
        eventCreationIncluded: false,
        maxTotalGasCostWei: plan.maxTotalGasCostWei,
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
} else {
  const port = Number(flags["--port"] ?? 8787);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid loopback port");
  const app = await startMainnetWalletDeploymentServer({
    plan,
    port,
    enableWalletSigning: flags["--enable-wallet-signing"] === true,
    approvalHash: flags["--approval-hash"],
    ...(flags["--rpc"] ? { rpcUrl: flags["--rpc"] } : {}),
  });
  console.log(
    JSON.stringify({
      status: "loopback-review-ready",
      origin: app.origin,
      signingEnabled: app.service.plan().signingEnabled,
      ...walletDeploymentApproval(plan),
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
