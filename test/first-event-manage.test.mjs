// Actual local V10 factory/controller/proxies/state store. Only public Court code is mocked.
// Synthetic Ganache signers send on this isolated provider; the backend remains unable to sign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";

const D = ethers.parseEther("0.000001");
const note = "Reviewed this wallet's original canonical deposit for this synthetic event.";
const attendanceNote = "I personally reviewed the selected wallets' presence during this event's immutable interval.";
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

test("first-event owner adoption and manual attendance retain actual V10 financial reviews", { timeout: 180000 }, async t => {
  const managed = new Map();
  const f = await createV10AppFixture({ origin: "https://first-event-manage.example.invalid",
    firstEventManageScope: record => managed.get(record.definition.id)?.toLowerCase() === record.deployment.contract.toLowerCase() });
  t.after(() => f.close());
  let w = f.workbench();
  const [payer, organizer, partialPayer] = await Promise.all([0, 1, 2].map(i => f.provider.getSigner(i)));
  const payerWallet = await payer.getAddress(), partialWallet = await partialPayer.getAddress();
  const ownerSession = { id: "synthetic-manage-owner", mode: "wallet", wallet: f.organizerAddress };
  const wrongOwner = { id: "synthetic-manage-controller-only", mode: "wallet", wallet: payerWallet };
  const now = (await f.provider.getBlock("latest")).timestamp;
  const startsAt = new Date((now + 3600) * 1000).toISOString();
  const endsAt = new Date((now + 7200) * 1000).toISOString();
  async function createEvent(label) {
    const draft = await w.createFactoryDraft(ownerSession, {
      title: `Synthetic first-event manage ${label}`, lumaUrl: `https://luma.com/synthetic-first-event-${label}`,
      startsAt, endsAt, timezone: "UTC", depositEth: ethers.formatEther(D),
    });
    await w.validateFactoryDraft(ownerSession, draft.id);
    const sent = await f.sendSyntheticTransaction(1, draft.transaction); await sent.wait();
    await w.recordFactorySubmitted(ownerSession, draft.id, sent.hash);
    const result = await w.reconcileFactorySubmission(ownerSession, draft.id, sent.hash);
    assert.equal(result.status, "confirmed");
    return { id: draft.eventId, contract: result.contract, creationHash: sent.hash };
  }
  const event = await createEvent("a"), other = await createEvent("b");
  managed.set(event.id, event.contract);
  const r = w.events.get(event.id), c = w.contract(event.id);
  const originalBalance = await f.provider.getBalance(event.contract);
  const first = await f.sendSyntheticTransaction(0, { to: event.contract, value: D }); await first.wait();
  const partial = await f.sendSyntheticTransaction(2, { to: event.contract, value: D / 2n }); await partial.wait();
  const adoption = (wallet = payerWallet, txHash = first.hash, extra = {}) => ({ wallet, txHash, confirmed: true, note, ...extra });
  const people = () => [...r.participants.values()];
  const personFor = wallet => people().find(p => same(p.wallet, wallet));

  await t.test("owner review discovers canonical plain transfers without creating contact identity or moving funds", async () => {
    assert.equal(typeof w.adoptPayer, "function");
    assert.equal(people().length, 0);
    const ownerNonce = await f.provider.getTransactionCount(f.organizerAddress);
    const before = await f.provider.getBalance(event.contract), credit = await c.pendingDeposits(payerWallet);
    await w.adoptPayer(event.id, ownerSession, adoption());
    const person = personFor(payerWallet);
    assert(person);
    assert.equal(person.name, null); assert.equal(person.email, null);
    assert.equal(person.identityVerified, false); assert.equal(person.walletVerified, false);
    assert.equal(person.payerVerified, true);
    assert.equal(person.identitySource, "owner-reviewed-canonical-payer");
    assert.equal(person.admission, "pending");
    assert.equal(person.deposit.verified, true); assert.equal(person.deposit.txHash, first.hash);
    assert.equal(person.deposit.wallet, payerWallet); assert.equal(person.deposit.eventId, event.id);
    assert.equal(await c.pendingDeposits(payerWallet), credit);
    assert.equal(await c.status(payerWallet), 0n);
    assert.equal(await f.provider.getBalance(event.contract), before);
    assert.equal(await f.provider.getTransactionCount(f.organizerAddress), ownerNonce);
    assert.equal(f.stats.backendSigningCalls, 0);
    assert(before > originalBalance);
  });

  await t.test("adoption is idempotent but never accepts another owner, event, payer, receipt, or underfunded credit", async () => {
    const personId = personFor(payerWallet).id, revision = r.revision;
    await w.adoptPayer(event.id, ownerSession, adoption());
    assert.equal(personFor(payerWallet).id, personId); assert.equal(r.revision, revision);
    assert.equal(people().length, 1);
    await assert.rejects(w.adoptPayer(event.id, wrongOwner, adoption()), { code: "NOT_OWNER" });
    await assert.rejects(w.adoptPayer(other.id, ownerSession, adoption()));
    await assert.rejects(w.adoptPayer(event.id, ownerSession, adoption(payerWallet, partial.hash)));
    await assert.rejects(w.adoptPayer(event.id, ownerSession, adoption(partialWallet, partial.hash)));
    await assert.rejects(w.adoptPayer(event.id, ownerSession, adoption(payerWallet, event.creationHash)));
    await assert.rejects(w.adoptPayer(event.id, ownerSession, adoption(payerWallet, first.hash, { confirmed: false })));
    await assert.rejects(w.adoptPayer(event.id, ownerSession, adoption(payerWallet, first.hash, { note: "short" })));
    assert.equal(people().length, 1);
    const topup = await f.sendSyntheticTransaction(2, { to: event.contract, value: D / 2n }); await topup.wait();
    await w.adoptPayer(event.id, ownerSession, adoption(partialWallet, partial.hash));
    assert.equal(personFor(partialWallet).identityVerified, false);
    assert.equal(personFor(partialWallet).deposit.txHash, partial.hash);
    await assert.rejects(w.adoptPayer(event.id, ownerSession, adoption(partialWallet, topup.hash)),
      "An existing original receipt must not be silently replaced");
    assert.equal(personFor(partialWallet).deposit.txHash, partial.hash);
  });

  await t.test("returned credit cannot become a paid admission", async () => {
    const original = await f.sendSyntheticTransaction(1, { to: event.contract, value: D }); await original.wait();
    await w.adoptPayer(event.id, ownerSession, adoption(f.organizerAddress, original.hash));
    const person = personFor(f.organizerAddress);
    const returned = await f.sendSyntheticTransaction(1, { to: event.contract,
      data: c.interface.encodeFunctionData("withdrawPending", [f.organizerAddress, D]) }); await returned.wait();
    assert.equal(await c.pendingDeposits(f.organizerAddress), 0n);
    await assert.rejects(w.adoptPayer(event.id, ownerSession, adoption(f.organizerAddress, original.hash)));
    await w.admit(event.id, ownerSession, person.id, "approved");
    await assert.rejects(w.createDraft(event.id, ownerSession, { action: "register", params: { wallets: [f.organizerAddress] } }));
    assert.equal(person.deposit.txHash, original.hash);
    assert.equal(await c.status(f.organizerAddress), 0n);
  });

  await t.test("late record or authenticated-session changes cannot save a stale payer review", async () => {
    const verify = w.verifyReceipt, person = personFor(payerWallet), before = structuredClone(person);
    let changed = false;
    w.verifyReceipt = async (...args) => {
      const evidence = await verify(...args);
      if (!changed && args[0] === event.id) { changed = true; r.revision++; }
      return evidence;
    };
    try {
      await assert.rejects(w.adoptPayer(event.id, ownerSession, adoption()), { code: "STALE_MANAGE_REVIEW" });
      assert.equal(changed, true);
      assert.deepEqual(personFor(payerWallet), before);
    } finally { w.verifyReceipt = verify; }
    await assert.rejects(w.adoptPayer(event.id, ownerSession, adoption(), () => {
      throw Object.assign(new Error("Synthetic session expired before save"), { code: "UNAUTHENTICATED" });
    }), { code: "UNAUTHENTICATED" });
    assert.deepEqual(personFor(payerWallet), before);
  });

  await t.test("manual attendance requires actual registered wallets and cannot run before the immutable event ends", async () => {
    const params = { attendedWallets: [payerWallet], attendanceReview: { confirmed: true, note: attendanceNote } };
    await assert.rejects(w.createDraft(event.id, ownerSession, { action: "postAttendance", params }));
    await w.admit(event.id, ownerSession, personFor(payerWallet).id, "approved");
    await w.admit(event.id, ownerSession, personFor(partialWallet).id, "approved");
    const prepared = await w.createDraft(event.id, ownerSession, { action: "register", params: { wallets: [payerWallet, partialWallet] } });
    assert.equal(prepared.action, "register"); assert.deepEqual(prepared.args[0], [payerWallet, partialWallet]);
    assert.equal(prepared.valueWei, "0"); assert.equal(await c.status(payerWallet), 0n);
    await w.validateDraft(event.id, ownerSession, prepared.id);
    const sent = await f.sendSyntheticTransaction(1, prepared.transaction); await sent.wait();
    await w.recordSubmitted(event.id, ownerSession, prepared.id, sent.hash);
    assert.equal((await w.reconcileSubmission(event.id, ownerSession, prepared.id, sent.hash)).status, "confirmed");
    assert.equal(await c.status(payerWallet), 1n);
    await assert.rejects(w.createDraft(event.id, ownerSession, { action: "postAttendance", params }));
    const latest = await f.provider.getBlock("latest");
    await f.provider.send("evm_increaseTime", [Math.max(1, Math.ceil(Date.parse(endsAt) / 1000) + 1 - latest.timestamp)]);
    await f.provider.send("evm_mine", []);
    await assert.rejects(w.createDraft(event.id, ownerSession, { action: "postAttendance",
      params: { attendedWallets: [f.organizerAddress], attendanceReview: { confirmed: true, note: attendanceNote } } }));
    await assert.rejects(w.createDraft(event.id, ownerSession, { action: "postAttendance",
      params: { attendedWallets: [payerWallet, payerWallet], attendanceReview: { confirmed: true, note: attendanceNote } } }));
    await assert.rejects(w.createDraft(event.id, ownerSession, { action: "postAttendance",
      params: { attendedWallets: [payerWallet], attendanceReview: { confirmed: false, note: attendanceNote } } }));
    await assert.rejects(w.createDraft(event.id, ownerSession, { action: "postAttendance",
      params: { attendedWallets: [payerWallet], attendanceReview: { confirmed: true, note: attendanceNote,
        attestedAt: Date.parse(startsAt) } } }), "Callers cannot supply a backdated attestation timestamp");
    await assert.rejects(w.createDraft(event.id, wrongOwner, { action: "postAttendance", params }), { code: "NOT_OWNER" });
  });

  await t.test("an owner-attested attendance review is sealed now without fabricated door check-in and remains unsigned until approval", async () => {
    const beforeNonce = await f.provider.getTransactionCount(f.organizerAddress), beforeBalance = await f.provider.getBalance(event.contract);
    const realReviewStart = Date.now();
    const proposed = await w.createDraft(event.id, ownerSession, { action: "postAttendance", params: {
      attendedWallets: [payerWallet], attendanceReview: { confirmed: true, note: attendanceNote },
    } });
    assert.deepEqual(proposed.args[0], [payerWallet]); assert.equal(proposed.args[1], (2n * D).toString());
    assert.deepEqual(proposed.params.attendedWallets, [payerWallet]);
    assert.equal(proposed.params.attendanceReview.confirmed, true);
    assert.equal(proposed.params.attendanceReview.note, attendanceNote);
    assert(proposed.params.attendanceReview.attestedAt >= realReviewStart && proposed.params.attendanceReview.attestedAt <= Date.now());
    assert.equal(proposed.params.attendanceReview.actorWallet, f.organizerAddress);
    assert.deepEqual(proposed.params.attendanceReview.interval, { startsAt, endsAt, timezone: "UTC" });
    assert(proposed.createdAt >= realReviewStart && proposed.createdAt <= Date.now()); assert(proposed.v10Intent);
    assert.equal(r.observations.length, 0, "Historical manual approval must not fabricate staff-door observations");
    assert.equal(await c.phase(), 0n); assert.equal(await c.attended(payerWallet), false);
    assert.equal(await f.provider.getTransactionCount(f.organizerAddress), beforeNonce);
    assert.equal(await f.provider.getBalance(event.contract), beforeBalance);
    await w.validateDraft(event.id, ownerSession, proposed.id);
    const sent = await f.sendSyntheticTransaction(1, proposed.transaction); await sent.wait();
    await w.recordSubmitted(event.id, ownerSession, proposed.id, sent.hash);
    const result = await w.reconcileSubmission(event.id, ownerSession, proposed.id, sent.hash);
    assert.equal(result.status, "confirmed"); assert.equal(result.hash, sent.hash);
    assert.equal(await c.phase(), 1n); assert.equal(await c.attended(payerWallet), true);
    assert.equal(await c.attended(partialWallet), false);
    assert.equal(await c.status(partialWallet), 1n, "An omitted registered wallet retains its contract status and challenge rights");
    assert.equal(r.observations.length, 0);
    assert.equal(await f.provider.getBalance(event.contract), beforeBalance, "Posting attendance does not release payouts");
    assert.equal(f.stats.backendSigningCalls, 0);
    const state = f.savedState();
    const savedDraft = state.drafts.find(([id]) => id === proposed.id)[1];
    assert.deepEqual(savedDraft.params.attendedWallets, [payerWallet]);
    assert.equal(savedDraft.submittedHash, sent.hash); assert.equal(savedDraft.confirmedHash, sent.hash);
    await f.restart(); w = f.workbench();
    const retained = [...w.events.get(event.id).participants.values()].find(p => same(p.wallet, payerWallet));
    assert.equal(retained.id, personFor(payerWallet).id); assert.equal(retained.payerVerified, true);
    assert.equal(retained.identityVerified, false); assert.equal(retained.deposit.txHash, first.hash);
    assert.equal((await w.reconcileSubmission(event.id, ownerSession, proposed.id, sent.hash)).status, "confirmed");
  });
});
