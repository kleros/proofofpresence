// Actual browser -> HTTPS gateway -> keyless workbench -> local chain1 V9.
// No public endpoint/key is accepted. Only Court adjudication and local time are controlled.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import { chromium, expect } from "@playwright/test";
import { createGateway } from "../netlify/functions/workbench.mjs";
import { startServer } from "../src/server.mjs";
import { ipfsPathOf } from "../references/kickback/scripts/lib.mjs";
import { V9_LUMA_ATTENDANCE_STANDARD } from "../src/contracts-v9-luma.mjs";
import {
  createLumaLaunchRuntime,
  LUMA_LOCAL_DEPOSIT_WEI,
  LUMA_LOCAL_GAS,
} from "./fixtures/luma-launch-runtime.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROFILE = "kleros-event-v9-uups";
const FACTORY_PATH = "/api/organizer/events/drafts";
const LUMA_URL = "https://luma.com/synthetic-full-kickback";
const D = LUMA_LOCAL_DEPOSIT_WEI;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const lower = (value) => String(value).toLowerCase();
const same = (a, b) => lower(a) === lower(b);
const copy = (value) =>
  JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
const send = async (pending) => (await pending).wait();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export async function runLumaLaunchFlow() {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const output = path.join(ROOT, "artifacts/luma-launch-flow", runId);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(output);
  const report = {
    status: "RUNNING",
    runId,
    environment: "LOCAL HTTPS + IN-PROCESS GANACHE CHAIN1",
    profile: PROFILE,
    depositWei: String(D),
    checks: [],
    operations: [],
    snapshots: [],
    screenshots: [],
    requests: [],
    auth: [],
    walletCalls: [],
    external: [],
    errors: [],
    forbidden: [],
    assets: {},
    sources: {},
    limitations: [
      "Public production runtime/bootstrap is injected; actual current V9 source, proxies and governance provenance are verified locally.",
      "Court adjudication alone is controlled with a local mock. This does not claim a public Court jury vote or real mainnet deployment.",
      "The fixture persistence survives workbench/server replacement in memory; it does not prove host volume durability.",
      "The synthetic published policy is fixture metadata only. No IPFS, Luma, hosting or other external publication occurs.",
    ],
    publicRequests: 0,
    publicSignatures: 0,
    publicBroadcasts: 0,
    privateSigningFilesRead: 0,
  };
  const pass = (label) => report.checks.push(label);
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "kleros-luma-flow-"),
  );
  const backendOrigin = "https://backend.synthetic.invalid";
  const proxySecret = "synthetic_luma_gateway_" + "61a082e9".repeat(8);
  const controllers = new Map(),
    authoritative = new Map();
  const loss = {
    factory: null,
    factoryBlocked: false,
    deposit: null,
    depositDropped: false,
  };
  let fixture, backend, frontend, browser, origin, workbench, gateway;
  let clock = null;
  const realNow = Date.now;
  const sourceFiles = [
    "test/luma-launch-flow.e2e.mjs",
    "test/fixtures/luma-launch-runtime.mjs",
    "src/server.mjs",
    "src/workbench.mjs",
    "src/factory-onboarding.mjs",
    "src/deposit-inbox.mjs",
    "src/mainnet-runtime.mjs",
    "src/upgrade-verification.mjs",
    "src/upgrade-artifacts.mjs",
    "netlify/functions/workbench.mjs",
    "references/kickback/scripts/lib.mjs",
    "docs/contracts/v9-luma-generic-policy.md",
    "artifacts/mainnet-release/luma-v9-generic-policy-draft.json",
  ];

  async function saveProof() {
    report.assets = Object.fromEntries(
      Object.entries(report.assets).sort(([a], [b]) => a.localeCompare(b)),
    );
    await fs.writeFile(
      path.join(output, "proof.json"),
      JSON.stringify(copy(report), null, 2) + "\n",
      { flag: "wx" },
    );
  }
  async function publicClosure() {
    const files = new Set([
      ...sourceFiles,
      "package.json",
      "package-lock.json",
      "scripts/compile-contracts-v9.mjs",
    ]);
    async function walk(relative) {
      for (const entry of await fs.readdir(path.join(ROOT, relative), {
        withFileTypes: true,
      })) {
        const name = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) await walk(name);
        else if (
          entry.isFile() &&
          /\.(mjs|js|json|sol|html|css|svg|woff2)$/.test(entry.name)
        )
          files.add(name);
      }
    }
    for (const directory of [
      "src",
      "public",
      "contracts/v9",
      "build/contracts-v9",
    ])
      await walk(directory);
    return [...files].sort();
  }
  function captureDraft(value) {
    const draft = value?.d ?? value?.draft ?? value;
    if (
      draft &&
      typeof draft.id === "string" &&
      typeof draft.eventId === "string" &&
      draft.transaction &&
      typeof draft.wallet === "string"
    ) {
      authoritative.set(lower(draft.wallet), draft);
    }
  }
  function guardedWorkbench(actual) {
    const observed = new Set([
      "createDraft",
      "validateDraft",
      "createFactoryDraft",
      "validateFactoryDraft",
      "getFactoryDraft",
    ]);
    return new Proxy(actual, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== "function") return value;
        if (!observed.has(key)) return value.bind(target);
        return async (...args) => {
          const result = await value.apply(target, args);
          captureDraft(result);
          return result;
        };
      },
    });
  }
  async function startBackend() {
    backend = await startServer(
      {
        port: 0,
        rpcPort: 0,
        contractVersion: PROFILE,
        production: fixture.productionConfig,
        deployment: {
          mode: "hosted-production",
          publicOrigin: origin,
          backendOrigin,
          proxySecret,
          runtimeRoot: path.join(temporary, "runtime"),
        },
      },
      {
        workbenchFactory: async (options) => {
          workbench = await fixture.createWorkbench(options);
          return guardedWorkbench(workbench);
        },
      },
    );
  }
  function observeApiResponse(requested, options, bytes, status) {
    const request = {
      method: options.method,
      path: requested.pathname,
      status,
    };
    report.requests.push(request);
    if (requested.pathname !== "/api/auth/challenge" || status !== 200) return;
    const body = JSON.parse(bytes.toString());
    const input = options.body
      ? JSON.parse(Buffer.from(options.body).toString("utf8"))
      : {};
    const controller = controllers.get(lower(input.wallet));
    assert(controller, "Nonce was requested for an unknown synthetic actor");
    controller.auth = { ...body, origin };
    report.auth.push({
      wallet: controller.actor.address,
      nonceSha256: sha(body.nonce),
      messageSha256: sha(body.message),
      origin,
    });
  }
  function gatewayFetch(target, options) {
    const requested = new URL(target);
    assert.equal(requested.origin, backendOrigin);
    assert(
      !requested.pathname.startsWith("/rpc"),
      "Browser/API must not forward wallet RPC",
    );
    const body = options.body
      ? JSON.parse(Buffer.from(options.body).toString("utf8"))
      : {};
    if (
      loss.factory &&
      options.method === "POST" &&
      requested.pathname.startsWith(
        `${FACTORY_PATH}/${loss.factory.draftId}/`,
      ) &&
      /\/(submitted|reconcile)$/.test(requested.pathname)
    ) {
      assert.equal(body.hash, loss.factory.hash);
      loss.factoryBlocked = true;
      report.requests.push({
        method: "POST",
        path: requested.pathname,
        injected: "dropped-before-backend-hash-binding",
      });
      return Promise.reject(
        new Error("Synthetic lost factory submission request"),
      );
    }
    return new Promise((resolve, reject) => {
      const headers = new Headers(options.headers);
      headers.set("host", new URL(backendOrigin).host);
      const req = http.request(
        backend.url + requested.pathname + requested.search,
        {
          method: options.method,
          headers: Object.fromEntries(headers),
          signal: options.signal,
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const bytes = Buffer.concat(chunks);
            try {
              observeApiResponse(requested, options, bytes, res.statusCode);
              const depositConfirmation =
                loss.deposit &&
                ((requested.pathname ===
                  `/api/events/${loss.deposit.eventId}/submissions/reconcile` &&
                  body.draftId === loss.deposit.draftId) ||
                  requested.pathname ===
                    `/api/events/${loss.deposit.eventId}/drafts/${loss.deposit.draftId}/confirm`);
              if (
                loss.deposit &&
                !loss.depositDropped &&
                options.method === "POST" &&
                depositConfirmation &&
                res.statusCode === 200
              ) {
                loss.depositDropped = true;
                report.requests.push({
                  method: "POST",
                  path: requested.pathname,
                  injected: "dropped-confirmed-response",
                });
                return reject(new Error("Synthetic confirmed response loss"));
              }
              resolve(
                new Response(
                  options.method === "HEAD" ||
                  [204, 304].includes(res.statusCode)
                    ? null
                    : bytes,
                  {
                    status: res.statusCode,
                    headers: Object.fromEntries(
                      Object.entries(res.headers)
                        .filter(([, value]) => value !== undefined)
                        .map(([name, value]) => [
                          name,
                          Array.isArray(value) ? value.join("; ") : value,
                        ]),
                    ),
                  },
                ),
              );
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });
  }
  async function api(controller, pathname, method = "GET", body) {
    const response = await controller.context.request.fetch(origin + pathname, {
      method,
      ...(body === undefined ? {} : { data: body }),
      headers: { Origin: origin },
    });
    const value = await response.json();
    return { response, value };
  }
  async function bootstrap(controller, eventId) {
    const { response, value } = await api(
      controller,
      `/api/bootstrap${eventId ? `?selectedEventId=${encodeURIComponent(eventId)}` : ""}`,
    );
    assert(response.ok());
    return value;
  }
  async function detail(controller, eventId) {
    const { response, value } = await api(
      controller,
      `/api/events/${encodeURIComponent(eventId)}`,
    );
    assert(response.ok(), `${eventId}: ${JSON.stringify(value)}`);
    return value;
  }
  async function refresh(controller, eventId) {
    const response = controller.page.waitForResponse((r) => {
      const url = new URL(r.url());
      return (
        r.request().method() === "GET" &&
        url.origin === origin &&
        ((url.pathname === "/api/bootstrap" &&
          url.searchParams.get("selectedEventId") === eventId) ||
          url.pathname === `/api/events/${eventId}`)
      );
    });
    await controller.page.locator("[data-reload],#refresh").first().click();
    assert((await response).ok());
    await expect(controller.page.locator("[data-luma-launch]")).toBeVisible();
  }
  async function capture(controller, name) {
    const filename = `${String(report.screenshots.length + 1).padStart(2, "0")}-${name}.png`;
    await controller.page.screenshot({
      path: path.join(output, filename),
      fullPage: true,
    });
    report.screenshots.push({
      file: filename,
      sha256: sha(await fs.readFile(path.join(output, filename))),
      wallet: controller.actor.address,
      route: new URL(controller.page.url()).hash,
    });
  }
  async function openDetails(page, text) {
    const summary = page
      .locator("details > summary")
      .filter({ hasText: text })
      .first();
    await expect(summary).toBeVisible();
    if (!(await summary.evaluate((node) => node.parentElement.open)))
      await summary.click();
  }
  const caseFact = (page, label) =>
    page
      .locator(".case-card dt")
      .filter({ hasText: label })
      .locator("xpath=following-sibling::dd[1]");
  const ownFact = (page, label) =>
    page
      .locator(".luma-launch-recovery dt")
      .filter({ hasText: label })
      .locator("..");
  async function connect(controller) {
    const before = controller.adapter.calls.filter(
      (c) => c.method === "personal_sign",
    ).length;
    const connection = controller.page.locator("[data-connect-wallet]").first();
    if (await connection.count()) await connection.click();
    else {
      await controller.page.locator("#top-identity").click();
      await controller.page.locator("[data-connect-wallet]").last().click();
    }
    await expect
      .poll(async () =>
        (await bootstrap(controller)).session?.wallet?.toLowerCase(),
      )
      .toBe(lower(controller.actor.address));
    assert.equal(
      controller.adapter.calls.filter((c) => c.method === "personal_sign")
        .length,
      before + 1,
    );
    pass(`Real nonce authentication for ${controller.role}`);
  }
  async function makeController(role, actor) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      timezoneId: "UTC",
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const controller = {
      role,
      actor,
      context,
      page,
      auth: null,
      expected: null,
      phase: "idle",
    };
    controllers.set(lower(actor.address), controller);
    const adapter = fixture.walletProvider(actor, {
      getAuthChallenge: () => controller.auth,
      getReviewedDraft: () => authoritative.get(lower(actor.address)),
      isCurrentContext: async () => {
        if (page.isClosed() || new URL(page.url()).origin !== origin)
          return false;
        if (!controller.expected) return true;
        const b = await bootstrap(
          controller,
          controller.expected.kind === "factory"
            ? null
            : controller.expected.eventId,
        );
        if (!same(b.session?.wallet, actor.address)) return false;
        const route = new URLSearchParams(new URL(page.url()).hash.slice(1));
        return controller.expected.kind === "factory"
          ? route.get("setup") === "kickback"
          : route.get("event") === controller.expected.eventId;
      },
    });
    controller.adapter = adapter;
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith("/rpc"))
        return route.continue();
      report.external.push({
        method: route.request().method(),
        url: route.request().url(),
      });
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (route) => {
      report.forbidden.push({ method: "WebSocket", url: route.url() });
      route.close();
    });
    page.on("pageerror", (error) =>
      report.errors.push({ role, name: error.name, message: error.message }),
    );
    await page.exposeBinding(
      "__localLumaWallet",
      async ({ page: caller }, request) => {
        assert.equal(caller, page);
        report.walletCalls.push({ role, method: request.method });
        if (request.method === "eth_sendTransaction") {
          const reviewed = authoritative.get(lower(actor.address)),
            expected = controller.expected;
          assert(
            expected,
            "Every financial request needs one explicit test operation",
          );
          assert(reviewed && reviewed.action === expected.action);
          if (expected.eventId)
            assert.equal(reviewed.eventId, expected.eventId);
          assert.equal(
            expected.sent,
            false,
            "An explicit operation may request only one transaction",
          );
          expected.sent = true;
        }
        const result = await adapter.request(request);
        if (request.method === "eth_sendTransaction") {
          const draft = authoritative.get(lower(actor.address));
          if (controller.expected.dropFactory)
            loss.factory = { draftId: draft.id, hash: result };
          if (controller.expected.dropDeposit)
            loss.deposit = {
              eventId: draft.eventId,
              draftId: draft.id,
              hash: result,
            };
        }
        return result;
      },
    );
    await page.addInitScript(() => {
      window.ethereum = {
        request: (request) => window.__localLumaWallet(request),
        on() {},
        removeListener() {},
      };
    });
    await page.exposeFunction("__captureLumaReturn", (value) => {
      assert.equal(value, LUMA_URL);
      report.returnToLuma = { href: value, intercepted: true };
    });
    await page.addInitScript(() => {
      document.addEventListener(
        "click",
        (event) => {
          const link = event.target.closest?.("[data-launch-return]");
          if (link) {
            event.preventDefault();
            window.__captureLumaReturn(link.href);
          }
        },
        true,
      );
    });
    return controller;
  }
  function beginOperation(controller, action, eventId, options = {}) {
    assert.equal(controller.expected, null);
    controller.expected = {
      kind: action === "createEvent" ? "factory" : "event",
      action,
      eventId,
      sent: false,
      before: controller.adapter.sent.length,
      ...options,
    };
    return controller.expected;
  }
  async function completeOperation(controller, expected, label) {
    await expect
      .poll(() => controller.adapter.sent.length)
      .toBe(expected.before + 1);
    const sent = controller.adapter.sent.at(-1),
      receipt = await fixture.provider.getTransactionReceipt(sent.hash);
    assert.equal(receipt.status, 1);
    assert.equal(
      (await fixture.provider.getBlock(receipt.blockNumber)).hash,
      receipt.blockHash,
    );
    assert.equal(expected.sent, true);
    report.operations.push({
      label,
      action: expected.action,
      actor: controller.actor.address,
      eventId: sent.eventId,
      draftId: sent.draftId,
      hash: sent.hash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      walletRequests: 1,
      receiptStatus: 1,
    });
    controller.expected = null;
    return sent;
  }
  async function createThroughUi(controller, label, lost = false) {
    await controller.page.goto(origin + "/#setup=kickback");
    const b = await bootstrap(controller);
    if (!same(b.session?.wallet, controller.actor.address))
      await connect(controller);
    await expect(controller.page.locator("[data-luma-form]")).toBeVisible();
    const chainNow = (await fixture.provider.getBlock("latest")).timestamp;
    const start = Math.ceil((chainNow + 3600) / 60) * 60;
    for (const [selector, value] of [
      ["#luma-title", `Synthetic browser ${label}`],
      ["#luma-url", LUMA_URL],
      ["#luma-start", new Date(start * 1000).toISOString().slice(0, 16)],
      ["#luma-end", new Date((start + 3600) * 1000).toISOString().slice(0, 16)],
      ["#luma-deposit", ethers.formatEther(D)],
    ])
      await controller.page.locator(selector).fill(value);
    const expected = beginOperation(controller, "createEvent", null, {
      dropFactory: lost,
    });
    await controller.page.locator('[data-luma-action="review"]').click();
    await expect(controller.page.locator("[data-luma-dialog]")).toBeVisible();
    const draft = authoritative.get(lower(controller.actor.address));
    assert(draft?.scopeKind === "factory-create");
    assert.equal(draft.terms.lumaUrl, LUMA_URL);
    assert.equal(draft.terms.depositWei, String(D));
    assert.equal(draft.terms.challengeWindowSeconds, 86400);
    assert.equal(draft.terms.matchWindowSeconds, 86400);
    await expect(controller.page.locator("[data-luma-dialog]")).toContainText(
      fixture.factory.target,
    );
    await controller.page.locator('[data-luma-action="confirm"]').click();
    if (lost) await expect.poll(() => loss.factoryBlocked).toBe(true);
    else
      await expect(
        controller.page.locator("[data-luma-deposit-link]"),
      ).toBeVisible({ timeout: 30000 });
    const sent = await completeOperation(
      controller,
      expected,
      `UI creates ${label}`,
    );
    return { draft, sent };
  }
  async function transaction(
    controller,
    eventId,
    action,
    locator,
    options = {},
  ) {
    const expected = beginOperation(controller, action, eventId, options);
    await locator.click();
    await expect(controller.page.locator("#review-dialog")).toBeVisible();
    const draft = authoritative.get(lower(controller.actor.address));
    assert.equal(draft.eventId, eventId);
    assert.equal(draft.action, action);
    await expect(controller.page.locator("#dialog-body")).toContainText(
      draft.contract,
    );
    await expect(controller.page.locator("#dialog-body")).toContainText(
      controller.actor.address,
    );
    await controller.page.locator("[data-execute]").click();
    if (options.dropDeposit) {
      await expect.poll(() => loss.depositDropped).toBe(true);
      await controller.page.reload();
    }
    await expect
      .poll(() => controller.adapter.sent.length)
      .toBe(expected.before + 1);
    await expect
      .poll(
        async () => {
          const result = await api(
            controller,
            `/api/events/${eventId}/submissions/${controller.adapter.sent.at(-1).hash}`,
          );
          assert(result.response.ok());
          return result.value.status;
        },
        { timeout: 30000 },
      )
      .toBe("confirmed");
    const sent = await completeOperation(controller, expected, `UI ${action}`);
    await refresh(controller, eventId);
    return sent;
  }
  async function selected(controller, eventId, view = "participant") {
    await controller.page.goto(
      `${origin}/#${new URLSearchParams({ event: eventId, view })}`,
    );
    await expect(controller.page.locator("[data-luma-launch]")).toBeVisible();
    const b = await bootstrap(controller, eventId);
    if (!same(b.session?.wallet, controller.actor.address))
      await connect(controller);
    await expect
      .poll(
        async () =>
          (await bootstrap(controller, eventId)).selectedEvent?.eventId,
      )
      .toBe(eventId);
  }
  async function snapshot(controller, eventId, label) {
    const value = await detail(controller, eventId);
    report.snapshots.push({
      label,
      eventId,
      state: copy(value.state),
      ownWallet: copy(value.ownWallet),
      payments: copy(value.payments),
      deploymentTrust: copy(value.deploymentTrust),
      upgrade: copy(value.upgrade),
    });
    assert.equal(value.deploymentTrust.status, "verified");
    return value;
  }

  try {
    report.sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    report.sourceFiles = await publicClosure();
    for (const filename of report.sourceFiles)
      report.sources[filename] = sha(
        await fs.readFile(path.join(ROOT, filename)),
      );
    const key = path.join(temporary, "key.pem"),
      cert = path.join(temporary, "cert.pem");
    execFileSync(
      "/usr/bin/openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    await fs.chmod(key, 0o600);
    frontend = https.createServer(
      { key: await fs.readFile(key), cert: await fs.readFile(cert) },
      async (req, res) => {
        try {
          const url = new URL(req.url, origin);
          if (
            ["GET", "HEAD"].includes(req.method) &&
            !url.pathname.startsWith("/api/") &&
            !url.pathname.startsWith("/rpc")
          ) {
            const rel =
              url.pathname === "/"
                ? "index.html"
                : decodeURIComponent(url.pathname.slice(1));
            assert(
              !rel.includes("..") &&
                !rel.startsWith(".") &&
                !rel.includes("\\"),
            );
            const filename = path.join(ROOT, "public", rel),
              bytes = await fs.readFile(filename);
            report.assets[`public/${rel}`] = sha(bytes);
            res.writeHead(200, {
              "content-type":
                mime[path.extname(filename)] ?? "application/octet-stream",
              "cache-control": "no-store",
            });
            return res.end(req.method === "HEAD" ? undefined : bytes);
          }
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const request = new Request(url, {
            method: req.method,
            headers: req.headers,
            ...(["GET", "HEAD"].includes(req.method)
              ? {}
              : { body: Buffer.concat(chunks) }),
          });
          const response = await gateway(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          report.errors.push({
            phase: "https",
            name: error.name,
            message: error.message,
          });
          res.writeHead(500).end();
        }
      },
    );
    await new Promise((resolve, reject) => {
      frontend.once("error", reject);
      frontend.listen(0, "127.0.0.1", resolve);
    });
    origin = `https://127.0.0.1:${frontend.address().port}`;
    fixture = await createLumaLaunchRuntime();
    assert.equal(await fixture.factory.eventCount(), 0n);
    assert.deepEqual(fixture.manifest.events, []);
    await startBackend();
    gateway = createGateway({
      publicOrigin: origin,
      backendOrigin,
      proxySecret,
      fetchImpl: gatewayFetch,
    });
    browser = await chromium.launch({ headless: true });
    const organizer = await makeController(
      "organizer",
      fixture.actors.organizer,
    );
    const other = await makeController("other-organizer", fixture.actors.other);
    const alice = await makeController("Alice", fixture.actors.alice);
    const bob = await makeController("Bob", fixture.actors.bob);
    const credit = await makeController(
      "other-event-payer",
      fixture.actors.credit,
    );
    const initialBootstrap = await bootstrap(organizer);
    assert.equal(initialBootstrap.mode, "hosted-production");
    assert.equal(initialBootstrap.capabilities.lumaDepositPortal, true);
    assert.equal(initialBootstrap.organizerSetup.policyStatus, "verified");
    const first = await createThroughUi(organizer, "A", true);
    const beforeRestart = await api(
      organizer,
      `${FACTORY_PATH}/${first.draft.id}`,
    );
    assert(beforeRestart.response.ok());
    assert.equal(
      beforeRestart.value.submittedHash ?? null,
      null,
      "Dropped request never bound the hash at the backend",
    );
    assert.equal(
      workbench.events.size,
      0,
      "A mined child alone must not become an app event",
    );
    const sentBeforeRestart = organizer.adapter.sent.length;
    const requestedBeforeRestart = report.walletCalls.filter(
      (call) =>
        call.role === organizer.role && call.method === "eth_sendTransaction",
    ).length;
    const oldInstance = (await bootstrap(organizer)).instanceId;
    await capture(organizer, "factory-known-hash-lost-request");
    await organizer.page.goto("about:blank");
    await backend.close();
    await startBackend();
    loss.factory = null;
    clock = first.draft.expiresAt + 1;
    Date.now = () => clock;
    await organizer.page.goto(origin + "/#setup=kickback");
    await connect(organizer);
    const renewed = await bootstrap(organizer);
    assert.notEqual(renewed.instanceId, oldInstance);
    const stale = await api(
      organizer,
      `${FACTORY_PATH}/${first.draft.id}/validate`,
      "POST",
      {},
    );
    assert.equal(stale.response.status(), 409);
    assert.equal(stale.value.code, "STALE_DRAFT");
    await expect(
      organizer.page.locator('[data-luma-action="reconcile"]'),
    ).toBeVisible();
    await expect(
      organizer.page.locator('[data-luma-action="confirm"]:enabled'),
    ).toHaveCount(0);
    await organizer.page.locator('[data-luma-action="reconcile"]').click();
    await expect(
      organizer.page.locator("[data-luma-deposit-link]"),
    ).toBeVisible({ timeout: 30000 });
    assert.equal(organizer.adapter.sent.length, sentBeforeRestart);
    const requestedAfterRestart = report.walletCalls.filter(
      (call) =>
        call.role === organizer.role && call.method === "eth_sendTransaction",
    ).length;
    assert.equal(requestedAfterRestart, requestedBeforeRestart);
    const recovered = await api(organizer, `${FACTORY_PATH}/${first.draft.id}`);
    assert(recovered.response.ok());
    const aId = first.draft.eventId;
    assert.equal(workbench.events.size, 1);
    assert.equal(await fixture.factory.eventCount(), 1n);
    report.restartRecovery = {
      oldInstance,
      newInstance: renewed.instanceId,
      expiredDraftRejected: true,
      sameWalletFreshNonce: true,
      knownHash: first.sent.hash,
      droppedBeforeBackendBinding: true,
      expirationControl:
        "Node-only Date.now fixture; no chain/client time change",
      newFinancialWalletRequests:
        requestedAfterRestart - requestedBeforeRestart,
    };
    pass(
      "Known factory hash survives real backend/workbench restart, expired signing scope and nonce reauthentication without resend",
    );
    await capture(organizer, "factory-recovered-after-restart");
    Date.now = realNow;
    clock = null;
    await other.page.goto(origin + "/#setup=kickback");
    await connect(other);
    const foreign = await api(
      other,
      `${FACTORY_PATH}/${first.draft.id}/reconcile`,
      "POST",
      { hash: first.sent.hash },
    );
    assert.equal(foreign.response.status(), 409);
    assert.equal(foreign.value.code, "DRAFT_SCOPE");
    const second = await createThroughUi(other, "B");
    const bId = second.draft.eventId;
    assert.notEqual(aId, bId);
    assert.equal(await fixture.factory.eventCount(), 2n);
    await selected(credit, bId);
    await transaction(
      credit,
      bId,
      "deposit",
      credit.page.locator('[data-tx="deposit"]'),
    );
    const bBaseline = (await detail(credit, bId)).state.fingerprint;
    const isolate = async () =>
      assert.equal(
        (await detail(credit, bId)).state.fingerprint,
        bBaseline,
        "Event B funds remain unchanged",
      );
    await selected(alice, aId);
    await transaction(
      alice,
      aId,
      "deposit",
      alice.page.locator('[data-tx="deposit"]'),
    );
    await expect(
      alice.page.locator('[data-launch-state="confirmed"]'),
    ).toBeVisible();
    await expect(alice.page.locator("[data-launch-return]")).toHaveAttribute(
      "href",
      LUMA_URL,
    );
    await alice.page.locator("[data-launch-return]").click();
    await expect.poll(() => report.returnToLuma?.href).toBe(LUMA_URL);
    await selected(bob, aId);
    await transaction(
      bob,
      aId,
      "deposit",
      bob.page.locator('[data-tx="deposit"]'),
      { dropDeposit: true },
    );
    await expect(
      bob.page.locator('[data-launch-state="confirmed"]'),
    ).toBeVisible();
    await snapshot(bob, aId, "both-deposits-confirmed");
    await isolate();
    await capture(bob, "bob-deposit-confirmed");
    await selected(organizer, aId, "organizer");
    await openDetails(organizer.page, /Admission, registration|Attendance/i);
    let people = (await detail(organizer, aId)).participants;
    for (const actor of [fixture.actors.alice, fixture.actors.bob]) {
      const person = people.find((p) => same(p.wallet, actor.address));
      assert(person && person.name == null && person.email == null);
      await organizer.page
        .locator(`[data-admission="${person.id}"]`)
        .selectOption("approved");
      await expect
        .poll(
          async () =>
            (await detail(organizer, aId)).participants.find(
              (p) => p.id === person.id,
            ).admission,
        )
        .toBe("approved");
      const registration = organizer.page.locator(
        `[data-launch-register="${actor.address}" i]`,
      );
      await expect(registration).toBeEnabled();
      await openDetails(organizer.page, /Admission, registration|Attendance/i);
      await transaction(
        organizer,
        aId,
        "register",
        registration,
      );
      await openDetails(organizer.page, /Admission, registration|Attendance/i);
    }
    let state = (await detail(organizer, aId)).state;
    assert.equal(state.stakerCount, 2);
    assert.equal(state.pendingTotalWei, "0");
    const eventStart =
      Date.parse((await detail(organizer, aId)).event.startsAt) / 1000;
    assert(Number.isSafeInteger(eventStart));
    await fixture.advance(
      Math.max(
        0,
        eventStart - (await fixture.provider.getBlock("latest")).timestamp + 1,
      ),
    );
    await refresh(organizer, aId);
    await openDetails(organizer.page, /Admission, registration|Attendance/i);
    people = (await detail(organizer, aId)).participants;
    const alicePerson = people.find((p) =>
      same(p.wallet, fixture.actors.alice.address),
    );
    await organizer.page.locator(`[data-checkin="${alicePerson.id}"]`).click();
    await organizer.page
      .locator("#checkin-note")
      .fill("Synthetic verified local browser check-in for Alice only");
    await organizer.page
      .locator(
        'form[data-form="checkin"] button[type="submit"],form[data-form="checkin"] button',
      )
      .last()
      .click();
    await expect
      .poll(async () => (await detail(organizer, aId)).attendance.length)
      .toBe(1);
    await expect(organizer.page.locator("#review-dialog")).not.toBeVisible();
    await openDetails(organizer.page, /Admission, registration|Attendance/i);
    await transaction(
      organizer,
      aId,
      "postAttendance",
      organizer.page.locator('[data-tx="postAttendance"]'),
    );
    assert.equal(
      (await detail(organizer, aId)).state.challengeEndsAt -
        (await fixture.provider.getBlock(report.operations.at(-1).blockNumber))
          .timestamp,
      86400,
    );
    await refresh(bob, aId);
    await openDetails(bob.page, /Your funds, refunds & attendance/);
    await transaction(
      bob,
      aId,
      "challenge",
      bob.page.locator('[data-tx="challenge"]'),
    );
    let bobDetail = await snapshot(bob, aId, "bob-waiting");
    assert.equal(bobDetail.state.cases[0].state, "Waiting");
    assert.equal(bobDetail.state.cases[0].finalRuling, null);
    const [caseText, caseURI] = await workbench
      .contract(aId)
      .caseMetaEvidence(fixture.actors.bob.address);
    const caseDocument = JSON.parse(caseText);
    assert.deepEqual(caseDocument.lumaAttendance, {
      schemaVersion: 1,
      lumaUrl: LUMA_URL,
      startsAt: first.draft.terms.startsAt,
      endsAt: first.draft.terms.endsAt,
      timezone: first.draft.terms.timezone,
      ...V9_LUMA_ATTENDANCE_STANDARD,
      policySha256: fixture.factoryDeployment.policy.sha256,
    });
    assert.equal(caseDocument.fileURI, fixture.factoryDeployment.policy.uri);
    assert.equal(caseURI, ipfsPathOf(caseText));
    assert(
      caseDocument.description.toLowerCase().includes(
        fixture.actors.organizer.address.toLowerCase(),
      ),
    );
    report.immutableCaseTerms = {
      ...caseDocument.lumaAttendance,
      policyURI: caseDocument.fileURI,
      caseURI,
      contentSha256: sha(caseText),
      publication: "not-published-local-exact-bytes-only",
    };
    await fs.writeFile(path.join(output, "case-bob.json"), caseText, {
      flag: "wx",
    });
    report.immutableCaseTerms.file = "case-bob.json";
    pass("Actual contract case metadata binds the original Luma interval, timezone, policy digest and case organizer");
    await openDetails(bob.page, /Your funds, refunds & attendance/);
    await expect(bob.page.locator(".case-card")).toContainText("Not final");
    await expect(bob.page.locator(".case-card")).toContainText(
      /not created|no matched case/i,
    );
    await capture(bob, "bob-waiting");
    await isolate();
    await refresh(organizer, aId);
    await openDetails(organizer.page, /Payouts & attendance disputes/);
    await transaction(
      organizer,
      aId,
      "match",
      organizer.page.locator(
        `[data-tx="match"][data-wallet="${fixture.actors.bob.address}" i]`,
      ),
    );
    state = (await detail(organizer, aId)).state;
    const challenge = state.cases.find((c) =>
      same(c.wallet, fixture.actors.bob.address),
    );
    assert.equal(challenge.state, "Disputed");
    assert.equal(challenge.finalRuling, null);
    assert(
      challenge.localDisputeID != null && challenge.arbitratorDisputeID != null,
    );
    assert.equal(
      await fixture.resolver.externalIDtoLocalID(challenge.arbitratorDisputeID),
      BigInt(challenge.localDisputeID),
    );
    assert.equal(
      (await fixture.resolver.disputes(challenge.localDisputeID))[3],
      BigInt(challenge.arbitratorDisputeID),
    );
    await refresh(bob, aId);
    await openDetails(bob.page, /Your funds, refunds & attendance/);
    await expect(bob.page.locator(".case-card")).toContainText("Not final");
    await expect(caseFact(bob.page, "Resolver local ID")).toHaveText(
      String(challenge.localDisputeID),
    );
    await expect(caseFact(bob.page, "Arbitrator dispute ID")).toHaveText(
      String(challenge.arbitratorDisputeID),
    );
    await capture(bob, "bob-matched-unruled");
    await isolate();
    await fixture.advance(
      Math.max(
        0,
        state.challengeEndsAt -
          (await fixture.provider.getBlock("latest")).timestamp +
          1,
      ),
    );
    await refresh(organizer, aId);
    await openDetails(organizer.page, /Payouts & attendance disputes/);
    const aliceBefore = await fixture.provider.getBalance(
      fixture.actors.alice.address,
    );
    await transaction(
      organizer,
      aId,
      "release",
      organizer.page.locator('[data-tx="release"]'),
    );
    assert.equal(
      await fixture.provider.getBalance(fixture.actors.alice.address),
      aliceBefore + D,
    );
    bobDetail = await snapshot(bob, aId, "alice-paid-bob-held-unruled");
    assert.equal(bobDetail.state.heldBackWei, String(D));
    assert.equal(bobDetail.state.cases[0].finalRuling, null);
    await refresh(bob, aId);
    await openDetails(bob.page, /Your funds, refunds & attendance/);
    await expect(bob.page.locator(".case-card")).toContainText("Not final");
    await expect(caseFact(bob.page, "Reserved share")).toContainText(
      `${ethers.formatEther(D)} ETH`,
    );
    await expect(
      ownFact(bob.page, "Successful direct attendance payments"),
    ).toContainText("0 ETH");
    await refresh(alice, aId);
    await openDetails(alice.page, /Your funds, refunds & attendance/);
    await expect(
      ownFact(alice.page, "Successful direct attendance payments"),
    ).toContainText(`${ethers.formatEther(D)} ETH`);
    await capture(alice, "alice-ordinary-direct-payment");
    await capture(bob, "ordinary-paid-bob-held");
    await isolate();
    const ruling = await send(
      fixture.liquid.giveFinalRuling(
        challenge.arbitratorDisputeID,
        1,
        LUMA_LOCAL_GAS,
      ),
    );
    report.controlledAdjudication = {
      hash: ruling.hash,
      blockNumber: ruling.blockNumber,
      localDisputeID: challenge.localDisputeID,
      arbitratorDisputeID: challenge.arbitratorDisputeID,
      ruling: 1,
      localOnly: true,
    };
    await refresh(bob, aId);
    await openDetails(bob.page, /Your funds, refunds & attendance/);
    bobDetail = await snapshot(bob, aId, "delivered-final-unsettled");
    assert.equal(bobDetail.state.cases[0].state, "Disputed");
    assert.equal(bobDetail.state.cases[0].finalRuling, 1);
    assert.equal(bobDetail.state.heldBackWei, String(D));
    await expect(bob.page.locator(".case-card")).toContainText("1 · Attended");
    await expect(caseFact(bob.page, "Reserved share")).toContainText(
      `${ethers.formatEther(D)} ETH`,
    );
    await expect(
      ownFact(bob.page, "Successful direct attendance payments"),
    ).toContainText("0 ETH");
    await expect(bob.page.locator(".case-card")).not.toContainText(
      "Challenge settled",
    );
    await capture(bob, "delivered-final-unsettled");
    const bobBefore = await fixture.provider.getBalance(
        fixture.actors.bob.address,
      ),
      bobNonce = await fixture.provider.getTransactionCount(
        fixture.actors.bob.address,
      );
    await refresh(organizer, aId);
    await openDetails(organizer.page, /Payouts & attendance disputes/);
    await transaction(
      organizer,
      aId,
      "resolve",
      organizer.page.locator(
        `[data-tx="resolve"][data-wallet="${fixture.actors.bob.address}" i]`,
      ),
    );
    const gain =
      (await fixture.provider.getBalance(fixture.actors.bob.address)) -
      bobBefore;
    assert.equal(gain, D + BigInt(challenge.depositWei));
    assert.equal(
      await fixture.provider.getTransactionCount(fixture.actors.bob.address),
      bobNonce,
    );
    await refresh(bob, aId);
    await openDetails(bob.page, /Your funds, refunds & attendance/);
    bobDetail = await snapshot(bob, aId, "same-bob-paid-final");
    const paid = bobDetail.payments.transfers
      .filter(
        (t) =>
          t.type === "attendance-payout" &&
          t.successful &&
          same(t.recipient, fixture.actors.bob.address),
      )
      .reduce((sum, t) => sum + BigInt(t.amountWei), 0n);
    assert.equal(paid, D);
    assert.equal(bobDetail.state.cases[0].state, "Resolved");
    for (const name of [
      "balanceWei",
      "reservedWei",
      "heldBackWei",
      "owedTotalWei",
      "challengeEscrowWei",
      "pendingTotalWei",
    ])
      assert.equal(bobDetail.state[name], "0", name);
    await expect(bob.page.locator(".case-card")).toContainText(
      "Challenge settled",
    );
    const paidRow = bob.page
      .locator(".luma-launch-recovery dt")
      .filter({ hasText: "Successful direct attendance payments" })
      .locator("..");
    await expect(paidRow).toContainText(`${ethers.formatEther(D)} ETH`);
    await capture(bob, "bob-paid-case-resolved");
    await bob.page.setViewportSize({ width: 390, height: 844 });
    await capture(bob, "bob-paid-mobile");
    assert(
      await bob.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    report.bobPayment = {
      wallet: fixture.actors.bob.address,
      attendanceWei: String(paid),
      collateralWei: String(challenge.depositWei),
      nativeGainWei: String(gain),
      nonceUnchanged: true,
      caseState: "Resolved",
      balancesAndReservesZero: true,
    };
    await isolate();
    assert.equal(await fixture.factory.eventCount(), 2n);
    assert.deepEqual(fixture.forbiddenBackendCalls, []);
    assert.deepEqual(report.external, []);
    assert.deepEqual(report.forbidden, []);
    assert.deepEqual(report.errors, []);
    assert.equal(report.operations.length, 12);
    assert.equal(
      report.walletCalls.filter((call) => call.method === "eth_sendTransaction")
        .length,
      12,
    );
    for (const controller of controllers.values())
      assert.equal(controller.expected, null);
    pass(
      "All twelve explicit UI financial operations requested exactly one wallet transaction each",
    );
    pass(
      "Same Bob receives one attendance share plus separate collateral; final personal UI reports paid and case settled",
    );
    pass(
      "Second organizer's separate factory child and nonzero payer credit stay unchanged throughout event A",
    );
    pass(
      "No backend signer/mutable RPC, external request, public-chain transaction, private key export or uncaught page error",
    );
    report.runtime = {
      chainId: 1,
      factory: fixture.factory.target,
      upgradeAuthority: fixture.timelock.target,
      upgradeOwner: fixture.actors.upgradeOwner.address,
      organizerA: fixture.actors.organizer.address,
      organizerB: fixture.actors.other.address,
      eventA: aId,
      eventB: bId,
      children: 2,
      factoryDeployment: copy(fixture.factoryDeployment),
      buildManifestFileSha256: sha(
        await fs.readFile(path.join(ROOT, "build/contracts-v9/manifest.json")),
      ),
      buildManifestCanonicalSha256: sha(
        JSON.stringify(
          JSON.parse(
            await fs.readFile(
              path.join(ROOT, "build/contracts-v9/manifest.json"),
              "utf8",
            ),
          ),
        ),
      ),
      standardInputCanonicalSha256: sha(
        JSON.stringify(
          JSON.parse(
            await fs.readFile(
              path.join(ROOT, "build/contracts-v9/standard-input.json"),
              "utf8",
            ),
          ),
        ),
      ),
      standardInputFileSha256: sha(
        await fs.readFile(
          path.join(ROOT, "build/contracts-v9/standard-input.json"),
        ),
      ),
    };
    for (const [filename, expected] of Object.entries({
      ...report.sources,
      ...report.assets,
    }))
      assert.equal(
        sha(await fs.readFile(path.join(ROOT, filename))),
        expected,
        `Source changed during browser test: ${filename}`,
      );
    assert.deepEqual(
      await publicClosure(),
      report.sourceFiles,
      "Public runtime closure changed during the test",
    );
    report.status = "PASS";
  } catch (error) {
    report.status = "STOPPED";
    report.failure = { name: error.name, message: error.message };
    throw error;
  } finally {
    Date.now = realNow;
    report.financialStatus = report.status;
    report.cleanup = [];
    for (const [name, close] of [
      ["browser", () => browser?.close()],
      ["backend", () => backend?.close()],
      [
        "frontend",
        () =>
          frontend?.listening
            ? new Promise((resolve) => frontend.close(resolve))
            : undefined,
      ],
      ["fixture", () => fixture?.close()],
      [
        "temporary-test-certificate",
        () => fs.rm(temporary, { recursive: true, force: true }),
      ],
    ]) {
      try {
        await close();
        report.cleanup.push({ name, status: "passed" });
      } catch (error) {
        report.cleanup.push({
          name,
          status: "failed",
          error: { name: error.name, message: error.message },
        });
      }
    }
    if (
      report.financialStatus === "PASS" &&
      report.cleanup.some((r) => r.status === "failed")
    )
      report.status = "PASSED_FINANCIAL_CLEANUP_FAILED";
    await saveProof();
    console.log(
      JSON.stringify({
        result: report.status,
        checks: report.checks.length,
        operations: report.operations.length,
        proof: path.relative(ROOT, path.join(output, "proof.json")),
        screenshots: report.screenshots.length,
        publicBroadcasts: 0,
      }),
    );
  }
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (!args.length)
    console.log(
      JSON.stringify({
        status: "review-only",
        instruction: "--run-local after Core/UI source freeze",
        publicEndpointsAccepted: false,
        networkRequests: 0,
        signatures: 0,
        broadcasts: 0,
      }),
    );
  else if (args.length === 1 && args[0] === "--run-local") {
    const result = await runLumaLaunchFlow();
    if (result.status !== "PASS") process.exitCode = 1;
  } else throw new Error("Only explicit --run-local is supported");
}
