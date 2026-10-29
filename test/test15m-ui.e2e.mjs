import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { startServer } from "../src/server.mjs";

// Read-only presentation fixtures served by an actual isolated local v8 HTTP
// server. The sole POST is a simulated draft response; no wallet or RPC send is
// possible. This is not evidence of a deployed test15m contract or live lifecycle.
const FAST = "kleros-event-v8-test15m";
const profile = {
  contractVersion: FAST,
  version: 80015,
  challengeWindowSeconds: 900,
  matchWindowSeconds: 900,
  chainId: 10200,
  testOnly: true,
};
const server = await startServer({
  port: 0,
  rpcPort: 0,
  contractVersion: "kleros-event-v8",
});
const checks = [],
  errors = [],
  external = [],
  unexpectedWrites = [];
let browser,
  draftReviews = 0;
const check = (value, label) => {
  assert.ok(value, label);
  checks.push(label);
};
const date = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value * 1000));
try {
  const baseBootstrap = await (
    await fetch(server.url + "/api/bootstrap")
  ).json();
  const baseline = await (
    await fetch(server.url + "/api/events/event-a")
  ).json();
  const alice = baseBootstrap.identities.find(
    (person) => person.id === "alice",
  ).wallet;
  const owner = baseBootstrap.identities.find(
    (person) => person.id === "organizer-a",
  ).wallet;
  const now = Date.UTC(2026, 9, 29, 10, 0) / 1000,
    omissionEnd = now + 137,
    matchEnd = now + 491;
  let detail = {
    ...baseline,
    event: {
      ...baseline.event,
      contractVersion: FAST,
      abiVersion: FAST,
      chainId: 10200,
      timezone: "UTC",
      contractProfile: profile,
    },
    state: {
      ...baseline.state,
      phase: "Listed",
      owner,
      challengeEndsAt: omissionEnd,
      pendingTotalWei: "1000000000000",
      cases: [
        {
          wallet: alice,
          state: "Waiting",
          matched: false,
          matchEndsAt: matchEnd,
          depositWei: "30000000000",
          heldShareWei: "0",
          finalRuling: null,
          localDisputeID: null,
          arbitratorDisputeID: null,
          caseOrganizer: owner,
        },
      ],
      pendingChallenges: 1,
    },
    now,
    participants: [],
    ownWallet: {
      wallet: alice,
      pendingCreditWei: "1000000000000",
      owedWei: "0",
    },
    permissions: { owner: false, staff: false, authenticated: true },
  };
  let bootstrap = {
    ...baseBootstrap,
    mode: "hosted-testnet",
    identities: [],
    contractVersion: FAST,
    contractProfile: profile,
    session: {
      wallet: alice,
      label: "Synthetic profile wallet",
      mode: "wallet",
    },
    capabilities: {
      sharedDemo: false,
      browserWallet: true,
      contractInbox: true,
      batchActions: true,
    },
    arbitration: {
      mode: "controlled",
      notice: "Controlled test arbitrator; no independent jury",
    },
    chain: {
      chainId: 10200,
      name: "Gnosis Chiado",
      rpcUrl: "https://rpc.chiadochain.net",
      nativeCurrency: { name: "Test xDAI", symbol: "XDAI", decimals: 18 },
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
      external.push(url.href);
      return route.abort("blockedbyclient");
    }
    if (
      request.method() === "POST" &&
      url.pathname === "/api/events/event-a/drafts"
    ) {
      const input = request.postDataJSON();
      assert.equal(input.action, "withdrawPending");
      assert.equal(input.params.to.toLowerCase(), alice.toLowerCase());
      assert.equal(input.params.amountWei, "1000000000000");
      draftReviews++;
      return route.fulfill({
        status: 201,
        json: {
          id: "profile-review-fixture",
          eventId: "event-a",
          action: input.action,
          params: input.params,
          wallet: alice,
          contract: detail.event.contract,
          contractVersion: FAST,
          abiVersion: FAST,
          chainId: 10200,
          method: "withdrawPending",
          args: [alice, input.params.amountWei],
          valueWei: "0",
          snapshot: detail.state.fingerprint,
          expiresAt: Date.now() + 300_000,
          summary:
            "Synthetic reviewed unused-credit withdrawal; no transaction is sent.",
          transaction: {
            to: detail.event.contract,
            from: alice,
            chainId: 10200,
            data: server.workbench
              .contract("event-a")
              .interface.encodeFunctionData("withdrawPending", [
                alice,
                input.params.amountWei,
              ]),
            value: "0",
          },
        },
      });
    }
    if (!["GET", "HEAD"].includes(request.method())) {
      unexpectedWrites.push(url.pathname);
      return route.abort("blockedbyclient");
    }
    if (url.pathname === "/api/bootstrap")
      return route.fulfill({
        json: {
          ...bootstrap,
          events: [{ ...detail.event, financialPhase: detail.state.phase }],
        },
      });
    if (url.pathname === "/api/events/event-a")
      return route.fulfill({ json: detail });
    if (url.pathname === "/api/events/event-a/deposit-inbox")
      return route.fulfill({
        json: {
          source: "contract",
          eventId: "event-a",
          chainId: detail.event.chainId,
          contract: detail.event.contract,
          contractVersion: detail.event.contractVersion,
          indexedBlock: {
            number: detail.state.blockNumber,
            hash: "0x" + "1".repeat(64),
            timestamp: now,
          },
          latestBlock: detail.state.blockNumber,
          lastSyncedAt: new Date().toISOString(),
          nextRefreshAt: new Date(Date.now() + 30_000).toISOString(),
          stale: false,
          error: null,
          actionable: true,
          counts: { payers: 0, linked: 0, unlinked: 0, transactions: 0 },
          rows: [],
        },
      });
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const visit = async (view = "participant") => {
    await page.goto(server.url + `/#event=event-a&view=${view}`);
    await page.reload();
    await expect(page.locator("#content")).toBeVisible();
    await expect(page.locator("#event-switch")).toHaveValue("event-a");
  };
  await visit();
  await expect(page.locator("#testnet-banner strong")).toHaveText(
    "15-MINUTE TEST ONLY · CHIADO",
  );
  await expect(page.locator("#testnet-banner")).toContainText("10200");
  await expect(page.locator("#testnet-banner")).toContainText(
    "no independent jury",
  );
  await expect(
    page.locator(".event-context [data-test15m-notice]"),
  ).toContainText(date(omissionEnd));
  check(
    true,
    "The exact fast profile has persistent TEST ONLY/Chiado labeling and its actual on-chain omission deadline with seconds",
  );
  await expect(
    page.locator('.next-action [data-recovery="withdrawPending"]'),
  ).toBeVisible();
  await page.locator('.next-action [data-recovery="withdrawPending"]').click();
  await expect(page.locator("#recovery-amount")).toHaveValue("0.000001");
  await expect(page.locator("#recovery-to")).toHaveValue(alice);
  check(
    (await page
      .locator(
        '#review-dialog input[name="name"],#review-dialog input[name="email"]',
      )
      .count()) === 0,
    "Fast-profile payer-owned unused credit remains recoverable without a contact registration",
  );
  await page.locator('form[data-form="recovery"] button').last().click();
  await expect(
    page.locator("#review-dialog [data-test15m-notice]"),
  ).toContainText("15-minute TEST ONLY");
  await expect(page.locator("#dialog-body")).toContainText(FAST);
  for (const exact of [
    detail.event.contract,
    alice,
    "10200",
    "XDAI",
    "0 wei",
    detail.event.policyURI,
  ])
    await expect(page.locator("#dialog-body")).toContainText(exact);
  check(
    draftReviews === 1,
    "The test profile retains the expanded exact financial review with an explicit TEST ONLY profile notice before signing",
  );
  await page.locator("#review-dialog [data-close]").click();
  await visit("cases");
  await expect(
    page.locator(".money-card").filter({ hasText: "Unused deposit credit" }),
  ).toContainText("0.000001 XDAI");
  const fact = (label) =>
    page
      .locator(".case-card .details-list > div")
      .filter({
        has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }),
      })
      .locator("dd");
  await expect(fact("Matching deadline")).toHaveText(date(matchEnd));
  await expect(page.locator(".payout-wait-reason")).toContainText(
    date(matchEnd),
  );
  await expect(page.locator('[data-tx="release"]')).toBeDisabled();
  check(
    true,
    "Cases and payout readiness use reported matching/omission deadlines instead of inventing a fresh fifteen-minute window",
  );
  detail = { ...detail, now: matchEnd };
  await visit("cases");
  await expect(page.locator('[data-tx="release"]')).toBeDisabled();
  detail = { ...detail, now: matchEnd + 1 };
  await visit("cases");
  await expect(page.locator('[data-tx="release"]')).toBeEnabled();
  await expect(page.locator('.case-card [data-tx="resolve"]')).toBeEnabled();
  check(
    true,
    "The matching deadline remains strict: equality waits, and the next chain second enables the existing unmatched-settlement/payout path",
  );

  detail = {
    ...detail,
    now,
    state: { ...detail.state, phase: "Open", cases: [], challengeEndsAt: 0 },
    ownWallet: { wallet: owner, pendingCreditWei: "0", owedWei: "0" },
    participants: [
      {
        id: "event-a-alice",
        eventId: "event-a",
        wallet: alice,
        name: "Synthetic Alice",
        email: "alice@example.test",
        identityVerified: true,
        admission: "pending",
        deposit: null,
        registered: false,
        attended: false,
        owedWei: "0",
        pendingCreditWei: "0",
        batchEligibility: {
          "approve-admission": {
            eligible: false,
            reason: "Canonical receipt required",
          },
          "check-in": { eligible: false, reason: "Wait for event hours" },
        },
      },
    ],
    permissions: { owner: true, staff: true, authenticated: true },
  };
  bootstrap = {
    ...bootstrap,
    session: {
      wallet: owner,
      label: "Synthetic profile owner",
      mode: "wallet",
    },
  };
  await visit("organizer");
  await expect(page.locator("#contract-deposit-inbox")).toBeVisible();
  await expect(page.locator("[data-batch-toolbar]")).toHaveCount(2);
  await expect(page.locator("#attendance-review")).toContainText(
    "15-minute TEST ONLY omission challenge window",
  );
  check(
    !(await page.locator("#attendance-review").textContent()).includes(
      "one-day",
    ),
    "Fast-profile admission, contract inbox and separate approval/check-in controls are available without one-day copy",
  );
  check(
    (await page.locator('a[href^="/finance/"]').count()) === 0,
    "The test profile never exposes incompatible historical v7 financial tools",
  );

  const profileChecks = await page.evaluate(
    async ({ FAST, profile, contract, wallet }) => {
      const helper = await import("/contract-profiles.js");
      const { createBatchPendingJournal } = await import("/batch-pending.js");
      const event = {
        contractVersion: FAST,
        abiVersion: FAST,
        chainId: 10200,
        contractProfile: profile,
      };
      const values = new Map(),
        storage = {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => values.set(key, value),
          removeItem: (key) => values.delete(key),
        };
      const scope = {
        eventId: "event-a",
        instanceId: "first-fast-server",
        wallet,
        chainId: 10200,
        contract,
        contractVersion: FAST,
        action: "approve-admission",
      };
      const journal = createBatchPendingJournal(storage, {
        origin: location.origin,
      });
      journal.save(scope, {
        version: 1,
        scope,
        id: "fast-pending-id",
        nonce: "fast-nonce-1234",
        items: [{ participantId: "event-a-alice", wallet }],
        selectedCount: 1,
        phase: "unknown",
      });
      const recovered = journal.load({
        ...scope,
        instanceId: "replacement-fast-server",
      });
      const wrongChain = { ...scope, chainId: 1337 };
      let wrongChainRejected = false;
      let unknownJournalRejected = false;
      try {
        journal.load({ ...scope, contractVersion: FAST + "-future" });
      } catch {
        unknownJournalRejected = true;
      }
      try {
        journal.load(wrongChain);
      } catch {
        wrongChainRejected = true;
      }
      return {
        recognized: helper.hasV8FinancialInterface(event),
        rejects: [
          "kleros-event-v8-future",
          "kleros-event-v8-test15m-future",
          "__proto__",
          "constructor",
        ].every(
          (contractVersion) =>
            helper.contractProfileForEvent({ ...event, contractVersion }) ===
            null,
        ),
        mismatches:
          helper.contractProfileForEvent({ ...event, chainId: 1337 }) ===
            null &&
          helper.contractProfileForEvent({
            ...event,
            abiVersion: "kleros-event-v8",
          }) === null &&
          helper.contractProfileForEvent({
            ...event,
            contractProfile: { ...profile, matchWindowSeconds: 86400 },
          }) === null,
        recovered:
          recovered?.id === "fast-pending-id" &&
          recovered.scope.instanceId === scope.instanceId,
        isolated:
          journal.load({ ...scope, contractVersion: "kleros-event-v8" }) ===
          null,
        wrongChainRejected,
        unknownJournalRejected,
      };
    },
    { FAST, profile, contract: detail.event.contract, wallet: alice },
  );
  check(
    profileChecks.recognized &&
      profileChecks.rejects &&
      profileChecks.mismatches,
    "Explicit profile dispatch rejects unknown lookalikes, prototype names, wrong ABI/chain and conflicting pinned metadata",
  );
  check(
    profileChecks.recovered &&
      profileChecks.isolated &&
      profileChecks.wrongChainRejected &&
      profileChecks.unknownJournalRejected,
    "Contact-free fast-profile batch intent survives its own backend restart while staying isolated from production v8 and wrong-chain scopes",
  );

  detail = {
    ...detail,
    state: {
      ...detail.state,
      phase: "Listed",
      challengeEndsAt: omissionEnd,
      cases: [
        {
          wallet: alice,
          state: "Waiting",
          matched: false,
          matchEndsAt: matchEnd,
          depositWei: "30000000000",
          heldShareWei: "0",
          finalRuling: null,
        },
      ],
    },
    event: {
      ...detail.event,
      contractVersion: FAST + "-future",
      abiVersion: FAST + "-future",
      contractProfile: undefined,
    },
  };
  bootstrap = {
    ...bootstrap,
    contractVersion: FAST + "-future",
    contractProfile: undefined,
  };
  await visit("cases");
  await page.locator('[data-tx="match"]').click();
  await expect(page.locator("#toast")).toContainText("unsupported");
  check(
    draftReviews === 1 &&
      (await page
        .locator(".money-card")
        .filter({ hasText: "Unused deposit credit" })
        .count()) === 0,
    "Unknown version prefixes do not receive v8 features or reach financial draft preparation",
  );

  for (const version of ["truth-pays-v7", "kleros-event-v8"]) {
    detail = {
      ...detail,
      event: {
        ...detail.event,
        contractVersion: version,
        abiVersion: version,
        contractProfile: undefined,
      },
      state: { ...detail.state, phase: "Open", cases: [], challengeEndsAt: 0 },
    };
    bootstrap = {
      ...bootstrap,
      contractVersion: version,
      contractProfile: undefined,
    };
    await visit("organizer");
    await expect(page.locator("#testnet-banner strong")).toHaveText(
      "PUBLIC TESTNET",
    );
    await expect(page.locator("[data-test15m-notice]")).toHaveCount(0);
    await expect(page.locator("#attendance-review")).toContainText(
      "one-day omission challenge window",
    );
  }
  check(
    true,
    "Normal v7/v8 notices and one-day organizer wording remain unchanged",
  );
  detail = {
    ...detail,
    event: {
      ...detail.event,
      contractVersion: FAST,
      abiVersion: FAST,
      contractProfile: profile,
    },
    state: { ...detail.state, phase: "Listed", challengeEndsAt: omissionEnd },
  };
  bootstrap = { ...bootstrap, contractVersion: FAST, contractProfile: profile };
  await visit("cases");
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "The prominent fast-profile warning and exact deadlines fit the mobile viewport",
  );
  await fs.mkdir("artifacts/screenshots/test15m-ui", { recursive: true });
  await page.screenshot({
    path: "artifacts/screenshots/test15m-ui/mobile.png",
    fullPage: true,
  });
  check(
    errors.length === 0 &&
      unexpectedWrites.length === 0 &&
      external.length === 0,
    "Focused presentation checks produce no browser errors, unexpected writes, wallet sends or external calls",
  );
  await fs.writeFile(
    "artifacts/screenshots/test15m-ui/results.json",
    JSON.stringify(
      {
        mode: "local-v8-server-with-test15m-presentation-fixture",
        checks,
        draftReviews,
        unexpectedWrites,
        external,
        errors,
        limitation:
          "The one draft response is simulated; no fast contract deployment, signing, public RPC or lifecycle execution is claimed.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Test15m UI: ${checks.length} checks passed`);
} finally {
  await browser?.close();
  await server.close();
}
