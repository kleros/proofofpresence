// Exact known interfaces only. A version prefix never grants financial support.
export const TEST15M_CONTRACT_VERSION = "kleros-event-v8-test15m";
export const PRODUCTION_CONTRACT_VERSION = "kleros-event-v9-uups";
export const V10_PRODUCTION_CONTRACT_VERSION = "kleros-event-v10-uups";
export const V9_TESTNET_CONTRACT_VERSION = "kleros-event-v9-uups-chiado";
const v9Facts = Object.freeze({
  version: 9,
  financialModel: "v8",
  upgradeable: true,
  verified: true,
  challengeWindowSeconds: 86400,
  matchWindowSeconds: 86400,
});
function verifiedProfile(metadata, version, chainId, testOnly) {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    Object.entries(v9Facts).every(([key, value]) => metadata[key] === value) &&
    metadata.testOnly === testOnly &&
    ["contractVersion", "abiVersion"].every(
      (key) => metadata[key] === undefined || metadata[key] === version,
    ) &&
    (metadata.chainId === undefined || metadata.chainId === chainId)
  );
}
export const isVerifiedProductionProfile = (metadata) =>
  verifiedProfile(metadata, PRODUCTION_CONTRACT_VERSION, 1, false);
export const isVerifiedV9TestnetProfile = (metadata) =>
  verifiedProfile(metadata, V9_TESTNET_CONTRACT_VERSION, 10200, true);
export const isVerifiedProductionEvent = (event) =>
  event?.contractVersion === PRODUCTION_CONTRACT_VERSION &&
  event.abiVersion === PRODUCTION_CONTRACT_VERSION &&
  event.chainId === 1 &&
  isVerifiedProductionProfile(event.contractProfile);
export const isVerifiedV9TestnetEvent = (event) =>
  event?.contractVersion === V9_TESTNET_CONTRACT_VERSION &&
  event.abiVersion === V9_TESTNET_CONTRACT_VERSION &&
  event.chainId === 10200 &&
  isVerifiedV9TestnetProfile(event.contractProfile);
// V10 production is an explicit family. Existing V9 predicates above retain
// their historical compatibility rules; these stricter facts cannot relabel V9.
const v10Facts = Object.freeze({
  version: 10,
  financialModel: "v8",
  upgradeable: true,
  verified: true,
  challengeWindowSeconds: 86400,
  matchWindowSeconds: 86400,
});
export const isVerifiedV10ProductionProfile = (metadata) =>
  !!metadata &&
  typeof metadata === "object" &&
  !Array.isArray(metadata) &&
  Object.entries(v10Facts).every(([key, value]) => metadata[key] === value) &&
  metadata.contractVersion === V10_PRODUCTION_CONTRACT_VERSION &&
  metadata.abiVersion === V10_PRODUCTION_CONTRACT_VERSION &&
  metadata.testOnly === false &&
  metadata.chainId === 1;
export const isVerifiedV10ProductionEvent = (event) =>
  event?.contractVersion === V10_PRODUCTION_CONTRACT_VERSION &&
  event.abiVersion === V10_PRODUCTION_CONTRACT_VERSION &&
  event.chainId === 1 &&
  isVerifiedV10ProductionProfile(event.contractProfile);
export const isSupportedProductionVersion = (version) =>
  version === PRODUCTION_CONTRACT_VERSION ||
  version === V10_PRODUCTION_CONTRACT_VERSION;
export const isVerifiedSupportedProductionProfile = (
  metadata,
  explicitVersion,
) =>
  explicitVersion === PRODUCTION_CONTRACT_VERSION
    ? isVerifiedProductionProfile(metadata)
    : explicitVersion === V10_PRODUCTION_CONTRACT_VERSION
      ? isVerifiedV10ProductionProfile(metadata)
      : false;
export const isVerifiedSupportedProductionEvent = (event) =>
  event?.contractVersion === PRODUCTION_CONTRACT_VERSION
    ? isVerifiedProductionEvent(event)
    : event?.contractVersion === V10_PRODUCTION_CONTRACT_VERSION
      ? isVerifiedV10ProductionEvent(event)
      : false;
const profiles = Object.freeze({
  [PRODUCTION_CONTRACT_VERSION]: Object.freeze({
    contractVersion: PRODUCTION_CONTRACT_VERSION,
    financialInterface: "v8",
    ...v9Facts,
    testOnly: false,
    chainId: 1,
  }),
  [V9_TESTNET_CONTRACT_VERSION]: Object.freeze({
    contractVersion: V9_TESTNET_CONTRACT_VERSION,
    financialInterface: "v8",
    ...v9Facts,
    testOnly: true,
    chainId: 10200,
  }),
  "truth-pays-v7": Object.freeze({
    contractVersion: "truth-pays-v7",
    financialInterface: "v7",
    testOnly: false,
  }),
  "kleros-event-v8": Object.freeze({
    contractVersion: "kleros-event-v8",
    financialInterface: "v8",
    testOnly: false,
  }),
  [TEST15M_CONTRACT_VERSION]: Object.freeze({
    contractVersion: TEST15M_CONTRACT_VERSION,
    financialInterface: "v8",
    version: 80015,
    challengeWindowSeconds: 900,
    matchWindowSeconds: 900,
    chainId: 10200,
    testOnly: true,
  }),
});
export const isTest15mVersion = (version) =>
  version === TEST15M_CONTRACT_VERSION;
export function contractProfileForEvent(event) {
  const profile = Object.hasOwn(profiles, event?.contractVersion)
    ? profiles[event.contractVersion]
    : null;
  if (!profile) return null;
  if (
    event.contractVersion === PRODUCTION_CONTRACT_VERSION &&
    !isVerifiedProductionEvent(event)
  )
    return null;
  if (
    event.contractVersion === V9_TESTNET_CONTRACT_VERSION &&
    !isVerifiedV9TestnetEvent(event)
  )
    return null;
  // Only the historical fast profile uses its 900-second compatibility rules.
  if (isTest15mVersion(event.contractVersion)) {
    if (
      event.abiVersion !== TEST15M_CONTRACT_VERSION ||
      event.chainId !== 10200
    )
      return null;
    if (
      event.contractProfile &&
      [
        "contractVersion",
        "version",
        "challengeWindowSeconds",
        "matchWindowSeconds",
        "chainId",
        "testOnly",
      ].some((field) => event.contractProfile[field] !== profile[field])
    )
      return null;
  }
  return profile;
}
export const hasV8FinancialInterface = (event) =>
  contractProfileForEvent(event)?.financialInterface === "v8";
export const supportsBatchJournalProfile = (scope) => {
  if (scope?.chainId === 1)
    return (
      scope.contractVersion === PRODUCTION_CONTRACT_VERSION &&
      scope.mode === "hosted-production"
    );
  if (
    scope?.mode === "hosted-v9-testnet" ||
    scope?.contractVersion === V9_TESTNET_CONTRACT_VERSION
  )
    return (
      scope.contractVersion === V9_TESTNET_CONTRACT_VERSION &&
      scope.chainId === 10200 &&
      scope.mode === "hosted-v9-testnet"
    );
  if (scope?.contractVersion === PRODUCTION_CONTRACT_VERSION) return false;
  const profile = Object.hasOwn(profiles, scope?.contractVersion)
    ? profiles[scope.contractVersion]
    : null;
  return !!profile && (!profile.testOnly || scope.chainId === 10200);
};
