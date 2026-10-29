// Private saved-review binding for V10 factual transaction inspection.
// This module grants no signing, session, role, receipt-effect or execution authority.
import { ethers } from "ethers";
import { hash } from "./utils.mjs";
import { createV10ProductionWallets } from "./v10-production-wallets.mjs";

const PROFILE = "kleros-event-v10-uups";
const SCOPE_KEYS = [
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
  "manifestHash",
];
const EXPECTED_KEYS = [
  "chainId",
  "transactionHash",
  "from",
  "to",
  "valueWei",
  "data",
];
const PROOF_KEYS = [
  "verified",
  "chainId",
  "transactionHash",
  "from",
  "to",
  "valueWei",
  "dataHash",
];
const REVIEW_KEYS = [
  "scopeKind",
  "id",
  "eventId",
  "eventKey",
  "wallet",
  "sessionId",
  "instanceId",
  "origin",
  "chainId",
  "contractVersion",
  "abiVersion",
  "mode",
  "action",
  "contract",
  "factory",
  "valueWei",
  "method",
  "args",
  "params",
  "terms",
  "config",
  "template",
  "transaction",
  "factorySource",
  "policyText",
  "factoryFingerprint",
  "registryHash",
  "snapshot",
  "revision",
  "summary",
  "createdAt",
  "expiresAt",
  "reviewBlock",
];
const TRANSACTION_KEYS = [
  "hash",
  "chainId",
  "from",
  "to",
  "value",
  "data",
  "nonce",
  "blockHash",
  "blockNumber",
  "type",
  "authorizationList",
  "accessList",
  "signature",
  "gasLimit",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "maxFeePerBlobGas",
  "blobVersionedHashes",
];
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const check = (ok, code = "V10_RECEIPT_CONTEXT_SCOPE") => {
  if (!ok)
    throw Object.assign(
      new Error("The transaction is outside its original private V10 review"),
      { code, status: 409 },
    );
};
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every(
    (key) =>
      Object.hasOwn(value, key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
  );
const selected = (value, keys) =>
  Object.fromEntries(keys.map((key) => [key, value[key]]));
const transactionSnapshot = (value) => hash(selected(value, TRANSACTION_KEYS));
const reviewHash = (draft, scope) =>
  hash({ scope, review: selected(draft, REVIEW_KEYS) });
const identifier = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const bytes = (value) =>
  typeof value === "string" &&
  ethers.isHexString(value) &&
  value.length % 2 === 0;
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function freeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/**
 * All inputs and optional dependencies are trusted Node code, never HTTP/manifest callbacks.
 * @param {{chain:any,origin:string,instanceId:string,drafts:Map<string,any>}} input
 * @param {{walletsFactory?:Function}} trustedTestDeps
 */
export function createV10ReceiptContext(input, trustedTestDeps = {}) {
  check(
    exact(input, ["chain", "origin", "instanceId", "drafts"]) &&
      exact(
        trustedTestDeps,
        Object.hasOwn(trustedTestDeps, "walletsFactory")
          ? ["walletsFactory"]
          : [],
      ),
  );
  const { chain, origin, instanceId, drafts } = input;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {}
  check(
    chain?.production === true &&
      chain.chainId === 1 &&
      chain.manifest &&
      chain.manifest.factoryDeployment?.contractVersion === PROFILE &&
      chain.manifest.factoryDeployment?.abiVersion === PROFILE &&
      drafts instanceof Map &&
      parsed?.protocol === "https:" &&
      parsed.origin === origin &&
      !parsed.username &&
      !parsed.password &&
      identifier(instanceId),
  );
  const manifestHash = hash(chain.manifest),
    policies = new Map();
  const walletsFactory =
    trustedTestDeps.walletsFactory ?? createV10ProductionWallets;
  check(typeof walletsFactory === "function");
  function policy(originalInstance) {
    check(
      identifier(originalInstance) && hash(chain.manifest) === manifestHash,
    );
    if (!policies.has(originalInstance))
      policies.set(
        originalInstance,
        walletsFactory({ chain, origin, instanceId: originalInstance }),
      );
    return policies.get(originalInstance);
  }
  function saved(draft) {
    check(
      draft &&
        drafts.get(draft.id) === draft &&
        identifier(draft.id) &&
        identifier(draft.eventId) &&
        identifier(draft.instanceId) &&
        ["factory-create", "event-call"].includes(draft.scopeKind) &&
        draft.origin === origin &&
        draft.chainId === 1 &&
        draft.mode === "hosted-production" &&
        draft.contractVersion === PROFILE &&
        draft.abiVersion === PROFILE &&
        ethers.isAddress(draft.wallet) &&
        typeof draft.action === "string" &&
        draft.action.length > 0 &&
        typeof draft.method === "string" &&
        draft.method.length > 0 &&
        ethers.isAddress(draft.transaction?.to) &&
        draft.transaction.to !== ethers.ZeroAddress &&
        same(draft.transaction.from, draft.wallet) &&
        ethers.isAddress(draft.contract) &&
        draft.contract !== ethers.ZeroAddress &&
        (draft.scopeKind === "event-call" ||
          same(draft.contract, draft.transaction.to)) &&
        draft.transaction.chainId === 1 &&
        bytes(draft.transaction.data) &&
        typeof draft.transaction.value === "string" &&
        /^(0|[1-9][0-9]*)$/.test(draft.transaction.value) &&
        draft.valueWei === draft.transaction.value &&
        Number.isSafeInteger(draft.createdAt) &&
        Number.isSafeInteger(draft.expiresAt) &&
        draft.expiresAt > draft.createdAt &&
        Number.isSafeInteger(draft.reviewBlock) &&
        draft.reviewBlock > 0 &&
        digest(draft.registryHash) &&
        hash(chain.manifest) === manifestHash,
    );
    return {
      contractVersion: PROFILE,
      abiVersion: PROFILE,
      chainId: 1,
      mode: "hosted-production",
      origin,
      instanceId: draft.instanceId,
      wallet: draft.wallet,
      eventId: draft.eventId,
      draftId: draft.id,
      action: draft.action,
      contract: draft.transaction.to,
      manifestHash,
    };
  }
  function sealed(draft) {
    const scope = saved(draft),
      seal = draft.v10Intent;
    check(
      exact(seal, ["scope", "reviewHash"]) &&
        exact(seal.scope, SCOPE_KEYS) &&
        hash(seal.scope) === hash(scope) &&
        digest(seal.reviewHash) &&
        seal.reviewHash === reviewHash(draft, scope),
      "V10_RECEIPT_CONTEXT_CHANGED",
    );
    return scope;
  }
  function sealDraft(draft) {
    const scope = saved(draft);
    if (Object.hasOwn(draft, "v10Intent")) {
      sealed(draft);
      return draft.v10Intent;
    }
    check(
      draft.instanceId === instanceId &&
        !draft.submittedHash &&
        !draft.confirmedHash &&
        !draft.used &&
        draft.expiresAt > Date.now(),
      "V10_RECEIPT_CONTEXT_UNSEALED",
    );
    const seal = freeze({ scope, reviewHash: reviewHash(draft, scope) });
    // Persistence may deserialize this property; every factual use re-verifies its complete hash.
    draft.v10Intent = seal;
    return seal;
  }
  function expectedFor(draft, transactionHash) {
    sealed(draft);
    check(
      ethers.isHexString(transactionHash, 32),
      "V10_RECEIPT_CONTEXT_MISMATCH",
    );
    const known = [draft.submittedHash, draft.confirmedHash].filter(
      (value) => value != null,
    );
    check(
      known.length > 0 && known.every((value) => same(value, transactionHash)),
      "V10_RECEIPT_CONTEXT_UNKNOWN_HASH",
    );
    return freeze({
      chainId: 1,
      transactionHash,
      from: draft.transaction.from,
      to: draft.transaction.to,
      valueWei: draft.transaction.value,
      data: draft.transaction.data,
    });
  }
  function proofMatches(proof, expected) {
    return (
      exact(proof, PROOF_KEYS) &&
      proof.verified === true &&
      proof.chainId === 1 &&
      same(proof.transactionHash, expected.transactionHash) &&
      same(proof.from, expected.from) &&
      same(proof.to, expected.to) &&
      proof.valueWei === expected.valueWei &&
      proof.dataHash === ethers.keccak256(expected.data)
    );
  }
  function uniqueHashOwner(draft, transactionHash) {
    const matches = [...drafts.values()].filter(
      (candidate) =>
        same(candidate?.submittedHash, transactionHash) ||
        same(candidate?.confirmedHash, transactionHash),
    );
    check(
      matches.length === 1 && matches[0] === draft,
      matches.length > 1
        ? "V10_RECEIPT_CONTEXT_AMBIGUOUS"
        : "V10_RECEIPT_CONTEXT_UNKNOWN_HASH",
    );
  }
  async function inspectDraftTransaction(
    draft,
    actual,
    options = { canonical: true },
  ) {
    check(
      exact(options, ["canonical"]) && typeof options.canonical === "boolean",
    );
    const scope = freeze(sealed(draft)),
      expected = expectedFor(draft, actual?.hash),
      before = transactionSnapshot(actual),
      savedSeal = hash(draft.v10Intent);
    uniqueHashOwner(draft, expected.transactionHash);
    const inspector = policy(scope.instanceId),
      method = options.canonical
        ? "inspectReviewedTransaction"
        : "inspectSubmittedTransaction";
    check(typeof inspector?.[method] === "function");
    let proof;
    try {
      proof = await inspector[method]({ scope, actual, expected });
    } finally {
      check(
        transactionSnapshot(actual) === before,
        "V10_RECEIPT_CONTEXT_MUTATED",
      );
      sealed(draft);
      check(
        hash(draft.v10Intent) === savedSeal &&
          hash(expectedFor(draft, expected.transactionHash)) === hash(expected),
        "V10_RECEIPT_CONTEXT_CHANGED",
      );
      uniqueHashOwner(draft, expected.transactionHash);
    }
    check(proofMatches(proof, expected), "V10_RECEIPT_CONTEXT_PROOF");
    return freeze({ ...proof });
  }
  async function assertTransactionIntent(actual, expected) {
    check(
      exact(expected, EXPECTED_KEYS) &&
        expected.chainId === 1 &&
        ethers.isHexString(expected.transactionHash, 32) &&
        same(actual?.hash, expected.transactionHash),
      "V10_RECEIPT_CONTEXT_MISMATCH",
    );
    const matches = [];
    for (const draft of drafts.values()) {
      if (
        !same(draft?.submittedHash, actual.hash) &&
        !same(draft?.confirmedHash, actual.hash)
      )
        continue;
      // A hash belonging to an invalid or foreign review fails closed, rather than being ignored.
      const own = expectedFor(draft, actual.hash);
      check(
        same(own.from, expected.from) &&
          same(own.to, expected.to) &&
          own.valueWei === expected.valueWei &&
          own.data === expected.data,
        "V10_RECEIPT_CONTEXT_MISMATCH",
      );
      matches.push(draft);
    }
    check(
      matches.length === 1,
      matches.length > 1
        ? "V10_RECEIPT_CONTEXT_AMBIGUOUS"
        : "V10_RECEIPT_CONTEXT_UNKNOWN_HASH",
    );
    return inspectDraftTransaction(matches[0], actual, { canonical: true });
  }
  return Object.freeze({
    sealDraft,
    inspectDraftTransaction,
    assertTransactionIntent,
    assertWallet: (...args) => policy(instanceId).assertWallet(...args),
    classifyWallet: (...args) => policy(instanceId).classifyWallet(...args),
  });
}
