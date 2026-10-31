// Supplemental, factual audit of an already verified deployment. No signer/send API.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { ethers } from "ethers";
import {
  verifyV10ArtifactSources,
  loadV10UpgradeableArtifacts,
} from "../../src/v10-upgrade-artifacts.mjs";
import { v10RuntimeCode } from "./v10-runtime-code.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PLAN =
  "artifacts/v10-release/user-2bb-nonce6-reviewed-account-proposed.json";
const PLAN_PIN =
  "2e525e6de33c768b7a592b075d002540447dea7fd5205716519cef5bc1bf0e37";
const RECEIPT =
  "artifacts/v10-release/step4-receipt-2026-10-29T20-14-35-764Z.json";
const RECEIPT_PIN =
  "95dbbb7f10d33e7e103ab37110170c4c7db4dc9685ed4dac8fdd4ee9dff45414";
const PAYLOAD =
  "artifacts/v10-release/runtime-registry-unpublished-PROPOSAL-payload-20261030.json";
const PAYLOAD_PIN =
  "efb9331ee05d5d0c0002b2a03af2a00e60de1fa135726714ec08eb361d582a44";
const OWNER = "0x2bb03593892724d225071068E59ab1E48aF05b55";
const HASHES = [
  "0xebfc83d4a2a2421447a19ba341beb26ef24f07482beab81da71f01f6a097c91b",
  "0x0ad17defbc7c3ac749896bd44cd0a0ac507b4957814811bb6c2973cfd7712739",
  "0xce482a72e40a9dd27597f252a17e93bfd381606dc0b3c8be589ac0fa40d81c41",
  "0x451ed2afea8f3ae47fd81d59bc95fdfc40c9999883addb89c75da710d7fd447f",
];
const SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SOURCE = [
  "scripts/mainnet/verify-v10-final-snapshot.mjs",
  "src/v10-upgrade-artifacts.mjs",
  "scripts/mainnet/v10-runtime-code.mjs",
];
const FACTORY_SOURCES = [
  "scripts/mainnet/verify-v10-deployed-factory.mjs",
  "src/v10-upgrade-verification.mjs",
  "src/v10-upgrade-artifacts.mjs",
  "src/mainnet-runtime.mjs",
  "src/v10-wallet-deployment.mjs",
];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value);
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const check = (ok, code = "SNAPSHOT_MISMATCH") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
const read = (file) => {
  const resolved = path.resolve(ROOT, file);
  check(
    resolved.startsWith(path.join(ROOT, "artifacts/v10-release") + path.sep),
    "INVALID_PUBLIC_PATH",
  );
  check(
    fs.lstatSync(resolved).isFile() &&
      fs.realpathSync(resolved) === resolved &&
      fs.statSync(resolved).size <= 2000000,
    "INVALID_PUBLIC_FILE",
  );
  const bytes = fs.readFileSync(resolved);
  return {
    path: path.relative(ROOT, resolved),
    sha256: sha(bytes),
    value: JSON.parse(bytes),
  };
};
const sourceHashes = () =>
  Object.fromEntries(
    [...new Set([...SOURCE, ...FACTORY_SOURCES])].map((file) => [
      file,
      sha(fs.readFileSync(path.join(ROOT, file))),
    ]),
  );
const q = (value) => {
  check(
    typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value),
    "INVALID_RPC_QUANTITY",
  );
  return BigInt(value);
};
const header = (block) => {
  check(
    block &&
      ethers.isHexString(block.hash, 32) &&
      q(block.number) > 0n &&
      q(block.number) <= BigInt(Number.MAX_SAFE_INTEGER),
    "INVALID_BLOCK",
  );
  return {
    number: Number(q(block.number)),
    hash: block.hash,
    timestamp: Number(q(block.timestamp)),
  };
};
const methods = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_call",
  "eth_getBalance",
  "eth_getTransactionCount",
]);
async function execute(setupPath, setupSha) {
  const record = {
    kind: "v10-supplemental-final-snapshot",
    status: "unavailable",
    startedAt: new Date().toISOString(),
    sourceHashes: sourceHashes(),
    transport: {
      endpoint: "https://eth.drpc.org/",
      minimumAdmissionIntervalMs: 1500,
      timeoutMs: 120000,
      retries: 0,
    },
    financialRequests: 0,
    privateSigningFilesRead: 0,
    signatures: 0,
    broadcasts: 0,
    financialAuthority: false,
  };
  let count = 0,
    admitted = 0;
  const rpc = async (method, params = []) => {
    check(methods.has(method), "FORBIDDEN_METHOD");
    let wait;
    while ((wait = 1500 - (Date.now() - admitted)) > 0)
      await new Promise((resolve) => setTimeout(resolve, wait));
    admitted = Date.now();
    count++;
    let response;
    try {
      response = await fetch("https://eth.drpc.org/", {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: canonical({ jsonrpc: "2.0", id: count, method, params }),
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      check(false, "RPC_READ_UNAVAILABLE");
    }
    check(response.ok && !response.redirected, "RPC_READ_UNAVAILABLE");
    const text = await response.text();
    check(Buffer.byteLength(text) <= 2000000, "RPC_RESPONSE_SIZE");
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      check(false, "RPC_RESPONSE_INVALID");
    }
    check(
      body.id === count && !body.error && Object.hasOwn(body, "result"),
      "RPC_READ_UNAVAILABLE",
    );
    return body.result;
  };
  try {
    const planFile = read(PLAN),
      receiptFile = read(RECEIPT),
      payloadFile = read(PAYLOAD),
      setupFile = read(setupPath);
    const plan = planFile.value,
      receiptProof = receiptFile.value,
      setup = setupFile.value,
      manifest = payloadFile.value;
    check(
      sha(canonical(plan)) === PLAN_PIN &&
        receiptFile.sha256 === RECEIPT_PIN &&
        payloadFile.sha256 === PAYLOAD_PIN &&
        setupFile.sha256 === setupSha,
      "PREREQUISITE_HASH",
    );
    check(
      plan.chainId === 1 &&
        same(plan.deployer, OWNER) &&
        plan.transactions.length === 4 &&
        plan.contractVersion === "kleros-event-v10-uups",
      "PLAN_SCOPE",
    );
    check(
      receiptProof.kind === "v10-existing-step4-receipt-and-setup-readonly" &&
        receiptProof.result?.status === "confirmed" &&
        same(receiptProof.originalHash, HASHES[3]) &&
        receiptProof.result.state?.planSha256 === PLAN_PIN,
      "RECEIPT_PROOF_SCOPE",
    );
    check(
      setup.kind === "v10-existing-factory-source-verification" &&
        setup.status === "verified" &&
        setup.proof?.deploymentTrust?.status === "verified" &&
        setup.payload === PAYLOAD &&
        setup.payloadSha256 === PAYLOAD_PIN &&
        canonical(setup.factoryDeployment) ===
          canonical(manifest.factoryDeployment),
      "FULL_FACTORY_REQUIRED",
    );
    for (const file of FACTORY_SOURCES)
      check(
        setup.sourceHashes?.[file] ===
          sha(fs.readFileSync(path.join(ROOT, file))),
        "FULL_PROOF_SOURCE_CHANGED",
      );
    const provenance = {
      v10BuildManifestSha256: plan.provenance.v10BuildManifestSha256,
      v10StandardInputSha256: plan.provenance.v10StandardInputSha256,
    };
    check(
      Object.keys(manifest.provenance).length === 2 &&
        manifest.provenance.v10BuildManifestSha256 ===
          provenance.v10BuildManifestSha256 &&
        manifest.provenance.v10StandardInputSha256 ===
          provenance.v10StandardInputSha256,
      "ARTIFACT_SCOPE",
    );
    verifyV10ArtifactSources(provenance);
    const artifacts = loadV10UpgradeableArtifacts(),
      names = ["controller", "event", "factory", "proxy"],
      controllerHash = ethers.keccak256(artifacts.controller.deployedBytecode);
    const rows = receiptProof.result.state.steps;
    check(
      rows.length === 4 && new Set(rows.map((row) => row.step)).size === 4,
      "RECEIPT_ROWS",
    );
    let total = 0n;
    record.recordedCosts = plan.transactions.map((tx, index) => {
      const row = rows.find((row) => row.step === index + 1),
        r = row?.receipt;
      check(
        tx.step === index + 1 &&
          tx.nonce === index + 6 &&
          tx.type === 2 &&
          tx.to === null &&
          tx.value === "0" &&
          tx.chainId === 1 &&
          same(tx.from, OWNER) &&
          same(
            ethers.getCreateAddress({ from: OWNER, nonce: tx.nonce }),
            tx.predictedAddress,
          ) &&
          row.state === "confirmed" &&
          same(row.hash, HASHES[index]) &&
          same(r?.contractAddress, tx.predictedAddress) &&
          ethers.keccak256(
            v10RuntimeCode(
              artifacts[names[index]],
              tx.predictedAddress,
              controllerHash,
            ),
          ) === tx.expectedRuntimeCodeHash,
        "RECORDED_CREATE_SCOPE",
      );
      const cost = BigInt(r.gasUsed) * BigInt(r.gasPrice);
      check(
        cost === BigInt(r.costWei) &&
          BigInt(r.gasUsed) <= BigInt(tx.gasLimit) &&
          BigInt(r.gasPrice) <= BigInt(tx.maxFeePerGasWei),
        "RECORDED_COST",
      );
      total += cost;
      return {
        step: tx.step,
        hash: row.hash,
        contract: tx.predictedAddress,
        blockNumber: r.blockNumber,
        blockHash: r.blockHash,
        gasUsed: r.gasUsed,
        gasPriceWei: r.gasPrice,
        costWei: cost.toString(),
      };
    });
    check(total <= BigInt(plan.maxTotalGasCostWei), "COST_CAP");
    record.totalRecordedCostWei = total.toString();
    record.prerequisites = {
      plan: {
        path: PLAN,
        canonicalSha256: PLAN_PIN,
        rawSha256: planFile.sha256,
      },
      receipt: { path: RECEIPT, sha256: RECEIPT_PIN },
      payload: { path: PAYLOAD, sha256: PAYLOAD_PIN },
      fullFactory: { path: setupFile.path, sha256: setupSha },
    };
    check(q(await rpc("eth_chainId")) === 1n, "WRONG_CHAIN");
    const anchor = header(await rpc("eth_getBlockByNumber", ["latest", false])),
      tag = ethers.toQuantity(anchor.number),
      tx = plan.transactions[3];
    record.anchor = anchor;
    check(
      Number.isSafeInteger(setup.proof.anchor?.number) &&
        setup.proof.anchor.number > 0 &&
        setup.proof.anchor.number <= anchor.number &&
        ethers.isHexString(setup.proof.anchor.hash, 32),
      "FULL_PROOF_ANCHOR",
    );
    check(
      same(
        header(
          await rpc("eth_getBlockByNumber", [
            ethers.toQuantity(setup.proof.anchor.number),
            false,
          ]),
        ).hash,
        setup.proof.anchor.hash,
      ),
      "FULL_PROOF_REORG",
    );
    const actual = await rpc("eth_getTransactionByHash", [HASHES[3]]),
      receipt = await rpc("eth_getTransactionReceipt", [HASHES[3]]);
    check(
      actual &&
        same(actual.hash, HASHES[3]) &&
        same(actual.from, OWNER) &&
        actual.to === null &&
        q(actual.chainId) === 1n &&
        q(actual.type) === 2n &&
        q(actual.nonce) === 9n &&
        q(actual.value) === 0n &&
        same(actual.input, tx.data) &&
        q(actual.gas) <= BigInt(tx.gasLimit) &&
        q(actual.maxFeePerGas) <= BigInt(tx.maxFeePerGasWei) &&
        q(actual.maxPriorityFeePerGas) <= BigInt(tx.maxPriorityFeePerGasWei),
      "ACTUAL_CREATE_MISMATCH",
    );
    const stored = rows.find((row) => row.step === 4).receipt;
    check(
      receipt &&
        q(receipt.status) === 1n &&
        same(receipt.transactionHash, HASHES[3]) &&
        same(receipt.contractAddress, tx.predictedAddress) &&
        same(actual.blockHash, receipt.blockHash) &&
        actual.blockNumber === receipt.blockNumber &&
        Number(q(receipt.blockNumber)) === stored.blockNumber &&
        same(receipt.blockHash, stored.blockHash) &&
        q(receipt.gasUsed) === BigInt(stored.gasUsed) &&
        q(receipt.effectiveGasPrice) === BigInt(stored.gasPrice) &&
        anchor.number - stored.blockNumber + 1 >= 2,
      "ACTUAL_RECEIPT_MISMATCH",
    );
    check(
      same(
        header(await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]))
          .hash,
        receipt.blockHash,
      ),
      "RECEIPT_REORG",
    );
    record.transaction = {
      hash: HASHES[3],
      from: actual.from,
      to: null,
      chainId: 1,
      type: 2,
      nonce: 9,
      valueWei: "0",
      calldataHash: ethers.keccak256(actual.input),
      calldataEqualsPlan: true,
      gasLimit: q(actual.gas).toString(),
      maxFeePerGasWei: q(actual.maxFeePerGas).toString(),
      maxPriorityFeePerGasWei: q(actual.maxPriorityFeePerGas).toString(),
      blockNumber: stored.blockNumber,
      blockHash: stored.blockHash,
      status: 1,
      confirmations: anchor.number - stored.blockNumber + 1,
    };
    record.runtimeHashes = {};
    for (const t of plan.transactions) {
      const codeHash = ethers.keccak256(
        await rpc("eth_getCode", [t.predictedAddress, tag]),
      );
      check(codeHash === t.expectedRuntimeCodeHash, "RUNTIME_CHANGED");
      record.runtimeHashes[t.contract] = codeHash;
    }
    const factory = tx.predictedAddress,
      controller = plan.addresses.KlerosUpgradeControllerV10,
      iface = new ethers.Interface(artifacts.factory.abi),
      gov = new ethers.Interface(artifacts.controller.abi);
    const call = async (address, abi, method) =>
      abi.decodeFunctionResult(
        method,
        await rpc("eth_call", [
          { to: address, data: abi.encodeFunctionData(method) },
          tag,
        ]),
      )[0];
    const slot = await rpc("eth_getStorageAt", [factory, SLOT, tag]);
    check(
      ethers.isHexString(slot, 32) &&
        BigInt(slot) >> 160n === 0n &&
        same(ethers.dataSlice(slot, 12), plan.addresses.KlerosEventFactoryV10),
      "FACTORY_SLOT",
    );
    record.factory = {
      address: factory,
      implementationSlot: slot,
      eventImplementation: await call(factory, iface, "eventImplementation"),
      upgradeAuthority: await call(factory, iface, "upgradeAuthority"),
      version: Number(await call(factory, iface, "VERSION")),
      eventCount: String(await call(factory, iface, "eventCount")),
      balanceWei: q(await rpc("eth_getBalance", [factory, tag])).toString(),
    };
    record.controller = {
      address: controller,
      owner: await call(controller, gov, "owner"),
      pendingOwner: await call(controller, gov, "pendingOwner"),
      delaySeconds: Number(
        await call(controller, gov, "UPGRADE_DELAY_SECONDS"),
      ),
      upgradesDisabled: await call(controller, gov, "upgradesDisabled"),
      version: Number(await call(controller, gov, "VERSION")),
    };
    check(
      same(record.factory.eventImplementation, plan.addresses.KlerosEventV10) &&
        same(record.factory.upgradeAuthority, controller) &&
        record.factory.version === 10 &&
        record.factory.eventCount === "0" &&
        record.factory.balanceWei === "0" &&
        same(record.controller.owner, OWNER) &&
        same(record.controller.pendingOwner, ethers.ZeroAddress) &&
        record.controller.delaySeconds === 0 &&
        record.controller.upgradesDisabled === false &&
        record.controller.version === 10,
      "FINAL_SNAPSHOT_CHANGED",
    );
    check(
      same(
        header(await rpc("eth_getBlockByNumber", [tag, false])).hash,
        anchor.hash,
      ) &&
        same(
          header(
            await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]),
          ).hash,
          receipt.blockHash,
        ) &&
        q(await rpc("eth_chainId")) === 1n,
      "CLOSING_REORG",
    );
    check(
      canonical(sourceHashes()) === canonical(record.sourceHashes) &&
        read(setupPath).sha256 === setupSha &&
        read(RECEIPT).sha256 === RECEIPT_PIN &&
        read(PAYLOAD).sha256 === PAYLOAD_PIN &&
        sha(canonical(read(PLAN).value)) === PLAN_PIN,
      "SOURCE_CHANGED",
    );
    verifyV10ArtifactSources(provenance);
    loadV10UpgradeableArtifacts();
    record.status = "verified";
    record.limitations = [
      "Supplemental pinned-block facts; full source/birth/governance history is linked by prerequisite SHA, not skipped or replaced.",
      "Zero events and balance are observations at this block, not a future guarantee or financial/hosting/publication authorization.",
    ];
  } catch (error) {
    record.code = /^[A-Z_]{1,48}$/.test(error?.code ?? "")
      ? error.code
      : "READ_UNAVAILABLE";
    process.exitCode = 1;
  }
  record.checkedAt = new Date().toISOString();
  record.networkRequests = count;
  const output = path.join(
    ROOT,
    "artifacts/v10-release/final-snapshot-" +
      record.checkedAt.replace(/[:.]/g, "-") +
      "-" +
      randomUUID() +
      ".json",
  );
  fs.writeFileSync(output, canonical(record) + "\n", { flag: "wx" });
  console.log(
    canonical({
      status: record.status,
      code: record.code ?? null,
      proof: path.relative(ROOT, output),
      sha256: sha(fs.readFileSync(output)),
      networkRequests: count,
      signatures: 0,
      broadcasts: 0,
    }),
  );
}
const args = process.argv.slice(2);
if (args.length === 0)
  console.log(
    canonical({
      status: "review-only",
      networkRequests: 0,
      filesystemReads: 0,
      signatures: 0,
      broadcasts: 0,
    }),
  );
else {
  check(
    args.length === 5 &&
      args[0] === "--execute" &&
      args[1] === "--setup-proof" &&
      args[3] === "--setup-proof-sha256" &&
      /^[a-f0-9]{64}$/.test(args[4]),
    "INVALID_ARGUMENTS",
  );
  await execute(args[2], args[4]);
}
