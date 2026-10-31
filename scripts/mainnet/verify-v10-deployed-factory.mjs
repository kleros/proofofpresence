// Existing deployments only. No signer, wallet requests, journal writes or retries.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createReadOnlyHttpProvider } from "../../src/mainnet-runtime.mjs";
import { createV10PacedFetcher } from "../../src/v10-wallet-deployment.mjs";
import {
  verifyV10FactoryDeployment,
  V10_MAINNET_SCOPE,
} from "../../src/v10-upgrade-verification.mjs";
import { verifyV10ArtifactSources } from "../../src/v10-upgrade-artifacts.mjs";
import { validateV10MainnetManifest } from "../../src/v10-mainnet-runtime.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const payload =
  "artifacts/v10-release/runtime-registry-unpublished-PROPOSAL-payload-20261030.json";
const payloadSha256 =
  "efb9331ee05d5d0c0002b2a03af2a00e60de1fa135726714ec08eb361d582a44";
if (
  process.argv.length > 3 ||
  (process.argv[2] && process.argv[2] !== "--execute")
)
  throw Error("Use only explicit --execute for read-only verification");
const bytes = fs.readFileSync(payload);
if (sha(bytes) !== payloadSha256)
  throw Error("Exact public factory proposal changed");
const manifest = validateV10MainnetManifest(JSON.parse(bytes));
verifyV10ArtifactSources(manifest.provenance);
const sourceFiles = [
  "scripts/mainnet/verify-v10-deployed-factory.mjs",
  "src/v10-upgrade-verification.mjs",
  "src/v10-upgrade-artifacts.mjs",
  "src/mainnet-runtime.mjs",
  "src/v10-wallet-deployment.mjs",
];
const record = {
  kind: "v10-existing-factory-source-verification",
  status: "review-only",
  startedAt: new Date().toISOString(),
  sourceHashes: Object.fromEntries(
    sourceFiles.map((file) => [file, sha(fs.readFileSync(file))]),
  ),
  payload,
  payloadSha256,
  factoryDeployment: manifest.factoryDeployment,
  transport: {
    endpoint: "https://eth.drpc.org/",
    historyEndpoint: "https://ethereum-rpc.publicnode.com/",
    timeoutMs: 120000,
    minimumAdmissionIntervalMs: 1500,
    retries: 0,
  },
  financialRequests: 0,
  signatures: 0,
  broadcasts: 0,
};
if (process.argv[2] !== "--execute") {
  console.log(JSON.stringify({ ...record, networkRequests: 0 }, null, 2));
} else {
  let count = 0;
  record.requests = [];
  const paced = createV10PacedFetcher({
    fetcher: async (url, options) => {
      count++;
      const payload = JSON.parse(options.body);
      const row = { endpoint: url, method: payload.method ?? "batch" };
      record.requests.push(row);
      try {
        const response = await fetch(url, options);
        row.httpStatus = response.status;
        try {
          const body = await response.clone().json();
          if (Number.isFinite(body?.error?.code))
            row.rpcErrorCode = body.error.code;
        } catch {
          row.invalidJson = true;
        }
        return response;
      } catch (error) {
        row.transportError = /^[A-Z_0-9]{1,48}$/.test(
          error.code ?? error.cause?.code ?? "",
        )
          ? (error.code ?? error.cause.code)
          : "READ_UNAVAILABLE";
        throw error;
      }
    },
  });
  const provider = createReadOnlyHttpProvider("https://eth.drpc.org/", {
    fetcher: paced,
    timeoutMs: 120000,
  });
  const historyProvider = createReadOnlyHttpProvider(
    "https://ethereum-rpc.publicnode.com/",
    { fetcher: paced, timeoutMs: 120000 },
  );
  try {
    const historyCapability =
      "artifacts/v10-release/public-history-rpc-2026-10-29T20-20-58-723Z.json";
    if (
      sha(fs.readFileSync(historyCapability)) !==
      "a7e5f0b41d5573285dea6dd0b3aea39c2e69aba8f6227b71c78b2038960229ed"
    )
      throw Error("Public history capability changed");
    if (
      BigInt(await provider.send("eth_chainId", [])) !== 1n ||
      BigInt(await historyProvider.send("eth_chainId", [])) !== 1n
    )
      throw Error("History endpoint is not Ethereum");
    const initial = await provider.getBlock("latest"),
      historyInitial = await historyProvider.getBlock(initial.number);
    if (!initial.hash || initial.hash !== historyInitial?.hash)
      throw Error("Public history anchor differs");
    record.historyInitialAnchor = {
      number: initial.number,
      hash: initial.hash,
    };
    // Every history query still runs through a real read-only provider. The
    // unchanged verifier checks every returned log and closes all canonical
    // anchors through the archive provider; no range or topic is omitted.
    provider.getLogs = (filter) => historyProvider.getLogs(filter);
    record.proof = await verifyV10FactoryDeployment(
      {
        provider,
        production: true,
        chainId: 1,
        governance: manifest.governance,
        manifest,
      },
      manifest.factoryDeployment,
      V10_MAINNET_SCOPE,
    );
    if (
      record.proof?.deploymentTrust?.status !== "verified" ||
      record.proof.upgrade?.owner?.toLowerCase() !==
        manifest.governance.initialOwner.toLowerCase() ||
      (record.proof.upgrade?.pendingOwner !== null &&
        record.proof.upgrade?.pendingOwner?.toLowerCase() !==
          "0x0000000000000000000000000000000000000000") ||
      record.proof.upgrade?.upgradesDisabled !== false ||
      record.proof.upgrade?.delaySeconds !== 0 ||
      record.proof.upgrade?.version !== 10 ||
      record.proof.upgrade?.governanceKind !== "single-owner-immediate" ||
      record.proof.eventImplementation?.toLowerCase() !==
        manifest.factoryDeployment.implementation.toLowerCase()
    )
      throw Error("Final factory governance differs");
    const historyClosing = await historyProvider.getBlock(
      record.proof.anchor.number,
    );
    if (
      historyClosing?.hash !== record.proof.anchor.hash ||
      BigInt(await historyProvider.send("eth_chainId", [])) !== 1n
    )
      throw Error("Closing public history anchor differs");
    record.historyClosingAnchor = {
      number: historyClosing.number,
      hash: historyClosing.hash,
    };
    record.status = "verified";
  } catch (error) {
    record.status = "unavailable";
    record.code = /^[A-Z_]{1,48}$/.test(error.code ?? "")
      ? error.code
      : "READ_UNAVAILABLE";
    if (/^[A-Za-z_-]{1,48}$/.test(error.event ?? ""))
      record.event = error.event;
    process.exitCode = 1;
  } finally {
    await provider.destroy();
    await historyProvider.destroy();
    record.checkedAt = new Date().toISOString();
    record.networkRequests = count;
    const output =
      "artifacts/v10-release/full-factory-" +
      record.checkedAt.replace(/[:.]/g, "-") +
      ".json";
    fs.writeFileSync(output, JSON.stringify(record, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      JSON.stringify(
        {
          proofFile: output,
          proofSha256: sha(fs.readFileSync(output)),
          status: record.status,
          code: record.code ?? null,
          networkRequests: count,
          proof: record.proof ?? null,
          signatures: 0,
          broadcasts: 0,
        },
        null,
        2,
      ),
    );
  }
}
