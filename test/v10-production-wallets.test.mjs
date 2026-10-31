// Offline synthetic provider/envelope tests. No public RPC, wallet file or broadcast.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import { assertV10WalletAccount } from "../public/v10-wallet-account.js";
import {
  createV10ProductionWallets,
  projectV10CanonicalTransaction,
  V10_WALLET_SUPPORT,
  V10_WALLET_CAPABILITIES,
  V10_LOCAL_WALLET_CANDIDATE,
} from "../src/v10-production-wallets.mjs";
import {
  METAMASK_V130,
  METAMASK_DELEGATION_DOMAIN,
  METAMASK_DELEGATION_TYPES,
  METAMASK_ROOT_AUTHORITY,
} from "../src/v10-wallet-compatibility.mjs";
const observed = JSON.parse(
    fs.readFileSync(
      new URL(
        "../artifacts/v10-integration/metamask-runtime-observed.json",
        import.meta.url,
      ),
    ),
  ),
  protocol = JSON.parse(
    fs.readFileSync(
      new URL(
        "../artifacts/v10-integration/type4-protected/2026-10-29T17-19-46.899Z-0d5838d5-4291-4ba5-990d-e72bba6a65e8/proof.json",
        import.meta.url,
      ),
    ),
  ),
  manifest = {
    factoryDeployment: {
      contractVersion: "kleros-event-v10-uups",
      abiVersion: "kleros-event-v10-uups",
      factory: "0x0000000000000000000000000000000000001234",
    },
    provenance: {
      v10BuildManifestSha256: protocol.source.v10BuildManifestSha256,
      v10StandardInputSha256: protocol.source.v10StandardInputSha256,
    },
  };
const tag = "0x64",
  blockHash = ethers.id("synthetic-v10-account-policy-block"),
  origin = "https://synthetic.invalid",
  instanceId = "synthetic-instance";
function context({
  wallet = "0x1111111111111111111111111111111111111111",
  code = "0x",
  transform = (m, p, r) => r,
  transaction = null,
} = {}) {
  const calls = [],
    chain = {
      production: true,
      chainId: 1,
      manifest: structuredClone(manifest),
      provider: {
        async send(method, params) {
          calls.push({ method, params });
          let result;
          if (method === "eth_chainId") result = "0x1";
          else if (method === "eth_getBlockByNumber")
            result = { number: tag, hash: blockHash };
          else if (method === "eth_getCode")
            result =
              params[0].toLowerCase() === wallet.toLowerCase()
                ? code
                : (observed.contracts.find(
                    (x) => x.address.toLowerCase() === params[0].toLowerCase(),
                  )?.code ?? "0x");
          else if (method === "eth_getTransactionByHash")
            result = transaction?.raw;
          else if (method === "eth_getTransactionReceipt")
            result = transaction
              ? {
                  transactionHash: transaction.raw.hash,
                  blockHash,
                  blockNumber: tag,
                  status: "0x1",
                }
              : null;
          else assert.fail("Unexpected read method");
          return transform(method, params, result, calls);
        },
      },
    };
  return {
    chain,
    calls,
    policy: createV10ProductionWallets({ chain, origin, instanceId }),
  };
}
test("policy is V10-only and cannot accept an activation boolean; fresh EOA returns exact six-field proof", async () => {
  const c = context(),
    wallet = "0x1111111111111111111111111111111111111111";
  assert.throws(
    () =>
      createV10ProductionWallets({
        chain: c.chain,
        origin,
        instanceId,
        enableDelegatedFinance: true,
      }),
    { code: "V10_WALLET_SCOPE" },
  );
  const proof = await c.policy.assertWallet(wallet);
  assert.deepEqual(Object.keys(proof).sort(), [
    "accountType",
    "blockHash",
    "blockNumber",
    "codeHash",
    "financialEligible",
    "wallet",
  ]);
  assert.equal(proof.financialEligible, true);
  assert.equal(proof.accountType, "eoa");
  assert.equal(proof.blockHash, blockHash);
  assert.ok(c.calls.every((x) => !/send|sign|accounts/i.test(x.method)));
  const v9 = structuredClone(manifest);
  v9.factoryDeployment.contractVersion = "kleros-event-v9-uups";
  assert.throws(
    () =>
      createV10ProductionWallets({
        chain: { ...c.chain, manifest: v9 },
        origin,
        instanceId,
      }),
    { code: "V10_WALLET_SCOPE" },
  );
});
test("source+both protocol proofs authorize the unpublished local candidate while classification itself remains factual", async () => {
  const c = context({ code: "0xef0100" + METAMASK_V130.delegate.slice(2) }),
    facts = await c.policy.classifyWallet(
      "0x1111111111111111111111111111111111111111",
    );
  assert.equal(facts.accountType, "metamask-protected-self-v1.3");
  assert.equal(facts.financialEligible, false);
  assert.equal(facts.delegatedFinancialActivation, V10_LOCAL_WALLET_CANDIDATE);
  assert.equal(facts.framework.length, 3);
  const authorized = await c.policy.assertWallet(facts.wallet);
  assert.equal(authorized.accountType, "metamask-protected-self-v1.3");
  assert.equal(authorized.financialEligible, true);
  assert.equal(Object.keys(authorized).length, 6);
  assert.equal(c.calls.filter((x) => x.method === "eth_getCode").length, 8);
});
test("a supplied observation stays pinned when latest advances, without skipping canonical or framework checks", async () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  for (const code of ["0x", "0xef0100" + METAMASK_V130.delegate.slice(2)]) {
    const c = context({ code, transform: (method, params, result) =>
      method === "eth_getBlockByNumber" && params[0] === "latest"
        ? { number: "0x65", hash: ethers.id("normal-next-block") } : result });
    const proof = await c.policy.assertWallet(wallet, { blockNumber: 100, blockHash, code });
    assert.equal(proof.blockNumber, 100);
    assert.equal(proof.blockHash, blockHash);
    assert.equal(proof.financialEligible, true);
    assert.deepEqual(c.calls.filter(call => call.method === "eth_getBlockByNumber").map(call => call.params),
      [[tag, false], [tag, false]]);
    assert(c.calls.filter(call => call.method === "eth_getCode").every(call => call.params[1] === tag));
    assert.equal(c.calls.filter(call => call.method === "eth_getCode").length, code === "0x" ? 1 : 4);
    assert.equal(c.calls.filter(call => call.method === "eth_chainId").length, 2);
  }
});
test("supplied observations reject malformed scope, changed canonical block and changed account code", async () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  for (const change of [o => { o.blockNumber = 0; }, o => { o.blockNumber = -1; },
    o => { o.blockNumber = Number.MAX_SAFE_INTEGER + 1; }, o => { o.blockHash = "0x12"; },
    o => { o.code = "bad"; }, o => { o.extra = true; }, o => { o.blockHash = ethers.id("reorganized-block"); },
    o => { o.code = "0x6000"; }]) {
    const observation = { blockNumber: 100, blockHash, code: "0x" }; change(observation);
    await assert.rejects(context().policy.assertWallet(wallet, observation), { code: "V10_WALLET_REORG" });
  }
});
test("wrong network, changed canonical anchor, stale observation and changed framework fail closed", async () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  await assert.rejects(
    context({
      transform: (m, p, r) => (m === "eth_chainId" ? "0x2" : r),
    }).policy.assertWallet(wallet),
    { code: "WRONG_CHAIN" },
  );
  await assert.rejects(
    context({
      transform: (m, p, r) =>
        m === "eth_getBlockByNumber" && p[0] !== "latest"
          ? { ...r, hash: ethers.ZeroHash }
          : r,
    }).policy.assertWallet(wallet),
    { code: "V10_WALLET_REORG" },
  );
  await assert.rejects(
    context().policy.assertWallet(wallet, {
      blockNumber: 99,
      blockHash,
      code: "0x",
    }),
    { code: "V10_WALLET_REORG" },
  );
  await assert.rejects(
    context({
      code: "0xef0100" + METAMASK_V130.delegate.slice(2),
      transform: (m, p, r) =>
        m === "eth_getCode" && p[0] === METAMASK_V130.manager ? "0x6000" : r,
    }).policy.classifyWallet(wallet),
    { code: "V10_WALLET_FRAMEWORK_CHANGED" },
  );
  await assert.rejects(
    context({ code: "0xef0100" + "7".repeat(40) }).policy.assertWallet(wallet),
    { code: "UNSUPPORTED_WALLET" },
  );
});

async function signedFixture({ foreignAuthorization = false } = {}) {
  let wallet, authorization;
  // Deterministically find a synthetic short-scalar vector entirely in Node memory.
  for (let i = 1; i <= 256; i++) {
    wallet = new ethers.Wallet(ethers.toBeHex(i, 32));
    authorization = await wallet.authorize({
      chainId: 1,
      address: METAMASK_V130.delegate,
      nonce: 5,
    });
    if (authorization.signature.r.startsWith("0x0")) break;
  }
  assert.ok(authorization.signature.r.startsWith("0x0"));
  if (foreignAuthorization)
    authorization = await new ethers.Wallet(ethers.toBeHex(1024, 32)).authorize(
      { chainId: 1, address: METAMASK_V130.delegate, nonce: 5 },
    );
  const target = manifest.factoryDeployment.factory,
    data = "0x12345678",
    delegation = {
      delegate: wallet.address,
      delegator: wallet.address,
      authority: METAMASK_ROOT_AUTHORITY,
      caveats: [
        {
          enforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
          terms: ethers.solidityPacked(
            ["uint8", "address", "uint256"],
            [1, wallet.address, 0],
          ),
          args: "0x",
        },
      ],
      salt: 1n,
    };
  const signature = await wallet.signTypedData(
    METAMASK_DELEGATION_DOMAIN,
    METAMASK_DELEGATION_TYPES,
    {
      ...delegation,
      caveats: delegation.caveats.map(({ enforcer, terms }) => ({
        enforcer,
        terms,
      })),
    },
  );
  const permission = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(address delegate,address delegator,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]",
      ],
      [[{ ...delegation, signature }]],
    ),
    manager = new ethers.Interface([
      "function redeemDelegations(bytes[],bytes32[],bytes[])",
    ]),
    outer = manager.encodeFunctionData("redeemDelegations", [
      [permission],
      [ethers.ZeroHash],
      [
        ethers.solidityPacked(
          ["address", "uint256", "bytes"],
          [target, 0, data],
        ),
      ],
    ]),
    signed = ethers.Transaction.from(
      await wallet.signTransaction({
        type: 4,
        chainId: 1,
        nonce: 4,
        to: METAMASK_V130.manager,
        value: 0,
        data: outer,
        gasLimit: 1000000,
        maxFeePerGas: 1000,
        maxPriorityFeePerGas: 1,
        authorizationList: [authorization],
      }),
    );
  const raw = {
    hash: signed.hash,
    from: signed.from,
    to: signed.to,
    input: signed.data,
    value: ethers.toQuantity(signed.value),
    chainId: "0x1",
    type: "0x4",
    nonce: "0x4",
    gas: ethers.toQuantity(signed.gasLimit),
    maxFeePerGas: ethers.toQuantity(signed.maxFeePerGas),
    maxPriorityFeePerGas: ethers.toQuantity(signed.maxPriorityFeePerGas),
    accessList: signed.accessList,
    r: ethers.toQuantity(BigInt(signed.signature.r)),
    s: ethers.toQuantity(BigInt(signed.signature.s)),
    v: ethers.toQuantity(signed.signature.yParity),
    blockHash,
    blockNumber: tag,
    authorizationList: [
      {
        address: authorization.address,
        chainId: "0x1",
        nonce: "0x5",
        yParity: ethers.toQuantity(authorization.signature.yParity),
        r: ethers.toQuantity(BigInt(authorization.signature.r)),
        s: ethers.toQuantity(BigInt(authorization.signature.s)),
      },
    ],
  };
  const actual = {
    ...signed,
    hash: signed.hash,
    from: signed.from,
    to: signed.to,
    data: signed.data,
    value: signed.value,
    chainId: signed.chainId,
    nonce: signed.nonce,
    type: signed.type,
    authorizationList: signed.authorizationList,
    signature: signed.signature,
  };
  return {
    wallet,
    raw,
    actual,
    target,
    data,
    scope: {
      contractVersion: "kleros-event-v10-uups",
      abiVersion: "kleros-event-v10-uups",
      chainId: 1,
      mode: "hosted-production",
      origin,
      instanceId,
      wallet: wallet.address,
      eventId: "synthetic-event",
      draftId: "synthetic-draft",
      action: "createEvent",
      contract: target,
      manifestHash: hash(manifest),
    },
    expected: {
      chainId: 1,
      transactionHash: raw.hash,
      from: wallet.address,
      to: target,
      valueWei: "0",
      data,
    },
  };
}
test("lossless short-r codec reconstructs actual signed hash and rejects width/zero/highS/hash changes", async () => {
  const f = await signedFixture(),
    before = hash(f.raw),
    view = projectV10CanonicalTransaction(f.raw);
  assert.equal(ethers.isHexString(f.raw.authorizationList[0].r, 32), false);
  assert.equal(ethers.isHexString(view.authorizationList[0].r, 32), true);
  assert.equal(
    BigInt(view.authorizationList[0].r),
    BigInt(f.raw.authorizationList[0].r),
  );
  assert.equal(hash(f.raw), before);
  for (const mutate of [
    (x) => (x.authorizationList[0].r = "0x0"),
    (x) => (x.authorizationList[0].r = "0x" + "1".repeat(66)),
    (x) =>
      (x.authorizationList[0].s = ethers.toQuantity(
        0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n /
          2n +
          1n,
      )),
    (x) => (x.value = "0x1"),
    (x) => (x.hash = ethers.ZeroHash),
  ]) {
    const raw = structuredClone(f.raw);
    mutate(raw);
    assert.throws(() => projectV10CanonicalTransaction(raw), {
      code: "V10_TRANSACTION_CODEC",
    });
  }
});
test("canonical scoped factual receipt proof stays read-only in the unpublished candidate and rejects foreignscope, reorg or failed rawhash", async () => {
  const f = await signedFixture(),
    beforeRaw = hash(f.raw),
    beforeActual = hash(f.actual),
    c = context({
      wallet: f.wallet.address,
      code: "0xef0100" + METAMASK_V130.delegate.slice(2),
      transaction: f,
    });
  const proof = await c.policy.inspectReviewedTransaction(f);
  assert.equal(proof.verified, true);
  assert.equal(Object.keys(proof).length, 7);
  assert.equal(proof.transactionHash, f.raw.hash);
  assert.equal(hash(f.raw), beforeRaw);
  assert.equal(hash(f.actual), beforeActual);
  assert.equal(
    (await c.policy.assertWallet(f.wallet.address)).accountType,
    "metamask-protected-self-v1.3",
  );
  for (const scope of [
    { ...f.scope, instanceId: "foreign" },
    { ...f.scope, manifestHash: "0".repeat(64) },
    { ...f.scope, wallet: ethers.ZeroAddress },
    { ...f.scope, contractVersion: "kleros-event-v9-uups" },
  ])
    await assert.rejects(c.policy.inspectReviewedTransaction({ ...f, scope }), {
      code: "V10_WALLET_SCOPE",
    });
  const reorg = context({
    wallet: f.wallet.address,
    code: "0xef0100" + METAMASK_V130.delegate.slice(2),
    transaction: f,
    transform: (m, p, r) =>
      m === "eth_getTransactionReceipt"
        ? { ...r, blockHash: ethers.ZeroHash }
        : r,
  });
  await assert.rejects(reorg.policy.inspectReviewedTransaction(f), {
    code: "V10_TRANSACTION_REORG",
  });
  const historicalCode = context({
    wallet: f.wallet.address,
    code: "0xef0100" + METAMASK_V130.delegate.slice(2),
    transaction: f,
    transform: (m, p, r, calls) =>
      m === "eth_getCode" &&
      p[0].toLowerCase() === f.wallet.address.toLowerCase() &&
      calls.filter(
        (x) =>
          x.method === m && x.params[0].toLowerCase() === p[0].toLowerCase(),
      ).length === 1
        ? "0xef0100" + "7".repeat(40)
        : r,
  });
  await assert.rejects(historicalCode.policy.inspectReviewedTransaction(f), {
    code: "V10_WALLET_UNSUPPORTED",
  });
  const historicalFramework = context({
    wallet: f.wallet.address,
    code: "0xef0100" + METAMASK_V130.delegate.slice(2),
    transaction: f,
    transform: (m, p, r, calls) =>
      m === "eth_getCode" &&
      p[0] === METAMASK_V130.manager &&
      calls.filter((x) => x.method === m && x.params[0] === p[0]).length === 1
        ? "0x6000"
        : r,
  });
  await assert.rejects(
    historicalFramework.policy.inspectReviewedTransaction(f),
    { code: "V10_WALLET_FRAMEWORK_CHANGED" },
  );
  assert.ok(c.calls.every((x) => !/send|sign|accounts/i.test(x.method)));
});

test("revoked current EOA retains its canonical historical protected receipt without borrowing current account eligibility", async () => {
  const f = await signedFixture(),
    latest = "0x65",
    latestHash = ethers.id("after-local-revocation"),
    c = context({
      wallet: f.wallet.address,
      code: "0x",
      transaction: f,
      transform: (m, p, r) => {
        if (m === "eth_getBlockByNumber" && ["latest", latest].includes(p[0]))
          return { number: latest, hash: latestHash };
        if (
          m === "eth_getCode" &&
          p[0].toLowerCase() === f.wallet.address.toLowerCase() &&
          p[1] === tag
        )
          return "0xef0100" + METAMASK_V130.delegate.slice(2);
        return r;
      },
    });
  const facts = await c.policy.classifyWallet(f.wallet.address);
  assert.equal(facts.accountType, "eoa");
  assert.equal(facts.framework, null);
  const beforeRaw = hash(f.raw),
    beforeActual = hash(f.actual),
    proof = await c.policy.inspectReviewedTransaction(f);
  assert.equal(proof.transactionHash, f.raw.hash);
  assert.equal(proof.verified, true);
  assert.equal(Object.keys(proof).length, 7);
  assert.equal(hash(f.raw), beforeRaw);
  assert.equal(hash(f.actual), beforeActual);
  assert.equal(
    (await c.policy.classifyWallet(f.wallet.address))
      .delegatedFinancialActivation,
    V10_LOCAL_WALLET_CANDIDATE,
  );
  const wrongHistory = context({
    wallet: f.wallet.address,
    code: "0x",
    transaction: f,
    transform: (m, p, r) =>
      m === "eth_getCode" &&
      p[0].toLowerCase() === f.wallet.address.toLowerCase() &&
      p[1] === tag
        ? "0xef0100" + "7".repeat(40)
        : r,
  });
  await assert.rejects(wrongHistory.policy.inspectReviewedTransaction(f), {
    code: "V10_WALLET_UNSUPPORTED",
  });
});

test("pending known-delegation type4 proves signed intent only, without a receipt or app-publication claim", async () => {
  const f = await signedFixture();
  f.raw.blockHash = null;
  f.raw.blockNumber = null;
  f.actual.blockHash = null;
  f.actual.blockNumber = null;
  const c = context({
    wallet: f.wallet.address,
    code: "0xef0100" + METAMASK_V130.delegate.slice(2),
    transaction: f,
    transform: (m, p, r) => {
      if (m === "eth_getTransactionReceipt")
        assert.fail("Pending signed-intent proof must not request a receipt");
      return r;
    },
  });
  const beforeRaw = hash(f.raw),
    beforeActual = hash(f.actual),
    proof = await c.policy.inspectSubmittedTransaction(f);
  assert.equal(proof.verified, true);
  assert.equal(Object.keys(proof).length, 7);
  assert.equal(proof.transactionHash, f.raw.hash);
  assert.equal(Object.hasOwn(proof, "financialEligible"), false);
  assert.equal(Object.hasOwn(proof, "receiptVerified"), false);
  assert.equal(hash(f.raw), beforeRaw);
  assert.equal(hash(f.actual), beforeActual);
  assert.equal(
    (await c.policy.assertWallet(f.wallet.address)).accountType,
    "metamask-protected-self-v1.3",
  );
  await assert.rejects(c.policy.inspectReviewedTransaction(f), {
    code: "V10_TRANSACTION_UNCONFIRMED",
  });
  await assert.rejects(
    c.policy.inspectSubmittedTransaction({
      ...f,
      expected: { ...f.expected, data: "0x87654321" },
    }),
    { code: "V10_INTENT_MISMATCH" },
  );
  const bad = await signedFixture({ foreignAuthorization: true });
  bad.raw.blockNumber = null;
  bad.raw.blockHash = null;
  const foreign = context({
    wallet: bad.wallet.address,
    code: "0xef0100" + METAMASK_V130.delegate.slice(2),
    transaction: bad,
  });
  await assert.rejects(foreign.policy.inspectSubmittedTransaction(bad), {
    code: "V10_AUTHORIZATION_UNKNOWN",
  });
});

test("first pending EOA-to-type4 authorization remains conservatively unverified and cannot imply execution", async () => {
  const f = await signedFixture();
  f.raw.blockNumber = null;
  f.raw.blockHash = null;
  f.actual.blockNumber = null;
  f.actual.blockHash = null;
  const c = context({ wallet: f.wallet.address, code: "0x", transaction: f });
  await assert.rejects(c.policy.inspectSubmittedTransaction(f), {
    code: "V10_TRANSACTION_UNCONFIRMED",
  });
  assert.equal(
    c.calls.some((x) => x.method === "eth_getTransactionReceipt"),
    false,
  );
  assert.equal(
    (await c.policy.classifyWallet(f.wallet.address))
      .delegatedFinancialActivation,
    V10_LOCAL_WALLET_CANDIDATE,
  );
});

test("ordinary V10 EOA direct type2 receipt keeps exact signed-intent verification unchanged", async () => {
  const f = await signedFixture(),
    tx = ethers.Transaction.from(
      await f.wallet.signTransaction({
        type: 2,
        chainId: 1,
        nonce: 1,
        to: f.target,
        data: f.data,
        value: 0,
        gasLimit: 100000,
        maxFeePerGas: 1000,
        maxPriorityFeePerGas: 1,
      }),
    );
  const raw = {
    ...f.raw,
    hash: tx.hash,
    type: "0x2",
    nonce: "0x1",
    to: tx.to,
    input: tx.data,
    gas: ethers.toQuantity(tx.gasLimit),
    accessList: tx.accessList,
    r: ethers.toQuantity(BigInt(tx.signature.r)),
    s: ethers.toQuantity(BigInt(tx.signature.s)),
    v: ethers.toQuantity(tx.signature.yParity),
  };
  delete raw.authorizationList;
  const actual = {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      chainId: tx.chainId,
      nonce: tx.nonce,
      type: tx.type,
    },
    c = context({ wallet: f.wallet.address, code: "0x", transaction: { raw } }),
    expected = { ...f.expected, transactionHash: tx.hash };
  assert.equal(
    (await c.policy.assertWallet(f.wallet.address)).financialEligible,
    true,
  );
  assert.equal(
    (
      await c.policy.inspectReviewedTransaction({
        scope: f.scope,
        actual,
        expected,
      })
    ).transactionHash,
    tx.hash,
  );
  assert.equal(
    c.calls.some(
      (x) =>
        x.method === "eth_getCode" && x.params[0] === METAMASK_V130.manager,
    ),
    false,
  );
});

test("candidate metadata is immutable and exactly compatible with the read-only V10 browser account contract", async () => {
  assert.equal(
    V10_LOCAL_WALLET_CANDIDATE.status,
    "local-candidate-unpublished",
  );
  assert.equal(V10_LOCAL_WALLET_CANDIDATE.publicationAuthorized, false);
  assert.deepEqual(V10_LOCAL_WALLET_CANDIDATE.fullAppAcceptance, {
    status: "pending",
    proofSha256: null,
  });
  assert.ok(Object.isFrozen(V10_LOCAL_WALLET_CANDIDATE.fullAppAcceptance));
  assert.throws(
    () =>
      V10_WALLET_CAPABILITIES.supportedAccountTypes.push(
        "arbitrary-contract-wallet",
      ),
    TypeError,
  );
  assert.throws(() => {
    V10_WALLET_SUPPORT.erc1271 = true;
  }, TypeError);
  const wallet = "0x1111111111111111111111111111111111111111",
    c = context({ code: "0xef0100" + METAMASK_V130.delegate.slice(2) }),
    bootstrap = {
      mode: "hosted-production",
      instanceId,
      contractVersion: "kleros-event-v10-uups",
      abiVersion: "kleros-event-v10-uups",
      contractProfile: {
        contractVersion: "kleros-event-v10-uups",
        abiVersion: "kleros-event-v10-uups",
        version: 10,
        financialModel: "v8",
        upgradeable: true,
        verified: true,
        testOnly: false,
        chainId: 1,
        challengeWindowSeconds: 86400,
        matchWindowSeconds: 86400,
      },
      chain: { chainId: 1 },
      environment: {
        production: true,
        chainId: 1,
        network: "ethereum-mainnet",
      },
      walletSupport: V10_WALLET_SUPPORT,
      capabilities: V10_WALLET_CAPABILITIES,
    };
  const browserFacts = await assertV10WalletAccount({
    wallet,
    bootstrap,
    provider: {
      request: ({ method, params = [] }) =>
        method === "eth_accounts"
          ? Promise.resolve([wallet])
          : c.chain.provider.send(method, params),
    },
  });
  assert.equal(browserFacts.accountType, "metamask-protected-self-v1.3");
  assert.equal(V10_WALLET_CAPABILITIES.serverSigning, false);
  assert.equal(V10_WALLET_CAPABILITIES.erc1271, false);
  assert.equal(V10_WALLET_CAPABILITIES.contractWallets, false);
});

test("local candidate never caches account authority and rejects broken evidence, changed code or cross-manifest scope", async () => {
  const wallet = "0x1111111111111111111111111111111111111111",
    designation = "0xef0100" + METAMASK_V130.delegate.slice(2);
  let current = designation;
  const c = context({
    code: designation,
    transform: (m, p, r) =>
      m === "eth_getCode" && p[0].toLowerCase() === wallet.toLowerCase()
        ? current
        : r,
  });
  assert.equal(
    (await c.policy.assertWallet(wallet)).accountType,
    "metamask-protected-self-v1.3",
  );
  current = "0x";
  assert.equal((await c.policy.assertWallet(wallet)).accountType, "eoa");
  current = "0x6000";
  await assert.rejects(c.policy.assertWallet(wallet), {
    code: "UNSUPPORTED_WALLET",
  });
  current = designation;
  const originalRead = fs.readFileSync;
  try {
    fs.readFileSync = function (file, ...args) {
      const bytes = originalRead.call(this, file, ...args);
      return String(file).endsWith(
        "metamask-source-verification-6ea176ca-3ea1-49eb-a290-1013d6492a15.json",
      )
        ? Buffer.concat([bytes, Buffer.from("\n")])
        : bytes;
    };
    await assert.rejects(c.policy.assertWallet(wallet), {
      code: "V10_WALLET_EVIDENCE",
    });
  } finally {
    fs.readFileSync = originalRead;
  }
  c.chain.manifest.factoryDeployment.factory =
    "0x2222222222222222222222222222222222222222";
  await assert.rejects(c.policy.assertWallet(wallet), {
    code: "V10_WALLET_SCOPE",
  });
});
