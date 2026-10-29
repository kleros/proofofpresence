import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ethers } from "ethers";
import { ROOT, check, publicJson, sha256, fingerprint, readJson, parseArgs, atomicJson, acquireLock,
  verifyCompiledInputs, assertTestnet, safeFailure } from "../src/testnet-config.mjs";
import { UI_D, validateUiDPlan, assertUiDArtifacts, verifyUiDStack, uiDCreateRequest, assertUiDDeployment,
  verifyUiDFactory, protectedDContext, assertProtectedDUnchanged } from "./testnet-ui-d-scenario.mjs";
import { canonicalDTransaction, verifyDUIHistory, assertDBeforeRuling, assertDUIProofContext } from "./testnet-ui-d-rehearsal.mjs";
import { assertBootstrap } from "../test/testnet-ui-d.e2e.mjs";
import { stateOf, singleAttemptConnection } from "../test/testnet-ui-c.e2e.mjs";

export const D_PAYOUT_COMPLETION = Object.freeze({
  stopped: "artifacts/ui-d/payout-2026-10-29T03-51-39.182Z-3960b430/proof.json",
  sidecar: "artifacts/ui-d/payout-2026-10-29T03-51-39.182Z-3960b430/ui-d-release-payouts.proof.json",
  pointer: path.join(ROOT, "artifacts/ui-d-payout-completion.json"),
});
export const D_PAYOUT_CLOSURE = Object.freeze([
  "test/testnet-ui-d.e2e.mjs", "scripts/chiado-ui-d-deposit-guards.mjs", "scripts/testnet-ui-d-scenario.mjs",
  "scripts/testnet-ui-d-rehearsal.mjs", "scripts/revise-ui-d-plan.mjs", "scripts/testnet-ui-scenario.mjs",
  "scripts/testnet-rehearsal.mjs", "scripts/generate-contracts-test15m.mjs", "test/testnet-ui-c.e2e.mjs",
  "src/testnet-config.mjs", "src/chain.mjs", "src/contracts-v8.mjs", "src/utils.mjs",
]);
export const completionRpcAllowed = method => new Set(["eth_chainId", "net_version", "eth_blockNumber", "eth_getCode",
  "eth_getLogs", "eth_call", "eth_getBalance", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount"]).has(method);
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const digest = v => /^[0-9a-f]{64}$/.test(v ?? "");
const anchorValid = a => Number.isSafeInteger(a?.number) && a.number > 0 && ethers.isHexString(a.hash, 32);
const ACTION = "ui-d-release-payouts";
const REQUIRED_CHECKS = [
  "Authenticated D detail remains bound to the selected child.",
  "Expanded UI arguments and snapshot match the captured authoritative draft.",
  "Signed D hash is journaled before its single broadcast.",
  "Real UI review, wallet send, once broadcast and canonical app confirmation completed exactly once.",
  "Actual UI transaction remains canonical with two observed confirmations.",
  "Each D UI operation leaves all protected A/B+C financial snapshots unchanged.",
];
export const completionScope = (plan, manifest) => ({ chainId: 10200, contractVersion: UI_D.contractVersion,
  eventId: manifest.events[0].deployment.eventId, contract: manifest.events[0].deployment.contract,
  depositWei: plan.depositWei, ...plan.addresses });
export function retainedCompletionAnchors(sidecar, role, observer) {
  const anchors = [sidecar.before?.indexedBlock, sidecar.after?.indexedBlock,
    ...(sidecar.protectedABC?.before ?? []).map(s => s.indexedBlock),
    ...(sidecar.protectedABC?.after ?? []).map(s => s.indexedBlock),
    role.chainBefore?.indexedBlock, role.chainAfter?.indexedBlock,
    { number: observer.events?.[0]?.blockNumber, hash: observer.events?.[0]?.blockHash }];
  check(anchors.length === 11 && anchors.every(anchorValid), "A retained D or A/B/C baseline anchor is malformed or missing.");
  return anchors;
}
export function assertCompletionPayments(payments, after, scope) {
  check(anchorValid(after.indexedBlock) && payments.eventId === scope.eventId && payments.chainId === 10200 &&
    same(payments.contract, scope.contract) && payments.contractVersion === scope.contractVersion &&
    payments.blockNumber === after.indexedBlock.number && payments.blockHash === after.indexedBlock.hash &&
    payments.attendancePaidWei === scope.depositWei && payments.outstandingCreditsWei === "0",
    "Fresh payout projection must match the exact final D block, deployment, delivered amount and owed balance.");
}

export function assertPayoutCompletionEvidence({ stopped, sidecar, sidecarSha256, journal, plan, manifest, role, observer, closure }) {
  const scope = completionScope(plan, manifest), entry = journal.transactions?.[ACTION];
  check(stopped.status === "stopped" && stopped.stage === "payout" && typeof stopped.error === "string" &&
    !Object.hasOwn(stopped, "after") && !Object.hasOwn(stopped, "protectedABC") &&
    stopped.checks?.length === 32 && REQUIRED_CHECKS.every(c => stopped.checks.includes(c)) &&
    Array.isArray(stopped.blockedRequests) && stopped.blockedRequests.length === 0 &&
    stopped.operations?.length === 1 && publicJson(stopped.operations[0]) === publicJson(sidecar) &&
    stopped.counts?.walletTransactions === 1 && stopped.counts.broadcasts === 1 && stopped.counts.nonceSignatures === 1 &&
    stopped.counts.rpc?.eth_sendRawTransaction === 1,
    "Only the reviewed stopped-after-passed-operation payout run can be supplemented.");
  check(sidecar.status === "passed" && sidecar.stage === "payout" && sidecar.journalAction === ACTION &&
    sidecar.eventId === scope.eventId && same(sidecar.contract, scope.contract) && same(sidecar.wallet, scope.owner) &&
    Number.isSafeInteger(sidecar.blockNumber) && sidecar.blockNumber > 0 && ethers.isHexString(sidecar.blockHash, 32) &&
    anchorValid(sidecar.before?.indexedBlock) && anchorValid(sidecar.after?.indexedBlock) &&
    sidecar.confirmations >= 2 && sidecar.ui?.walletTransactions === 1 && sidecar.ui.broadcasts === 1 &&
    sidecar.ui.walletMethods?.filter(m => m === "eth_sendTransaction").length === 1 &&
    sidecar.ui.walletMethods.every(m => ["eth_requestAccounts", "eth_chainId", "personal_sign", "eth_accounts", "eth_sendTransaction"].includes(m)) &&
    sidecar.draft?.method === "releasePayouts" && sidecar.draft.valueWei === "0" && publicJson(sidecar.draft.args) === "[]\n" &&
    digest(sidecar.draft.snapshot) && publicJson(stopped.source) === publicJson(sidecar.source),
    "Payout sidecar lacks one genuine exact UI release operation and its original source context.");
  const data = new ethers.Interface(["function releasePayouts()"]).encodeFunctionData("releasePayouts", []);
  check(journal.chainId === 10200 && journal.planFingerprint === fingerprint(plan) && entry?.state === "confirmed" &&
    same(entry.hash, sidecar.hash) && entry.blockNumber === sidecar.blockNumber && entry.blockHash === sidecar.blockHash &&
    entry.uiProof?.path === D_PAYOUT_COMPLETION.sidecar && digest(sidecarSha256) && entry.uiProof.sha256 === sidecarSha256 &&
    entry.expected?.from === scope.owner.toLowerCase() && entry.expected.to === scope.contract.toLowerCase() &&
    entry.expected.data === data && entry.expected.value === "0",
    "Canonical journal hash, sidecar pointer or exact payout request differs.");
  check(Object.keys(closure).sort().join() === [...D_PAYOUT_CLOSURE].sort().join() &&
    publicJson(closure) === publicJson(sidecar.source.operatorFiles), "The frozen thirteen-file payout source closure changed.");
  assertDUIProofContext(sidecar, plan, manifest);
  assertDBeforeRuling(sidecar.after, scope);
  check(sidecar.before?.phase === "Listed" && sidecar.before.bobCase?.state === 2 && sidecar.before.bobCase.finalRuling === null &&
    sidecar.before.heldBack === "0" && sidecar.before.attended?.alice && !sidecar.before.attended?.bob &&
    sidecar.before.challengeDepositWei === "30000000000", "The payout did not start from the reviewed matched unruled state.");
  const base = path.dirname(D_PAYOUT_COMPLETION.stopped);
  check(publicJson(stopped.screenshots) === publicJson([base + "/owner-review.png", base + "/owner-confirmed.png"]),
    "The original payout review and confirmed screenshots are missing.");
  const rs = role?.source, d = manifest.events[0].deployment;
  check(role?.status === "passed" && role.phase === "ordinary" && role.failures?.length === 0 &&
    role.counts?.nonceSignatures === 3 && role.counts.financialSignatures === 0 && role.counts.broadcasts === 0 &&
    role.roleProofs?.length === 3 && ["alice", "bob", "owner"].every(r =>
      role.roleProofs.some(p => p.role === r && same(p.wallet, scope[r]) && p.nonceSignatures === 1)) &&
    role.screenshots?.length === 6 && rs?.origin === plan.publicOrigin && rs.instanceId === sidecar.source.instanceId &&
    rs.planFingerprint === fingerprint(plan) && rs.manifestSha256 === sha256(publicJson(manifest)) &&
    rs.sourceManifestSha256 === plan.sourceManifestSha256 && rs.protectedCManifestSha256 === plan.protectedCManifestSha256 &&
    same(rs.contract, scope.contract) && rs.codeHash === d.codeHash && rs.creationTransaction === d.deploymentTxHash &&
    publicJson(rs.publicFiles) === publicJson(sidecar.source.publicFiles) &&
    publicJson(rs.provenance) === publicJson(manifest.provenance), "Ordinary role proof lacks exact passed phase/actor/source/deployment context.");
  assertDBeforeRuling(role.chainBefore, scope); assertDBeforeRuling(role.chainAfter, scope);
  check(anchorValid(role.chainBefore.indexedBlock) && anchorValid(role.chainAfter.indexedBlock) &&
    role.chainBefore.indexedBlock.number >= sidecar.blockNumber && role.canonicalPayments?.attendancePaidWei === plan.depositWei &&
    role.canonicalPayments.blockNumber === role.chainBefore.indexedBlock.number &&
    role.canonicalPayments.blockHash === role.chainBefore.indexedBlock.hash &&
    role.canonicalPayments.outstandingCreditsWei === "0", "Role proof does not establish Alice paid and Bob held after this payout.");
  const e = observer?.events?.[0], c = e?.state?.cases?.[0];
  check(observer?.status === "passed-current-checkpoint" && observer.checkpoint === "ordinary" && observer.scenario === "d-test15m" &&
    observer.readOnly === true && observer.signatures === 0 && observer.broadcasts === 0 &&
    observer.origin === plan.publicOrigin && observer.instanceId === sidecar.source.instanceId &&
    observer.planFingerprint === fingerprint(plan) && observer.manifestSha256 === sha256(publicJson(manifest)) &&
    observer.chainId === 10200 && observer.events.length === 1 && e.eventId === scope.eventId && same(e.contract, scope.contract) &&
    anchorValid({ number: e.blockNumber, hash: e.blockHash }) && e.blockNumber >= sidecar.blockNumber &&
    e.state.blockNumber === e.blockNumber && e.payments.blockNumber === e.blockNumber && e.payments.blockHash === e.blockHash &&
    e.state.phase === "Finalized" && e.state.heldBackWei === plan.depositWei &&
    e.state.owedTotalWei === "0" && e.payments.attendancePaidWei === plan.depositWei &&
    e.state.cases.length === 1 && same(c.wallet, scope.bob) && c.state === "Disputed" && c.matched === true && c.finalRuling === null &&
    c.localDisputeID === sidecar.after.bobCase.localDisputeID && c.arbitratorDisputeID === sidecar.after.bobCase.arbitratorDisputeID &&
    c.heldShareWei === plan.depositWei, "Ordinary observer lacks exact canonical unruled held-share context.");
  retainedCompletionAnchors(sidecar, role, observer);
  return scope;
}

function fileRecord(relative, expected, prefix = "artifacts/") {
  check(digest(expected), "Every completion input requires its reviewed raw SHA256.");
  const file = path.resolve(ROOT, relative), allowed = path.resolve(ROOT, prefix) + path.sep;
  check(file.startsWith(allowed) && fs.realpathSync(file).startsWith(allowed), "Completion input escaped its public artifact namespace.");
  const stat = fs.lstatSync(file); check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 10 * 1024 * 1024,
    "Completion input must be a bounded regular file.");
  const raw = fs.readFileSync(file); check(sha256(raw) === expected, "Reviewed completion input SHA changed.");
  return { file, sha256: expected, value: JSON.parse(raw) };
}
function privateMetadata(file) {
  const stat = fs.lstatSync(file); check(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 &&
    (!process.getuid || stat.uid === process.getuid()), "Plan/journal metadata must remain same-user regular0600files.");
  return fs.readFileSync(file);
}
async function publicRead(origin, pathname, json = true) {
  check(["/api/bootstrap", "/app.js"].includes(pathname), "Unexpected public completion read.");
  const r = await fetch(origin + pathname, { redirect: "error", signal: AbortSignal.timeout(30000) });
  check(r.status === 200, "Public completion source/readiness response failed.");
  return json ? r.json() : new Uint8Array(await r.arrayBuffer());
}
function rememberFile(map, file) { const stat = fs.lstatSync(file); check(stat.isFile() && !stat.isSymbolicLink(), "Completion original is not a regular file.");
  map.set(file, sha256(fs.readFileSync(file))); }
function unchanged(map) { for (const [file, expected] of map) check(sha256(fs.readFileSync(file)) === expected,
  "An original proof, source, screenshot, plan or journal changed during read-only completion."); }

export async function completeDPayout(args) {
  const unlock = acquireLock(UI_D.lock); let provider;
  try {
    const inputs = [fileRecord(D_PAYOUT_COMPLETION.stopped, args["--original-sha"], "artifacts/ui-d"),
      fileRecord(D_PAYOUT_COMPLETION.sidecar, args["--sidecar-sha"], "artifacts/ui-d"),
      fileRecord(args["--role-proof"], args["--role-sha"], "artifacts/ui-d"),
      fileRecord(args["--observer-proof"], args["--observer-sha"], "artifacts/chiado-ui-d-flow-audit")];
    const [stopped, sidecar, role, observer] = inputs.map(i => i.value);
    const planRaw = privateMetadata(UI_D.plan), journalRaw = privateMetadata(UI_D.journal), plan = JSON.parse(planRaw),
      source = readJson(UI_D.sourceManifest), protectedC = readJson(UI_D.protectedCManifest), manifest = readJson(UI_D.manifest);
    validateUiDPlan(plan, source, protectedC);
    const journal = JSON.parse(journalRaw), originals = new Map();
    check(journal.chainId === 10200 && journal.planFingerprint === fingerprint(plan) &&
      journal.transactions && typeof journal.transactions === "object" && !Array.isArray(journal.transactions),
      "Existing journal metadata is not bound to this D plan.");
    const closure = Object.fromEntries(D_PAYOUT_CLOSURE.map(f => { const file = path.join(ROOT, f); rememberFile(originals, file); return [f, originals.get(file)]; }));
    const scope = assertPayoutCompletionEvidence({ stopped, sidecar, sidecarSha256: args["--sidecar-sha"], journal, plan, manifest, role, observer, closure });
    check(journal.transactions[ACTION].uiProof.sha256 === args["--sidecar-sha"], "Journal sidecar SHA differs from its reviewed input.");
    for (const i of inputs) originals.set(i.file, i.sha256);
    for (const file of [UI_D.plan, UI_D.journal, UI_D.manifest, UI_D.sourceManifest, UI_D.protectedCManifest,
      path.join(ROOT, "test/testnet-ui-d-status.e2e.mjs"), path.join(ROOT, "scripts/chiado-ui-d-flow-audit.mjs"),
      path.join(ROOT, "artifacts/ui-d-hosting.json"), path.join(ROOT, "artifacts/ui-d-payout.json")]) rememberFile(originals, file);
    check(role.source.harnessSha256 === originals.get(path.join(ROOT, "test/testnet-ui-d-status.e2e.mjs")) &&
      observer.observerSha256 === originals.get(path.join(ROOT, "scripts/chiado-ui-d-flow-audit.mjs")), "Role or observer source SHA changed.");
    for (const relative of ["scripts/chiado-ui-d-flow-audit.mjs", "scripts/chiado-flow-audit.mjs", "scripts/generate-contracts-test15m.mjs"]) {
      const file = path.join(ROOT, relative); rememberFile(originals, file);
      check(observer.observerFiles?.[relative] === originals.get(file), "Observer dependency source changed.");
    }
    for (const [url, expected] of Object.entries(sidecar.source.publicFiles)) {
      const file = path.resolve(ROOT, "public", "." + url); check(file.startsWith(path.join(ROOT, "public") + path.sep), "Public source path escaped.");
      check(fs.realpathSync(file).startsWith(path.join(ROOT, "public") + path.sep), "Public source resolved outside its namespace.");
      rememberFile(originals, file); check(originals.get(file) === expected, "Reviewed public source changed.");
    }
    const screenshots = [...stopped.screenshots, ...role.screenshots].map(relative => {
      const file = path.resolve(ROOT, relative); check(file.startsWith(path.join(ROOT, "artifacts/ui-d") + path.sep), "Screenshot scope escaped D.");
      check(fs.realpathSync(file).startsWith(path.join(ROOT, "artifacts/ui-d") + path.sep), "Screenshot resolved outside D public artifacts.");
      rememberFile(originals, file); check(fs.readFileSync(file).subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), "A genuine PNG screenshot is missing.");
      return { path: relative, sha256: originals.get(file) };
    });
    const selected = verifyCompiledInputs(ROOT, UI_D.contractVersion), legacy = verifyCompiledInputs(ROOT);
    assertUiDArtifacts(plan, selected.artifacts, selected.provenance);
    const url = new URL(process.env.TESTNET_RPC_URL ?? plan.chain.rpcUrl);
    check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash, "Only a public credential-free HTTPS Chiado read transport is allowed.");
    provider = new ethers.JsonRpcProvider(singleAttemptConnection(url.href), undefined, { cacheTimeout: -1, batchMaxCount: 1 });
    const send = provider.send.bind(provider); provider.send = (method, params) => {
      check(completionRpcAllowed(method), "Mutable RPC is forbidden in payout proof completion."); return send(method, params); };
    provider.broadcastTransaction = async () => { throw Error("Completion never broadcasts"); };
    await assertTestnet(provider, plan.chain);
    await verifyUiDStack({ provider, source, protectedC, sourceJournal: readJson(UI_D.sourceJournal), ...selected,
      legacyArtifacts: legacy.artifacts, legacyProvenance: legacy.provenance });
    const creation = uiDCreateRequest(plan, selected.artifacts), deployment = manifest.events[0].deployment;
    const born = assertUiDDeployment(manifest.events[0], plan, journal, creation, selected.artifacts);
    await verifyUiDFactory({ provider, plan, artifacts: selected.artifacts, journal });
    await canonicalDTransaction(provider, born, { from: scope.owner.toLowerCase(), to: plan.factory.toLowerCase(), data: creation.request.data, value: "0" });
    const { verifyDeployment } = await import("../src/chain.mjs"), { projectPayments } = await import("../src/payments.mjs");
    await verifyDeployment({ provider }, deployment);
    const event = new ethers.Contract(deployment.contract, selected.artifacts[UI_D.eventArtifact].abi, provider),
      resolver = new ethers.Contract(plan.arbitration.resolver, selected.artifacts.MockArbitrableProxy.abi, provider);
    const boot = assertBootstrap(await publicRead(plan.publicOrigin, "/api/bootstrap"), manifest, sidecar.source.instanceId);
    check(boot.session == null && sha256(await publicRead(plan.publicOrigin, "/app.js", false)) === sidecar.source.publicFiles["/app.js"], "Public source/build instance changed.");
    const current = await stateOf(event, provider, scope, resolver); assertDBeforeRuling(current, scope);
    const history = await verifyDUIHistory({ provider, journal, plan, manifest, scope, state: current, eventInterface: event.interface, root: ROOT });
    check((history.paid.get(scope.alice.toLowerCase()) ?? 0n) === BigInt(plan.depositWei) &&
      (history.paid.get(scope.bob.toLowerCase()) ?? 0n) === 0n, "Canonical UI history does not show exactly Alice D delivered and Bob unpaid.");
    const receipt = await canonicalDTransaction(provider, journal.transactions[ACTION], journal.transactions[ACTION].expected);
    check(receipt.receipt.blockHash === sidecar.blockHash && receipt.receipt.blockNumber === sidecar.blockNumber, "The payout canonical receipt differs from its UI proof.");
    const abc = await protectedDContext(source, protectedC, provider, legacy.artifacts);
    assertProtectedDUnchanged(sidecar.protectedABC.before, abc); assertProtectedDUnchanged(sidecar.protectedABC.after, abc);
    const after = await stateOf(event, provider, scope, resolver); assertDBeforeRuling(after, scope);
    check(after.bobCase.localDisputeID === sidecar.after.bobCase.localDisputeID &&
      after.bobCase.arbitratorDisputeID === sidecar.after.bobCase.arbitratorDisputeID, "D case identity changed.");
    const payments = await projectPayments({ provider }, manifest.events[0], { blockTag: after.indexedBlock.number });
    assertCompletionPayments(payments, after, scope);
    const anchors = [...retainedCompletionAnchors(sidecar, role, observer), current.indexedBlock,
      after.indexedBlock, ...abc.map(s => s.indexedBlock)];
    check(anchors.every(anchorValid), "A fresh D or A/B/C anchor is malformed.");
    await Promise.all(anchors.map(async anchor => {
      const block = await provider.getBlock(anchor.number);
      check(block?.hash === anchor.hash && (anchor.timestamp === undefined || block.timestamp === anchor.timestamp),
        "A retained or fresh D/A/B/C anchor is no longer canonical.");
    }));
    const payoutConfirmations = await receipt.receipt.confirmations();
    check(privateMetadata(UI_D.journal).equals(journalRaw) && privateMetadata(UI_D.plan).equals(planRaw), "Plan/journal bytes changed during completion.");
    unchanged(originals);
    const proof = { status: "passed-read-only-supplement", type: "stopped-payout-aggregate-completion", originalRunStatus: "stopped",
      notice: "The original UI harness stopped after its passed operation. This supplement independently completes aggregate checks; it does not change that original status or establish its cleanup-error cause.",
      chainId: 10200, eventId: scope.eventId, contract: scope.contract, planFingerprint: fingerprint(plan),
      source: { toolSha256: sha256(fs.readFileSync(new URL(import.meta.url))), closure, manifestSha256: sha256(publicJson(manifest)), instanceId: boot.instanceId },
      inputs: inputs.map(i => ({ path: path.relative(ROOT, i.file), sha256: i.sha256 })), screenshots,
      payout: { hash: sidecar.hash, blockNumber: sidecar.blockNumber, blockHash: sidecar.blockHash, confirmations: payoutConfirmations, uiRequests: 1, broadcasts: 1 },
      freshState: after, payments, history: history.records, protectedABC: { unchanged: true, before: sidecar.protectedABC.before, after: abc },
      journalSha256: sha256(journalRaw), allOriginalFilesUntouched: true, signingFilesRead: 0, signatures: 0, broadcasts: 0, performedAt: new Date().toISOString() };
    check((await provider.getBlock(after.indexedBlock.number))?.hash === after.indexedBlock.hash,
      "Final D snapshot reorganized before completion proof writing.");
    unchanged(originals);
    const directory = path.join(ROOT, "artifacts/ui-d/payout-completions", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8));
    fs.mkdirSync(directory, { recursive: true }); const file = path.join(directory, "proof.json");
    fs.writeFileSync(file, publicJson(proof), { flag: "wx", mode: 0o644 });
    atomicJson(D_PAYOUT_COMPLETION.pointer, { status: proof.status, type: proof.type, originalRunStatus: "stopped",
      proof: path.relative(ROOT, file), proofSha256: sha256(fs.readFileSync(file)), payoutHash: sidecar.hash,
      signingFilesRead: 0, signatures: 0, broadcasts: 0 }, 0o644);
    return { status: proof.status, originalRunStatus: "stopped", proof: path.relative(ROOT, file), signingFilesRead: 0, signatures: 0, broadcasts: 0 };
  } finally { provider?.destroy(); unlock(); }
}

export async function main(argv = process.argv.slice(2)) {
  const schema = { "--execute-readonly": "boolean", "--original-sha": "value", "--sidecar-sha": "value",
    "--role-proof": "value", "--role-sha": "value", "--observer-proof": "value", "--observer-sha": "value" };
  const args = parseArgs(argv, schema);
  if (!args["--execute-readonly"]) return console.log(publicJson({ status: "review-only", runtimeFilesRead: 0, signingFilesRead: 0,
    networkRequests: 0, signatures: 0, broadcasts: 0,
    instruction: "After review, --execute-readonly requires --original-sha SHA --sidecar-sha SHA --role-proof PATH --role-sha SHA --observer-proof PATH --observer-sha SHA. Never reruns UI, signs or broadcasts." }));
  check(["--original-sha", "--sidecar-sha", "--role-sha", "--observer-sha"].every(k => digest(args[k])) &&
    typeof args["--role-proof"] === "string" && typeof args["--observer-proof"] === "string", "Explicit reviewed proof paths and SHA256s are mandatory before read-only completion.");
  console.log(publicJson(await completeDPayout(args)));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(safeFailure);
