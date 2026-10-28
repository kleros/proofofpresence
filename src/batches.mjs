import { ethers } from "ethers";
import { hash, id, lower, requireThat, text } from "./utils.mjs";

const ACTIONS = new Set(["approve-admission", "check-in"]);
const TTL = 300_000;
const scopeOf = (record) => hash(record.deployment);
const selectedState = (record, items) =>
  hash(
    items.map(({ participantId, wallet }) => {
      const person = record.participants.get(participantId);
      return {
        participantId,
        wallet,
        person: person ?? null,
        observations: record.observations.filter(
          (row) => row.participantId === participantId,
        ),
      };
    }),
  );
const invalid = (condition, message, code = "INVALID_BATCH", status = 400) =>
  requireThat(condition, message, code, status);

export function participantBatchEligibility(
  record,
  person,
  state,
  action,
  { wallet = person?.wallet, depositVerification = "missing" } = {},
) {
  let reasonCode = null,
    reason = null;
  if (
    !person?.identityVerified ||
    person.eventId !== record.definition.id ||
    lower(person.wallet) !== lower(wallet)
  ) {
    reasonCode = "WALLET_LINK_REQUIRED";
    reason =
      "A wallet-linked registration for this event is required. A transfer does not create a guest identity.";
  } else if (action === "approve-admission") {
    if (state.phase !== "Open") {
      reasonCode = "ADMISSION_CLOSED";
      reason =
        "Admission is closed after attendance posting, finalization or cancellation.";
    } else if (person.admission === "approved") {
      reasonCode = "ALREADY_APPROVED";
      reason = "This participant is already approved.";
    } else if (!person.deposit) {
      reasonCode = "DEPOSIT_LINK_REQUIRED";
      reason = "Link and verify this wallet's canonical deposit receipt first.";
    } else if (depositVerification !== "current") {
      reasonCode =
        depositVerification === "returned"
          ? "RETURNED_DEPOSIT"
          : "DEPOSIT_UNAVAILABLE";
      reason =
        reasonCode === "RETURNED_DEPOSIT"
          ? "This deposit was recovered or returned."
          : "Current canonical deposit evidence could not be verified. Refresh before approval.";
    }
  } else if (
    !(
      Number.isFinite(state.now) &&
      state.now >= Date.parse(record.definition.startsAt) / 1000 &&
      state.now <= Date.parse(record.definition.endsAt) / 1000
    )
  ) {
    reasonCode = "ATTENDANCE_TIME_MISMATCH";
    reason =
      "Trusted check-in is available only during this event's actual hours.";
  } else if (
    record.observations.some((row) => row.participantId === person.id)
  ) {
    reasonCode = "DUPLICATE_CHECKIN";
    reason = "This participant already has a trusted check-in.";
  }
  return {
    eligible: !reasonCode,
    reasonCode,
    reason:
      reason ??
      (action === "approve-admission"
        ? "Approve the app admission record only; contract registration remains separate."
        : "Record a staff-door observation only; monetary attendance remains separate."),
  };
}

// Only reviewed off-chain curation/door observations live here. No operation can
// register a staker, post monetary attendance, sign or submit a transaction.
/**
 * @param {any} workbench
 * @param {{authorizeStaff?:(eventId:string,session:any)=>Promise<any>,now?:()=>number}} [options]
 */
export function createBatchService(
  workbench,
  { authorizeStaff, now = Date.now } = {},
) {
  invalid(
    typeof authorizeStaff === "function",
    "Staff authorization is required",
  );
  const previews = new Map();
  const committing = new Map();
  async function authorize(eventId, session, action) {
    invalid(
      ACTIONS.has(action),
      "Choose admission approval or trusted check-in",
    );
    return action === "approve-admission"
      ? workbench.owner(eventId, session)
      : authorizeStaff(eventId, session);
  }
  function normalized(input) {
    invalid(
      input && typeof input === "object" && !Array.isArray(input),
      "Batch input required",
    );
    invalid(
      Object.keys(input).every((key) =>
        ["action", "items", "nonce", "note"].includes(key),
      ),
      "Unknown batch field",
    );
    invalid(ACTIONS.has(input.action), "Unsupported batch action");
    invalid(
      Array.isArray(input.items) &&
        input.items.length > 0 &&
        input.items.length <= 150,
      "Select 1–150 wallets",
    );
    const nonce = text(input.nonce, 64, 8);
    const items = input.items.map((item) => {
      invalid(
        item &&
          Object.keys(item).every((key) =>
            ["participantId", "wallet"].includes(key),
          ) &&
          ethers.isAddress(item.wallet),
        "Each selected row requires its exact wallet and participant ID",
      );
      invalid(
        item.participantId === null ||
          (typeof item.participantId === "string" &&
            item.participantId.length > 0 &&
            item.participantId.length <= 100),
        "Invalid selected participant ID",
      );
      return {
        participantId: item.participantId,
        wallet: ethers.getAddress(item.wallet),
      };
    });
    invalid(
      new Set(items.map((item) => lower(item.wallet))).size === items.length &&
        new Set(
          items
            .filter((item) => item.participantId)
            .map((item) => item.participantId),
        ).size === items.filter((item) => item.participantId).length,
      "Duplicate selected wallet or participant",
    );
    return {
      action: input.action,
      items,
      nonce,
      note: text(input.note ?? "", 500),
    };
  }
  async function assess(eventId, session, input) {
    const record = await authorize(eventId, session, input.action);
    const revision = record.revision;
    const configHash = scopeOf(record);
    const selectedHash = selectedState(record, input.items);
    const state = await workbench.state(eventId);
    const rows = [];
    for (const item of input.items) {
      const person = record.participants.get(item.participantId);
      let verification = person?.deposit ? "current" : "missing";
      let eligibility = participantBatchEligibility(
        record,
        person,
        state,
        input.action,
        {
          wallet: item.wallet,
          depositVerification: verification,
        },
      );
      if (eligibility.eligible && input.action === "approve-admission") {
        try {
          await workbench.verifyReceipt(
            eventId,
            person,
            person.deposit.txHash,
            true,
          );
        } catch (error) {
          verification =
            error.code === "RETURNED_DEPOSIT" ? "returned" : "unavailable";
        }
        eligibility = participantBatchEligibility(
          record,
          person,
          state,
          input.action,
          {
            wallet: item.wallet,
            depositVerification: verification,
          },
        );
      }
      const linked =
        person?.identityVerified &&
        person.eventId === eventId &&
        lower(person.wallet) === lower(item.wallet);
      rows.push({
        ...item,
        name: linked ? person.name : null,
        email: linked ? person.email : null,
        ...eligibility,
      });
    }
    // Receipt work may be slow. Recheck authority before returning any contacts.
    await authorize(eventId, session, input.action);
    // RPC awaits must not let another request silently change reviewed records.
    invalid(
      record.revision === revision &&
        scopeOf(record) === configHash &&
        selectedState(record, input.items) === selectedHash,
      "Event or selected records changed during review",
      "STALE_BATCH",
      409,
    );
    return { record, state, revision, configHash, selectedHash, rows };
  }
  async function preview(eventId, session, rawInput) {
    const input = normalized(rawInput);
    const assessed = await assess(eventId, session, input);
    for (const [key, value] of previews)
      if (value.expiresAt <= now() && committing.get(value.eventId) !== key)
        previews.delete(key);
    invalid(
      previews.size < 1_000,
      "Too many outstanding reviews; refresh later",
      "BATCH_LIMIT",
      429,
    );
    invalid(
      !assessed.record.batches.some(
        (batch) => batch.batchAction && batch.requestNonce === input.nonce,
      ),
      "This batch nonce was already committed",
      "REPLAY",
      409,
    );
    invalid(
      ![...previews.values()].some(
        (value) => value.eventId === eventId && value.nonce === input.nonce,
      ),
      "This batch nonce already has a review",
      "REPLAY",
      409,
    );
    const eligible = assessed.rows.filter((row) => row.eligible).length;
    const value = {
      id: id(),
      eventId,
      action: input.action,
      nonce: input.nonce,
      actorWallet: session.wallet,
      chainId: assessed.record.deployment.chainId,
      contract: assessed.record.deployment.contract,
      contractVersion: assessed.record.deployment.contractVersion,
      revision: assessed.revision,
      snapshot: assessed.state.fingerprint,
      blockNumber: assessed.state.blockNumber,
      expiresAt: now() + TTL,
      counts: {
        selected: input.items.length,
        eligible,
        blocked: input.items.length - eligible,
      },
      canCommit: eligible === input.items.length,
      tokenStatus: eligible === input.items.length ? "ready" : "blocked",
      rows: assessed.rows,
      requiresFinancialTransaction: false,
      consequences:
        input.action === "approve-admission"
          ? "Save exactly these curated app approvals. Luma approval is manual outside this app. No contract registration or money movement occurs."
          : "Save exactly these trusted staff-door observations. This does not register wallets or publish the financial attendance list.",
    };
    previews.set(value.id, {
      ...value,
      input,
      sessionId: session.id,
      configHash: assessed.configHash,
      selectedHash: assessed.selectedHash,
    });
    return structuredClone(value);
  }
  async function commit(eventId, session, previewId, input) {
    invalid(
      input?.confirmed === true &&
        Object.keys(input).every((key) => ["nonce", "confirmed"].includes(key)),
      "Explicitly confirm this exact reviewed batch",
    );
    const pending = previews.get(previewId);
    await workbench.state(eventId);
    const record = workbench.record(eventId, session);
    const completed = record.batches.find(
      (batch) => batch.id === previewId && batch.batchAction,
    );
    const action = pending?.action ?? completed?.batchAction;
    await authorize(eventId, session, action);
    if (completed) {
      invalid(
        lower(completed.actorWallet) === lower(session.wallet) &&
          completed.requestNonce === input.nonce,
        "Committed batch belongs to another wallet or nonce",
        "BATCH_SCOPE",
        409,
      );
      return { ...structuredClone(completed.result), replayed: true };
    }
    invalid(
      pending &&
        pending.eventId === eventId &&
        pending.sessionId === session.id &&
        lower(pending.actorWallet) === lower(session.wallet) &&
        pending.nonce === input.nonce,
      "Review belongs to another event, session, wallet or nonce",
      "BATCH_SCOPE",
      409,
    );
    invalid(
      !pending.retired && pending.expiresAt > now() && pending.canCommit,
      "Review expired or includes blocked rows",
      "STALE_BATCH",
      409,
    );
    invalid(
      !committing.has(eventId),
      "Another batch is being committed",
      "BATCH_IN_PROGRESS",
      409,
    );
    committing.set(eventId, previewId);
    try {
      const fresh = await assess(eventId, session, pending.input);
      invalid(
        fresh.rows.every((row) => row.eligible) &&
          fresh.revision === pending.revision &&
          fresh.configHash === pending.configHash &&
          fresh.selectedHash === pending.selectedHash &&
          fresh.state.fingerprint === pending.snapshot,
        "Authoritative event or selected records changed; review again",
        "STALE_BATCH",
        409,
      );
      await authorize(eventId, session, pending.action);
      const finalState = await workbench.state(eventId);
      invalid(
        record.revision === pending.revision &&
          scopeOf(record) === pending.configHash &&
          selectedState(record, pending.input.items) === pending.selectedHash &&
          finalState.fingerprint === pending.snapshot &&
          !pending.retired &&
          pending.expiresAt > now(),
        "State changed before the atomic save",
        "STALE_BATCH",
        409,
      );
      if (pending.action === "check-in")
        invalid(
          finalState.now >= Date.parse(record.definition.startsAt) / 1000 &&
            finalState.now <= Date.parse(record.definition.endsAt) / 1000,
          "Door check-in is outside event hours",
          "ATTENDANCE_TIME_MISMATCH",
          409,
        );
      const people = pending.input.items.map((item) =>
        record.participants.get(item.participantId),
      );
      const previous = {
        admissions: people.map((person) => person.admission),
        observations: record.observations.length,
        batches: record.batches.length,
        nonces: new Set(record.nonces),
        revision: record.revision,
      };
      const observationIds = [];
      const result = {
        id: previewId,
        eventId,
        action: pending.action,
        status: "committed",
        appliedCount: people.length,
        participantIds: people.map((person) => person.id),
        observationIds,
        committedAt: new Date(now()).toISOString(),
        chainId: record.deployment.chainId,
        contract: record.deployment.contract,
        contractVersion: record.deployment.contractVersion,
        actorWallet: session.wallet,
        requiresFinancialTransaction: false,
        nextAction:
          pending.action === "approve-admission"
            ? "review-staker-registration"
            : "review-post-attendance",
        replayed: false,
      };
      try {
        // No awaits between the final guards, complete mutation and atomic save.
        for (const person of people) {
          if (pending.action === "approve-admission")
            person.admission = "approved";
          else {
            const nonce = `batch:${hash({ request: pending.nonce, participantId: person.id })}`;
            invalid(
              !record.nonces.has(nonce),
              "Observation nonce already used",
              "REPLAY",
              409,
            );
            const observation = {
              id: id(),
              eventId,
              participantId: person.id,
              source: "staff-door",
              reviewer: session.wallet,
              timestamp: finalState.now,
              nonce,
              note: pending.input.note,
            };
            observationIds.push(observation.id);
            record.observations.push(observation);
            record.nonces.add(nonce);
          }
        }
        record.batches.push({
          id: previewId,
          eventId,
          kind:
            pending.action === "check-in"
              ? "attendance-batch"
              : "admission-batch",
          batchAction: pending.action,
          actorWallet: session.wallet,
          requestNonce: pending.nonce,
          rowCount: people.length,
          reviewedAt: result.committedAt,
          snapshotBlock: finalState.blockNumber,
          configHash: pending.configHash,
          result,
        });
        record.revision++;
        workbench.persist();
      } catch (error) {
        people.forEach((person, index) => {
          person.admission = previous.admissions[index];
        });
        record.observations.length = previous.observations;
        record.batches.length = previous.batches;
        record.nonces = previous.nonces;
        record.revision = previous.revision;
        throw error;
      }
      previews.delete(previewId);
      return structuredClone(result);
    } finally {
      committing.delete(eventId);
    }
  }
  async function status(eventId, session, previewId) {
    const state = await workbench.state(eventId);
    const record = workbench.record(eventId, session);
    let pending = previews.get(previewId);
    let completed = record.batches.find(
      (batch) => batch.id === previewId && batch.batchAction,
    );
    const action = pending?.action ?? completed?.batchAction;
    await authorize(eventId, session, action ?? "check-in");
    // A commit may finish during the authorization RPC. Never turn its receipt
    // into an expired/no-application response by retaining the earlier lookup.
    pending = previews.get(previewId);
    completed = record.batches.find(
      (batch) => batch.id === previewId && batch.batchAction,
    );
    if (completed && completed.batchAction !== action) {
      await authorize(eventId, session, completed.batchAction);
      completed = record.batches.find(
        (batch) => batch.id === previewId && batch.batchAction,
      );
    }
    if (completed) {
      invalid(
        lower(completed.actorWallet) === lower(session.wallet),
        "Batch belongs to another wallet",
        "BATCH_SCOPE",
        409,
      );
      return { ...structuredClone(completed.result), replayed: true };
    }
    if (pending)
      invalid(
        pending.eventId === eventId &&
          lower(pending.actorWallet) === lower(session.wallet),
        "Batch belongs to another event or wallet",
        "BATCH_SCOPE",
        409,
      );
    const active = committing.get(eventId) === previewId;
    const stale =
      pending &&
      (pending.retired ||
        pending.expiresAt <= now() ||
        pending.revision !== record.revision ||
        pending.configHash !== scopeOf(record) ||
        pending.selectedHash !== selectedState(record, pending.input.items) ||
        pending.snapshot !== state.fingerprint ||
        (pending.action === "check-in" &&
          !(
            state.now >= Date.parse(record.definition.startsAt) / 1000 &&
            state.now <= Date.parse(record.definition.endsAt) / 1000
          )));
    // A known expired/stale token must become permanently uncommittable before
    // the client can release its uncertainty lock. A later state round trip
    // must not make an old delayed POST valid again.
    if (pending && stale && !active) {
      pending.retired = true;
      pending.expiresAt = Math.min(pending.expiresAt, now());
    }
    return {
      id: previewId,
      eventId,
      action: action ?? null,
      actorWallet: session.wallet,
      chainId: record.deployment.chainId,
      contract: record.deployment.contract,
      contractVersion: record.deployment.contractVersion,
      status: active
        ? "committing"
        : !pending
          ? "unknown"
          : stale
            ? "expired"
            : pending.canCommit
              ? "ready"
              : "blocked",
      requiresFinancialTransaction: false,
    };
  }
  return { preview, commit, status };
}
