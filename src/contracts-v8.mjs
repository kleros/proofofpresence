// Explicit new-deployment adapter. Historical events retain v7 dispatch;
// importing this module never deploys a contract or submits a transaction.
import fs from "node:fs";
import { ethers } from "ethers";

export const EVENT_V8_VERSION = "kleros-event-v8";
export const EVENT_V8_TEST15M_VERSION = "kleros-event-v8-test15m";
export const EVENT_V9_VERSION = "kleros-event-v9-uups";
export const EVENT_V8_CAPACITY = 150;

const profiles = Object.freeze({
  [EVENT_V9_VERSION]: Object.freeze({
    contractVersion: EVENT_V9_VERSION,
    abiVersion: EVENT_V9_VERSION,
    contractName: "KlerosEventV9",
    factoryName: "KlerosEventFactoryV9",
    artifactDirectory: "contracts-v9",
    sourceDirectory: "contracts/v9",
    version: 9,
    financialModel: "v8",
    upgradeable: true,
    challengeWindowSeconds: 86400,
    matchWindowSeconds: 86400,
    chainId: 1,
    testOnly: false,
  }),
  [EVENT_V8_VERSION]: Object.freeze({
    contractVersion: EVENT_V8_VERSION,
    contractName: "KlerosEventV8",
    factoryName: "KlerosEventFactoryV8",
    artifactDirectory: "contracts",
    sourceDirectory: "contracts",
    version: 8,
    challengeWindowSeconds: 86400,
    matchWindowSeconds: 86400,
    chainId: null,
    testOnly: false,
  }),
  [EVENT_V8_TEST15M_VERSION]: Object.freeze({
    contractVersion: EVENT_V8_TEST15M_VERSION,
    contractName: "KlerosEventV8Test15m",
    factoryName: "KlerosEventFactoryV8Test15m",
    artifactDirectory: "contracts-test15m",
    sourceDirectory: "contracts/test",
    version: 80015,
    challengeWindowSeconds: 900,
    matchWindowSeconds: 900,
    chainId: 10200,
    testOnly: true,
  }),
});

/** Exact known profiles only. Unknown names must never inherit financial behavior. */
export function eventV8Profile(version) {
  return typeof version === "string" && Object.hasOwn(profiles, version)
    ? profiles[version]
    : null;
}
export const isV8Version = (version) => eventV8Profile(version) !== null;

export function loadV8Artifacts(version = EVENT_V8_VERSION) {
  const profile = eventV8Profile(version);
  if (!profile) throw new Error("Unsupported v8 contract profile");
  const load = (name) =>
    JSON.parse(
      fs.readFileSync(
        new URL(
          `../build/${profile.artifactDirectory}/${name}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  return {
    event: load(profile.contractName),
    factory: load(profile.factoryName),
  };
}

export function factoryEventId({ chainId, factory, creator, eventKey }) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "bytes32"],
      [
        chainId,
        ethers.getAddress(factory),
        ethers.getAddress(creator),
        eventKey,
      ],
    ),
  );
}

/** Build event-specific ERC-1497 text with contract-filled organizer snapshots.
 * A separate immutable v8 policy must explain the v8 admission/refund rules.
 */
export function eventV8Template({
  eventName,
  depositAmount,
  policyURI,
  nativeCurrencySymbol = "ETH",
}) {
  if (
    typeof eventName !== "string" ||
    !eventName.trim() ||
    !policyURI ||
    BigInt(depositAmount) <= 0n ||
    !/^[A-Za-z][A-Za-z0-9]{1,11}$/.test(nativeCurrencySymbol)
  )
    throw new Error("Missing v8 event metadata");
  for (const text of [eventName, policyURI]) {
    if (/\{\{[^}]*\}\}/.test(text))
      throw new Error("Metadata cannot contain runtime template markers");
  }
  const document = {
    category: "Event attendance",
    title: `Did wallet {{wallet}} attend ${eventName}?`,
    description: `This case concerns the registered depositor {{wallet}} at ${eventName}. The event contract is {{contract}}, the native ${nativeCurrencySymbol} deposit is ${ethers.formatEther(depositAmount)} ${nativeCurrencySymbol}. The authoritative organizer for THIS case is {{organizer}}, recorded by caseOrganizer(wallet) when the challenge opened. Ownership rotation affects future challenges; it cannot change this case's organizer identity or description. Evidence from the named organizer is their statement. Apply the immutable attached policy.`,
    question: `Did the person registered with {{wallet}} attend ${eventName}?`,
    rulingOptions: {
      type: "single-select",
      titles: ["Attended", "Did not attend"],
      descriptions: [
        "Attended under the attached policy.",
        "Absent or attendance not proven under the attached policy.",
      ],
    },
    fileURI: policyURI,
    aliases: {
      "{{wallet}}": "Challenger",
      "{{walletLower}}": "Challenger",
      "{{organizer}}": "Organizer for this case",
      "{{organizerLower}}": "Organizer for this case",
    },
  };
  const raw = JSON.stringify(document);
  const kinds = {
    wallet: 1,
    contract: 2,
    walletLower: 3,
    organizer: 4,
    organizerLower: 5,
  };
  const pieces = [];
  const slots = [];
  let cursor = 0;
  for (const match of raw.matchAll(
    /\{\{(wallet|contract|walletLower|organizer|organizerLower)\}\}/g,
  )) {
    pieces.push(raw.slice(cursor, match.index));
    slots.push(kinds[match[1]]);
    cursor = match.index + match[0].length;
  }
  pieces.push(raw.slice(cursor));
  return { pieces, slots: ethers.hexlify(Uint8Array.from(slots)) };
}
