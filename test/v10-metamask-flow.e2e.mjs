// Actual browser lifecycle on a fresh no-fork local Prague chain. Never a public
// endpoint, user wallet, eligibility override or financial Node shortcut.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isSelectedBootstrapQuery } from "./fixtures/selected-bootstrap-query.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROFILE = "kleros-event-v10-uups";
const D = 1000000000000n;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const number = (value) => Number(value);
const wei = (value) => BigInt(value);
const financialActions = new Set([
  "deposit",
  "register",
  "postAttendance",
  "challenge",
  "match",
  "release",
  "resolve",
]);
const sources = [
  "test/v10-metamask-flow.e2e.mjs",
  "test/fixtures/v10-metamask-flow-fixture.mjs",
  "test/fixtures/selected-bootstrap-query.mjs",
  "src/server.mjs",
  "src/workbench.mjs",
  "src/utils.mjs",
  "src/v10-factory-onboarding.mjs",
  "src/v10-mainnet-runtime.mjs",
  "src/v10-production-wallets.mjs",
  "src/v10-receipt-context.mjs",
  "src/v10-upgrade-verification.mjs",
  "src/v10-upgrade-artifacts.mjs",
  "src/v10-wallet-compatibility.mjs",
  "src/payments.mjs",
  "public/app.js",
  "public/environment.js",
  "public/contract-profiles.js",
  "public/luma-setup.js",
  "public/luma-factory.js",
  "public/v10-wallet-account.js",
  "public/transaction-context.js",
];
function posted(request) {
  try {
    return JSON.parse(request.postData() ?? "{}");
  } catch {
    return null;
  }
}
function allowed(request, origin, eventId) {
  const url = new URL(request.url()),
    method = request.method(),
    p = url.pathname;
  if (url.origin !== origin) return false;
  if (method === "GET") {
    if (p === "/api/bootstrap")
      return (
        !url.search ||
        isSelectedBootstrapQuery(url.searchParams, eventId)
      );
    if (url.search) return false;
    return (
      p === "/" ||
      p === "/api/public-catalog" ||
      /^\/[A-Za-z0-9_-]+\.(?:js|css|html)$/.test(p) ||
      /^\/assets\/[A-Za-z0-9_.-]+$/.test(p) ||
      /^\/api\/organizer\/events\/(?:jobs|drafts)\/[A-Za-z0-9_-]+$/.test(p) ||
      (!!eventId &&
        (p === "/api/events/" + eventId ||
          p === "/api/events/" + eventId + "/deposit-inbox" ||
          new RegExp(
            "^/api/events/" + eventId + "/submissions/0x[a-fA-F0-9]{64}$",
          ).test(p)))
    );
  }
  const body = posted(request);
  if (!body || url.search) return false;
  if (method === "PATCH")
    return (
      !!eventId &&
      new RegExp(
        "^/api/events/" + eventId + "/participants/[A-Za-z0-9_-]+$",
      ).test(p) &&
      Object.keys(body).length === 1 &&
      body.admission === "approved"
    );
  if (method !== "POST") return false;
  if (
    [
      "/api/auth/challenge",
      "/api/auth/verify",
      "/api/organizer/events/jobs",
    ].includes(p)
  )
    return true;
  if (/^\/api\/organizer\/events\/drafts\/[A-Za-z0-9_-]+\/submitted$/.test(p))
    return true;
  if (!eventId) return false;
  if (p === "/api/events/" + eventId + "/drafts")
    return (
      financialActions.has(body.action) &&
      Object.keys(body).sort().join() === "action,params"
    );
  if (p === "/api/events/" + eventId + "/checkins")
    return (
      body.source === "staff-door" &&
      typeof body.participantId === "string" &&
      typeof body.note === "string"
    );
  return (
    new RegExp(
      "^/api/events/" +
        eventId +
        "/drafts/[A-Za-z0-9_-]+/(?:validate|submitted)$",
    ).test(p) || p === "/api/events/" + eventId + "/submissions/reconcile"
  );
}
function gasAdjustedChange(before, after, actor) {
  return (
    wei(after.actors[actor].walletBalanceWei) -
    wei(before.actors[actor].walletBalanceWei) +
    wei(after.actors[actor].sentGasWei) -
    wei(before.actors[actor].sentGasWei)
  );
}
function phaseIs(snapshot, name) {
  return (
    snapshot.phase === name ||
    number(snapshot.phase) ===
      ["Open", "Listed", "Finalized", "Cancelled"].indexOf(name)
  );
}
function fact(page, label) {
  return page
    .locator(".luma-launch-recovery .details-list > div")
    .filter({
      has: page.locator("dt", { hasText: new RegExp("^" + label + "$") }),
    })
    .locator("dd");
}

export async function runV10MetaMaskFlow(options = {}) {
  assert.deepEqual(
    options,
    {},
    "No provider, account policy, key, clock or financial implementation override is accepted",
  );
  const { chromium, expect } = await import("@playwright/test"),
    { createV10MetaMaskFlowFixture } = await import(
      "./fixtures/v10-metamask-flow-fixture.mjs"
    );
  const out = path.join(
    ROOT,
    "artifacts/v10-metamask-flow",
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID(),
  );
  await fs.mkdir(out, { recursive: true });
  const proof = {
    schemaVersion: 1,
    kind: "actual-local-v10-metamask-lifecycle",
    status: "running",
    sourceBaseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim(),
    source: {},
    assets: {},
    checks: [],
    http: [],
    walletCalls: [],
    snapshots: {},
    screenshots: [],
    blocked: [],
    errors: [],
    publicNetworkRequests: 0,
    privateSigningFilesRead: 0,
    keysExposedToBrowser: 0,
    limits: [
      "Fresh local Anvil Prague chain1 without a fork. Actual app/account policy/contracts/source checks, native custody and canonical receipts are exercised; public runtime verification is injected locally.",
      "Alice and Bob are synthetic Node-held accounts, with real local EIP-7702 protocol designation and type4 protected-self execution. No extension or human wallet is controlled.",
      "Only the actual local clock and mock Court adjudication are controlled outside the rendered UI. Every financial action uses its rendered review and wallet flow.",
      "This is one attended ruling lifecycle, not a full ruling/appeal/security matrix, public jury decision, mainnet action or authorization to publish the candidate.",
    ],
  };
  const pass = (condition, label) => {
    assert(condition, label);
    proof.checks.push(label);
  };
  let fixture,
    browser,
    eventId = null,
    latestPage;
  const views = {};
  const bootstrapByActor = new Map();
  const snapshot = async (label) => {
    const result = await fixture.financialSnapshot(eventId);
    proof.snapshots[label] = result;
    return result;
  };
  const expand = async (page) =>
    page
      .locator("#content details")
      .evaluateAll((nodes) => nodes.forEach((node) => (node.open = true)));
  const refresh = async (actor) => {
    const page = views[actor].page;
    latestPage = page;
    await page.locator("#refresh").click();
    await expect(page.locator("#loading")).toBeHidden({ timeout: 30000 });
    await expect(page.locator("[data-luma-launch]")).toBeVisible();
    await expand(page);
  };
  const captures = async (label) => {
    const alice = views.alice.page,
      bob = views.bob.page;
    await alice.setViewportSize({ width: 1440, height: 1000 });
    await bob.setViewportSize({ width: 390, height: 844 });
    for (const [actor, page] of [
      ["alice", alice],
      ["bob", bob],
    ]) {
      await expand(page);
      await page.evaluate(() => scrollTo(0, 0));
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "No horizontal overflow",
      );
      const name = label + "-" + actor + ".png";
      await page.screenshot({ path: path.join(out, name), fullPage: true });
      proof.screenshots.push(name);
    }
  };
  try {
    fixture = await createV10MetaMaskFlowFixture();
    assert.equal(fixture.stats.accountPolicyDependencyOverrides, 0);
    assert.equal(fixture.stats.authorizationInstalledByActualType4, true);
    assert.equal(fixture.stats.walletCodeSetByCheat, false);
    for (const actor of ["alice", "bob"])
      assert.match(
        fixture.stats.actors[actor].authorizationHash,
        /^0x[0-9a-fA-F]{64}$/,
      );
    for (const name of sources)
      proof.source[name] = sha(await fs.readFile(path.join(ROOT, name)));
    browser = await chromium.launch({ headless: true });
    for (const actor of ["alice", "bob"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        timezoneId: "UTC",
        serviceWorkers: "block",
        reducedMotion: "reduce",
      });
      await context.route("**/*", async (route) => {
        const req = route.request(),
          url = new URL(req.url()),
          method = req.method();
        if (!allowed(req, fixture.origin, eventId)) {
          proof.blocked.push({ actor, method, pathname: url.pathname });
          return route.abort();
        }
        try {
          const response = await fixture.forward(url.pathname + url.search, {
            method,
            headers: req.headers(),
            body: req.postDataBuffer() ?? undefined,
            actor,
          });
          proof.http.push({
            actor,
            method,
            pathname: url.pathname,
            status: response.status,
          });
          const asset = !url.pathname.startsWith("/api/");
          if (asset) {
            const name =
              url.pathname === "/"
                ? "public/index.html"
                : "public" + url.pathname;
            const bytes = await fs.readFile(path.join(ROOT, name));
            assert.equal(
              sha(response.body),
              sha(bytes),
              "Served asset differs from current source",
            );
            proof.assets[name] = sha(bytes);
          } else if (
            url.pathname === "/api/bootstrap" &&
            response.status === 200
          )
            bootstrapByActor.set(actor, JSON.parse(response.body.toString()));
          const headers = Object.fromEntries(
            Object.entries(response.headers)
              .filter(
                ([key]) =>
                  ![
                    "connection",
                    "transfer-encoding",
                    "content-length",
                    "date",
                  ].includes(key),
              )
              .map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join("\n") : String(value),
              ]),
          );
          await route.fulfill({
            status: response.status,
            headers,
            body: response.body,
          });
        } catch {
          proof.errors.push({
            actor,
            stage: "actual-loopback-response",
            pathname: url.pathname,
          });
          await route.abort();
        }
      });
      await context.routeWebSocket("**/*", (socket) => {
        proof.blocked.push({ actor, method: "WebSocket" });
        socket.close();
      });
      const page = await context.newPage();
      views[actor] = { context, page };
      latestPage = page;
      page.on("pageerror", (error) =>
        proof.errors.push({ actor, stage: "page", name: error.name }),
      );
      await page.exposeBinding(
        "__v10FlowWallet",
        async ({ page: caller, frame }, request) => {
          assert.equal(caller, page);
          assert.equal(frame, page.mainFrame());
          proof.walletCalls.push({ actor, method: request.method });
          return fixture.wallet(request, page.url(), actor);
        },
      );
      await page.addInitScript(() => {
        window.ethereum = {
          request: (request) => window.__v10FlowWallet(request),
          on() {},
          removeListener() {},
          isMetaMask: true,
        };
      });
    }
    const alice = views.alice.page,
      bob = views.bob.page;
    await alice.goto(fixture.origin + "/#setup=kickback");
    await expect(
      alice.locator("#luma-setup [data-connect-wallet]"),
    ).toBeVisible();
    await alice.locator("#luma-setup [data-connect-wallet]").click();
    await expect(alice.locator("[data-luma-form]")).toBeVisible({
      timeout: 30000,
    });
    assert(
      same(
        bootstrapByActor.get("alice").session.wallet,
        fixture.actors.alice.address,
      ),
    );
    const start =
      Math.ceil(
        ((await fixture.provider.getBlock("latest")).timestamp + 3600) / 60,
      ) * 60;
    const title = "Synthetic V10 matched attendance lifecycle";
    for (const [selector, value] of [
      ["#luma-title", title],
      ["#luma-url", "https://luma.com/synthetic-v10-lifecycle"],
      ["#luma-start", new Date(start * 1000).toISOString().slice(0, 16)],
      ["#luma-end", new Date((start + 7200) * 1000).toISOString().slice(0, 16)],
      ["#luma-deposit", "0.000001"],
    ])
      await alice.locator(selector).fill(value);
    await alice.locator('[data-luma-action="review"]').click();
    await expect(alice.locator("dialog[data-luma-dialog]")).toBeVisible({
      timeout: 30000,
    });
    const creation = fixture.reviewedDraft("alice");
    assert.equal(creation.contractVersion, PROFILE);
    assert.equal(creation.terms.depositWei, String(D));
    await expect(alice.locator("[data-luma-review-publication]")).toContainText(
      "Public · Published",
    );
    await expect(
      alice.locator("dialog[data-luma-dialog] .luma-setup-notice"),
    ).toContainText(/immediately/i);
    fixture.armCreation(creation.id, "alice");
    await alice.locator('[data-luma-action="confirm"]').click();
    await expect(alice.locator("[data-luma-created]")).toBeVisible({
      timeout: 30000,
    });
    eventId = creation.eventId;
    await expect(alice.locator("[data-owned-event-row]")).toHaveCount(1, {
      timeout: 30000,
    });
    pass(
      fixture.savedState().events[0].deployment.contractVersion === PROFILE,
      "Alice creates and canonically adopts a real public V10 child through the actual protected-self UI flow",
    );

    const transact = async (actor, action, locator, assertDraft = () => {}) => {
      const page = views[actor].page;
      latestPage = page;
      await expand(page);
      await expect(locator).toBeEnabled({ timeout: 30000 });
      // Admission reloads the organizer DOM. Open the fresh disclosures after
      // eligibility is visible rather than relying on the replaced old nodes.
      await expand(page);
      await expect(locator).toBeVisible({ timeout: 30000 });
      await locator.click();
      const dialog = page.locator("#review-dialog");
      await expect(dialog.locator("[data-execute]")).toBeVisible({
        timeout: 30000,
      });
      const review = fixture.reviewedDraft(actor);
      assert.equal(review.action, action);
      assert.equal(review.eventId, eventId);
      assert(same(review.wallet, fixture.actors[actor].address));
      assertDraft(review);
      await expect(
        dialog.locator("[data-v10-review-governance]"),
      ).toBeVisible();
      await expect(
        dialog.locator("[data-v10-review-governance]"),
      ).toContainText(/custody rules immediately/i);
      fixture.armEventDraft(review.id, action, actor);
      await dialog.locator("[data-execute]").click();
      await expect
        .poll(
          () =>
            fixture
              .savedState()
              .events.find((row) => row.eventId === eventId)
              ?.transactions.find((tx) => tx.draftId === review.id)?.status,
          { timeout: 30000 },
        )
        .toBe("confirmed");
      await expect(dialog).not.toBeVisible({ timeout: 30000 });
      const sent = fixture.stats.sent.find((row) => row.draftId === review.id),
        receipt = await fixture.provider.getTransactionReceipt(sent.hash);
      assert(
        sent &&
          sent.type === 4 &&
          sent.outerValueWei === "0" &&
          receipt.status === 1,
      );
      assert.equal(sent.reviewedValueWei, review.valueWei);
      return { review, sent, receipt };
    };
    for (const actor of ["alice", "bob"]) {
      const page = views[actor].page;
      await page.goto(
        fixture.origin + "/#event=" + eventId + "&view=participant",
      );
      if (actor === "bob") {
        await page
          .locator("[data-luma-launch] [data-connect-wallet]")
          .first()
          .click();
        await expect(page.locator('[data-tx="deposit"]')).toBeEnabled({
          timeout: 30000,
        });
        assert(
          same(
            bootstrapByActor.get(actor).session.wallet,
            fixture.actors[actor].address,
          ),
        );
      }
      const before = await snapshot(actor + "-before-deposit");
      await transact(
        actor,
        "deposit",
        page.locator('[data-tx="deposit"]').first(),
        (review) => assert.equal(review.valueWei, String(D)),
      );
      const after = await snapshot(actor + "-deposited");
      assert.equal(gasAdjustedChange(before, after, actor), -D);
      assert.equal(after.actors[actor].pendingWei, String(D));
    }
    let current = await snapshot("both-deposited");
    pass(
      wei(current.eventBalanceWei) === 2n * D &&
        wei(current.pendingTotalWei) === 2n * D &&
        number(current.stakerCount) === 0,
      "Both actual coded-wallet deposits put native D into their own unadmitted credits; no registration is inferred from payment",
    );
    await alice.goto(fixture.origin + "/#event=" + eventId + "&view=organizer");
    await expect(alice.locator("#people-review")).toBeAttached({
      timeout: 30000,
    });
    await expand(alice);
    for (const actor of ["alice", "bob"]) {
      const row = alice
        .locator(`[data-batch-wallet="${fixture.actors[actor].address}" i]`)
        .first();
      await row.locator("select[data-admission]").selectOption("approved");
      const register = row.locator("[data-launch-register]");
      await transact("alice", "register", register, (review) =>
        assert.deepEqual(
          review.args[0].map((address) => address.toLowerCase()),
          [fixture.actors[actor].address.toLowerCase()],
        ),
      );
      await expand(alice);
    }
    current = await snapshot("both-registered");
    pass(
      number(current.stakerCount) === 2 &&
        current.pendingTotalWei === "0" &&
        wei(current.poolWei) === 2n * D,
      "Owner UI admission and separate signed registration commit both exact verified deposits without changing their principal",
    );
    await fixture.timeTo(start + 1);
    await refresh("alice");
    const aliceRow = alice
      .locator(`[data-batch-wallet="${fixture.actors.alice.address}" i]`)
      .first();
    await aliceRow.locator("[data-checkin]").click();
    await expect(alice.locator('form[data-form="checkin"]')).toBeVisible();
    await alice
      .locator('form[data-form="checkin"] [name="note"]')
      .fill(
        "Synthetic Alice actually observed during this local event interval",
      );
    await alice.locator('form[data-form="checkin"] .button-primary').click();
    await expect(aliceRow).toContainText("Check-in recorded", {
      timeout: 30000,
    });
    await transact(
      "alice",
      "postAttendance",
      alice.locator('[data-tx="postAttendance"]').first(),
      (review) =>
        assert.deepEqual(
          review.args[0].map((address) => address.toLowerCase()),
          [fixture.actors.alice.address.toLowerCase()],
        ),
    );
    current = await snapshot("attendance-posted");
    pass(
      phaseIs(current, "Listed") &&
        current.actors.alice.attended === true &&
        current.actors.bob.attended === false &&
        number(current.challengeEndsAt) > current.timestamp,
      "Only trusted Alice attendance is posted through UI, opening the actual contract challenge deadline for omitted registered Bob",
    );
    await refresh("bob");
    await transact(
      "bob",
      "challenge",
      bob.locator('[data-tx="challenge"]').first(),
    );
    current = await snapshot("bob-challenged");
    assert.equal(number(current.actors.bob.challenge.state), 1);
    await refresh("alice");
    await transact(
      "alice",
      "match",
      alice.locator('[data-tx="match"]').first(),
      (review) =>
        assert(same(review.params.wallet, fixture.actors.bob.address)),
    );
    const matched = await snapshot("matched-unruled");
    pass(
      number(matched.actors.bob.challenge.state) === 2 &&
        matched.actors.bob.challenge.isRuled === false &&
        wei(matched.actors.bob.directAttendancePaidWei) === 0n,
      "Alice matches Bob's real challenge through UI; the matched Court case is unruled and no Bob attendance payment is manufactured",
    );
    await fixture.timeTo(
      Math.max(
        number(matched.challengeEndsAt),
        number(matched.actors.bob.challenge.matchEndsAt),
      ) + 1,
    );
    await refresh("alice");
    const beforeOrdinary = await snapshot("before-ordinary");
    await transact(
      "alice",
      "release",
      alice.locator('[data-tx="release"]').first(),
    );
    const ordinary = await snapshot("ordinary-unruled");
    pass(
      phaseIs(ordinary, "Finalized") &&
        ordinary.actors.bob.challenge.isRuled === false &&
        wei(ordinary.actors.alice.directAttendancePaidWei) === D &&
        wei(ordinary.actors.bob.directAttendancePaidWei) === 0n &&
        wei(ordinary.heldBackWei) === D &&
        wei(ordinary.actors.bob.heldShareWei) === D &&
        ordinary.owedTotalWei === "0" &&
        gasAdjustedChange(beforeOrdinary, ordinary, "alice") === D &&
        gasAdjustedChange(beforeOrdinary, ordinary, "bob") === 0n,
      "Ordinary payout succeeds into delegated Alice while Bob's unruled matched case retains D; Finalized is ordinary-only, with no blanket freeze or owed transfer",
    );
    await refresh("alice");
    await refresh("bob");
    await expect(alice.locator("#content")).toContainText(
      "Ordinary batch processed",
    );
    await expect(bob.locator(".case-card")).toContainText(
      "Matched Court case open",
    );
    await expect(fact(bob, "Financial attendance")).toContainText(
      "Not established",
    );
    await captures("ordinary-unruled");
    const ruling = await fixture.controlledAttendedRuling(
      eventId,
      fixture.actors.bob.address,
    );
    proof.controlledCourt = ruling;
    const ruled = await snapshot("ruled-unsettled");
    pass(
      number(ruled.actors.bob.challenge.finalRuling) === 1 &&
        ruled.actors.bob.challenge.isRuled === true &&
        wei(ruled.heldBackWei) === D &&
        wei(ruled.actors.bob.directAttendancePaidWei) === 0n &&
        ruled.eventBalanceWei === ordinary.eventBalanceWei &&
        ruled.owedTotalWei === "0" &&
        gasAdjustedChange(ordinary, ruled, "bob") === 0n,
      "Controlled Court delivers attended ruling1 without event settlement or payment; Bob's D remains held and unpaid",
    );
    await refresh("alice");
    await refresh("bob");
    await expect(alice.locator(".case-card")).toContainText(
      "Final result available · settlement pending",
    );
    await expect(bob.locator(".case-card")).toContainText(
      "Final result available · settlement pending",
    );
    await expect(fact(bob, "Financial attendance")).toContainText(
      "Not established",
    );
    await captures("ruled-unsettled");
    const beforeSettle = await snapshot("before-settlement");
    const settledAction = await transact(
      "alice",
      "resolve",
      alice.locator('[data-tx="resolve"]').first(),
      (review) =>
        assert(same(review.params.wallet, fixture.actors.bob.address)),
    );
    const settled = await snapshot("settled");
    const operation = settled.operations.find((row) =>
        same(row.hash, settledAction.sent.hash),
      ),
      collateral = wei(operation.perActor.bob.collateralReceivedWei);
    pass(
      collateral > 0n &&
        collateral === wei(beforeSettle.challengeEscrowWei) &&
        wei(settled.actors.bob.directAttendancePaidWei) === D &&
        wei(settled.actors.alice.directAttendancePaidWei) === D &&
        number(settled.actors.bob.status) === 2 &&
        settled.actors.bob.attended === true &&
        number(settled.actors.bob.challenge.state) === 3 &&
        gasAdjustedChange(beforeSettle, settled, "bob") === D + collateral &&
        wei(operation.perActor.bob.attendancePaidWei) === D,
      "The SAME coded Bob depositor receives native attendance D at settlement; challenge-collateral proceeds are independently identified and never labeled attendance payout",
    );
    pass(
      [
        settled.heldBackWei,
        settled.owedTotalWei,
        settled.challengeEscrowWei,
        settled.pendingTotalWei,
        settled.eventBalanceWei,
        settled.actors.alice.owedWei,
        settled.actors.bob.owedWei,
        settled.actors.bob.heldShareWei,
      ].every((value) => wei(value) === 0n),
      "All current held, owed, unused-credit and challenge obligations are zero after successful same-wallet delivery",
    );
    assert.equal(
      wei(settled.managerBalanceWei),
      wei(ordinary.managerBalanceWei),
    );
    assert.equal(
      wei(settled.delegateBalanceWei),
      wei(ordinary.delegateBalanceWei),
    );
    await refresh("alice");
    await refresh("bob");
    await expect(alice.locator(".case-card")).toContainText(
      "Challenge settled",
    );
    await expect(bob.locator(".case-card")).toContainText("Challenge settled");
    await expect(fact(bob, "Financial attendance")).toContainText(
      "Included in contract attendance",
    );
    await expect(
      fact(bob, "Successful direct attendance payments"),
    ).toContainText("0.000001 ETH");
    await expect(fact(bob, "Still owed")).toHaveText("0 ETH");
    await captures("settled");
    const saved = fixture.savedState();
    for (const sent of fixture.stats.sent) {
      const original = saved.drafts.find(([id]) => id === sent.draftId)?.[1];
      assert(
        original &&
          same(original.submittedHash, sent.hash) &&
          same(original.confirmedHash, sent.hash),
      );
      assert(
        same(
          original.v10Intent.scope.wallet,
          fixture.actors[sent.actor].address,
        ),
      );
      assert.equal(original.v10Intent.scope.eventId, eventId);
      assert.equal(original.origin, fixture.origin);
      assert.equal(sent.type, 4);
      assert.equal(sent.outerValueWei, "0");
    }
    pass(
      fixture.stats.sent.length === 10 &&
        fixture.stats.authSignatures === 2 &&
        fixture.stats.actors.alice.authSignatures === 1 &&
        fixture.stats.actors.bob.authSignatures === 1 &&
        fixture.stats.backendSigningCalls === 0 &&
        fixture.stats.accountPolicyDependencyOverrides === 0,
      "Exactly two scoped actor nonce signatures and ten UI financial wallet calls retain their original type4 hashes with no backend signer",
    );
    pass(
      proof.blocked.length === 0 && proof.errors.length === 0,
      "Strict HTTP/asset/frame boundaries reject off-scope traffic; no page or external-service failure occurred",
    );
    proof.creation = {
      eventId,
      profile: PROFILE,
      contract: saved.events[0].deployment.contract,
      alice: fixture.actors.alice.address,
      bob: fixture.actors.bob.address,
    };
    proof.stats = structuredClone(fixture.stats);
    for (const [name, digest] of Object.entries({
      ...proof.source,
      ...proof.assets,
    }))
      assert.equal(
        sha(await fs.readFile(path.join(ROOT, name))),
        digest,
        "Source changed during lifecycle acceptance",
      );
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure = {
      name: error.name,
      code:
        typeof error.code === "string" ? error.code : "ACCEPTANCE_ASSERTION",
    };
    if (latestPage && !latestPage.isClosed())
      await latestPage
        .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
        .catch(() => {});
    throw error;
  } finally {
    if (fixture) {
      proof.stats = structuredClone(fixture.stats);
      proof.retainedHashes = (fixture.savedState()?.drafts ?? []).map(
        ([, draft]) => ({
          id: draft.id,
          action: draft.action,
          wallet: draft.wallet,
          eventId: draft.eventId,
          submittedHash: draft.submittedHash ?? null,
          confirmedHash: draft.confirmedHash ?? null,
        }),
      );
    }
    await browser?.close();
    await fixture?.close();
    await fs.writeFile(
      path.join(out, "proof.json"),
      JSON.stringify(proof, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        status: proof.status,
        checks: proof.checks.length,
        proofPath: path.join(out, "proof.json"),
      }),
    );
  }
  return proof;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length === 2)
    console.log(
      JSON.stringify({
        status: "review-only",
        instruction: "--run-loopback only after Root GO",
        networkRequests: 0,
        signatures: 0,
        walletRequests: 0,
        broadcasts: 0,
      }),
    );
  else if (process.argv.length === 3 && process.argv[2] === "--run-loopback")
    await runV10MetaMaskFlow();
  else
    throw Error(
      "Only explicit local-only --run-loopback is accepted; no RPC, key or policy override options exist",
    );
}
