const scopeKeys = [
  "environment",
  "instanceId",
  "chainId",
  "contractVersion",
  "eventId",
  "contract",
  "wallet",
  "blockNumber",
  "blockHash",
  "matched",
  "localDisputeID",
  "arbitratorDisputeID",
];
const statuses = Object.freeze([
  "exported",
  "published-unverified",
  "upload-uncertain",
  "verified",
  "availability-unconfirmed",
  "integrity-mismatch",
]);
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const address = (v) =>
  typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const fail = (ok, message) => {
  if (!ok) throw new Error(message);
};
function scope(value) {
  fail(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === scopeKeys.length &&
      scopeKeys.every((key) => Object.hasOwn(value, key)),
    "Case scope fields are incomplete.",
  );
  const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
  const caseId = (v) =>
    typeof v === "string" &&
    /^(?:0|[1-9][0-9]{0,77})$/.test(v) &&
    BigInt(v) < 2n ** 256n;
  fail(
    value.environment === "production" &&
      value.chainId === 1 &&
      value.contractVersion === "kleros-event-v9-uups" &&
      id(value.eventId) &&
      id(value.instanceId) &&
      address(value.contract) &&
      address(value.wallet) &&
      Number.isSafeInteger(value.blockNumber) &&
      value.blockNumber > 0 &&
      typeof value.blockHash === "string" &&
      /^0x[0-9a-f]{64}$/i.test(value.blockHash) &&
      !/^0x0{64}$/i.test(value.blockHash) &&
      typeof value.matched === "boolean",
    "A verified Ethereum V9 case scope is required.",
  );
  fail(
    value.matched
      ? caseId(value.localDisputeID) && caseId(value.arbitratorDisputeID)
      : value.localDisputeID === null && value.arbitratorDisputeID === null,
    "Case IDs do not match its matched state.",
  );
  return Object.fromEntries(
    scopeKeys.map((key) => [
      key,
      key === "blockHash" ? value[key].toLowerCase() : value[key],
    ]),
  );
}
async function sha(bytes) {
  fail(
    globalThis.crypto?.subtle,
    "Browser integrity verification is unavailable. No publication is permitted.",
  );
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
const hex = (bytes) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
function varint(n) {
  const out = [];
  do {
    out.push((n & 127) | (n >= 128 ? 128 : 0));
    n = Math.floor(n / 128);
  } while (n);
  return out;
}
function base58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${hex(bytes)}`),
    result = "";
  while (number) {
    result = alphabet[Number(number % 58n)] + result;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}
function frozen(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
export function publicationActions(publication) {
  const status = publication?.status;
  const readiness =
    typeof publication?.canPublish === "boolean" &&
    typeof publication?.uploadAttempted === "boolean" &&
    publication.canPublish === !publication.uploadAttempted;
  return Object.freeze({
    canPublish:
      statuses.includes(status) &&
      status !== "verified" &&
      readiness &&
      publication.canPublish === true &&
      publication.uploadAttempted === false,
    canVerify: statuses.includes(status),
    label:
      {
        exported: "Export ready · not uploaded",
        "published-unverified":
          "Upload acknowledged · availability not verified",
        "upload-uncertain":
          "Upload outcome uncertain · verify existing attempt",
        verified: "Gateway bytes verified at the last check",
        "availability-unconfirmed": "Gateway availability unconfirmed",
        "integrity-mismatch":
          "Publication integrity mismatch · inspect the reported reason",
      }[status] ?? "Publication status unavailable",
  });
}
export async function validateCaseArtifact(response, expected) {
  response = structuredClone(response);
  expected = { ...expected };
  fail(
    expected?.mode === "hosted-production" &&
      expected.chainId === 1 &&
      expected.contractVersion === "kleros-event-v9-uups",
    "This is not a production case review.",
  );
  const artifact = response?.artifact,
    currentCase = scope(response?.currentCase),
    original = scope(artifact?.scope);
  for (const item of [original, currentCase])
    fail(
      item.eventId === expected.eventId &&
        same(item.contract, expected.contract) &&
        same(item.wallet, expected.wallet),
      "The artifact belongs to another event, child contract or challenged wallet.",
    );
  fail(
    currentCase.instanceId === expected.instanceId &&
      original.blockNumber <= currentCase.blockNumber,
    "The current case belongs to another server context.",
  );
  if (original.blockNumber === currentCase.blockNumber)
    fail(
      original.blockHash === currentCase.blockHash,
      "The same canonical height has conflicting block hashes.",
    );
  if (original.matched)
    fail(
      currentCase.matched &&
        original.localDisputeID === currentCase.localDisputeID &&
        original.arbitratorDisputeID === currentCase.arbitratorDisputeID,
      "The original matched case IDs changed.",
    );
  fail(
    artifact &&
      Object.keys(artifact).length === 7 &&
      [
        "version",
        "scope",
        "scopeHash",
        "content",
        "sha256",
        "byteLength",
        "uri",
      ].every((key) => Object.hasOwn(artifact, key)) &&
      artifact.version === 1 &&
      typeof artifact.content === "string" &&
      artifact.content.length > 0 &&
      artifact.content.length <= 262144 &&
      digest(artifact.sha256) &&
      digest(artifact.scopeHash) &&
      /^\/ipfs\/Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(artifact.uri),
    "The case artifact fields are invalid.",
  );
  const bytes = new TextEncoder().encode(artifact.content);
  fail(
    bytes.length <= 262144 &&
      bytes.length === artifact.byteLength &&
      new TextDecoder("utf-8", { fatal: true }).decode(bytes) ===
        artifact.content,
    "The exact case byte length or UTF-8 content differs.",
  );
  let content;
  try {
    content = JSON.parse(artifact.content);
  } catch {
    throw new Error("The case content is not valid JSON.");
  }
  fail(
    content && typeof content === "object" && !Array.isArray(content),
    "The case JSON must be one object.",
  );
  const [contentHash, scopeHash] = await Promise.all([
    sha(bytes),
    sha(new TextEncoder().encode(JSON.stringify(original))),
  ]);
  fail(
    hex(contentHash) === artifact.sha256 &&
      hex(scopeHash) === artifact.scopeHash,
    "The case content or original scope SHA256 does not match.",
  );
  const size = varint(bytes.length),
    file = new Uint8Array([8, 2, 18, ...size, ...bytes, 24, ...size]);
  const node = new Uint8Array([10, ...varint(file.length), ...file]);
  const cid = `/ipfs/${base58(new Uint8Array([18, 32, ...(await sha(node))]))}`;
  fail(
    cid === artifact.uri,
    "The exact JSON bytes do not match the contract CIDv0 URI.",
  );
  const publication = response.publication;
  fail(
    publication &&
      statuses.includes(publication.status) &&
      publication.uri === artifact.uri &&
      publication.sha256 === artifact.sha256 &&
      publication.scopeHash === artifact.scopeHash &&
      publication.byteLength === artifact.byteLength &&
      (publication.reason === undefined ||
        typeof publication.reason === "string") &&
      (publication.lastCheckedAt === undefined ||
        (Number.isSafeInteger(publication.lastCheckedAt) &&
          publication.lastCheckedAt >= 0)),
    "The publication status does not match this original artifact.",
  );
  return frozen(
    structuredClone({
      artifact: { ...artifact, scope: original },
      currentCase,
      publication,
    }),
  );
}
