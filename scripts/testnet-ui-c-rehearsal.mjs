import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ethers } from "ethers";
import {
  ROOT,
  check,
  parseArgs,
  readJson,
  publicJson,
  sha256,
  fingerprint,
  atomicJson,
  acquireLock,
  loadJournal,
  sendOnce,
  assertTestnet,
  verifyCompiledInputs,
  safeFailure,
} from "../src/testnet-config.mjs";
import {
  UI_C,
  validateUiCPlan,
  verifyUiCStack,
  uiCCreateRequest,
} from "./testnet-ui-scenario.mjs";
import { proveCollateralDelivery } from "./testnet-rehearsal.mjs";
import {
  stateOf,
  protectedFacts,
  assertPlanDeployment,
  operationFor,
  singleAttemptConnection,
} from "../test/testnet-ui-c.e2e.mjs";

export const C_RULING_ACTION = "ui-c-controlled-ruling";
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const hashPattern = /^0x[0-9a-f]{64}$/i;
const UI_OPERATIONS = [
  ["deposits", "alice"],
  ["deposits", "bob"],
  ["admit", "owner"],
  ["attendance", "owner"],
  ["challenge", "bob"],
  ["match", "owner"],
  ["payout", "owner"],
  ["settle", "owner"],
];

export function assertCBeforeRuling(state, scope) {
  const D = BigInt(scope.depositWei),
    c = state.bobCase;
  check(
    scope.chainId === 10200 &&
      D === 1_000_000_000_000n &&
      same(state.owner, scope.owner) &&
      state.phase === "Finalized" &&
      state.stakerCount === 2 &&
      state.attendeeCount === 1 &&
      state.attended.alice === true &&
      state.attended.bob === false &&
      state.status.alice === 2 &&
      state.status.bob === 1 &&
      state.pendingTotal === "0" &&
      state.pendingChallenges === "1" &&
      state.owedTotal === "0" &&
      state.owed.alice === "0" &&
      state.owed.bob === "0" &&
      state.heldBack === String(D) &&
      state.payoutShare === String(D) &&
      c.state === 2 &&
      c.finalRuling === null &&
      c.heldShare === String(D) &&
      /^\d+$/.test(c.localDisputeID) &&
      /^\d+$/.test(c.arbitratorDisputeID),
    "C ruling1 requires the actual ordinary batch with Alice paid and the same Bob depositor's full unruled share held.",
  );
}

export function assertCAfterRuling(state, scope) {
  assertCBeforeRuling(
    { ...state, bobCase: { ...state.bobCase, finalRuling: null } },
    scope,
  );
  check(
    state.bobCase.finalRuling === 1,
    "The controlled resolver must record attended ruling1 while Bob's full share remains held before UI settlement.",
  );
}

export function assertCSettled(state, scope, paid) {
  const D = BigInt(scope.depositWei),
    c = state.bobCase;
  check(
    scope.chainId === 10200 &&
      D === 1_000_000_000_000n &&
      same(state.owner, scope.owner) &&
      state.phase === "Finalized" &&
      state.stakerCount === 2 &&
      state.attendeeCount === 2 &&
      state.status.alice === 2 &&
      state.status.bob === 2 &&
      state.attended.alice &&
      state.attended.bob &&
      c.state === 3 &&
      c.finalRuling === 1 &&
      c.heldShare === "0" &&
      state.pendingChallenges === "0" &&
      state.pendingTotal === "0" &&
      state.heldBack === "0" &&
      state.challengeEscrow === "0" &&
      state.owedTotal === "0" &&
      state.owed.alice === "0" &&
      state.owed.bob === "0" &&
      state.reserved === "0" &&
      state.balance === "0" &&
      (paid.get(scope.alice.toLowerCase()) ?? 0n) === D &&
      (paid.get(scope.bob.toLowerCase()) ?? 0n) === D &&
      [...paid.entries()].every(
        ([wallet, value]) =>
          value === 0n ||
          [scope.alice.toLowerCase(), scope.bob.toLowerCase()].includes(wallet),
      ),
    "C final proof requires Alice D and the same Bob depositor D delivered, with all case/credit reserves separately cleared.",
  );
}

export function assertCUIProofContext(proof, plan, manifest) {
  const source = proof.source,
    deployment = manifest.events[0].deployment;
  const protectedAB = proof.protectedAB;
  check(
    source?.origin === plan.publicOrigin &&
      typeof source.instanceId === "string" &&
      source.instanceId.length > 0 &&
      /^[0-9a-f]{64}$/.test(source.harnessSha256 ?? "") &&
      source.operatorFiles?.["test/testnet-ui-c.e2e.mjs"] ===
        source.harnessSha256 &&
      source.protectedManifestSha256 === plan.sourceManifestSha256 &&
      source.planFingerprint === fingerprint(plan) &&
      source.manifestSha256 === sha256(publicJson(manifest)) &&
      same(source.contract?.address, deployment.contract) &&
      source.contract.codeHash === deployment.codeHash &&
      same(source.contract.factory, deployment.factory) &&
      source.contract.factoryCodeHash === deployment.factoryCodeHash &&
      source.contract.deploymentTxHash === deployment.deploymentTxHash &&
      source.contract.deploymentBlock === deployment.deploymentBlock &&
      source.contract.configurationHash === deployment.configurationHash &&
      protectedAB?.unchanged === true &&
      Array.isArray(protectedAB.before) &&
      protectedAB.before.length === 2 &&
      Array.isArray(protectedAB.after) &&
      protectedAB.after.length === 2 &&
      [...protectedAB.before, ...protectedAB.after].every(
        (entry) =>
          entry?.financial && ethers.isAddress(entry.financial.contract),
      ) &&
      publicJson(protectedAB.before.map((entry) => entry.financial)) ===
        publicJson(protectedAB.after.map((entry) => entry.financial)),
    "C UI proof lacks exact origin, harness, child-creation context or unchanged protected A/B evidence.",
  );
}

export async function canonicalCTransaction(provider, entry, expected) {
  check(
    entry?.state === "confirmed" &&
      hashPattern.test(entry.hash) &&
      Object.keys(entry.expected ?? {})
        .sort()
        .join() === "data,from,to,value" &&
      ["from", "to", "data", "value"].every(
        (key) => entry.expected[key] === expected[key],
      ),
    "C journal operation differs from its exact reviewed call.",
  );
  const [receipt, tx] = await Promise.all([
    provider.getTransactionReceipt(entry.hash),
    provider.getTransaction(entry.hash),
  ]);
  const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
  check(
    receipt?.status === 1 &&
      (await receipt.confirmations()) >= 2 &&
      tx &&
      tx.chainId === 10200n &&
      tx.nonce === entry.nonce &&
      same(tx.from, expected.from) &&
      same(tx.to, expected.to) &&
      tx.data === expected.data &&
      String(tx.value) === expected.value &&
      receipt.blockNumber === entry.blockNumber &&
      receipt.blockHash === entry.blockHash &&
      block?.hash === receipt.blockHash,
    "C operation lacks its exact successful canonical two-confirmation transaction.",
  );
  return { receipt, tx, block };
}

export async function verifyCUIHistory({
  provider,
  journal,
  plan,
  manifest,
  scope,
  state,
  eventInterface,
  settled = false,
  root = ROOT,
}) {
  const records = [],
    paid = new Map();
  const operations = settled ? UI_OPERATIONS : UI_OPERATIONS.slice(0, -1);
  for (const [stage, role] of operations) {
    const op = operationFor(stage, role, scope, state),
      entry = journal.transactions[op.journalAction];
    const expected = {
      from: scope[role].toLowerCase(),
      to: scope.contract.toLowerCase(),
      data: eventInterface.encodeFunctionData(op.method, op.args),
      value: String(op.value),
    };
    const canonical = await canonicalCTransaction(provider, entry, expected);
    check(
      entry.uiProof?.path && /^[0-9a-f]{64}$/.test(entry.uiProof.sha256),
      "C financial history must have actual UI proof provenance.",
    );
    const filename = path.resolve(root, entry.uiProof.path),
      base = path.join(root, "artifacts/ui-c") + path.sep;
    check(
      filename.startsWith(base) &&
        fs.lstatSync(filename).isFile() &&
        !fs.lstatSync(filename).isSymbolicLink() &&
        sha256(fs.readFileSync(filename)) === entry.uiProof.sha256,
      "C historical UI proof is missing or changed.",
    );
    const proof = readJson(filename);
    assertCUIProofContext(proof, plan, manifest);
    check(
      proof.status === "passed" &&
        proof.eventId === scope.eventId &&
        same(proof.contract, scope.contract) &&
        same(proof.wallet, scope[role]) &&
        proof.journalAction === op.journalAction &&
        same(proof.hash, entry.hash) &&
        proof.source?.planFingerprint === fingerprint(plan) &&
        proof.source.manifestSha256 === sha256(publicJson(manifest)) &&
        proof.ui?.walletTransactions === 1 &&
        proof.ui.broadcasts === 1,
      "C history cannot substitute a CLI transaction for an actual successful UI step.",
    );
    for (const log of canonical.receipt.logs.filter((log) =>
      same(log.address, scope.contract),
    )) {
      const parsed = eventInterface.parseLog(log);
      check(
        parsed?.name !== "PayoutFailed",
        "A C payment became owed credit; do not report it as delivered.",
      );
      if (parsed?.name === "Payout") {
        const key = parsed.args.to.toLowerCase();
        paid.set(key, (paid.get(key) ?? 0n) + parsed.args.amount);
      }
    }
    records.push({
      action: op.journalAction,
      hash: entry.hash,
      blockNumber: entry.blockNumber,
      blockHash: entry.blockHash,
      uiProofSha256: entry.uiProof.sha256,
    });
  }
  return { records, paid };
}

export async function runCOperator({
  stage,
  plan,
  manifest,
  source,
  provider,
  artifacts,
  stack,
  journalPath = UI_C.journal,
  proofRoot = ROOT,
  signer,
  sender = sendOnce,
}) {
  check(
    ["ruling", "verify"].includes(stage),
    "Choose C ruling or final verification.",
  );
  validateUiCPlan(plan, source);
  await assertTestnet(provider, plan.chain);
  check(
    manifest.planFingerprint === fingerprint(plan) &&
      manifest.events?.length === 1 &&
      manifest.publicOrigin === plan.publicOrigin &&
      manifest.scenario?.expectedFinalRuling === 1 &&
      publicJson(stack.anchors) === publicJson(plan.stackAnchors),
    "C operator source/manifest/stack changed.",
  );
  const journal = loadJournal(journalPath, plan),
    record = manifest.events[0],
    d = record.deployment;
  const creation = uiCCreateRequest(plan, artifacts);
  const creationEntry = assertPlanDeployment(
    record,
    plan,
    journal,
    creation,
    ethers.keccak256(artifacts.KlerosEventV8.bytecode),
  );
  await canonicalCTransaction(provider, creationEntry, {
    from: plan.addresses.owner.toLowerCase(),
    to: plan.factory.toLowerCase(),
    value: "0",
    data: creation.request.data,
  });
  const { verifyDeployment } = await import("../src/chain.mjs");
  await verifyDeployment({ provider }, d);
  const event = new ethers.Contract(
    d.contract,
    artifacts.KlerosEventV8.abi,
    provider,
  );
  const resolver = new ethers.Contract(
    plan.arbitration.resolver,
    artifacts.MockArbitrableProxy.abi,
    provider,
  );
  const arbitrator = new ethers.Contract(
    plan.arbitration.arbitrator,
    artifacts.MockKlerosLiquid.abi,
    provider,
  );
  const scope = {
    chainId: 10200,
    eventId: d.eventId,
    contract: d.contract,
    depositWei: plan.depositWei,
    ...plan.addresses,
  };
  const readAB = () =>
    Promise.all(
      source.events.map((record) =>
        protectedFacts(
          record,
          provider,
          artifacts.KlerosEventV8.abi,
          source.rehearsalAddresses,
        ),
      ),
    );
  const before = await stateOf(event, provider, scope, resolver),
    abBefore = await readAB();
  const history = await verifyCUIHistory({
    provider,
    journal,
    plan,
    manifest,
    scope,
    state: before,
    eventInterface: event.interface,
    settled: stage === "verify",
    root: proofRoot,
  });
  const request = {
    to: arbitrator.target,
    value: 0n,
    data: arbitrator.interface.encodeFunctionData("giveFinalRuling", [
      before.bobCase.arbitratorDisputeID,
      1,
    ]),
  };
  const expectedRuling = {
    from: scope.owner.toLowerCase(),
    to: arbitrator.target.toLowerCase(),
    data: request.data,
    value: "0",
  };
  let rulingReceipt,
    broadcasted = false;
  if (stage === "ruling") {
    if (journal.transactions[C_RULING_ACTION]) {
      const recoverySigner = {
        getAddress: async () => scope.owner,
        populateTransaction: async () => {
          throw new Error("Receipt-only recovery cannot prepare a transaction");
        },
        signTransaction: async () => {
          throw new Error("Receipt-only recovery cannot sign");
        },
      };
      rulingReceipt = await sender({
        provider,
        signer: recoverySigner,
        journal,
        journalPath,
        action: C_RULING_ACTION,
        request,
      });
      await canonicalCTransaction(
        provider,
        journal.transactions[C_RULING_ACTION],
        expectedRuling,
      );
      assertCAfterRuling(
        await stateOf(event, provider, scope, resolver),
        scope,
      );
    } else {
      assertCBeforeRuling(before, scope);
      check(
        (history.paid.get(scope.alice.toLowerCase()) ?? 0n) ===
          BigInt(scope.depositWei) &&
          (history.paid.get(scope.bob.toLowerCase()) ?? 0n) === 0n,
        "C ordinary UI receipt must show Alice paid and no Bob payment before ruling.",
      );
      const arbitrationCase = await arbitrator.disputes(
        before.bobCase.arbitratorDisputeID,
        { blockTag: before.indexedBlock.number },
      );
      check(
        same(arbitrationCase.arbitrated, resolver.target) &&
          signer &&
          same(await signer.getAddress(), scope.owner),
        "Only C owner may operate this exact controlled resolver case.",
      );
      await assertTestnet(provider, plan.chain);
      assertCBeforeRuling(
        await stateOf(event, provider, scope, resolver),
        scope,
      );
      journal.operatorBeforeRulingAB = abBefore;
      atomicJson(journalPath, journal);
      rulingReceipt = await sender({
        provider,
        signer,
        journal,
        journalPath,
        action: C_RULING_ACTION,
        request,
      });
      broadcasted = true;
      assertCAfterRuling(
        await stateOf(event, provider, scope, resolver),
        scope,
      );
    }
  } else {
    await canonicalCTransaction(
      provider,
      journal.transactions[C_RULING_ACTION],
      expectedRuling,
    );
    assertCSettled(before, scope, history.paid);
    check(
      journal.operatorBeforeRulingAB &&
        publicJson(
          journal.operatorBeforeRulingAB.map((item) => item.financial),
        ) === publicJson(abBefore.map((item) => item.financial)),
      "A/B changed during C ruling/settlement or its baseline is missing.",
    );
  }
  const after = await stateOf(event, provider, scope, resolver),
    abAfter = await readAB();
  check(
    publicJson(abBefore.map((item) => item.financial)) ===
      publicJson(abAfter.map((item) => item.financial)),
    "C operator action changed a protected A/B financial snapshot.",
  );
  let collateralDelivery;
  if (stage === "verify")
    collateralDelivery = await proveCollateralDelivery({
      provider,
      event,
      challenge: await event.challenges(scope.bob),
      bob: scope.bob,
      finalRuling: 1,
      hash: journal.transactions["ui-c-resolve-bob"].hash,
    });
  const proof = {
    status: "passed",
    stage,
    chainId: 10200,
    arbitration: "controlled test arbitrator; no independent jury",
    eventId: scope.eventId,
    contract: scope.contract,
    planFingerprint: fingerprint(plan),
    sourceContext: {
      manifestSha256: sha256(publicJson(manifest)),
      protectedManifestSha256: sha256(publicJson(source)),
      operatorSha256: sha256(fs.readFileSync(new URL(import.meta.url))),
      stackAnchors: plan.stackAnchors,
    },
    performedAt: new Date().toISOString(),
    uiHistory: history.records,
    attendancePaidWei: Object.fromEntries(
      [...history.paid].map(([wallet, amount]) => [wallet, String(amount)]),
    ),
    rulingTransactionHash:
      rulingReceipt?.hash ?? journal.transactions[C_RULING_ACTION].hash,
    finalRuling: 1,
    before,
    after,
    protectedAB: { unchanged: true, before: abBefore, after: abAfter },
    ...(collateralDelivery ? { collateralDelivery } : {}),
    transactionsBroadcast: broadcasted ? 1 : 0,
    notice:
      stage === "ruling"
        ? "Final ruling delivered; held share still requires actual UI settlement."
        : "Canonical UI attendance Payouts and separate challenge collateral delivery verified; owed credit is separately zero.",
  };
  return proof;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, {
    "--stage": "value",
    "--execute": "boolean",
    "--help": "boolean",
  });
  check(
    !args["--stage"] || ["ruling", "verify"].includes(args["--stage"]),
    "Choose ruling or verify.",
  );
  if (!args["--execute"] || args["--help"]) {
    console.log(
      publicJson({
        status: "review-only",
        stages: ["ruling", "verify"],
        selectedStage: args["--stage"] ?? null,
        runtimeFilesRead: 0,
        signingFilesRead: 0,
        networkRequests: 0,
        signatures: 0,
        broadcasts: 0,
        instruction:
          "After explicit go: --stage ruling --execute delivers only controlled attended ruling1 after actual ordinary UI payout. After separate UI settlement: --stage verify --execute performs read-only canonical payout/collateral checks. Existing ruling hashes permit receipt checks only.",
      }),
    );
    return;
  }
  check(args["--stage"], "Choose an explicit C operator stage.");
  const source = readJson(UI_C.sourceManifest),
    plan = validateUiCPlan(readJson(UI_C.plan), source),
    manifest = readJson(UI_C.manifest),
    { artifacts, provenance } = verifyCompiledInputs();
  const transport = new URL(process.env.TESTNET_RPC_URL ?? plan.chain.rpcUrl);
  check(
    transport.protocol === "https:" &&
      !transport.username &&
      !transport.password &&
      !transport.search &&
      !transport.hash,
    "Use a public HTTPS Chiado transport without credentials.",
  );
  const provider = new ethers.JsonRpcProvider(
    singleAttemptConnection(transport.href),
    undefined,
    {
      cacheTimeout: -1,
      batchMaxCount: 1,
    },
  );
  const unlock = acquireLock(UI_C.lock);
  try {
    const stack = await verifyUiCStack({
      provider,
      source,
      sourceJournal: readJson(UI_C.sourceJournal),
      artifacts,
      provenance,
    });
    let signer;
    if (
      args["--stage"] === "ruling" &&
      !loadJournal(UI_C.journal, plan).transactions[C_RULING_ACTION]
    ) {
      const stat = fs.lstatSync(UI_C.wallets);
      check(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          (stat.mode & 0o077) === 0 &&
          (process.getuid === undefined || stat.uid === process.getuid()),
        "C signing file must remain an owner-only regular file.",
      );
      const keys = readJson(UI_C.wallets);
      check(
        keys.purpose === UI_C.purpose &&
          keys.chainId === 10200 &&
          keys.roles.owner.address === plan.addresses.owner &&
          new ethers.Wallet(keys.roles.owner.privateKey).address ===
            plan.addresses.owner,
        "Only the prepared C owner may sign the controlled ruling.",
      );
      signer = new ethers.Wallet(keys.roles.owner.privateKey, provider);
    }
    const proof = await runCOperator({
      stage: args["--stage"],
      plan,
      manifest,
      source,
      provider,
      artifacts,
      stack,
      signer,
    });
    const directory = path.join(
      ROOT,
      "artifacts/ui-c",
      `${proof.stage}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    );
    fs.mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, "operator-proof.json");
    fs.writeFileSync(filename, publicJson(proof), { flag: "wx", mode: 0o644 });
    console.log(
      publicJson({ ...proof, archivedProof: path.relative(ROOT, filename) }),
    );
  } finally {
    unlock();
    provider.destroy();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main().catch(safeFailure);
