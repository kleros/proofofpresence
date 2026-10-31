// User-wallet handoff only. This module has no signer, private-key or broadcast API.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { ethers } from "ethers";
import { createReadOnlyHttpProvider } from "./mainnet-runtime.mjs";
import {
  verifyV10FactoryDeployment,
  V10_MAINNET_SCOPE,
} from "./v10-upgrade-verification.mjs";
import {
  prepareV10Release,
  validateV10ReleaseConfig,
  verifyV10Build,
} from "../scripts/mainnet/prepare-v10-release.mjs";
import { loadDelegatedCreateReview } from "../scripts/mainnet/preflight-v10-release.mjs";
import { validatePublicMainnetRpc } from "../scripts/mainnet/verify-kleros.mjs";
import {
  createVerificationRuntime,
  allowedVerificationMethod,
} from "../scripts/mainnet/verification-runtime.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const USER_DEPLOYER = "0x2bb03593892724d225071068E59ab1E48aF05b55";
export const V10_LOST_PAGE_ACK =
  "refreshed-before-wallet-confirmation-no-submission";
export const V10_UNSTARTED_FINAL_ACK =
  "expired-before-wallet-request-no-submission";
const NAMES = [
  "KlerosUpgradeControllerV10",
  "KlerosEventV10",
  "KlerosEventFactoryV10",
  "ERC1967Proxy",
];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value);
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const bridgeFiles = [
  "src/v10-wallet-deployment.mjs",
  "scripts/serve-v10-deployment.mjs",
  "tools/v10-wallet/index.html",
  "tools/v10-wallet/deploy.js",
  "tools/v10-wallet/style.css",
  "scripts/mainnet/prepare-v10-release.mjs",
  "scripts/mainnet/preflight-v10-release.mjs",
  "src/v10-upgrade-verification.mjs",
  "src/v10-upgrade-artifacts.mjs",
];
const bridgeSourceHashes = () =>
  Object.fromEntries(
    bridgeFiles.map((name) => [
      name,
      sha(fs.readFileSync(path.join(ROOT, name))),
    ]),
  );
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const bytes32 = (value) => ethers.isHexString(value, 32);
const check = (ok, code, message) => {
  if (!ok) throw Object.assign(new Error(message), { code, status: 409 });
};
const failure = (code = "READ_UNAVAILABLE") =>
  Object.assign(
    new Error(
      "Read-only deployment check unavailable; preserve any known transaction hash.",
    ),
    { code, status: 409 },
  );

/** Bridge-local serial admission only: original response is returned unchanged; no retry. */
export function createV10PacedFetcher({
  fetcher = fetch,
  now = () => performance.now(),
  sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Read cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, ms);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    }),
} = {}) {
  let tail = Promise.resolve(),
    lastAdmission = -Infinity;
  return (url, options = {}) => {
    const signal = options.signal;
    const cancelled = () => {
      throw new DOMException("Read cancelled", "AbortError");
    };
    const task = tail.then(async () => {
      if (signal?.aborted) cancelled();
      const at = now();
      check(
        Number.isFinite(at) && at >= lastAdmission,
        "RPC_CLOCK",
        "Read pacing clock is unavailable.",
      );
      let admitted = at;
      while (admitted < lastAdmission + 1500) {
        await sleep(Math.ceil(lastAdmission + 1500 - admitted), signal);
        if (signal?.aborted) cancelled();
        const next = now();
        check(
          Number.isFinite(next) && next >= admitted,
          "RPC_CLOCK",
          "Read pacing clock is unavailable.",
        );
        admitted = next;
      }
      if (signal?.aborted) cancelled();
      check(
        Number.isFinite(admitted) && admitted >= lastAdmission + 1500,
        "RPC_CLOCK",
        "Read pacing interval did not elapse.",
      );
      lastAdmission = admitted;
      return fetcher(url, options);
    });
    tail = task.catch(() => {});
    if (!signal) return task;
    return new Promise((resolve, reject) => {
      const abort = () =>
        reject(new DOMException("Read cancelled", "AbortError"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
      task
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  };
}

export function v10WalletDeploymentApproval(
  plan,
  delegatedCreateReview = null,
  lostPageRecoveryGrant = null,
) {
  const planSha256 = sha(canonical(plan));
  const bridgeSources = bridgeSourceHashes(),
    bridgeSourceSha256 = sha(canonical(bridgeSources));
  return {
    planSha256,
    bridgeSourceSha256,
    bridgeSources,
    delegatedCreateReview,
    lostPageRecoveryGrant,
    approvalHash: sha(
      canonical({
        purpose: "v10-four-direct-type2-create-mainnet-setup-only",
        planSha256,
        bridgeSourceSha256,
        chainId: 1,
        deployer: plan.deployer,
        maxTotalGasCostWei: plan.maxTotalGasCostWei,
        delegatedCreateReview,
        lostPageRecoveryGrant,
      }),
    ),
  };
}

function validateShape(input, expectedWallet) {
  const p = structuredClone(input),
    config = validateV10ReleaseConfig(p.configuration);
  check(
    p.schemaVersion === 1 &&
      p.version === 10 &&
      p.status === "unsigned-review-only" &&
      p.contractVersion === "kleros-event-v10-uups" &&
      p.chainId === 1 &&
      p.startingNonce === config.deployerNonce &&
      same(p.deployer, expectedWallet) &&
      same(p.deployer, config.deployer) &&
      same(p.governance?.initialOwner, p.deployer) &&
      p.governance.kind === "single-owner-immediate" &&
      p.governance.upgradeDelaySeconds === 0 &&
      p.governance.renounceable === true &&
      p.upgradeDelaySeconds === 0 &&
      p.finalizationAutomatic === false &&
      p.guestEventCreated === false &&
      p.maxTotalGasCostWei === config.maxTotalGasCostWei &&
      p.deploymentAuthorized === false &&
      p.signatures === 0 &&
      p.broadcasts === 0 &&
      Array.isArray(p.transactions) &&
      p.transactions.length === 4,
    "PLAN_MISMATCH",
    "The exact unsigned four-CREATE Ethereum setup plan is required.",
  );
  for (const [index, tx] of p.transactions.entries()) {
    const predicted = ethers.getCreateAddress({
      from: p.deployer,
      nonce: p.startingNonce + index,
    });
    check(
      tx.step === index + 1 &&
        tx.contract === NAMES[index] &&
        tx.chainId === 1 &&
        tx.type === 2 &&
        same(tx.from, p.deployer) &&
        tx.to === null &&
        tx.value === "0" &&
        tx.nonce === p.startingNonce + index &&
        tx.gasLimit === config.gasLimits[tx.contract] &&
        tx.maxFeePerGasWei === config.fees.maxFeePerGasWei &&
        tx.maxPriorityFeePerGasWei === config.fees.maxPriorityFeePerGasWei &&
        same(tx.predictedAddress, predicted) &&
        same(p.addresses?.[tx.contract], predicted) &&
        bytes32(tx.expectedRuntimeCodeHash) &&
        ethers.isHexString(tx.data) &&
        tx.data.length > 2,
      "PLAN_MISMATCH",
      "A setup transaction differs from its approved nonce, address or budget.",
    );
  }
  return p;
}

/** Fresh sealed source/build verification, without RPC; every planned byte must reproduce. */
export function verifyV10WalletDeploymentPlan(
  plan,
  { expectedWallet = USER_DEPLOYER } = {},
) {
  plan = validateShape(plan, expectedWallet);
  const build = verifyV10Build();
  check(
    canonical(prepareV10Release(plan.configuration, build)) === canonical(plan),
    "SOURCE_CHANGED",
    "The unsigned V10 plan no longer matches the sealed current source and artifacts.",
  );
  return { plan, build };
}

function journalStore(filename, binding) {
  check(
    path.isAbsolute(filename),
    "JOURNAL_SCOPE",
    "Use an explicit dedicated deployment journal.",
  );
  const empty = () => ({
    version: 1,
    contractVersion: "kleros-event-v10-uups",
    purpose: "four-direct-type2-creates",
    chainId: 1,
    ...binding,
    steps: [],
  });
  const read = () => {
    let info;
    try {
      info = fs.lstatSync(filename);
    } catch (e) {
      if (e.code === "ENOENT") return empty();
      throw failure("JOURNAL_UNAVAILABLE");
    }
    check(
      info.isFile() &&
        !info.isSymbolicLink() &&
        (info.mode & 0o077) === 0 &&
        (process.getuid === undefined || info.uid === process.getuid()),
      "JOURNAL_PERMISSIONS",
      "The deployment journal must be an owner-only regular file.",
    );
    let fd, data;
    try {
      fd = fs.openSync(
        filename,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      const opened = fs.fstatSync(fd);
      check(
        opened.ino === info.ino &&
          opened.dev === info.dev &&
          opened.isFile() &&
          (opened.mode & 0o077) === 0,
        "JOURNAL_PERMISSIONS",
        "The deployment journal changed while opening.",
      );
      data = JSON.parse(fs.readFileSync(fd, "utf8"));
    } catch {
      throw failure("JOURNAL_INVALID");
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    check(
      data.version === 1 &&
        data.contractVersion === "kleros-event-v10-uups" &&
        data.purpose === "four-direct-type2-creates" &&
        data.chainId === 1 &&
        data.planSha256 === binding.planSha256 &&
        typeof data.approvalHash === "string" &&
        /^[a-f0-9]{64}$/.test(data.approvalHash) &&
        same(data.deployer, binding.deployer) &&
        Array.isArray(data.steps) &&
        data.steps.every(
          (row) =>
            Number.isInteger(row.step) &&
            row.step >= 1 &&
            row.step <= 4 &&
            (!row.hash || bytes32(row.hash)),
        ) &&
        new Set(data.steps.map((r) => r.step)).size === data.steps.length,
      "JOURNAL_SCOPE",
      "The deployment journal belongs to another plan or wallet.",
    );
    return data;
  };
  const write = (value) => {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const tmp = `${filename}.${randomBytes(12).toString("hex")}.tmp`;
    let fd, directory;
    try {
      fd = fs.openSync(tmp, "wx", 0o600);
      fs.writeFileSync(fd, canonical(value));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tmp, filename);
      directory = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY);
      fs.fsyncSync(directory);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (directory !== undefined) fs.closeSync(directory);
      fs.rmSync(tmp, { force: true });
    }
  };
  let busy = false;
  const locked = async (work) => {
    check(!busy, "STEP_BUSY", "Another deployment operation is still running.");
    busy = true;
    let fd;
    const lock = `${filename}.lock`;
    try {
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      try {
        fd = fs.openSync(lock, "wx", 0o600);
      } catch {
        throw failure("STEP_BUSY");
      }
      return await work(read(), write);
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
        fs.unlinkSync(lock);
      }
      busy = false;
    }
  };
  return { read, locked };
}

/** Trusted dependency arguments are for tests only. HTTP/CLI never accepts callbacks or another owner. */
export function createV10WalletDeployment({
  plan: input,
  journalFile,
  enableWalletSigning = false,
  approvalHash,
  expectedWallet = USER_DEPLOYER,
  providerFactory,
  verifySources = verifyV10WalletDeploymentPlan,
  verifyFactory = verifyV10FactoryDeployment,
  delegatedCreateReview = null,
  lostPageRecoveryGrant = null,
  loadDelegatedReview = loadDelegatedCreateReview,
  rpcUrl = "https://eth.drpc.org/",
  confirmations = 2,
} = {}) {
  const plan = freeze(validateShape(input, expectedWallet));
  const initialVerification = verifySources(plan, { expectedWallet });
  const reviewPin = (build) => {
    if (!delegatedCreateReview) return null;
    check(
      typeof delegatedCreateReview.file === "string" &&
        /^[a-f0-9]{64}$/.test(delegatedCreateReview.sha256),
      "DELEGATED_REVIEW_REQUIRED",
      "Use the exact source-bound delegated four-CREATE review.",
    );
    const loaded = loadDelegatedReview(
      delegatedCreateReview.file,
      delegatedCreateReview.sha256,
      build,
    );
    const bytes = fs.readFileSync(
      path.join(
        ROOT,
        "artifacts/v10-integration/metamask-runtime-observed.json",
      ),
    );
    check(
      sha(bytes) === loaded.review.observedRuntimeSha256,
      "SOURCE_CHANGED",
      "The reviewed public runtime observation changed.",
    );
    const observed = JSON.parse(bytes);
    const framework = loaded.facts.framework.map((item) => {
      const row = observed.contracts.find(
        (entry) =>
          entry.name === item.name && same(entry.address, item.address),
      );
      check(
        row && same(ethers.keccak256(row.code), item.codeHash),
        "SOURCE_CHANGED",
        "The reviewed framework bytecode differs.",
      );
      return { ...item, code: row.code };
    });
    return {
      file: path.relative(ROOT, path.resolve(ROOT, delegatedCreateReview.file)),
      sha256: loaded.sha256,
      review: loaded.review,
      facts: { ...loaded.facts, framework },
    };
  };
  const pinnedReview = freeze(reviewPin(initialVerification.build));
  const recoveryGrant =
    lostPageRecoveryGrant === null
      ? null
      : freeze(structuredClone(lostPageRecoveryGrant));
  if (recoveryGrant !== null) {
    const keys = [
      "schemaVersion",
      "kind",
      "planSha256",
      "wallet",
      "step",
      "nonce",
      "originalAttempt",
      "originalPreparedAt",
      "originalPreparedSha256",
      "originalApprovalHash",
      "expiresAt",
    ];
    check(
      Object.keys(recoveryGrant).sort().join() === keys.sort().join() &&
        recoveryGrant.schemaVersion === 1 &&
        ((recoveryGrant.step === 2 &&
          recoveryGrant.kind === "v10-step2-lost-page-recovery") ||
          (recoveryGrant.step === 4 &&
            [
              "v10-step4-unstarted-wallet-recovery",
              "v10-step4-unstarted-delivery-recovery",
            ].includes(recoveryGrant.kind))) &&
        recoveryGrant.planSha256 === sha(canonical(plan)) &&
        same(recoveryGrant.wallet, plan.deployer) &&
        recoveryGrant.nonce ===
          plan.transactions[recoveryGrant.step - 1].nonce &&
        recoveryGrant.originalAttempt === 1 &&
        Number.isSafeInteger(recoveryGrant.originalPreparedAt) &&
        recoveryGrant.originalPreparedAt > 0 &&
        /^[a-f0-9]{64}$/.test(recoveryGrant.originalPreparedSha256) &&
        /^[a-f0-9]{64}$/.test(recoveryGrant.originalApprovalHash) &&
        Number.isSafeInteger(recoveryGrant.expiresAt) &&
        recoveryGrant.expiresAt > recoveryGrant.originalPreparedAt,
      "RECOVERY_GRANT_REQUIRED",
      "Use the exact reviewed unstarted recovery grant.",
    );
  }
  const binding = {
    ...v10WalletDeploymentApproval(plan, pinnedReview, recoveryGrant),
    deployer: plan.deployer,
  };
  check(
    typeof enableWalletSigning === "boolean",
    "INVALID_INPUT",
    "Wallet signing must be an explicit boolean option.",
  );
  check(
    confirmations >= 2 && Number.isSafeInteger(confirmations),
    "INVALID_INPUT",
    "At least two confirmations are required.",
  );
  validatePublicMainnetRpc(rpcUrl);
  check(
    !enableWalletSigning || approvalHash === binding.approvalHash,
    "APPROVAL_REQUIRED",
    "The exact reviewed plan and ETH ceiling must be approved first.",
  );
  const signingEnabled =
    enableWalletSigning && approvalHash === binding.approvalHash;
  const activeHandoff = (row) => row?.deliveryRecovery ?? row?.recovery ?? row;
  const walletStarted = (row) =>
    !!(
      row?.walletRequestStartedAt ||
      row?.recovery?.walletRequestStartedAt ||
      row?.deliveryRecovery?.walletRequestStartedAt
    );
  journalFile ??= path.join(
    ROOT,
    ".runtime/mainnet-v10",
    `wallet-deployment-${binding.planSha256}.json`,
  );
  const store = journalStore(journalFile, binding);
  const assertPlan = () =>
    check(
      sha(canonical(plan)) === binding.planSha256,
      "PLAN_MISMATCH",
      "The immutable reviewed plan changed.",
    );
  let providerPromise;
  async function provider() {
    providerPromise ??= (async () => {
      const p = providerFactory
        ? await providerFactory(rpcUrl, { timeoutMs: 20000 })
        : await createReadOnlyHttpProvider(rpcUrl, {
            timeoutMs: 20000,
            fetcher: createV10PacedFetcher(),
          });
      const raw = p.send.bind(p),
        runtime = createVerificationRuntime({
          send: raw,
          expectedChainId: 1,
          maxAttempts: 1,
          timeoutMs: 20000,
        });
      if (typeof p._send === "function") {
        const batch = p._send.bind(p);
        p._send = async (payload) => {
          check(
            (Array.isArray(payload) ? payload : [payload]).every((item) =>
              allowedVerificationMethod(item?.method),
            ),
            "FORBIDDEN_METHOD",
            "The bridge RPC is strictly read-only.",
          );
          return batch(payload);
        };
      }
      p.send = (method, params = []) =>
        runtime.request(method, params, { phase: "deployment" });
      for (const method of [
        "getSigner",
        "listAccounts",
        "broadcastTransaction",
      ])
        p[method] = async () => {
          throw failure("FORBIDDEN_METHOD");
        };
      return p;
    })();
    return providerPromise;
  }
  const txFor = (step) => {
    check(
      Number.isInteger(step) && step >= 1 && step <= 4,
      "INVALID_STEP",
      "Choose one of the four setup steps.",
    );
    return plan.transactions[step - 1];
  };
  const matchesCreate = (actual, tx) =>
    actual &&
    same(actual.from, tx.from) &&
    actual.to === null &&
    actual.nonce === tx.nonce &&
    Number(actual.chainId) === 1 &&
    actual.type === 2 &&
    actual.value === 0n &&
    same(actual.data, tx.data) &&
    actual.gasLimit <= BigInt(tx.gasLimit) &&
    actual.maxFeePerGas !== null &&
    actual.maxPriorityFeePerGas !== null &&
    actual.maxFeePerGas <= BigInt(tx.maxFeePerGasWei) &&
    actual.maxPriorityFeePerGas <= BigInt(tx.maxPriorityFeePerGasWei);
  const publicState = (journal) => ({
    planSha256: binding.planSha256,
    signingEnabled,
    steps: plan.transactions.map((tx) => {
      const row = journal.steps.find((r) => r.step === tx.step);
      return {
        step: tx.step,
        state: row?.state ?? "not-prepared",
        hash: row?.confirmedHash ?? row?.pendingHash ?? row?.hash ?? null,
        originalHash: row?.hash ?? null,
        candidates: (
          row?.candidates ??
          (row?.hash ? [{ hash: row.hash, state: "known" }] : [])
        ).map((entry) => ({
          hash: entry.hash,
          state: entry.state,
          code: entry.code ?? null,
        })),
        receipt: row?.receipt ?? null,
        attempt: row?.attempt ?? 0,
        recoveryPrepared: !!row?.recovery,
        walletRequestStarted: walletStarted(row),
        deliveryPrepared: !!row?.deliveryRecovery,
        preparedResponseReceived:
          !!row?.deliveryRecovery?.currentReview?.responseReceivedAt,
        reviewError: row?.deliveryRecovery?.currentReview?.lastError ?? null,
      };
    }),
    setup: journal.setup ?? { status: "not-verified" },
  });
  const blockFact = async (p, block = "latest") => {
    const b = await p.send("eth_getBlockByNumber", [
      typeof block === "number" ? ethers.toQuantity(block) : block,
      false,
    ]);
    check(
      b &&
        /^0x[0-9a-f]{64}$/i.test(b.hash ?? "") &&
        /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(b.number ?? "") &&
        BigInt(b.number) <= BigInt(Number.MAX_SAFE_INTEGER),
      "CANONICAL_HEAD_CHANGED",
      "A fresh canonical Ethereum head is required.",
    );
    return {
      number: Number(BigInt(b.number)),
      hash: b.hash,
      baseFeePerGas:
        b.baseFeePerGas === undefined ? null : BigInt(b.baseFeePerGas),
    };
  };
  const walletFact = async (p, head, facts) => {
    const tag = ethers.toQuantity(head.number),
      walletCode = await p.send("eth_getCode", [plan.deployer, tag]);
    check(
      typeof walletCode === "string" &&
        /^0x(?:[0-9a-f]{2})*$/i.test(walletCode),
      "UNSUPPORTED_WALLET",
      "Wallet code could not be checked.",
    );
    if (walletCode === "0x") return { kind: "eoa", walletCode, framework: [] };
    check(
      facts?.scope === "four-direct-type2-create-infrastructure-only" &&
        facts.applicationFinancialSupport === false &&
        facts.wrappedExecutionSupported === false &&
        same(walletCode, facts.walletDesignation) &&
        Array.isArray(facts.framework) &&
        facts.framework.length === 3,
      "UNSUPPORTED_WALLET",
      "Only the separately source/protocol-reviewed delegated direct-CREATE account is supported.",
    );
    for (const item of facts.framework) {
      const code = await p.send("eth_getCode", [item.address, tag]);
      check(
        typeof code === "string" &&
          code !== "0x" &&
          same(ethers.keccak256(code), item.codeHash),
        "FRAMEWORK_CHANGED",
        "A reviewed framework runtime changed.",
      );
    }
    return {
      kind: "reviewed-delegated-direct-create",
      walletCode,
      framework: structuredClone(facts.framework),
      scope: facts.scope,
      applicationFinancialSupport: false,
      wrappedExecutionSupported: false,
    };
  };
  async function receiptFact(p, tx, hashValue) {
    await p.send("eth_chainId", []);
    const [actual, receipt, head] = await Promise.all([
      p.getTransaction(hashValue),
      p.getTransactionReceipt(hashValue),
      blockFact(p),
    ]);
    if (!actual) return { status: "pending" };
    check(
      same(actual.hash, hashValue) &&
        same(actual.from, tx.from) &&
        actual.to === null &&
        actual.nonce === tx.nonce &&
        Number(actual.chainId) === 1 &&
        actual.type === 2 &&
        actual.value === 0n &&
        same(actual.data, tx.data) &&
        actual.gasLimit <= BigInt(tx.gasLimit) &&
        actual.maxFeePerGas !== null &&
        actual.maxPriorityFeePerGas !== null &&
        actual.maxFeePerGas <= BigInt(tx.maxFeePerGasWei) &&
        actual.maxPriorityFeePerGas <= BigInt(tx.maxPriorityFeePerGasWei),
      "TRANSACTION_MISMATCH",
      "The known transaction differs from the reviewed CREATE request or fee ceiling.",
    );
    if (!receipt) return { status: "pending", validTransaction: true };
    const block = await p.getBlock(receipt.blockNumber);
    check(
      same(receipt.hash ?? receipt.transactionHash, hashValue) &&
        actual.blockNumber === receipt.blockNumber &&
        same(actual.blockHash, receipt.blockHash) &&
        same(block?.hash, receipt.blockHash),
      "RECEIPT_REORG",
      "The deployment receipt is not canonical.",
    );
    check(
      receipt.status === 1,
      "TRANSACTION_REVERTED",
      "The setup transaction reverted. Stop and review the original nonce and hash.",
    );
    check(
      same(receipt.contractAddress, tx.predictedAddress),
      "TRANSACTION_MISMATCH",
      "The CREATE address differs from the approved plan.",
    );
    const count = head.number - receipt.blockNumber + 1;
    if (count < confirmations)
      return {
        status: "confirming",
        validTransaction: true,
        confirmations: count,
        required: confirmations,
      };
    const code = await p.getCode(tx.predictedAddress, head.number);
    check(
      code !== "0x" && same(ethers.keccak256(code), tx.expectedRuntimeCodeHash),
      "WRONG_CONTRACT",
      "The created runtime differs from the reviewed source.",
    );
    check(
      same((await p.getBlock(receipt.blockNumber))?.hash, receipt.blockHash) &&
        same((await p.getBlock(head.number))?.hash, head.hash),
      "RECEIPT_REORG",
      "A deployment verification anchor changed.",
    );
    return {
      status: "confirmed",
      validTransaction: true,
      receipt: {
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        contractAddress: receipt.contractAddress,
        gasUsed: String(receipt.gasUsed),
        gasPrice: String(receipt.gasPrice),
        costWei: String(receipt.gasUsed * receipt.gasPrice),
        confirmations: count,
      },
    };
  }
  async function verifySetup() {
    assertPlan();
    const journal = store.read(),
      p = await provider(),
      confirmed = [];
    for (const tx of plan.transactions) {
      const row = journal.steps.find((r) => r.step === tx.step);
      check(
        row &&
          row.state !== "human-review" &&
          (row.confirmedHash ?? row.pendingHash ?? row.hash),
        "SETUP_INCOMPLETE",
        "All four exact setup transactions need canonical receipt verification.",
      );
      const txHash = row.confirmedHash ?? row.pendingHash ?? row.hash;
      const fact = await receiptFact(p, tx, txHash);
      check(
        fact.status === "confirmed",
        "SETUP_INCOMPLETE",
        "All four setup receipts need two confirmations.",
      );
      confirmed.push({ tx, hash: txHash, receipt: fact.receipt });
    }
    const [controller, implementation, factoryImplementation, proxy] =
      confirmed;
    const F = {
      contractVersion: plan.contractVersion,
      abiVersion: plan.contractVersion,
      chainId: 1,
      factory: proxy.tx.predictedAddress,
      factoryCodeHash: proxy.tx.expectedRuntimeCodeHash,
      implementation: implementation.tx.predictedAddress,
      implementationCodeHash: implementation.tx.expectedRuntimeCodeHash,
      factoryImplementation: factoryImplementation.tx.predictedAddress,
      factoryImplementationCodeHash:
        factoryImplementation.tx.expectedRuntimeCodeHash,
      initialImplementation: implementation.tx.predictedAddress,
      initialFactoryImplementation: factoryImplementation.tx.predictedAddress,
      upgradeAuthority: controller.tx.predictedAddress,
      upgradeAuthorityCodeHash: controller.tx.expectedRuntimeCodeHash,
      initialUpgradeOwner: plan.deployer,
      factoryDeploymentTxHash: proxy.hash,
      factoryDeploymentBlock: proxy.receipt.blockNumber,
      controllerDeploymentTxHash: controller.hash,
      controllerDeploymentBlock: controller.receipt.blockNumber,
    };
    const proof = await verifyFactory(
      {
        provider: p,
        production: true,
        chainId: 1,
        governance: plan.governance,
        manifest: {
          provenance: {
            v10BuildManifestSha256: plan.provenance.v10BuildManifestSha256,
            v10StandardInputSha256: plan.provenance.v10StandardInputSha256,
          },
        },
      },
      F,
      V10_MAINNET_SCOPE,
    );
    check(
      proof?.deploymentTrust?.status === "verified" &&
        same(proof.eventImplementation, implementation.tx.predictedAddress) &&
        same(proof.upgrade?.owner, plan.deployer) &&
        (proof.upgrade.pendingOwner === null ||
          same(proof.upgrade.pendingOwner, ethers.ZeroAddress)) &&
        proof.upgrade.governanceKind === "single-owner-immediate" &&
        proof.upgrade.upgradesDisabled === false &&
        proof.upgrade.delaySeconds === 0 &&
        proof.upgrade.version === 10,
      "SETUP_GOVERNANCE_CHANGED",
      "The deployed factory or initial immediate-owner controller governance needs human review.",
    );
    return store.locked((current, write) => {
      check(
        confirmed.every((entry) =>
          same(
            current.steps.find((r) => r.step === entry.tx.step)?.confirmedHash,
            entry.hash,
          ),
        ),
        "JOURNAL_SCOPE",
        "Setup receipt identities changed during final verification.",
      );
      current.setup = {
        status: "verified",
        checkedAt: Date.now(),
        factory: F.factory,
        anchor: proof.anchor,
        deploymentTrust: proof.deploymentTrust,
        upgrade: proof.upgrade,
        eventImplementation: proof.eventImplementation,
      };
      write(current);
      return structuredClone(current.setup);
    });
  }
  async function recoverCandidate({ step, hash: candidateHash }) {
    assertPlan();
    txFor(step);
    check(
      bytes32(candidateHash),
      "INVALID_HASH",
      "Enter an original or replacement wallet transaction hash.",
    );
    await store.locked((journal, write) => {
      const row = journal.steps.find((r) => r.step === step);
      check(
        row && !["not-prepared", "rejected"].includes(row.state),
        "JOURNAL_SCOPE",
        "Receipt recovery requires an existing wallet handoff.",
      );
      row.candidates ??= row.hash ? [{ hash: row.hash, state: "known" }] : [];
      check(
        row.candidates.length < 16 ||
          row.candidates.some((c) => same(c.hash, candidateHash)),
        "HUMAN_REVIEW_REQUIRED",
        "Candidate history reached its review bound.",
      );
      if (!row.hash) row.hash = candidateHash;
      if (!row.candidates.some((c) => same(c.hash, candidateHash)))
        row.candidates.push({
          hash: candidateHash,
          state: "known",
          knownAt: Date.now(),
        });
      if (row.state === "prepared" || row.state === "uncertain")
        row.state = "submitted";
      write(journal); // Preserve a newly supplied known hash before any RPC await.
    });
    const p = await provider();
    await p.send("eth_chainId", []);
    const actual = await p.getTransaction(candidateHash),
      tx = txFor(step);
    let proof;
    if (actual && (!same(actual.from, tx.from) || actual.nonce !== tx.nonce))
      proof = { status: "rejected-hash", code: "WRONG_HASH" };
    else if (actual && !matchesCreate(actual, tx))
      proof = { status: "human-review", code: "REPLACEMENT_OUTSIDE_PLAN" };
    else proof = await receiptFact(p, tx, candidateHash);
    const result = await store.locked((journal, write) => {
      const row = journal.steps.find((r) => r.step === step),
        entry = row?.candidates.find((c) => same(c.hash, candidateHash));
      check(entry, "JOURNAL_SCOPE", "The candidate hash left this setup step.");
      entry.state = proof.status;
      if (proof.code) entry.code = proof.code;
      if (proof.status === "human-review") row.state = "human-review";
      if (proof.validTransaction && row.state !== "human-review") {
        row.pendingHash = candidateHash;
        if (!row.confirmedHash) row.state = "submitted";
      }
      if (proof.status === "confirmed" && row.state !== "human-review") {
        if (row.confirmedHash && !same(row.confirmedHash, candidateHash))
          row.confirmedHistory = [
            ...(row.confirmedHistory ?? []),
            { hash: row.confirmedHash, receipt: row.receipt },
          ];
        row.confirmedHash = candidateHash;
        row.receipt = proof.receipt;
        row.state = "confirmed";
      }
      write(journal);
      return { ...proof, state: publicState(journal) };
    });
    if (result.state.steps.every((row) => row.state === "confirmed")) {
      try {
        result.setup = await verifySetup();
      } catch (error) {
        result.setup = {
          status: "unavailable",
          code: /^[A-Z_]{1,48}$/.test(error.code ?? "")
            ? error.code
            : "SETUP_UNAVAILABLE",
        };
      }
    }
    return result;
  }
  async function checkedStep(journal, step) {
    assertPlan();
    check(
      v10WalletDeploymentApproval(plan, pinnedReview, recoveryGrant)
        .bridgeSourceSha256 === binding.bridgeSourceSha256,
      "SOURCE_CHANGED",
      "The reviewed wallet-bridge source changed; obtain a new explicit review.",
    );
    const tx = txFor(step);
    const verified = await verifySources(plan, { expectedWallet });
    const p = await provider();
    await p.send("eth_chainId", []);
    let spent = 0n;
    for (let index = 1; index < step; index++) {
      const row = journal.steps.find((r) => r.step === index);
      check(
        row?.hash,
        "PREVIOUS_UNCONFIRMED",
        "Confirm the previous setup transaction before proceeding.",
      );
      check(
        row.state !== "human-review",
        "HUMAN_REVIEW_REQUIRED",
        "A replacement or cancellation needs human review.",
      );
      const proof = await receiptFact(
        p,
        txFor(index),
        row.confirmedHash ?? row.pendingHash ?? row.hash,
      );
      check(
        proof.status === "confirmed",
        "PREVIOUS_UNCONFIRMED",
        "The previous transaction needs two canonical confirmations.",
      );
      spent += BigInt(proof.receipt.costWei);
    }
    const reviewed = reviewPin(verified.build);
    check(
      canonical(reviewed) === canonical(pinnedReview),
      "SOURCE_CHANGED",
      "The source-bound delegated CREATE review changed.",
    );
    const head = await blockFact(p);
    const walletCompatibility = await walletFact(p, head, reviewed?.facts);
    const [pending, latest, balance, targetCode, targetNonce] =
      await Promise.all([
        p
          .send("eth_getTransactionCount", [plan.deployer, "pending"])
          .then((x) => Number(BigInt(x))),
        p
          .send("eth_getTransactionCount", [
            plan.deployer,
            ethers.toQuantity(head.number),
          ])
          .then((x) => Number(BigInt(x))),
        p
          .send("eth_getBalance", [
            plan.deployer,
            ethers.toQuantity(head.number),
          ])
          .then(BigInt),
        p.send("eth_getCode", [
          tx.predictedAddress,
          ethers.toQuantity(head.number),
        ]),
        p
          .send("eth_getTransactionCount", [
            tx.predictedAddress,
            ethers.toQuantity(head.number),
          ])
          .then((x) => Number(BigInt(x))),
      ]);
    check(
      pending === tx.nonce && latest === tx.nonce,
      "NONCE_CHANGED",
      "The reviewed wallet must have the exact planned pending nonce.",
    );
    check(
      targetCode === "0x" && targetNonce === 0,
      "ADDRESS_OCCUPIED",
      "The predicted CREATE address is already occupied.",
    );
    const base = head.baseFeePerGas;
    check(
      typeof base === "bigint" &&
        base > 0n &&
        BigInt(tx.maxFeePerGasWei) >= base + BigInt(tx.maxPriorityFeePerGasWei),
      "FEE_CHANGED",
      "The current base fee exceeds the approved fee ceiling. Obtain a new review.",
    );
    const remaining = plan.transactions
      .slice(step - 1)
      .reduce(
        (sum, item) =>
          sum + BigInt(item.gasLimit) * BigInt(item.maxFeePerGasWei),
        0n,
      );
    check(
      spent + remaining <= BigInt(plan.maxTotalGasCostWei) &&
        balance >= remaining,
      "BUDGET_CHANGED",
      "The wallet cannot cover the remaining approved gas budget.",
    );
    const request = {
      from: tx.from,
      data: tx.data,
      value: 0,
      nonce: tx.nonce,
      type: 2,
      gasLimit: BigInt(tx.gasLimit),
      maxFeePerGas: BigInt(tx.maxFeePerGasWei),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasWei),
    };
    const gas = await p.estimateGas(request);
    check(
      gas > 0n && gas <= BigInt(tx.gasLimit),
      "GAS_CHANGED",
      "Current gas exceeds the reviewed transaction ceiling.",
    );
    check(
      Number(
        BigInt(
          await p.send("eth_getTransactionCount", [plan.deployer, "pending"]),
        ),
      ) === tx.nonce && same((await blockFact(p, head.number)).hash, head.hash),
      "NONCE_CHANGED",
      "The nonce or canonical head changed during preflight.",
    );
    const closingWallet = await walletFact(p, head, reviewed?.facts);
    await p.send("eth_chainId", []);
    check(
      canonical(closingWallet) === canonical(walletCompatibility) &&
        same((await blockFact(p, head.number)).hash, head.hash),
      "FRAMEWORK_CHANGED",
      "Wallet/framework code or the canonical anchor changed before handoff.",
    );
    return {
      step,
      block: { number: head.number, hash: head.hash },
      walletCompatibility,
      balanceWei: String(balance),
      remainingMaxCostWei: String(remaining),
      spentWei: String(spent),
      estimatedGas: String(gas),
      baseFeePerGasWei: String(base),
    };
  }
  return {
    plan: () => ({
      plan: structuredClone(plan),
      ...structuredClone(binding),
      signingEnabled,
      terms: {
        setupTransactions: 4,
        eventCreationIncluded: false,
        initialUpgradeOwner: plan.deployer,
        upgradeDelaySeconds: 0,
        governanceKind: "single-owner-immediate",
        renounceable: true,
        oldEventsSeparate: true,
        courtVerified: false,
        rpcMinimumAdmissionIntervalMs: 1500,
        rpcRetries: 0,
        lostPageRecovery: recoveryGrant
          ? {
              step: recoveryGrant.step,
              kind: recoveryGrant.kind,
              expiresAt: recoveryGrant.expiresAt,
            }
          : null,
      },
    }),
    state: () => publicState(store.read()),
    checkStep: async (step) => checkedStep(store.read(), step),
    recoverPreparedStep: async ({
      step,
      wallet,
      chainId,
      acknowledgement,
      clientCapability,
      clientDocumentId,
    }) => {
      check(
        signingEnabled,
        "APPROVAL_REQUIRED",
        "Approve the exact amended handoff first.",
      );
      return store.locked(async (journal, write) => {
        check(
          recoveryGrant !== null,
          "RECOVERY_GRANT_REQUIRED",
          "A separately approved recovery grant is required.",
        );
        check(
          step === recoveryGrant.step &&
            chainId === 1 &&
            same(wallet, plan.deployer) &&
            acknowledgement ===
              (step === 2 ? V10_LOST_PAGE_ACK : V10_UNSTARTED_FINAL_ACK),
          "RECOVERY_ACK_REQUIRED",
          "Only this explicitly reviewed unstarted step may be resumed.",
        );
        const row = journal.steps.find((r) => r.step === step);
        const delivery =
          recoveryGrant.kind === "v10-step4-unstarted-delivery-recovery";
        check(
          row?.state === "prepared" &&
            row.attempt === 1 &&
            !row.hash &&
            !row.confirmedHash &&
            !row.pendingHash &&
            !row.candidates?.length &&
            (delivery
              ? !!row.recovery
              : !row.recovery && !row.deliveryRecovery) &&
            !walletStarted(row) &&
            !journal.steps.some((r) => r.step > step),
          "RECOVERY_UNAVAILABLE",
          "Preserve the original handoff or hash; this state cannot be resumed.",
        );
        if (delivery)
          check(
            typeof clientCapability === "string" &&
              /^[a-f0-9]{64}$/.test(clientCapability) &&
              typeof clientDocumentId === "string" &&
              /^[A-Za-z0-9_-]{1,200}$/.test(clientDocumentId),
            "CAPABILITY_REQUIRED",
            "The saved source-scoped unsigned review key is required.",
          );
        const originalRow = delivery
            ? Object.fromEntries(
                Object.entries(row).filter(
                  ([key]) => key !== "deliveryRecovery",
                ),
              )
            : row,
          original = delivery ? row.recovery : row,
          originalHash = sha(canonical(originalRow));
        if (row.deliveryRecovery)
          check(
            row.deliveryRecovery.approvalHash === binding.approvalHash &&
              row.deliveryRecovery.capabilityHash === sha(clientCapability) &&
              row.deliveryRecovery.reviewHistory.length < 8,
            "CAPABILITY_REQUIRED",
            "Only the same saved unsigned review may be redelivered.",
          );
        const grantCurrent = () =>
          check(
            recoveryGrant.originalPreparedSha256 === originalHash &&
              recoveryGrant.originalApprovalHash ===
                (original.approvalHash ?? journal.approvalHash) &&
              recoveryGrant.originalPreparedAt === original.preparedAt &&
              recoveryGrant.originalAttempt === row.attempt &&
              Date.now() >= original.preparedAt + 60000 &&
              Date.now() < recoveryGrant.expiresAt &&
              recoveryGrant.expiresAt <= Date.now() + 30 * 60000,
            "RECOVERY_GRANT_REQUIRED",
            "The one-use original-attempt recovery grant is unavailable or expired.",
          );
        grantCurrent();
        // Re-check the confirmed predecessor, exact unused nonce/address, all source
        // and account pins, remaining total budget and gas. No transaction is sent.
        const proof = await checkedStep(journal, step),
          capability = delivery
            ? clientCapability
            : randomBytes(32).toString("hex");
        grantCurrent();
        check(
          sha(canonical(store.read().steps.find((r) => r.step === step))) ===
            sha(canonical(row)),
          "JOURNAL_SCOPE",
          "The original handoff changed during recovery checks.",
        );
        // Original preparedAt, proof, capabilityHash, attempt and history stay intact.
        if (delivery) {
          const prior = row.deliveryRecovery;
          if (prior)
            prior.reviewHistory.push(structuredClone(prior.currentReview));
          else
            row.deliveryRecovery = {
              kind: "explicit-unsigned-response-delivery",
              preparedAt: Date.now(),
              approvalHash: binding.approvalHash,
              bridgeSourceSha256: binding.bridgeSourceSha256,
              originalPreparedSha256: originalHash,
              capabilityHash: sha(capability),
              reviewHistory: [],
            };
          row.deliveryRecovery.currentReview = {
            reviewId: (prior?.currentReview?.reviewId ?? 0) + 1,
            documentId: clientDocumentId,
            preparedAt: Date.now(),
            proof,
          };
        } else
          row.recovery = {
            kind: "human-requested-lost-page",
            acknowledgement,
            preparedAt: Date.now(),
            approvalHash: binding.approvalHash,
            bridgeSourceSha256: binding.bridgeSourceSha256,
            originalPreparedSha256: originalHash,
            capabilityHash: sha(capability),
            proof,
          };
        write(journal);
        return {
          step,
          capability,
          planSha256: binding.planSha256,
          approvalHash: binding.approvalHash,
          validUntil: Date.now() + 60000,
          transaction: structuredClone(txFor(step)),
          proof: structuredClone(proof),
          ...(delivery
            ? { reviewId: row.deliveryRecovery.currentReview.reviewId }
            : {}),
        };
      });
    },
    ackPreparedResponse: async ({
      step,
      capability,
      clientDocumentId,
      reviewId,
    }) =>
      store.locked((journal, write) => {
        const row = journal.steps.find((r) => r.step === step),
          handoff = row?.deliveryRecovery;
        check(
          handoff &&
            typeof capability === "string" &&
            sha(capability) === handoff.capabilityHash &&
            handoff.approvalHash === binding.approvalHash &&
            handoff.currentReview.documentId === clientDocumentId &&
            Number.isSafeInteger(reviewId) &&
            handoff.currentReview.reviewId === reviewId,
          "CAPABILITY_REQUIRED",
          "Only the current unsigned-review document may acknowledge delivery.",
        );
        handoff.currentReview.responseReceivedAt ??= Date.now();
        write(journal);
        return { step, recorded: true };
      }),
    walletRequestStarted: async ({
      step,
      capability,
      clientDocumentId,
      reviewId,
    }) =>
      store.locked((journal, write) => {
        check(signingEnabled, "APPROVAL_REQUIRED", "Signing is disabled.");
        const row = journal.steps.find((r) => r.step === step),
          handoff = activeHandoff(row);
        check(
          v10WalletDeploymentApproval(plan, pinnedReview, recoveryGrant)
            .bridgeSourceSha256 === binding.bridgeSourceSha256,
          "SOURCE_CHANGED",
          "The reviewed bridge source changed.",
        );
        check(
          row?.state === "prepared" &&
            !row.hash &&
            typeof capability === "string" &&
            sha(capability) === handoff?.capabilityHash &&
            handoff.approvalHash === binding.approvalHash &&
            Date.now() <
              (handoff.currentReview?.preparedAt ?? handoff.preparedAt) +
                60000 &&
            !walletStarted(row) &&
            (!row.deliveryRecovery ||
              (handoff.currentReview.documentId === clientDocumentId &&
                Number.isSafeInteger(reviewId) &&
                handoff.currentReview.reviewId === reviewId &&
                handoff.currentReview.responseReceivedAt)),
          "CAPABILITY_REQUIRED",
          "The original active handoff is required, without replay.",
        );
        if (row.deliveryRecovery || row.recovery) {
          const field = row.deliveryRecovery ? "deliveryRecovery" : "recovery",
            recovery = row[field],
            original = Object.fromEntries(
              Object.entries(row).filter(([key]) => key !== field),
            );
          check(
            recoveryGrant &&
              Date.now() < recoveryGrant.expiresAt &&
              recovery.originalPreparedSha256 ===
                recoveryGrant.originalPreparedSha256 &&
              sha(canonical(original)) === recoveryGrant.originalPreparedSha256,
            "RECOVERY_GRANT_REQUIRED",
            "The original-attempt recovery grant changed or expired.",
          );
        }
        handoff.walletRequestStartedAt = Date.now();
        write(journal);
        return { step, recorded: true };
      }),
    prepareStep: async ({ step, wallet, chainId }) => {
      check(
        signingEnabled,
        "APPROVAL_REQUIRED",
        "Signing remains disabled until the exact plan and budget are approved.",
      );
      return store.locked(async (journal, write) => {
        check(
          chainId === 1 && same(wallet, plan.deployer),
          "WRONG_WALLET",
          "Connect the approved deployment wallet on Ethereum mainnet.",
        );
        const old = journal.steps.find((r) => r.step === step);
        check(
          !old || old.state === "rejected",
          "ALREADY_PREPARED",
          "This step already reached a wallet handoff. Recover its original hash; do not resend.",
        );
        const proof = await checkedStep(journal, step),
          capability = randomBytes(32).toString("hex");
        const row = {
          step,
          state: "prepared",
          capabilityHash: sha(capability),
          preparedAt: Date.now(),
          approvalHash: binding.approvalHash,
          bridgeSourceSha256: binding.bridgeSourceSha256,
          attempt: (old?.attempt ?? 0) + 1,
          proof,
          history: old
            ? [
                ...(old.history ?? []),
                Object.fromEntries(
                  Object.entries(structuredClone(old)).filter(
                    ([key]) => key !== "history",
                  ),
                ),
              ]
            : [],
        };
        journal.steps = [...journal.steps.filter((r) => r.step !== step), row];
        write(journal);
        return {
          step,
          capability,
          planSha256: binding.planSha256,
          approvalHash: binding.approvalHash,
          validUntil: Date.now() + 60000,
          transaction: structuredClone(txFor(step)),
          proof: structuredClone(proof),
        };
      });
    },
    recordSubmitted: async ({
      step,
      capability,
      hash: txHash,
      recovery = false,
    }) =>
      store.locked((journal, write) => {
        assertPlan();
        txFor(step);
        check(
          bytes32(txHash),
          "INVALID_HASH",
          "Enter the original wallet transaction hash.",
        );
        const row = journal.steps.find((r) => r.step === step);
        check(
          row &&
            (row.hash
              ? same(row.hash, txHash)
              : row.state === "prepared" || row.state === "uncertain"),
          "JOURNAL_SCOPE",
          "The hash must belong to an existing handoff for this step.",
        );
        check(
          row.hash ||
            recovery ||
            (typeof capability === "string" &&
              [
                row.capabilityHash,
                row.recovery?.capabilityHash,
                row.deliveryRecovery?.capabilityHash,
              ].includes(sha(capability))),
          "CAPABILITY_REQUIRED",
          "The original handoff capability or explicit hash recovery is required.",
        );
        if (!row.hash) {
          row.hash = txHash;
          row.state = "submitted";
          row.submittedAt = Date.now();
          row.candidates = [
            { hash: txHash, state: "known", knownAt: Date.now() },
          ];
          write(journal);
        }
        return publicState(journal);
      }),
    noteWalletError: async ({
      step,
      capability,
      code: walletCode,
      clientDocumentId,
      reviewId,
      phase,
      method,
    }) =>
      store.locked((journal, write) => {
        const row = journal.steps.find((r) => r.step === step);
        check(
          row &&
            !row.hash &&
            row.state === "prepared" &&
            typeof capability === "string" &&
            activeHandoff(row).approvalHash === binding.approvalHash &&
            sha(capability) === activeHandoff(row).capabilityHash &&
            (!row.deliveryRecovery ||
              (row.deliveryRecovery.currentReview.documentId ===
                clientDocumentId &&
                Number.isSafeInteger(reviewId) &&
                row.deliveryRecovery.currentReview.reviewId === reviewId)),
          "CAPABILITY_REQUIRED",
          "The original prepared wallet handoff is required.",
        );
        if (row.deliveryRecovery && !walletStarted(row)) {
          row.deliveryRecovery.currentReview.lastError = {
            code: [
              "WALLET_READ_TIMEOUT",
              "PREPARE_RESPONSE_UNAVAILABLE",
            ].includes(walletCode)
              ? walletCode
              : "REVIEW_STOPPED",
            phase: [
              "prepare-response",
              "wallet-read",
              "wallet-confirmation",
            ].includes(phase)
              ? phase
              : "prepare-response",
            method: [
              "eth_chainId",
              "eth_accounts",
              "eth_getBlockByNumber",
              "eth_getTransactionCount",
              "eth_getBalance",
              "eth_getCode",
            ].includes(method)
              ? method
              : null,
            at: Date.now(),
          };
        } else row.state = walletCode === 4001 ? "rejected" : "uncertain";
        write(journal);
        return publicState(journal);
      }),
    recoverCandidate,
    verifySetup,
    reconcile: async (step) => {
      const journal = store.read(),
        row = journal.steps.find((r) => r.step === step);
      check(
        row?.hash,
        "HASH_REQUIRED",
        "Preserve or enter the original transaction hash before receipt recovery.",
      );
      return recoverCandidate({
        step,
        hash: row.confirmedHash ?? row.pendingHash ?? row.hash,
      });
    },
    close: async () => {
      if (providerPromise) await (await providerPromise).destroy();
    },
  };
}

export async function startV10WalletDeploymentServer(options) {
  const service = createV10WalletDeployment(options),
    port = options.port ?? 0;
  let origin;
  const send = (res, code, data, type = "application/json") => {
    res.writeHead(code, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    });
    res.end(type === "application/json" ? JSON.stringify(data) : data);
  };
  const server = http.createServer(async (req, res) => {
    try {
      check(
        req.headers.host === new URL(origin).host &&
          ["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress),
        "LOOPBACK_REQUIRED",
        "Only this exact loopback origin may access the deployment bridge.",
      );
      const url = new URL(req.url, origin);
      if (req.method === "GET") {
        if (url.pathname === "/api/plan") return send(res, 200, service.plan());
        if (url.pathname === "/api/state")
          return send(res, 200, service.state());
        if (url.pathname === "/api/check")
          return send(
            res,
            200,
            await service.checkStep(Number(url.searchParams.get("step"))),
          );
        const files = {
          "/": ["index.html", "text/html; charset=utf-8"],
          "/deploy.js": ["deploy.js", "text/javascript; charset=utf-8"],
          "/style.css": ["style.css", "text/css; charset=utf-8"],
        };
        const file = files[url.pathname];
        if (file) {
          const bytes = fs.readFileSync(
            path.join(ROOT, "tools/v10-wallet", file[0]),
          );
          check(
            sha(bytes) ===
              service.plan().bridgeSources[`tools/v10-wallet/${file[0]}`],
            "SOURCE_CHANGED",
            "The reviewed local page source changed.",
          );
          return send(res, 200, bytes, file[1]);
        }
      }
      if (req.method === "POST") {
        check(
          req.headers.origin === origin &&
            req.headers["content-type"] === "application/json",
          "ORIGIN_REQUIRED",
          "Use the reviewed local page for this action.",
        );
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          check(body.length <= 4096, "INVALID_INPUT", "Request is too large.");
        }
        const value = JSON.parse(body);
        if (
          ["/api/prepare-step", "/api/recover-prepared-step"].includes(
            url.pathname,
          )
        )
          check(
            value.planSha256 === service.plan().planSha256 &&
              value.approvalHash === service.plan().approvalHash,
            "APPROVAL_REQUIRED",
            "Refresh the exact amended review before preparing a wallet request.",
          );
        if (url.pathname === "/api/prepare-step")
          return send(res, 200, await service.prepareStep(value));
        if (url.pathname === "/api/recover-prepared-step")
          return send(res, 200, await service.recoverPreparedStep(value));
        if (url.pathname === "/api/wallet-request-started")
          return send(res, 200, await service.walletRequestStarted(value));
        if (url.pathname === "/api/ack-prepared-response")
          return send(res, 200, await service.ackPreparedResponse(value));
        if (url.pathname === "/api/record-submitted")
          return send(res, 200, await service.recordSubmitted(value));
        if (url.pathname === "/api/wallet-error")
          return send(res, 200, await service.noteWalletError(value));
        if (url.pathname === "/api/receipt")
          return send(res, 200, await service.reconcile(value.step));
        if (url.pathname === "/api/recover-candidate")
          return send(res, 200, await service.recoverCandidate(value));
        if (url.pathname === "/api/verify-setup")
          return send(res, 200, await service.verifySetup());
      }
      send(res, 404, {
        code: "NOT_FOUND",
        message: "Unknown local deployment route.",
      });
    } catch (error) {
      send(res, error.status ?? 409, {
        code: /^[A-Z_]{1,48}$/.test(error.code ?? "")
          ? error.code
          : "READ_UNAVAILABLE",
        message:
          "Deployment action stopped. Keep any known hash and use receipt recovery; no resend was authorized.",
      });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    service,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await service.close();
    },
  };
}
