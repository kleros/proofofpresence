import { test } from "node:test";
import assert from "node:assert/strict";
import { requireAvailableV10CaseMetadata } from "../src/v10-case-match-guard.mjs";

test("matching requires a previously verified exact document and a fresh successful availability check", async () => {
  const artifact = { sha256: "abc", scopeHash: "def", uri: "/ipfs/exact" };
  let reads = 0;
  const verified = { productionCase: true, status: "verified", artifact };
  const fresh = async () => { reads++; return { artifact, publication: { status: "verified" } }; };
  for (const record of [null, { ...verified, status: "exported" }, { ...verified, status: "upload-uncertain" },
    { ...verified, status: "published-unverified" }, { ...verified, status: "integrity-mismatch" }])
    await assert.rejects(requireAvailableV10CaseMetadata(record, fresh), { code: "CASE_METADATA_NOT_VERIFIED" });
  assert.equal(reads, 0);
  for (const result of [{ artifact, publication: { status: "unavailable" } },
    { artifact, publication: { status: "integrity-mismatch" } },
    { artifact: { ...artifact, uri: "/ipfs/other" }, publication: { status: "verified" } }])
    await assert.rejects(requireAvailableV10CaseMetadata(verified, async () => result), { code: "CASE_METADATA_NOT_VERIFIED" });
  await requireAvailableV10CaseMetadata(verified, fresh);
  assert.equal(reads, 1);
});
