// User-wallet handoff only. This module has no signer, private-key or broadcast API.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { ethers } from "ethers";
import { createReadOnlyHttpProvider } from "./mainnet-runtime.mjs";
import { verifyV9ArtifactSources } from "./upgrade-artifacts.mjs";
import {
  loadUpgradeableArtifacts,
  verifyV9FactoryDeployment,
  V9_MAINNET_SCOPE,
} from "./upgrade-verification.mjs";
import {
  prepareRelease,
  validateReleaseConfig,
} from "../scripts/mainnet/prepare-release.mjs";
import {
  verifyKleros,
  validatePublicMainnetRpc,
} from "../scripts/mainnet/verify-kleros.mjs";
import {
  createVerificationRuntime,
  allowedVerificationMethod,
} from "../scripts/mainnet/verification-runtime.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const USER_DEPLOYER = "0x2bb03593892724d225071068E59ab1E48aF05b55";
const NAMES = [
  "KlerosUpgradeTimelockV9",
  "KlerosEventV9",
  "KlerosEventFactoryV9",
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
  "src/mainnet-wallet-deployment.mjs",
  "scripts/serve-mainnet-deployment.mjs",
  "tools/mainnet-wallet/index.html",
  "tools/mainnet-wallet/deploy.js",
  "tools/mainnet-wallet/style.css",
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

export function walletDeploymentApproval(plan) {
  const planSha256 = sha(canonical(plan));
  const bridgeSources = bridgeSourceHashes(),
    bridgeSourceSha256 = sha(canonical(bridgeSources));
  return {
    planSha256,
    bridgeSourceSha256,
    bridgeSources,
    approvalHash: sha(
      canonical({
        purpose: "four-create-mainnet-setup-only",
        planSha256,
        bridgeSourceSha256,
        chainId: 1,
        deployer: plan.deployer,
        maxTotalGasCostWei: plan.maxTotalGasCostWei,
      }),
    ),
  };
}

function validateShape(input, expectedWallet) {
  const p = structuredClone(input),
    config = validateReleaseConfig(p.configuration);
  check(
    p.schemaVersion === 1 &&
      p.status === "unsigned-review-only" &&
      p.contractVersion === "kleros-event-v9-uups" &&
      p.chainId === 1 &&
      p.startingNonce === config.deployerNonce &&
      same(p.deployer, expectedWallet) &&
      same(p.deployer, config.deployer) &&
      same(p.governance?.initialOwner, p.deployer) &&
      p.governance.kind === "single-owner-timelock" &&
      p.minimumDelaySeconds === 172800 &&
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

/** No recompilation or RPC; the approved inputs and shipped artifacts must reproduce every byte. */
export function verifyWalletDeploymentPlan(
  plan,
  { expectedWallet = USER_DEPLOYER } = {},
) {
  plan = validateShape(plan, expectedWallet);
  const manifest = verifyV9ArtifactSources(plan.provenance),
    artifacts = loadUpgradeableArtifacts();
  const inputBytes = fs.readFileSync(
    path.join(ROOT, "build/contracts-v9/standard-input.json"),
  );
  const build = {
    compiler: manifest.compiler,
    settings: manifest.settings,
    contracts: {
      KlerosUpgradeTimelockV9: artifacts.timelock,
      KlerosEventV9: artifacts.event,
      KlerosEventFactoryV9: artifacts.factory,
      ERC1967Proxy: artifacts.proxy,
    },
    standardInputSha256: plan.provenance.v9StandardInputSha256,
    standardInputFileSha256: sha(inputBytes),
    buildManifestSha256: plan.provenance.v9BuildManifestSha256,
    sourceHashes: manifest.sources,
  };
  check(
    canonical(prepareRelease(plan.configuration, build)) === canonical(plan),
    "SOURCE_CHANGED",
    "The unsigned plan no longer matches the reviewed source and artifacts.",
  );
  return plan;
}

function journalStore(filename, binding) {
  check(
    path.isAbsolute(filename),
    "JOURNAL_SCOPE",
    "Use an explicit dedicated deployment journal.",
  );
  const empty = () => ({ version: 1, chainId: 1, ...binding, steps: [] });
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
export function createMainnetWalletDeployment({
  plan: input,
  journalFile,
  enableWalletSigning = false,
  approvalHash,
  expectedWallet = USER_DEPLOYER,
  providerFactory,
  verifySources = verifyWalletDeploymentPlan,
  verifyCourt = verifyKleros,
  verifyFactory = verifyV9FactoryDeployment,
  rpcUrl = "https://ethereum-rpc.publicnode.com",
  confirmations = 2,
} = {}) {
  const plan = freeze(validateShape(input, expectedWallet)),
    binding = { ...walletDeploymentApproval(plan), deployer: plan.deployer };
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
  journalFile ??= path.join(
    ROOT,
    ".runtime/mainnet",
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
      const p = await (providerFactory ?? createReadOnlyHttpProvider)(rpcUrl, {
        timeoutMs: 20000,
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
      };
    }),
    setup: journal.setup ?? { status: "not-verified" },
  });
  async function receiptFact(p, tx, hashValue) {
    await p.send("eth_chainId", []);
    const [actual, receipt, head] = await Promise.all([
      p.getTransaction(hashValue),
      p.getTransactionReceipt(hashValue),
      p.getBlock("latest"),
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
    const [timelock, implementation, factoryImplementation, proxy] = confirmed;
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
      upgradeAuthority: timelock.tx.predictedAddress,
      upgradeAuthorityCodeHash: timelock.tx.expectedRuntimeCodeHash,
      initialUpgradeOwner: plan.deployer,
      factoryDeploymentTxHash: proxy.hash,
      factoryDeploymentBlock: proxy.receipt.blockNumber,
      timelockDeploymentTxHash: timelock.hash,
      timelockDeploymentBlock: timelock.receipt.blockNumber,
    };
    const proof = await verifyFactory(
      {
        provider: p,
        production: true,
        chainId: 1,
        governance: plan.governance,
        manifest: { provenance: plan.provenance },
      },
      F,
      V9_MAINNET_SCOPE,
    );
    check(
      proof?.deploymentTrust?.status === "verified" &&
        same(proof.eventImplementation, implementation.tx.predictedAddress) &&
        same(proof.upgrade?.owner, plan.deployer) &&
        proof.upgrade.pendingOwner === null &&
        Number(proof.upgrade.pendingOperationCount) === 0 &&
        Number(proof.upgrade.executingOperationCount) === 0 &&
        proof.upgrade.delaySeconds >= 172800,
      "SETUP_GOVERNANCE_CHANGED",
      "The deployed factory or initial owner/timelock governance needs human review.",
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
      walletDeploymentApproval(plan).bridgeSourceSha256 ===
        binding.bridgeSourceSha256,
      "SOURCE_CHANGED",
      "The reviewed wallet-bridge source changed; obtain a new explicit review.",
    );
    const tx = txFor(step);
    await verifySources(plan, { expectedWallet });
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
    const court = await verifyCourt({
      rpcUrl,
      transport: { request: p.send, endpoint: rpcUrl },
    });
    check(
      court?.status === "verified-read-only" && court.chainId === 1,
      "COURT_UNAVAILABLE",
      "The reviewed Ethereum Court preflight is unavailable.",
    );
    const head = await p.getBlock("latest");
    const [pending, latest, balance, accountCode, targetCode, targetNonce] =
      await Promise.all([
        p.getTransactionCount(plan.deployer, "pending"),
        p.getTransactionCount(plan.deployer, head.number),
        p.getBalance(plan.deployer, head.number),
        p.getCode(plan.deployer, head.number),
        p.getCode(tx.predictedAddress, head.number),
        p.getTransactionCount(tx.predictedAddress, head.number),
      ]);
    check(
      pending === tx.nonce && latest === tx.nonce && accountCode === "0x",
      "NONCE_CHANGED",
      "The approved wallet must be an EOA at the exact planned pending nonce.",
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
      (await p.getTransactionCount(plan.deployer, "pending")) === tx.nonce &&
        same((await p.getBlock(head.number))?.hash, head.hash),
      "NONCE_CHANGED",
      "The nonce or canonical head changed during preflight.",
    );
    if (court.block)
      check(
        same((await p.getBlock(court.block.number))?.hash, court.block.hash),
        "COURT_UNAVAILABLE",
        "Court preflight anchor changed.",
      );
    return {
      step,
      block: { number: head.number, hash: head.hash },
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
        permanentDelaySeconds: 172800,
      },
    }),
    state: () => publicState(store.read()),
    checkStep: async (step) => checkedStep(store.read(), step),
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
          attempt: (old?.attempt ?? 0) + 1,
          proof,
          history: old
            ? [
                ...(old.history ?? []),
                {
                  state: old.state,
                  preparedAt: old.preparedAt,
                  attempt: old.attempt,
                },
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
              sha(capability) === row.capabilityHash),
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
    noteWalletError: async ({ step, capability, code: walletCode }) =>
      store.locked((journal, write) => {
        const row = journal.steps.find((r) => r.step === step);
        check(
          row &&
            !row.hash &&
            row.state === "prepared" &&
            typeof capability === "string" &&
            sha(capability) === row.capabilityHash,
          "CAPABILITY_REQUIRED",
          "The original prepared wallet handoff is required.",
        );
        row.state = walletCode === 4001 ? "rejected" : "uncertain";
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

export async function startMainnetWalletDeploymentServer(options) {
  const service = createMainnetWalletDeployment(options),
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
            path.join(ROOT, "tools/mainnet-wallet", file[0]),
          );
          check(
            sha(bytes) ===
              service.plan().bridgeSources[`tools/mainnet-wallet/${file[0]}`],
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
        if (url.pathname === "/api/prepare-step")
          return send(res, 200, await service.prepareStep(value));
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
