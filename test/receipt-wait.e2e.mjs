// Actual local v7 deposits and synthetic browser wallets. Only the browser clock
// advances; Ganache/public chain time, real wallets and external services do not.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "artifacts/receipt-wait", new Date().toISOString().replace(/[:.]/g, "-"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const proof = { status: "running", checks: [], contexts: [], external: [], errors: [], sourceSha256: {},
  scope: "Actual synthetic local v7 deposits; gated loopback responses and virtual browser time only; no public chain, production wallet or chain time changes",
  harnessSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
};
for (const name of ["public/app.js", "public/transaction-context.js"])
  proof.sourceSha256[name] = sha(await fs.readFile(path.join(root, name)));
const app = await startServer({ port: 0, rpcPort: 0 });
const chainBefore = await app.workbench.provider.getBlock("latest");
let browser;
const contexts = [], releases = [];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
try {
  browser = await chromium.launch({ headless: true });
  async function fixture(identity, mode) {
    const synthetic = app.workbench.session(identity);
    const key = app.workbench.chain.server.provider.getInitialAccounts()[synthetic.wallet.toLowerCase()].secretKey;
    const wallet = new ethers.Wallet(key, app.workbench.provider);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    contexts.push(context);
    const record = { identity, mode, wallet: wallet.address, walletCalls: [], sends: 0, hash: null,
      acknowledgments: 0, checks: [], completedChecks: 0, maxConcurrentChecks: 0,
      heldResponse: false, releasedLateResponse: false, aborted: 0 };
    proof.contexts.push(record);
    let behavior = mode, activeChecks = 0, page, releaseResponse;
    const gate = new Promise((resolve) => { releaseResponse = resolve; });
    releases.push(releaseResponse);
    await context.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== app.url) {
        proof.external.push({ method: request.method(), origin: url.origin });
        return route.abort("blockedbyclient");
      }
      const acknowledge = request.method() === "POST" && url.pathname.endsWith("/submitted");
      const check = request.method() === "POST" && url.pathname.endsWith("/submissions/reconcile");
      if (acknowledge) record.acknowledgments++;
      if (check) {
        activeChecks++;
        record.maxConcurrentChecks = Math.max(record.maxConcurrentChecks, activeChecks);
        record.checks.push({ path: url.pathname, virtualMs: await page.evaluate(() => performance.now()) });
      }
      try {
        if ((acknowledge && behavior === "hung-ack") || (check && behavior === "hung-check")) {
          // The backend may finish despite the client deadline. Retain that
          // real response and show that it cannot revive the closed watcher.
          const response = await route.fetch();
          record.heldResponse = true;
          await gate;
          record.releasedLateResponse = true;
          try { await route.fulfill({ response }); } catch { /* Browser already aborted. */ }
          return;
        }
        if (check && behavior === "pending") {
          const body = request.postDataJSON();
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
            status: "pending", eventId: "event-a", hash: body.hash, draftId: body.draftId,
            wallet: wallet.address, chainId: 1337, contract: app.workbench.contract("event-a").target,
          }) });
          record.completedChecks++;
          return;
        }
        return await route.continue();
      } finally {
        if (check) activeChecks--;
      }
    });
    await context.routeWebSocket("**/*", (socket) => {
      proof.external.push({ method: "WebSocket", origin: socket.url() });
      socket.close();
    });
    await context.exposeBinding("__receiptWallet", async (_source, { method, params }) => {
      record.walletCalls.push(method);
      if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [wallet.address];
      if (method === "eth_chainId") return "0x539";
      if (method === "personal_sign") return wallet.signMessage(ethers.getBytes(params[0]));
      if (method === "eth_sendTransaction") {
        record.sends++;
        const sent = await wallet.sendTransaction({ ...params[0], gasLimit: 500000 });
        await sent.wait();
        record.hash = sent.hash;
        return sent.hash;
      }
      throw Error("Unsupported synthetic wallet method: " + method);
    });
    await context.addInitScript(() => {
      window.ethereum = { request: (request) => window.__receiptWallet(request), on() {}, removeListener() {} };
    });
    page = await context.newPage();
    await page.clock.install();
    page.on("pageerror", (error) => proof.errors.push(error.message));
    page.on("requestfailed", (request) => {
      if (/\/submitted$|\/submissions\/reconcile$/.test(new URL(request.url()).pathname)) record.aborted++;
    });
    await page.goto(app.url + "/#event=event-a&view=participant");
    await expect(page.locator("h1")).toHaveText("Proof of Presence");
    await page.locator("#top-identity").click();
    await page.locator("#review-dialog [data-connect-wallet]").click();
    await expect(page.locator("#top-identity")).toHaveText("Verified browser wallet");
    await page.locator('[data-tx="deposit"]').first().click();
    await expect(page.locator("#review-dialog")).toBeVisible();
    await page.locator("[data-execute]").click();
    const entries = () => page.evaluate(() => Object.keys(localStorage)
      .filter((name) => name.startsWith("kleros-transactions:v1:"))
      .flatMap((name) => JSON.parse(localStorage.getItem(name)).transactions ?? []));
    const pause = async () => {
      const time = await page.evaluate(() => Date.now());
      await page.clock.pauseAt(new Date(time + 1000));
    };
    const unresolved = async () => {
      await expect(page.locator('[data-transaction-stage="needs-confirmation"]')).toBeVisible();
      await expect(page.locator("#transaction-status")).toContainText("Success or failure is not established");
      await expect(page.locator("#transaction-status")).toContainText(record.hash);
      await expect(page.locator("[data-execute]")).toBeDisabled();
      await expect(page.locator("[data-execute]")).toHaveText("Check original transaction");
      await expect(page.locator("#toast")).not.toContainText("Confirmed in");
      assert.equal((await entries()).find((entry) => same(entry.hash, record.hash))?.status, "needs-confirmation");
      assert.equal(record.sends, 1);
    };
    return { context, page, record, entries, pause, unresolved,
      releaseLate: () => releaseResponse(),
      recover: async () => {
        behavior = "real";
        releaseResponse();
        await page.clock.resume();
        await page.reload();
        await expect(page.locator("#content")).toContainText("Deposit verified");
        await expect.poll(async () => (await entries()).find((entry) => same(entry.hash, record.hash))?.status).toBe("confirmed");
        assert.equal(record.sends, 1);
      },
    };
  }

  const pending = await fixture("alice", "pending");
  await expect.poll(() => pending.record.completedChecks).toBe(1);
  await pending.pause();
  const delays = [3000, 5000, 10000, 15000, 30000, 30000];
  for (const [index, delay] of delays.entries()) {
    // A finished JSON response plus a renderer task lets the next serial sleep
    // register before virtual time advances. No chain time is advanced.
    await pending.page.evaluate(() => Promise.resolve());
    await pending.page.clock.fastForward(delay + 5);
    await expect.poll(() => pending.record.completedChecks).toBe(index + 2);
  }
  await pending.unresolved();
  assert.equal(pending.record.checks.length, 7);
  assert.equal(pending.record.maxConcurrentChecks, 1);
  assert.equal(pending.record.acknowledgments, 1);
  await pending.page.clock.fastForward(180001);
  assert.equal(pending.record.checks.length, 7);
  assert.equal(pending.record.sends, 1);
  proof.checks.push("Seven serial pending checks use bounded backoff, stop automatically, preserve the original hash and never resend");
  await pending.context.close();

  const ack = await fixture("bob", "hung-ack");
  await expect.poll(() => ack.record.heldResponse).toBe(true);
  await ack.pause();
  await ack.page.clock.fastForward(180001);
  await ack.unresolved();
  await expect.poll(() => ack.record.aborted).toBe(1);
  assert.equal(ack.record.acknowledgments, 1);
  assert.equal(ack.record.checks.length, 0);
  ack.releaseLate();
  await expect.poll(() => ack.record.releasedLateResponse).toBe(true);
  await ack.unresolved();
  proof.checks.push("A stalled acknowledgment is covered by the overall deadline; its late response cannot restart checking or claim a terminal outcome");
  await ack.context.close();

  const check = await fixture("carol", "hung-check");
  await expect.poll(() => check.record.heldResponse).toBe(true);
  await check.pause();
  await check.page.clock.fastForward(180001);
  await check.unresolved();
  await expect.poll(() => check.record.aborted).toBe(1);
  assert.equal(check.record.acknowledgments, 1);
  assert.equal(check.record.checks.length, 1);
  check.releaseLate();
  await expect.poll(() => check.record.releasedLateResponse).toBe(true);
  await check.unresolved();
  await fs.mkdir(output, { recursive: true });
  await check.page.screenshot({ path: path.join(output, "receipt-check-limit.png"), fullPage: true });
  proof.checks.push("A stalled receipt read is aborted at the overall deadline; even its late canonical receipt cannot change the stopped UI/journal");

  await check.recover();
  await expect(check.page.locator("#review-dialog")).not.toBeVisible();
  assert.equal((await check.entries()).filter((entry) => same(entry.hash, check.record.hash)).length, 1);
  assert.equal(check.record.sends, 1);
  proof.checks.push("Explicit reload recovers the same original hash and canonical local receipt without another wallet request or transaction");
  await check.context.close();

  const chainAfter = await app.workbench.provider.getBlock("latest");
  proof.chainTimestamp = { before: chainBefore.timestamp, after: chainAfter.timestamp,
    browserVirtualAdvanceMs: 180001 * 3 + delays.reduce((sum, delay) => sum + delay + 5, 0),
    chainTimeChanges: 0 };
  assert.ok(chainAfter.timestamp - chainBefore.timestamp < 60, "Virtual browser minutes never advance chain time");
  assert.deepEqual(proof.external, []);
  assert.deepEqual(proof.errors, []);
  proof.status = "passed";
} catch (error) {
  proof.status = "failed";
  proof.failure = String(error?.stack ?? error);
  throw error;
} finally {
  for (const release of releases) release();
  await browser?.close();
  await app.close();
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, output, external: proof.external.length, pageErrors: proof.errors.length }, null, 2));
}
