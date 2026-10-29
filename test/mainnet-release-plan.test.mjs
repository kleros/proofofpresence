import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { ethers } from "ethers";
import { validateReleaseConfig, prepareRelease, preflightRelease, assertV9Artifact, V9_PROFILE } from "../scripts/mainnet/prepare-release.mjs";
import { v9RuntimeCode } from "../scripts/mainnet/runtime-code.mjs";

const multisig = "0x0000000000000000000000000000000000000012";
const deployer = "0x0000000000000000000000000000000000000011";
const names = ["KlerosUpgradeTimelockV9", "KlerosEventV9", "KlerosEventFactoryV9", "ERC1967Proxy"];
const config = () => ({ schemaVersion: 1, chainId: 1, contractVersion: V9_PROFILE, deployer, deployerNonce: 7,
  governance: { kind: "project-multisig", multisig, expectedCodeHash: "0x" + "ab".repeat(32), minimumDelaySeconds: 172800 },
  fees: { maxFeePerGasWei: "20000000000", maxPriorityFeePerGasWei: "1000000000" },
  gasLimits: Object.fromEntries(names.map(name => [name, "9000000"])), maxTotalGasCostWei: "1000000000000000000" });
// Tiny ABI fixture tests planning identity; real bytecode equality is tested by verifyV9Build.
const build = { compiler: "fixture", standardInputSha256: "fixture", sourceHashes: {}, contracts: {
  KlerosUpgradeTimelockV9: { abi: ["constructor(address projectMultisig)"], bytecode: "0x60006000" },
  KlerosEventV9: { abi: [], bytecode: "0x60006000" },
  KlerosEventFactoryV9: { abi: ["function initialize(address eventImplementation_,address upgradeAuthority_)"], bytecode: "0x60006000" },
  ERC1967Proxy: { abi: ["constructor(address implementation,bytes data)"], bytecode: "0x60006000" },
} };
for (const artifact of Object.values(build.contracts)) artifact.deployedBytecode = "0x6000";

test("V9 unsigned requests bind deterministic nonces, project timelock and atomic factory initialization", () => {
  const plan = prepareRelease(config(), build);
  assert.equal(plan.status, "unsigned-review-only");
  assert.equal(plan.deploymentAuthorized, false);
  assert.equal(plan.gasEstimatesVerified, false);
  assert.deepEqual(plan.transactions.map(tx => tx.nonce), [7, 8, 9, 10]);
  assert.ok(plan.transactions.every(tx => tx.to === null && tx.chainId === 1 && tx.value === "0" && tx.from === deployer));
  for (const tx of plan.transactions)
    assert.equal(tx.predictedAddress, ethers.getCreateAddress({ from: deployer, nonce: tx.nonce }));
  const timelockArgs = ethers.AbiCoder.defaultAbiCoder().decode(["address"], "0x" + plan.transactions[0].data.slice(10));
  assert.equal(timelockArgs[0], multisig);
  const proxyArgs = ethers.AbiCoder.defaultAbiCoder().decode(["address", "bytes"], "0x" + plan.transactions[3].data.slice(10));
  assert.equal(proxyArgs[0], plan.addresses.KlerosEventFactoryV9);
  const initialization = new ethers.Interface(build.contracts.KlerosEventFactoryV9.abi).decodeFunctionData("initialize", proxyArgs[1]);
  assert.deepEqual([...initialization], [plan.addresses.KlerosEventV9, plan.addresses.KlerosUpgradeTimelockV9]);
  assert.equal(plan.broadcasts, 0);
  assert.equal(plan.signatures, 0);
});

test("production inputs reject wrong networks, short delays, hidden signing fields and missing budgets", () => {
  const mutate = [
    c => c.chainId = 10200, c => c.contractVersion = "kleros-event-v8-test15m",
    c => c.governance.minimumDelaySeconds = 900, c => c.governance.kind = "organizer-eoa",
    c => c.privateKey = "NEVER-A-REAL-KEY", c => c.governance.multisig = deployer,
    c => c.governance.multisig = ethers.ZeroAddress, c => c.deployerNonce = -1,
    c => c.governance.expectedCodeHash = ethers.ZeroHash, c => c.fees.maxPriorityFeePerGasWei = "30000000000",
    c => c.maxTotalGasCostWei = "1", c => c.gasLimits.KlerosEventV9 = "0",
    c => c.gasLimits.KlerosEventV9 = "16777217", c => delete c.maxTotalGasCostWei,
    c => c.fees.maxFeePerGasWei = "2e10",
  ];
  for (const change of mutate) { const c = config(); change(c); assert.throws(() => validateReleaseConfig(c)); }
  const original = config(), validated = validateReleaseConfig(original);
  original.governance.multisig = ethers.ZeroAddress;
  assert.equal(validated.governance.multisig, multisig);
});

test("preflight rejects modified calldata or claimed build before public network access", async () => {
  for (const change of [p => p.transactions[1].data = "0xdeadbeef", p => p.addresses.ERC1967Proxy = multisig,
    p => p.transactions[0].maxFeePerGasWei = "1", p => p.startingNonce = 8]) {
    const plan = prepareRelease(config(), build); change(plan);
    let requests = 0;
    await assert.rejects(preflightRelease(plan, { build, transport: { request: async () => { requests++; throw new Error("unexpected transport"); } } }), /differs/);
    assert.equal(requests, 0);
  }
});

test("preflight rejects pending deployment nonce conflicts before Court reads", async () => {
  for (const nonce of ["0x6", "0x8", "0xb"]) {
    const calls = [];
    const transport = { request: async (method, params) => {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_getTransactionCount") { assert.deepEqual(params, [deployer, "pending"]); return nonce; }
      throw new Error("Court must not be accessed after a conflicting nonce");
    } };
    await assert.rejects(preflightRelease(prepareRelease(config(), build), { build, transport }), /conflicting pending nonce/);
    assert.deepEqual(calls.map(c => c.method), ["eth_chainId", "eth_getTransactionCount"]);
  }
});

test("preflight captures plan identity before asynchronous RPC can mutate its caller", async () => {
  const plan = prepareRelease(config(), build);
  const transport = { request: async (method, params) => {
    if (method === "eth_chainId") {
      plan.deployer = multisig; plan.startingNonce = 8; plan.transactions[0].data = "0xdeadbeef";
      return "0x1";
    }
    assert.equal(method, "eth_getTransactionCount");
    assert.deepEqual(params, [deployer, "pending"]);
    return "0x8";
  } };
  await assert.rejects(preflightRelease(plan, { build, transport }), /conflicting pending nonce/);
});

test("artifact gate rejects changed code, ABI, layouts and immutable locations", () => {
  const compiled = { abi: [], storageLayout: { storage: [], types: {} }, evm: {
    bytecode: { object: "6000", linkReferences: {} },
    deployedBytecode: { object: "6001", immutableReferences: {} },
  } };
  const artifact = { abi: [], bytecode: "0x6000", deployedBytecode: "0x6001", storageLayout: compiled.storageLayout,
    immutableReferences: {}, linkReferences: {} };
  assertV9Artifact("fixture", compiled, artifact);
  for (const change of [a => a.bytecode = "0x6001", a => a.deployedBytecode = "0x6000", a => a.abi = ["changed"],
    a => a.storageLayout.storage.push({ slot: "0" }), a => a.immutableReferences = { "7": [{ start: 0, length: 32 }] },
    a => a.linkReferences = { file: { lib: [{ start: 0, length: 20 }] } }]) {
    const copy = structuredClone(artifact); change(copy); assert.throws(() => assertV9Artifact("fixture", compiled, copy));
  }
});

test("runtime materialization distinguishes implementation address and timelock hash immutables", () => {
  const hash = "0x" + "ab".repeat(32);
  const artifact = { deployedBytecode: "0x" + "00".repeat(64),
    immutableReferences: { "1": [{ start: 0, length: 32 }], "2": [{ start: 32, length: 32 }] },
    immutableValues: { "1": { name: "__self", type: "address", value: "implementation-address" },
      "2": { name: "_timelockCodeHash", type: "bytes32", value: hash } } };
  assert.equal(v9RuntimeCode(artifact, deployer, hash), ethers.zeroPadValue(deployer, 32) + hash.slice(2));
  for (const change of [a => a.immutableValues["2"].value = ethers.ZeroHash,
    a => a.immutableReferences["2"][0].start = 1, a => a.immutableReferences["1"][0].length = 20,
    a => a.immutableValues["1"].name = "unreviewed", a => delete a.immutableValues["2"],
    a => a.deployedBytecode = "0x" + "ff".repeat(64)]) {
    const copy = structuredClone(artifact); change(copy); assert.throws(() => v9RuntimeCode(copy, deployer, hash));
  }
});

test("default review and forbidden deployment options never access configuration or RPC", () => {
  const run = args => spawnSync(process.execPath, ["scripts/mainnet/prepare-release.mjs", ...args], { encoding: "utf8" });
  const review = run([]);
  assert.equal(review.status, 0, review.stderr);
  assert.equal(JSON.parse(review.stdout).networkRequests, 0);
  assert.equal(JSON.parse(review.stdout).broadcasts, 0);
  for (const args of [["--deploy"], ["--plan", ".runtime/private-wallets.json"], ["--rpc", "https://example.invalid"]]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /ENOENT|private-wallets|secret|example.invalid/);
  }
});
