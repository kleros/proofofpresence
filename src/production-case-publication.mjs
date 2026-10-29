// Orchestration only: core supplies fresh authorization and canonical contract reads.
// No RPC, signing, transaction submission or implicit publication lives in this module.
import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import {
  MAINNET_CASE_PUBLICATION,
  prepareCaseArtifact,
  publishReviewedCase,
  verifyCaseAvailability,
} from "./mainnet-case-publication.mjs";

const copy = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (value, key) => Object.hasOwn(value, key);
const check = (ok, code, message, status = 409) => {
  if (!ok) throw Object.assign(new Error(message), { code, status });
};
const blob = (artifact) => ({
  environment: artifact.scope.environment,
  chainId: artifact.scope.chainId,
  contractVersion: artifact.scope.contractVersion,
  eventId: artifact.scope.eventId,
  contract: artifact.scope.contract.toLowerCase(),
  wallet: artifact.scope.wallet.toLowerCase(),
  content: artifact.content,
  sha256: artifact.sha256,
  uri: artifact.uri,
  byteLength: artifact.byteLength,
});

function checkedArtifact(value) {
  check(value && typeof value === "object", "PUBLICATION_RECORD_CHANGED", "The saved case artifact is unavailable.");
  const artifact = prepareCaseArtifact({ scope: value.scope, content: value.content, expectedURI: value.uri });
  check(same(artifact, value), "PUBLICATION_RECORD_CHANGED", "The saved case artifact changed.");
  return artifact;
}
function checkedRecord(value) {
  if (value === null || value === undefined) return null;
  check(value.productionCase === true && typeof value.status === "string",
    "PUBLICATION_RECORD_CHANGED", "This publication record is not an approved production case.");
  checkedArtifact(value.artifact);
  return copy(value);
}
function synchronous(value) {
  check(!value || typeof value.then !== "function", "PUBLICATION_STORAGE_UNAVAILABLE",
    "Publication storage must commit synchronously before an upload is permitted.", 503);
  return value;
}

/**
 * readCase(context, savedArtifact?) MUST authenticate the current caller on every call,
 * prove both the fresh and saved canonical block, and return {scope,content,expectedURI}.
 * readRecord/writeRecord/persist are synchronous, scoped durable callbacks. The store MUST
 * atomically reject stale writers changing/removing any prior intent or original artifact.
 * Context is opaque except for its stable eventId/wallet lock key; it is never persisted.
 * @param {{readCase?: (context:any, savedArtifact?:any)=>any,
 * readRecord?: (context:any)=>any, writeRecord?: (context:any,record:any)=>any,
 * persist?: ()=>any, fetcher?: typeof globalThis.fetch, now?: ()=>number}} [options]
 */
export function createProductionCasePublicationService(options = {}) {
  const { readCase, readRecord, writeRecord, persist, fetcher = globalThis.fetch, now = Date.now } = options;
  check([readCase, readRecord, writeRecord, persist, fetcher, now].every((fn) => typeof fn === "function"),
    "PUBLICATION_CONFIGURATION", "Canonical reads and durable scoped publication storage are required.", 500);
  const flights = new Map();

  function keyFor(context) {
    check(context && typeof context.eventId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(context.eventId) &&
      typeof context.wallet === "string" && ethers.isAddress(context.wallet) &&
      context.wallet.toLowerCase() !== ethers.ZeroAddress,
    "INVALID_CASE_SCOPE", "A stable event and challenged wallet are required.", 400);
    return `${context.eventId}:${context.wallet.toLowerCase()}`;
  }
  function time() {
    const value = now();
    check(Number.isSafeInteger(value) && value >= 0, "PUBLICATION_CONFIGURATION", "Invalid publication clock.", 500);
    return value;
  }
  function stored(context) {
    return checkedRecord(synchronous(readRecord(context)));
  }
  function commit(context, record) {
    // A failed save may have reached durable storage. Never roll back or erase its intent.
    try {
      synchronous(writeRecord(context, copy(record)));
      synchronous(persist());
    } catch {
      check(false, "PUBLICATION_STORAGE_UNAVAILABLE",
        "Publication storage is unavailable. Preserve this attempt and use read-only verification.", 503);
    }
  }
  async function fresh(context, savedArtifact) {
    const input = await readCase(context, savedArtifact ? copy(savedArtifact) : undefined);
    const current = prepareCaseArtifact(input);
    check(current.scope.eventId === context.eventId &&
      current.scope.wallet.toLowerCase() === context.wallet.toLowerCase(),
    "CASE_PUBLICATION_CHANGED", "The authorized case does not match this event and wallet.");
    if (savedArtifact) check(same(blob(current), blob(savedArtifact)),
      "CASE_PUBLICATION_CHANGED", "The canonical case bytes or event scope changed. No publication is permitted.");
    return current;
  }
  function unchangedRecord(context, expected) {
    const current = stored(context);
    check(current && same(current.artifact, expected.artifact), "PUBLICATION_RECORD_CHANGED",
      "The original publication artifact changed.");
    // An intent is immutable even when malformed/unknown; its presence always consumes POST.
    check(own(current, "intent") === own(expected, "intent") &&
      (!own(current, "intent") || same(current.intent, expected.intent)),
    "PUBLICATION_RECORD_CHANGED", "The original publication intent changed. Verify the existing attempt instead.");
    return current;
  }
  function dto(record, currentCase) {
    const a = record.artifact;
    return copy({ artifact: a, currentCase: currentCase.scope, publication: {
      status: record.status, uri: a.uri, sha256: a.sha256, scopeHash: a.scopeHash, byteLength: a.byteLength,
      uploadAttempted: own(record, "intent"), canPublish: !own(record, "intent"),
      ...(record.reason ? { reason: record.reason } : {}),
      ...(record.lastCheckedAt !== undefined ? { lastCheckedAt: record.lastCheckedAt } : {}),
    } });
  }
  async function load(context) {
    const previous = stored(context);
    const current = await fresh(context, previous?.artifact);
    if (previous) {
      unchangedRecord(context, previous);
      return { record: previous, current };
    }
    // Re-read after the canonical await: a different process may have exported or claimed it.
    const concurrent = stored(context);
    if (concurrent) {
      const latest = await fresh(context, concurrent.artifact);
      unchangedRecord(context, concurrent);
      return { record: concurrent, current: latest };
    }
    const record = { productionCase: true, artifact: copy(current), status: "exported" };
    commit(context, record);
    return { record, current };
  }
  async function checkedTransport(context, artifact, url, init, guard) {
    // Only the pure helper chooses a URL/method. It has a fixed upload/gateway allowlist.
    check((init?.method === "POST" && url === MAINNET_CASE_PUBLICATION.uploadEndpoint) ||
      (init?.method === "GET" && url === `${MAINNET_CASE_PUBLICATION.gateway}${artifact.uri}`),
    "INVALID_PUBLICATION_TRANSPORT", "Only the reviewed upload or exact case gateway request is permitted.", 500);
    const authorize = async () => {
      try { await fresh(context, artifact); }
      catch (error) { guard.failure ||= error; throw error; }
    };
    await authorize();
    check(!init.signal?.aborted, "PUBLICATION_UPLOAD_ABORTED",
      "The publication request expired before transport. Verify the existing intent instead.", 503);
    const response = await fetcher(url, init);
    await authorize();
    return response;
  }
  async function saveOutcome(context, record, outcome) {
    // The pure helper has finished its remote response/body await; reauthorize before storage/disclosure.
    const current = await fresh(context, record.artifact);
    const latest = unchangedRecord(context, record);
    const updated = { ...latest, status: outcome.status, lastCheckedAt: time() };
    delete updated.reason;
    if (outcome.reason) updated.reason = outcome.reason;
    commit(context, updated);
    return dto(updated, current);
  }
  async function verify(context, record) {
    const guard = {};
    const outcome = await verifyCaseAvailability({ artifact: record.artifact,
      fetcher: (url, init) => checkedTransport(context, record.artifact, url, init, guard) });
    if (guard.failure) throw guard.failure;
    return saveOutcome(context, record, outcome);
  }
  function serial(context, work) {
    const key = keyFor(context), previous = flights.get(key) || Promise.resolve();
    const flight = previous.catch(() => {}).then(work);
    flights.set(key, flight);
    return flight.finally(() => { if (flights.get(key) === flight) flights.delete(key); });
  }

  return Object.freeze({
    exportCase(context) {
      return serial(context, async () => {
        const { record } = await load(context);
        const current = await fresh(context, record.artifact);
        return dto(unchangedRecord(context, record), current);
      });
    },
    publishCase(context, approval = {}) {
      return serial(context, async () => {
        const { record } = await load(context), a = record.artifact;
        check(approval && [Object.prototype, null].includes(Object.getPrototypeOf(approval)) &&
          Reflect.ownKeys(approval).length === 2 && ["sha256", "scopeHash"].every((key) =>
            own(approval, key) && own(Object.getOwnPropertyDescriptor(approval, key), "value")) &&
          approval.sha256 === a.sha256 && approval.scopeHash === a.scopeHash,
          "PUBLICATION_NOT_APPROVED", "Approve the exact original case SHA256 and scope hash.", 400);
        if (own(record, "intent")) return verify(context, record);
        const guard = {};
        const outcome = await publishReviewedCase({ artifact: a, approvedSha256: approval.sha256,
          approvedScopeHash: approval.scopeHash,
          persistIntent: async (intent) => {
            try { await fresh(context, a); }
            catch (error) { guard.failure ||= error; throw error; }
            const latest = unchangedRecord(context, record);
            check(!own(latest, "intent"), "PUBLICATION_ALREADY_CLAIMED",
              "This case already has a publication attempt. Verify the existing attempt instead.");
            check(intent.scopeHash === a.scopeHash && intent.sha256 === a.sha256 && intent.uri === a.uri &&
              intent.endpoint === MAINNET_CASE_PUBLICATION.uploadEndpoint && intent.byteLength === a.byteLength,
            "PUBLICATION_INTENT_CHANGED", "The publication intent does not match the reviewed bytes.");
            const claim = { ...intent, intentId: randomUUID(), claimedAt: time() };
            record.intent = copy(claim);
            record.status = "upload-uncertain";
            commit(context, record);
            return { claimed: true, intentId: claim.intentId, scopeHash: claim.scopeHash,
              sha256: claim.sha256, uri: claim.uri };
          },
          fetcher: (url, init) => checkedTransport(context, a, url, init, guard),
        }).catch((error) => { throw guard.failure || error; });
        if (guard.failure) throw guard.failure;
        return saveOutcome(context, record, outcome);
      });
    },
    verifyCase(context) {
      return serial(context, async () => {
        const { record } = await load(context);
        return verify(context, record);
      });
    },
  });
}
