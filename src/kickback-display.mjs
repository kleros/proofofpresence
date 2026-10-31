// Public setup configuration only. This database row cannot authorize a draft.
import { createHash } from "node:crypto";

const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => value && typeof value === "object"
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  : value;
const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const fail = () => { throw Object.assign(new Error("Kickback setup display is unavailable."), { code: "KICKBACK_DISPLAY_UNAVAILABLE", status: 503 }); };

export function createKickbackDisplay(w, { store, origin }) {
  const snapshot = () => {
    const metadata = copy(w.setupMetadata());
    if (metadata.mode !== "hosted-production" || metadata.chain?.chainId !== 1 ||
      metadata.contractVersion !== "kleros-event-v10-uups" || metadata.factory?.verified !== false ||
      metadata.session !== null || metadata.events?.length !== 0) fail();
    const binding = { kind: "kickback-setup-configuration", origin, mode: metadata.mode,
      chainId: 1, factory: metadata.factory.address, profile: metadata.contractVersion,
      configuration: digest(metadata) };
    return { metadata, binding, scopeKey: digest(binding) };
  };
  let active = snapshot();
  return Object.freeze({
    // Startup and confirmed creation write only source-bound public metadata.
    async initialize() {
      const next = snapshot();
      await store.write(next.scopeKey, next.binding, next.metadata); active = next;
    },
    async read() {
      const { scopeKey, binding } = active;
      const row = await store.read(scopeKey);
      if (!row || digest(row.binding) !== digest(binding) || digest(row.snapshot) !== binding.configuration) fail();
      const result = copy(row.snapshot);
      if (Array.isArray(result.managedEvents)) {
        // A changed public registry can remove a row immediately. This is only
        // visibility filtering; it performs no ownership or financial check.
        const visible = new Set((w.setupMetadata().managedEvents ?? []).map(event => event.id));
        result.managedEvents = result.managedEvents.filter(event => visible.has(event.id));
      }
      return result;
    },
  });
}
