import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { startServer } from "../src/server.mjs";

// Bounded GET-only rendering projections, backed by a fresh local v8 server.
// These checks never claim public-chain execution or send a financial request.
const server = await startServer({
  port: 0,
  rpcPort: 0,
  contractVersion: "kleros-event-v8",
});
let browser;
const checks = [],
  writes = [],
  external = [],
  failures = [];
const check = (value, label) => {
  assert.ok(value, label);
  checks.push(label);
};
try {
  const bootstrap = await (await fetch(server.url + "/api/bootstrap")).json();
  const baseline = await (
    await fetch(server.url + "/api/events/event-a")
  ).json();
  const bob = bootstrap.identities.find((person) => person.id === "bob").wallet;
  const caseOrganizer = bootstrap.identities.find(
    (person) => person.id === "organizer-a",
  ).wallet;
  const nextOwner = bootstrap.identities.find(
    (person) => person.id === "organizer-b",
  ).wallet;
  const now = Date.UTC(2026, 9, 29, 0, 0) / 1000;
  const omissionEnd = now + 3600,
    matchEnd = now + 7200;
  let detail = {
    ...baseline,
    event: {
      ...baseline.event,
      chainId: 10200,
      timezone: "UTC",
      contractVersion: "kleros-event-v8",
      abiVersion: "kleros-event-v8",
    },
    state: {
      ...baseline.state,
      phase: "Listed",
      owner: nextOwner,
      challengeEndsAt: omissionEnd,
      cases: [],
      pendingChallenges: 0,
    },
    now,
    participants: [],
    ownWallet: { wallet: bob, pendingCreditWei: "2000000000000", owedWei: "0" },
    permissions: { owner: false, staff: false, authenticated: true },
  };
  const walletBootstrap = {
    ...bootstrap,
    mode: "hosted-testnet",
    identities: [],
    session: { wallet: bob, mode: "wallet", label: "Status fixture wallet" },
    capabilities: { sharedDemo: false, browserWallet: true },
    arbitration: {
      mode: "controlled",
      notice: "Controlled test arbitrator; no independent jury",
    },
    chain: {
      chainId: 10200,
      name: "Chiado",
      rpcUrl: "https://rpc.chiadochain.net",
      nativeCurrency: { symbol: "XDAI", name: "Chiado xDAI", decimals: 18 },
    },
  };
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== server.url) {
      external.push(url.origin);
      return route.abort("blockedbyclient");
    }
    if (!["GET", "HEAD"].includes(request.method())) {
      writes.push(url.pathname);
      return route.abort("blockedbyclient");
    }
    if (url.pathname === "/api/bootstrap")
      return route.fulfill({ json: walletBootstrap });
    if (url.pathname === "/api/events/event-a")
      return route.fulfill({ json: detail });
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  const visit = async (view = "participant") => {
    await page.goto(server.url + `/#event=event-a&view=${view}`);
    await page.reload(); // Force a fresh GET projection when the hash is unchanged.
    await expect(page.locator("#event-switch")).toHaveValue("event-a");
    await expect(page.locator("#content")).toBeVisible();
  };
  await visit();
  await expect(
    page.locator('.next-action [data-recovery="withdrawPending"]'),
  ).toBeVisible();
  await page.locator('.next-action [data-recovery="withdrawPending"]').click();
  await expect(page.locator("#recovery-amount")).toHaveValue("0.000002");
  await expect(page.locator("#recovery-to")).toHaveValue(bob);
  check(
    (await page
      .locator(
        '#review-dialog input[name="name"],#review-dialog input[name="email"]',
      )
      .count()) === 0,
    "Unlinked same-block credit offers recovery without contact registration",
  );
  await page.keyboard.press("Escape");
  detail = {
    ...detail,
    ownWallet: { wallet: bob, pendingCreditWei: "0", owedWei: "3000000000000" },
  };
  await visit();
  await expect(
    page.locator('.next-action [data-recovery="claim"]'),
  ).toBeVisible();
  await visit("cases");
  await expect(page.locator('[data-recovery="claim"]')).toBeEnabled();
  check(
    true,
    "Unlinked same-block owed credit also enables the independent claim review",
  );

  const dispute = {
    wallet: bob,
    state: "Disputed",
    matched: true,
    localDisputeID: "0",
    arbitratorDisputeID: "1000",
    finalRuling: null,
    matchEndsAt: matchEnd,
    depositWei: "30000000000",
    heldShareWei: "0",
    caseOrganizer,
    caseURI: "/ipfs/synthetic",
    publication: "not-published",
  };
  detail = {
    ...detail,
    ownWallet: { wallet: bob, pendingCreditWei: "0", owedWei: "0" },
    state: { ...detail.state, cases: [dispute], pendingChallenges: 1 },
  };
  await visit("cases");
  await expect(page.locator(".case-card h3")).toContainText(
    "Matched controlled test dispute",
  );
  await expect(page.locator(".case-card")).toContainText(
    "no independent Kleros jury",
  );
  await page.locator(".case-source-details summary").click();
  await expect(page.locator(".case-source-details dd")).toHaveText(
    caseOrganizer,
  );
  check(
    !(await page.locator(".case-source-details dd").textContent()).includes(
      nextOwner,
    ),
    "Case organizer remains the challenge-time address instead of the current owner",
  );
  const caseFact = (label) =>
    page
      .locator(".case-card .details-list > div")
      .filter({
        has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }),
      })
      .locator("dd");
  await expect(caseFact("Resolver local ID")).toHaveText("0");
  await expect(caseFact("Arbitrator dispute ID")).toHaveText("1000");
  check(true, "Matched local ID0 is shown distinctly from arbitrator ID1000");

  detail = {
    ...detail,
    state: { ...detail.state, cases: [{ ...dispute, finalRuling: 3 }] },
  };
  await visit("cases");
  await expect(page.locator(".case-card h3")).toContainText(
    "Final ruling unavailable",
  );
  for (const action of ["resolve", "passPeriod", "deliverRuling"])
    await expect(page.locator(`[data-tx="${action}"]`)).toBeDisabled();
  await expect(page.locator(".case-card [data-reload]")).toBeVisible();
  await page.locator(".case-source-details summary").click();
  await expect(page.locator(".case-source-details")).toContainText(
    "Reported ruling, not accepted for settlement: 3",
  );
  check(
    true,
    "An unsupported final ruling exposes Refresh and source evidence without eligible settlement",
  );
  detail = {
    ...detail,
    state: { ...detail.state, cases: [{ ...dispute, finalRuling: 0 }] },
  };
  await visit("cases");
  await expect(page.locator('[data-tx="resolve"]')).toBeEnabled();
  await expect(caseFact("Final ruling")).toContainText(
    "0 · Refused / excluded",
  );
  check(
    true,
    "A valid refused ruling0 remains a supported distinct settlement outcome",
  );

  detail = {
    ...detail,
    state: {
      ...detail.state,
      cases: [
        {
          ...dispute,
          state: "Waiting",
          matched: false,
          finalRuling: null,
          localDisputeID: null,
          arbitratorDisputeID: null,
        },
      ],
    },
  };
  await visit("cases");
  await expect(page.locator(".payout-wait-reason")).toContainText(
    "02:00:00 UTC",
  );
  await expect(page.locator(".payout-wait-reason")).toContainText(
    "01:00:00 UTC",
  );
  await expect(page.locator('[data-tx="release"]')).toBeDisabled();
  check(
    true,
    "Payout waiting identifies a later unmatched deadline separately from the omission window",
  );
  detail = { ...detail, now: matchEnd + 1 };
  await visit("cases");
  await expect(page.locator(".expired-case-hint")).toContainText(
    "1 expired unmatched challenge",
  );
  await expect(page.locator(".expired-case-hint")).toContainText(
    "Settle final / unmatched case",
  );
  await expect(page.locator('[data-tx="resolve"]')).toBeEnabled();
  await expect(page.locator('[data-tx="release"]')).toBeEnabled();
  check(
    true,
    "Expired unmatched cases expose individual settlement as a gas fallback while retaining ordinary payout eligibility",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Status and waiting explanations fit a mobile viewport",
  );
  check(
    writes.length === 0 && external.length === 0 && failures.length === 0,
    "Status guard checks make no API mutation, external request or financial wallet call",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        scope: "GET-only local rendering projections; no public-chain claim",
        checks: checks.length,
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
