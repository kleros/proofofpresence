const PHASES = Object.freeze({
  preparing: [
    "Preparing your review",
    "Checking the event terms. Your form stays here while the review is prepared.",
    0,
    true,
  ],
  validating: [
    "Checking your review",
    "Rechecking the reviewed transaction before your wallet opens.",
    0,
    true,
  ],
  "wallet-review": [
    "Review in your wallet",
    "Check the open wallet request. A transaction ID appears after your wallet returns one.",
    1,
    true,
  ],
  submitted: [
    "Transaction submitted",
    "Keep this transaction ID while its confirmation is checked.",
    2,
    true,
  ],
  confirmations: [
    "Waiting for confirmation",
    "Checking the original transaction. Confirmation details may take a little time to appear.",
    2,
    true,
  ],
  "portal-verification": [
    "Checking your event page",
    "Verifying the event page before its deposit link can be shared.",
    3,
    true,
  ],
  ready: [
    "Your event page is ready",
    "Share the deposit link with your guests.",
    3,
    false,
  ],
  cancelled: [
    "Wallet request cancelled",
    "The wallet request was cancelled. Review the current setup before trying again.",
    1,
    false,
  ],
  reverted: [
    "Transaction reverted",
    "The transaction did not succeed. Keep its transaction ID while you review what happened.",
    2,
    false,
  ],
  "verification-failed": [
    "Your event page needs checking",
    "Keep the transaction ID and check the current status before continuing.",
    3,
    false,
  ],
  unavailable: [
    "Setup status is unavailable",
    "Check the current status before continuing.",
    -1,
    false,
  ],
});
let nextId = 0;
const text = (value, max = 2000) =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : null;
const hash = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-f]{64}$/i.test(value) &&
  !/^0x0{64}$/i.test(value)
    ? value
    : null;
function eventLink(value, id, view, origin) {
  if (!text(value)) return null;
  try {
    const url = new URL(value, origin + "/"),
      params = new URLSearchParams(url.hash.slice(1));
    return url.origin === origin &&
      url.pathname === "/" &&
      !url.search &&
      !url.username &&
      !url.password &&
      [...params.keys()].length === 2 &&
      params.getAll("event").length === 1 &&
      params.getAll("view").length === 1 &&
      params.get("event") === id &&
      params.get("view") === view
      ? `${origin}/#${new URLSearchParams({ event: id, view })}`
      : null;
  } catch {
    return null;
  }
}
function normalize(value, origin) {
  const known = value && Object.hasOwn(PHASES, value.phase);
  let phase = known ? value.phase : "unavailable";
  const confirmed = value?.transactionConfirmed === true;
  let event = null;
  if (phase === "ready") {
    const candidate = value.event;
    const id =
      typeof candidate?.id === "string" &&
      /^[A-Za-z0-9_-]{1,200}$/.test(candidate.id)
        ? candidate.id
        : null;
    const depositUrl =
      id && eventLink(candidate.depositUrl, id, "participant", origin);
    const manageUrl =
      id && eventLink(candidate.manageUrl, id, "organizer", origin);
    if (candidate?.verified === true && confirmed && depositUrl && manageUrl)
      event = Object.freeze({ id, depositUrl, manageUrl });
    else phase = "verification-failed";
  }
  return Object.freeze({
    phase,
    confirmed,
    event,
    hash: hash(value?.hash),
    chainId:
      Number.isSafeInteger(value?.chainId) && value.chainId > 0
        ? value.chainId
        : null,
    confirmations:
      Number.isSafeInteger(value?.confirmations) && value.confirmations >= 0
        ? value.confirmations
        : null,
    requiredConfirmations:
      Number.isSafeInteger(value?.requiredConfirmations) &&
      value.requiredConfirmations > 0
        ? value.requiredConfirmations
        : null,
    message: known && phase === value.phase ? text(value.message) : null,
    reasonCode: text(value?.reasonCode, 100),
  });
}

/** Display-only. The caller owns authentication, receipt checks, polling and all transactions.
 * onCopy receives the current full hash; onCheck receives {hash, chainId} on a user click only.
 */
export function mountSetupProgress(host, options) {
  if (typeof options?.isCurrent !== "function")
    throw TypeError("A current-context guard is required.");
  const id = `setup-progress-${++nextId}`;
  let alive = true,
    revision = 0,
    state = null;
  const $ = (selector) => host.querySelector(selector);
  const current = () => {
    let valid = false;
    try {
      valid = alive && host.isConnected && options.isCurrent() === true;
    } catch {}
    if (!valid && alive) {
      alive = false;
      host.replaceChildren();
    }
    return valid;
  };
  const write = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };
  if (current())
    host.innerHTML = `<section class="setup-progress" data-setup-progress aria-labelledby="${id}-title"><div class="eyebrow">EVENT SETUP</div><h2 id="${id}-title" data-setup-progress-title></h2><p id="${id}-status" data-setup-progress-status role="status" aria-live="polite" aria-atomic="true"></p><div data-setup-progress-visual aria-busy="false"><ol class="setup-progress-steps" aria-label="Event setup progress">${["Review", "Wallet", "Confirm", "Event page"].map((label, index) => `<li data-setup-progress-step="${index}"><span aria-hidden="true">${index + 1}</span>${label}</li>`).join("")}</ol></div><div class="setup-progress-transaction" data-setup-progress-transaction hidden><p data-setup-progress-transaction-state></p><label for="${id}-hash">Transaction ID</label><input id="${id}-hash" class="mono" data-setup-progress-hash readonly spellcheck="false" aria-describedby="${id}-status"><div class="setup-progress-actions"><button type="button" class="button button-secondary" data-setup-progress-action="copy" hidden>Copy transaction ID</button><a class="button button-quiet" data-setup-progress-explorer target="_blank" rel="noopener noreferrer" hidden>View transaction</a><button type="button" class="button button-secondary" data-setup-progress-action="check" hidden>Check status</button></div></div><div class="setup-progress-share" data-setup-progress-share hidden><label for="${id}-link">Event deposit link</label><input id="${id}-link" data-setup-progress-deposit-url readonly><div class="setup-progress-actions"><a class="button button-primary" data-setup-progress-deposit>Open deposit page</a><a class="button button-secondary" data-setup-progress-manage>Manage event</a></div></div><small class="setup-progress-reference" data-setup-progress-reason hidden></small></section>`;
  const update = (value) => {
    if (!current()) return;
    revision++;
    state = normalize(value, host.ownerDocument.location.origin);
    const [title, message, step, busy] = PHASES[state.phase];
    const root = $("[data-setup-progress]");
    root.dataset.setupPhase = state.phase;
    root.dataset.tone = [
      "cancelled",
      "reverted",
      "verification-failed",
      "unavailable",
    ].includes(state.phase)
      ? "attention"
      : "normal";
    write($("[data-setup-progress-title]"), title);
    let status = state.message || message;
    if (["submitted", "confirmations"].includes(state.phase))
      status +=
        state.confirmations === null
          ? " Confirmation count is not available yet."
          : state.requiredConfirmations === null
            ? ` ${state.confirmations} confirmations reported; the required count is not available.`
            : ` ${state.confirmations} of ${state.requiredConfirmations} confirmations reported.`;
    write($("[data-setup-progress-status]"), status);
    $("[data-setup-progress-visual]").setAttribute("aria-busy", String(busy));
    for (const node of host.querySelectorAll("[data-setup-progress-step]")) {
      if (Number(node.dataset.setupProgressStep) === step)
        node.setAttribute("aria-current", "step");
      else node.removeAttribute("aria-current");
    }
    $("[data-setup-progress-transaction]").hidden = !state.hash;
    const hashInput = $("[data-setup-progress-hash]");
    if (hashInput.value !== (state.hash || ""))
      hashInput.value = state.hash || "";
    write(
      $("[data-setup-progress-transaction-state]"),
      state.phase === "reverted"
        ? "Transaction reverted."
        : state.confirmed
          ? state.phase === "ready"
            ? "Transaction confirmed. Event page verified."
            : "Transaction confirmed. Event page verification is separate."
          : "Transaction confirmation has not been reported.",
    );
    $("[data-setup-progress-action=copy]").hidden =
      !state.hash || typeof options.onCopy !== "function";
    $("[data-setup-progress-action=check]").hidden =
      !state.hash ||
      state.phase === "ready" ||
      typeof options.onCheck !== "function";
    const explorer = $("[data-setup-progress-explorer]");
    explorer.hidden = !state.hash || state.chainId !== 1;
    if (!explorer.hidden)
      explorer.href = `https://etherscan.io/tx/${state.hash}`;
    else explorer.removeAttribute("href");
    $("[data-setup-progress-share]").hidden = !state.event;
    const depositInput = $("[data-setup-progress-deposit-url]");
    if (depositInput.value !== (state.event?.depositUrl || ""))
      depositInput.value = state.event?.depositUrl || "";
    for (const [selector, link] of [
      ["[data-setup-progress-deposit]", state.event?.depositUrl],
      ["[data-setup-progress-manage]", state.event?.manageUrl],
    ]) {
      if (link) $(selector).href = link;
      else $(selector).removeAttribute("href");
    }
    $("[data-setup-progress-reason]").hidden = !state.reasonCode;
    write(
      $("[data-setup-progress-reason]"),
      state.reasonCode ? `Reference: ${state.reasonCode}` : "",
    );
  };
  const click = (event) => {
    if (!current() || !state?.hash || !(event.target instanceof Element))
      return;
    const action = event.target.closest("[data-setup-progress-action]")?.dataset
      .setupProgressAction;
    const callback =
      action === "copy"
        ? options.onCopy
        : action === "check" && state.phase !== "ready"
          ? options.onCheck
          : null;
    if (typeof callback !== "function") return;
    const captured = revision;
    try {
      Promise.resolve(
        callback(
          action === "copy"
            ? state.hash
            : Object.freeze({ hash: state.hash, chainId: state.chainId }),
        ),
      ).catch(() => {
        if (current() && revision === captured)
          write(
            $("[data-setup-progress-status]"),
            "That action could not be completed. Select the transaction ID above or check its status again.",
          );
      });
    } catch {
      if (current() && revision === captured)
        write(
          $("[data-setup-progress-status]"),
          "That action could not be completed. Select the transaction ID above or check its status again.",
        );
    }
  };
  host.addEventListener("click", click);
  return {
    update,
    dispose() {
      alive = false;
      revision++;
      host.removeEventListener("click", click);
      host.replaceChildren();
    },
  };
}
