// Pure V10-only analysis. No RPC, signature challenge issuance, sender or financial authorization.
// Primary references (reviewed 2026-10-29):
// https://github.com/MetaMask/delegation-framework/blob/v1.3.0/documents/Deployments.md
// https://github.com/MetaMask/delegation-framework/blob/v1.3.0/src/DelegationManager.sol
// https://github.com/MetaMask/delegation-framework/blob/v1.3.0/src/EIP7702/EIP7702DeleGatorCore.sol
// https://github.com/MetaMask/delegation-framework/blob/v1.3.0/src/enforcers/NativeBalanceChangeEnforcer.sol
// https://github.com/MetaMask/delegation-framework/blob/v1.3.0/src/utils/Constants.sol
// https://eips.ethereum.org/EIPS/eip-7702
import { createHash } from "node:crypto";
import { ethers } from "ethers";

export const V10_WALLET_PROFILE = "kleros-event-v10-uups";
export const METAMASK_V130 = Object.freeze({
  framework: "metamask-delegation-framework",
  version: "1.3.0",
  chainId: 1,
  manager: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
  delegate: "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B",
  nativeBalanceChangeEnforcer: "0xbD7B277507723490Cd50b12EaaFe87C616be6880",
});
export const V10_DELEGATED_PREREQUISITES = Object.freeze([
  "fresh-canonical-account-and-framework-code",
  "scoped-key-ownership-and-server-nonce-consumption",
  "reviewed-framework-runtime-and-permission-semantics",
  "actual-native-value-and-custody-proof",
  "actual-local-eip7702-integration",
  "canonical-receipt-and-event-state-proof",
]);
const messages = Object.freeze({
  V10_WALLET_INPUT: [
    422,
    "Use the exact reviewed V10 wallet and transaction fields.",
  ],
  V10_WALLET_SCOPE: [
    403,
    "This wallet analysis belongs to another reviewed V10 context.",
  ],
  V10_WALLET_UNSUPPORTED: [
    422,
    "This account or execution route is outside the reviewed V10 wallet profile.",
  ],
  V10_WALLET_UNVERIFIED: [
    422,
    "Reviewed framework runtime pins are required for delegated-account analysis.",
  ],
  V10_INTENT_MISMATCH: [
    409,
    "The actual transaction differs from the reviewed V10 intent.",
  ],
  V10_AUTHORIZATION_UNKNOWN: [
    422,
    "The transaction contains an unsupported account authorization.",
  ],
  V10_PERMISSION_UNSUPPORTED: [
    422,
    "The delegation permission differs from the reviewed protected-self route.",
  ],
});
export class V10WalletCompatibilityError extends Error {
  constructor(code) {
    const [status, message] = messages[code];
    super(message);
    this.name = "V10WalletCompatibilityError";
    this.code = code;
    this.status = status;
  }
}
const fail = (code = "V10_WALLET_INPUT") => {
  throw new V10WalletCompatibilityError(code);
};
const check = (ok, code) => {
  if (!ok) fail(code);
};
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const stable = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const bytes = (value) =>
  typeof value === "string" && /^0x(?:[a-f0-9]{2})*$/i.test(value);
const digest = (value) =>
  bytes(value) && value.length === 66 && !same(value, ethers.ZeroHash);
function exact(value, required, optional = []) {
  return (
    value &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every(
      (key) =>
        typeof key === "string" &&
        [...required, ...optional].includes(key) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
    )
  );
}
function address(value) {
  try {
    const result = ethers.getAddress(value);
    check(result !== ethers.ZeroAddress);
    return result;
  } catch {
    fail();
  }
}
function quantity(value) {
  check(
    typeof value === "bigint" ||
      (typeof value === "number" && Number.isSafeInteger(value)) ||
      (typeof value === "string" &&
        (/^(?:0|[1-9][0-9]*)$/.test(value) ||
          /^0x(?:0|[1-9a-f][a-f0-9]*)$/i.test(value))),
  );
  const result = BigInt(value);
  check(result >= 0n && result < 2n ** 256n);
  return result;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
const sha = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scopeKeys = [
  "contractVersion",
  "abiVersion",
  "chainId",
  "mode",
  "origin",
  "instanceId",
  "wallet",
  "eventId",
  "draftId",
  "action",
  "contract",
];
const actions = new Set([
  "deployContract",
  "createEvent",
  "deposit",
  "register",
  "reject",
  "postAttendance",
  "challenge",
  "match",
  "addAttendees",
  "resolve",
  "release",
  "cancel",
  "emergencyWithdraw",
  "claim",
  "withdrawPending",
  "refund",
  "returnToken",
  "sweep",
  "transferOwnership",
  "acceptOwnership",
  "upgradeToAndCall",
  "upgrade",
  "setEventImplementation",
  "cancelOwnershipTransfer",
  "renounceOwnership",
]);
function normalizedScope(scope) {
  check(
    exact(scope, scopeKeys) &&
      scope.contractVersion === V10_WALLET_PROFILE &&
      scope.abiVersion === V10_WALLET_PROFILE &&
      scope.chainId === 1 &&
      scope.mode === "hosted-production" &&
      [scope.instanceId, scope.eventId, scope.draftId].every(stable) &&
      actions.has(scope.action) &&
      typeof scope.origin === "string",
    "V10_WALLET_SCOPE",
  );
  let url;
  try {
    url = new URL(scope.origin);
  } catch {
    fail("V10_WALLET_SCOPE");
  }
  check(
    url.protocol === "https:" &&
      url.origin === scope.origin &&
      !url.username &&
      !url.password,
    "V10_WALLET_SCOPE",
  );
  const wallet = address(scope.wallet),
    contract = scope.contract === null ? null : address(scope.contract);
  check(
    (scope.action === "deployContract") === (contract === null),
    "V10_WALLET_SCOPE",
  );
  if (contract)
    check(
      !same(contract, wallet) &&
        !same(contract, METAMASK_V130.manager) &&
        !same(contract, METAMASK_V130.delegate),
      "V10_WALLET_SCOPE",
    );
  return freeze(
    Object.fromEntries(
      scopeKeys.map((key) => [
        key,
        key === "wallet" ? wallet : key === "contract" ? contract : scope[key],
      ]),
    ),
  );
}
const managerAbi = new ethers.Interface([
  "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)",
]);
const delegationType =
  "tuple(address delegate,address delegator,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]";
export const METAMASK_SELF_CONTEXT = ethers.AbiCoder.defaultAbiCoder().encode(
  [delegationType],
  [[]],
);
export const METAMASK_DELEGATION_DOMAIN = Object.freeze({
  name: "DelegationManager",
  version: "1",
  chainId: 1,
  verifyingContract: METAMASK_V130.manager,
});
export const METAMASK_DELEGATION_TYPES = freeze({
  Caveat: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
  ],
  Delegation: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "Caveat[]" },
    { name: "salt", type: "uint256" },
  ],
});
export const METAMASK_ROOT_AUTHORITY = "0x" + "ff".repeat(32);

function protectedSelfPermission(raw, intent, account) {
  check(account.nativeBalanceEnforcerPinned, "V10_WALLET_UNVERIFIED");
  let delegations;
  try {
    delegations = ethers.AbiCoder.defaultAbiCoder().decode(
      [delegationType],
      raw,
    )[0];
  } catch {
    fail("V10_PERMISSION_UNSUPPORTED");
  }
  check(
    delegations.length === 1 &&
      same(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [delegationType],
          [delegations],
        ),
        raw,
      ),
    "V10_PERMISSION_UNSUPPORTED",
  );
  const d = delegations[0],
    wallet = intent.call.from;
  check(
    same(d.delegate, wallet) &&
      same(d.delegator, wallet) &&
      same(d.authority, METAMASK_ROOT_AUTHORITY) &&
      d.caveats.length === 1 &&
      bytes(d.signature) &&
      ethers.getBytes(d.signature).length === 65,
    "V10_PERMISSION_UNSUPPORTED",
  );
  const c = d.caveats[0],
    terms = ethers.getBytes(c.terms),
    signature = ethers.getBytes(d.signature);
  check(
    same(c.enforcer, METAMASK_V130.nativeBalanceChangeEnforcer) &&
      c.args === "0x" &&
      terms.length === 53 &&
      terms[0] === 1 &&
      same(ethers.hexlify(terms.slice(1, 21)), wallet) &&
      BigInt(ethers.hexlify(terms.slice(21))).toString() ===
        intent.call.value &&
      [27, 28].includes(signature[64]),
    "V10_PERMISSION_UNSUPPORTED",
  );
  const value = {
    delegate: d.delegate,
    delegator: d.delegator,
    authority: d.authority,
    caveats: [{ enforcer: c.enforcer, terms: c.terms }],
    salt: d.salt,
  };
  let recovered;
  try {
    recovered = ethers.verifyTypedData(
      METAMASK_DELEGATION_DOMAIN,
      METAMASK_DELEGATION_TYPES,
      value,
      d.signature,
    );
  } catch {
    fail("V10_PERMISSION_UNSUPPORTED");
  }
  check(same(recovered, wallet), "V10_PERMISSION_UNSUPPORTED");
  return {
    kind: "protected-self-native-balance",
    delegationHash: ethers.TypedDataEncoder.hashStruct(
      "Delegation",
      METAMASK_DELEGATION_TYPES,
      value,
    ),
    signingDigest: ethers.TypedDataEncoder.hash(
      METAMASK_DELEGATION_DOMAIN,
      METAMASK_DELEGATION_TYPES,
      value,
    ),
    enforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
    maxDecreaseWei: intent.call.value,
    signatureMatched: true,
  };
}

/** Pins are trusted server configuration from an independent source/runtime review, never request input.
 * Matching pins identifies a candidate framework; it intentionally cannot switch financialEligible on.
 */
export function createV10WalletCompatibility({
  reviewedRuntimePins = null,
} = {}) {
  let pins = null;
  if (reviewedRuntimePins !== null) {
    const p = reviewedRuntimePins;
    check(
      exact(
        p,
        [
          "schemaVersion",
          "framework",
          "version",
          "chainId",
          "manager",
          "delegate",
          "managerRuntimeHash",
          "delegateRuntimeHash",
          "reviewId",
        ],
        ["nativeBalanceChangeEnforcer", "nativeBalanceChangeRuntimeHash"],
      ) &&
        p.schemaVersion === 1 &&
        p.framework === METAMASK_V130.framework &&
        p.version === METAMASK_V130.version &&
        p.chainId === 1 &&
        same(p.manager, METAMASK_V130.manager) &&
        same(p.delegate, METAMASK_V130.delegate) &&
        digest(p.managerRuntimeHash) &&
        digest(p.delegateRuntimeHash) &&
        /^[a-f0-9]{64}$/.test(p.reviewId) &&
        !/^0+$/.test(p.reviewId),
      "V10_WALLET_UNVERIFIED",
    );
    check(
      (p.nativeBalanceChangeEnforcer === undefined &&
        p.nativeBalanceChangeRuntimeHash === undefined) ||
        (same(
          p.nativeBalanceChangeEnforcer,
          METAMASK_V130.nativeBalanceChangeEnforcer,
        ) &&
          digest(p.nativeBalanceChangeRuntimeHash)),
      "V10_WALLET_UNVERIFIED",
    );
    pins = freeze({
      ...p,
      manager: METAMASK_V130.manager,
      delegate: METAMASK_V130.delegate,
      managerRuntimeHash: p.managerRuntimeHash.toLowerCase(),
      delegateRuntimeHash: p.delegateRuntimeHash.toLowerCase(),
    });
  }
  const accounts = new WeakSet(),
    intents = new WeakSet(),
    inspections = new WeakMap();
  function classifyAccount(input) {
    check(
      exact(
        input,
        ["scope", "walletCode"],
        [
          "delegateRuntimeCode",
          "managerRuntimeCode",
          "nativeBalanceChangeRuntimeCode",
        ],
      ),
    );
    const scope = normalizedScope(input.scope),
      code = input.walletCode;
    check(bytes(code));
    let kind = "unsupported-contract",
      delegationTarget = null,
      frameworkPinsMatched = false,
      nativeBalanceEnforcerPinned = false;
    if (code === "0x") kind = "eoa";
    else if (/^0xef0100[a-f0-9]{40}$/i.test(code)) {
      delegationTarget = address("0x" + code.slice(8));
      kind = same(delegationTarget, METAMASK_V130.delegate)
        ? "metamask-v1.3-delegated"
        : "unknown-delegation";
      if (
        kind === "metamask-v1.3-delegated" &&
        pins &&
        bytes(input.delegateRuntimeCode) &&
        bytes(input.managerRuntimeCode) &&
        input.delegateRuntimeCode !== "0x" &&
        input.managerRuntimeCode !== "0x"
      ) {
        frameworkPinsMatched =
          same(
            ethers.keccak256(input.delegateRuntimeCode),
            pins.delegateRuntimeHash,
          ) &&
          same(
            ethers.keccak256(input.managerRuntimeCode),
            pins.managerRuntimeHash,
          );
      }
      if (
        frameworkPinsMatched &&
        pins.nativeBalanceChangeRuntimeHash &&
        bytes(input.nativeBalanceChangeRuntimeCode) &&
        input.nativeBalanceChangeRuntimeCode !== "0x"
      )
        nativeBalanceEnforcerPinned = same(
          ethers.keccak256(input.nativeBalanceChangeRuntimeCode),
          pins.nativeBalanceChangeRuntimeHash,
        );
    }
    const result = freeze({
      schemaVersion: 1,
      kind,
      wallet: scope.wallet,
      scopeHash: sha(scope),
      walletCodeHash: ethers.keccak256(code),
      delegationTarget,
      frameworkPinsMatched,
      nativeBalanceEnforcerPinned,
      continueExistingEOAPath: kind === "eoa",
      financialEligible: false,
      prerequisites:
        kind === "eoa"
          ? [
              "existing-fresh-eoa-auth-and-draft-guards",
              "canonical-receipt-and-event-state-proof",
            ]
          : [...V10_DELEGATED_PREREQUISITES],
    });
    accounts.add(result);
    return result;
  }
  function canonicalIntent(input) {
    check(exact(input, ["scope", "transaction"]));
    const { scope: rawScope, transaction } = input;
    const scope = normalizedScope(rawScope);
    check(exact(transaction, ["from", "to", "data", "value", "chainId"]));
    const from = address(transaction.from),
      to = transaction.to === null ? null : address(transaction.to),
      value = quantity(transaction.value);
    check(
      same(from, scope.wallet) &&
        quantity(transaction.chainId) === 1n &&
        (to === null ? scope.contract === null : same(to, scope.contract)) &&
        bytes(transaction.data) &&
        (to !== null || transaction.data !== "0x"),
      "V10_INTENT_MISMATCH",
    );
    const intent = {
      schemaVersion: 1,
      scope,
      scopeHash: sha(scope),
      call: {
        from,
        to,
        value: value.toString(),
        data: transaction.data.toLowerCase(),
        chainId: 1,
      },
    };
    const result = freeze({
      ...intent,
      intentHash: sha(intent),
      financialEligible: false,
    });
    intents.add(result);
    return result;
  }
  function authorizationOf(tx, account) {
    const list = tx.authorizationList;
    if (tx.type !== 4) {
      check(
        list === undefined ||
          (Array.isArray(list) &&
            list.length === 0 &&
            Reflect.ownKeys(list).length === 1),
        "V10_AUTHORIZATION_UNKNOWN",
      );
      return false;
    }
    check(
      account.kind === "metamask-v1.3-delegated" &&
        Array.isArray(list) &&
        list.length === 1 &&
        Reflect.ownKeys(list).length === 2 &&
        Object.hasOwn(list, "0") &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(list, "0"), "value") &&
        tx.nonce !== undefined,
      "V10_AUTHORIZATION_UNKNOWN",
    );
    const auth = list[0];
    check(
      exact(auth, ["chainId", "address", "nonce", "yParity", "r", "s"]),
      "V10_AUTHORIZATION_UNKNOWN",
    );
    try {
      check(
        quantity(auth.chainId) === 1n &&
          same(auth.address, METAMASK_V130.delegate) &&
          quantity(auth.nonce) === quantity(tx.nonce) + 1n &&
          quantity(auth.nonce) < 2n ** 64n - 1n &&
          [0n, 1n].includes(quantity(auth.yParity)) &&
          digest(auth.r) &&
          digest(auth.s),
        "V10_AUTHORIZATION_UNKNOWN",
      );
      const signer = ethers.verifyAuthorization(
        {
          address: METAMASK_V130.delegate,
          chainId: 1n,
          nonce: quantity(auth.nonce),
        },
        { r: auth.r, s: auth.s, yParity: Number(quantity(auth.yParity)) },
      );
      check(same(signer, account.wallet), "V10_AUTHORIZATION_UNKNOWN");
    } catch {
      fail("V10_AUTHORIZATION_UNKNOWN");
    }
    return true;
  }
  function inspectTransactionIntent(input) {
    check(exact(input, ["intent", "account", "transaction"]));
    const { intent, account, transaction } = input;
    check(
      intents.has(intent) &&
        accounts.has(account) &&
        account.scopeHash === intent.scopeHash,
      "V10_WALLET_SCOPE",
    );
    check(
      exact(
        transaction,
        ["hash", "from", "to", "data", "value", "chainId", "type"],
        ["nonce", "authorizationList"],
      ) &&
        digest(transaction.hash) &&
        bytes(transaction.data),
    );
    const tx = {
      hash: transaction.hash.toLowerCase(),
      from: address(transaction.from),
      to: transaction.to === null ? null : address(transaction.to),
      data: transaction.data.toLowerCase(),
      value: quantity(transaction.value).toString(),
      chainId: Number(quantity(transaction.chainId)),
      type: Number(quantity(transaction.type)),
      ...(transaction.nonce === undefined
        ? {}
        : { nonce: quantity(transaction.nonce).toString() }),
      ...(transaction.authorizationList === undefined
        ? {}
        : { authorizationList: transaction.authorizationList }),
    };
    check(
      tx.chainId === 1 &&
        same(tx.from, intent.call.from) &&
        [0, 1, 2, 4].includes(tx.type),
      "V10_INTENT_MISMATCH",
    );
    check(
      account.kind === "eoa" || account.kind === "metamask-v1.3-delegated",
      "V10_WALLET_UNSUPPORTED",
    );
    if (account.kind !== "eoa")
      check(account.frameworkPinsMatched, "V10_WALLET_UNVERIFIED");
    const authorizationSignatureMatched = authorizationOf(tx, account);
    if (tx.authorizationList !== undefined)
      tx.authorizationList = structuredClone(tx.authorizationList);
    let route,
      permission = null;
    if (
      (tx.to === null && intent.call.to === null) ||
      same(tx.to, intent.call.to)
    ) {
      check(
        tx.data === intent.call.data && tx.value === intent.call.value,
        "V10_INTENT_MISMATCH",
      );
      route = "direct";
    } else {
      check(
        account.kind === "metamask-v1.3-delegated" &&
          same(tx.to, METAMASK_V130.manager) &&
          tx.value === "0" &&
          intent.call.to !== null,
        "V10_WALLET_UNSUPPORTED",
      );
      let decoded;
      try {
        decoded = managerAbi.decodeFunctionData("redeemDelegations", tx.data);
      } catch {
        fail("V10_INTENT_MISMATCH");
      }
      check(
        decoded[0].length === 1 &&
          decoded[1].length === 1 &&
          decoded[2].length === 1 &&
          decoded[1][0] === ethers.ZeroHash &&
          same(
            managerAbi.encodeFunctionData("redeemDelegations", decoded),
            tx.data,
          ),
        "V10_INTENT_MISMATCH",
      );
      const execution = ethers.getBytes(decoded[2][0]);
      check(
        execution.length >= 52 &&
          same(ethers.hexlify(execution.slice(0, 20)), intent.call.to) &&
          BigInt(ethers.hexlify(execution.slice(20, 52))).toString() ===
            intent.call.value &&
          ethers.hexlify(execution.slice(52)).toLowerCase() ===
            intent.call.data,
        "V10_INTENT_MISMATCH",
      );
      if (same(decoded[0][0], METAMASK_SELF_CONTEXT)) {
        permission = { kind: "empty-self" };
        route = "metamask-manager-self-single";
      } else {
        permission = protectedSelfPermission(decoded[0][0], intent, account);
        route = "metamask-manager-protected-self-single";
      }
    }
    const result = freeze({
      schemaVersion: 1,
      route,
      intentMatched: true,
      intentHash: intent.intentHash,
      scopeHash: intent.scopeHash,
      outerHash: tx.hash,
      outerTransaction: tx,
      authorizationSignatureMatched,
      permission,
      protocolAuthorizationApplied: false,
      receiptVerified: false,
      financialEligible: false,
      prerequisites:
        account.kind === "eoa"
          ? [...account.prerequisites]
          : [...V10_DELEGATED_PREREQUISITES],
    });
    inspections.set(result, intent);
    return result;
  }
  /** Matches a sealed analysis to a verifier's expected call without fabricating a direct transaction.
   * verified means exact intent equality only. The caller still owns canonical/raw transaction,
   * receipt, birth/source, account freshness, auth and every financial signing prerequisite.
   */
  function factualIntentProof(input) {
    check(exact(input, ["inspection", "expected"]));
    const { inspection, expected } = input,
      intent = inspections.get(inspection);
    check(
      intent &&
        exact(expected, [
          "chainId",
          "transactionHash",
          "from",
          "to",
          "valueWei",
          "data",
        ]),
      "V10_WALLET_SCOPE",
    );
    check(
      quantity(expected.chainId) === 1n &&
        same(expected.transactionHash, inspection.outerHash) &&
        same(expected.from, intent.call.from) &&
        (expected.to === null
          ? intent.call.to === null
          : same(expected.to, intent.call.to)) &&
        quantity(expected.valueWei).toString() === intent.call.value &&
        bytes(expected.data) &&
        same(expected.data, intent.call.data),
      "V10_INTENT_MISMATCH",
    );
    return freeze({
      verified: true,
      chainId: 1,
      transactionHash: inspection.outerHash,
      from: intent.call.from,
      to: intent.call.to,
      valueWei: intent.call.value,
      dataHash: ethers.keccak256(intent.call.data),
    });
  }
  return Object.freeze({
    classifyAccount,
    canonicalIntent,
    inspectTransactionIntent,
    factualIntentProof,
  });
}
