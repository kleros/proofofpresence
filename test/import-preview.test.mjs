import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createWorkbench } from "../src/workbench.mjs";
import { createImportPreviewService } from "../src/import-preview.mjs";
import { hash } from "../src/utils.mjs";

let w, ownerA, ownerB, alice, bob;
const review = {
  confirmed: true,
  note: "Reviewed the synthetic source export against this event's linked identities.",
};

before(async () => {
  w = await createWorkbench({ rpcPort: 0 });
  ownerA = w.session("organizer-a");
  ownerB = w.session("organizer-b");
  alice = w.session("alice");
  bob = w.session("bob");
});
after(async () => {
  await w?.close();
});

async function fixture(slug, options = {}) {
  const now = (await w.bootstrap()).now;
  const event = await w.createEvent(ownerA, {
    title: `Synthetic import ${slug}`,
    slug: `import-${slug}`,
    description: "Local import-preview fixture",
    location: "Local synthetic venue",
    timezone: "Asia/Bangkok",
    depositEth: "0.01",
    startsAt: new Date((now + 3600) * 1000).toISOString(),
    endsAt: new Date((now + 7200) * 1000).toISOString(),
    ...options,
  });
  const eventId = event.id;
  const a = await w.registerParticipant(eventId, alice, {
    name: "Synthetic Alice",
    email: "alice@example.invalid",
  });
  const b = await w.registerParticipant(eventId, bob, {
    name: "Synthetic Bob",
    email: "bob@example.invalid",
  });
  return { eventId, a, b, event, record: w.record(eventId, ownerA) };
}
function guestCsv(
  f,
  {
    participant = f.a,
    admission = "approved",
    txHash = "",
    stamped = true,
  } = {},
) {
  return `${stamped ? "event_id,chain_id,contract," : ""}participant_id,email,wallet,tx_hash,admission\n${stamped ? `${f.eventId},1337,${f.record.deployment.contract},` : ""}${participant.id},${participant.email},${participant.wallet},${txHash},${admission}\n`;
}
function domain(f) {
  return structuredClone({
    participants: [...f.record.participants.values()],
    observations: f.record.observations,
    batches: f.record.batches,
    revision: f.record.revision,
  });
}
async function deposit(f) {
  const draft = await w.createDraft(f.eventId, alice, {
    action: "deposit",
    params: {},
  });
  const tx = await w.executeDraft(f.eventId, alice, draft.id);
  return tx.hash;
}
const codeIs = (code) => (error) => error.code === code;

test("guest and attendance previews expose proposed rows and received CSV text provenance without applying anything", async () => {
  const service = createImportPreviewService(w),
    f = await fixture("read-only");
  const input = {
    kind: "guests",
    csv: `\ufeff${guestCsv(f, { stamped: false })}\n`,
  };
  const before = domain(f),
    stateBefore = await w.state(f.eventId);
  const preview = await service.preview(f.eventId, ownerA, input);
  assert.deepEqual(domain(f), before);
  assert.equal((await w.state(f.eventId)).fingerprint, stateBefore.fingerprint);
  assert.equal(preview.originReviewRequired, true);
  assert.equal(
    preview.sourceHash,
    hash(input.csv),
    "received CSV text, including BOM/newline, determines source identity",
  );
  assert.notEqual(preview.sourceHash, hash(input.csv.trim()));
  assert.equal(preview.parserVersion, "csv-v2");
  assert.equal(preview.rowCount, 1);
  assert.equal(preview.proposedRows[0].currentAdmission, "pending");
  assert.equal(preview.proposedRows[0].proposedAdmission, "approved");
  assert.equal(preview.proposedRows[0].registered, false);
  assert.equal(preview.proposedRows[0].deposit, null);
  assert.match(preview.limitation, /neither a CSV label nor a hash/);
  assert.ok(preview.expiresAt - preview.createdAt <= 300_000);
  assert.match(preview.id, /^[a-f0-9-]{36}$/i);

  await w.advance(3601);
  const at = new Date((await w.state(f.eventId)).now * 1000).toISOString();
  const attendance = `participant_id,email,wallet,checked_in_at\n${f.a.id},${f.a.email},${f.a.wallet},${at}\n`;
  const beforeAttendance = domain(f);
  const proposedAttendance = await service.preview(f.eventId, ownerA, {
    kind: "attendance",
    csv: attendance,
  });
  assert.equal(proposedAttendance.proposedRows[0].checkedInAt, at);
  assert.equal(proposedAttendance.proposedRows[0].alreadyObserved, false);
  assert.deepEqual(
    domain(f),
    beforeAttendance,
    "preview cannot create trusted financial attendance",
  );
});

test("missing review is retryable, commit is explicit and a successful opaque ID is single-use", async () => {
  const f = await fixture("explicit-commit"),
    service = createImportPreviewService(w);
  const csv = guestCsv(f),
    preview = await service.preview(f.eventId, ownerA, { kind: "guests", csv });
  const before = domain(f);
  await assert.rejects(
    () => service.commit(f.eventId, ownerA, preview.id, undefined),
    codeIs("PROVENANCE_REVIEW_REQUIRED"),
  );
  await assert.rejects(
    () =>
      service.commit(f.eventId, ownerA, preview.id, {
        confirmed: true,
        note: "short",
      }),
    codeIs("PROVENANCE_REVIEW_REQUIRED"),
  );
  assert.deepEqual(domain(f), before);
  const result = await service.commit(f.eventId, ownerA, preview.id, review);
  assert.equal(result.previewId, preview.id);
  assert.equal(result.batch.sourceHash, preview.sourceHash);
  assert.equal(result.batch.configHash, preview.configHash);
  assert.equal(result.batch.reviewer, ownerA.wallet);
  assert.equal(result.batch.reviewNote, review.note);
  assert.equal(f.a.admission, "approved");
  assert.equal(f.record.batches.length, 1);
  assert.equal(f.record.observations.length, 0);
  assert.equal(
    (await w.state(f.eventId)).stakerCount,
    0,
    "admission import does not register a staker",
  );
  await assert.rejects(
    () => service.commit(f.eventId, ownerA, preview.id, review),
    codeIs("IMPORT_PREVIEW_USED"),
  );
  await assert.rejects(
    () => w.importCsv(f.eventId, ownerA, { kind: "guests", csv, review }),
    codeIs("DUPLICATE_IMPORT"),
  );
});

test("caller input and returned proposal edits cannot rewrite the server-owned import", async () => {
  const f = await fixture("owned-input"),
    service = createImportPreviewService(w);
  const input = { kind: "guests", csv: guestCsv(f), sourceEventId: f.eventId };
  const preview = await service.preview(f.eventId, ownerA, input),
    previewId = preview.id;
  input.csv = guestCsv(f, { admission: "declined" });
  input.kind = "attendance";
  input.sourceEventId = "event-b";
  preview.proposedRows[0].proposedAdmission = "declined";
  preview.proposedRows[0].wallet = bob.wallet;
  preview.sourceHash = "tampered";
  preview.eventId = "event-b";
  preview.contract = "0x0000000000000000000000000000000000000001";
  const result = await service.commit(f.eventId, ownerA, previewId, review);
  assert.equal(f.a.admission, "approved");
  assert.equal(f.b.admission, "pending");
  assert.equal(result.batch.eventId, f.eventId);
  assert.equal(result.batch.sourceHash, hash(guestCsv(f)));
});

test("event, wallet and same-wallet new-session mismatches fail without consuming the legitimate preview", async () => {
  const f = await fixture("scope-a"),
    other = await fixture("scope-b"),
    service = createImportPreviewService(w);
  const preview = await service.preview(f.eventId, ownerA, {
    kind: "guests",
    csv: guestCsv(f),
  });
  const before = domain(f);
  await assert.rejects(
    () => service.commit(other.eventId, ownerA, preview.id, review),
    codeIs("IMPORT_PREVIEW_SCOPE"),
  );
  await assert.rejects(
    () => service.commit(f.eventId, ownerB, preview.id, review),
    codeIs("IMPORT_PREVIEW_SCOPE"),
  );
  await assert.rejects(
    () =>
      service.commit(
        f.eventId,
        { ...ownerA, id: "a-new-authenticated-session" },
        preview.id,
        review,
      ),
    codeIs("IMPORT_PREVIEW_SCOPE"),
  );
  await assert.rejects(
    () => service.preview(f.eventId, bob, { kind: "guests", csv: guestCsv(f) }),
    codeIs("NOT_OWNER"),
  );
  assert.deepEqual(domain(f), before);
  await service.commit(f.eventId, ownerA, preview.id, review);
  assert.equal(f.record.batches.length, 1);
  assert.equal(other.record.batches.length, 0);
});

test("a review cannot override known source conflicts or duplicate financial evidence", async () => {
  const f = await fixture("hard-conflicts"),
    other = await fixture("hard-conflicts-other"),
    service = createImportPreviewService(w);
  const txHash = await deposit(f),
    csv = guestCsv(f, { txHash }),
    before = domain(f);
  const attempts = [
    [csv.replace(f.eventId, other.eventId), "EVENT_MISMATCH"],
    [csv.replace(",1337,", ",1,"), "CHAIN_MISMATCH"],
    [
      csv.replace(
        f.record.deployment.contract,
        other.record.deployment.contract,
      ),
      "CONTRACT_MISMATCH",
    ],
    [csv.replace(f.a.id, other.a.id), "IDENTITY_MISMATCH"],
    [csv + csv.split("\n")[1] + "\n", "DUPLICATE_IDENTITY"],
  ];
  const duplicateFinance =
    csv + guestCsv(f, { participant: f.b, txHash }).split("\n")[1] + "\n";
  attempts.push([duplicateFinance, "DUPLICATE_EVIDENCE"]);
  for (const [badCsv, code] of attempts)
    await assert.rejects(
      () =>
        service.preview(f.eventId, ownerA, {
          kind: "guests",
          csv: badCsv,
          review,
        }),
      codeIs(code),
    );
  assert.deepEqual(domain(f), before);
});

test("revision, event deployment and financial state changes invalidate an original preview", async () => {
  const f = await fixture("stale"),
    service = createImportPreviewService(w);
  const input = { kind: "guests", csv: guestCsv(f) };
  const first = await service.preview(f.eventId, ownerA, input);
  await w.admit(f.eventId, ownerA, f.a.id, "declined");
  await assert.rejects(
    () => service.commit(f.eventId, ownerA, first.id, review),
    codeIs("STALE_IMPORT_PREVIEW"),
  );
  assert.equal(f.a.admission, "declined");
  assert.equal(f.record.batches.length, 0);

  const second = await service.preview(f.eventId, ownerA, input);
  const originalCommit = f.record.deployment.sourceCommit;
  f.record.deployment.sourceCommit = "changed-registry-source-without-revision";
  try {
    await assert.rejects(
      () => service.commit(f.eventId, ownerA, second.id, review),
      codeIs("STALE_IMPORT_PREVIEW"),
    );
  } finally {
    f.record.deployment.sourceCommit = originalCommit;
  }
  assert.equal(f.record.batches.length, 0);

  const third = await service.preview(f.eventId, ownerA, input);
  await (
    await ownerB.signer.sendTransaction({
      to: f.record.deployment.contract,
      value: 1n,
    })
  ).wait();
  await assert.rejects(
    () => service.commit(f.eventId, ownerA, third.id, review),
    codeIs("STALE_IMPORT_PREVIEW"),
  );
  assert.equal(f.record.batches.length, 0);
});

test("an unrelated event transaction does not invalidate this event's unchanged review", async () => {
  const f = await fixture("independent-a"),
    other = await fixture("independent-b"),
    service = createImportPreviewService(w);
  const preview = await service.preview(f.eventId, ownerA, {
    kind: "guests",
    csv: guestCsv(f),
  });
  await (
    await ownerB.signer.sendTransaction({
      to: other.record.deployment.contract,
      value: 1n,
    })
  ).wait();
  await service.commit(f.eventId, ownerA, preview.id, review);
  assert.equal(f.record.batches.length, 1);
  assert.equal(other.record.batches.length, 0);
});

test("expiry is enforced at the exact boundary and again after receipt RPC validation", async () => {
  const f = await fixture("expiry"),
    txHash = await deposit(f);
  let time = 1000;
  const service = createImportPreviewService(w, { now: () => time });
  const input = { kind: "guests", csv: guestCsv(f, { txHash }) };
  const first = await service.preview(f.eventId, ownerA, input),
    before = domain(f);
  time = first.expiresAt;
  await assert.rejects(
    () => service.commit(f.eventId, ownerA, first.id, review),
    codeIs("IMPORT_PREVIEW_EXPIRED"),
  );
  assert.deepEqual(domain(f), before);
  const second = await service.preview(f.eventId, ownerA, input);
  const original = w.verifyReceipt;
  w.verifyReceipt = async (...args) => {
    const result = await original(...args);
    time = second.expiresAt;
    return result;
  };
  try {
    await assert.rejects(
      () => service.commit(f.eventId, ownerA, second.id, review),
      codeIs("IMPORT_PREVIEW_EXPIRED"),
    );
  } finally {
    w.verifyReceipt = original;
  }
  assert.deepEqual(
    domain(f),
    before,
    "expiry during final validation cannot leave a partial import",
  );
});

test("same-ID and same-source concurrent commits create exactly one complete batch", async () => {
  const f = await fixture("concurrent"),
    service = createImportPreviewService(w),
    input = { kind: "guests", csv: guestCsv(f) };
  const a = await service.preview(f.eventId, ownerA, input),
    b = await service.preview(f.eventId, ownerA, input);
  const revision = f.record.revision;
  const results = await Promise.allSettled([
    service.commit(f.eventId, ownerA, a.id, review),
    service.commit(f.eventId, ownerA, a.id, review),
    service.commit(f.eventId, ownerA, b.id, review),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(f.record.batches.length, 1);
  assert.equal(f.record.revision, revision + 1);
  assert.equal(f.a.admission, "approved");
  assert.equal(f.b.admission, "pending");
});

test("a concurrent admission change during receipt validation preserves the new decision and blocks import mutation", async () => {
  const f = await fixture("receipt-race"),
    txHash = await deposit(f),
    service = createImportPreviewService(w);
  const preview = await service.preview(f.eventId, ownerA, {
    kind: "guests",
    csv: guestCsv(f, { txHash }),
  });
  const original = w.verifyReceipt;
  w.verifyReceipt = async (...args) => {
    const result = await original(...args);
    await w.admit(f.eventId, ownerA, f.a.id, "declined");
    return result;
  };
  try {
    await assert.rejects(
      () => service.commit(f.eventId, ownerA, preview.id, review),
      codeIs("STALE_IMPORT"),
    );
  } finally {
    w.verifyReceipt = original;
  }
  assert.equal(f.a.admission, "declined");
  assert.equal(f.record.batches.length, 0);
  assert.equal(f.record.observations.length, 0);
});

test("the compatibility import route remains explicit and invalidates a prior preview", async () => {
  const f = await fixture("legacy-direct"),
    service = createImportPreviewService(w),
    csv = guestCsv(f);
  const preview = await service.preview(f.eventId, ownerA, {
    kind: "guests",
    csv,
  });
  await assert.rejects(
    () => w.importCsv(f.eventId, ownerA, { kind: "guests", csv }),
    codeIs("PROVENANCE_REVIEW_REQUIRED"),
  );
  await w.importCsv(f.eventId, ownerA, { kind: "guests", csv, review });
  await assert.rejects(
    () => service.commit(f.eventId, ownerA, preview.id, review),
    codeIs("STALE_IMPORT_PREVIEW"),
  );
  assert.equal(f.record.batches.length, 1);
  const old = await fixture("legacy-hash");
  const legacyCsv = guestCsv(old);
  old.record.batches.push({
    kind: "guests",
    parserVersion: "csv-v1",
    sourceHash: hash(legacyCsv.trim()),
  });
  await assert.rejects(
    () =>
      service.preview(old.eventId, ownerA, { kind: "guests", csv: legacyCsv }),
    codeIs("DUPLICATE_IMPORT"),
  );
});

test("commit reauthorizes the current financial owner, including a private ownership transition", async () => {
  const f = await fixture("new-owner"),
    service = createImportPreviewService(w);
  // Establish linked participants while public, then model the owner's privacy change.
  f.record.definition.visibility = "private";
  f.record.revision++;
  const input = { kind: "guests", csv: guestCsv(f) };
  const old = await service.preview(f.eventId, ownerA, input);
  const transfer = await w.createDraft(f.eventId, ownerA, {
    action: "transferOwnership",
    params: { to: ownerB.wallet },
  });
  await w.executeDraft(f.eventId, ownerA, transfer.id);
  const accept = await w.createDraft(f.eventId, ownerB, {
    action: "acceptOwnership",
    params: {},
  });
  await w.executeDraft(f.eventId, ownerB, accept.id);
  await assert.rejects(
    () => service.commit(f.eventId, ownerA, old.id, review),
    codeIs("NOT_OWNER"),
  );
  assert.equal(f.record.batches.length, 0);
  const current = await service.preview(f.eventId, ownerB, input);
  await service.commit(f.eventId, ownerB, current.id, review);
  assert.equal(f.record.batches[0].reviewer, ownerB.wallet);
});
