import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  APP_ORIGIN,
  FIXTURES,
  allowedAppRequest,
  verifyChallenge,
  financialFacts,
  createAppClient,
  syncFixtures,
} from "../scripts/testnet-sync-app.mjs";

function setup() {
  const roles = Object.fromEntries(
    ["ownerA", "ownerB", "alice", "bob", "carol"].map((role) => [
      role,
      ethers.Wallet.createRandom(),
    ]),
  );
  const manifest = {
    environment: "testnet",
    planId: "fixture-plan",
    chain: { chainId: 10200, rpcUrl: "https://rpc.chiadochain.net" },
    arbitration: { mode: "controlled" },
    rehearsalAddresses: Object.fromEntries(
      Object.entries(roles).map(([role, wallet]) => [role, wallet.address]),
    ),
    events: [0, 1].map((index) => ({
      definition: {
        id: `event-${index}`,
        startsAt: new Date(1000000).toISOString(),
        endsAt: new Date(2000000).toISOString(),
      },
      deployment: {
        contract: ethers.Wallet.createRandom().address,
        owner: roles[index ? "ownerB" : "ownerA"].address,
        deploymentBlock: 1,
        depositOpensAt: 900,
        eventStart: 1000,
      },
    })),
  };
  const bootstrap = {
    instanceId: "same-instance",
    mode: "hosted-testnet",
    chain: { ...manifest.chain, nativeCurrency: { symbol: "XDAI" } },
    arbitration: { mode: "controlled" },
    capabilities: { sharedDemo: false },
    identities: [],
    events: manifest.events.map((record) => ({
      id: record.definition.id,
      contract: record.deployment.contract,
      chainId: 10200,
      contractVersion: "kleros-event-v8",
      abiVersion: "kleros-event-v8",
    })),
  };
  const journal = {
    transactions: Object.fromEntries(
      FIXTURES.map((fixture, i) => [
        fixture.action,
        {
          state: "confirmed",
          hash: "0x" + String(i + 1).repeat(64),
          blockHash: "0x" + "aa".repeat(32),
          blockNumber: 2,
          expected: {
            value: fixture.role === "alice" ? "2000000000000" : "1000000000000",
          },
        },
      ]),
    ),
  };
  return { roles, manifest, bootstrap, journal };
}
function state(owner, index) {
  return {
    phase: "Open",
    owner,
    pendingOwner: ethers.ZeroAddress,
    stakerCount: index ? 1 : 3,
    attendeeCount: 0,
    poolWei: index ? "2000000000000" : "3000000000000",
    balanceWei: index ? "2000000000000" : "3000000000000",
    pendingTotalWei: "0",
    pendingChallenges: 0,
    heldBackWei: "0",
    reservedWei: "0",
    owedTotalWei: "0",
    challengeEscrowWei: "0",
    challengeDepositWei: "30000000000",
    payoutShareWei: "0",
  };
}
test("off-chain sync allowlist refuses contract execution, funding, clock, ruling, RPC-send and review mutations", () => {
  const { manifest, roles } = setup();
  for (const pathname of [
    "/api/events/event-0/drafts/id/execute",
    "/api/demo/fund",
    "/api/demo/advance",
    "/api/events/event-0/demo/ruling",
    "/api/session",
    "/local-upload",
  ])
    assert.equal(
      allowedAppRequest({
        method: "POST",
        pathname,
        body: {},
        role: "ownerA",
        manifest,
        execute: true,
      }),
      false,
    );
  assert.equal(
    allowedAppRequest({
      method: "POST",
      pathname: "/rpc",
      body: [{ method: "eth_sendRawTransaction" }],
      manifest,
      execute: true,
    }),
    false,
  );
  assert.equal(
    allowedAppRequest({
      method: "POST",
      pathname: "/api/auth/challenge",
      body: { wallet: roles.alice.address },
      role: "alice",
      manifest,
      execute: false,
    }),
    false,
  );
});
test("check-in allowlist considers each intended same-event attendee and rejects Bob or wrong-owner nonces", () => {
  const { manifest } = setup();
  for (const fixture of FIXTURES) {
    const role = fixture.index ? "ownerB" : "ownerA";
    const request = {
      method: "POST",
      pathname: `/api/events/event-${fixture.index}/checkins`,
      body: {
        participantId: `${fixture.index}-${fixture.role}`,
        source: "staff-door",
        nonce: `testnet-sync:${manifest.planId}:${fixture.index}:${fixture.role}`,
      },
      role,
      manifest,
      execute: true,
    };
    assert.equal(allowedAppRequest(request), fixture.attended);
    assert.equal(
      allowedAppRequest({
        ...request,
        role: role === "ownerA" ? "ownerB" : "ownerA",
      }),
      false,
    );
    assert.equal(
      allowedAppRequest({
        ...request,
        body: { ...request.body, nonce: request.body.nonce + "-extra" },
      }),
      false,
    );
  }
});
test("only the exact fresh app-origin/chain/wallet challenge may be signed", () => {
  const { roles } = setup(),
    expiresAt = Date.now() + 300000,
    nonce = "aa".repeat(20);
  const message = `Kleros Chiado testnet workbench\nDomain: ${new URL(APP_ORIGIN).host}\nURI: ${APP_ORIGIN}\nChain ID: 10200\nWallet: ${roles.alice.address}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nAuthenticate this testnet wallet. No financial transaction.`;
  assert.equal(
    verifyChallenge({ message, nonce, expiresAt }, roles.alice.address),
    message,
  );
  for (const invalid of [
    message.replace("10200", "1"),
    message.replace(APP_ORIGIN, "https://evil.test"),
    message.replace(roles.alice.address, roles.bob.address),
    message + "\nApprove a payment",
  ])
    assert.throws(
      () =>
        verifyChallenge(
          { message: invalid, nonce, expiresAt },
          roles.alice.address,
        ),
      /exact app-issued/,
    );
});
test("existing deposit proof checks canonical receipt, exact sender/child/value and actual log", async () => {
  const { manifest, journal, roles } = setup(),
    record = manifest.events[0],
    entry = journal.transactions["deposit-bob-a"];
  const iface = new ethers.Interface([
    "event Deposited(address indexed from, uint256 amount)",
  ]);
  const encoded = iface.encodeEventLog(iface.getEvent("Deposited"), [
    roles.bob.address,
    entry.expected.value,
  ]);
  const results = [
    "0x27d8",
    {
      transactionHash: entry.hash,
      status: "0x1",
      blockNumber: "0x2",
      blockHash: entry.blockHash,
      from: roles.bob.address,
      to: record.deployment.contract,
      logs: [{ address: record.deployment.contract, ...encoded }],
    },
    {
      hash: entry.hash,
      chainId: "0x27d8",
      from: roles.bob.address,
      to: record.deployment.contract,
      input: "0xd0e30db0",
      value: ethers.toQuantity(entry.expected.value),
    },
    { hash: entry.blockHash, timestamp: "0x3b6" },
  ];
  const client = createAppClient({
    manifest,
    fetcher: async (url, options) => {
      assert.equal(url.origin, APP_ORIGIN);
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.cookie, undefined);
      return new Response(
        JSON.stringify(
          results.map((result, index) => ({ id: index + 1, result })),
        ),
      );
    },
  });
  await client.receiptProof(record, "bob", entry);
  results[2].from = roles.carol.address;
  await assert.rejects(
    client.receiptProof(record, "bob", entry),
    /sender\/contract\/value/,
  );
});
test("sync preserves existing Alice records, links other actual deposits, checks in intended attendees and is idempotent", async () => {
  const { roles, manifest, bootstrap, journal } = setup();
  const people = [[], []],
    observations = [[], []],
    writes = [];
  for (const index of [0, 1])
    people[index].push({
      id: `${index}-alice`,
      wallet: roles.alice.address,
      name: "Preserved Alice name",
      email: "existing-alice@example.test",
      identityVerified: true,
      admission: index ? "pending" : "approved",
      deposit: {
        txHash:
          journal.transactions[index ? "deposit-alice-b" : "deposit-alice-a"]
            .hash,
        verified: true,
      },
    });
  const client = {
    bootstrap: async () => structuredClone(bootstrap),
    detail: async (record) => {
      const index = manifest.events.indexOf(record);
      return structuredClone({
        state: state(record.deployment.owner, index),
        participants: people[index],
        attendance: observations[index],
        permissions: { owner: true },
        now: 1500,
      });
    },
    login: async (role, wallet) =>
      assert.equal(wallet.address, roles[role].address),
    register: async (record, role) => {
      const index = manifest.events.indexOf(record);
      writes.push("register-" + role);
      people[index].push({
        id: `${index}-${role}`,
        wallet: roles[role].address,
        name: `New ${role}`,
        identityVerified: true,
        admission: "pending",
        deposit: null,
      });
    },
    receiptProof: async (_record, _role, entry) =>
      assert.equal(entry.state, "confirmed"),
    link: async (record, role, hash) => {
      writes.push("link-" + role);
      people[manifest.events.indexOf(record)].find(
        (p) => p.wallet === roles[role].address,
      ).deposit = { txHash: hash, verified: true };
    },
    approve: async (record, _role, id) => {
      writes.push("approve-" + id);
      people[manifest.events.indexOf(record)].find(
        (p) => p.id === id,
      ).admission = "approved";
    },
    checkin: async (record, _role, body) => {
      writes.push("checkin-" + body.participantId);
      observations[manifest.events.indexOf(record)].push(body);
    },
  };
  const review = await syncFixtures({
    manifest,
    journal,
    roles: {},
    client,
    execute: false,
  });
  assert.equal(review.status, "review-only-no-mutations");
  assert.equal(writes.length, 0);
  const first = await syncFixtures({
    manifest,
    journal,
    roles,
    client,
    execute: true,
  });
  assert.equal(first.status, "passed-offchain-only");
  assert.deepEqual(first.financialBefore, first.financialAfter);
  assert.equal(people[0][0].name, "Preserved Alice name");
  assert.equal(people[1][0].email, "existing-alice@example.test");
  assert.equal(observations[0].length, 2);
  assert.equal(observations[1].length, 1);
  assert.equal(
    observations[0].some((o) => o.participantId === "0-bob"),
    false,
  );
  const count = writes.length;
  await syncFixtures({ manifest, journal, roles, client, execute: true });
  assert.equal(
    writes.length,
    count,
    "Re-running must preserve the already synchronized off-chain records",
  );
});
test("a missing financial fact cannot silently turn into unchanged-state proof", () => {
  const incomplete = state(ethers.ZeroAddress, 0);
  delete incomplete.pendingTotalWei;
  assert.throws(() => financialFacts({ state: incomplete }), /incomplete/);
});
