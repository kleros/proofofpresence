// Original private draft/validate/receipt path on isolated local V10 only.
// One CREATE + one funding deposit + one same-wallet withdrawal; no live RPC.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";
import { firstEventCreditRecoveryMatches } from "../src/workbench.mjs";
import { FIRST_EVENT_MANAGE_SCOPE, LEGACY_FIRST_EVENT_SCOPES } from "../src/first-event-manage-scope.mjs";
import { loadV10UpgradeableArtifacts } from "../src/v10-upgrade-artifacts.mjs";
import { V10_IMPLEMENTATION_SLOT } from "../src/v10-upgrade-verification.mjs";
import { V10_READ_BATCH_BYTECODE } from "../src/v10-read-batch.mjs";
import { INFURA_READ_METHOD_CREDITS } from "../src/rpc-read-scheduler.mjs";
const sourceFiles = ["src/workbench.mjs", "src/server.mjs", "src/event-read-jobs.mjs", "src/chain.mjs",
  "src/v10-upgrade-verification.mjs", "src/v10-production-wallets.mjs", "src/v10-read-batch.mjs",
  "src/rpc-read-scheduler.mjs", "test/first-event-credit-recovery.test.mjs"];
const sourcePins = () => Object.fromEntries(sourceFiles.map(file => [file,
  createHash("sha256").update(fs.readFileSync(new URL("../" + file, import.meta.url))).digest("hex")]));
// Measured on the same BrowserProvider/HTTP fixture before the targeted own-credit state.
const baseline = { prepare: { rpcRequests: 154, estimatedInfuraCredits: 8145 }, validate: { rpcRequests: 152, estimatedInfuraCredits: 8060 } };
const record = scope => ({ definition: { id: scope.eventId }, deployment: { ...scope, eventId: scope.eventId } });
test("credit recovery allowlist includes exact current/old children and no foreign scope", () => {
  for (const scope of [FIRST_EVENT_MANAGE_SCOPE, ...LEGACY_FIRST_EVENT_SCOPES]) {
    assert.equal(firstEventCreditRecoveryMatches(record(scope)), true);
    for (const patch of [{ eventId: "foreign-event" }, { chainId: 10200 }, { contract: "0x" + "3".repeat(40) }, { contractVersion: "truth-pays-v7" }])
      assert.equal(firstEventCreditRecoveryMatches({ ...record(scope), deployment: { ...record(scope).deployment, ...patch } }), false);
  }
});
test("private empty-params withdrawal derives own credit and retains original validation/once-only receipt guards", { timeout: 180000 }, async t => {
  const pins = sourcePins(), managed = new Map(), f = await createV10AppFixture({ origin: "https://credit-recovery.example.invalid",
    firstEventManageScope: r => !!managed.get(r?.definition?.id) && managed.get(r.definition.id).toLowerCase() === r?.deployment?.contract?.toLowerCase() });
  t.after(() => f.close());
  const w = f.workbench(), wallet = f.organizerAddress, owner = { id: "synthetic-credit-owner", mode: "wallet", wallet }, D = ethers.parseEther("0.01");
  const now = (await f.provider.getBlock("latest")).timestamp;
  const creation = await w.createFactoryDraft(owner, { title: "Synthetic original credit recovery", lumaUrl: "https://luma.com/synthetic-credit-recovery",
    startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "UTC", depositEth: "0.01" });
  await w.validateFactoryDraft(owner, creation.id);
  const createTx = await f.sendSyntheticTransaction(1, creation.transaction); await createTx.wait();
  await w.recordFactorySubmitted(owner, creation.id, createTx.hash); const created = await w.reconcileFactorySubmission(owner, creation.id, createTx.hash);
  managed.set(created.eventId, created.contract);
  const unrelated = "0x" + "4".repeat(40);
  await w.registerParticipant(created.eventId, { id: "synthetic-unrelated-guest", mode: "wallet", wallet: unrelated }, {});
  const funding = await f.sendSyntheticTransaction(1, { to: created.contract, data: "0xd0e30db0", value: D }); await funding.wait();
  const contract = w.contract(created.eventId); assert.equal(await contract.pendingDeposits(wallet), D);
  const eventRecord = w.events.get(created.eventId), deployment = eventRecord.deployment, originalSend = f.provider.send, phases = [];
  const originalFinalize = w.finalizeReadResult;
  let observed = null, measuredLabel = null, quoteAuthorityBefore, quoteCheckedBeforeDelivery = false;
  f.provider.send = async function(method, params) {
    if (observed) {
      assert(Object.hasOwn(INFURA_READ_METHOD_CREDITS, method), "Measured recovery phases use read-only RPCs");
      observed.push({ method, params: structuredClone(params) });
    }
    return originalSend.call(this, method, params);
  };
  t.after(() => { f.provider.send = originalSend; });
  w.finalizeReadResult = async function(operation, ...args) {
    if (measuredLabel === "prepare" && operation === "participant-draft") {
      assert.strictEqual(eventRecord.financialAccess, quoteAuthorityBefore,
        "Unverified quote getters cannot mutate financial access before the normal fresh delivery check");
      quoteCheckedBeforeDelivery = true;
    }
    return originalFinalize.call(this, operation, ...args);
  };
  t.after(() => { w.finalizeReadResult = originalFinalize; });
  async function measure(label, run) {
    const reads = []; observed = reads; measuredLabel = label;
    if (label === "prepare") { quoteAuthorityBefore = eventRecord.financialAccess; quoteCheckedBeforeDelivery = false; }
    let value;
    try { value = await run(); } finally { observed = null; measuredLabel = null; }
    const methods = {}, childReads = [], coder = ethers.AbiCoder.defaultAbiCoder();
    let currentSourceCodeBatches = 0;
    for (const { method, params } of reads) {
      methods[method] = (methods[method] ?? 0) + 1;
      if (method !== "eth_call") continue;
      const tx = params[0]; let targets = [], inputs = [];
      if (tx.to) { targets = [tx.to]; inputs = [tx.data]; }
      else if (tx.data?.startsWith(V10_READ_BATCH_BYTECODE)) {
        const [batchTargets, batchInputs, codeOnly] = coder.decode(["address[]", "bytes[]", "bool"], "0x" + tx.data.slice(V10_READ_BATCH_BYTECODE.length));
        if (codeOnly) {
          if (batchTargets.length === 5 && [created.contract, deployment.factory, deployment.implementation,
            deployment.factoryImplementation, deployment.upgradeAuthority].every(address => batchTargets.some(target => target.toLowerCase() === address.toLowerCase()))) currentSourceCodeBatches++;
          continue;
        }
        targets = [...batchTargets]; inputs = [...batchInputs];
      }
      targets.forEach((target, i) => {
        if (target.toLowerCase() !== created.contract.toLowerCase()) return;
        const parsed = contract.interface.parseTransaction({ data: inputs[i] });
        assert(parsed, "Every event read uses its actual V10 ABI"); childReads.push(parsed);
      });
    }
    const unrelatedMethods = new Set(["phase", "stakerCount", "attendeeCount", "stakers", "attendees", "challengers", "challenges",
      "status", "attended", "owed", "owedTotal", "reserved", "spare", "heldBack", "payoutShare", "pendingTotal", "challengeEscrow", "pendingChallenges", "challengeDeposit"]);
    assert(!childReads.some(read => unrelatedMethods.has(read.name)), "Own-credit recovery does not read registration, payouts, attendance or disputes");
    const creditReads = childReads.filter(read => read.name === "pendingDeposits");
    assert(creditReads.length > 0); assert(creditReads.every(read => read.args[0].toLowerCase() === wallet.toLowerCase()), "No other guest's credit is read");
    if (label === "prepare") {
      assert(quoteCheckedBeforeDelivery, "The public quote cannot bypass the fresh delivery boundary");
      assert.equal(currentSourceCodeBatches, 0, "The review is an amount quote, not a source-authorized transaction");
      assert(!reads.some(read => ["eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "eth_getCode", "eth_getStorageAt", "eth_getBalance"].includes(read.method)),
        "Quote preparation does not run source, history, account or unrelated balance reads");
      assert(childReads.every(read => ["owner", "pendingOwner", "pendingDeposits"].includes(read.name)),
        "Only fresh own-credit and authority getter reads precede the review; no withdrawal simulation");
      assert(reads.some(read => read.method === "eth_getBlockByNumber" && read.params[0] === "latest") &&
        reads.some(read => read.method === "eth_getBlockByNumber" && read.params[0] !== "latest"), "The quote still opens and closes a canonical anchor");
    } else {
      for (const birthHash of [deployment.controllerDeploymentTxHash, deployment.factoryDeploymentTxHash, deployment.deploymentTxHash])
        for (const method of ["eth_getTransactionByHash", "eth_getTransactionReceipt"])
          assert.equal(reads.filter(read => read.method === method && read.params[0].toLowerCase() === birthHash.toLowerCase()).length, 2,
            "Both complete source/history proofs retain every canonical birth transaction and receipt");
      assert.equal(currentSourceCodeBatches, 4, "Both full proofs retain separate opening and closing current-source batches");
      assert.equal(reads.filter(read => read.method === "eth_getLogs" && read.params[0].address?.toLowerCase?.() === deployment.upgradeAuthority.toLowerCase()).length, 2,
        "Complete controller history is still checked twice");
      assert(reads.some(read => read.method === "eth_getCode" && read.params[0].toLowerCase() === wallet.toLowerCase()), "The final wallet account proof stays fresh");
    }
    const profile = { label, rpcRequests: reads.length, estimatedInfuraCredits: reads.reduce((sum, read) => sum + INFURA_READ_METHOD_CREDITS[read.method], 0),
      methods, ownCreditReads: creditReads.length, currentSourceCodeBatches, fullHistoricalProofs: label === "prepare" ? 0 : 2, unrelatedGuestReads: 0 };
    phases.push(profile);
    assert(profile.rpcRequests <= Math.floor(baseline[label].rpcRequests * 0.95), "Recovery removes at least five percent of the measured baseline RPC work");
    assert(profile.estimatedInfuraCredits < baseline[label].estimatedInfuraCredits, "Recovery lowers weighted read work without dropping provenance proofs");
    if (label === "prepare") {
      assert(profile.rpcRequests <= Math.floor(baseline.prepare.rpcRequests * 0.2), "The quote removes at least eighty percent of preparation RPC work");
      assert(profile.estimatedInfuraCredits <= Math.floor(baseline.prepare.estimatedInfuraCredits * 0.2), "The quote removes at least eighty percent of preparation weighted work");
    }
    return value;
  }
  const paths = []; let cookie = "";
  async function request(path, body, { anonymous = false } = {}) {
    paths.push(path); const method = body === undefined ? "GET" : "POST";
    const response = await f.forward(path, { method, headers: anonymous ? {} : { cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: JSON.parse(response.body.toString()), headers: response.headers };
  }
  const payload = requestId => ({ requestId, operation: "participant-draft", eventId: created.eventId, action: "withdrawPending", params: {} });
  assert.equal((await request("/api/event-read-jobs", payload("anonymous"), { anonymous: true })).status, 401);
  const challenge = await request("/api/auth/challenge", { wallet });
  const signature = await f.wallet({ method: "personal_sign", params: [ethers.hexlify(ethers.toUtf8Bytes(challenge.data.message)), wallet] }, f.origin);
  const verified = await request("/api/auth/verify", { nonce: challenge.data.nonce, signature }); assert.equal(verified.status, 200);
  const cookies = verified.headers["set-cookie"]; cookie = (Array.isArray(cookies) ? cookies : [cookies]).map(value => value.split(";")[0]).join("; ");
  for (const [i, params] of [{ to: wallet }, { amountWei: String(D) }, { wallet }, { confirmed: true }].entries())
    assert.equal((await request("/api/event-read-jobs", { ...payload("bad-params-" + i), params })).status, 400);
  assert.equal((await request("/api/event-read-jobs", { ...payload("foreign-scope"), eventId: "foreign-event" })).status, 404);
  // Old challenge remains unavailable: legacy recovery does not grant organizer/dispute actions.
  assert.equal((await request("/api/event-read-jobs", { ...payload("old-challenge"), eventId: LEGACY_FIRST_EVENT_SCOPES[0].eventId, action: "challenge" })).status, 404);
  async function job(body) {
    const start = await request("/api/event-read-jobs", body); assert.equal(start.status, 202, JSON.stringify(start.data));
    for (let i = 0; i < 400; i++) {
      const result = await request("/api/event-read-jobs/" + body.requestId); assert.equal(result.status, 200);
      if (result.data.state !== "pending") return result.data;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Local credit recovery job did not finish");
  }
  const ready = await measure("prepare", () => job(payload("own-credit"))); assert.equal(ready.state, "ready", JSON.stringify(ready)); const draft = ready.result;
  assert.equal(draft.action, "withdrawPending"); assert.equal(draft.method, "withdrawPending"); assert.equal(draft.valueWei, "0");
  assert.deepEqual(draft.params, { to: wallet, amountWei: String(D) }); assert.deepEqual(draft.args, [wallet, String(D)]);
  assert.deepEqual(draft.transaction, { to: created.contract, from: wallet, chainId: 1, value: "0", data: contract.interface.encodeFunctionData("withdrawPending", [wallet, D]) });
  const expired = await request("/api/event-read-jobs/own-credit"); assert.equal(expired.data.state, "expired");
  const session = { id: draft.sessionId, wallet, mode: "wallet" };
  // Only the reviewed public+published event may use the quote. A private event
  // retains its original complete prepare checks, even for an authorized owner.
  const visibility = eventRecord.definition.visibility, privateReads = [];
  let privateFallback;
  try {
    eventRecord.definition.visibility = "private"; observed = privateReads;
    privateFallback = await w.createDraft(created.eventId, session, { action: "withdrawPending", params: { to: wallet, amountWei: String(D) } });
  } finally { observed = null; eventRecord.definition.visibility = visibility; }
  assert.equal(privateFallback.action, "withdrawPending");
  assert(!privateFallback.summary.includes("checked when you confirm"), "Private preparation is not presented as a lightweight quote");
  for (const birthHash of [deployment.controllerDeploymentTxHash, deployment.factoryDeploymentTxHash, deployment.deploymentTxHash])
    assert.equal(privateReads.filter(read => read.method === "eth_getTransactionByHash" && read.params[0].toLowerCase() === birthHash.toLowerCase()).length, 2,
      "Private preparation retains both complete source proofs");
  assert(privateReads.some(read => read.method === "eth_call" && read.params[0].to?.toLowerCase() === created.contract.toLowerCase() &&
    read.params[0].data?.startsWith(contract.interface.getFunction("withdrawPending").selector)), "Private preparation retains the actual withdrawal simulation");
  for (const change of [d => { d.args[0] = "0x" + "3".repeat(40); }, d => { d.args[1] = "1"; }, d => { d.transaction.value = "1"; },
    d => { d.contract = "0x" + "3".repeat(40); }, d => { d.origin = "https://foreign.example.invalid"; }]) {
    const tampered = structuredClone(draft); change(tampered);
    await assert.rejects(w.finalizeReadResult("participant-draft", tampered, session, created.eventId), { code: "DRAFT_SCOPE" });
  }
  await assert.rejects(w.finalizeReadResult("participant-draft", draft, { ...session, id: "foreign-session" }, created.eventId), { code: "DRAFT_SCOPE" });
  const layout = loadV10UpgradeableArtifacts().event.storageLayout.storage;
  const slot = label => {
    const entry = layout.find(field => field.label === label); assert(entry && entry.offset === 0);
    return ethers.toBeHex(BigInt(entry.slot), 32);
  };
  const creditSlot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [wallet, BigInt(slot("pendingDeposits"))]));
  const negatives = [];
  for (const [label, storageSlot, value, expected] of [
    ["changed-own-credit", creditSlot, ethers.toBeHex(D - 1n, 32), "STALE_DRAFT"],
    ["changed-owner", slot("owner"), ethers.zeroPadValue(unrelated, 32), "STALE_DRAFT"],
    // The unchanged public sanitizer withholds the verifier's internal error code.
    ["changed-implementation", V10_IMPLEMENTATION_SLOT, ethers.ZeroHash, "SERVICE_UNAVAILABLE"],
  ]) {
    const snapshot = await f.provider.send("evm_snapshot", []);
    try {
      await f.provider.send("evm_setAccountStorageAt", [created.contract, storageSlot, value]); await f.provider.send("evm_mine", []);
      const denied = await job({ requestId: label, operation: "validate", eventId: created.eventId, draftId: draft.id });
      assert.equal(denied.state, "failed", JSON.stringify(denied)); assert.equal(denied.error.code, expected); negatives.push({ label, code: denied.error.code });
    } finally { assert.equal(await f.provider.send("evm_revert", [snapshot]), true); }
  }
  assert.equal(await contract.pendingDeposits(wallet), D); assert.equal((await contract.owner()).toLowerCase(), wallet.toLowerCase());
  const validated = await measure("validate", () => job({ requestId: "validate-own-credit", operation: "validate", eventId: created.eventId, draftId: draft.id }));
  assert.equal(validated.state, "ready", JSON.stringify(validated)); assert.deepEqual(validated.result.transaction, draft.transaction);
  const beforeBalance = await f.provider.getBalance(wallet), sent = await f.sendSyntheticTransaction(1, validated.result.transaction), receipt = await sent.wait();
  assert.equal(receipt.status, 1);
  assert.equal((await request(`/api/events/${created.eventId}/drafts/${draft.id}/submitted`, { hash: sent.hash })).status, 200);
  const confirm = requestId => job({ requestId, operation: "confirm", eventId: created.eventId, draftId: draft.id, hash: sent.hash });
  const confirmed = await confirm("confirm-own-credit"); assert.equal(confirmed.state, "ready", JSON.stringify(confirmed)); assert.equal(confirmed.result.status, "confirmed");
  assert.equal(confirmed.result.hash, sent.hash); assert.equal(confirmed.result.wallet, wallet); assert.equal(await contract.pendingDeposits(wallet), 0n);
  const tx = await f.provider.getTransaction(sent.hash), afterBalance = await f.provider.getBalance(wallet);
  assert.equal(afterBalance - beforeBalance + receipt.gasUsed * tx.gasPrice, D);
  const nonce = await f.provider.getTransactionCount(wallet);
  assert.equal((await confirm("confirm-same-original-again")).result.hash, sent.hash);
  assert.equal(await f.provider.getTransactionCount(wallet), nonce);
  const zero = await job(payload("empty-credit-after-recovery")); assert.equal(zero.state, "failed"); assert.equal(zero.error.code, "INSUFFICIENT_CREDIT");
  const again = await job({ requestId: "validate-used-review", operation: "validate", eventId: created.eventId, draftId: draft.id });
  assert.equal(again.state, "failed"); assert.equal(again.error.code, "STALE_DRAFT");
  assert(!paths.some(path => path.startsWith("/api/bootstrap") || path === `/api/events/${created.eventId}`));
  assert.equal(f.stats.backendSigningCalls, 0);
  assert.deepEqual(sourcePins(), pins, "Profiled source must remain unchanged throughout the run");
  t.diagnostic(JSON.stringify({ kind: "actual-local-credit-recovery", createSends: 1, fundingDepositSends: 1, withdrawalSends: 1,
    sameWallet: true, amountWei: String(D), remainingPendingWei: "0", repeatedReceiptNoSend: true, fullBootstrapRequests: 0,
    baseline, phases, negatives, privateFallback: { fullHistoricalProofs: 2, simulated: true, rpcRequests: privateReads.length }, sourcePins: pins,
    limits: ["RPC counts and credits use the isolated local BrowserProvider, not a production latency measurement.",
      "Stale-state negatives perturb isolated Ganache storage and restore snapshots; no extra financial sends."] }));
});
