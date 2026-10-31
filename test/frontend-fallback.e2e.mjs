// Loopback failure injection only: no wallet, blockchain, credentials or live API.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { EVENT, LEGACY_EVENT } from "../public/first-event/event.js";

const root = path.resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const requests = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  requests.push({ path: url.pathname, method: req.method });
  if (url.pathname.startsWith("/api/")) {
    res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "Synthetic unavailable directory" }));
    return;
  }
  const file = path.resolve(root, "." + (url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try {
    const extension = path.extname(file);
    res.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[extension] ?? "application/octet-stream");
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  // A failed directory still offers the independent static event page.
  const directory = await context.newPage();
  await directory.goto(origin);
  await expect(directory.getByRole("heading", { name: "We couldn’t load the event directory." })).toBeVisible();
  await directory.locator("[data-event-fallback]").click();
  await expect(directory).toHaveURL(origin + "/first-event/");
  await expect(directory.locator("body")).toContainText(EVENT.contract);
  // Missing startup module: use the entry controller's error fallback.
  const startup = await context.newPage();
  await startup.route("**/public-home.js", route => route.abort());
  await startup.goto(origin);
  await expect(startup.getByRole("heading", { name: "This view could not be opened." })).toBeVisible();
  await expect(startup.locator("[data-event-fallback]")).toHaveAttribute("href", "/first-event/");
  // Recovery never silently switches the depositor to the replacement contract.
  await startup.route("**/first-event-display.js", route => route.abort());
  await startup.goto(origin + "/#event=" + LEGACY_EVENT.id + "&view=participant&deposit=manage");
  await expect(startup.getByRole("heading", { name: "This view could not be opened." })).toBeVisible();
  await expect(startup.locator("[data-event-fallback]")).toHaveCount(0);
  await expect(startup.locator("#startup-fallback")).toBeHidden();
  // If even entry.js cannot run, a plain HTML link and static event facts survive.
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const html = await plain.newPage();
  await html.goto(origin);
  await html.locator("#startup-fallback a").click();
  await expect(html).toHaveURL(origin + "/first-event/");
  await expect(html.locator("body")).toContainText(EVENT.contract);
  await expect(html.locator("body")).toContainText("0.01");
  assert(requests.every(request => request.method === "GET"));
  assert(!requests.some(request => request.path === "/rpc" || (request.path.startsWith("/api/") && request.path.includes("direct-deposit"))));
  await plain.close(); await context.close();
  console.log(JSON.stringify({ status: "passed", failureCases: ["directory unavailable", "startup module unavailable", "legacy recovery preserved", "JavaScript disabled"], transactionRequests: 0, scope: "synthetic loopback only" }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
