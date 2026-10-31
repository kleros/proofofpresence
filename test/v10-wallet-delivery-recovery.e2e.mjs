// Mounted page/HTTP diagnostic only: no chain, keys, signatures or broadcasts.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { verifyV10Build } from "../scripts/mainnet/prepare-v10-release.mjs";
import { v10RuntimeCode } from "../scripts/mainnet/v10-runtime-code.mjs";
import {
  createV10WalletDeployment,
  startV10WalletDeploymentServer,
  USER_DEPLOYER,
} from "../src/v10-wallet-deployment.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const reviewInput = {
  file: "artifacts/v10-release/delegated-four-create-review.json",
  sha256: "8769e4c2663c1746e083428b0681c84c66e6de68daa93f0cd256376e7d9c5a14",
};
const sourceFiles = [
  "src/v10-wallet-deployment.mjs",
  "scripts/serve-v10-deployment.mjs",
  "tools/v10-wallet/index.html",
  "tools/v10-wallet/deploy.js",
  "tools/v10-wallet/style.css",
  "test/v10-wallet-delivery-recovery.e2e.mjs",
];
export async function runDeliveryRecovery() {
  const { chromium, expect } = await import("@playwright/test");
  const out = path.join(
    ROOT,
    "artifacts/v10-wallet-delivery-recovery",
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID(),
  );
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "v10-mounted-synthetic-"),
  );
  await fs.mkdir(out, { recursive: true });
  const proof = {
    kind: "synthetic-mounted-v10-lost-response-recovery",
    status: "running",
    checks: [],
    http: [],
    backendMethods: [],
    walletMethods: [],
    events: [],
    source: {},
    screenshots: [],
    errors: [],
    blocked: [],
    signatures: 0,
    broadcasts: 0,
    publicNetworkRequests: 0,
    limits: [
      "Actual current deployment page and loopback HTTP service, synthetic canonical predecessors/current account/head/runtime and hash only. No chain or EVM execution and no financial/deployment acceptance claim.",
      "Only public plan/runtime/source files read. Journal, grant and capability exist solely in fresh temporary storage; no live operator journal/grant is read.",
    ],
  };
  const pass = (condition, label) => {
    assert(condition, label);
    proof.checks.push(label);
  };
  let app, base, browser, page;
  try {
    for (const name of sourceFiles)
      proof.source[name] = sha(await fs.readFile(path.join(ROOT, name)));
    const plan = JSON.parse(
        await fs.readFile(
          path.join(
            ROOT,
            "artifacts/v10-release/user-2bb-nonce6-reviewed-account-proposed.json",
          ),
        ),
      ),
      build = verifyV10Build();
    assert.equal(plan.deployer, USER_DEPLOYER);
    assert.equal(plan.transactions[3].nonce, 9);
    const observed = JSON.parse(
      await fs.readFile(
        path.join(
          ROOT,
          "artifacts/v10-integration/metamask-runtime-observed.json",
        ),
      ),
    );
    const codes = new Map(
        observed.contracts.map((row) => [row.address.toLowerCase(), row.code]),
      ),
      actuals = new Map(),
      receipts = new Map();
    const designation = "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b",
      head = 80;
    let nonce = plan.startingNonce;
    const blockHash = (n) => ethers.id("synthetic-mounted-block-" + n);
    const block = (n) => ({
      number: n,
      hash: blockHash(n),
      timestamp: 2000000000,
      baseFeePerGas: 1n,
    });
    const rawBlock = (n) => ({
      number: ethers.toQuantity(n),
      hash: blockHash(n),
      timestamp: "0x77359400",
      baseFeePerGas: "0x1",
      gasLimit: "0x1c9c380",
    });
    const code = (address) =>
      same(address, USER_DEPLOYER)
        ? designation
        : (codes.get(address.toLowerCase()) ?? "0x");
    const provider = {
      send: async (method, params = []) => {
        proof.backendMethods.push(method);
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_getBlockByNumber")
          return rawBlock(
            params[0] === "latest" ? head : Number(BigInt(params[0])),
          );
        if (method === "eth_getCode") return code(params[0]);
        if (method === "eth_getTransactionCount")
          return ethers.toQuantity(same(params[0], USER_DEPLOYER) ? nonce : 0);
        if (method === "eth_getBalance") return ethers.toQuantity(10n ** 20n);
        throw Error("Unexpected synthetic backend method");
      },
      getTransaction: async (hash) => {
        proof.backendMethods.push("getTransaction");
        return actuals.get(hash) ?? null;
      },
      getTransactionReceipt: async (hash) => {
        proof.backendMethods.push("getTransactionReceipt");
        return receipts.get(hash) ?? null;
      },
      getBlock: async (tag) => {
        proof.backendMethods.push("getBlock");
        return block(tag === "latest" ? head : Number(tag));
      },
      getCode: async (address) => {
        proof.backendMethods.push("getCode");
        return code(address);
      },
      estimateGas: async () => {
        proof.backendMethods.push("estimateGas");
        return 100000n;
      },
      destroy: () => {},
    };
    const journalFile = path.join(dir, "synthetic-journal.json"),
      common = {
        plan,
        journalFile,
        delegatedCreateReview: reviewInput,
        providerFactory: async () => provider,
      };
    const initial = createV10WalletDeployment(common),
      initialReview = initial.plan();
    await initial.close();
    base = createV10WalletDeployment({
      ...common,
      enableWalletSigning: true,
      approvalHash: initialReview.approvalHash,
    });
    for (let step = 1; step <= 3; step++) {
      const prepared = await base.prepareStep({
          step,
          wallet: USER_DEPLOYER,
          chainId: 1,
        }),
        tx = plan.transactions[step - 1],
        hash = ethers.id("synthetic-mounted-predecessor-" + step),
        n = 74 + step;
      await base.recordSubmitted({
        step,
        capability: prepared.capability,
        hash,
      });
      actuals.set(hash, {
        hash,
        from: USER_DEPLOYER,
        to: null,
        nonce: tx.nonce,
        chainId: 1n,
        type: 2,
        value: 0n,
        data: tx.data,
        gasLimit: BigInt(tx.gasLimit),
        maxFeePerGas: 1000001n,
        maxPriorityFeePerGas: 1000000n,
        blockNumber: n,
        blockHash: blockHash(n),
      });
      receipts.set(hash, {
        hash,
        status: 1,
        blockNumber: n,
        blockHash: blockHash(n),
        contractAddress: tx.predictedAddress,
        gasUsed: [669197n, 4641208n, 1654634n][step - 1],
        gasPrice: 1000001n,
      });
      codes.set(
        tx.predictedAddress.toLowerCase(),
        v10RuntimeCode(
          build.contracts[tx.contract],
          tx.predictedAddress,
          build.controllerCodeHash,
        ),
      );
      nonce = tx.nonce + 1;
      assert.equal((await base.reconcile(step)).status, "confirmed");
    }
    await base.prepareStep({ step: 4, wallet: USER_DEPLOYER, chainId: 1 });
    await base.close();
    base = null;
    const journal = JSON.parse(await fs.readFile(journalFile)),
      row = journal.steps.find((row) => row.step === 4);
    row.preparedAt = Date.now() - 300000;
    row.recovery = {
      kind: "human-requested-lost-page",
      acknowledgement: "expired-before-wallet-request-no-submission",
      preparedAt: Date.now() - 120000,
      approvalHash: sha("synthetic-prior-recovery-source-approval"),
      bridgeSourceSha256: sha("synthetic-prior-recovery-source"),
      originalPreparedSha256: sha(JSON.stringify(row)),
      capabilityHash: sha("synthetic-prior-recovery-capability"),
      proof: structuredClone(row.proof),
    };
    const originalFourth = JSON.stringify(row);
    await fs.writeFile(journalFile, JSON.stringify(journal), { mode: 0o600 });
    const predecessors = JSON.stringify(
      journal.steps.filter((row) => row.step < 4),
    );
    const grant = {
      schemaVersion: 1,
      kind: "v10-step4-unstarted-delivery-recovery",
      planSha256: initialReview.planSha256,
      wallet: USER_DEPLOYER,
      step: 4,
      nonce: 9,
      originalAttempt: 1,
      originalPreparedAt: row.recovery.preparedAt,
      originalPreparedSha256: sha(JSON.stringify(row)),
      originalApprovalHash: row.recovery.approvalHash,
      expiresAt: Date.now() + 900000,
    };
    const recoveryCommon = { ...common, lostPageRecoveryGrant: grant },
      reviewService = createV10WalletDeployment(recoveryCommon),
      review = reviewService.plan();
    await reviewService.close();
    app = await startV10WalletDeploymentServer({
      ...recoveryCommon,
      port: 0,
      enableWalletSigning: true,
      approvalHash: review.approvalHash,
    });
    proof.planSha256 = review.planSha256;
    proof.approvalHash = review.approvalHash;
    proof.bridgeSourceSha256 = review.bridgeSourceSha256;
    proof.backendSetupReadCount = proof.backendMethods.length;
    proof.backendMethods = [];
    const fakeHash = ethers.id(
        "synthetic-mounted-returned-hash-" + randomUUID(),
      ),
      target = plan.transactions[3];
    let sends = 0,
      recoveryCount = 0,
      dropped = false,
      firstKey,
      firstDoc,
      firstReviewId,
      staleErrorRejected = false;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    const gets = new Set([
        "/",
        "/deploy.js",
        "/style.css",
        "/api/plan",
        "/api/state",
      ]),
      posts = new Set([
        "/api/recover-prepared-step",
        "/api/ack-prepared-response",
        "/api/wallet-request-started",
        "/api/record-submitted",
        "/api/wallet-error",
      ]);
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (
        url.origin !== app.origin ||
        url.search ||
        !(
          (req.method() === "GET" && gets.has(url.pathname)) ||
          (req.method() === "POST" && posts.has(url.pathname))
        )
      ) {
        proof.blocked.push({ method: req.method(), path: url.pathname });
        return route.abort();
      }
      if (
        req.method() !== "POST" ||
        url.pathname !== "/api/recover-prepared-step"
      )
        return route.continue();
      const input = JSON.parse(req.postData());
      assert.match(input.clientCapability, /^[a-f0-9]{64}$/);
      assert.equal(typeof input.clientDocumentId, "string");
      assert(input.clientDocumentId.length > 0);
      assert.equal(
        await page.evaluate(
          (key) =>
            Object.values(localStorage).some((value) => value.includes(key)),
          input.clientCapability,
        ),
        true,
        "Client capability must be durable before the first async preparation POST",
      );
      recoveryCount++;
      if (recoveryCount === 1) {
        firstKey = input.clientCapability;
        firstDoc = input.clientDocumentId;
        const response = await route.fetch();
        proof.http.push({
          method: "POST",
          path: url.pathname,
          status: response.status(),
          responseIntentionallyDropped: true,
        });
        assert.equal(response.status(), 200);
        const saved = JSON.parse(await fs.readFile(journalFile)),
          current = saved.steps.find((row) => row.step === 4);
        assert(current.deliveryRecovery);
        firstReviewId = current.deliveryRecovery.currentReview.reviewId;
        assert.equal(firstReviewId, 1);
        assert(!current.deliveryRecovery.walletRequestStartedAt);
        assert(!current.hash);
        await response.dispose();
        dropped = true;
        return route.abort("failed");
      }
      assert.equal(recoveryCount, 2);
      assert.equal(
        input.clientCapability,
        firstKey,
        "Explicit redelivery must use the same durable capability",
      );
      assert.notEqual(
        input.clientDocumentId,
        firstDoc,
        "Reload must bind a fresh document",
      );
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      const beforeStale = await fs.readFile(journalFile);
      const stale = await fetch(app.origin + "/api/wallet-error", {
        method: "POST",
        headers: { origin: app.origin, "content-type": "application/json" },
        body: JSON.stringify({
          step: 4,
          capability: firstKey,
          clientDocumentId: firstDoc,
          reviewId: firstReviewId,
          code: "PREPARE_RESPONSE_UNAVAILABLE",
          phase: "prepare-response",
          method: null,
        }),
      });
      proof.http.push({
        method: "POST",
        path: "/api/wallet-error",
        status: stale.status,
        oldDocumentProbe: true,
      });
      assert.equal(stale.status, 409);
      await stale.body?.cancel();
      assert.deepEqual(
        await fs.readFile(journalFile),
        beforeStale,
        "Late old-document error must not poison the new current review",
      );
      staleErrorRejected = true;
      await route.fulfill({ response });
      await response.dispose();
    });
    await context.routeWebSocket("**/*", (socket) => {
      proof.blocked.push({ method: "WebSocket" });
      socket.close();
    });
    page = await context.newPage();
    page.on("pageerror", (error) =>
      proof.errors.push({ stage: "page", name: error.name }),
    );
    page.on("response", (response) => {
      const url = new URL(response.url());
      proof.http.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      });
      proof.events.push("http:" + url.pathname + ":" + response.status());
    });
    await page.exposeBinding(
      "__mountedSyntheticWallet",
      async ({ page: caller, frame }, request) => {
        assert.equal(caller, page);
        assert.equal(frame, page.mainFrame());
        assert.equal(new URL(page.url()).origin, app.origin);
        const { method, params = [] } = request;
        proof.walletMethods.push(method);
        proof.events.push("wallet:" + method);
        if (method === "eth_requestAccounts" || method === "eth_accounts")
          return [USER_DEPLOYER];
        if (method === "eth_sendTransaction") {
          sends++;
          assert.equal(sends, 1);
          assert.equal(params.length, 1);
          const saved = JSON.parse(await fs.readFile(journalFile)),
            current = saved.steps.find((row) => row.step === 4);
          assert(current.deliveryRecovery.walletRequestStartedAt);
          assert(current.deliveryRecovery.currentReview.responseReceivedAt);
          assert(!current.hash);
          assert.equal(
            JSON.stringify(saved.steps.filter((row) => row.step < 4)),
            predecessors,
          );
          assert.deepEqual(params[0], {
            from: target.from,
            chainId: "0x1",
            type: "0x2",
            nonce: ethers.toQuantity(target.nonce),
            value: "0x0",
            data: target.data,
            gas: ethers.toQuantity(target.gasLimit),
            maxFeePerGas: ethers.toQuantity(target.maxFeePerGasWei),
            maxPriorityFeePerGas: ethers.toQuantity(
              target.maxPriorityFeePerGasWei,
            ),
          });
          return fakeHash;
        }
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_getBlockByNumber")
          return rawBlock(
            params[0] === "latest" ? head : Number(BigInt(params[0])),
          );
        if (method === "eth_getTransactionCount")
          return ethers.toQuantity(same(params[0], USER_DEPLOYER) ? 9 : 0);
        if (method === "eth_getBalance") return ethers.toQuantity(10n ** 20n);
        if (method === "eth_getCode") return code(params[0]);
        throw Error("Unsupported synthetic wallet operation");
      },
    );
    await page.addInitScript(() => {
      window.ethereum = {
        isMetaMask: true,
        request: (request) => window.__mountedSyntheticWallet(request),
        on() {},
        removeListener() {},
      };
      window.__mountedHashWrites = [];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("v10-mainnet-setup:")) {
          const parsed = JSON.parse(value);
          if (/^0x[a-f0-9]{64}$/i.test(parsed.hash ?? ""))
            window.__mountedHashWrites.push({ key, hash: parsed.hash });
        }
        return original.call(this, key, value);
      };
    });
    await page.goto(app.origin);
    await expect(page.locator("#approval")).toContainText(
      "Exact plan and budget approval supplied",
    );
    await expect(page.locator(".step")).toHaveCount(4);
    const manualResume = async () => {
      await page.locator("#connect").click();
      await expect(page.locator("#wallet")).toContainText(USER_DEPLOYER);
      await page.locator("#consent").check();
      const fourth = page.locator(".step").nth(3);
      await fourth.locator('input[type="checkbox"]').check();
      const resume = page.getByRole("button", {
        name: "Resume Step 4 wallet review",
      });
      await expect(resume).toBeEnabled();
      await resume.click();
    };
    await manualResume();
    await expect.poll(() => dropped, { timeout: 30000 }).toBe(true);
    await expect(page.locator("#connect")).toBeEnabled({ timeout: 30000 });
    const afterDrop = JSON.parse(await fs.readFile(journalFile)),
      droppedRow = afterDrop.steps.find((row) => row.step === 4);
    pass(
      sends === 0 &&
        !droppedRow.hash &&
        !droppedRow.walletRequestStartedAt &&
        !droppedRow.recovery.walletRequestStartedAt &&
        !droppedRow.deliveryRecovery.walletRequestStartedAt,
      "Lost prepare response after server commit requests no wallet send and leaves every durable wallet-start marker unset",
    );
    const postsBeforeReload = proof.http.filter(
      (row) => row.method === "POST",
    ).length;
    await page.reload();
    await expect(page.locator(".step")).toHaveCount(4);
    await expect(page.locator("#connect")).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Resume Step 4 wallet review" }),
    ).toBeDisabled();
    assert.equal(await page.locator("#consent").isChecked(), false);
    pass(
      sends === 0 &&
        recoveryCount === 1 &&
        proof.http.filter((row) => row.method === "POST").length ===
          postsBeforeReload,
      "Reload restores an explicit unsigned review only; it performs no automatic preparation, wallet start or send",
    );
    await manualResume();
    await expect(page.locator("#message")).toContainText(
      "Preserved original hash",
      { timeout: 30000 },
    );
    const final = JSON.parse(await fs.readFile(journalFile)),
      fourth = final.steps.find((row) => row.step === 4);
    pass(
      sends === 1 &&
        fourth.hash === fakeHash &&
        fourth.state === "submitted" &&
        !!fourth.deliveryRecovery.walletRequestStartedAt,
      "Mounted actual page receives recovery response, acknowledges the durable handoff and invokes exactly one fake direct CREATE, then journals its returned fake hash",
    );
    const writes = await page.evaluate(() => window.__mountedHashWrites),
      storage = await page.evaluate(() =>
        Object.fromEntries(Object.entries(localStorage)),
      );
    pass(
      writes.length === 1 &&
        writes[0].hash === fakeHash &&
        Object.values(storage).some(
          (value) => JSON.parse(value).hash === fakeHash,
        ),
      "Original fake hash is synchronously retained in browser local storage and acknowledged in the isolated server journal",
    );
    pass(
      recoveryCount === 2 &&
        staleErrorRejected &&
        fourth.deliveryRecovery.currentReview.reviewId === 2 &&
        fourth.deliveryRecovery.reviewHistory.length === 1 &&
        fourth.deliveryRecovery.reviewHistory[0].reviewId === firstReviewId &&
        proof.http.some(
          (row) =>
            row.path === "/api/ack-prepared-response" && row.status === 200,
        ) &&
        proof.http.filter((row) => row.path === "/api/wallet-request-started")
          .length === 1 &&
        proof.http.filter((row) => row.path === "/api/record-submitted")
          .length === 1,
      "Same-key manual redelivery under a fresh document performs one factual response ACK, one durable start and one hash submission; a late old-document error is rejected without journal mutation",
    );
    const sendAt = proof.events.indexOf("wallet:eth_sendTransaction"),
      ackAt = proof.events.indexOf("http:/api/wallet-request-started:200"),
      responseAckAt = proof.events.indexOf(
        "http:/api/ack-prepared-response:200",
      );
    pass(
      responseAckAt >= 0 &&
        ackAt > responseAckAt &&
        sendAt > ackAt &&
        proof.walletMethods.filter((method) => method === "eth_getCode")
          .length === 9 &&
        proof.walletMethods.includes("eth_getBlockByNumber"),
      "Pinned wallet/framework reads and the successful durable HTTP acknowledgement precede the one fake send",
    );
    pass(
      JSON.stringify(final.steps.filter((row) => row.step < 4)) ===
        predecessors &&
        fourth.attempt === 1 &&
        fourth.preparedAt === row.preparedAt &&
        JSON.stringify(
          Object.fromEntries(
            Object.entries(fourth).filter(
              ([key]) =>
                ![
                  "deliveryRecovery",
                  "hash",
                  "state",
                  "submittedAt",
                  "candidates",
                ].includes(key),
            ),
          ),
        ) ===
          JSON.stringify(
            Object.fromEntries(
              Object.entries(JSON.parse(originalFourth)).filter(
                ([key]) => !["hash", "state", "submittedAt"].includes(key),
              ),
            ),
          ),
      "All synthetic canonical predecessors and original Step4 preparation remain unchanged; only one-use recovery and hash facts are added",
    );
    proof.final = {
      step: 4,
      state: fourth.state,
      walletRequestStarted: !!fourth.deliveryRecovery.walletRequestStartedAt,
      hashRetained: fourth.hash === fakeHash,
      walletCalls: sends,
    };
    proof.uiMessage = await page.locator("#message").innerText();
    for (const [name, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      const filename = name + ".png";
      await page.screenshot({ path: path.join(out, filename), fullPage: true });
      proof.screenshots.push(filename);
    }
    assert.deepEqual(proof.blocked, []);
    assert.deepEqual(proof.errors, []);
    for (const [name, digest] of Object.entries(proof.source))
      assert.equal(
        sha(await fs.readFile(path.join(ROOT, name))),
        digest,
        "Source changed during mounted diagnostic",
      );
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure = {
      name: error.name,
      code: typeof error.code === "string" ? error.code : "MOUNTED_ASSERTION",
    };
    if (page) {
      proof.uiMessage = await page
        .locator("#message")
        .innerText()
        .catch(() => "");
      await page
        .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
        .catch(() => {});
    }
    throw error;
  } finally {
    await browser?.close();
    await app?.close();
    await base?.close();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.writeFile(
      path.join(out, "proof.json"),
      JSON.stringify(proof, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        status: proof.status,
        checks: proof.checks.length,
        proofPath: path.join(out, "proof.json"),
      }),
    );
  }
  return proof;
}
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.length === 2)
    console.log(
      JSON.stringify({
        status: "review-only",
        networkRequests: 0,
        walletCalls: 0,
        signatures: 0,
        broadcasts: 0,
      }),
    );
  else if (process.argv.length === 3 && process.argv[2] === "--run-loopback")
    await runDeliveryRecovery();
  else
    throw Error(
      "Only explicit --run-loopback synthetic diagnostic is supported",
    );
}
