import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { loadV8Artifacts } from "../src/contracts-v8.mjs";
import {
  UI_C,
  prepareUiCPlan,
  validateUiCPlan,
  validateUiOrigin,
  uiCCreateRequest,
  validateUiCBudget,
  verifyUiCStack,
  deployUiC,
} from "../scripts/testnet-ui-scenario.mjs";
import {
  CHIADO,
  DAY,
  publicJson,
  sha256,
  verifyCompiledInputs,
  atomicJson,
  fingerprint,
} from "../src/testnet-config.mjs";

const addr = (n) => ethers.getAddress("0x" + n.toString(16).padStart(40, "0"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const sourceFixture = () => ({
  version: 1,
  environment: "testnet",
  planFingerprint: "protected-source-plan",
  publicOrigin: "https://protected-ab.example.invalid",
  chain: CHIADO,
  factory: addr(20),
  factoryCodeHash: ethers.id("factory-runtime"),
  arbitration: {
    mode: "controlled",
    resolver: addr(21),
    arbitrator: addr(22),
    notice: "Controlled test arbitrator; no independent jury.",
  },
  rehearsalAddresses: {
    ownerA: addr(1),
    ownerB: addr(2),
    alice: addr(3),
    bob: addr(4),
    carol: addr(5),
  },
  policy: {
    uri: "https://protected-ab.example.invalid/policies/v8-testnet.md",
    sha256: "a".repeat(64),
  },
  provenance: { sources: { "contracts/example.sol": "b".repeat(64) } },
});

test("C funding rechecks remaining grants and A/B reserve after recovering an earlier pending transfer", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "kleros-c-funding-resume-"),
  );
  try {
    const source = sourceFixture(),
      stack = stackFixture();
    const wallets = {
      purpose: UI_C.purpose,
      chainId: 10200,
      roles: Object.fromEntries(
        ["owner", "alice", "bob"].map((role) => {
          const wallet = ethers.Wallet.createRandom();
          return [
            role,
            { address: wallet.address, privateKey: wallet.privateKey },
          ];
        }),
      ),
    };
    const now = 1_793_204_000;
    const plan = prepareUiCPlan({
      source,
      provenance: source.provenance,
      stack,
      addresses: Object.fromEntries(
        Object.entries(wallets.roles).map(([role, wallet]) => [
          role,
          wallet.address,
        ]),
      ),
      publicOrigin: "https://isolated-c.example.invalid",
      now,
    });
    const journalPath = path.join(root, "ui-c-journal.json");
    atomicJson(journalPath, {
      chainId: 10200,
      planFingerprint: fingerprint(plan),
      transactions: {
        "fund-c-owner": {
          state: "submitted",
          hash: ethers.id("already-signed-known-owner-funding"),
        },
      },
    });
    let balance = 34_000_000_000_000n;
    const calls = [];
    const provider = {
      send: async () => "0x27d8",
      getCode: async () => "0x",
      getBalance: async () => balance,
      getBlock: async () => ({ timestamp: now, baseFeePerGas: 0n }),
    };
    const v8 = loadV8Artifacts();
    await assert.rejects(
      deployUiC({
        plan,
        source,
        stack,
        provider,
        artifacts: {
          KlerosEventFactoryV8: v8.factory,
          KlerosEventV8: v8.event,
        },
        wallets,
        funder: { getAddress: async () => source.rehearsalAddresses.ownerA },
        journalPath,
        manifestPath: path.join(root, "uncreated-manifest.json"),
        send: async ({ action, journal }) => {
          calls.push(action);
          assert.equal(
            action,
            "fund-c-owner",
            "no new funding may proceed after recovery reduces the balance",
          );
          balance -= BigInt(UI_C.fundingWei) + 21_000n * 100_000n;
          journal.transactions[action].state = "confirmed";
          return { hash: journal.transactions[action].hash };
        },
      }),
      /protected A\/B gas reserve/,
    );
    assert.deepEqual(
      calls,
      ["fund-c-owner"],
      "only the known pending receipt was recovered",
    );
    assert.equal(balance, 23_997_900_000_000n);
    assert.ok(balance >= 5_000_000_000_000n);
    assert.equal(
      fs.existsSync(path.join(root, "uncreated-manifest.json")),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const stackFixture = () => ({
  anchors: [1, 2, 3].map((n) => ({
    contract: addr(n + 19),
    codeHash: ethers.id(`runtime-${n}`),
  })),
  feeForJurorWei: "10000000000",
  arbitrationCostWei: "30000000000",
});
function planFixture(source = sourceFixture()) {
  return prepareUiCPlan({
    source,
    provenance: source.provenance,
    stack: stackFixture(),
    addresses: { owner: addr(30), alice: addr(31), bob: addr(32) },
    publicOrigin: "https://isolated-c.example.invalid",
    now: 1_793_204_000,
    id: "12345678-1234-1234-1234-123456789abc",
  });
}

test("C plan permits one isolated child and preserves shared-stack/policy identity", () => {
  const source = sourceFixture(),
    plan = planFixture(source);
  assert.equal(plan.event.eventStart, 1_793_204_000 + 120 * 60);
  assert.equal(plan.event.eventEnd - plan.event.eventStart, 12 * 3600);
  assert.equal(plan.event.claimDeadline - plan.event.eventStart, 7 * 86400);
  assert.equal(plan.expectedFinalRuling, 1);
  assert.equal(plan.sourceManifestSha256, sha256(publicJson(source)));
  assert.equal(plan.fundingWei, "10000000000000");
  assert.equal(plan.depositWei, "1000000000000");
  assert.equal(Object.hasOwn(plan, "events"), false);
  assert.ok(plan.steps.some((step) => /same Bob depositor/.test(step)));
  for (const origin of [
    source.publicOrigin,
    "http://c.example.invalid",
    "https://c.example.invalid/",
    "https://user:secret@c.example.invalid",
    "https://c.example.invalid?token=x",
    "https://c.example.invalid#x",
  ])
    assert.throws(() => validateUiOrigin(origin, source.publicOrigin));
  for (const [label, mutate] of [
    ["mainnet", (p) => (p.chain.chainId = 100)],
    ["changed chain label", (p) => (p.chain.name = "Mainnet")],
    [
      "misleading arbitration notice",
      (p) => (p.arbitration.notice = "Independent jury"),
    ],
    [
      "shared owner",
      (p) => (p.addresses.owner = source.rehearsalAddresses.ownerA),
    ],
    ["same C role", (p) => (p.addresses.bob = p.addresses.alice)],
    ["other factory", (p) => (p.factory = addr(50))],
    ["other resolver", (p) => (p.arbitration.resolver = addr(50))],
    [
      "other policy",
      (p) => (p.policy.uri = p.publicOrigin + "/different-policy.md"),
    ],
    ["other fee", (p) => (p.feeForJurorWei = "1")],
    ["other funding", (p) => (p.fundingWei = "20000000000000")],
    ["other deposit", (p) => (p.depositWei = "2000000000000")],
    ["ruling2", (p) => (p.expectedFinalRuling = 2)],
    ["short window", (p) => p.event.claimDeadline--],
    ["missing calendar end", (p) => delete p.event.eventEnd],
    [
      "old one-hour calendar",
      (p) => (p.event.eventEnd = p.event.eventStart + 3600),
    ],
    ["extended calendar", (p) => p.event.eventEnd++],
    [
      "excess start margin",
      (p) => {
        p.event.eventStart += 3600;
        p.event.eventEnd += 3600;
        p.event.claimDeadline += 3600;
      },
    ],
    ["old source", (p) => (p.sourceManifestSha256 = "0".repeat(64))],
    [
      "changed compiler",
      (p) => (p.provenance.sources["contracts/example.sol"] = "0".repeat(64)),
    ],
  ]) {
    const changed = clone(plan);
    mutate(changed);
    assert.throws(() => validateUiCPlan(changed, source), undefined, label);
  }
  for (const startInMinutes of [0, 89, 121, NaN])
    assert.throws(() =>
      prepareUiCPlan({
        source,
        provenance: source.provenance,
        stack: stackFixture(),
        addresses: plan.addresses,
        publicOrigin: plan.publicOrigin,
        startInMinutes,
      }),
    );
});

test("C deploy budget is exact and refuses excess gas, fees, role count or unavailable funding", () => {
  const quote = validateUiCBudget({
    balanceWei: 40_000_000_000_000n,
    maxFeePerGas: 100_000n,
    createGas: UI_C.maximumCreateGas,
  });
  assert.equal(quote.creationMaximumWei, "800000000000");
  assert.equal(quote.protectedABGasReserveWei, "5000000000000");
  assert.equal(
    quote.remainingDeployerWei,
    String(3n * (10_000_000_000_000n + 21_000n * 100_000n)),
  );
  const requiredBalance =
    BigInt(quote.remainingDeployerWei) + 5_000_000_000_000n;
  assert.throws(
    () =>
      validateUiCBudget({
        balanceWei: requiredBalance - 1n,
        maxFeePerGas: 100_000n,
        createGas: UI_C.maximumCreateGas,
      }),
    /protected A\/B gas reserve/,
  );
  assert.equal(
    validateUiCBudget({
      balanceWei: requiredBalance,
      maxFeePerGas: 100_000n,
      createGas: UI_C.maximumCreateGas,
    }).protectedABGasReserveWei,
    "5000000000000",
  );
  for (const changes of [
    { createGas: 8_000_001n },
    { createGas: 0 },
    { maxFeePerGas: 0 },
    { maxFeePerGas: 2_000_000n },
    { pendingFunding: 4 },
    { pendingFunding: -1 },
    { balanceWei: 1n },
  ])
    assert.throws(() =>
      validateUiCBudget({
        balanceWei: 40_000_000_000_000n,
        maxFeePerGas: 100_000n,
        createGas: UI_C.maximumCreateGas,
        ...changes,
      }),
    );
  assert.equal(
    validateUiCBudget({
      balanceWei: 0,
      maxFeePerGas: 100_000n,
      createGas: UI_C.maximumCreateGas,
      pendingFunding: 0,
      createPending: false,
    }).remainingDeployerWei,
    "0",
  );
  assert.equal(
    validateUiCBudget({
      balanceWei: 0,
      maxFeePerGas: 100_000n,
      createGas: UI_C.maximumCreateGas,
      pendingFunding: 0,
      createPending: false,
    }).protectedABGasReserveWei,
    "0",
  );
});

test(
  "real local chain10200 C reuses existing verified stack, journals four operations and recovers without replay",
  { timeout: 120000 },
  async () => {
    const { localChain } = await import("../src/chain.mjs");
    const chain = await localChain(0, { chainId: 10200 });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kleros-ui-c-test-"));
    let miner, mining;
    try {
      const { artifacts, provenance } = verifyCompiledInputs();
      const factory = await chain.deploy(
        "KlerosEventFactoryV8",
        chain.signers[0],
      );
      await (await chain.liquid.setFeeForJuror(10_000_000_000n)).wait();
      const source = sourceFixture();
      source.provenance = provenance;
      source.rehearsalAddresses = Object.fromEntries(
        await Promise.all(
          ["ownerA", "ownerB", "alice", "bob", "carol"].map(async (role, i) => [
            role,
            await chain.signers[i].getAddress(),
          ]),
        ),
      );
      source.factory = factory.target;
      source.factoryCodeHash = ethers.keccak256(
        await chain.provider.getCode(factory.target),
      );
      source.arbitration.resolver = chain.resolver.target;
      source.arbitration.arbitrator = chain.liquid.target;
      const policy = fs.readFileSync(
        new URL("../public/policies/v8-testnet.md", import.meta.url),
        "utf8",
      );
      source.policy.sha256 = sha256(policy);
      const sourceJournal = {
        chainId: 10200,
        planFingerprint: source.planFingerprint,
        transactions: {},
      };
      for (const [action, contract] of [
        ["deploy-arbitrator", chain.liquid],
        ["deploy-resolver", chain.resolver],
        ["deploy-factory", factory],
      ]) {
        const receipt = await contract.deploymentTransaction().wait();
        sourceJournal.transactions[action] = {
          hash: receipt.hash,
          state: "confirmed",
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
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
            const wallet = ethers.Wallet.createRandom();
            return [
              role,
              { address: wallet.address, privateKey: wallet.privateKey },
            ];
          }),
        ),
      };
      const now = (await chain.provider.getBlock("latest")).timestamp;
      const plan = prepareUiCPlan({
        source,
        provenance,
        stack,
        addresses: Object.fromEntries(
          Object.entries(wallets.roles).map(([role, entry]) => [
            role,
            entry.address,
          ]),
        ),
        publicOrigin: "https://isolated-c.example.invalid",
        now,
      });
      const request = uiCCreateRequest(plan, artifacts);
      const parsed = new ethers.Interface(
        artifacts.KlerosEventFactoryV8.abi,
      ).parseTransaction(request.request);
      assert.equal(parsed.name, "createEvent");
      assert.equal(parsed.args[0], plan.event.eventKey);
      assert.equal(parsed.args[1].depositAmount, 1_000_000_000_000n);
      assert.equal(
        parsed.args[1].arbitration.disputeResolver,
        source.arbitration.resolver,
      );
      const accounts = chain.server.provider.getInitialAccounts();
      const funder = new ethers.Wallet(
        accounts[source.rehearsalAddresses.ownerA.toLowerCase()].secretKey,
        chain.provider,
      );
      const journalPath = path.join(root, "ui-c-journal.json"),
        manifestPath = path.join(root, "chiado-v8-ui-c.json");
      // Ganache starts at a1gwei base fee, unlike this bounded Chiado fixture.
      // Empty local blocks lower it naturally; the production budget stays strict.
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
      const args = {
        plan,
        source,
        stack,
        provider: chain.provider,
        artifacts,
        wallets,
        funder,
        journalPath,
        manifestPath,
      };
      const badWallets = clone(wallets);
      badWallets.roles.bob.privateKey = wallets.roles.owner.privateKey;
      const nonceBeforeGuard = await chain.provider.getTransactionCount(
        funder.address,
      );
      await assert.rejects(
        deployUiC({ ...args, wallets: badWallets }),
        /role identities/,
      );
      assert.equal(
        await chain.provider.getTransactionCount(funder.address),
        nonceBeforeGuard,
        "A mismatched private role is rejected before any funding transaction",
      );
      assert.equal(fs.existsSync(journalPath), false);
      const sourceBefore = publicJson(source);
      const result = await deployUiC(args);
      assert.equal(
        publicJson(source),
        sourceBefore,
        "Protected source is unchanged",
      );
      assert.equal(result.manifest.events.length, 1);
      assert.equal(result.manifest.scenario.expectedFinalRuling, 1);
      assert.equal(result.manifest.publicOrigin, plan.publicOrigin);
      assert.equal(result.manifest.factory, source.factory);
      assert.equal(await factory.eventCount(), 1n, "Only one child created");
      assert.equal(
        (await chain.provider.getCode(
          result.manifest.events[0].deployment.contract,
        )) === "0x",
        false,
      );
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      assert.deepEqual(Object.keys(journal.transactions), [
        "fund-c-owner",
        "fund-c-alice",
        "fund-c-bob",
        `create-${plan.event.id}`,
      ]);
      assert.ok(
        Object.values(journal.transactions).every(
          (entry) => entry.state === "confirmed",
        ),
      );
      const { assertPlanDeployment } = await import("./testnet-ui-c.e2e.mjs");
      const selected = result.manifest.events[0];
      const creationEntry = assertPlanDeployment(
        selected,
        plan,
        journal,
        request,
        ethers.keccak256(artifacts.KlerosEventV8.bytecode),
      );
      assert.equal(
        creationEntry.hash,
        selected.deployment.deploymentTxHash,
        "Actual UI operator accepts the exact real one-child deployment and its once journal",
      );
      const wrongChild = clone(selected);
      wrongChild.deployment.resolver = addr(90);
      assert.throws(
        () =>
          assertPlanDeployment(
            wrongChild,
            plan,
            journal,
            request,
            ethers.keccak256(artifacts.KlerosEventV8.bytecode),
          ),
        /exact plan/,
      );
      assert.doesNotMatch(
        JSON.stringify(journal),
        /privateKey|signedTransaction|serialized/,
      );
      const countBefore = await chain.provider.getTransactionCount(
        funder.address,
      );
      const ownerBefore = await chain.provider.getTransactionCount(
        wallets.roles.owner.address,
      );
      await deployUiC(args);
      assert.equal(
        await chain.provider.getTransactionCount(funder.address),
        countBefore,
      );
      assert.equal(
        await chain.provider.getTransactionCount(wallets.roles.owner.address),
        ownerBefore,
      );
      assert.equal(await factory.eventCount(), 1n);
      const { testnetChain } = await import("../src/testnet-runtime.mjs");
      assert.equal(typeof testnetChain, "function");
      // Verify runtime's exact one-event metadata predicates without weakening HTTPS.
      const record = result.manifest.events[0];
      assert.equal(record.definition.id, record.deployment.eventId);
      assert.equal(record.definition.title, record.deployment.eventName);
      assert.equal(
        Date.parse(record.definition.startsAt) / 1000,
        record.deployment.eventStart,
      );
      assert.equal(
        Date.parse(record.definition.endsAt) / 1000,
        plan.event.eventEnd,
      );
      assert.equal(record.deployment.depositDeadline, plan.event.eventStart);
      assert.equal(
        record.deployment.claimDeadline - record.deployment.eventStart,
        7 * DAY,
      );
      assert.equal(
        record.definition.organizers[0],
        wallets.roles.owner.address,
      );
      assert.equal(fs.statSync(journalPath).mode & 0o077, 0);
      await (await chain.liquid.setFeeForJuror(1n)).wait();
      await assert.rejects(
        verifyUiCStack({
          provider: chain.provider,
          source,
          sourceJournal,
          artifacts,
          provenance,
        }),
        /controlled fee differs/,
      );
      const alteredJournal = clone(sourceJournal);
      alteredJournal.transactions["deploy-factory"].blockHash = ethers.ZeroHash;
      await assert.rejects(
        verifyUiCStack({
          provider: chain.provider,
          source,
          sourceJournal: alteredJournal,
          artifacts,
          provenance,
        }),
        /creation inputs/,
      );
    } finally {
      clearInterval(miner);
      await mining;
      await chain.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
