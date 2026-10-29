// Explicit publication of exact v9 case bytes; never called by challenge/match signing.
// Source-confirmed request/gateway (service behavior is not a deployment guarantee):
// https://github.com/kleros/kleros-disputant-cli/blob/master/src/core/upload.ts
// https://github.com/kleros/kleros-disputant-cli/blob/master/docs/spec/06-attachment-upload.md
import { createHash } from "node:crypto";
import { ethers } from "ethers";

export const MAINNET_CASE_PUBLICATION = Object.freeze({
  environment: "production",
  chainId: 1,
  contractVersion: "kleros-event-v9-uups",
  uploadEndpoint:
    "https://kleros-api.netlify.app/.netlify/functions/upload-to-ipfs?operation=evidence&pinToGraph=false",
  gateway: "https://cdn.kleros.link",
  maximumArtifactBytes: 262_144,
  maximumUploadResponseBytes: 16_384,
  requestTimeoutMs: 10_000,
});

const SCOPE_KEYS = [
  "environment", "instanceId", "chainId", "contractVersion", "eventId", "contract", "wallet",
  "blockNumber", "blockHash", "matched", "localDisputeID", "arbitratorDisputeID",
];
const ARTIFACT_KEYS = ["version", "scope", "scopeHash", "content", "sha256", "byteLength", "uri"];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: 400 }); };
const check = (condition, code, message) => { if (!condition) fail(code, message); };
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function exactKeys(value, keys, code) {
  check(plain(value) && Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.value !== undefined),
  code, "Use the exact public artifact fields without accessors or extra metadata.");
}
function validAddress(value) {
  return typeof value === "string" && ethers.isAddress(value) && value.toLowerCase() !== ethers.ZeroAddress;
}
function normalizedScope(value) {
  exactKeys(value, SCOPE_KEYS, "INVALID_CASE_SCOPE");
  check(value.environment === MAINNET_CASE_PUBLICATION.environment && value.chainId === 1 &&
    value.contractVersion === MAINNET_CASE_PUBLICATION.contractVersion &&
    typeof value.instanceId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value.instanceId) &&
    typeof value.eventId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value.eventId) &&
    validAddress(value.contract) && validAddress(value.wallet) &&
    Number.isSafeInteger(value.blockNumber) && value.blockNumber > 0 &&
    typeof value.blockHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.blockHash) &&
    !/^0x0{64}$/.test(value.blockHash) && typeof value.matched === "boolean",
  "INVALID_CASE_SCOPE", "A canonical Ethereum v9 event, challenged wallet and server provenance are required.");
  const caseId = (id) => typeof id === "string" && /^(?:0|[1-9][0-9]{0,77})$/.test(id) && BigInt(id) < 2n ** 256n;
  check(value.matched
    ? caseId(value.localDisputeID) && caseId(value.arbitratorDisputeID)
    : value.localDisputeID === null && value.arbitratorDisputeID === null,
  "INVALID_CASE_SCOPE", "Matched cases need both actual decimal dispute IDs; unmatched cases use null IDs.");
  return Object.freeze({
    environment: value.environment, instanceId: value.instanceId, chainId: 1, contractVersion: value.contractVersion,
    eventId: value.eventId, contract: ethers.getAddress(value.contract), wallet: ethers.getAddress(value.wallet),
    blockNumber: value.blockNumber, blockHash: value.blockHash.toLowerCase(), matched: value.matched,
    localDisputeID: value.localDisputeID, arbitratorDisputeID: value.arbitratorDisputeID,
  });
}

function contentBytes(content) {
  check(typeof content === "string" && content.length > 0 && content.length <= MAINNET_CASE_PUBLICATION.maximumArtifactBytes,
    "INVALID_CASE_CONTENT", "Supply the exact non-empty case JSON returned by the contract.");
  let bytes, parsed;
  try { bytes = ethers.toUtf8Bytes(content); parsed = JSON.parse(content); }
  catch { fail("INVALID_CASE_CONTENT", "Case content must be valid JSON and losslessly encodable UTF-8."); }
  check(plain(parsed) && bytes.length <= MAINNET_CASE_PUBLICATION.maximumArtifactBytes,
    "INVALID_CASE_CONTENT", "Case JSON must be one object within the contract's single-block size limit.");
  return bytes;
}
function varint(value) {
  const bytes = [];
  do { bytes.push((value & 127) | (value >= 128 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return Uint8Array.from(bytes);
}
function contentURI(bytes) {
  // The existing contract's single-block UnixFS file / DAG-PB / SHA256 / CIDv0.
  const size = varint(bytes.length);
  const file = ethers.getBytes(ethers.concat([Uint8Array.of(8, 2, 18), size, bytes, Uint8Array.of(24), size]));
  const node = ethers.concat([Uint8Array.of(10), varint(file.length), file]);
  return `/ipfs/${ethers.encodeBase58(ethers.concat(["0x1220", ethers.sha256(node)]))}`;
}

/** Pure export. Core authenticates access and supplies an authoritative canonical case snapshot. */
export function prepareCaseArtifact({ scope, content, expectedURI } = {}) {
  const normalized = normalizedScope(scope), bytes = contentBytes(content), uri = contentURI(bytes);
  check(typeof expectedURI === "string" && /^\/ipfs\/Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(expectedURI) && uri === expectedURI,
    "CASE_CID_MISMATCH", "The exact case bytes do not match the contract's expected CIDv0 URI.");
  return Object.freeze({ version: 1, scope: normalized, scopeHash: digest(JSON.stringify(normalized)),
    content, sha256: digest(bytes), byteLength: bytes.length, uri });
}
function validated(artifact) {
  exactKeys(artifact, ARTIFACT_KEYS, "INVALID_CASE_ARTIFACT");
  const checked = prepareCaseArtifact({ scope: artifact.scope, content: artifact.content, expectedURI: artifact.uri });
  check(artifact.version === 1 && artifact.scopeHash === checked.scopeHash && artifact.sha256 === checked.sha256 &&
    artifact.byteLength === checked.byteLength && JSON.stringify(artifact.scope) === JSON.stringify(checked.scope),
  "INVALID_CASE_ARTIFACT", "Case artifact metadata or provenance changed after preparation.");
  return checked;
}
function result(artifact, status, reason) {
  return Object.freeze({ status, uri: artifact.uri, sha256: artifact.sha256, scopeHash: artifact.scopeHash,
    byteLength: artifact.byteLength, ...(reason ? { reason } : {}) });
}

class TransportFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function transportCheck(condition, code) { if (!condition) throw new TransportFailure(code); }
async function boundedRequest(work) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new TransportFailure("TIMEOUT")); }, MAINNET_CASE_PUBLICATION.requestTimeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), expired]); }
  finally { clearTimeout(timer); controller.abort(); }
}
function checkedResponse(response) {
  transportCheck(response && Number.isInteger(response.status) && !response.redirected, "INVALID_RESPONSE");
  transportCheck(response.status >= 200 && response.status < 300, "HTTP_ERROR");
}
async function readBounded(response, maximum, signal) {
  const length = response.headers?.get?.("content-length");
  if (length !== null && length !== undefined) {
    transportCheck(/^(?:0|[1-9][0-9]*)$/.test(length), "INVALID_RESPONSE");
    transportCheck(BigInt(length) <= BigInt(MAINNET_CASE_PUBLICATION.maximumArtifactBytes), "BODY_TOO_LARGE");
  }
  if (!response.body) return new Uint8Array();
  transportCheck(typeof response.body.getReader === "function", "INVALID_RESPONSE");
  const reader = response.body.getReader(), chunks = [];
  let size = 0, reads = 0, emptyReads = 0, complete = false;
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      transportCheck(!signal.aborted, "TIMEOUT");
      transportCheck(++reads <= MAINNET_CASE_PUBLICATION.maximumArtifactBytes + 1, "INVALID_RESPONSE");
      const next = await reader.read();
      if (next.done) { complete = true; break; }
      transportCheck(next.value instanceof Uint8Array, "INVALID_RESPONSE");
      if (next.value.length === 0) transportCheck(++emptyReads <= 128, "INVALID_RESPONSE");
      else emptyReads = 0;
      size += next.value.length;
      transportCheck(size <= maximum, "BODY_TOO_LARGE");
      chunks.push(next.value.slice());
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    try { reader.releaseLock(); } catch {}
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

/** Explicit reviewed publication only. No automatic retry, verification GET, signing or RPC.
 * The trusted intent writer must durably and atomically claim this scope/file, or throw if
 * already claimed or uncertain. A returned proof is validated here; storage/locking stays in core. */
export async function publishReviewedCase({ artifact, approvedSha256, approvedScopeHash, persistIntent, fetcher = globalThis.fetch } = {}) {
  const original = validated(artifact);
  check(typeof approvedSha256 === "string" && /^[a-f0-9]{64}$/.test(approvedSha256) && approvedSha256 === original.sha256,
    "PUBLICATION_NOT_APPROVED", "Approve this exact case-file SHA256 before publishing its public bytes.");
  check(typeof approvedScopeHash === "string" && /^[a-f0-9]{64}$/.test(approvedScopeHash) && approvedScopeHash === original.scopeHash,
    "PUBLICATION_SCOPE_NOT_APPROVED", "Approve this exact case and canonical artifact context before publication.");
  check(typeof persistIntent === "function" && typeof fetcher === "function",
    "PUBLICATION_INTENT_REQUIRED", "A trusted durable publication-intent writer and HTTP transport are required.");
  const intent = Object.freeze({ version: 1, scopeHash: original.scopeHash, sha256: original.sha256,
    uri: original.uri, byteLength: original.byteLength, endpoint: MAINNET_CASE_PUBLICATION.uploadEndpoint });
  let claim;
  try { claim = await persistIntent(intent); }
  catch { fail("PUBLICATION_INTENT_FAILED", "The publication intent could not be saved. No upload was requested."); }
  exactKeys(claim, ["claimed", "intentId", "scopeHash", "sha256", "uri"], "PUBLICATION_INTENT_INVALID");
  check(claim.claimed === true && typeof claim.intentId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(claim.intentId) &&
    claim.scopeHash === intent.scopeHash && claim.sha256 === intent.sha256 && claim.uri === intent.uri,
    "PUBLICATION_INTENT_INVALID", "A durable atomic claim for this exact case file is required. No upload was requested.");
  const current = validated(artifact);
  check(current.scopeHash === original.scopeHash && current.sha256 === original.sha256 && current.uri === original.uri,
    "CASE_ARTIFACT_CHANGED", "The case artifact changed while recording its reviewed publication intent.");
  try {
    return await boundedRequest(async (signal) => {
      const form = new FormData();
      form.append("file", new Blob([ethers.toUtf8Bytes(original.content)], { type: "application/json" }), "case-metadata.json");
      const response = await fetcher(MAINNET_CASE_PUBLICATION.uploadEndpoint, {
        method: "POST", body: form, signal, credentials: "omit", redirect: "error", cache: "no-store",
      });
      checkedResponse(response);
      const bytes = await readBounded(response, MAINNET_CASE_PUBLICATION.maximumUploadResponseBytes, signal);
      let payload;
      try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new TransportFailure("INVALID_RESPONSE"); }
      if (!plain(payload) || !Array.isArray(payload.cids) || payload.cids.length !== 1 ||
        !Array.isArray(payload.inconsistentCids) || payload.inconsistentCids.length !== 0 ||
        typeof payload.cids[0] !== "string")
        return result(original, "integrity-mismatch", "UPLOAD_RESPONSE_INVALID");
      const uri = payload.cids[0].startsWith("/ipfs/") ? payload.cids[0] : `/ipfs/${payload.cids[0]}`;
      return uri === original.uri
        ? result(original, "published-unverified")
        : result(original, "integrity-mismatch", "UPLOAD_CID_MISMATCH");
    });
  } catch (error) {
    const reason = error instanceof TransportFailure ? `UPLOAD_${error.code}` : "UPLOAD_UNAVAILABLE";
    return result(original, "upload-uncertain", reason);
  }
}

/** GET-only recovery. Original instanceId is artifact provenance, not a new signing/session gate. */
export async function verifyCaseAvailability({ artifact, fetcher = globalThis.fetch } = {}) {
  const checked = validated(artifact);
  check(typeof fetcher === "function", "INVALID_TRANSPORT", "A read-only HTTP transport is required.");
  try {
    return await boundedRequest(async (signal) => {
      const response = await fetcher(`${MAINNET_CASE_PUBLICATION.gateway}${checked.uri}`, {
        method: "GET", signal, credentials: "omit", redirect: "error", cache: "no-store",
      });
      checkedResponse(response);
      const bytes = await readBounded(response, checked.byteLength, signal);
      const expected = ethers.toUtf8Bytes(checked.content);
      if (bytes.length !== expected.length || !bytes.every((byte, i) => byte === expected[i]) ||
        digest(bytes) !== checked.sha256 || contentURI(bytes) !== checked.uri)
        return result(checked, "integrity-mismatch", "GATEWAY_BYTES_MISMATCH");
      return result(checked, "verified");
    });
  } catch (error) {
    if (error instanceof TransportFailure && error.code === "BODY_TOO_LARGE")
      return result(checked, "integrity-mismatch", "GATEWAY_BYTES_MISMATCH");
    const reason = error instanceof TransportFailure ? `GATEWAY_${error.code}` : "GATEWAY_UNAVAILABLE";
    return result(checked, "availability-unconfirmed", reason);
  }
}
