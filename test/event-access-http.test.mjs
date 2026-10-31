// Actual local V10 contracts, nonce-authenticated HTTP sessions and durable state.
// Ganache-only keys remain inside the fixture; no public RPC or wallet is used.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";
import { V10_IMPLEMENTATION_SLOT } from "../src/v10-upgrade-verification.mjs";

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const pause = () => new Promise(resolve => setTimeout(resolve, 10));

test("event access HTTP grants remain separate from actual V10 financial ownership", { timeout: 240000 }, async t => {
  const managed = new Map();
  const f = await createV10AppFixture({ origin: "https://event-access.example.invalid",
    firstEventManageScope: record => !!record && same(managed.get(record.definition.id), record.deployment.contract) });
  t.after(() => f.close());
  let w = f.workbench();
  const wallets = await Promise.all([0, 1, 2].map(async index => (await f.provider.getSigner(index)).getAddress()));
  const [adminWallet, ownerWallet, staffWallet] = wallets;
  const setupOwner = { id: "synthetic-access-setup-owner", mode: "wallet", wallet: ownerWallet };
  const current = await f.provider.getBlock("latest"), starts = current.timestamp + 3600, ends = starts + 3600;
  const creation = await w.createFactoryDraft(setupOwner, { title: "Synthetic event access", lumaUrl: "https://luma.com/synthetic-event-access",
    startsAt: new Date(starts * 1000).toISOString(), endsAt: new Date(ends * 1000).toISOString(), timezone: "UTC", depositEth: "0.01" });
  await w.validateFactoryDraft(setupOwner, creation.id);
  const create = await f.sendSyntheticTransaction(1, creation.transaction); await create.wait();
  await w.recordFactorySubmitted(setupOwner, creation.id, create.hash);
  const event = await w.reconcileFactorySubmission(setupOwner, creation.id, create.hash);
  managed.set(event.eventId, event.contract);
  const eventPath = "/api/events/" + event.eventId, accessPath = eventPath + "/access";
  const contract = w.contract(event.eventId), sends = { create: 1, funding: 0, register: 0, attendance: 0, transfer: 0, accept: 0 };
  let requests = 0, authentications = 0;
  t.after(() => t.diagnostic(JSON.stringify({ kind: "actual-local-event-access-http", httpRequests: requests, nonceAuthentications: authentications, sends,
    backendSigningCalls: f.stats.backendSigningCalls, limits: "Isolated Ganache chain1 and loopback HTTP only; Court is mocked; no public RPC, real wallet, credentials or production transaction." })));
  async function request(path, { cookie = "", method = "GET", body, origin } = {}) {
    requests++;
    const response = await f.forward(path, { method, headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { ...response, data: JSON.parse(response.body.toString("utf8")) };
  }
  async function authenticate(wallet) {
    const challenge = await request("/api/auth/challenge", { method: "POST", body: { wallet } });
    assert.equal(challenge.status, 200, JSON.stringify(challenge.data));
    // This direct EIP-191 signer is the in-process synthetic Ganache provider.
    const signature = await f.provider.send("eth_sign", [wallet, ethers.hexlify(ethers.toUtf8Bytes(challenge.data.message))]);
    assert(same(ethers.verifyMessage(challenge.data.message, signature), wallet));
    const verified = await request("/api/auth/verify", { method: "POST", body: { nonce: challenge.data.nonce, signature } });
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    const cookies = verified.headers["set-cookie"];
    assert(cookies); authentications++;
    return (Array.isArray(cookies) ? cookies : [cookies]).map(value => value.split(";")[0]).join("; ");
  }
  async function access(cookie) {
    const response = await request(accessPath, { cookie });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const value = response.data;
    assert.equal(value.kind, "event-access"); assert.equal(value.eventId, event.eventId);
    assert.equal(value.chainId, 1); assert(same(value.contract, event.contract));
    assert(Number.isSafeInteger(value.revision)); assert(Array.isArray(value.admins) && Array.isArray(value.staff));
    assert(!Object.hasOwn(value, "participants") && !Object.hasOwn(value, "session"));
    return value;
  }
  async function grant(cookie, body, extra = {}) {
    return request(accessPath, { cookie, method: "PATCH", body, ...extra });
  }
  async function job(cookie, operation, input) {
    const requestId = randomUUID(), start = await request("/api/event-read-jobs", {
      cookie, method: "POST", body: { requestId, operation, eventId: event.eventId, ...input } });
    if (start.status !== 202) return start;
    for (let i = 0; i < 1000; i++) {
      const response = await request("/api/event-read-jobs/" + requestId, { cookie });
      if (response.status !== 200 || response.data.state !== "pending") return response;
      await pause();
    }
    assert.fail("The scoped local event job did not complete");
  }
  function ready(response) {
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.state, "ready", JSON.stringify(response.data));
    return response.data.result;
  }
  function denied(response) {
    assert(response.status >= 400 && response.status < 500 || response.status === 200 && response.data.state === "failed", JSON.stringify(response.data));
    assert.equal(response.data.result, undefined);
  }
  async function sendReviewed(cookie, index, draft, action) {
    const validation = ready(await job(cookie, "validate", { draftId: draft.id }));
    assert.deepEqual(validation.transaction, draft.transaction);
    assert(same(validation.transaction.to, event.contract)); assert(same(validation.transaction.from, wallets[index]));
    assert.equal(BigInt(validation.transaction.value), 0n);
    const sent = await f.sendSyntheticTransaction(index, validation.transaction), receipt = await sent.wait();
    assert.equal(receipt.status, 1); sends[action]++;
    const submitted = await request(eventPath + "/drafts/" + draft.id + "/submitted", { cookie, method: "POST", body: { hash: sent.hash } });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    const confirmed = ready(await job(cookie, "confirm", { draftId: draft.id, hash: sent.hash }));
    assert.equal(confirmed.status, "confirmed"); assert.equal(confirmed.hash, sent.hash);
    return { sent, receipt };
  }
  async function advanceTo(timestamp) {
    const block = await f.provider.getBlock("latest");
    if (timestamp > block.timestamp) await f.provider.send("evm_increaseTime", [timestamp - block.timestamp]);
    await f.provider.send("evm_mine", []);
  }
  let ownerCookie = await authenticate(ownerWallet), adminCookie = await authenticate(adminWallet), staffCookie = await authenticate(staffWallet);

  await t.test("authentication, exact grant payloads and Origin protect the new HTTP boundary", async () => {
    assert.equal((await request(accessPath)).status, 401);
    assert.equal((await grant("", { role: "admin", wallet: adminWallet, enabled: true, revision: 0 })).status, 401);
    const before = await access(ownerCookie); assert.equal(before.role, "owner"); assert(same(before.owner, ownerWallet));
    const patch = { role: "admin", wallet: adminWallet, enabled: true, revision: before.revision };
    assert.equal((await grant(ownerCookie, patch, { origin: "https://foreign.example.invalid" })).status, 403);
    for (const body of [{ ...patch, eventId: "foreign-event" }, { ...patch, role: "owner" }, { ...patch, wallet: ethers.ZeroAddress }, { ...patch, enabled: "true" }]) denied(await grant(ownerCookie, body));
    denied(await request("/api/events/foreign-event/access", { cookie: ownerCookie }));
    assert.equal((await access(ownerCookie)).revision, before.revision);
  });

  await t.test("owner grants admin, admin grants staff, and neither can escalate to financial ownership", async () => {
    let value = await access(ownerCookie);
    assert.equal((await grant(ownerCookie, { role: "admin", wallet: adminWallet, enabled: true, revision: value.revision })).status, 200);
    value = await access(adminCookie); assert.equal(value.role, "admin");
    const previous = value.revision;
    assert.equal((await grant(adminCookie, { role: "staff", wallet: staffWallet, enabled: true, revision: value.revision })).status, 200);
    assert.equal((await access(staffCookie)).role, "staff");
    assert.equal((await grant(ownerCookie, { role: "staff", wallet: adminWallet, enabled: true, revision: previous })).status, 409);
    value = await access(ownerCookie);
    denied(await grant(adminCookie, { role: "admin", wallet: staffWallet, enabled: true, revision: value.revision }));
    denied(await grant(staffCookie, { role: "staff", wallet: adminWallet, enabled: true, revision: value.revision }));
    for (const cookie of [adminCookie, staffCookie]) for (const [action, params] of [
      ["register", { wallets: [adminWallet] }], ["postAttendance", { attendedWallets: [adminWallet], attendanceReview: { confirmed: true, note: "Observed this synthetic guest during the event." } }],
      ["transferOwnership", { to: staffWallet }],
    ]) denied(await job(cookie, "manage-draft", { action, params }));
    assert.equal(await contract.owner(), ownerWallet);
  });

  await t.test("grant state persists while pre-restart HTTP sessions lose access", async () => {
    const before = await access(ownerCookie), oldCookie = adminCookie;
    await f.restart(); w = f.workbench();
    assert.equal((await request(accessPath, { cookie: oldCookie })).status, 401);
    ownerCookie = await authenticate(ownerWallet); adminCookie = await authenticate(adminWallet); staffCookie = await authenticate(staffWallet);
    const restored = await access(ownerCookie); assert.equal(restored.revision, before.revision);
    assert.deepEqual(restored.admins, before.admins); assert.deepEqual(restored.staff, before.staff);
    assert.equal((await access(adminCookie)).role, "admin"); assert.equal((await access(staffCookie)).role, "staff");
  });

  await t.test("the HTTP authority reader rejects altered runtime and implementation storage", async () => {
    const send = f.provider.send, reads = [];
    f.provider.send = function(method, params) { reads.push(method); return send.call(this, method, params); };
    try { await access(ownerCookie); }
    finally { f.provider.send = send; }
    assert(!reads.some(method => ["eth_getLogs", "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(method)),
      "DB access must use the bounded fresh authority reader, not a historical event bootstrap");
    for (const mutation of [
      () => f.provider.send("evm_setAccountCode", [event.contract, "0x00"]),
      () => f.provider.send("evm_setAccountStorageAt", [event.contract, V10_IMPLEMENTATION_SLOT, ethers.ZeroHash]),
    ]) {
      const snapshot = await f.provider.send("evm_snapshot", []);
      try {
        await mutation();
        const response = await request(accessPath, { cookie: ownerCookie });
        assert(response.status >= 400, JSON.stringify(response.data));
        assert.equal(response.data.role, undefined); assert.equal(response.data.admins, undefined);
      } finally { assert.equal(await f.provider.send("evm_revert", [snapshot]), true); }
    }
    for (const fault of ["chain", "canonical"]) {
      f.provider.send = async function(method, params) {
        const value = await send.call(this, method, params);
        if (fault === "chain" && method === "eth_chainId") return "0x2";
        if (fault === "canonical" && method === "eth_getBlockByNumber" && params[0] !== "latest")
          return { ...value, hash: ethers.id("synthetic changed access authority anchor") };
        return value;
      };
      try {
        const response = await request(accessPath, { cookie: ownerCookie });
        assert(response.status >= 400, JSON.stringify(response.data)); assert.equal(response.data.role, undefined);
      } finally { f.provider.send = send; }
    }
    assert.equal((await access(adminCookie)).role, "admin");
  });

  const funding = await f.sendSyntheticTransaction(0, { to: event.contract, data: "0xd0e30db0", value: ethers.parseEther("0.01") });
  await funding.wait(); sends.funding++;
  const adopted = ready(await job(ownerCookie, "adopt-payer", { wallet: adminWallet, txHash: funding.hash, confirmed: true, note: "Reviewed the canonical local payer receipt for admission." }));
  assert.equal((await request(eventPath + "/participants/" + adopted.participantId, { cookie: ownerCookie, method: "PATCH", body: { admission: "approved" } })).status, 200);
  const registration = ready(await job(ownerCookie, "manage-draft", { action: "register", params: { wallets: [adminWallet] } }));
  await sendReviewed(ownerCookie, 1, registration, "register");

  await t.test("staff check-in records one scoped door observation without changing financial attendance", async () => {
    const body = { wallet: adminWallet, nonce: randomUUID(), note: "Observed this registered synthetic guest at the door." };
    denied(await request(eventPath + "/staff-checkins", { cookie: staffCookie, method: "POST", body }));
    await advanceTo(starts + 30);
    const response = await request(eventPath + "/staff-checkins", { cookie: staffCookie, method: "POST", body });
    assert(response.status === 200 || response.status === 201, JSON.stringify(response.data));
    const value = await access(staffCookie), observation = value.checkins.find(row => same(row.wallet, adminWallet));
    assert(observation); assert(same(observation.actorWallet, staffWallet)); assert(Number.isFinite(Date.parse(observation.recordedAt)) || Number.isFinite(observation.recordedAt));
    denied(await request(eventPath + "/staff-checkins", { cookie: staffCookie, method: "POST", body }));
    denied(await request(eventPath + "/staff-checkins", { cookie: staffCookie, method: "POST", body: { ...body, nonce: randomUUID(), eventId: "foreign-event" } }));
    assert.equal(await contract.attended(adminWallet), false);
    assert.equal(Number(await contract.phase()), 0);
  });

  await t.test("only the financial owner posts the exact registered attendance list on-chain", async () => {
    await advanceTo(ends + 1);
    const params = { attendedWallets: [adminWallet], attendanceReview: { confirmed: true, note: "Reviewed the synthetic staff observation after the event ended." } };
    denied(await job(staffCookie, "manage-draft", { action: "postAttendance", params }));
    denied(await job(adminCookie, "manage-draft", { action: "postAttendance", params }));
    const draft = ready(await job(ownerCookie, "manage-draft", { action: "postAttendance", params }));
    assert.deepEqual(draft.args[0].map(value => value.toLowerCase()), [adminWallet.toLowerCase()]);
    await sendReviewed(ownerCookie, 1, draft, "attendance");
    assert.equal(await contract.attended(adminWallet), true); assert.equal(Number(await contract.phase()), 1);
  });

  await t.test("reviewed two-step ownership invalidates old grants without enabling another recipient", async () => {
    const draft = ready(await job(ownerCookie, "manage-draft", { action: "transferOwnership", params: { to: staffWallet } }));
    assert.deepEqual(draft.args.map(value => value.toLowerCase()), [staffWallet.toLowerCase()]);
    assert(same(contract.interface.decodeFunctionData("transferOwnership", draft.transaction.data)[0], staffWallet));
    denied(await job(ownerCookie, "validate", { draftId: draft.id, transaction: {
      ...draft.transaction, data: contract.interface.encodeFunctionData("transferOwnership", [adminWallet]),
    } }));
    await sendReviewed(ownerCookie, 1, draft, "transfer");
    let value = await access(staffCookie); assert.equal(value.role, "pending-owner"); assert(same(value.pendingOwner, staffWallet));
    assert.equal((await access(adminCookie)).role, "admin");
    const accept = ready(await job(staffCookie, "manage-draft", { action: "acceptOwnership", params: {} }));
    assert.deepEqual(accept.args, []); await sendReviewed(staffCookie, 2, accept, "accept");
    value = await access(staffCookie); assert.equal(value.role, "owner"); assert(same(value.owner, staffWallet));
    assert.deepEqual(value.admins, []); assert.deepEqual(value.staff, []);
    assert.equal((await access(adminCookie)).role, "participant");
    denied(await grant(ownerCookie, { role: "admin", wallet: adminWallet, enabled: true, revision: value.revision }));
    denied(await grant(adminCookie, { role: "staff", wallet: ownerWallet, enabled: true, revision: value.revision }));
    assert(same(await contract.owner(), staffWallet));
  });

  assert.equal(f.stats.backendSigningCalls, 0);
  assert.deepEqual(sends, { create: 1, funding: 1, register: 1, attendance: 1, transfer: 1, accept: 1 });
});

test("legacy current-event check-in HTTP shares serialized authorization and strict payload safety", { timeout: 90000 }, async t => {
  const managed = new Map(), f = await createV10AppFixture({ origin: "https://event-access-adapter.example.invalid",
    firstEventManageScope: record => !!record && same(managed.get(record.definition.id), record.deployment.contract) });
  t.after(() => f.close());
  const w = f.workbench(), wallets = await Promise.all([0, 1, 2].map(async index => (await f.provider.getSigner(index)).getAddress()));
  const [guestWallet, ownerWallet, staffWallet] = wallets;
  let requests = 0, signatures = 0, creates = 0;
  const rpcProfiles = [];
  t.after(() => t.diagnostic(JSON.stringify({ kind: "event-access-checkin-adapter-http", httpRequests: requests, nonceAuthentications: signatures,
    sends: { create: creates, funding: 0, register: 0, attendance: 0, transfer: 0, accept: 0 }, backendSigningCalls: f.stats.backendSigningCalls, rpcProfiles })));
  const now = (await f.provider.getBlock("latest")).timestamp, starts = now + 3600, ends = starts + 3600;
  const setupOwner = { id: "synthetic-checkin-adapter-owner", mode: "wallet", wallet: ownerWallet };
  const draft = await w.createFactoryDraft(setupOwner, { title: "Synthetic check-in adapters", lumaUrl: "https://luma.com/synthetic-checkin-adapters",
    startsAt: new Date(starts * 1000).toISOString(), endsAt: new Date(ends * 1000).toISOString(), timezone: "UTC", depositEth: "0.01" });
  await w.validateFactoryDraft(setupOwner, draft.id);
  const created = await f.sendSyntheticTransaction(1, draft.transaction); await created.wait(); creates++;
  await w.recordFactorySubmitted(setupOwner, draft.id, created.hash);
  const event = await w.reconcileFactorySubmission(setupOwner, draft.id, created.hash); managed.set(event.eventId, event.contract);
  const path = "/api/events/" + event.eventId, record = w.events.get(event.eventId);
  async function request(route, cookie = "", body, method = body === undefined ? "GET" : "POST", extraHeaders = {}) {
    requests++;
    const trace = route === path + "/access", reads = [], send = f.provider.send;
    if (trace) f.provider.send = function(method, params) { reads.push(method); return send.call(this, method, params); };
    let response;
    try {
      response = await f.forward(route, { method, headers: { ...(cookie ? { cookie } : {}), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } finally { if (trace) f.provider.send = send; }
    if (trace) rpcProfiles.push({ method, status: response.status, reads: reads.length,
      methods: Object.fromEntries([...new Set(reads)].map(method => [method, reads.filter(value => value === method).length])) });
    return { ...response, data: JSON.parse(response.body.toString("utf8")) };
  }
  async function authenticate(wallet) {
    const challenge = await request("/api/auth/challenge", "", { wallet }); assert.equal(challenge.status, 200);
    const signature = await f.provider.send("eth_sign", [wallet, ethers.hexlify(ethers.toUtf8Bytes(challenge.data.message))]);
    assert(same(ethers.verifyMessage(challenge.data.message, signature), wallet));
    const verified = await request("/api/auth/verify", "", { nonce: challenge.data.nonce, signature }); assert.equal(verified.status, 200);
    signatures++; const cookies = verified.headers["set-cookie"];
    return (Array.isArray(cookies) ? cookies : [cookies]).map(value => value.split(";")[0]).join("; ");
  }
  const ownerCookie = await authenticate(ownerWallet), guestCookie = await authenticate(guestWallet);
  let staffCookie = await authenticate(staffWallet);
  const access = await request(path + "/access", ownerCookie); assert.equal(access.status, 200);
  assert.equal((await request(path + "/access", ownerCookie, { role: "staff", wallet: staffWallet, enabled: true, revision: access.data.revision }, "PATCH")).status, 200);
  const guest = await request(path + "/participants", guestCookie, { name: "Synthetic free guest", email: "guest@example.invalid" });
  const host = await request(path + "/participants", ownerCookie, { name: "Synthetic host attendee", email: "owner@example.invalid" });
  assert.equal(guest.status, 201, JSON.stringify(guest.data)); assert.equal(host.status, 201, JSON.stringify(host.data));
  const block = await f.provider.getBlock("latest"); await f.provider.send("evm_increaseTime", [starts + 30 - block.timestamp]); await f.provider.send("evm_mine", []);
  const note = "Observed this verified synthetic guest during the event.", legacy = { participantId: guest.data.id, source: "staff-door", nonce: randomUUID(), note };
  for (const malformed of [{ nonce: 12345678 }, { note: 12345678 }]) {
    const oldResult = await request(path + "/checkins", staffCookie, { ...legacy, ...malformed });
    const newResult = await request(path + "/staff-checkins", staffCookie, { wallet: guestWallet, nonce: randomUUID(), note, ...malformed });
    assert(oldResult.status >= 400 && oldResult.status < 500, JSON.stringify(oldResult.data));
    assert(newResult.status >= 400 && newResult.status < 500, JSON.stringify(newResult.data));
    assert.equal(record.observations.length, 0);
  }
  assert.equal((await request(path + "/checkins", staffCookie, legacy, "POST", { origin: "https://foreign.example.invalid" })).status, 403);
  const wrongSource = await request(path + "/checkins", staffCookie, { ...legacy, source: "reviewed-csv" });
  assert(wrongSource.status >= 400 && wrongSource.status < 500); assert.equal(record.observations.length, 0);

  // Hold the old adapter inside its authority read. The new adapter must see
  // the SAME event lock, and logout must invalidate the held old request.
  const send = f.provider.send;
  let release, reached, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { reached = resolve; });
  f.provider.send = async function(method, params) {
    if (!held && method === "eth_getBlockByNumber" && params[0] === "latest") { held = true; reached(); await gate; }
    return send.call(this, method, params);
  };
  const pending = request(path + "/checkins", staffCookie, legacy);
  let deadline;
  try {
    await Promise.race([started, new Promise((_, reject) => { deadline = setTimeout(() => reject(Error("Legacy check-in did not enter its authority read")), 5000); })]);
    const competing = await request(path + "/staff-checkins", staffCookie, { wallet: ownerWallet, nonce: randomUUID(), note });
    assert.equal(competing.status, 409); assert.equal(competing.data.code, "EVENT_ACCESS_BUSY");
    assert.equal((await request("/api/session", staffCookie, undefined, "DELETE")).status, 200);
    release(); const stopped = await pending; assert.equal(stopped.status, 401, JSON.stringify(stopped.data));
    assert.equal(record.observations.length, 0);
  } finally { clearTimeout(deadline); release(); f.provider.send = send; await pending; }

  staffCookie = await authenticate(staffWallet);
  const oldResult = await request(path + "/checkins", staffCookie, legacy);
  assert.equal(oldResult.status, 201, JSON.stringify(oldResult.data));
  assert.deepEqual(Object.keys(oldResult.data).sort(), ["id", "eventId", "participantId", "source", "reviewer", "timestamp", "nonce", "note"].sort());
  assert.equal(oldResult.data.participantId, guest.data.id); assert.equal(oldResult.data.source, "staff-door");
  assert(same(oldResult.data.reviewer, staffWallet)); assert.equal(oldResult.data.nonce, legacy.nonce);
  assert.equal(oldResult.data.note, note); assert(Number.isSafeInteger(oldResult.data.timestamp));
  const replay = await request(path + "/staff-checkins", staffCookie, { wallet: ownerWallet, nonce: legacy.nonce, note });
  assert.equal(replay.status, 409); assert.equal(replay.data.code, "REPLAY");
  const newResult = await request(path + "/staff-checkins", staffCookie, { wallet: ownerWallet, nonce: randomUUID(), note });
  assert(newResult.status === 200 || newResult.status === 201, JSON.stringify(newResult.data));
  const currentAccess = await request(path + "/access", ownerCookie); assert.equal(currentAccess.data.checkins.length, 2);
  assert.equal((await request(path + "/access", ownerCookie, { role: "staff", wallet: staffWallet, enabled: false, revision: currentAccess.data.revision }, "PATCH")).status, 200);
  const oldDenied = await request(path + "/checkins", staffCookie, { ...legacy, nonce: randomUUID() });
  const newDenied = await request(path + "/staff-checkins", staffCookie, { wallet: guestWallet, nonce: randomUUID(), note });
  assert.equal(oldDenied.status, 403); assert.equal(newDenied.status, 403);
  assert.equal(oldDenied.data.code, "NOT_STAFF"); assert.equal(newDenied.data.code, "NOT_STAFF");
  assert.equal(record.observations.length, 2);
  assert.equal(Number(await w.contract(event.eventId).phase()), 0);
  assert.equal(await w.contract(event.eventId).attended(guestWallet), false);
  assert(rpcProfiles.every(profile => !Object.keys(profile.methods).some(method => ["eth_getLogs", "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(method))));
  assert.equal(f.stats.backendSigningCalls, 0); assert.equal(creates, 1);
});
