import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { UI_D, prepareUiDPlan, validateUiDPlan, validateUiDOrigin, validateUiDBudget,
  uiDBudgetApproval, assertUiDArtifacts, boundedDSigner, assertProtectedDUnchanged,
  preparationFeeCeiling, assertDDeploymentLead, deployUiD, main } from "../scripts/testnet-ui-d-scenario.mjs";
import { sendOnce, fingerprint } from "../src/testnet-config.mjs";
import { dFixture, copy, addr } from "./testnet-ui-d-fixture.mjs";

test("D explicit preparation ceiling is immutable, positive, budget bounded and prepare-only", async () => {
  assert.equal(preparationFeeCeiling(undefined, 14n), 28n);
  assert.equal(preparationFeeCeiling("1000", 14n), 1000n);
  for (const value of ["0", "-1", "1.5", "13", "1000000000"])
    assert.throws(() => preparationFeeCeiling(value, 14n));
  await assert.rejects(main(["--max-fee-per-gas", "1000"]), /only during preparation/);
  await assert.rejects(main(["--deploy", "--max-fee-per-gas", "1000"]), /only during preparation/);
});

test("D profile is isolated from A/B+C, pins80015/900s and preserves a hosting/deposit lead", () => {
  const f = dFixture(), p = f.plan;
  assert.equal(p.event.eventStart - f.now, 7200);
  assert.equal(p.event.eventEnd - p.event.eventStart, 43200);
  assert.equal(p.factory, ethers.getCreateAddress({ from: p.addresses.owner, nonce: 0 }));
  assert.equal(p.factoryCodeHash, null);
  assert.equal(uiDBudgetApproval(p).length, 64);
  assertUiDArtifacts(p, f.artifacts, f.provenance);
  for (const origin of [f.source.publicOrigin, f.protectedC.publicOrigin, "http://d.example.invalid",
    "https://d.example.invalid/", "https://x:y@d.example.invalid", "https://d.example.invalid?x=1"])
    assert.throws(() => validateUiDOrigin(origin, f.source.publicOrigin, f.protectedC.publicOrigin));
  for (const mutate of [p => p.profile.challengePeriod = 86400, p => p.profile.matchPeriod = 901,
    p => p.profile.numericVersion = 8, p => p.event.version = "kleros-event-v8",
    p => p.sourceManifestSha256 = "0".repeat(64), p => p.protectedCManifestSha256 = "0".repeat(64),
    p => p.addresses.bob = f.protectedC.rehearsalAddresses.bob, p => p.factoryNonce = 1,
    p => p.factoryCodeHash = ethers.id("runtime"), p => p.expectedFinalRuling = 2,
    p => p.policy = f.source.policy, p => p.event.eventEnd++, p => p.chain.chainId = 100]) {
    const bad = copy(p); mutate(bad);
    assert.throws(() => validateUiDPlan(bad, f.source, f.protectedC));
  }
  for (const startInMinutes of [0, 59, 241, NaN]) assert.throws(() => prepareUiDPlan({ ...f, startInMinutes }));
  for (const startInMinutes of [60, 240]) assert.doesNotThrow(() => prepareUiDPlan({ ...f, startInMinutes }));
  assert.equal(assertDDeploymentLead(10000 - 1201, 10000, true), 1200);
  for (const now of [10000 - 1200, 10000 - 1199, 10000])
    assert.throws(() => assertDDeploymentLead(now, 10000, true), /20minutes/);
  assert.throws(() => assertDDeploymentLead(10000 - 2700, 10000, false), /45minutes/);
});

test("D factory+child provenance changes fail before funding or provider access", async () => {
  const f = dFixture(); let calls = 0;
  for (const field of ["provenance", "factory", "child"]) {
    const artifacts = copy(f.artifacts), provenance = copy(f.provenance);
    if (field === "provenance") provenance.sources.changed = "x";
    else artifacts[field === "factory" ? UI_D.factoryArtifact : UI_D.eventArtifact].bytecode += "00";
    await assert.rejects(deployUiD({ ...f, artifacts, provenance,
      provider: new Proxy({}, { get: () => { calls++; throw Error("provider reached"); } }),
      policyText: f.policyText }), /provenance and both creation artifacts/);
  }
  assert.equal(calls, 0);
});

test("D budget includes new factory, child, three grants and protected A/B+C reserve", () => {
  const q = validateUiDBudget({ balanceWei: 50_000_000_000_000n, maxFeePerGas: 200000n });
  assert.equal(q.ownerMaximumWei, "4000000000000");
  assert.equal(q.protectedABCReserveWei, "10000000000000");
  const exact = BigInt(q.remainingFundingWei) + BigInt(q.protectedABCReserveWei);
  assert.doesNotThrow(() => validateUiDBudget({ balanceWei: exact, maxFeePerGas: 200000n }));
  assert.throws(() => validateUiDBudget({ balanceWei: exact - 1n, maxFeePerGas: 200000n }), /protected A\/B\+C/);
  for (const changes of [{ factoryGas: 12000001n }, { createGas: 8000001n }, { maxFeePerGas: 0 },
    { maxFeePerGas: 1000000n }, { pendingFunding: 4 }])
    assert.throws(() => validateUiDBudget({ balanceWei: exact, maxFeePerGas: 200000n, ...changes }));
  const abc = [40, 41, 42].map(n => ({ financial: { contract: addr(n), reserved: "7" } }));
  assertProtectedDUnchanged(abc, copy(abc));
  const changed = copy(abc); changed[2].financial.reserved = "0";
  assert.throws(() => assertProtectedDUnchanged(abc, changed), /A\/B\+C/);
});

test("D pre-sign guard stops a fee spike after quote/sendOnce fee refetch without key use or journal", async () => {
  const f = dFixture(), root = fs.mkdtempSync(path.join(os.tmpdir(), "d-fee-guard-"));
  let signed = 0, broadcast = 0;
  try {
    const action = "fund-d-owner", journal = { chainId: 10200, planFingerprint: fingerprint(f.plan), transactions: {} };
    const request = { to: f.plan.addresses.owner, value: BigInt(UI_D.fundingWei), gasLimit: 21000n };
    const provider = { send: async () => "0x27d8", getBalance: async () => 60_000_000_000_000n,
      getTransactionCount: async () => 0, getCode: async () => "0x",
      getBlock: async () => ({ baseFeePerGas: 1000000n }), broadcastTransaction: async () => { broadcast++; } };
    const signer = { getAddress: async () => f.source.rehearsalAddresses.ownerA,
      populateTransaction: async tx => ({ ...tx, from: f.source.rehearsalAddresses.ownerA, nonce: 7 }),
      signTransaction: async () => { signed++; throw Error("key used"); } };
    const guarded = boundedDSigner(signer, { provider, plan: f.plan, journal, action, request });
    await assert.rejects(sendOnce({ provider, signer: guarded, journal,
      journalPath: path.join(root, "ui-d-journal.json"), action, request }), /approved fee ceiling; key not used/);
    assert.equal(signed, 0); assert.equal(broadcast, 0);
    assert.deepEqual(journal.transactions, {});
    assert.equal(fs.existsSync(path.join(root, "ui-d-journal.json")), false);
    const tx = { ...request, from: f.source.rehearsalAddresses.ownerA, chainId: 10200, nonce: 7,
      maxFeePerGas: 200000n, maxPriorityFeePerGas: 100000n };
    for (const changes of [{ chainId: 100 }, { to: addr(99) }, { value: 1n }, { gasLimit: 21001n }])
      await assert.rejects(guarded.signTransaction({ ...tx, ...changes }), /key not used/);
    provider.getBalance = async () => 40_000_000_000_000n;
    await assert.rejects(guarded.signTransaction(tx), /protected A\/B\+C/);
    assert.equal(signed, 0);
    journal.transactions[`create-${f.plan.event.id}`] = { state: "submission-uncertain", hash: ethers.id("known-child") };
    for (const action of ["fund-d-owner", "deploy-d-factory", `create-${f.plan.event.id}`]) {
      const recoveryGuard = boundedDSigner(signer, { provider, plan: f.plan, journal, action, request });
      await assert.rejects(recoveryGuard.signTransaction(tx), /all signing is forbidden/);
    }
    assert.equal(signed, 0); assert.equal(broadcast, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
