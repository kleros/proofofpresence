// Fixed diagnostic categories only. Never return provider messages, URLs,
// request bodies, revert text or nested causes across the public boundary.
const outcome = code => Object.freeze({ code, status: code === "INSUFFICIENT_ETH" ? 422 : code === "DEPOSIT_SIMULATION_REVERTED" ? 409 : 503 });
const insufficient = outcome("INSUFFICIENT_ETH"), reverted = outcome("DEPOSIT_SIMULATION_REVERTED"),
  unavailable = outcome("DEPOSIT_SIMULATION_UNAVAILABLE"), invalid = outcome("DEPOSIT_SIMULATION_INVALID_REPLY");
const own = (value, key) => {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined; }
  catch { return undefined; }
};
const quantity = value => typeof value === "string" && value.length <= 66 && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
const revertBytes = value => typeof value === "string" && value.length <= 16386 && /^0x(?:[0-9a-f]{2})*$/i.test(value);
function classified(error) {
  const errors = [error];
  // Bounded known ethers/JSON-RPC wrappers. Accessors and arbitrary JSON text
  // are never evaluated, and "missing revert data" is not evidence of a revert.
  for (let index = 0; index < errors.length && index < 8; index++) {
    for (const key of ["error", "info", "cause"]) {
      const nested = own(errors[index], key);
      if (nested && typeof nested === "object" && !errors.includes(nested) && errors.length < 8) errors.push(nested);
    }
  }
  if (errors.some(value => ["TIMEOUT", "NETWORK_ERROR", "SERVER_ERROR", -32005, -32002, 429, 503].includes(own(value, "code")))) return unavailable;
  if (errors.some(value => own(value, "code") === "BAD_DATA")) return invalid;
  if (errors.some(value => ["CALL_EXCEPTION", 3].includes(own(value, "code")) && revertBytes(own(value, "data")))) return reverted;
  return unavailable;
}

/** A read-only simulation result. The caller MUST finish the original canonical
 * block/chain proof before exposing any diagnostic or permitting a transaction.
 * Success adds no RPC. Only a thrown simulation error reads one payer balance.
 */
export async function directDepositSimulation(provider, transaction, blockTag) {
  const amount = BigInt(transaction.value);
  let result;
  try {
    result = await provider.send("eth_call", [{ to: transaction.to, from: transaction.from,
      data: transaction.data, value: "0x" + amount.toString(16) }, blockTag]);
  } catch (error) {
    try {
      const balance = await provider.send("eth_getBalance", [transaction.from, blockTag]);
      if (quantity(balance) && BigInt(balance) < amount) return insufficient;
    } catch { /* An unavailable balance must never invent a funding diagnosis. */ }
    return classified(error);
  }
  // deposit() returns nothing. Any nonempty, missing or malformed response is
  // unverified, even if a provider did not throw an RPC error.
  return result === "0x" ? null : invalid;
}
