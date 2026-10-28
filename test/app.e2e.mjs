import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";

// Starts fresh local v7 deployments and a mock V1 Court. No public RPC or email provider.
const server = await startServer({ port: 0, rpcPort: 0 });
let browser;
const external = [],
  pageErrors = [];
let assertions = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
};
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === server.url) return route.continue();
    external.push(url.origin);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const navigate = async (event, view = "participant") => {
    await page.goto(`${server.url}/#${new URLSearchParams({ event, view })}`);
    await expect(page.locator("#content")).toBeVisible();
    await expect(page.locator("h1")).toHaveText(
      event === "event-a" ? "Proof of Presence" : "Open Justice Workshop",
    );
  };
  const identity = async (id) => {
    const expected = (
      await (await page.request.get(`${server.url}/api/bootstrap`)).json()
    ).identities.find((item) => item.id === id);
    await page.locator("#identity-select").selectOption(id);
    await expect(page.locator("#identity-select")).toHaveValue(id);
    await expect(page.locator("#content")).toBeVisible();
    await expect(page.locator("#top-identity")).toHaveText(expected.label);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${server.url}/api/bootstrap`)).json())
            .session?.wallet,
      )
      .toBe(expected.wallet);
  };
  const detail = async (id) =>
    (await page.request.get(`${server.url}/api/events/${id}`)).json();
  const api = async (path, body) =>
    page.request.post(`${server.url}${path}`, {
      data: body,
      headers: { Origin: server.url },
    });
  const confirm = async (action) => {
    await page.locator(`[data-tx="${action}"]`).first().click();
    try {
      await expect(page.locator("#review-dialog")).toBeVisible();
    } catch (error) {
      throw new Error(
        `Could not prepare ${action}: ${await page.locator("#toast").textContent()}`,
        { cause: error },
      );
    }
    await expect(page.locator("#dialog-body")).toContainText(
      "Local chain · 1337",
    );
    await page.locator("[data-execute]").click();
    try {
      await expect(page.locator("#review-dialog")).not.toBeVisible({
        timeout: 20000,
      });
    } catch (error) {
      throw new Error(
        `Could not confirm ${action}: ${await page.locator("#transaction-status").textContent()}`,
        { cause: error },
      );
    }
    await expect(page.locator("#toast")).toContainText("Confirmed");
  };

  await page.goto(server.url);
  await expect(page.locator("h1")).toHaveText("Events, with commitment.");
  await expect(page.locator(".event-card")).toHaveCount(2);
  assertions += 2;
  await fs.mkdir(new URL("../artifacts/", import.meta.url), {
    recursive: true,
  });
  await page.screenshot({
    path: fileURLToPath(
      new URL("../artifacts/demo-desktop.png", import.meta.url),
    ),
    fullPage: true,
  });

  await navigate("event-a");
  await identity("alice");
  await page.locator('[data-tx="deposit"]').click();
  await expect(page.locator("#review-dialog")).toBeVisible();
  await expect(page.locator("#dialog-body")).toContainText(
    "10000000000000000 wei",
  );
  await expect(page.locator("#dialog-body")).toContainText("Proof of Presence");
  // A route change must remove an unsigned review.
  await page.evaluate(() => {
    location.hash = "event=event-b&view=participant";
  });
  await expect(page.locator("#review-dialog")).not.toBeVisible();
  await expect(page.locator("h1")).toHaveText("Open Justice Workshop");
  check(
    (await detail("event-a")).participants[0].deposit,
    null,
    "Unsigned review does not deposit",
  );
  await confirm("deposit");
  let b = await detail("event-b");
  check(
    b.participants[0].deposit.amountWei,
    "20000000000000000",
    "Event B uses its exact distinct amount",
  );
  check(
    b.participants[0].registered,
    false,
    "Deposit alone does not register a staker",
  );
  await navigate("event-a");
  await confirm("deposit");
  let a = await detail("event-a");
  check(
    a.participants[0].deposit.amountWei,
    "10000000000000000",
    "Event A deposit verified",
  );
  check(
    (await detail("event-b")).state.balanceWei,
    "20000000000000000",
    "Event B balance remains independent",
  );
  await identity("bob");
  await confirm("deposit");
  await identity("alice");
  await page.locator("[data-personal]").click();
  await expect(page.locator("[data-personal]")).toContainText("Marked");
  a = await detail("event-a");
  check(
    a.participants[0].attended,
    false,
    "Personal history has no financial attendance effect",
  );
  check(
    a.state.attendeeCount,
    0,
    "Personal history leaves contract attendee count unchanged",
  );

  // A synthetic extension bridge signs a real server nonce and real local transaction.
  // Its random private key exists only in this process and is never logged or exported.
  const connected = ethers.Wallet.createRandom().connect(
    server.workbench.provider,
  );
  await page.exposeFunction("__walletRequest", async ({ method, params }) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts")
      return [connected.address];
    if (method === "eth_chainId") return "0x539";
    if (method === "personal_sign")
      return connected.signMessage(ethers.getBytes(params[0]));
    if (method === "eth_sendTransaction") {
      const sent = await connected.sendTransaction({
        ...params[0],
        gasLimit: 500000,
      });
      await sent.wait();
      return sent.hash;
    }
    throw new Error(`Unsupported synthetic wallet method: ${method}`);
  });
  await page.addInitScript(() => {
    window.ethereum = {
      request: (args) => window.__walletRequest(args),
      on: () => {},
    };
  });
  await page.evaluate(() => {
    window.ethereum = {
      request: (args) => window.__walletRequest(args),
      on: () => {},
    };
  });
  await navigate("event-b");
  await page.locator("#top-identity").click();
  await page.locator("[data-connect-wallet]").click();
  await expect(page.locator("#top-identity")).toHaveText(
    "Verified browser wallet",
  );
  check(
    (await (await page.request.get(`${server.url}/api/bootstrap`)).json())
      .session.wallet,
    connected.address,
    "Browser wallet proves ownership with signed nonce",
  );
  await page.locator("#top-identity").click();
  await page.locator("[data-fund-wallet]").click();
  await expect(page.locator("#toast")).toContainText("Received 1 local ETH");
  await page.locator("#reg-name").fill("Synthetic signed wallet");
  await page.locator("#reg-email").fill("signed-wallet@example.invalid");
  await page.locator('form[data-form="registration"] button').click();
  await expect(page.locator("#content")).toContainText("No verified deposit");
  await expect
    .poll(async () => (await detail("event-b")).participants.length)
    .toBe(1);
  await confirm("deposit");
  b = await detail("event-b");
  check(
    b.participants[0].identitySource,
    "signed-wallet-nonce",
    "Participant is linked to nonce-verified wallet",
  );
  check(
    b.participants[0].deposit.amountWei,
    "20000000000000000",
    "Wallet sends and confirms exact event-specific transaction",
  );
  await navigate("event-a");
  await identity("alice");

  await navigate("event-a", "organizer");
  await expect(page.locator("#content")).toContainText(
    "This identity cannot manage this event.",
  );
  assertions++;
  await identity("staff-a");
  await expect(page.locator("#content")).toContainText(
    "You are authorized door staff",
  );
  await expect(page.locator('[data-tx="register"]')).toBeDisabled();
  assertions += 2;
  await navigate("event-b", "organizer");
  await expect(page.locator("#content")).toContainText(
    "This identity cannot manage this event.",
  );
  const denied = await api("/api/events/event-b/checkins", {
    participantId: "event-b-alice",
    nonce: "not-authorized",
    source: "staff-door",
    note: "Synthetic unauthorized request",
  });
  check(
    denied.status(),
    403,
    "Staff A cannot check in Event B even via direct request",
  );

  await navigate("event-a", "organizer");
  await identity("organizer-a");
  for (const [person, admission] of [
    ["alice", "approved"],
    ["bob", "approved"],
    ["carol", "free"],
  ]) {
    await page
      .locator(`[data-admission="event-a-${person}"]`)
      .selectOption(admission);
    await expect(
      page.locator(`[data-admission="event-a-${person}"]`),
    ).toHaveValue(admission);
    await expect(
      page.locator(`[data-admission="event-a-${person}"]`),
    ).toBeEnabled();
    await expect
      .poll(
        async () =>
          (await detail("event-a")).participants.find(
            (item) => item.id === `event-a-${person}`,
          ).admission,
      )
      .toBe(admission);
  }
  await confirm("register");
  a = await detail("event-a");
  check(
    a.state.stakerCount,
    2,
    "Only approved verified Alice and Bob become stakers",
  );
  check(
    a.participants.find((person) => person.id === "event-a-carol").registered,
    false,
    "Free guests stay outside pool",
  );
  await page.locator("[data-edit-event]").click();
  await page
    .locator("summary")
    .filter({ hasText: "Optional content & Luma associations" })
    .click();
  await page.locator("#settings-luma-id").fill("proof-of-presence-demo");
  await page
    .locator("#settings-luma-url")
    .fill("https://luma.com/proof-of-presence-demo");
  await page.locator("#settings-content-id").fill("synthetic-content-a");
  await page
    .locator("#settings-content-url")
    .fill("https://events.example.invalid/events/proof-of-presence");
  await page.getByRole("button", { name: "Save event settings" }).click();
  await expect(page.locator("#review-dialog")).not.toBeVisible();
  a = await detail("event-a");
  check(
    a.event.contentEventId,
    "synthetic-content-a",
    "Content association saved without migrating content",
  );
  check(
    a.event.lumaEventId,
    "proof-of-presence-demo",
    "Luma association saved independently",
  );
  check(
    a.state.phase,
    "Open",
    "Editorial settings do not change financial phase",
  );

  await api("/api/demo/advance", { seconds: 3601 });
  await page.locator("#refresh").click();
  await expect(page.locator('[data-tx="postAttendance"]')).toBeVisible();
  const fixtureA = await (
    await page.request.get(
      `${server.url}/api/events/event-a/fixture?kind=attendance`,
    )
  ).text();
  // The UI must expose raw-export limitations, even with an event label supplied.
  await page.locator("#import-csv").fill(fixtureA);
  await page.locator('form[data-form="import"] button[type="submit"]').click();
  await expect(page.locator("#toast")).toContainText(
    "Raw CSV origin cannot be verified",
  );
  check(
    (await detail("event-a")).attendance.length,
    0,
    "Unreviewed raw CSV has no attendance effect",
  );
  await page.locator('[name="reviewConfirmed"]').check();
  await page
    .locator("#review-note")
    .fill("Synthetic local source export reviewed against Event A guest list.");
  await page.locator('form[data-form="import"] button[type="submit"]').click();
  await expect(page.locator("#import-result")).toContainText(
    "Import validated",
  );
  check(
    (await detail("event-a")).attendance.length,
    1,
    "Reviewed event import creates trusted observation",
  );

  await identity("organizer-b");
  await navigate("event-b", "organizer");
  await page.locator("#import-csv").fill(fixtureA);
  await page.locator('[name="reviewConfirmed"]').check();
  await page
    .locator("#review-note")
    .fill("Cannot override the Event A identity, even when checked.");
  await page.locator('form[data-form="import"] button[type="submit"]').click();
  await expect(page.locator("#toast")).toContainText("wrong event");
  check(
    (await detail("event-b")).attendance.length,
    0,
    "Organizer review cannot override proven wrong-event source",
  );

  await identity("organizer-a");
  await navigate("event-a", "organizer");
  await page.locator("#refresh").click();
  await expect(page.locator('[data-tx="postAttendance"]')).toBeVisible();
  await confirm("postAttendance");
  check(
    (await detail("event-a")).state.attendeeCount,
    1,
    "Trusted attendance proposal reaches the actual v7 contract",
  );
  check(
    (await detail("event-b")).state.phase,
    "Open",
    "Posting Event A attendance does not progress Event B",
  );

  await navigate("event-a");
  await identity("bob");
  await confirm("challenge");
  await navigate("event-a", "cases");
  await identity("carol");
  await confirm("match");
  a = await detail("event-a");
  check(
    a.state.cases[0].state,
    "Disputed",
    "Another wallet matches the real challenge",
  );
  await page
    .locator("summary")
    .filter({ hasText: "Evidence, publication & appeals" })
    .click();
  await page.locator("[data-publish]").click();
  await expect(page.locator("#toast")).toContainText("stored locally");
  check(
    (await detail("event-a")).state.cases[0].publication,
    "local-only",
    "Exact case bytes are locally published with honest status",
  );
  await identity("organizer-a");
  await api("/api/demo/advance", { seconds: 86402 });
  await page.locator("#refresh").click();
  await expect(page.locator('[data-tx="release"]')).toBeEnabled();
  await confirm("release");
  a = await detail("event-a");
  check(
    a.state.phase,
    "Finalized",
    "Normal payouts proceed with a matched open case",
  );
  check(
    a.state.heldBackWei,
    "10000000000000000",
    "A complete provisional share remains reserved",
  );
  check(
    (await detail("event-b")).state.phase,
    "Open",
    "Event B continues normally during Event A dispute",
  );
  await page
    .locator("summary")
    .filter({ hasText: "Local Court mock controls" })
    .click();
  await page.locator('[data-ruling="1"]').click();
  await expect(page.locator("#toast")).toContainText(
    "Mock Court ruling recorded",
  );
  await confirm("resolve");
  a = await detail("event-a");
  check(
    a.state.attendeeCount,
    2,
    "Final attended ruling updates the actual event contract",
  );
  check(
    a.state.heldBackWei,
    "0",
    "Winning held share is paid and reserve cleared",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await navigate("event-a");
  await identity("alice");
  await expect(page.locator(".mobile-brand")).toBeVisible();
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Mobile page has no horizontal overflow",
  );
  await expect(page.locator("#toast")).not.toBeVisible({ timeout: 9000 });
  await page.screenshot({
    path: fileURLToPath(
      new URL("../artifacts/demo-mobile.png", import.meta.url),
    ),
    fullPage: true,
  });
  await navigate("event-a", "cases");
  await expect(page.locator("#content")).toContainText("Total reserved");

  check(external, [], "Browser made no external network request");
  check(pageErrors, [], "No uncaught browser errors");
  console.log(
    `Browser checks passed: ${assertions} assertions plus UI wait/interaction checks. Real local v7 deposits, independent event state, source review, staff authorization, personal-history isolation, and mobile layout verified.\nScreenshots: artifacts/demo-desktop.png, artifacts/demo-mobile.png`,
  );
} finally {
  await browser?.close();
  await server.close();
}
