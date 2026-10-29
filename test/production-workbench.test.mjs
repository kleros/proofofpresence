// Real v9 proxies and workbench financial methods on an in-process chain1 only.
// Trusted dependency injection bypasses public mainnet configuration/Court verification;
// those have separate runtime/fork tests. Only Court adjudication is controlled here.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { isVerifiedProductionEvent } from "../public/contract-profiles.js";
import {
  createLumaLaunchRuntime,
  LUMA_LOCAL_DEPOSIT_WEI,
  LUMA_LOCAL_DAY,
  LUMA_LOCAL_GAS,
} from "./fixtures/luma-launch-runtime.mjs";

const D = LUMA_LOCAL_DEPOSIT_WEI,
  DAY = LUMA_LOCAL_DAY,
  A = "production-local-a",
  B = "production-local-b";
const GAS = LUMA_LOCAL_GAS,
  send = async (p) => (await p).wait();
let fixture,
  rpc,
  provider,
  w,
  owner,
  alice,
  bob,
  credit,
  sessions,
  records,
  liquid,
  resolver,
  runtime;
let reads, forbiddenBackendCalls, race, trustFault;
const lower = (s) => String(s).toLowerCase();
const attendancePaid = (projection, wallet) =>
  projection.transfers
    .filter(
      (t) =>
        t.type === "attendance-payout" &&
        t.successful &&
        lower(t.recipient) === lower(wallet),
    )
    .reduce((sum, t) => sum + BigInt(t.amountWei), 0n);

before(async () => {
  fixture = await createLumaLaunchRuntime({ eventIds: [A, B], depositWei: D });
  ({
    rpc,
    provider,
    liquid,
    resolver,
    runtime,
    reads,
    forbiddenBackendCalls,
    race,
    trustFault,
  } = fixture);
  ({ organizer: owner, payer: alice, bob, credit } = fixture.actors);
  records = fixture.manifest.events;
  await send(
    credit.sendTransaction({
      to: records[1].deployment.contract,
      value: D,
      gasLimit: 100000,
    }),
  );
  w = await fixture.createWorkbench();
  sessions = Object.fromEntries(
    await Promise.all(
      Object.entries({ owner, alice, bob, credit }).map(
        async ([role, wallet]) => {
          const message = `Synthetic workbench ${role} session only`;
          assert.equal(
            ethers.verifyMessage(message, await wallet.signMessage(message)),
            wallet.address,
          );
          return [
            role,
            {
              id: `synthetic-${role}`,
              wallet: wallet.address,
              label: role,
              mode: "wallet",
            },
          ];
        },
      ),
    ),
  );
});
after(async () => {
  await fixture?.close();
});

async function walletAction(
  eventId,
  role,
  action,
  params = {},
  reconcile = false,
) {
  const s = sessions[role],
    signer = { owner, alice, bob, credit }[role];
  const draft = await w.createDraft(eventId, s, { action, params });
  if (action === "deposit") {
    const person = [...w.record(eventId, s).participants.values()].find(
      (p) => p.wallet.toLowerCase() === s.wallet.toLowerCase(),
    );
    assert(
      person,
      "Preparing the wallet-first deposit creates its minimal app participant",
    );
    assert.equal(person.name, null);
    assert.equal(person.email, null);
    assert.equal(person.identityVerified, false);
    assert.equal(person.walletVerified, true);
    assert.equal(person.deposit, null, "A draft is not a confirmed receipt");
  }
  const validated = await w.validateDraft(eventId, s, draft.id);
  assert.equal(validated.d.transaction.from, signer.address);
  assert.equal(validated.d.transaction.chainId, 1);
  assert.equal(validated.d.snapshot, (await w.state(eventId)).fingerprint);
  const sent = await signer.sendTransaction({
    ...validated.d.transaction,
    ...GAS,
  });
  const submitted = await w.recordSubmitted(eventId, s, draft.id, sent.hash);
  assert.equal(submitted.status, "pending");
  const receipt = await sent.wait();
  assert.equal(receipt.status, 1);
  const result = reconcile
    ? await w.reconcileSubmission(eventId, s, draft.id, sent.hash)
    : await w.confirmDraft(eventId, s, draft.id, sent.hash);
  assert.equal(result.status, "confirmed");
  return { draft, receipt, hash: sent.hash };
}

test(
  "actual production bootstrap and detail DTOs satisfy the verified UI profile contract",
  { timeout: 60000 },
  async () => {
    const bundle = await w.bootstrap(sessions.owner, { selectedEventId: B });
    assert.equal(bundle.mode, "hosted-production");
    assert.equal(
      bundle.selectedEvent.detail.deploymentTrust.status,
      "verified",
    );
    assert.equal(bundle.selectedEvent.detail.upgrade.kind, "uups");
    assert.equal(
      bundle.selectedEvent.detail.upgrade.governanceKind,
      "single-owner-timelock",
    );
    assert.equal(
      bundle.selectedEvent.detail.upgrade.owner,
      fixture.actors.upgradeOwner.address,
    );
    assert.equal(
      bundle.selectedEvent.detail.event.organizers[0],
      owner.address,
    );
    assert.notEqual(owner.address, fixture.actors.upgradeOwner.address);
    assert.equal(bundle.selectedEvent.detail.upgrade.pendingOwner, null);
    assert.equal(bundle.selectedEvent.detail.upgrade.pendingOperationCount, 0);
    assert(!Object.hasOwn(bundle.selectedEvent.detail.upgrade, "multisig"));
    const summary = bundle.events.find((event) => event.id === B),
      detail = await w.detail(B, sessions.owner);
    for (const event of [
      summary,
      bundle.selectedEvent.detail.event,
      detail.event,
    ]) {
      assert.equal(event.contractVersion, "kleros-event-v9-uups");
      assert.equal(event.abiVersion, "kleros-event-v9-uups");
      assert.equal(event.contractProfile.verified, true);
      assert.equal(event.contractProfile.version, 9);
      assert.equal(event.contractProfile.challengeWindowSeconds, DAY);
      assert.equal(event.contractProfile.matchWindowSeconds, DAY);
      assert.equal(
        isVerifiedProductionEvent(event),
        true,
        "Real API DTO must pass actual UI gate",
      );
    }
  },
);

test(
  "an unreviewed private A cannot deny valid B or disclose private A in production bootstrap",
  { timeout: 60000 },
  async () => {
    const a = w.record(A, sessions.owner),
      original = {
        visibility: a.definition.visibility,
        description: a.definition.description,
      };
    const secret = "PRIVATE_A_UNREVIEWED_METADATA_SENTINEL";
    try {
      a.definition.visibility = "private";
      a.definition.description = secret;
      trustFault.contract = a.deployment.contract;
      const selectedB = await w.bootstrap(sessions.owner, {
        selectedEventId: B,
      });
      assert.equal(selectedB.selectedEvent.detail.event.id, B);
      assert.equal(
        selectedB.selectedEvent.detail.deploymentTrust.status,
        "verified",
      );
      assert.deepEqual(
        selectedB.events.map((event) => event.id),
        [B],
      );
      const selectedA = await w.bootstrap(sessions.owner, {
        selectedEventId: A,
      });
      assert.equal(selectedA.selectedEvent.detail, null);
      assert.equal(
        selectedA.selectedEvent.error.code,
        "SELECTED_EVENT_UNAVAILABLE",
      );
      assert.deepEqual(
        selectedA.events.map((event) => event.id),
        [B],
      );
      const directory = await w.bootstrap(sessions.owner);
      assert.deepEqual(
        directory.events.map((event) => event.id),
        [B],
      );
      for (const response of [selectedB, selectedA, directory]) {
        const encoded = JSON.stringify(response);
        assert.equal(encoded.includes(secret), false);
        assert.equal(encoded.includes(a.definition.title), false);
        assert.equal(encoded.includes(a.deployment.contract), false);
      }
    } finally {
      trustFault.contract = null;
      Object.assign(a.definition, original);
    }
    assert.equal(
      (await w.detail(A, sessions.owner)).deploymentTrust.status,
      "verified",
      "Restore before financial execution",
    );
  },
);

test(
  "proxy-backed production workbench completes deposits to held share to same-wallet paid settlement",
  { timeout: 90000 },
  async () => {
    assert.deepEqual(w.chain.signers, []);
    assert.equal(
      w.record(A, sessions.owner).participants.size,
      0,
      "There is no prerequisite name/email participant registration",
    );
    const alicePayment = await walletAction(A, "alice", "deposit");
    const bobPayment = await walletAction(A, "bob", "deposit", {}, true);
    const participant = (wallet) =>
      [...w.record(A, sessions.owner).participants.values()].find(
        (p) => p.wallet.toLowerCase() === wallet.address.toLowerCase(),
      );
    const a = participant(alice),
      b = participant(bob);
    for (const person of [a, b]) {
      assert(person);
      assert.equal(person.name, null);
      assert.equal(person.email, null);
      assert.equal(person.identityVerified, false);
      assert.equal(person.walletVerified, true);
      assert.equal(person.identitySource, "signed-wallet-nonce");
      assert.equal(person.admission, "pending");
    }
    for (const [session, payment] of [
      [sessions.alice, alicePayment],
      [sessions.bob, bobPayment],
    ]) {
      const own = (await w.detail(A, session)).ownWallet;
      assert.equal(own.pendingCreditWei, String(D));
      assert.equal(own.deposit.status, "confirmed");
      assert.equal(own.deposit.hash, payment.hash);
      assert.equal(own.deposit.amountWei, String(D));
      assert.equal(own.deposit.blockNumber, payment.receipt.blockNumber);
      assert.equal(
        (await provider.getBlock(payment.receipt.blockNumber)).hash,
        payment.receipt.blockHash,
      );
    }
    const bBefore = await w.state(B);
    await w.admit(A, sessions.owner, a.id, "approved");
    await w.admit(A, sessions.owner, b.id, "approved");
    await walletAction(A, "owner", "register", {
      wallets: [alice.address, bob.address],
    });
    assert.equal((await w.state(A)).poolWei, String(2n * D));
    assert.equal((await w.state(A)).pendingTotalWei, "0");
    await assert.rejects(
      w.executeDraft(A, sessions.owner, "anything"),
      (e) => e.code === "WALLET_SIGNATURE_REQUIRED",
    );
    await assert.rejects(w.advance(DAY), (e) => e.status === 403);
    await assert.rejects(
      w.mockRuling(A, sessions.owner, bob.address, 1),
      (e) => e.status === 403,
    );
    await rpc.request({
      method: "evm_setTime",
      params: [records[0].deployment.eventStart * 1000],
    });
    await rpc.request({ method: "evm_mine", params: [] });
    await w.checkin(A, sessions.owner, {
      participantId: a.id,
      source: "staff-door",
      nonce: "synthetic-production-alice",
    });
    await walletAction(A, "owner", "postAttendance");
    await walletAction(A, "bob", "challenge", {}, true);
    const exported = await w.caseArtifact(A, sessions.bob, bob.address);
    assert.equal(exported.publication.status, "exported");
    assert.equal(exported.currentCase.matched, false);
    assert.equal(exported.artifact.scope.localDisputeID, null);
    assert.equal(exported.artifact.scope.arbitratorDisputeID, null);
    assert.equal(exported.artifact.scope.wallet, bob.address);
    const canonicalCase = await w.contract(A).caseMetaEvidence(bob.address);
    assert.equal(exported.artifact.content, canonicalCase[0]);
    assert.equal(exported.artifact.uri, canonicalCase[1]);
    assert(!Object.hasOwn(exported, "intent"));
    let accessChecks = 0;
    await assert.rejects(w.caseArtifact(A, sessions.bob, bob.address, () => {
      if (++accessChecks >= 3) throw new Error("Session revoked during canonical case read");
    }), /Session revoked/);
    await walletAction(A, "owner", "match", { wallet: bob.address });
    const matchedExport = await w.caseArtifact(A, sessions.owner, bob.address);
    assert.deepEqual(matchedExport.artifact, exported.artifact,
      "Head advance and matching preserve the original exact export and approval scope");
    assert.equal(matchedExport.currentCase.matched, true);
    assert.equal(matchedExport.currentCase.localDisputeID, "0");
    assert.equal(matchedExport.currentCase.arbitratorDisputeID, "1000");
    assert.equal(matchedExport.publication.status, "exported",
      "Local bytes never claim public availability");
    const listed = await w.state(A),
      challenge = listed.cases[0];
    assert.equal(challenge.state, "Disputed");
    assert.equal(challenge.finalRuling, null);
    assert.ok(
      challenge.localDisputeID !== null &&
        challenge.arbitratorDisputeID !== null,
    );
    await rpc.request({
      method: "evm_setTime",
      params: [(listed.challengeEndsAt + 1) * 1000],
    });
    await rpc.request({ method: "evm_mine", params: [] });
    const aliceBefore = await provider.getBalance(alice.address);
    await walletAction(A, "owner", "release");
    const ordinary = await w.state(A);
    assert.equal((await provider.getBalance(alice.address)) - aliceBefore, D);
    assert.equal(ordinary.heldBackWei, String(D));
    assert.equal(ordinary.cases[0].finalRuling, null);
    assert.equal(ordinary.owedTotalWei, "0");
    const paidBeforeRuling = (await w.detail(A, sessions.bob)).payments;
    assert.equal(paidBeforeRuling.directAttendancePaidWei, String(D));
    assert.equal(attendancePaid(paidBeforeRuling, alice.address), D);
    assert.equal(attendancePaid(paidBeforeRuling, bob.address), 0n);
    // This is the sole controlled adjudication step; every event financial action above/below uses drafts.
    await send(liquid.giveFinalRuling(challenge.arbitratorDisputeID, 1, GAS));
    assert.equal((await w.state(A)).cases[0].finalRuling, 1);
    assert.equal((await w.state(A)).heldBackWei, String(D));
    const bobBefore = await provider.getBalance(bob.address),
      bobNonce = await provider.getTransactionCount(bob.address);
    await walletAction(A, "owner", "resolve", { wallet: bob.address }, true);
    const detail = await w.detail(A, sessions.bob),
      state = detail.state;
    assert.equal(
      (await provider.getBalance(bob.address)) - bobBefore,
      D + BigInt(challenge.depositWei),
    );
    assert.equal(
      await provider.getTransactionCount(bob.address),
      bobNonce,
      "Owner pays settlement gas, same Bob receives funds",
    );
    assert.equal(detail.payments.directAttendancePaidWei, String(2n * D));
    assert.equal(attendancePaid(detail.payments, alice.address), D);
    assert.equal(attendancePaid(detail.payments, bob.address), D);
    for (const key of [
      "balanceWei",
      "reservedWei",
      "heldBackWei",
      "owedTotalWei",
      "challengeEscrowWei",
      "pendingTotalWei",
    ])
      assert.equal(state[key], "0", key);
    assert.equal(state.pendingChallenges, 0);
    assert.equal(state.cases[0].state, "Resolved");
    assert.equal(detail.deploymentTrust.status, "verified");
    assert.equal(detail.upgrade.kind, "uups");
    assert.equal(
      (await w.state(B)).fingerprint,
      bBefore.fingerprint,
      "Independent proxy credit remains untouched",
    );
    assert.deepEqual(forbiddenBackendCalls, []);
    assert.ok(fixture.stats.persisted > 0);
  },
);

test("private case export rechecks current owner after a canonical historical snapshot", { timeout: 60000 }, async () => {
  const r = w.record(A, sessions.owner), previousVisibility = r.definition.visibility;
  const c = w.contract(A), originalSend = provider.send.bind(provider);
  const selector = c.interface.getFunction("caseMetaEvidence").selector;
  let changed = false, snapshot;
  try {
    await send(c.connect(owner).transferOwnership(credit.address, GAS));
    await send(c.connect(credit).acceptOwnership(GAS));
    r.definition.visibility = "private";
    await w.state(A);
    assert(![...r.definition.organizers, ...r.definition.staff,
      ...r.participants.values()].some(value => lower(value?.wallet ?? value) === lower(credit.address)));
    provider.send = async (method, params) => {
      const result = await originalSend(method, params);
      if (!changed && method === "eth_call" && lower(params[0]?.to) === lower(r.deployment.contract) &&
        params[0]?.data?.startsWith(selector)) {
        changed = true;
        snapshot = await originalSend("eth_getBlockByNumber", [params[1], false]);
        await send(c.connect(credit).transferOwnership(owner.address, GAS));
        await send(c.connect(owner).acceptOwnership(GAS));
      }
      return result;
    };
    await assert.rejects(w.caseArtifact(A, sessions.credit, bob.address), e => e.code === "FORBIDDEN");
    assert.equal(changed, true);
    assert.equal((await originalSend("eth_getBlockByNumber", [snapshot.number, false])).hash, snapshot.hash,
      "The old case block remains canonical; current authority still must close disclosure");
    assert.equal(lower(await c.owner()), lower(owner.address));
  } finally {
    provider.send = originalSend;
    r.definition.visibility = previousVisibility;
    if (lower(await c.owner()) === lower(credit.address)) {
      await send(c.connect(credit).transferOwnership(owner.address, GAS));
      await send(c.connect(owner).acceptOwnership(GAS));
    }
  }
});

test("new private financial owner can export a case before cached access is hydrated", { timeout: 60000 }, async () => {
  const r = w.record(A, sessions.owner), previousVisibility = r.definition.visibility;
  const c = w.contract(A);
  try {
    await send(c.connect(owner).transferOwnership(credit.address, GAS));
    await send(c.connect(credit).acceptOwnership(GAS));
    r.definition.visibility = "private";
    r.financialAccess = [];
    const result = await w.caseArtifact(A, sessions.credit, bob.address);
    assert.equal(result.artifact.scope.wallet, bob.address);
    assert.equal(result.publication.status, "exported");
    assert.equal(lower(r.financialAccess[0]), lower(credit.address));
  } finally {
    r.definition.visibility = previousVisibility;
    await send(c.connect(credit).transferOwnership(owner.address, GAS));
    await send(c.connect(owner).acceptOwnership(GAS));
  }
});

test(
  "code acquired during final provenance await rejects unsigned production create and validate",
  { timeout: 60000 },
  async () => {
    const params = { to: credit.address, amountWei: "1" };
    const acquireDuringFinalProvenance = () =>
      Object.assign(race, {
        wallet: credit.address,
        provenanceReads: 0,
        triggered: false,
      });
    const clear = async () => {
      race.wallet = null;
      await rpc.request({
        method: "evm_setAccountCode",
        params: [credit.address, "0x"],
      });
    };
    try {
      acquireDuringFinalProvenance();
      await assert.rejects(
        w.createDraft(B, sessions.credit, {
          action: "withdrawPending",
          params,
        }),
        (e) => e.code === "UNSUPPORTED_WALLET",
      );
      assert.equal(race.triggered, true);
      await clear();
      const draft = await w.createDraft(B, sessions.credit, {
        action: "withdrawPending",
        params,
      });
      acquireDuringFinalProvenance();
      await assert.rejects(
        w.validateDraft(B, sessions.credit, draft.id),
        (e) => e.code === "UNSUPPORTED_WALLET",
      );
      assert.equal(race.triggered, true);
      assert.equal(
        await w.contract(B).pendingDeposits(credit.address),
        D,
        "Rejected drafts move no money",
      );
    } finally {
      await clear();
    }
  },
);

test(
  "already signed canonical hash reconciles for now-coded wallet without invoking EOA signing guard",
  { timeout: 60000 },
  async () => {
    const draft = await w.createDraft(B, sessions.credit, {
      action: "withdrawPending",
      params: { to: credit.address, amountWei: "1" },
    });
    const reviewed = await w.validateDraft(B, sessions.credit, draft.id);
    const sent = await credit.sendTransaction({
      ...reviewed.d.transaction,
      ...GAS,
    });
    await w.recordSubmitted(B, sessions.credit, draft.id, sent.hash);
    assert.equal((await sent.wait()).status, 1);
    await rpc.request({
      method: "evm_setAccountCode",
      params: [credit.address, "0x00"],
    });
    try {
      const before = reads.filter(
        (read) =>
          read.method === "eth_getCode" &&
          lower(read.address) === lower(credit.address),
      ).length;
      const refreshedSession = {
        ...sessions.credit,
        id: "new-signed-session-same-wallet",
      };
      const result = await w.reconcileSubmission(
        B,
        refreshedSession,
        draft.id,
        sent.hash,
      );
      assert.equal(result.status, "confirmed");
      assert.equal(result.hash, sent.hash);
      assert.equal(await w.contract(B).pendingDeposits(credit.address), D - 1n);
      assert.equal(
        reads.filter(
          (read) =>
            read.method === "eth_getCode" &&
            lower(read.address) === lower(credit.address),
        ).length,
        before,
      );
      assert.deepEqual(forbiddenBackendCalls, []);
    } finally {
      await rpc.request({
        method: "evm_setAccountCode",
        params: [credit.address, "0x"],
      });
    }
  },
);

test(
  "production recovery identities disclose only the current wallet's own saved reviews",
  { timeout: 60000 },
  async () => {
    // Reuse actual A financial reviews and B credit-recovery reviews from this fixture.
    // No new draft, financial call, deployment or session-auth implementation is introduced.
    const a = w.record(A, sessions.owner),
      original = {
        visibility: a.definition.visibility,
        title: a.definition.title,
        description: a.definition.description,
      };
    const privateTitle = "PRIVATE_A_RECOVERY_TITLE",
      privateDescription = "PRIVATE_A_RECOVERY_FINANCIAL_METADATA";
    const identity = (eventId) => {
      const { deployment: d } = records.find(
        (r) => r.definition.id === eventId,
      );
      return {
        id: eventId,
        chainId: d.chainId,
        contract: d.contract,
        contractVersion: d.contractVersion,
        abiVersion: d.abiVersion,
      };
    };
    const assertRecovery = (response, eventIds) => {
      assert.deepEqual(response.recoveryEvents, eventIds.map(identity));
      for (const item of response.recoveryEvents)
        assert.deepEqual(
          Object.keys(item).sort(),
          ["abiVersion", "chainId", "contract", "contractVersion", "id"],
          "Saved review discovery exposes no title, participant, financial state or governance data",
        );
      assert.equal(JSON.stringify(response).includes(privateTitle), false);
      assert.equal(
        JSON.stringify(response).includes(privateDescription),
        false,
      );
    };
    try {
      a.definition.visibility = "private";
      a.definition.title = privateTitle;
      a.definition.description = privateDescription;
      trustFault.contract = a.deployment.contract;
      const replacement = {
        ...sessions.credit,
        id: "replacement-wallet-session",
        wallet: fixture.actors.other.address,
      };
      const [
        ownDirectory,
        ownSelected,
        foreignDirectory,
        foreignSelected,
        anonymousDirectory,
        anonymousSelected,
        replacementDirectory,
        replacementSelected,
      ] = await Promise.all([
        w.bootstrap(sessions.alice),
        w.bootstrap(
          { ...sessions.alice, id: "refreshed-session-same-wallet" },
          { selectedEventId: A },
        ),
        w.bootstrap(sessions.credit),
        w.bootstrap(sessions.credit, { selectedEventId: A }),
        w.bootstrap(null),
        w.bootstrap(null, { selectedEventId: B }),
        w.bootstrap(replacement),
        w.bootstrap(replacement, { selectedEventId: B }),
      ]);
      for (const response of [ownDirectory, ownSelected])
        assertRecovery(response, [A]);
      assert.equal(
        ownSelected.selectedEvent.detail,
        null,
        "A saved identity cannot restore trust or authorize a new financial action",
      );
      for (const response of [foreignDirectory, foreignSelected]) {
        assertRecovery(response, [B]);
        assert.equal(
          JSON.stringify(response).includes(a.deployment.contract),
          false,
          "Another wallet's private review identity must not leak",
        );
      }
      for (const response of [
        anonymousDirectory,
        anonymousSelected,
        replacementDirectory,
        replacementSelected,
      ]) {
        assertRecovery(response, []);
        assert.equal(
          JSON.stringify(response).includes(a.deployment.contract),
          false,
        );
      }
      assert.equal(
        replacementSelected.selectedEvent.wallet,
        replacement.wallet,
      );
      await assert.rejects(
        w.createDraft(A, sessions.alice, {
          action: "claim",
          params: { to: alice.address },
        }),
        (error) => error.code === "WRONG_CONTRACT" && error.status === 409,
        "Minimal recovery identity must never bypass the production implementation-trust gate",
      );
      assert.deepEqual(forbiddenBackendCalls, []);
    } finally {
      trustFault.contract = null;
      Object.assign(a.definition, original);
    }
  },
);

test(
  "reusable launch fixture starts without children and requires an exact Node-held wallet review",
  { timeout: 60000 },
  async (t) => {
    const empty = await createLumaLaunchRuntime();
    t.after(() => empty.close());
    assert.deepEqual(empty.manifest.events, []);
    assert.equal(await empty.factory.eventCount(), 0n);
    const serverInstanceId = "synthetic-http-instance";
    const workbench = await empty.createWorkbench({
      serverInstanceId,
      contractVersion: "truth-pays-v7",
      production: null,
    });
    const bootstrap = await workbench.bootstrap(null);
    assert.deepEqual(bootstrap.events, []);
    assert.equal(bootstrap.mode, "hosted-production");
    const now = (await empty.provider.getBlock("latest")).timestamp;
    const factoryDraft = await workbench.createFactoryDraft(
      {
        id: "synthetic-factory-organizer",
        wallet: empty.actors.organizer.address,
        mode: "wallet",
      },
      {
        title: "Synthetic future Luma event",
        lumaUrl: "https://luma.com/synthetic-factory-instance",
        startsAt: new Date((now + 3600) * 1000).toISOString(),
        endsAt: new Date((now + 7200) * 1000).toISOString(),
        timezone: "UTC",
        depositEth: ethers.formatEther(D),
      },
    );
    assert.equal(factoryDraft.instanceId, serverInstanceId);
    await workbench.persist();
    assert.deepEqual(
      (await (await empty.createWorkbench()).bootstrap(null)).events,
      [],
      "The shared in-memory store uses the actual events/drafts reload shape",
    );
    assert.equal(empty.runtime.factoryTrust.deploymentTrust.status, "verified");
    assert.equal(
      empty.runtime.factoryTrust.upgrade.owner,
      empty.actors.upgradeOwner.address,
    );
    assert.equal(
      new Set([
        empty.actors.upgradeOwner.address,
        empty.actors.organizer.address,
        empty.actors.payer.address,
      ]).size,
      3,
    );
    assert.equal(empty.rpc.getInitialAccounts, undefined);
    for (const actor of Object.values(empty.actors))
      assert.equal(actor.privateKey, undefined);
    assert.throws(
      () => empty.walletProvider({ ...empty.actors.payer }),
      /exact fixture actor/,
    );
    const adapter = empty.walletProvider(empty.actors.payer, {
      isCurrentContext: () => true,
    });
    assert.deepEqual(await adapter.request({ method: "eth_accounts" }), [
      empty.actors.payer.address,
    ]);
    assert.equal(await adapter.request({ method: "eth_chainId" }), "0x1");
    await assert.rejects(
      adapter.request({
        method: "personal_sign",
        params: ["0x", empty.actors.payer.address],
      }),
    );
    const transaction = {
      from: empty.actors.payer.address,
      to: empty.factory.target,
      data: "0x",
      value: "0x0",
      chainId: "0x1",
    };
    await assert.rejects(
      adapter.request({ method: "eth_sendTransaction", params: [transaction] }),
    );
    await assert.rejects(
      adapter.request({
        method: "eth_sendRawTransaction",
        params: ["0xdeadbeef"],
      }),
    );
    const stale = empty.walletProvider(empty.actors.payer, {
      isCurrentContext: () => false,
    });
    await assert.rejects(
      stale.request({ method: "eth_sendTransaction", params: [transaction] }),
      /context changed/,
    );
    const lookalike = {
      id: "synthetic-reviewed-draft",
      eventId: "synthetic-event",
      wallet: empty.actors.organizer.address,
      chainId: 1,
      transaction: { ...transaction, from: empty.actors.organizer.address },
    };
    const foreign = empty.walletProvider(empty.actors.payer, {
      getReviewedDraft: () => lookalike,
      isCurrentContext: () => true,
    });
    await assert.rejects(
      foreign.request({
        method: "eth_sendTransaction",
        params: [lookalike.transaction],
      }),
    );
    const validReview = {
      id: "synthetic-review-mutation",
      eventId: "synthetic-event",
      wallet: empty.actors.payer.address,
      chainId: 1,
      transaction: { ...transaction },
    };
    let guardReads = 0;
    const mutating = empty.walletProvider(empty.actors.payer, {
      getReviewedDraft: () => validReview,
      isCurrentContext: async () => {
        if (++guardReads === 2) validReview.transaction.value = "1";
        return true;
      },
    });
    await assert.rejects(
      mutating.request({
        method: "eth_sendTransaction",
        params: [{ ...transaction }],
      }),
      /draft mutated/,
    );
    let selectedReview = {
      ...validReview,
      id: "synthetic-review-identity",
      transaction: { ...transaction },
    };
    guardReads = 0;
    const switched = empty.walletProvider(empty.actors.payer, {
      getReviewedDraft: () => selectedReview,
      isCurrentContext: async () => {
        if (++guardReads === 2) selectedReview = { ...selectedReview };
        return true;
      },
    });
    await assert.rejects(
      switched.request({
        method: "eth_sendTransaction",
        params: [{ ...transaction }],
      }),
      /object changed/,
    );
    assert.deepEqual(adapter.sent, []);
    assert.deepEqual(stale.sent, []);
    assert.deepEqual(foreign.sent, []);
    assert.deepEqual(mutating.sent, []);
    assert.deepEqual(switched.sent, []);
    assert.deepEqual(empty.forbiddenBackendCalls, []);
  },
);

test(
  "partial plain-transfer credit is topped up exactly and remains an admissible aggregate receipt",
  { timeout: 60000 },
  async (t) => {
    const eventId = "production-partial-topup";
    const local = await createLumaLaunchRuntime({ eventIds: [eventId] });
    t.after(() => local.close());
    const payer = local.actors.payer,
      organizer = local.actors.organizer,
      contract = local.manifest.events[0].deployment.contract,
      partial = D / 3n,
      payerSession = {
        id: "synthetic-partial-payer",
        wallet: payer.address,
        mode: "wallet",
      },
      organizerSession = {
        id: "synthetic-partial-organizer",
        wallet: organizer.address,
        mode: "wallet",
      };
    const plain = await payer.sendTransaction({
      to: contract,
      value: partial,
      ...GAS,
    });
    await plain.wait();
    const workbench = await local.createWorkbench();
    assert.equal(
      workbench.record(eventId, organizerSession).participants.size,
      0,
    );
    const beforeTopup = (await workbench.detail(eventId, payerSession))
      .ownWallet;
    assert.equal(beforeTopup.pendingCreditWei, String(partial));
    assert.equal(beforeTopup.deposit.status, "none");
    assert.equal(beforeTopup.depositAction.eligible, true);
    assert.equal(beforeTopup.depositAction.amountWei, String(D - partial));

    const topup = await workbench.createDraft(eventId, payerSession, {
      action: "deposit",
      params: {},
    });
    const reviewed = await workbench.validateDraft(
      eventId,
      payerSession,
      topup.id,
    );
    assert.equal(BigInt(reviewed.d.transaction.value), D - partial);
    const sent = await payer.sendTransaction({
      ...reviewed.d.transaction,
      ...GAS,
    });
    await workbench.recordSubmitted(eventId, payerSession, topup.id, sent.hash);
    const receipt = await sent.wait();
    assert.equal(receipt.status, 1);
    assert.equal(
      (await workbench.confirmDraft(eventId, payerSession, topup.id, sent.hash))
        .status,
      "confirmed",
    );
    const afterTopup = (await workbench.detail(eventId, payerSession))
      .ownWallet;
    assert.equal(afterTopup.pendingCreditWei, String(D));
    assert.equal(afterTopup.deposit.hash, sent.hash);
    assert.equal(afterTopup.deposit.amountWei, String(D - partial));
    assert.equal(afterTopup.depositAction.eligible, false);
    assert.equal(afterTopup.depositAction.reasonCode, "CREDIT_AVAILABLE");
    assert.equal(
      (await local.provider.getBlock(receipt.blockNumber)).hash,
      receipt.blockHash,
    );
    await assert.rejects(
      workbench.createDraft(eventId, payerSession, {
        action: "deposit",
        params: {},
      }),
      (error) => error.code === "CREDIT_AVAILABLE",
    );

    // Either actual payment lot is a valid receipt basis once their aggregate
    // pending credit reaches the commitment; no fabricated full-size lot exists.
    await workbench.linkDeposit(eventId, payerSession, { txHash: plain.hash });
    const person = [
      ...workbench.record(eventId, organizerSession).participants.values(),
    ][0];
    assert.equal(person.name, null);
    assert.equal(person.email, null);
    assert.equal(person.identityVerified, false);
    assert.equal(person.deposit.txHash, plain.hash);
    assert.equal(person.deposit.amountWei, String(partial));
    await workbench.admit(eventId, organizerSession, person.id, "approved");
    const admission = await workbench.createDraft(eventId, organizerSession, {
      action: "register",
      params: { wallets: [payer.address] },
    });
    const approved = await workbench.validateDraft(
      eventId,
      organizerSession,
      admission.id,
    );
    const registered = await organizer.sendTransaction({
      ...approved.d.transaction,
      ...GAS,
    });
    await workbench.recordSubmitted(
      eventId,
      organizerSession,
      admission.id,
      registered.hash,
    );
    await registered.wait();
    assert.equal(
      (
        await workbench.confirmDraft(
          eventId,
          organizerSession,
          admission.id,
          registered.hash,
        )
      ).status,
      "confirmed",
    );
    const state = await workbench.state(eventId);
    assert.equal(state.poolWei, String(D));
    assert.equal(state.pendingTotalWei, "0");
    assert.equal(
      (await workbench.detail(eventId, payerSession)).participants[0].deposit
        .verificationState,
      "current",
    );
    assert.deepEqual(local.forbiddenBackendCalls, []);
  },
);
