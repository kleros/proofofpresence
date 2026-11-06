import { test } from "node:test";
import assert from "node:assert/strict";
import { financialStateFingerprint } from "../src/chain.mjs";
import { hash } from "../src/utils.mjs";

test("only V10 publication display metadata is omitted from the financial snapshot", () => {
  const state = { phase: "Listed", owner: "owner", poolWei: "10", reservedWei: "2", cases: [{ wallet: "challenger",
    matched: false, state: "Waiting", matcher: "zero", matchEndsAt: 123, depositWei: "1", localDisputeID: null,
    arbitratorDisputeID: null, heldShareWei: "0", finalRuling: null, caseURI: "/ipfs/a",
    publication: { status: "verified", lastCheckedAt: 1 } }] };
  const clone = () => structuredClone(state), v10 = "kleros-event-v10-uups", v9 = "kleros-event-v9-uups";
  const expected = financialStateFingerprint(state, v10), changedPublication = clone();
  changedPublication.cases[0].publication = { status: "unavailable", lastCheckedAt: 500 };
  assert.equal(financialStateFingerprint(changedPublication, v10), expected);
  assert.equal(financialStateFingerprint(state, v9), hash(state));
  assert.notEqual(financialStateFingerprint(changedPublication, v9), hash(state));
  for (const key of ["wallet", "matched", "state", "matcher", "matchEndsAt", "depositWei", "localDisputeID", "arbitratorDisputeID", "heldShareWei", "finalRuling", "caseURI"]) {
    const changed = clone(); changed.cases[0][key] = `changed-${key}`;
    assert.notEqual(financialStateFingerprint(changed, v10), expected, key);
  }
  for (const key of ["phase", "owner", "poolWei", "reservedWei"]) {
    const changed = clone(); changed[key] = `changed-${key}`;
    assert.notEqual(financialStateFingerprint(changed, v10), expected, key);
  }
});
