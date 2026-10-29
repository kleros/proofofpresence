// Explicit anonymous hosting acceptance only. No auth, RPC, signing, financial tests or cloud writes.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { factorySetupIssue } from "../public/luma-factory.js";

export const HOSTING = Object.freeze({
  origin: "https://kleros-luma-ethereum.netlify.app",
  backend: "https://luma-mainnet-backend-production.up.railway.app",
  source: "ae63380642173ebd92afbf76a97d827a3aaa06f3",
  registry: "registry/ethereum-v9-luma-mainnet.json",
  version: "kleros-event-v9-uups",
  unknownEvent: "hosting-readonly-missing-event",
  timeoutMs: 60_000,
});
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const equal = isDeepStrictEqual;
const sameAddress = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
class HostingFailure extends Error { constructor(code) { super(code); this.code = code; } }
const check = (ok, code) => { if (!ok) throw new HostingFailure(code); };
const NETLIFY_COMMENT = Object.freeze({
  siteId: "5daad91a-3e1c-44f8-a43e-a42adacd6936", offset: 71,
  anchor: '<meta charset="utf-8" />\n',
  text: "<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n" +
    "     like this one for free: https://netlify.new/?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=5daad91a-3e1c-44f8-a43e-a42adacd6936\n" +
    "     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->\n",
});

// Comparison only: the original HTTP response is always delivered to Chromium unchanged.
export function compareSourceAsset(name, served, expected, origin = HOSTING.origin) {
  const rawExact = served.equals(expected), rawSha256 = sha(served), expectedSha256 = sha(expected);
  const result = { matches: rawExact, rawExact, rawSha256, normalizedSha256: rawSha256,
    expectedSha256, transform: "exact-bytes", removedBytes: 0 };
  if (rawExact || origin !== HOSTING.origin || name !== "index.html") return result;
  const comment = Buffer.from(NETLIFY_COMMENT.text), anchor = Buffer.from(NETLIFY_COMMENT.anchor);
  const offset = NETLIFY_COMMENT.offset;
  if (served.length !== expected.length + comment.length ||
    expected.indexOf(anchor) + anchor.length !== offset || expected.lastIndexOf(anchor) !== expected.indexOf(anchor) ||
    served.indexOf(comment) !== offset || served.lastIndexOf(comment) !== offset ||
    !served.subarray(offset - anchor.length, offset).equals(anchor)) return result;
  const normalized = Buffer.concat([served.subarray(0, offset), served.subarray(offset + comment.length)]);
  if (!normalized.equals(expected)) return result;
  return { ...result, matches: true, normalizedSha256: sha(normalized),
    transform: "compare-after-one-exact-reviewed-netlify-hosting-comment", removedBytes: comment.length,
    removedOffset: offset, removedSha256: sha(comment), siteId: NETLIFY_COMMENT.siteId,
    responseDelivered: "Original HTTP response unchanged" };
}

export function sourceComparisonSelfTest() {
  const expected = Buffer.from('<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" />\n  </head>\n</html>\n');
  const comment = Buffer.from(NETLIFY_COMMENT.text), offset = NETLIFY_COMMENT.offset;
  const inject = (bytes, at = offset, addition = comment) => Buffer.concat([bytes.subarray(0, at), addition, bytes.subarray(at)]);
  const accepted = [compareSourceAsset("index.html", expected, expected), compareSourceAsset("index.html", inject(expected), expected)];
  check(accepted.every((value) => value.matches) && accepted[0].rawExact && !accepted[1].rawExact &&
    accepted[1].normalizedSha256 === sha(expected), "SELF_TEST_EXPECTED_COMMENT");
  const rejected = [
    compareSourceAsset("index.html", inject(expected, offset, Buffer.from(NETLIFY_COMMENT.text.replace("5daad91a", "6daad91a"))), expected),
    compareSourceAsset("index.html", inject(inject(expected)), expected),
    compareSourceAsset("index.html", inject(expected, offset + 1), expected),
    compareSourceAsset("index.html", inject(expected, offset, Buffer.from("<!-- another comment -->\n")), expected),
    compareSourceAsset("index.html", Buffer.concat([inject(expected), Buffer.from('<script src="/.netlify/scripts/hud.js"></script>')]), expected),
    compareSourceAsset("index.html", inject(Buffer.from(expected.toString().replace("viewport", "viewporX"))), expected),
    compareSourceAsset("app.js", inject(expected), expected),
    compareSourceAsset("index.html", inject(expected), expected, "https://other.example.invalid"),
  ];
  check(rejected.every((value) => !value.matches), "SELF_TEST_UNEXPECTED_BYTES_REJECTED");
  return { status: "passed", accepted: accepted.length, rejected: rejected.length, networkRequests: 0,
    browserLaunches: 0, commentBytes: comment.length, commentSha256: sha(comment) };
}

export function browserRequestAllowed(input, method, body, publicFiles) {
  let url;
  try { url = new URL(input); } catch { return false; }
  if (url.origin !== HOSTING.origin || url.username || url.password || url.hash ||
    !["GET", "HEAD"].includes(method) || body || url.search) return false;
  if (url.pathname === "/api/bootstrap") return method === "GET";
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  return publicFiles.has(name) && !url.pathname.includes("%") && !url.pathname.includes("\\");
}
export function assertFactoryBootstrap(b, manifest, selected = false, { allowPublicEvents = false } = {}) {
  check(b && typeof b === "object" && !Array.isArray(b), "BOOTSTRAP_OBJECT");
  const keys = new Set(["mode", "identities", "session", "events", "chain", "contractVersion", "abiVersion",
    "environment", "arbitration", "walletSupport", "contractProfile", "governance", "recoveryEvents", "now",
    "factory", "organizerSetup", "instanceId", "capabilities", ...(selected ? ["selectedEvent"] : [])]);
  check(Object.keys(b).every((key) => keys.has(key)), "BOOTSTRAP_UNEXPECTED_FIELDS");
  check(b.mode === "hosted-production" && b.session === null && Array.isArray(b.events) &&
    (allowPublicEvents || equal(b.events, [])) && equal(b.identities, []) &&
    equal(b.recoveryEvents, []) && typeof b.instanceId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(b.instanceId),
  "BOOTSTRAP_ANONYMOUS_FACTORY_ONLY");
  check(equal(b.chain, manifest.chain) && b.environment?.production === true &&
    b.environment.network === "ethereum-mainnet" && b.environment.chainId === 1 &&
    b.contractVersion === HOSTING.version && Number.isSafeInteger(b.now) && b.now > 0,
  "BOOTSTRAP_NETWORK_SOURCE_BINDING");
  check(factorySetupIssue(b) === null, "BOOTSTRAP_FACTORY_SETUP_GUARD");
  const f = manifest.factoryDeployment, u = b.factory?.upgrade;
  check(sameAddress(b.factory?.address, f.factory) && b.factory.verified === true &&
    b.factory.deploymentTrust?.status === "verified" && sameAddress(u?.implementation, f.factoryImplementation) &&
    u.implementationCodeHash === f.factoryImplementationCodeHash && sameAddress(u.authority, f.upgradeAuthority) &&
    sameAddress(u.owner, manifest.governance.initialOwner) && u.pendingOwner === null &&
    u.governanceKind === "single-owner-timelock" && u.delaySeconds >= 172800 &&
    u.pendingOperationCount === 0 && u.executingOperationCount === 0 && u.pending === null &&
    equal(b.governance, manifest.governance), "BOOTSTRAP_EXACT_FACTORY_GOVERNANCE");
  const setup = b.organizerSetup;
  check(setup.policyStatus === "verified" && setup.policyURI === f.policy.uri && setup.policySha256 === f.policy.sha256 &&
    setup.challengeWindowSeconds === 86400 && setup.matchWindowSeconds === 86400 && setup.minimumClaimDays === 7,
  "BOOTSTRAP_APPROVED_POLICY");
  check(b.arbitration?.verified === true && b.arbitration.mode === "kleros-v1" &&
    sameAddress(b.arbitration.resolver, manifest.arbitration.resolver) &&
    sameAddress(b.arbitration.arbitrator, manifest.arbitration.arbitrator) &&
    b.arbitration.extraData === manifest.arbitration.extraData, "BOOTSTRAP_REAL_COURT");
  const caps = b.capabilities;
  check(["browserWallet", "production", "walletTransactions", "lumaDepositPortal", "walletFirstDeposits", "createEvents"].every((key) => caps?.[key] === true) &&
    ["serverSigning", "sharedDemo", "reset", "timeTravel", "timeControls", "mockRulings", "contractWallets", "erc1271", "eip7702"].every((key) => caps?.[key] === false) &&
    equal(caps.supportedAccountTypes, ["eoa"]) && typeof caps.transactionsReady === "boolean",
  "BOOTSTRAP_KEYLESS_CAPABILITIES");
  if (selected) check(caps.selectedEventBootstrap === true && b.selectedEvent?.eventId === HOSTING.unknownEvent &&
    b.selectedEvent.instanceId === b.instanceId && b.selectedEvent.wallet === null && b.selectedEvent.detail === null &&
    equal(b.selectedEvent.error, { code: "NOT_FOUND", status: 404, message: "Unknown event" }),
  "UNKNOWN_SELECTED_CASE_SANITIZED");
  else check(!Object.hasOwn(b, "selectedEvent"), "BOOTSTRAP_NO_FAKE_EVENT");
  return { mode: b.mode, instanceId: b.instanceId, chainId: 1, eventCount: b.events.length, session: null,
    factory: b.factory.address, factoryVerified: true, factoryTrust: b.factory.deploymentTrust.status,
    governanceKind: u.governanceKind, owner: u.owner, pendingOwner: u.pendingOwner, delaySeconds: u.delaySeconds,
    policyURI: setup.policyURI, policySha256: setup.policySha256, policyStatus: setup.policyStatus,
    serverSigning: false, createEvents: caps.createEvents, transactionsReady: caps.transactionsReady };
}
function staticHeaders(headers) {
  const csp = headers.get("content-security-policy")?.split(";").map((x) => x.trim()).filter(Boolean).join("; ");
  check(csp === CSP && headers.get("x-content-type-options") === "nosniff" &&
    headers.get("referrer-policy") === "same-origin" && headers.get("x-frame-options") === "SAMEORIGIN",
  "STATIC_SECURITY_HEADERS");
}
function apiHeaders(headers) {
  check(headers.get("cache-control")?.includes("no-store") && headers.get("cache-control")?.includes("private") &&
    headers.get("vary")?.toLowerCase().includes("cookie") && headers.get("vary")?.toLowerCase().includes("origin") &&
    headers.get("x-content-type-options") === "nosniff" && headers.get("referrer-policy") === "same-origin" &&
    !headers.has("set-cookie") && !headers.has("x-kleros-proxy-key"), "ANONYMOUS_GATEWAY_HEADERS");
}
async function bytesOf(response, maximum) {
  const chunks = []; let size = 0;
  check(response.body && typeof response.body.getReader === "function", "HTTP_BODY_UNAVAILABLE");
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength; check(size <= maximum, "HTTP_BODY_LIMIT"); chunks.push(value);
    }
  } finally { try { await reader.cancel(); } catch {} }
  return Buffer.concat(chunks.map((x) => Buffer.from(x)));
}
function jsonOf(bytes) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HostingFailure("HTTP_JSON_INVALID"); }
}
function publicError(value, expectedCode, expectedMessage) {
  check(value && equal(Object.keys(value).sort(), ["code", "error"]) && value.code === expectedCode &&
    value.error === expectedMessage, "PUBLIC_ERROR_SANITIZED");
}

async function run() {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, maxBuffer: 20_000_000, stdio: ["ignore", "pipe", "ignore"] });
  const publicFiles = new Map(git("ls-tree", "-r", "--name-only", HOSTING.source, "--", "public").toString().trim().split("\n")
    .filter((name) => name.startsWith("public/")).map((name) => [name.slice(7), git("show", `${HOSTING.source}:${name}`)]));
  const registryRaw = git("show", `${HOSTING.source}:${HOSTING.registry}`), manifest = jsonOf(registryRaw);
  check(equal(manifest.events, []) && manifest.environment === "production" && manifest.chain?.chainId === 1 &&
    manifest.factoryDeployment?.policyStatus === "published" &&
    sha(Buffer.from(manifest.factoryDeployment.policy.text)) === manifest.factoryDeployment.policy.sha256,
  "SOURCE_FACTORY_MANIFEST");
  const policyURI = manifest.factoryDeployment.policy.uri, policyURL = new URL(policyURI);
  check(policyURL.origin === "https://cdn.kleros.link" && /^\/ipfs\/Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(policyURL.pathname) &&
    !policyURL.username && !policyURL.password && !policyURL.search && !policyURL.hash, "SOURCE_POLICY_ALLOWLIST");
  for (const name of ["luma-factory.js", "environment.js", "contract-profiles.js", "luma-launch.js"])
    check(sha(await fs.readFile(path.join(ROOT, "public", name))) === sha(publicFiles.get(name)), "LOCAL_PURE_HELPER_SOURCE");
  const headersSource = git("show", `${HOSTING.source}:scripts/build-hosted-frontend.mjs`).toString();
  check(headersSource.includes(`Content-Security-Policy: ${CSP}`), "SOURCE_CSP_BINDING");
  const output = path.join(ROOT, "artifacts/mainnet-hosting-readonly", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  await fs.mkdir(output, { recursive: true });
  const proof = { status: "running", kind: "anonymous-factory-only-hosting-readonly", startedAt: new Date().toISOString(),
    source: HOSTING.source, origin: HOSTING.origin, backend: HOSTING.backend,
    checkerSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))), registry: HOSTING.registry, registrySha256: sha(registryRaw),
    expectedPublicAssetCount: publicFiles.size,
    assetComparisonPolicy: { default: "Exact source bytes", indexOnlyException: { siteId: NETLIFY_COMMENT.siteId,
      offset: NETLIFY_COMMENT.offset, anchor: NETLIFY_COMMENT.anchor, bytes: Buffer.byteLength(NETLIFY_COMMENT.text),
      sha256: sha(Buffer.from(NETLIFY_COMMENT.text)), maximumOccurrences: 1 }, responseDelivered: "Original HTTP response unchanged" },
    publicSourcePins: Object.fromEntries([...publicFiles].map(([name, bytes]) => [name, sha(bytes)])),
    checks: [], requests: [], assets: [], devices: [], errors: [],
    limitations: ["Factory-only release with zero events: no claim of actual private-event isolation or participant/owner financial behavior.",
      "Fresh anonymous desktop/mobile presentation only; no wallet extension, authentication, event creation, deposit or transaction.",
      "Only GET/HEAD HTTP. No RPC, upload, signature, broadcast, financial test, deployment or cloud configuration change.",
      "Policy gateway byte availability is checked at this observation only; no permanent availability guarantee."] };
  let stage = "PREFLIGHT", browser;
  async function get(url) {
    const u = new URL(url);
    const allowed = url === policyURI || (u.origin === HOSTING.backend && ["/healthz", "/api/bootstrap"].includes(u.pathname) && !u.search) ||
      (u.origin === HOSTING.origin && !u.username && !u.password && !u.hash &&
        ((!u.search && (u.pathname === "/" || publicFiles.has(u.pathname.slice(1)) ||
          ["/api/bootstrap", "/api/organizer/events/drafts/hosting-readonly-missing-draft"].includes(u.pathname))) ||
          u.href === `${HOSTING.origin}/api/bootstrap?selectedEventId=${HOSTING.unknownEvent}`));
    check(allowed && !u.username && !u.password, "NODE_REQUEST_ALLOWLIST");
    const response = await fetch(url, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(HOSTING.timeoutMs) });
    check(!response.redirected, "HTTP_REDIRECT");
    const bytes = await bytesOf(response, 2_000_000);
    proof.requests.push({ check: stage, method: "GET", target: url === policyURI ? "approved-policy" : u.origin === HOSTING.backend ? `backend${u.pathname}` : u.pathname,
      status: response.status, sha256: sha(bytes), bytes: bytes.length });
    return { response, bytes, value: () => jsonOf(bytes) };
  }
  async function step(name, work) {
    stage = name; await work(); proof.checks.push(name);
    console.log(JSON.stringify({ checkpoint: name, status: "passed" }));
  }
  try {
    await step("PUBLIC_BOOTSTRAP", async () => {
      const { response, value } = await get(`${HOSTING.origin}/api/bootstrap`);
      check(response.status === 200, "BOOTSTRAP_HTTP_STATUS"); apiHeaders(response.headers);
      proof.bootstrap = assertFactoryBootstrap(value(), manifest);
    });
    await step("POLICY_EXACT_BYTES", async () => {
      const { response, bytes } = await get(policyURI);
      check(response.status === 200 && sha(bytes) === manifest.factoryDeployment.policy.sha256 &&
        bytes.equals(Buffer.from(manifest.factoryDeployment.policy.text)), "POLICY_BYTES_SHA256");
    });
    await step("UNKNOWN_EVENT_NO_DISCLOSURE", async () => {
      const { response, value } = await get(`${HOSTING.origin}/api/bootstrap?selectedEventId=${HOSTING.unknownEvent}`);
      check(response.status === 200, "UNKNOWN_BOOTSTRAP_HTTP_STATUS"); apiHeaders(response.headers);
      assertFactoryBootstrap(value(), manifest, true);
    });
    await step("ANONYMOUS_REVIEW_FORBIDDEN", async () => {
      const { response, value } = await get(`${HOSTING.origin}/api/organizer/events/drafts/hosting-readonly-missing-draft`);
      check(response.status === 401, "ANONYMOUS_REVIEW_HTTP_STATUS"); apiHeaders(response.headers);
      publicError(value(), "UNAUTHENTICATED", "Sign in with your wallet before continuing.");
    });
    await step("BACKEND_HEALTH_MINIMAL", async () => {
      const { response, value } = await get(`${HOSTING.backend}/healthz`);
      check(response.status === 200 && equal(value(), { status: "ok", mode: "hosted-production" }), "BACKEND_HEALTH_DTO");
    });
    await step("BACKEND_PROXY_REQUIRED", async () => {
      const { response, value } = await get(`${HOSTING.backend}/api/bootstrap`);
      check(response.status === 403, "BACKEND_PROXY_HTTP_STATUS");
      publicError(value(), "PROXY_REQUIRED", "Use the configured application gateway for this request.");
    });
    await step("STATIC_PREFLIGHT_EXACT_SOURCE", async () => {
      for (const [name, expected] of publicFiles) {
        if (name !== "index.html" && !/\.(?:js|css)$/.test(name)) continue;
        const { response, bytes } = await get(`${HOSTING.origin}/${name === "index.html" ? "" : name}`);
        const comparison = compareSourceAsset(name, bytes, expected);
        check(response.status === 200 && comparison.matches, "STATIC_SOURCE_BYTES"); staticHeaders(response.headers);
        proof.assets.push({ path: name, sha256: sha(bytes), sourceSha256: sha(expected), ...comparison });
      }
    });
    stage = "BROWSER_SETUP";
    const playwright = await import("@playwright/test");
    const expect = playwright.expect.configure({ timeout: HOSTING.timeoutMs });
    browser = await playwright.chromium.launch({ headless: true });
    for (const [device, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
      stage = `BROWSER_${device.toUpperCase()}`;
      const data = { device, viewport, requests: 0, blocked: 0, pageErrors: 0, responseErrors: 0, checks: [], screenshots: [] };
      proof.devices.push(data);
      const context = await browser.newContext({ viewport, isMobile: device === "mobile", hasTouch: device === "mobile",
        reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: false });
      await context.routeWebSocket("**/*", (socket) => { data.blocked++; socket.close({ code: 1008, reason: "Read-only checker" }); });
      await context.addInitScript(() => {
        window.__hostingReadonly = { walletReads: 0, walletWrites: 0, websocket: 0, serviceWorker: 0 };
        Object.defineProperty(window, "ethereum", { configurable: false,
          get() { window.__hostingReadonly.walletReads++; return undefined; }, set() { window.__hostingReadonly.walletWrites++; } });
        window.WebSocket = class { constructor() { window.__hostingReadonly.websocket++; throw Error("Read-only checker"); } };
        try { navigator.serviceWorker.register = () => { window.__hostingReadonly.serviceWorker++; return Promise.reject(Error("Read-only checker")); }; } catch {}
      });
      await context.route("**/*", async (route) => {
        const request = route.request(); data.requests++;
        if (!browserRequestAllowed(request.url(), request.method(), request.postData(), publicFiles)) {
          data.blocked++; await route.abort("blockedbyclient"); return;
        }
        try {
          const response = await route.fetch({ maxRedirects: 0, timeout: HOSTING.timeoutMs });
          check(response.status() === 200, "BROWSER_RESPONSE_HTTP_STATUS");
          const headers = new Headers(response.headers()), bytes = await response.body(), u = new URL(request.url());
          if (u.pathname === "/api/bootstrap") { apiHeaders(headers); assertFactoryBootstrap(jsonOf(bytes), manifest); }
          else {
            const name = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
            const comparison = compareSourceAsset(name, bytes, publicFiles.get(name));
            check(comparison.matches, "BROWSER_STATIC_SOURCE_BYTES"); staticHeaders(headers);
            proof.assets.push({ device, path: name, sha256: sha(bytes), sourceSha256: sha(publicFiles.get(name)), ...comparison });
          }
          await route.fulfill({ response });
        } catch { data.responseErrors++; await route.abort("failed").catch(() => {}); }
      });
      const page = await context.newPage();
      page.on("pageerror", () => { data.pageErrors++; });
      const capture = async (name) => {
        await page.evaluate(async () => { window.scrollTo(0, 0); await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
        const file = `${device}-${name}.png`, absolute = path.join(output, file);
        await page.screenshot({ path: absolute, fullPage: true });
        data.screenshots.push({ path: absolute, sha256: sha(await fs.readFile(absolute)) });
      };
      await page.goto(HOSTING.origin, { waitUntil: "domcontentloaded", timeout: HOSTING.timeoutMs });
      await expect(page.locator("#content")).toBeVisible(); await expect(page.locator("#loading")).toBeHidden();
      await expect(page.locator("[data-launch-root] h1")).toHaveText("A deposit for your Luma event.");
      await expect(page.locator('[data-launch-open-link], [data-form="launch-link"], #launch-event-link')).toHaveCount(0);
      await expect(page.locator("[data-launch-root] .luma-launch-card").first().locator("p"))
        .toHaveText("Open the event-specific deposit link from your Luma registration. It takes you straight to your event.");
      await expect(page.locator('a[href="#setup=kickback"]')).toHaveText("Set up kickback");
      await expect(page.locator("#event-switch, [data-luma-launch], .event-grid, .event-card")).toHaveCount(0);
      data.checks.push("ROOT_FACTORY_ONLY_NO_EVENT"); await capture("root");
      await page.locator('a[href="#setup=kickback"]').click();
      await expect(page.locator("#luma-setup .luma-setup h1")).toHaveText("Set up kickback.");
      await expect(page.locator("#luma-setup h2")).toHaveText("Connect your organizer wallet");
      await expect(page.locator("#luma-setup [data-connect-wallet]")).toBeVisible();
      await expect(page.locator("#luma-setup [data-luma-attendance-standard]")).toBeVisible();
      await expect(page.locator('#luma-setup [data-luma-setup-issue], [data-luma-form], [data-luma-action="review"], [data-luma-action="confirm"], [data-luma-dialog]')).toHaveCount(0);
      check(new URL(page.url()).hash === "#setup=kickback", "BROWSER_SETUP_HASH");
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), "BROWSER_NO_HORIZONTAL_OVERFLOW");
      data.checks.push("SETUP_ANONYMOUS_WALLET_GATE_ONLY"); await capture("setup");
      data.capabilityProbes = await page.evaluate(() => window.__hostingReadonly);
      check(Number.isSafeInteger(data.capabilityProbes.walletReads) && data.capabilityProbes.walletReads >= 0 &&
        data.capabilityProbes.walletWrites === 0 && data.capabilityProbes.websocket === 0 && data.capabilityProbes.serviceWorker === 0 &&
        data.blocked === 0 && data.pageErrors === 0 && data.responseErrors === 0, "BROWSER_NO_FORBIDDEN_ACCESS_OR_ERRORS");
      check((await context.cookies()).length === 0, "BROWSER_ANONYMOUS_NO_COOKIE");
      data.checks.push("NO_AUTH_MUTATION_SIGNING_RPC_WS_SW");
      await context.close(); proof.checks.push(stage);
      console.log(JSON.stringify({ checkpoint: stage, status: "passed" }));
    }
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    // Never persist exception messages, stacks, upstream bodies, URLs or request buffers.
    proof.errors.push({ check: stage, code: error instanceof HostingFailure ? error.code : "READONLY_CHECK_FAILED" });
  } finally {
    if (browser) await browser.close().catch(() => { proof.status = "failed"; proof.errors.push({ check: "BROWSER_CLOSE", code: "READONLY_CHECK_FAILED" }); });
    proof.completedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
  }
  console.log(JSON.stringify({ status: proof.status, source: HOSTING.source, proof: path.join(output, "proof.json"),
    checkCount: proof.checks.length, screenshots: proof.devices.reduce((sum, d) => sum + d.screenshots.length, 0),
    errors: proof.errors, financialActions: 0, walletActions: 0 }, null, 2));
  if (proof.status !== "passed") process.exitCode = 1;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--self-test") { console.log(JSON.stringify(sourceComparisonSelfTest(), null, 2)); return; }
  if (argv.length === 0) {
    console.log(JSON.stringify({ status: "review-only", ...HOSTING,
      execute: "node test/mainnet-hosting-readonly.e2e.mjs --execute-readonly",
      networkRequests: 0, browserLaunches: 0, authActions: 0, financialActions: 0 }, null, 2));
    return;
  }
  check(argv.length === 1 && argv[0] === "--execute-readonly", "EXPLICIT_READONLY_FLAG_REQUIRED");
  await run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error("READONLY_CHECK_PREFLIGHT_FAILED"); process.exitCode = 1; });
