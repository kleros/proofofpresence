// Security characterization of the preserved v7 contract, not remediation assertions.
// No RPC URL/config is loaded: Ganache runs in-process with synthetic accounts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import { caseTemplate } from "../references/kickback/scripts/lib.mjs";

const artifact = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(`../references/kickback/build/${name}.json`, import.meta.url),
    ),
  );
const DAY = 86_400;
const D = ethers.parseEther("0.01");
const CAP = 16_777_216n;
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
const POLICY = "/ipfs/SyntheticSecurityReviewPolicy";
let rpc, provider, owner, payer, other, liquid, proxy;
const send = async (pending) => (await pending).wait();
const warp = async (seconds) => {
  await rpc.request({ method: "evm_increaseTime", params: [seconds] });
  await rpc.request({ method: "evm_mine", params: [] });
};
async function deploy(name, ...args) {
  const { abi, bytecode } = artifact(name);
  const contract = await new ethers.ContractFactory(
    abi,
    bytecode,
    owner,
  ).deploy(...args, { gasLimit: 12_000_000 });
  await contract.waitForDeployment();
  return contract;
}
async function fresh() {
  const t = Number(
    (
      await rpc.request({
        method: "eth_getBlockByNumber",
        params: ["latest", false],
      })
    ).timestamp,
  );
  const tpl = caseTemplate({
    eventName: "Synthetic security review",
    depositUnits: D,
    explorer: "https://example.invalid",
    owner: owner.address,
    kleros: { policyURI: POLICY },
  });
  return deploy(
    "TruthPaysKickback",
    D,
    "Synthetic security review",
    owner.address,
    t + 10,
    t + 8 * DAY,
    [proxy.target, EXTRA, tpl.pieces, tpl.slots, POLICY],
  );
}
async function rejectsWith(pending, kick, expected) {
  await assert.rejects(pending, (error) => {
    const data = error.data ?? error.info?.error?.data?.result;
    assert.equal(kick.interface.parseError(data)?.name, expected);
    return true;
  });
}

before(async () => {
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 },
    wallet: { totalAccounts: 5, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  [owner, payer, other] = await Promise.all(
    [0, 1, 2].map((i) => provider.getSigner(i)),
  );
  liquid = await deploy("MockKlerosLiquid");
  proxy = await deploy("MockArbitrableProxy", liquid.target);
});
after(async () => {
  provider?.destroy();
  await rpc?.disconnect();
});

test("v7 trust boundary: pending deposits are spare, owner can redirect them, outsider cannot", async () => {
  const kick = await fresh();
  await send(kick.connect(payer).deposit({ value: D }));
  assert.equal(await kick.reserved(), 0n);
  assert.equal(await kick.spare(), D);
  await rejectsWith(
    kick.connect(other).refund.staticCall(other.address, D),
    kick,
    "NotOwner",
  );
  const before = await provider.getBalance(other.address);
  await send(kick.refund(other.address, D, { gasLimit: 200_000 }));
  assert.equal(await provider.getBalance(other.address), before + D);
  assert.equal(await provider.getBalance(kick.target), 0n);
  assert.equal(await kick.status(payer.address), 0n);
});

test("v7 trust boundary: aggregate funding permits a nonpayer registration and unchallengeable inclusion", async () => {
  const kick = await fresh();
  await send(kick.connect(payer).deposit({ value: D }));
  // This deliberately bypasses the off-chain verifier to test the contract boundary.
  await send(kick.registerStakers([other.address], { gasLimit: 300_000 }));
  assert.equal(await kick.status(payer.address), 0n);
  assert.equal(await kick.status(other.address), 1n);
  await warp(11);
  await send(kick.postAttendance([other.address], D, { gasLimit: 300_000 }));
  await rejectsWith(
    kick.connect(payer).challenge.staticCall({ value: D * 10n }),
    kick,
    "NotAStaker",
  );
  await warp(DAY + 1);
  const before = await provider.getBalance(other.address);
  await send(kick.releasePayouts({ gasLimit: 300_000 }));
  assert.equal(await provider.getBalance(other.address), before + D);
  assert.equal(await kick.phase(), 2n);
});

test("v7 recovery gap: Open accepts deposits after claimDeadline but unregistered payer cannot self-withdraw", async () => {
  const kick = await fresh();
  await send(kick.connect(other).deposit({ value: D }));
  await send(kick.registerStakers([other.address], { gasLimit: 300_000 }));
  await warp(8 * DAY + 1);
  // Registered stakers retain their documented recovery path.
  await send(
    kick.connect(other).emergencyWithdraw(other.address, { gasLimit: 300_000 }),
  );
  assert.equal(await kick.stakerCount(), 0n);
  // A new transfer still succeeds, even with a lost/inactive organizer key.
  await send(kick.connect(payer).deposit({ value: D }));
  assert.equal(await provider.getBalance(kick.target), D);
  await rejectsWith(
    kick.connect(payer).emergencyWithdraw.staticCall(payer.address),
    kick,
    "NotAStaker",
  );
  await rejectsWith(
    kick.connect(payer).claim.staticCall(payer.address),
    kick,
    "NothingToClaim",
  );
  assert.equal(await kick.spare(), D);
});

test("v7 ownership transfer leaves immutable organizer evidence identity unchanged", async () => {
  const kick = await fresh();
  const [beforeText, beforeURI] = await kick.caseMetaEvidence(payer.address);
  assert.ok(beforeText.toLowerCase().includes(owner.address.toLowerCase()));
  await send(kick.transferOwnership(other.address));
  await send(kick.connect(other).acceptOwnership());
  assert.equal(await kick.owner(), other.address);
  const [afterText, afterURI] = await kick.caseMetaEvidence(payer.address);
  assert.equal(afterText, beforeText);
  assert.equal(afterURI, beforeURI);
  assert.ok(!afterText.toLowerCase().includes(other.address.toLowerCase()));
});

test("v7 capacity gap: 240 gas-burning attendees exceed the Ethereum transaction gas cap", async () => {
  const kick = await fresh();
  const factory = await deploy("GasBurners");
  const wallets = [
    ...(await factory.make.staticCall(240, { gasLimit: 12_000_000 })),
  ];
  await send(factory.make(240, { gasLimit: 12_000_000 }));
  await send(kick.deposit({ value: D * 240n }));
  for (let i = 0; i < wallets.length; i += 50) {
    await send(
      kick.registerStakers(wallets.slice(i, i + 50), { gasLimit: 6_000_000 }),
    );
  }
  await warp(11);
  await send(kick.postAttendance(wallets, D, { gasLimit: CAP }));
  await warp(DAY + 1);
  await assert.rejects(send(kick.releasePayouts({ gasLimit: CAP })));
  // The failed batch is atomic. There is no partial payout/claim or no-list exit.
  assert.equal(await kick.phase(), 1n);
  assert.equal(await kick.owedTotal(), 0n);
  assert.equal(await kick.reserved(), D * 240n);
  // Ganache Shanghai allows a larger transaction for measurement only; Ethereum's
  // later per-transaction limit is tested above by explicitly limiting the call.
  const receipt = await send(kick.releasePayouts({ gasLimit: 35_000_000 }));
  assert.ok(receipt.gasUsed > CAP);
  assert.equal(await kick.owedTotal(), D * 240n);
  assert.equal(await kick.reserved(), D * 240n);
  console.log(
    `security capacity probe: 240 attendees require ${receipt.gasUsed} gas; cap ${CAP}`,
  );
});
