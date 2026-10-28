// @ts-check
import { importCsv, validateImportCsv, provenanceReview } from "./imports.mjs";
import { hash, id, lower, requireThat, text } from "./utils.mjs";

const FIVE_MINUTES = 300_000;

/**
 * A server-owned, owner-only review boundary. CSV and authority bindings are private;
 * responses are detached copies and cannot become a caller-supplied commit plan.
 */
export function createImportPreviewService(
  workbench,
  { ttlMs = FIVE_MINUTES, now = () => Date.now() } = {},
) {
  requireThat(
    Number.isInteger(ttlMs) && ttlMs > 0 && ttlMs <= FIVE_MINUTES,
    "Preview lifetime must be at most five minutes",
  );
  const previews = new Map();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const principal = (session) => ({ ...session });
  const sessionBinding = (session) =>
    hash({
      id: session?.id,
      wallet: lower(session?.wallet),
      mode: session?.mode,
    });
  function prune() {
    for (const [key, entry] of previews)
      if (entry.expiresAt <= now() && !entry.committing) previews.delete(key);
  }
  function immutableInput(input) {
    text(input?.csv, 512_000, 1);
    requireThat(typeof input?.kind === "string", "Unknown import kind");
    if (input.sourceEventId !== undefined) text(input.sourceEventId, 100);
    return Object.freeze({
      kind: input.kind,
      csv: input.csv,
      ...(input.sourceEventId !== undefined
        ? { sourceEventId: input.sourceEventId }
        : {}),
    });
  }

  async function preview(eventId, session, input) {
    const actor = principal(session);
    const ownedInput = immutableInput(input);
    const validated = await validateImportCsv(
      workbench,
      eventId,
      actor,
      ownedInput,
      { requireReview: false },
    );
    requireThat(
      actor.id && typeof actor.id === "string",
      "An authenticated session ID is required",
      "UNAUTHENTICATED",
      401,
    );
    prune();
    const previewId = id(),
      createdAt = now(),
      expiresAt = createdAt + ttlMs;
    const binding = {
      eventId,
      chainId: validated.record.deployment.chainId,
      contract: validated.record.deployment.contract,
      configHash: validated.configHash,
      revision: validated.startingRevision,
      snapshot: validated.snapshot.fingerprint,
      sourceHash: validated.sourceHash,
    };
    previews.set(previewId, {
      input: ownedInput,
      binding,
      sessionBinding: sessionBinding(actor),
      expiresAt,
      committing: false,
      used: false,
    });
    return copy({
      id: previewId,
      previewId,
      ...binding,
      kind: ownedInput.kind,
      wallet: actor.wallet,
      createdAt,
      expiresAt,
      snapshotBlock: validated.snapshot.blockNumber,
      snapshotTime: validated.snapshot.now,
      parserVersion: validated.parserVersion,
      originReviewRequired: true,
      proposedRows: validated.proposedRows,
      rowCount: validated.proposedRows.length,
      errors: [],
      warnings: [
        "CSV event metadata can detect conflicts, but it does not authenticate source origin.",
      ],
      limitation: validated.limitation,
    });
  }

  async function commit(eventId, session, previewId, review) {
    const actor = principal(session),
      entry = previews.get(previewId);
    requireThat(
      entry,
      "Import preview was not found; prepare a fresh preview",
      "IMPORT_PREVIEW_NOT_FOUND",
      404,
    );
    requireThat(
      entry.binding.eventId === eventId &&
        entry.sessionBinding === sessionBinding(actor),
      "Import preview belongs to a different event, wallet or session",
      "IMPORT_PREVIEW_SCOPE",
      409,
    );
    requireThat(
      !entry.used,
      "Import preview was already committed",
      "IMPORT_PREVIEW_USED",
      409,
    );
    requireThat(
      entry.expiresAt > now(),
      "Import preview expired; prepare a fresh preview",
      "IMPORT_PREVIEW_EXPIRED",
      409,
    );
    requireThat(
      !entry.committing,
      "This import preview is already being committed",
      "IMPORT_PREVIEW_BUSY",
      409,
    );
    const reviewNote = provenanceReview(review);
    const ownedReview = { confirmed: true, note: reviewNote };
    entry.committing = true;
    try {
      // The common path reauthorizes the current owner, verifies receipts and every
      // hard metadata/identity conflict, and checks this exact original binding
      // before its final synchronous mutation. Review can never bypass a failure.
      const result = await importCsv(
        workbench,
        eventId,
        actor,
        { ...entry.input, review: ownedReview },
        {
          expected: entry.binding,
          beforeCommit: () =>
            requireThat(
              entry.expiresAt > now(),
              "Import preview expired during validation; prepare a fresh preview",
              "IMPORT_PREVIEW_EXPIRED",
              409,
            ),
        },
      );
      entry.used = true;
      // A consumed opaque ID needs no longer retain potentially private CSV bytes.
      entry.input = null;
      return { ...result, previewId };
    } finally {
      entry.committing = false;
    }
  }

  return { preview, commit };
}
