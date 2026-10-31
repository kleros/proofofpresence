// Focused UI boundary test: real saved-display/controller/sender/account checks;
// synthetic EOA provider and HTTP jobs only. No chain, signature or send is real.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Interface } from "ethers";
import { chromium, expect } from "@playwright/test";
import { EVENT } from "../public/first-event/event.js";
import { assertFirstEventManageDraft } from "../public/first-event-manage.js";
const ROOT = fileURLToPath(new URL("../", import.meta.url)), OUT = path.join(ROOT, "artifacts/first-event-manage", new Date().toISOString().replace(/[:.]/g, "-"));
const ORIGIN = "http://127.0.0.1:43129", wallet = "0x" + "1".repeat(40), payer = "0x" + "2".repeat(40), other = "0x" + "3".repeat(40), txHash = "0x" + "a".repeat(64), blockHash = "0x" + "b".repeat(64);
const scope = { eventId: EVENT.id, wallet, chainId: 1, contract: EVENT.contract, abiVersion: EVENT.abiVersion, mode: EVENT.mode, instanceId: "synthetic-manage-ui" };
const iface = new Interface(["function registerStakers(address[])", "function postAttendance(address[],uint256)", "function challenge() payable", "function matchChallenge(address) payable", "function resolveChallenge(address)"]);
const policy = { mode: EVENT.mode, instanceId: scope.instanceId, contractVersion: EVENT.abiVersion, abiVersion: EVENT.abiVersion,
  contractProfile: { contractVersion: EVENT.abiVersion, abiVersion: EVENT.abiVersion, version: 10, financialModel: "v8", upgradeable: true, verified: true, testOnly: false, chainId: 1, challengeWindowSeconds: 86400, matchWindowSeconds: 86400 },
  chain: { chainId: 1 }, environment: { chainId: 1, production: true, network: "ethereum-mainnet" },
  walletSupport: { type: "eoa-only", eoa: true, eip7702: false, erc1271: false },
  capabilities: { production: true, browserWallet: true, walletTransactions: true, serverSigning: false, supportedAccountTypes: ["eoa"], contractWallets: false, eip7702: false, erc1271: false, transactionsReady: false, createEvents: false, manageEvents: false } };
let draftSequence = 0;
const makeDraft = (action, params) => {
  const method = { register: "registerStakers", postAttendance: "postAttendance", challenge: "challenge", match: "matchChallenge", resolve: "resolveChallenge" }[action];
  const args = action === "register" ? [params.wallets] : action === "postAttendance" ? [params.attendedWallets, EVENT.depositWei] : action === "challenge" ? [] : [params.wallet ?? wallet];
  const value = ["challenge", "match"].includes(action) ? "12345" : "0";
  return { ...scope, action, method, args, params, id: "draft-" + ++draftSequence, contractVersion: EVENT.abiVersion, scopeKind: "event-call", origin: ORIGIN,
    snapshot: "synthetic-fingerprint", expiresAt: Date.now() + 300000, valueWei: value, summary: "Synthetic " + action + " review",
    transaction: { to: EVENT.contract, from: wallet, chainId: 1, value, data: iface.encodeFunctionData(method, args) } };
};
const snapshot = { schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, eventId: EVENT.id, mode: EVENT.mode, instanceId: scope.instanceId, chainId: 1, contract: EVENT.contract,
  status: "current", checkedAt: "2026-10-30T10:00:00.000Z", blockNumber: 100, blockHash,
  depositors: [{ wallet: payer, totalReceivedWei: EVENT.depositWei, deposits: [{ txHash, logIndex: 0, amountWei: EVENT.depositWei, blockNumber: 99, blockHash }] }],
  eventState: { phase: "Open", owner: wallet, eventStart: 1, endsAt: 2, claimDeadline: 4000000000, challengeEndsAt: 0, challengeDepositWei: "12345", chainTimestamp: 100,
    stakers: [] } };
const proof = { kind: "first-event-manage-focused-mock", status: "running", checks: [], source: {}, requests: [], walletMethods: [], sends: [], errors: [], blocked: [],
  limits: ["Real saved-display, private auth controller, EOA account classifier, exact calldata checks and durable sender/journal execute with synthetic HTTP/provider responses.", "No actual chain, wallet signature, contract call, Kleros case or financial transaction is exercised. Backend actual authorization tests are independent."] };
const pass = (condition, label) => { assert(condition, label); proof.checks.push(label); };
let browser, page, currentDraft, failReceipt = false, tamper = null, jobs = [], session = false;
await fs.mkdir(OUT, { recursive: true });
try {
  // Independent ABI encodings exercise the exported narrow client guard.
  for (const [action, params] of [["register", { wallets: [payer] }], ["postAttendance", { attendedWallets: [payer] }], ["challenge", {}], ["match", { wallet: payer }], ["resolve", { wallet: payer }]]) {
    const draft = makeDraft(action, params); assertFirstEventManageDraft(draft, scope, action, params, ORIGIN);
    for (const alter of [d => { d.transaction.to = other; }, d => { d.transaction.data += "00"; }, d => { d.valueWei = "99"; }, d => { d.wallet = other; }, d => { d.instanceId = "other-instance"; }]) {
      const invalid = structuredClone(draft); alter(invalid); assert.throws(() => assertFirstEventManageDraft(invalid, scope, action, params, ORIGIN));
    }
  }
  pass(true, "Five allowed methods accept independently ABI-encoded exact calls and reject recipient/calldata/value/wallet/server changes");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, serviceWorkers: "block" });
  await context.addInitScript(({ wallet, blockHash }) => {
    const listeners = new Map(); window.walletMethods = []; window.sends = []; window.selectedWallet = wallet;
    window.emitWallet = (event, value) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    window.ethereum = { on(event, listener) { const list = listeners.get(event) ?? []; list.push(listener); listeners.set(event, list); }, removeListener(event, listener) { listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener)); },
      async request(request) { window.walletMethods.push(request.method);
        if (["eth_requestAccounts", "eth_accounts"].includes(request.method)) return [window.selectedWallet];
        if (request.method === "eth_chainId") return "0x1";
        if (request.method === "eth_getCode") return "0x";
        if (request.method === "eth_getBlockByNumber") return { number: "0x64", hash: blockHash };
        if (request.method === "personal_sign") return "synthetic-signature";
        if (request.method === "eth_sendTransaction") { window.sends.push(request.params[0]); if (window.failUnknown) throw Error("Synthetic wallet response unavailable"); return "0x" + String(window.sends.length).padStart(64, "0"); }
        throw Error("Unexpected wallet method: " + request.method);
      } };
  }, { wallet, blockHash });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    proof.requests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (url.origin !== ORIGIN) { proof.blocked.push(url.origin); return route.abort(); }
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/luma-launch.css"></head><body class="launch-mode"><main id="root"></main><script type="module">import {mountFirstEventDisplay} from '/first-event-display.js';window.handoffs=[];window.display=mountFirstEventDisplay({root:document.querySelector('#root'),view:location.hash==='#recovery'?'recovery':'organizer',onReview:intent=>window.handoffs.push(intent)});</script></body></html>` });
    if (url.pathname === "/api/first-event/depositors") return json(snapshot);
    if (url.pathname === "/api/bootstrap" && url.search === "?background=1") return json({ kind: "event-read-transport", enabled: true, chainId: 1, contractVersion: EVENT.abiVersion, instanceId: scope.instanceId, walletContext: policy });
    if (url.pathname === `/api/events/${EVENT.id}/access`) return json({ kind: "event-access", eventId: EVENT.id, chainId: 1, contract: EVENT.contract, instanceId: scope.instanceId, wallet, owner: wallet, pendingOwner: "0x" + "0".repeat(40), role: "owner", revision: 0, admins: [], staff: [], checkins: [] });
    if (url.pathname === "/api/kickback-setup") return json({ kind: "kickback-setup-display", mode: EVENT.mode, instanceId: scope.instanceId, session: session ? { mode: "wallet", wallet } : null });
    if (url.pathname === "/api/auth/challenge") return json({ nonce: "synthetic-auth-nonce", message: "Sign in to the synthetic first event" });
    if (url.pathname === "/api/auth/verify") { session = true; return json({ wallet }); }
    if (url.pathname === "/api/event-read-jobs" && request.method() === "POST") {
      const input = request.postDataJSON(); jobs.push(input); let result;
      if (input.operation === "adopt-payer") result = { kind: "owner-reviewed-payer", eventId: EVENT.id, chainId: 1, contract: EVENT.contract, participantId: "synthetic-payer", wallet: payer };
      else if (["manage-draft", "participant-draft"].includes(input.operation)) {
        currentDraft = makeDraft(input.action, input.params); result = structuredClone(currentDraft);
        if (tamper === "recipient") result.transaction.to = other;
      } else if (input.operation === "validate") {
        result = { transaction: structuredClone(currentDraft.transaction) };
        if (tamper === "validate") result.transaction.value = "999";
      } else if (input.operation === "confirm") {
        if (failReceipt) return json({ error: "Synthetic receipt transport unavailable", code: "UNAVAILABLE" }, 503);
        result = { status: "confirmed", hash: input.hash, draftId: input.draftId, eventId: EVENT.id, wallet, chainId: 1, blockNumber: 101 };
        if (currentDraft?.action === "register") snapshot.eventState.stakers = [{ wallet: payer, status: 1, attended: false, challenge: { state: 0, depositWei: "0", matchDeadline: 0, localId: "0" } }];
      } else throw Error("Unexpected job " + input.operation);
      return json({ kind: "event-read-job", schemaVersion: 1, requestId: input.requestId, operation: input.operation, eventId: EVENT.id, chainId: 1,
        contractVersion: EVENT.abiVersion, instanceId: scope.instanceId, wallet, state: "ready", expiresAt: Date.now() + 30000, result });
    }
    if (url.pathname === `/api/events/${EVENT.id}/participants/synthetic-payer` && request.method() === "PATCH") { assert.deepEqual(request.postDataJSON(), { admission: "approved" }); return json({ admission: "approved" }); }
    if (url.pathname.match(/\/drafts\/[^/]+\/submitted$/) && request.method() === "POST") return json({ status: "submitted" });
    if (url.pathname.startsWith("/api/")) { proof.blocked.push(url.pathname); return json({ error: "Unexpected API" }, 500); }
    const file = path.resolve(ROOT, "public", "." + url.pathname);
    if (!file.startsWith(path.join(ROOT, "public") + path.sep)) return route.abort();
    try { const body = await fs.readFile(file); proof.source[url.pathname] = createHash("sha256").update(body).digest("hex"); return route.fulfill({ contentType: url.pathname.endsWith(".css") ? "text/css" : "text/javascript", body }); }
    catch { proof.blocked.push(url.pathname); return route.fulfill({ status: 404, body: "Missing local source" }); }
  });
  page = await context.newPage(); page.on("pageerror", error => proof.errors.push(error.message));
  await page.goto(ORIGIN, { waitUntil: "networkidle" });
  const reviewChallenge = async () => {
    const tools = page.locator("[data-manage-participant-tools]");
    if (!(await tools.evaluate(node => node.open))) await tools.locator(":scope > summary").click();
    await page.locator('[data-manage-action="challenge"]').click();
  };
  await expect(page.locator("[data-manage-register]")).toBeHidden();
  pass(proof.requests.filter(item => item.pathname.startsWith("/api/")).every(item => item.pathname === "/api/first-event/depositors"), "Saved Manage renders with only the SQL receipt GET and no auth, chain or selected bootstrap");
  const beforeConnect = proof.requests.length;
  await page.locator("[data-manage-connect]").click(); await expect(page.locator("[data-manage-wallet]")).toContainText(wallet);
  await page.waitForLoadState("networkidle");
  assert.deepEqual(await page.evaluate(() => window.walletMethods), ["eth_requestAccounts"]);
  pass(!proof.requests.slice(beforeConnect).some(item => item.pathname.startsWith("/api/")), "Manage Connect is accounts-only with zero API, signature, chain or send requests");
  await page.locator("[data-manage-access-load]").click(); await expect(page.locator("[data-manage-access-status]")).toContainText("Contract owner");
  await page.locator("[data-manage-register]").click();
  await expect(page.locator("[data-manage-payer-form]")).toBeVisible();
  pass(!jobs.length && (await page.evaluate(() => window.sends)).length === 0, "Canonical payer checkbox/note review precedes adoption, admission and any transaction");
  await page.locator("[data-manage-payer-form] input[name=confirmed]").check();
  await page.getByRole("button", { name: "Review registration", exact: true }).click();
  await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  assert.deepEqual(jobs.map(item => item.operation), ["adopt-payer", "manage-draft"]);
  pass(proof.requests.some(item => item.pathname === "/api/auth/challenge") && (await page.evaluate(() => window.walletMethods)).filter(item => item === "personal_sign").length === 1 && !jobs.some(item => item.operation === "bootstrap"), "Explicit owner action signs in and runs scoped adoption+admission+registration without a full event bootstrap");
  await page.locator("[data-manage-confirm]").click();
  await expect(page.locator("[data-manage-status]")).toContainText("Confirmed transaction");
  const firstSend = (await page.evaluate(() => window.sends))[0];
  assert.deepEqual(firstSend, { to: EVENT.contract, from: wallet, data: iface.encodeFunctionData("registerStakers", [[payer]]), value: "0x0", chainId: "0x1" });
  pass((await page.evaluate(() => window.handoffs)).length === 0 && jobs.some(item => item.operation === "validate") && jobs.some(item => item.operation === "confirm"), "Registration uses exact original sender/validate/submitted/receipt path and remains on Manage");
  await expect(page.locator("[data-manage-attended]")).toBeEnabled();
  snapshot.eventState.endsAt = 4000000000; await page.locator("[data-display-refresh]").click(); await page.waitForLoadState("networkidle");
  await page.locator("[data-manage-attended]").check();
  await expect(page.locator("[data-manage-post]")).toBeDisabled();
  pass(true, "Attendance posting stays disabled before the immutable event end");
  snapshot.eventState.endsAt = 2; await page.locator("[data-display-refresh]").click(); await page.waitForLoadState("networkidle");
  await page.locator("[data-manage-attendance] textarea").fill("Verified this exact registered payer attended the event.");
  await page.locator("[data-manage-attendance] input[name=confirmed]").check();
  await page.locator("[data-manage-post]").click(); await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  assert.deepEqual(currentDraft.args[0], [payer]);
  await page.locator("[data-manage-confirm]").click(); await expect(page.locator("[data-manage-status]")).toContainText("Confirmed transaction");
  pass((await page.evaluate(() => window.sends)).length === 2 && currentDraft.method === "postAttendance" && (await page.evaluate(() => window.handoffs)).length === 0, "One reviewed attendance batch sends the exact selected list; no per-row on-chain check-in or legacy navigation occurs");
  tamper = "recipient";
  await reviewChallenge();
  await expect(page.locator("[data-manage-status]")).toContainText("differs from the exact reviewed");
  pass((await page.evaluate(() => window.sends)).length === 2 && await page.locator("[data-manage-confirm]").count() === 1 && !(await page.locator("[data-manage-review]").evaluate(node => node.open)), "A changed draft recipient is rejected before a wallet transaction request");
  tamper = null;
  await reviewChallenge(); await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  tamper = "validate"; await page.locator("[data-manage-confirm]").click();
  await expect(page.locator("[data-manage-status]")).toContainText("Authoritative transaction terms differ");
  pass((await page.evaluate(() => window.sends)).length === 2, "Changed final validation bytes prevent any wallet send");
  tamper = null;
  await reviewChallenge(); await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  await page.evaluate(other => { window.selectedWallet = other; window.emitWallet("accountsChanged", [other]); }, other);
  await expect(page.locator("[data-manage-connect]")).toBeVisible();
  pass(!(await page.locator("[data-manage-review]").evaluate(node => node.open)) && (await page.evaluate(() => window.sends)).length === 2, "Changing the wallet removes the unsigned review and old-wallet controls without sending");
  await page.evaluate(wallet => { window.selectedWallet = wallet; }, wallet); await page.locator("[data-manage-connect]").click();
  await reviewChallenge(); await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  failReceipt = true; await page.locator("[data-manage-confirm]").click();
  await expect(page.locator("[data-manage-status]")).toContainText("Synthetic receipt transport unavailable");
  await expect(page.locator("[data-manage-check-original]")).toBeVisible();
  const sendsBeforeReload = (await page.evaluate(() => window.sends)).length;
  await page.reload({ waitUntil: "networkidle" }); await page.locator("[data-manage-connect]").click();
  await expect(page.locator("[data-manage-check-original]")).toBeVisible();
  const jobCount = jobs.length; await expect(page.locator('[data-manage-action="challenge"]')).toBeDisabled();
  pass(jobs.length === jobCount && (await page.evaluate(() => window.sends)).length === 0 && sendsBeforeReload === 3, "Receipt failure and reload restore the original hash and block another prepare/send");
  failReceipt = false; await page.locator("[data-manage-check-original]").click();
  await expect(page.locator("[data-manage-status]")).toContainText("Confirmed original transaction");
  pass((await page.evaluate(() => window.sends)).length === 0 && jobs.at(-1).operation === "confirm", "Explicit original receipt recovery reconciles the recorded draft/hash without resending");
  await page.evaluate(() => { window.failUnknown = true; });
  await reviewChallenge(); await expect(page.locator("[data-manage-confirm]")).toBeVisible();
  await page.locator("[data-manage-confirm]").click(); await expect(page.locator("[data-manage-status]")).toContainText("Synthetic wallet response unavailable");
  await expect(page.locator('[data-manage-action="challenge"]')).toBeDisabled();
  const heldRecord = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("kleros-first-event-manage-intent:v1:")));
  assert(heldRecord); assert.equal(JSON.parse(heldRecord[1]).phase, "awaiting-wallet");
  await page.reload({ waitUntil: "networkidle" }); const beforeUnknownConnect = jobs.length;
  await page.locator("[data-manage-connect]").click(); await expect(page.locator("[data-manage-pending]")).toContainText("no recorded hash");
  await expect(page.locator('[data-manage-action="challenge"]')).toBeDisabled();
  pass(jobs.length === beforeUnknownConnect && (await page.evaluate(() => window.sends)).length === 0 && await page.evaluate(key => localStorage.getItem(key), heldRecord[0]) === heldRecord[1], "Unknown wallet outcome keeps its exact durable marker across error/review close/reload and disables new financial actions");
  await page.evaluate(other => { window.selectedWallet = other; window.emitWallet("accountsChanged", [other]); }, other);
  await page.locator("[data-manage-connect]").click(); await expect(page.locator("[data-manage-pending]")).toHaveText("");
  pass(await page.evaluate(key => localStorage.getItem(key), heldRecord[0]) === heldRecord[1], "Another wallet cannot see or clear the first wallet's unresolved request");
  // Fresh synthetic fixture states only: product code never clears these records.
  await page.evaluate(async ({ scope, hash }) => {
    window.display.dispose(); localStorage.clear();
    const { createTransactionJournal } = await import('/transaction-context.js');
    createTransactionJournal(localStorage).record(scope, { hash, draftId: 'public-deposit-draft', action: 'deposit' });
    const foreign = ['foreign-instance', scope.mode, 'unrelated-event', 1, scope.contract.toLowerCase(), scope.wallet.toLowerCase(), scope.abiVersion].map(encodeURIComponent).join(':');
    localStorage.setItem('kleros-transactions:v1:' + foreign, '{corrupt unrelated record');
  }, { scope, hash: txHash });
  await page.reload({ waitUntil: "networkidle" }); const beforeDepositConnect = jobs.length;
  await page.locator("[data-manage-connect]").click(); await expect(page.locator("[data-manage-original-deposit]")).toBeVisible();
  await expect(page.locator("[data-manage-copy-hash]")).toBeVisible(); await expect(page.locator("[data-manage-check-original]")).toHaveCount(0);
  await expect(page.locator('[data-manage-action="challenge"]')).toBeDisabled();
  pass(jobs.length === beforeDepositConnect && await page.locator("[data-manage-original-deposit]").getAttribute("href") === "/first-event/" && (await page.locator("[data-manage-pending]").textContent()).includes(txHash), "A public-token deposit pending journal blocks Manage sends and links its original deposit page instead of using private confirmation; unrelated corrupt scope is ignored");
  await page.setViewportSize({ width: 390, height: 844 });
  pass(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Compact Manage actions fit a mobile viewport");
  await page.screenshot({ path: path.join(OUT, "manage-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1360, height: 1000 }); await page.screenshot({ path: path.join(OUT, "manage-desktop.png"), fullPage: true });
  proof.walletMethods = await page.evaluate(() => window.walletMethods); proof.sends = [firstSend]; proof.jobs = jobs.map(item => ({ operation: item.operation, action: item.action, params: item.params }));
  assert.deepEqual(proof.blocked, []); assert.deepEqual(proof.errors, []);
  pass(!jobs.some(item => item.operation === "bootstrap") && !proof.requests.some(item => item.search.includes("selectedEventId")), "No action or recovery runs a selected-event bootstrap");
  proof.status = "passed";
} catch (error) {
  proof.status = "failed"; proof.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (page) { proof.body = await page.locator("body").textContent().catch(() => null); await page.screenshot({ path: path.join(OUT, "failure.png"), fullPage: true }).catch(() => {}); }
} finally {
  await browser?.close(); await fs.writeFile(path.join(OUT, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, proof: path.join(OUT, "proof.json"), failure: proof.failure?.message }));
}
