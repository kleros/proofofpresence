// Exact static frontend + synthetic loopback DTOs. No wallet, RPC, auth or financial writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { makeLumaLaunchFixture, makeLumaSetupFixture } from "./fixtures/luma-launch-fixture.mjs";
import { isSelectedBootstrapQuery } from "./fixtures/selected-bootstrap-query.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "artifacts/lazy-modules", new Date().toISOString().replace(/[:.]/g, "-"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const participant = makeLumaLaunchFixture("ready"), setup = makeLumaSetupFixture();
const eventId = participant.detail.event.id;
const participantHash = "#" + new URLSearchParams({ event: eventId, view: "participant" });
const setupHash = "#setup=kickback";
const optional = [
  "/luma-setup.js", "/luma-factory.js", "/setup-progress.js", "/owned-events.js",
  "/contract-inbox.js", "/batch-actions.js", "/batch-selection.js", "/batch-pending.js",
  "/reconciliation.js",
];
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const assets = new Map();
async function collect(directory, prefix = "") {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) await collect(path.join(directory, item.name), name + "/");
    else if (mime[path.extname(name)]) assets.set("/" + name, await fs.readFile(path.join(directory, item.name)));
  }
}
await collect(path.join(root, "public"));
assets.set("/", assets.get("/index.html"));
const catalog = {
  schemaVersion: 1, kind: "public-catalog", mode: "hosted-production",
  instanceId: participant.bootstrap.instanceId,
  environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
  chain: participant.bootstrap.chain, generatedAt: new Date().toISOString(),
  catalog: { metadataOnly: true, currentFinancialState: "not-loaded", source: "recorded-adoption" },
  events: [],
};
const proof = {
  status: "running", checks: [], contexts: [], forbidden: [], external: [], errors: [], walletRequests: [],
  scope: "Current static app and synthetic loopback projection only; no real receipt, financial or deployment proof",
  sourceSha256: {}, harnessSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
};
for (const name of ["public/app.js", "public/entry.js", "public/luma-setup.js", "public/owned-events.js"])
  proof.sourceSha256[name] = sha(await fs.readFile(path.join(root, name)));
let origin, browser;
const permitted = (url, method) => {
  if (url.origin !== origin || method !== "GET") return false;
  if (assets.has(url.pathname)) return !url.search;
  if (url.pathname === "/api/public-catalog") return !url.search;
  if (url.pathname === "/api/bootstrap") {
    const query = new URLSearchParams(url.searchParams);
    if (query.has("background")) {
      if (query.getAll("background").length !== 1 || query.get("background") !== "1") return false;
      query.delete("background");
    }
    return query.size === 0 || isSelectedBootstrapQuery(query, eventId);
  }
  return false;
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  const json = (status, value) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(value));
  };
  if (!permitted(url, req.method)) {
    proof.forbidden.push({ method: req.method, path: url.pathname, query: url.search });
    return json(405, { error: "Outside synthetic read-only test scope" });
  }
  if (url.pathname === "/api/public-catalog") return json(200, catalog);
  if (url.pathname === "/api/bootstrap") return json(200, url.searchParams.has("selectedEventId") ? participant.bootstrap : setup.bootstrap);
  res.writeHead(200, { "content-type": mime[path.extname(url.pathname)] ?? "text/html", "cache-control": "no-store" });
  res.end(assets.get(url.pathname));
});
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
  const contexts = [];
  async function context(name, intercept = null) {
    const record = { name, requests: [], errors: [], expectedImportFailures: 0 };
    proof.contexts.push(record);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    contexts.push(ctx);
    await ctx.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) {
        proof.external.push({ method: request.method(), origin: url.origin });
        return route.abort();
      }
      if (!permitted(url, request.method())) {
        proof.forbidden.push({ method: request.method(), path: url.pathname, query: url.search });
        return route.abort();
      }
      record.requests.push({ method: request.method(), path: url.pathname, query: url.search });
      if (intercept && await intercept(route, url, record)) return;
      return route.continue();
    });
    await ctx.routeWebSocket("**/*", (socket) => {
      proof.forbidden.push({ method: "WebSocket", path: socket.url() });
      socket.close();
    });
    await ctx.addInitScript(() => {
      window.__lazyWalletRequests = [];
      window.ethereum = {
        request: async ({ method }) => { window.__lazyWalletRequests.push(method); throw Error("Wallet requests forbidden in lazy-module test"); },
        on() {}, removeListener() {},
      };
    });
    const page = await ctx.newPage();
    page.on("pageerror", (error) => { record.errors.push(error.message); proof.errors.push(error.message); });
    return { ctx, page, record };
  }
  const paths = (record) => record.requests.map((request) => request.path);
  const count = (record, module) => paths(record).filter((name) => name === module).length;
  const ready = async (page) => {
    await expect(page.locator("#content")).toBeVisible();
    await expect(page.locator("[data-luma-launch]")).toBeVisible();
    await expect(page.locator("h1")).toHaveText(participant.detail.event.title);
  };
  const navigate = (page, hash) => page.evaluate((next) => { location.hash = next; }, hash);

  const home = await context("cold-home");
  await home.page.goto(origin);
  await expect(home.page.locator("[data-public-catalog-screen]")).toBeVisible();
  assert.equal(count(home.record, "/app.js"), 0);
  assert.deepEqual(paths(home.record).filter((name) => optional.includes(name)), []);
  proof.checks.push("Cold metadata home requests no app or optional feature modules");

  const main = await context("participant-and-setup");
  await main.page.goto(origin + "/" + participantHash);
  await ready(main.page);
  assert.equal(count(main.record, "/app.js"), 1);
  assert.deepEqual(paths(main.record).filter((name) => optional.includes(name)), []);
  proof.checks.push("Cold participant view omits setup, organizer and CSV modules");

  await navigate(main.page, setupHash);
  await expect(main.page.locator("[data-luma-form]")).toBeVisible();
  await expect(main.page.locator("[data-luma-form]")).toHaveCount(1);
  for (const name of ["/luma-setup.js", "/luma-factory.js", "/owned-events.js"])
    assert.equal(count(main.record, name), 1, name + " loads only when setup is opened");
  assert.deepEqual(paths(main.record).filter((name) => ["/contract-inbox.js", "/batch-actions.js", "/batch-pending.js", "/reconciliation.js"].includes(name)), []);
  proof.checks.push("Setup imports its own workflow and owned-events modules on demand");

  await navigate(main.page, participantHash);
  await ready(main.page);
  await navigate(main.page, setupHash);
  await expect(main.page.locator("[data-luma-form]")).toBeVisible();
  await expect(main.page.locator("[data-luma-form]")).toHaveCount(1);
  assert.equal(count(main.record, "/luma-setup.js"), 1);
  assert.equal(count(main.record, "/owned-events.js"), 1);
  proof.checks.push("Repeated navigation reuses module code and mounts one current setup form");

  const release = deferred(), continued = deferred();
  const delayed = await context("delayed-setup-navigation", async (route, url) => {
    if (url.pathname !== "/luma-setup.js") return false;
    await release.promise;
    await route.continue();
    continued.resolve();
    return true;
  });
  await delayed.page.goto(origin + "/" + participantHash);
  await ready(delayed.page);
  const requested = delayed.page.waitForRequest((request) => new URL(request.url()).pathname === "/luma-setup.js", { timeout: 10000 });
  await navigate(delayed.page, setupHash);
  await requested;
  await navigate(delayed.page, participantHash);
  await ready(delayed.page);
  const loaded = delayed.page.waitForResponse((response) => new URL(response.url()).pathname === "/luma-setup.js");
  release.resolve();
  await continued.promise;
  await loaded;
  await ready(delayed.page);
  await expect(delayed.page.locator("[data-luma-form],#luma-setup")).toHaveCount(0);
  proof.checks.push("A delayed setup import cannot mount after navigation to the participant view");

  let fail = true;
  const failed = await context("failed-setup-reload", async (route, url, record) => {
    if (url.pathname !== "/luma-setup.js" || !fail) return false;
    fail = false;
    record.expectedImportFailures++;
    await route.abort("failed");
    return true;
  });
  await failed.page.goto(origin + "/" + setupHash);
  await expect(failed.page.locator("#content [role=alert]")).toBeVisible();
  await expect(failed.page.locator("[data-luma-form]")).toHaveCount(0);
  await expect(failed.page.locator("[data-module-reload]")).toBeVisible();
  await failed.page.locator("[data-module-reload]").click();
  await expect(failed.page.locator("[data-luma-form]")).toBeVisible();
  await expect(failed.page.locator("[data-luma-form]")).toHaveCount(1);
  assert.equal(count(failed.record, "/luma-setup.js"), 2);
  proof.checks.push("Failed optional import is visible, hides financial setup controls and recovers after reload");

  for (const ctx of contexts) {
    for (const page of ctx.pages()) proof.walletRequests.push(...await page.evaluate(() => window.__lazyWalletRequests ?? []));
    await ctx.close();
  }
  assert.deepEqual(proof.errors, []);
  assert.deepEqual(proof.forbidden, []);
  assert.deepEqual(proof.external, []);
  assert.deepEqual(proof.walletRequests, []);
  proof.status = "passed";
} catch (error) {
  proof.status = "failed";
  proof.failure = String(error?.stack ?? error);
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, output, forbidden: proof.forbidden.length, external: proof.external.length, walletRequests: proof.walletRequests.length }, null, 2));
}
