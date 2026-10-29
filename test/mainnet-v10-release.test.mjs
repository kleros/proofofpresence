// All deployment execution below is confined to an in-process synthetic Ganache chain.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import ganache from "ganache";
import { ethers } from "ethers";
import { validateV10ReleaseConfig, verifyV10Build, prepareV10Release, assertV10Artifact, v10RuntimeCode,
  V10_PROFILE, V10_CONTRACT_NAMES } from "../scripts/mainnet/prepare-v10-release.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const deployer = "0x0000000000000000000000000000000000000011";
const config = (wallet = deployer, nonce = 7) => ({ schemaVersion: 1, version: 10, chainId: 1, contractVersion: V10_PROFILE,
  deployer: wallet, deployerNonce: nonce,
  governance: { kind: "single-owner-immediate", initialOwner: wallet, upgradeDelaySeconds: 0, renounceable: true },
  fees: { maxFeePerGasWei: "20000000000", maxPriorityFeePerGasWei: "1000000000" },
  gasLimits: Object.fromEntries(V10_CONTRACT_NAMES.map(name => [name, "9000000"])), maxTotalGasCostWei: "1000000000000000000" });
let build;
before(() => { build = verifyV10Build(); }, { timeout: 180000 });

test("V10 config rejects V9 identity, governance ambiguity, signing fields and unbounded fee proposals", () => {
  const changes = [c => c.version = 9, c => c.contractVersion = "kleros-event-v9-uups", c => c.chainId = 10200,
    c => c.governance.kind = "single-owner-timelock", c => c.governance.upgradeDelaySeconds = 172800,
    c => c.governance.minimumDelaySeconds = 172800, c => c.governance.renounceable = false,
    c => c.governance.initialOwner = "0x0000000000000000000000000000000000000012",
    c => c.deployer = ethers.ZeroAddress, c => c.deployerNonce = -1, c => c.deployerNonce = Number.MAX_SAFE_INTEGER,
    c => c.privateKey = "SYNTHETIC-FORBIDDEN-FIELD", c => c.rpc = "https://example.invalid",
    c => c.fees.maxPriorityFeePerGasWei = "20000000001", c => c.fees.maxFeePerGasWei = "2e10",
    c => c.fees.maxFeePerGasWei = String(2n ** 256n), c => c.maxTotalGasCostWei = "1",
    c => delete c.maxTotalGasCostWei, c => c.gasLimits.KlerosEventV10 = "16777217", c => c.gasLimits.KlerosEventV10 = "0",
    c => c.gasLimits.KlerosEventV9 = "9000000"];
  for (const change of changes) { const value = config(); change(value); assert.throws(() => validateV10ReleaseConfig(value)); }
  const input = config(), validated = validateV10ReleaseConfig(input);
  input.governance.initialOwner = ethers.ZeroAddress;
  assert.equal(validated.governance.initialOwner, deployer);
});

test("V10 plans require a sealed current build and bind four direct CREATEs plus atomic proxy initialization", () => {
  for (const forged of [{}, structuredClone(build), { ...build }])
    assert.throws(() => prepareV10Release(config(), forged), /freshly verified/);
  assert.throws(() => { build.contracts.KlerosEventV10.bytecode = "0x6000"; }, TypeError);
  const plan = prepareV10Release(config(), build);
  assert.deepEqual(plan.transactions.map(tx => tx.nonce), [7, 8, 9, 10]);
  assert.equal(plan.deploymentAuthorized, false);
  assert.equal(plan.preflightVerified, false);
  assert.equal(plan.gasEstimatesVerified, false);
  assert.equal(plan.gasLimitsStatus, "new-proposal-unapproved");
  assert.equal(plan.finalizationAutomatic, false);
  assert.equal(plan.guestEventCreated, false);
  assert.equal(plan.upgradeDelaySeconds, 0);
  for (const tx of plan.transactions) {
    assert.equal(tx.to, null); assert.equal(tx.value, "0"); assert.equal(tx.from, deployer); assert.equal(tx.chainId, 1); assert.equal(tx.type, 2);
    assert.equal(tx.predictedAddress, ethers.getCreateAddress({ from: deployer, nonce: tx.nonce }));
    assert.equal(tx.expectedRuntimeCodeHash, ethers.keccak256(v10RuntimeCode(build.contracts[tx.contract], tx.predictedAddress, build.controllerCodeHash)));
  }
  const controllerArguments = "0x" + plan.transactions[0].data.slice(build.contracts.KlerosUpgradeControllerV10.bytecode.length);
  assert.equal(ethers.AbiCoder.defaultAbiCoder().decode(["address"], controllerArguments)[0], deployer);
  const proxyArguments = "0x" + plan.transactions[3].data.slice(build.contracts.ERC1967Proxy.bytecode.length);
  const [implementation, initialize] = ethers.AbiCoder.defaultAbiCoder().decode(["address", "bytes"], proxyArguments);
  assert.equal(implementation, plan.addresses.KlerosEventFactoryV10);
  assert.deepEqual([...new ethers.Interface(build.contracts.KlerosEventFactoryV10.abi).decodeFunctionData("initialize", initialize)],
    [plan.addresses.KlerosEventV10, plan.addresses.KlerosUpgradeControllerV10]);
  const insufficient = config(); insufficient.gasLimits.KlerosEventV10 = "53000";
  assert.throws(() => prepareV10Release(insufficient, build), /intrinsic\/calldata floor/);
  assert.equal(plan.signatures, 0); assert.equal(plan.broadcasts, 0); assert.equal(plan.networkRequests, 0);
});

test("V10 artifact gate rejects code, ABI, storage, reference and library tampering", () => {
  const artifact = build.contracts.KlerosEventV10;
  const compiled = { abi: artifact.abi, storageLayout: artifact.storageLayout, evm: {
    bytecode: { object: artifact.bytecode.slice(2), linkReferences: {} },
    deployedBytecode: { object: artifact.deployedBytecode.slice(2), immutableReferences: artifact.immutableReferences } } };
  const original = { ...structuredClone(artifact), linkReferences: {} };
  assertV10Artifact("KlerosEventV10", compiled, original);
  for (const change of [a => a.bytecode = "0x6000", a => a.deployedBytecode = "0x6000", a => a.abi = [],
    a => a.storageLayout.storage[0].slot = "999", a => a.immutableReferences = {},
    a => a.linkReferences = { file: { lib: [{ start: 0, length: 20 }] } }]) {
    const value = structuredClone(original); change(value); assert.throws(() => assertV10Artifact("KlerosEventV10", compiled, value));
  }
});

test("V10 runtime patching rejects stale V9 controller metadata, overlaps, unknown IDs and nonzero holes", () => {
  const artifact = build.contracts.KlerosEventV10, ids = Object.keys(artifact.immutableValues);
  const selfId = ids.find(id => artifact.immutableValues[id].name === "__self");
  const controllerId = ids.find(id => artifact.immutableValues[id].name === "_controllerCodeHash");
  for (const change of [a => a.immutableValues[controllerId].name = "_timelockCodeHash",
    a => a.immutableValues[controllerId].value = ethers.ZeroHash,
    a => a.immutableReferences[controllerId][0].start = a.immutableReferences[selfId][0].start,
    a => a.immutableReferences[selfId][0].length = 20, a => a.immutableReferences[selfId][0].start = -1,
    a => a.immutableReferences[selfId][0].start = Number.MAX_SAFE_INTEGER,
    a => delete a.immutableValues[controllerId], a => a.immutableValues[selfId].name = "unknown",
    a => { const bytes = ethers.getBytes(a.deployedBytecode); bytes[a.immutableReferences[selfId][0].start] = 1; a.deployedBytecode = ethers.hexlify(bytes); }]) {
    const value = structuredClone(artifact); change(value); assert.throws(() => v10RuntimeCode(value, deployer, build.controllerCodeHash));
  }
});

test("V10 build verification rejects saved source tampering before recompilation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kleros-v10-build-tamper-"));
  try {
    const input = JSON.parse(fs.readFileSync(path.join(ROOT, "build/contracts-v10/standard-input.json")));
    input.sources["contracts/v10/KlerosEventV10.sol"].content += "\n// unreviewed source mutation\n";
    fs.writeFileSync(path.join(directory, "standard-input.json"), JSON.stringify(input));
    fs.copyFileSync(path.join(ROOT, "build/contracts-v10/manifest.json"), path.join(directory, "manifest.json"));
    assert.throws(() => verifyV10Build({ artifactDirectory: directory }), /Saved compiler source differs/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("V10 default CLI is offline and has no signing, broadcast, deploy or RPC option", () => {
  const run = args => spawnSync(process.execPath, ["scripts/mainnet/prepare-v10-release.mjs", ...args], { cwd: ROOT, encoding: "utf8" });
  const result = run([]); assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  for (const name of ["networkRequests", "privateFilesRead", "signatures", "broadcasts"]) assert.equal(value[name], 0);
  for (const args of [["--deploy"], ["--broadcast"], ["--signer", "test"], ["--rpc", "https://example.invalid"],
    ["--preflight"], ["--plan", ".runtime/private-wallets.json"], ["--output", "artifacts/v10-release/test.json"],
    ["--plan", "--output"], ["--plan", "registry/ethereum-v9-public-plan.json"]]) {
    const stopped = run(args); assert.equal(stopped.status, 1); assert.equal(stopped.stdout, "");
    assert.doesNotMatch(stopped.stderr, /ENOENT|private-wallets|example.invalid/);
  }
});

test("exact unsigned V10 four-CREATE bundle deploys only locally with matched runtimes and empty initialized factory", { timeout: 120000 }, async () => {
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 30000000 }, wallet: { totalAccounts: 1, defaultBalance: 100 } });
  const provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  try {
    assert.equal(await rpc.request({ method: "eth_chainId", params: [] }), "0x1");
    const owner = await provider.getSigner(), nonce = Number(BigInt(await rpc.request({ method: "eth_getTransactionCount", params: [owner.address, "latest"] })));
    assert.equal(await provider.getCode(owner.address), "0x");
    const plan = prepareV10Release(config(owner.address, nonce), build), receipts = [];
    for (const request of plan.transactions) {
      const tx = await owner.sendTransaction({ chainId: request.chainId, type: request.type, nonce: request.nonce, to: null,
        data: request.data, value: 0n, gasLimit: BigInt(request.gasLimit), maxFeePerGas: BigInt(request.maxFeePerGasWei),
        maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGasWei) });
      const receipt = await tx.wait(), code = await provider.getCode(request.predictedAddress);
      assert.equal(receipt.status, 1); assert.equal(receipt.contractAddress, request.predictedAddress);
      assert.equal(tx.to, null); assert.equal(tx.from, owner.address); assert.equal(tx.data, request.data);
      assert.equal(tx.chainId, 1n); assert.equal(tx.nonce, request.nonce); assert.equal(tx.value, 0n); assert.equal(tx.type, 2);
      assert.equal(tx.gasLimit, BigInt(request.gasLimit)); assert.equal(tx.maxFeePerGas, BigInt(request.maxFeePerGasWei));
      assert.equal(tx.maxPriorityFeePerGas, BigInt(request.maxPriorityFeePerGasWei));
      assert.equal(code, v10RuntimeCode(build.contracts[request.contract], request.predictedAddress, build.controllerCodeHash));
      assert.equal(ethers.keccak256(code), request.expectedRuntimeCodeHash); assert.ok(receipt.gasUsed < BigInt(request.gasLimit));
      const block = await provider.getBlock(receipt.blockNumber);
      assert.equal(block.hash, receipt.blockHash);
      receipts.push({ contract: request.contract, transactionHash: tx.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
        address: receipt.contractAddress, runtimeCodeHash: ethers.keccak256(code), gasUsed: String(receipt.gasUsed), gasLimit: request.gasLimit });
    }
    const controller = new ethers.Contract(plan.addresses.KlerosUpgradeControllerV10, build.contracts.KlerosUpgradeControllerV10.abi, owner);
    const factory = new ethers.Contract(plan.factoryProxy, build.contracts.KlerosEventFactoryV10.abi, owner);
    const factoryImplementation = new ethers.Contract(plan.addresses.KlerosEventFactoryV10, build.contracts.KlerosEventFactoryV10.abi, owner);
    const eventImplementation = new ethers.Contract(plan.addresses.KlerosEventV10, build.contracts.KlerosEventV10.abi, owner);
    const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    assert.equal(await controller.owner(), owner.address); assert.equal(await controller.pendingOwner(), ethers.ZeroAddress);
    assert.equal(await controller.VERSION(), 10n); assert.equal(await controller.UPGRADE_DELAY_SECONDS(), 0n);
    assert.equal(await controller.upgradesDisabled(), false);
    assert.equal(await factory.VERSION(), 10n); assert.equal(await eventImplementation.VERSION(), 10n);
    assert.equal(await factory.eventImplementation(), plan.addresses.KlerosEventV10);
    assert.equal(await factory.upgradeAuthority(), controller.target); assert.equal(await factory.eventCount(), 0n);
    assert.equal(await factory.proxyCreationCodeHash(), ethers.keccak256(build.contracts.ERC1967Proxy.bytecode));
    assert.equal(await provider.getStorage(plan.factoryProxy, implementationSlot), ethers.zeroPadValue(plan.addresses.KlerosEventFactoryV10, 32));
    assert.equal(await factoryImplementation.upgradeAuthority(), ethers.ZeroAddress);
    assert.equal(await eventImplementation.upgradeAuthority(), ethers.ZeroAddress);
    assert.equal(await eventImplementation.proxiableUUID(), implementationSlot);
    for (const target of [factory, factoryImplementation])
      await assert.rejects(target.initialize.staticCall(eventImplementation.target, controller.target));
    for (const target of Object.values(plan.addresses)) assert.equal(await provider.getBalance(target), 0n);
    assert.equal(await provider.getTransactionCount(owner.address), nonce + 4);
    const proof = { schemaVersion: 1, status: "PASS", scope: "synthetic-in-process-chain1-four-CREATE-setup-only",
      contractVersion: V10_PROFILE, version: 10, measuredAt: new Date().toISOString(), hardfork: "shanghai",
      sourceHashes: build.sourceHashes, provenance: plan.provenance, compiler: build.compiler,
      tooling: Object.fromEntries(["scripts/compile-contracts-v10.mjs", "scripts/mainnet/prepare-v10-release.mjs", "test/mainnet-v10-release.test.mjs"]
        .map(filename => [filename, sha(fs.readFileSync(path.join(ROOT, filename)))])),
      planSha256: sha(JSON.stringify(plan)), publicConfiguration: plan.configuration, addresses: plan.addresses, receipts,
      totalGasUsed: String(receipts.reduce((sum, item) => sum + BigInt(item.gasUsed), 0n)),
      exactRuntimeBytesMatched: true, ownerMatched: true, pendingOwnerZero: true, delaySeconds: 0, upgradesDisabled: false,
      factoryDefaultMatched: true, factoryProxyImplementationSlotMatched: true, initializedAtomically: true, eventCount: 0,
      noGuestEvent: true, noAutomaticFinalization: true, publicNetworkRequests: 0, mainnetSignatures: 0, mainnetBroadcasts: 0, privateKeysRead: 0,
      gasProposalApproved: false, mainnetPreflightVerified: false,
      limitations: ["Gas measured on local Shanghai Ganache, not a current Ethereum fork or a mainnet estimate",
        "No deposit/dispute/payment flow, public Court, deployment bridge, hosting or publication exercised",
        "Actual signing requires fresh canonical mainnet, empty-code EOA, nonce, envelope, balance, fee and gas-budget checks"] };
    const directory = path.join(ROOT, "artifacts/v10-release"); fs.mkdirSync(directory, { recursive: true });
    const filename = "local-setup-measured-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    fs.writeFileSync(path.join(directory, filename), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ artifact: "artifacts/v10-release/" + filename, totalGasUsed: proof.totalGasUsed,
      gasUsed: Object.fromEntries(receipts.map(item => [item.contract, item.gasUsed])), mainnetBroadcasts: 0 }));
  } finally { provider.destroy(); await rpc.disconnect(); }
});
