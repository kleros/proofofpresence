import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  localChain,
  deployEvent,
  contractFor,
  verifyDeployment,
  chainState,
  DAY,
} from "../src/chain.mjs";
import { eventV8Template, factoryEventId } from "../src/contracts-v8.mjs";

const D = ethers.parseEther("0.01");
const VERSION = "kleros-event-v8";
let chain, a, b, historical, guest, omitted, pending, guestWallet;
const send = async (tx) => (await tx).wait();

async function create(id, signer, version, deposit = D) {
  const now = (await chain.provider.getBlock("latest")).timestamp;
  const definition = {
    id,
    title: `Synthetic ${id}`,
    startsAt: new Date((now + 3600) * 1000).toISOString(),
    timezone: "Asia/Bangkok",
    location: "Synthetic local venue",
  };
  return {
    ...(await deployEvent(
      chain,
      definition,
      signer,
      deposit,
      now + 3600,
      now + 15 * DAY,
      version ? { contractVersion: version } : undefined,
    )),
    definition,
    participants: new Map(),
    publications: new Map(),
  };
}
const contract = (r, signer = chain.provider) =>
  contractFor(chain, r.deployment, signer);
const code = (expected) => (error) => error.code === expected;

before(async () => {
  chain = await localChain(0, { chainId: 31337 });
  [guest, omitted, pending] = chain.signers.slice(3, 6);
  guestWallet = await guest.getAddress();
  historical = await create("historical", chain.signers[0]);
  a = await create("new-a", chain.signers[0], VERSION);
  b = await create("new-b", chain.signers[1], VERSION, 2n * D);
  for (const [id, signer] of [
    ["guest", guest],
    ["omitted", omitted],
    ["pending", pending],
  ])
    a.participants.set(id, { wallet: await signer.getAddress() });
});
after(async () => chain?.close());

test("explicit versions retain v7 and create independent v8 children through one trusted factory", async () => {
  assert.equal(historical.deployment.contractVersion, "truth-pays-v7");
  assert.equal(historical.deployment.chainId, 31337);
  assert.equal(a.deployment.chainId, 31337);
  assert.equal(a.deployment.contractVersion, VERSION);
  assert.equal(a.deployment.abiVersion, VERSION);
  assert.equal(a.deployment.factory, b.deployment.factory);
  assert.notEqual(a.deployment.contract, b.deployment.contract);
  assert.notEqual(a.deployment.factoryEventId, b.deployment.factoryEventId);
  assert.equal(
    a.deployment.factoryEventId,
    factoryEventId({
      chainId: 31337,
      factory: a.deployment.factory,
      creator: a.deployment.creator,
      eventKey: a.deployment.eventKey,
    }),
  );
  assert.equal(await contract(a).VERSION(), 8n);
  assert.equal(await contract(a).owner(), await chain.signers[0].getAddress());
  assert.equal(await contract(b).owner(), await chain.signers[1].getAddress());
  await verifyDeployment(chain, historical.deployment);
  await verifyDeployment(chain, a.deployment);
  await verifyDeployment({ provider: chain.provider }, a.deployment);
  await verifyDeployment(chain, b.deployment);
  assert.throws(
    () =>
      contractFor(chain, {
        ...a.deployment,
        abiVersion: "truth-pays-v7",
      }),
    code("UNKNOWN_VERSION"),
  );
  assert.throws(
    () =>
      contractFor(chain, {
        ...historical.deployment,
        contractVersion: "__proto__",
        abiVersion: "__proto__",
      }),
    code("UNKNOWN_VERSION"),
  );
  assert.throws(
    () =>
      contractFor(chain, {
        ...historical.deployment,
        contractVersion: "future-unknown",
        abiVersion: "future-unknown",
      }),
    code("UNKNOWN_VERSION"),
  );
});

test("v8 snapshots separate withdrawable payer credits from committed pool and preserve lifetime capacity", async () => {
  const initial = await chainState(chain, a);
  assert.equal(initial.pendingTotalWei, "0");
  assert.equal(initial.pendingCredits[guestWallet.toLowerCase()], "0");
  assert.equal(initial.maxStakers, 150);
  assert.equal(initial.remainingAdmissionSlots, 150);
  await send(contract(a, guest).deposit({ value: 2n * D }));
  const deposited = await chainState(chain, a);
  assert.equal(deposited.pendingTotalWei, String(2n * D));
  assert.equal(
    deposited.pendingCredits[guestWallet.toLowerCase()],
    String(2n * D),
  );
  assert.equal(deposited.poolWei, "0");
  assert.equal(deposited.reservedWei, String(2n * D));
  assert.equal(deposited.spareWei, "0");
  assert.notEqual(initial.fingerprint, deposited.fingerprint);
  await send(contract(a, chain.signers[0]).registerStakers([guestWallet]));
  const registered = await chainState(chain, a);
  assert.equal(registered.pendingTotalWei, String(D));
  assert.equal(registered.pendingCredits[guestWallet.toLowerCase()], String(D));
  assert.equal(registered.poolWei, String(D));
  assert.equal(registered.remainingAdmissionSlots, 149);
  await send(contract(a, guest).withdrawPending(guestWallet, D));
  const withdrawn = await chainState(chain, a);
  assert.equal(withdrawn.pendingTotalWei, "0");
  assert.equal(withdrawn.pendingCredits[guestWallet.toLowerCase()], "0");
  assert.equal(withdrawn.poolWei, String(D));
  await send(contract(a, chain.signers[0]).rejectAndRefund([guestWallet]));
  assert.equal((await chainState(chain, a)).remainingAdmissionSlots, 149);
  await send(contract(a, guest).deposit({ value: D }));
  await send(contract(a, chain.signers[0]).registerStakers([guestWallet]));
  const readmitted = await chainState(chain, a);
  assert.equal(readmitted.remainingAdmissionSlots, 149);
  assert.equal(readmitted.lifetimeAdmittedCount, 1);
  assert.equal(readmitted.stakerHistory.length, 1);
  const independent = await chainState(chain, b);
  assert.equal(independent.pendingTotalWei, "0");
  assert.equal(independent.poolWei, "0");
  assert.equal(independent.balanceWei, "0");
  assert.equal(
    (await chainState(chain, historical)).pendingTotalWei,
    undefined,
  );
});

test("v8 verification rejects changed terms, identity, factory, receipt and compiler-fixed creation code", async () => {
  for (const changed of [
    { depositWei: String(3n * D) },
    { eventName: "Different event" },
    { arbitratorExtraData: "0x" },
    { factoryCodeHash: ethers.ZeroHash },
    { factoryEventId: ethers.ZeroHash },
    { eventKey: ethers.id("different-key") },
    { configurationHash: ethers.ZeroHash },
    { creationCodeHash: ethers.ZeroHash },
    { deploymentBlock: a.deployment.deploymentBlock + 1 },
    { deploymentTxHash: ethers.ZeroHash },
    { creator: await guest.getAddress() },
    { factory: undefined },
  ])
    await assert.rejects(
      verifyDeployment(chain, { ...a.deployment, ...changed }),
      code("DEPLOYMENT_MISMATCH"),
    );
  await assert.rejects(
    verifyDeployment(chain, { ...a.deployment, chainId: 1337 }),
    code("WRONG_CHAIN"),
  );
  await assert.rejects(
    verifyDeployment(chain, { ...a.deployment, codeHash: ethers.ZeroHash }),
    code("WRONG_CONTRACT"),
  );
});

test("v8 projection retains held-share payouts and pending credits while a matched case is open", async () => {
  const omittedWallet = await omitted.getAddress();
  const pendingWallet = await pending.getAddress();
  await send(contract(a, omitted).deposit({ value: D }));
  await send(contract(a, pending).deposit({ value: D }));
  await send(contract(a, chain.signers[0]).registerStakers([omittedWallet]));
  await chain.provider.send("evm_increaseTime", [3601]);
  await chain.provider.send("evm_mine", []);
  await send(
    contract(a, chain.signers[0]).postAttendance([guestWallet], 2n * D),
  );
  const cost = await contract(a).challengeDeposit();
  await send(contract(a, omitted).challenge({ value: cost }));
  await send(
    contract(a, chain.signers[0]).matchChallenge(omittedWallet, {
      value: cost,
      gasLimit: 3_000_000,
    }),
  );
  const disputed = await chainState(chain, a);
  const readOnlyExternalShape = await chainState(
    { provider: chain.provider },
    a,
  );
  assert.deepEqual(readOnlyExternalShape.cases, disputed.cases);
  assert.equal(disputed.cases[0].state, "Disputed");
  assert.equal(disputed.cases[0].matched, true);
  assert.notEqual(disputed.cases[0].localDisputeID, null);
  assert.notEqual(disputed.cases[0].arbitratorDisputeID, null);
  assert.equal(
    disputed.cases[0].caseOrganizer,
    await chain.signers[0].getAddress(),
  );
  assert.equal(disputed.pendingCredits[pendingWallet.toLowerCase()], String(D));
  await chain.provider.send("evm_increaseTime", [DAY + 1]);
  await chain.provider.send("evm_mine", []);
  await send(
    contract(a, chain.signers[0]).releasePayouts({ gasLimit: 3_000_000 }),
  );
  const held = await chainState(chain, a);
  assert.equal(held.phase, "Finalized");
  assert.equal(held.heldBackWei, String(D));
  assert.equal(held.pendingTotalWei, String(D));
  assert.equal(held.pendingChallenges, 1);
  const challenge = await contract(a).challenges(omittedWallet);
  await send(chain.liquid.giveFinalRuling(challenge.arbitratorDisputeID, 2));
  await send(
    contract(a, chain.signers[0]).resolveChallenge(omittedWallet, {
      gasLimit: 3_000_000,
    }),
  );
  const settled = await chainState(chain, a);
  assert.equal(settled.cases[0].finalRuling, 2);
  assert.equal(settled.cases[0].state, "Resolved");
  assert.equal(settled.heldBackWei, "0");
  assert.equal(settled.pendingChallenges, 0);
  assert.equal(settled.pendingTotalWei, String(D));
  assert.equal(settled.reservedWei, String(D));
  assert.equal((await chainState(chain, b)).phase, "Open");
  assert.equal((await chainState(chain, b)).balanceWei, "0");
});

test("v8 testnet descriptions use the explicitly configured native currency", () => {
  const template = eventV8Template({
    eventName: "Synthetic Chiado event",
    depositAmount: D,
    policyURI: "/synthetic-chiado-policy",
    nativeCurrencySymbol: "XDAI",
  });
  assert.ok(template.pieces.join("").includes("0.01 XDAI"));
  assert.ok(!template.pieces.join("").includes("0.01 ETH"));
  assert.throws(
    () =>
      eventV8Template({
        eventName: "Invalid currency metadata",
        depositAmount: D,
        policyURI: "/synthetic-policy",
        nativeCurrencySymbol: 'untrusted" text',
      }),
    /metadata/,
  );
});
