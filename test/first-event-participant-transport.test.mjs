// Actual isolated V10 financial execution; Court code only is mocked by the fixture.
// Synthetic ephemeral keys never leave this test. No public RPC, users or messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";

test("private participant challenge/match/resolve jobs preserve original signed drafts and receipts", { timeout: 180000 }, async t => {
  const managed = new Map(), f = await createV10AppFixture({ origin: "https://participant-jobs.example.invalid",
    firstEventManageScope: r => !!r && managed.get(r.definition.id)?.toLowerCase() === r.deployment.contract.toLowerCase() });
  t.after(() => f.close()); assert(f.provider instanceof ethers.BrowserProvider);
  const w = f.workbench(), owner = { id: "synthetic-participant-owner", mode: "wallet", wallet: f.organizerAddress };
  const participant = ethers.Wallet.createRandom().connect(f.provider), outsider = ethers.Wallet.createRandom().connect(f.provider);
  for (const wallet of [participant, outsider]) await (await f.sendSyntheticTransaction(0, { to: wallet.address, value: ethers.parseEther("1") })).wait();
  const now = (await f.provider.getBlock("latest")).timestamp, D = ethers.parseEther("0.01");
  const creation = await w.createFactoryDraft(owner, { title: "Synthetic participant jobs", lumaUrl: "https://luma.com/synthetic-participant-jobs",
    startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "UTC", depositEth: "0.01" });
  await w.validateFactoryDraft(owner, creation.id);
  const createdTx = await f.sendSyntheticTransaction(1, creation.transaction); await createdTx.wait();
  await w.recordFactorySubmitted(owner, creation.id, createdTx.hash);
  const created = await w.reconcileFactorySubmission(owner, creation.id, createdTx.hash);
  managed.set(creation.eventId, created.contract);
  const r = w.events.get(creation.eventId), c = w.contract(creation.eventId), paths = [];
  async function request(path, payload, cookie = null) {
    paths.push(path);
    const response = await f.forward(path, { method: payload === undefined ? "GET" : "POST",
      headers: cookie ? { cookie } : {}, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { ...response, data: JSON.parse(response.body.toString()) };
  }
  async function login(wallet, signer) {
    const challenge = await request("/api/auth/challenge", { wallet }); assert.equal(challenge.status, 200);
    const signature = await signer(challenge.data.message);
    const verified = await request("/api/auth/verify", { nonce: challenge.data.nonce, signature }); assert.equal(verified.status, 200);
    return verified.headers["set-cookie"][0].split(";")[0];
  }
  const participantCookie = await login(participant.address, message => participant.signMessage(message));
  const outsiderCookie = await login(outsider.address, message => outsider.signMessage(message));
  const ownerCookie = await login(owner.wallet, message => f.wallet({ method: "personal_sign",
    params: [ethers.hexlify(ethers.toUtf8Bytes(message)), owner.wallet] }, f.origin + "/"));
  const registered = await request(`/api/events/${creation.eventId}/participants`, {}, participantCookie);
  assert.equal(registered.status, 201); assert.equal(registered.data.walletVerified, true);
  await (await participant.sendTransaction({ to: created.contract, data: "0xd0e30db0", value: D })).wait();
  await (await f.sendSyntheticTransaction(1, { to: created.contract, data: "0xd0e30db0", value: D })).wait();
  await (await f.sendSyntheticTransaction(1, { to: created.contract,
    data: c.interface.encodeFunctionData("registerStakers", [[participant.address, owner.wallet]]) })).wait();
  await f.provider.send("evm_increaseTime", [7201]); await f.provider.send("evm_mine", []);
  await (await f.sendSyntheticTransaction(1, { to: created.contract,
    data: c.interface.encodeFunctionData("postAttendance", [[owner.wallet], D * 2n]) })).wait();
  r.definition.visibility = "private";
  const operation = (action, params = {}) => ({ operation: "participant-draft", eventId: creation.eventId, action, params });
  async function job(input, cookie, expected = "ready") {
    const requestId = randomUUID(), start = await request("/api/event-read-jobs", { requestId, ...input }, cookie);
    assert.equal(start.status, 202, start.body.toString());
    for (let i = 0; i < 600; i++) {
      const response = await request("/api/event-read-jobs/" + requestId, undefined, cookie); assert.equal(response.status, 200);
      if (response.data.state !== "pending") { assert.equal(response.data.state, expected, response.body.toString()); return expected === "ready" ? response.data.result : response.data.error; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail("Synthetic participant job did not finish");
  }
  assert.equal((await request("/api/event-read-jobs", { requestId: randomUUID(), ...operation("challenge") })).status, 401);
  assert.equal((await request("/api/event-read-jobs", { requestId: randomUUID(), ...operation("challenge"), eventId: "foreign-event" }, participantCookie)).status, 404);
  assert.equal((await request("/api/event-read-jobs", { requestId: randomUUID(), ...operation("register") }, participantCookie)).status, 400);
  assert.equal((await request("/api/event-read-jobs", { requestId: randomUUID(), ...operation("challenge", { wallet: participant.address }) }, participantCookie)).status, 400);
  const denied = await job(operation("challenge"), outsiderCookie, "failed"); assert.equal(denied.code, "FORBIDDEN");
  const ownerOnly = await job({ operation: "manage-draft", eventId: creation.eventId, action: "register", params: { wallets: [participant.address] } }, participantCookie, "failed");
  assert.equal(ownerOnly.code, "NOT_OWNER");
  const publicFlow = await request("/api/public-transactions", { wallet: owner.wallet, kind: "create" }); assert.equal(publicFlow.status, 201);
  assert.equal((await request(`/api/public-transactions/${publicFlow.data.token}/event-read-jobs`,
    { requestId: randomUUID(), ...operation("challenge") })).status, 403);

  const challenge = await job(operation("challenge"), participantCookie);
  assert.equal(challenge.action, "challenge"); assert.equal(challenge.wallet, participant.address); assert(challenge.v10Intent);
  assert.equal(challenge.method, "challenge"); assert.deepEqual(challenge.args, []);
  assert.equal(Object.hasOwn(challenge, "participants"), false); assert.equal(Object.hasOwn(challenge, "contacts"), false);
  const validated = await job({ operation: "validate", eventId: creation.eventId, draftId: challenge.id }, participantCookie);
  assert.deepEqual(validated.transaction, challenge.transaction);
  const challenged = await participant.sendTransaction(challenge.transaction); await challenged.wait();
  assert.equal((await request(`/api/events/${creation.eventId}/drafts/${challenge.id}/submitted`, { hash: challenged.hash }, participantCookie)).status, 200);
  const confirmed = await job({ operation: "confirm", eventId: creation.eventId, draftId: challenge.id, hash: challenged.hash }, participantCookie);
  assert.equal(confirmed.status, "confirmed"); assert.equal(confirmed.hash, challenged.hash);
  const match = await job(operation("match", { wallet: participant.address }), ownerCookie);
  assert.equal(match.method, "matchChallenge"); assert.deepEqual(match.args, [participant.address]);
  assert.equal(match.valueWei, String((await c.challenges(participant.address)).deposit));
  assert.deepEqual((await job({ operation: "validate", eventId: creation.eventId, draftId: match.id }, ownerCookie)).transaction, match.transaction);
  assert.equal((await c.challenges(participant.address)).state, 1n, "Read-only matching simulation sends nothing");
  await f.provider.send("evm_increaseTime", [86401]); await f.provider.send("evm_mine", []);
  const resolve = await job(operation("resolve"), participantCookie);
  assert.equal(resolve.method, "resolveChallenge"); assert.deepEqual(resolve.args, [participant.address]); assert.equal(resolve.valueWei, "0");
  assert.deepEqual((await job({ operation: "validate", eventId: creation.eventId, draftId: resolve.id }, participantCookie)).transaction, resolve.transaction);
  const resolved = await participant.sendTransaction(resolve.transaction); await resolved.wait();
  assert.equal((await request(`/api/events/${creation.eventId}/drafts/${resolve.id}/submitted`, { hash: resolved.hash }, participantCookie)).status, 200);
  assert.equal((await job({ operation: "confirm", eventId: creation.eventId, draftId: resolve.id, hash: resolved.hash }, participantCookie)).status, "confirmed");
  assert.equal(await c.attended(participant.address), true); assert.equal((await c.challenges(participant.address)).state, 3n);
  const stale = await job({ operation: "validate", eventId: creation.eventId, draftId: match.id }, ownerCookie, "failed");
  assert.equal(stale.code, "STALE_DRAFT");
  assert(!paths.some(path => path.startsWith("/api/bootstrap")), "No selected/full bootstrap is needed for these actions");
  assert.equal(f.stats.backendSigningCalls, 0);
});
