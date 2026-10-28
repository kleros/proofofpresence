import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { startServer } from "../src/server.mjs";

// Financial assertions use real isolated contracts. The final testnet-only
// presentation fixture never signs or sends a request to an external service.
const contractVersion = process.env.CONTRACT_VERSION ?? "truth-pays-v7";
const server = await startServer({ port: 0, rpcPort: 0, contractVersion });
const checks = [],
  failures = [],
  external = [];
let browser;
function check(value, message) {
  assert.ok(value, message);
  checks.push(message);
}
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === server.url)
      return route.continue();
    external.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(server.url);
  await expect(page.locator(".quick-start li")).toHaveCount(3);
  check(
    (await page.locator(".event-card").count()) === 2,
    "Two separate events remain discoverable",
  );
  await page.goto(server.url + "/#event=event-a&view=participant");
  await expect(page.locator("#content")).toBeVisible();
  await page.locator("#identity-select").selectOption("alice");
  await expect(page.locator("#top-identity")).toContainText("Alice");
  await expect(page.locator(".participation-steps li")).toHaveCount(4);
  check(
    (await page.locator(".next-action .button-primary").count()) === 1,
    "Participant receives one primary next action",
  );
  check(
    await page
      .locator("#deployment-details")
      .evaluate((element) => !element.open),
    "Technical deployment information starts collapsed",
  );
  check(
    await page.locator(".status-details").evaluate((element) => !element.open),
    "Seven independent financial facts are available on demand",
  );
  await page.locator(".status-details summary").click();
  await expect(page.locator(".state-fact")).toHaveCount(7);
  await expect(page.locator(".state-grid")).toBeVisible();
  await page.locator("#deployment-details summary").click();
  const aBefore = await (
    await page.request.get(server.url + "/api/events/event-a")
  ).json();
  await expect(page.locator("#deployment-details")).toContainText(
    aBefore.event.contract,
  );
  check(
    aBefore.event.contractVersion === contractVersion,
    "Displayed contract version matches the actual event deployment",
  );
  if (contractVersion === "kleros-event-v8")
    check(
      (await page.locator('a[href^="/finance/"]').count()) === 0,
      "v8 never links incompatible historical guest or console tools",
    );
  await page.locator('[data-tx="deposit"]').first().click();
  await expect(page.locator("#review-dialog")).toBeVisible();
  for (const exact of [
    aBefore.event.title,
    aBefore.event.contract,
    aBefore.event.policyURI,
    aBefore.event.depositWei,
    "1337",
  ])
    await expect(page.locator("#dialog-body")).toContainText(exact);
  check(
    await page.locator("#dialog-body .review-list").isVisible(),
    "Exact transaction terms stay expanded before confirmation",
  );
  await page.locator("[data-execute]").click();
  await expect(page.locator("#review-dialog")).not.toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("#toast")).toContainText("Confirmed");
  const a = await (
    await page.request.get(server.url + "/api/events/event-a")
  ).json();
  const b = await (
    await page.request.get(server.url + "/api/events/event-b")
  ).json();
  const alice = a.participants.find((person) => person.id === "event-a-alice");
  check(
    alice.deposit.verified &&
      !alice.registered &&
      alice.admission === "pending",
    "Real verified deposit does not become host approval or contract registration",
  );
  check(
    BigInt(b.state.balanceWei) === 0n,
    "Participant deposit leaves the other event untouched",
  );
  await expect(page.locator(".participation-steps li").nth(0)).toHaveClass(
    /complete/,
  );
  await expect(page.locator(".participation-steps li").nth(1)).not.toHaveClass(
    /complete/,
  );
  await expect(page.locator(".participation-steps li").nth(1)).toContainText(
    "Host decision pending",
  );
  check(
    await page
      .locator(".next-action")
      .textContent()
      .then((text) => /admission pending/i.test(text)),
    "The next action explains the actual pending host decision",
  );
  if (contractVersion === "kleros-event-v8") {
    check(
      alice.pendingCreditWei === a.event.depositWei,
      "v8 shows the payer's actual unused credit",
    );
    await page.locator('[data-view="cases"]').click();
    await expect(
      page.locator(".money-card").filter({ hasText: "Unused deposit credit" }),
    ).toContainText("0.01 ETH");
    check(
      (await page
        .locator(".money-card")
        .filter({ hasText: "Unused deposit credit" })
        .count()) === 1,
      "v8 accounting separates unused credit from kickbacks and held case shares",
    );
    await page.locator('[data-view="participant"]').click();
    await page
      .locator('.credit-summary [data-recovery="withdrawPending"]')
      .click();
    await expect(page.locator("#recovery-amount")).toHaveValue("0.01");
    await page.locator('form[data-form="recovery"] button').last().click();
    await expect(page.locator("#dialog-body")).toContainText("withdrawPending");
    await expect(page.locator("#dialog-body")).toContainText(alice.wallet);
    await expect(page.locator("#dialog-body")).toContainText("0 wei");
    await page.locator("[data-execute]").click();
    await expect(page.locator("#review-dialog")).not.toBeVisible({
      timeout: 30_000,
    });
    const recovered = await (
      await page.request.get(server.url + "/api/events/event-a")
    ).json();
    const recoveredAlice = recovered.participants.find(
      (person) => person.id === "event-a-alice",
    );
    check(
      recoveredAlice.pendingCreditWei === "0" &&
        BigInt(recovered.state.balanceWei) === 0n,
      "v8 payer recovers unused credit through a confirmed real contract transaction",
    );
    check(
      !recoveredAlice.registered && recoveredAlice.admission === "pending",
      "Unused-credit recovery does not change host approval or financial registration",
    );
    await expect(
      page.locator('.credit-summary [data-recovery="withdrawPending"]'),
    ).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Simplified participant journey fits a mobile viewport",
  );
  await expect(page.locator("#toast")).toBeHidden({ timeout: 10_000 });
  await fs.mkdir("artifacts/screenshots/simple-ui", { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/simple-ui/${contractVersion}-mobile.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: `artifacts/screenshots/simple-ui/${contractVersion}-desktop.png`,
    fullPage: true,
  });

  // Controlled rendering fixture for public-testnet mode. It exercises labels
  // and removes demo controls; it is not evidence of a public-chain deployment.
  const testnet = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  let testnetWrites = 0;
  await testnet.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== server.url) {
      external.push(url.href);
      return route.abort("blockedbyclient");
    }
    if (request.method() !== "GET") {
      testnetWrites++;
      return route.abort("blockedbyclient");
    }
    if (url.pathname === "/api/bootstrap") {
      const response = await route.fetch(),
        data = await response.json();
      Object.assign(data, {
        mode: "hosted-testnet",
        identities: [],
        session: null,
        contractVersion: "kleros-event-v8",
        capabilities: { sharedDemo: false, browserWallet: true },
      });
      data.chain = {
        chainId: 10200,
        name: "Gnosis Chiado",
        rpcUrl: "https://rpc.chiadochain.net",
        nativeCurrency: { name: "Test xDAI", symbol: "XDAI", decimals: 18 },
      };
      return route.fulfill({ response, json: data });
    }
    if (url.pathname === "/api/events/event-a") {
      const response = await route.fetch(),
        data = await response.json();
      data.event = {
        ...data.event,
        chainId: 10200,
        contractVersion: "kleros-event-v8",
        abiVersion: "kleros-event-v8",
      };
      return route.fulfill({ response, json: data });
    }
    return route.continue();
  });
  const testnetPage = await testnet.newPage();
  testnetPage.on("pageerror", (error) => failures.push(error.message));
  await testnetPage.goto(server.url + "/#event=event-a&view=participant");
  await expect(testnetPage.locator("#testnet-banner")).toContainText(
    "Gnosis Chiado",
  );
  await expect(testnetPage.locator("#identity-select")).toHaveCount(0);
  await expect(testnetPage.locator(".event-summary")).toContainText("XDAI");
  check(
    (await testnetPage
      .locator(
        '[data-fund-wallet],[data-advance],[data-ruling],[data-open-appeal],a[href^="/finance/"]',
      )
      .count()) === 0,
    "Testnet presentation removes all demo-only controls and incompatible tools",
  );
  await testnetPage.locator("#top-identity").click();
  await expect(testnetPage.locator("#dialog-title")).toHaveText(
    "Connect your wallet",
  );
  await expect(
    testnetPage.locator("[data-connect-wallet]").last(),
  ).toBeVisible();
  await expect(
    testnetPage.locator("#dialog-identity,[data-fund-wallet]"),
  ).toHaveCount(0);
  check(
    testnetWrites === 0,
    "Testnet presentation checks never send a wallet or API mutation",
  );
  check(
    external.length === 0 && failures.length === 0,
    "No external requests or uncaught browser errors",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        contractVersion,
        checks: checks.length,
        testnetCoverage:
          "presentation fixture only; no public-chain transaction",
        assertions: checks,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
