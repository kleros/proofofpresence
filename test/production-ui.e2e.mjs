import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  PRODUCTION_UI_CONTRACT,
  PRODUCTION_SCENARIOS,
  FIXTURE_EVENT_ID,
  FIXTURE_WALLET,
  FIXTURE_CONTRACT,
  FIXTURE_OTHER,
  FIXTURE_ALTERNATE,
  FIXTURE_DEPOSIT_WEI,
  makeProductionFixture,
  invalidProductionFixture,
  recoveryOnlyProductionFixture,
  requireConfirmedProductionContract,
} from "./fixtures/production-ui-fixture.mjs";

// TEST ONLY. Core metadata is confirmed; ROOT app readiness is required before browser execution.
// Actual DOM + loopback mock HTTP; no app backend, RPC, chain or real signing key.
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "artifacts/production-ui");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const copy = (value) => structuredClone(value);
export function selfTest() {
  let checks = 0;
  assert.throws(
    () =>
      requireConfirmedProductionContract({
        ...PRODUCTION_UI_CONTRACT,
        confirmed: false,
      }),
    /awaiting exact core/,
  );
  checks++;
  for (const scenario of PRODUCTION_SCENARIOS) {
    const value = makeProductionFixture(scenario);
    assert.equal(value.bootstrap.chain.chainId, 1);
    assert.equal(value.bootstrap.chain.nativeCurrency.symbol, "ETH");
    assert.equal(value.bootstrap.chain.nativeCurrency.decimals, 18);
    assert.equal(
      value.detail.event.contractVersion,
      PRODUCTION_UI_CONTRACT.profile?.contractVersion ?? null,
      "Profile and ABI fields come only from the confirmed core fixture contract",
    );
    assert(
      value.detail.participants.every(
        (person) => person.wallet === FIXTURE_WALLET,
      ),
    );
    checks++;
  }
  const pending = makeProductionFixture("deposit-pending").detail;
  assert(
    pending.participants[0].deposit.verified &&
      !pending.participants[0].registered &&
      pending.participants[0].admission === "pending",
  );
  checks++;
  const credit = makeProductionFixture("unused-credit").detail;
  assert.equal(credit.ownWallet.pendingCreditWei, "2000000000000000");
  assert.equal(credit.state.poolWei, FIXTURE_DEPOSIT_WEI);
  checks++;
  const observed = makeProductionFixture("staff-observed").detail;
  assert.equal(observed.attendance.length, 1);
  assert.equal(observed.state.attendeeCount, 0);
  checks++;
  const waiting = makeProductionFixture("waiting").detail.state.cases[0];
  assert(
    waiting.state === "Waiting" &&
      waiting.localDisputeID === null &&
      waiting.finalRuling === null,
  );
  checks++;
  const matched = makeProductionFixture("matched-unruled").detail;
  assert.equal(matched.state.cases[0].finalRuling, null);
  assert.equal(matched.state.heldBackWei, FIXTURE_DEPOSIT_WEI);
  checks++;
  assert.equal(matched.state.cases[0].appeal.rewardsReady, false);
  assert.equal(matched.state.cases[0].appeal.withdrawableWei, null);
  checks++;
  const delivered = makeProductionFixture("final-unsettled").detail;
  assert.equal(delivered.state.cases[0].finalRuling, 1);
  assert.equal(delivered.state.cases[0].state, "Disputed");
  assert.equal(delivered.state.heldBackWei, FIXTURE_DEPOSIT_WEI);
  assert(
    !delivered.payments.transfers.some(
      (row) => row.wallet === FIXTURE_WALLET && row.successful,
    ),
  );
  checks++;
  const paid = makeProductionFixture("paid").detail,
    owed = makeProductionFixture("owed").detail;
  assert.equal(paid.state.cases[0].appeal, null);
  assert.equal(paid.state.cases[0].rewardsReady, true);
  checks++;
  assert.equal(paid.payments.attendancePaidWei, FIXTURE_DEPOSIT_WEI);
  assert.equal(paid.ownWallet.owedWei, "0");
  assert.equal(owed.payments.attendancePaidWei, "0");
  assert.equal(owed.ownWallet.owedWei, FIXTURE_DEPOSIT_WEI);
  assert.equal(owed.payments.transfers[0].successful, false);
  checks++;
  for (const quote of ["0", "3000000000000000"]) {
    const projected = makeProductionFixture("paid", { appealQuoteWei: quote })
      .detail.state.cases[0];
    assert.equal(projected.appeal.withdrawableWei, quote);
    assert.equal(projected.appeal.rewardsReady, true);
    checks++;
  }
  const conflicting = makeProductionFixture("paid", {
    appealQuoteWei: "0",
    readinessOverride: { case: true, appeal: false },
  }).detail.state.cases[0];
  assert.equal(conflicting.rewardsReady, true);
  assert.equal(conflicting.appeal.rewardsReady, false);
  checks++;
  const baseline = makeProductionFixture("before-deposit"),
    before = JSON.stringify(baseline);
  invalidProductionFixture(baseline, {
    bootstrap: { chain: { chainId: 2 } },
    event: { chainId: 2 },
  });
  assert.equal(JSON.stringify(baseline), before);
  checks++;
  for (const code of ["UPGRADE_TRUST_MISMATCH", "SELECTED_EVENT_UNAVAILABLE"]) {
    const recovery = recoveryOnlyProductionFixture(baseline, code);
    assert.deepEqual(recovery.bootstrap.events, []);
    assert.deepEqual(
      Object.keys(recovery.bootstrap.recoveryEvents[0]).sort(),
      ["id", "chainId", "contract", "contractVersion", "abiVersion"].sort(),
    );
    assert.equal(recovery.bootstrap.selectedEvent.detail, null);
    assert.equal(recovery.bootstrap.selectedEvent.error.code, code);
    assert.equal(JSON.stringify(baseline), before);
    checks++;
  }
  console.log(
    JSON.stringify(
      {
        status: "passed",
        checks,
        scope: "fixture shape and pending-contract guard only",
        coreContractConfirmed: PRODUCTION_UI_CONTRACT.confirmed,
        browserRuns: 0,
        networkRequests: 0,
        walletCalls: 0,
        financialActions: 0,
      },
      null,
      2,
    ),
  );
}
async function runLoopback(core) {
  requireConfirmedProductionContract(core);
  const { chromium, expect } = await import("@playwright/test");
  await fs.mkdir(out, { recursive: true });
  const result = {
    status: "running",
    checks: [],
    requests: [],
    forbidden: [],
    external: [],
    walletCalls: [],
    errors: [],
    screenshots: [],
    limitations: [
      "Loopback synthetic projections only; no production economics, ABI, governance, deployment or EOA policy is proved by mocked data.",
      "Auth challenge/verify and fresh-EOA denial are local typed mocks. personal_sign returns a non-cryptographic literal.",
      "All financial endpoints, wallet transaction methods, RPC, external requests and WebSockets are blocked. The explicit submission-reconciliation POST is an isolated read-only receipt mock.",
      "Contradictory-mode clicks prove prepare-time denial; no prepared financial draft or send-time contract interaction is exercised.",
    ],
  };
  let selected = makeProductionFixture("before-deposit", { core }),
    authFailure = false,
    nonceSerial = 0,
    detailError = null,
    reconcileFixture = null;
  const assets = new Map();
  const mime = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  const send = (res, status, value) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const record = { method: req.method, path: url.pathname };
    result.requests.push(record);
    try {
      if (req.method === "GET" && url.pathname === "/api/bootstrap")
        return send(res, 200, selected.bootstrap);
      if (
        req.method === "GET" &&
        url.pathname === `/api/events/${FIXTURE_EVENT_ID}`
      )
        return detailError
          ? send(res, 409, {
              error: detailError.message,
              code: detailError.code,
            })
          : send(res, 200, selected.detail);
      if (
        req.method === "POST" &&
        url.pathname ===
          `/api/events/${FIXTURE_EVENT_ID}/submissions/reconcile` &&
        reconcileFixture
      ) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        record.body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        assert.deepEqual(
          record.body,
          { draftId: reconcileFixture.draftId, hash: reconcileFixture.hash },
          "Only the recorded original submission may be reconciled",
        );
        return send(res, 200, reconcileFixture.response);
      }
      if (
        req.method === "POST" &&
        ["/api/auth/challenge", "/api/auth/verify"].includes(url.pathname)
      ) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (url.pathname === "/api/auth/challenge") {
          assert.equal(body.wallet, FIXTURE_WALLET);
          if (authFailure)
            return send(res, core.freshEOAFailure.status, {
              code: core.freshEOAFailure.code,
              error: core.freshEOAFailure.error,
            });
          return send(res, 200, {
            nonce: "synthetic-production-nonce-" + ++nonceSerial,
            message: "SYNTHETIC LOOPBACK AUTH ONLY; NO REAL SIGNATURE",
          });
        }
        assert.equal(body.signature, "SYNTHETIC_NOT_A_CRYPTOGRAPHIC_SIGNATURE");
        selected = makeProductionFixture("before-deposit", {
          core,
          mode: selected.bootstrap.mode,
          authenticated: true,
        });
        return send(res, 200, {
          wallet: FIXTURE_WALLET,
          label: "Fixture wallet",
          mode: "wallet",
        });
      }
      if (
        url.pathname.startsWith("/api/") ||
        !["GET", "HEAD"].includes(req.method)
      ) {
        result.forbidden.push(record);
        return send(res, 405, {
          error:
            "This test has no financial, registration, session, RPC or other mutation endpoint",
        });
      }
      const rel =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
      if (rel.includes("..") || rel.startsWith("."))
        throw Error("Invalid fixture asset path");
      if (!assets.has(rel))
        assets.set(rel, await fs.readFile(path.join(root, "public", rel)));
      res.writeHead(200, {
        "content-type": mime[path.extname(rel)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(assets.get(rel));
    } catch (error) {
      record.error = error.message;
      send(res, 500, { error: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser, page;
  const pass = (label) => result.checks.push(label);
  try {
    browser = await chromium.launch({ headless: true });
    for (const mode of core.modes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: "block",
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.origin !== origin) {
          result.external.push({
            method: request.method(),
            url: request.url(),
          });
          return route.abort("blockedbyclient");
        }
        if (
          !["GET", "HEAD"].includes(request.method()) &&
          !(
            request.method() === "POST" &&
            (["/api/auth/challenge", "/api/auth/verify"].includes(
              url.pathname,
            ) ||
              (reconcileFixture &&
                url.pathname ===
                  `/api/events/${FIXTURE_EVENT_ID}/submissions/reconcile`))
          )
        ) {
          result.forbidden.push({
            method: request.method(),
            path: url.pathname,
          });
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      await context.routeWebSocket("**/*", (route) => {
        result.forbidden.push({ method: "WebSocket", url: route.url() });
        route.close();
      });
      await context.exposeBinding(
        "__productionFixtureWallet",
        (_source, method, params) => {
          result.walletCalls.push({ method, params });
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [FIXTURE_WALLET];
          if (method === "eth_chainId") return "0x1";
          if (method === "personal_sign")
            return "SYNTHETIC_NOT_A_CRYPTOGRAPHIC_SIGNATURE";
          result.forbidden.push({ method });
          throw Error(
            "No wallet transaction or RPC method exists in this fixture",
          );
        },
      );
      await context.addInitScript(() => {
        window.ethereum = {
          request: ({ method, params = [] }) =>
            window.__productionFixtureWallet(method, params),
          on() {},
          removeListener() {},
        };
      });
      page = await context.newPage();
      page.on("pageerror", (error) => result.errors.push(error.message));
      const visit = async (
        scenario,
        {
          view = "participant",
          authenticated = true,
          invalid = null,
          errorCode = null,
          recoveryVariant = null,
          appealQuoteWei = undefined,
          readinessOverride = null,
        } = {},
      ) => {
        selected = makeProductionFixture(scenario, {
          core,
          mode,
          authenticated,
          appealQuoteWei,
          readinessOverride,
        });
        if (invalid) selected = invalidProductionFixture(selected, invalid);
        detailError = errorCode
          ? {
              status: 409,
              code: errorCode,
              message: "Synthetic event deployment verification is unavailable",
            }
          : null;
        if (detailError)
          selected.bootstrap.selectedEvent = {
            ...selected.bootstrap.selectedEvent,
            detail: null,
            error: detailError,
          };
        if (errorCode && recoveryVariant)
          selected = recoveryOnlyProductionFixture(
            selected,
            errorCode,
            recoveryVariant,
          );
        await page.goto(
          origin +
            "/?fixture=" +
            encodeURIComponent(scenario) +
            "&mode=" +
            encodeURIComponent(mode) +
            "&variant=" +
            encodeURIComponent(invalid?.name ?? "normal") +
            "&quote=" +
            encodeURIComponent(appealQuoteWei ?? "unknown") +
            "&error=" +
            encodeURIComponent(errorCode ?? "none") +
            "&recovery=" +
            encodeURIComponent(recoveryVariant ?? "summary") +
            "&readiness=" +
            encodeURIComponent(JSON.stringify(readinessOverride)) +
            "#" +
            new URLSearchParams({ event: FIXTURE_EVENT_ID, view }),
        );
        await expect(page.locator("#content")).toBeVisible();
        await expect(page.locator("#loading")).toBeHidden();
        if (!invalid && !errorCode)
          await expect(page.locator("#event-switch")).toHaveValue(
            FIXTURE_EVENT_ID,
          );
      };
      const openFacts = async () => {
        await page.locator(".status-details summary").click();
      };
      const fact = (label) =>
        page
          .locator(".state-fact")
          .filter({
            has: page.locator("dt", { hasText: new RegExp("^" + label + "$") }),
          })
          .locator("dd strong");
      const caseFact = (label) =>
        page
          .locator(".case-card .details-list > div")
          .filter({
            has: page.locator("dt", { hasText: new RegExp("^" + label + "$") }),
          })
          .locator("dd");
      const money = (label) =>
        page
          .locator(".money-card")
          .filter({
            has: page.locator(".stat-label", {
              hasText: new RegExp("^" + label + "$"),
            }),
          })
          .locator("strong");
      const cleanProduction = async () => {
        await expect(
          page.locator(
            "#identity-select,#dialog-identity,[data-identity],[data-fund-wallet],[data-advance],[data-ruling],[data-open-appeal],a[href*='/finance/']",
          ),
        ).toHaveCount(0);
        const visible = await page.locator("body").innerText();
        assert(
          !/test tokens|test XDAI|test ETH|valueless ETH|mock Court|choose demo identity|local demo identity/i.test(
            visible,
          ),
          "Demo/test-token claims leaked into production",
        );
      };
      const capture = async (name) => {
        const file = mode + "-" + name + ".png";
        await page.screenshot({ path: path.join(out, file), fullPage: false });
        result.screenshots.push(file);
      };
      await visit("before-deposit");
      await cleanProduction();
      await expect(page.locator('[data-tx="deposit"]')).toBeEnabled();
      const productionDetails = page
        .locator("[data-production-details]")
        .first();
      await productionDetails.locator("summary").click();
      await expect(productionDetails).toContainText(
        core.detailContext.upgrade.implementation,
      );
      await expect(productionDetails).toContainText(
        core.detailContext.upgrade.implementationCodeHash,
      );
      await expect(productionDetails).toContainText(
        core.detailContext.upgrade.authority,
      );
      await expect(productionDetails).toContainText(
        core.detailContext.upgrade.multisig,
      );
      await expect(productionDetails).toContainText("172800 seconds");
      await expect(productionDetails).toContainText(
        "not a guaranteed withdrawal window",
      );
      pass(
        mode +
          ": v9 deployment/governance metadata and the upgrade custody warning stay explicit",
      );
      await visit("deposit-pending");
      await openFacts();
      await expect(fact("Deposit receipt")).toContainText("0.01 ETH");
      await expect(fact("Admission")).toHaveText("Host decision pending");
      await expect(fact("Contract registration")).toHaveText(
        "Not registered on chain",
      );
      await expect(page.locator("#next-action-title")).toContainText(
        /admission pending/i,
      );
      await cleanProduction();
      await capture("deposit-pending");
      pass(
        mode +
          ": confirmed deposit stays distinct from admission and contract registration",
      );
      await visit("unused-credit");
      await openFacts();
      await expect(page.locator(".credit-summary strong")).toContainText(
        "0.002 ETH",
      );
      await expect(fact("Contract registration")).toHaveText(
        "Registered in this event contract",
      );
      await page.locator('[data-recovery="withdrawPending"]').first().click();
      await expect(page.locator("#recovery-amount")).toHaveValue("0.002");
      await expect(page.locator("#recovery-to")).toHaveValue(FIXTURE_WALLET);
      await page.keyboard.press("Escape");
      pass(
        mode +
          ": independent unused credit is available while committed principal remains registered",
      );
      await visit("staff-observed");
      await openFacts();
      await expect(fact("Staff check-in")).toHaveText(
        "Staff observation recorded",
      );
      await expect(fact("Financial attendance")).toHaveText(
        "Not established on chain",
      );
      await visit("attendance-listed");
      await openFacts();
      await expect(fact("Financial attendance")).toHaveText(
        "Included in on-chain attendance",
      );
      await expect(fact("Payout")).toHaveText("No direct payout recorded");
      pass(
        mode +
          ": registration, staff observation, financial attendance and delivered payment remain separate",
      );
      await visit("waiting", { view: "cases" });
      await expect(page.locator(".case-card h3")).toContainText(
        /waiting.*match/i,
      );
      await expect(caseFact("Resolver local ID")).toContainText(/not created/i);
      await expect(caseFact("Final ruling")).toHaveText("Not final");
      await visit("matched-unruled", { view: "cases" });
      await expect(caseFact("Resolver local ID")).toHaveText("7");
      await expect(caseFact("Arbitrator dispute ID")).toHaveText("1007");
      await expect(caseFact("Final ruling")).toHaveText("Not final");
      await expect(money("Reserved case shares")).toHaveText("0.01 ETH");
      await expect(page.locator('[data-tx="resolve"]')).toBeDisabled();
      await expect(page.locator('[data-tx="appealRewards"]')).toBeDisabled();
      await expect(page.locator("[data-appeal-withdrawable]")).toHaveText(
        "Pending · amount unavailable",
      );
      pass(
        mode +
          ": waiting and matched-unruled cases have distinct IDs, finality and held shares",
      );
      await expect(
        page.locator("[data-evidence-file],.case-card input[type=file]"),
      ).toHaveCount(0);
      const evidence = page
        .locator(".case-card details")
        .filter({ has: page.locator('form[data-form="evidence"]') });
      await evidence.locator(":scope > summary").click();
      await expect(evidence.locator('input[name="uri"]')).toBeVisible();
      await expect(evidence).toContainText("File uploads are unavailable here");
      pass(
        mode +
          ": production evidence keeps the URI review and removes unsupported local file uploads",
      );
      await visit("final-unsettled", { view: "cases" });
      await expect(caseFact("Final ruling")).toHaveText("1 · Attended");
      await expect(page.locator(".case-card h3")).toContainText(
        /settlement pending/i,
      );
      await expect(money("Reserved case shares")).toHaveText("0.01 ETH");
      await capture("final-unsettled");
      await visit("final-unsettled");
      await openFacts();
      await expect(fact("Payout")).toHaveText("No direct payout recorded");
      pass(
        mode +
          ": a delivered final1 remains unsettled/held and is never called a delivered participant payment",
      );
      await visit("paid");
      await openFacts();
      await expect(fact("Payout")).toHaveText("0.01 ETH directly paid");
      await visit("paid", { view: "cases" });
      await expect(page.locator('[data-tx="appealRewards"]')).toBeEnabled();
      await expect(page.locator("[data-appeal-withdrawable]")).toHaveText(
        "Amount requires a fresh actor quote",
      );
      pass(
        mode +
          ": resolved appeal-null readiness comes from the case, while an unquoted amount stays unavailable",
      );
      for (const [quote, text] of [
        ["0", "0 ETH"],
        ["3000000000000000", "0.003 ETH"],
      ]) {
        await visit("paid", { view: "cases", appealQuoteWei: quote });
        await expect(page.locator("[data-appeal-withdrawable]")).toHaveText(
          text,
        );
      }
      pass(
        mode +
          ": explicit actor reward quotes distinguish real zero/nonzero values from an unavailable amount",
      );
      for (const readiness of [
        { case: true, appeal: false },
        { case: false, appeal: true },
        { case: "true", appeal: true },
      ]) {
        await visit("paid", {
          view: "cases",
          appealQuoteWei: "0",
          readinessOverride: readiness,
        });
        await expect(page.locator('[data-tx="appealRewards"]')).toBeDisabled();
        await expect(page.locator("[data-appeal-withdrawable]")).toHaveText(
          "Pending · amount unavailable",
        );
      }
      pass(
        mode +
          ": conflicting or malformed readiness never authorizes an appeal reward claim",
      );
      await visit("owed");
      await openFacts();
      await expect(fact("Payout")).toHaveText("0.01 ETH still owed");
      await expect(
        page.locator(".participation-steps li").last(),
      ).not.toHaveClass(/complete/);
      await page.locator('[data-recovery="claim"]').first().click();
      await expect(page.locator("#recovery-to")).toHaveValue(FIXTURE_WALLET);
      await page.locator("#recovery-to").fill(FIXTURE_ALTERNATE);
      await expect(page.locator("#recovery-to")).toHaveValue(FIXTURE_ALTERNATE);
      await page.keyboard.press("Escape");
      await capture("owed");
      pass(
        mode +
          ": a failed payment stays owed and offers an alternate claim destination without submitting anything",
      );
      for (const invalid of core.invalidContexts) {
        await visit("before-deposit", { invalid });
        await expect(
          page.locator("#content [data-production-unavailable]").first(),
        ).toContainText(invalid.warning);
        const enabled = await page
          .locator("#content [data-tx],#content [data-recovery]")
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => node.getClientRects().length && !node.disabled)
              .map(
                (node) =>
                  node.getAttribute("data-tx") ??
                  node.getAttribute("data-recovery"),
              ),
          );
        assert.deepEqual(
          enabled,
          [],
          "Unverified production context enabled financial controls",
        );
      }
      pass(
        mode +
          ": malformed/unverified core context withholds financial signing actions",
      );
      // TEST ONLY tampering: handlers must reject chain1/v9 before any draft API,
      // even if a stale/incorrect environment made a control clickable.
      for (const contradictedMode of [
        "hosted-testnet",
        "local-demo",
        "unknown-mode",
      ]) {
        await visit("before-deposit", {
          invalid: {
            name: contradictedMode,
            bootstrap: { mode: contradictedMode },
          },
        });
        const startRequests = result.requests.length,
          startWallet = result.walletCalls.length;
        await page.locator("#content").evaluate((content) => {
          const button = document.createElement("button");
          button.id = "synthetic-tampered-deposit";
          button.dataset.tx = "deposit";
          button.textContent = "TEST ONLY: stale deposit control";
          content.append(button);
        });
        await page.locator("#synthetic-tampered-deposit").click();
        await expect(page.locator("#toast")).toContainText(
          "require the explicit verified production environment",
        );
        assert.equal(
          result.requests
            .slice(startRequests)
            .filter((row) => row.method === "POST").length,
          0,
        );
        assert.deepEqual(result.walletCalls.slice(startWallet), []);
        assert.deepEqual(result.forbidden, []);
      }
      pass(
        mode +
          ": authenticated chain1/v9 contexts in testnet, local-demo and unknown modes reject even tampered prepare controls without a draft or wallet call",
      );

      const reconcilePath = `/api/events/${FIXTURE_EVENT_ID}/submissions/reconcile`;
      const reconcileCount = () =>
        result.requests.filter((row) => row.path === reconcilePath).length;
      for (const [errorCode, digit] of [
        ["UPGRADE_TRUST_MISMATCH", "9"],
        ["SELECTED_EVENT_UNAVAILABLE", "8"],
      ]) {
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        await visit("before-deposit");
        const scope = {
          eventId: FIXTURE_EVENT_ID,
          wallet: FIXTURE_WALLET,
          chainId: 1,
          contract: FIXTURE_CONTRACT,
          abiVersion: core.profile.abiVersion,
          mode,
          instanceId: selected.bootstrap.instanceId,
        };
        const original = {
          hash: "0x" + digit.repeat(64),
          draftId: "synthetic-original-" + errorCode,
          action: "deposit",
        };
        await page.evaluate(
          async ({ scope, original }) => {
            const { createTransactionJournal } = await import(
              "/transaction-context.js"
            );
            createTransactionJournal(localStorage).record(scope, original);
          },
          { scope, original },
        );
        const journal = () =>
          page.evaluate(async (scope) => {
            const { createTransactionJournal } = await import(
              "/transaction-context.js"
            );
            return createTransactionJournal(localStorage).list(scope);
          }, scope);
        const initialJournal = await journal();
        const validResponse = {
          ...original,
          eventId: scope.eventId,
          wallet: scope.wallet,
          chainId: scope.chainId,
          contract: scope.contract,
          recovered: true,
          status: "confirmed",
          blockNumber: 111,
          verificationError: "Synthetic detail still unavailable",
        };
        reconcileFixture = { ...original, response: validResponse };
        const beforeError = reconcileCount();
        for (const recoveryVariant of [
          "malformed",
          "duplicate",
          "other-wallet",
          "selected-wallet-mismatch",
          "other-instance",
        ]) {
          const beforeRejected = reconcileCount();
          await visit("before-deposit", { errorCode, recoveryVariant });
          await expect(page.locator("[data-submitted-recovery]")).toHaveCount(
            0,
          );
          await expect(page.locator("#content")).not.toContainText(
            original.hash,
          );
          assert.equal(
            reconcileCount(),
            beforeRejected,
            "A rejected recovery identity must not request reconciliation",
          );
          assert.deepEqual(
            await journal(),
            initialJournal,
            "A rejected recovery context must preserve the original private journal",
          );
        }
        pass(
          mode +
            ": " +
            errorCode +
            " rejects malformed/duplicate recovery identities and foreign wallet/instance projections without exposing or mutating the saved journal",
        );
        await visit("before-deposit", {
          errorCode,
          recoveryVariant: "minimal",
        });
        await expect(page.locator("[data-submitted-recovery]")).toContainText(
          original.hash,
        );
        await expect(page.locator("[data-submitted-recovery]")).toContainText(
          FIXTURE_CONTRACT,
        );
        assert.equal(
          reconcileCount(),
          beforeError,
          "Error loading must never automatically reconcile a submission",
        );
        assert.deepEqual(
          await journal(),
          initialJournal,
          "A trust failure must preserve the durable submitted record",
        );
        assert.deepEqual(selected.bootstrap.events, []);
        assert.deepEqual(
          Object.keys(selected.bootstrap.recoveryEvents[0]).sort(),
          ["id", "chainId", "contract", "contractVersion", "abiVersion"].sort(),
        );
        await expect(page.locator("[data-submitted-recovery]")).toContainText(
          FIXTURE_EVENT_ID,
        );
        await expect(
          page.locator("[data-submitted-recovery]"),
        ).not.toContainText(selected.detail.event.title);
        const button = page.locator(
          `[data-reconcile-submission="${original.hash}"]`,
        );
        const status = page.locator(
          `[data-reconcile-status="${original.hash}"]`,
        );
        for (const bad of [
          { ...validResponse, wallet: FIXTURE_OTHER },
          { ...validResponse, blockNumber: null },
          { ...validResponse, draftId: "foreign-draft" },
          { ...validResponse, action: "claim" },
        ]) {
          reconcileFixture.response = bad;
          const before = reconcileCount();
          await button.click();
          await expect(status).toContainText(
            "did not match the original event transaction",
          );
          await expect(button).toBeEnabled();
          assert.equal(
            reconcileCount(),
            before + 1,
            "Exactly one read-only reconciliation request is permitted per explicit click",
          );
          assert.deepEqual(
            await journal(),
            initialJournal,
            "Malformed/foreign receipt must not mutate the original journal",
          );
        }
        reconcileFixture.response = validResponse;
        const beforeValid = reconcileCount();
        await button.click();
        await expect(status).toContainText(
          "Confirmed original transaction · block 111",
        );
        await expect(button).toBeEnabled();
        assert.equal(reconcileCount(), beforeValid + 1);
        const finalJournal = await journal();
        assert.equal(finalJournal[0].hash, original.hash);
        assert.equal(finalJournal[0].draftId, original.draftId);
        assert.equal(finalJournal[0].status, "confirmed");
        assert.equal(finalJournal[0].blockNumber, 111);
        await expect(page.locator("[data-submitted-recovery]")).toContainText(
          original.hash,
        );
        if (errorCode === "UPGRADE_TRUST_MISMATCH") {
          await capture("submitted-recovery");
          await page.setViewportSize({ width: 390, height: 844 });
          await page
            .locator("[data-submitted-recovery]")
            .scrollIntoViewIfNeeded();
          assert(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= innerWidth &&
                document.body.scrollWidth <= innerWidth,
            ),
            "Submitted hashes must reflow on mobile",
          );
          await capture("mobile-submitted-recovery");
          await page.evaluate(() => {
            const sizes = [...document.querySelectorAll("body,body *")].map(
              (element) => [
                element,
                parseFloat(getComputedStyle(element).fontSize),
              ],
            );
            for (const [element, size] of sizes)
              if (element instanceof HTMLElement && Number.isFinite(size))
                element.style.setProperty(
                  "font-size",
                  size * 2 + "px",
                  "important",
                );
          });
          assert(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= innerWidth &&
                document.body.scrollWidth <= innerWidth,
            ),
            "Submitted recovery must reflow at actual doubled text",
          );
          await page
            .locator(`[data-reconcile-submission="${original.hash}"]`)
            .scrollIntoViewIfNeeded();
          await capture("mobile-recovery-200-text");
          pass(
            mode +
              ": preserved full hashes and the recovery control reflow at 390px and actual doubled text",
          );
          await page.setViewportSize({ width: 1440, height: 1000 });
        }
        pass(
          mode +
            ": " +
            errorCode +
            " recovers the real scoped journal from minimal recoveryEvents with an empty normal catalog; only explicit reconciliation accepts an exact terminal receipt and rejects foreign/malformed responses",
        );
      }
      reconcileFixture = null;
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      authFailure = true;
      await visit("before-deposit", { authenticated: false });
      await page.locator("#top-identity").click();
      await cleanProduction();
      await expect(page.locator("#dialog-title")).toBeFocused();
      for (let n = 0; n < 6; n++) {
        await page.keyboard.press(n % 2 ? "Tab" : "Shift+Tab");
        assert(
          await page.evaluate(() =>
            document
              .querySelector("#review-dialog")
              .contains(document.activeElement),
          ),
        );
      }
      const denialStart = result.walletCalls.length;
      await page.locator("#review-dialog [data-connect-wallet]").click();
      await expect(page.locator("#toast")).toContainText(
        core.freshEOAFailure.expectedText ?? core.freshEOAFailure.error,
      );
      assert.equal(
        result.walletCalls
          .slice(denialStart)
          .filter((x) => x.method === "personal_sign").length,
        0,
      );
      await page.keyboard.press("Escape");
      await expect(page.locator("#top-identity")).toBeFocused();
      pass(
        mode +
          ": production identity dialog retains keyboard focus and restores its trigger on Escape",
      );
      pass(
        mode +
          ": the authoritative fresh EOA denial is surfaced before any signature",
      );
      authFailure = false;
      await visit("before-deposit", { authenticated: false });
      await page.locator("#top-identity").click();
      await page.locator("#review-dialog [data-connect-wallet]").click();
      await expect(page.locator("#top-identity")).toHaveText("Fixture wallet");
      await expect(page.locator(".identity-address")).toHaveText(
        FIXTURE_WALLET,
      );
      await cleanProduction();
      pass(
        mode +
          ": chain1 wallet authentication uses a fake personal-sign reply and never a transaction request",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await visit("owed");
      assert(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.body.scrollWidth <= innerWidth,
        ),
      );
      await capture("mobile-owed");
      await openFacts();
      await fact("Payout").scrollIntoViewIfNeeded();
      await capture("mobile-owed-status");
      await context.close();
    }
    assert.deepEqual(result.forbidden, []);
    assert.deepEqual(result.external, []);
    assert.deepEqual(result.errors, []);
    assert(
      result.walletCalls.every((x) =>
        [
          "eth_requestAccounts",
          "eth_accounts",
          "eth_chainId",
          "personal_sign",
        ].includes(x.method),
      ),
    );
    result.status = "passed";
    console.log(
      JSON.stringify(
        {
          status: result.status,
          checks: result.checks.length,
          scope: "loopback mocks only",
          financialActions: 0,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    result.status = "failed";
    result.failure = { message: error.message, stack: error.stack };
    if (page && !page.isClosed())
      try {
        await page.screenshot({ path: path.join(out, "failure.png") });
      } catch {}
    throw error;
  } finally {
    result.assetSha256 = Object.fromEntries(
      [...assets]
        .filter(([name]) => /\.(js|css|html)$/.test(name))
        .map(([name, bytes]) => [name, sha(bytes)]),
    );
    await fs.writeFile(
      path.join(out, "results.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
const argv = process.argv.slice(2);
if (argv.length === 1 && argv[0] === "--self-test") selfTest();
else if (argv.length === 1 && argv[0] === "--run-loopback")
  await runLoopback(PRODUCTION_UI_CONTRACT);
else if (!argv.length)
  console.log(
    JSON.stringify(
      {
        status: "prepared-awaiting-root-app-readiness",
        browserRuns: 0,
        networkRequests: 0,
        productionContractConfirmed: PRODUCTION_UI_CONTRACT.confirmed,
        pending: ["ROOT app-ready signal before loopback browser execution"],
        instruction:
          "Run --self-test now; --run-loopback only after ROOT confirms the core contract and app readiness.",
      },
      null,
      2,
    ),
  );
else
  throw Error(
    "Use --self-test or, only after ROOT readiness, --run-loopback. This test never accepts a public origin.",
  );
