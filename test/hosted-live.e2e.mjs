import { chromium, expect } from "@playwright/test";
import { ethers } from "ethers";
import { randomUUID } from "node:crypto";

// LIVE ACCEPTANCE, intentionally outside the default Node test glob.
// Run explicitly only after the interactive sandbox has been deployed:
// HOSTED_DEMO_URL=https://kleros-event-workbench-preview.netlify.app node test/hosted-live.e2e.mjs
// This uses only synthetic identities and valueless chain1337 ETH. It never resets the
// shared backend or retries a financial submission. A consumed seed requires a fresh
// backend prepared separately by its operator. No credentials or private keys are loaded.

const ALLOWED_ORIGIN = "https://kleros-event-workbench-preview.netlify.app";
const A_AMOUNT = 10n ** 16n;
const B_AMOUNT = 2n * A_AMOUNT;
const checks = [];
const observedHashes = [];
const externalRequests = [];
const browserErrors = [];
const assetErrors = [];
const executions = [];
const walletRequests = [];
let stage = "configuration";
let origin, browser, provider, initialBootstrap;
let allowedBroadcastWallet = null;
let allowedBroadcastTarget = null;
let broadcastAttempts = 0;
let walletCookie = "";

class AcceptanceFailure extends Error {}
function ensure(condition, label) {
  if (!condition) throw new AcceptanceFailure(label);
  checks.push(label);
}
function fresh(condition, label) {
  if (!condition)
    throw new AcceptanceFailure(
      `Fresh hosted backend required: ${label}. No reset or automatic replay was attempted.`,
    );
  checks.push(label);
}
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const isHash = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? "");
const eventPath = (eventId, tail = "") => `/api/events/${eventId}${tail}`;

function target(path) {
  const url = new URL(path, origin);
  ensure(
    url.origin === origin && !url.username && !url.password,
    "Every request remains on the authorized HTTPS demo origin",
  );
  return url.href;
}
async function safeFetch(path, options = {}) {
  return fetch(target(path), {
    ...options,
    redirect: "error",
    credentials: "omit",
    signal: options.signal ?? AbortSignal.timeout(45_000),
  });
}
async function api(
  path,
  { method = "GET", payload, cookie = "", expectedStatus } = {},
) {
  ensure(
    path.startsWith("/api/"),
    "API helper accepts only application routes",
  );
  const response = await safeFetch(path, {
    method,
    headers: {
      accept: "application/json",
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  ensure(
    expectedStatus === undefined
      ? response.ok
      : response.status === expectedStatus,
    `Application response has the expected HTTP status for ${method} ${path.replace(/drafts\/[^/]+/, "drafts/[review]")}`,
  );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AcceptanceFailure(
      "The hosted API must return authoritative JSON, not a static fallback page",
    );
  }
  return { data, response };
}
async function rpc(method, params = []) {
  const response = await safeFetch("/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  ensure(response.ok, "The same-origin sandbox RPC responds successfully");
  const result = await response.json();
  ensure(
    !result.error && Object.hasOwn(result, "result"),
    "Sandbox RPC returns a result rather than a synthetic fallback",
  );
  return result.result;
}
async function assertInstance(cookie = "") {
  const { data } = await api("/api/bootstrap", { cookie });
  ensure(
    data.mode === "hosted-demo",
    "Bootstrap identifies the interactive hosted demo",
  );
  ensure(
    data.chain?.chainId === 1337 && data.chain.rpcUrl === origin + "/rpc",
    "Bootstrap uses only same-origin valueless chain1337",
  );
  ensure(
    typeof data.instanceId === "string" && data.instanceId.length > 8,
    "Backend exposes a server instance identity",
  );
  const marker = data.chain.instanceMarker;
  ensure(
    Number.isSafeInteger(marker?.blockNumber) &&
      marker.blockNumber >= 0 &&
      isHash(marker?.blockHash),
    "Hosted instance marker is present and well formed",
  );
  ensure(
    data.capabilities?.sharedDemo === true &&
      data.capabilities?.browserWallet === true,
    "Hosted capabilities enable the shared interactive demo",
  );
  if (initialBootstrap) {
    ensure(
      data.instanceId === initialBootstrap.instanceId,
      "Backend did not reset during acceptance",
    );
    ensure(
      marker.blockNumber ===
        initialBootstrap.chain.instanceMarker.blockNumber &&
        same(marker.blockHash, initialBootstrap.chain.instanceMarker.blockHash),
      "Sandbox instance marker did not change during acceptance",
    );
  }
  ensure(
    BigInt(await rpc("eth_chainId")) === 1337n,
    "Public RPC reports sandbox chain1337 before any financial action",
  );
  const block = await rpc("eth_getBlockByNumber", [
    ethers.toQuantity(marker.blockNumber),
    false,
  ]);
  ensure(
    block && same(block.hash, marker.blockHash),
    "Public RPC block hash matches this exact hosted instance",
  );
  return data;
}
async function receiptProof(hash, from, to, value) {
  ensure(isHash(hash), "A confirmed action exposes a transaction hash");
  const receipt = await provider.waitForTransaction(hash, 1, 60_000);
  ensure(
    receipt?.status === 1 && same(receipt.from, from) && same(receipt.to, to),
    "Successful receipt matches the reviewed sender and event contract",
  );
  const canonical = await provider.getBlock(receipt.blockNumber);
  ensure(
    canonical && same(canonical.hash, receipt.blockHash),
    "Transaction receipt belongs to a canonical sandbox block",
  );
  const transaction = await provider.getTransaction(hash);
  ensure(
    transaction?.chainId === 1337n && transaction.value === value,
    "Canonical transaction uses the exact reviewed sandbox value",
  );
  return receipt;
}

try {
  const configured = process.env.HOSTED_DEMO_URL;
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {}
  ensure(
    configured === ALLOWED_ORIGIN &&
      parsed?.origin === ALLOWED_ORIGIN &&
      parsed.protocol === "https:" &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      !parsed.username &&
      !parsed.password,
    "Set HOSTED_DEMO_URL to the exact authorized HTTPS Netlify demo origin",
  );
  origin = parsed.origin;
  stage = "read-only environment and fresh-seed preflight";
  initialBootstrap = await assertInstance();
  ensure(
    initialBootstrap.session === null,
    "Native acceptance begins without an ambient authenticated session",
  );
  fresh(
    initialBootstrap.events?.length === 2 &&
      ["event-a", "event-b"].every((id) =>
        initialBootstrap.events.some((event) => event.id === id),
      ),
    "Only the two untouched seed events are present",
  );
  const eventA = initialBootstrap.events.find(
    (event) => event.id === "event-a",
  );
  const eventB = initialBootstrap.events.find(
    (event) => event.id === "event-b",
  );
  ensure(
    ethers.isAddress(eventA.contract) &&
      ethers.isAddress(eventB.contract) &&
      !same(eventA.contract, eventB.contract),
    "Concurrent seed events have independent trusted contracts",
  );
  ensure(
    BigInt(eventA.depositWei) === A_AMOUNT &&
      BigInt(eventB.depositWei) === B_AMOUNT,
    "Seed deposits retain their distinct exact wei values",
  );
  for (const event of [eventA, eventB]) {
    const { data } = await api(eventPath(event.id));
    fresh(
      data.state.phase === "Open" &&
        data.state.stakerCount === 0 &&
        BigInt(data.state.balanceWei) === 0n &&
        BigInt(data.state.poolWei) === 0n &&
        data.state.cases.length === 0,
      `${event.id} has no prior commitment, registration or case`,
    );
    fresh(
      data.now < Date.parse(event.startsAt) / 1000,
      `${event.id} is still inside its initial deposit window`,
    );
  }

  // Ethers is restricted to one same-origin transport. Redirects are never followed,
  // and a second raw-transaction broadcast is rejected before reaching the network.
  const transport = new ethers.FetchRequest(origin + "/rpc");
  transport.timeout = 45_000;
  transport.getUrlFunc = async (request, cancellation) => {
    ensure(
      request.url === origin + "/rpc",
      "Ethers cannot change its RPC origin or path",
    );
    cancellation?.checkSignal();
    const controller = new AbortController();
    cancellation?.addListener(() => controller.abort());
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(request.body));
    } catch {
      throw new AcceptanceFailure("RPC transport requires a JSON payload");
    }
    for (const call of Array.isArray(payload) ? payload : [payload]) {
      if (call.method !== "eth_sendRawTransaction") continue;
      await assertInstance(walletCookie);
      ensure(
        broadcastAttempts === 0,
        "No financial transaction may be rebroadcast automatically",
      );
      const signed = ethers.Transaction.from(call.params?.[0]);
      ensure(
        signed.isSigned() &&
          signed.chainId === 1337n &&
          same(signed.from, allowedBroadcastWallet) &&
          same(signed.to, allowedBroadcastTarget) &&
          signed.value === A_AMOUNT &&
          signed.data === ethers.id("deposit()").slice(0, 10) &&
          signed.nonce === 0 &&
          signed.gasLimit === 300_000n,
        "Signed wallet bytes match only the approved synthetic deposit on this sandbox",
      );
      broadcastAttempts++;
    }
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.set("origin", origin);
    headers.delete("cookie");
    headers.delete("authorization");
    const result = await safeFetch("/rpc", {
      method: request.method,
      headers,
      body: request.body,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
    });
    ensure(
      result.ok,
      "Wallet RPC transport succeeds without redirect or fallback",
    );
    return {
      statusCode: result.status,
      statusMessage: result.statusText,
      headers: Object.fromEntries(result.headers),
      body: new Uint8Array(await result.arrayBuffer()),
    };
  };
  provider = new ethers.JsonRpcProvider(transport, 1337, {
    staticNetwork: true,
    cacheTimeout: -1,
    batchMaxCount: 1,
  });
  provider.pollingInterval = 1_000;

  stage = "browser participant and organizer acceptance";
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: false,
    serviceWorkers: "block",
  });
  context.setDefaultTimeout(30_000);
  context.setDefaultNavigationTimeout(60_000);
  await context.exposeFunction("__recordUnexpectedWallet", (method) =>
    walletRequests.push(method),
  );
  await context.addInitScript(() => {
    window.__hostedAcceptanceWalletRequests = [];
    window.ethereum = {
      request: async ({ method }) => {
        window.__hostedAcceptanceWalletRequests.push(method);
        await window.__recordUnexpectedWallet(method);
        throw new Error(
          "This browser scenario uses synthetic demo accounts; the independent EOA path is separate",
        );
      },
      on: () => {},
    };
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      externalRequests.push(url.origin);
      return route.abort("blockedbyclient");
    }
    if (
      route.request().method() === "POST" &&
      /^\/api\/events\/[^/]+\/drafts\/[^/]+\/execute$/.test(url.pathname)
    )
      executions.push(url.pathname);
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", () => browserErrors.push("uncaught browser error"));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      ["script", "stylesheet", "font", "image"].includes(
        response.request().resourceType(),
      )
    )
      assetErrors.push(response.status());
  });
  const pageApi = async (
    path,
    { method = "GET", payload, expectedStatus = 200 } = {},
  ) => {
    const response = await page.request.fetch(target(path), {
      method,
      ...(payload !== undefined ? { data: payload } : {}),
      headers:
        method === "GET" ? {} : { origin, "content-type": "application/json" },
      timeout: 45_000,
      maxRedirects: 0,
    });
    ensure(
      response.status() === expectedStatus,
      `Browser API has expected status for ${method} ${path}`,
    );
    return response.json();
  };
  const navigate = async (eventId, view = "participant") => {
    await page.goto(
      target(`/#${new URLSearchParams({ event: eventId, view })}`),
    );
    await expect(page.locator("#content")).toBeVisible();
    await expect(page.locator("#event-switch")).toHaveValue(eventId);
    await expect(page.locator("#hosted-demo-banner")).toBeVisible();
    await expect(page.locator("#hosted-demo-banner")).toContainText(
      /valueless ETH.*mock Court/i,
    );
  };
  const identity = async (id) => {
    const expected = initialBootstrap.identities.find(
      (person) => person.id === id,
    );
    ensure(
      Boolean(expected),
      "Only a known synthetic identity can be selected",
    );
    await page.locator("#identity-select").selectOption(id);
    await expect(page.locator("#top-identity")).toHaveText(expected.label);
    await expect
      .poll(async () => (await pageApi("/api/bootstrap")).session?.wallet)
      .toBe(expected.wallet);
  };
  const executeReview = async (eventId, action, amount) => {
    await assertInstance();
    await page.locator(`[data-tx="${action}"]`).first().click();
    await expect(page.locator("#review-dialog")).toBeVisible();
    await expect(page.locator("#dialog-body")).toContainText(`${amount} wei`);
    await expect(page.locator("#dialog-body")).toContainText(
      eventId === "event-a" ? eventA.contract : eventB.contract,
    );
    await expect(page.locator("#dialog-body")).toContainText("1337");
    const confirmed = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.origin === origin &&
          url.pathname.startsWith(eventPath(eventId, "/drafts/")) &&
          url.pathname.endsWith("/execute") &&
          response.request().method() === "POST"
        );
      },
      { timeout: 60_000 },
    );
    await page.locator("[data-execute]").click();
    const response = await confirmed;
    ensure(
      response.status() === 200,
      "Reviewed browser transaction is confirmed by the hosted backend",
    );
    const data = await response.json();
    ensure(
      data.status === "confirmed" && isHash(data.hash),
      "Browser transaction exposes an actual confirmed receipt reference",
    );
    observedHashes.push(data.hash);
    await expect(page.locator("#review-dialog")).not.toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("#toast")).toContainText("Confirmed");
    return data.hash;
  };

  await navigate("event-a");
  await identity("alice");
  for (const eventId of ["event-a", "event-b"]) {
    const detail = await pageApi(eventPath(eventId));
    const alice = detail.participants.find(
      (person) => person.id === `${eventId}-alice`,
    );
    fresh(
      alice?.deposit === null &&
        alice.registered === false &&
        alice.admission === "pending",
      `${eventId} Alice identity remains untouched`,
    );
  }
  const aliceWallet = initialBootstrap.identities.find(
    (person) => person.id === "alice",
  ).wallet;
  stage = "browser Event A reviewed deposit";
  const aliceAHash = await executeReview("event-a", "deposit", A_AMOUNT);
  await receiptProof(aliceAHash, aliceWallet, eventA.contract, A_AMOUNT);
  let a = await pageApi(eventPath("event-a"));
  ensure(
    a.participants[0].deposit?.verified === true &&
      same(a.participants[0].deposit.txHash, aliceAHash) &&
      a.participants[0].registered === false,
    "Alice A deposit is verified and does not automatically register her",
  );
  let b = await pageApi(eventPath("event-b"));
  ensure(
    BigInt(b.state.balanceWei) === 0n && BigInt(b.state.poolWei) === 0n,
    "Event A deposit leaves Event B balance and pool untouched",
  );

  stage = "browser Event B reviewed deposit";
  await navigate("event-b");
  const aliceBHash = await executeReview("event-b", "deposit", B_AMOUNT);
  await receiptProof(aliceBHash, aliceWallet, eventB.contract, B_AMOUNT);
  b = await pageApi(eventPath("event-b"));
  a = await pageApi(eventPath("event-a"));
  ensure(
    BigInt(b.state.balanceWei) === B_AMOUNT &&
      BigInt(b.state.poolWei) === 0n &&
      b.state.stakerCount === 0,
    "Event B holds only its independent unregistered 0.02 ETH commitment",
  );
  ensure(
    BigInt(a.state.balanceWei) === A_AMOUNT && BigInt(a.state.poolWei) === 0n,
    "Event B deposit leaves Event A accounting independent",
  );

  stage = "browser owner A curated admission and registration";
  await identity("organizer-a");
  await navigate("event-a", "organizer");
  await page
    .locator('[data-admission="event-a-alice"]')
    .selectOption("approved");
  await expect
    .poll(
      async () =>
        (await pageApi(eventPath("event-a"))).participants.find(
          (person) => person.id === "event-a-alice",
        )?.admission,
    )
    .toBe("approved");
  const registrationHash = await executeReview("event-a", "register", 0n);
  const ownerAWallet = initialBootstrap.identities.find(
    (person) => person.id === "organizer-a",
  ).wallet;
  await receiptProof(registrationHash, ownerAWallet, eventA.contract, 0n);
  a = await pageApi(eventPath("event-a"));
  b = await pageApi(eventPath("event-b"));
  ensure(
    a.state.stakerCount === 1 &&
      BigInt(a.state.poolWei) === A_AMOUNT &&
      a.participants.find((person) => person.id === "event-a-alice")
        ?.registered === true,
    "Owner A registers only Alice's approved verified Event A commitment",
  );
  ensure(
    b.state.stakerCount === 0 &&
      BigInt(b.state.poolWei) === 0n &&
      BigInt(b.state.balanceWei) === B_AMOUNT &&
      b.state.cases.length === 0,
    "Owner A registration leaves Event B's pool at zero and its commitment untouched",
  );
  const denied = await pageApi(eventPath("event-b", "/drafts"), {
    method: "POST",
    payload: { action: "register", params: {} },
    expectedStatus: 403,
  });
  ensure(
    denied.code === "NOT_OWNER",
    "Event A organizer cannot prepare Event B's owner transaction",
  );
  const browserCookie = (await context.cookies(origin)).find(
    (cookie) => cookie.name === "kleros_session",
  );
  ensure(
    browserCookie?.secure === true && browserCookie.httpOnly === true,
    "Browser demo session cookie remains Secure and HttpOnly on real TLS",
  );

  stage = "independent memory-only EOA authentication";
  await assertInstance();
  const wallet = ethers.Wallet.createRandom().connect(provider);
  allowedBroadcastWallet = wallet.address;
  allowedBroadcastTarget = eventA.contract;
  ensure(
    (await provider.getBalance(wallet.address)) === 0n &&
      (await provider.getTransactionCount(wallet.address, "pending")) === 0,
    "Random synthetic wallet has no prior sandbox balance or nonce",
  );
  const { data: challenge } = await api("/api/auth/challenge", {
    method: "POST",
    payload: { wallet: wallet.address },
  });
  ensure(
    typeof challenge.message === "string" &&
      challenge.message.includes(`Domain: ${new URL(origin).host}\n`) &&
      challenge.message.includes(`URI: ${origin}\n`) &&
      challenge.message.includes("Chain ID: 1337") &&
      challenge.message.includes(wallet.address) &&
      challenge.message.includes("No financial transaction."),
    "EOA signs only this hosted sandbox's domain-bound authentication message",
  );
  const signature = await wallet.signMessage(challenge.message);
  const authentication = await api("/api/auth/verify", {
    method: "POST",
    payload: { nonce: challenge.nonce, signature },
  });
  ensure(
    same(authentication.data.wallet, wallet.address) &&
      authentication.data.mode === "wallet",
    "Real EOA nonce signature authenticates its own wallet",
  );
  const cookies = authentication.response.headers.getSetCookie?.() ?? [
    authentication.response.headers.get("set-cookie"),
  ];
  const sessionCookie = cookies.find((cookie) =>
    /^kleros_session=/.test(cookie ?? ""),
  );
  ensure(
    Boolean(sessionCookie) &&
      /;\s*Secure(?:;|$)/i.test(sessionCookie) &&
      /;\s*HttpOnly(?:;|$)/i.test(sessionCookie) &&
      /;\s*SameSite=Strict(?:;|$)/i.test(sessionCookie),
    "EOA authentication sets a real Secure HttpOnly Strict cookie",
  );
  walletCookie = sessionCookie.split(";")[0];
  const qaEmail = `qa-${randomUUID()}@example.test`;
  await api(eventPath("event-a", "/participants"), {
    method: "POST",
    cookie: walletCookie,
    expectedStatus: 201,
    payload: { name: "Hosted QA synthetic wallet", email: qaEmail },
  });

  stage = "explicit 1 ETH valueless sandbox funding";
  await assertInstance(walletCookie);
  const { data: funding } = await api("/api/demo/fund", {
    method: "POST",
    cookie: walletCookie,
    payload: {},
  });
  ensure(
    BigInt(funding.amountWei) === ethers.parseEther("1") &&
      isHash(funding.hash),
    "Explicit funding supplies exactly one valueless sandbox ETH",
  );
  observedHashes.push(funding.hash);
  const fundingReceipt = await provider.waitForTransaction(
    funding.hash,
    1,
    60_000,
  );
  ensure(
    fundingReceipt?.status === 1 &&
      same(fundingReceipt.to, wallet.address) &&
      (await provider.getBalance(wallet.address)) === ethers.parseEther("1"),
    "Sandbox funding is backed by a successful actual chain receipt",
  );

  stage = "EOA exact reviewed deposit and one signed public-RPC broadcast";
  const { data: draft } = await api(eventPath("event-a", "/drafts"), {
    method: "POST",
    cookie: walletCookie,
    expectedStatus: 201,
    payload: { action: "deposit", params: {} },
  });
  ensure(
    draft.eventId === "event-a" &&
      same(draft.wallet, wallet.address) &&
      same(draft.contract, eventA.contract) &&
      draft.chainId === 1337 &&
      BigInt(draft.valueWei) === A_AMOUNT,
    "Wallet draft binds its own event, wallet, sandbox and exact deposit",
  );
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  ensure(nonce === 0, "Fresh synthetic EOA still has its initial nonce");
  const gasPrice = BigInt(await provider.send("eth_gasPrice", []));
  await assertInstance(walletCookie);
  const { data: transaction } = await api(
    eventPath("event-a", `/drafts/${draft.id}/validate`),
    { method: "POST", cookie: walletCookie, payload: {} },
  );
  ensure(
    transaction.chainId === 1337 &&
      same(transaction.to, eventA.contract) &&
      same(transaction.from, wallet.address) &&
      BigInt(transaction.value) === A_AMOUNT &&
      transaction.data === ethers.id("deposit()").slice(0, 10),
    "Fresh server validation returns exactly the intended deposit transaction",
  );
  const sent = await wallet.sendTransaction({
    ...transaction,
    type: 0,
    nonce,
    gasLimit: 300_000n,
    gasPrice,
  });
  ensure(
    isHash(sent.hash),
    "Public sandbox RPC accepts one real signed EOA transaction",
  );
  observedHashes.push(sent.hash);
  await api(eventPath("event-a", `/drafts/${draft.id}/submitted`), {
    method: "POST",
    cookie: walletCookie,
    payload: { hash: sent.hash },
  });
  await receiptProof(sent.hash, wallet.address, eventA.contract, A_AMOUNT);
  const { data: reconciled } = await api(
    eventPath("event-a", "/submissions/reconcile"),
    {
      method: "POST",
      cookie: walletCookie,
      payload: { draftId: draft.id, hash: sent.hash },
    },
  );
  ensure(
    reconciled.status === "confirmed" && same(reconciled.hash, sent.hash),
    "Submitted-reference reconciliation confirms the canonical signed transaction",
  );
  const { data: walletDetail } = await api(eventPath("event-a"), {
    cookie: walletCookie,
  });
  const linked = walletDetail.participants.find((person) =>
    same(person.wallet, wallet.address),
  );
  ensure(
    linked?.deposit?.verified === true &&
      same(linked.deposit.txHash, sent.hash) &&
      linked.registered === false &&
      linked.admission === "pending",
    "EOA receipt is verified while admission and staker registration remain pending",
  );
  const { data: independentB } = await api(eventPath("event-b"), {
    cookie: walletCookie,
  });
  ensure(
    independentB.state.stakerCount === 0 &&
      BigInt(independentB.state.poolWei) === 0n &&
      BigInt(independentB.state.balanceWei) === B_AMOUNT,
    "Independent EOA execution in A has no financial effect on B",
  );
  ensure(
    broadcastAttempts === 1 && executions.length === 3,
    "Acceptance sends each reviewed financial operation once without automatic replay",
  );

  stage = "mobile and final isolation verification";
  await assertInstance(walletCookie);
  await page.setViewportSize({ width: 400, height: 800 });
  await navigate("event-a", "organizer");
  await expect(page.locator("#hosted-demo-banner")).toContainText(
    "state resets on server restart",
  );
  ensure(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Hosted organizer flow has no mobile horizontal overflow",
  );
  ensure(
    walletRequests.length === 0,
    "Browser demo-identity acceptance never accesses a personal browser wallet across reloads",
  );
  ensure(
    externalRequests.length === 0 &&
      browserErrors.length === 0 &&
      assetErrors.length === 0,
    "Browser loads only the authorized origin without asset or runtime failures",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        origin,
        mode: "hosted-demo",
        chainId: 1337,
        instanceId: initialBootstrap.instanceId,
        assertions: checks.length,
        observedTransactionHashes: observedHashes,
        notice:
          "Synthetic demo only; no reset, automatic rebroadcast, private-key persistence or other origin was used.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  // Never print original transport/signing errors: ethers may embed signed bytes in them.
  console.error(
    JSON.stringify(
      {
        status: "failed",
        stage,
        error:
          error instanceof AcceptanceFailure
            ? error.message
            : "Live acceptance stopped; transport/browser/signing diagnostics were redacted. Do not replay financial actions automatically.",
        observedTransactionHashes: observedHashes,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  walletCookie = "";
  try {
    await browser?.close();
  } catch {}
  try {
    provider?.destroy();
  } catch {}
}
