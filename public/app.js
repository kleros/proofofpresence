// @ts-check
import { focusMain, trapDialogTab } from "./ui-keyboard.js";
import { selectedEventResult } from "./selected-event.js";
import { analyzeImport } from "./reconciliation.js";
import { assertDemoChainInstance } from "./hosted-wallet.js";
import { mountContractInbox } from "./contract-inbox.js";
import { mountBatchActions } from "./batch-actions.js";
import { createBatchPendingJournal } from "./batch-pending.js";
import {
  publicEventSearchEntries,
  searchPublicEvents,
  validatePublicCatalog,
} from "./event-search.js";
import {
  lumaReturnUrl,
  launchWei,
  participantDeposit,
  knownAttendanceStandard,
  attendanceStandardText,
} from "./luma-launch.js";
import { mountLumaSetup } from "./luma-setup.js";
import {
  validateCaseArtifact,
  publicationActions,
} from "./case-publication.js";
import {
  isProductionMode,
  isSandboxMode,
  isV9TestnetMode,
  productionContextIssue,
  v9TestnetContextIssue,
} from "./environment.js";
import {
  contractProfileForEvent,
  hasV8FinancialInterface,
  isTest15mVersion,
} from "./contract-profiles.js";
import {
  createTransactionJournal,
  submitWalletDraft,
} from "./transaction-context.js";
let transactionJournal;
try {
  transactionJournal = createTransactionJournal(localStorage);
} catch {
  transactionJournal = null;
}
/** @param {string} selector @param {ParentNode} [parent] @returns {any} DOM selectors have element types determined by their HTML IDs. */
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [
  ...parent.querySelectorAll(selector),
];
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const short = (value) =>
  value ? `${String(value).slice(0, 7)}…${String(value).slice(-5)}` : "—";
const same = (a, b) =>
  a && b && String(a).toLowerCase() === String(b).toLowerCase();
const addressList = (value) =>
  String(value ?? "")
    .split(/[\s,;]+/)
    .filter(Boolean);
const eth = (value) => {
  try {
    const n = BigInt(value ?? 0);
    const w = n / 1000000000000000000n;
    const fraction = (n % 1000000000000000000n)
      .toString()
      .padStart(18, "0")
      .replace(/0+$/, "");
    return `${w}${fraction ? `.${fraction}` : ""}`;
  } catch {
    return "—";
  }
};
const toWei = (value) => {
  if (!/^\d+(\.\d{1,18})?$/.test(value))
    throw new Error("Enter a token amount with at most 18 decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return String(
    BigInt(whole) * 1000000000000000000n + BigInt(fraction.padEnd(18, "0")),
  );
};
const formatDate = (value, timezone, options = {}) => {
  if (!value) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: timezone ?? "UTC",
      ...options,
    }).format(
      new Date(
        typeof value === "number"
          ? value > 1e12
            ? value
            : value * 1000
          : value,
      ),
    );
  } catch {
    return String(value);
  }
};
const formatTime = (value, timezone) =>
  formatDate(value, timezone, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
const formatDeadline = (value, timezone) =>
  formatDate(value, timezone, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
const badge = (text, style = "") =>
  `<span class="badge ${style}">${escape(text)}</span>`;
const phaseName = (value) =>
  typeof value === "number"
    ? (["Open", "Listed", "Finalized", "Cancelled"][value] ?? String(value))
    : String(value ?? "Unknown");
const phaseStyle = (value) =>
  ({ Open: "green", Listed: "amber", Finalized: "purple", Cancelled: "red" })[
    phaseName(value)
  ] ?? "";
const actionNames = {
  deposit: "Reserve with a deposit",
  withdrawPending: "Withdraw unused deposit credit",
  register: "Register verified stakers",
  reject: "Reject and refund",
  postAttendance: "Post attendance list",
  challenge: "Challenge an omission",
  match: "Match attendance challenge",
  addAttendees: "Correct attendance",
  resolve: "Settle final ruling",
  release: "Send kickbacks",
  cancel: "Cancel event",
  emergencyWithdraw: "Emergency withdrawal",
  claim: "Claim failed transfer",
  refund: "Return unmatched funds",
  sweep: "Return spare funds",
  transferOwnership: "Start ownership transfer",
  acceptOwnership: "Accept ownership",
  passPeriod: "Advance expired appeal period",
  deliverRuling: "Deliver final Court ruling",
  evidence: "Submit evidence",
  fundAppeal: "Contribute to appeal",
  appealRewards: "Claim appeal rewards",
};
const app = {
  bootstrap: null,
  detail: null,
  route: { eventId: null, view: "participant" },
  generation: 0,
  draft: null,
  draftParams: null,
  submittedRecovery: null,
  busy: false,
  importReview: null,
  pending: [],
  pendingInstanceId: null,
  csvReadToken: 0,
  unsignedReviewVersion: 0,
  batchRegistrationSelection: null,
};
let batchPendingJournal;
try {
  batchPendingJournal = createBatchPendingJournal(localStorage, {
    origin: location.origin,
  });
} catch {
  const unavailable = () => {
    throw new Error(
      "Durable batch recovery storage is unavailable. Saving is locked.",
    );
  };
  batchPendingJournal = {
    load: unavailable,
    save: unavailable,
    remove: unavailable,
  };
}
const batchControllers = new Map();
const batchFilterRevisions = { "approve-admission": 0, "check-in": 0 };
function disposeBatchActions(action) {
  if (action) {
    batchControllers.get(action)?.dispose();
    batchControllers.delete(action);
  } else {
    for (const controller of batchControllers.values()) controller.dispose();
    batchControllers.clear();
  }
}
function batchActionsEnabled(action) {
  return (
    app.bootstrap?.capabilities?.batchActions === true &&
    isV8() &&
    (action === "approve-admission" ? isOwner() : isStaff())
  );
}
function batchContextCurrent(scope, includeGeneration = true) {
  const route = readRoute();
  return (
    (!includeGeneration || app.generation === scope.generation) &&
    route.eventId === scope.eventId &&
    route.view === "organizer" &&
    app.route.eventId === scope.eventId &&
    app.route.view === "organizer" &&
    app.bootstrap?.instanceId === scope.instanceId &&
    app.bootstrap?.mode === scope.mode &&
    same(currentIdentity()?.wallet, scope.wallet) &&
    app.detail?.event.id === scope.eventId &&
    app.detail.event.chainId === scope.chainId &&
    same(app.detail.event.contract, scope.contract) &&
    app.detail.event.contractVersion === scope.contractVersion
  );
}
function batchScope() {
  const event = app.detail.event;
  return Object.freeze({
    generation: app.generation,
    eventId: event.id,
    instanceId: app.bootstrap.instanceId,
    wallet: currentIdentity().wallet,
    chainId: event.chainId,
    contract: event.contract,
    contractVersion: event.contractVersion,
    mode: app.bootstrap.mode,
  });
}
function renderBatchHost(action) {
  if (!batchActionsEnabled(action)) return "";
  return `<div class="batch-task"><h3>${action === "approve-admission" ? "Curated admission approvals" : "Trusted door check-in"}</h3><div data-batch-toolbar="${action}"></div></div>`;
}
async function batchRequest(path, options) {
  try {
    return await api(path, options);
  } catch (error) {
    if ([401, 403].includes(error.status)) {
      disposeContractInbox();
      void load();
    }
    throw error;
  }
}
function mountOrganizerBatchActions() {
  if (app.route.view !== "organizer") return;
  for (const action of ["approve-admission", "check-in"]) {
    const host = $(`[data-batch-toolbar="${action}"]`);
    if (!host || batchControllers.has(action) || !batchActionsEnabled(action))
      continue;
    const contractSource = action === "approve-admission";
    const selectionRoot = $(
      contractSource ? "#contract-deposit-inbox" : "#people-batch-selection",
    );
    if (!selectionRoot) continue;
    const scope = batchScope(),
      filterRevision = batchFilterRevisions[action];
    const current = () =>
      host.isConnected &&
      selectionRoot.isConnected &&
      $(`[data-batch-toolbar="${action}"]`) === host &&
      batchContextCurrent(scope) &&
      batchActionsEnabled(action) &&
      batchFilterRevisions[action] === filterRevision &&
      (!contractSource || selectionRoot.dataset.contractAccess !== "denied");
    const personFor = (row) => {
      const wallet = contractSource
        ? row.querySelector(
            "[data-contract-action=review][data-contract-wallet]",
          )?.dataset.contractWallet
        : row.dataset.batchWallet;
      const id = contractSource
        ? row.dataset.contractLinkedId
        : row.dataset.batchPerson;
      return app.detail.participants.find(
        (person) =>
          id &&
          person.id === id &&
          person.eventId === scope.eventId &&
          participantWalletVerified(person) &&
          same(person.wallet, wallet),
      );
    };
    const rowWallet = (row) =>
      contractSource
        ? row.querySelector(
            "[data-contract-action=review][data-contract-wallet]",
          )?.dataset.contractWallet
        : row.dataset.batchWallet;
    batchControllers.set(
      action,
      mountBatchActions(host, {
        ...scope,
        action,
        canManage: true,
        isCurrent: current,
        pendingJournal: batchPendingJournal,
        request: batchRequest,
        selectionRoot,
        rowSelector: contractSource
          ? ".contract-inbox-table tbody tr"
          : "tbody tr",
        getRowKey: (row) => String(rowWallet(row) ?? "").toLowerCase(),
        getCheckboxHost: (row) =>
          row.querySelector(
            contractSource ? ".contract-person" : ".person-cell",
          ),
        getCandidates: () =>
          [
            ...selectionRoot.querySelectorAll(
              contractSource ? ".contract-inbox-table tbody tr" : "tbody tr",
            ),
          ].map((row) => {
            const wallet = rowWallet(row),
              person = personFor(row);
            const hint = person?.batchEligibility?.[action];
            const sourceCurrent =
              !contractSource ||
              selectionRoot.dataset.contractActionable === "true";
            return {
              key: String(wallet ?? "").toLowerCase(),
              wallet,
              participantId: person?.id ?? null,
              label: person?.name || short(wallet),
              eligible: !!person && sourceCurrent && hint?.eligible === true,
              blockedReason: !person
                ? "This wallet needs a verified guest profile for this exact event."
                : !sourceCurrent
                  ? "Contract observations are stale or refreshing. Refresh before approval."
                  : (hint?.reason ??
                    "Refresh the event to load current batch eligibility."),
            };
          }),
        getRevision: () =>
          JSON.stringify([
            app.detail.state.fingerprint,
            app.detail.participants.map((person) => [
              person.id,
              person.wallet,
              person.batchEligibility?.[action] ?? null,
            ]),
            contractSource
              ? selectionRoot.querySelector("[data-contract-meta]")?.textContent
              : null,
          ]),
        beforeOpen: () => {
          if (!current())
            throw new Error(
              "The event or account changed. Refresh before reviewing this batch.",
            );
          invalidateDraft();
        },
        onRefresh: async () => load({ silent: true }),
        onCommitted: async (result, review) => {
          if (!current()) return;
          const items = result.participantIds.map((participantId) => {
            const row = review.rows.find(
              (candidate) => candidate.participantId === participantId,
            );
            if (!row)
              throw new Error("Saved batch selection could not be verified.");
            return { participantId, wallet: row.wallet };
          });
          await load({ silent: true });
          if (
            !batchContextCurrent(scope, false) ||
            !batchActionsEnabled(action)
          )
            return;
          if (action === "approve-admission") {
            app.batchRegistrationSelection = { scope: batchScope(), items };
            renderBatchRegistrationFollowup();
          }
          toast(
            action === "approve-admission"
              ? "Admission approvals saved. Contract registration has a separate review; Luma approval remains manual."
              : "Trusted check-ins saved. Financial attendance has a separate review.",
          );
        },
      }),
    );
  }
}
function renderBatchRegistrationFollowup() {
  const host = $("#batch-registration-followup");
  if (!host) return;
  const selected = app.batchRegistrationSelection;
  host.innerHTML =
    selected && batchContextCurrent(selected.scope) && isOwner()
      ? `<div class="notice"><p>${selected.items.length} app ${selected.items.length === 1 ? "approval was" : "approvals were"} saved. Financial registration is still separate.</p><button class="button button-secondary" data-batch-register>Review contract registration for approved selection</button></div>`
      : "";
}
async function prepareBatchRegistration() {
  const selected = app.batchRegistrationSelection;
  if (!selected || !batchContextCurrent(selected.scope) || !isOwner())
    throw new Error(
      "The approved selection belongs to an earlier context. Refresh and review it again.",
    );
  invalidateDraft();
  const unsignedReviewVersion = app.unsignedReviewVersion;
  const fresh = await api(
    `/api/events/${encodeURIComponent(selected.scope.eventId)}`,
  );
  if (
    !batchContextCurrent(selected.scope) ||
    unsignedReviewVersion !== app.unsignedReviewVersion
  )
    throw new Error("The event or review changed. Review the selection again.");
  if (
    !fresh.permissions?.owner ||
    !same(fresh.state.owner, selected.scope.wallet)
  ) {
    await load();
    throw new Error("Current event owner access is required.");
  }
  const blocked = selected.items.flatMap((item) => {
    const person = fresh.participants.find(
      (candidate) => candidate.id === item.participantId,
    );
    const reason =
      fresh.state.phase !== "Open"
        ? "Registration is closed in the current contract phase."
        : !person ||
            person.eventId !== selected.scope.eventId ||
            !participantWalletVerified(person, fresh.event) ||
            !same(person.wallet, item.wallet)
          ? "The verified participant and wallet link changed."
          : person.admission !== "approved"
            ? "Host approval changed."
            : !person.deposit?.verified
              ? "The canonical deposit is no longer available."
              : person.registered
                ? "This wallet is already registered."
                : null;
    return reason ? [{ wallet: item.wallet, reason }] : [];
  });
  if (blocked.length) {
    showDialog(
      `<h2 class="dialog-title" id="dialog-title">Registration selection needs review</h2><p>Every selected wallet must still be eligible. No wallets have been dropped from the selection.</p><ul>${blocked.map((row) => `<li><span class="mono">${escape(row.wallet)}</span>: ${escape(row.reason)}</li>`).join("")}</ul><div class="dialog-buttons"><button class="button button-secondary" data-close>Close</button></div>`,
    );
    return;
  }
  await prepareTransaction("register", {
    wallets: selected.items.map((item) => item.wallet),
  });
}
let contractInboxController = null;
let lumaSetupController = null;
function disposeContractInbox() {
  lumaSetupController?.dispose();
  lumaSetupController = null;
  app.batchRegistrationSelection = null;
  disposeBatchActions();
  contractInboxController?.dispose();
  contractInboxController = null;
}
function contractInboxEnabled() {
  return (
    app.bootstrap?.capabilities?.contractInbox === true && isOwner() && isV8()
  );
}
function mountOwnerContractInbox() {
  const host = $("#contract-deposit-inbox");
  if (!host || !contractInboxEnabled() || app.route.view !== "organizer")
    return;
  const event = app.detail.event;
  const scope = Object.freeze({
    generation: app.generation,
    eventId: event.id,
    view: app.route.view,
    instanceId: app.bootstrap.instanceId,
    wallet: currentIdentity().wallet,
    chainId: event.chainId,
    contract: event.contract,
    contractVersion: event.contractVersion,
  });
  const current = () => {
    const route = readRoute();
    return (
      host.isConnected &&
      $("#contract-deposit-inbox") === host &&
      app.generation === scope.generation &&
      app.route.eventId === scope.eventId &&
      app.route.view === scope.view &&
      route.eventId === scope.eventId &&
      route.view === scope.view &&
      app.bootstrap?.instanceId === scope.instanceId &&
      same(currentIdentity()?.wallet, scope.wallet) &&
      app.detail?.event.id === scope.eventId &&
      app.detail.event.chainId === scope.chainId &&
      same(app.detail.event.contract, scope.contract) &&
      app.detail.event.contractVersion === scope.contractVersion &&
      contractInboxEnabled()
    );
  };
  contractInboxController = mountContractInbox(host, {
    ...scope,
    currencySymbol: currencySymbol(),
    canManage: true,
    isCurrent: current,
    beforeOpen: () => {
      if (!current())
        throw new Error(
          "The selected event or owner changed. Reload the event.",
        );
      invalidateDraft(); // Clears unsigned reviews; submitted hashes and journals are preserved.
    },
    onOpenLinked: async (participantId) => {
      if (!current()) return;
      const known = app.detail.participants.find(
        (person) => person.id === participantId,
      );
      if (!known) {
        toast("Refresh the people list before opening this linked guest.");
        return;
      }
      try {
        const fresh = await api(
          `/api/events/${encodeURIComponent(scope.eventId)}`,
        );
        if (!current()) return;
        const person = fresh.participants.find(
          (candidate) =>
            candidate.id === participantId &&
            same(candidate.wallet, known.wallet),
        );
        if (
          fresh.permissions?.owner !== true ||
          !same(fresh.state.owner, scope.wallet)
        ) {
          disposeContractInbox();
          await load();
          return;
        }
        if (!person || [...document.querySelectorAll("dialog[open]")].length)
          return;
        const panel = $("#people-review");
        const admission = $$("[data-admission]", panel).find(
          (control) => control.dataset.admission === person.id,
        );
        panel?.scrollIntoView({ block: "start" });
        (admission ?? panel)?.focus();
      } catch (error) {
        if (!current()) return;
        if ([401, 403].includes(error.status)) {
          disposeContractInbox();
          await load();
          return;
        }
        toast(
          "This linked guest is unavailable. Refresh the event to verify owner access.",
          true,
        );
      }
    },
  });
}
let toastTimer;
const publicSearch = { scope: "", query: "", entries: Object.freeze([]) };
let displayCatalog = null;
// Negative-only invalidation hint: the display-only catalog has no session DTO.
let walletSessionObserved = false;
const publicCatalogScreen = () =>
  displayCatalog !== null && !app.route.eventId && !app.route.setup;
const publicHomePresentation = () => publicCatalogScreen() || isProduction();
let caseArtifactReview = null;
let caseArtifactGeneration = 0;
const caseUploadAttempts = new Set();
let hostedNoticeObserver;
const isHostedDemo = () => app.bootstrap?.mode === "hosted-demo";
const isProduction = () => isProductionMode(app.bootstrap?.mode);
const isV9Testnet = () => isV9TestnetMode(app.bootstrap?.mode);
const isGuardedV9 = () => isProduction() || isV9Testnet();
const isSandbox = () => isSandboxMode(app.bootstrap?.mode);
const isTestnet = () =>
  ["testnet", "hosted-testnet"].includes(app.bootstrap?.mode);
const isWalletEnvironment = () => isTestnet() || isGuardedV9();
const isControlledArbitration = () =>
  (isTestnet() || isV9Testnet()) &&
  app.bootstrap?.arbitration?.mode === "controlled";
const rulingNumber = (value) =>
  [0, 1, 2, "0", "1", "2"].includes(value) ? Number(value) : null;
const currencySymbol = () =>
  app.bootstrap?.chain?.nativeCurrency?.symbol ?? "ETH";
const walletSupportNotice = () =>
  app.bootstrap?.walletSupport?.notice ??
  "Use a standard wallet account. Smart contract and delegated accounts are not supported.";
const guardedV9ContextIssue = (detail = null, options = {}) =>
  isV9Testnet()
    ? v9TestnetContextIssue(app.bootstrap, detail, options)
    : productionContextIssue(app.bootstrap, detail, options);
const productionConnectionIssue = () => guardedV9ContextIssue();
const arbitrationLabel = () =>
  isGuardedV9() && productionConnectionIssue()
    ? "Arbitration verification unavailable"
    : (app.bootstrap?.arbitration?.label ?? "Kleros V1");
const arbitrationNotice = () =>
  isGuardedV9() && productionConnectionIssue()
    ? "Verified arbitration metadata is unavailable."
    : (app.bootstrap?.arbitration?.notice ??
      "Arbitration metadata is unavailable.");
function appealRewardsReady(item) {
  const caseReady = item?.rewardsReady;
  const appealReady = item?.appeal?.rewardsReady;
  if (
    (caseReady != null && typeof caseReady !== "boolean") ||
    (appealReady != null && typeof appealReady !== "boolean") ||
    (typeof caseReady === "boolean" &&
      typeof appealReady === "boolean" &&
      caseReady !== appealReady)
  )
    return false;
  return (
    rulingNumber(item?.finalRuling) !== null &&
    (caseReady === true || appealReady === true)
  );
}
function assertFinancialEnvironment(action, params = {}) {
  const event = app.detail?.event;
  const productionProfile = "kleros-event-v9-uups";
  if (
    !isGuardedV9() &&
    (Number(app.bootstrap?.chain?.chainId) === 1 ||
      Number(event?.chainId) === 1 ||
      [
        app.bootstrap,
        app.bootstrap?.contractProfile,
        event,
        event?.contractProfile,
      ].some(
        (value) =>
          [productionProfile, "kleros-event-v9-uups-chiado"].includes(
            value?.contractVersion,
          ) ||
          [productionProfile, "kleros-event-v9-uups-chiado"].includes(
            value?.abiVersion,
          ) ||
          value?.version === 9,
      ))
  )
    throw new Error(
      "V9 transactions require their exact verified production or Chiado test environment.",
    );
  if (isGuardedV9()) {
    if (app.detail?.event.id !== app.route.eventId)
      throw new Error(
        "The selected event changed. Refresh before financial review.",
      );
    const issue = guardedV9ContextIssue(app.detail, {
      requireTransactions: true,
      requireWallet: true,
    });
    if (issue) throw new Error(issue);
    if (isProduction() && action === "deposit") {
      if (!knownAttendanceStandard(app.detail?.event.attendanceStandard))
        throw new Error(
          "This event's attendance standard is missing or unsupported. New deposit review is unavailable; existing recovery rights remain accessible.",
        );
      const eligible = launchDepositAction();
      if (
        app.bootstrap?.capabilities?.lumaDepositPortal !== true ||
        app.bootstrap?.capabilities?.walletFirstDeposits !== true ||
        !eligible?.eligible ||
        ownWalletFacts()?.deposit?.status === "submitted"
      )
        throw new Error(
          eligible?.reason ??
            "This wallet is not eligible for a new event deposit. Refresh its verified status.",
        );
    }
    if (action === "appealRewards") {
      const item = app.detail?.state?.cases?.find((item) =>
        same(item.wallet, params.wallet),
      );
      if (!appealRewardsReady(item))
        throw new Error(
          "Appeal rewards are pending verified finality. Refresh the case before preparing a claim.",
        );
    }
  } else if (!isSandbox() && !isTestnet())
    throw new Error(
      "The application environment is unavailable. Refresh before financial review.",
    );
}
function assertProductionDraft(draft) {
  if (!isGuardedV9()) {
    if (
      Number(draft?.chainId) === 1 ||
      ["kleros-event-v9-uups", "kleros-event-v9-uups-chiado"].includes(
        draft?.abiVersion,
      )
    )
      throw new Error(
        "V9 transactions require their exact verified production or Chiado test environment.",
      );
    return;
  }
  const event = app.detail?.event;
  if (
    !event ||
    draft?.eventId !== event.id ||
    Number(draft.chainId) !== event.chainId ||
    !same(draft.contract, event.contract) ||
    !same(draft.wallet, currentIdentity()?.wallet) ||
    (draft.abiVersion !== undefined && draft.abiVersion !== event.abiVersion) ||
    (draft.mode !== undefined && draft.mode !== app.bootstrap?.mode) ||
    (draft.instanceId !== undefined &&
      draft.instanceId !== app.bootstrap?.instanceId)
  )
    throw new Error(
      "The transaction review does not match the verified event, wallet or environment. Refresh and prepare it again.",
    );
  if (isProduction() && draft.action === "deposit") {
    const action = launchDepositAction();
    if (!action?.eligible || draft.valueWei !== action.amountWei)
      throw new Error(
        "The deposit amount changed. Refresh and review the authoritative amount again.",
      );
  }
}
const isV8 = (event = app.detail?.event) => hasV8FinancialInterface(event);
const versionLabel = (event = app.detail?.event) =>
  isTest15mVersion(event?.contractVersion)
    ? "v8 · 15-minute TEST ONLY"
    : event?.contractVersion === "kleros-event-v8"
      ? "v8"
      : event?.contractVersion === "kleros-event-v9-uups"
        ? "v9 · upgradeable"
        : event?.contractVersion === "kleros-event-v9-uups-chiado"
          ? "v9 · Chiado testnet"
          : event?.contractVersion === "truth-pays-v7"
            ? "v7"
            : "Unsupported profile";
const contractDeadline = (value, timezone, event = app.detail?.event) =>
  isTest15mVersion(event?.contractVersion)
    ? formatDeadline(value, timezone)
    : formatTime(value, timezone);
function testProfileNotice(event = app.detail?.event) {
  if (!isTest15mVersion(event?.contractVersion)) return "";
  const valid = contractProfileForEvent(event);
  const deadline =
    app.detail?.event.id === event.id ? app.detail.state.challengeEndsAt : null;
  return `<div class="notice warning" data-test15m-notice><strong>15-minute TEST ONLY · Chiado (10200)</strong><p>${valid ? "Accelerated omission and matching windows: 15 minutes each. Use test XDAI and synthetic data only." : "This profile requires its exact test15m ABI and Chiado deployment metadata. Financial review is unavailable until the verified context agrees."}</p>${deadline ? `<p>On-chain omission deadline: <strong>${escape(formatDeadline(deadline, event.timezone))}</strong>.</p>` : "<p>The on-chain omission deadline appears after attendance posting is confirmed.</p>"}<p>Profile: <code>${escape(event.contractVersion)}</code> · VERSION 80015.</p></div>`;
}
const networkName = () =>
  Number(app.bootstrap?.chain?.chainId) === 1337 && isSandbox()
    ? isHostedDemo()
      ? "Sandbox chain"
      : "Local chain"
    : (app.bootstrap?.chain?.name ?? "Network unavailable");

function productionUpgradeNotice(delaySeconds = null) {
  const period =
    Number.isSafeInteger(delaySeconds) && delaySeconds > 0
      ? `The verified ${delaySeconds / 3600}-hour upgrade review period`
      : "An upgrade review period";
  return `<p class="field-help">Each event has its own upgradeable contract. ${escape(period)} is not a guaranteed withdrawal window. Upgrade authority can change contract behavior and custody of funds. Future events created through a factory are separate deployments.</p>`;
}
function renderProductionDetails() {
  if (!isGuardedV9()) return "";
  const detail = app.detail;
  const issue = guardedV9ContextIssue(detail, { requireTransactions: true });
  const upgrade = detail?.upgrade;
  const verified =
    !!detail &&
    !guardedV9ContextIssue(detail) &&
    upgrade?.verified === true &&
    upgrade.kind === "uups";
  const pending = upgrade?.pending;
  const environment = isV9Testnet()
    ? "Chiado test deployment"
    : "Ethereum deployment";
  const detailsAttribute = isV9Testnet()
    ? "data-v9-testnet-details"
    : "data-production-details";
  const issueAttribute = isV9Testnet()
    ? "data-v9-testnet-unavailable"
    : "data-production-unavailable";
  return `${issue ? `<div class="notice warning" ${issueAttribute} role="status">${escape(issue)}</div>` : ""}<details class="disclosure" ${detailsAttribute}><summary>${environment}, arbitration & upgrades</summary><p>${escape(arbitrationLabel())}</p><p>${escape(arbitrationNotice())}</p><p>${escape(walletSupportNotice())}</p>${verified ? `<dl class="details-list"><div><dt>Deployment verification</dt><dd>${escape(detail.deploymentTrust.status)}</dd></div><div><dt>Upgrade model</dt><dd>Per-event UUPS / ERC1967</dd></div><div><dt>Implementation</dt><dd class="mono">${escape(upgrade.implementation)}</dd></div><div><dt>Implementation code hash</dt><dd class="mono">${escape(upgrade.implementationCodeHash)}</dd></div><div><dt>Implementation version</dt><dd>${escape(upgrade.version)}</dd></div><div><dt>Upgrade authority contract</dt><dd class="mono">${escape(upgrade.authority)}</dd></div><div><dt>Upgrade owner</dt><dd class="mono">${escape(upgrade.owner)}</dd></div><div><dt>Pending upgrade owner</dt><dd class="mono">${upgrade.pendingOwner === null ? "None" : escape(upgrade.pendingOwner)}</dd></div><div><dt>Initial upgrade owner · historical</dt><dd class="mono">${escape(app.bootstrap?.governance?.initialOwner)}</dd></div><div><dt>Pending governance operations</dt><dd>${escape(upgrade.pendingOperationCount)}</dd></div><div><dt>Executing governance operations</dt><dd>${escape(upgrade.executingOperationCount)}</dd></div><div><dt>Event financial owner</dt><dd class="mono">${escape(detail.state.owner)}</dd></div><div><dt>Upgrade delay</dt><dd>${escape(upgrade.delaySeconds)} seconds · ${escape(upgrade.delaySeconds / 3600)} hours</dd></div><div><dt>Pending upgrade</dt><dd>${pending ? `${escape(pending.status)}<br>Operation: <span class="mono">${escape(pending.operationId)}</span><br>New implementation: <span class="mono">${escape(pending.newImplementation)}</span><br>Eligible: ${escape(formatTime(pending.eligibleAt, detail.event.timezone))}` : "None reported in this verified snapshot"}</dd></div><div><dt>Resolver</dt><dd class="mono">${escape(app.bootstrap?.arbitration?.resolver)}</dd></div><div><dt>Arbitrator</dt><dd class="mono">${escape(app.bootstrap?.arbitration?.arbitrator)}</dd></div></dl><p class="field-help">The upgrade owner is separate from the event financial owner. An upgrade ownership transfer requires the proposed owner to accept while the pending and executing operation counts are both zero.</p>` : "<p>Verified upgrade metadata is unavailable. Financial review is disabled.</p>"}${productionUpgradeNotice(verified ? upgrade.delaySeconds : null)}</details>`;
}
function disableUnreadyProductionActions() {
  if (!isGuardedV9()) return;
  const issue = guardedV9ContextIssue(app.detail, {
    requireTransactions: true,
  });
  if (issue)
    for (const button of $$(
      "[data-tx],[data-recovery],[data-batch-register],[data-correction]",
      $("#content"),
    )) {
      button.disabled = true;
      button.title = issue;
    }
}

function updateHostedDemoNotice() {
  document.body.classList.remove("initial-shell");
  const selectedEvent = app.bootstrap?.events?.find(
    (event) => event.id === readRoute().eventId,
  );
  const test15m = isTest15mVersion(
    selectedEvent?.contractVersion ?? app.bootstrap?.contractVersion,
  );
  const production = isProduction(),
    v9Testnet = isV9Testnet(),
    hosted = isHostedDemo(),
    testnet = isTestnet() || v9Testnet;
  document.body.classList.toggle(
    "hosted-shared-demo",
    production || hosted || testnet || test15m,
  );
  document.body.classList.toggle("launch-mode", production);
  const activeId = production
    ? "production-banner"
    : v9Testnet
      ? "v9-testnet-banner"
      : hosted
        ? "hosted-demo-banner"
        : testnet || test15m
          ? "testnet-banner"
          : null;
  for (const notice of $$(
    "#hosted-demo-banner,#testnet-banner,#production-banner,#v9-testnet-banner",
  ))
    if (notice.id !== activeId) {
      hostedNoticeObserver?.disconnect();
      notice.remove();
    }
  if (activeId && !$("#" + activeId)) {
    const notice = document.createElement("aside");
    notice.id = activeId;
    notice.className = "hosted-demo-notice";
    notice.setAttribute(
      "aria-label",
      production
        ? "Ethereum mainnet environment"
        : testnet || test15m
          ? "Public testnet environment"
          : "Shared online demo environment",
    );
    document.body.prepend(notice);
    const measure = () =>
      document.documentElement.style.setProperty(
        "--hosted-demo-notice-height",
        `${notice.getBoundingClientRect().height}px`,
      );
    measure();
    if (typeof ResizeObserver !== "undefined") {
      hostedNoticeObserver = new ResizeObserver(measure);
      hostedNoticeObserver.observe(notice);
    }
  }
  const notice = activeId ? $("#" + activeId) : null;
  if (notice) {
    const message = production
      ? `<strong>ETHEREUM MAINNET</strong><p>Transactions use real ETH. ${escape(walletSupportNotice())}</p>`
      : v9Testnet
        ? `<strong>V9 CHIADO TESTNET</strong><p>Test XDAI and synthetic data only. Standard one-day challenge and matching windows. ${escape(arbitrationNotice())} ${escape(walletSupportNotice())}</p>`
        : test15m
          ? `<strong>15-MINUTE TEST ONLY · CHIADO</strong><p>${escape(networkName())} · Chain ${escape(app.bootstrap?.chain?.chainId)}. 15-minute omission and matching windows. Test XDAI and synthetic data only. ${escape(app.bootstrap?.arbitration?.notice ?? "Review the configured test arbitrator")}. Follow the actual on-chain deadlines.</p>`
          : testnet
            ? `<strong>PUBLIC TESTNET</strong><p>${escape(networkName())} · Test tokens only. Use your own wallet and test data. ${escape(app.bootstrap?.arbitration?.notice ?? "Review this event's arbitration setup before depositing")}. Transactions remain on the public chain.</p>`
            : "<strong>SHARED ONLINE DEMO</strong><p>Synthetic accounts · valueless ETH · mock Court. Everyone shares this sandbox; state resets on server restart. Use synthetic inputs only.</p>";
    if (notice.innerHTML !== message) {
      notice.innerHTML = message;
      document.documentElement.style.setProperty(
        "--hosted-demo-notice-height",
        `${notice.getBoundingClientRect().height}px`,
      );
    }
  }
  if (!activeId)
    document.documentElement.style.removeProperty(
      "--hosted-demo-notice-height",
    );
  $("#environment").innerHTML =
    `<i></i> ${production ? "ETHEREUM MAINNET" : test15m ? "15-MIN TEST ONLY" : testnet ? "TESTNET" : hosted ? "SHARED DEMO" : isSandbox() ? "LOCAL CHAIN" : "UNAVAILABLE"}`;
  const network = $(".sidebar-foot .network-pip");
  if (network)
    network.innerHTML = `<i></i> ${production || testnet ? escape(networkName()) : hosted ? "Hosted sandbox" : isSandbox() ? "Local development" : "Network unavailable"}`;
  const description = $(".sidebar-foot p");
  if (description)
    description.innerHTML = production
      ? "Your wallet. Real ETH.<br>Review every Ethereum transaction."
      : testnet
        ? "Your wallet. Test tokens.<br>Public testnet transactions."
        : hosted
          ? "Shared synthetic accounts.<br>Valueless ETH. Mock Court."
          : isSandbox()
            ? "Real contract logic.<br>Synthetic people. Local ETH."
            : "Environment verification unavailable.";
  $("#demo-help").innerHTML = `How it works <span aria-hidden="true">↗</span>`;
}

function annotateHostedForms(parent = document) {
  if (!isHostedDemo() && !isTestnet() && !isV9Testnet()) return;
  for (const form of parent.querySelectorAll("form[data-form]")) {
    if (
      form.querySelector(".hosted-input-hint") ||
      !form.querySelector('input[type="email"],input[name="name"],textarea')
    )
      continue;
    const hint = document.createElement("p");
    hint.className = "hosted-input-hint";
    hint.textContent =
      isTestnet() || isV9Testnet()
        ? "Use test data only, such as alice@example.test. Public testnet transactions are visible to others; do not submit real guest or contact data."
        : "Use synthetic inputs only, such as alice@example.test. Other demo visitors share this sandbox; do not enter personal guest or contact data.";
    form.prepend(hint);
  }
}

async function api(path, options = {}) {
  const result = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await result.json();
  } catch {
    throw Object.assign(
      new Error(`The application returned HTTP ${result.status}.`),
      { status: result.status },
    );
  }
  if (!result.ok)
    throw Object.assign(
      new Error(data.error ?? `Request failed (${result.status})`),
      { code: data.code, status: result.status },
    );
  return data;
}
const post = (path, data) =>
  api(path, { method: "POST", body: JSON.stringify(data) });
const eventPath = (suffix) =>
  `/api/events/${encodeURIComponent(app.route.eventId)}${suffix}`;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.toggle("error", error);
  $("#toast").hidden = false;
  toastTimer = setTimeout(
    () => {
      $("#toast").hidden = true;
    },
    error ? 11000 : 6500,
  );
}
function invalidateDraft() {
  closeCaseArtifactReview();
  app.unsignedReviewVersion++;
  app.draft = null;
  app.draftParams = null;
  app.importReview = null;
  const dialog = $("#review-dialog");
  if (dialog.open) dialog.close();
}
function navigate(eventId, view = "participant", focusSelector = null) {
  const hash = eventId
    ? `#${new URLSearchParams({ event: eventId, view })}`
    : "";
  if (location.hash === hash) {
    if (focusSelector) $(focusSelector)?.focus();
    return;
  }
  disposeContractInbox();
  navigationFocus = focusSelector ? { hash, selector: focusSelector } : null;
  location.hash = hash;
}
function readRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  const eventId = params.get("event");
  return {
    eventId,
    setup: !eventId && params.get("setup") === "kickback",
    view: ["participant", "organizer", "cases"].includes(params.get("view"))
      ? params.get("view")
      : "participant",
  };
}
function currentIdentity() {
  return app.bootstrap?.session ?? null;
}
function isOwner() {
  return same(currentIdentity()?.wallet, app.detail?.state?.owner);
}
function participantWalletVerified(person, event = app.detail?.event) {
  return (
    person?.identityVerified === true ||
    (isProduction() &&
      event?.chainId === 1 &&
      event.contractVersion === "kleros-event-v9-uups" &&
      event.abiVersion === "kleros-event-v9-uups" &&
      person?.walletVerified === true)
  );
}
function isStaff() {
  return (
    isOwner() ||
    app.detail?.event?.role === "staff" ||
    app.detail?.permissions?.staff === true
  );
}
function ownParticipant() {
  return app.detail?.participants?.find((person) =>
    same(person.wallet, currentIdentity()?.wallet),
  );
}
function ownWalletFacts() {
  const facts = app.detail?.ownWallet;
  return facts && same(facts.wallet, currentIdentity()?.wallet) ? facts : null;
}
function isIn(list, wallet) {
  return (list ?? []).some((item) =>
    same(typeof item === "string" ? item : item.wallet, wallet),
  );
}
let dialogReturnFocus = null;
function focusKey(element) {
  if (!(element instanceof HTMLElement)) return null;
  if (element.id) return `#${CSS.escape(element.id)}`;
  for (const key of [
    "data-tx",
    "data-recovery",
    "data-view",
    "data-import-preview",
    "data-checkin",
  ])
    if (element.hasAttribute(key))
      return `[${key}="${CSS.escape(element.getAttribute(key))}"]`;
  return null;
}
function showDialog(html) {
  if (!$("#review-dialog").open)
    dialogReturnFocus = {
      element: document.activeElement,
      selector: focusKey(document.activeElement),
    };
  $("#dialog-body").innerHTML = html;
  const dialog = $("#review-dialog");
  annotateHostedForms(dialog);
  if (!dialog.open) dialog.showModal();
  const title = $("#dialog-title");
  if (title) {
    title.tabIndex = -1;
    title.focus();
  }
}

function identityOptions() {
  const session = currentIdentity();
  return `<option value="">${isHostedDemo() ? "Select a synthetic demo identity" : "Select a local demo identity"}</option>${session?.mode === "wallet" ? `<option value="connected-wallet" selected>Connected wallet · ${escape(short(session.wallet))}</option>` : ""}${(app.bootstrap?.identities ?? []).map((identity) => `<option value="${escape(identity.id)}" ${same(identity.wallet, session?.wallet) ? "selected" : ""}>${escape(identity.label)} · ${escape(short(identity.wallet))}</option>`).join("")}`;
}
function sidebar() {
  const events = isProduction() ? [] : (app.bootstrap?.events ?? []);
  $("#event-count").textContent = events.length;
  $("#all-events-link").classList.toggle("active", !app.route.eventId);
  if (isProduction()) $("#sidebar-events").replaceChildren();
  else
    $("#sidebar-events").innerHTML = events
      .map(
        (event) =>
          `<a class="sidebar-event ${event.id === app.route.eventId ? "selected" : ""}" href="#${new URLSearchParams({ event: event.id, view: "participant" })}">${escape(event.title)}</a>`,
      )
      .join("");
  $("#breadcrumb").innerHTML = isProduction()
    ? `<a href="#">Kickback</a>${app.route.eventId ? ` <span>/</span> ${app.route.view === "organizer" ? "Manage event" : "Event deposit"}` : app.route.setup ? " <span>/</span> Set up kickback" : ""}`
    : app.route.eventId
      ? `Workspace <span>/</span> <a href="#">Events</a> <span>/</span> <strong>${escape(app.detail?.event.title ?? "Loading")}</strong>`
      : "Workspace <span>/</span> <strong>All events</strong>";
  let identity = $("#top-identity");
  if (!identity) {
    identity = document.createElement("button");
    identity.id = "top-identity";
    identity.type = "button";
    identity.className = "button button-small button-secondary";
    $(".topbar-actions").insertBefore(identity, $("#refresh"));
  }
  identity.disabled = false;
  identity.hidden = false;
  identity.textContent = isProduction()
    ? currentIdentity()?.wallet
      ? `Wallet ${short(currentIdentity().wallet)}`
      : "Connect wallet"
    : (currentIdentity()?.label ??
      (isWalletEnvironment()
        ? "Connect wallet"
        : isSandbox()
          ? "Choose identity"
          : "Account unavailable"));
  identity.onclick = showIdentityDialog;
}
function showIdentityDialog() {
  invalidateDraft();
  if (isGuardedV9()) {
    const issue = productionConnectionIssue();
    showDialog(
      `<div class="dialog-eyebrow">${escape(networkName())}</div><h2 class="dialog-title" id="dialog-title">Connect your wallet</h2><p class="dialog-body-text">${escape(walletSupportNotice())} A one-use signature proves wallet ownership; it does not send a transaction. Each contract action has its own review.</p>${currentIdentity() ? `<p class="mono">${escape(currentIdentity().wallet)}</p>` : ""}${issue ? `<div class="notice warning" ${isV9Testnet() ? "data-v9-testnet-unavailable" : "data-production-unavailable"}>${escape(issue)}</div>` : ""}<div class="button-row"><button class="button button-primary" data-connect-wallet ${issue ? "disabled" : ""}>Connect browser wallet</button></div><p class="field-help">Network: ${escape(networkName())} · ${escape(app.bootstrap?.chain?.chainId)}. Transactions use ${isV9Testnet() ? "test XDAI" : "real ETH"}.</p><div class="dialog-buttons"><button class="button button-secondary" data-close>Close</button>${currentIdentity() ? '<button class="button button-quiet" data-logout>Sign out</button>' : ""}</div>`,
    );
    return;
  }
  if (isTestnet()) {
    showDialog(
      `<div class="dialog-eyebrow">${escape(networkName())} · public testnet</div><h2 class="dialog-title" id="dialog-title">Connect your wallet</h2><p class="dialog-body-text">Use a wallet with test ${escape(currencySymbol())}. A one-use signature proves wallet ownership; it does not send a transaction. Every deposit or contract action has a separate review.</p>${currentIdentity() ? `<p class="mono">${escape(currentIdentity().wallet)}</p>` : ""}<div class="button-row"><button class="button button-primary" data-connect-wallet>Connect browser wallet</button></div><p class="field-help">Network: ${escape(networkName())} · ${escape(app.bootstrap.chain.chainId)}. Test tokens only. Demo identities and local faucets are unavailable here.</p><div class="dialog-buttons"><button class="button button-secondary" data-close>Close</button>${currentIdentity() ? '<button class="button button-quiet" data-logout>Sign out</button>' : ""}</div>`,
    );
    return;
  }
  if (!isSandbox())
    throw new Error(
      "The application environment is unavailable. Refresh before connecting a wallet.",
    );
  const explanation = isHostedDemo()
    ? "Demo identities intentionally impersonate funded synthetic accounts in this shared online sandbox. Every visitor can choose these roles; this is not production authentication. A connected browser wallet proves its ownership with a nonce signature."
    : "Each demo identity controls a funded wallet on the isolated local chain. This selector simulates authentication. Or connect your browser wallet and prove ownership with a nonce signature.";
  showDialog(
    `<div class="dialog-eyebrow">${isHostedDemo() ? "Shared online demonstration" : "Local demonstration"}</div><h2 class="dialog-title" id="dialog-title">Choose a demo identity</h2><p class="dialog-body-text">${explanation}</p><label for="dialog-identity">Act as</label><select id="dialog-identity" data-identity>${identityOptions()}</select><div class="notice">Organizers A and B have separate authority. Alice, Bob and Carol can participate in both events. Staff A can check in only Event A.</div><div class="button-row"><button class="button button-secondary" data-connect-wallet>${isHostedDemo() ? "Connect browser wallet to demo" : "Connect browser wallet to local chain"}</button>${currentIdentity()?.mode === "wallet" ? '<button class="button button-secondary" data-fund-wallet>Receive 1 local ETH</button>' : ""}</div><p class="field-help">Browser wallets must use sandbox chain 1337. Funding and all transactions use ETH with no monetary value.${isHostedDemo() ? " Shared state resets on server restart; use synthetic inputs only." : ""}</p><div class="dialog-buttons"><button class="button button-secondary" data-close>Close</button>${currentIdentity() ? '<button class="button button-quiet" data-logout>Sign out</button>' : ""}</div>`,
  );
}
function sessionWalletFromAck(result, expectedWallet = null) {
  if (
    typeof result?.wallet !== "string" ||
    !/^0x[0-9a-f]{40}$/i.test(result.wallet) ||
    (expectedWallet !== null && !same(result.wallet, expectedWallet))
  )
    throw new Error(
      "The sign-in response did not confirm the selected wallet. Refresh and authenticate again.",
    );
  return result.wallet;
}
async function signOutSession() {
  const result = await api("/api/session", { method: "DELETE", body: "{}" });
  if (result?.ok !== true)
    throw new Error(
      "Sign-out could not be confirmed. Refresh your authentication state before continuing.",
    );
  walletSessionObserved = false;
}
async function switchIdentity(id) {
  if (id === "connected-wallet") return;
  if (id && !isSandbox())
    throw new Error("Demo identities are available only in the sandbox.");
  cancelRead();
  disposeContractInbox();
  invalidateDraft();
  let acknowledgedWallet = null;
  if (!id) await signOutSession();
  else
    acknowledgedWallet = sessionWalletFromAck(
      await post("/api/session", { identity: id }),
    );
  await load({ acknowledgedWallet });
  toast(
    id
      ? "Demo identity changed. Previous transaction drafts were cleared."
      : "Signed out.",
  );
}

function walletProvider() {
  const provider = /** @type {any} */ (window).ethereum;
  if (!provider?.request)
    throw new Error(
      isWalletEnvironment()
        ? "No browser wallet was found. Open this app in a browser with a wallet extension for the configured network."
        : "No browser wallet was found. Use a demo identity or open this app in a browser with a wallet extension.",
    );
  return provider;
}
function installWalletSessionListeners(provider) {
  if (!provider?.on || provider.__klerosListeners) return;
  provider.__klerosListeners = true;
  const invalidateSession = async () => {
    if (currentIdentity()?.mode !== "wallet" && !walletSessionObserved) return;
    cancelRead();
    disposeContractInbox();
    invalidateDraft();
    await signOutSession();
    await load({ silent: true, acknowledgedWallet: null });
    toast(
      "Wallet account or network changed. Authenticate again before signing.",
      true,
    );
  };
  provider.on("accountsChanged", invalidateSession);
  provider.on("chainChanged", invalidateSession);
}
async function connectWallet() {
  if (isGuardedV9()) {
    const issue = productionConnectionIssue();
    if (issue) throw new Error(issue);
  } else if (!isTestnet() && !isSandbox())
    throw new Error(
      "The application environment is unavailable. Refresh before connecting a wallet.",
    );
  disposeContractInbox();
  invalidateDraft();
  const connection = {
    mode: app.bootstrap?.mode,
    instanceId: app.bootstrap?.instanceId,
    chainId: app.bootstrap?.chain?.chainId,
  };
  const assertConnectionCurrent = () => {
    if (
      connection.mode !== app.bootstrap?.mode ||
      connection.instanceId !== app.bootstrap?.instanceId ||
      connection.chainId !== app.bootstrap?.chain?.chainId
    )
      throw new Error(
        "The wallet environment changed. Connect again using the current event network.",
      );
    if (isGuardedV9()) {
      const issue = productionConnectionIssue();
      if (issue) throw new Error(issue);
    }
  };
  const provider = walletProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  assertConnectionCurrent();
  if (!accounts?.[0]) throw new Error("No wallet account was selected.");
  const expectedChain = Number(app.bootstrap?.chain?.chainId);
  if (
    !Number.isSafeInteger(expectedChain) ||
    expectedChain <= 0 ||
    (expectedChain === 1 && !isProduction())
  )
    throw new Error(
      "A configured demo or test network is required before connecting.",
    );
  const chainHex = `0x${expectedChain.toString(16)}`;
  let chain = await provider.request({ method: "eth_chainId" });
  if (Number(BigInt(chain)) !== expectedChain) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainHex }],
      });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainHex,
            chainName:
              app.bootstrap.chain.name ??
              (isHostedDemo()
                ? "Kleros shared demo sandbox"
                : "Kleros isolated local demo"),
            rpcUrls: [app.bootstrap.chain.rpcUrl],
            nativeCurrency: app.bootstrap.chain.nativeCurrency ?? {
              name: "Local Ether",
              symbol: "ETH",
              decimals: 18,
            },
          },
        ],
      });
    }
  }
  chain = await provider.request({ method: "eth_chainId" });
  assertConnectionCurrent();
  if (Number(BigInt(chain)) !== expectedChain)
    throw new Error(
      `Select ${networkName()} (${expectedChain}) before authenticating.`,
    );
  if (isGuardedV9()) {
    const issue = productionConnectionIssue();
    if (issue) throw new Error(issue);
  }
  if (isHostedDemo())
    await assertDemoChainInstance(
      provider,
      app.bootstrap.chain.instanceMarker,
      app.bootstrap.chain.rpcUrl,
    );
  assertConnectionCurrent();
  const { nonce, message } = await post("/api/auth/challenge", {
    wallet: accounts[0],
  });
  assertConnectionCurrent();
  const messageHex = `0x${[...new TextEncoder().encode(message)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const signature = await provider.request({
    method: "personal_sign",
    params: [messageHex, accounts[0]],
  });
  assertConnectionCurrent();
  cancelRead();
  const acknowledgedWallet = sessionWalletFromAck(
    await post("/api/auth/verify", { nonce, signature }),
    accounts[0],
  );
  walletSessionObserved = true;
  await load({ silent: true, acknowledgedWallet });
  installWalletSessionListeners(provider);
  toast(
    isProduction()
      ? "Wallet ownership verified. Every Ethereum transaction requires a separate review."
      : isV9Testnet()
        ? "Wallet ownership verified. V9 Chiado uses test XDAI and controlled arbitration. Every transaction requires a separate review."
        : isTestnet()
          ? "Wallet ownership verified. You can now review actions on the configured testnet."
          : "Wallet ownership verified by a one-use nonce signature. Use “Choose identity” to receive local demo ETH if needed.",
  );
}

// Only GETs belong to this controller. Reconciliation and wallet submissions keep
// their existing once-only journals and are never aborted/replayed by navigation.
let activeLoad = null;
let navigationFocus = null;
function cancelRead() {
  if (!activeLoad) return;
  activeLoad.controller.abort();
  activeLoad = null;
  app.generation++;
  setReadBusy(false);
}
function setReadBusy(busy) {
  $("#refresh").disabled = busy;
  $("#refresh").setAttribute("aria-busy", String(busy));
  $("#content").setAttribute("aria-busy", String(busy));
}
function loadingStage(message, title = null) {
  $("#loading-status").textContent = message;
  if (title) $("#loading-title").textContent = title;
}
async function readForLoad(path, record) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  record.controller.signal.addEventListener("abort", abort, { once: true });
  if (record.controller.signal.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 35000);
  try {
    return await api(path, { signal: controller.signal });
  } catch (error) {
    if (timedOut && !record.controller.signal.aborted)
      throw new Error(
        "Reading this view took too long. Try again to request a fresh snapshot.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    record.controller.signal.removeEventListener("abort", abort);
  }
}
function load({
  silent = false,
  coalesce = false,
  acknowledgedWallet = undefined,
} = {}) {
  const route = readRoute();
  const key = JSON.stringify(route);
  if (coalesce && activeLoad?.key === key) return activeLoad.promise;
  cancelRead();
  const record = {
    key,
    route,
    controller: new AbortController(),
    generation: ++app.generation,
    // Only a successful session mutation supplies this explicit actor. Do not
    // replace app.bootstrap or infer authority before the fresh read agrees.
    capturedWallet:
      acknowledgedWallet === undefined
        ? (currentIdentity()?.wallet ?? null)
        : acknowledgedWallet,
    hasCapturedSession:
      acknowledgedWallet !== undefined || app.bootstrap !== null,
    capturedMode: app.bootstrap?.mode ?? null,
    capturedInstanceId: app.bootstrap?.instanceId ?? null,
    focusIntent:
      navigationFocus?.hash === location.hash ? navigationFocus : null,
    focusedElement: document.activeElement,
    promise: null,
  };
  navigationFocus = null;
  activeLoad = record;
  setReadBusy(true);
  record.promise = loadView(record, silent).finally(() => {
    if (activeLoad === record) {
      activeLoad = null;
      setReadBusy(false);
      if (
        record.restoreRefresh &&
        document.activeElement === document.body &&
        !$("#review-dialog").open
      )
        $("#refresh").focus();
    }
  });
  return record.promise;
}
function mayRestoreFocus(record) {
  return (
    !$("#review-dialog").open &&
    (document.activeElement === document.body ||
      document.activeElement === record.focusedElement)
  );
}
async function loadView(record, silent) {
  const preserveCatalog =
    publicCatalogScreen() && !record.route.eventId && !record.route.setup;
  if (record.route.eventId || record.route.setup) displayCatalog = null;
  app.batchRegistrationSelection = null;
  app.submittedRecovery = null;
  $("[data-submitted-recovery]")?.remove();
  disposeContractInbox();
  const generation = record.generation;
  invalidateDraft();
  app.route = record.route;
  if (!silent && !preserveCatalog) {
    loadingStage(
      "Checking your event network…",
      app.route.eventId ? "Opening your event" : "Opening your events",
    );
    $("#loading").hidden = false;
    $("#content").hidden = true;
  }
  try {
    if (!record.route.eventId && !record.route.setup) {
      app.bootstrap = null;
      app.detail = null;
      const identity = $("#top-identity");
      identity.hidden = true;
      identity.disabled = true;
      identity.onclick = null;
      let rawCatalog;
      try {
        rawCatalog = await readForLoad("/api/public-catalog", record);
      } catch (error) {
        if (error.status !== 404) throw error;
        // An older/demo server has no catalog endpoint. Fall back once only.
      }
      if (generation !== app.generation) return;
      if (rawCatalog !== undefined) {
        const catalog = validatePublicCatalog(rawCatalog);
        const sameScope =
          publicSearch.scope ===
          JSON.stringify([catalog.mode, catalog.instanceId]);
        displayCatalog = catalog;
        // Public metadata must never become a wallet session or signing context.
        app.bootstrap = null;
        app.detail = null;
        setPublicSearchScope(catalog.mode, catalog.instanceId);
        publicSearch.entries = catalog.events;
        renderPublicCatalogChrome();
        if (preserveCatalog && sameScope && $("[data-public-catalog-screen]"))
          updatePublicEventResults();
        else $("#content").innerHTML = renderLaunchHome();
        $("#loading").hidden = true;
        $("#content").hidden = false;
        if (mayRestoreFocus(record) && record.focusIntent)
          $(record.focusIntent.selector)?.focus();
        document.title = "Find your event · Kleros";
        return;
      }
      displayCatalog = null;
    }
    const bootstrapPath = app.route.eventId
      ? `/api/bootstrap?${new URLSearchParams({ selectedEventId: app.route.eventId })}`
      : "/api/bootstrap";
    const bootstrap = await readForLoad(bootstrapPath, record);
    if (generation !== app.generation) return;
    record.readBootstrap = bootstrap;
    app.bootstrap = bootstrap;
    setPublicSearchScope(bootstrap.mode, bootstrap.instanceId);
    if (!isSandbox() && !isTestnet() && !isGuardedV9()) {
      updateHostedDemoNotice();
      throw new Error(
        "This application environment is unsupported. Wallet connection and financial review are unavailable.",
      );
    }
    if (Object.hasOwn(bootstrap, "session"))
      walletSessionObserved = bootstrap.session?.mode === "wallet";
    if (bootstrap.session?.mode === "wallet")
      installWalletSessionListeners(/** @type {any} */ (window).ethereum);
    updateHostedDemoNotice();
    if (bootstrap.instanceId) {
      if (app.pendingInstanceId !== bootstrap.instanceId) {
        app.pending = [];
        app.pendingInstanceId = bootstrap.instanceId;
      }
      try {
        const saved = JSON.parse(sessionStorage.getItem(pendingKey()) ?? "[]");
        if (Array.isArray(saved)) {
          const key = (item) =>
            item.id ??
            `${item.eventId}:${item.wallet}:${item.action}:${item.hash}`;
          const current = new Set(app.pending.map(key));
          app.pending = saved
            .filter((item) => !current.has(key(item)))
            .concat(app.pending)
            .slice(-50);
        }
      } catch {
        /* Preserve in-flight memory guards if this browser blocks sessionStorage. */
      }
    }
    const selectedSummary = bootstrap.events?.find(
      (event) => event.id === app.route.eventId,
    );
    loadingStage("Reading the selected event…", selectedSummary?.title);
    const bundled = selectedEventResult(bootstrap, {
      eventId: record.route.eventId,
      capturedWallet: record.capturedWallet,
      hasCapturedSession: record.hasCapturedSession,
    });
    if (bundled?.error)
      throw Object.assign(new Error(bundled.error.message), bundled.error);
    const detail =
      bundled?.detail ??
      (app.route.eventId
        ? await readForLoad(
            `/api/events/${encodeURIComponent(app.route.eventId)}`,
            record,
          )
        : null);
    if (generation !== app.generation) return;
    app.detail = detail;
    restoreTransactionJournal();
    let recoveredChange = false;
    loadingStage("Checking submitted transactions…");
    if (detail)
      for (const pending of app.pending.slice()) {
        if (
          pending.eventId !== app.route.eventId ||
          pending.status === "confirmed"
        )
          continue;
        if (
          pending.hash &&
          pending.draftId &&
          same(pending.wallet, currentIdentity()?.wallet) &&
          pending.status !== "failed"
        ) {
          const capturedContext = transactionContext(
            detail.event,
            pending.wallet,
          );
          try {
            const recovered = await post(
              `/api/events/${encodeURIComponent(pending.eventId)}/submissions/reconcile`,
              { draftId: pending.draftId, hash: pending.hash },
            );
            if (["confirmed", "failed"].includes(recovered.status)) {
              rememberPending({ ...pending, status: recovered.status });
              if (
                capturedContext &&
                transactionJournal?.get(capturedContext, pending.hash)
              )
                transactionJournal.update(capturedContext, pending.hash, {
                  status: recovered.status,
                  blockNumber: recovered.blockNumber,
                  error: null,
                });
              recoveredChange = true;
            }
          } catch {
            /* Keep an unresolved hash visible; never send again automatically. */
          }
        }
        const confirmed =
          detail.transactions.some(
            (tx) =>
              (tx.hash ?? tx.txHash) === pending.hash &&
              tx.status === "confirmed",
          ) ||
          detail.participants.some(
            (person) =>
              person.deposit?.verified &&
              person.deposit.txHash === pending.hash,
          );
        if (confirmed) {
          rememberPending({ ...pending, status: "confirmed" });
          const context = transactionContext();
          if (context && transactionJournal)
            try {
              if (transactionJournal.get(context, pending.hash))
                transactionJournal.update(context, pending.hash, {
                  status: "confirmed",
                  error: null,
                });
            } catch {}
        }
      }
    if (generation !== app.generation) return;
    if (recoveredChange) return load({ silent: true });
    // Decide before replacing DOM: a user may have moved focus during a read.
    const restoreNavigation = mayRestoreFocus(record);
    const latestFocus = silent ? focusKey(document.activeElement) : null;
    record.restoreRefresh =
      restoreNavigation && record.focusedElement === $("#refresh");
    sidebar();
    $("#content").innerHTML = app.detail ? renderEvent() : renderHome();
    $("#loading").hidden = true;
    $("#content").hidden = false;
    enhanceTables();
    disableUnreadyProductionActions();
    annotateHostedForms();
    mountOwnerContractInbox();
    mountOrganizerBatchActions();
    mountLaunchSetup();
    if (restoreNavigation && record.focusIntent)
      $(record.focusIntent.selector)?.focus();
    else if (silent && latestFocus && !$("#review-dialog").open)
      $(latestFocus)?.focus();
    document.title = app.detail
      ? `${app.detail.event.title} · Kleros`
      : "Kleros · Events & commitments";
  } catch (error) {
    if (generation !== app.generation || record.controller.signal.aborted)
      return;
    const restoreError = mayRestoreFocus(record);
    displayCatalog = null;
    $("#loading").hidden = true;
    $("#content").hidden = false;
    app.detail = null;
    app.submittedRecovery = submittedRecoveryFromManifest(record, error);
    if (app.submittedRecovery) sidebar();
    $("#content").innerHTML =
      `<div class="page-header"><div><div class="eyebrow">Event workbench</div><h1>We couldn’t load this view.</h1></div></div><div class="error-panel" role="alert">${escape(error.message)}</div>${renderSubmittedRecovery()}<div class="button-row"><button class="button button-primary" data-reload>Try again</button><a href="#" class="button button-secondary">${isProduction() ? "Deposit or setup" : "All events"}</a></div>`;
    if (restoreError) $("[data-reload]")?.focus();
  }
}

function renderHome() {
  if (publicHomePresentation()) return renderLaunchHome();
  const events = app.bootstrap.events;
  return `<div class="page-header"><div><div class="eyebrow">GOOD EVENTS. KEPT PROMISES.</div><h1>Events, with commitment.</h1><p class="intro">Find your event. Reserve a place. Show up.<br>Follow your kickback from attendance to payout.</p></div>${isSandbox() ? '<div class="header-actions"><button class="button button-primary" data-create-event><span aria-hidden="true">＋</span> Create local event</button></div>' : ""}</div>
    <ol class="quick-start" aria-label="How event commitments work"><li><span class="step-number">1</span><div><strong>Choose an event</strong><p>Each event keeps its own guest list and money.</p></div></li><li><span class="step-number">2</span><div><strong>Reserve your place</strong><p>Choose free entry or review a deposit. The host approves admission.</p></div></li><li><span class="step-number">3</span><div><strong>Attend & get a kickback</strong><p>Check in, review the attendance list and challenge a mistake if needed.</p></div></li></ol>
    <div class="section-heading"><h2>Choose your event</h2><span class="small">${events.length} independent events</span></div>
    <div class="event-grid">${events.map((event, index) => `<article class="event-card"><div class="event-visual theme-${index % 4}"><span class="visual-kicker">KLEROS / COMMUNITY</span><div class="visual-title">${escape(event.title)}</div><span class="event-sequence">${String(index + 1).padStart(2, "0")} / ${String(events.length).padStart(2, "0")}</span></div><div class="card-body"><div class="card-meta">${badge(phaseName(event.financialPhase), phaseStyle(event.financialPhase))}<span class="tiny-label">${escape(event.visibility ?? "public").toUpperCase()} · ${escape(event.editorialStatus ?? "published").toUpperCase()}</span></div><h3>${escape(event.title)}</h3><p>${escape(event.description ?? "")}</p><div class="event-facts"><span><i class="fact-icon" aria-hidden="true">◷</i>${escape(formatTime(event.startsAt, event.timezone))}</span><span><i class="fact-icon" aria-hidden="true">⌖</i>${escape(event.location ?? "Location to be announced")}</span><span><i class="fact-icon" aria-hidden="true">◇</i>Independent ${versionLabel(event)} contract · ${escape(short(event.contract))}</span></div><div class="card-footer"><div class="price">${eth(event.depositWei)} ${escape(currencySymbol())}<small>Optional commitment · free entry available</small></div><a href="#${new URLSearchParams({ event: event.id, view: "participant" })}" class="button button-secondary">Open event <span class="icon-arrow" aria-hidden="true">↗</span></a></div></div></article>`).join("")}</div>
    <div class="trust-strip"><div class="trust-icon" aria-hidden="true">◇</div><div>${isProduction() ? "<strong>Your wallet. Your Ethereum transactions.</strong><p>Review each event’s verified contract, ETH amount, policy and arbitration provider before depositing. Host approval, attendance and payment remain separate.</p>" : isTestnet() || isV9Testnet() ? "<strong>Your wallet. One clear next step.</strong><p>Open an event and connect a wallet with test tokens. Review the contract, policy and arbitration provider before a deposit. A verified payment is separate from host approval.</p>" : "<strong>New here? Try a demo identity.</strong><p>Open an event, then choose Alice to try a deposit or its organizer to manage guests. This sandbox uses valueless ETH and mock Court rulings. A verified payment is separate from host approval.</p>"}</div></div>
    ${renderDemoControls()}`;
}

function setPublicSearchScope(mode, instanceId) {
  const scope = JSON.stringify([mode, instanceId]);
  if (publicSearch.scope === scope) return;
  publicSearch.scope = scope;
  publicSearch.query = "";
  publicSearch.entries = Object.freeze([]);
}
function renderPublicCatalogChrome() {
  document.body.classList.remove("initial-shell");
  document.body.classList.add("launch-mode");
  document.body.classList.remove("hosted-shared-demo");
  hostedNoticeObserver?.disconnect();
  for (const notice of $$(
    "#hosted-demo-banner,#testnet-banner,#production-banner,#v9-testnet-banner",
  ))
    notice.remove();
  document.documentElement.style.removeProperty("--hosted-demo-notice-height");
  $("#sidebar-events").replaceChildren();
  $("#event-count").textContent = "—";
  $("#environment").textContent = "EVENT DIRECTORY";
  $("#breadcrumb").textContent = "Find your event";
  const identity = $("#top-identity");
  identity.hidden = true;
  identity.disabled = true;
  identity.onclick = null;
}
function renderLaunchHome() {
  if (app.route.setup)
    return '<section class="luma-launch" data-launch-root><a class="back-link" href="#">← Deposit or setup</a><div id="luma-setup"></div></section>';
  publicSearch.entries = publicCatalogScreen()
    ? displayCatalog.events
    : publicEventSearchEntries(app.bootstrap?.events);
  const matches = searchPublicEvents(publicSearch.entries, publicSearch.query);
  return `<section class="luma-launch" data-launch-root ${publicCatalogScreen() ? "data-public-catalog-screen" : ""}><div class="luma-launch-heading"><div class="eyebrow">KLEROS KICKBACK</div><h1>A deposit for your Luma event.</h1><p>Find your event, review its deposit and return to Luma.</p></div><section class="luma-launch-card public-event-search"><h2>Find your event</h2>${publicCatalogScreen() ? '<p class="field-help" data-public-catalog-note>Recorded event details only. Current status and wallet actions are checked when you open an event.</p>' : ""}<label for="public-event-search">Search by event name</label><div class="public-event-controls"><input id="public-event-search" type="search" data-public-event-search maxlength="120" autocomplete="off" placeholder="Event name" value="${escape(publicSearch.query)}" aria-controls="public-event-results"><button class="button button-secondary" type="button" data-public-event-clear ${publicSearch.query ? "" : "hidden"}>Clear search</button></div><p class="public-event-status" data-public-event-status role="status" aria-live="polite" aria-atomic="true">${escape(publicSearchStatus(matches.length))}</p><div id="public-event-results" data-public-event-results>${renderPublicEventResults(matches)}</div></section><section class="luma-launch-card"><h2>Organizing an event?</h2><p>Connect your Luma event to its own reviewed kickback contract.</p><a class="button button-secondary" href="#setup=kickback">Set up kickback</a></section></section>`;
}
function publicSearchStatus(count) {
  if (!publicSearch.entries.length) return "No public events yet.";
  return publicSearch.query.trim()
    ? `${count} matching public ${count === 1 ? "event" : "events"}.`
    : `${count} public ${count === 1 ? "event" : "events"}.`;
}
function renderPublicEventResults(entries) {
  if (!publicSearch.entries.length)
    return '<p class="public-event-empty">No public events yet.</p>';
  if (!entries.length)
    return `<p class="public-event-empty">No events match “${escape(publicSearch.query)}”. Try another name or clear your search.</p>`;
  return `<ul class="public-event-list">${entries.map((event) => `<li class="public-event-row" data-public-event-row><div class="public-event-copy"><h3>${escape(event.title)}</h3><p class="public-event-date">${event.startsAt && event.timezone ? escape(formatTime(event.startsAt, event.timezone)) : "Date unavailable"}</p><div class="public-event-meta"><span>${event.depositWei === null ? "Deposit unavailable" : `Event deposit: ${eth(event.depositWei)} ETH`}</span><span class="badge">${escape(event.statusLabel)}</span></div></div><a class="button button-secondary" data-public-event-open href="#${new URLSearchParams({ event: event.id, view: "participant" })}" aria-label="Open event: ${escape(event.title)}">Open event</a></li>`).join("")}</ul>`;
}
function updatePublicEventResults() {
  if (
    !publicHomePresentation() ||
    app.route.eventId ||
    app.route.setup ||
    publicSearch.scope !==
      JSON.stringify(
        publicCatalogScreen()
          ? [displayCatalog.mode, displayCatalog.instanceId]
          : [app.bootstrap?.mode, app.bootstrap?.instanceId],
      )
  )
    return;
  const results = $("[data-public-event-results]"),
    status = $("[data-public-event-status]");
  if (!results || !status) return;
  const entries = searchPublicEvents(publicSearch.entries, publicSearch.query);
  results.innerHTML = renderPublicEventResults(entries);
  status.textContent = publicSearchStatus(entries.length);
  $("[data-public-event-clear]").hidden = !publicSearch.query;
}
function mountLaunchSetup() {
  const host = $("#luma-setup");
  if (!host || !isProduction() || !app.route.setup || app.route.eventId) return;
  const scope = {
    generation: app.generation,
    instanceId: app.bootstrap?.instanceId,
    wallet: currentIdentity()?.wallet ?? null,
  };
  const current = () =>
    host.isConnected &&
    $("#luma-setup") === host &&
    isProduction() &&
    app.generation === scope.generation &&
    app.bootstrap?.instanceId === scope.instanceId &&
    !readRoute().eventId &&
    readRoute().setup &&
    (scope.wallet === null
      ? currentIdentity()?.wallet == null
      : same(currentIdentity()?.wallet, scope.wallet));
  lumaSetupController = mountLumaSetup(host, {
    bootstrap: app.bootstrap,
    isCurrent: current,
    request: api,
    provider: () => walletProvider(),
    beforeOpen: () => invalidateDraft(),
    onComplete: () => {
      if (current())
        toast("Event creation confirmed. Share the deposit link below.");
    },
  });
}
function launchPendingDeposit() {
  return app.pending
    .slice()
    .reverse()
    .find(
      (entry) =>
        entry.eventId === app.route.eventId &&
        entry.instanceId === app.bootstrap?.instanceId &&
        same(entry.wallet, currentIdentity()?.wallet) &&
        entry.action === "deposit" &&
        !["confirmed", "failed"].includes(entry.status),
    );
}
function launchDepositAction() {
  const action = ownWalletFacts()?.depositAction;
  const amountWei = launchWei(action?.amountWei);
  return action &&
    typeof action.eligible === "boolean" &&
    (!action.eligible || (amountWei !== null && BigInt(amountWei) > 0n))
    ? {
        eligible: action.eligible,
        amountWei,
        reasonCode:
          typeof action.reasonCode === "string" ? action.reasonCode : "",
        reason:
          typeof action.reason === "string"
            ? action.reason
            : "Refresh this event for deposit eligibility.",
      }
    : null;
}
function renderLaunchEvent() {
  const event = app.detail.event;
  if (event?.id !== app.route.eventId)
    return '<section class="luma-launch" data-luma-launch><div class="luma-launch-card" data-launch-state="unavailable"><h1>Verify the event link</h1><p>The returned event does not match this deposit link. No deposit or Luma return action is available.</p><button class="button button-secondary" data-reload>Refresh verified event</button></div></section>';
  return `<section class="luma-launch" data-luma-launch><a class="back-link" href="#">← Deposit or setup</a><header class="luma-launch-event"><div class="eyebrow">${app.route.view === "organizer" ? "ORGANIZER KICKBACK" : "EVENT DEPOSIT"}</div><h1>${escape(event.title)}</h1><p>${escape(formatTime(event.startsAt, event.timezone))} · ${escape(networkName())}</p></header>${app.route.view === "organizer" ? renderLaunchOrganizer() : renderLaunchParticipant()}</section>`;
}
function renderLaunchParticipant() {
  const { event, state } = app.detail;
  const identity = currentIdentity(),
    receipt = participantDeposit(app.detail, identity?.wallet),
    action = launchDepositAction();
  const pending = launchPendingDeposit(),
    returnUrl = lumaReturnUrl(event.lumaUrl);
  const issue = productionContextIssue(app.bootstrap, app.detail, {
    requireTransactions: true,
  });
  const snapshotIssue = productionContextIssue(app.bootstrap, app.detail, {
    requireWallet: true,
  });
  const portal =
    app.bootstrap?.capabilities?.lumaDepositPortal === true &&
    app.bootstrap?.capabilities?.walletFirstDeposits === true;
  const canonical = receipt.status === "confirmed" && !snapshotIssue;
  const canReview =
    !!identity &&
    !issue &&
    portal &&
    !!returnUrl &&
    action?.eligible === true &&
    knownAttendanceStandard(event.attendanceStandard) &&
    phaseName(state.phase) !== "Cancelled" &&
    !pending &&
    receipt.status !== "submitted" &&
    receipt.status !== "unavailable";
  let status = "ready",
    heading = "Review your event deposit",
    explanation =
      "Your wallet will show the exact amount and contract before you confirm.";
  if (!identity) {
    status = "connect";
    heading = "Connect your wallet";
    explanation =
      "Use your own standard Ethereum account. No name, email or registration form is needed here.";
  } else if (phaseName(state.phase) === "Cancelled") {
    status = "cancelled";
    heading = "This event is cancelled";
    explanation =
      "Review your current credit, confirmed returns and any still-owed payment below. A historical receipt does not establish a current commitment.";
  } else if (
    ownParticipant()?.admission === "declined" ||
    (action?.eligible !== true &&
      /REFUND|RETURNED|REJECT|DECLIN/i.test(action?.reasonCode ?? ""))
  ) {
    status = "not-eligible";
    heading = "Review your event and funds status";
    explanation =
      action?.reason ??
      "Do not submit a historical receipt as proof of a current commitment. Review the funds status below.";
  } else if (pending && !pending.hash) {
    status = "awaiting-wallet";
    heading = "Confirm in your wallet";
    explanation =
      "No transaction ID has been returned yet. Check the open wallet request before trying again.";
  } else if (pending || receipt.status === "submitted") {
    status = "pending";
    heading = "Your deposit is pending";
    explanation =
      "Keep the transaction ID. Check its receipt before trying another deposit.";
  } else if (canonical && action?.eligible !== true) {
    status = "confirmed";
    heading = "Deposit transaction confirmed";
    explanation =
      "Copy your transaction ID, then return to Luma to finish its registration steps. Host approval remains separate.";
  } else if (receipt.status === "failed") {
    status = "failed";
    heading = "The deposit did not succeed";
    explanation =
      "Check the reverted transaction and your wallet activity. Any new attempt needs a fresh review.";
  } else if (
    issue ||
    !portal ||
    (action?.eligible === true &&
      !knownAttendanceStandard(event.attendanceStandard)) ||
    receipt.status === "unavailable" ||
    !action ||
    !returnUrl
  ) {
    status = "unavailable";
    heading = "Deposit review is unavailable";
    explanation =
      issue ??
      (action?.eligible === true &&
      !knownAttendanceStandard(event.attendanceStandard)
        ? "The event attendance standard is missing or unsupported. New deposits are unavailable; existing funds and recovery remain accessible."
        : null) ??
      (!returnUrl
        ? "The organizer has not provided a valid Luma event link. Contact them before depositing."
        : "Refresh the verified event and wallet status before depositing.");
  } else if (!action.eligible) {
    status =
      phaseName(state.phase) === "Cancelled" ? "cancelled" : "not-eligible";
    heading = "No new deposit is needed";
    explanation = action.reason;
  }
  const hash =
    pending && !pending.hash
      ? null
      : canonical
        ? receipt.hash
        : (pending?.hash ?? receipt.hash);
  const showReturn =
    status === "confirmed" &&
    canonical &&
    !snapshotIssue &&
    portal &&
    action?.eligible === false &&
    !!returnUrl;
  return `<ol class="luma-launch-steps" aria-label="Deposit steps"><li>Connect wallet</li><li>Review deposit</li><li>Return to Luma</li></ol><section class="luma-launch-card luma-launch-state" data-launch-state="${status}" aria-labelledby="launch-state-title"><div class="luma-launch-terms"><span>Event commitment</span><strong>${eth(state.depositWei ?? event.depositWei)} ETH</strong></div><h2 id="launch-state-title">${escape(heading)}</h2><p>${escape(explanation)}</p>${action?.eligible && identity ? `<p>Amount to review now: <strong>${eth(action.amountWei)} ETH</strong></p>` : ""}<div class="luma-launch-actions">${!identity ? `<button class="button button-primary" data-connect-wallet ${productionConnectionIssue() ? "disabled" : ""}>Connect wallet</button>` : showReturn ? `<a class="button button-primary" data-launch-return href="${escape(returnUrl)}" target="_blank" rel="noopener noreferrer">Return to Luma ↗</a>` : canReview ? '<button class="button button-primary" data-tx="deposit">Review deposit</button>' : '<button class="button button-secondary" data-reload>Check status</button>'}</div>${identity ? `<p class="small mono">Wallet ${escape(short(identity.wallet))}</p>` : ""}${hash ? `<div class="luma-launch-receipt"><label for="launch-txhash">${canonical ? "Confirmed transaction ID" : "Transaction ID"}</label><input id="launch-txhash" data-launch-hash readonly value="${escape(hash)}"><button class="button button-secondary button-small" data-launch-copy>Copy transaction ID</button>${canonical ? `<p class="small">${eth(receipt.amountWei)} ETH · canonical receipt at block ${escape(receipt.blockNumber)}. A receipt does not establish admission or prove funds are still held.</p>` : '<p class="small">Wait for confirmation before submitting this reference on Luma.</p>'}</div>` : ""}<p class="field-help">Registration and admission stay on Luma. This page does not approve your place.</p></section>${renderLaunchFinancialDetails()}<details class="luma-launch-card disclosure"><summary>Contract, terms & safeguards</summary>${renderLaunchTerms()}</details>${isOwner() || isStaff() ? `<a class="text-link" href="#${new URLSearchParams({ event: event.id, view: "organizer" })}">Manage this event’s kickback</a>` : ""}`;
}
function renderLaunchTerms() {
  const { event, state } = app.detail;
  return `<dl class="details-list"><div><dt>Connected wallet</dt><dd class="mono">${escape(currentIdentity()?.wallet ?? "Not connected")}</dd></div><div><dt>Event ID</dt><dd class="mono">${escape(event.id)}</dd></div><div><dt>Event contract</dt><dd class="mono">${escape(event.contract)}</dd></div><div><dt>Network</dt><dd>${escape(networkName())} · ${escape(event.chainId)}</dd></div><div><dt>Event commitment</dt><dd>${eth(state.depositWei ?? event.depositWei)} ETH</dd></div><div><dt>Deposit deadline</dt><dd>${escape(formatTime(event.depositDeadline ?? event.startsAt, event.timezone))}</dd></div><div><dt>Policy</dt><dd class="mono">${escape(event.policyURI)}</dd></div></dl>${renderAttendanceStandard(event)}<p>Every transaction shows the event, wallet, exact ETH amount, recipient and policy before signing. Host admission and contract registration remain separate from a deposit.</p>${renderProductionDetails()}`;
}
function renderAttendanceStandard(event) {
  const text = attendanceStandardText(event?.attendanceStandard);
  return text
    ? `<div data-attendance-standard><h3>Attendance standard</h3><p>${escape(text)}</p><p class="small">Immutable event interval: ${escape(formatTime(event.startsAt, event.timezone))} — ${escape(formatTime(event.endsAt, event.timezone))}.</p></div>`
    : '<p class="notice warning" data-attendance-standard>The attendance standard is unavailable. New deposits are disabled; existing recovery rights remain accessible.</p>';
}
function renderLaunchFinancialDetails() {
  if (!currentIdentity()) return "";
  const { event, state } = app.detail,
    wallet = currentIdentity().wallet;
  const facts = ownWalletFacts(),
    person = ownParticipant(),
    phase = phaseName(state.phase);
  const credit = launchWei(facts?.pendingCreditWei),
    owed = launchWei(facts?.owedWei);
  const registered = !!person?.registered || isIn(state.stakers, wallet);
  const attended = !!person?.attended || isIn(state.attendees, wallet);
  const ownCase = state.cases?.find((item) => same(item.wallet, wallet));
  const noList =
    phase === "Open" &&
    isIn(state.activeStakers, wallet) &&
    Number(app.detail.now) > Number(event.claimDeadline);
  const challengeOpen =
    registered &&
    !attended &&
    !ownCase &&
    phase === "Listed" &&
    Number(app.detail.now) <= Number(state.challengeEndsAt);
  const delivery = participantPayments(wallet);
  return `<details class="luma-launch-card disclosure luma-launch-recovery"><summary>Your funds, refunds & attendance</summary><dl class="details-list"><div><dt>Unused payer credit</dt><dd>${credit === null ? "Unavailable" : `${eth(credit)} ETH`}</dd></div><div><dt>Still owed</dt><dd>${owed === null ? "Unavailable" : `${eth(owed)} ETH`}</dd></div><div><dt>Contract registration</dt><dd>${registered ? "Registered in this event" : "Not registered in the reward pool"}</dd></div><div><dt>Financial attendance</dt><dd>${attended ? "Included in contract attendance" : "Not established"}</dd></div><div><dt>Successful direct attendance payments</dt><dd>${delivery ? `${eth(delivery.attendance)} ETH` : "Verified history unavailable"}</dd></div><div><dt>Principal returns</dt><dd>${delivery ? `${eth(delivery.refunds)} ETH` : "Verified history unavailable"}</dd></div></dl><p>Unused credit, admitted commitments, held shares, owed transfers and successful payments are separate. A historical deposit receipt does not prove your current funding.</p>${phase === "Cancelled" ? "<p>This event is cancelled. Review confirmed returns, unused credit and any still-owed payment below.</p>" : ""}<div class="button-row">${credit !== null && BigInt(credit) > 0n ? '<button class="button button-secondary" data-recovery="withdrawPending">Review credit withdrawal</button>' : ""}${owed !== null && BigInt(owed) > 0n ? '<button class="button button-secondary" data-recovery="claim">Review owed payment</button>' : ""}${noList ? '<button class="button button-secondary" data-tx="emergencyWithdraw">Review no-list recovery</button>' : ""}${challengeOpen ? '<button class="button button-secondary" data-tx="challenge">Challenge missing attendance</button>' : ""}</div>${challengeOpen ? `<p>Challenge deadline: ${escape(contractDeadline(state.challengeEndsAt, event.timezone, event))}.</p>` : ""}${ownCase ? renderCase(ownCase) : ""}${renderPending()}</details>`;
}
function renderLaunchOrganizer() {
  if (!currentIdentity() || (!isOwner() && !isStaff()))
    return `<section class="luma-launch-card"><h2>Organizer access</h2><p>Connect the event financial owner or its authorized attendance staff wallet.</p><button class="button button-primary" data-connect-wallet>Connect organizer wallet</button></section>`;
  const { event, state, participants = [], attendance = [] } = app.detail;
  const owner = isOwner();
  return `<section class="luma-launch-card"><h2>Manage this kickback</h2><p>Admission and registration remain separate from trusted check-in and financial attendance.</p><a class="button button-secondary" href="#${new URLSearchParams({ event: event.id, view: "participant" })}">Open the participant deposit page</a></section><details class="luma-launch-card disclosure"><summary>Deposits & host approvals</summary>${renderDepositReview()}</details><details class="luma-launch-card disclosure"><summary>Admission, registration & attendance</summary><section id="people-review">${renderBatchHost("check-in")}<div id="people-batch-selection"><div class="table-scroll"><table><thead><tr><th>Wallet</th><th>Host approval</th><th>Registration</th><th>Check-in</th></tr></thead><tbody>${participants.map((person) => `<tr data-batch-person="${escape(person.id)}" data-batch-wallet="${escape(person.wallet)}"><td class="person-cell"><strong class="mono">${escape(person.wallet)}</strong></td><td>${owner ? `<select data-admission="${escape(person.id)}" aria-label="Host approval for ${escape(person.wallet)}">${["pending", "approved", "declined", "free"].map((value) => `<option value="${value}" ${person.admission === value ? "selected" : ""}>${value}</option>`).join("")}</select>` : escape(person.admission)}</td><td>${person.registered ? "Registered" : owner ? `<button class="button button-secondary button-small" data-launch-register="${escape(person.wallet)}" data-launch-participant="${escape(person.id)}" ${person.admission !== "approved" || !person.deposit?.verified ? "disabled" : ""}>Review registration</button>` : "Owner review required"}</td><td>${attendance.some((record) => record.participantId === person.id || same(record.wallet, person.wallet)) ? "Check-in recorded" : `<button class="button button-secondary button-small" data-checkin="${escape(person.id)}">Review check-in</button>`}</td></tr>`).join("")}</tbody></table></div></div></section>${owner ? '<div id="attendance-review"><p>Only eligible registered wallets with trusted observations are proposed. Review the exact list before signing.</p><button class="button button-primary" data-tx="postAttendance">Review attendance proposal</button><button class="button button-secondary" data-correction>Review an attendance correction</button></div>' : ""}</details><details class="luma-launch-card disclosure"><summary>Payouts & attendance disputes</summary>${renderCases()}</details>${owner ? '<details class="luma-launch-card disclosure"><summary>Cancellation & recovery</summary><p>Existing contract deadlines, reserves and unresolved-case protections apply to every review.</p><div class="button-row"><button class="button button-secondary" data-tx="cancel">Review cancellation</button><button class="button button-secondary" data-recovery="sweep">Review spare-funds return</button><button class="button button-secondary" data-recovery="transferOwnership">Review event financial ownership transfer</button><button class="button button-secondary" data-tx="acceptOwnership">Review event financial ownership acceptance</button></div></details>' : ""}<details class="luma-launch-card disclosure"><summary>Contract & upgrade safeguards</summary>${renderLaunchTerms()}</details>`;
}

function renderEventContext() {
  const { event, state, now } = app.detail;
  const hasChallengeWindow = Number(state.challengeEndsAt) > 0;
  const deadline = hasChallengeWindow
    ? state.challengeEndsAt
    : event.claimDeadline;
  const deadlineLabel = hasChallengeWindow
    ? Number(now) > Number(state.challengeEndsAt)
      ? "Omission challenge ended"
      : "Omission challenge ends"
    : "Attendance-list deadline";
  return `<section class="event-context" aria-label="Selected event and verified deployment"><div class="context-main"><div class="event-switch"><label for="event-switch">Your event</label><select id="event-switch">${app.bootstrap.events.map((item) => `<option value="${escape(item.id)}" ${item.id === event.id ? "selected" : ""}>${escape(item.title)}</option>`).join("")}</select></div><div class="context-status">${badge(phaseName(state.phase), phaseStyle(state.phase))} ${badge(`${networkName()} ${event.chainId}`, "purple")}</div></div>${testProfileNotice(event)}${renderProductionDetails()}<details class="disclosure context-verification" id="deployment-details"><summary>Contract, policy & verified details · ${versionLabel(event)}</summary><dl class="context-details"><div><dt>${isGuardedV9() && app.detail?.deploymentTrust?.status !== "verified" ? "Deployment verification unavailable" : "Deployment"} · ${escape(event.contractVersion)}</dt><dd class="mono">${escape(event.contract)}</dd></div><div><dt>${deadlineLabel}</dt><dd>${escape(contractDeadline(deadline, event.timezone, event))}</dd></div><div><dt>Last verified · block ${escape(state.blockNumber)}</dt><dd>${escape(formatTime(now, event.timezone))}</dd></div></dl><p>Event ID: <span class="mono">${escape(event.id)}</span><br>Policy: <span class="mono">${escape(event.policyURI)}</span></p><p>Native ${escape(currencySymbol())} · ${escape(isGuardedV9() ? arbitrationLabel() : "Kleros V1")} · ${escape(event.abiVersion)}. The attendance-list deadline governs posting and no-list recovery, not every later claim. Full transaction details are always shown before signing.</p>${isV8(event) ? "<p>This financial interface tracks each payer’s unused deposit credit. Credit can be withdrawn independently; an admitted commitment follows event recovery rules.</p>" : ""}</details></section>`;
}
function renderEvent() {
  if (isProduction()) return renderLaunchEvent();
  const { event, state } = app.detail;
  const phase = phaseName(state.phase);
  return `<a class="back-link" href="#">← All events</a>${renderEventContext()}<div class="event-heading"><div><div class="eyebrow">EVENT DETAILS</div><h1>${escape(event.title)}</h1><div class="event-subtitle"><span>◷ ${escape(formatTime(event.startsAt, event.timezone))}</span><span>⌖ ${escape(event.location ?? "")}</span></div></div></div>
    <div class="event-layout"><div class="event-main"><div class="tabs" role="tablist" aria-label="Event view">${[
      ["participant", "Your spot"],
      ["organizer", "Manage event"],
      ["cases", "Disputes & kickbacks"],
    ]
      .map(
        ([key, title]) =>
          `<button id="tab-${key}" class="tab ${key === app.route.view ? "active" : ""}" role="tab" tabindex="${key === app.route.view ? "0" : "-1"}" aria-controls="event-panel" aria-selected="${key === app.route.view}" data-view="${key}">${title}</button>`,
      )
      .join(
        "",
      )}</div><div id="event-panel" role="tabpanel" aria-labelledby="tab-${app.route.view}" tabindex="0">${app.route.view === "organizer" ? renderOrganizer() : app.route.view === "cases" ? renderCases() : renderParticipant()}</div></div><aside class="event-aside">${renderAside()}</aside></div>${renderDemoControls()}`;
}
function enhanceTables() {
  const source = $("#source-review"),
    people = $("#people-review"),
    deposit = $("#deposit-review"),
    attendance = $("#attendance-review");
  if (source && people) people.before(source);
  if (deposit && attendance) attendance.before(deposit);
  for (const table of $$("#content table")) {
    const labels = $$("thead th", table).map((item) => item.textContent);
    $$("thead th", table).forEach((item) => item.setAttribute("scope", "col"));
    $$("tbody tr", table).forEach((row) =>
      $$("td", row).forEach(
        (cell, index) => (cell.dataset.label = labels[index]),
      ),
    );
  }
}
function transactionContext(
  event = app.detail?.event,
  wallet = currentIdentity()?.wallet,
) {
  if (!event || !wallet || !app.bootstrap?.instanceId) return null;
  return {
    eventId: event.id,
    wallet,
    chainId: event.chainId,
    contract: event.contract,
    abiVersion: event.abiVersion,
    mode: app.bootstrap.mode,
    instanceId: app.bootstrap.instanceId,
  };
}
function restoreTransactionJournal() {
  const context = transactionContext();
  if (!context || !transactionJournal) return;
  try {
    for (const entry of transactionJournal.list(context)) {
      const existing = app.pending.find(
        (p) =>
          p.hash === entry.hash &&
          p.eventId === context.eventId &&
          same(p.wallet, context.wallet),
      );
      rememberPending({
        ...entry,
        ...context,
        id: existing?.id ?? `journal:${entry.draftId}`,
        status: ["confirmed", "failed"].includes(entry.status)
          ? entry.status
          : "submitted",
      });
    }
  } catch {
    /* Signing will show a storage error before a wallet prompt. */
  }
}
// Saved-review identities locate existing journal records only. They are never
// event summaries, verified financial profiles or authority to prepare a send.
function submittedRecoveryProfile(mode) {
  if (isProductionMode(mode))
    return { chainId: 1, version: "kleros-event-v9-uups", label: "Ethereum" };
  if (isV9TestnetMode(mode))
    return {
      chainId: 10200,
      version: "kleros-event-v9-uups-chiado",
      label: "Chiado",
    };
  return null;
}
function submittedRecoveryIdentity(bootstrap, eventId) {
  const expected = submittedRecoveryProfile(bootstrap?.mode);
  if (
    !expected ||
    !Array.isArray(bootstrap?.events) ||
    typeof eventId !== "string" ||
    !eventId
  )
    return null;
  const normal = bootstrap.events.filter((event) => event?.id === eventId);
  let identity, source;
  if (normal.length) {
    if (normal.length !== 1) return null;
    identity = normal[0];
    source = "events";
  } else {
    const saved = Array.isArray(bootstrap.recoveryEvents)
      ? bootstrap.recoveryEvents.filter((event) => event?.id === eventId)
      : [];
    if (saved.length !== 1) return null;
    identity = saved[0];
    source = "recoveryEvents";
  }
  if (
    identity.chainId !== expected.chainId ||
    typeof identity.contract !== "string" ||
    !/^0x[0-9a-f]{40}$/i.test(identity.contract) ||
    /^0x0{40}$/i.test(identity.contract) ||
    identity.contractVersion !== expected.version ||
    identity.abiVersion !== expected.version
  )
    return null;
  return { identity, source };
}
function submittedRecoveryFromManifest(record, error) {
  if (
    !transactionJournal ||
    !["UPGRADE_TRUST_MISMATCH", "SELECTED_EVENT_UNAVAILABLE"].includes(
      error?.code,
    )
  )
    return null;
  const bootstrap = record.readBootstrap;
  const session = bootstrap?.session;
  const expected = submittedRecoveryProfile(bootstrap?.mode);
  const address = (value) =>
    typeof value === "string" &&
    /^0x[0-9a-f]{40}$/i.test(value) &&
    !/^0x0{40}$/i.test(value);
  if (
    bootstrap !== app.bootstrap ||
    !expected ||
    typeof bootstrap.instanceId !== "string" ||
    !bootstrap.instanceId ||
    bootstrap.chain?.chainId !== expected.chainId ||
    session?.mode !== "wallet" ||
    !address(session.wallet) ||
    (record.capturedMode !== null && record.capturedMode !== bootstrap.mode) ||
    (record.capturedInstanceId !== null &&
      record.capturedInstanceId !== bootstrap.instanceId) ||
    (record.hasCapturedSession &&
      (!address(record.capturedWallet) ||
        !same(record.capturedWallet, session.wallet)))
  )
    return null;
  const eventId = record.route.eventId;
  const manifest = submittedRecoveryIdentity(bootstrap, eventId);
  if (!manifest) return null;
  const summary = manifest.identity;
  const selected = bootstrap.selectedEvent;
  if (
    selected &&
    (selected.eventId !== eventId ||
      selected.instanceId !== bootstrap.instanceId ||
      !address(selected.wallet) ||
      !same(selected.wallet, session.wallet))
  )
    return null;
  const context = Object.freeze({
    eventId,
    wallet: session.wallet,
    chainId: summary.chainId,
    contract: summary.contract,
    abiVersion: summary.abiVersion,
    mode: bootstrap.mode,
    instanceId: bootstrap.instanceId,
  });
  try {
    return {
      context,
      manifestSource: manifest.source,
      networkLabel: expected.label,
      generation: record.generation,
      title:
        manifest.source === "events" ? (summary.title ?? eventId) : eventId,
      entries: transactionJournal.list(context),
      checking: new Set(),
      journalError: null,
    };
  } catch (journalError) {
    return {
      context,
      manifestSource: manifest.source,
      networkLabel: expected.label,
      generation: record.generation,
      title:
        manifest.source === "events" ? (summary.title ?? eventId) : eventId,
      entries: [],
      checking: new Set(),
      journalError: journalError.message,
    };
  }
}
function renderSubmittedRecovery() {
  const recovery = app.submittedRecovery;
  if (!recovery || (!recovery.entries.length && !recovery.journalError))
    return "";
  const { context } = recovery;
  return `<section class="panel" data-submitted-recovery><h2>Submitted transactions</h2><p>New financial reviews are disabled while event verification is unavailable. These recorded hashes remain available. Checking an original submission does not send it again.</p><p>${escape(recovery.title)} · <span class="mono">${escape(context.eventId)}</span><br>${escape(recovery.networkLabel)} · chain ${escape(context.chainId)}<br>Event contract: <span class="mono">${escape(context.contract)}</span><br>Wallet: <span class="mono">${escape(context.wallet)}</span></p>${recovery.journalError ? `<div class="notice warning">${escape(recovery.journalError)} Preserve your wallet activity and transaction references.</div>` : `<ul class="transaction-log">${recovery.entries.map((entry) => `<li><strong>${escape(actionNames[entry.action] ?? entry.action ?? "Submitted transaction")}</strong><br><span class="mono">${escape(entry.hash)}</span><p data-reconcile-status="${escape(entry.hash)}" role="status">${entry.status === "confirmed" ? "Previously confirmed in this journal" : entry.status === "failed" ? "Previously recorded as reverted" : "Receipt verification pending · hash preserved"}</p><button class="button button-secondary button-small" data-reconcile-submission="${escape(entry.hash)}">Check submitted transaction</button></li>`).join("")}</ul>`}</section>`;
}
function submittedRecoveryCurrent(recovery) {
  const { context } = recovery;
  const manifest = submittedRecoveryIdentity(app.bootstrap, context.eventId);
  const summary = manifest?.identity;
  return (
    app.submittedRecovery === recovery &&
    app.generation === recovery.generation &&
    app.route.eventId === context.eventId &&
    readRoute().eventId === context.eventId &&
    app.bootstrap?.instanceId === context.instanceId &&
    app.bootstrap?.mode === context.mode &&
    currentIdentity()?.mode === "wallet" &&
    same(currentIdentity()?.wallet, context.wallet) &&
    manifest?.source === recovery.manifestSource &&
    summary?.chainId === context.chainId &&
    same(summary?.contract, context.contract) &&
    summary?.abiVersion === context.abiVersion
  );
}
async function reconcileSubmittedRecovery(hash, button) {
  const recovery = app.submittedRecovery;
  if (
    !recovery ||
    !submittedRecoveryCurrent(recovery) ||
    recovery.checking.has(hash)
  )
    return;
  const entry = recovery.entries.find((entry) => entry.hash === hash);
  if (!entry)
    throw new Error(
      "The submitted transaction does not belong to this recovery context.",
    );
  const { context } = recovery;
  recovery.checking.add(hash);
  button.disabled = true;
  const status = button.parentElement.querySelector("[data-reconcile-status]");
  status.textContent = "Checking the original submission…";
  try {
    const result = await post(
      `/api/events/${encodeURIComponent(context.eventId)}/submissions/reconcile`,
      { draftId: entry.draftId, hash: entry.hash },
    );
    if (
      !same(result?.hash, entry.hash) ||
      result?.eventId !== context.eventId ||
      !same(result?.wallet, context.wallet) ||
      result?.chainId !== context.chainId ||
      !same(result?.contract, context.contract) ||
      result?.draftId !== entry.draftId ||
      typeof result?.action !== "string" ||
      (typeof entry.action === "string" && result.action !== entry.action) ||
      result?.recovered !== true ||
      !["pending", "confirmed", "failed"].includes(result?.status) ||
      (["confirmed", "failed"].includes(result.status) &&
        (!Number.isSafeInteger(result.blockNumber) || result.blockNumber < 0))
    )
      throw new Error(
        "The receipt response did not match the original event transaction. Its recorded hash is preserved.",
      );
    if (result.status !== "pending") {
      transactionJournal.update(context, entry.hash, {
        status: result.status,
        blockNumber: result.blockNumber,
        error: null,
      });
      entry.status = result.status;
      entry.blockNumber = result.blockNumber;
    }
    if (!submittedRecoveryCurrent(recovery)) return;
    status.textContent =
      result.status === "pending"
        ? "Receipt still pending · hash preserved"
        : `${result.status === "confirmed" ? "Confirmed original transaction" : "Original transaction reverted"} · block ${result.blockNumber}.${result.verificationError ? " Detailed event verification remains unavailable." : ""}`;
  } catch (error) {
    if (!submittedRecoveryCurrent(recovery)) return;
    if ([401, 403].includes(error.status)) {
      app.submittedRecovery = null;
      $("[data-submitted-recovery]")?.remove();
      toast(error.message, true);
      return;
    }
    status.textContent = `${error.message} The recorded hash is preserved; no transaction was sent.`;
  } finally {
    recovery.checking.delete(hash);
    if (submittedRecoveryCurrent(recovery) && button.isConnected)
      button.disabled = false;
  }
}
function pendingKey(instanceId = app.bootstrap?.instanceId) {
  return `kleros-ui-pending:${location.origin}:${instanceId}`;
}
function rememberPending(entry) {
  const instanceId = entry.instanceId ?? app.bootstrap?.instanceId;
  const sameInstance = instanceId === app.bootstrap?.instanceId;
  let entries = app.pending;
  if (!sameInstance) {
    try {
      entries = JSON.parse(
        sessionStorage.getItem(pendingKey(instanceId)) ?? "[]",
      );
    } catch {
      entries = [];
    }
  }
  const key =
    entry.id ??
    `${entry.eventId}:${entry.wallet}:${entry.action}:${entry.hash}`;
  const next = entries
    .filter(
      (item) =>
        (item.id ??
          `${item.eventId}:${item.wallet}:${item.action}:${item.hash}`) !== key,
    )
    .concat({ ...entry, instanceId })
    .slice(-50);
  if (sameInstance) app.pending = next;
  if (instanceId) {
    try {
      sessionStorage.setItem(pendingKey(instanceId), JSON.stringify(next));
    } catch {
      /* In-memory references remain available in this tab. */
    }
  }
}
function pendingAction(
  action,
  eventId = app.route.eventId,
  wallet = currentIdentity()?.wallet,
) {
  return app.pending.find(
    (item) =>
      item.eventId === eventId &&
      same(item.wallet, wallet) &&
      item.action === action &&
      !["confirmed", "failed"].includes(item.status),
  );
}
function forgetPending(id, instanceId = app.bootstrap?.instanceId) {
  if (instanceId !== app.bootstrap?.instanceId) return;
  app.pending = app.pending.filter((item) => item.id !== id);
  if (app.bootstrap?.instanceId) {
    try {
      sessionStorage.setItem(pendingKey(), JSON.stringify(app.pending));
    } catch {
      /* Keep the current page usable without storage. */
    }
  }
}
function renderPending() {
  const entries = app.pending.filter(
    (item) =>
      item.eventId === app.route.eventId &&
      same(item.wallet, currentIdentity()?.wallet) &&
      item.status !== "confirmed",
  );
  return entries
    .map(
      (item) =>
        `<div class="notice warning" role="status"><strong>${item.status === "failed" ? "Transaction reverted · no successful action" : item.hash ? "Transaction submitted · receipt still needs verification" : "Wallet request unresolved · check your wallet"}</strong><p>${escape(actionNames[item.action] ?? item.action)} · <span class="mono">${escape(item.hash ?? "No transaction hash returned yet")}</span></p><p>Keep any transaction reference and check your wallet activity. Closing a review does not cancel a wallet request. Verify the original event before sending the same action again.</p></div>`,
    )
    .join("");
}
function renderAside() {
  const { event, state, now } = app.detail;
  const contractVersion = event.contractVersion ?? event.version ?? "v7";
  return `${isWalletEnvironment() ? `<section class="panel identity-panel"><div class="aside-title">Your wallet</div><p class="identity-address mono">${escape(currentIdentity()?.wallet ?? "No wallet connected")}</p><button class="button button-primary" data-connect-wallet>${currentIdentity() ? "Reconnect wallet" : "Connect wallet"}</button><p class="identity-hint">Only your wallet can sign for this account. ${isProduction() ? escape(walletSupportNotice()) : `Use test tokens on ${escape(networkName())}.`}</p></section>` : `<section class="panel identity-panel"><label for="identity-select">${isHostedDemo() ? "SHARED DEMO IDENTITY" : "LOCAL DEMO IDENTITY"}</label><select id="identity-select" data-identity>${identityOptions()}</select><div class="identity-address mono">${escape(currentIdentity()?.wallet ?? "No wallet selected")}</div><div class="identity-hint">${isHostedDemo() ? "Demo identities intentionally impersonate synthetic role accounts shared by all visitors. Connected wallets prove ownership with a nonce signature." : "Demo identities use funded local accounts; connected wallets prove ownership with a nonce signature."} A change of identity clears unsigned transaction drafts.</div></section>`}
    <section class="panel event-summary"><div class="aside-title">At a glance</div><dl class="details-list"><div><dt>Optional deposit</dt><dd><strong>${eth(state.depositWei ?? event.depositWei)} ${escape(currencySymbol())}</strong></dd></div><div><dt>Registered guests</dt><dd>${escape(state.stakerCount)}</dd></div><div><dt>Confirmed attendance</dt><dd>${escape(state.attendeeCount)}</dd></div>${state.remainingAdmissionSlots != null ? `<div><dt>New admission slots</dt><dd>${escape(state.remainingAdmissionSlots)}</dd></div>` : ""}</dl><p class="small muted">${isV8(event) ? "Unused credit stays yours. Admission commits only the required amount under the event policy." : "The host approves admission separately from your deposit."}</p><details class="disclosure"><summary>More event information</summary><p>Contract: <span class="mono">${escape(event.contract)}</span><br>Owner: <span class="mono">${escape(state.owner)}</span><br>Version: ${escape(contractVersion)}<br>Network: ${escape(networkName())} · ${escape(event.chainId)}</p>${state.pendingOwner && !/^0x0{40}$/i.test(state.pendingOwner) ? `<p>Pending owner: <span class="mono">${escape(state.pendingOwner)}</span></p>` : ""}<p>Chain time: ${escape(formatTime(now, event.timezone))}. Refresh to read verified changes.</p></details></section>
    <section class="panel"><details class="disclosure support-tools"><summary>Help & advanced tools</summary>${event.contractVersion === "truth-pays-v7" && isSandbox() ? `<a class="aside-link" href="/finance/${encodeURIComponent(event.id)}/guest/" target="_blank" rel="noopener">Advanced participant tools ↗</a>${isOwner() ? `<a class="aside-link" href="/finance/${encodeURIComponent(event.id)}/console/" target="_blank" rel="noopener">Advanced organizer console ↗</a>` : ""}` : '<p class="small muted">Use the main app for this contract version. Historical v7 guest and console tools are not compatible.</p>'}${safeLink(event.contentUrl) ? `<a class="aside-link" href="${escape(event.contentUrl)}" target="_blank" rel="noopener">Event content & materials ↗</a>` : ""}${safeLink(event.lumaUrl) ? `<a class="aside-link" href="${escape(event.lumaUrl)}" target="_blank" rel="noopener">Luma registration ↗</a>` : ""}<p class="small muted">Recordings, personal history and booth merch stay separate from financial attendance.</p></details></section>`;
}
function safeLink(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return ["https:", "http:"].includes(
      new URL(value, location.origin).protocol,
    );
  } catch {
    return false;
  }
}

function participantPayments(wallet) {
  const projection = app.detail?.payments;
  if (!projection || !wallet) return null;
  const rows = projection.transfers.filter(
    (t) => same(t.wallet, wallet) && t.successful,
  );
  const sum = (predicate) =>
    rows
      .filter(predicate)
      .reduce((total, t) => total + BigInt(t.amountWei), 0n);
  return {
    attendance: sum((t) => t.type === "attendance-payout"),
    refunds: sum((t) =>
      [
        "registered-principal-refund",
        "registered-no-list-refund",
        "unregistered-deposit-return",
      ].includes(t.type),
    ),
    claims: sum((t) => t.type === "owed-claim"),
    block: projection.blockNumber,
  };
}
function renderParticipant() {
  const { event, state, personal, attendance = [] } = app.detail;
  const identity = currentIdentity(),
    person = ownParticipant();
  const delivery = participantPayments(identity?.wallet);
  const registered =
    !!person?.registered || isIn(state.stakers, identity?.wallet);
  const attended =
    !!person?.attended || isIn(state.attendees, identity?.wallet);
  const deposit = person?.deposit,
    phase = phaseName(state.phase);
  const ownCase = state.cases?.find((item) =>
    same(item.wallet, identity?.wallet),
  );
  const walletFacts = ownWalletFacts();
  const owed = walletFacts?.owedWei ?? person?.owedWei ?? "0";
  const creditValue = walletFacts?.pendingCreditWei ?? person?.pendingCreditWei;
  const credit =
    isV8(event) && creditValue != null ? String(creditValue) : null;
  const observed =
    !!person &&
    attendance.some(
      (record) =>
        record.participantId === person.id ||
        same(record.wallet, person.wallet),
    );
  const pendingDeposit = app.pending.some(
    (item) =>
      item.eventId === event.id &&
      same(item.wallet, identity?.wallet) &&
      item.action === "deposit" &&
      !["confirmed", "failed"].includes(item.status),
  );
  const depositOpen =
    phase === "Open" &&
    Number(app.detail.now) <
      Number(event.depositDeadline ?? Date.parse(event.startsAt) / 1000);
  const challengeOpen =
    identity &&
    registered &&
    !attended &&
    !ownCase &&
    phase === "Listed" &&
    Number(app.detail.now) <= Number(state.challengeEndsAt);
  const noList =
    identity &&
    isIn(state.activeStakers, identity.wallet) &&
    phase === "Open" &&
    Number(app.detail.now) > Number(event.claimDeadline);
  const caseState = ownCase?.state;
  const disputeText = !ownCase
    ? "No attendance challenge"
    : caseState === "Waiting"
      ? "Waiting for a match"
      : caseState === "Disputed"
        ? ownCase.finalRuling == null
          ? isControlledArbitration()
            ? "Matched controlled test dispute · awaiting final result"
            : "Matched Court case open"
          : rulingNumber(ownCase.finalRuling) === null
            ? "Final ruling unavailable · refresh status"
            : "Final result · settlement pending"
        : "Challenge settled";
  const facts = [
    [
      "Admission",
      person
        ? ({
            approved: "Approved by host",
            free: "Approved free guest",
            declined: "Declined by host",
            pending: "Host decision pending",
          }[person.admission] ?? person.admission)
        : "No linked registration",
      "Host approval is separate from payment and contract registration.",
    ],
    [
      "Deposit receipt",
      deposit?.verificationState === "returned"
        ? "Principal returned · historical receipt confirmed"
        : deposit?.verified
          ? `${eth(deposit.amountWei)} ${escape(currencySymbol())} · confirmed`
          : pendingDeposit
            ? "Submitted · awaiting verification"
            : "No verified deposit",
      deposit?.verified
        ? `Receipt ${deposit.txHash}`
        : "A transfer alone never confirms admission.",
    ],
    [
      "Contract registration",
      registered
        ? "Registered in this event contract"
        : person?.admission === "free"
          ? "Outside the reward pool"
          : "Not registered on chain",
      "Only the event owner can register reviewed commitments.",
    ],
    [
      "Staff check-in",
      observed ? "Staff observation recorded" : "No staff observation recorded",
      "A trusted observation is evidence for the owner’s attendance review.",
    ],
    [
      "Financial attendance",
      attended
        ? "Included in on-chain attendance"
        : ownCase
          ? ownCase.state === "Resolved"
            ? "Excluded after final case settlement"
            : "Under attendance challenge"
          : "Not established on chain",
      "The contract’s list and case settlement determine financial attendance.",
    ],
    [
      "Attendance dispute",
      disputeText,
      ownCase?.state === "Waiting"
        ? `Separate matching deadline: ${contractDeadline(ownCase.matchEndsAt, event.timezone, event)}`
        : "Resolver finality and settlement are distinct.",
    ],
    [
      "Payout",
      BigInt(owed) > 0n
        ? `${eth(owed)} ${escape(currencySymbol())} still owed`
        : delivery?.attendance > 0n
          ? `${eth(delivery.attendance)} ${escape(currencySymbol())} directly paid`
          : delivery?.claims > 0n
            ? `${eth(delivery.claims)} ${escape(currencySymbol())} claimed`
            : delivery?.refunds > 0n
              ? `${eth(delivery.refunds)} ${escape(currencySymbol())} principal returned`
              : "No direct payout recorded",
      delivery
        ? `Canonical payment logs at block ${delivery.block}: ${eth(delivery.attendance)} ${escape(currencySymbol())} direct attendance payments; ${eth(delivery.refunds)} ${escape(currencySymbol())} principal refunds; ${eth(delivery.claims)} ${escape(currencySymbol())} claimed. Claims can combine credit types.`
        : "Verified payment history is unavailable. Check confirmed receipts and owed credits for delivery.",
    ],
  ];
  let next = {
    title: "Await the next event update",
    reason:
      "No participant action is eligible in this snapshot. Refresh for payment updates. A recorded payment does not mean all cases or possible later top-ups are complete.",
    control:
      '<button class="button button-secondary" data-reload>Refresh status</button>',
  };
  if (!identity)
    next = {
      title: "View your participation",
      reason: isWalletEnvironment()
        ? `Connect your wallet to read your place and review actions on ${networkName()}.`
        : "Choose a local demo identity or authenticate your wallet to read your event-specific state.",
      control: `<button class="button button-primary" data-choose-identity>${isWalletEnvironment() ? "Connect wallet" : "Choose demo identity"}</button>`,
    };
  else if (phase === "Cancelled")
    next = {
      title: "Review the cancellation outcome",
      reason: isV8(event)
        ? "Committed refunds and failed-transfer credits follow the event contract. Any unused deposit credit can be withdrawn independently."
        : "Registered-staker refunds and any failed-transfer credits follow the contract. Unregistered payer returns need a separate organizer review.",
      control: `<a class="button button-primary" href="#${new URLSearchParams({ event: event.id, view: "cases" })}">View refunds & obligations →</a>`,
    };
  else if (!person && BigInt(owed) === 0n)
    next = {
      title: "Link your registration for this event",
      reason:
        "Create an event registration tied to your authenticated wallet. Host admission is a separate decision.",
      control:
        '<button class="button button-primary" data-start-registration>Enter registration details</button>',
    };
  else if (BigInt(owed) > 0n)
    next = {
      title: "Recover your owed payment",
      reason:
        "A failed transfer remains reserved for your wallet. Review this or an alternate receiving address.",
      control:
        '<button class="button button-primary" data-recovery="claim">Review owed payment</button>',
    };
  else if (noList)
    next = {
      title: "Review no-list recovery",
      reason:
        "The attendance-list deadline passed while the contract remains Open. The contract checks your withdrawal eligibility.",
      control:
        '<button class="button button-primary" data-tx="emergencyWithdraw">No-list recovery</button>',
    };
  else if (ownCase)
    next = {
      title: disputeText,
      reason:
        "Follow the case deadline, evidence and settlement steps. Ordinary kickbacks can be paid while matched-case shares stay protected; later rulings may add payments.",
      control: `<a class="button button-primary" href="#${new URLSearchParams({ event: event.id, view: "cases" })}">View your attendance case →</a>`,
    };
  else if (challengeOpen)
    next = {
      title: "Missing from the attendance list?",
      reason: `If you attended, challenge by ${contractDeadline(state.challengeEndsAt, event.timezone, event)}. Current contract challenge deposit: ${eth(state.challengeDepositWei)} ${escape(currencySymbol())}.`,
      control:
        '<button class="button button-primary" data-tx="challenge">Challenge omission</button>',
    };
  else if (person?.admission === "free")
    next = {
      title: "Your free admission is approved",
      reason:
        "No deposit or reward-pool registration is required. Check in with event staff when you arrive.",
      control:
        '<button class="button button-secondary" data-reload>Refresh status</button>',
    };
  else if (person?.admission === "declined")
    next = {
      title: "Admission was declined",
      reason: isV8(event)
        ? "Do not send a new deposit. Your unused credit remains available for independent withdrawal."
        : "Do not send a new deposit. Any unregistered payment needs the organizer’s reviewed return process.",
      control:
        '<button class="button button-secondary" data-reload>Refresh status</button>',
    };
  else if (deposit?.verified && !registered)
    next = {
      title:
        person?.admission === "approved"
          ? "Await contract registration"
          : "Deposit received · admission pending",
      reason:
        "Your receipt is verified. The organizer must approve admission and separately register your wallet before it enters the financial pool.",
      control:
        '<button class="button button-secondary" data-reload>Refresh status</button>',
    };
  else if (pendingDeposit)
    next = {
      title: "Check your pending deposit",
      reason:
        "A wallet request or submitted transaction remains unresolved. Check your wallet and any receipt reference before trying again.",
      control:
        '<button class="button button-secondary" data-reload>Refresh status</button>',
    };
  else if (person && !registered && depositOpen)
    next = {
      title: "Review an optional commitment",
      reason:
        "A commitment requires receipt verification and host approval. A free route remains outside the reward pool.",
      control:
        '<button class="button button-primary" data-tx="deposit">Review deposit <span aria-hidden="true">↗</span></button>',
    };
  else if (registered && phase === "Open")
    next = {
      title: observed
        ? "Your staff check-in is recorded"
        : "You’re registered · check in at the event",
      reason:
        "Financial attendance will be established through the owner’s on-chain proposal and any challenges.",
      control:
        '<button class="button button-secondary" data-reload>Refresh status</button>',
    };
  if (
    credit !== null &&
    BigInt(credit) > 0n &&
    (!person ||
      phase === "Cancelled" ||
      person?.admission === "declined" ||
      registered)
  )
    next = {
      title: "Your unused deposit credit is available",
      reason: `${eth(credit)} ${escape(currencySymbol())} belongs to your wallet outside the committed reward pool. You can withdraw it without organizer approval. Your admitted commitment, if any, stays separate.`,
      control:
        '<button class="button button-primary" data-recovery="withdrawPending">Review credit withdrawal</button>',
    };
  const paid = (delivery?.attendance ?? 0n) > 0n;
  const journey = [
    {
      title: "Reserve a place",
      done: Boolean(
        deposit?.verified || registered || person?.admission === "free",
      ),
      status:
        person?.admission === "free"
          ? "Free entry selected"
          : deposit?.verified
            ? `${eth(deposit.amountWei)} ${escape(currencySymbol())} receipt confirmed`
            : pendingDeposit
              ? "Deposit confirmation pending"
              : "Optional deposit or free entry",
    },
    {
      title: "Get host approval",
      done: Boolean(registered || person?.admission === "free"),
      status: registered
        ? "Approved & registered on chain"
        : person?.admission === "approved"
          ? "Approved · registration still pending"
          : person?.admission === "free"
            ? "Approved outside the reward pool"
            : person?.admission === "declined"
              ? "Admission declined"
              : "Host decision pending",
    },
    {
      title: "Attend the event",
      done: attended,
      status: attended
        ? "Financial attendance confirmed"
        : observed
          ? "Staff check-in recorded · list pending"
          : "Check in with event staff",
    },
    {
      title: "Track your kickback",
      done: paid,
      status: paid
        ? "Payment recorded · top-ups may follow"
        : (delivery?.claims ?? 0n) > 0n
          ? "Claim paid · see status details"
          : BigInt(owed) > 0n
            ? `${eth(owed)} ${escape(currencySymbol())} still owed`
            : ownCase && ownCase.state !== "Resolved"
              ? "Your attendance case is open"
              : "Payment not yet recorded",
    },
  ];
  const currentStep = journey.findIndex((step) => !step.done);
  return `${renderPending()}<section class="panel next-action" aria-labelledby="next-action-title"><div class="eyebrow">Your next action</div><h2 id="next-action-title">${escape(next.title)}</h2><p>${escape(next.reason)}</p>${next.control}</section>
    <ol class="participation-steps" aria-label="Your event journey">${journey.map((step, index) => `<li class="${step.done ? "complete" : index === currentStep ? "current" : ""}" ${index === currentStep ? 'aria-current="step"' : ""}><span class="step-number" aria-hidden="true">${step.done ? "✓" : index + 1}</span><div><strong>${escape(step.title)}</strong><small>${escape(step.status)}</small></div></li>`).join("")}</ol>
    <section class="panel spot-details"><div class="panel-header"><div><h2>Your place at this event</h2><p>Your payment, host approval and attendance are tracked separately.</p></div>${person ? badge(person.admission ?? "pending", person.admission === "approved" ? "green" : "amber") : badge("Not registered")}</div><details class="disclosure status-details"><summary>All status details · 7 independent checks</summary><dl class="state-grid">${facts.map(([label, value, note]) => `<div class="state-fact"><dt>${escape(label)}</dt><dd><strong>${escape(value)}</strong><p>${escape(note)}</p></dd></div>`).join("")}</dl></details>${credit !== null ? `<div class="credit-summary"><div><strong>${eth(credit)} ${escape(currencySymbol())} unused credit</strong><p>Held for your wallet outside the admitted pool. Withdraw it independently at any phase.</p></div>${identity && BigInt(credit) > 0n ? '<button class="button button-secondary button-small" data-recovery="withdrawPending">Withdraw credit</button>' : ""}</div>` : ""}
    ${identity && !person ? `<form data-form="registration"><h3>Link your event registration</h3><div class="form-grid"><div><label for="reg-name">Name</label><input id="reg-name" name="name" required maxlength="120" autocomplete="name" placeholder="Your name"></div><div><label for="reg-email">Email</label><input id="reg-email" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.invalid"></div></div><p class="field-help">This event record links your authenticated wallet. Host admission remains pending.</p><button class="button button-primary" type="submit">Register interest</button></form>` : ""}
    <div class="amount-block"><div><small>OPTIONAL COMMITTED SPOT</small><strong>${eth(state.depositWei)} <span>${escape(currencySymbol())}</span></strong></div><span class="small">${deposit?.verified ? "Deposit verified" : depositOpen ? "Admission reviewed separately" : "Deposit window closed"}</span></div>
    ${identity && person ? `<details class="disclosure"><summary>Verify an existing deposit receipt</summary><form data-form="receipt"><label for="receipt-hash">Transaction hash</label><input id="receipt-hash" name="txHash" required pattern="0x[a-fA-F0-9]{64}" placeholder="0x…"><div class="button-row"><button class="button button-secondary button-small">Verify receipt</button></div></form></details>` : ""}
    ${same(state.pendingOwner, identity?.wallet) ? '<button class="button button-secondary" data-tx="acceptOwnership">Accept pending ownership</button>' : ""}</section>
    <section class="panel"><h2>Attend without a deposit</h2><p>Free guests need host approval and stay outside the deposited reward pool. Browsing this route does not require a wallet.</p>${safeLink(event.lumaUrl) ? `<a class="button button-secondary" href="${escape(event.lumaUrl)}" target="_blank" rel="noopener">Request a free place on Luma ↗</a>` : '<div class="notice">Free requests are handled by the organizer. No wallet-free signup service is connected here.</div>'}</section>
    <details class="panel event-story event-story-details"><summary>About the event & materials</summary><p>${escape(event.description ?? "")}</p>${safeLink(event.contentUrl) ? `<a class="button button-secondary" href="${escape(event.contentUrl)}" target="_blank" rel="noopener">Talks, recordings, materials & Q&A ↗</a>` : '<p class="small muted">No content or recordings link is configured for this event.</p>'}</details>
    <section class="panel"><div class="panel-header"><div><h2>Your personal event history</h2><p>A private reminder, independent of deposits and trusted attendance.</p></div></div><button class="button button-secondary button-small" data-personal ${!identity ? "disabled" : ""}>${personal?.attended ? "✓ Marked as personally attended" : "I was there"}</button><p class="field-help">This self-reported record, newsletter consent and merch state have no financial effect.</p></section>`;
}

function renderOrganizer() {
  const {
    event,
    state,
    participants = [],
    attendance = [],
    imports = [],
  } = app.detail;
  const owner = isOwner();
  const staff = isStaff();
  if (!currentIdentity())
    return `<div class="panel"><h2>Manage your event</h2><p>${isWalletEnvironment() ? "Connect the event organizer or staff wallet. Your role is checked for this event." : "Select Organizer A, Organizer B or Staff A to explore event-specific authority."}</p><button class="button button-primary" data-choose-identity>${isWalletEnvironment() ? "Connect wallet" : "Choose demo identity"}</button></div>`;
  if (!owner && !staff)
    return `<div class="panel"><h2>This identity cannot manage this event.</h2><p>Financial actions belong to the selected event’s contract owner. Trusted door check-in requires an event-specific staff role.</p><div class="notice">Current wallet: <span class="mono">${escape(currentIdentity().wallet)}</span><br>Event owner: <span class="mono">${escape(state.owner)}</span></div><button class="button button-secondary" data-choose-identity>${isWalletEnvironment() ? "Connect another wallet" : "Switch demo identity"}</button></div>`;
  return `<nav class="workflow-steps" aria-label="Organizer reconciliation">${owner ? '<a class="workflow-step" href="#source-review" data-workflow="source-review">1 · Select source</a>' : '<span class="workflow-step" aria-disabled="true">1 · Source review · owner only</span>'}<a class="workflow-step" href="#people-review" data-workflow="people-review">2 · Reconcile people</a><a class="workflow-step" href="#deposit-review" data-workflow="deposit-review">3 · Review receipts</a><a class="workflow-step" href="#attendance-review" data-workflow="attendance-review">4 · Review transaction</a></nav><div class="access-banner"><span aria-hidden="true">◇</span><span>${owner ? "You are the contract owner for this event. Every financial action uses a fresh on-chain review." : "You are authorized door staff for this event. Financial signing remains with its contract owner."}</span></div>
    <section class="panel" id="people-review" tabindex="-1"><div class="panel-header"><div><div class="step-label">02 / Admission & verified deposits</div><h2>People, with evidence</h2><p>Only approved, verified commitments can become registered stakers.</p></div><span class="pill-note">${participants.length} people</span></div>${renderBatchHost("check-in")}<div id="people-batch-selection">${participants.length ? `<div class="table-scroll"><table><thead><tr><th>Participant</th><th>Deposit</th><th>Admission</th><th>Check-in</th></tr></thead><tbody>${participants.map((person) => `<tr data-batch-person="${escape(person.id)}" data-batch-wallet="${escape(person.wallet)}"><td class="person-cell"><strong>${escape(person.name)}</strong><small>${escape(short(person.wallet))}</small></td><td>${person.deposit?.verified ? `<strong>${eth(person.deposit.amountWei)} ${escape(currencySymbol())}</strong><br><span class="small muted">${escape(short(person.deposit.txHash))}</span>` : '<span class="muted">Not verified</span>'}${person.registered ? '<br><span class="badge green">Staker</span>' : ""}</td><td>${owner ? `<select aria-label="Admission for ${escape(person.name)}" data-admission="${escape(person.id)}">${["pending", "approved", "declined", "free"].map((admission) => `<option value="${admission}" ${person.admission === admission ? "selected" : ""}>${admission}</option>`).join("")}</select>` : badge(person.admission)}</td><td>${attendance.some((record) => record.participantId === person.id || same(record.wallet, person.wallet)) ? badge("Observed", "green") : `<button class="button button-secondary button-small" data-checkin="${escape(person.id)}">Check in</button>`}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><span class="empty-icon">◉</span>No linked participants yet.</div>'}</div><div class="button-row"><button class="button button-primary" data-tx="register" ${!owner ? "disabled" : ""}>Review staker registration</button><button class="button button-secondary" data-tx="reject" ${!owner ? "disabled" : ""}>Review rejection / refunds</button></div><p class="field-help">Changing admission alone does not write to the contract. Registration checks the successful receipt, exact event, linked wallet and duplicate financial evidence.</p></section>
    ${owner ? `<section class="panel" id="source-review" tabindex="-1"><div class="panel-header"><div><div class="step-label">01 / Source review</div><h2>Import guests or attendance</h2><p>Source hashes detect substitution. They do not prove which event an export came from.</p></div></div><form data-form="import"><div class="form-grid"><div><label for="import-kind">Import type</label><select id="import-kind" name="kind"><option value="attendance">Trusted attendance</option><option value="guests">Guest / deposit review</option></select></div><div><label for="import-event">Source event identity</label><input id="import-event" name="sourceEventId" value="${escape(app.route.eventId)}" placeholder="Stable source event ID"></div><div class="full"><label for="import-file">Choose a CSV (optional)</label><input id="import-file" type="file" accept=".csv,text/csv" data-csv-file><p class="field-help"><a href="${eventPath("/fixture?kind=attendance")}" download>Download this event’s synthetic attendance CSV</a> · <a href="${eventPath("/fixture?kind=guests")}" download>Guest fixture</a></p></div><div class="full"><label for="import-csv">CSV contents</label><textarea id="import-csv" name="csv" required spellcheck="false" placeholder="event_id,chain_id,contract,participant_id,email,wallet,checked_in_at,tx_hash,admission"></textarea></div></div><label class="checkbox-label"><input type="checkbox" name="reviewConfirmed"><span>I have reviewed the source event and export. If its origin cannot be verified automatically, record my provenance review. This cannot override a known event, contract or chain mismatch.</span></label><label for="review-note">Provenance review note</label><input id="review-note" name="reviewNote" minlength="8" placeholder="Where this export came from and how you verified it" maxlength="1000"><div class="button-row"><button class="button button-secondary" type="submit" data-import-preview>Validate & review import</button></div></form><div id="import-result" aria-live="polite"></div><div id="import-preview" tabindex="-1"></div>${imports.length ? `<details class="disclosure"><summary>${imports.length} recorded import ${imports.length === 1 ? "batch" : "batches"}</summary>${imports.map((batch) => `<p><strong>${escape(batch.kind ?? "import")}</strong> · ${escape(batch.status ?? batch.reviewStatus ?? "reviewed")}<br><span class="mono">${escape(batch.sourceHash ?? batch.sha256 ?? batch.id)}</span></p>`).join("")}</details>` : ""}</section>` : ""}
    <section class="panel" id="attendance-review" tabindex="-1"><div class="panel-header"><div><div class="step-label">04 / Attendance & payout review</div><h2>Publish the attendance proposal</h2><p>Only registered wallets with trusted observations enter this list.</p></div></div><div class="result-summary"><div><span>Trusted observations</span><strong>${attendance.length}</strong></div><div><span>Registered stakers</span><strong>${escape(state.stakerCount)}</strong></div><div><span>Registered pool</span><strong>${eth(state.poolWei)} <small>${escape(currencySymbol())}</small></strong></div></div><div class="button-row"><button class="button button-primary" data-tx="postAttendance" ${!owner ? "disabled" : ""}>Review attendance & share</button><button class="button button-secondary" data-correction ${!owner ? "disabled" : ""}>Correct an omission</button></div><p class="field-help">Posting starts the ${isTest15mVersion(event.contractVersion) ? "15-minute TEST ONLY" : contractProfileForEvent(event) ? "one-day" : "contract-defined"} omission challenge window. The preview validates current contract state and expected per-attendee share. An empty list is refused.</p></section>
    ${renderDepositReview()}${owner ? renderRecovery() : ""}`;
}

function renderDepositReview() {
  if (contractInboxEnabled())
    return `<section class="panel" id="deposit-review" tabindex="-1"><div class="panel-header"><div><div class="step-label">03 / Contract observations</div><h2>Deposits from this contract</h2><p>Discover payer wallets directly from this event’s confirmed deposit receipts. Guest links, admission and financial registration remain separate.</p></div></div>${renderBatchHost("approve-admission")}<div id="batch-registration-followup"></div><div id="contract-deposit-inbox"></div></section>`;
  const records = app.detail.deposits ?? [];
  return `<section class="panel" id="deposit-review" tabindex="-1"><div class="panel-header"><div><div class="step-label">03 / Receipt ledger</div><h2>Deposit reconciliation</h2><p>Successful receipts, returned amounts and current allocation, scoped to this contract.</p></div></div>${records.length ? `<div class="table-scroll"><table><thead><tr><th>Wallet</th><th>Received</th><th>Returned</th><th>Unallocated</th></tr></thead><tbody>${records.map((record) => `<tr><td class="person-cell"><strong class="mono">${escape(short(record.wallet))}</strong><small>${record.linked ? "Linked participant" : "Unmatched payer"}</small></td><td>${eth(record.receivedWei)} ${escape(currencySymbol())}</td><td>${eth(record.returnedWei)} ${escape(currencySymbol())}</td><td><strong>${eth(record.unallocatedWei)} ${escape(currencySymbol())}</strong></td></tr>`).join("")}</tbody></table></div>` : "<p>No deposit logs found for this event.</p>"}<dl class="details-list" style="margin-top:15px"><div><dt>Contract balance</dt><dd>${eth(app.detail.state.balanceWei)} ${escape(currencySymbol())}</dd></div><div><dt>Reserved</dt><dd>${eth(app.detail.state.reservedWei)} ${escape(currencySymbol())}</dd></div><div><dt>Spare, before a return</dt><dd>${eth(app.detail.state.spareWei)} ${escape(currencySymbol())}</dd></div></dl><p class="field-help">Unallocated ${escape(currencySymbol())} can include an unregistered payer or excess payment. Review original receipts and any previous returns before preparing a refund. ${isV8() ? "v8 reserves each payer’s unused credit. The payer can withdraw it independently; admitted commitments remain separate." : "A pooled v7 contract does not prove per-wallet deposit ownership."}</p>${isOwner() ? `<div class="button-row"><button class="button button-secondary button-small" data-recovery="refund">${isV8() ? "Review a spare-funds return" : "Review unmatched funds return"}</button></div>` : ""}</section>`;
}

function importProjection(detail) {
  return JSON.stringify({
    event: detail.event,
    participants: detail.participants,
    attendance: detail.attendance,
    imports: detail.imports,
  });
}
function renderImportPreview(review) {
  const { analysis: result, sourceHash, input } = review;
  const provenance =
    input.review?.confirmed && input.review.note.trim().length >= 8;
  return `<div class="section-heading"><h3>Reconciliation exceptions & consequences</h3>${badge(result.errors.length ? "Blocked" : "Preview only", result.errors.length ? "red" : "amber")}</div><p>Every source row is retained. “Outside reward pool” describes its financial effect; it is not silently removed from this import.</p><div class="exception-counts result-summary"><div><span>Source rows</span><strong>${result.rowCount}</strong></div><div><span>Blocked exceptions</span><strong>${result.errors.length}</strong></div><div><span>Outside pool / blocked</span><strong>${result.excludedCount}</strong></div></div>${result.errors.length ? `<div class="notice warning" role="alert"><strong>Correct these exceptions in the source</strong><ul>${result.errors.map((error) => `<li>${escape(error)}</li>`).join("")}</ul></div>` : ""}<div class="table-scroll"><table class="reconciliation-table"><caption>Source preview · selected event ${escape(review.eventId)}</caption><thead><tr><th>Row / participant</th><th>Receipt evidence</th><th>Admission</th><th>Review result</th></tr></thead><tbody>${result.rows.map((row) => `<tr><td><strong>${row.line} · ${escape(row.participantLabel)}</strong><br><code>${escape(row.wallet)}</code></td><td>${escape(row.receipt)}<br><code>${escape(row.txHash)}</code></td><td>${escape(row.admission)}</td><td>${badge(row.status, row.issues.length ? "red" : "amber")}<p>${escape(row.issues.join(" ") || row.exclusionReason || "Candidate for server validation; no financial registration is approved here.")}</p></td></tr>`).join("")}</tbody></table></div><div class="source-hash">SHA-256 · ${escape(sourceHash)}<br>Snapshot block · ${escape(review.blockNumber)}</div><div class="notice">${result.warnings.map(escape).join("<br>")}</div>${!provenance ? '<div class="notice warning">Record the provenance acknowledgment and a note of at least 8 characters in the source form, then validate again. A hash cannot establish origin.</div>' : `<p>Provenance review: ${escape(input.review.note)}</p>`}<div class="button-row"><button class="button button-primary" data-review-import ${result.errors.length || !provenance ? "disabled" : ""}>Review import consequences</button></div>`;
}
function assertImportSource(review) {
  const form = $('form[data-form="import"]');
  if (
    !form ||
    JSON.stringify([...new FormData(form)]) !== review.sourceValues
  ) {
    app.importReview = null;
    throw new Error(
      "Source contents changed. Validate the current source again.",
    );
  }
}
function reviewImportConsequences() {
  const review = app.importReview;
  if (
    !review ||
    review.eventId !== app.route.eventId ||
    !same(review.wallet, currentIdentity()?.wallet)
  )
    throw new Error("Review this event’s source again.");
  if (
    review.analysis.errors.length ||
    !review.input.review?.confirmed ||
    review.input.review.note.trim().length < 8
  )
    throw new Error("Resolve exceptions and provenance before continuing.");
  assertImportSource(review);
  showDialog(
    `<div class="dialog-eyebrow">Organizer import review</div><h2 id="dialog-title" class="dialog-title">Apply this reviewed import?</h2><p class="dialog-body-text">This records off-chain ${escape(review.input.kind)} for ${escape(app.detail.event.title)}. It does not register stakers or post financial attendance.</p><dl class="details-list"><div><dt>Stable event</dt><dd>${escape(review.eventId)}</dd></div><div><dt>Network / contract</dt><dd>${escape(networkName())} ${escape(app.detail.event.chainId)}<br><code>${escape(app.detail.event.contract)}</code></dd></div><div><dt>Source SHA-256</dt><dd class="mono">${escape(review.sourceHash)}</dd></div><div><dt>Rows / outside pool</dt><dd>${review.analysis.rowCount} / ${review.analysis.excludedCount}</dd></div><div><dt>Provenance note</dt><dd>${escape(review.input.review.note)}</dd></div></dl><div class="notice warning">The server validates all rows, receipts, current owner and duplicate evidence atomically. Any exception rejects the entire import. The server-owned preview binds these exact source bytes and current state. It still cannot authenticate Luma origin.</div><div class="dialog-buttons"><button class="button button-secondary" data-close>Cancel</button><button class="button button-primary" data-import-commit>Apply reviewed import</button></div>`,
  );
}
async function commitReviewedImport(button) {
  const review = app.importReview;
  if (
    !review ||
    review.eventId !== app.route.eventId ||
    !same(review.wallet, currentIdentity()?.wallet) ||
    review.generation !== app.generation
  )
    throw new Error("This source review is stale. Validate it again.");
  assertImportSource(review);
  button.disabled = true;
  const fresh = await api(eventPath(""));
  if (
    review !== app.importReview ||
    fresh.state.fingerprint !== review.fingerprint ||
    importProjection(fresh) !== review.projection
  )
    throw new Error(
      "Event data or contract state changed. Validate the source against a fresh snapshot.",
    );
  assertImportSource(review);
  if (!review.serverPreview?.id)
    throw new Error(
      "Prepare an authoritative server preview before applying this import.",
    );
  const result = await post(
    `/api/events/${encodeURIComponent(review.eventId)}/imports/${encodeURIComponent(review.serverPreview.id)}/commit`,
    { review: review.input.review },
  );
  if (
    review.eventId !== app.route.eventId ||
    review.generation !== app.generation
  )
    return;
  await load({ silent: true });
  if ($("#import-result"))
    $("#import-result").innerHTML =
      `<div class="notice success"><strong>Import applied · ${result.rows} rows</strong><p>${escape(result.limitation)}</p><div class="source-hash">${escape(result.batch.sourceHash)}</div></div>`;
  toast(
    "Import applied after atomic server validation. Financial transactions remain separate.",
  );
}
function renderMoneySummary() {
  const { state } = app.detail;
  const summaries = [
    [
      "Sent",
      app.detail.payments?.attendancePaidWei == null
        ? "Unavailable"
        : `${eth(app.detail.payments.attendancePaidWei)} ${escape(currencySymbol())}`,
      "Direct successful attendance payments from canonical contract logs. Claims, principal refunds and Court funds are separate; balance is not a sent total.",
    ],
    [
      "Reserved case shares",
      `${eth(state.heldBackWei)} ${escape(currencySymbol())}`,
      "Held shares for open matched cases after the ordinary batch. Before release, the pool remains reserved.",
    ],
    [
      "Still owed",
      `${eth(state.owedTotalWei)} ${escape(currencySymbol())}`,
      "Failed transfers remain claimable by the credited wallet, including to an alternate recipient.",
    ],
    [
      "Challenge escrow",
      `${eth(state.challengeEscrowWei)} ${escape(currencySymbol())}`,
      "Challenge and matching deposits. Appeal contributions go directly to the resolver; its balance is not included here.",
    ],
  ];
  if (isV8() && state.pendingTotalWei != null)
    summaries.push([
      "Unused deposit credit",
      `${eth(state.pendingTotalWei)} ${escape(currencySymbol())}`,
      "Protected for its original payers outside the admitted pool. Payers withdraw unused credit independently; it is not an attendance kickback.",
    ]);
  return `<div class="money-summary" aria-label="Money and obligations">${summaries.map(([label, value, note]) => `<div class="money-card"><span class="stat-label">${label}</span><strong>${escape(value)}</strong><p>${note}</p></div>`).join("")}</div>`;
}
function renderCases() {
  const { state, event } = app.detail;
  const cases = state.cases ?? [],
    owner = isOwner();
  const phase = phaseName(state.phase),
    now = Number(app.detail.now);
  const waiting = cases.some(
    (item) => item.state === "Waiting" && now <= Number(item.matchEndsAt),
  );
  const mayRelease =
    currentIdentity() &&
    phase === "Listed" &&
    now > Number(state.challengeEndsAt) &&
    !waiting;
  const own = ownParticipant();
  const ownOwed = ownWalletFacts()?.owedWei ?? own?.owedWei ?? "0";
  const expiredUnmatched = cases.filter(
    (item) => item.state === "Waiting" && now > Number(item.matchEndsAt),
  ).length;
  const pendingMatchingEnds = cases
    .filter(
      (item) => item.state === "Waiting" && now <= Number(item.matchEndsAt),
    )
    .map((item) => Number(item.matchEndsAt));
  const omissionEnds = Number(state.challengeEndsAt);
  const blockingDates = [
    phase === "Listed" && now <= omissionEnds ? omissionEnds : 0,
    ...pendingMatchingEnds,
  ].filter(Boolean);
  const blockingUntil = blockingDates.length
    ? Math.max(...blockingDates)
    : null;
  const payoutWait =
    phase === "Listed"
      ? `${blockingUntil ? `Ordinary payout review opens after ${formatDeadline(blockingUntil, event.timezone)}. ` : "The time windows are clear in this snapshot. "}${now <= omissionEnds ? `The omission window ends ${formatDeadline(omissionEnds, event.timezone)}. ` : ""}${pendingMatchingEnds.length ? `${pendingMatchingEnds.length} unmatched ${pendingMatchingEnds.length === 1 ? "challenge waits" : "challenges wait"} until ${formatDeadline(Math.max(...pendingMatchingEnds), event.timezone)}. ` : ""}${!currentIdentity() ? "Connect your wallet to review payouts. " : ""}A matched unresolved case can retain a protected share while ordinary attendees are paid. Fresh simulation is still required.`
      : phase === "Finalized"
        ? "The ordinary batch has been processed. Follow remaining cases, owed credits and any later top-up receipts."
        : phase === "Cancelled"
          ? "This event was cancelled. Review refunds, unused credit and owed payments instead of ordinary kickbacks."
          : "The attendance list has not been posted. Ordinary payouts require that confirmed list and the contract’s challenge windows.";
  return `${renderPending()}<section class="panel"><div class="panel-header"><div><div class="eyebrow">Money & obligations</div><h2>Kickbacks & payments</h2><p>See what was paid, what is protected and what still needs action.</p></div>${badge(phase === "Finalized" ? "Ordinary batch processed" : phase, phaseStyle(state.phase))}</div>${renderMoneySummary()}<dl class="details-list"><div><dt>Contract balance</dt><dd>${eth(state.balanceWei)} ${escape(currencySymbol())}</dd></div><div><dt>Total protected reserves</dt><dd>${eth(state.reservedWei)} ${escape(currencySymbol())}</dd></div><div><dt>Established attendees</dt><dd>${escape(state.attendeeCount)} wallets</dd></div><div><dt>Omission challenge ends</dt><dd>${state.challengeEndsAt ? escape(contractDeadline(state.challengeEndsAt, event.timezone, event)) : "Not opened · attendance list not posted"}</dd></div></dl><p class="small muted">Protected reserves include pool / held-share, owed-credit and challenge obligations${isV8() ? ", plus each payer’s unused deposit credit" : ""}. These figures describe different obligations; do not add overlapping reserves together. A Finalized phase does not establish that every case or payment is complete.</p><div class="button-row"><button class="button button-primary" data-tx="release" ${!mayRelease ? "disabled" : ""}>Review normal payouts</button><button class="button button-secondary" data-recovery="claim" ${!currentIdentity() || BigInt(ownOwed) === 0n ? "disabled" : ""}>Claim failed transfer</button></div>${!mayRelease ? `<p class="field-help payout-wait-reason">${escape(payoutWait)}</p>` : ""}${expiredUnmatched ? `<div class="notice expired-case-hint">${expiredUnmatched} expired unmatched ${expiredUnmatched === 1 ? "challenge is" : "challenges are"} eligible for settlement. If a normal payout preview exceeds the gas limit, use each case’s “Settle final / unmatched case” action below, then refresh and review payouts again. A failed simulation sends no transaction and leaves reserves protected.</div>` : ""}<div class="notice">Ordinary attendees can be paid while each unresolved matched case retains a full provisional share. Later losses redistribute top-ups; later winners receive the accumulated held share. Ruling 0 excludes attendance and splits the remaining challenge funds under ${versionLabel(event)}; that split is separate from attendance payout.</div></section>
    <section class="panel"><div class="panel-header"><div><h2>Attendance cases</h2><p>Waiting for a match, Court finality, settlement and delivery are distinct.</p></div><span class="pill-note">${cases.length} ${cases.length === 1 ? "case" : "cases"}</span></div>${cases.length ? cases.map(renderCase).join("") : '<div class="empty"><span class="empty-icon">◇</span><h3>No attendance cases</h3><p>Omitted registered participants can challenge after the attendance list is posted.</p></div>'}</section>
    ${owner ? renderRecovery() : ""}<section class="panel"><div class="panel-header"><div><h2>Transaction activity</h2><p>Confirmations recorded by this app for the selected event and wallet or role. Other on-chain activity may exist, and a confirmed action does not prove every transfer succeeded.</p></div></div>${renderTransactions()}</section>`;
}
function renderCase(item) {
  const owner = isOwner();
  const state =
    typeof item.state === "number"
      ? (["None", "Awaiting match", "Matched", "Resolved"][item.state] ??
        String(item.state))
      : item.state;
  const waiting = item.state === "Waiting" || item.state === 1;
  const matched = item.state === "Disputed" || item.state === 2;
  const hasCourtCase = item.matched === true;
  const resolved = item.state === "Resolved" || item.state === 3;
  const matchExpired = Number(app.detail.now) > Number(item.matchEndsAt);
  const hasRuling = item.finalRuling !== null && item.finalRuling !== undefined;
  const final = rulingNumber(item.finalRuling) !== null;
  const invalidRuling = hasRuling && !final;
  const title = invalidRuling
    ? "Final ruling unavailable · refresh status"
    : waiting
      ? matchExpired
        ? "Unmatched window expired · settlement available"
        : "Challenge waiting for a match"
      : matched
        ? final
          ? "Final result available · settlement pending"
          : isControlledArbitration()
            ? "Matched controlled test dispute · awaiting final result"
            : "Matched Court case open"
        : resolved
          ? "Challenge settled"
          : state;
  const statusNote = invalidRuling
    ? "The reported result is outside supported rulings 0, 1 and 2. Refresh the authoritative result before preparing settlement."
    : waiting
      ? isControlledArbitration()
        ? "No matched test dispute has been created. The separate matching window determines whether an unmatched challenge can be accepted at settlement."
        : "No Court case has been created. Its separate matching window determines whether an unmatched challenge can be accepted at settlement."
      : matched
        ? final
          ? "Resolver finality is verified. The event contract still needs a confirmed settlement transaction."
          : isControlledArbitration()
            ? "A controlled test-arbitrator vote or open appeal is not a final resolver ruling; no independent Kleros jury is used. The admitted pool stays protected, and a held share is allocated when ordinary payouts run."
            : "A current jury vote or open appeal is not a final resolver ruling. Ordinary payouts can proceed after the relevant windows while a share is reserved."
        : final
          ? "The challenge is settled on the event contract. Check owed credits and confirmed transfer records for delivery."
          : "This challenge was settled without a final matched resolver ruling. Expired unmatched challenges follow the acceptance path.";
  const caseWallet = escape(item.wallet);
  const publication =
    typeof item.publication === "object"
      ? item.publication.status
      : item.publication;
  return `<article class="case-card case-summary"><h3>${escape(title)}</h3><p>${escape(statusNote)}</p><div class="panel-header"><div><strong class="case-title">${escape(short(item.wallet))}</strong><span class="small muted">Participant attendance challenge</span></div>${badge(title ?? "Challenge", resolved ? "green" : "amber")}</div><dl class="details-list"><div><dt>Matching deadline</dt><dd>${escape(contractDeadline(item.matchEndsAt, app.detail.event.timezone))}</dd></div><div><dt>Challenge deposit</dt><dd>${eth(item.depositWei)} ${escape(currencySymbol())}</dd></div><div><dt>Reserved share</dt><dd>${eth(item.heldShareWei)} ${escape(currencySymbol())}</dd></div><div><dt>Resolver local ID</dt><dd><code>${!hasCourtCase ? "Not created · no matched case" : escape(item.localDisputeID ?? "Unavailable")}</code></dd></div><div><dt>Arbitrator dispute ID</dt><dd><code>${!hasCourtCase ? "Not created · no matched case" : escape(item.arbitratorDisputeID ?? "Unavailable")}</code></dd></div><div><dt>Final ruling</dt><dd>${!hasRuling ? "Not final" : invalidRuling ? "Unavailable · unsupported result" : escape(["0 · Refused / excluded", "1 · Attended", "2 · Absent"][rulingNumber(item.finalRuling)])}</dd></div></dl>${invalidRuling ? '<div class="button-row"><button class="button button-secondary button-small" data-reload>Refresh ruling status</button></div>' : ""}${isV8() || invalidRuling ? `<details class="disclosure case-source-details"><summary>Case organizer & source details</summary>${isV8() ? `<dl class="details-list"><div><dt>Organizer for this case</dt><dd class="mono">${escape(item.caseOrganizer ?? "Unavailable")}</dd></div></dl><p>The contract captured this organizer when the challenge opened. A later owner change does not rewrite this case identity.</p>` : ""}${invalidRuling ? `<p>Reported ruling, not accepted for settlement: <code>${escape(item.finalRuling)}</code></p>` : ""}</details>` : ""}<div class="button-row"><button class="button button-secondary button-small" data-tx="match" data-wallet="${caseWallet}" ${!currentIdentity() || invalidRuling || !waiting || matchExpired ? "disabled" : ""}>Review matching</button><button class="button button-primary button-small" data-tx="resolve" data-wallet="${caseWallet}" ${!currentIdentity() || invalidRuling || resolved || !((waiting && matchExpired) || (matched && final)) ? "disabled" : ""}>Settle final / unmatched case</button></div><div class="button-row"><button class="button button-secondary button-small" data-tx="passPeriod" data-wallet="${caseWallet}" ${!currentIdentity() || invalidRuling || !matched || final ? "disabled" : ""}>Advance expired appeal</button><button class="button button-secondary button-small" data-tx="deliverRuling" data-wallet="${caseWallet}" ${!currentIdentity() || invalidRuling || !matched || final ? "disabled" : ""}>Deliver final ruling</button></div>${renderCasePublication(item)}<details class="disclosure" ${!hasCourtCase ? "hidden" : ""}><summary>Evidence, publication & appeals</summary><p>Case metaevidence: <span class="mono">${escape(item.caseURI ?? "Not created")}</span><br>Publication: <strong>${escape(publication ?? "Not published")}</strong>. A computed CID does not establish IPFS availability.</p>${!isProduction() ? `<div class="button-row"><button class="button button-secondary button-small" data-publish="${caseWallet}">${publication ? "Retry / verify server copy" : "Store exact bytes on this server"}</button></div>` : ""}<form data-form="evidence" data-wallet="${caseWallet}">${isProduction() ? '<p class="field-help">Enter an evidence URI for a separately reviewed submission. File uploads are unavailable here.</p>' : `<label for="evidence-file-${caseWallet}">Store an evidence file on this server (optional)</label><input id="evidence-file-${caseWallet}" type="file" data-evidence-file><p class="field-help">Maximum 256 KiB. Stored by this app; it is not published to IPFS.</p>`}<label for="evidence-uri-${caseWallet}" style="margin-top:12px">Evidence URI</label><input id="evidence-uri-${caseWallet}" name="uri" required maxlength="2000" placeholder="/ipfs/CID/evidence.json"><div class="button-row"><button class="button button-secondary button-small" ${!currentIdentity() ? "disabled" : ""}>Review evidence submission</button></div></form>${renderAppealStatus(item)}<form data-form="appeal" data-wallet="${caseWallet}"><div class="form-grid"><div><label for="appeal-side-${caseWallet}">Ruling side</label><select id="appeal-side-${caseWallet}" name="side"><option value="1">1 · Attended</option><option value="2">2 · Absent</option><option value="0">0 · Refused</option></select></div><div><label for="appeal-amount-${caseWallet}">Contribution (${escape(currencySymbol())})</label><input id="appeal-amount-${caseWallet}" name="amount" inputmode="decimal" required placeholder="Enter contribution"></div></div><div class="button-row"><button class="button button-secondary button-small" ${!currentIdentity() ? "disabled" : ""}>Review direct appeal contribution</button><button class="button button-secondary button-small" type="button" data-tx="appealRewards" data-wallet="${caseWallet}" ${!currentIdentity() || (isGuardedV9() && !appealRewardsReady(item)) ? "disabled" : ""}>Review appeal rewards</button></div><p class="field-help">Contributions go directly from this wallet to the V1 resolver. A contribution is separate from the attendance share reserved by the event contract.</p></form></details>${owner && isSandbox() ? `<details class="disclosure"><summary>Local Court mock controls</summary><p>Only the local mock arbitrator can be driven here. A final mock ruling still requires settlement through the real ${versionLabel()} event contract.</p><div class="button-row">${[1, 2, 0].map((ruling) => `<button class="button button-secondary button-small" data-ruling="${ruling}" data-wallet="${caseWallet}">${["Refuse", "Attended", "Absent"][ruling]}</button>`).join("")}<button class="button button-secondary button-small" data-open-appeal="${caseWallet}">Open mock appeal period</button></div></details>` : ""}</article>`;
}

function renderCasePublication(item) {
  if (!isProduction()) return "";
  const status =
    item.publication && typeof item.publication === "object"
      ? item.publication
      : null;
  const actions = publicationActions(status);
  return `<details class="disclosure"><summary>Advanced · exact case artifact</summary><p data-case-publication-summary="${escape(item.wallet)}">${escape(status ? actions.label : "Not exported or uploaded by this app")}</p><p>Review the exact public JSON before any upload. A contract URI or upload acknowledgment does not establish gateway availability.</p><div class="button-row"><button class="button button-secondary button-small" data-case-artifact="review" data-case-wallet="${escape(item.wallet)}" ${!currentIdentity() ? "disabled" : ""}>Review / download exact JSON</button>${status && status.status !== "exported" && actions.canVerify ? `<button class="button button-secondary button-small" data-case-artifact="availability" data-case-wallet="${escape(item.wallet)}" ${!currentIdentity() ? "disabled" : ""}>Check gateway availability</button>` : ""}</div></details>`;
}
function closeCaseArtifactReview() {
  if (!caseArtifactReview) return;
  caseArtifactReview = null;
  caseArtifactGeneration++;
  if ($("#review-dialog").open) $("#review-dialog").close();
  $("#dialog-body").replaceChildren();
}
function caseArtifactCurrent(review) {
  const scope = review.scope,
    route = readRoute();
  return (
    caseArtifactReview === review &&
    review.generation === caseArtifactGeneration &&
    isProduction() &&
    app.generation === scope.generation &&
    app.unsignedReviewVersion === scope.unsignedReviewVersion &&
    app.bootstrap?.instanceId === scope.instanceId &&
    same(currentIdentity()?.wallet, scope.actorWallet) &&
    currentIdentity()?.mode === "wallet" &&
    app.route.eventId === scope.eventId &&
    route.eventId === scope.eventId &&
    app.route.view === scope.view &&
    route.view === scope.view &&
    app.detail?.event.id === scope.eventId &&
    app.detail.event.chainId === scope.chainId &&
    same(app.detail.event.contract, scope.contract) &&
    app.detail.event.contractVersion === scope.contractVersion
  );
}
function caseAttemptKey(record) {
  return `${record.artifact.scopeHash}:${record.artifact.sha256}`;
}
function acceptCaseArtifactRecord(review, record) {
  const key = caseAttemptKey(record);
  if (record.publication.uploadAttempted === true) caseUploadAttempts.add(key);
  else if (publicationActions(record.publication).canPublish)
    caseUploadAttempts.delete(key);
  review.record = record;
  const item = app.detail?.state?.cases?.find((item) =>
    same(item.wallet, review.scope.wallet),
  );
  if (item) item.publication = { ...record.publication };
  for (const node of $$("[data-case-publication-summary]"))
    if (same(node.dataset.casePublicationSummary, review.scope.wallet))
      node.textContent = publicationActions(record.publication).label;
}
function renderCaseArtifactReview(review) {
  if (!caseArtifactCurrent(review)) return;
  const { artifact, currentCase, publication } = review.record;
  const actions = publicationActions(publication),
    consumed = caseUploadAttempts.has(caseAttemptKey(review.record));
  const ids = (scope) =>
    scope.matched
      ? `Resolver local ID ${scope.localDisputeID} · arbitrator dispute ID ${scope.arbitratorDisputeID}`
      : "Waiting / unmatched · no case IDs created";
  showDialog(
    `<div class="dialog-eyebrow">PUBLIC CASE ARTIFACT · ETHEREUM</div><h2 class="dialog-title" id="dialog-title">Review exact case JSON</h2><div data-case-publication-review><p>Public IPFS publication may be permanent and cannot be reliably removed. Review every byte before consenting. Downloading only saves these exact bytes on your device.</p><dl class="details-list"><div><dt>Event / child contract</dt><dd>${escape(artifact.scope.eventId)}<br><span class="mono">${escape(artifact.scope.contract)}</span></dd></div><div><dt>Challenged wallet</dt><dd class="mono">${escape(artifact.scope.wallet)}</dd></div><div><dt>Signed-in reviewer</dt><dd class="mono">${escape(review.scope.actorWallet)}</dd></div><div><dt>Original artifact provenance</dt><dd>${escape(artifact.scope.instanceId)} · block ${escape(artifact.scope.blockNumber)}<br><span class="mono">${escape(artifact.scope.blockHash)}</span><br>${escape(ids(artifact.scope))}</dd></div><div><dt>Current canonical case</dt><dd>${escape(currentCase.instanceId)} · block ${escape(currentCase.blockNumber)}<br><span class="mono">${escape(currentCase.blockHash)}</span><br>${escape(ids(currentCase))}</dd></div><div><dt>Contract URI · no gateway request made by this view</dt><dd class="mono">${escape(artifact.uri)}</dd></div><div><dt>SHA256 / exact byte length</dt><dd class="mono">${escape(artifact.sha256)}<br>${escape(artifact.byteLength)} bytes</dd></div><div><dt>Original scope SHA256</dt><dd class="mono">${escape(artifact.scopeHash)}</dd></div></dl><pre class="review-code" data-case-publication-json>${escape(artifact.content)}</pre><p class="notice" data-case-publication-status role="status">${escape(consumed && publication.status === "exported" ? "An upload request may have been made. Verify the existing attempt; no automatic retry is permitted." : actions.label)}${publication.reason ? `<br>${escape(publication.reason)}` : ""}</p>${actions.canPublish && !consumed ? '<label><input type="checkbox" data-case-publication-consent> I reviewed this exact public JSON, SHA256, URI and case context, and consent to publishing these exact bytes publicly on IPFS, which may be permanent and cannot be reliably removed.</label>' : ""}<div class="dialog-buttons"><button class="button button-secondary" data-close>Close</button><button class="button button-secondary" data-case-publication="download">Download exact JSON</button><button class="button button-secondary" data-case-publication="availability">Check gateway availability</button><button class="button button-primary" data-case-publication="publish" disabled ${!actions.canPublish || consumed ? "hidden" : ""}>Publish reviewed bytes</button></div></div>`,
  );
}
async function openCaseArtifact(wallet, action = "review") {
  if (!isProduction() || !/^0x[0-9a-f]{40}$/i.test(wallet))
    throw new Error("Choose a production attendance case.");
  if (
    app.detail?.event.id !== app.route.eventId ||
    readRoute().eventId !== app.route.eventId
  )
    throw new Error(
      "The selected event changed. Refresh before reviewing its case artifact.",
    );
  const issue = productionContextIssue(app.bootstrap, app.detail, {
    requireWallet: true,
  });
  if (issue) throw new Error(issue);
  invalidateDraft();
  const event = app.detail.event;
  const review = {
    generation: ++caseArtifactGeneration,
    working: true,
    record: null,
    scope: Object.freeze({
      mode: app.bootstrap.mode,
      instanceId: app.bootstrap.instanceId,
      eventId: event.id,
      chainId: event.chainId,
      contract: event.contract,
      contractVersion: event.contractVersion,
      wallet,
      actorWallet: currentIdentity().wallet,
      generation: app.generation,
      unsignedReviewVersion: app.unsignedReviewVersion,
      view: app.route.view,
    }),
  };
  review.base = `/api/events/${encodeURIComponent(event.id)}/cases/${encodeURIComponent(wallet)}`;
  caseArtifactReview = review;
  try {
    const response = await post(
      review.base + (action === "availability" ? "/availability" : "/artifact"),
      {},
    );
    if (!caseArtifactCurrent(review)) return;
    const record = await validateCaseArtifact(response, review.scope);
    if (!caseArtifactCurrent(review)) return;
    acceptCaseArtifactRecord(review, record);
    review.working = false;
    renderCaseArtifactReview(review);
  } catch (error) {
    if (caseArtifactCurrent(review)) {
      closeCaseArtifactReview();
      toast(error.message, true);
    }
  }
}
async function casePublicationAction(action) {
  const review = caseArtifactReview;
  if (
    !review ||
    !caseArtifactCurrent(review) ||
    review.working ||
    !review.record
  )
    return;
  const artifact = review.record.artifact;
  if (action === "download") {
    const url = URL.createObjectURL(
      new Blob([new TextEncoder().encode(artifact.content)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `case-${artifact.scope.eventId}-${artifact.scope.wallet}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const publish = action === "publish";
  if (!publish && action !== "availability") return;
  if (
    publish &&
    (!publicationActions(review.record.publication).canPublish ||
      caseUploadAttempts.has(caseAttemptKey(review.record)) ||
      !$("[data-case-publication-consent]")?.checked)
  )
    throw new Error(
      "Review and consent to the exact original artifact before publishing.",
    );
  review.working = true;
  for (const button of $$("[data-case-publication]", $("#dialog-body")))
    button.disabled = true;
  if (publish) caseUploadAttempts.add(caseAttemptKey(review.record));
  try {
    if (!caseArtifactCurrent(review)) return;
    const response = await post(
      review.base + (publish ? "/publish" : "/availability"),
      publish ? { sha256: artifact.sha256, scopeHash: artifact.scopeHash } : {},
    );
    if (!caseArtifactCurrent(review)) return;
    const validated = await validateCaseArtifact(response, review.scope);
    if (!caseArtifactCurrent(review)) return;
    if (
      validated.artifact.sha256 !== artifact.sha256 ||
      validated.artifact.scopeHash !== artifact.scopeHash ||
      validated.artifact.content !== artifact.content
    )
      throw new Error(
        "The original reviewed artifact changed. No further upload is permitted.",
      );
    acceptCaseArtifactRecord(review, validated);
    review.working = false;
    renderCaseArtifactReview(review);
  } catch (error) {
    if (!caseArtifactCurrent(review)) return;
    if ([401, 403].includes(error.status)) {
      closeCaseArtifactReview();
      toast(error.message, true);
      return;
    }
    review.working = false;
    if (publish)
      review.record = {
        ...review.record,
        publication: {
          ...review.record.publication,
          status: "upload-uncertain",
          reason:
            "The upload outcome is unknown. Verify the existing attempt; do not upload again.",
        },
      };
    renderCaseArtifactReview(review);
    const status = $("[data-case-publication-status]");
    if (status) status.textContent += ` ${error.message}`;
  }
}

function renderAppealRewardsStatus(item) {
  if (!isGuardedV9()) return "";
  const ready = appealRewardsReady(item);
  const value = item.appeal?.withdrawableWei;
  const known = ready && typeof value === "string" && /^\d+$/.test(value);
  return `<dl class="details-list" data-appeal-rewards><div><dt>Appeal rewards</dt><dd>${ready ? "Finality verified · fresh claim review required" : "Pending verified finality"}</dd></div><div><dt>Withdrawable appeal rewards</dt><dd data-appeal-withdrawable>${known ? `${eth(value)} ${escape(currencySymbol())}` : ready ? "Amount requires a fresh actor quote" : "Pending · amount unavailable"}</dd></div></dl>`;
}
function renderAppealStatus(item) {
  const appeal = item.appeal;
  const rewards = renderAppealRewardsStatus(item);
  if (!appeal || !appeal.end)
    return `${rewards}<p class="small muted">No open appeal period reported in this snapshot. The resolver validates every contribution before signing.</p>`;
  return `${rewards}<dl class="details-list"><div><dt>Current vote · not a final ruling</dt><dd>${escape(["0 · Refused", "1 · Attended", "2 · Absent"][appeal.ruling] ?? "Unavailable")}</dd></div><div><dt>Appeal period ends</dt><dd>${escape(formatTime(appeal.end, app.detail.event.timezone))}</dd></div><div><dt>Losing side contribution deadline</dt><dd>${escape(formatTime(appeal.loserEnd, app.detail.event.timezone))}</dd></div><div><dt>Attended side cost</dt><dd>${eth(appeal.costAttended)} ${escape(currencySymbol())}</dd></div><div><dt>Absent side cost</dt><dd>${eth(appeal.costAbsent)} ${escape(currencySymbol())}</dd></div></dl>`;
}
function renderRecovery() {
  return `<section class="panel"><div class="panel-header"><div><h2>Recovery & administration</h2><p>Each operation is checked through a fresh simulation and reviewed against current contract rules before sending.</p></div></div><div class="button-row"><button class="button button-secondary button-small" data-edit-event>Edit event settings</button><button class="button button-danger button-small" data-tx="cancel">Review cancellation</button><button class="button button-secondary button-small" data-recovery="refund">${isV8() ? "Return spare funds" : "Return unmatched funds"}</button><button class="button button-secondary button-small" data-recovery="sweep">Return spare funds</button><button class="button button-secondary button-small" data-recovery="transferOwnership">Transfer ownership</button><button class="button button-secondary button-small" data-tx="acceptOwnership">Accept ownership</button></div><p class="field-help">Cancellation is available only while Open under the contract’s deadline rules. No-list withdrawal is available only after the attendance-posting deadline when no list was posted. Neither bypasses an unresolved matched dispute. Reserved pool, held shares, owed balances and challenge escrow cannot be swept.</p></section>`;
}
function renderTransactions() {
  const transactions = app.detail.transactions ?? [];
  if (!transactions.length)
    return '<div class="empty">No confirmed app-recorded actions are visible for this event and your current wallet or role. Other on-chain transactions may exist.</div>';
  return `<ul class="transaction-log">${transactions
    .slice()
    .reverse()
    .slice(0, 12)
    .map(
      (tx) =>
        `<li><strong>${escape(actionNames[tx.action] ?? tx.action ?? "Transaction")}</strong> · ${escape(tx.status ?? "confirmed")}<br><span class="mono">${escape(tx.hash ?? tx.txHash ?? "")}</span>${tx.blockNumber ? ` · block ${escape(tx.blockNumber)}` : ""}</li>`,
    )
    .join("")}</ul>`;
}
function renderDemoControls() {
  if (!isSandbox()) return "";
  const explanation = isHostedDemo()
    ? "<strong>Shared online sandbox.</strong> These controls advance the demo chain for every visitor. Accounts are synthetic, ETH has no value and Court is a mock. State resets on server restart; use synthetic inputs only."
    : "<strong>Isolated development only.</strong> These controls advance the local chain and use funded synthetic accounts. No ETH, court case, guest data or message is sent to a production service.";
  return `<details class="disclosure" style="margin-top:28px"><summary>${isHostedDemo() ? "Shared sandbox" : "Local demo"} controls & walkthrough</summary><div class="notice">${explanation}<br>Chain time: ${escape(formatTime(app.detail?.now ?? app.bootstrap.now, "UTC"))}</div><div class="button-row"><button class="button button-secondary button-small" data-advance="3600">Advance 1 hour</button><button class="button button-secondary button-small" data-advance="86401">Advance 1 day + 1 second</button><button class="button button-secondary button-small" data-advance="1296000">Advance 15 days</button><button class="button button-quiet button-small" data-demo-help>Open walkthrough</button></div></details>`;
}

async function prepareTransaction(action, params = {}) {
  if (isGuardedV9() && !currentIdentity()) {
    showIdentityDialog();
    return;
  }
  assertFinancialEnvironment(action, params);
  if (!contractProfileForEvent(app.detail?.event))
    throw new Error(
      "This contract profile or network is unsupported. Refresh the verified deployment before financial review.",
    );
  if (pendingAction(action))
    throw new Error(
      "A wallet request or submitted transaction for this action is still unresolved. Check its activity before preparing another.",
    );
  if (!currentIdentity()) {
    showIdentityDialog();
    return;
  }
  invalidateDraft();
  const eventId = app.route.eventId;
  const generation = app.generation;
  const unsignedReviewVersion = app.unsignedReviewVersion;
  toast("Preparing transaction: checking current chain state and authority…");
  const draft = await post(eventPath("/drafts"), { action, params });
  const fresh = await api(eventPath(""));
  if (
    eventId !== app.route.eventId ||
    generation !== app.generation ||
    unsignedReviewVersion !== app.unsignedReviewVersion
  )
    throw new Error(
      "The event or identity changed. Prepare the transaction again.",
    );
  if (fresh.state.fingerprint !== draft.snapshot)
    throw new Error(
      "The contract state changed while preparing this review. Refresh and prepare a fresh transaction.",
    );
  app.detail = fresh;
  assertFinancialEnvironment(action, params);
  assertProductionDraft(draft);
  app.draft = draft;
  app.draftParams = { ...params };
  const event = app.detail.event;
  showDialog(
    `${testProfileNotice(event)}<div class="dialog-eyebrow">Review before signing</div><h2 class="dialog-title" id="dialog-title">${escape(actionNames[action] ?? action)}</h2><p class="dialog-body-text">${escape(typeof draft.summary === "string" ? draft.summary : JSON.stringify(draft.summary))}</p><div class="review-list"><dl class="details-list"><div><dt>Event</dt><dd><strong>${escape(event.title)}</strong><br>${escape(draft.eventId)}</dd></div>${action === "postAttendance" ? `<div><dt>Proposed attendees</dt><dd><strong>${draft.args[0].length} registered wallets</strong></dd></div><div><dt>Initial share</dt><dd><strong>${eth(draft.args[1])} ${escape(currencySymbol())}</strong></dd></div><div><dt>Registered pool</dt><dd>${eth(app.detail.state.poolWei)} ${escape(currencySymbol())}</dd></div>` : ""}${action === "register" || action === "reject" ? `<div><dt>Reviewed wallets</dt><dd><strong>${draft.args[0].length} verified participants</strong></dd></div>` : ""}<div><dt>Network</dt><dd>${escape(networkName())} · ${escape(draft.chainId)}</dd></div><div><dt>Event contract</dt><dd class="mono">${escape(draft.contract)}</dd></div>${!same(draft.contract, draft.transaction.to) ? `<div><dt>Transaction recipient</dt><dd class="mono">${escape(draft.transaction.to)}</dd></div>` : ""}<div><dt>Signing wallet</dt><dd class="mono">${escape(draft.wallet)}</dd></div><div><dt>Value</dt><dd><strong>${eth(draft.valueWei)} ${escape(currencySymbol())}</strong><br><span class="small mono">${escape(draft.valueWei)} wei</span></dd></div><div><dt>Method</dt><dd><code>${escape(draft.method)}</code></dd></div><div><dt>Policy</dt><dd>${escape(event.policyURI ?? event.policyUri ?? "Immutable event policy")}</dd></div><div><dt>Review expires</dt><dd>${escape(formatTime(draft.expiresAt, "UTC"))}</dd></div></dl></div>${isProduction() && action === "deposit" ? renderAttendanceStandard(event) : ""}<details class="disclosure"><summary>Inspect calldata and arguments</summary><pre class="review-code">${escape(JSON.stringify({ args: draft.args, transaction: draft.transaction, snapshot: draft.snapshot }, null, 2))}</pre></details>${action === "release" ? releaseBreakdown() : ""}<div class="notice warning">Confirming sends a transaction from the selected wallet on ${escape(networkName())} (${escape(draft.chainId)}). The server checks this state snapshot again and rejects an expired or stale draft. Changing event or wallet clears the review.</div><div id="transaction-status" role="status"></div><div class="dialog-buttons"><button class="button button-secondary" data-close>Cancel</button><button class="button button-primary" id="execute-transaction" data-execute>${isProduction() ? "Confirm Ethereum transaction" : Number(draft.chainId) === 1337 ? "Confirm local transaction" : "Confirm testnet transaction"}</button></div>`,
  );
}
function releaseBreakdown() {
  const state = app.detail.state;
  const open = (state.cases ?? []).filter(
    (item) => item.state === "Disputed" || item.state === 2,
  ).length;
  const accepted = (state.cases ?? []).filter(
    (item) =>
      (item.state === "Waiting" || item.state === 1) &&
      Number(app.detail.now) > Number(item.matchEndsAt),
  ).length;
  const attendees = Number(state.attendeeCount) + accepted;
  const count = attendees + open;
  if (!count) return "";
  const share = BigInt(state.poolWei) / BigInt(count);
  return `<div class="notice"><strong>Reviewed ${versionLabel()} payout calculation</strong><br>${escape(state.attendeeCount)} established attendees${accepted ? ` + ${accepted} expired unmatched challenges eligible for automatic acceptance if the batch simulation fits` : ""} · ${open} unresolved matched cases.<br>Provisional share: ${eth(share)} ${escape(currencySymbol())} each.<br>Normal attendee payments: ${eth(share * BigInt(attendees))} ${escape(currencySymbol())}.<br>Held-share reserve: ${eth(share * BigInt(open))} ${escape(currencySymbol())}.<br>Integer division remainder remains protected by the contract’s reserve rules.</div>`;
}
async function executeTransaction() {
  const draft = app.draft;
  if (!draft || draft.eventId !== app.route.eventId)
    throw new Error("This transaction review is no longer valid.");
  assertFinancialEnvironment(draft.action, app.draftParams ?? {});
  assertProductionDraft(draft);
  if (pendingAction(draft.action, draft.eventId, draft.wallet))
    throw new Error(
      "This action already has an unresolved submission. Check your wallet before trying again.",
    );
  const submission = {
    id: crypto.randomUUID(),
    draftId: draft.id,
    instanceId: app.bootstrap?.instanceId,
    eventId: draft.eventId,
    wallet: draft.wallet,
    action: draft.action,
    status: "preparing",
  };
  rememberPending(submission);
  let submissionStarted = false,
    submissionHash = null;
  const button = $("#execute-transaction");
  button.disabled = true;
  button.textContent = "Submitting…";
  $("#transaction-status").innerHTML =
    `<div class="notice"><span class="spinner" style="width:12px;height:12px;vertical-align:middle;margin-right:7px"></span>Submitting on ${escape(networkName())}. Waiting for a confirmed receipt…</div>`;
  try {
    let result;
    if (currentIdentity()?.mode === "wallet") {
      const context = transactionContext(app.detail.event, draft.wallet);
      if (!transactionJournal)
        throw Object.assign(
          new Error(
            "Durable transaction storage is unavailable. Enable local storage before opening a financial wallet request.",
          ),
          { code: "TRANSACTION_STORAGE_UNAVAILABLE" },
        );
      const rawProvider = walletProvider();
      const guardedProvider = {
        request: async (request) => {
          if (request.method === "eth_sendTransaction") {
            assertFinancialEnvironment(draft.action, app.draftParams ?? {});
            assertProductionDraft(draft);
            if (isHostedDemo())
              await assertDemoChainInstance(
                rawProvider,
                app.bootstrap.chain.instanceMarker,
                app.bootstrap.chain.rpcUrl,
              );
            submissionStarted = true;
            rememberPending({ ...submission, status: "awaiting-wallet" });
          }
          return rawProvider.request(request);
        },
      };
      result = await submitWalletDraft({
        draft,
        context,
        provider: guardedProvider,
        journal: transactionJournal,
        isCurrentContext: (captured) =>
          app.draft?.id === draft.id &&
          app.route.eventId === captured.eventId &&
          same(currentIdentity()?.wallet, captured.wallet) &&
          app.bootstrap?.instanceId === captured.instanceId &&
          app.bootstrap?.mode === captured.mode &&
          app.detail?.event.chainId === captured.chainId &&
          same(app.detail?.event.contract, captured.contract) &&
          app.detail?.event.abiVersion === captured.abiVersion,
        validate: (eventId, id) =>
          post(
            `/api/events/${encodeURIComponent(eventId)}/drafts/${encodeURIComponent(id)}/validate`,
            {},
          ),
        recordSubmitted: async (eventId, id, hash) => {
          submissionHash = hash;
          rememberPending({ ...submission, hash, status: "submitted" });
          await post(
            `/api/events/${encodeURIComponent(eventId)}/drafts/${encodeURIComponent(id)}/submitted`,
            { hash },
          ).catch((error) => {
            if (["DRAFT_SCOPE", "STALE_DRAFT"].includes(error.code))
              return post(
                `/api/events/${encodeURIComponent(eventId)}/submissions/reconcile`,
                { draftId: id, hash },
              );
            throw error;
          });
        },
        confirm: async (eventId, id, hash) => {
          let last;
          for (let attempt = 0; attempt < 15; attempt++)
            try {
              return await post(
                `/api/events/${encodeURIComponent(eventId)}/submissions/reconcile`,
                { draftId: id, hash },
              );
            } catch (error) {
              last = error;
              if (
                !["TX_MISMATCH", "TX_PENDING"].includes(error.code) ||
                attempt === 14
              )
                throw error;
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          throw last;
        },
      });
    } else {
      if (!isSandbox())
        throw new Error(
          "This environment requires an authenticated browser wallet. Server signing is unavailable.",
        );
      submissionStarted = true;
      rememberPending({ ...submission, status: "submitting" });
      result = await post(
        `/api/events/${encodeURIComponent(draft.eventId)}/drafts/${encodeURIComponent(draft.id)}/execute`,
        {},
      );
    }
    if (result.status !== "confirmed")
      throw new Error(
        `Transaction is ${result.status ?? "unconfirmed"}. Refresh to verify its receipt.`,
      );
    if (result.hash)
      rememberPending({
        ...submission,
        eventId: draft.eventId,
        wallet: draft.wallet,
        action: draft.action,
        hash: result.hash,
        status: "confirmed",
      });
    if (app.draft?.id === draft.id) {
      app.draft = null;
      app.draftParams = null;
    }
    if (
      app.route.eventId === draft.eventId &&
      same(currentIdentity()?.wallet, draft.wallet) &&
      app.bootstrap?.instanceId === submission.instanceId
    )
      await load({ silent: true });
    toast(
      `Confirmed in ${draft.eventId}: ${actionNames[result.action ?? draft.action] ?? draft.action}. Block ${result.blockNumber} · ${short(result.hash)}`,
    );
  } catch (error) {
    if (error.submittedHash) {
      submissionHash = error.submittedHash;
      rememberPending({
        ...submission,
        hash: submissionHash,
        status: error.code === "TRANSACTION_REVERTED" ? "failed" : "submitted",
      });
    }
    if (
      !submissionHash &&
      (!submissionStarted ||
        [
          "STALE_DRAFT",
          "DRAFT_SCOPE",
          "NOT_OWNER",
          "SIMULATION_FAILED",
          "PENDING_DEPOSIT",
          "BUSY",
        ].includes(error.code) ||
        error.code === "TRANSACTION_STORAGE_UNAVAILABLE" ||
        error.code === "TRANSACTION_CONTEXT_CHANGED" ||
        error.code === "TRANSACTION_WALLET_CHANGED" ||
        error.code === "TRANSACTION_WRONG_CHAIN" ||
        (!submissionHash &&
          (error.code === 4001 || error.code === "ACTION_REJECTED")))
    )
      forgetPending(submission.id, submission.instanceId);
    else if (!submissionHash)
      rememberPending({ ...submission, status: "outcome-unknown" });
    const ownsReview = app.draft?.id === draft.id;
    if (ownsReview) app.draft = null;
    if (ownsReview && $("#transaction-status"))
      $("#transaction-status").innerHTML =
        `<div class="error-panel">${escape(error.message)}<br>This review is invalidated. Close it and prepare a fresh transaction.</div>`;
    if (button?.isConnected) button.textContent = "Review invalidated";
    throw error;
  }
}

function showCreateEvent() {
  if (!isSandbox())
    throw new Error(
      "Demonstration event deployment is available only in the sandbox.",
    );
  if (!currentIdentity()) {
    showIdentityDialog();
    return;
  }
  if (currentIdentity().mode !== "demo") {
    toast(
      "Choose a local demo organizer identity to deploy a new demonstration contract. Connected wallets can register and sign their own participant actions.",
      true,
    );
    return;
  }
  const now = Number(app.bootstrap.now) || Math.floor(Date.now() / 1000);
  const iso = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 16);
  showDialog(
    `<div class="dialog-eyebrow">New local event</div><h2 class="dialog-title" id="dialog-title">Create an independent event</h2><p class="dialog-body-text">Deploy a separate ${versionLabel({ contractVersion: app.bootstrap?.contractVersion ?? "truth-pays-v7" })} contract on the local chain. Your selected wallet becomes its organizer. Existing events and their balances stay independent.</p><form data-form="create-event"><div class="form-grid"><div class="full"><label for="event-title">Event title</label><input id="event-title" name="title" required maxlength="120" placeholder="An event worth showing up for"></div><div><label for="event-slug">Display slug</label><input id="event-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="community-workshop"></div><div><label for="event-deposit">Optional commitment (${escape(currencySymbol())})</label><input id="event-deposit" name="depositEth" required value="0.01" inputmode="decimal"></div><div class="full"><label for="event-description">Description</label><textarea id="event-description" name="description" required maxlength="2000" placeholder="Who is this event for?"></textarea></div><div><label for="event-start">Starts (UTC)</label><input id="event-start" name="startsAt" type="datetime-local" required value="${iso(now + 7200)}"></div><div><label for="event-end">Ends (UTC)</label><input id="event-end" name="endsAt" type="datetime-local" required value="${iso(now + 14400)}"></div><div><label for="event-timezone">Display timezone</label><input id="event-timezone" name="timezone" required value="Asia/Bangkok"></div><div><label for="event-location">Location</label><input id="event-location" name="location" required maxlength="250" placeholder="Venue or online"></div></div><div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary" type="submit">Create & deploy locally</button></div></form>`,
  );
}
function showRecovery(action) {
  assertFinancialEnvironment(action);
  showDialog(
    `<div class="dialog-eyebrow">${escape(actionNames[action])}</div><h2 class="dialog-title" id="dialog-title">Choose the destination</h2><p class="dialog-body-text">The contract applies its exact eligibility and reserve rules. Review the selected event, destination and consequences before signing.</p><form data-form="recovery" data-action="${escape(action)}"><label for="recovery-to">Destination wallet</label><input id="recovery-to" name="to" required pattern="0x[a-fA-F0-9]{40}" value="${escape(currentIdentity()?.wallet ?? "")}" placeholder="0x…">${["refund", "withdrawPending"].includes(action) ? `<label for="recovery-amount" style="margin-top:15px">Amount (${escape(currencySymbol())})</label><input id="recovery-amount" name="amount" required inputmode="decimal" ${action === "withdrawPending" ? `value="${escape(eth(ownWalletFacts()?.pendingCreditWei ?? ownParticipant()?.pendingCreditWei ?? "0"))}"` : 'placeholder="0.01"'}>` : ""}<div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary">Prepare review</button></div></form>`,
  );
}
function showCorrection() {
  showDialog(
    `<div class="dialog-eyebrow">Organizer correction</div><h2 class="dialog-title" id="dialog-title">Add omitted attendees</h2><p class="dialog-body-text">Available during the challenge window, for registered wallets that are not in a matched dispute. This operation changes the contract’s attendee set.</p><form data-form="correction"><label for="correction-wallets">Wallets (one per line or comma separated)</label><textarea id="correction-wallets" name="wallets" required spellcheck="false" placeholder="0x…"></textarea><div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary">Prepare correction</button></div></form>`,
  );
}
function showEventSettings() {
  const { event } = app.detail;
  showDialog(
    `<div class="dialog-eyebrow">Event management</div><h2 class="dialog-title" id="dialog-title">Editorial & registration settings</h2><p class="dialog-body-text">Visibility and registration are separate from the financial phase. Financial dates, deposit, contract, stable identity and immutable policy remain fixed.</p><form data-form="event-settings"><label for="settings-description">Description</label><textarea id="settings-description" name="description" required maxlength="2000">${escape(event.description)}</textarea><div class="form-grid" style="margin-top:15px"><div><label for="settings-visibility">Visibility</label><select id="settings-visibility" name="visibility">${["public", "private"].map((value) => `<option ${event.visibility === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div><label for="settings-editorial">Editorial status</label><select id="settings-editorial" name="editorialStatus">${["published", "draft"].map((value) => `<option ${event.editorialStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div class="full"><label for="settings-registration">Registration</label><select id="settings-registration" name="registrationStatus">${["open", "closed"].map((value) => `<option ${event.registrationStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select></div></div>${renderAssociationFields(event)}<div class="notice">Private visibility uses event membership on the server. Publishing content does not reopen a cancelled or finalized financial contract.</div><div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary">Save event settings</button></div></form>`,
  );
}
function renderAssociationFields(event = {}) {
  return `<details class="disclosure"><summary>Optional content & Luma associations</summary><p>These links map the event to retained services. Public Luma metadata, content history and booth records do not verify financial attendance or grant access to private materials.</p><div class="form-grid"><div><label for="settings-luma-id">Luma event ID</label><input id="settings-luma-id" name="lumaEventId" value="${escape(event.lumaEventId ?? "")}" maxlength="100" placeholder="evt-…"></div><div><label for="settings-content-id">Content event ID</label><input id="settings-content-id" name="contentEventId" value="${escape(event.contentEventId ?? "")}" maxlength="100" placeholder="Existing content UUID"></div><div class="full"><label for="settings-luma-url">Explicit Luma event URL</label><input id="settings-luma-url" name="lumaUrl" type="url" value="${escape(event.lumaUrl ?? "")}" placeholder="https://luma.com/your-event" maxlength="1000"></div><div class="full"><label for="settings-content-url">Content & materials URL</label><input id="settings-content-url" name="contentUrl" type="url" value="${escape(event.contentUrl ?? "")}" placeholder="https://events.example/events/your-event" maxlength="1000"></div></div></details>`;
}
function showCheckin(participantId) {
  const person = app.detail.participants.find(
    (person) => person.id === participantId,
  );
  showDialog(
    `<div class="dialog-eyebrow">Trusted staff observation</div><h2 class="dialog-title" id="dialog-title">Check in ${escape(person?.name ?? participantId)}</h2><p class="dialog-body-text">Record a door observation for this event and linked participant. The staff identity, evidence source and replay-safe nonce are recorded. This alone does not post the financial attendance list.</p><div class="review-list"><dl class="details-list"><div><dt>Event</dt><dd>${escape(app.detail.event.title)}</dd></div><div><dt>Participant wallet</dt><dd class="mono">${escape(person?.wallet)}</dd></div><div><dt>Reviewer</dt><dd>${escape(currentIdentity()?.label)}</dd></div></dl></div><form data-form="checkin" data-participant="${escape(participantId)}"><label for="checkin-note">Door evidence note</label><input id="checkin-note" name="note" required maxlength="1000" value="${isSandbox() ? "Verified participant present at the local demo door" : ""}" placeholder="Describe the evidence for this check-in"><div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary">Record trusted check-in</button></div></form>`,
  );
}
function showDemoHelp() {
  if (isGuardedV9()) {
    showDialog(
      `<div class="dialog-eyebrow">${escape(networkName())}${isV9Testnet() ? " · public testnet" : ""}</div><h2 class="dialog-title" id="dialog-title">From a deposit to a kickback</h2><ol class="dialog-body-text"><li>Connect a supported standard Ethereum wallet account.</li><li>Review the event, ${escape(currencySymbol())} amount, contract, policy and arbitration provider before depositing.</li><li>The host approves admission and separately registers approved commitments.</li><li>Trusted check-in supports the organizer's attendance review; it does not post financial attendance.</li><li>Review the posted attendance and challenge an omission before the on-chain deadline. Matched disputes use the verified arbitration provider.</li><li>Ordinary payments can proceed with unresolved shares held. A final ruling still needs settlement; owed amounts and successful payments are separate.</li></ol><p>${escape(walletSupportNotice())}</p><p>${escape(arbitrationNotice())}</p>${productionUpgradeNotice()}<div class="dialog-buttons"><button class="button button-primary" data-close>Continue</button></div>`,
    );
    return;
  }
  if (isTestnet()) {
    showDialog(
      `<div class="dialog-eyebrow">Testnet walkthrough</div><h2 class="dialog-title" id="dialog-title">From a deposit to a kickback</h2><ol class="dialog-body-text"><li>Connect a wallet with test ${escape(currencySymbol())} on ${escape(networkName())}.</li><li>Review the event policy, contract and arbitration provider, then make the optional deposit.</li><li>The host reviews admission and registers approved commitments.</li><li>Check in at the event. The host posts attendance after reviewing trusted observations.</li><li>If your attendance is missing, challenge before the deadline. A matched challenge follows the configured testnet arbitration process.</li><li>After the challenge windows, ordinary kickbacks can be sent with unresolved case shares protected. Final rulings still require settlement.</li></ol><p>Transactions use public testnet time and persist on chain. Local time travel, demo accounts and mock-ruling controls are unavailable.</p><div class="dialog-buttons"><button class="button button-primary" data-close>Continue</button></div>`,
    );
    return;
  }
  if (!isSandbox())
    throw new Error(
      "Environment details are unavailable. Refresh to try again.",
    );
  showDialog(
    `<div class="dialog-eyebrow">Two events. One independent participant.</div><h2 class="dialog-title" id="dialog-title">Walk through a complete local flow</h2><p class="dialog-body-text">All balances and outcomes come from real ${versionLabel()} contracts on an isolated Ganache chain. Court rulings come from an explicit V1 mock. Demo identities simulate authentication.</p><ol class="dialog-body-text"><li>Choose Alice. Open Event A and deposit, then do the same in Event B.</li><li>Switch to each event’s organizer. Approve Alice and review staker registration. Repeat with Bob and Carol for a dispute scenario.</li><li>Advance local time past the event start. Use trusted staff check-in or an event-bound CSV, then review and post attendance.</li><li>Omit a registered participant, switch to them and challenge. Another wallet can match before its separate deadline.</li><li>Advance past the challenge and matching windows. The owner can release normal payouts with a held share reserved for the open case.</li><li>Event B continues independently. Use the local Court controls in A, then settle the real contract’s final outcome.</li></ol><div class="notice">The advanced guest and organizer links preserve evidence, appeal, ownership and recovery tools. Content recordings and booth marketing remain separate services. Mainnet deployment and external publication require a later authorized rollout.</div><div class="dialog-buttons"><button class="button button-primary" data-close>Start exploring</button></div>`,
  );
}

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)
  )
    return;
  try {
    if (
      target instanceof HTMLInputElement &&
      target.matches("[data-case-publication-consent]")
    ) {
      const review = caseArtifactReview,
        button = $("[data-case-publication=publish]");
      if (button)
        button.disabled =
          !review ||
          !caseArtifactCurrent(review) ||
          review.working ||
          !target.checked ||
          !publicationActions(review.record?.publication).canPublish ||
          caseUploadAttempts.has(caseAttemptKey(review.record));
      return;
    }
    if (target.id === "event-switch") {
      invalidateDraft();
      navigate(target.value, app.route.view, "#event-switch");
      return;
    }
    if (target.closest('[data-form="import"]')) {
      app.importReview = null;
      if ($("#import-preview")) $("#import-preview").innerHTML = "";
    }
    if (target.matches("[data-identity]")) {
      await switchIdentity(target.value);
    }
    if (target.matches("[data-admission]")) {
      const select = target;
      select.disabled = true;
      await api(
        eventPath(
          `/participants/${encodeURIComponent(select.dataset.admission)}`,
        ),
        { method: "PATCH", body: JSON.stringify({ admission: select.value }) },
      );
      await load({ silent: true });
      toast(
        "Admission decision saved. Contract registration remains a separate reviewed action.",
      );
    }
    if (
      target instanceof HTMLInputElement &&
      target.matches("[data-csv-file]") &&
      target.files[0]
    ) {
      if (target.files[0].size > 2 * 1024 * 1024)
        throw new Error("Use a CSV smaller than 2 MB.");
      const generation = app.generation,
        token = ++app.csvReadToken;
      const file = target.files[0],
        field = $("#import-csv"),
        preview = $("[data-import-preview]");
      if (preview) preview.disabled = true;
      try {
        const contents = await file.text();
        if (
          generation !== app.generation ||
          token !== app.csvReadToken ||
          !field?.isConnected ||
          target.files[0] !== file
        )
          return;
        app.importReview = null;
        if ($("#import-preview")) $("#import-preview").innerHTML = "";
        field.value = contents;
      } finally {
        if (token === app.csvReadToken && preview?.isConnected)
          preview.disabled = false;
      }
    }
    if (
      target instanceof HTMLInputElement &&
      target.matches("[data-evidence-file]") &&
      target.files[0]
    ) {
      if (isProduction())
        throw new Error(
          "File uploads are unavailable in production. Enter an evidence URI and review its submission instead.",
        );
      if (target.files[0].size > 256 * 1024)
        throw new Error("Local evidence is limited to a single 256 KiB block.");
      const body = new FormData();
      body.set("data", target.files[0]);
      const response = await fetch("/local-upload", {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Local evidence storage failed.");
      const form = target.closest("form");
      if (form) $('[name="uri"]', form).value = result.path;
      toast(
        "Evidence file stored on this server. Review the resolver transaction to submit its URI; this does not publish it to IPFS.",
      );
    }
  } catch (error) {
    toast(error.message, true);
    if (target.matches("[data-admission]")) await load({ silent: true });
  }
});

document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const workflow = event.target.closest("[data-workflow]");
  if (workflow) {
    event.preventDefault();
    const target = $(`#${workflow.getAttribute("data-workflow")}`);
    target?.scrollIntoView({ block: "start" });
    target?.focus();
    return;
  }
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  const data = button.dataset;
  try {
    if ("publicEventClear" in data) {
      const field = $("[data-public-event-search]");
      if (publicHomePresentation() && field) {
        publicSearch.query = "";
        field.value = "";
        updatePublicEventResults();
        field.focus();
      }
      return;
    }
    if ("caseArtifact" in data) {
      button.disabled = true;
      try {
        await openCaseArtifact(data.caseWallet, data.caseArtifact);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
      return;
    }
    if ("casePublication" in data) {
      await casePublicationAction(data.casePublication);
      return;
    }
    if ("launchRegister" in data) {
      const person = app.detail?.participants?.find(
        (person) =>
          person.id === data.launchParticipant &&
          person.eventId === app.route.eventId &&
          same(person.wallet, data.launchRegister),
      );
      if (
        !isProduction() ||
        !isOwner() ||
        !person ||
        person.admission !== "approved" ||
        !person.deposit?.verified ||
        person.registered
      )
        throw new Error(
          "Review this wallet's current host approval and canonical deposit before registration.",
        );
      await prepareTransaction("register", { wallets: [person.wallet] });
      return;
    }
    if ("launchCopy" in data) {
      const field = $("[data-launch-hash]");
      if (!field || !/^0x[0-9a-f]{64}$/i.test(field.value))
        throw new Error("A verified transaction reference is unavailable.");
      try {
        await navigator.clipboard.writeText(field.value);
        toast("Transaction ID copied. Paste it into your Luma registration.");
      } catch {
        field.focus();
        field.select();
        toast("Select and copy the transaction ID shown here.");
      }
      return;
    }
    if ("reconcileSubmission" in data) {
      await reconcileSubmittedRecovery(data.reconcileSubmission, button);
      return;
    }
    if ("startRegistration" in data) {
      $("#reg-name")?.focus();
      return;
    }
    if ("reviewImport" in data) {
      reviewImportConsequences();
      return;
    }
    if ("importCommit" in data) {
      await commitReviewedImport(button);
      return;
    }
    if ("close" in data) {
      invalidateDraft();
      return;
    }
    if ("batchRegister" in data) {
      await prepareBatchRegistration();
      return;
    }
    if ("reload" in data) {
      await load();
      return;
    }
    if ("chooseIdentity" in data) {
      showIdentityDialog();
      return;
    }
    if ("connectWallet" in data) {
      button.disabled = true;
      await connectWallet();
      return;
    }
    if ("fundWallet" in data) {
      if (!isSandbox())
        throw new Error(
          "Local faucet controls are available only in the sandbox.",
        );
      button.disabled = true;
      const result = await post("/api/demo/fund", {});
      await load({ silent: true });
      toast(
        `Received 1 local ETH. Confirmed local faucet transaction ${short(result.hash)}.`,
      );
      return;
    }
    if ("logout" in data) {
      await switchIdentity("");
      return;
    }
    if ("createEvent" in data) {
      showCreateEvent();
      return;
    }
    if ("view" in data) {
      navigate(app.route.eventId, data.view, `[data-view="${data.view}"]`);
      return;
    }
    if ("demoHelp" in data) {
      showDemoHelp();
      return;
    }
    if ("execute" in data) {
      await executeTransaction();
      return;
    }
    if ("recovery" in data) {
      showRecovery(data.recovery);
      return;
    }
    if ("correction" in data) {
      showCorrection();
      return;
    }
    if ("editEvent" in data) {
      showEventSettings();
      return;
    }
    if ("checkin" in data) {
      showCheckin(data.checkin);
      return;
    }
    if ("tx" in data) {
      await prepareTransaction(data.tx, {
        ...(data.wallet ? { wallet: data.wallet } : {}),
        ...(data.tx === "appealRewards" ? { sides: [0, 1, 2] } : {}),
      });
      return;
    }
    if ("personal" in data) {
      if (isProduction())
        throw new Error(
          "Event registration and personal history stay outside this deposit page.",
        );
      button.disabled = true;
      await post(eventPath("/personal"), { attended: true });
      await load({ silent: true });
      toast("Personal attendance saved. Financial eligibility is unchanged.");
      return;
    }
    if ("advance" in data) {
      if (!isSandbox())
        throw new Error("Only the sandbox clock can be advanced here.");
      invalidateDraft();
      button.disabled = true;
      await post("/api/demo/advance", { seconds: Number(data.advance) });
      await load({ silent: true });
      toast("Local chain time advanced. Transaction drafts cleared.");
      return;
    }
    if ("publish" in data) {
      if (isProduction())
        throw new Error(
          "Review and consent to the exact production artifact before publication.",
        );
      button.disabled = true;
      const result = await post(
        eventPath(`/cases/${encodeURIComponent(data.publish)}/publish`),
        {},
      );
      await load({ silent: true });
      toast(
        `Exact case bytes verified and stored on this server (${result.status}). IPFS network publication is not enabled.`,
      );
      return;
    }
    if ("ruling" in data) {
      if (!isSandbox())
        throw new Error(
          "Mock Court rulings are available only in the sandbox.",
        );
      button.disabled = true;
      await post(eventPath("/demo/ruling"), {
        wallet: data.wallet,
        ruling: Number(data.ruling),
      });
      await load({ silent: true });
      toast(
        "Mock Court ruling recorded. Review “Settle final / unmatched case” to apply it to the event contract.",
      );
      return;
    }
    if ("openAppeal" in data) {
      if (!isSandbox())
        throw new Error(
          "Mock appeal controls are available only in the sandbox.",
        );
      button.disabled = true;
      await post(eventPath("/demo/appeal"), {
        wallet: data.openAppeal,
        ruling: 1,
        duration: 3600,
      });
      await load({ silent: true });
      toast("Mock appeal period opened for one local hour.");
    }
  } catch (error) {
    toast(error.message, true);
    if (!button.matches("[data-execute]")) button.disabled = false;
  }
});

document.addEventListener("input", (event) => {
  if (
    event.target instanceof HTMLInputElement &&
    event.target.matches("[data-public-event-search]") &&
    event.target === $("[data-public-event-search]") &&
    publicHomePresentation()
  ) {
    publicSearch.query = event.target.value.slice(0, 120);
    updatePublicEventResults();
    return;
  }
  if (
    event.target instanceof Element &&
    event.target.closest('[data-form="import"]')
  ) {
    app.importReview = null;
    if ($("#import-preview")) $("#import-preview").innerHTML = "";
  }
});
document.addEventListener("submit", async (event) => {
  if (!(event.target instanceof Element)) return;
  const form = event.target.closest("form[data-form]");
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const submit = $("[type=submit],button:not([type])", form);
  if (submit) submit.disabled = true;
  try {
    switch (form.dataset.form) {
      case "registration":
        if (isProduction())
          throw new Error(
            "Complete registration on Luma. This page does not collect registration details.",
          );
        await post(eventPath("/participants"), values);
        await load({ silent: true });
        toast(
          "Registration linked to your authenticated wallet for this event. Organizer admission is pending.",
        );
        break;
      case "receipt":
        await post(eventPath("/deposits"), values);
        await load({ silent: true });
        toast("Receipt and deposit log verified against this event.");
        break;
      case "checkin":
        await post(eventPath("/checkins"), {
          participantId: form.dataset.participant,
          nonce: crypto.randomUUID(),
          source: "staff-door",
          note: values.note,
        });
        await load({ silent: true });
        toast("Trusted event check-in recorded with reviewer and nonce.");
        break;
      case "import": {
        invalidateDraft();
        const input = {
          kind: String(values.kind),
          csv: String(values.csv),
          ...(values.sourceEventId
            ? { sourceEventId: String(values.sourceEventId) }
            : {}),
          ...(values.reviewConfirmed
            ? {
                review: {
                  confirmed: true,
                  note: String(values.reviewNote ?? ""),
                },
              }
            : {}),
        };
        const sourceValues = JSON.stringify([...new FormData(form)]);
        const analysis = analyzeImport(input, app.detail);
        const scope = {
          eventId: app.route.eventId,
          generation: app.generation,
          wallet: currentIdentity()?.wallet,
          unsignedReviewVersion: app.unsignedReviewVersion,
        };
        const projection = importProjection(app.detail);
        const bytes = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(input.csv),
        );
        const sourceHash = [...new Uint8Array(bytes)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (
          sourceValues !== JSON.stringify([...new FormData(form)]) ||
          scope.generation !== app.generation ||
          scope.unsignedReviewVersion !== app.unsignedReviewVersion ||
          scope.eventId !== app.route.eventId ||
          !same(scope.wallet, currentIdentity()?.wallet)
        )
          return;
        let serverPreview = null;
        if (!analysis.errors.length) {
          serverPreview = await post(
            `/api/events/${encodeURIComponent(scope.eventId)}/imports/preview`,
            input,
          );
          if (
            scope.generation !== app.generation ||
            scope.unsignedReviewVersion !== app.unsignedReviewVersion ||
            scope.eventId !== app.route.eventId ||
            !same(scope.wallet, currentIdentity()?.wallet) ||
            sourceValues !== JSON.stringify([...new FormData(form)])
          )
            return;
          if (serverPreview.sourceHash !== sourceHash)
            throw new Error(
              "Server source hash differs. Reload and review this source again.",
            );
        }
        app.importReview = {
          serverPreview,
          sourceValues,
          projection,
          input,
          analysis,
          sourceHash,
          eventId: app.route.eventId,
          wallet: currentIdentity()?.wallet,
          fingerprint: app.detail.state.fingerprint,
          blockNumber: app.detail.state.blockNumber,
          generation: app.generation,
        };
        $("#import-preview").innerHTML = renderImportPreview(app.importReview);
        enhanceTables();
        $("#import-preview").focus();
        toast(
          analysis.errors.length
            ? "Import blocked. Correct every exception before reviewing."
            : "Source preview ready. Review consequences before applying any rows.",
          analysis.errors.length > 0,
        );
        break;
      }
      case "recovery":
        await prepareTransaction(form.dataset.action, {
          to: values.to,
          ...(values.amount ? { amountWei: toWei(values.amount) } : {}),
        });
        break;
      case "event-settings":
        await api(eventPath(""), {
          method: "PATCH",
          body: JSON.stringify(values),
        });
        await load({ silent: true });
        toast(
          "Event settings saved. Financial terms remain bound to their original deployment.",
        );
        break;
      case "correction":
        await prepareTransaction("addAttendees", {
          wallets: addressList(values.wallets),
        });
        break;
      case "evidence":
        await prepareTransaction("evidence", {
          wallet: form.dataset.wallet,
          uri: values.uri,
        });
        break;
      case "appeal":
        await prepareTransaction("fundAppeal", {
          wallet: form.dataset.wallet,
          side: Number(values.side),
          amountWei: toWei(values.amount),
        });
        break;
      case "create-event": {
        if (!isSandbox())
          throw new Error(
            "Demonstration event deployment is available only in the sandbox.",
          );
        const created = await post("/api/events", {
          ...values,
          startsAt: new Date(`${values.startsAt}:00Z`).toISOString(),
          endsAt: new Date(`${values.endsAt}:00Z`).toISOString(),
        });
        invalidateDraft();
        toast("Independent local event and event contract created.");
        navigate(created.id ?? created.event?.id);
        break;
      }
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
});

$("#review-dialog").addEventListener("close", () => {
  closeCaseArtifactReview();
  app.draft = null;
  app.draftParams = null;
  app.importReview = null;
  const restore = dialogReturnFocus;
  dialogReturnFocus = null;
  if (
    isProduction() &&
    app.detail?.event.id === app.route.eventId &&
    readRoute().eventId === app.route.eventId &&
    app.route.view !== "organizer" &&
    !$("#review-dialog").open
  ) {
    const card = $("[data-luma-launch] [data-launch-state]");
    if (card) {
      const template = document.createElement("template");
      template.innerHTML = renderLaunchParticipant();
      const refreshed = template.content.querySelector("[data-launch-state]");
      if (refreshed) card.replaceWith(refreshed);
      disableUnreadyProductionActions();
    }
  }
  if (restore?.element?.isConnected) restore.element.focus();
  else if (restore?.selector) $(restore.selector)?.focus();
  if (
    isProduction() &&
    document.activeElement === document.body &&
    $("#launch-state-title")
  ) {
    $("#launch-state-title").tabIndex = -1;
    $("#launch-state-title").focus();
  }
});
document.addEventListener("keydown", (event) => {
  const dialog = $("#review-dialog");
  if (dialog.open && event.key === "Tab") {
    trapDialogTab(event, dialog);
    return;
  }
  if (
    !(event.target instanceof Element) ||
    !event.target.matches('[role="tab"]')
  )
    return;
  const tabs = $$('.tabs [role="tab"]');
  const index = tabs.indexOf(event.target);
  let next;
  if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
  else if (event.key === "ArrowLeft")
    next = (index + tabs.length - 1) % tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else return;
  event.preventDefault();
  navigate(
    app.route.eventId,
    tabs[next].dataset.view,
    `[data-view="${tabs[next].dataset.view}"]`,
  );
});
$("#refresh").addEventListener("click", () => load({ coalesce: true }));
$(".skip").addEventListener("click", (event) => focusMain(event, $("#main")));
$("#demo-help").addEventListener("click", showDemoHelp);
// A filter creates a new review context; durable unresolved saves stay locked.
function resetBatchFilterContext(event) {
  if (
    !(event.target instanceof Element) ||
    !event.target.matches("[data-contract-search], [data-contract-filter]")
  )
    return;
  disposeBatchActions("approve-admission");
  batchFilterRevisions["approve-admission"]++;
  app.batchRegistrationSelection = null;
  renderBatchRegistrationFollowup();
  invalidateDraft();
  queueMicrotask(() => mountOrganizerBatchActions());
}
document.addEventListener("input", resetBatchFilterContext, true);
document.addEventListener("change", resetBatchFilterContext, true);

window.addEventListener("hashchange", () => {
  invalidateDraft();
  load();
  window.scrollTo({ top: 0 });
});
load();
