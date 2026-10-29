// Read-only observations for the four unsigned V10 CREATE proposals. Never a signing approval.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { ethers } from "ethers";
import {
  prepareV10Release,
  verifyV10Build,
  V10_PROFILE,
  V10_CONTRACT_NAMES,
} from "./prepare-v10-release.mjs";
import { METAMASK_V130 } from "../../src/v10-wallet-compatibility.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const V10_PREFLIGHT_DEPLOYER = ethers.getAddress(
  "0x2bb03593892724d225071068e59ab1e48af05b55",
);
const READ_METHODS = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_getBalance",
  "eth_maxPriorityFeePerGas",
]);
const sha = (value) => createHash("sha256").update(value).digest("hex");
class PreflightError extends Error {
  constructor(code) {
    super("V10 read-only preflight stopped: " + code);
    this.code = code;
  }
}
const check = (condition, code) => {
  if (!condition) throw new PreflightError(code);
};
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const commit = (value) =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function quantity(value) {
  check(
    typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value),
    "INVALID_RPC_QUANTITY",
  );
  const result = BigInt(value);
  check(result < 2n ** 256n, "INVALID_RPC_QUANTITY");
  return result;
}
function header(value) {
  check(
    value && /^0x[0-9a-f]{64}$/i.test(value.hash ?? ""),
    "INVALID_RPC_HEADER",
  );
  const number = quantity(value.number),
    timestamp = quantity(value.timestamp),
    baseFee = quantity(value.baseFeePerGas);
  check(
    number <= BigInt(Number.MAX_SAFE_INTEGER) &&
      timestamp <= BigInt(Number.MAX_SAFE_INTEGER),
    "INVALID_RPC_HEADER",
  );
  return {
    number: Number(number),
    hash: value.hash.toLowerCase(),
    timestamp: Number(timestamp),
    baseFeePerGasWei: baseFee.toString(),
  };
}
function codeCategory(code) {
  check(
    typeof code === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(code),
    "INVALID_RPC_CODE",
  );
  return code === "0x"
    ? "empty-code-eoa"
    : /^0xef0100[0-9a-f]{40}$/i.test(code)
      ? "eip7702-delegated"
      : "contract-code";
}

const REVIEW_FILES = Object.freeze({
  sourceScript: "scripts/verify-metamask-v1.3-runtime.mjs",
  harness: "test/v10-eip7702.e2e.mjs",
  compatibility: "src/v10-wallet-compatibility.mjs",
  observedRuntime: "artifacts/v10-integration/metamask-runtime-observed.json",
});
const FRAMEWORK = Object.freeze({
  manager: METAMASK_V130.manager,
  delegate: METAMASK_V130.delegate,
  nativeBalanceEnforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
});
const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
function reviewedFile(root, filename, expectedSha) {
  check(
    typeof filename === "string" && digest(expectedSha),
    "INVALID_DELEGATED_CREATE_REVIEW",
  );
  const base = path.resolve(root),
    full = path.resolve(base, filename);
  check(
    full.startsWith(base + path.sep) &&
      fs.lstatSync(full).isFile() &&
      fs.realpathSync(full) === full,
    "INVALID_DELEGATED_CREATE_REVIEW",
  );
  const bytes = fs.readFileSync(full);
  check(sha(bytes) === expectedSha, "DELEGATED_CREATE_PROOF_HASH_MISMATCH");
  return bytes;
}
// Trusted local proof pins, never a wallet/request/manifest financial-eligibility override.
export function validateDelegatedV10CreateReview(
  review,
  { build, root = ROOT } = {},
) {
  try {
    check(
      exactKeys(review, [
        "sourceProof",
        "protocolProof",
        "sourceScriptSha256",
        "harnessSha256",
        "compatibilitySha256",
        "observedRuntimeSha256",
      ]),
      "INVALID_DELEGATED_CREATE_REVIEW",
    );
    check(
      exactKeys(review.sourceProof, ["file", "sha256"]) &&
        exactKeys(review.protocolProof, ["file", "sha256"]) &&
        /^artifacts\/v10-integration\/metamask-source-verification-[a-f0-9-]+\.json$/.test(
          review.sourceProof.file,
        ) &&
        /^artifacts\/v10-integration\/eip7702\/[A-Za-z0-9.-]+\/proof\.json$/.test(
          review.protocolProof.file,
        ),
      "INVALID_DELEGATED_CREATE_REVIEW",
    );
    const source = JSON.parse(
        reviewedFile(root, review.sourceProof.file, review.sourceProof.sha256),
      ),
      protocol = JSON.parse(
        reviewedFile(
          root,
          review.protocolProof.file,
          review.protocolProof.sha256,
        ),
      );
    for (const [name, file] of Object.entries(REVIEW_FILES))
      reviewedFile(root, file, review[`${name}Sha256`]);
    const observed = JSON.parse(
      reviewedFile(
        root,
        REVIEW_FILES.observedRuntime,
        review.observedRuntimeSha256,
      ),
    );
    check(
      source.kind === "metamask-v1.3-source-runtime-verification" &&
        source.schemaVersion === 1 &&
        source.chainId === 1 &&
        source.status === "verified" &&
        source.sourceVerified === true &&
        source.financialEligible === false &&
        source.officialSourceCommit ===
          "bfbdf9795a976833ed2fa000baf42fbb83958b03" &&
        source.contracts?.length === 3,
      "DELEGATED_CREATE_SOURCE_NOT_VERIFIED",
    );
    check(
      protocol.kind === "v10-eip7702-local-protocol-custody" &&
        protocol.schemaVersion === 1 &&
        protocol.passed === true &&
        protocol.chainId === 1 &&
        protocol.environment === "fresh-loopback-anvil-prague-no-fork" &&
        protocol.publicNetworkRequests === 0 &&
        protocol.keysPersisted === false &&
        protocol.walletCodeFixtureShortcut === false &&
        protocol.result?.actualType4 === true &&
        protocol.result.directSetupCreates === 4 &&
        protocol.result.financialEligibility === false &&
        protocol.anvil?.version === "1.7.1" &&
        protocol.anvil.hardfork === "prague" &&
        protocol.anvil.noFork === true &&
        protocol.source?.harnessSha256 === review.harnessSha256 &&
        protocol.source.compatibilitySha256 === review.compatibilitySha256 &&
        protocol.source.observedRuntimeFileSha256 ===
          review.observedRuntimeSha256 &&
        protocol.source.v10BuildManifestSha256 === build.buildManifestSha256 &&
        protocol.source.v10StandardInputSha256 === build.standardInputSha256 &&
        observed.chainId === 1 &&
        observed.contracts?.length === 3 &&
        protocol.fixtures?.length === 3,
      "DELEGATED_CREATE_PROTOCOL_NOT_VERIFIED",
    );
    const creates = protocol.transactions?.filter((tx) =>
      /^delegated authority direct CREATE /.test(tx.label ?? ""),
    );
    check(
      creates?.length === 4 &&
        creates.every(
          (tx, i) =>
            tx.type === 2 &&
            tx.status === 1 &&
            tx.to === null &&
            tx.valueWei === "0" &&
            tx.label ===
              [
                "delegated authority direct CREATE controller",
                "delegated authority direct CREATE event implementation",
                "delegated authority direct CREATE factory implementation",
                "delegated authority direct CREATE factory proxy",
              ][i],
        ) &&
        protocol.transactions.some((tx) => tx.type === 4 && tx.status === 1),
      "DELEGATED_CREATE_PROTOCOL_NOT_VERIFIED",
    );
    const framework = Object.entries(FRAMEWORK).map(([name, address]) => {
      const s = source.contracts.filter((x) => x.name === name),
        p = protocol.fixtures.filter((x) => x.name === name),
        o = observed.contracts.filter((x) => x.name === name);
      check(
        s.length === 1 &&
          p.length === 1 &&
          o.length === 1 &&
          [s[0], p[0], o[0]].every(
            (x) => ethers.getAddress(x.address) === address,
          ) &&
          s[0].sourceVerified === true &&
          s[0].compiledTemplateMatches === true &&
          s[0].fullObservedRuntimeMatches === true &&
          s[0].actualObservedChain === 1 &&
          s[0].crossChainAddressAssumptionUsed === false &&
          /^0x[0-9a-f]{64}$/.test(s[0].runtimeCodeHash) &&
          s[0].runtimeCodeHash === p[0].codeHash &&
          p[0].codeHash === o[0].codeHash &&
          ethers.keccak256(o[0].code) === p[0].codeHash,
        "DELEGATED_CREATE_FRAMEWORK_PIN_MISMATCH",
      );
      return { name, address, codeHash: s[0].runtimeCodeHash };
    });
    return {
      scope: "four-direct-type2-create-infrastructure-only",
      walletDesignation: ethers.concat(["0xef0100", METAMASK_V130.delegate]),
      framework,
      sourceProofSha256: review.sourceProof.sha256,
      protocolProofSha256: review.protocolProof.sha256,
      sourceScriptSha256: review.sourceScriptSha256,
      harnessSha256: review.harnessSha256,
      compatibilitySha256: review.compatibilitySha256,
      applicationFinancialSupport: false,
      wrappedExecutionSupported: false,
    };
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    throw new PreflightError("INVALID_DELEGATED_CREATE_REVIEW");
  }
}
export function validateDelegatedCreateReview(review, build) {
  return validateDelegatedV10CreateReview(review, { build });
}
export function loadDelegatedCreateReview(filename, expectedSha256, build) {
  const full = path.resolve(ROOT, filename);
  check(
    path.dirname(full) === path.join(ROOT, "artifacts/v10-release") &&
      /^[a-z0-9-]+\.json$/.test(path.basename(full)),
    "INVALID_DELEGATED_CREATE_REVIEW",
  );
  const review = JSON.parse(
    reviewedFile(ROOT, path.relative(ROOT, full), expectedSha256),
  );
  return {
    review,
    facts: validateDelegatedCreateReview(review, build),
    sha256: expectedSha256,
  };
}

/** Pure scope/build gate. A caller cannot replace the four exact planner transactions. */
export function validateV10PreflightPlan(
  plan,
  { build, sourceCommit, expectedSourceCommit, expectedPlanSha256 } = {},
) {
  check(
    commit(sourceCommit) && sourceCommit === expectedSourceCommit,
    "SOURCE_MISMATCH",
  );
  check(
    digest(expectedPlanSha256) &&
      sha(JSON.stringify(plan)) === expectedPlanSha256,
    "PLAN_HASH_MISMATCH",
  );
  let rebuilt;
  try {
    rebuilt = prepareV10Release(plan?.configuration, build);
  } catch {
    throw new PreflightError("PLAN_BUILD_MISMATCH");
  }
  check(isDeepStrictEqual(plan, rebuilt), "PLAN_BUILD_MISMATCH");
  check(
    plan.deployer === V10_PREFLIGHT_DEPLOYER &&
      plan.governance.initialOwner === V10_PREFLIGHT_DEPLOYER,
    "DEPLOYER_MISMATCH",
  );
  check(
    plan.chainId === 1 &&
      plan.contractVersion === V10_PROFILE &&
      plan.transactions.length === 4,
    "PLAN_SCOPE_MISMATCH",
  );
  check(
    plan.transactions.every(
      (tx, i) =>
        tx.to === null &&
        tx.value === "0" &&
        tx.chainId === 1 &&
        tx.type === 2 &&
        tx.from === V10_PREFLIGHT_DEPLOYER &&
        tx.contract === V10_CONTRACT_NAMES[i] &&
        tx.nonce === plan.startingNonce + i,
    ),
    "CREATE_SCOPE_MISMATCH",
  );
  return structuredClone(plan);
}

/** Inject a read-only EIP-1193 transport. Calls are serial; no provider signer/send interface is used. */
export async function inspectV10Preflight({
  plan,
  build,
  rpc,
  historicalCodeRpc = null,
  delegatedCreateReview = null,
  proofRoot = ROOT,
  sourceCommit,
  expectedSourceCommit,
  expectedPlanSha256,
  paceMs = 1500,
} = {}) {
  const reviewed = validateV10PreflightPlan(plan, {
    build,
    sourceCommit,
    expectedSourceCommit,
    expectedPlanSha256,
  });
  const delegated =
    delegatedCreateReview === null
      ? null
      : validateDelegatedV10CreateReview(delegatedCreateReview, {
          build,
          root: proofRoot,
        });
  check(
    rpc &&
      typeof rpc.request === "function" &&
      Number.isFinite(paceMs) &&
      paceMs >= 0 &&
      paceMs <= 10000,
    "INVALID_READ_TRANSPORT",
  );
  check(
    historicalCodeRpc === null ||
      typeof historicalCodeRpc.request === "function",
    "INVALID_READ_TRANSPORT",
  );
  let reads = 0,
    lastReadAt = 0;
  const read = async (method, params, transport = null) => {
    check(READ_METHODS.has(method), "FORBIDDEN_RPC_METHOD");
    const remaining = paceMs - (Date.now() - lastReadAt);
    if (remaining > 0)
      await new Promise((resolve) => setTimeout(resolve, remaining));
    lastReadAt = Date.now();
    reads++;
    const selected =
      transport ??
      (historicalCodeRpc &&
      method === "eth_getCode" &&
      /^0x[0-9a-f]+$/i.test(params[1])
        ? historicalCodeRpc
        : rpc);
    try {
      return await selected.request({ method, params });
    } catch {
      throw new PreflightError("RPC_READ_FAILED");
    }
  };
  check(quantity(await read("eth_chainId", [])) === 1n, "WRONG_CHAIN");
  if (historicalCodeRpc)
    check(
      quantity(await read("eth_chainId", [], historicalCodeRpc)) === 1n,
      "WRONG_CHAIN",
    );
  const first = header(await read("eth_getBlockByNumber", ["latest", false]));
  const tag = "0x" + first.number.toString(16);
  const firstCode = await read("eth_getCode", [V10_PREFLIGHT_DEPLOYER, tag]);
  codeCategory(firstCode);
  const initialFramework = [];
  if (delegated)
    for (const item of delegated.framework) {
      const code = await read("eth_getCode", [item.address, tag]);
      codeCategory(code);
      initialFramework.push(code);
    }
  const pinnedNonce = quantity(
    await read("eth_getTransactionCount", [V10_PREFLIGHT_DEPLOYER, tag]),
  );
  const latestNonce = quantity(
    await read("eth_getTransactionCount", [V10_PREFLIGHT_DEPLOYER, "latest"]),
  );
  const pendingNonce = quantity(
    await read("eth_getTransactionCount", [V10_PREFLIGHT_DEPLOYER, "pending"]),
  );
  const balance = quantity(
    await read("eth_getBalance", [V10_PREFLIGHT_DEPLOYER, tag]),
  );
  const firstTargets = [];
  for (const tx of reviewed.transactions)
    firstTargets.push(
      codeCategory(await read("eth_getCode", [tx.predictedAddress, tag])),
    );

  // A second, explicitly pinned view catches account/nonce changes during the earlier reads.
  const final = header(await read("eth_getBlockByNumber", ["latest", false]));
  check(final.number >= first.number, "HEAD_REGRESSED");
  const finalTag = "0x" + final.number.toString(16);
  const finalCode = await read("eth_getCode", [
    V10_PREFLIGHT_DEPLOYER,
    finalTag,
  ]);
  const category = codeCategory(finalCode);
  const finalFramework = [];
  if (delegated)
    for (const item of delegated.framework) {
      const code = await read("eth_getCode", [item.address, finalTag]);
      codeCategory(code);
      finalFramework.push(code);
    }
  const finalPinnedNonce = quantity(
    await read("eth_getTransactionCount", [V10_PREFLIGHT_DEPLOYER, finalTag]),
  );
  const finalLatestNonce = quantity(
    await read("eth_getTransactionCount", [V10_PREFLIGHT_DEPLOYER, "latest"]),
  );
  const finalPendingNonce = quantity(
    await read("eth_getTransactionCount", [V10_PREFLIGHT_DEPLOYER, "pending"]),
  );
  const finalBalance = quantity(
    await read("eth_getBalance", [V10_PREFLIGHT_DEPLOYER, finalTag]),
  );
  const targetObservations = [];
  for (const tx of reviewed.transactions)
    targetObservations.push({
      contract: tx.contract,
      address: tx.predictedAddress,
      category: codeCategory(
        await read("eth_getCode", [tx.predictedAddress, finalTag]),
      ),
      nonce: quantity(
        await read("eth_getTransactionCount", [tx.predictedAddress, finalTag]),
      ).toString(),
    });
  const priorityFee = quantity(await read("eth_maxPriorityFeePerGas", []));
  const firstCanonical = header(
    await read("eth_getBlockByNumber", [tag, false]),
  );
  const finalCanonical =
    first.number === final.number
      ? firstCanonical
      : header(await read("eth_getBlockByNumber", [finalTag, false]));
  check(
    isDeepStrictEqual(firstCanonical, first) &&
      isDeepStrictEqual(finalCanonical, final),
    "CANONICAL_HEAD_CHANGED",
  );
  if (historicalCodeRpc) {
    check(
      isDeepStrictEqual(
        header(
          await read("eth_getBlockByNumber", [tag, false], historicalCodeRpc),
        ),
        first,
      ) &&
        isDeepStrictEqual(
          header(
            await read(
              "eth_getBlockByNumber",
              [finalTag, false],
              historicalCodeRpc,
            ),
          ),
          final,
        ),
      "CANONICAL_HEAD_CHANGED",
    );
    check(
      quantity(await read("eth_chainId", [], historicalCodeRpc)) === 1n,
      "WRONG_CHAIN",
    );
  }
  check(quantity(await read("eth_chainId", [])) === 1n, "WRONG_CHAIN");
  validateV10PreflightPlan(plan, {
    build,
    sourceCommit,
    expectedSourceCommit,
    expectedPlanSha256,
  });
  if (delegated)
    check(
      isDeepStrictEqual(
        validateDelegatedV10CreateReview(delegatedCreateReview, {
          build,
          root: proofRoot,
        }),
        delegated,
      ),
      "DELEGATED_CREATE_PROOF_CHANGED",
    );

  const blockers = [];
  const delegatedMatches =
    delegated &&
    firstCode.toLowerCase() === delegated.walletDesignation.toLowerCase() &&
    finalCode.toLowerCase() === delegated.walletDesignation.toLowerCase() &&
    delegated.framework.every(
      (item, i) =>
        ethers.keccak256(initialFramework[i]) === item.codeHash &&
        ethers.keccak256(finalFramework[i]) === item.codeHash,
    );
  if (
    (category !== "empty-code-eoa" && !delegatedMatches) ||
    firstCode !== finalCode
  )
    blockers.push("UNSUPPORTED_ACCOUNT");
  if (delegated && !delegatedMatches)
    blockers.push("DELEGATED_CREATE_FRAMEWORK_CHANGED_OR_UNSUPPORTED");
  const plannedNonce = BigInt(reviewed.startingNonce);
  if (
    [
      pinnedNonce,
      latestNonce,
      pendingNonce,
      finalPinnedNonce,
      finalLatestNonce,
      finalPendingNonce,
    ].some((nonce) => nonce !== plannedNonce)
  )
    blockers.push("NONCE_MISMATCH");
  if (
    firstTargets.some((value) => value !== "empty-code-eoa") ||
    targetObservations.some(
      (value) => value.category !== "empty-code-eoa" || value.nonce !== "0",
    )
  )
    blockers.push("PREDICTED_ADDRESS_OCCUPIED");
  const declaredMaximumCost = reviewed.transactions.reduce(
    (sum, tx) => sum + BigInt(tx.gasLimit) * BigInt(tx.maxFeePerGasWei),
    0n,
  );
  if (balance < declaredMaximumCost || finalBalance < declaredMaximumCost)
    blockers.push("INSUFFICIENT_BALANCE_FOR_DECLARED_CAPS");
  if (
    reviewed.transactions.some(
      (tx) =>
        BigInt(tx.maxFeePerGasWei) <
        BigInt(final.baseFeePerGasWei) + BigInt(tx.maxPriorityFeePerGasWei),
    )
  )
    blockers.push("FEE_CAP_BELOW_CURRENT_BASE_PLUS_DECLARED_TIP");
  return {
    schemaVersion: 1,
    kind: "v10-readonly-preflight",
    status: blockers.length ? "blocked" : "observed-only",
    blockers,
    chainId: 1,
    contractVersion: V10_PROFILE,
    sourceCommit,
    planSha256: expectedPlanSha256,
    provenance: reviewed.provenance,
    anchor: final,
    initialAnchor: first,
    deployer: V10_PREFLIGHT_DEPLOYER,
    controllerInitialOwner: reviewed.governance.initialOwner,
    account: {
      category,
      codeHash: ethers.keccak256(finalCode),
      financialSupportEstablished: false,
      ...(delegated
        ? {
            infrastructureCreateSupportObserved: Boolean(delegatedMatches),
            delegatedCreateReview: delegated,
            frameworkObservations: delegated.framework.map((item, i) => ({
              ...item,
              initialCodeHash: ethers.keccak256(initialFramework[i]),
              finalCodeHash: ethers.keccak256(finalFramework[i]),
            })),
          }
        : {}),
    },
    nonces: {
      planned: reviewed.startingNonce,
      latest: finalLatestNonce.toString(),
      pending: finalPendingNonce.toString(),
      pinned: finalPinnedNonce.toString(),
    },
    balanceWei: finalBalance.toString(),
    targetObservations,
    fees: {
      gasQuoteAvailable: true,
      baseFeePerGasWei: final.baseFeePerGasWei,
      suggestedPriorityFeePerGasWei: priorityFee.toString(),
      declaredMaxFeePerGasWei: reviewed.configuration.fees.maxFeePerGasWei,
      declaredMaxPriorityFeePerGasWei:
        reviewed.configuration.fees.maxPriorityFeePerGasWei,
    },
    gas: {
      estimatesVerified: false,
      fullBundleEstimateAvailable: false,
      budgetApproval: "NONE",
      declaredMaximumGasCostWei: declaredMaximumCost.toString(),
      declaredBudgetWei: reviewed.maxTotalGasCostWei,
      steps: reviewed.transactions.map((tx) => ({
        contract: tx.contract,
        declaredGasLimit: tx.gasLimit,
        estimatedGas: null,
      })),
    },
    limitations: [
      "These are point-in-time public read observations, not signing approval or account compatibility support.",
      "Later constructors depend on earlier deployments; four exact CREATE gas estimates are not proven by latest-state RPC reads.",
      "Declared caps remain unapproved; human gas-budget approval and a source-bound complete-bundle rehearsal are required before signing.",
    ],
    preflightVerified: false,
    deploymentAuthorized: false,
    networkRequests: reads,
    privateFilesRead: 0,
    signatures: 0,
    broadcasts: 0,
  };
}

// HTTPS transport is intentionally constructed only after explicit CLI execution authorization.
export function validateV10PreflightRpcUrl(url, historicalCodeOnly = false) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new PreflightError("INVALID_PUBLIC_RPC");
  }
  check(
    parsed.protocol === "https:" &&
      parsed.hostname ===
        (historicalCodeOnly ? "eth.drpc.org" : "ethereum-rpc.publicnode.com") &&
      parsed.pathname === "/" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      !parsed.port,
    "INVALID_PUBLIC_RPC",
  );
  return parsed;
}
function publicReadTransport(url, historicalCodeOnly = false) {
  const parsed = validateV10PreflightRpcUrl(url, historicalCodeOnly);
  let id = 0;
  return {
    async request({ method, params }) {
      check(READ_METHODS.has(method), "FORBIDDEN_RPC_METHOD");
      if (historicalCodeOnly)
        check(
          method === "eth_chainId" ||
            (method === "eth_getBlockByNumber" &&
              /^0x[0-9a-f]+$/i.test(params[0])) ||
            (method === "eth_getCode" && /^0x[0-9a-f]+$/i.test(params[1])),
          "FORBIDDEN_RPC_METHOD",
        );
      const requestId = ++id;
      const response = await fetch(parsed, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      });
      check(response.ok, "RPC_READ_FAILED");
      const bytes = await response.text();
      check(bytes.length <= 131072, "RPC_READ_FAILED");
      const value = JSON.parse(bytes);
      check(
        value?.jsonrpc === "2.0" &&
          value.id === requestId &&
          !Object.hasOwn(value, "error") &&
          Object.hasOwn(value, "result"),
        "RPC_READ_FAILED",
      );
      return value.result;
    },
  };
}

function committedSourcePins(build, sourceCommit) {
  const files = [
    "scripts/mainnet/preflight-v10-release.mjs",
    "scripts/mainnet/prepare-v10-release.mjs",
    "scripts/compile-contracts-v10.mjs",
    "package.json",
    "package-lock.json",
    ...Object.keys(build.sourceHashes).filter(
      (name) => !name.startsWith("@openzeppelin/"),
    ),
  ];
  return Object.fromEntries(
    files.map((filename) => {
      let approved;
      try {
        approved = execFileSync(
          "git",
          ["show", sourceCommit + ":" + filename],
          { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] },
        );
      } catch {
        throw new PreflightError("SOURCE_MISMATCH");
      }
      check(
        sha(approved) === sha(fs.readFileSync(path.join(ROOT, filename))),
        "SOURCE_MISMATCH",
      );
      return [filename, sha(approved)];
    }),
  );
}

export async function main(argv = []) {
  if (!argv.length)
    return {
      status: "review-only",
      chainId: 1,
      contractVersion: V10_PROFILE,
      deployer: V10_PREFLIGHT_DEPLOYER,
      instruction:
        "--execute-readonly --plan artifacts/v10-release/PUBLIC.json --plan-sha256 CANONICAL_PLAN_SHA256 --source FULL_COMMIT --rpc-url https://ethereum-rpc.publicnode.com [--historical-code-rpc-url https://eth.drpc.org] [--delegated-create-review artifacts/v10-release/PUBLIC.json --delegated-create-review-sha256 RAW_SHA256]",
      gasBudgetApproval: "NONE",
      networkRequests: 0,
      privateFilesRead: 0,
      signatures: 0,
      broadcasts: 0,
    };
  check(argv[0] === "--execute-readonly", "EXPLICIT_READONLY_REQUIRED");
  const flags = {};
  for (let i = 1; i < argv.length; i += 2) {
    check(
      [
        "--plan",
        "--plan-sha256",
        "--source",
        "--rpc-url",
        "--historical-code-rpc-url",
        "--delegated-create-review",
        "--delegated-create-review-sha256",
      ].includes(argv[i]) &&
        !Object.hasOwn(flags, argv[i]) &&
        typeof argv[i + 1] === "string" &&
        !argv[i + 1].startsWith("--"),
      "INVALID_OPTIONS",
    );
    flags[argv[i]] = argv[i + 1];
  }
  check(
    ["--plan", "--plan-sha256", "--source", "--rpc-url"].every((name) =>
      Object.hasOwn(flags, name),
    ) &&
      digest(flags["--plan-sha256"]) &&
      commit(flags["--source"]) &&
      Boolean(flags["--delegated-create-review"]) ===
        Boolean(flags["--delegated-create-review-sha256"]),
    "INVALID_OPTIONS",
  );
  const filename = path.resolve(ROOT, flags["--plan"]),
    directory = path.join(ROOT, "artifacts/v10-release");
  check(
    path.dirname(filename) === directory &&
      /^[a-z0-9-]+\.json$/.test(path.basename(filename)),
    "INVALID_PUBLIC_PLAN_PATH",
  );
  check(
    fs.lstatSync(filename).isFile() && fs.realpathSync(filename) === filename,
    "INVALID_PUBLIC_PLAN_PATH",
  );
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  check(sourceCommit === flags["--source"], "SOURCE_MISMATCH");
  const build = verifyV10Build(),
    plan = JSON.parse(fs.readFileSync(filename, "utf8"));
  const sourcePins = committedSourcePins(build, sourceCommit);
  let delegatedCreateReview = null;
  if (flags["--delegated-create-review"]) {
    delegatedCreateReview = loadDelegatedCreateReview(
      flags["--delegated-create-review"],
      flags["--delegated-create-review-sha256"],
      build,
    ).review;
  }
  const rpc = publicReadTransport(flags["--rpc-url"]);
  const historicalCodeRpc = flags["--historical-code-rpc-url"]
    ? publicReadTransport(flags["--historical-code-rpc-url"], true)
    : null;
  const observation = await inspectV10Preflight({
    plan,
    build,
    rpc,
    historicalCodeRpc,
    delegatedCreateReview,
    sourceCommit,
    expectedSourceCommit: flags["--source"],
    expectedPlanSha256: flags["--plan-sha256"],
  });
  check(
    isDeepStrictEqual(committedSourcePins(build, sourceCommit), sourcePins),
    "SOURCE_MISMATCH",
  );
  return { ...observation, sourcePins };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(
        error instanceof PreflightError
          ? error.message
          : "V10 read-only preflight stopped: INVALID_PUBLIC_INPUT_OR_BUILD",
      );
      process.exitCode = 1;
    });
