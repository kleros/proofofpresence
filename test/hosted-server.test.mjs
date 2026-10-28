import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";

const publicOrigin = "https://preview.invalid";
const backendOrigin = "https://backend.invalid";
const proxySecret = "hosted_test_only_" + "0123456789abcdef".repeat(4);
let app, runtimeRoot;
const deployment = {
  mode: "hosted-demo",
  publicOrigin,
  backendOrigin,
  proxySecret,
};

before(async () => {
  runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kleros-hosted-test-"));
  app = await startServer({
    port: 0,
    rpcPort: 0,
    deployment: { ...deployment, runtimeRoot },
  });
});
after(async () => {
  await app?.close();
  if (runtimeRoot) await fs.rm(runtimeRoot, { recursive: true, force: true });
});
async function request(
  route,
  { method = "GET", payload, cookie, headers = {} } = {},
) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      app.url + route,
      {
        method,
        agent: false,
        headers: {
          host: new URL(backendOrigin).host,
          "x-kleros-proxy-key": proxySecret,
          ...(method !== "GET"
            ? { origin: publicOrigin, "content-type": "application/json" }
            : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: Object.fromEntries(
                Object.entries(res.headers)
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => [
                    key,
                    Array.isArray(value) ? value.join("; ") : value,
                  ]),
              ),
            }),
          ),
        );
      },
    );
    req.on("error", reject);
    req.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}
const post = (route, payload, options = {}) =>
  request(route, { ...options, method: "POST", payload });
const rpc = (method, params = []) =>
  post("/rpc", { jsonrpc: "2.0", id: 1, method, params });

test("hosted legacy financial pages refuse another chain1337 instance before signing", async () => {
  const bootstrap = await (await request("/api/bootstrap")).json();
  assert.ok(bootstrap.chain.instanceMarker.blockHash);
  const html = await (await request("/finance/event-a/guest/")).text();
  const guard = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(guard?.includes("hostedChainMetadata"));
  assert.ok(!html.includes("window.ethereum.request("));
  let signed = 0;
  const sandbox = {
    window: {
      ethereum: {
        request: async ({ method }) => {
          if (method === "eth_chainId") return "0x539";
          if (method === "eth_getBlockByNumber")
            return { hash: "0x" + "00".repeat(32) };
          signed++;
          return "unexpected-signing-request";
        },
      },
    },
  };
  await assert.rejects(
    vm.runInNewContext(
      guard + '\nhostedWalletRequest({method:"eth_sendTransaction",params:[]})',
      sandbox,
    ),
    /different chain1337 instance/,
  );
  assert.equal(signed, 0);
});

test("hosted configuration is explicit and rejects incomplete or insecure origins and proxy credentials", async () => {
  for (const invalid of [
    { ...deployment, mode: "production" },
    { ...deployment, publicOrigin: "http://preview.invalid" },
    { ...deployment, backendOrigin: "https://backend.invalid/path" },
    { ...deployment, proxySecret: "short" },
  ]) {
    await assert.rejects(() =>
      startServer({ port: 0, rpcPort: 0, deployment: invalid }),
    );
  }
  assert.equal(app.server.address().address, "0.0.0.0");
});

test("only minimal health is public; all other hosted routes require the exact backend Host and proxy key", async () => {
  const health = await fetch(app.url + "/healthz");
  assert.deepEqual(await health.json(), { status: "ok", mode: "hosted-demo" });
  for (const route of [
    "/",
    "/api/bootstrap",
    "/finance/event-a/guest/",
    "/local-policy/unknown",
  ]) {
    const missing = await request(route, {
      headers: { "x-kleros-proxy-key": "" },
    });
    assert.equal(missing.status, 403, route);
    assert.equal((await missing.json()).code, "PROXY_REQUIRED");
  }
  assert.equal(
    (
      await request("/api/bootstrap", {
        headers: { "x-kleros-proxy-key": "wrong-key" },
      })
    ).status,
    403,
  );
  const wrongHost = await request("/api/bootstrap", {
    headers: {
      host: "attacker.invalid",
      "x-forwarded-host": new URL(backendOrigin).host,
    },
  });
  assert.equal(wrongHost.status, 403);
  assert.equal((await wrongHost.json()).code, "BAD_HOST");
  const bootstrap = await (await request("/api/bootstrap")).json();
  assert.equal(bootstrap.mode, "hosted-demo");
  assert.equal(bootstrap.chain.rpcUrl, publicOrigin + "/rpc");
  assert.equal(bootstrap.chain.chainId, 1337);
  assert.deepEqual(bootstrap.capabilities, {
    sharedDemo: true,
    browserWallet: true,
  });
  assert.ok(
    bootstrap.identities.every(
      (identity) => !identity.signer && !identity.privateKey,
    ),
  );
});

test("hosted sessions require the public HTTPS origin and issue secure cookies and public-domain nonces", async () => {
  for (const origin of [
    "http://preview.invalid",
    backendOrigin,
    "https://attacker.invalid",
    "",
  ]) {
    const denied = await post(
      "/api/session",
      { identity: "alice" },
      { headers: { origin } },
    );
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "BAD_ORIGIN");
  }
  const login = await post("/api/session", { identity: "alice" });
  assert.equal(login.status, 200);
  const cookieHeader = login.headers.get("set-cookie");
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.match(cookieHeader, /; Secure(?:;|$)/);
  const cookie = cookieHeader.split(";")[0];
  const logout = await request("/api/session", { method: "DELETE", cookie });
  assert.match(logout.headers.get("set-cookie"), /; Secure(?:;|$)/);
  assert.equal(
    (await (await request("/api/bootstrap", { cookie })).json()).session,
    null,
  );
  const wallet = ethers.Wallet.createRandom();
  const challenge = await (
    await post("/api/auth/challenge", { wallet: wallet.address })
  ).json();
  assert.ok(challenge.message.includes("Domain: preview.invalid\n"));
  assert.ok(challenge.message.includes(`URI: ${publicOrigin}\n`));
  assert.ok(!challenge.message.includes("backend.invalid"));
  const signature = await wallet.signMessage(challenge.message);
  const verified = await post("/api/auth/verify", {
    nonce: challenge.nonce,
    signature,
  });
  assert.equal(verified.status, 200);
  const verifiedCookie = verified.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await (await request("/api/bootstrap", { cookie: verifiedCookie })).json())
      .session.wallet,
    wallet.address,
  );
  assert.equal(
    (await post("/api/auth/verify", { nonce: challenge.nonce, signature }))
      .status,
    403,
  );
});

test("hosted RPC allows reads but rejects unlocked/admin calls and unsigned, foreign, oversized or unregistered transactions", async () => {
  assert.equal((await (await rpc("eth_chainId")).json()).result, "0x539");
  for (const method of [
    "eth_sendTransaction",
    "eth_accounts",
    "evm_increaseTime",
    "personal_unlockAccount",
    "admin_nodeInfo",
  ]) {
    assert.equal((await rpc(method)).status, 403, method);
  }
  const target = app.workbench.events.get("event-a").deployment.contract;
  const wallet = ethers.Wallet.createRandom();
  const terms = {
    type: 0,
    chainId: 1337,
    nonce: 0,
    to: target,
    value: 1n,
    gasLimit: 100_000n,
    gasPrice: 2_000_000_000n,
  };
  const forbidden = [
    await wallet.signTransaction({ ...terms, chainId: 1 }),
    await wallet.signTransaction({
      ...terms,
      to: ethers.Wallet.createRandom().address,
    }),
    await wallet.signTransaction({ ...terms, to: null, data: "0x60006000" }),
    await wallet.signTransaction({ ...terms, gasLimit: 6_000_001n }),
    await wallet.signTransaction({
      ...terms,
      data: "0x" + "00".repeat(65_537),
    }),
    ethers.Transaction.from(terms).unsignedSerialized,
    "0xnot-a-transaction",
  ];
  for (const raw of forbidden) {
    const denied = await rpc("eth_sendRawTransaction", [raw]);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "RPC_TRANSACTION_FORBIDDEN");
  }
  const raw = await wallet.signTransaction(terms);
  const batch = await post(
    "/rpc",
    [1, 2].map((id) => ({
      jsonrpc: "2.0",
      id,
      method: "eth_sendRawTransaction",
      params: [raw],
    })),
  );
  assert.equal(
    batch.status,
    403,
    "One request cannot submit an unbounded batch of signed transactions",
  );
});

test("hosted wallet transport mines an actual signed reviewed deposit without an RPC session cookie", async () => {
  const wallet = ethers.Wallet.createRandom();
  const challenge = await (
    await post("/api/auth/challenge", { wallet: wallet.address })
  ).json();
  const authentication = await post("/api/auth/verify", {
    nonce: challenge.nonce,
    signature: await wallet.signMessage(challenge.message),
  });
  const cookie = authentication.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await post(
        "/api/events/event-a/participants",
        { name: "Hosted synthetic wallet", email: "hosted@example.invalid" },
        { cookie },
      )
    ).status,
    201,
  );
  assert.equal((await post("/api/demo/fund", {}, { cookie })).status, 200);
  const reviewResponse = await post(
    "/api/events/event-a/drafts",
    { action: "deposit" },
    { cookie },
  );
  assert.equal(reviewResponse.status, 201);
  const review = await reviewResponse.json();
  const raw = await wallet.signTransaction({
    ...review.transaction,
    type: 0,
    nonce: 0,
    gasLimit: 300_000n,
    gasPrice: 2_000_000_000n,
  });
  const response = await rpc("eth_sendRawTransaction", [raw]);
  assert.equal(response.status, 200);
  const sent = await response.json();
  assert.match(sent.result, /^0x[0-9a-f]{64}$/i);
  const receipt = await app.workbench.provider.waitForTransaction(
    sent.result,
    1,
    10_000,
  );
  assert.equal(receipt.status, 1);
  assert.equal(
    (
      await post(
        `/api/events/event-a/drafts/${review.id}/submitted`,
        { hash: sent.result },
        { cookie },
      )
    ).status,
    200,
  );
  const recovered = await (
    await post(
      "/api/events/event-a/submissions/reconcile",
      { draftId: review.id, hash: sent.result },
      { cookie },
    )
  ).json();
  assert.equal(recovered.status, "confirmed");
  const detail = await (
    await request("/api/events/event-a", { cookie })
  ).json();
  assert.equal(detail.participants[0].wallet, wallet.address);
  assert.equal(detail.participants[0].deposit.verified, true);
  assert.equal(detail.participants[0].deposit.txHash, sent.result);
});

test("hosted compatibility pages use the public same-origin RPC and writable instance-scoped runtime root", async () => {
  const login = await post("/api/session", { identity: "organizer-a" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const bootstrap = await (await request("/api/bootstrap", { cookie })).json();
  const htmlResponse = await request("/finance/event-a/guest/", { cookie });
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  const guestConfig = JSON.parse(
    html.match(/const CONFIG = (\{[\s\S]*?\});/)[1],
  );
  assert.equal(guestConfig.rpc, publicOrigin + "/rpc");
  assert.equal(guestConfig.environment, "hosted-demo");
  assert.equal(
    guestConfig.klerosCourt,
    publicOrigin + "/#event=event-a&view=cases",
  );
  const config = await (
    await request("/finance/event-a/console/config.json", { cookie })
  ).json();
  assert.equal(config.rpcUrl, publicOrigin + "/rpc");
  assert.equal(config.mode, "hosted-demo");
  const saved = JSON.parse(
    await fs.readFile(
      path.join(runtimeRoot, bootstrap.instanceId, "event-a", "config.json"),
      "utf8",
    ),
  );
  assert.equal(saved.contract, config.contract);
  assert.equal(saved.rpcUrl, config.rpcUrl);
  assert.equal((await request("/finance/event-a/console/")).status, 401);
});
