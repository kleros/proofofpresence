// Read-only deposit observations. The server owns canonical indexing, identity links and accounting.
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const text = (value) => String(value ?? "");
const short = (value) =>
  value && value.length > 24
    ? `${value.slice(0, 10)}…${value.slice(-8)}`
    : value;
const linked = (row) => row.linked === true && !!text(row.participantId).trim();
const positive = (value) => {
  try {
    return value != null && BigInt(value) > 0n;
  } catch {
    return false;
  }
};
function amount(value, symbol) {
  if (value == null) return "Unavailable";
  try {
    const wei = BigInt(value),
      unit = 10n ** 18n;
    if (wei < 0n) return "Unavailable";
    const fraction = (wei % unit)
      .toString()
      .padStart(18, "0")
      .replace(/0+$/, "");
    return `${wei / unit}${fraction ? `.${fraction}` : ""} ${symbol}`;
  } catch {
    return "Unavailable";
  }
}
function receiptState(receipt) {
  const confirmations = Number(receipt.confirmations);
  if (
    receipt.status === "confirmed" &&
    Number.isInteger(confirmations) &&
    confirmations >= 2
  )
    return { kind: "confirmed", label: "Confirmed receipt", tone: "neutral" };
  if (receipt.status === "confirming")
    return { kind: "confirming", label: "Confirming receipt", tone: "warning" };
  return {
    kind: "review",
    label: "Receipt status needs review",
    tone: "warning",
  };
}
const when = (value, seconds = false) => {
  if (value == null) return "Unavailable";
  const numeric =
    typeof value === "number" ||
    typeof value === "bigint" ||
    /^-?\d+(\.\d+)?$/.test(text(value));
  const date = new Date(numeric ? Number(value) * (seconds ? 1000 : 1) : value);
  return Number.isFinite(date.valueOf())
    ? date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unavailable";
};
const authError = (error) =>
  [401, 403].includes(Number(error?.status)) ||
  [
    "UNAUTHORIZED",
    "FORBIDDEN",
    "OWNER_REQUIRED",
    "EVENT_OWNER_REQUIRED",
    "AUTH_REQUIRED",
  ].includes(text(error?.code));
async function defaultRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let value;
  try {
    value = await response.json();
  } catch {
    throw Object.assign(new Error(`The server returned ${response.status}.`), {
      status: response.status,
    });
  }
  if (!response.ok)
    throw Object.assign(
      new Error(value.error ?? `Request failed (${response.status}).`),
      { status: response.status, code: value.code },
    );
  return value;
}

/** Mount only for an authenticated event owner; dispose before event, wallet or server changes. */
export function mountContractInbox(element, options) {
  if (!element || typeof element.replaceChildren !== "function")
    throw new Error("A contract inbox element is required.");
  if (options?.canManage !== true) {
    element.replaceChildren();
    return {
      dispose() {
        element.replaceChildren();
      },
      refresh: async () => undefined,
    };
  }
  if (
    !options.eventId ||
    !/^[a-zA-Z0-9_-]+$/.test(text(options.eventId)) ||
    !options.instanceId ||
    !options.wallet ||
    typeof options.isCurrent !== "function"
  )
    throw new Error(
      "Contract inbox requires a current event, wallet and server scope.",
    );
  const scope = Object.freeze({
    eventId: text(options.eventId),
    instanceId: text(options.instanceId),
    wallet: text(options.wallet),
    chainId: options.chainId,
    contract: options.contract,
    contractVersion: options.contractVersion,
  });
  const base = `/api/events/${encodeURIComponent(scope.eventId)}/deposit-inbox`;
  const request = options.request ?? defaultRequest;
  const symbol = text(options.currencySymbol).trim() || "native token";
  const readonly = options.readonly === true;
  const controllers = new Set();
  let disposed = false,
    stopped = false,
    loading = true,
    snapshot = null,
    localError = null,
    inFlight = null;
  let query = "",
    filter = "all",
    timer = null,
    triggerWallet = null,
    trigger = null,
    modalVersion = 0,
    reviewAnchor = null;
  element.dataset.contractInbox = "";
  const id = `contract-${scope.eventId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  element.innerHTML = `<div class="contract-source-bar"><div class="contract-source-title"><h3 id="${id}-title">Contract deposits</h3><p class="contract-sync-meta" data-contract-meta role="status">Loading deposit observations…</p></div><div class="contract-source-tools"><button type="button" class="button button-secondary button-small" data-contract-action="refresh">Refresh</button></div></div><div data-contract-notice aria-live="polite"></div><div class="contract-controls" data-contract-controls hidden><div><label class="sr-only" for="${id}-search">Find a wallet or transaction</label><input id="${id}-search" type="search" data-contract-search placeholder="Wallet, linked guest or transaction"></div><div><label class="sr-only" for="${id}-filter">Deposit status</label><select id="${id}-filter" data-contract-filter><option value="all">All deposit wallets</option><option value="unlinked">Unlinked wallets</option><option value="credit">Unused credit</option><option value="confirming">Confirming receipts</option><option value="review">Receipt status needs review</option><option value="held">Held case shares</option><option value="owed">Still owed</option></select></div></div><p class="contract-sync-meta" data-contract-count></p><div data-contract-rows></div><dialog class="contract-dialog-content" data-contract-dialog aria-labelledby="${id}-dialog-title"><div data-contract-dialog-body></div></dialog>`;
  const find = (selector) => element.querySelector(selector);
  const dialog = find("[data-contract-dialog]");
  const dialogBody = find("[data-contract-dialog-body]");
  const rowsElement = find("[data-contract-rows]");
  function dispose() {
    if (disposed) return;
    disposed = true;
    modalVersion++;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    element.removeEventListener("click", onClick);
    element.removeEventListener("input", onInput);
    element.removeEventListener("change", onChange);
    for (const controller of controllers) controller.abort();
    controllers.clear();
    if (dialog.open) dialog.close();
    snapshot = null;
    reviewAnchor = null;
    query = "";
    trigger = null;
    triggerWallet = null;
    dialogBody.replaceChildren();
    rowsElement.replaceChildren();
    element.replaceChildren();
  }
  function current() {
    if (disposed) return false;
    let valid = false;
    try {
      valid = options.isCurrent(scope) === true;
    } catch {
      /* A failed guard removes private data. */
    }
    if (!valid) dispose();
    return valid;
  }
  function revoke() {
    stopped = true;
    clearInterval(timer);
    modalVersion++;
    for (const controller of controllers) controller.abort();
    snapshot = null;
    reviewAnchor = null;
    query = "";
    loading = false;
    if (dialog.open) dialog.close();
    dialogBody.replaceChildren();
    const search = find("[data-contract-search]");
    if (search) search.value = "";
    localError =
      "Event owner access is required. Sign in again to view contract deposits.";
    render();
  }
  function accept(value) {
    const wrongScope =
      !value ||
      value.source !== "contract" ||
      value.eventId !== scope.eventId ||
      (value.instanceId != null && value.instanceId !== scope.instanceId);
    const unexpectedDeployment =
      (scope.chainId != null && text(scope.chainId) !== text(value?.chainId)) ||
      (scope.contract != null &&
        text(scope.contract).toLowerCase() !==
          text(value?.contract).toLowerCase()) ||
      (scope.contractVersion != null &&
        text(scope.contractVersion) !== text(value?.contractVersion));
    const changedDeployment =
      snapshot &&
      (text(snapshot.chainId) !== text(value?.chainId) ||
        text(snapshot.contract).toLowerCase() !==
          text(value?.contract).toLowerCase() ||
        text(snapshot.contractVersion) !== text(value?.contractVersion));
    if (wrongScope || unexpectedDeployment || changedDeployment)
      throw Object.assign(
        new Error(
          "The deposit response belongs to a different event or deployment. Reload the event before continuing.",
        ),
        { scopeMismatch: true },
      );
    if (
      !Array.isArray(value.rows) ||
      value.rows.some(
        (row) =>
          !row ||
          typeof row.wallet !== "string" ||
          !Array.isArray(row.transactions),
      )
    )
      throw new Error("The contract deposit response is incomplete.");
    // Proven orphaned anchors cannot remain visible as confirmed observations.
    if (value.error?.code === "INBOX_REORG") {
      modalVersion++;
      if (dialog.open) dialog.close();
      dialogBody.replaceChildren();
      reviewAnchor = null;
      query = "";
      const search = find("[data-contract-search]");
      if (search) search.value = "";
      snapshot = value;
    }
    // Unknown transient errors may retain clearly labelled stale observations.
    else if (value.error && snapshot?.indexedBlock)
      snapshot = {
        ...snapshot,
        error: value.error,
        stale: true,
        nextRefreshAt: value.nextRefreshAt,
      };
    else snapshot = value;
    localError = null;
  }
  function rowStatus(row) {
    if (positive(row.owedWei))
      return { label: "Still owed", value: row.owedWei };
    if (positive(row.heldShareWei))
      return { label: "Held case share", value: row.heldShareWei };
    if (positive(row.pendingCreditWei))
      return { label: "Unused credit", value: row.pendingCreditWei };
    if (positive(row.committedPrincipalWei))
      return { label: "Committed principal", value: row.committedPrincipalWei };
    return row.pendingCreditWei == null
      ? { label: "Payer credit unavailable for this version", value: null }
      : { label: "Unused credit", value: row.pendingCreditWei };
  }
  function renderRows() {
    if (!current()) return;
    const rows = snapshot?.indexedBlock ? snapshot.rows : [];
    const wanted = query.trim().toLowerCase();
    const visible = rows.filter((row) => {
      const transactions = Array.isArray(row.transactions)
        ? row.transactions
        : [];
      const search = [
        row.wallet,
        ...(linked(row) ? [row.name, row.email] : []),
        ...transactions.map((item) => item.txHash),
      ]
        .map(text)
        .join(" ")
        .toLowerCase();
      const match =
        filter === "all" ||
        (filter === "unlinked" && !linked(row)) ||
        (filter === "credit" && positive(row.pendingCreditWei)) ||
        (filter === "confirming" &&
          transactions.some(
            (item) => receiptState(item).kind === "confirming",
          )) ||
        (filter === "review" &&
          transactions.some((item) => receiptState(item).kind === "review")) ||
        (filter === "held" && positive(row.heldShareWei)) ||
        (filter === "owed" && positive(row.owedWei));
      return match && (!wanted || search.includes(wanted));
    });
    find("[data-contract-count]").textContent = snapshot?.indexedBlock
      ? `${visible.length} of ${rows.length} deposit wallets`
      : "";
    if (!snapshot?.indexedBlock) {
      rowsElement.innerHTML = `<div class="contract-empty">${loading ? "Reading the event contract…" : "No completed deposit index is available yet. Refresh to try again."}</div>`;
      return;
    }
    if (!visible.length) {
      rowsElement.innerHTML = `<div class="contract-empty">${rows.length ? "No wallets match this search or status." : "No deposit receipts were observed through the indexed block."}</div>`;
      return;
    }
    const focused = document.activeElement?.closest?.("[data-contract-wallet]");
    const focusedWallet =
      focused && element.contains(focused)
        ? focused.dataset.contractWallet
        : null;
    rowsElement.innerHTML = `<table class="contract-inbox-table"><caption class="sr-only">Deposit observations for the selected event contract</caption><thead><tr><th scope="col">Wallet</th><th scope="col">Deposit observations</th><th scope="col">Next action</th></tr></thead><tbody>${visible
      .map((row) => {
        const isLinked = linked(row),
          transactions = Array.isArray(row.transactions)
            ? row.transactions
            : [];
        const confirming = transactions.filter(
          (item) => receiptState(item).kind === "confirming",
        ).length;
        const confirmed = transactions.filter(
          (item) => receiptState(item).kind === "confirmed",
        ).length;
        const needsReview = transactions.filter(
          (item) => receiptState(item).kind === "review",
        ).length;
        const pertinent = rowStatus(row);
        return `<tr data-contract-linked-id="${isLinked ? escape(row.participantId) : ""}"><td><div class="contract-person"><span class="contract-avatar" aria-hidden="true">${isLinked ? escape(text(row.name).trim()[0]?.toUpperCase() || "W") : "W"}</span><div><strong>${isLinked ? escape(row.name || "Linked guest") : escape(short(text(row.wallet)))}</strong>${isLinked ? `<small>${escape(row.email)}</small><code class="contract-reference">${escape(short(text(row.wallet)))}</code>` : '<small class="contract-link-note">Unlinked wallet</small>'}</div></div></td><td><strong>${escape(amount(row.receivedWei, symbol))} received</strong><small class="contract-link-note">Historical deposits · ${confirmed} confirmed${confirming ? ` · ${confirming} confirming` : ""}${needsReview ? ` · ${needsReview} receipt status needs review` : ""}</small><span class="contract-state" data-tone="${positive(row.owedWei) || positive(row.heldShareWei) || confirming || needsReview ? "warning" : "neutral"}">${escape(pertinent.label)}${pertinent.value == null ? "" : ` · ${escape(amount(pertinent.value, symbol))}`}</span></td><td><button type="button" class="button button-primary button-small" data-contract-action="review" data-contract-wallet="${escape(row.wallet)}">Review deposits</button></td></tr>`;
      })
      .join("")}</tbody></table>`;
    if (focusedWallet && !dialog.open)
      [...rowsElement.querySelectorAll("[data-contract-wallet]")]
        .find((button) => button.dataset.contractWallet === focusedWallet)
        ?.focus();
  }
  function renderReviewStatus() {
    if (!dialog.open || !reviewAnchor) return;
    const notice = dialogBody.querySelector("[data-contract-review-status]");
    if (!notice) return;
    const stale = !!snapshot?.stale || !!snapshot?.error || !!localError;
    const changed =
      text(snapshot?.indexedBlock?.number) !== text(reviewAnchor.number) ||
      text(snapshot?.indexedBlock?.hash) !== text(reviewAnchor.hash);
    notice.textContent = stale
      ? "Previously observed values are shown. The source is stale or unavailable; close and reopen after refreshing for the latest observations."
      : changed
        ? "Source changed; close and reopen for latest. These values remain from the observed block above."
        : "";
    notice.className = stale ? "contract-error" : "contract-notice";
    notice.hidden = !notice.textContent;
  }
  function render() {
    if (!current()) return;
    element.dataset.contractAccess = stopped ? "denied" : "owner";
    element.dataset.contractActionable = String(
      snapshot?.actionable === true &&
        !snapshot.stale &&
        !snapshot.error &&
        !localError &&
        !loading &&
        !stopped,
    );
    const stale = !!snapshot?.stale || !!snapshot?.error || !!localError;
    const block = snapshot?.indexedBlock?.number;
    find("[data-contract-meta]").textContent = stopped
      ? "Owner access required"
      : readonly && block != null
        ? `Sample snapshot · block ${block}`
        : block != null
          ? `${loading ? "Refreshing · " : ""}${stale ? "Previously observed" : "Indexed"} through block ${block} · ${when(snapshot.lastSyncedAt)}`
          : loading
            ? "Loading deposit observations…"
            : "Deposit index unavailable";
    const warnings = [];
    const error = localError || snapshot?.error?.message;
    if (error)
      warnings.push(
        `<div class="contract-error" role="alert">${escape(error)}${snapshot?.indexedBlock ? " Previously observed deposits remain shown; they are not a fresh balance check." : ""}</div>`,
      );
    else if (snapshot?.stale)
      warnings.push(
        '<p class="contract-notice">Previously observed deposits are shown. Refresh before relying on current credit or allocation amounts.</p>',
      );
    if (readonly)
      warnings.push(
        '<p class="contract-sync-meta">Captured sample · live monitoring disabled.</p>',
      );
    find("[data-contract-notice]").innerHTML = warnings.join("");
    const button = find('[data-contract-action="refresh"]');
    button.disabled = stopped || loading;
    button.textContent = loading
      ? "Refreshing…"
      : readonly
        ? "Reload sample"
        : "Refresh";
    find("[data-contract-controls]").hidden =
      !snapshot?.indexedBlock || stopped;
    element.setAttribute("aria-busy", String(loading));
    renderRows();
    renderReviewStatus();
  }
  async function refresh({ manual = false } = {}) {
    if (!current() || stopped) return;
    if (inFlight) return inFlight;
    loading = true;
    render();
    inFlight = (async () => {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const force = manual && !readonly;
        const value = await request(base + (force ? "/refresh" : ""), {
          method: force ? "POST" : "GET",
          ...(force
            ? {
                body: JSON.stringify({}),
                headers: { "Content-Type": "application/json" },
              }
            : {}),
          signal: controller.signal,
        });
        if (!current() || stopped) return;
        accept(value);
      } catch (error) {
        if (!current() || error.name === "AbortError") return;
        if (authError(error)) {
          revoke();
          return;
        }
        if (error.scopeMismatch) {
          snapshot = null;
          dialogBody.replaceChildren();
          if (dialog.open) dialog.close();
        }
        localError =
          error.message || "Contract deposits could not be refreshed.";
      } finally {
        controllers.delete(controller);
        if (current()) {
          loading = false;
          render();
        }
        inFlight = null;
      }
    })();
    return inFlight;
  }
  function openReview(row, button) {
    if (
      !current() ||
      stopped ||
      [...document.querySelectorAll("dialog[open]")].some(
        (other) => other !== dialog,
      )
    )
      return;
    try {
      options.beforeOpen?.();
    } catch (error) {
      localError = error.message || "Close the other review before continuing.";
      render();
      return;
    }
    if (!current()) return;
    modalVersion++;
    trigger = button;
    triggerWallet = text(row.wallet);
    reviewAnchor = {
      number: snapshot.indexedBlock?.number,
      hash: snapshot.indexedBlock?.hash,
    };
    const exact = (label, value) =>
      `<div><dt>${escape(label)}</dt><dd>${escape(amount(value, symbol))}${value == null ? "" : `<small>${escape(value)} wei</small>`}</dd></div>`;
    const transactions = Array.isArray(row.transactions)
      ? row.transactions
      : [];
    dialogBody.innerHTML = `<div class="contract-source-bar"><h2 id="${id}-dialog-title" tabindex="-1">Wallet deposits</h2><button type="button" class="button button-secondary" data-contract-action="close" aria-label="Close details">Close</button></div><p class="contract-sync-meta">${readonly ? "Sample snapshot" : "Observed"} at block ${escape(reviewAnchor.number)} · ${escape(when(snapshot.lastSyncedAt))}</p><p data-contract-review-status role="status" aria-live="polite" hidden></p>${linked(row) ? `<p><strong>${escape(row.name || "Linked guest")}</strong><br>${escape(row.email)}</p>` : '<p class="contract-link-note">Unlinked wallet. No verified guest name or email is attached to this address.</p>'}<dl class="contract-review-facts"><div><dt>Payer wallet</dt><dd class="contract-review-reference">${escape(row.wallet)} <button type="button" class="button button-secondary button-small" data-contract-action="copy" data-contract-copy-type="wallet" data-contract-copy-value="${escape(row.wallet)}">Copy wallet</button></dd></div>${exact("Historical amount received", row.receivedWei)}${exact("Current unused payer credit", row.pendingCreditWei)}${exact("Current committed principal", row.committedPrincipalWei)}${exact("Held case share", row.heldShareWei)}${exact("Still owed", row.owedWei)}<div><dt>Receipt linkage</dt><dd>${row.receiptLinked === true ? "Receipt linked in the application" : "No application receipt link recorded"}</dd></div><div><dt>Contract registration</dt><dd>${escape(row.registrationState ?? (row.registered === true ? "Registered" : "Not registered"))}</dd></div></dl><details><summary>Payment observations & exact event context</summary><dl class="contract-review-facts">${row.unallocatedWei == null ? "" : exact("Ledger unallocated observation (not payer-owned credit)", row.unallocatedWei)}${exact("Principal / credit returns recorded", row.returnedWei)}${exact("Attendance payments recorded", row.attendancePaidWei)}${exact("Unused credit withdrawals recorded", row.creditWithdrawnWei)}${exact("Claim payments recorded", row.claimsPaidWei)}${row.registrationBasisWei == null ? "" : exact("Historical registration basis", row.registrationBasisWei)}<div><dt>Event</dt><dd>${escape(scope.eventId)}</dd></div><div><dt>Chain</dt><dd>${escape(snapshot.chainId)} · ${escape(symbol)}</dd></div><div><dt>Contract</dt><dd class="contract-review-reference">${escape(snapshot.contract)}</dd></div><div><dt>Version</dt><dd>${escape(snapshot.contractVersion)}</dd></div><div><dt>Indexed block</dt><dd>${escape(snapshot.indexedBlock?.number)} · ${escape(when(snapshot.indexedBlock?.timestamp, true))}<code class="contract-reference">${escape(snapshot.indexedBlock?.hash)}</code></dd></div></dl>${row.pendingCreditWei == null && row.unallocatedWei != null ? '<p class="contract-notice">This version has no payer-owned credit balance. A ledger unallocated observation is separate from unused payer credit and does not establish who can withdraw it.</p>' : ""}</details><p class="contract-notice">These are independent observations. Do not add overlapping amounts together, infer remaining funds from historical deposits, or treat zero credit/principal as proof all payments are complete. Check payment activity for delivery and owed claims.</p><h3>Deposit receipts</h3>${transactions.length ? transactions.map((tx) => `<article><p><span class="contract-state" data-tone="${receiptState(tx).tone}">${receiptState(tx).label}</span> · ${escape(tx.confirmations ?? "Unavailable")} confirmations</p><code class="contract-review-reference">${escape(tx.txHash)}</code><p>${escape(amount(tx.amountWei, symbol))} · block ${escape(tx.blockNumber)} · log ${escape(tx.logIndex)}</p><button type="button" class="button button-secondary button-small" data-contract-action="copy" data-contract-copy-type="transaction" data-contract-copy-value="${escape(tx.txHash)}">Copy transaction ID</button></article>`).join("") : '<p class="contract-empty">No deposit receipt details are available in this snapshot.</p>'}<p class="contract-notice">Confirmed means the server observed the canonical receipt with its confirmation threshold; it is not a guarantee of finality. This index does not show unseen mempool transactions.</p>${linked(row) && options.onOpenLinked ? `<button type="button" class="button button-secondary" data-contract-action="linked" data-contract-wallet="${escape(row.wallet)}">Open linked guest</button>` : ""}<p data-contract-copy-status role="status"></p><div data-contract-copy-fallback></div>`;
    if (!dialog.open) dialog.showModal();
    renderReviewStatus();
    dialogBody.querySelector("h2")?.focus();
  }
  async function onClick(event) {
    const button = event.target?.closest?.("button[data-contract-action]");
    if (!button || !element.contains(button) || button.disabled || !current())
      return;
    const action = button.dataset.contractAction;
    if (action === "close") {
      modalVersion++;
      dialog.close();
      return;
    }
    if (action === "refresh") {
      await refresh({ manual: true });
      return;
    }
    const row = snapshot?.rows.find(
      (item) =>
        text(item.wallet).toLowerCase() ===
        text(button.dataset.contractWallet).toLowerCase(),
    );
    if (action === "review" && row) {
      openReview(row, button);
      return;
    }
    if (action === "linked" && row && linked(row)) {
      const participantId = row.participantId;
      modalVersion++;
      dialog.close();
      if (current()) options.onOpenLinked?.(participantId);
      return;
    }
    if (action === "copy") {
      const value = text(button.dataset.contractCopyValue),
        version = modalVersion;
      if (!dialog.open || !value) return;
      try {
        await navigator.clipboard.writeText(value);
        if (current() && dialog.open && version === modalVersion)
          find("[data-contract-copy-status]").textContent =
            button.dataset.contractCopyType === "wallet"
              ? "Wallet copied."
              : "Transaction ID copied.";
      } catch {
        if (!current() || !dialog.open || version !== modalVersion) return;
        const host = find("[data-contract-copy-fallback]");
        host.innerHTML = `<label for="${id}-copy">Copy the full reference</label><textarea id="${id}-copy" readonly class="contract-reference">${escape(value)}</textarea>`;
        const field = host.querySelector("textarea");
        field.focus();
        field.select();
        find("[data-contract-copy-status]").textContent =
          "Clipboard unavailable. The full reference is selected for manual copy.";
      }
    }
  }
  function onInput(event) {
    if (event.target?.matches?.("[data-contract-search]") && current()) {
      query = event.target.value;
      renderRows();
    }
  }
  function onChange(event) {
    if (event.target?.matches?.("[data-contract-filter]") && current()) {
      filter = event.target.value;
      renderRows();
    }
  }
  function onVisibility() {
    if (document.visibilityState === "visible" && current() && !stopped)
      refresh();
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
      dialogBody.querySelector("h2")?.focus();
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
  dialog.addEventListener("cancel", () => {
    modalVersion++;
  });
  dialog.addEventListener("close", () => {
    if (
      dialog.open ||
      !current() ||
      [...document.querySelectorAll("dialog[open]")].some(
        (other) => other !== dialog,
      )
    )
      return;
    if (trigger?.isConnected) trigger.focus();
    else if (triggerWallet)
      [...element.querySelectorAll('[data-contract-action="review"]')]
        .find((button) => button.dataset.contractWallet === triggerWallet)
        ?.focus();
  });
  element.addEventListener("click", onClick);
  element.addEventListener("input", onInput);
  element.addEventListener("change", onChange);
  document.addEventListener("visibilitychange", onVisibility);
  timer = setInterval(
    () => {
      if (current() && !stopped && document.visibilityState !== "hidden")
        refresh();
    },
    Math.max(15000, Number(options.pollMs) || 30000),
  );
  refresh();
  return { dispose, refresh };
}
