// Pure classification/encoding/signature fixtures only. Fake runtime pins are deliberately synthetic.
// No chain, account upgrade, native transfer, framework execution or financial eligibility is proved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  createV10WalletCompatibility,
  METAMASK_V130,
  METAMASK_SELF_CONTEXT,
  METAMASK_DELEGATION_DOMAIN,
  METAMASK_DELEGATION_TYPES,
  METAMASK_ROOT_AUTHORITY,
  V10_WALLET_PROFILE,
  V10_DELEGATED_PREREQUISITES,
} from "../src/v10-wallet-compatibility.mjs";

const signer = new ethers.Wallet("0x" + "11".repeat(32)); // Publicly known synthetic key; never funded or sent.
const stranger = new ethers.Wallet("0x" + "22".repeat(32));
const target = "0x0000000000000000000000000000000000001234";
const delegateCode = "0x6001600055",
  managerCode = "0x6002600055";
const walletCode = ethers.concat(["0xef0100", METAMASK_V130.delegate]);
const abi = new ethers.Interface([
  "function redeemDelegations(bytes[],bytes32[],bytes[])",
]);
const hash = "0x" + "a".repeat(64);
const expectedCode = (expected) => (error) => error.code === expected;
const scope = (patch = {}) => ({
  contractVersion: V10_WALLET_PROFILE,
  abiVersion: V10_WALLET_PROFILE,
  chainId: 1,
  mode: "hosted-production",
  origin: "https://synthetic.invalid",
  instanceId: "synthetic-instance",
  wallet: signer.address,
  eventId: "synthetic-event",
  draftId: "synthetic-draft",
  action: "createEvent",
  contract: target,
  ...patch,
});
const reviewedPins = (patch = {}) => ({
  schemaVersion: 1,
  framework: METAMASK_V130.framework,
  version: "1.3.0",
  chainId: 1,
  manager: METAMASK_V130.manager,
  delegate: METAMASK_V130.delegate,
  managerRuntimeHash: ethers.keccak256(managerCode),
  delegateRuntimeHash: ethers.keccak256(delegateCode),
  reviewId: "b".repeat(64),
  ...patch,
});
function fixture({
  delegated = true,
  value = "0",
  patchScope = {},
  pins = reviewedPins(),
} = {}) {
  const helper = createV10WalletCompatibility({ reviewedRuntimePins: pins }),
    context = scope(patchScope);
  const transaction = {
    from: signer.address,
    to: context.contract,
    data: "0x11223344",
    value,
    chainId: 1,
  };
  const account = helper.classifyAccount({
    scope: context,
    walletCode: delegated ? walletCode : "0x",
    delegateRuntimeCode: delegateCode,
    managerRuntimeCode: managerCode,
  });
  const intent = helper.canonicalIntent({ scope: context, transaction });
  const execution = ethers.solidityPacked(
    ["address", "uint256", "bytes"],
    [target, value, transaction.data],
  );
  const outer = {
    hash,
    from: signer.address,
    to: METAMASK_V130.manager,
    data: abi.encodeFunctionData("redeemDelegations", [
      [METAMASK_SELF_CONTEXT],
      [ethers.ZeroHash],
      [execution],
    ]),
    value: "0x0",
    chainId: "0x1",
    type: "0x2",
    nonce: "0x7",
  };
  return {
    helper,
    context,
    transaction,
    account,
    intent,
    execution,
    outer,
    inspect(tx = outer, reviewed = intent, actor = account) {
      return helper.inspectTransactionIntent({
        intent: reviewed,
        account: actor,
        transaction: tx,
      });
    },
  };
}

test("ordinary empty-code account keeps its existing EOA path; pure matching grants no financial or receipt authority", () => {
  const f = fixture({ delegated: false, pins: null, value: "100" });
  assert.equal(f.account.kind, "eoa");
  assert.equal(f.account.continueExistingEOAPath, true);
  assert.equal(f.account.financialEligible, false);
  const result = f.inspect({ hash, ...f.transaction, value: "0x64", type: 2 });
  assert.equal(result.route, "direct");
  assert.equal(result.intentMatched, true);
  assert.equal(result.outerTransaction.to, target);
  assert.equal(result.financialEligible, false);
  assert.equal(result.receiptVerified, false);
  assert.equal(result.protocolAuthorizationApplied, false);
  assert.equal(result.authorizationSignatureMatched, false);
  assert.equal(result.outerHash, hash);
  assert.equal(result.intentHash, f.intent.intentHash);
  assert.throws(() => {
    result.outerTransaction.to = stranger.address;
  }, TypeError);
});

test("V10 context is exact and cannot accept V9, another chain/mode, unsafe origin or unknown action", () => {
  for (const patch of [
    { contractVersion: "kleros-event-v9-uups" },
    { abiVersion: "kleros-event-v9-uups" },
    { chainId: 10200 },
    { mode: "hosted-v9-testnet" },
    { origin: "http://synthetic.invalid" },
    { origin: "https://synthetic.invalid/" },
    { origin: "https://user:secret@synthetic.invalid" },
    { action: "arbitrary-call" },
    { draftId: "../foreign" },
    { contract: signer.address },
    { contract: METAMASK_V130.manager },
    { contract: null },
  ])
    assert.throws(
      () => fixture({ patchScope: patch }),
      expectedCode("V10_WALLET_SCOPE"),
    );
  const f = fixture();
  assert.throws(
    () =>
      f.helper.canonicalIntent({
        scope: { ...scope(), extra: true },
        transaction: f.transaction,
      }),
    expectedCode("V10_WALLET_SCOPE"),
  );
  assert.throws(
    () =>
      f.helper.canonicalIntent({
        scope: scope(),
        transaction: { ...f.transaction, extraCall: "0x" },
      }),
    expectedCode("V10_WALLET_INPUT"),
  );
});

test("intent and account ownership bind origin, instance, actor, event, draft, action and target", () => {
  const f = fixture(),
    changes = [
      { origin: "https://other.invalid" },
      { instanceId: "other-instance" },
      { wallet: stranger.address },
      { eventId: "other-event" },
      { draftId: "other-draft" },
      { action: "deposit" },
      { contract: stranger.address },
    ];
  for (const change of changes) {
    const account = f.helper.classifyAccount({
      scope: scope(change),
      walletCode,
      delegateRuntimeCode: delegateCode,
      managerRuntimeCode: managerCode,
    });
    assert.throws(
      () => f.inspect(f.outer, f.intent, account),
      expectedCode("V10_WALLET_SCOPE"),
    );
  }
  for (const clone of [structuredClone(f.intent), { ...f.intent }])
    assert.throws(
      () => f.inspect(f.outer, clone),
      expectedCode("V10_WALLET_SCOPE"),
    );
  assert.throws(
    () => f.inspect(f.outer, f.intent, structuredClone(f.account)),
    expectedCode("V10_WALLET_SCOPE"),
  );
  const foreign = fixture();
  assert.throws(
    () => foreign.inspect(f.outer, f.intent, f.account),
    expectedCode("V10_WALLET_SCOPE"),
  );
  assert.throws(
    () =>
      f.helper.inspectTransactionIntent({
        intent: f.intent,
        account: f.account,
        transaction: f.outer,
        authorization: true,
      }),
    expectedCode("V10_WALLET_INPUT"),
  );
});

test("recognized delegation address alone never establishes reviewed runtime or financial support", () => {
  const unknown = fixture({ pins: null });
  assert.equal(unknown.account.kind, "metamask-v1.3-delegated");
  assert.equal(unknown.account.frameworkPinsMatched, false);
  assert.equal(unknown.account.financialEligible, false);
  assert.throws(() => unknown.inspect(), expectedCode("V10_WALLET_UNVERIFIED"));
  const f = fixture();
  assert.equal(f.account.frameworkPinsMatched, true);
  assert.equal(f.account.continueExistingEOAPath, false);
  assert.deepEqual(f.account.prerequisites, V10_DELEGATED_PREREQUISITES);
  for (const codes of [
    { delegateRuntimeCode: "0x" },
    { managerRuntimeCode: "0x6003" },
    { delegateRuntimeCode: "0x6004" },
  ]) {
    const account = f.helper.classifyAccount({
      scope: scope(),
      walletCode,
      delegateRuntimeCode: delegateCode,
      managerRuntimeCode: managerCode,
      ...codes,
    });
    assert.equal(account.frameworkPinsMatched, false);
    assert.throws(
      () => f.inspect(f.outer, f.intent, account),
      expectedCode("V10_WALLET_UNVERIFIED"),
    );
  }
});

test("unknown contracts/delegations, malformed indicator lengths and arbitrary reviewed-manager claims fail closed", () => {
  const f = fixture();
  for (const code of [
    "0x6000",
    ethers.concat(["0xef0100", stranger.address]),
    walletCode + "00",
    "0xef0100",
  ]) {
    const account = f.helper.classifyAccount({
      scope: scope(),
      walletCode: code,
    });
    assert.equal(account.financialEligible, false);
    assert.equal(account.continueExistingEOAPath, false);
    assert.throws(
      () => f.inspect(f.outer, f.intent, account),
      expectedCode("V10_WALLET_UNSUPPORTED"),
    );
  }
  for (const pins of [
    reviewedPins({ manager: stranger.address }),
    reviewedPins({ delegate: stranger.address }),
    reviewedPins({ chainId: 10200 }),
    reviewedPins({ version: "1.4.0" }),
    reviewedPins({ extra: true }),
    reviewedPins({ reviewId: "0".repeat(64) }),
  ])
    assert.throws(
      () => createV10WalletCompatibility({ reviewedRuntimePins: pins }),
      expectedCode("V10_WALLET_UNVERIFIED"),
    );
});

test("exact single self-context manager route preserves actual outer envelope and native intent separately", () => {
  for (const value of ["0", "10000000000000000"]) {
    const f = fixture({ value }),
      result = f.inspect();
    assert.equal(result.route, "metamask-manager-self-single");
    assert.equal(result.outerTransaction.to, METAMASK_V130.manager);
    assert.equal(result.outerTransaction.data, f.outer.data.toLowerCase());
    assert.equal(result.outerTransaction.value, "0");
    assert.equal(f.intent.call.value, value);
    assert.equal(f.intent.call.to, target);
    assert.equal(
      result.financialEligible,
      false,
      "Synthetic value matching cannot establish native execution/custody support",
    );
  }
});

test("extra calls, unknown permission chains, nonzero modes, malformed/trailing data, value and sender mismatches are rejected", () => {
  const f = fixture({ value: "100" });
  const wrappers = [
    [
      [METAMASK_SELF_CONTEXT, METAMASK_SELF_CONTEXT],
      [ethers.ZeroHash, ethers.ZeroHash],
      [f.execution, f.execution],
    ],
    [["0x"], [ethers.ZeroHash], [f.execution]],
    [[METAMASK_SELF_CONTEXT + "00"], [ethers.ZeroHash], [f.execution]],
    [[METAMASK_SELF_CONTEXT], ["0x01" + "00".repeat(31)], [f.execution]],
    [
      [METAMASK_SELF_CONTEXT],
      [ethers.ZeroHash],
      [
        ethers.solidityPacked(
          ["address", "uint256", "bytes"],
          [stranger.address, 100, f.transaction.data],
        ),
      ],
    ],
    [
      [METAMASK_SELF_CONTEXT],
      [ethers.ZeroHash],
      [
        ethers.solidityPacked(
          ["address", "uint256", "bytes"],
          [target, 101, f.transaction.data],
        ),
      ],
    ],
    [[METAMASK_SELF_CONTEXT], [ethers.ZeroHash], [f.execution + "00"]],
  ];
  for (const args of wrappers)
    assert.throws(
      () =>
        f.inspect({
          ...f.outer,
          data: abi.encodeFunctionData("redeemDelegations", args),
        }),
      (error) =>
        [
          "V10_INTENT_MISMATCH",
          "V10_PERMISSION_UNSUPPORTED",
          "V10_WALLET_UNVERIFIED",
        ].includes(error.code),
    );
  for (const change of [
    { to: stranger.address },
    { value: "1" },
    { from: stranger.address },
    { chainId: "0x2" },
    { data: f.outer.data + "00" },
    { data: "0x1234" },
    { data: "0x" },
  ])
    assert.throws(() => f.inspect({ ...f.outer, ...change }));
  assert.throws(
    () => f.inspect({ ...f.outer, extraExecution: f.execution }),
    expectedCode("V10_WALLET_INPUT"),
  );
});

test("direct CREATE stays exact and cannot be disguised as a manager execution", () => {
  const f = fixture({
    delegated: false,
    pins: null,
    patchScope: { action: "deployContract", contract: null },
  });
  const tx = { hash, ...f.transaction, type: 2 };
  assert.equal(f.inspect(tx).route, "direct");
  assert.throws(
    () => f.inspect({ ...tx, to: target }),
    expectedCode("V10_WALLET_UNSUPPORTED"),
  );
  assert.throws(
    () => f.inspect({ ...tx, data: "0x11223345" }),
    expectedCode("V10_INTENT_MISMATCH"),
  );
});

async function authorized(f, signingWallet = signer, changes = {}) {
  const auth = {
    address: METAMASK_V130.delegate,
    chainId: 1n,
    nonce: 8n,
    ...changes,
  };
  const signature = signingWallet.signingKey.sign(
    ethers.hashAuthorization(auth),
  );
  return {
    ...f.outer,
    type: 4,
    authorizationList: [
      {
        address: auth.address,
        chainId: ethers.toQuantity(auth.chainId),
        nonce: ethers.toQuantity(auth.nonce),
        yParity: ethers.toQuantity(signature.yParity),
        r: signature.r,
        s: signature.s,
      },
    ],
  };
}

test("type4 requires one exact chain-bound authorization signature for the same sender and next sender nonce", async () => {
  const f = fixture(),
    tx = await authorized(f),
    result = f.inspect(tx);
  assert.equal(result.authorizationSignatureMatched, true);
  assert.equal(result.protocolAuthorizationApplied, false);
  assert.equal(result.financialEligible, false);
  assert.equal(result.receiptVerified, false);
  for (const bad of [
    await authorized(f, stranger),
    await authorized(f, signer, { chainId: 0n }),
    await authorized(f, signer, { chainId: 2n }),
    await authorized(f, signer, { nonce: 7n }),
    await authorized(f, signer, { address: stranger.address }),
    { ...tx, authorizationList: [] },
    {
      ...tx,
      authorizationList: [tx.authorizationList[0], tx.authorizationList[0]],
    },
    { ...tx, authorizationList: [{ ...tx.authorizationList[0], extra: true }] },
    { ...tx, nonce: "0x8" },
    { ...tx, type: 2 },
    {
      ...tx,
      authorizationList: [{ ...tx.authorizationList[0], r: ethers.ZeroHash }],
    },
  ])
    assert.throws(
      () => f.inspect(bad),
      expectedCode("V10_AUTHORIZATION_UNKNOWN"),
    );
  const noAuth = { ...f.outer, type: 4 };
  assert.throws(
    () => f.inspect(noAuth),
    expectedCode("V10_AUTHORIZATION_UNKNOWN"),
  );
});

test("an empty-code EOA cannot silently become delegated through an unexpected type4 wrapper", async () => {
  const f = fixture({ delegated: false, pins: null });
  assert.throws(
    () => f.inspect({ ...f.outer, type: 4, authorizationList: [] }),
    expectedCode("V10_AUTHORIZATION_UNKNOWN"),
  );
  const wrapped = await authorized(f);
  assert.throws(
    () => f.inspect(wrapped),
    expectedCode("V10_AUTHORIZATION_UNKNOWN"),
  );
});

test("classification and intent inputs are detached, sealed and never change eligibility via forged proof fields", () => {
  const pins = reviewedPins(),
    helper = createV10WalletCompatibility({ reviewedRuntimePins: pins });
  pins.managerRuntimeHash = ethers.ZeroHash;
  const context = scope(),
    transaction = {
      from: signer.address,
      to: target,
      data: "0x11223344",
      value: "0",
      chainId: 1,
    };
  const intent = helper.canonicalIntent({ scope: context, transaction });
  context.eventId = "changed";
  transaction.data = "0xdeadbeef";
  assert.equal(intent.scope.eventId, "synthetic-event");
  assert.equal(intent.call.data, "0x11223344");
  assert.throws(() => {
    intent.financialEligible = true;
  }, TypeError);
  assert.throws(
    () =>
      helper.classifyAccount({
        scope: scope(),
        walletCode,
        managerRuntimeCode: managerCode,
        delegateRuntimeCode: delegateCode,
        localEip7702Verified: true,
      }),
    expectedCode("V10_WALLET_INPUT"),
  );
  let getterRead = false;
  const bad = scope();
  Object.defineProperty(bad, "wallet", {
    get() {
      getterRead = true;
      throw Error("SYNTHETIC_SECRET");
    },
  });
  assert.throws(
    () => helper.canonicalIntent({ scope: bad, transaction }),
    expectedCode("V10_WALLET_SCOPE"),
  );
  assert.equal(getterRead, false);
});

test("factual proof adapter binds every expected call field to the original sealed outer transaction without signing authority", () => {
  const f = fixture({ value: "100" }),
    inspection = f.inspect();
  const expected = {
    chainId: 1,
    transactionHash: hash,
    from: signer.address,
    to: target,
    valueWei: "100",
    data: f.transaction.data,
  };
  const proof = f.helper.factualIntentProof({ inspection, expected });
  assert.equal(proof.verified, true);
  assert.equal(proof.dataHash, ethers.keccak256(f.transaction.data));
  assert.deepEqual(
    Object.keys(proof).sort(),
    [
      "verified",
      "chainId",
      "transactionHash",
      "from",
      "to",
      "valueWei",
      "dataHash",
    ].sort(),
  );
  assert.equal(inspection.financialEligible, false);
  assert.equal(inspection.receiptVerified, false);
  assert.equal(proof.to, target);
  assert.equal(inspection.outerTransaction.to, METAMASK_V130.manager);
  assert.equal(proof.transactionHash, inspection.outerHash);
  for (const change of [
    { chainId: 10200 },
    { transactionHash: "0x" + "c".repeat(64) },
    { from: stranger.address },
    { to: stranger.address },
    { to: METAMASK_V130.manager },
    { valueWei: "101" },
    { data: "0x11223345" },
  ])
    assert.throws(
      () =>
        f.helper.factualIntentProof({
          inspection,
          expected: { ...expected, ...change },
        }),
      expectedCode("V10_INTENT_MISMATCH"),
    );
  assert.throws(
    () =>
      f.helper.factualIntentProof({
        inspection: structuredClone(inspection),
        expected,
      }),
    expectedCode("V10_WALLET_SCOPE"),
  );
  assert.throws(
    () => fixture().helper.factualIntentProof({ inspection, expected }),
    expectedCode("V10_WALLET_SCOPE"),
  );
  assert.throws(
    () =>
      f.helper.factualIntentProof({
        inspection,
        expected: { ...expected, financialApproved: true },
      }),
    expectedCode("V10_WALLET_SCOPE"),
  );
});

test("authorization objects/arrays with accessors or extra fields are rejected before any getter executes", async () => {
  const f = fixture(),
    tx = await authorized(f);
  let getterRead = false;
  const list = [...tx.authorizationList];
  Object.defineProperty(list, "0", {
    get() {
      getterRead = true;
      throw Error("SYNTHETIC_SECRET");
    },
  });
  assert.throws(
    () => f.inspect({ ...tx, authorizationList: list }),
    expectedCode("V10_AUTHORIZATION_UNKNOWN"),
  );
  assert.equal(getterRead, false);
  const auth = { ...tx.authorizationList[0] };
  Object.defineProperty(auth, "s", {
    get() {
      getterRead = true;
      throw Error("SYNTHETIC_SECRET");
    },
  });
  assert.throws(
    () => f.inspect({ ...tx, authorizationList: [auth] }),
    expectedCode("V10_AUTHORIZATION_UNKNOWN"),
  );
  assert.equal(getterRead, false);
});

const enforcerCode = "0x6003600055";
const delegationArrayType =
  "tuple(address delegate,address delegator,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]";
function protectedFixture({
  value = "100",
  mutate = () => {},
  signingWallet = signer,
  domain = METAMASK_DELEGATION_DOMAIN,
  pin = true,
  suppliedCode = enforcerCode,
  afterSignature = () => {},
} = {}) {
  const f = fixture({
    value,
    pins: reviewedPins(
      pin
        ? {
            nativeBalanceChangeEnforcer:
              METAMASK_V130.nativeBalanceChangeEnforcer,
            nativeBalanceChangeRuntimeHash: ethers.keccak256(enforcerCode),
          }
        : {},
    ),
  });
  const account = f.helper.classifyAccount({
    scope: scope(),
    walletCode,
    delegateRuntimeCode: delegateCode,
    managerRuntimeCode: managerCode,
    nativeBalanceChangeRuntimeCode: suppliedCode,
  });
  const delegation = {
    delegate: signer.address,
    delegator: signer.address,
    authority: METAMASK_ROOT_AUTHORITY,
    caveats: [
      {
        enforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
        terms: ethers.solidityPacked(
          ["uint8", "address", "uint256"],
          [1, signer.address, value],
        ),
        args: "0x",
      },
    ],
    salt: 123n,
    signature: "0x",
  };
  mutate(delegation);
  const typed = {
    delegate: delegation.delegate,
    delegator: delegation.delegator,
    authority: delegation.authority,
    caveats: delegation.caveats.map(({ enforcer, terms }) => ({
      enforcer,
      terms,
    })),
    salt: delegation.salt,
  };
  delegation.signature = signingWallet.signingKey.sign(
    ethers.TypedDataEncoder.hash(domain, METAMASK_DELEGATION_TYPES, typed),
  ).serialized;
  afterSignature(delegation);
  const context = ethers.AbiCoder.defaultAbiCoder().encode(
    [delegationArrayType],
    [[delegation]],
  );
  const outer = {
    ...f.outer,
    data: abi.encodeFunctionData("redeemDelegations", [
      [context],
      [ethers.ZeroHash],
      [f.execution],
    ]),
  };
  return {
    ...f,
    delegation,
    context,
    account,
    outer,
    inspect(tx = outer) {
      return f.helper.inspectTransactionIntent({
        intent: f.intent,
        account,
        transaction: tx,
      });
    },
  };
}

test("protected-self route matches official typed-data/domain and exact native guard while financial eligibility stays false", async () => {
  assert.deepEqual(METAMASK_DELEGATION_DOMAIN, {
    name: "DelegationManager",
    version: "1",
    chainId: 1,
    verifyingContract: METAMASK_V130.manager,
  });
  const typeHash = ethers.id(
    "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)",
  );
  const caveatTypeHash = ethers.id("Caveat(address enforcer,bytes terms)");
  for (const value of ["0", "10000000000000000"]) {
    const f = protectedFixture({ value }),
      result = f.inspect(),
      d = f.delegation;
    const caveatHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "bytes32"],
        [
          caveatTypeHash,
          d.caveats[0].enforcer,
          ethers.keccak256(d.caveats[0].terms),
        ],
      ),
    );
    const manualStructHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "address", "bytes32", "bytes32", "uint256"],
        [
          typeHash,
          d.delegate,
          d.delegator,
          d.authority,
          ethers.keccak256(caveatHash),
          d.salt,
        ],
      ),
    );
    assert.equal(result.permission.delegationHash, manualStructHash);
    assert.equal(result.route, "metamask-manager-protected-self-single");
    assert.equal(result.permission.maxDecreaseWei, value);
    assert.equal(result.permission.signatureMatched, true);
    assert.equal(result.financialEligible, false);
    assert.equal(result.receiptVerified, false);
    assert.equal(result.outerTransaction.data, f.outer.data.toLowerCase());
    assert.equal(result.outerTransaction.to, METAMASK_V130.manager);
    assert.equal(
      f.context.length,
      2 + 704 * 2,
      "One-caveat signature fixture has observed context shape, without claiming actual-wallet equality",
    );
    const typed4 = f.inspect(await authorized(f));
    assert.equal(typed4.authorizationSignatureMatched, true);
    assert.equal(typed4.financialEligible, false);
  }
});

test("protected-self requires independently pinned NativeBalanceChange runtime and rejects partial/arbitrary pins", () => {
  for (const options of [
    { pin: false },
    { suppliedCode: "0x" },
    { suppliedCode: "0x6004" },
  ]) {
    const f = protectedFixture(options);
    assert.equal(f.account.nativeBalanceEnforcerPinned, false);
    assert.throws(() => f.inspect(), expectedCode("V10_WALLET_UNVERIFIED"));
  }
  for (const patch of [
    { nativeBalanceChangeEnforcer: METAMASK_V130.nativeBalanceChangeEnforcer },
    { nativeBalanceChangeRuntimeHash: ethers.keccak256(enforcerCode) },
    {
      nativeBalanceChangeEnforcer: stranger.address,
      nativeBalanceChangeRuntimeHash: ethers.keccak256(enforcerCode),
    },
  ])
    assert.throws(
      () =>
        createV10WalletCompatibility({
          reviewedRuntimePins: reviewedPins(patch),
        }),
      expectedCode("V10_WALLET_UNVERIFIED"),
    );
});

test("protected-self rejects ANY/foreign delegates, nonroot authority, unknown caveats and every guard mismatch", () => {
  const bad = [
    (d) => {
      d.delegate = "0x0000000000000000000000000000000000000a11";
    },
    (d) => {
      d.delegate = stranger.address;
    },
    (d) => {
      d.delegator = stranger.address;
    },
    (d) => {
      d.authority = ethers.ZeroHash;
    },
    (d) => {
      d.caveats = [];
    },
    (d) => {
      d.caveats.push(structuredClone(d.caveats[0]));
    },
    (d) => {
      d.caveats[0].enforcer = stranger.address;
    },
    (d) => {
      d.caveats[0].terms = "0x" + "00".repeat(52);
    },
    (d) => {
      d.caveats[0].terms = ethers.solidityPacked(
        ["uint8", "address", "uint256"],
        [0, signer.address, 100],
      );
    },
    (d) => {
      d.caveats[0].terms = ethers.solidityPacked(
        ["uint8", "address", "uint256"],
        [2, signer.address, 100],
      );
    },
    (d) => {
      d.caveats[0].terms = ethers.solidityPacked(
        ["uint8", "address", "uint256"],
        [1, stranger.address, 100],
      );
    },
    (d) => {
      d.caveats[0].terms = ethers.solidityPacked(
        ["uint8", "address", "uint256"],
        [1, signer.address, 101],
      );
    },
    (d) => {
      d.caveats[0].args = "0x01";
    },
  ];
  for (const mutate of bad)
    assert.throws(
      () => protectedFixture({ mutate }).inspect(),
      expectedCode("V10_PERMISSION_UNSUPPORTED"),
    );
});

test("protected delegation signature binds manager domain, signed terms and wallet; unsigned args and malformed signatures still fail", () => {
  for (const options of [
    { signingWallet: stranger },
    { domain: { ...METAMASK_DELEGATION_DOMAIN, chainId: 10200 } },
    {
      domain: {
        ...METAMASK_DELEGATION_DOMAIN,
        verifyingContract: stranger.address,
      },
    },
    { domain: { ...METAMASK_DELEGATION_DOMAIN, version: "1.3.0" } },
    {
      afterSignature: (d) => {
        d.salt++;
      },
    },
    {
      afterSignature: (d) => {
        d.caveats[0].args = "0x01";
      },
    },
    {
      afterSignature: (d) => {
        d.signature = "0x" + "01".repeat(64);
      },
    },
    {
      afterSignature: (d) => {
        d.signature = d.signature.slice(0, -2) + "00";
      },
    },
  ])
    assert.throws(
      () => protectedFixture(options).inspect(),
      expectedCode("V10_PERMISSION_UNSUPPORTED"),
    );
  const f = protectedFixture();
  const two = ethers.AbiCoder.defaultAbiCoder().encode(
    [delegationArrayType],
    [[f.delegation, f.delegation]],
  );
  for (const context of [f.context + "00", two])
    assert.throws(
      () =>
        f.inspect({
          ...f.outer,
          data: abi.encodeFunctionData("redeemDelegations", [
            [context],
            [ethers.ZeroHash],
            [f.execution],
          ]),
        }),
      expectedCode("V10_PERMISSION_UNSUPPORTED"),
    );
});
