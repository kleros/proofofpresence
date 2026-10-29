import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeLumaSetupFixture } from "./fixtures/luma-launch-fixture.mjs";

// One synthetic widget, static loopback assets only. No wallet or API transport.
const root = fileURLToPath(new URL("../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function run() {
  const { chromium } = await import("@playwright/test");
  const out = path.join(
    root,
    "artifacts/luma-setup-dates",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
  );
  await fs.mkdir(out, { recursive: true });
  const proof = {
    status: "running",
    kind: "synthetic-loopback-date-widget",
    checks: [],
    forbidden: [],
    errors: [],
    logicalReviewRequests: 0,
    walletCalls: 0,
  };
  proof.sourceSha256 = Object.fromEntries(
    await Promise.all(
      ["public/luma-setup.js", "test/luma-setup-dates.e2e.mjs"].map(
        async (p) => [p, sha(await fs.readFile(path.join(root, p)))],
      ),
    ),
  );
  const allowed = new Set([
    "/luma-setup.js",
    "/transaction-context.js",
    "/luma-factory.js",
    "/environment.js",
    "/contract-profiles.js",
    "/luma-launch.js",
  ]);
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (pathname === "/") {
      res
        .writeHead(200, { "content-type": "text/html" })
        .end(
          "<!doctype html><html><head><title>Date widget fixture</title><link rel=icon href='data:,'></head><body><main></main></body></html>",
        );
      return;
    }
    if (!allowed.has(pathname)) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "no-store",
      })
      .end(await fs.readFile(path.join(root, "public", pathname.slice(1))));
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    for (const timezoneId of ["Asia/Bangkok", "America/New_York"]) {
      const context = await browser.newContext({ timezoneId });
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (
          new URL(request.url()).origin !== origin ||
          request.method() !== "GET"
        ) {
          proof.forbidden.push({
            url: request.url(),
            method: request.method(),
          });
          await route.abort();
        } else await route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => proof.errors.push(error.message));
      await page.goto(origin);
      const observed = await page.evaluate(
        async ({ bootstrap, timezoneId }) => {
          const { mountLumaSetup } = await import("/luma-setup.js");
          const checks = [],
            requests = [];
          let walletCalls = 0;
          const equal = (actual, expected, label) => {
            if (actual !== expected)
              throw Error(`${label}: ${actual} != ${expected}`);
          };
          const create = () => {
            const host = document.createElement("section");
            document.querySelector("main").append(host);
            const added = [],
              removed = [];
            const add = host.addEventListener.bind(host),
              remove = host.removeEventListener.bind(host);
            host.addEventListener = (name, listener, ...rest) => {
              added.push([name, listener]);
              add(name, listener, ...rest);
            };
            host.removeEventListener = (name, listener, ...rest) => {
              removed.push([name, listener]);
              remove(name, listener, ...rest);
            };
            const controller = mountLumaSetup(host, {
              bootstrap,
              isCurrent: () => true,
              request: async (url, init) => {
                requests.push({ url, input: JSON.parse(init.body) });
                throw Error("Stopped synthetic review capture");
              },
              provider: () => {
                walletCalls++;
                throw Error("Wallet unavailable in date fixture");
              },
            });
            return { host, controller, added, removed };
          };
          const field = (widget, name) =>
            widget.host.querySelector(`[name="${name}"]`);
          const set = (widget, name, value, commit = true) => {
            const node = field(widget, name);
            node.value = value;
            node.dispatchEvent(new Event("input", { bubbles: true }));
            if (commit)
              node.dispatchEvent(new Event("change", { bubbles: true }));
          };
          const widget = create();
          if (timezoneId === "Asia/Bangkok") {
            for (const [start, end] of [
              ["2030-11-05T10:00", "2030-11-05T12:00"],
              ["2030-11-05T23:30", "2030-11-06T01:30"],
              ["2030-01-31T23:30", "2030-02-01T01:30"],
              ["2030-12-31T23:30", "2031-01-01T01:30"],
              ["2032-02-28T23:30", "2032-02-29T01:30"],
            ]) {
              set(widget, "startsAt", start);
              equal(
                field(widget, "endsAt").value,
                end,
                "automatic end follows committed start",
              );
              equal(
                field(widget, "endsAt").min,
                start,
                "end minimum follows start",
              );
            }
            checks.push("default-two-hours-and-day-month-year-leap-rollovers");
            const previous = field(widget, "endsAt").value;
            set(widget, "startsAt", "", false);
            equal(
              field(widget, "endsAt").value,
              previous,
              "partial start preserves end",
            );
            set(widget, "startsAt", "0002-11-05T10:00");
            equal(
              field(widget, "endsAt").value,
              previous,
              "past year segment preserves end",
            );
            set(widget, "startsAt", "2030-11-06T10:00", false);
            equal(
              field(widget, "endsAt").value,
              previous,
              "uncommitted input preserves end",
            );
            field(widget, "startsAt").dispatchEvent(
              new Event("change", { bubbles: true }),
            );
            equal(
              field(widget, "endsAt").value,
              "2030-11-06T12:00",
              "committed start updates end",
            );
            checks.push(
              "partial-past-and-uncommitted-start-do-not-rewrite-end",
            );
            set(widget, "endsAt", "2030-11-06T13:15");
            set(widget, "startsAt", "2030-11-07T10:00");
            equal(
              field(widget, "endsAt").value,
              "2030-11-06T13:15",
              "manual invalid end is preserved",
            );
            set(widget, "endsAt", "", false);
            set(widget, "startsAt", "2030-11-08T10:00");
            equal(
              field(widget, "endsAt").value,
              "",
              "manually cleared end stays empty",
            );
            checks.push(
              "manual-valid-invalid-and-partial-end-values-preserved",
            );
            const form = widget.host.querySelector("form");
            const replacement = form.cloneNode(true);
            replacement.reset();
            form.replaceWith(replacement);
            set(widget, "startsAt", "2030-11-09T10:00");
            equal(
              field(widget, "endsAt").value,
              "2030-11-09T12:00",
              "new form resets manual ownership",
            );
            const second = create();
            set(second, "startsAt", "2030-12-01T09:00");
            equal(
              field(widget, "endsAt").value,
              "2030-11-09T12:00",
              "independent mounts keep own dates",
            );
            equal(
              field(second, "endsAt").value,
              "2030-12-01T11:00",
              "second mount suggests end",
            );
            second.controller.dispose();
            checks.push("new-form-and-independent-mount-date-state-isolated");
            set(widget, "title", "Synthetic date setup");
            set(widget, "lumaUrl", "https://luma.com/synthetic-date-fixture");
            set(widget, "depositEth", "0.01");
            widget.host
              .querySelector("form")
              .dispatchEvent(
                new Event("submit", { bubbles: true, cancelable: true }),
              );
            await new Promise((resolve) => setTimeout(resolve, 0));
            equal(requests.length, 1, "one logical review capture");
            equal(
              requests[0].input.startsAt,
              "2030-11-09T03:00:00.000Z",
              "start UTC conversion unchanged",
            );
            equal(
              requests[0].input.endsAt,
              "2030-11-09T05:00:00.000Z",
              "end UTC conversion unchanged",
            );
            equal(requests[0].input.timezone, timezoneId, "timezone unchanged");
            set(widget, "endsAt", "2030-11-08T09:00");
            widget.host
              .querySelector("form")
              .dispatchEvent(
                new Event("submit", { bubbles: true, cancelable: true }),
              );
            await new Promise((resolve) => setTimeout(resolve, 0));
            equal(requests.length, 1, "invalid interval cannot prepare review");
            checks.push(
              "existing-utc-payload-and-interval-validation-preserved",
            );
          } else {
            set(widget, "startsAt", "2030-03-10T01:30");
            equal(
              field(widget, "endsAt").value,
              "2030-03-10T04:30",
              "spring DST uses two elapsed hours",
            );
            const previous = field(widget, "endsAt").value;
            set(widget, "startsAt", "2030-03-10T02:30");
            equal(
              field(widget, "endsAt").value,
              previous,
              "nonexistent DST start cannot suggest",
            );
            const repeated = create();
            set(repeated, "startsAt", "2030-11-03T00:30");
            equal(
              field(repeated, "endsAt").value,
              "",
              "ambiguous automatic end declines suggestion",
            );
            repeated.controller.dispose();
            checks.push(
              "dst-gap-and-repeated-hour-do-not-silently-change-instant",
            );
          }
          const old = widget.host.querySelector("form");
          widget.controller.dispose();
          for (const name of ["input", "change"]) {
            const listener = widget.added.find(
              ([entry]) => entry === name,
            )?.[1];
            equal(
              widget.removed.some(
                ([entry, removed]) => entry === name && removed === listener,
              ),
              true,
              `${name} listener removed`,
            );
          }
          widget.host.append(old);
          const endBefore = field(widget, "endsAt").value;
          set(widget, "startsAt", "2031-12-01T10:00");
          equal(
            field(widget, "endsAt").value,
            endBefore,
            "disposed widget cannot change dates",
          );
          equal(walletCalls, 0, "no wallet access");
          checks.push("dispose-removes-date-listeners-and-prevents-late-edits");
          return {
            checks,
            logicalReviewRequests: requests.length,
            walletCalls,
          };
        },
        { bootstrap: makeLumaSetupFixture().bootstrap, timezoneId },
      );
      proof.checks.push(
        ...observed.checks.map((name) => `${timezoneId}:${name}`),
      );
      proof.logicalReviewRequests += observed.logicalReviewRequests;
      proof.walletCalls += observed.walletCalls;
      await context.close();
    }
    assert.deepEqual(proof.forbidden, []);
    assert.deepEqual(proof.errors, []);
    assert.equal(proof.walletCalls, 0);
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.errors.push(error.message);
    throw error;
  } finally {
    await browser?.close();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await fs.writeFile(
      path.join(out, "proof.json"),
      JSON.stringify(proof, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        { ...proof, proofPath: path.join(out, "proof.json") },
        null,
        2,
      ),
    );
  }
}
if (process.argv.includes("--run-loopback")) await run();
else
  console.log(
    "Run with --run-loopback; only synthetic local date-widget checks are enabled.",
  );
