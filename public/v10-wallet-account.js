import {
  V10_PRODUCTION_CONTRACT_VERSION,
  isVerifiedV10ProductionProfile,
} from "./contract-profiles.js";

// Read-only classification facts only. This module is not an auth/signing policy,
// is not wired to callers, and cannot enable the server's closed financial gate.
// SHA-256 pins are over decoded runtime BYTES, not UTF-8 hexadecimal text.
// Reviewed observed file SHA: 486913a5210ab05284468ce4a4efa2d9f279de44e120aadf3718d957678495eb
// Reproduced source proof SHA: 7108974bc07ca8b46964d855887d9c26c1891386d21c5cf1bdb3f628fb7cb17c
const DELEGATE = "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b";
const DESIGNATION = "0xef0100" + DELEGATE.slice(2);
const ACCOUNT_TYPE = "metamask-protected-self-v1.3";
const POLICY_VERSION = "v10-metamask-self-v1.3-1";
const FRAMEWORK = Object.freeze([
  Object.freeze({
    address: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
    bytes: 11503,
    sha256: "9b7be6df6b80a19e88e3a697e9fea0377a27d74f7107643607832794c2f1ae49",
  }),
  Object.freeze({
    address: DELEGATE,
    bytes: 11185,
    sha256: "deb51590e22cdf9f70292f763d6d3aea8b078148aae082f3af1eca19bf0aa58c",
  }),
  Object.freeze({
    address: "0xbd7b277507723490cd50b12eaafe87c616be6880",
    bytes: 2084,
    sha256: "b69a275a7049464d2441f51082a6fc65c1cc8aeda76ea776a96db09a1db7062f",
  }),
]);
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const address = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-f]{40}$/i.test(value) &&
  !/^0x0{40}$/i.test(value);
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
const contextError = () =>
  fail(
    "V10_WALLET_CONTEXT",
    "Refresh the exact V10 Ethereum wallet context before continuing.",
  );
const unsupported = () =>
  fail(
    "UNSUPPORTED_WALLET",
    "This wallet is outside the explicitly reviewed V10 account profile.",
  );
function contextKey(bootstrap) {
  if (
    bootstrap?.mode !== "hosted-production" ||
    bootstrap.contractVersion !== V10_PRODUCTION_CONTRACT_VERSION ||
    bootstrap.abiVersion !== V10_PRODUCTION_CONTRACT_VERSION ||
    !isVerifiedV10ProductionProfile(bootstrap.contractProfile) ||
    typeof bootstrap.instanceId !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(bootstrap.instanceId) ||
    bootstrap.chain?.chainId !== 1 ||
    bootstrap.environment?.chainId !== 1 ||
    bootstrap.environment.production !== true ||
    bootstrap.environment.network !== "ethereum-mainnet"
  )
    contextError();
  const support = bootstrap.walletSupport,
    caps = bootstrap.capabilities;
  return JSON.stringify([
    bootstrap.mode,
    bootstrap.instanceId,
    bootstrap.contractVersion,
    bootstrap.abiVersion,
    bootstrap.contractProfile,
    bootstrap.chain.chainId,
    bootstrap.environment.chainId,
    bootstrap.environment.production,
    bootstrap.environment.network,
    support?.type,
    support?.eoa,
    support?.eip7702,
    support?.erc1271,
    support?.accountPolicyVersion,
    caps?.production,
    caps?.browserWallet,
    caps?.walletTransactions,
    caps?.serverSigning,
    caps?.eip7702,
    caps?.erc1271,
    caps?.contractWallets,
    caps?.supportedAccountTypes,
  ]);
}
function delegatedMetadata(bootstrap) {
  const support = bootstrap.walletSupport,
    caps = bootstrap.capabilities;
  return (
    support?.type === "eoa-or-metamask-protected-self-v1.3" &&
    support.eoa === true &&
    support.eip7702 === true &&
    support.erc1271 === false &&
    support.accountPolicyVersion === POLICY_VERSION &&
    caps?.production === true &&
    caps.browserWallet === true &&
    caps.walletTransactions === true &&
    caps.serverSigning === false &&
    caps.eip7702 === true &&
    caps.erc1271 === false &&
    caps.contractWallets === false &&
    Array.isArray(caps.supportedAccountTypes) &&
    caps.supportedAccountTypes.length === 2 &&
    caps.supportedAccountTypes[0] === "eoa" &&
    caps.supportedAccountTypes[1] === ACCOUNT_TYPE
  );
}
function quantity(value) {
  if (
    typeof value !== "string" ||
    value.length > 16 ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)
  )
    fail(
      "V10_WALLET_UNAVAILABLE",
      "The wallet returned incomplete chain metadata.",
    );
  const result = BigInt(value);
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    fail(
      "V10_WALLET_UNAVAILABLE",
      "The wallet returned incomplete chain metadata.",
    );
  return Number(result);
}
function header(raw) {
  if (
    !raw ||
    typeof raw.hash !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(raw.hash) ||
    /^0x0{64}$/i.test(raw.hash)
  )
    fail(
      "V10_WALLET_REORG",
      "The wallet chain anchor is unavailable or changed.",
    );
  return {
    blockNumber: quantity(raw.number),
    blockHash: raw.hash.toLowerCase(),
  };
}
function codeBytes(value, expectedLength = null) {
  if (
    typeof value !== "string" ||
    value.length > 2 + 12000 * 2 ||
    !/^0x(?:[0-9a-f]{2})*$/i.test(value) ||
    (expectedLength !== null && value.length !== 2 + expectedLength * 2)
  )
    unsupported();
  return Uint8Array.from(value.slice(2).match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

/** Read-only, fresh EIP-1193 check. The caller still owns current event/session
 * identity, immutable reviewed intent, authoritative backend authorization and
 * canonical receipt verification. No cache, sign, send or account request exists.
 */
export async function assertV10WalletAccount({ provider, wallet, bootstrap }) {
  if (!address(wallet)) unsupported();
  if (!provider || typeof provider.request !== "function")
    fail(
      "V10_WALLET_UNAVAILABLE",
      "Connect the intended browser wallet before continuing.",
    );
  const captured = contextKey(bootstrap),
    normalizedWallet = wallet.toLowerCase();
  const current = () => {
    if (contextKey(bootstrap) !== captured) contextError();
  };
  const read = async (method, params = []) => {
    current();
    let result;
    try {
      result = await provider.request({ method, params });
    } catch {
      fail(
        "V10_WALLET_UNAVAILABLE",
        "The wallet compatibility read failed. Try a fresh check.",
      );
    }
    current();
    return result;
  };
  const chain = async () => {
    if (quantity(await read("eth_chainId")) !== 1)
      fail("WRONG_CHAIN", "Select Ethereum Mainnet before continuing.");
  };
  const account = async () => {
    const accounts = await read("eth_accounts");
    if (
      !Array.isArray(accounts) ||
      !address(accounts[0]) ||
      !same(accounts[0], normalizedWallet)
    )
      fail(
        "WRONG_WALLET",
        "The selected wallet changed. Reconnect the intended account.",
      );
  };
  await chain();
  await account();
  const at = header(await read("eth_getBlockByNumber", ["latest", false])),
    tag = "0x" + at.blockNumber.toString(16),
    code = await read("eth_getCode", [normalizedWallet, tag]);
  codeBytes(code);
  let accountType = "eoa";
  if (code !== "0x") {
    if (!same(code, DESIGNATION) || !delegatedMetadata(bootstrap))
      unsupported();
    if (!globalThis.crypto?.subtle?.digest)
      fail(
        "V10_WALLET_UNAVAILABLE",
        "Secure browser digest support is required for this account check.",
      );
    const actualHashes = await Promise.all(FRAMEWORK.map(async (pin) => {
      const runtime = codeBytes(
          await read("eth_getCode", [pin.address, tag]),
          pin.bytes,
        ),
        digest = await globalThis.crypto.subtle.digest("SHA-256", runtime);
      current();
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }));
    for (let index = 0; index < FRAMEWORK.length; index++)
      if (actualHashes[index] !== FRAMEWORK[index].sha256) unsupported();
    accountType = ACCOUNT_TYPE;
  }
  const closing = header(await read("eth_getBlockByNumber", [tag, false]));
  if (
    closing.blockNumber !== at.blockNumber ||
    closing.blockHash !== at.blockHash
  )
    fail(
      "V10_WALLET_REORG",
      "The wallet chain anchor changed. Request a fresh check.",
    );
  await chain();
  await account();
  current();
  return Object.freeze({
    wallet: normalizedWallet,
    accountType,
    chainId: 1,
    ...at,
  });
}
