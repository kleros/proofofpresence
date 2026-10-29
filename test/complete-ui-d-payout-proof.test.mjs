import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ethers } from "ethers";
import { publicJson, sha256, fingerprint } from "../src/testnet-config.mjs";
import { D_PAYOUT_COMPLETION, assertPayoutCompletionEvidence, retainedCompletionAnchors, assertCompletionPayments,
  completionRpcAllowed, main } from "../scripts/complete-ui-d-payout-proof.mjs";
const read = file => JSON.parse(fs.readFileSync(new URL("../" + file, import.meta.url), "utf8"));
function fixture() {
  const stopped = read(D_PAYOUT_COMPLETION.stopped), sidecar = read(D_PAYOUT_COMPLETION.sidecar);
  const plan = read("artifacts/ui-d-start-revision-proposal.json").proposedPlan;
  const manifest = read("registry/chiado-v8-ui-d.json");
  const role = read("artifacts/ui-d/status-ordinary-2026-10-29T03-58-30-360Z-2178dda7/proof.json");
  const observer = read("artifacts/chiado-ui-d-flow-audit/2026-10-29T03-58-06-211Z-2b8f5d98-0cd7-4a0b-9b30-da725e548b5e.json");
  const sidecarSha256 = sha256(fs.readFileSync(new URL("../" + D_PAYOUT_COMPLETION.sidecar, import.meta.url)));
  const journal = { chainId: 10200, planFingerprint: fingerprint(plan), transactions: { "ui-d-release-payouts": {
    state: "confirmed", hash: sidecar.hash, blockNumber: sidecar.blockNumber, blockHash: sidecar.blockHash,
    uiProof: { path: D_PAYOUT_COMPLETION.sidecar, sha256: sidecarSha256 }, expected: {
      from: plan.addresses.owner.toLowerCase(), to: manifest.events[0].deployment.contract.toLowerCase(), value: "0",
      data: new ethers.Interface(["function releasePayouts()"]).encodeFunctionData("releasePayouts", []) } } } };
  return { stopped, sidecar, sidecarSha256, plan, manifest, role, observer, journal, closure: structuredClone(sidecar.source.operatorFiles) };
}
test("public stopped run contains one independently passed ordinary operation; completion leaves original status intact", () => {
  const f = fixture(), before = publicJson(f);
  const scope = assertPayoutCompletionEvidence(f);
  assert.equal(scope.chainId, 10200); assert.equal(scope.eventId, f.sidecar.eventId);
  assert.equal(f.stopped.status, "stopped"); assert.equal(publicJson(f), before);
  assert.equal(sha256(fs.readFileSync(new URL("../" + D_PAYOUT_COMPLETION.stopped, import.meta.url))), "d32c76415b787cb531c82d0819c81732fe49ef2394b51ad21fe406bb4dcd4274");
});
test("forged or missing payout operation, journal, source, state and ABC scope fail closed", () => {
  for (const mutate of [f => f.stopped.status = "passed", f => f.stopped.operations = [],
    f => f.stopped.checks.pop(), f => f.stopped.blockedRequests.push("request failed"),
    f => f.stopped.counts.broadcasts = 2, f => f.journal.transactions["ui-d-release-payouts"].hash = ethers.id("forged"),
    f => f.journal.transactions["ui-d-release-payouts"].uiProof.sha256 = "0".repeat(64),
    f => f.journal.transactions["ui-d-release-payouts"].uiProof.path = "artifacts/ui-c/foreign.json",
    f => f.journal.planFingerprint = "other-plan", f => f.closure["src/chain.mjs"] = "0".repeat(64),
    f => f.manifest.events[0].deployment.contract = f.plan.addresses.bob]) {
    const f = fixture(); mutate(f); assert.throws(() => assertPayoutCompletionEvidence(f));
  }
  for (const mutate of [f => f.sidecar.after.heldBack = "0", f => f.sidecar.after.bobCase.finalRuling = 1,
    f => f.sidecar.wallet = f.plan.addresses.bob, f => f.sidecar.ui.walletMethods.push("eth_signTransaction"),
    f => f.sidecar.protectedABC.before[0].financial.balance = "1",
    f => delete f.sidecar.protectedABC.before[0].indexedBlock.hash,
    f => f.sidecar.protectedABC.after[2].indexedBlock.number = null,
    f => f.sidecar.protectedABC.before[0].financial.contract = f.plan.addresses.bob]) {
    const f = fixture(); mutate(f); f.stopped.operations[0] = structuredClone(f.sidecar);
    assert.throws(() => assertPayoutCompletionEvidence(f));
  }
});
test("all old ABC anchors and fresh payment block/deployment bindings are mandatory", () => {
  const f = fixture(), scope = assertPayoutCompletionEvidence(f);
  assert.equal(retainedCompletionAnchors(f.sidecar, f.role, f.observer).length, 11);
  assertCompletionPayments(f.role.canonicalPayments, f.role.chainBefore, scope);
  for (const patch of [{ blockHash: ethers.id("other") }, { blockNumber: 1 }, { eventId: "other" },
    { chainId: 100 }, { contract: f.plan.addresses.bob }, { outstandingCreditsWei: "1" }])
    assert.throws(() => assertCompletionPayments({ ...f.role.canonicalPayments, ...patch }, f.role.chainBefore, scope));
});
test("ordinary role and observer proofs must match the same source, actors and unpaid unruled Bob", () => {
  for (const mutate of [f => f.role.status = "stopped", f => f.role.phase = "matched", f => f.role.failures.push("cleanup"),
    f => f.role.source.instanceId = "different", f => f.role.source.manifestSha256 = "0".repeat(64),
    f => f.role.roleProofs[0].wallet = f.plan.addresses.owner, f => f.role.chainAfter.owedTotal = "1",
    f => delete f.role.chainBefore.indexedBlock.hash, f => f.role.canonicalPayments.outstandingCreditsWei = "1",
    f => f.role.canonicalPayments.blockHash = ethers.id("other-block"),
    f => f.observer.checkpoint = "settled", f => f.observer.signatures = 1,
    f => f.observer.events[0].state.cases[0].finalRuling = 1,
    f => f.observer.events[0].state.cases[0].arbitratorDisputeID = "1000",
    f => f.observer.events[0].state.cases[0].localDisputeID = null,
    f => f.observer.events[0].blockHash = "malformed",
    f => f.observer.events[0].payments.attendancePaidWei = "0"]) {
    const f = fixture(); mutate(f); assert.throws(() => assertPayoutCompletionEvidence(f));
  }
});
test("read-only completion default accesses no runtime and mutable RPCs are unavailable", async () => {
  for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "personal_sign", "evm_mine", "evm_increaseTime"])
    assert.equal(completionRpcAllowed(method), false);
  assert.equal(completionRpcAllowed("eth_getTransactionReceipt"), true);
  const before = fs.readFileSync(new URL("../" + D_PAYOUT_COMPLETION.stopped, import.meta.url));
  await main([]); await assert.rejects(main(["--execute-readonly"]), /reviewed proof paths/);
  assert.ok(fs.readFileSync(new URL("../" + D_PAYOUT_COMPLETION.stopped, import.meta.url)).equals(before));
});
