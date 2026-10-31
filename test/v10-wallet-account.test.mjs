// Pure EIP-1193 provider fixtures + actual reviewed runtime bytes. No sockets,
// wallet files, real accounts, signing, publication or transaction execution.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import { assertV10WalletAccount } from "../public/v10-wallet-account.js";
import { assertV10WalletAccount as assertCopiedV10WalletAccount } from "../public/first-event/deps/v10-wallet-account.js";

const V10 = "kleros-event-v10-uups";
const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const blockHash = "0x" + "a".repeat(64);
const designation = "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b";
const observedBytes = fs.readFileSync(
  new URL(
    "../artifacts/v10-integration/metamask-runtime-observed.json",
    import.meta.url,
  ),
);
assert.equal(
  createHash("sha256").update(observedBytes).digest("hex"),
  "486913a5210ab05284468ce4a4efa2d9f279de44e120aadf3718d957678495eb",
);
const framework = JSON.parse(observedBytes).contracts;
const runtime = new Map(
  framework.map((row) => [row.address.toLowerCase(), row.code]),
);
const originalCrypto = globalThis.crypto;
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});
process.once("exit", () =>
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
  }),
);
function metadata(active = false) {
  return {
    mode: "hosted-production",
    instanceId: "synthetic-v10-wallet-context",
    contractVersion: V10,
    abiVersion: V10,
    contractProfile: {
      contractVersion: V10,
      abiVersion: V10,
      version: 10,
      financialModel: "v8",
      upgradeable: true,
      verified: true,
      testOnly: false,
      chainId: 1,
      challengeWindowSeconds: 86400,
      matchWindowSeconds: 86400,
    },
    chain: { chainId: 1 },
    environment: { production: true, chainId: 1, network: "ethereum-mainnet" },
    walletSupport: active
      ? {
          type: "eoa-or-metamask-protected-self-v1.3",
          eoa: true,
          eip7702: true,
          erc1271: false,
          accountPolicyVersion: "v10-metamask-self-v1.3-1",
        }
      : { type: "eoa-only", eoa: true, eip7702: false, erc1271: false },
    capabilities: {
      production: true,
      browserWallet: true,
      walletTransactions: true,
      serverSigning: false,
      supportedAccountTypes: active
        ? ["eoa", "metamask-protected-self-v1.3"]
        : ["eoa"],
      eip7702: active,
      erc1271: false,
      contractWallets: false,
    },
  };
}
function fixture({
  code = "0x",
  active = false,
  transform = (_method, _params, result) => result,
} = {}) {
  const calls = [],
    bootstrap = metadata(active);
  const provider = {
    async request({ method, params }) {
      calls.push({ method, params: structuredClone(params) });
      let result;
      if (method === "eth_chainId") result = "0x1";
      else if (method === "eth_accounts") result = [wallet];
      else if (method === "eth_getBlockByNumber")
        result = { number: "0x64", hash: blockHash };
      else if (method === "eth_getCode")
        result = params[0] === wallet ? code : runtime.get(params[0]);
      else assert.fail("Unexpected provider request: " + method);
      return transform(method, params, result, { calls, bootstrap });
    },
  };
  return {
    calls,
    bootstrap,
    provider,
    run: () => assertV10WalletAccount({ provider, wallet, bootstrap }),
  };
}
const errorCode = (expected) => (error) => error.code === expected;

test("existing EOA path stays fresh, pinned and read-only without framework reads or new authorization claims", async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.run();
    assert.deepEqual(result, {
      wallet,
      accountType: "eoa",
      chainId: 1,
      blockNumber: 100,
      blockHash,
    });
    assert(Object.isFrozen(result));
    assert.equal(Object.hasOwn(result, "financialEligible"), false);
  }
  assert.equal(
    f.calls.filter((call) => call.method === "eth_getCode").length,
    2,
  );
  assert(
    f.calls
      .filter((call) => call.method === "eth_getCode")
      .every((call) => call.params[0] === wallet && call.params[1] === "0x64"),
  );
  assert(
    f.calls.every((call) =>
      [
        "eth_chainId",
        "eth_accounts",
        "eth_getBlockByNumber",
        "eth_getCode",
      ].includes(call.method),
    ),
  );
  assert.equal(
    f.calls.filter((call) => call.method === "eth_accounts").length,
    4,
  );
});

test("delegated classification is default-off, including absent or one-sided metadata", async () => {
  for (const mutate of [
    () => {},
    (b) => delete b.walletSupport,
    (b) => delete b.capabilities,
    (b) => (b.walletSupport.eip7702 = true),
    (b) => (b.capabilities.eip7702 = true),
    (b) => (b.walletSupport.accountPolicyVersion = "v10-metamask-self-v1.3-1"),
  ]) {
    const f = fixture({ code: designation });
    mutate(f.bootstrap);
    await assert.rejects(f.run(), errorCode("UNSUPPORTED_WALLET"));
    assert.equal(
      f.calls.filter((call) => call.method === "eth_getCode").length,
      1,
    );
  }
});

test("only the exact explicit account metadata and three source-bound runtime byte hashes classify the reviewed delegate", async () => {
  const f = fixture({ code: designation, active: true });
  const result = await f.run();
  assert.equal(result.accountType, "metamask-protected-self-v1.3");
  assert.equal(Object.hasOwn(result, "financialEligible"), false);
  assert.deepEqual(
    f.calls
      .filter((call) => call.method === "eth_getCode")
      .map((call) => call.params),
    [
      [wallet, "0x64"],
      ...framework.map((row) => [row.address.toLowerCase(), "0x64"]),
    ],
  );
  await f.run();
  assert.equal(
    f.calls.filter((call) => call.method === "eth_getCode").length,
    8,
    "no TTL or code-result reuse",
  );
});

test("both runtime copies start all three same-block framework reads before any is released", async () => {
  assert.deepEqual(fs.readFileSync(new URL("../public/v10-wallet-account.js", import.meta.url)),
    fs.readFileSync(new URL("../public/first-event/deps/v10-wallet-account.js", import.meta.url)));
  for (const classify of [assertV10WalletAccount, assertCopiedV10WalletAccount]) {
    let release, started, timeout;
    const barrier = new Promise(resolve => { release = resolve; }),
      allStarted = new Promise(resolve => { started = resolve; }), calls = [];
    const f = fixture({ code: designation, active: true, transform: (method, params, result) => {
      if (method !== "eth_getCode" || params[0] === wallet) return result;
      calls.push(structuredClone(params));
      if (calls.length === framework.length) started();
      return barrier.then(() => result);
    } });
    const completion = classify({ provider: f.provider, wallet, bootstrap: f.bootstrap });
    completion.catch(() => {});
    try {
      await Promise.race([allStarted, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error("Framework reads did not start concurrently")), 1000);
      })]);
      assert.deepEqual(calls, framework.map(row => [row.address.toLowerCase(), "0x64"]));
      assert.deepEqual(f.calls.filter(call => call.method === "eth_getBlockByNumber").map(call => call.params), [["latest", false]],
        "Closing canonical and account checks must wait for every blocked framework read");
      assert.equal(f.calls.filter(call => call.method === "eth_accounts").length, 1);
    } finally { clearTimeout(timeout); release(); }
    const result = await completion;
    assert.equal(result.accountType, "metamask-protected-self-v1.3");
    assert.equal(f.calls.filter(call => call.method === "eth_getCode").length, 4);
    assert.equal(f.calls.filter(call => call.method === "eth_accounts").length, 2);
    assert.equal(f.calls.filter(call => call.method === "eth_chainId").length, 2);
    assert.deepEqual(f.calls.filter(call => call.method === "eth_getBlockByNumber").map(call => call.params), [["latest", false], ["0x64", false]]);
  }
});

test("every account-policy agreement is required; arbitrary metadata cannot substitute address or runtime pins", async () => {
  const changes = [
    (b) => (b.walletSupport.type = "metamask"),
    (b) => (b.walletSupport.eoa = false),
    (b) => (b.walletSupport.eip7702 = false),
    (b) => (b.walletSupport.erc1271 = true),
    (b) => delete b.walletSupport.accountPolicyVersion,
    (b) => (b.walletSupport.accountPolicyVersion += "-unknown"),
    (b) => b.capabilities.supportedAccountTypes.reverse(),
    (b) => b.capabilities.supportedAccountTypes.push("erc1271"),
    (b) => (b.capabilities.eip7702 = false),
    (b) => (b.capabilities.erc1271 = true),
    (b) => (b.capabilities.contractWallets = true),
    (b) => (b.capabilities.serverSigning = true),
  ];
  for (const change of changes) {
    const f = fixture({ code: designation, active: true });
    change(f.bootstrap);
    await assert.rejects(f.run(), errorCode("UNSUPPORTED_WALLET"));
  }
  const spoof = fixture({ code: "0xef0100" + other.slice(2), active: true });
  Object.assign(spoof.bootstrap.walletSupport, {
    delegate: other,
    manager: other,
    runtimeHash: "0x" + "b".repeat(64),
  });
  await assert.rejects(spoof.run(), errorCode("UNSUPPORTED_WALLET"));
});

test("V9, wrong network/mode, malformed profile and missing environment cannot invoke the V10-only provider check", async () => {
  for (const change of [
    (b) => (b.contractVersion = "kleros-event-v9-uups"),
    (b) => (b.abiVersion = "kleros-event-v9-uups"),
    (b) => (b.mode = "hosted-demo"),
    (b) => (b.chain.chainId = 10200),
    (b) => (b.environment.production = false),
    (b) => (b.contractProfile.verified = false),
    (b) => delete b.environment,
    (b) => (b.instanceId = ""),
  ]) {
    const f = fixture();
    change(f.bootstrap);
    await assert.rejects(f.run(), errorCode("V10_WALLET_CONTEXT"));
    assert.deepEqual(f.calls, []);
  }
});

test("unknown code, malformed/oversized data and each altered framework runtime fail closed", async () => {
  for (const code of [
    "0x00",
    "0x6000",
    designation + "00",
    "0xef0100" + other.slice(2),
    "0xz0",
    "0x0",
    "0x" + "00".repeat(12001),
  ])
    await assert.rejects(
      fixture({ code, active: true }).run(),
      errorCode("UNSUPPORTED_WALLET"),
    );
  for (const row of framework) {
    const f = fixture({
      code: designation,
      active: true,
      transform: (method, params, value) =>
        method === "eth_getCode" && params[0] === row.address.toLowerCase()
          ? "0x" + (value.slice(2, 4) === "00" ? "01" : "00") + value.slice(4)
          : value,
    });
    await assert.rejects(f.run(), errorCode("UNSUPPORTED_WALLET"));
  }
});

test("fresh and closing chain/account checks reject wrong chain, changed selected wallet and nonselected matching accounts", async () => {
  for (const transform of [
    (method, _params, value) => (method === "eth_chainId" ? "0x2" : value),
    (method, _params, value, { calls }) =>
      method === "eth_chainId" &&
      calls.filter((call) => call.method === method).length === 2
        ? "0x2"
        : value,
  ])
    await assert.rejects(
      fixture({ transform }).run(),
      errorCode("WRONG_CHAIN"),
    );
  for (const transform of [
    (method, _params, value) =>
      method === "eth_accounts" ? [other, wallet] : value,
    (method, _params, value, { calls }) =>
      method === "eth_accounts" &&
      calls.filter((call) => call.method === method).length === 2
        ? [other]
        : value,
  ])
    await assert.rejects(
      fixture({ code: designation, active: true, transform }).run(),
      errorCode("WRONG_WALLET"),
    );
});

test("closing canonical block and safe canonical quantities reject reorg and malformed header facts", async () => {
  for (const patch of [{ hash: "0x" + "b".repeat(64) }, { number: "0x65" }])
    await assert.rejects(
      fixture({
        transform: (method, params, value) =>
          method === "eth_getBlockByNumber" && params[0] !== "latest"
            ? { ...value, ...patch }
            : value,
      }).run(),
      errorCode("V10_WALLET_REORG"),
    );
  for (const number of ["0x00", "0x20000000000000", 100, "not a quantity"])
    await assert.rejects(
      fixture({
        transform: (method, _params, value) =>
          method === "eth_getBlockByNumber" ? { ...value, number } : value,
      }).run(),
      errorCode("V10_WALLET_UNAVAILABLE"),
    );
});

test("bootstrap mutation across an await invalidates the proof, and provider errors never expose raw payloads", async () => {
  for (const mutate of [
    (b) => (b.instanceId += "-changed"),
    (b) => (b.walletSupport.eip7702 = false),
  ]) {
    const f = fixture({
      code: designation,
      active: true,
      transform: (method, _params, value, { bootstrap }) => {
        if (method === "eth_getCode") mutate(bootstrap);
        return value;
      },
    });
    await assert.rejects(f.run(), errorCode("V10_WALLET_CONTEXT"));
  }
  const f = fixture({
    transform: () => {
      throw Error("secret-url/signature/raw-calldata");
    },
  });
  await assert.rejects(f.run(), (error) => {
    assert.equal(error.code, "V10_WALLET_UNAVAILABLE");
    assert.doesNotMatch(error.message, /secret|signature|calldata/);
    return true;
  });
});
