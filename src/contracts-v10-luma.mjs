// Explicit V10 metadata. The historical V9 template is never changed.
import { ethers } from "ethers";
import { eventV9LumaTemplate, V9_LUMA_ATTENDANCE_STANDARD } from "./contracts-v9-luma.mjs";

export const V10_LUMA_ATTENDANCE_STANDARD = Object.freeze({ ...V9_LUMA_ATTENDANCE_STANDARD });
export const V10_LUMA_PROFILE = "kleros-event-v10-uups";

/** Reuse the reviewed attendance input validation, then bind separate V10 governance metadata. */
export function eventV10LumaTemplate(input) {
  const base = eventV9LumaTemplate(input);
  const marker = { 1: "wallet", 2: "contract", 3: "walletLower", 4: "organizer", 5: "organizerLower" };
  const kinds = { wallet: 1, contract: 2, walletLower: 3, organizer: 4, organizerLower: 5 };
  const baseSlots = ethers.getBytes(base.slots);
  let serialized = base.pieces[0];
  for (let i = 0; i < baseSlots.length; i++) {
    if (!marker[baseSlots[i]]) throw Error("Unsupported V10 template identity slot");
    serialized += "{{" + marker[baseSlots[i]] + "}}" + base.pieces[i + 1];
  }
  const document = JSON.parse(serialized);
  document.contractProfile = { contractVersion: V10_LUMA_PROFILE, version: 10 };
  document.upgradeGovernance = {
    kind: "single-owner-immediate", delaySeconds: 0,
    notice: "The upgrade controller owner can change implementation logic immediately until upgrade authority is renounced. Verify the actual controller and reviewed current implementations; renunciation alone cannot establish that arbitrary prior code was safe.",
  };
  const raw = JSON.stringify(document), pieces = [], slots = [];
  let cursor = 0;
  for (const match of raw.matchAll(/\{\{(wallet|contract|walletLower|organizer|organizerLower)\}\}/g)) {
    pieces.push(raw.slice(cursor, match.index)); slots.push(kinds[match[1]]);
    cursor = match.index + match[0].length;
  }
  pieces.push(raw.slice(cursor));
  const encodedSlots = ethers.hexlify(Uint8Array.from(slots));
  if (slots.length > 32 || ![1, 2, 4].every(slot => slots.includes(slot)) ||
    ethers.getBytes(ethers.AbiCoder.defaultAbiCoder().encode(["string[]", "bytes"], [pieces, encodedSlots])).length > 12288)
    throw Error("V10 metadata exceeds the reviewed identity/template limits");
  return { pieces, slots: encodedSlots };
}
