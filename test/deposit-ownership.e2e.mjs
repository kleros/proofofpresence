// Actual mini controller and native cross-document Web Locks. Every API and
// wallet result is mocked; no relay, public RPC, real account or transaction.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { EVENT } from "../public/first-event/event.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = process.env.BROWSER_SECURITY_PROOF_DIR ?? path.join(os.tmpdir(), "kleros-deposit-ownership-proof");
const ORIGIN = "https://kickback.kleros.io", wallet = "0x" + "1".repeat(40), otherWallet = "0x" + "2".repeat(40);
const blockHash = "0x" + "b".repeat(64), originalHash = "0x" + "a".repeat(64);
await fs.mkdir(OUT, { recursive: true });
const files = ["public/deposit-ownership.js", "public/public-transactions.js", "public/first-event/wallet.js", "public/first-event/event.js", "public/first-event/direct-deposit.js", "public/first-event/deps/transaction-context.js", "public/first-event/deps/v10-wallet-account.js", "test/deposit-ownership.e2e.mjs"];
const pins = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await fs.readFile(path.join(ROOT, file))).digest("hex")])));
const proof = { kind: "actual-controller-native-WebLocks-mocked-wallet", status: "running", checks: [], sourceSha256: await pins(), scenarios: [], external: [], errors: [], realWalletCalls: 0, realTransactions: 0 };
const pass = text => proof.checks.push(text);
const selected = name => !process.env.BROWSER_SECURITY_ONLY || process.env.BROWSER_SECURITY_ONLY.split(",").includes(name);
let browser;
async function scenario(name, { holdMint = false, unsupported = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" }), tabs = new Map();
  const state = { name, instanceId: "synthetic-ownership-" + name, minted: 0, prepared: 0, sends: [], requests: [], failReceipt: false, flows: new Map() };
  let releaseMint;
  const mintGate = new Promise(resolve => { releaseMint = resolve; });
  if (!holdMint) releaseMint();
  await context.exposeBinding("__recordSend", ({ page }, tx) => { state.sends.push({ tab: tabs.get(page), tx }); });
  await context.addInitScript(({ wallet, blockHash, unsupported }) => {
    if (unsupported) Object.defineProperty(navigator, "locks", { value: undefined });
    window.fakeMethods = []; window.fakeSends = []; window.pendingWallet = null;
    window.ethereum = { on() {}, removeListener() {}, async request({ method, params }) {
      window.fakeMethods.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet];
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_getCode") return "0x";
      if (method === "eth_getBlockByNumber") return { number: "0x64", hash: blockHash };
      if (method === "eth_sendTransaction") {
        window.fakeSends.push(params[0]); await window.__recordSend(params[0]);
        return new Promise((resolve, reject) => { window.pendingWallet = { resolve, reject: code => reject(Object.assign(Error("Synthetic wallet outcome"), { code })) }; });
      }
      throw Error("Unexpected synthetic wallet method " + method);
    } };
  }, { wallet, blockHash, unsupported });
  const policy = () => ({ mode: EVENT.mode, instanceId: state.instanceId, contractVersion: EVENT.abiVersion, abiVersion: EVENT.abiVersion,
    contractProfile: { contractVersion: EVENT.abiVersion, abiVersion: EVENT.abiVersion, version: 10, financialModel: "v8", upgradeable: true, verified: true, testOnly: false, chainId: 1, challengeWindowSeconds: 86400, matchWindowSeconds: 86400 }, chain: { chainId: 1 }, environment: { chainId: 1, production: true, network: "ethereum-mainnet" }, walletSupport: { type: "eoa-only", eoa: true, eip7702: false, erc1271: false }, capabilities: { production: true, browserWallet: true, walletTransactions: true, serverSigning: false, supportedAccountTypes: ["eoa"], contractWallets: false, eip7702: false, erc1271: false, transactionsReady: false, createEvents: false, manageEvents: false } });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    state.requests.push({ tab: tabs.get(request.frame().page()), path: url.pathname, method: request.method() });
    if (url.origin !== ORIGIN) { proof.external.push(url.origin); return route.abort(); }
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.pathname === "/api/first-event/depositors") return json({ schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, eventId: EVENT.id, mode: EVENT.mode, instanceId: state.instanceId, chainId: 1, contract: EVENT.contract, status: "current", checkedAt: new Date().toISOString(), blockNumber: 100, blockHash, depositors: [] });
    if (url.pathname === "/api/public-transactions" && request.method() === "POST") {
      assert.deepEqual(request.postDataJSON(), { wallet, kind: "deposit" });
      const token = String(++state.minted).padStart(64, "0");
      const info = { kind: "public-transaction-flow", schemaVersion: 1, flowKind: "deposit", token, wallet, mode: EVENT.mode, chainId: 1, instanceId: state.instanceId, contractVersion: EVENT.abiVersion, eventId: EVENT.id, contract: EVENT.contract, walletContext: policy() };
      state.flows.set(token, { info, draft: null }); await mintGate; return json(info, 201);
    }
    const endpoint = /^\/api\/public-transactions\/([0-9a-f]{64})(.*)$/.exec(url.pathname);
    if (endpoint) {
      const flow = state.flows.get(endpoint[1]); assert(flow, "Only this scenario's existing opaque flow may be used");
      if (endpoint[2] === "" && request.method() === "GET") return json(flow.info);
      if (endpoint[2] === "/direct-deposit/prepare") {
        state.prepared++; const now = Date.now(), snapshot = "synthetic-full-preflight", id = "synthetic-draft-" + state.prepared;
        flow.draft = { id, eventId: EVENT.id, chainId: 1, mode: EVENT.mode, abiVersion: EVENT.abiVersion, contractVersion: EVENT.abiVersion, origin: ORIGIN, instanceId: state.instanceId, wallet, contract: EVENT.contract, action: "deposit", method: "deposit", args: [], params: { preparation: "ready-to-send" }, valueWei: EVENT.depositWei, snapshot, reviewBlock: 100, createdAt: now, expiresAt: now + 60000, transaction: { from: wallet, to: EVENT.contract, chainId: 1, data: "0xd0e30db0", value: EVENT.depositWei }, directDepositContext: { kind: "direct-deposit-v1", eventId: EVENT.id, chainId: 1, contract: EVENT.contract, wallet, origin: ORIGIN, instanceId: state.instanceId, depositWei: EVENT.depositWei, amountWei: EVENT.depositWei, pendingCreditWei: "0", blockNumber: 100, blockHash, snapshot, verification: "ready-to-send" } };
        return json(flow.draft);
      }
      if (endpoint[2] === "/direct-deposit/validate") return json({ transaction: flow.draft.transaction });
      if (endpoint[2] === "/submitted") {
        assert.deepEqual(request.postDataJSON(), { draftId: flow.draft.id, hash: originalHash });
        return state.failReceipt ? json({ error: "Synthetic receipt service unavailable", code: "UNAVAILABLE" }, 503) : json({ status: "submitted" });
      }
      if (endpoint[2] === "/event-read-jobs" && request.method() === "POST") {
        const input = request.postDataJSON(); assert.equal(input.operation, "confirm"); assert.equal(input.hash, originalHash); assert.equal(input.draftId, flow.draft.id);
        return json({ kind: "event-read-job", schemaVersion: 1, requestId: input.requestId, operation: "confirm", chainId: 1, contractVersion: EVENT.abiVersion, instanceId: flow.info.instanceId, wallet, eventId: EVENT.id, state: "ready", expiresAt: Date.now() + 10000, result: { status: "confirmed", hash: originalHash, eventId: EVENT.id, chainId: 1, contract: EVENT.contract, wallet, blockNumber: 101 } });
      }
    }
    if (url.pathname.startsWith("/api/")) { proof.errors.push("Unexpected mocked API " + url.pathname); return json({ error: "Unexpected mocked API" }, 500); }
    assert.equal(request.method(), "GET");
    const filename = url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname;
    const target = path.resolve(ROOT, "public", "." + filename); assert(target.startsWith(path.join(ROOT, "public") + path.sep));
    const body = await fs.readFile(target), ext = path.extname(target);
    return route.fulfill({ contentType: ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" })[ext] ?? "application/octet-stream", body });
  });
  const page = async tab => {
    const value = await context.newPage(); tabs.set(value, tab); value.on("pageerror", error => proof.errors.push(name + ": " + error.message));
    await value.goto(ORIGIN + "/first-event/?tab=" + tab, { waitUntil: "networkidle" });
    return value;
  };
  const connect = async page => { await page.locator("[data-connect-wallet]").click(); await expect(page.locator("[data-wallet-status]")).toContainText("Connected"); };
  const intents = page => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("kleros-first-event-intent:v1:")));
  const flowRecords = page => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("kleros-public-transaction-v1:")));
  const finish = async () => { proof.scenarios.push({ name, minted: state.minted, prepared: state.prepared, sends: state.sends, requests: state.requests }); await context.close(); };
  return { context, state, page, connect, intents, flowRecords, finish, releaseMint };
}

try {
  browser = await chromium.launch({ headless: true });
  if (selected("concurrent")) {
    const s = await scenario("concurrent", { holdMint: true }), A = await s.page("A"), B = await s.page("B");
    await s.connect(A); await s.connect(B);
    await A.locator("[data-deposit]").click(); await expect.poll(() => s.state.minted).toBe(1);
    await B.locator("[data-deposit]").click(); await expect(B.locator("[data-tx-status]")).toContainText("Another tab");
    assert.equal(s.state.minted, 1); assert.equal(s.state.prepared, 0); assert.equal(s.state.requests.filter(item => item.tab === "B" && item.path.startsWith("/api/public-transactions")).length, 0);
    pass("Atomic native ownership is acquired before flow selection/minting; a concurrent tab performs no flow API or wallet prompt");
    s.releaseMint(); await A.waitForFunction(() => window.fakeSends.length === 1 && window.pendingWallet);
    const held = await s.intents(A), saved = await s.flowRecords(A); assert.equal(held.length, 1); assert.equal(saved.length, 1); assert(JSON.parse(held[0][1]).owner);
    const cleanup = await B.evaluate(async ({ wallet, token }) => {
      const { resetUnusedPublicTransactionFlow } = await import("/public-transactions.js");
      try { resetUnusedPublicTransactionFlow({ wallet, kind: "deposit", token }); return "unsafe"; } catch (error) { return error.code; }
    }, { wallet, token: JSON.parse(saved[0][1]).token });
    assert.equal(cleanup, "DEPOSIT_OWNERSHIP_LOST"); await B.close(); assert.deepEqual(await s.intents(A), held); assert.deepEqual(await s.flowRecords(A), saved);
    assert.deepEqual(s.state.sends[0].tx, { from: wallet, to: EVENT.contract, chainId: "0x1", data: "0xd0e30db0", value: "0x2386f26fc10000" }); assert.equal(s.state.sends.length, 1);
    pass("The sole prompt has exact reviewed deposit bytes; another tab cannot reset its flow or remove its marker on close");
    // A foreign replacement simulates a still-open older client. A rejection
    // may remove only this operation's exact nonce+draft record.
    const foreign = JSON.stringify({ phase: "awaiting-wallet", draftId: "older-client-original", owner: "foreign-owner" });
    await A.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: held[0][0], raw: foreign });
    await A.evaluate(() => window.pendingWallet.reject(4001)); await expect(A.locator("[data-tx-status]")).toContainText("wallet request may still be open");
    assert.deepEqual(await s.intents(A), [[held[0][0], foreign]]); assert.deepEqual(await s.flowRecords(A), saved);
    pass("4001 cleanup is exact-owner checked and preserves a foreign unresolved marker and its original flow"); await s.finish();
  }
  if (selected("rejected")) {
    const s = await scenario("rejected"), A = await s.page("A"); await s.connect(A); await A.locator("[data-deposit]").click(); await A.waitForFunction(() => window.pendingWallet);
    await A.evaluate(() => window.pendingWallet.reject(4001)); await expect(A.locator("[data-deposit]")).toBeVisible(); assert.deepEqual(await s.intents(A), []); assert.deepEqual(await s.flowRecords(A), []);
    const B = await s.page("B"); await s.connect(B); await B.locator("[data-deposit]").click(); await B.waitForFunction(() => window.pendingWallet); assert.equal(s.state.sends.length, 2);
    await B.evaluate(() => window.pendingWallet.reject(4001)); await expect(B.locator("[data-deposit]")).toBeVisible();
    pass("An explicit rejection releases only its own unused record and permits a separate later user click, without an automatic retry"); await s.finish();
  }
  if (selected("unknown")) {
    const s = await scenario("unknown"), A = await s.page("A"), B = await s.page("B"); await s.connect(A); await s.connect(B); await A.locator("[data-deposit]").click(); await A.waitForFunction(() => window.pendingWallet);
    const held = await s.intents(A), saved = await s.flowRecords(A); await A.evaluate(() => window.pendingWallet.reject(4900));
    await expect(A.locator("[data-tx-status]")).toContainText("wallet request may still be open");
    await B.waitForFunction(async () => (await navigator.locks.query()).held.length === 0); s.state.instanceId = "synthetic-new-server";
    await B.locator("[data-deposit]").click(); await expect(B.locator("[data-deposit]")).toBeHidden();
    assert.equal(s.state.minted, 1); assert.equal(s.state.sends.length, 1); assert.deepEqual(await s.intents(B), held); assert.deepEqual(await s.flowRecords(B), saved);
    await B.reload({ waitUntil: "networkidle" }); await s.connect(B); await expect(B.locator("[data-deposit]")).toBeHidden(); assert.deepEqual(await s.intents(B), held);
    pass("Unknown outcomes never age out: another tab/reload/new server instance preserves the exact original marker and token with zero additional mint or send"); await s.finish();
  }
  if (selected("closed")) {
    const s = await scenario("closed"), A = await s.page("A"), B = await s.page("B"); await s.connect(A); await s.connect(B); await A.locator("[data-deposit]").click(); await A.waitForFunction(() => window.pendingWallet);
    const held = await s.intents(A), saved = await s.flowRecords(A); await A.close();
    await B.waitForFunction(async () => (await navigator.locks.query()).held.length === 0); await B.locator("[data-deposit]").click(); await expect(B.locator("[data-deposit]")).toBeHidden();
    assert.equal(s.state.sends.length, 1); assert.equal(s.state.minted, 1); assert.deepEqual(await s.intents(B), held); assert.deepEqual(await s.flowRecords(B), saved);
    pass("Closing the owning tab releases its native lock but leaves the durable unknown request authoritative; a new tab cannot resend"); await s.finish();
  }
  if (selected("hash")) {
    const s = await scenario("hash"), A = await s.page("A"); await s.connect(A); s.state.failReceipt = true; await A.locator("[data-deposit]").click(); await A.waitForFunction(() => window.pendingWallet);
    await A.evaluate(hash => window.pendingWallet.resolve(hash), originalHash);
    await expect(A.getByRole("button", { name: "Check original deposit", exact: true })).toBeVisible(); await expect(A.locator("[data-tx-status]")).toContainText(originalHash);
    assert.deepEqual(await s.intents(A), []); const saved = await s.flowRecords(A); assert.equal(JSON.parse(saved[0][1]).hash, originalHash);
    const B = await s.page("B"); await s.connect(B); await expect(B.getByRole("button", { name: "Check original deposit", exact: true })).toBeVisible(); s.state.failReceipt = false;
    await B.getByRole("button", { name: "Check original deposit", exact: true }).click(); await expect(B.locator("[data-tx-status]")).toContainText("Deposit confirmed");
    assert.equal(s.state.minted, 1); assert.equal(s.state.prepared, 1); assert.equal(s.state.sends.length, 1); assert.equal(JSON.parse((await s.flowRecords(B))[0][1]).hash, originalHash);
    const journals = await B.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("kleros-transactions:v1:")));
    assert(journals.some(([, raw]) => JSON.parse(raw).transactions.some(entry => entry.hash === originalHash && entry.status === "confirmed" && entry.blockNumber === 101)));
    pass("A returned hash is journaled before receipt failure; a different tab reacquires ownership and confirms only that original hash without preparing or sending again"); await s.finish();
  }
  if (selected("unsupported")) {
    const s = await scenario("unsupported", { unsupported: true }), A = await s.page("A");
    const saved = { kind: "deposit", wallet, token: "9".repeat(64), instanceId: "original-server", hash: originalHash };
    const key = "kleros-public-transaction-v1:" + JSON.stringify([ORIGIN, "deposit", wallet.toLowerCase(), EVENT.id, EVENT.contract.toLowerCase()]);
    await A.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw: JSON.stringify(saved) });
    await s.connect(A); await A.locator("[data-deposit]").click(); await expect(A.locator("[data-tx-status]")).toContainText("manual QR/address option");
    assert.equal(s.state.minted, 0); assert.equal(s.state.sends.length, 0); assert.deepEqual(await A.evaluate(() => window.fakeMethods), ["eth_requestAccounts"]); assert.equal(await A.evaluate(key => localStorage.getItem(key), key), JSON.stringify(saved));
    await expect(A.locator(".manual-option")).toBeVisible();
    pass("Missing Web Locks fails closed before flow lookup/mint/chain/sign/send, preserves original saved history, and retains manual deposit instructions"); await s.finish();
  }
  if (selected("scope")) {
    const s = await scenario("scope"), A = await s.page("A"), B = await s.page("B");
    await A.evaluate(async wallet => { const { acquireDepositOwnership } = await import("/deposit-ownership.js"); window.lease = await acquireDepositOwnership({ wallet }); }, wallet);
    const result = await B.evaluate(async ({ wallet, otherWallet }) => {
      const { acquireDepositOwnership, assertDepositOwnership } = await import("/deposit-ownership.js"), { EVENT, LEGACY_EVENT } = await import("/first-event/event.js");
      let sameScope; try { await acquireDepositOwnership({ wallet }); sameScope = "unsafe"; } catch (error) { sameScope = error.code; }
      const differentWallet = await acquireDepositOwnership({ wallet: otherWallet }); const differentEvent = await acquireDepositOwnership({ wallet, event: LEGACY_EVENT });
      let forged; try { assertDepositOwnership(differentWallet, { wallet }); forged = "unsafe"; } catch (error) { forged = error.code; }
      await differentWallet.release(); await differentEvent.release();
      let released; try { assertDepositOwnership(differentWallet, { wallet: otherWallet }); released = "unsafe"; } catch (error) { released = error.code; }
      return { sameScope, forged, released, current: EVENT.id !== LEGACY_EVENT.id };
    }, { wallet, otherWallet });
    assert.deepEqual(result, { sameScope: "DEPOSIT_REQUEST_BUSY", forged: "DEPOSIT_OWNERSHIP_LOST", released: "DEPOSIT_OWNERSHIP_LOST", current: true });
    await A.evaluate(() => window.lease.release());
    pass("Native lock scope rejects same-wallet/event overlap and forged/released leases while distinct wallets and current/legacy events remain independent");
    const expiry = await B.evaluate(async wallet => {
      const { acquireDepositOwnership } = await import("/deposit-ownership.js");
      const { createPublicTransactionFlow, resetUnusedPublicTransactionFlow } = await import("/public-transactions.js");
      const { EVENT } = await import("/first-event/event.js");
      const ownership = await acquireDepositOwnership({ wallet });
      const key = "kleros-public-transaction-v1:" + JSON.stringify([location.origin, "deposit", wallet, EVENT.id, EVENT.contract.toLowerCase()]);
      const old = JSON.stringify({ kind: "deposit", wallet, token: "7".repeat(64), instanceId: "original-instance" });
      const foreign = JSON.stringify({ kind: "deposit", wallet, token: "8".repeat(64), instanceId: "original-instance", hash: "0x" + "c".repeat(64) });
      localStorage.setItem(key, old); let reset, expired, calls = 0;
      try { resetUnusedPublicTransactionFlow({ wallet, kind: "deposit", token: "8".repeat(64), ownership }); reset = "unsafe"; } catch (error) { reset = error.code; }
      const wrongTokenPreserved = localStorage.getItem(key) === old;
      try { await createPublicTransactionFlow({ wallet, kind: "deposit", ownership, api: async () => {
        calls++; localStorage.setItem(key, foreign); throw Object.assign(Error("Synthetic expiry"), { code: "PUBLIC_TRANSACTION_EXPIRED" });
      } }); expired = "unsafe"; } catch (error) { expired = error.code; }
      const expiryPreserved = localStorage.getItem(key) === foreign;
      await ownership.release(); return { reset, wrongTokenPreserved, expired, expiryPreserved, calls };
    }, wallet);
    assert.deepEqual(expiry, { reset: "PUBLIC_TRANSACTION_SCOPE", wrongTokenPreserved: true, expired: "PUBLIC_TRANSACTION_SCOPE", expiryPreserved: true, calls: 1 });
    pass("Wrong-token reset and asynchronous expired-flow cleanup cannot erase a different original flow/hash or mint a replacement"); await s.finish();
  }
  assert.deepEqual(proof.external, []); assert.deepEqual(proof.errors, []); assert.deepEqual(await pins(), proof.sourceSha256); proof.status = "passed";
} catch (error) { proof.status = "failed"; proof.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  await browser?.close(); await fs.writeFile(path.join(OUT, "browser.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, "browser.json"), failure: proof.failure?.message }));
}
