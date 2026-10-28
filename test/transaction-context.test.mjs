import assert from "node:assert/strict";
import { test } from "node:test";
import { createTransactionJournal, submitWalletDraft } from "../public/transaction-context.js";

const WALLET_A = `0x${"a".repeat(40)}`;
const WALLET_B = `0x${"b".repeat(40)}`;
const EVENT_CONTRACT = `0x${"1".repeat(40)}`;
const RESOLVER = `0x${"2".repeat(40)}`;
const HASH = `0x${"c".repeat(64)}`;
const OTHER_HASH = `0x${"d".repeat(64)}`;

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function setup(extra = {}) {
  const context = {
    eventId: "event-a", wallet: WALLET_A, chainId: 1337,
    contract: EVENT_CONTRACT, abiVersion: "truth-pays-v7", mode: "local-demo", instanceId: "synthetic-server-one",
  };
  const draft = {
    id: "synthetic-draft-1", eventId: context.eventId, wallet: context.wallet,
    chainId: context.chainId, contract: context.contract, abiVersion: context.abiVersion,
    action: "fundAppeal", valueWei: "10000000000000001",
    transaction: { to: RESOLVER, from: WALLET_A, data: "0xDeAdBeEf", value: "10000000000000001", chainId: 1337 },
  };
  const storage = memoryStorage();
  const journal = createTransactionJournal(storage);
  const requests = [];
  const provider = {
    async request(request) {
      requests.push(structuredClone(request));
      if (request.method === "eth_accounts") return [WALLET_A];
      if (request.method === "eth_chainId") return "0x0539";
      if (request.method === "eth_sendTransaction") return HASH;
      throw new Error(`Unexpected wallet request: ${request.method}`);
    },
  };
  const validate = async () => structuredClone(draft.transaction);
  const confirm = async () => ({ hash: HASH, status: "confirmed", eventId: "event-a", wallet: WALLET_A, blockNumber: 42 });
  return { context, draft, storage, journal, requests, provider, validate, confirm, ...extra };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("wallet submission preserves exact wei and resolver recipient in canonical EIP-1193 hex", async () => {
  const fixture = setup();
  const calls = [];
  const result = await submitWalletDraft({ ...fixture,
    validate: async (eventId, draftId) => { calls.push(["validate", eventId, draftId]); return fixture.draft.transaction; },
    recordSubmitted: async (eventId, draftId, hash, context) => {
      assert.equal(fixture.journal.get(fixture.context, HASH).status, "submitted", "hash is durable before any async callback");
      calls.push(["record", eventId, draftId, hash, context.instanceId]);
    },
    confirm: async (eventId, draftId, hash) => {
      calls.push(["confirm", eventId, draftId, hash]);
      return { hash, eventId, wallet: WALLET_A, status: "confirmed", blockNumber: 42 };
    },
  });
  assert.deepEqual(calls, [
    ["validate", "event-a", "synthetic-draft-1"],
    ["record", "event-a", "synthetic-draft-1", HASH, "synthetic-server-one"],
    ["confirm", "event-a", "synthetic-draft-1", HASH],
  ]);
  const request = fixture.requests.find(item => item.method === "eth_sendTransaction");
  assert.deepEqual(request.params, [{
    to: RESOLVER, from: WALLET_A, data: "0xDeAdBeEf", value: "0x2386f26fc10001", chainId: "0x539",
  }]);
  assert.equal(result.hash, HASH);
  assert.deepEqual(result.context, fixture.context);
  assert.equal(fixture.journal.get(fixture.context, HASH).status, "confirmed");
});

test("a delayed confirmation stays attached to original Event A after the interface switches to B", async () => {
  const fixture = setup(), waiting = deferred(), started = deferred();
  const current = { eventId: "event-a" };
  const confirmedScopes = [];
  const submitted = submitWalletDraft({ ...fixture,
    isCurrentContext: original => original.eventId === current.eventId,
    confirm: async (eventId, draftId, hash) => {
      confirmedScopes.push([eventId, draftId, hash]); started.resolve();
      return waiting.promise;
    },
  });
  await started.promise;
  current.eventId = "event-b";
  fixture.context.eventId = "event-b";
  fixture.context.instanceId = "different-server";
  fixture.draft.id = "other-draft";
  const original = { ...fixture.context, eventId: "event-a", instanceId: "synthetic-server-one" };
  assert.equal(fixture.journal.get(original, HASH).status, "submitted");
  waiting.resolve({ hash: HASH, status: "confirmed", eventId: "event-a", blockNumber: 43 });
  const result = await submitted;
  assert.equal(result.context.eventId, "event-a");
  assert.equal(result.context.instanceId, "synthetic-server-one");
  assert.equal(fixture.journal.get(original, HASH).status, "confirmed");
  assert.deepEqual(fixture.journal.list(fixture.context), []);
  assert.deepEqual(confirmedScopes, [["event-a", "synthetic-draft-1", HASH]]);
});

test("confirmation failure preserves durable hash across reload and never resends the reviewed draft", async () => {
  const fixture = setup();
  await assert.rejects(() => submitWalletDraft({ ...fixture, confirm: async () => { throw new Error("Synthetic RPC disconnected"); } }), error => {
    assert.equal(error.submittedHash, HASH);
    assert.equal(error.transactionContext.eventId, "event-a");
    return /RPC disconnected/.test(error.message);
  });
  const reloaded = createTransactionJournal(fixture.storage);
  assert.equal(reloaded.get(fixture.context, HASH).status, "needs-confirmation");
  assert.match(reloaded.get(fixture.context, HASH).error, /RPC disconnected/);
  const callsBefore = fixture.requests.length;
  await assert.rejects(() => submitWalletDraft({ ...fixture, journal: reloaded }), error => error.code === "TRANSACTION_ALREADY_SUBMITTED" && error.submittedHash === HASH);
  assert.equal(fixture.requests.length, callsBefore, "recorded draft is never sent automatically again");
});

test("optional submitted-record callback failure retains the hash and does not auto-confirm or retry", async () => {
  const fixture = setup();
  let recordingCalls = 0, confirmationCalls = 0;
  await assert.rejects(() => submitWalletDraft({ ...fixture,
    recordSubmitted: async (eventId, draftId, hash) => {
      recordingCalls++;
      assert.equal(eventId, "event-a");
      assert.equal(draftId, "synthetic-draft-1");
      assert.equal(fixture.journal.get(fixture.context, hash).status, "submitted");
      throw new Error("Synthetic pending-record endpoint unavailable");
    },
    confirm: async () => { confirmationCalls++; return { status: "confirmed" }; },
  }), error => error.submittedHash === HASH);
  assert.equal(recordingCalls, 1);
  assert.equal(confirmationCalls, 0);
  assert.equal(fixture.journal.get(fixture.context, HASH).status, "needs-confirmation");
  assert.equal(fixture.requests.filter(item => item.method === "eth_sendTransaction").length, 1);
});

test("journal namespaces isolate event, server instance, chain, event contract, wallet, ABI and mode", () => {
  const fixture = setup();
  fixture.journal.record(fixture.context, { hash: HASH, draftId: "first" });
  const alternatives = [
    { eventId: "event-b" }, { instanceId: "new-server" }, { chainId: 1 },
    { contract: RESOLVER }, { wallet: WALLET_B }, { abiVersion: "future-v8" }, { mode: "staging" },
  ];
  for (const changed of alternatives) {
    const context = { ...fixture.context, ...changed };
    assert.deepEqual(fixture.journal.list(context), []);
    assert.equal(fixture.journal.get(context, HASH), null);
  }
  const rows = fixture.journal.list(fixture.context);
  rows[0].hash = OTHER_HASH;
  rows.push({ hash: OTHER_HASH });
  assert.equal(fixture.journal.list(fixture.context).length, 1);
  assert.equal(fixture.journal.list(fixture.context)[0].hash, HASH, "journal read returns a detached copy");
  assert.equal(fixture.journal.get({ ...fixture.context, chainId: "0x539", wallet: WALLET_A.toUpperCase().replace("0X", "0x") }, HASH).hash, HASH,
    "equivalent chain/address encodings resolve to the same namespace");
});

for (const [name, method, returned, code] of [
  ["wrong wallet", "eth_accounts", [WALLET_B], "WRONG_WALLET"],
  ["wrong chain", "eth_chainId", "0x1", "WRONG_CHAIN"],
]) test(`${name} is rejected before a financial wallet prompt`, async () => {
  const fixture = setup();
  const request = fixture.provider.request;
  fixture.provider.request = async input => input.method === method ? returned : request(input);
  await assert.rejects(() => submitWalletDraft(fixture), error => error.code === code);
  assert.equal(fixture.requests.filter(item => item.method === "eth_sendTransaction").length, 0);
  assert.deepEqual(fixture.journal.list(fixture.context), []);
});

test("a rejected wallet prompt creates no submitted record and has no submittedHash", async () => {
  const fixture = setup();
  const request = fixture.provider.request;
  fixture.provider.request = async input => {
    if (input.method === "eth_sendTransaction") throw Object.assign(new Error("User rejected request"), { code: 4001 });
    return request(input);
  };
  await assert.rejects(() => submitWalletDraft(fixture), error => error.code === 4001 && error.submittedHash === undefined);
  assert.deepEqual(fixture.journal.list(fixture.context), []);
  assert.equal(fixture.storage.values.size, 0, "no retained probe or financial record on rejection");
});

test("blocked storage fails before validation or any wallet request", async () => {
  const fixture = setup();
  let validations = 0;
  const storage = { getItem() { return null; }, setItem() { throw new Error("Storage disabled"); }, removeItem() {} };
  await assert.rejects(() => submitWalletDraft({ ...fixture,
    journal: createTransactionJournal(storage), validate: async () => { validations++; return fixture.draft.transaction; },
  }), error => error.code === "TRANSACTION_STORAGE_UNAVAILABLE" && error.submittedHash === undefined);
  assert.equal(validations, 0);
  assert.deepEqual(fixture.requests, []);
});

test("a quota change after send still returns the submittedHash and never starts confirmation", async () => {
  const fixture = setup();
  let failWrites = false, confirms = 0;
  const setItem = fixture.storage.setItem;
  fixture.storage.setItem = (key, value) => { if (failWrites) throw new Error("Synthetic quota exceeded"); return setItem(key, value); };
  const request = fixture.provider.request;
  fixture.provider.request = async input => {
    const result = await request(input);
    if (input.method === "eth_sendTransaction") failWrites = true;
    return result;
  };
  await assert.rejects(() => submitWalletDraft({ ...fixture, confirm: async () => { confirms++; return {}; } }), error => {
    assert.equal(error.submittedHash, HASH);
    assert.equal(error.draftId, "synthetic-draft-1");
    assert.match(error.message, /wallet submitted/);
    assert.doesNotMatch(error.message, /no transaction was requested/);
    return true;
  });
  assert.equal(confirms, 0);
  assert.equal(fixture.requests.filter(item => item.method === "eth_sendTransaction").length, 1);
});

test("a changed context or changed authoritative transaction invalidates the review before send", async () => {
  const switched = setup();
  let current = true;
  await assert.rejects(() => submitWalletDraft({ ...switched,
    isCurrentContext: () => current,
    validate: async () => { current = false; return switched.draft.transaction; },
  }), error => error.code === "TRANSACTION_CONTEXT_CHANGED");
  assert.equal(switched.requests.length, 0);
  const changed = setup();
  await assert.rejects(() => submitWalletDraft({ ...changed,
    validate: async () => ({ ...changed.draft.transaction, value: "10000000000000002" }),
  }), error => error.code === "TRANSACTION_REVIEW_MISMATCH");
  assert.equal(changed.requests.length, 0);
  assert.deepEqual(changed.journal.list(changed.context), []);
});

test("a context switch during wallet account/network reads is caught before signing", async () => {
  const fixture = setup();
  let current = true;
  const request = fixture.provider.request;
  fixture.provider.request = async input => {
    const result = await request(input);
    if (input.method === "eth_chainId") current = false;
    return result;
  };
  await assert.rejects(() => submitWalletDraft({ ...fixture, isCurrentContext: () => current }), error => error.code === "TRANSACTION_CONTEXT_CHANGED");
  assert.equal(fixture.requests.filter(item => item.method === "eth_sendTransaction").length, 0);
  assert.deepEqual(fixture.journal.list(fixture.context), []);
});

test("same-draft concurrent requests share a guard even with separate journal objects", async () => {
  const fixture = setup(), started = deferred(), waiting = deferred();
  const first = submitWalletDraft({ ...fixture,
    validate: async () => { started.resolve(); await waiting.promise; return fixture.draft.transaction; },
  });
  await started.promise;
  await assert.rejects(() => submitWalletDraft({ ...fixture, journal: createTransactionJournal(fixture.storage) }), error => error.code === "TRANSACTION_SUBMISSION_BUSY");
  waiting.resolve();
  await first;
  assert.equal(fixture.requests.filter(item => item.method === "eth_sendTransaction").length, 1);
});

test("pending or wrong-event confirmations preserve a submitted record rather than claiming success", async () => {
  for (const response of [{ status: "pending", hash: HASH }, { status: "confirmed", eventId: "event-b", hash: HASH }, { status: "confirmed", hash: OTHER_HASH }]) {
    const fixture = setup();
    await assert.rejects(() => submitWalletDraft({ ...fixture, confirm: async () => response }), error => error.submittedHash === HASH);
    assert.equal(fixture.journal.get(fixture.context, HASH).status, "needs-confirmation");
    assert.equal(fixture.requests.filter(item => item.method === "eth_sendTransaction").length, 1);
  }
});

test("a frozen confirmation error cannot hide the submitted hash", async () => {
  const fixture = setup();
  const original = Object.freeze(Object.assign(new Error("Frozen RPC error"), { code: "SYNTHETIC_RPC" }));
  await assert.rejects(() => submitWalletDraft({ ...fixture, confirm: async () => { throw original; } }), error => {
    assert.equal(error.submittedHash, HASH);
    assert.equal(error.code, "SYNTHETIC_RPC");
    assert.equal(error.cause, original);
    return true;
  });
  assert.equal(fixture.journal.get(fixture.context, HASH).status, "needs-confirmation");
});

test("corrupt journals and lossy wei input fail closed before sending", async () => {
  const fixture = setup();
  fixture.journal.record(fixture.context, { hash: HASH, draftId: "old-draft" });
  const key = [...fixture.storage.values.keys()][0];
  fixture.storage.values.set(key, "{bad JSON");
  await assert.rejects(() => submitWalletDraft(fixture), error => error.code === "TRANSACTION_JOURNAL_CORRUPT");
  assert.equal(fixture.requests.length, 0);
  const lossy = setup();
  lossy.draft.transaction.value = 10000000000000001;
  await assert.rejects(() => submitWalletDraft(lossy), error => error.code === "INVALID_TRANSACTION_VALUE");
  assert.equal(lossy.requests.length, 0);
});
