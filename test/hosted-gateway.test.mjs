import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { createGateway } from "../netlify/functions/workbench.mjs";

// All requests are intercepted by this in-memory Fetch implementation. These tests never
// contact Railway, Netlify, a public RPC, or any other external service.
const PUBLIC = "https://synthetic-kleros-preview.netlify.app";
const BACKEND = "https://synthetic-workbench.example.invalid";
const SECRET = "synthetic-gateway-fixture-" + "x".repeat(40);

function setup({ reply, failure, ...configuration } = {}) {
  const calls = [];
  const gateway = createGateway({
    backendOrigin: BACKEND,
    publicOrigin: PUBLIC,
    proxySecret: SECRET,
    ...configuration,
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      calls.push({
        url: new URL(request.url),
        method: request.method,
        headers: new Headers(request.headers),
        body: request.body ? await request.text() : null,
        redirect: request.redirect,
      });
      if (failure) throw failure;
      return reply?.() ??
        new Response('{"ok":true}', {
          headers: { "content-type": "application/json" },
        });
    },
  });
  return { gateway, calls };
}

const request = (path, method = "GET", options = {}) =>
  new Request(PUBLIC + path, {
    method,
    ...options,
    headers: {
      ...(method !== "GET" && method !== "HEAD" ? { origin: PUBLIC } : {}),
      ...options.headers,
    },
  });

async function blocked(gateway, calls, input, expectedStatus) {
  const before = calls.length;
  const response = await gateway(input);
  assert.ok(response instanceof Response);
  if (expectedStatus) assert.equal(response.status, expectedStatus);
  else assert.ok(response.status >= 400 && response.status < 500);
  assert.equal(calls.length, before, "Rejected input must not contact the backend");
  assert.ok(!String(await response.text()).includes(SECRET));
}

test("gateway configuration requires a fixed credential-free HTTPS backend origin and a strong proxy key", () => {
  for (const backendOrigin of [
    "http://backend.example.invalid",
    "https://name:password@backend.example.invalid",
    "https://backend.example.invalid/path",
    "https://backend.example.invalid/?target=elsewhere",
    "https://backend.example.invalid/#fragment",
    "//backend.example.invalid",
  ]) {
    assert.throws(() => setup({ backendOrigin }));
  }
  for (const proxySecret of ["", "short", "x".repeat(31)])
    assert.throws(() => setup({ proxySecret }));
  assert.throws(() => setup({ publicOrigin: PUBLIC + "/path" }));
});

test("API reads use the fixed backend, preserve query data and cookies, and discard caller-controlled forwarding headers", async () => {
  const { gateway, calls } = setup();
  const response = await gateway(request("/api/bootstrap?limit=10&cursor=a%2Fb", "GET", {
    headers: {
      accept: "application/json",
      cookie: "kleros_session=synthetic-session",
      authorization: "Bearer synthetic-caller-token",
      host: "attacker.example.invalid",
      forwarded: "host=attacker.example.invalid;proto=http",
      "x-forwarded-host": "attacker.example.invalid",
      "x-forwarded-proto": "http",
      "x-real-ip": "192.0.2.1",
      "x-kleros-proxy-key": "caller-forgery",
      "x-kleros-requester-key": "a".repeat(64),
      "x-nf-client-connection-ip": "192.0.2.2",
      "x-unrelated-header": "not-forwarded",
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url.origin, BACKEND);
  assert.equal(call.url.pathname, "/api/bootstrap");
  assert.equal(call.url.search, "?limit=10&cursor=a%2Fb");
  assert.equal(call.method, "GET");
  assert.equal(call.redirect, "manual");
  assert.equal(call.headers.get("cookie"), "kleros_session=synthetic-session");
  assert.equal(call.headers.get("accept"), "application/json");
  assert.equal(call.headers.get("origin"), null, "API requests must not invent a user Origin");
  assert.equal(call.headers.get("x-kleros-proxy-key"), SECRET);
  for (const name of ["authorization", "host", "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "x-kleros-requester-key", "x-nf-client-connection-ip", "x-unrelated-header"])
    assert.equal(call.headers.get(name), null, `${name} must not be trusted or forwarded`);
});

test("new flow admission trusts only platform context IP and never browser requester/IP headers", async () => {
  const { gateway, calls } = setup();
  const input = () => request("/api/public-transactions", "POST", { body: '{"wallet":"synthetic-claim","kind":"deposit"}', headers: {
    "content-type": "application/json", "x-kleros-requester-key": "b".repeat(64),
    "x-nf-client-connection-ip": "198.51.100.1", "x-forwarded-for": "198.51.100.2", "x-real-ip": "198.51.100.3",
    forwarded: "for=198.51.100.4", "cf-connecting-ip": "198.51.100.5",
  } });
  for (const context of [undefined, {}, { ip: null }, { ip: "invalid" }, { ip: ["192.0.2.8"] }, { ip: "192.0.2.8, 192.0.2.9" }, { ip: "fe80::1%en0" }]) {
    const response = await gateway(input(), context);
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "PUBLIC_FLOW_REQUESTER_UNAVAILABLE");
  }
  assert.equal(calls.length, 0, "Missing trusted identity fails closed before any backend call");
  assert.equal((await gateway(input(), { ip: "192.0.2.8" })).status, 200);
  const expected = createHmac("sha256", SECRET).update(`public-flow-requester-v1\n${PUBLIC}\nv4:192.0.2.8`).digest("hex");
  assert.equal(calls[0].headers.get("x-kleros-requester-key"), expected);
  for (const header of ["x-nf-client-connection-ip", "x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip"])
    assert.equal(calls[0].headers.get(header), null);
  assert(!calls[0].headers.get("x-kleros-requester-key").includes("192.0.2.8"));
  assert.equal((await gateway(input(), { ip: "192.0.2.8" })).status, 200);
  assert.equal(calls[1].headers.get("x-kleros-requester-key"), expected);
  await gateway(input(), { ip: "192.0.2.9" });
  assert.notEqual(calls[2].headers.get("x-kleros-requester-key"), expected);
});

test("IPv6 equivalent spellings/privacy addresses share a /64 and mapped IPv4 cannot reset admission", async () => {
  const { gateway, calls } = setup();
  const getKey = async ip => {
    assert.equal((await gateway(request("/api/public-transactions", "POST", {
      body: "{}", headers: { "content-type": "application/json" },
    }), { ip })).status, 200);
    return calls.at(-1).headers.get("x-kleros-requester-key");
  };
  const v6 = await getKey("2001:db8:1234:5678::1");
  assert.equal(await getKey("2001:0DB8:1234:5678:0000:0000:0000:0001"), v6);
  assert.equal(await getKey("2001:db8:1234:5678:ffff:abcd:1234:9876"), v6);
  assert.notEqual(await getKey("2001:db8:1234:5679::1"), v6);
  const v4 = await getKey("192.0.2.8");
  assert.equal(await getKey("::ffff:192.0.2.8"), v4);
  assert.equal(await getKey("0:0:0:0:0:FFFF:C000:0208"), v4);
});

test("trusted identity is required only for new minting; existing token/draft/hash routes remain compatible", async () => {
  const { gateway, calls } = setup({ reply: () => new Response('{"status":"retained"}', { status: 200, headers: { "content-type": "application/json" } }) });
  const token = "a".repeat(64);
  for (const [path, method] of [
    [`/api/public-transactions/${token}`, "GET"],
    [`/api/public-transactions/${token}/direct-deposit/prepare`, "POST"],
    [`/api/public-transactions/${token}/direct-deposit/validate`, "POST"],
    [`/api/public-transactions/${token}/submitted`, "POST"],
    [`/api/public-transactions/${token}/event-read-jobs`, "POST"],
    [`/api/public-transactions/${token}/organizer-jobs`, "POST"],
  ]) {
    const response = await gateway(request(path, method, method === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }));
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).headers.get("x-kleros-requester-key"), null);
  }
  // Gateway-first deployment is backward compatible: an older backend receives
  // the original JSON contract plus an additive private header and no new env.
  const body = '{"wallet":"0x1111111111111111111111111111111111111111","kind":"deposit"}';
  const response = await gateway(request("/api/public-transactions", "POST", { body, headers: { "content-type": "application/json" } }), { ip: "192.0.2.20" });
  assert.equal(response.status, 200); assert.equal(calls.at(-1).body, body);
  assert.match(calls.at(-1).headers.get("x-kleros-requester-key"), /^[a-f0-9]{64}$/);
  assert.equal(calls.at(-1).headers.get("x-kleros-proxy-key"), SECRET);
});

test("API mutations forward the actual same-origin body and cookie without manufacturing success", async () => {
  const body = '{"action":"deposit","params":{"amountWei":"10000000000000000"}}';
  const replyBody = '{"error":"Authoritative event state changed","code":"STALE_DRAFT"}';
  const { gateway, calls } = setup({
    reply: () => new Response(replyBody, { status: 409, headers: { "content-type": "application/json" } }),
  });
  const response = await gateway(request("/api/events/event-a/drafts", "POST", {
    body,
    headers: { "content-type": "application/json", cookie: "kleros_session=synthetic-owner" },
  }));
  assert.equal(response.status, 409);
  assert.equal(await response.text(), replyBody);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, body);
  assert.equal(calls[0].headers.get("origin"), PUBLIC);
  assert.equal(calls[0].headers.get("cookie"), "kleros_session=synthetic-owner");
  assert.equal(calls[0].headers.get("content-type"), "application/json");
});

test("wrong public URL origin fails closed even with a forged correct Origin, including RPC", async () => {
  const { gateway, calls } = setup();
  for (const path of ["/api/bootstrap", "/api/session", "/rpc"]) {
    await blocked(gateway, calls, new Request("https://attacker.example.invalid" + path, {
      method: path === "/api/bootstrap" ? "GET" : "POST",
      headers: { origin: PUBLIC, "content-type": "application/json" },
      ...(path === "/api/bootstrap" ? {} : { body: "{}" }),
    }), 403);
  }
});

test("all API writes require the exact actual public Origin; the RPC exception cannot authorize API actions", async () => {
  const { gateway, calls } = setup();
  for (const method of ["POST", "PATCH", "DELETE"]) {
    for (const origin of [undefined, "https://attacker.example.invalid", "chrome-extension://synthetic-wallet", PUBLIC + "/", "null"]) {
      const headers = new Headers({ "content-type": "application/json" });
      if (origin !== undefined) headers.set("origin", origin);
      await blocked(gateway, calls, new Request(PUBLIC + "/api/events/event-a", { method, headers, body: "{}" }), 403);
    }
  }
  // URL normalization must not retain RPC privileges after moving to an API route.
  await blocked(gateway, calls, new Request(PUBLIC + "/rpc/../api/session", {
    method: "POST", headers: { origin: "chrome-extension://synthetic-wallet", "content-type": "application/json" }, body: '{"identity":"organizer-a"}',
  }), 403);
});

test("only workbench route prefixes and supported HTTP methods reach the backend", async () => {
  const { gateway, calls } = setup();
  for (const path of ["/", "/app.js", "/health", "/apiary/bootstrap", "/rpc/admin", "/local-upload/extra", "/.env", "//attacker.example.invalid/api/session"]) {
    await blocked(gateway, calls, request(path));
  }
  for (const [path, method] of [["/api/bootstrap", "PUT"], ["/api/bootstrap", "OPTIONS"], ["/rpc", "GET"], ["/rpc", "PATCH"]]) {
    await blocked(gateway, calls, request(path, method, method === "GET" || method === "OPTIONS" ? {} : { body: "{}" }));
  }
});

test("advanced finance and local evidence/policy routes remain fixed-origin reads", async () => {
  const { gateway, calls } = setup();
  for (const path of ["/finance/event-a/guest", "/finance/event-b/console/settings.json", "/local-ipfs/ipfs/QmSyntheticFixture", "/local-policy/synthetic-policy-hash"]) {
    assert.equal((await gateway(request(path))).status, 200);
    assert.equal(calls.at(-1).url.origin, BACKEND);
    assert.equal(calls.at(-1).url.pathname, path);
  }
  assert.equal(calls.length, 4);
});

test("API response bytes, status and Secure cookie survive while caching is forced private", async () => {
  const payload = '{"valueWei":"123456789012345678901234567890","status":"confirmed"}';
  const cookie = "kleros_session=synthetic; Path=/; HttpOnly; SameSite=Strict; Secure";
  const { gateway } = setup({ reply: () => new Response(payload, {
    status: 201,
    headers: { "content-type": "application/json", "set-cookie": cookie, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-secret-internal": SECRET, "x-kleros-proxy-key": SECRET },
  }) });
  const response = await gateway(request("/api/session", "POST", { body: '{"identity":"alice"}', headers: { "content-type": "application/json" } }));
  assert.equal(response.status, 201);
  assert.equal(await response.text(), payload);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("set-cookie"), cookie);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-secret-internal"), null);
  assert.equal(response.headers.get("x-kleros-proxy-key"), null);
});

test("JSON and evidence upload limits reject oversized bodies before any upstream request", async () => {
  const { gateway, calls } = setup();
  await blocked(gateway, calls, request("/api/events/event-a/imports/preview", "POST", {
    headers: { "content-type": "application/json" }, body: "x".repeat(2_000_000),
  }), 413);
  await blocked(gateway, calls, request("/local-upload", "POST", {
    headers: { "content-type": "multipart/form-data; boundary=synthetic" }, body: "x".repeat(400_000),
  }), 413);
});

test("valid local evidence bytes and content type are passed through without reinterpretation", async () => {
  const body = '--synthetic\r\nContent-Disposition: form-data; name="data"; filename="evidence.txt"\r\nContent-Type: text/plain\r\n\r\nSynthetic evidence only\r\n--synthetic--\r\n';
  const { gateway, calls } = setup();
  const response = await gateway(request("/local-upload", "POST", { body, headers: { "content-type": "multipart/form-data; boundary=synthetic" } }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].body, body);
  assert.equal(calls[0].headers.get("content-type"), "multipart/form-data; boundary=synthetic");
});

test("unexpected mutation content types are rejected before parsing or forwarding user data", async () => {
  const { gateway, calls } = setup();
  await blocked(gateway, calls, request("/api/session", "POST", {
    body: '{"identity":"organizer-a"}', headers: { "content-type": "text/plain" },
  }), 415);
  await blocked(gateway, calls, request("/local-upload", "POST", {
    body: '{"data":"synthetic"}', headers: { "content-type": "application/json" },
  }), 415);
  await blocked(gateway, calls, request("/rpc", "POST", {
    body: '{"method":"eth_chainId"}', headers: { "content-type": "text/plain", origin: "chrome-extension://synthetic-wallet" },
  }), 415);
});

test("HEAD remains a fixed-origin read and cannot leak an upstream response body", async () => {
  const { gateway, calls } = setup({ reply: () => new Response("upstream body must not reach HEAD", {
    headers: { "content-type": "text/html", "set-cookie": "synthetic=one; Secure" },
  }) });
  const response = await gateway(request("/finance/event-a/guest", "HEAD"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "HEAD");
  assert.equal(calls[0].body, null);
  assert.equal(calls[0].url.origin, BACKEND);
});

test("RPC accepts a native-wallet Origin but strips ambient authorization and cookies in both directions", async () => {
  const rpcBody = '{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0xsynthetic-fixture"]}';
  const rpcResult = '{"jsonrpc":"2.0","id":1,"result":"0xsynthetic-result"}';
  const { gateway, calls } = setup({ reply: () => new Response(rpcResult, {
    headers: { "content-type": "application/json", "set-cookie": "kleros_session=must-not-propagate; Secure", "access-control-allow-origin": "https://attacker.example.invalid", "access-control-allow-credentials": "true" },
  }) });
  const response = await gateway(request("/rpc", "POST", { body: rpcBody, headers: {
    origin: "chrome-extension://synthetic-wallet", cookie: "kleros_session=must-not-forward", authorization: "Bearer must-not-forward", "content-type": "application/json", "x-forwarded-host": "attacker.example.invalid",
  } }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), rpcResult);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, BACKEND);
  assert.equal(calls[0].url.pathname, "/rpc");
  assert.equal(calls[0].headers.get("origin"), PUBLIC);
  for (const name of ["cookie", "authorization", "x-forwarded-host"])
    assert.equal(calls[0].headers.get(name), null);
  assert.equal(calls[0].headers.get("x-kleros-proxy-key"), SECRET);
  assert.equal(calls[0].body, rpcBody);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("RPC with no Origin is normalized only on the exact RPC endpoint", async () => {
  const { gateway, calls } = setup();
  const response = await gateway(new Request(PUBLIC + "/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].headers.get("origin"), PUBLIC);
  await blocked(gateway, calls, new Request(PUBLIC + "/api/session", { method: "POST", body: "{}" }), 403);
});

test("RPC OPTIONS is a local credential-free preflight and cannot proxy an API method", async () => {
  const { gateway, calls } = setup();
  const response = await gateway(request("/rpc", "OPTIONS", { headers: {
    origin: "chrome-extension://synthetic-wallet", "access-control-request-method": "POST", "access-control-request-headers": "content-type", cookie: "kleros_session=synthetic",
  } }));
  assert.equal(response.status, 204);
  assert.equal(calls.length, 0);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
  assert.match(response.headers.get("access-control-allow-methods"), /OPTIONS/);
  assert.match(response.headers.get("access-control-allow-headers"), /content-type/i);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  await blocked(gateway, calls, request("/api/session", "OPTIONS", { headers: { origin: "chrome-extension://synthetic-wallet" } }));
});

test("encoded/query-controlled destinations cannot move the upstream request to another host", async () => {
  const { gateway, calls } = setup();
  for (const path of ["/api/%2F%2Fevil.example.invalid/session", "/api/bootstrap?url=https%3A%2F%2Fevil.example.invalid%2Fapi%2Fsession"]) {
    const response = await gateway(request(path));
    if (response.status < 400) assert.equal(calls.at(-1).url.origin, BACKEND);
  }
  assert.ok(calls.every((call) => call.url.origin === BACKEND));
});

test("backend redirects are never followed with the proxy secret", async () => {
  const { gateway, calls } = setup({ reply: () => new Response(null, { status: 302, headers: { location: "https://attacker.example.invalid/steal" } }) });
  const response = await gateway(request("/api/bootstrap"));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("location"), null);
  assert.equal((await response.json()).code, "BACKEND_REDIRECT");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, "manual");
  assert.equal(calls[0].url.origin, BACKEND);
});

test("transport errors produce an explicit unavailable response without leaking secrets or fabricated data", async () => {
  const { gateway, calls } = setup({ failure: new Error(`Synthetic transport exception containing ${SECRET}`) });
  const response = await gateway(request("/api/bootstrap"));
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.ok(!body.includes(SECRET));
  assert.ok(!body.includes("Synthetic transport exception"));
  assert.ok(!body.includes('"events"'));
  assert.equal(typeof JSON.parse(body).error, "string");
  assert.equal(calls.length, 1);
});

test("RPC transport failures retain public cookie-free CORS without exposing backend errors", async () => {
  const { gateway, calls } = setup({ failure: new Error(`Synthetic failure ${SECRET}`) });
  const response = await gateway(request("/rpc", "POST", {
    body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
    headers: { "content-type": "application/json", origin: "chrome-extension://synthetic-wallet", cookie: "must-not-send=1" },
  }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(calls[0].headers.get("cookie"), null);
  assert.ok(!(await response.text()).includes(SECRET));
});
