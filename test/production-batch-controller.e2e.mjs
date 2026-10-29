import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Actual browser controller + actual durable journal, with in-memory off-chain
// preview/response-loss fixtures. No chain, wallet provider or network API writes.
const root = fileURLToPath(new URL("../", import.meta.url));
const modules = new Set([
  "/batch-actions.js",
  "/batch-selection.js",
  "/batch-pending.js",
  "/contract-profiles.js",
]);
const blocked = [],
  errors = [],
  checks = [];
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<!doctype html><html><body></body></html>");
  }
  if (req.method === "GET" && modules.has(req.url)) {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(
      await fs.readFile(path.join(root, "public", req.url.slice(1))),
    );
  }
  blocked.push({ method: req.method, path: req.url });
  res.writeHead(403).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const scope = {
  eventId: "production-event",
  instanceId: "production-server-one",
  wallet: "0x" + "1".repeat(40),
  chainId: 1,
  contract: "0x" + "2".repeat(40),
  contractVersion: "kleros-event-v9-uups",
  mode: "hosted-production",
  action: "approve-admission",
};
async function mount(scope) {
  window.fixture?.controller.dispose();
  document.body.innerHTML =
    '<div id="toolbar"></div><div id="rows"><div data-person="person-one"><div class="cell">Synthetic guest</div></div></div>';
  const { mountBatchActions } = await import("/batch-actions.js");
  const { createBatchPendingJournal } = await import("/batch-pending.js");
  const journal = createBatchPendingJournal(localStorage, {
    origin: location.origin,
  });
  const guest = {
    key: "person-one",
    participantId: "person-one",
    wallet: "0x" + "3".repeat(40),
    label: "Synthetic guest",
    eligible: true,
  };
  const calls = [],
    loadedScopes = [],
    savedScopes = [];
  const controller = mountBatchActions(document.querySelector("#toolbar"), {
    ...scope,
    canManage: true,
    isCurrent: () => true,
    selectionRoot: document.querySelector("#rows"),
    rowSelector: "[data-person]",
    getRowKey: (row) => row.dataset.person,
    getCheckboxHost: (row) => row.querySelector(".cell"),
    getCandidates: () => [guest],
    getRevision: () => 1,
    pendingJournal: {
      load: (value) => {
        loadedScopes.push({ ...value });
        return journal.load(value);
      },
      save: (value, marker) => {
        savedScopes.push({ ...value });
        return journal.save(value, marker);
      },
      remove: (value, id) => journal.remove(value, id),
    },
    request: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, method: options.method });
      if (url.endsWith("/preview"))
        return {
          ...scope,
          id: "review-one",
          actorWallet: scope.wallet,
          nonce: body.nonce,
          requiresFinancialTransaction: false,
          expiresAt: Date.now() + 60000,
          rows: body.items.map((row) => ({
            ...row,
            name: "Synthetic guest",
            eligible: true,
          })),
          counts: { selected: 1, eligible: 1, blocked: 0 },
          canCommit: true,
          tokenStatus: "ready",
          blockNumber: 1,
          revision: 1,
        };
      if (url.endsWith("/commit")) {
        const retained = journal.load(scope);
        if (
          !retained ||
          retained.scope.mode !== "hosted-production" ||
          retained.scope.instanceId !== scope.instanceId
        )
          throw Error("Production intent was not durable before request");
        throw Error("Synthetic response lost after off-chain request");
      }
      throw Error("Unexpected fixture request");
    },
  });
  window.fixture = {
    scope,
    journal,
    controller,
    calls,
    loadedScopes,
    savedScopes,
  };
}
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (
      url.origin === origin &&
      req.method() === "GET" &&
      !req.postData() &&
      (url.pathname === "/" || modules.has(url.pathname))
    )
      return route.continue();
    blocked.push({ method: req.method(), path: url.pathname });
    return route.abort("blockedbyclient");
  });
  await context.addInitScript(() => {
    window.walletAccess = [];
    Object.defineProperty(window, "ethereum", {
      get() {
        window.walletAccess.push("get");
        return undefined;
      },
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(mount, scope);
  await expect(page.locator("#rows input")).toBeEnabled();
  assert.equal(
    await page.evaluate(() => window.fixture.loadedScopes[0].mode),
    "hosted-production",
  );
  await page.locator("#rows input").check();
  await page.locator('#toolbar [data-batch-action="review"]').click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.locator("[data-batch-confirm]").check();
  await page.locator('[data-batch-action="commit"]').click();
  await expect(page.locator("[data-batch-review-error]")).toContainText(
    /could not be confirmed/i,
  );
  const retained = await page.evaluate(() => ({
    saved: window.fixture.savedScopes,
    marker: window.fixture.journal.load(window.fixture.scope),
    calls: window.fixture.calls,
  }));
  assert.equal(retained.saved[0].mode, "hosted-production");
  assert.equal(retained.marker.scope.mode, "hosted-production");
  assert.equal(retained.marker.scope.instanceId, scope.instanceId);
  assert.deepEqual(
    retained.calls.map((call) => call.method),
    ["POST", "POST"],
  );
  checks.push(
    "Controller load and durable pre-request save retain explicit production mode and instance",
  );
  await page.reload();
  await page.evaluate(mount, scope);
  await expect(
    page.locator(
      '#toolbar > .batch-selection-tools [data-batch-action="status"]',
    ),
  ).toBeVisible();
  await expect(page.locator("#rows input")).toBeDisabled();
  assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
  checks.push(
    "Reload reconstructs pending production intent from actual journal without replay",
  );
  await page.evaluate(mount, { ...scope, instanceId: "production-server-two" });
  await expect(page.locator("#rows input")).toBeEnabled();
  await expect(
    page.locator(
      '#toolbar > .batch-selection-tools [data-batch-action="status"]',
    ),
  ).toBeHidden();
  assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
  checks.push(
    "A different production backend instance cannot inherit the pending controller or marker",
  );
  for (const chainId of [1337, 10200]) {
    await page.evaluate(mount, {
      ...scope,
      chainId,
      contractVersion: "kleros-event-v8",
      mode: "local-demo",
      instanceId: "legacy-instance",
    });
    await expect(page.locator("#rows input")).toBeEnabled();
    assert.equal(
      await page.evaluate(() =>
        Object.hasOwn(window.fixture.loadedScopes[0], "mode"),
      ),
      false,
    );
  }
  checks.push(
    "Legacy controller/journal scopes do not acquire a mode field or changed namespace",
  );
  assert.deepEqual(await page.evaluate(() => window.walletAccess), []);
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { status: "passed", checks, networkApiWrites: 0, walletAccess: 0 },
      null,
      2,
    ),
  );
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
