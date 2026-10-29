import {
  PRODUCTION_CONTRACT_VERSION,
  isVerifiedProductionEvent,
  isVerifiedProductionProfile,
} from "./contract-profiles.js";

// Presentation classification never grants transaction authority.
export const SANDBOX_MODES = Object.freeze(["local-demo", "hosted-demo"]);
export const TESTNET_MODES = Object.freeze(["testnet", "hosted-testnet"]);
export const PRODUCTION_MODES = Object.freeze(["hosted-production"]);
export function classifyEnvironment(mode) {
  return typeof mode !== "string"
    ? "unknown"
    : SANDBOX_MODES.includes(mode)
      ? "sandbox"
      : TESTNET_MODES.includes(mode)
        ? "testnet"
        : PRODUCTION_MODES.includes(mode)
          ? "production"
          : "unknown";
}
export const isSandboxMode = (mode) => classifyEnvironment(mode) === "sandbox";
export const isTestnetMode = (mode) => classifyEnvironment(mode) === "testnet";
export const isProductionMode = (mode) => mode === "hosted-production";
export const isPublicMode = (mode) =>
  isTestnetMode(mode) || isProductionMode(mode);
function label(value, length) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result &&
    result.length <= length &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(result)
    ? result
    : null;
}
export const networkLabel = (chain) =>
  label(chain?.name, 120) ?? "Network unavailable";
export const nativeCurrencySymbol = (chain) =>
  label(chain?.nativeCurrency?.symbol, 24) ?? "native token";
const address = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-f]{40}$/i.test(value) &&
  !/^0x0{40}$/i.test(value);
const hash = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-f]{64}$/i.test(value) &&
  !/^0x0{64}$/i.test(value);
const text = (value) => label(value, 2000) !== null;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
function publicRpc(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}
function verifiedUpgrade(upgrade) {
  if (
    !upgrade ||
    upgrade.kind !== "uups" ||
    upgrade.verified !== true ||
    !address(upgrade.implementation) ||
    !hash(upgrade.implementationCodeHash) ||
    upgrade.version !== 9 ||
    !address(upgrade.authority) ||
    !address(upgrade.multisig) ||
    !positiveInteger(upgrade.delaySeconds) ||
    upgrade.delaySeconds < 172800 ||
    !Object.hasOwn(upgrade, "pending")
  )
    return false;
  const pending = upgrade.pending;
  return (
    pending === null ||
    (!!pending &&
      typeof pending === "object" &&
      !Array.isArray(pending) &&
      hash(pending.operationId) &&
      address(pending.newImplementation) &&
      positiveInteger(pending.eligibleAt) &&
      label(pending.status, 120) !== null)
  );
}

// Read-only rendering and known-hash reconciliation do not request transaction readiness.
export function productionContextIssue(
  bootstrap,
  detail = null,
  { requireTransactions = false, requireWallet = false } = {},
) {
  if (!isProductionMode(bootstrap?.mode))
    return "Production requires the explicit hosted-production environment.";
  if (!text(bootstrap.instanceId))
    return "The production server instance is unavailable.";
  const env = bootstrap.environment,
    caps = bootstrap.capabilities,
    chain = bootstrap.chain;
  if (
    env?.production !== true ||
    env.network !== "ethereum-mainnet" ||
    env.chainId !== 1 ||
    chain?.chainId !== 1 ||
    !label(chain.name, 120) ||
    chain.nativeCurrency?.symbol !== "ETH" ||
    chain.nativeCurrency?.decimals !== 18
  )
    return "Verified Ethereum mainnet environment metadata is unavailable.";
  if (!publicRpc(chain.rpcUrl))
    return "A credential-free HTTPS production RPC is required.";
  if (
    bootstrap.contractVersion !== PRODUCTION_CONTRACT_VERSION ||
    (bootstrap.abiVersion !== undefined &&
      bootstrap.abiVersion !== PRODUCTION_CONTRACT_VERSION) ||
    !isVerifiedProductionProfile(bootstrap.contractProfile)
  )
    return "The verified production contract profile is unavailable.";
  if (
    caps?.production !== true ||
    caps.browserWallet !== true ||
    caps.walletTransactions !== true ||
    caps.serverSigning !== false ||
    caps.financialInterface !== "kleros-native-v1" ||
    typeof caps.transactionsReady !== "boolean" ||
    !Array.isArray(caps.supportedAccountTypes) ||
    caps.supportedAccountTypes.length !== 1 ||
    caps.supportedAccountTypes[0] !== "eoa" ||
    [
      "contractWallets",
      "erc1271",
      "eip7702",
      "sharedDemo",
      "reset",
      "timeTravel",
      "mockRulings",
    ].some((key) => caps[key] !== false)
  )
    return "The production capabilities are missing or unsupported.";
  const court = bootstrap.arbitration;
  if (
    court?.mode !== "kleros-v1" ||
    court.verified !== true ||
    !text(court.label) ||
    !text(court.notice) ||
    !address(court.resolver) ||
    !address(court.arbitrator)
  )
    return "Verified production arbitration metadata is unavailable.";
  const support = bootstrap.walletSupport;
  if (
    support?.type !== "eoa-only" ||
    support.eoa !== true ||
    support.erc1271 !== false ||
    support.eip7702 !== false ||
    !text(support.notice)
  )
    return "The supported production wallet types are unavailable.";
  if (detail !== null) {
    const event = detail?.event;
    if (
      !isVerifiedProductionEvent(event) ||
      !text(event.id) ||
      !address(event.contract)
    )
      return "The event does not have the verified production contract profile.";
    for (const key of ["resolver", "arbitrator"])
      if (
        event[key] !== undefined &&
        (!address(event[key]) ||
          event[key].toLowerCase() !== court[key].toLowerCase())
      )
        return "The event arbitration addresses differ from the verified production resolver.";
    if (detail.deploymentTrust?.status !== "verified")
      return "The event deployment is unavailable or has changed. Refresh its verified state.";
    if (!verifiedUpgrade(detail.upgrade))
      return "The event upgrade governance verification is incomplete or unavailable.";
  }
  if (
    requireTransactions &&
    (caps.transactionsReady !== true || detail === null)
  )
    return "Production transactions are not ready for this verified event.";
  if (
    requireWallet &&
    (bootstrap.session?.mode !== "wallet" || !address(bootstrap.session.wallet))
  )
    return "Authenticate a supported wallet before financial review.";
  return null;
}
