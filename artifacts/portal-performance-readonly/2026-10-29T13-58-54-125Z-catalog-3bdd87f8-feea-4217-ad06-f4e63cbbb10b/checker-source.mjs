// Explicit one-visit, anonymous, controlled-cold performance evidence only.
// Routing disables Chromium's HTTP cache. This is not a warm-cache benchmark.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  compareSourceAsset,
  HOSTING,
} from "./mainnet-hosting-readonly.e2e.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
class PerformanceFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const check = (ok, code) => {
  if (!ok) throw new PerformanceFailure(code);
};

export function parsePerformanceArgs(argv) {
  if (!argv.length) return { reviewOnly: true };
  if (argv.length === 1 && argv[0] === "--self-test") return { selfTest: true };
  check(
    argv.length === 5 &&
      argv[0] === "--execute-readonly" &&
      argv[1] === "--source" &&
      /^[a-f0-9]{40}$/.test(argv[2]) &&
      argv[3] === "--phase" &&
      ["baseline", "catalog"].includes(argv[4]),
    "EXPLICIT_SOURCE_PHASE_READONLY_REQUIRED",
  );
  return { source: argv[2], phase: argv[4] };
}
export function performanceRequestAllowed(input, method, body, files, phase) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (
    !["baseline", "catalog"].includes(phase) ||
    url.origin !== HOSTING.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    method !== "GET" ||
    body
  )
    return false;
  if (url.pathname.startsWith("/api/"))
    return (
      url.pathname ===
      (phase === "baseline" ? "/api/bootstrap" : "/api/public-catalog")
    );
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  return (
    files.has(name) &&
    !url.pathname.includes("%") &&
    !url.pathname.includes("\\")
  );
}
function selfTest() {
  check(
    parsePerformanceArgs([]).reviewOnly &&
      parsePerformanceArgs(["--self-test"]).selfTest,
    "DEFAULT_REVIEW_ONLY",
  );
  let rejected = 0;
  for (const args of [
    ["--execute-readonly"],
    ["--source", "a".repeat(40)],
    ["--execute-readonly", "--source", "a".repeat(40), "--phase", "other"],
    ["--execute-readonly", "--source", "short", "--phase", "baseline"],
    [
      "--execute-readonly",
      "--source",
      "a".repeat(40),
      "--phase",
      "baseline",
      "--extra",
    ],
  ]) {
    try {
      parsePerformanceArgs(args);
    } catch {
      rejected++;
    }
  }
  check(rejected === 5, "EXPLICIT_EXECUTION_GUARDS");
  const files = new Map([
    ["index.html", Buffer.from("")],
    ["app.js", Buffer.from("")],
  ]);
  for (const phase of ["baseline", "catalog"]) {
    const api = phase === "baseline" ? "/api/bootstrap" : "/api/public-catalog";
    check(
      performanceRequestAllowed(
        `${HOSTING.origin}${api}`,
        "GET",
        null,
        files,
        phase,
      ),
      "ONE_ALLOWED_API",
    );
    for (const [url, method, body] of [
      [`${HOSTING.origin}${api}`, "POST", "{}"],
      [`${HOSTING.origin}${api}`, "HEAD", null],
      [`${HOSTING.origin}${api}?selectedEventId=private`, "GET", null],
      [
        `${HOSTING.origin}${phase === "baseline" ? "/api/public-catalog" : "/api/bootstrap"}`,
        "GET",
        null,
      ],
      [`${HOSTING.origin}/rpc`, "GET", null],
      [`${HOSTING.origin}/api/auth/nonce`, "GET", null],
      ["https://other.invalid/app.js", "GET", null],
      [`${HOSTING.origin}/untracked.js`, "GET", null],
    ])
      check(
        !performanceRequestAllowed(url, method, body, files, phase),
        "FORBIDDEN_REQUEST_REJECTED",
      );
  }
  return {
    status: "passed",
    inputRejections: rejected,
    requestRejections: 16,
    browserLaunches: 0,
    networkRequests: 0,
    financialActions: 0,
  };
}

async function run(source, phase) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: ROOT,
      maxBuffer: 20_000_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  check(
    git("rev-parse", "--verify", `${source}^{commit}`).toString().trim() ===
      source,
    "IMMUTABLE_GIT_SOURCE",
  );
  const files = new Map(
    git("ls-tree", "-r", "--name-only", source, "--", "public")
      .toString()
      .trim()
      .split("\n")
      .filter((name) => name.startsWith("public/"))
      .map((name) => [name.slice(7), git("show", `${source}:${name}`)]),
  );
  const requiredObservedAssets = files.has("entry.js") && files.has("public-home.js")
    ? ["index.html", "entry.js", "public-home.js", "event-search.js"]
    : ["index.html", "app.js", "event-search.js"];
  check(
    ["index.html", "app.js", "event-search.js"].every((name) =>
      files.has(name),
    ),
    "REQUIRED_SOURCE_ASSETS",
  );
  const manifest = JSON.parse(git("show", `${source}:${HOSTING.registry}`)),
    apiPath = phase === "baseline" ? "/api/bootstrap" : "/api/public-catalog",
    output = path.join(
      ROOT,
      "artifacts/portal-performance-readonly",
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${phase}-${randomUUID()}`,
    ),
    checker = await fs.readFile(fileURLToPath(import.meta.url)),
    sharedChecker = await fs.readFile(
      new URL("./mainnet-hosting-readonly.e2e.mjs", import.meta.url),
    );
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "checker-source.mjs"), checker, {
    flag: "wx",
  });
  await fs.writeFile(
    path.join(output, "comparison-source.mjs"),
    sharedChecker,
    { flag: "wx" },
  );
  const proof = {
    status: "running",
    kind: "single-visit-anonymous-controlled-cold-portal-performance",
    phase,
    source,
    origin: HOSTING.origin,
    startedAt: new Date().toISOString(),
    checkerSha256: sha(checker),
    comparisonSha256: sha(sharedChecker),
    apiPath,
    requiredObservedAssets,
    assets: [],
    screenshots: [],
    errors: [],
    counts: {
      requests: 0,
      documents: 0,
      apiRequests: 0,
      apiResponses: 0,
      blocked: 0,
      pageErrors: 0,
      responseErrors: 0,
      workers: 0,
      downloads: 0,
    },
    limits: [
      "One fresh anonymous browser context and one root navigation; no warm-cache claim.",
      "route.continue delivers original responses; asynchronous body/source inspection adds no extra fetch or fulfillment.",
      "Exactly one phase-specific API GET; every other API, origin, mutation, RPC, WebSocket and worker is blocked.",
      "Desktop and mobile captures use the same page. Search and clear must add zero requests.",
      "No event titles, user payloads, provider URLs, cookies, raw API bodies or authentication material are saved in this JSON.",
      "Routing disables HTTP cache; browser performance timestamps include the controlled routing overhead.",
    ],
  };
  let browser,
    context,
    page,
    stage = "BROWSER_START",
    apiSummary = null,
    apiResolve;
  const apiObserved = new Promise((resolve) => {
      apiResolve = resolve;
    }),
    pending = new Set();
  try {
    const { chromium, expect: baseExpect } = await import("@playwright/test"),
      expect = baseExpect.configure({ timeout: HOSTING.timeoutMs });
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.routeWebSocket("**/*", (socket) => {
      proof.counts.blocked++;
      socket.close({ code: 1008, reason: "Read-only performance" });
    });
    await context.addInitScript(
      ({ apiPath, phase }) => {
        performance.setResourceTimingBufferSize(1000);
        const state = (window.__portalPerformance = {
          homeUsableMs: null,
          catalogReadyMs: null,
          walletReads: 0,
          walletWrites: 0,
          websocket: 0,
          worker: 0,
          serviceWorker: 0,
        });
        Object.defineProperty(window, "ethereum", {
          configurable: false,
          get() {
            state.walletReads++;
            return undefined;
          },
          set() {
            state.walletWrites++;
          },
        });
        window.WebSocket = class {
          constructor() {
            state.websocket++;
            throw Error("Read-only performance");
          }
        };
        window.Worker = window.SharedWorker = class {
          constructor() {
            state.worker++;
            throw Error("Read-only performance");
          }
        };
        try {
          navigator.serviceWorker.register = () => {
            state.serviceWorker++;
            return Promise.reject(Error("Read-only performance"));
          };
        } catch {}
        const visible = (node) =>
          !!node && !node.hidden && node.getClientRects().length > 0;
        const inspect = () => {
          const content = document.querySelector("#content"),
            search = document.querySelector("[data-public-event-search]"),
            status = document.querySelector("[data-public-event-status]"),
            setup = document.querySelector('a[href="#setup=kickback"]'),
            screen = document.querySelector("[data-public-catalog-screen]");
          const ready =
            visible(content) &&
            !visible(document.querySelector("#loading")) &&
            visible(search) &&
            !search.disabled &&
            visible(setup) &&
            (phase !== "catalog" ||
              (visible(screen) &&
                content.getAttribute("aria-busy") === "false"));
          if (ready && state.homeUsableMs === null)
            state.homeUsableMs = performance.now();
          const api = performance
            .getEntriesByType("resource")
            .find((entry) => new URL(entry.name).pathname === apiPath);
          if (
            ready &&
            visible(status) &&
            status.textContent.trim() &&
            api?.responseEnd > 0 &&
            state.catalogReadyMs === null
          )
            state.catalogReadyMs = performance.now();
        };
        new MutationObserver(inspect).observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        new PerformanceObserver(inspect).observe({
          type: "resource",
          buffered: true,
        });
        document.addEventListener("DOMContentLoaded", inspect, { once: true });
      },
      { apiPath, phase },
    );
    await context.route("**/*", async (route) => {
      const request = route.request();
      proof.counts.requests++;
      const allowed = performanceRequestAllowed(
        request.url(),
        request.method(),
        request.postData(),
        files,
        phase,
      );
      if (
        !allowed ||
        request.headers().cookie ||
        request.headers().authorization
      ) {
        proof.counts.blocked++;
        await route.abort("blockedbyclient");
        return;
      }
      const url = new URL(request.url());
      if (url.pathname === apiPath && ++proof.counts.apiRequests !== 1) {
        proof.counts.blocked++;
        await route.abort("blockedbyclient");
        return;
      }
      if (
        request.resourceType() === "document" &&
        ++proof.counts.documents !== 1
      ) {
        proof.counts.blocked++;
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    page = await context.newPage();
    page.on("pageerror", () => proof.counts.pageErrors++);
    page.on("worker", () => proof.counts.workers++);
    page.on("download", () => proof.counts.downloads++);
    page.on("response", (response) => {
      const work = (async () => {
        const request = response.request(),
          url = new URL(response.url()),
          isApi = url.pathname === apiPath;
        try {
          const headers = await response.allHeaders(),
            requestHeaders = await request.allHeaders(),
            bytes = await response.body(),
            sizes = await request.sizes();
          check(
            !requestHeaders.cookie &&
              !requestHeaders.authorization &&
              !headers["set-cookie"] &&
              !headers["x-kleros-proxy-key"],
            "NO_AUTH_COOKIES_OR_GATEWAY_SECRET",
          );
          if (isApi) {
            proof.counts.apiResponses++;
            proof.api = {
              path: apiPath,
              status: response.status(),
              decodedBytes: bytes.length,
              downloadedBodyBytes: sizes.responseBodySize,
              sha256: sha(bytes),
            };
            check(response.status() === 200, "API_HTTP_200");
            check(
              headers["cache-control"]?.includes("no-store") &&
                headers["x-content-type-options"] === "nosniff",
              "API_SECURITY_HEADERS",
            );
            const body = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            );
            check(
              body.mode === "hosted-production" &&
                body.chain?.chainId === 1 &&
                body.chain.rpcUrl === manifest.chain.rpcUrl &&
                typeof body.instanceId === "string" &&
                Array.isArray(body.events),
              "API_PUBLIC_PRODUCTION_SCOPE",
            );
            if (phase === "baseline")
              check(
                body.session === null &&
                  body.identities?.length === 0 &&
                  body.recoveryEvents?.length === 0,
                "ANONYMOUS_BASELINE_ONLY",
              );
            else
              check(
                body.schemaVersion === 1 &&
                  body.kind === "public-catalog" &&
                  body.catalog?.metadataOnly === true &&
                  body.catalog.currentFinancialState === "not-loaded" &&
                  body.catalog.source === "recorded-adoption" &&
                  !Object.hasOwn(body, "session") &&
                  !Object.hasOwn(body, "factory") &&
                  !Object.hasOwn(body, "capabilities"),
                "METADATA_ONLY_CATALOG",
              );
            check(
              body.events.every(
                (event) =>
                  event.visibility === "public" &&
                  event.editorialStatus === "published" &&
                  (phase === "baseline" ||
                    (event.adoption?.kind === "recorded-adoption" &&
                      /^0x[a-f0-9]{64}$/i.test(event.adoption.txHash) &&
                      Number.isSafeInteger(event.adoption.blockNumber) &&
                      event.adoption.blockNumber > 0 &&
                      /^0x[a-f0-9]{64}$/i.test(event.adoption.blockHash))),
              ),
              "ONLY_PUBLIC_PUBLISHED_ADOPTED_ROWS",
            );
            apiSummary = { publicEventCount: body.events.length };
          } else {
            const name =
                url.pathname === "/" ? "index.html" : url.pathname.slice(1),
              expected = files.get(name);
            check(expected && response.status() === 200, "STATIC_HTTP_200");
            const comparison = compareSourceAsset(name, bytes, expected);
            proof.assets.push({
              path: name,
              status: response.status(),
              decodedBytes: bytes.length,
              downloadedBodyBytes: sizes.responseBodySize,
              ...comparison,
            });
            check(comparison.matches, "ASSET_SOURCE_MATCH");
            check(
              headers["x-content-type-options"] === "nosniff" &&
                headers["referrer-policy"] === "same-origin" &&
                headers["x-frame-options"] === "SAMEORIGIN",
              "STATIC_SECURITY_HEADERS",
            );
          }
        } catch (error) {
          proof.counts.responseErrors++;
          proof.errors.push({
            check: isApi ? "API_RESPONSE" : "STATIC_RESPONSE",
            code:
              error instanceof PerformanceFailure
                ? error.code
                : "RESPONSE_INSPECTION_FAILED",
          });
        } finally {
          if (isApi) apiResolve();
        }
      })();
      pending.add(work);
      work.finally(() => pending.delete(work));
    });
    stage = "ONE_ANONYMOUS_VISIT";
    await page.goto(HOSTING.origin, {
      waitUntil: "domcontentloaded",
      timeout: HOSTING.timeoutMs,
    });
    await Promise.race([
      apiObserved,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new PerformanceFailure("API_RESPONSE_TIMEOUT")),
          HOSTING.timeoutMs,
        );
        apiObserved.finally(() => clearTimeout(timer));
      }),
    ]);
    check(
      apiSummary && proof.counts.responseErrors === 0,
      "ACTUAL_PHASE_API_OBSERVED",
    );
    await expect(page.locator("#content")).toBeVisible();
    await expect(page.locator("#loading")).toBeHidden();
    await expect(page.locator("[data-public-event-search]")).toBeVisible();
    await expect(page.locator("[data-public-event-search]")).toBeEnabled();
    await expect(page.locator("[data-public-event-status]")).not.toHaveText("");
    if (phase === "catalog") {
      await expect(page.locator("[data-public-catalog-screen]")).toBeVisible();
      await expect(page.locator("#content")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    }
    await expect(page.locator("[data-public-event-row]")).toHaveCount(
      apiSummary.publicEventCount,
    );
    await page.waitForFunction(
      () =>
        window.__portalPerformance.homeUsableMs !== null &&
        window.__portalPerformance.catalogReadyMs !== null,
    );
    const readMeasurements = () =>
      page.evaluate(
        ({ apiPath, allowedPaths }) => {
          const navigation = performance.getEntriesByType("navigation")[0],
            fcp = performance
              .getEntriesByType("paint")
              .find((entry) => entry.name === "first-contentful-paint"),
            resources = performance
              .getEntriesByType("resource")
              .map((entry) => ({
                path: new URL(entry.name).pathname,
                initiatorType: entry.initiatorType,
                startTime: entry.startTime,
                responseStart: entry.responseStart,
                responseEnd: entry.responseEnd,
                duration: entry.duration,
                transferBytes: entry.transferSize,
                encodedBodyBytes: entry.encodedBodySize,
                decodedBodyBytes: entry.decodedBodySize,
              }))
              .filter(
                (entry) =>
                  entry.path === apiPath || allowedPaths.includes(entry.path),
              );
          return {
            timeOrigin: performance.timeOrigin,
            firstContentfulPaintMs: fcp?.startTime ?? null,
            homeUsableMs: window.__portalPerformance.homeUsableMs,
            catalogReadyMs: window.__portalPerformance.catalogReadyMs,
            navigation: navigation
              ? {
                  type: navigation.type,
                  startTime: navigation.startTime,
                  responseStart: navigation.responseStart,
                  responseEnd: navigation.responseEnd,
                  domContentLoadedMs: navigation.domContentLoadedEventEnd,
                  loadEventMs: navigation.loadEventEnd,
                  transferBytes: navigation.transferSize,
                  encodedBodyBytes: navigation.encodedBodySize,
                  decodedBodyBytes: navigation.decodedBodySize,
                }
              : null,
            apiResource:
              resources.find((entry) => entry.path === apiPath) ?? null,
            resources,
          };
        },
        { apiPath, allowedPaths: [...files.keys()].map((name) => `/${name}`) },
      );
    proof.measurements = await readMeasurements();
    check(
      proof.measurements.apiResource?.responseEnd > 0 &&
        proof.measurements.firstContentfulPaintMs !== null,
      "BROWSER_NAVIGATION_FCP_AND_API_TIMING",
    );
    const capture = async (device) => {
      await page.evaluate(async () => {
        scrollTo(0, 0);
        await document.fonts.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      check(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.body.scrollWidth <= innerWidth,
        ),
        "NO_HORIZONTAL_OVERFLOW",
      );
      const file = path.join(output, `${device}-home.png`);
      await page.screenshot({ path: file, fullPage: true });
      proof.screenshots.push({
        device,
        path: file,
        sha256: sha(await fs.readFile(file)),
      });
    };
    stage = "DESKTOP_CAPTURE";
    await capture("desktop");
    stage = "LOCAL_SEARCH_CLEAR";
    const before = {
        requests: proof.counts.requests,
        apiRequests: proof.counts.apiRequests,
      },
      field = page.locator("[data-public-event-search]");
    await field.fill("performance-readonly-local-query");
    await expect(page.locator("[data-public-event-clear]")).toBeVisible();
    await page.locator("[data-public-event-clear]").click();
    await expect(field).toHaveValue("");
    await expect(page.locator("[data-public-event-clear]")).toBeHidden();
    await expect(page.locator("[data-public-event-row]")).toHaveCount(
      apiSummary.publicEventCount,
    );
    check(
      proof.counts.requests === before.requests &&
        proof.counts.apiRequests === before.apiRequests,
      "SEARCH_CLEAR_ZERO_REQUESTS",
    );
    stage = "SAME_PAGE_MOBILE_CAPTURE";
    await page.setViewportSize({ width: 390, height: 844 });
    await capture("mobile");
    while (pending.size) await Promise.all([...pending]);
    // Capture final resource/download totals after fonts and both screenshots;
    // the original readiness marks retain their first observed browser times.
    proof.measurements = await readMeasurements();
    proof.downloads = {
      responseBodyBytes:
        proof.assets.reduce(
          (sum, asset) => sum + asset.downloadedBodyBytes,
          0,
        ) + (proof.api?.downloadedBodyBytes ?? 0),
      decodedBytes:
        proof.assets.reduce((sum, asset) => sum + asset.decodedBytes, 0) +
        (proof.api?.decodedBytes ?? 0),
    };
    proof.probes = await page.evaluate(() => window.__portalPerformance);
    check(
      proof.counts.documents === 1 &&
        proof.counts.apiRequests === 1 &&
        proof.counts.apiResponses === 1 &&
        proof.counts.blocked === 0 &&
        proof.counts.pageErrors === 0 &&
        proof.counts.responseErrors === 0 &&
        proof.counts.workers === 0 &&
        proof.counts.downloads === 0 &&
        proof.probes.walletWrites === 0 &&
        proof.probes.websocket === 0 &&
        proof.probes.worker === 0 &&
        proof.probes.serviceWorker === 0 &&
        (await context.cookies()).length === 0 &&
        page.url() === `${HOSTING.origin}/`,
      "NO_FORBIDDEN_ACTIVITY",
    );
    check(
      requiredObservedAssets.every((name) =>
        proof.assets.some((asset) => asset.path === name && asset.matches),
      ),
      "REQUIRED_ACTUAL_ASSETS_OBSERVED",
    );
    proof.publicEventCount = apiSummary.publicEventCount;
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.errors.push({
      check: stage,
      code:
        error instanceof PerformanceFailure
          ? error.code
          : "PERFORMANCE_READONLY_FAILED",
    });
  } finally {
    if (browser)
      await browser.close().catch(() => {
        proof.status = "failed";
        proof.errors.push({
          check: "BROWSER_CLOSE",
          code: "PERFORMANCE_READONLY_FAILED",
        });
      });
    while (pending.size) await Promise.all([...pending]);
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
        phase,
        source,
        proof: path.join(output, "proof.json"),
        firstContentfulPaintMs:
          proof.measurements?.firstContentfulPaintMs ?? null,
        homeUsableMs: proof.measurements?.homeUsableMs ?? null,
        catalogReadyMs: proof.measurements?.catalogReadyMs ?? null,
        apiResponseEndMs: proof.measurements?.apiResource?.responseEnd ?? null,
        apiRequests: proof.counts.apiRequests,
        screenshots: proof.screenshots.length,
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
  const plan = parsePerformanceArgs(argv);
  if (plan.reviewOnly)
    console.log(
      JSON.stringify(
        {
          status: "review-only",
          origin: HOSTING.origin,
          execute:
            "node test/portal-performance-readonly.e2e.mjs --execute-readonly --source FULL40_GIT_SHA --phase baseline|catalog",
          browserLaunches: 0,
          networkRequests: 0,
          financialActions: 0,
        },
        null,
        2,
      ),
    );
  else if (plan.selfTest) console.log(JSON.stringify(selfTest(), null, 2));
  else await run(plan.source, plan.phase);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error("PERFORMANCE_READONLY_PREFLIGHT_FAILED");
    process.exitCode = 1;
  });
