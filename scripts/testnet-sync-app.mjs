import path from "node:path";
import { pathToFileURL } from "node:url";
import { ethers } from "ethers";
import {
  ROOT,
  PRIVATE_ROOT,
  check,
  readJson,
  publicJson,
  atomicJson,
  secureWalletFile,
  parseArgs,
  safeFailure,
} from "../src/testnet-config.mjs";

export const APP_ORIGIN = "https://kleros-event-workbench-preview.netlify.app";
export const FIXTURES = Object.freeze([
  { role: "alice", index: 0, action: "deposit-alice-a", attended: true },
  { role: "bob", index: 0, action: "deposit-bob-a", attended: false },
  { role: "carol", index: 0, action: "deposit-carol-a", attended: true },
  { role: "alice", index: 1, action: "deposit-alice-b", attended: true },
]);
const same = (a, b) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const isHash = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? "");
const eventPath = (record, suffix = "") =>
  `/api/events/${encodeURIComponent(record.definition.id)}${suffix}`;
const contact = (role) => ({
  name: `Synthetic rehearsal ${role[0].toUpperCase()}${role.slice(1)}`,
  email: `testnet-rehearsal-${role}@example.test`,
});
const readMethods = new Set([
  "eth_chainId",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getBlockByNumber",
]);

export function allowedAppRequest({
  method,
  pathname,
  body,
  role,
  manifest,
  execute,
}) {
  if (method === "GET")
    return (
      pathname === "/api/bootstrap" ||
      manifest.events.some((record) => pathname === eventPath(record))
    );
  if (method === "POST" && pathname === "/rpc")
    return (
      Array.isArray(body) &&
      body.length === 4 &&
      body.every((call) => readMethods.has(call.method))
    );
  if (!execute || !Object.hasOwn(manifest.rehearsalAddresses, role))
    return false;
  if (method === "POST" && pathname === "/api/auth/challenge")
    return same(body?.wallet, manifest.rehearsalAddresses[role]);
  if (method === "POST" && pathname === "/api/auth/verify")
    return (
      typeof body?.nonce === "string" && typeof body?.signature === "string"
    );
  if (method === "DELETE" && pathname === "/api/session") return true;
  for (const fixture of FIXTURES) {
    const record = manifest.events[fixture.index];
    if (
      role === fixture.role &&
      method === "POST" &&
      pathname === eventPath(record, "/participants")
    )
      return JSON.stringify(body) === JSON.stringify(contact(role));
    if (
      role === fixture.role &&
      method === "POST" &&
      pathname === eventPath(record, "/deposits")
    )
      return isHash(body?.txHash) && Object.keys(body).length === 1;
    if (
      role === (fixture.index ? "ownerB" : "ownerA") &&
      method === "PATCH" &&
      pathname.startsWith(eventPath(record, "/participants/"))
    )
      return body?.admission === "approved" && Object.keys(body).length === 1;
    if (
      fixture.attended &&
      role === (fixture.index ? "ownerB" : "ownerA") &&
      method === "POST" &&
      pathname === eventPath(record, "/checkins") &&
      body?.nonce ===
        `testnet-sync:${manifest.planId}:${fixture.index}:${fixture.role}`
    )
      return (
        body?.source === "staff-door" && typeof body.participantId === "string"
      );
  }
  return false;
}
export function verifyChallenge(challenge, address) {
  check(
    /^[0-9a-f]{40}$/i.test(challenge?.nonce ?? "") &&
      Number.isSafeInteger(challenge.expiresAt) &&
      challenge.expiresAt > Date.now() &&
      challenge.expiresAt <= Date.now() + 301000,
    "Server-issued wallet challenge is missing, expired or malformed.",
  );
  const exact = `Kleros Chiado testnet workbench\nDomain: ${new URL(APP_ORIGIN).host}\nURI: ${APP_ORIGIN}\nChain ID: 10200\nWallet: ${ethers.getAddress(address)}\nNonce: ${challenge.nonce}\nExpires: ${new Date(challenge.expiresAt).toISOString()}\nAuthenticate this testnet wallet. No financial transaction.`;
  check(
    challenge.message === exact,
    "Only the exact app-issued origin/chain/wallet nonce message may be signed.",
  );
  return exact;
}
export function financialFacts(detail) {
  const keys = [
    "phase",
    "owner",
    "pendingOwner",
    "stakerCount",
    "attendeeCount",
    "poolWei",
    "balanceWei",
    "pendingTotalWei",
    "pendingChallenges",
    "heldBackWei",
    "reservedWei",
    "owedTotalWei",
    "challengeEscrowWei",
    "challengeDepositWei",
    "payoutShareWei",
  ];
  for (const key of keys)
    check(
      Object.hasOwn(detail.state ?? {}, key),
      "Authoritative financial projection is incomplete.",
    );
  return Object.fromEntries(keys.map((key) => [key, detail.state[key]]));
}
export function validateBootstrap(data, manifest, instanceId = null) {
  check(
    data.mode === "hosted-testnet" &&
      data.chain?.chainId === 10200 &&
      data.chain.rpcUrl === manifest.chain.rpcUrl &&
      data.chain.nativeCurrency?.symbol === "XDAI",
    "Public app is not the reviewed Chiado testnet runtime.",
  );
  check(
    data.arbitration?.mode === "controlled" &&
      data.capabilities?.sharedDemo === false &&
      Array.isArray(data.identities) &&
      data.identities.length === 0,
    "Public app must use signed wallet authentication and explicit controlled arbitration.",
  );
  check(
    data.events?.length === manifest.events.length &&
      manifest.events.every((record) =>
        data.events.some(
          (event) =>
            event.id === record.definition.id &&
            same(event.contract, record.deployment.contract) &&
            event.chainId === 10200 &&
            event.contractVersion === "kleros-event-v8" &&
            event.abiVersion === "kleros-event-v8",
        ),
      ),
    "Public event registry differs from the exact reviewed v8 children.",
  );
  if (instanceId)
    check(
      data.instanceId === instanceId,
      "Backend restarted during fixture synchronization; inspect persisted records before resuming.",
    );
  return data;
}

export function createAppClient({
  manifest,
  execute = false,
  fetcher = fetch,
}) {
  const cookies = new Map();
  const issued = new Map();
  const request = async (pathname, { method = "GET", body, role } = {}) => {
    const url = new URL(pathname, APP_ORIGIN);
    check(
      url.origin === APP_ORIGIN &&
        url.pathname === pathname &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password,
      "App requests must remain on the exact authorized Netlify origin.",
    );
    check(
      allowedAppRequest({ method, pathname, body, role, manifest, execute }),
      "Endpoint/method is outside the off-chain fixture allowlist.",
    );
    if (pathname === "/api/auth/verify")
      check(
        issued.get(role)?.nonce === body.nonce,
        "Verification nonce was not issued for this fixture role.",
      );
    const response = await fetcher(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
      headers: {
        accept: "application/json",
        ...(method === "GET"
          ? {}
          : { origin: APP_ORIGIN, "content-type": "application/json" }),
        ...(cookies.has(role) ? { cookie: cookies.get(role) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    check(
      response.status >= 200 && response.status < 300,
      `Off-chain fixture request stopped at ${method} ${pathname} (HTTP${response.status}); inspect existing records before resuming.`,
    );
    const data = await response.json();
    if (pathname === "/api/auth/verify") {
      const setCookie = response.headers.get("set-cookie") ?? "";
      check(
        /;\s*Secure/i.test(setCookie) &&
          /;\s*HttpOnly/i.test(setCookie) &&
          /;\s*SameSite=Strict/i.test(setCookie),
        "Wallet session must use Secure/HttpOnly/SameSite cookies.",
      );
      const cookie = setCookie
        .match(/(?:^|,\s*)kleros_session=[^;,\s]+/)?.[0]
        .replace(/^,\s*/, "");
      check(
        cookie,
        "Wallet authentication did not issue a usable in-memory session.",
      );
      cookies.set(role, cookie);
      issued.delete(role);
    }
    return data;
  };
  return {
    bootstrap: () => request("/api/bootstrap"),
    detail: (record, role) => request(eventPath(record), { role }),
    async login(role, wallet) {
      check(
        execute && same(wallet.address, manifest.rehearsalAddresses[role]),
        "Only a prepared fixture wallet may authenticate.",
      );
      const challenge = await request("/api/auth/challenge", {
        method: "POST",
        role,
        body: { wallet: wallet.address },
      });
      const message = verifyChallenge(challenge, wallet.address);
      issued.set(role, challenge);
      // Authentication only. No wallet provider, transaction signer or RPC-send API is used.
      const signature = await wallet.signMessage(message);
      check(
        same(ethers.verifyMessage(message, signature), wallet.address),
        "Nonce signature does not belong to the fixture wallet.",
      );
      const result = await request("/api/auth/verify", {
        method: "POST",
        role,
        body: { nonce: challenge.nonce, signature },
      });
      check(
        result.mode === "wallet" && same(result.wallet, wallet.address),
        "Authenticated session differs from the signed wallet.",
      );
    },
    register: (record, role) =>
      request(eventPath(record, "/participants"), {
        method: "POST",
        role,
        body: contact(role),
      }),
    link: (record, role, hash) =>
      request(eventPath(record, "/deposits"), {
        method: "POST",
        role,
        body: { txHash: hash },
      }),
    approve: (record, role, participantId) =>
      request(
        eventPath(record, `/participants/${encodeURIComponent(participantId)}`),
        { method: "PATCH", role, body: { admission: "approved" } },
      ),
    checkin: (record, role, body) =>
      request(eventPath(record, "/checkins"), { method: "POST", role, body }),
    async receiptProof(record, role, entry) {
      check(
        entry?.state === "confirmed" &&
          isHash(entry.hash) &&
          isHash(entry.blockHash) &&
          Number.isSafeInteger(entry.blockNumber),
        "Fixture deposit must have a confirmed canonical journal entry.",
      );
      const calls = [
        { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "eth_getTransactionReceipt",
          params: [entry.hash],
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "eth_getTransactionByHash",
          params: [entry.hash],
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "eth_getBlockByNumber",
          params: [ethers.toQuantity(entry.blockNumber), false],
        },
      ];
      const raw = await request("/rpc", { method: "POST", body: calls });
      check(
        Array.isArray(raw) &&
          raw.length === 4 &&
          raw.every((item) => !item.error),
        "Read-only testnet RPC did not return canonical proof.",
      );
      const results = new Map(raw.map((item) => [item.id, item.result]));
      const receipt = results.get(2),
        tx = results.get(3),
        block = results.get(4);
      check(
        BigInt(results.get(1)) === 10200n &&
          receipt &&
          tx &&
          block &&
          receipt.status === "0x1" &&
          Number(BigInt(receipt.blockNumber)) === entry.blockNumber &&
          same(receipt.blockHash, entry.blockHash) &&
          same(block.hash, entry.blockHash),
        "Existing deposit is not a successful canonical Chiado receipt.",
      );
      check(
        BigInt(tx.chainId) === 10200n &&
          same(tx.hash, entry.hash) &&
          same(receipt.transactionHash, entry.hash) &&
          same(tx.from, manifest.rehearsalAddresses[role]) &&
          same(receipt.from, tx.from) &&
          same(tx.to, record.deployment.contract) &&
          same(receipt.to, tx.to) &&
          tx.input === "0xd0e30db0" &&
          BigInt(tx.value) === BigInt(entry.expected.value),
        "Existing deposit sender/contract/value/calldata differs from the reviewed fixture.",
      );
      check(
        entry.blockNumber >= record.deployment.deploymentBlock &&
          Number(BigInt(block.timestamp)) >= record.deployment.depositOpensAt &&
          Number(BigInt(block.timestamp)) < record.deployment.eventStart,
        "Deposit falls outside the immutable reviewed event window.",
      );
      const iface = new ethers.Interface([
        "event Deposited(address indexed from, uint256 amount)",
      ]);
      const logs = receipt.logs
        .filter((log) => same(log.address, record.deployment.contract))
        .map((log) => {
          try {
            return iface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter(
          (log) => log?.name === "Deposited" && same(log.args.from, tx.from),
        );
      check(
        logs.length === 1 && logs[0].args.amount === BigInt(tx.value),
        "Canonical receipt lacks the expected actual deposit log.",
      );
    },
    async close() {
      for (const role of [...cookies.keys()]) {
        try {
          await request("/api/session", { method: "DELETE", role });
        } catch {}
        cookies.delete(role);
      }
      issued.clear();
    },
  };
}

export async function syncFixtures({
  manifest,
  journal,
  roles,
  client,
  execute,
}) {
  check(
    manifest.environment === "testnet" &&
      manifest.chain.chainId === 10200 &&
      manifest.arbitration.mode === "controlled" &&
      manifest.events.length === 2,
    "Only the reviewed two-event controlled Chiado fixture is supported.",
  );
  const bootstrap = validateBootstrap(await client.bootstrap(), manifest);
  const before = Object.fromEntries(
    await Promise.all(
      manifest.events.map(async (record) => {
        const detail = await client.detail(record);
        check(
          detail.state.phase === "Open",
          "Keep events Open until off-chain fixture synchronization completes.",
        );
        return [record.definition.id, financialFacts(detail)];
      }),
    ),
  );
  if (!execute)
    return {
      status: "review-only-no-mutations",
      origin: APP_ORIGIN,
      chainId: 10200,
      intendedFixtures: FIXTURES.map((fixture) => ({
        eventId: manifest.events[fixture.index].definition.id,
        role: fixture.role,
        wallet: manifest.rehearsalAddresses[fixture.role],
        existingReceipt: journal.transactions[fixture.action]?.hash,
        trustedDoorObservation: fixture.attended,
      })),
      before,
      notice:
        "Execution signs only app-issued authentication messages and may write synthetic off-chain records. No contract transaction can be signed or submitted.",
    };
  const actions = [],
    people = new Map();
  const signedIn = new Set();
  const login = async (role) => {
    if (!signedIn.has(role)) {
      await client.login(role, roles[role]);
      signedIn.add(role);
    }
  };
  for (const fixture of FIXTURES) {
    const record = manifest.events[fixture.index],
      key = `${fixture.index}:${fixture.role}`;
    await login(fixture.role);
    let detail = await client.detail(record, fixture.role);
    let person = detail.participants.find((p) =>
      same(p.wallet, roles[fixture.role].address),
    );
    if (!person) {
      await client.register(record, fixture.role);
      actions.push({
        operation: "self-registered-synthetic",
        role: fixture.role,
        eventId: record.definition.id,
      });
    } else
      actions.push({
        operation: "preserved-existing-registration",
        role: fixture.role,
        eventId: record.definition.id,
      });
    detail = await client.detail(record, fixture.role);
    person = detail.participants.find((p) =>
      same(p.wallet, roles[fixture.role].address),
    );
    check(
      person?.identityVerified === true,
      "Fixture participant does not have wallet-proven identity.",
    );
    const entry = journal.transactions[fixture.action];
    await client.receiptProof(record, fixture.role, entry);
    if (!person.deposit) {
      await client.link(record, fixture.role, entry.hash);
      actions.push({
        operation: "linked-existing-canonical-deposit",
        role: fixture.role,
        eventId: record.definition.id,
        hash: entry.hash,
      });
    } else {
      check(
        same(person.deposit.txHash, entry.hash) &&
          person.deposit.verified === true,
        "Existing linked deposit differs or is unavailable; preserve it for review.",
      );
      actions.push({
        operation: "preserved-existing-deposit",
        role: fixture.role,
        eventId: record.definition.id,
        hash: entry.hash,
      });
    }
    people.set(key, person.id);
  }
  for (const [index, record] of manifest.events.entries()) {
    const role = index ? "ownerB" : "ownerA";
    await login(role);
    let detail = await client.detail(record, role);
    check(
      detail.permissions?.owner === true &&
        same(detail.state.owner, roles[role].address),
      "Off-chain approval requires the actual event owner's signed session.",
    );
    for (const fixture of FIXTURES.filter(
      (fixture) => fixture.index === index,
    )) {
      const participantId = people.get(`${index}:${fixture.role}`);
      let person = detail.participants.find((p) => p.id === participantId);
      check(
        person &&
          same(person.wallet, roles[fixture.role].address) &&
          person.deposit?.verified === true,
        "Owner review does not match the verified fixture participant/deposit.",
      );
      if (person.admission === "pending") {
        await client.approve(record, role, participantId);
        actions.push({
          operation: "owner-approved-offchain",
          role: fixture.role,
          eventId: record.definition.id,
        });
      } else
        check(
          person.admission === "approved",
          "Preserve a prior non-pending admission decision for manual review.",
        );
      if (fixture.attended) {
        detail = await client.detail(record, role);
        if (
          detail.attendance.some(
            (observation) => observation.participantId === participantId,
          )
        )
          actions.push({
            operation: "preserved-existing-observation",
            role: fixture.role,
            eventId: record.definition.id,
          });
        else if (
          detail.now >= Date.parse(record.definition.startsAt) / 1000 &&
          detail.now <= Date.parse(record.definition.endsAt) / 1000
        ) {
          await client.checkin(record, role, {
            participantId,
            source: "staff-door",
            nonce: `testnet-sync:${manifest.planId}:${index}:${fixture.role}`,
            note: "Synthetic controlled Chiado rehearsal: organizer observed this fixture at the door.",
          });
          actions.push({
            operation: "recorded-trusted-synthetic-door-observation",
            role: fixture.role,
            eventId: record.definition.id,
          });
        } else
          actions.push({
            operation: "skipped-observation-outside-event-hours",
            role: fixture.role,
            eventId: record.definition.id,
          });
      }
      detail = await client.detail(record, role);
    }
  }
  validateBootstrap(await client.bootstrap(), manifest, bootstrap.instanceId);
  const after = Object.fromEntries(
    await Promise.all(
      manifest.events.map(async (record) => [
        record.definition.id,
        financialFacts(await client.detail(record)),
      ]),
    ),
  );
  check(
    JSON.stringify(before) === JSON.stringify(after),
    "Financial projections changed during off-chain synchronization; inspect the quiet-protocol assumption.",
  );
  return {
    status: "passed-offchain-only",
    origin: APP_ORIGIN,
    chainId: 10200,
    instanceId: bootstrap.instanceId,
    verifiedAt: new Date().toISOString(),
    trustedObservationsReady: !actions.some(
      (action) =>
        action.operation === "skipped-observation-outside-event-hours",
    ),
    actions,
    financialBefore: before,
    financialAfter: after,
    notice:
      "Only wallet authentication messages were signed. Existing public receipts were read; no contract transaction, faucet, time control, ruling or execution endpoint was used. Check-ins are synthetic event observations and do not post financial attendance.",
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { "--execute": "boolean", "--help": "boolean" });
  if (args["--help"]) {
    console.log(
      "Review only: node scripts/testnet-sync-app.mjs\nExplicit off-chain sync: node scripts/testnet-sync-app.mjs --execute\nOnly the authorized Netlify origin and controlled Chiado fixture are supported. No contract transaction can be signed or broadcast.",
    );
    return;
  }
  const manifest = readJson(
    path.join(ROOT, "registry/chiado-v8-controlled.json"),
  );
  const journal = readJson(
    path.join(PRIVATE_ROOT, "chiado-rehearsal-journal.json"),
  );
  check(
    journal.planFingerprint === manifest.planFingerprint,
    "App sync requires the exact deployment's canonical rehearsal receipts.",
  );
  const execute = Boolean(args["--execute"]),
    client = createAppClient({ manifest, execute });
  try {
    const roles = execute
      ? Object.fromEntries(
          Object.entries(secureWalletFile().roles).map(([role, entry]) => [
            role,
            new ethers.Wallet(entry.privateKey),
          ]),
        )
      : {};
    const proof = await syncFixtures({
      manifest,
      journal,
      roles,
      client,
      execute,
    });
    if (execute)
      atomicJson(
        path.join(PRIVATE_ROOT, "chiado-app-sync-proof.json"),
        proof,
        0o644,
      );
    console.log(publicJson(proof));
  } finally {
    await client.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(safeFailure);
