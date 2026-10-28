import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ethers } from "ethers";
import {
  ROOT,
  EXTRA,
  readJson,
  publicJson,
  atomicJson,
  sha256,
  fingerprint,
  acquireLock,
  loadJournal,
  sendOnce,
  assertTestnet,
  verifyCompiledInputs,
} from "../src/testnet-config.mjs";
import {
  UI_C,
  validateUiCPlan,
  validateUiOrigin,
  verifyUiCStack,
  uiCCreateRequest,
} from "../scripts/testnet-ui-scenario.mjs";
import { factoryEventId } from "../src/contracts-v8.mjs";
import { hash as contentHash } from "../src/utils.mjs";
import {
  assertUiDepositDraft,
  assertUiDepositRequest,
  assertUiDepositReadiness,
} from "../scripts/chiado-ui-deposit-guards.mjs";

// MANUAL OPERATOR ONLY. No automatic execution, preparation or resource creation.
// Default and --self-test never read signing/runtime files or access the network.
// UI_C_EXECUTE=1 UI_C_APP_URL=https://EXACT_SEPARATE_C_SITE \
//   node test/testnet-ui-c.e2e.mjs --stage deposits
// A recorded action always stops. Inspect its existing receipt; never replay it.
export const C_STAGES = Object.freeze([
  "deposits",
  "admit",
  "attendance",
  "challenge",
  "match",
  "payout",
  "settle",
]);
const ABI = new ethers.Interface([
  "function deposit() payable",
  "function registerStakers(address[])",
  "function postAttendance(address[],uint256)",
  "function challenge() payable",
  "function matchChallenge(address) payable",
  "function releasePayouts()",
  "function resolveChallenge(address)",
]);
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const isHash = (v) => /^0x[0-9a-f]{64}$/i.test(v ?? "");
class UiCFailure extends Error {}
const check = (ok, message) => {
  if (!ok) throw new UiCFailure(message);
};
const exactKeys = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const normalized = (v) => JSON.parse(publicJson(v));
function quantity(v) {
  check(
    typeof v === "bigint" ||
      (typeof v === "number" && Number.isSafeInteger(v)) ||
      (typeof v === "string" && /^(0x[0-9a-f]+|[0-9]+)$/i.test(v)),
    "Exact integer quantity required.",
  );
  const n = BigInt(v);
  check(n >= 0n && n < 1n << 256n, "Quantity must fit uint256.");
  return n;
}
const contact = (role) => ({
  name: `Synthetic UI C ${role === "alice" ? "Alice" : "Bob"}`,
  email: `ui-c-${role}@example.test`,
});

// Netlify's static, non-executable hosting disclosure for this exact C site.
// The badge script is disabled at the site. No script/DOM changes are allowed.
export const C_NETLIFY_COMMENT = `<!-- This site is hosted on Netlify. Anyone can build and deploy a site
     like this one for free: https://netlify.new/?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=db303622-4c6c-4034-b289-ccea38f029fc
     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->
`;
export function assertPublishedAsset(body, pathname, expectedHash) {
  const bytes = Buffer.from(body),
    publishedHash = sha256(bytes);
  const audit = {
    pathname,
    publishedSha256: publishedHash,
    expectedSha256: expectedHash,
    verifiedSha256: publishedHash,
    transform: "none",
    removedBytes: 0,
  };
  if (publishedHash === expectedHash) return audit;
  const fail = () => {
    throw Object.assign(
      new UiCFailure(
        "Published browser asset differs from reviewed source; writes disabled.",
      ),
      { code: "STATIC_SOURCE_MISMATCH" },
    );
  };
  if (!["/", "/index.html"].includes(pathname)) fail();
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail();
  }
  const anchor = '<meta charset="utf-8" />\n';
  const at = html.indexOf(anchor);
  if (
    at < 0 ||
    html.indexOf(C_NETLIFY_COMMENT) !== at + anchor.length ||
    html.split(C_NETLIFY_COMMENT).length !== 2
  )
    fail();
  const verifiedHash = sha256(html.replace(C_NETLIFY_COMMENT, ""));
  if (verifiedHash !== expectedHash) fail();
  return {
    ...audit,
    verifiedSha256: verifiedHash,
    transform: "strip-exact-c-netlify-hosting-comment-for-hash-only",
    exception: "C-Netlify-static-comment-v1",
    locationByteOffset: Buffer.byteLength(html.slice(0, at + anchor.length)),
    removedBytes: Buffer.byteLength(C_NETLIFY_COMMENT),
    removedSha256: sha256(C_NETLIFY_COMMENT),
    delivered:
      "unchanged published response; only an HTML comment excluded from byte comparison",
  };
}

export function singleAttemptConnection(url, fetchTransport = fetch) {
  const connection = new ethers.FetchRequest(url);
  connection.timeout = 30_000;
  connection.setThrottleParams({ maxAttempts: 1 });
  connection.retryFunc = async () => false;
  // Ethers redirects create a new FetchRequest and can lose its retry settings.
  // Resolve the HTTP exchange here so a redirect can never forward signed bytes.
  connection.getUrlFunc = async (request) => {
    check(request.url === url, "RPC transport URL changed.");
    const response = await fetchTransport(url, {
      method: request.method,
      headers: request.headers,
      ...(request.body ? { body: request.body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    check(
      response.status === 200,
      "RPC HTTP error/redirect refused without retry.",
    );
    return {
      statusCode: response.status,
      statusMessage: response.statusText,
      headers: Object.fromEntries(response.headers),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  };
  return connection;
}

export function operationFor(stage, role, scope, state) {
  check(C_STAGES.includes(stage), "Unknown C UI stage.");
  if (stage === "deposits") {
    check(
      ["alice", "bob"].includes(role),
      "Deposit role must be Alice or Bob.",
    );
    return {
      journalAction: `ui-c-deposit-${role}`,
      action: "deposit",
      method: "deposit",
      args: [],
      value: quantity(scope.depositWei),
      role,
    };
  }
  check(
    role === (stage === "challenge" ? "bob" : "owner"),
    "Wrong C stage signing role.",
  );
  const definitions = {
    admit: ["register", "registerStakers", [[scope.alice, scope.bob]], 0n],
    attendance: [
      "postAttendance",
      "postAttendance",
      [[scope.alice], String(2n * quantity(scope.depositWei))],
      0n,
    ],
    challenge: [
      "challenge",
      "challenge",
      [],
      quantity(state.challengeDepositWei),
    ],
    match: [
      "match",
      "matchChallenge",
      [scope.bob],
      quantity(state.bobCase.deposit),
    ],
    payout: ["release", "releasePayouts", [], 0n],
    settle: ["resolve", "resolveChallenge", [scope.bob], 0n],
  };
  const [action, method, args, value] = definitions[stage];
  const suffix = {
    admit: "register",
    attendance: "post-attendance",
    challenge: "challenge-bob",
    match: "match-bob",
    payout: "release-payouts",
    settle: "resolve-bob",
  }[stage];
  return { journalAction: `ui-c-${suffix}`, action, method, args, value, role };
}

export function assertStageState(stage, role, s, scope, existing) {
  check(
    existing === undefined,
    "An existing journal action permits receipt inspection only. Never replay this UI action.",
  );
  const d = quantity(scope.depositWei);
  check(
    scope.chainId === 10200 &&
      d === 1_000_000_000_000n &&
      same(s.owner, scope.owner),
    "Only the exact C owner, chain and deposit are authorized.",
  );
  check(
    s.pendingTotal ===
      String(quantity(s.pending.alice) + quantity(s.pending.bob)),
    "Unknown payer credit changes the reviewed C fixture.",
  );
  if (stage === "deposits") {
    assertUiDepositReadiness(
      { phase: s.phase, now: s.now, depositWei: scope.depositWei },
      { ...scope, wallet: scope[role], valueWei: scope.depositWei },
      existing,
    );
    check(
      s.status[role] === 0 && s.pending[role] === "0" && s.stakerCount === 0,
      "Each fresh C UI deposit requires an unregistered wallet with no prior credit.",
    );
    check(
      ["0", String(d)].includes(s.pending[role === "alice" ? "bob" : "alice"]),
      "Other C payer credit is unexpected.",
    );
    return;
  }
  if (["admit", "attendance"].includes(stage))
    check(s.phase === "Open", "C must still be Open.");
  if (stage === "admit") {
    check(
      s.now < scope.eventStart &&
        s.stakerCount === 0 &&
        s.status.alice === 0 &&
        s.status.bob === 0 &&
        s.pending.alice === String(d) &&
        s.pending.bob === String(d),
      "Both exact UI deposits must precede registration and event start.",
    );
    return;
  }
  check(
    s.stakerCount === 2 && s.pendingTotal === "0",
    "Exactly two C principals and zero unused credit are required.",
  );
  if (stage === "attendance") {
    check(
      s.now >= scope.eventStart &&
        Number.isSafeInteger(scope.eventEnd) &&
        s.now <= scope.eventEnd &&
        s.now <= scope.claimDeadline &&
        s.status.alice === 1 &&
        s.status.bob === 1 &&
        s.attendeeCount === 0 &&
        s.bobCase.state === 0,
      "Attendance requires actual event hours and both admitted stakers.",
    );
    return;
  }
  if (["challenge", "match", "payout"].includes(stage))
    check(
      s.phase === "Listed" && s.attended.alice && !s.attended.bob,
      "Alice must be listed while the same Bob UI depositor is omitted.",
    );
  if (stage === "challenge")
    check(
      s.status.bob === 1 &&
        s.bobCase.state === 0 &&
        s.now <= s.challengeEndsAt &&
        quantity(s.challengeDepositWei) === 30_000_000_000n,
      "Bob's omission challenge must be fresh and inside the unchanged challenge window.",
    );
  if (stage === "match")
    check(
      s.bobCase.state === 1 &&
        s.now <= s.bobCase.matchEndsAt &&
        quantity(s.bobCase.deposit) === quantity(s.challengeDepositWei),
      "Only Bob's current Waiting challenge can be matched in time.",
    );
  if (stage === "payout")
    check(
      s.now > s.challengeEndsAt &&
        s.bobCase.state === 2 &&
        s.bobCase.finalRuling === null &&
        s.heldBack === "0",
      "Ordinary payouts require the natural deadline with Bob still unruled.",
    );
  if (stage === "settle")
    check(
      s.phase === "Finalized" &&
        s.bobCase.state === 2 &&
        s.bobCase.finalRuling === 1 &&
        s.bobCase.heldShare === String(d) &&
        s.heldBack === String(d),
      "Settlement requires an actual final attended ruling and Bob's full held share after the ordinary batch.",
    );
}

export function assertWalletRequest(request, op, scope) {
  check(
    exactKeys(request, ["from", "to", "data", "value", "chainId"]),
    "Unexpected wallet transaction fields refused.",
  );
  check(
    quantity(request.chainId) === 10200n &&
      same(request.from, scope[op.role]) &&
      same(request.to, scope.contract) &&
      quantity(request.value) === op.value &&
      same(request.data, ABI.encodeFunctionData(op.method, op.args)),
    "Wallet request differs from the exact reviewed C method, arguments, payer, child, chain or value.",
  );
  if (op.action === "deposit")
    assertUiDepositRequest(request, {
      ...scope,
      wallet: scope[op.role],
      valueWei: scope.depositWei,
    });
  return {
    from: ethers.getAddress(scope[op.role]),
    to: ethers.getAddress(scope.contract),
    data: ABI.encodeFunctionData(op.method, op.args),
    value: op.value,
    chainId: 10200,
  };
}

export function assertDraft(draft, op, scope, now = Date.now()) {
  check(
    typeof draft?.id === "string" &&
      draft.id.length > 0 &&
      draft.eventId === scope.eventId &&
      draft.action === op.action &&
      draft.method === op.method &&
      draft.contractVersion === "kleros-event-v8" &&
      draft.abiVersion === "kleros-event-v8" &&
      same(draft.wallet, scope[op.role]) &&
      same(draft.contract, scope.contract) &&
      quantity(draft.chainId) === 10200n &&
      quantity(draft.valueWei) === op.value &&
      same(
        ABI.encodeFunctionData(op.method, draft.args),
        ABI.encodeFunctionData(op.method, op.args),
      ),
    "Authoritative C draft differs from the reviewed operation.",
  );
  check(
    Number.isSafeInteger(draft.expiresAt) &&
      draft.expiresAt > now &&
      draft.expiresAt <= now + 301000 &&
      /^[0-9a-f]{64}$/i.test(draft.snapshot ?? ""),
    "A fresh snapshot-bound draft is required.",
  );
  assertWalletRequest(draft.transaction, op, scope);
  if (op.action === "deposit")
    assertUiDepositDraft(
      draft,
      { ...scope, wallet: scope[op.role], valueWei: scope.depositWei },
      now,
    );
  return draft;
}

export function assertNonce(challenge, wallet, origin, now = Date.now()) {
  check(
    /^[0-9a-f]{40}$/i.test(challenge?.nonce ?? "") &&
      Number.isSafeInteger(challenge.expiresAt) &&
      challenge.expiresAt > now &&
      challenge.expiresAt <= now + 301000,
    "Fresh exact server-issued C nonce required.",
  );
  const message = `Kleros Chiado testnet workbench\nDomain: ${new URL(origin).host}\nURI: ${origin}\nChain ID: 10200\nWallet: ${ethers.getAddress(wallet)}\nNonce: ${challenge.nonce}\nExpires: ${new Date(challenge.expiresAt).toISOString()}\nAuthenticate this testnet wallet. No financial transaction.`;
  check(
    challenge.message === message,
    "Nonce origin, chain, wallet or purpose differs from C.",
  );
  return message;
}

export function assertBootstrap(data, manifest, instanceId) {
  const record = manifest.events[0],
    event = data.events?.[0];
  check(
    data.mode === "hosted-testnet" &&
      data.chain?.chainId === 10200 &&
      data.chain.rpcUrl === manifest.chain.rpcUrl &&
      data.chain.nativeCurrency?.symbol === "XDAI" &&
      data.arbitration?.mode === "controlled" &&
      /controll|no independent jury/i.test(data.arbitration.notice ?? "") &&
      data.capabilities?.sharedDemo === false &&
      data.capabilities?.createEvents === false &&
      data.capabilities?.timeControls === false &&
      data.identities?.length === 0 &&
      data.events?.length === 1 &&
      event.id === record.definition.id &&
      event.startsAt === record.definition.startsAt &&
      event.endsAt === record.definition.endsAt &&
      same(event.contract, record.deployment.contract) &&
      event.chainId === 10200 &&
      event.contractVersion === "kleros-event-v8" &&
      event.abiVersion === "kleros-event-v8",
    "C readiness/registry/controlled-arbitration proof differs from the exact single-event hosted testnet deployment.",
  );
  check(
    typeof data.instanceId === "string" &&
      data.instanceId.length > 0 &&
      (!instanceId || data.instanceId === instanceId),
    "Backend instance changed or is missing. Stop before signing.",
  );
  return data;
}

export function assertPlanDeployment(
  record,
  plan,
  journal,
  creation,
  creationCodeHash,
) {
  const d = record.deployment,
    entry = journal.transactions[`create-${plan.event.id}`];
  check(
    entry?.state === "confirmed" &&
      isHash(entry.hash) &&
      d.deploymentTxHash === entry.hash &&
      d.deploymentBlock === entry.blockNumber &&
      entry.expected?.from === plan.addresses.owner.toLowerCase() &&
      entry.expected.to === plan.factory.toLowerCase() &&
      entry.expected.value === "0" &&
      entry.expected.data === creation.request.data,
    "C child creation must be the exact confirmed once-journaled factory operation, not a declared manifest fingerprint.",
  );
  check(
    d.eventId === plan.event.id &&
      record.definition.id === plan.event.id &&
      Number.isSafeInteger(plan.event.eventEnd) &&
      plan.event.eventEnd === plan.event.eventStart + 12 * 3600 &&
      record.definition.startsAt ===
        new Date(plan.event.eventStart * 1000).toISOString() &&
      record.definition.endsAt ===
        new Date(plan.event.eventEnd * 1000).toISOString() &&
      d.chainId === 10200 &&
      d.contractVersion === "kleros-event-v8" &&
      d.abiVersion === "kleros-event-v8" &&
      same(d.owner, plan.addresses.owner) &&
      same(d.creator, plan.addresses.owner) &&
      same(d.factory, plan.factory) &&
      d.factoryCodeHash === plan.factoryCodeHash &&
      same(d.resolver, plan.arbitration.resolver) &&
      same(d.arbitrator, plan.arbitration.arbitrator) &&
      d.arbitratorExtraData === EXTRA &&
      d.policyURI === plan.policy.uri &&
      d.depositWei === plan.depositWei &&
      d.eventName === plan.event.title &&
      d.eventStart === plan.event.eventStart &&
      d.depositDeadline === plan.event.eventStart &&
      d.claimDeadline === plan.event.claimDeadline &&
      d.eventKey === plan.event.eventKey &&
      d.configurationHash === creation.configurationHash &&
      d.creationCodeHash === creationCodeHash &&
      d.factoryEventId ===
        factoryEventId({
          chainId: 10200,
          factory: plan.factory,
          creator: plan.addresses.owner,
          eventKey: plan.event.eventKey,
        }) &&
      publicJson(record.pieces) === publicJson(creation.template.pieces) &&
      publicJson(record.slots) === publicJson(creation.template.slots) &&
      d.templateHash ===
        contentHash([creation.template.pieces, creation.template.slots]) &&
      sha256(record.policy) === plan.policy.sha256,
    "C deployment owner, creator, stack, policy, template, factory key/configuration and creation code must match its exact plan.",
  );
  return entry;
}

export function assertCasePair(challenge, dispute, mappedLocal) {
  check(
    quantity(dispute.disputeIDOnArbitratorSide) ===
      quantity(challenge.arbitratorDisputeID) &&
      quantity(mappedLocal) === quantity(challenge.localDisputeID) &&
      typeof dispute.isRuled === "boolean" &&
      (!dispute.isRuled || [0, 1, 2].includes(Number(dispute.ruling))),
    "Dynamic resolver/arbitrator case pair does not match C's Bob challenge.",
  );
  return {
    localDisputeID: String(challenge.localDisputeID),
    arbitratorDisputeID: String(challenge.arbitratorDisputeID),
    finalRuling: dispute.isRuled ? Number(dispute.ruling) : null,
  };
}

export async function stateOf(c, provider, scope, resolver) {
  const block = await provider.getBlock("latest"),
    at = { blockTag: block.number };
  const names = [
    "phase",
    "owner",
    "pendingOwner",
    "stakerCount",
    "attendeeCount",
    "pendingTotal",
    "pendingChallenges",
    "heldBack",
    "reserved",
    "owedTotal",
    "challengeEscrow",
    "payoutShare",
    "challengeEndsAt",
    "challengeDeposit",
    "stakers",
    "attendees",
  ];
  const values = await Promise.all(names.map((n) => c[n](at)));
  const raw = Object.fromEntries(names.map((n, i) => [n, values[i]]));
  const people = await Promise.all(
    ["alice", "bob"].map(async (role) => ({
      role,
      status: Number(await c.status(scope[role], at)),
      pending: String(await c.pendingDeposits(scope[role], at)),
      owed: String(await c.owed(scope[role], at)),
      attended: await c.attended(scope[role], at),
      balance: String(await provider.getBalance(scope[role], block.number)),
    })),
  );
  const challenge = await c.challenges(scope.bob, at);
  let pair = null;
  if (
    Number(challenge.state) >= 2 &&
    !same(challenge.matcher, ethers.ZeroAddress)
  ) {
    const dispute = await resolver.disputes(challenge.localDisputeID, at);
    pair = assertCasePair(
      challenge,
      dispute,
      await resolver.externalIDtoLocalID(challenge.arbitratorDisputeID, at),
    );
  }
  const contractBalance = await provider.getBalance(c.target, block.number);
  const canonical = await provider.getBlock(block.number);
  check(
    canonical?.hash === block.hash,
    "C snapshot reorganized during inspection.",
  );
  return {
    ...normalized(raw),
    phase: ["Open", "Listed", "Finalized", "Cancelled"][Number(raw.phase)],
    now: block.timestamp,
    indexedBlock: {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
    },
    stakerCount: Number(raw.stakerCount),
    attendeeCount: Number(raw.attendeeCount),
    challengeEndsAt: Number(raw.challengeEndsAt),
    challengeDepositWei: String(raw.challengeDeposit),
    balance: String(contractBalance),
    status: Object.fromEntries(people.map((p) => [p.role, p.status])),
    pending: Object.fromEntries(people.map((p) => [p.role, p.pending])),
    owed: Object.fromEntries(people.map((p) => [p.role, p.owed])),
    attended: Object.fromEntries(people.map((p) => [p.role, p.attended])),
    balances: Object.fromEntries(people.map((p) => [p.role, p.balance])),
    bobCase: {
      ...normalized(challenge.toObject()),
      ...pair,
      state: Number(challenge.state),
      matchEndsAt: Number(challenge.matchEndsAt),
      deposit: String(challenge.deposit),
      heldShare: String(challenge.heldShare),
      finalRuling: pair?.finalRuling ?? null,
    },
  };
}

export async function protectedFacts(record, provider, abi, addresses) {
  const c = new ethers.Contract(record.deployment.contract, abi, provider),
    block = await provider.getBlock("latest"),
    at = { blockTag: block.number };
  const names = [
    "phase",
    "owner",
    "pendingOwner",
    "stakerCount",
    "attendeeCount",
    "pendingTotal",
    "pendingChallenges",
    "heldBack",
    "reserved",
    "owedTotal",
    "challengeEscrow",
    "payoutShare",
    "stakers",
    "attendees",
    "challengers",
  ];
  const values = await Promise.all(names.map((n) => c[n](at)));
  const wallets = [
    ...new Set(Object.values(addresses).map((a) => a.toLowerCase())),
  ];
  const result = normalized({
    contract: c.target,
    ...Object.fromEntries(names.map((n, i) => [n, values[i]])),
    balance: await provider.getBalance(c.target, block.number),
    wallets: await Promise.all(
      wallets.map(async (wallet) => ({
        wallet,
        status: await c.status(wallet, at),
        pending: await c.pendingDeposits(wallet, at),
        owed: await c.owed(wallet, at),
        attended: await c.attended(wallet, at),
        challenge: (await c.challenges(wallet, at)).toObject(),
      })),
    ),
  });
  check(
    (await provider.getBlock(block.number))?.hash === block.hash,
    "Protected A/B snapshot reorganized during inspection.",
  );
  return {
    indexedBlock: {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
    },
    financial: result,
  };
}

function noRecordedActions(journal, operations) {
  for (const op of operations)
    check(
      !Object.hasOwn(journal.transactions, op.journalAction),
      `Journal already contains ${op.journalAction}; STOP and inspect its recorded receipt only. No re-sign, replay, replacement or reset.`,
    );
}

function assertSigned(raw, op, scope) {
  const tx = ethers.Transaction.from(raw);
  assertWalletRequest(
    {
      from: tx.from,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      chainId: tx.chainId,
    },
    op,
    scope,
  );
  check(
    tx.gasLimit <= 16_777_216n && tx.chainId === 10200n,
    "Signed C transaction exceeds chain/gas boundaries.",
  );
  return tx.hash;
}

export async function selfTest() {
  const address = (n) =>
    ethers.getAddress(`0x${n.toString(16).padStart(40, "0")}`);
  const scope = {
    chainId: 10200,
    eventId: "synthetic-c",
    origin: "https://c.example.test",
    contract: address(1),
    owner: address(2),
    alice: address(3),
    bob: address(4),
    depositWei: "1000000000000",
    depositOpensAt: 100,
    eventStart: 200,
    eventEnd: 200 + 12 * 3600,
    claimDeadline: 200 + 7 * 86400,
  };
  const base = {
    owner: scope.owner,
    phase: "Open",
    now: 150,
    status: { alice: 0, bob: 0 },
    pending: { alice: "0", bob: "0" },
    pendingTotal: "0",
    stakerCount: 0,
    attendeeCount: 0,
    heldBack: "0",
    attended: { alice: false, bob: false },
    challengeEndsAt: 300,
    challengeDepositWei: "30000000000",
    bobCase: {
      state: 0,
      deposit: "30000000000",
      matchEndsAt: 350,
      finalRuling: null,
      heldShare: "0",
      localDisputeID: "17",
      arbitratorDisputeID: "1017",
    },
  };
  let accepted = 0,
    rejected = 0;
  const refuse = (fn) => {
    assert.throws(fn);
    rejected++;
  };
  for (const stage of C_STAGES) {
    const role =
      stage === "deposits" ? "alice" : stage === "challenge" ? "bob" : "owner";
    const s = structuredClone(base);
    if (stage === "admit") {
      s.pending = { alice: scope.depositWei, bob: scope.depositWei };
      s.pendingTotal = "2000000000000";
    }
    if (
      ["attendance", "challenge", "match", "payout", "settle"].includes(stage)
    ) {
      s.stakerCount = 2;
      s.status = { alice: 1, bob: 1 };
      s.now = 210;
    }
    if (["challenge", "match", "payout", "settle"].includes(stage)) {
      s.phase = "Listed";
      s.attended.alice = true;
      s.attendeeCount = 1;
    }
    if (stage === "match") s.bobCase.state = 1;
    if (["payout", "settle"].includes(stage)) {
      s.bobCase.state = 2;
      s.now = 301;
    }
    if (stage === "settle") {
      s.phase = "Finalized";
      s.bobCase.finalRuling = 1;
      s.bobCase.heldShare = scope.depositWei;
      s.heldBack = scope.depositWei;
    }
    const op = operationFor(stage, role, scope, s);
    assertStageState(stage, role, s, scope);
    accepted++;
    const transaction = {
      from: scope[role],
      to: scope.contract,
      chainId: "0x27d8",
      value: ethers.toQuantity(op.value),
      data: ABI.encodeFunctionData(op.method, op.args),
    };
    const draft = {
      id: "synthetic",
      eventId: scope.eventId,
      action: op.action,
      method: op.method,
      args: op.args,
      wallet: scope[role],
      contract: scope.contract,
      chainId: 10200,
      valueWei: String(op.value),
      contractVersion: "kleros-event-v8",
      abiVersion: "kleros-event-v8",
      snapshot: "a".repeat(64),
      expiresAt: 61000,
      transaction,
    };
    assertDraft(draft, op, scope, 1000);
    accepted++;
    for (const patch of [
      { chainId: 1 },
      { to: address(99) },
      { from: address(99) },
      { value: String(op.value + 1n) },
      { data: "0x" },
      { nonce: 0 },
    ])
      refuse(() =>
        assertWalletRequest({ ...transaction, ...patch }, op, scope),
      );
    for (const patch of [
      { eventId: "other-c" },
      { expiresAt: 1000 },
      { snapshot: "" },
      { method: "cancel" },
      { args: [address(99)] },
    ])
      refuse(() => assertDraft({ ...draft, ...patch }, op, scope, 1000));
    refuse(() => assertStageState(stage, role, s, scope, { hash: "recorded" }));
  }
  refuse(() =>
    assertStageState(
      "payout",
      "owner",
      {
        ...base,
        phase: "Listed",
        stakerCount: 2,
        now: 300,
        pendingTotal: "0",
        attended: { alice: true, bob: false },
        bobCase: { ...base.bobCase, state: 2 },
      },
      scope,
    ),
  );
  const challenge = { nonce: "a".repeat(40), expiresAt: 61000 };
  challenge.message = `Kleros Chiado testnet workbench\nDomain: c.example.test\nURI: ${scope.origin}\nChain ID: 10200\nWallet: ${scope.alice}\nNonce: ${challenge.nonce}\nExpires: ${new Date(challenge.expiresAt).toISOString()}\nAuthenticate this testnet wallet. No financial transaction.`;
  assertNonce(challenge, scope.alice, scope.origin, 1000);
  accepted++;
  refuse(() => assertNonce(challenge, scope.bob, scope.origin, 1000));
  refuse(() =>
    assertNonce(challenge, scope.alice, "https://protected.example.test", 1000),
  );
  refuse(() =>
    validateUiOrigin(
      "https://protected.example.test",
      "https://protected.example.test",
    ),
  );
  const planned = {
    addresses: { owner: scope.owner, alice: scope.alice, bob: scope.bob },
    factory: address(8),
    factoryCodeHash: ethers.id("factory"),
    arbitration: { resolver: address(9), arbitrator: address(10) },
    event: {
      id: scope.eventId,
      title: "Synthetic C",
      eventKey: ethers.id(scope.eventId),
      eventStart: 200,
      eventEnd: scope.eventEnd,
      claimDeadline: scope.claimDeadline,
    },
    depositWei: scope.depositWei,
    policy: {
      uri: scope.origin + "/policy.md",
      sha256: sha256("synthetic policy"),
    },
  };
  const creation = {
    request: { data: "0x1234" },
    template: { pieces: ["synthetic"], slots: [0] },
    configurationHash: ethers.id("configuration"),
  };
  const codeHash = ethers.id("creation code"),
    creationHash = ethers.id("creation tx");
  const journal = {
    transactions: {
      [`create-${scope.eventId}`]: {
        state: "confirmed",
        hash: creationHash,
        blockNumber: 10,
        expected: {
          from: scope.owner.toLowerCase(),
          to: planned.factory.toLowerCase(),
          value: "0",
          data: creation.request.data,
        },
      },
    },
  };
  const record = {
    definition: {
      id: scope.eventId,
      startsAt: new Date(scope.eventStart * 1000).toISOString(),
      endsAt: new Date(scope.eventEnd * 1000).toISOString(),
    },
    policy: "synthetic policy",
    pieces: creation.template.pieces,
    slots: creation.template.slots,
    deployment: {
      eventId: scope.eventId,
      chainId: 10200,
      contractVersion: "kleros-event-v8",
      abiVersion: "kleros-event-v8",
      owner: scope.owner,
      creator: scope.owner,
      factory: planned.factory,
      factoryCodeHash: planned.factoryCodeHash,
      resolver: planned.arbitration.resolver,
      arbitrator: planned.arbitration.arbitrator,
      arbitratorExtraData: EXTRA,
      policyURI: planned.policy.uri,
      depositWei: scope.depositWei,
      eventName: planned.event.title,
      eventStart: 200,
      depositDeadline: 200,
      claimDeadline: scope.claimDeadline,
      eventKey: planned.event.eventKey,
      configurationHash: creation.configurationHash,
      creationCodeHash: codeHash,
      templateHash: "",
      factoryEventId: factoryEventId({
        chainId: 10200,
        factory: planned.factory,
        creator: scope.owner,
        eventKey: planned.event.eventKey,
      }),
      deploymentTxHash: creationHash,
      deploymentBlock: 10,
    },
  };
  record.deployment.templateHash = contentHash([record.pieces, record.slots]);
  assertPlanDeployment(record, planned, journal, creation, codeHash);
  accepted++;
  refuse(() =>
    assertPlanDeployment(
      {
        ...record,
        definition: {
          ...record.definition,
          endsAt: new Date((scope.eventEnd + 1) * 1000).toISOString(),
        },
      },
      planned,
      journal,
      creation,
      codeHash,
    ),
  );
  refuse(() =>
    assertStageState(
      "attendance",
      "owner",
      {
        ...base,
        now: scope.eventEnd + 1,
        stakerCount: 2,
        status: { alice: 1, bob: 1 },
      },
      scope,
    ),
  );
  for (const patch of [
    { owner: address(99) },
    { creator: address(99) },
    { resolver: address(99) },
    { policyURI: "https://wrong.example.test" },
    { eventKey: ethers.id("wrong") },
    { configurationHash: ethers.id("wrong") },
    { factoryEventId: ethers.id("wrong") },
    { templateHash: ethers.id("wrong") },
    { creationCodeHash: ethers.id("wrong") },
    { deploymentTxHash: ethers.id("wrong") },
    { depositDeadline: 201 },
  ])
    refuse(() =>
      assertPlanDeployment(
        { ...record, deployment: { ...record.deployment, ...patch } },
        planned,
        journal,
        creation,
        codeHash,
      ),
    );
  const pair = { localDisputeID: 17n, arbitratorDisputeID: 1017n },
    resolverRow = {
      disputeIDOnArbitratorSide: 1017n,
      isRuled: true,
      ruling: 1n,
    };
  assert.deepEqual(assertCasePair(pair, resolverRow, 17n), {
    localDisputeID: "17",
    arbitratorDisputeID: "1017",
    finalRuling: 1,
  });
  accepted++;
  refuse(() => assertCasePair(pair, resolverRow, 0n));
  refuse(() =>
    assertCasePair(
      pair,
      { ...resolverRow, disputeIDOnArbitratorSide: 1000n },
      17n,
    ),
  );
  const cManifest = {
    chain: { rpcUrl: "https://offline-rpc.example.test" },
    events: [
      {
        definition: {
          id: scope.eventId,
          startsAt: record.definition.startsAt,
          endsAt: record.definition.endsAt,
        },
        deployment: { contract: scope.contract },
      },
    ],
  };
  const bootstrap = {
    mode: "hosted-testnet",
    instanceId: "synthetic-instance",
    identities: [],
    chain: {
      chainId: 10200,
      rpcUrl: cManifest.chain.rpcUrl,
      nativeCurrency: { symbol: "XDAI" },
    },
    capabilities: {
      sharedDemo: false,
      createEvents: false,
      timeControls: false,
    },
    arbitration: {
      mode: "controlled",
      notice: "Controlled test arbitrator; no independent jury",
    },
    events: [
      {
        id: scope.eventId,
        startsAt: cManifest.events[0].definition.startsAt,
        endsAt: cManifest.events[0].definition.endsAt,
        contract: scope.contract,
        chainId: 10200,
        contractVersion: "kleros-event-v8",
        abiVersion: "kleros-event-v8",
      },
    ],
  };
  assertBootstrap(bootstrap, cManifest, "synthetic-instance");
  accepted++;
  for (const patch of [
    { mode: "hosted-demo" },
    { instanceId: "new-instance" },
    { events: [] },
    { chain: { ...bootstrap.chain, chainId: 1 } },
    { arbitration: { mode: "real" } },
    { identities: [{ wallet: scope.owner }] },
  ])
    refuse(() =>
      assertBootstrap(
        { ...bootstrap, ...patch },
        cManifest,
        "synthetic-instance",
      ),
    );
  for (const statusCode of [429, 302]) {
    let calls = 0;
    const connection = singleAttemptConnection(
      "https://offline-rpc.example.test",
      async (_url, request) => {
        calls++;
        assert.equal(request.redirect, "error");
        return {
          status: statusCode,
          statusText: "Synthetic response",
          headers: new Headers({ location: "https://other.example.test" }),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    );
    await assert.rejects(connection.send());
    assert.equal(
      calls,
      1,
      "RPC throttles/redirects must never replay the signed request",
    );
    accepted++;
  }
  const html =
    '<!doctype html>\n<html><head><meta charset="utf-8" />\n<title>Synthetic C</title></head><body>Fixture</body></html>\n';
  const anchor = '<meta charset="utf-8" />\n',
    expectedHtmlHash = sha256(html);
  const hostedHtml = html.replace(anchor, anchor + C_NETLIFY_COMMENT);
  assert.equal(
    assertPublishedAsset(Buffer.from(html), "/", expectedHtmlHash).transform,
    "none",
  );
  accepted++;
  assert.equal(
    assertPublishedAsset(
      Buffer.from(hostedHtml),
      "/index.html",
      expectedHtmlHash,
    ).removedBytes,
    326,
  );
  accepted++;
  for (const body of [
    html.replace(anchor, anchor + "<!-- arbitrary comment -->\n"),
    hostedHtml.replace("<body>", "<body><div>extra HTML</div>"),
    hostedHtml + '<script src="/unexpected.js"></script>',
    hostedHtml.replace("Fixture", "changed source bytes"),
    html + C_NETLIFY_COMMENT,
    hostedHtml.replace(
      C_NETLIFY_COMMENT,
      C_NETLIFY_COMMENT + C_NETLIFY_COMMENT,
    ),
    hostedHtml +
      '<script async src="/.netlify/scripts/hud?variant=public"></script>',
  ])
    refuse(() =>
      assertPublishedAsset(Buffer.from(body), "/", expectedHtmlHash),
    );
  refuse(() =>
    assertPublishedAsset(
      Buffer.from(hostedHtml),
      "/styles.css",
      expectedHtmlHash,
    ),
  );
  console.log(
    publicJson({
      status: "passed",
      scope: "pure C UI request/draft/window/nonce guards",
      accepted,
      rejected,
      networkRequests: 0,
      runtimeFilesRead: 0,
      signingFilesRead: 0,
      signatures: 0,
      broadcasts: 0,
    }),
  );
}

function parse(argv) {
  if (!argv.length) return { review: true };
  if (argv.length === 1 && argv[0] === "--self-test") return { selfTest: true };
  check(
    argv[0] === "--stage" &&
      C_STAGES.includes(argv[1]) &&
      (argv.length === 2 ||
        (argv.length === 4 &&
          argv[2] === "--role" &&
          argv[1] === "deposits" &&
          ["alice", "bob"].includes(argv[3]))),
    "Only --self-test or --stage STAGE [--role alice|bob for deposits] is supported. No prepare/reset/deploy/ruling mode exists.",
  );
  return { stage: argv[1], role: argv[3] };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (options.selfTest) return selfTest();
  if (options.review) {
    console.log(
      publicJson({
        status: "review-only",
        chainId: 10200,
        stages: C_STAGES,
        manifest: path.relative(ROOT, UI_C.manifest),
        signingFilesRead: 0,
        runtimeFilesRead: 0,
        networkRequests: 0,
        signatures: 0,
        broadcasts: 0,
        instruction:
          "Wait for explicit C deployment/healthy-site go. Then require UI_C_EXECUTE=1 plus UI_C_APP_URL equal to the separate C manifest origin. Each stage uses real UI review/nonce authentication; existing journal actions always stop. Payout waits for actual chain time. Controlled ruling is a separate operator CLI action.",
      }),
    );
    return;
  }
  check(
    process.env.UI_C_EXECUTE === "1" &&
      typeof process.env.UI_C_APP_URL === "string",
    "C UI execution is disabled. Explicit UI_C_EXECUTE=1 and exact UI_C_APP_URL are required before reading runtime files or accessing the network.",
  );
  let provider,
    browser,
    unlock,
    directory,
    journal,
    scope,
    manifest,
    plan,
    page;
  const proof = {
    status: "stopped",
    stage: options.stage,
    performedAt: new Date().toISOString(),
    checks: [],
    operations: [],
    blockedRequests: [],
    screenshots: [],
    staticAssetAudit: [],
    counts: {
      nodeHttp: 0,
      browserHttp: 0,
      browserPaths: {},
      rpc: {},
      nonceSignatures: 0,
      walletTransactions: 0,
      broadcasts: 0,
    },
  };
  const ensure = (ok, message) => {
    check(ok, message);
    proof.checks.push(message);
  };
  let faulted = false,
    instanceId;
  const stopWrites = (message) => {
    faulted = true;
    proof.blockedRequests.push(message);
  };
  const ensureHealthy = () =>
    check(
      !faulted,
      "A request, source, backend-health or browser failure disabled all further signing/writes.",
    );
  try {
    const source = readJson(UI_C.sourceManifest);
    manifest = readJson(UI_C.manifest);
    plan = validateUiCPlan(readJson(UI_C.plan), source);
    validateUiOrigin(process.env.UI_C_APP_URL, source.publicOrigin);
    ensure(
      process.env.UI_C_APP_URL === plan.publicOrigin &&
        manifest.publicOrigin === plan.publicOrigin &&
        manifest.environment === "testnet" &&
        manifest.chain?.chainId === 10200 &&
        manifest.events?.length === 1 &&
        manifest.scenario?.id === "ui-deposit-c" &&
        manifest.scenario.expectedFinalRuling === 1 &&
        manifest.planFingerprint === fingerprint(plan) &&
        manifest.planId === plan.id &&
        publicJson(manifest.rehearsalAddresses) ===
          publicJson(plan.addresses) &&
        manifest.events[0].definition.id === plan.event.id &&
        manifest.events[0].deployment.depositWei === UI_C.depositWei &&
        manifest.events[0].deployment.eventStart === plan.event.eventStart &&
        manifest.events[0].deployment.claimDeadline ===
          plan.event.claimDeadline,
      "C manifest, separate origin, roles, schedule and immutable plan agree.",
    );
    const record = manifest.events[0],
      d = record.deployment;
    scope = {
      chainId: 10200,
      eventId: record.definition.id,
      origin: plan.publicOrigin,
      contract: d.contract,
      ...plan.addresses,
      depositWei: plan.depositWei,
      depositOpensAt: d.depositOpensAt,
      eventStart: d.eventStart,
      eventEnd: plan.event.eventEnd,
      claimDeadline: d.claimDeadline,
      policyURI: d.policyURI,
    };
    ensure(
      source.events.every((r) => !same(r.deployment.contract, scope.contract)),
      "C is separate from both protected A/B child contracts.",
    );
    unlock = acquireLock(UI_C.lock);
    journal = loadJournal(UI_C.journal, plan);
    const selectedRoles =
      options.stage === "deposits"
        ? options.role
          ? [options.role]
          : ["alice", "bob"]
        : [options.stage === "challenge" ? "bob" : "owner"];
    const placeholder = {
      challengeDepositWei: plan.arbitrationCostWei,
      bobCase: { deposit: plan.arbitrationCostWei },
    };
    const initialOperations = selectedRoles.map((role) =>
      operationFor(options.stage, role, scope, placeholder),
    );
    noRecordedActions(journal, initialOperations);
    // No primary key file is ever opened. This harness reads only the fixed C key
    // file, and only after app/source/contract readiness has succeeded below.
    directory = path.join(
      ROOT,
      "artifacts/ui-c",
      `${options.stage}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
    );
    fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o755 });
    fs.mkdirSync(directory, { recursive: false, mode: 0o755 });
    const immutableWrite = (filename, value) =>
      fs.writeFileSync(filename, publicJson(value), {
        mode: 0o644,
        flag: "wx",
      });
    const { artifacts, provenance } = verifyCompiledInputs();
    ensure(
      publicJson(provenance) === publicJson(manifest.provenance),
      "Exact compiled source/artifact provenance matches C.",
    );
    const creation = uiCCreateRequest(plan, artifacts);
    const creationEntry = assertPlanDeployment(
      record,
      plan,
      journal,
      creation,
      ethers.keccak256(artifacts.KlerosEventV8.bytecode),
    );
    const publicSources = new Map();
    const walk = (folder) => {
      for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
        const filename = path.join(folder, item.name);
        if (item.isDirectory()) walk(filename);
        else if (item.isFile())
          publicSources.set(
            "/" +
              path
                .relative(path.join(ROOT, "public"), filename)
                .split(path.sep)
                .join("/"),
            sha256(fs.readFileSync(filename)),
          );
      }
    };
    walk(path.join(ROOT, "public"));
    const target = (relative) => {
      const url = new URL(relative, scope.origin);
      check(
        url.origin === scope.origin && !url.username && !url.password,
        "HTTP requests must stay on the exact separate C origin.",
      );
      return url.href;
    };
    const appRead = async (relative, json = true) => {
      proof.counts.nodeHttp++;
      let response;
      try {
        response = await fetch(target(relative), {
          redirect: "error",
          headers: { "cache-control": "no-cache" },
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        stopWrites("Application transport/readiness failure");
        throw new UiCFailure(
          "C application readiness failed; no next send is allowed.",
        );
      }
      if (response.status !== 200) {
        stopWrites(`Application ${response.status} ${relative}`);
        throw new UiCFailure(
          "C application returned a non-200 health/source response. Stop before any send.",
        );
      }
      if (json) {
        check(
          /application\/json/i.test(response.headers.get("content-type") ?? ""),
          "C API response is not JSON.",
        );
        return response.json();
      }
      return response;
    };
    const readiness = async () => {
      ensureHealthy();
      const data = assertBootstrap(
        await appRead("/api/bootstrap"),
        manifest,
        instanceId,
      );
      instanceId ??= data.instanceId;
      const asset = await appRead("/app.js", false);
      ensure(
        sha256(new Uint8Array(await asset.arrayBuffer())) ===
          publicSources.get("/app.js"),
        "Current public app.js bytes match the reviewed local UI source.",
      );
      return data;
    };
    const rootResponse = await appRead("/", false);
    ensure(
      rootResponse.headers.get("x-content-type-options") === "nosniff" &&
        /default-src 'self'/.test(
          rootResponse.headers.get("content-security-policy") ?? "",
        ) &&
        /sameorigin/i.test(rootResponse.headers.get("x-frame-options") ?? ""),
      "Separate C site serves strict same-origin security headers.",
    );
    proof.staticAssetAudit.push(
      assertPublishedAsset(
        new Uint8Array(await rootResponse.arrayBuffer()),
        "/",
        publicSources.get("/index.html"),
      ),
    );
    await readiness();
    for (const asset of [
      "/styles.css",
      "/transaction-context.js",
      "/hosted-wallet.js",
      "/reconciliation.js",
      "/contract-inbox.js",
      "/contract-inbox.css",
    ]) {
      const response = await appRead(asset, false);
      ensure(
        sha256(new Uint8Array(await response.arrayBuffer())) ===
          publicSources.get(asset),
        `Published ${asset} bytes match the reviewed source.`,
      );
    }
    const transport = process.env.TESTNET_RPC_URL ?? plan.chain.rpcUrl;
    const transportUrl = new URL(transport);
    ensure(
      transportUrl.protocol === "https:" &&
        !transportUrl.username &&
        !transportUrl.password &&
        !transportUrl.search &&
        !transportUrl.hash,
      "C RPC transport must use an HTTPS endpoint; chain identity is verified independently.",
    );
    provider = new ethers.JsonRpcProvider(
      singleAttemptConnection(transport),
      undefined,
      {
        cacheTimeout: -1,
        batchMaxCount: 1,
      },
    );
    provider.pollingInterval = 4000;
    const rpcSend = provider.send.bind(provider);
    let broadcastArmed = false;
    const reads = new Set([
      "eth_chainId",
      "net_version",
      "eth_blockNumber",
      "eth_getBalance",
      "eth_getCode",
      "eth_getTransactionCount",
      "eth_getBlockByNumber",
      "eth_getBlockByHash",
      "eth_getTransactionByHash",
      "eth_getTransactionReceipt",
      "eth_getLogs",
      "eth_call",
      "eth_estimateGas",
      "eth_gasPrice",
      "eth_maxPriorityFeePerGas",
      "eth_feeHistory",
    ]);
    provider.send = async (method, params) => {
      check(
        reads.has(method) ||
          (method === "eth_sendRawTransaction" && broadcastArmed),
        "Unexpected mutable RPC method refused.",
      );
      proof.counts.rpc[method] = (proof.counts.rpc[method] ?? 0) + 1;
      return rpcSend(method, params);
    };
    await assertTestnet(provider, plan.chain);
    await verifyUiCStack({
      provider,
      source,
      sourceJournal: readJson(UI_C.sourceJournal),
      artifacts,
      provenance,
    });
    const { verifyDeployment } = await import("../src/chain.mjs");
    await verifyDeployment({ provider }, d);
    const [createdReceipt, createdTx] = await Promise.all([
      provider.getTransactionReceipt(creationEntry.hash),
      provider.getTransaction(creationEntry.hash),
    ]);
    const creationBlock = await provider.getBlock(creationEntry.blockNumber);
    ensure(
      createdReceipt?.status === 1 &&
        createdReceipt.blockHash === creationEntry.blockHash &&
        creationBlock?.hash === createdReceipt.blockHash &&
        d.depositOpensAt === creationBlock.timestamp &&
        createdTx?.chainId === 10200n &&
        createdTx.nonce === creationEntry.nonce &&
        same(createdTx.from, plan.addresses.owner) &&
        same(createdTx.to, plan.factory) &&
        createdTx.value === 0n &&
        createdTx.data === creation.request.data,
      "Canonical C creation transaction, nonce, block and opening time match the exact plan-bound factory call.",
    );
    for (const item of source.events)
      await verifyDeployment({ provider }, item.deployment);
    const c = new ethers.Contract(
      scope.contract,
      artifacts.KlerosEventV8.abi,
      provider,
    );
    const resolver = new ethers.Contract(
      plan.arbitration.resolver,
      artifacts.MockArbitrableProxy.abi,
      provider,
    );
    const before = await stateOf(c, provider, scope, resolver);
    const abBefore = await Promise.all(
      source.events.map((r) =>
        protectedFacts(
          r,
          provider,
          artifacts.KlerosEventV8.abi,
          source.rehearsalAddresses,
        ),
      ),
    );
    const prior =
      {
        admit: ["ui-c-deposit-alice", "ui-c-deposit-bob"],
        attendance: ["ui-c-register"],
        challenge: ["ui-c-post-attendance"],
        match: ["ui-c-challenge-bob"],
        payout: ["ui-c-match-bob"],
        settle: ["ui-c-release-payouts"],
      }[options.stage] ?? [];
    for (const action of prior) {
      const entry = journal.transactions[action];
      ensure(
        entry?.state === "confirmed" && isHash(entry.hash) && entry.uiProof,
        `Prior ${action} has canonical journal and actual UI proof provenance.`,
      );
      const filename = path.resolve(ROOT, entry.uiProof.path);
      ensure(
        filename.startsWith(path.join(ROOT, "artifacts/ui-c") + path.sep) &&
          fs.lstatSync(filename).isFile() &&
          !fs.lstatSync(filename).isSymbolicLink() &&
          sha256(fs.readFileSync(filename)) === entry.uiProof.sha256,
        "Prior UI proof is immutable, hash-bound and within C artifacts.",
      );
      const previous = readJson(filename),
        receipt = await provider.getTransactionReceipt(entry.hash);
      ensure(
        previous.status === "passed" &&
          previous.protectedAB?.unchanged === true &&
          previous.source?.planFingerprint === fingerprint(plan) &&
          previous.source?.origin === scope.origin &&
          previous.eventId === scope.eventId &&
          same(previous.contract, scope.contract) &&
          previous.journalAction === action &&
          same(previous.hash, entry.hash) &&
          receipt?.status === 1 &&
          (await receipt.confirmations()) >= 2 &&
          (await provider.getBlock(receipt.blockNumber))?.hash ===
            receipt.blockHash,
        "Prior UI action receipt and proof remain canonical with two observed confirmations.",
      );
    }
    for (const op of initialOperations)
      assertStageState(
        options.stage,
        op.role,
        before,
        scope,
        journal.transactions[op.journalAction],
      );
    const info = fs.lstatSync(UI_C.wallets);
    ensure(
      info.isFile() &&
        !info.isSymbolicLink() &&
        (info.mode & 0o077) === 0 &&
        (process.getuid === undefined || info.uid === process.getuid()),
      "C signing file is an owner-only regular file.",
    );
    const keys = readJson(UI_C.wallets);
    ensure(
      keys.purpose === UI_C.purpose &&
        keys.chainId === 10200 &&
        Object.keys(keys.roles ?? {})
          .sort()
          .join() === "alice,bob,owner" &&
        ["owner", "alice", "bob"].every(
          (role) =>
            same(keys.roles[role].address, scope[role]) &&
            new ethers.Wallet(keys.roles[role].privateKey).address ===
              keys.roles[role].address,
        ),
      "Only the three isolated C role identities are loaded in Node.",
    );
    const wallets = Object.fromEntries(
      ["owner", "alice", "bob"].map((role) => [
        role,
        new ethers.Wallet(keys.roles[role].privateKey, provider),
      ]),
    );
    const { chromium, expect: baseExpect } = await import("@playwright/test");
    const expect = baseExpect.configure({ timeout: 90_000 });
    browser = await chromium.launch({ headless: true });
    const eventPath = `/api/events/${encodeURIComponent(scope.eventId)}`;
    let active;
    const originalBroadcast = provider.broadcastTransaction.bind(provider);
    provider.broadcastTransaction = async (raw) => {
      ensureHealthy();
      check(
        active && active.broadcasts === 0 && active.validated && active.draft,
        "Only one exact reviewed UI broadcast per selected C action is allowed.",
      );
      const txHash = assertSigned(raw, active.op, scope),
        entry = journal.transactions[active.op.journalAction];
      ensure(
        entry?.state === "prepared" && same(entry.hash, txHash),
        "Signed C hash is journaled before its single broadcast.",
      );
      await readiness();
      await assertTestnet(provider, plan.chain);
      await verifyDeployment({ provider }, d);
      assertStageState(
        options.stage,
        active.op.role,
        await stateOf(c, provider, scope, resolver),
        scope,
      );
      ensureHealthy();
      active.broadcasts++;
      proof.counts.broadcasts++;
      broadcastArmed = true;
      try {
        return await originalBroadcast(raw);
      } finally {
        broadcastArmed = false;
      }
    };

    const runRole = async (role) => {
      const current = await stateOf(c, provider, scope, resolver),
        op = operationFor(options.stage, role, scope, current);
      assertStageState(
        options.stage,
        role,
        current,
        scope,
        journal.transactions[op.journalAction],
      );
      active = {
        op,
        draft: null,
        validated: false,
        sends: 0,
        broadcasts: 0,
        receipt: null,
        confirmation: null,
        walletMethods: [],
        nonceRequests: 0,
        nonceSignatures: 0,
        nonceVerifications: 0,
      };
      const a = active,
        wallet = wallets[role];
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      context.setDefaultTimeout(90_000);
      let issued = new Map(),
        signedNonce;
      const readContext = async (relative) => {
        proof.counts.nodeHttp++;
        try {
          const response = await context.request.get(target(relative), {
            maxRedirects: 0,
            timeout: 30_000,
          });
          check(
            response.status() === 200,
            "Authenticated C detail read failed.",
          );
          return await response.json();
        } catch {
          stopWrites("Authenticated C transport/health read failed");
          throw new UiCFailure(
            "Authenticated C detail read failed; all writes disabled.",
          );
        }
      };
      await context.exposeBinding(
        "__klerosUiCWallet",
        async ({ frame }, method, params = []) => {
          try {
            check(
              new URL(frame.url()).origin === scope.origin &&
                frame.parentFrame() === null,
              "Only the exact C top-level frame may request this wallet.",
            );
            ensureHealthy();
            a.walletMethods.push(method);
            if (method === "eth_chainId") return "0x27d8";
            if (["eth_accounts", "eth_requestAccounts"].includes(method))
              return [wallet.address];
            if (method === "personal_sign") {
              check(
                params.length === 2 &&
                  same(params[1], wallet.address) &&
                  a.nonceSignatures === 0,
                "Only the active C role may sign an authentication nonce.",
              );
              const message = ethers.toUtf8String(params[0]),
                challenge = issued.get(message);
              check(
                challenge &&
                  assertNonce(challenge, wallet.address, scope.origin) ===
                    message,
                "Only the fresh exact C app nonce may be signed.",
              );
              issued.delete(message);
              const signature = await wallet.signMessage(message);
              a.nonceSignatures++;
              signedNonce = { nonce: challenge.nonce, signature };
              proof.counts.nonceSignatures++;
              return signature;
            }
            check(
              method === "eth_sendTransaction" &&
                params.length === 1 &&
                a.sends === 0 &&
                a.validated &&
                a.draft,
              "Only one reviewed and server-validated C transaction may be requested by this role.",
            );
            assertDraft(a.draft, op, scope);
            const request = assertWalletRequest(params[0], op, scope);
            await readiness();
            const fresh = await stateOf(c, provider, scope, resolver);
            assertStageState(
              options.stage,
              role,
              fresh,
              scope,
              journal.transactions[op.journalAction],
            );
            ensureHealthy();
            a.sends++;
            proof.counts.walletTransactions++;
            a.receipt = await sendOnce({
              provider,
              signer: wallet,
              journal,
              journalPath: UI_C.journal,
              action: op.journalAction,
              request,
            });
            return a.receipt.hash;
          } catch {
            stopWrites(
              "C wallet boundary rejected a request or could not confirm its operation",
            );
            throw new UiCFailure(
              "C wallet boundary stopped. Inspect the journaled hash only; no resend is allowed.",
            );
          }
        },
      );
      await context.addInitScript(
        ({ address }) => {
          window.ethereum = {
            selectedAddress: address,
            request: ({ method, params = [] }) =>
              window.__klerosUiCWallet(method, params),
            on() {},
            removeListener() {},
          };
        },
        { address: wallet.address },
      );
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          method = request.method();
        proof.counts.browserHttp++;
        const requestKey = `${method} ${url.pathname}`;
        proof.counts.browserPaths[requestKey] =
          (proof.counts.browserPaths[requestKey] ?? 0) + 1;
        try {
          check(
            url.origin === scope.origin &&
              !url.search &&
              !url.username &&
              !url.password,
            "Unexpected browser origin/query blocked.",
          );
          if (["GET", "HEAD"].includes(method)) {
            check(
              url.pathname === "/" ||
                publicSources.has(url.pathname) ||
                [
                  "/api/bootstrap",
                  eventPath,
                  eventPath + "/deposit-inbox",
                ].includes(url.pathname),
              "Unexpected C browser read blocked.",
            );
            const sourcePath =
              url.pathname === "/" ? "/index.html" : url.pathname;
            if (method === "GET" && publicSources.has(sourcePath)) {
              const response = await route.fetch({
                maxRedirects: 0,
                timeout: 30_000,
                headers: { "cache-control": "no-cache" },
              });
              check(
                response.status() === 200,
                "Published browser asset HTTP status differs from 200; writes disabled.",
              );
              proof.staticAssetAudit.push(
                assertPublishedAsset(
                  await response.body(),
                  url.pathname,
                  publicSources.get(sourcePath),
                ),
              );
              return route.fulfill({ response });
            }
            return route.continue();
          }
          ensureHealthy();
          const body = request.postData() ? request.postDataJSON() : {};
          const forward = async (status, validate) => {
            const response = await route.fetch({
              maxRedirects: 0,
              timeout: 90_000,
            });
            check(
              response.status() === status,
              "Actual C app operation returned an unexpected status; writes disabled.",
            );
            const data = await response.json();
            if (validate) validate(data);
            return route.fulfill({ response });
          };
          if (method === "POST" && url.pathname === "/api/auth/challenge") {
            check(
              exactKeys(body, ["wallet"]) &&
                same(body.wallet, wallet.address) &&
                a.nonceRequests === 0,
              "Nonce target must match the active C role.",
            );
            a.nonceRequests++;
            return forward(200, (challenge) => {
              assertNonce(challenge, wallet.address, scope.origin);
              issued.set(challenge.message, challenge);
            });
          }
          if (method === "POST" && url.pathname === "/api/auth/verify") {
            check(
              exactKeys(body, ["nonce", "signature"]) &&
                signedNonce &&
                a.nonceVerifications === 0 &&
                body.nonce === signedNonce.nonce &&
                body.signature === signedNonce.signature,
              "Only the exact Node-signed C nonce can authenticate.",
            );
            a.nonceVerifications++;
            return forward(200, (data) =>
              check(
                data.mode === "wallet" && same(data.wallet, wallet.address),
                "Authenticated wallet differs from the active C role.",
              ),
            );
          }
          if (
            options.stage === "deposits" &&
            method === "POST" &&
            url.pathname === eventPath + "/participants"
          ) {
            check(
              exactKeys(body, ["name", "email"]) &&
                publicJson(body) === publicJson(contact(role)),
              "Only exact synthetic C self-registration is permitted.",
            );
            return forward(201);
          }
          if (
            options.stage === "admit" &&
            role === "owner" &&
            method === "PATCH" &&
            url.pathname.startsWith(eventPath + "/participants/")
          ) {
            const id = decodeURIComponent(
              url.pathname.slice((eventPath + "/participants/").length),
            );
            check(
              exactKeys(body, ["admission"]) &&
                body.admission === "approved" &&
                a.participantIds?.includes(id),
              "Only the exact two C depositors may receive off-chain UI approval.",
            );
            return forward(200);
          }
          if (
            options.stage === "attendance" &&
            method === "POST" &&
            url.pathname === eventPath + "/checkins"
          ) {
            check(
              exactKeys(body, ["participantId", "nonce", "source", "note"]) &&
                body.participantId === a.aliceId &&
                body.source === "staff-door" &&
                /^[0-9a-f-]{36}$/i.test(body.nonce) &&
                body.note === "Synthetic UI C Alice observed at the test door",
              "Only Alice's actual UI staff-door observation is authorized.",
            );
            return forward(201);
          }
          if (method === "POST" && url.pathname === eventPath + "/drafts") {
            const params = ["match", "resolve"].includes(op.action)
              ? { wallet: scope.bob }
              : {};
            check(
              !a.draft &&
                exactKeys(body, ["action", "params"]) &&
                body.action === op.action &&
                publicJson(body.params) === publicJson(params),
              "Only this stage's one exact financial UI review is permitted.",
            );
            return forward(201, (draft) => {
              a.draft = assertDraft(draft, op, scope);
            });
          }
          if (
            a.draft &&
            method === "POST" &&
            url.pathname ===
              `${eventPath}/drafts/${encodeURIComponent(a.draft.id)}/validate`
          ) {
            check(
              exactKeys(body, []) && !a.validated,
              "Only one authoritative pre-send validation of the captured UI draft is allowed.",
            );
            return forward(200, (transaction) => {
              assertWalletRequest(transaction, op, scope);
              a.validated = true;
            });
          }
          const hash = journal.transactions[op.journalAction]?.hash;
          if (
            a.draft &&
            isHash(hash) &&
            method === "POST" &&
            url.pathname ===
              `${eventPath}/drafts/${encodeURIComponent(a.draft.id)}/submitted`
          ) {
            check(
              exactKeys(body, ["hash"]) && same(body.hash, hash),
              "Only the once-journaled hash can be submitted by the UI.",
            );
            return forward(200);
          }
          if (
            a.draft &&
            isHash(hash) &&
            method === "POST" &&
            url.pathname === eventPath + "/submissions/reconcile"
          ) {
            check(
              exactKeys(body, ["draftId", "hash"]) &&
                body.draftId === a.draft.id &&
                same(body.hash, hash),
              "Only this exact known UI draft/hash can be reconciled.",
            );
            return forward(200, (data) => {
              check(
                data.status === "confirmed" && same(data.hash, hash),
                "UI confirmation must refer to the same canonical receipt.",
              );
              a.confirmation = data;
            });
          }
          throw new UiCFailure(
            "Unexpected browser mutation blocked; no funding, execution API, import, time control, publication or ruling endpoint is allowed.",
          );
        } catch (error) {
          const reason =
            error instanceof UiCFailure &&
            error.code === "STATIC_SOURCE_MISMATCH"
              ? "STATIC_SOURCE_MISMATCH"
              : "REQUEST_GUARD_OR_TRANSPORT_FAILURE";
          stopWrites(`${method} ${url.pathname} blocked (${reason})`);
          return route.abort("blockedbyclient");
        }
      });
      try {
        page = await context.newPage();
        page.on("pageerror", () => stopWrites("Browser runtime failure"));
        page.on("response", (response) => {
          if (response.status() >= 400)
            stopWrites(
              `Browser HTTP${response.status()} ${new URL(response.url()).pathname}`,
            );
        });
        await page.goto(
          target(
            `/#event=${encodeURIComponent(scope.eventId)}&view=${role === "owner" ? "organizer" : "participant"}`,
          ),
        );
        await expect(page.locator("#loading")).toBeHidden();
        await expect(page.locator("#content")).toBeVisible();
        await expect(page.locator("#event-switch")).toHaveValue(scope.eventId);
        await expect(page.locator("#event-switch option")).toHaveCount(1);
        await expect(page.locator("#testnet-banner")).toContainText(
          /controll.*arbitrat|no independent jury/i,
        );
        await page.locator("#deployment-details summary").click();
        await expect(page.locator("#deployment-details")).toContainText(
          scope.contract,
        );
        await expect(page.locator("#deployment-details")).toContainText(
          scope.policyURI,
        );
        await page.locator("#top-identity").click();
        await expect(page.locator("#dialog-title")).toHaveText(
          "Connect your wallet",
        );
        const login = page.waitForResponse(
          (r) =>
            r.url() === target("/api/auth/verify") &&
            r.request().method() === "POST",
        );
        await page.locator("#review-dialog [data-connect-wallet]").click();
        ensure(
          (await login).status() === 200,
          "The real C UI authenticated the active wallet nonce.",
        );
        await expect
          .poll(async () => {
            const data = assertBootstrap(
              await readContext("/api/bootstrap"),
              manifest,
              instanceId,
            );
            return (
              data.session?.mode === "wallet" &&
              same(data.session.wallet, wallet.address)
            );
          })
          .toBe(true);
        const session = (await context.cookies(scope.origin)).find(
          (cookie) => cookie.name === "kleros_session",
        );
        ensure(
          session?.secure && session.httpOnly && session.sameSite === "Strict",
          "C wallet session uses Secure HttpOnly SameSite Strict cookies.",
        );
        if (await page.locator("#review-dialog").isVisible())
          await page.locator("#review-dialog [data-close]").last().click();
        const detail = await readContext(eventPath);
        ensure(
          same(detail.event.contract, scope.contract) &&
            detail.event.id === scope.eventId &&
            detail.event.startsAt === record.definition.startsAt &&
            detail.event.endsAt === record.definition.endsAt &&
            detail.event.chainId === 10200 &&
            detail.permissions.owner === (role === "owner"),
          "Authenticated C detail remains bound to the selected child.",
        );
        if (options.stage === "deposits") {
          const participant = detail.participants.find((p) =>
            same(p.wallet, wallet.address),
          );
          if (!participant) {
            const response = page.waitForResponse(
              (r) =>
                r.url() === target(eventPath + "/participants") &&
                r.request().method() === "POST",
            );
            await page.locator("#reg-name").fill(contact(role).name);
            await page.locator("#reg-email").fill(contact(role).email);
            await page
              .locator('form[data-form="registration"] button[type="submit"]')
              .click();
            ensure(
              (await response).status() === 201,
              "Synthetic registration was submitted through the actual C UI.",
            );
            await expect(
              page.locator('.next-action [data-tx="deposit"]'),
            ).toBeVisible();
          } else
            ensure(
              participant.identityVerified &&
                participant.eventId === scope.eventId &&
                participant.name === contact(role).name &&
                participant.email === contact(role).email,
              "An existing C participant must be the exact verified synthetic self-registration.",
            );
        }
        if (options.stage === "admit") {
          ensure(
            detail.participants.length === 2 &&
              ["alice", "bob"].every((r) =>
                detail.participants.some(
                  (p) =>
                    p.identityVerified &&
                    p.eventId === scope.eventId &&
                    same(p.wallet, scope[r]) &&
                    p.name === contact(r).name &&
                    p.email === contact(r).email &&
                    p.deposit?.verified,
                ),
              ),
            "Only the two actual UI depositors appear in C's organizer list.",
          );
          a.participantIds = detail.participants.map((p) => p.id);
          for (const participant of detail.participants) {
            if (participant.admission === "approved") continue;
            ensure(
              participant.admission === "pending",
              "Unexpected existing C admission decision; stop before changing it.",
            );
            const response = page.waitForResponse(
              (r) =>
                r.request().method() === "PATCH" &&
                r.url() ===
                  target(
                    `${eventPath}/participants/${encodeURIComponent(participant.id)}`,
                  ),
            );
            await page
              .locator(`[data-admission="${participant.id}"]`)
              .selectOption("approved");
            ensure(
              (await response).status() === 200,
              "Owner approval was saved through the actual C UI.",
            );
            await expect
              .poll(
                async () =>
                  (await readContext(eventPath)).participants.find(
                    (p) => p.id === participant.id,
                  )?.admission,
              )
              .toBe("approved");
            await page.reload();
            await expect(page.locator("#loading")).toBeHidden();
            await expect(page.locator("#content")).toBeVisible();
          }
        }
        if (options.stage === "attendance") {
          const alice = detail.participants.find((p) =>
            same(p.wallet, scope.alice),
          );
          ensure(
            alice?.identityVerified &&
              alice.registered &&
              detail.attendance.every((o) => o.participantId === alice.id),
            "Only Alice can be trusted as present in this rehearsal.",
          );
          a.aliceId = alice.id;
          if (!detail.attendance.some((o) => o.participantId === alice.id)) {
            await page.locator(`[data-checkin="${alice.id}"]`).click();
            await page
              .locator("#checkin-note")
              .fill("Synthetic UI C Alice observed at the test door");
            const response = page.waitForResponse(
              (r) =>
                r.url() === target(eventPath + "/checkins") &&
                r.request().method() === "POST",
            );
            await page
              .locator(
                'form[data-form="checkin"] button[type="submit"], form[data-form="checkin"] button:not([type="button"])',
              )
              .last()
              .click();
            ensure(
              (await response).status() === 201,
              "Alice's owner door observation was submitted through the actual UI.",
            );
            await expect(page.locator("#review-dialog")).not.toBeVisible();
            await expect(
              page.locator(`[data-checkin="${alice.id}"]`),
            ).toHaveCount(0);
          }
        }
        if (["match", "payout", "settle"].includes(options.stage))
          await page.locator('[data-view="cases"]').click();
        const selector = ["match", "resolve"].includes(op.action)
          ? `[data-tx="${op.action}"][data-wallet="${scope.bob}"]`
          : `[data-tx="${op.action}"]`;
        const button = page.locator(selector).first();
        await expect(button).toBeEnabled();
        await button.click();
        await expect(page.locator("#review-dialog")).toBeVisible();
        await expect(page.locator("#dialog-body .review-list")).toBeVisible();
        for (const value of [
          record.definition.title,
          scope.eventId,
          scope.contract,
          wallet.address,
          String(op.value),
          "10200",
          scope.policyURI,
          op.method,
        ])
          await expect(page.locator("#dialog-body .review-list")).toContainText(
            value,
          );
        await page
          .getByText("Inspect calldata and arguments", { exact: true })
          .click();
        const expanded = JSON.parse(
          await page.locator("#dialog-body .review-code").textContent(),
        );
        ensure(
          a.draft &&
            publicJson(expanded.args) === publicJson(a.draft.args) &&
            expanded.snapshot === a.draft.snapshot,
          "Expanded UI arguments and snapshot match the captured authoritative draft.",
        );
        assertWalletRequest(expanded.transaction, op, scope);
        const preview = path.join(directory, `${role}-review.png`);
        await page.screenshot({ path: preview, fullPage: true });
        proof.screenshots.push(path.relative(ROOT, preview));
        ensureHealthy();
        await readiness();
        assertDraft(a.draft, op, scope);
        await page.locator("[data-execute]").click();
        await expect(page.locator("#review-dialog")).not.toBeVisible({
          timeout: 120_000,
        });
        await expect(page.locator("#toast")).toContainText("Confirmed");
        ensure(
          a.receipt && a.confirmation && a.sends === 1 && a.broadcasts === 1,
          "Real UI review, wallet send, once broadcast and canonical app confirmation completed exactly once.",
        );
        const entry = journal.transactions[op.journalAction],
          receipt = await provider.getTransactionReceipt(entry.hash),
          tx = await provider.getTransaction(entry.hash);
        ensure(
          receipt?.status === 1 &&
            (await receipt.confirmations()) >= 2 &&
            (await provider.getBlock(receipt.blockNumber))?.hash ===
              receipt.blockHash &&
            tx.nonce === entry.nonce,
          "Actual UI transaction remains canonical with two observed confirmations.",
        );
        assertWalletRequest(
          {
            from: tx.from,
            to: tx.to,
            value: tx.value,
            data: tx.data,
            chainId: tx.chainId,
          },
          op,
          scope,
        );
        const after = await stateOf(c, provider, scope, resolver);
        await assertPostState(
          options.stage,
          role,
          current,
          after,
          receipt,
          c,
          scope,
        );
        await readiness();
        ensureHealthy();
        const protectedAfter = await Promise.all(
          source.events.map((r) =>
            protectedFacts(
              r,
              provider,
              artifacts.KlerosEventV8.abi,
              source.rehearsalAddresses,
            ),
          ),
        );
        ensure(
          publicJson(protectedAfter.map((entry) => entry.financial)) ===
            publicJson(abBefore.map((entry) => entry.financial)),
          "Each C UI operation leaves both protected A/B financial snapshots unchanged.",
        );
        const confirmed = path.join(directory, `${role}-confirmed.png`);
        await page.screenshot({ path: confirmed, fullPage: true });
        proof.screenshots.push(path.relative(ROOT, confirmed));
        const result = {
          status: "passed",
          stage: options.stage,
          journalAction: op.journalAction,
          eventId: scope.eventId,
          contract: scope.contract,
          wallet: wallet.address,
          hash: receipt.hash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          confirmations: await receipt.confirmations(),
          draft: {
            id: a.draft.id,
            snapshot: a.draft.snapshot,
            method: op.method,
            args: a.draft.args,
            valueWei: String(op.value),
            expiresAt: a.draft.expiresAt,
          },
          ui: {
            walletTransactions: a.sends,
            broadcasts: a.broadcasts,
            walletMethods: a.walletMethods,
          },
          logs: receipt.logs.map((l) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            logIndex: l.index,
            blockNumber: l.blockNumber,
            blockHash: l.blockHash,
          })),
          before: current,
          after,
          source: proof.source,
          protectedAB: {
            unchanged: true,
            before: abBefore,
            after: protectedAfter,
          },
        };
        const filename = path.join(directory, `${op.journalAction}.proof.json`);
        immutableWrite(filename, result);
        entry.uiProof = {
          path: path.relative(ROOT, filename),
          sha256: sha256(fs.readFileSync(filename)),
        };
        atomicJson(UI_C.journal, journal);
        proof.operations.push(result);
      } finally {
        await context.close();
        page = null;
      }
    };
    const operatorFiles = [
      "test/testnet-ui-c.e2e.mjs",
      "scripts/chiado-ui-deposit-guards.mjs",
      "scripts/testnet-ui-scenario.mjs",
      "src/testnet-config.mjs",
      "src/chain.mjs",
      "src/contracts-v8.mjs",
      "src/utils.mjs",
    ];
    proof.source = {
      origin: scope.origin,
      instanceId,
      planFingerprint: fingerprint(plan),
      manifestSha256: sha256(publicJson(manifest)),
      protectedManifestSha256: sha256(publicJson(source)),
      manifestFileSha256: sha256(fs.readFileSync(UI_C.manifest)),
      protectedManifestFileSha256: sha256(fs.readFileSync(UI_C.sourceManifest)),
      harnessSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
      operatorFiles: Object.fromEntries(
        operatorFiles.map((filename) => [
          filename,
          sha256(fs.readFileSync(path.join(ROOT, filename))),
        ]),
      ),
      publicFiles: Object.fromEntries(publicSources),
      staticAssetAudit: proof.staticAssetAudit,
      provenance,
      contract: {
        address: d.contract,
        codeHash: d.codeHash,
        factory: d.factory,
        factoryCodeHash: d.factoryCodeHash,
        deploymentTxHash: d.deploymentTxHash,
        deploymentBlock: d.deploymentBlock,
        configurationHash: d.configurationHash,
      },
    };
    for (const role of selectedRoles) await runRole(role);
    const abAfter = await Promise.all(
      source.events.map((r) =>
        protectedFacts(
          r,
          provider,
          artifacts.KlerosEventV8.abi,
          source.rehearsalAddresses,
        ),
      ),
    );
    ensure(
      publicJson(abAfter.map((entry) => entry.financial)) ===
        publicJson(abBefore.map((entry) => entry.financial)),
      "Protected A/B financial state remains byte-for-byte unchanged by the C UI stage.",
    );
    proof.protectedAB = { unchanged: true, before: abBefore, after: abAfter };
    proof.after = await stateOf(c, provider, scope, resolver);
    proof.status = "passed";
    proof.notice =
      "Actual C UI transactions on Chiado only. Controlled test arbitrator; no independent jury. A natural future deadline or separate controlled CLI ruling may still be pending.";
    immutableWrite(path.join(directory, "proof.json"), proof);
    console.log(
      publicJson({
        status: proof.status,
        stage: options.stage,
        proof: path.relative(ROOT, path.join(directory, "proof.json")),
        eventId: scope.eventId,
        operations: proof.operations.map((o) => ({
          action: o.journalAction,
          hash: o.hash,
          blockNumber: o.blockNumber,
        })),
        counts: proof.counts,
        protectedABUnchanged: true,
      }),
    );
  } catch (error) {
    faulted = true;
    proof.error =
      error instanceof UiCFailure
        ? error.message
        : "C UI operation stopped. Transport, signing and browser diagnostics are redacted. Inspect existing journal hashes; never replay/reset.";
    proof.knownTransactions = journal
      ? Object.entries(journal.transactions)
          .filter(([action]) => action.startsWith("ui-c-"))
          .map(([action, entry]) => ({
            action,
            hash: isHash(entry.hash) ? entry.hash : null,
            state: entry.state,
          }))
      : [];
    if (directory)
      fs.writeFileSync(path.join(directory, "proof.json"), publicJson(proof), {
        mode: 0o644,
        flag: "wx",
      });
    console.error(
      publicJson({
        status: "stopped",
        stage: options.stage,
        error: proof.error,
        proof: directory
          ? path.relative(ROOT, path.join(directory, "proof.json"))
          : null,
        knownTransactions: proof.knownTransactions,
      }),
    );
    process.exitCode = 1;
  } finally {
    await browser?.close();
    provider?.destroy();
    unlock?.();
  }
}

async function assertPostState(
  stage,
  role,
  before,
  after,
  receipt,
  contract,
  scope,
) {
  const d = quantity(scope.depositWei),
    events = receipt.logs
      .filter((l) => same(l.address, scope.contract))
      .flatMap((log) => {
        try {
          return [contract.interface.parseLog(log)];
        } catch {
          return [];
        }
      })
      .filter(Boolean);
  const count = (name, predicate = () => true) =>
    events.filter((e) => e.name === name && predicate(e.args)).length;
  const paid = (wallet) =>
    events
      .filter((e) => e.name === "Payout" && same(e.args.to, wallet))
      .reduce((sum, e) => sum + e.args.amount, 0n);
  check(
    count("PayoutFailed") === 0,
    "A payment failed into owed credit; stop instead of claiming delivered kickbacks.",
  );
  if (stage === "deposits")
    check(
      after.pending[role] === String(d) &&
        after.status[role] === 0 &&
        count(
          "Deposited",
          (a) => same(a.from, scope[role]) && a.amount === d,
        ) === 1,
      "UI deposit must emit one exact payer credit without admission.",
    );
  if (stage === "admit")
    check(
      after.stakerCount === 2 &&
        after.pendingTotal === "0" &&
        after.status.alice === 1 &&
        after.status.bob === 1 &&
        count("StakerRegistered") === 2 &&
        [scope.alice, scope.bob].every(
          (wallet) =>
            count("StakerRegistered", (a) => same(a.staker, wallet)) === 1,
        ),
      "UI registration must commit exactly both fresh payer credits.",
    );
  if (stage === "attendance")
    check(
      after.phase === "Listed" &&
        after.attendeeCount === 1 &&
        after.attended.alice &&
        !after.attended.bob &&
        after.challengeEndsAt ===
          (await receipt.getBlock()).timestamp + 86400 &&
        count("AttendancePosted") === 1,
      "UI attendance must list only Alice and open the unchanged one-day challenge window.",
    );
  if (stage === "challenge")
    check(
      after.bobCase.state === 1 &&
        count(
          "Challenged",
          (a) =>
            same(a.staker, scope.bob) &&
            a.deposit === quantity(before.challengeDepositWei),
        ) === 1,
      "Same Bob UI depositor must open exactly one Waiting challenge.",
    );
  if (stage === "match")
    check(
      after.bobCase.state === 2 &&
        after.bobCase.finalRuling === null &&
        count(
          "ChallengeMatched",
          (a) =>
            same(a.staker, scope.bob) &&
            String(a.localDisputeID) === after.bobCase.localDisputeID &&
            String(a.arbitratorDisputeID) === after.bobCase.arbitratorDisputeID,
        ) === 1,
      "UI matching must create and verify the dynamic C resolver/arbitrator pair.",
    );
  if (stage === "payout")
    check(
      after.phase === "Finalized" &&
        after.heldBack === String(d) &&
        after.bobCase.heldShare === String(d) &&
        after.bobCase.state === 2 &&
        after.bobCase.finalRuling === null &&
        paid(scope.alice) === d &&
        paid(scope.bob) === 0n &&
        quantity(after.balances.alice) - quantity(before.balances.alice) === d,
      "Ordinary UI payout must deliver Alice D and hold Bob D while his case stays unruled.",
    );
  if (stage === "settle") {
    const collateral =
      2n * quantity(before.bobCase.deposit) -
      quantity(before.bobCase.arbitrationPaid);
    check(
      after.bobCase.state === 3 &&
        after.bobCase.finalRuling === 1 &&
        after.heldBack === "0" &&
        after.bobCase.heldShare === "0" &&
        after.pendingChallenges === "0" &&
        after.challengeEscrow === "0" &&
        after.owed.bob === "0" &&
        after.attended.bob &&
        paid(scope.bob) === d &&
        quantity(after.balances.bob) - quantity(before.balances.bob) ===
          d + collateral &&
        count(
          "ChallengeResolved",
          (a) => same(a.staker, scope.bob) && a.attended && a.ruling === 1n,
        ) === 1,
      "UI settlement must pay the same Bob depositor his held D plus exact remaining challenge collateral.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof UiCFailure
        ? error.message
        : "C harness stopped before execution; diagnostics redacted.",
    );
    process.exitCode = 1;
  });
}
