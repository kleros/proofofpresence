import {
  createTransactionJournal,
  submitWalletDraft,
} from "./transaction-context.js";
import {
  factorySetupIssue,
  factoryReadScope,
  creationContext,
  assertCreationDraft,
  assertCreationValidation,
  assertCreationReceipt,
  lumaEventUrl,
  depositWei,
} from "./luma-factory.js";
import { attendanceStandardText } from "./luma-launch.js";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const hashPattern = /^0x[0-9a-f]{64}$/i;
const stableId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const markerKey = (scope) =>
  "kleros-factory-creation:v1:" +
  [
    scope.instanceId,
    scope.mode,
    scope.chainId,
    scope.contract.toLowerCase(),
    scope.wallet.toLowerCase(),
    scope.abiVersion,
  ]
    .map(encodeURIComponent)
    .join(":");
const post = (data) => ({ method: "POST", body: JSON.stringify(data) });
const date = (seconds) =>
  new Date(seconds * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");

/** A compact factory workflow. Mounting reads local recovery data only, never the wallet. */
export function mountLumaSetup(host, options) {
  const bootstrap = options.bootstrap;
  let alive = true,
    busy = false,
    reviewed = null,
    dialog = null,
    marker = null,
    terminalAdopted = false;
  let scope,
    storage,
    journal,
    key,
    storageIssue = null;
  const current = () =>
    alive && host.isConnected && options.isCurrent?.() !== false;
  const authenticated =
    bootstrap?.session?.mode === "wallet" &&
    typeof bootstrap.session.wallet === "string";
  const readyIssue = factorySetupIssue(bootstrap, { requireWallet: true });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  // Discover only this wallet's exact factory/profile on this origin. An uncertain
  // send belongs to its original instance even after the server has restarted.
  const discoverRecovery = () => {
    const freshScope = factoryReadScope(bootstrap);
    scope = freshScope;
    key = markerKey(freshScope);
    marker = null;
    const count = storage.length;
    if (!Number.isSafeInteger(count) || count > 4096)
      throw Error(
        "Too many local recovery records to verify safely. Preserve transaction storage and reconcile existing event creations before continuing.",
      );
    const candidates = [];
    const prefix = "kleros-factory-creation:v1:";
    for (let index = 0; index < count; index++) {
      const candidateKey = storage.key(index);
      if (!candidateKey?.startsWith(prefix)) continue;
      let parts;
      try {
        parts = candidateKey
          .slice(prefix.length)
          .split(":")
          .map(decodeURIComponent);
      } catch {
        continue;
      }
      if (parts.length !== 6) continue;
      const [instanceId, mode, chainId, contract, wallet, abiVersion] = parts;
      if (
        mode !== freshScope.mode ||
        chainId !== String(freshScope.chainId) ||
        !same(contract, freshScope.contract) ||
        !same(wallet, freshScope.wallet) ||
        abiVersion !== freshScope.abiVersion
      )
        continue;
      if (
        !instanceId ||
        instanceId.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(instanceId)
      )
        throw Error(
          "A matching factory recovery record has an invalid instance. Preserve browser storage before continuing.",
        );
      candidates.push({
        key: candidateKey,
        scope: { ...freshScope, instanceId },
      });
    }
    candidates.sort((a, b) => Number(b.key === key) - Number(a.key === key));
    for (const candidate of candidates) {
      const raw = storage.getItem(candidate.key);
      if (raw === null) continue;
      let found;
      try {
        found = JSON.parse(raw);
      } catch {
        /* Fail closed below. */
      }
      if (
        found?.version !== 1 ||
        !stableId(found.draftId) ||
        !stableId(found.eventId) ||
        ![
          "prepared",
          "wallet-requested",
          "submitted",
          "confirmed",
          "failed",
        ].includes(found.phase) ||
        (found.hash !== undefined && !hashPattern.test(found.hash))
      )
        throw Error(
          "The event creation recovery record is unreadable. Preserve browser storage and reconcile the original transaction before creating another event.",
        );
      const known = journal
        .list({ ...candidate.scope, eventId: found.eventId })
        .find((entry) => entry.draftId === found.draftId);
      if (known)
        found = {
          ...found,
          hash: known.hash,
          phase:
            known.status === "confirmed"
              ? "confirmed"
              : known.status === "failed"
                ? "failed"
                : "submitted",
        };
      // The marker is persisted before sending. A purely prepared record has
      // never reached the wallet; it can be replaced by a new current review.
      if (found.phase === "prepared" && !found.hash) continue;
      marker = found;
      scope = Object.freeze(candidate.scope);
      key = candidate.key;
      break;
    }
  };
  try {
    if (authenticated) {
      storage = host.ownerDocument.defaultView.localStorage;
      journal = createTransactionJournal(storage);
      discoverRecovery();
    }
  } catch (error) {
    storageIssue = error.message;
  }
  const persist = (next) => {
    if (!storage || !key)
      throw Error(
        "Durable transaction storage is required before opening your wallet.",
      );
    const serialized = JSON.stringify(next);
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized)
      throw Error(
        "The browser did not retain the event transaction recovery record.",
      );
    marker = next;
  };
  const clearUnsigned = () => {
    if (marker?.phase !== "prepared") return;
    storage.removeItem(key);
    marker = null;
  };
  const status = (message) => {
    if (!current()) return;
    const node = host.querySelector("[data-luma-status]");
    if (node) node.textContent = message;
  };
  const error = (message) => {
    if (!current()) return;
    const node = host.querySelector("[data-luma-error]");
    if (node) {
      node.textContent = message;
      node.hidden = !message;
    }
  };
  const request = (suffix, data) =>
    options.request(
      "/api/organizer/events/drafts" + suffix,
      data === undefined ? {} : post(data),
    );
  const path = (id) => "/" + encodeURIComponent(id);
  const lock = (value) => {
    busy = value;
    if (!current()) return;
    for (const button of host.querySelectorAll("[data-luma-action]"))
      button.disabled = value;
    if (dialog)
      for (const button of dialog.querySelectorAll("button"))
        button.disabled = value;
  };
  const closeDialog = () => {
    if (!dialog) return;
    if (dialog.open) dialog.close();
    dialog.remove();
    dialog = null;
  };
  const renderRecovery = () => {
    if (!current()) return;
    closeDialog();
    const terminal = marker.phase === "failed";
    host.innerHTML = `<section class="luma-setup"><div class="eyebrow">KICKBACK SETUP</div><h1>${terminal ? "Event creation failed" : "Check your event transaction"}</h1><div class="luma-setup-recovery" data-luma-recovery><p>${terminal ? "The canonical receipt shows that this transaction failed. No deposit link has been created." : marker.hash ? "Your wallet returned a transaction ID. Check its canonical receipt before creating another event." : "A wallet request may still be pending. Check your wallet activity before continuing. This page will not send that request again."}</p>${scope.instanceId !== bootstrap.instanceId ? "<p>This request belongs to an earlier server instance. Only its original receipt can be checked here.</p>" : ""}${marker.hash ? `<code class="mono" data-luma-hash>${escape(marker.hash)}</code>` : '<label for="luma-recovery-hash">Transaction ID from your wallet</label><input id="luma-recovery-hash" name="txHash" autocomplete="off" spellcheck="false" placeholder="0x…" />'}<div class="luma-setup-actions"><button class="button button-primary" data-luma-action="reconcile">Check transaction</button>${terminal && terminalAdopted ? '<button class="button button-secondary" data-luma-action="new">Set up another event</button>' : ""}</div></div><p data-luma-status role="status" aria-live="polite"></p><p class="luma-setup-error" data-luma-error role="alert" hidden></p></section>`;
  };
  const renderShare = (result) => {
    if (!current()) return;
    terminalAdopted = true;
    closeDialog();
    host.innerHTML = `<section class="luma-setup"><div class="eyebrow">EVENT CREATED</div><h1>Your deposit page is ready.</h1><p>Share this event-specific link in your Luma registration. Guests can connect their wallet, deposit, and copy their transaction ID.</p><section class="luma-setup-share" data-luma-created><h2>Share the deposit link</h2><label for="luma-created-link">Event deposit page</label><input id="luma-created-link" data-luma-deposit-link readonly value="${escape(result.participantUrl)}" /><div class="luma-setup-actions"><button class="button button-primary" data-luma-action="copy-link">Copy deposit link</button><a class="button button-secondary" href="${escape(result.participantUrl)}">Open deposit page</a><button class="button button-quiet" data-luma-action="new">Set up another event</button></div><details><summary>Confirmed transaction</summary><dl class="luma-setup-terms"><dt>Transaction ID</dt><dd><code data-luma-hash>${escape(result.hash)}</code></dd><dt>Event contract</dt><dd><code>${escape(result.contract)}</code></dd><dt>Network</dt><dd>Ethereum Mainnet · Chain 1</dd><dt>Confirmed block</dt><dd>${escape(result.blockNumber)}</dd></dl></details></section><p data-luma-status role="status" aria-live="polite">Event creation confirmed.</p><p class="luma-setup-error" data-luma-error role="alert" hidden></p></section>`;
    options.onComplete?.(result);
  };
  const renderForm = () => {
    if (!current()) return;
    if (storageIssue) {
      host.innerHTML = `<section class="luma-setup"><h1>Set up kickback</h1><p class="luma-setup-error" data-luma-setup-issue role="alert">${escape(storageIssue)}</p></section>`;
      return;
    }
    if (marker) {
      renderRecovery();
      return;
    }
    const issue = authenticated ? readyIssue : factorySetupIssue(bootstrap);
    const standard = attendanceStandardText(
      bootstrap.organizerSetup?.attendanceStandard,
    );
    host.innerHTML = `<section class="luma-setup"><div class="eyebrow">FOR LUMA ORGANIZERS</div><h1>Set up kickback.</h1><p>Create one deposit page for your Luma event. Review the fixed terms before your wallet opens.</p>${issue ? `<p class="luma-setup-notice" data-luma-setup-issue>${escape(issue)}</p>` : ""}${standard ? `<p class="luma-setup-notice" data-luma-attendance-standard>${escape(standard)}</p>` : ""}${!authenticated ? '<div class="luma-launch-card"><h2>Connect your organizer wallet</h2><p>Use the wallet that will manage this event.</p><button class="button button-primary" data-connect-wallet>Connect wallet</button></div>' : `<form class="luma-setup-form" data-luma-form><div class="full"><label for="luma-title">Event title</label><input id="luma-title" name="title" required maxlength="120" autocomplete="off" /></div><div class="full"><label for="luma-url">Luma event URL</label><input id="luma-url" name="lumaUrl" type="url" required placeholder="https://luma.com/your-event" /><p class="field-help">Registration stays on Luma. No guest names or emails are imported.</p></div><div><label for="luma-start">Starts · your local time</label><input id="luma-start" name="startsAt" type="datetime-local" required /></div><div><label for="luma-end">Ends · your local time</label><input id="luma-end" name="endsAt" type="datetime-local" required /></div><div><label for="luma-timezone">Your time zone</label><input id="luma-timezone" name="timezone" readonly value="${escape(timezone)}" /></div><div><label for="luma-deposit">Deposit per guest · ETH</label><input id="luma-deposit" name="depositEth" required inputmode="decimal" placeholder="0.01" autocomplete="off" /></div><p class="luma-setup-capacity full">Fixed capacity: <strong>150 guests</strong> · Claim period: <strong>7 days</strong> · Challenge and response windows: <strong>1 day each</strong></p><div class="luma-setup-actions"><button class="button button-primary" data-luma-action="review" ${readyIssue ? "disabled" : ""}>Review event setup</button></div></form>`}<p data-luma-status role="status" aria-live="polite"></p><p class="luma-setup-error" data-luma-error role="alert" hidden></p></section>`;
  };
  const formInput = (form) => {
    const values = new FormData(form),
      title = String(values.get("title") ?? "").trim();
    const lumaUrl = lumaEventUrl(String(values.get("lumaUrl") ?? ""));
    if (!title || !lumaUrl)
      throw Error(
        "Enter an event title and a valid https://luma.com event URL without query parameters.",
      );
    const parseLocal = (name) => {
      const value = String(values.get(name) ?? ""),
        parsed = new Date(value);
      const local = Number.isFinite(parsed.valueOf())
        ? new Date(parsed.valueOf() - parsed.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : "";
      if (local !== value)
        throw Error(
          "Choose a valid local date and time. A daylight-saving time gap cannot be used.",
        );
      return parsed.toISOString();
    };
    const startsAt = parseLocal("startsAt"),
      endsAt = parseLocal("endsAt");
    if (
      Date.parse(startsAt) <= Date.now() ||
      Date.parse(endsAt) <= Date.parse(startsAt)
    )
      throw Error(
        "The event must start in the future and end after it starts.",
      );
    const depositEth = String(values.get("depositEth") ?? "").trim();
    depositWei(depositEth);
    return { title, lumaUrl, startsAt, endsAt, timezone, depositEth };
  };
  const openReview = (draft) => {
    options.beforeOpen?.();
    if (!current()) return;
    if (host.ownerDocument.querySelector("dialog[open]"))
      throw Error("Close the current review before opening event setup.");
    const terms = draft.terms;
    dialog = host.ownerDocument.createElement("dialog");
    dialog.className = "luma-setup-review";
    dialog.setAttribute("data-luma-dialog", "");
    dialog.setAttribute("aria-labelledby", "luma-review-title");
    dialog.innerHTML = `<header><h2 id="luma-review-title" tabindex="-1">Review event setup</h2><button type="button" class="button button-quiet" data-luma-action="close">Close</button></header><p>These event terms are fixed when this transaction confirms.</p><dl class="luma-setup-terms"><dt>Event</dt><dd>${escape(terms.title)}</dd><dt>Luma registration</dt><dd>${escape(terms.lumaUrl)}</dd><dt>Starts</dt><dd>${escape(date(terms.eventStart))}<small>${escape(terms.timezone)}</small></dd><dt>Ends</dt><dd>${escape(new Date(terms.endsAt).toISOString())}</dd><dt>Deposit per guest</dt><dd>${escape(terms.depositEth)} ETH<small>${escape(terms.depositWei)} wei</small></dd><dt>Capacity</dt><dd>150 guests</dd><dt>Claim deadline</dt><dd>${escape(date(terms.claimDeadline))} · 7 days</dd><dt>Challenge / response</dt><dd>1 day each</dd><dt>Attendance standard</dt><dd data-luma-review-attendance-standard>${escape(attendanceStandardText(terms.attendanceStandard))}</dd><dt>Network</dt><dd>Ethereum Mainnet · Chain 1</dd><dt>Organizer wallet</dt><dd><code>${escape(draft.wallet)}</code></dd><dt>Factory recipient</dt><dd><code>${escape(draft.contract)}</code></dd><dt>Transaction value</dt><dd>0 ETH · wallet estimates network fees</dd><dt>Gas estimate</dt><dd>${escape(draft.transaction.gasLimit)} gas · not a fixed fee</dd><dt>Policy</dt><dd>${escape(terms.policyURI)}<small><code>${escape(terms.policySha256)}</code></small></dd><dt>Review block / expiry</dt><dd>${escape(draft.reviewBlock)} · ${escape(new Date(draft.expiresAt).toISOString())}</dd></dl><p class="luma-setup-notice">The upgrade owner can change contract logic after the 48-hour timelock. Ownership transfers require acceptance; this delay does not guarantee withdrawals.</p><p data-luma-dialog-status role="status"></p><div class="luma-setup-actions"><button type="button" class="button button-primary" data-luma-action="confirm">Create event in wallet</button></div>`;
    host.append(dialog);
    dialog.addEventListener("cancel", (event) => {
      if (busy) event.preventDefault();
    });
    dialog.addEventListener("close", () => {
      if (!busy && current())
        host.querySelector('[data-luma-action="review"]')?.focus();
    });
    dialog.showModal();
    dialog.querySelector("h2").focus();
  };
  const prepare = async (form) => {
    if (busy || !current() || marker) return;
    error("");
    lock(true);
    try {
      if (readyIssue) throw Error(readyIssue);
      journal.probe();
      const input = formInput(form);
      status("Preparing your immutable event review…");
      const draft = await request("", input);
      if (!current()) return;
      reviewed = assertCreationDraft(draft, bootstrap, input);
      openReview(reviewed);
      status("Review the event terms before opening your wallet.");
    } catch (cause) {
      error(cause.message);
      status("Event setup has not been submitted.");
    } finally {
      lock(false);
    }
  };
  const send = async () => {
    if (busy || !reviewed || marker || !current()) return;
    const draft = assertCreationDraft(reviewed, bootstrap),
      context = creationContext(bootstrap, draft);
    error("");
    lock(true);
    try {
      persist({
        version: 1,
        draftId: draft.id,
        eventId: draft.eventId,
        phase: "prepared",
      });
      const rawProvider = options.provider?.();
      if (!rawProvider?.request)
        throw Error(
          "Connect your authenticated organizer wallet before continuing.",
        );
      const provider = {
        request: async (payload) => {
          if (payload.method === "eth_sendTransaction") {
            if (!current())
              throw Error(
                "The authenticated setup context changed. No wallet request was made.",
              );
            persist({ ...marker, phase: "wallet-requested" });
          }
          return rawProvider.request(payload);
        },
      };
      dialog.querySelector("[data-luma-dialog-status]").textContent =
        "Confirm the reviewed event creation in your wallet.";
      const result = await submitWalletDraft({
        draft,
        context,
        provider,
        journal,
        isCurrentContext: () => current(),
        validate: async () =>
          assertCreationValidation(
            await request(path(draft.id) + "/validate", {}),
            draft,
            bootstrap,
          ),
        recordSubmitted: async (_event, _id, hash) => {
          persist({ ...marker, hash, phase: "submitted" });
          await request(path(draft.id) + "/submitted", { hash });
        },
        confirm: async (_event, _id, hash) =>
          assertCreationReceipt(
            await request(path(draft.id) + "/reconcile", { hash }),
            context,
            hash,
            host.ownerDocument.location.origin,
          ),
      });
      persist({ ...marker, hash: result.hash, phase: "confirmed" });
      renderShare(result);
    } catch (cause) {
      if (cause.submittedHash) {
        if (cause.code === "TRANSACTION_REVERTED") terminalAdopted = true;
        try {
          persist({
            ...marker,
            hash: cause.submittedHash,
            phase:
              cause.code === "TRANSACTION_REVERTED" ? "failed" : "submitted",
          });
        } catch {
          /* Full hash remains in the sender journal and error. */
        }
      } else if (
        marker?.phase === "prepared" ||
        cause.code === 4001 ||
        cause.code === "ACTION_REJECTED"
      ) {
        try {
          if (marker) {
            marker = { ...marker, phase: "prepared" };
            clearUnsigned();
          }
        } catch {
          /* Keep the recovery record if cleanup fails. */
        }
      }
      if (marker) renderRecovery();
      error(
        cause.message +
          (cause.submittedHash
            ? " Transaction ID: " + cause.submittedHash
            : ""),
      );
      if (!marker && current())
        status(
          "No transaction ID was returned. Review and try again only if your wallet rejected the request.",
        );
    } finally {
      lock(false);
    }
  };
  const reconcile = async () => {
    if (busy || !marker || !current() || !scope) return;
    error("");
    lock(true);
    try {
      const hash =
        marker.hash || host.querySelector('[name="txHash"]')?.value?.trim();
      if (!hashPattern.test(hash ?? ""))
        throw Error(
          "Enter the complete transaction ID from the original wallet request.",
        );
      const context = { ...scope, eventId: marker.eventId };
      journal.probe();
      const walletReturnedHash = Boolean(marker.hash);
      // A manually typed candidate has no authority until the backend proves its
      // canonical terminal receipt. Do not poison this draft's once-only journal
      // with a typo, foreign hash, or unproven pending transaction.
      if (walletReturnedHash)
        journal.record(context, {
          hash,
          draftId: marker.draftId,
          action: "createEvent",
        });
      status("Checking the canonical event creation receipt…");
      const result = assertCreationReceipt(
        await request(path(marker.draftId) + "/reconcile", { hash }),
        context,
        hash,
        host.ownerDocument.location.origin,
      );
      if (result.status === "pending") {
        if (walletReturnedHash)
          journal.update(context, hash, { status: "needs-confirmation" });
        status(
          walletReturnedHash
            ? "The transaction is pending or onboarding is not yet confirmed. Check again later."
            : "This candidate has no verified terminal receipt yet. Check your wallet transaction ID and try again; no new transaction will be sent.",
        );
        return;
      }
      journal.record(context, {
        hash,
        draftId: marker.draftId,
        action: "createEvent",
      });
      journal.update(context, hash, {
        status: result.status,
        blockNumber: result.blockNumber,
        error: null,
      });
      persist({ ...marker, hash, phase: result.status });
      terminalAdopted = true;
      if (result.status === "confirmed") renderShare(result);
      else renderRecovery();
    } catch (cause) {
      error(cause.message);
    } finally {
      lock(false);
    }
  };
  const onSubmit = (event) => {
    const form = event.target.closest("[data-luma-form]");
    if (!form) return;
    event.preventDefault();
    void prepare(form);
  };
  const onClick = async (event) => {
    const action =
      event.target.closest("[data-luma-action]")?.dataset.lumaAction;
    if (!action || busy || !current()) return;
    if (action === "close") {
      closeDialog();
      return;
    }
    if (action === "confirm") {
      try {
        await send();
      } catch (cause) {
        error(cause.message);
      }
      return;
    }
    if (action === "reconcile") {
      await reconcile();
      return;
    }
    if (
      action === "new" &&
      terminalAdopted &&
      ["confirmed", "failed"].includes(marker?.phase)
    ) {
      try {
        storage.removeItem(key);
        marker = null;
        terminalAdopted = false;
        reviewed = null;
        discoverRecovery();
        renderForm();
      } catch (cause) {
        error(cause.message);
      }
      return;
    }
    if (action === "copy-link") {
      const input = host.querySelector("[data-luma-deposit-link]");
      try {
        await host.ownerDocument.defaultView.navigator.clipboard.writeText(
          input.value,
        );
        status("Deposit link copied. Add it to your Luma registration.");
      } catch {
        input.focus();
        input.select();
        status("Select and copy the deposit link above.");
      }
    }
  };
  host.addEventListener("submit", onSubmit);
  host.addEventListener("click", onClick);
  renderForm();
  return {
    dispose() {
      alive = false;
      closeDialog();
      host.removeEventListener("submit", onSubmit);
      host.removeEventListener("click", onClick);
      host.replaceChildren();
    },
  };
}
