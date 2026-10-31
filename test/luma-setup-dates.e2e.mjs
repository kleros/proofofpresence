import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeLumaSetupFixture, makeLumaFactoryDraft } from "./fixtures/luma-launch-fixture.mjs";

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
      ["public/luma-setup.js", "public/event-timezone.js", "test/luma-setup-dates.e2e.mjs"].map(
        async (p) => [p, sha(await fs.readFile(path.join(root, p)))],
      ),
    ),
  );
  const allowed = new Set([
    "/luma-setup.js",
    "/setup-progress.js",
    "/transaction-context.js",
    "/luma-factory.js",
    "/environment.js",
    "/contract-profiles.js",
    "/luma-launch.js",
    "/event-timezone.js",
    "/v10-wallet-account.js",
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
        async ({ bootstrap, timezoneId, reviewDraft }) => {
          const { mountLumaSetup } = await import("/luma-setup.js");
          const checks = [],
            requests = [];
          let walletCalls = 0;
          const equal = (actual, expected, label) => {
            if (actual !== expected)
              throw Error(`${label}: ${actual} != ${expected}`);
          };
          const create = (readyDraft = null) => {
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
                if (readyDraft) return structuredClone(readyDraft);
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
          const choices = field(widget, "timezoneChoice");
          equal(choices.tagName, "SELECT", "common zones use a native choice control");
          for (const zone of ["Asia/Kolkata", "Asia/Bangkok", "UTC"]) {
            set(widget, "timezoneChoice", zone);
            equal(field(widget, "timezone").value, zone, "curated choice updates the authoritative IANA input");
          }
          set(widget, "timezone", "Asia/Kathmandu");
          equal(choices.value, "custom", "custom IANA search remains available");
          set(widget, "timezone", timezoneId);
          equal(field(widget, "timezone").value, timezoneId, "browser timezone restored for existing date cases");
          equal(widget.host.querySelector("#luma-capacity").value, "150", "contract capacity remains 150");
          equal(widget.host.querySelector("#luma-capacity").readOnly, true, "fixed capacity cannot imply a configurable contract limit");
          checks.push("curated-zone-choices-custom-search-and-fixed-capacity");
          equal(field(widget, "timezone").value, timezoneId, "browser timezone defaults the event zone");
          equal(field(widget, "timezone").readOnly, false, "event timezone is editable");
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
            const selected = create();
            set(selected, "title", "Synthetic selected timezone");
            set(selected, "lumaUrl", "https://luma.com/synthetic-selected-zone");
            set(selected, "depositEth", "0.01");
            set(selected, "timezone", "Asia/Kathmandu");
            set(selected, "startsAt", "2030-11-10T10:00");
            equal(field(selected, "endsAt").value, "2030-11-10T12:00", "selected zone keeps two elapsed hours");
            selected.host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            await new Promise(resolve => setTimeout(resolve, 0));
            equal(requests.at(-1).input.startsAt, "2030-11-10T04:15:00.000Z", "Kathmandu converts independently of Bangkok browser");
            equal(requests.at(-1).input.timezone, "Asia/Kathmandu", "selected IANA label is submitted");
            set(selected, "timezone", "UTC");
            selected.host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            await new Promise(resolve => setTimeout(resolve, 0));
            equal(requests.at(-1).input.startsAt, "2030-11-10T10:00:00.000Z", "changing zone changes the UTC instant");
            checks.push("editable-selected-zone-controls-UTC-payload-not-browser-label");
            const beforeAmbiguous = requests.length;
            set(selected, "timezone", "America/New_York");
            set(selected, "startsAt", "2030-11-03T01:30");
            selected.host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            await new Promise(resolve => setTimeout(resolve, 0));
            equal(requests.length, beforeAmbiguous, "ambiguous selected-zone wall clock never prepares a review");
            equal(/occurs twice.*UTC/.test(selected.host.querySelector("[data-luma-error]").textContent), true, "fold explains the explicit UTC alternative");
            selected.controller.dispose();
            checks.push("selected-zone-fold-rejected-with-explicit-error");
            const review = create(reviewDraft);
            set(review, "title", reviewDraft.terms.title); set(review, "lumaUrl", reviewDraft.terms.lumaUrl);
            set(review, "depositEth", "0.01"); set(review, "timezone", "Asia/Kathmandu");
            set(review, "startsAt", "2030-11-10T10:00");
            review.host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            await new Promise(resolve => setTimeout(resolve, 0));
            const dialog = review.host.querySelector("dialog");
            equal(Boolean(dialog?.open), true, "synthetic timezone review opens");
            equal(dialog.textContent.includes("2030-11-10 10:00 Asia/Kathmandu"), true, "review shows the chosen wall clock and zone");
            equal(dialog.textContent.includes("2030-11-10 04:15:00 UTC"), true, "review retains exact UTC reference");
            set(review, "timezoneChoice", "UTC");
            equal(field(review, "timezone").value, "UTC", "curated timezone updates the IANA field");
            equal(Boolean(review.host.querySelector("dialog[open]")), false, "curated timezone edit invalidates the open review");
            review.controller.dispose();
            checks.push("review-displays-selected-zone-and-zone-edit-invalidates-review");
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
        { bootstrap: makeLumaSetupFixture().bootstrap, timezoneId,
          reviewDraft: makeLumaFactoryDraft(makeLumaSetupFixture().bootstrap, { title: "Synthetic timezone review", lumaUrl: "https://luma.com/synthetic-timezone-review",
            startsAt: "2030-11-10T04:15:00.000Z", endsAt: "2030-11-10T06:15:00.000Z", timezone: "Asia/Kathmandu", depositEth: "0.01" }) },
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
