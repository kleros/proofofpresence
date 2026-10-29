import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lumaReturnUrl,
  participantDeposit,
  knownAttendanceStandard,
  attendanceStandardText,
} from "../public/luma-launch.js";
import {
  lumaEventUrl,
  depositWei,
  factorySetupIssue,
  factoryReadScope,
  creationContext,
  assertCreationDraft,
  assertCreationValidation,
  canonicalParticipantUrl,
  assertCreationReceipt,
} from "../public/luma-factory.js";
import {
  makeLumaLaunchFixture,
  makeLumaSetupFixture,
  makeLumaFactoryDraft,
  LUMA_LAUNCH_URL,
  LUMA_CREATED_EVENT_ID,
} from "./fixtures/luma-launch-fixture.mjs";

// Synthetic DTO validation only: no ABI execution, RPC, wallet or external service.
const copy = (value) => structuredClone(value);
const other = `0x${"f".repeat(40)}`;
const hash = `0x${"7".repeat(64)}`;
const origin = "https://launch.example.test";
test("attendance disclosure recognizes only the exact server standard without a physical-only assumption", () => {
  const standard = {
    attendanceMode: "event-participation",
    attendanceRule: "presence-during-immutable-interval-v1",
    evidenceRule:
      "balance-of-probabilities-with-case-organizer-confirmation-v1",
  };
  const before = JSON.stringify(standard);
  assert.equal(knownAttendanceStandard(standard), true);
  const text = attendanceStandardText(standard);
  assert.match(text, /in person or online/);
  assert.match(text, /No full-duration minimum/);
  assert.match(
    text,
    /Payment, a Luma RSVP or a personal mark alone is not attendance/,
  );
  assert.match(text, /balance of probabilities/);
  assert.match(text, /actual posted-list challenge deadline/);
  assert.match(text, /does not imply on-chain enforcement/);
  for (const value of [
    null,
    [],
    "event-participation",
    Object.create(standard),
    { ...standard, attendanceMode: "physical-only" },
    { ...standard, attendanceRule: true },
    { ...standard, evidenceRule: "different" },
    { ...standard, extra: true },
  ]) {
    assert.equal(knownAttendanceStandard(value), false);
    assert.equal(attendanceStandardText(value), null);
  }
  assert.equal(JSON.stringify(standard), before);
});
function factory() {
  const { bootstrap } = makeLumaSetupFixture();
  const now = Date.now();
  const input = {
    title: "Synthetic Luma event",
    lumaUrl: LUMA_LAUNCH_URL,
    startsAt: new Date(Math.floor(now / 1000) * 1000 + 86400000).toISOString(),
    endsAt: new Date(Math.floor(now / 1000) * 1000 + 90000000).toISOString(),
    timezone: "UTC",
    depositEth: "0.01",
  };
  return {
    bootstrap,
    input,
    now,
    draft: makeLumaFactoryDraft(bootstrap, input, now),
  };
}

test("Luma return URLs reject redirects, credentials, host spoofing and attached data", () => {
  assert.equal(lumaReturnUrl(LUMA_LAUNCH_URL), LUMA_LAUNCH_URL);
  assert.equal(lumaEventUrl(LUMA_LAUNCH_URL), LUMA_LAUNCH_URL);
  for (const url of [
    "http://luma.com/event",
    "https://lu.ma/event",
    "https://luma.com.evil.test/event",
    "https://user:password@luma.com/event",
    "https://luma.com/event?wallet=secret",
    "https://luma.com/event#receipt",
    "https://luma.com:444/event",
    "javascript:alert(1)",
  ]) {
    assert.equal(lumaReturnUrl(url), null, url);
    assert.equal(lumaEventUrl(url), null, url);
  }
  assert.equal(lumaReturnUrl(`https://luma.com/${"a".repeat(1000)}`), null);
});

test("canonical participant receipt is frozen, scoped and leaves its DTO untouched", () => {
  const { bootstrap, detail } = makeLumaLaunchFixture("confirmed");
  const before = JSON.stringify(detail);
  const receipt = participantDeposit(detail, bootstrap.session.wallet);
  assert.equal(receipt.status, "confirmed");
  assert.equal(receipt.hash, detail.ownWallet.deposit.hash);
  assert(Object.isFrozen(receipt));
  assert.equal(JSON.stringify(detail), before);
});

test("every direct receipt binding and jointly missing identity fields fail closed", () => {
  const { bootstrap, detail } = makeLumaLaunchFixture("confirmed");
  for (const patch of [
    { wallet: other },
    { eventId: "another-event" },
    { chainId: 10200 },
    { contract: other },
    { abiVersion: "another-abi" },
  ]) {
    const altered = copy(detail);
    Object.assign(altered.ownWallet.deposit, patch);
    assert.equal(
      participantDeposit(altered, bootstrap.session.wallet).status,
      "unavailable",
    );
  }
  for (const [eventField, receiptField] of [
    ["id", "eventId"],
    ["chainId", "chainId"],
    ["abiVersion", "abiVersion"],
  ]) {
    const altered = copy(detail);
    delete altered.event[eventField];
    delete altered.ownWallet.deposit[receiptField];
    assert.equal(
      participantDeposit(altered, bootstrap.session.wallet).status,
      "unavailable",
    );
  }
});

test("confirmation needs positive exact amount, a real hash and an integer block, not a profile hint", () => {
  const { bootstrap, detail } = makeLumaLaunchFixture("confirmed");
  for (const patch of [
    { hash: null },
    { hash: `0x${"0".repeat(64)}` },
    { amountWei: "0" },
    { amountWei: "-1" },
    { amountWei: "1.5" },
    { blockNumber: null },
    { blockNumber: 1.5 },
    { blockNumber: -1 },
  ]) {
    const altered = copy(detail);
    Object.assign(altered.ownWallet.deposit, patch);
    assert.equal(
      participantDeposit(altered, bootstrap.session.wallet).status,
      "unavailable",
    );
  }
  const profileOnly = copy(detail);
  delete profileOnly.ownWallet.deposit;
  profileOnly.participants = [
    {
      wallet: bootstrap.session.wallet,
      identityVerified: true,
      deposit: { verified: true, txHash: hash },
    },
  ];
  assert.equal(
    participantDeposit(profileOnly, bootstrap.session.wallet).status,
    "unavailable",
  );
});

test("factory setup permits its verified capability without existing events or participant transaction readiness", () => {
  const { bootstrap } = factory();
  assert.deepEqual(bootstrap.events, []);
  assert.equal(bootstrap.capabilities.transactionsReady, false);
  assert.equal(factorySetupIssue(bootstrap, { requireWallet: true }), null);
  const anonymous = copy(bootstrap);
  anonymous.session = null;
  assert.equal(factorySetupIssue(anonymous), null);
  assert.match(
    factorySetupIssue(anonymous, { requireWallet: true }),
    /wallet|authenticate/i,
  );
});

test("unpublished policy, incompatible factory/governance and unsupported EOA capabilities cannot authorize setup", () => {
  const { bootstrap } = factory();
  const alter = [
    (b) => (b.organizerSetup.policyStatus = "unpublished"),
    (b) => delete b.organizerSetup.attendanceStandard,
    (b) =>
      (b.organizerSetup.attendanceStandard.attendanceRule = "another-standard"),
    (b) => (b.organizerSetup.policySha256 = "not-a-sha"),
    (b) => (b.capabilities.createEvents = false),
    (b) => (b.capabilities.serverSigning = true),
    (b) => (b.capabilities.supportedAccountTypes = ["eoa", "erc1271"]),
    (b) => (b.factory.chainId = 10200),
    (b) => (b.factory.abiVersion = "kleros-event-v8"),
    (b) => (b.factory.deploymentTrust.status = "changed"),
    (b) => (b.factory.upgrade.pendingOperationCount = -1),
    (b) => (b.factory.upgrade.delaySeconds = 900),
    (b) => (b.governance.kind = "multisig"),
  ];
  for (const mutation of alter) {
    const altered = copy(bootstrap);
    mutation(altered);
    assert.equal(typeof factorySetupIssue(altered), "string");
  }
});

test("ETH amount parsing preserves wei and rejects floating or nonpositive inputs", () => {
  assert.equal(depositWei("0.000000000000000001"), "1");
  assert.equal(depositWei("0.01"), "10000000000000000");
  for (const input of [
    "0",
    "-1",
    "1e-2",
    ".01",
    "0.0000000000000000001",
    "NaN",
  ])
    assert.throws(() => depositWei(input));
});

test("factory review binds the actor, instance, chain, factory and millisecond expiry", () => {
  const { bootstrap, draft, input, now } = factory();
  assert.equal(assertCreationDraft(draft, bootstrap, input, now), draft);
  const patches = [
    { wallet: other },
    { instanceId: "other-instance" },
    { chainId: 10200 },
    { contract: other },
    { mode: "hosted-v9-testnet" },
    { abiVersion: "wrong" },
    { expiresAt: now },
    {
      createdAt: Math.floor(now / 1000),
      expiresAt: Math.floor(now / 1000) + 300,
    },
  ];
  for (const patch of patches) {
    const altered = copy(draft);
    Object.assign(altered, patch);
    assert.throws(() => assertCreationDraft(altered, bootstrap, input, now));
  }
});

test("changed input or immutable terms and malformed transaction wrappers require a fresh review", () => {
  const { bootstrap, draft, input, now } = factory();
  assert.throws(() =>
    assertCreationDraft(draft, bootstrap, { ...input, title: "Changed" }, now),
  );
  for (const patch of [
    { claimDays: 6 },
    { capacity: 151 },
    { challengeWindowSeconds: 900 },
    { depositWei: "1" },
    { policyURI: "other-policy" },
    { attendanceStandard: null },
    {
      attendanceStandard: {
        attendanceMode: "event-participation",
        attendanceRule: "presence-during-immutable-interval-v1",
        evidenceRule: "unsupported",
      },
    },
  ]) {
    const altered = copy(draft);
    Object.assign(altered.terms, patch);
    assert.throws(() => assertCreationDraft(altered, bootstrap, input, now));
  }
  const wrapper = { draft: copy(draft), transaction: copy(draft.transaction) };
  assert.deepEqual(
    assertCreationValidation(wrapper, draft, bootstrap),
    draft.transaction,
  );
  const changedCalldata = copy(wrapper);
  changedCalldata.transaction.data = "0x87654321";
  assert.throws(() =>
    assertCreationValidation(changedCalldata, draft, bootstrap),
  );
  const changedTerms = copy(wrapper);
  changedTerms.draft.terms.title = "Changed";
  assert.throws(() => assertCreationValidation(changedTerms, draft, bootstrap));
  const changedSnapshot = copy(wrapper);
  changedSnapshot.draft.snapshot = "c".repeat(64);
  assert.throws(() =>
    assertCreationValidation(changedSnapshot, draft, bootstrap),
  );
});

test("known-hash read scope survives current factory trust loss without becoming creation authority", () => {
  const { bootstrap, draft } = factory();
  const context = creationContext(bootstrap, draft),
    altered = copy(bootstrap);
  altered.factory.deploymentTrust.status = "changed";
  assert.deepEqual(factoryReadScope(altered), factoryReadScope(bootstrap));
  assert.equal(creationContext(altered, draft).eventId, context.eventId);
  assert.equal(typeof factorySetupIssue(altered), "string");
  const another = copy(altered);
  another.mode = "hosted-v9-testnet";
  assert.throws(() => factoryReadScope(another));
});

test("canonical sharing requires this onboarded child and an exact same-origin participant event URL", () => {
  const { bootstrap, draft } = factory(),
    context = creationContext(bootstrap, draft);
  const participantUrl = `${origin}/#event=${LUMA_CREATED_EVENT_ID}&view=participant`;
  assert.equal(
    canonicalParticipantUrl(participantUrl, context.eventId, origin),
    participantUrl,
  );
  for (const url of [
    `https://evil.test/#event=${context.eventId}&view=participant`,
    `${origin}/#event=other&view=participant`,
    `${participantUrl}&returnUrl=https://evil.test`,
    `${origin}/?wallet=secret#event=${context.eventId}&view=participant`,
    `${origin}/other/#event=${context.eventId}&view=participant`,
  ])
    assert.equal(canonicalParticipantUrl(url, context.eventId, origin), null);
  const result = {
    status: "confirmed",
    hash,
    eventId: context.eventId,
    chainId: 1,
    wallet: context.wallet,
    blockNumber: 120,
    contract: other,
    participantUrl,
  };
  assert.equal(
    assertCreationReceipt(result, context, hash, origin).participantUrl,
    participantUrl,
  );
  for (const patch of [
    { wallet: other },
    { eventId: "other-event" },
    { blockNumber: null },
    { contract: context.contract },
    { contract: null },
    { participantUrl: undefined },
    { hash: `0x${"8".repeat(64)}` },
  ])
    assert.throws(() =>
      assertCreationReceipt({ ...result, ...patch }, context, hash, origin),
    );
  assert.equal(
    assertCreationReceipt(
      { status: "pending", hash, eventId: context.eventId },
      context,
      hash,
      origin,
    ).status,
    "pending",
  );
});
