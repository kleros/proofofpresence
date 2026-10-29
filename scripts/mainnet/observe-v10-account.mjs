// Preliminary public account/fee observations only; no plan approval or signing interface.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { ethers } from "ethers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WALLET = ethers.getAddress("0x2bb03593892724d225071068E59ab1E48aF05b55");
const RPC = "https://eth.drpc.org/";
const ALLOWED = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getTransactionCount", "eth_getBalance", "eth_maxPriorityFeePerGas"]);
const sha = value => createHash("sha256").update(value).digest("hex");
const check = (ok, code) => { if (!ok) throw Object.assign(new Error("V10 account observation stopped: " + code), { code }); };
const quantity = value => {
  check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "RPC_QUANTITY");
  const result = BigInt(value); check(result < 2n ** 256n, "RPC_QUANTITY"); return result;
};
const header = value => {
  check(value && /^0x[0-9a-f]{64}$/i.test(value.hash ?? ""), "RPC_HEADER");
  const number = quantity(value.number), timestamp = quantity(value.timestamp);
  check(number <= BigInt(Number.MAX_SAFE_INTEGER) && timestamp <= BigInt(Number.MAX_SAFE_INTEGER), "RPC_HEADER_RANGE");
  return { number: Number(number), hash: value.hash.toLowerCase(), timestamp: Number(timestamp),
    baseFeePerGasWei: quantity(value.baseFeePerGas).toString(), gasLimit: quantity(value.gasLimit).toString() };
};

export async function observeV10Account(rpc) {
  let reads = 0;
  const read = async (method, params) => { check(ALLOWED.has(method), "FORBIDDEN_METHOD"); reads++; return rpc.request({ method, params }); };
  check(quantity(await read("eth_chainId", [])) === 1n, "WRONG_CHAIN");
  const anchor = header(await read("eth_getBlockByNumber", ["latest", false])), tag = "0x" + anchor.number.toString(16);
  const code = await read("eth_getCode", [WALLET, tag]);
  check(typeof code === "string" && /^0x(?:[a-f0-9]{2})*$/i.test(code), "RPC_CODE");
  const pinned = quantity(await read("eth_getTransactionCount", [WALLET, tag]));
  const latest = quantity(await read("eth_getTransactionCount", [WALLET, "latest"]));
  const pending = quantity(await read("eth_getTransactionCount", [WALLET, "pending"]));
  const balance = quantity(await read("eth_getBalance", [WALLET, tag]));
  const priorityFee = quantity(await read("eth_maxPriorityFeePerGas", []));
  check(JSON.stringify(header(await read("eth_getBlockByNumber", [tag, false]))) === JSON.stringify(anchor), "CANONICAL_HEAD_CHANGED");
  check(quantity(await read("eth_chainId", [])) === 1n, "WRONG_CHAIN");
  check(pinned === latest && latest === pending && latest <= BigInt(Number.MAX_SAFE_INTEGER - 4), "NONCE_CHANGED_OR_PENDING");
  return { schemaVersion: 1, kind: "v10-preliminary-account-observation", checkedAt: new Date().toISOString(), chainId: 1, wallet: WALLET, anchor,
    account: { category: code === "0x" ? "empty-code-eoa" : /^0xef0100[a-f0-9]{40}$/i.test(code) ? "eip7702-delegated" : "contract-code",
      code, codeHash: ethers.keccak256(code), delegate: /^0xef0100[a-f0-9]{40}$/i.test(code) ? ethers.getAddress("0x" + code.slice(8)) : null },
    nonces: { pinned: pinned.toString(), latest: latest.toString(), pending: pending.toString() }, balanceWei: balance.toString(),
    fees: { baseFeePerGasWei: anchor.baseFeePerGasWei, suggestedPriorityFeePerGasWei: priorityFee.toString() },
    limits: ["Preliminary point-in-time observations only. No exact transaction proposal, future nonce reservation or gas estimate.",
      "Account compatibility, framework source checks, unused predicted addresses and complete bundle preflight remain separate."],
    networkRequests: reads, privateFilesRead: 0, signatures: 0, broadcasts: 0, deploymentAuthorized: false, gasBudgetApproval: "NONE" };
}

async function main(argv) {
  if (!argv.length) return { status: "review-only", instruction: "--execute-readonly", networkRequests: 0, privateFilesRead: 0, signatures: 0, broadcasts: 0 };
  check(argv.length === 1 && argv[0] === "--execute-readonly", "EXPLICIT_READONLY_REQUIRED");
  let id = 0, lastRead = 0;
  const source = fs.readFileSync(fileURLToPath(import.meta.url));
  const result = await observeV10Account({ async request({ method, params }) {
    check(ALLOWED.has(method), "FORBIDDEN_METHOD");
    const delay = 1500 - (Date.now() - lastRead); if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    lastRead = Date.now();
    const requestId = ++id;
    const response = await fetch(RPC, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) });
    check(response.ok, "RPC_UNAVAILABLE");
    const body = await response.text(); check(body.length <= 131072, "RPC_SIZE");
    const value = JSON.parse(body);
    check(value?.jsonrpc === "2.0" && value.id === requestId && !Object.hasOwn(value, "error") && Object.hasOwn(value, "result"), "RPC_RESPONSE");
    return value.result;
  } });
  check(sha(fs.readFileSync(fileURLToPath(import.meta.url))) === sha(source), "SOURCE_CHANGED");
  const directory = path.join(ROOT, "artifacts/v10-release"), filename = "account-observation-" + result.checkedAt.replaceAll(":", "-") + "-" + randomUUID() + ".json";
  fs.mkdirSync(directory, { recursive: true });
  const proof = { ...result, sourceSha256: sha(source), rpcOrigin: RPC };
  fs.writeFileSync(path.join(directory, filename), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
  return { path: "artifacts/v10-release/" + filename, ...proof };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
  .then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error?.code ? error.message : "V10 account observation stopped: READ_FAILED"); process.exitCode = 1; });
