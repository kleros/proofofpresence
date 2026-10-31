// This release enables organizer curation for this one reviewed event only.
// No environment variable or HTTP input can change this production scope.
export const FIRST_EVENT_MANAGE_SCOPE = Object.freeze({
  eventId: "event-3aac5a07-5074-4241-9246-2798d4111039",
  contract: "0xc069A460c5B1c577791Ee61E7F9ADcb7866068df",
  chainId: 1,
  contractVersion: "kleros-event-v10-uups",
});
// Historical public receipts and payer recovery retain their original child.
// This source allowlist never authorizes a new deposit or organizer action.
export const LEGACY_FIRST_EVENT_SCOPES = Object.freeze([Object.freeze({
  eventId: "event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5",
  contract: "0xCd7418413fBFA814D41799C9dFaCc4654f295c11",
  chainId: 1,
  contractVersion: "kleros-event-v10-uups",
})]);
export function checkedFirstEventScope(scope) {
  if (!scope || typeof scope.eventId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(scope.eventId) ||
      typeof scope.contract !== "string" || !/^0x[0-9a-f]{40}$/i.test(scope.contract) || /^0x0{40}$/i.test(scope.contract) ||
      scope.chainId !== 1 || scope.contractVersion !== "kleros-event-v10-uups" ||
      Object.keys(scope).some(key => !["eventId", "contract", "chainId", "contractVersion"].includes(key)))
    throw Object.assign(Error("The reviewed event scope is unavailable."), { code: "FIRST_EVENT_SCOPE", status: 404 });
  return Object.freeze({ eventId: scope.eventId, contract: scope.contract, chainId: 1, contractVersion: scope.contractVersion });
}
export function firstEventDisplayScopes(current = FIRST_EVENT_MANAGE_SCOPE, legacy = LEGACY_FIRST_EVENT_SCOPES) {
  const scopes = [], ids = new Map(), contracts = new Map();
  for (const input of [current, ...legacy]) {
    const scope = checkedFirstEventScope(input), contract = scope.contract.toLowerCase();
    if ((ids.has(scope.eventId) && ids.get(scope.eventId) !== contract) ||
        (contracts.has(contract) && contracts.get(contract) !== scope.eventId))
      throw Object.assign(Error("The reviewed event identity conflicts."), { code: "FIRST_EVENT_SCOPE", status: 404 });
    if (ids.has(scope.eventId)) continue;
    ids.set(scope.eventId, contract); contracts.set(contract, scope.eventId); scopes.push(scope);
  }
  return Object.freeze(scopes);
}
export function firstEventDisplayScopeForQuery(search, scopes = firstEventDisplayScopes()) {
  const params = new URLSearchParams(search), entries = [...params];
  if (!entries.length) return scopes[0];
  if (entries.length !== 1 || entries[0][0] !== "eventId")
    throw Object.assign(Error("Choose exactly one reviewed event."), { code: "INVALID_INPUT", status: 400 });
  const selected = scopes.find(scope => scope.eventId === entries[0][1]);
  if (!selected) throw Object.assign(Error("The reviewed event is unavailable."), { code: "NOT_FOUND", status: 404 });
  return selected;
}
export const firstEventManageMatches = (record, scope = FIRST_EVENT_MANAGE_SCOPE) => {
  // A trusted runtime test dependency can select its actual synthetic deployment.
  // Production callers never receive a scope from request/config/environment data.
  if (typeof scope === "function") return scope(record) === true;
  return !!record && record.definition?.id === scope.eventId && record.deployment?.eventId === scope.eventId &&
    record.deployment.chainId === scope.chainId && record.deployment.contractVersion === scope.contractVersion &&
    typeof record.deployment.contract === "string" && record.deployment.contract.toLowerCase() === scope.contract.toLowerCase();
};
export const isLegacyFirstEvent = (record, current = FIRST_EVENT_MANAGE_SCOPE, legacy = LEGACY_FIRST_EVENT_SCOPES) =>
  !firstEventManageMatches(record, current) && legacy.some(scope => firstEventManageMatches(record, scope));
export function assertFirstEventDepositTarget(record, current = FIRST_EVENT_MANAGE_SCOPE, legacy = LEGACY_FIRST_EVENT_SCOPES) {
  if (isLegacyFirstEvent(record, current, legacy))
    throw Object.assign(Error("This event was replaced. Preserve its original receipts and use its recovery page."), { code: "EVENT_REPLACED", status: 409 });
}
