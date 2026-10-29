// All transactions below execute only on a new in-process Ganache chain1 with synthetic accounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import ganache from "ganache";
import { chromium } from "@playwright/test";
import { prepareRelease } from "../scripts/mainnet/prepare-release.mjs";
import { loadUpgradeableArtifacts } from "../src/upgrade-verification.mjs";
import { allowedVerificationMethod } from "../scripts/mainnet/verification-runtime.mjs";
import {
  createMainnetWalletDeployment,
  startMainnetWalletDeploymentServer,
  verifyWalletDeploymentPlan,
  walletDeploymentApproval,
} from "../src/mainnet-wallet-deployment.mjs";
import {
  handoffOne,
  assertPrepared,
  readSavedHash,
  savedHashKey,
} from "../tools/mainnet-wallet/deploy.js";

const h = (name) => ethers.id("synthetic-wallet-bridge-" + name);
const addr = "0x0000000000000000000000000000000000000042";
const sha = (value) => createHash("sha256").update(value).digest("hex");
function planFor(deployer = addr) {
  const read = (name) =>
    JSON.parse(
      fs.readFileSync(
        new URL(`../build/contracts-v9/${name}.json`, import.meta.url),
      ),
    );
  const manifest = read("manifest"),
    input = fs.readFileSync(
      new URL("../build/contracts-v9/standard-input.json", import.meta.url),
    ),
    a = loadUpgradeableArtifacts();
  const build = {
    contracts: {
      KlerosUpgradeTimelockV9: a.timelock,
      KlerosEventV9: a.event,
      KlerosEventFactoryV9: a.factory,
      ERC1967Proxy: a.proxy,
    },
    compiler: manifest.compiler,
    settings: manifest.settings,
    standardInputSha256: sha(JSON.stringify(JSON.parse(input))),
    standardInputFileSha256: sha(input),
    buildManifestSha256: sha(JSON.stringify(manifest)),
    sourceHashes: manifest.sources,
  };
  return prepareRelease(
    {
      schemaVersion: 1,
      chainId: 1,
      contractVersion: "kleros-event-v9-uups",
      deployer,
      deployerNonce: 0,
      governance: {
        kind: "single-owner-timelock",
        initialOwner: deployer,
        minimumDelaySeconds: 172800,
      },
      fees: {
        maxFeePerGasWei: "4000000000",
        maxPriorityFeePerGasWei: "1000000",
      },
      gasLimits: {
        KlerosUpgradeTimelockV9: "2250000",
        KlerosEventV9: "6200000",
        KlerosEventFactoryV9: "2300000",
        ERC1967Proxy: "350000",
      },
      maxTotalGasCostWei: "44400000000000000",
    },
    build,
  );
}
const court = async () => ({ status: "verified-read-only", chainId: 1 }); // Explicit synthetic attestation, never a public Court claim.
function fakeProvider() {
  const calls = [],
    p = {
      send: async (method) => {
        calls.push(method);
        return method === "eth_chainId" ? "0x1" : "0x0";
      },
      destroy: () => {},
      getBlock: async () => ({
        number: 50,
        hash: h("head"),
        timestamp: 2_000_000_000,
        baseFeePerGas: 1n,
      }),
      getTransactionCount: async (account) =>
        account.toLowerCase() === addr.toLowerCase() ? 0 : 0,
      getBalance: async () => 10n ** 20n,
      getCode: async () => "0x",
      estimateGas: async () => 100000n,
      getTransaction: async () => null,
      getTransactionReceipt: async () => null,
    };
  return { p, calls };
}
function fixture({ enabled = true } = {}) {
  const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "mainnet-wallet-bridge-synthetic-"),
    ),
    plan = planFor(),
    fake = fakeProvider();
  const journalFile = path.join(temporary, "journal.json"),
    binding = walletDeploymentApproval(plan);
  const service = createMainnetWalletDeployment({
    plan,
    journalFile,
    expectedWallet: addr,
    enableWalletSigning: enabled,
    approvalHash: enabled ? binding.approvalHash : undefined,
    providerFactory: async () => fake.p,
    verifyCourt: court,
  });
  return {
    temporary,
    journalFile,
    plan,
    binding,
    service,
    fake,
    close: async () => {
      await service.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    },
  };
}
const code = (value) => (error) => error.code === value;

test("source-pinned review and approval bind exactly four CREATE requests, owner, gas and fees", () => {
  const p = planFor();
  assert.equal(
    verifyWalletDeploymentPlan(p, { expectedWallet: addr }).transactions.length,
    4,
  );
  const before = walletDeploymentApproval(p);
  for (const mutate of [
    (v) => (v.transactions[0].data += "00"),
    (v) => (v.transactions[0].nonce = 1),
    (v) => (v.transactions[0].maxFeePerGasWei = "5000000000"),
    (v) => (v.governance.initialOwner = ethers.ZeroAddress),
    (v) => (v.provenance.v9BuildManifestSha256 = "f".repeat(64)),
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    assert.notEqual(
      walletDeploymentApproval(changed).approvalHash,
      before.approvalHash,
    );
    assert.throws(() =>
      verifyWalletDeploymentPlan(changed, { expectedWallet: addr }),
    );
  }
  assert.throws(
    () =>
      createMainnetWalletDeployment({
        plan: p,
        expectedWallet: addr,
        enableWalletSigning: true,
        approvalHash: "not-approved",
      }),
    code("APPROVAL_REQUIRED"),
  );
});

test("default review mode cannot prepare a wallet request or initialize an upstream provider", async () => {
  const f = fixture({ enabled: false });
  try {
    assert.equal(f.service.plan().signingEnabled, false);
    await assert.rejects(
      f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      code("APPROVAL_REQUIRED"),
    );
    assert.equal(f.fake.calls.length, 0);
    assert.equal(fs.existsSync(f.journalFile), false);
  } finally {
    await f.close();
  }
});

test("once journal is durable before handoff, generic uncertainty prevents resend, and submitted hash precedes reads", async () => {
  const f = fixture();
  try {
    const prepared = await f.service.prepareStep({
      step: 1,
      wallet: addr,
      chainId: 1,
    });
    assert.equal(fs.statSync(f.journalFile).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(fs.readFileSync(f.journalFile)).steps[0].state,
      "prepared",
    );
    await assert.rejects(
      f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      code("ALREADY_PREPARED"),
    );
    await f.service.noteWalletError({
      step: 1,
      capability: prepared.capability,
      code: -32000,
    });
    await assert.rejects(
      f.service.prepareStep({ step: 1, wallet: addr, chainId: 1 }),
      code("ALREADY_PREPARED"),
    );
    const reads = f.fake.calls.length;
    await f.service.recordSubmitted({
      step: 1,
      hash: h("known"),
      recovery: true,
    });
    assert.equal(f.fake.calls.length, reads);
    assert.equal(
      JSON.parse(fs.readFileSync(f.journalFile)).steps[0].hash,
      h("known"),
    );
    await assert.rejects(
      f.service.recordSubmitted({
        step: 1,
        hash: h("another"),
        recovery: true,
      }),
      code("JOURNAL_SCOPE"),
    );
    assert.equal(f.service.state().steps[0].hash, h("known"));
  } finally {
    await f.close();
  }
});

test("only explicit4001 rejection permits a fresh review; old capability and concurrent second hash fail", async () => {
  const f = fixture();
  try {
    const first = await f.service.prepareStep({
      step: 1,
      wallet: addr,
      chainId: 1,
    });
    await f.service.noteWalletError({
      step: 1,
      capability: first.capability,
      code: 4001,
    });
    const second = await f.service.prepareStep({
      step: 1,
      wallet: addr,
      chainId: 1,
    });
    assert.notEqual(first.capability, second.capability);
    await assert.rejects(
      f.service.recordSubmitted({
        step: 1,
        capability: first.capability,
        hash: h("wrong-cap"),
      }),
      code("CAPABILITY_REQUIRED"),
    );
    const results = await Promise.allSettled([
      f.service.recordSubmitted({
        step: 1,
        capability: second.capability,
        hash: h("first"),
      }),
      f.service.recordSubmitted({
        step: 1,
        capability: second.capability,
        hash: h("second"),
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(f.service.state().steps[0].hash, h("first"));
  } finally {
    await f.close();
  }
});

test("wallet-side account, chain and exact prepared-request guards stop before eth_sendTransaction", async () => {
  const plan = planFor(),
    review = { plan, ...walletDeploymentApproval(plan), signingEnabled: true },
    seen = [];
  const provider = {
    request: async ({ method }) => {
      seen.push(method);
      return method === "eth_chainId" ? "0x27d8" : [addr];
    },
  };
  await assert.rejects(
    handoffOne({
      api: {
        prepare: async () => {
          throw Error("must not prepare");
        },
      },
      provider,
      review,
      step: 1,
    }),
  );
  assert.equal(seen.includes("eth_sendTransaction"), false);
  const p = {
    step: 1,
    transaction: plan.transactions[0],
    planSha256: review.planSha256,
    approvalHash: review.approvalHash,
    validUntil: Date.now() + 60000,
  };
  assert.equal(assertPrepared(review, 1, p).nonce, 0);
  assert.throws(() =>
    assertPrepared(review, 1, {
      ...p,
      transaction: { ...p.transaction, data: "0x00" },
    }),
  );
});

test("returned plans and prepared transactions cannot mutate the approved internal request", async () => {
  const f = fixture();
  try {
    const dto = f.service.plan();
    dto.plan.transactions[0].data = "0x00";
    dto.plan.configuration.deployer = ethers.ZeroAddress;
    dto.bridgeSources["tools/mainnet-wallet/deploy.js"] = "f".repeat(64);
    const prepared = await f.service.prepareStep({
      step: 1,
      wallet: addr,
      chainId: 1,
    });
    prepared.transaction.data = "0x01";
    prepared.transaction.maxFeePerGasWei = "999999999999";
    assert.equal(
      f.service.plan().plan.transactions[0].data,
      f.plan.transactions[0].data,
    );
    assert.equal(
      f.service.plan().plan.transactions[0].maxFeePerGasWei,
      f.plan.transactions[0].maxFeePerGasWei,
    );
    assert.equal(f.service.plan().planSha256, f.binding.planSha256);
  } finally {
    await f.close();
  }
});

function installCandidateFacts(f, facts) {
  const tx = f.plan.transactions[0],
    blockHash = h("candidate-block"),
    runtime = loadUpgradeableArtifacts().timelock.deployedBytecode;
  f.fake.p.getTransaction = async (hash) => facts.get(hash) ?? null;
  f.fake.p.getTransactionReceipt = async (hash) =>
    facts.has(hash)
      ? {
          hash,
          status: 1,
          blockNumber: 10,
          blockHash,
          contractAddress: tx.predictedAddress,
          gasUsed: 100000n,
          gasPrice: 2n,
        }
      : null;
  f.fake.p.getBlock = async (tag) => ({
    number: tag === 10 ? 10 : 50,
    hash: tag === 10 ? blockHash : h("head"),
    baseFeePerGas: 1n,
  });
  f.fake.p.getCode = async (address) =>
    address.toLowerCase() === tx.predictedAddress.toLowerCase()
      ? runtime
      : "0x";
  return (hash) => ({
    hash,
    from: addr,
    to: null,
    nonce: 0,
    chainId: 1n,
    type: 2,
    value: 0n,
    data: tx.data,
    gasLimit: BigInt(tx.gasLimit),
    maxFeePerGas: BigInt(tx.maxFeePerGasWei),
    maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasWei),
    blockNumber: 10,
    blockHash,
  });
}
test("append-only candidate recovery preserves mistaken first hash and adopts only the exact canonical CREATE", async () => {
  const f = fixture();
  try {
    const prepared = await f.service.prepareStep({
      step: 1,
      wallet: addr,
      chainId: 1,
    });
    await f.service.recordSubmitted({
      step: 1,
      capability: prepared.capability,
      hash: h("mistaken-first"),
    });
    const facts = new Map(),
      make = installCandidateFacts(f, facts);
    facts.set(h("mistaken-first"), {
      ...make(h("mistaken-first")),
      from: "0x0000000000000000000000000000000000000043",
    });
    assert.equal((await f.service.reconcile(1)).status, "rejected-hash");
    facts.set(h("correct-replacement"), make(h("correct-replacement")));
    assert.equal(
      (
        await f.service.recoverCandidate({
          step: 1,
          hash: h("correct-replacement"),
        })
      ).status,
      "confirmed",
    );
    const row = f.service.state().steps[0];
    assert.equal(row.originalHash, h("mistaken-first"));
    assert.equal(row.hash, h("correct-replacement"));
    assert.equal(row.candidates.length, 2);
    assert.equal(row.candidates[0].state, "rejected-hash");
    assert.equal(
      JSON.parse(fs.readFileSync(f.journalFile)).steps[0].hash,
      h("mistaken-first"),
    );
  } finally {
    await f.close();
  }
});

test("same-nonce cancellation or a replacement above approved fees halts for human review", async () => {
  for (const kind of ["cancel", "fee"]) {
    const f = fixture();
    try {
      const prepared = await f.service.prepareStep({
        step: 1,
        wallet: addr,
        chainId: 1,
      });
      await f.service.recordSubmitted({
        step: 1,
        capability: prepared.capability,
        hash: h(kind),
      });
      const facts = new Map(),
        make = installCandidateFacts(f, facts),
        tx = make(h(kind));
      if (kind === "cancel") {
        tx.to = addr;
        tx.data = "0x";
      } else tx.maxFeePerGas += 1n;
      facts.set(h(kind), tx);
      assert.equal((await f.service.reconcile(1)).status, "human-review");
      assert.equal(f.service.state().steps[0].state, "human-review");
      await assert.rejects(
        f.service.prepareStep({ step: 2, wallet: addr, chainId: 1 }),
        code("HUMAN_REVIEW_REQUIRED"),
      );
    } finally {
      await f.close();
    }
  }
});

test("browser hash metadata requires exact plan/wallet/chain/step/nonce and reports conflicts", () => {
  const plan = planFor(),
    review = { plan, ...walletDeploymentApproval(plan) },
    values = new Map(),
    storage = { getItem: (key) => values.get(key) };
  const record = {
    planSha256: review.planSha256,
    wallet: addr,
    chainId: 1,
    step: 1,
    nonce: 0,
    hash: h("local"),
  };
  values.set(savedHashKey(review, 1), JSON.stringify(record));
  assert.equal(readSavedHash(storage, review, 1, {}).hash, record.hash);
  assert.equal(
    readSavedHash(storage, review, 1, { hash: h("server") }).conflict,
    true,
  );
  for (const change of [
    { chainId: 10200 },
    { nonce: 1 },
    { step: 2 },
    { wallet: ethers.ZeroAddress },
    { planSha256: "wrong" },
  ]) {
    values.set(
      savedHashKey(review, 1),
      JSON.stringify({ ...record, ...change }),
    );
    assert.equal(readSavedHash(storage, review, 1, {}).invalid, true);
  }
});

test("actual local four-CREATE browser handoff uses one wallet request per step and read-only backend only", async () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "mainnet-wallet-four-local-"),
  );
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1, hardfork: "shanghai" },
    wallet: { totalAccounts: 1, defaultBalance: 1000 },
    miner: { blockGasLimit: 60_000_000 },
  });
  const accounts = await rpc.request({ method: "eth_accounts", params: [] }),
    plan = planFor(ethers.getAddress(accounts[0])),
    binding = walletDeploymentApproval(plan),
    backend = [],
    order = [];
  const provider = new ethers.BrowserProvider(
    {
      request: async (args) => {
        backend.push(args.method);
        assert.equal(allowedVerificationMethod(args.method), true);
        return rpc.request(args);
      },
    },
    undefined,
    { cacheTimeout: -1 },
  );
  provider.pollingInterval = 10;
  let sourceOkay = true;
  const service = createMainnetWalletDeployment({
    plan,
    journalFile: path.join(temporary, "journal.json"),
    expectedWallet: plan.deployer,
    enableWalletSigning: true,
    approvalHash: binding.approvalHash,
    providerFactory: async () => provider,
    verifyCourt: court,
    verifySources: (p, options) => {
      if (!sourceOkay)
        throw Object.assign(new Error("source changed"), {
          code: "SOURCE_CHANGED",
        });
      return verifyWalletDeploymentPlan(p, options);
    },
  });
  const wallet = {
    request: async (args) => {
      if (args.method === "eth_sendTransaction") order.push("send");
      return rpc.request(args);
    },
  };
  const api = {
    prepare: (v) => service.prepareStep(v),
    submitted: (v) => {
      order.push("record");
      return service.recordSubmitted(v);
    },
    walletError: (v) => service.noteWalletError(v),
  };
  try {
    const review = service.plan();
    for (let step = 1; step <= 4; step++) {
      const result = await handoffOne({
        api,
        provider: wallet,
        review,
        step,
        saveHash: () => order.push("save"),
      });
      assert.equal(result.status, "submitted");
      assert.deepEqual(order.slice(-3), ["send", "save", "record"]);
      const first = await service.reconcile(step);
      assert.equal(first.status, "confirming");
      await rpc.request({ method: "evm_mine", params: [] });
      assert.equal((await service.reconcile(step)).status, "confirmed");
      assert.equal(service.state().steps[step - 1].hash, result.hash);
      if (step === 1) {
        sourceOkay = false;
        assert.equal(
          (await service.reconcile(1)).status,
          "confirmed",
          "known receipt recovery does not require current source/fee approval",
        );
        await assert.rejects(
          service.prepareStep({ step: 2, wallet: plan.deployer, chainId: 1 }),
          code("SOURCE_CHANGED"),
        );
        sourceOkay = true;
      }
    }
    assert.equal(order.filter((value) => value === "send").length, 4);
    assert.ok(backend.every(allowedVerificationMethod));
    assert.equal(
      service.state().steps.every((row) => row.state === "confirmed"),
      true,
    );
    assert.equal(service.state().setup.status, "verified");
    assert.equal(
      service.state().setup.upgrade.owner.toLowerCase(),
      plan.deployer.toLowerCase(),
    );
    assert.equal(
      fs.statSync(path.join(temporary, "journal.json")).mode & 0o777,
      0o600,
    );
    const factory = new ethers.Contract(
      plan.factoryProxy,
      loadUpgradeableArtifacts().factory.abi,
      provider,
    );
    assert.equal(await factory.eventCount(), 0n);
  } finally {
    await service.close();
    await rpc.disconnect();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

function request(
  origin,
  pathname,
  { method = "GET", headers = {}, body } = {},
) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(pathname, origin),
      { method, headers },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text: data,
          }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
test("loopback server enforces exact Host/Origin/CSP, serves only review assets and exposes no send proxy", async () => {
  const f = fixture({ enabled: false });
  const app = await startMainnetWalletDeploymentServer({
    plan: f.plan,
    expectedWallet: addr,
    journalFile: f.journalFile,
    providerFactory: async () => f.fake.p,
    verifyCourt: court,
  });
  try {
    const page = await request(app.origin, "/");
    assert.equal(page.status, 200);
    assert.ok(
      page.headers["content-security-policy"].includes(
        "frame-ancestors 'none'",
      ),
    );
    assert.equal(page.headers["access-control-allow-origin"], undefined);
    assert.equal(
      (
        await request(app.origin, "/api/plan", {
          headers: { host: "evil.example" },
        })
      ).status,
      409,
    );
    const body = JSON.stringify({ step: 1, wallet: addr, chainId: 1 });
    assert.equal(
      (
        await request(app.origin, "/api/prepare-step", {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "content-type": "application/json",
          },
          body,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(app.origin, "/api/prepare-step", {
          method: "POST",
          headers: { origin: app.origin, "content-type": "application/json" },
          body,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(app.origin, "/rpc", {
          method: "POST",
          headers: { origin: app.origin, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      404,
    );
    assert.equal(f.fake.calls.length, 0);
    assert.equal(fs.existsSync(f.journalFile), false);
  } finally {
    await app.close();
    await f.close();
  }
});

test("browser reload restores a hash after a lost server POST, names the wallet provider and halts conflicts", async () => {
  const f = fixture(),
    app = await startMainnetWalletDeploymentServer({
      plan: f.plan,
      expectedWallet: addr,
      journalFile: f.journalFile,
      enableWalletSigning: true,
      approvalHash: f.binding.approvalHash,
      providerFactory: async () => f.fake.p,
      verifyCourt: court,
    });
  const browser = await chromium.launch({ headless: true }),
    page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.addInitScript(
      ({ account, hash }) => {
        const provider = (wrong, flags) => ({
          ...flags,
          on: () => {},
          request: async ({ method }) => {
            if (method === "eth_requestAccounts" || method === "eth_accounts")
              return [
                wrong ? "0x0000000000000000000000000000000000000043" : account,
              ];
            if (method === "eth_chainId") return "0x1";
            if (method === "eth_getTransactionCount") return "0x0";
            if (method === "eth_getBalance") return "0x1000000000000000000";
            if (method === "eth_getBlockByNumber")
              return { baseFeePerGas: "0x1" };
            if (method === "eth_getCode") return "0x";
            if (method === "eth_sendTransaction") {
              sessionStorage.setItem(
                "syntheticSendCount",
                String(
                  Number(sessionStorage.getItem("syntheticSendCount") ?? 0) + 1,
                ),
              );
              return hash;
            }
            throw Error("unexpected wallet method");
          },
        });
        window.ethereum = {
          providers: [
            provider(true, { isBraveWallet: true }),
            provider(false, { isMetaMask: true }),
          ],
        };
      },
      { account: addr, hash: h("browser-lost-post") },
    );
    await page.route("**/api/record-submitted", (route) => route.abort());
    await page.goto(app.origin);
    await page
      .getByRole("heading", { name: "Review the four setup transactions" })
      .waitFor();
    await page.getByRole("button", { name: "Connect selected wallet" }).click();
    assert.match(
      await page.locator("#message").textContent(),
      /exact approved wallet/,
    );
    await page
      .getByLabel("Browser wallet provider")
      .selectOption({ label: "MetaMask" });
    await page.getByRole("button", { name: "Connect selected wallet" }).click();
    assert.match(await page.locator("#wallet").textContent(), /MetaMask/);
    await page.locator("#consent").check();
    await page
      .getByRole("button", {
        name: "Send one wallet CREATE request",
        exact: true,
      })
      .first()
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("#message")
        .textContent.includes("Preserved original hash"),
    );
    assert.equal(app.service.state().steps[0].state, "prepared");
    assert.equal(app.service.state().steps[0].hash, null);
    await page.reload();
    const input = page.getByLabel("Original transaction hash for step 1", {
      exact: true,
    });
    await input.waitFor();
    assert.equal(await input.inputValue(), h("browser-lost-post"));
    assert.equal(await input.getAttribute("readonly"), "");
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("syntheticSendCount")),
      "1",
    );
    await page
      .getByRole("button", {
        name: "Recover / check original receipt",
        exact: true,
      })
      .first()
      .click();
    await page.waitForFunction(() =>
      document.querySelector("#message").textContent.includes("pending"),
    );
    assert.equal(app.service.state().steps[0].hash, h("browser-lost-post"));
    const stored = {
      planSha256: f.binding.planSha256,
      wallet: addr,
      chainId: 1,
      step: 1,
      nonce: 0,
      hash: h("conflicting-browser"),
    };
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
      { key: savedHashKey(app.service.plan(), 1), value: stored },
    );
    await page.reload();
    await page.getByText(/Hash conflict:/).waitFor();
    assert.equal(await page.locator("button.send:enabled").count(), 0);
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("syntheticSendCount")),
      "1",
    );
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: "/private/tmp/kleros-mainnet-wallet-review-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    await f.close();
  }
});
