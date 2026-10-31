// @ts-check
import { createHash, randomUUID } from "node:crypto";
import { firstEventManageMatches } from "./first-event-manage-scope.mjs";
export const json = (value) =>
  JSON.stringify(value, (_, x) => (typeof x === "bigint" ? x.toString() : x));
export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || value instanceof Uint8Array
        ? value
        : json(value),
    )
    .digest("hex");
export const id = () => randomUUID();
export const lower = (x) => String(x).toLowerCase();
export function requireThat(ok, message, code = "INVALID_INPUT", status = 400) {
  if (!ok) throw Object.assign(new Error(message), { code, status });
}
export function text(value, max = 200, min = 0) {
  requireThat(
    typeof value === "string" &&
      value.trim().length >= min &&
      value.length <= max,
    "Invalid text field",
  );
  return value.trim();
}
export function email(value) {
  value = text(value, 254, 3).toLowerCase();
  requireThat(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "A valid email is required",
  );
  return value;
}
export function associations(input) {
  const out = {};
  if (Object.hasOwn(input, "lumaEventId")) {
    out.lumaEventId = text(input.lumaEventId ?? "", 100);
    requireThat(
      !out.lumaEventId || /^[a-zA-Z0-9_-]+$/.test(out.lumaEventId),
      "Invalid Luma event identifier",
    );
  }
  if (Object.hasOwn(input, "contentEventId")) {
    out.contentEventId = text(input.contentEventId ?? "", 100);
    requireThat(
      !out.contentEventId || /^[a-zA-Z0-9_-]+$/.test(out.contentEventId),
      "Invalid mapped content event identifier",
    );
  }
  for (const key of ["lumaUrl", "contentUrl"])
    if (Object.hasOwn(input, key)) {
      const value = text(input[key] ?? "", 1000);
      if (!value) {
        out[key] = "";
        continue;
      }
      let u;
      try {
        u = new URL(value);
      } catch {
        requireThat(false, "Use a valid HTTPS association URL");
      }
      requireThat(
        u.protocol === "https:" && !u.username && !u.password,
        "Association links must use HTTPS without credentials",
      );
      if (key === "lumaUrl")
        requireThat(
          u.hostname === "luma.com" &&
            /^\/[a-zA-Z0-9/_-]+$/.test(u.pathname) &&
            !u.search &&
            !u.hash,
          "Use an explicit Luma event URL",
        );
      out[key] = u.href;
    }
  return out;
}
export const csvCell = (value) => {
  let s = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};

// A nonce-authenticated paying wallet is not a verified Luma identity.
// Historical profiles retain their original identity gate.
export function hasVerifiedParticipantWallet(record, person, scope = undefined) {
  if (firstEventManageMatches(record, scope) &&
      person?.eventId === record.definition.id && person?.payerVerified === true &&
      person.identitySource === "owner-reviewed-canonical-payer" && person.deposit?.verified === true &&
      lower(person.deposit.wallet) === lower(person.wallet) && person.deposit.eventId === record.definition.id &&
      lower(person.deposit.contract) === lower(record.deployment.contract)) return true;
  if (["kleros-event-v9-uups", "kleros-event-v10-uups"].includes(record?.deployment?.contractVersion) &&
      record.deployment.chainId === 1)
    return person?.walletVerified === true || person?.identityVerified === true;
  return person?.identityVerified === true;
}
