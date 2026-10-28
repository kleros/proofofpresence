import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import {
  CHIADO,
  DAY,
  atomicJson,
  publicJson,
  sha256,
  fingerprint,
  verifyCompiledInputs,
  readJson,
  loadJournal,
  sendOnce,
} from "../src/testnet-config.mjs";
import {
  UI_C,
  prepareUiCPlan,
  verifyUiCStack,
  deployUiC,
} from "../scripts/testnet-ui-scenario.mjs";
import {
  assertCBeforeRuling,
  assertCAfterRuling,
  assertCSettled,
  assertCUIProofContext,
  runCOperator,
  C_RULING_ACTION,
} from "../scripts/testnet-ui-c-rehearsal.mjs";
import { stateOf, operationFor, protectedFacts } from "./testnet-ui-c.e2e.mjs";

const addr = (n) => ethers.getAddress("0x" + n.toString(16).padStart(40, "0"));
const copy = (value) => JSON.parse(JSON.stringify(value));
test("C operator guards require actual held ordinary share, attended ruling1 and delivered payments", () => {
  const scope = {
    chainId: 10200,
    owner: addr(1),
    alice: addr(2),
    bob: addr(3),
    depositWei: "1000000000000",
  };
  const ordinary = {
    owner: scope.owner,
    phase: "Finalized",
    stakerCount: 2,
    attendeeCount: 1,
    attended: { alice: true, bob: false },
    status: { alice: 2, bob: 1 },
    pendingTotal: "0",
    pendingChallenges: "1",
    owedTotal: "0",
    owed: { alice: "0", bob: "0" },
    heldBack: scope.depositWei,
    payoutShare: scope.depositWei,
    bobCase: {
      state: 2,
      finalRuling: null,
      heldShare: scope.depositWei,
      localDisputeID: "17",
      arbitratorDisputeID: "1017",
    },
  };
  assert.doesNotThrow(() => assertCBeforeRuling(ordinary, scope));
  assert.doesNotThrow(() =>
    assertCAfterRuling(
      { ...ordinary, bobCase: { ...ordinary.bobCase, finalRuling: 1 } },
      scope,
    ),
  );
  for (const mutate of [
    (s) => (s.phase = "Listed"),
    (s) => (s.heldBack = "0"),
    (s) => (s.bobCase.heldShare = "0"),
    (s) => (s.bobCase.finalRuling = 2),
    (s) => (s.owedTotal = "1"),
    (s) => (s.status.bob = 2),
    (s) => (s.attended.bob = true),
    (s) => (s.bobCase.arbitratorDisputeID = undefined),
    (s) => (s.pendingTotal = "1"),
  ]) {
    const bad = copy(ordinary);
    mutate(bad);
    assert.throws(() => assertCBeforeRuling(bad, scope));
  }
  const settled = {
    ...ordinary,
    attendeeCount: 2,
    attended: { alice: true, bob: true },
    status: { alice: 2, bob: 2 },
    pendingChallenges: "0",
    heldBack: "0",
    challengeEscrow: "0",
    reserved: "0",
    balance: "0",
    bobCase: { ...ordinary.bobCase, state: 3, finalRuling: 1, heldShare: "0" },
  };
  const paid = new Map([
    [scope.alice.toLowerCase(), 1_000_000_000_000n],
    [scope.bob.toLowerCase(), 1_000_000_000_000n],
  ]);
  assert.doesNotThrow(() => assertCSettled(settled, scope, paid));
  assert.throws(() =>
    assertCSettled(
      settled,
      scope,
      new Map([[scope.alice.toLowerCase(), 2_000_000_000_000n]]),
    ),
  );
  assert.throws(() =>
    assertCSettled({ ...settled, owedTotal: "1" }, scope, paid),
  );
  assert.throws(() =>
    assertCSettled(
      { ...settled, bobCase: { ...settled.bobCase, finalRuling: 2 } },
      scope,
      paid,
    ),
  );
  assert.throws(() =>
    assertCSettled({ ...settled, owner: addr(99) }, scope, paid),
  );
  assert.throws(() =>
    assertCSettled(settled, { ...scope, chainId: 100 }, paid),
  );
  const contextPlan = {
    publicOrigin: "https://isolated-c.example.invalid",
    sourceManifestSha256: "a".repeat(64),
  };
  const contextManifest = {
    events: [
      {
        deployment: {
          contract: addr(4),
          codeHash: ethers.id("code"),
          factory: addr(5),
          factoryCodeHash: ethers.id("factory"),
          deploymentTxHash: ethers.id("creation"),
          deploymentBlock: 10,
          configurationHash: ethers.id("config"),
        },
      },
    ],
  };
  const d = contextManifest.events[0].deployment,
    harnessSha = "b".repeat(64);
  const contextProof = {
    source: {
      origin: contextPlan.publicOrigin,
      instanceId: "local-test",
      harnessSha256: harnessSha,
      operatorFiles: { "test/testnet-ui-c.e2e.mjs": harnessSha },
      planFingerprint: fingerprint(contextPlan),
      manifestSha256: sha256(publicJson(contextManifest)),
      protectedManifestSha256: contextPlan.sourceManifestSha256,
      contract: { address: d.contract, ...d },
    },
    protectedAB: {
      unchanged: true,
      before: [
        { financial: { contract: addr(6) } },
        { financial: { contract: addr(7) } },
      ],
      after: [
        { financial: { contract: addr(6) } },
        { financial: { contract: addr(7) } },
      ],
    },
  };
  assert.doesNotThrow(() =>
    assertCUIProofContext(contextProof, contextPlan, contextManifest),
  );
  for (const mutate of [
    (p) => (p.source.origin = "https://wrong.example.invalid"),
    (p) => (p.source.harnessSha256 = "bad"),
    (p) => (p.source.contract.codeHash = ethers.ZeroHash),
    (p) => p.source.contract.deploymentBlock++,
    (p) => (p.source.contract.deploymentTxHash = ethers.ZeroHash),
    (p) => (p.source.contract.configurationHash = ethers.ZeroHash),
    (p) => (p.protectedAB.unchanged = false),
    (p) => (p.protectedAB.after[0].financial.balance = "1"),
    (p) => (p.protectedAB.before = []),
  ]) {
    const bad = copy(contextProof);
    mutate(bad);
    assert.throws(() =>
      assertCUIProofContext(bad, contextPlan, contextManifest),
    );
  }
});

test(
  "local10200 C controlled ruling targets dynamic case1, preserves A/B and independently proves winner payout/collateral",
  { timeout: 120000 },
  async () => {
    const { localChain, deployEvent } = await import("../src/chain.mjs");
    const chain = await localChain(0, { chainId: 10200 });
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-c-operator-test-"),
    );
    let miner, mining;
    try {
      const { artifacts, provenance } = verifyCompiledInputs();
      const factory = await chain.deploy(
        "KlerosEventFactoryV8",
        chain.signers[0],
      );
      await (await chain.liquid.setFeeForJuror(10_000_000_000n)).wait();
      const originalAddresses = Object.fromEntries(
        await Promise.all(
          ["ownerA", "ownerB", "alice", "bob", "carol"].map(async (role, i) => [
            role,
            await chain.signers[i].getAddress(),
          ]),
        ),
      );
      const sourceStart =
        (await chain.provider.getBlock("latest")).timestamp + 300;
      const sourceRecords = [];
      for (const [i, letter] of ["a", "b"].entries()) {
        const definition = {
          id: `protected-${letter}`,
          title: `Protected ${letter}`,
          location: "Synthetic local venue",
          startsAt: new Date(sourceStart * 1000).toISOString(),
          endsAt: new Date((sourceStart + 3600) * 1000).toISOString(),
          timezone: "UTC",
        };
        sourceRecords.push({
          definition,
          ...(await deployEvent(
            chain,
            definition,
            chain.signers[i],
            1_000_000_000_000n,
            sourceStart,
            sourceStart + 7 * DAY,
            { contractVersion: "kleros-event-v8", factory },
          )),
        });
      }
      const a = new ethers.Contract(
        sourceRecords[0].deployment.contract,
        artifacts.KlerosEventV8.abi,
        chain.signers[0],
      );
      for (const i of [2, 3])
        await (
          await a
            .connect(chain.signers[i])
            .deposit({ value: 1_000_000_000_000n })
        ).wait();
      await (
        await a.registerStakers([
          originalAddresses.alice,
          originalAddresses.bob,
        ])
      ).wait();
      await chain.provider.send("evm_increaseTime", [301]);
      await chain.provider.send("evm_mine", []);
      await (
        await a.postAttendance([originalAddresses.alice], 2_000_000_000_000n)
      ).wait();
      await (
        await a.connect(chain.signers[3]).challenge({ value: 30_000_000_000n })
      ).wait();
      await (
        await a.matchChallenge(originalAddresses.bob, {
          value: 30_000_000_000n,
        })
      ).wait();
      assert.equal(
        (await a.challenges(originalAddresses.bob)).localDisputeID,
        0n,
      );
      const policy = fs.readFileSync(
        new URL("../public/policies/v8-testnet.md", import.meta.url),
        "utf8",
      );
      const source = {
        version: 1,
        environment: "testnet",
        planFingerprint: "protected-local-plan",
        chain: CHIADO,
        publicOrigin: "https://protected-ab.example.invalid",
        factory: factory.target,
        factoryCodeHash: ethers.keccak256(
          await chain.provider.getCode(factory.target),
        ),
        arbitration: {
          mode: "controlled",
          resolver: chain.resolver.target,
          arbitrator: chain.liquid.target,
          notice: "Controlled test arbitrator; no independent jury.",
        },
        policy: {
          uri: "https://protected-ab.example.invalid/policies/v8-testnet.md",
          sha256: sha256(policy),
        },
        provenance,
        rehearsalAddresses: originalAddresses,
        events: sourceRecords,
      };
      const sourceJournal = {
        chainId: 10200,
        planFingerprint: source.planFingerprint,
        transactions: {},
      };
      for (const [action, c] of [
        ["deploy-arbitrator", chain.liquid],
        ["deploy-resolver", chain.resolver],
        ["deploy-factory", factory],
      ]) {
        const r = await c.deploymentTransaction().wait();
        sourceJournal.transactions[action] = {
          hash: r.hash,
          state: "confirmed",
          blockNumber: r.blockNumber,
          blockHash: r.blockHash,
        };
      }
      const stack = await verifyUiCStack({
        provider: chain.provider,
        source,
        sourceJournal,
        artifacts,
        provenance,
      });
      const wallets = {
        purpose: UI_C.purpose,
        chainId: 10200,
        roles: Object.fromEntries(
          ["owner", "alice", "bob"].map((role) => {
            const w = ethers.Wallet.createRandom();
            return [role, { address: w.address, privateKey: w.privateKey }];
          }),
        ),
      };
      const plan = prepareUiCPlan({
        source,
        provenance,
        stack,
        addresses: Object.fromEntries(
          Object.entries(wallets.roles).map(([r, v]) => [r, v.address]),
        ),
        publicOrigin: "https://isolated-c.example.invalid",
        now: (await chain.provider.getBlock("latest")).timestamp,
      });
      for (let i = 0; i < 100; i++) {
        if ((await chain.provider.getBlock("latest")).baseFeePerGas < 1000n)
          break;
        await chain.provider.send("evm_mine", []);
      }
      miner = setInterval(() => {
        if (mining) return;
        mining = chain.provider.send("evm_mine", []).finally(() => {
          mining = null;
        });
      }, 100);
      const originalKeys = chain.server.provider.getInitialAccounts();
      const funder = new ethers.Wallet(
        originalKeys[originalAddresses.ownerA.toLowerCase()].secretKey,
        chain.provider,
      );
      const journalPath = path.join(root, "ui-c-journal.json"),
        manifestPath = path.join(root, "manifest.json");
      const { manifest } = await deployUiC({
        plan,
        source,
        stack,
        provider: chain.provider,
        artifacts,
        wallets,
        funder,
        journalPath,
        manifestPath,
      });
      const c = new ethers.Contract(
        manifest.events[0].deployment.contract,
        artifacts.KlerosEventV8.abi,
        chain.provider,
      );
      const signers = Object.fromEntries(
        Object.entries(wallets.roles).map(([r, v]) => [
          r,
          new ethers.Wallet(v.privateKey, chain.provider),
        ]),
      );
      const scope = {
        chainId: 10200,
        eventId: plan.event.id,
        contract: c.target,
        depositWei: plan.depositWei,
        ...plan.addresses,
      };
      const fixtureOperation = async (stage, role) => {
        const s = await stateOf(c, chain.provider, scope, chain.resolver),
          op = operationFor(stage, role, scope, s);
        const readAB = () =>
          Promise.all(
            source.events.map((record) =>
              protectedFacts(
                record,
                chain.provider,
                artifacts.KlerosEventV8.abi,
                source.rehearsalAddresses,
              ),
            ),
          );
        const abBefore = await readAB();
        const journal = loadJournal(journalPath, plan);
        const receipt = await sendOnce({
          provider: chain.provider,
          signer: signers[role],
          journal,
          journalPath,
          action: op.journalAction,
          request: {
            to: c.target,
            data: c.interface.encodeFunctionData(op.method, op.args),
            value: op.value,
          },
        });
        // Synthetic local sidecars exercise provenance guards. No browser run or
        // public UI proof is claimed by these private temporary test fixtures.
        const rel = `artifacts/ui-c/local-fixture/${op.journalAction}.json`,
          filename = path.join(root, rel);
        const d = manifest.events[0].deployment,
          harnessSha = sha256("Synthetic local fixture only; no browser claim");
        const proof = {
          status: "passed",
          testFixture: "Synthetic local metadata; no browser execution claim",
          eventId: scope.eventId,
          contract: scope.contract,
          wallet: scope[role],
          journalAction: op.journalAction,
          hash: receipt.hash,
          source: {
            origin: plan.publicOrigin,
            instanceId: "synthetic-local-fixture",
            harnessSha256: harnessSha,
            operatorFiles: { "test/testnet-ui-c.e2e.mjs": harnessSha },
            protectedManifestSha256: plan.sourceManifestSha256,
            planFingerprint: fingerprint(plan),
            manifestSha256: sha256(publicJson(manifest)),
            contract: {
              address: d.contract,
              codeHash: d.codeHash,
              factory: d.factory,
              factoryCodeHash: d.factoryCodeHash,
              deploymentTxHash: d.deploymentTxHash,
              deploymentBlock: d.deploymentBlock,
              configurationHash: d.configurationHash,
            },
          },
          protectedAB: {
            unchanged: true,
            before: abBefore,
            after: await readAB(),
          },
          ui: { walletTransactions: 1, broadcasts: 1 },
        };
        atomicJson(filename, proof, 0o644);
        journal.transactions[op.journalAction].uiProof = {
          path: rel,
          sha256: sha256(fs.readFileSync(filename)),
        };
        atomicJson(journalPath, journal);
        return receipt;
      };
      await fixtureOperation("deposits", "alice");
      await fixtureOperation("deposits", "bob");
      await fixtureOperation("admit", "owner");
      const latest = (await chain.provider.getBlock("latest")).timestamp;
      await chain.provider.send("evm_increaseTime", [
        plan.event.eventStart - latest + 1,
      ]);
      await chain.provider.send("evm_mine", []);
      await fixtureOperation("attendance", "owner");
      await fixtureOperation("challenge", "bob");
      await fixtureOperation("match", "owner");
      assert.equal((await c.challenges(scope.bob)).localDisputeID, 1n);
      const end = Number(await c.challengeEndsAt());
      await chain.provider.send("evm_increaseTime", [
        end - (await chain.provider.getBlock("latest")).timestamp + 1,
      ]);
      await chain.provider.send("evm_mine", []);
      await fixtureOperation("payout", "owner");
      const args = {
        plan,
        manifest,
        source,
        provider: chain.provider,
        artifacts,
        stack,
        journalPath,
        proofRoot: root,
        signer: signers.owner,
      };
      const result = await runCOperator({ ...args, stage: "ruling" });
      assert.equal(result.transactionsBroadcast, 1);
      assert.equal(result.after.bobCase.localDisputeID, "1");
      assert.equal(result.after.bobCase.arbitratorDisputeID, "1001");
      assert.equal(result.after.bobCase.finalRuling, 1);
      assert.equal(result.after.heldBack, plan.depositWei);
      assert.equal(
        (await chain.resolver.disputes(0)).isRuled,
        false,
        "Protected A case0 is not accidentally ruled",
      );
      const nonce = await chain.provider.getTransactionCount(
        signers.owner.address,
      );
      const interrupted = readJson(journalPath);
      interrupted.transactions[C_RULING_ACTION].state = "submitted";
      atomicJson(journalPath, interrupted);
      // A reader can still have the canonical pre-ruling head when the saved
      // submitted receipt becomes available. Recovery must re-read after wait.
      let laggedHead = true;
      const laggedProvider = new Proxy(chain.provider, {
        get(target, key) {
          if (key === "getBlock")
            return (tag) =>
              target.getBlock(
                tag === "latest" && laggedHead
                  ? result.before.indexedBlock.number
                  : tag,
              );
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const recovered = await runCOperator({
        ...args,
        stage: "ruling",
        signer: undefined,
        provider: laggedProvider,
        sender: async (request) => {
          laggedHead = false;
          return sendOnce(request);
        },
      });
      assert.equal(recovered.before.bobCase.finalRuling, null);
      assert.equal(recovered.after.bobCase.finalRuling, 1);
      assert.equal(recovered.transactionsBroadcast, 0);
      assert.equal(
        await chain.provider.getTransactionCount(signers.owner.address),
        nonce,
      );
      await fixtureOperation("settle", "owner");
      const final = await runCOperator({
        ...args,
        stage: "verify",
        signer: undefined,
      });
      assert.equal(final.transactionsBroadcast, 0);
      assert.equal(
        final.attendancePaidWei[scope.alice.toLowerCase()],
        plan.depositWei,
      );
      assert.equal(
        final.attendancePaidWei[scope.bob.toLowerCase()],
        plan.depositWei,
      );
      assert.equal(
        final.collateralDelivery.totalChallengeCollateralWei,
        "30000000000",
      );
      assert.equal(
        final.collateralDelivery.recipients.find(
          (r) => r.wallet.toLowerCase() === scope.bob.toLowerCase(),
        ).collateralDeliveredWei,
        "30000000000",
      );
      assert.equal(final.protectedAB.unchanged, true);
      assert.equal(final.after.balance, "0");
      assert.equal((await chain.resolver.disputes(0)).isRuled, false);
      const tampered = readJson(journalPath);
      tampered.transactions["ui-c-deposit-alice"].uiProof.sha256 = "0".repeat(
        64,
      );
      atomicJson(journalPath, tampered);
      await assert.rejects(
        runCOperator({ ...args, stage: "verify", signer: undefined }),
        /missing or changed/,
      );
    } finally {
      clearInterval(miner);
      await mining;
      await chain.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
