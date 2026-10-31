// Read-only diagnostic for the original human-supplied transaction. Never signs,
// broadcasts, adopts an event, or modifies any app state/journal. Matching terms
// alone do not replace the production wallet/source/saved-review verification.
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { loadV10UpgradeableArtifacts } from "../../src/v10-upgrade-artifacts.mjs";
import { eventV10LumaTemplate } from "../../src/contracts-v10-luma.mjs";

const HASH = "0xb4c49e0e207b21bdd8a7f7755fa58b52e5fed07374529feaeb949600dfda6e8b";
const endpoints = new Set(["https://eth.drpc.org/", "https://ethereum-rpc.publicnode.com/"]);
const ENDPOINT = process.argv[3] ?? "https://eth.drpc.org/";
const APPROVAL = "artifacts/v10-release/human-release-approval-20261030.json";
const MANIFEST = "registry/ethereum-v10-luma-mainnet.json";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const check = (ok, code) => { if (!ok) throw Object.assign(Error(code), { code }); };
const sourceFiles = ["scripts/mainnet/audit-v10-synthetic-creation.mjs", "src/v10-upgrade-artifacts.mjs", "src/contracts-v10-luma.mjs", "src/contracts-v9-luma.mjs"];
const sourceHashes = Object.fromEntries(sourceFiles.map((p) => [p, sha(fs.readFileSync(p))]));
if (![3, 4].includes(process.argv.length) || process.argv[2] !== "--execute") {
  console.log(JSON.stringify({ status: "not-run", transactionHash: HASH, readOnly: true, sourceHashes }));
  process.exit(0);
}
check(endpoints.has(ENDPOINT), "UNREVIEWED_PUBLIC_ENDPOINT");
const proof = { kind: "v10-original-creation-readonly-terms-diagnostic", status: "unavailable", startedAt: new Date().toISOString(),
  transactionHash: HASH, sourceHashes, endpoint: ENDPOINT, requests: [], mismatches: [],
  signatures: 0, broadcasts: 0, walletRequests: 0, stateOrJournalWrites: 0,
  originalSavedReviewVerified: false, protectedWalletVerified: false, deploymentSourceVerified: false, depositAuthorized: false };
const methods = new Set(["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getTransactionCount", "eth_getBalance"]);
let last = 0, id = 0;
async function rpc(method, params = []) {
  check(methods.has(method), "FORBIDDEN_RPC_METHOD");
  const wait = 1500 - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const row = { method, params }; proof.requests.push(row);
  const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" },
    redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  row.httpStatus = response.status;
  const bytes = await response.text(); check(bytes.length <= 2000000, "RPC_SIZE");
  let body; try { body = JSON.parse(bytes); } catch { check(false, "RPC_RESPONSE"); }
  row.rpcErrorCode = body?.error?.code ?? null;
  check(response.ok && !body.error && body.id === id && Object.hasOwn(body, "result"), "RPC_READ_UNAVAILABLE");
  return body.result;
}
try {
  const approvalBytes = fs.readFileSync(APPROVAL), manifestBytes = fs.readFileSync(MANIFEST);
  check(sha(approvalBytes) === "7ba014b1a05e86127fbfded5f4a571db0187d34172f19940d50e7013a90eaee3", "APPROVAL_CHANGED");
  check(sha(manifestBytes) === "fadbb93a7d7d653eb610dbb26eb406a3fe88d55fbaa35ba3f34d83ff3ade6efd", "MANIFEST_CHANGED");
  proof.approval = { path: APPROVAL, sha256: sha(approvalBytes) };
  proof.manifest = { path: MANIFEST, sha256: sha(manifestBytes) };
  const terms = JSON.parse(approvalBytes).authorized.syntheticHostedTest, manifest = JSON.parse(manifestBytes);
  const factory = manifest.factoryDeployment.factory, wallet = terms.wallet;
  check(BigInt(await rpc("eth_chainId")) === 1n, "WRONG_CHAIN");
  const raw = await rpc("eth_getTransactionByHash", [HASH]);
  proof.visibility = { transactionFound: raw !== null, confirmedBlockPresent: Boolean(raw?.blockHash && raw?.blockNumber), receiptFound: false };
  if (raw) proof.transaction = { hash: raw.hash, from: raw.from, to: raw.to, chainId: Number(BigInt(raw.chainId)), type: Number(BigInt(raw.type)),
    nonce: Number(BigInt(raw.nonce)), valueWei: String(BigInt(raw.value)), inputHash: ethers.keccak256(raw.input),
    gasLimit: String(BigInt(raw.gas)), maxFeePerGasWei: raw.maxFeePerGas == null ? null : String(BigInt(raw.maxFeePerGas)) };
  const receipt = await rpc("eth_getTransactionReceipt", [HASH]);
  proof.visibility.receiptFound = receipt !== null;
  check(raw && same(raw.hash, HASH), "TRANSACTION_UNAVAILABLE");
  const confirmed = Boolean(raw.blockHash && raw.blockNumber && receipt);
  proof.canonicalReceiptVerified = false;
  proof.maximumConfiguredGasFeeWei = String(BigInt(raw.gas) * BigInt(raw.maxFeePerGas ?? raw.gasPrice));
  proof.maximumConfiguredGasFeeEth = ethers.formatEther(proof.maximumConfiguredGasFeeWei);
  if (confirmed) {
    check(same(receipt.transactionHash, HASH) && same(receipt.blockHash, raw.blockHash) && receipt.blockNumber === raw.blockNumber, "RECEIPT_MISMATCH");
    const block = await rpc("eth_getBlockByNumber", [raw.blockNumber, false]);
    check(block && same(block.hash, raw.blockHash) && block.number === raw.blockNumber, "NONCANONICAL_RECEIPT");
    const gasUsed = BigInt(receipt.gasUsed), gasPrice = BigInt(receipt.effectiveGasPrice), cost = gasUsed * gasPrice;
    proof.receipt = { status: Number(BigInt(receipt.status)), blockNumber: Number(BigInt(raw.blockNumber)), blockHash: raw.blockHash,
      timestamp: Number(BigInt(block.timestamp)), gasUsed: String(gasUsed), effectiveGasPriceWei: String(gasPrice), feeWei: String(cost),
      feeEth: ethers.formatEther(cost), totalApprovedGasCapWei: terms.totalGasCeilingWei,
      arithmeticRemainingGasCapWei: String(BigInt(terms.totalGasCeilingWei) - cost) };
    check(proof.receipt.status === 1, "TRANSACTION_REVERTED");
  }
  check(same(raw.from, wallet) && BigInt(raw.chainId) === 1n && BigInt(raw.value) === 0n, "TRANSACTION_SCOPE_MISMATCH");
  let target = raw.to, value = BigInt(raw.value), data = raw.input;
  if (!same(target, factory)) {
    check(same(target, "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3"), "UNSUPPORTED_OUTER_TARGET");
    const manager = new ethers.Interface(["function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)"]);
    const d = manager.decodeFunctionData("redeemDelegations", data);
    check(d[0].length === 1 && d[1].length === 1 && d[2].length === 1 && d[1][0] === ethers.ZeroHash && same(manager.encodeFunctionData("redeemDelegations", d), data), "UNSUPPORTED_EXECUTION_FRAMING");
    const packed = ethers.getBytes(d[2][0]); check(packed.length >= 52, "INVALID_PACKED_EXECUTION");
    target = ethers.hexlify(packed.slice(0, 20)); value = BigInt(ethers.hexlify(packed.slice(20, 52))); data = ethers.hexlify(packed.slice(52));
    proof.executionRoute = "manager-single-call-analysis-permission-not-yet-verified";
  } else proof.executionRoute = "direct-call-analysis";
  check(same(target, factory) && value === 0n, "INNER_SCOPE_MISMATCH");
  const abi = new ethers.Interface(loadV10UpgradeableArtifacts().factory.abi);
  const decoded = abi.decodeFunctionData("createEvent", data), key = decoded[0], config = decoded[1];
  check(same(abi.encodeFunctionData("createEvent", decoded), data), "NONCANONICAL_CREATE_CALLDATA");
  const actual = { depositAmount: String(config.depositAmount), eventName: config.eventName, eventStart: String(config.eventStart),
    claimDeadline: String(config.claimDeadline), arbitration: { disputeResolver: config.arbitration.disputeResolver, extraData: config.arbitration.extraData,
      metaEvidenceTemplate: [...config.arbitration.metaEvidenceTemplate], metaEvidenceSlots: config.arbitration.metaEvidenceSlots, policyURI: config.arbitration.policyURI } };
  const template = eventV10LumaTemplate({ eventName: terms.title, depositAmount: terms.depositWei,
    policyURI: manifest.factoryDeployment.policy.uri, policySha256: manifest.factoryDeployment.policy.sha256,
    lumaUrl: terms.lumaReference, startsAt: terms.startsAt, endsAt: terms.endsAt, timezone: terms.timezone });
  const expected = { depositAmount: terms.depositWei, eventName: terms.title, eventStart: String(Date.parse(terms.startsAt) / 1000),
    claimDeadline: String(Date.parse(terms.startsAt) / 1000 + 604800), arbitration: { disputeResolver: manifest.arbitration.resolver,
      extraData: manifest.arbitration.extraData, metaEvidenceTemplate: template.pieces, metaEvidenceSlots: template.slots, policyURI: manifest.factoryDeployment.policy.uri } };
  for (const k of ["depositAmount", "eventName", "eventStart", "claimDeadline"]) if (actual[k] !== expected[k]) proof.mismatches.push({ field: k, actual: actual[k], expected: expected[k] });
  for (const k of ["disputeResolver", "extraData", "metaEvidenceSlots", "policyURI"]) if (k === "policyURI" ? actual.arbitration[k] !== expected.arbitration[k] : !same(actual.arbitration[k], expected.arbitration[k])) proof.mismatches.push({ field: `arbitration.${k}`, actual: actual.arbitration[k], expected: expected.arbitration[k] });
  if (JSON.stringify(actual.arbitration.metaEvidenceTemplate) !== JSON.stringify(expected.arbitration.metaEvidenceTemplate)) proof.mismatches.push({ field: "arbitration.metaEvidenceTemplate", actualSha256: sha(JSON.stringify(actual.arbitration.metaEvidenceTemplate)), expectedSha256: sha(JSON.stringify(expected.arbitration.metaEvidenceTemplate)) });
  proof.terms = { actual, expected, eventKey: key, innerDataHash: ethers.keccak256(data), exactApprovedCalldata: same(data, abi.encodeFunctionData("createEvent", [key, expected])) };
  if (!proof.terms.exactApprovedCalldata && proof.mismatches.length === 0) proof.mismatches.push({ field: "exactApprovedCalldata", actual: false, expected: true });
  if (confirmed) {
  const logs = receipt.logs.filter((l) => same(l.address, factory)).flatMap((l) => { try { const p = abi.parseLog(l); return p?.name === "EventCreated" ? [p] : []; } catch { return []; } });
  check(logs.length === 1, "EXACT_CREATION_LOG_MISSING");
  const log = logs[0], coder = ethers.AbiCoder.defaultAbiCoder();
  const configType = "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
  const configHash = ethers.keccak256(coder.encode(["address", configType], [wallet, actual]));
  const eventId = ethers.keccak256(coder.encode(["uint256", "address", "address", "bytes32"], [1, factory, wallet, key]));
  check(same(log.args.creator, wallet) && log.args.eventKey === key && log.args.version === 10n && log.args.eventId === eventId && log.args.configurationHash === configHash, "CREATION_LOG_MISMATCH");
  proof.creation = { factory, creator: log.args.creator, child: log.args.eventContract, factoryEventId: log.args.eventId, eventKey: key, version: String(log.args.version), configurationHash: configHash };
  check(same((await rpc("eth_getBlockByNumber", [raw.blockNumber, false]))?.hash, raw.blockHash) && BigInt(await rpc("eth_chainId")) === 1n, "CLOSING_REORG");
  proof.canonicalReceiptVerified = true;
  proof.status = proof.mismatches.length || proof.terms.exactApprovedCalldata !== true ? "canonical-success-approved-terms-MISMATCH-DEPOSIT-HELD" : "canonical-success-terms-match-further-verification-required";
  } else {
    const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
    check(latest && ethers.isHexString(latest.hash, 32), "PENDING_ANCHOR_UNAVAILABLE");
    const latestNonce = BigInt(await rpc("eth_getTransactionCount", [wallet, latest.number]));
    const pendingNonce = BigInt(await rpc("eth_getTransactionCount", [wallet, "pending"]));
    const balance = BigInt(await rpc("eth_getBalance", [wallet, latest.number]));
    const configuredMaximum = BigInt(proof.maximumConfiguredGasFeeWei) + BigInt(raw.value);
    proof.pendingObservation = { anchor: { blockNumber: Number(BigInt(latest.number)), blockHash: latest.hash,
      timestamp: Number(BigInt(latest.timestamp)), baseFeePerGasWei: latest.baseFeePerGas == null ? null : String(BigInt(latest.baseFeePerGas)) },
      transactionNonce: Number(BigInt(raw.nonce)), latestAccountNonce: String(latestNonce), pendingAccountNonce: String(pendingNonce),
      maxPriorityFeePerGasWei: raw.maxPriorityFeePerGas == null ? null : String(BigInt(raw.maxPriorityFeePerGas)),
      balanceWei: String(balance), coversConfiguredMaximum: balance >= configuredMaximum,
      maxFeeBelowObservedBaseFee: latest.baseFeePerGas == null ? null : BigInt(raw.maxFeePerGas ?? raw.gasPrice) < BigInt(latest.baseFeePerGas),
      missingEarlierNonce: latestNonce < BigInt(raw.nonce) };
    check(same((await rpc("eth_getBlockByNumber", [latest.number, false]))?.hash, latest.hash), "PENDING_ANCHOR_REORG");
    check(BigInt(await rpc("eth_chainId")) === 1n, "WRONG_CHAIN");
    proof.status = proof.mismatches.length || proof.terms.exactApprovedCalldata !== true ? "pending-approved-terms-MISMATCH-DEPOSIT-HELD" : "pending-approved-terms-match-NOT-CONFIRMED-DEPOSIT-HELD";
  }
} catch (e) { proof.error = /^[A-Z][A-Z0-9_]{1,70}$/.test(e.code ?? "") ? e.code : "READONLY_AUDIT_UNAVAILABLE"; }
proof.checkedAt = new Date().toISOString();
const out = `artifacts/v10-release/synthetic-creation-audit-${proof.checkedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
const sourceArchive = out.replace(/\.json$/, ".source.mjs");
fs.writeFileSync(sourceArchive, fs.readFileSync(sourceFiles[0]), { flag: "wx", mode: 0o600 });
proof.helperSourceArchive = { path: sourceArchive, sha256: sha(fs.readFileSync(sourceArchive)) };
fs.writeFileSync(out, JSON.stringify(proof, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ proof: out, sha256: sha(fs.readFileSync(out)), status: proof.status, error: proof.error ?? null,
  visibility: proof.visibility ?? null, transaction: proof.transaction ?? null, maximumConfiguredGasFeeEth: proof.maximumConfiguredGasFeeEth ?? null,
  pendingObservation: proof.pendingObservation ?? null,
  canonicalReceiptVerified: proof.canonicalReceiptVerified ?? false, receipt: proof.receipt ?? null, creation: proof.creation ?? null, mismatches: proof.mismatches, depositAuthorized: false }, null, 2));
if (proof.status === "unavailable") process.exitCode = 1;
