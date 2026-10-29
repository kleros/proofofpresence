// Explicit, read-only controlled Chiado V9 alias. The shared proxy engine retains
// its sealed network policy; this adapter never substitutes Ethereum chain IDs.
import { ethers } from "ethers";
import { hash, lower, requireThat } from "./utils.mjs";
import {
  V9_CHIADO_SCOPE,
  loadUpgradeableArtifacts,
  verifyV9Deployment,
} from "./upgrade-verification.mjs";
import { verifyV9ArtifactSources } from "./upgrade-artifacts.mjs";
import {
  verifyControlledV9Artifacts,
  verifyV9TestnetCourt,
} from "./v9-testnet-runtime.mjs";

export const V9_TESTNET_VERSION = "kleros-event-v9-uups-chiado";
const EXTRA_DATA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"], [0, 3],
);
const same = (a, b) => lower(a) === lower(b);
const check = (ok, message, code = "V9_TESTNET_TRUST_MISMATCH") =>
  requireThat(ok, message, code, 409);

/** Full source/proxy/governance verification plus reviewed controlled-Court pins.
 * No caller-supplied scope, mainnet impersonation, signer, deployment or write API.
 * The runtime validates the complete manifest before constructing this context.
 */
export async function verifyV9TestnetDeployment(chain, deployment, options = {}) {
  check(options && typeof options === "object" && !Array.isArray(options) &&
    Object.keys(options).every((key) => key === "artifacts"),
  "Only reviewed artifact injection is supported", "INVALID_INPUT");
  check(chain?.chainId === 10200 && chain.testnet === true && chain.production === false &&
    deployment?.chainId === 10200 && deployment.contractVersion === V9_TESTNET_VERSION &&
    deployment.abiVersion === V9_TESTNET_VERSION &&
    V9_CHIADO_SCOPE.chainId === 10200 && V9_CHIADO_SCOPE.profile === V9_TESTNET_VERSION,
  "Explicit Chiado10200 V9 testnet context and ABI are required", "WRONG_CHAIN_OR_PROFILE");
  const manifest = chain.manifest, governance = chain.governance, arbitration = chain.arbitration;
  check(manifest?.environment === "testnet" && manifest.chain?.chainId === 10200 &&
    Array.isArray(manifest.events) && manifest.events.some((record) =>
      record?.definition?.id === deployment.eventId && hash(record.deployment) === hash(deployment)),
  "Deployment is not the exact event in the reviewed Chiado manifest", "INVALID_MANIFEST");
  check(governance?.kind === "single-owner-timelock" &&
    ethers.isAddress(governance.initialOwner) &&
    same(governance.initialOwner, deployment.initialUpgradeOwner) &&
    Number.isSafeInteger(governance.minimumDelaySeconds) && governance.minimumDelaySeconds >= 172800 &&
    !Object.hasOwn(governance, "multisig") && !Object.hasOwn(deployment, "projectMultisig") &&
    hash(governance) === hash(manifest.governance),
  "Historical single-owner timelock governance is required", "INVALID_GOVERNANCE");
  check(arbitration?.mode === "controlled" &&
    same(arbitration.resolver, deployment.resolver) &&
    same(arbitration.arbitrator, deployment.arbitrator) &&
    deployment.arbitratorExtraData === EXTRA_DATA &&
    hash(arbitration) === hash(manifest.arbitration),
  "Exact controlled Court context is required", "WRONG_ARBITRATION");

  // Authenticate the complete saved build independently of caller flags. The
  // sealed common engine also binds the supplied ABI/runtime/layout metadata.
  verifyV9ArtifactSources(manifest.provenance);
  const canonicalArtifacts = loadUpgradeableArtifacts();
  const artifacts = options.artifacts ?? canonicalArtifacts;
  check(artifacts && typeof artifacts === "object" &&
    Object.keys(artifacts).sort().join() === "event,factory,proxy,timelock" &&
    Object.keys(canonicalArtifacts).every((key) => artifacts[key] &&
      hash(artifacts[key]) === hash(canonicalArtifacts[key])),
  "Supplied V9 ABI, runtime or storage metadata differs from the source-bound build", "V9_ARTIFACT_PROVENANCE");
  const controlled = verifyControlledV9Artifacts(manifest.controlledProvenance);
  const court = await verifyV9TestnetCourt(chain, controlled);
  check(court.status === "verified-controlled" && court.chainId === 10200 &&
    same(court.resolver.address, arbitration.resolver) &&
    same(court.resolver.codeHash, arbitration.resolverCodeHash) &&
    same(court.arbitrator.address, arbitration.arbitrator) &&
    same(court.arbitrator.codeHash, arbitration.arbitratorCodeHash),
  "Controlled Court verification did not prove the selected context", "WRONG_ARBITRATION");
  const result = await verifyV9Deployment(chain, deployment, V9_CHIADO_SCOPE, { artifacts });
  check(result?.anchor && Number.isSafeInteger(result.anchor.number) && result.anchor.number >= court.block.number &&
    ethers.isHexString(result.anchor.hash, 32),
  "Proxy and Court verification anchors are inconsistent", "DEPLOYMENT_REORG");
  const { provider } = chain;
  const [courtBlock, proxyBlock, resolverCode, arbitratorCode] = await Promise.all([
    provider.getBlock(court.block.number), provider.getBlock(result.anchor.number),
    provider.getCode(arbitration.resolver, result.anchor.number),
    provider.getCode(arbitration.arbitrator, result.anchor.number),
  ]);
  check(courtBlock && same(courtBlock.hash, court.block.hash) &&
    proxyBlock && same(proxyBlock.hash, result.anchor.hash),
  "Controlled Court or proxy verification block reorganized", "DEPLOYMENT_REORG");
  check(resolverCode !== "0x" && arbitratorCode !== "0x" &&
    same(ethers.keccak256(resolverCode), arbitration.resolverCodeHash) &&
    same(ethers.keccak256(arbitratorCode), arbitration.arbitratorCodeHash),
  "Controlled Court runtime changed during proxy verification", "WRONG_ARBITRATION");
  check(BigInt(await provider.send("eth_chainId", [])) === 10200n,
    "RPC chain changed during Chiado verification", "WRONG_CHAIN");
  const finalBlock = await provider.getBlock(result.anchor.number);
  check(finalBlock && same(finalBlock.hash, result.anchor.hash),
    "Proxy verification block is no longer canonical", "DEPLOYMENT_REORG");
  // Preserve stable shared-engine financial metadata. Court fee/head snapshots
  // belong to runtime reads and must not make every draft stale on a new block.
  return result;
}
