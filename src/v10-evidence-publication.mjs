// Production evidence preparation/publication. No wallet calls and no implicit POST.
import { ethers } from "ethers";
import { createHash, randomUUID } from "node:crypto";
import { contentURI, prepareCaseArtifact, publishReviewedCase, verifyCaseAvailability, MAINNET_CASE_PUBLICATION } from "./mainnet-case-publication.mjs";

const PROFILE = "kleros-event-v10-uups";
const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const address = value => typeof value === "string" && ethers.isAddress(value) && value.toLowerCase() !== ethers.ZeroAddress;
const digest = text => createHash("sha256").update(text).digest("hex");
const check = (ok, code, message, status = 409) => { if (!ok) throw Object.assign(new Error(message), { code, status }); };
const exact = (obj, keys) => obj && typeof obj === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(obj)) &&
  Reflect.ownKeys(obj).length === keys.length && keys.every(key => Object.hasOwn(obj, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(obj, key), "value"));
const validAttachment = uri => uri === "" || typeof uri === "string" && uri.length <= 2048 &&
  /^\/ipfs\/[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(uri) && !uri.split("/").some(part => part === "." || part === "..");

function evidenceContent(input, contributor, record) {
  check(exact(input, ["title", "description", "attachmentURI"]) &&
    typeof input.title === "string" && input.title.trim().length > 0 && input.title.length <= 100 &&
    typeof input.description === "string" && input.description.trim().length > 0 && input.description.length <= 8000 &&
    validAttachment(input.attachmentURI), "INVALID_INPUT",
  "Enter a title, attendance evidence and an optional already-published IPFS attachment.", 400);
  const payload = { name: input.title.trim(), description: input.description.trim(),
    ...(input.attachmentURI ? { fileURI: input.attachmentURI } : {}), submitter: ethers.getAddress(contributor) };
  const cid = input.attachmentURI.match(/^\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/)?.[1];
  if (cid) payload.fileHash = cid;
  const verifiedFile = Object.values(record.fileArtifacts ?? {}).find(item => item?.status === "verified" &&
    item.author?.toLowerCase() === contributor.toLowerCase() && item.artifact?.uri === input.attachmentURI);
  if (verifiedFile) {
    const extension = verifiedFile.artifact.fileName.split(".").pop().toLowerCase();
    check(/^[a-z0-9]{1,12}$/.test(extension), "PUBLICATION_RECORD_CHANGED", "The verified attachment type changed.");
    payload.fileTypeExtension = extension;
  }
  return JSON.stringify(payload);
}

/** The owner supplies canonical reads and synchronous durable, stale-writer-safe case records.
 * @param {{readCase?: (context:any,saved?:any)=>any, ensureCase?: (context:any)=>any,
 * readRecord?: (context:any)=>any, writeRecord?: (context:any,record:any)=>any,
 * persist?: ()=>any, fetcher?: typeof globalThis.fetch, now?: ()=>number}} [options]
 */
export function createV10EvidencePublicationService({ readCase, ensureCase, readRecord, writeRecord, persist,
  fetcher = globalThis.fetch, now = Date.now } = {}) {
  check([readCase, ensureCase, readRecord, writeRecord, persist, fetcher, now].every(fn => typeof fn === "function"),
    "PUBLICATION_CONFIGURATION", "Evidence publication requires canonical reads and durable storage.", 500);
  const flights = new Map();
  function actor(context) {
    context?.assertSession?.();
    check(context?.session?.mode === "wallet" && address(context.session.wallet) && address(context.wallet) &&
      typeof context.eventId === "string", "UNAUTHENTICATED", "Sign in with the evidence author's wallet.", 401);
    return ethers.getAddress(context.session.wallet);
  }
  const serial = (ctx, work) => {
    const key = ctx.eventId + ":" + ctx.wallet.toLowerCase(), prev = flights.get(key) || Promise.resolve();
    const flight = prev.catch(() => {}).then(work); flights.set(key, flight);
    return flight.finally(() => { if (flights.get(key) === flight) flights.delete(key); });
  };
  function stored(ctx) {
    const record = readRecord(ctx);
    check(!record || typeof record.then !== "function", "PUBLICATION_STORAGE_UNAVAILABLE", "Evidence storage must be synchronous.", 503);
    check(record?.productionCase === true && record.artifact, "PUBLICATION_RECORD_CHANGED", "Export the case document first.");
    return copy(record);
  }
  function save(ctx, value) {
    try {
      const a = writeRecord(ctx, copy(value)), b = persist();
      check(!a || typeof a.then !== "function", "PUBLICATION_STORAGE_UNAVAILABLE", "Evidence storage must be synchronous.", 503);
      check(!b || typeof b.then !== "function", "PUBLICATION_STORAGE_UNAVAILABLE", "Evidence storage must be synchronous.", 503);
    } catch { check(false, "PUBLICATION_STORAGE_UNAVAILABLE", "Preserve this attempt and verify it before retrying.", 503); }
  }
  async function fresh(ctx, saved, requireOpen = true) {
    const owner = actor(ctx);
    const current = await readCase(ctx, saved?.artifact);
    check(actor(ctx) === owner && current.scope.contractVersion === PROFILE && current.scope.matched === true && (!requireOpen || current.evidenceOpen === true) &&
      current.scope.eventId === ctx.eventId && current.scope.wallet.toLowerCase() === ctx.wallet.toLowerCase(),
    "CASE_PUBLICATION_CHANGED", "A current matched V10 Court case is required.");
    check(Array.isArray(current.evidenceAuthors) && current.evidenceAuthors.some(author => address(author) && author.toLowerCase() === owner.toLowerCase()),
      "FORBIDDEN", "Only a party to this on-chain case can prepare hosted evidence.", 403);
    if (saved) check(saved.author.toLowerCase() === owner.toLowerCase() &&
      saved.artifact.scope.eventId === current.scope.eventId &&
      saved.artifact.scope.contract.toLowerCase() === current.scope.contract.toLowerCase() &&
      saved.artifact.scope.wallet.toLowerCase() === current.scope.wallet.toLowerCase() &&
      saved.artifact.scope.localDisputeID === current.scope.localDisputeID &&
      saved.artifact.scope.arbitratorDisputeID === current.scope.arbitratorDisputeID,
    "CASE_PUBLICATION_CHANGED", "The evidence author or Court case changed.");
    return { owner, current };
  }
  const entryKey = (owner, sha) => owner.toLowerCase() + ":" + sha;
  function entry(record, owner, sha, scopeHash) {
    check(/^[a-f0-9]{64}$/.test(sha ?? "") && /^[a-f0-9]{64}$/.test(scopeHash ?? ""),
      "INVALID_INPUT", "Choose the exact reviewed evidence.", 400);
    const value = record.evidenceArtifacts?.[entryKey(owner, sha)];
    check(value && value.author.toLowerCase() === owner.toLowerCase() && value.artifact.scopeHash === scopeHash,
      "PUBLICATION_RECORD_CHANGED", "The reviewed evidence was not found.");
    const checked = prepareCaseArtifact({ scope: value.artifact.scope, content: value.artifact.content,
      expectedURI: value.artifact.uri, contractVersion: PROFILE });
    check(same(checked, value.artifact), "PUBLICATION_RECORD_CHANGED", "The evidence bytes changed.");
    return copy(value);
  }
  const dto = (item, current) => ({ artifact: copy(item.artifact), currentCase: copy(current.scope), publication: {
    status: item.status, uri: item.artifact.uri, sha256: item.artifact.sha256, scopeHash: item.artifact.scopeHash,
    byteLength: item.artifact.byteLength, uploadAttempted: Object.hasOwn(item, "intent"),
    canPublish: !Object.hasOwn(item, "intent"), ...(item.reason ? { reason: item.reason } : {}) } });
  async function transport(ctx, item, url, init, guard) {
    check((init.method === "POST" && url === MAINNET_CASE_PUBLICATION.uploadEndpoint) ||
      (init.method === "GET" && url === MAINNET_CASE_PUBLICATION.gateway + item.artifact.uri),
    "INVALID_PUBLICATION_TRANSPORT", "Unsupported evidence transport.", 500);
    try { await fresh(ctx, item, init.method === "POST"); } catch (error) { guard.failure ||= error; throw error; }
    check(!init.signal?.aborted, "PUBLICATION_UPLOAD_ABORTED", "The evidence request expired.", 503);
    const response = await fetcher(url, init);
    try { await fresh(ctx, item, init.method === "POST"); } catch (error) { guard.failure ||= error; throw error; }
    return response;
  }
  async function saveOutcome(ctx, item, outcome) {
    const { owner, current } = await fresh(ctx, item, false), record = stored(ctx);
    const latest = entry(record, owner, item.artifact.sha256, item.artifact.scopeHash);
    check(same(latest.intent, item.intent) && same(latest.artifact, item.artifact),
      "PUBLICATION_RECORD_CHANGED", "The original evidence intent changed.");
    latest.status = outcome.status; latest.lastCheckedAt = now(); delete latest.reason;
    if (outcome.reason) latest.reason = outcome.reason;
    record.evidenceArtifacts[entryKey(owner, item.artifact.sha256)] = latest; save(ctx, record);
    return dto(latest, current);
  }
  async function verify(ctx, item) {
    const guard = {};
    const outcome = await verifyCaseAvailability({ artifact: item.artifact, contractVersion: PROFILE,
      fetcher: (url, init) => transport(ctx, item, url, init, guard) });
    if (guard.failure) throw guard.failure;
    return saveOutcome(ctx, item, outcome);
  }
  return Object.freeze({
    prepare(context, input) { return serial(context, async () => {
      const owner = actor(context);
      evidenceContent(input, owner, {}); // Reject malformed text before saving a case export.
      await ensureCase(context);
      const { owner: currentOwner, current } = await fresh(context), record = stored(context);
      check(currentOwner === owner, "CASE_PUBLICATION_CHANGED", "The evidence author changed during preparation.");
      const content = evidenceContent(input, owner, record), sha = digest(content), key = entryKey(owner, sha);
      if (record.evidenceArtifacts?.[key]) {
        const previous = entry(record, owner, sha, record.evidenceArtifacts[key].artifact.scopeHash);
        const checked = await fresh(context, previous);
        check(checked.owner === owner, "CASE_PUBLICATION_CHANGED", "The evidence author changed during preparation.");
        return dto(previous, current);
      }
      record.evidenceArtifacts ??= {};
      check(Object.keys(record.evidenceArtifacts).length < 32, "PUBLICATION_CAPACITY", "This case has reached the evidence preparation limit.", 409);
      check(Object.values(record.evidenceArtifacts).filter(item => item?.author?.toLowerCase() === owner.toLowerCase()).length < 10,
        "PUBLICATION_CAPACITY", "This case party has reached the evidence preparation limit.", 409);
      const artifact = prepareCaseArtifact({ scope: current.scope, content,
        expectedURI: contentURI(ethers.toUtf8Bytes(content)), contractVersion: PROFILE });
      const item = { author: owner, artifact, status: "exported" };
      record.evidenceArtifacts[key] = item; save(context, record); return dto(item, current);
    }); },
    publish(context, approval) { return serial(context, async () => {
      check(exact(approval, ["sha256", "scopeHash", "consent"]) && approval.consent === true,
        "PUBLICATION_NOT_APPROVED", "Consent to publish the exact reviewed evidence publicly is required.", 400);
      const owner = actor(context), item = entry(stored(context), owner, approval.sha256, approval.scopeHash);
      if (Object.hasOwn(item, "intent")) return verify(context, item);
      await fresh(context, item);
      const guard = {};
      const outcome = await publishReviewedCase({ artifact: item.artifact, contractVersion: PROFILE,
        approvedSha256: approval.sha256, approvedScopeHash: approval.scopeHash,
        persistIntent: async intent => {
          await fresh(context, item); const record = stored(context);
          const latest = entry(record, owner, approval.sha256, approval.scopeHash);
          check(!Object.hasOwn(latest, "intent"), "PUBLICATION_ALREADY_CLAIMED", "Verify the existing attempt.");
          latest.intent = { ...intent, intentId: randomUUID(), claimedAt: now() };
          latest.status = "upload-uncertain";
          record.evidenceArtifacts[entryKey(owner, approval.sha256)] = latest;
          save(context, record); item.intent = copy(latest.intent);
          return { claimed: true, intentId: latest.intent.intentId, scopeHash: intent.scopeHash, sha256: intent.sha256, uri: intent.uri };
        }, fetcher: (url, init) => transport(context, item, url, init, guard) }).catch(error => { throw guard.failure || error; });
      if (guard.failure) throw guard.failure;
      return saveOutcome(context, item, outcome);
    }); },
    availability(context, selection) { return serial(context, async () => {
      check(exact(selection, ["sha256", "scopeHash"]), "INVALID_INPUT", "Choose exact evidence.", 400);
      const owner = actor(context), item = entry(stored(context), owner, selection.sha256, selection.scopeHash);
      await fresh(context, item, false); return verify(context, item);
    }); },
  });
}
