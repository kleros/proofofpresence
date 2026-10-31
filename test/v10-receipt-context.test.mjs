// Offline private-map/proof boundary tests; no RPC, signing, wallet file or broadcast.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { createV10ReceiptContext } from "../src/v10-receipt-context.mjs";

const PROFILE = "kleros-event-v10-uups",
  origin = "https://receipt.example.invalid";
const wallet = "0x1111111111111111111111111111111111111111",
  target = "0x2222222222222222222222222222222222222222";
const txHash = ethers.id("synthetic-known-v10-transaction"),
  blockHash = ethers.id("synthetic-canonical-header");
const manifest = {
  factoryDeployment: {
    factory: target,
    contractVersion: PROFILE,
    abiVersion: PROFILE,
  },
};
const proofFor = (expected) => ({
  verified: true,
  chainId: 1,
  transactionHash: expected.transactionHash,
  from: expected.from,
  to: expected.to,
  valueWei: expected.valueWei,
  dataHash: ethers.keccak256(expected.data),
});
function draft(id = "draft-one", overrides = {}) {
  const createdAt = Date.now();
  return {
    id,
    eventId: "event-one",
    scopeKind: "event-call",
    wallet,
    sessionId: "session-original",
    instanceId: "instance-original",
    origin,
    chainId: 1,
    contractVersion: PROFILE,
    abiVersion: PROFILE,
    mode: "hosted-production",
    action: "deposit",
    contract: target,
    valueWei: "1000",
    method: "deposit",
    args: [],
    params: {},
    reviewBlock: 10,
    createdAt,
    expiresAt: createdAt + 300000,
    registryHash: hash("deployment"),
    snapshot: hash("financial-review"),
    transaction: {
      from: wallet,
      to: target,
      data: "0xd0e30db0",
      value: "1000",
      chainId: 1,
      gasLimit: "100000",
    },
    ...overrides,
  };
}
function actual(overrides = {}) {
  return {
    hash: txHash,
    chainId: 1n,
    from: wallet,
    to: target,
    value: 1000n,
    data: "0xd0e30db0",
    nonce: 3,
    blockHash,
    blockNumber: 20,
    type: 2,
    authorizationList: null,
    accessList: [],
    signature: { r: "0x01", s: "0x02", v: 27 },
    gasLimit: 100000n,
    gasPrice: 10n,
    maxFeePerGas: 10n,
    maxPriorityFeePerGas: 1n,
    maxFeePerBlobGas: null,
    blobVersionedHashes: null,
    ...overrides,
  };
}
function fixture({
  transform = async (input) => proofFor(input.expected),
  instanceId = "instance-original",
  savedDraft = draft(),
} = {}) {
  const drafts = new Map([[savedDraft.id, savedDraft]]),
    calls = [],
    policies = [],
    chain = {
      production: true,
      chainId: 1,
      manifest: structuredClone(manifest),
      provider: {
        send() {
          assert.fail("Unexpected RPC");
        },
      },
    };
  const walletsFactory = ({ instanceId, origin: configuredOrigin }) => {
    policies.push({ instanceId, origin: configuredOrigin });
    return {
      async inspectReviewedTransaction(input) {
        calls.push({ kind: "canonical", instanceId, input });
        return transform(input);
      },
      async inspectSubmittedTransaction(input) {
        calls.push({ kind: "submitted", instanceId, input });
        return transform(input);
      },
      assertWallet(address) {
        calls.push({ kind: "signing", instanceId });
        return { wallet: address, financialEligible: false };
      },
      classifyWallet(address) {
        calls.push({ kind: "classification", instanceId });
        return { wallet: address, financialEligible: false };
      },
    };
  };
  const options = { chain, origin, instanceId, drafts },
    deps = { walletsFactory };
  return {
    drafts,
    chain,
    d: savedDraft,
    calls,
    policies,
    options,
    deps,
    context: createV10ReceiptContext(options, deps),
  };
}
function journal(f) {
  f.context.sealDraft(f.d);
  f.d.submittedHash = txHash;
  return f;
}
const rejects = (action, code) => assert.rejects(action, { code });

test("seal binds exact private V10 review and immutable twelve-field original scope", async () => {
  const f = fixture(),
    seal = f.context.sealDraft(f.d);
  assert.equal(Object.keys(seal.scope).length, 12);
  assert.equal(seal.scope.manifestHash, hash(f.chain.manifest));
  assert.equal(seal.scope.contract, f.d.transaction.to);
  assert.equal(seal.scope.instanceId, "instance-original");
  assert.ok(Object.isFrozen(seal) && Object.isFrozen(seal.scope));
  assert.equal(f.context.sealDraft(f.d), seal);
  assert.equal(f.calls.length, 0);
  assert.throws(() => f.context.sealDraft({ ...f.d }), {
    code: "V10_RECEIPT_CONTEXT_SCOPE",
  });
  assert.throws(
    () => createV10ReceiptContext({ ...f.options, activation: true }),
    { code: "V10_RECEIPT_CONTEXT_SCOPE" },
  );
  assert.throws(
    () =>
      createV10ReceiptContext({
        ...f.options,
        origin: "http://receipt.example.invalid",
      }),
    { code: "V10_RECEIPT_CONTEXT_SCOPE" },
  );
});

test("unsealed, unknown or conflicting hash is denied before any policy call", async () => {
  const f = fixture();
  f.d.submittedHash = txHash;
  await rejects(
    () => f.context.inspectDraftTransaction(f.d, actual()),
    "V10_RECEIPT_CONTEXT_CHANGED",
  );
  delete f.d.submittedHash;
  f.context.sealDraft(f.d);
  await rejects(
    () => f.context.inspectDraftTransaction(f.d, actual()),
    "V10_RECEIPT_CONTEXT_UNKNOWN_HASH",
  );
  f.d.submittedHash = ethers.id("other-hash");
  await rejects(
    () => f.context.inspectDraftTransaction(f.d, actual()),
    "V10_RECEIPT_CONTEXT_UNKNOWN_HASH",
  );
  f.d.submittedHash = txHash;
  f.d.confirmedHash = ethers.id("changed-terminal-hash");
  await rejects(
    () => f.context.inspectDraftTransaction(f.d, actual()),
    "V10_RECEIPT_CONTEXT_UNKNOWN_HASH",
  );
  assert.equal(f.calls.length, 0);
});

test("event-call preserves its original event while inspecting a reviewed resolver target", async () => {
  const resolver = "0x3333333333333333333333333333333333333333";
  const d = draft("resolver-review", {
    action: "fundAppeal",
    method: "fundAppeal",
    args: ["2", "1"],
    transaction: {
      from: wallet,
      to: resolver,
      data: "0xabcdef",
      value: "1000",
      chainId: 1,
    },
  });
  const f = journal(fixture({ savedDraft: d }));
  assert.equal(f.d.contract, target);
  assert.equal(f.d.v10Intent.scope.contract, resolver);
  const tx = actual({ to: resolver, data: "0xabcdef" });
  assert.equal((await f.context.inspectDraftTransaction(d, tx)).to, resolver);
  assert.equal(f.calls[0].input.expected.to, resolver);
  d.contract = "0x4444444444444444444444444444444444444444";
  const before = f.calls.length;
  await rejects(
    () => f.context.inspectDraftTransaction(d, tx),
    "V10_RECEIPT_CONTEXT_CHANGED",
  );
  assert.equal(f.calls.length, before);
});

test("factory-create keeps exact target identity and unknown scope kinds cannot be sealed", () => {
  const valid = fixture({
    savedDraft: draft("factory-review", {
      scopeKind: "factory-create",
      action: "createEvent",
      method: "createEvent",
    }),
  });
  assert.equal(valid.context.sealDraft(valid.d).scope.contract, target);
  for (const overrides of [
    { scopeKind: "unknown" },
    { scopeKind: "event-transaction" },
    { scopeKind: "factory-create", contract: wallet },
    { scopeKind: "event-call", contract: ethers.ZeroAddress },
  ]) {
    const f = fixture({ savedDraft: draft("invalid-review", overrides) });
    assert.throws(() => f.context.sealDraft(f.d), {
      code: "V10_RECEIPT_CONTEXT_SCOPE",
    });
    assert.equal(f.calls.length, 0);
  }
});

test("private expected intent handles wrapper outer fields without rewriting transaction or granting authority", async () => {
  const f = journal(fixture()),
    tx = actual({
      to: "0x3333333333333333333333333333333333333333",
      data: "0xabcdef",
      value: 0n,
      type: 4,
    });
  const before = hash(tx),
    proof = await f.context.inspectDraftTransaction(f.d, tx, {
      canonical: false,
    });
  assert.equal(hash(tx), before);
  assert.deepEqual(proof, proofFor(f.calls[0].input.expected));
  assert.equal(f.calls[0].kind, "submitted");
  assert.equal(f.calls[0].input.actual, tx);
  assert.equal(f.calls[0].input.expected.to, target);
  assert.equal(f.calls[0].input.expected.data, "0xd0e30db0");
  assert.equal(f.calls[0].input.expected.valueWei, "1000");
  assert.equal(Object.keys(proof).length, 7);
  assert.ok(
    Object.isFrozen(proof) &&
      Object.isFrozen(f.calls[0].input.expected) &&
      Object.isFrozen(f.calls[0].input.scope),
  );
  assert.equal(Object.hasOwn(proof, "financialEligible"), false);
});

test("all saved review terms remain immutable while normal journal/receipt updates are permitted", async () => {
  for (const change of [
    (d) => (d.transaction.gasLimit = "999999"),
    (d) => (d.method = "withdrawPending"),
    (d) => d.args.push(wallet),
    (d) => d.reviewBlock++,
    (d) => d.expiresAt++,
    (d) => (d.registryHash = hash("other")),
    (d) => (d.snapshot = hash("other")),
    (d) => (d.sessionId = "new-session"),
    (d) => (d.valueWei = "2000"),
    (d) => (d.eventId = "event-two"),
    (d) => (d.origin = "https://other.invalid"),
  ]) {
    const f = journal(fixture());
    change(f.d);
    await assert.rejects(() =>
      f.context.inspectDraftTransaction(f.d, actual()),
    );
    assert.equal(f.calls.length, 0);
  }
  const f = journal(fixture());
  Object.assign(f.d, {
    used: true,
    status: "confirmed",
    confirmedHash: txHash,
    blockNumber: 20,
    blockHash,
    adoptionStatus: "verified",
  });
  assert.equal(
    (await f.context.inspectDraftTransaction(f.d, actual())).verified,
    true,
  );
});

test("changed seal, manifest, private object replacement and foreign profiles fail closed", async () => {
  for (const change of [
    (f) => (f.d.v10Intent = { ...f.d.v10Intent, reviewHash: hash("forged") }),
    (f) => (f.chain.manifest.extra = true),
    (f) => f.drafts.set(f.d.id, { ...f.d }),
    (f) => (f.d.contractVersion = "kleros-event-v9-uups"),
    (f) => (f.d.abiVersion = "kleros-event-v9-uups"),
    (f) => (f.d.chainId = 10200),
    (f) => (f.d.wallet = target),
    (f) => (f.d.instanceId = "foreign-instance"),
  ]) {
    const f = journal(fixture());
    change(f);
    await assert.rejects(() =>
      f.context.inspectDraftTransaction(f.d, actual()),
    );
    assert.equal(f.calls.length, 0);
  }
});

test("verifier callback selects exactly one saved hash and rejects mismatched expected inner facts", async () => {
  const f = journal(fixture()),
    expected = {
      chainId: 1,
      transactionHash: txHash,
      from: wallet,
      to: target,
      valueWei: "1000",
      data: "0xd0e30db0",
    };
  assert.equal(
    (await f.context.assertTransactionIntent(actual(), Object.freeze(expected)))
      .verified,
    true,
  );
  for (const changed of [
    { from: target },
    { to: wallet },
    { valueWei: "0" },
    { data: "0x" },
    { chainId: 10200 },
    { extra: true },
  ])
    await rejects(
      () =>
        f.context.assertTransactionIntent(actual(), {
          ...expected,
          ...changed,
        }),
      "V10_RECEIPT_CONTEXT_MISMATCH",
    );
  const duplicate = draft("draft-two");
  f.drafts.set(duplicate.id, duplicate);
  f.context.sealDraft(duplicate);
  duplicate.submittedHash = txHash;
  await rejects(
    () => f.context.assertTransactionIntent(actual(), expected),
    "V10_RECEIPT_CONTEXT_AMBIGUOUS",
  );
  const empty = fixture();
  await rejects(
    () => empty.context.assertTransactionIntent(actual(), expected),
    "V10_RECEIPT_CONTEXT_UNKNOWN_HASH",
  );
});

test("direct inspection rejects duplicate journal ownership before any policy call", async () => {
  const f = journal(fixture()),
    duplicate = draft("draft-two");
  f.drafts.set(duplicate.id, duplicate);
  f.context.sealDraft(duplicate);
  duplicate.confirmedHash = txHash;
  await rejects(
    () => f.context.inspectDraftTransaction(f.d, actual()),
    "V10_RECEIPT_CONTEXT_AMBIGUOUS",
  );
  await rejects(
    () =>
      f.context.inspectDraftTransaction(duplicate, actual(), {
        canonical: false,
      }),
    "V10_RECEIPT_CONTEXT_AMBIGUOUS",
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.policies.length, 0);
});

test("direct inspection rejects a hash collision introduced during the async policy read", async () => {
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const f = journal(
    fixture({
      transform: async (input) => {
        started();
        await held;
        return proofFor(input.expected);
      },
    }),
  );
  const pending = f.context.inspectDraftTransaction(f.d, actual());
  await entered;
  const duplicate = draft("draft-two");
  f.drafts.set(duplicate.id, duplicate);
  f.context.sealDraft(duplicate);
  duplicate.submittedHash = txHash;
  release();
  await rejects(() => pending, "V10_RECEIPT_CONTEXT_AMBIGUOUS");
  assert.equal(f.calls.length, 1);
  assert.equal(f.d.submittedHash, txHash);
  assert.equal(duplicate.submittedHash, txHash);
});

test("restart uses original sealed instance for historical facts but current instance for account authority", async () => {
  const original = journal(fixture()),
    saved = JSON.parse(JSON.stringify(original.d));
  const restarted = fixture({
    instanceId: "instance-after-restart",
    savedDraft: saved,
  });
  const realNow = Date.now;
  try {
    Date.now = () => saved.expiresAt + 86400000;
    saved.used = true;
    saved.confirmedHash = txHash;
    assert.equal(
      (await restarted.context.inspectDraftTransaction(saved, actual()))
        .verified,
      true,
    );
    const auth = restarted.context.assertWallet(wallet);
    assert.equal(auth.financialEligible, false);
    restarted.context.classifyWallet(wallet);
    assert.deepEqual(
      restarted.policies.map((x) => x.instanceId),
      ["instance-original", "instance-after-restart"],
    );
    assert.deepEqual(
      restarted.calls.map((x) => [x.kind, x.instanceId]),
      [
        ["canonical", "instance-original"],
        ["signing", "instance-after-restart"],
        ["classification", "instance-after-restart"],
      ],
    );
    assert.equal(saved.sessionId, "session-original");
    assert.equal(saved.expiresAt, original.d.expiresAt);
  } finally {
    Date.now = realNow;
  }
  const foreign = fixture({
    instanceId: "instance-after-restart",
    savedDraft: { ...saved, origin: "https://foreign.invalid" },
  });
  await rejects(
    () => foreign.context.inspectDraftTransaction(foreign.d, actual()),
    "V10_RECEIPT_CONTEXT_SCOPE",
  );
  const unsealed = fixture({ instanceId: "instance-after-restart" });
  assert.throws(() => unsealed.context.sealDraft(unsealed.d), {
    code: "V10_RECEIPT_CONTEXT_UNSEALED",
  });
});

test("malicious proof shapes, wrong facts and any transaction mutation are rejected", async () => {
  for (const wrong of [
    (p) => ({ ...p, extra: true }),
    (p) => ({ ...p, verified: false }),
    (p) => ({ ...p, chainId: 10200 }),
    (p) => ({ ...p, from: target }),
    (p) => ({ ...p, to: wallet }),
    (p) => ({ ...p, transactionHash: ethers.ZeroHash }),
    (p) => ({ ...p, valueWei: "0" }),
    (p) => ({ ...p, dataHash: ethers.ZeroHash }),
    (p) =>
      Object.defineProperty({ ...p }, "verified", {
        get: () => true,
        enumerable: true,
      }),
  ]) {
    const f = journal(
      fixture({ transform: async (input) => wrong(proofFor(input.expected)) }),
    );
    await rejects(
      () => f.context.inspectDraftTransaction(f.d, actual()),
      "V10_RECEIPT_CONTEXT_PROOF",
    );
  }
  for (const key of [
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
  ]) {
    const f = journal(
      fixture({
        transform: async (input) => {
          input.actual[key] = "changed";
          return proofFor(input.expected);
        },
      }),
    );
    await rejects(
      () => f.context.inspectDraftTransaction(f.d, actual()),
      "V10_RECEIPT_CONTEXT_MUTATED",
    );
  }
});

test("private map or review mutation during async policy await cannot return a factual proof", async () => {
  let f;
  f = journal(
    fixture({
      transform: async (input) => {
        f.drafts.delete(f.d.id);
        return proofFor(input.expected);
      },
    }),
  );
  await rejects(
    () => f.context.inspectDraftTransaction(f.d, actual()),
    "V10_RECEIPT_CONTEXT_SCOPE",
  );
  f = journal(
    fixture({
      transform: async (input) => {
        f.d.transaction.data = "0x1234";
        return proofFor(input.expected);
      },
    }),
  );
  await rejects(
    () => f.context.inspectDraftTransaction(f.d, actual()),
    "V10_RECEIPT_CONTEXT_CHANGED",
  );
  const policyError = Object.assign(new Error("static fake policy denial"), {
    code: "V10_TRANSACTION_UNCONFIRMED",
    status: 409,
  });
  f = journal(
    fixture({
      transform: async () => {
        throw policyError;
      },
    }),
  );
  await assert.rejects(
    () =>
      f.context.inspectDraftTransaction(f.d, actual(), { canonical: false }),
    (error) => error === policyError,
  );
});

test("default source-owned policy is lazy and leaves delegated signing disabled", async () => {
  const f = fixture();
  let reads = 0;
  f.chain.provider.send = async (method, params) => {
    reads++;
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber")
      return { number: "0x14", hash: blockHash };
    if (method === "eth_getCode") return "0xef0100" + "7".repeat(40);
    assert.fail("Unexpected read");
  };
  const context = createV10ReceiptContext(f.options);
  assert.equal(reads, 0);
  await rejects(() => context.assertWallet(wallet), "UNSUPPORTED_WALLET");
  assert.ok(reads > 0);
  assert.equal(f.d.submittedHash, undefined);
});

const feeReplacementHash = ethers.id("synthetic-fee-only-replacement");
const manager = "0x3333333333333333333333333333333333333333";
function factoryFixture(options = {}) {
  const savedDraft = draft("factory-replacement-review", {
    scopeKind: "factory-create",
    action: "createEvent",
    method: "createEvent",
    factory: target,
    valueWei: "0",
    transaction: {
      from: wallet,
      to: target,
      data: "0x80464ff5cafe",
      value: "0",
      chainId: 1,
      gasLimit: "130000",
    },
  });
  return journal(fixture({ ...options, savedDraft }));
}
function submission(f) {
  f.d.submissionWitness = {
    hash: txHash,
    wallet,
    nonce: 3,
    reviewBlock: 10,
    type: 2,
    to: manager,
    valueWei: "0",
    dataHash: ethers.keccak256("0xabcdef"),
    gasLimit: "100000",
    accessListHash: hash([]),
  };
  f.context.sealFactorySubmission(f.d);
  return f;
}
function replacement(f) {
  f.d.replacement = {
    verified: true,
    kind: "same-call-fee-replacement",
    chainId: 1,
    originalHash: txHash,
    hash: feeReplacementHash,
    wallet,
    nonce: 3,
    blockNumber: 20,
    blockHash,
    gasUsed: "80000",
    gasPriceWei: "2",
    feeWei: "160000",
    type: 2,
    to: manager,
    valueWei: "0",
    dataHash: ethers.keccak256("0xabcdef"),
    gasLimit: "100000",
    accessListHash: hash([]),
    accountType: "eoa",
    anchor: { blockNumber: 20, blockHash },
  };
  f.context.sealFactoryReplacement(f.d);
  return f;
}
const replacementActual = (overrides = {}) =>
  actual({
    hash: feeReplacementHash,
    to: manager,
    value: 0n,
    data: "0xabcdef",
    ...overrides,
  });
const replacementExpected = (f) => ({
  chainId: 1,
  transactionHash: feeReplacementHash,
  from: wallet,
  to: target,
  valueWei: "0",
  data: f.d.transaction.data,
});

test("factory fee replacement seals preserve original review/hash and invoke fresh canonical inspector for the explicit alias", async () => {
  const f = replacement(submission(factoryFixture()));
  const originalSeal = hash(f.d.v10Intent);
  assert.deepEqual(f.d.v10Submission, {
    reviewHash: f.d.v10Intent.reviewHash,
    witnessHash: hash(f.d.submissionWitness),
  });
  assert.deepEqual(f.d.v10Replacement, {
    reviewHash: f.d.v10Intent.reviewHash,
    witnessHash: f.d.v10Submission.witnessHash,
    replacementHash: hash(f.d.replacement),
  });
  assert.ok(
    Object.isFrozen(f.d.v10Submission) && Object.isFrozen(f.d.v10Replacement),
  );
  assert.equal(f.context.sealFactorySubmission(f.d), f.d.v10Submission);
  assert.equal(f.context.sealFactoryReplacement(f.d), f.d.v10Replacement);
  for (let i = 0; i < 2; i++) {
    const result = await f.context.assertTransactionIntent(
      replacementActual(),
      replacementExpected(f),
    );
    assert.deepEqual(result, proofFor(replacementExpected(f)));
  }
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((call) => call.kind === "canonical"));
  assert.equal(f.calls[0].input.actual.to, manager);
  assert.equal(f.calls[0].input.expected.to, target);
  assert.equal(f.d.submittedHash, txHash);
  assert.equal(f.d.confirmedHash, undefined);
  assert.equal(hash(f.d.v10Intent), originalSeal);
  f.d.confirmedHash = feeReplacementHash;
  f.d.used = true;
  assert.equal(
    (await f.context.inspectDraftTransaction(f.d, replacementActual()))
      .verified,
    true,
  );
  assert.equal(f.d.submittedHash, txHash);
});

test("factory alias is canonical-only and exact original outer envelope plus proven block are checked before wallet policy", async () => {
  for (const changed of [
    { nonce: 4 },
    { type: 4 },
    { to: target },
    { from: target },
    { value: 1n },
    { data: "0x1234" },
    { gasLimit: 100001n },
    { accessList: [{ address: target, storageKeys: [] }] },
    { blockNumber: 21 },
    { blockHash: ethers.id("other-block") },
  ]) {
    const f = replacement(submission(factoryFixture()));
    await rejects(
      () => f.context.inspectDraftTransaction(f.d, replacementActual(changed)),
      "V10_FACTORY_REPLACEMENT_MISMATCH",
    );
    assert.equal(f.calls.length, 0);
  }
  const f = replacement(submission(factoryFixture()));
  await rejects(
    () =>
      f.context.inspectDraftTransaction(f.d, replacementActual(), {
        canonical: false,
      }),
    "V10_FACTORY_REPLACEMENT_MISMATCH",
  );
  assert.equal(f.calls.length, 0);
});

test("factory submission and replacement evidence cannot be added to event calls or used unsealed", async () => {
  const event = journal(fixture());
  assert.throws(() => submission(event), {
    code: "V10_FACTORY_SUBMISSION_CHANGED",
  });
  const unsealed = submission(factoryFixture());
  replacement(unsealed);
  delete unsealed.d.v10Replacement;
  await rejects(
    () =>
      unsealed.context.assertTransactionIntent(
        replacementActual(),
        replacementExpected(unsealed),
      ),
    "V10_FACTORY_REPLACEMENT_CHANGED",
  );
  assert.equal(unsealed.calls.length, 0);
  event.d.replacement = structuredClone(unsealed.d.replacement);
  await rejects(
    () => event.context.inspectDraftTransaction(event.d, replacementActual()),
    "V10_RECEIPT_CONTEXT_UNKNOWN_HASH",
  );
  const late = factoryFixture();
  late.d.submissionWitness = structuredClone(unsealed.d.submissionWitness);
  late.d.replacement = structuredClone(unsealed.d.replacement);
  assert.throws(() => late.context.sealFactorySubmission(late.d), {
    code: "V10_FACTORY_SUBMISSION_UNSEALED",
  });
});

test("mutated factory witnesses, evidence and seals fail before inspection or resealing", async () => {
  for (const mutate of [
    (f) => f.d.submissionWitness.nonce++,
    (f) => (f.d.submissionWitness.dataHash = ethers.id("other-call")),
    (f) => (f.d.submissionWitness.extra = true),
    (f) =>
      (f.d.v10Submission = {
        ...f.d.v10Submission,
        witnessHash: hash("wrong"),
      }),
    (f) => (f.d.replacement.feeWei = "1"),
    (f) => (f.d.replacement.hash = ethers.id("other-replacement")),
    (f) => (f.d.replacement.originalHash = ethers.id("other-original")),
    (f) => f.d.replacement.nonce++,
    (f) => (f.d.replacement.anchor.blockHash = ethers.id("other-anchor")),
    (f) => (f.d.replacement.extra = true),
    (f) =>
      (f.d.v10Replacement = {
        ...f.d.v10Replacement,
        replacementHash: hash("wrong"),
      }),
    (f) =>
      (f.d.v10Replacement = {
        ...f.d.v10Replacement,
        reviewHash: hash("other-review"),
      }),
    (f) => (f.d.submittedHash = feeReplacementHash),
  ]) {
    const f = replacement(submission(factoryFixture()));
    mutate(f);
    assert.throws(() => f.context.sealFactoryReplacement(f.d));
    await assert.rejects(() =>
      f.context.inspectDraftTransaction(f.d, replacementActual()),
    );
    assert.equal(f.calls.length, 0);
  }
});

test("factory alias ownership includes original and replacement hashes even before terminal adoption", async () => {
  for (const collision of [txHash, feeReplacementHash]) {
    const f = replacement(submission(factoryFixture())),
      other = draft("foreign-review");
    f.drafts.set(other.id, other);
    f.context.sealDraft(other);
    other.submittedHash = collision;
    await rejects(
      () => f.context.inspectDraftTransaction(f.d, replacementActual()),
      "V10_RECEIPT_CONTEXT_AMBIGUOUS",
    );
    assert.equal(f.calls.length, 0);
  }
  const f = submission(factoryFixture()),
    other = draft("collision-review");
  f.drafts.set(other.id, other);
  f.context.sealDraft(other);
  other.submittedHash = feeReplacementHash;
  assert.throws(() => replacement(f), {
    code: "V10_RECEIPT_CONTEXT_AMBIGUOUS",
  });
  assert.equal(f.d.v10Replacement, undefined);
});

test("first-time factory seals reject foreign chain/account/call evidence and do not write a partial seal", () => {
  for (const changed of [
    { chainId: 10200 },
    { wallet: target },
    { to: target },
    { type: 4 },
    { nonce: 4 },
    { valueWei: "1" },
    { dataHash: ethers.id("foreign-data") },
    { gasLimit: "99999" },
    { accessListHash: hash("foreign-access-list") },
    { originalHash: feeReplacementHash },
    { hash: txHash },
    { blockNumber: 10 },
    { gasUsed: "100001" },
    { gasPriceWei: "-1" },
    { feeWei: "1" },
    { anchor: { blockNumber: 19, blockHash } },
    { accountType: "foreign-account" },
    { delegateCodeHash: ethers.id("unexpected-eoa-delegate") },
  ]) {
    const f = replacement(submission(factoryFixture()));
    delete f.d.v10Replacement;
    Object.assign(f.d.replacement, changed);
    assert.throws(() => f.context.sealFactoryReplacement(f.d), {
      code: "V10_FACTORY_REPLACEMENT_CHANGED",
    });
    assert.equal(f.d.v10Replacement, undefined);
  }
  const f = replacement(submission(factoryFixture()));
  delete f.d.v10Submission;
  assert.throws(() => f.context.sealFactoryReplacement(f.d), {
    code: "V10_FACTORY_SUBMISSION_CHANGED",
  });
  const zero = replacement(submission(factoryFixture()));
  delete zero.d.v10Replacement;
  zero.d.replacement.gasPriceWei = "0";
  zero.d.replacement.feeWei = "0";
  assert.ok(zero.context.sealFactoryReplacement(zero.d));
});

test("serialized factory replacement seals validate after restart without reconstructing an alias cache", async () => {
  const original = replacement(submission(factoryFixture()));
  original.d.confirmedHash = feeReplacementHash;
  original.d.used = true;
  const saved = JSON.parse(JSON.stringify(original.d));
  const restarted = fixture({ instanceId: "new-runtime", savedDraft: saved });
  assert.equal(
    restarted.context.sealFactorySubmission(saved),
    saved.v10Submission,
  );
  assert.equal(
    restarted.context.sealFactoryReplacement(saved),
    saved.v10Replacement,
  );
  assert.equal(
    (
      await restarted.context.assertTransactionIntent(
        replacementActual(),
        replacementExpected(restarted),
      )
    ).verified,
    true,
  );
  assert.equal(restarted.policies[0].instanceId, "instance-original");
  assert.equal(saved.submittedHash, txHash);
  assert.equal(saved.confirmedHash, feeReplacementHash);
});

test("factory evidence remains unchanged through the fresh inspector await and delegated proof shape is exact", async () => {
  let f;
  f = replacement(
    submission(
      factoryFixture({
        transform: async ({ expected }) => {
          f.d.replacement.gasPriceWei = "3";
          return proofFor(expected);
        },
      }),
    ),
  );
  await assert.rejects(() =>
    f.context.inspectDraftTransaction(f.d, replacementActual()),
  );
  const delegated = submission(factoryFixture());
  replacement(delegated);
  delete delegated.d.v10Replacement;
  delegated.d.replacement.accountType = "metamask-protected-self-v1.3";
  assert.throws(() => delegated.context.sealFactoryReplacement(delegated.d), {
    code: "V10_FACTORY_REPLACEMENT_CHANGED",
  });
  delegated.d.replacement.delegateCodeHash =
    "0x0b77e469f5603ed1e9ff0e7ee56238b61a8cf7cb3185b33e53e2eeaad50109ab";
  delegated.context.sealFactoryReplacement(delegated.d);
  assert.equal(
    (
      await delegated.context.inspectDraftTransaction(
        delegated.d,
        replacementActual(),
      )
    ).verified,
    true,
  );
});
