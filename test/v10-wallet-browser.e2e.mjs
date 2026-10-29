// Read-only loopback review page only. No injected wallet, RPC, signing or deployment.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { startV10WalletDeploymentServer } from "../src/v10-wallet-deployment.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
async function run() {
  const { chromium, expect } = await import("@playwright/test");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "v10-review-browser-"),
  );
  const out = path.join(
    ROOT,
    "artifacts/v10-wallet-browser",
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID(),
  );
  await fs.mkdir(out, { recursive: true });
  const proof = {
    kind: "synthetic-loopback-v10-review-page",
    status: "running",
    checks: [],
    forbidden: [],
    errors: [],
    rpcCalls: 0,
    walletCalls: 0,
    signatures: 0,
    broadcasts: 0,
    screenshots: [],
  };
  let app, browser;
  try {
    const plan = JSON.parse(
      await fs.readFile(
        path.join(
          ROOT,
          "artifacts/v10-release/user-2bb-nonce6-reviewed-account-proposed.json",
        ),
        "utf8",
      ),
    );
    app = await startV10WalletDeploymentServer({
      plan,
      port: 0,
      journalFile: path.join(directory, "journal.json"),
      delegatedCreateReview: {
        file: "artifacts/v10-release/delegated-four-create-review.json",
        sha256:
          "8769e4c2663c1746e083428b0681c84c66e6de68daa93f0cd256376e7d9c5a14",
      },
      providerFactory: async () => {
        proof.rpcCalls++;
        throw Error("No RPC in readonly browser fixture");
      },
    });
    const review = app.service.plan();
    proof.planSha256 = review.planSha256;
    proof.approvalHash = review.approvalHash;
    proof.bridgeSources = review.bridgeSources;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      const r = route.request();
      if (new URL(r.url()).origin !== app.origin || r.method() !== "GET") {
        proof.forbidden.push({ url: r.url(), method: r.method() });
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => proof.errors.push(error.message));
    await page.goto(app.origin);
    await expect(page.locator("#approval")).toContainText(
      "signing is disabled",
    );
    await expect(page.locator(".step")).toHaveCount(4);
    await expect(page.locator("body")).toContainText("no mandatory delay");
    await expect(page.locator("body")).toContainText(
      "Existing V9 events stay separate",
    );
    assert.equal(await page.locator(".send:enabled").count(), 0);
    assert.equal(await page.evaluate(() => !!window.ethereum), false);
    assert.equal(
      await page
        .locator("body")
        .innerText()
        .then((t) => /48.hour|timelock/i.test(t)),
      false,
    );
    proof.checks.push(
      "Exact4CREATE V10 plan and immediate/renounceable terms visible; all signing disabled; no wallet provider present",
    );
    for (const [name, viewport] of [
      ["desktop", { width: 1365, height: 900 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const filename = name + ".png";
      await page.screenshot({ path: path.join(out, filename), fullPage: true });
      proof.screenshots.push(filename);
    }
    proof.checks.push(
      "Desktop/mobile review has no horizontal overflow; exact plan/source/pinned-review disclosure is retained",
    );
    assert.equal(proof.rpcCalls, 0);
    assert.deepEqual(proof.forbidden, []);
    assert.deepEqual(proof.errors, []);
    await assert.rejects(
      fs.stat(path.join(directory, "journal.json")),
      (error) => error.code === "ENOENT",
    );
    proof.checks.push(
      "GET-only local page caused no provider initialization, journal write, signature or broadcast",
    );
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.errors.push(error.message);
    throw error;
  } finally {
    await browser?.close();
    await app?.close();
    await fs.rm(directory, { recursive: true, force: true });
    proof.harnessSha256 = createHash("sha256")
      .update(await fs.readFile(fileURLToPath(import.meta.url)))
      .digest("hex");
    await fs.writeFile(
      path.join(out, "proof.json"),
      JSON.stringify(proof, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        { ...proof, proofPath: path.join(out, "proof.json") },
        null,
        2,
      ),
    );
  }
}
if (process.argv.includes("--run-loopback")) await run();
else
  console.log(
    "Review only. --run-loopback enables synthetic readonly local review checks; no public RPC or wallet.",
  );
