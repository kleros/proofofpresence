// In-memory admission only: no HTTP, blockchain, signer, credentials or disk.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPublicTransactionService } from "../src/public-transactions.mjs";

const wallet = "0x" + "1".repeat(40), contract = "0x" + "2".repeat(40), eventId = "synthetic-admission-event";
const requester = value => createHash("sha256").update(String(value)).digest("hex");
const hash = "0x" + "3".repeat(64);
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  let clock = 1_000_000, allocations = 0, drafts = 0, prepareGate = null, bootstrapGate = null, reconcileStatus = "confirmed";
  const draft = () => ({ id: `synthetic-draft-${++drafts}`, expiresAt: Date.now() + 300000,
    transaction: { to: contract, from: wallet, data: "0xd0e30db0", value: "0x2386f26fc10000", chainId: "0x1" } });
  const w = {
    publicTransactionTarget: kind => ({ contract, target: contract, ...(kind === "deposit" ? { eventId } : {}) }),
    createPublicTransactionActor: (wallet, id) => { allocations++; return Object.freeze({ wallet, id, mode: "wallet" }); },
    events: new Map([[eventId, { transactions: [] }]]),
    prepareDirectDeposit: async () => { if (prepareGate) await prepareGate; return draft(); },
    createDirectDeposit: async () => draft(),
    validateDirectDeposit: async (actor, id) => ({ draft: { id }, transaction: { from: actor.wallet, to: contract } }),
    bootstrap: async () => { if (bootstrapGate) await bootstrapGate; return {}; },
    publicTransactionSubmitted: async (actor, draftId, hash) => ({ status: "pending", draftId, hash }),
    reconcilePublicTransaction: async (actor, draftId, hash) => ({ status: reconcileStatus, draftId, hash }),
    finalizeReadResult: async (operation, result) => result,
    createFactoryDraft: async () => draft(),
  };
  const service = createPublicTransactionService(w, { origin: "https://admission.example.invalid", instanceId: "synthetic-admission",
    walletContext: () => ({}), bootstrapDTO: value => value, now: () => clock });
  return { service, w, allocations: () => allocations, advance: ms => { clock += ms; },
    gatePrepare: value => { prepareGate = value; }, gateBootstrap: value => { bootstrapGate = value; },
    reconcileStatus: value => { reconcileStatus = value; },
    mint: (key, kind = "deposit", claimedWallet = wallet) => service.create({ wallet: claimedWallet, kind }, requester(key)) };
}
async function ready(service, token, requestId) {
  for (let i = 0; i < 100; i++) {
    await flush(); const result = await service.eventStatus(token, requestId);
    if (result.state !== "pending") { assert.equal(result.state, "ready", JSON.stringify(result)); return result.result; }
  }
  assert.fail("Synthetic receipt job did not complete");
}

test("trusted requester is mandatory before actor allocation; wallet claims cannot supply it", () => {
  const f = setup();
  for (const key of [undefined, null, "", "client-ip", "a".repeat(63), "A".repeat(64), ["a".repeat(64)]])
    assert.throws(() => f.service.create({ wallet, kind: "deposit" }, key), { code: "PUBLIC_FLOW_REQUESTER_UNAVAILABLE", status: 503 });
  assert.throws(() => f.service.create({ wallet, kind: "deposit", requester: requester("forged") }, requester("real")), { code: "PUBLIC_FLOW_SCOPE" });
  assert.equal(f.allocations(), 0);
});

test("128 rapid anonymous mints from one requester cannot monopolize the pool or allocate unlimited actors", () => {
  const f = setup(), tokens = []; let limited = 0;
  for (let i = 0; i < 128; i++) {
    try { tokens.push(f.mint("abusive-client", i % 2 ? "create" : "deposit", "0x" + (i + 1).toString(16).padStart(40, "0")).token); }
    catch (error) { assert.equal(error.code, "PUBLIC_FLOW_RATE_LIMIT"); assert.equal(error.status, 429); limited++; }
  }
  assert.equal(tokens.length, 24); assert.equal(limited, 104); assert.equal(f.allocations(), 24);
  let live = 0;
  for (const token of tokens) try { f.service.read(token); live++; } catch (error) { assert.equal(error.code, "PUBLIC_FLOW_NOT_FOUND"); }
  assert.equal(live, 16, "Unused capabilities are reclaimed along with their actor mapping");
  assert.equal(f.mint("legitimate-new-client").flowKind, "deposit");
  assert.equal(f.mint("another-legitimate-client", "create").flowKind, "create");
  f.advance(1000); assert.equal(f.mint("abusive-client").flowKind, "deposit", "A rate-limited NAT can resume after one second");
  assert.throws(() => f.mint("abusive-client"), { code: "PUBLIC_FLOW_RATE_LIMIT" });
});

test("preparing, drafted and hash-bound capabilities survive requester pressure; claimed wallets are never reserved", async () => {
  const f = setup(), tokens = []; let release;
  f.gatePrepare(new Promise(resolve => { release = resolve; }));
  const first = f.mint("one-nat"), preparing = f.service.directPrepare(first.token, {}); tokens.push(first.token);
  // The first operation has not returned a draft, but its possible-send family is reserved.
  for (let i = 1; i < 16; i++) {
    const flow = f.mint("one-nat"); tokens.push(flow.token);
    const review = await f.service.directDeposit(flow.token, {});
    if (i === 1) await f.service.submitted(flow.token, { draftId: review.id, hash });
  }
  const before = f.allocations();
  assert.throws(() => f.mint("one-nat"), { code: "PUBLIC_FLOW_RATE_LIMIT", status: 429 });
  assert.equal(f.allocations(), before);
  for (const token of tokens) assert.equal(f.service.read(token).token, token);
  // Another requester claiming the same wallet remains independent: an unsigned
  // address must never be a server-side victim lock or private session proof.
  assert.equal(f.mint("different-nat").wallet, wallet);
  release(); const original = await preparing;
  assert.equal((await f.service.directValidate(first.token, { draftId: original.id })).draft.id, original.id);
  const pending = await f.service.submitted(first.token, { draftId: original.id, hash });
  assert.equal(pending.hash, hash);
  await assert.rejects(f.service.submitted(first.token, { draftId: original.id, hash: "0x" + "4".repeat(64) }), { code: "PUBLIC_FLOW_CONFLICT" });
});

test("shared-capacity reclamation touches only unused flows, never draft, job, original hash or receipt bindings", async () => {
  const f = setup(), protectedFlows = [];
  for (let i = 0; i < 3; i++) {
    const flow = f.mint(`protected-${i}`), draft = await f.service.directDeposit(flow.token, {});
    if (i === 1) await f.service.submitted(flow.token, { draftId: draft.id, hash });
    if (i === 2) {
      f.service.eventStart(flow.token, { requestId: "confirmed-receipt", operation: "confirm", eventId, draftId: draft.id, hash });
      assert.equal((await ready(f.service, flow.token, "confirmed-receipt")).hash, hash);
    }
    protectedFlows.push({ flow, draft });
  }
  let release; f.gateBootstrap(new Promise(resolve => { release = resolve; }));
  const job = f.mint("bootstrap-job", "create");
  f.service.eventStart(job.token, { requestId: "bootstrap-in-flight", operation: "bootstrap", selectedEventId: null, factoryOnly: true });
  const unused = [];
  for (let i = 0; i < 125; i++) unused.push(f.mint(`unused-${i}`).token);
  const legitimate = f.mint("legitimate-at-capacity"); assert.equal(legitimate.flowKind, "deposit");
  assert.throws(() => f.service.read(unused[0]), { code: "PUBLIC_FLOW_NOT_FOUND" });
  assert.equal(f.service.read(job.token).token, job.token);
  for (const { flow, draft } of protectedFlows) {
    assert.equal(f.service.read(flow.token).token, flow.token);
    if (flow.token === protectedFlows[0].flow.token)
      assert.equal((await f.service.directValidate(flow.token, { draftId: draft.id })).draft.id, draft.id);
    else assert.equal((await f.service.submitted(flow.token, { draftId: draft.id, hash })).hash, hash);
  }
  release(); await ready(f.service, job.token, "bootstrap-in-flight");
});

test("a genuinely full prepared pool fails closed without evicting possible sends", async () => {
  const f = setup(), protectedFlows = [];
  for (let i = 0; i < 128; i++) {
    const flow = f.mint(`independent-${i}`), draft = await f.service.directDeposit(flow.token, {}); protectedFlows.push({ flow, draft });
  }
  const before = f.allocations();
  assert.throws(() => f.mint("new-requester"), { code: "PUBLIC_FLOW_CAPACITY", status: 503 });
  assert.equal(f.allocations(), before);
  for (const { flow } of protectedFlows) assert.equal(f.service.read(flow.token).token, flow.token);
  const { flow, draft } = protectedFlows[0];
  assert.equal((await f.service.directValidate(flow.token, { draftId: draft.id })).draft.id, draft.id);
  assert.equal((await f.service.submitted(flow.token, { draftId: draft.id, hash })).hash, hash);
});

test("confirmed success releases the NAT active quota while retaining the original capability and receipt", async () => {
  const f = setup(), retained = [];
  for (let i = 0; i < 150; i++) {
    if (i >= 24) f.advance(1000);
    const flow = f.mint("venue-nat"), draft = await f.service.directDeposit(flow.token, {}), requestId = `receipt-${i}`;
    const originalHash = "0x" + (i + 1).toString(16).padStart(64, "0");
    await f.service.submitted(flow.token, { draftId: draft.id, hash: originalHash });
    f.service.eventStart(flow.token, { requestId, operation: "confirm", eventId, draftId: draft.id, hash: originalHash });
    assert.equal((await ready(f.service, flow.token, requestId)).hash, originalHash); retained.push({ flow, draft, originalHash });
  }
  assert.equal(retained.length, 150, "Confirmed bookkeeping does not exhaust either the NAT active quota or the global preparation budget");
  for (const { flow, draft, originalHash } of retained) {
    assert.equal(f.service.read(flow.token).token, flow.token);
    assert.equal((await f.service.submitted(flow.token, { draftId: draft.id, hash: originalHash })).hash, originalHash);
  }
});

test("rate pressure cannot shorten original 30-minute capability lifetime, and expired unused actors are reclaimed", async () => {
  const f = setup(), flow = f.mint("original"), draft = await f.service.directDeposit(flow.token, {});
  for (let i = 0; i < 24; i++) f.mint("noisy");
  f.advance(29 * 60_000); assert.equal(f.service.read(flow.token).token, flow.token);
  assert.equal((await f.service.directValidate(flow.token, { draftId: draft.id })).draft.id, draft.id);
  f.advance(60_000); assert.throws(() => f.service.read(flow.token), { code: "PUBLIC_FLOW_NOT_FOUND" });
  assert.equal(f.mint("new-after-expiry").flowKind, "deposit");
});

test("a later pending canonical recheck restores active accounting until the original receipt is confirmed again", async () => {
  const f = setup(), retained = [];
  for (let i = 0; i < 16; i++) {
    const flow = f.mint("rechecked-nat"), draft = await f.service.directDeposit(flow.token, {}), requestId = `initial-${i}`;
    f.service.eventStart(flow.token, { requestId, operation: "confirm", eventId, draftId: draft.id, hash });
    assert.equal((await ready(f.service, flow.token, requestId)).status, "confirmed"); retained.push({ flow, draft });
  }
  f.reconcileStatus("pending");
  for (let i = 0; i < retained.length; i++) {
    const { flow, draft } = retained[i], requestId = `pending-recheck-${i}`;
    f.service.eventStart(flow.token, { requestId, operation: "confirm", eventId, draftId: draft.id, hash });
    assert.equal((await ready(f.service, flow.token, requestId)).status, "pending");
    assert.equal(f.service.read(flow.token).token, flow.token);
  }
  assert.throws(() => f.mint("rechecked-nat"), { code: "PUBLIC_FLOW_RATE_LIMIT", status: 429 });
  f.reconcileStatus("confirmed");
  const { flow, draft } = retained[0];
  f.service.eventStart(flow.token, { requestId: "canonical-again", operation: "confirm", eventId, draftId: draft.id, hash });
  assert.equal((await ready(f.service, flow.token, "canonical-again")).hash, hash);
  assert.equal(f.mint("rechecked-nat").flowKind, "deposit");
});
