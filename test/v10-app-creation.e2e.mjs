// Actual Chromium → loopback production app → local V10 CREATE/adoption. Default opens nothing.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

async function run() {
  const { chromium, expect } = await import("@playwright/test"), { createV10AppFixture, V10_APP_PROFILE } = await import("./fixtures/v10-app-fixture.mjs");
  const out = path.join(ROOT, "artifacts/v10-app-creation", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID());
  await fs.mkdir(out, { recursive: true });
  const proof = { schemaVersion: 1, kind: "actual-local-v10-app-creation", status: "running", sourceBaseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeSourceHashesAuthoritative: true, checks: [], screenshots: [], http: [], walletCalls: [], errors: [], blocked: [], assets: {}, source: {},
    publicNetworkRequests: 0, privateSigningFilesRead: 0, keysExposedToBrowser: 0,
    limits: ["Actual app/factory/controller/proxies/store/source verifiers run on local synthetic chain1; public Ethereum/Court runtime verification is trusted-injected and adjudication code is mocked.",
      "Synthetic EOA signs one real local CREATE and actual nonce messages in Node RAM. No extension prompt, real guest, public transaction or delegated financial activation is claimed."] };
  let fixture, browser, page;
  const pass = (condition, label) => { assert(condition, label); proof.checks.push(label); };
  const captures = async (target, name) => { await target.evaluate(() => scrollTo(0, 0)); await target.waitForTimeout(100);
    const filename = name + ".png"; await target.screenshot({ path: path.join(out, filename), fullPage: true }); proof.screenshots.push(filename); };
  try {
    fixture = await createV10AppFixture(); browser = await chromium.launch({ headless: true });
    for (const file of ["test/v10-app-creation.e2e.mjs", "test/fixtures/v10-app-fixture.mjs", "src/server.mjs", "src/workbench.mjs", "src/public-catalog.mjs",
      "src/organizer-jobs.mjs", "src/v10-factory-onboarding.mjs", "src/v10-mainnet-runtime.mjs", "src/v10-upgrade-verification.mjs", "src/v10-upgrade-artifacts.mjs",
      "src/v10-production-wallets.mjs", "src/v10-receipt-context.mjs", "src/v10-wallet-compatibility.mjs"])
      proof.source[file] = sha(await fs.readFile(path.join(ROOT, file)));
    const observedBoots = [], observedCatalogs = [];
    const makeContext = async (withWallet) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC", serviceWorkers: "block", reducedMotion: "reduce" });
      await context.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url()), method = req.method(), pathname = url.pathname;
        const apiGet = method === "GET" && (pathname === "/api/bootstrap" || pathname === "/api/public-catalog" || /^\/api\/organizer\/events\/(jobs|drafts)\/[A-Za-z0-9_-]+$/.test(pathname));
        const apiPost = method === "POST" && (["/api/auth/challenge", "/api/auth/verify", "/api/organizer/events/jobs"].includes(pathname) || /^\/api\/organizer\/events\/drafts\/[A-Za-z0-9_-]+\/submitted$/.test(pathname));
        const asset = method === "GET" && (pathname === "/" || /^\/[A-Za-z0-9_-]+\.(js|css|html)$/.test(pathname) || /^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname));
        if (url.origin !== fixture.origin || (!apiGet && !apiPost && !asset)) { proof.blocked.push({ method, pathname }); return route.abort(); }
        try {
          const response = await fixture.forward(pathname + url.search, { method, headers: req.headers(), body: req.postDataBuffer() ?? undefined });
          proof.http.push({ method, pathname, status: response.status });
          if (asset) {
            const sourceFile = pathname === "/" ? "public/index.html" : "public" + pathname;
            const expected = await fs.readFile(path.join(ROOT, sourceFile)); assert.equal(sha(response.body), sha(expected), "Served asset differs from current source");
            proof.assets[sourceFile] = sha(expected);
          } else {
            const value = JSON.parse(response.body.toString());
            if (pathname === "/api/bootstrap" && response.status === 200) observedBoots.push(value);
            if (pathname === "/api/public-catalog" && response.status === 200) observedCatalogs.push(value);
          }
          const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !["connection", "transfer-encoding", "content-length", "date"].includes(key))
            .map(([key, value]) => [key, Array.isArray(value) ? value.join("\n") : String(value)]));
          await route.fulfill({ status: response.status, headers, body: response.body });
        } catch { proof.errors.push({ stage: "actual-loopback-response", pathname }); await route.abort(); }
      });
      await context.routeWebSocket("**/*", socket => { proof.blocked.push({ method: "WebSocket" }); socket.close(); });
      const target = await context.newPage(); target.on("pageerror", error => proof.errors.push({ stage: "page", name: error.name }));
      if (withWallet) {
        await target.exposeBinding("__v10FixtureWallet", async ({ page: caller, frame }, request) => {
          assert.equal(caller, target); assert.equal(frame, target.mainFrame()); proof.walletCalls.push({ method: request.method });
          return fixture.wallet(request, target.url());
        });
        await target.addInitScript(() => { window.ethereum = { request: request => window.__v10FixtureWallet(request), on() {}, removeListener() {}, isMetaMask: true }; });
      }
      return { context, page: target };
    };
    const owner = await makeContext(true); page = owner.page;
    await page.goto(fixture.origin + "/"); await expect(page.locator("[data-public-catalog-screen]")).toBeVisible();
    pass(observedCatalogs.length === 1 && observedCatalogs[0].events.length === 0, "Initial anonymous public catalog is empty");
    await page.locator('a[href="#setup=kickback"]').click(); await expect(page.locator("#luma-setup [data-connect-wallet]")).toBeVisible();
    await page.locator("#luma-setup [data-connect-wallet]").click();
    await expect(page.locator("[data-luma-form]")).toBeVisible({ timeout: 30000 });
    const boot = observedBoots.at(-1);
    pass(boot.contractVersion === V10_APP_PROFILE && boot.contractProfile.version === 10 && boot.session.wallet === fixture.organizerAddress,
      "Actual nonce authentication yields the correct V10 wallet/profile/session");
    pass(boot.capabilities.eip7702 === true && boot.capabilities.serverSigning === false && boot.walletSupport.type === "eoa-or-metamask-protected-self-v1.3" &&
      boot.walletSupport.accountPolicyVersion === "v10-metamask-self-v1.3-1" && await fixture.provider.getCode(fixture.organizerAddress) === "0x",
      "Source-owned local wallet candidate stays keyless, and this acceptance actor remains an actual empty-code EOA");
    pass(boot.factory.upgrade.governanceKind === "single-owner-immediate" && boot.factory.upgrade.delaySeconds === 0, "Verified V10 factory uses immediate governance");
    const now = (await fixture.provider.getBlock("latest")).timestamp, start = Math.ceil((now + 3600) / 60) * 60;
    const title = "Synthetic V10 browser creation", lumaUrl = "https://luma.com/synthetic-v10-browser";
    for (const [selector, value] of [["#luma-title", title], ["#luma-url", lumaUrl], ["#luma-start", new Date(start * 1000).toISOString().slice(0, 16)],
      ["#luma-end", new Date((start + 7200) * 1000).toISOString().slice(0, 16)], ["#luma-deposit", "0.000001"]]) await page.locator(selector).fill(value);
    await expect(page.locator("#luma-timezone")).toHaveValue("UTC");
    await page.locator('[data-luma-action="review"]').click(); await expect(page.locator("dialog[data-luma-dialog]")).toBeVisible({ timeout: 30000 });
    const reviewed = fixture.reviewedDraft(); assert(reviewed);
    pass(reviewed.contractVersion === V10_APP_PROFILE && reviewed.terms.title === title && reviewed.terms.lumaUrl === lumaUrl && reviewed.terms.eventStart === start &&
      reviewed.terms.endsAt === new Date((start + 7200) * 1000).toISOString() && reviewed.terms.timezone === "UTC" && reviewed.terms.depositWei === "1000000000000",
      "Six actual form terms produce the exact V10 authoritative prepared review");
    await expect(page.locator("dialog[data-luma-dialog]")).toContainText(fixture.manifest.factoryDeployment.factory);
    await expect(page.locator("dialog[data-luma-dialog]")).toContainText("0 ETH");
    pass(fixture.stats.walletRequests === 0, "Prepare/review/validation transport has not broadcast a transaction");
    fixture.armCreation(reviewed.id); await page.locator('[data-luma-action="confirm"]').click();
    await expect(page.locator("[data-luma-created]")).toBeVisible({ timeout: 30000 });
    const share = await page.locator("[data-luma-created]").elementHandle();
    await expect(page.locator("[data-owned-event-row]")).toHaveCount(1, { timeout: 30000 });
    const sent = fixture.stats.sent[0], saved = fixture.savedState(), record = saved.events[0], receipt = await fixture.provider.getTransactionReceipt(sent.hash);
    pass(fixture.stats.walletRequests === 1 && receipt.status === 1 && saved.drafts[0][1].submittedHash === sent.hash && saved.drafts[0][1].confirmedHash === sent.hash,
      "One actual local wallet CREATE has a canonical successful receipt and the same durable submitted/confirmed hash");
    pass(saved.namespace === "ethereum-mainnet-v10" && record.dynamic === true && record.definition.visibility === "public" && record.definition.editorialStatus === "published" &&
      record.deployment.contractVersion === V10_APP_PROFILE && record.eventId === reviewed.eventId,
      "Canonical V10 source verification adopts the exact public/published child in the isolated durable store");
    pass(await share.evaluate(node => node.isConnected), "Owned-event inventory refresh preserves the confirmed receipt/share DOM");
    await expect(page.locator("[data-owned-event-row]")).toContainText(title);
    await expect(page.locator("[data-luma-deposit-link]")).toHaveValue(fixture.origin + "/#event=" + reviewed.eventId + "&view=participant");
    await expect(page.locator("[data-owned-event-manage]")).toHaveAttribute("href", "#event=" + reviewed.eventId + "&view=organizer");
    await captures(page, "desktop-created-and-owned");
    await page.setViewportSize({ width: 390, height: 844 }); await captures(page, "mobile-created-and-owned");
    await page.locator('a.back-link[href="#"]').click(); await expect(page.locator("[data-public-event-row]")).toHaveCount(1);
    await expect(page.locator("[data-public-event-row]")).toContainText(title);
    pass(observedCatalogs.length >= 2 && observedCatalogs.at(-1).events[0].id === reviewed.eventId, "Navigating home fetches a fresh public catalog containing the actual created event");
    await owner.context.close(); await fixture.restart();
    const anonymous = await makeContext(false); page = anonymous.page; await page.goto(fixture.origin + "/");
    await expect(page.locator("[data-public-event-row]")).toHaveCount(1); await expect(page.locator("[data-public-event-row]")).toContainText(title);
    const catalog = observedCatalogs.at(-1); pass(catalog.events[0].contract === record.deployment.contract && catalog.events[0].adoption.txHash === sent.hash && catalog.events[0].contractVersion === V10_APP_PROFILE,
      "A real backend restart and fresh anonymous browser retain the same recorded public child and receipt");
    await captures(page, "anonymous-home-after-restart"); await anonymous.context.close();
    proof.creation = { eventId: reviewed.eventId, contract: record.deployment.contract, transactionHash: sent.hash, blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash, profile: V10_APP_PROFILE, gasUsed: String(receipt.gasUsed), policySha256: reviewed.terms.policySha256 };
    proof.stats = fixture.stats; pass(proof.errors.length === 0 && proof.blocked.length === 0 && fixture.stats.backendSigningCalls === 0, "No off-origin request, page error or backend signing capability was used");
    pass(fixture.stats.authSignatures === 1 && fixture.stats.walletRequests === 1, "Exactly one synthetic nonce signature and one local CREATE wallet request");
    for (const [file, digest] of Object.entries(proof.source)) assert.equal(sha(await fs.readFile(path.join(ROOT, file))), digest, "Backend/harness source changed during acceptance");
    for (const [file, digest] of Object.entries(proof.assets)) assert.equal(sha(await fs.readFile(path.join(ROOT, file))), digest, "Served app source changed during acceptance");
    proof.status = "passed";
  } catch (error) { proof.status = "failed"; proof.failure = { name: error.name, code: typeof error.code === "string" ? error.code : "ACCEPTANCE_ASSERTION" };
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {}); throw error;
  } finally {
    if (fixture) {
      proof.stats = structuredClone(fixture.stats);
      proof.retainedCreations = (fixture.savedState()?.drafts ?? []).map(([, item]) => ({ draftId: item.id, eventId: item.eventId,
        status: item.status, submittedHash: item.submittedHash ?? null, confirmedHash: item.confirmedHash ?? null,
        createdContract: item.createdContract ?? null, adoptionStatus: item.adoptionStatus ?? null }));
      proof.localReceiptFacts = await Promise.all(fixture.stats.sent.map(async item => {
        const receipt = await fixture.provider.getTransactionReceipt(item.hash);
        return { hash: item.hash, eventId: item.eventId, status: receipt?.status ?? null,
          blockNumber: receipt?.blockNumber ?? null, blockHash: receipt?.blockHash ?? null };
      }));
    }
    await browser?.close(); await fixture?.close(); await fs.writeFile(path.join(out, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
    console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proofPath: path.join(out, "proof.json") }));
  }
}
if (process.argv.length === 2) console.log(JSON.stringify({ status: "review-only", publicNetworkRequests: 0, loopbackRequests: 0, privateSigningFilesRead: 0, signatures: 0, walletRequests: 0 }));
else if (process.argv.length === 3 && process.argv[2] === "--run-loopback") await run();
else throw Error("Use the explicit local-only --run-loopback flag; no RPC or key options are accepted");
