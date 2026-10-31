import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createTransactionJournal } from "../public/transaction-context.js";
import { assertCreationReceipt, assertCreationReplacement } from "../public/luma-factory.js";
import { makeLumaSetupFixture } from "./fixtures/luma-launch-fixture.mjs";

// Synthetic DTOs and loopback static assets only. No real API, wallet or chain.
const V10 = "kleros-event-v10-uups";
const ORIGINAL = "0x" + "a".repeat(64), REPLACEMENT = "0x" + "b".repeat(64);
const BLOCK = "0x" + "c".repeat(64), CHILD = "0x" + "d".repeat(40);
const EVENT = "synthetic-replaced-event", DRAFT = "synthetic-replaced-draft";
const origin = "https://example.test";
function storage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}
function fixture() {
  const { bootstrap } = makeLumaSetupFixture();
  Object.assign(bootstrap, { contractVersion: V10, abiVersion: V10,
    contractProfile: { ...bootstrap.contractProfile, contractVersion: V10, abiVersion: V10, version: 10 },
    governance: { kind: "single-owner-immediate", initialOwner: "0x" + "2".repeat(40), upgradeDelaySeconds: 0, renounceable: true } });
  Object.assign(bootstrap.capabilities, { organizerJobs: true, creationReplacementRecovery: true });
  Object.assign(bootstrap.factory, { contractVersion: V10, abiVersion: V10, upgrade: {
    kind: "uups", version: 10, verified: true, governanceKind: "single-owner-immediate",
    implementation: "0x" + "1".repeat(40), implementationCodeHash: "0x" + "2".repeat(64),
    authority: "0x" + "3".repeat(40), authorityCodeHash: "0x" + "4".repeat(64),
    initialOwner: "0x" + "2".repeat(40), owner: "0x" + "2".repeat(40), pendingOwner: "0x" + "0".repeat(40),
    upgradesDisabled: false, delaySeconds: 0, finalizationVerified: false, finalizationScope: "factory" } });
  const context = { eventId: EVENT, wallet: bootstrap.session.wallet, chainId: 1, contract: bootstrap.factory.address,
    abiVersion: V10, mode: "hosted-production", instanceId: bootstrap.instanceId };
  const result = { status: "confirmed", hash: ORIGINAL, canonicalHash: REPLACEMENT, eventId: EVENT, wallet: context.wallet,
    chainId: 1, contract: CHILD, blockNumber: 200,
    participantUrl: origin + "/#event=" + EVENT + "&view=participant",
    replacement: { verified: true, kind: "same-call-fee-replacement", chainId: 1, originalHash: ORIGINAL, hash: REPLACEMENT,
      wallet: context.wallet, nonce: 10, blockNumber: 200, blockHash: BLOCK, gasUsed: "100000", gasPriceWei: "2", feeWei: "200000" } };
  return { bootstrap, context, result };
}

test("replacement adoption requires exact original, canonical proof and event link", () => {
  const { context, result } = fixture();
  assert.equal(assertCreationReplacement(result, context, ORIGINAL, REPLACEMENT, origin).canonicalHash, REPLACEMENT);
  assert.throws(() => assertCreationReceipt(result, context, ORIGINAL, origin), /Check the replacement/);
  for (const change of [
    (r) => r.status = "pending", (r) => r.wallet = "0x" + "f".repeat(40),
    (r) => r.eventId = "other-event", (r) => r.canonicalHash = ORIGINAL,
    (r) => r.replacement.nonce = -1, (r) => r.replacement.blockHash = "unknown",
    (r) => r.replacement.feeWei = "1", (r) => r.participantUrl = "https://foreign.test/",
    (r) => r.replacement.originalHash = REPLACEMENT,
  ]) {
    const altered = structuredClone(result); change(altered);
    assert.throws(() => assertCreationReplacement(altered, context, ORIGINAL, REPLACEMENT, origin));
  }
  assert.throws(() => assertCreationReplacement(result, { ...context, abiVersion: "kleros-event-v9-uups" }, ORIGINAL, REPLACEMENT, origin));
});

test("journal preserves original hash and immutable canonical replacement across reload", () => {
  const { context, result } = fixture(), saved = storage();
  const journal = createTransactionJournal(saved);
  journal.record(context, { hash: ORIGINAL, draftId: DRAFT, action: "createEvent" });
  assert.throws(() => journal.update(context, ORIGINAL, { status: "confirmed", canonicalHash: REPLACEMENT }));
  assert.equal(journal.get(context, ORIGINAL).status, "submitted", "invalid proof is not persisted");
  journal.update(context, ORIGINAL, { status: "confirmed", canonicalHash: REPLACEMENT, replacement: result.replacement, blockNumber: 200 });
  const reloaded = createTransactionJournal(saved), row = reloaded.get(context, ORIGINAL);
  assert.equal(row.hash, ORIGINAL); assert.equal(row.canonicalHash, REPLACEMENT); assert.equal(row.draftId, DRAFT);
  assert.equal(reloaded.list(context).length, 1);
  assert.throws(() => reloaded.record(context, { hash: REPLACEMENT, draftId: DRAFT }), /already has a submitted/);
  assert.throws(() => reloaded.update(context, ORIGINAL, { status: "needs-confirmation" }), /cannot be demoted/);
  assert.throws(() => reloaded.update(context, ORIGINAL, { status: "confirmed", canonicalHash: REPLACEMENT,
    replacement: { ...result.replacement, blockHash: "0x" + "e".repeat(64) } }), /cannot be changed/);
  assert.throws(() => reloaded.update(context, ORIGINAL, { status: "confirmed", blockNumber: 201 }), /cannot be changed/);
  assert.equal(reloaded.get(context, ORIGINAL).replacement.blockHash, BLOCK);
});

test("mounted replacement recovery stays read-only and rejects incomplete or stale adoption", async () => {
  const { chromium, expect } = await import("@playwright/test");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const out = path.join(root, "artifacts/v10-creation-replacement-ui", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID());
  await fs.mkdir(out, { recursive: true });
  const proof = { kind: "loopback-mounted-replacement-ui", status: "running", scenarios: [], screenshots: [], source: {},
    publicNetworkRequests: 0, walletCalls: 0, financialActions: 0, limitation: "Synthetic scoped backend DTOs; this proof does not establish live receipts, wallet execution or hosted acceptance." };
  for (const file of ["public/luma-setup.js", "public/luma-factory.js", "public/transaction-context.js", "test/v10-creation-replacement-ui.test.mjs"])
    proof.source[file] = createHash("sha256").update(await fs.readFile(path.join(root, file))).digest("hex");
  const files = new Set(["luma-setup.js", "luma-factory.js", "transaction-context.js", "environment.js", "contract-profiles.js", "luma-launch.js", "setup-progress.js", "v10-wallet-account.js", "event-timezone.js"]);
  const server = http.createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname;
    if (req.method !== "GET") return res.writeHead(405).end();
    if (name === "/") return res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><link rel=icon href='data:,'><main></main>");
    if (!files.has(name.slice(1))) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/javascript" }).end(await fs.readFile(path.join(root, "public", name.slice(1))));
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const localOrigin = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({ headless: true });
    for (const scenario of ["confirmed", "confirmed-reload-reorg", "pending", "unavailable", "mismatch", "reorg", "stale", "forged-marker", "capability-disabled", "v9", "witness-ready", "witness-wrong-scope"]) {
      const page = await browser.newPage();
      const forbidden = [], errors = [];
      await page.route("**/*", (route) => {
        const req = route.request();
        if (new URL(req.url()).origin !== localOrigin || req.method() !== "GET") { forbidden.push(req.url()); return route.abort(); }
        return route.continue();
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(localOrigin);
      const data = fixture();
      data.result.participantUrl = localOrigin + "/#event=" + EVENT + "&view=participant";
      await page.evaluate(async ({ bootstrap, result, scenario, original, replacement, draftId, eventId }) => {
        const { mountLumaSetup } = await import("/luma-setup.js");
        const { createTransactionJournal } = await import("/transaction-context.js");
        localStorage.clear();
        if (scenario === "capability-disabled") bootstrap.capabilities.creationReplacementRecovery = false;
        if (scenario === "v9") {
          bootstrap.contractVersion = bootstrap.abiVersion = bootstrap.factory.contractVersion = bootstrap.factory.abiVersion = "kleros-event-v9-uups";
        }
        const context = { eventId, wallet: bootstrap.session.wallet, chainId: 1, contract: bootstrap.factory.address,
          abiVersion: bootstrap.factory.abiVersion, mode: bootstrap.mode, instanceId: bootstrap.instanceId };
        const key = "kleros-factory-creation:v1:" + [context.instanceId, context.mode, 1, context.contract.toLowerCase(), context.wallet.toLowerCase(), context.abiVersion].map(encodeURIComponent).join(":");
        const journal = createTransactionJournal(localStorage);
        journal.record(context, { hash: original, draftId, action: "createEvent" });
        localStorage.setItem(key, JSON.stringify({ version: 1, draftId, eventId, hash: original, phase: scenario === "forged-marker" ? "confirmed" : "submitted",
          ...(scenario === "forged-marker" ? { canonicalHash: replacement, replacement: result.replacement } : {}) }));
        window.__current = true; window.__requests = []; window.__wallet = 0; window.__completed = 0;
        const host = document.createElement("section"); document.querySelector("main").append(host);
        window.__host = host; window.__context = context; window.__journal = journal;
        const options = { bootstrap, isCurrent: () => window.__current,
          provider: () => { window.__wallet++; throw Error("No wallet calls permitted"); },
          onComplete: () => window.__completed++,
          request: async (url, init) => {
            const body = JSON.parse(init?.body ?? "{}"); window.__requests.push({ url, body });
            if (scenario === "stale") await new Promise((resolve) => window.__release = resolve);
            if (["pending", "unavailable", "reorg"].includes(scenario) || window.__forceError)
              throw Object.assign(Error(scenario === "pending" ? "Replacement not confirmed" : scenario === "unavailable" ? "Event source verification unavailable" : "Canonical block changed"),
                { code: scenario === "pending" ? "TRANSACTION_UNCONFIRMED" : scenario === "unavailable" ? "UPGRADE_TRUST_MISMATCH" : "TX_REORG" });
            const returned = ["witness-ready", "witness-wrong-scope"].includes(scenario)
              ? { status: "pending", hash: original, eventId, wallet: context.wallet, chainId: 1,
                  replacementRecovery: { originalHash: scenario === "witness-ready" ? original : replacement,
                    wallet: context.wallet, nonce: 10, witnessHash: "a".repeat(64), reviewHash: "b".repeat(64),
                    witnessRetained: true, reviewSealRetained: true } }
              : structuredClone(result);
            if (scenario === "mismatch") returned.wallet = "0x" + "f".repeat(40);
            return { schemaVersion: 1, kind: "organizer-job", requestId: body.requestId, instanceId: bootstrap.instanceId,
              operation: body.operation, chainId: 1, factory: bootstrap.factory.address, contractVersion: bootstrap.factory.abiVersion,
              wallet: bootstrap.session.wallet, state: "ready", expiresAt: Date.now() + 300000, result: returned };
          } };
        window.__remount = () => {
          window.__controller.dispose(); window.__forceError = true;
          window.__controller = mountLumaSetup(host, options);
        };
        window.__controller = mountLumaSetup(host, options);
      }, { ...data, scenario, original: ORIGINAL, replacement: REPLACEMENT, draftId: DRAFT, eventId: EVENT });
      await expect(page.locator("[data-luma-created]")).toHaveCount(0);
      await expect(page.locator('[data-luma-action="new"]')).toHaveCount(0);
      if (["witness-ready", "witness-wrong-scope"].includes(scenario)) {
        await page.locator('[data-luma-action="reconcile"]').click();
        await expect(page.locator('[data-luma-status]')).toContainText("The transaction is pending");
        if (scenario === "witness-ready") await expect(page.locator('[data-luma-status]')).toContainText("Original nonce 10 and its review seal are saved");
        else await expect(page.locator('[data-luma-status]')).not.toContainText("review seal are saved");
        if (scenario === "witness-ready") { await page.screenshot({ path: path.join(out, "witness-ready.png"), fullPage: true }); proof.screenshots.push("witness-ready.png"); }
      } else if (["capability-disabled", "v9"].includes(scenario)) {
        await expect(page.locator('[data-luma-action="check-replacement"]')).toHaveCount(0);
      } else {
        await page.locator("[data-luma-replacement] summary").click();
        await page.locator('[name="replacementHash"]').fill(REPLACEMENT);
        await page.locator('[data-luma-action="check-replacement"]').click();
        if (scenario === "stale") {
          await page.waitForFunction(() => typeof window.__release === "function");
          await page.evaluate(() => { window.__current = false; window.__release(); });
          await page.waitForTimeout(30);
        } else if (["confirmed", "forged-marker", "confirmed-reload-reorg"].includes(scenario)) {
          await expect(page.locator("[data-luma-created]")).toBeVisible();
          await expect(page.locator("[data-luma-hash]")).toHaveText(ORIGINAL);
          await expect(page.locator("[data-luma-replacement-hash]")).toHaveText(REPLACEMENT);
          assert.equal(await page.evaluate(() => window.__requests[0].body.operation), "replacement");
          const row = await page.evaluate((hash) => window.__journal.get(window.__context, hash), ORIGINAL);
          assert.equal(row.hash, ORIGINAL); assert.equal(row.canonicalHash, REPLACEMENT); assert.equal(row.status, "confirmed");
          if (scenario === "confirmed") { await page.screenshot({ path: path.join(out, "confirmed-replacement.png"), fullPage: true }); proof.screenshots.push("confirmed-replacement.png"); }
          if (scenario === "confirmed-reload-reorg") {
            await page.evaluate(() => window.__remount());
            await expect(page.locator("[data-luma-created]")).toHaveCount(0);
            await expect(page.locator('[data-luma-action="new"]')).toHaveText("Create new event");
            await expect(page.getByRole("heading", { name: "Recorded event creation" })).toBeVisible();
            await page.locator('[data-luma-action="reconcile"]').click();
            await expect(page.locator("[data-luma-error]")).toBeVisible();
            await expect(page.locator("[data-luma-created]")).toHaveCount(0);
            await expect(page.locator('[data-luma-action="new"]')).toHaveText("Create new event");
          } else {
            await page.locator('[data-luma-action="new"]').click();
            await expect(page.locator("[data-luma-form]")).toBeVisible();
          }
          assert.equal((await page.evaluate(() => window.__journal.list(window.__context))).length, 1);
        } else {
          await expect(page.locator("[data-luma-error]")).toBeVisible();
          await expect(page.locator("[data-luma-hash]")).toHaveText(ORIGINAL);
          await expect(page.locator("[data-luma-replacement-hash]")).toHaveText(REPLACEMENT);
        }
      }
      if (!["confirmed", "forged-marker", "confirmed-reload-reorg"].includes(scenario)) {
        await expect(page.locator("[data-luma-created]")).toHaveCount(0);
        await expect(page.locator('[data-luma-action="new"]')).toHaveCount(0);
        const row = await page.evaluate((hash) => window.__journal.get(window.__context, hash), ORIGINAL);
        assert.equal(row.status, ["witness-ready", "witness-wrong-scope"].includes(scenario) ? "needs-confirmation" : "submitted"); assert.equal(row.canonicalHash, undefined);
      }
      assert.equal(await page.evaluate(() => window.__wallet), 0);
      assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
      proof.scenarios.push(scenario);
      await page.evaluate(() => window.__controller.dispose());
      await page.close();
    }
    proof.status = "passed";
  } finally {
    if (proof.status === "running") proof.status = "failed";
    await fs.writeFile(path.join(out, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("recorded creation opens a distinct new form only with its exact confirmed journal", async () => {
  const { chromium, expect } = await import("@playwright/test");
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const files = new Set(["luma-setup.js", "luma-factory.js", "transaction-context.js", "environment.js", "contract-profiles.js", "luma-launch.js", "setup-progress.js", "v10-wallet-account.js", "event-timezone.js"]);
  const server = http.createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname;
    if (req.method !== "GET") return res.writeHead(405).end();
    if (name === "/") return res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><link rel=icon href='data:,'><main></main>");
    if (!files.has(name.slice(1))) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/javascript" }).end(await fs.readFile(path.join(root, name.slice(1))));
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const scenarios = ["confirmed", "old-instance", "marker-only", "submitted", "unknown-wallet", "wrong-draft", "wrong-action", "failed", "stale-click"];
    for (const scenario of scenarios) {
      const page = await browser.newPage(), errors = [], forbidden = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        if (new URL(route.request().url()).origin !== origin) { forbidden.push(route.request().url()); return route.abort(); }
        return route.continue();
      });
      await page.goto(origin);
      await page.evaluate(async ({ bootstrap, context, scenario, hash, draftId }) => {
        const { mountLumaSetup } = await import("/luma-setup.js");
        const { createTransactionJournal } = await import("/transaction-context.js");
        localStorage.clear();
        if (scenario === "old-instance") context.instanceId = "recorded-previous-instance";
        const journal = createTransactionJournal(localStorage);
        if (!["marker-only", "unknown-wallet", "failed"].includes(scenario)) {
          journal.record(context, { hash, draftId: scenario === "wrong-draft" ? "other-draft" : draftId, action: scenario === "wrong-action" ? "deposit" : "createEvent" });
          if (scenario !== "submitted") journal.update(context, hash, { status: "confirmed", blockNumber: 100 });
        }
        const key = "kleros-factory-creation:v1:" + [context.instanceId, context.mode, context.chainId, context.contract.toLowerCase(), context.wallet.toLowerCase(), context.abiVersion].map(encodeURIComponent).join(":");
        localStorage.setItem(key, JSON.stringify({ version: 1, draftId, eventId: context.eventId,
          phase: scenario === "unknown-wallet" ? "wallet-requested" : scenario === "failed" ? "failed" : "confirmed",
          ...(scenario === "unknown-wallet" ? {} : { hash }) }));
        window.__context = context; window.__journal = journal; window.__beforeJournal = JSON.stringify(journal.list(context)); window.__newCalls = []; window.__requests = 0; window.__wallet = 0; window.__current = true; window.__markerKey = key;
        const host = document.createElement("section"); document.querySelector("main").append(host);
        window.__controller = mountLumaSetup(host, { bootstrap, isCurrent: () => window.__current,
          request: async () => { window.__requests++; throw Error("No API permitted"); },
          provider: () => { window.__wallet++; throw Error("No wallet permitted"); },
          onNew: completed => window.__newCalls.push(completed) });
      }, { ...fixture(), scenario, hash: ORIGINAL, draftId: DRAFT });
      const allowed = ["confirmed", "old-instance", "stale-click"].includes(scenario);
      await expect(page.locator("[data-luma-created]")).toHaveCount(0);
      if (allowed) {
        await expect(page.locator('[data-luma-action="new"]')).toHaveText("Create new event");
        await expect(page.getByRole("heading", { name: "Recorded event creation" })).toBeVisible();
        await expect(page.locator("[data-luma-hash]")).toHaveText(ORIGINAL);
        if (scenario === "stale-click") {
          await page.evaluate(() => { document.querySelector('[data-luma-action="new"]').click(); window.__current = false; });
          await page.waitForTimeout(0);
          await expect(page.locator("[data-luma-form]")).toHaveCount(0);
          assert.equal(await page.evaluate(() => window.__newCalls.length), 0);
          assert.notEqual(await page.evaluate(() => localStorage.getItem(window.__markerKey)), null);
        } else {
          await page.locator('[data-luma-action="new"]').click();
          await expect(page.locator("[data-luma-form]")).toBeVisible();
          await expect(page.locator('[name="title"]')).toHaveValue("");
          const completed = await page.evaluate(() => window.__newCalls);
          assert.equal(completed.length, 1); assert.equal(completed[0].status, "confirmed"); assert.equal(completed[0].hash, ORIGINAL);
          assert.equal(completed[0].draftId, DRAFT); assert.equal(completed[0].context.instanceId, scenario === "old-instance" ? "recorded-previous-instance" : fixture().context.instanceId);
        }
      } else {
        await expect(page.locator('[data-luma-action="new"]')).toHaveCount(0);
        await page.evaluate(() => { const button = document.createElement("button"); button.dataset.lumaAction = "new"; document.querySelector("main section").append(button); button.click(); });
        await expect(page.locator("[data-luma-form]")).toHaveCount(0);
        assert.equal(await page.evaluate(() => window.__newCalls.length), 0);
      }
      assert.equal(await page.evaluate(() => JSON.stringify(window.__journal.list(window.__context))), await page.evaluate(() => window.__beforeJournal));
      assert.equal(await page.evaluate(() => window.__requests), 0); assert.equal(await page.evaluate(() => window.__wallet), 0);
      assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
      await page.evaluate(() => window.__controller.dispose()); await page.close();
    }
  } finally { await browser?.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
});
