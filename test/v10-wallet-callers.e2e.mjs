// Focused mounted setup ordering only. Static loopback + in-memory DTO callbacks;
// no API transport, authentication, chain, signatures, submitted hash or send.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  makeLumaSetupFixture,
  makeLumaFactoryDraft,
} from "./fixtures/luma-launch-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = "kleros-event-v10-uups";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const { bootstrap } = makeLumaSetupFixture();
  const metadata = {
    ...bootstrap.contractProfile,
    contractVersion: profile,
    abiVersion: profile,
    version: 10,
  };
  Object.assign(bootstrap, {
    contractVersion: profile,
    abiVersion: profile,
    contractProfile: metadata,
    governance: {
      kind: "single-owner-immediate",
      initialOwner: "0x" + "2".repeat(40),
      upgradeDelaySeconds: 0,
      renounceable: true,
    },
  });
  bootstrap.capabilities.organizerJobs = true;
  Object.assign(bootstrap.factory, {
    contractVersion: profile,
    abiVersion: profile,
    upgrade: {
      kind: "uups",
      version: 10,
      verified: true,
      governanceKind: "single-owner-immediate",
      implementation: "0x" + "a".repeat(40),
      implementationCodeHash: "0x" + "b".repeat(64),
      authority: "0x" + "8".repeat(40),
      authorityCodeHash: "0x" + "c".repeat(64),
      initialOwner: "0x" + "2".repeat(40),
      owner: "0x" + "2".repeat(40),
      pendingOwner: "0x" + "0".repeat(40),
      upgradesDisabled: false,
      delaySeconds: 0,
      finalizationVerified: false,
      finalizationScope: "factory",
    },
  });
  const now = Date.now(),
    input = {
      title: "Synthetic pre-send ordering",
      lumaUrl: "https://luma.com/synthetic-ordering",
      startsAt: new Date(
        Math.floor(now / 1000) * 1000 + 86400000,
      ).toISOString(),
      endsAt: new Date(Math.floor(now / 1000) * 1000 + 93600000).toISOString(),
      timezone: "UTC",
      depositEth: "0.01",
    };
  const draft = makeLumaFactoryDraft(bootstrap, input, now);
  Object.assign(draft, { contractVersion: profile, abiVersion: profile });
  return { bootstrap, input, draft };
}
async function run() {
  const { chromium, expect } = await import("@playwright/test");
  const output = path.join(
    root,
    "artifacts/v10-wallet-callers",
    new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(),
  );
  await fs.mkdir(output, { recursive: true });
  const proof = {
    status: "running",
    checks: [],
    scenarios: [],
    requests: [],
    forbidden: [],
    errors: [],
    sources: {},
    limits: [
      "Actual mounted setup and frozen read-only helper, synthetic DTOs/provider only. No signature, send, backend API or canonical receipt proof.",
    ],
  };
  const names = [
    "public/app.js",
    "public/luma-setup.js",
    "public/environment.js",
    "public/v10-wallet-account.js",
    "test/v10-wallet-callers.e2e.mjs",
  ];
  for (const name of names)
    proof.sources[name] = sha(await fs.readFile(path.join(root, name)));
  let browser, origin;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    proof.requests.push({ method: req.method, path: url.pathname });
    if (
      req.method !== "GET" ||
      url.search ||
      (url.pathname !== "/" && !/^\/[a-z0-9-]+\.js$/.test(url.pathname))
    ) {
      proof.forbidden.push({ method: req.method, path: url.pathname });
      res.writeHead(405);
      return res.end();
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end('<!doctype html><main id="mount"></main>');
    }
    try {
      const bytes = await fs.readFile(
        path.join(root, "public", url.pathname.slice(1)),
      );
      res.writeHead(200, { "content-type": "application/javascript" });
      res.end(bytes);
    } catch {
      proof.forbidden.push({ path: url.pathname });
      res.writeHead(404);
      res.end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    origin = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({ headless: true });
    for (const scenario of ["validation-expiry", "context-revoked"]) {
      const context = await browser.newContext({
        timezoneId: "UTC",
        serviceWorkers: "block",
      });
      await context.route("**/*", (route) => {
        if (
          new URL(route.request().url()).origin !== origin ||
          route.request().method() !== "GET"
        ) {
          proof.forbidden.push({
            method: route.request().method(),
            url: route.request().url(),
          });
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => proof.errors.push(error.message));
      await page.goto(origin);
      await page.evaluate(async ({ bootstrap, input, draft }) => {
        const { mountLumaSetup } = await import("/luma-setup.js");
        let time = Date.now(),
          current = true,
          release;
        Date.now = () => time;
        const gate = new Promise((resolve) => (release = resolve)),
          calls = [],
          phases = [],
          requests = [];
        const actualSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith("kleros-factory-creation:v1:"))
            phases.push(JSON.parse(value).phase);
          return actualSet.call(this, key, value);
        };
        localStorage.setItem(
          "kleros-transactions:v1:foreign",
          "original-financial-hash",
        );
        let codePending = false,
          closingAccounts = false,
          prepared = draft;
        const provider = {
          request: async ({ method, params }) => {
            calls.push(method);
            if (method === "eth_chainId") return "0x1";
            if (method === "eth_accounts") {
              if (
                codePending &&
                calls.filter((x) => x === "eth_accounts").length >= 3
              )
                closingAccounts = true;
              return [bootstrap.session.wallet];
            }
            if (method === "eth_getBlockByNumber")
              return { number: "0x64", hash: "0x" + "a".repeat(64) };
            if (method === "eth_getCode") {
              codePending = true;
              await gate;
              return "0x";
            }
            throw Error(
              "No wallet send or other provider method is permitted: " + method,
            );
          },
        };
        const request = async (url, options = {}) => {
          const body = JSON.parse(options.body ?? "{}");
          requests.push({ url, operation: body.operation });
          if (
            url !== "/api/organizer/events/jobs" ||
            options.method !== "POST" ||
            !["prepare", "validate"].includes(body.operation)
          )
            throw Error("Unexpected synthetic operation");
          let result;
          if (body.operation === "prepare") {
            const terms = {
              ...draft.terms,
              ...body.input,
              eventStart: Date.parse(body.input.startsAt) / 1000,
            };
            terms.claimDeadline = terms.eventStart + 7 * 86400;
            prepared = {
              ...draft,
              terms,
              createdAt: time,
              expiresAt: time + 300000,
            };
            result = prepared;
          } else
            result = { draft: prepared, transaction: prepared.transaction };
          return {
            schemaVersion: 1,
            kind: "organizer-job",
            requestId: body.requestId,
            instanceId: bootstrap.instanceId,
            operation: body.operation,
            chainId: 1,
            factory: bootstrap.factory.address,
            contractVersion: bootstrap.contractVersion,
            wallet: bootstrap.session.wallet,
            state: "ready",
            expiresAt: time + (body.operation === "validate" ? 5000 : 300000),
            result,
          };
        };
        const controller = mountLumaSetup(document.querySelector("#mount"), {
          bootstrap,
          request,
          provider: () => provider,
          isCurrent: () => current,
        });
        window.__ordering = {
          input,
          calls,
          phases,
          requests,
          get codePending() {
            return codePending;
          },
          get closed() {
            return closingAccounts;
          },
          release: () => release(),
          expire: () => (time += 6000),
          revoke: () => (current = false),
          dispose: () => controller.dispose(),
        };
      }, fixture());
      const f = fixture().input;
      await page.locator('[name="title"]').fill(f.title);
      await page.locator('[name="lumaUrl"]').fill(f.lumaUrl);
      await page.locator('[name="startsAt"]').fill(f.startsAt.slice(0, 16));
      await page.locator('[name="endsAt"]').fill(f.endsAt.slice(0, 16));
      await page.locator('[name="depositEth"]').fill(f.depositEth);
      await page.locator('[data-luma-action="review"]').click();
      await expect(page.locator("[data-luma-dialog][open]")).toBeVisible();
      await page.locator('[data-luma-action="confirm"]').click();
      await page.waitForFunction(() => window.__ordering.codePending);
      const paused = await page.evaluate(() => ({
        phases: window.__ordering.phases,
        calls: window.__ordering.calls,
      }));
      assert.deepEqual(paused.phases, ["prepared"]);
      assert.equal(paused.calls.includes("eth_sendTransaction"), false);
      await page.evaluate((scenario) => {
        if (scenario === "validation-expiry") window.__ordering.expire();
        else window.__ordering.revoke();
        window.__ordering.release();
      }, scenario);
      await page.waitForFunction(() => window.__ordering.closed);
      if (scenario === "validation-expiry")
        await expect(page.locator("[data-luma-error]")).toContainText(
          /expired/i,
        );
      await page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await window.__ordering.dispose();
      });
      const facts = await page.evaluate(() => ({
        calls: window.__ordering.calls,
        phases: window.__ordering.phases,
        requests: window.__ordering.requests,
        foreignJournal: localStorage.getItem("kleros-transactions:v1:foreign"),
      }));
      assert.equal(facts.calls.includes("eth_sendTransaction"), false);
      assert.equal(facts.phases.includes("wallet-requested"), false);
      assert.equal(facts.foreignJournal, "original-financial-hash");
      assert.deepEqual(
        facts.requests.map((request) => request.operation),
        ["prepare", "validate"],
      );
      proof.scenarios.push({ scenario, ...facts });
      proof.checks.push(
        scenario === "validation-expiry"
          ? "Mounted V10 setup waits for account proof before consuming validation; expiry during its read prevents wallet marker/send"
          : "Mounted V10 setup rechecks context after account proof; revocation prevents wallet marker/send and retains foreign journals",
      );
      await context.close();
    }
    assert.deepEqual(proof.forbidden, []);
    assert.deepEqual(proof.errors, []);
    for (const name of names)
      assert.equal(
        sha(await fs.readFile(path.join(root, name))),
        proof.sources[name],
        "Source changed during focused check",
      );
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
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
      networkRequests: 0,
      signatures: 0,
      broadcasts: 0,
    }),
  );
else
  throw Error("Only --run-loopback for synthetic ordering checks is accepted");
