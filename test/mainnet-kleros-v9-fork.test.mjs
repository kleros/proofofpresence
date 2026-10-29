// Opt-in fork: upstream Ethereum is strictly read-only; all transactions/time changes stay in Ganache.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import ganache from "ganache";
import { ethers } from "ethers";
import solc from "solc-hardened";
import { MAINNET_KLEROS, MAINNET_EXTRA_DATA, readOnlyMainnetRpc, verifyKleros, sha256 } from "../scripts/mainnet/verify-kleros.mjs";
import { createVerificationRuntime } from "../scripts/mainnet/verification-runtime.mjs";

const enabled = process.env.MAINNET_KLEROS_V9_FORK === "1";
const D = ethers.parseEther("0.01"), DAY = 86_400;
const GAS = { gasLimit: 8_000_000 };
const json = relative => JSON.parse(fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"));
const artifact = name => json(`build/contracts-v9/${name}.json`);
const send = async promise => (await promise).wait();

test("real Ethereum Kleros V1 with V9 UUPS proxies: factory isolation, ETH custody, evidence, final delivery, ruling1/0/2 and array rewards ABI", {
  skip: !enabled, timeout: 240_000,
}, async () => {
  const sourceFiles = ["test/mainnet-kleros-v9-fork.test.mjs", "scripts/mainnet/verify-kleros.mjs", "scripts/mainnet/verification-runtime.mjs",
    "contracts/v9/KlerosEventV9.sol", "contracts/v9/KlerosEventFactoryV9.sol",
    "contracts/v9/KlerosUpgradeGateV9.sol", "contracts/v9/KlerosUpgradeTimelockV9.sol"];
  const sourcePins = Object.fromEntries(sourceFiles.map(filename =>
    [filename, sha256(fs.readFileSync(new URL(`../${filename}`, import.meta.url)))]));
  const input = json("build/contracts-v9/standard-input.json");
  for (const [filename, source] of Object.entries(input.sources))
    assert.equal(source.content, fs.readFileSync(new URL(`../${filename.startsWith("@openzeppelin/") ? "node_modules/" : ""}${filename}`, import.meta.url), "utf8"),
      "saved compiler input must bind every production and exact OpenZeppelin source");
  assert.match(solc.version(), /^0\.8\.38\+/);
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.equal((output.errors ?? []).filter(error => error.severity === "error").length, 0);
  const testedArtifacts = {};
  for (const name of ["KlerosEventV9", "KlerosEventFactoryV9", "KlerosUpgradeTimelockV9", "ERC1967Proxy"]) {
    const source = name === "ERC1967Proxy" ? "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol" : `contracts/v9/${name}.sol`;
    const saved = artifact(name), compiled = output.contracts[source][name];
    assert.equal(saved.compiler, solc.version());
    assert.deepEqual(saved.abi, compiled.abi);
    assert.equal(saved.bytecode, "0x" + compiled.evm.bytecode.object);
    assert.equal(saved.deployedBytecode, "0x" + compiled.evm.deployedBytecode.object);
    assert.deepEqual(saved.immutableReferences, compiled.evm.deployedBytecode.immutableReferences);
    testedArtifacts[name] = saved;
  }
  const migrationInput = structuredClone(input);
  migrationInput.sources["test/V9ForkUpgrade.sol"] = { content: `pragma solidity 0.8.38;
    import {KlerosEventV9} from "contracts/v9/KlerosEventV9.sol";
    contract V9ForkRevision2 is KlerosEventV9 { function implementationRevision() public pure override returns(uint256){return 2;} }` };
  const migrationOutput = JSON.parse(solc.compile(JSON.stringify(migrationInput)));
  assert.equal((migrationOutput.errors ?? []).filter(error => error.severity === "error").length, 0);
  const revision2 = migrationOutput.contracts["test/V9ForkUpgrade.sol"].V9ForkRevision2;
  const upstream = readOnlyMainnetRpc(process.env.MAINNET_FORK_RPC ?? "https://ethereum-rpc.publicnode.com");
  // Serialize public historical reads to avoid bursts. The reviewed verification
  // runtime retries allowlisted reads only; Ganache transactions are never retried.
  const verification = createVerificationRuntime({ send: (method, params) => upstream.request(method, params),
    expectedChainId: 1, maxAttempts: 3, timeoutMs: 10_000 });
  let readTail = Promise.resolve();
  const readUpstream = (method, params = []) => {
    const task = readTail.then(() => verification.request(method, params));
    readTail = task.catch(() => {});
    return task;
  };
  const proof = await verifyKleros({ block: process.env.MAINNET_FORK_BLOCK ?? MAINNET_KLEROS.baselineBlock,
    transport: { request: readUpstream, endpoint: upstream.endpoint,
      get methods() { return upstream.methods; }, get counts() { return upstream.counts; } } });
  const rejected = [];
  const bridge = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      let raw = "";
      for await (const chunk of req) { raw += chunk; assert.ok(raw.length < 2_000_000); }
      const input = JSON.parse(raw);
      const serve = async item => {
        try { return { jsonrpc: "2.0", id: item.id, result: await readUpstream(item.method, item.params ?? []) }; }
        catch (error) { rejected.push({ method: item.method, message: error.message }); return { jsonrpc: "2.0", id: item.id, error: { code: -32000, message: error.message } }; }
      };
      const result = Array.isArray(input) ? await Promise.all(input.map(serve)) : await serve(input);
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(result));
    } catch { res.writeHead(400); res.end("Invalid read-only fork request"); }
  });
  await new Promise(resolve => bridge.listen(0, "127.0.0.1", resolve));
  const address = bridge.address(); assert.ok(address && typeof address !== "string");
  let rpc, provider;
  try {
    rpc = ganache.provider({ logging: { quiet: true },
      fork: { url: `http://127.0.0.1:${address.port}`, blockNumber: proof.block.number },
      chain: { chainId: 1, hardfork: "shanghai", time: new Date(proof.block.timestamp * 1000) },
      miner: { blockGasLimit: 60_000_000, timestampIncrement: 0 },
      wallet: { deterministic: true, totalAccounts: 8, defaultBalance: 1000, unlockedAccounts: [MAINNET_KLEROS.arbitrator] } });
    // Local object identity + emulator methods are mandatory before any transaction or clock control.
    assert.match(await rpc.request({ method: "web3_clientVersion", params: [] }), /Ganache/);
    assert.equal(await rpc.request({ method: "eth_chainId", params: [] }), "0x1");
    const safetySnapshot = await rpc.request({ method: "evm_snapshot", params: [] });
    assert.equal(await rpc.request({ method: "evm_revert", params: [safetySnapshot] }), true);
    provider = new ethers.BrowserProvider(rpc, 1, { cacheTimeout: -1 }); provider.pollingInterval = 10;
    const [owner, alice, bob, matcher, beneficiary] = await Promise.all([0, 1, 2, 3, 4].map(i => provider.getSigner(i)));
    const resolver = new ethers.Contract(MAINNET_KLEROS.resolver, json("scripts/mainnet/ethereum-resolver.abi.json"), provider);
    const liquid = new ethers.Contract(MAINNET_KLEROS.arbitrator, json("scripts/mainnet/ethereum-arbitrator.abi.json"), provider);
    assert.equal(ethers.keccak256(await provider.getCode(resolver.target)), MAINNET_KLEROS.resolverCodeHash);
    assert.equal(ethers.keccak256(await provider.getCode(liquid.target)), MAINNET_KLEROS.arbitratorCodeHash);
    const now = async () => Number(BigInt((await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp));
    const advance = async timestamp => {
      assert.ok(timestamp >= await now());
      await rpc.request({ method: "evm_setTime", params: [timestamp * 1000] });
      await rpc.request({ method: "evm_mine", params: [] });
    };
    const deploy = async (name, ...args) => {
      const a = testedArtifacts[name], c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args, { gasLimit: 16_000_000 });
      await c.waitForDeployment(); return c;
    };
    const startingNonce = await provider.getTransactionCount(owner.address);
    const timelock = await deploy("KlerosUpgradeTimelockV9", owner.address);
    const eventImpl = await deploy("KlerosEventV9"), factoryImpl = await deploy("KlerosEventFactoryV9");
    const proxy = await deploy("ERC1967Proxy", factoryImpl.target,
      factoryImpl.interface.encodeFunctionData("initialize", [eventImpl.target, timelock.target]));
    const factory = new ethers.Contract(proxy.target, testedArtifacts.KlerosEventFactoryV9.abi, owner);
    assert.equal(await factory.VERSION(), 9n); assert.equal(await factory.eventImplementation(), eventImpl.target);
    assert.equal(await factory.upgradeAuthority(), timelock.target);
    assert.equal(await timelock.owner(), owner.address);
    assert.equal(await timelock.pendingOwner(), ethers.ZeroAddress);
    for (const [i, deployed] of [timelock, eventImpl, factoryImpl, proxy].entries()) {
      assert.equal(deployed.deploymentTransaction().from, owner.address);
      assert.equal(deployed.deploymentTransaction().nonce, startingNonce + i, "one EOA deploys all four contracts without a governance helper");
      assert.equal(deployed.target, ethers.getCreateAddress({ from: owner.address, nonce: startingNonce + i }));
    }
    const patchedRuntime = (a, implementation) => {
      const bytes = Buffer.from(a.deployedBytecode.slice(2), "hex");
      for (const [id, references] of Object.entries(a.immutableReferences)) {
        const value = a.immutableValues[id].value === "implementation-address" ? ethers.zeroPadValue(implementation, 32) : a.immutableValues[id].value;
        for (const reference of references) Buffer.from(value.slice(2), "hex").copy(bytes, reference.start);
      }
      return "0x" + bytes.toString("hex");
    };
    for (const [name, implementation] of [["KlerosEventV9", eventImpl], ["KlerosEventFactoryV9", factoryImpl]])
      assert.equal(await provider.getCode(implementation.target), patchedRuntime(testedArtifacts[name], implementation.target));
    const children = [], cases = [];
    const create = async label => {
      const time = await now(), eventKey = ethers.id(`synthetic-mainnet-fork-${label}`);
      const config = { depositAmount: D, eventName: `Synthetic fork ${label}`, eventStart: time + 60, claimDeadline: time + 8 * DAY,
        arbitration: { disputeResolver: resolver.target, extraData: MAINNET_EXTRA_DATA,
          metaEvidenceTemplate: ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
          metaEvidenceSlots: "0x010204", policyURI: "https://example.invalid/synthetic-fork-policy" } };
      const receipt = await send(factory.createEvent(eventKey, config, { gasLimit: 10_000_000 }));
      const created = receipt.logs.filter(l => l.address.toLowerCase() === factory.target.toLowerCase())
        .map(l => factory.interface.parseLog(l)).find(l => l.name === "EventCreated");
      assert.equal(created.args.version, 9n);
      const c = new ethers.Contract(created.args.eventContract, testedArtifacts.KlerosEventV9.abi, owner);
      assert.equal(await c.CHALLENGE_PERIOD(), BigInt(DAY)); assert.equal(await c.MATCH_PERIOD(), BigInt(DAY));
      assert.equal(await c.owner(), owner.address); assert.equal(await c.disputeResolver(), resolver.target);
      assert.equal(await c.upgradeAuthority(), timelock.target); assert.equal(await c.originatingFactory(), factory.target);
      assert.equal(await provider.getCode(c.target), testedArtifacts.ERC1967Proxy.deployedBytecode);
      children.push(c); return c;
    };
    const control = await create("control");
    await send(control.connect(alice).deposit({ value: D, ...GAS }));
    const controlBalance = await provider.getBalance(control.target);
    // Court adjudication alone is simulated by impersonating its address on this local fork.
    await rpc.request({ method: "evm_setAccountBalance", params: [liquid.target, ethers.toQuantity(ethers.parseEther("100"))] });
    const courtCallback = await provider.getSigner(liquid.target);
    // Simulate jury decisions ONLY. Slot derivation is pinned to the exact verified Liquid runtime.
    // All resolver funding/accounting, Liquid appeal/period execution and ETH transfers stay real.
    const juryAppeal = async (external, winner) => {
      assert.equal(ethers.keccak256(await provider.getCode(liquid.target)), MAINNET_KLEROS.arbitratorCodeHash);
      const scalar = async slot => {
        const raw = await rpc.request({ method: "eth_getStorageAt", params: [liquid.target, ethers.toQuantity(slot), "latest"] });
        return BigInt(raw === "0x" ? "0x0" : raw);
      };
      const arrayBase = slot => BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [slot])));
      const base = arrayBase(15n) + external * 14n;
      const observed = await liquid.disputes(external);
      assert.ok(await scalar(15n) > external, "verified Liquid disputes array contains this case");
      const packed = await scalar(base);
      assert.equal(packed & ((1n << 96n) - 1n), observed.subcourtID);
      assert.equal(ethers.getAddress(ethers.toBeHex(packed >> 96n, 20)), resolver.target);
      assert.equal(await scalar(base + 1n), 2n);
      assert.equal(await scalar(base + 2n), observed.period);
      assert.equal(await scalar(base + 3n), observed.lastPeriodChange);
      const rounds = await scalar(base + 5n), counter = arrayBase(base + 5n) + (rounds - 1n) * 3n;
      assert.ok(rounds > 0n);
      const write = async (slot, value) => rpc.request({ method: "evm_setAccountStorageAt", params: [liquid.target,
        ethers.toBeHex(slot, 32), ethers.toBeHex(value, 32)] });
      await write(base + 2n, 3n); await write(base + 3n, BigInt(await now()));
      await write(counter, BigInt(winner)); await write(counter + 2n, 0n);
      await rpc.request({ method: "evm_mine", params: [] });
      assert.equal((await liquid.disputes(external)).period, 3n);
      assert.equal(await liquid.currentRuling(external), BigInt(winner));
      const period = await liquid.appealPeriod(external); assert.ok(period[1] > period[0]);
      return { rounds, period };
    };
    for (const { ruling, positiveAppeal } of [{ ruling: 1, positiveAppeal: true }, { ruling: 1 }, { ruling: 0 }, { ruling: 2 }]) {
      const c = await create(`${positiveAppeal ? "appealed-" : ""}ruling-${ruling}`);
      await send(c.connect(alice).deposit({ value: 2n * D, ...GAS }));
      await send(c.connect(bob).deposit({ value: D, ...GAS }));
      await send(c.registerStakers([alice.address, bob.address], GAS));
      await advance(Number(await c.eventStart()));
      await send(c.postAttendance([alice.address], 2n * D, GAS));
      const fee = await c.challengeDeposit(); assert.equal(fee, BigInt(proof.arbitrationCostWei));
      await send(c.connect(bob).challenge({ value: fee, ...GAS }));
      const match = await send(c.connect(matcher).matchChallenge(bob.address, { value: fee, ...GAS }));
      const challenge = await c.challenges(bob.address);
      const local = challenge.localDisputeID, external = challenge.arbitratorDisputeID;
      assert.equal(await resolver.externalIDtoLocalID(external), local);
      const realCase = await resolver.disputes(local);
      assert.equal(realCase.isRuled, false); assert.equal(realCase.disputeIDOnArbitratorSide, external);
      assert.equal((await liquid.disputes(external)).arbitrated, resolver.target);
      assert.ok(match.logs.some(l => l.address.toLowerCase() === liquid.target.toLowerCase()));
      const evidence = await send(resolver.connect(bob).submitEvidence(local, "https://example.invalid/synthetic-evidence", GAS));
      const emitted = evidence.logs.filter(l => l.address.toLowerCase() === resolver.target.toLowerCase())
        .map(l => resolver.interface.parseLog(l)).find(l => l.name === "Evidence");
      assert.equal(emitted.args._party, bob.address);
      assert.equal(await resolver.getTotalWithdrawableAmount(local, bob.address, [1, 2]), 0n);
      await assert.rejects(resolver.connect(bob).withdrawFeesAndRewardsForAllRounds.staticCall(local, bob.address, [1, 2]));
      // No appeal is open in the actual evidence period.
      await assert.rejects(resolver.connect(bob).fundAppeal.staticCall(local, 1, { value: fee }));
      await advance(Number(await c.challengeEndsAt()));
      await assert.rejects(c.releasePayouts.staticCall());
      await advance(Number(await c.challengeEndsAt()) + 1);
      const aliceBefore = await provider.getBalance(alice.address);
      await send(c.releasePayouts(GAS));
      assert.equal(await provider.getBalance(alice.address), aliceBefore + D);
      assert.equal(await c.heldBack(), D); assert.equal(await c.pendingTotal(), D); assert.equal(await c.challengeEscrow(), fee);
      await assert.rejects(c.resolveChallenge.staticCall(bob.address));
      let appealProof;
      if (positiveAppeal) {
        const eventBalance = await provider.getBalance(c.target), resolverBefore = await provider.getBalance(resolver.target);
        const nextImplementation = await new ethers.ContractFactory(revision2.abi, "0x" + revision2.evm.bytecode.object, owner)
          .deploy({ gasLimit: 16_000_000 }); await nextImplementation.waitForDeployment();
        const upgradeData = c.interface.encodeFunctionData("upgradeToAndCall", [nextImplementation.target, "0x"]), salt = ethers.id("real-kleros-v9-held-upgrade");
        await send(timelock.connect(owner).schedule(c.target, 0, upgradeData, ethers.ZeroHash, salt, 172800, GAS));
        const operation = await timelock.hashOperation(c.target, 0, upgradeData, ethers.ZeroHash, salt);
        await advance(Number(await timelock.getTimestamp(operation)));
        await send(timelock.connect(owner).execute(c.target, 0, upgradeData, ethers.ZeroHash, salt, GAS));
        assert.equal(await timelock.pendingOperationCount(), 0n); assert.equal(await timelock.executingOperationCount(), 0n);
        assert.equal(await c.implementationRevision(), 2n); assert.equal(await c.heldBack(), D);
        assert.equal(await c.pendingTotal(), D); assert.equal(await provider.getBalance(c.target), eventBalance);
        assert.equal(await control.implementationRevision(), 1n); assert.equal(await factory.eventImplementation(), eventImpl.target);
        await juryAppeal(external, 2);
        const cost = await liquid.appealCost(external, MAINNET_EXTRA_DATA), status = await c.appealStatus(bob.address);
        assert.equal(status.costAttended, 3n * cost); assert.equal(status.costAbsent, 2n * cost);
        const beforeFund = await provider.getBalance(bob.address);
        const fund = await send(resolver.connect(bob).fundAppeal(local, 1, { value: 3n * cost + 7n, ...GAS }));
        assert.equal(await provider.getBalance(bob.address), beforeFund - 3n * cost - fund.fee,
          "actual deployed resolver returns surplus7wei to EOA contributor");
        await send(resolver.connect(matcher).fundAppeal(local, 2, { value: 2n * cost, ...GAS }));
        assert.equal((await liquid.disputes(external)).period, 0n, "actual Liquid appeal opens a fresh evidence round");
        await assert.rejects(c.resolveChallenge.staticCall(bob.address));
        const next = await juryAppeal(external, 2); assert.equal(next.rounds, 2n);
        const nextCost = await liquid.appealCost(external, MAINNET_EXTRA_DATA);
        await send(resolver.connect(bob).fundAppeal(local, 1, { value: 3n * nextCost, ...GAS }));
        await send(resolver.connect(matcher).fundAppeal(local, 2, { value: nextCost, ...GAS }));
        assert.equal(await provider.getBalance(c.target), eventBalance, "appeals never consume event custody");
        await advance(Number(next.period[1]) + 1);
        await send(liquid.connect(owner).passPeriod(external, GAS));
        assert.equal((await liquid.disputes(external)).period, 4n);
        assert.equal((await resolver.disputes(local)).isRuled, false, "execution period alone is not delivered finality");
        await assert.rejects(c.resolveChallenge.staticCall(bob.address));
        await send(liquid.connect(owner).executeRuling(external, GAS));
        assert.equal(await liquid.currentRuling(external), 2n);
        assert.equal((await resolver.disputes(local)).ruling, 1n, "one-sided full appeal funding overrides the Court callback");
        const bobReward = await resolver.getTotalWithdrawableAmount(local, bob.address, [1, 2]);
        const matcherRefund = await resolver.getTotalWithdrawableAmount(local, matcher.address, [1, 2]);
        assert.equal(bobReward, 4n * cost + 3n * nextCost); assert.equal(matcherRefund, nextCost);
        for (const [contributor, amount] of [[bob, bobReward], [matcher, matcherRefund]]) {
          const before = await provider.getBalance(contributor.address);
          await send(resolver.connect(owner).withdrawFeesAndRewardsForAllRounds(local, contributor.address, [1, 2], GAS));
          assert.equal(await provider.getBalance(contributor.address), before + amount, "actual native reward/refund reaches EOA");
          assert.equal(await resolver.getTotalWithdrawableAmount(local, contributor.address, [1, 2]), 0n);
        }
        assert.equal(await provider.getBalance(resolver.target), resolverBefore);
        assert.equal(await provider.getBalance(c.target), eventBalance);
        appealProof = { realLiquidAppeal: true, realPassPeriodAndExecuteRuling: true,
          heldCaseUpgradedThrough48hTimelock: true,
          originalAppealCostWei: String(cost), nextAppealCostWei: String(nextCost), surplusRefundWei: "7",
          bobRewardsWei: String(bobReward), matcherIncompleteContributionRefundWei: String(matcherRefund),
          jurySimulation: "Local Ganache storage only; verified Liquid code unchanged" };
      } else await send(resolver.connect(courtCallback).rule(external, ruling, GAS));
      const delivered = await resolver.disputes(local);
      assert.equal(delivered.isRuled, true); assert.equal(delivered.ruling, BigInt(ruling));
      await resolver.connect(bob).withdrawFeesAndRewardsForAllRounds.staticCall(local, bob.address, [1, 2]);
      assert.equal(await c.heldBack(), D, "delivered final result is separate from event settlement");
      await assert.rejects(resolver.connect(bob).submitEvidence.staticCall(local, "https://example.invalid/late"));
      const before = await Promise.all([bob, matcher, alice].map(s => provider.getBalance(s.address)));
      const settled = await send(c.resolveChallenge(bob.address, GAS));
      const after = await Promise.all([bob, matcher, alice].map(s => provider.getBalance(s.address)));
      const paid = settled.logs.filter(l => l.address.toLowerCase() === c.target.toLowerCase())
        .map(l => c.interface.parseLog(l)).filter(l => l.name === "Payout");
      if (ruling === 1) {
        assert.equal(after[0] - before[0], D + fee);
        assert.deepEqual(paid.map(l => [l.args.to, l.args.amount]), [[bob.address, D]]);
        assert.equal(await c.attended(bob.address), true);
      } else {
        assert.equal(after[2] - before[2], D);
        assert.equal(after[0] - before[0], ruling === 0 ? fee / 2n : 0n);
        assert.equal(after[1] - before[1], ruling === 0 ? fee - fee / 2n : fee);
        assert.equal(await c.attended(bob.address), false);
      }
      assert.equal(await c.heldBack(), 0n); assert.equal(await c.challengeEscrow(), 0n);
      assert.equal(await c.pendingTotal(), D); assert.equal(await c.reserved(), D);
      assert.equal(await c.owedTotal(), 0n);
      const recoveryBefore = await provider.getBalance(beneficiary.address);
      await send(c.connect(alice).withdrawPending(beneficiary.address, D, GAS));
      assert.equal(await provider.getBalance(beneficiary.address), recoveryBefore + D);
      assert.equal(await provider.getBalance(c.target), 0n); assert.equal(await c.reserved(), 0n);
      assert.equal(await provider.getBalance(control.target), controlBalance);
      assert.equal(await control.pendingDeposits(alice.address), D);
      cases.push({ ruling, localId: String(local), arbitratorId: String(external), feeWei: String(fee),
        settlementGas: String(settled.gasUsed), settlementHash: settled.hash, ...(appealProof ? { appeal: appealProof } : {}) });
      console.log(`PASS real deployed resolver ruling${ruling}: local${local}/Court${external}; native custody and final settlement reconciled`);
    }
    assert.equal(await factory.eventCount(), 5n);
    assert.equal(children.length, 5);
    assert.equal(rejected.length, 0, JSON.stringify(rejected));
    for (const filename of sourceFiles)
      assert.equal(sha256(fs.readFileSync(new URL(`../${filename}`, import.meta.url))), sourcePins[filename], "Fork verification source changed during the run");
    const report = { result: "PASS", profile: "kleros-event-v9-uups", governance: "single-owner-timelock", environment: "LOCAL GANACHE MAINNET FORK", canonicalSourceBlock: proof.block,
      resolver: proof.resolver, arbitrator: proof.arbitrator, cases,
      localFactoryChildren: children.length, adjudication: "Only jury state/final Court callbacks simulated locally; actual code retained; no actual jury vote",
      upstreamReadMethods: upstream.methods, upstreamRequests: upstream.counts.requests,
      upstreamReadDiagnostics: verification.diagnostics,
      upstreamSignatures: 0, upstreamBroadcasts: 0, privateSigningFilesRead: 0,
      sources: sourcePins, compiledProduction: { compiler: solc.version(), standardInputSha256: sha256(JSON.stringify(input)),
        creationCodeHashes: Object.fromEntries(Object.entries(testedArtifacts).map(([name, a]) => [name, ethers.keccak256(a.bytecode)])) } };
    if (process.env.MAINNET_V9_FORK_REPORT) {
      assert.match(process.env.MAINNET_V9_FORK_REPORT, /^artifacts\/mainnet-kleros\/[a-zA-Z0-9_-]+\.json$/);
      const filename = new URL(`../${process.env.MAINNET_V9_FORK_REPORT}`, import.meta.url);
      fs.mkdirSync(new URL("./", filename), { recursive: true });
      fs.writeFileSync(filename, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    }
    console.log(JSON.stringify(report));
  } finally {
    provider?.destroy(); await rpc?.disconnect();
    bridge.closeAllConnections(); await new Promise(resolve => bridge.close(resolve));
  }
});
