import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareEWallets, boundedESigner, main, deployEStack, deployEChild } from "../scripts/testnet-v9-deploy.mjs";

test("explicit E wallet preparation is0600, isolated and never rotates existing identities", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kleros-v9-e-operator-"));
  try {
    const filename = path.join(dir, "v9-e-wallets.json"), result = prepareEWallets({ filename });
    const original = fs.readFileSync(filename);
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(result.addresses).sort(), ["alice", "bob", "owner"]);
    assert.equal(result.networkRequests, 0); assert.equal(result.broadcasts, 0);
    assert.doesNotMatch(JSON.stringify(result), /privateKey|mnemonic|seed/);
    assert.deepEqual(prepareEWallets({ filename }), result);
    assert.deepEqual(fs.readFileSync(filename), original);
    fs.chmodSync(filename, 0o644);
    assert.throws(() => prepareEWallets({ filename }), /owner-only/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("held E CLI and financial entry points stop before any runtime dependency", async () => {
  for (const flag of ["--prepare-stack", "--review-stack", "--deploy-stack", "--prepare-child", "--review-child", "--deploy-child"])
    await assert.rejects(main([flag]), /ON HOLD/);
  await assert.rejects(deployEStack({}), /ON HOLD/);
  await assert.rejects(deployEChild({}), /ON HOLD/);
});

test("final populated E fee, chain, nonce and budget faults stop before the signing dependency", async () => {
  const owner = "0x1111111111111111111111111111111111111111", to = "0x2222222222222222222222222222222222222222";
  const request = { from: owner, to, data: "0x", value: "0", chainId: 10200, nonce: 0, gasLimit: "21000" };
  const plan = { steps: [request], budget: { maxFeePerGasWei: "2", maxTotalCostWei: "1000000", childGas: "1", protocolReserveGas: "1" } };
  let signatures = 0;
  const signer = { getAddress: async () => owner, populateTransaction: async (v) => v,
    signTransaction: async () => { signatures++; return "SYNTHETIC_DEPENDENCY"; } };
  for (const fault of ["fee", "chain", "nonce", "balance"]) {
    const provider = { send: async () => fault === "chain" ? "0x1" : "0x27d8",
      getTransactionCount: async () => fault === "nonce" ? 1 : 0,
      getBalance: async () => fault === "balance" ? 1n : 1000000n };
    const bounded = boundedESigner(signer, { provider, plan, request, remaining: [request] });
    await assert.rejects(bounded.signTransaction({ ...request, maxFeePerGas: fault === "fee" ? 3n : 2n }));
    assert.equal(signatures, 0, `${fault} must reject before any key/signature dependency`);
  }
});
