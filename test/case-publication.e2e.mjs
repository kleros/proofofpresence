import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  makeCaseEnvelope,
  caseScope,
  expectedCaseContext,
  makePublicationAppFixture,
  CASE_EVENT_ID,
  CASE_CHILD,
  CASE_CHALLENGER,
  CASE_INSTANCE,
  CORE_PUBLICATION_SOURCE_SHA256,
} from "./fixtures/case-publication-fixture.mjs";

// TEST ONLY: exact-byte fixtures and loopback mocks, never a real uploader/gateway.
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "artifacts/case-publication");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => structuredClone(value);
async function selfTest() {
  const { validateCaseArtifact, publicationActions } = await import(
    "../public/case-publication.js"
  );
  let checks = 0;
  const value = makeCaseEnvelope(),
    expected = expectedCaseContext();
  const original = JSON.stringify(value),
    validated = await validateCaseArtifact(value, expected);
  assert.deepEqual(validated, value);
  assert.equal(JSON.stringify(value), original);
  assert.notEqual(validated, value);
  assert(Object.isFrozen(validated.artifact.scope));
  assert.equal(validated.artifact.scope.matched, false);
  assert.equal(validated.artifact.scope.localDisputeID, null);
  assert.equal(validated.currentCase.localDisputeID, "0");
  checks++;
  const mutations = [
    (v) => (v.artifact.content += " "),
    (v) => (v.artifact.sha256 = "0".repeat(64)),
    (v) => (v.artifact.scopeHash = "0".repeat(64)),
    (v) => v.artifact.byteLength++,
    (v) =>
      (v.artifact.uri = makeCaseEnvelope({
        content: '{"other":"bytes"}',
      }).artifact.uri),
    (v) => (v.artifact.version = "1"),
    (v) => (v.artifact.extra = true),
    (v) => (v.artifact.scope.eventId = "foreign"),
    (v) => (v.currentCase.wallet = "0x" + "3".repeat(40)),
    (v) => (v.currentCase.instanceId = "other-instance"),
    (v) => (v.currentCase.blockNumber = 0),
    (v) => (v.currentCase.localDisputeID = "00"),
    (v) => (v.currentCase.arbitratorDisputeID = 0),
    (v) => (v.publication.scopeHash = "0".repeat(64)),
    (v) => (v.publication.sha256 = "0".repeat(64)),
    (v) => v.publication.byteLength++,
    (v) => (v.publication.uri = "/ipfs/foreign"),
  ];
  for (const mutate of mutations) {
    const bad = clone(value);
    mutate(bad);
    await assert.rejects(() => validateCaseArtifact(bad, expected));
    checks++;
  }
  for (const uploadAttempted of [false, true]) {
    const record = makeCaseEnvelope({
      status: "availability-unconfirmed",
      uploadAttempted,
    });
    await validateCaseArtifact(record, expected);
    assert.equal(
      publicationActions(record.publication).canPublish,
      !uploadAttempted,
    );
    checks++;
  }
  for (const flags of [
    { canPublish: true },
    { uploadAttempted: false },
    { canPublish: true, uploadAttempted: true },
    { canPublish: false, uploadAttempted: false },
  ]) {
    const record = makeCaseEnvelope();
    delete record.publication.canPublish;
    delete record.publication.uploadAttempted;
    Object.assign(record.publication, flags);
    const result = await validateCaseArtifact(record, expected);
    assert.equal(publicationActions(result.publication).canPublish, false);
    assert.equal(publicationActions(result.publication).canVerify, true);
    checks++;
  }
  const matched = caseScope();
  const changedIds = makeCaseEnvelope({
    historical: false,
    original: matched,
    current: { ...matched, arbitratorDisputeID: "1" },
  });
  await assert.rejects(() => validateCaseArtifact(changedIds, expected));
  checks++;
  const verified = makeCaseEnvelope({
    status: "verified",
    uploadAttempted: false,
  });
  assert.equal(publicationActions(verified.publication).canPublish, false);
  checks++;
  console.log(
    JSON.stringify(
      {
        status: "passed",
        checks,
        networkRequests: 0,
        browserLaunches: 0,
        coreFixtureSourceSha256: CORE_PUBLICATION_SOURCE_SHA256,
      },
      null,
      2,
    ),
  );
}
async function run() {
  const { chromium, expect } = await import("@playwright/test");
  await fs.mkdir(out, { recursive: true });
  const result = {
    status: "running",
    checks: [],
    requests: [],
    forbidden: [],
    external: [],
    providerRequests: [],
    errors: [],
    screenshots: [],
    limits: [
      "Synthetic local HTTP fixtures only. No real upload, gateway, Court, RPC, wallet, contract or publication service is invoked.",
      "The exact fixture content/CID was independently compared to Core's pure prepareCaseArtifact helper; actual backend transport behavior remains a separate Core acceptance requirement.",
    ],
  };
  const assets = new Map();
  let identity = {
      eventId: CASE_EVENT_ID,
      contract: CASE_CHILD,
      instanceId: CASE_INSTANCE,
      actorWallet: CASE_CHALLENGER,
    },
    selected,
    current = caseScope(),
    envelope = makeCaseEnvelope(),
    uploadAttempted = false,
    publishResult = "published-unverified",
    availabilityResult = "verified",
    badArtifact = null,
    gate = null,
    releaseArtifact = null,
    serial = 0;
  const apiCase = () =>
    `/api/events/${identity.eventId}/cases/${CASE_CHALLENGER}`;
  const send = (res, status, body) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const setStatus = (status) => {
    envelope = {
      ...envelope,
      currentCase: clone(current),
      publication: {
        ...envelope.publication,
        status,
        uploadAttempted,
        canPublish: !uploadAttempted,
      },
    };
    return envelope;
  };
  const configure = (options = {}) => {
    identity = {
      eventId: CASE_EVENT_ID,
      contract: CASE_CHILD,
      instanceId: CASE_INSTANCE,
      actorWallet: CASE_CHALLENGER,
      ...options,
    };
    current = caseScope({
      ...identity,
      wallet: CASE_CHALLENGER,
      matched: options.stage !== "waiting",
    });
    envelope = makeCaseEnvelope({
      current,
      status: options.status ?? "exported",
      uploadAttempted: options.uploadAttempted ?? false,
    });
    uploadAttempted = options.uploadAttempted ?? false;
    badArtifact = null;
    selected = makePublicationAppFixture({
      ...identity,
      stage: options.stage ?? "matched",
      publication: options.listed
        ? envelope.publication
        : { status: "unpublished", uploadAttempted: false, canPublish: true },
      legacy: options.legacy ?? false,
    });
    const item = selected.detail.state.cases[0];
    if (item) item.caseURI = envelope.artifact.uri;
  };
  configure();
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
        url.searchParams.size === 1 &&
        url.searchParams.get("selectedEventId") === identity.eventId
      )
        return send(res, 200, selected.bootstrap);
      if (
        req.method === "GET" &&
        url.pathname === `/api/events/${identity.eventId}` &&
        !url.search
      )
        return send(res, 200, selected.detail);
      if (
        req.method === "POST" &&
        url.pathname === `/api/events/${identity.eventId}/drafts`
      ) {
        assert(["challenge", "match"].includes(body.action));
        return send(res, 422, {
          code: "SYNTHETIC_STOP",
          error: "Synthetic financial review stopped before any wallet request",
        });
      }
      if (req.method === "POST" && url.pathname === apiCase() + "/artifact") {
        assert.deepEqual(body, {});
        const response = clone(badArtifact ?? envelope);
        if (gate) {
          const activeGate = gate;
          gate = null;
          await activeGate;
        }
        return send(res, 200, response);
      }
      if (req.method === "POST" && url.pathname === apiCase() + "/publish") {
        assert.deepEqual(body, {
          sha256: envelope.artifact.sha256,
          scopeHash: envelope.artifact.scopeHash,
        });
        assert.equal(
          uploadAttempted,
          false,
          "Repeated upload attempt reached transport",
        );
        uploadAttempted = true;
        return send(res, 200, setStatus(publishResult));
      }
      if (
        req.method === "POST" &&
        url.pathname === apiCase() + "/availability"
      ) {
        assert.deepEqual(body, {});
        return send(res, 200, setStatus(availabilityResult));
      }
      if (
        url.pathname.startsWith("/api/") ||
        !["GET", "HEAD"].includes(req.method)
      ) {
        result.forbidden.push(record);
        return send(res, 405, {
          error:
            "Only the isolated publication mock and stopped financial quote are available",
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
        throw Error("Invalid local asset path");
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
  const count = (action) =>
    result.requests.filter(
      (record) =>
        record.method === "POST" && record.path.endsWith("/" + action),
    ).length;
  const publicationCount = () =>
    result.requests.filter(
      (record) =>
        record.method === "POST" &&
        /\/(artifact|publish|availability)$/.test(record.path),
    ).length;
  const pass = (label) => result.checks.push(label);
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
      reducedMotion: "reduce",
      acceptDownloads: true,
    });
    await context.route("**/*", (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== origin) {
        result.external.push(request.url());
        return route.abort("blockedbyclient");
      }
      const actionPath = `/api/events/${identity.eventId}/cases/${CASE_CHALLENGER}`;
      if (
        !["GET", "HEAD"].includes(request.method()) &&
        !(
          request.method() === "POST" &&
          !url.search &&
          (["artifact", "publish", "availability"].some(
            (action) => url.pathname === actionPath + "/" + action,
          ) ||
            url.pathname === `/api/events/${identity.eventId}/drafts`)
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
    await context.exposeBinding("__publicationProvider", (_source, payload) => {
      result.providerRequests.push(payload);
      throw Error("No wallet/RPC method exists in publication tests");
    });
    await context.addInitScript(() => {
      window.ethereum = {
        request: (payload) => window.__publicationProvider(payload),
        on() {},
        removeListener() {},
      };
    });
    page = await context.newPage();
    page.on("pageerror", (error) => result.errors.push(error.message));
    const ready = async () => {
      await expect(page.locator("#content")).toBeVisible();
      await expect(page.locator("#loading")).toBeHidden();
    };
    const visit = async (options = {}) => {
      configure(options);
      await page.goto(
        origin +
          "/?synthetic=" +
          ++serial +
          "#" +
          new URLSearchParams({
            event: identity.eventId,
            view: options.legacy ? "cases" : "participant",
          }),
      );
      await ready();
    };
    const openCase = async () => {
      const disclosure = page.locator(".luma-launch-recovery > summary");
      if (await disclosure.count()) await disclosure.click();
      await page
        .getByText("Advanced · exact case artifact", { exact: true })
        .click();
    };
    const review = async () => {
      await openCase();
      await page.locator('[data-case-artifact="review"]').click();
      await expect(
        page.locator("[data-case-publication-review]"),
      ).toBeVisible();
    };
    const capture = async (name) => {
      await page.screenshot({
        path: path.join(out, name + ".png"),
        fullPage: false,
      });
      result.screenshots.push(name + ".png");
    };
    await visit({ stage: "none" });
    assert.equal(publicationCount(), 0);
    await page.locator(".luma-launch-recovery > summary").click();
    await page.locator('[data-tx="challenge"]').click();
    await expect(page.locator("#toast")).toContainText(
      "Synthetic financial review stopped",
    );
    assert.equal(publicationCount(), 0);
    await visit({ stage: "waiting" });
    await openCase();
    assert.equal(publicationCount(), 0);
    await page.locator('[data-tx="match"]').click();
    await expect(page.locator("#toast")).toContainText(
      "Synthetic financial review stopped",
    );
    assert.equal(publicationCount(), 0);
    pass(
      "Rendering/opening a case and explicitly reviewing challenge/match never exports, uploads or verifies case bytes automatically",
    );

    await visit();
    await review();
    await expect(page.locator("[data-case-publication-json]")).toHaveText(
      envelope.artifact.content,
      { useInnerText: false },
    );
    assert.equal(
      await page.locator("[data-case-publication-json]").textContent(),
      envelope.artifact.content,
    );
    await expect(page.locator("#publication-escape-probe")).toHaveCount(0);
    await expect(page.locator("[data-case-publication-review]")).toContainText(
      "original-case-server",
    );
    await expect(page.locator("[data-case-publication-review]")).toContainText(
      "0",
    );
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator('[data-case-publication="download"]').click(),
    ]);
    const bytes = await fs.readFile(await download.path());
    assert.deepEqual(bytes, Buffer.from(envelope.artifact.content, "utf8"));
    assert(download.suggestedFilename().endsWith(".json"));
    await capture("exact-artifact-review");
    pass(
      "The original Waiting/old-instance JSON remains exact and escaped beside a fresh Matched case with valid zero Court IDs; download bytes are identical",
    );
    await expect(
      page.locator('[data-case-publication="publish"]'),
    ).toBeDisabled();
    assert.equal(count("publish"), 0);
    availabilityResult = "availability-unconfirmed";
    await page.locator('[data-case-publication="availability"]').click();
    await expect(page.locator("[data-case-publication-status]")).toContainText(
      /unconfirmed/i,
    );
    assert.equal(uploadAttempted, false);
    await page.locator("[data-case-publication-consent]").check();
    await page.locator('[data-case-publication="publish"]').dblclick();
    await expect.poll(() => count("publish")).toBe(1);
    await expect(page.locator("[data-case-publication-status]")).toContainText(
      /not verified/i,
    );
    assert.equal(count("availability"), 1);
    pass(
      "Failed pre-upload availability does not consume upload readiness; explicit consent and a double click produce one upload request, whose acknowledgment is not availability proof",
    );
    availabilityResult = "verified";
    await page.locator('[data-case-publication="availability"]').click();
    await expect(page.locator("[data-case-publication-status]")).toContainText(
      /verified at the last check/i,
    );
    assert.equal(count("availability"), 2);
    await page.keyboard.press("Escape");
    await page.reload();
    await ready();
    selected.detail.state.cases[0].publication = envelope.publication;
    await review();
    await expect(
      page.locator('[data-case-publication="publish"]'),
    ).toBeHidden();
    assert.equal(count("publish"), 1);
    pass(
      "Only a separate availability click adopts the verified state; backend intent flags prevent a new upload after reload",
    );

    publishResult = "upload-uncertain";
    availabilityResult = "integrity-mismatch";
    await visit({
      eventId: "publication-uncertain-event",
      contract: "0x" + "8".repeat(40),
    });
    await review();
    await page.locator("[data-case-publication-consent]").check();
    await page.locator('[data-case-publication="publish"]').click();
    await expect(page.locator("[data-case-publication-status]")).toContainText(
      /uncertain/i,
    );
    const afterUncertain = count("publish");
    await expect(
      page.locator('[data-case-publication="publish"]'),
    ).toBeHidden();
    await page.locator('[data-case-publication="availability"]').click();
    await expect(page.locator("[data-case-publication-status]")).toContainText(
      /integrity mismatch/i,
    );
    assert.equal(count("publish"), afterUncertain);
    await page.keyboard.press("Escape");
    await page.reload();
    await ready();
    await review();
    await expect(
      page.locator('[data-case-publication="publish"]'),
    ).toBeHidden();
    assert.equal(count("publish"), afterUncertain);
    pass(
      "An uncertain upload blocks every retry, including reload; a later integrity mismatch is distinct and verification never re-uploads bytes",
    );

    await visit();
    badArtifact = clone(envelope);
    badArtifact.publication.scopeHash = "0".repeat(64);
    await openCase();
    await page.locator('[data-case-artifact="review"]').click();
    await expect(page.locator("#toast")).toContainText(
      /artifact|scope|match|publication/i,
    );
    await expect(page.locator("[data-case-publication-review]")).toBeHidden();
    await page.locator('[data-recovery="withdrawPending"]').click();
    await expect(page.locator("#recovery-amount")).toHaveValue("0.005");
    await page.keyboard.press("Escape");
    pass(
      "A mismatched publication proof fails closed while unrelated unused-credit recovery remains available",
    );

    for (const drift of ["event", "wallet", "instance"]) {
      await visit();
      await openCase();
      const originalControl = await page
        .locator('[data-case-artifact="review"]')
        .elementHandle();
      gate = new Promise((resolve) => (releaseArtifact = resolve));
      const before = count("artifact");
      await page.locator('[data-case-artifact="review"]').click();
      await expect.poll(() => count("artifact")).toBe(before + 1);
      const next =
        drift === "event"
          ? {
              eventId: "publication-other-event",
              contract: "0x" + "7".repeat(40),
            }
          : drift === "wallet"
            ? { actorWallet: "0x" + "3".repeat(40) }
            : { instanceId: CASE_INSTANCE + "-new" };
      configure(next);
      if (drift === "event")
        await page.evaluate(
          (eventId) =>
            (location.hash = new URLSearchParams({
              event: eventId,
              view: "participant",
            }).toString()),
          identity.eventId,
        );
      else await page.locator("#refresh").click();
      await expect
        .poll(() => originalControl.evaluate((element) => element.isConnected))
        .toBe(false);
      await ready();
      releaseArtifact();
      await page.waitForTimeout(100);
      await expect(page.locator("#review-dialog")).not.toHaveAttribute(
        "open",
        "",
      );
      assert.equal(count("publish"), afterUncertain);
    }
    pass(
      "Late artifact responses cannot open a review after event, actor or server-instance changes",
    );
    await visit();
    await review();
    await page.locator("[data-case-publication-consent]").check();
    const stale = await page
      .locator('[data-case-publication="publish"]')
      .elementHandle();
    configure({
      eventId: "publication-final-event",
      contract: "0x" + "6".repeat(40),
    });
    await page.evaluate(
      (eventId) =>
        (location.hash = new URLSearchParams({
          event: eventId,
          view: "participant",
        }).toString()),
      identity.eventId,
    );
    await ready();
    await expect(page.locator("#review-dialog")).not.toHaveAttribute(
      "open",
      "",
    );
    await stale.evaluate((button) => button.click());
    assert.equal(count("publish"), afterUncertain);
    pass(
      "A context change closes the review and a stale retained control cannot publish",
    );
    await visit({ legacy: true });
    await expect(page.locator("[data-case-artifact]")).toHaveCount(0);
    assert((await page.locator("[data-publish]").count()) > 0);
    pass("Legacy case publication controls remain on their existing interface");
    assert.deepEqual(result.forbidden, []);
    assert.deepEqual(result.external, []);
    assert.deepEqual(result.providerRequests, []);
    assert.deepEqual(result.errors, []);
    result.status = "passed";
    console.log(
      JSON.stringify(
        {
          status: result.status,
          groups: result.checks.length,
          actualUploads: 0,
          actualGatewayRequests: 0,
          providerRequests: 0,
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
if (args.length === 1 && args[0] === "--self-test") await selfTest();
else if (args.length === 1 && args[0] === "--run-loopback") await run();
else if (!args.length)
  console.log(
    "Prepared. --self-test is offline; --run-loopback only after source readiness. No public origin or real publication is supported.",
  );
else throw Error("Only --self-test or authorized --run-loopback is accepted");
