// Original submitted creation facts only. No signing, simulation, adoption or store writes.
import { ethers } from "ethers";
import { hash } from "./utils.mjs";
import {
  eventV9LumaTemplate,
  V9_LUMA_ATTENDANCE_STANDARD,
} from "./contracts-v9-luma.mjs";

const PROFILE = "kleros-event-v9-uups";
const MANAGER = "0xdb9b1e94b5b69df7e401ddbede43491141047db3";
const CONFIG =
  "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
const FACTORY_ABI = new ethers.Interface([
  `function createEvent(bytes32 eventKey,${CONFIG} config) returns(address)`,
  "event EventCreated(bytes32 indexed eventId,address indexed creator,address indexed eventContract,bytes32 eventKey,uint256 version,bytes32 configurationHash)",
]);
const WRAPPER_ABI = new ethers.Interface([
  "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)",
]);
const SOURCE_KEYS = [
  "chainId",
  "contractVersion",
  "abiVersion",
  "factory",
  "factoryCodeHash",
  "factoryImplementation",
  "factoryImplementationCodeHash",
  "initialFactoryImplementation",
  "initialImplementation",
  "implementation",
  "implementationCodeHash",
  "upgradeAuthority",
  "upgradeAuthorityCodeHash",
  "initialUpgradeOwner",
  "factoryDeploymentTxHash",
  "factoryDeploymentBlock",
  "timelockDeploymentTxHash",
  "timelockDeploymentBlock",
];
const REVIEW_KEYS = [
  "scopeKind",
  "id",
  "eventId",
  "eventKey",
  "wallet",
  "sessionId",
  "instanceId",
  "chainId",
  "contractVersion",
  "abiVersion",
  "factory",
  "method",
  "args",
  "mode",
  "action",
  "contract",
  "valueWei",
  "terms",
  "config",
  "template",
  "transaction",
  "factorySource",
  "policyText",
  "factoryFingerprint",
  "registryHash",
  "snapshot",
  "createdAt",
  "expiresAt",
  "reviewBlock",
];
const CAPABILITIES = Object.freeze({
  financialReview: false,
  createEvents: false,
  validate: false,
  transactions: false,
  adopt: false,
  manage: false,
  deposit: false,
  replay: false,
});
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const address = (value) =>
  ethers.isAddress(value) && !same(value, ethers.ZeroAddress);
const digest = (value) =>
  ethers.isHexString(value, 32) && !same(value, ethers.ZeroHash);
const stable = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
class RecoveryError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (code = "CREATION_RECOVERY_MISMATCH", status = 409) => {
  const messages = {
    CREATION_RECOVERY_NOT_FOUND:
      "The original owned creation review is unavailable.",
    CREATION_RECOVERY_SCOPE:
      "This recovery belongs to another original creation review.",
    CREATION_RECOVERY_MISMATCH:
      "The original transaction differs from its saved creation review.",
    CREATION_RECOVERY_REORG:
      "The original transaction snapshot changed; preserve its hash.",
    CREATION_RECOVERY_UNAVAILABLE:
      "Original transaction facts are temporarily unavailable.",
    UNAUTHENTICATED: "Authenticate the original wallet for recovery only.",
  };
  throw new RecoveryError(code, status, messages[code]);
};
const check = (condition, code, status) => {
  if (!condition) fail(code, status);
};
function quantity(value) {
  check(
    typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value),
  );
  return BigInt(value);
}
function header(value) {
  check(value && digest(value.hash), "CREATION_RECOVERY_REORG", 409);
  const number = quantity(value.number),
    timestamp = quantity(value.timestamp);
  check(
    number > 0n &&
      number <= BigInt(Number.MAX_SAFE_INTEGER) &&
      timestamp <= BigInt(Number.MAX_SAFE_INTEGER),
    "CREATION_RECOVERY_REORG",
    409,
  );
  return {
    number: Number(number),
    timestamp: Number(timestamp),
    hash: value.hash.toLowerCase(),
  };
}

/** All dependencies are trusted server objects. The returned scope never authorizes a transaction. */
export function createFactoryCreationRecovery({
  chain,
  factoryDeployment,
  drafts,
  instanceId,
}) {
  check(
    chain?.chainId === 1 &&
      chain.production === true &&
      typeof chain.provider?.send === "function" &&
      drafts instanceof Map &&
      stable(instanceId) &&
      factoryDeployment?.chainId === 1 &&
      factoryDeployment.contractVersion === PROFILE &&
      factoryDeployment.abiVersion === PROFILE &&
      address(factoryDeployment.factory),
    "CREATION_RECOVERY_SCOPE",
    403,
  );
  const factory = structuredClone(factoryDeployment),
    resolver =
      factory.resolver ??
      chain.manifest?.arbitration?.resolver ??
      chain.resolver?.target,
    extraData =
      factory.arbitratorExtraData ?? chain.manifest?.arbitration?.extraData,
    factorySource = Object.fromEntries(
      SOURCE_KEYS.map((key) => [key, factory[key]]),
    );

  function originalReview(key, draft) {
    check(
      draft &&
        REVIEW_KEYS.every((name) => Object.hasOwn(draft, name)) &&
        key === draft.id &&
        stable(draft.id) &&
        stable(draft.eventId) &&
        stable(draft.sessionId) &&
        stable(draft.instanceId) &&
        address(draft.wallet) &&
        draft.scopeKind === "factory-create" &&
        draft.chainId === 1 &&
        draft.contractVersion === PROFILE &&
        draft.abiVersion === PROFILE &&
        same(draft.factory, factory.factory) &&
        same(draft.contract, factory.factory) &&
        draft.mode === "hosted-production" &&
        draft.action === "createEvent" &&
        draft.method === "createEvent" &&
        draft.valueWei === "0" &&
        draft.eventKey === ethers.id(draft.eventId) &&
        draft.factoryFingerprint === hash(factory) &&
        hash(draft.factorySource) === hash(factorySource) &&
        draft.registryHash === hash(factorySource) &&
        /^[a-f0-9]{64}$/.test(draft.snapshot) &&
        positive(draft.reviewBlock) &&
        positive(draft.createdAt) &&
        positive(draft.expiresAt) &&
        draft.expiresAt > draft.createdAt,
    );
    const terms = draft.terms,
      config = draft.config,
      tx = draft.transaction,
      policy = factory.policy;
    check(
      terms &&
        config?.arbitration &&
        tx &&
        policy &&
        factory.policyStatus === "published" &&
        typeof policy.text === "string" &&
        policy.text.length > 0 &&
        policy.sha256 === hash(policy.text) &&
        draft.policyText === policy.text &&
        terms.policyURI === policy.uri &&
        terms.policySha256 === policy.sha256 &&
        typeof terms.depositEth === "string" &&
        terms.depositWei === String(ethers.parseEther(terms.depositEth)) &&
        ethers.formatEther(terms.depositWei) === terms.depositEth &&
        terms.capacity === 150 &&
        terms.claimDays === 7 &&
        terms.challengeWindowSeconds === 86400 &&
        terms.matchWindowSeconds === 86400 &&
        positive(terms.eventStart) &&
        terms.eventStart === Date.parse(terms.startsAt) / 1000 &&
        terms.claimDeadline === terms.eventStart + 7 * 86400 &&
        hash(terms.attendanceStandard) === hash(V9_LUMA_ATTENDANCE_STANDARD),
    );
    const template = eventV9LumaTemplate({
      eventName: terms.title,
      depositAmount: terms.depositWei,
      policyURI: terms.policyURI,
      policySha256: terms.policySha256,
      lumaUrl: terms.lumaUrl,
      startsAt: terms.startsAt,
      endsAt: terms.endsAt,
      timezone: terms.timezone,
    });
    check(
      hash(template) === hash(draft.template) &&
        String(config.depositAmount) === terms.depositWei &&
        config.eventName === terms.title &&
        Number(config.eventStart) === terms.eventStart &&
        Number(config.claimDeadline) === terms.claimDeadline &&
        address(resolver) &&
        same(config.arbitration.disputeResolver, resolver) &&
        config.arbitration.extraData === extraData &&
        config.arbitration.policyURI === terms.policyURI &&
        hash(config.arbitration.metaEvidenceTemplate) ===
          hash(template.pieces) &&
        config.arbitration.metaEvidenceSlots === template.slots &&
        Array.isArray(draft.args) &&
        draft.args.length === 2 &&
        draft.args[0] === draft.eventKey &&
        hash(draft.args[1]) === hash(config),
    );
    const data = FACTORY_ABI.encodeFunctionData("createEvent", [
      draft.eventKey,
      config,
    ]);
    check(
      same(tx.from, draft.wallet) &&
        same(tx.to, factory.factory) &&
        tx.chainId === 1 &&
        tx.value === "0" &&
        tx.data === data &&
        typeof tx.gasLimit === "string" &&
        /^[1-9][0-9]*$/.test(tx.gasLimit) &&
        BigInt(tx.gasLimit) <= 16777216n,
    );
    const configurationHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", CONFIG],
          [draft.wallet, config],
        ),
      ),
      factoryEventId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32"],
          [1, factory.factory, draft.wallet, draft.eventKey],
        ),
      );
    return {
      draft,
      configurationHash,
      factoryEventId,
      reviewDigest: hash(
        Object.fromEntries(REVIEW_KEYS.map((name) => [name, draft[name]])),
      ),
    };
  }
  function selected(wallet, txHash) {
    try {
      check(
        address(wallet) && digest(txHash),
        "CREATION_RECOVERY_NOT_FOUND",
        404,
      );
      const matches = [...drafts].filter(
        ([, draft]) =>
          draft?.scopeKind === "factory-create" &&
          same(draft.wallet, wallet) &&
          same(draft.submittedHash, txHash) &&
          same(draft.factory, factory.factory) &&
          draft.chainId === 1 &&
          draft.contractVersion === PROFILE &&
          draft.abiVersion === PROFILE,
      );
      check(matches.length === 1, "CREATION_RECOVERY_NOT_FOUND", 404);
      return originalReview(...matches[0]);
    } catch {
      fail("CREATION_RECOVERY_NOT_FOUND", 404);
    }
  }
  function scopeFor(wallet, txHash) {
    const { draft, reviewDigest } = selected(wallet, txHash);
    return Object.freeze({
      wallet: ethers.getAddress(draft.wallet),
      hash: txHash.toLowerCase(),
      draftId: draft.id,
      eventId: draft.eventId,
      eventKey: draft.eventKey,
      factory: ethers.getAddress(factory.factory),
      profile: PROFILE,
      instanceId,
      reviewDigest,
    });
  }
  function envelopeOf(tx, draft, txHash) {
    check(
      same(tx.hash, txHash) &&
        same(tx.from, draft.wallet) &&
        quantity(tx.chainId) === 1n &&
        quantity(tx.value) === 0n,
    );
    const data = tx.input ?? tx.data;
    check(typeof data === "string" && ethers.isHexString(data));
    if (same(tx.to, factory.factory)) {
      check(same(data, draft.transaction.data));
      return "direct-create-event";
    }
    check(
      same(tx.to, MANAGER) &&
        quantity(tx.type) === 4n &&
        data.slice(0, 10).toLowerCase() === "0xcef6d209",
    );
    let decoded;
    try {
      decoded = WRAPPER_ABI.decodeFunctionData("redeemDelegations", data);
    } catch {
      fail();
    }
    check(
      decoded[0].length === 1 &&
        decoded[1].length === 1 &&
        decoded[2].length === 1 &&
        decoded[1][0] === ethers.ZeroHash &&
        same(
          WRAPPER_ABI.encodeFunctionData("redeemDelegations", decoded),
          data,
        ),
    );
    const execution = ethers.getBytes(decoded[2][0]);
    check(
      execution.length > 52 &&
        same(ethers.hexlify(execution.slice(0, 20)), factory.factory) &&
        BigInt(ethers.hexlify(execution.slice(20, 52))) === 0n &&
        same(ethers.hexlify(execution.slice(52)), draft.transaction.data),
    );
    return "single-redeem-delegations";
  }
  async function inspect(session) {
    check(
      session?.mode === "recovery-only" &&
        stable(session.id) &&
        address(session.wallet) &&
        session.recoveryScope,
      "UNAUTHENTICATED",
      401,
    );
    let scope, reviewed;
    try {
      scope = scopeFor(session.wallet, session.recoveryScope.hash);
      check(
        hash(session.recoveryScope) === hash(scope),
        "CREATION_RECOVERY_SCOPE",
        403,
      );
      reviewed = selected(scope.wallet, scope.hash);
    } catch {
      fail("CREATION_RECOVERY_SCOPE", 403);
    }
    const { draft } = reviewed,
      base = {
        schemaVersion: 1,
        kind: "factory-creation-recovery",
        scope,
        ...scope,
        chainId: 1,
        title: draft.terms.title,
        startsAt: draft.terms.startsAt,
        endsAt: draft.terms.endsAt,
        timezone: draft.terms.timezone,
        transactionConfirmed: false,
        transactionSucceeded: null,
        canonical: null,
        originalReviewMatches: null,
        child: null,
        blockNumber: null,
        blockHash: null,
        confirmations: null,
        envelope: null,
        provenance: "not-verified",
        capabilities: { ...CAPABILITIES },
      };
    const rpc = async (method, params = []) => {
      try {
        return await chain.provider.send(method, params);
      } catch {
        fail("CREATION_RECOVERY_UNAVAILABLE", 503);
      }
    };
    try {
      check(
        quantity(await rpc("eth_chainId")) === 1n,
        "CREATION_RECOVERY_SCOPE",
        403,
      );
      const [tx, receipt, rawHead] = await Promise.all([
          rpc("eth_getTransactionByHash", [scope.hash]),
          rpc("eth_getTransactionReceipt", [scope.hash]),
          rpc("eth_getBlockByNumber", ["latest", false]),
        ]),
        head = header(rawHead),
        anchors = new Map([[head.number, head.hash]]);
      let status = "transaction-not-found",
        envelope = null,
        child = null,
        receiptBlock = null;
      if (!tx) check(!receipt);
      if (tx) {
        envelope = envelopeOf(tx, draft, scope.hash);
        status = "transaction-pending";
        if (receipt) {
          check(tx.blockNumber !== null && receipt.blockNumber !== null);
          const number = quantity(receipt.blockNumber);
          check(
            number <= BigInt(head.number) && number > BigInt(draft.reviewBlock),
            "CREATION_RECOVERY_REORG",
            409,
          );
          check(
            same(receipt.transactionHash ?? receipt.hash, scope.hash) &&
              same(receipt.to, tx.to) &&
              same(receipt.from, tx.from) &&
              quantity(tx.blockNumber) === number &&
              same(tx.blockHash, receipt.blockHash),
          );
          const [mined, reviewedAt] = await Promise.all([
              rpc("eth_getBlockByNumber", [ethers.toQuantity(number), false]),
              rpc("eth_getBlockByNumber", [
                ethers.toQuantity(draft.reviewBlock),
                false,
              ]),
            ]),
            minedHeader = header(mined),
            reviewHeader = header(reviewedAt);
          check(
            minedHeader.number === Number(number) &&
              same(minedHeader.hash, receipt.blockHash) &&
              reviewHeader.number === draft.reviewBlock &&
              draft.terms.eventStart > reviewHeader.timestamp,
            "CREATION_RECOVERY_REORG",
            409,
          );
          for (const block of [minedHeader, reviewHeader]) {
            check(
              !anchors.has(block.number) ||
                same(anchors.get(block.number), block.hash),
              "CREATION_RECOVERY_REORG",
              409,
            );
            anchors.set(block.number, block.hash);
          }
          check(Array.isArray(receipt.logs));
          const eventTopic = FACTORY_ABI.getEvent("EventCreated").topicHash,
            logs = receipt.logs.filter(
              (log) =>
                same(log.address, factory.factory) &&
                same(log.topics?.[0], eventTopic),
            ),
            success = quantity(receipt.status);
          check(success === 0n || success === 1n);
          status =
            success === 1n
              ? "original-transaction-confirmed"
              : "original-transaction-reverted";
          if (success === 1n) {
            check(logs.length === 1);
            const log = logs[0];
            check(
              !log.removed &&
                same(log.transactionHash, scope.hash) &&
                same(log.blockHash, minedHeader.hash) &&
                quantity(log.blockNumber) === number &&
                quantity(log.logIndex) >= 0n,
            );
            const parsed = FACTORY_ABI.parseLog(log);
            check(
              parsed &&
                same(parsed.args.eventId, reviewed.factoryEventId) &&
                same(parsed.args.creator, draft.wallet) &&
                address(parsed.args.eventContract) &&
                same(parsed.args.eventKey, draft.eventKey) &&
                parsed.args.version === 9n &&
                same(parsed.args.configurationHash, reviewed.configurationHash),
            );
            child = ethers.getAddress(parsed.args.eventContract);
            if (draft.createdContract !== undefined)
              check(same(draft.createdContract, child));
          } else check(logs.length === 0);
          receiptBlock = {
            number: minedHeader.number,
            hash: minedHeader.hash,
            success: success === 1n,
          };
        } else check(tx.blockNumber === null && tx.blockHash === null);
      }
      await Promise.all(
        [...anchors].map(async ([number, expected]) => {
          const canonical = header(
            await rpc("eth_getBlockByNumber", [
              ethers.toQuantity(number),
              false,
            ]),
          );
          check(
            canonical.number === number && same(canonical.hash, expected),
            "CREATION_RECOVERY_REORG",
            409,
          );
        }),
      );
      check(
        quantity(await rpc("eth_chainId")) === 1n,
        "CREATION_RECOVERY_SCOPE",
        403,
      );
      check(
        session.mode === "recovery-only" &&
          hash(session.recoveryScope) === hash(scope) &&
          hash(scopeFor(session.wallet, scope.hash)) === hash(scope),
        "CREATION_RECOVERY_SCOPE",
        403,
      );
      return {
        ...base,
        status,
        envelope,
        child,
        ...(receiptBlock
          ? {
              transactionConfirmed: true,
              transactionSucceeded: receiptBlock.success,
              canonical: true,
              originalReviewMatches: true,
              blockNumber: receiptBlock.number,
              blockHash: receiptBlock.hash,
              confirmations: head.number - receiptBlock.number + 1,
            }
          : {}),
      };
    } catch (error) {
      if (error instanceof RecoveryError) throw error;
      fail("CREATION_RECOVERY_MISMATCH", 409);
    }
  }
  return Object.freeze({ scopeFor, inspect });
}
