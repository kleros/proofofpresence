// Independent fast D observer. Fixed public manifest + required externally reviewed pins.
// GET/RPC reads only: no authentication, private files, wallet, signing or broadcasts.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { expectedUi, reconcileTransfers } from "./chiado-flow-audit.mjs";
import { checkTest15mSources } from "./generate-contracts-test15m.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST_FILE = "registry/chiado-v8-ui-d.json";
const PROFILE = "kleros-event-v8-test15m";
const PHASES = ["Open", "Listed", "Finalized", "Cancelled"];
const CASES = ["None", "Waiting", "Disputed", "Resolved"];
export const PHASE_NAMES = [
  "open",
  "deposited",
  "admitted",
  "matched",
  "ordinary",
  "ruled",
  "settled",
];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const textJson = (value) =>
  JSON.stringify(value, (_, x) => (typeof x === "bigint" ? String(x) : x), 2) +
  "\n";
const sum = (values) => values.reduce((total, x) => total + BigInt(x), 0n);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const OBSERVER_SHA256 = sha(fs.readFileSync(fileURLToPath(import.meta.url)));
const OBSERVER_FILES = Object.fromEntries(
  [
    "scripts/chiado-ui-d-flow-audit.mjs",
    "scripts/chiado-flow-audit.mjs",
    "scripts/generate-contracts-test15m.mjs",
  ].map((filename) => [
    filename,
    sha(fs.readFileSync(path.join(ROOT, filename))),
  ]),
);

export function assertDManifest(manifest, expected, rawBytes) {
  assert.ok(
    expected && /^[0-9a-f]{64}$/.test(expected.manifestSha256 ?? ""),
    "Externally reviewed raw manifest SHA256 required",
  );
  assert.equal(
    sha(rawBytes),
    expected.manifestSha256,
    "Exact reviewed manifest bytes",
  );
  assert.ok(/^[0-9a-f-]{36}$/i.test(expected.planId ?? ""));
  assert.ok(/^[0-9a-f]{64}$/.test(expected.planFingerprint ?? ""));
  const origin = new URL(expected.origin);
  assert.ok(
    origin.protocol === "https:" &&
      origin.origin === expected.origin &&
      !origin.username &&
      !origin.password,
  );
  assert.ok(ethers.isAddress(expected.contract));
  assert.equal(manifest.environment, "testnet");
  assert.equal(manifest.chain.chainId, 10200);
  assert.equal(manifest.planId, expected.planId);
  assert.equal(manifest.planFingerprint, expected.planFingerprint);
  assert.equal(manifest.publicOrigin, expected.origin);
  assert.equal(manifest.scenario.id, "ui-deposit-d");
  assert.equal(manifest.scenario.expectedFinalRuling, 1);
  assert.equal(manifest.arbitration.mode, "controlled");
  assert.equal(manifest.events.length, 1);
  const { definition, deployment } = manifest.events[0];
  assert.equal(definition.id, expected.eventId);
  assert.equal(deployment.eventId, expected.eventId);
  assert.equal(expected.eventId, `chiado-ui-${expected.planId}-d`);
  assert.ok(same(deployment.contract, expected.contract));
  assert.equal(deployment.chainId, 10200);
  assert.equal(deployment.contractVersion, PROFILE);
  assert.equal(deployment.abiVersion, PROFILE);
  assert.equal(deployment.depositWei, "1000000000000");
  assert.equal(deployment.challengePeriodSeconds, 900);
  assert.equal(deployment.matchPeriodSeconds, 900);
  assert.equal(
    deployment.claimDeadline >= deployment.eventStart + 604800,
    true,
  );
  assert.deepEqual(manifest.profile, {
    contractVersion: PROFILE,
    numericVersion: 80015,
    challengePeriod: 900,
    matchPeriod: 900,
  });
  assert.equal(
    Object.keys(manifest.rehearsalAddresses).sort().join(),
    "alice,bob,owner",
  );
  const wallets = Object.values(manifest.rehearsalAddresses);
  assert.ok(
    wallets.every(
      (wallet) => ethers.isAddress(wallet) && !same(wallet, ethers.ZeroAddress),
    ),
  );
  assert.equal(new Set(wallets.map((wallet) => wallet.toLowerCase())).size, 3);
  assert.ok(same(deployment.owner, manifest.rehearsalAddresses.owner));
  assert.ok(same(deployment.factory, manifest.factory));
  assert.equal(deployment.factoryCodeHash, manifest.factoryCodeHash);
  assert.equal(
    deployment.factoryDeploymentTxHash,
    manifest.factoryDeploymentTxHash,
  );
  assert.equal(
    deployment.factoryDeploymentBlock,
    manifest.factoryDeploymentBlock,
  );
  assert.equal(
    manifest.policy.uri,
    expected.origin + "/policies/v8-test15m.md",
  );
  assert.equal(sha(manifest.events[0].policy), manifest.policy.sha256);
  assert.equal(
    manifest.provenance.creationCodeHashes.KlerosEventV8Test15m,
    "0x5bf9454fa2653055199c63aded037886758c4f1e0b276e9290b6424cab5771c0",
  );
  assert.equal(
    manifest.provenance.creationCodeHashes.KlerosEventFactoryV8Test15m,
    "0x263f1f460ceb46abe9e77222d4fcfd0ffbf16f027522aea4fbac2b41391fc433",
  );
}

export function assertDPhase(phase, current, addresses, depositWei) {
  assert.ok(PHASE_NAMES.includes(phase));
  const { state: s, payments, roles, expectedUi: ui } = current;
  const D = BigInt(depositWei);
  const paid = (wallet) =>
    sum(
      payments.transfers
        .filter(
          (r) =>
            r.type === "attendance-payout" &&
            r.successful &&
            same(r.wallet, wallet) &&
            same(r.recipient, wallet),
        )
        .map((r) => r.amountWei),
    );
  assert.equal(roles.alice.owedWei, "0");
  assert.equal(roles.bob.owedWei, "0");
  assert.equal(s.owedTotalWei, "0");
  assert.ok(
    same(roles.alice.wallet, addresses.alice) &&
      same(roles.bob.wallet, addresses.bob),
  );
  if (["open", "deposited", "admitted"].includes(phase)) {
    assert.equal(s.phase, "Open");
    assert.equal(s.cases.length, 0);
    assert.equal(paid(addresses.alice), 0n);
    assert.equal(paid(addresses.bob), 0n);
    assert.equal(s.stakerCount, phase === "admitted" ? 2 : 0);
    const pending = phase === "deposited" ? D : 0n;
    assert.equal(roles.alice.pendingWei, String(pending));
    assert.equal(roles.bob.pendingWei, String(pending));
    assert.equal(s.pendingTotalWei, String(2n * pending));
    assert.equal(roles.alice.status, phase === "admitted" ? 1 : 0);
    assert.equal(roles.bob.status, phase === "admitted" ? 1 : 0);
    return;
  }
  assert.equal(s.stakerCount, 2);
  assert.equal(roles.alice.attended, true);
  assert.equal(s.pendingTotalWei, "0");
  assert.equal(roles.alice.pendingWei, "0");
  assert.equal(roles.bob.pendingWei, "0");
  assert.equal(s.cases.length, 1);
  const c = s.cases[0];
  assert.ok(same(c.wallet, addresses.bob));
  assert.equal(c.matched, true);
  assert.ok(
    /^\d+$/.test(c.localDisputeID) && /^\d+$/.test(c.arbitratorDisputeID),
  );
  assert.ok(
    same(c.matcher, addresses.owner) && same(c.caseOrganizer, addresses.owner),
  );
  if (phase === "matched") {
    assert.equal(s.phase, "Listed");
    assert.equal(c.state, "Disputed");
    assert.equal(c.finalRuling, null);
    assert.equal(s.heldBackWei, "0");
    assert.equal(s.attendeeCount, 1);
    assert.equal(s.pendingChallenges, 1);
    assert.equal(roles.alice.status, 1);
    assert.equal(roles.bob.status, 1);
    assert.equal(roles.bob.attended, false);
    assert.equal(paid(addresses.alice), 0n);
    assert.equal(paid(addresses.bob), 0n);
    return;
  }
  assert.equal(s.phase, "Finalized");
  assert.equal(roles.alice.status, 2);
  assert.equal(paid(addresses.alice), D);
  if (phase === "ordinary" || phase === "ruled") {
    assert.equal(c.state, "Disputed");
    assert.equal(c.finalRuling, phase === "ordinary" ? null : 1);
    assert.equal(s.attendeeCount, 1);
    assert.equal(s.pendingChallenges, 1);
    assert.equal(roles.bob.status, 1);
    assert.equal(roles.bob.attended, false);
    assert.equal(c.heldShareWei, String(D));
    assert.equal(s.heldBackWei, String(D));
    assert.equal(paid(addresses.bob), 0n);
    assert.equal(ui.allFinancialObligationsComplete, false);
    return;
  }
  assert.equal(c.state, "Resolved");
  assert.equal(c.finalRuling, 1);
  assert.equal(paid(addresses.bob), D);
  assert.equal(s.attendeeCount, 2);
  assert.equal(s.pendingChallenges, 0);
  assert.equal(roles.alice.attended, true);
  assert.equal(roles.bob.attended, true);
  assert.equal(roles.alice.status, 2);
  assert.equal(roles.bob.status, 2);
  for (const field of [
    "heldBackWei",
    "pendingTotalWei",
    "owedTotalWei",
    "challengeEscrowWei",
    "reservedWei",
    "balanceWei",
  ])
    assert.equal(s[field], "0", field);
  assert.equal(c.heldShareWei, "0");
  assert.equal(ui.allFinancialObligationsComplete, true);
}

async function verifyDBirth(provider, d, record, artifact, eq, snapshotBlock) {
  const factoryArtifact = JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        "build/contracts-test15m/KlerosEventFactoryV8Test15m.json",
      ),
    ),
  );
  eq(
    ethers.keccak256(factoryArtifact.bytecode),
    "0x263f1f460ceb46abe9e77222d4fcfd0ffbf16f027522aea4fbac2b41391fc433",
    "Exact compiled factory",
  );
  const f = new ethers.Contract(d.factory, factoryArtifact.abi, provider);
  const at = { blockTag: snapshotBlock };
  eq(await f.VERSION(at), 80015n, "Factory version");
  eq(
    await f.eventCreationCode(at),
    artifact.bytecode,
    "Fixed embedded child creation code",
  );
  eq(
    await f.creationCodeHash(at),
    ethers.keccak256(artifact.bytecode),
    "Factory child code hash",
  );
  eq(await f.isEvent(d.contract, at), true, "Factory membership");
  const eventId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "bytes32"],
      [10200, d.factory, d.creator, d.eventKey],
    ),
  );
  eq(eventId, d.factoryEventId, "Namespaced factory event identity");
  eq(
    (await f.eventsById(eventId, at)).toLowerCase(),
    d.contract.toLowerCase(),
    "Factory registry entry",
  );
  const config = {
    depositAmount: d.depositWei,
    eventName: d.eventName,
    eventStart: d.eventStart,
    claimDeadline: d.claimDeadline,
    arbitration: {
      disputeResolver: d.resolver,
      extraData: d.arbitratorExtraData,
      metaEvidenceTemplate: record.pieces,
      metaEvidenceSlots: record.slots,
      policyURI: d.policyURI,
    },
  };
  for (const [hash, blockNumber, isFactory] of [
    [d.factoryDeploymentTxHash, d.factoryDeploymentBlock, true],
    [d.deploymentTxHash, d.deploymentBlock, false],
  ]) {
    const [tx, receipt, block] = await Promise.all([
      provider.getTransaction(hash),
      provider.getTransactionReceipt(hash),
      provider.getBlock(blockNumber),
    ]);
    assert.ok(tx && receipt && block);
    eq(tx.chainId, 10200n, "Creation chain");
    eq(tx.value, 0n, "No principal in creation");
    eq(receipt.status, 1, "Canonical successful creation");
    eq(receipt.blockNumber, blockNumber, "Creation block number");
    eq(receipt.blockHash, block.hash, "Creation remains canonical");
    if (isFactory) {
      eq(tx.to, null, "Factory is a direct deployment");
      eq(tx.data, factoryArtifact.bytecode, "Exact guarded factory initcode");
      eq(
        receipt.contractAddress.toLowerCase(),
        d.factory.toLowerCase(),
        "Factory creation address",
      );
      eq(
        ethers
          .getCreateAddress({ from: tx.from, nonce: tx.nonce })
          .toLowerCase(),
        d.factory.toLowerCase(),
        "Factory CREATE address",
      );
    } else {
      eq(
        tx.to.toLowerCase(),
        d.factory.toLowerCase(),
        "Child created through factory",
      );
      eq(tx.from.toLowerCase(), d.creator.toLowerCase(), "Exact child creator");
      eq(
        tx.data,
        f.interface.encodeFunctionData("createEvent", [d.eventKey, config]),
        "Exact event constructor parameters",
      );
      const logs = receipt.logs
        .filter((l) => same(l.address, d.factory))
        .map((l) => f.interface.parseLog(l))
        .filter((l) => l?.name === "EventCreated");
      eq(logs.length, 1, "One child creation event");
      const a = logs[0].args;
      eq(
        a.eventContract.toLowerCase(),
        d.contract.toLowerCase(),
        "Created child",
      );
      eq(a.version, 80015n, "Creation event version");
      eq(a.eventId, eventId, "Creation event identity");
      eq(a.eventKey, d.eventKey, "Creation event key");
      const configurationHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", f.interface.getFunction("createEvent").inputs[1]],
          [d.creator, config],
        ),
      );
      eq(
        a.configurationHash,
        configurationHash,
        "Canonical configuration hash",
      );
      eq(configurationHash, d.configurationHash, "Reviewed configuration hash");
    }
  }
}

export async function auditD({ expected, phase: checkpoint, rpcUrl } = {}) {
  assert.ok(
    PHASE_NAMES.includes(checkpoint),
    "An explicit D checkpoint phase is required",
  );
  const scope = { ...expected, manifest: MANIFEST_FILE, control: false };
  const scenario = "d-test15m";
  const manifestPath = path.join(ROOT, scope.manifest);
  const bytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.chain.chainId, 10200);
  assert.equal(manifest.arbitration.mode, "controlled");
  assertDManifest(manifest, expected, bytes);
  checkTest15mSources();
  assert.equal(new URL(manifest.chain.rpcUrl).protocol, "https:");
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "build/contracts-test15m/KlerosEventV8Test15m.json"),
    ),
  );
  assert.equal(
    ethers.keccak256(artifact.bytecode),
    manifest.provenance.creationCodeHashes.KlerosEventV8Test15m,
  );
  const transport = new URL(rpcUrl ?? manifest.chain.rpcUrl);
  assert.ok(
    transport.protocol === "https:" &&
      !transport.username &&
      !transport.password &&
      !transport.hash &&
      !transport.search,
    "Public HTTPS RPC only",
  );
  const request = new ethers.FetchRequest(transport.href);
  request.timeout = 45_000;
  const provider = new ethers.JsonRpcProvider(request, 10200, {
    cacheTimeout: -1,
  });
  let checks = 0;
  const eq = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    checks++;
  };
  const readApp = async (relative) => {
    const url = new URL(relative, scope.origin);
    eq(url.origin, scope.origin, "Fixed authorized app origin");
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    eq(response.status, 200, `Public app responds at ${relative}`);
    return response.json();
  };
  try {
    eq(Number((await provider.getNetwork()).chainId), 10200, "RPC is Chiado");
    const boot = await readApp("/api/bootstrap");
    eq(boot.mode, "hosted-testnet", "Live app mode");
    eq(boot.chain.chainId, 10200, "Live UI network");
    eq(boot.chain.rpcUrl, manifest.chain.rpcUrl, "UI RPC binding");
    eq(
      boot.chain.nativeCurrency,
      manifest.chain.nativeCurrency,
      "UI native currency and decimals",
    );
    eq(
      boot.arbitration.mode,
      "controlled",
      "Controlled arbitration is explicit",
    );
    eq(boot.identities, [], "No demo impersonation identities");
    const identities = (records) =>
      records
        .map((r) => ({ id: r.id, contract: r.contract.toLowerCase() }))
        .sort((a, b) => a.id.localeCompare(b.id));
    eq(
      identities(boot.events),
      identities(
        manifest.events.map((r) => ({
          id: r.definition.id,
          contract: r.deployment.contract,
        })),
      ),
      "Bootstrap contains only this exact scenario's events",
    );
    const events = [];
    for (const record of manifest.events) {
      const d = await readApp(
        "/api/events/" + encodeURIComponent(record.definition.id),
      );
      const s = d.state,
        deployment = record.deployment;
      eq(d.event.id, record.definition.id, "Stable event identity");
      eq(
        d.event.contract.toLowerCase(),
        deployment.contract.toLowerCase(),
        "Exact child",
      );
      eq(d.event.contractVersion, PROFILE, "Explicit fast-test version");
      for (const field of [
        "abiVersion",
        "chainId",
        "depositWei",
        "depositOpensAt",
        "depositDeadline",
        "claimDeadline",
      ])
        eq(d.event[field], deployment[field], `UI event ${field}`);
      eq(d.event.startsAt, record.definition.startsAt, "UI event start");
      eq(d.participants, [], "Anonymous view protects participant records");
      eq(
        d.transactions,
        [],
        "Anonymous view protects wallet submission journals",
      );
      eq(d.permissions.authenticated, false, "Observer has no signing session");
      if (Object.hasOwn(d, "ownWallet"))
        eq(
          d.ownWallet,
          null,
          "Anonymous observer cannot read private wallet credit",
        );
      const block = await provider.getBlock(s.blockNumber);
      assert.ok(block);
      checks++;
      eq(block.timestamp, s.now, "API snapshot uses actual chain timestamp");
      eq(
        d.payments.blockNumber,
        block.number,
        "Payments share the state block",
      );
      eq(d.payments.blockHash, block.hash, "Payments use the canonical block");
      const at = { blockTag: block.number };
      const c = new ethers.Contract(
        deployment.contract,
        artifact.abi,
        provider,
      );
      eq(
        ethers.keccak256(await provider.getCode(c.target, block.number)),
        deployment.codeHash,
        "Reviewed child runtime",
      );
      eq(
        ethers.keccak256(
          await provider.getCode(deployment.factory, block.number),
        ),
        deployment.factoryCodeHash,
        "Reviewed factory runtime",
      );
      await verifyDBirth(
        provider,
        deployment,
        record,
        artifact,
        eq,
        block.number,
      );
      eq(await c.VERSION(at), 80015n, "Numeric fast-test version");
      eq(await c.CHALLENGE_PERIOD(at), 900n, "Challenge period");
      eq(await c.MATCH_PERIOD(at), 900n, "Match period");
      eq(
        await c.MIN_SETTLEMENT_WINDOW(at),
        604800n,
        "Posting deadline rule unchanged",
      );
      const names = [
        "owner",
        "pendingOwner",
        "stakerCount",
        "attendeeCount",
        "challengeEndsAt",
        "pendingChallenges",
        "heldBack",
        "pendingTotal",
        "owedTotal",
        "reserved",
        "spare",
        "payoutShare",
        "depositAmount",
        "eventStart",
        "claimDeadline",
        "disputeResolver",
        "arbitrator",
        "challengeDeposit",
      ];
      const values = await Promise.all(names.map((name) => c[name](at)));
      const v = Object.fromEntries(names.map((name, i) => [name, values[i]]));
      const [phase, history, attendees, challengers, balance] =
        await Promise.all([
          c.phase(at),
          c.stakers(at),
          c.attendees(at),
          c.challengers(at),
          provider.getBalance(c.target, block.number),
        ]);
      eq(s.phase, PHASES[Number(phase)], "API phase");
      eq(s.owner.toLowerCase(), v.owner.toLowerCase(), "Fresh owner");
      eq(
        v.owner.toLowerCase(),
        manifest.rehearsalAddresses.owner.toLowerCase(),
        "Planned D owner remains authoritative",
      );
      eq(
        v.pendingOwner,
        ethers.ZeroAddress,
        "No unexpected D ownership proposal",
      );
      eq(
        s.pendingOwner.toLowerCase(),
        v.pendingOwner.toLowerCase(),
        "Fresh pending owner",
      );
      for (const key of [
        "stakerCount",
        "attendeeCount",
        "challengeEndsAt",
        "pendingChallenges",
      ])
        eq(s[key], Number(v[key]), key);
      for (const [field, name] of Object.entries({
        heldBackWei: "heldBack",
        pendingTotalWei: "pendingTotal",
        owedTotalWei: "owedTotal",
        reservedWei: "reserved",
        spareWei: "spare",
        payoutShareWei: "payoutShare",
        depositWei: "depositAmount",
        challengeDepositWei: "challengeDeposit",
      }))
        eq(s[field], v[name].toString(), field);
      eq(s.balanceWei, balance.toString(), "Native custody");
      eq(
        v.eventStart.toString(),
        String(deployment.eventStart),
        "Immutable deposit cutoff",
      );
      eq(
        v.claimDeadline.toString(),
        String(deployment.claimDeadline),
        "Immutable claim deadline",
      );
      eq(
        v.disputeResolver.toLowerCase(),
        deployment.resolver.toLowerCase(),
        "Bound resolver",
      );
      eq(
        v.arbitrator.toLowerCase(),
        deployment.arbitrator.toLowerCase(),
        "Bound arbitrator",
      );
      eq(
        [...history].map((x) => x.toLowerCase()),
        s.stakerHistory.map((x) => x.toLowerCase()),
        "Lifetime history",
      );
      const statuses = await Promise.all(
        history.map((wallet) => c.status(wallet, at)),
      );
      for (const [field, allowed] of [
        ["activeStakers", [1]],
        ["stakers", [1, 2]],
      ])
        eq(
          s[field].map((wallet) => wallet.toLowerCase()),
          history
            .filter((_, i) => allowed.includes(Number(statuses[i])))
            .map((wallet) => wallet.toLowerCase()),
          `On-chain ${field}`,
        );
      eq(
        [...attendees].map((x) => x.toLowerCase()),
        s.attendees.map((x) => x.toLowerCase()),
        "Attendance list",
      );
      eq(s.lifetimeAdmittedCount, history.length, "Lifetime admission count");
      eq(
        s.remainingAdmissionSlots,
        150 - history.length,
        "Lifetime admission slots",
      );
      eq(
        s.poolWei,
        (v.stakerCount * v.depositAmount).toString(),
        "Original committed pool, not unpaid balance",
      );
      const cases = [];
      const resolver = new ethers.Contract(
        deployment.resolver,
        [
          "function disputes(uint256) view returns(bytes arbitratorExtraData,bool isRuled,uint256 ruling,uint256 disputeIDOnArbitratorSide)",
        ],
        provider,
      );
      for (const wallet of challengers) {
        const on = await c.challenges(wallet, at);
        const api = s.cases.find((item) => same(item.wallet, wallet));
        assert.ok(api);
        checks++;
        const matched = !same(on.matcher, ethers.ZeroAddress);
        eq(api.state, CASES[Number(on.state)], "Case state");
        eq(api.matched, matched, "Matched identity");
        for (const [field, value] of Object.entries({
          matcher: on.matcher,
          matchEndsAt: Number(on.matchEndsAt),
          depositWei: on.deposit.toString(),
          heldShareWei: on.heldShare.toString(),
          caseOrganizer: await c.caseOrganizer(wallet, at),
        }))
          eq(api[field], value, field);
        eq(
          api.localDisputeID,
          matched ? on.localDisputeID.toString() : null,
          "Local ID0 exists only for a matched case",
        );
        eq(
          api.arbitratorDisputeID,
          matched ? on.arbitratorDisputeID.toString() : null,
          "Court ID",
        );
        let finalRuling = null;
        if (matched && Number(on.state) >= 2) {
          const resolved = await resolver.disputes(on.localDisputeID, at);
          eq(
            resolved.disputeIDOnArbitratorSide.toString(),
            on.arbitratorDisputeID.toString(),
            "Resolver/Court ID linkage",
          );
          finalRuling = resolved.isRuled ? Number(resolved.ruling) : null;
          eq(
            api.caseURI,
            (await c.caseMetaEvidence(wallet, at))[1],
            "Immutable case evidence URI",
          );
        }
        eq(
          api.finalRuling,
          finalRuling,
          "Only delivered final ruling, including0",
        );
        cases.push({
          ...api,
          arbitrationPaidWei: on.arbitrationPaid.toString(),
        });
      }
      eq(
        s.cases.length,
        challengers.length,
        "All case records are scoped to this event",
      );
      eq(
        Number(v.pendingChallenges),
        cases.filter((item) => ["Waiting", "Disputed"].includes(item.state))
          .length,
        "Pending case count",
      );
      const escrow = sum(
        cases.map((item) =>
          item.state === "Waiting"
            ? item.depositWei
            : item.state === "Disputed"
              ? 2n * BigInt(item.depositWei) - BigInt(item.arbitrationPaidWei)
              : 0n,
        ),
      );
      eq(
        escrow.toString(),
        s.challengeEscrowWei,
        "Independent challenge collateral",
      );
      eq(
        sum(cases.map((item) => item.heldShareWei)).toString(),
        s.heldBackWei,
        "Individual held shares sum",
      );
      const reserve =
        (Number(phase) <= 1 ? v.stakerCount * v.depositAmount : v.heldBack) +
        v.pendingTotal +
        v.owedTotal +
        escrow;
      eq(reserve.toString(), s.reservedWei, "Independent reserve formula");
      assert.ok(balance >= reserve, "Balance covers protected liabilities");
      checks++;
      eq((balance - reserve).toString(), s.spareWei, "Only surplus is spare");
      const logs = [];
      for (
        let from = deployment.deploymentBlock;
        from <= block.number;
        from += 2500
      )
        logs.push(
          ...(await provider.getLogs({
            address: c.target,
            fromBlock: from,
            toBlock: Math.min(from + 2499, block.number),
          })),
        );
      const known = [];
      for (const log of logs) {
        try {
          const parsed = c.interface.parseLog(log);
          if (parsed) known.push({ log, parsed });
        } catch {}
      }
      known.sort(
        (a, b) =>
          a.log.blockNumber - b.log.blockNumber || a.log.index - b.log.index,
      );
      const receipts = new Map();
      const operations = [];
      const expectedTransfers = [];
      const registered = new Set();
      const rejected = new Map();
      const totals = {
        attendance: 0n,
        failed: 0n,
        claimed: 0n,
        pending: 0n,
        successful: 0n,
      };
      for (const { log, parsed } of known) {
        let proof = receipts.get(log.transactionHash);
        if (!proof) {
          const [receipt, tx, canonical] = await Promise.all([
            provider.getTransactionReceipt(log.transactionHash),
            provider.getTransaction(log.transactionHash),
            provider.getBlock(log.blockNumber),
          ]);
          eq(receipt.status, 1, "Canonical successful event receipt");
          eq(receipt.blockHash, log.blockHash, "Receipt/log block");
          eq(canonical.hash, log.blockHash, "Receipt remains canonical");
          let method = null;
          try {
            if (same(tx.to, c.target))
              method = c.interface.parseTransaction({
                data: tx.data,
                value: tx.value,
              }).name;
          } catch {}
          const names = receipt.logs
            .filter((item) => same(item.address, c.target))
            .flatMap((item) => {
              try {
                return [c.interface.parseLog(item).name];
              } catch {
                return [];
              }
            });
          proof = {
            txHash: log.transactionHash,
            blockNumber: receipt.blockNumber,
            blockHash: receipt.blockHash,
            from: tx.from,
            to: tx.to,
            valueWei: tx.value.toString(),
            method,
            names,
          };
          receipts.set(log.transactionHash, proof);
        }
        operations.push({
          event: parsed.name,
          ...proof,
          logIndex: log.index,
          args: [...parsed.args].map((value) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        });
        const a = parsed.args;
        const row = {
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          sourceMethod: proof.method,
          successful: true,
        };
        let payment = null;
        if (parsed.name === "StakerRegistered")
          registered.add(a.staker.toLowerCase());
        if (parsed.name === "Rejected") {
          rejected.set(log.transactionHash, {
            wallet: a.wallet.toLowerCase(),
            amount: a.refunded,
            registered: registered.has(a.wallet.toLowerCase()),
          });
          registered.delete(a.wallet.toLowerCase());
        }
        if (parsed.name === "Payout") {
          const rejection = rejected.get(log.transactionHash);
          let type = "unclassified-payout";
          if (
            rejection &&
            same(rejection.wallet, a.to) &&
            rejection.amount === a.amount
          ) {
            type = rejection.registered
              ? "registered-principal-refund"
              : "unregistered-deposit-return";
            rejected.delete(log.transactionHash);
          } else if (
            proof.method === "cancel" ||
            proof.names.includes("Cancelled")
          )
            type = "registered-principal-refund";
          else if (
            ["releasePayouts", "resolveChallenge"].includes(proof.method) ||
            proof.names.some((name) =>
              ["Finalized", "ChallengeResolved"].includes(name),
            )
          )
            type = "attendance-payout";
          payment = {
            type,
            wallet: a.to,
            recipient: a.to,
            amountWei: a.amount.toString(),
          };
        } else if (parsed.name === "PayoutFailed") {
          payment = {
            type: "failed-credit",
            wallet: a.to,
            recipient: a.to,
            amountWei: a.amount.toString(),
            successful: false,
          };
          const rejection = rejected.get(log.transactionHash);
          if (
            rejection &&
            same(rejection.wallet, a.to) &&
            rejection.amount === a.amount
          )
            rejected.delete(log.transactionHash);
        } else if (parsed.name === "Claimed")
          payment = {
            type: "owed-claim",
            wallet: a.account,
            recipient: a.to,
            amountWei: a.amount.toString(),
          };
        else if (parsed.name === "PendingWithdrawn")
          payment = {
            type: "pending-credit-withdrawal",
            wallet: a.payer,
            recipient: a.to,
            amountWei: a.amount.toString(),
          };
        else if (parsed.name === "EmergencyWithdrawn") {
          payment = {
            type: "registered-no-list-refund",
            wallet: a.staker,
            recipient: null,
            amountWei: a.amount.toString(),
          };
          registered.delete(a.staker.toLowerCase());
        } else if (["Refunded", "Swept"].includes(parsed.name))
          payment = {
            type: parsed.name === "Refunded" ? "spare-refund" : "spare-sweep",
            wallet: a.to,
            recipient: a.to,
            amountWei: a.amount.toString(),
          };
        if (payment) expectedTransfers.push({ ...row, ...payment });
        if (parsed.name === "Payout") {
          totals.successful += parsed.args.amount;
          if (
            ["releasePayouts", "resolveChallenge"].includes(proof.method) ||
            proof.names.some((name) =>
              ["Finalized", "ChallengeResolved"].includes(name),
            )
          )
            totals.attendance += parsed.args.amount;
        }
        if (parsed.name === "PayoutFailed") totals.failed += parsed.args.amount;
        if (parsed.name === "Claimed") {
          totals.claimed += parsed.args.amount;
          totals.successful += parsed.args.amount;
        }
        if (parsed.name === "PendingWithdrawn") {
          totals.pending += parsed.args.amount;
          totals.successful += parsed.args.amount;
        }
        if (["EmergencyWithdrawn", "Refunded", "Swept"].includes(parsed.name))
          totals.successful += parsed.args.amount;
      }
      eq(
        d.payments.attendancePaidWei,
        totals.attendance.toString(),
        "Log-backed direct attendance payments",
      );
      reconcileTransfers(d.payments.transfers, expectedTransfers);
      checks++;
      eq(
        d.payments.failedPaymentsWei,
        totals.failed.toString(),
        "Failures are credits, not sent",
      );
      eq(
        d.payments.claimedWei,
        totals.claimed.toString(),
        "Claimed credit separately indexed",
      );
      eq(
        d.payments.pendingCreditWithdrawnWei,
        totals.pending.toString(),
        "Pending withdrawal is not kickback",
      );
      eq(
        d.payments.totalExplicitSuccessfulTransfersWei,
        totals.successful.toString(),
        "Explicit logged native deliveries",
      );
      eq(
        (totals.failed - totals.claimed).toString(),
        s.owedTotalWei,
        "Indexed owed liability",
      );
      eq(
        (await provider.getBlock(block.number)).hash,
        block.hash,
        "Snapshot remained canonical",
      );
      const head = await provider.getBlock("latest");
      assert.ok(
        head.number >= block.number &&
          head.number - block.number <= 20 &&
          head.timestamp - block.timestamp <= 90,
        "API snapshot is near current chain head",
      );
      checks++;
      if (head.number > block.number)
        eq(
          (
            await provider.getLogs({
              address: [c.target, deployment.resolver, deployment.arbitrator],
              fromBlock: block.number + 1,
              toBlock: head.number,
            })
          ).length,
          0,
          "No newer protocol activity omitted by API snapshot; refresh if this fails",
        );
      eq(
        (await c.challengeDeposit({ blockTag: head.number })).toString(),
        s.challengeDepositWei,
        "Current challenge amount still matches UI, including eventless fee changes",
      );
      const [headBalance, headReserved, headSpare] = await Promise.all([
        provider.getBalance(c.target, head.number),
        c.reserved({ blockTag: head.number }),
        c.spare({ blockTag: head.number }),
      ]);
      eq(
        headBalance.toString(),
        s.balanceWei,
        "Current custody still agrees, including forced ETH without child logs",
      );
      eq(
        headReserved.toString(),
        s.reservedWei,
        "Current reserve still agrees",
      );
      eq(headSpare.toString(), s.spareWei, "Current surplus still agrees");
      eq(
        (await provider.getBlock(head.number)).hash,
        head.hash,
        "Head comparison remains canonical",
      );
      const roles = {};
      for (const [role, wallet] of Object.entries(
        manifest.rehearsalAddresses,
      )) {
        const [status, attended, pending, owed] = await Promise.all([
          c.status(wallet, at),
          c.attended(wallet, at),
          c.pendingDeposits(wallet, at),
          c.owed(wallet, at),
        ]);
        roles[role] = {
          wallet,
          status: Number(status),
          attended,
          pendingWei: String(pending),
          owedWei: String(owed),
        };
      }
      const current = {
        state: s,
        payments: d.payments,
        roles,
        expectedUi: expectedUi({
          ...s,
          eventStart: Number(v.eventStart),
          arbitrationMode: manifest.arbitration.mode,
        }),
      };
      assertDPhase(
        checkpoint,
        current,
        manifest.rehearsalAddresses,
        deployment.depositWei,
      );
      checks++;
      events.push({
        roles,
        eventId: d.event.id,
        contract: c.target,
        blockNumber: block.number,
        blockHash: block.hash,
        now: block.timestamp,
        observedHead: {
          blockNumber: head.number,
          blockHash: head.hash,
          now: head.timestamp,
        },
        state: s,
        expectedUi: expectedUi({
          ...s,
          eventStart: Number(v.eventStart),
          arbitrationMode: manifest.arbitration.mode,
        }),
        payments: d.payments,
        operations,
      });
    }
    const manifestSha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      status: "passed-current-checkpoint",
      checkedAt: new Date().toISOString(),
      origin: scope.origin,
      scenario,
      manifestFile: scope.manifest,
      chainId: 10200,
      arbitration: "controlled",
      instanceId: boot.instanceId,
      manifestSha256,
      checkpoint,
      planId: manifest.planId,
      planFingerprint: manifest.planFingerprint,
      checks,
      readOnly: true,
      signatures: 0,
      broadcasts: 0,
      observerSha256: OBSERVER_SHA256,
      observerFiles: OBSERVER_FILES,
      events,
      notice:
        "This observer verifies public API and canonical chain facts. UI initiation, screenshots and authenticated role assertions are separate evidence; this GET/RPC-only observer does not establish browser initiation or collateral delivery. Waiting stages are not completed.",
    };
  } finally {
    provider.destroy();
  }
}

export function parseDObserverArgs(argv) {
  const allowed = new Set([
    "--phase",
    "--manifest-sha256",
    "--plan-id",
    "--plan-fingerprint",
    "--origin",
    "--event-id",
    "--contract",
    "--rpc-url",
  ]);
  assert.equal(
    argv.length % 2,
    0,
    "Every observer option needs an explicit value",
  );
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    assert.ok(
      allowed.has(argv[i]) && !Object.hasOwn(args, argv[i]),
      "Unknown or duplicate observer option",
    );
    args[argv[i]] = argv[i + 1];
  }
  for (const option of [...allowed].filter((x) => x !== "--rpc-url"))
    assert.ok(args[option], `Required public pin ${option}`);
  assert.ok(PHASE_NAMES.includes(args["--phase"]));
  return {
    phase: args["--phase"],
    rpcUrl: args["--rpc-url"],
    expected: {
      manifestSha256: args["--manifest-sha256"],
      planId: args["--plan-id"],
      planFingerprint: args["--plan-fingerprint"],
      origin: args["--origin"],
      eventId: args["--event-id"],
      contract: args["--contract"],
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const directory = path.join(ROOT, "artifacts/chiado-ui-d-flow-audit");
  const filename = path.join(
    directory,
    new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomUUID() +
      ".json",
  );
  let result;
  try {
    result = await auditD(parseDObserverArgs(process.argv.slice(2)));
  } catch (error) {
    process.exitCode = 1;
    result = {
      status: "failed-current-checkpoint",
      checkedAt: new Date().toISOString(),
      readOnly: true,
      signatures: 0,
      broadcasts: 0,
      observerSha256: OBSERVER_SHA256,
      observerFiles: OBSERVER_FILES,
      error: {
        name: error.name,
        message: error.shortMessage ?? error.message,
        code: error.code ?? null,
      },
    };
  }
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filename, textJson(result), { flag: "wx" });
  const latest = path.join(ROOT, "artifacts/chiado-ui-d-flow-status.json");
  const pointer = {
    ...result,
    proofFile: path.relative(ROOT, filename),
    proofSha256: sha(fs.readFileSync(filename)),
  };
  const temporary = latest + "." + randomUUID() + ".tmp";
  fs.writeFileSync(temporary, textJson(pointer), { flag: "wx" });
  fs.renameSync(temporary, latest);
  console.log(
    textJson({
      status: result.status,
      checkpoint: result.checkpoint ?? null,
      checks: result.checks ?? 0,
      proofFile: path.relative(ROOT, filename),
      proofSha256: pointer.proofSha256,
      error: result.error ?? null,
    }),
  );
}
