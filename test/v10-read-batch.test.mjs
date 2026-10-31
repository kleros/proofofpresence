// Real isolated Ganache execution. No public RPC, signer file, deployment of the helper, or cache.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import ganache from "ganache";
import solc from "solc-hardened";
import { ethers } from "ethers";
import { v10ReadBatch, v10CodeHashBatch, V10_READ_BATCH_SOURCE, V10_READ_BATCH_BYTECODE, V10_READ_BATCH_BUILD } from "../src/v10-read-batch.mjs";
import { withReadJobScope } from "../src/read-job-scope.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fixtureSource = `pragma solidity 0.8.38; contract ReadFixture {
 uint256 public number = 7;
 function plus(uint256 x) external view returns(uint256) { return number+x; }
 function label() external pure returns(string memory) { return "actual local read"; }
 function pair() external view returns(uint256,address) { return (number,address(this)); }
 function vector() external pure returns(uint256[] memory v) { v=new uint256[](2);v[0]=3;v[1]=5; }
 function echo(bytes calldata v) external pure returns(bytes memory) { return v; }
 function large(uint256 n) external pure returns(bytes memory) { return new bytes(n); }
 function fail() external pure returns(uint256) { revert("expected local failure"); }
 function set(uint256 n) external { number=n; }
 function write() external returns(uint256) { number++; return number; }
}`;
let rpc, provider, owner, contract, initialBlock;
before(async () => {
  const output = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "ReadFixture.sol": { content: fixtureSource } }, settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  } })));
  assert(!(output.errors ?? []).some(e => e.severity === "error"));
  const artifact = output.contracts["ReadFixture.sol"].ReadFixture;
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" }, wallet: { totalAccounts: 1, defaultBalance: 1000 } });
  provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  owner = await provider.getSigner();
  contract = await new ethers.ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object, owner).deploy();
  await contract.waitForDeployment(); initialBlock = (await provider.getBlock("latest")).number;
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });
function trace() {
  const calls = [];
  return { calls, provider: { send: async (method, params) => {
    assert(["eth_call", "eth_chainId"].includes(method)); calls.push({ method, params });
    return provider.send(method, params);
  } } };
}
const request = (method, args = []) => ({ contract, method, args });

test("pinned helper reproduces from the committed source and development compiler", () => {
  assert.equal(fs.readFileSync(new URL("../scripts/read-batch/V10ReadBatch.sol", import.meta.url), "utf8"), V10_READ_BATCH_SOURCE);
  assert.equal(sha(V10_READ_BATCH_SOURCE), V10_READ_BATCH_BUILD.sourceSha256);
  assert.equal(solc.version(), V10_READ_BATCH_BUILD.compiler);
  const output = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "V10ReadBatch.sol": { content: V10_READ_BATCH_SOURCE } }, settings: V10_READ_BATCH_BUILD.settings })));
  assert.equal("0x" + output.contracts["V10ReadBatch.sol"].V10ReadBatch.evm.bytecode.object, V10_READ_BATCH_BYTECODE);
  assert.equal(sha(Buffer.from(V10_READ_BATCH_BYTECODE.slice(2), "hex")), V10_READ_BATCH_BUILD.bytecodeSha256);
});

test("one deployless call decodes actual scalar, string, tuple and array getters without moving nonce or state", async () => {
  const beforeNonce = await owner.getNonce(), beforeBalance = await provider.getBalance(owner.address), t = trace();
  const values = await v10ReadBatch(t.provider, [request("number"), request("label"), request("pair"), request("vector")], initialBlock);
  assert.equal(values[0], 7n); assert.equal(values[1], "actual local read");
  assert.equal(values[2][0], 7n); assert.equal(values[2][1], contract.target); assert.deepEqual([...values[3]], [3n, 5n]);
  assert.deepEqual(t.calls.map(c => c.method), ["eth_chainId", "eth_call", "eth_chainId"]);
  const [tx, block] = t.calls[1].params;
  assert.deepEqual(Object.keys(tx).sort(), ["data", "gas"]); assert.equal(tx.gas, "0xf42400"); assert.equal(block, ethers.toQuantity(initialBlock));
  assert(tx.data.startsWith(V10_READ_BATCH_BYTECODE));
  assert.equal(await owner.getNonce(), beforeNonce); assert.equal(await provider.getBalance(owner.address), beforeBalance);
  assert.equal(await contract.number(), 7n);
});

test("129 ordered getters use three bounded chunks and every chunk is pinned and chain-checked", async () => {
  const t = trace(), values = await v10ReadBatch(t.provider, Array.from({ length: 129 }, (_, i) => request("plus", [i])), initialBlock);
  assert.deepEqual(values, Array.from({ length: 129 }, (_, i) => BigInt(7 + i)));
  assert.equal(t.calls.filter(c => c.method === "eth_call").length, 3);
  assert.equal(t.calls.filter(c => c.method === "eth_chainId").length, 6);
  assert(t.calls.filter(c => c.method === "eth_call").every(c => c.params[1] === ethers.toQuantity(initialBlock)));
});

test("runtime hashes use one bounded deployless call and match the actual contracts at the same block", async () => {
  const t = trace(), result = await v10CodeHashBatch(t.provider, [contract.target, owner.address], initialBlock);
  assert.equal(result[0], ethers.keccak256(await provider.getCode(contract.target, initialBlock)));
  assert.equal(result[1], ethers.keccak256("0x"));
  assert.equal(t.calls.filter(c => c.method === "eth_call").length, 1);
});

test("historical and fresh blocks remain distinct and no result is cached", async () => {
  const sent = await contract.set(11); await sent.wait(); const fresh = (await provider.getBlock("latest")).number;
  const t = trace();
  assert.equal((await v10ReadBatch(t.provider, [request("number")], initialBlock))[0], 7n);
  assert.equal((await v10ReadBatch(t.provider, [request("number")], fresh))[0], 11n);
  assert.equal(t.calls.filter(c => c.method === "eth_call").length, 2);
});

test("STATICCALL rejects a falsely view-labelled storage write and any target failure rejects the whole batch", async () => {
  const fakeView = new ethers.Contract(contract.target, ["function write() view returns(uint256)"], provider);
  await assert.rejects(v10ReadBatch(provider, [{ contract: fakeView, method: "write" }, request("number")], initialBlock));
  await assert.rejects(v10ReadBatch(provider, [request("number"), request("fail")], initialBlock));
  assert.equal(await contract.number(), 11n);
});

test("empty batches make no RPC and all bounds and ABI methods are validated before the first RPC", async () => {
  let calls = 0; const never = { send: async () => { calls++; throw Error("Unexpected RPC"); } };
  assert.deepEqual(await v10ReadBatch(never, [], initialBlock), []); assert.deepEqual(await v10CodeHashBatch(never, [], initialBlock), []);
  for (const block of [0, -1, "latest", Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(v10ReadBatch(never, [request("number")], block));
  await assert.rejects(v10ReadBatch(never, Array.from({ length: 513 }, () => request("number")), initialBlock));
  await assert.rejects(v10ReadBatch(never, [...Array.from({ length: 65 }, () => request("number")), request("set", [2])], initialBlock));
  await assert.rejects(v10ReadBatch(never, [{ ...request("number"), from: owner.address }], initialBlock));
  await assert.rejects(v10ReadBatch(never, [request("echo", ["0x" + "ab".repeat(5000)])], initialBlock));
  await assert.rejects(v10CodeHashBatch(never, ["not-an-address"], initialBlock));
  assert.equal(calls, 0);
});

test("constructor return-size bounds fail closed without exposing partial results", async () => {
  await assert.rejects(v10ReadBatch(provider, [request("large", [70000])], initialBlock));
  await assert.rejects(v10ReadBatch(provider, Array.from({ length: 9 }, () => request("large", [65000])), initialBlock));
});

test("opening and closing raw chain checks reject a wrong chain or a late chain switch", async () => {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [[contract.interface.encodeFunctionResult("number", [7])]]);
  let calls = 0;
  await assert.rejects(v10ReadBatch({ send: async method => { calls++; assert.equal(method, "eth_chainId"); return "0x2"; } }, [request("number")], initialBlock), { code: "WRONG_CHAIN" });
  assert.equal(calls, 1);
  let chainChecks = 0;
  await assert.rejects(v10ReadBatch({ send: async method => method === "eth_call" ? encoded : ++chainChecks === 1 ? "0x1" : "0x2" }, [request("number")], initialBlock), { code: "WRONG_CHAIN" });
});

test("originating read-scope cancellation stops before RPC or before another chunk/result release", async () => {
  const before = new AbortController(); before.abort(Error("cancelled before batch")); let calls = 0;
  assert.throws(() => withReadJobScope(before.signal, () => v10ReadBatch({ send: async () => { calls++; } }, [request("number")], initialBlock)), /cancelled/);
  assert.equal(calls, 0);
  const during = new AbortController(), encoded = ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [Array.from({ length: 64 }, () => contract.interface.encodeFunctionResult("number", [7]))]);
  await assert.rejects(withReadJobScope(during.signal, () => v10ReadBatch({ send: async method => {
    calls++; if (method === "eth_chainId") return "0x1";
    during.abort(Error("cancelled while reading")); return encoded;
  } }, Array.from({ length: 65 }, () => request("number")), initialBlock)), /cancelled/);
  assert.equal(calls, 2, "Only the opening chain check and first chunk ran");
});
