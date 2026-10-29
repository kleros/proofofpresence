import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { hash, lower, requireThat } from "./utils.mjs";
import { verifyV9ArtifactSources } from "./upgrade-artifacts.mjs";
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
    governance?.kind === "project-multisig" &&
      address(governance.multisig) &&
      digest(governance.expectedCodeHash) &&
      integer(governance.minimumDelaySeconds) &&
      governance.minimumDelaySeconds >= 172800,
    "Reviewed project multisig and at least48-hour upgrade delay required",
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
  requireThat(
    Array.isArray(manifest.events) && manifest.events.length > 0,
    "Production manifest needs reviewed events",
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
      "factory",
      "implementation",
      "factoryImplementation",
      "initialImplementation",
      "initialFactoryImplementation",
      "upgradeAuthority",
      "projectMultisig",
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
      same(d.projectMultisig, governance.multisig) &&
        !same(d.upgradeAuthority, d.projectMultisig) &&
        !same(d.contract, d.implementation) &&
        !same(d.factory, d.factoryImplementation) &&
        !same(d.contract, d.factory),
      "Production event governance or proxy identities conflict",
      "INVALID_GOVERNANCE",
    );
  }
  return manifest;
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
    let response, body;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) throw RPC_ERROR();
      body = await response.json();
    } catch {
      throw RPC_ERROR();
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
  return new ethers.JsonRpcProvider(connection, undefined, {
    cacheTimeout: -1,
    batchMaxCount: 1,
  });
}

/** Providers and verifier callbacks are trusted code dependencies for offline tests, never user configuration. */
export async function mainnetChain(manifestInput, rpcUrl, options = {}) {
  const allowed = [
    "providerFactory",
    "verifyDeployment",
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
    ["providerFactory", "verifyDeployment", "verifyCourt", "fetcher"].every(
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
      saved.version === 1 &&
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
        new Set(saved.events.map((record) => record.eventId)).size ===
          saved.events.length &&
        saved.events.every(
          (record) =>
            deployments.has(record.eventId) &&
            record.definition?.id === record.eventId,
        ),
      "Production state event scope is invalid",
      "STATE_SCOPE",
    );
    return saved;
  };
  return {
    load,
    save(events, drafts) {
      load(); // Never overwrite another manifest, insecure file or symlink.
      requireThat(
        events instanceof Map &&
          drafts instanceof Map &&
          events.size === deployments.size,
        "Production state must contain its complete reviewed event registry",
        "STATE_SCOPE",
      );
      const seen = new Set();
      const records = [...events].map(([eventId, record]) => {
        const trusted = deployments.get(record.deployment?.eventId);
        requireThat(
          trusted &&
            eventId === trusted.definition.id &&
            !seen.has(eventId) &&
            hash(record.deployment) === hash(trusted.deployment) &&
            record.definition?.id === trusted.definition.id,
          "Production record left its reviewed deployment",
          "STATE_SCOPE",
        );
        seen.add(eventId);
        return {
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
      try {
        fs.writeFileSync(temporary, JSON.stringify(data), {
          mode: 0o600,
          flag: "wx",
        });
        fs.renameSync(temporary, filename);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    },
  };
}
