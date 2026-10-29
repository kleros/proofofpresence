// Selection state only. Fresh server preview and atomic commit remain the sole action authority.
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function nonempty(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim())
    throw new TypeError(
      `${label} must be a nonempty string without surrounding whitespace.`,
    );
  return value;
}
function candidateList(value) {
  if (!Array.isArray(value))
    throw new TypeError("Batch candidates must be an array.");
  const records = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new TypeError("Each batch candidate must be an object.");
    const key = nonempty(item.key, "Candidate key");
    if (records.has(key))
      throw new TypeError(`Duplicate candidate key: ${key}`);
    if (typeof item.eligible !== "boolean")
      throw new TypeError(
        `Candidate ${key} requires an explicit eligible boolean.`,
      );
    for (const field of ["wallet", "label", "blockedReason"])
      if (item[field] != null && typeof item[field] !== "string")
        throw new TypeError(`Candidate ${key} has an invalid ${field}.`);
    records.set(
      key,
      Object.freeze({
        key,
        wallet: item.wallet ?? "",
        label: item.label ?? key,
        eligible: item.eligible,
        blockedReason: item.eligible
          ? null
          : item.blockedReason?.trim() ||
            "This candidate is not eligible for this batch.",
      }),
    );
  }
  return records;
}
function visibility(value) {
  if (value == null) return new Set();
  if (!Array.isArray(value) && !(value instanceof Set))
    throw new TypeError(
      "visibleKeys must be an array or Set of explicit candidate keys.",
    );
  return new Set(
    [...value].map((key) => nonempty(key, "Visible candidate key")),
  );
}
function revisionValue(value) {
  if (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  throw new TypeError(
    "Batch revision must be a string, finite number or null.",
  );
}

/**
 * One controller belongs to one fixed kind and event/account/server scope key.
 * canReview/canApply are local selection hints, never server preview or commit authority.
 * An omitted visibleKeys means no rows are visible; new candidates are never auto-selected.
 */
export function createBatchSelection({
  kind,
  scopeKey,
  isCurrent,
  onChange,
} = {}) {
  nonempty(kind, "Batch kind");
  nonempty(scopeKey, "Batch scope key");
  if (typeof isCurrent !== "function")
    throw new TypeError("A current-scope guard is required.");
  if (onChange != null && typeof onChange !== "function")
    throw new TypeError("onChange must be a function.");
  const context = Object.freeze({ kind, scopeKey });
  let active = true,
    inactiveReason = null,
    revision = null,
    error = null;
  let candidates = new Map(),
    visibleKeys = new Set(),
    selectedKeys = new Set(),
    selectedRecords = new Map();
  let notified = "";

  function build() {
    const records = [];
    for (const [key, candidate] of candidates)
      records.push(row(candidate, selectedKeys.has(key), false));
    for (const key of selectedKeys)
      if (!candidates.has(key))
        records.push(row(selectedRecords.get(key), true, true));
    const allRows = Object.freeze(records);
    const byKey = new Map(records.map((item) => [item.key, item]));
    const selected = Object.freeze(
      [...selectedKeys].map((key) => byKey.get(key)),
    );
    const blocked = Object.freeze(selected.filter((item) => !item.eligible));
    const visible = records.filter((item) => item.visible);
    const visibleEligible = visible.filter((item) => item.eligible);
    const visibleEligibleSelectedCount = visibleEligible.filter(
      (item) => item.selected,
    ).length;
    return Object.freeze({
      kind,
      scopeKey,
      scope: scopeKey,
      revision,
      active,
      inactiveReason,
      error,
      allRows,
      selected,
      blocked,
      selectedKeys: Object.freeze([...selectedKeys]),
      selectedCount: selected.length,
      blockedCount: blocked.length,
      visibleCount: visible.length,
      visibleEligibleCount: visibleEligible.length,
      visibleSelectedCount: visible.filter((item) => item.selected).length,
      visibleEligibleSelectedCount,
      hiddenCount: selected.filter((item) => !item.visible).length,
      allVisibleEligibleSelected:
        visibleEligible.length > 0 &&
        visibleEligibleSelectedCount === visibleEligible.length,
      canReview: active && !error && selected.length > 0,
      canApply: active && !error && selected.length > 0 && blocked.length === 0,
    });
  }
  function row(candidate, selected, missing) {
    const invalid = !!error;
    return Object.freeze({
      key: candidate.key,
      wallet: candidate.wallet,
      label: candidate.label,
      eligible: !missing && !invalid && candidate.eligible === true,
      blockedReason: missing
        ? "This candidate is missing from the current source. Refresh before applying this batch."
        : invalid
          ? error
          : candidate.blockedReason,
      selected,
      visible: !missing && visibleKeys.has(candidate.key),
      missing,
      invalid,
    });
  }
  function changed() {
    const value = build();
    const fingerprint = JSON.stringify(value);
    if (fingerprint !== notified) {
      notified = fingerprint;
      onChange?.(value);
    }
    return value;
  }
  function deactivate(reason) {
    if (active) {
      active = false;
      inactiveReason = reason;
      revision = null;
      error = null;
      candidates.clear();
      visibleKeys.clear();
      selectedKeys.clear();
      selectedRecords.clear();
      return changed();
    }
    return build();
  }
  function current() {
    if (!active) return false;
    let valid = false;
    try {
      valid = isCurrent(context) === true;
    } catch {
      /* A failed scope guard clears the selection. */
    }
    if (!valid) deactivate("scope-changed");
    return valid;
  }
  function snapshot() {
    current();
    return build();
  }
  function update(value, options = {}) {
    if (!current()) return build();
    let nextCandidates, nextVisible, nextRevision;
    try {
      if (!options || typeof options !== "object" || Array.isArray(options))
        throw new TypeError("Batch update options must be an object.");
      nextCandidates = candidateList(value);
      nextVisible = visibility(options.visibleKeys);
      nextRevision =
        own(options, "revision") && options.revision !== undefined
          ? revisionValue(options.revision)
          : revision;
    } catch (failure) {
      error = `Candidate data could not be validated: ${failure.message}`;
      changed();
      throw failure;
    }
    // Parse and validate everything before changing the accepted candidate set.
    candidates = nextCandidates;
    visibleKeys = new Set(
      [...nextVisible].filter((key) => candidates.has(key)),
    );
    revision = nextRevision;
    error = null;
    for (const key of selectedKeys)
      if (candidates.has(key)) selectedRecords.set(key, candidates.get(key));
    return changed();
  }
  function toggle(key, checked) {
    if (!current()) return build();
    nonempty(key, "Candidate key");
    if (typeof checked !== "boolean")
      throw new TypeError("checked must be a boolean.");
    if (!checked) {
      selectedKeys.delete(key);
      selectedRecords.delete(key);
    } else if (!error && candidates.get(key)?.eligible === true) {
      selectedKeys.add(key);
      selectedRecords.set(key, candidates.get(key));
    }
    return changed();
  }
  function toggleVisible(checked) {
    if (!current()) return build();
    if (typeof checked !== "boolean")
      throw new TypeError("checked must be a boolean.");
    for (const key of visibleKeys) {
      const candidate = candidates.get(key);
      if (!checked) {
        selectedKeys.delete(key);
        selectedRecords.delete(key);
      } else if (!error && candidate?.eligible === true) {
        selectedKeys.add(key);
        selectedRecords.set(key, candidate);
      }
    }
    return changed();
  }
  function clear() {
    if (!current()) return build();
    selectedKeys.clear();
    selectedRecords.clear();
    return changed();
  }
  function dispose() {
    return deactivate("disposed");
  }
  notified = JSON.stringify(build());
  return Object.freeze({
    update,
    toggle,
    toggleVisible,
    clear,
    snapshot,
    dispose,
  });
}
