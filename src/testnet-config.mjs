import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { ethers } from "ethers";
import solc from "solc";
import hardened from "solc-hardened";
import { EVENT_V8_VERSION, eventV8Profile } from "./contracts-v8.mjs";
import { checkTest15mSources } from "../scripts/generate-contracts-test15m.mjs";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PRIVATE_ROOT = path.join(ROOT, ".runtime/testnet");
export const CHIADO = Object.freeze({
  chainId: 10200,
  name: "Chiado",
  rpcUrl: "https://rpc.chiadochain.net",
  explorer: "https://gnosis-chiado.blockscout.com",
  nativeCurrency: { name: "Chiado xDAI", symbol: "XDAI", decimals: 18 },
  faucet: "https://faucet.gnosischain.com/?chain=chiado",
});
export const EXTRA = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256", "uint256"],
  [0, 3],
);
export const DAY = 86400;
export class TestnetError extends Error {}
export function check(condition, message) {
  if (!condition) throw new TestnetError(message);
}
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export const publicJson = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v), 2) +
  "\n";
export function atomicJson(filename, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + "." + randomUUID() + ".tmp";
  fs.writeFileSync(temporary, publicJson(value), { mode, flag: "wx" });
  fs.renameSync(temporary, filename);
}
export function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}
export function secureWalletFile(
  filename = path.join(PRIVATE_ROOT, "chiado-deployer.json"),
  prepare = false,
) {
  const resolved = path.resolve(filename);
  check(
    resolved.startsWith(path.resolve(PRIVATE_ROOT) + path.sep),
    "Testnet signing files must stay inside ignored .runtime/testnet/.",
  );
  if (!fs.existsSync(resolved)) {
    check(
      prepare,
      "Run --prepare to create the disposable testnet wallet first.",
    );
    const roles = Object.fromEntries(
      ["ownerA", "ownerB", "alice", "bob", "carol"].map((role) => {
        const wallet = ethers.Wallet.createRandom();
        return [
          role,
          { address: wallet.address, privateKey: wallet.privateKey },
        ];
      }),
    );
    atomicJson(resolved, {
      purpose: "Disposable Chiado controlled rehearsal only",
      chainId: 10200,
      roles,
    });
  }
  const info = fs.lstatSync(resolved);
  check(
    info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0,
    "Signing file must be a regular owner-only file (0600).",
  );
  const data = readJson(resolved);
  check(
    data.chainId === 10200 &&
      data.purpose === "Disposable Chiado controlled rehearsal only",
    "Signing file is not the dedicated Chiado rehearsal wallet.",
  );
  for (const role of ["ownerA", "ownerB", "alice", "bob", "carol"]) {
    const entry = data.roles?.[role];
    check(
      entry?.address &&
        entry.privateKey &&
        new ethers.Wallet(entry.privateKey).address === entry.address,
      "A disposable wallet role is invalid.",
    );
  }
  return data;
}
export function parseArgs(argv, allowed) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    check(allowed[flag], `Unknown option: ${flag}`);
    check(!Object.hasOwn(result, flag), `Duplicate option: ${flag}`);
    if (allowed[flag] === "boolean") result[flag] = true;
    else {
      check(
        argv[i + 1] && !argv[i + 1].startsWith("--"),
        `Missing value for ${flag}`,
      );
      result[flag] = argv[++i];
    }
  }
  return result;
}
export function validateChain(chain) {
  check(
    chain?.chainId === 10200,
    "Only Chiado testnet chain10200 is allowed; mainnets and other chains are refused.",
  );
  const rpc = new URL(chain.rpcUrl);
  check(
    rpc.protocol === "https:" && !rpc.username && !rpc.password && !rpc.hash,
    "Use an explicit HTTPS Chiado RPC without embedded credentials.",
  );
  check(
    chain.nativeCurrency?.symbol === "XDAI" &&
      chain.nativeCurrency?.decimals === 18,
    "Chiado native currency must be XDAI with18decimals.",
  );
  return chain;
}
export async function assertTestnet(provider, chain = CHIADO) {
  validateChain(chain);
  check(
    BigInt(await provider.send("eth_chainId", [])) === 10200n,
    "RPC reports a different chain; no testnet operation is allowed.",
  );
}
/** Explicit testnet budget: ignore an arbitrarily high priority-fee oracle. */
export function boundedFees(baseFeePerGas, legacyGasPrice = null) {
  const priority = 100_000n;
  if (baseFeePerGas !== null && baseFeePerGas !== undefined) {
    const base = BigInt(baseFeePerGas);
    check(base >= 0n, "Invalid current testnet base fee.");
    return {
      maxPriorityFeePerGas: priority,
      maxFeePerGas: 2n * base + priority,
    };
  }
  check(
    legacyGasPrice !== null && BigInt(legacyGasPrice) > 0n,
    "Current testnet fees are unavailable.",
  );
  return {
    gasPrice:
      BigInt(legacyGasPrice) < priority ? BigInt(legacyGasPrice) : priority,
  };
}
export async function currentTransactionFees(provider) {
  const block = await provider.getBlock("latest");
  return boundedFees(
    block?.baseFeePerGas,
    block?.baseFeePerGas == null
      ? (await provider.getFeeData()).gasPrice
      : null,
  );
}
export function validatePlan(plan) {
  validateChain(plan.chain);
  check(
    plan.environment === "testnet" && plan.arbitration?.mode === "controlled",
    "This tool only accepts explicit controlled testnet rehearsals.",
  );
  check(
    plan.version === 1 && typeof plan.id === "string",
    "Unsupported testnet plan.",
  );
  check(
    plan.events?.length === 2 &&
      plan.events.every(
        (e) =>
          e.version === "kleros-event-v8" &&
          e.eventStart > 0 &&
          e.claimDeadline >= e.eventStart + 7 * DAY &&
          BigInt(e.depositWei) > 0n,
      ),
    "Invalid v8 event schedule/deposit plan.",
  );
  check(
    new Set(plan.events.map((e) => e.id)).size === 2,
    "Event identities must be independent.",
  );
  check(
    /^https:\/\//.test(plan.policy?.uri) &&
      /^[0-9a-f]{64}$/.test(plan.policy?.sha256),
    "An exact HTTPS policy document and SHA256 are required.",
  );
  for (const role of ["ownerA", "ownerB", "alice", "bob", "carol"])
    check(
      ethers.isAddress(plan.addresses?.[role]),
      "Missing dedicated testnet role address.",
    );
  check(
    new Set(Object.values(plan.addresses).map((a) => a.toLowerCase())).size ===
      5,
    "Use five distinct disposable role wallets.",
  );
  return plan;
}
export function fingerprint(plan) {
  return sha256(publicJson(plan));
}

/** Recompile the exact saved standard input and compare every published creation artifact. */
export function verifyCompiledInputs(
  root = ROOT,
  contractVersion = EVENT_V8_VERSION,
) {
  const profile = eventV8Profile(contractVersion);
  check(profile, "Unsupported v8 compilation profile.");
  const artifactRoot = path.join(root, "build", profile.artifactDirectory);
  const manifest = readJson(path.join(artifactRoot, "manifest.json"));
  const input = readJson(path.join(artifactRoot, "standard-input.json"));
  // Independent of the mutable build manifest: only the generator's exact,
  // pinned-production transformation is an allowed fast-test implementation.
  const testSources = profile.testOnly ? checkTest15mSources() : null;
  check(
    manifest.compiler === hardened.version() &&
      hardened.version().startsWith("0.8.38+"),
    "Compile v8 with the pinned0.8.38 compiler first.",
  );
  if (profile.testOnly) {
    const expectedSources = [profile.contractName, profile.factoryName]
      .map((name) => `${profile.sourceDirectory}/${name}.sol`)
      .sort();
    check(
      manifest.version === profile.version &&
        manifest.profile === profile.contractVersion &&
        manifest.chainId === profile.chainId &&
        manifest.challengePeriod === profile.challengeWindowSeconds &&
        manifest.matchPeriod === profile.matchWindowSeconds &&
        JSON.stringify(Object.keys(manifest.sources).sort()) ===
          JSON.stringify(expectedSources) &&
        JSON.stringify(Object.keys(input.sources).sort()) ===
          JSON.stringify(expectedSources),
      "Test15m compilation must contain only its separately reviewed Chiado-only sources.",
    );
  }
  for (const [name, digest] of Object.entries(manifest.sources)) {
    const content = fs.readFileSync(path.join(root, name), "utf8");
    check(
      sha256(content) === digest && input.sources[name]?.content === content,
      "v8 sources changed since compilation; rerun compile:v8 and review the plan.",
    );
  }
  if (testSources) {
    const productionSources = Object.fromEntries(
      testSources.map((source) => [
        source.productionSource,
        source.productionSha256,
      ]),
    );
    check(
      JSON.stringify(manifest.productionSources) ===
        JSON.stringify(productionSources) &&
        testSources.every(
          (source) =>
            input.sources[source.filename]?.content === source.content,
        ),
      "Test15m source is not the exact allowed transformation of pinned production financial logic.",
    );
  }
  const output = JSON.parse(hardened.compile(JSON.stringify(input)));
  check(
    !(output.errors ?? []).some((e) => e.severity === "error"),
    "The saved v8 standard input does not compile.",
  );
  const artifacts = {};
  for (const name of [profile.contractName, profile.factoryName]) {
    const saved = readJson(path.join(artifactRoot, name + ".json"));
    const compiled =
      output.contracts[`${profile.sourceDirectory}/${name}.sol`][name];
    check(
      saved.bytecode === "0x" + compiled.evm.bytecode.object &&
        JSON.stringify(saved.abi) === JSON.stringify(compiled.abi),
      "v8 artifact differs from exact compilation.",
    );
    if (profile.testOnly)
      check(
        saved.compiler === manifest.compiler &&
          saved.deployedBytecode ===
            "0x" + compiled.evm.deployedBytecode.object,
        "Test15m runtime artifact differs from its exact source compilation.",
      );
    check(
      ethers.keccak256(saved.bytecode) ===
        manifest.contracts[name].creationCodeHash,
      "v8 creation code hash mismatch.",
    );
    artifacts[name] = saved;
  }
  check(
    solc.version().startsWith("0.8.28+"),
    "Controlled V1 mocks require pinned compiler0.8.28.",
  );
  const mockSource = fs.readFileSync(
    path.join(root, "references/kickback/test/MockKleros.sol"),
    "utf8",
  );
  const mockInput = {
    language: "Solidity",
    sources: { "MockKleros.sol": { content: mockSource } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const mocks = JSON.parse(solc.compile(JSON.stringify(mockInput)));
  check(
    !(mocks.errors ?? []).some((e) => e.severity === "error"),
    "Controlled arbitrator compilation failed.",
  );
  for (const name of ["MockKlerosLiquid", "MockArbitrableProxy"]) {
    const saved = readJson(
      path.join(root, "references/kickback/build", name + ".json"),
    );
    const compiled = mocks.contracts["MockKleros.sol"][name];
    check(
      saved.bytecode === "0x" + compiled.evm.bytecode.object &&
        JSON.stringify(saved.abi) === JSON.stringify(compiled.abi),
      "Controlled mock artifact differs from pinned-source compilation.",
    );
    artifacts[name] = saved;
  }
  return {
    artifacts,
    provenance: {
      ...(profile.testOnly ? { contractProfile: profile } : {}),
      ...(testSources ? { productionSources: manifest.productionSources } : {}),
      v8Compiler: manifest.compiler,
      v7MockCompiler: solc.version(),
      sources: {
        ...manifest.sources,
        "references/kickback/test/MockKleros.sol": sha256(mockSource),
      },
      creationCodeHashes: Object.fromEntries(
        Object.entries(artifacts).map(([name, a]) => [
          name,
          ethers.keccak256(a.bytecode),
        ]),
      ),
    },
  };
}
export async function verifyPolicy(policy, fetcher = fetch) {
  const url = new URL(policy.uri);
  check(
    url.protocol === "https:" && !url.username && !url.password && !url.hash,
    "Policy must be a public HTTPS document without credentials.",
  );
  const response = await fetcher(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  check(
    response.status === 200,
    "The exact policy URL is not publicly available; publish it before deploying events.",
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  check(
    bytes.length <= 100000 && sha256(bytes) === policy.sha256,
    "Published policy bytes do not match the reviewed plan.",
  );
}
export function acquireLock(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = fs.openSync(filename, "wx", 0o600);
  } catch {
    throw new TestnetError(
      "Another testnet operation holds the lock. Inspect the public journal before removing a stale lock.",
    );
  }
  fs.writeFileSync(descriptor, String(process.pid));
  return () => {
    fs.closeSync(descriptor);
    fs.rmSync(filename);
  };
}

/** Journal the locally calculated signed hash BEFORE its one and only broadcast. */
export async function sendOnce({
  provider,
  signer,
  journal,
  journalPath,
  action,
  request,
}) {
  await assertTestnet(provider);
  const from = await signer.getAddress();
  const expected = {
    from: from.toLowerCase(),
    to: request.to?.toLowerCase() ?? null,
    data: request.data ?? "0x",
    value: String(request.value ?? 0n),
  };
  let entry = journal.transactions[action];
  if (entry)
    check(
      JSON.stringify(entry.expected) === JSON.stringify(expected),
      "An existing transaction journal conflicts with this action; do not rebroadcast.",
    );
  if (!entry) {
    const prepared = await signer.populateTransaction({
      ...request,
      chainId: 10200,
      ...(await currentTransactionFees(provider)),
    });
    check(
      BigInt(prepared.chainId) === 10200n &&
        BigInt(prepared.gasLimit) <= 16777216n,
      "Transaction exceeds the testnet chain/gas boundary.",
    );
    const maxFee = BigInt(prepared.maxFeePerGas ?? prepared.gasPrice ?? 0);
    check(
      maxFee > 0n &&
        BigInt(prepared.gasLimit) * maxFee <= ethers.parseEther("0.1"),
      "Estimated transaction fee exceeds0.1testXDAI; inspect network fees.",
    );
    check(
      (await provider.getBalance(from)) >=
        BigInt(prepared.value ?? 0n) + BigInt(prepared.gasLimit) * maxFee,
      "Disposable testnet wallet needs more faucet funding.",
    );
    const signed = await signer.signTransaction(prepared);
    entry = journal.transactions[action] = {
      hash: ethers.keccak256(signed),
      nonce: prepared.nonce,
      expected,
      state: "prepared",
      recordedAt: new Date().toISOString(),
    };
    atomicJson(journalPath, journal);
    try {
      await provider.broadcastTransaction(signed);
      entry.state = "submitted";
    } catch {
      entry.state = "submission-uncertain";
      atomicJson(journalPath, journal);
      throw new TestnetError(
        "Submission outcome is uncertain; its hash is journaled. Resume receipt checks only; no automatic rebroadcast is permitted.",
      );
    }
    atomicJson(journalPath, journal);
  }
  let receipt = await provider.getTransactionReceipt(entry.hash);
  if (!receipt || (await receipt.confirmations()) < 2) {
    try {
      receipt = await provider.waitForTransaction(entry.hash, 2, 55000);
    } catch {
      throw new TestnetError(
        "Transaction is pending or unobserved; its hash is saved. Resume later to check this same receipt without rebroadcasting.",
      );
    }
  }
  check(
    receipt && receipt.status === 1,
    "The journaled transaction reverted or has no successful receipt; inspect it before any new action.",
  );
  const tx = await provider.getTransaction(entry.hash);
  const block = await provider.getBlock(receipt.blockNumber);
  check(
    tx &&
      tx.chainId === 10200n &&
      tx.nonce === entry.nonce &&
      tx.from.toLowerCase() === expected.from &&
      (tx.to?.toLowerCase() ?? null) === expected.to &&
      tx.data === expected.data &&
      String(tx.value) === expected.value &&
      block?.hash === receipt.blockHash,
    "Canonical receipt does not match the reviewed testnet operation.",
  );
  entry.state = "confirmed";
  entry.blockNumber = receipt.blockNumber;
  entry.blockHash = receipt.blockHash;
  entry.gasUsed = String(receipt.gasUsed);
  atomicJson(journalPath, journal);
  return receipt;
}
export function loadJournal(filename, plan) {
  const binding = fingerprint(plan);
  const journal = fs.existsSync(filename)
    ? readJson(filename)
    : { chainId: 10200, planFingerprint: binding, transactions: {} };
  check(
    journal.chainId === 10200 && journal.planFingerprint === binding,
    "Journal belongs to another immutable plan; do not reuse it.",
  );
  return journal;
}
export function safeFailure(error) {
  console.error(
    error instanceof TestnetError
      ? error.message
      : "Testnet operation stopped; signing/transport diagnostics are redacted. Inspect the public journal before continuing.",
  );
  process.exitCode = 1;
}
