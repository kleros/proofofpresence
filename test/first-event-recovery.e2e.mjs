// Actual entry/display/controller/account/sender code with synthetic HTTP and
// EIP-1193 responses only. No chain, real signature or financial send is used.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Interface } from "ethers";
import { chromium, expect } from "@playwright/test";
import { EVENT, LEGACY_EVENT } from "../public/first-event/event.js";
import { assertFirstEventManageDraft } from "../public/first-event-manage.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = path.join(ROOT, "artifacts/first-event-recovery", new Date().toISOString().replace(/[:.]/g, "-"));
const ORIGIN = "https://kleros-kickback.netlify.app", wallet = "0x" + "1".repeat(40), other = "0x" + "2".repeat(40);
const txHash = "0x" + "a".repeat(64), depositHash = "0x" + "d".repeat(64), blockHash = "0x" + "b".repeat(64);
const D = LEGACY_EVENT.depositWei, iface = new Interface(["function withdrawPending(address to,uint256 amount)"]);
const scope = { eventId: LEGACY_EVENT.id, wallet, chainId: 1, contract: LEGACY_EVENT.contract,
  abiVersion: LEGACY_EVENT.abiVersion, mode: LEGACY_EVENT.mode, instanceId: "synthetic-original-recovery" };
const policy = { mode: scope.mode, instanceId: scope.instanceId, contractVersion: scope.abiVersion, abiVersion: scope.abiVersion,
  contractProfile: { contractVersion: scope.abiVersion, abiVersion: scope.abiVersion, version: 10, financialModel: "v8", upgradeable: true,
    verified: true, testOnly: false, chainId: 1, challengeWindowSeconds: 86400, matchWindowSeconds: 86400 },
  chain: { chainId: 1 }, environment: { chainId: 1, production: true, network: "ethereum-mainnet" },
  walletSupport: { type: "eoa-only", eoa: true, eip7702: false, erc1271: false },
  capabilities: { production: true, browserWallet: true, walletTransactions: true, serverSigning: false,
    supportedAccountTypes: ["eoa"], contractWallets: false, eip7702: false, erc1271: false,
    transactionsReady: false, createEvents: false, manageEvents: false } };
let sequence = 0;
function makeDraft() {
  const params = { to: wallet, amountWei: D }, args = [wallet, D];
  return { ...scope, action: "withdrawPending", params, args, method: "withdrawPending", id: "original-recovery-draft-" + ++sequence,
    contractVersion: scope.abiVersion, scopeKind: "event-call", origin: ORIGIN, snapshot: "synthetic-original-fingerprint",
    expiresAt: Date.now() + 300000, valueWei: "0", summary: "Recover your original unused credit to the connected payer.",
    transaction: { to: LEGACY_EVENT.contract, from: wallet, chainId: 1, value: "0", data: iface.encodeFunctionData("withdrawPending", args) } };
}
const mutations = {
  event: draft => { draft.eventId = EVENT.id; },
  child: draft => { draft.contract = EVENT.contract; draft.transaction.to = EVENT.contract; },
  recipient: draft => { draft.args[0] = other; draft.params.to = other; draft.transaction.data = iface.encodeFunctionData("withdrawPending", draft.args); },
  value: draft => { draft.valueWei = "1"; draft.transaction.value = "1"; },
  args: draft => { draft.args[1] = String(BigInt(D) + 1n); },
  params: draft => { draft.params.amountWei = String(BigInt(D) + 1n); },
};
const snapshot = { schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, eventId: scope.eventId, mode: scope.mode,
  instanceId: scope.instanceId, chainId: 1, contract: scope.contract, status: "current", checkedAt: new Date().toISOString(), blockNumber: 100, blockHash,
  depositors: [{ wallet, totalReceivedWei: D, deposits: [{ txHash: depositHash, logIndex: 0, amountWei: D, blockNumber: 99, blockHash }] }],
  eventState: { phase: "Open", owner: other, eventStart: Date.parse(LEGACY_EVENT.startsAt) / 1000, endsAt: Date.parse(LEGACY_EVENT.endsAt) / 1000,
    claimDeadline: Date.parse(LEGACY_EVENT.startsAt) / 1000 + 7 * 86400, challengeEndsAt: 0, challengeDepositWei: "12345", stakers: [] } };
const proof = { kind: "original-event-recovery-focused-mock", status: "running", checks: [], source: {}, requests: [], jobs: [], scenarios: [], errors: [], blocked: [],
  limits: ["Actual root routing, database display, private auth controller, account checks and durable sender/journal run with synthetic HTTP/provider replies.",
    "The nonce signature, withdrawal send and canonical receipt are mocks. This is not a real financial, live-wallet, production or contract execution test. Backend actual-local proofs are separate."] };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const pass = (ok, label) => { assert(ok, label); proof.checks.push(label); };
let browser, page;
await fs.mkdir(OUT, { recursive: true });
try {
  proof.harnessSha256 = sha(await fs.readFile(fileURLToPath(import.meta.url)));
  for (const file of ["public/index.html", "public/entry.js", "public/first-event-display.js", "public/first-event-manage.js",
    "public/first-event/event.js", "public/event-read.js", "public/transaction-context.js", "public/v10-wallet-account.js", "public/wallet-connection.js"])
    proof.source[file] = sha(await fs.readFile(path.join(ROOT, file)));
  const exact = makeDraft();
  assert.equal(iface.getFunction("withdrawPending").selector, "0x8033b09f");
  assertFirstEventManageDraft(exact, scope, "withdrawPending", {}, ORIGIN, LEGACY_EVENT);
  for (const mutate of Object.values(mutations)) {
    const invalid = structuredClone(exact); mutate(invalid);
    assert.throws(() => assertFirstEventManageDraft(invalid, scope, "withdrawPending", {}, ORIGIN, LEGACY_EVENT));
  }
  pass(true, "Independent withdrawPending ABI encoding accepts original-child/self/positive credit and rejects six cross-scope or altered-term drafts");
  browser = await chromium.launch({ headless: true });
  async function newScenario(name, { draftFault = null, validationFault = false, failReceipt = false, unknownSend = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, serviceWorkers: "block" });
    let session = false, currentDraft = null, receiptUnavailable = failReceipt;
    const requests = [], jobs = [], errors = [];
    await context.addInitScript(({ wallet, blockHash, unknownSend, txHash }) => {
      const listeners = new Map(); window.walletMethods = []; window.sends = []; window.selectedWallet = wallet;
      window.emitWallet = (event, value) => { window.selectedWallet = value?.[0] ?? wallet; for (const callback of listeners.get(event) ?? []) callback(value); };
      window.ethereum = { on(event, callback) { const callbacks = listeners.get(event) ?? []; callbacks.push(callback); listeners.set(event, callbacks); },
        removeListener(event, callback) { listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== callback)); },
        async request(request) { window.walletMethods.push(request.method);
          if (["eth_requestAccounts", "eth_accounts"].includes(request.method)) return [window.selectedWallet];
          if (request.method === "eth_chainId") return "0x1";
          if (request.method === "eth_getCode") return "0x";
          if (request.method === "eth_getBlockByNumber") return { number: "0x64", hash: blockHash };
          if (request.method === "personal_sign") return "synthetic-auth-signature";
          if (request.method === "eth_sendTransaction") { window.sends.push(request.params[0]); if (unknownSend) throw Error("Synthetic wallet response unavailable"); return txHash; }
          throw Error("Unexpected wallet method: " + request.method);
        } };
    }, { wallet, blockHash, unknownSend, txHash });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), entry = { scenario: name, method: request.method(), pathname: url.pathname, search: url.search };
      requests.push(entry); proof.requests.push(entry);
      if (url.origin !== ORIGIN) { proof.blocked.push(url.origin); return route.abort(); }
      const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
      if (url.pathname === "/api/first-event/depositors" && url.search === "?eventId=" + LEGACY_EVENT.id) return json(snapshot);
      if (url.pathname === "/api/bootstrap" && url.search === "?background=1") return json({ kind: "event-read-transport", enabled: true,
        chainId: 1, contractVersion: scope.abiVersion, instanceId: scope.instanceId, walletContext: policy });
      if (url.pathname === "/api/kickback-setup") return json({ kind: "kickback-setup-display", mode: scope.mode, instanceId: scope.instanceId, session: session ? { mode: "wallet", wallet } : null });
      if (url.pathname === "/api/auth/challenge" && request.method() === "POST") { assert.deepEqual(request.postDataJSON(), { wallet }); return json({ nonce: "synthetic-original-nonce", message: "Sign in to review original unused credit" }); }
      if (url.pathname === "/api/auth/verify" && request.method() === "POST") { session = true; return json({ wallet }); }
      if (url.pathname === "/api/event-read-jobs" && request.method() === "POST") {
        const input = request.postDataJSON(); jobs.push(input); proof.jobs.push({ scenario: name, ...input }); assert(session);
        assert.equal(input.eventId, LEGACY_EVENT.id, "Recovery jobs cannot target the replacement");
        let result;
        if (input.operation === "participant-draft") {
          assert.equal(input.action, "withdrawPending"); assert.deepEqual(input.params, {});
          currentDraft = makeDraft(); result = structuredClone(currentDraft); if (draftFault) mutations[draftFault](result);
        } else if (input.operation === "validate") {
          assert.equal(input.draftId, currentDraft.id); result = { transaction: structuredClone(currentDraft.transaction) };
          if (validationFault) result.transaction.to = EVENT.contract;
        } else if (input.operation === "confirm") {
          assert.equal(input.hash, txHash); assert.equal(input.draftId, currentDraft.id);
          if (receiptUnavailable) return json({ code: "SYNTHETIC_RECEIPT_UNAVAILABLE", error: "Synthetic original receipt unavailable" }, 503);
          result = { status: "confirmed", hash: input.hash, draftId: input.draftId, eventId: LEGACY_EVENT.id, wallet, chainId: 1,
            contract: LEGACY_EVENT.contract, blockNumber: 101 };
        } else { proof.blocked.push("job:" + input.operation); return json({ error: "Unexpected job" }, 500); }
        return json({ kind: "event-read-job", schemaVersion: 1, requestId: input.requestId, operation: input.operation, eventId: LEGACY_EVENT.id,
          chainId: 1, contractVersion: scope.abiVersion, instanceId: scope.instanceId, wallet, state: "ready", expiresAt: Date.now() + 30000, result });
      }
      if (url.pathname.match(new RegExp("^/api/events/" + LEGACY_EVENT.id + "/drafts/[^/]+/submitted$")) && request.method() === "POST") {
        assert.equal(request.postDataJSON().hash, txHash); return json({ status: "submitted" });
      }
      if (url.pathname.startsWith("/api/") || request.method() !== "GET" || url.pathname === "/app.js") {
        proof.blocked.push(url.pathname + url.search); return json({ error: "Unexpected full-app, API or transaction request" }, 500);
      }
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1), file = path.resolve(ROOT, "public", relative);
      if (!file.startsWith(path.join(ROOT, "public") + path.sep)) { proof.blocked.push(url.pathname); return route.abort(); }
      try { const body = await fs.readFile(file), type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[path.extname(file)] ?? "application/octet-stream";
        return route.fulfill({ contentType: type, body });
      } catch { proof.blocked.push(url.pathname); return route.fulfill({ status: 404, body: "Missing local source" }); }
    });
    page = await context.newPage(); page.on("pageerror", error => { errors.push(error.message); proof.errors.push({ scenario: name, message: error.message }); });
    const originalURL = ORIGIN + "/#event=" + LEGACY_EVENT.id + "&view=participant&review=1";
    await page.goto(originalURL, { waitUntil: "networkidle" });
    await expect(page.locator("[data-first-event-display] h1")).toHaveText("Your deposit");
    await expect(page.locator("[data-first-event-display]")).toContainText(LEGACY_EVENT.contract);
    const normalized = new URL(page.url()), normalizedRoute = new URLSearchParams(normalized.hash.slice(1));
    assert.equal(normalized.origin, ORIGIN); assert.equal(normalized.pathname, "/");
    assert.equal(normalizedRoute.get("event"), LEGACY_EVENT.id); assert.equal(normalizedRoute.get("view"), "participant");
    assert.equal(normalizedRoute.get("deposit"), "manage"); assert.equal(normalizedRoute.get("review"), null);
    assert.deepEqual(requests.filter(item => item.pathname.startsWith("/api/")).map(item => item.pathname + item.search), ["/api/first-event/depositors?eventId=" + LEGACY_EVENT.id]);
    assert.deepEqual(await page.evaluate(() => window.walletMethods), []);
    const beforeConnect = requests.length;
    await page.locator("[data-manage-connect]").click(); await expect(page.locator("[data-manage-wallet]")).toContainText(wallet);
    await expect(page.locator('[data-manage-action="withdrawPending"]')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.walletMethods), ["eth_requestAccounts"]);
    assert(!requests.slice(beforeConnect).some(item => item.pathname.startsWith("/api/")));
    return { context, page, requests, jobs, errors, originalURL, allowReceipt() { receiptUnavailable = false; } };
  }

  let scenario = await newScenario("known-original", { failReceipt: true });
  pass(true, "Original review=1 entry renders from its own SQL scope without app.js/selected bootstrap, and Connect is accounts-only");
  await page.locator('[data-manage-action="withdrawPending"]').click(); await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  assert.deepEqual(scenario.jobs.map(job => job.operation), ["participant-draft"]);
  assert.deepEqual(scenario.jobs[0].params, {});
  const preparationMethods = await page.evaluate(() => window.walletMethods);
  assert.deepEqual(preparationMethods, ["eth_requestAccounts", "eth_chainId", "eth_accounts", "eth_getBlockByNumber",
    "eth_getCode", "eth_getBlockByNumber", "eth_chainId", "eth_accounts", "personal_sign"]);
  await page.locator("[data-manage-confirm]").click();
  await expect(page.locator("[data-manage-pending]")).toContainText(txHash);
  const sent = (await page.evaluate(() => window.sends))[0];
  assert.deepEqual(sent, { to: LEGACY_EVENT.contract, from: wallet, data: iface.encodeFunctionData("withdrawPending", [wallet, D]), value: "0x0", chainId: "0x1" });
  const sendMethods = (await page.evaluate(() => window.walletMethods)).slice(preparationMethods.length);
  assert.deepEqual(sendMethods, ["eth_accounts", "eth_chainId", "eth_chainId", "eth_accounts", "eth_getBlockByNumber",
    "eth_getCode", "eth_getBlockByNumber", "eth_chainId", "eth_accounts", "eth_sendTransaction"]);
  proof.walletReadBudget = { beforeSignIn: 7, beforeTransaction: 9, baselineBeforeSignIn: 14,
    finalAccountProofRetained: true, scope: "Synthetic EOA provider only; no production latency claim" };
  pass(true, "One complete browser account proof remains immediately before sign-in and one before transaction; seven duplicate preparation reads are removed");
  pass(true, "Explicit signed-in recovery uses participant-draft with empty input, exact original child/self calldata, zero ETH and unchanged validate/submitted/receipt pipeline");
  await expect(page.locator('[data-manage-action="withdrawPending"]')).toBeDisabled();
  await page.reload({ waitUntil: "networkidle" }); await page.locator("[data-manage-connect]").click();
  await expect(page.locator("[data-manage-check-original]")).toBeVisible();
  const beforeCheck = scenario.jobs.length; scenario.allowReceipt();
  await page.locator("[data-manage-check-original]").click(); await expect(page.locator("[data-manage-status]")).toContainText("Confirmed");
  assert(scenario.jobs.slice(beforeCheck).every(job => job.operation === "confirm" && job.hash === txHash));
  assert.equal((await page.evaluate(() => window.sends)).length, 0, "Reloaded original-hash receipt check never sends again");
  const journal = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("kleros-transactions:v1:")).flatMap(key => JSON.parse(localStorage.getItem(key)).transactions));
  assert(journal.some(entry => entry.hash === txHash && entry.status === "confirmed"));
  proof.scenarios.push({ name: "known-original", sent, originalHash: txHash, confirmedAfterReload: true });
  pass(true, "Receipt503 preserves exact original hash/journal across reload; explicit original receipt checking confirms without another send");
  await scenario.context.close();

  for (const fault of Object.keys(mutations)) {
    scenario = await newScenario("draft-" + fault, { draftFault: fault });
    await page.locator('[data-manage-action="withdrawPending"]').click();
    await expect(page.locator("[data-manage-status]")).toContainText(/changed|differs|belongs|expired|incomplete/i);
    assert.equal((await page.evaluate(() => window.sends)).length, 0); assert(!scenario.jobs.some(job => job.operation === "validate"));
    assert.equal(await page.locator("dialog[open]").count(), 0); await scenario.context.close();
  }
  pass(true, "Wrong event, replacement child, recipient, ETH value, args and canonical params all fail before review/send");
  scenario = await newScenario("changed-validation", { validationFault: true });
  await page.locator('[data-manage-action="withdrawPending"]').click(); await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  await page.locator("[data-manage-confirm]").click(); await expect(page.locator("[data-manage-status]")).toContainText(/differ|changed/i);
  assert.equal((await page.evaluate(() => window.sends)).length, 0); await scenario.context.close();
  pass(true, "A replacement recipient returned by final validation cannot reach the wallet");
  scenario = await newScenario("wallet-changed");
  await page.locator('[data-manage-action="withdrawPending"]').click(); await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  await page.evaluate(other => window.emitWallet("accountsChanged", [other]), other);
  await page.evaluate(() => document.querySelector("[data-manage-confirm]")?.click());
  assert.equal((await page.evaluate(() => window.sends)).length, 0); await scenario.context.close();
  pass(true, "Changing wallets revokes the prepared original recovery before a transaction request");
  scenario = await newScenario("unknown-wallet-response", { unknownSend: true });
  await page.locator('[data-manage-action="withdrawPending"]').click(); await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  await page.locator("[data-manage-confirm]").click(); await expect(page.locator("[data-manage-pending]")).toContainText("no recorded hash");
  assert.equal((await page.evaluate(() => window.sends)).length, 1);
  await expect(page.locator('[data-manage-action="withdrawPending"]')).toBeDisabled();
  const beforeReload = scenario.jobs.length;
  await page.reload({ waitUntil: "networkidle" }); await page.locator("[data-manage-connect]").click();
  await expect(page.locator("[data-manage-pending]")).toContainText("no recorded hash");
  await expect(page.locator('[data-manage-action="withdrawPending"]')).toBeDisabled();
  assert.equal((await page.evaluate(() => window.sends)).length, 0); assert.equal(scenario.jobs.length, beforeReload);
  await scenario.context.close();
  pass(true, "Unknown wallet response retains event-scoped awaiting intent across reload and blocks automatic or repeated withdrawal");
  assert(proof.jobs.every(job => job.eventId === LEGACY_EVENT.id && job.operation !== "bootstrap"));
  assert(!proof.requests.some(request => request.pathname === "/app.js" || request.search.includes("selectedEventId")));
  assert.deepEqual(proof.errors, []); assert.deepEqual(proof.blocked, []);
  for (const [file, expected] of Object.entries(proof.source)) assert.equal(sha(await fs.readFile(path.join(ROOT, file))), expected, "Source changed during focused recovery proof: " + file);
  proof.sourceMatchedAtCompletion = true; proof.status = "passed";
} catch (error) {
  proof.status = "failed"; proof.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (page && !page.isClosed()) proof.visibleText = await page.locator("body").textContent().catch(() => null);
} finally {
  await browser?.close(); await fs.writeFile(path.join(OUT, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, "proof.json"), failure: proof.failure?.message }));
}
