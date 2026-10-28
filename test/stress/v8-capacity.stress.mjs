// Maximum-workload stress. In-process synthetic Ganache only; no live configs/RPCs.
// Code replacement models hostile delegated recipient behavior after own-wallet funding.
import {
  test as nodeTest,
  before,
  after,
  beforeEach,
  afterEach,
} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ganache from "ganache";
import { ethers } from "ethers";

const CAP = 16_777_216n;
const DAY = 86_400;
const START = 1_000_000;
const D = 10_000_000_000_000_001n;
const FEE = 33n;
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
const POLICY = "/ipfs/SyntheticV8CapacityPolicy";
const simple = {
  pieces: ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
  slots: "0x010204",
};
const load = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(
        name.startsWith("KlerosEvent")
          ? `../../build/contracts/${name}.json`
          : `../../references/kickback/build/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const metrics = {
  date: "2026-10-28",
  scope:
    "Synthetic in-process Ganache Shanghai, actual v8 custody, mock Court/resolver adjudication; no live writes",
  transactions: 0,
  invariantChecks: 0,
  gas: {},
  expectedFailures: [],
  scenarios: [],
  limitations: [
    "EIP-7825 simulated with explicit gasLimit 16777216; Ganache does not enforce the newer fork",
    "Recipient account-code replacement is synthetic, with snapshot rollback",
  ],
};
const startedMs = Date.now();
const outputDir = path.resolve(
  process.env.STRESS_OUTPUT_DIR || "artifacts/stress/manual-capacity",
);
function test(name, run) {
  return nodeTest(name, async () => {
    try {
      await run();
    } catch (e) {
      metrics.failure = { scenario: name, message: e.message, stack: e.stack };
      throw e;
    }
  });
}
let rpc, provider, signers, owner, liquid, proxy, snap;
const send = async (pending) => {
  const r = await (await pending).wait();
  metrics.transactions++;
  return r;
};
const now = async () =>
  Number(
    (
      await rpc.request({
        method: "eth_getBlockByNumber",
        params: ["latest", false],
      })
    ).timestamp,
  );
async function warp(seconds) {
  await rpc.request({ method: "evm_increaseTime", params: [seconds] });
  await rpc.request({ method: "evm_mine", params: [] });
}
async function deploy(name, ...args) {
  const a = load(name);
  const c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(
    ...args,
    { gasLimit: CAP },
  );
  await c.waitForDeployment();
  metrics.transactions++;
  return c;
}
async function fresh(template = simple) {
  const t = await now();
  return deploy(
    "KlerosEventV8",
    D,
    "Synthetic capacity stress",
    owner.address,
    t + START,
    t + START + 8 * DAY,
    [proxy.target, EXTRA, template.pieces, template.slots, POLICY],
  );
}
async function fund150(c, extraFirst = 0n) {
  for (let i = 1; i <= 150; i++)
    await send(
      c
        .connect(signers[i])
        .deposit({ value: D + (i === 1 ? extraFirst : 0n), gasLimit: 200_000 }),
    );
  await send(
    c.connect(signers[151]).deposit({ value: 7n * D, gasLimit: 200_000 }),
  );
  const wallets = signers.slice(1, 151).map((s) => s.address);
  for (let i = 0; i < wallets.length; i += 50)
    await send(
      c.registerStakers(wallets.slice(i, i + 50), { gasLimit: 6_000_000 }),
    );
  return wallets;
}
async function burn(list) {
  for (const a of list)
    await rpc.request({ method: "evm_setAccountCode", params: [a, "0xfe"] });
}
function measured(name, receipt, margin = true) {
  assert.ok(
    receipt.gasUsed <= CAP,
    `${name} fits the explicit transaction cap`,
  );
  if (margin)
    assert.ok(
      (receipt.gasUsed * 130n) / 100n <= CAP,
      `${name} retains 30% allowance`,
    );
  metrics.gas[name] = String(receipt.gasUsed);
}
async function reserve(c, expected, dust = 0n) {
  assert.equal(await c.reserved(), expected);
  assert.equal(await provider.getBalance(c.target), expected + dust);
  metrics.invariantChecks += 2;
}
async function exactError(pending, c, name) {
  await assert.rejects(pending, (e) => {
    const data = e.data ?? e.info?.error?.data?.result;
    assert.equal(c.interface.parseError(data)?.name, name);
    return true;
  });
  metrics.expectedFailures.push(name);
}
async function minedRejection(pending) {
  let rejected = false;
  try {
    await send(pending);
  } catch (e) {
    assert.equal(
      e.receipt?.status,
      0,
      "the invalid transaction actually mined and reverted",
    );
    metrics.transactions++;
    rejected = true;
  }
  assert.equal(rejected, true);
}
function maxTemplate() {
  const slots = "0x010204" + "01".repeat(29);
  const pieces = Array.from({ length: 33 }, (_, i) =>
    i === 0
      ? '{"padding":"","wallet":"'
      : i === 1
        ? '","contract":"'
        : i === 2
          ? '","organizer":"'
          : i === 32
            ? '"}'
            : `","wallet${i}":"`,
  );
  const size = () =>
    ethers.getBytes(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string[]", "bytes"],
        [pieces, slots],
      ),
    ).length;
  const extra = 12_288 - size();
  assert.ok(extra >= 0 && extra % 32 === 0);
  pieces[0] = '{"padding":"' + "x".repeat(extra) + '","wallet":"';
  assert.equal(size(), 12_288);
  return { pieces, slots };
}
before(async () => {
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 3337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 },
    wallet: { totalAccounts: 155, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  signers = await Promise.all(
    Array.from({ length: 155 }, (_, i) => provider.getSigner(i)),
  );
  owner = signers[0];
  liquid = await deploy("MockKlerosLiquid");
  await send(liquid.setFeeForJuror(11n, { gasLimit: 200_000 }));
  proxy = await deploy("MockArbitrableProxy", liquid.target);
});
beforeEach(async () => {
  snap = await rpc.request({ method: "evm_snapshot", params: [] });
});
afterEach(async () => {
  try {
    assert.equal(
      await rpc.request({ method: "evm_revert", params: [snap] }),
      true,
    );
  } catch (e) {
    metrics.failure = { scenario: "snapshot cleanup", message: e.message };
    throw e;
  }
});
after(async () => {
  metrics.completedScenarios = metrics.scenarios.length;
  metrics.elapsedMs = Date.now() - startedMs;
  metrics.success = metrics.completedScenarios === 4 && !metrics.failure;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "v8-capacity-stress.json"),
    JSON.stringify(metrics, null, 2) + "\n",
  );
  provider?.destroy();
  await rpc?.disconnect();
});

test("capacity: 512 readmissions do not grow history; maximum hostile cancellation stays live", async () => {
  const c = await fresh();
  const cycles = 512;
  const wallets = await fund150(c, BigInt(cycles) * D);
  for (let i = 0; i < cycles; i++) {
    await send(c.rejectAndRefund([wallets[0]], { gasLimit: 300_000 }));
    await send(c.registerStakers([wallets[0]], { gasLimit: 300_000 }));
  }
  assert.equal((await c.stakers()).length, 150);
  assert.equal(await c.stakerCount(), 150n);
  assert.equal(await c.pendingDeposits(wallets[0]), 0n);
  metrics.invariantChecks += 3;
  await exactError(
    c.registerStakers.staticCall([signers[151].address]),
    c,
    "CapacityExceeded",
  );
  await reserve(c, 157n * D);
  await burn(wallets);
  measured(
    "cancel150After512Readmissions",
    await send(c.cancel({ gasLimit: CAP })),
  );
  assert.equal(await c.owedTotal(), 150n * D);
  assert.equal(await c.pendingTotal(), 7n * D);
  await reserve(c, 157n * D);
  metrics.scenarios.push({
    name: "max cancellation after repeated readmission",
    lifetimeAdmissions: 150,
    readmissionCycles: cycles,
    owedRecipients: 150,
  });
});

test("capacity: 149 expired unmatched challenges recover permissionlessly before hostile payout", async () => {
  const c = await fresh();
  const wallets = await fund150(c);
  await warp(START + 1);
  await send(c.postAttendance([wallets[0]], 150n * D, { gasLimit: 300_000 }));
  for (let i = 2; i <= 150; i++)
    await send(
      c.connect(signers[i]).challenge({ value: FEE, gasLimit: 400_000 }),
    );
  await burn(wallets);
  await warp(DAY + 1);
  const before = await rpc.request({ method: "evm_snapshot", params: [] });
  let directSucceeded = false;
  try {
    const r = await send(c.releasePayouts({ gasLimit: CAP }));
    metrics.gas.direct149UnmatchedRelease = String(r.gasUsed);
    directSucceeded = true;
  } catch (e) {
    assert.equal(e.receipt?.status, 0);
    metrics.transactions++;
    metrics.expectedFailures.push("direct max unmatched batch exceeds cap");
    metrics.gas.direct149UnmatchedFailedGas = String(e.receipt.gasUsed);
    assert.equal(await c.phase(), 1n);
    assert.equal(await c.pendingChallenges(), 149n);
    assert.equal(await c.owedTotal(), 0n);
    metrics.invariantChecks += 3;
    await reserve(c, 157n * D + 149n * FEE);
  }
  assert.equal(
    await rpc.request({ method: "evm_revert", params: [before] }),
    true,
  );
  let maxResolve = 0n;
  for (let i = 1; i < wallets.length; i++) {
    const r = await send(
      c
        .connect(signers[154])
        .resolveChallenge(wallets[i], { gasLimit: 400_000 }),
    );
    if (r.gasUsed > maxResolve) maxResolve = r.gasUsed;
  }
  metrics.gas.individualExpiredUnmatchedMax = String(maxResolve);
  assert.equal(await c.pendingChallenges(), 0n);
  assert.equal(await c.attendeeCount(), 150n);
  assert.equal(await c.owedTotal(), 149n * FEE);
  metrics.invariantChecks += 3;
  measured(
    "release150After149IndividualResolutions",
    await send(c.connect(signers[154]).releasePayouts({ gasLimit: CAP })),
  );
  assert.equal(await c.owedTotal(), 150n * D + 149n * FEE);
  assert.equal(await c.challengeEscrow(), 0n);
  await reserve(c, 157n * D + 149n * FEE);
  metrics.scenarios.push({
    name: "max unmatched challenges and hostile recipients",
    waitingCases: 149,
    directSucceeded,
    individualPermissionlessResolutions: 149,
    owedRecipients: 150,
    knownOperationalPreprocessing: true,
  });
});

test("capacity: 149 matched cases preserve reserves while most win and final losses redistribute to hostile recipients", async () => {
  const c = await fresh();
  const wallets = await fund150(c);
  await warp(START + 1);
  await send(c.postAttendance([wallets[0]], 150n * D, { gasLimit: 300_000 }));
  const cases = [];
  for (let i = 2; i <= 150; i++) {
    await send(
      c.connect(signers[i]).challenge({ value: FEE, gasLimit: 400_000 }),
    );
    await send(
      c.matchChallenge(signers[i].address, { value: FEE, gasLimit: 2_000_000 }),
    );
    cases.push((await c.challenges(signers[i].address)).arbitratorDisputeID);
  }
  await burn(wallets);
  await warp(DAY + 1);
  measured(
    "release150With149OpenCases",
    await send(c.releasePayouts({ gasLimit: CAP })),
  );
  let held = Array(149).fill(D),
    owed = D,
    attendees = 1n,
    escrow = 149n * FEE,
    dust = 0n,
    maxSettlement = 0n;
  await reserve(c, 150n * D + escrow + 7n * D);
  for (let i = 0; i < 149; i++) {
    const ruling = i < 147 ? 1 : i === 147 ? 2 : 0;
    await send(liquid.giveFinalRuling(cases[i], ruling, { gasLimit: 500_000 }));
    const r = await send(c.resolveChallenge(wallets[i + 1], { gasLimit: CAP }));
    if (r.gasUsed > maxSettlement) maxSettlement = r.gasUsed;
    const amount = held[i];
    held[i] = 0n;
    escrow -= FEE;
    if (ruling === 1) {
      owed += amount + FEE;
      attendees++;
    } else {
      const open = BigInt(148 - i);
      const each = amount / (attendees + open);
      dust += amount % (attendees + open);
      owed += attendees * each;
      for (let j = i + 1; j < held.length; j++) held[j] += each;
      if (ruling === 0) owed += FEE / 2n;
    }
    assert.equal(
      await c.heldBack(),
      held.reduce((a, b) => a + b, 0n),
    );
    assert.equal(await c.owedTotal(), owed);
    assert.equal(await c.pendingChallenges(), BigInt(148 - i));
    assert.equal(await c.challengeEscrow(), escrow);
    assert.equal(await c.attendeeCount(), attendees);
    metrics.invariantChecks += 5;
    await reserve(
      c,
      held.reduce((a, b) => a + b, 0n) + owed + escrow + 7n * D,
      dust,
    );
  }
  measured("maximumOf149CaseSettlements", { gasUsed: maxSettlement });
  assert.equal(await c.heldBack(), 0n);
  assert.equal(await c.pendingChallenges(), 0n);
  await send(
    c
      .connect(signers[151])
      .withdrawPending(owner.address, 7n * D, { gasLimit: 200_000 }),
  );
  await reserve(c, owed, dust);
  metrics.scenarios.push({
    name: "149 simultaneously open matched cases",
    cases: 149,
    rulings: { attended: 147, absent: 1, refused: 1 },
    finalAttendees: Number(attendees),
    pendingRecovered: String(7n * D),
    dust: String(dust),
  });
});

test("capacity: 32 isolated factory events including maximum constructor payload; invalid creations leave no entries", async () => {
  const factory = await deploy("KlerosEventFactoryV8");
  const eventAbi = load("KlerosEventV8").abi;
  const t = await now();
  const maximum = maxTemplate();
  const children = [];
  let largest = 0n,
    maxPayloadGas = 0n;
  for (let i = 0; i < 32; i++) {
    const creator = signers[i % 4],
      key = ethers.id(`capacity-event-${i}`),
      tpl = i === 0 ? maximum : simple;
    const params = {
      depositAmount: D + BigInt(i),
      eventName: i === 0 ? "N".repeat(256) : `Synthetic capacity event ${i}`,
      eventStart: t + START,
      claimDeadline: t + START + 8 * DAY,
      arbitration: {
        disputeResolver: proxy.target,
        extraData: i === 0 ? EXTRA + "00".repeat(64) : EXTRA,
        metaEvidenceTemplate: tpl.pieces,
        metaEvidenceSlots: tpl.slots,
        policyURI: i === 0 ? "/ipfs/" + "p".repeat(506) : POLICY,
      },
    };
    const r = await send(
      factory.connect(creator).createEvent(key, params, { gasLimit: CAP }),
    );
    if (r.gasUsed > largest) largest = r.gasUsed;
    if (i === 0) maxPayloadGas = r.gasUsed;
    const address = await factory.eventFor(creator.address, key);
    const c = new ethers.Contract(address, eventAbi, creator);
    children.push({ c, creator, key, params });
    assert.equal(await c.owner(), creator.address);
    assert.equal(await c.depositAmount(), D + BigInt(i));
    assert.equal(await factory.isEvent(address), true);
    metrics.invariantChecks += 3;
    await send(
      c
        .connect(signers[152])
        .deposit({ value: D + BigInt(i), gasLimit: 200_000 }),
    );
    if (i % 2 === 0) {
      await send(
        c.registerStakers([signers[152].address], { gasLimit: 300_000 }),
      );
      if (i % 4 === 0) await send(c.cancel({ gasLimit: 300_000 }));
    }
    if (i % 4 === 0) {
      await exactError(
        factory.connect(creator).createEvent.staticCall(key, params),
        factory,
        "EventAlreadyExists",
      );
      await minedRejection(
        factory.connect(creator).createEvent(key, params, { gasLimit: CAP }),
      );
    }
    if (i % 8 === 0) {
      const invalidKey = ethers.id(`invalid-event-${i}`);
      await exactError(
        factory
          .connect(creator)
          .createEvent.staticCall(invalidKey, { ...params, depositAmount: 0n }),
        factory,
        "EventDeploymentFailed",
      );
      await minedRejection(
        factory
          .connect(creator)
          .createEvent(
            invalidKey,
            { ...params, depositAmount: 0n },
            { gasLimit: CAP },
          ),
      );
      assert.equal(
        await factory.eventFor(creator.address, invalidKey),
        ethers.ZeroAddress,
      );
    }
  }
  assert.equal(await factory.eventCount(), 32n);
  assert.equal(new Set(children.map((x) => x.c.target)).size, 32);
  assert.equal(await provider.getBalance(factory.target), 0n);
  metrics.invariantChecks += 3;
  for (let i = 0; i < children.length; i++) {
    const { c, creator } = children[i];
    assert.equal(await c.owner(), creator.address);
    assert.equal(await c.pendingTotal(), i % 2 ? D + BigInt(i) : 0n);
    await reserve(c, i % 4 === 0 ? 0n : D + BigInt(i));
    await exactError(
      c.connect(signers[153]).refund.staticCall(owner.address, 0n),
      c,
      "NotOwner",
    );
  }
  const badKey = ethers.id("oversized-factory-payload");
  await exactError(
    factory.createEvent.staticCall(
      badKey,
      { ...children[0].params, eventName: "X".repeat(55_000) },
      { gasLimit: CAP },
    ),
    factory,
    "CodeTooLarge",
  );
  assert.equal(
    await factory.eventFor(owner.address, badKey),
    ethers.ZeroAddress,
  );
  assert.equal(await factory.eventCount(), 32n);
  measured("maximumFactoryConstructorPayload", { gasUsed: maxPayloadGas });
  measured("largestOf32FactoryCreations", { gasUsed: largest });
  metrics.scenarios.push({
    name: "factory deployment workload",
    events: 32,
    creators: 4,
    invalidRollbacks: 5,
    duplicateRejections: 8,
    maximumTemplateEncodedBytes: 12_288,
    maximumSlots: 32,
    maximumNameBytes: 256,
    maximumPolicyBytes: 512,
    maximumExtraDataBytes: 128,
  });
});
