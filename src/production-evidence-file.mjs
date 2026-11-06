// Public evidence attachments only. No RPC, signing, implicit upload or retries.
// Core must freshly authorize the case/author and durably claim each exact file.
import { createHash } from "node:crypto";
import { ethers } from "ethers";

export const PRODUCTION_EVIDENCE_FILE = Object.freeze({
  contractVersion: "kleros-event-v10-uups",
  uploadEndpoint: "https://kleros-api.netlify.app/.netlify/functions/upload-to-ipfs?operation=evidence&pinToGraph=false",
  gateway: "https://cdn.kleros.link",
  maximumFileBytes: 262144,
  maximumUploadResponseBytes: 16384,
  requestTimeoutMs: 10000,
});
const KIND = "erc1497-evidence-attachment";
const SCOPE = ["environment", "instanceId", "chainId", "contractVersion", "eventId", "contract", "wallet", "uploaderWallet",
  "resolver", "localDisputeID", "arbitratorDisputeID", "blockNumber", "blockHash"];
const ARTIFACT = ["schemaVersion", "kind", "scope", "scopeHash", "fileName", "mediaType", "sha256", "byteLength", "uri"];
const TYPES = Object.freeze({ "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "application/pdf": ["pdf"],
  "text/plain": ["txt"], "application/json": ["json"] });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: 400 }); };
const check = (value, code, message) => { if (!value) fail(code, message); };
function exact(value, keys, code) {
  let valid = false;
  try { valid = value && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")); } catch { /* Refuse accessors/proxies. */ }
  check(valid, code, "Use the exact public evidence fields without accessors or extra metadata.");
}
const stable = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const address = value => typeof value === "string" && ethers.isAddress(value) && value.toLowerCase() !== ethers.ZeroAddress;
const uint = value => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
function normalizedScope(value) {
  exact(value, SCOPE, "INVALID_EVIDENCE_SCOPE");
  check(value.environment === "production" && value.chainId === 1 && value.contractVersion === PRODUCTION_EVIDENCE_FILE.contractVersion &&
    stable(value.instanceId) && stable(value.eventId) && [value.contract, value.wallet, value.uploaderWallet, value.resolver].every(address) &&
    uint(value.localDisputeID) && uint(value.arbitratorDisputeID) && Number.isSafeInteger(value.blockNumber) && value.blockNumber > 0 &&
    typeof value.blockHash === "string" && ethers.isHexString(value.blockHash, 32) && value.blockHash !== ethers.ZeroHash,
  "INVALID_EVIDENCE_SCOPE", "A verified matched V10 case, canonical block and exact uploading wallet are required.");
  return Object.freeze(Object.fromEntries(SCOPE.map(key => [key, ["contract", "wallet", "uploaderWallet", "resolver"].includes(key)
    ? ethers.getAddress(value[key]) : key === "blockHash" ? value[key].toLowerCase() : value[key]])));
}
function fileBytes(value) {
  check(value instanceof Uint8Array && value.buffer instanceof ArrayBuffer && value.byteLength > 0 &&
    value.byteLength <= PRODUCTION_EVIDENCE_FILE.maximumFileBytes,
  "INVALID_EVIDENCE_FILE", "Choose one nonempty public file of at most 256 KiB.");
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}
function checkedFile(fileName, mediaType, bytes) {
  check(typeof fileName === "string" && fileName.length <= 96 && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}\.[A-Za-z0-9]+$/.test(fileName) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(fileName) && typeof mediaType === "string" && Object.hasOwn(TYPES, mediaType) &&
    TYPES[mediaType].includes(fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()),
  "INVALID_EVIDENCE_TYPE", "Use a simple PNG, JPEG, PDF, TXT or JSON filename matching its supported media type.");
  const prefix = values => bytes.length >= values.length && values.every((value, index) => bytes[index] === value);
  if (mediaType === "image/png") {
    check(bytes.length >= 45 && prefix([137, 80, 78, 71, 13, 10, 26, 10]) &&
      String.fromCharCode(...bytes.slice(12, 16)) === "IHDR" &&
      bytes.slice(-12).every((value, index) => value === [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130][index]),
    "INVALID_EVIDENCE_CONTENT", "The file does not have a supported PNG structure.");
  } else if (mediaType === "image/jpeg") {
    check(bytes.length >= 8 && prefix([255, 216, 255]) && bytes.at(-2) === 255 && bytes.at(-1) === 217,
      "INVALID_EVIDENCE_CONTENT", "The file does not have a supported JPEG structure.");
  } else if (mediaType === "application/pdf") {
    const binary = Buffer.from(bytes).toString("latin1");
    const names = binary.replace(/#([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
    check(/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(binary) && /%%EOF[\t\r\n ]*$/.test(binary) &&
      !/\/(?:JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA|AcroForm|XFA)\b/i.test(names),
    "INVALID_EVIDENCE_CONTENT", "Use a PDF without active scripts, embedded files, forms or launch actions.");
  } else {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { fail("INVALID_EVIDENCE_CONTENT", "Text evidence must contain valid UTF-8."); }
    check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text),
      "INVALID_EVIDENCE_CONTENT", "Text evidence cannot contain binary control characters.");
    if (mediaType === "application/json") {
      try { JSON.parse(text); } catch { fail("INVALID_EVIDENCE_CONTENT", "The JSON evidence is not valid JSON."); }
    } else check(!/^\s*(?:<!doctype\s+html|<(?:html|script|svg|iframe)\b)/i.test(text),
      "INVALID_EVIDENCE_CONTENT", "HTML, SVG and executable content are not supported evidence types.");
  }
}
function varint(value) {
  const bytes = [];
  do { bytes.push((value & 127) | (value >= 128 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return Uint8Array.from(bytes);
}
function contentURI(bytes) {
  // Exact single-block UnixFS/DAG-PB/SHA256/CIDv0 used by the existing case helper.
  const size = varint(bytes.length), file = ethers.getBytes(ethers.concat([Uint8Array.of(8, 2, 18), size, bytes, Uint8Array.of(24), size]));
  const node = ethers.concat([Uint8Array.of(10), varint(file.length), file]);
  return `/ipfs/${ethers.encodeBase58(ethers.concat(["0x1220", ethers.sha256(node)]))}`;
}
/** Pure preparation. The returned descriptor has no file bytes, private data or authority.
 * Signature checks are format checks, not malware scanning. Do not execute embedded content.
 * scopeHash deliberately also binds filename/type, so exact SHA+scope consent fixes the whole review. */
export function prepareEvidenceFile({ scope, fileName, mediaType, bytes } = {}) {
  const normalized = normalizedScope(scope), content = fileBytes(bytes);
  checkedFile(fileName, mediaType, content);
  const scopeHash = digest(JSON.stringify({ kind: KIND, scope: normalized, fileName, mediaType }));
  return Object.freeze({ schemaVersion: 1, kind: KIND, scope: normalized, scopeHash, fileName, mediaType,
    sha256: digest(content), byteLength: content.length, uri: contentURI(content) });
}
function validated(artifact, bytes) {
  exact(artifact, ARTIFACT, "INVALID_EVIDENCE_ARTIFACT");
  const checked = prepareEvidenceFile({ scope: artifact.scope, fileName: artifact.fileName, mediaType: artifact.mediaType, bytes });
  check(ARTIFACT.every(key => JSON.stringify(artifact[key]) === JSON.stringify(checked[key])),
    "EVIDENCE_ARTIFACT_CHANGED", "The evidence file or its exact review changed. Prepare a fresh review without clearing an existing intent.");
  return checked;
}
const outcome = (artifact, status, reason) => Object.freeze({ status, uri: artifact.uri, sha256: artifact.sha256,
  scopeHash: artifact.scopeHash, byteLength: artifact.byteLength, ...(reason ? { reason } : {}) });
class TransportFailure extends Error {}
const transportCheck = (value, code) => { if (!value) throw new TransportFailure(code); };
async function boundedRequest(work) {
  const controller = new AbortController(); let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new TransportFailure("TIMEOUT")); }, PRODUCTION_EVIDENCE_FILE.requestTimeoutMs); });
  try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}
function checkedResponse(response, expectedURL) {
  transportCheck(response && Number.isInteger(response.status) && !response.redirected &&
    (!response.url || response.url === expectedURL), "INVALID_RESPONSE");
  transportCheck(response.status >= 200 && response.status < 300, "HTTP_ERROR");
}
async function readBounded(response, maximum, signal) {
  const length = response.headers?.get?.("content-length");
  if (length != null) transportCheck(/^(0|[1-9][0-9]*)$/.test(length) && BigInt(length) <= BigInt(maximum), "BODY_TOO_LARGE");
  if (!response.body) return new Uint8Array();
  transportCheck(typeof response.body.getReader === "function", "INVALID_RESPONSE");
  const reader = response.body.getReader(), chunks = []; let size = 0, reads = 0, empty = 0, done = false;
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      transportCheck(!signal.aborted && ++reads <= maximum + 129, "TIMEOUT");
      const next = await reader.read();
      if (next.done) { done = true; break; }
      transportCheck(next.value instanceof Uint8Array, "INVALID_RESPONSE");
      if (!next.value.length) transportCheck(++empty <= 128, "INVALID_RESPONSE"); else empty = 0;
      size += next.value.length; transportCheck(size <= maximum, "BODY_TOO_LARGE"); chunks.push(next.value.slice());
    }
  } finally { signal.removeEventListener("abort", cancel); if (!done) cancel(); try { reader.releaseLock(); } catch {} }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
/** One explicit POST only, after a trusted exclusive durable claim. The caller must
 * persist/lock/fsync and reject already-started or unknown attempts across restarts.
 * No automatic GET follows; a matching upload CID is still unverified availability. */
export async function publishReviewedEvidenceFile({ artifact, bytes, approvedSha256, approvedScopeHash, persistIntent, fetcher = globalThis.fetch } = {}) {
  const original = validated(artifact, bytes), content = fileBytes(bytes);
  check(approvedSha256 === original.sha256 && approvedScopeHash === original.scopeHash,
    "EVIDENCE_PUBLICATION_NOT_APPROVED", "Approve this exact public file SHA256 and case/author/file scope hash.");
  check(typeof persistIntent === "function" && typeof fetcher === "function", "EVIDENCE_INTENT_REQUIRED", "A durable exclusive file intent and HTTP transport are required.");
  const intent = Object.freeze({ version: 1, kind: KIND, scopeHash: original.scopeHash, sha256: original.sha256, uri: original.uri,
    fileName: original.fileName, mediaType: original.mediaType, byteLength: original.byteLength, endpoint: PRODUCTION_EVIDENCE_FILE.uploadEndpoint });
  let claim;
  try { claim = await persistIntent(intent); } catch { fail("EVIDENCE_INTENT_FAILED", "The durable intent is unavailable or already consumed. No upload was requested; preserve and inspect the existing attempt."); }
  exact(claim, ["claimed", "intentId", "scopeHash", "sha256", "uri"], "EVIDENCE_INTENT_INVALID");
  check(claim.claimed === true && stable(claim.intentId) && claim.scopeHash === intent.scopeHash && claim.sha256 === intent.sha256 && claim.uri === intent.uri,
    "EVIDENCE_INTENT_INVALID", "The durable claim does not bind this exact file and case. No upload was requested.");
  const current = validated(artifact, bytes);
  check(JSON.stringify(current) === JSON.stringify(original), "EVIDENCE_ARTIFACT_CHANGED", "The approved artifact changed while its intent was saved. Preserve the consumed intent; do not upload.");
  try {
    return await boundedRequest(async signal => {
      const form = new FormData(); form.append("file", new Blob([content], { type: original.mediaType }), original.fileName);
      const response = await fetcher(PRODUCTION_EVIDENCE_FILE.uploadEndpoint, { method: "POST", body: form, signal,
        credentials: "omit", redirect: "error", cache: "no-store" });
      checkedResponse(response, PRODUCTION_EVIDENCE_FILE.uploadEndpoint);
      const responseBytes = await readBounded(response, PRODUCTION_EVIDENCE_FILE.maximumUploadResponseBytes, signal);
      let payload;
      try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(responseBytes)); } catch { throw new TransportFailure("INVALID_RESPONSE"); }
      if (!payload || !Array.isArray(payload.cids) || payload.cids.length !== 1 || typeof payload.cids[0] !== "string" ||
        !Array.isArray(payload.inconsistentCids) || payload.inconsistentCids.length !== 0) return outcome(original, "integrity-mismatch", "UPLOAD_RESPONSE_INVALID");
      const uri = payload.cids[0].startsWith("/ipfs/") ? payload.cids[0] : `/ipfs/${payload.cids[0]}`;
      return uri === original.uri ? outcome(original, "published-unverified") : outcome(original, "integrity-mismatch", "UPLOAD_CID_MISMATCH");
    });
  } catch (error) { return outcome(original, "upload-uncertain", error instanceof TransportFailure ? `UPLOAD_${error.message}` : "UPLOAD_UNAVAILABLE"); }
}
/** Separate GET-only verification, including exact original bytes, SHA and CID.
 * A verified attachment is not a submitted ERC-1497 evidence transaction. */
export async function verifyEvidenceFile({ artifact, bytes, fetcher = globalThis.fetch } = {}) {
  const checked = validated(artifact, bytes), expected = fileBytes(bytes);
  check(typeof fetcher === "function", "INVALID_EVIDENCE_TRANSPORT", "A read-only HTTP transport is required.");
  const url = PRODUCTION_EVIDENCE_FILE.gateway + checked.uri;
  try {
    return await boundedRequest(async signal => {
      const response = await fetcher(url, { method: "GET", signal, credentials: "omit", redirect: "error", cache: "no-store" });
      checkedResponse(response, url);
      const actual = await readBounded(response, checked.byteLength, signal);
      return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]) &&
        digest(actual) === checked.sha256 && contentURI(actual) === checked.uri ? outcome(checked, "verified") : outcome(checked, "integrity-mismatch", "GATEWAY_BYTES_MISMATCH");
    });
  } catch (error) { return outcome(checked, error instanceof TransportFailure && error.message === "BODY_TOO_LARGE" ? "integrity-mismatch" : "availability-unconfirmed",
    error instanceof TransportFailure ? `GATEWAY_${error.message}` : "GATEWAY_UNAVAILABLE"); }
}
