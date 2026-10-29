// Read-only Ethereum verification. This file has no wallet, signer or transaction submission API.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

export const MAINNET_KLEROS = Object.freeze({
  chainId: 1,
  resolver: "0x4B89e798B10478A839Ea0Abcf86C4B94A3C782A4",
  arbitrator: "0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069",
  resolverCodeHash: "0x9cd25def8eb247416e5321f7166d37c035b10574c41226cd78a33d8bdde3d09e",
  arbitratorCodeHash: "0x20af43c09a24b7f13078a892878a463db494585f1dfbcd9ce89376b356d1f4fe",
  baselineBlock: 26296250,
  baselineBlockHash: "0x8ae4a00aba84e5d2234a6e5a6940d2c22c3ba798a488980858771a8b33f7f4d6",
  subcourt: 0,
  jurors: 3,
  resolverAbiSha256: "2b60e4297a5fb120b3c48ddd3d417ed69c2914a5cfa4e8eaab770ed928020746",
  arbitratorAbiSha256: "8256ce11ae0e719675992245dabe2574b60369f71f5190cf92f5aeda54f88af3",
  officialDocsScalarResolver: "0x99489D7bb33539F3D1A401741E56e8f02B9AE0Cf",
});
export const MAINNET_READ_METHODS = Object.freeze([
  "eth_chainId", "net_version", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getCode", "eth_call", "eth_getStorageAt", "eth_getBalance", "eth_getTransactionCount",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "eth_gasPrice",
  "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getProof", "eth_estimateGas",
]);
const readMethodSet = new Set(MAINNET_READ_METHODS);
export const isMainnetReadMethod = method => readMethodSet.has(method);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ABI = new ethers.Interface([
  "function arbitrator() view returns(address)",
  "function getMultipliers() view returns(uint256,uint256,uint256,uint256)",
  "function arbitrationCost(bytes) view returns(uint256)",
]);
export const MAINNET_EXTRA_DATA = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]);
export const sha256 = value => createHash("sha256").update(value).digest("hex");
const check = (condition, message) => { if (!condition) throw new Error(message); };
export function validatePublicMainnetRpc(url) {
  const parsed = new URL(url);
  check(parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === "/",
    "Use a public root HTTPS Ethereum RPC without credentials, path, query or fragment");
  return parsed.href;
}

/** The same transport can back a LOCAL fork; every upstream method remains read-only. */
export function readOnlyMainnetRpc(url, { fetcher = fetch, timeoutMs = 20_000 } = {}) {
  const endpoint = validatePublicMainnetRpc(url), methods = {}, counts = { requests: 0 };
  let id = 0;
  const request = async (method, params = []) => {
    check(isMainnetReadMethod(method), `Forbidden upstream RPC method: ${method}`);
    counts.requests++; methods[method] = (methods[method] ?? 0) + 1;
    let response;
    try { response = await fetcher(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), redirect: "error",
      signal: AbortSignal.timeout(timeoutMs) }); }
    catch (cause) {
      const error = new Error(`Public Ethereum RPC ${method} transport failed; remote diagnostics withheld`);
      const code = cause?.code ?? cause?.cause?.code;
      if (Number.isFinite(code) || (typeof code === "string" && /^[A-Z0-9_]{1,48}$/.test(code))) error.code = code;
      if (["AbortError", "TimeoutError", "TypeError"].includes(cause?.name)) error.name = cause.name;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Public Ethereum RPC HTTP ${Number(response.status)}`);
      if (Number.isFinite(response.status)) error.status = response.status;
      throw error;
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error("Public Ethereum RPC returned invalid JSON; remote diagnostics withheld"); }
    if (result.error) {
      const error = new Error(`Public Ethereum RPC ${method} failed; remote diagnostics withheld`);
      if (Number.isFinite(result.error.code)) error.code = result.error.code;
      throw error;
    }
    check(Object.hasOwn(result, "result"), "Public Ethereum RPC omitted result");
    return result.result;
  };
  return { request, counts, methods, endpoint };
}

export function resolverAbiEvidence() {
  const filename = path.join(ROOT, "scripts/mainnet/ethereum-resolver.abi.json");
  const abi = JSON.parse(fs.readFileSync(filename, "utf8"));
  const canonical = JSON.stringify(abi);
  check(sha256(canonical) === MAINNET_KLEROS.resolverAbiSha256, "Pinned Etherscan resolver ABI changed");
  const iface = new ethers.Interface(abi);
  for (const signature of ["createDispute(bytes,string,uint256)", "externalIDtoLocalID(uint256)", "disputes(uint256)",
    "getMultipliers()", "submitEvidence(uint256,string)", "fundAppeal(uint256,uint256)",
    "getTotalWithdrawableAmount(uint256,address,uint256[])", "withdrawFeesAndRewardsForAllRounds(uint256,address,uint256[])"])
    check(iface.getFunction(signature), `Real resolver ABI lacks ${signature}`);
  return { filename: "scripts/mainnet/ethereum-resolver.abi.json", canonicalSha256: sha256(canonical),
    source: `https://etherscan.io/address/${MAINNET_KLEROS.resolver}#code`,
    rewardsRulingsType: "uint256[]" };
}

export function arbitratorAbiEvidence() {
  const filename = path.join(ROOT, "scripts/mainnet/ethereum-arbitrator.abi.json");
  const abi = JSON.parse(fs.readFileSync(filename, "utf8"));
  const canonical = JSON.stringify(abi);
  check(sha256(canonical) === MAINNET_KLEROS.arbitratorAbiSha256, "Pinned Etherscan arbitrator ABI changed");
  const iface = new ethers.Interface(abi);
  for (const signature of ["arbitrationCost(bytes)", "appealCost(uint256,bytes)", "appealPeriod(uint256)",
    "currentRuling(uint256)", "passPeriod(uint256)", "executeRuling(uint256)"])
    check(iface.getFunction(signature), `Real arbitrator ABI lacks ${signature}`);
  return { filename: "scripts/mainnet/ethereum-arbitrator.abi.json", canonicalSha256: sha256(canonical),
    source: `https://etherscan.io/address/${MAINNET_KLEROS.arbitrator}#code` };
}

export async function verifyKleros({ rpcUrl = "https://ethereum-rpc.publicnode.com", block = "latest", transport } = {}) {
  const rpc = transport ?? readOnlyMainnetRpc(rpcUrl);
  check(BigInt(await rpc.request("eth_chainId")) === 1n, "RPC is not Ethereum mainnet chain1");
  const tag = block === "latest" ? "latest" : ethers.toQuantity(BigInt(block));
  const header = await rpc.request("eth_getBlockByNumber", [tag, false]);
  check(header?.hash && header.number, "Ethereum canonical block unavailable");
  if (Number(BigInt(header.number)) === MAINNET_KLEROS.baselineBlock)
    check(header.hash === MAINNET_KLEROS.baselineBlockHash, "Ethereum verification baseline block hash changed");
  const fixed = header.number;
  const call = async (address, name, args = []) => ABI.decodeFunctionResult(name,
    await rpc.request("eth_call", [{ to: address, data: ABI.encodeFunctionData(name, args) }, fixed]));
  const [resolverCode, arbitratorCode, link, multipliers, fee] = await Promise.all([
    rpc.request("eth_getCode", [MAINNET_KLEROS.resolver, fixed]),
    rpc.request("eth_getCode", [MAINNET_KLEROS.arbitrator, fixed]),
    call(MAINNET_KLEROS.resolver, "arbitrator"),
    call(MAINNET_KLEROS.resolver, "getMultipliers"),
    call(MAINNET_KLEROS.arbitrator, "arbitrationCost", [MAINNET_EXTRA_DATA]),
  ]);
  check(resolverCode !== "0x" && ethers.keccak256(resolverCode) === MAINNET_KLEROS.resolverCodeHash,
    "Ethereum resolver runtime differs from the reviewed deployed source");
  check(arbitratorCode !== "0x" && ethers.keccak256(arbitratorCode) === MAINNET_KLEROS.arbitratorCodeHash,
    "Ethereum arbitrator runtime differs from the reviewed deployed source");
  check(ethers.getAddress(link[0]) === MAINNET_KLEROS.arbitrator, "Resolver points to another arbitrator");
  check([...multipliers].map(String).join() === "10000,20000,5000,10000", "Kleros appeal multiplier review changed");
  check(fee[0] > 0n, "Kleros fee is unavailable or zero");
  const canonical = await rpc.request("eth_getBlockByNumber", [fixed, false]);
  check(canonical?.hash === header.hash, "Ethereum block reorganized during verification");
  return { status: "verified-read-only", checkedAt: new Date().toISOString(), chainId: 1,
    block: { number: Number(BigInt(header.number)), hash: header.hash, timestamp: Number(BigInt(header.timestamp)),
      ...(header.baseFeePerGas ? { baseFeePerGas: String(BigInt(header.baseFeePerGas)) } : {}) },
    resolver: { address: MAINNET_KLEROS.resolver, codeHash: ethers.keccak256(resolverCode), codeBytes: (resolverCode.length - 2) / 2 },
    arbitrator: { address: MAINNET_KLEROS.arbitrator, codeHash: ethers.keccak256(arbitratorCode), codeBytes: (arbitratorCode.length - 2) / 2 },
    extraData: MAINNET_EXTRA_DATA, subcourt: 0, jurors: 3,
    arbitrationCostWei: String(fee[0]), arbitrationCostEth: ethers.formatEther(fee[0]),
    multipliers: [...multipliers].map(String), abi: resolverAbiEvidence(), arbitratorAbi: arbitratorAbiEvidence(),
    limitations: ["Read-only verification does not exercise a new dispute or a jury vote", "Fees and court parameters require a fresh check at review and signing"],
    upstream: { endpoint: new URL(rpc.endpoint ?? rpcUrl).origin, requests: rpc.counts?.requests, methods: rpc.methods },
    privateFilesRead: 0, signatures: 0, broadcasts: 0 };
}

async function main(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    check(["--verify", "--rpc", "--block", "--output"].includes(flag) && !Object.hasOwn(flags, flag), "Unknown or duplicate verification option");
    flags[flag] = flag === "--verify" ? true : argv[++i];
    check(flags[flag], "Missing verification option value");
  }
  if (!flags["--verify"]) {
    check(argv.length === 0, "Network/output options require explicit --verify");
    console.log(JSON.stringify({ status: "review-only", chainId: 1, resolver: MAINNET_KLEROS.resolver,
      arbitrator: MAINNET_KLEROS.arbitrator, networkRequests: 0, privateFilesRead: 0, signatures: 0, broadcasts: 0,
      instruction: "--verify [--rpc public-https-url] [--block number] [--output artifacts/mainnet-kleros/file.json]" }, null, 2));
    return;
  }
  const proof = await verifyKleros({ ...(flags["--rpc"] ? { rpcUrl: flags["--rpc"] } : {}),
    ...(flags["--block"] ? { block: flags["--block"] } : {}) });
  const bytes = JSON.stringify(proof, null, 2) + "\n";
  if (flags["--output"]) {
    const filename = path.resolve(ROOT, flags["--output"]), base = path.join(ROOT, "artifacts/mainnet-kleros") + path.sep;
    check(filename.startsWith(base) && filename.endsWith(".json"), "Public verification output must stay under artifacts/mainnet-kleros/*.json");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes, { flag: "wx" });
  }
  console.log(bytes);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
