// Current app mounted with synthetic API projections only. Explicit run never reaches a real wallet or chain.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { makeLumaLaunchFixture, makeLumaParticipantDraft } from "./fixtures/luma-launch-fixture.mjs";
import { FIXTURE_OWNER, FIXTURE_WALLET, FIXTURE_ALTERNATE } from "./fixtures/production-ui-fixture.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url)), PROFILE = "kleros-event-v10-uups";
const ORIGIN = "https://event-read-ui.example.invalid", INSTANCE = "timeout-synthetic-instance";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
function projection(scenario, eventId) {
  const value = makeLumaLaunchFixture(scenario, { eventId, walletAddress: FIXTURE_OWNER, instanceId: INSTANCE });
  const { bootstrap: b, detail: d } = value;
  const metadata = { ...b.contractProfile, contractVersion: PROFILE, abiVersion: PROFILE, version: 10,
    governanceKind: "single-owner-immediate", upgradeDelaySeconds: 0, renounceable: true };
  Object.assign(b, { contractVersion: PROFILE, abiVersion: PROFILE, contractProfile: metadata,
    governance: { kind: "single-owner-immediate", initialOwner: FIXTURE_OWNER, upgradeDelaySeconds: 0, renounceable: true },
    features: { casePublication: false, originalCreationRecovery: false } });
  Object.assign(b.capabilities, { eventReadJobs: true, casePublication: false, originalCreationRecovery: false });
  Object.assign(d.event, { contractVersion: PROFILE, abiVersion: PROFILE, contractProfile: structuredClone(metadata),
    title: scenario === "organizer" ? "Synthetic owner event A" : "Synthetic participant event B" });
  if (scenario !== "organizer") { d.event.contract = FIXTURE_ALTERNATE; d.state.owner = FIXTURE_WALLET; d.event.role = "participant"; }
  d.upgrade = { kind: "uups", version: 10, verified: true, governanceKind: "single-owner-immediate",
    implementation: "0x" + "a".repeat(40), implementationCodeHash: "0x" + "b".repeat(64),
    authority: "0x" + "8".repeat(40), authorityCodeHash: "0x" + "c".repeat(64), initialOwner: FIXTURE_OWNER,
    owner: FIXTURE_OWNER, pendingOwner: "0x" + "0".repeat(40), upgradesDisabled: false,
    delaySeconds: 0, finalizationVerified: false, finalizationScope: "event" };
  d.features = { casePublication: false, originalCreationRecovery: false };
  if (d.ownWallet?.deposit) Object.assign(d.ownWallet.deposit, { abiVersion: PROFILE, contract: d.event.contract });
  b.events = [structuredClone(d.event)];
  b.selectedEvent = { eventId, instanceId: INSTANCE, wallet: b.session.wallet, detail: d, error: null };
  return value;
}
export async function runEventReadUI() {
  const { chromium, expect } = await import("@playwright/test");
  const out = path.join(ROOT, "artifacts/event-read-client", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID());
  await fs.mkdir(out, { recursive: true });
  const proof = { kind: "synthetic-event-read-ui", status: "running", checks: [], requests: [], source: {},
    blocked: [], errors: [], screenshots: [], walletRequests: [], financialBroadcasts: 0, publicNetworkRequests: 0,
    limitations: ["Current actual app and static assets mounted in Chromium with synthetic owner/participant/API projections.",
      "Only asynchronous read jobs are permitted. No actual backend, authentication, financial wallet call, chain, receipt or funds are exercised."] };
  const sources = ["public/app.js", "public/event-read.js", "public/selected-event.js", "public/environment.js", "public/contract-profiles.js", "public/transaction-context.js", "public/v10-wallet-account.js", "test/event-read-ui.e2e.mjs"];
  for (const file of sources) proof.source[file] = sha(await fs.readFile(path.join(ROOT, file)));
  const assets = new Map();
  async function visit(dir, prefix = "") { for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const name = prefix + item.name; if (item.isDirectory()) await visit(path.join(dir, item.name), name + "/");
    else if (mime[path.extname(name)]) assets.set("/" + name, await fs.readFile(path.join(dir, item.name))); } }
  await visit(path.join(ROOT, "public")); assets.set("/", assets.get("/index.html"));
  const A = projection("organizer", "timeout-event-a"), B = projection("ready", "timeout-event-b");
  const projections = new Map([[A.detail.event.id, A], [B.detail.event.id, B]]), jobs = new Map();
  const held = new Set(["bootstrap:" + A.detail.event.id, "bootstrap:" + B.detail.event.id, "validate:" + A.detail.event.id]);
  let browser, context, page;
  const check = (value, name) => { assert(value, name); proof.checks.push(name); };
  const requestCount = (operation, eventId) => proof.requests.filter(r => r.method === "POST" && r.operation === operation && r.eventId === eventId).length;
  const dto = job => ({ kind: "event-read-job", schemaVersion: 1, requestId: job.requestId, operation: job.operation,
    instanceId: INSTANCE, chainId: 1, contractVersion: PROFILE, eventId: job.eventId, wallet: FIXTURE_OWNER,
    ...(held.has(job.operation + ":" + job.eventId) ? { state: "pending", pollAfterMs: 500 } :
      { state: "ready", expiresAt: Date.now() + 60000, result: job.operation === "bootstrap" ? projections.get(job.eventId).bootstrap :
        job.operation === "deposit" ? makeLumaParticipantDraft(projections.get(job.eventId)) :
        { transaction: makeLumaParticipantDraft(projections.get(job.eventId)).transaction } }) });
  const json = value => ({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(value) });
  try {
    browser = await chromium.launch({ headless: true }); context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    await context.route("**/*", async route => {
      const req = route.request(), u = new URL(req.url()), method = req.method();
      try {
        assert.equal(u.origin, ORIGIN, "No public or external request is allowed");
        if (method === "GET" && assets.has(u.pathname) && !u.search) {
          proof.requests.push({ path: u.pathname, method });
          return route.fulfill({ status: 200, contentType: mime[path.extname(u.pathname)] ?? "text/html", body: assets.get(u.pathname) });
        }
        if (method === "GET" && u.pathname === "/api/bootstrap") {
          const eventId = u.searchParams.get("selectedEventId");
          assert(u.searchParams.size === 2 || (u.searchParams.size === 3 && u.searchParams.getAll("selectedOnly").length === 1 && u.searchParams.get("selectedOnly") === "1"));
          assert.equal(u.searchParams.getAll("selectedEventId").length, 1);
          assert.equal(u.searchParams.getAll("background").length, 1);
          assert.equal(u.searchParams.get("background"), "1"); assert(projections.has(eventId));
          proof.requests.push({ path: u.pathname, method, eventId });
          return route.fulfill(json({ kind: "event-read-transport", enabled: true, chainId: 1, contractVersion: PROFILE, instanceId: INSTANCE }));
        }
        if (method === "POST" && u.pathname === "/api/event-read-jobs" && !u.search) {
          const input = req.postDataJSON(); assert(["bootstrap", "deposit", "validate"].includes(input.operation));
          const eventId = input.operation === "bootstrap" ? input.selectedEventId : input.eventId;
          assert(projections.has(eventId)); assert(/^[A-Za-z0-9_-]+$/.test(input.requestId)); assert(!jobs.has(input.requestId));
          assert.deepEqual(Object.keys(input).sort(), input.operation === "bootstrap" ? ["operation", "requestId", "selectedEventId"] :
            input.operation === "deposit" ? ["eventId", "operation", "requestId"] : ["draftId", "eventId", "operation", "requestId"]);
          if (input.operation === "validate") assert.equal(input.draftId, "synthetic-luma-deposit-draft");
          const job = { ...input, eventId }; jobs.set(input.requestId, job);
          proof.requests.push({ path: u.pathname, method, operation: input.operation, eventId, requestId: input.requestId });
          return route.fulfill(json(dto(job)));
        }
        if (method === "GET" && /^\/api\/event-read-jobs\/[A-Za-z0-9_-]+$/.test(u.pathname) && !u.search) {
          const id = u.pathname.split("/").at(-1), job = jobs.get(id); assert(job);
          proof.requests.push({ path: u.pathname, method, requestId: id, eventId: job.eventId });
          return route.fulfill(json(dto(job)));
        }
        throw Error("Only source assets and bounded event read jobs are permitted");
      } catch {
        proof.blocked.push({ path: u.pathname, method, offOrigin: u.origin !== ORIGIN }); return route.abort("blockedbyclient");
      }
    });
    await context.routeWebSocket("**/*", socket => { proof.blocked.push({ method: "WebSocket" }); socket.close(); });
    await context.addInitScript(() => {
      window.__eventReadWalletRequests = [];
      window.ethereum = { on() {}, removeListener() {}, request: async ({ method }) => {
        window.__eventReadWalletRequests.push(method); throw Error("Wallet calls are forbidden in this synthetic race test"); } };
    });
    page = await context.newPage(); page.on("pageerror", error => proof.errors.push({ name: error.name }));
    await page.goto(ORIGIN + "/#event=" + A.detail.event.id + "&view=organizer");
    await expect.poll(() => requestCount("bootstrap", A.detail.event.id)).toBe(1);
    await expect(page.locator("#loading")).toBeVisible(); await expect(page.locator("#content")).toBeHidden();
    await expect(page.locator("#loading-status")).toContainText("background");
    check(true, "Actual organizer route shows contextual loading while its selected bootstrap job is pending");
    await page.screenshot({ path: path.join(out, "owner-loading.png"), fullPage: true }); proof.screenshots.push("owner-loading.png");
    held.delete("bootstrap:" + A.detail.event.id);
    await expect(page.locator("#loading")).toBeHidden(); await expect(page.locator("#content")).toContainText("Manage this kickback");
    await expect(page.locator("[data-luma-launch] h1")).toHaveText(A.detail.event.title);
    check(true, "Ready owner-scoped result renders the selected organizer event and authority");
    await page.getByRole("link", { name: "Open the participant deposit page" }).click();
    await expect(page.locator('[data-tx="deposit"]').first()).toBeEnabled();
    await expect(page.locator("#content")).not.toContainText("Manage this kickback");
    check(true, "Actual owner-to-participant navigation uses the selected event and removes organizer controls");
    await page.locator('[data-tx="deposit"]').first().click();
    await expect(page.locator("#review-dialog")).toBeVisible();
    await expect(page.locator("#review-dialog")).toContainText(A.detail.event.title);
    check(requestCount("deposit", A.detail.event.id) === 1 && proof.requests.every(r => !/^\/api\/events\/.+\/drafts$/.test(r.path)),
      "Deposit review uses one background prepare job and a fresh selected-bootstrap result");
    await page.locator("#review-dialog [data-execute]").click();
    await expect.poll(() => requestCount("validate", A.detail.event.id)).toBe(1);
    await page.evaluate(eventId => { location.hash = "event=" + eventId + "&view=participant"; }, B.detail.event.id);
    await expect.poll(() => requestCount("bootstrap", B.detail.event.id)).toBe(1);
    await expect(page.locator("#loading")).toBeVisible(); await expect(page.locator("#review-dialog")).toBeHidden();
    held.delete("bootstrap:" + B.detail.event.id); held.delete("validate:" + A.detail.event.id);
    await expect(page.locator("#loading")).toBeHidden();
    await expect(page.locator("[data-luma-launch] h1")).toHaveText(B.detail.event.title);
    await expect(page.locator('[data-tx="deposit"]').first()).toBeEnabled();
    await page.waitForTimeout(700);
    await expect(page.locator("#content")).not.toContainText(A.detail.event.title);
    await expect(page.locator("#review-dialog")).toBeHidden();
    proof.walletRequests = await page.evaluate(() => window.__eventReadWalletRequests);
    check(proof.walletRequests.length === 0, "A route change during background validation blocks all wallet probes and signing requests");
    check(requestCount("validate", A.detail.event.id) === 1 && !proof.requests.some(r => r.operation === "confirm"),
      "The stale validation request is retained once and never restarted or confirmed");
    await page.screenshot({ path: path.join(out, "participant-ready.png"), fullPage: true }); proof.screenshots.push("participant-ready.png");
    check(proof.blocked.length === 0 && proof.errors.length === 0, "Mounted flow uses only permitted source assets and synthetic read endpoints without page errors");
    for (const [file, digest] of Object.entries(proof.source)) assert.equal(sha(await fs.readFile(path.join(ROOT, file))), digest, "Source changed during the check");
    proof.status = "passed";
  } catch (error) { proof.status = "failed"; proof.failure = { name: error.name, message: String(error.message).slice(0, 2000) }; process.exitCode = 1; }
  finally {
    if (page) proof.walletRequests = await page.evaluate(() => window.__eventReadWalletRequests ?? []).catch(() => []);
    await browser?.close(); proof.completedAt = new Date().toISOString();
    const file = path.join(out, "proof.json"); await fs.writeFile(file, JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proofPath: file, walletRequests: proof.walletRequests, blocked: proof.blocked, failure: proof.failure }));
  }
  return proof;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === "--run") await runEventReadUI();
  else if (process.argv.length === 2) console.log(JSON.stringify({ status: "not-run", instruction: "--run uses only synthetic browser responses" }));
  else { console.error("Only --run is supported; no action performed"); process.exitCode = 1; }
}
