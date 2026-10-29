import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  assertProductionEOAWallet,
  ProductionWalletError,
} from "../src/production-wallets.mjs";

const wallet = "0x52908400098527886e0f7030069857d2e4169ee7";
const normalized = ethers.getAddress(wallet);
const block = { number: "0x2a", hash: "0x" + "ab".repeat(32) };
const later = { number: "0x2b", hash: "0x" + "cd".repeat(32) };
const clone = (value) => structuredClone(value);

// Only these deterministic response queues exist. No provider, signing keys,
// chain, listener or external network connection is created by this test file.
function providerWith(responses) {
  const calls = [];
  return {
    calls,
    async send(method, params) {
      calls.push({ method, params: clone(params) });
      assert(responses.length, "Unexpected extra RPC request");
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return clone(response);
    },
    async getBlock() {
      assert.fail("Do not use a potentially memoized getBlock");
    },
    async getCode() {
      assert.fail("Do not use a potentially memoized getCode");
    },
  };
}

const errorIs = (code, status) => (error) => {
  assert(error instanceof ProductionWalletError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  return true;
};

test("fresh EOA check pins bytecode and canonical hash to one head, normalizing the wallet", async () => {
  const provider = providerWith([block, "0x", block]);
  assert.deepEqual(await assertProductionEOAWallet(provider, wallet), {
    wallet: normalized,
    blockNumber: 42,
    blockHash: block.hash,
  });
  assert.deepEqual(provider.calls, [
    { method: "eth_getBlockByNumber", params: ["latest", false] },
    { method: "eth_getCode", params: [normalized, "0x2a"] },
    { method: "eth_getBlockByNumber", params: ["0x2a", false] },
  ]);
});

test("a canonical block hash compares case-insensitively and returns normalized metadata", async () => {
  const upper = { ...block, hash: "0x" + "AB".repeat(32) };
  const provider = providerWith([upper, "0x", block]);
  const result = await assertProductionEOAWallet(provider, normalized);
  assert.equal(result.blockHash, block.hash);
});

test("a later check uses a fresh head and cannot reuse an earlier EOA decision", async () => {
  const provider = providerWith([
    block,
    "0x",
    block,
    later,
    "0xef0100" + "12".repeat(20),
    later,
  ]);
  await assertProductionEOAWallet(provider, wallet);
  await assert.rejects(
    assertProductionEOAWallet(provider, wallet),
    errorIs("UNSUPPORTED_WALLET", 422),
  );
  assert.deepEqual(provider.calls[4], {
    method: "eth_getCode",
    params: [normalized, "0x2b"],
  });
  assert.equal(
    provider.calls.filter((call) => call.params[0] === "latest").length,
    2,
  );
});

test("acceptance is never cached between wallets", async () => {
  const other = "0x" + "11".repeat(20);
  const provider = providerWith([block, "0x", block, block, "0x00", block]);
  await assertProductionEOAWallet(provider, wallet);
  await assert.rejects(
    assertProductionEOAWallet(provider, other),
    errorIs("UNSUPPORTED_WALLET", 422),
  );
  assert.equal(provider.calls[4].params[0], other);
});

for (const [kind, code] of [
  ["deployed contract", "0x60006000f3"],
  ["ERC1271 contract", "0x631626ba7e60005260206000f3"],
  ["EIP7702 delegation", "0xef0100" + "34".repeat(20)],
  ["STOP-only contract", "0x00"],
]) {
  test(`${kind} is rejected with typed 422 only after canonical recheck`, async () => {
    const provider = providerWith([block, code, block]);
    await assert.rejects(
      assertProductionEOAWallet(provider, wallet),
      errorIs("UNSUPPORTED_WALLET", 422),
    );
    assert.equal(provider.calls.length, 3);
    assert.deepEqual(provider.calls[2], {
      method: "eth_getBlockByNumber",
      params: ["0x2a", false],
    });
  });
}

for (const [stage, responses] of [
  ["latest block", []],
  ["pinned bytecode", [block]],
  ["canonical recheck", [block, "0x"]],
]) {
  test(`provider failure during ${stage} is sanitized typed 503`, async () => {
    const secret = "https://user:credential@example.invalid/private-rpc";
    const failure = Object.assign(new Error(secret), {
      code: "UNSUPPORTED_WALLET",
      status: 422,
      info: { url: secret, request: { private: "not-public" } },
    });
    const provider = providerWith([...responses, failure]);
    await assert.rejects(
      assertProductionEOAWallet(provider, wallet),
      (error) => {
        errorIs("WALLET_RPC_UNAVAILABLE", 503)(error);
        assert.equal(error.cause, undefined);
        assert(!error.message.includes(secret));
        assert(!JSON.stringify(error).includes("credential"));
        assert(!JSON.stringify(error).includes("not-public"));
        return true;
      },
    );
  });
}

test("missing provider transport fails closed without exposing its internal shape", async () => {
  await assert.rejects(
    assertProductionEOAWallet(null, wallet),
    errorIs("WALLET_RPC_UNAVAILABLE", 503),
  );
});

for (const code of ["0x", "0x6000"]) {
  test(`changed canonical hash rejects a ${code === "0x" ? "code-free" : "coded"} account with 409`, async () => {
    const provider = providerWith([
      block,
      code,
      { ...block, hash: later.hash },
    ]);
    await assert.rejects(
      assertProductionEOAWallet(provider, wallet),
      errorIs("WALLET_REORG", 409),
    );
  });
}

test("a disappeared canonical anchor is a 409 and cannot approve the wallet", async () => {
  const provider = providerWith([block, "0x", null]);
  await assert.rejects(
    assertProductionEOAWallet(provider, wallet),
    errorIs("WALLET_REORG", 409),
  );
});

test("a recheck returning a different block number is a 409 even with the old hash", async () => {
  const provider = providerWith([block, "0x", { ...block, number: "0x2b" }]);
  await assert.rejects(
    assertProductionEOAWallet(provider, wallet),
    errorIs("WALLET_REORG", 409),
  );
});

test("malformed or unavailable head metadata fails closed with sanitized 503", async () => {
  for (const invalid of [
    null,
    {},
    [],
    { ...block, number: "latest" },
    { ...block, number: "0x00" },
    { ...block, number: "0x20000000000000" },
    { ...block, hash: null },
    { ...block, hash: "0xab" },
  ]) {
    const provider = providerWith([invalid]);
    await assert.rejects(
      assertProductionEOAWallet(provider, wallet),
      errorIs("WALLET_RPC_UNAVAILABLE", 503),
    );
    assert.equal(provider.calls.length, 1);
  }
});

test("malformed canonical metadata fails closed rather than producing a success", async () => {
  for (const invalid of [undefined, {}, { ...block, hash: "bad-hash" }]) {
    await assert.rejects(
      assertProductionEOAWallet(providerWith([block, "0x", invalid]), wallet),
      errorIs("WALLET_RPC_UNAVAILABLE", 503),
    );
  }
});

test("only the exact empty-code response is accepted, with malformed data unavailable", async () => {
  for (const code of [undefined, null, false, {}, "", "0x0", "0xgg", "0X"]) {
    await assert.rejects(
      assertProductionEOAWallet(providerWith([block, code, block]), wallet),
      errorIs("WALLET_RPC_UNAVAILABLE", 503),
    );
  }
});

test("invalid address input is rejected before any RPC request", async () => {
  for (const invalid of ["not-an-address", "name.eth", "0x123", "", null]) {
    const provider = providerWith([]);
    await assert.rejects(
      assertProductionEOAWallet(provider, invalid),
      errorIs("INVALID_WALLET", 422),
    );
    assert.equal(provider.calls.length, 0);
  }
});
