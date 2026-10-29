import { test } from "node:test";
import assert from "node:assert/strict";
import { MAINNET_KLEROS, MAINNET_READ_METHODS, readOnlyMainnetRpc, validatePublicMainnetRpc,
  resolverAbiEvidence, arbitratorAbiEvidence, verifyKleros, isMainnetReadMethod } from "../scripts/mainnet/verify-kleros.mjs";

test("Ethereum read transport refuses every signing, broadcast and emulator method before access", async () => {
  let calls = 0;
  const rpc = readOnlyMainnetRpc("https://ethereum.example.invalid", { fetcher: async () => {
    calls++; return { ok: true, json: async () => ({ result: "0x1" }) };
  } });
  for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "eth_signTransaction",
    "personal_sign", "personal_unlockAccount", "wallet_sendCalls", "evm_setTime", "evm_setAccountStorageAt", "debug_traceTransaction"])
    await assert.rejects(rpc.request(method, []), /Forbidden upstream RPC/);
  assert.equal(calls, 0);
  assert.equal(rpc.counts.requests, 0);
  assert.equal(await rpc.request("eth_chainId"), "0x1");
  assert.equal(calls, 1);
  assert.ok([...MAINNET_READ_METHODS].every(method => !/send|sign|personal|evm_|wallet_|debug/i.test(method)));
  assert.throws(() => MAINNET_READ_METHODS.push("eth_sendRawTransaction"));
  assert.equal(isMainnetReadMethod("eth_estimateGas"), true);
  assert.equal(isMainnetReadMethod("eth_sendRawTransaction"), false);
});

test("Ethereum read transport forbids credential/query URLs and redirect following", async () => {
  for (const url of ["http://ethereum.example.invalid", "https://user:secret@ethereum.example.invalid",
    "https://ethereum.example.invalid?apiKey=secret", "https://ethereum.example.invalid#fragment", "https://ethereum.example.invalid/v2/private-api-key"])
    assert.throws(() => validatePublicMainnetRpc(url));
  const rpc = readOnlyMainnetRpc("https://ethereum.example.invalid", { fetcher: async (_url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(JSON.parse(options.body).method, "eth_chainId");
    return { ok: true, json: async () => ({ result: "0x1" }) };
  } });
  await rpc.request("eth_chainId");
});

test("Ethereum read transport redacts upstream error bodies", async () => {
  const rpc = readOnlyMainnetRpc("https://ethereum.example.invalid", { fetcher: async () => ({ ok: true,
    json: async () => ({ error: { message: "secret-private-provider-material" } }) }) });
  await assert.rejects(rpc.request("eth_chainId"), error => {
    assert.match(error.message, /remote diagnostics withheld/);
    assert.doesNotMatch(error.message, /secret-private/);
    return true;
  });
});

test("Ethereum read transport preserves bounded retry classification without provider messages", async () => {
  for (const status of [429, 502, 503]) {
    const rpc = readOnlyMainnetRpc("https://ethereum.example.invalid", { fetcher: async () => ({ ok: false, status }) });
    await assert.rejects(rpc.request("eth_chainId"), error => error.status === status);
  }
  const coded = readOnlyMainnetRpc("https://ethereum.example.invalid", { fetcher: async () => ({ ok: true,
    json: async () => ({ error: { code: -32005, message: "private-provider-secret" } }) }) });
  await assert.rejects(coded.request("eth_chainId"), error => error.code === -32005 && !error.message.includes("private-provider"));
  const network = readOnlyMainnetRpc("https://ethereum.example.invalid", { fetcher: async () => {
    throw Object.assign(new TypeError("secret-url-path"), { cause: { code: "ECONNRESET" } });
  } });
  await assert.rejects(network.request("eth_chainId"), error => error.name === "TypeError" && error.code === "ECONNRESET" && !error.message.includes("secret-url"));
});

test("Ethereum Kleros verification rejects non-mainnet before reading contracts", async () => {
  for (const chain of ["0x64", "0x27d8", "0x539"]) {
    const methods = [];
    await assert.rejects(verifyKleros({ transport: { request: async method => { methods.push(method); return chain; } } }), /not Ethereum mainnet/);
    assert.deepEqual(methods, ["eth_chainId"]);
  }
});

test("pinned real resolver ABI requires exact array appeal reward methods", () => {
  const evidence = resolverAbiEvidence();
  assert.equal(evidence.canonicalSha256, MAINNET_KLEROS.resolverAbiSha256);
  assert.equal(evidence.rewardsRulingsType, "uint256[]");
  assert.equal(arbitratorAbiEvidence().canonicalSha256, MAINNET_KLEROS.arbitratorAbiSha256);
});

test("Ethereum verification rejects a replaced canonical baseline header before contract reads", async () => {
  const methods = [];
  await assert.rejects(verifyKleros({ block: MAINNET_KLEROS.baselineBlock, transport: { request: async method => {
    methods.push(method);
    return method === "eth_chainId" ? "0x1" : { number: "0x" + MAINNET_KLEROS.baselineBlock.toString(16), hash: "0x" + "ab".repeat(32) };
  } } }), /baseline block hash changed/);
  assert.deepEqual(methods, ["eth_chainId", "eth_getBlockByNumber"]);
});
