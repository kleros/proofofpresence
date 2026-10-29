import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  LUMA_LAUNCH_EVENT_ID as eventId,
  LUMA_LAUNCH_URL as lumaUrl,
  LUMA_LAUNCH_HASH as hash,
  LUMA_LAUNCH_SCENARIOS,
  makeLumaLaunchFixture,
  makeLumaParticipantDraft,
  makeLumaSetupFixture,
  makeLumaFactoryDraft,
  LUMA_FACTORY_ADDRESS,
  LUMA_CREATED_EVENT_ID,
  LUMA_ATTENDANCE_STANDARD,
} from "./fixtures/luma-launch-fixture.mjs";
import { FIXTURE_WALLET as wallet } from "./fixtures/production-ui-fixture.mjs";

// TEST ONLY. No public URL accepted; no production runtime, RPC, keys or Luma API.
// Only the reviewed synthetic rejection/submission cases can enable a fake wallet send.
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "artifacts/luma-launch");
const sha = (value) => createHash("sha256").update(value).digest("hex");
function selfTest() {
  let cases = 0;
  for (const scenario of LUMA_LAUNCH_SCENARIOS) {
    const fixture = makeLumaLaunchFixture(scenario);
    assert.equal(fixture.bootstrap.capabilities.lumaDepositPortal, true);
    assert.equal(fixture.bootstrap.capabilities.walletFirstDeposits, true);
    for (const field of [
      "deposits",
      "unmatched",
      "imports",
      "attendance",
      "transactions",
    ])
      assert.deepEqual(fixture.detail[field], []);
    assert.equal(fixture.detail.personal, null);
    assert.deepEqual(
      fixture.detail.event.attendanceStandard,
      LUMA_ATTENDANCE_STANDARD,
    );
    assert.deepEqual(
      fixture.bootstrap.organizerSetup.attendanceStandard,
      LUMA_ATTENDANCE_STANDARD,
    );
    assert(
      fixture.detail.participants.every(
        (person) =>
          person.wallet === wallet &&
          !Object.hasOwn(person, "name") &&
          !Object.hasOwn(person, "email"),
      ),
    );
    if (["root", "anonymous"].includes(scenario))
      assert.equal(fixture.detail.ownWallet, null);
    if (scenario === "root") assert.deepEqual(fixture.bootstrap.events, []);
    else
      assert.equal(
        fixture.bootstrap.selectedEvent.detail.event.lumaUrl,
        lumaUrl,
      );
    if (["confirmed", "credit"].includes(scenario)) {
      assert.equal(fixture.detail.ownWallet.deposit.status, "confirmed");
      assert.equal(fixture.detail.ownWallet.deposit.hash, hash);
      assert(
        Number.isSafeInteger(fixture.detail.ownWallet.deposit.blockNumber),
      );
    }
    cases++;
  }
  const setupFixture = makeLumaSetupFixture();
  const creationDraft = makeLumaFactoryDraft(setupFixture.bootstrap, {
    title: "Synthetic attendance fixture",
    lumaUrl,
    startsAt: "2026-11-05T10:00:00.000Z",
    endsAt: "2026-11-05T12:00:00.000Z",
    timezone: "UTC",
    depositEth: "0.01",
  });
  assert.deepEqual(
    creationDraft.terms.attendanceStandard,
    LUMA_ATTENDANCE_STANDARD,
  );
  cases++;
  console.log(
    JSON.stringify(
      {
        status: "passed",
        fixtureCases: cases,
        networkRequests: 0,
        browserLaunches: 0,
        financialWalletCalls: 0,
      },
      null,
      2,
    ),
  );
}
async function run() {
  const { chromium, expect } = await import("@playwright/test");
  await fs.mkdir(out, { recursive: true });
  try {
    await fs.copyFile(
      path.join(root, "artifacts/production-ui/final-provenance.json"),
      path.join(out, "production-prior-checkpoint.json"),
    );
  } catch {}
  const result = {
    status: "running",
    checks: [],
    requests: [],
    forbidden: [],
    external: [],
    walletCalls: [],
    errors: [],
    screenshots: [],
    limits: [
      "Synthetic loopback projections only; Core's actual proxy/backend integration test remains a separate acceptance requirement.",
      "Fake wallet authentication uses a non-cryptographic signature literal. No real provider, Luma API, RPC, public request or transaction execution is available.",
    ],
  };
  const factoryMock = {
    enabled: false,
    draft: null,
    wrongCandidate: null,
    standardOverride: undefined,
  };
  const sender = {
    enabled: false,
    draft: null,
    overrideAmount: null,
    accounts: null,
    chain: null,
    sendCount: 0,
    receiptPhase: "pending",
    reject: false,
  };
  let selected = makeLumaLaunchFixture("root"),
    scene = "root",
    visitId = 0;
  const assets = new Map(),
    apiBase = `/api/events/${eventId}`;
  const send = (res, status, value) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost"),
      record = { method: req.method, path: url.pathname, query: url.search };
    result.requests.push(record);
    try {
      let body;
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        record.body = body;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/api/bootstrap" &&
        ((scene === "root" && !url.search) ||
          (url.searchParams.size === 1 &&
            url.searchParams.get("selectedEventId") ===
              selected.detail.event.id))
      )
        return send(res, 200, selected.bootstrap);
      if (
        req.method === "GET" &&
        url.pathname === `/api/events/${selected.detail.event.id}` &&
        !url.search
      )
        return send(res, 200, selected.detail);
      if (req.method === "POST" && url.pathname === "/api/auth/challenge") {
        assert.deepEqual(body, { wallet });
        return send(res, 200, {
          nonce: "synthetic-luma-launch-nonce",
          message: "SYNTHETIC LOCAL AUTH ONLY",
        });
      }
      if (req.method === "POST" && url.pathname === "/api/auth/verify") {
        assert.deepEqual(body, {
          nonce: "synthetic-luma-launch-nonce",
          signature: "SYNTHETIC_LUMA_NOT_A_REAL_SIGNATURE",
        });
        selected = makeLumaLaunchFixture("ready");
        scene = "ready";
        return send(res, 200, {
          wallet,
          label: "Fixture wallet",
          mode: "wallet",
        });
      }
      if (
        sender.enabled &&
        req.method === "POST" &&
        url.pathname === apiBase + "/drafts"
      ) {
        assert.deepEqual(body, { action: "deposit", params: {} });
        assert.equal(selected.detail.ownWallet.depositAction.eligible, true);
        sender.draft = makeLumaParticipantDraft(
          selected,
          sender.overrideAmount ? { amountWei: sender.overrideAmount } : {},
        );
        return send(res, 200, sender.draft);
      }
      const draftBase = apiBase + "/drafts/" + sender.draft?.id;
      if (
        sender.enabled &&
        req.method === "POST" &&
        url.pathname === draftBase + "/validate"
      ) {
        assert.deepEqual(body, {});
        return send(res, 200, sender.draft.transaction);
      }
      if (
        sender.enabled &&
        req.method === "POST" &&
        url.pathname === draftBase + "/submitted"
      ) {
        assert.deepEqual(body, { hash });
        selected = makeLumaLaunchFixture("submitted");
        scene = "submitted";
        return send(res, 200, {
          draftId: sender.draft.id,
          eventId,
          wallet,
          chainId: 1,
          contract: sender.draft.contract,
          action: "deposit",
          hash,
          status: "submitted",
        });
      }
      if (
        sender.enabled &&
        req.method === "POST" &&
        url.pathname === apiBase + "/submissions/reconcile"
      ) {
        assert.deepEqual(body, { draftId: sender.draft.id, hash });
        if (sender.receiptPhase === "confirmed") {
          selected = makeLumaLaunchFixture("confirmed");
          scene = "confirmed";
        }
        return send(res, 200, {
          draftId: sender.draft.id,
          eventId,
          wallet,
          chainId: 1,
          contract: sender.draft.contract,
          action: "deposit",
          hash,
          status: sender.receiptPhase,
          blockNumber: sender.receiptPhase === "confirmed" ? 111 : null,
          recovered: true,
        });
      }
      if (
        factoryMock.enabled &&
        req.method === "POST" &&
        url.pathname === "/api/organizer/events/drafts"
      ) {
        assert.deepEqual(
          Object.keys(body).sort(),
          [
            "title",
            "lumaUrl",
            "startsAt",
            "endsAt",
            "timezone",
            "depositEth",
          ].sort(),
        );
        factoryMock.draft = makeLumaFactoryDraft(selected.bootstrap, body);
        if (factoryMock.standardOverride === null)
          delete factoryMock.draft.terms.attendanceStandard;
        else if (factoryMock.standardOverride !== undefined)
          factoryMock.draft.terms.attendanceStandard = structuredClone(
            factoryMock.standardOverride,
          );
        return send(res, 200, factoryMock.draft);
      }
      const factoryPath =
        "/api/organizer/events/drafts/" + factoryMock.draft?.id;
      if (
        factoryMock.enabled &&
        req.method === "GET" &&
        url.pathname === factoryPath &&
        !url.search
      )
        return send(res, 200, factoryMock.draft);
      if (
        factoryMock.enabled &&
        req.method === "POST" &&
        url.pathname === factoryPath + "/reconcile"
      ) {
        assert.deepEqual(Object.keys(body), ["hash"]);
        if (body.hash === factoryMock.wrongCandidate)
          return send(res, 422, {
            code: "TX_MISMATCH",
            error: "Synthetic receipt does not belong to this factory event",
          });
        assert.equal(body.hash, hash);
        return send(res, 200, {
          hash,
          eventId: LUMA_CREATED_EVENT_ID,
          wallet,
          chainId: 1,
          blockNumber: 111,
          status: "confirmed",
          contract: "0x" + "7".repeat(40),
          participantUrl:
            origin +
            "/#" +
            new URLSearchParams({
              event: LUMA_CREATED_EVENT_ID,
              view: "participant",
            }),
        });
      }
      if (
        url.pathname.startsWith("/api/") ||
        !["GET", "HEAD"].includes(req.method)
      ) {
        result.forbidden.push(record);
        return send(res, 405, {
          error:
            "No financial, signup, organizer, RPC or Luma mutation endpoint exists in this fixture",
        });
      }
      const name =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
      if (
        name.split("/").some((x) => [".", "..", ""].includes(x)) ||
        name.includes("\\")
      )
        throw Error("Invalid static path");
      if (!assets.has(name))
        assets.set(name, await fs.readFile(path.join(root, "public", name)));
      const mime = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "content-type": mime[path.extname(name)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(assets.get(name));
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
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    await context.route("**/*", (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== origin) {
        result.external.push(request.url());
        return route.abort("blockedbyclient");
      }
      if (
        !["GET", "HEAD"].includes(request.method()) &&
        !(
          request.method() === "POST" &&
          (["/api/auth/challenge", "/api/auth/verify"].includes(url.pathname) ||
            (factoryMock.enabled &&
              (url.pathname === "/api/organizer/events/drafts" ||
                url.pathname ===
                  "/api/organizer/events/drafts/" +
                    factoryMock.draft?.id +
                    "/reconcile")) ||
            (sender.enabled &&
              (url.pathname === apiBase + "/drafts" ||
                url.pathname === apiBase + "/submissions/reconcile" ||
                ["validate", "submitted"].some(
                  (action) =>
                    url.pathname ===
                    apiBase + "/drafts/" + sender.draft?.id + "/" + action,
                )))) &&
          !url.search
        )
      ) {
        result.forbidden.push({ method: request.method(), path: url.pathname });
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await context.routeWebSocket("**/*", (route) => {
      result.forbidden.push({ method: "WebSocket", url: route.url() });
      route.close();
    });
    await context.exposeBinding("__launchWallet", (_source, method, params) => {
      result.walletCalls.push({ method, params });
      if (["eth_requestAccounts", "eth_accounts"].includes(method))
        return sender.accounts ?? [wallet];
      if (method === "eth_chainId") return sender.chain ?? "0x1";
      if (method === "personal_sign")
        return "SYNTHETIC_LUMA_NOT_A_REAL_SIGNATURE";
      if (method === "eth_sendTransaction" && sender.enabled && sender.draft) {
        sender.sendCount++;
        assert.equal(
          sender.sendCount,
          1,
          "A double click or reload replayed this synthetic wallet request",
        );
        const tx = sender.draft.transaction;
        assert.deepEqual(params, [
          {
            to: tx.to,
            from: tx.from,
            data: tx.data,
            value: "0x" + BigInt(tx.value).toString(16),
            chainId: "0x1",
          },
        ]);
        if (sender.reject)
          return {
            __fixtureError: {
              code: 4001,
              message: "Synthetic user rejected the wallet request",
            },
          };
        return hash;
      }
      result.forbidden.push({ method });
      throw Error(
        "No financial wallet method exists in this synthetic fixture",
      );
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.__launchCopied = value;
            if (window.__launchRejectCopy)
              throw Error("Synthetic clipboard denial");
          },
        },
      });
      window.ethereum = {
        request: async ({ method, params = [] }) => {
          const value = await window.__launchWallet(method, params);
          if (value?.__fixtureError)
            throw Object.assign(new Error(value.__fixtureError.message), {
              code: value.__fixtureError.code,
            });
          return value;
        },
        on() {},
        removeListener() {},
      };
    });
    page = await context.newPage();
    page.on("pageerror", (error) => result.errors.push(error.message));
    const visit = async (scenario, options = {}) => {
      scene = scenario;
      selected = makeLumaLaunchFixture(scenario, options);
      await page.goto(
        origin +
          "/?synthetic=" +
          ++visitId +
          (options.returnUrl
            ? "&returnUrl=" + encodeURIComponent(options.returnUrl)
            : "") +
          (scenario === "root"
            ? ""
            : "#" +
              new URLSearchParams({
                event: selected.detail.event.id,
                view: options.view ?? "participant",
              })),
      );
      await expect(page.locator("#content")).toBeVisible();
      await expect(page.locator("#loading")).toBeHidden();
    };
    const capture = async (name) => {
      await page.screenshot({
        path: path.join(out, name + ".png"),
        fullPage: false,
      });
      result.screenshots.push(name + ".png");
    };
    const noSignup = async () => {
      await expect(
        page.locator(
          'input[name="name"],input[name="email"],input[type="email"],.sidebar-events a,.sidebar-events button,[data-form="participate"],[data-form="signup"],.event-card,[data-personal],[data-fund-wallet],[data-advance],[data-ruling],[data-open-appeal]',
        ),
      ).toHaveCount(0);
      await expect(page.locator("#content")).not.toContainText(
        "Attend without a deposit",
      );
    };

    await visit("root");
    await expect(page.locator("[data-launch-root]")).toBeVisible();
    await noSignup();
    await expect(page.locator("#content")).toContainText(
      "Deposit for your event",
    );
    await expect(page.locator("#content")).toContainText("Set up kickback");
    await capture("root");
    pass(
      "Root offers only the event-deposit and organizer-setup entry points without a directory or signup/contact flow",
    );
    await visit("anonymous");
    await expect(page.locator("[data-luma-launch]")).toBeVisible();
    await noSignup();
    await expect(page.locator("[data-luma-launch]")).toContainText(
      selected.detail.event.title,
    );
    await expect(page.locator("[data-launch-return]")).toHaveCount(0);
    await capture("anonymous-cold-link");
    pass(
      "An anonymous cold event link opens the exact compact event and withholds Return to Luma before a canonical receipt",
    );

    await page.locator("[data-luma-launch] [data-connect-wallet]").click();
    await expect(page.locator("[data-launch-state]")).toHaveAttribute(
      "data-launch-state",
      "ready",
    );
    assert(result.walletCalls.some((call) => call.method === "personal_sign"));
    pass(
      "A cold-link wallet can authenticate using a fake ownership signature without a contact or signup record",
    );
    await visit("ready");
    await noSignup();
    await expect(page.locator('[data-tx="deposit"]')).toBeEnabled();
    await expect(page.locator("[data-launch-return]")).toHaveCount(0);
    pass(
      "An authenticated wallet without a participant/contact record can reach deposit review without signup",
    );
    for (const scenario of ["submitted", "failed"]) {
      await visit(scenario);
      await noSignup();
      await expect(page.locator("[data-launch-return]")).toHaveCount(0);
      await expect(page.locator("[data-launch-hash]")).toHaveValue(hash);
      await capture(scenario);
    }
    pass(
      "Submitted and failed receipts preserve their reference and do not authorize the Luma return action",
    );
    await visit("confirmed");
    await noSignup();
    await expect(page.locator("[data-launch-return]")).toHaveAttribute(
      "href",
      lumaUrl,
    );
    await expect(page.locator("[data-launch-hash]")).toHaveValue(hash);
    await expect(page.locator("[data-luma-launch]")).toContainText("0.01 ETH");
    await page.locator("[data-launch-copy]").click();
    assert.equal(await page.evaluate(() => window.__launchCopied), hash);
    await page.evaluate(() => (window.__launchRejectCopy = true));
    await page.locator("[data-launch-copy]").click();
    await expect(page.locator("[data-launch-hash]")).toBeFocused();
    assert.equal(
      await page
        .locator("[data-launch-hash]")
        .evaluate((input) =>
          input.value.slice(input.selectionStart, input.selectionEnd),
        ),
      hash,
    );
    await capture("confirmed");
    pass(
      "A canonical confirmed receipt exposes the full transaction reference and exact selected-event Luma URL without wallet/email/hash query additions",
    );

    await visit("confirmed", {
      returnUrl: "https://evil.invalid/?wallet=private",
    });
    await expect(page.locator("[data-launch-return]")).toHaveAttribute(
      "href",
      lumaUrl,
    );
    pass(
      "A query-supplied return URL cannot replace the selected event's canonical Luma URL",
    );

    for (const invalidUrl of [
      "javascript:alert(1)",
      "http://luma.com/wrong",
      "https://luma.com.evil.invalid/wrong",
      "https://user:secret@luma.com/wrong",
      "https://luma.com/wrong?wallet=leak",
      "https://luma.com/wrong#private",
      "https://other.invalid/event",
      "https://luma.com/with.dot",
    ]) {
      await visit("confirmed", { lumaUrl: invalidUrl });
      await expect(page.locator("[data-launch-return]")).toHaveCount(0);
    }
    pass(
      "Untrusted, credential-bearing and noncanonical return URLs never become Luma actions or automatic redirects",
    );

    for (const receiptPatch of [
      { wallet: "0x" + "3".repeat(40) },
      { eventId: "foreign-event" },
      { chainId: 10200 },
      { contract: "0x" + "7".repeat(40) },
      { abiVersion: "kleros-event-v8" },
      { hash: "invalid-hash" },
      { amountWei: null },
      { blockNumber: null },
    ]) {
      await visit("confirmed", { receiptPatch });
      await expect(page.locator("[data-launch-return]")).toHaveCount(0);
      await expect(page.locator('[data-tx="deposit"]')).toHaveCount(0);
    }
    pass(
      "Malformed or foreign wallet/event/chain/contract/ABI receipt stamps never enable Return to Luma or a fresh signing action",
    );

    await visit("credit");
    const activeDeposits = await page
      .locator('[data-tx="deposit"]')
      .evaluateAll(
        (nodes) =>
          nodes.filter((node) => !node.disabled && node.getClientRects().length)
            .length,
      );
    assert.equal(
      activeDeposits,
      0,
      "Existing full deposit credit must not prompt a duplicate deposit",
    );
    pass(
      "Existing full deposit credit does not prompt a duplicate contribution",
    );
    await visit("partial-credit");
    await expect(page.locator('[data-tx="deposit"]')).toBeEnabled();
    await expect(page.locator("[data-launch-state]")).toContainText(
      "0.005 ETH",
    );
    await expect(page.locator("[data-launch-return]")).toHaveCount(0);
    await visit("returned");
    await expect(page.locator('[data-tx="deposit"]')).toBeEnabled();
    await expect(page.locator("[data-launch-return]")).toHaveCount(0);
    await expect(page.locator("[data-launch-state]")).toHaveAttribute(
      "data-launch-state",
      "ready",
    );
    await visit("cancelled");
    await expect(page.locator('[data-tx="deposit"]')).toHaveCount(0);
    await expect(page.locator("[data-launch-return]")).toHaveCount(0);
    pass(
      "The exact backend-authorized remaining amount is shown; returned historical credit needs a fresh deposit and cancellation never offers a new one",
    );
    await visit("owed");
    await expect(page.locator('[data-recovery="claim"]')).toHaveCount(1);
    pass(
      "Canonical owed-credit recovery remains accessible from the compact participant view",
    );

    const unsupportedStandard = {
      ...LUMA_ATTENDANCE_STANDARD,
      attendanceRule: "unsupported-attendance-rule",
    };
    for (const attendanceStandard of [null, unsupportedStandard]) {
      await visit("ready", { attendanceStandard });
      await expect(page.locator('[data-tx="deposit"]')).toHaveCount(0);
      const beforePolicy = result.walletCalls.length;
      await page.locator("[data-luma-launch]").evaluate((host) => {
        const button = document.createElement("button");
        button.dataset.tx = "deposit";
        button.id = "synthetic-policy-control";
        button.textContent = "TEST ONLY stale deposit action";
        host.append(button);
      });
      await page.locator("#synthetic-policy-control").click();
      await expect(page.locator("#toast")).toContainText(
        /attendance.*standard/i,
      );
      assert.equal(result.walletCalls.length, beforePolicy);
      assert.deepEqual(result.forbidden, []);
      await visit("owed", { attendanceStandard });
      await page.locator(".luma-launch-recovery > summary").click();
      await page.locator('[data-recovery="claim"]').click();
      await expect(page.locator("#recovery-to")).toHaveValue(wallet);
      await page.keyboard.press("Escape");
    }
    pass(
      "Missing or unknown immutable attendance metadata blocks new deposit UI and stale prepare clicks while existing owed-payment recovery remains available",
    );

    await visit("organizer", { view: "organizer" });
    await noSignup();
    await expect(page.locator('[data-admission="minimal-peer"]')).toHaveCount(
      1,
    );
    await expect(
      page.locator(
        '[data-launch-register][data-launch-participant="minimal-peer"]',
      ),
    ).toHaveCount(1);
    await expect(page.locator('[data-checkin="minimal-peer"]')).toHaveCount(1);
    pass(
      "Organizer host approval, financial registration review and trusted check-in remain three explicit independent controls",
    );

    await visit("ready");
    await page.evaluate(
      ({ eventId, wallet, instanceId, contract, abiVersion }) => {
        sessionStorage.setItem(
          `kleros-ui-pending:${location.origin}:${instanceId}`,
          JSON.stringify([
            {
              id: "synthetic-wallet-prompt",
              draftId: "synthetic-unsigned",
              eventId,
              wallet,
              instanceId,
              contract,
              abiVersion,
              mode: "hosted-production",
              chainId: 1,
              action: "deposit",
              status: "awaiting-wallet",
            },
          ]),
        );
      },
      {
        eventId,
        wallet,
        instanceId: selected.bootstrap.instanceId,
        contract: selected.detail.event.contract,
        abiVersion: selected.detail.event.abiVersion,
      },
    );
    await page.reload();
    await expect(page.locator("#loading")).toBeHidden();
    await expect(page.locator("[data-launch-state]")).toHaveAttribute(
      "data-launch-state",
      "awaiting-wallet",
    );
    await expect(page.locator("[data-launch-state]")).toContainText(/wallet/i);
    await expect(page.locator("[data-launch-hash]")).toHaveCount(0);
    await expect(page.locator("[data-launch-return]")).toHaveCount(0);
    await expect(page.locator('[data-tx="deposit"]')).toHaveCount(0);
    await capture("awaiting-wallet-no-hash");
    pass(
      "An unanswered wallet prompt is distinct from a submitted transaction, has no receipt/hash claim and cannot open a duplicate review",
    );

    sender.enabled = true;
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await visit("partial-credit");
    sender.overrideAmount = "10000000000000000";
    await page.locator('[data-tx="deposit"]').click();
    await expect(page.locator("#toast")).toContainText(
      /amount|remaining|deposit/i,
    );
    await expect(page.locator("#execute-transaction")).toBeHidden();
    assert.equal(sender.sendCount, 0);
    sender.overrideAmount = null;
    pass(
      "A quote differing from the exact backend-authorized remaining amount cannot reach wallet execution",
    );
    for (const drift of [
      { accounts: ["0x" + "3".repeat(40)], label: "account" },
      { chain: "0x27d8", label: "chain" },
    ]) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await visit("ready");
      await page.locator('[data-tx="deposit"]').click();
      await expect(page.locator("#review-dialog")).toBeVisible();
      sender.accounts = drift.accounts ?? null;
      sender.chain = drift.chain ?? null;
      await page.locator("#execute-transaction").click();
      await expect(page.locator("#transaction-status")).toContainText(
        /wallet|network|chain|changed|differs/i,
      );
      assert.equal(
        sender.sendCount,
        0,
        "Wrong " + drift.label + " reached wallet send",
      );
      sender.accounts = null;
      sender.chain = null;
      await page.keyboard.press("Escape");
    }
    pass(
      "Wrong connected account and wallet network stop before any synthetic transaction request",
    );
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await visit("ready");
    sender.reject = true;
    await page.locator('[data-tx="deposit"]').click();
    await expect(page.locator("#review-dialog")).toBeVisible();
    await page.locator("#execute-transaction").click();
    await expect(page.locator("#transaction-status")).toContainText(/reject/i);
    assert.equal(sender.sendCount, 1);
    const journalRows = () =>
      page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith("kleros-transactions:v1:"))
          .flatMap(([, value]) => JSON.parse(value).transactions),
      );
    assert.deepEqual(await journalRows(), []);
    assert(!result.requests.some((r) => r.path.endsWith("/submitted")));
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-tx="deposit"]')).toBeEnabled();
    pass(
      "A deliberate4001 fake-wallet rejection creates no hash or submitted journal and offers a fresh review",
    );
    sender.reject = false;
    sender.sendCount = 0;
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await visit("ready");
    await page.locator('[data-tx="deposit"]').click();
    await expect(page.locator("#review-dialog")).toBeVisible();
    await expect(page.locator("#review-dialog")).toContainText("0.01 ETH");
    await expect(page.locator("#review-dialog")).toContainText(wallet);
    const policyReview = page.locator(
      "#review-dialog [data-attendance-standard]",
    );
    for (const phrase of [
      "in person or online",
      "No full-duration minimum",
      "Payment, a Luma RSVP or a personal mark alone is not attendance",
      "balance of probabilities",
      "24 hours after posting",
    ])
      await expect(policyReview).toContainText(phrase);
    await expect(page.locator("#review-dialog")).toContainText(
      selected.detail.event.contract,
    );
    await page.locator("#execute-transaction").dblclick();
    await expect.poll(() => sender.sendCount).toBe(1);
    await expect(page.locator("#transaction-status")).toContainText(
      /submitted|confirm|receipt/i,
    );
    assert.equal(sender.sendCount, 1);
    await expect.poll(async () => (await journalRows())[0]?.hash).toBe(hash);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-launch-return]")).toHaveCount(0);
    await expect(page.locator("[data-launch-hash]")).toHaveValue(hash);
    assert.equal((await journalRows())[0].hash, hash);
    sender.receiptPhase = "confirmed";
    selected = makeLumaLaunchFixture("confirmed");
    scene = "confirmed";
    await page.reload();
    await expect(page.locator("#loading")).toBeHidden();
    await expect(page.locator("[data-launch-return]")).toHaveAttribute(
      "href",
      lumaUrl,
    );
    assert.equal(sender.sendCount, 1);
    assert.equal((await journalRows())[0].status, "confirmed");
    pass(
      "One explicit synthetic wallet submission survives double click and pending receipt; reload checks the original hash and confirms without resend",
    );
    sender.enabled = false;
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    factoryMock.enabled = true;
    const visitSetup = async ({
      instance = "production-ui-loopback-only",
      actor = wallet,
      factory = LUMA_FACTORY_ADDRESS,
      attendanceStandard = LUMA_ATTENDANCE_STANDARD,
    } = {}) => {
      selected = makeLumaSetupFixture({ attendanceStandard });
      scene = "root";
      selected.bootstrap.instanceId = instance;
      selected.bootstrap.session.wallet = actor;
      selected.bootstrap.factory.address = factory;
      await page.goto(origin + "/?synthetic=" + ++visitId + "#setup=kickback");
      await expect(page.locator("#loading")).toBeHidden();
    };
    await visitSetup();
    await expect(page.locator("form[data-luma-form]")).toBeVisible();
    const form = page.locator("form[data-luma-form]");
    await form.locator('[name="title"]').fill("Synthetic organizer Luma event");
    await form.locator('[name="lumaUrl"]').fill(lumaUrl);
    await form.locator('[name="startsAt"]').fill("2026-11-05T10:00");
    await form.locator('[name="endsAt"]').fill("2026-11-05T12:00");
    await form.locator('[name="depositEth"]').fill("0.01");
    await form.locator('[data-luma-action="review"]').click();
    const setupDialog = page.locator("dialog[data-luma-dialog]");
    await expect(setupDialog).toBeVisible();
    await expect(setupDialog).toContainText("150 guests");
    await expect(setupDialog).toContainText("7 days");
    await expect(setupDialog).toContainText("1 day each");
    await expect(setupDialog).toContainText("0.01 ETH");
    await expect(setupDialog).toContainText(LUMA_FACTORY_ADDRESS);
    await expect(page.locator("[data-luma-attendance-standard]")).toContainText(
      "in person or online",
    );
    await expect(
      setupDialog.locator("[data-luma-review-attendance-standard]"),
    ).toContainText("24 hours after posting");
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press(index % 2 ? "Tab" : "Shift+Tab");
      assert(
        await setupDialog.evaluate((dialog) =>
          dialog.contains(document.activeElement),
        ),
      );
    }
    await capture("organizer-review");
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await setupDialog.evaluate(
        (dialog) => dialog.scrollWidth <= dialog.clientWidth,
      ),
    );
    await capture("organizer-review-mobile");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press("Escape");
    await expect(setupDialog).toBeHidden();
    assert.equal(
      result.walletCalls.filter((call) => call.method === "eth_sendTransaction")
        .length,
      2,
    );
    pass(
      "Organizer form reviews canonical policy, capacity, deadlines, amount and factory terms in a keyboard-contained native dialog; cancel has no wallet effect",
    );
    const canonicalFactoryDraft = structuredClone(factoryMock.draft);
    const beforePolicySetup = result.requests.filter(
      (r) => r.method === "POST" && r.path === "/api/organizer/events/drafts",
    ).length;
    for (const attendanceStandard of [null, unsupportedStandard]) {
      await visitSetup({ attendanceStandard });
      await expect(page.locator('[data-luma-action="review"]')).toBeDisabled();
    }
    assert.equal(
      result.requests.filter(
        (r) => r.method === "POST" && r.path === "/api/organizer/events/drafts",
      ).length,
      beforePolicySetup,
    );
    for (const override of [null, unsupportedStandard]) {
      await visitSetup();
      factoryMock.standardOverride = override;
      await form
        .locator('[name="title"]')
        .fill("Synthetic organizer Luma event");
      await form.locator('[name="lumaUrl"]').fill(lumaUrl);
      await form.locator('[name="startsAt"]').fill("2026-11-05T10:00");
      await form.locator('[name="endsAt"]').fill("2026-11-05T12:00");
      await form.locator('[name="depositEth"]').fill("0.01");
      await form.locator('[data-luma-action="review"]').click();
      await expect(page.locator("[data-luma-error]")).toContainText(
        /attendance|standard|policy/i,
      );
      await expect(page.locator("dialog[data-luma-dialog]")).toHaveCount(0);
    }
    factoryMock.standardOverride = undefined;
    factoryMock.draft = canonicalFactoryDraft;
    assert.equal(
      result.walletCalls.filter((call) => call.method === "eth_sendTransaction")
        .length,
      2,
    );
    pass(
      "Missing or unknown setup attendance metadata blocks creation before preparation; a missing or changed draft standard cannot enter review or request the wallet",
    );

    const originalInstance = "production-ui-loopback-only",
      newInstance = originalInstance + "-restarted";
    const markerKey = (instance) =>
      "kleros-factory-creation:v1:" +
      [
        instance,
        "hosted-production",
        1,
        LUMA_FACTORY_ADDRESS.toLowerCase(),
        wallet.toLowerCase(),
        "kleros-event-v9-uups",
      ]
        .map(encodeURIComponent)
        .join(":");
    const creationContext = (instance) => ({
      eventId: LUMA_CREATED_EVENT_ID,
      wallet,
      chainId: 1,
      contract: LUMA_FACTORY_ADDRESS,
      abiVersion: "kleros-event-v9-uups",
      mode: "hosted-production",
      instanceId: instance,
    });
    const factoryCalls = () =>
      result.requests.filter(
        (request) =>
          request.method === "POST" &&
          request.path.startsWith("/api/organizer/"),
      ).length;
    for (const instance of [originalInstance, newInstance]) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      const marker = {
        version: 1,
        draftId: factoryMock.draft.id,
        eventId: LUMA_CREATED_EVENT_ID,
        phase: "wallet-requested",
      };
      await page.evaluate(
        ({ key, marker }) => localStorage.setItem(key, JSON.stringify(marker)),
        { key: markerKey(originalInstance), marker },
      );
      const before = factoryCalls();
      await visitSetup({ instance });
      await expect(page.locator("[data-luma-recovery]")).toBeVisible();
      await expect(page.locator('[data-luma-action="new"]')).toHaveCount(0);
      await expect(page.locator("[data-luma-action=review]")).toHaveCount(0);
      assert.equal(factoryCalls(), before);
      factoryMock.wrongCandidate = "0x" + "8".repeat(64);
      await page.locator('[name="txHash"]').fill(factoryMock.wrongCandidate);
      await page.locator('[data-luma-action="reconcile"]').click();
      await expect(page.locator("[data-luma-error]")).toContainText(
        "does not belong",
      );
      assert.deepEqual(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)),
          markerKey(originalInstance),
        ),
        marker,
      );
      assert.deepEqual(await journalRows(), []);
      await page.locator('[name="txHash"]').fill(hash);
      await page.locator('[data-luma-action="reconcile"]').click();
      await expect(page.locator("[data-luma-created]")).toBeVisible();
      await expect(page.locator("[data-luma-deposit-link]")).toHaveValue(
        origin +
          "/#" +
          new URLSearchParams({
            event: LUMA_CREATED_EVENT_ID,
            view: "participant",
          }),
      );
      assert.equal((await journalRows())[0].hash, hash);
      assert.equal(
        result.walletCalls.filter(
          (call) => call.method === "eth_sendTransaction",
        ).length,
        2,
      );
      await expect(page.locator('[data-luma-action="new"]')).toBeVisible();
      await page.locator('[data-luma-action="new"]').click();
      await expect(page.locator("form[data-luma-form]")).toBeVisible();
      assert.equal((await journalRows())[0].status, "confirmed");
      assert.equal((await journalRows())[0].hash, hash);
      pass(
        "Unknown original setup hash in " +
          (instance === originalInstance ? "current" : "restarted") +
          " instance stays editable after a foreign candidate; only canonical manual reconciliation binds its journal and unlocks the exact share URL",
      );
    }
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    const knownMarker = {
      version: 1,
      draftId: factoryMock.draft.id,
      eventId: LUMA_CREATED_EVENT_ID,
      phase: "submitted",
      hash,
    };
    await page.evaluate(
      async ({ key, marker, scope }) => {
        localStorage.setItem(key, JSON.stringify(marker));
        const { createTransactionJournal } = await import(
          "/transaction-context.js"
        );
        createTransactionJournal(localStorage).record(scope, {
          hash: marker.hash,
          draftId: marker.draftId,
          action: "createEvent",
        });
      },
      {
        key: markerKey(originalInstance),
        marker: knownMarker,
        scope: creationContext(originalInstance),
      },
    );
    const beforeKnown = factoryCalls();
    await visitSetup({ instance: newInstance });
    await expect(page.locator("[data-luma-recovery]")).toContainText(hash);
    assert.equal(factoryCalls(), beforeKnown);
    await expect(page.locator("[data-luma-action=review]")).toHaveCount(0);
    for (const foreign of [
      { actor: "0x" + "3".repeat(40) },
      { factory: "0x" + "5".repeat(40) },
    ]) {
      await visitSetup({ instance: newInstance, ...foreign });
      await expect(page.locator("[data-luma-recovery]")).toHaveCount(0);
      await expect(page.locator("#content")).not.toContainText(hash);
    }
    await visitSetup({ instance: newInstance });
    await page.locator('[data-luma-action="reconcile"]').click();
    await expect(page.locator("[data-luma-created]")).toBeVisible();
    assert.equal(
      result.walletCalls.filter((call) => call.method === "eth_sendTransaction")
        .length,
      2,
    );
    pass(
      "Known submitted setup survives a server instance change without new draft/send or automatic requests; different wallets and factories expose no prior hash",
    );
    await page.locator('[data-luma-action="new"]').click();
    await expect(page.locator("form[data-luma-form]")).toBeVisible();
    assert.equal((await journalRows())[0].status, "confirmed");
    for (const phase of ["confirmed", "failed"]) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.evaluate(
        ({ key, marker }) => localStorage.setItem(key, JSON.stringify(marker)),
        { key: markerKey(originalInstance), marker: { ...knownMarker, phase } },
      );
      await visitSetup();
      await expect(page.locator('[data-luma-action="new"]')).toHaveCount(0);
      await expect(page.locator("[data-luma-created]")).toHaveCount(0);
    }
    pass(
      "Only a fresh canonical terminal receipt unlocks a second event; the new-form action preserves its terminal transaction journal and local terminal flags cannot bypass verification",
    );
    factoryMock.enabled = false;
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await visit("confirmed");
    const returnBounds = await page
      .locator("[data-launch-return]")
      .boundingBox();
    assert(
      returnBounds &&
        returnBounds.y >= 0 &&
        returnBounds.y + returnBounds.height <= 844,
      "Confirmed Return to Luma must be visible at390x844 without scrolling: " +
        JSON.stringify(returnBounds),
    );
    await expect(page.locator("[data-launch-hash]")).toHaveValue(hash);
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.body.scrollWidth <= innerWidth,
      ),
    );
    await capture("mobile-confirmed");
    await page.locator("[data-launch-copy]").click();
    assert.equal(await page.evaluate(() => window.__launchCopied), hash);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("[data-launch-return]").scrollIntoViewIfNeeded();
    await capture("mobile-confirmation-actions");
    const targets = await page
      .locator("[data-luma-launch] .button")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => n.getClientRects().length)
          .map((n) => ({
            label: n.textContent.trim(),
            width: n.getBoundingClientRect().width,
            height: n.getBoundingClientRect().height,
          })),
      );
    assert(
      targets.every((x) => x.width >= 44 && x.height >= 44),
      JSON.stringify(targets),
    );
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll("body,body *")].map((e) => [
        e,
        parseFloat(getComputedStyle(e).fontSize),
      ]);
      for (const [e, size] of sizes)
        if (e instanceof HTMLElement && Number.isFinite(size))
          e.style.setProperty("font-size", size * 2 + "px", "important");
    });
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.body.scrollWidth <= innerWidth,
      ),
    );
    await page.locator("[data-launch-return]").scrollIntoViewIfNeeded();
    await capture("mobile-200-text");
    pass(
      "Compact mobile confirmation reflows at390px and actual doubled text with44px action targets",
    );
    assert.deepEqual(result.forbidden, []);
    assert.deepEqual(result.external, []);
    assert.deepEqual(result.errors, []);
    result.status = "passed";
    console.log(
      JSON.stringify(
        {
          status: result.status,
          groups: result.checks.length,
          realFinancialSends: 0,
          syntheticWalletAttempts: result.walletCalls.filter(
            (call) => call.method === "eth_sendTransaction",
          ).length,
          syntheticSubmittedHashes: 1,
          publicRequests: 0,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    result.status = "failed";
    result.failure = { message: error.message, stack: error.stack };
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(out, "failure.png") })
        .catch(() => {});
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
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--self-test") selfTest();
else if (args.length === 1 && args[0] === "--run-loopback") await run();
else if (!args.length)
  console.log(
    "Prepared synthetic test. Run --self-test offline; browser only after ROOT source-ready. No public URL or send mode accepted.",
  );
else throw Error("Only --self-test or authorized --run-loopback accepted");
