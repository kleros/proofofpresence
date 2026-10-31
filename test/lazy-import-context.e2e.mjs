// Real local v7 backend and synthetic organizer sessions. No public service or financial action.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { startServer } from "../src/server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "artifacts/lazy-import-context", new Date().toISOString().replace(/[:.]/g, "-"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const proof = {
  status: "running", checks: [], importPosts: [], external: [], errors: [],
  scope: "Real local v7 source preview only; synthetic sessions, no import commit or financial transaction",
  sourceSha256: {},
};
for (const name of ["public/app.js", "public/reconciliation.js"])
  proof.sourceSha256[name] = sha(await fs.readFile(path.join(root, name)));
proof.harnessSha256 = sha(await fs.readFile(fileURLToPath(import.meta.url)));
const app = await startServer({ port: 0, rpcPort: 0 });
let browser;
const releases = [];
try {
  browser = await chromium.launch({ headless: true });
  async function fixture(name) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    const login = await context.request.post(app.url + "/api/session", { data: { identity: "organizer-a" }, headers: { Origin: app.url } });
    assert.equal(login.status(), 200);
    const source = await context.request.get(app.url + "/api/events/event-a/fixture?kind=guests");
    assert.equal(source.status(), 200);
    const csv = await source.text();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    releases.push(release);
    let held = false;
    await context.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== app.url) {
        proof.external.push({ origin: url.origin, method: request.method() });
        return route.abort("blockedbyclient");
      }
      if (request.method() === "POST" && /\/imports(?:\/|$)/.test(url.pathname))
        proof.importPosts.push({ context: name, path: url.pathname, body: JSON.parse(request.postData() ?? "null") });
      if (url.pathname === "/reconciliation.js" && !held) {
        held = true;
        await gate;
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => proof.errors.push(error.message));
    await page.goto(app.url + "/#event=event-a&view=organizer");
    await expect(page.locator("h1")).toHaveText("Proof of Presence");
    await expect(page.locator('[data-form="import"]')).toBeVisible();
    await page.locator("#import-kind").selectOption("guests");
    await page.locator("#import-csv").fill(csv);
    await page.locator('[name="reviewConfirmed"]').check();
    await page.locator("#review-note").fill("Synthetic Event A source reviewed for lazy import context test.");
    const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/reconciliation.js", { timeout: 10000 });
    await page.locator("[data-import-preview]").click();
    await requested;
    await expect(page.locator("[data-import-preview]")).toBeDisabled();
    return { context, page, csv, release };
  }

  const sourceChange = await fixture("source-change");
  // Preserve a valid CSV while replacing its admission source during the import await.
  const changed = sourceChange.csv.replace('"pending"', '"free"');
  assert.notEqual(changed, sourceChange.csv);
  await sourceChange.page.locator("#import-csv").fill(changed);
  sourceChange.release();
  await expect(sourceChange.page.locator("[data-import-preview]")).toBeEnabled();
  await expect(sourceChange.page.locator("#import-preview")).toBeEmpty();
  await expect(sourceChange.page.locator("#review-dialog")).not.toBeVisible();
  assert.deepEqual(proof.importPosts, []);
  proof.checks.push("Changed CSV during lazy import produces no server preview, stale paint or commit");

  // The code is now loaded: a deliberate new submission of the current source works normally.
  await sourceChange.page.locator("[data-import-preview]").click();
  await expect(sourceChange.page.locator("#import-preview")).toContainText("Source preview · selected event event-a");
  await expect(sourceChange.page.locator("[data-review-import]")).toBeEnabled();
  const aPosts = proof.importPosts.filter((entry) => entry.context === "source-change");
  assert.equal(aPosts.length, 1);
  assert.equal(aPosts[0].path, "/api/events/event-a/imports/preview");
  assert.equal(aPosts[0].body.csv, changed);
  await expect(sourceChange.page.locator("#review-dialog")).not.toBeVisible();
  const after = await (await sourceChange.context.request.get(app.url + "/api/events/event-a")).json();
  assert.equal(after.imports.length, 0);
  assert.equal(after.attendance.length, 0);
  assert.equal(after.state.phase, "Open");
  proof.checks.push("A new current-source submission after loading creates one event-scoped preview without committing rows");
  await sourceChange.context.close();

  const eventChange = await fixture("event-change");
  await eventChange.page.evaluate(() => { location.hash = "event=event-b&view=organizer"; });
  await expect(eventChange.page.locator("h1")).toHaveText("Open Justice Workshop");
  await expect(eventChange.page.locator("#event-switch")).toHaveValue("event-b");
  const loaded = eventChange.page.waitForResponse((response) => new URL(response.url()).pathname === "/reconciliation.js");
  eventChange.release();
  await loaded;
  // Wait for the import callback's microtasks without relying on a wall-clock sleep.
  await eventChange.page.evaluate(async () => { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await expect(eventChange.page.locator("h1")).toHaveText("Open Justice Workshop");
  await expect(eventChange.page.locator("#import-preview,[data-review-import],[data-import-commit]")).toHaveCount(0);
  await expect(eventChange.page.locator("#review-dialog")).not.toBeVisible();
  assert.deepEqual(proof.importPosts.filter((entry) => entry.context === "event-change"), []);
  proof.checks.push("Event change during lazy import cannot post or paint either event's stale source review");
  await eventChange.context.close();

  assert.deepEqual(proof.external, []);
  assert.deepEqual(proof.errors, []);
  assert.ok(proof.importPosts.every((entry) => entry.path.endsWith("/imports/preview")));
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
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, output, importPreviewPosts: proof.importPosts.length, external: proof.external.length, pageErrors: proof.errors.length }, null, 2));
}
