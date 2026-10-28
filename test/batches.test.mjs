import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { createBatchService } from "../src/batches.mjs";
import { startServer } from "../src/server.mjs";
import { requireThat } from "../src/utils.mjs";

// Bounded service fault/race fixtures are followed by real isolated v8 HTTP tests.
// No public RPC, deployment manifests or private signing files are accessed.
const address = (n) =>
  ethers.getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const codeIs =
  (...codes) =>
  (error) =>
    codes.includes(error.code);
const item = (person) => ({ participantId: person.id, wallet: person.wallet });
const commitInput = (preview) => ({ nonce: preview.nonce, confirmed: true });
const domain = (record) =>
  structuredClone({
    participants: [...record.participants.values()],
    observations: record.observations,
    batches: record.batches,
    nonces: [...record.nonces],
    revision: record.revision,
  });
const financial = (state) =>
  Object.fromEntries(
    Object.entries(state).filter(
      ([key]) => !["blockNumber", "now"].includes(key),
    ),
  );
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture() {
  const eventId = "event-a",
    owner = { id: "owner-session", wallet: address(1) },
    staff = { id: "staff-session", wallet: address(2) };
  const people = [3, 4].map((n, index) => ({
    id: `${eventId}-${index ? "bob" : "alice"}`,
    eventId,
    name: index ? "Synthetic Bob" : "Synthetic Alice",
    email: `${index ? "bob" : "alice"}@example.invalid`,
    wallet: address(n),
    identityVerified: true,
    admission: "pending",
    deposit: { txHash: `0x${String(n).repeat(64)}` },
  }));
  const record = {
    deployment: {
      chainId: 1337,
      contract: address(10),
      contractVersion: "kleros-event-v8",
    },
    definition: {
      id: eventId,
      startsAt: new Date(900_000).toISOString(),
      endsAt: new Date(1_100_000).toISOString(),
      staff: [staff.wallet],
    },
    participants: new Map(people.map((person) => [person.id, person])),
    observations: [],
    batches: [],
    nonces: new Set(),
    revision: 0,
  };
  const state = {
    phase: "Open",
    owner: owner.wallet,
    now: 1000,
    blockNumber: 42,
    fingerprint: "unchanged-financial-fingerprint",
    balanceWei: "20",
    poolWei: "0",
    stakerCount: 0,
  };
  const clock = { now: 2_000_000 },
    hooks = { verify: null, state: null, persist: null },
    writes = { saves: 0 };
  const authorize = async (id, session, door = false) => {
    requireThat(id === eventId, "Unknown event", "NOT_FOUND", 404);
    requireThat(session?.wallet, "Sign in first", "UNAUTHENTICATED", 401);
    requireThat(
      session.wallet === state.owner ||
        (door && record.definition.staff.includes(session.wallet)),
      "Wrong event role",
      door ? "NOT_STAFF" : "NOT_OWNER",
      403,
    );
    return record;
  };
  const workbench = {
    record: (id) => {
      requireThat(id === eventId, "Unknown event", "NOT_FOUND", 404);
      return record;
    },
    owner: (id, session) => authorize(id, session),
    state: async (id) => {
      requireThat(id === eventId, "Unknown event", "NOT_FOUND", 404);
      if (hooks.state) await hooks.state();
      return structuredClone(state);
    },
    verifyReceipt: async (_id, person) => {
      if (hooks.verify) await hooks.verify(person);
      requireThat(!person.returned, "Returned", "RETURNED_DEPOSIT", 409);
      requireThat(!person.unavailable, "RPC unavailable", "RPC_FAILURE", 503);
      return { verified: true };
    },
    persist: () => {
      writes.saves++;
      if (hooks.persist) hooks.persist();
    },
  };
  const service = createBatchService(workbench, {
    authorizeStaff: (id, session) => authorize(id, session, true),
    now: () => clock.now,
  });
  let sequence = 0;
  const preview = (
    action = "approve-admission",
    selected = people,
    session = owner,
    extra = {},
  ) =>
    service.preview(eventId, session, {
      action,
      items: selected.map(item),
      nonce: `fixture-${++sequence}`,
      ...extra,
    });
  return {
    eventId,
    owner,
    staff,
    people,
    record,
    state,
    clock,
    hooks,
    writes,
    workbench,
    service,
    preview,
  };
}

test("batch preview keeps every selected row and masks contacts for unknown, foreign or unverified wallet links", async () => {
  const f = fixture(),
    before = domain(f.record);
  const preview = await f.service.preview(f.eventId, f.owner, {
    action: "approve-admission",
    nonce: "mixed-rows-1",
    items: [
      item(f.people[0]),
      { participantId: null, wallet: address(6) },
      { participantId: "event-b-foreign", wallet: address(7) },
      { participantId: f.people[1].id, wallet: address(8) },
    ],
  });
  assert.deepEqual(preview.counts, { selected: 4, eligible: 1, blocked: 3 });
  assert.equal(preview.rows.length, 4);
  assert.equal(preview.canCommit, false);
  assert.equal(preview.rows[0].email, f.people[0].email);
  assert.ok(
    preview.rows
      .slice(1)
      .every(
        (row) =>
          row.reasonCode === "WALLET_LINK_REQUIRED" &&
          row.name === null &&
          row.email === null,
      ),
  );
  await assert.rejects(
    () =>
      f.service.commit(f.eventId, f.owner, preview.id, commitInput(preview)),
    codeIs("STALE_BATCH"),
  );
  assert.deepEqual(
    domain(f.record),
    before,
    "A blocked selection cannot silently commit its one eligible row",
  );
  f.people[0].identityVerified = false;
  const unverified = await f.preview("approve-admission", [f.people[0]]);
  assert.equal(unverified.rows[0].email, null);
  assert.equal(unverified.rows[0].eligible, false);
});

test("batch input rejects duplicate wallets/participants, unsupported actions, extra fields and oversized selection", async () => {
  const f = fixture(),
    base = {
      action: "approve-admission",
      items: [item(f.people[0])],
      nonce: "validation-1",
    };
  const invalid = [
    { ...base, action: "register" },
    { ...base, source: "luma" },
    { ...base, items: [] },
    {
      ...base,
      items: Array.from({ length: 151 }, (_, index) => ({
        participantId: null,
        wallet: address(index + 20),
      })),
    },
    { ...base, items: [item(f.people[0]), item(f.people[0])] },
    {
      ...base,
      items: [
        item(f.people[0]),
        { participantId: f.people[0].id, wallet: address(9) },
      ],
    },
    { ...base, items: [{ participantId: null, wallet: "not-an-address" }] },
    {
      ...base,
      items: [{ ...item(f.people[0]), email: "forged@example.invalid" }],
    },
    { ...base, timestamp: 1000 },
  ];
  for (const input of invalid)
    await assert.rejects(() => f.service.preview(f.eventId, f.owner, input));
  assert.equal(f.record.batches.length, 0);
  assert.equal(f.writes.saves, 0);
});

test("approval commit is explicit, complete, audited and retry-idempotent without financial registration", async () => {
  const f = fixture(),
    stateBefore = structuredClone(f.state),
    preview = await f.preview();
  assert.deepEqual(
    f.people.map((person) => person.admission),
    ["pending", "pending"],
  );
  assert.equal(preview.requiresFinancialTransaction, false);
  await assert.rejects(
    () =>
      f.service.commit(f.eventId, f.owner, preview.id, {
        nonce: preview.nonce,
        confirmed: false,
      }),
    codeIs("INVALID_BATCH"),
  );
  const result = await f.service.commit(
    f.eventId,
    f.owner,
    preview.id,
    commitInput(preview),
  );
  assert.equal(result.status, "committed");
  assert.equal(result.appliedCount, 2);
  assert.equal(result.nextAction, "review-staker-registration");
  assert.deepEqual(
    f.people.map((person) => person.admission),
    ["approved", "approved"],
  );
  assert.equal(f.record.revision, 1);
  assert.equal(f.record.batches.length, 1);
  assert.equal(f.record.batches[0].actorWallet, f.owner.wallet);
  assert.equal(f.record.batches[0].rowCount, 2);
  assert.equal(f.writes.saves, 1);
  assert.deepEqual(f.state, stateBefore);
  const replay = await f.service.commit(
    f.eventId,
    f.owner,
    preview.id,
    commitInput(preview),
  );
  assert.equal(replay.replayed, true);
  assert.equal(f.record.revision, 1);
  assert.equal(f.record.batches.length, 1);
  await assert.rejects(
    () =>
      f.preview("approve-admission", f.people, f.owner, {
        nonce: preview.nonce,
      }),
    codeIs("REPLAY"),
  );
});

test("uncommitted reviews bind event, active session, actor and exact nonce, and expire at the boundary", async () => {
  const f = fixture(),
    preview = await f.preview(),
    before = domain(f.record);
  await assert.rejects(
    () =>
      f.service.commit(
        f.eventId,
        { ...f.owner, id: "another-session" },
        preview.id,
        commitInput(preview),
      ),
    codeIs("BATCH_SCOPE"),
  );
  await assert.rejects(
    () =>
      f.service.commit(f.eventId, f.owner, preview.id, {
        nonce: "wrong-nonce",
        confirmed: true,
      }),
    codeIs("BATCH_SCOPE"),
  );
  await assert.rejects(
    () =>
      f.service.commit("event-b", f.owner, preview.id, commitInput(preview)),
    codeIs("NOT_FOUND", "BATCH_SCOPE"),
  );
  await assert.rejects(
    () =>
      f.service.commit(f.eventId, f.staff, preview.id, commitInput(preview)),
    codeIs("NOT_OWNER"),
  );
  f.clock.now = preview.expiresAt;
  await assert.rejects(
    () =>
      f.service.commit(f.eventId, f.owner, preview.id, commitInput(preview)),
    codeIs("STALE_BATCH"),
  );
  assert.deepEqual(domain(f.record), before);
});

test("revision, selected record, deployment and canonical state changes invalidate review atomically", async () => {
  for (const mutate of [
    (f) => f.record.revision++,
    (f) => {
      f.people[0].name = "Concurrent contact correction";
    },
    (f) => {
      f.record.deployment.contract = address(11);
    },
    (f) => {
      f.state.fingerprint = "changed-financial-fingerprint";
    },
  ]) {
    const f = fixture(),
      preview = await f.preview();
    mutate(f);
    const before = domain(f.record);
    await assert.rejects(
      () =>
        f.service.commit(f.eventId, f.owner, preview.id, commitInput(preview)),
      codeIs("STALE_BATCH"),
    );
    assert.deepEqual(domain(f.record), before);
    assert.equal(f.writes.saves, 0);
  }
});

test("returned/unavailable deposits and closed admission phases cannot become curated approvals", async () => {
  const f = fixture();
  f.people[0].returned = true;
  f.people[1].unavailable = true;
  const preview = await f.preview();
  assert.deepEqual(
    preview.rows.map((row) => row.reasonCode),
    ["RETURNED_DEPOSIT", "DEPOSIT_UNAVAILABLE"],
  );
  assert.equal(preview.canCommit, false);
  for (const phase of ["Listed", "Finalized", "Cancelled"]) {
    const closed = fixture();
    closed.state.phase = phase;
    const value = await closed.preview();
    assert.equal(
      value.canCommit,
      false,
      `Admission cannot be approved after phase ${phase}`,
    );
    assert.ok(value.rows.every((row) => !row.eligible));
  }
});

test("a role revoked during slow preview validation cannot receive selected guest contacts", async () => {
  const f = fixture();
  let changed = false;
  f.hooks.verify = () => {
    if (!changed) {
      changed = true;
      f.state.owner = address(8);
      f.state.fingerprint = "ownership-transferred-during-preview";
    }
  };
  await assert.rejects(() => f.preview(), codeIs("NOT_OWNER", "STALE_BATCH"));
  assert.equal(f.record.batches.length, 0);
  const door = fixture();
  door.hooks.state = () => {
    door.record.definition.staff = [];
  };
  await assert.rejects(
    () => door.preview("check-in", door.people, door.staff),
    codeIs("NOT_STAFF", "STALE_BATCH"),
  );
  assert.equal(door.record.observations.length, 0);
});

test("current owner transfer revokes both pending commits and completed result replay", async () => {
  const f = fixture(),
    preview = await f.preview(),
    before = domain(f.record);
  f.state.owner = address(8);
  await assert.rejects(
    () =>
      f.service.commit(f.eventId, f.owner, preview.id, commitInput(preview)),
    codeIs("NOT_OWNER"),
  );
  assert.deepEqual(domain(f.record), before);
  const completed = fixture(),
    value = await completed.preview();
  await completed.service.commit(
    completed.eventId,
    completed.owner,
    value.id,
    commitInput(value),
  );
  completed.state.owner = address(8);
  await assert.rejects(
    () =>
      completed.service.commit(
        completed.eventId,
        completed.owner,
        value.id,
        commitInput(value),
      ),
    codeIs("NOT_OWNER"),
  );
});

test("staff can check in linked free guests only during actual hours, using chain time and replay-safe IDs", async () => {
  const f = fixture();
  f.people.forEach((person) => {
    person.deposit = null;
    person.admission = "free";
  });
  await assert.rejects(
    () => f.preview("approve-admission", f.people, f.staff),
    codeIs("NOT_OWNER"),
  );
  f.state.now = 899;
  const early = await f.preview("check-in", f.people, f.staff);
  assert.equal(early.canCommit, false);
  assert.ok(
    early.rows.every((row) => row.reasonCode === "ATTENDANCE_TIME_MISMATCH"),
  );
  f.state.now = 1000;
  const preview = await f.preview("check-in", f.people, f.staff, {
    note: "Synthetic staff door observation",
  });
  const result = await f.service.commit(
    f.eventId,
    f.staff,
    preview.id,
    commitInput(preview),
  );
  assert.equal(result.appliedCount, 2);
  assert.equal(result.nextAction, "review-post-attendance");
  assert.ok(
    f.record.observations.every(
      (row) =>
        row.timestamp === 1000 &&
        row.reviewer === f.staff.wallet &&
        row.source === "staff-door" &&
        row.note === "Synthetic staff door observation",
    ),
  );
  assert.equal(new Set(f.record.observations.map((row) => row.nonce)).size, 2);
  assert.deepEqual(
    f.people.map((person) => person.admission),
    ["free", "free"],
  );
  const again = await f.service.commit(
    f.eventId,
    f.staff,
    preview.id,
    commitInput(preview),
  );
  assert.equal(again.replayed, true);
  assert.equal(f.record.observations.length, 2);
  const duplicate = await f.preview("check-in", [f.people[0]], f.staff);
  assert.equal(duplicate.rows[0].reasonCode, "DUPLICATE_CHECKIN");
});

test("expiry or event end reached during asynchronous final validation cannot leave partial check-ins", async () => {
  for (const kind of ["expiry", "event-end"]) {
    const f = fixture(),
      preview = await f.preview("check-in", f.people, f.staff),
      before = domain(f.record);
    let calls = 0;
    f.hooks.state = () => {
      if (++calls === 3) {
        if (kind === "expiry") f.clock.now = preview.expiresAt;
        else f.state.now = 1101;
      }
    };
    await assert.rejects(
      () =>
        f.service.commit(f.eventId, f.staff, preview.id, commitInput(preview)),
      codeIs("STALE_BATCH", "ATTENDANCE_TIME_MISMATCH"),
    );
    assert.deepEqual(domain(f.record), before);
  }
});

test("synchronous persistence failure rolls back all approvals, observations, nonce use, audit and revision; retry applies once", async () => {
  for (const action of ["approve-admission", "check-in"]) {
    const f = fixture(),
      preview = await f.preview(action),
      before = domain(f.record);
    f.hooks.persist = () => {
      throw new Error("Synthetic atomic save failure");
    };
    await assert.rejects(
      () =>
        f.service.commit(f.eventId, f.owner, preview.id, commitInput(preview)),
      /Synthetic atomic save failure/,
    );
    assert.deepEqual(domain(f.record), before);
    f.hooks.persist = null;
    await f.service.commit(
      f.eventId,
      f.owner,
      preview.id,
      commitInput(preview),
    );
    assert.equal(f.record.revision, 1);
    assert.equal(f.record.batches.length, 1);
    assert.equal(f.record.observations.length, action === "check-in" ? 2 : 0);
  }
});

test("concurrent batch commits create one complete audit and single-request races preserve the newer individual decision", async () => {
  const f = fixture(),
    first = await f.preview(),
    second = await f.preview();
  const results = await Promise.allSettled([
    f.service.commit(f.eventId, f.owner, first.id, commitInput(first)),
    f.service.commit(f.eventId, f.owner, first.id, commitInput(first)),
    f.service.commit(f.eventId, f.owner, second.id, commitInput(second)),
  ]);
  assert.equal(f.record.batches.length, 1);
  assert.equal(f.record.revision, 1);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.deepEqual(
    f.people.map((person) => person.admission),
    ["approved", "approved"],
  );
  const raced = fixture(),
    pending = await raced.preview(),
    entered = deferred(),
    release = deferred();
  let held = false;
  raced.hooks.verify = async () => {
    if (!held) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  };
  const commit = raced.service.commit(
    raced.eventId,
    raced.owner,
    pending.id,
    commitInput(pending),
  );
  await entered.promise;
  raced.people[0].admission = "declined";
  raced.record.revision++;
  release.resolve();
  await assert.rejects(() => commit, codeIs("STALE_BATCH"));
  assert.deepEqual(
    raced.people.map((person) => person.admission),
    ["declined", "pending"],
  );
  assert.equal(raced.record.batches.length, 0);
});

const assertStatusScope = (value, f, preview, expected) => {
  assert.equal(value.status, expected);
  assert.equal(value.id, preview.id);
  assert.equal(value.eventId, f.eventId);
  assert.equal(value.actorWallet, f.owner.wallet);
  assert.equal(value.chainId, f.record.deployment.chainId);
  assert.equal(value.contract, f.record.deployment.contract);
  assert.equal(value.contractVersion, f.record.deployment.contractVersion);
  assert.equal(value.requiresFinancialTransaction, false);
  assert.ok(!JSON.stringify(value).includes(f.people[0].name));
  assert.ok(!JSON.stringify(value).includes(f.people[0].email));
  for (const key of [
    "rows",
    "counts",
    "nonce",
    "input",
    "selectedHash",
    "sessionId",
  ])
    assert.equal(Object.hasOwn(value, key), false);
};

test("batch status reports ready/blocked/ambiguous unknown without contacts and permits same-wallet relogin only for reads", async () => {
  const f = fixture(),
    ready = await f.preview(),
    before = domain(f.record),
    freshSession = { ...f.owner, id: "fresh-valid-owner-session" };
  assertStatusScope(
    await f.service.status(f.eventId, f.owner, ready.id),
    f,
    ready,
    "ready",
  );
  assertStatusScope(
    await f.service.status(f.eventId, freshSession, ready.id),
    f,
    ready,
    "ready",
  );
  await assert.rejects(
    () =>
      f.service.commit(f.eventId, freshSession, ready.id, commitInput(ready)),
    codeIs("BATCH_SCOPE"),
  );
  const blocked = await f.service.preview(f.eventId, f.owner, {
    action: "approve-admission",
    nonce: "status-blocked-1",
    items: [{ participantId: null, wallet: address(9) }],
  });
  assertStatusScope(
    await f.service.status(f.eventId, freshSession, blocked.id),
    f,
    blocked,
    "blocked",
  );
  const unknown = await f.service.status(
    f.eventId,
    f.owner,
    "opaque-missing-batch-id",
  );
  assertStatusScope(unknown, f, { id: "opaque-missing-batch-id" }, "unknown");
  assert.equal(unknown.action, null);
  assert.deepEqual(
    Object.keys(unknown).sort(),
    [
      "action",
      "actorWallet",
      "chainId",
      "contract",
      "contractVersion",
      "eventId",
      "id",
      "requiresFinancialTransaction",
      "status",
    ].sort(),
  );
  await assert.rejects(
    () => f.service.status(f.eventId, f.staff, ready.id),
    codeIs("NOT_OWNER"),
  );
  const staffPreview = await f.preview("check-in", f.people, f.staff);
  await assert.rejects(
    () => f.service.status(f.eventId, f.owner, staffPreview.id),
    codeIs("BATCH_SCOPE"),
  );
  await assert.rejects(
    () => f.service.status("event-b", f.owner, ready.id),
    codeIs("NOT_FOUND", "BATCH_SCOPE"),
  );
  assert.deepEqual(domain(f.record), before);
  assert.equal(
    f.writes.saves,
    0,
    "Status reads cannot persist or apply any batch",
  );
});

test("batch status keeps the actual paused commit committing after TTL and unrelated preview pruning", async () => {
  const f = fixture(),
    preview = await f.preview(),
    entered = deferred(),
    release = deferred();
  let paused = false;
  f.hooks.verify = async () => {
    if (!paused) {
      paused = true;
      entered.resolve();
      await release.promise;
    }
  };
  const committing = f.service.commit(
    f.eventId,
    f.owner,
    preview.id,
    commitInput(preview),
  );
  const outcome = committing.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await entered.promise;
  f.clock.now = preview.expiresAt + 1;
  assertStatusScope(
    await f.service.status(f.eventId, f.owner, preview.id),
    f,
    preview,
    "committing",
  );
  const unrelated = await f.preview("approve-admission", [f.people[1]]);
  assertStatusScope(
    await f.service.status(f.eventId, f.owner, preview.id),
    f,
    preview,
    "committing",
  );
  assertStatusScope(
    await f.service.status(f.eventId, f.owner, unrelated.id),
    f,
    unrelated,
    "ready",
  );
  release.resolve();
  assert.equal((await outcome).error?.code, "STALE_BATCH");
  assertStatusScope(
    await f.service.status(f.eventId, f.owner, preview.id),
    f,
    preview,
    "expired",
  );
  assert.equal(f.record.batches.length, 0);
  assert.deepEqual(
    f.people.map((person) => person.admission),
    ["pending", "pending"],
  );
});

test("batch status sees completion during a paused authorization instead of falsely releasing as expired", async () => {
  const f = fixture(),
    preview = await f.preview(),
    entered = deferred(),
    release = deferred();
  const authorize = f.workbench.owner;
  let pauseNext = true;
  f.workbench.owner = async (...args) => {
    if (pauseNext) {
      pauseNext = false;
      entered.resolve();
      await release.promise;
    }
    return authorize(...args);
  };
  const reading = f.service.status(f.eventId, f.owner, preview.id);
  await entered.promise;
  const committed = await f.service.commit(
    f.eventId,
    f.owner,
    preview.id,
    commitInput(preview),
  );
  release.resolve();
  const value = await reading;
  assertStatusScope(value, f, preview, "committed");
  assert.equal(value.replayed, true);
  assert.deepEqual(value.participantIds, committed.participantIds);
  assert.equal(f.record.batches.length, 1);
  assert.equal(f.writes.saves, 1);
});

test("batch status recovers committed audit results after service restart and requires current authority", async () => {
  const f = fixture(),
    preview = await f.preview();
  const result = await f.service.commit(
    f.eventId,
    f.owner,
    preview.id,
    commitInput(preview),
  );
  const restarted = fixture();
  // Model the durable record reload: no preview or in-flight map is carried over.
  restarted.record.batches = JSON.parse(JSON.stringify(f.record.batches));
  restarted.record.revision = f.record.revision;
  restarted.people.forEach((person) => {
    person.admission = "approved";
  });
  const freshSession = { ...restarted.owner, id: "post-restart-session" };
  const recovered = await restarted.service.status(
    restarted.eventId,
    freshSession,
    preview.id,
  );
  assertStatusScope(recovered, restarted, preview, "committed");
  assert.equal(recovered.replayed, true);
  assert.deepEqual(recovered.participantIds, result.participantIds);
  const replay = await restarted.service.commit(
    restarted.eventId,
    freshSession,
    preview.id,
    commitInput(preview),
  );
  assert.equal(replay.replayed, true);
  assert.equal(restarted.record.batches.length, 1);
  assert.equal(restarted.writes.saves, 0);
  restarted.state.owner = address(8);
  await assert.rejects(
    () => restarted.service.status(restarted.eventId, freshSession, preview.id),
    codeIs("NOT_OWNER"),
  );
  const pending = fixture(),
    value = await pending.preview();
  pending.state.owner = address(8);
  await assert.rejects(
    () => pending.service.status(pending.eventId, pending.owner, value.id),
    codeIs("NOT_OWNER"),
  );
});

test("batch status reauthorizes the actual action when an ambiguous lookup becomes a committed approval", async () => {
  const f = fixture(),
    preview = await f.preview();
  await f.service.commit(f.eventId, f.owner, preview.id, commitInput(preview));
  const durable = structuredClone(f.record.batches);
  f.record.batches = [];
  f.state.owner = address(8);
  f.record.definition.staff = [f.owner.wallet];
  const entered = deferred(),
    release = deferred();
  const recovering = createBatchService(f.workbench, {
    authorizeStaff: async () => {
      entered.resolve();
      await release.promise;
      return f.record;
    },
    now: () => f.clock.now,
  });
  const reading = recovering.status(f.eventId, f.owner, preview.id);
  const outcome = reading.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await entered.promise;
  f.record.batches = durable;
  release.resolve();
  assert.equal(
    (await outcome).error?.code,
    "NOT_OWNER",
    "Former owners who still have staff access cannot recover an owner-only approval result through the unknown-status fallback",
  );
  assert.equal(f.record.batches.length, 1);
});

test("batch status terminal expiry prevents delayed apply after clock rewind or restored financial fingerprint", async () => {
  for (const kind of [
    "ttl",
    "fingerprint",
    "revision",
    "selected-record",
    "deployment",
    "event-hours",
  ]) {
    const f = fixture(),
      action = kind === "event-hours" ? "check-in" : "approve-admission",
      preview = await f.preview(action);
    const originalClock = f.clock.now,
      originalState = structuredClone(f.state),
      originalPeople = structuredClone(f.people),
      originalDeployment = structuredClone(f.record.deployment);
    if (kind === "ttl") f.clock.now = preview.expiresAt;
    else if (kind === "fingerprint")
      f.state.fingerprint = "temporarily-changed-financial-state";
    else if (kind === "revision") f.record.revision++;
    else if (kind === "selected-record") f.people[0].admission = "declined";
    else if (kind === "deployment") f.record.deployment.contract = address(11);
    else f.state.now = 1101;
    assertStatusScope(
      await f.service.status(f.eventId, f.owner, preview.id),
      f,
      preview,
      "expired",
    );
    Object.assign(f.state, originalState);
    f.people.forEach((person, index) =>
      Object.assign(person, originalPeople[index]),
    );
    Object.assign(f.record.deployment, originalDeployment);
    f.record.revision = 0;
    f.clock.now = originalClock - 1_000;
    const restored = domain(f.record);
    assertStatusScope(
      await f.service.status(f.eventId, f.owner, preview.id),
      f,
      preview,
      "expired",
    );
    await assert.rejects(
      () =>
        f.service.commit(f.eventId, f.owner, preview.id, commitInput(preview)),
      codeIs("STALE_BATCH"),
    );
    assert.deepEqual(
      domain(f.record),
      restored,
      `${kind} retirement must survive an apparently restored review context`,
    );
    assert.equal(f.writes.saves, 0);
  }
});

async function actualFixture() {
  const runtimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "kleros-batches-"),
  );
  const app = await startServer({
    port: 0,
    rpcPort: 0,
    contractVersion: "kleros-event-v8",
    deployment: { mode: "local-demo", runtimeRoot },
  });
  assert.equal(
    Number((await app.workbench.provider.getNetwork()).chainId),
    1337,
  );
  assert.equal(new URL(app.url).hostname, "127.0.0.1");
  const request = async (
    pathname,
    { method = "GET", cookie, payload } = {},
  ) => {
    const response = await fetch(app.url + pathname, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(["POST", "PATCH", "DELETE"].includes(method)
          ? { origin: app.url, "content-type": "application/json" }
          : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const login = async (identity) =>
    (await request("/api/session", { method: "POST", payload: { identity } }))
      .cookie;
  const execute = async (identity, action, params = {}) => {
    const session = app.workbench.session(identity);
    const draft = await app.workbench.createDraft("event-a", session, {
      action,
      params,
    });
    const transaction = await app.workbench.executeDraft(
      "event-a",
      session,
      draft.id,
    );
    assert.equal(transaction.status, "confirmed");
    return transaction;
  };
  return {
    app,
    request,
    login,
    execute,
    close: async () => {
      await app.close();
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    },
  };
}

test(
  "actual v8 HTTP approval keeps mixed unknown/returned wallets blocked and is separate from financial registration",
  { timeout: 120_000 },
  async () => {
    const f = await actualFixture();
    try {
      const w = f.app.workbench,
        owner = w.session("organizer-a"),
        alice = w.session("alice"),
        bob = w.session("bob"),
        record = w.record("event-a", owner),
        a = record.participants.get("event-a-alice"),
        b = record.participants.get("event-a-bob");
      await f.execute("alice", "deposit");
      await f.execute("bob", "deposit");
      await f.execute("bob", "withdrawPending", {
        to: bob.wallet,
        amountWei: record.deployment.depositWei,
      });
      const ownerCookie = await f.login("organizer-a"),
        staffCookie = await f.login("staff-a"),
        foreignCookie = await f.login("organizer-b");
      const payload = {
        action: "approve-admission",
        nonce: "http-mixed-approval-1",
        items: [
          item(a),
          item(b),
          {
            participantId: null,
            wallet: await w.chain.signers[6].getAddress(),
          },
        ],
      };
      assert.equal(
        (
          await f.request("/api/events/event-a/batches/preview", {
            method: "POST",
            payload,
          })
        ).status,
        401,
      );
      for (const cookie of [staffCookie, foreignCookie])
        assert.equal(
          (
            await f.request("/api/events/event-a/batches/preview", {
              method: "POST",
              cookie,
              payload,
            })
          ).status,
          403,
        );
      const financialA = financial(await w.state("event-a")),
        financialB = financial(await w.state("event-b")),
        before = domain(record);
      const preview = await f.request("/api/events/event-a/batches/preview", {
        method: "POST",
        cookie: ownerCookie,
        payload,
      });
      assert.equal(preview.status, 201);
      assert.deepEqual(preview.data.counts, {
        selected: 3,
        eligible: 1,
        blocked: 2,
      });
      assert.equal(preview.data.rows[1].reasonCode, "RETURNED_DEPOSIT");
      assert.equal(preview.data.rows[2].name, null);
      assert.equal(preview.data.rows[2].email, null);
      assert.equal(
        (
          await f.request(
            `/api/events/event-a/batches/${preview.data.id}/commit`,
            {
              method: "POST",
              cookie: ownerCookie,
              payload: commitInput(preview.data),
            },
          )
        ).status,
        409,
      );
      assert.deepEqual(domain(record), before);
      const raced = await f.request("/api/events/event-a/batches/preview", {
        method: "POST",
        cookie: ownerCookie,
        payload: {
          action: "approve-admission",
          nonce: "http-admission-race-1",
          items: [item(a)],
        },
      });
      assert.equal(raced.status, 201);
      const originalVerify = w.verifyReceipt;
      let changed = false;
      w.verifyReceipt = async (...args) => {
        const receipt = await originalVerify(...args);
        if (!changed) {
          changed = true;
          await w.admit("event-a", owner, a.id, "declined");
        }
        return receipt;
      };
      try {
        const raceResult = await f.request(
          `/api/events/event-a/batches/${raced.data.id}/commit`,
          {
            method: "POST",
            cookie: ownerCookie,
            payload: commitInput(raced.data),
          },
        );
        assert.equal(raceResult.status, 409);
        assert.equal(raceResult.data.code, "STALE_BATCH");
      } finally {
        w.verifyReceipt = originalVerify;
      }
      assert.equal(
        a.admission,
        "declined",
        "A real concurrent individual admission decision cannot be silently overwritten by the batch",
      );
      assert.equal(
        record.batches.filter((batch) => batch.batchAction).length,
        0,
      );
      const ready = await f.request("/api/events/event-a/batches/preview", {
        method: "POST",
        cookie: ownerCookie,
        payload: {
          action: "approve-admission",
          nonce: "http-alice-approval-1",
          items: [item(a)],
        },
      });
      assert.equal(ready.status, 201);
      assert.equal(ready.data.canCommit, true);
      const wrongNonce = await f.request(
        `/api/events/event-a/batches/${ready.data.id}/commit`,
        {
          method: "POST",
          cookie: ownerCookie,
          payload: { nonce: "wrong-nonce-1", confirmed: true },
        },
      );
      assert.equal(wrongNonce.status, 409);
      const newSession = await f.login("organizer-a");
      assert.equal(
        (
          await f.request(
            `/api/events/event-a/batches/${ready.data.id}/commit`,
            {
              method: "POST",
              cookie: newSession,
              payload: commitInput(ready.data),
            },
          )
        ).status,
        409,
      );
      const committed = await f.request(
        `/api/events/event-a/batches/${ready.data.id}/commit`,
        {
          method: "POST",
          cookie: ownerCookie,
          payload: commitInput(ready.data),
        },
      );
      assert.equal(committed.status, 200);
      assert.equal(committed.data.appliedCount, 1);
      assert.equal(a.admission, "approved");
      assert.equal(b.admission, "pending");
      assert.equal(Number(await w.contract("event-a").status(alice.wallet)), 0);
      assert.deepEqual(financial(await w.state("event-a")), financialA);
      assert.deepEqual(financial(await w.state("event-b")), financialB);
      const replay = await f.request(
        `/api/events/event-a/batches/${ready.data.id}/commit`,
        {
          method: "POST",
          cookie: ownerCookie,
          payload: commitInput(ready.data),
        },
      );
      assert.equal(replay.status, 200);
      assert.equal(replay.data.replayed, true);
      assert.equal(
        record.batches.filter((batch) => batch.batchAction).length,
        1,
      );
      await f.execute("organizer-a", "register");
      assert.equal(Number(await w.contract("event-a").status(alice.wallet)), 1);
      assert.equal(
        (await w.state("event-a")).poolWei,
        record.deployment.depositWei,
      );
      assert.deepEqual(financial(await w.state("event-b")), financialB);
    } finally {
      await f.close();
    }
  },
);

test(
  "actual v8 HTTP staff batch observes paid and free guests at chain time, stays replay-safe and does not post financial attendance",
  { timeout: 120_000 },
  async () => {
    const f = await actualFixture();
    try {
      const w = f.app.workbench,
        owner = w.session("organizer-a"),
        record = w.record("event-a", owner),
        a = record.participants.get("event-a-alice"),
        free = record.participants.get("event-a-carol"),
        staff = w.session("staff-a");
      await f.execute("alice", "deposit");
      await w.admit("event-a", owner, a.id, "approved");
      await w.admit("event-a", owner, free.id, "free");
      await f.execute("organizer-a", "register");
      const staffCookie = await f.login("staff-a");
      const payload = {
        action: "check-in",
        nonce: "http-staff-checkin-1",
        note: "Synthetic actual door review",
        items: [item(a), item(free)],
      };
      const early = await f.request("/api/events/event-a/batches/preview", {
        method: "POST",
        cookie: staffCookie,
        payload,
      });
      assert.equal(early.status, 201);
      assert.equal(early.data.canCommit, false);
      assert.ok(
        early.data.rows.every(
          (row) => row.reasonCode === "ATTENDANCE_TIME_MISMATCH",
        ),
      );
      await w.advance(3601);
      const financialA = financial(await w.state("event-a")),
        financialB = financial(await w.state("event-b"));
      const ready = await f.request("/api/events/event-a/batches/preview", {
        method: "POST",
        cookie: staffCookie,
        payload: { ...payload, nonce: "http-staff-checkin-2" },
      });
      assert.equal(ready.status, 201);
      assert.equal(ready.data.canCommit, true);
      const committed = await f.request(
        `/api/events/event-a/batches/${ready.data.id}/commit`,
        {
          method: "POST",
          cookie: staffCookie,
          payload: commitInput(ready.data),
        },
      );
      assert.equal(committed.status, 200);
      assert.equal(committed.data.appliedCount, 2);
      const observed = record.observations,
        now = (await w.provider.getBlock("latest")).timestamp;
      assert.equal(observed.length, 2);
      assert.ok(
        observed.every(
          (row) =>
            row.timestamp === now &&
            row.reviewer === staff.wallet &&
            row.source === "staff-door",
        ),
      );
      assert.equal(free.admission, "free");
      assert.equal(Number(await w.contract("event-a").status(free.wallet)), 0);
      assert.equal((await w.state("event-a")).phase, "Open");
      assert.deepEqual(financial(await w.state("event-a")), financialA);
      assert.deepEqual(financial(await w.state("event-b")), financialB);
      const replay = await f.request(
        `/api/events/event-a/batches/${ready.data.id}/commit`,
        {
          method: "POST",
          cookie: staffCookie,
          payload: commitInput(ready.data),
        },
      );
      assert.equal(replay.status, 200);
      assert.equal(replay.data.replayed, true);
      assert.equal(record.observations.length, 2);
      const singleDuplicate = await f.request("/api/events/event-a/checkins", {
        method: "POST",
        cookie: staffCookie,
        payload: {
          participantId: a.id,
          source: "staff-door",
          nonce: "individual-after-batch-1",
        },
      });
      assert.equal(singleDuplicate.status, 409);
      assert.equal(singleDuplicate.data.code, "DUPLICATE_CHECKIN");
      await f.execute("organizer-a", "postAttendance");
      assert.equal((await w.state("event-a")).phase, "Listed");
      assert.equal(Number(await w.contract("event-a").status(a.wallet)), 1);
      assert.equal(await w.contract("event-a").attended(a.wallet), true);
      assert.equal(Number(await w.contract("event-a").status(free.wallet)), 0);
      assert.equal(await w.contract("event-a").attended(free.wallet), false);
      assert.deepEqual(financial(await w.state("event-b")), financialB);
    } finally {
      await f.close();
    }
  },
);

test(
  "batch status HTTP GET requires authentication and exact wallet/event/deployment scope across relogin",
  { timeout: 120_000 },
  async () => {
    const f = await actualFixture();
    try {
      const w = f.app.workbench,
        owner = w.session("organizer-a"),
        record = w.record("event-a", owner),
        a = record.participants.get("event-a-alice");
      await f.execute("alice", "deposit");
      const ownerCookie = await f.login("organizer-a"),
        otherCookie = await f.login("organizer-b"),
        staffCookie = await f.login("staff-a"),
        aliceCookie = await f.login("alice");
      const preview = await f.request("/api/events/event-a/batches/preview", {
        method: "POST",
        cookie: ownerCookie,
        payload: {
          action: "approve-admission",
          nonce: "http-status-approval-1",
          items: [item(a)],
        },
      });
      assert.equal(preview.status, 201);
      const pathname = `/api/events/event-a/batches/${preview.data.id}`;
      const before = domain(record),
        financialA = financial(await w.state("event-a")),
        financialB = financial(await w.state("event-b"));
      assert.equal((await f.request(pathname)).status, 401);
      for (const cookie of [otherCookie, staffCookie, aliceCookie])
        assert.equal((await f.request(pathname, { cookie })).status, 403);
      const ready = await f.request(pathname, { cookie: ownerCookie });
      assert.equal(ready.status, 200);
      assert.equal(ready.data.status, "ready");
      assert.equal(ready.data.id, preview.data.id);
      assert.equal(ready.data.eventId, "event-a");
      assert.equal(ready.data.actorWallet, owner.wallet);
      assert.equal(ready.data.chainId, 1337);
      assert.equal(ready.data.contract, record.deployment.contract);
      assert.equal(ready.data.contractVersion, "kleros-event-v8");
      assert.equal(Object.hasOwn(ready.data, "rows"), false);
      assert.ok(!JSON.stringify(ready.data).includes(a.email));
      const relogin = await f.login("organizer-a");
      assert.equal(
        (await f.request(pathname, { cookie: relogin })).data.status,
        "ready",
      );
      assert.equal(
        (
          await f.request(pathname + "/commit", {
            method: "POST",
            cookie: relogin,
            payload: commitInput(preview.data),
          })
        ).status,
        409,
      );
      const blockedPreview = await f.request(
        "/api/events/event-a/batches/preview",
        {
          method: "POST",
          cookie: ownerCookie,
          payload: {
            action: "approve-admission",
            nonce: "http-status-blocked-1",
            items: [
              {
                participantId: null,
                wallet: await w.chain.signers[6].getAddress(),
              },
            ],
          },
        },
      );
      const blocked = await f.request(
        `/api/events/event-a/batches/${blockedPreview.data.id}`,
        { cookie: ownerCookie },
      );
      assert.equal(blocked.status, 200);
      assert.equal(blocked.data.status, "blocked");
      assert.equal(Object.hasOwn(blocked.data, "rows"), false);
      const unknown = await f.request(
        "/api/events/event-a/batches/opaque-unknown-review",
        { cookie: ownerCookie },
      );
      assert.equal(unknown.status, 200);
      assert.equal(unknown.data.status, "unknown");
      assert.equal(unknown.data.action, null);
      assert.equal(Object.hasOwn(unknown.data, "rows"), false);
      const privateB = await f.request("/api/events/event-b", {
        method: "PATCH",
        cookie: otherCookie,
        payload: { visibility: "private" },
      });
      assert.equal(privateB.status, 200);
      assert.equal(
        (
          await f.request(`/api/events/event-b/batches/${preview.data.id}`, {
            cookie: otherCookie,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await f.request("/api/events/event-b/batches/opaque-unknown-review", {
            cookie: ownerCookie,
          })
        ).status,
        403,
      );
      const privateUnknown = await f.request(
        "/api/events/event-b/batches/opaque-unknown-review",
        { cookie: otherCookie },
      );
      assert.equal(privateUnknown.status, 200);
      assert.equal(privateUnknown.data.status, "unknown");
      assert.deepEqual(domain(record), before);
      assert.deepEqual(financial(await w.state("event-a")), financialA);
      assert.deepEqual(financial(await w.state("event-b")), financialB);
      const applied = await f.request(pathname + "/commit", {
        method: "POST",
        cookie: ownerCookie,
        payload: commitInput(preview.data),
      });
      assert.equal(applied.status, 200);
      const completed = await f.request(pathname, { cookie: relogin });
      assert.equal(completed.status, 200);
      assert.equal(completed.data.status, "committed");
      assert.equal(completed.data.replayed, true);
      assert.deepEqual(completed.data.participantIds, [a.id]);
      assert.ok(!JSON.stringify(completed.data).includes(a.email));
      assert.deepEqual(financial(await w.state("event-a")), financialA);
      assert.deepEqual(financial(await w.state("event-b")), financialB);
    } finally {
      await f.close();
    }
  },
);
