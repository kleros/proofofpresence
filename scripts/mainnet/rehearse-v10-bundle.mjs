// Exact public-plan rehearsal on a fresh, locally spawned no-fork Anvil only. No keys/signatures.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ethers } from "ethers";
import { prepareV10Release, verifyV10Build, v10RuntimeCode, V10_PROFILE } from "./prepare-v10-release.mjs";
import { METAMASK_V130 } from "../../src/v10-wallet-compatibility.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const V10_REHEARSAL_ANVIL = "/private/tmp/kleros-v10-anvil-MpZaXr/node_modules/@foundry-rs/anvil-darwin-arm64/bin/anvil";
export const V10_REHEARSAL_DEPLOYER = ethers.getAddress("0x2bb03593892724d225071068e59ab1e48af05b55");
const OBSERVED = "artifacts/v10-integration/metamask-runtime-observed.json";
const FRAMEWORK = Object.freeze({ manager: METAMASK_V130.manager, delegate: METAMASK_V130.delegate,
  nativeBalanceEnforcer: METAMASK_V130.nativeBalanceChangeEnforcer });
const SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const sha = value => createHash("sha256").update(value).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
class RehearsalError extends Error { constructor(code) { super("V10 local bundle rehearsal stopped: " + code); this.code = code; } }
const check = (value, code) => { if (!value) throw new RehearsalError(code); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Pure exact-plan/build and independently pinned public framework-proof gates. */
export function validateV10RehearsalInputs({ plan, build, planSha256, observed, observedSha256, observedRaw,
  frameworkProof, frameworkProofSha256, frameworkProofRaw, accountObservation, accountObservationSha256, accountObservationRaw } = {}) {
  check(digest(planSha256) && sha(JSON.stringify(plan)) === planSha256, "PLAN_HASH_MISMATCH");
  let rebuilt; try { rebuilt = prepareV10Release(plan?.configuration, build); } catch { throw new RehearsalError("PLAN_BUILD_MISMATCH"); }
  check(isDeepStrictEqual(plan, rebuilt) && plan.deployer === V10_REHEARSAL_DEPLOYER &&
    plan.governance.initialOwner === V10_REHEARSAL_DEPLOYER && plan.chainId === 1 && plan.contractVersion === V10_PROFILE &&
    plan.transactions.length === 4 && plan.transactions.every(tx => tx.to === null && tx.value === "0" && tx.type === 2 && tx.chainId === 1), "PLAN_BUILD_MISMATCH");
  check(digest(observedSha256) && sha(observedRaw) === observedSha256 && isDeepStrictEqual(JSON.parse(observedRaw), observed), "OBSERVED_HASH_MISMATCH");
  check(digest(frameworkProofSha256) && sha(frameworkProofRaw) === frameworkProofSha256 &&
    isDeepStrictEqual(JSON.parse(frameworkProofRaw), frameworkProof), "FRAMEWORK_PROOF_HASH_MISMATCH");
  check(observed?.kind === "observed-metamask-v1.3-runtime" && observed.chainId === 1 && observed.contracts?.length === 3 &&
    Number.isSafeInteger(observed.anchor?.number) && observed.anchor.number > 0 && ethers.isHexString(observed.anchor.hash, 32), "OBSERVED_SCOPE");
  check(frameworkProof?.kind === "metamask-v1.3-source-runtime-verification" && frameworkProof.schemaVersion === 1 &&
    frameworkProof.status === "verified" && frameworkProof.sourceVerified === true && frameworkProof.chainId === 1 &&
    frameworkProof.financialEligible === false && frameworkProof.officialSourceCommit === "bfbdf9795a976833ed2fa000baf42fbb83958b03" &&
    frameworkProof.compiler === "0.8.23+commit.f704f362.Emscripten.clang" && frameworkProof.contracts?.length === 3 &&
    isDeepStrictEqual(frameworkProof.observedAnchor, observed.anchor), "FRAMEWORK_SOURCE_UNVERIFIED");
  const runtimes = {};
  for (const [name, address] of Object.entries(FRAMEWORK)) {
    const rows = observed.contracts.filter(row => row.name === name), proofs = frameworkProof.contracts.filter(row => row.name === name);
    check(rows.length === 1 && proofs.length === 1, "FRAMEWORK_IDENTITY");
    const row = rows[0], proof = proofs[0];
    check(same(row.address, address) && same(proof.address, address) && ethers.isHexString(row.code) && row.code.length > 4 &&
      same(ethers.keccak256(row.code), row.codeHash) && same(row.codeHash, proof.runtimeCodeHash) &&
      proof.sourceVerified === true && proof.compiledTemplateMatches === true && proof.fullObservedRuntimeMatches === true &&
      proof.actualObservedChain === 1 && proof.crossChainAddressAssumptionUsed === false &&
      proof.runtimeByteLength === ethers.getBytes(row.code).length && digest(proof.sourceInputSha256) &&
      digest(proof.compilationInputSha256) && Array.isArray(proof.sourcePins) && proof.sourcePins.length === proof.sourceCount && proof.sourceCount > 0,
      "FRAMEWORK_RUNTIME_MISMATCH");
    runtimes[name] = row.code;
  }
  const identities = [plan.deployer, ...Object.values(plan.addresses), ...Object.values(FRAMEWORK)].map(value => value.toLowerCase());
  check(new Set(identities).size === identities.length, "LOCAL_ADDRESS_COLLISION");
  check(digest(accountObservationSha256) && sha(accountObservationRaw) === accountObservationSha256 &&
    isDeepStrictEqual(JSON.parse(accountObservationRaw), accountObservation), "ACCOUNT_OBSERVATION_HASH_MISMATCH");
  const account = accountObservation;
  check(account?.schemaVersion === 1 && account.kind === "v10-preliminary-account-observation" && account.chainId === 1 &&
    same(account.wallet, plan.deployer) && Number.isSafeInteger(account.anchor?.number) && account.anchor.number > 0 &&
    ethers.isHexString(account.anchor.hash, 32) && Number.isSafeInteger(account.anchor.timestamp) &&
    account.account?.category === "eip7702-delegated" && same(account.account.code, "0xef0100" + METAMASK_V130.delegate.slice(2)) &&
    same(account.account.codeHash, ethers.keccak256(account.account.code)) && same(account.account.delegate, METAMASK_V130.delegate) &&
    [account.nonces?.pinned, account.nonces?.latest, account.nonces?.pending].every(value => value === String(plan.startingNonce)) &&
    typeof account.balanceWei === "string" && /^[1-9][0-9]*$/.test(account.balanceWei) && BigInt(account.balanceWei) < 2n ** 256n &&
    typeof account.fees?.baseFeePerGasWei === "string" && /^(0|[1-9][0-9]*)$/.test(account.fees.baseFeePerGasWei) &&
    account.fees.baseFeePerGasWei === account.anchor.baseFeePerGasWei && account.signatures === 0 && account.broadcasts === 0 &&
    account.privateFilesRead === 0 && account.deploymentAuthorized === false && account.gasBudgetApproval === "NONE", "ACCOUNT_OBSERVATION_SCOPE");
  check(BigInt(account.balanceWei) >= BigInt(plan.maxTotalGasCostWei), "OBSERVED_BALANCE_CAP");
  check(BigInt(account.fees.baseFeePerGasWei) + BigInt(plan.configuration.fees.maxPriorityFeePerGasWei) <=
    BigInt(plan.configuration.fees.maxFeePerGasWei), "OBSERVED_FEE_CAP");
  return { plan: structuredClone(plan), runtimes };
}

/** Check a process we spawned, its exact loopback endpoint, client, chain, fork and hardfork. */
export async function assertV10LocalAnvil(provider, child, endpoint) {
  let url; try { url = new URL(endpoint); } catch { throw new RehearsalError("NONLOCAL_NODE"); }
  check(url.protocol === "http:" && url.hostname === "127.0.0.1" && /^\d+$/.test(url.port) && url.pathname === "/" &&
    !url.username && !url.password && !url.search && !url.hash && provider._getConnection().url === url.href &&
    child.exitCode === null && child.signalCode === null && Number.isSafeInteger(child.pid) && child.pid > 0, "NONLOCAL_NODE");
  const info = await provider.send("anvil_nodeInfo", []), client = await provider.send("web3_clientVersion", []),
    chain = await provider.send("eth_chainId", []);
  check(/^anvil\/v1\.7\.1\b/i.test(client) && BigInt(chain) === 1n && BigInt(info.environment?.chainId ?? 0) === 1n &&
    String(info.hardFork).toLowerCase() === "prague" && info.forkConfig?.forkUrl === null &&
    info.forkConfig.forkBlockNumber === null, "NONLOCAL_NODE");
  return info;
}

export function assertV10MeasuredGas(plan, measurements) {
  check(Array.isArray(measurements) && measurements.length > 0 && measurements.length <= 4, "MEASURED_GAS_SCOPE");
  let estimatedCap = 0n, actualCap = 0n, paid = 0n;
  for (const [i, item] of measurements.entries()) {
    const tx = plan.transactions[i];
    check(item.contract === tx.contract && item.gasLimit === tx.gasLimit && /^\d+$/.test(item.estimatedGas) && /^\d+$/.test(item.gasUsed) &&
      /^\d+$/.test(item.effectiveGasPriceWei), "MEASURED_GAS_SCOPE");
    const estimate = BigInt(item.estimatedGas), used = BigInt(item.gasUsed), limit = BigInt(tx.gasLimit);
    check(estimate > 0n && used > 0n && estimate <= limit && used <= limit && BigInt(item.effectiveGasPriceWei) <= BigInt(tx.maxFeePerGasWei), "GAS_CAP_EXCEEDED");
    estimatedCap += estimate * BigInt(tx.maxFeePerGasWei); actualCap += used * BigInt(tx.maxFeePerGasWei);
    paid += used * BigInt(item.effectiveGasPriceWei);
  }
  check(estimatedCap <= BigInt(plan.maxTotalGasCostWei) && actualCap <= BigInt(plan.maxTotalGasCostWei) && paid <= BigInt(plan.maxTotalGasCostWei), "BUDGET_CAP_EXCEEDED");
  return { estimatedGasAtDeclaredMaxFeeWei: String(estimatedCap), actualGasAtDeclaredMaxFeeWei: String(actualCap), localActualGasPaidWei: String(paid) };
}

function publicFile(filename, directory, maximum, namePattern = /^[a-z0-9-]+\.json$/) {
  const full = path.resolve(ROOT, filename), dir = path.join(ROOT, directory);
  check(path.dirname(full) === dir && namePattern.test(path.basename(full)), "PUBLIC_INPUT_PATH");
  const stat = fs.lstatSync(full); check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum && fs.realpathSync(full) === full, "PUBLIC_INPUT_PATH");
  return fs.readFileSync(full, "utf8");
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function sourcePins(source, build) {
  check(/^[a-f0-9]{40}$/.test(source) && execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() === source, "SOURCE_MISMATCH");
  const files = ["scripts/mainnet/rehearse-v10-bundle.mjs", "scripts/mainnet/prepare-v10-release.mjs", "scripts/compile-contracts-v10.mjs",
    "scripts/verify-metamask-v1.3-runtime.mjs", "src/v10-wallet-compatibility.mjs", "package.json", "package-lock.json",
    ...Object.keys(build.sourceHashes).filter(name => !name.startsWith("@openzeppelin/"))];
  return Object.fromEntries(files.map(file => {
    let committed; try { committed = execFileSync("git", ["show", `${source}:${file}`], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { throw new RehearsalError("SOURCE_MISMATCH"); }
    check(sha(committed) === sha(fs.readFileSync(path.join(ROOT, file))), "SOURCE_MISMATCH"); return [file, sha(committed)];
  }));
}

export async function main(argv = []) {
  if (!argv.length || (argv.length === 1 && argv[0] === "--review-only")) return { kind: "v10-four-create-local-rehearsal", status: "review-only",
    publicNetworkRequests: 0, loopbackRequests: 0, privateFilesRead: 0, signatures: 0, broadcasts: 0, gasBudgetApproval: "NONE",
    instruction: "--run-loopback --plan artifacts/v10-release/PUBLIC.json --plan-sha256 CANONICAL_SHA --source FULL_COMMIT --observed-sha256 RAW_SHA --framework-proof artifacts/v10-integration/PUBLIC.json --framework-proof-sha256 RAW_SHA --account-observation artifacts/v10-release/account-observation-TIMESTAMP-UUID.json --account-observation-sha256 RAW_SHA" };
  check(argv[0] === "--run-loopback", "EXPLICIT_LOOPBACK_REQUIRED");
  const options = {};
  for (let i = 1; i < argv.length; i += 2) {
    check(["--plan", "--plan-sha256", "--source", "--observed-sha256", "--framework-proof", "--framework-proof-sha256", "--account-observation", "--account-observation-sha256"].includes(argv[i]) &&
      !Object.hasOwn(options, argv[i]) && typeof argv[i + 1] === "string" && !argv[i + 1].startsWith("--"), "INVALID_OPTIONS");
    options[argv[i]] = argv[i + 1];
  }
  check(Object.keys(options).length === 8, "INVALID_OPTIONS");
  const plan = JSON.parse(publicFile(options["--plan"], "artifacts/v10-release", 500000)),
    observedRaw = publicFile(OBSERVED, "artifacts/v10-integration", 1000000), observed = JSON.parse(observedRaw),
    frameworkProofRaw = publicFile(options["--framework-proof"], "artifacts/v10-integration", 2000000), frameworkProof = JSON.parse(frameworkProofRaw),
    accountObservationRaw = publicFile(options["--account-observation"], "artifacts/v10-release", 100000,
      /^account-observation-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[a-f0-9-]{36}\.json$/), accountObservation = JSON.parse(accountObservationRaw),
    build = verifyV10Build(), pins = sourcePins(options["--source"], build),
    inputs = { plan, build, planSha256: options["--plan-sha256"], observed, observedRaw, observedSha256: options["--observed-sha256"],
      frameworkProof, frameworkProofRaw, frameworkProofSha256: options["--framework-proof-sha256"],
      accountObservation, accountObservationRaw, accountObservationSha256: options["--account-observation-sha256"] }, validated = validateV10RehearsalInputs(inputs);
  const info = fs.lstatSync(V10_REHEARSAL_ANVIL);
  check(info.isFile() && !info.isSymbolicLink() && fs.realpathSync(V10_REHEARSAL_ANVIL) === V10_REHEARSAL_ANVIL, "ANVIL_BINARY");
  check(/^anvil Version: 1\.7\.1\b/.test(execFileSync(V10_REHEARSAL_ANVIL, ["--version"], { encoding: "utf8" })), "ANVIL_BINARY");
  const out = path.join(ROOT, "artifacts/v10-integration/bundle", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID());
  fs.mkdirSync(out, { recursive: true });
  const proof = { schemaVersion: 1, kind: "v10-exact-four-create-local-rehearsal", status: "running", chainId: 1,
    environment: "fresh-loopback-anvil-prague-no-fork", sourceCommit: options["--source"], sourcePins: pins,
    planSha256: inputs.planSha256, observedRuntimeSha256: inputs.observedSha256, frameworkProofSha256: inputs.frameworkProofSha256,
    accountObservationSha256: inputs.accountObservationSha256, mainnetObservedAnchor: accountObservation.anchor,
    observedAvailableBalanceWei: accountObservation.balanceWei, mainnetObservedFees: accountObservation.fees,
    anvilBinarySha256: sha(fs.readFileSync(V10_REHEARSAL_ANVIL)), gasBudgetApproval: "NONE", publicNetworkRequests: 0,
    mainnetPreflightVerified: false, deploymentAuthorized: false, financialEligibilityEstablished: false,
    declaredFees: plan.configuration.fees, declaredGasLimits: plan.configuration.gasLimits,
    declaredMaximumGasCostWei: plan.maxTotalGasCostWei,
    privateFilesRead: 0, signatures: 0, userSignatureEstablished: false, localImpersonation: true, walletDesignationInstalledByLocalCheat: true,
    localTransactions: [], checks: [], limits: ["Exact CREATE gas rehearsal uses locally impersonated planned address; it is not a user signature or mainnet deployment.",
      "No fork or public RPC is used. Framework runtime bytes are installed as local fixtures; controller/factory storage is created by the exact plan.",
      "Gas figures describe this isolated Prague execution. Human budget approval and fresh mainnet wallet/nonce/fee checks remain required."] };
  let child, provider;
  try {
    const port = await freePort(), endpoint = `http://127.0.0.1:${port}/`, baseFee = BigInt(accountObservation.fees.baseFeePerGasWei);
    proof.localInitialBaseFeePerGasWei = String(baseFee);
    child = spawn(V10_REHEARSAL_ANVIL, ["--silent", "--host", "127.0.0.1", "--port", String(port), "--chain-id", "1", "--hardfork", "prague",
      "--accounts", "0", "--gas-limit", "60000000", "--base-fee", String(baseFee)], { stdio: ["ignore", "ignore", "ignore"] });
    provider = new ethers.JsonRpcProvider(endpoint, { chainId: 1, name: "local-v10-bundle" }, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 }); provider.pollingInterval = 10;
    let ready = false;
    for (let i = 0; i < 80; i++) { check(child.exitCode === null, "ANVIL_EXITED"); try { await provider.send("anvil_nodeInfo", []); ready = true; break; } catch { await sleep(50); } }
    check(ready, "ANVIL_UNAVAILABLE");
    const local = async (method, params) => { await assertV10LocalAnvil(provider, child, endpoint); return provider.send(method, params); };
    await assertV10LocalAnvil(provider, child, endpoint);
    check(BigInt(await provider.send("eth_blockNumber", [])) === 0n && (await provider.send("eth_accounts", [])).length === 0, "NONFRESH_NODE");
    for (const target of [plan.deployer, ...Object.values(plan.addresses), ...Object.values(FRAMEWORK)])
      check(await provider.getCode(target) === "0x" && await provider.getTransactionCount(target) === 0, "NONFRESH_NODE");
    for (const [name, address] of Object.entries(FRAMEWORK)) await local("anvil_setCode", [address, validated.runtimes[name]]);
    const designation = "0xef0100" + METAMASK_V130.delegate.slice(2).toLowerCase();
    await local("anvil_setCode", [plan.deployer, designation]);
    await local("anvil_setNonce", [plan.deployer, ethers.toQuantity(plan.startingNonce)]);
    await local("anvil_setBalance", [plan.deployer, ethers.toQuantity(BigInt(accountObservation.balanceWei))]);
    await local("anvil_impersonateAccount", [plan.deployer]);
    check(same(await provider.getCode(plan.deployer), designation) && await provider.getTransactionCount(plan.deployer) === plan.startingNonce, "LOCAL_ACCOUNT_SCOPE");
    proof.checks.push("Fresh official loopback Prague/no-fork node; fixed framework runtimes and planned local designation/nonce installed");
    for (const request of plan.transactions) {
      validateV10RehearsalInputs(inputs); check(isDeepStrictEqual(sourcePins(options["--source"], build), pins), "SOURCE_MISMATCH");
      await assertV10LocalAnvil(provider, child, endpoint);
      for (const [name, address] of Object.entries(FRAMEWORK)) check(same(ethers.keccak256(await provider.getCode(address)), ethers.keccak256(validated.runtimes[name])), "FRAMEWORK_RUNTIME_MISMATCH");
      check(same(await provider.getCode(plan.deployer), designation) && await provider.getTransactionCount(plan.deployer, "pending") === request.nonce &&
        await provider.getCode(request.predictedAddress) === "0x" && await provider.getTransactionCount(request.predictedAddress) === 0, "LOCAL_ACCOUNT_SCOPE");
      const tx = { from: request.from, to: null, chainId: "0x1", type: "0x2", nonce: ethers.toQuantity(request.nonce), value: "0x0", data: request.data,
        gas: ethers.toQuantity(BigInt(request.gasLimit)), maxFeePerGas: ethers.toQuantity(BigInt(request.maxFeePerGasWei)), maxPriorityFeePerGas: ethers.toQuantity(BigInt(request.maxPriorityFeePerGasWei)) };
      const estimate = BigInt(await provider.send("eth_estimateGas", [tx])); check(estimate > 0n && estimate <= BigInt(request.gasLimit), "GAS_CAP_EXCEEDED");
      const balanceBefore = await provider.getBalance(plan.deployer); check(balanceBefore >= BigInt(request.gasLimit) * BigInt(request.maxFeePerGasWei), "LOCAL_BALANCE_CAP");
      const transactionHash = await local("eth_sendTransaction", [tx]);
      const measurement = { contract: request.contract, transactionHash, status: "submitted", gasLimit: request.gasLimit, estimatedGas: String(estimate) };
      proof.localTransactions.push(measurement); fs.writeFileSync(path.join(out, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
      const receipt = await provider.waitForTransaction(transactionHash, 1, 20000), actual = await provider.getTransaction(transactionHash);
      check(receipt?.status === 1 && same(receipt.contractAddress, request.predictedAddress) && actual.to === null && same(actual.from, request.from) &&
        actual.chainId === 1n && actual.type === 2 && actual.nonce === request.nonce && actual.value === 0n && actual.data === request.data &&
        actual.gasLimit === BigInt(request.gasLimit) && actual.maxFeePerGas === BigInt(request.maxFeePerGasWei) && actual.maxPriorityFeePerGas === BigInt(request.maxPriorityFeePerGasWei), "CREATE_RECEIPT_MISMATCH");
      const block = await provider.getBlock(receipt.blockNumber), runtime = await provider.getCode(request.predictedAddress);
      check(block.hash === receipt.blockHash && runtime === v10RuntimeCode(build.contracts[request.contract], request.predictedAddress, build.controllerCodeHash) &&
        ethers.keccak256(runtime) === request.expectedRuntimeCodeHash, "CREATE_RUNTIME_MISMATCH");
      Object.assign(measurement, { status: "confirmed", address: receipt.contractAddress, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
        runtimeCodeHash: ethers.keccak256(runtime), gasUsed: String(receipt.gasUsed), effectiveGasPriceWei: String(receipt.gasPrice) });
      check(balanceBefore - await provider.getBalance(plan.deployer) === receipt.gasUsed * receipt.gasPrice, "LOCAL_GAS_ACCOUNTING");
      proof.gas = assertV10MeasuredGas(plan, proof.localTransactions);
      const controller = new ethers.Contract(plan.addresses.KlerosUpgradeControllerV10, build.contracts.KlerosUpgradeControllerV10.abi, provider);
      check(await controller.VERSION() === 10n && same(await controller.owner(), plan.deployer) && await controller.pendingOwner() === ethers.ZeroAddress &&
        await controller.upgradesDisabled() === false && await controller.UPGRADE_DELAY_SECONDS() === 0n, "CONTROLLER_MISMATCH");
      if (request.contract === "KlerosEventV10") check(await new ethers.Contract(request.predictedAddress, build.contracts.KlerosEventV10.abi, provider).upgradeAuthority() === ethers.ZeroAddress, "IMPLEMENTATION_INITIALIZED");
      if (request.contract === "KlerosEventFactoryV10") check(await new ethers.Contract(request.predictedAddress, build.contracts.KlerosEventFactoryV10.abi, provider).upgradeAuthority() === ethers.ZeroAddress, "IMPLEMENTATION_INITIALIZED");
      if (request.contract === "ERC1967Proxy") {
        const factory = new ethers.Contract(request.predictedAddress, build.contracts.KlerosEventFactoryV10.abi, provider);
        check(await factory.VERSION() === 10n && same(await factory.eventImplementation(), plan.addresses.KlerosEventV10) &&
          same(await factory.upgradeAuthority(), plan.addresses.KlerosUpgradeControllerV10) && await factory.eventCount() === 0n &&
          same(await provider.send("eth_getStorageAt", [request.predictedAddress, SLOT, "latest"]), ethers.zeroPadValue(plan.addresses.KlerosEventFactoryV10, 32)) &&
          same(await factory.proxyCreationCodeHash(), ethers.keccak256(build.contracts.ERC1967Proxy.bytecode)), "FACTORY_INITIALIZATION_MISMATCH");
      }
      proof.checks.push(`${request.step}: exact ${request.contract} CREATE, canonical receipt/runtime, gas and controller state verified`);
    }
    await assertV10LocalAnvil(provider, child, endpoint); validateV10RehearsalInputs(inputs);
    check(isDeepStrictEqual(sourcePins(options["--source"], build), pins), "SOURCE_MISMATCH");
    check(await provider.getTransactionCount(plan.deployer) === plan.startingNonce + 4, "LOCAL_NONCE_MISMATCH");
    proof.localRemainingBalanceWei = String(await provider.getBalance(plan.deployer)); proof.status = "passed";
    return { ...proof, proofPath: path.join(out, "proof.json") };
  } catch (error) { proof.status = "failed"; proof.error = { code: error instanceof RehearsalError ? error.code : "LOCAL_REHEARSAL_FAILED" }; throw error; }
  finally {
    provider?.destroy();
    if (child && child.exitCode === null) { child.kill("SIGTERM"); await Promise.race([new Promise(resolve => child.once("exit", resolve)), sleep(2000)]); if (child.exitCode === null) child.kill("SIGKILL"); }
    fs.writeFileSync(path.join(out, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error instanceof RehearsalError ? error.message : "V10 local bundle rehearsal stopped: INVALID_INPUT_OR_LOCAL_EXECUTION"); process.exitCode = 1;
  });
