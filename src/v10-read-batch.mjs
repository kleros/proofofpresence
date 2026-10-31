// Fresh, pinned-block V10 reads. Callers enforce exact V10/chain1 provenance.
// STATICCALL changes msg.sender to this ephemeral helper: caller-sensitive views
// must retain their ordinary direct read. No state, cache, compiler or deployment.
import { ethers } from "ethers";
import { readJobSignal } from "./read-job-scope.mjs";

// BEGIN GENERATED READ BATCH
export const V10_READ_BATCH_SOURCE = "// SPDX-License-Identifier: MIT\npragma solidity 0.8.38;\n\n/// @notice Creation bytecode used only by eth_call, without a recipient or deployment.\n/// Calls are static; code mode reads the target's existing EXTCODEHASH.\ncontract V10ReadBatch {\n    error InvalidBatch();\n    error ReadFailed(uint256 index);\n    error ReturnLimit(uint256 index);\n\n    constructor(address[] memory targets, bytes[] memory inputs, bool codeOnly) {\n        uint256 count = targets.length;\n        if (count == 0 || count > 64 || (codeOnly ? inputs.length != 0 : inputs.length != count)) revert InvalidBatch();\n        bytes[] memory results = new bytes[](count);\n        uint256 totalInput;\n        uint256 totalReturn;\n        for (uint256 i; i < count; ++i) {\n            address target = targets[i];\n            bytes memory result;\n            if (codeOnly) {\n                result = abi.encode(target.codehash);\n            } else {\n                bytes memory input = inputs[i];\n                totalInput += input.length;\n                if (input.length > 4_096 || totalInput > 32_768 || target.code.length == 0) revert InvalidBatch();\n                bool success;\n                uint256 size;\n                assembly (\"memory-safe\") {\n                    success := staticcall(2000000, target, add(input, 32), mload(input), 0, 0)\n                    size := returndatasize()\n                }\n                if (!success) revert ReadFailed(i);\n                if (size > 65_536) revert ReturnLimit(i);\n                result = new bytes(size);\n                assembly (\"memory-safe\") { returndatacopy(add(result, 32), 0, size) }\n            }\n            totalReturn += result.length;\n            if (totalReturn > 524_288) revert ReturnLimit(i);\n            results[i] = result;\n        }\n        bytes memory encoded = abi.encode(results);\n        assembly (\"memory-safe\") { return(add(encoded, 32), mload(encoded)) }\n    }\n}\n";
export const V10_READ_BATCH_BYTECODE = "0x6080806040523461038c576104f6803803809161001c828561041a565b833981019060608183031261038c5780516001600160401b03811161038c5781019082601f8301121561038c57815161005481610453565b92610062604051948561041a565b81845260208085019260051b8201019085821161038c57602001915b8183106103fa5750505060208101516001600160401b03811161038c57810183601f8201121561038c578051906100b482610453565b946100c2604051968761041a565b82865260208087019360051b8301019181831161038c5760208101935b838510610391578787604088015190811515820361038c5780519283158015610382575b8015610368575b6103575761011784610453565b92610125604051948561041a565b848452601f1961013486610453565b0160005b8181106103465750506000809360005b8781106101e3578660405160208101918160408101916020855280518093526060820192602060608260051b8501019201936000905b82821061019f5750505061019b925003601f19810183528261041a565b5190f35b9193509160208080600193605f198a820301865288516101ca81518092818552858086019101610485565b601f80199101160101960192019201859391949261017e565b6001600160a01b036101f582846104a8565b5116600085156102675750610227903f6040519060208201526020815261021d60408261041a565b965b8751906104d2565b956208000087116102525790600191610240828a6104a8565b5261024b81896104a8565b5001610148565b506312266e1960e31b60005260045260246000fd5b96909361028161027784896104a8565b51918251906104d2565b94611000825111801561033b575b8015610332575b61032357818992916020849351920190621e8480fa963d971561030f576201000088116102fb5750610227906102cb8861046a565b976102d9604051998a61041a565b80895260006102e78261046a565b60208b019a90601f1901368c37993e61021f565b6312266e1960e31b81526004839052602490fd5b633be34b4560e01b81526004839052602490fd5b6333b094a160e01b8952600489fd5b50803b15610296565b50618000861161028f565b806060602080938901015201610138565b6333b094a160e01b60005260046000fd5b508215610378578051151561010a565b838151141561010a565b5060408411610103565b600080fd5b84516001600160401b03811161038c5782019083603f8301121561038c576020820151906103be8261046a565b6103cb604051918261041a565b828152604084840101861061038c576103ef60209493859460408685019101610485565b8152019401936100df565b82516001600160a01b038116810361038c5781526020928301920161007e565b601f909101601f19168101906001600160401b0382119082101761043d57604052565b634e487b7160e01b600052604160045260246000fd5b6001600160401b03811161043d5760051b60200190565b6001600160401b03811161043d57601f01601f191660200190565b60005b8381106104985750506000910152565b8181015183820152602001610488565b80518210156104bc5760209160051b010190565b634e487b7160e01b600052603260045260246000fd5b919082018092116104df57565b634e487b7160e01b600052601160045260246000fdfe";
export const V10_READ_BATCH_BUILD = Object.freeze({"compiler":"0.8.38+commit.1835d247.Emscripten.clang","sourceSha256":"d372102b1c9fcfd6e65221ec11e62ef2709ad6102995f7686d487f2c252fd025","bytecodeSha256":"b83a0f6166c3fefc3ac78f00d296d4861a671ced6e2d41b2927934962c0c9307","settings":{"optimizer":{"enabled":true,"runs":200},"viaIR":true,"evmVersion":"paris","metadata":{"bytecodeHash":"none","appendCBOR":false},"outputSelection":{"*":{"*":["abi","evm.bytecode.object"]}}}});
// END GENERATED READ BATCH

const MAX_REQUESTS = 512, MAX_CALLS = 64, MAX_INPUT = 4096, MAX_BATCH_INPUT = 32768;
const MAX_INIT_BYTES = 49152, MAX_OUTPUT_BYTES = 528448, GAS = "0xf42400";
const coder = ethers.AbiCoder.defaultAbiCoder();
const fail = message => { throw Object.assign(new Error(message), { code: "V10_READ_BATCH_INVALID" }); };
function atBlock(blockTag) {
  if (!Number.isSafeInteger(blockTag) || blockTag <= 0) fail("Use a positive pinned block number for V10 batch reads.");
  return ethers.toQuantity(blockTag);
}
function address(value) {
  if (typeof value !== "string" || !ethers.isAddress(value)) fail("Use exact target addresses for V10 batch reads.");
  return ethers.getAddress(value);
}
function inputs(values) {
  if (!Array.isArray(values) || values.length > MAX_REQUESTS) fail("Use at most 512 V10 batch requests.");
  return values;
}
async function chainOne(provider) {
  const value = await provider.send("eth_chainId", []);
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) || BigInt(value) !== 1n)
    throw Object.assign(new Error("The V10 batch provider changed from chain1."), { code: "WRONG_CHAIN", status: 409 });
  readJobSignal()?.throwIfAborted();
}
function readSpec(request) {
  if (!request || typeof request !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(request)) ||
    Reflect.ownKeys(request).some(key => !["contract", "method", "args"].includes(key)) ||
    !["contract", "method"].every(key => Object.hasOwn(request, key)) ||
    Reflect.ownKeys(request).some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(request, key), "value")))
    fail("Use only a contract, view method and argument array for V10 reads.");
  const contract = request.contract, args = request.args ?? [];
  if (typeof request.method !== "string" || !Array.isArray(args) || !contract?.interface?.getFunction || !contract?.interface?.encodeFunctionData)
    fail("Use an ABI-bound view method for V10 reads.");
  const fragment = contract.interface.getFunction(request.method);
  if (!fragment || !["view", "pure"].includes(fragment.stateMutability)) fail("V10 batches permit only view or pure ABI methods.");
  const target = address(contract.target);
  const data = contract.interface.encodeFunctionData(fragment, args);
  if (ethers.dataLength(data) > MAX_INPUT) fail("V10 batch calldata exceeds its per-call limit.");
  return { target, data, decode: value => {
    const decoded = contract.interface.decodeFunctionResult(fragment, value);
    return fragment.outputs.length === 1 ? decoded[0] : decoded;
  } };
}
async function batch(provider, values, blockTag, codeOnly) {
  const pinned = atBlock(blockTag);
  if (values.length === 0) return [];
  if (typeof provider?.send !== "function") fail("Use a read-only JSON-RPC provider for V10 batches.");
  const result = [];
  for (let offset = 0; offset < values.length;) {
    readJobSignal()?.throwIfAborted();
    let end = offset, size = 0;
    while (end < values.length && end - offset < MAX_CALLS) {
      const added = codeOnly ? 0 : ethers.dataLength(values[end].data);
      if (end > offset && size + added > MAX_BATCH_INPUT) break;
      size += added; end++;
    }
    const part = values.slice(offset, end);
    const data = V10_READ_BATCH_BYTECODE + coder.encode(["address[]", "bytes[]", "bool"],
      [part.map(value => value.target), codeOnly ? [] : part.map(value => value.data), codeOnly]).slice(2);
    if (ethers.dataLength(data) > MAX_INIT_BYTES) fail("V10 batch simulation exceeds its creation-input limit.");
    await chainOne(provider);
    // Omitting to executes creation bytecode in eth_call only. No transaction is sent.
    const raw = await provider.send("eth_call", [{ data, gas: GAS }, pinned]);
    readJobSignal()?.throwIfAborted();
    await chainOne(provider);
    if (typeof raw !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(raw) || ethers.dataLength(raw) > MAX_OUTPUT_BYTES)
      fail("V10 batch returned an invalid or oversized result.");
    const decoded = coder.decode(["bytes[]"], raw)[0];
    if (decoded.length !== part.length) fail("V10 batch returned a different number of results.");
    for (let i = 0; i < decoded.length; i++) result.push(codeOnly ? decoded[i] : part[i].decode(decoded[i]));
    offset = end;
  }
  return result;
}

export async function v10ReadBatch(provider, requests, blockTag) {
  // Validate every request before sending any chunk, including later ABI methods.
  return batch(provider, inputs(requests).map(readSpec), blockTag, false);
}
export async function v10CodeHashBatch(provider, addresses, blockTag) {
  return batch(provider, inputs(addresses).map(value => ({ target: address(value) })), blockTag, true);
}
