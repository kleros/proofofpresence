// Combine already-passed public observations and local gas evidence for human budget review only.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createV10WalletDeployment } from "../../src/v10-wallet-deployment.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PLAN = "artifacts/v10-release/user-2bb-nonce6-reviewed-account-proposed.json";
const PLAN_SHA = "2e525e6de33c768b7a592b075d002540447dea7fd5205716519cef5bc1bf0e37";
const PUBLIC = "artifacts/v10-release/preflight-2026-10-29T16-57-39.475Z-62d64915-72f8-416b-ad79-4841921f9533.json";
const PUBLIC_SHA = "21b84ada92099187e80de0a3f9af3c122eb5a74c077af7f3de58c8379498eca7";
const LOCAL = "artifacts/v10-integration/bundle/2026-10-29T16-52-27-140Z-78a7539c-5d32-4f4a-8bd8-d4c71b765070/proof.json";
const LOCAL_SHA = "d8b569a5675e247ee4ab3d716c3b7f96f4a7242bbe91a8203abd033a69e43022";
const REVIEW = "artifacts/v10-release/delegated-four-create-review.json";
const REVIEW_SHA = "8769e4c2663c1746e083428b0681c84c66e6de68daa93f0cd256376e7d9c5a14";
const sha = value => createHash("sha256").update(value).digest("hex");
const check = (ok, code) => { if (!ok) throw Object.assign(new Error("V10 wallet review stopped: " + code), { code }); };
function read(file, expected) {
  const absolute = path.join(ROOT, file), bytes = fs.readFileSync(absolute);
  check(fs.lstatSync(absolute).isFile() && fs.realpathSync(absolute) === absolute && sha(bytes) === expected, "PUBLIC_PROOF_CHANGED");
  return JSON.parse(bytes);
}
export async function main(argv = []) {
  if (!argv.length) return { status: "review-only", instruction: "--prepare-public-review", networkRequests: 0, privateFilesRead: 0, signatures: 0, broadcasts: 0 };
  check(argv.length === 1 && argv[0] === "--prepare-public-review", "EXPLICIT_REVIEW_REQUIRED");
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, PLAN))), observation = read(PUBLIC, PUBLIC_SHA), local = read(LOCAL, LOCAL_SHA);
  check(sha(JSON.stringify(plan)) === PLAN_SHA && plan.transactions.length === 4 && plan.deploymentAuthorized === false, "PLAN_CHANGED");
  check(observation.kind === "v10-readonly-preflight" && observation.status === "observed-only" && observation.blockers.length === 0 &&
    observation.planSha256 === PLAN_SHA && observation.account.infrastructureCreateSupportObserved === true &&
    observation.account.financialSupportEstablished === false && observation.deploymentAuthorized === false &&
    observation.targetObservations.length === 4 && observation.targetObservations.every(row => row.category === "empty-code-eoa" && row.nonce === "0"), "PUBLIC_PREFLIGHT_NOT_PASSED");
  const age = Date.now() - Date.parse(observation.completedAt);
  check(Number.isFinite(age) && age >= 0 && age <= 600000, "PUBLIC_OBSERVATION_STALE");
  check(local.status === "passed" && local.planSha256 === PLAN_SHA && local.environment === "fresh-loopback-anvil-prague-no-fork" &&
    local.publicNetworkRequests === 0 && local.userSignatureEstablished === false && local.localImpersonation === true &&
    local.localTransactions.length === 4 && local.localTransactions.every((tx, i) => tx.status === "confirmed" && tx.contract === plan.transactions[i].contract &&
      tx.address.toLowerCase() === plan.transactions[i].predictedAddress.toLowerCase() && tx.runtimeCodeHash === plan.transactions[i].expectedRuntimeCodeHash &&
      BigInt(tx.gasUsed) <= BigInt(plan.transactions[i].gasLimit) && BigInt(tx.estimatedGas) <= BigInt(plan.transactions[i].gasLimit)), "LOCAL_BUNDLE_NOT_PASSED");
  const service = createV10WalletDeployment({ plan, delegatedCreateReview: { file: REVIEW, sha256: REVIEW_SHA } });
  try {
    const review = service.plan(), sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    check(review.planSha256 === PLAN_SHA && review.signingEnabled === false, "BRIDGE_REVIEW_CHANGED");
    for (const [file, digest] of Object.entries(review.bridgeSources)) {
      const committed = execFileSync("git", ["show", sourceCommit + ":" + file], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
      check(sha(committed) === digest && sha(fs.readFileSync(path.join(ROOT, file))) === digest, "UNCOMMITTED_BRIDGE_SOURCE");
    }
    const measuredGas = local.localTransactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n),
      gasLimit = plan.transactions.reduce((sum, tx) => sum + BigInt(tx.gasLimit), 0n),
      cap = plan.transactions.reduce((sum, tx) => sum + BigInt(tx.gasLimit) * BigInt(tx.maxFeePerGasWei), 0n),
      quote = measuredGas * (BigInt(observation.fees.baseFeePerGasWei) + BigInt(plan.configuration.fees.maxPriorityFeePerGasWei));
    check(cap === BigInt(plan.maxTotalGasCostWei) && BigInt(observation.balanceWei) >= cap && quote <= cap, "BUDGET_MISMATCH");
    const result = { schemaVersion: 1, kind: "v10-infrastructure-human-budget-review", checkedAt: new Date().toISOString(),
      readyForHumanBudgetReview: true, scope: "four-direct-type2-create-infrastructure-only", sourceCommit,
      plan: { file: PLAN, canonicalSha256: PLAN_SHA, deployer: plan.deployer, chainId: 1, startingNonce: plan.startingNonce, addresses: plan.addresses },
      evidence: { publicPreflight: { file: PUBLIC, sha256: PUBLIC_SHA, sourceCommit: observation.sourceCommit, anchor: observation.anchor, completedAt: observation.completedAt },
        localBundle: { file: LOCAL, sha256: LOCAL_SHA, sourceCommit: local.sourceCommit }, delegatedCreateReview: { file: REVIEW, sha256: REVIEW_SHA } },
      gas: { measuredLocalGas: measuredGas.toString(), totalDeclaredGasLimit: gasLimit.toString(), maximumTotalCostWei: cap.toString(),
        maxFeePerGasWei: plan.configuration.fees.maxFeePerGasWei, maxPriorityFeePerGasWei: plan.configuration.fees.maxPriorityFeePerGasWei,
        indicativeCostAtObservedBasePlusChosenTipWei: quote.toString(), observedWalletBalanceWei: observation.balanceWei, budgetApproval: "NONE" },
      bridge: { approvalHash: review.approvalHash, bridgeSourceSha256: review.bridgeSourceSha256, sources: review.bridgeSources, signingEnabled: false, terms: review.terms },
      limits: ["The indicative cost combines isolated local gas with point-in-time public fees; it is not a guaranteed mainnet quote.",
        "Every wallet handoff must freshly recheck account/framework code, canonical head, nonce, unused address, balance, fees and exact gas estimate.",
        "This review authorizes no signing. The human must approve the exact new gas cap and sign each of the four direct CREATEs through their own wallet.",
        "Event creation, policy publication, automatic renunciation, V9 migration, app financial activation and hosting are outside this infrastructure review."],
      networkRequests: 0, privateFilesRead: 0, signatures: 0, broadcasts: 0, deploymentAuthorized: false, applicationFinancialSupport: false };
    const filename = "artifacts/v10-release/deployment-readiness-" + result.checkedAt.replaceAll(":", "-") + "-" + randomUUID() + ".json";
    const bytes = JSON.stringify(result, null, 2) + "\n"; fs.writeFileSync(path.join(ROOT, filename), bytes, { flag: "wx" });
    return { filename, sha256: sha(bytes), ...result };
  } finally { await service.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
  .then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error?.code ? error.message : "V10 wallet review stopped: LOCAL_REVIEW_FAILED"); process.exitCode = 1; });
