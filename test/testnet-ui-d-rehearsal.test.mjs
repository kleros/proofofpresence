import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { UI_D, prepareUiDPlan, deployUiD, uiDBudgetApproval, protectedDContext,
  assertProtectedDUnchanged, assertUiDDeployment, uiDCreateRequest } from "../scripts/testnet-ui-d-scenario.mjs";
import { assertDBeforeRuling, assertDAfterRuling, assertDSettled, assertDUIProofContext,
  dOperationFor, boundedDRulingSigner, runDOperator, D_RULING_ACTION } from "../scripts/testnet-ui-d-rehearsal.mjs";
import { CHIADO, ROOT, DAY, publicJson, sha256, fingerprint, verifyCompiledInputs, readJson,
  loadJournal, atomicJson, sendOnce } from "../src/testnet-config.mjs";
import { stateOf } from "./testnet-ui-c.e2e.mjs";
import { verifyUiCStack } from "../scripts/testnet-ui-scenario.mjs";
import { addr, copy, dFixture } from "./testnet-ui-d-fixture.mjs";

test("D ruling fee refetch spike, stale nonce and insufficient reserve stop before key use or journaling", async () => {
  const f = dFixture(), root = fs.mkdtempSync(path.join(os.tmpdir(), "d-ruling-fee-"));
  f.plan.deploymentBudget.maxFeePerGas = "1000";
  const scope = { chainId: 10200, contractVersion: UI_D.contractVersion, depositWei: UI_D.depositWei, ...f.plan.addresses };
  const fresh = { owner: scope.owner, phase: "Finalized", stakerCount: 2, attendeeCount: 1,
    attended: { alice: true, bob: false }, status: { alice: 2, bob: 1 }, pendingTotal: "0", pendingChallenges: "1",
    owedTotal: "0", owed: { alice: "0", bob: "0" }, heldBack: UI_D.depositWei, payoutShare: UI_D.depositWei,
    challengeEscrow: "30000000000", balance: "1030000000000", reserved: "1030000000000",
    bobCase: { state: 2, finalRuling: null, heldShare: UI_D.depositWei, localDisputeID: "17", arbitratorDisputeID: "1017",
      deposit: "30000000000", arbitrationPaid: "30000000000", matcher: scope.owner } };
  const request = { to: f.plan.arbitration.arbitrator, value: 0n,
    data: new ethers.Interface(["function giveFinalRuling(uint256,uint256)"]).encodeFunctionData("giveFinalRuling", [1017, 1]), gasLimit: 100000n };
  let signed = 0, broadcast = 0, nonce = 7, balance = 5_000_000_000_000n;
  const provider = { send: async () => "0x27d8", getBlock: async () => ({ baseFeePerGas: 1000000n }),
    getTransactionCount: async () => nonce, getBalance: async () => balance, broadcastTransaction: async () => { broadcast++; } };
  const key = { getAddress: async () => scope.owner, populateTransaction: async tx => ({ ...tx, from: scope.owner, nonce: 7 }),
    signTransaction: async () => { signed++; return "0x00"; } };
  const guarded = boundedDRulingSigner(key, { provider, plan: f.plan, scope, request, disputeId: "1017", verifyState: async () => fresh });
  try {
    const journal = { chainId: 10200, planFingerprint: fingerprint(f.plan), transactions: {} }, filename = path.join(root, "journal.json");
    await assert.rejects(sendOnce({ provider, signer: guarded, journal, journalPath: filename,
      action: D_RULING_ACTION, request }), /approved fee\/gas bounds; key not used/);
    assert.equal(signed, 0); assert.equal(broadcast, 0); assert.deepEqual(journal.transactions, {});
    assert.equal(fs.existsSync(filename), false);
    const tx = { ...request, from: scope.owner, chainId: 10200, nonce: 7, maxFeePerGas: 1000n, maxPriorityFeePerGas: 10n };
    nonce = 8; await assert.rejects(guarded.signTransaction(tx), /nonce is stale/);
    nonce = 7; balance = 1_000_000n; await assert.rejects(guarded.signTransaction(tx), /settlement gas reserves/);
    balance = 5_000_000_000_000n;
    for (const patch of [{ to: addr(99) }, { value: 1n }, { gasLimit: 2000001n }, { maxFeePerGas: 1001n }, { chainId: 100 }])
      await assert.rejects(guarded.signTransaction({ ...tx, ...patch }), /key not used/);
    assert.equal(signed, 0);
    await guarded.signTransaction(tx); assert.equal(signed, 1); assert.equal(broadcast, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("D controlled operator requires its own profile and actual sent/held/owed separation", () => {
  const scope = { chainId: 10200, contractVersion: UI_D.contractVersion, owner: addr(1),
    alice: addr(2), bob: addr(3), depositWei: UI_D.depositWei };
  const ordinary = { owner: scope.owner, phase: "Finalized", stakerCount: 2, attendeeCount: 1,
    attended: { alice: true, bob: false }, status: { alice: 2, bob: 1 }, pendingTotal: "0", pendingChallenges: "1",
    owedTotal: "0", owed: { alice: "0", bob: "0" }, heldBack: UI_D.depositWei, payoutShare: UI_D.depositWei,
    challengeEscrow: "30000000000", balance: "1030000000000", reserved: "1030000000000",
    bobCase: { state: 2, finalRuling: null, heldShare: UI_D.depositWei, localDisputeID: "17",
      arbitratorDisputeID: "1017", deposit: "30000000000", arbitrationPaid: "30000000000", matcher: scope.owner } };
  assertDBeforeRuling(ordinary, scope);
  assertDAfterRuling({ ...ordinary, bobCase: { ...ordinary.bobCase, finalRuling: 1 } }, scope);
  for (const change of [s => s.phase = "Listed", s => s.heldBack = "0", s => s.owedTotal = "1",
    s => s.challengeEscrow = "0", s => s.balance = "0", s => s.bobCase.finalRuling = 2,
    s => s.bobCase.matcher = addr(99), s => s.bobCase.arbitratorDisputeID = undefined]) {
    const bad = copy(ordinary); change(bad); assert.throws(() => assertDBeforeRuling(bad, scope));
  }
  assert.throws(() => assertDBeforeRuling(ordinary, { ...scope, contractVersion: "kleros-event-v8" }));
  const settled = { ...ordinary, attendeeCount: 2, attended: { alice: true, bob: true }, status: { alice: 2, bob: 2 },
    pendingChallenges: "0", heldBack: "0", challengeEscrow: "0", reserved: "0", balance: "0",
    bobCase: { ...ordinary.bobCase, state: 3, finalRuling: 1, heldShare: "0" } };
  const paid = new Map([[scope.alice.toLowerCase(), 1_000_000_000_000n], [scope.bob.toLowerCase(), 1_000_000_000_000n]]);
  assertDSettled(settled, scope, paid);
  assert.throws(() => assertDSettled(settled, scope, new Map([[scope.alice.toLowerCase(), 2_000_000_000_000n]])));
  assert.throws(() => assertDSettled({ ...settled, owedTotal: "1" }, scope, paid));
  assert.equal(dOperationFor("challenge", "bob", scope, { challengeDepositWei: "30000000000" }).journalAction, "ui-d-challenge-bob");
  assert.throws(() => dOperationFor("challenge", "alice", scope, {}));
});

test("local10200 D deploys its own factory once and verifies900s held-share/ruling1/same-Bob delivery without changing A/B+C",
  { timeout: 180000 }, async () => {
  const { localChain, deployEvent } = await import("../src/chain.mjs");
  const chain = await localChain(0, { chainId: 10200 });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "kleros-ui-d-local-"));
  let miner, mining;
  try {
    const selected = verifyCompiledInputs(ROOT, UI_D.contractVersion), legacy = verifyCompiledInputs(ROOT);
    await (await chain.liquid.setFeeForJuror(10_000_000_000n)).wait();
    const factory = await chain.deploy("KlerosEventFactoryV8", chain.signers[0]);
    const initial = (await chain.provider.getBlock("latest")).timestamp, legacyStart = initial + 1800;
    const records = [];
    for (const [index, name] of ["a", "b", "c"].entries()) {
      const definition = { id: `protected-${name}`, title: `Protected ${name}`, location: "Synthetic local venue",
        startsAt: new Date(legacyStart * 1000).toISOString(), endsAt: new Date((legacyStart + 43200) * 1000).toISOString(), timezone: "UTC" };
      records.push({ definition, ...(await deployEvent(chain, definition, chain.signers[index === 2 ? 5 : index],
        1_000_000_000_000n, legacyStart, legacyStart + 7 * DAY, { contractVersion: "kleros-event-v8", factory })) });
    }
    const addresses = await Promise.all(chain.signers.slice(0, 8).map(s => s.getAddress()));
    const source = { environment: "testnet", chain: CHIADO, publicOrigin: "https://ab.example.invalid", planFingerprint: "local-ab",
      factory: factory.target, factoryCodeHash: ethers.keccak256(await chain.provider.getCode(factory.target)),
      provenance: legacy.provenance, arbitration: { mode: "controlled", resolver: chain.resolver.target,
        arbitrator: chain.liquid.target, notice: "Controlled local test arbitrator; no independent jury" },
      rehearsalAddresses: Object.fromEntries(["ownerA", "ownerB", "alice", "bob", "carol"].map((r, i) => [r, addresses[i]])),
      policy: { uri: "https://ab.example.invalid/policies/v8-testnet.md", sha256: sha256("legacy") }, events: records.slice(0, 2) };
    const protectedC = { ...copy(source), publicOrigin: "https://c.example.invalid", planFingerprint: "local-c",
      rehearsalAddresses: { owner: addresses[5], alice: addresses[6], bob: addresses[7] }, events: [records[2]] };
    const sourceJournal = { chainId: 10200, planFingerprint: source.planFingerprint, transactions: {} };
    for (const [action, contract] of [["deploy-arbitrator", chain.liquid], ["deploy-resolver", chain.resolver], ["deploy-factory", factory]]) {
      const receipt = await contract.deploymentTransaction().wait();
      sourceJournal.transactions[action] = { state: "confirmed", hash: receipt.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
    }
    const stack = await verifyUiCStack({ provider: chain.provider, source, sourceJournal,
      artifacts: legacy.artifacts, provenance: legacy.provenance });
    for (let i = 0; i < 120 && (await chain.provider.getBlock("latest")).baseFeePerGas >= 1000n; i++)
      await chain.provider.send("evm_mine", []);
    miner = setInterval(() => { if (!mining) mining = chain.provider.send("evm_mine", []).finally(() => { mining = null; }); }, 75);
    const wallets = { purpose: UI_D.purpose, chainId: 10200,
      roles: Object.fromEntries(["owner", "alice", "bob"].map(r => { const w = ethers.Wallet.createRandom();
        return [r, { address: w.address, privateKey: w.privateKey }]; })) };
    const policyText = "Synthetic local D policy:900second challenge/match; attended ruling1; no public publication claim.\n";
    const plan = prepareUiDPlan({ source, protectedC, ...selected, stack,
      addresses: Object.fromEntries(Object.entries(wallets.roles).map(([r, w]) => [r, w.address])),
      publicOrigin: "https://d.example.invalid", policy: { uri: "https://d.example.invalid/policies/v8-test15m.md", sha256: sha256(policyText) },
      maxFeePerGas: 200000n, now: (await chain.provider.getBlock("latest")).timestamp });
    const accounts = chain.server.provider.getInitialAccounts();
    const funder = new ethers.Wallet(accounts[addresses[0].toLowerCase()].secretKey, chain.provider);
    const journalPath = path.join(temp, "ui-d-journal.json"), manifestPath = path.join(temp, "manifest.json");
    const inputs = { plan, source, protectedC, stack, provider: chain.provider, ...selected,
      legacyArtifacts: legacy.artifacts, wallets, funder, budgetApproval: uiDBudgetApproval(plan), policyText, journalPath, manifestPath };
    const baseline = await protectedDContext(source, protectedC, chain.provider, legacy.artifacts);
    await assert.rejects(deployUiD({ ...inputs, budgetApproval: "0".repeat(64) }), /approve.*budget/);
    const result = await deployUiD(inputs), manifest = result.manifest, record = manifest.events[0];
    const journal = loadJournal(journalPath, plan);
    assert.equal(Object.keys(journal.transactions).length, 5);
    assert.ok(Object.values(journal.transactions).every(e => e.state === "confirmed"));
    assertUiDDeployment(record, plan, journal, uiDCreateRequest(plan, selected.artifacts), selected.artifacts);
    const beforeNonces = await Promise.all([funder.address, plan.addresses.owner].map(a => chain.provider.getTransactionCount(a)));
    await deployUiD(inputs);
    assert.deepEqual(await Promise.all([funder.address, plan.addresses.owner].map(a => chain.provider.getTransactionCount(a))), beforeNonces);
    const event = new ethers.Contract(record.deployment.contract, selected.artifacts[UI_D.eventArtifact].abi, chain.provider);
    assert.equal(await event.VERSION(), 80015n); assert.equal(await event.CHALLENGE_PERIOD(), 900n); assert.equal(await event.MATCH_PERIOD(), 900n);
    const actors = Object.fromEntries(Object.entries(wallets.roles).map(([r, w]) => [r, new ethers.Wallet(w.privateKey, chain.provider)]));
    const scope = { chainId: 10200, contractVersion: UI_D.contractVersion, eventId: plan.event.id,
      contract: event.target, depositWei: plan.depositWei, ...plan.addresses };
    const resolver = new ethers.Contract(plan.arbitration.resolver, selected.artifacts.MockArbitrableProxy.abi, chain.provider);
    const proofDir = path.join(temp, "artifacts/ui-d/local-synthetic-fixture"); fs.mkdirSync(proofDir, { recursive: true });
    const fixtureSource = { origin: plan.publicOrigin, instanceId: "explicit-local-synthetic-fixture-not-browser",
      harnessSha256: "a".repeat(64), operatorFiles: { "test/testnet-ui-d.e2e.mjs": "a".repeat(64) },
      protectedManifestSha256: plan.sourceManifestSha256, protectedCManifestSha256: plan.protectedCManifestSha256,
      planFingerprint: fingerprint(plan), manifestSha256: sha256(publicJson(manifest)),
      contract: { address: event.target, codeHash: record.deployment.codeHash, factory: plan.factory,
        factoryCodeHash: record.deployment.factoryCodeHash, factoryDeploymentTxHash: record.deployment.factoryDeploymentTxHash,
        factoryDeploymentBlock: record.deployment.factoryDeploymentBlock, deploymentTxHash: record.deployment.deploymentTxHash,
        deploymentBlock: record.deployment.deploymentBlock, configurationHash: record.deployment.configurationHash } };
    async function syntheticUI(stage, role) {
      const state = await stateOf(event, chain.provider, scope, resolver), op = dOperationFor(stage, role, scope, state);
      const before = await protectedDContext(source, protectedC, chain.provider, legacy.artifacts);
      const receipt = await sendOnce({ provider: chain.provider, signer: actors[role], journal, journalPath,
        action: op.journalAction, request: { to: event.target, value: op.value, data: event.interface.encodeFunctionData(op.method, op.args) } });
      const after = await protectedDContext(source, protectedC, chain.provider, legacy.artifacts);
      assertProtectedDUnchanged(before, after);
      const proof = { syntheticLocalFixture: true, notice: "Test fixture only; not a browser execution proof", status: "passed",
        eventId: plan.event.id, contract: event.target, wallet: plan.addresses[role], journalAction: op.journalAction,
        hash: receipt.hash, source: fixtureSource, ui: { walletTransactions: 1, broadcasts: 1 },
        protectedABC: { unchanged: true, before, after } };
      const file = path.join(proofDir, `${op.journalAction}.json`); atomicJson(file, proof, 0o644);
      journal.transactions[op.journalAction].uiProof = { path: path.relative(temp, file), sha256: sha256(fs.readFileSync(file)) };
      atomicJson(journalPath, journal); return receipt;
    }
    await syntheticUI("deposits", "alice"); await syntheticUI("deposits", "bob"); await syntheticUI("admit", "owner");
    // A remains a real unresolved legacy case0; D must use fresh dynamic1/1001.
    const a = new ethers.Contract(records[0].deployment.contract, legacy.artifacts.KlerosEventV8.abi, chain.signers[0]);
    await (await a.connect(chain.signers[2]).deposit({ value: 1_000_000_000_000n })).wait();
    await (await a.connect(chain.signers[3]).deposit({ value: 1_000_000_000_000n })).wait();
    await (await a.registerStakers([addresses[2], addresses[3]])).wait();
    await chain.provider.send("evm_increaseTime", [plan.event.eventStart - (await chain.provider.getBlock("latest")).timestamp + 1]);
    await chain.provider.send("evm_mine", []);
    await (await a.postAttendance([addresses[2]], 2_000_000_000_000n)).wait();
    await (await a.connect(chain.signers[3]).challenge({ value: 30_000_000_000n })).wait();
    await (await a.matchChallenge(addresses[3], { value: 30_000_000_000n })).wait();
    const protectedMatched = await protectedDContext(source, protectedC, chain.provider, legacy.artifacts);
    const posted = await syntheticUI("attendance", "owner");
    const postedAt = (await posted.getBlock()).timestamp;
    assert.equal(Number(await event.challengeEndsAt()), postedAt + 900);
    const challenged = await syntheticUI("challenge", "bob");
    assert.equal(Number((await event.challenges(scope.bob)).matchEndsAt), (await challenged.getBlock()).timestamp + 900);
    await syntheticUI("match", "owner");
    const matched = await stateOf(event, chain.provider, scope, resolver);
    assert.equal(matched.bobCase.localDisputeID, "1"); assert.equal(matched.bobCase.arbitratorDisputeID, "1001");
    await chain.provider.send("evm_increaseTime", [Number(await event.challengeEndsAt()) - (await chain.provider.getBlock("latest")).timestamp + 1]);
    await chain.provider.send("evm_mine", []); await syntheticUI("payout", "owner");
    const operator = { stage: "ruling", plan, manifest, source, protectedC, provider: chain.provider, ...selected,
      legacyArtifacts: legacy.artifacts, stack, journalPath, proofRoot: temp, signer: actors.owner };
    const ruled = await runDOperator(operator);
    assert.equal(ruled.after.bobCase.finalRuling, 1); assert.equal(ruled.after.heldBack, UI_D.depositWei);
    assert.equal(ruled.after.owedTotal, "0"); assert.equal(ruled.transactionsBroadcast, 1);
    const nonce = await chain.provider.getTransactionCount(actors.owner.address);
    const recovered = await runDOperator({ ...operator, signer: undefined });
    assert.equal(recovered.transactionsBroadcast, 0);
    assert.equal(await chain.provider.getTransactionCount(actors.owner.address), nonce);
    Object.assign(journal, loadJournal(journalPath, plan));
    const goodProof = readJson(path.join(proofDir, "ui-d-release-payouts.json")), bad = copy(goodProof);
    bad.source.protectedCManifestSha256 = "0".repeat(64);
    assert.throws(() => assertDUIProofContext(bad, plan, manifest));
    await syntheticUI("settle", "owner");
    const verified = await runDOperator({ ...operator, stage: "verify", signer: undefined });
    assert.equal(verified.after.bobCase.state, 3); assert.equal(verified.after.heldBack, "0");
    assert.equal(verified.after.owedTotal, "0"); assert.equal(verified.after.balance, "0");
    assert.equal(verified.attendancePaidWei[scope.alice.toLowerCase()], UI_D.depositWei);
    assert.equal(verified.attendancePaidWei[scope.bob.toLowerCase()], UI_D.depositWei);
    assert.equal(verified.collateralDelivery.totalChallengeCollateralWei, "30000000000");
    assert.equal(verified.collateralDelivery.recipients.find(r => r.wallet === scope.bob).collateralDeliveredWei, "30000000000");
    assert.equal(verified.transactionsBroadcast, 0);
    assertProtectedDUnchanged(protectedMatched, await protectedDContext(source, protectedC, chain.provider, legacy.artifacts));
    assert.doesNotMatch(fs.readFileSync(journalPath, "utf8"), /privateKey|signedTransaction|serialized/);
    assert.ok(loadJournal(journalPath, plan).transactions[D_RULING_ACTION]);
  } finally {
    if (miner) clearInterval(miner); if (mining) await mining;
    await chain.close(); fs.rmSync(temp, { recursive: true, force: true });
  }
});
