// Opt-in actual local v7/v8 startup only. No participant or financial operation.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PRODUCTS = Object.freeze([
  "public/index.html",
  "public/entry.js",
  "public/public-home.js",
  "public/app.js",
  "public/luma-setup.js",
  "public/loading.css",
]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
class LegacyEntryFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const check = (ok, code) => {
  if (!ok) throw new LegacyEntryFailure(code);
};
export function parseLegacyEntryArgs(argv) {
  if (!argv.length) return { reviewOnly: true };
  check(
    argv.length === 1 && argv[0] === "--run-loopback",
    "EXPLICIT_LOOPBACK_FLAG_REQUIRED",
  );
  return { runLoopback: true };
}
export function legacyEntryRequestAllowed(input, method, body, origin, files) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    method !== "GET" ||
    body
  )
    return false;
  if (["/api/public-catalog", "/api/bootstrap"].includes(url.pathname))
    return true;
  if (url.pathname.startsWith("/api/") || url.pathname === "/rpc") return false;
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  return (
    files.has(name) &&
    !url.pathname.includes("%") &&
    !url.pathname.includes("\\")
  );
}

async function run() {
  const productBytes = new Map(
    await Promise.all(
      PRODUCTS.map(async (name) => [
        name,
        await fs.readFile(path.join(ROOT, name)),
      ]),
    ),
  );
  check(
    productBytes
      .get("public/index.html")
      .toString()
      .includes('src="/entry.js"'),
    "NEW_FRONTEND_MUST_BE_INTEGRATED_FIRST",
  );
  const files = new Map();
  for (const name of await fs.readdir(path.join(ROOT, "public")))
    if (/\.(?:js|css|html)$/.test(name))
      files.set(name, await fs.readFile(path.join(ROOT, "public", name)));
  for (const name of await fs.readdir(path.join(ROOT, "public/assets")))
    if (/\.(?:svg|woff2)$/.test(name))
      files.set(
        `assets/${name}`,
        await fs.readFile(path.join(ROOT, "public/assets", name)),
      );
  const checker = await fs.readFile(fileURLToPath(import.meta.url)),
    output = path.join(
      ROOT,
      "artifacts/legacy-entry-root",
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
    ),
    proof = {
      status: "running",
      kind: "actual-local-v7-v8-root-entry-fallback",
      startedAt: new Date().toISOString(),
      checkerSha256: sha(checker),
      productSha256: Object.fromEntries(
        [...productBytes].map(([name, bytes]) => [name, sha(bytes)]),
      ),
      versions: [],
      errors: [],
      limits: [
        "Fresh anonymous browser and isolated local-demo chain for each explicit v7/v8 profile.",
        "Only initial contract/mock deployment and read-only rendering; no deposit, financial draft, wallet, session, auth or public RPC.",
        "One expected public-catalog404 then one unselected bootstrap200 per document; no other API allowed.",
        "Proof contains hashes/counts only, not provider URLs, signers, private keys or returned participant data.",
      ],
    };
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "checker-source.mjs"), checker, {
    flag: "wx",
  });
  let browser,
    stage = "LOCAL_START";
  try {
    const { startServer } = await import("../src/server.mjs"),
      { chromium, expect: baseExpect } = await import("@playwright/test"),
      expect = baseExpect.configure({ timeout: 15_000 });
    browser = await chromium.launch({ headless: true });
    for (const version of ["truth-pays-v7", "kleros-event-v8"]) {
      stage = `${version}:START`;
      const server = await startServer({
        port: 0,
        rpcPort: 0,
        contractVersion: version,
        deployment: { mode: "local-demo" },
      });
      let context;
      const pending = new Set(),
        observed = [],
        apiRequestOrder = [],
        record = {
          contractVersion: version,
          status: "running",
          counts: {
            requests: 0,
            documents: 0,
            catalogRequests: 0,
            bootstrapRequests: 0,
            blocked: 0,
            pageErrors: 0,
            responseErrors: 0,
            workers: 0,
            downloads: 0,
          },
          assets: [],
          errors: [],
        };
      proof.versions.push(record);
      try {
        context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          serviceWorkers: "block",
          acceptDownloads: false,
          reducedMotion: "reduce",
        });
        await context.routeWebSocket("**/*", (socket) => {
          record.counts.blocked++;
          socket.close({ code: 1008, reason: "Loopback startup only" });
        });
        await context.addInitScript(() => {
          const probes = (window.__legacyEntryProbes = {
            walletReads: 0,
            walletWrites: 0,
            websocket: 0,
            worker: 0,
            serviceWorker: 0,
          });
          Object.defineProperty(window, "ethereum", {
            configurable: false,
            get() {
              probes.walletReads++;
              return undefined;
            },
            set() {
              probes.walletWrites++;
            },
          });
          window.WebSocket = class {
            constructor() {
              probes.websocket++;
              throw Error("Startup only");
            }
          };
          window.Worker = window.SharedWorker = class {
            constructor() {
              probes.worker++;
              throw Error("Startup only");
            }
          };
          try {
            navigator.serviceWorker.register = () => {
              probes.serviceWorker++;
              return Promise.reject(Error("Startup only"));
            };
          } catch {}
        });
        await context.route("**/*", async (route) => {
          const request = route.request();
          record.counts.requests++;
          if (
            !legacyEntryRequestAllowed(
              request.url(),
              request.method(),
              request.postData(),
              server.url,
              files,
            ) ||
            request.headers().cookie ||
            request.headers().authorization
          ) {
            record.counts.blocked++;
            return route.abort("blockedbyclient");
          }
          const pathname = new URL(request.url()).pathname;
          if (["/api/public-catalog", "/api/bootstrap"].includes(pathname))
            apiRequestOrder.push(pathname);
          if (
            (pathname === "/api/public-catalog" &&
              ++record.counts.catalogRequests !== 1) ||
            (pathname === "/api/bootstrap" &&
              ++record.counts.bootstrapRequests !== 1) ||
            (request.resourceType() === "document" &&
              ++record.counts.documents !== 1)
          ) {
            record.counts.blocked++;
            return route.abort("blockedbyclient");
          }
          return route.continue();
        });
        const page = await context.newPage();
        page.on("pageerror", () => record.counts.pageErrors++);
        page.on("worker", () => record.counts.workers++);
        page.on("download", () => record.counts.downloads++);
        page.on("response", (response) => {
          const work = (async () => {
            try {
              const request = response.request(),
                pathname = new URL(response.url()).pathname,
                headers = await response.allHeaders();
              check(!headers["set-cookie"], "NO_SESSION_MUTATION");
              if (pathname === "/api/public-catalog") {
                check(response.status() === 404, "EXACT_CATALOG_404_FALLBACK");
                // The entry deliberately cancels this unused body when handing
                // off. Its exact path/status, not a readable body after abort,
                // is the compatibility signal consumed by the application.
                observed.push({ path: pathname, status: 404 });
              } else if (pathname === "/api/bootstrap") {
                const bytes = await response.body();
                check(response.status() === 200, "BOOTSTRAP_HTTP_200");
                const value = JSON.parse(bytes);
                check(
                  value.mode === "local-demo" &&
                    value.contractVersion === version &&
                    value.chain?.chainId === 1337 &&
                    value.session === null &&
                    value.events?.length === 2 &&
                    value.identities?.length > 0,
                  "ACTUAL_LOCAL_VERSION_ANONYMOUS_TWO_EVENTS",
                );
                check(
                  !Object.hasOwn(value, "selectedEvent"),
                  "UNSELECTED_BOOTSTRAP_ONLY",
                );
                observed.push({ path: pathname, status: 200 });
                record.bootstrap = {
                  sha256: sha(bytes),
                  eventCount: 2,
                  chainId: 1337,
                  anonymous: true,
                };
              } else {
                const bytes = await response.body();
                const name =
                    pathname === "/" ? "index.html" : pathname.slice(1),
                  expected = files.get(name);
                check(
                  response.status() === 200 &&
                    expected &&
                    bytes.equals(expected),
                  "STATIC_SOURCE_EXACT",
                );
                record.assets.push({ path: name, sha256: sha(bytes) });
              }
              assert.equal(request.method(), "GET");
            } catch (error) {
              record.counts.responseErrors++;
              record.errors.push(
                error instanceof LegacyEntryFailure
                  ? error.code
                  : "RESPONSE_INSPECTION_FAILED",
              );
            }
          })();
          pending.add(work);
          work.finally(() => pending.delete(work));
        });
        stage = `${version}:ROOT_ENTRY`;
        await page.goto(server.url, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        await expect(page.locator("#content")).toBeVisible();
        await expect(page.locator("#loading")).toBeHidden();
        await expect(page.locator("h1")).toHaveText("Events, with commitment.");
        await expect(page.locator(".event-card")).toHaveCount(2);
        while (pending.size) await Promise.all([...pending]);
        record.probes = await page.evaluate(() => window.__legacyEntryProbes);
        assert.deepEqual(apiRequestOrder, [
          "/api/public-catalog",
          "/api/bootstrap",
        ]);
        assert.deepEqual(
          observed.sort((a, b) => b.status - a.status),
          [
            { path: "/api/public-catalog", status: 404 },
            { path: "/api/bootstrap", status: 200 },
          ],
        );
        check(
          record.counts.catalogRequests === 1 &&
            record.counts.bootstrapRequests === 1 &&
            record.counts.documents === 1,
          "EXACT_ONCE_ENTRY_AND_STARTAPP",
        );
        for (const key of [
          "blocked",
          "pageErrors",
          "responseErrors",
          "workers",
          "downloads",
        ])
          check(record.counts[key] === 0, "NO_FORBIDDEN_ACTIVITY");
        check(
          Object.values(record.probes).every((value) => value === 0) &&
            (await context.cookies()).length === 0 &&
            page.url() === `${server.url}/`,
          "ANONYMOUS_NO_WALLET_OR_NAVIGATION",
        );
        for (const name of ["index.html", "entry.js", "app.js"])
          check(
            record.assets.some((asset) => asset.path === name),
            "ACTUAL_ENTRY_ASSETS_LOADED",
          );
        record.status = "passed";
      } finally {
        try {
          await context?.close();
          while (pending.size) await Promise.all([...pending]);
        } finally {
          await server.close();
        }
      }
    }
    for (const [name, bytes] of productBytes)
      check(
        sha(await fs.readFile(path.join(ROOT, name))) === sha(bytes),
        "PRODUCT_SOURCE_CHANGED_DURING_RUN",
      );
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.errors.push({
      stage,
      code:
        error instanceof LegacyEntryFailure
          ? error.code
          : "LEGACY_ENTRY_CHECK_FAILED",
    });
  } finally {
    await browser?.close().catch(() => {
      proof.status = "failed";
      proof.errors.push({ stage: "CLOSE", code: "BROWSER_CLOSE_FAILED" });
    });
    proof.completedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(output, "proof.json"),
      JSON.stringify(proof, null, 2) + "\n",
      { flag: "wx" },
    );
  }
  console.log(
    JSON.stringify(
      {
        status: proof.status,
        proof: path.join(output, "proof.json"),
        versions: proof.versions.map((record) => ({
          version: record.contractVersion,
          status: record.status,
          catalog404s: record.counts.catalogRequests,
          bootstraps: record.counts.bootstrapRequests,
        })),
        financialActions: 0,
        errors: proof.errors,
      },
      null,
      2,
    ),
  );
  if (proof.status !== "passed") process.exitCode = 1;
}

export async function main(argv = process.argv.slice(2)) {
  const plan = parseLegacyEntryArgs(argv);
  if (plan.reviewOnly)
    console.log(
      JSON.stringify(
        {
          status: "review-only",
          execute: "node test/legacy-entry-root.e2e.mjs --run-loopback",
          profiles: ["truth-pays-v7", "kleros-event-v8"],
          browserLaunches: 0,
          localServers: 0,
          networkRequests: 0,
          financialActions: 0,
        },
        null,
        2,
      ),
    );
  else await run();
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error("LEGACY_ENTRY_PREFLIGHT_FAILED");
    process.exitCode = 1;
  });
