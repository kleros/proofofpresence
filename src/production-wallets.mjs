// @ts-check
import { ethers } from "ethers";

/** @typedef {"INVALID_WALLET" | "UNSUPPORTED_WALLET" | "WALLET_RPC_UNAVAILABLE" | "WALLET_REORG"} ProductionWalletErrorCode */

export class ProductionWalletError extends Error {
  /** @param {ProductionWalletErrorCode} code @param {number} status @param {string} message */
  constructor(code, status, message) {
    super(message);
    this.name = "ProductionWalletError";
    this.code = code;
    this.status = status;
  }
}

const unavailable = () =>
  new ProductionWalletError(
    "WALLET_RPC_UNAVAILABLE",
    503,
    "Wallet compatibility could not be checked. Try again with a fresh chain read.",
  );

const reorg = () =>
  new ProductionWalletError(
    "WALLET_REORG",
    409,
    "The chain changed during the wallet compatibility check. Request a fresh check before continuing.",
  );

/** @param {unknown} value */
function blockMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw unavailable();
  const block = /** @type {{number?: unknown, hash?: unknown}} */ (value);
  if (
    typeof block.number !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(block.number) ||
    typeof block.hash !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(block.hash)
  )
    throw unavailable();
  const number = BigInt(block.number);
  if (number > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable();
  return {
    number: Number(number),
    hash: block.hash.toLowerCase(),
    tag: ethers.toQuantity(number),
  };
}

/**
 * Fresh code-presence check for production authentication and unsigned drafts.
 * Signature ownership and the configured chain are verified by the caller.
 * Do not gate read-only reconciliation of an already submitted hash on this check.
 *
 * Raw RPC calls deliberately bypass ethers' getBlock/getCode request memoization.
 * Each invocation checks a new head and anchors its code read to that block.
 *
 * @param {{send: (method: string, params: unknown[]) => Promise<unknown>}} provider
 * @param {string} address
 * @returns {Promise<{wallet: string, blockNumber: number, blockHash: string}>}
 */
export async function assertProductionEOAWallet(provider, address) {
  let wallet;
  try {
    wallet = ethers.getAddress(address);
  } catch {
    throw new ProductionWalletError(
      "INVALID_WALLET",
      422,
      "Use a valid Ethereum wallet address.",
    );
  }

  /** @param {string} method @param {unknown[]} params */
  async function rpc(method, params) {
    try {
      return await provider.send(method, params);
    } catch {
      // RPC errors can contain credentials, URLs and request payloads. None of
      // those details, including a nested cause, cross this public error boundary.
      throw unavailable();
    }
  }

  const block = blockMetadata(
    await rpc("eth_getBlockByNumber", ["latest", false]),
  );
  const code = await rpc("eth_getCode", [wallet, block.tag]);
  const canonicalResponse = await rpc("eth_getBlockByNumber", [
    block.tag,
    false,
  ]);
  if (canonicalResponse === null) throw reorg();
  const canonical = blockMetadata(canonicalResponse);
  if (canonical.number !== block.number || canonical.hash !== block.hash)
    throw reorg();

  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code))
    throw unavailable();
  if (code !== "0x")
    throw new ProductionWalletError(
      "UNSUPPORTED_WALLET",
      422,
      "This production app supports wallets without deployed code. Contract wallets and delegated wallets are unsupported.",
    );

  return {
    wallet,
    blockNumber: block.number,
    blockHash: block.hash,
  };
}
