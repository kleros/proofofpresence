import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createGateway } from "../netlify/functions/workbench.mjs";
import { startServer } from "../src/server.mjs";

// The full HTTPS browser -> real gateway -> real Node/Ganache path stays on
// ephemeral loopback listeners. Only the test certificate is self-signed.
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "kleros-hosted-tls-"),
);
const backendOrigin = "https://backend.synthetic.invalid";
const proxySecret = "synthetic_hosted_gateway_" + "0123456789abcdef".repeat(4);
const assetPaths = new Set([
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/transaction-context.js",
  "/hosted-wallet.js",
  "/reconciliation.js",
  "/assets/kleros-logo.svg",
  "/assets/kleros-symbol.svg",
  "/assets/geist-latin.woff2",
  "/assets/geist-mono-latin.woff2",
  "/assets/instrument-serif-regular.woff2",
  "/assets/instrument-serif-italic.woff2",
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const external = [],
  pageErrors = [],
  assetErrors = [],
  harnessErrors = [],
  upstream = [],
  checks = [];
let frontend, backend, browser, publicOrigin;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks.push(label);
};

try {
  const keyPath = path.join(temporary, "key.pem"),
    certPath = path.join(temporary, "cert.pem");
  execFileSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  await fs.chmod(keyPath, 0o600);
  let handler = (_req, res) => {
    res.writeHead(503);
    res.end("Initializing isolated test");
  };
  frontend = https.createServer(
    { key: await fs.readFile(keyPath), cert: await fs.readFile(certPath) },
    (req, res) => handler(req, res),
  );
  await new Promise((resolve, reject) => {
    frontend.once("error", reject);
    frontend.listen(0, "127.0.0.1", resolve);
  });
  publicOrigin = `https://127.0.0.1:${frontend.address().port}`;
  backend = await startServer({
    port: 0,
    rpcPort: 0,
    deployment: {
      mode: "hosted-demo",
      publicOrigin,
      backendOrigin,
      proxySecret,
      runtimeRoot: path.join(temporary, "runtime"),
    },
  });
  const gateway = createGateway({
    publicOrigin,
    backendOrigin,
    proxySecret,
    fetchImpl: (target, options) =>
      new Promise((resolve, reject) => {
        const requested = new URL(target);
        assert.equal(requested.origin, backendOrigin);
        const headers = new Headers(options.headers);
        headers.set("host", new URL(backendOrigin).host);
        upstream.push({
          pathname: requested.pathname,
          method: options.method,
          headers: new Headers(headers),
        });
        // Native HTTP preserves the synthetic Host while connecting only to our local
        // backend; no request is ever sent to backend.synthetic.invalid.
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
            res.on("end", () =>
              resolve(
                new Response(
                  options.method === "HEAD" ||
                  [204, 304].includes(res.statusCode)
                    ? null
                    : Buffer.concat(chunks),
                  {
                    status: res.statusCode,
                    headers: Object.fromEntries(
                      Object.entries(res.headers)
                        .filter(([, value]) => value !== undefined)
                        .map(([key, value]) => [
                          key,
                          Array.isArray(value) ? value.join("; ") : value,
                        ]),
                    ),
                  },
                ),
              ),
            );
          },
        );
        req.on("error", reject);
        req.end(options.body);
      }),
  });
  handler = async (req, res) => {
    try {
      const url = new URL(req.url, publicOrigin);
      if (req.method === "GET" && assetPaths.has(url.pathname)) {
        const filename = path.join(
          root,
          "public",
          url.pathname === "/" ? "index.html" : url.pathname.slice(1),
        );
        res.writeHead(200, {
          "content-type": mime[path.extname(filename)],
          "cache-control": "no-store",
        });
        return res.end(await fs.readFile(filename));
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(url, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [
              key,
              Array.isArray(value) ? value.join(", ") : value,
            ]),
        ),
        ...(!["GET", "HEAD"].includes(req.method) && body.length
          ? { body }
          : {}),
      });
      const result = await gateway(request);
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      harnessErrors.push(error.message);
      if (!res.headersSent)
        res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"Local HTTPS integration harness failed"}');
    }
  };

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === publicOrigin) return route.continue();
    external.push(url.href);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      ["script", "stylesheet", "font", "image"].includes(
        response.request().resourceType(),
      )
    )
      assetErrors.push(`${response.status()} ${response.url()}`);
  });
  const detail = async (id) =>
    (await context.request.get(publicOrigin + `/api/events/${id}`)).json();
  const post = (route, payload, origin = publicOrigin) =>
    context.request.post(publicOrigin + route, {
      headers: { Origin: origin },
      data: payload,
    });
  const navigate = async (event, view = "participant") => {
    await page.goto(`${publicOrigin}/#${new URLSearchParams({ event, view })}`);
    await expect(page.locator("h1")).toHaveText(
      event === "event-a" ? "Proof of Presence" : "Open Justice Workshop",
    );
    await expect(page.locator("#content")).toBeVisible();
    await expect(page.locator("#hosted-demo-banner")).toBeVisible();
    await expect(page.locator(`.tabs [data-view="${view}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  };
  const identity = async (id) => {
    await page.locator("#identity-select").selectOption(id);
    await expect(page.locator("#identity-select")).toHaveValue(id);
    await expect
      .poll(
        async () =>
          (
            await (
              await context.request.get(publicOrigin + "/api/bootstrap")
            ).json()
          ).session?.wallet,
      )
      .toBe(backend.workbench.session(id).wallet);
  };
  const confirm = async (event, action, wei) => {
    const selected = await detail(event);
    await page.locator(`[data-tx="${action}"]`).first().click();
    await expect(page.locator("#review-dialog")).toBeVisible();
    await expect(page.locator("#dialog-body")).toContainText(
      selected.event.title,
    );
    await expect(page.locator("#dialog-body")).toContainText(
      selected.event.contract,
    );
    if (wei)
      await expect(page.locator("#dialog-body")).toContainText(`${wei} wei`);
    await page.locator("[data-execute]").click();
    await expect(page.locator("#review-dialog")).not.toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("#toast")).toContainText("Confirmed");
    checks.push(
      `${event} ${action} confirms through the TLS gateway and real EVM`,
    );
  };

  await page.goto(publicOrigin);
  try {
    await expect(page.locator(".event-card")).toHaveCount(2);
  } catch (error) {
    throw new Error(
      `Hosted entry failed: ${JSON.stringify({
        harnessErrors,
        pageErrors,
        assetErrors,
        content: await page.locator("#content").textContent(),
        upstream: upstream.map((call) => call.pathname),
      })}`,
      { cause: error },
    );
  }
  await expect(page.locator("#hosted-demo-banner")).toContainText(
    "SHARED ONLINE DEMO",
  );
  await expect(page.locator("#hosted-demo-banner")).toContainText(
    /valueless ETH.*mock Court/i,
  );
  await expect(page.locator("#environment")).toHaveText("SHARED DEMO");
  checks.push(
    "HTTPS entry shows two events and an explicit shared synthetic hosted demo disclosure",
  );
  const bootstrap = await (
    await context.request.get(publicOrigin + "/api/bootstrap")
  ).json();
  check(
    bootstrap.mode,
    "hosted-demo",
    "Bootstrap retains hosted environment identity through the gateway",
  );
  check(
    bootstrap.chain.rpcUrl,
    publicOrigin + "/rpc",
    "Wallet RPC points to the public HTTPS origin",
  );
  check(
    (await fetch(backend.url + "/api/bootstrap")).status,
    403,
    "Backend cannot be accessed directly without gateway Host/key",
  );

  await navigate("event-a");
  await identity("alice");
  const sessionCookies = (await context.cookies(publicOrigin)).filter(
    (cookie) => cookie.name === "kleros_session",
  );
  check(
    sessionCookies.length,
    1,
    "A real browser retains the gateway session cookie over HTTPS",
  );
  check(
    [
      sessionCookies[0].secure,
      sessionCookies[0].httpOnly,
      sessionCookies[0].sameSite,
    ],
    [true, true, "Strict"],
    "Hosted cookie is Secure, HttpOnly and SameSite Strict",
  );
  await confirm("event-a", "deposit", "10000000000000000");
  const depositedA = await detail("event-a");
  check(
    depositedA.participants[0].deposit.amountWei,
    "10000000000000000",
    "A has the exact verified 0.01 ETH receipt",
  );
  const receiptA = await backend.workbench.provider.getTransactionReceipt(
    depositedA.participants[0].deposit.txHash,
  );
  check(
    receiptA.status,
    1,
    "A UI success is backed by an actual successful EVM receipt",
  );
  check(
    (await detail("event-b")).state.balanceWei,
    "0",
    "A deposit does not fund B",
  );
  await navigate("event-b");
  await confirm("event-b", "deposit", "20000000000000000");
  const depositedB = await detail("event-b");
  check(
    depositedB.participants[0].deposit.amountWei,
    "20000000000000000",
    "B has its independent exact 0.02 ETH receipt",
  );
  check(
    depositedB.participants[0].registered,
    false,
    "B receipt alone does not register Alice",
  );
  check(
    (await detail("event-a")).state.balanceWei,
    "10000000000000000",
    "B deposit leaves A's balance unchanged",
  );

  await navigate("event-a", "organizer");
  await identity("organizer-a");
  await page
    .locator('[data-admission="event-a-alice"]')
    .selectOption("approved");
  await expect
    .poll(
      async () =>
        (await detail("event-a")).participants.find(
          (p) => p.id === "event-a-alice",
        ).admission,
    )
    .toBe("approved");
  await confirm("event-a", "register");
  const registeredA = await detail("event-a");
  check(
    registeredA.participants.find((p) => p.id === "event-a-alice").registered,
    true,
    "Owner A registers the approved verified participant through the hosted workflow",
  );
  check(
    registeredA.state.poolWei,
    "10000000000000000",
    "A's registered pool includes its own exact deposit",
  );
  const untouchedB = await detail("event-b");
  check(
    [untouchedB.state.balanceWei, untouchedB.state.poolWei],
    ["20000000000000000", "0"],
    "A admission/registration cannot change B's deposited balance or pool",
  );

  const beforeRejectedWrite = upstream.length;
  const foreignWrite = await post(
    "/api/session",
    { identity: "organizer-b" },
    "https://attacker.invalid",
  );
  check(
    foreignWrite.status(),
    403,
    "Gateway rejects a foreign-origin API mutation",
  );
  check(
    upstream.length,
    beforeRejectedWrite,
    "Rejected API origin never reaches the backend",
  );
  const rpcRead = await post(
    "/rpc",
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    "chrome-extension://synthetic-wallet",
  );
  check(
    (await rpcRead.json()).result,
    "0x539",
    "Native-wallet RPC origin reads the real chain through the gateway",
  );
  check(
    upstream.at(-1).headers.get("cookie"),
    null,
    "Public RPC strips the browser's ambient session cookie",
  );
  check(
    rpcRead.headers()["access-control-allow-origin"],
    "*",
    "RPC returns credential-free public CORS",
  );
  const unlocked = await post(
    "/rpc",
    { jsonrpc: "2.0", id: 2, method: "eth_sendTransaction", params: [] },
    "chrome-extension://synthetic-wallet",
  );
  check(
    unlocked.status(),
    403,
    "Public gateway cannot unlock or send from server-controlled wallets",
  );
  for (const route of [
    "/finance/event-a/guest/",
    "/finance/event-a/console/",
  ]) {
    const response = await context.request.get(publicOrigin + route);
    check(response.status(), 200, `${route} survives the full gateway path`);
    assert.match(await response.text(), /<!doctype html>/i);
  }
  const consoleConfig = await (
    await context.request.get(
      publicOrigin + "/finance/event-a/console/config.json",
    )
  ).json();
  check(
    consoleConfig.rpcUrl,
    publicOrigin + "/rpc",
    "Advanced console uses the same public RPC origin",
  );

  await page.setViewportSize({ width: 400, height: 800 });
  for (const view of ["participant", "organizer", "cases"]) {
    await navigate("event-a", view);
    await page.evaluate(() => scrollTo(0, 0));
    const layout = await page.evaluate(() => {
      const banner = document
        .querySelector("#hosted-demo-banner")
        .getBoundingClientRect();
      const header = document.querySelector(".topbar").getBoundingClientRect();
      const sidebar = document
        .querySelector(".sidebar")
        .getBoundingClientRect();
      return {
        fits: document.documentElement.scrollWidth <= innerWidth + 1,
        bannerHeight: banner.height,
        headerHeight: header.height,
        sidebarHeight: sidebar.height,
        headerBelowBanner: header.top >= banner.bottom - 1,
        headerTop: header.top,
        bannerBottom: banner.bottom,
        scrollY,
      };
    });
    check(
      layout.fits &&
        layout.bannerHeight <= 130 &&
        layout.headerHeight <= 180 &&
        layout.sidebarHeight < 180 &&
        layout.headerBelowBanner,
      true,
      `Mobile ${view} keeps disclosure and header compact, separate and within the viewport: ${JSON.stringify(layout)}`,
    );
  }
  check(
    external,
    [],
    "Browser never contacts an external host or public chain",
  );
  check(pageErrors, [], "Hosted integration raises no uncaught browser error");
  check(harnessErrors, [], "Local HTTPS transport harness reports no error");
  check(assetErrors, [], "All hosted static assets load successfully");
  check(
    upstream.every(
      (call) => call.headers.get("x-kleros-proxy-key") === proxySecret,
    ),
    true,
    "Every forwarded backend request carries only the configured proxy credential",
  );
  console.log(
    `Hosted HTTPS gateway browser checks passed: ${checks.length} assertions plus Playwright expectations.`,
  );
} finally {
  await browser?.close();
  if (frontend?.listening)
    await new Promise((resolve) => frontend.close(resolve));
  await backend?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
