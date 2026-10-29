// Synthetic loopback widget integration only. The wallet and job transport are in-page stubs;
// these assertions establish UI orchestration, never real financial execution or public availability.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  makeLumaSetupFixture,
  makeLumaFactoryDraft,
} from "./fixtures/luma-launch-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
async function run() {
  const { chromium } = await import("@playwright/test");
  const out = path.join(
    root,
    "artifacts/organizer-jobs-ui",
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID(),
  );
  await fs.mkdir(out, { recursive: true });
  const proof = {
    status: "running",
    kind: "synthetic-loopback-organizer-job-widget",
    checks: [],
    errors: [],
    forbidden: [],
  };
  proof.sources = Object.fromEntries(
    await Promise.all(
      ["public/luma-setup.js", "test/organizer-jobs-ui.e2e.mjs"].map(
        async (file) => [
          file,
          createHash("sha256")
            .update(await fs.readFile(path.join(root, file)))
            .digest("hex"),
        ],
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
    const name = new URL(req.url, "http://127.0.0.1").pathname;
    if (req.method !== "GET") return res.writeHead(405).end();
    if (name === "/")
      return res
        .writeHead(200, { "content-type": "text/html" })
        .end(
          "<!doctype html><html><head><link rel=icon href='data:,'></head><body><main></main></body></html>",
        );
    if (!allowed.has(name)) return res.writeHead(404).end();
    res
      .writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "no-store",
      })
      .end(await fs.readFile(path.join(root, "public", name.slice(1))));
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
    const context = await browser.newContext({ timezoneId: "Asia/Bangkok" });
    await context.route("**/*", async (route) => {
      const req = route.request();
      if (
        new URL(req.url()).origin !== origin ||
        req.method() !== "GET" ||
        !["/", ...allowed].includes(new URL(req.url()).pathname)
      ) {
        proof.forbidden.push({ method: req.method(), url: req.url() });
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => proof.errors.push(error.message));
    await page.goto(origin);
    const { bootstrap } = makeLumaSetupFixture();
    bootstrap.capabilities.organizerJobs = true;
    const input = {
      title: "Synthetic background event",
      lumaUrl: "https://luma.com/synthetic-background-event",
      startsAt: "2030-11-05T03:00:00.000Z",
      endsAt: "2030-11-05T05:00:00.000Z",
      timezone: "Asia/Bangkok",
      depositEth: "0.01",
    };
    const draft = makeLumaFactoryDraft(bootstrap, input);
    const results = await page.evaluate(
      async ({ bootstrap, input, baseDraft }) => {
        const { mountLumaSetup } = await import("/luma-setup.js");
        const checks = [],
          totals = {
            walletRequests: 0,
            prepares: 0,
            validates: 0,
            reconciles: 0,
            reports: 0,
          };
        const realNow = Date.now;
        let shift = 0;
        Date.now = () => realNow() + shift;
        const equal = (actual, expected, label) => {
          if (JSON.stringify(actual) !== JSON.stringify(expected))
            throw Error(label + ": " + JSON.stringify(actual));
        };
        const wait = async (predicate) => {
          for (let i = 0; i < 300; i++) {
            if (predicate()) return;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw Error("Widget checkpoint timed out");
        };
        const click = (host, action) => {
          const button = host.querySelector(`[data-luma-action="${action}"]`);
          if (!button || button.disabled)
            throw Error("Unavailable explicit action " + action);
          button.click();
        };
        async function scenario(mode) {
          localStorage.clear();
          localStorage.setItem("foreign-financial-marker", "preserve-exactly");
          shift = 0;
          const calls = [],
            walletCalls = [],
            jobs = new Map();
          let controller,
            host,
            firstLost = mode === "lost-ack",
            receiptChecks = 0;
          const draft = structuredClone(baseDraft);
          draft.createdAt = Date.now();
          draft.expiresAt = Date.now() + 300000;
          const hash = "0x" + "9".repeat(64);
          const request = async (url, options = {}) => {
            const body = options.body ? JSON.parse(options.body) : null;
            calls.push({ url, method: options.method ?? "GET", body });
            if (url.endsWith("/submitted")) {
              totals.reports++;
              equal(body, { hash }, "Direct submitted hash report");
              return { status: "submitted" };
            }
            if (url === "/api/organizer/events/jobs") {
              if (options.method !== "POST")
                throw Error("Initial job method differs");
              jobs.set(body.requestId, body);
              if (body.operation === "reconcile") receiptChecks++;
              totals[
                body.operation === "prepare"
                  ? "prepares"
                  : body.operation === "validate"
                    ? "validates"
                    : "reconciles"
              ]++;
              if (body.operation === "prepare")
                equal(
                  body.input,
                  input,
                  "Date conversion and exact six immutable terms retained",
                );
              if (firstLost) {
                firstLost = false;
                throw Object.assign(Error("Synthetic lost acknowledgement"), {
                  status: 504,
                });
              }
            }
            const requestId =
                body?.requestId ?? decodeURIComponent(url.split("/").at(-1)),
              job = jobs.get(requestId);
            if (!job) throw Error("Synthetic job not found");
            const scope = {
              schemaVersion: 1,
              kind: "organizer-job",
              requestId,
              instanceId: bootstrap.instanceId,
              operation: job.operation,
              chainId: 1,
              factory: bootstrap.factory.address,
              contractVersion: "kleros-event-v9-uups",
              wallet: bootstrap.session.wallet,
            };
            if (body) return { ...scope, state: "pending", pollAfterMs: 1 };
            const result =
              job.operation === "prepare"
                ? draft
                : job.operation === "validate"
                  ? { draft, transaction: draft.transaction }
                  : {
                      status:
                        mode === "success" && receiptChecks === 1
                          ? "pending"
                          : "confirmed",
                      hash: job.hash,
                      eventId: draft.eventId,
                      wallet: bootstrap.session.wallet,
                      chainId: 1,
                      blockNumber: 123,
                      contract: "0x" + "7".repeat(40),
                      participantUrl:
                        location.origin +
                        "/#event=" +
                        draft.eventId +
                        "&view=participant",
                    };
            return {
              ...scope,
              state: "ready",
              expiresAt:
                Date.now() + (job.operation === "validate" ? 5000 : 300000),
              result,
            };
          };
          const mount = () => {
            host = document.createElement("section");
            document.querySelector("main").append(host);
            controller = mountLumaSetup(host, {
              bootstrap,
              request,
              isCurrent: () => true,
              provider: () => ({
                request: async (payload) => {
                  walletCalls.push(payload.method);
                  if (payload.method === "eth_accounts") {
                    if (mode === "expired-validation") shift += 6000;
                    return [bootstrap.session.wallet];
                  }
                  if (payload.method === "eth_chainId") return "0x1";
                  if (payload.method === "eth_sendTransaction") {
                    totals.walletRequests++;
                    equal(
                      payload.params[0],
                      {
                        to: draft.transaction.to,
                        from: draft.transaction.from,
                        data: draft.transaction.data,
                        value: "0x0",
                        chainId: "0x1",
                      },
                      "Only exact reviewed transaction reaches synthetic wallet",
                    );
                    shift += 10000;
                    return hash; // A wallet may remain open beyond validation's five-second deadline.
                  }
                  throw Error("Unexpected wallet method " + payload.method);
                },
              }),
            });
            for (const [name, value] of Object.entries({
              title: input.title,
              lumaUrl: input.lumaUrl,
              startsAt: "2030-11-05T10:00",
              endsAt: "2030-11-05T12:00",
              depositEth: input.depositEth,
            })) {
              const node = host.querySelector(`[name="${name}"]`);
              node.value = value;
              node.dispatchEvent(new Event("input", { bubbles: true }));
              node.dispatchEvent(new Event("change", { bubbles: true }));
            }
          };
          const postCount = () =>
            calls.filter(
              (call) =>
                call.method === "POST" && call.body?.operation === "prepare",
            ).length;
          mount();
          const form = host.querySelector("form");
          click(host, "review");
          if (mode === "lost-ack") {
            await wait(
              () =>
                host
                  .querySelector("[data-luma-error]")
                  ?.textContent.includes("lost acknowledgement") &&
                !host.querySelector('[data-luma-action="review"]').disabled,
            );
            equal(
              host.querySelector("form") === form,
              true,
              "Lost response preserves exact form DOM",
            );
            equal(
              form.elements.namedItem("title").value,
              input.title,
              "Lost response preserves title",
            );
            equal(postCount(), 1, "One initial preparation POST");
            equal(walletCalls, [], "No wallet during failed preparation");
            controller.dispose();
            host.remove();
            mount();
            click(host, "review");
            await wait(
              () => document.querySelector("dialog[data-luma-dialog]")?.open,
            );
            equal(
              postCount(),
              1,
              "Reload and same terms recover by status GET only",
            );
            equal(
              calls.at(-1).method,
              "GET",
              "Status GET resumes saved identity",
            );
            checks.push(
              "Lost acknowledgement preserves form and reload resumes the same ID by GET without replay",
            );
          } else {
            await wait(
              () => document.querySelector("dialog[data-luma-dialog]")?.open,
            );
            const dialog = document.querySelector("dialog[data-luma-dialog]");
            for (const fact of [
              "0.01 ETH",
              bootstrap.factory.address,
              "Ethereum Mainnet",
              "0 ETH",
              input.title,
            ])
              if (!dialog.textContent.includes(fact))
                throw Error(
                  "Missing exact reviewed financial/context fact " + fact,
                );
            equal(walletCalls, [], "Prepare and review never request wallet");
            click(dialog, "confirm");
            if (mode === "expired-validation") {
              await wait(
                () =>
                  host.querySelector('[data-luma-action="reset-review"]') &&
                  !host.querySelector('[data-luma-action="reset-review"]')
                    .disabled,
              );
              equal(
                walletCalls.includes("eth_sendTransaction"),
                false,
                "Expired validation never opens wallet transaction",
              );
              equal(
                document.querySelector("dialog[data-luma-dialog]"),
                null,
                "Expired unsigned review closes",
              );
              equal(
                host.querySelector("form") === form,
                true,
                "Validation expiry preserves form DOM",
              );
            } else {
              await wait(
                () =>
                  host.querySelector('[data-luma-action="reconcile"]') &&
                  !host.querySelector('[data-luma-action="reconcile"]')
                    .disabled,
              );
              equal(
                host.querySelector('[data-luma-action="reconcile"]')
                  .textContent,
                "Check transaction again",
                "Completed pending receipt permits explicit same-hash check",
              );
              equal(
                walletCalls.filter((method) => method === "eth_sendTransaction")
                  .length,
                1,
                "Pending receipt retains one original wallet request",
              );
              click(host, "reconcile");
              await wait(() => host.querySelector("[data-luma-created]"));
              equal(
                walletCalls.filter((method) => method === "eth_sendTransaction")
                  .length,
                1,
                "One wallet request only",
              );
              equal(
                calls.filter((call) => call.url.endsWith("/submitted")).length,
                1,
                "Direct known-hash report retained",
              );
              equal(
                calls.filter((call) => call.body?.operation === "validate")
                  .length,
                1,
                "Separate validation job",
              );
              equal(
                calls.filter((call) => call.body?.operation === "reconcile")
                  .length,
                2,
                "Original and explicitly refreshed canonical receipt jobs",
              );
              equal(
                calls
                  .filter((call) => call.body?.operation === "reconcile")
                  .map((call) => call.body.hash),
                [hash, hash],
                "Every receipt check retains the same original hash",
              );
              checks.push(
                "Explicit review → validation job → one exact synthetic wallet request → direct hash report → receipt job; wallet delay preserves recovery",
              );
            }
          }
          if (mode === "expired-validation") {
            const financial = Object.keys(localStorage).filter((key) =>
              key.startsWith("kleros-factory-creation:v1:"),
            );
            equal(
              financial,
              [],
              "Only unsigned prepared financial marker is cleared",
            );
            const before = postCount();
            click(host, "reset-review");
            equal(
              postCount(),
              before,
              "Explicit reset never starts a job automatically",
            );
            click(host, "review");
            await wait(
              () => document.querySelector("dialog[data-luma-dialog]")?.open,
            );
            equal(
              postCount(),
              before + 1,
              "Separate explicit Review creates fresh ID after reset",
            );
            checks.push(
              "Validation expiring during wallet account check blocks send, preserves form, and requires explicit new-review reset",
            );
          }
          equal(
            localStorage.getItem("foreign-financial-marker"),
            "preserve-exactly",
            "Unrelated financial storage survives every path",
          );
          controller.dispose();
          host.remove();
          equal(
            document.querySelectorAll("dialog[data-luma-dialog]").length,
            0,
            "Disposed dialog removed",
          );
        }
        try {
          for (const mode of ["success", "lost-ack", "expired-validation"])
            await scenario(mode);
        } finally {
          Date.now = realNow;
        }
        return { checks, totals };
      },
      { bootstrap, input, baseDraft: draft },
    );
    proof.checks = results.checks;
    proof.totals = results.totals;
    assert.deepEqual(proof.errors, []);
    assert.deepEqual(proof.forbidden, []);
    assert.equal(results.totals.walletRequests, 1);
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
    "Use --run-loopback for synthetic organizer job/widget checks only; no public API or wallet execution.",
  );
