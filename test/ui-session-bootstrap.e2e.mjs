import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { selectedEventResult } from "../public/selected-event.js";
import fixture from "./fixtures/ui-audit-synthetic.js";

// Session acknowledgments and signatures are synthetic test transport only.
// No app backend, cryptographic signing key, RPC, financial route or external host exists.
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "artifacts/ui-ux-audit/session");
await fs.mkdir(out, { recursive: true });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const identities = fixture.bootstrap.identities.map((x) => ({
  ...x,
  label: "Fixture " + ({ alice: "Alice", bob: "Bob" }[x.id] ?? x.id),
  mode: "demo",
}));
const actorFor = (id) =>
  id ? structuredClone(identities.find((x) => x.id === id)) : null;
const alice = actorFor("alice"),
  bob = actorFor("bob");
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const marker = "FOREIGN_SESSION_BUNDLE_MUST_NEVER_RENDER";
const clients = new Map(),
  assets = new Map();
const result = {
  status: "running",
  checks: [],
  requests: [],
  acknowledgments: [],
  forbidden: [],
  external: [],
  pageErrors: [],
  walletCalls: [],
  screenshots: [],
  limitations: [
    "Synthetic session/auth transport validates UI actor handoff, not authentication cryptography or server policy.",
    "personal_sign returns a non-cryptographic literal; no private keys are read or generated.",
    "Historical public fixture is redacted per current actor; no real guest or financial mutation exists.",
  ],
};
let serial = 0,
  clientSerial = 0,
  browser,
  page;
const summary = (event, actor) => ({
  ...structuredClone(event),
  chainId: 1337,
  contractVersion: "kleros-event-v8",
  abiVersion: "kleros-event-v8",
  role: actor ? "participant" : "visitor",
});
function detail(eventId, actor) {
  const d = structuredClone(fixture.events[eventId]);
  d.event = summary(d.event, actor);
  for (const key of [
    "participants",
    "deposits",
    "unmatched",
    "attendance",
    "transactions",
  ])
    d[key] = actor
      ? (d[key] ?? []).filter(
          (x) =>
            same(x.wallet, actor.wallet) ||
            (key === "attendance" &&
              d.participants.some(
                (p) => p.id === x.participantId && same(p.wallet, actor.wallet),
              )),
        )
      : [];
  d.imports = [];
  d.personal = null;
  d.permissions = { authenticated: !!actor, owner: false, staff: false };
  d.ownWallet = actor
    ? {
        wallet: actor.wallet,
        pendingCreditWei: same(actor.wallet, alice.wallet)
          ? "1000000000000"
          : "2000000000000",
        owedWei: "0",
      }
    : null;
  d.state.pendingCreditTotalWei = "3000000000000";
  return d;
}
function bootstrap(state, eventId) {
  const actor = state.actor;
  const boot = {
    ...structuredClone(fixture.bootstrap),
    mode: "local",
    instanceId: "session-bootstrap-synthetic",
    identities: structuredClone(identities),
    session: actor,
    capabilities: {
      browserWallet: true,
      contractInbox: false,
      batchActions: false,
      selectedEventBootstrap: true,
    },
    chain: {
      chainId: 1337,
      name: "Synthetic local chain",
      rpcUrl: "http://127.0.0.1/NO-RPC-EXISTS",
      nativeCurrency: { symbol: "ETH", name: "Synthetic ETH", decimals: 18 },
    },
    events: fixture.bootstrap.events.map((e) => summary(e, actor)),
    selectedEvent: {
      eventId,
      instanceId: "session-bootstrap-synthetic",
      wallet: actor?.wallet ?? null,
      detail: detail(eventId, actor),
      error: null,
    },
  };
  assert(
    selectedEventResult(boot, {
      eventId,
      capturedWallet: actor?.wallet ?? null,
      hasCapturedSession: true,
    })?.detail,
    "Normal fixture projection must be legitimate for actor",
  );
  if (state.bundleFault === "wrong-wallet") {
    const foreign = same(actor?.wallet, alice.wallet) ? bob : alice;
    boot.selectedEvent.wallet = foreign.wallet;
    boot.selectedEvent.detail = detail(eventId, foreign);
    boot.selectedEvent.detail.event.description = marker;
    state.bundleFault = null;
  }
  return boot;
}
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
function acknowledged(state, record, actor, kind) {
  state.actor = actor;
  state.epoch++;
  record.acknowledgedEpoch = state.epoch;
  record.acknowledgedAt = Date.now();
  result.acknowledgments.push({
    requestId: record.id,
    client: record.client,
    kind,
    epoch: state.epoch,
    wallet: actor?.wallet ?? null,
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"),
    client = req.headers["x-session-fixture"] ?? "unknown",
    state = clients.get(client);
  const record = {
    id: ++serial,
    client,
    method: req.method,
    path: url.pathname,
    eventId: url.searchParams.get("selectedEventId"),
    epoch: state?.epoch ?? null,
    actor: state?.actor?.wallet ?? null,
  };
  result.requests.push(record);
  try {
    if (url.pathname.startsWith("/api/")) {
      if (!state) throw Error("Unknown isolated test client");
      if (req.method === "GET" && url.pathname === "/api/bootstrap") {
        const eventId = url.searchParams.get("selectedEventId");
        if (!["event-a", "event-b"].includes(eventId))
          return send(res, 400, { error: "Exact synthetic event required" });
        const value = bootstrap(state, eventId);
        record.responseActor = value.session?.wallet ?? null;
        record.responseSelectedWallet = value.selectedEvent.wallet;
        return send(res, 200, value);
      }
      if (
        req.method === "GET" &&
        /^\/api\/events\/event-[ab]$/.test(url.pathname)
      ) {
        record.responseActor = state.actor?.wallet ?? null;
        return send(
          res,
          200,
          detail(url.pathname.split("/").at(-1), state.actor),
        );
      }
      const allowed =
        (url.pathname === "/api/session" &&
          ["POST", "DELETE"].includes(req.method)) ||
        (req.method === "POST" &&
          ["/api/auth/challenge", "/api/auth/verify"].includes(url.pathname));
      if (!allowed) {
        result.forbidden.push(record);
        return send(res, 405, {
          error: "No financial/auth-other/RPC endpoint exists",
        });
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      record.body = body;
      if (url.pathname === "/api/session") {
        const intended =
          req.method === "DELETE" ? null : actorFor(body.identity);
        if (req.method === "POST" && !intended)
          return send(res, 400, { error: "Unknown synthetic identity" });
        if (state.sessionDelay)
          await new Promise((resolve) =>
            setTimeout(resolve, state.sessionDelay),
          );
        if (state.sessionFault === "http") {
          state.sessionFault = null;
          record.failedAck = true;
          return send(res, 503, {
            error: "Synthetic session acknowledgement failed",
          });
        }
        if (state.sessionFault === "invalid-wallet") {
          state.sessionFault = null;
          record.failedAck = true;
          return send(res, 200, {
            wallet: "invalid-wallet",
            label: "Invalid synthetic acknowledgement",
            mode: "demo",
          });
        }
        if (
          req.method === "DELETE" &&
          state.sessionFault === "invalid-logout"
        ) {
          state.sessionFault = null;
          record.failedAck = true;
          return send(res, 200, { ok: false });
        }
        acknowledged(
          state,
          record,
          intended,
          req.method === "DELETE" ? "logout" : "demo",
        );
        return send(
          res,
          200,
          intended
            ? { wallet: intended.wallet, label: intended.label, mode: "demo" }
            : { ok: true },
        );
      }
      if (url.pathname === "/api/auth/challenge") {
        assert(
          same(body.wallet, alice.wallet),
          "Only public synthetic wallet may challenge",
        );
        state.nonce = "synthetic-auth-nonce-" + record.id;
        return send(res, 200, {
          nonce: state.nonce,
          message: "SYNTHETIC AUTH UI TEST ONLY; NO REAL SIGNATURE",
        });
      }
      if (url.pathname === "/api/auth/verify") {
        assert.equal(body.nonce, state.nonce);
        assert.equal(body.signature, "SYNTHETIC_NOT_A_CRYPTOGRAPHIC_SIGNATURE");
        if (state.verifyFault === "wrong-wallet") {
          state.verifyFault = null;
          record.failedAck = true;
          return send(res, 200, {
            wallet: bob.wallet,
            label: "Mismatched synthetic wallet",
            mode: "wallet",
          });
        }
        const actor = {
          ...alice,
          label: "Fixture signed Alice",
          mode: "wallet",
        };
        acknowledged(state, record, actor, "wallet");
        return send(res, 200, {
          wallet: actor.wallet,
          label: actor.label,
          mode: "wallet",
        });
      }
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      result.forbidden.push(record);
      res.writeHead(405);
      return res.end("No write endpoint");
    }
    const rel =
      url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname.slice(1));
    if (rel.includes("..") || rel.startsWith("."))
      throw Error("Invalid static path");
    if (!assets.has(rel))
      assets.set(rel, await fs.readFile(path.join(root, "public", rel)));
    res.writeHead(200, {
      "content-type": mime[path.extname(rel)] ?? "application/octet-stream",
    });
    res.end(assets.get(rel));
  } catch (error) {
    record.error = error.message;
    send(res, 500, { error: error.message });
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const mark = (label) => result.checks.push(label);
const apiRecords = (id, epoch) =>
  result.requests.filter(
    (x) =>
      x.client === id &&
      x.epoch === epoch &&
      x.method === "GET" &&
      x.path.startsWith("/api/"),
  );
try {
  browser = await chromium.launch({ headless: true });
  async function createPage() {
    const id = "synthetic-client-" + ++clientSerial,
      state = {
        actor: null,
        epoch: 0,
        sessionDelay: 0,
        sessionFault: null,
        bundleFault: null,
        verifyFault: null,
      };
    clients.set(id, state);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "X-Session-Fixture": id },
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    await context.route("**/*", (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== origin) {
        result.external.push({ method: request.method(), url: request.url() });
        return route.abort("blockedbyclient");
      }
      if (url.pathname.startsWith("/api/")) {
        const allowed =
          (request.method() === "GET" &&
            (url.pathname === "/api/bootstrap" ||
              /^\/api\/events\/event-[ab]$/.test(url.pathname))) ||
          (["POST", "DELETE"].includes(request.method()) &&
            url.pathname === "/api/session") ||
          (request.method() === "POST" &&
            ["/api/auth/challenge", "/api/auth/verify"].includes(url.pathname));
        if (!allowed) {
          result.forbidden.push({
            method: request.method(),
            path: url.pathname,
          });
          return route.abort("blockedbyclient");
        }
      } else if (!["GET", "HEAD"].includes(request.method())) {
        result.forbidden.push({ method: request.method(), path: url.pathname });
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await context.routeWebSocket("**/*", (route) => {
      result.forbidden.push({ method: "WebSocket", url: route.url() });
      route.close();
    });
    await context.addInitScript(
      ({ wallet, marker }) => {
        window.__sessionFixture = {
          calls: [],
          foreignFrames: [],
          listeners: [],
          transactions: [],
        };
        const handlers = new Map();
        window.__sessionFixture.emit = (event, value) =>
          handlers.get(event)?.(value);
        const api = {
          async request({ method, params }) {
            window.__sessionFixture.calls.push({ method, params });
            if (method === "eth_requestAccounts") return [wallet];
            if (method === "eth_chainId") return "0x539";
            if (method === "personal_sign")
              return "SYNTHETIC_NOT_A_CRYPTOGRAPHIC_SIGNATURE";
            window.__sessionFixture.transactions.push(method);
            throw Error("Synthetic wallet forbids " + method);
          },
          on(event, callback) {
            handlers.set(event, callback);
            window.__sessionFixture.listeners.push(event);
          },
        };
        Object.defineProperty(window, "ethereum", { value: api });
        new MutationObserver(() => {
          if (document.body?.textContent.includes(marker))
            window.__sessionFixture.foreignFrames.push({
              time: performance.now(),
              hash: location.hash,
            });
        }).observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      },
      { wallet: alice.wallet, marker },
    );
    const p = await context.newPage();
    p.on("pageerror", (error) => result.pageErrors.push(error.message));
    return { p, id, state, context };
  }
  async function ready(p, eventId = "event-b") {
    await expect(p.locator("#event-switch")).toHaveValue(eventId);
    await expect(p.locator("#content")).toBeVisible();
    await expect(p.locator("#loading")).toBeHidden();
  }
  async function visit(test, eventId = "event-b", view = "participant") {
    await test.p.goto(
      origin + "/#" + new URLSearchParams({ event: eventId, view }),
    );
    await ready(test.p, eventId);
  }
  async function actorUI(test, actor) {
    await ready(
      test.p,
      new URLSearchParams(new URL(test.p.url()).hash.slice(1)).get("event"),
    );
    await expect(test.p.locator("#top-identity")).toHaveText(
      actor?.label ?? "Choose identity",
    );
    await expect(test.p.locator(".identity-address")).toHaveText(
      actor?.wallet ?? "No wallet selected",
    );
    if (actor)
      await expect(test.p.locator(".credit-summary strong")).toContainText(
        same(actor.wallet, alice.wallet) ? "0.000001" : "0.000002",
      );
    else await expect(test.p.locator(".credit-summary")).toHaveCount(0);
  }
  async function select(test, id) {
    const previous = test.state.epoch;
    await test.p.locator("#identity-select").selectOption(id);
    await expect.poll(() => test.state.epoch).toBe(previous + 1);
    await actorUI(test, test.state.actor);
    await expect
      .poll(
        () =>
          apiRecords(test.id, test.state.epoch).filter(
            (x) => x.path === "/api/bootstrap",
          ).length,
      )
      .toBe(1);
    await test.p.waitForTimeout(80);
    const reads = apiRecords(test.id, test.state.epoch);
    assert.equal(reads.filter((x) => x.path === "/api/bootstrap").length, 1);
    assert.equal(
      reads.filter((x) => x.path.startsWith("/api/events/")).length,
      0,
      "Acknowledged actor should not trigger fallback detail",
    );
    return reads;
  }
  async function signOut(test) {
    await test.p.locator("#top-identity").click();
    await test.p.locator("[data-logout]").click();
    await expect.poll(() => test.state.actor).toBe(null);
    await actorUI(test, null);
    const reads = apiRecords(test.id, test.state.epoch);
    assert.equal(reads.filter((x) => x.path === "/api/bootstrap").length, 1);
    assert.equal(
      reads.filter((x) => x.path.startsWith("/api/events/")).length,
      0,
    );
  }
  const first = await createPage();
  page = first.p;
  await visit(first);
  await actorUI(first, null);
  assert.equal(apiRecords(first.id, 0).length, 1);
  mark(
    "Anonymous initial projection is private-data-empty and uses one bound selected bootstrap",
  );
  await select(first, "alice");
  mark(
    "Anonymous to demo Alice consumes one post-ack bootstrap without falling back to detail",
  );
  await select(first, "bob");
  mark(
    "Alice to Bob consumes one post-ack bootstrap bound to Bob, not stale Alice",
  );
  await signOut(first);
  mark(
    "Acknowledged logout binds explicit null actor and needs no fallback detail read",
  );
  await select(first, "alice");
  const failedStart = result.requests.length,
    failedEpoch = first.state.epoch;
  first.state.sessionFault = "http";
  await first.p.locator("#identity-select").selectOption("bob");
  await expect(first.p.locator("#toast")).toContainText(
    "Synthetic session acknowledgement failed",
  );
  assert.equal(first.state.epoch, failedEpoch);
  assert.equal(
    result.requests
      .slice(failedStart)
      .filter((x) => x.method === "GET" && x.path.startsWith("/api/")).length,
    0,
  );
  await actorUI(first, alice);
  mark(
    "A rejected session acknowledgement does not fetch or render the requested new actor",
  );
  first.state.sessionFault = "invalid-wallet";
  const invalidStart = result.requests.length;
  await first.p.locator("#identity-select").selectOption("bob");
  await expect(first.p.locator("#toast")).toContainText(
    /acknowledg|wallet|session/i,
  );
  await first.p.waitForTimeout(80);
  assert.equal(first.state.epoch, failedEpoch);
  assert.equal(
    result.requests
      .slice(invalidStart)
      .filter((x) => x.method === "GET" && x.path.startsWith("/api/")).length,
    0,
  );
  await actorUI(first, alice);
  mark(
    "Malformed successful acknowledgement cannot establish an actor or begin a bundle read",
  );
  first.state.bundleFault = "wrong-wallet";
  const mismatchEpoch = first.state.epoch + 1;
  await first.p.locator("#identity-select").selectOption("bob");
  await expect.poll(() => first.state.epoch).toBe(mismatchEpoch);
  await actorUI(first, bob);
  const mismatchReads = apiRecords(first.id, mismatchEpoch);
  assert.equal(
    mismatchReads.filter((x) => x.path === "/api/bootstrap").length,
    1,
  );
  assert.equal(
    mismatchReads.filter((x) => x.path === "/api/events/event-b").length,
    1,
  );
  assert(
    mismatchReads.find((x) => x.path === "/api/bootstrap")
      .responseSelectedWallet !== bob.wallet,
  );
  assert.equal(
    mismatchReads.find((x) => x.path === "/api/events/event-b").responseActor,
    bob.wallet,
  );
  assert.deepEqual(
    await first.p.evaluate(() => window.__sessionFixture.foreignFrames),
    [],
  );
  await expect(first.p.locator("body")).not.toContainText(marker);
  mark(
    "Wrong selected-wallet bundle is never rendered; one fallback reads the actual acknowledged Bob projection",
  );
  first.state.sessionFault = "invalid-logout";
  const invalidLogoutStart = result.requests.length,
    invalidLogoutEpoch = first.state.epoch;
  await first.p.locator("#top-identity").click();
  await first.p.locator("[data-logout]").click();
  await expect(first.p.locator("#toast")).toContainText(
    /acknowledg|sign|session/i,
  );
  await first.p.waitForTimeout(80);
  assert.equal(first.state.epoch, invalidLogoutEpoch);
  assert.equal(
    result.requests
      .slice(invalidLogoutStart)
      .filter((x) => x.method === "GET" && x.path.startsWith("/api/")).length,
    0,
  );
  await actorUI(first, bob);
  await first.p.keyboard.press("Escape");
  mark(
    "Logout requires an affirmative server acknowledgement before using null actor",
  );
  await first.p.screenshot({ path: path.join(out, "demo-bob.png") });
  result.screenshots.push("demo-bob.png");
  result.walletCalls.push(
    ...(await first.p.evaluate(() => window.__sessionFixture.calls)),
  );
  await first.context.close();
  const wallet = await createPage();
  page = wallet.p;
  await visit(wallet);
  await wallet.p.locator("#top-identity").click();
  await wallet.p.locator("[data-connect-wallet]").click();
  await expect.poll(() => wallet.state.epoch).toBe(1);
  await actorUI(wallet, { ...alice, label: "Fixture signed Alice" });
  const walletReads = apiRecords(wallet.id, 1);
  assert.equal(
    walletReads.filter((x) => x.path === "/api/bootstrap").length,
    1,
  );
  assert.equal(
    walletReads.filter((x) => x.path.startsWith("/api/events/")).length,
    0,
  );
  const calls = await wallet.p.evaluate(() => window.__sessionFixture.calls);
  assert.equal(calls.filter((x) => x.method === "personal_sign").length, 1);
  assert(
    calls.every((x) =>
      ["eth_requestAccounts", "eth_chainId", "personal_sign"].includes(
        x.method,
      ),
    ),
  );
  assert.deepEqual(
    await wallet.p.evaluate(() => window.__sessionFixture.transactions),
    [],
  );
  mark(
    "Anonymous mock-wallet authentication uses one acknowledged-actor bootstrap and no detail fallback",
  );
  mark(
    "Wallet stub permits account/chain/personal_sign only, with no real signature or transaction method",
  );
  await wallet.p.screenshot({ path: path.join(out, "mock-wallet-alice.png") });
  result.screenshots.push("mock-wallet-alice.png");
  await wallet.p.evaluate(
    (nextWallet) =>
      window.__sessionFixture.emit("accountsChanged", [nextWallet]),
    bob.wallet,
  );
  await actorUI(wallet, null);
  assert.equal(wallet.state.epoch, 2);
  const changedWalletReads = apiRecords(wallet.id, 2);
  assert.equal(
    changedWalletReads.filter((x) => x.path === "/api/bootstrap").length,
    1,
  );
  assert.equal(
    changedWalletReads.filter((x) => x.path.startsWith("/api/events/")).length,
    0,
  );
  assert.equal(
    (await wallet.p.evaluate(() => window.__sessionFixture.calls)).length,
    calls.length,
  );
  mark(
    "A mock wallet-account change signs out through one null-actor acknowledged bootstrap without another signature",
  );
  result.walletCalls.push(...calls);
  await wallet.context.close();
  const badWallet = await createPage();
  page = badWallet.p;
  badWallet.state.verifyFault = "wrong-wallet";
  await visit(badWallet);
  const badStart = result.requests.length;
  await badWallet.p.locator("#top-identity").click();
  await badWallet.p.locator("[data-connect-wallet]").click();
  await expect(badWallet.p.locator("#toast")).toContainText(
    /acknowledg|wallet|account/i,
  );
  await badWallet.p.waitForTimeout(100);
  assert.equal(badWallet.state.epoch, 0);
  assert.equal(
    result.requests
      .slice(badStart)
      .filter((x) => x.method === "GET" && x.path.startsWith("/api/")).length,
    0,
  );
  await actorUI(badWallet, null);
  await badWallet.p.keyboard.press("Escape");
  mark(
    "Wallet acknowledgement for a different signed account is rejected before another bootstrap",
  );
  result.walletCalls.push(
    ...(await badWallet.p.evaluate(() => window.__sessionFixture.calls)),
  );
  await badWallet.context.close();
  const late = await createPage();
  page = late.p;
  await visit(late, "event-a");
  late.state.sessionDelay = 300;
  await late.p.locator("#identity-select").selectOption("alice");
  await expect
    .poll(
      () =>
        result.requests.filter(
          (x) => x.client === late.id && x.path === "/api/session",
        ).length,
    )
    .toBe(1);
  await late.p.evaluate(
    () => (location.hash = "event=event-b&view=participant"),
  );
  await expect.poll(() => late.state.epoch).toBe(1);
  await actorUI(late, alice);
  await expect(late.p.locator("#event-switch")).toHaveValue("event-b");
  const lateReads = apiRecords(late.id, 1);
  assert.equal(lateReads.filter((x) => x.path === "/api/bootstrap").length, 1);
  assert.equal(
    lateReads.find((x) => x.path === "/api/bootstrap").eventId,
    "event-b",
  );
  assert.equal(
    lateReads.filter((x) => x.path.startsWith("/api/events/")).length,
    0,
  );
  assert.deepEqual(
    await late.p.evaluate(() => window.__sessionFixture.foreignFrames),
    [],
  );
  mark(
    "A late session acknowledgement reloads the latest event route with the acknowledged actor exactly once",
  );
  result.walletCalls.push(
    ...(await late.p.evaluate(() => window.__sessionFixture.calls)),
  );
  await late.context.close();
  assert.deepEqual(result.forbidden, []);
  assert.deepEqual(result.external, []);
  assert.deepEqual(result.pageErrors, []);
  assert(
    result.requests.every(
      (x) =>
        ["GET", "HEAD"].includes(x.method) ||
        x.path === "/api/session" ||
        ["/api/auth/challenge", "/api/auth/verify"].includes(x.path),
    ),
  );
  mark(
    "Every mutation is an explicitly local synthetic session/auth exchange; no finance/RPC/external/error occurs",
  );
  result.status = "passed";
  await fs.rm(path.join(out, "failure.png"), { force: true });
  console.log(
    "Session bootstrap browser checks passed: " +
      result.checks.length +
      " meaningful checks; synthetic authentication only.",
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
