import { supportsBatchJournalProfile } from "./contract-profiles.js";
const prefix = "kleros.offchain-batch-pending.v1:";
const address = (value) =>
  typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const bounded = (value, max = 150) =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const valid = (condition) => {
  if (!condition)
    throw new Error(
      "The pending batch record could not be verified. Reconcile it before saving another batch.",
    );
};

function scopeOf(scope) {
  valid(
    scope &&
      bounded(scope.eventId) &&
      bounded(scope.instanceId) &&
      address(scope.wallet) &&
      address(scope.contract),
  );
  valid(
    [1337, 10200, 1].includes(scope.chainId) &&
      supportsBatchJournalProfile(scope),
  );
  valid(["approve-admission", "check-in"].includes(scope.action));
  return {
    eventId: scope.eventId,
    instanceId: scope.instanceId,
    wallet: scope.wallet.toLowerCase(),
    chainId: scope.chainId,
    contract: scope.contract.toLowerCase(),
    contractVersion: scope.contractVersion,
    action: scope.action,
    ...(scope.chainId === 1 ? { mode: scope.mode } : {}),
  };
}
function identity(scope) {
  return [
    scope.eventId,
    scope.wallet,
    scope.chainId,
    scope.contract,
    scope.contractVersion,
    scope.action,
    // Chain1337 is a new ephemeral world on every server restart. External
    // Chiado keeps its contract and persisted batch receipts across restarts.
    scope.chainId === 1337 ? scope.instanceId : null,
    // Production off-chain receipts are bound to this exact backend world.
    ...(scope.chainId === 1 ? [scope.mode, scope.instanceId] : []),
  ];
}
function markerOf(marker, current) {
  valid(
    marker?.version === 1 &&
      bounded(marker.id, 100) &&
      bounded(marker.nonce, 64) &&
      marker.nonce.length >= 8,
  );
  const scope = scopeOf(marker.scope);
  valid(JSON.stringify(identity(scope)) === JSON.stringify(identity(current)));
  valid(["submitting", "unknown", "confirmed"].includes(marker.phase));
  valid(
    Array.isArray(marker.items) &&
      marker.items.length > 0 &&
      marker.items.length <= 150 &&
      marker.selectedCount === marker.items.length,
  );
  const items = marker.items.map((item) => {
    valid(
      item &&
        address(item.wallet) &&
        (item.participantId === null || bounded(item.participantId, 100)),
    );
    return {
      participantId: item.participantId,
      wallet: item.wallet.toLowerCase(),
    };
  });
  valid(new Set(items.map((item) => item.wallet)).size === items.length);
  const linked = items.filter((item) => item.participantId !== null);
  valid(
    new Set(linked.map((item) => item.participantId)).size === linked.length,
  );
  return {
    version: 1,
    scope,
    id: marker.id,
    nonce: marker.nonce,
    items,
    selectedCount: items.length,
    phase: marker.phase,
  };
}
const intent = (marker) => JSON.stringify({ ...marker, phase: undefined });

// Optional host adapter for the portable batch component. It stores only
// contactless intent, never cookies, signing material or a successful-outcome
// assertion. Loading a marker always requires authenticated status reconciliation.
export function createBatchPendingJournal(storage, { origin } = {}) {
  const url = new URL(origin);
  valid(
    url.origin === origin &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))),
  );
  valid(
    storage &&
      ["getItem", "setItem", "removeItem"].every(
        (name) => typeof storage[name] === "function",
      ),
  );
  const keyOf = (scope) =>
    prefix + encodeURIComponent(JSON.stringify([origin, ...identity(scope)]));
  function load(currentScope) {
    const current = scopeOf(currentScope);
    const raw = storage.getItem(keyOf(current));
    if (raw === null) return null;
    valid(typeof raw === "string" && raw.length <= 64_000);
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      valid(false);
    }
    valid(saved.version === 1 && saved.origin === origin);
    return markerOf(saved.marker, current);
  }
  function save(currentScope, candidate) {
    const current = scopeOf(currentScope),
      marker = markerOf(candidate, current);
    const previous = load(currentScope);
    valid(!previous || intent(previous) === intent(marker));
    const serialized = JSON.stringify({ version: 1, origin, marker });
    valid(serialized.length <= 64_000);
    const key = keyOf(current);
    storage.setItem(key, serialized);
    valid(storage.getItem(key) === serialized);
  }
  function remove(currentScope, id) {
    const current = scopeOf(currentScope),
      previous = load(currentScope);
    if (!previous || previous.id !== id) return false;
    storage.removeItem(keyOf(current));
    valid(storage.getItem(keyOf(current)) === null);
    return true;
  }
  return { load, save, remove };
}
