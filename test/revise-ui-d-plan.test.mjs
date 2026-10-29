import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ethers } from "ethers";
import { publicJson, sha256, fingerprint, loadJournal } from "../src/testnet-config.mjs";
import { uiDBudgetApproval } from "../scripts/testnet-ui-d-scenario.mjs";
import { runDRevision, validateDRevision, jsonSpans } from "../scripts/revise-ui-d-plan.mjs";
import { dFixture, copy } from "./testnet-ui-d-fixture.mjs";

function fixture() {
  const base = dFixture(), originalPlan = base.plan, proposedPlan = copy(originalPlan);
  for (const field of ["eventStart", "eventEnd", "claimDeadline"]) proposedPlan.event[field] += 3600;
  const transactions = Object.fromEntries(["fund-d-owner", "fund-d-alice", "fund-d-bob", "deploy-d-factory"]
    .map((action, i) => [action, { hash: ethers.id(action), state: "confirmed", blockNumber: i + 100,
      blockHash: ethers.id("block" + i), nonce: i === 3 ? 0 : i,
      expected: { from: (i === 3 ? originalPlan.addresses.owner : base.source.rehearsalAddresses.ownerA).toLowerCase(),
        to: i === 3 ? null : originalPlan.addresses[["owner", "alice", "bob"][i]].toLowerCase(),
        data: i === 3 ? base.artifacts.KlerosEventFactoryV8Test15m.bytecode : "0x", value: i === 3 ? "0" : originalPlan.fundingWei } }]));
  const originalJournal = { chainId: 10200, planFingerprint: fingerprint(originalPlan), transactions };
  const proposal = { basePlanFingerprint: fingerprint(originalPlan), proposedPlanFingerprint: fingerprint(proposedPlan),
    proposedBudgetApproval: uiDBudgetApproval(proposedPlan), proposedPlan,
    onlyPlanFieldChanges: ["event.eventStart", "event.eventEnd", "event.claimDeadline"],
    retainedTransactions: Object.fromEntries(Object.entries(transactions).map(([action, e]) =>
      [action, { state: e.state, hash: e.hash, blockNumber: e.blockNumber }])) };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d-plan-revision-"));
  const paths = Object.fromEntries(["plan", "journal", "manifest", "lock", "proposal", "pointer"].map(name => [name, path.join(root, name + ".json")]));
  paths.archiveRoot = path.join(root, "revisions"); paths.proofRoot = path.join(root, "proofs");
  const planRaw = publicJson(originalPlan), journalRaw = publicJson(originalJournal).replaceAll('"state": "confirmed"', '"state" :    "confirmed"');
  fs.writeFileSync(paths.plan, planRaw, { mode: 0o600 }); fs.writeFileSync(paths.journal, journalRaw, { mode: 0o600 });
  fs.writeFileSync(paths.proposal, publicJson(proposal), { mode: 0o644 });
  const proposalSha256 = sha256(fs.readFileSync(paths.proposal));
  let reads = 0;
  const args = { paths, proposalSha256, humanReference: "verified-human-root-chat:full-fast-D-rehearsal",
    verifier: async ({ proposedPlan: p, originalJournal: j }) => {
      reads++; assert.equal(fingerprint(p), proposal.proposedPlanFingerprint);
      assert.equal(j.planFingerprint, proposal.basePlanFingerprint); assert.equal(Object.keys(j.transactions).length, 4);
      return { status: "injected-read-only-local-fixture", chainId: 10200, latestOwnerNonce: 1, pendingOwnerNonce: 1, eventKeyUnused: true };
    }, now: () => "2026-10-29T02:20:00.000Z" };
  return { ...base, root, paths, originalPlan, originalJournal, proposal, planRaw, journalRaw, args, reads: () => reads,
    close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("D revision allows exactly three future time changes and rejects consumed or altered inputs", () => {
  const f = fixture();
  try {
    validateDRevision(f.originalPlan, f.originalJournal, f.proposal);
    for (const mutate of [p => p.addresses.owner = p.addresses.alice, p => p.policy.sha256 = "0".repeat(64),
      p => p.deploymentBudget.maxFeePerGas = "1", p => p.factory = p.addresses.bob,
      p => p.provenance.sources.changed = "x", p => p.event.eventKey = ethers.id("new-key"), p => p.extra = true]) {
      const proposal = copy(f.proposal); mutate(proposal.proposedPlan);
      proposal.proposedPlanFingerprint = fingerprint(proposal.proposedPlan);
      proposal.proposedBudgetApproval = uiDBudgetApproval(proposal.proposedPlan);
      assert.throws(() => validateDRevision(f.originalPlan, f.originalJournal, proposal), /Only the three/);
    }
    for (const mutate of [j => j.transactions["create-child"] = { hash: ethers.id("child") },
      j => j.transactions["ui-d-deposit-alice"] = { hash: ethers.id("deposit") },
      j => j.transactions["fund-d-owner"].state = "submitted", j => j.transactions["fund-d-owner"].hash = ethers.id("other")]) {
      const journal = copy(f.originalJournal); mutate(journal);
      assert.throws(() => validateDRevision(f.originalPlan, journal, f.proposal));
    }
  } finally { f.close(); }
});

test("D revision preserves raw archives and setup entry bytes, then reapplying cannot overwrite a later child", async () => {
  const f = fixture();
  try {
    const review = await runDRevision({ ...f.args, execute: false });
    assert.equal(review.status, "ready-read-only"); assert.equal(fs.existsSync(f.paths.archiveRoot), false);
    assert.equal(fs.readFileSync(f.paths.plan, "utf8"), f.planRaw); assert.equal(fs.readFileSync(f.paths.journal, "utf8"), f.journalRaw);
    const result = await runDRevision({ ...f.args, execute: true });
    assert.equal(result.status, "applied"); assert.equal(result.canonicalWrites, 2);
    const currentPlan = JSON.parse(fs.readFileSync(f.paths.plan, "utf8")), currentJournalRaw = fs.readFileSync(f.paths.journal, "utf8");
    assert.equal(fingerprint(currentPlan), f.proposal.proposedPlanFingerprint);
    const currentJournal = loadJournal(f.paths.journal, currentPlan);
    assert.equal(currentJournal.planRevisions.length, 1);
    assert.equal(jsonSpans(currentJournalRaw).transactions.raw, jsonSpans(f.journalRaw).transactions.raw);
    const archive = path.join(f.paths.archiveRoot, f.args.proposalSha256);
    assert.equal(fs.readFileSync(path.join(archive, "original-plan.json"), "utf8"), f.planRaw);
    assert.equal(fs.readFileSync(path.join(archive, "original-journal.json"), "utf8"), f.journalRaw);
    for (const file of fs.readdirSync(archive)) assert.equal(fs.statSync(path.join(archive, file)).mode & 0o777, 0o600);
    const repeat = await runDRevision({ ...f.args, execute: true });
    assert.equal(repeat.status, "already-applied"); assert.equal(repeat.canonicalWrites, 0);
    const outer = jsonSpans(currentJournalRaw), txRaw = outer.transactions.raw, closing = jsonSpans(txRaw).closingBrace;
    const withChild = txRaw.slice(0, closing) + ',"create-later-child":{"hash":"' + ethers.id("later-child") + '"}' + txRaw.slice(closing);
    const laterJournalRaw = currentJournalRaw.slice(0, outer.transactions.start) + withChild + currentJournalRaw.slice(outer.transactions.end);
    fs.writeFileSync(f.paths.journal, laterJournalRaw); fs.writeFileSync(f.paths.manifest, "{}");
    const already = await runDRevision({ ...f.args, execute: true, verifier: async () => { throw Error("must not re-verify or rewrite later child"); } });
    assert.equal(already.status, "already-applied"); assert.equal(already.canonicalWrites, 0);
    assert.equal(fs.readFileSync(f.paths.journal, "utf8"), laterJournalRaw);
    assert.equal(already.signingFilesRead, 0); assert.equal(already.signatures, 0); assert.equal(already.broadcasts, 0);
    assert.equal(f.reads(), 2);
  } finally { f.close(); }
});

test("D revision pair crash fails closed and exact intent recovery finishes only the missing journal write", async () => {
  const f = fixture();
  try {
    await assert.rejects(runDRevision({ ...f.args, execute: true, afterPlanWrite: async () => { throw Error("injected pair interruption"); } }), /pair interruption/);
    const revisedPlan = JSON.parse(fs.readFileSync(f.paths.plan, "utf8"));
    assert.equal(fingerprint(revisedPlan), f.proposal.proposedPlanFingerprint);
    assert.equal(fs.readFileSync(f.paths.journal, "utf8"), f.journalRaw);
    assert.throws(() => loadJournal(f.paths.journal, revisedPlan), /another immutable plan/i);
    const recovered = await runDRevision({ ...f.args, execute: true });
    assert.equal(recovered.status, "applied"); assert.equal(recovered.canonicalWrites, 1);
    assert.equal(loadJournal(f.paths.journal, revisedPlan).planRevisions.length, 1);
    await assert.rejects(runDRevision({ ...f.args, execute: true, humanReference: "different verified reference" }), /another proposal or authorization/);
  } finally { f.close(); }
});

test("D revision refuses a manifest, bad proposal hash or consumed journal without canonical writes", async () => {
  const f = fixture();
  try {
    await assert.rejects(runDRevision({ ...f.args, execute: true, proposalSha256: "0".repeat(64) }), /proposal raw SHA/);
    fs.writeFileSync(f.paths.manifest, "{}");
    await assert.rejects(runDRevision({ ...f.args, execute: true }), /cannot overwrite a child, manifest/);
    assert.equal(fs.existsSync(f.paths.archiveRoot), false); assert.equal(f.reads(), 0);
    assert.equal(fs.readFileSync(f.paths.plan, "utf8"), f.planRaw); assert.equal(fs.readFileSync(f.paths.journal, "utf8"), f.journalRaw);
  } finally { f.close(); }
});
