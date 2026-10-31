// Signature-free public transaction transport against actual isolated V10 contracts and store.
// Only Court code is mocked. Local synthetic Wallets sign; the backend cannot sign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";
import { createPublicTransactionService } from "../src/public-transactions.mjs";

const BASE = "/api/public-transactions";
const lower = value => String(value).toLowerCase();
const unknownHash = ethers.id("synthetic-public-flow-unknown-hash");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test("opaque public transaction flows retain actual V10 proof, scope and no-login boundaries", { timeout: 180000 }, async t => {
  const managed = new Map();
  const f = await createV10AppFixture({ origin: "https://public-transaction-flow.example.invalid",
    firstEventManageScope: record => !!record && managed.get(record.definition.id)?.toLowerCase() === record.deployment.contract.toLowerCase() });
  t.after(() => f.close());
  const w = f.workbench(), [guest] = await Promise.all([f.provider.getSigner(0)]), guestWallet = await guest.getAddress();
  const ownerWallet = f.organizerAddress;
  async function request(path, payload, method = payload === undefined ? "GET" : "POST") {
    const response = await f.forward(path, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    let data;
    try { data = JSON.parse(response.body.toString("utf8")); } catch {}
    assert.equal(response.headers["set-cookie"], undefined, "Public transaction requests must never establish a normal session");
    return { ...response, data };
  }
  async function mint(wallet, kind) {
    const started = Date.now(), response = await request(BASE, { wallet, kind });
    assert.equal(response.status, 201, response.body.toString());
    assert.match(response.data.token, /^[a-f0-9]{64}$/);
    assert(response.data.expiresAt >= started + 30 * 60_000 - 1000 && response.data.expiresAt <= Date.now() + 30 * 60_000);
    assert.equal(response.data.wallet.toLowerCase(), wallet.toLowerCase());
    assert.equal(response.data.kind, "public-transaction-flow");
    assert.equal(response.data.flowKind, kind);
    return response.data.token;
  }
  async function job(token, family, input, expectedState = "ready") {
    const requestId = randomUUID(), route = `${BASE}/${token}/${family}`;
    const started = await request(route, { requestId, ...input });
    assert.equal(started.status, 202, started.body.toString());
    for (let attempt = 0; attempt < 400; attempt++) {
      const response = await request(`${route}/${requestId}`);
      assert.equal(response.status, 200, response.body.toString());
      if (response.data.state !== "pending") {
        assert.equal(response.data.state, expectedState, response.body.toString());
        return expectedState === "ready" ? response.data.result : response.data;
      }
      await sleep(25);
    }
    assert.fail("The actual local public transaction job did not complete");
  }
  let createToken, otherCreateToken, creationDraft, created, depositToken, depositDraft, originalDeposit;
  const submittedReferences = () => {
    const saved = f.savedState();
    return {
      drafts: (saved?.drafts ?? []).filter(([, draft]) => draft.submittedHash || draft.confirmedHash),
      transactions: (saved?.events ?? []).flatMap(record => record.transactions ?? []),
    };
  };

  await t.test("minting has exact inputs, high-entropy tokens and no signature, cookie or account authority", async () => {
    for (const payload of [null, {}, { wallet: guestWallet }, { wallet: guestWallet, kind: "owner" },
      { wallet: "invalid", kind: "deposit" }, { wallet: ethers.ZeroAddress, kind: "deposit" },
      { wallet: guestWallet, kind: "deposit", eventId: "foreign" }, { wallet: guestWallet, kind: "create", authenticated: true }]) {
      const response = await request(BASE, payload);
      assert(response.status >= 400, response.body.toString());
    }
    createToken = await mint(ownerWallet, "create");
    otherCreateToken = await mint(ownerWallet, "create");
    assert.notEqual(otherCreateToken, createToken);
    const reads = f.stats.providerReads, metadata = await request(`${BASE}/${createToken}`);
    assert.equal(metadata.status, 200); assert.equal(metadata.data.token, createToken);
    assert.equal(metadata.data.flowKind, "create"); assert.equal(f.stats.providerReads, reads, "Reading token metadata must perform no RPC");
    const normal = await request("/api/bootstrap");
    assert.equal(normal.status, 200); assert.equal(normal.data.session, null);
    assert.equal(normal.data.identities.length, 0);
    assert.equal(w.events.size, 0); assert.equal(submittedReferences().drafts.length, 0);
    assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
    const nonexistent = await request(`${BASE}/${"0".repeat(64)}/event-read-jobs/synthetic-request`);
    assert.equal(nonexistent.status, 404);
  });

  await t.test("create flow sees only public factory context and the exact original unsigned creation review", async () => {
    const factory = await job(createToken, "event-read-jobs", { operation: "bootstrap", selectedEventId: null, factoryOnly: true });
    assert.equal(factory.factory.verified, true); assert.deepEqual(factory.events, []);
    assert.equal(factory.selectedEvent, undefined);
    const cross = await request(`${BASE}/${createToken}/event-read-jobs`,
      { requestId: randomUUID(), operation: "bootstrap", selectedEventId: "private-event", factoryOnly: true });
    assert(cross.status >= 400, cross.body.toString());
    const deposit = await request(`${BASE}/${createToken}/event-read-jobs`,
      { requestId: randomUUID(), operation: "deposit", eventId: "private-event" });
    assert(deposit.status >= 400, deposit.body.toString());
    const now = (await f.provider.getBlock("latest")).timestamp;
    creationDraft = await job(createToken, "organizer-jobs", { operation: "prepare", input: {
      title: "Synthetic signature-free public event", lumaUrl: "https://luma.com/synthetic-public-transaction",
      startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(),
      timezone: "UTC", depositEth: "0.000001",
    } });
    assert.equal(creationDraft.wallet, ownerWallet); assert.equal(creationDraft.action, "createEvent");
    assert.equal(creationDraft.valueWei, "0"); assert.equal(creationDraft.contractVersion, "kleros-event-v10-uups");
    assert(creationDraft.v10Intent); assert.equal(w.events.size, 0);
    const crossFlow = await request(`${BASE}/${otherCreateToken}/organizer-jobs`,
      { requestId: randomUUID(), operation: "validate", draftId: creationDraft.id });
    assert.equal(crossFlow.status, 403, crossFlow.body.toString());
    const validated = await job(createToken, "organizer-jobs", { operation: "validate", draftId: creationDraft.id });
    assert.deepEqual(validated.transaction, creationDraft.transaction);
    assert.equal(submittedReferences().drafts.length, 0);
  });

  await t.test("only the actual signed local creation is adopted, without granting a regular owner session", async () => {
    const sent = await f.sendSyntheticTransaction(1, creationDraft.transaction); await sent.wait();
    const acknowledged = await request(`${BASE}/${createToken}/submitted`, { draftId: creationDraft.id, hash: sent.hash });
    assert.equal(acknowledged.status, 200, acknowledged.body.toString());
    created = await job(createToken, "organizer-jobs", { operation: "reconcile", draftId: creationDraft.id, hash: sent.hash });
    assert.equal(created.status, "confirmed"); assert.equal(created.hash, sent.hash);
    assert.equal(created.eventId, creationDraft.eventId);
    assert(ethers.isAddress(created.contract)); managed.set(created.eventId, created.contract);
    assert.equal(w.events.size, 1);
    const normal = await request("/api/bootstrap");
    assert.equal(normal.data.session, null); assert(normal.data.events.every(event => event.role === "participant"));
    const ownerWrite = await request(`/api/events/${created.eventId}/participants/unknown`, { admission: "approved" }, "PATCH");
    assert(ownerWrite.status >= 400);
    assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
  });

  await t.test("deposit flow cannot read private events, use organizer operations or pre-verify wallet ownership", async () => {
    depositToken = await mint(guestWallet, "deposit");
    const r = w.events.get(created.eventId), before = structuredClone([...r.participants]);
    const foreign = await request(`${BASE}/${depositToken}/event-read-jobs`,
      { requestId: randomUUID(), operation: "deposit", eventId: "foreign-event" });
    assert(foreign.status >= 400);
    const forbidden = await request(`${BASE}/${depositToken}/organizer-jobs`,
      { requestId: randomUUID(), operation: "prepare", input: {} });
    assert(forbidden.status >= 400);
    r.definition.visibility = "private";
    try {
      const secret = await request(`${BASE}/${depositToken}/event-read-jobs`,
        { requestId: randomUUID(), operation: "deposit", eventId: created.eventId });
      if (secret.status === 202) {
        const id = secret.data.requestId;
        let result;
        for (let i = 0; i < 400; i++) {
          result = await request(`${BASE}/${depositToken}/event-read-jobs/${id}`);
          if (result.data.state !== "pending") break;
          await sleep(25);
        }
        assert.notEqual(result.data.state, "ready", result.body.toString());
        assert.equal(result.data.result, undefined);
      } else assert(secret.status >= 400);
      assert.deepEqual([...r.participants], before);
    } finally { r.definition.visibility = "public"; }
    const ownerDepositToken = await mint(ownerWallet, "deposit");
    const ownerDeposit = await job(ownerDepositToken, "event-read-jobs", { operation: "deposit", eventId: created.eventId });
    for (const event of [ownerDeposit.depositReview.events[0], ownerDeposit.depositReview.selectedEvent.detail.event]) {
      assert.equal(event.role, "participant", "Claiming the real owner address does not grant an owner projection");
      for (const key of ["organizers", "staff", "permissions", "participants", "admission", "email", "name"])
        assert.equal(Object.hasOwn(event, key), false, `The public review must not disclose ${key}`);
    }
    const unsupportedWallet = await (await f.provider.getSigner(2)).getAddress();
    const unsupportedToken = await mint(unsupportedWallet, "deposit"), originalCode = await f.provider.getCode(unsupportedWallet);
    await f.provider.send("evm_setAccountCode", [unsupportedWallet, "0x00"]);
    try {
      const rejected = await job(unsupportedToken, "event-read-jobs", { operation: "deposit", eventId: created.eventId }, "failed");
      assert.equal(rejected.result, undefined);
      assert(![...r.participants.values()].some(person => lower(person.wallet) === lower(unsupportedWallet) && person.walletVerified));
    } finally { await f.provider.send("evm_setAccountCode", [unsupportedWallet, originalCode]); }
    depositDraft = await job(depositToken, "event-read-jobs", { operation: "deposit", eventId: created.eventId });
    assert.equal(depositDraft.action, "deposit"); assert.equal(depositDraft.wallet, guestWallet);
    assert.equal(depositDraft.valueWei, "1000000000000"); assert.equal(depositDraft.transaction.data, "0xd0e30db0");
    assert(depositDraft.v10Intent); assert.equal(depositDraft.depositReview.events[0].role, "participant");
    for (const event of [depositDraft.depositReview.events[0], depositDraft.depositReview.selectedEvent.detail.event])
      for (const key of ["organizers", "staff", "permissions", "participants", "admission", "email", "name"])
        assert.equal(Object.hasOwn(event, key), false, `The guest's public review must not disclose ${key}`);
    const person = [...r.participants.values()].find(person => lower(person.wallet) === lower(guestWallet));
    assert(person === undefined || person.walletVerified !== true);
    assert(person === undefined || person.identityVerified !== true);
    assert.equal(await w.contract(created.eventId).pendingDeposits(guestWallet), 0n);
  });

  await t.test("a false hash is only a flow-local latch and cannot establish global pending funds or block a fresh flow", async () => {
    const before = submittedReferences();
    const falseAcknowledgment = await request(`${BASE}/${depositToken}/submitted`, { draftId: depositDraft.id, hash: unknownHash });
    assert(falseAcknowledgment.status >= 200 && falseAcknowledgment.status < 500, falseAcknowledgment.body.toString());
    const after = submittedReferences();
    assert.deepEqual(after, before, "An unknown transaction must not be written to the global original-hash journal");
    const another = await request(`${BASE}/${depositToken}/submitted`, { draftId: depositDraft.id, hash: ethers.id("different-unknown-public-hash") });
    assert(another.status >= 400, another.body.toString());
    const normalDraft = await request(`/api/events/${created.eventId}/drafts`, { action: "deposit", params: {} });
    assert(normalDraft.status >= 400, "A public token must not authenticate the normal API");
    const forgedFlow = await mint(guestWallet, "deposit");
    const forgedDraft = await job(forgedFlow, "event-read-jobs", { operation: "deposit", eventId: created.eventId });
    const beforeVisibleMismatch = submittedReferences();
    const visibleMismatch = await request(`${BASE}/${forgedFlow}/submitted`, { draftId: forgedDraft.id, hash: created.hash });
    assert(visibleMismatch.status >= 400 && visibleMismatch.status < 500, visibleMismatch.body.toString());
    assert.deepEqual(submittedReferences(), beforeVisibleMismatch,
      "A real signed creation from a different wallet/call cannot become this guest's pending deposit");
    depositToken = await mint(guestWallet, "deposit");
    depositDraft = await job(depositToken, "event-read-jobs", { operation: "deposit", eventId: created.eventId });
    const validated = await job(depositToken, "event-read-jobs", { operation: "validate", eventId: created.eventId, draftId: depositDraft.id });
    assert.deepEqual(validated.transaction, depositDraft.transaction);
    assert.equal(submittedReferences().transactions.some(tx => tx.hash === unknownHash), false);
  });

  await t.test("the actual local deposit retains its exact original hash and only canonical proof establishes payment", async () => {
    const before = await f.provider.getBalance(created.contract), D = BigInt(depositDraft.valueWei);
    originalDeposit = await f.sendSyntheticTransaction(0, depositDraft.transaction); await originalDeposit.wait();
    const acknowledged = await request(`${BASE}/${depositToken}/submitted`, { draftId: depositDraft.id, hash: originalDeposit.hash });
    assert.equal(acknowledged.status, 200, acknowledged.body.toString());
    const confirmed = await job(depositToken, "event-read-jobs", { operation: "confirm", eventId: created.eventId,
      draftId: depositDraft.id, hash: originalDeposit.hash });
    assert.equal(confirmed.status, "confirmed"); assert.equal(confirmed.hash, originalDeposit.hash);
    assert.equal(confirmed.eventId, created.eventId); assert.equal(lower(confirmed.wallet), lower(guestWallet));
    assert.equal(confirmed.chainId, 1);
    assert.equal(await f.provider.getBalance(created.contract), before + D);
    assert.equal(await w.contract(created.eventId).pendingDeposits(guestWallet), D);
    const saved = f.savedState(), retained = saved.drafts.find(([id]) => id === depositDraft.id)[1];
    assert.equal(retained.submittedHash, originalDeposit.hash); assert.equal(retained.confirmedHash, originalDeposit.hash);
    assert.equal(submittedReferences().transactions.some(tx => tx.hash === unknownHash), false);
    assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
    const normal = await request("/api/bootstrap"); assert.equal(normal.data.session, null);
  });

  await t.test("mint capacity is bounded to 128 live opaque flows", async () => {
    let minted = 0, last;
    for (let i = 0; i <= 128; i++) {
      last = await request(BASE, { wallet: guestWallet, kind: "deposit" });
      if (last.status !== 201) break;
      assert.match(last.data.token, /^[a-f0-9]{64}$/); minted++;
    }
    assert(minted < 128); assert.equal(last.status, 503, last.body.toString());
    assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
  });

  await t.test("the 30-minute capability expires before reads or submission and permits a fresh independent flow", async () => {
    let clock = Date.now();
    // Trusted clock injection tests expiry only; all financial behavior above uses the actual HTTP server.
    const service = createPublicTransactionService(w, { origin: f.origin, instanceId: "synthetic-expiring-public-flow",
      now: () => clock, walletContext: () => ({ chainId: 1 }), bootstrapDTO: value => value });
    const flow = service.create({ wallet: guestWallet, kind: "deposit" }), before = submittedReferences();
    assert.equal(flow.expiresAt, clock + 30 * 60_000);
    clock = flow.expiresAt - 1; assert.equal(service.read(flow.token).token, flow.token);
    clock = flow.expiresAt;
    assert.throws(() => service.read(flow.token), { code: "PUBLIC_FLOW_NOT_FOUND", status: 404 });
    await assert.rejects(service.submitted(flow.token, { draftId: depositDraft.id, hash: originalDeposit.hash }),
      { code: "PUBLIC_FLOW_NOT_FOUND", status: 404 });
    assert.deepEqual(submittedReferences(), before);
    const fresh = service.create({ wallet: guestWallet, kind: "deposit" });
    assert.notEqual(fresh.token, flow.token); assert.equal(fresh.expiresAt, clock + 30 * 60_000);
    assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
  });
});
