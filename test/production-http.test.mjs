import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";
import { assertProductionEOAWallet } from "../src/production-wallets.mjs";
import { EVENT_V9_VERSION, eventV8Profile } from "../src/contracts-v8.mjs";
import { MAINNET_KLEROS } from "../scripts/mainnet/verify-kleros.mjs";

// ROUTING BOUNDARY TESTS ONLY. The trusted, programmatically injected workbench
// has no financial engine or server signer. RPC/code responses are synthetic;
// in-memory wallet keys sign only locally issued authentication messages. No
// manifest/key/state files, real chains, economic outcomes or broadcasts exist.
const publicOrigin = "https://production-boundary.example.invalid";
const backendOrigin = "https://backend-boundary.example.invalid";
const proxySecret = "synthetic_boundary_proxy_" + "0123456789abcdef".repeat(4);
const eventId = "synthetic-production-boundary";
const contract = "0x" + "12".repeat(20);
const submittedHash = "0x" + "34".repeat(32);
const sentinel = "PRIVATE_PROVIDER_SIGNATURE_CALLDATA_MUST_NOT_APPEAR";
const errorPayload =
  sentinel + " https://user:password@rpc.example.invalid/private";
const clone = (value) => structuredClone(value);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const caseWallet = "0x" + "56".repeat(20);
const caseRoutes = [
  ["artifact", "caseArtifact"],
  ["availability", "verifyCaseArtifact"],
  ["publish", "publishCaseArtifact"],
];
const caseApproval = { sha256: "ab".repeat(32), scopeHash: "cd".repeat(32) };
const privateCaseBody = "SYNTHETIC_PRIVATE_CASE_ARTIFACT_MUST_NOT_LEAK";

function boundaryWorkbench(chainOverrides = {}) {
  const calls = [];
  const codeByWallet = new Map();
  const headers = new Map();
  let head = 100;
  const track = (method, args = []) =>
    calls.push({ method, args: clone(args) });
  const codeProvider = {
    async send(method, params) {
      track("guardRPC", [method, params]);
      if (method === "eth_getBlockByNumber") {
        if (params[0] === "latest") {
          const number = ethers.toQuantity(++head);
          headers.set(number, {
            number,
            hash: ethers.id("synthetic-production-boundary-" + number),
          });
          return clone(headers.get(number));
        }
        return clone(headers.get(params[0]));
      }
      assert.equal(method, "eth_getCode");
      return codeByWallet.get(params[0].toLowerCase()) ?? "0x";
    },
  };
  const deployment = {
    eventId,
    chainId: 1,
    contract,
    contractVersion: EVENT_V9_VERSION,
    abiVersion: EVENT_V9_VERSION,
    deploymentBlock: 10,
    policyURI: "ipfs://synthetic-policy-only",
    templateHash: ethers.id("synthetic-template-only"),
  };
  const definition = {
    id: eventId,
    title: "Synthetic production boundary",
    visibility: "public",
    editorialStatus: "published",
    organizers: [],
    staff: [],
  };
  const event = { ...definition, ...deployment };
  const record = {
    deployment,
    definition,
    participants: new Map(),
    revision: 0,
  };
  const provider = {
    async send(method, params) {
      track("forwardedRPC", [method, params]);
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_getStorageAt") return "0x" + "00".repeat(32);
      throw Object.assign(new Error(errorPayload), {
        shortMessage: errorPayload,
      });
    },
  };
  const forbidden =
    (method) =>
    async (...args) => {
      track(method, args);
      throw new Error("Forbidden injected workbench function: " + method);
    };
  const w = {
    calls,
    codeByWallet,
    bootstrapFailure: null,
    stateFailure: null,
    privateWallet: null,
    caseContexts: [],
    caseHandler: null,
    factoryJobHandler: null,
    chain: {
      chainId: 1,
      production: true,
      signers: [],
      provider,
      factoryDeployment: { factory: "0x" + "ab".repeat(20) },
      ...chainOverrides,
    },
    provider,
    events: new Map([[eventId, record]]),
    publicCatalog() {
      track("publicCatalog");
      return { schemaVersion: 1, kind: "public-catalog", mode: "hosted-production",
        instanceId: "synthetic-public-instance", environment: { production: true,
          network: "ethereum-mainnet", chainId: 1 }, catalog: { metadataOnly: true,
          currentFinancialState: "not-loaded", source: "recorded-adoption" }, events: [] };
    },
    async createFactoryDraft(session, input) {
      track("createFactoryDraft", [session, input]);
      return w.factoryJobHandler("prepare", { session, input });
    },
    async validateFactoryDraft(session, draftId) {
      track("validateFactoryDraft", [session, draftId]);
      return w.factoryJobHandler("validate", { session, draftId });
    },
    async reconcileFactorySubmission(session, draftId, hash) {
      track("reconcileFactorySubmission", [session, draftId, hash]);
      return w.factoryJobHandler("reconcile", { session, draftId, hash });
    },
    async assertWallet(wallet) {
      track("assertWallet", [wallet]);
      return assertProductionEOAWallet(codeProvider, wallet);
    },
    async bootstrap(session, selection) {
      track("bootstrap", [session, selection]);
      if (w.bootstrapFailure) throw w.bootstrapFailure;
      return {
        contractVersion: EVENT_V9_VERSION,
        contractProfile: {
          ...eventV8Profile(EVENT_V9_VERSION),
          verified: true,
        },
        environment: {
          production: true,
          network: "ethereum-mainnet",
          chainId: 1,
        },
        arbitration: {
          mode: "kleros-v1",
          resolver: MAINNET_KLEROS.resolver,
          arbitrator: MAINNET_KLEROS.arbitrator,
          verified: true,
          notice: "Real Kleros arbitration on Ethereum mainnet",
        },
        walletSupport: {
          type: "eoa-only",
          eoa: true,
          erc1271: false,
          eip7702: false,
        },
        chain: {
          chainId: 1,
          name: "Ethereum",
          rpcUrl: "https://public-rpc.example.invalid",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
        identities: [],
        session: session
          ? { wallet: session.wallet, label: session.label, mode: session.mode }
          : null,
        events: [clone(event)],
        ...(selection
          ? {
              selectedEvent: {
                eventId: selection.selectedEventId,
                wallet: session?.wallet ?? null,
                detail: {
                  event: clone(event),
                  state: {},
                  participants: [],
                  transactions: [],
                  permissions: {
                    authenticated: !!session,
                    owner: false,
                    staff: false,
                  },
                },
                error: null,
              },
            }
          : {}),
      };
    },
    async state(id) {
      track("state", [id]);
      assert.equal(id, eventId);
      if (w.stateFailure) throw w.stateFailure;
      return {};
    },
    record(id, session) {
      track("record", [id, session]);
      assert.equal(id, eventId);
      if (
        w.privateWallet &&
        session?.wallet?.toLowerCase() !== w.privateWallet.toLowerCase()
      )
        throw Object.assign(new Error(errorPayload), {
          code: "FORBIDDEN",
          status: 403,
        });
      return record;
    },
    async reconcileSubmission(id, session, draftId, hash) {
      w.record(id, session);
      track("reconcileSubmission", [id, session, draftId, hash]);
      assert.equal(id, eventId);
      assert(session?.wallet, "Routing must retain the signed session");
      assert.equal(draftId, "known-review");
      assert.equal(hash, submittedHash);
      return { hash, status: "pending", eventId: id, wallet: session.wallet };
    },
    async submissionStatus(id, session, hash) {
      w.record(id, session);
      track("submissionStatus", [id, session, hash]);
      assert(session?.wallet);
      assert.equal(hash, submittedHash);
      return { hash, status: "pending", eventId: id, wallet: session.wallet };
    },
    async recordSubmitted(id, session, draftId, hash) {
      w.record(id, session);
      track("recordSubmitted", [id, session, draftId, hash]);
      assert.equal(id, eventId);
      assert(session?.wallet);
      assert.equal(draftId, "known-review");
      assert.equal(hash, submittedHash);
      return { hash, status: "pending", eventId: id, wallet: session.wallet };
    },
    caseArtifact(id, session, wallet, assertSession) {
      return caseAction(
        "caseArtifact",
        id,
        session,
        wallet,
        undefined,
        assertSession,
      );
    },
    verifyCaseArtifact(id, session, wallet, assertSession) {
      return caseAction(
        "verifyCaseArtifact",
        id,
        session,
        wallet,
        undefined,
        assertSession,
      );
    },
    publishCaseArtifact(id, session, wallet, approval, assertSession) {
      return caseAction(
        "publishCaseArtifact",
        id,
        session,
        wallet,
        approval,
        assertSession,
      );
    },
    async close() {
      track("close");
    },
  };
  async function caseAction(
    method,
    id,
    session,
    wallet,
    approval,
    assertSession,
  ) {
    // Capture serializable routing arguments separately. The live callback must
    // remain callable; structuredClone intentionally cannot clone functions.
    track(
      method,
      approval === undefined
        ? [id, session, wallet]
        : [id, session, wallet, approval],
    );
    assert.equal(id, eventId);
    assert.equal(wallet, caseWallet);
    assert(session?.wallet);
    assert.equal(typeof assertSession, "function");
    const context = {
      method,
      eventId: id,
      session,
      wallet,
      approval,
      assertSession,
    };
    w.caseContexts.push(context);
    assertSession();
    track("caseSessionChecked", [method, "before"]);
    if (w.caseHandler) return w.caseHandler(context);
    await Promise.resolve();
    assertSession();
    track("caseSessionChecked", [method, "after"]);
    return {
      artifact: { content: privateCaseBody },
      publication: { status: "exported" },
    };
  }
  for (const method of [
    "session",
    "createEvent",
    "advance",
    "mockRuling",
    "mockAppeal",
    "executeDraft",
    "createDraft",
    "validateDraft",
    "confirmDraft",
    "publish",
    "owner",
  ])
    w[method] = forbidden(method);
  return w;
}

async function fixture(t) {
  const runtimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "kleros-production-http-"),
  );
  const w = boundaryWorkbench();
  const options = {
    port: 0,
    rpcPort: 0,
    contractVersion: EVENT_V9_VERSION,
    production: {
      manifest: { syntheticBoundaryFixture: true },
      stateFile: path.join(runtimeRoot, "unused-state.json"),
    },
    deployment: {
      mode: "hosted-production",
      publicOrigin,
      backendOrigin,
      proxySecret,
      runtimeRoot,
    },
  };
  let app;
  const factories = [];
  t.after(async () => {
    await app?.close();
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  });
  app = await startServer(options, {
    workbenchFactory: async (input) => {
      factories.push(input);
      return w;
    },
  });
  async function request(
    route,
    { method = "GET", payload, cookie, headers: overrides = {}, bodyGate } = {},
  ) {
    const url = new URL(route, app.url);
    assert.equal(
      url.hostname,
      "127.0.0.1",
      "Only the ephemeral loopback listener may be contacted",
    );
    assert.equal(url.protocol, "http:");
    const headers = {
      host: new URL(backendOrigin).host,
      "x-kleros-proxy-key": proxySecret,
      ...(method !== "GET"
        ? { origin: publicOrigin, "content-type": "application/json" }
        : {}),
      ...(cookie ? { cookie } : {}),
      ...overrides,
    };
    return new Promise((resolve, reject) => {
      const req = http.request(
        url,
        { method, headers, agent: false },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let data;
            try {
              data = JSON.parse(raw);
            } catch {}
            resolve({
              status: res.statusCode,
              headers: res.headers,
              raw,
              data,
            });
          });
        },
      );
      req.on("error", reject);
      const serialized =
        payload === undefined ? undefined : JSON.stringify(payload);
      if (bodyGate) {
        assert(serialized?.length > 1);
        req.write(serialized.slice(0, 1));
        Promise.resolve(bodyGate).then(
          () => req.end(serialized.slice(1)),
          (error) => req.destroy(error),
        );
      } else req.end(serialized);
    });
  }
  const post = (route, payload = {}, extra = {}) =>
    request(route, { ...extra, method: "POST", payload });
  async function challenge(wallet) {
    const response = await post("/api/auth/challenge", {
      wallet: wallet.address,
    });
    assert.equal(response.status, 200, response.raw);
    return response.data;
  }
  async function login(wallet = ethers.Wallet.createRandom()) {
    const issued = await challenge(wallet);
    const signature = await wallet.signMessage(issued.message);
    const verified = await post("/api/auth/verify", {
      nonce: issued.nonce,
      signature,
    });
    assert.equal(verified.status, 200, verified.raw);
    const setCookie = verified.headers["set-cookie"]?.[0];
    assert(setCookie);
    return { wallet, cookie: setCookie.split(";")[0], issued, verified };
  }
  const count = (method) =>
    w.calls.filter((call) => call.method === method).length;
  return { app, w, options, factories, request, post, challenge, login, count };
}

test("production selected-only loading is a strict opt-in and preserves the default bootstrap options", async (t) => {
  const f = await fixture(t);
  const selected = "/api/bootstrap?selectedEventId=" + eventId;
  assert.equal((await f.request(selected)).status, 200);
  assert.deepEqual(f.w.calls.filter(call => call.method === "bootstrap").at(-1).args[1], { selectedEventId: eventId });
  assert.equal((await f.request(selected + "&selectedOnly=1")).status, 200);
  assert.deepEqual(f.w.calls.filter(call => call.method === "bootstrap").at(-1).args[1], { selectedEventId: eventId, selectedOnly: true });
  for (const route of [
    "/api/bootstrap?selectedOnly=1",
    selected + "&selectedOnly=0",
    selected + "&selectedOnly=1&selectedOnly=1",
  ]) {
    const before = f.count("bootstrap");
    assert.equal((await f.request(route)).status, 400);
    assert.equal(f.count("bootstrap"), before);
  }
});

test("production HTTP bootstrap preserves the explicit mainnet profile and keyless capability boundary", async (t) => {
  const f = await fixture(t);
  const response = await f.request("/api/bootstrap?selectedEventId=" + eventId);
  assert.equal(response.status, 200);
  const b = response.data;
  assert.equal(b.mode, "hosted-production");
  assert.deepEqual(b.environment, {
    production: true,
    network: "ethereum-mainnet",
    chainId: 1,
  });
  assert.equal(b.contractVersion, EVENT_V9_VERSION);
  assert.equal(b.contractProfile.version, 9);
  assert.equal(b.contractProfile.financialModel, "v8");
  assert.equal(b.contractProfile.upgradeable, true);
  assert.equal(b.contractProfile.challengeWindowSeconds, 86400);
  assert.equal(b.contractProfile.matchWindowSeconds, 86400);
  assert.equal(b.chain.chainId, 1);
  assert.deepEqual(b.chain.nativeCurrency, {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  });
  assert.equal(b.arbitration.mode, "kleros-v1");
  assert.equal(b.arbitration.resolver, MAINNET_KLEROS.resolver);
  assert.equal(b.arbitration.arbitrator, MAINNET_KLEROS.arbitrator);
  assert.equal(b.arbitration.verified, true);
  assert.deepEqual(b.identities, []);
  for (const capability of [
    "production",
    "browserWallet",
    "walletTransactions",
    "transactionsReady",
    "contractInbox",
    "batchActions",
    "selectedEventBootstrap",
  ])
    assert.equal(b.capabilities[capability], true, capability);
  for (const capability of [
    "sharedDemo",
    "serverSigning",
    "createEvents",
    "timeControls",
    "contractWallets",
    "erc1271",
    "eip7702",
    "reset",
    "timeTravel",
    "mockRulings",
  ])
    assert.equal(b.capabilities[capability], false, capability);
  assert.deepEqual(b.capabilities.supportedAccountTypes, ["eoa"]);
  assert.equal(b.selectedEvent.instanceId, b.instanceId);
  assert.equal(b.selectedEvent.wallet, null);
  assert.equal(f.factories.length, 1);
  assert.equal(f.factories[0].testnet, null);
  assert.deepEqual(f.factories[0].production, f.options.production);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(f.w.chain.signers, []);
});

test("public catalog uses the trusted gateway without bootstrap, RPC, session or financial authority", async (t) => {
  const f = await fixture(t);
  f.w.calls.length = 0;
  const anonymous = await f.request("/api/public-catalog");
  const cookie = await f.request("/api/public-catalog", { cookie: "kleros_session=unknown-revoked-session" });
  assert.equal(anonymous.status, 200);
  assert.deepEqual(cookie.data, anonymous.data);
  assert.equal(anonymous.headers["cache-control"], "no-store");
  assert.equal(anonymous.headers["x-content-type-options"], "nosniff");
  assert.equal(anonymous.headers["set-cookie"], undefined);
  assert.deepEqual(f.w.calls.map((call) => call.method), ["publicCatalog", "publicCatalog"]);
  for (const key of ["session", "recoveryEvents", "capabilities", "factory", "selectedEvent", "contractProfile"])
    assert.equal(Object.hasOwn(anonymous.data, key), false);
  assert.equal((await f.request("/api/public-catalog", { headers: { "x-kleros-proxy-key": "incorrect" } })).status, 403);
  assert.equal((await f.request("/api/public-catalog?selectedEventId=private")).status, 400);
  assert.equal((await f.post("/api/public-catalog")).status, 404);
  assert.deepEqual(f.w.calls.map((call) => call.method), ["publicCatalog", "publicCatalog"]);
});

const organizerTerms = { title: "Synthetic async event", lumaUrl: "https://luma.com/synthetic-async",
  startsAt: "2030-01-01T12:00:00Z", endsAt: "2030-01-01T14:00:00Z", timezone: "UTC", depositEth: "0.001" };

test("organizer jobs acknowledge before a slow review, deduplicate and poll without repeating verification", async (t) => {
  const f = await fixture(t), { cookie } = await f.login(), gate = deferred();
  f.w.factoryJobHandler = async () => gate.promise;
  const input = { requestId: "synthetic-review-job", operation: "prepare", input: organizerTerms };
  const started = await f.post("/api/organizer/events/jobs", input, { cookie });
  assert.equal(started.status, 202);
  assert.equal(started.data.state, "pending");
  assert.equal(f.count("createFactoryDraft"), 1);
  assert.equal((await f.post("/api/organizer/events/jobs", input, { cookie })).data.state, "pending");
  for (let i = 0; i < 3; i++) assert.equal((await f.request("/api/organizer/events/jobs/synthetic-review-job", { cookie })).data.state, "pending");
  assert.equal(f.count("createFactoryDraft"), 1);
  assert.equal((await f.request("/api/organizer/events/jobs/synthetic-review-job")).status, 401);
  const other = await f.login();
  assert.equal((await f.request("/api/organizer/events/jobs/synthetic-review-job", { cookie: other.cookie })).status, 404);
  assert.equal((await f.post("/api/organizer/events/jobs", { ...input, input: { ...organizerTerms, title: "Different" } }, { cookie })).status, 409);
  const result = { id: "synthetic-review", transaction: { value: "0" } };
  gate.resolve(result); await new Promise(setImmediate);
  const ready = await f.request("/api/organizer/events/jobs/synthetic-review-job", { cookie });
  assert.equal(ready.status, 200); assert.equal(ready.data.state, "ready");
  assert.deepEqual(ready.data.result, result);
  assert.equal(ready.data.instanceId, f.factories[0].serverInstanceId);
  assert.equal(ready.headers["cache-control"], "no-store");
  assert.equal(ready.headers["set-cookie"], undefined);
  assert.equal(f.count("createFactoryDraft"), 1);
  assert.equal(f.count("forwardedRPC"), 0);
});

test("organizer async validation and known-hash receipt checks preserve original method arguments and DTOs", async (t) => {
  const f = await fixture(t), { cookie } = await f.login();
  f.w.factoryJobHandler = async (operation, context) => operation === "validate"
    ? { id: context.draftId, transaction: { value: "0" } }
    : { status: "confirmed", eventId, hash: context.hash, contract };
  const validation = { requestId: "synthetic-validation-job", operation: "validate", draftId: "original-draft" };
  assert.equal((await f.post("/api/organizer/events/jobs", validation, { cookie })).status, 202);
  const validated = await f.request("/api/organizer/events/jobs/synthetic-validation-job", { cookie });
  assert.deepEqual(validated.data.result, { draft: { id: "original-draft", transaction: { value: "0" } }, transaction: { value: "0" } });
  assert.equal(validated.data.state, "ready");
  const receipt = { requestId: "synthetic-receipt-job", operation: "reconcile", draftId: "original-draft", hash: submittedHash };
  assert.equal((await f.post("/api/organizer/events/jobs", receipt, { cookie })).status, 202);
  const reconciled = await f.request("/api/organizer/events/jobs/synthetic-receipt-job", { cookie });
  assert.equal(reconciled.data.result.hash, submittedHash);
  assert.equal(reconciled.data.result.participantUrl, `${publicOrigin}/#event=${eventId}&view=participant`);
  assert.equal(f.count("validateFactoryDraft"), 1); assert.equal(f.count("reconcileFactorySubmission"), 1);
  assert.equal(f.w.calls.find((call) => call.method === "reconcileFactorySubmission").args[2], submittedHash);
});

test("organizer jobs suppress results after logout and reject revoked sessions while request bodies are awaited", async (t) => {
  const f = await fixture(t), login = await f.login(), gate = deferred();
  f.w.factoryJobHandler = async () => gate.promise;
  const input = { requestId: "revoked-review-job", operation: "prepare", input: organizerTerms };
  assert.equal((await f.post("/api/organizer/events/jobs", input, { cookie: login.cookie })).status, 202);
  assert.equal((await f.request("/api/session", { method: "DELETE", payload: {}, cookie: login.cookie })).status, 200);
  gate.resolve({ privateReview: privateCaseBody }); await new Promise(setImmediate);
  assert.equal((await f.request("/api/organizer/events/jobs/revoked-review-job", { cookie: login.cookie })).status, 401);
  const fresh = await f.login(login.wallet);
  const unavailable = await f.request("/api/organizer/events/jobs/revoked-review-job", { cookie: fresh.cookie });
  assert.equal(unavailable.status, 404); assert.equal(unavailable.raw.includes(privateCaseBody), false);
  const bodyGate = deferred();
  const awaiting = f.post("/api/organizer/events/jobs", { ...input, requestId: "late-revoked-job" }, { cookie: fresh.cookie, bodyGate: bodyGate.promise });
  await new Promise(setImmediate);
  await f.request("/api/session", { method: "DELETE", payload: {}, cookie: fresh.cookie });
  bodyGate.resolve(); assert.equal((await awaiting).status, 401);
  assert.equal(f.count("createFactoryDraft"), 1);
});

test("production startup rejects the wrong chain, unverified mode and any server signer before listening", async () => {
  for (const overrides of [
    { chainId: 10200 },
    { production: false },
    { signers: [{}] },
  ]) {
    const w = boundaryWorkbench(overrides);
    await assert.rejects(
      startServer(
        {
          port: 0,
          production: { manifest: { syntheticBoundaryFixture: true } },
          deployment: {
            mode: "hosted-production",
            publicOrigin,
            backendOrigin,
            proxySecret,
          },
        },
        { workbenchFactory: async () => w },
      ),
      (error) => error.code === "WRONG_CHAIN" && error.status === 409,
    );
    assert.deepEqual(w.calls, []);
  }
});

test("production auth checks fresh EOA code at challenge and verification, then binds a secure signed session", async (t) => {
  const f = await fixture(t);
  const { wallet, issued, verified, cookie } = await f.login();
  assert.match(issued.message, /Kleros Ethereum mainnet workbench/);
  assert(issued.message.includes("Domain: " + new URL(publicOrigin).host));
  assert(issued.message.includes("URI: " + publicOrigin));
  assert(issued.message.includes("Chain ID: 1\nWallet: " + wallet.address));
  assert(issued.message.includes("Nonce: " + issued.nonce));
  assert.equal(f.count("assertWallet"), 2);
  const guards = f.w.calls.filter((call) => call.method === "guardRPC");
  assert.equal(guards.length, 6);
  assert.notEqual(
    guards[1].args[1][1],
    guards[4].args[1][1],
    "Verification must read a new head, not reuse challenge acceptance",
  );
  assert.deepEqual(verified.data, {
    wallet: wallet.address,
    label: "Verified browser wallet",
    mode: "wallet",
  });
  assert.match(
    verified.headers["set-cookie"][0],
    /HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure/,
  );
  const bootstrap = await f.request("/api/bootstrap", { cookie });
  assert.equal(bootstrap.data.session.wallet, wallet.address);
  assert.equal(f.count("forwardedRPC"), 0);
});

for (const [label, code] of [
  ["contract/ERC1271", "0x6000631626ba7e"],
  ["EIP7702", "0xef0100" + "56".repeat(20)],
]) {
  test(`production HTTP rejects a ${label} account before issuing a nonce`, async (t) => {
    const f = await fixture(t);
    const wallet = ethers.Wallet.createRandom();
    f.w.codeByWallet.set(wallet.address.toLowerCase(), code);
    const response = await f.post("/api/auth/challenge", {
      wallet: wallet.address,
    });
    assert.equal(response.status, 422);
    assert.equal(response.data.code, "UNSUPPORTED_WALLET");
    assert.equal(response.data.nonce, undefined);
    assert.equal(response.headers["set-cookie"], undefined);
    assert.equal(f.count("assertWallet"), 1);
    assert.equal(f.count("guardRPC"), 3);
  });
}

test("code added after nonce issuance is rejected at verify and the used nonce cannot be replayed", async (t) => {
  const f = await fixture(t);
  const wallet = ethers.Wallet.createRandom();
  const issued = await f.challenge(wallet);
  const signature = await wallet.signMessage(issued.message);
  f.w.codeByWallet.set(
    wallet.address.toLowerCase(),
    "0xef0100" + "78".repeat(20),
  );
  const rejected = await f.post("/api/auth/verify", {
    nonce: issued.nonce,
    signature,
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.data.code, "UNSUPPORTED_WALLET");
  assert.equal(rejected.headers["set-cookie"], undefined);
  f.w.codeByWallet.delete(wallet.address.toLowerCase());
  const replay = await f.post("/api/auth/verify", {
    nonce: issued.nonce,
    signature,
  });
  assert.equal(replay.status, 403);
  assert.equal(replay.data.code, "BAD_NONCE");
  assert.equal(f.count("assertWallet"), 2);
});

test("wrong signatures and foreign mutation origins cannot create a production wallet session", async (t) => {
  const f = await fixture(t);
  const wallet = ethers.Wallet.createRandom();
  const issued = await f.challenge(wallet);
  const signature = await ethers.Wallet.createRandom().signMessage(
    issued.message,
  );
  const rejected = await f.post("/api/auth/verify", {
    nonce: issued.nonce,
    signature,
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.data.code, "BAD_SIGNATURE");
  assert.equal(rejected.headers["set-cookie"], undefined);
  assert.equal(f.count("assertWallet"), 1);
  const foreign = await f.post(
    "/api/auth/challenge",
    { wallet: wallet.address },
    { headers: { origin: "https://foreign.example.invalid" } },
  );
  assert.equal(foreign.status, 403);
  assert.equal(foreign.data.code, "BAD_ORIGIN");
  assert.equal(f.count("assertWallet"), 1);
});

test("demo identities and explicit time, faucet, mock arbitration and reset routes stop before workbench mutation", async (t) => {
  const f = await fixture(t);
  for (const [route, payload, code] of [
    ["/api/session", { identity: "organizer-a" }, "WALLET_REQUIRED"],
    ["/api/demo/advance", { seconds: 86400 }, "DEMO_ONLY"],
    ["/api/demo/fund", {}, "DEMO_ONLY"],
    ["/api/demo/reset", {}, "DEMO_ONLY"],
    [`/api/events/${eventId}/demo/ruling`, { ruling: 1 }, "DEMO_ONLY"],
    [`/api/events/${eventId}/demo/appeal`, { ruling: 1 }, "DEMO_ONLY"],
  ]) {
    const response = await f.post(route, payload);
    assert.equal(response.status, 403, route + " " + response.raw);
    assert.equal(response.data.code, code);
  }
  assert.deepEqual(f.w.calls, []);
});

test("production local file and legacy finance routes cannot reach preview, owner or chain helpers", async (t) => {
  const f = await fixture(t);
  const upload = await f.post(
    "/local-upload",
    {},
    { headers: { "content-type": "multipart/form-data; boundary=synthetic" } },
  );
  assert.equal(upload.status, 404);
  assert.equal(upload.data.code, "NOT_FOUND");
  for (const route of [
    "/local-ipfs/synthetic",
    "/local-policy/synthetic",
    `/finance/${eventId}/guest/`,
    `/finance/${eventId}/console/`,
  ]) {
    const response = await f.request(route);
    assert.equal(response.status, 404, route + " " + response.raw);
    assert.equal(response.data.code, "NOT_FOUND");
  }
  assert.deepEqual(f.w.calls, []);
});

test("production event creation and server execution are rejected before their injected workbench handlers", async (t) => {
  const f = await fixture(t);
  const created = await f.post("/api/events", { title: "Must not deploy" });
  assert.equal(created.status, 403, created.raw);
  assert.equal(created.data.code, "DEMO_ONLY");
  const executed = await f.post(`/api/events/${eventId}/drafts/review/execute`);
  assert.equal(executed.status, 403, executed.raw);
  assert.equal(executed.data.code, "WALLET_SIGNATURE_REQUIRED");
  for (const method of [
    "createEvent",
    "executeDraft",
    "assertWallet",
    "forwardedRPC",
  ])
    assert.equal(f.count(method), 0, method);
});

test("production RPC rejects the entire mixed batch without forwarding even its allowed reads", async (t) => {
  const f = await fixture(t);
  for (const method of [
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "personal_sign",
    "evm_increaseTime",
    "evm_mine",
    "hardhat_setCode",
    "eth_accounts",
  ])
    for (const first of [true, false]) {
      const allowed = {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      };
      const denied = { jsonrpc: "2.0", id: 2, method, params: [sentinel] };
      const response = await f.post(
        "/rpc",
        first ? [allowed, denied] : [denied, allowed],
      );
      assert.equal(response.status, 403, method);
      assert.equal(response.data.code, "RPC_METHOD_FORBIDDEN");
      assert(!response.raw.includes(sentinel));
    }
  assert.equal(f.count("forwardedRPC"), 0);
  const read = await f.post("/rpc", {
    jsonrpc: "2.0",
    id: 3,
    method: "eth_getStorageAt",
    params: [contract, "0x0", "latest"],
  });
  assert.equal(read.status, 200);
  assert.deepEqual(read.data, {
    jsonrpc: "2.0",
    id: 3,
    result: "0x" + "00".repeat(32),
  });
  assert.equal(f.count("forwardedRPC"), 1);
  assert.deepEqual(
    f.w.calls.find((call) => call.method === "forwardedRPC").args,
    ["eth_getStorageAt", [contract, "0x0", "latest"]],
  );
});

test("known-hash reconciliation and status remain available after the authenticated wallet gains code", async (t) => {
  const f = await fixture(t);
  const { wallet, cookie } = await f.login();
  f.w.codeByWallet.set(
    wallet.address.toLowerCase(),
    "0xef0100" + "9a".repeat(20),
  );
  const guardCount = f.count("assertWallet");
  const response = await f.post(
    `/api/events/${eventId}/submissions/reconcile`,
    { draftId: "known-review", hash: submittedHash },
    { cookie },
  );
  assert.equal(response.status, 200, response.raw);
  assert.equal(response.data.hash, submittedHash);
  const status = await f.request(
    `/api/events/${eventId}/submissions/${submittedHash}`,
    { cookie },
  );
  assert.equal(status.status, 200);
  assert.equal(status.data.wallet, wallet.address);
  assert.equal(
    f.count("assertWallet"),
    guardCount,
    "Read-only known-hash paths must not apply the current code guard",
  );
  assert.equal(f.count("reconcileSubmission"), 1);
  assert.equal(f.count("submissionStatus"), 1);
  assert.equal(f.count("executeDraft"), 0);
  assert.equal(f.count("forwardedRPC"), 0);
});

test("production recovery survives an upgrade trust mismatch while new signing stays gated and private scope remains enforced", async (t) => {
  const f = await fixture(t);
  const { wallet, cookie } = await f.login();
  f.w.privateWallet = wallet.address;
  f.w.events.get(eventId).definition.visibility = "private";
  f.w.stateFailure = Object.assign(new Error(errorPayload), {
    code: "UPGRADE_TRUST_MISMATCH",
    status: 409,
  });
  f.w.codeByWallet.set(
    wallet.address.toLowerCase(),
    "0xef0100" + "9b".repeat(20),
  );
  const paths = [
    {
      route: `/api/events/${eventId}/submissions/reconcile`,
      method: "POST",
      payload: { draftId: "known-review", hash: submittedHash },
      handler: "reconcileSubmission",
    },
    {
      route: `/api/events/${eventId}/submissions/${submittedHash}`,
      method: "GET",
      handler: "submissionStatus",
    },
    {
      route: `/api/events/${eventId}/drafts/known-review/submitted`,
      method: "POST",
      payload: { hash: submittedHash },
      handler: "recordSubmitted",
    },
  ];
  const guardCount = f.count("assertWallet");
  for (const { route, handler, ...options } of paths) {
    const response = await f.request(route, { ...options, cookie });
    assert.equal(response.status, 200, route + " " + response.raw);
    assert.equal(response.data.hash, submittedHash);
    assert.equal(response.data.wallet, wallet.address);
    assert.equal(f.count(handler), 1);
  }
  assert.equal(
    f.count("state"),
    0,
    "Known-hash recovery must precede the mutable financial trust gate",
  );
  assert.equal(
    f.count("assertWallet"),
    guardCount,
    "Recovery must not require fresh signing compatibility",
  );
  assert.equal(
    f.count("record"),
    3,
    "Recovery must retain the private event's authenticated wallet binding",
  );

  for (const route of [
    `/api/events/${eventId}/drafts`,
    `/api/events/${eventId}/drafts/known-review/validate`,
  ]) {
    const response = await f.post(route, { action: "deposit" }, { cookie });
    assert.equal(response.status, 409, route + " " + response.raw);
    assert.equal(response.data.code, "UPGRADE_TRUST_MISMATCH");
    assert(!response.raw.includes(sentinel));
  }
  assert.equal(f.count("state"), 2);
  assert.equal(f.count("createDraft"), 0);
  assert.equal(f.count("validateDraft"), 0);

  const before = Object.fromEntries(
    paths.map(({ handler }) => [handler, f.count(handler)]),
  );
  for (const { route, handler, ...options } of paths) {
    const response = await f.request(route, options);
    assert.equal(response.status, 401, route + " " + response.raw);
    assert.equal(response.data.code, "UNAUTHENTICATED");
    assert.equal(f.count(handler), before[handler]);
  }
  const other = await f.login();
  const afterLoginGuardCount = f.count("assertWallet");
  for (const { route, handler, ...options } of paths) {
    const response = await f.request(route, {
      ...options,
      cookie: other.cookie,
    });
    assert.equal(response.status, 403, route + " " + response.raw);
    assert.equal(response.data.code, "FORBIDDEN");
    assert(!response.raw.includes(wallet.address));
    assert.equal(f.count(handler), before[handler]);
  }
  assert.equal(f.count("assertWallet"), afterLoginGuardCount);
  assert.equal(
    f.count("state"),
    2,
    "Denied recovery must not probe mutable financial state either",
  );
  assert.equal(f.count("executeDraft"), 0);
  assert.equal(f.count("forwardedRPC"), 0);
});

test("production HTTP errors redact provider signatures, URL credentials and calldata", async (t) => {
  const f = await fixture(t);
  for (const code of [
    "CALL_EXCEPTION",
    "BAD_SIGNATURE",
    "DEPLOYMENT_MISMATCH",
    "UNSUPPORTED_WALLET",
    "ORIGINAL_HASH_NOT_RECORDED",
    "V10_WALLET_UNAVAILABLE",
    "V10_TRANSACTION_UNCONFIRMED",
    "V10_RECEIPT_CONTEXT_AMBIGUOUS",
  ]) {
    f.w.bootstrapFailure = Object.assign(new Error(errorPayload), {
      code,
      shortMessage: errorPayload,
      status: 422,
      cause: { signature: sentinel, calldata: sentinel },
    });
    const response = await f.request("/api/bootstrap");
    assert(!response.raw.includes(sentinel));
    assert(!response.raw.includes("password"));
    assert(!response.raw.includes("rpc.example.invalid"));
    assert.deepEqual(Object.keys(response.data).sort(), ["code", "error"]);
    assert.equal(
      response.status,
      {
        CALL_EXCEPTION: 503,
        BAD_SIGNATURE: 403,
        DEPLOYMENT_MISMATCH: 409,
        UNSUPPORTED_WALLET: 422,
        ORIGINAL_HASH_NOT_RECORDED: 409,
        V10_WALLET_UNAVAILABLE: 503,
        V10_TRANSACTION_UNCONFIRMED: 409,
        V10_RECEIPT_CONTEXT_AMBIGUOUS: 409,
      }[code],
    );
  }
  f.w.bootstrapFailure = null;
  const rpc = await f.post("/rpc", {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ data: sentinel }, "latest"],
  });
  assert.equal(rpc.status, 200);
  assert.equal(rpc.data.error.code, -32000);
  assert(!rpc.raw.includes(sentinel));
  assert(!rpc.raw.includes("password"));
});

test("production HTTP enforces gateway Host, credential and mutation content-type before fake calls", async (t) => {
  const f = await fixture(t);
  for (const [headers, code] of [
    [{ host: "wrong.example.invalid" }, "BAD_HOST"],
    [{ "x-kleros-proxy-key": "wrong-key" }, "PROXY_REQUIRED"],
  ]) {
    const response = await f.request("/api/bootstrap", { headers });
    assert.equal(response.status, 403);
    assert.equal(response.data.code, code);
  }
  const content = await f.post(
    "/api/auth/challenge",
    {},
    { headers: { "content-type": "text/plain" } },
  );
  assert.equal(content.status, 415);
  assert.equal(content.data.code, "BAD_CONTENT_TYPE");
  assert.deepEqual(f.w.calls, []);
  const health = await f.request("/healthz", {
    headers: { host: "wrong.example.invalid", "x-kleros-proxy-key": "" },
  });
  assert.deepEqual(health.data, { status: "ok", mode: "hosted-production" });
  assert.deepEqual(f.w.calls, []);
});

test("production case publication routes preserve the exact signed session, wallet and two-field approval", async (t) => {
  const f = await fixture(t);
  const { wallet, cookie } = await f.login();
  const guardCount = f.count("assertWallet");
  for (const [action, handler] of caseRoutes) {
    const payload = action === "publish" ? caseApproval : {};
    const response = await f.post(
      `/api/events/${eventId}/cases/${caseWallet}/${action}`,
      payload,
      { cookie },
    );
    assert.equal(response.status, 200, response.raw);
    assert.equal(response.data.artifact.content, privateCaseBody);
    assert.equal(f.count(handler), 1);
    const tracked = f.w.calls.find((call) => call.method === handler);
    assert.equal(tracked.args[0], eventId);
    assert.equal(tracked.args[1].wallet, wallet.address);
    assert.equal(tracked.args[1].mode, "wallet");
    assert.equal(tracked.args[2], caseWallet);
    assert.equal(tracked.args.length, action === "publish" ? 4 : 3);
    if (action === "publish") assert.deepEqual(tracked.args[3], caseApproval);
    const context = f.w.caseContexts.at(-1);
    assert.equal(context.session.wallet, wallet.address);
    assert.equal(
      context.assertSession(),
      undefined,
      "The route supplies a live session validator",
    );
    assert.deepEqual(
      f.w.calls
        .filter(
          (call) =>
            call.method === "caseSessionChecked" && call.args[0] === handler,
        )
        .map((call) => call.args[1]),
      ["before", "after"],
    );
  }
  assert(
    f.w.caseContexts.every(
      (context) => context.session === f.w.caseContexts[0].session,
    ),
    "All three handlers receive the exact same server-held session object",
  );
  assert.equal(
    f.count("assertWallet"),
    guardCount,
    "Metadata routes do not ask for a financial signature or fresh EOA signing check",
  );
  assert.equal(
    f.count("publish"),
    0,
    "The legacy local publication handler stays separate",
  );
  assert.equal(f.count("forwardedRPC"), 0);
});

test("production case artifact and availability reject all nonempty bodies before the workbench", async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.login();
  for (const [action, handler] of caseRoutes.filter(
    ([action]) => action !== "publish",
  )) {
    for (const payload of [
      { sha256: caseApproval.sha256 },
      { content: privateCaseBody },
      [],
      ["unexpected"],
      null,
      "unexpected",
    ]) {
      const response = await f.post(
        `/api/events/${eventId}/cases/${caseWallet}/${action}`,
        payload,
        { cookie },
      );
      assert.equal(response.status, 400, `${action} ${response.raw}`);
      assert.equal(response.data.code, "INVALID_INPUT");
      assert(!response.raw.includes(privateCaseBody));
      assert.equal(f.count(handler), 0);
    }
  }
  assert.deepEqual(f.w.caseContexts, []);
});

test("production case publication routes never call wallet or publication handlers without a session", async (t) => {
  const f = await fixture(t);
  for (const [action, handler] of caseRoutes) {
    const response = await f.post(
      `/api/events/${eventId}/cases/${caseWallet}/${action}`,
      action === "publish" ? caseApproval : {},
    );
    assert.equal(response.status, 401, response.raw);
    assert.equal(response.data.code, "UNAUTHENTICATED");
    assert(!response.raw.includes(privateCaseBody));
    assert.equal(f.count(handler), 0);
  }
  assert.equal(f.count("assertWallet"), 0);
  assert.equal(f.count("publish"), 0);
  assert.equal(f.count("forwardedRPC"), 0);
});

test(
  "production case routes recheck a revoked session after an incomplete asynchronous request body",
  { timeout: 10000 },
  async (t) => {
    for (const [action, handler] of caseRoutes) {
      const f = await fixture(t);
      const { cookie } = await f.login();
      const entered = deferred(),
        release = deferred(),
        state = f.w.state;
      f.w.state = async (...args) => {
        const result = await state(...args);
        entered.resolve();
        return result;
      };
      const pending = f.post(
        `/api/events/${eventId}/cases/${caseWallet}/${action}`,
        action === "publish" ? caseApproval : {},
        { cookie, bodyGate: release.promise },
      );
      let response;
      try {
        await entered.promise;
        assert.equal(
          f.count(handler),
          0,
          "The client has not completed the JSON body",
        );
        const loggedOut = await f.request("/api/session", {
          method: "DELETE",
          cookie,
        });
        assert.equal(loggedOut.status, 200, loggedOut.raw);
      } finally {
        release.resolve();
      }
      response = await pending;
      assert.equal(response.status, 401, response.raw);
      assert.equal(response.data.code, "UNAUTHENTICATED");
      assert.equal(
        f.count(handler),
        0,
        "The post-body session guard must run before the private handler",
      );
      assert(!response.raw.includes(privateCaseBody));
      assert.deepEqual(f.w.caseContexts, []);
    }
  },
);

test(
  "the passed case callback rejects a session revoked during awaited work without disclosing an artifact",
  { timeout: 10000 },
  async (t) => {
    for (const [action, handler] of caseRoutes) {
      const f = await fixture(t);
      const { cookie } = await f.login();
      const entered = deferred(),
        release = deferred();
      let callbacksAfterAwait = 0;
      f.w.caseHandler = async ({ assertSession }) => {
        entered.resolve();
        await release.promise;
        callbacksAfterAwait++;
        assertSession();
        return { artifact: { content: privateCaseBody } };
      };
      const pending = f.post(
        `/api/events/${eventId}/cases/${caseWallet}/${action}`,
        action === "publish" ? caseApproval : {},
        { cookie },
      );
      try {
        await entered.promise;
        const loggedOut = await f.request("/api/session", {
          method: "DELETE",
          cookie,
        });
        assert.equal(loggedOut.status, 200);
      } finally {
        release.resolve();
      }
      const response = await pending;
      assert.equal(response.status, 401, response.raw);
      assert.equal(response.data.code, "UNAUTHENTICATED");
      assert.equal(callbacksAfterAwait, 1);
      assert.equal(f.count(handler), 1);
      assert(!response.raw.includes(privateCaseBody));
      assert.deepEqual(Object.keys(response.data).sort(), ["code", "error"]);
    }
  },
);

test(
  "the production route's final session check suppresses private results even if an awaited handler returns them",
  { timeout: 10000 },
  async (t) => {
    for (const [action, handler] of caseRoutes) {
      const f = await fixture(t);
      const { cookie } = await f.login();
      const entered = deferred(),
        release = deferred();
      f.w.caseHandler = async () => {
        entered.resolve();
        await release.promise;
        // Deliberately omit a second callback check to isolate the HTTP route's
        // own post-await disclosure guard from the service's guards.
        return {
          artifact: { content: privateCaseBody },
          publication: { status: "verified" },
        };
      };
      const pending = f.post(
        `/api/events/${eventId}/cases/${caseWallet}/${action}`,
        action === "publish" ? caseApproval : {},
        { cookie },
      );
      try {
        await entered.promise;
        assert.equal(
          (await f.request("/api/session", { method: "DELETE", cookie }))
            .status,
          200,
        );
      } finally {
        release.resolve();
      }
      const response = await pending;
      assert.equal(response.status, 401, response.raw);
      assert.equal(response.data.code, "UNAUTHENTICATED");
      assert.equal(f.count(handler), 1);
      assert(!response.raw.includes(privateCaseBody));
      assert(!response.raw.includes('"status":"verified"'));
    }
  },
);

test(
  "production case routes retain an awaited private-scope denial without disclosing the handler payload",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const { wallet, cookie } = await f.login();
    const entered = deferred(),
      release = deferred();
    f.w.privateWallet = wallet.address;
    f.w.caseHandler = async ({ eventId: id, session, assertSession }) => {
      entered.resolve();
      await release.promise;
      assertSession();
      f.w.record(id, session);
      return { artifact: { content: privateCaseBody } };
    };
    const pending = f.post(
      `/api/events/${eventId}/cases/${caseWallet}/artifact`,
      {},
      { cookie },
    );
    try {
      await entered.promise;
      f.w.privateWallet = ethers.Wallet.createRandom().address;
    } finally {
      release.resolve();
    }
    const response = await pending;
    assert.equal(response.status, 403, response.raw);
    assert.equal(response.data.code, "FORBIDDEN");
    assert(!response.raw.includes(privateCaseBody));
    assert(!response.raw.includes(sentinel));
    assert(!response.raw.includes(wallet.address));
    assert.equal(f.count("caseArtifact"), 1);
  },
);
