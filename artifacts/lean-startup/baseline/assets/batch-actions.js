import { V9_TESTNET_CONTRACT_VERSION } from "./contract-profiles.js";
import { createBatchSelection } from "./batch-selection.js";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const text = (value) => String(value ?? "");
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();
const authError = (error) =>
  [401, 403].includes(Number(error?.status)) ||
  ["FORBIDDEN", "UNAUTHORIZED", "AUTH_REQUIRED", "OWNER_REQUIRED"].includes(
    error?.code,
  );
const walletPattern = /^0x[0-9a-fA-F]{40}$/;
let mounts = 0;
// Same-page remount protection; no names, emails, browser storage or automatic retry.
const pendingRegistry = new Map();
function frozen(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
async function defaultRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw Object.assign(new Error(`The server returned ${response.status}.`), {
      status: response.status,
    });
  }
  if (!response.ok)
    throw Object.assign(
      new Error(result.error ?? `Request failed (${response.status}).`),
      { status: response.status, code: result.code },
    );
  return result;
}
const fail = (message) => {
  throw new Error(message);
};

/** Scoped, off-chain batch intent. Server preview/atomic commit is the sole action authority. */
export function mountBatchActions(host, options) {
  if (!host || typeof host.replaceChildren !== "function")
    throw new Error("A batch toolbar host is required.");
  if (options?.canManage !== true) {
    host.replaceChildren();
    return {
      update: () => null,
      dispose() {
        host.replaceChildren();
      },
      selection: null,
    };
  }
  const { selectionRoot } = options;
  if (
    !selectionRoot ||
    typeof selectionRoot.querySelectorAll !== "function" ||
    host.contains(selectionRoot) ||
    selectionRoot.contains(host)
  )
    throw new Error("The source rows must be outside the batch toolbar host.");
  if (!["approve-admission", "check-in"].includes(options.action))
    throw new Error("Choose a supported batch action.");
  for (const key of [
    "isCurrent",
    "getRowKey",
    "getCheckboxHost",
    "getCandidates",
  ])
    if (typeof options[key] !== "function")
      throw new Error(`${key} is required.`);
  if (
    !options.eventId ||
    !/^[a-zA-Z0-9_-]+$/.test(text(options.eventId)) ||
    !options.instanceId ||
    !walletPattern.test(text(options.wallet)) ||
    options.chainId == null ||
    !walletPattern.test(text(options.contract)) ||
    !options.contractVersion
  )
    throw new Error(
      "An exact event, wallet, server and deployment scope is required.",
    );
  const scope = frozen({
    eventId: text(options.eventId),
    instanceId: text(options.instanceId),
    wallet: text(options.wallet),
    chainId: options.chainId,
    contract: text(options.contract),
    contractVersion: text(options.contractVersion),
    action: options.action,
    ...(Number(options.chainId) === 1 ||
    options.contractVersion === V9_TESTNET_CONTRACT_VERSION
      ? { mode: text(options.mode) }
      : {}),
  });
  const action = scope.action,
    approval = action === "approve-admission",
    readonly = options.readonly === true;
  const request = options.request ?? defaultRequest,
    previewAllowed = !readonly || typeof options.request === "function";
  const prefix = `batch-${scope.eventId}-${action}-${++mounts}`;
  const base = `/api/events/${encodeURIComponent(scope.eventId)}/batches`;
  const decorations = new Set(),
    controllers = new Set();
  let disposed = false,
    stopped = false,
    updateQueued = false,
    updating = false,
    generation = 0;
  let metadata = new Map(),
    retained = new Map(),
    currentState = null,
    sourceError = null,
    localError = null;
  let preview = null,
    reviewIntent = null,
    previewPending = false,
    committing = false,
    ambiguous = false,
    timer = null,
    returnFocus = null;
  host.classList.add("batch-actions");
  host.innerHTML = `<div class="batch-selection-tools"><label class="batch-select-label"><input id="${prefix}-master" type="checkbox" class="batch-select-input" data-batch-master aria-label="Select all visible eligible people"><span>Select visible</span></label><span class="batch-selected-count" data-batch-selected>0 selected</span><span class="batch-hidden-count" data-batch-hidden hidden></span><button type="button" class="button button-secondary button-small" data-batch-action="clear">Clear</button><button type="button" class="button button-primary button-small" data-batch-action="review">${approval ? "Review approvals" : "Review check-in"}</button><button type="button" class="button button-secondary button-small" data-batch-action="status" hidden>Check current status</button></div><p class="batch-error" data-batch-error role="alert" hidden></p><p class="batch-note" data-batch-note>${readonly ? "Sample review. Saving is disabled." : approval ? "Host approval and contract registration are separate. Luma approval stays manual." : "Trusted check-in and financial attendance are separate."}</p><dialog class="batch-dialog" data-batch-dialog aria-labelledby="${prefix}-title"><div data-batch-body></div></dialog>`;
  const find = (selector) => host.querySelector(selector),
    dialog = find("[data-batch-dialog]"),
    body = find("[data-batch-body]");
  const pureScope = JSON.stringify(scope);
  const registryKey = JSON.stringify({
    ...scope,
    wallet: scope.wallet.toLowerCase(),
    chainId: text(scope.chainId),
    contract: scope.contract.toLowerCase(),
  });
  let pendingRecord = pendingRegistry.get(registryKey) ?? null;
  let checkingPending = false;
  const journal = options.pendingJournal ?? null;
  let journalReady = !journal;
  let journalError = null;
  if (pendingRecord) {
    ambiguous = true;
    localError =
      "A previous batch save is unresolved. Check current status before preparing another batch.";
  }
  const guard = () =>
    !disposed && !stopped && options.isCurrent(scope) === true;
  let selection = createBatchSelection({
    kind: action,
    scopeKey: pureScope,
    isCurrent: guard,
    onChange: selectionChanged,
  });
  function current() {
    if (disposed || stopped) return false;
    let valid = false;
    try {
      valid = options.isCurrent(scope) === true;
    } catch {}
    if (!valid) dispose();
    return valid;
  }
  function removeDecorations() {
    for (const label of decorations) label.remove();
    decorations.clear();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    clearInterval(timer);
    observer.disconnect();
    for (const controller of controllers) controller.abort();
    controllers.clear();
    selectionRoot.removeEventListener("change", onSourceChange);
    host.removeEventListener("click", onClick);
    host.removeEventListener("change", onHostChange);
    selection.dispose();
    metadata.clear();
    retained.clear();
    preview = null;
    reviewIntent = null;
    returnFocus = null;
    if (dialog.open) dialog.close();
    body.replaceChildren();
    removeDecorations();
    host.replaceChildren();
  }
  function revoke() {
    stopped = true;
    generation++;
    clearInterval(timer);
    observer.disconnect();
    for (const controller of controllers) controller.abort();
    controllers.clear();
    selection.dispose();
    metadata.clear();
    retained.clear();
    preview = null;
    reviewIntent = null;
    if (dialog.open) dialog.close();
    body.replaceChildren();
    removeDecorations();
    host.innerHTML =
      '<p class="batch-error" role="alert">Current event access is required. Sign in again before selecting people.</p>';
  }
  function activeRows() {
    return [...selectionRoot.querySelectorAll(options.rowSelector)].filter(
      (row) =>
        !row.hidden &&
        row.getClientRects().length > 0 &&
        getComputedStyle(row).visibility !== "hidden",
    );
  }
  function itemFor(row) {
    const data = metadata.get(row.key) ?? retained.get(row.key) ?? row;
    return {
      participantId:
        typeof data.participantId === "string" && data.participantId.trim()
          ? data.participantId
          : null,
      wallet: text(row.wallet),
    };
  }
  function signature(state) {
    return JSON.stringify({
      revision: state.revision,
      error: state.error,
      rows: state.selected.map((row) => ({
        ...itemFor(row),
        key: row.key,
        eligible: row.eligible,
        missing: row.missing,
        label: row.label,
        blockedReason: row.blockedReason,
      })),
    });
  }
  function selectionChanged(state) {
    currentState = state;
    if (disposed || stopped) return;
    if (
      reviewIntent &&
      signature(state) !== reviewIntent.signature &&
      !committing &&
      !ambiguous
    ) {
      generation++;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      preview = null;
      previewPending = false;
      localError =
        "Selection or source changed. Review the selected people again.";
      if (dialog.open) showReviewError(localError);
    }
    renderToolbar();
  }
  function decorate() {
    if (!current()) return;
    const state = selection.snapshot(),
      byKey = new Map(state.allRows.map((row) => [row.key, row]));
    for (const row of selectionRoot.querySelectorAll(options.rowSelector)) {
      const key = text(options.getRowKey(row));
      const record = byKey.get(key);
      if (!record || record.missing) continue;
      const target = options.getCheckboxHost(row);
      if (!target || !row.contains(target)) continue;
      let checkbox = [...row.querySelectorAll("input[data-batch-key]")].find(
        (input) =>
          input.dataset.batchKind === action && input.dataset.batchKey === key,
      );
      if (!checkbox) {
        const label = document.createElement("label");
        label.className = "batch-select-label";
        label.dataset.batchOwner = prefix;
        checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "batch-select-input";
        checkbox.dataset.batchKey = key;
        checkbox.dataset.batchKind = action;
        const caption = document.createElement("span");
        caption.className = "sr-only";
        label.append(checkbox, caption);
        target.prepend(label);
        decorations.add(label);
      }
      const data = metadata.get(key) ?? retained.get(key);
      const label = data?.participantId ? record.label : record.wallet;
      const caption = checkbox.parentElement.querySelector(".sr-only");
      const captionText = `Select ${label} for ${approval ? "host approval" : "trusted check-in"}`;
      if (caption.textContent !== captionText)
        caption.textContent = captionText;
      if (checkbox.checked !== record.selected)
        checkbox.checked = record.selected;
      const disabled =
        committing ||
        ambiguous ||
        !journalReady ||
        !!journalError ||
        (!record.eligible && !record.selected);
      if (checkbox.disabled !== disabled) checkbox.disabled = disabled;
      const title = record.eligible
        ? ""
        : (record.blockedReason ?? "Not eligible");
      if (checkbox.title !== title) checkbox.title = title;
    }
    for (const label of [...decorations])
      if (!label.isConnected) decorations.delete(label);
  }
  function update() {
    if (!current()) return selection.snapshot();
    if (updating) return currentState ?? selection.snapshot();
    updating = true;
    try {
      const candidates = options.getCandidates();
      if (!Array.isArray(candidates))
        throw new Error("Candidate source is unavailable.");
      const next = new Map();
      for (const candidate of candidates) {
        if (candidate && typeof candidate.key === "string")
          next.set(candidate.key, {
            participantId:
              typeof candidate.participantId === "string" &&
              candidate.participantId.trim()
                ? candidate.participantId
                : null,
            wallet: text(candidate.wallet),
            label: text(candidate.label),
          });
      }
      const selectedBefore = selection.snapshot();
      for (const selected of selectedBefore.selected) {
        const previous =
          metadata.get(selected.key) ?? retained.get(selected.key);
        if (previous) retained.set(selected.key, previous);
      }
      metadata = next;
      sourceError = null;
      const visibleKeys = activeRows().map((row) =>
        text(options.getRowKey(row)),
      );
      const state = selection.update(candidates, {
        visibleKeys,
        revision: options.getRevision?.(),
      });
      for (const selected of state.selected)
        if (metadata.has(selected.key))
          retained.set(selected.key, metadata.get(selected.key));
      for (const key of retained.keys())
        if (!state.selectedKeys.includes(key)) retained.delete(key);
      currentState = state;
      if (current()) decorate();
      renderToolbar();
      return state;
    } catch (error) {
      sourceError = error.message || "Candidate source could not be read.";
      try {
        selection.update(null);
      } catch {}
      renderToolbar();
      return selection.snapshot();
    } finally {
      updating = false;
    }
  }
  function scheduleUpdate() {
    if (updateQueued || disposed || stopped) return;
    updateQueued = true;
    queueMicrotask(() => {
      updateQueued = false;
      if (current()) update();
    });
  }
  const observer = new MutationObserver(scheduleUpdate);
  function renderToolbar() {
    if (disposed || stopped) return;
    const state = currentState ?? selection.snapshot();
    host.dataset.batchEmpty = state.selectedCount === 0 ? "true" : "false";
    find('[data-batch-action="clear"]').hidden = state.selectedCount === 0;
    find('[data-batch-action="review"]').hidden = state.selectedCount === 0;
    find("[data-batch-note]").hidden = state.selectedCount === 0 && !ambiguous;
    find("[data-batch-selected]").textContent =
      `${state.selectedCount} selected`;
    const hidden = find("[data-batch-hidden]");
    hidden.hidden = state.hiddenCount === 0;
    hidden.textContent = `${state.hiddenCount} hidden or removed from this view`;
    const master = find("[data-batch-master]");
    master.checked = state.allVisibleEligibleSelected;
    master.indeterminate =
      state.visibleEligibleSelectedCount > 0 &&
      !state.allVisibleEligibleSelected;
    master.disabled =
      !state.visibleEligibleCount ||
      committing ||
      ambiguous ||
      !journalReady ||
      !!journalError;
    find('[data-batch-action="clear"]').disabled =
      !state.selectedCount || committing || ambiguous;
    find('[data-batch-action="review"]').disabled =
      !previewAllowed ||
      !journalReady ||
      !!journalError ||
      !state.canReview ||
      state.selectedCount > 150 ||
      previewPending ||
      committing ||
      ambiguous;
    const status = find('[data-batch-action="status"]');
    status.hidden = !ambiguous;
    status.disabled = checkingPending || !pendingRecord;
    const error =
      sourceError ||
      journalError ||
      localError ||
      (state.selectedCount > 150
        ? "Select at most 150 people in one batch."
        : null);
    const node = find("[data-batch-error]");
    node.hidden = !error;
    node.textContent = error ?? "";
    const byKey = new Map(state.allRows.map((row) => [row.key, row]));
    for (const label of decorations) {
      const checkbox = label.querySelector("input[data-batch-key]");
      const record = byKey.get(checkbox?.dataset.batchKey);
      if (checkbox)
        checkbox.disabled =
          committing ||
          ambiguous ||
          !journalReady ||
          !!journalError ||
          !record ||
          (!record.eligible && !record.selected);
    }
    updateCommitControls();
  }
  function onSourceChange(event) {
    const checkbox = event.target;
    if (
      !(checkbox instanceof HTMLInputElement) ||
      checkbox.dataset.batchKind !== action ||
      !checkbox.dataset.batchKey ||
      !current()
    )
      return;
    if (committing || ambiguous || !journalReady || journalError) {
      decorate();
      return;
    }
    selection.toggle(checkbox.dataset.batchKey, checkbox.checked);
    decorate();
  }
  function onHostChange(event) {
    if (!current()) return;
    if (event.target.matches("[data-batch-master]")) {
      if (committing || ambiguous || !journalReady || journalError) {
        renderToolbar();
        return;
      }
      selection.toggleVisible(event.target.checked);
      decorate();
    } else if (event.target.matches("[data-batch-confirm]"))
      updateCommitControls();
  }
  async function call(suffix, payload, method = "POST") {
    const controller = new AbortController();
    controllers.add(controller);
    let timeout;
    const timedOut = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(
          Object.assign(new Error("The server response timed out."), {
            code: "REQUEST_TIMEOUT",
          }),
        );
      }, 30000);
    });
    try {
      return await Promise.race([
        request(base + suffix, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
          signal: controller.signal,
        }),
        timedOut,
      ]);
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  function nonce() {
    if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "");
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  function validatePreview(value, intent) {
    if (
      !value ||
      value.eventId !== scope.eventId ||
      value.action !== action ||
      value.nonce !== intent.nonce ||
      !same(value.actorWallet, scope.wallet) ||
      text(value.chainId) !== text(scope.chainId) ||
      !same(value.contract, scope.contract) ||
      value.contractVersion !== scope.contractVersion ||
      value.requiresFinancialTransaction !== false
    )
      fail(
        "The server review does not match this event, account, action or deployment.",
      );
    if (
      typeof value.id !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(value.id) ||
      typeof value.expiresAt !== "number" ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= 0 ||
      !Array.isArray(value.rows) ||
      !value.counts ||
      typeof value.canCommit !== "boolean" ||
      !["ready", "blocked"].includes(value.tokenStatus)
    )
      fail("The server review is incomplete.");
    const expected = new Map(
      intent.items.map((item) => [item.wallet.toLowerCase(), item]),
    );
    const seen = new Set();
    let eligible = 0;
    for (const row of value.rows) {
      if (
        !row ||
        !walletPattern.test(text(row.wallet)) ||
        typeof row.eligible !== "boolean" ||
        (row.participantId != null &&
          (typeof row.participantId !== "string" || !row.participantId.trim()))
      )
        fail("The server review contains an invalid person.");
      const key = row.wallet.toLowerCase();
      if (!expected.has(key) || seen.has(key))
        fail("The server review contains an extra or duplicate wallet.");
      const item = expected.get(key);
      if (
        item.participantId != null &&
        row.participantId !== item.participantId
      )
        fail("The selected participant identity changed. Review again.");
      seen.add(key);
      if (row.eligible) eligible++;
    }
    if (
      seen.size !== expected.size ||
      value.rows.length !== intent.items.length ||
      value.counts.selected !== intent.items.length ||
      value.counts.eligible !== eligible ||
      value.counts.blocked !== value.rows.length - eligible
    )
      fail("The server review omitted or miscounted selected people.");
    if (value.canCommit && value.rows.some((row) => !row.participantId))
      fail("A committable batch must identify every linked participant.");
    if (
      value.canCommit &&
      (value.tokenStatus !== "ready" || eligible !== value.rows.length)
    )
      fail("The server review has inconsistent eligibility.");
    return frozen(clone(value));
  }
  function reviewTitle() {
    return `${readonly ? "Sample review · " : ""}${approval ? "Review host approvals" : "Review trusted check-in"}`;
  }
  function dialogHeading() {
    return `<header class="batch-dialog-header"><h2 id="${prefix}-title" tabindex="-1">${escape(reviewTitle())}</h2><button type="button" class="button button-secondary" data-batch-action="close" aria-label="Close batch review">Close</button></header>`;
  }
  function showReviewError(message) {
    if (!dialog.open) return;
    const node = body.querySelector("[data-batch-review-error]");
    if (node) {
      node.hidden = false;
      node.textContent = message;
    } else
      body.innerHTML =
        dialogHeading() +
        `<p class="batch-error" data-batch-review-error role="alert">${escape(message)}</p><div class="button-row"><button type="button" class="button button-primary" data-batch-action="review">Review again</button>${options.onRefresh ? '<button type="button" class="button button-secondary" data-batch-action="refresh">Refresh source</button>' : ""}</div>`;
    updateCommitControls();
  }
  function renderPreview() {
    if (!preview || !dialog.open) return;
    const consequences =
      typeof preview.consequences === "string"
        ? [preview.consequences]
        : Array.isArray(preview.consequences)
          ? preview.consequences.filter((item) => typeof item === "string")
          : [];
    body.innerHTML =
      dialogHeading() +
      `<p class="batch-consequences">${approval ? "Save host admission approvals for exactly these guests. Contract registration is a separate transaction. Approve these guests manually in Luma as well." : "Record trusted door check-in for exactly these people. Publishing the financial attendance list is a separate transaction."}</p>${consequences.length ? `<ul class="batch-consequences">${consequences.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : ""}<p class="batch-selected-count">${preview.counts.selected} selected · ${preview.counts.eligible} eligible · ${preview.counts.blocked} blocked</p><p class="batch-error" data-batch-review-error role="alert" hidden></p><div class="table-scroll"><table class="batch-review-table"><caption class="sr-only">Every selected person in this server review</caption><thead><tr><th scope="col">Selected person</th><th scope="col">Review result</th></tr></thead><tbody>${preview.rows.map((row) => `<tr><td><strong>${row.participantId && row.name ? escape(row.name) : escape(row.wallet)}</strong>${row.participantId && row.email ? `<small>${escape(row.email)}</small>` : "<small>Wallet link needs review</small>"}<code>${escape(row.wallet)}</code></td><td><strong>${row.eligible ? "Eligible" : "Blocked"}</strong><p>${escape(row.reason || row.reasonCode || (row.eligible ? "Included in this reviewed batch." : "Not eligible for this batch."))}</p></td></tr>`).join("")}</tbody></table></div><details><summary>Exact batch context</summary><dl class="batch-review-facts"><div><dt>Event</dt><dd>${escape(scope.eventId)}</dd></div><div><dt>Account</dt><dd>${escape(scope.wallet)}</dd></div><div><dt>Network / contract</dt><dd>${escape(scope.chainId)}<br><code>${escape(scope.contract)}</code></dd></div><div><dt>Version</dt><dd>${escape(scope.contractVersion)}</dd></div><div><dt>Snapshot block</dt><dd>${escape(preview.blockNumber)}</dd></div><div><dt>Revision</dt><dd>${escape(typeof preview.revision === "string" || typeof preview.revision === "number" ? preview.revision : JSON.stringify(preview.revision))}</dd></div><div><dt>Review expires</dt><dd>${escape(new Date(preview.expiresAt).toLocaleString())}</dd></div></dl></details><p class="batch-note" data-batch-expiry role="status"></p><label class="batch-confirmation"><input type="checkbox" data-batch-confirm><span>I reviewed these selected people</span></label><div class="button-row"><button type="button" class="button button-primary" data-batch-action="commit">${approval ? "Approve selected guests" : "Record trusted check-in"}</button><button type="button" class="button button-secondary" data-batch-action="review">Review again</button>${options.onRefresh ? '<button type="button" class="button button-secondary" data-batch-action="refresh">Refresh source</button>' : ""}<button type="button" class="button button-secondary" data-batch-action="status" hidden>Check current status</button></div>${readonly ? '<p class="batch-note">Sample review. Saving is disabled.</p>' : ""}`;
    clearInterval(timer);
    timer = setInterval(() => {
      if (current() && dialog.open) updateCommitControls();
    }, 500);
    updateCommitControls();
    body.querySelector("h2")?.focus();
  }
  function updateCommitControls() {
    if (disposed || stopped || !dialog.open) return;
    const expired = !!preview && Date.now() >= preview.expiresAt;
    const ready =
      !!preview &&
      !!reviewIntent &&
      !ambiguous &&
      !committing &&
      preview.canCommit &&
      preview.tokenStatus === "ready" &&
      preview.counts.blocked === 0 &&
      !expired &&
      signature(selection.snapshot()) === reviewIntent.signature;
    const button = body.querySelector('[data-batch-action="commit"]');
    if (button) {
      button.disabled =
        readonly ||
        !ready ||
        !body.querySelector("[data-batch-confirm]")?.checked;
      button.textContent = committing
        ? "Saving…"
        : approval
          ? "Approve selected guests"
          : "Record trusted check-in";
    }
    const expiry = body.querySelector("[data-batch-expiry]");
    if (expiry)
      expiry.textContent = ambiguous
        ? "Save result is unknown. Check current status before preparing another batch."
        : expired
          ? "This review expired. Review the selected people again."
          : preview && !preview.canCommit
            ? "Every selected row must be eligible before this batch can be saved."
            : "";
    for (const close of body.querySelectorAll('[data-batch-action="close"]'))
      close.disabled = committing;
    for (const review of body.querySelectorAll('[data-batch-action="review"]'))
      review.disabled = committing || ambiguous || previewPending;
    const confirmation = body.querySelector("[data-batch-confirm]");
    if (confirmation) confirmation.disabled = committing || ambiguous;
    for (const refresh of body.querySelectorAll(
      '[data-batch-action="refresh"]',
    ))
      refresh.disabled = committing;
    for (const status of body.querySelectorAll(
      '[data-batch-action="status"]',
    )) {
      status.hidden = !ambiguous;
      status.disabled = checkingPending || !pendingRecord;
    }
  }
  function restorePendingLock() {
    const record = pendingRegistry.get(registryKey);
    if (!record) return false;
    pendingRecord = record;
    ambiguous = true;
    localError =
      "A previous batch save is unresolved. Check current status before preparing another batch.";
    renderToolbar();
    return true;
  }
  async function reviewBatch(button) {
    if (
      !current() ||
      committing ||
      ambiguous ||
      !previewAllowed ||
      !journalReady ||
      journalError
    )
      return;
    if (restorePendingLock()) return;
    update();
    const state = selection.snapshot();
    if (!state.canReview) return;
    let intent;
    try {
      if (state.selectedCount > 150) fail("Select at most 150 people.");
      const items = state.selected.map(itemFor),
        seen = new Set();
      for (const item of items) {
        if (!walletPattern.test(item.wallet))
          fail("A selected wallet is invalid. Refresh the source.");
        const key = item.wallet.toLowerCase();
        if (seen.has(key))
          fail(
            "Select each wallet only once. Duplicate selected wallets cannot be silently removed.",
          );
        seen.add(key);
      }
      intent = {
        nonce: nonce(),
        items,
        keys: [...state.selectedKeys],
        signature: signature(state),
      };
    } catch (error) {
      localError = error.message;
      renderToolbar();
      return;
    }
    if (
      [...document.querySelectorAll("dialog[open]")].some(
        (other) => other !== dialog,
      )
    ) {
      localError = "Close the current review before preparing another batch.";
      renderToolbar();
      return;
    }
    try {
      options.beforeOpen?.();
    } catch (error) {
      localError = error.message;
      renderToolbar();
      return;
    }
    if (!current()) return;
    const turn = ++generation;
    preview = null;
    reviewIntent = intent;
    previewPending = true;
    localError = null;
    if (!dialog.open) returnFocus = button;
    body.innerHTML =
      dialogHeading() +
      '<p class="batch-note" role="status">Preparing a fresh server review…</p>';
    if (!dialog.open) dialog.showModal();
    body.querySelector("h2")?.focus();
    renderToolbar();
    try {
      const response = await call("/preview", {
        action,
        items: intent.items,
        nonce: intent.nonce,
      });
      if (!current() || turn !== generation || !dialog.open) return;
      preview = validatePreview(response, intent);
      previewPending = false;
      renderPreview();
    } catch (error) {
      if (!current() || turn !== generation || error.name === "AbortError")
        return;
      if (authError(error)) {
        revoke();
        return;
      }
      preview = null;
      previewPending = false;
      localError = error.message || "The server review could not be prepared.";
      showReviewError(localError);
    } finally {
      if (current() && turn === generation) {
        previewPending = false;
        renderToolbar();
      }
    }
  }
  function validateCommit(result, review) {
    if (
      !result ||
      result.id !== review.id ||
      result.eventId !== scope.eventId ||
      result.action !== action ||
      result.status !== "committed" ||
      text(result.chainId) !== text(scope.chainId) ||
      !same(result.contract, scope.contract) ||
      result.requiresFinancialTransaction !== false ||
      result.appliedCount !== review.counts.selected ||
      !Array.isArray(result.participantIds) ||
      !Array.isArray(result.observationIds) ||
      typeof result.replayed !== "boolean" ||
      result.nextAction !==
        (approval ? "review-staker-registration" : "review-post-attendance")
    )
      fail(
        "The save result could not be confirmed for this exact reviewed batch.",
      );
    const expected = review.rows.map((row) => row.participantId);
    const ids = result.participantIds;
    if (
      expected.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(expected).size !== expected.length ||
      ids.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(ids).size !== ids.length ||
      ids.length !== expected.length ||
      ids.some((id) => !expected.includes(id))
    )
      fail(
        "The save result does not identify exactly the reviewed participants.",
      );
    const observations = result.observationIds;
    if (
      observations.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(observations).size !== observations.length ||
      observations.length !== (approval ? 0 : review.counts.selected)
    )
      fail(
        "The save result does not contain the expected trusted check-in records.",
      );
    return frozen({
      id: result.id,
      eventId: result.eventId,
      action: result.action,
      status: result.status,
      appliedCount: result.appliedCount,
      participantIds: [...result.participantIds],
      observationIds: [...result.observationIds],
      committedAt: result.committedAt,
      chainId: result.chainId,
      contract: result.contract,
      requiresFinancialTransaction: false,
      nextAction: result.nextAction,
      replayed: result.replayed,
    });
  }
  function minimalReview(value) {
    return frozen({
      id: value.id,
      eventId: value.eventId,
      action: value.action,
      nonce: value.nonce,
      actorWallet: value.actorWallet,
      chainId: value.chainId,
      contract: value.contract,
      contractVersion: value.contractVersion,
      expiresAt: value.expiresAt,
      counts: { ...value.counts },
      requiresFinancialTransaction: false,
      rows: value.rows.map((row) => ({
        participantId: row.participantId,
        wallet: row.wallet,
        eligible: row.eligible,
      })),
    });
  }
  function storePending(record, phase, result) {
    const saved = frozen({
      review: record.review,
      nonce: record.nonce,
      originalScope: record.originalScope ?? scope,
      phase,
      ...(result ? { result } : {}),
    });
    pendingRegistry.set(registryKey, saved);
    pendingRecord = saved;
  }
  function clearPending(expectedId) {
    if (pendingRegistry.get(registryKey)?.review.id !== expectedId)
      return false;
    pendingRegistry.delete(registryKey);
    if (pendingRecord?.review.id === expectedId) pendingRecord = null;
    return true;
  }
  function markerFor(record) {
    return frozen({
      version: 1,
      scope: { ...(record.originalScope ?? scope) },
      id: record.review.id,
      nonce: record.nonce,
      items: record.review.rows.map((row) => ({
        participantId: row.participantId,
        wallet: row.wallet,
      })),
      selectedCount: record.review.counts.selected,
      phase: record.phase,
    });
  }
  function recordFromMarker(value) {
    const saved = value?.scope;
    if (
      value?.version !== 1 ||
      !saved ||
      !saved.instanceId ||
      saved.eventId !== scope.eventId ||
      saved.action !== action ||
      !same(saved.wallet, scope.wallet) ||
      text(saved.chainId) !== text(scope.chainId) ||
      !same(saved.contract, scope.contract) ||
      saved.contractVersion !== scope.contractVersion ||
      ((Number(scope.chainId) === 1 ||
        scope.contractVersion === V9_TESTNET_CONTRACT_VERSION) &&
        (saved.mode !== scope.mode || saved.instanceId !== scope.instanceId)) ||
      typeof value.id !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(value.id) ||
      typeof value.nonce !== "string" ||
      !/^[a-zA-Z0-9_-]{8,64}$/.test(value.nonce) ||
      !["submitting", "unknown", "confirmed"].includes(value.phase) ||
      !Array.isArray(value.items) ||
      value.items.length < 1 ||
      value.items.length > 150 ||
      value.selectedCount !== value.items.length
    )
      fail("The saved batch marker does not match this event and account.");
    const items = value.items.map((item) => {
      if (
        !item ||
        !walletPattern.test(text(item.wallet)) ||
        typeof item.participantId !== "string" ||
        !item.participantId.trim()
      )
        fail("The saved batch marker contains an invalid participant.");
      return { participantId: item.participantId, wallet: item.wallet };
    });
    if (
      new Set(items.map((item) => item.wallet.toLowerCase())).size !==
        items.length ||
      new Set(items.map((item) => item.participantId)).size !== items.length
    )
      fail("The saved batch marker contains duplicate people.");
    const originalScope = {
      eventId: saved.eventId,
      instanceId: text(saved.instanceId),
      wallet: saved.wallet,
      chainId: saved.chainId,
      contract: saved.contract,
      contractVersion: saved.contractVersion,
      action: saved.action,
    };
    return frozen({
      nonce: value.nonce,
      phase: value.phase,
      originalScope,
      review: {
        id: value.id,
        eventId: scope.eventId,
        action,
        nonce: value.nonce,
        actorWallet: scope.wallet,
        chainId: scope.chainId,
        contract: scope.contract,
        contractVersion: scope.contractVersion,
        expiresAt: 0,
        requiresFinancialTransaction: false,
        counts: { selected: items.length, eligible: items.length, blocked: 0 },
        rows: items.map((item) => ({ ...item, eligible: true })),
      },
    });
  }
  async function loadJournal() {
    if (!journal) return;
    try {
      if (
        !["load", "save", "remove"].every(
          (key) => typeof journal[key] === "function",
        )
      )
        fail("The pending batch journal is unavailable.");
      const value = await journal.load(scope);
      if (!current()) return;
      if (value != null) {
        const restored = recordFromMarker(value);
        const existing = pendingRegistry.get(registryKey);
        if (existing && existing.review.id !== restored.review.id)
          fail(
            "Conflicting pending batch markers need review before another save.",
          );
        pendingRegistry.set(registryKey, existing ?? restored);
        pendingRecord = existing ?? restored;
        ambiguous = true;
        localError =
          "A previous batch save is unresolved. Check current status before preparing another batch.";
      }
    } catch (error) {
      if (current())
        journalError =
          error.message || "The pending batch journal could not be loaded.";
    } finally {
      journalReady = true;
      if (current()) {
        decorate();
        renderToolbar();
      }
    }
  }
  async function resolvePending(expectedId) {
    if (pendingRegistry.get(registryKey)?.review.id !== expectedId)
      return false;
    if (journal && (await journal.remove(scope, expectedId)) === false)
      fail("The saved journal marker changed; keep this batch locked.");
    return clearPending(expectedId);
  }
  async function acceptCommitted(result, review) {
    const existing = pendingRegistry.get(registryKey);
    if (!existing || existing.review.id !== review.id) return;
    storePending(existing, "confirmed", result);
    try {
      if (!(await resolvePending(review.id))) return;
    } catch {
      if (current()) {
        committing = false;
        ambiguous = true;
        journalError =
          "The batch was saved, but its pending journal could not be updated. Check current status.";
        localError = journalError;
        showReviewError(journalError);
        renderToolbar();
      }
      return;
    }
    if (!current()) return;
    journalError = null;
    committing = false;
    ambiguous = false;
    previewPending = false;
    preview = null;
    reviewIntent = null;
    localError = null;
    clearInterval(timer);
    if (dialog.open) dialog.close();
    generation++;
    const wallets = new Set(review.rows.map((row) => row.wallet.toLowerCase()));
    for (const row of selection.snapshot().selected)
      if (wallets.has(row.wallet.toLowerCase()))
        selection.toggle(row.key, false);
    decorate();
    renderToolbar();
    if (current()) {
      find("[data-batch-note]").textContent =
        `${result.appliedCount} ${approval ? "host approvals saved. Contract registration and manual Luma approval remain separate." : "trusted check-ins saved. Publishing financial attendance remains separate."}`;
      find("[data-batch-master]")?.focus();
      try {
        await options.onCommitted?.(result, review);
      } catch {
        if (current()) {
          localError =
            "The batch was saved, but the source could not refresh. Refresh the event to see current records.";
          renderToolbar();
        }
      }
    }
  }
  async function commitBatch() {
    if (
      !current() ||
      readonly ||
      committing ||
      ambiguous ||
      !preview ||
      !reviewIntent
    )
      return;
    if (restorePendingLock()) return;
    updateCommitControls();
    const button = body.querySelector('[data-batch-action="commit"]');
    if (!button || button.disabled) return;
    const review = minimalReview(preview),
      turn = generation,
      record = frozen({
        review,
        nonce: reviewIntent.nonce,
        phase: "submitting",
      });
    storePending(record, "submitting");
    committing = true;
    localError = null;
    renderToolbar();
    let requestStarted = false;
    try {
      if (journal)
        await journal.save(scope, markerFor(pendingRegistry.get(registryKey)));
      if (!current() || turn !== generation) return;
      requestStarted = true;
      const response = await call(`/${encodeURIComponent(review.id)}/commit`, {
        nonce: record.nonce,
        confirmed: true,
      });
      // Verify the original result even after disposal: a remount must not forget a completed save.
      const result = validateCommit(response, review);
      if (!current() || turn !== generation) {
        if (pendingRegistry.get(registryKey)?.review.id === review.id)
          storePending(record, "confirmed", result);
        return;
      }
      await acceptCommitted(result, review);
    } catch (error) {
      if (!requestStarted) {
        if (pendingRegistry.get(registryKey)?.review.id === review.id)
          storePending(record, "unknown");
        if (current() && turn === generation) {
          committing = false;
          ambiguous = true;
          journalError =
            "The recovery marker could not be saved. No batch save request was sent. Check the journal before continuing.";
          showReviewError(journalError);
          renderToolbar();
        }
        return;
      }
      const definitive =
        Number(error.status) === 409 &&
        ["STALE_BATCH", "ATTENDANCE_TIME_MISMATCH"].includes(error.code);
      if (definitive && !journal) clearPending(review.id);
      else if (pendingRegistry.get(registryKey)?.review.id === review.id)
        storePending(record, "unknown");
      if (!current() || turn !== generation) return;
      committing = false;
      if (authError(error)) {
        revoke();
        return;
      }
      if (definitive && !journal) {
        preview = null;
        localError =
          "This review is stale. Refresh and review the selected people again.";
        showReviewError(localError);
      } else {
        ambiguous = true;
        localError =
          "The save result could not be confirmed. Check current status before preparing another batch.";
        showReviewError(localError);
      }
      renderToolbar();
    } finally {
      if (current() && turn === generation) {
        committing = false;
        renderToolbar();
      }
    }
  }
  function validatePendingStatus(value, record) {
    const review = record.review;
    if (
      !value ||
      value.id !== review.id ||
      value.eventId !== scope.eventId ||
      value.action !== action ||
      !same(value.actorWallet, scope.wallet) ||
      text(value.chainId) !== text(scope.chainId) ||
      !same(value.contract, scope.contract) ||
      value.contractVersion !== scope.contractVersion ||
      value.requiresFinancialTransaction !== false ||
      !["ready", "blocked", "expired", "committing", "unknown"].includes(
        value.status,
      )
    )
      fail(
        "The batch status could not be verified for this exact event and account.",
      );
    return value;
  }
  async function checkPendingStatus() {
    if (!current() || checkingPending || committing) return;
    const record = pendingRegistry.get(registryKey);
    if (!record) {
      pendingRecord = null;
      ambiguous = false;
      preview = null;
      reviewIntent = null;
      localError =
        "The previous request was resolved. Refresh current records before preparing another batch.";
      renderToolbar();
      return;
    }
    pendingRecord = record;
    checkingPending = true;
    renderToolbar();
    try {
      const value = await call(
        `/${encodeURIComponent(record.review.id)}`,
        undefined,
        "GET",
      );
      if (value?.status === "committed") {
        const result = validateCommit(value, record.review);
        if (!current()) {
          if (pendingRegistry.get(registryKey)?.review.id === record.review.id)
            storePending(record, "confirmed", result);
          return;
        }
        await acceptCommitted(result, record.review);
        return;
      }
      if (!current()) return;
      const status = validatePendingStatus(value, record);
      if (status.status === "expired") {
        if (!(await resolvePending(record.review.id))) return;
        journalError = null;
        ambiguous = false;
        preview = null;
        reviewIntent = null;
        localError =
          "The previous review expired without applying. Refresh and review selected people again.";
      } else
        localError =
          "This batch save is still unresolved. Check current status again before preparing another batch.";
    } catch (error) {
      if (!current()) return;
      if (authError(error)) {
        revoke();
        return;
      }
      localError =
        "The previous save could not be resolved. Keep this batch locked and check current status again.";
    } finally {
      checkingPending = false;
      if (current()) renderToolbar();
    }
  }
  function closeReview() {
    if (committing) return;
    generation++;
    previewPending = false;
    clearInterval(timer);
    if (!ambiguous) {
      preview = null;
      reviewIntent = null;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    }
    if (dialog.open) dialog.close();
    renderToolbar();
  }
  async function onClick(event) {
    const button = event.target?.closest?.("button[data-batch-action]");
    if (!button || !host.contains(button) || button.disabled || !current())
      return;
    try {
      const key = button.dataset.batchAction;
      if (key === "review") await reviewBatch(button);
      else if (key === "clear") {
        selection.clear();
        decorate();
        if (current()) find("[data-batch-master]")?.focus();
      } else if (key === "close") closeReview();
      else if (key === "commit") await commitBatch();
      else if (key === "status") await checkPendingStatus();
      else if (key === "refresh") {
        if (typeof options.onRefresh === "function") await options.onRefresh();
        if (current()) update();
      }
    } catch (error) {
      if (current()) {
        localError = error.message || "The batch action could not continue.";
        renderToolbar();
      }
    }
  }
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !dialog.open || !current()) return;
    const controls = [
      ...dialog.querySelectorAll(
        "button,a[href],input,select,textarea,summary,[tabindex]",
      ),
    ].filter(
      (control) =>
        control.tabIndex >= 0 &&
        !control.matches(":disabled") &&
        control.getClientRects().length &&
        getComputedStyle(control).visibility !== "hidden",
    );
    const index = controls.indexOf(document.activeElement);
    if (!controls.length) {
      event.preventDefault();
      body.querySelector("h2")?.focus();
    } else if (event.shiftKey && index <= 0) {
      event.preventDefault();
      controls.at(-1).focus();
    } else if (
      !event.shiftKey &&
      (index < 0 || index === controls.length - 1)
    ) {
      event.preventDefault();
      controls[0].focus();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    if (committing) {
      event.preventDefault();
      return;
    }
    generation++;
    previewPending = false;
    clearInterval(timer);
    if (!ambiguous) {
      preview = null;
      reviewIntent = null;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    }
  });
  dialog.addEventListener("close", () => {
    if (dialog.open || !current() || document.querySelector("dialog[open]"))
      return;
    renderToolbar();
    if (returnFocus?.isConnected) returnFocus.focus();
    else find('[data-batch-action="review"]')?.focus();
  });
  host.addEventListener("click", onClick);
  host.addEventListener("change", onHostChange);
  selectionRoot.addEventListener("change", onSourceChange);
  observer.observe(selectionRoot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  update();
  if (journal) loadJournal();
  return Object.freeze({ update, dispose, selection });
}
