// Current static frontend + synthetic loopback DTOs only. No auth, RPC or sends.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { isSelectedBootstrapQuery } from "./fixtures/selected-bootstrap-query.mjs";
import {
  makeLumaLaunchFixture,
  makeLumaParticipantDraft,
} from "./fixtures/luma-launch-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = "kleros-event-v10-uups";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const address = (digit) => "0x" + digit.repeat(40);
const hash = (digit) => "0x" + digit.repeat(64);
const sourceFiles = [
  "public/app.js",
  "public/contract-profiles.js",
  "public/environment.js",
  "public/luma-factory.js",
  "public/luma-setup.js",
];
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
function fixture(
  version,
  { renounced = false, invalid = null, caseView = false } = {},
) {
  const value = makeLumaLaunchFixture(caseView ? "unsettled" : "ready");
  if (version === 10) {
    const { bootstrap, detail } = value;
    const metadata = {
      ...bootstrap.contractProfile,
      contractVersion: profile,
      abiVersion: profile,
      version: 10,
      governanceKind: "single-owner-immediate",
      upgradeDelaySeconds: 0,
      renounceable: true,
    };
    Object.assign(bootstrap, {
      contractVersion: profile,
      abiVersion: profile,
      contractProfile: metadata,
      governance: {
        kind: "single-owner-immediate",
        initialOwner: address("2"),
        upgradeDelaySeconds: 0,
        renounceable: true,
      },
      features: { casePublication: false, originalCreationRecovery: false },
    });
    Object.assign(bootstrap.capabilities, {
      casePublication: false,
      originalCreationRecovery: false,
    });
    Object.assign(detail.event, {
      contractVersion: profile,
      abiVersion: profile,
      contractProfile: structuredClone(metadata),
    });
    detail.upgrade = {
      kind: "uups",
      version: 10,
      verified: true,
      governanceKind: "single-owner-immediate",
      implementation: address("a"),
      implementationCodeHash: hash("b"),
      authority: address("8"),
      authorityCodeHash: hash("c"),
      initialOwner: address("2"),
      owner: address(renounced ? "0" : "2"),
      pendingOwner: address("0"),
      upgradesDisabled: renounced,
      delaySeconds: 0,
      finalizationVerified: renounced,
      finalizationScope: "event",
    };
    detail.features = {
      casePublication: false,
      originalCreationRecovery: false,
    };
    if (detail.ownWallet?.deposit)
      detail.ownWallet.deposit.abiVersion = profile;
    if (invalid === "scope") detail.upgrade.finalizationScope = "factory";
    if (invalid === "missing") delete detail.upgrade.finalizationVerified;
    bootstrap.events = [structuredClone(detail.event)];
  }
  value.bootstrap.selectedEvent.detail = value.detail;
  return value;
}
async function assets() {
  const result = new Map();
  async function visit(directory, prefix = "") {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isDirectory())
        await visit(path.join(directory, item.name), name + "/");
      else if (mime[path.extname(name)])
        result.set(
          "/" + name,
          await fs.readFile(path.join(directory, item.name)),
        );
    }
  }
  await visit(path.join(root, "public"));
  result.set("/", result.get("/index.html"));
  return result;
}
function permitted(
  url,
  method,
  origin,
  names,
  eventId,
  setupFailure,
  body = null,
) {
  const target = new URL(url);
  if (target.origin !== origin) return false;
  if (method === "POST") {
    if (
      setupFailure ||
      target.search ||
      target.pathname !== "/api/events/" + eventId + "/drafts"
    )
      return false;
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      return false;
    }
    return (
      input &&
      Object.keys(input).sort().join() === "action,params" &&
      input.action === "deposit" &&
      input.params &&
      typeof input.params === "object" &&
      !Array.isArray(input.params) &&
      Object.keys(input.params).length === 0
    );
  }
  if (method !== "GET") return false;
  if (target.pathname === "/api/bootstrap")
    return setupFailure
      ? !target.search
      : isSelectedBootstrapQuery(target.searchParams, eventId);
  if (target.pathname === "/api/events/" + eventId) return !target.search;
  return names.has(target.pathname) && !target.search;
}
async function run() {
  const { chromium, expect } = await import("@playwright/test");
  const output = path.join(
    root,
    "artifacts/v10-app-context",
    new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(),
  );
  await fs.mkdir(output, { recursive: true });
  const staticAssets = await assets();
  const proof = {
    status: "running",
    checks: [],
    sourceSha256: {},
    requests: [],
    forbidden: [],
    external: [],
    errors: [],
    walletRequests: [],
    unsignedReviewPosts: 0,
    screenshots: [],
    limits: [
      "Synthetic DTO projections and static UI only; no actual receipt, authentication, chain, financial execution or adoption proof.",
      "EOA-only metadata remains required. No delegated financial eligibility is enabled or established.",
      "Only a synthetic unsigned deposit-draft POST is permitted; Confirm, validation, submitted hashes and wallet execution are never requested.",
      "Known-hash journals and canonical adoption are covered by separate unit/actual-local suites, not this unsigned-review harness.",
    ],
  };
  for (const name of sourceFiles)
    proof.sourceSha256[name] = sha(await fs.readFile(path.join(root, name)));
  proof.harnessSha256 = sha(await fs.readFile(fileURLToPath(import.meta.url)));
  let selected = fixture(9),
    setupFailure = false,
    origin,
    browser,
    page;
  const send = (res, status, body) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    let body = null;
    if (req.method === "POST") {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 256)
          return send(res, 413, {
            error: "Synthetic draft request exceeds its bounded review scope.",
          });
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString("utf8");
    }
    proof.requests.push({
      method: req.method,
      path: url.pathname,
      query: url.search,
    });
    if (
      !permitted(
        url,
        req.method,
        origin,
        staticAssets,
        selected.detail.event.id,
        setupFailure,
        body,
      )
    ) {
      proof.forbidden.push({ method: req.method, path: url.pathname });
      return send(res, 405, {
        error:
          "Synthetic fixture request is outside the reviewed read/unsigned-draft scope.",
      });
    }
    if (req.method === "POST") {
      proof.unsignedReviewPosts++;
      return send(res, 200, makeLumaParticipantDraft(selected));
    }
    if (url.pathname === "/api/bootstrap")
      return setupFailure
        ? send(res, 422, {
            error:
              "Synthetic unsupported wallet; no wallet or signature was requested.",
            code: "UNSUPPORTED_WALLET",
          })
        : send(res, 200, selected.bootstrap);
    if (url.pathname === "/api/events/" + selected.detail.event.id)
      return send(res, 200, selected.detail);
    res.writeHead(200, {
      "content-type": mime[path.extname(url.pathname)] ?? "text/html",
      "cache-control": "no-store",
    });
    res.end(staticAssets.get(url.pathname));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    origin = "http://127.0.0.1:" + server.address().port;
    for (const [url, method] of [
      [origin + "/api/events/x/drafts", "POST"],
      [origin + "/api/rpc", "POST"],
      ["https://outside.invalid/app.js", "GET"],
      [origin + "/api/session", "GET"],
    ])
      assert.equal(
        permitted(
          url,
          method,
          origin,
          staticAssets,
          selected.detail.event.id,
          false,
        ),
        false,
      );
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== origin) {
        proof.external.push({ origin: url.origin, method: request.method() });
        return route.abort();
      }
      if (
        !permitted(
          url,
          request.method(),
          origin,
          staticAssets,
          selected.detail.event.id,
          setupFailure,
          request.postData(),
        )
      ) {
        proof.forbidden.push({ path: url.pathname, method: request.method() });
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(() => {
      window.__v10ContextWalletRequests = [];
      window.ethereum = {
        request: async ({ method }) => {
          window.__v10ContextWalletRequests.push(method);
          throw Error("Wallet requests forbidden in this synthetic UI check");
        },
      };
      window.WebSocket = class {
        constructor() {
          throw Error("WebSockets forbidden in this synthetic UI check");
        }
      };
    });
    page = await context.newPage();
    page.on("pageerror", (error) => proof.errors.push(error.message));
    const visit = async (value) => {
      proof.walletRequests.push(
        ...(await page
          .evaluate(() => window.__v10ContextWalletRequests ?? [])
          .catch(() => [])),
      );
      selected = value;
      setupFailure = false;
      await page.goto(
        origin +
          "/#" +
          new URLSearchParams({
            event: selected.detail.event.id,
            view: "participant",
          }),
      );
      await page.reload(); // A fresh module/session projection for every synthetic DTO.
      await expect(page.locator("#content")).toBeVisible();
      await expect(page.locator("#loading")).toBeHidden();
      await expect(page.locator("[data-luma-launch]")).toBeVisible();
    };
    const details = async () => {
      const locator = page.locator("[data-production-details]").first();
      await locator.evaluate((node) => {
        for (let item = node; item; item = item.parentElement)
          if (item.tagName === "DETAILS") item.open = true;
      });
      return locator;
    };
    const snapshot = async (name) => {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
        "No horizontal overflow",
      );
      await page.screenshot({ path: path.join(output, name), fullPage: true });
      proof.screenshots.push(name);
    };
    const openReview = async () => {
      const freshReads = proof.requests.filter(
        (request) =>
          request.method === "GET" &&
          request.path === "/api/events/" + selected.detail.event.id,
      ).length;
      await page.locator('[data-tx="deposit"]').click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("[data-execute]")).toBeVisible();
      assert.equal(
        proof.requests.filter(
          (request) =>
            request.method === "GET" &&
            request.path === "/api/events/" + selected.detail.event.id,
        ).length,
        freshReads + 1,
        "Unsigned review rechecks the fresh event detail before rendering",
      );
      return dialog;
    };
    const closeReview = async (dialog) => {
      await dialog.locator("[data-close]").first().click();
      await expect(dialog).toBeHidden();
    };

    await visit(fixture(9));
    await expect(page.locator('[data-tx="deposit"]')).toBeEnabled();
    const v9 = await details();
    await expect(v9).toContainText("Pending governance operations");
    await expect(v9).toContainText("172800 seconds");
    await expect(v9).toContainText("48 hours");
    const v9Review = await openReview();
    await expect(v9Review.locator("[data-v10-review-governance]")).toHaveCount(
      0,
    );
    await expect(v9Review).toContainText("Signing wallet");
    await closeReview(v9Review);
    proof.checks.push(
      "V9 current timelock, deposit-readiness and unsigned review remain available without a V10 governance notice",
    );

    await visit(fixture(10));
    await expect(page.locator('[data-tx="deposit"]')).toBeEnabled();
    const active = await details();
    await expect(active).toContainText("V10 · immediate controller");
    await expect(active).toContainText(
      "Active · changes can take effect immediately",
    );
    assert.doesNotMatch(
      await active.innerText(),
      /48.hour|172800|Pending governance operations|Executing governance operations/i,
    );
    const activeReview = await openReview(),
      activeNotice = activeReview.locator("[data-v10-review-governance]");
    await expect(activeNotice).toBeVisible();
    await expect(activeNotice).toContainText(
      "The upgrade owner can change this contract and custody rules immediately, with no waiting period.",
    );
    assert.equal(
      await activeNotice.evaluate(
        (node) =>
          !!(
            node.compareDocumentPosition(
              node.closest("dialog").querySelector("[data-execute]"),
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
      true,
      "Immediate custody warning precedes Confirm in the actual dialog",
    );
    assert.doesNotMatch(await activeReview.innerText(), /48.hour|timelock/i);
    await snapshot("desktop-v10-active-review.png");
    await closeReview(activeReview);
    proof.checks.push(
      "V10 active authority has a visible immediate custody warning before Confirm in its actual unsigned review, without V9 timelock claims",
    );

    await visit(fixture(10, { renounced: true }));
    await page.setViewportSize({ width: 390, height: 844 });
    const renounced = await details();
    await expect(renounced).toContainText(
      "Renounced · verified for this event",
    );
    await expect(page.locator('[data-tx="deposit"]')).toBeEnabled();
    const renouncedReview = await openReview(),
      renouncedNotice = renouncedReview.locator("[data-v10-review-governance]");
    await expect(renouncedNotice).toBeVisible();
    await expect(renouncedNotice).toHaveText(
      "Upgrade authority is renounced for this verified event.",
    );
    assert.doesNotMatch(
      await renouncedNotice.innerText(),
      /can change|waiting period/i,
    );
    await snapshot("mobile-v10-renounced-review.png");
    await closeReview(renouncedReview);
    for (const invalid of ["scope", "missing"]) {
      await visit(fixture(10, { renounced: true, invalid }));
      await expect(
        page.locator('[data-launch-state="unavailable"]'),
      ).toBeVisible();
      assert.equal(
        await page.locator('[data-tx="deposit"]:enabled').count(),
        0,
      );
      await expect(await details()).toContainText(
        "Verified upgrade metadata is unavailable",
      );
    }
    proof.checks.push(
      "Only exact event-scoped verified renunciation is displayed; wrong/missing finalization blocks deposit review",
    );

    await visit(fixture(9, { caseView: true }));
    await expect(page.locator("[data-case-artifact]")).toHaveCount(1);
    await visit(fixture(10, { caseView: true }));
    await expect(page.locator(".case-card")).toHaveCount(1);
    await expect(page.locator("[data-case-artifact]")).toHaveCount(0);
    await expect(page.locator('a[href*="/recovery.html"]')).toHaveCount(0);
    // Exercise the actual error-feedback branch without wallet/auth calls.
    for (const version of [9, 10]) {
      await visit(fixture(version));
      setupFailure = true;
      await page.evaluate(() => {
        location.hash = "setup=kickback";
      });
      await expect(page.locator("[data-setup-feedback]")).toBeVisible();
      await expect(page.locator('a[href="/recovery.html"]')).toHaveCount(
        version === 9 ? 1 : 0,
      );
    }
    proof.checks.push(
      "V10 disabled case-publication and V9-only original-creation recovery entries stay hidden; V9 positive controls remain",
    );
    proof.walletRequests.push(
      ...(await page.evaluate(() => window.__v10ContextWalletRequests)),
    );
    assert.deepEqual(proof.walletRequests, []);
    assert.deepEqual(proof.errors, []);
    assert.deepEqual(proof.external, []);
    assert.deepEqual(proof.forbidden, []);
    assert.equal(proof.unsignedReviewPosts, 3);
    for (const name of sourceFiles)
      assert.equal(
        sha(await fs.readFile(path.join(root, name))),
        proof.sourceSha256[name],
        "Source changed during browser check",
      );
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure = { message: error.message, stack: error.stack };
    if (page)
      await page
        .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
        .catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    proof.completedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(output, "proof.json"),
      JSON.stringify(proof, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        { status: proof.status, checks: proof.checks.length, output },
        null,
        2,
      ),
    );
  }
}
if (process.argv.length === 3 && process.argv[2] === "--run-loopback")
  await run();
else if (process.argv.length === 2)
  console.log(
    JSON.stringify({
      status: "review-only",
      instruction: "--run-loopback for synthetic UI only",
      networkRequests: 0,
      walletRequests: 0,
      broadcasts: 0,
    }),
  );
else
  throw Error(
    "Only --run-loopback is accepted; no public origin/provider can be supplied",
  );
