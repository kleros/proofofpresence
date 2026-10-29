// All four unsigned CREATE requests execute only on an isolated in-process chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import { prepareRelease, verifyV9Build, V9_PROFILE } from "../scripts/mainnet/prepare-release.mjs";

test("unsigned V9 deployment sequence rehearses all four CREATE requests and exact runtime hashes locally", { timeout: 120000 }, async () => {
  const build = verifyV9Build();
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 30000000 }, wallet: { totalAccounts: 2, defaultBalance: 100 } });
  const provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  try {
    const owner = await provider.getSigner();
    // This permissionless helper is a synthetic fixture, never a proposed production multisig.
    const helper = JSON.parse(fs.readFileSync(new URL("../references/kickback/build/TestWallet.json", import.meta.url)));
    const governance = await new ethers.ContractFactory(helper.abi, helper.bytecode, owner).deploy();
    await governance.waitForDeployment();
    const config = { schemaVersion: 1, chainId: 1, contractVersion: V9_PROFILE, deployer: owner.address,
      deployerNonce: Number(BigInt(await rpc.request({ method: "eth_getTransactionCount", params: [owner.address, "latest"] }))),
      governance: { kind: "project-multisig", multisig: governance.target,
        expectedCodeHash: ethers.keccak256(await provider.getCode(governance.target)), minimumDelaySeconds: 172800 },
      fees: { maxFeePerGasWei: "20000000000", maxPriorityFeePerGasWei: "1000000000" },
      gasLimits: Object.fromEntries(Object.keys(build.contracts).map(name => [name, "9000000"])), maxTotalGasCostWei: "1000000000000000000" };
    const plan = prepareRelease(config, build), gasUsed = {};
    for (const request of plan.transactions) {
      const tx = await owner.sendTransaction({ chainId: request.chainId, type: request.type, nonce: request.nonce, to: null,
        data: request.data, value: 0n, gasLimit: BigInt(request.gasLimit), maxFeePerGas: BigInt(request.maxFeePerGasWei),
        maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGasWei) });
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);
      assert.equal(receipt.contractAddress, request.predictedAddress);
      assert.equal(ethers.keccak256(await provider.getCode(receipt.contractAddress)), request.expectedRuntimeCodeHash);
      assert.ok(receipt.gasUsed < BigInt(request.gasLimit));
      gasUsed[request.contract] = String(receipt.gasUsed);
    }
    const timelock = new ethers.Contract(plan.addresses.KlerosUpgradeTimelockV9, build.contracts.KlerosUpgradeTimelockV9.abi, owner);
    const factory = new ethers.Contract(plan.factoryProxy, build.contracts.KlerosEventFactoryV9.abi, owner);
    assert.equal(await timelock.getMinDelay(), 172800n);
    assert.equal(await timelock.hasRole(await timelock.PROPOSER_ROLE(), governance.target), true);
    assert.equal(await timelock.hasRole(await timelock.CANCELLER_ROLE(), governance.target), true);
    assert.equal(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), ethers.ZeroAddress), true);
    assert.equal(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), owner.address), false);
    assert.equal(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), timelock.target), true);
    assert.equal(await factory.eventImplementation(), plan.addresses.KlerosEventV9);
    assert.equal(await factory.upgradeAuthority(), timelock.target);
    assert.equal(await factory.VERSION(), 9n);
    assert.equal(await factory.eventCount(), 0n);
    await assert.rejects(factory.initialize.staticCall(plan.addresses.KlerosEventV9, timelock.target));
    assert.equal(await provider.getBalance(plan.factoryProxy), 0n);
    console.log(JSON.stringify({ localUnsignedDeploymentRehearsal: "passed", gasUsed, mainnetBroadcasts: 0 }));
  } finally { provider.destroy(); await rpc.disconnect(); }
});
