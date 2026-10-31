// Presentation only. These helpers never grant financial eligibility or mutate
// state; the server's scoped draft and fresh validation remain authoritative.
const attendanceStandard = Object.freeze({
  attendanceMode: "event-participation",
  attendanceRule: "presence-during-immutable-interval-v1",
  evidenceRule: "balance-of-probabilities-with-case-organizer-confirmation-v1",
});
export function knownAttendanceStandard(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 3 &&
    Object.entries(attendanceStandard).every(
      ([key, expected]) => Object.hasOwn(value, key) && value[key] === expected,
    )
  );
}
export function attendanceStandardText(value) {
  return knownAttendanceStandard(value)
    ? "Attendance means verifiable presence or participation, in person or online, at some point during the immutable event interval. No full-duration minimum applies. Payment, a Luma RSVP or a personal mark alone is not attendance. Organizer confirmation, or otherwise a jury assessment on the balance of probabilities, is required. The actual posted-list challenge deadline controls (24 hours after posting); this does not imply on-chain enforcement of the event end."
    : null;
}
export function lumaReturnUrl(value) {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "luma.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/[a-zA-Z0-9/_-]+$/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export const launchWei = (value) =>
  typeof value === "string" && /^\d+$/.test(value) ? value : null;
export function participantDeposit(detail, wallet) {
  const address = (value) =>
    typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
  const unknown = () =>
    Object.freeze({
      status: "unavailable",
      hash: null,
      amountWei: null,
      blockNumber: null,
    });
  if (
    !address(wallet) ||
    !address(detail?.ownWallet?.wallet) ||
    wallet.toLowerCase() !== detail.ownWallet.wallet.toLowerCase()
  )
    return unknown();
  const receipt = detail.ownWallet.deposit;
  if (
    !receipt ||
    !["none", "submitted", "confirmed", "failed"].includes(receipt.status)
  )
    return unknown();
  if (
    typeof detail.event?.id !== "string" ||
    !detail.event.id ||
    !Number.isSafeInteger(detail.event.chainId) ||
    detail.event.chainId <= 0 ||
    typeof detail.event.abiVersion !== "string" ||
    !detail.event.abiVersion ||
    typeof receipt.eventId !== "string" ||
    !receipt.eventId ||
    !Number.isSafeInteger(receipt.chainId) ||
    receipt.chainId <= 0 ||
    typeof receipt.abiVersion !== "string" ||
    !receipt.abiVersion
  )
    return unknown();
  if (
    !address(receipt.wallet) ||
    receipt.wallet.toLowerCase() !== wallet.toLowerCase() ||
    receipt.eventId !== detail.event?.id ||
    receipt.chainId !== detail.event?.chainId ||
    !address(receipt.contract) ||
    !address(detail.event?.contract) ||
    receipt.contract.toLowerCase() !== detail.event.contract.toLowerCase() ||
    receipt.abiVersion !== detail.event?.abiVersion
  )
    return unknown();
  const hash =
    typeof receipt.hash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(receipt.hash) &&
    !/^0x0{64}$/i.test(receipt.hash)
      ? receipt.hash
      : null;
  const amountWei = launchWei(receipt.amountWei);
  const blockNumber =
    Number.isSafeInteger(receipt.blockNumber) && receipt.blockNumber >= 0
      ? receipt.blockNumber
      : null;
  if (
    (receipt.hash != null && !hash) ||
    (receipt.status === "none" && hash) ||
    (receipt.status === "confirmed" &&
      (!hash ||
        amountWei === null ||
        BigInt(amountWei) <= 0n ||
        blockNumber === null))
  )
    return unknown();
  return Object.freeze({
    status: receipt.status,
    hash,
    amountWei,
    blockNumber,
  });
}
