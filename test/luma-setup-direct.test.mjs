// Synthetic DTO/widget guards only. No chain, signing file or real transaction.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeLumaSetupFixture, makeLumaFactoryDraft } from "./fixtures/luma-launch-fixture.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url)), V10 = "kleros-event-v10-uups";
const preset = {
  kind: "truth-pays-ist-replacement-v1",
  input: { title: "Truth Pays: Queryable Data, Prediction Markets & Onchain Justice", lumaUrl: "https://luma.com/qewnqhas",
    startsAt: "2026-11-04T12:30:00.000Z", endsAt: "2026-11-04T16:30:00.000Z", timezone: "Asia/Kolkata", depositEth: "0.01" },
  originalEventId: "event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5", originalContract: "0xCd7418413fBFA814D41799C9dFaCc4654f295c11",
  recoveryUrl: "/#event=event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5&view=participant&deposit=manage",
};
function fixture() {
  const { bootstrap } = makeLumaSetupFixture();
  Object.assign(bootstrap, { contractVersion: V10, abiVersion: V10,
    contractProfile: { ...bootstrap.contractProfile, contractVersion: V10, abiVersion: V10, version: 10 },
    governance: { kind: "single-owner-immediate", initialOwner: "0x" + "2".repeat(40), upgradeDelaySeconds: 0, renounceable: true } });
  bootstrap.capabilities.organizerJobs = false;
  Object.assign(bootstrap.factory, { contractVersion: V10, abiVersion: V10, upgrade: {
    kind: "uups", version: 10, verified: true, governanceKind: "single-owner-immediate",
    implementation: "0x" + "1".repeat(40), implementationCodeHash: "0x" + "2".repeat(64),
    authority: "0x" + "3".repeat(40), authorityCodeHash: "0x" + "4".repeat(64), initialOwner: "0x" + "2".repeat(40),
    owner: "0x" + "2".repeat(40), pendingOwner: "0x" + "0".repeat(40), upgradesDisabled: false, delaySeconds: 0,
    finalizationVerified: false, finalizationScope: "factory" } });
  const draft = makeLumaFactoryDraft(bootstrap, preset.input);
  Object.assign(draft, { contractVersion: V10, abiVersion: V10 });
  return { bootstrap, draft };
}

test("V10 direct creation keeps exact preset, validation, account and original-hash guards without an app review", { timeout: 60000 }, async t => {
  const { chromium, expect } = await import("@playwright/test");
  const files = new Set(["luma-setup.js", "luma-factory.js", "transaction-context.js", "environment.js", "contract-profiles.js", "luma-launch.js", "setup-progress.js", "v10-wallet-account.js", "event-timezone.js"]);
  const server = http.createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname;
    if (req.method !== "GET") return res.writeHead(405).end();
    if (name === "/") return res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><link rel=icon href='data:,'><main></main>");
    if (!files.has(name.slice(1))) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/javascript" }).end(await fs.readFile(path.join(ROOT, "public", name.slice(1))));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port, browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const scenarios = ["original-hash", "bad-validation", "bad-context", "bad-account", "changed-form", "bad-preset"];
  for (const scenario of scenarios) {
    const page = await browser.newPage({ timezoneId: "UTC" });
    const forbidden = [], errors = [];
    await page.route("**/*", route => {
      const req = route.request();
      if (new URL(req.url()).origin !== origin || req.method() !== "GET") { forbidden.push(req.url()); return route.abort(); }
      return route.continue();
    });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/#setup=kickback&replacement=truth-pays-ist");
    const data = fixture();
    await page.evaluate(async ({ bootstrap, draft, preset, scenario }) => {
      const { mountLumaSetup } = await import("/luma-setup.js");
      const main = document.querySelector("main"), events = window.__events = [], hash = "0x" + "a".repeat(64);
      let currentDraft = structuredClone(draft);
      currentDraft.creationContext = { ...structuredClone(bootstrap), kind: "verified-creation-context-v1", draftId: draft.id,
        snapshot: draft.snapshot, origin: location.origin, wallet: bootstrap.session.wallet };
      if (scenario === "bad-context") currentDraft.creationContext.snapshot = "changed";
      if (scenario === "bad-preset") preset.input.startsAt = "2026-11-04T13:30:00.000Z";
      const provider = { request: async request => {
        events.push({ kind: "wallet", method: request.method });
        if (request.method === "eth_accounts") return [bootstrap.session.wallet];
        if (request.method === "eth_chainId") return "0x1";
        if (request.method === "eth_getBlockByNumber") return { number: "0x64", hash: "0x" + "c".repeat(64) };
        if (request.method === "eth_getCode") return scenario === "bad-account" ? "0x6000" : "0x";
        if (request.method === "eth_sendTransaction") {
          if (JSON.stringify(request.params) !== JSON.stringify([{ to: draft.transaction.to, from: draft.transaction.from, data: draft.transaction.data, value: "0x0", chainId: "0x1" }])) throw Error("Synthetic exact send changed");
          return hash;
        }
        throw Error("Unexpected wallet request");
      } };
      const options = { bootstrap, replacementPreset: preset, provider: () => provider, isCurrent: () => true,
        request: async (url, init) => {
          const input = JSON.parse(init.body); events.push({ kind: "api", url, input });
          if (url.endsWith("/validate")) return { draft: structuredClone(currentDraft), transaction: scenario === "bad-validation" ? { ...draft.transaction, to: "0x" + "f".repeat(40) } : draft.transaction };
          if (url.endsWith("/submitted")) return { recorded: true };
          if (url.endsWith("/reconcile")) throw Error("Synthetic original receipt unavailable");
          if (scenario === "changed-form") {
            const field = main.querySelector('[name="endsAt"]'); field.value = "2026-11-04T23:00";
            field.dispatchEvent(new Event("input", { bubbles: true }));
          }
          return structuredClone(currentDraft);
        } };
      window.__remount = () => { window.__controller?.dispose(); window.__controller = mountLumaSetup(main, options); };
      window.__remount();
    }, { ...data, preset: structuredClone(preset), scenario });
    if (scenario === "bad-preset") {
      await expect(page.locator("[data-luma-setup-issue]")).toContainText("replacement event details changed");
      assert.deepEqual(await page.evaluate(() => window.__events), []); await page.close(); continue;
    }
    await expect(page.locator("#luma-start")).toHaveValue("2026-11-04T18:00");
    await expect(page.locator("#luma-end")).toHaveValue("2026-11-04T22:00");
    await expect(page.locator("#luma-timezone-choice")).toHaveValue("Asia/Kolkata");
    await expect(page.locator("#luma-timezone")).toHaveValue("Asia/Kolkata");
    await expect(page.locator("#luma-capacity")).toHaveAttribute("readonly", "");
    await expect(page.locator("[data-luma-replacement-preset]")).toContainText("new contract and deposit link");
    assert.deepEqual(await page.evaluate(() => window.__events), [], "Mounting the preset never requests a wallet/API action");
    await page.getByRole("button", { name: "Create event in wallet", exact: true }).click();
    await expect(page.locator("[data-luma-error]")).toBeVisible();
    assert.equal(await page.locator("dialog").count(), 0, "V10 creation has no app review modal");
    const events = await page.evaluate(() => window.__events), sends = events.filter(event => event.method === "eth_sendTransaction");
    assert.equal(sends.length, scenario === "original-hash" ? 1 : 0, scenario);
    const prepare = events.find(event => event.kind === "api");
    assert.equal(prepare.input.startsAt, preset.input.startsAt); assert.equal(prepare.input.endsAt, preset.input.endsAt);
    if (scenario === "original-hash") {
      await expect(page.locator("[data-luma-hash]")).toHaveText("0x" + "a".repeat(64));
      const before = events.length;
      await page.evaluate(() => window.__remount());
      await expect(page.locator("[data-luma-recovery]")).toBeVisible();
      assert.equal(await page.locator('[data-luma-action="review"]').count(), 0);
      assert.equal((await page.evaluate(() => window.__events)).length, before, "Original hash recovery cannot auto-resend or prepare");
    }
    assert.deepEqual(forbidden, []); assert.deepEqual(errors, []); await page.close();
  }
  t.diagnostic("Six synthetic scenarios: one mock send only; no chain/network/real wallet. Exact-root-route end-to-end coverage remains in the single protected SDK run.");
});

test("actual root setup route applies the replacement only on its exact hash and Connect stays account-only", { timeout: 60000 }, async t => {
  const { chromium, expect } = await import("@playwright/test");
  const { bootstrap } = fixture();
  Object.assign(bootstrap, { kind: "kickback-setup-display", displayOnly: true, session: null, events: [], recoveryEvents: [], managedEvents: [] });
  Object.assign(bootstrap.factory, { verified: false });
  Object.assign(bootstrap.capabilities, { transactionsReady: false, createEvents: false, manageEvents: false });
  const api = [], forbidden = [];
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    if (pathname.startsWith("/api/")) {
      api.push({ method: req.method, pathname });
      if (req.method !== "GET" || pathname !== "/api/kickback-setup") { forbidden.push(pathname); return res.writeHead(503).end(); }
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(bootstrap));
    }
    const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    if (req.method !== "GET" || relative.includes("..")) { forbidden.push(pathname); return res.writeHead(404).end(); }
    try {
      const body = await fs.readFile(path.join(ROOT, "public", relative));
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[path.extname(relative)] ?? "application/octet-stream";
      return res.writeHead(200, { "content-type": type }).end(body);
    } catch { forbidden.push(pathname); return res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port, browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const hash of ["#setup=kickback", "#setup=kickback&replacement=truth-pays-ist", "#setup=kickback&replacement=truth-pays-ist&extra=1"]) {
    const page = await browser.newPage({ timezoneId: "UTC" }), errors = [];
    await page.addInitScript(wallet => {
      window.__walletCalls = [];
      window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async request => {
        window.__walletCalls.push(request.method);
        if (request.method !== "eth_requestAccounts") throw Error("Connect must only request accounts");
        return [wallet];
      } };
    }, fixture().draft.wallet);
    await page.route("**/*", route => {
      if (new URL(route.request().url()).origin !== origin) { forbidden.push("external"); return route.abort(); }
      return route.continue();
    });
    page.on("pageerror", error => errors.push(error.message));
    const before = api.length;
    await page.goto(origin + "/" + hash);
    await expect(page.locator('#luma-setup [data-connect-wallet]')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
    await page.locator('#luma-setup [data-connect-wallet]').click();
    await expect(page.locator('[data-luma-form]')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.__walletCalls), ["eth_requestAccounts"]);
    const replacement = hash === "#setup=kickback&replacement=truth-pays-ist";
    await expect(page.locator('#luma-title')).toHaveValue(replacement ? preset.input.title : "");
    await expect(page.locator('#luma-start')).toHaveValue(replacement ? "2026-11-04T18:00" : "");
    await expect(page.locator('#luma-end')).toHaveValue(replacement ? "2026-11-04T22:00" : "");
    await expect(page.locator('[data-luma-replacement-preset]')).toHaveCount(replacement ? 1 : 0);
    if (replacement) {
      const href = await page.locator('[data-luma-replacement-preset] a').getAttribute("href");
      assert.equal(href, preset.recoveryUrl);
      for (const host of ["https://kleros-kickback.netlify.app", "https://kickback.kleros.io"])
        assert.equal(new URL(href, host).origin, host, "Original event recovery stays on the selected canonical site");
    }
    await expect(page.getByRole("button", { name: "Create event in wallet", exact: true })).toBeVisible();
    assert.deepEqual(api.slice(before), [{ method: "GET", pathname: "/api/kickback-setup" }]);
    assert.deepEqual(errors, []); await page.close();
  }
  assert.deepEqual(forbidden, []);
});
