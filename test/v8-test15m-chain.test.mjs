import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import {
  localChain,
  deployEvent,
  contractFor,
  verifyDeployment,
  chainState,
  DAY,
} from "../src/chain.mjs";
import {
  EVENT_V8_VERSION,
  EVENT_V8_TEST15M_VERSION,
  eventV8Profile,
  isV8Version,
  loadV8Artifacts,
} from "../src/contracts-v8.mjs";
import { ROOT, sha256, verifyCompiledInputs } from "../src/testnet-config.mjs";
import { testnetChain, testnetStateStore } from "../src/testnet-runtime.mjs";

const FAST = EVENT_V8_TEST15M_VERSION;
const D = 1_000_000_000_000n;
const clone = (value) => JSON.parse(JSON.stringify(value));
const isCode = (code) => (error) => error.code === code;
const send = async (transaction) => (await transaction).wait();
const overridden = (provider, methods) =>
  new Proxy(provider, {
    get(target, key) {
      if (Object.hasOwn(methods, key)) return methods[key];
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
let chain,
  fast,
  normal,
  historical,
  alice,
  bob,
  extra,
  bridge,
  rpcOrigin,
  agent,
  temp;
const nativeTransport = ethers.FetchRequest.createGetUrlFunc();
const rpcMethods = [];

async function create(id, version, options = {}) {
  const now = (await chain.provider.getBlock("latest")).timestamp;
  const owner = await chain.signers[0].getAddress();
  const start = now + 3600;
  const definition = {
    id,
    slug: id,
    title: `Synthetic ${id}`,
    description: "Local fixture only",
    startsAt: new Date(start * 1000).toISOString(),
    endsAt: new Date((start + 12 * 3600) * 1000).toISOString(),
    timezone: "Asia/Bangkok",
    location: "Synthetic test venue",
    visibility: "public",
    editorialStatus: "published",
    registrationStatus: "open",
    organizers: [owner],
    staff: [],
  };
  return {
    definition,
    ...(await deployEvent(
      chain,
      definition,
      chain.signers[0],
      D,
      start,
      start + 7 * DAY,
      version ? { contractVersion: version, ...options } : undefined,
    )),
    participants: new Map(),
    publications: new Map(),
  };
}
const event = (record, signer = chain.provider) =>
  contractFor(chain, record.deployment, signer);
const manifestFor = (records) => ({
  environment: "testnet",
  chain: {
    chainId: 10200,
    name: "Synthetic local Chiado",
    rpcUrl: rpcOrigin,
    nativeCurrency: { name: "Synthetic XDAI", symbol: "XDAI", decimals: 18 },
  },
  arbitration: {
    mode: "controlled",
    resolver: chain.resolver.target,
    arbitrator: chain.liquid.target,
  },
  events: records.map(({ participants, publications, ...record }) => record),
});

before(async () => {
  chain = await localChain(0, { chainId: 10200 });
  [alice, bob, extra] = await Promise.all(
    chain.signers.slice(3, 6).map((signer) => signer.getAddress()),
  );
  historical = await create("profile-v7");
  normal = await create("profile-v8", EVENT_V8_VERSION);
  fast = await create("profile-test15m", FAST);
  fast.participants.set("extra", { wallet: extra });
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "kleros-test15m-adapter-"));
  const key = path.join(temp, "tls-key.pem"),
    certificate = path.join(temp, "tls-cert.pem");
  execFileSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  fs.chmodSync(key, 0o600);
  bridge = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(certificate) },
    async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks),
          payload = JSON.parse(body);
        for (const entry of Array.isArray(payload) ? payload : [payload])
          rpcMethods.push(entry.method);
        const forward = http.request(
          chain.rpcUrl,
          { method: "POST", headers: { "content-type": "application/json" } },
          (reply) => {
            res.writeHead(reply.statusCode, {
              "content-type": "application/json",
            });
            reply.pipe(res);
          },
        );
        forward.on("error", () => {
          res.writeHead(502);
          res.end();
        });
        forward.end(body);
      } catch {
        res.writeHead(500);
        res.end();
      }
    },
  );
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  rpcOrigin = `https://127.0.0.1:${bridge.address().port}`;
  agent = new https.Agent({ ca: fs.readFileSync(certificate) });
  const trusted = ethers.FetchRequest.createGetUrlFunc({ agent });
  ethers.FetchRequest.registerGetUrl((request, signal) => {
    const origin = new URL(request.url).origin;
    if (origin === rpcOrigin) return trusted(request, signal);
    assert.ok(
      new URL(request.url).protocol === "http:" &&
        new URL(request.url).hostname === "127.0.0.1",
      "No public network access in local profile tests",
    );
    return nativeTransport(request, signal);
  });
});
after(async () => {
  ethers.FetchRequest.registerGetUrl(nativeTransport);
  agent?.destroy();
  if (bridge) await new Promise((resolve) => bridge.close(resolve));
  await chain?.close();
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
});

test(
  "profile dispatch is exact, preserves defaults and separates compiler inputs/artifacts",
  { timeout: 120000 },
  () => {
    for (const unknown of [
      "kleros-event-v8-test15m-other",
      "kleros-event-v80",
      "__proto__",
      null,
      80015,
    ]) {
      assert.equal(eventV8Profile(unknown), null);
      assert.equal(isV8Version(unknown), false);
    }
    assert.equal(eventV8Profile(EVENT_V8_VERSION).version, 8);
    assert.equal(eventV8Profile(EVENT_V8_VERSION).challengeWindowSeconds, DAY);
    assert.deepEqual(
      [
        eventV8Profile(FAST).version,
        eventV8Profile(FAST).challengeWindowSeconds,
        eventV8Profile(FAST).matchWindowSeconds,
        eventV8Profile(FAST).chainId,
      ],
      [80015, 900, 900, 10200],
    );
    assert.ok(Object.isFrozen(eventV8Profile(FAST)));
    assert.throws(
      () => loadV8Artifacts("kleros-event-v8-extra"),
      /Unsupported/,
    );
    const ordinary = verifyCompiledInputs(),
      accelerated = verifyCompiledInputs(ROOT, FAST);
    assert.ok(ordinary.artifacts.KlerosEventV8);
    assert.equal(ordinary.provenance.contractProfile, undefined);
    assert.equal(accelerated.artifacts.KlerosEventV8, undefined);
    assert.ok(accelerated.artifacts.KlerosEventV8Test15m);
    assert.notEqual(
      ordinary.provenance.creationCodeHashes.KlerosEventV8,
      accelerated.provenance.creationCodeHashes.KlerosEventV8Test15m,
    );
    assert.ok(
      Object.keys(accelerated.provenance.sources)
        .filter((name) => name.startsWith("contracts/"))
        .every((name) => name.startsWith("contracts/test/")),
    );
    const fixture = path.join(temp, "compiled");
    fs.mkdirSync(path.join(fixture, "build"), { recursive: true });
    fs.cpSync(
      path.join(ROOT, "build/contracts-test15m"),
      path.join(fixture, "build/contracts-test15m"),
      { recursive: true },
    );
    fs.cpSync(
      path.join(ROOT, "contracts/test"),
      path.join(fixture, "contracts/test"),
      { recursive: true },
    );
    fs.appendFileSync(
      path.join(fixture, "contracts/test/KlerosEventV8Test15m.sol"),
      "\n// changed source fixture\n",
    );
    assert.throws(() => verifyCompiledInputs(fixture, FAST), /sources changed/);
    const manifestPath = path.join(
      fixture,
      "build/contracts-test15m/manifest.json",
    );
    const metadata = JSON.parse(fs.readFileSync(manifestPath));
    metadata.version = 8;
    fs.writeFileSync(manifestPath, JSON.stringify(metadata));
    assert.throws(
      () => verifyCompiledInputs(fixture, FAST),
      /separately reviewed/,
    );
    const sourceName = "contracts/test/KlerosEventV8Test15m.sol";
    const changedFinancialSource = fs
      .readFileSync(path.join(ROOT, sourceName), "utf8")
      .replace(
        "CHALLENGE_PERIOD = 15 minutes",
        "CHALLENGE_PERIOD = 60 minutes",
      );
    const inputPath = path.join(
      fixture,
      "build/contracts-test15m/standard-input.json",
    );
    const input = JSON.parse(fs.readFileSync(inputPath));
    input.sources[sourceName].content = changedFinancialSource;
    metadata.version = 80015;
    metadata.sources[sourceName] = sha256(changedFinancialSource);
    fs.writeFileSync(path.join(fixture, sourceName), changedFinancialSource);
    fs.writeFileSync(inputPath, JSON.stringify(input));
    fs.writeFileSync(manifestPath, JSON.stringify(metadata));
    assert.throws(
      () => verifyCompiledInputs(fixture, FAST),
      /exact allowed transformation/,
    );
  },
);

test("real factories and children retain separate versions, periods and canonical constructor provenance", async () => {
  assert.equal(historical.deployment.contractVersion, "truth-pays-v7");
  assert.equal(await event(normal).VERSION(), 8n);
  assert.equal(await event(fast).VERSION(), 80015n);
  assert.equal(await event(normal).CHALLENGE_PERIOD(), 86400n);
  assert.equal(await event(normal).MATCH_PERIOD(), 86400n);
  assert.equal(await event(fast).CHALLENGE_PERIOD(), 900n);
  assert.equal(await event(fast).MATCH_PERIOD(), 900n);
  assert.notEqual(fast.deployment.factory, normal.deployment.factory);
  assert.notEqual(
    fast.deployment.creationCodeHash,
    normal.deployment.creationCodeHash,
  );
  const factoryTx = await chain.provider.getTransaction(
    fast.deployment.factoryDeploymentTxHash,
  );
  assert.equal(factoryTx.to, null);
  assert.equal(factoryTx.data, loadV8Artifacts(FAST).factory.bytecode);
  assert.equal(ethers.getCreateAddress(factoryTx), fast.deployment.factory);
  await verifyDeployment(chain, historical.deployment);
  await verifyDeployment(chain, normal.deployment);
  await verifyDeployment({ provider: chain.provider }, fast.deployment);
});

test("a supplied test factory address without canonical birth evidence cannot create a child", async () => {
  const factory = await chain.deploy(
    "KlerosEventFactoryV8Test15m",
    chain.signers[0],
  );
  const before = await factory.eventCount(),
    nonce = await chain.provider.getTransactionCount(
      await chain.signers[0].getAddress(),
    );
  await assert.rejects(
    create("no-birth-proof", FAST, { factory: factory.target }),
    isCode("DEPLOYMENT_MISMATCH"),
  );
  assert.equal(await factory.eventCount(), before);
  assert.equal(
    await chain.provider.getTransactionCount(
      await chain.signers[0].getAddress(),
    ),
    nonce,
  );
  await assert.rejects(
    create("wrong-production-factory", FAST, {
      factory: normal.deployment.factory,
    }),
    isCode("WRONG_FACTORY"),
  );
  assert.equal(await factory.eventCount(), 0n);
});

test("cross-profile identities, periods, constructor artifacts and registry edits fail closed", async () => {
  for (const changed of [
    { contractVersion: EVENT_V8_VERSION, abiVersion: EVENT_V8_VERSION },
    { compiler: "unreviewed compiler" },
    { factoryDeploymentTxHash: normal.deployment.deploymentTxHash },
    { factoryDeploymentBlock: fast.deployment.deploymentBlock },
    { creationCodeHash: normal.deployment.creationCodeHash },
  ])
    await assert.rejects(
      verifyDeployment(chain, { ...fast.deployment, ...changed }),
      isCode("DEPLOYMENT_MISMATCH"),
    );
  await assert.rejects(
    verifyDeployment(chain, {
      ...normal.deployment,
      contractVersion: FAST,
      abiVersion: FAST,
    }),
    isCode("DEPLOYMENT_MISMATCH"),
  );
  await assert.rejects(
    verifyDeployment(chain, {
      ...fast.deployment,
      abiVersion: EVENT_V8_VERSION,
    }),
    isCode("UNKNOWN_VERSION"),
  );
  await assert.rejects(
    verifyDeployment(chain, {
      ...fast.deployment,
      contractVersion: "kleros-event-v8-lookalike",
      abiVersion: "kleros-event-v8-lookalike",
    }),
    isCode("UNKNOWN_VERSION"),
  );
  const selector =
    event(fast).interface.getFunction("CHALLENGE_PERIOD").selector;
  const liedAboutPeriod = overridden(chain.provider, {
    call: async (transaction) =>
      transaction.data === selector
        ? ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [86400])
        : chain.provider.call(transaction),
  });
  await assert.rejects(
    verifyDeployment({ provider: liedAboutPeriod }, fast.deployment),
    isCode("DEPLOYMENT_MISMATCH"),
  );
  const liedAboutConstructor = overridden(chain.provider, {
    getTransaction: async (hash) => {
      const tx = await chain.provider.getTransaction(hash);
      return hash === fast.deployment.factoryDeploymentTxHash
        ? { ...tx, data: loadV8Artifacts().factory.bytecode }
        : tx;
    },
  });
  await assert.rejects(
    verifyDeployment({ provider: liedAboutConstructor }, fast.deployment),
    isCode("DEPLOYMENT_MISMATCH"),
  );
});

test("the adapter and both test-profile constructors refuse other chains, including mainnets", async () => {
  for (const chainId of [1, 100, 1337, 11155111]) {
    assert.throws(
      () => contractFor(chain, { ...fast.deployment, chainId }),
      isCode("WRONG_CHAIN"),
    );
    await assert.rejects(
      verifyDeployment(chain, { ...fast.deployment, chainId }),
      isCode("WRONG_CHAIN"),
    );
  }
  const other = await localChain(0, { chainId: 1 });
  try {
    const nonce = await other.provider.getTransactionCount(
      await other.signers[0].getAddress(),
    );
    await assert.rejects(
      deployEvent(
        other,
        fast.definition,
        other.signers[0],
        D,
        fast.deployment.eventStart,
        fast.deployment.claimDeadline,
        { contractVersion: FAST },
      ),
      isCode("WRONG_CHAIN"),
    );
    assert.equal(
      await other.provider.getTransactionCount(
        await other.signers[0].getAddress(),
      ),
      nonce,
    );
    await assert.rejects(
      other.deploy("KlerosEventFactoryV8Test15m", other.signers[0]),
    );
    await assert.rejects(
      other.deploy(
        "KlerosEventV8Test15m",
        other.signers[0],
        D,
        "Forbidden mainnet fixture",
        await other.signers[0].getAddress(),
        fast.deployment.eventStart,
        fast.deployment.claimDeadline,
        [
          other.resolver.target,
          fast.deployment.arbitratorExtraData,
          fast.pieces,
          fast.slots,
          fast.deployment.policyURI,
        ],
      ),
    );
  } finally {
    await other.close();
  }
});

test("external HTTPS runtime binds the exact profile and rechecks both canonical creation anchors", async () => {
  await assert.rejects(
    testnetChain(manifestFor([normal, fast])),
    isCode("MIXED_PROFILES"),
  );
  const manifest = manifestFor([fast]);
  const external = await testnetChain(manifest);
  try {
    assert.deepEqual(external.signers, []);
    assert.equal(external.immutableProvenanceCache.size, 1);
    const initial = await chainState(external, fast);
    assert.equal(initial.pendingTotalWei, "0");
    assert.equal(initial.maxStakers, 150);
    const reorged = overridden(external.provider, {
      getBlock: async (number) => {
        const block = await external.provider.getBlock(number);
        return number === fast.deployment.factoryDeploymentBlock
          ? { ...block, hash: ethers.ZeroHash }
          : block;
      },
    });
    await assert.rejects(
      verifyDeployment({ ...external, provider: reorged }, fast.deployment),
      isCode("DEPLOYMENT_REORG"),
    );
    const changed = {
      ...fast.deployment,
      factoryDeploymentTxHash: ethers.ZeroHash,
    };
    await assert.rejects(
      verifyDeployment(external, changed),
      isCode("DEPLOYMENT_MISMATCH"),
    );
    const storePath = path.join(temp, "profile-state.json");
    testnetStateStore(storePath, manifest).save(new Map(), new Map());
    const replaced = clone(manifest);
    replaced.events[0].deployment.contractVersion = EVENT_V8_VERSION;
    replaced.events[0].deployment.abiVersion = EVENT_V8_VERSION;
    assert.throws(
      () => testnetStateStore(storePath, replaced).load(),
      isCode("STATE_SCOPE"),
    );
    assert.ok(
      rpcMethods.every(
        (method) =>
          !/sendTransaction|sendRawTransaction|evm_|personal_|eth_sign/.test(
            method,
          ),
      ),
    );
  } finally {
    await external.close();
  }
});

test("900-second challenge and match periods preserve held shares, pending credits and late attended payments", async () => {
  for (const record of [normal, fast]) {
    await send(event(record, chain.signers[3]).deposit({ value: D }));
    await send(event(record, chain.signers[4]).deposit({ value: D }));
    await send(event(record, chain.signers[0]).registerStakers([alice, bob]));
  }
  await send(event(fast, chain.signers[5]).deposit({ value: D }));
  await chain.provider.send("evm_increaseTime", [3601]);
  await chain.provider.send("evm_mine", []);
  for (const record of [normal, fast]) {
    const posted = await send(
      event(record, chain.signers[0]).postAttendance([alice], 2n * D),
    );
    const timestamp = (await chain.provider.getBlock(posted.blockNumber))
      .timestamp;
    assert.equal(
      Number(await event(record).challengeEndsAt()) - timestamp,
      record === fast ? 900 : 86400,
    );
    const cost = await event(record).challengeDeposit();
    const challenged = await send(
      event(record, chain.signers[4]).challenge({ value: cost }),
    );
    const challengedAt = (await chain.provider.getBlock(challenged.blockNumber))
      .timestamp;
    assert.equal(
      Number((await event(record).challenges(bob)).matchEndsAt) - challengedAt,
      record === fast ? 900 : 86400,
    );
    await send(
      event(record, chain.signers[0]).matchChallenge(bob, {
        value: cost,
        gasLimit: 3_000_000,
      }),
    );
  }
  const disputed = await chainState(chain, fast),
    ordinaryBefore = await chainState(chain, normal);
  assert.equal(disputed.cases[0].localDisputeID, "1");
  assert.equal(disputed.cases[0].arbitratorDisputeID, "1001");
  assert.equal(
    disputed.cases[0].caseOrganizer,
    await chain.signers[0].getAddress(),
  );
  assert.equal(disputed.pendingTotalWei, String(D));
  assert.equal(disputed.heldBackWei, "0");
  await assert.rejects(
    event(fast, chain.signers[0]).releasePayouts.staticCall(),
  );
  const endsAt = disputed.challengeEndsAt;
  await chain.provider.send("evm_setTime", [endsAt * 1000]);
  await chain.provider.send("evm_mine", []);
  assert.equal((await chain.provider.getBlock("latest")).timestamp, endsAt);
  await assert.rejects(
    event(fast, chain.signers[0]).releasePayouts.staticCall(),
  );
  await chain.provider.send("evm_increaseTime", [1]);
  await chain.provider.send("evm_mine", []);
  await send(
    event(fast, chain.signers[0]).releasePayouts({ gasLimit: 3_000_000 }),
  );
  const held = await chainState(chain, fast);
  assert.equal(held.phase, "Finalized");
  assert.equal(held.heldBackWei, String(D));
  assert.equal(held.pendingTotalWei, String(D));
  assert.equal(held.owedTotalWei, "0");
  assert.equal(held.attendeeCount, 1);
  assert.equal(held.pendingChallenges, 1);
  await assert.rejects(
    event(normal, chain.signers[0]).releasePayouts.staticCall(),
  );
  const challenge = await event(fast).challenges(bob);
  await send(chain.liquid.giveFinalRuling(challenge.arbitratorDisputeID, 1));
  const ruled = await chainState(chain, fast);
  assert.equal(ruled.cases[0].finalRuling, 1);
  assert.equal(ruled.heldBackWei, String(D));
  await send(
    event(fast, chain.signers[0]).resolveChallenge(bob, {
      gasLimit: 3_000_000,
    }),
  );
  const settled = await chainState(chain, fast);
  assert.equal(settled.cases[0].state, "Resolved");
  assert.equal(settled.attendeeCount, 2);
  assert.equal(settled.heldBackWei, "0");
  assert.equal(settled.pendingChallenges, 0);
  assert.equal(settled.challengeEscrowWei, "0");
  assert.equal(settled.pendingTotalWei, String(D));
  assert.equal(settled.reservedWei, String(D));
  assert.equal(settled.balanceWei, String(D));
  const productionAfter = await chainState(chain, normal);
  assert.equal(
    productionAfter.fingerprint,
    ordinaryBefore.fingerprint,
    "The production-profile event retains all financial facts",
  );
  assert.equal(
    (await chainState(chain, historical)).pendingTotalWei,
    undefined,
  );
});
