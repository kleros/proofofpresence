import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import { ipfsPathOf } from "../references/kickback/scripts/lib.mjs";
import {
  loadV8Artifacts,
  eventV8Template,
  factoryEventId,
  EVENT_V8_VERSION,
} from "../src/contracts-v8.mjs";

const DAY = 86_400;
const D = ethers.parseEther("0.01");
const CAP = 16_777_216n;
const FEE = ethers.parseEther("0.015");
const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
const artifacts = loadV8Artifacts();
const oldArtifact = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(`../references/kickback/build/${name}.json`, import.meta.url),
    ),
  );
const send = async (pending) => (await pending).wait();
let rpc, provider, a, b, guest, omitted, outsider, liquid, proxy;
async function deploy(artifact, signer, ...args) {
  const c = await new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer,
  ).deploy(...args, { gasLimit: CAP });
  await c.waitForDeployment();
  return c;
}
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
async function config({
  name = "Synthetic factory event",
  deposit = D,
  startIn = 3600,
  policy = "/ipfs/SyntheticV8Policy",
} = {}) {
  const t = await now();
  const tpl = eventV8Template({
    eventName: name,
    depositAmount: deposit,
    policyURI: policy,
  });
  return {
    depositAmount: deposit,
    eventName: name,
    eventStart: t + startIn,
    claimDeadline: t + 14 * DAY,
    arbitration: {
      disputeResolver: proxy.target,
      extraData: EXTRA,
      metaEvidenceTemplate: tpl.pieces,
      metaEvidenceSlots: tpl.slots,
      policyURI: policy,
    },
  };
}
async function create(factory, creator, key, params) {
  const receipt = await send(
    factory.connect(creator).createEvent(key, params, { gasLimit: CAP }),
  );
  const event = receipt.logs
    .filter((l) => l.address === factory.target)
    .map((l) => factory.interface.parseLog(l))
    .find((l) => l?.name === "EventCreated");
  assert.ok(event);
  const child = new ethers.Contract(
    event.args.eventContract,
    artifacts.event.abi,
    creator,
  );
  assert.ok(receipt.gasUsed < CAP);
  return { child, event, receipt };
}
async function rejectsWith(pending, contract, expected) {
  await assert.rejects(pending, (e) => {
    const data = e.data ?? e.info?.error?.data?.result;
    assert.equal(contract.interface.parseError(data)?.name, expected);
    return true;
  });
}
before(async () => {
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 31337, hardfork: "shanghai" },
    miner: { blockGasLimit: 60_000_000 },
    wallet: { totalAccounts: 8, defaultBalance: 1000 },
  });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  [a, b, guest, omitted, outsider] = await Promise.all(
    [0, 1, 2, 3, 4].map((i) => provider.getSigner(i)),
  );
  liquid = await deploy(oldArtifact("MockKlerosLiquid"), a);
  await send(liquid.setFeeForJuror(ethers.parseEther("0.005")));
  proxy = await deploy(oldArtifact("MockArbitrableProxy"), a, liquid.target);
});
after(async () => {
  provider?.destroy();
  await rpc?.disconnect();
});

test("v8 factory stores exact immutable child code and respects runtime/initcode limits", async () => {
  const factory = await deploy(artifacts.factory, a);
  assert.equal(EVENT_V8_VERSION, "kleros-event-v8");
  assert.equal(await factory.VERSION(), 8n);
  assert.equal(await factory.eventCreationCode(), artifacts.event.bytecode);
  assert.equal(
    await factory.creationCodeHash(),
    ethers.keccak256(artifacts.event.bytecode),
  );
  assert.equal(
    await factory.creationCodeLength(),
    BigInt((artifacts.event.bytecode.length - 2) / 2),
  );
  for (const artifact of [artifacts.event, artifacts.factory]) {
    assert.ok((artifact.bytecode.length - 2) / 2 <= 49_152);
    assert.ok((artifact.deployedBytecode.length - 2) / 2 <= 24_576);
  }
  for (const slot of [
    await factory.creationCodeStore0(),
    await factory.creationCodeStore1(),
  ]) {
    if (slot === ethers.ZeroAddress) continue;
    const code = await provider.getCode(slot);
    assert.ok(code.startsWith("0x00"));
    assert.ok((code.length - 2) / 2 <= 24_576);
  }
  assert.ok((await provider.getCode(factory.target)).length / 2 < 24_577);
  const params = await config();
  const { child, event } = await create(
    factory,
    a,
    ethers.id("stable-event-A"),
    params,
  );
  assert.equal(await child.owner(), a.address);
  assert.equal(await child.VERSION(), 8n);
  assert.equal(await factory.isEvent(child.target), true);
  assert.equal(await factory.eventCount(), 1n);
  assert.equal(
    await factory.eventFor(a.address, ethers.id("stable-event-A")),
    child.target,
  );
  const parameterType = factory.interface.getFunction("createEvent").inputs[1];
  assert.equal(
    event.args.configurationHash,
    ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", parameterType],
        [a.address, params],
      ),
    ),
  );
});

test("v8 event identities isolate creator, factory and chain domains; copied keys cannot front-run", async () => {
  const f1 = await deploy(artifacts.factory, a);
  const f2 = await deploy(artifacts.factory, a);
  const key = ethers.id("same-stable-event-key");
  const params = await config();
  // An outsider copies the key first; the real creator still gets their own event.
  const copied = await create(f1, outsider, key, params);
  const intended = await create(f1, a, key, params);
  assert.notEqual(copied.child.target, intended.child.target);
  assert.notEqual(copied.event.args.eventId, intended.event.args.eventId);
  const scope = {
    chainId: 31337,
    factory: f1.target,
    creator: a.address,
    eventKey: key,
  };
  assert.equal(intended.event.args.eventId, factoryEventId(scope));
  assert.notEqual(
    await f1.eventId(a.address, key),
    await f2.eventId(a.address, key),
  );
  assert.notEqual(
    factoryEventId(scope),
    factoryEventId({ ...scope, chainId: 1 }),
  );
  await rejectsWith(
    f1.createEvent.staticCall(key, params),
    f1,
    "EventAlreadyExists",
  );
  assert.equal(await f1.eventCount(), 2n);
  assert.equal(await intended.child.owner(), a.address);
  assert.equal(await copied.child.owner(), outsider.address);
});

test("v8 factory rejects invalid creation atomically and retains no privileged custody path", async () => {
  const factory = await deploy(artifacts.factory, a);
  const key = ethers.id("retry-after-invalid");
  const params = await config();
  await rejectsWith(
    factory.createEvent.staticCall(ethers.ZeroHash, params),
    factory,
    "InvalidEventKey",
  );
  await assert.rejects(
    send(
      factory.createEvent(
        key,
        { ...params, depositAmount: 0 },
        { gasLimit: CAP },
      ),
    ),
  );
  assert.equal(await factory.eventCount(), 0n);
  assert.equal(await factory.eventFor(a.address, key), ethers.ZeroAddress);
  const { child } = await create(factory, a, key, params);
  await assert.rejects(
    send(
      a.sendTransaction({ to: factory.target, value: D, gasLimit: 100_000 }),
    ),
  );
  assert.equal(await provider.getBalance(factory.target), 0n);
  assert.equal(await child.owner(), a.address);
  const functions = artifacts.factory.abi
    .filter((item) => item.type === "function")
    .map((item) => item.name);
  assert.ok(
    !functions.some((name) =>
      /withdraw|upgrade|initialize|sweep|refund|transferOwnership|owner$/.test(
        name,
      ),
    ),
  );
  await rejectsWith(
    child.connect(b).registerStakers.staticCall([guest.address]),
    child,
    "NotOwner",
  );
});

test("v8 factory-created events isolate shared participants, disputes, held shares and settlement", async () => {
  const factory = await deploy(artifacts.factory, a);
  const ca = await config({
    name: "Event A",
    policy: "/ipfs/SyntheticPolicyA",
  });
  const cb = await config({
    name: "Event B",
    deposit: 2n * D,
    policy: "/ipfs/SyntheticPolicyB",
  });
  const { child: ea } = await create(factory, a, ethers.id("event-A"), ca);
  const { child: eb } = await create(factory, b, ethers.id("event-B"), cb);
  await send(ea.connect(guest).deposit({ value: D }));
  await send(ea.connect(omitted).deposit({ value: D }));
  await send(eb.connect(guest).deposit({ value: 2n * D }));
  await send(ea.registerStakers([guest.address, omitted.address]));
  await send(eb.registerStakers([guest.address]));
  await rejectsWith(
    eb.connect(a).postAttendance.staticCall([guest.address], 2n * D),
    eb,
    "NotOwner",
  );
  await warp(3601);
  await send(ea.postAttendance([guest.address], 2n * D));
  await send(eb.postAttendance([guest.address], 2n * D));
  await send(ea.connect(omitted).challenge({ value: FEE }));
  await send(
    ea.matchChallenge(omitted.address, { value: FEE, gasLimit: 3_000_000 }),
  );
  assert.equal((await eb.challenges(omitted.address)).state, 0n);
  assert.equal(await eb.pendingChallenges(), 0n);
  await warp(DAY + 1);
  await send(ea.releasePayouts());
  assert.equal(await ea.heldBack(), D);
  assert.equal(await eb.phase(), 1n);
  assert.equal(await eb.reserved(), 2n * D);
  await send(eb.releasePayouts());
  assert.equal(await eb.reserved(), 0n);
  assert.equal(await provider.getBalance(eb.target), 0n);
  const challenge = await ea.challenges(omitted.address);
  await send(
    liquid.giveFinalRuling(challenge.arbitratorDisputeID, 2, {
      gasLimit: 500_000,
    }),
  );
  await send(ea.resolveChallenge(omitted.address));
  assert.equal(await ea.heldBack(), 0n);
  assert.equal(await ea.pendingChallenges(), 0n);
  assert.equal(await eb.phase(), 2n);
  assert.equal(await provider.getBalance(eb.target), 0n);
  assert.notEqual(await ea.policyURI(), await eb.policyURI());
});

test("v8 template helper escapes event data and exposes per-case organizer aliases", async () => {
  const factory = await deploy(artifacts.factory, a);
  const params = await config({ name: 'Event "quotes" and \\slashes' });
  const { child } = await create(
    factory,
    a,
    ethers.id("metadata-test"),
    params,
  );
  const [text, uri] = await child.caseMetaEvidence(guest.address);
  assert.equal(uri, ipfsPathOf(text));
  const document = JSON.parse(text);
  assert.equal(document.fileURI, params.arbitration.policyURI);
  assert.equal(document.aliases[guest.address.toLowerCase()], "Challenger");
  assert.equal(
    document.aliases[a.address.toLowerCase()],
    "Organizer for this case",
  );
  assert.ok(document.title.includes(params.eventName));
  assert.ok(document.description.includes(child.target));
  assert.throws(
    () =>
      eventV8Template({
        eventName: "{{organizer}}",
        depositAmount: D,
        policyURI: "/ipfs/test",
      }),
    /markers/,
  );
});
