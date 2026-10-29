// Display-only recorded creation metadata. This module never checks current chain state or action authority.
import { ethers } from "ethers";
import { hash, requireThat } from "./utils.mjs";
import { MAINNET_PROFILE, validateMainnetManifest, validateMainnetDynamicEvent } from "./mainnet-runtime.mjs";
import { V9_LUMA_ATTENDANCE_STANDARD } from "./contracts-v9-luma.mjs";

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const digest = (value) => ethers.isHexString(value, 32) && value !== ethers.ZeroHash;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const CONFIG_TYPE = "tuple(uint256 depositAmount,string eventName,uint256 eventStart,uint256 claimDeadline,tuple(address disputeResolver,bytes extraData,string[] metaEvidenceTemplate,bytes metaEvidenceSlots,string policyURI) arbitration)";
const factoryInterface = new ethers.Interface([`function createEvent(bytes32 eventKey,${CONFIG_TYPE} config) returns(address)`]);
const FACTORY_SOURCE_FIELDS = ["chainId", "contractVersion", "abiVersion", "factory", "factoryCodeHash", "factoryImplementation",
  "factoryImplementationCodeHash", "initialFactoryImplementation", "initialImplementation", "implementation", "implementationCodeHash",
  "upgradeAuthority", "upgradeAuthorityCodeHash", "initialUpgradeOwner", "factoryDeploymentTxHash", "factoryDeploymentBlock",
  "timelockDeploymentTxHash", "timelockDeploymentBlock"];

function adoptedEntry(eventId, record, draftEntries, manifest) {
  const d = record.deployment, definition = record.definition, factory = manifest.factoryDeployment;
  if (record.dynamic !== true || !d || definition.id !== eventId || d.eventId !== eventId ||
    d.eventKey !== ethers.id(eventId)) return null;
  // This is structural/immutable validation, not a current on-chain verification.
  validateMainnetDynamicEvent(record, manifest);
  const matches = draftEntries.filter(([, draft]) => draft?.scopeKind === "factory-create" && draft.eventId === eventId &&
    draft.status === "confirmed" && draft.used === true && draft.adoptionStatus === "verified");
  if (matches.length !== 1) return null;
  const [draftId, draft] = matches[0], terms = draft.terms, tx = draft.transaction;
  if (!terms || draft.id !== draftId || draft.chainId !== 1 || draft.contractVersion !== MAINNET_PROFILE ||
    draft.abiVersion !== MAINNET_PROFILE || draft.mode !== "hosted-production" || draft.action !== "createEvent" ||
    draft.method !== "createEvent" || draft.valueWei !== "0" || !same(draft.contract, factory.factory) ||
    !same(draft.factory, factory.factory) || draft.factoryFingerprint !== hash(factory) ||
    draft.eventKey !== d.eventKey || !same(draft.wallet, d.creator) || !same(draft.createdContract, d.contract) ||
    !digest(draft.confirmedHash) || !same(draft.confirmedHash, draft.submittedHash) ||
    !same(draft.confirmedHash, d.deploymentTxHash) || !positive(draft.blockNumber) ||
    draft.blockNumber !== d.deploymentBlock || !digest(draft.blockHash) ||
    !positive(draft.reviewBlock) || draft.reviewBlock >= draft.blockNumber ||
    !FACTORY_SOURCE_FIELDS.every((key) => typeof factory[key] === "number"
      ? draft.factorySource?.[key] === factory[key] : same(draft.factorySource?.[key], factory[key]))) return null;
  const configuration = { depositAmount: d.depositWei, eventName: d.eventName, eventStart: d.eventStart, claimDeadline: d.claimDeadline,
    arbitration: { disputeResolver: d.resolver, extraData: d.arbitratorExtraData,
      metaEvidenceTemplate: record.pieces, metaEvidenceSlots: record.slots, policyURI: d.policyURI } };
  const data = factoryInterface.encodeFunctionData("createEvent", [d.eventKey, configuration]);
  if (!tx || tx.chainId !== 1 || tx.value !== "0" || !same(tx.from, d.creator) || !same(tx.to, factory.factory) ||
    !same(tx.data, data) || !same(factoryInterface.encodeFunctionData("createEvent", [draft.eventKey, draft.config]), data) ||
    !same(factoryInterface.encodeFunctionData("createEvent", draft.args), data) ||
    hash([draft.template?.pieces, draft.template?.slots]) !== d.templateHash || draft.policyText !== record.policy ||
    terms.title !== d.eventName || terms.depositWei !== d.depositWei || terms.eventStart !== d.eventStart ||
    terms.claimDeadline !== d.claimDeadline || terms.lumaUrl !== definition.lumaUrl ||
    terms.startsAt !== definition.startsAt || terms.endsAt !== definition.endsAt || terms.timezone !== definition.timezone ||
    terms.policyURI !== d.policyURI || terms.policySha256 !== hash(record.policy) ||
    hash(terms.attendanceStandard) !== hash(V9_LUMA_ATTENDANCE_STANDARD)) return null;
  return { id: eventId, title: definition.title, startsAt: definition.startsAt, endsAt: definition.endsAt,
    timezone: definition.timezone, depositWei: d.depositWei, chainId: 1, contract: d.contract,
    contractVersion: MAINNET_PROFILE, abiVersion: MAINNET_PROFILE, visibility: "public", editorialStatus: "published",
    adoption: { kind: "recorded-adoption", txHash: draft.confirmedHash, blockNumber: draft.blockNumber, blockHash: draft.blockHash } };
}

/** Synchronous, detached public metadata only. No provider, signer, store, session or trust mutation is accepted.
 * @param {{manifest?:any,events?:Map<string,any>,drafts?:Map<string,any>,instanceId?:string,now?:number}} [options]
 */
export function publicCatalogSnapshot({ manifest: input, events, drafts, instanceId, now = Date.now() } = {}) {
  requireThat(events instanceof Map && drafts instanceof Map && typeof instanceId === "string" &&
    /^[A-Za-z0-9_-]{1,160}$/.test(instanceId) && Number.isSafeInteger(now) && now >= 0 && now <= 8_640_000_000_000_000,
  "Public catalog requires a scoped production registry and clock", "PUBLIC_CATALOG_SCOPE", 409);
  const manifest = validateMainnetManifest(input);
  requireThat(manifest.factoryDeployment, "Public catalog requires the reviewed production factory", "PUBLIC_CATALOG_SCOPE", 409);
  const candidates = [], draftEntries = [...drafts];
  for (const [eventId, record] of events) {
    try {
      // This must precede title, deployment, participant or search-index access.
      if (record?.definition?.visibility !== "public" || record.definition.editorialStatus !== "published") continue;
      const entry = adoptedEntry(eventId, record, draftEntries, manifest);
      if (entry) candidates.push(entry);
    } catch { /* Malformed or unbound records are omitted without diagnostics or private metadata. */ }
  }
  const counts = new Map();
  for (const row of candidates) for (const value of [`id:${row.id}`, `contract:${row.contract.toLowerCase()}`, `tx:${row.adoption.txHash.toLowerCase()}`])
    counts.set(value, (counts.get(value) ?? 0) + 1);
  const rows = candidates.filter((row) => [`id:${row.id}`, `contract:${row.contract.toLowerCase()}`, `tx:${row.adoption.txHash.toLowerCase()}`]
    .every((value) => counts.get(value) === 1));
  return structuredClone({ schemaVersion: 1, kind: "public-catalog", mode: "hosted-production", instanceId,
    environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
    chain: { chainId: 1, name: manifest.chain.name, rpcUrl: manifest.chain.rpcUrl,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
    generatedAt: new Date(now).toISOString(),
    catalog: { metadataOnly: true, currentFinancialState: "not-loaded", source: "recorded-adoption" }, events: rows });
}
