import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAbi, caseTemplate, renderCase } from "../scripts/lib.mjs";
import { identity, configHash, fileHash, reviewSource, bindOutput, readBoundCsv, validateSourceMetadata } from "../scripts/provenance.mjs";

const cfg = { eventId: "event-a", chainId: 1337, contract: "0x0000000000000000000000000000000000000001", depositUnits: 10n, abiVersion: "v7" };
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kickback-provenance-"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function review(file, config = cfg, kind = "checkins") {
  const output = `${file}.review.json`;
  fs.writeFileSync(output, JSON.stringify({ schema: "kickback-source-review/v1", ...identity(config), configHash: configHash(config),
    reviewer: "Synthetic organiser", reviewedAt: new Date().toISOString(), reason: "Fixture source explicitly reviewed", sources: [{ kind, sha256: fileHash(file) }] }));
  return output;
}

test("raw export requires named provenance review; hash only binds bytes, not origin", () => {
  const file = path.join(temp(), "raw.csv"); fs.writeFileSync(file, "email,checked_in_at\nsynthetic@example.invalid,yes\n");
  assert.throws(() => reviewSource(file, cfg, "checkins"), /origin cannot be verified automatically/);
  const checked = reviewSource(file, cfg, "checkins", review(file));
  assert.match(checked.origin, /not independently verified/);
  fs.appendFileSync(file, "other@example.invalid,yes\n");
  assert.throws(() => reviewSource(file, cfg, "checkins", `${file}.review.json`), /source hash\/kind/);
});

test("proven metadata mismatch is rejected even with an explicit organiser review", () => {
  const file = path.join(temp(), "wrong.csv"); fs.writeFileSync(file, "event_id,email\nevent-b,synthetic@example.invalid\n");
  assert.throws(() => reviewSource(file, cfg, "checkins", review(file)), /proven source event_id mismatch/);
  assert.throws(() => validateSourceMetadata([{ chain_id: 1 }], cfg, file), /chain_id mismatch/);
  assert.throws(() => validateSourceMetadata([{ contract: "0x0000000000000000000000000000000000000002" }], cfg, file), /contract mismatch/);
  assert.throws(() => validateSourceMetadata([{ luma_event_id: "unknown" }], cfg, file), /luma_event_id mismatch/);
});

test("bound verified/claims intermediates reject another event/deployment, substitution and stale config", () => {
  const file = path.join(temp(), "verified.csv"); fs.writeFileSync(file, "wallet,email\n0x0000000000000000000000000000000000000003,synthetic@example.invalid\n");
  bindOutput(file, cfg, "verified", []);
  assert.equal(readBoundCsv(file, cfg, "verified").rows.length, 1);
  assert.throws(() => readBoundCsv(file, { ...cfg, eventId: "event-b" }, "verified"), /eventId mismatch/);
  assert.throws(() => readBoundCsv(file, { ...cfg, chainId: 1 }, "verified"), /chainId mismatch/);
  assert.throws(() => readBoundCsv(file, { ...cfg, contract: "0x0000000000000000000000000000000000000002" }, "verified"), /contract mismatch/);
  assert.throws(() => readBoundCsv(file, { ...cfg, depositUnits: 11n }, "verified"), /deposit mismatch/);
  assert.throws(() => readBoundCsv(file, { ...cfg, depositDeadline: "2030-01-01T00:00:00Z" }, "verified"), /configuration changed/);
  assert.throws(() => readBoundCsv(file, cfg, "claims"), /kind\/hash mismatch/);
  fs.appendFileSync(file, "extra,other\n");
  assert.throws(() => readBoundCsv(file, cfg, "verified"), /kind\/hash mismatch/);
});

test("legacy unbound intermediates and missing reviewer are rejected, including empty files", () => {
  const file = path.join(temp(), "empty.csv"); fs.writeFileSync(file, "wallet,email\n");
  assert.throws(() => readBoundCsv(file, cfg, "verified"), /missing provenance sidecar/);
  bindOutput(file, cfg, "verified", []);
  assert.deepEqual(readBoundCsv(file, cfg, "verified").rows, []);
  const r = review(file); const json = JSON.parse(fs.readFileSync(r)); json.reviewer = ""; fs.writeFileSync(r, JSON.stringify(json));
  assert.throws(() => reviewSource(file, cfg, "checkins", r), /named reviewer/);
});

test("legacy deployment fallback is stable, unique and independent of display name", () => {
  const legacy = { ...cfg, eventId: undefined };
  assert.equal(identity(legacy).eventId, identity({ ...legacy, eventName: "Renamed" }).eventId);
  assert.notEqual(identity(legacy).eventId, identity({ ...legacy, contract: "0x0000000000000000000000000000000000000002" }).eventId);
});

test("v7 snapshot/source stay byte-identical to the recorded deployment; unsupported ABIs fail closed", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "abi/v7/manifest.json")));
  assert.equal(fileHash(path.join(root, "contracts/TruthPaysKickback.sol")), manifest.sourceSha256);
  assert.equal(fileHash(path.join(root, "abi/v7/TruthPaysKickback.json")), manifest.artifactSha256);
  const deployed = JSON.parse(fs.readFileSync(path.join(root, "deployments/truth-pays-mainnet/standard-input.json")));
  assert.equal(fs.readFileSync(path.join(root, "contracts/TruthPaysKickback.sol"), "utf8"), deployed.sources["TruthPaysKickback.sol"].content);
  assert.ok(loadAbi("TruthPaysKickback", "v7").abi.length > 0);
  assert.throws(() => loadAbi("TruthPaysKickback", "v8"), /Unsupported.*ABI version/);
});

test("new event metaevidence is event-specific; historical template remains explicit and unchanged", () => {
  const owner = "0x0000000000000000000000000000000000000004";
  const wallet = "0x0000000000000000000000000000000000000003";
  const config = { ...cfg, eventName: "Synthetic Event A", owner, venue: "Local venue", timezone: "Asia/Bangkok", eventStart: "2026-11-01T10:00:00+07:00",
    chainName: "Local chain", explorer: "https://example.invalid", kleros: { policyURI: "/ipfs/QmSyntheticPolicy" } };
  const meta = JSON.parse(renderCase(caseTemplate(config), wallet, cfg.contract));
  assert.match(meta.title, /Synthetic Event A/);
  assert.match(meta.description, /Local venue/);
  assert.doesNotMatch(meta.description, /Truth Pays|Mumbai/);
  assert.equal(meta.fileURI, config.kleros.policyURI);
  const legacy = JSON.parse(renderCase(caseTemplate({ ...config, eventId: undefined, eventName: "Truth Pays" }), wallet, cfg.contract));
  assert.match(legacy.description, /Mumbai/);
});
