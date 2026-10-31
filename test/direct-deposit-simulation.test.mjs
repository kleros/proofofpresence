import test from "node:test";
import assert from "node:assert/strict";
import { directDepositSimulation } from "../src/direct-deposit-simulation.mjs";
import { productionErrorResponse } from "../src/production-errors.mjs";
const transaction = { to: "0x" + "1".repeat(40), from: "0x" + "2".repeat(40), data: "0xd0e30db0", value: "10000000000000000" };
const tag = "0x123", secret = "DO_NOT_EXPOSE_https://rpc-user:password@private.invalid/api/key";
const fixture = ({ error, result = "0x", balance = "0x2386f26fc10000", balanceError = null } = {}) => {
  const calls = [];
  return { calls, provider: { async send(method, params) {
    calls.push({ method, params });
    if (method === "eth_call") { if (error !== undefined) throw error; return result; }
    assert.equal(method, "eth_getBalance"); if (balanceError) throw balanceError; return balance;
  } } };
};
const code = value => value?.code;
test("exact successful void deposit simulation adds no balance request", async () => {
  const f = fixture(); assert.equal(await directDepositSimulation(f.provider, transaction, tag), null);
  assert.deepEqual(f.calls, [{ method: "eth_call", params: [{ ...transaction, value: "0x2386f26fc10000" }, tag] }]);
});
test("only a thrown call reads one same-block balance and diagnoses insufficient native ETH", async () => {
  const f = fixture({ error: Object.assign(Error(secret), { code: "UNKNOWN_ERROR" }), balance: "0x0" });
  assert.deepEqual(await directDepositSimulation(f.provider, transaction, tag), { code: "INSUFFICIENT_ETH", status: 422 });
  assert.deepEqual(f.calls.map(value => value.method), ["eth_call", "eth_getBalance"]);
  assert.deepEqual(f.calls[1].params, [transaction.from, tag]);
});
test("explicit structured revert bytes distinguish EVM rejection from unavailable RPC", async () => {
  for (const error of [Object.assign(Error(secret), { code: "CALL_EXCEPTION", data: "0x" }),
    { code: "UNKNOWN_ERROR", info: { error: { code: 3, data: "0x12345678", message: secret } } }]) {
    const f = fixture({ error }); assert.equal(code(await directDepositSimulation(f.provider, transaction, tag)), "DEPOSIT_SIMULATION_REVERTED"); assert.equal(f.calls.length, 2);
  }
});
test("missing/null/malformed revert data and outage/rate errors never claim a contract revert", async () => {
  for (const error of [{ code: "CALL_EXCEPTION", data: null, message: secret }, { code: "CALL_EXCEPTION", message: secret },
    { code: 3, data: "0x1" }, { code: "TIMEOUT", data: "0x" }, { code: -32005, data: "0x", message: secret },
    { code: "SERVER_ERROR", cause: { code: 3, data: "0x" } }, Error(secret)]) {
    const f = fixture({ error }); assert.equal(code(await directDepositSimulation(f.provider, transaction, tag)), "DEPOSIT_SIMULATION_UNAVAILABLE"); assert.equal(f.calls.length, 2);
  }
});
test("nonempty or malformed void replies fail closed without additional RPC", async () => {
  for (const result of ["0x00", "0xdeadbeef", "0X", null, false, 0, { result: "0x" }]) {
    const f = fixture({ result }); assert.equal(code(await directDepositSimulation(f.provider, transaction, tag)), "DEPOSIT_SIMULATION_INVALID_REPLY"); assert.equal(f.calls.length, 1);
  }
  const f = fixture({ error: { code: "BAD_DATA", message: secret } });
  assert.equal(code(await directDepositSimulation(f.provider, transaction, tag)), "DEPOSIT_SIMULATION_INVALID_REPLY");
});
test("invalid or unavailable balance never fabricates insufficient funds", async () => {
  for (const balance of [null, "0x", "0x00", "-1", "0x" + "f".repeat(65), 0]) {
    const f = fixture({ error: Error(secret), balance }); assert.equal(code(await directDepositSimulation(f.provider, transaction, tag)), "DEPOSIT_SIMULATION_UNAVAILABLE");
  }
  const f = fixture({ error: Error(secret), balanceError: Error(secret) });
  assert.equal(code(await directDepositSimulation(f.provider, transaction, tag)), "DEPOSIT_SIMULATION_UNAVAILABLE"); assert.equal(f.calls.length, 2);
});
test("provider accessors, poisoned text and causes never enter fixed public responses", async () => {
  let reads = 0;
  const error = Object.defineProperties({}, { code: { get() { reads++; throw Error(secret); } }, message: { get() { reads++; throw Error(secret); } }, data: { get() { reads++; throw Error(secret); } } });
  const f = fixture({ error }); assert.equal(code(await directDepositSimulation(f.provider, transaction, tag)), "DEPOSIT_SIMULATION_UNAVAILABLE"); assert.equal(reads, 0);
  for (const [name, status] of [["INSUFFICIENT_ETH", 422], ["DEPOSIT_SIMULATION_REVERTED", 409], ["DEPOSIT_SIMULATION_UNAVAILABLE", 503], ["DEPOSIT_SIMULATION_INVALID_REPLY", 503]]) {
    const response = productionErrorResponse(Object.assign(Error(secret), { code: name, status: 200, cause: { message: secret } }));
    assert.equal(response.status, status); assert.equal(response.body.code, name); assert(!JSON.stringify(response).includes(secret));
    if (name === "INSUFFICIENT_ETH") assert.match(response.body.error, /Ethereum Mainnet.*deposit plus the network fee/);
  }
});
