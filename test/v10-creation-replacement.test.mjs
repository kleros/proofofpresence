// Offline synthetic signatures/provider facts only. No network, wallet files or broadcasts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { verifyV10CreationFeeReplacement } from "../src/v10-creation-replacement.mjs";
import { METAMASK_V130 } from "../src/v10-wallet-compatibility.mjs";

const observed = JSON.parse(
  fs.readFileSync(
    new URL(
      "../artifacts/v10-integration/metamask-runtime-observed.json",
      import.meta.url,
    ),
  ),
);
const delegateCode = observed.contracts.find((c) => c.name === "delegate").code;
const blockHash = ethers.id("synthetic-fee-replacement-block100");
const headHash = ethers.id("synthetic-fee-replacement-head110");
const q = ethers.toQuantity;
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

async function fixture(options = {}) {
  const signer = ethers.Wallet.createRandom();
  const type = options.transaction?.type ?? 2;
  // The verifier treats outer calldata as opaque. The caller separately proves
  // protected-wallet permissions, original saved review and child deployment.
  const savedCall = {
    chainId: 1,
    nonce: 10,
    to: METAMASK_V130.manager,
    value: 0n,
    data: "0x12345678",
    gasLimit: 1779952n,
    accessList: [],
    ...(options.savedTransaction ?? {}),
  };
  const originalSigned = ethers.Transaction.from(
    await signer.signTransaction({
      ...savedCall,
      type: 2,
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 100000n,
    }),
  );
  const request = {
    ...savedCall,
    type,
    ...(type === 0
      ? { gasPrice: 8000000000n }
      : { maxFeePerGas: 8000000000n, maxPriorityFeePerGas: 100000000n }),
    ...(options.transaction ?? {}),
  };
  if (type === 0) delete request.accessList;
  const tx = ethers.Transaction.from(await signer.signTransaction(request));
  const raw = {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    type: q(tx.type),
    chainId: q(tx.chainId),
    nonce: q(tx.nonce),
    value: q(tx.value),
    input: tx.data,
    gas: q(tx.gasLimit),
    ...(type === 0
      ? { gasPrice: q(tx.gasPrice) }
      : {
          maxFeePerGas: q(tx.maxFeePerGas),
          maxPriorityFeePerGas: q(tx.maxPriorityFeePerGas),
        }),
    accessList: tx.accessList ?? [],
    yParity: q(tx.signature.yParity),
    r: tx.signature.r,
    s: tx.signature.s,
    blockHash,
    blockNumber: q(100),
    transactionIndex: q(0),
  };
  const original = {
    hash: originalSigned.hash,
    wallet: signer.address,
    nonce: originalSigned.nonce,
    reviewBlock: 99,
    type: 2,
    to: originalSigned.to,
    valueWei: String(originalSigned.value),
    dataHash: ethers.keccak256(originalSigned.data),
    gasLimit: String(originalSigned.gasLimit),
    accessListHash: hash(originalSigned.accessList ?? []),
    ...(options.original ?? {}),
  };
  const receipt = {
    transactionHash: raw.hash,
    from: raw.from,
    to: raw.to,
    blockHash,
    blockNumber: q(100),
    transactionIndex: q(0),
    type: q(type),
    status: q(1),
    gasUsed: q(1667221),
    effectiveGasPrice: q(3000000000n),
    contractAddress: null,
    logs: [],
    ...(options.receipt ?? {}),
  };
  const calls = [],
    counts = new Map();
  const provider = {
    async send(method, params) {
      calls.push({ method, params: structuredClone(params) });
      const key = method + JSON.stringify(params);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      let result;
      if (method === "eth_chainId") result = "0x1";
      else if (method === "eth_getTransactionByHash")
        result = options.missing ? null : raw;
      else if (method === "eth_getTransactionReceipt")
        result =
          params[0].toLowerCase() === original.hash.toLowerCase()
            ? (options.originalReceipt ?? null)
            : options.pending
              ? null
              : receipt;
      else if (method === "eth_getBlockByNumber")
        result =
          params[0] === "latest" || params[0] === q(110)
            ? { number: q(110), hash: headHash }
            : { number: q(100), hash: blockHash };
      else if (method === "eth_getTransactionCount")
        result = q(options.latestNonce ?? 11);
      else if (method === "eth_getCode")
        result =
          params[0].toLowerCase() === signer.address.toLowerCase()
            ? (options.walletCode ??
              (options.delegated
                ? "0xef0100" + METAMASK_V130.delegate.slice(2)
                : "0x"))
            : (options.delegateCode ?? delegateCode);
      else throw Error("Unexpected read method");
      return options.transform
        ? options.transform(method, params, result, count)
        : result;
    },
  };
  return {
    original,
    raw,
    receipt,
    calls,
    provider,
    input: { provider, original, replacementHash: raw.hash },
  };
}
const rejects = (input, code) =>
  assert.rejects(
    verifyV10CreationFeeReplacement(input),
    (e) => e.code === code,
  );

test("canonical signed unchanged-call replacement preserves inputs and exact saved call facts", async () => {
  const f = await fixture();
  const before = JSON.stringify({
    original: f.original,
    raw: f.raw,
    receipt: f.receipt,
  });
  deepFreeze(f.original);
  deepFreeze(f.raw);
  deepFreeze(f.receipt);
  const p = await verifyV10CreationFeeReplacement(f.input);
  assert.equal(p.kind, "same-call-fee-replacement");
  assert.equal(p.verified, true);
  assert.equal(p.originalHash, f.original.hash);
  assert.equal(p.hash, f.raw.hash);
  assert.equal(p.wallet, f.original.wallet);
  assert.notEqual(p.hash, p.originalHash);
  assert.equal(p.nonce, 10);
  for (const field of [
    "type",
    "to",
    "valueWei",
    "dataHash",
    "gasLimit",
    "accessListHash",
  ])
    assert.equal(p[field], f.original[field]);
  assert.equal(p.blockNumber, 100);
  assert.equal(p.blockHash, blockHash);
  assert.equal(p.feeWei, String(1667221n * 3000000000n));
  assert.equal(p.accountType, "eoa");
  assert.equal(p.anchor.blockNumber, 110);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.anchor));
  assert.equal(
    JSON.stringify({ original: f.original, raw: f.raw, receipt: f.receipt }),
    before,
  );
  assert.ok(
    !JSON.stringify(p).includes('"r":') && !JSON.stringify(p).includes('"s":'),
  );
  assert.ok(
    f.calls.every((c) =>
      [
        "eth_chainId",
        "eth_getTransactionByHash",
        "eth_getTransactionReceipt",
        "eth_getBlockByNumber",
        "eth_getTransactionCount",
        "eth_getCode",
      ].includes(c.method),
    ),
  );
});

test("reviewed MetaMask delegate runtime is checked at the receipt block", async () => {
  const f = await fixture({ delegated: true });
  const p = await verifyV10CreationFeeReplacement(f.input);
  assert.equal(p.accountType, "metamask-protected-self-v1.3");
  assert.equal(
    p.delegateCodeHash,
    observed.contracts.find((c) => c.name === "delegate").codeHash,
  );
  assert.ok(
    f.calls.some(
      (c) =>
        c.method === "eth_getCode" &&
        c.params[0] === METAMASK_V130.delegate &&
        c.params[1] === q(100),
    ),
  );
});

test("missing or pending replacement never becomes replacement evidence", async () => {
  for (const options of [{ missing: true }, { pending: true }]) {
    const f = await fixture(options);
    await rejects(f.input, "REPLACEMENT_UNCONFIRMED");
  }
});

test("changing nonce, recipient, value, calldata, gas limit, access list or type is rejected", async () => {
  const other = ethers.Wallet.createRandom().address;
  for (const transaction of [
    { nonce: 11 },
    { to: other },
    { value: 1n },
    { data: "0x00" },
    { gasLimit: 1800000n },
    { accessList: [{ address: other, storageKeys: [] }] },
    { type: 0 },
  ]) {
    const f = await fixture({ transaction });
    await rejects(f.input, "REPLACEMENT_MISMATCH");
  }
});

test("an original nonempty access list can be preserved but cannot be removed", async () => {
  const savedTransaction = {
    accessList: [
      {
        address: "0x0000000000000000000000000000000000001234",
        storageKeys: [ethers.ZeroHash],
      },
    ],
  };
  const sameList = await fixture({ savedTransaction });
  assert.equal(
    (await verifyV10CreationFeeReplacement(sameList.input)).accessListHash,
    sameList.original.accessListHash,
  );
  const removed = await fixture({
    savedTransaction,
    transaction: { accessList: [] },
  });
  await rejects(removed.input, "REPLACEMENT_MISMATCH");
});

test("wallet and chain must match the trusted original submission witness", async () => {
  const f = await fixture({
    original: { wallet: ethers.Wallet.createRandom().address },
  });
  await rejects(f.input, "REPLACEMENT_MISMATCH");
  const otherChain = await fixture({ transaction: { chainId: 2 } });
  await rejects(otherChain.input, "REPLACEMENT_MISMATCH");
  const wrongProvider = await fixture({
    transform: (m, _p, r) => (m === "eth_chainId" ? "0x2" : r),
  });
  await rejects(wrongProvider.input, "REPLACEMENT_WRONG_CHAIN");
});

test("a fabricated transaction hash cannot substitute for the signed envelope", async () => {
  const f = await fixture();
  f.raw.hash = ethers.id("tampered-signed-hash");
  f.input.replacementHash = f.raw.hash;
  await rejects(f.input, "REPLACEMENT_MISMATCH");
});

test("an original receipt, including one appearing during verification, blocks a replacement alias", async () => {
  const f = await fixture({
    originalReceipt: {
      transactionHash: ethers.id("synthetic-original-creation"),
    },
  });
  await rejects(f.input, "REPLACEMENT_ORIGINAL_CONFIRMED");
  let original;
  const race = await fixture({
    transform: (m, params, result, count) =>
      m === "eth_getTransactionReceipt" && params[0] === original && count === 2
        ? { transactionHash: original }
        : result,
  });
  original = race.original.hash;
  await rejects(race.input, "REPLACEMENT_ORIGINAL_CONFIRMED");
});

test("reverted or receipt-mismatched transactions do not release the draft", async () => {
  const reverted = await fixture({ receipt: { status: "0x0" } });
  await rejects(reverted.input, "REPLACEMENT_REVERTED");
  const mismatch = await fixture({
    receipt: { blockHash: ethers.id("wrong-receipt-block") },
  });
  await rejects(mismatch.input, "REPLACEMENT_MISMATCH");
});

test("receipt must follow review and its nonce must be consumed at the current anchor", async () => {
  const old = await fixture({ original: { reviewBlock: 100 } });
  await rejects(old.input, "REPLACEMENT_REORG");
  const unconsumed = await fixture({ latestNonce: 10 });
  await rejects(unconsumed.input, "REPLACEMENT_NONCE_NOT_CONSUMED");
});

test("unsupported delegation and changed delegate runtime are rejected", async () => {
  const unsupported = await fixture({ walletCode: "0x6000" });
  await rejects(unsupported.input, "REPLACEMENT_WALLET_PROFILE");
  const changed = await fixture({ delegated: true, delegateCode: "0x6000" });
  await rejects(changed.input, "REPLACEMENT_WALLET_PROFILE");
});

test("reorg of the containing block or current anchor is detected", async () => {
  for (const changedTag of [q(100), q(110)]) {
    const f = await fixture({
      transform: (m, params, result, count) =>
        m === "eth_getBlockByNumber" &&
        params[0] === changedTag &&
        (changedTag === q(110) || count === 2)
          ? { ...result, hash: ethers.id("reorged") }
          : result,
    });
    await rejects(f.input, "REPLACEMENT_REORG");
  }
});

test("chain switch at closing is rejected", async () => {
  const f = await fixture({
    transform: (m, _p, r, count) =>
      m === "eth_chainId" && count === 2 ? "0x2" : r,
  });
  await rejects(f.input, "REPLACEMENT_REORG");
});

test("impossible receipt gas and fee data are rejected", async () => {
  for (const receipt of [
    { gasUsed: q(1779953) },
    { effectiveGasPrice: q(8000000001n) },
  ]) {
    const f = await fixture({ receipt });
    await rejects(f.input, "REPLACEMENT_MISMATCH");
  }
});

test("input is exact and a callback/RPC failure is sanitized without writes", async () => {
  const f = await fixture();
  await rejects(
    { ...f.input, replacementHash: f.original.hash },
    "REPLACEMENT_INPUT",
  );
  const noNonce = { ...f.original };
  delete noNonce.nonce;
  await rejects({ ...f.input, original: noNonce }, "REPLACEMENT_INPUT");
  for (const patch of [
    { type: 0 },
    { gasLimit: "012" },
    { valueWei: "-1" },
    { accessListHash: "untrusted" },
  ])
    await rejects(
      { ...f.input, original: { ...f.original, ...patch } },
      "REPLACEMENT_INPUT",
    );
  await rejects(
    { ...f.input, original: { ...f.original, browserNonce: 10 } },
    "REPLACEMENT_INPUT",
  );
  const accessor = { ...f.original };
  Object.defineProperty(accessor, "nonce", { enumerable: true, get: () => 10 });
  await rejects({ ...f.input, original: accessor }, "REPLACEMENT_INPUT");
  assert.equal(f.calls.length, 0);
  await assert.rejects(
    verifyV10CreationFeeReplacement({
      ...f.input,
      provider: {
        send: async () => {
          throw Error("sensitive RPC diagnostic");
        },
      },
    }),
    (e) =>
      e.code === "REPLACEMENT_UNAVAILABLE" && !e.message.includes("sensitive"),
  );
});
