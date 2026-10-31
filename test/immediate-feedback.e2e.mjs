// Real local v7 HTTP/contracts with a synthetic browser-wallet bridge. Keys stay
// in this Node process; no public service, wallet extension or real funds are used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "artifacts/immediate-feedback", new Date().toISOString().replace(/[:.]/g, "-"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const proof = {
  status: "running", checks: [], contexts: [], external: [], errors: [],
  scope: "Actual synthetic local v7 wallet authentication/deposits; gated browser/API waits only; no public chain or real wallet",
  sourceSha256: {},
  harnessSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
};
for (const name of ["public/app.js", "public/transaction-context.js"])
  proof.sourceSha256[name] = sha(await fs.readFile(path.join(root, name)));
const app = await startServer({ port: 0, rpcPort: 0 });
let browser;
const contexts = [], releases = [];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
try {
  browser = await chromium.launch({ headless: true });
  async function fixture(identity, options = {}) {
    const synthetic = app.workbench.session(identity);
    const privateKey = app.workbench.chain.server.provider.getInitialAccounts()[synthetic.wallet.toLowerCase()].secretKey;
    const wallet = new ethers.Wallet(privateKey, app.workbench.provider);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    contexts.push(context);
    const record = {
      identity, wallet: wallet.address, calls: [], posts: [], actualSends: 0,
      hash: null, authRefreshHeld: false, confirmedRefreshHeld: false,
      verifyRequests: 0, submittedRequests: 0, reconcileRequests: 0,
      heldReconcile: false, confirmedResponses: 0,
    };
    proof.contexts.push(record);
    const gates = new Map();
    const hold = (name) => {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      gates.set(name, { promise, release });
      releases.push(release);
    };
    const release = (name) => { gates.get(name)?.release(); gates.delete(name); };
    const wait = (name) => gates.get(name)?.promise ?? Promise.resolve();
    for (const name of options.hold ?? []) hold(name);
    let holdAuthRefresh = options.holdAuthRefresh === true;
    let holdConfirmedRefresh = false;
    await context.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== app.url) {
        proof.external.push({ method: request.method(), origin: url.origin });
        return route.abort("blockedbyclient");
      }
      if (request.method() === "POST") {
        record.posts.push(url.pathname);
        if (url.pathname === "/api/auth/verify") record.verifyRequests++;
        if (url.pathname.endsWith("/submitted")) {
          record.submittedRequests++;
          await wait("submitted");
        }
        if (url.pathname.endsWith("/submissions/reconcile")) {
          record.reconcileRequests++;
          record.heldReconcile = gates.has("reconcile");
          await wait("reconcile");
          if (options.lateError)
            return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SYNTHETIC_LATE_READ", error: "Synthetic late confirmation read unavailable" }) });
        }
      }
      if (url.pathname === "/api/bootstrap") {
        if (holdAuthRefresh && record.verifyRequests) {
          record.authRefreshHeld = true;
          await wait("auth-bootstrap");
        }
        if (holdConfirmedRefresh && record.reconcileRequests) {
          record.confirmedRefreshHeld = true;
          await wait("confirmed-bootstrap");
        }
      }
      return route.continue();
    });
    await context.routeWebSocket("**/*", (socket) => {
      proof.external.push({ method: "WebSocket", origin: socket.url() });
      socket.close();
    });
    await context.exposeBinding("__feedbackWallet", async (_source, { method, params }) => {
      record.calls.push(method);
      await wait(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [wallet.address];
      if (method === "eth_chainId") return "0x539";
      if (method === "personal_sign") return wallet.signMessage(ethers.getBytes(params[0]));
      if (method === "eth_sendTransaction") {
        if (options.rejectSend) return { syntheticRejected: true };
        record.actualSends++;
        const sent = await wallet.sendTransaction({ ...params[0], gasLimit: 500000 });
        await sent.wait();
        record.hash = sent.hash;
        return sent.hash;
      }
      throw Error("Unsupported synthetic wallet method: " + method);
    });
    await context.addInitScript(() => {
      const listeners = new Map();
      window.ethereum = {
        request: async (request) => {
          const result = await window.__feedbackWallet(request);
          if (result?.syntheticRejected) throw Object.assign(Error("Synthetic wallet request rejected"), { code: 4001 });
          return result;
        },
        on: (event, callback) => listeners.set(event, callback),
        removeListener: (event) => listeners.delete(event),
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => proof.errors.push(error.message));
    page.on("response", async (response) => {
      if (new URL(response.url()).pathname.endsWith("/submissions/reconcile") && response.status() === 200)
        record.confirmedResponses++;
    });
    await page.goto(app.url + "/#event=event-a&view=participant");
    await expect(page.locator("h1")).toHaveText("Proof of Presence");
    const connect = async () => {
      await page.locator("#top-identity").click();
      await page.locator("#review-dialog [data-connect-wallet]").click();
    };
    const authenticated = async () => {
      await connect();
      await expect(page.locator("#top-identity")).toHaveText("Verified browser wallet");
      await expect(page.locator("#content")).toBeVisible();
    };
    const prepare = async () => {
      await page.locator('[data-tx="deposit"]').first().click();
      await expect(page.locator("#review-dialog")).toBeVisible();
      await expect(page.locator("#dialog-body")).toContainText("event-a");
    };
    const entries = () => page.evaluate(() => Object.keys(localStorage)
      .filter((key) => key.startsWith("kleros-transactions:v1:"))
      .flatMap((key) => JSON.parse(localStorage.getItem(key)).transactions ?? []));
    return { context, page, record, hold, release, connect, authenticated, prepare, entries,
      releaseAuth: () => { holdAuthRefresh = false; release("auth-bootstrap"); },
      holdRefresh: () => { holdConfirmedRefresh = true; hold("confirmed-bootstrap"); },
      releaseRefresh: () => { holdConfirmedRefresh = false; release("confirmed-bootstrap"); },
    };
  }

  const alice = await fixture("alice", { hold: ["eth_requestAccounts", "personal_sign", "auth-bootstrap"], holdAuthRefresh: true });
  await alice.connect();
  await expect.poll(() => alice.record.calls.filter((method) => method === "eth_requestAccounts").length).toBe(1);
  await expect(alice.page.locator("#toast")).toBeVisible();
  await expect(alice.page.locator("#toast")).toContainText("Waiting for wallet");
  await expect(alice.page.locator("#top-identity")).not.toHaveText("Verified browser wallet");
  assert.equal(alice.record.actualSends, 0);
  alice.release("eth_requestAccounts");
  await expect.poll(() => alice.record.calls.filter((method) => method === "personal_sign").length).toBe(1);
  await expect(alice.page.locator("#toast")).toContainText("Confirm wallet sign-in");
  assert.equal(alice.record.verifyRequests, 0);
  proof.checks.push("Account and sign-in waits are visible immediately without claiming wallet verification or sending a transaction");

  alice.release("personal_sign");
  await expect.poll(() => alice.record.authRefreshHeld).toBe(true);
  await expect(alice.page.locator("#toast")).toContainText(/Wallet sign-in acknowledged[\s\S]*Checking/i);
  await expect(alice.page.locator("#top-identity")).not.toHaveText("Verified browser wallet");
  assert.equal(alice.record.actualSends, 0);
  alice.releaseAuth();
  await expect(alice.page.locator("#top-identity")).toHaveText("Verified browser wallet");
  proof.checks.push("Authentication acknowledgement is visible before held session refresh; verified identity waits for the fresh bootstrap");

  await alice.prepare();
  for (const name of ["eth_sendTransaction", "submitted", "reconcile"]) alice.hold(name);
  await alice.page.locator("[data-execute]").click();
  await expect.poll(() => alice.record.calls.filter((method) => method === "eth_sendTransaction").length).toBe(1);
  await expect(alice.page.locator('[data-transaction-stage="awaiting-wallet"]')).toBeVisible();
  await expect(alice.page.locator("[data-execute]")).toBeDisabled();
  assert.equal(alice.record.actualSends, 0);
  alice.release("eth_sendTransaction");
  await expect.poll(() => alice.record.submittedRequests).toBe(1);
  await expect(alice.page.locator('[data-transaction-stage="submitted"]')).toBeVisible();
  await expect(alice.page.locator("#transaction-status")).toContainText(alice.record.hash);
  assert.equal((await alice.entries()).find((entry) => same(entry.hash, alice.record.hash))?.status, "submitted");
  await expect(alice.page.locator("#toast")).not.toContainText("Confirmed in");
  alice.release("submitted");
  await expect.poll(() => alice.record.heldReconcile).toBe(true);
  await expect(alice.page.locator('[data-transaction-stage="submitted"]')).toBeVisible();
  assert.equal(alice.record.actualSends, 1);
  proof.checks.push("Wallet request and journaled hash show separate pending stages; no confirmation or duplicate send precedes authoritative reconciliation");

  alice.holdRefresh();
  alice.release("reconcile");
  await expect.poll(() => alice.record.confirmedRefreshHeld).toBe(true);
  await expect(alice.page.locator("#review-dialog")).not.toBeVisible();
  await expect(alice.page.locator("#toast")).toContainText("Confirmed in event-a");
  assert.equal((await alice.entries()).find((entry) => same(entry.hash, alice.record.hash))?.status, "confirmed");
  assert.equal(alice.record.actualSends, 1);
  await fs.mkdir(output, { recursive: true });
  await alice.page.screenshot({ path: path.join(output, "confirmed-before-refresh.png"), fullPage: true });
  alice.releaseRefresh();
  await expect(alice.page.locator("#content")).toContainText("Deposit verified");
  proof.checks.push("Confirmed result and closed review appear before held event refresh; canonical local receipt and confirmed journal remain authoritative");
  await alice.context.close();

  const bob = await fixture("bob", { rejectSend: true });
  await bob.authenticated();
  await bob.prepare();
  await bob.page.locator("[data-execute]").click();
  await expect(bob.page.locator("#toast")).toContainText("Synthetic wallet request rejected");
  await expect(bob.page.locator("#transaction-status")).not.toContainText("Confirmed");
  assert.equal(bob.record.actualSends, 0);
  assert.equal(bob.record.submittedRequests, 0);
  assert.deepEqual(await bob.entries(), []);
  proof.checks.push("Rejected wallet request never becomes a successful transaction or a journaled submitted hash");
  await bob.context.close();

  const carol = await fixture("carol", { hold: ["reconcile"] });
  await carol.authenticated();
  await carol.prepare();
  await carol.page.locator("[data-execute]").click();
  await expect.poll(() => carol.record.heldReconcile).toBe(true);
  await carol.page.evaluate(() => { location.hash = "event=event-b&view=participant"; });
  await expect(carol.page.locator("h1")).toHaveText("Open Justice Workshop");
  carol.release("reconcile");
  await expect.poll(async () => (await carol.entries()).find((entry) => same(entry.hash, carol.record.hash))?.status).toBe("confirmed");
  await expect(carol.page.locator("h1")).toHaveText("Open Justice Workshop");
  await expect(carol.page.locator("#toast")).not.toContainText("Confirmed in event-a");
  await expect(carol.page.locator("#review-dialog")).not.toBeVisible();
  assert.equal(carol.record.actualSends, 1);
  proof.checks.push("Late confirmation after event navigation preserves the original confirmed journal without painting success in another event");
  await carol.context.close();

  const late = await fixture("bob", { hold: ["reconcile"], lateError: true });
  await late.authenticated();
  await late.prepare();
  await late.page.locator("[data-execute]").click();
  await expect.poll(() => late.record.heldReconcile).toBe(true);
  await late.page.evaluate(() => { location.hash = "event=event-b&view=participant"; });
  await expect(late.page.locator("h1")).toHaveText("Open Justice Workshop");
  late.release("reconcile");
  await expect.poll(async () => (await late.entries()).find((entry) => same(entry.hash, late.record.hash))?.status).toBe("needs-confirmation");
  await expect(late.page.locator("#toast")).not.toContainText("Synthetic late confirmation read unavailable");
  await expect(late.page.locator("#review-dialog")).not.toBeVisible();
  assert.equal(late.record.actualSends, 1);
  proof.checks.push("Late confirmation-read failure preserves the submitted hash and does not show a stale error or automatic resend in another event");
  await late.context.close();

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
