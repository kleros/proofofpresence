import {
  PRODUCTION_CONTRACT_VERSION,
  isVerifiedProductionEvent,
  isVerifiedProductionProfile,
  V9_TESTNET_CONTRACT_VERSION,
  isVerifiedV9TestnetEvent,
  isVerifiedV9TestnetProfile,
} from "./contract-profiles.js";

// Presentation classification never grants transaction authority.
export const SANDBOX_MODES = Object.freeze(["local-demo", "hosted-demo"]);
export const TESTNET_MODES = Object.freeze(["testnet", "hosted-testnet"]);
export const PRODUCTION_MODES = Object.freeze(["hosted-production"]);
export const V9_TESTNET_MODES = Object.freeze(["hosted-v9-testnet"]);
export function classifyEnvironment(mode) {
  return typeof mode !== "string"
    ? "unknown"
    : SANDBOX_MODES.includes(mode)
      ? "sandbox"
      : TESTNET_MODES.includes(mode)
        ? "testnet"
        : PRODUCTION_MODES.includes(mode)
          ? "production"
          : V9_TESTNET_MODES.includes(mode)
            ? "v9-testnet"
            : "unknown";
}
export const isSandboxMode = (mode) => classifyEnvironment(mode) === "sandbox";
export const isTestnetMode = (mode) => classifyEnvironment(mode) === "testnet";
export const isProductionMode = (mode) => mode === "hosted-production";
export const isV9TestnetMode = (mode) => mode === "hosted-v9-testnet";
export const isPublicMode = (mode) =>
  isTestnetMode(mode) || isProductionMode(mode) || isV9TestnetMode(mode);
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
    upgrade.governanceKind !== "single-owner-timelock" ||
    !address(upgrade.owner) ||
    !Object.hasOwn(upgrade, "pendingOwner") ||
    !(upgrade.pendingOwner === null || address(upgrade.pendingOwner)) ||
    !Number.isSafeInteger(upgrade.pendingOperationCount) ||
    upgrade.pendingOperationCount < 0 ||
    !Number.isSafeInteger(upgrade.executingOperationCount) ||
    upgrade.executingOperationCount < 0 ||
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
const production = Object.freeze({
  mode: "hosted-production",
  chainId: 1,
  network: "ethereum-mainnet",
  symbol: "ETH",
  production: true,
  profile: PRODUCTION_CONTRACT_VERSION,
  arbitration: "kleros-v1",
  verifyProfile: isVerifiedProductionProfile,
  verifyEvent: isVerifiedProductionEvent,
});
const v9Testnet = Object.freeze({
  mode: "hosted-v9-testnet",
  chainId: 10200,
  network: "chiado",
  symbol: "XDAI",
  production: false,
  profile: V9_TESTNET_CONTRACT_VERSION,
  arbitration: "controlled",
  verifyProfile: isVerifiedV9TestnetProfile,
  verifyEvent: isVerifiedV9TestnetEvent,
});
function v9ContextIssue(
  bootstrap,
  detail,
  { requireTransactions = false, requireWallet = false },
  expected,
) {
  if (bootstrap?.mode !== expected.mode)
    return "The explicit verified V9 environment is required.";
  if (!text(bootstrap.instanceId)) return "The server instance is unavailable.";
  const env = bootstrap.environment,
    caps = bootstrap.capabilities,
    chain = bootstrap.chain;
  if (
    env?.production !== expected.production ||
    env.network !== expected.network ||
    env.chainId !== expected.chainId ||
    chain?.chainId !== expected.chainId ||
    !label(chain.name, 120) ||
    chain.nativeCurrency?.symbol !== expected.symbol ||
    chain.nativeCurrency?.decimals !== 18
  )
    return "Verified network environment metadata is unavailable.";
  if (!publicRpc(chain.rpcUrl))
    return "A credential-free HTTPS RPC is required.";
  if (
    bootstrap.contractVersion !== expected.profile ||
    (bootstrap.abiVersion !== undefined &&
      bootstrap.abiVersion !== expected.profile) ||
    !expected.verifyProfile(bootstrap.contractProfile)
  )
    return "The verified V9 contract profile is unavailable.";
  if (
    caps?.production !== expected.production ||
    (expected.production ? caps.v9Testnet === true : caps.v9Testnet !== true) ||
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
    return "The V9 environment capabilities are missing or unsupported.";
  const court = bootstrap.arbitration;
  if (
    court?.mode !== expected.arbitration ||
    court.verified !== true ||
    !text(court.label) ||
    !text(court.notice) ||
    !address(court.resolver) ||
    !address(court.arbitrator)
  )
    return "Verified arbitration metadata is unavailable.";
  const support = bootstrap.walletSupport;
  if (
    support?.type !== "eoa-only" ||
    support.eoa !== true ||
    support.erc1271 !== false ||
    support.eip7702 !== false ||
    !text(support.notice)
  )
    return "The supported wallet types are unavailable.";
  const governance = bootstrap.governance;
  if (
    governance?.kind !== "single-owner-timelock" ||
    !address(governance.initialOwner) ||
    governance.minimumDelaySeconds !== 172800 ||
    ["label", "notice"].some(
      (key) => governance[key] !== undefined && !text(governance[key]),
    )
  )
    return "The verified upgrade governance metadata is unavailable.";
  if (detail !== null) {
    const event = detail?.event;
    if (
      !expected.verifyEvent(event) ||
      !text(event.id) ||
      !address(event.contract)
    )
      return "The event does not have the verified V9 contract profile.";
    for (const key of ["resolver", "arbitrator"])
      if (
        event[key] !== undefined &&
        (!address(event[key]) ||
          event[key].toLowerCase() !== court[key].toLowerCase())
      )
        return "The event arbitration addresses differ from the verified configuration.";
    if (detail.deploymentTrust?.status !== "verified")
      return "The event deployment is unavailable or has changed. Refresh its verified state.";
    if (!verifiedUpgrade(detail.upgrade))
      return "The event upgrade governance verification is incomplete or unavailable.";
  }
  if (
    requireTransactions &&
    (caps.transactionsReady !== true || detail === null)
  )
    return "Transactions are not ready for this verified event.";
  if (
    requireWallet &&
    (bootstrap.session?.mode !== "wallet" || !address(bootstrap.session.wallet))
  )
    return "Authenticate a supported wallet before financial review.";
  return null;
}
export const productionContextIssue = (
  bootstrap,
  detail = null,
  options = {},
) => v9ContextIssue(bootstrap, detail, options, production);
export const v9TestnetContextIssue = (bootstrap, detail = null, options = {}) =>
  v9ContextIssue(bootstrap, detail, options, v9Testnet);

// Shared structural check for the independently verified factory context.
export { verifiedUpgrade as isVerifiedV9Upgrade };
