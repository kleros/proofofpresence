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
  assertCreationReplacement,
  lumaEventUrl,
  depositWei,
  creationReviewDisclosure,
} from "./luma-factory.js";
import { attendanceStandardText } from "./luma-launch.js";
import { mountSetupProgress } from "./setup-progress.js";
import { assertV10WalletAccount } from "./v10-wallet-account.js";
import { validateEventTimeZone, eventTimeToUtc, eventTimeFromUtc, formatEventTime, eventTimeZones } from "./event-timezone.js";

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
let timezoneListSequence = 0;
const TIMEZONE_PRESETS = Object.freeze([
  ["Asia/Kolkata", "India · IST (UTC+05:30)"],
  ["Asia/Bangkok", "Bangkok · ICT (UTC+07:00)"],
  ["UTC", "UTC"],
]);

const JOB_PATH = "/api/organizer/events/jobs";
const JOB_FIELDS = [
  "title",
  "lumaUrl",
  "startsAt",
  "endsAt",
  "timezone",
  "depositEth",
];
const jobFailure = (message, code, job) =>
  Object.assign(new Error(message), {
    code,
    ...(job ? { organizerJob: job } : {}),
  });

/** App-only asynchronous transport. It never reads or changes a transaction journal. */
export function createOrganizerJobClient({
  bootstrap,
  storage,
  origin,
  request,
  isCurrent = () => true,
  onStatus = () => {},
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  newId = () => crypto.randomUUID(),
}) {
  const read = factoryReadScope(bootstrap);
  const scope = Object.freeze({
    origin,
    instanceId: read.instanceId,
    mode: read.mode,
    chainId: 1,
    factory: read.contract.toLowerCase(),
    wallet: read.wallet.toLowerCase(),
    contractVersion: read.abiVersion,
  });
  const prefix =
    "kleros-organizer-job:v1:" +
    Object.values(scope).map(encodeURIComponent).join(":") +
    ":";
  const active = new Map();
  const ready = new Map();
  let alive = true,
    validation = null,
    lastTime = 0;
  const clock = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < lastTime || value < 0)
      throw jobFailure(
        "Check your device clock before preparing an event review.",
        "ORGANIZER_JOB_CLOCK",
      );
    lastTime = value;
    return value;
  };
  const current = (extra = () => true) => {
    if (!alive || !isCurrent() || !extra())
      throw jobFailure(
        "The event form, wallet or environment changed. Review the current form again.",
        "ORGANIZER_JOB_STALE",
      );
    clock();
  };
  const load = (key) => {
    let item;
    try {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      item = JSON.parse(raw);
    } catch {}
    if (
      item?.version !== 1 ||
      JSON.stringify(item.scope) !== JSON.stringify(scope) ||
      !stableId(item.requestId) ||
      !/^[a-f0-9]{64}$/.test(item.payloadHash) ||
      !["prepare", "validate", "reconcile", "replacement"].includes(item.operation) ||
      (item.operation === "replacement" && (scope.contractVersion !== "kleros-event-v10-uups" || bootstrap.capabilities?.creationReplacementRecovery !== true)) ||
      !["pending", "ready", "failed", "expired"].includes(item.state)
    )
      throw jobFailure(
        "The saved organizer check is unreadable. Preserve browser storage before continuing.",
        "ORGANIZER_JOB_STORAGE",
      );
    return item;
  };
  const save = (key, item) => {
    try {
      const raw = JSON.stringify(item);
      storage.setItem(key, raw);
      if (storage.getItem(key) === raw) return;
    } catch {}
    throw jobFailure(
      "The browser must retain the organizer check before it can start.",
      "ORGANIZER_JOB_STORAGE",
    );
  };
  const terminal = (key, item, message, code) => {
    save(key, item);
    return jobFailure(message, code, {
      key,
      requestId: item.requestId,
      operation: item.operation,
      state: item.state,
    });
  };
  function payload(operation, args) {
    if (operation === "prepare") {
      if (
        !args?.input ||
        Object.keys(args.input).length !== 6 ||
        !JOB_FIELDS.every((key) => typeof args.input[key] === "string")
      )
        throw jobFailure(
          "Use the six event terms from the current form.",
          "ORGANIZER_JOB_INPUT",
        );
      return {
        operation,
        input: Object.fromEntries(
          JOB_FIELDS.map((key) => [key, args.input[key]]),
        ),
      };
    }
    if (
      !["validate", "reconcile", "replacement"].includes(operation) ||
      (operation === "replacement" && (scope.contractVersion !== "kleros-event-v10-uups" || bootstrap.capabilities?.creationReplacementRecovery !== true)) ||
      !stableId(args?.draftId)
    )
      throw jobFailure(
        "Choose the original organizer review.",
        "ORGANIZER_JOB_INPUT",
      );
    if (operation === "validate") return { operation, draftId: args.draftId };
    if (!hashPattern.test(args.hash ?? ""))
      throw jobFailure(
        "Use the exact original transaction ID.",
        "ORGANIZER_JOB_INPUT",
      );
    return { operation, draftId: args.draftId, hash: args.hash.toLowerCase() };
  }
  const client = {
    async run(operation, args, { isCurrent: extra = () => true } = {}) {
      current(extra);
      const body = payload(operation, args),
        bytes = new TextEncoder().encode(JSON.stringify(body));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      current(extra);
      const payloadHash = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const key = prefix + operation + ":" + payloadHash;
      if (active.has(key))
        throw jobFailure(
          "This organizer check is already running.",
          "ORGANIZER_JOB_BUSY",
        );
      let item = load(key),
        first = !item;
      if (
        item &&
        (item.operation !== operation || item.payloadHash !== payloadHash)
      )
        throw jobFailure(
          "The saved organizer check differs from this form.",
          "ORGANIZER_JOB_STORAGE",
        );
      if (!item) {
        item = {
          version: 1,
          scope,
          requestId: newId(),
          operation,
          payloadHash,
          startedAt: clock(),
          state: "pending",
        };
        if (!stableId(item.requestId))
          throw jobFailure(
            "An organizer request ID could not be created.",
            "ORGANIZER_JOB_STORAGE",
          );
        save(key, item); // No await between the durable identity and the single initial POST.
      }
      const controller = new AbortController(),
        timers = new Set();
      active.set(key, controller);
      const later = (callback, ms) => {
        const timer = setTimer(() => {
          timers.delete(timer);
          callback();
        }, ms);
        timers.add(timer);
        return timer;
      };
      const timed = later(() => controller.abort(), 180000);
      const waitFor = (promise) =>
        new Promise((resolve, reject) => {
          const aborted = () =>
            reject(
              jobFailure(
                "Stopped waiting. Keep this check and use Check status; no new request will be sent.",
                "ORGANIZER_JOB_WAIT_STOPPED",
              ),
            );
          if (controller.signal.aborted) return aborted();
          controller.signal.addEventListener("abort", aborted, { once: true });
          Promise.resolve(promise)
            .then(resolve, reject)
            .finally(() =>
              controller.signal.removeEventListener("abort", aborted),
            );
        });
      try {
        for (;;) {
          current(extra);
          onStatus(operation, first ? "starting" : "checking");
          current(extra);
          const envelope = await waitFor(
            request(
              first
                ? JOB_PATH
                : JOB_PATH + "/" + encodeURIComponent(item.requestId),
              first
                ? {
                    ...post({ requestId: item.requestId, ...body }),
                    signal: controller.signal,
                  }
                : { signal: controller.signal },
            ),
          );
          first = false;
          current(extra);
          if (
            envelope?.schemaVersion !== 1 ||
            envelope.kind !== "organizer-job" ||
            envelope.requestId !== item.requestId ||
            envelope.instanceId !== scope.instanceId ||
            envelope.operation !== operation ||
            envelope.chainId !== 1 ||
            !same(envelope.factory, scope.factory) ||
            envelope.contractVersion !== scope.contractVersion ||
            !same(envelope.wallet, scope.wallet) ||
            !["pending", "ready", "failed", "expired"].includes(envelope.state)
          )
            throw jobFailure(
              "The organizer check belongs to another form, wallet or environment.",
              "ORGANIZER_JOB_SCOPE",
            );
          item = { ...item, state: envelope.state };
          if (envelope.state === "failed")
            throw terminal(
              key,
              item,
              typeof envelope.error?.error === "string"
                ? envelope.error.error
                : "The organizer check failed. Prepare a new review explicitly.",
              typeof envelope.error?.code === "string"
                ? envelope.error.code
                : "ORGANIZER_JOB_FAILED",
            );
          if (envelope.state === "expired")
            throw terminal(
              key,
              item,
              "This organizer check expired. Choose Prepare a new review before continuing.",
              "ORGANIZER_JOB_EXPIRED",
            );
          if (envelope.state === "ready") {
            const ttl = operation === "validate" ? 5000 : 300000,
              at = clock();
            if (
              !Number.isSafeInteger(envelope.expiresAt) ||
              envelope.expiresAt <= at ||
              envelope.expiresAt > at + ttl
            )
              throw terminal(
                key,
                { ...item, state: "expired" },
                "The organizer review expired or your device clock differs. Prepare a new review.",
                "ORGANIZER_JOB_EXPIRED",
              );
            if (!envelope.result || typeof envelope.result !== "object")
              throw jobFailure(
                "The completed organizer check has no valid result.",
                "ORGANIZER_JOB_SCOPE",
              );
            save(key, item);
            ready.set(operation, {
              key,
              item,
              hash: body.hash,
              draftId: body.draftId,
              expiresAt: envelope.expiresAt,
              result: envelope.result,
              resultFacts:
                operation === "reconcile"
                  ? JSON.stringify(envelope.result)
                  : null,
            });
            if (operation === "validate")
              validation = { key, item, expiresAt: envelope.expiresAt };
            return envelope.result;
          }
          save(key, item);
          if (
            !Number.isSafeInteger(envelope.pollAfterMs) ||
            envelope.pollAfterMs < 1 ||
            envelope.pollAfterMs > 10000
          )
            throw jobFailure(
              "The organizer check returned an invalid polling interval.",
              "ORGANIZER_JOB_SCOPE",
            );
          await waitFor(
            new Promise((resolve) =>
              later(
                resolve,
                Math.min(5000, Math.max(500, envelope.pollAfterMs)),
              ),
            ),
          );
          current(extra);
        }
      } catch (error) {
        // An unknown response never licenses replay. Explicit user abandonment
        // can discard this app-only identity, while any wallet marker still blocks it.
        if (!error.organizerJob)
          error.organizerJob = {
            key,
            requestId: item.requestId,
            operation,
            state: item.state,
            abandon: true,
            ...(body.hash ? { hash: body.hash } : {}),
          };
        else if (body.hash) error.organizerJob.hash = body.hash;
        throw error;
      } finally {
        controller.abort();
        clearTimer(timed);
        for (const timer of timers) clearTimer(timer);
        active.delete(key);
      }
    },
    unusedResult(operation, error) {
      const saved = ready.get(operation);
      if (!error.organizerJob && saved)
        error.organizerJob = {
          key: saved.key,
          requestId: saved.item.requestId,
          operation,
          state: "ready",
          abandon: true,
          ...(saved.hash ? { hash: saved.hash } : {}),
        };
      return error;
    },
    advancePendingReceipt({ draftId, hash, result, context }) {
      current();
      const completed = ready.get("reconcile");
      const stored = completed ? load(completed.key) : null;
      if (
        !completed ||
        completed.result !== result ||
        completed.resultFacts !== JSON.stringify(result) ||
        completed.draftId !== draftId ||
        !same(completed.hash, hash) ||
        !hashPattern.test(hash ?? "") ||
        result?.status !== "pending" ||
        !same(result.hash, hash) ||
        result.chainId !== 1 ||
        !same(result.wallet, scope.wallet) ||
        !stableId(result.eventId) ||
        context?.eventId !== result.eventId ||
        context.chainId !== 1 ||
        !same(context.wallet, scope.wallet) ||
        !same(context.contract, scope.factory) ||
        context.abiVersion !== scope.contractVersion ||
        context.mode !== scope.mode ||
        completed.expiresAt <= clock() ||
        active.has(completed.key) ||
        stored?.state !== "ready" ||
        stored.operation !== "reconcile" ||
        stored.requestId !== completed.item.requestId ||
        stored.payloadHash !== completed.item.payloadHash
      )
        throw jobFailure(
          "The completed pending receipt check no longer belongs to this exact transaction.",
          "ORGANIZER_JOB_ADVANCE",
        );
      storage.removeItem(completed.key);
      if (storage.getItem(completed.key) !== null)
        throw jobFailure(
          "The completed receipt check could not be retained safely for the next read.",
          "ORGANIZER_JOB_STORAGE",
        );
      ready.delete("reconcile"); // Backend identity stays immutable; only a completed app-only read is retired.
    },
    consumeValidation() {
      if (!validation)
        throw jobFailure(
          "Validate this review again before opening your wallet.",
          "ORGANIZER_JOB_EXPIRED",
        );
      const saved = validation;
      if (clock() >= saved.expiresAt)
        throw terminal(
          saved.key,
          { ...saved.item, state: "expired" },
          "Validation expired before the wallet request. Prepare a new review.",
          "ORGANIZER_JOB_EXPIRED",
        );
      validation = null; // The wallet can stay open beyond this deadline; submitted hashes remain recoverable.
    },
    clearTerminal(error, { unsigned = false } = {}) {
      const job = error?.organizerJob;
      if (!job || !job.key.startsWith(prefix))
        throw jobFailure(
          "Check the original organizer request first.",
          "ORGANIZER_JOB_STORAGE",
        );
      const saved = load(job.key);
      if (
        !saved ||
        saved.requestId !== job.requestId ||
        saved.operation !== job.operation ||
        (!job.abandon && !["failed", "expired"].includes(saved.state))
      )
        throw jobFailure(
          "The organizer request has no confirmed terminal status.",
          "ORGANIZER_JOB_STORAGE",
        );
      const keys = [job.key];
      if (unsigned) {
        if (!["prepare", "validate"].includes(saved.operation))
          throw jobFailure(
            "Preserve the submitted transaction check.",
            "ORGANIZER_JOB_STORAGE",
          );
        for (let index = 0; index < storage.length; index++) {
          const candidate = storage.key(index);
          if (!candidate?.startsWith(prefix)) continue;
          const record = load(candidate);
          if (
            ["prepare", "validate"].includes(record.operation) &&
            ["ready", "failed", "expired"].includes(record.state)
          )
            keys.push(candidate);
        }
      }
      for (const candidate of new Set(keys)) storage.removeItem(candidate);
      validation = null;
    },
    stop() {
      for (const controller of active.values()) controller.abort();
    },
    dispose() {
      alive = false;
      client.stop();
    },
  };
  return client;
}

/** Serial, bounded factual receipt reads. All authoritative assertions remain in the caller. */
export function createReceiptWatcher({
  isCurrent,
  advance,
  check,
  onState = () => {},
  onCancel = () => {},
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const delays = [3000, 5000, 10000, 15000, 30000, 30000];
  let alive = true,
    revision = 0,
    pending = null,
    attempt = 0,
    deadline = 0,
    lastTime = 0;
  let nextTimer = null,
    limitTimer = null,
    inFlight = null;
  const clock = () => {
    const value = now();
    if (!Number.isFinite(value) || value < lastTime || value < 0)
      throw Error("Receipt checking clock is unavailable.");
    return (lastTime = value);
  };
  const valid = (value) =>
    value?.knownHash === true &&
    stableId(value.draftId) &&
    hashPattern.test(value.hash ?? "") &&
    value.result?.status === "pending" &&
    same(value.result.hash, value.hash) &&
    value.result.chainId === 1 &&
    same(value.result.wallet, value.context?.wallet) &&
    value.context?.chainId === 1 &&
    /^0x[0-9a-f]{40}$/i.test(value.context.wallet ?? "") &&
    stableId(value.context.eventId) &&
    value.result.eventId === value.context.eventId;
  const current = (value, captured) => {
    try {
      return (
        alive &&
        captured === revision &&
        valid(value) &&
        isCurrent(value) === true
      );
    } catch {
      return false;
    }
  };
  const sameReceipt = (a, b) =>
    a.draftId === b.draftId &&
    same(a.hash, b.hash) &&
    ["eventId", "instanceId", "chainId", "abiVersion", "mode"].every(
      (name) => a.context[name] === b.context[name],
    ) &&
    same(a.context.wallet, b.context.wallet) &&
    same(a.context.contract, b.context.contract);
  const clear = () => {
    if (nextTimer !== null) clearTimer(nextTimer);
    if (limitTimer !== null) clearTimer(limitTimer);
    nextTimer = limitTimer = null;
  };
  const stop = (state, cause = null) => {
    const previous = pending,
      captured = revision,
      report = previous && current(previous, captured);
    revision++;
    clear();
    pending = null;
    if (inFlight) onCancel();
    if (state && report) onState(state, previous, cause);
    return inFlight ?? Promise.resolve();
  };
  const schedule = (captured) => {
    if (!pending || !current(pending, captured)) {
      stop(null);
      return;
    }
    try {
      if (attempt >= delays.length || clock() >= deadline) {
        stop("limit");
        return;
      }
      nextTimer = setTimer(() => {
        nextTimer = null;
        const value = pending;
        if (!value || !current(value, captured)) {
          stop(null);
          return;
        }
        try {
          if (clock() >= deadline) {
            stop("limit");
            return;
          }
        } catch (cause) {
          stop("unavailable", cause);
          return;
        }
        const task = Promise.resolve().then(async () => {
          try {
            if (!current(value, captured)) return;
            if (clock() >= deadline) {
              stop("limit");
              return;
            }
            // No await between the final context/budget guard and retiring this completed read.
            advance(value);
            attempt++;
            if (!current(value, captured)) {
              if (captured === revision) stop(null);
              return;
            }
            onState("checking", value);
            const result = await check(value, () => current(value, captured));
            if (!current(value, captured)) return;
            if (!valid(result) || !sameReceipt(value, result)) {
              stop(result?.terminal === true ? null : "unavailable");
              return;
            }
            pending = result;
          } catch (cause) {
            if (current(value, captured)) stop("unavailable", cause);
          }
        });
        inFlight = task;
        void task.then(
          () => {
            if (inFlight === task) inFlight = null;
            if (pending && current(pending, captured)) schedule(captured);
            else if (captured === revision) stop(null);
          },
          (cause) => {
            if (inFlight === task) inFlight = null;
            if (captured === revision) stop("unavailable", cause);
          },
        );
      }, delays[attempt]);
    } catch (cause) {
      stop("unavailable", cause);
    }
  };
  return {
    start(value) {
      stop(null);
      if (!valid(value) || !alive) return false;
      const captured = revision;
      if (!current(value, captured)) return false;
      try {
        deadline = clock() + 180000;
      } catch (cause) {
        onState("unavailable", value, cause);
        return false;
      }
      pending = value;
      attempt = 0;
      limitTimer = setTimer(() => stop("limit"), 180000);
      schedule(captured);
      return true;
    },
    pause() {
      return stop("paused");
    },
    dispose() {
      alive = false;
      return stop(null);
    },
  };
}

/** A compact factory workflow. Mounting reads local recovery data only, never the wallet. */
export function mountLumaSetup(host, options) {
  let bootstrap = options.bootstrap;
  const displayMode = bootstrap?.kind === "kickback-setup-display";
  const directCreation = bootstrap?.contractVersion === "kleros-event-v10-uups" && bootstrap?.mode === "hosted-production";
  let replacementPreset = null, replacementIssue = null, replacementApplied = false;
  if (options.replacementPreset !== undefined) {
    const value = options.replacementPreset, input = value?.input;
    const originalEventId = "event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5", originalContract = "0xCd7418413fBFA814D41799C9dFaCc4654f295c11";
    const recoveryUrl = "/#event=" + originalEventId + "&view=participant&deposit=manage";
    if (directCreation && value?.kind === "truth-pays-ist-replacement-v1" && value.originalEventId === originalEventId &&
      same(value.originalContract, originalContract) && value.recoveryUrl === recoveryUrl &&
      input?.title === "Truth Pays: Queryable Data, Prediction Markets & Onchain Justice" && input.lumaUrl === "https://luma.com/qewnqhas" &&
      input.startsAt === "2026-11-04T12:30:00.000Z" && input.endsAt === "2026-11-04T16:30:00.000Z" && input.timezone === "Asia/Kolkata" && input.depositEth === "0.01" &&
      Object.keys(input).length === 6 && Object.keys(value).length === 5) replacementPreset = structuredClone(value);
    else replacementIssue = "The replacement event details changed. Open the reviewed replacement setup link again.";
  }
  const view = host.ownerDocument.createElement("div");
  const progressHost = host.ownerDocument.createElement("div");
  progressHost.dataset.lumaProgressHost = "";
  progressHost.hidden = true;
  host.replaceChildren(view, progressHost);
  let alive = true,
    busy = false,
    reviewed = null,
    dialog = null,
    marker = null,
    terminalAdopted = false,
    terminalJob = null,
    preparing = false,
    formRevision = 0,
    reviewedForm = null,
    receiptWatchActive = false,
    stopBootstrapWait = null;
  let scope,
    originalReadScope,
    storage,
    journal,
    key,
    storageIssue = null,
    jobs = null;
  const current = () =>
    alive && host.isConnected && options.isCurrent?.() !== false;
  const progress = mountSetupProgress(progressHost, {
    isCurrent: current,
    onCopy: async (hash) => {
      try {
        await host.ownerDocument.defaultView.navigator.clipboard.writeText(
          hash,
        );
      } catch {
        const input = progressHost.querySelector("[data-setup-progress-hash]");
        input?.focus();
        input?.select();
      }
    },
    onCheck: () => manualReceiptCheck(),
  });
  const pauseReceipts = host.ownerDocument.createElement("button");
  pauseReceipts.type = "button";
  pauseReceipts.className = "button button-quiet";
  pauseReceipts.dataset.lumaAction = "pause-receipts";
  pauseReceipts.textContent = "Pause automatic checks";
  pauseReceipts.hidden = true;
  progressHost.append(pauseReceipts);
  const showProgress = (phase, facts = {}) => {
    if (!current()) return;
    progressHost.hidden = false;
    progress.update({
      phase,
      chainId: 1,
      hash: marker?.hash ?? null,
      ...facts,
    });
  };
  const hideProgress = () => {
    progressHost.hidden = true;
  };
  const authenticated =
    bootstrap?.session?.mode === "wallet" &&
    typeof bootstrap.session.wallet === "string";
  const replacementEnabled = bootstrap?.contractVersion === "kleros-event-v10-uups" &&
    bootstrap.capabilities?.creationReplacementRecovery === true;
  let readyIssue = displayMode ? null : factorySetupIssue(bootstrap, { requireWallet: true });
  let disclosure = creationReviewDisclosure(bootstrap);
  const sameReadScope = (value) =>
    Boolean(originalReadScope) &&
    value.mode === originalReadScope.mode &&
    value.chainId === originalReadScope.chainId &&
    value.instanceId === originalReadScope.instanceId &&
    value.abiVersion === originalReadScope.abiVersion &&
    same(value.contract, originalReadScope.contract) &&
    same(value.wallet, originalReadScope.wallet);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timezoneListId = `luma-event-timezones-${++timezoneListSequence}`;
  const timezoneChoices = eventTimeZones(timezone).map(zone => `<option value="${escape(zone)}"></option>`).join("");
  const timezonePreset = zone => TIMEZONE_PRESETS.some(([value]) => value === zone) ? zone : "custom";
  const syncTimezoneChoice = form => {
    const choice = form?.elements.namedItem("timezoneChoice"), zone = form?.elements.namedItem("timezone");
    if (choice && zone) choice.value = timezonePreset(zone.value);
  };
  const dateForms = new WeakMap();
  const dateState = (form) => {
    if (!dateForms.has(form))
      dateForms.set(form, {
        endEdited: !!form.elements.namedItem("endsAt")?.value,
        suggested: null,
      });
    return dateForms.get(form);
  };
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
        (found.hash !== undefined && !hashPattern.test(found.hash)) ||
        (found.replacementCandidate !== undefined && !hashPattern.test(found.replacementCandidate))
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
          ...(known.canonicalHash ? { canonicalHash: known.canonicalHash, replacement: known.replacement } : {}),
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
      originalReadScope = factoryReadScope(bootstrap);
      storage = host.ownerDocument.defaultView.localStorage;
      journal = createTransactionJournal(storage);
      discoverRecovery();
      if (bootstrap.capabilities?.organizerJobs === true)
        jobs = createOrganizerJobClient({
          bootstrap,
          storage,
          origin: host.ownerDocument.location.origin,
          request: options.request,
          isCurrent: current,
          onStatus: (operation) =>
            status(
              operation === "prepare"
                ? "Preparing event…"
                : operation === "validate"
                  ? "Preparing transaction…"
                  : operation === "replacement"
                    ? "Checking the replacement transaction and event in the background…"
                    : "Checking the original transaction receipt in the background…",
            ),
        });
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
  // A recorded confirmation permits a distinct form, never a freshly verified
  // event link. Keep the original journal scoped to its original server.
  const recordedConfirmed = () => {
    if (marker?.phase !== "confirmed" || !scope || !hashPattern.test(marker.hash ?? "")) return false;
    const known = journal.get({ ...scope, eventId: marker.eventId }, marker.hash);
    return known?.status === "confirmed" && known.action === "createEvent" &&
      known.draftId === marker.draftId && same(known.hash, marker.hash);
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
  const offerTransactionInspection = (cause) => {
    if (
      !current() ||
      bootstrap?.features?.originalCreationRecovery === false ||
      bootstrap?.contractVersion === "kleros-event-v10-uups" ||
      cause.code !== "TX_MISMATCH" ||
      !hashPattern.test(marker?.hash ?? "")
    )
      return;
    const node = host.querySelector("[data-luma-error]");
    if (!node) return;
    const link = host.ownerDocument.createElement("a");
    link.href =
      "/recovery.html#" + new URLSearchParams({ transaction: marker.hash });
    link.textContent = "Inspect original transaction";
    link.className = "button button-quiet";
    node.append(" ", link);
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
      button.disabled =
        button.dataset.lumaAction === "pause-receipts"
          ? false
          : button.dataset.lumaAction === "stop-waiting"
            ? !value
            : value ||
              (button.dataset.lumaAction === "review" &&
                Boolean(
                  readyIssue ||
                    (terminalJob &&
                      !terminalJob.organizerJob?.abandon &&
                      terminalJob.organizerJob?.operation !== "reconcile"),
                ));
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
  const terminalControl = (cause) => {
    if (!current() || !cause?.organizerJob) return;
    terminalJob = cause;
    if (["reconcile", "replacement"].includes(cause.organizerJob.operation)) {
      const check = host.querySelector(`[data-luma-action="${cause.organizerJob.operation === "replacement" ? "check-replacement" : "reconcile"}"]`);
      if (check) check.textContent = "Check transaction again";
      return;
    }
    if (marker && marker.phase !== "prepared") return;
    reviewed = null;
    reviewedForm = null;
    closeDialog();
    if (!host.querySelector('[data-luma-action="reset-review"]')) {
      const button = host.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "button button-secondary";
      button.dataset.lumaAction = "reset-review";
      button.textContent = "Prepare a new review";
      host.querySelector(".luma-setup-actions")?.append(button);
    }
  };
  const runOperation = (operation, args, guard = current) =>
    jobs
      ? jobs.run(operation, args, { isCurrent: guard })
      : operation === "prepare"
        ? request("", args.input)
        : request(
            path(args.draftId) +
              "/" +
              (operation === "validate" ? "validate" : operation === "replacement" ? "replacement" : "reconcile"),
            operation === "validate" ? {} : { hash: args.hash },
          );
  const jobMessage = (cause) =>
    cause.message +
    (cause.organizerJob?.abandon && cause.organizerJob.state !== "ready"
      ? ["reconcile", "replacement"].includes(cause.organizerJob.operation)
        ? " This check is unavailable; a previous check may still be running. Check the same transaction again explicitly."
        : " This check is unavailable; a previous check may still be running. You can explicitly abandon this unsigned check with Prepare a new review."
      : "");
  const formFingerprint = (form) =>
    JSON.stringify(
      JOB_FIELDS.map((name) =>
        String(form.elements.namedItem(name)?.value ?? ""),
      ),
    );
  const reviewCurrent = () =>
    current() &&
    reviewedForm &&
    host.contains(reviewedForm.form) &&
    formRevision === reviewedForm.revision &&
    formFingerprint(reviewedForm.form) === reviewedForm.fingerprint;
  const receiptCurrent = (value) =>
    current() &&
    marker?.draftId === value.draftId &&
    marker?.eventId === value.context.eventId &&
    same(marker.hash, value.hash) &&
    scope?.instanceId === value.context.instanceId &&
    same(scope?.wallet, value.context.wallet) &&
    same(scope?.contract, value.context.contract) &&
    scope?.chainId === value.context.chainId &&
    scope?.abiVersion === value.context.abiVersion;
  const pendingReceipt = (result, draftId, context, knownHash) =>
    result.status === "pending" &&
    knownHash &&
    result.chainId === 1 &&
    same(result.wallet, context.wallet)
      ? {
          result,
          draftId,
          context: Object.freeze({ ...context }),
          hash: result.hash,
          knownHash: true,
        }
      : null;
  const watchActivity = (active) => {
    receiptWatchActive = active;
    pauseReceipts.hidden = !active;
    pauseReceipts.disabled = false;
  };
  const receiptWatcher = createReceiptWatcher({
    isCurrent: receiptCurrent,
    advance: (value) => {
      jobs.advancePendingReceipt(value);
      terminalJob = null;
    },
    check: (value, guard) => reconcile({ guard, captured: value }),
    onCancel: () => jobs?.stop(),
    onState: (state, _value, cause) => {
      if (state === "checking") return;
      watchActivity(false);
      showProgress("unavailable", {
        message:
          state === "paused"
            ? "Automatic receipt checks are paused. Keep the transaction ID and check its status when ready."
            : state === "limit"
              ? "Automatic checking has reached its limit. Keep the transaction ID and check its status again."
              : "Receipt checking stopped. Keep the transaction ID and check the saved request status before continuing.",
        reasonCode:
          cause?.code ??
          (state === "limit"
            ? "RECEIPT_WATCH_LIMIT"
            : state === "paused"
              ? "RECEIPT_WATCH_PAUSED"
              : "RECEIPT_CHECK_UNAVAILABLE"),
      });
    },
  });
  const startReceiptWatch = (value) => {
    if (!jobs || !value || !receiptCurrent(value)) return;
    watchActivity(receiptWatcher.start(value));
    if (receiptWatchActive)
      showProgress("confirmations", {
        message:
          "The transaction is still pending. Its original receipt will be checked automatically for a limited time.",
      });
  };
  const renderRecovery = () => {
    if (!current()) return;
    void receiptWatcher.pause();
    watchActivity(false);
    closeDialog();
    const terminal = marker.phase === "failed";
    const recorded = recordedConfirmed();
    const replacementInput = bootstrap.capabilities?.creationReplacementRecovery === true && scope.abiVersion === "kleros-event-v10-uups" && marker.hash && !terminal
      ? `<details data-luma-replacement><summary>Used Speed Up in your wallet?</summary><p>Paste the already-signed replacement transaction ID to verify its receipt and event. This check cannot send or speed up a transaction.</p><label for="luma-replacement-hash">Replacement transaction ID</label><input id="luma-replacement-hash" name="replacementHash" autocomplete="off" spellcheck="false" placeholder="0x…" value="${escape(marker.canonicalHash ?? marker.replacementCandidate ?? "")}" /><button class="button button-secondary" data-luma-action="check-replacement">Check replacement</button></details>` : "";
    view.innerHTML = `<section class="luma-setup"><div class="eyebrow">KICKBACK SETUP</div><h1>${recorded ? "Recorded event creation" : terminal ? "Event creation failed" : "Check your event transaction"}</h1><div class="luma-setup-recovery" data-luma-recovery><p>${recorded ? "Your browser records this event creation as confirmed. Check its receipt or create a different event." : terminal ? "The canonical receipt shows that this transaction failed. No deposit link has been created." : marker.hash ? "Your wallet returned a transaction ID. Check its canonical receipt before creating another event." : "A wallet request may still be pending. Check your wallet activity before continuing. This page will not send that request again."}</p>${scope.instanceId !== bootstrap.instanceId ? recorded ? "<p>This recorded transaction belongs to an earlier server instance.</p>" : "<p>This request belongs to an earlier server instance. Only its original receipt can be checked here.</p>" : ""}${marker.hash ? `<p>Original transaction ID</p><code class="mono" data-luma-hash>${escape(marker.hash)}</code>` : '<label for="luma-recovery-hash">Transaction ID from your wallet</label><input id="luma-recovery-hash" name="txHash" autocomplete="off" spellcheck="false" placeholder="0x…" />'}${marker.replacementCandidate || marker.canonicalHash ? `<p>Replacement transaction ID · verification required</p><code class="mono" data-luma-replacement-hash>${escape(marker.canonicalHash ?? marker.replacementCandidate)}</code>` : ""}<div class="luma-setup-actions"><button class="button ${recorded ? "button-secondary" : "button-primary"}" data-luma-action="reconcile">Check transaction</button>${recorded || terminal && terminalAdopted ? '<button class="button button-primary" data-luma-action="new">Create new event</button>' : ""}</div>${replacementInput}</div><p data-luma-status role="status" aria-live="polite"></p><p class="luma-setup-error" data-luma-error role="alert" hidden></p></section>`;
  };
  const renderShare = (result) => {
    if (!current()) return;
    void receiptWatcher.pause();
    watchActivity(false);
    terminalAdopted = true;
    closeDialog();
    view.innerHTML = `<section class="luma-setup"><div class="eyebrow">EVENT CREATED</div><h1>Your deposit page is ready.</h1><p>Share this event-specific link in your Luma registration. Guests can connect their wallet, deposit, and copy their transaction ID.</p><section class="luma-setup-share" data-luma-created><h2>Share the deposit link</h2><label for="luma-created-link">Event deposit page</label><input id="luma-created-link" data-luma-deposit-link readonly value="${escape(result.participantUrl)}" /><div class="luma-setup-actions"><button class="button button-primary" data-luma-action="copy-link">Copy deposit link</button><a class="button button-secondary" href="${escape(result.participantUrl)}">Open deposit page</a><button class="button button-quiet" data-luma-action="new">Set up another event</button></div><details><summary>Confirmed transaction</summary><dl class="luma-setup-terms"><dt>${result.canonicalHash ? "Original transaction ID" : "Transaction ID"}</dt><dd><code data-luma-hash>${escape(result.hash)}</code></dd>${result.canonicalHash ? `<dt>Confirmed replacement transaction ID</dt><dd><code data-luma-replacement-hash>${escape(result.canonicalHash)}</code></dd>` : ""}<dt>Event contract</dt><dd><code>${escape(result.contract)}</code></dd><dt>Network</dt><dd>Ethereum Mainnet · Chain 1</dd><dt>Confirmed block</dt><dd>${escape(result.blockNumber)}</dd></dl></details></section><p data-luma-status role="status" aria-live="polite">Event creation confirmed.</p><p class="luma-setup-error" data-luma-error role="alert" hidden></p></section>`;
    showProgress("ready", {
      hash: result.canonicalHash ?? result.hash,
      transactionConfirmed: true,
      event: {
        id: result.eventId,
        verified: true,
        depositUrl: result.participantUrl,
        manageUrl:
          host.ownerDocument.location.origin +
          "/#" +
          new URLSearchParams({ event: result.eventId, view: "organizer" }),
      },
    });
    options.onComplete?.(result);
  };
  const renderForm = () => {
    if (!current()) return;
    if (storageIssue || replacementIssue) {
      view.innerHTML = `<section class="luma-setup"><h1>Set up kickback</h1><p class="luma-setup-error" data-luma-setup-issue role="alert">${escape(storageIssue || replacementIssue)}</p></section>`;
      return;
    }
    if (marker) {
      renderRecovery();
      return;
    }
    const issue = displayMode ? null : authenticated ? readyIssue : factorySetupIssue(bootstrap);
    const standard = attendanceStandardText(
      bootstrap.organizerSetup?.attendanceStandard,
    );
    const timezoneControl = `<div><label for="luma-timezone-choice">Event timezone</label><select id="luma-timezone-choice" name="timezoneChoice">${TIMEZONE_PRESETS.map(([value, label]) => `<option value="${escape(value)}" ${timezonePreset(timezone) === value ? "selected" : ""}>${escape(label)}</option>`).join("")}<option value="custom" ${timezonePreset(timezone) === "custom" ? "selected" : ""}>Search / custom timezone</option></select><label for="luma-timezone">Search or enter an IANA timezone</label><input id="luma-timezone" name="timezone" list="${timezoneListId}" required value="${escape(timezone)}" autocomplete="off" aria-describedby="luma-timezone-help" /><datalist id="${timezoneListId}">${timezoneChoices}</datalist><p id="luma-timezone-help" class="field-help">Start and end use this timezone. Choose UTC if a time occurs twice during a clock change.</p></div>`;
    const capacityControl = `<div><label for="luma-capacity">Contract capacity · guests</label><input id="luma-capacity" type="number" value="150" min="150" max="150" readonly aria-describedby="luma-capacity-help" /><p id="luma-capacity-help" class="field-help">Fixed at 150 by this launch contract.</p></div>`;
    const replacementNotice = replacementPreset
      ? `<p class="luma-setup-notice" data-luma-replacement-preset>Creating this replacement event makes a new contract and deposit link. The original event and its deposits stay unchanged. <a href="${escape(replacementPreset.recoveryUrl)}">Recover unused deposits from the original event</a>.</p>` : "";
    view.innerHTML = `<section class="luma-setup"><div class="eyebrow">FOR LUMA ORGANIZERS</div><h1>Set up kickback.</h1><p>${directCreation ? "Set your event hours and fixed terms, then confirm creation in your wallet." : "Create one deposit page for your Luma event. Review the fixed terms before your wallet opens."}</p>${replacementNotice}${issue ? `<p class="luma-setup-notice" data-luma-setup-issue>${escape(issue)}</p>` : ""}${standard ? `<p class="luma-setup-notice" data-luma-attendance-standard>${escape(standard)}</p>` : ""}${!authenticated ? '<div class="luma-launch-card"><h2>Connect your organizer wallet</h2><p>Use the wallet that will manage this event.</p><button class="button button-primary" data-connect-wallet>Connect wallet</button></div>' : `<form class="luma-setup-form" data-luma-form><div class="full"><label for="luma-title">Event title</label><input id="luma-title" name="title" required maxlength="120" autocomplete="off" /></div><div class="full"><label for="luma-url">Luma event URL</label><input id="luma-url" name="lumaUrl" type="url" required placeholder="https://luma.com/your-event" /><p class="field-help">Registration stays on Luma. No guest names or emails are imported.</p></div><div><label for="luma-start">Starts · event time</label><input id="luma-start" name="startsAt" type="datetime-local" required /></div><div><label for="luma-end">Ends · event time</label><input id="luma-end" name="endsAt" type="datetime-local" required aria-describedby="luma-end-help" /><p id="luma-end-help" class="field-help">Defaults to 2 hours after start until you edit it.</p></div>${timezoneControl}${capacityControl}<div><label for="luma-deposit">Deposit per guest · ETH</label><input id="luma-deposit" name="depositEth" required inputmode="decimal" placeholder="0.01" autocomplete="off" /></div>${disclosure ? `<p class="luma-setup-notice full" data-luma-publication-disclosure>${escape(disclosure.publicationNotice)}</p>` : ""}<p class="luma-setup-capacity full">Fixed capacity: <strong>150 guests</strong> · Claim period: <strong>7 days</strong> · Challenge and response windows: <strong>1 day each</strong></p><div class="luma-setup-actions"><button class="button button-primary" data-luma-action="review" ${readyIssue ? "disabled" : ""}>${directCreation ? "Create event in wallet" : "Review event setup"}</button></div></form>`}<p data-luma-status role="status" aria-live="polite"></p><p class="luma-setup-error" data-luma-error role="alert" hidden></p></section>`;
    if (replacementPreset && !replacementApplied && authenticated) {
      const form = view.querySelector("[data-luma-form]"), input = replacementPreset.input;
      for (const name of ["title", "lumaUrl", "timezone", "depositEth"]) form.elements.namedItem(name).value = input[name];
      form.elements.namedItem("startsAt").value = eventTimeFromUtc(input.startsAt, input.timezone);
      form.elements.namedItem("endsAt").value = eventTimeFromUtc(input.endsAt, input.timezone);
      dateState(form).endEdited = true;
      syncTimezoneChoice(form);
      replacementApplied = true;
    }
  };
  const formInput = (form) => {
    const values = new FormData(form),
      title = String(values.get("title") ?? "").trim();
    const lumaUrl = lumaEventUrl(String(values.get("lumaUrl") ?? ""));
    if (!title || !lumaUrl)
      throw Error(
        "Enter an event title and a valid https://luma.com event URL without query parameters.",
      );
    const eventTimezone = validateEventTimeZone(String(values.get("timezone") ?? ""));
    const startsAt = eventTimeToUtc(String(values.get("startsAt") ?? ""), eventTimezone),
      endsAt = eventTimeToUtc(String(values.get("endsAt") ?? ""), eventTimezone);
    if (
      Date.parse(startsAt) <= Date.now() ||
      Date.parse(endsAt) <= Date.parse(startsAt)
    )
      throw Error(
        "The event must start in the future and end after it starts.",
      );
    const depositEth = String(values.get("depositEth") ?? "").trim();
    depositWei(depositEth);
    return { title, lumaUrl, startsAt, endsAt, timezone: eventTimezone, depositEth };
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
    dialog.innerHTML = `<header><h2 id="luma-review-title" tabindex="-1">Review event setup</h2><button type="button" class="button button-quiet" data-luma-action="close">Close</button></header><p>These event terms are fixed when this transaction confirms.</p><dl class="luma-setup-terms"><dt>Event</dt><dd>${escape(terms.title)}</dd><dt>Luma registration</dt><dd>${escape(terms.lumaUrl)}</dd><dt>Starts</dt><dd>${escape(formatEventTime(new Date(terms.eventStart * 1000), terms.timezone))}<small>${escape(date(terms.eventStart))}</small></dd><dt>Ends</dt><dd>${escape(formatEventTime(terms.endsAt, terms.timezone))}<small>${escape(new Date(terms.endsAt).toISOString())}</small></dd><dt>Deposit per guest</dt><dd>${escape(terms.depositEth)} ETH<small>${escape(terms.depositWei)} wei</small></dd><dt>Capacity</dt><dd>150 guests</dd><dt>Claim deadline</dt><dd>${escape(formatEventTime(new Date(terms.claimDeadline * 1000), terms.timezone))} · 7 days<small>${escape(date(terms.claimDeadline))}</small></dd><dt>Challenge / response</dt><dd>1 day each</dd>${disclosure ? `<dt>Publication</dt><dd data-luma-review-publication>${escape(disclosure.publication)}<small>${escape(disclosure.publicationNotice)}</small></dd>` : ""}<dt>Attendance standard</dt><dd data-luma-review-attendance-standard>${escape(attendanceStandardText(terms.attendanceStandard))}</dd><dt>Network</dt><dd>Ethereum Mainnet · Chain 1</dd><dt>Organizer wallet</dt><dd><code>${escape(draft.wallet)}</code></dd><dt>Factory recipient</dt><dd><code>${escape(draft.contract)}</code></dd><dt>Transaction value</dt><dd>0 ETH · wallet estimates network fees</dd><dt>Gas estimate</dt><dd>${escape(draft.transaction.gasLimit)} gas · not a fixed fee</dd><dt>Policy</dt><dd>${escape(terms.policyURI)}<small><code>${escape(terms.policySha256)}</code></small></dd><dt>Review block / expiry</dt><dd>${escape(draft.reviewBlock)} · ${escape(new Date(draft.expiresAt).toISOString())}</dd></dl><p class="luma-setup-notice">${disclosure ? escape(disclosure.upgradeNotice) : "The upgrade owner can change contract logic after the 48-hour timelock. Ownership transfers require acceptance; this delay does not guarantee withdrawals."}</p><p data-luma-dialog-status role="status"></p><div class="luma-setup-actions"><button type="button" class="button button-primary" data-luma-action="confirm">Create event in wallet</button></div>`;
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
    if (
      busy ||
      !current() ||
      marker ||
      (terminalJob && !terminalJob.organizerJob?.abandon)
    )
      return;
    terminalJob = null;
    host.querySelector('[data-luma-action="reset-review"]')?.remove();
    error("");
    lock(true);
    preparing = true;
    reviewed = null;
    reviewedForm = null;
    let stop;
    try {
      if (!displayMode && readyIssue) throw Error(readyIssue);
      journal.probe();
      const input = formInput(form);
      const revision = formRevision,
        fingerprint = formFingerprint(form);
      const unchanged = () =>
        current() &&
        host.contains(form) &&
        formRevision === revision &&
        formFingerprint(form) === fingerprint;
      if (jobs) {
        stop = host.ownerDocument.createElement("button");
        stop.type = "button";
        stop.className = "button button-quiet";
        stop.dataset.lumaAction = "stop-waiting";
        stop.textContent = "Stop waiting";
        form.querySelector(".luma-setup-actions").append(stop);
      }
      status("Preparing event…");
      showProgress("preparing");
      const preparedContext = bootstrap?.contractVersion === "kleros-event-v10-uups";
      if (preparedContext && typeof options.prepareConnection === "function") {
        await options.prepareConnection();
        if (!unchanged()) throw jobFailure("The event form or wallet changed. Review the current terms again.", "ORGANIZER_JOB_STALE");
      }
      if (!preparedContext && (displayMode || typeof options.prepareBootstrap === "function")) {
        if (typeof options.prepareBootstrap !== "function")
          throw Error("Fresh setup checks are unavailable. Reload setup before reviewing this event.");
        if (!sameReadScope(factoryReadScope(bootstrap)))
          throw Error("The factory wallet or environment changed. Reload setup before continuing.");
        const fresh = await new Promise((resolve, reject) => {
          let waiting = true;
          const stopWaiting = () => {
            waiting = false;
            reject(jobFailure(
              "Stopped waiting for setup checks. Your form is preserved; choose Review event setup to check again.",
              "ORGANIZER_JOB_WAIT_STOPPED",
            ));
          };
          stopBootstrapWait = stopWaiting;
          Promise.resolve().then(() => {
            if (!waiting || !unchanged())
              throw jobFailure("The event form or sign-in changed. Review the current terms again.", "ORGANIZER_JOB_STALE");
            return options.prepareBootstrap();
          }).then(resolve, reject).finally(() => {
            if (stopBootstrapWait === stopWaiting) stopBootstrapWait = null;
          });
        });
        if (!unchanged())
          throw jobFailure("The event form or sign-in changed. Review the current terms again.", "ORGANIZER_JOB_STALE");
        const issue = factorySetupIssue(fresh, { requireWallet: true });
        if (fresh?.kind === "kickback-setup-display" || issue)
          throw Error(issue || "Fresh factory verification is required before reviewing this event.");
        if (!sameReadScope(factoryReadScope(fresh)) || !sameReadScope(factoryReadScope(bootstrap)))
          throw Error("The factory wallet or environment changed. Reload setup before continuing.");
        bootstrap = fresh;
        readyIssue = issue;
        disclosure = creationReviewDisclosure(fresh);
      }
      const draft = await runOperation("prepare", { input }, unchanged);
      if (!unchanged())
        throw jobFailure(
          "The event form changed. Review the current terms again.",
          "ORGANIZER_JOB_STALE",
        );
      if (preparedContext) {
        const context = draft.creationContext;
        if (context?.kind !== "verified-creation-context-v1" || context.draftId !== draft.id ||
            context.snapshot !== draft.snapshot || context.origin !== location.origin ||
            !same(context.wallet, originalReadScope.wallet) || !sameReadScope(factoryReadScope(context)))
          throw jobs ? jobs.unusedResult("prepare", Error("The event preparation context changed. Review the current form again.")) : Error("The event preparation context changed.");
        const issue = factorySetupIssue(context, { requireWallet: true });
        if (issue) throw jobs ? jobs.unusedResult("prepare", Error(issue)) : Error(issue);
        bootstrap = context;
        readyIssue = null;
        disclosure = creationReviewDisclosure(context);
      }
      try {
        reviewed = assertCreationDraft(draft, bootstrap, input);
      } catch (cause) {
        throw jobs ? jobs.unusedResult("prepare", cause) : cause;
      }
      reviewedForm = { form, revision, fingerprint };
      if (directCreation) {
        options.beforeOpen?.();
        if (!reviewCurrent()) throw Error("The event form or wallet changed. Create this event again from the current form.");
        if (host.ownerDocument.querySelector("dialog[open]")) throw Error("Close the current wallet review before creating an event.");
        preparing = false;
        stop?.remove();
        lock(false);
        await send();
      } else {
        openReview(reviewed);
        hideProgress();
        status("Review the event terms before opening your wallet.");
      }
    } catch (cause) {
      terminalControl(cause);
      error(jobMessage(cause));
      showProgress("unavailable", {
        reasonCode: cause.code,
        message:
          "The review is unavailable. Your form has been preserved; no wallet transaction was requested.",
      });
      status("Event setup has not been submitted.");
    } finally {
      preparing = false;
      stopBootstrapWait = null;
      stop?.remove();
      lock(false);
    }
  };
  const send = async () => {
    if (busy || !reviewed || marker || !reviewCurrent()) return;
    const draft = assertCreationDraft(reviewed, bootstrap),
      context = creationContext(bootstrap, draft);
    error("");
    lock(true);
    let confirmedPending = null;
    try {
      showProgress("validating");
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
            if (!reviewCurrent())
              throw Error(
                "The authenticated setup context changed. No wallet request was made.",
              );
            if (context.abiVersion === "kleros-event-v10-uups") {
              await assertV10WalletAccount({
                provider: rawProvider,
                wallet: context.wallet,
                bootstrap,
              });
              if (!reviewCurrent() || options.provider?.() !== rawProvider)
                throw Error(
                  "The reviewed V10 wallet or setup context changed. Prepare a fresh review.",
                );
              assertCreationDraft(draft, bootstrap);
            }
            if (jobs) jobs.consumeValidation();
            persist({ ...marker, phase: "wallet-requested" });
            showProgress("wallet-review");
            const notice = dialog?.querySelector("[data-luma-dialog-status]");
            if (notice)
              notice.textContent =
                "Confirm the reviewed event creation in your wallet.";
          }
          return rawProvider.request(payload);
        },
      };
      const preparingNotice = dialog?.querySelector("[data-luma-dialog-status]");
      if (preparingNotice) preparingNotice.textContent = "Preparing transaction…";
      const result = await submitWalletDraft({
        draft,
        context,
        provider,
        journal,
        isCurrentContext: () => reviewCurrent(),
        validate: async () => {
          const result = await runOperation(
            "validate",
            { draftId: draft.id },
            reviewCurrent,
          );
          try {
            return assertCreationValidation(result, draft, bootstrap);
          } catch (cause) {
            throw jobs ? jobs.unusedResult("validate", cause) : cause;
          }
        },
        recordSubmitted: async (_event, _id, hash) => {
          persist({ ...marker, hash, phase: "submitted" });
          closeDialog();
          showProgress("submitted", { hash });
          await request(path(draft.id) + "/submitted", { hash });
        },
        confirm: async (_event, _id, hash) => {
          showProgress("confirmations", { hash });
          const result = assertCreationReceipt(
            await runOperation("reconcile", { draftId: draft.id, hash }),
            context,
            hash,
            host.ownerDocument.location.origin,
          );
          confirmedPending = pendingReceipt(
            result,
            draft.id,
            context,
            same(marker?.hash, hash),
          );
          return result;
        },
      });
      persist({ ...marker, hash: result.hash, phase: "confirmed" });
      renderShare(result);
    } catch (cause) {
      if (
        jobs &&
        cause.submittedHash &&
        cause.code === "TRANSACTION_UNCONFIRMED"
      )
        cause = jobs.unusedResult("reconcile", cause);
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
      else closeDialog();
      terminalControl(cause);
      error(
        jobMessage(cause) +
          (cause.submittedHash
            ? " Transaction ID: " + cause.submittedHash
            : ""),
      );
      offerTransactionInspection(cause);
      if (!marker && current())
        status(
          cause.organizerJob
            ? "No wallet request was made. Choose Prepare a new review to start a new unsigned review."
            : "No transaction ID was returned. Review and try again only if your wallet rejected the request.",
        );
      if (
        confirmedPending &&
        same(cause.submittedHash, confirmedPending.hash)
      ) {
        error("");
        showProgress("confirmations");
      } else
        showProgress(
          cause.code === "TRANSACTION_REVERTED"
            ? "reverted"
            : !marker &&
                !cause.submittedHash &&
                (cause.code === 4001 || cause.code === "ACTION_REJECTED")
              ? "cancelled"
              : "unavailable",
          {
            reasonCode: typeof cause.code === "string" ? cause.code : undefined,
          },
        );
    } finally {
      lock(false);
      if (confirmedPending && receiptCurrent(confirmedPending))
        startReceiptWatch(confirmedPending);
    }
  };
  const reconcile = async ({ guard = current, captured = null } = {}) => {
    if (busy || !marker || !current() || !scope || !guard()) return null;
    error("");
    lock(true);
    let receiptReadCurrent = guard;
    try {
      const hash =
        marker.hash || host.querySelector('[name="txHash"]')?.value?.trim();
      if (!hashPattern.test(hash ?? ""))
        throw Error(
          "Enter the complete transaction ID from the original wallet request.",
        );
      const context = { ...scope, eventId: marker.eventId };
      const draftId = marker.draftId;
      const unchanged = () =>
        current() &&
        guard() &&
        marker?.draftId === draftId &&
        marker?.eventId === context.eventId &&
        (!captured || receiptCurrent(captured)) &&
        (marker?.hash
          ? same(marker.hash, hash)
          : same(host.querySelector('[name="txHash"]')?.value?.trim(), hash));
      receiptReadCurrent = unchanged;
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
      showProgress("confirmations");
      const response = await runOperation("reconcile", { draftId, hash }, unchanged);
      const isReplacement = response?.canonicalHash !== undefined || response?.replacement !== undefined;
      if (isReplacement && !replacementEnabled)
        throw Error("Replacement recovery is unavailable in this environment. Preserve both transaction IDs.");
      const result = isReplacement
        ? assertCreationReplacement(response, context, hash, response.canonicalHash, host.ownerDocument.location.origin)
        : assertCreationReceipt(response, context, hash, host.ownerDocument.location.origin);
      if (!unchanged()) return null;
      if (result.status === "pending") {
        const recovery = result.replacementRecovery;
        const savedSubmission = replacementEnabled && recovery?.witnessRetained === true && recovery?.reviewSealRetained === true &&
          same(recovery.originalHash, hash) && same(recovery.wallet, context.wallet) &&
          Number.isSafeInteger(recovery.nonce) && recovery.nonce >= 0 && /^[0-9a-f]{64}$/.test(recovery.witnessHash ?? "") &&
          /^[0-9a-f]{64}$/.test(recovery.reviewHash ?? "");
        if (jobs)
          terminalControl(
            jobs.unusedResult(
              "reconcile",
              Error("Check the same transaction again for its latest receipt."),
            ),
          );
        if (walletReturnedHash)
          journal.update(context, hash, { status: "needs-confirmation" });
        status(
          walletReturnedHash
            ? "The transaction is pending or onboarding is not yet confirmed. Check again later." +
              (savedSubmission ? ` Original nonce ${recovery.nonce} and its review seal are saved for replacement checks.` : "")
            : "This candidate has no verified terminal receipt yet. Check your wallet transaction ID and try again; no new transaction will be sent.",
        );
        return pendingReceipt(result, draftId, context, walletReturnedHash);
      }
      if (isReplacement && jobs)
        jobs.clearTerminal(jobs.unusedResult("reconcile", Error("The verified replacement receipt check completed.")));
      journal.record(context, {
        hash,
        draftId: marker.draftId,
        action: "createEvent",
      });
      journal.update(context, hash, {
        status: result.status,
        blockNumber: result.blockNumber,
        ...(isReplacement ? { canonicalHash: result.canonicalHash, replacement: result.replacement } : {}),
        error: null,
      });
      persist({ ...marker, hash, phase: result.status,
        ...(isReplacement ? { canonicalHash: result.canonicalHash, replacement: result.replacement } : {}) });
      terminalAdopted = true;
      if (result.status === "confirmed") renderShare(result);
      else {
        renderRecovery();
        showProgress("reverted", { hash });
      }
      return { terminal: true };
    } catch (cause) {
      if (!current() || !receiptReadCurrent()) return null;
      terminalControl(cause);
      error(jobMessage(cause));
      offerTransactionInspection(cause);
      showProgress("unavailable", {
        reasonCode: typeof cause.code === "string" ? cause.code : undefined,
      });
      return null;
    } finally {
      lock(false);
    }
  };
  const manualReceiptCheck = async () => {
    await receiptWatcher.pause();
    watchActivity(false);
    if (!current() || busy || !marker) return;
    if (marker.canonicalHash && replacementEnabled) {
      await checkReplacement();
      return;
    }
    if (terminalJob?.organizerJob?.operation === "reconcile") {
      try {
        const original = terminalJob.organizerJob.hash;
        const selected =
          marker.hash || host.querySelector('[name="txHash"]')?.value?.trim();
        if (original && !same(original, selected))
          throw Error(
            "Check the same original transaction ID before starting a new receipt check.",
          );
        // An ambiguous/lost response resumes GET for its existing identity.
        // Only a completed or explicitly terminal check may become a fresh read.
        if (
          ["ready", "failed", "expired"].includes(
            terminalJob.organizerJob.state,
          )
        )
          jobs.clearTerminal(terminalJob);
        terminalJob = null;
      } catch (cause) {
        error(cause.message);
        return;
      }
    }
    const outcome = await reconcile();
    if (outcome?.knownHash) startReceiptWatch(outcome);
  };
  const checkReplacement = async () => {
    await receiptWatcher.pause();
    watchActivity(false);
    if (!current() || busy || !marker?.hash || marker.phase === "failed" || !replacementEnabled || scope?.abiVersion !== "kleros-event-v10-uups") return;
    const originalHash = marker.hash, draftId = marker.draftId;
    const context = { ...scope, eventId: marker.eventId };
    const candidate = host.querySelector('[name="replacementHash"]')?.value?.trim();
    let unchanged = current;
    try {
      if (!hashPattern.test(candidate ?? "") || same(candidate, originalHash))
        throw Error("Enter the complete, different transaction ID returned by the wallet's Speed Up request.");
      if (marker.canonicalHash && !same(marker.canonicalHash, candidate))
        throw Error("Check the recorded canonical replacement transaction. Its evidence cannot be changed.");
      if (terminalJob?.organizerJob?.operation === "replacement") {
        const saved = terminalJob.organizerJob;
        if (["ready", "failed", "expired"].includes(saved.state)) jobs.clearTerminal(terminalJob);
        else if (saved.hash && !same(saved.hash, candidate))
          throw Error("Check the same saved replacement request before choosing another transaction ID.");
        terminalJob = null;
      }
      terminalAdopted = false;
      persist({ ...marker, replacementCandidate: candidate.toLowerCase() });
      renderRecovery();
      host.querySelector("[data-luma-replacement]").open = true;
      lock(true);
      unchanged = () => current() && marker?.draftId === draftId && marker?.eventId === context.eventId &&
        same(marker?.hash, originalHash) && scope?.instanceId === context.instanceId && same(scope?.wallet, context.wallet) &&
        same(scope?.contract, context.contract) && scope?.abiVersion === context.abiVersion &&
        same(host.querySelector('[name="replacementHash"]')?.value?.trim(), candidate);
      journal.probe();
      status("Checking the replacement receipt and verified event…");
      showProgress("confirmations", { hash: candidate });
      let result;
      try {
        result = assertCreationReplacement(
          await runOperation("replacement", { draftId, hash: candidate }, unchanged),
          context, originalHash, candidate, host.ownerDocument.location.origin,
        );
      } catch (cause) { throw jobs ? jobs.unusedResult("replacement", cause) : cause; }
      if (!unchanged()) return;
      // Retire only this completed app-only read. Its backend identity and both
      // financial transaction records remain immutable, and a reload rechecks.
      if (jobs) jobs.clearTerminal(jobs.unusedResult("replacement", Error("The verified replacement check completed.")));
      journal.record(context, { hash: originalHash, draftId, action: "createEvent" });
      journal.update(context, originalHash, { status: "confirmed", blockNumber: result.blockNumber,
        canonicalHash: result.canonicalHash, replacement: result.replacement, error: null });
      persist({ ...marker, hash: originalHash, phase: "confirmed", canonicalHash: result.canonicalHash, replacement: result.replacement });
      terminalJob = null;
      renderShare(result);
    } catch (cause) {
      if (!current() || !unchanged()) return;
      terminalControl(cause);
      error(jobMessage(cause));
      showProgress("unavailable", { hash: hashPattern.test(candidate ?? "") ? candidate : originalHash,
        reasonCode: typeof cause.code === "string" ? cause.code : undefined });
    } finally { lock(false); }
  };
  const onDateInput = (event) => {
    const input = event.target;
    if (input.matches?.('[name="timezone"]')) syncTimezoneChoice(input.closest("[data-luma-form]"));
    if (current() && input.matches?.('[name="txHash"], [name="replacementHash"]')) {
      void receiptWatcher.pause();
      watchActivity(false);
      jobs?.stop();
      hideProgress();
    }
    const changedForm = input.closest?.("[data-luma-form]");
    if (
      current() &&
      changedForm &&
      host.contains(changedForm) &&
      JOB_FIELDS.includes(input.name)
    ) {
      formRevision++;
      reviewed = null;
      reviewedForm = null;
      void receiptWatcher.pause();
      watchActivity(false);
      jobs?.stop();
      stopBootstrapWait?.();
      closeDialog();
      hideProgress();
    }
    if (!current() || !input.matches?.('[name="endsAt"]')) return;
    const form = input.closest("[data-luma-form]");
    if (form && host.contains(form)) dateState(form).endEdited = true;
  };
  const onDateChange = (event) => {
    let input = event.target;
    if (!current()) return;
    if (input.matches?.('[name="timezoneChoice"]')) {
      const selected = input.value, form = input.closest("[data-luma-form]"), zone = form?.elements.namedItem("timezone");
      if (!zone || !host.contains(form)) return;
      if (selected === "custom") { zone.focus(); zone.select(); return; }
      if (!TIMEZONE_PRESETS.some(([value]) => value === selected)) return;
      zone.value = selected;
      input = zone;
    }
    if (input.matches?.('[name="endsAt"]')) {
      onDateInput(event);
      return;
    }
    if (input.matches?.('[name="timezone"]')) onDateInput({ target: input });
    if (busy || !input.matches?.('[name="startsAt"], [name="timezone"]')) return;
    const form = input.closest("[data-luma-form]");
    if (!form || !host.contains(form)) return;
    const startValue = form.elements.namedItem("startsAt").value;
    if (!startValue) return;
    let start, eventTimezone;
    try {
      eventTimezone = validateEventTimeZone(form.elements.namedItem("timezone").value);
      start = new Date(eventTimeToUtc(startValue, eventTimezone));
    } catch (cause) { error(cause.message); return; }
    if (start.valueOf() <= Date.now()) return;
    const end = form.elements.namedItem("endsAt"),
      state = dateState(form);
    end.min = startValue;
    if (state.endEdited || (end.value && end.value !== state.suggested)) return;
    const suggested = new Date(start.valueOf() + 2 * 60 * 60 * 1000);
    let value;
    try {
      value = eventTimeFromUtc(suggested, eventTimezone);
      if (eventTimeToUtc(value, eventTimezone) !== suggested.toISOString()) return;
    } catch (cause) { error(cause.message); return; }
    end.value = value;
    state.suggested = value;
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
    if (!action || !current()) return;
    if (action === "stop-waiting" && preparing) {
      stopBootstrapWait?.();
      jobs?.stop();
      return;
    }
    if (action === "pause-receipts") {
      await receiptWatcher.pause();
      watchActivity(false);
      return;
    }
    if (action === "reconcile") {
      await manualReceiptCheck();
      return;
    }
    if (action === "check-replacement") {
      await checkReplacement();
      return;
    }
    if (busy) return;
    if (
      action === "reset-review" &&
      terminalJob &&
      (!marker || marker.phase === "prepared")
    ) {
      try {
        jobs.clearTerminal(terminalJob, { unsigned: true });
        clearUnsigned();
        terminalJob = null;
        reviewed = null;
        reviewedForm = null;
        closeDialog();
        host.querySelector('[data-luma-action="reset-review"]')?.remove();
        error("");
        status(
          "The form is preserved. Choose Review event setup to prepare a new unsigned review.",
        );
        lock(false);
        hideProgress();
      } catch (cause) {
        error(cause.message);
      }
      return;
    }
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
    if (
      action === "new" &&
      marker
    ) {
      try {
        if (!recordedConfirmed() && !(terminalAdopted && marker.phase === "failed")) return;
        const completed = { status: marker.phase, hash: marker.hash, draftId: marker.draftId,
          eventId: marker.eventId, context: { ...scope, eventId: marker.eventId } };
        await receiptWatcher.pause();
        if (!current() || marker?.draftId !== completed.draftId || marker?.hash !== completed.hash) return;
        if (completed.status === "confirmed" && !recordedConfirmed()) return;
        watchActivity(false);
        options.onNew?.(completed);
        if (!current()) return;
        storage.removeItem(key);
        marker = null;
        terminalAdopted = false;
        replacementPreset = null;
        reviewed = null;
        reviewedForm = null;
        terminalJob = null;
        discoverRecovery();
        renderForm();
        hideProgress();
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
  host.addEventListener("input", onDateInput);
  host.addEventListener("change", onDateChange);
  renderForm();
  return {
    dispose() {
      alive = false;
      stopBootstrapWait?.();
      void receiptWatcher.dispose();
      progress.dispose();
      jobs?.dispose();
      closeDialog();
      host.removeEventListener("submit", onSubmit);
      host.removeEventListener("click", onClick);
      host.removeEventListener("input", onDateInput);
      host.removeEventListener("change", onDateChange);
      host.replaceChildren();
    },
  };
}
