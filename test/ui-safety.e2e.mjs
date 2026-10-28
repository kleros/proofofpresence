import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";

// Deliberately controlled asynchronous wallet/file boundaries. Real nonce auth
// and local v7 simulation are used; no wallet transaction is broadcast here.
const server = await startServer({ port: 0, rpcPort: 0 });
const external = [],
  errors = [],
  importPosts = [],
  passed = [];
let browser;
let releaseWallet = null;
let walletRequests = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed.push(label);
};
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === server.url)
      return route.continue();
    external.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/events\/[^/]+\/imports(?:\/[^/]+\/commit)?$/.test(request.url())
    )
      importPosts.push(request.url());
  });
  const wallet = ethers.Wallet.createRandom().connect(
    server.workbench.provider,
  );
  await page.exposeFunction("__safetyWallet", async ({ method, params }) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts")
      return { value: [wallet.address] };
    if (method === "eth_chainId") return { value: "0x539" };
    if (method === "personal_sign")
      return { value: await wallet.signMessage(ethers.getBytes(params[0])) };
    if (method === "eth_sendTransaction") {
      walletRequests++;
      return new Promise((resolve) => {
        releaseWallet = resolve;
      });
    }
    throw new Error(`Unexpected synthetic wallet method: ${method}`);
  });
  await page.addInitScript(() => {
    window.ethereum = {
      request: async (args) => {
        const response = await window.__safetyWallet(args);
        if (response.error)
          throw Object.assign(new Error(response.error.message), {
            code: response.error.code,
          });
        return response.value;
      },
      on: () => {},
    };
  });
  const post = async (path, data) => {
    const response = await page.request.post(`${server.url}${path}`, {
      data,
      headers: { Origin: server.url },
    });
    const body = await response.json();
    assert.equal(response.ok(), true, `${path}: ${JSON.stringify(body)}`);
    return body;
  };
  const detail = async () =>
    (await page.request.get(`${server.url}/api/events/event-a`)).json();
  const refresh = async () => {
    const fresh = page.waitForResponse(
      (response) =>
        response.url() === `${server.url}/api/events/event-a` &&
        response.request().method() === "GET",
    );
    await page.locator("#refresh").click();
    await fresh;
    await expect(page.locator("#content")).toBeVisible();
  };
  const switchEvent = async (event) => {
    await page.locator("#event-switch").selectOption(event);
    await expect(page.locator("h1")).toHaveText(
      event === "event-a" ? "Proof of Presence" : "Open Justice Workshop",
    );
    await expect(page.locator("#event-switch")).toHaveValue(event);
  };
  const beginWalletRequest = async (expectedCount) => {
    await page.locator('[data-tx="deposit"]').first().click();
    await expect(page.locator("#review-dialog")).toBeVisible();
    await page.locator("[data-execute]").click();
    await expect.poll(() => walletRequests).toBe(expectedCount);
    await page.keyboard.press("Escape");
    await expect(page.locator("#review-dialog")).not.toBeVisible();
    await switchEvent("event-b");
    await switchEvent("event-a");
    await expect(page.locator('[data-tx="deposit"]:enabled')).toHaveCount(0);
  };

  await page.goto(`${server.url}/#event=event-a&view=participant`);
  await expect(page.locator("#event-switch")).toBeVisible();
  await page.locator("#top-identity").click();
  await page.locator("[data-connect-wallet]").click();
  await expect(page.locator("#top-identity")).toHaveText(
    "Verified browser wallet",
  );
  await post("/api/demo/fund", {});
  await page.locator("#reg-name").fill("Synthetic delayed wallet");
  await page.locator("#reg-email").fill("delayed-wallet@example.invalid");
  await page.locator('form[data-form="registration"] button').click();
  await expect(page.locator('[data-tx="deposit"]').first()).toBeEnabled();

  await beginWalletRequest(1);
  passed.push(
    "Unresolved wallet approval blocks another deposit after closing and switching events",
  );
  await refresh();
  await expect(page.locator('[data-tx="deposit"]:enabled')).toHaveCount(0);
  passed.push("Unresolved wallet approval survives authoritative refresh");
  releaseWallet({
    error: { code: 4001, message: "Synthetic user rejected wallet approval" },
  });
  await expect(page.locator("#toast")).toContainText(
    "Synthetic user rejected wallet approval",
  );
  await refresh();
  await expect(page.locator('[data-tx="deposit"]').first()).toBeEnabled();
  check(
    walletRequests,
    1,
    "Closing and navigation never starts a duplicate wallet request",
  );
  check(
    (await detail()).participants[0].deposit,
    null,
    "Rejected request creates no confirmed deposit",
  );
  passed.push(
    "Known wallet rejection clears intent and permits a fresh review",
  );

  // Durable storage must be usable before a new financial wallet request.
  await page.evaluate(() => {
    window.__safetyStorage = {
      get: Storage.prototype.getItem,
      set: Storage.prototype.setItem,
    };
    Storage.prototype.getItem = function () {
      throw new Error("Synthetic storage unavailable");
    };
    Storage.prototype.setItem = function () {
      throw new Error("Synthetic storage unavailable");
    };
  });
  await page.locator('[data-tx="deposit"]').first().click();
  await page.locator("[data-execute]").click();
  await expect(page.locator("#toast")).toContainText(/storage/i);
  check(
    walletRequests,
    1,
    "Unavailable durable storage prevents a second financial wallet prompt",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    Storage.prototype.getItem = window.__safetyStorage.get;
    Storage.prototype.setItem = window.__safetyStorage.set;
  });
  await refresh();
  await beginWalletRequest(2);
  // A later storage failure cannot discard a request already open in the wallet.
  await page.evaluate(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Synthetic post-prompt storage failure");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Synthetic post-prompt storage failure");
    };
  });
  await page.keyboard.press("Escape");
  await switchEvent("event-b");
  await switchEvent("event-a");
  await expect(page.locator('[data-tx="deposit"]:enabled')).toHaveCount(0);
  passed.push(
    "In-memory duplicate protection survives navigation after a post-prompt storage failure",
  );
  releaseWallet({
    error: {
      code: "UNKNOWN_OUTCOME",
      message: "Synthetic wallet transport outcome unknown",
    },
  });
  await expect(page.locator("#toast")).toContainText(
    "Synthetic wallet transport outcome unknown",
  );
  await refresh();
  await expect(page.locator('[data-tx="deposit"]:enabled')).toHaveCount(0);
  passed.push("Ambiguous wallet outcome retains duplicate-deposit protection");

  // A separate organizer identity has its own authority and pending namespace.
  await post("/api/session", { identity: "organizer-a" });
  await page.goto(`${server.url}/#event=event-a&view=organizer`);
  await expect(page.locator("#import-csv")).toBeVisible();
  await page.locator("#import-kind").selectOption("guests");
  const original = await (
    await page.request.get(
      `${server.url}/api/events/event-a/fixture?kind=guests`,
    )
  ).text();
  const older = original.replaceAll('"pending"', '"free"');
  const newest = original.replaceAll('"pending"', '"approved"');
  assert.notEqual(older, newest);
  await page.locator("#import-csv").fill(original);
  await page.locator('[name="reviewConfirmed"]').check();
  await page
    .locator("#review-note")
    .fill(
      "Synthetic source event and export checked for overlapping-read regression.",
    );
  await page.locator("[data-import-preview]").click();
  await expect(page.locator("[data-review-import]")).toBeEnabled();
  await page.evaluate(() => {
    const originalText = File.prototype.text;
    window.__csvSafetyReads = {};
    File.prototype.text = function () {
      if (!this.name.startsWith("race-")) return originalText.call(this);
      return new Promise((resolve) => {
        window.__csvSafetyReads[this.name] = resolve;
      });
    };
  });
  await page.locator("#import-file").setInputFiles({
    name: "race-older.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(older),
  });
  await expect
    .poll(() =>
      page.evaluate(() => !!window.__csvSafetyReads["race-older.csv"]),
    )
    .toBe(true);
  await expect(page.locator("[data-import-preview]")).toBeDisabled();
  await expect(page.locator("[data-review-import]:enabled")).toHaveCount(0);
  passed.push(
    "Starting a CSV read invalidates an existing preview and pauses validation",
  );
  await page.locator("#import-file").setInputFiles({
    name: "race-newest.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(newest),
  });
  await expect
    .poll(() =>
      page.evaluate(() => !!window.__csvSafetyReads["race-newest.csv"]),
    )
    .toBe(true);
  await expect(page.locator("[data-import-preview]")).toBeDisabled();
  await page.evaluate(
    ({ contents }) => {
      window.__csvSafetyReads["race-newest.csv"](contents);
    },
    { contents: newest },
  );
  await expect(page.locator("#import-csv")).toHaveValue(newest);
  await expect(page.locator("[data-import-preview]")).toBeEnabled();
  await expect(page.locator("[data-review-import]:enabled")).toHaveCount(0);
  await page.evaluate(
    async ({ contents }) => {
      window.__csvSafetyReads["race-older.csv"](contents);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    },
    { contents: older },
  );
  await expect(page.locator("#import-csv")).toHaveValue(newest);
  passed.push(
    "Newest selected file wins even when an older read finishes later",
  );
  await expect(page.locator("[data-review-import]:enabled")).toHaveCount(0);
  passed.push("Completed file reads require a fresh explicit source preview");

  await page.locator("[data-import-preview]").click();
  await expect(page.locator("[data-review-import]")).toBeEnabled();
  // Programmatic changes deliberately bypass input/change invalidation. Exact
  // source comparison must still protect both review and final application.
  await page.evaluate((contents) => {
    document.querySelector("#import-csv").value = contents;
  }, older);
  await page.locator("[data-review-import]").click();
  await expect(page.locator("#review-dialog")).not.toBeVisible();
  await expect(page.locator("#toast")).toContainText(/source|changed|stale/i);
  passed.push("Changed source bytes cannot open an actionable old review");
  await page.locator("#import-csv").fill(newest);
  await page.locator("[data-import-preview]").click();
  await page.locator("[data-review-import]").click();
  await expect(page.locator("[data-import-commit]")).toBeVisible();
  await page.evaluate((contents) => {
    document.querySelector("#import-csv").value = contents;
  }, older);
  await page.locator("[data-import-commit]").click();
  await expect(page.locator("#toast")).toContainText(/source|changed|stale/i);
  check(
    importPosts,
    [],
    "Stale source bytes are rejected before any import POST",
  );
  check(
    (await detail()).imports.length,
    0,
    "Overlapping file reads and stale reviews commit no batch",
  );
  check(external, [], "Safety checks attempt no external requests");
  check(errors, [], "Safety checks have no uncaught browser errors");
  await fs.mkdir(new URL("../artifacts/", import.meta.url), {
    recursive: true,
  });
  await fs.writeFile(
    new URL("../artifacts/ui-safety-results.json", import.meta.url),
    JSON.stringify(
      { passed: passed.length, checks: passed, external, errors },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `UI safety browser checks passed: ${passed.length} assertions plus Playwright expectations; no wallet transaction broadcast.`,
  );
} finally {
  releaseWallet?.({ error: { code: 4001, message: "Synthetic test cleanup" } });
  await browser?.close();
  await server.close();
}
