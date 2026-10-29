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
    chain: {
      chainId: 1,
      production: true,
      signers: [],
      provider,
      ...chainOverrides,
    },
    provider,
    events: new Map([[eventId, record]]),
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
    async close() {
      track("close");
    },
  };
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
    { method = "GET", payload, cookie, headers: overrides = {} } = {},
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
      req.end(payload === undefined ? undefined : JSON.stringify(payload));
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
