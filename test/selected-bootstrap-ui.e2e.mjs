import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { startServer } from "../src/server.mjs";
import { selectedEventResult } from "../public/selected-event.js";

// Real local contracts/backend and current frontend. Browser writes are limited
// to the three explicitly selected synthetic demo-session changes below.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(
  root,
  "artifacts/ui-ux-audit/integrated/joint-browser",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await fs.mkdir(output, { recursive: true });
const publicPaths = new Set([
  "/",
  "/index.html",
  ...(await fs.readdir(path.join(root, "public")))
    .filter((name) => /\.(js|css)$/.test(name))
    .map((name) => "/" + name),
  ...(await fs.readdir(path.join(root, "public/assets")))
    .filter((name) => /\.(svg|woff2)$/.test(name))
    .map((name) => "/assets/" + name),
]);
const proof = {
  status: "running",
  scope:
    "Real local v7/v8 selected-bootstrap UI integration; no browser financial action or wallet signing",
  setup:
    "Isolated Ganache initial contract deployment only; no public chain or external service",
  sourceSha256: {},
  versions: [],
};
for (const name of [
  "src/server.mjs",
  "src/workbench.mjs",
  "public/index.html",
  "public/app.js",
  "public/selected-event.js",
])
  proof.sourceSha256[name] = createHash("sha256")
    .update(await fs.readFile(path.join(root, name)))
    .digest("hex");
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const contractVersion of ["truth-pays-v7", "kleros-event-v8"]) {
    const server = await startServer({
      port: 0,
      rpcPort: 0,
      contractVersion,
      deployment: { mode: "local-demo" },
    });
    const record = {
      contractVersion,
      checks: [],
      loads: [],
      sessionChanges: [],
    };
    proof.versions.push(record);
    let context;
    try {
      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "block",
      });
      const blocked = [],
        pageErrors = [],
        httpErrors = [],
        reads = [];
      const bootstraps = [],
        acknowledgements = [],
        pendingBodies = [];
      let sessionIntent = null;
      await context.route("**/*", (route) => {
        const req = route.request(),
          url = new URL(req.url());
        let allowed = false;
        if (
          url.origin === server.url &&
          !url.search &&
          req.method() === "GET" &&
          !req.postData()
        )
          allowed = publicPaths.has(url.pathname);
        if (
          url.origin === server.url &&
          url.pathname === "/api/bootstrap" &&
          req.method() === "GET" &&
          !req.postData()
        ) {
          const keys = [...url.searchParams.keys()];
          allowed =
            keys.length === 1 &&
            keys[0] === "selectedEventId" &&
            ["event-a", "event-b"].includes(
              url.searchParams.get("selectedEventId"),
            );
          if (allowed)
            reads.push({
              path: url.pathname,
              selectedEventId: url.searchParams.get("selectedEventId"),
            });
        }
        if (
          url.origin === server.url &&
          url.pathname === "/api/session" &&
          !url.search &&
          sessionIntent &&
          !sessionIntent.used &&
          req.method() === sessionIntent.method
        ) {
          let body;
          try {
            body = JSON.parse(req.postData() ?? "null");
          } catch {}
          allowed =
            !!body &&
            (sessionIntent.method === "POST"
              ? Object.keys(body).length === 1 &&
                body.identity === sessionIntent.identity
              : Object.keys(body).length === 0);
          if (allowed) sessionIntent.used = true;
        }
        if (allowed) return route.continue();
        blocked.push({
          method: req.method(),
          path: url.pathname,
          offOrigin: url.origin !== server.url,
        });
        return route.abort("blockedbyclient");
      });
      await context.routeWebSocket("**/*", (socket) => {
        blocked.push({ method: "WebSocket", path: socket.url() });
        socket.close();
      });
      await context.addInitScript(() => {
        window.__jointWalletAccess = [];
        Object.defineProperty(window, "ethereum", {
          configurable: false,
          get() {
            window.__jointWalletAccess.push("get");
            return undefined;
          },
          set() {
            window.__jointWalletAccess.push("set");
          },
        });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(45_000);
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => {
        if (response.status() >= 400)
          httpErrors.push({
            path: new URL(response.url()).pathname,
            status: response.status(),
          });
        const req = response.request(),
          pathname = new URL(response.url()).pathname;
        if (["/api/bootstrap", "/api/session"].includes(pathname))
          pendingBodies.push(
            (async () => {
              const value = await response.json();
              assert.equal(response.status(), 200, pathname + " must succeed");
              (pathname === "/api/bootstrap"
                ? bootstraps
                : acknowledgements
              ).push({ method: req.method(), value });
            })(),
          );
      });
      function check(message) {
        record.checks.push(message);
      }
      async function load(label, eventId, identity, action, mutation = null) {
        const start = bootstraps.length,
          readStart = reads.length,
          ackStart = acknowledgements.length;
        sessionIntent = mutation;
        await action();
        await expect.poll(() => bootstraps.length - start).toBe(1);
        await expect(page.locator("#content")).toBeVisible();
        await expect(page.locator("#event-switch")).toHaveValue(eventId);
        await expect(page.locator("#loading")).toBeHidden();
        await expect(page.locator("#refresh")).toHaveAttribute(
          "aria-busy",
          "false",
        );
        await Promise.all(pendingBodies);
        assert.equal(
          bootstraps.length - start,
          1,
          label + " must not reload twice",
        );
        assert.deepEqual(
          reads.slice(readStart),
          [{ path: "/api/bootstrap", selectedEventId: eventId }],
          label + " needs exactly one selected read",
        );
        const boot = bootstraps[start].value;
        const expectedActor = identity
          ? boot.identities.find((x) => x.id === identity)
          : null;
        if (identity)
          assert(expectedActor, "Expected synthetic identity exists");
        const expectedWallet = expectedActor?.wallet ?? null;
        assert.equal(boot.mode, "local-demo");
        assert.equal(boot.contractVersion, contractVersion);
        assert.equal(boot.session?.wallet ?? null, expectedWallet);
        assert.equal(boot.selectedEvent.wallet, expectedWallet);
        const result = selectedEventResult(boot, {
          eventId,
          capturedWallet: expectedWallet,
          hasCapturedSession: true,
        });
        assert(
          result?.detail,
          "Actual body must pass current client validator",
        );
        assert.equal(result.detail, boot.selectedEvent.detail);
        assert.equal(result.detail.event.contractVersion, contractVersion);
        assert.equal(result.detail.event.chainId, 1337);
        if (mutation) {
          assert.equal(mutation.used, true);
          assert.equal(acknowledgements.length - ackStart, 1);
          const ack = acknowledgements[ackStart];
          assert.equal(ack.method, mutation.method);
          if (identity) assert.equal(ack.value.wallet, expectedWallet);
          else assert.equal(ack.value.ok, true);
          record.sessionChanges.push({ method: ack.method, identity });
        } else assert.equal(acknowledgements.length, ackStart);
        sessionIntent = null;
        record.loads.push({
          label,
          eventId,
          actor: identity,
          apiReads: 1,
          fallbackEventReads: 0,
          instanceId: boot.instanceId,
          participantCount: result.detail.participants.length,
        });
        return { boot, detail: result.detail, wallet: expectedWallet };
      }
      function anonymous(detail) {
        assert.equal(detail.ownWallet, null);
        assert.equal(detail.personal, null);
        for (const key of [
          "participants",
          "deposits",
          "unmatched",
          "imports",
          "attendance",
          "transactions",
        ])
          assert.deepEqual(
            detail[key],
            [],
            "Anonymous protected records stay empty: " + key,
          );
        assert.deepEqual(detail.permissions, {
          owner: false,
          staff: false,
          authenticated: false,
        });
      }
      const initial = await load("anonymous arrival", "event-a", null, () =>
        page.goto(server.url + "/#event=event-a&view=participant"),
      );
      anonymous(initial.detail);
      check(
        "Initial anonymous real bundle renders with one selected GET, no fallback and no protected records",
      );
      const alice = await load(
        "Alice session acknowledgement",
        "event-a",
        "alice",
        () => page.locator("#identity-select").selectOption("alice"),
        { method: "POST", identity: "alice" },
      );
      assert.equal(alice.detail.ownWallet.wallet, alice.wallet);
      assert(alice.detail.participants.length > 0);
      assert(
        alice.detail.participants.every(
          (x) => x.wallet.toLowerCase() === alice.wallet.toLowerCase(),
        ),
      );
      assert.deepEqual(alice.detail.permissions, {
        owner: false,
        staff: false,
        authenticated: true,
      });
      await expect(page.locator("#top-identity")).toContainText("Alice");
      check(
        "Actual Alice session acknowledgement binds the new actor, own wallet and only her participant records",
      );
      for (const [key, view] of [
        ["ArrowRight", "organizer"],
        ["End", "cases"],
        ["Home", "participant"],
      ]) {
        await load("keyboard " + view, "event-a", "alice", async () => {
          await page.locator('[role="tab"][aria-selected="true"]').focus();
          await page.keyboard.press(key);
        });
        await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(page.locator(`[data-view="${view}"]`)).toBeFocused();
      }
      check(
        "Arrow/Home/End tab navigation keeps one bundled read, selected route and focused tab",
      );
      const eventB = await load("event B navigation", "event-b", "alice", () =>
        page.locator("#event-switch").selectOption("event-b"),
      );
      assert.equal(eventB.detail.ownWallet.wallet, alice.wallet);
      assert.notEqual(
        eventB.detail.event.contract,
        alice.detail.event.contract,
      );
      await expect(page.locator("#event-switch")).toBeFocused();
      await load("return to event A", "event-a", "alice", () =>
        page.locator("#event-switch").selectOption("event-a"),
      );
      check(
        "Event changes retain actor and selector focus while binding independent real event contracts",
      );
      const owner = await load(
        "owner session acknowledgement",
        "event-a",
        "organizer-a",
        async () => {
          await page.locator("#top-identity").click();
          await page.locator("#dialog-identity").selectOption("organizer-a");
        },
        { method: "POST", identity: "organizer-a" },
      );
      assert.equal(owner.detail.ownWallet.wallet, owner.wallet);
      assert.deepEqual(owner.detail.permissions, {
        owner: true,
        staff: true,
        authenticated: true,
      });
      assert(
        owner.detail.participants.length > alice.detail.participants.length,
      );
      assert(
        owner.detail.participants.every(
          (x) =>
            x.eventId === "event-a" &&
            x.name &&
            x.email.endsWith("@example.test"),
        ),
      );
      await expect(page.locator("#top-identity")).toContainText("Organizer A");
      check(
        "Owner acknowledgement yields legitimate privileged synthetic contacts and owner authority without a financial action",
      );
      const logout = await load(
        "logout acknowledgement",
        "event-a",
        null,
        async () => {
          await page.locator("#top-identity").click();
          await page.locator("[data-logout]").click();
        },
        { method: "DELETE" },
      );
      anonymous(logout.detail);
      await expect(page.locator("#top-identity")).toHaveText("Choose identity");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".skip").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main")).toBeFocused();
      assert.equal(
        await page.evaluate(() => location.hash),
        "#event=event-a&view=participant",
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: path.join(output, contractVersion + "-mobile.png"),
      });
      assert.deepEqual(
        await page.evaluate(() => window.__jointWalletAccess),
        [],
      );
      assert.deepEqual(blocked, []);
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(httpErrors, []);
      assert.deepEqual(record.sessionChanges, [
        { method: "POST", identity: "alice" },
        { method: "POST", identity: "organizer-a" },
        { method: "DELETE", identity: null },
      ]);
      check(
        "Logout returns a private anonymous bundle; mobile skip/focus works with zero browser financial, RPC, wallet or off-origin attempts",
      );
      record.status = "passed";
    } finally {
      await context?.close();
      await server.close();
    }
  }
  assert.notEqual(
    proof.versions[0].loads[0].instanceId,
    proof.versions[1].loads[0].instanceId,
  );
  proof.status = "passed";
  console.log(
    JSON.stringify(
      {
        status: proof.status,
        output,
        versions: proof.versions.map((x) => ({
          contractVersion: x.contractVersion,
          checks: x.checks.length,
          selectedLoads: x.loads.length,
          sessionChanges: x.sessionChanges.length,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  proof.status = "failed";
  proof.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await browser?.close();
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify(proof, null, 2) + "\n",
  );
}
