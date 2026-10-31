// Actual isolated V10 contracts/store. Public transaction actors are trusted adapter capabilities,
// never login sessions. No HTTP public-flow service or alternative endpoint is implemented here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";

const lower = value => String(value).toLowerCase();
const unknownHash = ethers.id("synthetic-public-actor-absent-original");

test("actual V10 public actors preserve transaction proof without granting login or organizer authority", { timeout: 180000 }, async t => {
  const managed = new Map();
  const f = await createV10AppFixture({ origin: "https://public-transaction-actor.example.invalid",
    firstEventManageScope: r => !!r && managed.get(r.definition.id)?.toLowerCase() === r.deployment.contract.toLowerCase() });
  t.after(() => f.close());
  const w = f.workbench(), ownerWallet = f.organizerAddress;
  const guestWallet = await (await f.provider.getSigner(0)).getAddress();
  const ownerActor = w.createPublicTransactionActor(ownerWallet, "synthetic-public-create-a", "create");
  let creationDraft, created, fakeActor, fakeDraft, depositActor, depositDraft, depositHash;
  function globalSubmitted() {
    const saved = f.savedState();
    return {
      drafts: (saved?.drafts ?? []).filter(([, d]) => d.submittedHash || d.confirmedHash),
      transactions: (saved?.events ?? []).flatMap(r => r.transactions ?? []),
    };
  }
  const canonicalPerson = wallet => [...w.events.get(created.eventId).participants.values()]
    .find(p => lower(p.wallet) === lower(wallet));

  await t.test("factory-only public actor has no contacts, signature, login cookie or organizer inventory", async () => {
    const target = w.publicTransactionTarget("create");
    assert.equal(target.contract, f.manifest.factoryDeployment.factory);
    const factory = await w.bootstrap(ownerActor, { factoryOnly: true });
    assert.deepEqual(factory.events, []); assert.deepEqual(factory.recoveryEvents, []);
    assert.equal(factory.factory.verified, true); assert.equal(w.events.size, 0);
    assert.equal((await w.bootstrap(null)).session, null);
    const normal = await f.forward("/api/bootstrap"), data = JSON.parse(normal.body.toString());
    assert.equal(normal.status, 200, normal.body.toString());
    assert.equal(normal.headers["set-cookie"], undefined); assert.equal(data.session ?? null, null);
    assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
    const now = (await f.provider.getBlock("latest")).timestamp;
    creationDraft = await w.createFactoryDraft(ownerActor, {
      title: "Synthetic public actor event", lumaUrl: "https://luma.com/synthetic-public-actor",
      startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(),
      timezone: "UTC", depositEth: "0.000001",
    });
    assert.equal(creationDraft.action, "createEvent"); assert.equal(creationDraft.wallet, ownerWallet);
    assert.equal(creationDraft.contractVersion, "kleros-event-v10-uups"); assert(creationDraft.v10Intent);
    assert.equal(globalSubmitted().drafts.length, 0);
    const foreign = w.createPublicTransactionActor(ownerWallet, "synthetic-public-create-b", "create");
    await assert.rejects(w.publicTransactionSubmitted(foreign, creationDraft.id, unknownHash), { code: "PUBLIC_FLOW_SCOPE" });
    await assert.rejects(w.publicTransactionSubmitted({ ...ownerActor }, creationDraft.id, unknownHash), { code: "PUBLIC_FLOW_SCOPE" });
  });

  await t.test("actual signed creation uses the original factory review, submission witness and canonical adoption", async () => {
    const validated = await w.validateFactoryDraft(ownerActor, creationDraft.id);
    assert.deepEqual(validated.transaction, creationDraft.transaction);
    const sent = await f.sendSyntheticTransaction(1, creationDraft.transaction); await sent.wait();
    await w.publicTransactionSubmitted(ownerActor, creationDraft.id, sent.hash);
    created = await w.reconcilePublicTransaction(ownerActor, creationDraft.id, sent.hash);
    assert.equal(created.status, "confirmed"); assert.equal(created.hash, sent.hash);
    assert.equal(created.eventId, creationDraft.eventId); assert(ethers.isAddress(created.contract));
    managed.set(created.eventId, created.contract);
    const saved = f.savedState().drafts.find(([id]) => id === creationDraft.id)[1];
    assert.equal(saved.submittedHash, sent.hash); assert.equal(saved.confirmedHash, sent.hash);
    assert(saved.submissionWitness); assert(saved.v10Submission);
    const creationReferences = globalSubmitted().drafts.length;
    const repeated = await w.reconcilePublicTransaction(ownerActor, creationDraft.id, sent.hash);
    assert.equal(repeated.status, "confirmed"); assert.equal(repeated.hash, sent.hash);
    assert.equal(globalSubmitted().drafts.length, creationReferences);
    assert.equal(w.events.get(created.eventId).participants.size, 0);
    const normal = JSON.parse((await f.forward("/api/bootstrap")).body.toString());
    assert.equal(normal.session, null); assert(normal.events.every(row => row.role === "participant"));
  });

  await t.test("even the actual event owner cannot use a public actor for private, admission, staff or other financial work", async () => {
    await assert.rejects(w.owner(created.eventId, ownerActor), { code: "PUBLIC_FLOW_SCOPE" });
    await assert.rejects(w.admit(created.eventId, ownerActor, "unknown", "approved"), { code: "PUBLIC_FLOW_SCOPE" });
    await assert.rejects(w.checkin(created.eventId, ownerActor, { participantId: "unknown", nonce: "synthetic-nonce", source: "staff-door", note: "Synthetic evidence" }),
      { code: "PUBLIC_FLOW_SCOPE" });
    await assert.rejects(w.createDraft(created.eventId, ownerActor, { action: "cancel", params: {} }), { code: "PUBLIC_FLOW_SCOPE" });
    fakeActor = w.createPublicTransactionActor(guestWallet, "synthetic-public-deposit-fake", "deposit");
    const r = w.events.get(created.eventId), before = structuredClone([...r.participants]);
    const ownerDepositActor = w.createPublicTransactionActor(ownerWallet, "synthetic-public-owner-claimed-deposit", "deposit");
    const ownerDeposit = await w.createDepositReview(created.eventId, ownerDepositActor);
    for (const event of [ownerDeposit.depositReview.events[0], ownerDeposit.depositReview.selectedEvent.detail.event]) {
      assert.equal(event.role, "participant");
      for (const key of ["organizers", "staff", "permissions", "participants", "admission", "email", "name"])
        assert.equal(Object.hasOwn(event, key), false, `A claimed owner address must not disclose ${key}`);
    }
    r.definition.visibility = "private";
    try {
      assert.throws(() => w.publicTransactionTarget("deposit"), { code: "PUBLIC_FLOW_SCOPE" });
      await assert.rejects(w.createDepositReview(created.eventId, fakeActor));
      assert.deepEqual([...r.participants], before);
    } finally { r.definition.visibility = "public"; }
    await assert.rejects(w.createDepositReview("another-event", fakeActor));
    await assert.rejects(w.createDraft(created.eventId, fakeActor, { action: "register", params: {} }), { code: "PUBLIC_FLOW_SCOPE" });
  });

  await t.test("an absent original hash stays flow-local without signed identity or a global pending lock", async () => {
    fakeDraft = await w.createDepositReview(created.eventId, fakeActor);
    assert.equal(fakeDraft.action, "deposit"); assert(fakeDraft.v10Intent);
    assert.equal(fakeDraft.transaction.data, "0xd0e30db0"); assert.equal(fakeDraft.valueWei, "1000000000000");
    assert.equal(fakeDraft.depositReview.events[0].role, "participant");
    for (const event of [fakeDraft.depositReview.events[0], fakeDraft.depositReview.selectedEvent.detail.event])
      for (const key of ["organizers", "staff", "permissions", "participants", "admission", "email", "name"])
        assert.equal(Object.hasOwn(event, key), false, `The public actor must not disclose ${key}`);
    assert.equal(canonicalPerson(guestWallet), undefined, "A public address and unsigned draft are not a verified participant");
    const before = globalSubmitted();
    const response = await w.publicTransactionSubmitted(fakeActor, fakeDraft.id, unknownHash);
    assert.equal(response.status, "pending"); assert.equal(response.hash, unknownHash);
    assert.deepEqual(globalSubmitted(), before);
    assert.equal(canonicalPerson(guestWallet), undefined);
    const saved = f.savedState().drafts.find(([id]) => id === fakeDraft.id)[1];
    assert.equal(saved.publicFlowHash, unknownHash); assert.equal(saved.submittedHash, undefined);
    await assert.rejects(w.publicTransactionSubmitted(fakeActor, fakeDraft.id, ethers.id("different-absent-public-hash")),
      { code: "PUBLIC_FLOW_CONFLICT" });
    depositActor = w.createPublicTransactionActor(guestWallet, "synthetic-public-deposit-actual", "deposit");
    depositDraft = await w.createDepositReview(created.eventId, depositActor);
    assert.equal(depositDraft.valueWei, fakeDraft.valueWei, "A fake hash cannot globally block a fresh review for this wallet");
  });

  await t.test("visible transactions from another wallet or another call fail before global submission promotion", async () => {
    const rejectedActor = w.createPublicTransactionActor(guestWallet, "synthetic-public-deposit-mismatch", "deposit");
    const reviewed = await w.createDepositReview(created.eventId, rejectedActor), before = globalSubmitted();
    await assert.rejects(w.publicTransactionSubmitted(rejectedActor, reviewed.id, created.hash));
    assert.deepEqual(globalSubmitted(), before);
    assert.equal(canonicalPerson(guestWallet), undefined);
    await assert.rejects(w.publicTransactionSubmitted(fakeActor, depositDraft.id, unknownHash), { code: "PUBLIC_FLOW_SCOPE" });
    const wallet = await (await f.provider.getSigner(2)).getAddress(), unsupported = w.createPublicTransactionActor(wallet, "synthetic-public-deposit-unsupported", "deposit");
    const originalCode = await f.provider.getCode(wallet);
    await f.provider.send("evm_setAccountCode", [wallet, "0x00"]);
    try { await assert.rejects(w.createDepositReview(created.eventId, unsupported), { code: "UNSUPPORTED_WALLET" }); }
    finally { await f.provider.send("evm_setAccountCode", [wallet, originalCode]); }
  });

  await t.test("actual canonical deposit alone establishes chain-evidence payer attribution and retains the unchanged original journal", async () => {
    const validated = await w.validateDraft(created.eventId, depositActor, depositDraft.id);
    assert.deepEqual(validated.d.transaction, depositDraft.transaction);
    const before = await f.provider.getBalance(created.contract), D = BigInt(depositDraft.valueWei);
    const sent = await f.sendSyntheticTransaction(0, depositDraft.transaction); await sent.wait(); depositHash = sent.hash;
    await w.publicTransactionSubmitted(depositActor, depositDraft.id, sent.hash);
    assert.equal(canonicalPerson(guestWallet), undefined, "A submitted hash is not canonical receipt attribution yet");
    const result = await w.reconcilePublicTransaction(depositActor, depositDraft.id, sent.hash);
    assert.equal(result.status, "confirmed"); assert.equal(result.hash, sent.hash);
    assert.equal(result.eventId, created.eventId); assert.equal(result.chainId, 1);
    assert.equal(lower(result.wallet), lower(guestWallet));
    assert.equal(await f.provider.getBalance(created.contract), before + D);
    assert.equal(await w.contract(created.eventId).pendingDeposits(guestWallet), D);
    const person = canonicalPerson(guestWallet);
    assert(person); assert.equal(person.walletVerified, true); assert.equal(person.identityVerified, false);
    assert.equal(person.identitySource, "signed-transaction-receipt"); assert.equal(person.name, null); assert.equal(person.email, null);
    assert.equal(person.deposit.txHash, sent.hash); assert.equal(person.deposit.verified, true);
    const saved = f.savedState().drafts.find(([id]) => id === depositDraft.id)[1];
    assert.equal(saved.submittedHash, sent.hash); assert.equal(saved.confirmedHash, sent.hash);
    assert.equal(saved.publicFlowHash, sent.hash);
    assert.equal(globalSubmitted().transactions.some(tx => tx.hash === unknownHash), false);
    const originalHashes = globalSubmitted().transactions.map(tx => tx.hash);
    const repeated = await w.reconcilePublicTransaction(depositActor, depositDraft.id, sent.hash);
    assert.equal(repeated.status, "confirmed"); assert.equal(repeated.hash, sent.hash);
    assert.deepEqual(globalSubmitted().transactions.map(tx => tx.hash), originalHashes);
    assert.equal(canonicalPerson(guestWallet).deposit.txHash, sent.hash);
    await assert.rejects(w.publicTransactionSubmitted(depositActor, depositDraft.id, unknownHash), { code: "PUBLIC_FLOW_CONFLICT" });
    assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
  });

  await t.test("the separate original signed-login session still supplies owner authority and cannot inherit public actor state", async () => {
    const before = JSON.parse((await f.forward("/api/bootstrap")).body.toString());
    assert.equal(before.session, null);
    const challengeResponse = await f.forward("/api/auth/challenge", { method: "POST", body: JSON.stringify({ wallet: ownerWallet }) });
    assert.equal(challengeResponse.status, 200);
    const challenge = JSON.parse(challengeResponse.body.toString());
    const signature = await f.wallet({ method: "personal_sign", params: [ethers.hexlify(ethers.toUtf8Bytes(challenge.message)), ownerWallet] }, f.origin + "/");
    const verified = await f.forward("/api/auth/verify", { method: "POST", body: JSON.stringify({ nonce: challenge.nonce, signature }) });
    assert.equal(verified.status, 200); const cookie = verified.headers["set-cookie"][0].split(";")[0];
    const detail = await f.forward(`/api/events/${created.eventId}`, { headers: { cookie } });
    assert.equal(detail.status, 200); const value = JSON.parse(detail.body.toString());
    assert.equal(value.permissions.owner, true); assert.equal(value.event.role, "organizer");
    assert.equal(value.participants.find(p => lower(p.wallet) === lower(guestWallet)).deposit.txHash, depositHash);
    const other = JSON.parse((await f.forward("/api/bootstrap")).body.toString());
    assert.equal(other.session, null); assert(other.events.every(row => row.role === "participant"));
    assert.equal(f.stats.authSignatures, 1); assert.equal(f.stats.backendSigningCalls, 0);
  });
});
