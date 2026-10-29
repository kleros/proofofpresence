// Maximum event work on an isolated chain. Account-code replacement models hostile recipients.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";

const DAY = 86400, D = 10000000000000001n, CAP = 16777216n;
const json = relative => JSON.parse(fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"));
const send = async promise => (await promise).wait();
test("V9 proxy capacity150: hostile cancellation/payout fit gas cap and preserve every owed/pending liability", { timeout: 120000 }, async () => {
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60000000, timestampIncrement: 0 }, wallet: { totalAccounts: 153, defaultBalance: 1000 } });
  const p = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); p.pollingInterval = 10;
  try {
    const s = await Promise.all(Array.from({ length: 153 }, (_, i) => p.getSigner(i))), owner = s[0], outsider = s[151], beneficiary = s[152];
    const wallets = s.slice(1, 151).map(w => w.address);
    const artifact = name => json(["TestWallet", "MockKlerosLiquid", "MockArbitrableProxy"].includes(name)
      ? `references/kickback/build/${name}.json` : `build/contracts-v9/${name}.json`);
    const deploy = async (name, ...args) => {
      const a = artifact(name), c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args, { gasLimit: CAP });
      await c.waitForDeployment(); return c;
    };
    const gov = await deploy("TestWallet"), clock = await deploy("KlerosUpgradeTimelockV9", gov.target),
      implementation = await deploy("KlerosEventV9"), factoryImplementation = await deploy("KlerosEventFactoryV9");
    const registry = await deploy("ERC1967Proxy", factoryImplementation.target,
      factoryImplementation.interface.encodeFunctionData("initialize", [implementation.target, clock.target]));
    const factory = new ethers.Contract(registry.target, artifact("KlerosEventFactoryV9").abi, owner);
    const court = await deploy("MockKlerosLiquid"), resolver = await deploy("MockArbitrableProxy", court.target);
    const start = Number(BigInt((await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp)) + 3600;
    const receipt = await send(factory.createEvent(ethers.id("synthetic-v9-capacity"), { depositAmount: D,
      eventName: "Synthetic V9 proxy capacity", eventStart: start, claimDeadline: start + 8 * DAY,
      arbitration: [resolver.target, ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]),
        ['{"wallet":"', '","contract":"', '","organizer":"', '"}'], "0x010204", "https://example.invalid/capacity"] }, { gasLimit: CAP }));
    const created = receipt.logs.filter(l => l.address.toLowerCase() === factory.target.toLowerCase())
      .map(l => factory.interface.parseLog(l)).find(l => l.name === "EventCreated");
    const c = new ethers.Contract(created.args.eventContract, artifact("KlerosEventV9").abi, owner);
    assert.equal(await c.MAX_STAKERS(), 150n);
    for (const wallet of s.slice(1, 152)) await send(c.connect(wallet).deposit({ value: D, gasLimit: 200000 }));
    for (let i = 0; i < wallets.length; i += 50) await send(c.registerStakers(wallets.slice(i, i + 50), { gasLimit: 6000000 }));
    await assert.rejects(c.registerStakers.staticCall([outsider.address]), error => {
      assert.equal(c.interface.parseError(error.data ?? error.info?.error?.data?.result).name, "CapacityExceeded"); return true;
    });
    await assert.rejects(send(c.registerStakers([outsider.address], { gasLimit: 500000 })));
    assert.equal(await c.pendingDeposits(outsider.address), D); assert.equal(await c.stakerCount(), 150n);
    const solvent = async expected => {
      assert.equal(await c.reserved(), expected); assert.equal(await p.getBalance(c.target), expected);
      assert.equal(await c.spare(), 0n); await assert.rejects(c.refund.staticCall(beneficiary.address, 1));
    };
    const burn = async () => { for (const wallet of wallets) await rpc.request({ method: "evm_setAccountCode", params: [wallet, "0xfe"] }); };
    const cap = r => { assert.ok(r.gasUsed * 130n / 100n <= CAP, "maximum work retains30percent gas allowance below transaction cap"); return String(r.gasUsed); };
    await solvent(151n * D);
    const checkpoint = await rpc.request({ method: "evm_snapshot", params: [] });
    await burn();
    const cancelGas = cap(await send(c.cancel({ gasLimit: CAP })));
    assert.equal(await c.phase(), 3n); assert.equal(await c.owedTotal(), 150n * D); assert.equal(await c.pendingTotal(), D);
    await solvent(151n * D);
    await rpc.request({ method: "evm_setAccountCode", params: [wallets[0], "0x"] });
    const before = await p.getBalance(beneficiary.address);
    await send(c.connect(s[1]).claim(beneficiary.address, { gasLimit: 500000 }));
    assert.equal(await p.getBalance(beneficiary.address), before + D); await solvent(150n * D);
    assert.equal(await rpc.request({ method: "evm_revert", params: [checkpoint] }), true);
    await rpc.request({ method: "evm_setTime", params: [(start + 1) * 1000] }); await rpc.request({ method: "evm_mine", params: [] });
    await send(c.postAttendance(wallets, D, { gasLimit: CAP }));
    await rpc.request({ method: "evm_setTime", params: [(Number(await c.challengeEndsAt()) + 1) * 1000] });
    await rpc.request({ method: "evm_mine", params: [] }); await burn();
    const payoutGas = cap(await send(c.releasePayouts({ gasLimit: CAP })));
    assert.equal(await c.phase(), 2n); assert.equal(await c.attendeeCount(), 150n);
    assert.equal(await c.owedTotal(), 150n * D); assert.equal(await c.pendingTotal(), D);
    assert.equal(await c.heldBack(), 0n); assert.equal(await c.challengeEscrow(), 0n); await solvent(151n * D);
    for (const wallet of wallets) assert.equal(await c.owed(wallet), D);
    const destinationBefore = await p.getBalance(beneficiary.address);
    await send(c.connect(outsider).withdrawPending(beneficiary.address, D, { gasLimit: 500000 }));
    assert.equal(await p.getBalance(beneficiary.address), destinationBefore + D); await solvent(150n * D);
    const report = { result: "PASS", profile: "kleros-event-v9-uups", maximumAdmissions: 150,
      capGas: String(CAP), testedGasAllowancePercent: 30, cancellation150HostileGas: cancelGas, payout150HostileGas: payoutGas,
      owedRecipients: 150, publicTransactions: 0, environment: "in-process Ganache Shanghai; explicit gas cap; synthetic account-code replacement" };
    if (process.env.V9_CAPACITY_REPORT) {
      assert.match(process.env.V9_CAPACITY_REPORT, /^artifacts\/mainnet-kleros\/[a-zA-Z0-9_-]+\.json$/);
      const filename = new URL(`../${process.env.V9_CAPACITY_REPORT}`, import.meta.url);
      fs.mkdirSync(new URL("./", filename), { recursive: true }); fs.writeFileSync(filename, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    }
    console.log(JSON.stringify(report));
  } finally { p.destroy(); await rpc.disconnect(); }
});
