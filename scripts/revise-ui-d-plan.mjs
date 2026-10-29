import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ethers } from "ethers";
import { ROOT, check, publicJson, sha256, fingerprint, parseArgs, atomicJson, acquireLock,
  verifyCompiledInputs, assertTestnet, verifyPolicy, safeFailure } from "../src/testnet-config.mjs";
import { UI_D, validateUiDPlan, uiDBudgetApproval, assertUiDArtifacts, verifyUiDStack,
  deploymentDLead } from "./testnet-ui-d-scenario.mjs";
import { singleAttemptConnection } from "../test/testnet-ui-c.e2e.mjs";

export const D_REVISION = Object.freeze({
  plan: UI_D.plan, journal: UI_D.journal, manifest: UI_D.manifest, lock: UI_D.lock,
  proposal: path.join(ROOT, "artifacts/ui-d-start-revision-proposal.json"),
  archiveRoot: path.join(path.dirname(UI_D.plan), "ui-d-revisions"),
  proofRoot: path.join(ROOT, "artifacts/ui-d/plan-revisions"),
  pointer: path.join(ROOT, "artifacts/ui-d-plan-revision.json"),
});
const TIMES = ["eventStart", "eventEnd", "claimDeadline"];
const ACTIONS = ["fund-d-owner", "fund-d-alice", "fund-d-bob", "deploy-d-factory"];
const digest = v => /^[0-9a-f]{64}$/.test(v ?? "");
const parse = raw => JSON.parse(raw);
const hasChild = journal => Object.keys(journal.transactions ?? {}).some(k => k.startsWith("create-") || k.startsWith("ui-d-"));

// Locate raw top-level JSON values without reserializing transaction entries.
export function jsonSpans(raw) {
  const spans = {}, whitespace = () => { while (/\s/.test(raw[i] ?? "") && i < raw.length) i++; };
  let i = 0; whitespace(); check(raw[i++] === "{", "Expected a JSON object.");
  const stringEnd = start => { let p = start + 1;
    while (p < raw.length) { if (raw[p] === "\\") p += 2; else if (raw[p++] === '"') return p; }
    check(false, "Unterminated JSON string."); };
  for (;;) {
    whitespace(); if (raw[i] === "}") { spans.closingBrace = i; return spans; }
    check(raw[i] === '"', "Expected a JSON property.");
    const endKey = stringEnd(i), key = JSON.parse(raw.slice(i, endKey)); i = endKey; whitespace();
    check(!Object.hasOwn(spans, key) && raw[i++] === ":", "Duplicate or malformed JSON property."); whitespace();
    const start = i; let depth = 0;
    while (i < raw.length) {
      const c = raw[i]; if (c === '"') { i = stringEnd(i); continue; }
      if (c === "{" || c === "[") depth++;
      if (c === "}" || c === "]") { if (!depth) break; depth--; }
      if (c === "," && !depth) break; i++;
    }
    let end = i; while (/\s/.test(raw[end - 1] ?? "")) end--;
    spans[key] = { start, end, raw: raw.slice(start, end) };
    whitespace(); if (raw[i] === ",") { i++; continue; }
    check(raw[i] === "}", "Malformed JSON object end.");
  }
}
const patch = (raw, changes) => changes.sort((a, b) => b.start - a.start)
  .reduce((text, c) => text.slice(0, c.start) + c.value + text.slice(c.end), raw);
const objectWithoutTimes = value => { const out = parse(publicJson(value)); for (const field of TIMES) delete out.event[field]; return out; };

export function validateDRevision(originalPlan, originalJournal, proposal) {
  const proposed = proposal?.proposedPlan;
  check(proposed && originalPlan.chain?.chainId === 10200 && originalPlan.profile?.numericVersion === 80015 &&
    originalPlan.profile.challengePeriod === 900 && originalPlan.profile.matchPeriod === 900 &&
    originalPlan.event?.version === UI_D.contractVersion && fingerprint(originalPlan) === proposal.basePlanFingerprint &&
    fingerprint(proposed) === proposal.proposedPlanFingerprint && uiDBudgetApproval(proposed) === proposal.proposedBudgetApproval,
    "D revision proposal fingerprints or budget approval do not match.");
  check(publicJson(objectWithoutTimes(originalPlan)) === publicJson(objectWithoutTimes(proposed)) &&
    TIMES.every(k => Number.isSafeInteger(proposed.event[k]) && proposed.event[k] !== originalPlan.event[k]) &&
    proposed.event.eventStart > originalPlan.event.eventStart &&
    proposed.event.eventEnd - proposed.event.eventStart === 43200 &&
    proposed.event.claimDeadline - proposed.event.eventStart === 7 * 86400 &&
    publicJson([...(proposal.onlyPlanFieldChanges ?? [])].sort()) === publicJson(TIMES.map(k => "event." + k).sort()),
    "Only the three proposed D event times may change; identities, sources, policy, factory, key and budget stay exact.");
  check(originalJournal.chainId === 10200 && originalJournal.planFingerprint === proposal.basePlanFingerprint &&
    !hasChild(originalJournal) && Object.keys(originalJournal.transactions ?? {}).sort().join() === [...ACTIONS].sort().join(),
    "D revision requires exactly the original four setup transactions and no child or UI action.");
  check(Object.keys(proposal.retainedTransactions ?? {}).sort().join() === [...ACTIONS].sort().join(),
    "The proposal must describe exactly four retained setup records.");
  for (const action of ACTIONS) {
    const entry = originalJournal.transactions[action], retained = proposal.retainedTransactions?.[action];
    check(entry.state === "confirmed" && ethers.isHexString(entry.hash, 32) && retained?.state === "confirmed" &&
      retained.hash === entry.hash && retained.blockNumber === entry.blockNumber,
      "The proposal must retain every exact confirmed setup hash and block.");
  }
  return proposed;
}

function privateRaw(file) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 &&
    (!process.getuid || stat.uid === process.getuid()), "Revision private inputs must be same-user regular0600files.");
  return fs.readFileSync(file, "utf8");
}
function archiveRaw(file, raw) {
  if (fs.existsSync(file)) check(privateRaw(file) === raw, "An immutable D revision archive differs; preserve it.");
  else fs.writeFileSync(file, raw, { flag: "wx", mode: 0o600 });
}
function atomicRaw(file, raw) {
  const temporary = file + "." + randomUUID() + ".tmp", fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
function preserveEntries(originalRaw, currentRaw) {
  const original = jsonSpans(jsonSpans(originalRaw).transactions.raw), current = jsonSpans(jsonSpans(currentRaw).transactions.raw);
  for (const action of ACTIONS) check(original[action]?.raw === current[action]?.raw,
    "An original D setup transaction entry changed bytes.");
}
function revisedRaw(originalPlanRaw, originalJournalRaw, proposal, record) {
  const planSpans = jsonSpans(originalPlanRaw), eventSpan = planSpans.event, event = jsonSpans(eventSpan.raw);
  const revisedEvent = patch(eventSpan.raw, TIMES.map(k => ({ ...event[k], value: String(proposal.proposedPlan.event[k]) })));
  const planRaw = patch(originalPlanRaw, [{ ...eventSpan, value: revisedEvent }]);
  const spans = jsonSpans(originalJournalRaw), journal = parse(originalJournalRaw);
  const revisions = [...(journal.planRevisions ?? []), record];
  const changes = [{ ...spans.planFingerprint, value: JSON.stringify(proposal.proposedPlanFingerprint) }];
  if (spans.planRevisions) changes.push({ ...spans.planRevisions, value: JSON.stringify(revisions, null, 2) });
  else changes.push({ start: spans.closingBrace, end: spans.closingBrace,
    value: ',\n  "planRevisions": ' + JSON.stringify(revisions, null, 2) + "\n" });
  const journalRaw = patch(originalJournalRaw, changes);
  check(fingerprint(parse(planRaw)) === proposal.proposedPlanFingerprint, "Revised plan raw bytes do not match the proposal.");
  preserveEntries(originalJournalRaw, journalRaw);
  return { planRaw, journalRaw };
}

/** Read-only verification; never opens a wallet/deployer key or exposes a send method. */
export async function verifyDRevisionReadonly({ proposedPlan, originalJournal }) {
  const source = parse(fs.readFileSync(UI_D.sourceManifest, "utf8")), protectedC = parse(fs.readFileSync(UI_D.protectedCManifest, "utf8"));
  validateUiDPlan(proposedPlan, source, protectedC);
  const selected = verifyCompiledInputs(ROOT, UI_D.contractVersion), legacy = verifyCompiledInputs(ROOT);
  assertUiDArtifacts(proposedPlan, selected.artifacts, selected.provenance);
  const url = new URL(process.env.TESTNET_RPC_URL ?? proposedPlan.chain.rpcUrl);
  check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash,
    "Use only a credential-free public HTTPS Chiado transport.");
  const provider = new ethers.JsonRpcProvider(singleAttemptConnection(url.href), undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const send = provider.send.bind(provider), reads = new Set(["eth_chainId", "net_version", "eth_blockNumber", "eth_getCode",
    "eth_getBalance", "eth_call", "eth_getLogs", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionCount",
    "eth_getTransactionReceipt", "eth_getTransactionByHash"]);
  provider.send = (method, params) => { check(reads.has(method), "D revision verifier forbids mutable RPC methods."); return send(method, params); };
  provider.broadcastTransaction = async () => { throw Error("D revision never broadcasts"); };
  try {
    await assertTestnet(provider, proposedPlan.chain);
    await verifyUiDStack({ provider, source, protectedC, sourceJournal: parse(fs.readFileSync(UI_D.sourceJournal, "utf8")),
      ...selected, legacyArtifacts: legacy.artifacts, legacyProvenance: legacy.provenance });
    await verifyPolicy(proposedPlan.policy);
    const lead = await deploymentDLead({ provider, plan: proposedPlan, journal: originalJournal,
      artifacts: selected.artifacts, funderAddress: source.rehearsalAddresses.ownerA, childOnly: true });
    check(lead.mode === "verified-child-only" &&
      (await provider.getTransactionCount(proposedPlan.addresses.owner, "latest")) === 1 &&
      (await provider.getTransactionCount(proposedPlan.addresses.owner, "pending")) === 1,
      "D revision requires both latest and pending owner nonce1 before any child exists.");
    const block = await provider.getBlock("latest");
    return { status: "verified-read-only", chainId: 10200, blockNumber: block.number, blockHash: block.hash,
      timestamp: block.timestamp, setupReceipts: 4, latestOwnerNonce: 1, pendingOwnerNonce: 1, eventKeyUnused: true,
      selectedProvenanceSha256: sha256(publicJson(selected.provenance)) };
  } finally { provider.destroy(); }
}

export async function runDRevision({ execute = false, proposalSha256, humanReference,
  paths = D_REVISION, verifier = verifyDRevisionReadonly, afterPlanWrite,
  now = () => new Date().toISOString() } = {}) {
  check(!execute || (digest(proposalSha256) && typeof humanReference === "string" &&
    humanReference.trim() === humanReference && humanReference.length >= 8 && humanReference.length <= 1000),
    "Execution requires the explicit proposal SHA and a verified human authorization reference.");
  const unlock = execute ? acquireLock(paths.lock) : () => {};
  try {
    const proposalRaw = fs.readFileSync(paths.proposal, "utf8"), actualProposalSha = sha256(proposalRaw), proposal = parse(proposalRaw);
    check(!proposalSha256 || actualProposalSha === proposalSha256, "D proposal raw SHA differs from the explicitly reviewed proposal.");
    const archive = path.join(paths.archiveRoot, actualProposalSha), intentFile = path.join(archive, "intent.json");
    const currentPlanRaw = privateRaw(paths.plan), currentJournalRaw = privateRaw(paths.journal);
    const currentPlan = parse(currentPlanRaw), currentJournal = parse(currentJournalRaw);
    let intent, originalPlanRaw, originalJournalRaw, planRaw, journalRaw, record;
    if (fs.existsSync(intentFile)) {
      intent = parse(privateRaw(intentFile));
      check(intent.proposalSha256 === actualProposalSha && (!execute || intent.humanReference === humanReference),
        "An existing revision intent belongs to another proposal or authorization reference.");
      originalPlanRaw = privateRaw(path.join(archive, "original-plan.json"));
      originalJournalRaw = privateRaw(path.join(archive, "original-journal.json"));
      planRaw = privateRaw(path.join(archive, "revised-plan.json"));
      journalRaw = privateRaw(path.join(archive, "revised-journal.json"));
      check(sha256(originalPlanRaw) === intent.originalPlanSha256 && sha256(originalJournalRaw) === intent.originalJournalSha256 &&
        sha256(planRaw) === intent.revisedPlanSha256 && sha256(journalRaw) === intent.revisedJournalSha256,
        "D revision immutable snapshots or intent hashes changed.");
      record = intent.record;
      check(record.proposalSha256 === actualProposalSha && record.humanReference === intent.humanReference &&
        record.fromPlanFingerprint === proposal.basePlanFingerprint && record.toPlanFingerprint === proposal.proposedPlanFingerprint &&
        record.originalPlanSha256 === sha256(originalPlanRaw) && record.originalJournalSha256 === sha256(originalJournalRaw) &&
        record.originalPlanSnapshot === "original-plan.json" && record.originalJournalSnapshot === "original-journal.json" &&
        Number.isFinite(Date.parse(record.recordedAt)), "D revision intent metadata differs from the exact proposal and originals.");
      const rebuilt = revisedRaw(originalPlanRaw, originalJournalRaw, proposal, record);
      check(rebuilt.planRaw === planRaw && rebuilt.journalRaw === journalRaw,
        "D revision target snapshots contain an unapproved change.");
    } else {
      originalPlanRaw = currentPlanRaw; originalJournalRaw = currentJournalRaw;
      validateDRevision(parse(originalPlanRaw), parse(originalJournalRaw), proposal);
      record = { version: 1, proposalSha256: actualProposalSha, humanReference: humanReference ?? "read-only-review",
        fromPlanFingerprint: proposal.basePlanFingerprint, toPlanFingerprint: proposal.proposedPlanFingerprint,
        originalPlanSha256: sha256(originalPlanRaw), originalJournalSha256: sha256(originalJournalRaw),
        originalPlanSnapshot: "original-plan.json", originalJournalSnapshot: "original-journal.json", recordedAt: now() };
      ({ planRaw, journalRaw } = revisedRaw(originalPlanRaw, originalJournalRaw, proposal, record));
      intent = { version: 1, proposalSha256: actualProposalSha, humanReference: record.humanReference, record,
        originalPlanSha256: sha256(originalPlanRaw), originalJournalSha256: sha256(originalJournalRaw),
        revisedPlanSha256: sha256(planRaw), revisedJournalSha256: sha256(journalRaw) };
    }
    validateDRevision(parse(originalPlanRaw), parse(originalJournalRaw), proposal);
    preserveEntries(originalJournalRaw, currentJournalRaw);
    const applied = fingerprint(currentPlan) === proposal.proposedPlanFingerprint &&
      currentJournal.planFingerprint === proposal.proposedPlanFingerprint &&
      currentJournal.planRevisions?.some(r => publicJson(r) === publicJson(record));
    if (!applied) {
      check(!fs.existsSync(paths.manifest) && !hasChild(currentJournal) &&
        [originalPlanRaw, planRaw].includes(currentPlanRaw) && [originalJournalRaw, journalRaw].includes(currentJournalRaw),
        "D revision cannot overwrite a child, manifest, unknown change or different partial operation.");
    }
    const chain = applied ? null : await verifier({ proposedPlan: proposal.proposedPlan,
      originalJournal: parse(originalJournalRaw), proposal, currentPlan, currentJournal });
    let canonicalWrites = 0;
    if (execute && !applied) {
      check(privateRaw(paths.plan) === currentPlanRaw && privateRaw(paths.journal) === currentJournalRaw && !fs.existsSync(paths.manifest),
        "D files changed during verification; refuse revision.");
      fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
      archiveRaw(path.join(archive, "original-plan.json"), originalPlanRaw);
      archiveRaw(path.join(archive, "original-journal.json"), originalJournalRaw);
      archiveRaw(path.join(archive, "revised-plan.json"), planRaw);
      archiveRaw(path.join(archive, "revised-journal.json"), journalRaw);
      archiveRaw(intentFile, publicJson(intent));
      if (currentPlanRaw !== planRaw) { atomicRaw(paths.plan, planRaw); canonicalWrites++; }
      if (afterPlanWrite) await afterPlanWrite();
      if (currentJournalRaw !== journalRaw) { atomicRaw(paths.journal, journalRaw); canonicalWrites++; }
    }
    const proof = { status: applied ? "already-applied" : execute ? "applied" : "ready-read-only",
      proposalSha256: actualProposalSha, humanReference: intent.humanReference,
      originalPlanFingerprint: proposal.basePlanFingerprint, revisedPlanFingerprint: proposal.proposedPlanFingerprint,
      originalPlanSha256: intent.originalPlanSha256, originalJournalSha256: intent.originalJournalSha256,
      revisedPlanSha256: intent.revisedPlanSha256, revisedJournalSha256: intent.revisedJournalSha256,
      proposedBudgetApproval: proposal.proposedBudgetApproval, retainedTransactionHashes: ACTIONS.map(a => parse(originalJournalRaw).transactions[a].hash),
      eventStart: proposal.proposedPlan.event.eventStart, archive: path.relative(ROOT, archive),
      canonicalWrites, chain, signingFilesRead: 0, signatures: 0, broadcasts: 0, performedAt: now() };
    if (execute) {
      const directory = path.join(paths.proofRoot, new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8));
      fs.mkdirSync(directory, { recursive: true }); const file = path.join(directory, "proof.json");
      fs.writeFileSync(file, publicJson(proof), { flag: "wx", mode: 0o644 });
      atomicJson(paths.pointer, { status: proof.status, proof: path.relative(ROOT, file), proofSha256: sha256(fs.readFileSync(file)),
        proposalSha256: actualProposalSha, originalPlanFingerprint: proposal.basePlanFingerprint,
        revisedPlanFingerprint: proposal.proposedPlanFingerprint, signatures: 0, broadcasts: 0 }, 0o644);
    }
    return proof;
  } finally { unlock(); }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { "--review": "boolean", "--execute": "boolean", "--proposal-sha": "value", "--human-ref": "value" });
  check(!(args["--review"] && args["--execute"]), "Review and execution are separate explicit commands.");
  if (!args["--review"] && !args["--execute"]) return console.log(publicJson({ status: "review-only", runtimeFilesRead: 0,
    signingFilesRead: 0, networkRequests: 0, signatures: 0, broadcasts: 0,
    instruction: "--review performs read-only pre-child verification. --execute requires --proposal-sha SHA --human-ref VERIFIED_REFERENCE; never reads keys or sends transactions." }));
  console.log(publicJson(await runDRevision({ execute: !!args["--execute"], proposalSha256: args["--proposal-sha"], humanReference: args["--human-ref"] })));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(safeFailure);
