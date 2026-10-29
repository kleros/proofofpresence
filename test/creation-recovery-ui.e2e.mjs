// Actual standalone HTML/JS over loopback with mocked transport/inspection DTOs.
// ECDSA authentication is real but synthetic/in-memory. No canonical-chain/economic claim is made here.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ethers } from "ethers";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HASH = `0x${"34".repeat(32)}`, OTHER_HASH = `0x${"56".repeat(32)}`, CHILD = `0x${"78".repeat(20)}`;
const INSTANCE = "synthetic-recovery-ui-instance", TITLE = "Synthetic original confirmed event";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const check = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };

async function run() {
  const { chromium, expect } = await import("@playwright/test");
  const wallet = ethers.Wallet.createRandom(), other = ethers.Wallet.createRandom();
  const files = new Map();
  const names = ["recovery.html", "recovery-creation.js", "setup-progress.js", "styles.css", "luma-launch.css",
    "assets/kleros-symbol.svg", "assets/kleros-logo.svg", "assets/geist-latin.woff2", "assets/geist-mono-latin.woff2",
    "assets/instrument-serif-regular.woff2", "assets/instrument-serif-italic.woff2"];
  for (const name of names) files.set(name, await fs.readFile(path.join(ROOT, "public", name)));
  const output = path.join(ROOT, "artifacts/creation-recovery-ui", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  await fs.mkdir(output, { recursive: true });
  const proof = { status: "running", scope: "loopback standalone UI + mocked transport/inspection + actual synthetic auth signature",
    startedAt: new Date().toISOString(), checkerSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
    sourcePins: Object.fromEntries([...files].map(([name, bytes]) => [name, sha(bytes)])), groups: [], screenshots: [],
    apiRequests: [], providerMethods: [], blocked: 0, pageErrors: 0, financialRequests: 0, signupRequests: 0,
    limitations: ["Inspection and HTTP authentication transport are controlled test fixtures, not the production canonical reader or cookie implementation.",
      "Actual server recovery/auth/default-deny behavior is covered separately by creation-recovery-http.test.mjs.",
      "No public URL, real wallet key file, RPC, transaction signing, deposit, dispute, adoption, hosting change or broadcast."] };
  let origin, browser, fixture = null;
  const capabilities = { createEvents: false, walletTransactions: false, manageEvents: false, adoptEvent: false };
  const baseInspection = () => ({ schemaVersion: 1, kind: "factory-creation-recovery", mode: "hosted-production", instanceId: INSTANCE,
    session: { wallet: wallet.address, mode: "recovery-only" }, wallet: wallet.address, hash: HASH, chainId: 1,
    status: "original-transaction-confirmed", provenance: "not-verified", capabilities,
    transactionConfirmed: true, transactionSucceeded: true, canonical: true, originalReviewMatches: true,
    child: CHILD, title: TITLE, eventId: "synthetic-original-event", blockNumber: 100, confirmations: 2 });
  const json = (res, status, value) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin || "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        proof.apiRequests.push({ method: req.method, path: url.pathname });
        check(fixture, "NO_ACTIVE_FIXTURE");
        const chunks = []; let size = 0;
        for await (const bytes of req) { size += bytes.length; check(size <= 10000, "BODY_LIMIT"); chunks.push(bytes); }
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        if (url.pathname === "/api/session" && req.method === "DELETE") { fixture.authenticated = false; return json(res, 200, { ok: true }); }
        if (url.pathname === "/api/recovery/auth/challenge" && req.method === "POST") {
          check(body.wallet === wallet.address && body.hash === HASH, "AUTH_CHALLENGE_INPUT");
          const nonce = randomBytes(20).toString("hex");
          const message = `Kleros original event creation recovery\nPurpose: Read only; no financial authority\nURI: ${origin}\nChain ID: 1\nWallet: ${wallet.address}\nOriginal transaction: ${HASH}\nNonce: ${nonce}\n`;
          fixture.challenge = { nonce, message, purpose: "factory-creation-recovery", chainId: 1, instanceId: INSTANCE };
          return json(res, 200, fixture.challenge);
        }
        if (url.pathname === "/api/recovery/auth/verify" && req.method === "POST") {
          check(body.nonce === fixture.challenge?.nonce && ethers.verifyMessage(fixture.challenge.message, body.signature) === wallet.address,
            "REAL_SYNTHETIC_SIGNATURE_REQUIRED");
          fixture.authenticated = true; fixture.signatures++;
          return json(res, 200, { wallet: wallet.address, mode: "recovery-only", instanceId: INSTANCE, hash: HASH,
            capabilities: { ...capabilities }, ...fixture.ackPatch });
        }
        if (url.pathname === "/api/recovery/original-creation" && req.method === "GET") {
          check(fixture.authenticated, "INSPECTION_REQUIRES_AUTH"); fixture.inspections++;
          if (fixture.gate) { fixture.gate.entered.resolve(); await fixture.gate.release.promise; }
          if (fixture.failInspection) return json(res, 503, { error: "Synthetic temporary read failure", code: "CREATION_RECOVERY_UNAVAILABLE" });
          return json(res, 200, { ...baseInspection(), ...fixture.inspectionPatch });
        }
        proof.signupRequests += /signup|participants/.test(url.pathname) ? 1 : 0;
        proof.financialRequests++; return json(res, 403, { error: "No such fixture capability", code: "FORBIDDEN" });
      }
      const name = url.pathname.slice(1);
      check(req.method === "GET" && !url.search && files.has(name), "STATIC_ALLOWLIST");
      const type = name.endsWith(".html") ? "text/html" : name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css"
        : name.endsWith(".svg") ? "image/svg+xml" : "font/woff2";
      res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff" }); res.end(files.get(name));
    } catch { if (!res.headersSent) json(res, 500, { error: "Synthetic fixture rejected request", code: "FIXTURE_REJECTED" }); else res.end(); }
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    async function pageFor(options = {}) {
      fixture = { authenticated: false, signatures: 0, inspections: 0, failInspection: false,
        ackPatch: {}, inspectionPatch: {}, ...options };
      const current = fixture;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", acceptDownloads: false });
      await context.route("**/*", (route) => {
        const request = route.request(), url = new URL(request.url());
        const api = [["DELETE", "/api/session"], ["POST", "/api/recovery/auth/challenge"],
          ["POST", "/api/recovery/auth/verify"], ["GET", "/api/recovery/original-creation"]];
        if (url.origin !== origin || url.search || !(api.some(([method, pathname]) => method === request.method() && pathname === url.pathname) ||
          request.method() === "GET" && files.has(url.pathname.slice(1)))) { proof.blocked++; return route.abort("blockedbyclient"); }
        return route.continue();
      });
      await context.routeWebSocket("**/*", (socket) => { proof.blocked++; socket.close(); });
      await context.exposeBinding("__recoveryWallet", async (_source, payload) => {
        proof.providerMethods.push(payload.method);
        if (["eth_requestAccounts", "eth_accounts"].includes(payload.method)) return [current.account || wallet.address];
        if (payload.method === "eth_chainId") return "0x1";
        check(payload.method === "personal_sign" && current.challenge && payload.params?.[1] === wallet.address &&
          ethers.toUtf8String(payload.params[0]) === current.challenge.message, "AUTH_ONLY_WALLET_METHOD");
        return wallet.signMessage(current.challenge.message);
      });
      await context.addInitScript(() => {
        const listeners = new Map();
        window.ethereum = { request: (payload) => window.__recoveryWallet(payload),
          on(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
          removeListener(name, callback) { listeners.get(name)?.delete(callback); },
          emit(name, value) { for (const callback of listeners.get(name) || []) callback(value); } };
        window.WebSocket = class { constructor() { throw Error("No WebSocket in recovery fixture"); } };
      });
      const page = await context.newPage(); page.on("pageerror", () => { proof.pageErrors++; });
      await page.goto(`${origin}/recovery.html#transaction=${HASH}`);
      await expect(page.locator("#original-transaction")).toHaveValue(HASH);
      return { page, context, state: current };
    }
    async function signIn(page) { await page.locator("[data-recovery-connect]").click(); }
    async function noFinancialUI(page) {
      await expect(page.locator("[data-setup-progress-deposit]:visible, [data-setup-progress-manage]:visible, [name=email], [name=name], [data-tx]")).toHaveCount(0);
      check(!proof.providerMethods.some((method) => !["eth_requestAccounts", "eth_accounts", "eth_chainId", "personal_sign"].includes(method)), "NO_FINANCIAL_WALLET_REQUEST");
    }
    async function capture(page, device) {
      await page.evaluate(async () => { window.scrollTo(0, 0); await document.fonts.ready;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); });
      const file = path.join(output, `${device}-confirmed-unadopted.png`); await page.screenshot({ path: file, fullPage: true });
      proof.screenshots.push({ device, path: file, sha256: sha(await fs.readFile(file)) });
    }
    {
      const { page, context, state } = await pageFor(); await signIn(page);
      await expect(page.locator("[data-recovery-facts]")).toBeVisible(); await expect(page.locator("[data-recovery-facts] h2")).toHaveText(TITLE);
      await expect(page.locator("[data-setup-progress-hash]")).toHaveValue(HASH);
      await expect(page.locator("[data-recovery-facts]")).toContainText("Not enabled by this read-only check");
      await expect(page.locator("[data-setup-progress]")).toHaveAttribute("data-setup-phase", "verification-failed");
      await expect(page.locator("[data-recovery-status]")).toContainText("No transaction was sent.");
      check(state.signatures === 1 && state.inspections === 1, "ONE_AUTH_SIGNATURE_AND_INSPECTION");
      await noFinancialUI(page); await capture(page, "desktop");
      await page.setViewportSize({ width: 390, height: 844 }); await capture(page, "mobile");
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "MOBILE_NO_HORIZONTAL_OVERFLOW");
      proof.groups.push("confirmed-original-call-without-adoption-or-financial-authority"); await context.close();
    }
    {
      const { page, context, state } = await pageFor({ failInspection: true }); await signIn(page);
      await expect(page.locator("[data-recovery-error]")).toBeVisible(); await expect(page.locator("#original-transaction")).toHaveValue(HASH);
      state.failInspection = false; await page.locator("[data-recovery-check]").click();
      await expect(page.locator("[data-recovery-facts]")).toBeVisible(); await expect(page.locator("#original-transaction")).toHaveValue(HASH);
      check(state.signatures === 1 && state.inspections === 2, "RETRY_INSPECTS_SAME_HASH_WITHOUT_NEW_SIGNATURE");
      await noFinancialUI(page); proof.groups.push("read-error-retry-retains-original-hash"); await context.close();
    }
    {
      for (const ackPatch of [{ wallet: other.address }, { hash: OTHER_HASH }, { instanceId: "wrong-server-instance" },
        { capabilities: { ...capabilities, walletTransactions: true } }]) {
        const { page, context, state } = await pageFor({ ackPatch }); await signIn(page);
        await expect(page.locator("[data-recovery-error]")).toBeVisible(); await expect(page.locator("[data-recovery-facts]")).toBeHidden();
        await expect(page.locator("#original-transaction")).toHaveValue(HASH); check(state.inspections === 0, "WRONG_ACK_CANNOT_INSPECT");
        check(!(await page.locator("body").textContent()).includes(TITLE), "WRONG_ACK_NO_PRIVATE_PAINT"); await context.close();
      }
      const { page, context } = await pageFor({ inspectionPatch: { instanceId: "wrong-server-instance", title: "PRIVATE_WRONG_SCOPE_FACTS" } });
      await signIn(page); await expect(page.locator("[data-recovery-error]")).toBeVisible();
      await expect(page.locator("[data-recovery-facts]")).toBeHidden();
      check(!(await page.locator("body").textContent()).includes("PRIVATE_WRONG_SCOPE_FACTS"), "WRONG_INSPECTION_SCOPE_NO_PAINT");
      proof.groups.push("ack-wallet-hash-instance-and-inspection-scope-boundaries"); await context.close();
    }
    {
      const gate = { entered: deferred(), release: deferred() };
      const { page, context, state } = await pageFor({ gate, inspectionPatch: { title: "PRIVATE_LATE_FACTS" } });
      await signIn(page); await gate.entered.promise;
      state.account = other.address; await page.evaluate((address) => window.ethereum.emit("accountsChanged", [address]), other.address);
      gate.release.resolve();
      await expect(page.locator("[data-recovery-status]")).toContainText("wallet or network changed");
      await expect(page.locator("[data-recovery-facts]")).toBeHidden(); await expect(page.locator("#original-transaction")).toHaveValue(HASH);
      check(!(await page.locator("body").textContent()).includes("PRIVATE_LATE_FACTS"), "STALE_ACCOUNT_NO_LATE_PAINT");
      check(state.signatures === 1, "ACCOUNT_CHANGE_CANNOT_TRIGGER_REAUTH"); await noFinancialUI(page);
      proof.groups.push("account-change-discards-delayed-private-response"); await context.close();
    }
    check(proof.groups.length === 4 && proof.blocked === 0 && proof.pageErrors === 0 && proof.financialRequests === 0 && proof.signupRequests === 0,
      "FOUR_BOUNDED_GROUPS_NO_FORBIDDEN_EFFECTS");
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed"; proof.failure = { code: typeof error?.code === "string" ? error.code : "CREATION_RECOVERY_UI_CHECK_FAILED" };
  } finally {
    await browser?.close(); await new Promise((done) => server.close(done));
    proof.completedAt = new Date().toISOString(); await fs.writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
  }
  console.log(JSON.stringify({ status: proof.status, groups: proof.groups.length, screenshots: proof.screenshots.length,
    proof: path.join(output, "proof.json"), failure: proof.failure, financialRequests: proof.financialRequests, signupRequests: proof.signupRequests }, null, 2));
  if (proof.status !== "passed") process.exitCode = 1;
}

if (process.argv.length === 2) console.log("Review only. Run node test/creation-recovery-ui.e2e.mjs --run-loopback for four synthetic browser groups; no public network or financial operation.");
else if (process.argv.length === 3 && process.argv[2] === "--run-loopback")
  run().catch(() => { console.error("CREATION_RECOVERY_UI_FIXTURE_FAILED"); process.exitCode = 1; });
else { console.error("Explicit --run-loopback only"); process.exitCode = 1; }
