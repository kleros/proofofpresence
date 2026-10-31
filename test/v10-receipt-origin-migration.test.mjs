// Offline private-map/proof tests. No chain, signer, live state or network.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { createV10ReceiptContext, V10_HISTORICAL_RECEIPT_ORIGINS } from "../src/v10-receipt-context.mjs";
const OLD = "https://kleros-luma-v10-ethereum.netlify.app", CURRENT = "https://kleros-kickback.netlify.app", CUSTOM = "https://kickback.kleros.io";
const PROFILE = "kleros-event-v10-uups", wallet = "0x" + "1".repeat(40), target = "0x" + "2".repeat(40), knownHash = ethers.id("synthetic original submitted hash");
function fixture() {
  const drafts = new Map(), calls = [], policies = [];
  const chain = { production: true, chainId: 1, manifest: { factoryDeployment: { factory: target, contractVersion: PROFILE, abiVersion: PROFILE } },
    provider: { send() { assert.fail("No RPC is permitted in offline origin tests"); } } };
  const walletsFactory = ({ origin, instanceId }) => {
    policies.push({ origin, instanceId });
    const inspect = async input => {
      assert.equal(input.scope.origin, origin); assert.equal(input.scope.instanceId, instanceId); calls.push({ origin, instanceId, kind: "receipt" });
      return { verified: true, chainId: 1, transactionHash: input.expected.transactionHash, from: input.expected.from, to: input.expected.to,
        valueWei: input.expected.valueWei, dataHash: ethers.keccak256(input.expected.data) };
    };
    return { inspectReviewedTransaction: inspect, inspectSubmittedTransaction: inspect,
      assertWallet: () => { calls.push({ origin, instanceId, kind: "signing" }); return { wallet, financialEligible: false }; },
      classifyWallet: () => { calls.push({ origin, instanceId, kind: "classification" }); return { wallet, financialEligible: false }; } };
  };
  const context = (origin, instanceId = "same-instance") => createV10ReceiptContext({ chain, origin, instanceId, drafts }, { walletsFactory });
  function add(id, origin = OLD, factory = false) {
    const createdAt = Date.now(), value = factory ? "0" : "1000";
    const d = { id, eventId: "synthetic-origin-event", scopeKind: factory ? "factory-create" : "event-call", origin, instanceId: "same-instance", wallet,
      sessionId: "original-wallet-session", chainId: 1, contractVersion: PROFILE, abiVersion: PROFILE, mode: "hosted-production", contract: target,
      action: factory ? "createEvent" : "deposit", method: factory ? "createEvent" : "deposit", args: [], params: {},
      valueWei: value, reviewBlock: 10, createdAt, expiresAt: createdAt + 300000, registryHash: hash("synthetic deployment"), snapshot: hash("synthetic review"),
      transaction: { from: wallet, to: target, chainId: 1, data: factory ? "0x12345678" : "0xd0e30db0", value, gasLimit: "100000" } };
    drafts.set(id, d); return d;
  }
  const actual = d => ({ hash: d.submittedHash ?? d.confirmedHash, chainId: 1n, from: wallet, to: target, value: BigInt(d.valueWei), data: d.transaction.data,
    nonce: 3, type: 2, blockNumber: 20, blockHash: ethers.id("synthetic block"), accessList: [], gasLimit: 100000n });
  const submitted = (d, txHash = knownHash) => { context(d.origin).sealDraft(d); d.submittedHash = txHash; return d; };
  return { drafts, calls, policies, context, add, actual, submitted };
}
test("known historical receipt keeps original domain, instance, session and seal after migration", async () => {
  const f = fixture(), d = f.submitted(f.add("historical")), saved = JSON.stringify(d), migrated = f.context(CURRENT, "new-instance");
  assert.equal((await migrated.inspectDraftTransaction(d, f.actual(d))).verified, true);
  assert.equal(migrated.sealDraft(d), d.v10Intent); assert.equal(JSON.stringify(d), saved);
  migrated.assertWallet(wallet); migrated.classifyWallet(wallet);
  assert.deepEqual(f.policies, [{ origin: OLD, instanceId: "same-instance" }, { origin: CURRENT, instanceId: "new-instance" }]);
  assert.equal(d.v10Intent.scope.origin, OLD); assert.equal(d.sessionId, "original-wallet-session");
});
test("policy caches include original origin as well as instance; new signing stays current", async () => {
  const f = fixture(), d = f.submitted(f.add("old")), migrated = f.context(CURRENT);
  await migrated.inspectDraftTransaction(d, f.actual(d));
  const fresh = f.add("new", CURRENT); migrated.sealDraft(fresh); fresh.submittedHash = ethers.id("different known new hash");
  await migrated.inspectDraftTransaction(fresh, f.actual(fresh)); migrated.assertWallet(wallet);
  assert.deepEqual(f.policies, [{ origin: OLD, instanceId: "same-instance" }, { origin: CURRENT, instanceId: "same-instance" }]);
  assert.equal(f.calls.at(-1).origin, CURRENT); assert.equal(fresh.v10Intent.scope.origin, CURRENT);
});
test("historical unsigned, unsealed or zero-hash reviews cannot acquire a new seal", () => {
  const f = fixture(), migrated = f.context(CURRENT);
  const unsigned = f.add("unsigned"); f.context(OLD).sealDraft(unsigned);
  assert.throws(() => migrated.sealDraft(unsigned), { code: "V10_RECEIPT_CONTEXT_SCOPE" });
  unsigned.submittedHash = ethers.ZeroHash;
  assert.throws(() => migrated.sealDraft(unsigned), { code: "V10_RECEIPT_CONTEXT_SCOPE" });
  const unsealed = f.add("unsealed"); unsealed.submittedHash = knownHash;
  assert.throws(() => migrated.sealDraft(unsealed), { code: "V10_RECEIPT_CONTEXT_SCOPE" }); assert(!Object.hasOwn(unsealed, "v10Intent"));
});
test("foreign origin, reverse migration, unknown hash and changed old seal fail closed", async () => {
  const f = fixture(), d = f.submitted(f.add("old"));
  await assert.rejects(() => f.context("https://foreign.example.invalid").inspectDraftTransaction(d, f.actual(d)), { code: "V10_RECEIPT_CONTEXT_SCOPE" });
  const newer = f.submitted(f.add("newer", CURRENT), ethers.id("newer hash"));
  await assert.rejects(() => f.context(OLD).inspectDraftTransaction(newer, f.actual(newer)), { code: "V10_RECEIPT_CONTEXT_SCOPE" });
  await assert.rejects(() => f.context(CURRENT).inspectDraftTransaction(d, { ...f.actual(d), hash: ethers.id("foreign unknown hash") }), { code: "V10_RECEIPT_CONTEXT_UNKNOWN_HASH" });
  d.v10Intent = structuredClone(d.v10Intent); d.v10Intent.scope.origin = CURRENT;
  await assert.rejects(() => f.context(CURRENT).inspectDraftTransaction(d, f.actual(d)), { code: "V10_RECEIPT_CONTEXT_CHANGED" });
});
test("historical factory submission validates an existing original seal but cannot create one", () => {
  const f = fixture(), d = f.submitted(f.add("factory-original", OLD, true));
  d.submissionWitness = { hash: knownHash, wallet, nonce: 3, reviewBlock: 10, type: 2, to: target, valueWei: "0", dataHash: ethers.keccak256(d.transaction.data), gasLimit: "100000", accessListHash: hash([]) };
  f.context(OLD).sealFactorySubmission(d); const before = JSON.stringify(d), migrated = f.context(CURRENT);
  assert.equal(migrated.sealFactorySubmission(d), d.v10Submission); assert.equal(JSON.stringify(d), before);
  d.used = true; d.status = "confirmed"; d.adoptionStatus = "verified"; d.confirmedHash = knownHash;
  const serialized = JSON.stringify(d), restored = JSON.parse(serialized); f.drafts.set(d.id, restored);
  const afterReload = f.context(CURRENT, "new-domain-after-reload");
  assert.equal(afterReload.sealDraft(restored), restored.v10Intent);
  assert.equal(afterReload.sealFactorySubmission(restored), restored.v10Submission);
  assert.equal(JSON.stringify(restored), serialized); assert.equal(restored.origin, OLD);
  assert.equal(restored.used, true); assert.equal(restored.adoptionStatus, "verified");
  // Bind a separate original draft before migration, without fabricating a seal.
  const original = f.submitted(f.add("missing-original", OLD, true), ethers.id("second original hash"));
  original.submissionWitness = { ...d.submissionWitness, hash: original.submittedHash };
  assert.throws(() => migrated.sealFactorySubmission(original), { code: "V10_FACTORY_SUBMISSION_UNSEALED" }); assert(!Object.hasOwn(original, "v10Submission"));
});
test("custom domain history is exact and one-way without activating it as current authority", async () => {
  assert(Object.isFrozen(V10_HISTORICAL_RECEIPT_ORIGINS) && Object.isFrozen(V10_HISTORICAL_RECEIPT_ORIGINS[CUSTOM]));
  const f = fixture(), old = f.submitted(f.add("old-history")), newer = f.submitted(f.add("new-history", CURRENT), ethers.id("new domain known hash"));
  const future = f.context(CUSTOM, "custom-instance");
  await future.inspectDraftTransaction(old, f.actual(old)); await future.inspectDraftTransaction(newer, f.actual(newer)); future.assertWallet(wallet);
  assert.deepEqual(f.policies.map(item => item.origin), [OLD, CURRENT, CUSTOM]);
  const custom = f.submitted(f.add("custom", CUSTOM), ethers.id("custom known hash"));
  await assert.rejects(() => f.context(CURRENT).inspectDraftTransaction(custom, f.actual(custom)), { code: "V10_RECEIPT_CONTEXT_SCOPE" });
  const freshOld = f.add("old-unsigned-for-custom"); f.context(OLD).sealDraft(freshOld);
  assert.throws(() => future.sealDraft(freshOld), { code: "V10_RECEIPT_CONTEXT_SCOPE" });
});
