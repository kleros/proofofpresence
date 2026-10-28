import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { ContractFactory } from "ethers";
import { createWorkbench } from "../src/workbench.mjs";

const DAY = 86_400;
let w;
let owners;
let people;
const payouts = new Map();

before(async () => {
  w = await createWorkbench({ rpcPort: 0 });
  owners = { a: w.session("organizer-a"), b: w.session("organizer-b") };
  people = Object.fromEntries(
    ["alice", "bob", "carol"].map((id) => [id, w.session(id)]),
  );
});

after(async () => {
  if (w) await w.close();
});

async function detail(eventId, session = owners.a) {
  return w.detail(eventId, session);
}
async function transact(eventId, session, action, params = {}) {
  const draft = await w.createDraft(eventId, session, { action, params });
  const result = await w.executeDraft(eventId, session, draft.id);
  assert.equal(result.status, "confirmed");
  assert.match(result.hash, /^0x[0-9a-f]{64}$/i);
  const receipt = await w.provider.getTransactionReceipt(result.hash);
  assert.equal(
    receipt.status,
    1,
    "a completed action must have a successful EVM receipt",
  );
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !==
      (await w.contract(eventId).getAddress()).toLowerCase()
    )
      continue;
    let parsed;
    try {
      parsed = w.contract(eventId).interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name === "Payout") {
      const key = `${eventId}:${parsed.args.to.toLowerCase()}`;
      payouts.set(key, (payouts.get(key) ?? 0n) + parsed.args.amount);
    }
  }
  return { draft, result, receipt };
}
function participant(view, person) {
  const wallet = people[person].wallet.toLowerCase();
  const record = view.participants.find(
    (p) => p.wallet.toLowerCase() === wallet,
  );
  assert.ok(
    record,
    `linked participant ${person} must exist in ${view.event.id}`,
  );
  return record;
}
async function admit(eventId, owner, person, admission = "approved") {
  const p = participant(await detail(eventId, owner), person);
  return w.admit(eventId, owner, p.id, admission);
}
async function checkin(eventId, owner, person, suffix = person) {
  const p = participant(await detail(eventId, owner), person);
  return w.checkin(eventId, owner, {
    participantId: p.id,
    nonce: `${eventId}-${suffix}`,
    source: "staff-door",
    note: "Synthetic door observation",
  });
}
async function newEvent(slug, owner = owners.a, extra = {}) {
  const boot = await w.bootstrap();
  const startsAt = new Date((Number(boot.now) + 3600) * 1000).toISOString();
  const endsAt = new Date((Number(boot.now) + 7200) * 1000).toISOString();
  const created = await w.createEvent(owner, {
    title: `Synthetic ${slug}`,
    slug,
    description: "Local integration fixture",
    timezone: "Asia/Bangkok",
    location: "Local test venue",
    startsAt,
    endsAt,
    depositEth: "0.012",
    ...extra,
  });
  return created.event?.id ?? created.id;
}
async function join(eventId, person, owner = owners.a) {
  const view = await detail(eventId, owner);
  if (
    !view.participants.some(
      (p) => p.wallet.toLowerCase() === people[person].wallet.toLowerCase(),
    )
  ) {
    await w.registerParticipant(eventId, people[person], {
      name: `Synthetic ${person}`,
      email: `${person}@example.invalid`,
    });
  }
  await transact(eventId, people[person], "deposit");
  await admit(eventId, owner, person);
}

test("catalogue has two independent deployments and the same verified wallet in both", async () => {
  const boot = await w.bootstrap(people.alice);
  assert.equal(boot.mode, "local-demo");
  assert.equal(Number(boot.chain.chainId), 1337);
  const a = boot.events.find((e) => e.id === "event-a");
  const b = boot.events.find((e) => e.id === "event-b");
  assert.ok(a && b);
  assert.notEqual(a.contract.toLowerCase(), b.contract.toLowerCase());
  assert.notEqual(a.depositWei, b.depositWei);
  assert.notEqual(a.startsAt, b.startsAt);
  assert.equal(
    (await w.contract(a.id).owner()).toLowerCase(),
    owners.a.wallet.toLowerCase(),
  );
  assert.equal(
    (await w.contract(b.id).owner()).toLowerCase(),
    owners.b.wallet.toLowerCase(),
  );
  const pa = participant(await detail(a.id, people.alice), "alice");
  const pb = participant(await detail(b.id, people.alice), "alice");
  assert.equal(pa.wallet, pb.wallet);
  assert.equal(pa.eventId, a.id);
  assert.equal(pb.eventId, b.id);
  assert.notEqual(pa.id, pb.id);
});

test("organizer, attendee and event staff authorization is enforced by the backend", async () => {
  const alice = participant(await detail("event-a", owners.a), "alice");
  const bAlice = participant(await detail("event-b", owners.b), "alice");
  await assert.rejects(() =>
    w.admit("event-a", people.alice, alice.id, "approved"),
  );
  await assert.rejects(() =>
    w.admit("event-a", owners.b, alice.id, "approved"),
  );
  await assert.rejects(() =>
    w.createDraft("event-a", owners.b, { action: "register", params: {} }),
  );
  await assert.rejects(() =>
    w.checkin("event-a", people.alice, {
      participantId: alice.id,
      nonce: "guest-forgery",
      source: "staff-door",
    }),
  );
  await assert.rejects(() =>
    w.checkin("event-b", w.session("staff-a"), {
      participantId: bAlice.id,
      nonce: "wrong-event-staff",
      source: "staff-door",
    }),
  );
  const participantView = await detail("event-a", people.alice);
  assert.ok(
    participantView.participants.every(
      (p) => p.wallet.toLowerCase() === people.alice.wallet.toLowerCase(),
    ),
    "attendee cannot read other people's contacts",
  );
});

test("self-reported history and merch payloads cannot alter financial state or trusted attendance", async () => {
  const before = await detail("event-b", owners.b);
  await w.personal("event-b", people.alice, { attended: true });
  const after = await detail("event-b", owners.b);
  assert.deepEqual(after.state.attendees, before.state.attendees);
  assert.equal(after.attendance.length, before.attendance.length);
  assert.equal(after.state.stakerCount, before.state.stakerCount);
  const alice = participant(after, "alice");
  await assert.rejects(() =>
    w.checkin("event-b", owners.b, {
      participantId: alice.id,
      nonce: "merch-forgery",
      source: "merch",
      tier: "Gold",
      newsletter: true,
    }),
  );
  const final = await detail("event-b", owners.b);
  assert.deepEqual(final.state.attendees, before.state.attendees);
  assert.equal(final.attendance.length, before.attendance.length);
});

test("deposit receipts, admission and registration remain distinct in both events", async () => {
  for (const person of ["alice", "bob", "carol"]) {
    await transact("event-a", people[person], "deposit");
    const p = participant(await detail("event-a", owners.a), person);
    assert.equal(p.deposit.verified, true);
    assert.equal(
      p.registered,
      false,
      "a receipt alone must not register a wallet",
    );
    await admit("event-a", owners.a, person);
  }
  const bDeposit = await transact("event-b", people.alice, "deposit");
  await assert.rejects(
    () =>
      w.linkDeposit("event-a", people.alice, { txHash: bDeposit.result.hash }),
    "event B transaction cannot be reused for A",
  );
  await admit("event-b", owners.b, "alice");
  await admit("event-b", owners.b, "bob", "free");
  await admit("event-b", owners.b, "carol", "declined");
  await transact("event-a", owners.a, "register");
  await transact("event-b", owners.b, "register");
  const a = await detail("event-a", owners.a);
  const b = await detail("event-b", owners.b);
  assert.equal(Number(a.state.stakerCount), 3);
  assert.equal(Number(b.state.stakerCount), 1);
  for (const person of ["alice", "bob", "carol"])
    assert.equal(participant(a, person).registered, true);
  assert.equal(participant(b, "alice").registered, true);
  assert.equal(participant(b, "bob").registered, false);
  assert.equal(participant(b, "carol").registered, false);
  assert.equal(BigInt(a.state.poolWei), 3n * BigInt(a.event.depositWei));
  assert.equal(BigInt(b.state.poolWei), BigInt(b.event.depositWei));
});

test("raw attendance origin requires review and known wrong-event evidence cannot be relabelled", async () => {
  await w.advance(7201);
  const a = await detail("event-a", owners.a);
  const b = await detail("event-b", owners.b);
  const alice = participant(a, "alice");
  const at = new Date(Number(a.now) * 1000).toISOString();
  const raw = `participant_id,email,wallet,checked_in_at\n${alice.id},${alice.email},${alice.wallet},${at}\n`;
  await assert.rejects(() =>
    w.importCsv("event-a", owners.a, { kind: "attendance", csv: raw }),
  );
  const wrongEvent = `event_id,chain_id,contract,participant_id,wallet,checked_in_at\nevent-b,1337,${b.event.contract},${alice.id},${alice.wallet},${at}\n`;
  const review = {
    confirmed: true,
    note: "Checked the synthetic export screen and selected event.",
  };
  await assert.rejects(() =>
    w.importCsv("event-a", owners.a, {
      kind: "attendance",
      csv: wrongEvent,
      sourceEventId: "event-a",
      review,
    }),
  );
  const wrongChain = `event_id,chain_id,contract,participant_id,wallet,checked_in_at\nevent-a,1,${a.event.contract},${alice.id},${alice.wallet},${at}\n`;
  await assert.rejects(() =>
    w.importCsv("event-a", owners.a, {
      kind: "attendance",
      csv: wrongChain,
      sourceEventId: "event-a",
      review,
    }),
  );
  const wrongContract = `event_id,chain_id,contract,participant_id,wallet,checked_in_at\nevent-a,1337,${b.event.contract},${alice.id},${alice.wallet},${at}\n`;
  await assert.rejects(() =>
    w.importCsv("event-a", owners.a, {
      kind: "attendance",
      csv: wrongContract,
      sourceEventId: "event-a",
      review,
    }),
  );
  const wrongParticipant = `participant_id,email,wallet,checked_in_at\nevent-b-alice,${alice.email},${alice.wallet},${at}\n`;
  await assert.rejects(
    () =>
      w.importCsv("event-a", owners.a, {
        kind: "attendance",
        csv: wrongParticipant,
        sourceEventId: "event-a",
        review,
      }),
    "foreign participant ID cannot fall back to a matching email in the selected event",
  );
  const accepted = await w.importCsv("event-a", owners.a, {
    kind: "attendance",
    csv: raw,
    sourceEventId: "event-a",
    review,
  });
  assert.ok(
    accepted.limitation,
    "manual review must retain the unknown-origin limitation",
  );
  assert.equal(accepted.errors.length, 0);
  assert.equal(accepted.rows, 1);
  assert.equal(accepted.batch.eventId, "event-a");
});

test("authenticated door observations reject replay and cross-event participant IDs", async () => {
  const aliceA = participant(await detail("event-a", owners.a), "alice");
  const staffSession = w.session("staff-a");
  const free = await w.registerParticipant("event-a", staffSession, {
    name: "Synthetic free guest",
    email: "free@example.invalid",
  });
  await w.admit("event-a", owners.a, free.id, "free");
  const payload = {
    participantId: free.id,
    nonce: "event-a-staff-observation",
    source: "staff-door",
    note: "Synthetic staff review",
  };
  await w.checkin("event-a", w.session("staff-a"), payload);
  await assert.rejects(() =>
    w.checkin("event-a", w.session("staff-a"), payload),
  );
  await assert.rejects(() =>
    w.checkin("event-b", owners.b, {
      ...payload,
      participantId: aliceA.id,
      nonce: "cross-event-participant",
    }),
  );
  await checkin("event-b", owners.b, "alice");
});

test("Event A pays normal attendees while two cases remain open; Event B continues independently", async () => {
  await transact("event-a", owners.a, "postAttendance");
  await transact("event-a", people.bob, "challenge");
  await transact("event-a", people.carol, "challenge");
  await transact("event-a", owners.a, "match", { wallet: people.bob.wallet });
  await transact("event-a", owners.b, "match", { wallet: people.carol.wallet });
  const challenged = await w.contract("event-a").challenges(people.bob.wallet);
  const evidence = await w.createDraft("event-a", people.bob, {
    action: "evidence",
    params: {
      wallet: people.bob.wallet,
      uri: "/ipfs/bafkreisyntheticevidence",
    },
  });
  assert.equal(
    evidence.transaction.to.toLowerCase(),
    (await w.contract("event-a").disputeResolver()).toLowerCase(),
  );
  assert.equal(
    BigInt(evidence.args[0]),
    challenged.localDisputeID,
    "resolver evidence uses the local case ID",
  );
  await transact("event-b", owners.b, "postAttendance");
  await w.advance(DAY + 1);
  const aBefore = await detail("event-a", owners.a);
  const releasedA = await transact("event-a", owners.a, "release");
  const a = await detail("event-a", owners.a);
  const d = BigInt(a.event.depositWei);
  assert.equal(a.state.phase, "Finalized");
  assert.equal(Number(a.state.attendeeCount), 1);
  assert.equal(BigInt(a.state.heldBackWei), 2n * d);
  assert.equal(
    BigInt(a.state.reservedWei),
    BigInt(a.state.heldBackWei) +
      BigInt(a.state.owedTotalWei) +
      BigInt(a.state.challengeEscrowWei),
  );
  assert.equal(
    a.state.cases.filter((c) => BigInt(c.heldShareWei) === d).length,
    2,
  );
  // The real contract has reduced its balance by exactly one normal share, with gas paid by the organizer.
  assert.equal(
    BigInt(aBefore.state.balanceWei) - BigInt(a.state.balanceWei),
    d,
  );
  assert.equal(payouts.get(`event-a:${people.alice.wallet.toLowerCase()}`), d);
  assert.ok(releasedA.result.hash);
  await transact("event-b", owners.b, "release");
  const b = await detail("event-b", owners.b);
  assert.equal(b.state.phase, "Finalized");
  assert.equal(BigInt(b.state.heldBackWei), 0n);
  assert.equal(b.state.cases.length, 0);
  assert.equal(
    Number((await detail("event-a", owners.a)).state.attendeeCount),
    1,
  );
});

test("a late loser redistributes to attendees and open cases, then winner receives the full grown reserve", async () => {
  const aBefore = await detail("event-a", owners.a);
  const bBefore = await detail("event-b", owners.b);
  const d = BigInt(aBefore.event.depositWei);
  await w.mockRuling("event-a", owners.a, people.bob.wallet, 2);
  await transact("event-a", owners.a, "resolve", { wallet: people.bob.wallet });
  const middle = await detail("event-a", owners.a);
  const carol = middle.state.cases.find(
    (c) => c.wallet.toLowerCase() === people.carol.wallet.toLowerCase(),
  );
  assert.equal(BigInt(carol.heldShareWei), d + d / 2n);
  assert.equal(BigInt(middle.state.heldBackWei), d + d / 2n);
  await w.mockRuling("event-a", owners.a, people.carol.wallet, 1);
  await transact("event-a", owners.a, "resolve", {
    wallet: people.carol.wallet,
  });
  const settled = await detail("event-a", owners.a);
  assert.equal(Number(settled.state.attendeeCount), 2);
  assert.ok(
    settled.state.attendees.some(
      (wallet) => wallet.toLowerCase() === people.carol.wallet.toLowerCase(),
    ),
  );
  assert.ok(
    !settled.state.attendees.some(
      (wallet) => wallet.toLowerCase() === people.bob.wallet.toLowerCase(),
    ),
  );
  assert.equal(BigInt(settled.state.heldBackWei), 0n);
  assert.equal(BigInt(settled.state.challengeEscrowWei), 0n);
  assert.equal(
    BigInt(settled.state.reservedWei),
    BigInt(settled.state.owedTotalWei),
  );
  assert.equal(
    payouts.get(`event-a:${people.alice.wallet.toLowerCase()}`),
    (3n * d) / 2n,
  );
  assert.equal(
    payouts.get(`event-a:${people.carol.wallet.toLowerCase()}`),
    (3n * d) / 2n,
  );
  assert.equal(
    payouts.get(`event-a:${people.bob.wallet.toLowerCase()}`) ?? 0n,
    0n,
  );
  const bAfter = await detail("event-b", owners.b);
  for (const key of [
    "balanceWei",
    "reservedWei",
    "heldBackWei",
    "stakerCount",
    "attendeeCount",
    "phase",
  ])
    assert.equal(bAfter.state[key], bBefore.state[key]);
  await assert.rejects(() =>
    w.createDraft("event-a", owners.a, {
      action: "resolve",
      params: { wallet: people.carol.wallet },
    }),
  );
});

test("drafts are bound to event, wallet, authoritative snapshot and single execution", async () => {
  const id = await newEvent("draft-isolation");
  await w.registerParticipant(id, people.alice, {
    name: "Synthetic Alice",
    email: "alice@example.invalid",
  });
  const first = await w.createDraft(id, people.alice, {
    action: "deposit",
    params: {},
  });
  await assert.rejects(() => w.executeDraft(id, people.bob, first.id));
  await assert.rejects(() => w.executeDraft("event-b", people.alice, first.id));
  const signer = await w.provider.getSigner(people.bob.wallet);
  await (
    await signer.sendTransaction({
      to: await w.contract(id).getAddress(),
      value: 1n,
    })
  ).wait();
  await assert.rejects(
    () => w.executeDraft(id, people.alice, first.id),
    "changed on-chain balance must invalidate a reviewed draft",
  );
  const { draft } = await transact(id, people.alice, "deposit");
  await assert.rejects(
    () => w.executeDraft(id, people.alice, draft.id),
    "confirmed draft cannot execute twice",
  );
});

test("event creation validates stable slug, timezone and local financial association", async () => {
  const id = await newEvent("new-event");
  const created = await detail(id, owners.a);
  assert.equal(created.event.slug, "new-event");
  assert.equal(created.event.timezone, "Asia/Bangkok");
  assert.equal(BigInt(created.event.depositWei), 12_000_000_000_000_000n);
  assert.equal(
    (await w.contract(id).owner()).toLowerCase(),
    owners.a.wallet.toLowerCase(),
  );
  await assert.rejects(() => newEvent("new-event"));
  const boot = await w.bootstrap();
  const data = {
    title: "Invalid zone",
    slug: "invalid-zone",
    timezone: "Mars/Olympus",
    location: "Synthetic venue",
    startsAt: new Date((Number(boot.now) + 3600) * 1000).toISOString(),
    endsAt: new Date((Number(boot.now) + 7200) * 1000).toISOString(),
    depositEth: "0.01",
  };
  await assert.rejects(() => w.createEvent(owners.a, data));
  const before = (await detail("event-a")).event.contract;
  await assert.rejects(() =>
    newEvent("overwrite-attempt", people.alice, { _seedId: "event-a" }),
  );
  assert.equal(
    (await detail("event-a")).event.contract,
    before,
    "caller-supplied IDs cannot overwrite the trusted event registry",
  );
});

test("a private local event is usable by its creator and absent from unauthorized views", async () => {
  const id = await newEvent("private-event", owners.a, {
    visibility: "private",
  });
  const own = await detail(id, owners.a);
  assert.equal(own.event.visibility, "private");
  assert.equal(own.permissions.owner, true);
  assert.ok((await w.bootstrap(owners.a)).events.some((e) => e.id === id));
  assert.ok(!(await w.bootstrap(owners.b)).events.some((e) => e.id === id));
  assert.ok(!(await w.bootstrap()).events.some((e) => e.id === id));
  await assert.rejects(() => w.detail(id, owners.b));
  await assert.rejects(() => w.detail(id, people.alice));
  await assert.rejects(() =>
    w.checkin(id, w.session("staff-a"), {
      participantId: "unknown",
      nonce: "private-checkin-forgery",
      source: "staff-door",
    }),
  );
});

test("versioned deployment dispatch refuses a corrupt registry before producing actionable state", async () => {
  const id = await newEvent("registry-validation");
  const deployment = w.events.get(id).deployment;
  for (const [field, invalid] of [
    ["chainId", 1],
    ["contract", "0x0000000000000000000000000000000000000001"],
    ["abiVersion", "unknown-version"],
    ["depositWei", "1"],
  ]) {
    const original = deployment[field];
    try {
      deployment[field] = invalid;
      await assert.rejects(
        () => w.detail(id, owners.a),
        `${field} mismatch must fail closed`,
      );
    } finally {
      deployment[field] = original;
    }
  }
  assert.equal((await detail(id, owners.a)).state.phase, "Open");
});

test("late winner then loser has the same cumulative entitlement as loser then winner", async () => {
  const id = await newEvent("reverse-settlement");
  for (const person of ["alice", "bob", "carol"]) await join(id, person);
  await transact(id, owners.a, "register");
  await w.advance(3601);
  await checkin(id, owners.a, "alice");
  await transact(id, owners.a, "postAttendance");
  for (const person of ["bob", "carol"]) {
    await transact(id, people[person], "challenge");
    await transact(id, owners.a, "match", { wallet: people[person].wallet });
  }
  await w.advance(DAY + 1);
  await transact(id, owners.a, "release");
  const d = BigInt((await detail(id)).event.depositWei);
  await w.mockRuling(id, owners.a, people.carol.wallet, 1);
  await transact(id, owners.a, "resolve", { wallet: people.carol.wallet });
  assert.equal(BigInt((await detail(id)).state.heldBackWei), d);
  await w.mockRuling(id, owners.a, people.bob.wallet, 2);
  await transact(id, owners.a, "resolve", { wallet: people.bob.wallet });
  const final = await detail(id);
  assert.equal(BigInt(final.state.heldBackWei), 0n);
  assert.equal(
    payouts.get(`${id}:${people.alice.wallet.toLowerCase()}`),
    (3n * d) / 2n,
  );
  assert.equal(
    payouts.get(`${id}:${people.carol.wallet.toLowerCase()}`),
    (3n * d) / 2n,
  );
  assert.equal(
    payouts.get(`${id}:${people.bob.wallet.toLowerCase()}`) ?? 0n,
    0n,
  );
});

test("refused ruling excludes the challenger and divides only the challenge remainder", async () => {
  const id = await newEvent("refused-ruling");
  for (const person of ["alice", "bob"]) await join(id, person);
  await transact(id, owners.a, "register");
  await w.advance(3601);
  await checkin(id, owners.a, "alice");
  await transact(id, owners.a, "postAttendance");
  await transact(id, people.bob, "challenge");
  await transact(id, owners.a, "match", { wallet: people.bob.wallet });
  await w.advance(DAY + 1);
  await transact(id, owners.a, "release");
  const before = await detail(id);
  const remainder = BigInt(before.state.challengeEscrowWei);
  const bobBalance = await w.provider.getBalance(people.bob.wallet);
  await w.mockRuling(id, owners.a, people.bob.wallet, 0);
  await transact(id, owners.a, "resolve", { wallet: people.bob.wallet });
  const final = await detail(id);
  assert.equal(final.state.attendeeCount, 1);
  assert.equal(BigInt(final.state.heldBackWei), 0n);
  assert.equal(BigInt(final.state.challengeEscrowWei), 0n);
  assert.equal(
    (await w.provider.getBalance(people.bob.wallet)) - bobBalance,
    remainder / 2n,
  );
  assert.equal(
    payouts.get(`${id}:${people.bob.wallet.toLowerCase()}`) ?? 0n,
    0n,
    "refused ruling does not refund the committed principal",
  );
  assert.equal(
    payouts.get(`${id}:${people.alice.wallet.toLowerCase()}`),
    2n * BigInt(final.event.depositWei),
  );
});

test("an unmatched challenge becomes attendance after its own matching period", async () => {
  const id = await newEvent("unmatched-challenge");
  for (const person of ["alice", "bob"]) await join(id, person);
  await transact(id, owners.a, "register");
  await w.advance(3601);
  await checkin(id, owners.a, "alice");
  await transact(id, owners.a, "postAttendance");
  await transact(id, people.bob, "challenge");
  await assert.rejects(() =>
    w.createDraft(id, owners.a, { action: "release", params: {} }),
  );
  await w.advance(DAY + 1);
  await transact(id, owners.a, "release");
  const final = await detail(id);
  assert.equal(final.state.attendeeCount, 2);
  assert.equal(BigInt(final.state.heldBackWei), 0n);
  assert.equal(BigInt(final.state.challengeEscrowWei), 0n);
  assert.equal(
    payouts.get(`${id}:${people.alice.wallet.toLowerCase()}`),
    BigInt(final.event.depositWei),
  );
  assert.equal(
    payouts.get(`${id}:${people.bob.wallet.toLowerCase()}`),
    BigInt(final.event.depositWei),
  );
});

test("cancellation refunds registered spots once, and no-list emergency withdrawal waits for the exact contract condition", async () => {
  const cancelled = await newEvent("cancelled-event");
  await join(cancelled, "alice");
  await transact(cancelled, owners.a, "register");
  await transact(cancelled, owners.a, "cancel");
  const cancelledView = await detail(cancelled);
  assert.equal(cancelledView.state.phase, "Cancelled");
  assert.equal(BigInt(cancelledView.state.reservedWei), 0n);
  assert.equal(
    payouts.get(`${cancelled}:${people.alice.wallet.toLowerCase()}`),
    BigInt(cancelledView.event.depositWei),
  );
  await assert.rejects(() =>
    w.createDraft(cancelled, owners.a, { action: "cancel", params: {} }),
  );
  await assert.rejects(() =>
    w.createDraft(cancelled, people.alice, {
      action: "emergencyWithdraw",
      params: {},
    }),
  );
  const noList = await newEvent("no-attendance-list");
  await join(noList, "alice");
  await transact(noList, owners.a, "register");
  await assert.rejects(() =>
    w.createDraft(noList, people.alice, {
      action: "emergencyWithdraw",
      params: {},
    }),
  );
  const deadline = Number(await w.contract(noList).claimDeadline());
  const now = Number((await w.bootstrap()).now);
  await w.advance(deadline - now + 1);
  const recipientBefore = await w.provider.getBalance(people.carol.wallet);
  await transact(noList, people.alice, "emergencyWithdraw", {
    to: people.carol.wallet,
  });
  const final = await detail(noList);
  assert.equal(final.state.stakerCount, 0);
  assert.equal(BigInt(final.state.reservedWei), 0n);
  assert.equal(
    (await w.provider.getBalance(people.carol.wallet)) - recipientBefore,
    BigInt(final.event.depositWei),
  );
  await assert.rejects(() =>
    w.createDraft(noList, people.alice, {
      action: "emergencyWithdraw",
      params: {},
    }),
  );
});

test("a refusing contract wallet cannot block refunds and can recover its owed balance to an alternate address", async () => {
  const id = await newEvent("failed-transfer-recovery");
  const c = w.contract(id);
  const owner = await w.provider.getSigner(owners.a.wallet);
  const artifact = JSON.parse(
    await readFile(
      new URL("../references/kickback/build/TestWallet.json", import.meta.url),
      "utf8",
    ),
  );
  const wallet = await new ContractFactory(
    artifact.abi,
    artifact.bytecode,
    owner,
  ).deploy();
  await wallet.waitForDeployment();
  const d = await c.depositAmount();
  const address = await c.getAddress();
  await (
    await wallet.exec(address, c.interface.encodeFunctionData("deposit"), {
      value: d,
    })
  ).wait();
  // The v7 model deliberately trusts the owner to curate stakers. This direct contract fixture
  // exercises a smart wallet the demo login picker cannot impersonate.
  await (await c.connect(owner).registerStakers([wallet.target])).wait();
  await (await wallet.setMode(1)).wait();
  await transact(id, owners.a, "cancel");
  const failed = await detail(id);
  assert.equal(BigInt(failed.state.owedTotalWei), d);
  assert.equal(BigInt(failed.state.reservedWei), d);
  assert.equal(await c.owed(wallet.target), d);
  await assert.rejects(
    () =>
      w.createDraft(id, owners.a, {
        action: "refund",
        params: { to: owners.a.wallet, amountWei: String(d) },
      }),
    "owner cannot spend an owed refund",
  );
  const before = await w.provider.getBalance(people.carol.wallet);
  await (
    await wallet.exec(
      address,
      c.interface.encodeFunctionData("claim", [people.carol.wallet]),
    )
  ).wait();
  assert.equal((await w.provider.getBalance(people.carol.wallet)) - before, d);
  assert.equal(await c.owed(wallet.target), 0n);
  assert.equal(BigInt((await detail(id)).state.reservedWei), 0n);
  await assert.rejects(async () => {
    const tx = await wallet.exec(
      address,
      c.interface.encodeFunctionData("claim", [people.carol.wallet]),
    );
    await tx.wait();
  });
});

test("unmatched deposits are event scoped, reviewed as spare returns, and cannot consume registered principal", async () => {
  const id = await newEvent("unmatched-returns");
  await join(id, "alice");
  await transact(id, owners.a, "register");
  const c = w.contract(id),
    d = await c.depositAmount();
  const payer = await w.provider.getSigner(owners.b.wallet);
  const raw = await payer.sendTransaction({
    to: await c.getAddress(),
    value: 2n * d,
  });
  await raw.wait();
  const view = await detail(id);
  const unmatched = view.unmatched.find(
    (x) => x.wallet.toLowerCase() === owners.b.wallet.toLowerCase(),
  );
  assert.ok(unmatched);
  assert.equal(unmatched.eventId, id);
  assert.equal(unmatched.linked, false);
  assert.equal(unmatched.participantId, null);
  assert.equal(BigInt(unmatched.unallocatedWei), 2n * d);
  assert.ok(unmatched.transactions.some((x) => x.txHash === raw.hash));
  assert.ok(
    (await detail("event-b", owners.b)).deposits.every((x) =>
      x.transactions.every((tx) => tx.txHash !== raw.hash),
    ),
  );
  assert.equal(
    (await detail(id, people.alice)).deposits.length,
    0,
    "attendees cannot inspect the organizer deposit ledger",
  );
  await transact(id, owners.a, "refund", {
    to: owners.b.wallet,
    amountWei: String(2n * d),
  });
  const after = await detail(id);
  assert.equal(BigInt(after.state.reservedWei), d);
  assert.equal(BigInt(after.state.balanceWei), d);
  assert.ok(
    !after.unmatched.some(
      (x) => x.wallet.toLowerCase() === owners.b.wallet.toLowerCase(),
    ),
  );
  await assert.rejects(() =>
    w.createDraft(id, owners.a, {
      action: "refund",
      params: { to: owners.b.wallet, amountWei: String(d) },
    }),
  );
});

test("a checked-in registered guest can be rejected/refunded without blocking the remaining attendance list", async () => {
  const id = await newEvent("rejection-correction");
  for (const person of ["alice", "bob"]) await join(id, person);
  await transact(id, owners.a, "register");
  await w.advance(3601);
  for (const person of ["alice", "bob"]) await checkin(id, owners.a, person);
  await admit(id, owners.a, "bob", "declined");
  await transact(id, owners.a, "reject");
  assert.equal(await w.contract(id).status(people.bob.wallet), 3n);
  const posted = await transact(id, owners.a, "postAttendance");
  const final = await detail(id);
  assert.equal(final.state.attendeeCount, 1);
  assert.deepEqual(
    final.state.attendees.map((x) => x.toLowerCase()),
    [people.alice.wallet.toLowerCase()],
  );
  assert.equal(posted.draft.args[0].length, 1);
});

test("late ETH remains possible in v7 but the verifier refuses admission evidence and exposes an unmatched return", async () => {
  const id = await newEvent("late-deposit");
  await w.registerParticipant(id, people.alice, {
    name: "Synthetic Alice",
    email: "late@example.invalid",
  });
  await w.advance(3601);
  await assert.rejects(() =>
    w.createDraft(id, people.alice, { action: "deposit", params: {} }),
  );
  const c = w.contract(id),
    d = await c.depositAmount();
  const signer = await w.provider.getSigner(people.alice.wallet);
  const raw = await c.connect(signer).deposit({ value: d });
  await raw.wait();
  await assert.rejects(
    () => w.linkDeposit(id, people.alice, { txHash: raw.hash }),
    (e) => e.code === "OUTSIDE_DEPOSIT_WINDOW",
  );
  const view = await detail(id);
  assert.equal(view.state.stakerCount, 0);
  const unmatched = view.unmatched.find(
    (x) => x.wallet.toLowerCase() === people.alice.wallet.toLowerCase(),
  );
  assert.equal(BigInt(unmatched.unallocatedWei), d);
  await transact(id, owners.a, "refund", {
    to: people.alice.wallet,
    amountWei: String(d),
  });
  assert.equal(BigInt((await detail(id)).state.balanceWei), 0n);
});

test("a rejected participant can return with a fresh receipt while the refunded receipt remains unusable", async () => {
  const id = await newEvent("reentry-after-refund");
  await join(id, "alice");
  const old = participant(await detail(id), "alice").deposit.txHash;
  await transact(id, owners.a, "register");
  await admit(id, owners.a, "alice", "declined");
  await transact(id, owners.a, "reject");
  assert.equal(await w.contract(id).status(people.alice.wallet), 3n);
  await assert.rejects(
    () => w.linkDeposit(id, people.alice, { txHash: old }),
    (e) => e.code === "RETURNED_DEPOSIT",
  );
  const fresh = await transact(id, people.alice, "deposit");
  assert.notEqual(fresh.result.hash, old);
  await admit(id, owners.a, "alice", "approved");
  await transact(id, owners.a, "register");
  const final = await detail(id);
  assert.equal(final.state.stakerCount, 1);
  assert.equal(
    final.state.stakers.length,
    1,
    "historical duplicate staker entries must not duplicate active participants",
  );
  assert.equal(participant(final, "alice").deposit.txHash, fresh.result.hash);
});

test("private event pending and current financial owners can complete two-step ownership transfer", async () => {
  const id = await newEvent("private-ownership", owners.a, {
    visibility: "private",
  });
  await assert.rejects(() => w.detail(id, owners.b));
  await transact(id, owners.a, "transferOwnership", { to: owners.b.wallet });
  const pending = await detail(id, owners.b);
  assert.equal(
    pending.state.pendingOwner.toLowerCase(),
    owners.b.wallet.toLowerCase(),
  );
  await transact(id, owners.b, "acceptOwnership");
  const accepted = await detail(id, owners.b);
  assert.equal(accepted.permissions.owner, true);
  assert.equal(
    accepted.state.owner.toLowerCase(),
    owners.b.wallet.toLowerCase(),
  );
  await assert.rejects(() =>
    w.createDraft(id, owners.a, { action: "cancel", params: {} }),
  );
});

test("wallet confirmation rejects historical transactions, consumed hashes, expired review and changed admission", async () => {
  const id = await newEvent("wallet-confirmation");
  const p = await w.registerParticipant(id, people.alice, {
    name: "Synthetic Alice",
    email: "confirmation@example.invalid",
  });
  const c = w.contract(id),
    signer = await w.provider.getSigner(people.alice.wallet);
  const prior = await c
    .connect(signer)
    .deposit({ value: await c.depositAmount() });
  await prior.wait();
  const oldDraft = await w.createDraft(id, people.alice, {
    action: "deposit",
    params: {},
  });
  await assert.rejects(
    () => w.confirmDraft(id, people.alice, oldDraft.id, prior.hash),
    (e) => e.code === "TX_PREDATES_REVIEW",
  );
  const current = await signer.sendTransaction(oldDraft.transaction);
  await current.wait();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 301_000;
    await assert.rejects(
      () => w.confirmDraft(id, people.alice, oldDraft.id, current.hash),
      (e) => e.code === "STALE_DRAFT",
    );
  } finally {
    Date.now = realNow;
  }
  await w.admit(id, owners.a, p.id, "approved");
  await assert.rejects(
    () => w.confirmDraft(id, people.alice, oldDraft.id, current.hash),
    (e) => e.code === "STALE_DRAFT",
  );
  const reviewed = await w.createDraft(id, people.alice, {
    action: "deposit",
    params: {},
  });
  const sent = await signer.sendTransaction(reviewed.transaction);
  await sent.wait();
  const confirmed = await w.confirmDraft(
    id,
    people.alice,
    reviewed.id,
    sent.hash,
  );
  assert.equal(confirmed.status, "confirmed");
  await assert.rejects(() =>
    w.confirmDraft(id, people.alice, reviewed.id, sent.hash),
  );
});

test("guest import refuses duplicate financial evidence and does not overwrite a concurrent admission decision", async () => {
  const id = await newEvent("atomic-guest-import");
  for (const person of ["alice", "bob"]) await join(id, person);
  const initial = await detail(id),
    alice = participant(initial, "alice"),
    bob = participant(initial, "bob");
  const review = {
    confirmed: true,
    note: "Reviewed synthetic guest export at the selected event.",
  };
  const duplicate = `participant_id,email,wallet,tx_hash,admission\n${alice.id},${alice.email},${alice.wallet},${alice.deposit.txHash},approved\n${bob.id},${bob.email},${bob.wallet},${alice.deposit.txHash},approved\n`;
  await assert.rejects(
    () => w.importCsv(id, owners.a, { kind: "guests", csv: duplicate, review }),
    (e) => e.code === "DUPLICATE_EVIDENCE",
  );
  assert.equal((await detail(id)).imports.length, 0);
  await w.admit(id, owners.a, alice.id, "pending");
  const csv = `participant_id,email,wallet,tx_hash,admission\n${alice.id},${alice.email},${alice.wallet},${alice.deposit.txHash},approved\n`;
  const original = w.verifyReceipt;
  let changed = false;
  w.verifyReceipt = async (...args) => {
    const result = await original(...args);
    if (!changed) {
      changed = true;
      await w.admit(id, owners.a, alice.id, "declined");
    }
    return result;
  };
  try {
    await assert.rejects(
      () => w.importCsv(id, owners.a, { kind: "guests", csv, review }),
      (e) => e.code === "STALE_IMPORT",
    );
  } finally {
    w.verifyReceipt = original;
  }
  const final = await detail(id);
  assert.equal(
    participant(final, "alice").admission,
    "declined",
    "the concurrent organizer decision must remain intact",
  );
  assert.equal(
    final.imports.length,
    0,
    "a stale import must not create a partially committed batch",
  );
});

test("per-event metaevidence retains policy linkage, participant aliases and exact-byte retryable local publication", async () => {
  const a = await detail("event-a");
  const [content, uri] = await w
    .contract("event-a")
    .caseMetaEvidence(people.bob.wallet);
  const metadata = JSON.parse(content);
  assert.ok(metadata.title.includes(a.event.title));
  assert.ok(metadata.question.includes(people.bob.wallet));
  assert.equal(metadata.fileURI, a.event.policyURI);
  assert.ok(metadata.aliases[people.bob.wallet.toLowerCase()]);
  assert.ok(metadata.aliases[owners.a.wallet.toLowerCase()]);
  assert.deepEqual(metadata.rulingOptions.titles, [
    "Attended",
    "Did not attend",
  ]);
  assert.ok(!content.includes("Truth Pays"));
  const first = await w.publish("event-a", people.bob, people.bob.wallet);
  const retry = await w.publish("event-a", people.bob, people.bob.wallet);
  assert.equal(first.uri, uri);
  assert.equal(first.content, content);
  assert.equal(retry.content, content);
  assert.equal(retry.sha256, first.sha256);
  assert.equal(
    retry.status,
    "local-only",
    "local storage must never be represented as remote IPFS availability",
  );
});
