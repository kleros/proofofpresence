// Operator-only anonymous readback; default/self-tests/source checks perform no network access.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import {
  factorySetupIssue,
  creationReviewDisclosure,
} from "../public/luma-factory.js";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const HOSTING = Object.freeze({
  origin: "https://kleros-luma-v10-ethereum.netlify.app",
  source: "06225aeaa56668bf5149171bd76dc9882422813c",
  siteId: "5248ed3e-5322-437b-bdd7-0930ce209c72",
  registry: "registry/ethereum-v10-luma-mainnet.json",
  version: "kleros-event-v10-uups",
  timeoutMs: 75000,
});
const POLICY =
    "https://cdn.kleros.link/ipfs/QmVgFPcr2MPUc7BT84YiU4h2zdXpKyX2DHL6CWBabdAXmD",
  POLICY_SHA =
    "525453aee59b7d3f48e96f6ad5ea6aa9807fc6cfef8a495f5f645e3e3ca231a4",
  REGISTRY_SHA =
    "fadbb93a7d7d653eb610dbb26eb406a3fe88d55fbaa35ba3f34d83ff3ade6efd";
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://api.web3modal.org; font-src 'self'; connect-src 'self' https://api.web3modal.org https://rpc.walletconnect.org https://verify.walletconnect.org wss://relay.walletconnect.org; frame-src 'self' https://verify.walletconnect.org; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
const comment =
  "<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n" +
  "     like this one for free: https://netlify.new/?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=" +
  HOSTING.siteId +
  "\n" +
  "     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->\n";
// The same site ID retains its exact hosting comment after the human's rename.
// This affects byte comparison only; historical request/execute gates stay frozen.
const COMMENT_ORIGINS = new Set([HOSTING.origin, "https://kleros-kickback.netlify.app"]);
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  same = (a, b) =>
    typeof a === "string" &&
    typeof b === "string" &&
    a.toLowerCase() === b.toLowerCase(),
  ZERO = "0x" + "0".repeat(40);
class Failure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const check = (ok, code) => {
  if (!ok) throw new Failure(code);
};
const git = (...args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    maxBuffer: 20_000_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
export function compareAsset(name, served, expected, origin = HOSTING.origin) {
  const result = {
    matches: served.equals(expected),
    rawExact: served.equals(expected),
    rawSha256: sha(served),
    sourceSha256: sha(expected),
    transform: "exact-bytes",
  };
  if (
    result.matches ||
    !COMMENT_ORIGINS.has(origin) ||
    !["index.html", "recovery.html"].includes(name)
  )
    return result;
  const extra = Buffer.from(comment),
    anchor = Buffer.from('<meta charset="utf-8" />\n'),
    offset = 71;
  if (
    served.length !== expected.length + extra.length ||
    expected.indexOf(anchor) + anchor.length !== offset ||
    expected.lastIndexOf(anchor) !== expected.indexOf(anchor) ||
    served.indexOf(extra) !== offset ||
    served.lastIndexOf(extra) !== offset ||
    !served.subarray(offset - anchor.length, offset).equals(anchor)
  )
    return result;
  const normalized = Buffer.concat([
    served.subarray(0, offset),
    served.subarray(offset + extra.length),
  ]);
  return {
    ...result,
    matches: normalized.equals(expected),
    transform: "one-exact-reviewed-new-site-comment",
    normalizedSha256: sha(normalized),
    siteId: HOSTING.siteId,
    removedOffset: offset,
    removedBytes: extra.length,
    removedSha256: sha(extra),
    responseDelivered: "Original response unchanged",
  };
}
export function browserRequestAllowed(input, method, body, files) {
  let u;
  try {
    u = new URL(input);
  } catch {
    return false;
  }
  if (
    u.origin !== HOSTING.origin ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !["GET", "HEAD"].includes(method) ||
    body
  )
    return false;
  if (["/api/bootstrap", "/api/public-catalog"].includes(u.pathname))
    return method === "GET";
  return (
    !u.pathname.includes("%") &&
    !u.pathname.includes("\\") &&
    files.has(u.pathname === "/" ? "index.html" : u.pathname.slice(1))
  );
}
function safeMetadata(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    check(
      !/private.?key|mnemonic|seed|password|secret|api.?key|api.?token|authorization|signature|raw.?transaction|cookie|proxy.?key/i.test(
        key,
      ),
      "SENSITIVE_METADATA_FIELD",
    );
    safeMetadata(child);
  }
}
export function assertCatalog(c, m) {
  safeMetadata(c);
  check(
    c?.schemaVersion === 1 &&
      c.kind === "public-catalog" &&
      c.mode === "hosted-production" &&
      c.contractVersion === HOSTING.version &&
      c.environment?.production === true &&
      c.environment.chainId === 1 &&
      c.environment.network === "ethereum-mainnet" &&
      equal(c.chain, m.chain) &&
      equal(c.governance, m.governance) &&
      equal(c.events, []) &&
      equal(c.catalog, {
        metadataOnly: true,
        currentFinancialState: "not-loaded",
        source: "recorded-adoption",
      }) &&
      typeof c.instanceId === "string" &&
      !Object.hasOwn(c, "session") &&
      !Object.hasOwn(c, "participants") &&
      !Object.hasOwn(c, "factory"),
    "CATALOG_METADATA_ONLY_EMPTY",
  );
  return {
    eventCount: 0,
    metadataOnly: true,
    currentFinancialState: "not-loaded",
    instanceId: c.instanceId,
  };
}
export function assertBootstrap(b, m) {
  safeMetadata(b);
  const allowed = new Set([
    "mode",
    "identities",
    "session",
    "events",
    "chain",
    "contractVersion",
    "abiVersion",
    "environment",
    "arbitration",
    "walletSupport",
    "contractProfile",
    "governance",
    "recoveryEvents",
    "now",
    "factory",
    "organizerSetup",
    "instanceId",
    "capabilities",
    "features",
  ]);
  check(
    b &&
      Object.keys(b).every((k) => allowed.has(k)) &&
      b.mode === "hosted-production" &&
      b.session === null &&
      equal(b.events, []) &&
      equal(b.identities, []) &&
      equal(b.recoveryEvents, []) &&
      typeof b.instanceId === "string" &&
      /^[A-Za-z0-9_-]{1,160}$/.test(b.instanceId),
    "ANONYMOUS_FACTORY_ONLY",
  );
  check(
    equal(b.chain, m.chain) &&
      b.contractVersion === HOSTING.version &&
      b.abiVersion === HOSTING.version &&
      equal(b.environment, {
        production: true,
        network: "ethereum-mainnet",
        chainId: 1,
      }) &&
      Number.isSafeInteger(b.now) &&
      b.now > 0,
    "V10_CHAIN_PROFILE",
  );
  check(factorySetupIssue(b) === null, "FACTORY_SETUP_GUARD");
  const f = m.factoryDeployment,
    u = b.factory?.upgrade;
  check(
    b.factory.chainId === 1 &&
      same(b.factory.address, f.factory) &&
      b.factory.verified === true &&
      b.factory.contractVersion === HOSTING.version &&
      b.factory.abiVersion === HOSTING.version &&
      b.factory.deploymentTrust?.status === "verified" &&
      u?.kind === "uups" &&
      u.version === 10 &&
      u.verified === true &&
      same(u.implementation, f.factoryImplementation) &&
      u.implementationCodeHash === f.factoryImplementationCodeHash &&
      same(u.authority, f.upgradeAuthority) &&
      u.authorityCodeHash === f.upgradeAuthorityCodeHash &&
      same(u.initialOwner, m.governance.initialOwner) &&
      same(u.owner, m.governance.initialOwner) &&
      same(u.pendingOwner, ZERO) &&
      u.governanceKind === "single-owner-immediate" &&
      u.delaySeconds === 0 &&
      u.upgradesDisabled === false &&
      u.finalizationVerified === false &&
      u.finalizationScope === "factory" &&
      !["pending", "pendingOperationCount", "executingOperationCount"].some(
        (k) => Object.hasOwn(u, k),
      ) &&
      equal(b.governance, m.governance),
    "EXACT_IMMEDIATE_FACTORY_GOVERNANCE",
  );
  const p = b.contractProfile;
  check(
    p?.contractVersion === HOSTING.version &&
      p.abiVersion === HOSTING.version &&
      p.version === 10 &&
      p.financialModel === "v8" &&
      p.verified === true &&
      p.upgradeable === true &&
      p.chainId === 1 &&
      p.testOnly === false &&
      p.governanceKind === "single-owner-immediate" &&
      p.upgradeDelaySeconds === 0 &&
      p.challengeWindowSeconds === 86400 &&
      p.matchWindowSeconds === 86400,
    "EXACT_V10_CONTRACT_PROFILE",
  );
  const setup = b.organizerSetup;
  check(
    setup.policyStatus === "verified" &&
      setup.policyURI === POLICY &&
      setup.policySha256 === POLICY_SHA &&
      setup.challengeWindowSeconds === 86400 &&
      setup.matchWindowSeconds === 86400 &&
      setup.minimumClaimDays === 7,
    "EXACT_PUBLISHED_POLICY_METADATA",
  );
  check(
    b.arbitration?.verified === true &&
      b.arbitration.mode === "kleros-v1" &&
      same(b.arbitration.resolver, m.arbitration.resolver) &&
      same(b.arbitration.arbitrator, m.arbitration.arbitrator) &&
      b.arbitration.extraData === m.arbitration.extraData,
    "VERIFIED_REAL_COURT",
  );
  const c = b.capabilities,
    w = b.walletSupport;
  check(
    [
      "production",
      "browserWallet",
      "walletTransactions",
      "lumaDepositPortal",
      "walletFirstDeposits",
      "createEvents",
      "organizerJobs",
      "transactionsReady",
      "eip7702",
    ].every((k) => c?.[k] === true) &&
      [
        "serverSigning",
        "sharedDemo",
        "reset",
        "timeTravel",
        "timeControls",
        "mockRulings",
        "contractWallets",
        "erc1271",
        "casePublication",
        "originalCreationRecovery",
      ].every((k) => c?.[k] === false) &&
      equal(c.supportedAccountTypes, ["eoa", "metamask-protected-self-v1.3"]) &&
      w?.type === "eoa-or-metamask-protected-self-v1.3" &&
      w.eoa === true &&
      w.eip7702 === true &&
      w.erc1271 === false &&
      w.accountPolicyVersion === "v10-metamask-self-v1.3-1" &&
      equal(b.features, {
        casePublication: false,
        originalCreationRecovery: false,
      }),
    "EXACT_KEYLESS_ACCOUNT_POLICY",
  );
  const disclosure = creationReviewDisclosure(b);
  check(
    disclosure?.publication === "Public · Published" &&
      /immediately/.test(disclosure.upgradeNotice) &&
      /no mandatory upgrade delay/i.test(disclosure.upgradeNotice),
    "SOURCE_CUSTODY_DISCLOSURE",
  );
  return {
    mode: b.mode,
    chainId: 1,
    instanceId: b.instanceId,
    eventCount: 0,
    session: null,
    factory: b.factory.address,
    verified: true,
    owner: u.owner,
    pendingOwner: u.pendingOwner,
    governanceKind: u.governanceKind,
    delaySeconds: 0,
    upgradesDisabled: false,
    policyURI: setup.policyURI,
    policySha256: setup.policySha256,
    serverSigning: false,
    custodyNotice: disclosure.upgradeNotice,
    custodyCheckLimit:
      "Pure source projection; no authenticated financial review is opened.",
  };
}
function staticHeaders(h) {
  check(
    h
      .get("content-security-policy")
      ?.split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .join("; ") === CSP &&
      h.get("x-content-type-options") === "nosniff" &&
      h.get("referrer-policy") === "same-origin" &&
      h.get("x-frame-options") === "SAMEORIGIN",
    "STATIC_SECURITY_HEADERS",
  );
}
function apiHeaders(h) {
  check(
    h.get("cache-control")?.includes("no-store") &&
      h.get("cache-control")?.includes("private") &&
      h.get("vary")?.toLowerCase().includes("cookie") &&
      h.get("vary")?.toLowerCase().includes("origin") &&
      h.get("x-content-type-options") === "nosniff" &&
      h.get("referrer-policy") === "same-origin" &&
      !h.has("set-cookie") &&
      !h.has("x-kleros-proxy-key"),
    "ANONYMOUS_API_HEADERS",
  );
}
const json = (bytes) => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Failure("INVALID_JSON");
  }
};
async function boundedBytes(response) {
  const reader = response.body?.getReader();
  check(reader, "HTTP_BODY_REQUIRED");
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      check(size <= 2_000_000, "BODY_TOO_LARGE");
      parts.push(Buffer.from(chunk.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts);
}
export async function sourceChecks() {
  const files = new Map(
    git("ls-tree", "-r", "--name-only", HOSTING.source, "--", "public")
      .toString()
      .trim()
      .split("\n")
      .map((name) => [name.slice(7), git("show", HOSTING.source + ":" + name)]),
  );
  const bytes = git("show", HOSTING.source + ":" + HOSTING.registry),
    manifest = json(bytes),
    f = manifest.factoryDeployment;
  check(
    sha(bytes) === REGISTRY_SHA &&
      manifest.environment === "production" &&
      manifest.chain.chainId === 1 &&
      equal(manifest.events, []) &&
      f.contractVersion === HOSTING.version &&
      f.abiVersion === HOSTING.version &&
      f.policyStatus === "published" &&
      f.policy.uri === POLICY &&
      f.policy.sha256 === POLICY_SHA &&
      Buffer.byteLength(f.policy.text) === 9906 &&
      sha(Buffer.from(f.policy.text)) === POLICY_SHA,
    "FROZEN_PUBLISHED_MANIFEST",
  );
  check(
    same(f.factory, "0x2E10024bD326FD34757b021A72F46813Fc1C61D2") &&
      same(f.implementation, "0x411ADfb7490C664362D7F933f693B41eE4E997c3") &&
      same(
        f.factoryImplementation,
        "0x5bD88F176d66e7daF87BD3Ff1d783DC26322B829",
      ) &&
      same(f.upgradeAuthority, "0x8819994609eC122AaC2B4CC2200e694C6b039Cd2") &&
      same(
        manifest.governance.initialOwner,
        "0x2bb03593892724d225071068E59ab1E48aF05b55",
      ) &&
      manifest.governance.upgradeDelaySeconds === 0 &&
      manifest.governance.kind === "single-owner-immediate",
    "FROZEN_FACTORY_IDENTITIES",
  );
  for (const name of [
    "luma-factory.js",
    "environment.js",
    "contract-profiles.js",
    "luma-launch.js",
  ])
    check(
      sha(await fs.readFile(path.join(ROOT, "public", name))) ===
        sha(files.get(name)),
      "IMPORTED_PURE_HELPER_SOURCE_CHANGED",
    );
  check(
    sha(files.get("app.js")) ===
      "b7354d1a12f764b804dd8ea7d2b63e18d919cb16dca32c354ce3614a7a04cb04",
    "STABLE_APP_SOURCE",
  );
  const headers = git(
    "show",
    HOSTING.source + ":scripts/build-hosted-frontend.mjs",
  ).toString();
  check(
    headers.includes("Content-Security-Policy: " + CSP),
    "FROZEN_CSP_SOURCE",
  );
  return { files, manifest, registrySha256: sha(bytes) };
}
export function selfTest() {
  const base = Buffer.from(
      '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" />\n  </head>\n</html>\n',
    ),
    extra = Buffer.from(comment),
    inject = (value, offset = 71, addon = extra) =>
      Buffer.concat([value.subarray(0, offset), addon, value.subarray(offset)]);
  check(
    compareAsset("index.html", base, base).matches &&
      compareAsset("index.html", inject(base), base).matches &&
      compareAsset("index.html", inject(base), base, "https://kleros-kickback.netlify.app").matches &&
      compareAsset("recovery.html", inject(base), base).matches,
    "COMMENT_POSITIVES",
  );
  const negatives = [
    inject(base, 72),
    inject(inject(base)),
    inject(
      base,
      71,
      Buffer.from(
        comment.replace(HOSTING.siteId, "6248ed3e-5322-437b-bdd7-0930ce209c72"),
      ),
    ),
    Buffer.concat([inject(base), Buffer.from("<script>extra()</script>")]),
    inject(Buffer.from(base.toString().replace("viewport", "changed"))),
  ];
  check(
    negatives.every(
      (value) => !compareAsset("index.html", value, base).matches,
    ) &&
      !compareAsset("app.js", inject(base), base).matches &&
      !compareAsset("index.html", inject(base), base, "https://kleros-kickback.netlify.app.example.invalid").matches &&
      !compareAsset(
        "index.html",
        inject(base),
        base,
        "https://other.example.invalid",
      ).matches,
    "COMMENT_NEGATIVES",
  );
  const files = new Map([
    ["index.html", base],
    ["app.js", base],
  ]);
  check(
    browserRequestAllowed(
      HOSTING.origin + "/api/bootstrap",
      "GET",
      null,
      files,
    ) &&
      browserRequestAllowed(
        HOSTING.origin + "/api/public-catalog",
        "GET",
        null,
        files,
      ) &&
      browserRequestAllowed(HOSTING.origin + "/app.js", "HEAD", null, files),
    "REQUEST_POSITIVES",
  );
  for (const [url, method, body] of [
    [HOSTING.origin + "/api/bootstrap", "POST", "{}"],
    [HOSTING.origin + "/rpc", "POST", "{}"],
    [HOSTING.origin + "/api/auth/challenge", "GET", null],
    [HOSTING.origin + "/api/bootstrap?x=1", "GET", null],
    ["https://other.example.invalid/app.js", "GET", null],
  ])
    check(!browserRequestAllowed(url, method, body, files), "REQUEST_NEGATIVE");
  return {
    status: "passed",
    commentPositiveCases: 4,
    commentNegativeCases: 8,
    requestPositiveCases: 3,
    requestNegativeCases: 5,
    networkRequests: 0,
    browserLaunches: 0,
  };
}
export async function run() {
  const { files, manifest, registrySha256 } = await sourceChecks(),
    output = path.join(
      ROOT,
      "artifacts/v10-hosting-readonly",
      new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID(),
    );
  await fs.mkdir(output, { recursive: true });
  const proof = {
    kind: "anonymous-v10-factory-only-hosting-readonly",
    status: "running",
    source: HOSTING.source,
    origin: HOSTING.origin,
    siteId: HOSTING.siteId,
    checkerSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
    registrySha256,
    sourcePins: Object.fromEntries([...files].map(([n, b]) => [n, sha(b)])),
    checks: [],
    requests: [],
    assets: [],
    devices: [],
    errors: [],
    financialActions: 0,
    walletActions: 0,
    limitations: [
      "Anonymous factory-only zero-event release. No actual private-event, owner/participant financial or real wallet acceptance is tested.",
      "Bootstrap performs authoritative read-only backend verification. Requests are sequential; no /rpc calls, auth, uploads, signature, financial action or hosting configuration change.",
      "Custody/owner/source facts are validated via metadata and pinned pure source projection; no financial dialog is opened.",
      "One exact new-site non-executable Netlify index comment is accepted for comparison only. Browser receives original unchanged responses.",
    ],
  };
  let stage = "PREFLIGHT",
    browser;
  const get = async (url) => {
    const u = new URL(url);
    check(
      url === POLICY || browserRequestAllowed(url, "GET", null, files),
      "NODE_URL_ALLOWLIST",
    );
    const response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(HOSTING.timeoutMs),
      }),
      bytes = await boundedBytes(response);
    proof.requests.push({
      stage,
      method: "GET",
      path: url === POLICY ? "approved-policy" : u.pathname,
      status: response.status,
      sha256: sha(bytes),
      bytes: bytes.length,
    });
    return { response, bytes };
  };
  const step = async (name, work) => {
    stage = name;
    await work();
    proof.checks.push(name);
    console.log(JSON.stringify({ checkpoint: name, status: "passed" }));
  };
  try {
    await step("ANONYMOUS_BOOTSTRAP", async () => {
      const { response, bytes } = await get(HOSTING.origin + "/api/bootstrap");
      check(response.status === 200, "BOOTSTRAP_STATUS");
      apiHeaders(response.headers);
      proof.bootstrap = assertBootstrap(json(bytes), manifest);
    });
    await step("APPROVED_POLICY_BYTES", async () => {
      const { response, bytes } = await get(POLICY);
      check(
        response.status === 200 &&
          bytes.length === 9906 &&
          sha(bytes) === POLICY_SHA &&
          bytes.equals(Buffer.from(manifest.factoryDeployment.policy.text)),
        "POLICY_BYTE_READBACK",
      );
    });
    await step("PUBLIC_CATALOG", async () => {
      const { response, bytes } = await get(
        HOSTING.origin + "/api/public-catalog",
      );
      check(response.status === 200, "CATALOG_STATUS");
      apiHeaders(response.headers);
      proof.catalog = assertCatalog(json(bytes), manifest);
    });
    await step("STATIC_SOURCE_BYTES", async () => {
      for (const [name, expected] of files) {
        const { response, bytes } = await get(
            HOSTING.origin + "/" + (name === "index.html" ? "" : name),
          ),
          comparison = compareAsset(name, bytes, expected);
        check(
          response.status === 200 && comparison.matches,
          "STATIC_BYTE_MISMATCH",
        );
        staticHeaders(response.headers);
        proof.assets.push({
          path: name,
          ...comparison,
          cacheControl: response.headers.get("cache-control"),
        });
      }
    });
    const playwright = await import("@playwright/test"),
      expect = playwright.expect.configure({ timeout: HOSTING.timeoutMs });
    browser = await playwright.chromium.launch({ headless: true });
    for (const [device, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      stage = "BROWSER_" + device.toUpperCase();
      const data = {
        device,
        requests: 0,
        blocked: 0,
        pageErrors: 0,
        responseErrors: 0,
        screenshots: [],
      };
      proof.devices.push(data);
      const context = await browser.newContext({
        viewport,
        serviceWorkers: "block",
        acceptDownloads: false,
        reducedMotion: "reduce",
      });
      await context.addInitScript(() => {
        window.__v10Readonly = {
          walletReads: 0,
          walletWrites: 0,
          ws: 0,
          sw: 0,
        };
        Object.defineProperty(window, "ethereum", {
          get() {
            window.__v10Readonly.walletReads++;
            return undefined;
          },
          set() {
            window.__v10Readonly.walletWrites++;
          },
        });
        window.WebSocket = class {
          constructor() {
            window.__v10Readonly.ws++;
            throw Error("Read-only checker");
          }
        };
        try {
          navigator.serviceWorker.register = () => {
            window.__v10Readonly.sw++;
            return Promise.reject(Error("Read-only checker"));
          };
        } catch {}
      });
      await context.routeWebSocket("**/*", (socket) => {
        data.blocked++;
        socket.close();
      });
      await context.route("**/*", async (route) => {
        const request = route.request();
        data.requests++;
        if (
          !browserRequestAllowed(
            request.url(),
            request.method(),
            request.postData(),
            files,
          )
        ) {
          data.blocked++;
          return route.abort();
        }
        try {
          const response = await route.fetch({
            maxRedirects: 0,
            timeout: HOSTING.timeoutMs,
          });
          check(response.status() === 200, "BROWSER_HTTP_STATUS");
          const u = new URL(request.url()),
            headers = new Headers(response.headers()),
            bytes = await response.body();
          if (u.pathname === "/api/bootstrap") {
            apiHeaders(headers);
            assertBootstrap(json(bytes), manifest);
          } else if (u.pathname === "/api/public-catalog") {
            apiHeaders(headers);
            assertCatalog(json(bytes), manifest);
          } else {
            const name =
                u.pathname === "/" ? "index.html" : u.pathname.slice(1),
              comparison = compareAsset(name, bytes, files.get(name));
            check(comparison.matches, "BROWSER_SOURCE_BYTES");
            staticHeaders(headers);
            proof.assets.push({ device, path: name, ...comparison });
          }
          await route.fulfill({ response });
        } catch {
          data.responseErrors++;
          await route.abort().catch(() => {});
        }
      });
      const page = await context.newPage();
      page.on("pageerror", () => data.pageErrors++);
      const capture = async (name) => {
        await page.evaluate(async () => {
          scrollTo(0, 0);
          await document.fonts.ready;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
        });
        check(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "NO_HORIZONTAL_OVERFLOW",
        );
        const filename = device + "-" + name + ".png";
        await page.screenshot({
          path: path.join(output, filename),
          fullPage: true,
        });
        data.screenshots.push({
          path: filename,
          sha256: sha(await fs.readFile(path.join(output, filename))),
        });
      };
      await page.goto(HOSTING.origin, {
        waitUntil: "domcontentloaded",
        timeout: HOSTING.timeoutMs,
      });
      await expect(page.locator("#content")).toBeVisible();
      await expect(page.locator("#loading")).toBeHidden();
      await expect(page.locator("[data-public-catalog-screen]")).toBeVisible();
      await expect(page.locator("[data-public-event-status]")).toHaveText(
        "No public events yet.",
      );
      await expect(
        page.locator(
          "[data-public-event-row],#event-switch,[data-luma-launch]",
        ),
      ).toHaveCount(0);
      await capture("home");
      await page.locator('a[href="#setup=kickback"]').click();
      await expect(page.locator("#luma-setup h1")).toHaveText(
        "Set up kickback.",
      );
      await expect(
        page.locator("#luma-setup [data-connect-wallet]"),
      ).toBeVisible();
      await expect(
        page.locator("#luma-setup [data-luma-attendance-standard]"),
      ).toBeVisible();
      await expect(
        page.locator(
          '[data-luma-form],[data-luma-action="review"],[data-luma-action="confirm"],[data-luma-setup-issue],[data-luma-dialog]',
        ),
      ).toHaveCount(0);
      await capture("setup");
      data.probes = await page.evaluate(() => window.__v10Readonly);
      check(
        data.probes.walletWrites === 0 &&
          data.probes.ws === 0 &&
          data.probes.sw === 0 &&
          data.blocked === 0 &&
          data.pageErrors === 0 &&
          data.responseErrors === 0,
        "BROWSER_READONLY_BOUNDARIES",
      );
      check((await context.cookies()).length === 0, "ANONYMOUS_NO_COOKIE");
      await context.close();
      proof.checks.push(stage);
      console.log(JSON.stringify({ checkpoint: stage, status: "passed" }));
    }
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.errors.push({
      stage,
      code: error instanceof Failure ? error.code : "READONLY_CHECK_FAILED",
    });
  } finally {
    await browser?.close().catch(() => {
      proof.status = "failed";
      proof.errors.push({ stage: "CLOSE", code: "READONLY_CHECK_FAILED" });
    });
    proof.completedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(output, "proof.json"),
      JSON.stringify(proof, null, 2) + "\n",
      { flag: "wx" },
    );
  }
  console.log(
    JSON.stringify({
      status: proof.status,
      checks: proof.checks.length,
      proofPath: path.join(output, "proof.json"),
      screenshots: proof.devices.reduce((n, d) => n + d.screenshots.length, 0),
      errors: proof.errors,
      financialActions: 0,
      walletActions: 0,
    }),
  );
  if (proof.status !== "passed") process.exitCode = 1;
  return proof;
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length) {
    console.log(
      JSON.stringify({
        status: "review-only",
        ...HOSTING,
        execute: "node test/v10-hosting-readonly.e2e.mjs --execute",
        networkRequests: 0,
        browserLaunches: 0,
        authActions: 0,
        financialActions: 0,
      }),
    );
    return;
  }
  if (argv.length === 1 && argv[0] === "--self-test") {
    console.log(JSON.stringify(selfTest()));
    return;
  }
  if (argv.length === 1 && argv[0] === "--source-checks") {
    const r = await sourceChecks();
    console.log(
      JSON.stringify({
        status: "passed",
        source: HOSTING.source,
        registrySha256: r.registrySha256,
        publicAssetCount: r.files.size,
        networkRequests: 0,
        browserLaunches: 0,
      }),
    );
    return;
  }
  check(
    argv.length === 1 && argv[0] === "--execute",
    "EXPLICIT_ROOT_EXECUTION_REQUIRED",
  );
  await run();
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error("READONLY_PREFLIGHT_FAILED");
    process.exitCode = 1;
  });
