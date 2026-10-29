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
  UI_D,
  validateUiDPlan,
  verifyUiDStack,
  uiDCreateRequest,
  assertUiDDeployment,
  assertUiDArtifacts,
  verifyUiDFactory,
  protectedDContext,
  assertProtectedDUnchanged,
} from "./testnet-ui-d-scenario.mjs";
import { proveCollateralDelivery } from "./testnet-rehearsal.mjs";
import {
  stateOf,
  singleAttemptConnection,
} from "../test/testnet-ui-c.e2e.mjs";

export const D_RULING_ACTION = "ui-d-controlled-ruling";
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

export function dOperationFor(stage, role, scope, state) {
  const definitions = {
    deposits: ["deposit", [], BigInt(scope.depositWei), `deposit-${role}`],
    admit: ["registerStakers", [[scope.alice, scope.bob]], 0n, "register"],
    attendance: ["postAttendance", [[scope.alice], String(2n * BigInt(scope.depositWei))], 0n, "post-attendance"],
    challenge: ["challenge", [], BigInt(state.challengeDepositWei ?? 0), "challenge-bob"],
    match: ["matchChallenge", [scope.bob], BigInt(state.bobCase?.deposit ?? 0), "match-bob"],
    payout: ["releasePayouts", [], 0n, "release-payouts"],
    settle: ["resolveChallenge", [scope.bob], 0n, "resolve-bob"],
  };
  check(definitions[stage] && (stage === "deposits" ? ["alice", "bob"].includes(role)
    : role === (stage === "challenge" ? "bob" : "owner")), "Wrong D operation or signing role.");
  const [method, args, value, suffix] = definitions[stage];
  if (["challenge", "match"].includes(stage)) check(value === 30000000000n, "D controlled challenge/match fee differs.");
  return { method, args, value, journalAction: `ui-d-${suffix}` };
}

export function boundedDRulingSigner(key, { provider, plan, scope, request, disputeId, verifyState }) {
  const expectedData = new ethers.Interface(["function giveFinalRuling(uint256,uint256)"])
    .encodeFunctionData("giveFinalRuling", [disputeId, 1]);
  check(same(request.to, plan.arbitration.arbitrator) && request.data === expectedData &&
    BigInt(request.value ?? 0) === 0n, "D ruling must target its exact dynamic controlled attended case.");
  return {
    getAddress: () => key.getAddress(), populateTransaction: tx => key.populateTransaction(tx),
    signTransaction: async tx => {
      const address = await key.getAddress(), fee = BigInt(tx.maxFeePerGas ?? tx.gasPrice ?? 0), gas = BigInt(tx.gasLimit ?? 0);
      check(same(address, scope.owner) && BigInt(tx.chainId ?? 0) === 10200n && same(tx.from ?? address, address) &&
        same(tx.to, request.to) && tx.data === expectedData && BigInt(tx.value ?? 0) === 0n &&
        gas > 0n && gas <= 2_000_000n && fee > 0n && fee <= BigInt(plan.deploymentBudget.maxFeePerGas) &&
        BigInt(tx.maxPriorityFeePerGas ?? 0) <= fee && Number.isSafeInteger(tx.nonce) && tx.nonce >= 0,
        "D ruling populated transaction exceeds its exact controlled call or approved fee/gas bounds; key not used.");
      const fresh = await verifyState();
      assertDBeforeRuling(fresh, scope);
      check(String(fresh.bobCase.arbitratorDisputeID) === String(disputeId), "D ruling dynamic case changed before signing; key not used.");
      const [nonce, balance] = await Promise.all([provider.getTransactionCount(address, "pending"), provider.getBalance(address)]);
      check(nonce === tx.nonce && balance >= gas * fee + 1_000_000_000_000n,
        "D ruling nonce is stale or signing would consume settlement gas reserves; key not used.");
      return key.signTransaction(tx);
    },
  };
}

export function assertDBeforeRuling(state, scope) {
  const D = BigInt(scope.depositWei),
    c = state.bobCase;
  check(
    scope.chainId === 10200 &&
      scope.contractVersion === UI_D.contractVersion &&
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
      state.challengeEscrow === "30000000000" &&
      state.reserved === String(D + 30000000000n) &&
      state.balance === String(D + 30000000000n) &&
      c.state === 2 &&
      c.finalRuling === null &&
      c.heldShare === String(D) &&
      c.deposit === "30000000000" && c.arbitrationPaid === "30000000000" &&
      same(c.matcher, scope.owner) &&
      /^\d+$/.test(c.localDisputeID) &&
      /^\d+$/.test(c.arbitratorDisputeID),
    "D ruling1 requires the actual ordinary batch with Alice paid and the same Bob depositor's full unruled share held.",
  );
}

export function assertDAfterRuling(state, scope) {
  assertDBeforeRuling(
    { ...state, bobCase: { ...state.bobCase, finalRuling: null } },
    scope,
  );
  check(
    state.bobCase.finalRuling === 1,
    "The controlled resolver must record attended ruling1 while Bob's full share remains held before UI settlement.",
  );
}

export function assertDSettled(state, scope, paid) {
  const D = BigInt(scope.depositWei),
    c = state.bobCase;
  check(
    scope.chainId === 10200 &&
      scope.contractVersion === UI_D.contractVersion &&
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
    "D final proof requires Alice D and the same Bob depositor D delivered, with all case/credit reserves separately cleared.",
  );
}

export function assertDUIProofContext(proof, plan, manifest) {
  const source = proof.source,
    deployment = manifest.events[0].deployment;
  const protectedABC = proof.protectedABC;
  check(
    source?.origin === plan.publicOrigin &&
      typeof source.instanceId === "string" &&
      source.instanceId.length > 0 &&
      /^[0-9a-f]{64}$/.test(source.harnessSha256 ?? "") &&
      source.operatorFiles?.["test/testnet-ui-d.e2e.mjs"] ===
        source.harnessSha256 &&
      source.protectedManifestSha256 === plan.sourceManifestSha256 &&
      source.protectedCManifestSha256 === plan.protectedCManifestSha256 &&
      source.planFingerprint === fingerprint(plan) &&
      source.manifestSha256 === sha256(publicJson(manifest)) &&
      same(source.contract?.address, deployment.contract) &&
      source.contract.codeHash === deployment.codeHash &&
      same(source.contract.factory, deployment.factory) &&
      source.contract.factoryCodeHash === deployment.factoryCodeHash &&
      source.contract.factoryDeploymentTxHash === deployment.factoryDeploymentTxHash &&
      source.contract.factoryDeploymentBlock === deployment.factoryDeploymentBlock &&
      source.contract.deploymentTxHash === deployment.deploymentTxHash &&
      source.contract.deploymentBlock === deployment.deploymentBlock &&
      source.contract.configurationHash === deployment.configurationHash &&
      protectedABC?.unchanged === true &&
      Array.isArray(protectedABC.before) &&
      protectedABC.before.length === 3 &&
      Array.isArray(protectedABC.after) &&
      protectedABC.after.length === 3 &&
      publicJson(protectedABC.before.map(e => e.financial?.contract)) === publicJson(plan.protectedContracts) &&
      [...protectedABC.before, ...protectedABC.after].every(
        (entry) =>
          entry?.financial && ethers.isAddress(entry.financial.contract),
      ) &&
      publicJson(protectedABC.before.map((entry) => entry.financial)) ===
        publicJson(protectedABC.after.map((entry) => entry.financial)),
    "D UI proof lacks exact origin, harness, child-creation context or unchanged protected A/B+C evidence.",
  );
}

export async function canonicalDTransaction(provider, entry, expected) {
  check(
    entry?.state === "confirmed" &&
      hashPattern.test(entry.hash) &&
      Object.keys(entry.expected ?? {})
        .sort()
        .join() === "data,from,to,value" &&
      ["from", "to", "data", "value"].every(
        (key) => entry.expected[key] === expected[key],
      ),
    "D journal operation differs from its exact reviewed call.",
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
    "D operation lacks its exact successful canonical two-confirmation transaction.",
  );
  return { receipt, tx, block };
}

export async function verifyDUIHistory({
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
    const op = dOperationFor(stage, role, scope, state),
      entry = journal.transactions[op.journalAction];
    const expected = {
      from: scope[role].toLowerCase(),
      to: scope.contract.toLowerCase(),
      data: eventInterface.encodeFunctionData(op.method, op.args),
      value: String(op.value),
    };
    const canonical = await canonicalDTransaction(provider, entry, expected);
    check(
      entry.uiProof?.path && /^[0-9a-f]{64}$/.test(entry.uiProof.sha256),
      "D financial history must have actual UI proof provenance.",
    );
    const filename = path.resolve(root, entry.uiProof.path),
      base = path.join(root, "artifacts/ui-d") + path.sep;
    check(
      filename.startsWith(base) &&
        fs.lstatSync(filename).isFile() &&
        !fs.lstatSync(filename).isSymbolicLink() &&
        sha256(fs.readFileSync(filename)) === entry.uiProof.sha256,
      "D historical UI proof is missing or changed.",
    );
    const proof = readJson(filename);
    assertDUIProofContext(proof, plan, manifest);
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
      "D history cannot substitute a CLI transaction for an actual successful UI step.",
    );
    for (const log of canonical.receipt.logs.filter((log) =>
      same(log.address, scope.contract),
    )) {
      const parsed = eventInterface.parseLog(log);
      check(
        parsed?.name !== "PayoutFailed",
        "A D payment became owed credit; do not report it as delivered.",
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

export async function runDOperator({
  stage,
  plan,
  manifest,
  source,
  protectedC,
  provider,
  artifacts,
  provenance,
  legacyArtifacts,
  stack,
  journalPath = UI_D.journal,
  proofRoot = ROOT,
  signer,
  getSigner,
  sender = sendOnce,
}) {
  check(
    ["ruling", "verify"].includes(stage),
    "Choose D ruling or final verification.",
  );
  validateUiDPlan(plan, source, protectedC);
  assertUiDArtifacts(plan, artifacts, provenance);
  await assertTestnet(provider, plan.chain);
  check(
    manifest.planFingerprint === fingerprint(plan) &&
      manifest.events?.length === 1 &&
      manifest.publicOrigin === plan.publicOrigin &&
      manifest.scenario?.id === "ui-deposit-d" &&
      manifest.scenario?.expectedFinalRuling === 1 &&
      publicJson(stack.anchors) === publicJson(plan.stackAnchors),
    "D operator source/manifest/stack changed.",
  );
  const journal = loadJournal(journalPath, plan),
    record = manifest.events[0],
    d = record.deployment;
  const creation = uiDCreateRequest(plan, artifacts);
  const creationEntry = assertUiDDeployment(record, plan, journal, creation, artifacts);
  const factoryAnchor = await verifyUiDFactory({ provider, plan, artifacts, journal });
  check(factoryAnchor.codeHash === d.factoryCodeHash &&
    factoryAnchor.deploymentTxHash === d.factoryDeploymentTxHash &&
    factoryAnchor.deploymentBlock === d.factoryDeploymentBlock,
    "D operator factory birth/runtime anchor differs from its selected child.");
  await canonicalDTransaction(provider, creationEntry, {
    from: plan.addresses.owner.toLowerCase(),
    to: plan.factory.toLowerCase(),
    value: "0",
    data: creation.request.data,
  });
  const { verifyDeployment } = await import("../src/chain.mjs");
  await verifyDeployment({ provider }, d);
  const event = new ethers.Contract(
    d.contract,
    artifacts[UI_D.eventArtifact].abi,
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
    contractVersion: UI_D.contractVersion,
    ...plan.addresses,
  };
  check((await event.VERSION()) === 80015n && (await event.CHALLENGE_PERIOD()) === 900n &&
    (await event.MATCH_PERIOD()) === 900n, "D operator refuses every other version or timing profile.");
  const readABC = () => protectedDContext(source, protectedC, provider, legacyArtifacts);
  const before = await stateOf(event, provider, scope, resolver),
    abcBefore = await readABC();
  const history = await verifyDUIHistory({
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
  const guardedSigner = key => boundedDRulingSigner(key, { provider, plan, scope, request,
    disputeId: before.bobCase.arbitratorDisputeID, verifyState: () => stateOf(event, provider, scope, resolver) });
  const expectedRuling = {
    from: scope.owner.toLowerCase(),
    to: arbitrator.target.toLowerCase(),
    data: request.data,
    value: "0",
  };
  let rulingReceipt,
    broadcasted = false;
  if (stage === "ruling") {
    if (journal.transactions[D_RULING_ACTION]) {
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
        action: D_RULING_ACTION,
        request,
      });
      await canonicalDTransaction(
        provider,
        journal.transactions[D_RULING_ACTION],
        expectedRuling,
      );
      assertDAfterRuling(
        await stateOf(event, provider, scope, resolver),
        scope,
      );
    } else {
      assertDBeforeRuling(before, scope);
      check(
        (history.paid.get(scope.alice.toLowerCase()) ?? 0n) ===
          BigInt(scope.depositWei) &&
          (history.paid.get(scope.bob.toLowerCase()) ?? 0n) === 0n,
        "D ordinary UI receipt must show Alice paid and no Bob payment before ruling.",
      );
      const arbitrationCase = await arbitrator.disputes(
        before.bobCase.arbitratorDisputeID,
        { blockTag: before.indexedBlock.number },
      );
      if (!signer && getSigner) signer = await getSigner();
      check(
        same(arbitrationCase.arbitrated, resolver.target) &&
          signer &&
          same(await signer.getAddress(), scope.owner),
        "Only D owner may operate this exact controlled resolver case.",
      );
      await assertTestnet(provider, plan.chain);
      assertDBeforeRuling(
        await stateOf(event, provider, scope, resolver),
        scope,
      );
      journal.operatorBeforeRulingABC = abcBefore;
      atomicJson(journalPath, journal);
      rulingReceipt = await sender({
        provider,
        signer: guardedSigner(signer),
        journal,
        journalPath,
        action: D_RULING_ACTION,
        request,
      });
      broadcasted = true;
      assertDAfterRuling(
        await stateOf(event, provider, scope, resolver),
        scope,
      );
    }
  } else {
    await canonicalDTransaction(
      provider,
      journal.transactions[D_RULING_ACTION],
      expectedRuling,
    );
    assertDSettled(before, scope, history.paid);
  }
  const after = await stateOf(event, provider, scope, resolver),
    abcAfter = await readABC();
  assertProtectedDUnchanged(abcBefore, abcAfter);
  let collateralDelivery;
  if (stage === "verify")
    collateralDelivery = await proveCollateralDelivery({
      provider,
      event,
      challenge: await event.challenges(scope.bob),
      bob: scope.bob,
      finalRuling: 1,
      hash: journal.transactions["ui-d-resolve-bob"].hash,
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
      protectedCManifestSha256: sha256(publicJson(protectedC)),
      operatorSha256: sha256(fs.readFileSync(new URL(import.meta.url))),
      stackAnchors: plan.stackAnchors,
    },
    performedAt: new Date().toISOString(),
    uiHistory: history.records,
    attendancePaidWei: Object.fromEntries(
      [...history.paid].map(([wallet, amount]) => [wallet, String(amount)]),
    ),
    rulingTransactionHash:
      rulingReceipt?.hash ?? journal.transactions[D_RULING_ACTION].hash,
    finalRuling: 1,
    before,
    after,
    protectedABC: { unchanged: true, before: abcBefore, after: abcAfter },
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
  check(args["--stage"], "Choose an explicit D operator stage.");
  const source = readJson(UI_D.sourceManifest),
    protectedC = readJson(UI_D.protectedCManifest),
    plan = validateUiDPlan(readJson(UI_D.plan), source, protectedC),
    manifest = readJson(UI_D.manifest),
    { artifacts, provenance } = verifyCompiledInputs(ROOT, UI_D.contractVersion),
    legacy = verifyCompiledInputs(ROOT);
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
  const unlock = acquireLock(UI_D.lock);
  try {
    const stack = await verifyUiDStack({
      provider,
      source,
      protectedC,
      sourceJournal: readJson(UI_D.sourceJournal),
      artifacts,
      provenance,
      legacyArtifacts: legacy.artifacts,
      legacyProvenance: legacy.provenance,
    });
    const getSigner = async () => {
      const stat = fs.lstatSync(UI_D.wallets);
      check(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          (stat.mode & 0o077) === 0 &&
          (process.getuid === undefined || stat.uid === process.getuid()),
        "D signing file must remain an owner-only regular file.",
      );
      const keys = readJson(UI_D.wallets);
      check(
        keys.purpose === UI_D.purpose &&
          keys.chainId === 10200 &&
          keys.roles.owner.address === plan.addresses.owner &&
          new ethers.Wallet(keys.roles.owner.privateKey).address ===
            plan.addresses.owner,
        "Only the prepared D owner may sign the controlled ruling.",
      );
      return new ethers.Wallet(keys.roles.owner.privateKey, provider);
    };
    const proof = await runDOperator({
      stage: args["--stage"],
      plan,
      manifest,
      source,
      protectedC,
      provider,
      artifacts,
      provenance,
      legacyArtifacts: legacy.artifacts,
      stack,
      getSigner,
    });
    const directory = path.join(
      ROOT,
      "artifacts/ui-d",
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
