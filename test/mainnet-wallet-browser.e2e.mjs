// Actual Chromium DOM and actual loopback bridge; chain/provider facts are synthetic.
// No chain is contacted, no signing key exists, and no transaction is broadcast.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  startMainnetWalletDeploymentServer,
  verifyWalletDeploymentPlan,
  walletDeploymentApproval,
} from "../src/mainnet-wallet-deployment.mjs";
import { savedHashKey } from "../tools/mainnet-wallet/deploy.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const proposal =
  "artifacts/mainnet-release/user-2bb03593-four-create-proposed.json";
const sourcePaths = [
  "test/mainnet-wallet-browser.e2e.mjs",
  "src/mainnet-wallet-deployment.mjs",
  "scripts/serve-mainnet-deployment.mjs",
  "tools/mainnet-wallet/index.html",
  "tools/mainnet-wallet/deploy.js",
  "tools/mainnet-wallet/style.css",
  "src/upgrade-artifacts.mjs",
  "src/upgrade-verification.mjs",
  "scripts/mainnet/prepare-release.mjs",
  proposal,
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceHashes = () =>
  Object.fromEntries(
    sourcePaths.map((file) => [
      file,
      sha(fs.readFileSync(path.join(root, file))),
    ]),
  );
const before = sourceHashes();
const plan = JSON.parse(fs.readFileSync(path.join(root, proposal), "utf8"));
verifyWalletDeploymentPlan(plan); // Offline provenance only; no compilation or RPC.
const hex = (value) => "0x" + BigInt(value).toString(16);
const fakeHash = "0x" + sha("synthetic-browser-wallet-returned-hash-only");
const headHash = "0x" + sha("synthetic-browser-head-only");
const evidence = path.join(
  root,
  "artifacts/mainnet-release/wallet-browser",
  `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
);
fs.mkdirSync(evidence, { recursive: true });
const report = {
  status: "running",
  command: "node test/mainnet-wallet-browser.e2e.mjs",
  sourceBefore: before,
  proposalSha256: before[proposal],
  checks: [],
  scenarios: [],
  browserErrors: [],
  externalRequests: [],
  publicRpcRequests: 0,
  signingKeys: 0,
  cryptographicSignatures: 0,
  transactionBroadcasts: 0,
  limitations: [
    "Actual Chromium and actual loopback HTTP bridge/static assets; provider, Court and transaction responses are synthetic.",
    "Public proposal is used as source-pinned fixture data only; no real wallet is opened or asked to sign.",
    "A fake EIP-1193 eth_sendTransaction response is not a broadcast or canonical receipt proof.",
    "Actual local-chain four-CREATE execution and final factory governance are covered by separate tests.",
  ],
};
const check = (label, assertion) => {
  assertion();
  report.checks.push(label);
};
let browser;

async function fixture({
  enabled = true,
  uncertain = false,
  loseRecord = false,
} = {}) {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "wallet-browser-synthetic-"),
  );
  const journalFile = path.join(temporary, "journal.json");
  const counters = {
    providerInitializations: 0,
    backendCalls: [],
    walletCalls: [],
    sends: 0,
    preparePosts: 0,
    recordPostsLost: 0,
    recoveryPosts: [],
  };
  const provider = {
    send: async (method) => {
      counters.backendCalls.push(method);
      return method === "eth_chainId" ? "0x1" : "0x0";
    },
    getBlock: async () => ({
      number: 50,
      hash: headHash,
      timestamp: 2_000_000_000,
      baseFeePerGas: 1n,
    }),
    getTransactionCount: async (account) =>
      account.toLowerCase() === plan.deployer.toLowerCase()
        ? plan.startingNonce
        : 0,
    getBalance: async () => 10n ** 20n,
    getCode: async () => "0x",
    estimateGas: async () => 100000n,
    getTransaction: async () => null,
    getTransactionReceipt: async () => null,
    destroy() {},
  };
  const app = await startMainnetWalletDeploymentServer({
    plan,
    journalFile,
    enableWalletSigning: enabled,
    approvalHash: enabled
      ? walletDeploymentApproval(plan).approvalHash
      : undefined,
    providerFactory: async () => {
      counters.providerInitializations++;
      return provider;
    },
    verifyCourt: async () => ({ status: "verified-read-only", chainId: 1 }), // Synthetic attestation.
    verifyFactory: async () => {
      throw Error("No final factory proof belongs to this browser fixture");
    },
  });
  const review = app.service.plan();
  const context = await browser.newContext({
    viewport: { width: 1100, height: 850 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.browserErrors.push(error.message));
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== app.origin) {
      report.externalRequests.push({ method: request.method(), url: url.href });
      return route.abort("blockedbyclient");
    }
    if (request.method() === "POST" && url.pathname === "/api/prepare-step")
      counters.preparePosts++;
    if (
      request.method() === "POST" &&
      url.pathname === "/api/recover-candidate"
    )
      counters.recoveryPosts.push(request.postDataJSON());
    if (
      loseRecord &&
      request.method() === "POST" &&
      url.pathname === "/api/record-submitted"
    ) {
      counters.recordPostsLost++;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "SYNTHETIC_RESPONSE_LOSS",
          message: "Synthetic record response unavailable",
        }),
      });
    }
    return route.continue();
  });
  await context.exposeBinding(
    "__syntheticWalletRequest",
    async ({ frame }, request) => {
      assert.equal(new URL(frame.url()).origin, app.origin);
      assert.equal(frame.parentFrame(), null);
      counters.walletCalls.push(request.method);
      if (["eth_accounts", "eth_requestAccounts"].includes(request.method))
        return [plan.deployer];
      if (request.method === "eth_chainId") return "0x1";
      if (request.method === "eth_getTransactionCount")
        return hex(plan.startingNonce);
      if (request.method === "eth_getBalance") return hex(10n ** 20n);
      if (request.method === "eth_getBlockByNumber")
        return { number: "0x32", hash: headHash, baseFeePerGas: "0x1" };
      if (request.method === "eth_getCode") return "0x";
      assert.equal(
        request.method,
        "eth_sendTransaction",
        "No signing/authentication method belongs to this synthetic wallet",
      );
      counters.sends++;
      const intent = JSON.parse(fs.readFileSync(journalFile, "utf8")).steps[0];
      assert.equal(
        intent.state,
        "prepared",
        "Server intent must precede the wallet request",
      );
      assert.equal(intent.hash, undefined);
      const tx = plan.transactions[0],
        actual = request.params[0];
      check(
        "Wallet CREATE request has no recipient and retains exact reviewed nonce/gas/type/fee fields",
        () => {
          assert.equal(Object.hasOwn(actual, "to"), false);
          const { data, ...fields } = actual;
          assert.equal(sha(data), sha(tx.data));
          assert.deepEqual(fields, {
            from: tx.from,
            chainId: "0x1",
            type: "0x2",
            nonce: hex(tx.nonce),
            value: "0x0",
            gas: hex(tx.gasLimit),
            maxFeePerGas: hex(tx.maxFeePerGasWei),
            maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGasWei),
          });
        },
      );
      if (uncertain)
        throw Error("Synthetic wallet outcome unknown; no transaction exists");
      return fakeHash;
    },
  );
  await context.addInitScript(() => {
    window.ethereum = {
      isBraveWallet: true,
      request: (request) => window.__syntheticWalletRequest(request),
      on() {},
      removeListener() {},
    };
  });
  async function open() {
    await page.goto(app.origin);
    await expect(page.locator("#steps .step")).toHaveCount(4);
    await expect(page.getByLabel("Browser wallet provider")).toContainText(
      "Brave Wallet",
    );
  }
  async function connect() {
    await page
      .getByRole("button", { name: "Connect selected wallet", exact: true })
      .click();
    await expect(page.locator("#wallet")).toContainText("Brave Wallet");
    await page.locator("#consent").check();
  }
  return {
    app,
    page,
    context,
    review,
    counters,
    journalFile,
    open,
    connect,
    close: async () => {
      await context.close();
      await app.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    },
  };
}

try {
  browser = await chromium.launch({ headless: true });
  {
    const f = await fixture({ loseRecord: true });
    try {
      await f.open();
      await f.connect();
      const send = f.page.locator("button.send").first();
      await expect(send).toBeEnabled();
      await send.scrollIntoViewIfNeeded();
      const box = await send.boundingBox();
      await f.page.mouse.dblclick(
        box.x + box.width / 2,
        box.y + box.height / 2,
        { delay: 15 },
      );
      await expect(f.page.locator("#message")).toContainText(
        "Preserved original hash",
      );
      check(
        "Actual double-click opens one synthetic wallet request and leaves the server intent prepared after response loss",
        () => {
          assert.equal(f.counters.sends, 1);
          assert.equal(f.counters.recordPostsLost, 1);
          assert.equal(f.app.service.state().steps[0].state, "prepared");
          assert.equal(f.app.service.state().steps[0].hash, null);
        },
      );
      await f.page.reload();
      const input = f.page.getByLabel("Original transaction hash for step 1", {
        exact: true,
      });
      await expect(input).toHaveValue(fakeHash);
      await expect(input).toHaveAttribute("readonly", "");
      await f.connect();
      await expect(f.page.locator("button.send").first()).toBeDisabled();
      check(
        "Reload restores the exact validated hash without another wallet request",
        () => assert.equal(f.counters.sends, 1),
      );
      await f.page
        .getByRole("button", {
          name: "Recover / check original receipt",
          exact: true,
        })
        .first()
        .click();
      await expect(f.page.locator("#message")).toContainText("pending");
      check(
        "Explicit restored-hash recovery reaches the actual read-only route without resending",
        () => {
          assert.deepEqual(f.counters.recoveryPosts, [
            { step: 1, hash: fakeHash },
          ]);
          assert.equal(f.app.service.state().steps[0].hash, fakeHash);
          assert.equal(f.counters.sends, 1);
        },
      );
      await f.page.setViewportSize({ width: 375, height: 812 });
      const mobileFits = await f.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      );
      check("Mobile recovery remains inside the viewport", () =>
        assert.equal(mobileFits, true),
      );
      await f.page.screenshot({
        path: path.join(evidence, "synthetic-recovered-mobile.png"),
        fullPage: true,
      });
      report.scenarios.push({
        name: "lost-server-record-reload-and-double-click",
        sends: f.counters.sends,
        preparedPosts: f.counters.preparePosts,
        receiptStatus: "synthetic-pending",
      });
    } finally {
      await f.close();
    }
  }
  {
    const f = await fixture({ uncertain: true });
    try {
      await f.open();
      await f.connect();
      await f.page.locator("button.send").first().click();
      await expect(f.page.locator("#message")).toContainText("Do not resend");
      assert.equal(f.app.service.state().steps[0].state, "uncertain");
      await f.page.reload();
      await f.connect();
      await expect(f.page.locator("button.send").first()).toBeDisabled();
      await expect(
        f.page.getByLabel("Original transaction hash for step 1", {
          exact: true,
        }),
      ).toHaveValue("");
      check(
        "An unknown wallet outcome remains locked after reload and reconnect",
        () => {
          assert.equal(f.counters.sends, 1);
          assert.equal(f.counters.preparePosts, 1);
          assert.equal(f.app.service.state().steps[0].state, "uncertain");
        },
      );
      report.scenarios.push({
        name: "unknown-wallet-response-no-hash",
        sends: f.counters.sends,
        state: "uncertain",
      });
    } finally {
      await f.close();
    }
  }
  {
    const f = await fixture();
    try {
      await f.app.service.prepareStep({
        step: 1,
        wallet: plan.deployer,
        chainId: 1,
      });
      await f.open();
      const key = savedHashKey(f.review, 1),
        base = {
          planSha256: f.review.planSha256,
          wallet: plan.deployer,
          chainId: 1,
          step: 1,
          nonce: plan.startingNonce,
          hash: fakeHash,
        };
      for (const [name, patch] of [
        ["plan", { planSha256: "0".repeat(64) }],
        ["wallet", { wallet: "0x" + "9".repeat(40) }],
        ["chain", { chainId: 10200 }],
        ["step", { step: 2 }],
        ["nonce", { nonce: plan.startingNonce + 1 }],
      ]) {
        await f.page.evaluate(
          ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
          { key, value: { ...base, ...patch } },
        );
        await f.page.reload();
        await expect(
          f.page.getByText("Browser hash metadata does not match this plan.", {
            exact: false,
          }),
        ).toBeVisible();
        const input = f.page.getByLabel(
          "Original transaction hash for step 1",
          { exact: true },
        );
        await expect(input).toHaveValue("");
        assert.equal(await input.getAttribute("readonly"), null);
        assert.equal(
          (await f.page.locator("body").textContent()).includes(fakeHash),
          false,
        );
        check(
          `Wrong ${name} metadata cannot restore or display a private saved hash`,
          () => assert.equal(f.counters.sends, 0),
        );
      }
      report.scenarios.push({
        name: "saved-hash-context-isolation",
        variants: 5,
        sends: f.counters.sends,
      });
    } finally {
      await f.close();
    }
  }
  {
    const f = await fixture({ enabled: false });
    try {
      await f.open();
      await f.connect();
      await expect(f.page.locator("#approval")).toContainText("Review-only");
      assert.equal(await f.page.locator("button.send:enabled").count(), 0);
      const response = await f.page.evaluate(async (wallet) => {
        const r = await fetch("/api/prepare-step", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ step: 1, wallet, chainId: 1 }),
        });
        return { status: r.status, body: await r.json() };
      }, plan.deployer);
      check(
        "Review-only DOM and actual prepare route deny financial handoff before initializing any provider",
        () => {
          assert.equal(response.status, 409);
          assert.equal(response.body.code, "APPROVAL_REQUIRED");
          assert.equal(f.counters.sends, 0);
          assert.equal(f.counters.providerInitializations, 0);
          assert.equal(fs.existsSync(f.journalFile), false);
        },
      );
      report.scenarios.push({
        name: "review-only-denies-wallet-handoff",
        sends: f.counters.sends,
        backendInitializations: 0,
      });
    } finally {
      await f.close();
    }
  }
  check("Every browser request stayed on the current loopback origin", () =>
    assert.deepEqual(report.externalRequests, []),
  );
  check(
    "Actual page boot, handlers and reloads produced no uncaught browser errors",
    () => assert.deepEqual(report.browserErrors, []),
  );
  report.sourceAfter = sourceHashes();
  assert.deepEqual(
    report.sourceAfter,
    before,
    "Source changed during browser verification; preserve this attempt and rerun the stable candidate",
  );
  report.status = "passed-synthetic-browser-only";
} catch (error) {
  report.status = "failed";
  report.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  await browser?.close();
  report.sourceAfter ??= sourceHashes();
  report.sourceStable =
    JSON.stringify(report.sourceAfter) === JSON.stringify(before);
  const output = path.join(evidence, "proof.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify(
      {
        status: report.status,
        checks: report.checks.length,
        scenarios: report.scenarios.length,
        sourceStable: report.sourceStable,
        publicRpcRequests: 0,
        cryptographicSignatures: 0,
        transactionBroadcasts: 0,
        output,
        ...(report.error ? { error: report.error } : {}),
      },
      null,
      2,
    ),
  );
}
