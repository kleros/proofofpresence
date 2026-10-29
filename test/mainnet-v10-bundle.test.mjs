// Pure guards only: synthetic framework proof and local-node responses, no node process/RPC/signing.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ethers } from "ethers";
import { prepareV10Release, verifyV10Build, V10_PROFILE, V10_CONTRACT_NAMES } from "../scripts/mainnet/prepare-v10-release.mjs";
import { validateV10RehearsalInputs, assertV10LocalAnvil, assertV10MeasuredGas, main, V10_REHEARSAL_DEPLOYER } from "../scripts/mainnet/rehearse-v10-bundle.mjs";
import { METAMASK_V130 } from "../src/v10-wallet-compatibility.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const hexHash = ethers.id("synthetic-observed-block"), nonce = 6;
let build, plan;
before(() => {
  build = verifyV10Build();
  plan = prepareV10Release({ schemaVersion: 1, version: 10, chainId: 1, contractVersion: V10_PROFILE,
    deployer: V10_REHEARSAL_DEPLOYER, deployerNonce: nonce,
    governance: { kind: "single-owner-immediate", initialOwner: V10_REHEARSAL_DEPLOYER, upgradeDelaySeconds: 0, renounceable: true },
    fees: { maxFeePerGasWei: "750000000", maxPriorityFeePerGasWei: "10000000" },
    gasLimits: Object.fromEntries(V10_CONTRACT_NAMES.map((name, i) => [name, ["850000", "5600000", "2000000", "300000"][i]])),
    maxTotalGasCostWei: "6562500000000000" }, build);
}, { timeout: 180000 });
function fixture() {
  const contracts = Object.entries({ manager: METAMASK_V130.manager, delegate: METAMASK_V130.delegate,
    nativeBalanceEnforcer: METAMASK_V130.nativeBalanceChangeEnforcer }).map(([name, address], i) => {
    const code = "0x600" + String(i) + "60005260206000f3"; return { name, address, code, codeHash: ethers.keccak256(code) };
  });
  const observed = { kind: "observed-metamask-v1.3-runtime", chainId: 1, anchor: { number: 123, hash: hexHash }, contracts };
  const frameworkProof = { kind: "metamask-v1.3-source-runtime-verification", schemaVersion: 1, status: "verified", sourceVerified: true,
    financialEligible: false, chainId: 1, officialSourceCommit: "bfbdf9795a976833ed2fa000baf42fbb83958b03",
    compiler: "0.8.23+commit.f704f362.Emscripten.clang", observedAnchor: { ...observed.anchor }, contracts: contracts.map(row => ({
      name: row.name, address: row.address, runtimeCodeHash: row.codeHash, sourceVerified: true, compiledTemplateMatches: true,
      fullObservedRuntimeMatches: true, actualObservedChain: 1, crossChainAddressAssumptionUsed: false, runtimeByteLength: ethers.getBytes(row.code).length,
      sourceInputSha256: "a".repeat(64), compilationInputSha256: "b".repeat(64), sourceCount: 1, sourcePins: [{ synthetic: true }] })) };
  const code = "0xef0100" + METAMASK_V130.delegate.slice(2).toLowerCase();
  const accountObservation = { schemaVersion: 1, kind: "v10-preliminary-account-observation", chainId: 1,
    wallet: V10_REHEARSAL_DEPLOYER, anchor: { number: 124, hash: ethers.id("account-anchor"), timestamp: 1900000000, baseFeePerGasWei: "285820286" },
    account: { category: "eip7702-delegated", code, codeHash: ethers.keccak256(code), delegate: METAMASK_V130.delegate },
    nonces: { pinned: "6", latest: "6", pending: "6" }, balanceWei: "9129904262762008", fees: { baseFeePerGasWei: "285820286" },
    signatures: 0, broadcasts: 0, privateFilesRead: 0, deploymentAuthorized: false, gasBudgetApproval: "NONE" };
  return seal({ plan: structuredClone(plan), build, observed, frameworkProof, accountObservation });
}
function seal(value) {
  value.planSha256 = sha(JSON.stringify(value.plan));
  for (const [object, prefix] of [[value.observed, "observed"], [value.frameworkProof, "frameworkProof"], [value.accountObservation, "accountObservation"]]) {
    value[prefix + "Raw"] = JSON.stringify(object); value[prefix + "Sha256"] = sha(value[prefix + "Raw"]);
  }
  return value;
}
const code = expected => error => error.code === expected;

test("V10 bundle default is zero-access and has no public RPC, fork, key or broadcast option", async () => {
  const result = await main([]); assert.equal(result.status, "review-only"); assert.equal(result.gasBudgetApproval, "NONE");
  for (const field of ["publicNetworkRequests", "loopbackRequests", "privateFilesRead", "signatures", "broadcasts"]) assert.equal(result[field], 0);
  for (const args of [["--run-loopback", "--rpc", "https://example.invalid"], ["--fork", "https://example.invalid"],
    ["--run-loopback", "--private-key", "SYNTHETIC-SECRET"]]) {
    const run = spawnSync(process.execPath, ["scripts/mainnet/rehearse-v10-bundle.mjs", ...args], { encoding: "utf8" });
    assert.equal(run.status, 1); assert.equal(run.stdout, ""); assert.doesNotMatch(run.stderr, /example.invalid|SYNTHETIC-SECRET/);
  }
});

test("exact planner requests and all raw/canonical public input pins must match", () => {
  const f = fixture(); assert.equal(validateV10RehearsalInputs(f).plan.startingNonce, 6);
  for (const field of ["planSha256", "observedSha256", "frameworkProofSha256", "accountObservationSha256"]) {
    const changed = fixture(); changed[field] = "0".repeat(64); assert.throws(() => validateV10RehearsalInputs(changed));
  }
  for (const change of [p => p.transactions[0].to = METAMASK_V130.manager, p => p.transactions[1].data += "00", p => p.transactions[2].nonce++,
    p => p.transactions[3].value = "1", p => p.deployer = ethers.ZeroAddress, p => p.configuration.governance.initialOwner = METAMASK_V130.manager]) {
    const changed = fixture(); change(changed.plan); seal(changed); assert.throws(() => validateV10RehearsalInputs(changed), code("PLAN_BUILD_MISMATCH"));
  }
});

test("source/runtime claims, fixed framework identities and observation anchors fail closed", () => {
  for (const change of [f => f.frameworkProof.sourceVerified = false, f => f.frameworkProof.officialSourceCommit = "a".repeat(40),
    f => f.frameworkProof.observedAnchor.hash = ethers.ZeroHash, f => f.observed.contracts[0].address = METAMASK_V130.delegate,
    f => f.observed.contracts.push(f.observed.contracts[0]), f => f.frameworkProof.contracts[1].fullObservedRuntimeMatches = false,
    f => f.frameworkProof.contracts[0].runtimeCodeHash = ethers.ZeroHash, f => f.frameworkProof.contracts[2].sourcePins = [],
    f => f.frameworkProof.contracts[1].crossChainAddressAssumptionUsed = true]) {
    const value = fixture(); change(value); seal(value); assert.throws(() => validateV10RehearsalInputs(value));
  }
});

test("actual available balance, nonce, delegate, fee and unapproved-budget context remain bound to the plan", () => {
  for (const change of [f => f.accountObservation.chainId = 10200, f => f.accountObservation.wallet = METAMASK_V130.delegate,
    f => f.accountObservation.nonces.pending = "7", f => f.accountObservation.account.code = "0x6000",
    f => f.accountObservation.balanceWei = "1", f => f.accountObservation.gasBudgetApproval = "approved",
    f => { f.accountObservation.fees.baseFeePerGasWei = "999999999"; f.accountObservation.anchor.baseFeePerGasWei = "999999999"; }]) {
    const value = fixture(); change(value); seal(value); assert.throws(() => validateV10RehearsalInputs(value));
  }
});

test("local mutation guard rejects remote/wrong-chain/forked/non-Prague/dead processes before mutations", async () => {
  const endpoint = "http://127.0.0.1:18545/", child = { pid: 12345, exitCode: null, signalCode: null };
  const fake = (change = (_method, value) => value) => ({ calls: [], _getConnection: () => ({ url: endpoint }), async send(method) {
    this.calls.push(method); const result = method === "anvil_nodeInfo" ? { environment: { chainId: "0x1" }, hardFork: "Prague", forkConfig: { forkUrl: null, forkBlockNumber: null } }
      : method === "web3_clientVersion" ? "anvil/v1.7.1" : "0x1"; return change(method, result); } });
  const good = fake(); await assertV10LocalAnvil(good, child, endpoint); assert.ok(good.calls.every(method => !/sendTransaction|set|impersonate/.test(method)));
  const remote = fake(); await assert.rejects(assertV10LocalAnvil(remote, child, "https://ethereum.example.invalid/"), code("NONLOCAL_NODE")); assert.equal(remote.calls.length, 0);
  await assert.rejects(assertV10LocalAnvil(fake(), { ...child, exitCode: 0 }, endpoint), code("NONLOCAL_NODE"));
  for (const change of [(m, v) => m === "eth_chainId" ? "0x27d8" : v, (m, v) => m === "anvil_nodeInfo" ? { ...v, hardFork: "Shanghai" } : v,
    (m, v) => m === "anvil_nodeInfo" ? { ...v, forkConfig: { forkUrl: "https://example.invalid", forkBlockNumber: 123 } } : v,
    (m, v) => m === "web3_clientVersion" ? "geth/v1" : v]) await assert.rejects(assertV10LocalAnvil(fake(change), child, endpoint), code("NONLOCAL_NODE"));
});

test("per-step measured gas sequence, declared limits, effective prices and total cap cannot be exceeded", () => {
  const measurements = plan.transactions.map(tx => ({ contract: tx.contract, gasLimit: tx.gasLimit, estimatedGas: "100000", gasUsed: "90000", effectiveGasPriceWei: "200000000" }));
  const result = assertV10MeasuredGas(plan, measurements); assert.equal(result.localActualGasPaidWei, "72000000000000");
  for (const change of [m => m[0].contract = m[1].contract, m => m[1].gasLimit = "1", m => m[2].estimatedGas = "2000001",
    m => m[0].gasUsed = "850001", m => m[3].effectiveGasPriceWei = "750000001", m => m.push(m[0])]) {
    const value = structuredClone(measurements); change(value); assert.throws(() => assertV10MeasuredGas(plan, value));
  }
  assert.throws(() => assertV10MeasuredGas({ ...plan, maxTotalGasCostWei: "1" }, measurements), code("BUDGET_CAP_EXCEEDED"));
});
