// All providers/wallets here are synthetic. The real integration uses a fresh in-process Ganache1,
// never a public RPC, the human wallet, persisted keys or a real wallet confirmation.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ethers } from "ethers";
import ganache from "ganache";
import {
  verifyV10Build,
  prepareV10Release,
} from "../scripts/mainnet/prepare-v10-release.mjs";
import { loadDelegatedCreateReview } from "../scripts/mainnet/preflight-v10-release.mjs";
import { v10RuntimeCode } from "../scripts/mainnet/v10-runtime-code.mjs";
import {
  createV10WalletDeployment,
  startV10WalletDeploymentServer,
  createV10PacedFetcher,
  verifyV10WalletDeploymentPlan,
  v10WalletDeploymentApproval,
  USER_DEPLOYER,
} from "../src/v10-wallet-deployment.mjs";
import {
  handoffOne,
  assertPrepared,
  savedHashKey,
  readSavedHash,
} from "../tools/v10-wallet/deploy.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url)),
  build = verifyV10Build();
const addr = "0x0000000000000000000000000000000000000042",
  hash = ethers.id("synthetic-v10-wallet-hash"),
  headHash = ethers.id("synthetic-v10-head");
const errorCode = (code) => (error) => error.code === code;
const reviewInput = {
  file: "artifacts/v10-release/delegated-four-create-review.json",
  sha256: "8769e4c2663c1746e083428b0681c84c66e6de68daa93f0cd256376e7d9c5a14",
};
const observed = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "artifacts/v10-integration/metamask-runtime-observed.json"),
    "utf8",
  ),
);
const planFor = (wallet = addr) =>
  prepareV10Release(
    {
      schemaVersion: 1,
      version: 10,
      contractVersion: "kleros-event-v10-uups",
      chainId: 1,
      deployer: wallet,
      deployerNonce: 0,
      governance: {
        kind: "single-owner-immediate",
        initialOwner: wallet,
        upgradeDelaySeconds: 0,
        renounceable: true,
      },
      fees: {
        maxFeePerGasWei: "4000000000",
        maxPriorityFeePerGasWei: "1000000",
      },
      gasLimits: {
        KlerosUpgradeControllerV10: "850000",
        KlerosEventV10: "5600000",
        KlerosEventFactoryV10: "2000000",
        ERC1967Proxy: "300000",
      },
      maxTotalGasCostWei: "35000000000000000",
    },
    build,
  );
function fakeProvider({ delegated = false } = {}) {
  const calls = [],
    codes = new Map(
      observed.contracts.map((c) => [c.address.toLowerCase(), c.code]),
    );
  const f = {
    calls,
    nonce: 0,
    balance: 10n ** 20n,
    walletCode: delegated
      ? "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b"
      : "0x",
    headHash,
    actual: null,
    receipt: null,
    codes,
  };
  f.p = {
    send: async (method, params = []) => {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_getBlockByNumber")
        return {
          number: "0x32",
          hash: f.headHash,
          timestamp: "0x77359400",
          baseFeePerGas: "0x1",
          gasLimit: "0x1c9c380",
        };
      if (method === "eth_getCode")
        return params[0].toLowerCase() === addr.toLowerCase()
          ? f.walletCode
          : (codes.get(params[0].toLowerCase()) ?? "0x");
      if (method === "eth_getTransactionCount")
        return ethers.toQuantity(
          params[0].toLowerCase() === addr.toLowerCase() ? f.nonce : 0,
        );
      if (method === "eth_getBalance") return ethers.toQuantity(f.balance);
      throw Error("Unexpected synthetic read " + method);
    },
    getTransaction: async () => f.actual,
    getTransactionReceipt: async () => f.receipt,
    getBlock: async () => ({ number: 50, hash: f.headHash, baseFeePerGas: 1n }),
    getCode: async (address) => codes.get(address.toLowerCase()) ?? "0x",
    estimateGas: async () => 100000n,
    destroy: () => {},
  };
  return f;
}
function fixture({
  delegated = false,
  enabled = true,
  verifyFactory,
  plan = planFor(),
  providerFactory,
  verifySources,
  loadDelegatedReview,
} = {}) {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "v10-wallet-deployment-"),
    ),
    fake = fakeProvider({ delegated }),
    journalFile = path.join(directory, "journal.json");
  const common = {
    plan,
    journalFile,
    expectedWallet: plan.deployer,
    providerFactory: providerFactory ?? (async () => fake.p),
    verifySources: verifySources ?? ((p) => ({ plan: p, build })),
    ...(delegated ? { delegatedCreateReview: reviewInput } : {}),
    ...(loadDelegatedReview ? { loadDelegatedReview } : {}),
    ...(verifyFactory ? { verifyFactory } : {}),
  };
  const readOnly = createV10WalletDeployment(common),
    binding = readOnly.plan();
  const service = enabled
    ? createV10WalletDeployment({
        ...common,
        enableWalletSigning: true,
        approvalHash: binding.approvalHash,
      })
    : readOnly;
  return {
    directory,
    fake,
    plan,
    common,
    binding,
    service,
    journalFile,
    close: async () => {
      await service.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("sealed V10 source reproduces all four direct CREATEs and rejects V9/governance/fee/calldata/source mutation", () => {
  const p = planFor();
  assert.equal(
    verifyV10WalletDeploymentPlan(p, { expectedWallet: addr }).plan.transactions
      .length,
    4,
  );
  const binding = v10WalletDeploymentApproval(p);
  for (const mutate of [
    (v) => (v.contractVersion = "kleros-event-v9-uups"),
    (v) => (v.governance.kind = "single-owner-timelock"),
    (v) => (v.governance.upgradeDelaySeconds = 172800),
    (v) => (v.transactions[0].data += "00"),
    (v) => (v.transactions[0].type = 4),
    (v) => (v.transactions[0].nonce = 3),
    (v) => (v.transactions[0].maxFeePerGasWei = "5000000000"),
    (v) => (v.provenance.v10BuildManifestSha256 = "f".repeat(64)),
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    assert.notEqual(
      v10WalletDeploymentApproval(changed).approvalHash,
      binding.approvalHash,
    );
    assert.throws(() =>
      verifyV10WalletDeploymentPlan(changed, { expectedWallet: addr }),
    );
  }
  assert.throws(
    () =>
      createV10WalletDeployment({
        plan: p,
        expectedWallet: addr,
        enableWalletSigning: true,
        approvalHash: "unapproved",
      }),
    errorCode("APPROVAL_REQUIRED"),
  );
});

test("default mode has no RPC, journal creation or signing; CLI prints the exact normalized delegated review approval", async () => {
  const f = fixture({ enabled: false });
  try {
    assert.equal(f.service.plan().signingEnabled, false);
    await assert.rejects(
      f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      errorCode("APPROVAL_REQUIRED"),
    );
    assert.equal(f.fake.calls.length, 0);
    assert.equal(fs.existsSync(f.journalFile), false);
  } finally {
    await f.close();
  }
  const result = spawnSync(
    process.execPath,
    [
      "scripts/serve-v10-deployment.mjs",
      "--delegated-review",
      reviewInput.file,
      "--delegated-review-sha256",
      reviewInput.sha256,
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr);
  const review = JSON.parse(result.stdout);
  assert.equal(review.status, "review-only");
  assert.equal(review.signingEnabled, false);
  assert.equal(review.networkRequests, 0);
  assert.equal(review.journalWrites, 0);
  assert.equal(review.delegatedCreateReview.sha256, reviewInput.sha256);
  assert.equal(review.delegatedCreateReview.facts.framework.length, 3);
  assert.equal(
    review.planSha256,
    "2e525e6de33c768b7a592b075d002540447dea7fd5205716519cef5bc1bf0e37",
  );
  assert.equal(
    review.approvalHash,
    v10WalletDeploymentApproval(review.plan, review.delegatedCreateReview)
      .approvalHash,
  );
  assert.equal(review.terms.upgradeDelaySeconds, 0);
  assert.equal(review.terms.courtVerified, false);
});

test("delegated preflight reloads source/protocol review and freshly checks designation plus all3 codes at one canonical head and closing", async () => {
  let loads = 0;
  const f = fixture({
    delegated: true,
    loadDelegatedReview: (...args) => {
      loads++;
      return loadDelegatedCreateReview(...args);
    },
  });
  try {
    const before = loads,
      p = await f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 });
    assert.equal(loads, before + 1);
    assert.equal(
      p.proof.walletCompatibility.kind,
      "reviewed-delegated-direct-create",
    );
    const reads = f.fake.calls.filter((x) => x.method === "eth_getCode");
    for (const account of [addr, ...observed.contracts.map((c) => c.address)]) {
      const rows = reads.filter(
        (x) => x.params[0].toLowerCase() === account.toLowerCase(),
      );
      assert.equal(rows.length, 2);
      assert(rows.every((x) => x.params[1] === "0x32"));
    }
    assert.equal(fs.statSync(f.journalFile).mode & 0o777, 0o600);
    assert(p.validUntil > Date.now() && p.validUntil <= Date.now() + 60000);
  } finally {
    await f.close();
  }
});

test("unknown designation, framework mutation, canonical reorg and review hash change stop before journal handoff", async () => {
  for (const kind of [
    "designation",
    "runtime",
    "closing-runtime",
    "reorg",
    "review",
  ]) {
    let loads = 0;
    const f = fixture({
      delegated: true,
      loadDelegatedReview: (...args) => {
        loads++;
        if (kind === "review" && loads > 2)
          throw Object.assign(Error("Synthetic proof changed"), {
            code: "DELEGATED_CREATE_PROOF_HASH_MISMATCH",
          });
        return loadDelegatedCreateReview(...args);
      },
    });
    try {
      if (kind === "designation") f.fake.walletCode = "0x6000";
      if (kind === "runtime")
        f.fake.codes.set(observed.contracts[0].address.toLowerCase(), "0x6000");
      const original = f.fake.p.send;
      let walletReads = 0;
      f.fake.p.send = async (method, params) => {
        if (
          method === "eth_getCode" &&
          params[0].toLowerCase() === addr.toLowerCase() &&
          ++walletReads === 2
        ) {
          if (kind === "closing-runtime")
            f.fake.codes.set(
              observed.contracts[0].address.toLowerCase(),
              "0x6000",
            );
          if (kind === "reorg") f.fake.headHash = ethers.id("changed-head");
        }
        return original(method, params);
      };
      await assert.rejects(
        f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      );
      assert.equal(fs.existsSync(f.journalFile), false);
    } finally {
      await f.close();
    }
  }
});

test("once journal precedes wallet handoff; unknown results and all submitted hashes stay locked with no replay", async () => {
  const f = fixture();
  try {
    const p = await f.service.prepareStep({
      step: 1,
      wallet: addr,
      chainId: 1,
    });
    assert.equal(
      JSON.parse(fs.readFileSync(f.journalFile)).steps[0].state,
      "prepared",
    );
    await assert.rejects(
      f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      errorCode("ALREADY_PREPARED"),
    );
    await f.service.noteWalletError({
      step: 1,
      capability: p.capability,
      code: null,
    });
    await assert.rejects(
      f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      errorCode("ALREADY_PREPARED"),
    );
    const reads = f.fake.calls.length;
    await f.service.recordSubmitted({ step: 1, hash, recovery: true });
    assert.equal(f.fake.calls.length, reads);
    assert.equal(f.service.state().steps[0].hash, hash);
    await assert.rejects(
      f.service.recordSubmitted({
        step: 1,
        hash: ethers.id("other"),
        recovery: true,
      }),
      errorCode("JOURNAL_SCOPE"),
    );
    const restarted = createV10WalletDeployment({
      ...f.common,
      enableWalletSigning: true,
      approvalHash: f.binding.approvalHash,
    });
    assert.equal(restarted.state().steps[0].hash, hash);
    await assert.rejects(
      restarted.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      errorCode("ALREADY_PREPARED"),
    );
    await restarted.close();
  } finally {
    await f.close();
  }
});

test("nonce, balance, fees, gas ceiling and occupied predicted address remain authoritative", async () => {
  for (const kind of ["nonce", "balance", "fee", "gas", "occupied"]) {
    const f = fixture();
    try {
      if (kind === "nonce") f.fake.nonce = 1;
      if (kind === "balance") f.fake.balance = 0n;
      if (kind === "gas") f.fake.p.estimateGas = async () => 99999999n;
      if (kind === "occupied")
        f.fake.codes.set(
          f.plan.transactions[0].predictedAddress.toLowerCase(),
          "0x6000",
        );
      if (kind === "fee") {
        const original = f.fake.p.send;
        f.fake.p.send = async (m, p) =>
          m === "eth_getBlockByNumber"
            ? { ...(await original(m, p)), baseFeePerGas: "0x2540be400" }
            : original(m, p);
      }
      await assert.rejects(
        f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      );
      assert.equal(fs.existsSync(f.journalFile), false);
    } finally {
      await f.close();
    }
  }
});

test("returned type4/wrapper or altered envelope enters human-review without canonical adoption or resend", async () => {
  const f = fixture();
  try {
    const p = await f.service.prepareStep({
      step: 1,
      wallet: addr,
      chainId: 1,
    });
    await f.service.recordSubmitted({
      step: 1,
      capability: p.capability,
      hash,
    });
    const tx = f.plan.transactions[0];
    f.fake.actual = {
      hash,
      from: addr,
      to: observed.contracts[0].address,
      nonce: tx.nonce,
      chainId: 1n,
      type: 4,
      value: 0n,
      data: tx.data,
      gasLimit: BigInt(tx.gasLimit),
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    };
    const proof = await f.service.reconcile(1);
    assert.equal(proof.status, "human-review");
    assert.equal(f.service.state().steps[0].state, "human-review");
    assert.equal(f.service.state().steps[0].hash, hash);
    await assert.rejects(
      f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      errorCode("ALREADY_PREPARED"),
    );
  } finally {
    await f.close();
  }
});

function walletFixture({ delegated = true } = {}) {
  const plan = planFor(USER_DEPLOYER),
    facts = loadDelegatedCreateReview(
      reviewInput.file,
      reviewInput.sha256,
      build,
    ).facts;
  const framework = facts.framework.map((item) => ({
    ...item,
    code: observed.contracts.find((c) => c.name === item.name).code,
  }));
  const review = {
    plan,
    terms: { upgradeDelaySeconds: 0 },
    ...v10WalletDeploymentApproval(plan),
    signingEnabled: true,
    delegatedCreateReview: { facts: { ...facts, framework } },
  };
  const prepared = {
    planSha256: review.planSha256,
    approvalHash: review.approvalHash,
    step: 1,
    validUntil: Date.now() + 60000,
    capability: "synthetic-capability",
    transaction: plan.transactions[0],
    proof: {
      walletCompatibility: delegated
        ? {
            kind: "reviewed-delegated-direct-create",
            walletCode: facts.walletDesignation,
            framework,
          }
        : { kind: "eoa", walletCode: "0x", framework: [] },
    },
  };
  const calls = [],
    events = [];
  let mutate = null;
  const provider = {
    request: async (p) => {
      calls.push(p);
      if (mutate) {
        const result = mutate(p);
        if (result !== undefined) return result;
      }
      if (p.method === "eth_chainId") return "0x1";
      if (p.method === "eth_accounts") return [USER_DEPLOYER];
      if (p.method === "eth_getBlockByNumber")
        return { number: "0x32", hash: headHash, baseFeePerGas: "0x1" };
      if (p.method === "eth_getTransactionCount")
        return p.params[0].toLowerCase() === USER_DEPLOYER.toLowerCase()
          ? "0x0"
          : "0x0";
      if (p.method === "eth_getBalance") return "0x56bc75e2d63100000";
      if (p.method === "eth_getCode")
        return p.params[0].toLowerCase() === USER_DEPLOYER.toLowerCase()
          ? prepared.proof.walletCompatibility.walletCode
          : (framework.find(
              (x) => x.address.toLowerCase() === p.params[0].toLowerCase(),
            )?.code ?? "0x");
      if (p.method === "eth_sendTransaction") {
        events.push("wallet");
        return hash;
      }
      throw Error("Unknown stub method");
    },
  };
  const api = {
    prepare: async () => prepared,
    submitted: async () => {
      events.push("server-hash");
    },
    walletError: async () => {
      events.push("uncertain");
    },
  };
  return {
    review,
    prepared,
    calls,
    events,
    provider,
    api,
    setMutation: (fn) => {
      mutate = fn;
    },
  };
}

test("client checks fresh exact delegated runtime bytes and one direct CREATE, saving original hash before server await", async () => {
  const f = walletFixture();
  assertPrepared(f.review, 1, f.prepared);
  const result = await handoffOne({
    ...f,
    step: 1,
    saveHash: () => f.events.push("local-hash"),
  });
  assert.equal(result.hash, hash);
  assert.deepEqual(f.events, ["wallet", "local-hash", "server-hash"]);
  const send = f.calls.find((p) => p.method === "eth_sendTransaction");
  assert.equal(send.params[0].to, undefined);
  assert.equal(send.params[0].type, "0x2");
  assert.equal(send.params[0].data, f.review.plan.transactions[0].data);
  for (const item of observed.contracts) {
    const reads = f.calls.filter(
      (p) =>
        p.method === "eth_getCode" &&
        p.params[0].toLowerCase() === item.address.toLowerCase(),
    );
    assert.equal(reads.length, 2);
    assert(reads.every((p) => p.params[1] === "0x32"));
  }
  const storage = {
    getItem: () =>
      JSON.stringify({
        planSha256: f.review.planSha256,
        wallet: USER_DEPLOYER,
        chainId: 1,
        step: 1,
        nonce: 0,
        hash,
      }),
  };
  assert.equal(readSavedHash(storage, f.review, 1).hash, hash);
  assert(savedHashKey(f.review, 1).startsWith("v10-mainnet-setup:"));
});

test("client code/context/expiry faults cause zero wallet sends and retain uncertain lock semantics", async () => {
  for (const kind of [
    "runtime",
    "designation",
    "reorg",
    "expired",
    "context",
  ]) {
    const f = walletFixture();
    let blockReads = 0;
    if (kind === "expired") f.prepared.validUntil = Date.now() - 1;
    f.setMutation((p) => {
      if (
        kind === "runtime" &&
        p.method === "eth_getCode" &&
        p.params[0].toLowerCase() ===
          observed.contracts[0].address.toLowerCase()
      )
        return "0x6000";
      if (
        kind === "designation" &&
        p.method === "eth_getCode" &&
        p.params[0].toLowerCase() === USER_DEPLOYER.toLowerCase()
      )
        return "0x6000";
      if (
        kind === "reorg" &&
        p.method === "eth_getBlockByNumber" &&
        ++blockReads === 2
      )
        return {
          number: "0x32",
          hash: ethers.id("reorg"),
          baseFeePerGas: "0x1",
        };
    });
    await assert.rejects(
      handoffOne({ ...f, step: 1, isCurrent: () => kind !== "context" }),
    );
    assert.equal(
      f.calls.filter((p) => p.method === "eth_sendTransaction").length,
      0,
    );
  }
});

test("actual local four-CREATE receipts verify V10 immediate owner/controller/factory with two confirmations; no Court attestation", async () => {
  const rpc = ganache.provider({
      logging: { quiet: true },
      chain: { chainId: 1 },
      wallet: { totalAccounts: 2 },
      miner: { blockGasLimit: 30000000 },
    }),
    signerProvider = new ethers.BrowserProvider(rpc);
  const signer = await signerProvider.getSigner(0),
    wallet = await signer.getAddress(),
    plan = planFor(wallet),
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "v10-actual-four-create-"),
    );
  const service = createV10WalletDeployment({
    plan,
    expectedWallet: wallet,
    journalFile: path.join(directory, "journal.json"),
    enableWalletSigning: true,
    approvalHash: v10WalletDeploymentApproval(plan).approvalHash,
    verifySources: (p) => ({ plan: p, build }),
    providerFactory: async () =>
      new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }),
  });
  try {
    for (const tx of plan.transactions) {
      const prepared = await service.prepareStep({
        step: tx.step,
        wallet,
        chainId: 1,
      });
      const sent = await signer.sendTransaction({
        from: wallet,
        data: tx.data,
        nonce: tx.nonce,
        type: 2,
        value: 0,
        gasLimit: BigInt(tx.gasLimit),
        maxFeePerGas: BigInt(tx.maxFeePerGasWei),
        maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasWei),
      });
      await service.recordSubmitted({
        step: tx.step,
        capability: prepared.capability,
        hash: sent.hash,
      });
      await sent.wait();
      await rpc.request({ method: "evm_mine", params: [] });
      const receipt = await service.reconcile(tx.step);
      assert.equal(receipt.status, "confirmed");
      assert(receipt.receipt.confirmations >= 2);
    }
    const setup = await service.verifySetup();
    assert.equal(setup.status, "verified");
    assert.equal(setup.upgrade.version, 10);
    assert.equal(setup.upgrade.governanceKind, "single-owner-immediate");
    assert.equal(setup.upgrade.delaySeconds, 0);
    assert.equal(setup.upgrade.upgradesDisabled, false);
    assert.equal(setup.upgrade.owner.toLowerCase(), wallet.toLowerCase());
    assert.equal(setup.upgrade.pendingOwner, ethers.ZeroAddress);
    assert.equal(service.plan().terms.courtVerified, false);
    assert.equal(service.plan().terms.eventCreationIncluded, false);
  } finally {
    await service.close();
    await signerProvider.destroy();
    await rpc.disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("loopback HTTP serves only isolated V10 assets and default review routes cannot initialize RPC or signing", async () => {
  const f = fixture({ enabled: false });
  const app = await startV10WalletDeploymentServer({ ...f.common, port: 0 });
  try {
    const review = await (await fetch(app.origin + "/api/plan")).json();
    assert.equal(review.signingEnabled, false);
    assert.equal(review.plan.contractVersion, "kleros-event-v10-uups");
    const html = await (await fetch(app.origin + "/")).text();
    assert.match(html, /NEW V10 SETUP ONLY/);
    assert.match(html, /no mandatory delay/);
    assert.doesNotMatch(html, /48.hour|timelock/i);
    const response = await fetch(app.origin + "/api/prepare-step", {
      method: "POST",
      headers: { origin: app.origin, "content-type": "application/json" },
      body: JSON.stringify({ step: 1, wallet: addr, chainId: 1 }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "APPROVAL_REQUIRED");
    const foreign = await fetch(app.origin + "/api/prepare-step", {
      method: "POST",
      headers: {
        origin: "https://foreign.invalid",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal((await foreign.json()).code, "ORIGIN_REQUIRED");
    const host = await new Promise((resolve, reject) => {
      const req = http.get(
        app.origin + "/api/plan",
        { headers: { host: "foreign.invalid" } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => resolve(JSON.parse(body)));
        },
      );
      req.on("error", reject);
    });
    assert.equal(host.code, "LOOPBACK_REQUIRED");
    assert.equal(f.fake.calls.length, 0);
    assert.equal(fs.existsSync(f.journalFile), false);
  } finally {
    await app.close();
    await f.close();
  }
});

test("bridge pacing serializes fetch admission at1500ms and aborts queued reads without a fetch or response rewrite", async () => {
  let time = 1000,
    active = 0,
    peak = 0,
    release;
  const starts = [],
    waits = [],
    response = { status: 200, synthetic: true };
  const paced = createV10PacedFetcher({
    now: () => time,
    sleep: async (ms) => {
      waits.push(ms);
      time += ms;
    },
    fetcher: async () => {
      starts.push(time);
      active++;
      peak = Math.max(peak, active);
      if (starts.length === 1)
        await new Promise((resolve) => {
          release = resolve;
        });
      active--;
      return response;
    },
  });
  const first = paced("https://synthetic.invalid"),
    controller = new AbortController(),
    aborted = paced("https://synthetic.invalid", { signal: controller.signal }),
    third = paced("https://synthetic.invalid");
  const rejected = assert.rejects(
    aborted,
    (error) => error.name === "AbortError",
  );
  while (!release) await new Promise(setImmediate);
  controller.abort();
  await rejected;
  assert.equal(starts.length, 1);
  release();
  assert.equal(await first, response);
  assert.equal(await third, response);
  assert.deepEqual(starts, [1000, 2500]);
  assert.deepEqual(waits, [1500]);
  assert.equal(peak, 1);
  let clock = 0;
  const earlyWaits = [],
    earlyStarts = [];
  const early = createV10PacedFetcher({
    now: () => clock,
    sleep: async (ms) => {
      earlyWaits.push(ms);
      clock += Math.max(1, ms - 1);
    },
    fetcher: async () => {
      earlyStarts.push(clock);
      return response;
    },
  });
  await Promise.all([
    early("https://synthetic.invalid"),
    early("https://synthetic.invalid"),
  ]);
  assert.deepEqual(earlyStarts, [0, 1500]);
  assert.deepEqual(earlyWaits, [1500, 1]);
});
