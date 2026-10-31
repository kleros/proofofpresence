// Private saved-review binding for V10 factual transaction inspection.
// This module grants no signing, session, role, receipt-effect or execution authority.
import { ethers } from "ethers";
import { hash } from "./utils.mjs";
import { createV10ProductionWallets } from "./v10-production-wallets.mjs";

const PROFILE = "kleros-event-v10-uups";
// Source-reviewed, one-way receipt history only. These origins never authorize
// a fresh review/signature and are not configurable through HTTP or environment.
export const V10_HISTORICAL_RECEIPT_ORIGINS = Object.freeze({
  "https://kleros-kickback.netlify.app": Object.freeze(["https://kleros-luma-v10-ethereum.netlify.app"]),
  "https://kickback.kleros.io": Object.freeze(["https://kleros-luma-v10-ethereum.netlify.app", "https://kleros-kickback.netlify.app"]),
});
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
const SUBMISSION_KEYS = [
  "hash",
  "wallet",
  "nonce",
  "reviewBlock",
  "type",
  "to",
  "valueWei",
  "dataHash",
  "gasLimit",
  "accessListHash",
];
const REPLACEMENT_KEYS = [
  "verified",
  "kind",
  "chainId",
  "originalHash",
  "hash",
  "wallet",
  "nonce",
  "blockNumber",
  "blockHash",
  "gasUsed",
  "gasPriceWei",
  "feeWei",
  "type",
  "to",
  "valueWei",
  "dataHash",
  "gasLimit",
  "accessListHash",
  "accountType",
  "anchor",
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
const transactionHash = (value) =>
  ethers.isHexString(value, 32) && value !== ethers.ZeroHash;
const decimal = (value, positive = false) =>
  typeof value === "string" &&
  value.length <= 78 &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  BigInt(value) < 2n ** 256n &&
  (!positive || BigInt(value) > 0n);
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
  const historicalOrigin = candidate => V10_HISTORICAL_RECEIPT_ORIGINS[origin]?.includes(candidate) === true;
  function policy(originalInstance, originalOrigin = origin) {
    check(
      identifier(originalInstance) && (originalOrigin === origin || historicalOrigin(originalOrigin)) && hash(chain.manifest) === manifestHash,
    );
    const key = JSON.stringify([originalOrigin, originalInstance]);
    if (!policies.has(key))
      policies.set(
        key,
        walletsFactory({ chain, origin: originalOrigin, instanceId: originalInstance }),
      );
    return policies.get(key);
  }
  function saved(draft) {
    check(
      draft &&
        drafts.get(draft.id) === draft &&
        identifier(draft.id) &&
        identifier(draft.eventId) &&
        identifier(draft.instanceId) &&
        ["factory-create", "event-call"].includes(draft.scopeKind) &&
        (draft.origin === origin || (historicalOrigin(draft.origin) &&
          Object.hasOwn(draft, "v10Intent") && [draft.submittedHash, draft.confirmedHash].some(transactionHash))) &&
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
      origin: draft.origin,
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
      draft.origin === origin && draft.instanceId === instanceId &&
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
  function factoryWitness(draft) {
    sealed(draft);
    const witness = draft.submissionWitness;
    check(
      draft.scopeKind === "factory-create" &&
        draft.action === "createEvent" &&
        draft.method === "createEvent" &&
        draft.valueWei === "0" &&
        exact(witness, SUBMISSION_KEYS) &&
        transactionHash(witness.hash) &&
        same(witness.hash, draft.submittedHash) &&
        same(witness.wallet, draft.wallet) &&
        Number.isSafeInteger(witness.nonce) &&
        witness.nonce >= 0 &&
        witness.reviewBlock === draft.reviewBlock &&
        witness.type === 2 &&
        ethers.isAddress(witness.to) &&
        witness.to !== ethers.ZeroAddress &&
        witness.valueWei === "0" &&
        transactionHash(witness.dataHash) &&
        decimal(witness.gasLimit, true) &&
        digest(witness.accessListHash),
      "V10_FACTORY_SUBMISSION_CHANGED",
    );
    return witness;
  }
  function sealedFactorySubmission(draft) {
    const witness = factoryWitness(draft),
      seal = draft.v10Submission;
    check(
      exact(seal, ["reviewHash", "witnessHash"]) &&
        seal.reviewHash === draft.v10Intent.reviewHash &&
        digest(seal.witnessHash) &&
        seal.witnessHash === hash(witness),
      "V10_FACTORY_SUBMISSION_CHANGED",
    );
    return witness;
  }
  function sealFactorySubmission(draft) {
    const witness = factoryWitness(draft);
    if (Object.hasOwn(draft, "v10Submission")) {
      sealedFactorySubmission(draft);
      return draft.v10Submission;
    }
    check(
      draft.origin === origin && !draft.used &&
        !draft.confirmedHash &&
        !draft.replacement &&
        !draft.v10Replacement,
      "V10_FACTORY_SUBMISSION_UNSEALED",
    );
    uniqueHashOwner(draft, witness.hash);
    const seal = freeze({
      reviewHash: draft.v10Intent.reviewHash,
      witnessHash: hash(witness),
    });
    draft.v10Submission = seal;
    return seal;
  }
  function factoryReplacement(draft) {
    const witness = sealedFactorySubmission(draft),
      evidence = draft.replacement;
    const accountType =
      evidence && Object.getOwnPropertyDescriptor(evidence, "accountType");
    const delegated =
      accountType &&
      Object.hasOwn(accountType, "value") &&
      accountType.value === "metamask-protected-self-v1.3";
    check(
      exact(
        evidence,
        delegated
          ? [...REPLACEMENT_KEYS, "delegateCodeHash"]
          : REPLACEMENT_KEYS,
      ) &&
        evidence.verified === true &&
        evidence.kind === "same-call-fee-replacement" &&
        evidence.chainId === 1 &&
        transactionHash(evidence.hash) &&
        !same(evidence.hash, witness.hash) &&
        same(evidence.originalHash, witness.hash) &&
        same(evidence.wallet, witness.wallet) &&
        evidence.nonce === witness.nonce &&
        evidence.type === witness.type &&
        same(evidence.to, witness.to) &&
        evidence.valueWei === witness.valueWei &&
        same(evidence.dataHash, witness.dataHash) &&
        evidence.gasLimit === witness.gasLimit &&
        evidence.accessListHash === witness.accessListHash &&
        Number.isSafeInteger(evidence.blockNumber) &&
        evidence.blockNumber > witness.reviewBlock &&
        transactionHash(evidence.blockHash) &&
        decimal(evidence.gasUsed, true) &&
        BigInt(evidence.gasUsed) <= BigInt(witness.gasLimit) &&
        decimal(evidence.gasPriceWei) &&
        decimal(evidence.feeWei) &&
        BigInt(evidence.feeWei) ===
          BigInt(evidence.gasUsed) * BigInt(evidence.gasPriceWei) &&
        exact(evidence.anchor, ["blockNumber", "blockHash"]) &&
        Number.isSafeInteger(evidence.anchor.blockNumber) &&
        evidence.anchor.blockNumber >= evidence.blockNumber &&
        transactionHash(evidence.anchor.blockHash) &&
        (evidence.anchor.blockNumber !== evidence.blockNumber ||
          same(evidence.anchor.blockHash, evidence.blockHash)) &&
        (evidence.accountType === "eoa" || delegated) &&
        (!delegated ||
          same(
            evidence.delegateCodeHash,
            "0x0b77e469f5603ed1e9ff0e7ee56238b61a8cf7cb3185b33e53e2eeaad50109ab",
          )) &&
        (!draft.confirmedHash || same(draft.confirmedHash, evidence.hash)),
      "V10_FACTORY_REPLACEMENT_CHANGED",
    );
    return evidence;
  }
  function sealedFactoryReplacement(draft) {
    const evidence = factoryReplacement(draft),
      seal = draft.v10Replacement;
    check(
      exact(seal, ["reviewHash", "witnessHash", "replacementHash"]) &&
        seal.reviewHash === draft.v10Intent.reviewHash &&
        seal.witnessHash === draft.v10Submission.witnessHash &&
        digest(seal.replacementHash) &&
        seal.replacementHash === hash(evidence),
      "V10_FACTORY_REPLACEMENT_CHANGED",
    );
    return evidence;
  }
  function sealFactoryReplacement(draft) {
    const evidence = factoryReplacement(draft);
    if (Object.hasOwn(draft, "v10Replacement")) {
      sealedFactoryReplacement(draft);
      return draft.v10Replacement;
    }
    check(
      draft.origin === origin && !draft.used && !draft.confirmedHash,
      "V10_FACTORY_REPLACEMENT_UNSEALED",
    );
    uniqueHashOwner(draft, evidence.originalHash);
    uniqueHashOwner(draft, evidence.hash);
    const seal = freeze({
      reviewHash: draft.v10Intent.reviewHash,
      witnessHash: draft.v10Submission.witnessHash,
      replacementHash: hash(evidence),
    });
    draft.v10Replacement = seal;
    return seal;
  }
  function replacementFor(draft, txHash) {
    if (
      draft.scopeKind !== "factory-create" ||
      (!draft.replacement && !draft.v10Replacement)
    )
      return null;
    const evidence = sealedFactoryReplacement(draft);
    return same(evidence.hash, txHash) ? evidence : null;
  }
  function expectedFor(draft, transactionHash) {
    sealed(draft);
    if (
      draft.scopeKind === "factory-create" &&
      (draft.submissionWitness || draft.v10Submission)
    )
      sealedFactorySubmission(draft);
    check(
      ethers.isHexString(transactionHash, 32),
      "V10_RECEIPT_CONTEXT_MISMATCH",
    );
    const known = [draft.submittedHash, draft.confirmedHash].filter(
      (value) => value != null,
    );
    const alias = replacementFor(draft, transactionHash);
    check(
      alias ||
        (known.length > 0 &&
          known.every((value) => same(value, transactionHash))) ||
        (draft.scopeKind === "factory-create" &&
          draft.replacement &&
          same(draft.submittedHash, transactionHash) &&
          (!draft.confirmedHash ||
            same(draft.confirmedHash, draft.replacement.hash))),
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
        same(candidate?.confirmedHash, transactionHash) ||
        same(candidate?.submissionWitness?.hash, transactionHash) ||
        same(candidate?.replacement?.hash, transactionHash) ||
        same(candidate?.replacement?.originalHash, transactionHash),
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
      savedSeal = hash(draft.v10Intent),
      replacement = replacementFor(draft, actual?.hash),
      savedReplacement = replacement
        ? hash([
            draft.submissionWitness,
            draft.v10Submission,
            draft.replacement,
            draft.v10Replacement,
          ])
        : null;
    uniqueHashOwner(draft, expected.transactionHash);
    if (replacement) {
      const witness = sealedFactorySubmission(draft);
      check(
        options.canonical &&
          actual.nonce === witness.nonce &&
          actual.type === witness.type &&
          same(actual.from, witness.wallet) &&
          same(actual.to, witness.to) &&
          String(actual.value) === witness.valueWei &&
          bytes(actual.data) &&
          same(ethers.keccak256(actual.data), witness.dataHash) &&
          String(actual.gasLimit) === witness.gasLimit &&
          hash(actual.accessList ?? []) === witness.accessListHash &&
          actual.blockNumber === replacement.blockNumber &&
          same(actual.blockHash, replacement.blockHash),
        "V10_FACTORY_REPLACEMENT_MISMATCH",
      );
      uniqueHashOwner(draft, witness.hash);
    }
    const inspector = policy(scope.instanceId, scope.origin),
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
      if (replacement) {
        check(
          hash([
            draft.submissionWitness,
            draft.v10Submission,
            draft.replacement,
            draft.v10Replacement,
          ]) === savedReplacement,
          "V10_FACTORY_REPLACEMENT_CHANGED",
        );
        uniqueHashOwner(draft, draft.submissionWitness.hash);
      }
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
        !same(draft?.confirmedHash, actual.hash) &&
        !same(draft?.replacement?.hash, actual.hash) &&
        !same(draft?.submissionWitness?.hash, actual.hash)
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
    sealFactorySubmission,
    sealFactoryReplacement,
    inspectDraftTransaction,
    assertTransactionIntent,
    assertWallet: (...args) => policy(instanceId).assertWallet(...args),
    classifyWallet: (...args) => policy(instanceId).classifyWallet(...args),
  });
}
