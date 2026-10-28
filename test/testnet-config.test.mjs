import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ganache from "ganache";
import { ethers } from "ethers";
import {
  ROOT,
  PRIVATE_ROOT,
  CHIADO,
  validateChain,
  assertTestnet,
  validatePlan,
  fingerprint,
  secureWalletFile,
  verifyPolicy,
  sha256,
  sendOnce,
  loadJournal,
  verifyCompiledInputs,
  boundedFees,
} from "../src/testnet-config.mjs";
import { preparePlan, deployPlan } from "../scripts/testnet-deploy.mjs";
import {
  runStage,
  readyAfter,
  proveCollateralDelivery,
} from "../scripts/testnet-rehearsal.mjs";

const fixtureWallet = () => ({
  roles: Object.fromEntries(
    ["ownerA", "ownerB", "alice", "bob", "carol"].map((role) => {
      const w = ethers.Wallet.createRandom();
      return [role, { address: w.address, privateKey: w.privateKey }];
    }),
  ),
});
const fixturePlan = (wallet = fixtureWallet()) =>
  preparePlan({
    wallet,
    provenance: { sources: {} },
    publicOrigin: "https://example.test",
    policyBytes: Buffer.from("synthetic policy"),
    now: 1793200000,
  });

test("testnet configuration refuses mainnets and verifies the RPC's reported chain", async () => {
  for (const chainId of [1, 100, 42161, 11155111, 1337])
    assert.throws(() => validateChain({ ...CHIADO, chainId }), /Only Chiado/);
  assert.throws(
    () => validateChain({ ...CHIADO, rpcUrl: "http://127.0.0.1" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      validateChain({
        ...CHIADO,
        rpcUrl: "https://user:password@example.test",
      }),
    /credentials/,
  );
  assert.throws(
    () =>
      validateChain({
        ...CHIADO,
        nativeCurrency: { symbol: "ETH", decimals: 18 },
      }),
    /XDAI/,
  );
  await assert.rejects(
    assertTestnet({ send: async () => "0x1" }),
    /different chain/,
  );
  await assertTestnet({
    send: async (method) => {
      assert.equal(method, "eth_chainId");
      return "0x27d8";
    },
  });
});
test("a priority oracle spike cannot exceed the explicit testnet fee budget", () => {
  assert.deepEqual(boundedFees(7n, 4_169_379_517n), {
    maxPriorityFeePerGas: 100_000n,
    maxFeePerGas: 100_014n,
  });
  assert.deepEqual(boundedFees(null, 4_169_379_517n), { gasPrice: 100_000n });
  assert.deepEqual(boundedFees(null, 7n), { gasPrice: 7n });
  assert.throws(() => boundedFees(null, null), /unavailable/);
});
test("prepared plans contain public identities, exact source/policy bindings and unchanged windows", () => {
  const wallet = fixtureWallet(),
    plan = fixturePlan(wallet);
  assert.equal(plan.environment, "testnet");
  assert.equal(plan.arbitration.mode, "controlled");
  assert.equal(
    plan.events[0].claimDeadline - plan.events[0].eventStart,
    7 * 86400,
  );
  assert.equal(plan.events[0].depositWei, "1000000000000");
  assert.notEqual(plan.events[0].eventKey, plan.events[1].eventKey);
  for (const entry of Object.values(wallet.roles))
    assert.equal(JSON.stringify(plan).includes(entry.privateKey), false);
  const changed = structuredClone(plan);
  changed.events[0].depositWei = "2";
  assert.notEqual(fingerprint(changed), fingerprint(plan));
  changed.events[0].claimDeadline = changed.events[0].eventStart;
  assert.throws(() => validatePlan(changed), /schedule/);
  assert.throws(
    () =>
      preparePlan({
        wallet,
        provenance: {},
        policyBytes: Buffer.from("policy"),
        publicOrigin: "https://example.test/path",
      }),
    /exact HTTPS/,
  );
});
test("disposable signing material is reused and requires owner-only permissions", () => {
  fs.mkdirSync(PRIVATE_ROOT, { recursive: true });
  const directory = fs.mkdtempSync(path.join(PRIVATE_ROOT, "wallet-test-"));
  const filename = path.join(directory, "wallet.json");
  try {
    const first = secureWalletFile(filename, true);
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.equal(
      secureWalletFile(filename, true).roles.ownerA.address,
      first.roles.ownerA.address,
    );
    fs.chmodSync(filename, 0o644);
    assert.throws(() => secureWalletFile(filename), /owner-only/);
    assert.throws(
      () => secureWalletFile(path.join(os.tmpdir(), "wrong-wallet.json")),
      /ignored/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("policy publication is byte verified without following a redirect or inventing a pin", async () => {
  const text = "synthetic reviewed policy";
  const policy = { uri: "https://example.test/policy", sha256: sha256(text) };
  await verifyPolicy(policy, async (_url, options) => {
    assert.equal(options.redirect, "manual");
    return new Response(text);
  });
  await assert.rejects(
    verifyPolicy(policy, async () => new Response("changed")),
    /bytes/,
  );
  await assert.rejects(
    verifyPolicy(policy, async () => new Response("", { status: 302 })),
    /publicly available/,
  );
});
test("changed source bytes are refused before an old compilation can be deployed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "testnet-source-"));
  try {
    fs.mkdirSync(path.join(directory, "build/contracts"), { recursive: true });
    fs.mkdirSync(path.join(directory, "contracts"));
    const original = "original reviewed Solidity";
    const existing = JSON.parse(
      fs.readFileSync(path.join(ROOT, "build/contracts/manifest.json")),
    );
    fs.writeFileSync(
      path.join(directory, "build/contracts/manifest.json"),
      JSON.stringify({
        compiler: existing.compiler,
        sources: { "contracts/Example.sol": sha256(original) },
      }),
    );
    fs.writeFileSync(
      path.join(directory, "build/contracts/standard-input.json"),
      JSON.stringify({
        sources: { "contracts/Example.sol": { content: original } },
      }),
    );
    fs.writeFileSync(
      path.join(directory, "contracts/Example.sol"),
      "changed Solidity",
    );
    assert.throws(
      () => verifyCompiledInputs(directory),
      /sources changed since compilation/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("public testnet rehearsal refuses early payout instead of advancing chain time", () => {
  assert.throws(
    () => readyAfter(100, 100, "Challenge window"),
    /time must pass naturally/,
  );
  readyAfter(101, 100, "Challenge window");
});
test("a confirmed journal resumes the same receipt without signing or broadcasting", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "testnet-journal-"));
  const from = ethers.Wallet.createRandom().address,
    to = ethers.Wallet.createRandom().address;
  const hash = "0x" + "11".repeat(32),
    blockHash = "0x" + "22".repeat(32);
  const expected = {
    from: from.toLowerCase(),
    to: to.toLowerCase(),
    data: "0x",
    value: "1",
  };
  const journal = {
    transactions: { one: { hash, nonce: 4, expected, state: "confirmed" } },
  };
  let broadcasts = 0;
  const receipt = {
    hash,
    status: 1,
    blockNumber: 10,
    blockHash,
    gasUsed: 21000n,
    confirmations: async () => 2,
  };
  const provider = {
    send: async () => "0x27d8",
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => ({
      chainId: 10200n,
      nonce: 4,
      from,
      to,
      data: "0x",
      value: 1n,
    }),
    getBlock: async () => ({ hash: blockHash }),
    broadcastTransaction: async () => {
      broadcasts++;
    },
  };
  try {
    await sendOnce({
      provider,
      signer: {
        getAddress: async () => from,
        signTransaction: async () => assert.fail("Must not sign again"),
      },
      journal,
      journalPath: path.join(dir, "journal.json"),
      action: "one",
      request: { to, value: 1n },
    });
    assert.equal(broadcasts, 0);
    await assert.rejects(
      sendOnce({
        provider,
        signer: { getAddress: async () => from },
        journal,
        journalPath: path.join(dir, "journal.json"),
        action: "one",
        request: { to, value: 2n },
      }),
      /conflicts/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("an ambiguous submission is journaled before broadcast and never automatically replayed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "testnet-ambiguous-"));
  const filename = path.join(dir, "journal.json"),
    from = ethers.Wallet.createRandom().address,
    to = ethers.Wallet.createRandom().address;
  const journal = { transactions: {} };
  let broadcasts = 0;
  const signer = {
    getAddress: async () => from,
    populateTransaction: async (request) => ({
      ...request,
      nonce: 0,
      gasLimit: 21000n,
      gasPrice: 7n,
    }),
    signTransaction: async () => "0x010203",
  };
  const provider = {
    send: async () => "0x27d8",
    getBlock: async () => ({ baseFeePerGas: 7n }),
    getBalance: async () => 10n ** 18n,
    broadcastTransaction: async () => {
      broadcasts++;
      assert.ok(JSON.parse(fs.readFileSync(filename)).transactions.one.hash);
      throw new Error("Transport failure");
    },
    getTransactionReceipt: async () => null,
    waitForTransaction: async () => {
      throw new Error("Not observed");
    },
  };
  try {
    await assert.rejects(
      sendOnce({
        provider,
        signer,
        journal,
        journalPath: filename,
        action: "one",
        request: { to, value: 1n },
      }),
      /outcome is uncertain/,
    );
    assert.equal(journal.transactions.one.state, "submission-uncertain");
    await assert.rejects(
      sendOnce({
        provider,
        signer,
        journal,
        journalPath: filename,
        action: "one",
        request: { to, value: 1n },
      }),
      /same receipt without rebroadcasting/,
    );
    assert.equal(broadcasts, 1);
    assert.equal(fs.readFileSync(filename, "utf8").includes("0x010203"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test(
  "controlled tooling deploys and rehearses real v8 custody locally, including credit recovery and held-share topups",
  { timeout: 180000 },
  async () => {
    // This provider is an in-memory local chain only. Time changes exist solely in this test.
    const rpc = ganache.provider({
      logging: { quiet: true },
      chain: { chainId: 10200, hardfork: "berlin" },
      miner: { defaultGasPrice: 7, blockGasLimit: 17000000 },
      wallet: { defaultBalance: 100 },
    });
    const provider = new ethers.BrowserProvider(rpc, undefined, {
      cacheTimeout: -1,
    });
    provider.pollingInterval = 10;
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "testnet-local-rehearsal-"),
    );
    const { artifacts, provenance } = verifyCompiledInputs();
    const wallet = fixtureWallet();
    await rpc.request({
      method: "evm_setAccountBalance",
      params: [
        wallet.roles.ownerA.address,
        ethers.toQuantity(ethers.parseEther("100")),
      ],
    });
    const ticker = setInterval(() => {
      rpc.request({ method: "evm_mine", params: [] }).catch(() => {});
    }, 100);
    try {
      const now = (await provider.getBlock("latest")).timestamp;
      const plan = preparePlan({
        wallet,
        provenance,
        publicOrigin: "https://example.test",
        policyBytes: fs.readFileSync(
          path.join(ROOT, "public/policies/v8-testnet.md"),
        ),
        now,
        startInMinutes: 15,
      });
      const manifest = await deployPlan({
        plan,
        wallet,
        provider,
        artifacts,
        journalPath: path.join(directory, "deployment.json"),
        manifestPath: path.join(directory, "manifest.json"),
      });
      assert.notEqual(
        manifest.events[0].deployment.owner,
        manifest.events[1].deployment.owner,
      );
      assert.equal(
        JSON.stringify(manifest).includes(wallet.roles.ownerA.privateKey),
        false,
      );
      const journalPath = path.join(directory, "rehearsal.json"),
        journal = loadJournal(journalPath, plan);
      const run = (stage) =>
        runStage({
          stage,
          execute: true,
          provider,
          plan,
          manifest,
          artifacts,
          wallet,
          journal,
          journalPath,
          proofPath: path.join(directory, "local-only-proof.json"),
        });
      for (const stage of ["fund", "deposit", "recover-credit", "admit"])
        await run(stage);
      await assert.rejects(run("attendance"), /Attendance opens/);
      await rpc.request({ method: "evm_increaseTime", params: [901] });
      await rpc.request({ method: "evm_mine", params: [] });
      const savedDepositHashes = Object.fromEntries(
        Object.entries(journal.transactions)
          .filter(([key]) => key.startsWith("deposit-"))
          .map(([key, value]) => [key, value.hash]),
      );
      const balanceBeforeResume = await provider.getBalance(
        manifest.events[0].deployment.contract,
      );
      await run("deposit");
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(journal.transactions)
            .filter(([key]) => key.startsWith("deposit-"))
            .map(([key, value]) => [key, value.hash]),
        ),
        savedDepositHashes,
      );
      assert.equal(
        await provider.getBalance(manifest.events[0].deployment.contract),
        balanceBeforeResume,
      );
      const missingReceipt = structuredClone(journal);
      delete missingReceipt.transactions["deposit-alice-b"];
      await assert.rejects(
        runStage({
          stage: "deposit",
          execute: true,
          provider,
          plan,
          manifest,
          artifacts,
          wallet,
          journal: missingReceipt,
          journalPath,
        }),
        /only receipt checks/,
      );
      for (const stage of ["attendance", "challenge", "match"])
        await run(stage);
      await assert.rejects(run("payout"), /time must pass naturally/);
      await rpc.request({ method: "evm_increaseTime", params: [86401] });
      await rpc.request({ method: "evm_mine", params: [] });
      for (const stage of ["payout", "ruling", "settle"]) await run(stage);
      const result = await run("verify");
      assert.equal(result.status, "passed");
      assert.equal(result.finalRuling, 2);
      assert.equal(result.alicePayoutWei, "1500000000000");
      assert.equal(result.carolPayoutWei, "1500000000000");
      assert.equal(result.bUnchangedDuringASettlement, true);
      assert.equal(
        result.collateralDelivery.method,
        "canonical-block-recipient-balance-and-gas",
      );
      assert.equal(
        result.collateralDelivery.totalChallengeCollateralWei,
        "30000000000",
      );
      const matcherProof = result.collateralDelivery.recipients.find(
        (row) => row.wallet === wallet.roles.ownerA.address,
      );
      assert.equal(matcherProof.collateralDeliveredWei, "30000000000");
      assert.ok(BigInt(matcherProof.gasPaidWei) > 0n);
      const event = new ethers.Contract(
        manifest.events[0].deployment.contract,
        artifacts.KlerosEventV8.abi,
        provider,
      );
      const settlementBlock = result.collateralDelivery.blockNumber;
      const inconsistentBalances = new Proxy(provider, {
        get(target, key) {
          if (key === "getBalance")
            return async (address, block) =>
              (await target.getBalance(address, block)) +
              (block === settlementBlock &&
              address.toLowerCase() ===
                wallet.roles.ownerA.address.toLowerCase()
                ? 1n
                : 0n);
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await assert.rejects(
        proveCollateralDelivery({
          provider: inconsistentBalances,
          event,
          challenge: await event.challenges(wallet.roles.bob.address),
          bob: wallet.roles.bob.address,
          finalRuling: 2,
          hash: journal.transactions["settle-bob-a"].hash,
        }),
        /do not prove/,
      );
    } finally {
      clearInterval(ticker);
      provider.destroy();
      await rpc.disconnect();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
