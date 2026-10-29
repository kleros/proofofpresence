// Pure frontend DTO/transport tests only. No DOM, wallet, sockets or chain access.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  V10_PRODUCTION_CONTRACT_VERSION as V10,
  PRODUCTION_CONTRACT_VERSION as V9,
  contractProfileForEvent,
  hasV8FinancialInterface,
  supportsBatchJournalProfile,
} from "../public/contract-profiles.js";
import {
  productionContextIssue,
  isVerifiedV10Upgrade,
} from "../public/environment.js";
import {
  factorySetupIssue,
  factoryReadScope,
  assertCreationDraft,
  assertCreationValidation,
  creationContext,
  creationReviewDisclosure,
} from "../public/luma-factory.js";
import { createOrganizerJobClient } from "../public/luma-setup.js";
import {
  makeLumaSetupFixture,
  makeLumaFactoryDraft,
} from "./fixtures/luma-launch-fixture.mjs";

const address = (digit) => "0x" + digit.repeat(40);
const codeHash = (digit) => "0x" + digit.repeat(64);
const zero = address("0");
const clone = (value) => structuredClone(value);
function fixture() {
  const { bootstrap, detail } = makeLumaSetupFixture();
  const profile = {
    contractVersion: V10,
    abiVersion: V10,
    version: 10,
    financialModel: "v8",
    upgradeable: true,
    verified: true,
    testOnly: false,
    chainId: 1,
    challengeWindowSeconds: 86400,
    matchWindowSeconds: 86400,
    governanceKind: "single-owner-immediate",
    upgradeDelaySeconds: 0,
    renounceable: true,
  };
  const upgrade = {
    kind: "uups",
    version: 10,
    verified: true,
    governanceKind: "single-owner-immediate",
    implementation: address("a"),
    implementationCodeHash: codeHash("b"),
    authority: address("c"),
    authorityCodeHash: codeHash("d"),
    initialOwner: address("e"),
    owner: address("e"),
    pendingOwner: zero,
    upgradesDisabled: false,
    delaySeconds: 0,
    finalizationVerified: false,
    finalizationScope: "event",
  };
  Object.assign(bootstrap, {
    contractVersion: V10,
    abiVersion: V10,
    contractProfile: clone(profile),
    governance: {
      kind: "single-owner-immediate",
      initialOwner: upgrade.initialOwner,
      upgradeDelaySeconds: 0,
      renounceable: true,
    },
  });
  Object.assign(bootstrap.factory, {
    contractVersion: V10,
    abiVersion: V10,
    upgrade: { ...clone(upgrade), finalizationScope: "factory" },
  });
  Object.assign(detail.event, {
    contractVersion: V10,
    abiVersion: V10,
    contractProfile: clone(profile),
  });
  detail.upgrade = clone(upgrade);
  const now = Date.now();
  const input = {
    title: "Synthetic V10 public event",
    lumaUrl: "https://luma.com/synthetic-v10-test",
    startsAt: new Date(Math.floor(now / 1000) * 1000 + 86400000).toISOString(),
    endsAt: new Date(Math.floor(now / 1000) * 1000 + 90000000).toISOString(),
    timezone: "UTC",
    depositEth: "0.01",
  };
  const draft = makeLumaFactoryDraft(bootstrap, input, now);
  draft.contractVersion = V10;
  draft.abiVersion = V10;
  return { bootstrap, detail, input, draft, now };
}
const ready = (f) =>
  productionContextIssue(f.bootstrap, f.detail, {
    requireWallet: true,
    requireTransactions: true,
  });

test("V10 financial presentation and batch namespaces require the exact production profile", () => {
  const f = fixture();
  assert.equal(hasV8FinancialInterface(f.detail.event), true);
  assert.equal(contractProfileForEvent(f.detail.event).version, 10);
  for (const patch of [
    { abiVersion: V9 },
    { chainId: 10200 },
    { contractVersion: V10 + "-unknown" },
    { contractProfile: { ...f.detail.event.contractProfile, verified: false } },
  ])
    assert.equal(
      hasV8FinancialInterface({ ...f.detail.event, ...patch }),
      false,
    );
  assert.equal(
    supportsBatchJournalProfile({
      contractVersion: V10,
      chainId: 1,
      mode: "hosted-production",
    }),
    true,
  );
  for (const patch of [
    { chainId: 10200 },
    { mode: "hosted-demo" },
    { contractVersion: V10 + "x" },
  ])
    assert.equal(
      supportsBatchJournalProfile({
        contractVersion: V10,
        chainId: 1,
        mode: "hosted-production",
        ...patch,
      }),
      false,
    );
  assert.equal(
    hasV8FinancialInterface({ contractVersion: "truth-pays-v7" }),
    false,
  );
  assert.equal(
    hasV8FinancialInterface({ contractVersion: "kleros-event-v8" }),
    true,
  );
});

test("V10 context accepts its immediate metadata and cannot borrow V9 profile, ABI or governance", () => {
  const f = fixture();
  f.bootstrap.capabilities.transactionsReady = true;
  assert.equal(ready(f), null);
  for (const mutate of [
    (b) => delete b.abiVersion,
    (b) => (b.contractVersion = V9),
    (b) => (b.contractProfile.version = 9),
    (b) => (b.governance.kind = "single-owner-timelock"),
    (b) => (b.governance.upgradeDelaySeconds = 172800),
    (b) => (b.governance.renounceable = false),
  ]) {
    const bad = clone(f);
    mutate(bad.bootstrap);
    assert.equal(typeof ready(bad), "string");
  }
  assert.equal(factorySetupIssue(f.bootstrap, { requireWallet: true }), null);
  const foreignInitialOwner = clone(f);
  foreignInitialOwner.bootstrap.governance.initialOwner = address("f");
  assert.equal(typeof ready(foreignInitialOwner), "string");
  assert.equal(
    typeof factorySetupIssue(foreignInitialOwner.bootstrap),
    "string",
  );
  const v9 = makeLumaSetupFixture();
  assert.equal(factorySetupIssue(v9.bootstrap, { requireWallet: true }), null);
});

test("V10 finalization is scoped, verified and consistent rather than inferred from zero ownership", () => {
  const { detail } = fixture();
  assert.equal(isVerifiedV10Upgrade(detail.upgrade, "event"), true);
  assert.equal(isVerifiedV10Upgrade(detail.upgrade, "factory"), false);
  const frozen = {
    ...detail.upgrade,
    owner: zero,
    pendingOwner: zero,
    upgradesDisabled: true,
    finalizationVerified: true,
  };
  assert.equal(isVerifiedV10Upgrade(frozen, "event"), true);
  for (const patch of [
    { owner: zero },
    { pendingOwner: null },
    { delaySeconds: 172800 },
    { finalizationVerified: true },
    { authorityCodeHash: codeHash("0") },
    { pendingOperationCount: 0 },
    { pending: null },
    { version: 9 },
    { governanceKind: "single-owner-timelock" },
    { finalizationScope: "factory" },
  ])
    assert.equal(
      isVerifiedV10Upgrade({ ...detail.upgrade, ...patch }, "event"),
      false,
      JSON.stringify(patch),
    );
  assert.equal(
    isVerifiedV10Upgrade({ ...frozen, owner: address("e") }, "event"),
    false,
  );
  assert.equal(
    isVerifiedV10Upgrade({ ...frozen, pendingOwner: address("f") }, "event"),
    false,
  );
  const f = fixture();
  Object.assign(f.bootstrap.factory.upgrade, frozen, {
    finalizationScope: "factory",
  });
  assert.equal(
    factorySetupIssue(f.bootstrap),
    null,
    "permissionless creation survives verified controller renunciation",
  );
});

test("V10 context still denies delegated, contract and unsupported wallet metadata", () => {
  for (const mutate of [
    (b) => (b.capabilities.eip7702 = true),
    (b) => (b.capabilities.erc1271 = true),
    (b) => b.capabilities.supportedAccountTypes.push("delegated"),
    (b) => (b.walletSupport.eip7702 = true),
    (b) => (b.walletSupport.type = "reviewed-delegation"),
    (b) => (b.capabilities.serverSigning = true),
  ]) {
    const f = fixture();
    mutate(f.bootstrap);
    assert.equal(typeof factorySetupIssue(f.bootstrap), "string");
  }
});

test("only the whole future source-policy metadata is accepted for V10, never partially or by V9", () => {
  const active = fixture();
  active.bootstrap.capabilities.transactionsReady = true;
  Object.assign(active.bootstrap.walletSupport, {
    type: "eoa-or-metamask-protected-self-v1.3",
    eoa: true,
    eip7702: true,
    erc1271: false,
    accountPolicyVersion: "v10-metamask-self-v1.3-1",
  });
  Object.assign(active.bootstrap.capabilities, {
    supportedAccountTypes: ["eoa", "metamask-protected-self-v1.3"],
    eip7702: true,
    erc1271: false,
    contractWallets: false,
  });
  assert.equal(ready(active), null);
  assert.equal(factorySetupIssue(active.bootstrap), null);
  for (const mutate of [
    (b) => delete b.walletSupport.accountPolicyVersion,
    (b) => (b.walletSupport.accountPolicyVersion += "-unknown"),
    (b) => (b.walletSupport.type = "eoa-only"),
    (b) => (b.walletSupport.eip7702 = false),
    (b) => (b.capabilities.eip7702 = false),
    (b) => b.capabilities.supportedAccountTypes.reverse(),
    (b) => b.capabilities.supportedAccountTypes.push("erc1271"),
    (b) => (b.capabilities.contractWallets = true),
    (b) => (b.capabilities.serverSigning = true),
  ]) {
    const bad = clone(active);
    mutate(bad.bootstrap);
    assert.equal(typeof ready(bad), "string");
  }
  const legacy = makeLumaSetupFixture();
  legacy.bootstrap.walletSupport = clone(active.bootstrap.walletSupport);
  Object.assign(legacy.bootstrap.capabilities, {
    supportedAccountTypes: ["eoa", "metamask-protected-self-v1.3"],
    eip7702: true,
  });
  assert.equal(typeof factorySetupIssue(legacy.bootstrap), "string");
});

test("V10 draft review and known-hash recovery retain profile, actor and deployment boundaries", () => {
  const f = fixture(),
    context = creationContext(f.bootstrap, f.draft);
  assert.equal(context.abiVersion, V10);
  assert.equal(
    assertCreationDraft(f.draft, f.bootstrap, f.input, f.now),
    f.draft,
  );
  assert.deepEqual(
    assertCreationValidation(
      { draft: f.draft, transaction: f.draft.transaction },
      f.draft,
      f.bootstrap,
    ),
    f.draft.transaction,
  );
  for (const patch of [
    { abiVersion: V9 },
    { contractVersion: V9 },
    { wallet: address("f") },
    { instanceId: "foreign-instance" },
  ])
    assert.throws(() =>
      assertCreationDraft(
        { ...f.draft, ...patch },
        f.bootstrap,
        f.input,
        f.now,
      ),
    );
  const unavailable = clone(f.bootstrap);
  unavailable.factory.deploymentTrust.status = "changed";
  unavailable.capabilities.createEvents = false;
  assert.deepEqual(
    factoryReadScope(unavailable),
    factoryReadScope(f.bootstrap),
  );
  assert.equal(typeof factorySetupIssue(unavailable), "string");
  for (const mutate of [
    (b) => (b.factory.contractVersion = V9),
    (b) => (b.abiVersion = V9),
    (b) => (b.mode = "hosted-demo"),
  ]) {
    const bad = clone(f.bootstrap);
    mutate(bad);
    assert.throws(() => factoryReadScope(bad));
  }
});

test("V10 discloses public publication and immediate authority before review; V9 words stay separate", () => {
  const f = fixture(),
    disclosure = creationReviewDisclosure(f.bootstrap);
  assert.equal(disclosure.publication, "Public · Published");
  assert.match(disclosure.publicationNotice, /After verified creation/);
  assert.match(disclosure.publicationNotice, /public event directory/);
  assert.match(disclosure.publicationNotice, /No guest names or emails/);
  assert.match(
    disclosure.upgradeNotice,
    /immediately until ownership is renounced/,
  );
  assert.doesNotMatch(disclosure.upgradeNotice, /48.hour|timelock/i);
  assert.equal(
    creationReviewDisclosure(makeLumaSetupFixture().bootstrap),
    null,
  );
  f.bootstrap.factory.upgrade.owner = zero;
  f.bootstrap.factory.upgrade.upgradesDisabled = true;
  f.bootstrap.factory.upgrade.finalizationVerified = true;
  assert.match(
    creationReviewDisclosure(f.bootstrap).upgradeNotice,
    /permanently disabled/,
  );
  f.bootstrap.factory.upgrade.finalizationScope = "event";
  assert.equal(creationReviewDisclosure(f.bootstrap), null);
});

class Storage {
  data = new Map([
    ["kleros-transactions:v1:original", "original-financial-hash"],
  ]);
  getItem(key) {
    return this.data.get(key) ?? null;
  }
  setItem(key, value) {
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}
function clientFixture(profile = V10, storage = new Storage()) {
  const f = profile === V10 ? fixture() : makeLumaSetupFixture();
  const calls = [],
    jobs = new Map();
  let sequence = 0;
  const options = {
    bootstrap: f.bootstrap,
    storage,
    origin: "https://synthetic.invalid",
    now: () => 1_000_000,
    newId: () => "synthetic-job-" + ++sequence,
    request: async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET" });
      const body = init.body ? JSON.parse(init.body) : null;
      if (body) jobs.set(body.requestId, body);
      const requestId = body?.requestId ?? url.split("/").at(-1);
      const operation =
        body?.operation ?? jobs.get(requestId)?.operation ?? "prepare";
      return {
        schemaVersion: 1,
        kind: "organizer-job",
        requestId,
        instanceId: f.bootstrap.instanceId,
        operation,
        chainId: 1,
        factory: f.bootstrap.factory.address,
        wallet: f.bootstrap.session.wallet,
        contractVersion: profile,
        state: "ready",
        expiresAt: 1_005_000,
        result:
          operation === "reconcile"
            ? {
                status: "pending",
                hash: body.hash,
                chainId: 1,
                wallet: f.bootstrap.session.wallet,
                eventId: "synthetic-created-event",
              }
            : { id: "synthetic-draft" },
      };
    },
  };
  return {
    ...f,
    storage,
    calls,
    options,
    create: () => createOrganizerJobClient(options),
  };
}

test("V10 lost acknowledgement resumes only its exact job GET and never consumes a V9 marker", async () => {
  const f = clientFixture(),
    request = f.options.request;
  f.options.request = async (...args) => {
    if (args[1]?.method === "POST") {
      f.calls.push({ method: "POST" });
      throw Error("synthetic lost acknowledgement");
    }
    return request(...args);
  };
  await assert.rejects(
    f.create().run("prepare", { input: f.input }),
    /lost acknowledgement/,
  );
  const saved = [...f.storage.data.values()].find((value) =>
    value.startsWith('{"version":1'),
  );
  assert.equal(JSON.parse(saved).scope.contractVersion, V10);
  const reloaded = f.create();
  await reloaded.run("prepare", { input: f.input });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["POST", "GET"],
  );
  const other = clientFixture(V9, f.storage);
  await other.create().run("prepare", { input: f.input });
  assert.equal(
    other.calls[0].method,
    "POST",
    "V9 never adopts the V10 job identity",
  );
  assert.equal(
    f.storage.getItem("kleros-transactions:v1:original"),
    "original-financial-hash",
  );
  reloaded.dispose();
});

test("V10 jobs reject foreign profile envelopes and retire pending checks only for the same V10 context", async () => {
  const bad = clientFixture(),
    request = bad.options.request;
  bad.options.request = async (...args) => ({
    ...(await request(...args)),
    contractVersion: V9,
  });
  await assert.rejects(bad.create().run("prepare", { input: bad.input }), {
    code: "ORGANIZER_JOB_SCOPE",
  });
  const f = clientFixture(),
    client = f.create(),
    hash = codeHash("a"),
    draftId = "synthetic-draft";
  const result = await client.run("reconcile", { draftId, hash });
  const context = { ...factoryReadScope(f.bootstrap), eventId: result.eventId };
  assert.throws(
    () =>
      client.advancePendingReceipt({
        draftId,
        hash,
        result,
        context: { ...context, abiVersion: V9 },
      }),
    { code: "ORGANIZER_JOB_ADVANCE" },
  );
  client.advancePendingReceipt({ draftId, hash, result, context });
  await client.run("reconcile", { draftId, hash });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["POST", "POST"],
  );
  assert.equal(
    f.storage.getItem("kleros-transactions:v1:original"),
    "original-financial-hash",
  );
  client.dispose();
});
