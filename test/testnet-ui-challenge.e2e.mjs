import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { chromium, expect as baseExpect } from "@playwright/test";
import { ethers } from "ethers";
import {
  ROOT,
  PRIVATE_ROOT,
  readJson,
  publicJson,
  atomicJson,
  validatePlan,
  fingerprint,
  secureWalletFile,
  acquireLock,
  loadJournal,
  sendOnce,
  assertTestnet,
  verifyCompiledInputs,
} from "../src/testnet-config.mjs";
import {
  verifyChallenge,
  financialFacts,
  validateBootstrap,
} from "../scripts/testnet-sync-app.mjs";

// MANUAL, SINGLE FINANCIAL ACTION. Default is review-only: no keys, wallet,
// browser, RPC or mutation. Explicit operator go is also required before running:
// TESTNET_APP_URL=https://kleros-event-workbench-preview.netlify.app \
// TESTNET_EXECUTE_CHALLENGE=1 node test/testnet-ui-challenge.e2e.mjs
// This is Bob's one known challenge, not a generic financial wallet bridge.
// An existing action entry STOPS this script, even if a receipt is pending.
const ORIGIN = "https://kleros-event-workbench-preview.netlify.app";
const ACTION = "challenge-bob-a";
const SELECTOR = ethers.id("challenge()").slice(0, 10);
const MANIFEST = path.join(ROOT, "registry/chiado-v8-controlled.json");
const PLAN = path.join(PRIVATE_ROOT, "chiado-plan.json");
const JOURNAL = path.join(PRIVATE_ROOT, "chiado-rehearsal-journal.json");
const PROOF = path.join(ROOT, "artifacts/testnet-ui-challenge.json");
const SCREENSHOTS = path.join(
  ROOT,
  "artifacts/screenshots/testnet-ui-challenge",
);
const expect = baseExpect.configure({ timeout: 90_000 });
class UiChallengeFailure extends Error {}
function requireThat(condition, label) {
  if (!condition) throw new UiChallengeFailure(label);
}
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const isHash = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? "");
export function configuredOrigin(value) {
  const url = new URL(value);
  requireThat(
    url.origin === ORIGIN &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password,
    "Only the exact authorized primary Netlify HTTPS URL is supported.",
  );
  return url.origin;
}
function quantity(value) {
  requireThat(
    typeof value === "bigint" ||
      (typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0) ||
      (typeof value === "string" && /^(0x[0-9a-f]+|[0-9]+)$/i.test(value)),
    "Transaction quantities must be exact nonnegative integers.",
  );
  const number = BigInt(value);
  requireThat(
    number >= 0n && number < 1n << 256n,
    "Transaction quantity is outside uint256.",
  );
  return number;
}
export function validateChallengeRequest(request, scope) {
  requireThat(
    request && typeof request === "object" && !Array.isArray(request),
    "One explicit challenge transaction is required.",
  );
  requireThat(
    Object.keys(request).every((key) =>
      ["from", "to", "data", "value", "chainId"].includes(key),
    ),
    "Unexpected wallet transaction fields are refused.",
  );
  requireThat(
    quantity(request.chainId) === 10200n &&
      same(request.from, scope.bob) &&
      same(request.to, scope.contract) &&
      request.data?.toLowerCase() === SELECTOR &&
      quantity(request.value) === quantity(scope.value),
    "Wallet transaction must be Bob's exact reviewed Chiado Event A challenge.",
  );
  // sendOnce persists decimal expected.value. Passing an EIP1193 hex value
  // unchanged would conflict with the protocol CLI when it resumes later.
  return {
    from: ethers.getAddress(scope.bob),
    to: ethers.getAddress(scope.contract),
    data: SELECTOR,
    value: quantity(request.value),
    chainId: 10200,
  };
}
export function validateChallengeDraft(draft, scope, now = Date.now()) {
  requireThat(
    typeof draft?.id === "string" &&
      draft.id.length > 0 &&
      draft.eventId === scope.eventId &&
      draft.action === "challenge" &&
      draft.method === "challenge" &&
      draft.abiVersion === "kleros-event-v8" &&
      draft.contractVersion === "kleros-event-v8" &&
      Array.isArray(draft.args) &&
      draft.args.length === 0 &&
      same(draft.wallet, scope.bob) &&
      same(draft.contract, scope.contract) &&
      quantity(draft.chainId) === 10200n &&
      quantity(draft.valueWei) === quantity(scope.value),
    "The backend draft must bind the exact event, Bob, versioned child, method and current challenge value.",
  );
  requireThat(
    Number.isSafeInteger(draft.expiresAt) &&
      draft.expiresAt > now &&
      draft.expiresAt <= now + 301_000 &&
      /^[0-9a-f]{64}$/i.test(draft.snapshot ?? ""),
    "The authoritative transaction review must be fresh and snapshot-bound.",
  );
  validateChallengeRequest(draft.transaction, scope);
  return draft;
}
export function validateSignedChallenge(raw, scope) {
  const tx = ethers.Transaction.from(raw);
  requireThat(
    tx.chainId === 10200n &&
      same(tx.from, scope.bob) &&
      same(tx.to, scope.contract) &&
      tx.data === SELECTOR &&
      tx.value === quantity(scope.value) &&
      tx.gasLimit <= 16_777_216n,
    "Signed bytes must contain only the exact known Bob/Event A challenge.",
  );
  return tx.hash;
}
function noExistingAction(journal) {
  requireThat(
    !Object.hasOwn(journal.transactions ?? {}, ACTION),
    "The shared journal already contains challenge-bob-a. Stop: inspect or resume its existing receipt through the protocol CLI; never replay the UI action.",
  );
}

export async function selfTest() {
  const wallet = ethers.Wallet.createRandom(),
    other = ethers.Wallet.createRandom().address;
  const scope = {
    bob: wallet.address,
    contract: other,
    eventId: "synthetic-a",
    value: 123n,
  };
  const request = {
    from: wallet.address,
    to: other,
    data: SELECTOR,
    value: "0x7b",
    chainId: "0x27d8",
  };
  const normalized = validateChallengeRequest(request, scope);
  assert.equal(normalized.value, 123n);
  assert.equal(String(normalized.value), "123");
  const draft = {
    id: "synthetic-only",
    eventId: scope.eventId,
    action: "challenge",
    method: "challenge",
    abiVersion: "kleros-event-v8",
    contractVersion: "kleros-event-v8",
    args: [],
    wallet: wallet.address,
    contract: other,
    chainId: 10200,
    valueWei: "123",
    expiresAt: Date.now() + 60_000,
    snapshot: "a".repeat(64),
    transaction: request,
  };
  validateChallengeDraft(draft, scope);
  for (const patch of [
    { chainId: "0x1" },
    { from: other },
    { to: wallet.address },
    { data: "0x" },
    { value: "124" },
    { nonce: 1 },
  ])
    assert.throws(
      () => validateChallengeRequest({ ...request, ...patch }, scope),
      UiChallengeFailure,
    );
  for (const patch of [
    { eventId: "foreign-b" },
    { action: "match" },
    { method: "deposit" },
    { valueWei: "124" },
    { expiresAt: Date.now() - 1 },
  ])
    assert.throws(
      () => validateChallengeDraft({ ...draft, ...patch }, scope),
      UiChallengeFailure,
    );
  assert.throws(
    () => configuredOrigin("https://example.test"),
    UiChallengeFailure,
  );
  assert.throws(
    () => configuredOrigin(ORIGIN + "/?unexpected=1"),
    UiChallengeFailure,
  );
  assert.throws(
    () =>
      noExistingAction({ transactions: { [ACTION]: { state: "prepared" } } }),
    UiChallengeFailure,
  );
  const signed = await wallet.signTransaction({
    ...normalized,
    gasLimit: 300_000n,
    nonce: 0,
    gasPrice: 1n,
  });
  assert.ok(isHash(validateSignedChallenge(signed, scope)));
  assert.throws(
    () => validateSignedChallenge(signed, { ...scope, value: 124n }),
    UiChallengeFailure,
  );
  console.log(
    publicJson({
      status: "passed",
      scope: "local pure guards; ephemeral in-memory wallet only",
      checks: 19,
      coverage:
        "decimal normalization, exact draft/request/signed-byte scope, foreign chain/wallet/child/method/value refusal, fresh review, existing-entry replay refusal",
      networkRequests: 0,
      broadcasts: 0,
    }),
  );
}

export async function main() {
  const manifest = readJson(MANIFEST);
  requireThat(
    manifest.environment === "testnet" &&
      manifest.chain?.chainId === 10200 &&
      manifest.arbitration?.mode === "controlled" &&
      manifest.publicOrigin === ORIGIN &&
      manifest.events?.length === 2,
    "Only the reviewed controlled two-event Chiado manifest is supported.",
  );
  if (process.env.TESTNET_APP_URL)
    configuredOrigin(process.env.TESTNET_APP_URL);
  if (process.env.TESTNET_EXECUTE_CHALLENGE !== "1") {
    console.log(
      publicJson({
        status: "review-only",
        origin: ORIGIN,
        chainId: 10200,
        action: ACTION,
        signer: manifest.rehearsalAddresses.bob,
        eventId: manifest.events[0].definition.id,
        to: manifest.events[0].deployment.contract,
        data: SELECTOR,
        value:
          "Exact current contract.challengeDeposit(), checked again before signing",
        keysRead: false,
        networkRequests: 0,
        broadcasts: 0,
        instruction:
          "Wait for explicit operator go after attendance is posted. Then require the exact TESTNET_APP_URL and TESTNET_EXECUTE_CHALLENGE=1. Existing journal entry always stops the UI test.",
      }),
    );
    return;
  }
  configuredOrigin(process.env.TESTNET_APP_URL ?? "");
  let provider,
    browser,
    unlock,
    stage = "lock and immutable configuration",
    receipt,
    journal,
    scope,
    draft;
  let walletTransactions = 0,
    broadcastAttempts = 0,
    serverValidated = false,
    confirmation = null;
  const checks = [],
    browserErrors = [],
    blockedRequests = [],
    assetErrors = [],
    walletMethods = [];
  const ensure = (condition, label) => {
    requireThat(condition, label);
    checks.push(label);
  };
  const aRecord = manifest.events[0],
    bRecord = manifest.events[1];
  const aPath = `/api/events/${encodeURIComponent(aRecord.definition.id)}`;
  const bPath = `/api/events/${encodeURIComponent(bRecord.definition.id)}`;
  const screenshotPaths = [];
  let bootstrap, bBefore, bob, page;
  const draftDiagnostics = {};
  try {
    unlock = acquireLock(path.join(PRIVATE_ROOT, "chiado-operation.lock"));
    const plan = readJson(PLAN);
    validatePlan(plan);
    ensure(
      manifest.planFingerprint === fingerprint(plan) &&
        manifest.chain.rpcUrl === plan.chain.rpcUrl,
      "Manifest and shared transaction journal are bound to the same immutable Chiado plan",
    );
    journal = loadJournal(JOURNAL, plan);
    noExistingAction(journal);
    const { artifacts, provenance } = verifyCompiledInputs();
    ensure(
      JSON.stringify(provenance) === JSON.stringify(manifest.provenance),
      "Compilation provenance matches the deployed contract manifest",
    );
    const keyFile = secureWalletFile();
    const entry = keyFile.roles.bob;
    ensure(
      same(entry.address, manifest.rehearsalAddresses.bob),
      "Only the dedicated rehearsal Bob wallet is selected",
    );
    provider = new ethers.JsonRpcProvider(plan.chain.rpcUrl, undefined, {
      cacheTimeout: -1,
    });
    provider.pollingInterval = 4000;
    await assertTestnet(provider, plan.chain);
    bob = new ethers.Wallet(entry.privateKey, provider);
    const a = new ethers.Contract(
      aRecord.deployment.contract,
      artifacts.KlerosEventV8.abi,
      provider,
    );
    const b = new ethers.Contract(
      bRecord.deployment.contract,
      artifacts.KlerosEventV8.abi,
      provider,
    );
    ensure(
      ethers.keccak256(await provider.getCode(a.target)) ===
        aRecord.deployment.codeHash &&
        ethers.keccak256(await provider.getCode(b.target)) ===
          bRecord.deployment.codeHash,
      "Both fixture children match the manifest's exact runtime hashes",
    );
    const currentBlock = await provider.getBlock("latest");
    const value = await a.challengeDeposit();
    ensure(
      value > 0n && value <= ethers.parseEther("0.001"),
      "Current challenge deposit is within the narrow test-token budget",
    );
    ensure(
      (await a.phase()) === 1n &&
        (await a.status(bob.address)) === 1n &&
        !(await a.attended(bob.address)) &&
        (await a.challenges(bob.address)).state === 0n &&
        currentBlock.timestamp <= Number(await a.challengeEndsAt()),
      "Attendance is posted, Bob is registered and omitted, and his one challenge is still eligible",
    );
    scope = {
      bob: bob.address,
      contract: aRecord.deployment.contract,
      eventId: aRecord.definition.id,
      value,
    };
    const target = (relative) => {
      const url = new URL(relative, ORIGIN);
      requireThat(
        url.origin === ORIGIN && !url.username && !url.password,
        "App requests must stay on the exact primary HTTPS origin",
      );
      return url.href;
    };
    const fetchApp = async (relative) => {
      const response = await fetch(target(relative), {
        redirect: "error",
        signal: AbortSignal.timeout(90_000),
      });
      ensure(
        response.status === 200,
        "Read-only app readiness and financial projections respond successfully",
      );
      return response.json();
    };
    stage = "public application readiness";
    bootstrap = await fetchApp("/api/bootstrap");
    validateBootstrap(bootstrap, manifest);
    ensure(
      /controll|no independent jury/i.test(bootstrap.arbitration.notice),
      "The actual app explicitly identifies controlled test arbitration",
    );
    bBefore = financialFacts(await fetchApp(bPath));
    const bChainBefore = await directFinancialFacts(b, provider);

    // Inspect signed bytes and count actual broadcasts inside the shared helper.
    const originalBroadcast = provider.broadcastTransaction.bind(provider);
    provider.broadcastTransaction = async (raw) => {
      ensure(
        broadcastAttempts === 0,
        "Only one raw transaction may be broadcast during this entire UI acceptance",
      );
      const hash = validateSignedChallenge(raw, scope);
      ensure(
        journal.transactions[ACTION]?.state === "prepared" &&
          same(journal.transactions[ACTION].hash, hash),
        "The exact signed transaction hash was journaled before broadcast",
      );
      broadcastAttempts++;
      return originalBroadcast(raw);
    };
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    context.setDefaultTimeout(90_000);
    const issued = new Map();
    let signedNonceProof = null;
    await context.exposeBinding(
      "__klerosSingleChallengeWallet",
      async ({ frame }, method, params = []) => {
        ensure(
          new URL(frame.url()).origin === ORIGIN,
          "Wallet calls originate only from the authorized app frame",
        );
        walletMethods.push(method);
        if (method === "eth_chainId") return "0x27d8";
        if (["eth_accounts", "eth_requestAccounts"].includes(method))
          return [bob.address];
        if (method === "personal_sign") {
          ensure(
            params.length === 2 && same(params[1], bob.address),
            "Only Bob can sign this wallet's app nonce",
          );
          const message = ethers.toUtf8String(params[0]),
            challenge = issued.get(message);
          ensure(
            challenge && verifyChallenge(challenge, bob.address) === message,
            "A fresh exact server-issued domain/chain/wallet nonce is required",
          );
          issued.delete(message);
          const signature = await bob.signMessage(message);
          signedNonceProof = { nonce: challenge.nonce, signature };
          return signature;
        }
        ensure(
          method === "eth_sendTransaction" &&
            params.length === 1 &&
            walletTransactions === 0 &&
            draft &&
            serverValidated,
          "Only one already-reviewed and server-validated challenge wallet submission is allowed",
        );
        const request = validateChallengeRequest(params[0], scope);
        validateChallengeDraft(draft, scope);
        ensure(
          (await a.challengeDeposit()) === value &&
            (await a.phase()) === 1n &&
            (await a.challenges(bob.address)).state === 0n,
          "The current on-chain challenge terms still match the reviewed request",
        );
        noExistingAction(journal);
        walletTransactions++;
        stage = "single wallet challenge via shared journal";
        receipt = await sendOnce({
          provider,
          signer: bob,
          journal,
          journalPath: JOURNAL,
          action: ACTION,
          request,
        });
        return receipt.hash;
      },
    );
    await context.addInitScript(
      ({ address }) => {
        window.ethereum = {
          selectedAddress: address,
          request: ({ method, params = [] }) =>
            window.__klerosSingleChallengeWallet(method, params),
          on() {},
          removeListener() {},
        };
      },
      { address: bob.address },
    );
    const exactKeys = (value, keys) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key));
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        method = request.method();
      try {
        requireThat(url.origin === ORIGIN, "Unexpected browser origin blocked");
        if (["GET", "HEAD"].includes(method)) {
          requireThat(
            url.pathname === "/" ||
              [
                "/app.js",
                "/styles.css",
                "/reconciliation.js",
                "/hosted-wallet.js",
                "/transaction-context.js",
                "/.netlify/scripts/hud",
                "/api/bootstrap",
                aPath,
                bPath,
              ].includes(url.pathname) ||
              url.pathname.startsWith("/assets/"),
            "Unexpected browser read endpoint blocked",
          );
          return route.continue();
        }
        const body = request.postData() ? request.postDataJSON() : {};
        if (method === "POST" && url.pathname === "/api/auth/challenge") {
          requireThat(
            exactKeys(body, ["wallet"]) && same(body.wallet, bob.address),
            "Nonce must belong only to Bob",
          );
          const response = await route.fetch({
            maxRedirects: 0,
            timeout: 90_000,
          });
          requireThat(
            response.status() === 200,
            "Actual app nonce route must succeed",
          );
          const challenge = await response.json();
          verifyChallenge(challenge, bob.address);
          issued.set(challenge.message, challenge);
          return route.fulfill({ response });
        }
        if (method === "POST" && url.pathname === "/api/auth/verify") {
          requireThat(
            exactKeys(body, ["nonce", "signature"]) &&
              typeof body.signature === "string" &&
              signedNonceProof &&
              body.nonce === signedNonceProof.nonce &&
              body.signature === signedNonceProof.signature,
            "Wallet verification must use the exact server-issued nonce and Node-only signature",
          );
          return route.continue();
        }
        if (method === "POST" && url.pathname === aPath + "/drafts") {
          requireThat(
            !draft &&
              exactKeys(body, ["action", "params"]) &&
              body.action === "challenge" &&
              exactKeys(body.params, []),
            "Only one empty-argument Event A challenge draft is allowed",
          );
          const response = await route.fetch({
            maxRedirects: 0,
            timeout: 90_000,
          });
          draftDiagnostics.httpStatus = response.status();
          const candidate = await response.json();
          draftDiagnostics.returnedFields = Object.keys(candidate);
          draftDiagnostics.code = /^[A-Z0-9_]{1,80}$/.test(candidate.code ?? "")
            ? candidate.code
            : null;
          requireThat(
            response.status() === 201,
            "Actual backend must create the one challenge review",
          );
          draft = validateChallengeDraft(candidate, scope);
          return route.fulfill({ response });
        }
        if (
          draft &&
          method === "POST" &&
          url.pathname ===
            `${aPath}/drafts/${encodeURIComponent(draft.id)}/validate`
        ) {
          requireThat(
            exactKeys(body, []) && !serverValidated,
            "Only the captured draft may receive one authoritative pre-send validation",
          );
          const response = await route.fetch({
            maxRedirects: 0,
            timeout: 90_000,
          });
          requireThat(
            response.status() === 200,
            "Actual backend must validate the reviewed challenge request",
          );
          validateChallengeRequest(await response.json(), scope);
          serverValidated = true;
          return route.fulfill({ response });
        }
        const savedHash = journal.transactions[ACTION]?.hash;
        if (
          draft &&
          isHash(savedHash) &&
          method === "POST" &&
          url.pathname ===
            `${aPath}/drafts/${encodeURIComponent(draft.id)}/submitted`
        ) {
          requireThat(
            exactKeys(body, ["hash"]) && same(body.hash, savedHash),
            "Only the one journaled challenge hash may be recorded by the UI",
          );
          return route.continue();
        }
        if (
          draft &&
          isHash(savedHash) &&
          method === "POST" &&
          url.pathname === aPath + "/submissions/reconcile"
        ) {
          requireThat(
            exactKeys(body, ["draftId", "hash"]) &&
              body.draftId === draft.id &&
              same(body.hash, savedHash),
            "UI reconciliation is restricted to the original reviewed draft and known journaled hash",
          );
          const response = await route.fetch({
            maxRedirects: 0,
            timeout: 90_000,
          });
          if (response.status() === 200) {
            const result = await response.json();
            requireThat(
              result.status === "confirmed" && same(result.hash, savedHash),
              "The actual UI confirmation must identify the same successful challenge receipt",
            );
            confirmation = result;
          }
          return route.fulfill({ response });
        }
        throw new UiChallengeFailure("Unexpected browser API write blocked");
      } catch (error) {
        blockedRequests.push(
          `${method} ${url.pathname}: ${error instanceof UiChallengeFailure ? error.message : "Unexpected browser request or transport failure blocked"}`,
        );
        return route.abort("blockedbyclient");
      }
    });
    page = await context.newPage();
    page.on("pageerror", () => browserErrors.push("Uncaught browser error"));
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        ["script", "stylesheet", "font", "image"].includes(
          response.request().resourceType(),
        )
      )
        assetErrors.push(response.status());
    });
    stage = "Bob wallet login through actual public UI";
    await page.goto(
      target(
        `/#${new URLSearchParams({ event: scope.eventId, view: "participant" })}`,
      ),
    );
    await expect(page.locator("#event-switch")).toHaveValue(scope.eventId);
    await expect(page.locator("#testnet-banner")).toContainText(
      /controll.*arbitrat|no independent jury/i,
    );
    await page.locator("#top-identity").click();
    await expect(page.locator("#dialog-title")).toHaveText(
      "Connect your wallet",
    );
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url() === target("/api/auth/verify") &&
        response.request().method() === "POST",
    );
    await page.locator("#review-dialog [data-connect-wallet]").click();
    ensure(
      (await loginResponse).status() === 200,
      "The actual published app verifies Bob's nonce signature",
    );
    await expect
      .poll(async () => {
        const response = await context.request.get(target("/api/bootstrap"), {
          maxRedirects: 0,
        });
        const data = await response.json();
        validateBootstrap(data, manifest, bootstrap.instanceId);
        return (
          data.session?.mode === "wallet" &&
          same(data.session.wallet, bob.address)
        );
      })
      .toBe(true);
    if (await page.locator("#review-dialog").isVisible())
      await page.locator("#review-dialog [data-close]").last().click();
    const cookies = await context.cookies(ORIGIN),
      session = cookies.find((cookie) => cookie.name === "kleros_session");
    ensure(
      session?.secure && session.httpOnly && session.sameSite === "Strict",
      "Bob's wallet session uses Secure HttpOnly SameSite Strict cookies",
    );
    stage = "one reviewed challenge in the browser";
    await page.locator('.next-action [data-tx="challenge"]').click();
    await expect(page.locator("#review-dialog")).toBeVisible();
    for (const exact of [
      aRecord.definition.title,
      scope.eventId,
      scope.contract,
      bob.address,
      String(value),
      "10200",
      aRecord.deployment.policyURI,
    ])
      await expect(page.locator("#dialog-body")).toContainText(exact);
    await expect(page.locator("#dialog-body .review-list")).toBeVisible();
    if (process.env.TESTNET_REVIEW_CHALLENGE_ONLY === "1") {
      const review = {
        status: "review-ready",
        chainId: 10200,
        action: ACTION,
        eventId: scope.eventId,
        draftId: draft.id,
        contract: scope.contract,
        wallet: bob.address,
        valueWei: String(value),
        walletTransactions,
        broadcastAttempts,
        notice:
          "Exact reviewed challenge displayed in the real UI; no financial wallet request or broadcast.",
      };
      atomicJson(
        path.join(ROOT, "artifacts/testnet-ui-challenge-review.json"),
        review,
        0o644,
      );
      console.log(publicJson(review));
      return;
    }
    await page.locator("[data-execute]").click();
    await expect(page.locator("#review-dialog")).not.toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator("#toast")).toContainText("Confirmed");
    ensure(
      confirmation &&
        receipt &&
        walletTransactions === 1 &&
        broadcastAttempts === 1,
      "Actual UI submission and confirmation completed with exactly one signed broadcast",
    );
    fs.mkdirSync(SCREENSHOTS, { recursive: true });
    const desktop = path.join(
      SCREENSHOTS,
      "bob-challenge-confirmed-desktop.png",
    );
    await page.screenshot({ path: desktop, fullPage: true });
    screenshotPaths.push(path.relative(ROOT, desktop));

    stage = "canonical chain proof and event isolation";
    const hash = journal.transactions[ACTION].hash;
    const canonicalReceipt = await provider.getTransactionReceipt(hash),
      tx = await provider.getTransaction(hash);
    const block = await provider.getBlock(canonicalReceipt.blockNumber);
    ensure(
      canonicalReceipt.status === 1 &&
        same(block.hash, canonicalReceipt.blockHash) &&
        same(canonicalReceipt.hash, receipt.hash) &&
        tx.chainId === 10200n &&
        same(tx.from, bob.address) &&
        same(tx.to, scope.contract) &&
        tx.data === SELECTOR &&
        tx.value === value,
      "The actual UI transaction has a successful canonical exact Chiado receipt",
    );
    const events = canonicalReceipt.logs
      .filter((log) => same(log.address, scope.contract))
      .flatMap((log) => {
        try {
          return [a.interface.parseLog(log)];
        } catch {
          return [];
        }
      });
    ensure(
      events.filter(
        (event) =>
          event?.name === "Challenged" &&
          same(event.args.staker, bob.address) &&
          event.args.deposit === value,
      ).length === 1,
      "Exactly one child-contract Challenged log proves Bob's omission challenge and exact deposit",
    );
    const challenge = await a.challenges(bob.address);
    ensure(
      challenge.state === 1n && challenge.deposit === value,
      "The real event contract reports Bob Waiting for a match",
    );
    ensure(
      JSON.stringify(await directFinancialFacts(b, provider)) ===
        JSON.stringify(bChainBefore),
      "Event B's canonical financial state is unchanged by Bob's Event A challenge",
    );
    const finalBootstrap = await fetchApp("/api/bootstrap");
    validateBootstrap(finalBootstrap, manifest, bootstrap.instanceId);
    ensure(
      JSON.stringify(financialFacts(await fetchApp(bPath))) ===
        JSON.stringify(bBefore),
      "The public application also reports unchanged Event B accounting",
    );
    await page.locator('[data-view="cases"]').click();
    await expect(
      page.locator(".case-card").filter({ hasText: /waiting for a match/i }),
    ).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    ensure(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Confirmed challenge view fits a mobile viewport",
    );
    const mobile = path.join(SCREENSHOTS, "bob-waiting-challenge-mobile.png");
    await page.screenshot({ path: mobile, fullPage: true });
    screenshotPaths.push(path.relative(ROOT, mobile));
    ensure(
      blockedRequests.length === 0 &&
        browserErrors.length === 0 &&
        assetErrors.length === 0,
      "Public browser flow had no unexpected requests, runtime failures or missing assets",
    );
    const proof = {
      status: "passed",
      origin: ORIGIN,
      mode: "hosted-testnet",
      chainId: 10200,
      action: ACTION,
      planId: manifest.planId,
      eventId: scope.eventId,
      contract: scope.contract,
      wallet: bob.address,
      hash,
      blockNumber: canonicalReceipt.blockNumber,
      blockHash: canonicalReceipt.blockHash,
      valueWei: String(value),
      gasUsed: String(canonicalReceipt.gasUsed),
      journalState: journal.transactions[ACTION].state,
      challengeState: "Waiting",
      matchEndsAt: Number(challenge.matchEndsAt),
      walletTransactions,
      broadcastAttempts,
      checks: checks.length,
      assertions: checks,
      walletMethods,
      screenshots: screenshotPaths,
      performedAt: new Date().toISOString(),
      limitations:
        "A real Chiado transaction was driven through the published browser UI with an EIP1193 test bridge; Bob's private key remained only in Node. Controlled arbitrator, no independent jury. Match, ruling, payout and settlement are separate later stages.",
    };
    atomicJson(PROOF, proof, 0o644);
    console.log(publicJson(proof));
  } catch (error) {
    const hash = journal?.transactions?.[ACTION]?.hash;
    const proof = {
      status: "stopped",
      stage,
      action: ACTION,
      chainId: 10200,
      hash: isHash(hash) ? hash : null,
      walletTransactions,
      broadcastAttempts,
      error:
        error instanceof UiChallengeFailure
          ? error.message
          : "Browser/signing/transport diagnostics redacted. Inspect the shared action journal; do not replay or reset.",
      needsReceiptInspection: Boolean(hash),
      checks: checks.length,
      draftDiagnostics,
      blockedRequests,
      uiToast: page
        ? String(
            await page
              .locator("#toast")
              .textContent({ timeout: 1000 })
              .catch(() => "Unavailable"),
          ).slice(0, 1000)
        : null,
    };
    atomicJson(
      path.join(ROOT, "artifacts/testnet-ui-challenge-stopped.json"),
      proof,
      0o644,
    );
    console.error(publicJson(proof));
    process.exitCode = 1;
  } finally {
    await browser?.close();
    provider?.destroy();
    unlock?.();
  }
}
async function directFinancialFacts(contract, provider) {
  const blockTag = await provider.getBlockNumber();
  const fields = [
    "phase",
    "stakerCount",
    "attendeeCount",
    "pendingTotal",
    "pendingChallenges",
    "heldBack",
    "reserved",
    "owedTotal",
    "challengeEscrow",
    "payoutShare",
  ];
  const values = await Promise.all(
    fields.map((name) => contract[name]({ blockTag })),
  );
  return {
    ...Object.fromEntries(
      fields.map((name, index) => [name, String(values[index])]),
    ),
    balance: String(await provider.getBalance(contract.target, blockTag)),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const run = args.length === 1 && args[0] === "--self-test" ? selfTest : main;
  if (args.length && !(args.length === 1 && args[0] === "--self-test")) {
    console.error(
      "Unknown option refused; no browser, keys or transaction requested.",
    );
    process.exit(1);
  }
  run().catch(() => {
    console.error(
      "Challenge UI check stopped before execution; diagnostics redacted. No retry or automatic rebroadcast is permitted.",
    );
    process.exitCode = 1;
  });
}
