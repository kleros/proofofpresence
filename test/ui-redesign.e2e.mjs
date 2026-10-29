import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { startServer } from "../src/server.mjs";

// UI acceptance uses fresh synthetic people, real local v7 contracts and mock V1
// adjudication only. No production endpoint or external network is permitted.
const server = await startServer({ port: 0, rpcPort: 0 });
const output = new URL(
  "../artifacts/screenshots/ui-redesign/",
  import.meta.url,
);
const external = [],
  errors = [],
  assetErrors = [],
  results = [];
let browser;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  results.push(label);
};

try {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === server.url) return route.continue();
    external.push(url.href);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      ["script", "stylesheet", "font", "image"].includes(
        response.request().resourceType(),
      )
    ) {
      assetErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  const request = async (path, body) => {
    const response = await page.request.post(`${server.url}${path}`, {
      data: body,
      headers: { Origin: server.url },
    });
    const data = await response.json();
    assert.equal(response.ok(), true, `${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const detail = async (event = "event-a") =>
    (await page.request.get(`${server.url}/api/events/${event}`)).json();
  const navigate = async (event = "event-a", view = "participant") => {
    const destination = `${server.url}/#${new URLSearchParams({ event, view })}`;
    const freshDetail = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.origin === server.url &&
        ((url.pathname === "/api/bootstrap" && url.searchParams.get("selectedEventId") === event) ||
          url.pathname === `/api/events/${event}`);
    });
    if (page.url() === destination) await page.reload();
    else await page.goto(destination);
    await freshDetail;
    await expect(page.locator("#content")).toBeVisible();
    await expect(page.locator("h1")).toHaveText(
      event === "event-a" ? "Proof of Presence" : "Open Justice Workshop",
    );
    await expect(page.locator(`.tabs [data-view="${view}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".event-context")).toBeVisible();
  };
  const identity = async (id) => {
    const bootstrap = await (
      await page.request.get(`${server.url}/api/bootstrap`)
    ).json();
    const expected = bootstrap.identities.find((item) => item.id === id);
    await page.locator("#identity-select").selectOption(id);
    await expect(page.locator("#identity-select")).toHaveValue(id);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${server.url}/api/bootstrap`)).json())
            .session?.wallet,
      )
      .toBe(expected.wallet);
  };
  const execute = async (event, action, params = {}) => {
    const draft = await request(`/api/events/${event}/drafts`, {
      action,
      params,
    });
    const tx = await request(
      `/api/events/${event}/drafts/${draft.id}/execute`,
      {},
    );
    check(
      tx.status,
      "confirmed",
      `${event} ${action} uses a confirmed local receipt`,
    );
  };
  const screenshot = async (name) => {
    await page.screenshot({
      path: fileURLToPath(new URL(`${name}.png`, output)),
      fullPage: true,
    });
    await page.screenshot({
      path: fileURLToPath(new URL(`${name}.viewport.png`, output)),
      fullPage: false,
    });
  };
  const noOverflow = async (label) =>
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      true,
      label,
    );
  const fact = (label) =>
    page.locator(".state-fact").filter({
      has: page.locator("dt", { hasText: new RegExp(`^${label}$`, "i") }),
    });

  await page.goto(server.url);
  await expect(page.locator(".event-card")).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  check(
    await page.evaluate(async () => {
      const loaded = await Promise.all(
        ["Geist", "Instrument Serif", "Geist Mono"].map((family) =>
          document.fonts.load(`16px "${family}"`),
        ),
      );
      return loaded.every(
        (faces) =>
          faces.length > 0 && faces.every((face) => face.status === "loaded"),
      );
    }),
    true,
    "Supplied display, body and technical font families load",
  );
  await screenshot("desktop-directory");
  await navigate();
  await identity("alice");
  for (const label of [
    "Admission",
    "Deposit receipt",
    "Contract registration",
    "Staff check-in",
    "Financial attendance",
    "Attendance dispute",
    "Payout",
  ]) {
    await expect(fact(label)).toHaveCount(1);
  }
  results.push("Seven participant facts are independently labeled");
  await expect(page.locator(".next-action")).toBeVisible();
  await expect(fact("Admission")).toContainText(/pending/i);
  await expect(fact("Contract registration")).toContainText(/not registered/i);
  const a0 = await detail();
  await expect(page.locator(".event-context")).toContainText(a0.event.contract);
  await expect(page.locator(".event-context")).toContainText("1337");
  results.push(
    "Persistent event context exposes full deployment and chain identity",
  );

  // Real native dialog: sensible focus, containment, Escape, trigger restoration.
  const deposit = page.locator('[data-tx="deposit"]').first();
  await deposit.click();
  await expect(page.locator("#review-dialog")).toBeVisible();
  check(
    await page.evaluate(
      () => document.activeElement?.closest("#review-dialog") !== null,
    ),
    true,
    "Review receives initial keyboard focus",
  );
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press(i % 3 ? "Tab" : "Shift+Tab");
    check(
      await page.evaluate(
        () => document.activeElement?.closest("#review-dialog") !== null,
      ),
      true,
      `Review contains keyboard focus ${i + 1}`,
    );
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#review-dialog")).not.toBeVisible();
  await expect(deposit).toBeFocused();
  results.push("Escape dismisses unsigned review and restores its trigger");

  await deposit.click();
  await expect(page.locator("#review-dialog")).toBeVisible();
  await page.evaluate(() => {
    location.hash = "event=event-b&view=participant";
  });
  await expect(page.locator("#review-dialog")).not.toBeVisible();
  await expect(page.locator("#event-switch")).toHaveValue("event-b");
  check(
    (await detail()).participants[0].deposit,
    null,
    "Event switching discards unsigned review without sending ETH",
  );
  await page.locator("#event-switch").selectOption("event-a");
  await expect(page.locator("h1")).toHaveText("Proof of Presence");

  // Display real confirmed receipt independently from host admission and staker status.
  await execute("event-a", "deposit");
  await navigate();
  await expect(fact("Deposit receipt").locator("dd strong")).toHaveText(
    "0.01 ETH · confirmed",
  );
  await expect(fact("Admission")).toContainText(/pending/i);
  await expect(fact("Contract registration")).toContainText(/not registered/i);
  results.push(
    "Verified payment does not turn admission or contract registration into success",
  );
  await screenshot("desktop-participant");
  await identity("bob");
  await execute("event-a", "deposit");
  await identity("organizer-a");
  for (const participant of ["alice", "bob"]) {
    const response = await page.request.patch(
      `${server.url}/api/events/event-a/participants/event-a-${participant}`,
      {
        data: { admission: "approved" },
        headers: { Origin: server.url },
      },
    );
    assert.equal(response.ok(), true);
  }
  await execute("event-a", "register");
  await request("/api/demo/advance", { seconds: 3601 });
  await navigate("event-a", "organizer");
  await expect(page.locator(".workflow-steps")).toBeVisible();
  const fixtureA = await (
    await page.request.get(
      `${server.url}/api/events/event-a/fixture?kind=attendance`,
    )
  ).text();
  await page.locator("#import-csv").fill(fixtureA);
  await page.locator('[name="reviewConfirmed"]').check();
  await page
    .locator("#review-note")
    .fill(
      "Synthetic source export checked against Event A identity and local deployment.",
    );
  const beforeImport = (await detail()).attendance.length;
  await page.locator("[data-import-preview]").click();
  await expect(
    page.locator("#import-preview .reconciliation-table"),
  ).toBeVisible();
  check(
    (await detail()).attendance.length,
    beforeImport,
    "Reconciliation preview does not commit attendance",
  );
  await screenshot("desktop-reconciliation");
  // The final explicit review may be a separate dialog after a preview-button step.
  const commit = page.locator("[data-import-commit]");
  if (!(await commit.isVisible())) {
    await page
      .getByRole("button", { name: /review.*import|review.*consequence/i })
      .last()
      .click();
  }
  await expect(commit).toBeVisible();
  await commit.click();
  await expect(page.locator("#import-result")).toContainText(
    /Import (validated|applied|committed)/i,
  );
  check(
    (await detail()).attendance.length,
    beforeImport + 1,
    "Explicit source approval commits one trusted observation",
  );
  await identity("alice");
  await navigate();
  await expect(fact("Staff check-in")).toContainText(/recorded|observed/i);
  await expect(fact("Financial attendance")).toContainText(
    /not|pending|awaiting/i,
  );
  check(
    (await detail()).participants[0].attended,
    false,
    "Staff observation remains separate from on-chain attendance",
  );

  await navigate("event-a", "organizer");
  await identity("organizer-a");
  // Review a proven mismatch; checking provenance must never override it.
  const fixtureB = await (
    await page.request.get(
      `${server.url}/api/events/event-b/fixture?kind=attendance`,
    )
  ).text();
  await page.locator("#import-csv").fill(fixtureB);
  await page.locator('[name="reviewConfirmed"]').check();
  await page
    .locator("#review-note")
    .fill("Acknowledgment must not override a proven wrong event.");
  await page.locator("[data-import-preview]").click();
  await expect(page.locator("#import-preview")).toContainText(
    /wrong event|event mismatch|different event/i,
  );
  check(
    (await detail()).attendance.length,
    beforeImport + 1,
    "Proven mismatched source has no attendance effect",
  );
  await page.locator("#event-switch").selectOption("event-b");
  await expect(page.locator("#import-csv")).toHaveCount(0); // A owner has no B import authority.
  await page.locator("#event-switch").selectOption("event-a");
  await expect(page.locator("#import-csv")).toHaveValue("");
  results.push(
    "Switching events clears unapproved import data and scoped authority",
  );

  await execute("event-a", "postAttendance");
  await identity("bob");
  await execute("event-a", "challenge");
  await navigate("event-a", "cases");
  await expect(page.locator(".case-summary").first()).toContainText(
    /waiting.*match|awaiting.*match/i,
  );
  await expect(page.locator(".case-summary").first()).toContainText(
    /no court case|not created|not matched/i,
  );
  await identity("carol");
  const bob = (await detail()).state.cases[0].wallet;
  await execute("event-a", "match", { wallet: bob });
  await identity("organizer-a");
  await request("/api/demo/advance", { seconds: 86402 });
  await execute("event-a", "release");
  await navigate("event-a", "cases");
  await expect(page.locator(".money-summary")).toBeVisible();
  await expect(page.locator(".money-summary")).toContainText(/sent/i);
  const paymentSnapshot = await (
    await page.request.get(`${server.url}/api/events/event-a`)
  ).json();
  const payoutLogs = await server.workbench
    .contract("event-a")
    .queryFilter(server.workbench.contract("event-a").filters.Payout());
  const directlyPaid = payoutLogs.reduce(
    (sum, log) => sum + log.args.amount,
    0n,
  );
  check(
    paymentSnapshot.payments.attendancePaidWei,
    directlyPaid.toString(),
    "Sent projection equals actual successful payout logs",
  );
  await expect(
    page.locator(".money-summary .money-card").first().locator("strong"),
  ).toHaveText("0.01 ETH");
  await expect(page.locator(".money-summary")).toContainText(
    /canonical contract logs/i,
  );
  await expect(page.locator(".money-summary")).toContainText(/reserved/i);
  await expect(page.locator(".money-summary")).toContainText(/owed/i);
  const settled = await detail();
  check(
    settled.state.phase,
    "Finalized",
    "Ordinary payout batch proceeds with matched case open",
  );
  check(
    settled.state.heldBackWei,
    "10000000000000000",
    "Real contract retains full provisional matched share",
  );
  await screenshot("desktop-obligations");

  // A failed authoritative read removes dependent financial actions until retry.
  const eventRead = (url) => url.origin === server.url &&
    ((url.pathname === "/api/bootstrap" && url.searchParams.get("selectedEventId") === "event-a") ||
      url.pathname === "/api/events/event-a");
  await page.route(eventRead, (route) =>
    route.request().method() === "GET" ? route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Synthetic local read unavailable",
        code: "TEST_UNAVAILABLE",
      }),
    }) : route.continue(),
  );
  await page.locator("#refresh").click();
  await expect(page.locator("#content")).toContainText(
    "Synthetic local read unavailable",
  );
  await expect(page.locator("#content [data-tx]")).toHaveCount(0);
  results.push("Unavailable authoritative state removes financial actions");
  await page.unroute(eventRead);
  await page.locator("[data-reload]").click();
  await expect(page.locator(".money-summary")).toBeVisible();
  results.push("Explicit retry restores verified event state");

  // Event tab keyboard behavior should select the destination and retain focus.
  await page.locator('[role="tab"][data-view="cases"]').focus();
  await page.keyboard.press("Home");
  await expect(
    page.locator('[role="tab"][data-view="participant"]'),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator('[role="tab"][data-view="participant"]'),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator('[role="tab"][data-view="cases"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.locator('[role="tab"][data-view="organizer"]'),
  ).toHaveAttribute("aria-selected", "true");
  results.push(
    "Event tabs support Home, End and arrow-key activation with focus",
  );
  const focusStyle = await page
    .locator('[role="tab"][data-view="organizer"]')
    .evaluate((element) => ({
      style: getComputedStyle(element).outlineStyle,
      width: parseFloat(getComputedStyle(element).outlineWidth),
    }));
  check(
    focusStyle.style !== "none" && focusStyle.width >= 3,
    true,
    "Keyboard activation has a visible 3px focus outline",
  );
  await noOverflow("Desktop organizer does not overflow at 1440×900");

  await page.setViewportSize({ width: 400, height: 800 });
  for (const [view, filename] of [
    ["participant", "mobile-participant"],
    ["organizer", "mobile-organizer"],
    ["cases", "mobile-obligations"],
  ]) {
    await request("/api/session", {
      identity: view === "participant" ? "alice" : "organizer-a",
    });
    await navigate("event-a", view);
    await noOverflow(`${view} does not overflow at 400×800`);
    await expect(page.locator("#event-switch")).toBeVisible();
    await screenshot(filename);
  }
  const tooSmall = await page
    .locator(
      "button.button:visible, a.button:visible, select:visible, input:not([type=checkbox]):visible",
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getBoundingClientRect().height < 44)
        .map(
          (element) =>
            `${element.tagName}: ${element.textContent?.trim().slice(0, 60) || element.getAttribute("id")}`,
        ),
    );
  check(
    tooSmall,
    [],
    "Visible primary controls meet chosen 44px minimum target height",
  );
  // Pixel-based interface type does not respond to changing only html.font-size.
  // Capture sizes first so doubling the type cannot compound through inheritance.
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll("body, body *")].map(
      (element) => ({
        element,
        size: parseFloat(getComputedStyle(element).fontSize),
      }),
    );
    for (const { element, size } of sizes) {
      if (element instanceof HTMLElement && Number.isFinite(size)) {
        element.style.setProperty("font-size", `${size * 2}px`, "important");
      }
    }
  });
  await screenshot("mobile-obligations-large-text");
  await noOverflow("Cases reflow with actual 200% text size at 400px width");
  check(external, [], "Browser attempted no external network request");
  check(errors, [], "Browser raised no uncaught page errors");
  check(
    assetErrors,
    [],
    "Local scripts, styles, fonts and images load without failed responses",
  );
  await fs.writeFile(
    new URL("results.json", output),
    JSON.stringify(
      {
        viewports: ["1440×900", "400×800"],
        assertions: results.length,
        passed: results,
        externalRequests: external,
        pageErrors: errors,
        assetErrors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `UI redesign browser checks passed: ${results.length} assertions plus Playwright expectations. Screenshots: artifacts/screenshots/ui-redesign/`,
  );
} finally {
  await browser?.close();
  await server.close();
}
