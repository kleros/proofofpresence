import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { hash, lower, requireThat } from "./utils.mjs";
import { verifyV9ArtifactSources } from "./upgrade-artifacts.mjs";
import { createRpcReadScheduler } from "./rpc-read-scheduler.mjs";
import {
  eventV9LumaTemplate,
  V9_LUMA_ATTENDANCE_STANDARD,
} from "./contracts-v9-luma.mjs";
import {
  MAINNET_KLEROS,
  MAINNET_EXTRA_DATA,
  MAINNET_READ_METHODS,
  validatePublicMainnetRpc,
  resolverAbiEvidence,
  arbitratorAbiEvidence,
  verifyKleros,
} from "../scripts/mainnet/verify-kleros.mjs";
import {
  allowedVerificationMethod,
  createVerificationRuntime,
  VerificationError,
} from "../scripts/mainnet/verification-runtime.mjs";

export const MAINNET_PROFILE = "kleros-event-v9-uups";
export const MAINNET_RUNTIME_READ_METHODS = Object.freeze(
  MAINNET_READ_METHODS.filter(allowedVerificationMethod),
);
const methods = new Set(MAINNET_RUNTIME_READ_METHODS);
const eventUnavailableCodes = new Set([
  "UPGRADE_TRUST_MISMATCH",
  "WRONG_CONTRACT",
  "DEPLOYMENT_MISMATCH",
  "DEPLOYMENT_REORG",
  "UNREVIEWED_UPGRADE_HISTORY",
  "IMPLEMENTATION_CHANGED",
  "INVALID_GOVERNANCE",
  "NETWORK_ERROR",
  "TIMEOUT",
  "SERVER_ERROR",
  "RPC_TIMEOUT",
  "RPC_NETWORK",
  "RPC_RATE_LIMIT",
  "RPC_UNAVAILABLE",
  "RPC_REVERT",
  "RPC_READ_FAILED",
  "SNAPSHOT_REORG",
]);
const address = (value) =>
  ethers.isAddress(value) && lower(value) !== lower(ethers.ZeroAddress);
const digest = (value) =>
  ethers.isHexString(value, 32) && value !== ethers.ZeroHash;
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => lower(a) === lower(b);
const fail = (code, message, status = 409) =>
  requireThat(false, message, code, status);
const RPC_ERROR = () =>
  Object.assign(
    new Error("Mainnet RPC read unavailable; remote diagnostics withheld"),
    { code: "NETWORK_ERROR" },
  );

function noSigningMaterial(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  requireThat(
    !seen.has(value),
    "Production manifest must be a JSON tree",
    "INVALID_MANIFEST",
  );
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    requireThat(
      !/^(?:privateKey|mnemonic|seed|password|secret|token|signer|signers|rpcOverride|privateRpcUrl|apiKey|apiToken|authorization|rpcHeaders)$/i.test(
        key,
      ),
      "Production manifest must contain public metadata only",
      "INVALID_MANIFEST",
    );
    noSigningMaterial(nested, seen);
  }
  seen.delete(value);
}

function validateFactoryRecord(factory, governance) {
  requireThat(
    factory?.contractVersion === MAINNET_PROFILE &&
      factory.abiVersion === MAINNET_PROFILE &&
      factory.chainId === 1,
    "Production factory requires the exact Ethereum V9 profile",
    "DEPLOYMENT_MISMATCH",
  );
  for (const name of [
    "factory",
    "implementation",
    "factoryImplementation",
    "initialImplementation",
    "initialFactoryImplementation",
    "upgradeAuthority",
    "initialUpgradeOwner",
  ])
    requireThat(
      address(factory[name]),
      "Missing production factory or historical owner identity",
      "DEPLOYMENT_MISMATCH",
    );
  for (const name of [
    "factoryCodeHash",
    "implementationCodeHash",
    "factoryImplementationCodeHash",
    "upgradeAuthorityCodeHash",
    "factoryDeploymentTxHash",
    "timelockDeploymentTxHash",
  ])
    requireThat(
      digest(factory[name]),
      "Missing production factory runtime or creation anchor",
      "DEPLOYMENT_MISMATCH",
    );
  requireThat(
    integer(factory.factoryDeploymentBlock) &&
      integer(factory.timelockDeploymentBlock) &&
      same(factory.initialUpgradeOwner, governance.initialOwner) &&
      !Object.hasOwn(factory, "projectMultisig") &&
      new Set(
        [
          factory.factory,
          factory.implementation,
          factory.factoryImplementation,
          factory.upgradeAuthority,
          factory.initialUpgradeOwner,
        ].map(lower),
      ).size === 5,
    "Production factory owner, proxy or creation identities conflict",
    "INVALID_GOVERNANCE",
  );
}

const FACTORY_SHARED_FIELDS = [
  "factory",
  "factoryCodeHash",
  "factoryImplementation",
  "factoryImplementationCodeHash",
  "implementation",
  "implementationCodeHash",
  "initialImplementation",
  "initialFactoryImplementation",
  "upgradeAuthority",
  "upgradeAuthorityCodeHash",
  "initialUpgradeOwner",
  "factoryDeploymentTxHash",
  "factoryDeploymentBlock",
  "timelockDeploymentTxHash",
  "timelockDeploymentBlock",
];
const factoryBound = (deployment, factory) =>
  FACTORY_SHARED_FIELDS.every((name) =>
    typeof factory[name] === "number"
      ? deployment[name] === factory[name]
      : same(deployment[name], factory[name]),
  );

/** Public configuration only. Overrides and injectable adapters never belong in a manifest. */
export function validateMainnetManifest(input) {
  requireThat(
    input && typeof input === "object" && !Array.isArray(input),
    "Production manifest required",
    "INVALID_MANIFEST",
  );
  let manifest;
  try {
    manifest = structuredClone(input);
  } catch {
    fail("INVALID_MANIFEST", "Invalid production manifest");
  }
  noSigningMaterial(manifest);
  const chain = manifest.chain,
    arbitration = manifest.arbitration,
    governance = manifest.governance;
  requireThat(
    manifest.environment === "production" &&
      chain?.chainId === 1 &&
      chain.name === "Ethereum" &&
      chain.nativeCurrency?.symbol === "ETH" &&
      chain.nativeCurrency.decimals === 18,
    "Production requires Ethereum mainnet chain1 and native ETH",
    "MAINNET_REQUIRED",
  );
  try {
    validatePublicMainnetRpc(chain.rpcUrl);
  } catch {
    fail(
      "INVALID_RPC",
      "Publish only a credential-free public root HTTPS Ethereum RPC",
    );
  }
  requireThat(
    arbitration?.mode === "kleros-v1" &&
      same(arbitration.resolver, MAINNET_KLEROS.resolver) &&
      same(arbitration.arbitrator, MAINNET_KLEROS.arbitrator) &&
      (arbitration.extraData === undefined ||
        arbitration.extraData === MAINNET_EXTRA_DATA),
    "Production arbitration must use the reviewed Ethereum Kleros V1 resolver and Liquid",
    "WRONG_ARBITRATION",
  );
  requireThat(
    governance?.kind === "single-owner-timelock" &&
      address(governance.initialOwner) &&
      integer(governance.minimumDelaySeconds) &&
      governance.minimumDelaySeconds >= 172800 &&
      !Object.hasOwn(governance, "multisig") &&
      !Object.hasOwn(governance, "expectedCodeHash"),
    "Historical upgrade owner and at least48-hour timelock required",
    "INVALID_GOVERNANCE",
  );
  requireThat(
    manifest.provenance &&
      Object.keys(manifest.provenance).length === 2 &&
      ["v9BuildManifestSha256", "v9StandardInputSha256"].every(
        (key) =>
          typeof manifest.provenance[key] === "string" &&
          /^[a-f0-9]{64}$/.test(manifest.provenance[key]),
      ),
    "Production requires approved v9 build and compiler-input SHA256 pins",
    "V9_ARTIFACT_PROVENANCE",
  );
  if (manifest.factoryDeployment)
    validateFactoryRecord(manifest.factoryDeployment, governance);
  requireThat(
    Array.isArray(manifest.events) &&
      (manifest.events.length > 0 || manifest.factoryDeployment),
    "Production manifest needs reviewed events or a reviewed factory",
    "INVALID_MANIFEST",
  );
  const ids = new Set(),
    contracts = new Set();
  for (const record of manifest.events) {
    const definition = record?.definition,
      d = record?.deployment;
    requireThat(
      d &&
        /^[a-zA-Z0-9_-]{1,160}$/.test(definition?.id ?? "") &&
        definition.id === d.eventId &&
        !ids.has(definition.id) &&
        address(d.contract) &&
        !contracts.has(lower(d.contract)),
      "Production events require independent stable identities and proxies",
      "DUPLICATE_EVENT",
    );
    ids.add(definition.id);
    contracts.add(lower(d.contract));
    requireThat(
      d.contractVersion === MAINNET_PROFILE &&
        d.abiVersion === MAINNET_PROFILE &&
        d.chainId === 1 &&
        definition.title === d.eventName &&
        integer(d.eventStart) &&
        Date.parse(definition.startsAt) / 1000 === d.eventStart &&
        integer(d.claimDeadline) &&
        d.claimDeadline >= d.eventStart + 7 * 86400 &&
        d.depositDeadline === d.eventStart &&
        integer(d.depositOpensAt) &&
        d.depositOpensAt <= d.eventStart &&
        typeof d.depositWei === "string" &&
        /^[1-9][0-9]*$/.test(d.depositWei) &&
        BigInt(d.depositWei) < 2n ** 256n &&
        same(d.resolver, arbitration.resolver) &&
        same(d.arbitrator, arbitration.arbitrator) &&
        d.arbitratorExtraData === MAINNET_EXTRA_DATA,
      "Production event version, schedule, principal or arbitration differs from its manifest",
      "DEPLOYMENT_MISMATCH",
    );
    for (const field of [
      "owner",
      "creator",
      "factory",
      "implementation",
      "factoryImplementation",
      "initialImplementation",
      "initialFactoryImplementation",
      "upgradeAuthority",
      "initialUpgradeOwner",
    ])
      requireThat(
        address(d[field]),
        "Missing production proxy/governance identity",
        "DEPLOYMENT_MISMATCH",
      );
    for (const field of [
      "codeHash",
      "factoryCodeHash",
      "implementationCodeHash",
      "factoryImplementationCodeHash",
      "upgradeAuthorityCodeHash",
      "deploymentTxHash",
      "factoryDeploymentTxHash",
      "timelockDeploymentTxHash",
    ])
      requireThat(
        digest(d[field]),
        "Missing production runtime or creation anchor",
        "DEPLOYMENT_MISMATCH",
      );
    for (const field of [
      "deploymentBlock",
      "factoryDeploymentBlock",
      "timelockDeploymentBlock",
    ])
      requireThat(
        integer(d[field]),
        "Missing production creation block",
        "DEPLOYMENT_MISMATCH",
      );
    requireThat(
      same(d.initialUpgradeOwner, governance.initialOwner) &&
        same(d.owner, d.creator) &&
        !Object.hasOwn(d, "projectMultisig") &&
        !same(d.upgradeAuthority, d.initialUpgradeOwner) &&
        !same(d.contract, d.implementation) &&
        !same(d.factory, d.factoryImplementation) &&
        !same(d.contract, d.factory) &&
        (!manifest.factoryDeployment ||
          factoryBound(d, manifest.factoryDeployment)),
      "Production event governance or proxy identities conflict",
      "INVALID_GOVERNANCE",
    );
  }
  return manifest;
}

/** Structural admission only; callers must freshly verify the child on chain before using it. */
export function validateMainnetDynamicEvent(record, manifestInput) {
  const manifest = validateMainnetManifest(manifestInput);
  requireThat(
    manifest.factoryDeployment,
    "Dynamic production events require the reviewed factory",
    "STATE_SCOPE",
  );
  const publicRecord = {
    definition: record?.definition,
    deployment: record?.deployment,
    policy: record?.policy,
    pieces: record?.pieces,
    slots: record?.slots,
  };
  validateMainnetManifest({ ...manifest, events: [publicRecord] });
  const d = publicRecord.deployment;
  requireThat(
    typeof publicRecord.policy === "string" &&
      Array.isArray(publicRecord.pieces) &&
      publicRecord.pieces.every((piece) => typeof piece === "string") &&
      ethers.isHexString(publicRecord.slots) &&
      hash([publicRecord.pieces, publicRecord.slots]) === d.templateHash &&
      digest(d.eventKey) &&
      digest(d.factoryEventId) &&
      digest(d.configurationHash),
    "Dynamic event policy, template or factory identity is incomplete",
    "STATE_SCOPE",
  );
  if (manifest.factoryDeployment.policy)
    requireThat(
      publicRecord.policy === manifest.factoryDeployment.policy.text &&
        hash(publicRecord.policy) ===
          manifest.factoryDeployment.policy.sha256 &&
        d.policyURI === manifest.factoryDeployment.policy.uri,
      "Dynamic event policy differs from the approved factory policy",
      "STATE_SCOPE",
    );
  let immutableTemplate;
  try {
    immutableTemplate = eventV9LumaTemplate({
      eventName: d.eventName,
      depositAmount: d.depositWei,
      policyURI: d.policyURI,
      policySha256: hash(publicRecord.policy),
      lumaUrl: publicRecord.definition.lumaUrl,
      startsAt: publicRecord.definition.startsAt,
      endsAt: publicRecord.definition.endsAt,
      timezone: publicRecord.definition.timezone,
    });
  } catch {
    fail("STATE_SCOPE", "Dynamic event has invalid immutable Luma terms");
  }
  requireThat(
    hash([immutableTemplate.pieces, immutableTemplate.slots]) ===
      d.templateHash,
    "Dynamic event Luma terms differ from its source-bound template",
    "STATE_SCOPE",
  );
  const eventId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "bytes32"],
      [1, d.factory, d.creator, d.eventKey],
    ),
  );
  const configuration = {
    depositAmount: d.depositWei,
    eventName: d.eventName,
    eventStart: d.eventStart,
    claimDeadline: d.claimDeadline,
    arbitration: {
      disputeResolver: d.resolver,
      extraData: d.arbitratorExtraData,
      metaEvidenceTemplate: publicRecord.pieces,
      metaEvidenceSlots: publicRecord.slots,
      policyURI: d.policyURI,
    },
  };
  const type =
    "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
  requireThat(
    same(d.factoryEventId, eventId) &&
      same(
        d.configurationHash,
        ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", type],
            [d.creator, configuration],
          ),
        ),
      ),
    "Dynamic event identity or configuration differs from its reviewed factory call",
    "STATE_SCOPE",
  );
  return publicRecord;
}

function validateFactoryDraft(key, draft, manifest) {
  if (draft?.scopeKind !== "factory-create") return;
  const factory = manifest.factoryDeployment;
  requireThat(
    factory &&
      typeof key === "string" &&
      draft.id === key &&
      address(draft.wallet) &&
      typeof draft.instanceId === "string" &&
      draft.instanceId.length > 0 &&
      typeof draft.sessionId === "string" &&
      draft.sessionId.length > 0 &&
      /^[a-zA-Z0-9_-]{1,160}$/.test(draft.eventId ?? "") &&
      digest(draft.eventKey) &&
      draft.chainId === 1 &&
      draft.contractVersion === MAINNET_PROFILE &&
      draft.abiVersion === MAINNET_PROFILE &&
      same(draft.factory, factory.factory) &&
      draft.factoryFingerprint === hash(factory) &&
      address(draft.transaction?.from) &&
      same(draft.transaction.from, draft.wallet) &&
      same(draft.transaction.to, factory.factory) &&
      draft.transaction.chainId === 1 &&
      draft.transaction.value === "0" &&
      ["reviewed", "pending", "failed", "confirmed"].includes(draft.status) &&
      (draft.submittedHash === undefined || digest(draft.submittedHash)) &&
      (draft.confirmedHash === undefined || digest(draft.confirmedHash)),
    "Factory creation draft left its reviewed wallet or deployment scope",
    "STATE_SCOPE",
  );
  const config = draft.config,
    template = draft.template,
    terms = draft.terms;
  requireThat(
    config &&
      terms &&
      template &&
      Array.isArray(template.pieces) &&
      ethers.isHexString(template.slots) &&
      String(config.depositAmount) === terms.depositWei &&
      config.eventName === terms.title &&
      Number(config.eventStart) === terms.eventStart &&
      Number(config.claimDeadline) === terms.claimDeadline &&
      same(
        config.arbitration?.disputeResolver,
        manifest.arbitration.resolver,
      ) &&
      config.arbitration.extraData === MAINNET_EXTRA_DATA &&
      config.arbitration.policyURI === terms.policyURI &&
      hash([
        config.arbitration.metaEvidenceTemplate,
        config.arbitration.metaEvidenceSlots,
      ]) === hash([template.pieces, template.slots]),
    "Factory creation draft terms or arbitration differ from its reviewed configuration",
    "STATE_SCOPE",
  );
  if (factory.policy)
    requireThat(
      terms.policyURI === factory.policy.uri &&
        terms.policySha256 === factory.policy.sha256 &&
        draft.policyText === factory.policy.text &&
        hash(draft.policyText) === factory.policy.sha256,
      "Factory creation policy differs from its approved publication",
      "STATE_SCOPE",
    );
  let immutableTemplate;
  try {
    immutableTemplate = eventV9LumaTemplate({
      eventName: terms.title,
      depositAmount: terms.depositWei,
      policyURI: terms.policyURI,
      policySha256: terms.policySha256,
      lumaUrl: terms.lumaUrl,
      startsAt: terms.startsAt,
      endsAt: terms.endsAt,
      timezone: terms.timezone,
    });
  } catch {
    fail("STATE_SCOPE", "Factory review has invalid immutable Luma terms");
  }
  requireThat(
    hash(immutableTemplate) === hash(template) &&
      hash(terms.attendanceStandard) === hash(V9_LUMA_ATTENDANCE_STANDARD),
    "Factory review Luma evidence terms changed",
    "STATE_SCOPE",
  );
  let expected;
  try {
    const iface = new ethers.Interface([
      "function createEvent(bytes32 eventKey,tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration) config) returns(address)",
    ]);
    expected = iface.encodeFunctionData("createEvent", [
      draft.eventKey,
      config,
    ]);
  } catch {
    fail(
      "STATE_SCOPE",
      "Factory creation draft calldata cannot be reconstructed",
    );
  }
  requireThat(
    same(draft.transaction.data, expected),
    "Factory creation draft calldata left its reviewed configuration",
    "STATE_SCOPE",
  );
}

function privateEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(
      "INVALID_RPC",
      "Private RPC override must use HTTPS without basic authentication",
    );
  }
  requireThat(
    url.protocol === "https:" && !url.username && !url.password && !url.hash,
    "Private RPC override must use HTTPS without basic authentication",
    "INVALID_RPC",
  );
  return url.href;
}
const assertReadPayload = (payload) => {
  const list = Array.isArray(payload) ? payload : [payload];
  requireThat(
    list.length > 0 &&
      list.every(
        (item) =>
          item && methods.has(item.method) && Array.isArray(item.params ?? []),
      ),
    "Mainnet backend RPC is read-only",
    "FORBIDDEN_METHOD",
    403,
  );
};

function defaultProvider(
  endpoint,
  { fetcher = fetch, timeoutMs = 20000 } = {},
) {
  // The approved Infura Core endpoint has a credit throughput limit, including
  // chain probes and retries. Pace actual HTTP admission rather than changing
  // verification concurrency or dropping historical reads. Other providers keep
  // their existing transport behavior.
  const scheduler = new URL(endpoint).hostname === "mainnet.infura.io"
    ? createRpcReadScheduler({ budget: 400, windowMs: 1100 })
    : null;
  const activeControllers = new Set();
  const connection = new ethers.FetchRequest(endpoint);
  connection.timeout = timeoutMs;
  connection.setThrottleParams({ maxAttempts: 1 });
  connection.getUrlFunc = async (request) => {
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(request.body));
    } catch {
      throw RPC_ERROR();
    }
    assertReadPayload(payload);
    if (scheduler && Array.isArray(payload)) {
      // Ethers is configured below to emit individual requests. Do not admit an
      // unbudgeted private _send batch through this provider's paced transport.
      requireThat(payload.length === 1, "Paced RPC requires individual reads", "INVALID_INPUT");
    }
    const controller = new AbortController();
    activeControllers.add(controller);
    // Start the timeout before queueing, so expired queued work cannot fetch.
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), controller.signal]);
    let response, body;
    try {
      const send = () => fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "error",
        signal,
      });
      response = scheduler
        ? await scheduler.schedule({ method: (Array.isArray(payload) ? payload[0] : payload).method, signal }, send)
        : await send();
      if (response.status !== 200) throw RPC_ERROR();
      body = await response.json();
    } catch {
      throw RPC_ERROR();
    } finally {
      activeControllers.delete(controller);
    }
    const sanitize = (item) =>
      item?.error
        ? {
            jsonrpc: "2.0",
            id: item.id,
            error: {
              code: Number.isFinite(item.error.code) ? item.error.code : -32000,
              message: "Mainnet RPC read failed",
            },
          }
        : item;
    return {
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": "application/json" },
      body: ethers.toUtf8Bytes(
        JSON.stringify(
          Array.isArray(body) ? body.map(sanitize) : sanitize(body),
        ),
      ),
    };
  };
  const provider = new ethers.JsonRpcProvider(connection, undefined, {
    cacheTimeout: -1,
    batchMaxCount: 1,
  });
  const destroy = provider.destroy.bind(provider);
  provider.destroy = () => {
    scheduler?.close();
    for (const controller of activeControllers) controller.abort();
    activeControllers.clear();
    return destroy();
  };
  return provider;
}

// Shared transport only. Chain-specific verification stays in each explicit runtime.
export { defaultProvider as createReadOnlyHttpProvider };

/** Providers and verifier callbacks are trusted code dependencies for offline tests, never user configuration. */
export async function mainnetChain(manifestInput, rpcUrl, options = {}) {
  const allowed = [
    "providerFactory",
    "verifyDeployment",
    "verifyFactory",
    "verifyCourt",
    "fetcher",
    "timeoutMs",
    "maxAttempts",
  ];
  requireThat(
    options && Object.keys(options).every((key) => allowed.includes(key)),
    "Unsupported mainnet runtime option",
    "INVALID_INPUT",
  );
  requireThat(
    [
      "providerFactory",
      "verifyDeployment",
      "verifyFactory",
      "verifyCourt",
      "fetcher",
    ].every(
      (key) => options[key] === undefined || typeof options[key] === "function",
    ) &&
      Number.isSafeInteger(options.timeoutMs ?? 20000) &&
      (options.timeoutMs ?? 20000) > 0 &&
      (options.timeoutMs ?? 20000) <= 30000 &&
      Number.isSafeInteger(options.maxAttempts ?? 2) &&
      (options.maxAttempts ?? 2) > 0 &&
      (options.maxAttempts ?? 2) <= 5,
    "Invalid trusted mainnet runtime dependency or read bounds",
    "INVALID_INPUT",
  );
  const manifest = validateMainnetManifest(manifestInput);
  // Source approval is global; an unavailable child may never turn this into a soft failure.
  verifyV9ArtifactSources(manifest.provenance);
  const endpoint =
    rpcUrl === undefined ? manifest.chain.rpcUrl : privateEndpoint(rpcUrl);
  resolverAbiEvidence();
  arbitratorAbiEvidence();
  const resolverAbi = JSON.parse(
    fs.readFileSync(
      new URL("../scripts/mainnet/ethereum-resolver.abi.json", import.meta.url),
      "utf8",
    ),
  );
  const arbitratorAbi = JSON.parse(
    fs.readFileSync(
      new URL(
        "../scripts/mainnet/ethereum-arbitrator.abi.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  let provider,
    closed = false;
  try {
    provider = await (options.providerFactory ?? defaultProvider)(
      endpoint,
      options,
    );
    requireThat(
      provider &&
        typeof provider.send === "function" &&
        typeof provider.destroy === "function",
      "Read-only Ethereum provider required",
      "INVALID_INPUT",
    );
  } catch {
    try {
      await provider?.destroy?.();
    } catch {
      /* No remote diagnostic disclosure. */
    }
    fail(
      "MAINNET_PROVIDER_FAILED",
      "Mainnet read provider could not be initialized",
    );
  }
  const rawSend = provider.send.bind(provider);
  const verifier = createVerificationRuntime({
    send: rawSend,
    expectedChainId: 1,
    timeoutMs: options.timeoutMs ?? 20000,
    maxAttempts: options.maxAttempts ?? 2,
  });
  if (typeof provider._send === "function") {
    const rawBatch = provider._send.bind(provider);
    provider._send = async (payload) => {
      requireThat(!closed, "Mainnet provider is closed", "PROVIDER_CLOSED");
      assertReadPayload(payload);
      try {
        return await rawBatch(payload);
      } catch {
        throw RPC_ERROR();
      }
    };
  }
  provider.send = (method, params = []) => {
    requireThat(!closed, "Mainnet provider is closed", "PROVIDER_CLOSED");
    return verifier.request(method, params, { phase: "verification" });
  };
  for (const method of ["getSigner", "listAccounts", "broadcastTransaction"])
    provider[method] = async () =>
      fail(
        "FORBIDDEN_METHOD",
        "Mainnet backend has no signer or broadcast capability",
        403,
      );
  const context = {
    provider,
    chainId: 1,
    production: true,
    financialModel: "v8",
    governance: manifest.governance,
    arbitration: manifest.arbitration,
    manifest,
    eventVerification: new Map(),
    factoryDeployment: manifest.factoryDeployment ?? null,
    verifiedFactory: false,
    factoryTrust: null,
  };
  try {
    await provider.send("eth_chainId", []);
    const court = await (options.verifyCourt ?? verifyKleros)({
      rpcUrl: manifest.chain.rpcUrl,
      transport: { request: provider.send, endpoint: manifest.chain.rpcUrl },
    });
    requireThat(
      court?.status === "verified-read-only" &&
        court.chainId === 1 &&
        same(court.resolver?.address, MAINNET_KLEROS.resolver) &&
        same(court.arbitrator?.address, MAINNET_KLEROS.arbitrator) &&
        court.resolver.codeHash === MAINNET_KLEROS.resolverCodeHash &&
        court.arbitrator.codeHash === MAINNET_KLEROS.arbitratorCodeHash,
      "Ethereum Court verification did not establish the reviewed deployment",
      "WRONG_ARBITRATION",
    );
    const verify =
      options.verifyDeployment ??
      (await import("./chain.mjs")).verifyDeployment;
    requireThat(
      typeof verify === "function",
      "Deployment verifier required",
      "INVALID_INPUT",
    );
    if (manifest.factoryDeployment) {
      const engine = await import("./upgrade-verification.mjs");
      const verifyFactory =
        options.verifyFactory ?? engine.verifyV9FactoryDeployment;
      requireThat(
        typeof verifyFactory === "function",
        "Production factory verifier required",
        "INVALID_INPUT",
      );
      const trust = await verifyFactory(
        context,
        manifest.factoryDeployment,
        engine.V9_MAINNET_SCOPE,
      );
      requireThat(
        trust?.deploymentTrust?.status === "verified" &&
          same(
            trust.eventImplementation,
            manifest.factoryDeployment.implementation,
          ),
        "Factory verification did not establish the reviewed deployment",
        "DEPLOYMENT_MISMATCH",
      );
      context.factoryTrust = trust;
      context.verifiedFactory = true;
    }
    for (const record of manifest.events) {
      try {
        await verify(context, record.deployment);
        context.eventVerification.set(record.deployment.eventId, {
          status: "verified",
        });
      } catch (error) {
        if (!eventUnavailableCodes.has(error?.code)) throw error;
        context.eventVerification.set(record.deployment.eventId, {
          status: "unavailable",
          code: error.code,
        });
      }
    }
    // A provider that changed networks during an unavailable event cannot yield a recovery context.
    await provider.send("eth_chainId", []);
    return {
      ...context,
      rpcUrl: manifest.chain.rpcUrl,
      signers: [],
      court,
      resolver: new ethers.Contract(
        manifest.arbitration.resolver,
        resolverAbi,
        provider,
      ),
      liquid: new ethers.Contract(
        manifest.arbitration.arbitrator,
        arbitratorAbi,
        provider,
      ),
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await provider.destroy();
        } catch {
          fail("CLEANUP_FAILED", "Mainnet provider cleanup failed");
        }
      },
    };
  } catch (error) {
    closed = true;
    try {
      await provider.destroy();
    } catch {
      /* Preserve the primary verification failure. */
    }
    const code =
      error instanceof VerificationError
        ? error.code
        : [
              "WRONG_ARBITRATION",
              "DEPLOYMENT_MISMATCH",
              "INVALID_GOVERNANCE",
              "WRONG_CHAIN",
              "INVALID_INPUT",
            ].includes(error?.code)
          ? error.code
          : "MAINNET_VERIFICATION_FAILED";
    fail(
      code,
      "Mainnet runtime verification failed; remote diagnostics withheld",
    );
  }
}

/** Private app records bind the entire reviewed production manifest, never only proxy addresses. */
export function mainnetStateStore(filename, input) {
  requireThat(
    typeof filename === "string" && path.isAbsolute(filename),
    "Production state needs an explicit absolute path",
    "INVALID_INPUT",
  );
  const manifest = validateMainnetManifest(input),
    binding = hash(manifest);
  const deployments = new Map(
    manifest.events.map((record) => [record.definition.id, record]),
  );
  const load = () => {
    let info;
    try {
      info = fs.lstatSync(filename);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      fail("STATE_UNAVAILABLE", "Production state is unavailable");
    }
    requireThat(
      info.isFile() &&
        !info.isSymbolicLink() &&
        (info.mode & 0o077) === 0 &&
        (process.getuid === undefined || info.uid === process.getuid()),
      "Production state must be an owner-only regular file",
      "STATE_PERMISSIONS",
    );
    let fd, saved;
    try {
      fd = fs.openSync(
        filename,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      const opened = fs.fstatSync(fd);
      requireThat(
        opened.isFile() &&
          (opened.mode & 0o077) === 0 &&
          (process.getuid === undefined || opened.uid === process.getuid()) &&
          opened.ino === info.ino &&
          opened.dev === info.dev,
        "Production state changed while opening",
        "STATE_PERMISSIONS",
      );
      saved = JSON.parse(fs.readFileSync(fd, "utf8"));
    } catch (error) {
      if (error.code === "STATE_PERMISSIONS") throw error;
      fail("STATE_INVALID", "Production state cannot be decoded securely");
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    requireThat(
      saved?.version === 1 &&
        saved.environment === "production" &&
        saved.chainId === 1 &&
        saved.contractVersion === MAINNET_PROFILE &&
        saved.binding === binding,
      "State belongs to another production manifest or environment",
      "STATE_SCOPE",
    );
    requireThat(
      Array.isArray(saved.events) &&
        Array.isArray(saved.drafts) &&
        saved.events.every(
          (record) => record && record.definition?.id === record.eventId,
        ) &&
        new Set(saved.events.map((record) => record.eventId)).size ===
          saved.events.length &&
        [...deployments.keys()].every((eventId) =>
          saved.events.some((record) => record.eventId === eventId),
        ),
      "Production state event scope is invalid",
      "STATE_SCOPE",
    );
    const contracts = new Set();
    for (const record of saved.events) {
      const trusted = deployments.get(record.eventId);
      if (trusted) {
        requireThat(
          record.dynamic !== true && record.deployment === undefined,
          "Static production state cannot replace manifest deployment metadata",
          "STATE_SCOPE",
        );
        requireThat(
          !contracts.has(lower(trusted.deployment.contract)),
          "Duplicate production state contract",
          "STATE_SCOPE",
        );
        contracts.add(lower(trusted.deployment.contract));
      } else {
        requireThat(
          record.dynamic === true,
          "Unknown production state event",
          "STATE_SCOPE",
        );
        try {
          validateMainnetDynamicEvent(record, manifest);
        } catch {
          fail(
            "STATE_SCOPE",
            "Dynamic production state left its reviewed factory",
          );
        }
        requireThat(
          !contracts.has(lower(record.deployment.contract)),
          "Duplicate dynamic production contract",
          "STATE_SCOPE",
        );
        contracts.add(lower(record.deployment.contract));
      }
    }
    requireThat(
      saved.drafts.every((entry) => Array.isArray(entry) && entry.length === 2),
      "Production state draft encoding is invalid",
      "STATE_SCOPE",
    );
    for (const [key, draft] of saved.drafts)
      validateFactoryDraft(key, draft, manifest);
    return saved;
  };
  return {
    load,
    save(events, drafts) {
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      const lockfile = `${filename}.write-lock`;
      let lock;
      try {
        lock = fs.openSync(lockfile, "wx", 0o600);
      } catch {
        fail(
          "STATE_BUSY",
          "Another durable production state writer requires completion or review",
        );
      }
      try {
        const previous = load(); // Never overwrite another manifest, insecure file or symlink.
        requireThat(
          events instanceof Map &&
            drafts instanceof Map &&
            [...deployments.keys()].every((eventId) => events.has(eventId)) &&
            (manifest.factoryDeployment || events.size === deployments.size) &&
            (!previous ||
              previous.events
                .filter((record) => record.dynamic === true)
                .every((record) => events.has(record.eventId))),
          "Production state must contain its complete reviewed event registry",
          "STATE_SCOPE",
        );
        for (const oldRecord of previous?.events ?? []) {
          for (const [wallet, publication] of oldRecord.publications ?? []) {
            if (publication?.productionCase !== true) continue;
            const next = events
              .get(oldRecord.eventId)
              ?.publications?.get(wallet);
            requireThat(
              ethers.isAddress(wallet) &&
                wallet === lower(wallet) &&
                next?.productionCase === true &&
                next.artifact &&
                hash(next.artifact) === hash(publication.artifact) &&
                (!Object.hasOwn(publication, "intent") ||
                  (Object.hasOwn(next, "intent") &&
                    hash({ intent: next.intent }) ===
                      hash({ intent: publication.intent }))),
              "A durable production case publication intent or artifact cannot be removed or replaced",
              "PUBLICATION_INTENT_IMMUTABLE",
              409,
            );
          }
        }
        const seen = new Set();
        const contracts = new Set();
        const records = [...events].map(([eventId, record]) => {
          const trusted = deployments.get(record?.deployment?.eventId);
          requireThat(
            record?.deployment?.eventId === eventId &&
              !seen.has(eventId) &&
              record.definition?.id === eventId &&
              !contracts.has(lower(record.deployment.contract)),
            "Production record left its reviewed deployment",
            "STATE_SCOPE",
          );
          seen.add(eventId);
          contracts.add(lower(record.deployment.contract));
          let dynamic = {};
          if (trusted)
            requireThat(
              hash(record.deployment) === hash(trusted.deployment),
              "Static production record left its reviewed deployment",
              "STATE_SCOPE",
            );
          else {
            let publicRecord;
            try {
              publicRecord = validateMainnetDynamicEvent(record, manifest);
            } catch {
              fail(
                "STATE_SCOPE",
                "Dynamic production record left its reviewed factory",
              );
            }
            const old = previous?.events.find(
              (item) => item.eventId === eventId,
            );
            requireThat(
              !old ||
                (old.dynamic === true &&
                  hash(old.deployment) === hash(record.deployment) &&
                  old.policy === record.policy &&
                  hash([old.pieces, old.slots]) ===
                    hash([record.pieces, record.slots]) &&
                  ["title", "startsAt", "endsAt"].every(
                    (key) => old.definition[key] === record.definition[key],
                  )),
              "Persisted dynamic production event cannot change its immutable bindings",
              "STATE_SCOPE",
            );
            dynamic = { dynamic: true, ...publicRecord };
          }
          for (const [wallet, publication] of record.publications) {
            if (publication?.productionCase !== true) continue;
            const artifact = publication.artifact;
            requireThat(
              ethers.isAddress(wallet) &&
                wallet === lower(wallet) &&
                artifact &&
                artifact.scope?.environment === "production" &&
                artifact.scope.chainId === 1 &&
                artifact.scope.contractVersion === MAINNET_PROFILE &&
                artifact.scope.eventId === eventId &&
                same(artifact.scope.contract, record.deployment.contract) &&
                same(artifact.scope.wallet, wallet) &&
                (!publication.intent ||
                  (publication.intent.scopeHash === artifact.scopeHash &&
                    publication.intent.sha256 === artifact.sha256 &&
                    publication.intent.uri === artifact.uri &&
                    publication.intent.byteLength === artifact.byteLength)),
              "Production case publication left its stable event, child or challenged wallet",
              "STATE_SCOPE",
              409,
            );
          }
          return {
            ...dynamic,
            eventId: record.deployment.eventId,
            definition: record.definition,
            revision: record.revision,
            observations: record.observations,
            batches: record.batches,
            transactions: record.transactions,
            participants: [...record.participants],
            personal: [...record.personal],
            publications: [...record.publications],
            nonces: [...record.nonces],
          };
        });
        for (const [key, draft] of drafts) {
          validateFactoryDraft(key, draft, manifest);
          const old = previous?.drafts.find(([oldKey]) => oldKey === key)?.[1];
          if (old?.scopeKind === "factory-create") {
            const immutable = [
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
              "factoryFingerprint",
              "config",
              "template",
              "transaction",
              "terms",
              "factorySource",
              "policyText",
              "createdAt",
              "expiresAt",
              "snapshot",
              "registryHash",
              "reviewBlock",
            ];
            requireThat(
              immutable.every(
                (name) =>
                  hash(old[name] ?? null) === hash(draft?.[name] ?? null),
              ) &&
                (!old.submittedHash ||
                  same(old.submittedHash, draft.submittedHash)) &&
                (!old.confirmedHash ||
                  same(old.confirmedHash, draft.confirmedHash)),
              "Persisted factory creation review cannot change its wallet, request or submitted hash",
              "STATE_SCOPE",
            );
          }
        }
        requireThat(
          !previous ||
            previous.drafts.every(
              ([key, draft]) =>
                draft?.scopeKind !== "factory-create" ||
                !draft.submittedHash ||
                drafts.has(key),
            ),
          "Submitted factory creation reviews must remain recoverable",
          "STATE_SCOPE",
        );
        const data = {
          version: 1,
          environment: "production",
          chainId: 1,
          contractVersion: MAINNET_PROFILE,
          binding,
          events: records,
          drafts: [...drafts],
        };
        fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
        const temporary = `${filename}.${randomUUID()}.tmp`;
        let output, directory;
        try {
          output = fs.openSync(temporary, "wx", 0o600);
          fs.writeFileSync(output, JSON.stringify(data));
          fs.fsyncSync(output);
          fs.closeSync(output);
          output = undefined;
          fs.renameSync(temporary, filename);
          directory = fs.openSync(
            path.dirname(filename),
            fs.constants.O_RDONLY,
          );
          fs.fsyncSync(directory);
        } finally {
          if (output !== undefined) fs.closeSync(output);
          if (directory !== undefined) fs.closeSync(directory);
          fs.rmSync(temporary, { force: true });
        }
      } finally {
        fs.closeSync(lock);
        fs.unlinkSync(lockfile);
      }
    },
  };
}
