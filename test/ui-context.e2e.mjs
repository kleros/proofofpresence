import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { startServer } from "../src/server.mjs";

// Superseded GETs are canceled without corrupting the current event. The GET-only
// ui-ux-fixes harness separately covers a transport that deliberately ignores abort.
const app = await startServer({ port: 0, rpcPort: 0 });
let browser, releaseA;
const delayedA = new Promise(resolve => { releaseA = resolve; });
const failures = [], external = [], checks = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await context.request.post(app.url + "/api/session", { data: { identity: "organizer-b" }, headers: { Origin: app.url } });
  assert.equal(login.status(), 200);
  let heldA = false;
  const isEventARead = request => {
    const url = new URL(request.url());
    return request.method() === "GET" && url.origin === app.url &&
      ((url.pathname === "/api/bootstrap" && url.searchParams.get("selectedEventId") === "event-a") ||
        url.pathname === "/api/events/event-a");
  };
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== app.url) { external.push(url.href); return route.abort("blockedbyclient"); }
    if (isEventARead(route.request()) && !heldA) { heldA = true; await delayedA; }
    return route.continue();
  });
  const page = await context.newPage();
  const canceled = [];
  page.on("requestfailed", request => {
    if (isEventARead(request)) canceled.push(request.failure()?.errorText);
  });
  page.on("pageerror", error => failures.push(error.message));
  await page.goto(app.url + "/#event=event-a&view=organizer");
  await expect.poll(() => heldA).toBe(true);
  await page.evaluate(() => { location.hash = "event=event-b&view=organizer"; });
  await expect(page.locator("h1")).toHaveText("Open Justice Workshop");
  await expect.poll(() => canceled.length).toBe(1);
  assert.match(canceled[0], /ABORTED|CANCELLED|CANCELED/i);
  releaseA();
  await page.waitForTimeout(100);
  await expect(page.locator("h1")).toHaveText("Open Justice Workshop");
  await expect(page.locator("#event-switch")).toHaveValue("event-b");
  await page.locator("[data-edit-event]").click();
  const description = await page.locator("#settings-description").inputValue();
  assert.match(description, /hands-on workshop/, "B's settings must not read delayed A data");
  checks.push("Canceled Event A read cannot overwrite B's settings/context");
  await page.keyboard.press("Escape");
  await page.locator('[data-tx="cancel"]').click();
  await expect(page.locator("#review-dialog")).toBeVisible();
  const review = await page.locator("#dialog-body").innerText();
  assert.match(review, /Open Justice Workshop/);
  assert.match(review, /event-b/);
  const b = await (await context.request.get(app.url + "/api/events/event-b")).json();
  assert.ok(review.includes(b.event.contract));
  assert.ok(review.includes(b.state.owner));
  checks.push("B's subsequent transaction review remains bound to B's deployment and owner");
  await page.keyboard.press("Escape");
  // Financial receipt failure is covered by recovery.test.mjs. This controlled
  // terminal journal fixture checks only restoration and action availability.
  const bootstrap = await (await context.request.get(app.url + "/api/bootstrap")).json();
  await page.evaluate(async ({ scope, blockNumber }) => {
    const { createTransactionJournal } = await import("/transaction-context.js");
    const journal = createTransactionJournal(localStorage);
    const hash = "0x" + "f".repeat(64);
    journal.record(scope, { hash, draftId: "terminal-failure-ui-fixture", action: "cancel" });
    journal.update(scope, hash, { status: "failed", blockNumber });
  }, { scope: { eventId: "event-b", wallet: b.state.owner, chainId: b.event.chainId, contract: b.event.contract,
    abiVersion: b.event.abiVersion, mode: bootstrap.mode, instanceId: bootstrap.instanceId }, blockNumber: b.state.blockNumber });
  await page.locator("#refresh").click();
  await expect(page.locator("#content")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("Open Justice Workshop");
  await expect(page.getByText("Transaction submitted · receipt still needs verification", { exact: true })).toHaveCount(0);
  await page.locator('[data-tx="cancel"]').click();
  await expect(page.locator("#review-dialog")).toBeVisible();
  checks.push("Restoring a failed journal entry is terminal and does not loop refresh or block a fresh review");
  // No confirmation click: this check must not send an on-chain transaction.
  assert.equal((await (await context.request.get(app.url + "/api/events/event-b")).json()).state.phase, "Open");
  assert.deepEqual(external, []);
  assert.deepEqual(failures, []);
  checks.push("No transaction broadcast, external request or uncaught browser error");
  console.log(`UI context checks passed: ${checks.length} assertions plus Playwright expectations.`);
} finally {
  releaseA();
  await browser?.close();
  await app.close();
}
