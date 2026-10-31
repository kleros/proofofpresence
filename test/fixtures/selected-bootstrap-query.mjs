// Test-only request allowlist: preserve the legacy selected read and admit only
// the explicit selected-only opt-in, without accepting actor or unrelated keys.
export function isSelectedBootstrapQuery(query, eventId) {
  if (
    !(query instanceof URLSearchParams) ||
    typeof eventId !== "string" ||
    !eventId ||
    query.getAll("selectedEventId").length !== 1 ||
    query.get("selectedEventId") !== eventId
  )
    return false;
  return (
    query.size === 1 ||
    (query.size === 2 &&
      query.getAll("selectedOnly").length === 1 &&
      query.get("selectedOnly") === "1")
  );
}
