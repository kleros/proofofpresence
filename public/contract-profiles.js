// Exact known interfaces only. A version prefix never grants financial support.
export const TEST15M_CONTRACT_VERSION = "kleros-event-v8-test15m";
export const PRODUCTION_CONTRACT_VERSION = "kleros-event-v9-uups";
const productionFacts = Object.freeze({
  version: 9,
  financialModel: "v8",
  upgradeable: true,
  testOnly: false,
  verified: true,
  challengeWindowSeconds: 86400,
  matchWindowSeconds: 86400,
});
export function isVerifiedProductionProfile(metadata) {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    Object.entries(productionFacts).every(
      ([key, value]) => metadata[key] === value,
    ) &&
    ["contractVersion", "abiVersion"].every(
      (key) =>
        metadata[key] === undefined ||
        metadata[key] === PRODUCTION_CONTRACT_VERSION,
    ) &&
    (metadata.chainId === undefined || metadata.chainId === 1)
  );
}
export function isVerifiedProductionEvent(event) {
  return (
    event?.contractVersion === PRODUCTION_CONTRACT_VERSION &&
    event.abiVersion === PRODUCTION_CONTRACT_VERSION &&
    event.chainId === 1 &&
    isVerifiedProductionProfile(event.contractProfile)
  );
}
const profiles = Object.freeze({
  [PRODUCTION_CONTRACT_VERSION]: Object.freeze({
    contractVersion: PRODUCTION_CONTRACT_VERSION,
    financialInterface: "v8",
    ...productionFacts,
    chainId: 1,
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
  if (profile.testOnly) {
    if (
      event.abiVersion !== TEST15M_CONTRACT_VERSION ||
      event.chainId !== 10200
    )
      return null;
    // Metadata is optional for older readers; if supplied, every pinned fact must agree.
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
  const profile = Object.hasOwn(profiles, scope?.contractVersion)
    ? profiles[scope.contractVersion]
    : null;
  if (scope?.contractVersion === PRODUCTION_CONTRACT_VERSION) return false;
  return !!profile && (!profile.testOnly || scope.chainId === 10200);
};
