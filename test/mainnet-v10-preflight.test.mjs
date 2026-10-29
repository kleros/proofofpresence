// Synthetic read-only RPC responses only. No wallet, public RPC, signing, or transactions.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import {
  prepareV10Release,
  verifyV10Build,
  V10_PROFILE,
  V10_CONTRACT_NAMES,
} from "../scripts/mainnet/prepare-v10-release.mjs";
import {
  main,
  inspectV10Preflight,
  validateV10PreflightPlan,
  validateDelegatedV10CreateReview,
  validateV10PreflightRpcUrl,
  V10_PREFLIGHT_DEPLOYER,
} from "../scripts/mainnet/preflight-v10-release.mjs";
import { METAMASK_V130 } from "../src/v10-wallet-compatibility.mjs";

const sourceCommit = "a".repeat(40),
  sha = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
const config = (wallet = V10_PREFLIGHT_DEPLOYER) => ({
  schemaVersion: 1,
  version: 10,
  chainId: 1,
  contractVersion: V10_PROFILE,
  deployer: wallet,
  deployerNonce: 7,
  governance: {
    kind: "single-owner-immediate",
    initialOwner: wallet,
    upgradeDelaySeconds: 0,
    renounceable: true,
  },
  fees: {
    maxFeePerGasWei: "20000000000",
    maxPriorityFeePerGasWei: "1000000000",
  },
  gasLimits: Object.fromEntries(
    V10_CONTRACT_NAMES.map((name) => [name, "9000000"]),
  ),
  maxTotalGasCostWei: "1000000000000000000",
});
let build, plan;
before(
  () => {
    build = verifyV10Build();
    plan = prepareV10Release(config(), build);
  },
  { timeout: 180000 },
);
const options = (value) => ({
  plan: value,
  build,
  sourceCommit,
  expectedSourceCommit: sourceCommit,
  expectedPlanSha256: sha(value),
  paceMs: 0,
});
const hex = (value) => "0x" + BigInt(value).toString(16);
const block = (number = 100, baseFee = 1000000000n) => ({
  number: hex(number),
  hash: ethers.id("canonical-block-" + number),
  timestamp: hex(1900000000 + number),
  baseFeePerGas: hex(baseFee),
});
function fakeRpc(transform = (_method, _params, result) => result) {
  const calls = [];
  let active = 0,
    maximumActive = 0;
  return {
    calls,
    get maximumActive() {
      return maximumActive;
    },
    getSigner() {
      throw Error("A read-only test must not request a signer");
    },
    sendTransaction() {
      throw Error("A read-only test must not send");
    },
    async request({ method, params }) {
      calls.push({ method, params });
      active++;
      maximumActive = Math.max(maximumActive, active);
      try {
        const result =
          method === "eth_chainId"
            ? "0x1"
            : method === "eth_getBlockByNumber"
              ? block()
              : method === "eth_getCode"
                ? "0x"
                : method === "eth_getTransactionCount"
                  ? params[0] === V10_PREFLIGHT_DEPLOYER
                    ? "0x7"
                    : "0x0"
                  : method === "eth_getBalance"
                    ? hex(1000000000000000000n)
                    : method === "eth_maxPriorityFeePerGas"
                      ? hex(1000000000n)
                      : assert.fail("Unexpected RPC method: " + method);
        return await transform(method, params, result, calls);
      } finally {
        active--;
      }
    },
  };
}

test("V10 preflight default is zero-access and arbitrary execution/private input options fail generically", async () => {
  const result = await main([]);
  for (const name of [
    "networkRequests",
    "privateFilesRead",
    "signatures",
    "broadcasts",
  ])
    assert.equal(result[name], 0);
  assert.equal(result.status, "review-only");
  assert.equal(result.gasBudgetApproval, "NONE");
  for (const args of [
    ["--deploy"],
    ["--sign"],
    ["--execute-readonly", "--private-key", "SYNTHETIC-SECRET"],
    ["--execute-readonly", "--plan", ".runtime/private-wallet.json"],
  ]) {
    const child = spawnSync(
      process.execPath,
      ["scripts/mainnet/preflight-v10-release.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.doesNotMatch(child.stderr, /SYNTHETIC-SECRET|private-wallet|ENOENT/);
  }
});

test("exact source/plan/build, deployer, owner and four CREATE encoding are checked before any RPC", async () => {
  const changes = [
    (p) => (p.transactions[0].data += "00"),
    (p) => (p.transactions[2].to = ethers.ZeroAddress),
    (p) => (p.transactions[1].value = "1"),
    (p) => p.transactions[3].nonce++,
    (p) => (p.transactions[0].expectedRuntimeCodeHash = ethers.ZeroHash),
    (p) => (p.governance.initialOwner = ethers.ZeroAddress),
    (p) => p.transactions.push(p.transactions[0]),
    (p) => (p.deploymentAuthorized = true),
  ];
  for (const change of changes) {
    const value = structuredClone(plan);
    change(value);
    const rpc = fakeRpc();
    await assert.rejects(inspectV10Preflight({ ...options(value), rpc }), {
      code: "PLAN_BUILD_MISMATCH",
    });
    assert.equal(rpc.calls.length, 0);
  }
  const rpc = fakeRpc();
  await assert.rejects(
    inspectV10Preflight({
      ...options(plan),
      rpc,
      expectedSourceCommit: "b".repeat(40),
    }),
    { code: "SOURCE_MISMATCH" },
  );
  await assert.rejects(
    inspectV10Preflight({
      ...options(plan),
      rpc,
      expectedPlanSha256: "c".repeat(64),
    }),
    { code: "PLAN_HASH_MISMATCH" },
  );
  assert.equal(rpc.calls.length, 0);
  const foreign = prepareV10Release(
    config("0x0000000000000000000000000000000000000011"),
    build,
  );
  assert.throws(() => validateV10PreflightPlan(foreign, options(foreign)), {
    code: "DEPLOYER_MISMATCH",
  });
});

test("canonical observations are serial, preserve unapproved declared caps, and never claim four exact gas estimates", async () => {
  const rpc = fakeRpc(async (_method, _params, result) => {
    await Promise.resolve();
    return result;
  });
  const result = await inspectV10Preflight({ ...options(plan), rpc });
  assert.equal(result.status, "observed-only");
  assert.deepEqual(result.blockers, []);
  assert.equal(rpc.maximumActive, 1);
  assert.equal(result.deployer, V10_PREFLIGHT_DEPLOYER);
  assert.equal(result.controllerInitialOwner, V10_PREFLIGHT_DEPLOYER);
  assert.equal(result.account.category, "empty-code-eoa");
  assert.equal(result.account.financialSupportEstablished, false);
  assert.deepEqual(result.nonces, {
    planned: 7,
    latest: "7",
    pending: "7",
    pinned: "7",
  });
  assert.ok(
    result.targetObservations.every(
      (target) => target.nonce === "0" && target.category === "empty-code-eoa",
    ),
  );
  assert.deepEqual(result.anchor, {
    number: 100,
    hash: block().hash,
    timestamp: 1900000100,
    baseFeePerGasWei: "1000000000",
  });
  assert.equal(result.gas.budgetApproval, "NONE");
  assert.equal(result.gas.estimatesVerified, false);
  assert.equal(result.gas.fullBundleEstimateAvailable, false);
  assert.equal(result.gas.declaredMaximumGasCostWei, "720000000000000000");
  assert.ok(
    result.gas.steps.every(
      (step) =>
        step.estimatedGas === null && step.declaredGasLimit === "9000000",
    ),
  );
  assert.equal(result.preflightVerified, false);
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(result.networkRequests, rpc.calls.length);
  assert.equal(result.signatures, 0);
  assert.equal(result.broadcasts, 0);
  assert.ok(
    rpc.calls.every(
      (call) =>
        !/estimate|send|sign|debug|trace|accounts|storage/i.test(call.method),
    ),
  );
});

test("wrong chain and replaced canonical read anchors fail closed", async () => {
  const wrong = fakeRpc((method, _params, value) =>
    method === "eth_chainId" ? "0x27d8" : value,
  );
  await assert.rejects(inspectV10Preflight({ ...options(plan), rpc: wrong }), {
    code: "WRONG_CHAIN",
  });
  assert.equal(wrong.calls.length, 1);
  for (const invalid of [
    (value) => ({ ...value, hash: ethers.id("replacement") }),
    (value) => ({ ...value, number: "0x65" }),
    (value) => ({ ...value, timestamp: "0x1" }),
  ]) {
    const rpc = fakeRpc((method, params, value) =>
      method === "eth_getBlockByNumber" && params[0] !== "latest"
        ? invalid(value)
        : value,
    );
    await assert.rejects(inspectV10Preflight({ ...options(plan), rpc }), {
      code: "CANONICAL_HEAD_CHANGED",
    });
  }
});

test("latest and pending nonce disagreement including a late pending change blocks a fresh proposal", async () => {
  for (const lateOnly of [false, true]) {
    let pendingReads = 0;
    const rpc = fakeRpc((method, params, value) => {
      if (method === "eth_getTransactionCount" && params[1] === "pending") {
        pendingReads++;
        if (!lateOnly || pendingReads === 2) return "0x8";
      }
      return value;
    });
    const result = await inspectV10Preflight({ ...options(plan), rpc });
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.includes("NONCE_MISMATCH"));
  }
});

test("delegated/contract accounts are classified without establishing financial support, including code acquired during reads", async () => {
  for (const [code, category, lateOnly] of [
    ["0xef0100" + "6".repeat(40), "eip7702-delegated", false],
    ["0x6000", "contract-code", false],
    ["0x6001", "contract-code", true],
  ]) {
    let walletReads = 0;
    const rpc = fakeRpc((method, params, value) => {
      if (method === "eth_getCode" && params[0] === V10_PREFLIGHT_DEPLOYER) {
        walletReads++;
        if (!lateOnly || walletReads === 2) return code;
      }
      return value;
    });
    const result = await inspectV10Preflight({ ...options(plan), rpc });
    assert.equal(result.account.category, category);
    assert.equal(result.account.financialSupportEstablished, false);
    assert.ok(result.blockers.includes("UNSUPPORTED_ACCOUNT"));
    assert.equal(result.deploymentAuthorized, false);
  }
});

test("insufficient declared-cap funding, excessive current base fee and occupied predicted addresses block", async () => {
  const rpc = fakeRpc((method, params, value) =>
    method === "eth_getBalance"
      ? "0x1"
      : method === "eth_getBlockByNumber"
        ? block(100, 30000000000n)
        : method === "eth_getCode" &&
            params[0] === plan.transactions[2].predictedAddress
          ? "0x6000"
          : value,
  );
  const result = await inspectV10Preflight({ ...options(plan), rpc });
  assert.deepEqual(result.blockers, [
    "PREDICTED_ADDRESS_OCCUPIED",
    "INSUFFICIENT_BALANCE_FOR_DECLARED_CAPS",
    "FEE_CAP_BELOW_CURRENT_BASE_PLUS_DECLARED_TIP",
  ]);
  assert.equal(result.gas.budgetApproval, "NONE");
  const priorNonce = fakeRpc((method, params, value) =>
    method === "eth_getTransactionCount" &&
    params[0] === plan.transactions[0].predictedAddress
      ? "0x1"
      : value,
  );
  const consumed = await inspectV10Preflight({
    ...options(plan),
    rpc: priorNonce,
  });
  assert.ok(consumed.blockers.includes("PREDICTED_ADDRESS_OCCUPIED"));
  assert.equal(consumed.targetObservations[0].category, "empty-code-eoa");
  assert.equal(consumed.targetObservations[0].nonce, "1");
});

test("malformed or unavailable remote values produce static errors without upstream secret reflection", async () => {
  for (const change of [
    (m, _p, v) => (m === "eth_getBalance" ? "0x01" : v),
    (m, _p, v) => (m === "eth_getCode" ? "0x123" : v),
    (m, _p, v) =>
      m === "eth_getBlockByNumber" ? { ...v, hash: "private-response" } : v,
    (m, _p, v) => {
      if (m === "eth_maxPriorityFeePerGas")
        throw Error("SYNTHETIC-UPSTREAM-SECRET");
      return v;
    },
  ]) {
    await assert.rejects(
      inspectV10Preflight({ ...options(plan), rpc: fakeRpc(change) }),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /private-response|SYNTHETIC-UPSTREAM-SECRET/,
        );
        return true;
      },
    );
  }
});

test("advancing heads are pinned separately and new invocations perform fresh reads without a cached approval", async () => {
  let latestReads = 0,
    expensive = false;
  const rpc = fakeRpc((method, params, value) => {
    if (method === "eth_getBlockByNumber") {
      const number =
        params[0] === "latest"
          ? ++latestReads % 2
            ? 100
            : 101
          : Number(BigInt(params[0]));
      return block(number, expensive ? 40000000000n : 1000000000n);
    }
    return value;
  });
  const first = await inspectV10Preflight({ ...options(plan), rpc }),
    firstReads = rpc.calls.length;
  assert.equal(first.initialAnchor.number, 100);
  assert.equal(first.anchor.number, 101);
  assert.equal(first.blockers.length, 0);
  expensive = true;
  const second = await inspectV10Preflight({ ...options(plan), rpc });
  assert.equal(rpc.calls.length, firstReads * 2);
  assert.ok(
    second.blockers.includes("FEE_CAP_BELOW_CURRENT_BASE_PLUS_DECLARED_TIP"),
  );
  assert.equal(first.gas.budgetApproval, "NONE");
  assert.equal(second.gas.budgetApproval, "NONE");
});

// Synthetic hash-bound public evidence only. These fixtures do not assert a real source/protocol execution.
function reviewFixture(run) {
  const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "v10-create-review-")),
    ),
    rawSha = (value) => createHash("sha256").update(value).digest("hex");
  const save = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    const bytes = typeof data === "string" ? data : JSON.stringify(data);
    fs.writeFileSync(path.join(root, file), bytes);
    return rawSha(bytes);
  };
  const files = {
      sourceScript: "scripts/verify-metamask-v1.3-runtime.mjs",
      harness: "test/v10-eip7702.e2e.mjs",
      compatibility: "src/v10-wallet-compatibility.mjs",
      observedRuntime:
        "artifacts/v10-integration/metamask-runtime-observed.json",
    },
    framework = [
      { name: "manager", address: METAMASK_V130.manager, code: "0x6000600055" },
      {
        name: "delegate",
        address: METAMASK_V130.delegate,
        code: "0x6001600055",
      },
      {
        name: "nativeBalanceEnforcer",
        address: METAMASK_V130.nativeBalanceChangeEnforcer,
        code: "0x6002600055",
      },
    ].map((x) => ({ ...x, codeHash: ethers.keccak256(x.code) }));
  const review = {
    sourceProof: {
      file: "artifacts/v10-integration/metamask-source-verification-1234.json",
      sha256: "",
    },
    protocolProof: {
      file: "artifacts/v10-integration/eip7702/synthetic-run/proof.json",
      sha256: "",
    },
    sourceScriptSha256: save(files.sourceScript, "synthetic source reviewer"),
    harnessSha256: save(files.harness, "synthetic protocol harness"),
    compatibilitySha256: save(
      files.compatibility,
      "synthetic compatibility helper",
    ),
    observedRuntimeSha256: save(files.observedRuntime, {
      chainId: 1,
      contracts: framework,
    }),
  };
  const source = {
      kind: "metamask-v1.3-source-runtime-verification",
      schemaVersion: 1,
      chainId: 1,
      status: "verified",
      sourceVerified: true,
      financialEligible: false,
      officialSourceCommit: "bfbdf9795a976833ed2fa000baf42fbb83958b03",
      contracts: framework.map((x) => ({
        name: x.name,
        address: x.address,
        runtimeCodeHash: x.codeHash,
        sourceVerified: true,
        compiledTemplateMatches: true,
        fullObservedRuntimeMatches: true,
        actualObservedChain: 1,
        crossChainAddressAssumptionUsed: false,
      })),
    },
    protocol = {
      kind: "v10-eip7702-local-protocol-custody",
      schemaVersion: 1,
      passed: true,
      chainId: 1,
      environment: "fresh-loopback-anvil-prague-no-fork",
      publicNetworkRequests: 0,
      keysPersisted: false,
      walletCodeFixtureShortcut: false,
      result: {
        actualType4: true,
        directSetupCreates: 4,
        financialEligibility: false,
      },
      anvil: { version: "1.7.1", hardfork: "prague", noFork: true },
      source: {
        harnessSha256: review.harnessSha256,
        compatibilitySha256: review.compatibilitySha256,
        observedRuntimeFileSha256: review.observedRuntimeSha256,
        v10BuildManifestSha256: build.buildManifestSha256,
        v10StandardInputSha256: build.standardInputSha256,
      },
      fixtures: framework.map(({ name, address, codeHash }) => ({
        name,
        address,
        codeHash,
      })),
      transactions: [
        { type: 4, status: 1 },
        ...[
          "controller",
          "event implementation",
          "factory implementation",
          "factory proxy",
        ].map((label) => ({
          label: "delegated authority direct CREATE " + label,
          type: 2,
          status: 1,
          to: null,
          valueWei: "0",
        })),
      ],
    };
  review.sourceProof.sha256 = save(review.sourceProof.file, source);
  review.protocolProof.sha256 = save(review.protocolProof.file, protocol);
  const rpcFor = (transform = (_m, _p, x) => x) =>
    fakeRpc((method, params, value, calls) => {
      if (method === "eth_getCode")
        value =
          params[0] === V10_PREFLIGHT_DEPLOYER
            ? "0xef0100" + METAMASK_V130.delegate.slice(2)
            : (framework.find((x) => x.address === params[0])?.code ?? value);
      return transform(method, params, value, calls);
    });
  return Promise.resolve()
    .then(() =>
      run({ root, review, source, protocol, framework, files, save, rpcFor }),
    )
    .finally(() => fs.rmSync(root, { recursive: true, force: true }));
}
test("explicit reviewed delegated account permits observations for four direct type2 CREATEs only, with fresh framework pins twice", () =>
  reviewFixture(async ({ root, review, framework, rpcFor }) => {
    const rpc = rpcFor(),
      result = await inspectV10Preflight({
        ...options(plan),
        rpc,
        delegatedCreateReview: review,
        proofRoot: root,
      });
    assert.deepEqual(result.blockers, []);
    assert.equal(result.account.category, "eip7702-delegated");
    assert.equal(result.account.infrastructureCreateSupportObserved, true);
    assert.equal(result.account.financialSupportEstablished, false);
    assert.equal(
      result.account.delegatedCreateReview.applicationFinancialSupport,
      false,
    );
    assert.equal(
      result.account.delegatedCreateReview.wrappedExecutionSupported,
      false,
    );
    assert.equal(
      result.account.delegatedCreateReview.scope,
      "four-direct-type2-create-infrastructure-only",
    );
    assert.equal(result.deploymentAuthorized, false);
    assert.equal(result.gas.budgetApproval, "NONE");
    assert.equal(rpc.maximumActive, 1);
    for (const item of framework)
      assert.equal(
        rpc.calls.filter(
          (x) =>
            x.method === "eth_getCode" &&
            x.params[0] === item.address &&
            x.params[1] === "0x64",
        ).length,
        2,
      );
  }));
test("review hashes, semantic proof flags, source/build/runtime pins and stale local scripts fail before RPC", () =>
  reviewFixture(
    async ({
      root,
      review,
      source,
      protocol,
      framework,
      files,
      save,
      rpcFor,
    }) => {
      for (const mutate of [
        (r) => (r.sourceProof.sha256 = "0".repeat(64)),
        (r) => (r.protocolProof.sha256 = "0".repeat(64)),
        (r) => (r.sourceScriptSha256 = "0".repeat(64)),
        (r) => (r.harnessSha256 = "0".repeat(64)),
        (r) => (r.compatibilitySha256 = "0".repeat(64)),
        (r) => (r.sourceProof.file = ".runtime/private-wallet.json"),
        (r) => (r.extraApproval = true),
      ]) {
        const r = structuredClone(review);
        mutate(r);
        const rpc = rpcFor();
        await assert.rejects(
          inspectV10Preflight({
            ...options(plan),
            rpc,
            delegatedCreateReview: r,
            proofRoot: root,
          }),
        );
        assert.equal(rpc.calls.length, 0);
      }
      const cases = [
        ["source", (p) => (p.sourceVerified = false)],
        ["source", (p) => (p.contracts[0].runtimeCodeHash = ethers.ZeroHash)],
        ["protocol", (p) => (p.passed = false)],
        ["protocol", (p) => (p.walletCodeFixtureShortcut = true)],
        ["protocol", (p) => (p.source.v10BuildManifestSha256 = "0".repeat(64))],
        ["protocol", (p) => (p.transactions[1].type = 4)],
        ["protocol", (p) => (p.fixtures[1].codeHash = ethers.ZeroHash)],
      ];
      for (const [kind, mutate] of cases) {
        const r = structuredClone(review),
          p = structuredClone(kind === "source" ? source : protocol);
        mutate(p);
        r[kind === "source" ? "sourceProof" : "protocolProof"].sha256 = save(
          r[kind === "source" ? "sourceProof" : "protocolProof"].file,
          p,
        );
        const rpc = rpcFor();
        await assert.rejects(
          inspectV10Preflight({
            ...options(plan),
            rpc,
            delegatedCreateReview: r,
            proofRoot: root,
          }),
        );
        assert.equal(rpc.calls.length, 0);
        save(review.sourceProof.file, source);
        save(review.protocolProof.file, protocol);
      }
      save(files.sourceScript, "changed actual source after approval");
      assert.throws(
        () => validateDelegatedV10CreateReview(review, { build, root }),
        { code: "DELEGATED_CREATE_PROOF_HASH_MISMATCH" },
      );
    },
  ));
test("unknown designation, framework code change and proof replacement during RPC cannot retain delegated infrastructure support", () =>
  reviewFixture(async ({ root, review, framework, rpcFor, files, save }) => {
    for (const change of [
      (m, p, v) =>
        m === "eth_getCode" && p[0] === V10_PREFLIGHT_DEPLOYER
          ? "0xef0100" + "7".repeat(40)
          : v,
      (m, p, v, calls) =>
        m === "eth_getCode" &&
        p[0] === framework[0].address &&
        calls.filter((x) => x.method === m && x.params[0] === p[0]).length === 2
          ? "0x6000"
          : v,
    ]) {
      const result = await inspectV10Preflight({
        ...options(plan),
        rpc: rpcFor(change),
        delegatedCreateReview: review,
        proofRoot: root,
      });
      assert.equal(result.account.infrastructureCreateSupportObserved, false);
      assert.ok(result.blockers.includes("UNSUPPORTED_ACCOUNT"));
    }
    const rpc = rpcFor((m, p, v) => {
      if (m === "eth_maxPriorityFeePerGas")
        save(files.compatibility, "replaced while RPC work was pending");
      return v;
    });
    await assert.rejects(
      inspectV10Preflight({
        ...options(plan),
        rpc,
        delegatedCreateReview: review,
        proofRoot: root,
      }),
      { code: "DELEGATED_CREATE_PROOF_HASH_MISMATCH" },
    );
  }));
test("dRPC alternative serves only pinned historical code plus matching chain/canonical anchors; nonce and fees stay on primary", async () => {
  const primary = fakeRpc(),
    historical = fakeRpc();
  const result = await inspectV10Preflight({
    ...options(plan),
    rpc: primary,
    historicalCodeRpc: historical,
  });
  assert.deepEqual(result.blockers, []);
  assert.equal(
    primary.calls.some((x) => x.method === "eth_getCode"),
    false,
  );
  assert.ok(
    historical.calls.every(
      (x) =>
        x.method === "eth_chainId" ||
        (x.method === "eth_getBlockByNumber" && x.params[0] === "0x64") ||
        (x.method === "eth_getCode" && x.params[1] === "0x64"),
    ),
  );
  assert.equal(
    result.networkRequests,
    primary.calls.length + historical.calls.length,
  );
  await assert.rejects(
    inspectV10Preflight({
      ...options(plan),
      rpc: fakeRpc(),
      historicalCodeRpc: fakeRpc((m, p, v) =>
        m === "eth_chainId" ? "0x2" : v,
      ),
    }),
    { code: "WRONG_CHAIN" },
  );
  await assert.rejects(
    inspectV10Preflight({
      ...options(plan),
      rpc: fakeRpc(),
      historicalCodeRpc: fakeRpc((m, p, v) =>
        m === "eth_getBlockByNumber"
          ? { ...v, hash: ethers.id("foreign fork") }
          : v,
      ),
    }),
    { code: "CANONICAL_HEAD_CHANGED" },
  );
  assert.equal(
    validateV10PreflightRpcUrl("https://eth.drpc.org", true).hostname,
    "eth.drpc.org",
  );
  for (const url of [
    "https://eth.drpc.org?token=x",
    "https://x@eth.drpc.org",
    "http://eth.drpc.org",
    "https://eth.drpc.org/path",
    "https://eth.drpc.org.evil.invalid",
    "https://eth.drpc.org:123",
  ])
    assert.throws(() => validateV10PreflightRpcUrl(url, true), {
      code: "INVALID_PUBLIC_RPC",
    });
  assert.throws(() => validateV10PreflightRpcUrl("https://eth.drpc.org"), {
    code: "INVALID_PUBLIC_RPC",
  });
});
