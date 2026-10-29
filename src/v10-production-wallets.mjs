// Compiler-free, unpublished V10 local application candidate.
// This source revision is not authorized for publication without full-app acceptance.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { hash } from "./utils.mjs";
import { verifyV10ArtifactSources } from "./v10-upgrade-artifacts.mjs";
import {
  createV10WalletCompatibility,
  METAMASK_V130,
} from "./v10-wallet-compatibility.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROFILE = "kleros-event-v10-uups",
  N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const V10_WALLET_SUPPORT = Object.freeze({
  type: "eoa-or-metamask-protected-self-v1.3",
  eoa: true,
  eip7702: true,
  erc1271: false,
  accountPolicyVersion: "v10-metamask-self-v1.3-1",
});
export const V10_WALLET_CAPABILITIES = Object.freeze({
  production: true,
  browserWallet: true,
  walletTransactions: true,
  serverSigning: false,
  eip7702: true,
  erc1271: false,
  contractWallets: false,
  supportedAccountTypes: Object.freeze(["eoa", "metamask-protected-self-v1.3"]),
});
// Only reviewed SOURCE can select this candidate. No constructor, manifest,
// environment or browser boolean can enable a different account policy.
export const V10_LOCAL_WALLET_CANDIDATE = Object.freeze({
  status: "local-candidate-unpublished",
  publicationAuthorized: false,
  fullAppAcceptance: Object.freeze({ status: "pending", proofSha256: null }),
  sourceProofSha256:
    "7108974bc07ca8b46964d855887d9c26c1891386d21c5cf1bdb3f628fb7cb17c",
  type2ProtocolProofSha256:
    "11ac36fe9af1158934012175c453dd9056e55962b644090d6c065497beea9ad3",
  type4ProtocolProofSha256:
    "70949d17ee7722e0e9be0a8cbadee2e4f1203f6e4670cf6a75ca0140eda7ab7f",
});
const DELEGATED_FINANCIAL_ACTIVATION = V10_LOCAL_WALLET_CANDIDATE;
const FILES = Object.freeze({
  source: [
    "artifacts/v10-integration/metamask-source-verification-6ea176ca-3ea1-49eb-a290-1013d6492a15.json",
    "7108974bc07ca8b46964d855887d9c26c1891386d21c5cf1bdb3f628fb7cb17c",
  ],
  type2: [
    "artifacts/v10-integration/eip7702/2026-10-29T16-40-03.581Z-d5123ece-de5d-4d69-a5a0-1d5a2236535c/proof.json",
    "11ac36fe9af1158934012175c453dd9056e55962b644090d6c065497beea9ad3",
  ],
  type4: [
    "artifacts/v10-integration/type4-protected/2026-10-29T17-19-46.899Z-0d5838d5-4291-4ba5-990d-e72bba6a65e8/proof.json",
    "70949d17ee7722e0e9be0a8cbadee2e4f1203f6e4670cf6a75ca0140eda7ab7f",
  ],
  sourceScript: [
    "scripts/verify-metamask-v1.3-runtime.mjs",
    "ed5a6bdaff07ac3cbae55e8f58899df738dace1ce42b48fb018c709649cea50c",
  ],
  type2Harness: [
    "test/v10-eip7702.e2e.mjs",
    "d668bcfeee47e8063386086664562e9da337868cc30328000fb5b0bf608d2522",
  ],
  type4Harness: [
    "test/v10-type4-protected.e2e.mjs",
    "bbefa6e9bc64f2afad86804133049c5889524b50a4b5a79e22018fb308285096",
  ],
  compatibility: [
    "src/v10-wallet-compatibility.mjs",
    "12a6d577b443e69c869b5bebec72863c809ea9cda35f5c4c6465d82f228c8485",
  ],
  observed: [
    "artifacts/v10-integration/metamask-runtime-observed.json",
    "486913a5210ab05284468ce4a4efa2d9f279de44e120aadf3718d957678495eb",
  ],
});
const fixed = {
  manager: METAMASK_V130.manager,
  delegate: METAMASK_V130.delegate,
  nativeBalanceEnforcer: METAMASK_V130.nativeBalanceChangeEnforcer,
};
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const check = (ok, code = "V10_WALLET_SCOPE", status = 409) => {
  if (!ok)
    throw Object.assign(
      new Error(
        "V10 wallet policy is unavailable for this reviewed account or transaction",
      ),
      { code, status },
    );
};
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
const quantity = (value) => {
  check(
    typeof value === "string" && /^0x(?:0|[1-9a-f][a-f0-9]*)$/i.test(value),
    "V10_TRANSACTION_CODEC",
  );
  return BigInt(value);
};
const snapshot = (tx) =>
  hash(
    Object.fromEntries(
      [
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
      ].map((key) => [key, tx[key]]),
    ),
  );
function authorizationView(raw) {
  check(
    exact(raw, ["address", "chainId", "nonce", "yParity", "r", "s"]),
    "V10_TRANSACTION_CODEC",
  );
  for (const key of ["r", "s"]) {
    const n = quantity(raw[key]);
    check(
      raw[key].length <= 66 && n > 0n && (key === "r" ? n < N : n <= N / 2n),
      "V10_TRANSACTION_CODEC",
    );
  }
  const view = {
    ...raw,
    r: ethers.toBeHex(BigInt(raw.r), 32),
    s: ethers.toBeHex(BigInt(raw.s), 32),
  };
  check(
    BigInt(view.r) === BigInt(raw.r) && BigInt(view.s) === BigInt(raw.s),
    "V10_TRANSACTION_CODEC",
  );
  return view;
}
// Node-only codec projection. It never mutates the canonical raw/provider object.
export function projectV10CanonicalTransaction(raw) {
  try {
    const before = hash(raw),
      type = Number(quantity(raw.type)),
      chainId = quantity(raw.chainId),
      nonce = quantity(raw.nonce);
    check(
      [0, 1, 2, 4].includes(type) &&
        chainId === 1n &&
        nonce <= BigInt(Number.MAX_SAFE_INTEGER),
      "V10_TRANSACTION_CODEC",
    );
    const auth = raw.authorizationList == null ? [] : raw.authorizationList;
    check(
      Array.isArray(auth) &&
        (type === 4 ? auth.length === 1 : auth.length === 0),
      "V10_TRANSACTION_CODEC",
    );
    const views = auth.map(authorizationView),
      parity =
        raw.yParity === undefined
          ? Number(quantity(raw.v))
          : Number(quantity(raw.yParity));
    const fields = {
      type,
      chainId,
      nonce: Number(nonce),
      to: raw.to,
      value: quantity(raw.value),
      data: raw.input,
      gasLimit: quantity(raw.gas),
      signature: { r: raw.r, s: raw.s, v: parity < 2 ? parity + 27 : parity },
      ...(type === 0 || type === 1
        ? { gasPrice: quantity(raw.gasPrice) }
        : {
            maxFeePerGas: quantity(raw.maxFeePerGas),
            maxPriorityFeePerGas: quantity(raw.maxPriorityFeePerGas),
          }),
      ...(type > 0 ? { accessList: raw.accessList } : {}),
    };
    const recreate = (list) =>
      ethers.Transaction.from({
        ...fields,
        ...(type === 4
          ? {
              authorizationList: list.map((a) => ({
                address: a.address,
                chainId: quantity(a.chainId),
                nonce: quantity(a.nonce),
                signature: {
                  r: a.r,
                  s: a.s,
                  yParity: Number(quantity(a.yParity)),
                },
              })),
            }
          : {}),
      });
    const original = recreate(auth),
      projected = recreate(views);
    check(
      same(original.hash, raw.hash) &&
        same(projected.hash, raw.hash) &&
        same(original.from, raw.from) &&
        same(projected.from, raw.from) &&
        hash(raw) === before,
      "V10_TRANSACTION_CODEC",
    );
    return {
      hash: raw.hash,
      from: raw.from,
      to: raw.to,
      data: raw.input,
      value: raw.value,
      chainId: raw.chainId,
      type: raw.type,
      nonce: raw.nonce,
      ...(type === 4 ? { authorizationList: views } : {}),
    };
  } catch (error) {
    if (error?.code === "V10_TRANSACTION_CODEC") throw error;
    check(false, "V10_TRANSACTION_CODEC");
  }
}
function evidence(manifest) {
  try {
    const loaded = {};
    for (const [name, [file, expected]] of Object.entries(FILES)) {
      const target = ROOT + file;
      check(
        fs.lstatSync(target).isFile() && fs.realpathSync(target) === target,
        "V10_WALLET_EVIDENCE",
      );
      const bytes = fs.readFileSync(target);
      check(hash(bytes) === expected, "V10_WALLET_EVIDENCE");
      if (["source", "type2", "type4", "observed"].includes(name))
        loaded[name] = JSON.parse(bytes);
    }
    verifyV10ArtifactSources(manifest.provenance);
    const { source, type2, type4, observed } = loaded;
    check(
      source.sourceVerified === true &&
        source.status === "verified" &&
        source.chainId === 1 &&
        source.officialSourceCommit ===
          "bfbdf9795a976833ed2fa000baf42fbb83958b03",
      "V10_WALLET_EVIDENCE",
    );
    for (const p of [type2, type4])
      check(
        p.passed === true &&
          p.chainId === 1 &&
          p.publicNetworkRequests === 0 &&
          p.keysPersisted === false &&
          p.walletCodeFixtureShortcut === false &&
          p.source.compatibilitySha256 === FILES.compatibility[1] &&
          p.source.observedRuntimeFileSha256 === FILES.observed[1] &&
          p.source.v10BuildManifestSha256 ===
            manifest.provenance.v10BuildManifestSha256 &&
          p.source.v10StandardInputSha256 ===
            manifest.provenance.v10StandardInputSha256,
        "V10_WALLET_EVIDENCE",
      );
    check(
      type2.source.harnessSha256 === FILES.type2Harness[1] &&
        type4.source.harnessSha256 === FILES.type4Harness[1] &&
        type2.result.actualType4 === true &&
        type4.result.actualType4ProtectedExecution === true &&
        type4.authorizationChecks.length === 3 &&
        type4.authorizationChecks.every(
          (x) =>
            x.signerMatchesAuthority &&
            x.canonicalRawUnchanged &&
            x.signedTransactionHashBeforeAndAfterMatchesCanonical,
        ),
      "V10_WALLET_EVIDENCE",
    );
    const framework = Object.entries(fixed).map(([name, address]) => {
      const row = observed.contracts.filter((x) => x.name === name),
        s = source.contracts.filter((x) => x.name === name);
      check(
        row.length === 1 &&
          s.length === 1 &&
          same(row[0].address, address) &&
          same(s[0].address, address) &&
          s[0].sourceVerified &&
          s[0].fullObservedRuntimeMatches &&
          s[0].compiledTemplateMatches &&
          ethers.keccak256(row[0].code) === row[0].codeHash &&
          row[0].codeHash === s[0].runtimeCodeHash &&
          [type2, type4].every((p) =>
            p.fixtures.some(
              (x) =>
                x.name === name &&
                same(x.address, address) &&
                x.codeHash === row[0].codeHash,
            ),
          ),
        "V10_WALLET_EVIDENCE",
      );
      return { name, address, codeHash: row[0].codeHash, code: row[0].code };
    });
    return framework;
  } catch {
    check(false, "V10_WALLET_EVIDENCE");
  }
}

export function createV10ProductionWallets(input) {
  check(exact(input, ["chain", "origin", "instanceId"]));
  const { chain, origin, instanceId } = input;
  check(chain?.manifest && typeof chain.manifest === "object");
  const manifestHash = hash(chain.manifest);
  let u;
  try {
    u = new URL(origin);
  } catch {
    check(false);
  }
  check(
    chain?.production === true &&
      chain.chainId === 1 &&
      chain.manifest?.factoryDeployment?.contractVersion === PROFILE &&
      chain.manifest.factoryDeployment.abiVersion === PROFILE &&
      u.protocol === "https:" &&
      u.origin === origin &&
      !u.username &&
      !u.password &&
      /^[A-Za-z0-9_-]{1,200}$/.test(instanceId),
  );
  const rpc = async (method, params) => {
    try {
      return await chain.provider.send(method, params);
    } catch {
      check(false, "V10_WALLET_UNAVAILABLE", 503);
    }
  };
  const header = (raw) => {
    check(
      raw &&
        ethers.isHexString(raw.hash, 32) &&
        quantity(raw.number) > 0n &&
        quantity(raw.number) <= BigInt(Number.MAX_SAFE_INTEGER),
      "V10_WALLET_REORG",
    );
    return {
      blockNumber: Number(quantity(raw.number)),
      blockHash: raw.hash.toLowerCase(),
    };
  };
  async function classifyWallet(wallet, observation = null) {
    check(hash(chain.manifest) === manifestHash && ethers.isAddress(wallet));
    wallet = ethers.getAddress(wallet);
    check(BigInt(await rpc("eth_chainId", [])) === 1n, "WRONG_CHAIN");
    const at = header(await rpc("eth_getBlockByNumber", ["latest", false])),
      tag = ethers.toQuantity(at.blockNumber),
      code = await rpc("eth_getCode", [wallet, tag]);
    check(ethers.isHexString(code), "V10_WALLET_UNAVAILABLE", 503);
    if (observation !== null)
      check(
        exact(observation, ["blockNumber", "blockHash", "code"]) &&
          observation.blockNumber === at.blockNumber &&
          same(observation.blockHash, at.blockHash) &&
          same(observation.code, code),
        "V10_WALLET_REORG",
      );
    let accountType = "unsupported",
      framework = null;
    if (code === "0x") accountType = "eoa";
    else if (same(code, ethers.concat(["0xef0100", METAMASK_V130.delegate]))) {
      framework = evidence(chain.manifest);
      for (const f of framework)
        check(
          ethers.keccak256(await rpc("eth_getCode", [f.address, tag])) ===
            f.codeHash,
          "V10_WALLET_FRAMEWORK_CHANGED",
        );
      accountType = "metamask-protected-self-v1.3";
    }
    const closing = header(await rpc("eth_getBlockByNumber", [tag, false]));
    check(
      closing.blockNumber === at.blockNumber &&
        same(closing.blockHash, at.blockHash),
      "V10_WALLET_REORG",
    );
    check(
      BigInt(await rpc("eth_chainId", [])) === 1n &&
        hash(chain.manifest) === manifestHash,
      "WRONG_CHAIN",
    );
    return {
      wallet,
      ...at,
      codeHash: ethers.keccak256(code),
      financialEligible: false,
      accountType,
      code,
      framework,
      scope: {
        contractVersion: PROFILE,
        chainId: 1,
        manifestHash,
        origin,
        instanceId,
      },
      delegatedFinancialActivation: DELEGATED_FINANCIAL_ACTIVATION,
    };
  }
  async function assertWallet(wallet, observation = null) {
    const facts = await classifyWallet(wallet, observation);
    const reviewedCandidate =
      DELEGATED_FINANCIAL_ACTIVATION === V10_LOCAL_WALLET_CANDIDATE &&
      V10_LOCAL_WALLET_CANDIDATE.status === "local-candidate-unpublished" &&
      V10_LOCAL_WALLET_CANDIDATE.publicationAuthorized === false &&
      facts.accountType === "metamask-protected-self-v1.3" &&
      facts.framework?.length === 3;
    check(
      facts.accountType === "eoa" || reviewedCandidate,
      "UNSUPPORTED_WALLET",
      422,
    );
    return {
      wallet: facts.wallet,
      blockNumber: facts.blockNumber,
      blockHash: facts.blockHash,
      codeHash: facts.codeHash,
      financialEligible: true,
      accountType: facts.accountType,
    };
  }
  async function inspectTransaction({ scope, actual, expected }, submitted) {
    check(
      exact(scope, [
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
      ]) &&
        scope.manifestHash === manifestHash &&
        scope.origin === origin &&
        scope.instanceId === instanceId &&
        scope.contractVersion === PROFILE &&
        scope.abiVersion === PROFILE &&
        scope.chainId === 1 &&
        scope.mode === "hosted-production" &&
        exact(expected, [
          "chainId",
          "transactionHash",
          "from",
          "to",
          "valueWei",
          "data",
        ]) &&
        same(scope.wallet, expected.from) &&
        same(scope.contract, expected.to) &&
        same(actual?.hash, expected.transactionHash),
      "V10_WALLET_SCOPE",
    );
    check(BigInt(await rpc("eth_chainId", [])) === 1n, "WRONG_CHAIN");
    const actualBefore = snapshot(actual),
      raw = await rpc("eth_getTransactionByHash", [actual.hash]);
    check(
      raw && (submitted || (raw.blockHash && raw.blockNumber)),
      "V10_TRANSACTION_UNCONFIRMED",
    );
    const rawBefore = hash(raw),
      view = projectV10CanonicalTransaction(raw);
    check(
      same(actual.hash, raw.hash) &&
        same(actual.from, raw.from) &&
        same(actual.to, raw.to) &&
        same(actual.data, raw.input) &&
        BigInt(actual.value) === quantity(raw.value) &&
        BigInt(actual.chainId) === 1n &&
        Number(actual.nonce) === Number(quantity(raw.nonce)) &&
        Number(actual.type) === Number(quantity(raw.type)),
      "V10_INTENT_MISMATCH",
    );
    let executionCode,
      framework = null,
      currentFacts = null;
    if (submitted) {
      // Signed intent is not execution. First-time pending type4 authorization
      // remains conservatively unverified while current account code is empty.
      currentFacts = await classifyWallet(scope.wallet);
      check(
        !(
          Number(quantity(raw.type)) === 4 && currentFacts.accountType === "eoa"
        ),
        "V10_TRANSACTION_UNCONFIRMED",
      );
      check(
        currentFacts.accountType === "eoa" ||
          currentFacts.accountType === "metamask-protected-self-v1.3",
        "UNSUPPORTED_WALLET",
        422,
      );
      executionCode = currentFacts.code;
      framework = currentFacts.framework;
    } else {
      // Historical facts do not borrow current wallet eligibility. Revocation
      // cannot erase a known canonical receipt from the reviewed delegation.
      const at = header(
        await rpc("eth_getBlockByNumber", [raw.blockNumber, false]),
      );
      check(
        at.blockNumber === Number(quantity(raw.blockNumber)) &&
          same(at.blockHash, raw.blockHash),
        "V10_TRANSACTION_REORG",
      );
      executionCode = await rpc("eth_getCode", [scope.wallet, raw.blockNumber]);
      if (
        same(executionCode, ethers.concat(["0xef0100", METAMASK_V130.delegate]))
      )
        framework = evidence(chain.manifest);
      if (framework)
        for (const f of framework)
          check(
            ethers.keccak256(
              await rpc("eth_getCode", [f.address, raw.blockNumber]),
            ) === f.codeHash,
            "V10_WALLET_FRAMEWORK_CHANGED",
          );
    }
    check(ethers.isHexString(executionCode), "V10_WALLET_UNAVAILABLE", 503);
    const helper = createV10WalletCompatibility({
      reviewedRuntimePins: framework
        ? {
            schemaVersion: 1,
            framework: METAMASK_V130.framework,
            version: METAMASK_V130.version,
            chainId: 1,
            manager: METAMASK_V130.manager,
            delegate: METAMASK_V130.delegate,
            nativeBalanceChangeEnforcer:
              METAMASK_V130.nativeBalanceChangeEnforcer,
            managerRuntimeHash: framework[0].codeHash,
            delegateRuntimeHash: framework[1].codeHash,
            nativeBalanceChangeRuntimeHash: framework[2].codeHash,
            reviewId: FILES.source[1],
          }
        : null,
    });
    const helperScope = { ...scope };
    delete helperScope.manifestHash;
    const account = helper.classifyAccount({
        scope: helperScope,
        walletCode: executionCode,
        ...(framework
          ? {
              managerRuntimeCode: framework[0].code,
              delegateRuntimeCode: framework[1].code,
              nativeBalanceChangeRuntimeCode: framework[2].code,
            }
          : {}),
      }),
      intent = helper.canonicalIntent({
        scope: helperScope,
        transaction: {
          from: expected.from,
          to: expected.to,
          data: expected.data,
          value: expected.valueWei,
          chainId: 1,
        },
      }),
      inspection = helper.inspectTransactionIntent({
        account,
        intent,
        transaction: view,
      });
    // Richer manager permissions remain outside this reviewed application route.
    check(
      inspection.route === "direct" ||
        inspection.route === "metamask-manager-protected-self-single",
      "V10_PERMISSION_UNSUPPORTED",
    );
    if (submitted) {
      const closing = header(
        await rpc("eth_getBlockByNumber", [
          ethers.toQuantity(currentFacts.blockNumber),
          false,
        ]),
      );
      check(
        closing.blockNumber === currentFacts.blockNumber &&
          same(closing.blockHash, currentFacts.blockHash) &&
          hash(raw) === rawBefore &&
          snapshot(actual) === actualBefore &&
          hash(chain.manifest) === manifestHash &&
          BigInt(await rpc("eth_chainId", [])) === 1n,
        "V10_TRANSACTION_REORG",
      );
      // Exactly seven intent facts. No receipt, execution or eligibility claim.
      return helper.factualIntentProof({ inspection, expected });
    }
    const receipt = await rpc("eth_getTransactionReceipt", [raw.hash]),
      at = header(await rpc("eth_getBlockByNumber", [raw.blockNumber, false]));
    check(
      receipt &&
        same(receipt.transactionHash, raw.hash) &&
        same(receipt.blockHash, raw.blockHash) &&
        receipt.blockNumber === raw.blockNumber &&
        same(at.blockHash, raw.blockHash) &&
        at.blockNumber === Number(quantity(raw.blockNumber)),
      "V10_TRANSACTION_REORG",
    );
    const closing = header(
      await rpc("eth_getBlockByNumber", [raw.blockNumber, false]),
    );
    check(
      closing.blockNumber === at.blockNumber &&
        same(closing.blockHash, raw.blockHash) &&
        hash(raw) === rawBefore &&
        snapshot(actual) === actualBefore &&
        hash(chain.manifest) === manifestHash &&
        BigInt(await rpc("eth_chainId", [])) === 1n,
      "V10_TRANSACTION_REORG",
    );
    return helper.factualIntentProof({ inspection, expected });
  }
  return Object.freeze({
    classifyWallet,
    assertWallet,
    inspectSubmittedTransaction: (input) => inspectTransaction(input, true),
    inspectReviewedTransaction: (input) => inspectTransaction(input, false),
  });
}
