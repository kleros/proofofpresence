// Local import provenance. Hashes detect byte substitution; they do NOT prove a Luma export's
// origin. A named organiser must review unbound raw inputs. Known conflicts always fail closed.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { parse } from "csv-parse/sync";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const fileHash = (file) => sha256(fs.readFileSync(file));
export const sidecarPath = (file) => `${file}.provenance.json`;
export function identity(cfg) {
  const contract = ethers.getAddress(cfg.contract || cfg.receiver);
  return {
    eventId: cfg.eventId || `kickback:${cfg.chainId}:${contract.toLowerCase()}`,
    chainId: Number(cfg.chainId), contract,
    deposit: String(cfg.depositUnits ?? ethers.parseEther(String(cfg.deposit))),
    abiVersion: cfg.abiVersion || "v7",
  };
}
export function configHash(cfg) {
  return sha256(JSON.stringify({ ...identity(cfg), deployBlock: cfg.deployBlock ?? null,
    lumaEventId: cfg.lumaEventId ?? null, depositOpensAt: cfg.depositOpensAt ?? null,
    depositDeadline: cfg.depositDeadline ?? null, eventStart: cfg.eventStart ?? null,
    claimDeadline: cfg.claimDeadline ?? null, policyURI: cfg.kleros?.policyURI ?? null }));
}
export function assertIdentity(value, cfg, file = "Artifact") {
  const expected = identity(cfg);
  for (const key of ["eventId", "chainId", "contract", "deposit", "abiVersion"]) {
    const actual = key === "contract" ? String(value?.[key] ?? "").toLowerCase() : String(value?.[key] ?? "");
    const wanted = key === "contract" ? expected[key].toLowerCase() : String(expected[key]);
    if (actual !== wanted) throw new Error(`${file}: ${key} mismatch; artifact is not for this event/deployment`);
  }
  if (value.configHash !== configHash(cfg)) throw new Error(`${file}: configuration changed; rebuild this stale artifact`);
}

// Deliberately limited to unambiguous identifiers. Slug/name/email are not proof of source event.
export function validateSourceMetadata(rows, cfg, file) {
  const id = identity(cfg);
  const fields = { event_id: [id.eventId, cfg.lumaEventId].filter(Boolean), eventid: [id.eventId], chain_id: [id.chainId],
    chainid: [id.chainId], contract: [id.contract], contract_address: [id.contract],
    luma_event_id: [cfg.lumaEventId], lumaeventid: [cfg.lumaEventId], event_api_id: [cfg.lumaEventId],
    event_url: [cfg.lumaUrl], luma_url: [cfg.lumaUrl] };
  for (const original of rows) {
    const row = Object.fromEntries(Object.entries(original).map(([key, value]) => [key.trim().toLowerCase().replace(/[\s-]+/g, "_"), value]));
    for (const [field, wanted] of Object.entries(fields)) {
    const value = String(row[field] ?? "").trim();
    if (!value) continue;
    if (!wanted.some((w) => w !== undefined && value.toLowerCase() === String(w).toLowerCase()))
      throw new Error(`${file}: proven source ${field} mismatch; organiser review cannot override it`);
    }
  }
}

export function reviewSource(file, cfg, kind, reviewFile) {
  const rows = parse(fs.readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
  validateSourceMetadata(rows, cfg, file);
  if (!reviewFile || !fs.existsSync(reviewFile))
    throw new Error(`${file}: raw export origin cannot be verified automatically. Supply --provenance-review <review.json> with event/deployment identity, reviewer, reviewedAt, reason and this source's SHA-256. A hash does not prove origin.`);
  const review = JSON.parse(fs.readFileSync(reviewFile, "utf8"));
  assertIdentity(review, cfg, reviewFile);
  if (review.schema !== "kickback-source-review/v1") throw new Error(`${reviewFile}: unsupported review schema`);
  if (typeof review.reviewer !== "string" || !review.reviewer.trim() ||
      typeof review.reason !== "string" || !review.reason.trim() ||
      !Number.isFinite(Date.parse(review.reviewedAt)) || Date.parse(review.reviewedAt) > Date.now() + 60_000)
    throw new Error(`${reviewFile}: named reviewer, review timestamp and provenance reason are required`);
  const hash = fileHash(file);
  if (!Array.isArray(review.sources) || !review.sources.some((s) => s.kind === kind && s.sha256 === hash))
    throw new Error(`${file}: source hash/kind not present in organiser provenance review`);
  return { kind, sha256: hash, origin: "organiser-reviewed; not independently verified",
    reviewer: review.reviewer, reviewedAt: review.reviewedAt, reason: review.reason };
}

export function bindOutput(file, cfg, kind, sources, snapshot = {}) {
  const stamp = { schema: "kickback-import/v1", parserVersion: "kickback-csv/v1", ...identity(cfg), configHash: configHash(cfg),
    kind, outputSha256: fileHash(file), sources, ...snapshot, generatedAt: new Date().toISOString() };
  fs.writeFileSync(sidecarPath(file), JSON.stringify(stamp, null, 2) + "\n");
  return stamp;
}
export function readBoundCsv(file, cfg, kind) {
  const sidecar = sidecarPath(file);
  if (!fs.existsSync(sidecar)) throw new Error(`${file}: missing provenance sidecar. Re-run verify-deposits; legacy unbound intermediates cannot authorize attendance.`);
  const stamp = JSON.parse(fs.readFileSync(sidecar, "utf8"));
  assertIdentity(stamp, cfg, file);
  if (stamp.schema !== "kickback-import/v1" || stamp.kind !== kind || stamp.outputSha256 !== fileHash(file))
    throw new Error(`${file}: provenance schema/kind/hash mismatch; rebuild the intermediate`);
  return { rows: parse(fs.readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }), stamp };
}
