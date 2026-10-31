// Verify a fact already signed by the human. No signer, sender, store or adoption API.
import { ethers } from "ethers";
import { hash, requireThat } from "./utils.mjs";
import { projectV10CanonicalTransaction } from "./v10-production-wallets.mjs";
import { METAMASK_V130 } from "./v10-wallet-compatibility.mjs";

const DELEGATE_CODE_HASH =
  "0x0b77e469f5603ed1e9ff0e7ee56238b61a8cf7cb3185b33e53e2eeaad50109ab";
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const digest = (v) => ethers.isHexString(v, 32) && v !== ethers.ZeroHash;
const decimal = (v, positive = false) =>
  typeof v === "string" &&
  v.length <= 78 &&
  /^(?:0|[1-9][0-9]*)$/.test(v) &&
  BigInt(v) < 2n ** 256n &&
  (!positive || BigInt(v) > 0n);
const check = (ok, code = "REPLACEMENT_MISMATCH", status = 409) =>
  requireThat(
    ok,
    "This transaction does not prove the saved creation was replaced by the same call. Preserve both transaction records.",
    code,
    status,
  );
const quantity = (v) => {
  check(typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(v));
  return BigInt(v);
};
const header = (block) => {
  check(block && digest(block.hash), "REPLACEMENT_UNAVAILABLE", 503);
  const number = quantity(block.number);
  check(
    number <= BigInt(Number.MAX_SAFE_INTEGER),
    "REPLACEMENT_UNAVAILABLE",
    503,
  );
  return { blockNumber: Number(number), blockHash: block.hash };
};
function freeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/**
 * Original call facts are a server-persisted witness, never browser nonce/calldata.
 * This proves replacement linkage only. The caller must still verify the exact
 * saved review, protected-wallet execution and child source before event adoption.
 */
export async function verifyV10CreationFeeReplacement({
  provider,
  original,
  replacementHash,
} = {}) {
  const fields =
    original && typeof original === "object" && !Array.isArray(original)
      ? Object.getOwnPropertyDescriptors(original)
      : null;
  check(
    provider &&
      typeof provider.send === "function" &&
      fields &&
      [Object.prototype, null].includes(Object.getPrototypeOf(original)) &&
      Reflect.ownKeys(original).length === 10 &&
      Object.keys(original).sort().join() ===
        "accessListHash,dataHash,gasLimit,hash,nonce,reviewBlock,to,type,valueWei,wallet" &&
      Object.values(fields).every((field) => Object.hasOwn(field, "value")) &&
      digest(original.hash) &&
      ethers.isAddress(original.wallet) &&
      original.wallet !== ethers.ZeroAddress &&
      Number.isSafeInteger(original.nonce) &&
      original.nonce >= 0 &&
      Number.isSafeInteger(original.reviewBlock) &&
      original.reviewBlock >= 0 &&
      original.type === 2 &&
      ethers.isAddress(original.to) &&
      original.to !== ethers.ZeroAddress &&
      decimal(original.valueWei) &&
      decimal(original.gasLimit, true) &&
      digest(original.dataHash) &&
      typeof original.accessListHash === "string" &&
      /^[a-f0-9]{64}$/.test(original.accessListHash) &&
      digest(replacementHash) &&
      !same(replacementHash, original.hash),
    "REPLACEMENT_INPUT",
    422,
  );
  // Snapshot only facts, so even an accessor or a caller mutation cannot change the scope mid-read.
  const saved = freeze({ ...original }),
    originalBefore = hash(saved);
  const originalHash = saved.hash,
    wallet = ethers.getAddress(saved.wallet);
  const nonce = saved.nonce,
    txHash = replacementHash.toLowerCase();
  const rpc = (method, params = []) => provider.send(method, params);
  try {
    check(quantity(await rpc("eth_chainId")) === 1n, "REPLACEMENT_WRONG_CHAIN");
    const raw = await rpc("eth_getTransactionByHash", [txHash]);
    check(raw && raw.blockHash && raw.blockNumber, "REPLACEMENT_UNCONFIRMED");
    const rawBefore = hash(raw);
    let tx;
    try {
      tx = projectV10CanonicalTransaction(raw);
    } catch {
      check(false);
    }
    check(
      same(tx.hash, txHash) &&
        quantity(tx.type) === 2n &&
        quantity(tx.chainId) === 1n &&
        same(tx.from, wallet) &&
        same(tx.to, saved.to) &&
        quantity(tx.nonce) === BigInt(nonce) &&
        quantity(tx.value) === BigInt(saved.valueWei) &&
        same(ethers.keccak256(tx.data), saved.dataHash) &&
        quantity(raw.gas) === BigInt(saved.gasLimit) &&
        (!raw.authorizationList || raw.authorizationList.length === 0) &&
        hash(raw.accessList ?? []) === saved.accessListHash,
    );
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    check(receipt, "REPLACEMENT_UNCONFIRMED");
    const receiptBefore = hash(receipt);
    check(
      same(receipt.transactionHash, txHash) &&
        same(receipt.blockHash, raw.blockHash) &&
        receipt.blockNumber === raw.blockNumber &&
        same(receipt.from, wallet) &&
        same(receipt.to, saved.to) &&
        (receipt.type === undefined || quantity(receipt.type) === 2n),
    );
    check(quantity(receipt.status) === 1n, "REPLACEMENT_REVERTED");
    const receiptBlock = header(
      await rpc("eth_getBlockByNumber", [raw.blockNumber, false]),
    );
    check(
      receiptBlock.blockNumber === Number(quantity(raw.blockNumber)) &&
        same(receiptBlock.blockHash, raw.blockHash) &&
        receiptBlock.blockNumber > saved.reviewBlock,
      "REPLACEMENT_REORG",
    );
    check(
      (await rpc("eth_getTransactionReceipt", [originalHash])) === null,
      "REPLACEMENT_ORIGINAL_CONFIRMED",
    );

    const code = await rpc("eth_getCode", [wallet, raw.blockNumber]);
    let accountType = "eoa",
      delegateCodeHash;
    if (code !== "0x") {
      check(
        same(code, "0xef0100" + METAMASK_V130.delegate.slice(2)),
        "REPLACEMENT_WALLET_PROFILE",
      );
      const delegateCode = await rpc("eth_getCode", [
        METAMASK_V130.delegate,
        raw.blockNumber,
      ]);
      check(ethers.isHexString(delegateCode), "REPLACEMENT_WALLET_PROFILE");
      delegateCodeHash = ethers.keccak256(delegateCode);
      check(
        delegateCodeHash === DELEGATE_CODE_HASH,
        "REPLACEMENT_WALLET_PROFILE",
      );
      accountType = "metamask-protected-self-v1.3";
    }
    const anchor = header(await rpc("eth_getBlockByNumber", ["latest", false]));
    check(anchor.blockNumber >= receiptBlock.blockNumber, "REPLACEMENT_REORG");
    check(
      quantity(
        await rpc("eth_getTransactionCount", [
          wallet,
          ethers.toQuantity(anchor.blockNumber),
        ]),
      ) > BigInt(nonce),
      "REPLACEMENT_NONCE_NOT_CONSUMED",
    );
    const closingReceipt = header(
      await rpc("eth_getBlockByNumber", [raw.blockNumber, false]),
    );
    const closingAnchor =
      anchor.blockNumber === receiptBlock.blockNumber
        ? closingReceipt
        : header(
            await rpc("eth_getBlockByNumber", [
              ethers.toQuantity(anchor.blockNumber),
              false,
            ]),
          );
    check(
      same(closingReceipt.blockHash, receiptBlock.blockHash) &&
        closingReceipt.blockNumber === receiptBlock.blockNumber &&
        same(closingAnchor.blockHash, anchor.blockHash) &&
        closingAnchor.blockNumber === anchor.blockNumber,
      "REPLACEMENT_REORG",
    );
    check(
      (await rpc("eth_getTransactionReceipt", [originalHash])) === null,
      "REPLACEMENT_ORIGINAL_CONFIRMED",
    );
    check(quantity(await rpc("eth_chainId")) === 1n, "REPLACEMENT_REORG");
    check(
      hash(raw) === rawBefore &&
        hash(receipt) === receiptBefore &&
        hash(saved) === originalBefore,
      "REPLACEMENT_REORG",
    );
    const gasUsed = quantity(receipt.gasUsed),
      gasPrice = quantity(receipt.effectiveGasPrice);
    check(
      gasUsed > 0n &&
        gasUsed <= quantity(raw.gas) &&
        gasPrice <= quantity(raw.maxFeePerGas),
    );
    return freeze({
      verified: true,
      kind: "same-call-fee-replacement",
      chainId: 1,
      originalHash: originalHash.toLowerCase(),
      hash: txHash,
      wallet,
      nonce,
      type: 2,
      to: ethers.getAddress(saved.to),
      valueWei: saved.valueWei,
      dataHash: saved.dataHash,
      gasLimit: saved.gasLimit,
      accessListHash: saved.accessListHash,
      blockNumber: receiptBlock.blockNumber,
      blockHash: receiptBlock.blockHash,
      gasUsed: String(gasUsed),
      gasPriceWei: String(gasPrice),
      feeWei: String(gasUsed * gasPrice),
      accountType,
      ...(delegateCodeHash ? { delegateCodeHash } : {}),
      anchor,
    });
  } catch (error) {
    if (/^REPLACEMENT_[A-Z_]+$/.test(error?.code ?? "")) throw error;
    check(false, "REPLACEMENT_UNAVAILABLE", 503);
  }
}
