// Inert unless --execute is explicit. Public receipt/source proof only; no app-state or journal import/export.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { validateV10MainnetManifest, validateV10MainnetDynamicEvent } from "../../src/v10-mainnet-runtime.mjs";
import { verifyV10ArtifactSources, loadV10UpgradeableArtifacts } from "../../src/v10-upgrade-artifacts.mjs";
import { verifyV10Deployment, V10_MAINNET_SCOPE } from "../../src/v10-upgrade-verification.mjs";
import { createV10ProductionWallets } from "../../src/v10-production-wallets.mjs";
import { createV10PacedFetcher } from "../../src/v10-wallet-deployment.mjs";
import { eventV10LumaTemplate } from "../../src/contracts-v10-luma.mjs";
import { hash, json } from "../../src/utils.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TX_HASH = "0x79a20177c15ae2201fb6f8731f0ef17e719298fc60df2abdb1a3e61c8bd0cd2f";
// Exact human receipt observation: artifacts/truth-pays-ist/receipt-observation.json (b08c04a0…a8bd28), not a historical permission claim.
const EXPECTED_CREATOR = "0x2bb03593892724d225071068e59ab1e48af05b55";
const ORIGIN = "https://kleros-luma-v10-ethereum.netlify.app";
const MANIFEST = "registry/ethereum-v10-luma-mainnet.json";
const MANIFEST_SHA = "fadbb93a7d7d653eb610dbb26eb406a3fe88d55fbaa35ba3f34d83ff3ade6efd";
const PROPOSAL = "artifacts/truth-pays-ist/replacement-proposal.json";
const PROPOSAL_SHA = "f6cafab38b65699ae5303df44b9ab864cb14d7cd320aa881a95011cded27fa46";
const CATALOG = "artifacts/truth-pays-ist/catalog-after-creation.json";
const CATALOG_SHA = "fc86feef28dd9125ade3e2153059954631b69656f040d53cbd8f33a4856a37b6";
const EVENT_ID = "event-3aac5a07-5074-4241-9246-2798d4111039";
const EVENT_KEY = "0xdf654478e371543789a5b4f13fd127239ee71e038acf2997b5ef5763fecdecdc";
const RPC = "https://eth.drpc.org/", HISTORY_RPC = "https://ethereum-rpc.publicnode.com/";
const PROFILE = "kleros-event-v10-uups", PROOF_INSTANCE = "ist-replacement-public-source-proof";
const MAX_REQUESTS = 512, MAX_RESPONSE_BYTES = 2_000_000, DEADLINE_MS = 20 * 60_000;
const METHODS = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_getLogs"]);
const SOURCE_KEYS = ["chainId", "contractVersion", "abiVersion", "factory", "factoryCodeHash", "factoryImplementation",
  "factoryImplementationCodeHash", "initialFactoryImplementation", "initialImplementation", "implementation", "implementationCodeHash",
  "upgradeAuthority", "upgradeAuthorityCodeHash", "initialUpgradeOwner", "factoryDeploymentTxHash", "factoryDeploymentBlock",
  "controllerDeploymentTxHash", "controllerDeploymentBlock"];
const SOURCES = ["tools/first-event/verify-ist-replacement.mjs", "src/v10-upgrade-verification.mjs", "src/v10-upgrade-artifacts.mjs",
  "src/v10-mainnet-runtime.mjs", "src/mainnet-runtime.mjs", "src/v10-read-batch.mjs", "src/v10-production-wallets.mjs",
  "src/v10-wallet-compatibility.mjs", "src/v10-wallet-deployment.mjs", "src/contracts-v10-luma.mjs", "src/utils.mjs",
  "scripts/mainnet/v10-runtime-code.mjs"];
const sha = value => createHash("sha256").update(value).digest("hex");
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const check = (ok, code = "REPLACEMENT_PROOF_MISMATCH") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
const sourceHashes = () => Object.fromEntries(SOURCES.map(file => [file, sha(fs.readFileSync(path.join(ROOT, file)))]));
const readPublic = (file, pin) => {
  const resolved = path.join(ROOT, file), info = fs.lstatSync(resolved);
  check(info.isFile() && !info.isSymbolicLink() && fs.realpathSync(resolved) === resolved && info.size <= MAX_RESPONSE_BYTES,
    "INVALID_PUBLIC_INPUT");
  const bytes = fs.readFileSync(resolved); check(sha(bytes) === pin, "PUBLIC_INPUT_CHANGED");
  return JSON.parse(bytes);
};
function optionsOf(args) {
  let execute = false, eventId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute" && !execute) execute = true;
    else if (args[i] === "--event-id" && eventId === null) {
      eventId = args[++i]; check(typeof eventId === "string" && /^event-[A-Za-z0-9_-]{1,154}$/.test(eventId), "INVALID_EVENT_ID");
    } else check(false, "INVALID_OPTIONS");
  }
  return { execute, eventId };
}
const options = optionsOf(process.argv.slice(2));
check(!options.execute || options.eventId, "CONFIRMED_APP_EVENT_ID_REQUIRED");
const manifest = validateV10MainnetManifest(readPublic(MANIFEST, MANIFEST_SHA));
const proposal = readPublic(PROPOSAL, PROPOSAL_SHA), input = proposal.input, f = manifest.factoryDeployment;
const catalog = readPublic(CATALOG, CATALOG_SHA), rows = catalog.events?.filter(row => row.id === EVENT_ID);
check(catalog.kind === "public-catalog" && catalog.mode === "hosted-production" && catalog.environment?.production === true &&
  catalog.environment.chainId === 1 && catalog.catalog?.source === "recorded-adoption" && catalog.catalog.metadataOnly === true &&
  catalog.catalog.currentFinancialState === "not-loaded" && Array.isArray(rows) && rows.length === 1, "RECORDED_ADOPTION_REQUIRED");
const adoption = rows[0];
check((!options.eventId || options.eventId === EVENT_ID) && ethers.id(EVENT_ID) === EVENT_KEY &&
  adoption.contract === "0xc069A460c5B1c577791Ee61E7F9ADcb7866068df" && adoption.contractVersion === PROFILE && adoption.abiVersion === PROFILE &&
  adoption.chainId === 1 && adoption.adoption?.kind === "recorded-adoption" && adoption.adoption.txHash === TX_HASH &&
  adoption.adoption.blockNumber === 26305185 && adoption.adoption.blockHash === "0x3f52e49429d21e97448988ef13ac9ccbbdd8deaed93eb4b720049a1a26b9cd0c" &&
  adoption.title === input.title && adoption.startsAt === input.startsAt && adoption.endsAt === input.endsAt && adoption.timezone === input.timezone &&
  adoption.depositWei === "10000000000000000" && adoption.visibility === "public" && adoption.editorialStatus === "published", "CATALOG_BINDING_MISMATCH");
check(input.title === "Truth Pays: Queryable Data, Prediction Markets & Onchain Justice" && input.lumaUrl === "https://luma.com/qewnqhas" &&
  input.startsAt === "2026-11-04T12:30:00.000Z" && input.endsAt === "2026-11-04T16:30:00.000Z" &&
  input.timezone === "Asia/Kolkata" && input.depositEth === "0.01" && input.capacity === 150 &&
  proposal.derivedContractTerms.eventStart === 1793795400 && proposal.derivedContractTerms.claimDeadline === 1794400200,
  "EXPECTED_TERMS_CHANGED");
verifyV10ArtifactSources(manifest.provenance);
const artifacts = loadV10UpgradeableArtifacts(), factoryInterface = new ethers.Interface(artifacts.factory.abi);
const template = eventV10LumaTemplate({ eventName: input.title, depositAmount: "10000000000000000", policyURI: f.policy.uri,
  policySha256: f.policy.sha256, lumaUrl: input.lumaUrl, startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone });
const configuration = { depositAmount: "10000000000000000", eventName: input.title, eventStart: 1793795400, claimDeadline: 1794400200,
  arbitration: { disputeResolver: manifest.arbitration.resolver, extraData: manifest.arbitration.extraData,
    metaEvidenceTemplate: template.pieces, metaEvidenceSlots: template.slots, policyURI: f.policy.uri } };
const CONFIG = "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
const base = {
  kind: "truth-pays-ist-replacement-public-source-proof", status: "review-only", originalHash: TX_HASH,
  eventId: EVENT_ID, expectedTerms: { ...input, depositWei: configuration.depositAmount, eventStart: 1793795400, claimDeadline: 1794400200 },
  inputs: { manifest: MANIFEST, manifestSha256: MANIFEST_SHA, proposal: PROPOSAL, proposalSha256: PROPOSAL_SHA,
    catalog: CATALOG, catalogSha256: CATALOG_SHA, catalogInstanceId: catalog.instanceId, catalogGeneratedAt: catalog.generatedAt },
  sourceHashes: sourceHashes(),
  transport: { endpoint: RPC, historyEndpoint: HISTORY_RPC, methods: [...METHODS], retries: 0, minimumAdmissionIntervalMs: 1500,
    timeoutMs: 30000, maximumRequests: MAX_REQUESTS, maximumDurationMs: DEADLINE_MS, credentials: "omit", redirects: "error" },
  privateSigningFilesRead: 0, appStateFilesRead: 0, journalsRead: 0, walletRequests: 0, signatures: 0, broadcasts: 0,
  savedDraftsCreated: 0, appStateWrites: 0, financialAuthority: false,
};

async function execute() {
  const record = { ...base, status: "unavailable", startedAt: new Date().toISOString(), requests: [] };
  const stopped = new AbortController(), activeRequests = new Set();
  const deadline = AbortSignal.any([AbortSignal.timeout(DEADLINE_MS), stopped.signal]);
  let provider, historyProvider, lastTransportCode = null;
  const pacedFetcher = createV10PacedFetcher({ fetcher: async (endpoint, request = {}) => {
    check([RPC, HISTORY_RPC].includes(endpoint) && request.method === "POST" && request.redirect === "error", "FORBIDDEN_TRANSPORT");
    let payload; try { payload = JSON.parse(request.body); } catch { check(false, "INVALID_RPC_PAYLOAD"); }
    check(payload && !Array.isArray(payload) && payload.jsonrpc === "2.0" && METHODS.has(payload.method) &&
      Array.isArray(payload.params) && Object.keys(payload).every(key => ["jsonrpc", "id", "method", "params"].includes(key)), "FORBIDDEN_RPC_METHOD");
    check(record.requests.length < MAX_REQUESTS && !deadline.aborted, "RPC_READ_BOUND");
    const row = { endpoint, method: payload.method }; record.requests.push(row);
    try {
      const response = await fetch(endpoint, { ...request, credentials: "omit", redirect: "error",
        signal: AbortSignal.any([deadline, ...(request.signal ? [request.signal] : [])]) });
      row.httpStatus = response.status;
      check(response.ok && !response.redirected, "RPC_HTTP_UNAVAILABLE");
      const length = Number(response.headers.get("content-length"));
      check(!length || length <= MAX_RESPONSE_BYTES, "RPC_RESPONSE_BOUND");
      const bytes = new Uint8Array(await response.arrayBuffer()); check(bytes.byteLength <= MAX_RESPONSE_BYTES, "RPC_RESPONSE_BOUND");
      let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { check(false, "RPC_INVALID_RESPONSE"); }
      check(body && !Array.isArray(body) && body.jsonrpc === "2.0" && body.id === payload.id, "RPC_INVALID_RESPONSE");
      if (body.error) {
        if (Number.isSafeInteger(body.error.code)) row.rpcErrorCode = body.error.code;
        check(false, "RPC_READ_UNAVAILABLE");
      }
      check(Object.hasOwn(body, "result"), "RPC_INVALID_RESPONSE");
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    } catch (error) {
      lastTransportCode = /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code ?? "") ? error.code : "RPC_READ_UNAVAILABLE";
      row.code = lastTransportCode; throw Object.assign(new Error(lastTransportCode), { code: lastTransportCode });
    }
  } });
  const fetcher = (endpoint, request) => {
    const pending = pacedFetcher(endpoint, request); activeRequests.add(pending);
    pending.finally(() => activeRequests.delete(pending)).catch(() => {});
    return pending;
  };
  // Public ethers subclassing API, with static formatting network ONLY to prevent
  // its automatic failed-initial-detection retry loop. Actual chain1 is explicitly
  // queried below and by every unchanged verifier batch/closing guard.
  class PublicProofProvider extends ethers.JsonRpcApiProvider {
    constructor(endpoint) {
      super(1, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
      this.endpoint = endpoint; this._start();
    }
    async _send(payload) {
      const response = await fetcher(this.endpoint, { method: "POST", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
        signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]) });
      return [await response.json()];
    }
  }
  try {
    provider = new PublicProofProvider(RPC);
    historyProvider = new PublicProofProvider(HISTORY_RPC);
    check(BigInt(await provider.send("eth_chainId", [])) === 1n && BigInt(await historyProvider.send("eth_chainId", [])) === 1n, "WRONG_CHAIN");
    const tx = await provider.getTransaction(TX_HASH), receipt = await provider.getTransactionReceipt(TX_HASH);
    check(tx && receipt, "RECEIPT_PENDING");
    const header = await provider.getBlock(receipt.blockNumber), historical = await historyProvider.getBlock(receipt.blockNumber);
    check(receipt.status === 1 && BigInt(tx.chainId) === 1n && same(tx.hash, TX_HASH) && same(receipt.hash, TX_HASH) &&
      tx.blockNumber === receipt.blockNumber && same(tx.blockHash, receipt.blockHash) && same(header?.hash, receipt.blockHash) &&
      same(historical?.hash, receipt.blockHash), "NONCANONICAL_RECEIPT");
    const created = receipt.logs.filter(log => same(log.address, f.factory)).flatMap(log => {
      try { const parsed = factoryInterface.parseLog(log); return parsed?.name === "EventCreated" ? [parsed] : []; } catch { return []; }
    });
    check(created.length === 1, "EXACT_EVENT_CREATED_REQUIRED");
    const args = created[0].args, creator = ethers.getAddress(args.creator), child = ethers.getAddress(args.eventContract);
    check(args.version === 10n && same(creator, EXPECTED_CREATOR) && child !== ethers.ZeroAddress &&
      !same(child, proposal.original.contract), "CREATION_IDENTITY_MISMATCH");
    const configurationHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", CONFIG], [creator, configuration]));
    const factoryEventId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address", "address", "bytes32"],
      [1, f.factory, creator, args.eventKey]));
    check(same(args.configurationHash, configurationHash) && same(args.eventId, factoryEventId) && args.eventKey !== ethers.ZeroHash,
      "EXACT_TERMS_MISMATCH");
    check(options.eventId === EVENT_ID && same(ethers.id(options.eventId), args.eventKey) && args.eventKey === EVENT_KEY &&
      same(child, adoption.contract) && receipt.blockNumber === adoption.adoption.blockNumber && same(receipt.blockHash, adoption.adoption.blockHash),
      "APP_EVENT_ID_MISMATCH");
    record.receipt = { hash: TX_HASH, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, timestamp: header.timestamp,
      status: "confirmed", creator, contract: child, factory: f.factory, eventKey: args.eventKey, factoryEventId, configurationHash,
      canonicalAtBothPublicEndpoints: true };
    const deployment = { ...Object.fromEntries(SOURCE_KEYS.map(key => [key, f[key]])), ...(options.eventId ? { eventId: options.eventId } : {}),
      contract: child, deploymentTxHash: TX_HASH, deploymentBlock: receipt.blockNumber, owner: creator, creator,
      eventName: input.title, depositWei: configuration.depositAmount, eventStart: configuration.eventStart,
      claimDeadline: configuration.claimDeadline, depositOpensAt: header.timestamp, depositDeadline: configuration.eventStart,
      resolver: manifest.arbitration.resolver, arbitrator: manifest.arbitration.arbitrator, arbitratorExtraData: manifest.arbitration.extraData,
      policyURI: f.policy.uri, templateHash: hash([template.pieces, template.slots]), eventKey: args.eventKey, factoryEventId, configurationHash,
      codeHash: ethers.keccak256(artifacts.proxy.deployedBytecode) };
    record.onchainDeployment = deployment;
    if (options.eventId) record.publicRecord = validateV10MainnetDynamicEvent({
      definition: { id: options.eventId, title: input.title, slug: options.eventId, description: "", location: "", lumaUrl: input.lumaUrl,
        startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone, visibility: "public", editorialStatus: "published",
        registrationStatus: "open", organizers: [creator], staff: [] }, deployment, policy: f.policy.text, pieces: template.pieces, slots: template.slots,
    }, manifest);
    const chain = { provider, production: true, chainId: 1, governance: manifest.governance, manifest };
    const inspector = createV10ProductionWallets({ chain, origin: ORIGIN, instanceId: PROOF_INSTANCE });
    // Proof-only identifiers scope public cryptographic inspection. They are never saved app drafts/seals or actor capabilities.
    chain.assertTransactionIntent = (actual, expected) => inspector.inspectReviewedTransaction({ actual, expected, scope: {
      contractVersion: PROFILE, abiVersion: PROFILE, chainId: 1, mode: "hosted-production", origin: ORIGIN, instanceId: PROOF_INSTANCE,
      wallet: expected.from, eventId: options.eventId ?? "public-receipt-proof", draftId: "public-receipt-proof-no-app-draft",
      action: expected.to === null ? "deployContract" : "createEvent", contract: expected.to, manifestHash: hash(manifest),
    } });
    const expectedIntent = { chainId: 1, transactionHash: TX_HASH, from: creator, to: f.factory, valueWei: "0",
      data: factoryInterface.encodeFunctionData("createEvent", [args.eventKey, configuration]) };
    record.intent = await chain.assertTransactionIntent(tx, expectedIntent);
    check(record.intent.verified === true && record.intent.dataHash === ethers.keccak256(expectedIntent.data), "SIGNED_INTENT_UNVERIFIED");
    const initial = await provider.getBlock("latest"), historyInitial = await historyProvider.getBlock(initial.number);
    check(initial.hash && same(initial.hash, historyInitial?.hash), "PUBLIC_ENDPOINT_ANCHOR_MISMATCH");
    record.initialAnchor = { number: initial.number, hash: initial.hash };
    // Exact unchanged verifier; only historical log transport uses the committed archive-capable public endpoint.
    provider.getLogs = filter => historyProvider.getLogs(filter);
    record.proof = await verifyV10Deployment(chain, deployment, V10_MAINNET_SCOPE);
    check(record.proof?.deploymentTrust?.status === "verified" && same(record.proof.deploymentTrust.creationBlockHash, receipt.blockHash),
      "SOURCE_PROOF_UNVERIFIED");
    const closing = await historyProvider.getBlock(record.proof.anchor.number), receiptClosing = await provider.getTransactionReceipt(TX_HASH);
    check(same(closing?.hash, record.proof.anchor.hash) && receiptClosing?.status === 1 &&
      same(receiptClosing.blockHash, receipt.blockHash) && receiptClosing.blockNumber === receipt.blockNumber &&
      BigInt(await provider.send("eth_chainId", [])) === 1n && BigInt(await historyProvider.send("eth_chainId", [])) === 1n,
      "CLOSING_CANONICALITY_MISMATCH");
    check(json(sourceHashes()) === json(base.sourceHashes), "PROOF_SOURCE_CHANGED");
    record.status = "verified";
    record.appEventIdBound = !!options.eventId;
    record.recordedAdoptionProven = true; // Hash-pinned public catalog snapshot; does not claim a later server restart or current eligibility.
  } catch (error) {
    record.code = lastTransportCode ?? (/^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code ?? "") ? error.code : "READ_UNAVAILABLE");
    process.exitCode = 1;
  } finally {
    stopped.abort();
    await Promise.allSettled([provider?.destroy(), historyProvider?.destroy()]);
    await Promise.allSettled([...activeRequests]);
    record.checkedAt = new Date().toISOString(); record.networkRequests = record.requests.length;
    const output = path.join(ROOT, "artifacts/truth-pays-ist", `replacement-public-proof-${record.checkedAt.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(output, json(record) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ proofFile: path.relative(ROOT, output), proofSha256: sha(fs.readFileSync(output)), status: record.status,
      code: record.code ?? null, receipt: record.receipt ?? null, appEventIdBound: record.appEventIdBound ?? false,
      recordedAdoptionProven: record.recordedAdoptionProven ?? false, networkRequests: record.networkRequests, signatures: 0, broadcasts: 0 }));
  }
}
if (options.execute) await execute();
else console.log(JSON.stringify({ ...base, networkRequests: 0,
  limits: ["No RPC calls or files written without --execute.", "Execution requires the exact --event-id from the hash-pinned confirmed public catalog, whose keccak matches the observed event key.",
    "The saved recorded-adoption snapshot does not prove a later server restart or grant current financial authority."] }, null, 2));
