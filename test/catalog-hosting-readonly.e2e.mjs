// One anonymous catalog visit only. Reuses B2 hosting guards; never repeats setup or any financial flow.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { assertFactoryBootstrap, browserRequestAllowed, compareSourceAsset, HOSTING } from "./mainnet-hosting-readonly.e2e.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
class CatalogFailure extends Error { constructor(code) { super(code); this.code = code; } }
const check = (ok, code) => { if (!ok) throw new CatalogFailure(code); };

export function parseCatalogArgs(argv) {
  if (argv.length === 0) return { reviewOnly: true };
  if (argv.length === 1 && argv[0] === "--self-test") return { selfTest: true };
  check(argv.length === 3 && argv[0] === "--execute-readonly" && argv[1] === "--source" &&
    /^[a-f0-9]{40}$/.test(argv[2]), "EXPLICIT_SOURCE_AND_READONLY_FLAG_REQUIRED");
  return { source: argv[2] };
}
export function assertPublicCatalog(events, project) {
  // Reject, rather than silently hide, a private/draft record returned to this anonymous browser.
  check(Array.isArray(events) && events.every((event) => event?.visibility === "public" &&
    event?.editorialStatus === "published"), "ANONYMOUS_CATALOG_PUBLIC_PUBLISHED_ONLY");
  const entries = project(events);
  check(entries.length === events.length, "PUBLIC_CATALOG_VALID_UNIQUE_SOURCE_ENTRIES");
  return entries;
}
function selfTest() {
  check(parseCatalogArgs([]).reviewOnly && parseCatalogArgs(["--self-test"]).selfTest,
    "SELF_TEST_REVIEW_DEFAULT");
  let rejected = 0;
  for (const args of [["--execute-readonly"], ["--source", "a".repeat(40)],
    ["--execute-readonly", "--source", "short"], ["--execute-readonly", "--source", "a".repeat(40), "--event", "fake"]]) {
    try { parseCatalogArgs(args); } catch { rejected++; }
  }
  check(rejected === 4, "SELF_TEST_EXPLICIT_INPUT_GUARDS");
  let projected = false;
  const privateEvent = { visibility: "private", editorialStatus: "published",
    get title() { throw Error("Private title must never be projected"); } };
  try { assertPublicCatalog([privateEvent], () => { projected = true; return []; }); }
  catch (error) { check(error.code === "ANONYMOUS_CATALOG_PUBLIC_PUBLISHED_ONLY", "SELF_TEST_PRIVACY_CODE"); }
  check(!projected, "SELF_TEST_FILTER_BEFORE_PROJECTION");
  const files = new Map([["index.html", Buffer.from("")], ["event-search.js", Buffer.from("")]]);
  check(browserRequestAllowed(`${HOSTING.origin}/event-search.js`, "GET", null, files) &&
    !browserRequestAllowed(`${HOSTING.origin}/api/bootstrap`, "POST", "{}", files) &&
    !browserRequestAllowed(`${HOSTING.origin}/rpc`, "GET", null, files) &&
    !browserRequestAllowed("https://other.example.invalid/event-search.js", "GET", null, files), "SELF_TEST_READ_ONLY_NETWORK");
  return { status: "passed", inputRejections: rejected, privateProjectionCalls: 0, networkRequests: 0, browserLaunches: 0 };
}
function staticHeaders(headers) {
  check(headers.get("content-security-policy")?.split(";").map((x) => x.trim()).filter(Boolean).join("; ") === CSP &&
    headers.get("x-content-type-options") === "nosniff" && headers.get("referrer-policy") === "same-origin" &&
    headers.get("x-frame-options") === "SAMEORIGIN", "STATIC_CSP_SECURITY_HEADERS");
}
function apiHeaders(headers) {
  const cache = headers.get("cache-control") || "", vary = (headers.get("vary") || "").toLowerCase();
  check(cache.includes("private") && cache.includes("no-store") && vary.includes("cookie") && vary.includes("origin") &&
    headers.get("x-content-type-options") === "nosniff" && !headers.has("set-cookie") &&
    !headers.has("x-kleros-proxy-key"), "ANONYMOUS_BOOTSTRAP_HEADERS");
}

async function run(source) {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, maxBuffer: 20_000_000, stdio: ["ignore", "pipe", "ignore"] });
  check(git("rev-parse", "--verify", `${source}^{commit}`).toString().trim() === source, "IMMUTABLE_GIT_SOURCE");
  const publicFiles = new Map(git("ls-tree", "-r", "--name-only", source, "--", "public").toString().trim().split("\n")
    .filter((name) => name.startsWith("public/")).map((name) => [name.slice(7), git("show", `${source}:${name}`)]));
  const required = ["index.html", "app.js", "luma-launch.css", "event-search.js"];
  check(required.every((name) => publicFiles.has(name)), "CATALOG_REQUIRED_SOURCE_ASSETS");
  const registryRaw = git("show", `${source}:${HOSTING.registry}`), manifest = JSON.parse(registryRaw);
  for (const name of ["luma-factory.js", "environment.js", "contract-profiles.js", "luma-launch.js", "event-search.js"])
    check(sha(await fs.readFile(path.join(ROOT, "public", name))) === sha(publicFiles.get(name)), "LOCAL_PURE_HELPERS_SOURCE_BOUND");
  const { publicEventSearchEntries, searchPublicEvents } = await import(pathToFileURL(path.join(ROOT, "public/event-search.js")).href);
  const output = path.join(ROOT, "artifacts/catalog-hosting-readonly", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  await fs.mkdir(output, { recursive: true });
  const checker = await fs.readFile(fileURLToPath(import.meta.url));
  const sharedChecker = await fs.readFile(new URL("./mainnet-hosting-readonly.e2e.mjs", import.meta.url));
  const proof = { status: "running", kind: "single-visit-anonymous-public-catalog-readonly", startedAt: new Date().toISOString(),
    source, origin: HOSTING.origin, registry: HOSTING.registry, registrySha256: sha(registryRaw), checkerSha256: sha(checker),
    sharedCheckerSha256: sha(sharedChecker), expectedPublicAssetCount: publicFiles.size,
    publicSourcePins: Object.fromEntries([...publicFiles].map(([name, bytes]) => [name, sha(bytes)])),
    requiredObservedAssets: required, checks: [], assets: [], screenshots: [], errors: [],
    counts: { requests: 0, api: 0, blocked: 0, pageErrors: 0, responseErrors: 0 },
    limits: ["Exactly one fresh anonymous root page; same page resized for mobile. No selected-event link is opened.",
      "Only public/published event summaries are projected. No assertion about private event visibility under an authenticated role.",
      "B2 setup, backend proxy boundaries and published policy gateway bytes are not rerun. Current factory/policy/chain/keyless metadata is checked.",
      "No auth, cookies, wallet requests, POST, RPC, upload, WebSocket, service worker, financial operation, backend restart or deployment."] };
  await fs.writeFile(path.join(output, "checker-source.mjs"), checker, { flag: "wx" });
  await fs.writeFile(path.join(output, "shared-checker-source.mjs"), sharedChecker, { flag: "wx" });
  let stage = "BROWSER_START", browser, entries = null;
  try {
    const playwright = await import("@playwright/test"), expect = playwright.expect.configure({ timeout: HOSTING.timeoutMs });
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce",
      serviceWorkers: "block", acceptDownloads: false });
    await context.routeWebSocket("**/*", (socket) => { proof.counts.blocked++; socket.close({ code: 1008, reason: "Catalog read-only" }); });
    await context.addInitScript(() => {
      window.__catalogReadonly = { walletReads: 0, walletWrites: 0, websocket: 0, serviceWorker: 0 };
      Object.defineProperty(window, "ethereum", { configurable: false, get() { window.__catalogReadonly.walletReads++; return undefined; },
        set() { window.__catalogReadonly.walletWrites++; } });
      window.WebSocket = class { constructor() { window.__catalogReadonly.websocket++; throw Error("Catalog read-only"); } };
      try { navigator.serviceWorker.register = () => { window.__catalogReadonly.serviceWorker++; return Promise.reject(Error("Catalog read-only")); }; } catch {}
    });
    const pending = new Set();
    await context.route("**/*", (route) => {
      const work = (async () => {
        const request = route.request(); proof.counts.requests++;
        if (!browserRequestAllowed(request.url(), request.method(), request.postData(), publicFiles)) {
          proof.counts.blocked++; await route.abort("blockedbyclient"); return;
        }
        try {
          const response = await route.fetch({ maxRedirects: 0, timeout: HOSTING.timeoutMs });
          check(response.status() === 200, "OBSERVED_HTTP_200");
          const bytes = await response.body(), headers = new Headers(response.headers()), url = new URL(request.url());
          if (url.pathname === "/api/bootstrap") {
            proof.counts.api++; check(proof.counts.api === 1, "ONE_BOOTSTRAP_ONLY"); apiHeaders(headers);
            const bootstrap = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            proof.bootstrap = assertFactoryBootstrap(bootstrap, manifest, false, { allowPublicEvents: true });
            entries = assertPublicCatalog(bootstrap.events, publicEventSearchEntries);
            proof.bootstrapSha256 = sha(bytes); proof.publicEvents = entries;
          } else {
            const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
            const comparison = compareSourceAsset(name, bytes, publicFiles.get(name));
            check(comparison.matches, "LOADED_ASSET_SOURCE_MATCH"); staticHeaders(headers);
            proof.assets.push({ path: name, ...comparison });
          }
          await route.fulfill({ response }); // Never substitute HTML, JSON or other served bytes.
        } catch { proof.counts.responseErrors++; await route.abort("failed").catch(() => {}); }
      })();
      pending.add(work); work.finally(() => pending.delete(work)); return work;
    });
    const page = await context.newPage(); page.on("pageerror", () => { proof.counts.pageErrors++; });
    async function rows(expected, query = "") {
      const actual = page.locator("[data-public-event-row]"); await expect(actual).toHaveCount(expected.length);
      for (let index = 0; index < expected.length; index++) {
        const item = expected[index], row = actual.nth(index);
        await expect(row.locator("h3")).toHaveText(item.title);
        await expect(row.locator(".badge")).toHaveText(item.statusLabel);
        const amount = item.depositWei === null ? null : BigInt(item.depositWei);
        const eth = amount === null ? null : `${amount / 10n ** 18n}${amount % 10n ** 18n ? `.${(amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "")}` : ""}`;
        await expect(row.locator(".public-event-meta > span").first()).toHaveText(eth === null ? "Deposit unavailable" : `Event deposit: ${eth} ETH`);
        await expect(row.locator("[data-public-event-open]")).toHaveAttribute("href", `#${new URLSearchParams({ event: item.id, view: "participant" })}`);
        await expect(row.locator("[data-public-event-open]")).toHaveText("Open event");
      }
      const status = !entries.length ? "No public events yet." : query.trim()
        ? `${expected.length} matching public ${expected.length === 1 ? "event" : "events"}.`
        : `${expected.length} public ${expected.length === 1 ? "event" : "events"}.`;
      await expect(page.locator("[data-public-event-status]")).toHaveText(status);
    }
    const capture = async (device) => {
      await page.evaluate(async () => { window.scrollTo(0, 0); await document.fonts.ready;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), "NO_HORIZONTAL_OVERFLOW");
      const file = path.join(output, `${device}-home.png`); await page.screenshot({ path: file, fullPage: true });
      proof.screenshots.push({ device, path: file, sha256: sha(await fs.readFile(file)) });
    };
    stage = "ONE_ANONYMOUS_HOME_VISIT";
    await page.goto(HOSTING.origin, { waitUntil: "domcontentloaded", timeout: HOSTING.timeoutMs });
    await expect(page.locator("#content")).toBeVisible(); await expect(page.locator("#loading")).toBeHidden();
    check(Array.isArray(entries), "ACTUAL_BOOTSTRAP_OBSERVED");
    await expect(page.locator("[data-launch-root] h1")).toHaveText("A deposit for your Luma event.");
    await expect(page.locator("[data-public-event-search]")).toBeVisible();
    await expect(page.locator('a[href="#setup=kickback"]')).toHaveText("Set up kickback");
    await expect(page.locator("#luma-setup, [data-luma-launch], #event-switch")).toHaveCount(0);
    await rows(entries); await capture("desktop"); proof.checks.push(stage);
    stage = "CLIENT_SEARCH_AND_CLEAR_NO_API";
    const beforeAPI = proof.counts.api, beforeRequests = proof.counts.requests;
    const query = entries.length ? entries[0].title.slice(0, 120) : "catalog-readonly-empty";
    await page.locator("[data-public-event-search]").fill(query);
    await rows(searchPublicEvents(entries, query), query);
    await expect(page.locator("[data-public-event-clear]")).toBeVisible();
    await page.locator("[data-public-event-clear]").click();
    await expect(page.locator("[data-public-event-search]")).toHaveValue(""); await rows(entries);
    await expect(page.locator("[data-public-event-clear]")).toBeHidden();
    check(proof.counts.api === beforeAPI && proof.counts.requests === beforeRequests, "CLIENT_SEARCH_NO_NEW_REQUESTS");
    proof.checks.push(stage);
    stage = "SAME_PAGE_MOBILE_HOME";
    await page.setViewportSize({ width: 390, height: 844 }); await rows(entries); await capture("mobile");
    proof.checks.push(stage);
    await Promise.all([...pending]);
    check(required.every((name) => proof.assets.some((asset) => asset.path === name && asset.matches)), "REQUIRED_NEW_ASSETS_OBSERVED");
    proof.capabilityProbes = await page.evaluate(() => window.__catalogReadonly);
    check(proof.counts.api === 1 && proof.counts.blocked === 0 && proof.counts.pageErrors === 0 && proof.counts.responseErrors === 0 &&
      proof.capabilityProbes.walletWrites === 0 && proof.capabilityProbes.websocket === 0 && proof.capabilityProbes.serviceWorker === 0 &&
      (await context.cookies()).length === 0 && page.url() === `${HOSTING.origin}/`, "NO_FORBIDDEN_ACCESS_OR_NAVIGATION");
    proof.checks.push("EXACT_SOURCE_HEADERS_ANONYMOUS_NO_FINANCE"); proof.status = "passed";
  } catch (error) {
    proof.status = "failed"; proof.errors.push({ check: stage, code: error instanceof CatalogFailure ? error.code : "CATALOG_READONLY_FAILED" });
  } finally {
    if (browser) await browser.close().catch(() => { proof.status = "failed"; proof.errors.push({ check: "BROWSER_CLOSE", code: "CATALOG_READONLY_FAILED" }); });
    proof.completedAt = new Date().toISOString(); await fs.writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
  }
  console.log(JSON.stringify({ status: proof.status, proof: path.join(output, "proof.json"), source,
    publicEventCount: entries?.length ?? null, screenshots: proof.screenshots.length, apiRequests: proof.counts.api,
    financialActions: 0, errors: proof.errors }, null, 2));
  if (proof.status !== "passed") process.exitCode = 1;
}

export async function main(argv = process.argv.slice(2)) {
  const plan = parseCatalogArgs(argv);
  if (plan.reviewOnly) console.log(JSON.stringify({ status: "review-only", origin: HOSTING.origin,
    execute: "node test/catalog-hosting-readonly.e2e.mjs --execute-readonly --source FULL40_GIT_SHA",
    networkRequests: 0, browserLaunches: 0, financialActions: 0 }, null, 2));
  else if (plan.selfTest) console.log(JSON.stringify(selfTest(), null, 2));
  else await run(plan.source);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error("CATALOG_READONLY_PREFLIGHT_FAILED"); process.exitCode = 1; });
