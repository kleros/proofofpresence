import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";
let app, base;
before(async () => {
  app = await startServer({ port: 0, rpcPort: 0 });
  base = app.url;
});
after(async () => {
  await app?.close();
});
test("HTTP import preview never applies rows before explicit reviewed single-use commit", async () => {
  const login = await post("/api/session", { identity: "organizer-a" }),
    cookie = login.headers.get("set-cookie").split(";")[0];
  const boot = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie } })
  ).json();
  assert.equal(typeof boot.instanceId, "string");
  const alice = boot.identities.find((p) => p.id === "alice");
  const csv = `event_id,participant_id,email,wallet,admission\nevent-a,event-a-alice,alice@example.test,${alice.wallet},approved\n`;
  const result = await post(
    "/api/events/event-a/imports/preview",
    { kind: "guests", csv },
    { cookie },
  );
  assert.equal(result.status, 200);
  const preview = await result.json();
  assert.equal(preview.originReviewRequired, true);
  assert.equal(preview.proposedRows.length, 1);
  let detail = await (
    await fetch(base + "/api/events/event-a", { headers: { cookie } })
  ).json();
  assert.equal(detail.imports.length, 0);
  assert.equal(
    detail.participants.find((p) => p.id === "event-a-alice").admission,
    "pending",
  );
  const missing = await post(
    `/api/events/event-a/imports/${preview.id}/commit`,
    {},
    { cookie },
  );
  assert.equal((await missing.json()).code, "PROVENANCE_REVIEW_REQUIRED");
  const review = {
    confirmed: true,
    note: "Reviewed the synthetic source event and raw export origin limitation.",
  };
  assert.equal(
    (
      await post(
        `/api/events/event-a/imports/${preview.id}/commit`,
        { review },
        { cookie },
      )
    ).status,
    201,
  );
  detail = await (
    await fetch(base + "/api/events/event-a", { headers: { cookie } })
  ).json();
  assert.equal(detail.imports.length, 1);
  assert.equal(
    detail.participants.find((p) => p.id === "event-a-alice").admission,
    "approved",
  );
  assert.equal(
    (
      await post(
        `/api/events/event-a/imports/${preview.id}/commit`,
        { review },
        { cookie },
      )
    ).status,
    409,
  );
});
test("local evidence upload preserves exact bytes and reports their SHA256 without a public pin", async () => {
  const login = await post("/api/session", { identity: "alice" }),
    cookie = login.headers.get("set-cookie").split(";")[0];
  const bytes = new Uint8Array([0, 255, 12, 24, 125, 10]);
  const form = new FormData();
  form.append("data", new Blob([bytes]), "synthetic-evidence.bin");
  const uploaded = await fetch(base + "/local-upload", {
    method: "POST",
    headers: { origin: base, cookie },
    body: form,
  });
  assert.equal(uploaded.status, 200);
  const stored = await uploaded.json();
  assert.equal(stored.status, "local-only");
  assert.equal(stored.sha256, createHash("sha256").update(bytes).digest("hex"));
  const retrieved = await fetch(base + "/local-ipfs" + stored.path);
  assert.deepEqual(new Uint8Array(await retrieved.arrayBuffer()), bytes);
});
async function post(path, payload, { cookie, origin = base } = {}) {
  return fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(payload),
  });
}
// Native HTTP preserves intentionally hostile Host headers; browser fetch/Undici may replace them.
async function rawRequest(
  path,
  { method = "GET", headers = {}, payload } = {},
) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      base + path,
      { method, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: Object.fromEntries(
                Object.entries(res.headers)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => [k, Array.isArray(v) ? v.join("; ") : v]),
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
test("local HTTP rejects cross-origin writes, spoofed hosts, RPC mutations and unauthenticated event actions", async () => {
  assert.equal(
    (
      await post(
        "/api/session",
        { identity: "alice" },
        { origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await rawRequest("/api/bootstrap", {
        headers: { host: "attacker.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await rawRequest("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        payload: { identity: "alice" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await rawRequest("/api/session", {
        method: "POST",
        headers: { origin: base, "content-type": "text/plain" },
        payload: { identity: "alice" },
      })
    ).status,
    415,
  );
  assert.equal(
    (await post("/rpc", { id: 1, method: "eth_sendTransaction", params: [] }))
      .status,
    403,
  );
  assert.equal(
    (await post("/api/events/event-a/drafts", { action: "deposit" })).status,
    401,
  );
  const bootstrap = await (await fetch(base + "/api/bootstrap")).json();
  assert.equal(bootstrap.session, null);
  assert.equal(bootstrap.mode, "local-demo");
  assert.equal(bootstrap.chain.chainId, 1337);
  assert.ok(
    bootstrap.identities.every(
      (x) => !Object.hasOwn(x, "signer") && !Object.hasOwn(x, "privateKey"),
    ),
  );
});
test("HTTP sessions rotate; owner-only details and participant rows stay event scoped", async () => {
  const ownerResponse = await post("/api/session", { identity: "organizer-a" });
  const ownerCookie = ownerResponse.headers.get("set-cookie").split(";")[0];
  assert.match(
    ownerResponse.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict/,
  );
  const detail = await (
    await fetch(base + "/api/events/event-a", {
      headers: { cookie: ownerCookie },
    })
  ).json();
  assert.equal(detail.participants.length, 3);
  const staffResponse = await post(
    "/api/session",
    { identity: "staff-a" },
    { cookie: ownerCookie },
  );
  const staffCookie = staffResponse.headers.get("set-cookie").split(";")[0];
  const rotated = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie: ownerCookie } })
  ).json();
  assert.equal(
    rotated.session,
    null,
    "old session invalidated on identity switch",
  );
  const b = await (
    await fetch(base + "/api/events/event-b", {
      headers: { cookie: staffCookie },
    })
  ).json();
  assert.equal(b.participants.length, 0, "Event A staff cannot see B contacts");
  assert.equal(
    (
      await post(
        "/api/events/event-b/checkins",
        {
          participantId: "event-b-alice",
          source: "staff-door",
          nonce: "nonce-123456",
        },
        { cookie: staffCookie },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/finance/event-b/console/", {
        headers: { cookie: staffCookie },
      })
    ).status,
    403,
  );
});
test("wallet authentication verifies domain-bound expiring signed nonce and rejects replay", async () => {
  const wallet = ethers.Wallet.createRandom();
  const challenge = await (
    await post("/api/auth/challenge", { wallet: wallet.address })
  ).json();
  assert.ok(challenge.message.includes(new URL(base).host));
  assert.ok(challenge.message.includes(`URI: ${base}`));
  assert.ok(challenge.message.includes("Chain ID: 1337"));
  const signature = await wallet.signMessage(challenge.message);
  const localhost = `localhost:${new URL(base).port}`;
  const wrongDomain = await rawRequest("/api/auth/verify", {
    method: "POST",
    headers: {
      host: localhost,
      origin: `http://${localhost}`,
      "content-type": "application/json",
    },
    payload: { nonce: challenge.nonce, signature },
  });
  assert.equal(wrongDomain.status, 403);
  assert.equal((await wrongDomain.json()).code, "BAD_NONCE");
  const verified = await post("/api/auth/verify", {
    nonce: challenge.nonce,
    signature,
  });
  assert.equal(verified.status, 200);
  const cookie = verified.headers.get("set-cookie").split(";")[0];
  const session = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie } })
  ).json();
  assert.equal(session.session.wallet, wallet.address);
  assert.equal(session.session.mode, "wallet");
  const victim = session.identities.find((x) => x.id === "organizer-a").wallet;
  const joined = await post(
    "/api/events/event-a/participants",
    {
      name: "Synthetic wallet guest",
      email: "wallet@example.invalid",
      wallet: victim,
    },
    { cookie },
  );
  assert.equal(joined.status, 201);
  assert.equal(
    (await joined.json()).wallet,
    wallet.address,
    "server binds signed wallet identity rather than a pasted address",
  );
  assert.equal(
    (await post("/api/auth/verify", { nonce: challenge.nonce, signature }))
      .status,
    403,
  );
  const invalid = await (
    await post("/api/auth/challenge", { wallet: wallet.address })
  ).json();
  assert.equal(
    (
      await post("/api/auth/verify", {
        nonce: invalid.nonce,
        signature: await ethers.Wallet.createRandom().signMessage(
          invalid.message,
        ),
      })
    ).status,
    403,
  );
});
test("logging into the same demo wallet creates a new signing context and invalidates an earlier draft", async () => {
  const first = await post("/api/session", { identity: "alice" }),
    firstCookie = first.headers.get("set-cookie").split(";")[0];
  const draft = await (
    await post(
      "/api/events/event-a/drafts",
      { action: "deposit" },
      { cookie: firstCookie },
    )
  ).json();
  assert.ok(draft.id);
  const second = await post(
      "/api/session",
      { identity: "alice" },
      { cookie: firstCookie },
    ),
    secondCookie = second.headers.get("set-cookie").split(";")[0];
  const result = await post(
    `/api/events/event-a/drafts/${draft.id}/execute`,
    {},
    { cookie: secondCookie },
  );
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, "DRAFT_SCOPE");
});
test("legacy local modules contain only selected event and loopback RPC/upload configuration", async () => {
  const login = await post("/api/session", { identity: "organizer-a" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const html = await (
    await fetch(base + "/finance/event-a/guest/", { headers: { cookie } })
  ).text();
  const cfg = JSON.parse(html.match(/const CONFIG = (\{[\s\S]*?\});/)[1]);
  const a = await (
    await fetch(base + "/api/events/event-a", { headers: { cookie } })
  ).json();
  assert.equal(cfg.contract, a.event.contract);
  assert.equal(cfg.chainId, 1337);
  assert.ok(new URL(cfg.rpc).hostname === "127.0.0.1");
  assert.ok(new URL(cfg.ipfsUpload, base).hostname === "127.0.0.1");
  const guestScript = [
    ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
  ]
    .map((x) => x[1])
    .join("\n");
  assert.doesNotThrow(
    () => new vm.Script(guestScript),
    "generated local guest script remains valid",
  );
  assert.match(
    guestScript,
    /eth_getBlockByNumber/,
    "financial eligibility follows local chain time",
  );
  const financialConfig = await (
    await fetch(base + "/finance/event-a/console/config.json", {
      headers: { cookie },
    })
  ).json();
  const deployment = app.workbench.events.get("event-a").deployment;
  assert.equal(
    Date.parse(financialConfig.depositOpensAt) / 1000,
    deployment.depositOpensAt,
  );
  assert.equal(
    Date.parse(financialConfig.depositDeadline) / 1000,
    deployment.depositDeadline,
  );
  const console = await (
    await fetch(base + "/finance/event-a/console/", { headers: { cookie } })
  ).text();
  assert.match(console, /\/finance\/event-a\/console\/config.json/);
  const consoleScript = [
    ...console.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
  ]
    .map((x) => x[1])
    .join("\n");
  assert.doesNotThrow(
    () => new vm.Script(consoleScript),
    "generated local console script remains valid",
  );
  assert.match(
    consoleScript,
    /await rp.getBlock\("latest"\)/,
    "local console eligibility follows chain time",
  );
  const settings = await (
    await fetch(base + "/finance/event-a/console/settings.json", {
      headers: { cookie },
    })
  ).json();
  assert.equal(settings.chainId, 1337);
  assert.ok(new URL(settings.kleros.ipfsUpload, base).hostname === "127.0.0.1");
});
test("private event HTTP routes exclude outsiders while retaining creator access", async () => {
  const owner = await post("/api/session", { identity: "organizer-a" });
  const cookie = owner.headers.get("set-cookie").split(";")[0];
  const boot = await (await fetch(base + "/api/bootstrap")).json(),
    now = Number(boot.now);
  const created = await post(
    "/api/events",
    {
      title: "Private HTTP fixture",
      slug: "http-private-fixture",
      description: "Private synthetic local event",
      location: "Synthetic venue",
      visibility: "private",
      startsAt: new Date((now + 3600) * 1000).toISOString(),
      endsAt: new Date((now + 7200) * 1000).toISOString(),
      timezone: "Asia/Bangkok",
      depositEth: "0.01",
    },
    { cookie },
  );
  assert.equal(created.status, 201);
  const event = await created.json();
  assert.equal(
    (await fetch(base + `/api/events/${event.id}`, { headers: { cookie } }))
      .status,
    200,
  );
  assert.equal((await fetch(base + `/api/events/${event.id}`)).status, 403);
  const catalogue = await (await fetch(base + "/api/bootstrap")).json();
  assert.ok(!catalogue.events.some((x) => x.id === event.id));
});
test("concurrent local servers cannot overwrite each other’s generated financial configuration", async () => {
  const first = await (await fetch(base + "/finance/event-a/guest/")).text();
  const firstConfig = JSON.parse(
    first.match(/const CONFIG = (\{[\s\S]*?\});/)[1],
  );
  const ownBootstrap = await (await fetch(base + "/api/bootstrap")).json();
  assert.equal(firstConfig.rpc, ownBootstrap.chain.rpcUrl);
  const other = await startServer({ port: 0, rpcPort: 0 });
  try {
    const second = await (
      await fetch(other.url + "/finance/event-a/guest/")
    ).text();
    const secondConfig = JSON.parse(
      second.match(/const CONFIG = (\{[\s\S]*?\});/)[1],
    );
    const otherBootstrap = await (
      await fetch(other.url + "/api/bootstrap")
    ).json();
    assert.equal(secondConfig.rpc, otherBootstrap.chain.rpcUrl);
    assert.notEqual(secondConfig.rpc, firstConfig.rpc);
    const reread = await (await fetch(base + "/finance/event-a/guest/")).text();
    const again = JSON.parse(reread.match(/const CONFIG = (\{[\s\S]*?\});/)[1]);
    assert.equal(
      again.rpc,
      firstConfig.rpc,
      "the first server must continue serving its own environment after the second server renders",
    );
  } finally {
    await other.close();
  }
});

test("editorial draft privacy preserves existing participants' financial recovery access", async () => {
  const owner = await post("/api/session", { identity: "organizer-a" });
  const ownerCookie = owner.headers.get("set-cookie").split(";")[0];
  const alice = await post("/api/session", { identity: "alice" });
  const aliceCookie = alice.headers.get("set-cookie").split(";")[0];
  const outsider = await post("/api/session", { identity: "organizer-b" });
  const otherCookie = outsider.headers.get("set-cookie").split(";")[0];
  const update = (editorialStatus) =>
    fetch(base + "/api/events/event-a", {
      method: "PATCH",
      headers: {
        origin: base,
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      body: JSON.stringify({ editorialStatus }),
    });
  assert.equal((await update("draft")).status, 200);
  try {
    assert.equal((await fetch(base + "/api/events/event-a")).status, 403);
    assert.equal(
      (
        await fetch(base + "/api/events/event-a", {
          headers: { cookie: otherCookie },
        })
      ).status,
      403,
    );
    const catalogue = await (await fetch(base + "/api/bootstrap")).json();
    assert.ok(!catalogue.events.some((x) => x.id === "event-a"));
    const participant = await fetch(base + "/api/events/event-a", {
      headers: { cookie: aliceCookie },
    });
    assert.equal(participant.status, 200);
    const data = await participant.json();
    assert.equal(data.participants.length, 1);
    assert.equal(
      data.participants[0].wallet.toLowerCase(),
      (await app.workbench.bootstrap()).identities
        .find((x) => x.id === "alice")
        .wallet.toLowerCase(),
    );
    assert.equal(
      (
        await fetch(base + "/api/events/event-a", {
          headers: { cookie: ownerCookie },
        })
      ).status,
      200,
    );
  } finally {
    assert.equal((await update("published")).status, 200);
  }
});
