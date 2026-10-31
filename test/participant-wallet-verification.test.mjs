import { test } from "node:test";
import assert from "node:assert/strict";
import { hasVerifiedParticipantWallet } from "../src/utils.mjs";

const record = (contractVersion, chainId = 1) => ({ deployment: { contractVersion, chainId } });

test("only exact V9/V10 mainnet profiles accept nonce-verified wallet participants without inventing Luma identity", () => {
  const walletOnly = { walletVerified: true, identityVerified: false, name: null, email: null };
  for (const version of ["kleros-event-v9-uups", "kleros-event-v10-uups"]) {
    assert.equal(hasVerifiedParticipantWallet(record(version), walletOnly), true);
    for (const chainId of [10200, 1337, "1", undefined])
      assert.equal(hasVerifiedParticipantWallet({ deployment: { contractVersion: version, chainId } }, walletOnly), false);
    for (const walletVerified of [false, undefined, "true", 1])
      assert.equal(hasVerifiedParticipantWallet(record(version), { walletVerified, identityVerified: false }), false);
  }
  for (const version of ["truth-pays-v7", "kleros-event-v8", "kleros-event-v8-test15m", "kleros-event-v9-uups-chiado", "kleros-event-v10-uups-unknown", "kleros-event-v11-uups", undefined])
    assert.equal(hasVerifiedParticipantWallet(record(version), walletOnly), false);
  assert.deepEqual(walletOnly, { walletVerified: true, identityVerified: false, name: null, email: null });
});

test("historical identity verification stays strict and retains its existing profile semantics", () => {
  for (const version of ["truth-pays-v7", "kleros-event-v8", "kleros-event-v8-test15m", "kleros-event-v9-uups", "kleros-event-v10-uups"]) {
    assert.equal(hasVerifiedParticipantWallet(record(version), { identityVerified: true }), true);
    for (const identityVerified of [false, undefined, "true", 1])
      assert.equal(hasVerifiedParticipantWallet(record(version), { identityVerified }), false);
  }
  assert.equal(hasVerifiedParticipantWallet(null, null), false);
});
