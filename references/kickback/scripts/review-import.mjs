#!/usr/bin/env node
// Records an organiser's explicit provenance review; never treats a hash as verified origin.
import fs from "node:fs";
import { args, loadConfig, readCsv } from "./lib.mjs";
import { identity, configHash, fileHash, validateSourceMetadata } from "./provenance.mjs";
const a = args();
if (!a.reviewer || !a.reason || !a.out) throw new Error("Usage: review-import --reviewer <name/role> --reason <how origin was checked> --out review.json --config config.json [--guests file.csv] [--checkins file.csv] [--manual file.csv]");
const cfg = loadConfig(a.config ?? "config.json");
const sources = ["guests", "checkins", "manual"].filter((kind) => a[kind]).map((kind) => {
  validateSourceMetadata(readCsv(a[kind]), cfg, a[kind]);
  return { kind, sha256: fileHash(a[kind]) };
});
if (!sources.length) throw new Error("Choose at least one source file");
fs.writeFileSync(a.out, JSON.stringify({ schema: "kickback-source-review/v1", ...identity(cfg),
  configHash: configHash(cfg), reviewer: a.reviewer, reviewedAt: new Date().toISOString(), reason: a.reason, sources }, null, 2) + "\n");
console.log(`Recorded provenance review for ${identity(cfg).eventId}. Source origin remains an organiser trust assumption; hashes only bind reviewed bytes. No known mismatch can be overridden.`);
