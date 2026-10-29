// Synthetic raw-RPC facts only. No sockets, wallet keys, signing, services or public chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { createFactoryCreationRecovery } from "../src/creation-recovery.mjs";
import {
  eventV9LumaTemplate,
  V9_LUMA_ATTENDANCE_STANDARD,
} from "../src/contracts-v9-luma.mjs";
import { hash } from "../src/utils.mjs";

const PROFILE = "kleros-event-v9-uups",
  MANAGER = "0xdb9b1e94b5b69df7e401ddbede43491141047db3";
const CONFIG =
  "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
const factoryAbi = new ethers.Interface([
  `function createEvent(bytes32 eventKey,${CONFIG} config) returns(address)`,
  "event EventCreated(bytes32 indexed eventId,address indexed creator,address indexed eventContract,bytes32 eventKey,uint256 version,bytes32 configurationHash)",
]);
const wrapperAbi = new ethers.Interface([
  "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)",
]);
const sourceKeys = [
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
const address = (n) =>
  ethers.getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const id = (value) => ethers.id(`synthetic-recovery-${value}`);
const code = (expected) => (error) => error.code === expected;
const snapshot = (f) => hash(JSON.stringify([...f.drafts]));

function fixture() {
  const wallet = address(1),
    child = address(8),
    originalHash = id("original-hash"),
    policy = {
      text: "Synthetic reviewed recovery policy",
      uri: "https://example.invalid/approved-policy",
    };
  policy.sha256 = hash(policy.text);
  const factory = {
    chainId: 1,
    contractVersion: PROFILE,
    abiVersion: PROFILE,
    factory: address(2),
    factoryCodeHash: id("proxy-code"),
    factoryImplementation: address(4),
    factoryImplementationCodeHash: id("factory-implementation-code"),
    initialFactoryImplementation: address(4),
    initialImplementation: address(3),
    implementation: address(3),
    implementationCodeHash: id("implementation-code"),
    upgradeAuthority: address(5),
    upgradeAuthorityCodeHash: id("authority-code"),
    initialUpgradeOwner: address(6),
    factoryDeploymentTxHash: id("factory-birth"),
    factoryDeploymentBlock: 10,
    timelockDeploymentTxHash: id("timelock-birth"),
    timelockDeploymentBlock: 9,
    policy,
    policyStatus: "published",
  };
  const terms = {
      title: "Synthetic owned original event",
      lumaUrl: "https://luma.com/synthetic-owned-event",
      startsAt: new Date(2_000_003_600_000).toISOString(),
      endsAt: new Date(2_000_007_200_000).toISOString(),
      timezone: "Asia/Bangkok",
      depositEth: "0.001",
      depositWei: "1000000000000000",
      eventStart: 2_000_003_600,
      claimDeadline: 2_000_003_600 + 7 * 86400,
      claimDays: 7,
      capacity: 150,
      challengeWindowSeconds: 86400,
      matchWindowSeconds: 86400,
      attendanceStandard: { ...V9_LUMA_ATTENDANCE_STANDARD },
      policyURI: policy.uri,
      policySha256: policy.sha256,
    },
    template = eventV9LumaTemplate({
      eventName: terms.title,
      depositAmount: terms.depositWei,
      policyURI: terms.policyURI,
      policySha256: terms.policySha256,
      lumaUrl: terms.lumaUrl,
      startsAt: terms.startsAt,
      endsAt: terms.endsAt,
      timezone: terms.timezone,
    }),
    extraData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [0, 3],
    ),
    config = {
      depositAmount: terms.depositWei,
      eventName: terms.title,
      eventStart: terms.eventStart,
      claimDeadline: terms.claimDeadline,
      arbitration: {
        disputeResolver: address(7),
        extraData,
        metaEvidenceTemplate: template.pieces,
        metaEvidenceSlots: template.slots,
        policyURI: policy.uri,
      },
    },
    source = Object.fromEntries(sourceKeys.map((key) => [key, factory[key]])),
    eventId = "event-synthetic-original",
    eventKey = ethers.id(eventId),
    data = factoryAbi.encodeFunctionData("createEvent", [eventKey, config]),
    draft = {
      scopeKind: "factory-create",
      id: "draft-original",
      eventId,
      eventKey,
      wallet,
      sessionId: "old-session",
      instanceId: "old-server",
      chainId: 1,
      contractVersion: PROFILE,
      abiVersion: PROFILE,
      factory: factory.factory,
      mode: "hosted-production",
      action: "createEvent",
      method: "createEvent",
      args: [eventKey, structuredClone(config)],
      contract: factory.factory,
      valueWei: "0",
      terms,
      config,
      template,
      transaction: {
        from: wallet,
        to: factory.factory,
        data,
        value: "0",
        chainId: 1,
        gasLimit: "2000000",
      },
      factorySource: source,
      policyText: policy.text,
      factoryFingerprint: hash(factory),
      registryHash: hash(source),
      snapshot: hash("reviewed-factory"),
      createdAt: 2_000_000_000_000,
      expiresAt: 2_000_000_300_000,
      reviewBlock: 100,
      status: "pending",
      used: false,
      submittedHash: originalHash,
    };
  const headers = new Map(
      [100, 110, 120].map((number) => [
        ethers.toQuantity(number),
        {
          number: ethers.toQuantity(number),
          timestamp: ethers.toQuantity(2_000_000_000 + number),
          hash: id(`block-${number}`),
        },
      ]),
    ),
    transaction = {
      hash: originalHash,
      from: wallet,
      to: factory.factory,
      input: data,
      chainId: "0x1",
      type: "0x2",
      value: "0x0",
      nonce: "0x4",
      blockNumber: "0x6e",
      blockHash: headers.get("0x6e").hash,
    };
  const factoryEventId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "address", "bytes32"],
        [1, factory.factory, wallet, eventKey],
      ),
    ),
    configurationHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", CONFIG],
        [wallet, config],
      ),
    );
  function eventLog(change = {}) {
    const args = {
        eventId: factoryEventId,
        creator: wallet,
        child,
        eventKey,
        version: 9,
        configurationHash,
        ...change,
      },
      encoded = factoryAbi.encodeEventLog(factoryAbi.getEvent("EventCreated"), [
        args.eventId,
        args.creator,
        args.child,
        args.eventKey,
        args.version,
        args.configurationHash,
      ]);
    return {
      ...encoded,
      address: factory.factory,
      logIndex: "0x1",
      blockNumber: "0x6e",
      blockHash: headers.get("0x6e").hash,
      transactionHash: originalHash,
      removed: false,
    };
  }
  const receipt = {
      transactionHash: originalHash,
      from: wallet,
      to: factory.factory,
      blockNumber: "0x6e",
      blockHash: headers.get("0x6e").hash,
      status: "0x1",
      logs: [eventLog()],
    },
    drafts = new Map([[draft.id, draft]]),
    calls = [];
  const f = {
    factory,
    wallet,
    child,
    originalHash,
    draft,
    drafts,
    transaction,
    receipt,
    headers,
    calls,
    eventLog,
    fault: null,
  };
  const chain = {
    chainId: 1,
    production: true,
    manifest: { arbitration: { resolver: address(7), extraData } },
    provider: {
      async send(method, params = []) {
        calls.push({ method, params: structuredClone(params) });
        if (f.fault) {
          const special = await f.fault(method, params);
          if (special !== undefined) return structuredClone(special);
        }
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_getTransactionByHash") {
          assert.equal(params[0], originalHash);
          return structuredClone(f.transaction);
        }
        if (method === "eth_getTransactionReceipt") {
          assert.equal(params[0], originalHash);
          return structuredClone(f.receipt);
        }
        if (method === "eth_getBlockByNumber")
          return structuredClone(
            headers.get(params[0] === "latest" ? "0x78" : params[0]),
          );
        throw Error("Forbidden synthetic RPC method");
      },
    },
  };
  f.service = createFactoryCreationRecovery({
    chain,
    factoryDeployment: factory,
    drafts,
    instanceId: "recovery-server",
  });
  f.session = () => ({
    id: "recovery-session",
    wallet,
    mode: "recovery-only",
    recoveryScope: f.service.scopeFor(wallet, originalHash),
  });
  f.wrapper = ({
    target = factory.factory,
    value = 0n,
    innerData = data,
    contexts = ["0x" + "ab".repeat(65)],
    modes = [ethers.ZeroHash],
    executions,
  } = {}) => {
    const packed = ethers.solidityPacked(
      ["address", "uint256", "bytes"],
      [target, value, innerData],
    );
    f.transaction.to = MANAGER;
    f.transaction.type = "0x4";
    f.transaction.input = wrapperAbi.encodeFunctionData("redeemDelegations", [
      contexts,
      modes,
      executions ?? [packed],
    ]);
    f.receipt.to = MANAGER;
  };
  return f;
}

function factualOnly(dto) {
  assert.equal(dto.provenance, "not-verified");
  assert.ok(Object.values(dto.capabilities).every((value) => value === false));
  assert.equal(Object.hasOwn(dto, "transaction"), false);
  assert.equal(Object.hasOwn(dto, "participantUrl"), false);
  assert.equal(Object.hasOwn(dto, "manageUrl"), false);
  assert.equal(
    /permissionContexts|executionCallDatas|authorizationList|privateKey/.test(
      JSON.stringify(dto),
    ),
    false,
  );
}

test("direct original creation yields immutable scoped facts only and leaves reviewed state byte-identical", async () => {
  const f = fixture(),
    before = snapshot(f),
    scope = f.service.scopeFor(f.wallet, f.originalHash);
  assert.equal(Object.isFrozen(scope), true);
  assert.deepEqual(
    Object.keys(scope).sort(),
    [
      "wallet",
      "hash",
      "draftId",
      "eventId",
      "eventKey",
      "factory",
      "profile",
      "instanceId",
      "reviewDigest",
    ].sort(),
  );
  assert.equal(
    f.calls.length,
    0,
    "scope selection is synchronous and provider-free",
  );
  const dto = await f.service.inspect(f.session());
  assert.equal(dto.status, "original-transaction-confirmed");
  assert.equal(dto.envelope, "direct-create-event");
  assert.equal(dto.transactionConfirmed, true);
  assert.equal(dto.transactionSucceeded, true);
  assert.equal(dto.canonical, true);
  assert.equal(dto.originalReviewMatches, true);
  assert.equal(dto.child, f.child);
  assert.equal(dto.confirmations, 11);
  assert.equal(dto.title, f.draft.terms.title);
  assert.equal(dto.startsAt, f.draft.terms.startsAt);
  assert.equal(dto.endsAt, f.draft.terms.endsAt);
  assert.equal(dto.timezone, f.draft.terms.timezone);
  assert.deepEqual(dto.scope, scope);
  factualOnly(dto);
  assert.equal(snapshot(f), before);
  assert.ok(
    f.calls.every(({ method }) =>
      [
        "eth_chainId",
        "eth_getTransactionByHash",
        "eth_getTransactionReceipt",
        "eth_getBlockByNumber",
      ].includes(method),
    ),
  );
});

test("one zero-value EIP7702 redeemDelegations execution can prove original transaction facts without adoption", async () => {
  const f = fixture();
  f.wrapper();
  const before = snapshot(f),
    dto = await f.service.inspect(f.session());
  assert.equal(f.transaction.input.slice(0, 10), "0xcef6d209");
  assert.equal(dto.status, "original-transaction-confirmed");
  assert.equal(dto.envelope, "single-redeem-delegations");
  assert.equal(dto.child, f.child);
  factualOnly(dto);
  assert.equal(snapshot(f), before);
});

test("wrapper target, mode, counts, values, packed bytes and exact original calldata fail closed", async () => {
  const mutations = [
    (f) => {
      f.transaction.to = address(9);
      f.receipt.to = address(9);
    },
    (f) => {
      f.transaction.value = "0x1";
    },
    (f) => {
      f.transaction.type = "0x2";
    },
    (f) => f.wrapper({ modes: [id("unsupported-mode")] }),
    (f) => f.wrapper({ contexts: ["0x", "0x"] }),
    (f) => f.wrapper({ modes: [ethers.ZeroHash, ethers.ZeroHash] }),
    (f) => f.wrapper({ executions: ["0x00", "0x00"] }),
    (f) => f.wrapper({ executions: ["0x1234"] }),
    (f) => f.wrapper({ target: address(9) }),
    (f) => f.wrapper({ value: 1n }),
    (f) => f.wrapper({ innerData: "0x1234" }),
    (f) => {
      f.transaction.input += "00";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    f.wrapper();
    mutate(f);
    const before = snapshot(f);
    await assert.rejects(
      f.service.inspect(f.session()),
      code("CREATION_RECOVERY_MISMATCH"),
    );
    assert.equal(snapshot(f), before);
  }
});

test("saved review selection rejects forged immutable terms, policy, factory, ABI and calldata before RPC", () => {
  for (const mutate of [
    (f) => {
      f.draft.eventKey = id("wrong-key");
    },
    (f) => {
      f.draft.factoryFingerprint = hash("other-factory");
    },
    (f) => {
      f.draft.registryHash = hash("other-source");
    },
    (f) => {
      f.draft.factorySource.implementation = address(9);
    },
    (f) => {
      f.draft.terms.title = "changed title";
    },
    (f) => {
      f.draft.terms.endsAt = "2033-05-18T00:00:00.000Z";
    },
    (f) => {
      f.draft.terms.depositWei = "2000000000000000";
    },
    (f) => {
      f.draft.terms.claimDeadline++;
    },
    (f) => {
      f.draft.terms.attendanceStandard.attendanceMode = "invented";
    },
    (f) => {
      f.draft.policyText += " changed";
    },
    (f) => {
      f.draft.config.arbitration.extraData = "0x";
    },
    (f) => {
      f.draft.transaction.value = "1";
    },
    (f) => {
      f.draft.transaction.to = address(9);
    },
    (f) => {
      f.draft.transaction.data += "00";
    },
    (f) => {
      f.draft.args[1].eventName = "different reviewed arguments";
    },
    (f) => {
      delete f.draft.template;
    },
    (f) => {
      f.draft.abiVersion = "kleros-event-v8";
    },
    (f) => {
      f.draft.submittedHash = id("other-original");
    },
  ]) {
    const f = fixture();
    mutate(f);
    const before = snapshot(f);
    assert.throws(
      () => f.service.scopeFor(f.wallet, f.originalHash),
      code("CREATION_RECOVERY_NOT_FOUND"),
    );
    assert.equal(f.calls.length, 0);
    assert.equal(snapshot(f), before);
  }
});

test("only an exact unique owned submitted hash and distinct recovery-only session can inspect", async () => {
  const f = fixture();
  assert.throws(
    () => f.service.scopeFor(address(9), f.originalHash),
    code("CREATION_RECOVERY_NOT_FOUND"),
  );
  assert.throws(
    () => f.service.scopeFor(f.wallet, id("unknown")),
    code("CREATION_RECOVERY_NOT_FOUND"),
  );
  const original = f.session();
  for (const session of [
    null,
    { ...original, mode: "wallet" },
    { ...original, mode: "demo" },
  ])
    await assert.rejects(f.service.inspect(session), code("UNAUTHENTICATED"));
  for (const changes of [
    { wallet: address(9) },
    { instanceId: "other-server" },
    { hash: id("other-original") },
    { draftId: "other-draft" },
    { eventId: "other-event" },
    { eventKey: id("foreign-key") },
    { factory: address(9) },
    { profile: "kleros-event-v8" },
    { financialReview: true },
  ])
    await assert.rejects(
      f.service.inspect({
        ...original,
        recoveryScope: { ...original.recoveryScope, ...changes },
      }),
      code("CREATION_RECOVERY_SCOPE"),
    );
  assert.equal(f.calls.length, 0);
  f.drafts.set("duplicate-review", {
    ...structuredClone(f.draft),
    id: "duplicate-review",
  });
  assert.throws(
    () => f.service.scopeFor(f.wallet, f.originalHash),
    code("CREATION_RECOVERY_NOT_FOUND"),
  );
});

test("successful receipt requires one exact canonical factory EventCreated identity", async () => {
  const mutations = [
    (f) => {
      f.receipt.logs = [f.eventLog({ creator: address(9) })];
    },
    (f) => {
      f.receipt.logs = [f.eventLog({ child: ethers.ZeroAddress })];
    },
    (f) => {
      f.receipt.logs = [f.eventLog({ version: 8 })];
    },
    (f) => {
      f.receipt.logs = [f.eventLog({ eventKey: id("other-key") })];
    },
    (f) => {
      f.receipt.logs = [f.eventLog({ eventId: id("other-event") })];
    },
    (f) => {
      f.receipt.logs = [f.eventLog({ configurationHash: id("other-config") })];
    },
    (f) => {
      f.receipt.logs.push(f.eventLog());
    },
    (f) => {
      f.receipt.logs[0].removed = true;
    },
    (f) => {
      f.receipt.logs[0].blockHash = id("orphan");
    },
    (f) => {
      f.receipt.logs[0].transactionHash = id("other-hash");
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    const before = snapshot(f);
    await assert.rejects(
      f.service.inspect(f.session()),
      code("CREATION_RECOVERY_MISMATCH"),
    );
    assert.equal(snapshot(f), before);
  }
});

test("closing receipt, review and current head anchors cannot reuse stale canonical observations", async () => {
  for (const tag of ["0x6e", "0x64", "0x78"]) {
    const f = fixture();
    let reads = 0;
    f.fault = (method, params) => {
      if (
        method === "eth_getBlockByNumber" &&
        (params[0] === tag || (tag === "0x78" && params[0] === "latest"))
      ) {
        reads++;
        if (reads === 2)
          return { ...f.headers.get(tag), hash: id("replacement-block") };
      }
    };
    const before = snapshot(f);
    await assert.rejects(
      f.service.inspect(f.session()),
      code("CREATION_RECOVERY_REORG"),
    );
    assert.equal(snapshot(f), before);
  }
  const f = fixture();
  let chainReads = 0;
  f.fault = (method) =>
    method === "eth_chainId" && ++chainReads === 2 ? "0x2" : undefined;
  await assert.rejects(
    f.service.inspect(f.session()),
    code("CREATION_RECOVERY_SCOPE"),
  );
});

test("unknown, pending and reverted original facts stay honest and never expose a child or financial capability", async () => {
  for (const kind of ["unknown", "pending", "reverted"]) {
    const f = fixture();
    if (kind === "unknown") {
      f.transaction = null;
      f.receipt = null;
    }
    if (kind === "pending") {
      f.transaction.blockNumber = null;
      f.transaction.blockHash = null;
      f.receipt = null;
    }
    if (kind === "reverted") {
      f.receipt.status = "0x0";
      f.receipt.logs = [];
    }
    const before = snapshot(f),
      dto = await f.service.inspect(f.session());
    assert.equal(
      dto.status,
      {
        unknown: "transaction-not-found",
        pending: "transaction-pending",
        reverted: "original-transaction-reverted",
      }[kind],
    );
    assert.equal(dto.child, null);
    assert.equal(dto.transactionConfirmed, kind === "reverted");
    assert.equal(dto.transactionSucceeded, kind === "reverted" ? false : null);
    assert.equal(dto.canonical, kind === "reverted" ? true : null);
    if (kind !== "reverted") assert.equal(dto.confirmations, null);
    factualOnly(dto);
    assert.equal(snapshot(f), before);
  }
});

test("network diagnostics are sanitized and mid-read original-review changes withhold disclosure", async () => {
  const f = fixture(),
    session = f.session(),
    secret = "PRIVATE_ENDPOINT_SIGNATURE_BYTES";
  f.fault = () => {
    throw Object.assign(new Error(secret), { url: secret, data: secret });
  };
  const before = snapshot(f);
  await assert.rejects(
    f.service.inspect(session),
    (error) =>
      error.code === "CREATION_RECOVERY_UNAVAILABLE" &&
      !JSON.stringify(error).includes(secret) &&
      !String(error).includes(secret) &&
      error.cause === undefined,
  );
  assert.equal(snapshot(f), before);
  const changed = fixture(),
    original = changed.session();
  changed.fault = (method) => {
    if (method === "eth_getTransactionByHash")
      changed.draft.transaction.gasLimit = "2000001";
  };
  await assert.rejects(
    changed.service.inspect(original),
    code("CREATION_RECOVERY_SCOPE"),
  );
});
