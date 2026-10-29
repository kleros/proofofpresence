// Explicit controlled Chiado V9 runtime. Importing this module never reads a signing file.
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ethers } from "ethers";
import { hash, lower, requireThat } from "./utils.mjs";
import { verifyV9ArtifactSources } from "./upgrade-artifacts.mjs";
import {
  createReadOnlyHttpProvider,
  MAINNET_RUNTIME_READ_METHODS,
} from "./mainnet-runtime.mjs";
import {
  createVerificationRuntime,
  VerificationError,
} from "../scripts/mainnet/verification-runtime.mjs";

export const V9_TESTNET_PROFILE = "kleros-event-v9-uups-chiado";
export const V9_TESTNET_MODE = "hosted-v9-testnet";
export const V9_TESTNET_EXTRA_DATA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
const methods = new Set(MAINNET_RUNTIME_READ_METHODS);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const address = (value) =>
  ethers.isAddress(value) && lower(value) !== lower(ethers.ZeroAddress);
const digest = (value) =>
  ethers.isHexString(value, 32) && value !== ethers.ZeroHash;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const pin = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => lower(a) === lower(b);
const fail = (code, message, status = 409) =>
  requireThat(false, message, code, status);
const unavailableCodes = new Set([
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

function publicOnly(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  requireThat(
    !seen.has(value),
    "V9 testnet manifest must be a public JSON tree",
    "INVALID_MANIFEST",
  );
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    requireThat(
      !/^(?:privateKey|mnemonic|seed|password|secret|token|signer|signers|rpcOverride|privateRpcUrl|apiKey|apiToken|authorization|rpcHeaders)$/i.test(
        key,
      ),
      "V9 testnet manifest must contain public metadata only",
      "INVALID_MANIFEST",
    );
    publicOnly(nested, seen);
  }
  seen.delete(value);
}

function endpoint(value, published = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(
      "INVALID_RPC",
      "V9 testnet RPC requires HTTPS without embedded credentials",
    );
  }
  requireThat(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!published || (!url.search && url.pathname === "/")),
    "V9 testnet RPC requires HTTPS; published endpoints must be public root URLs",
    "INVALID_RPC",
  );
  return url.href;
}

export function validateV9TestnetManifest(input) {
  requireThat(
    input && typeof input === "object" && !Array.isArray(input),
    "Explicit V9 Chiado manifest required",
    "INVALID_MANIFEST",
  );
  let manifest;
  try {
    manifest = structuredClone(input);
  } catch {
    fail("INVALID_MANIFEST", "Invalid V9 Chiado manifest");
  }
  publicOnly(manifest);
  const { chain, arbitration: a, governance: g, provenance } = manifest;
  requireThat(
    manifest.environment === "testnet" &&
      chain?.chainId === 10200 &&
      chain.name === "Chiado" &&
      chain.nativeCurrency?.symbol === "XDAI" &&
      chain.nativeCurrency.decimals === 18 &&
      (manifest.mode === undefined || manifest.mode === V9_TESTNET_MODE),
    "V9 preview requires its explicit Chiado10200/XDAI testnet environment",
    "TESTNET_REQUIRED",
  );
  endpoint(chain.rpcUrl, true);
  requireThat(
    a?.mode === "controlled" &&
      address(a.resolver) &&
      address(a.arbitrator) &&
      !same(a.resolver, a.arbitrator) &&
      (a.extraData === undefined || a.extraData === V9_TESTNET_EXTRA_DATA),
    "V9 Chiado requires its reviewed controlled Court pair",
    "WRONG_ARBITRATION",
  );
  for (const name of ["resolver", "arbitrator"])
    requireThat(
      digest(a[`${name}CodeHash`]) &&
        digest(a[`${name}DeploymentTxHash`]) &&
        positive(a[`${name}DeploymentBlock`]),
      "Controlled Court needs explicit runtime and canonical birth pins",
      "WRONG_ARBITRATION",
    );
  requireThat(
    g?.kind === "single-owner-timelock" &&
      address(g.initialOwner) &&
      g.minimumDelaySeconds === 172800 &&
      Object.keys(g).sort().join() === "initialOwner,kind,minimumDelaySeconds",
    "V9 governance requires one initial upgrade owner and the permanent48-hour floor",
    "INVALID_GOVERNANCE",
  );
  requireThat(
    provenance &&
      Object.keys(provenance).length === 2 &&
      pin(provenance.v9BuildManifestSha256) &&
      pin(provenance.v9StandardInputSha256),
    "V9 testnet requires approved normal-V9 build and compiler-input pins",
    "V9_ARTIFACT_PROVENANCE",
  );
  requireThat(
    pin(manifest.controlledProvenance?.mockSourceSha256) &&
      pin(
        manifest.controlledProvenance.mockArtifactsSha256?.MockKlerosLiquid,
      ) &&
      pin(
        manifest.controlledProvenance.mockArtifactsSha256?.MockArbitrableProxy,
      ),
    "Controlled Court requires reviewed source and artifact pins",
    "CONTROLLED_ARTIFACT_PROVENANCE",
  );
  requireThat(
    Array.isArray(manifest.events) && manifest.events.length > 0,
    "V9 testnet manifest needs reviewed events",
    "INVALID_MANIFEST",
  );
  const ids = new Set(),
    contracts = new Set();
  for (const record of manifest.events) {
    const def = record?.definition,
      d = record?.deployment;
    requireThat(
      d &&
        /^[a-zA-Z0-9_-]{1,160}$/.test(def?.id ?? "") &&
        def.id === d.eventId &&
        !ids.has(def.id) &&
        address(d.contract) &&
        !contracts.has(lower(d.contract)),
      "V9 Chiado events need independent stable identities and proxies",
      "DUPLICATE_EVENT",
    );
    ids.add(def.id);
    contracts.add(lower(d.contract));
    requireThat(
      d.contractVersion === V9_TESTNET_PROFILE &&
        d.abiVersion === V9_TESTNET_PROFILE &&
        d.chainId === 10200 &&
        typeof d.eventName === "string" &&
        d.eventName.trim().length > 0 &&
        def.title === d.eventName &&
        positive(d.eventStart) &&
        Date.parse(def.startsAt) / 1000 === d.eventStart &&
        Date.parse(def.endsAt) / 1000 >= d.eventStart &&
        positive(d.claimDeadline) &&
        d.claimDeadline >= d.eventStart + 7 * 86400 &&
        positive(d.depositOpensAt) &&
        d.depositOpensAt <= d.eventStart &&
        d.depositDeadline === d.eventStart &&
        typeof d.depositWei === "string" &&
        /^[1-9][0-9]*$/.test(d.depositWei) &&
        BigInt(d.depositWei) < 2n ** 256n &&
        same(d.resolver, a.resolver) &&
        same(d.arbitrator, a.arbitrator) &&
        d.arbitratorExtraData === V9_TESTNET_EXTRA_DATA &&
        typeof d.policyURI === "string" &&
        d.policyURI.length > 0 &&
        (d.implementationRevision === undefined ||
          d.implementationRevision === 1) &&
        (d.factoryImplementationRevision === undefined ||
          d.factoryImplementationRevision === 1),
      "V9 Chiado profile, principal, schedule or arbitration differs",
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
        "Missing V9 Chiado proxy or governance identity",
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
      "eventKey",
      "factoryEventId",
      "configurationHash",
      "templateHash",
    ])
      requireThat(
        field === "templateHash" ? pin(d[field]) : digest(d[field]),
        "Missing V9 Chiado runtime or configuration pin",
        "DEPLOYMENT_MISMATCH",
      );
    for (const field of [
      "deploymentBlock",
      "factoryDeploymentBlock",
      "timelockDeploymentBlock",
    ])
      requireThat(
        positive(d[field]),
        "Missing V9 Chiado canonical creation block",
        "DEPLOYMENT_MISMATCH",
      );
    requireThat(
      same(d.initialUpgradeOwner, g.initialOwner) &&
        same(d.owner, d.creator) &&
        d.projectMultisig === undefined &&
        new Set(
          [
            d.contract,
            d.factory,
            d.implementation,
            d.factoryImplementation,
            d.upgradeAuthority,
          ].map(lower),
        ).size === 5,
      "V9 Chiado initial ownership or proxy identities conflict",
      "INVALID_GOVERNANCE",
    );
  }
  return manifest;
}

/** Original reviewed mock artifacts remain separate from the normal V9 build provenance. */
export function verifyControlledV9Artifacts(provenance) {
  requireThat(
    pin(provenance?.mockSourceSha256) &&
      pin(provenance.mockArtifactsSha256?.MockKlerosLiquid) &&
      pin(provenance.mockArtifactsSha256?.MockArbitrableProxy),
    "Controlled Court requires reviewed source and artifact hashes",
    "CONTROLLED_ARTIFACT_PROVENANCE",
  );
  let source, artifacts;
  try {
    source = fs.readFileSync(
      new URL("../references/kickback/test/MockKleros.sol", import.meta.url),
      "utf8",
    );
    artifacts = Object.fromEntries(
      ["MockKlerosLiquid", "MockArbitrableProxy"].map((name) => [
        name,
        JSON.parse(
          fs.readFileSync(
            new URL(
              `../references/kickback/build/${name}.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      ]),
    );
  } catch {
    fail(
      "CONTROLLED_ARTIFACT_PROVENANCE",
      "Reviewed controlled Court artifacts are unavailable",
    );
  }
  requireThat(
    sha256(source) === provenance.mockSourceSha256 &&
      Object.entries(artifacts).every(
        ([name, artifact]) =>
          sha256(JSON.stringify(artifact)) ===
            provenance.mockArtifactsSha256[name] &&
          Array.isArray(artifact.abi) &&
          ethers.isHexString(artifact.bytecode) &&
          artifact.bytecode.length > 2,
      ),
    "Controlled Court source or artifact differs from the reviewed preview",
    "CONTROLLED_ARTIFACT_PROVENANCE",
  );
  return artifacts;
}

export async function verifyV9TestnetCourt(chain, artifacts) {
  const { provider, arbitration: a } = chain;
  requireThat(
    BigInt(await provider.send("eth_chainId", [])) === 10200n,
    "Controlled V9 preview requires Chiado10200",
    "WRONG_CHAIN",
  );
  const head = await provider.getBlock("latest");
  requireThat(
    positive(head?.number) &&
      digest(head.hash) &&
      Math.max(a.resolverDeploymentBlock, a.arbitratorDeploymentBlock) <=
        head.number,
    "Controlled Court head unavailable",
    "WRONG_ARBITRATION",
  );
  const anchors = new Map([[head.number, head.hash]]);
  const targets = [
    ["resolver", artifacts.MockArbitrableProxy, [a.arbitrator]],
    ["arbitrator", artifacts.MockKlerosLiquid, []],
  ];
  for (const [name, artifact, args] of targets) {
    const txHash = a[`${name}DeploymentTxHash`],
      number = a[`${name}DeploymentBlock`];
    const [tx, receipt, block, code] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
      provider.getBlock(number),
      provider.getCode(a[name], head.number),
    ]);
    const iface = new ethers.Interface(artifact.abi);
    const data = artifact.bytecode + iface.encodeDeploy(args).slice(2);
    requireThat(
      tx &&
        tx.to === null &&
        tx.value === 0n &&
        Number(tx.chainId) === 10200 &&
        same(tx.hash, txHash) &&
        same(tx.data, data) &&
        receipt?.status === 1 &&
        receipt.blockNumber === number &&
        tx.blockNumber === number &&
        block?.number === number &&
        same(receipt.hash ?? receipt.transactionHash, txHash) &&
        digest(block.hash) &&
        same(receipt.blockHash, block.hash) &&
        same(tx.blockHash, block.hash) &&
        same(receipt.contractAddress, a[name]) &&
        same(
          ethers.getCreateAddress({ from: tx.from, nonce: tx.nonce }),
          a[name],
        ) &&
        code !== "0x" &&
        same(ethers.keccak256(code), a[`${name}CodeHash`]) &&
        (!anchors.has(number) || same(anchors.get(number), block.hash)),
      "Controlled Court constructor, runtime or canonical birth differs",
      "WRONG_ARBITRATION",
    );
    anchors.set(number, block.hash);
  }
  const resolver = new ethers.Contract(
    a.resolver,
    artifacts.MockArbitrableProxy.abi,
    provider,
  );
  const arbitrator = new ethers.Contract(
    a.arbitrator,
    artifacts.MockKlerosLiquid.abi,
    provider,
  );
  const at = { blockTag: head.number };
  const [link, multipliers, fee] = await Promise.all([
    resolver.arbitrator(at),
    resolver.getMultipliers(at),
    arbitrator.arbitrationCost(V9_TESTNET_EXTRA_DATA, at),
  ]);
  requireThat(
    same(link, a.arbitrator) &&
      [...multipliers].map(String).join() === "10000,20000,5000,10000" &&
      fee > 0n,
    "Controlled Court link, multipliers or current fee differs",
    "WRONG_ARBITRATION",
  );
  for (const [number, expected] of anchors)
    if (number !== head.number)
      requireThat(
        same((await provider.getBlock(number))?.hash, expected),
        "Controlled Court verification anchor reorganized",
        "WRONG_ARBITRATION",
      );
  await provider.send("eth_chainId", []);
  requireThat(
    same((await provider.getBlock(head.number))?.hash, head.hash),
    "Controlled Court verification head reorganized",
    "WRONG_ARBITRATION",
  );
  return {
    status: "verified-controlled",
    chainId: 10200,
    block: { number: head.number, hash: head.hash, timestamp: head.timestamp },
    resolver: { address: a.resolver, codeHash: a.resolverCodeHash },
    arbitrator: { address: a.arbitrator, codeHash: a.arbitratorCodeHash },
    arbitrationCostWei: String(fee),
    extraData: V9_TESTNET_EXTRA_DATA,
  };
}

/** Test dependencies are trusted code arguments, never API/env/manifest configuration. */
export async function v9TestnetChain(manifestInput, rpcUrl, options = {}) {
  requireThat(
    options &&
      Object.keys(options).every((key) =>
        [
          "providerFactory",
          "verifyDeployment",
          "verifyCourt",
          "verifyArtifactSources",
          "fetcher",
          "timeoutMs",
          "maxAttempts",
        ].includes(key),
      ) &&
      [
        "providerFactory",
        "verifyDeployment",
        "verifyCourt",
        "verifyArtifactSources",
        "fetcher",
      ].every(
        (key) =>
          options[key] === undefined || typeof options[key] === "function",
      ) &&
      positive(options.timeoutMs ?? 20000) &&
      (options.timeoutMs ?? 20000) <= 30000 &&
      positive(options.maxAttempts ?? 2) &&
      (options.maxAttempts ?? 2) <= 5,
    "Invalid trusted V9 testnet runtime dependency or read bounds",
    "INVALID_INPUT",
  );
  const manifest = validateV9TestnetManifest(manifestInput);
  try {
    await (options.verifyArtifactSources ?? verifyV9ArtifactSources)(
      manifest.provenance,
    );
  } catch {
    fail("V9_ARTIFACT_PROVENANCE", "V9 testnet build source approval failed");
  }
  const artifacts = verifyControlledV9Artifacts(manifest.controlledProvenance);
  const rpc = rpcUrl === undefined ? manifest.chain.rpcUrl : endpoint(rpcUrl);
  let provider,
    closed = false;
  try {
    provider = await (options.providerFactory ?? createReadOnlyHttpProvider)(
      rpc,
      options,
    );
    requireThat(
      provider &&
        typeof provider.send === "function" &&
        typeof provider.destroy === "function",
      "Read-only Chiado provider required",
      "INVALID_INPUT",
    );
  } catch {
    try {
      await provider?.destroy?.();
    } catch {
      /* Remote diagnostics are not public. */
    }
    fail(
      "V9_TESTNET_PROVIDER_FAILED",
      "V9 testnet read provider could not be initialized",
    );
  }
  const rawSend = provider.send.bind(provider);
  const verification = createVerificationRuntime({
    send: rawSend,
    expectedChainId: 10200,
    timeoutMs: options.timeoutMs ?? 20000,
    maxAttempts: options.maxAttempts ?? 2,
  });
  if (typeof provider._send === "function") {
    const rawBatch = provider._send.bind(provider);
    provider._send = async (payload) => {
      requireThat(!closed, "V9 testnet provider is closed", "PROVIDER_CLOSED");
      const list = Array.isArray(payload) ? payload : [payload];
      requireThat(
        list.length &&
          list.every(
            (item) =>
              item &&
              methods.has(item.method) &&
              Array.isArray(item.params ?? []),
          ),
        "V9 testnet backend RPC is read-only",
        "FORBIDDEN_METHOD",
        403,
      );
      try {
        return await rawBatch(payload);
      } catch {
        throw Object.assign(
          new Error("V9 testnet RPC read failed; remote diagnostics withheld"),
          { code: "NETWORK_ERROR" },
        );
      }
    };
  }
  provider.send = (method, params = []) => {
    requireThat(!closed, "V9 testnet provider is closed", "PROVIDER_CLOSED");
    return verification.request(method, params, { phase: "verification" });
  };
  for (const name of ["getSigner", "listAccounts", "broadcastTransaction"])
    provider[name] = async () =>
      fail(
        "FORBIDDEN_METHOD",
        "V9 testnet backend has no signer or broadcast capability",
        403,
      );
  const context = {
    provider,
    chainId: 10200,
    production: false,
    testnet: true,
    financialModel: "v8",
    governance: manifest.governance,
    arbitration: manifest.arbitration,
    manifest,
    eventVerification: new Map(),
  };
  try {
    await provider.send("eth_chainId", []);
    const court = await (options.verifyCourt ?? verifyV9TestnetCourt)(
      context,
      artifacts,
    );
    requireThat(
      court?.status === "verified-controlled" &&
        court.chainId === 10200 &&
        same(court.resolver?.address, manifest.arbitration.resolver) &&
        same(court.arbitrator?.address, manifest.arbitration.arbitrator) &&
        same(court.resolver.codeHash, manifest.arbitration.resolverCodeHash) &&
        same(
          court.arbitrator.codeHash,
          manifest.arbitration.arbitratorCodeHash,
        ),
      "Controlled Chiado Court verification did not establish the reviewed stack",
      "WRONG_ARBITRATION",
    );
    const verify =
      options.verifyDeployment ??
      (await import("./v9-testnet-verification.mjs")).verifyV9TestnetDeployment;
    requireThat(
      typeof verify === "function",
      "V9 testnet deployment verifier required",
      "INVALID_INPUT",
    );
    for (const record of manifest.events) {
      try {
        await verify(context, record.deployment);
        context.eventVerification.set(record.definition.id, {
          status: "verified",
        });
      } catch (error) {
        if (!unavailableCodes.has(error?.code)) throw error;
        context.eventVerification.set(record.definition.id, {
          status: "unavailable",
          code: error.code,
        });
      }
    }
    await provider.send("eth_chainId", []);
    return {
      ...context,
      rpcUrl: manifest.chain.rpcUrl,
      signers: [],
      court,
      resolver: new ethers.Contract(
        manifest.arbitration.resolver,
        artifacts.MockArbitrableProxy.abi,
        provider,
      ),
      liquid: new ethers.Contract(
        manifest.arbitration.arbitrator,
        artifacts.MockKlerosLiquid.abi,
        provider,
      ),
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await provider.destroy();
        } catch {
          fail("CLEANUP_FAILED", "V9 testnet provider cleanup failed");
        }
      },
    };
  } catch (error) {
    closed = true;
    try {
      await provider.destroy();
    } catch {
      /* Preserve primary verification failure. */
    }
    const code =
      error instanceof VerificationError
        ? error.code
        : [
              "WRONG_CHAIN",
              "WRONG_ARBITRATION",
              "INVALID_INPUT",
              "V9_ARTIFACT_PROVENANCE",
              "CONTROLLED_ARTIFACT_PROVENANCE",
            ].includes(error?.code)
          ? error.code
          : "V9_TESTNET_VERIFICATION_FAILED";
    fail(code, "V9 testnet verification failed; remote diagnostics withheld");
  }
}

/** Separate private namespace binds the full reviewed Chiado manifest; no identity rewriting. */
export function v9TestnetStateStore(filename, input) {
  requireThat(
    typeof filename === "string" && path.isAbsolute(filename),
    "V9 testnet state needs an explicit absolute path",
    "INVALID_INPUT",
  );
  const manifest = validateV9TestnetManifest(input),
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
      fail("STATE_UNAVAILABLE", "V9 testnet state is unavailable");
    }
    requireThat(
      info.isFile() &&
        !info.isSymbolicLink() &&
        (info.mode & 0o077) === 0 &&
        (process.getuid === undefined || info.uid === process.getuid()),
      "V9 testnet state must be an owner-only regular file",
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
        "V9 testnet state changed while opening",
        "STATE_PERMISSIONS",
      );
      saved = JSON.parse(fs.readFileSync(fd, "utf8"));
    } catch (error) {
      if (error.code === "STATE_PERMISSIONS") throw error;
      fail("STATE_INVALID", "V9 testnet state cannot be decoded securely");
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    requireThat(
      saved?.version === 1 &&
        saved.environment === "testnet" &&
        saved.chainId === 10200 &&
        saved.contractVersion === V9_TESTNET_PROFILE &&
        saved.binding === binding &&
        Array.isArray(saved.events) &&
        saved.events.length === deployments.size &&
        Array.isArray(saved.drafts) &&
        saved.events.every(
          (record) =>
            record &&
            deployments.has(record.eventId) &&
            record.definition?.id === record.eventId,
        ) &&
        new Set(saved.events.map((record) => record.eventId)).size ===
          saved.events.length,
      "State belongs to another V9 testnet manifest or environment",
      "STATE_SCOPE",
    );
    return saved;
  };
  return {
    load,
    save(events, drafts) {
      load();
      requireThat(
        events instanceof Map &&
          drafts instanceof Map &&
          events.size === deployments.size,
        "V9 testnet state requires its complete reviewed registry",
        "STATE_SCOPE",
      );
      const seen = new Set();
      const records = [...events].map(([eventId, record]) => {
        const trusted = deployments.get(record?.deployment?.eventId);
        requireThat(
          trusted &&
            eventId === trusted.definition.id &&
            !seen.has(eventId) &&
            hash(record.deployment) === hash(trusted.deployment) &&
            record.definition?.id === eventId,
          "V9 testnet record left its reviewed deployment",
          "STATE_SCOPE",
        );
        seen.add(eventId);
        return {
          eventId,
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
      const saved = {
        version: 1,
        environment: "testnet",
        chainId: 10200,
        contractVersion: V9_TESTNET_PROFILE,
        binding,
        events: records,
        drafts: [...drafts],
      };
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(saved), {
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
