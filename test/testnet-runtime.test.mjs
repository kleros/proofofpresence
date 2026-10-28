import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import { localChain, deployEvent, DAY } from "../src/chain.mjs";
import { testnetChain, testnetStateStore } from "../src/testnet-runtime.mjs";
import { startServer } from "../src/server.mjs";

// Real HTTPS and JSON-RPC stay on ephemeral loopback listeners. Trust only this
// test's exact-origin certificate; never disable TLS validation or contact Chiado.
let temporary, chain, bridge, rpcOrigin, manifest, app, caAgent, externalWallet;
let stateFile;
const bridgeMethods = [];
const nativeGetUrl = ethers.FetchRequest.createGetUrlFunc();
const clone = (value) => JSON.parse(JSON.stringify(value));
const isCode = (expected) => (error) => error.code === expected;

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kleros-testnet-runtime-"));
  chain = await localChain(0, { chainId: 10200 });
  const keyFile = path.join(temporary, "tls-key.pem");
  const certificateFile = path.join(temporary, "tls-cert.pem");
  execFileSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certificateFile,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  fs.chmodSync(keyFile, 0o600);
  const certificate = fs.readFileSync(certificateFile);
  bridge = https.createServer(
    { key: fs.readFileSync(keyFile), cert: certificate },
    async (req, res) => {
      try {
        assert.equal(req.method, "POST");
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const payload = JSON.parse(body);
        for (const entry of Array.isArray(payload) ? payload : [payload])
          bridgeMethods.push(entry.method);
        const forward = http.request(
          chain.rpcUrl,
          { method: "POST", headers: { "content-type": "application/json" } },
          (reply) => {
            res.writeHead(reply.statusCode, {
              "content-type": "application/json",
            });
            reply.pipe(res);
          },
        );
        forward.on("error", () => {
          res.writeHead(502);
          res.end();
        });
        forward.end(body);
      } catch {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Isolated RPC test bridge failed" }));
      }
    },
  );
  await new Promise((resolve, reject) => {
    bridge.once("error", reject);
    bridge.listen(0, "127.0.0.1", resolve);
  });
  rpcOrigin = `https://127.0.0.1:${bridge.address().port}`;
  caAgent = new https.Agent({ ca: certificate });
  const trustedGetUrl = ethers.FetchRequest.createGetUrlFunc({
    agent: caAgent,
  });
  ethers.FetchRequest.registerGetUrl((request, signal) => {
    const requested = new URL(request.url);
    if (requested.origin === rpcOrigin) return trustedGetUrl(request, signal);
    assert.equal(
      requested.origin,
      new URL(chain.rpcUrl).origin,
      "The runtime test cannot contact any external origin",
    );
    return nativeGetUrl(request, signal);
  });
  const now = (await chain.provider.getBlock("latest")).timestamp;
  const records = [];
  for (const [index, eventId] of ["external-a", "external-b"].entries()) {
    const owner = await chain.signers[index].getAddress();
    const definition = {
      id: eventId,
      title: `Synthetic external ${index ? "B" : "A"}`,
      slug: eventId,
      description: "Synthetic external-runtime fixture",
      startsAt: new Date((now + 3600) * 1000).toISOString(),
      endsAt: new Date((now + 7200) * 1000).toISOString(),
      timezone: "Asia/Bangkok",
      location: "Synthetic local fixture only",
      visibility: "public",
      editorialStatus: "published",
      registrationStatus: "open",
      organizers: [owner],
      staff: [],
    };
    const deployed = await deployEvent(
      chain,
      definition,
      chain.signers[index],
      ethers.parseEther(index ? "0.02" : "0.01"),
      now + 3600,
      now + 15 * DAY,
      { contractVersion: "kleros-event-v8" },
    );
    records.push({ definition, ...deployed });
  }
  manifest = {
    environment: "testnet",
    chain: {
      chainId: 10200,
      name: "Chiado",
      rpcUrl: rpcOrigin,
      nativeCurrency: { name: "Test xDAI", symbol: "XDAI", decimals: 18 },
    },
    arbitration: {
      mode: "controlled",
      resolver: chain.resolver.target,
      arbitrator: chain.liquid.target,
    },
    events: records,
  };
  stateFile = path.join(temporary, "state", "external-state.json");
  externalWallet = ethers.Wallet.createRandom();
  await (
    await chain.signers[0].sendTransaction({
      to: externalWallet.address,
      value: ethers.parseEther("1"),
    })
  ).wait();
});

after(async () => {
  await app?.close();
  ethers.FetchRequest.registerGetUrl(nativeGetUrl);
  caAgent?.destroy();
  await new Promise((resolve) => (bridge ? bridge.close(resolve) : resolve()));
  await chain?.close();
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
});

test("testnet state persists scoped records atomically as owner-only data without following temp symlinks", () => {
  const filename = path.join(temporary, "store-test", "state.json");
  const store = testnetStateStore(filename, manifest);
  assert.equal(store.load(), null);
  const unrelated = path.join(temporary, "must-remain.txt");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(unrelated, "Unrelated content");
  fs.symlinkSync(unrelated, filename + ".tmp");
  const record = {
    deployment: { eventId: "external-a" },
    definition: { id: "external-a" },
    revision: 2,
    observations: [],
    batches: [],
    transactions: [],
    participants: new Map([["p", { wallet: externalWallet.address }]]),
    personal: new Map(),
    publications: new Map(),
    nonces: new Set(["nonce"]),
  };
  store.save(
    new Map([["external-a", record]]),
    new Map([["draft", { id: "draft", eventId: "external-a" }]]),
  );
  assert.equal(fs.readFileSync(unrelated, "utf8"), "Unrelated content");
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const restored = testnetStateStore(filename, manifest).load();
  assert.equal(
    restored.events[0].participants[0][1].wallet,
    externalWallet.address,
  );
  assert.equal(restored.drafts[0][0], "draft");
  assert.throws(
    () =>
      testnetStateStore(filename, {
        ...manifest,
        environment: "another-environment",
      }).load(),
    isCode("STATE_SCOPE"),
  );
  fs.chmodSync(filename, 0o644);
  assert.throws(() => store.load(), isCode("STATE_PERMISSIONS"));
  fs.chmodSync(filename, 0o600);
  const link = path.join(temporary, "linked-state.json");
  fs.symlinkSync(filename, link);
  assert.throws(
    () => testnetStateStore(link, manifest).load(),
    isCode("STATE_PERMISSIONS"),
  );
  assert.throws(() => testnetStateStore("relative.json", manifest));
});

test("external registry rejects wrong network, currency, duplicate custody and changed contract metadata", async () => {
  const invalid = [];
  const wrongChain = clone(manifest);
  wrongChain.chain.chainId = 1;
  invalid.push(wrongChain);
  const wrongCurrency = clone(manifest);
  wrongCurrency.chain.nativeCurrency.symbol = "ETH";
  invalid.push(wrongCurrency);
  const plainHttp = clone(manifest);
  plainHttp.chain.rpcUrl = chain.rpcUrl;
  invalid.push(plainHttp);
  const duplicate = clone(manifest);
  duplicate.events.push(clone(duplicate.events[0]));
  invalid.push(duplicate);
  const aliased = clone(manifest);
  aliased.events[1] = clone(aliased.events[0]);
  aliased.events[1].definition.id = "different-id";
  aliased.events[1].deployment.eventId = "different-id";
  invalid.push(aliased);
  const renamed = clone(manifest);
  renamed.events[0].definition.title = "Incorrect title";
  invalid.push(renamed);
  const changedSchedule = clone(manifest);
  changedSchedule.events[0].definition.startsAt = new Date(0).toISOString();
  invalid.push(changedSchedule);
  const corruptCode = clone(manifest);
  corruptCode.events[0].deployment.codeHash = ethers.ZeroHash;
  invalid.push(corruptCode);
  for (const value of invalid) await assert.rejects(testnetChain(value));
  const external = await testnetChain(manifest);
  try {
    assert.equal(external.chainId, 10200);
    assert.equal(external.rpcUrl, rpcOrigin);
    assert.deepEqual(external.signers, []);
    assert.equal(external.deploy, undefined);
    assert.equal(Number((await external.provider.getNetwork()).chainId), 10200);
  } finally {
    await external.close();
  }
  assert.ok(bridgeMethods.length > 0);
  assert.ok(
    !bridgeMethods.some((method) =>
      /^(eth_accounts|eth_sendTransaction|eth_sendRawTransaction|evm_)/.test(
        method,
      ),
    ),
    "Registry loading must neither query unlocked wallets nor deploy, sign or mutate",
  );
});

async function request(
  route,
  { method = "GET", body, cookie, status = 200 } = {},
) {
  const response = await fetch(app.url + route, {
    method,
    headers: {
      ...(method !== "GET"
        ? { origin: app.url, "content-type": "application/json" }
        : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${route}: ${data.code ?? "response"}`,
  );
  return {
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
    response,
  };
}
async function login(wallet) {
  const challenge = await request("/api/auth/challenge", {
    method: "POST",
    body: { wallet: wallet.address },
  });
  assert.match(challenge.data.message, /Chain ID: 10200/);
  assert.ok(challenge.data.message.includes(`URI: ${app.url}`));
  const signed = await wallet.signMessage(challenge.data.message);
  const verified = await request("/api/auth/verify", {
    method: "POST",
    body: { nonce: challenge.data.nonce, signature: signed },
  });
  assert.match(
    verified.response.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict/,
  );
  return verified.cookie;
}
async function start() {
  app = await startServer({
    port: 0,
    rpcPort: 0,
    contractVersion: "kleros-event-v8",
    testnet: { manifest, stateFile },
    deployment: {
      mode: "testnet",
      runtimeRoot: path.join(temporary, "runtime"),
    },
  });
}

test("real HTTPS external mode requires wallet signatures and recovers a single signed deposit after server restart", async () => {
  await start();
  const boot = (await request("/api/bootstrap")).data;
  assert.equal(boot.mode, "testnet");
  assert.deepEqual(boot.identities, []);
  assert.equal(boot.chain.chainId, 10200);
  assert.equal(boot.chain.nativeCurrency.symbol, "XDAI");
  assert.equal(boot.chain.rpcUrl, rpcOrigin);
  assert.equal(boot.capabilities.sharedDemo, false);
  assert.equal(boot.capabilities.createEvents, false);
  assert.equal(boot.capabilities.timeControls, false);
  const cookie = await login(externalWallet);
  for (const [route, body, expectedCode] of [
    ["/api/session", { identity: "organizer-a" }, "WALLET_REQUIRED"],
    ["/api/demo/fund", {}, "TESTNET_FAUCET"],
    ["/api/demo/advance", { seconds: 1 }, "TESTNET_TIME"],
    ["/api/events", {}, "DEMO_ONLY"],
    [
      "/api/events/external-a/demo/ruling",
      { wallet: externalWallet.address, ruling: 1 },
      "WALLET_REQUIRED",
    ],
  ]) {
    const blocked = await request(route, {
      method: "POST",
      body,
      cookie,
      status: 403,
    });
    assert.equal(blocked.data.code, expectedCode);
  }
  const participant = (
    await request("/api/events/external-a/participants", {
      method: "POST",
      cookie,
      body: {
        name: "Synthetic external participant",
        email: "external-runtime@example.test",
        wallet: await chain.signers[1].getAddress(),
      },
      status: 201,
    })
  ).data;
  assert.equal(
    participant.wallet,
    externalWallet.address,
    "Registration derives identity from the signed session",
  );
  const draft = (
    await request("/api/events/external-a/drafts", {
      method: "POST",
      cookie,
      body: { action: "deposit" },
      status: 201,
    })
  ).data;
  assert.equal(draft.chainId, 10200);
  assert.equal(draft.transaction.from, externalWallet.address);
  assert.equal(draft.transaction.to, manifest.events[0].deployment.contract);
  await request(`/api/events/external-a/drafts/${draft.id}/execute`, {
    method: "POST",
    cookie,
    body: {},
    status: 409,
  });
  const outsider = ethers.Wallet.createRandom();
  const outsiderCookie = await login(outsider);
  const foreign = await request(
    `/api/events/external-a/drafts/${draft.id}/validate`,
    { method: "POST", cookie: outsiderCookie, body: {}, status: 409 },
  );
  assert.equal(foreign.data.code, "DRAFT_SCOPE");
  const provider = new ethers.JsonRpcProvider(rpcOrigin, undefined, {
    cacheTimeout: -1,
  });
  provider.pollingInterval = 20;
  let hash;
  try {
    const signer = externalWallet.connect(provider);
    const signed = await signer.signTransaction({
      ...draft.transaction,
      value: BigInt(draft.valueWei),
      gasLimit: 300_000,
      nonce: 0,
      gasPrice: await provider.send("eth_gasPrice", []),
    });
    const tx = await provider.broadcastTransaction(signed);
    hash = tx.hash;
    const receipt = await tx.wait();
    assert.equal(receipt.status, 1);
    assert.equal(Number(tx.chainId), 10200);
    await request(`/api/events/external-a/drafts/${draft.id}/submitted`, {
      method: "POST",
      cookie,
      body: { hash },
      status: 200,
    });
  } finally {
    provider.destroy();
  }
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  await app.close();
  app = null;
  await start();
  const anonymous = (await request("/api/bootstrap")).data;
  assert.equal(
    anonymous.session,
    null,
    "Restart does not revive an authenticated session",
  );
  const renewed = await login(externalWallet);
  const recovered = (
    await request("/api/events/external-a/submissions/reconcile", {
      method: "POST",
      cookie: renewed,
      body: { draftId: draft.id, hash },
    })
  ).data;
  assert.equal(recovered.status, "confirmed");
  assert.equal(recovered.hash, hash);
  const detail = (await request("/api/events/external-a", { cookie: renewed }))
    .data;
  assert.equal(detail.participants.length, 1);
  assert.equal(detail.participants[0].wallet, externalWallet.address);
  assert.equal(detail.participants[0].deposit.txHash, hash);
  assert.equal(detail.participants[0].deposit.verified, true);
  assert.equal(detail.participants[0].pendingCreditWei, draft.valueWei);
  assert.equal(detail.participants[0].registered, false);
  const other = (await request("/api/events/external-b", { cookie: renewed }))
    .data;
  assert.equal(other.state.balanceWei, "0");
  assert.equal(other.state.pendingTotalWei, "0");
  assert.equal(
    bridgeMethods.filter((method) => method === "eth_sendRawTransaction")
      .length,
    1,
    "Only the test's explicitly signed transaction was broadcast, once",
  );
  assert.ok(
    !bridgeMethods.some((method) =>
      /^(eth_accounts|eth_sendTransaction|evm_)/.test(method),
    ),
    "The external runtime has no unlocked account or synthetic time controls",
  );
});
