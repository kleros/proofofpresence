import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect as baseExpect } from "@playwright/test";
import { ethers } from "ethers";

// MANUAL LIVE ACCEPTANCE. Run only after the operator has switched and verified
// the public site in hosted-testnet mode:
// TESTNET_APP_URL=https://kleros-event-workbench-preview.netlify.app node test/testnet-live.e2e.mjs
// This script NEVER signs or broadcasts a contract transaction. It proves wallet
// login, creates synthetic off-chain registration, links existing canonical
// rehearsal receipts, and may approve Alice's off-chain admission in Event A.
// All five disposable keys stay in Node memory; no key enters a browser or output.

const ALLOWED_ORIGIN = "https://kleros-event-workbench-preview.netlify.app";
const expect = baseExpect.configure({ timeout: 60_000 });
const root = fileURLToPath(new URL("../", import.meta.url));
const manifestFile = path.join(root, "registry/chiado-v8-controlled.json");
const roleFile = path.join(root, ".runtime/testnet/chiado-deployer.json");
const journalFile = path.join(
  root,
  ".runtime/testnet/chiado-rehearsal-journal.json",
);
const screenshots = path.join(root, "artifacts/screenshots/testnet-live");
const checks = [],
  coverage = [],
  limitations = [],
  walletMethods = [];
const networkFailures = [],
  assetFailures = [],
  browserFailures = [];
const linkedReceipts = [];
let stage = "configuration",
  origin,
  browser,
  manifest,
  journal,
  initialBootstrap;
let walletRoles = {};
let navigationSequence = 0;
const contexts = [];
class AcceptanceFailure extends Error {}
function ensure(condition, label) {
  if (!condition) throw new AcceptanceFailure(label);
  checks.push(label);
}
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const isHash = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? "");
const eventPath = (eventId, suffix = "") =>
  `/api/events/${encodeURIComponent(eventId)}${suffix}`;
function target(relative) {
  const url = new URL(relative, origin);
  ensure(
    url.origin === origin && !url.username && !url.password,
    "Application requests stay on the explicitly authorized HTTPS origin",
  );
  return url.href;
}
async function publicFetch(relative, options = {}) {
  return fetch(target(relative), {
    ...options,
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(60_000),
  });
}
async function rpc(method, params = []) {
  ensure(
    [
      "eth_chainId",
      "eth_getTransactionReceipt",
      "eth_getTransactionByHash",
      "eth_getBlockByNumber",
    ].includes(method),
    "The acceptance RPC helper permits only explicit read methods",
  );
  const response = await publicFetch("/rpc", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  ensure(response.ok, "The public read-only testnet RPC responds");
  const result = await response.json();
  ensure(
    !result.error && Object.hasOwn(result, "result"),
    "Testnet RPC returns an authoritative result",
  );
  return result.result;
}
async function bootstrap() {
  const response = await publicFetch("/api/bootstrap");
  ensure(response.ok, "The published bootstrap route is healthy");
  const data = await response.json();
  ensure(
    data.mode === "hosted-testnet" && data.chain?.chainId === 10200,
    "The public application is hosted-testnet on Chiado10200",
  );
  ensure(
    data.chain.nativeCurrency?.symbol === "XDAI" &&
      data.chain.nativeCurrency.decimals === 18 &&
      data.chain.rpcUrl === manifest.chain.rpcUrl,
    "Published network and native XDAI metadata match the verified manifest",
  );
  ensure(
    data.arbitration?.mode === "controlled" &&
      /controlled|no independent jury/i.test(data.arbitration.notice ?? ""),
    "Bootstrap explicitly identifies controlled test arbitration",
  );
  ensure(
    Array.isArray(data.identities) &&
      data.identities.length === 0 &&
      data.capabilities?.sharedDemo === false &&
      data.capabilities?.timeControls === false &&
      data.capabilities?.createEvents === false,
    "Public testnet exposes no demo impersonation, time travel or automatic event deployment",
  );
  for (const record of manifest.events) {
    const event = data.events.find(
      (candidate) => candidate.id === record.definition.id,
    );
    ensure(
      event?.chainId === 10200 &&
        event.contractVersion === "kleros-event-v8" &&
        event.abiVersion === "kleros-event-v8" &&
        same(event.contract, record.deployment.contract),
      "Each published event uses its exact independent v8 child and version",
    );
  }
  if (initialBootstrap)
    ensure(
      data.instanceId === initialBootstrap.instanceId,
      "The backend instance remained stable during acceptance",
    );
  return data;
}
function financialFacts(detail) {
  const state = detail.state;
  return Object.fromEntries(
    [
      "phase",
      "owner",
      "stakerCount",
      "poolWei",
      "balanceWei",
      "pendingTotalWei",
      "pendingChallenges",
      "heldBackWei",
      "reservedWei",
      "payoutShareWei",
    ].map((key) => [key, state[key]]),
  );
}

// These are off-chain writes only. No financial draft, execute, confirm, faucet,
// Court-control, generic RPC-send or import endpoint is in this allowlist.
function allowedWrite(role, method, pathname, body) {
  if (
    method === "POST" &&
    ["/api/auth/challenge", "/api/auth/verify"].includes(pathname)
  )
    return true;
  if (method === "DELETE" && pathname === "/api/session") return true;
  for (const record of manifest.events) {
    const base = eventPath(record.definition.id);
    if (
      role === "alice" &&
      method === "POST" &&
      pathname === base + "/participants"
    )
      return (
        body?.name === "Synthetic live acceptance Alice" &&
        body?.email === "testnet-live-alice@example.test"
      );
    if (
      role === "alice" &&
      method === "POST" &&
      pathname === base + "/deposits"
    )
      return ["deposit-alice-a", "deposit-alice-b"].some(
        (action) =>
          journal?.transactions?.[action]?.state === "confirmed" &&
          same(body?.txHash, journal.transactions[action].hash),
      );
    if (
      role === "ownerA" &&
      method === "PATCH" &&
      record === manifest.events[0] &&
      pathname.startsWith(base + "/participants/")
    )
      return body?.admission === "approved";
  }
  return false;
}
async function makeBrowser(role, viewport = { width: 1440, height: 1000 }) {
  const wallet = walletRoles[role];
  const issuedMessages = new Map();
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  context.setDefaultTimeout(60_000);
  await context.exposeBinding(
    "__klerosTestnetAcceptanceWallet",
    async ({ frame }, method, params) => {
      ensure(
        new URL(frame.url()).origin === origin,
        "Wallet requests originate from the authorized app frame",
      );
      walletMethods.push(method);
      if (method === "eth_chainId") return "0x27d8";
      if (["eth_requestAccounts", "eth_accounts"].includes(method))
        return [wallet.address];
      ensure(
        method === "personal_sign",
        "The browser wallet cannot sign or submit contract transactions",
      );
      ensure(
        Array.isArray(params) &&
          params.length === 2 &&
          same(params[1], wallet.address),
        "Nonce signature belongs only to this context's own wallet",
      );
      const message = ethers.toUtf8String(params[0]);
      const issued = issuedMessages.get(message);
      ensure(
        issued && issued.expiresAt > Date.now(),
        "Only an exact fresh challenge issued by the real app may be signed",
      );
      ensure(
        message.startsWith("Kleros Chiado testnet workbench\n") &&
          message.includes(`Domain: ${new URL(origin).host}\n`) &&
          message.includes(`URI: ${origin}\n`) &&
          message.includes("Chain ID: 10200\n") &&
          message.includes(`Wallet: ${wallet.address}\n`) &&
          message.endsWith(
            "Authenticate this testnet wallet. No financial transaction.",
          ),
        "The signed nonce binds the real application origin, Chiado and this wallet",
      );
      issuedMessages.delete(message);
      return wallet.signMessage(message);
    },
  );
  await context.addInitScript(
    ({ address }) => {
      window.ethereum = {
        request: ({ method, params = [] }) =>
          window.__klerosTestnetAcceptanceWallet(method, params),
        on() {},
        removeListener() {},
        selectedAddress: address,
      };
    },
    { address: wallet.address },
  );
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    try {
      ensure(
        url.origin === origin,
        "Browser assets and API requests remain on the authorized app origin",
      );
      if (!["GET", "HEAD"].includes(request.method())) {
        const payload = request.postData() ? request.postDataJSON() : {};
        ensure(
          allowedWrite(role, request.method(), url.pathname, payload),
          "Browser writes are restricted to wallet login and reviewed synthetic off-chain records",
        );
        if (url.pathname === "/api/auth/challenge") {
          ensure(
            same(payload.wallet, wallet.address),
            "The app requests a challenge only for the context wallet",
          );
          const response = await route.fetch({ maxRedirects: 0 });
          ensure(
            response.status() === 200,
            "The actual app issues a nonce challenge",
          );
          const challenge = await response.json();
          ensure(
            typeof challenge.message === "string" &&
              /^[a-f0-9]{40}$/i.test(challenge.nonce) &&
              challenge.expiresAt > Date.now(),
            "The actual nonce challenge has a bounded fresh lifetime",
          );
          issuedMessages.set(challenge.message, challenge);
          return route.fulfill({ response });
        }
      }
      return route.continue();
    } catch {
      networkFailures.push("Blocked unexpected browser destination or write");
      return route.abort("blockedbyclient");
    }
  });
  const page = await context.newPage();
  page.on("pageerror", () =>
    browserFailures.push("Uncaught browser runtime error"),
  );
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      ["script", "stylesheet", "image", "font"].includes(
        response.request().resourceType(),
      )
    )
      assetFailures.push(response.status());
  });
  return { role, context, page };
}
async function appApi(
  actor,
  relative,
  { method = "GET", body, expected = 200 } = {},
) {
  const url = new URL(target(relative));
  ensure(
    method === "GET" || allowedWrite(actor.role, method, url.pathname, body),
    "Direct acceptance requests use the same off-chain-only allowlist",
  );
  const response = await actor.context.request.fetch(url.href, {
    method,
    headers:
      method === "GET" ? {} : { origin, "content-type": "application/json" },
    ...(body !== undefined ? { data: body } : {}),
    maxRedirects: 0,
    timeout: 60_000,
  });
  ensure(
    response.status() === expected,
    `Application HTTP ${response.status()} (expected ${expected}) for ${method} ${url.pathname}`,
  );
  return response.json();
}
async function navigate(actor, eventId, view = "participant") {
  stage = `${actor.role}: load ${view} event view`;
  await actor.page.goto(
    target(
      `/?acceptance_navigation=${++navigationSequence}#${new URLSearchParams({ event: eventId, view })}`,
    ),
  );
  await expect(actor.page.locator("#event-switch")).toHaveValue(eventId);
  await expect(actor.page.locator("#content")).toBeVisible();
  await expect(actor.page.locator("#loading")).toBeHidden();
  await expect(actor.page.locator(`#tab-${view}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  if (view === "participant")
    await expect(actor.page.locator(".next-action")).toBeVisible();
  if (view === "cases")
    await expect(
      actor.page.getByRole("heading", {
        name: "Kickbacks & payments",
        exact: true,
      }),
    ).toBeVisible();
  stage = `${actor.role}: verify testnet notice and controls`;
  await expect(actor.page.locator("#testnet-banner")).toBeVisible();
  await expect(actor.page.locator("#testnet-banner")).toContainText(
    /controlled.*arbitrat|no independent jury/i,
  );
  ensure(
    (await actor.page
      .locator(
        "#identity-select,[data-fund-wallet],[data-advance],[data-ruling],[data-open-appeal],a[href^='/finance/']",
      )
      .count()) === 0,
    "Testnet UI removes demo identities, faucets, time travel, mock rulings and incompatible v7 tools",
  );
}
async function login(actor, eventId) {
  await navigate(actor, eventId);
  stage = `${actor.role}: open wallet login`;
  await actor.page.locator("#top-identity").click();
  await expect(actor.page.locator("#dialog-title")).toHaveText(
    "Connect your wallet",
  );
  const verifiedResponse = actor.page.waitForResponse(
    (response) =>
      response.url() === target("/api/auth/verify") &&
      response.request().method() === "POST",
  );
  await actor.page.locator("#review-dialog [data-connect-wallet]").click();
  stage = `${actor.role}: verify real signed wallet session`;
  const actualVerification = await verifiedResponse;
  ensure(
    actualVerification.status() === 200,
    "The real wallet signature verification route succeeds",
  );
  const verifiedSession = await actualVerification.json();
  ensure(
    same(verifiedSession.wallet, walletRoles[actor.role].address) &&
      verifiedSession.mode === "wallet",
    "Nonce verification returns the context's real signed wallet identity",
  );
  stage = `${actor.role}: verify authenticated cookie on a fresh bootstrap`;
  const data = await appApi(actor, "/api/bootstrap");
  ensure(
    data.session?.mode === "wallet" &&
      same(data.session?.wallet, walletRoles[actor.role].address),
    "A real nonce signature creates a wallet session, never a demo identity",
  );
  const cookies = await actor.context.cookies(origin);
  const session = cookies.find((cookie) => cookie.name === "kleros_session");
  ensure(
    session?.secure === true &&
      session.httpOnly === true &&
      session.sameSite === "Strict",
    "The online wallet session is Secure, HttpOnly and SameSite Strict",
  );
  const dialog = actor.page.locator("#review-dialog");
  if (await dialog.isVisible())
    await actor.page.locator("#review-dialog [data-close]").last().click();
  coverage.push(`${actor.role} real wallet nonce login`);
}
async function proveExistingDeposit(action, record) {
  const entry = journal?.transactions?.[action];
  if (!entry || entry.state !== "confirmed") {
    limitations.push(
      `${action}: no confirmed protocol-rehearsal receipt was available; no deposit was submitted by this UI test`,
    );
    return null;
  }
  ensure(
    isHash(entry.hash) &&
      same(entry.expected.from, walletRoles.alice.address) &&
      same(entry.expected.to, record.deployment.contract),
    "The existing rehearsal deposit is scoped to Alice and the selected event child",
  );
  const [receipt, transaction] = await Promise.all([
    rpc("eth_getTransactionReceipt", [entry.hash]),
    rpc("eth_getTransactionByHash", [entry.hash]),
  ]);
  ensure(
    receipt &&
      BigInt(receipt.status) === 1n &&
      transaction &&
      BigInt(transaction.chainId) === 10200n &&
      same(transaction.from, walletRoles.alice.address) &&
      same(transaction.to, record.deployment.contract) &&
      BigInt(transaction.value) === BigInt(entry.expected.value),
    "The already-broadcast rehearsal deposit has a successful exact Chiado receipt",
  );
  const canonical = await rpc("eth_getBlockByNumber", [
    receipt.blockNumber,
    false,
  ]);
  ensure(
    canonical &&
      same(canonical.hash, receipt.blockHash) &&
      (!entry.blockHash || same(entry.blockHash, receipt.blockHash)),
    "The existing rehearsal receipt belongs to its current canonical public testnet block",
  );
  return entry.hash;
}

try {
  const configured = new URL(process.env.TESTNET_APP_URL ?? "");
  ensure(
    configured.origin === ALLOWED_ORIGIN &&
      configured.pathname === "/" &&
      !configured.search &&
      !configured.hash &&
      !configured.username &&
      !configured.password,
    "Explicit manual acceptance targets only the authorized production app URL",
  );
  origin = configured.origin;
  manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  ensure(
    manifest.environment === "testnet" &&
      manifest.chain.chainId === 10200 &&
      manifest.arbitration.mode === "controlled" &&
      manifest.events.length === 2 &&
      manifest.publicOrigin === origin,
    "The local public manifest describes this exact controlled Chiado deployment",
  );
  const info = fs.lstatSync(roleFile);
  ensure(
    info.isFile() &&
      !info.isSymbolicLink() &&
      (info.mode & 0o077) === 0 &&
      (process.getuid === undefined || info.uid === process.getuid()),
    "Disposable role keys are loaded only from their owner-only regular local file",
  );
  const secret = JSON.parse(fs.readFileSync(roleFile, "utf8"));
  ensure(
    secret.chainId === 10200 &&
      secret.purpose === "Disposable Chiado controlled rehearsal only",
    "The signer file belongs only to the disposable Chiado rehearsal",
  );
  walletRoles = Object.fromEntries(
    ["ownerA", "ownerB", "alice", "bob", "carol"].map((role) => {
      const wallet = new ethers.Wallet(secret.roles[role].privateKey);
      ensure(
        same(wallet.address, secret.roles[role].address) &&
          same(wallet.address, manifest.rehearsalAddresses[role]),
        "Disposable role addresses match the public manifest",
      );
      return [role, wallet];
    }),
  );
  if (fs.existsSync(journalFile)) {
    journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
    ensure(
      journal.chainId === 10200 &&
        journal.planFingerprint === manifest.planFingerprint,
      "Existing protocol receipts belong to this exact rehearsal plan",
    );
  } else
    limitations.push(
      "No protocol-rehearsal journal exists yet; financial receipt linkage is not claimed",
    );
  initialBootstrap = await bootstrap();
  ensure(
    BigInt(await rpc("eth_chainId")) === 10200n,
    "The public read-only RPC reports Chiado10200",
  );
  browser = await chromium.launch();
  const alice = await makeBrowser("alice");
  const [recordA, recordB] = manifest.events;
  const idA = recordA.definition.id,
    idB = recordB.definition.id;
  stage = "browser wallet login and synthetic registration";
  await login(alice, idA);
  for (const [record, action] of [
    [recordA, "deposit-alice-a"],
    [recordB, "deposit-alice-b"],
  ]) {
    const eventId = record.definition.id;
    await navigate(alice, eventId);
    let detail = await appApi(alice, eventPath(eventId));
    ensure(
      detail.participants.every((participant) =>
        same(participant.wallet, walletRoles.alice.address),
      ),
      "Alice sees only her own linked contact records",
    );
    if (
      detail.participants.length === 0 &&
      detail.event.registrationStatus === "open"
    ) {
      await alice.page
        .locator("#reg-name")
        .fill("Synthetic live acceptance Alice");
      await alice.page
        .locator("#reg-email")
        .fill("testnet-live-alice@example.test");
      await alice.page
        .locator('form[data-form="registration"] button[type="submit"]')
        .click();
      await expect(
        alice.page.locator('form[data-form="registration"]'),
      ).toHaveCount(0);
      coverage.push(`${eventId} synthetic wallet-linked registration`);
      detail = await appApi(alice, eventPath(eventId));
    }
    const hash = await proveExistingDeposit(action, record);
    if (hash && detail.participants.length === 1) {
      const current = detail.participants[0].deposit;
      if (!current?.verified) {
        const receiptForm = alice.page.locator('form[data-form="receipt"]');
        await receiptForm.locator("..").locator("summary").click();
        await alice.page.locator("#receipt-hash").fill(hash);
        const linked = alice.page.waitForResponse(
          (response) =>
            response.url() === target(eventPath(eventId, "/deposits")) &&
            response.request().method() === "POST",
        );
        await receiptForm.locator("button").click();
        ensure(
          (await linked).status() === 200,
          "The real browser receipt form verifies the existing deposit",
        );
        await expect(receiptForm).toBeHidden();
      } else
        ensure(
          same(current.txHash, hash),
          "A previously linked verified receipt matches the expected rehearsal deposit; no overwrite is attempted",
        );
      detail = await appApi(alice, eventPath(eventId));
      ensure(
        detail.participants[0].deposit?.verified === true &&
          same(detail.participants[0].deposit.txHash, hash),
        "The app verifies and links the existing canonical event deposit without a new transfer",
      );
      linkedReceipts.push({ eventId, hash });
      coverage.push(`${eventId} canonical existing deposit linkage`);
    } else if (detail.participants.length === 0)
      limitations.push(
        `${eventId}: off-chain registration is closed; private receipt linkage was not attempted`,
      );
    ensure(
      detail.event.role === "participant" &&
        detail.permissions.owner === false &&
        detail.participants.every((participant) =>
          same(participant.wallet, walletRoles.alice.address),
        ),
      "Signed participant login grants no organizer authority or other guest contacts",
    );
    ensure(
      (await alice.page.locator(".next-action").count()) === 1 &&
        (await alice.page.locator(".next-action .button-primary").count()) <= 1,
      "The participant view presents one next-action panel without competing primary actions",
    );
    ensure(
      await alice.page
        .locator("#deployment-details")
        .evaluate((element) => !element.open),
      "Contract and policy details are available but initially collapsed",
    );
    await expect(alice.page.locator(".event-summary")).toContainText("XDAI");
    await alice.page.locator("#deployment-details summary").click();
    await expect(alice.page.locator("#deployment-details")).toContainText(
      record.deployment.contract,
    );
    await expect(alice.page.locator(".event-context")).toContainText("10200");
    await alice.page.locator("#deployment-details summary").click();
  }
  stage = "organizer wallet authorization and independent Event B";
  const owner = await makeBrowser("ownerA");
  await login(owner, idA);
  const beforeB = financialFacts(await appApi(owner, eventPath(idB)));
  const ownerA = await appApi(owner, eventPath(idA));
  ensure(
    ownerA.event.role === "organizer" &&
      same(ownerA.state.owner, walletRoles.ownerA.address),
    "The real organizer wallet controls only its event",
  );
  const participant = ownerA.participants.find((person) =>
    same(person.wallet, walletRoles.alice.address),
  );
  if (participant && participant.admission !== "approved") {
    await appApi(
      owner,
      eventPath(idA, `/participants/${encodeURIComponent(participant.id)}`),
      { method: "PATCH", body: { admission: "approved" } },
    );
    coverage.push(
      "Event A off-chain admission approval; no contract registration transaction",
    );
  }
  const notOwnerB = await appApi(owner, eventPath(idB));
  ensure(
    notOwnerB.event.role === "participant" &&
      notOwnerB.permissions.owner === false,
    "Owner A's signed session has no organizer role in Event B",
  );
  ensure(
    JSON.stringify(financialFacts(notOwnerB)) === JSON.stringify(beforeB),
    "Off-chain Event A approval leaves all observed Event B financial facts unchanged",
  );
  stage = "read-only cases and responsive interface";
  await navigate(alice, idA, "cases");
  const cases = await appApi(alice, eventPath(idA));
  ensure(
    (await alice.page.locator(".case-card").count()) ===
      cases.state.cases.length,
    "Rendered cases match the authoritative current contract projection",
  );
  coverage.push(
    `Read-only cases: ${cases.state.cases.length}; phase ${cases.state.phase}`,
  );
  await navigate(alice, idA);
  await alice.page.setViewportSize({ width: 390, height: 844 });
  ensure(
    await alice.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "The live participant flow fits a mobile viewport without horizontal overflow",
  );
  fs.mkdirSync(screenshots, { recursive: true });
  await alice.page.screenshot({
    path: path.join(screenshots, "alice-mobile.png"),
    fullPage: true,
  });
  await alice.page.setViewportSize({ width: 1440, height: 1000 });
  await alice.page.screenshot({
    path: path.join(screenshots, "alice-desktop.png"),
    fullPage: true,
  });
  await bootstrap();
  ensure(
    walletMethods.filter((method) => method === "personal_sign").length === 2 &&
      walletMethods.every((method) =>
        [
          "eth_chainId",
          "eth_requestAccounts",
          "eth_accounts",
          "personal_sign",
        ].includes(method),
      ),
    "Exactly two wallet-login signatures occurred; no transaction signing or broadcast was requested",
  );
  ensure(
    networkFailures.length === 0 &&
      assetFailures.length === 0 &&
      browserFailures.length === 0,
    "The real hosted app loaded without unexpected writes, external browser requests, missing assets or runtime errors",
  );
  const proof = {
    status: "passed",
    origin,
    mode: "hosted-testnet",
    chainId: 10200,
    nativeCurrency: "XDAI",
    arbitration: "controlled test arbitrator; no independent jury",
    instanceId: initialBootstrap.instanceId,
    checks: checks.length,
    coverage,
    linkedReceipts,
    contractTransactionsSigned: 0,
    contractTransactionsBroadcast: 0,
    limitations: [
      ...limitations,
      "This acceptance does not execute a dispute, payout or other contract transaction; protocol rehearsal evidence is separate",
      "Wallet login used a restricted EIP1193 test provider with Node-held disposable keys rather than a normal browser extension",
    ],
    screenshots: [
      "artifacts/screenshots/testnet-live/alice-mobile.png",
      "artifacts/screenshots/testnet-live/alice-desktop.png",
    ],
  };
  fs.writeFileSync(
    path.join(screenshots, "proof.json"),
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(JSON.stringify(proof, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        stage,
        error:
          error instanceof AcceptanceFailure
            ? error.message
            : "Acceptance stopped; wallet/session/transport diagnostics were redacted. No contract transaction was signed or broadcast.",
        checksCompleted: checks.length,
        contractTransactionsSigned: 0,
        contractTransactionsBroadcast: 0,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  walletRoles = {};
  await Promise.allSettled(contexts.map((context) => context.close()));
  await browser?.close();
}
