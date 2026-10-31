// ROOT-reviewed execution only. Default is inert: no browser, relay or fixture.
// Actual SDK/SignClient relay, synthetic in-memory wallet, protected LOCAL chain1.
// No real apps, mainnet transactions, pairing payload logs, QR captures or traces.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import https from "node:https";
import { chromium, expect, devices } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { ethers } from "ethers";
import { createFirstEventPostgres } from "../../src/first-event-postgres.mjs";
import { V10_FRONTEND_HEADERS } from "../../scripts/prepare-v10-frontend.mjs";
import { EVENT as CURRENT_EVENT, LEGACY_EVENT } from "../../public/first-event/event.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ORIGIN = "https://kleros-kickback.netlify.app";
const SETUP_HASH = "#setup=kickback&replacement=truth-pays-ist";
const ID = CURRENT_EVENT.id, CHILD = CURRENT_EVENT.contract;
const LEGACY_ID = LEGACY_EVENT.id, LEGACY_CHILD = LEGACY_EVENT.contract;
const PROJECT = "8b91f364532b7b33d6d0c3dd105e2485";
const HOSTS = new Set(["api.web3modal.org", "rpc.walletconnect.org", "verify.walletconnect.org", "relay.walletconnect.org"]);
const CSP = V10_FRONTEND_HEADERS.split("Content-Security-Policy: ")[1].trim();
const SDK_ROOT = process.argv.includes("--sdk-root") ? process.argv[process.argv.indexOf("--sdk-root") + 1] : "/tmp/kleros-walletconnect-build";
const PEER_PACKAGE = path.join(SDK_ROOT, "node_modules/@walletconnect/ethereum-provider/node_modules/@walletconnect/sign-client");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const mime = name => ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" }[path.extname(name)] ?? "text/plain");
const routeName = value => value.replace(/(\/api\/public-transactions\/)[0-9a-f]{64}(?=\/|$)/g, "$1[flow]");
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const sources = ["src/server.mjs", "src/workbench.mjs", "src/public-transactions.mjs", "src/direct-deposit-simulation.mjs", "src/production-errors.mjs", "src/v10-read-batch.mjs", "src/v10-upgrade-verification.mjs",
  "src/v10-production-wallets.mjs", "src/v10-factory-onboarding.mjs", "src/v10-receipt-context.mjs", "src/first-event-manage-scope.mjs", "src/first-event-display.mjs", "src/first-event-state.mjs", "src/first-event-postgres.mjs", "src/first-event-manage.mjs", "src/public-catalog.mjs",
  "public/app.js", "public/luma-setup.js", "public/event-timezone.js", "public/luma-factory.js", "public/setup-progress.js", "public/entry.js", "public/public-home.js", "public/home-wallet.js", "public/first-event-display.js", "public/first-event-manage.js",
  "public/first-event/index.html", "public/first-event/event.js", "public/first-event/page.js", "public/first-event/qr.svg", "public/first-event/wallet.js", "public/first-event/direct-deposit.js", "public/first-event/receipts.js", "public/public-transactions.js",
  "public/event-read.js", "public/transaction-context.js", "public/v10-wallet-account.js", "public/walletconnect.js", "public/wallet-connection.js",
  "scripts/prepare-v10-frontend.mjs", "public/vendor/walletconnect/2.26.0/walletconnect.bundle.js"];

class MemoryStorage {
  #values = new Map();
  async getKeys() { return [...this.#values.keys()]; }
  async getEntries() { return [...this.#values.entries()]; }
  async getItem(key) { return this.#values.get(key); }
  async setItem(key, value) { this.#values.set(key, value); }
  async removeItem(key) { this.#values.delete(key); }
  clear() { this.#values.clear(); }
}

async function run() {
  const output = path.join(ROOT, "artifacts/mobile-walletconnect-flow", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(output, { recursive: true });
  const started = performance.now(), marks = {};
  const proof = { kind: "actual-sdk-mobile-local-deposit", status: "running", source: {}, passes: [], http: [], external: [], peerMethods: [],
    browserRPC: {}, backendRPC: {}, walletOpens: [], errors: [], timings: {},
    limits: ["Actual official SDK/SignClient encrypted relay session with an in-memory synthetic wallet; all signing and transactions are confined to the armed protected local Anvil chain1 fixture.",
      "Pairing URI/topic/keys/signatures remain in memory and are never recorded; no screenshots, traces, HAR or relay frame capture.",
      "Chromium with an iPhone Safari user-agent and intercepted deep-link attempts cannot prove native Safari, physical app installation, OS launch acceptance or return behavior.",
      "Instrumented local timings include fixture/relay/browser harness overhead; they are not production latency measurements."] };
  const mark = name => { if (!Object.hasOwn(marks, name)) marks[name] = Math.round(performance.now() - started); };
  const pass = label => proof.passes.push(label);
  let fixture, db, browser, page, peer, peerStorage, pendingURI = null, synthetic = null, stage = "preflight", depositClicked = false,
    peerFailure = false, pairingStarted = false, armedDeposit = false, armedCreation = false;
  const originalFetch = globalThis.fetch, originalHttpsRequest = https.request, originalHttpsGet = https.get;
  try {
    const dependencies = (await fs.readdir(path.join(ROOT, "public/first-event/deps"))).filter(name => name.endsWith(".js")).map(name => "public/first-event/deps/" + name);
    const pinnedSources = [...new Set([...sources, ...dependencies])];
    for (const file of pinnedSources) proof.source[file] = sha(await fs.readFile(path.join(ROOT, file)));
    const accountGuard = "public/v10-wallet-account.js";
    assert.equal(proof.source[accountGuard], "88f223ee15166e14bfb3b4c35b383573bf9fee8edceb8c08f4c9fcf38c6cb916");
    assert.equal(proof.source["public/first-event/deps/v10-wallet-account.js"], proof.source[accountGuard]);
    const pkg = JSON.parse(await fs.readFile(path.join(PEER_PACKAGE, "package.json"), "utf8"));
    assert.equal(pkg.name, "@walletconnect/sign-client"); assert.equal(pkg.version, "2.26.0");
    proof.peerSDK = { name: pkg.name, version: pkg.version, packageSha256: sha(JSON.stringify(pkg)), storage: "memory-only" };
    // Reuse the exact protected financial fixture. Only its already used trusted
    // SQL/synthetic-event seam and direct-deposit draft capture are adapted.
    const original = await fs.readFile(path.join(ROOT, "test/fixtures/v10-metamask-app-fixture.mjs"), "utf8");
    let adapted = original.replaceAll("../../", pathToFileURL(ROOT).href);
    const replacements = [
      ['Object.keys(options).every((key) => key === "origin"),', 'Object.keys(options).every((key) => ["origin", "firstEventStore", "firstEventManageScope"].includes(key)),'],
      ['      {\n        workbenchFactory: async (options) => {', '      {\n        firstEventStore: options.firstEventStore,\n        workbenchFactory: async (options) => {'],
      ['            productionRuntime: async () => runtime,', '            productionRuntime: async () => runtime,\n            firstEventManageScope: fixtureManageScope,'],
      ['  const { origin = "https://v10-mm-browser.example.invalid" } = options;', '  const fixtureManageScope = options.firstEventManageScope;\n  const { origin = "https://v10-mm-browser.example.invalid" } = options;'],
      ['      if (data.kind === "organizer-job" && data.state === "ready") {', '      if (method === "POST" && /\\/direct-deposit$/.test(new URL(route, "https://fixture.invalid").pathname) && response.status === 200) review = data;\n      if (data.kind === "organizer-job" && data.state === "ready") {'],
    ];
    for (const [before, after] of replacements) { assert(adapted.includes(before)); adapted = adapted.replace(before, after); }
    const fixtureFile = path.join(output, "synthetic-protected-fixture.mjs"); await fs.writeFile(fixtureFile, adapted);
    proof.fixture = { originalSha256: sha(original), adaptedSha256: sha(adapted), accountPolicyOverride: false };
    const { createV10MetaMaskAppFixture } = await import(pathToFileURL(fixtureFile).href);
    db = new PGlite();
    const store = createFirstEventPostgres({ pool: { query: (sql, values) => db.query(sql, values), connect() { throw Error("No index lease in setup test"); } } });
    const managed = new Map();
    fixture = await createV10MetaMaskAppFixture({ origin: ORIGIN, firstEventStore: { ...store, close: async () => {} },
      firstEventManageScope: record => managed.get(record?.definition?.id)?.toLowerCase() === record?.deployment?.contract?.toLowerCase() });
    const send = fixture.provider.send.bind(fixture.provider);
    fixture.provider.send = (method, params) => { proof.backendRPC[method] = (proof.backendRPC[method] ?? 0) + 1; return send(method, params); };
    browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--disable-popup-blocking"] });
    const { defaultBrowserType: _unused, ...device } = devices["iPhone 13"];
    const context = await browser.newContext({ ...device, serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] });
    page = await context.newPage(); page.setDefaultTimeout(60000);
    await page.exposeBinding("__syntheticSetupWallet", ({ frame }, request) => {
      assert.equal(frame, page.mainFrame()); assert.equal(new URL(page.url()).hash, SETUP_HASH);
      assert(!["personal_sign", "eth_sign", "eth_sendRawTransaction"].includes(request.method)); return fixture.wallet(request, page.url());
    });
    await page.exposeBinding("__wcStage", ({ frame }, name) => { assert.equal(frame, page.mainFrame()); assert(["sdkInit", "sdkReady", "uri", "accounts", "walletDispatch"].includes(name)); mark(name); });
    await page.exposeBinding("__wcURIInMemory", ({ frame }, uri) => {
      assert.equal(frame, page.mainFrame()); assert(!pendingURI && typeof uri === "string" && /^wc:[0-9a-f]{64}@2\?/.test(uri)); pendingURI = uri; mark("uri");
    });
    await page.exposeBinding("__wcOpenInMemory", async ({ frame }, detail) => {
      assert.equal(frame, page.mainFrame()); assert.equal(detail.expectedWallet, true);
      assert(["pairing", "request"].includes(detail.kind));
      proof.walletOpens.push(detail); mark(detail.kind === "pairing" ? "pairingOpen" : "requestOpen");
      if (detail.kind === "pairing") {
        assert.equal(detail.uriMatches, true); assert(!pairingStarted && pendingURI); pairingStarted = true;
        const uri = pendingURI; pendingURI = null; await peer.pair({ uri });
      } else { assert.equal(detail.topicMatches, true); assert.equal(detail.hasRequestId, true); }
    });
    await page.addInitScript(setupHash => {
      window.__wcProof = { uriReady: false, opens: [], methods: [], requests: [], rawChainResults: [] };
      if (location.hash === setupHash) {
        window.ethereum = { request: request => window.__syntheticSetupWallet(request), on() {}, removeListener() {}, isMetaMask: true };
        window.__creationDialogsOpened = 0;
        new MutationObserver(records => { for (const record of records) if (record.target instanceof HTMLDialogElement &&
          record.target.hasAttribute("data-luma-dialog") && record.target.open) window.__creationDialogsOpened++; })
          .observe(document, { attributes: true, attributeFilter: ["open"], subtree: true });
        return;
      }
      let pairingURI = null, connectedSDK = null;
      window.open = (value, target) => {
        const url = new URL(String(value)), kind = url.searchParams.has("uri") ? "pairing" : "request";
        const expectedWallet = url.protocol === "metamask:" || ["https://metamask.app.link", "https://link.metamask.io"].includes(url.origin);
        const detail = { kind, expectedWallet, uriMatches: kind === "pairing" && url.searchParams.get("uri") === pairingURI,
          topicMatches: kind === "request" && url.searchParams.get("sessionTopic") === connectedSDK?.session?.topic,
          hasRequestId: url.searchParams.has("requestId"), target: ["_self", "_top", "_blank", "popupWindow"].includes(target) ? target : "default",
          active: navigator.userActivation?.isActive === true,
          hasBeenActive: navigator.userActivation?.hasBeenActive === true };
        window.__wcProof.opens.push(detail); void window.__wcOpenInMemory(detail); return null;
      };
      document.addEventListener("load", event => {
        if (!(event.target instanceof HTMLScriptElement) || !event.target.hasAttribute("data-walletconnect-vendor")) return;
        const factory = window.KlerosWalletConnectVendor.EthereumProvider, init = factory.init.bind(factory);
        factory.init = async options => {
          void window.__wcStage("sdkInit"); const sdk = await init(options); connectedSDK = sdk; void window.__wcStage("sdkReady");
          sdk.on("display_uri", async uri => { pairingURI = uri; await window.__wcURIInMemory(uri); window.__wcProof.uriReady = true; });
          const request = sdk.request.bind(sdk);
          sdk.request = async args => {
            window.__wcProof.methods.push(args.method); const began = performance.now();
            if (args.method === "eth_sendTransaction") void window.__wcStage("walletDispatch");
            const result = await request(args);
            if (args.method === "eth_chainId") window.__wcProof.rawChainResults.push({ type: typeof result,
              validPositiveInteger: typeof result === "number" && Number.isSafeInteger(result) && result > 0,
              validHex: typeof result === "string" && /^0x[1-9a-f][0-9a-f]*$/i.test(result) });
            window.__wcProof.requests.push({ method: args.method, elapsedMs: Math.round(performance.now() - began) });
            if (args.method === "eth_requestAccounts") void window.__wcStage("accounts"); return result;
          };
          return sdk;
        };
      }, true);
    }, SETUP_HASH);
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      try {
        if (url.hostname === "rpc.walletconnect.org") {
          if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": ORIGIN,
            "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" } });
          assert.equal(method, "POST"); assert.equal(url.searchParams.get("chainId"), "eip155:1");
          const payload = request.postDataJSON(), list = Array.isArray(payload) ? payload : [payload];
          assert(list.length > 0 && list.length <= 20);
          const replies = [];
          for (const call of list) {
            assert(["eth_chainId", "eth_getBlockByNumber", "eth_getCode"].includes(call.method), "RPC fallback permits only local account-policy reads");
            proof.browserRPC[call.method] = (proof.browserRPC[call.method] ?? 0) + 1;
            replies.push({ id: call.id, jsonrpc: "2.0", result: await fixture.wallet({ method: call.method, params: call.params ?? [] }, page.url()) });
          }
          return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": ORIGIN }, body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]) });
        }
        if (url.origin !== ORIGIN) {
          assert(HOSTS.has(url.hostname) && method === "GET"); proof.external.push({ host: url.hostname, method }); return route.continue();
        }
        if (url.pathname === "/api/first-event/depositors") return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Synthetic saved receipts unavailable"}' });
        if (url.pathname.startsWith("/api/")) {
          if (url.pathname.endsWith("/direct-deposit")) mark("quoteStart");
          if (url.pathname.endsWith("/direct-deposit/validate")) mark("validateStart");
          const before = performance.now(), rpcBefore = { ...proof.backendRPC }, response = await fixture.forward(url.pathname + url.search, { method, headers: request.headers(), body: request.postDataBuffer() ?? undefined });
          proof.http.push({ method, path: routeName(url.pathname), status: response.status, elapsedMs: Math.round(performance.now() - before),
            rpc: Object.fromEntries(Object.entries(proof.backendRPC).map(([key, count]) => [key, count - (rpcBefore[key] ?? 0)]).filter(([, count]) => count > 0)) });
          if (url.pathname.endsWith("/direct-deposit")) mark("quoteEnd");
          if (url.pathname.endsWith("/direct-deposit/validate")) mark("validateEnd");
          const data = JSON.parse(response.body.toString());
          if (data.kind === "organizer-job" && data.state === "ready" && data.operation === "prepare") {
            const reviewed = fixture.reviewedDraft();
            assert.equal(reviewed.scopeKind, "factory-create"); assert.equal(reviewed.id, data.result.id);
            assert(!armedCreation && fixture.stats.walletRequests === 0); fixture.armCreation(reviewed.id); armedCreation = true;
          }
          if (url.pathname.endsWith("/direct-deposit") && response.status === 200) {
            assert(depositClicked); const draft = fixture.reviewedDraft(); fixture.armEventDraft(draft.id, "deposit"); armedDeposit = true; mark("depositDraft");
          }
          return route.fulfill({ status: response.status, contentType: "application/json", body: response.body,
            headers: Object.fromEntries(Object.entries(response.headers).filter(([key]) => ["set-cookie", "content-security-policy"].includes(key)).map(([key, value]) => [key, String(value)])) });
        }
        const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname).slice(1);
        const file = path.resolve(ROOT, "public", relative); assert(file.startsWith(path.join(ROOT, "public") + path.sep));
        let body = await fs.readFile(file);
        if (synthetic) {
          if (["first-event/event.js", "public-transactions.js", "event-read.js", "entry.js", "first-event/index.html"].includes(relative)) {
            // Preserve all current/legacy helpers and exports byte-for-byte
            // except the two explicitly mapped CURRENT synthetic identifiers.
            const originalText = body.toString();
            body = Buffer.from(originalText.replaceAll(ID, synthetic.id).replaceAll(CHILD, synthetic.contract));
            if (relative === "first-event/event.js") {
              assert(body.includes(LEGACY_ID)); assert(body.includes(LEGACY_CHILD));
              assert(!body.includes(ID)); assert(!body.includes(CHILD));
              proof.mapping = { sourceCurrentId: ID, sourceCurrentContract: CHILD, syntheticCurrentId: synthetic.id,
                syntheticCurrentContract: synthetic.contract, legacyId: LEGACY_ID, legacyContract: LEGACY_CHILD,
                preservedAllExports: true, replacedFieldsOnly: ["current event ID", "current child address"] };
            }
          }
        }
        return route.fulfill({ status: 200, contentType: mime(file), headers: { "content-security-policy": CSP }, body });
      } catch { peerFailure = true; proof.errors.push({ stage: "route", method, host: url.hostname, path: url.origin === ORIGIN ? routeName(url.pathname) : undefined }); await route.abort(); }
    });
    page.on("pageerror", error => { peerFailure = true; proof.errors.push({ stage: "browser", name: error.name }); });
    stage = "local-create"; mark("createStart");
    await page.goto(ORIGIN + "/" + SETUP_HASH);
    await page.locator("#luma-setup [data-connect-wallet]").click(); await expect(page.locator("[data-luma-form]")).toBeVisible();
    for (const [selector, value] of [["#luma-title", "Truth Pays: Queryable Data, Prediction Markets & Onchain Justice"], ["#luma-url", "https://luma.com/qewnqhas"],
      ["#luma-timezone", "Asia/Kolkata"], ["#luma-start", "2026-11-04T18:00"], ["#luma-end", "2026-11-04T22:00"],
      ["#luma-deposit", "0.01"], ["#luma-capacity", "150"]]) await expect(page.locator(selector)).toHaveValue(value);
    await expect(page.locator("[data-luma-replacement-preset]")).toContainText("new contract and deposit link");
    await expect(page.locator("[data-luma-replacement-preset]")).toContainText("original event and its deposits stay unchanged");
    assert.equal(new URL(await page.locator("[data-luma-replacement-preset] a").getAttribute("href"), ORIGIN).href, ORIGIN + "/#event=" + LEGACY_ID + "&view=participant&deposit=manage");
    assert.equal(fixture.stats.walletRequests, 0); assert.equal(armedCreation, false);
    pass("Exact replacement route prefills reviewed IST hours, original recovery notice and fixed150 without preparing or sending");
    await page.locator('[data-luma-action="review"]').click(); await expect(page.locator("[data-luma-created]")).toBeVisible({ timeout: 90000 });
    const create = fixture.reviewedDraft(); assert.equal(armedCreation, true);
    assert.equal(await page.evaluate(() => window.__creationDialogsOpened), 0);
    const created = fixture.savedState().events.find(row => row.eventId === create.eventId);
    assert.equal(created.definition.startsAt, "2026-11-04T12:30:00.000Z"); assert.equal(created.definition.endsAt, "2026-11-04T16:30:00.000Z");
    assert.equal(created.definition.timezone, "Asia/Kolkata");
    synthetic = { id: create.eventId, title: created.definition.title, contract: created.deployment.contract, chainId: 1,
      depositWei: created.deployment.depositWei, abiVersion: created.deployment.abiVersion, mode: "hosted-production", lumaUrl: created.definition.lumaUrl };
    managed.set(synthetic.id, synthetic.contract); mark("createDone"); assert.equal(fixture.stats.walletRequests, 1); pass("One actual protected local CREATE prepares the synthetic event");
    // Network guard is installed only for the peer; fixture HTTP remains loopback.
    const allowedURL = input => { const u = new URL(typeof input === "string" || input instanceof URL ? input : input.url); return (u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname)) || (u.protocol === "https:" && HOSTS.has(u.hostname) && u.hostname !== "rpc.walletconnect.org"); };
    globalThis.fetch = (input, options) => { assert(allowedURL(input), "Synthetic peer fetch outside approved hosts"); return originalFetch(input, options); };
    https.request = (...args) => { const first = args[0], host = typeof first === "string" || first instanceof URL ? new URL(first).hostname : first.hostname ?? first.host;
      assert(HOSTS.has(host) && host !== "rpc.walletconnect.org", "Synthetic peer TLS outside approved hosts or RPC fallback"); return originalHttpsRequest(...args); };
    https.get = (...args) => { const request = https.request(...args); request.end(); return request; };
    stage = "peer-init";
    const { default: SignClient } = await import(pathToFileURL(path.join(PEER_PACKAGE, "dist/index.js")).href);
    peerStorage = new MemoryStorage();
    peer = await SignClient.init({ projectId: PROJECT, relayUrl: "wss://relay.walletconnect.org", storage: peerStorage,
      customStoragePrefix: "synthetic-mobile-" + randomUUID(), telemetryEnabled: false, logger: "silent",
      metadata: { name: "Synthetic local test wallet", description: "Isolated local chain fixture only", url: "https://synthetic-wallet.example.invalid", icons: [] } });
    peer.on("session_proposal", proposal => { void (async () => {
      mark("proposal"); const { params } = proposal; assert.equal(params.proposer.metadata.url, ORIGIN);
      assert.equal(params.proposer.metadata.redirect.universal, ORIGIN + "/first-event/#event=" + synthetic.id);
      proof.returnRouteMetadataMatches = true;
      assert(Object.keys(params.requiredNamespaces).length === 0); assert.deepEqual(Object.keys(params.optionalNamespaces), ["eip155"]);
      const requested = params.optionalNamespaces.eip155; assert(requested.chains.every(chain => chain === "eip155:1"));
      const methods = ["eth_sendTransaction", "personal_sign", "wallet_switchEthereumChain", "wallet_addEthereumChain"];
      assert(requested.methods.every(method => methods.includes(method)));
      const result = await peer.approve({ id: proposal.id, namespaces: { eip155: { chains: ["eip155:1"], accounts: ["eip155:1:" + fixture.organizerAddress], methods, events: ["accountsChanged", "chainChanged"] } } });
      await result.acknowledged(); mark("approved");
    })().catch(() => { peerFailure = true; proof.errors.push({ stage: "peer-proposal" }); }); });
    peer.on("session_request", event => { void (async () => {
      const { request, chainId } = event.params; proof.peerMethods.push(request.method); assert.equal(chainId, "eip155:1");
      assert.equal(request.method, "eth_sendTransaction"); assert(depositClicked && armedDeposit && fixture.stats.walletRequests === 1);
      const expected = { to: synthetic.contract, from: fixture.organizerAddress, value: "0x2386f26fc10000", data: "0xd0e30db0", chainId: "0x1" };
      assert.deepEqual(request.params, [expected]); mark("peerRequest");
      const hash = await fixture.wallet(request, page.url()); mark("localHash"); proof.localTransactionHash = hash;
      await peer.respond({ topic: event.topic, response: { id: event.id, jsonrpc: "2.0", result: hash } });
    })().catch(() => { peerFailure = true; proof.errors.push({ stage: "peer-request" }); }); });
    stage = "mobile-connect";
    await page.goto(ORIGIN + "/first-event/#event=" + synthetic.id);
    const mapped = await page.evaluate(async () => {
      const { EVENT, LEGACY_EVENT, PROMOTED_EVENT, FIRST_EVENTS, firstEventById, firstEventDepositorsPath, firstEventRecoveryPath, isPreviousFirstEvent } = await import("/first-event/event.js");
      return { currentId: EVENT.id, currentContract: EVENT.contract, promotedId: PROMOTED_EVENT.id, legacyId: LEGACY_EVENT.id,
        legacyContract: LEGACY_EVENT.contract, ids: FIRST_EVENTS.map(event => event.id), oldRecognized: isPreviousFirstEvent(LEGACY_EVENT),
        legacyLookup: firstEventById(LEGACY_EVENT.id)?.contract, oldSQL: firstEventDepositorsPath(LEGACY_EVENT), oldRecovery: firstEventRecoveryPath(LEGACY_EVENT) };
    });
    assert.equal(mapped.currentId, synthetic.id); assert.equal(mapped.promotedId, synthetic.id); assert(same(mapped.currentContract, synthetic.contract));
    assert.equal(mapped.legacyId, LEGACY_ID); assert.equal(mapped.legacyContract, LEGACY_CHILD); assert.equal(mapped.legacyLookup, LEGACY_CHILD);
    assert.deepEqual(mapped.ids, [synthetic.id, LEGACY_ID]); assert.equal(mapped.oldRecognized, true);
    assert.equal(mapped.oldSQL, "/api/first-event/depositors?eventId=" + LEGACY_ID);
    assert.equal(mapped.oldRecovery, "/#event=" + LEGACY_ID + "&view=participant&deposit=manage");
    pass("Synthetic mapping preserves every current/legacy catalog export and the exact original receipt/recovery scope");
    await expect(page.locator("[data-connect-wallet]")).toBeVisible(); assert.equal(await page.locator("script[data-walletconnect-vendor]").count(), 0);
    const apiBeforeConnect = proof.http.length; mark("connectClick");
    await page.locator("[data-connect-wallet]").click();
    await page.waitForFunction(() => window.__wcProof.uriReady);
    assert.equal(await page.locator("[data-wallet-connection]").count(), 0);
    proof.primaryReownOnFirstConnect = true;
    const walletChoice = page.locator("w3m-all-wallets-list-item").filter({ hasText: "MetaMask" }).first();
    assert.equal(await walletChoice.evaluate(element => element.wallet?.name === "MetaMask"), true);
    await walletChoice.locator("button").click();
    await expect(page.locator("[data-deposit]")).toBeVisible({ timeout: 90000 }); mark("connectedUI");
    assert.equal(peerFailure, false); assert.equal(proof.http.length, apiBeforeConnect); assert.equal(fixture.stats.walletRequests, 1);
    pass("First Connect opens primary Reown directly; actual mobile wallet selection makes one intercepted pairing handoff and encrypted accounts-only connection with zero app API/auth/sign/send");
    const before = await fixture.financialSnapshot(synthetic.id); stage = "mobile-deposit"; depositClicked = true; mark("depositClick");
    await page.locator("[data-deposit]").click();
    await expect(page.locator("[data-tx-status]")).toContainText("Deposit confirmed", { timeout: 90000 }); mark("confirmedUI");
    assert.equal(peerFailure, false); assert.equal(fixture.stats.walletRequests, 2); assert.equal(fixture.stats.authSignatures, 0);
    assert.deepEqual(proof.peerMethods, ["eth_sendTransaction"]); assert.equal(proof.walletOpens.filter(row => row.kind === "pairing").length, 1);
    assert.equal(proof.walletOpens.filter(row => row.kind === "request").length, 1);
    assert.equal(page.url(), ORIGIN + "/first-event/#event=" + synthetic.id);
    const sent = fixture.stats.sent.find(row => row.action === "deposit"), receipt = await fixture.provider.getTransactionReceipt(sent.hash), after = await fixture.financialSnapshot(synthetic.id);
    assert.equal(sent.hash, proof.localTransactionHash); assert.equal(receipt.status, 1); assert.equal(BigInt(after.pendingWei) - BigInt(before.pendingWei), 10000000000000000n);
    await page.locator("[data-copy-tx]").click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sent.hash); mark("copiedUI");
    pass("Exactly one encrypted exact-recipient/value deposit reaches the protected local sender, confirms its canonical receipt and provides a copyable transaction ID");
    proof.balance = { pendingDeltaWei: (BigInt(after.pendingWei) - BigInt(before.pendingWei)).toString(), stakerCount: after.stakerCount };
    proof.browser = await page.evaluate(() => window.__wcProof);
    assert(proof.browser.methods.every(method => !/sign|sendRaw/i.test(method)));
    for (const file of pinnedSources) assert.equal(sha(await fs.readFile(path.join(ROOT, file))), proof.source[file]);
    proof.timings = { marks, connectMs: marks.connectedUI - marks.connectClick, sdkReadyMs: marks.sdkReady - marks.sdkInit,
      pairingApprovalMs: marks.accounts - marks.pairingOpen, quoteMs: marks.quoteEnd - marks.quoteStart, validateMs: marks.validateEnd - marks.validateStart,
      beforeQuoteMs: marks.quoteStart - marks.depositClick, preSendMs: marks.walletDispatch - marks.depositClick, encryptedRequestMs: marks.peerRequest - marks.walletDispatch,
      walletLocalHashMs: marks.localHash - marks.peerRequest, receiptUIMs: marks.confirmedUI - marks.localHash };
    proof.status = "pass";
  } catch (error) {
    proof.status = "fail"; proof.failure = { stage, name: error.name, code: typeof error.code === "number" ? error.code : null }; process.exitCode = 1;
    // Never save third-party error strings/stacks: they can contain pairing keys.
  } finally {
    proof.localActions = { walletRequestCount: fixture?.stats.walletRequests ?? 0,
      createCount: fixture?.stats.sent.filter(row => row.action === "createEvent").length ?? 0,
      depositCount: fixture?.stats.sent.filter(row => row.action === "deposit").length ?? 0,
      peerDepositRequests: proof.peerMethods.filter(method => method === "eth_sendTransaction").length,
      sent: fixture?.stats.sent.map(({ action, hash }) => ({ action, hash })) ?? [] };
    proof.timings = { ...proof.timings, marks };
    if (page && !page.isClosed()) proof.browser = await page.evaluate(() => window.__wcProof).catch(() => null);
    if (peer) {
      try { for (const session of peer.session.getAll()) await peer.disconnect({ topic: session.topic, reason: { code: 6000, message: "Synthetic test complete" } }); } catch { proof.errors.push({ stage: "peer-disconnect" }); }
      try { await peer.core.relayer.transportClose(); peer.core.heartbeat.stop(); } catch { proof.errors.push({ stage: "peer-close" }); }
    }
    peerStorage?.clear(); pendingURI = null;
    await browser?.close(); await fixture?.close(); await db?.close();
    globalThis.fetch = originalFetch; https.request = originalHttpsRequest; https.get = originalHttpsGet;
    await fs.writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
    console.log(JSON.stringify({ status: proof.status, proof: path.join(output, "proof.json"), checks: proof.passes.length }));
  }
}

if (process.argv.includes("--execute")) await run();
else console.log(JSON.stringify({ status: "prepared-not-executed", requires: "ROOT review before --execute", peerPackage: "@walletconnect/sign-client@2.26.0 (existing isolated cache)",
  externalHosts: [...HOSTS], localFinancialActions: "one protected CREATE setup plus one exact deposit", physicalOSLaunchProven: false }));
