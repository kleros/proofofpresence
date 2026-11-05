// Canonical authorization + durable attachment orchestration; no wallet calls.
// File bytes are request-local only. Core owns fsync/locking/stale-writer guards.
import { createHash, randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { PRODUCTION_EVIDENCE_FILE as C, prepareEvidenceFile, publishReviewedEvidenceFile, verifyEvidenceFile } from "./production-evidence-file.mjs";
const PROFILE = "kleros-event-v10-uups";
export const V10_EVIDENCE_FILE_RESOLVER = ethers.getAddress("0x4b89e798b10478a839ea0abcf86c4b94a3c782a4");
const copy = value => structuredClone(value), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (obj, key) => Object.hasOwn(obj, key);
const address = value => typeof value === "string" && ethers.isAddress(value) && value.toLowerCase() !== ethers.ZeroAddress;
const digest = value => createHash("sha256").update(value).digest("hex");
const check = (ok, code, message, status = 409) => { if (!ok) throw Object.assign(new Error(message), { code, status }); };
function exact(obj, keys) {
  try { return obj && [Object.prototype, null].includes(Object.getPrototypeOf(obj)) && Reflect.ownKeys(obj).length === keys.length &&
    keys.every(key => own(obj, key) && own(Object.getOwnPropertyDescriptor(obj, key), "value")); } catch { return false; }
}
function decode(value) {
  check(typeof value === "string" && value.length > 0 && value.length <= Math.ceil(C.maximumFileBytes / 3) * 4 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
  "INVALID_EVIDENCE_FILE", "Use one canonical base64 file of at most 256 KiB.", 400);
  const bytes = Buffer.from(value, "base64");
  check(bytes.length > 0 && bytes.length <= C.maximumFileBytes && bytes.toString("base64") === value,
    "INVALID_EVIDENCE_FILE", "Use the exact canonical base64 file bytes.", 400);
  return new Uint8Array(bytes);
}
/** readCase must authenticate fresh access and prove both current/saved canonical
 * anchors. It returns {scope,evidenceOpen}; ensureCase exports the original case.
 * All record callbacks are synchronous; persist MUST atomically retain every prior
 * artifact/intent and reject stale writers before any caller may claim another POST.
 * @param {{readCase?: (context:any,saved?:any)=>any, ensureCase?: (context:any)=>any,
 * readRecord?: (context:any)=>any, writeRecord?: (context:any,record:any)=>any,
 * persist?: ()=>any, fetcher?: typeof globalThis.fetch, now?: ()=>number}} [options]
 */
export function createV10EvidenceFileService({ readCase, ensureCase, readRecord, writeRecord, persist,
  fetcher = globalThis.fetch, now = Date.now } = {}) {
  check([readCase, ensureCase, readRecord, writeRecord, persist, fetcher, now].every(fn => typeof fn === "function"),
    "PUBLICATION_CONFIGURATION", "Attachment publication requires canonical reads and durable storage.", 500);
  const flights = new Map();
  function actor(ctx) {
    ctx?.assertSession?.();
    check(ctx?.session?.mode === "wallet" && address(ctx.session.wallet) && address(ctx.wallet) &&
      typeof ctx.eventId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(ctx.eventId),
    "UNAUTHENTICATED", "Sign in with the evidence author's wallet.", 401);
    return ethers.getAddress(ctx.session.wallet);
  }
  function serial(ctx, work) {
    actor(ctx); const key = ctx.eventId + ":" + ctx.wallet.toLowerCase(), prior = flights.get(key) || Promise.resolve();
    const promise = prior.catch(() => {}).then(work); flights.set(key, promise);
    return promise.finally(() => { if (flights.get(key) === promise) flights.delete(key); });
  }
  function stored(ctx) {
    const value = readRecord(ctx);
    check(value && typeof value.then !== "function" && value.productionCase === true && value.artifact,
      "PUBLICATION_RECORD_CHANGED", "Export the canonical case document before preparing an attachment.");
    return copy(value);
  }
  function save(ctx, value) {
    try {
      const written = writeRecord(ctx, copy(value));
      check(!written || typeof written.then !== "function", "PUBLICATION_STORAGE_UNAVAILABLE", "Storage must be synchronous.", 503);
      const saved = persist();
      check(!saved || typeof saved.then !== "function", "PUBLICATION_STORAGE_UNAVAILABLE", "Storage must be synchronous.", 503);
    } catch { check(false, "PUBLICATION_STORAGE_UNAVAILABLE", "Preserve the original attempt and verify it before retrying.", 503); }
  }
  function timestamp() { const at = now(); check(Number.isSafeInteger(at) && at >= 0, "PUBLICATION_CONFIGURATION", "Invalid publication clock.", 500); return at; }
  async function fresh(ctx, saved, requireOpen = true) {
    const author = actor(ctx), current = await readCase(ctx, saved?.artifact);
    check(actor(ctx) === author && current?.scope?.contractVersion === PROFILE && current.scope.matched === true &&
      (!requireOpen || current.evidenceOpen === true) && current.scope.eventId === ctx.eventId &&
      current.scope.wallet.toLowerCase() === ctx.wallet.toLowerCase(),
    "CASE_PUBLICATION_CHANGED", "A current matched V10 Court case and current author are required.");
    check(Array.isArray(current.evidenceAuthors) && current.evidenceAuthors.length > 0 && current.evidenceAuthors.length <= 3 &&
      current.evidenceAuthors.every(address) && current.evidenceAuthors.some(value => value.toLowerCase() === author.toLowerCase()),
    "EVIDENCE_AUTHOR_FORBIDDEN", "Hosted evidence preparation is available only to this case's challenged wallet, recorded organizer or matcher.", 403);
    if (saved) check(saved.author.toLowerCase() === author.toLowerCase() &&
      saved.artifact.scope.uploaderWallet.toLowerCase() === author.toLowerCase() &&
      saved.artifact.scope.eventId === current.scope.eventId && saved.artifact.scope.contract.toLowerCase() === current.scope.contract.toLowerCase() &&
      saved.artifact.scope.wallet.toLowerCase() === current.scope.wallet.toLowerCase() &&
      saved.artifact.scope.resolver === V10_EVIDENCE_FILE_RESOLVER &&
      saved.artifact.scope.localDisputeID === current.scope.localDisputeID && saved.artifact.scope.arbitratorDisputeID === current.scope.arbitratorDisputeID,
    "CASE_PUBLICATION_CHANGED", "The attachment author or original Court case changed.");
    return { author, current };
  }
  function scope(current, author) {
    const value = current.scope;
    return { environment: value.environment, instanceId: value.instanceId, chainId: value.chainId, contractVersion: value.contractVersion,
      eventId: value.eventId, contract: value.contract, wallet: value.wallet, uploaderWallet: author, resolver: V10_EVIDENCE_FILE_RESOLVER,
      localDisputeID: value.localDisputeID, arbitratorDisputeID: value.arbitratorDisputeID, blockNumber: value.blockNumber, blockHash: value.blockHash };
  }
  const entryKey = item => item.author.toLowerCase() + ":" + item.artifact.sha256 + ":" + digest(JSON.stringify([item.artifact.fileName, item.artifact.mediaType]));
  function checkedEntry(item, author, bytes) {
    check(item && address(item.author) && item.author.toLowerCase() === author.toLowerCase() && item.artifact,
      "PUBLICATION_RECORD_CHANGED", "The reviewed attachment was not found for this author.");
    const a = item.artifact, prepared = prepareEvidenceFile({ scope: a.scope, fileName: a.fileName, mediaType: a.mediaType, bytes });
    check(same(prepared, a) && a.scope.uploaderWallet.toLowerCase() === author.toLowerCase(),
      "PUBLICATION_RECORD_CHANGED", "The original attachment bytes or author changed.");
    return copy(item);
  }
  function find(record, author, selection, bytes) {
    check(/^[a-f0-9]{64}$/.test(selection.sha256 ?? "") && /^[a-f0-9]{64}$/.test(selection.scopeHash ?? ""),
      "INVALID_INPUT", "Choose the exact original attachment SHA and scope.", 400);
    const matches = Object.entries(record.fileArtifacts ?? {}).filter(([, item]) => item?.author?.toLowerCase() === author.toLowerCase() &&
      item?.artifact?.sha256 === selection.sha256 && item?.artifact?.scopeHash === selection.scopeHash);
    check(matches.length === 1 && matches[0][0] === entryKey(matches[0][1]), "PUBLICATION_RECORD_CHANGED", "The reviewed attachment is unavailable or ambiguous.");
    return checkedEntry(matches[0][1], author, bytes);
  }
  function latest(ctx, item, bytes) {
    const record = stored(ctx), current = find(record, item.author, item.artifact, bytes);
    check(same(current.artifact, item.artifact) && own(current, "intent") === own(item, "intent") &&
      (!own(item, "intent") || same(current.intent, item.intent)), "PUBLICATION_RECORD_CHANGED", "The original attachment artifact or consumed intent changed.");
    return { record, item: current };
  }
  const dto = (item, current) => ({ artifact: copy(item.artifact), currentCase: copy(current.scope), publication: {
    status: item.status, uri: item.artifact.uri, sha256: item.artifact.sha256, scopeHash: item.artifact.scopeHash, byteLength: item.artifact.byteLength,
    uploadAttempted: own(item, "intent"), canPublish: !own(item, "intent") && current.evidenceOpen === true,
    ...(item.reason ? { reason: item.reason } : {}) } });
  async function transport(ctx, item, url, init, guard) {
    check(init?.method === "POST" && url === C.uploadEndpoint || init?.method === "GET" && url === C.gateway + item.artifact.uri,
      "INVALID_PUBLICATION_TRANSPORT", "Unsupported attachment transport.", 500);
    try { await fresh(ctx, item, init.method === "POST"); } catch (error) { guard.failure ||= error; throw error; }
    check(!init.signal?.aborted, "PUBLICATION_UPLOAD_ABORTED", "The attachment request expired.", 503);
    const response = await fetcher(url, init);
    try { await fresh(ctx, item, init.method === "POST"); } catch (error) { guard.failure ||= error; throw error; }
    return response;
  }
  async function finish(ctx, item, result, bytes) {
    const { current } = await fresh(ctx, item, false), value = latest(ctx, item, bytes);
    value.item.status = result.status; value.item.lastCheckedAt = timestamp(); delete value.item.reason;
    if (result.reason) value.item.reason = result.reason;
    value.record.fileArtifacts[entryKey(item)] = value.item; save(ctx, value.record); return dto(value.item, current);
  }
  async function verify(ctx, item, bytes) {
    const guard = {}, result = await verifyEvidenceFile({ artifact: item.artifact, bytes,
      fetcher: (url, init) => transport(ctx, item, url, init, guard) });
    if (guard.failure) throw guard.failure;
    return finish(ctx, item, result, bytes);
  }
  return Object.freeze({
    prepare(ctx, input) { return serial(ctx, async () => {
      check(exact(input, ["fileName", "mediaType", "base64"]), "INVALID_INPUT", "Choose one exact public attachment.", 400);
      const bytes = decode(input.base64), author = actor(ctx); await ensureCase(ctx);
      const { current, author: currentAuthor } = await fresh(ctx);
      check(currentAuthor === author, "UNAUTHENTICATED", "The uploading wallet changed during preparation.", 401);
      const record = stored(ctx);
      const artifact = prepareEvidenceFile({ scope: scope(current, author), fileName: input.fileName, mediaType: input.mediaType, bytes });
      const item = { author, artifact, status: "exported" }, key = entryKey(item);
      if (record.fileArtifacts?.[key]) {
        const previous = checkedEntry(record.fileArtifacts[key], author, bytes); await fresh(ctx, previous); return dto(previous, current);
      }
      check(!record.fileArtifacts || Object.getPrototypeOf(record.fileArtifacts) === Object.prototype, "PUBLICATION_RECORD_CHANGED", "Invalid attachment storage.");
      record.fileArtifacts ??= {};
      check(Object.keys(record.fileArtifacts).length < 32, "PUBLICATION_CAPACITY", "This case has reached its attachment limit.");
      check(Object.values(record.fileArtifacts).filter(value => value?.author?.toLowerCase() === author.toLowerCase()).length < 10,
        "PUBLICATION_CAPACITY", "This author has reached the attachment preparation limit for this case.");
      record.fileArtifacts[key] = item; save(ctx, record); return dto(item, current);
    }); },
    publish(ctx, input) { return serial(ctx, async () => {
      check(exact(input, ["sha256", "scopeHash", "base64", "consent"]) && input.consent === true,
        "PUBLICATION_NOT_APPROVED", "Explicitly consent to publish the exact reviewed file publicly.", 400);
      const bytes = decode(input.base64), author = actor(ctx), item = find(stored(ctx), author, input, bytes);
      if (own(item, "intent")) return verify(ctx, item, bytes);
      await fresh(ctx, item); const guard = {};
      const result = await publishReviewedEvidenceFile({ artifact: item.artifact, bytes, approvedSha256: input.sha256, approvedScopeHash: input.scopeHash,
        persistIntent: async intent => {
          await fresh(ctx, item); const value = latest(ctx, item, bytes);
          check(!own(value.item, "intent"), "PUBLICATION_ALREADY_CLAIMED", "Verify the existing attachment attempt.");
          value.item.intent = { ...intent, intentId: randomUUID(), claimedAt: timestamp() }; value.item.status = "upload-uncertain";
          value.record.fileArtifacts[entryKey(item)] = value.item; save(ctx, value.record); item.intent = copy(value.item.intent);
          return { claimed: true, intentId: item.intent.intentId, scopeHash: intent.scopeHash, sha256: intent.sha256, uri: intent.uri };
        }, fetcher: (url, init) => transport(ctx, item, url, init, guard) }).catch(error => { throw guard.failure || error; });
      if (guard.failure) throw guard.failure;
      return finish(ctx, item, result, bytes);
    }); },
    availability(ctx, input) { return serial(ctx, async () => {
      check(exact(input, ["sha256", "scopeHash", "base64"]), "INVALID_INPUT", "Choose the exact original attachment.", 400);
      const bytes = decode(input.base64), author = actor(ctx), item = find(stored(ctx), author, input, bytes);
      await fresh(ctx, item, false); return verify(ctx, item, bytes);
    }); },
  });
}
