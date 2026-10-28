// Explicit new-deployment adapter. Historical events retain v7 dispatch;
// importing this module never deploys a contract or submits a transaction.
import fs from "node:fs";
import { ethers } from "ethers";

export const EVENT_V8_VERSION = "kleros-event-v8";
export const EVENT_V8_CAPACITY = 150;

export function loadV8Artifacts() {
  const load = (name) =>
    JSON.parse(
      fs.readFileSync(
        new URL(`../build/contracts/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  return {
    event: load("KlerosEventV8"),
    factory: load("KlerosEventFactoryV8"),
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
