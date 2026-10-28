import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { loadArtifact, verifyDeployment } from "./chain.mjs";
import { hash, requireThat, lower } from "./utils.mjs";

// External testnet runtime has no unlocked accounts, automatic deployments or EVM time controls.
export async function testnetChain(manifest, rpcUrl) {
  requireThat(
    manifest?.environment === "testnet" && manifest.chain?.chainId === 10200,
    "Only the explicitly configured Chiado testnet is supported",
    "TESTNET_REQUIRED",
  );
  const url = new URL(rpcUrl ?? manifest.chain.rpcUrl);
  const publicRpc = new URL(manifest.chain.rpcUrl);
  requireThat(
    publicRpc.protocol === "https:" &&
      !publicRpc.username &&
      !publicRpc.password &&
      manifest.chain.nativeCurrency?.symbol === "XDAI" &&
      manifest.chain.nativeCurrency.decimals === 18,
    "Chiado requires truthful HTTPS RPC and native XDAI metadata",
  );
  requireThat(
    url.protocol === "https:" && !url.username && !url.password,
    "Testnet RPC must use HTTPS without embedded credentials",
  );
  requireThat(
    manifest.arbitration?.mode === "controlled",
    "Real Court requires a separate provider compatibility review",
  );
  requireThat(
    Array.isArray(manifest.events) &&
      manifest.events.length > 0 &&
      manifest.events.every(
        (record) =>
          /^[a-zA-Z0-9_-]+$/.test(record?.definition?.id ?? "") &&
          ethers.isAddress(record?.deployment?.contract),
      ),
    "Testnet manifest has no valid reviewed events",
  );
  requireThat(
    new Set(manifest.events.map((record) => record.definition.id)).size ===
      manifest.events.length &&
      new Set(
        manifest.events.map((record) => lower(record.deployment.contract)),
      ).size === manifest.events.length,
    "Testnet events must have independent identities and child contracts",
    "DUPLICATE_EVENT",
    409,
  );
  const provider = new ethers.JsonRpcProvider(url.href, undefined, {
    cacheTimeout: -1,
  });
  const context = {
    provider,
    chainId: 10200,
    // Cache identities include the complete reviewed registry entry, not only
    // its address. Changed deployment metadata has no matching proof key.
    immutableDeploymentEntries: new Map(
      manifest.events.map((record) => [hash(record.deployment), hash(record)]),
    ),
    immutableProvenanceCache: new Map(),
  };
  try {
    requireThat(
      BigInt(await provider.send("eth_chainId", [])) === 10200n,
      "RPC is not Chiado testnet",
      "WRONG_CHAIN",
    );
    requireThat(
      Array.isArray(manifest.events) && manifest.events.length > 0,
      "Testnet manifest has no reviewed events",
    );
    for (const record of manifest.events) {
      requireThat(
        record.deployment.contractVersion === "kleros-event-v8" &&
          record.definition.id === record.deployment.eventId &&
          record.definition.title === record.deployment.eventName &&
          Date.parse(record.definition.startsAt) / 1000 ===
            record.deployment.eventStart &&
          lower(record.deployment.resolver) ===
            lower(manifest.arbitration.resolver) &&
          lower(record.deployment.arbitrator) ===
            lower(manifest.arbitration.arbitrator),
        "Manifest event is not bound to its reviewed arbitration/version",
      );
      await verifyDeployment(context, record.deployment);
    }
    return {
      ...context,
      rpcUrl: manifest.chain.rpcUrl,
      chainId: 10200,
      signers: [],
      resolver: new ethers.Contract(
        manifest.arbitration.resolver,
        loadArtifact("MockArbitrableProxy").abi,
        provider,
      ),
      liquid: new ethers.Contract(
        manifest.arbitration.arbitrator,
        loadArtifact("MockKlerosLiquid").abi,
        provider,
      ),
      close: async () => provider.destroy(),
    };
  } catch (error) {
    provider.destroy();
    throw error;
  }
}

export function testnetStateStore(filename, manifest) {
  requireThat(
    filename && path.isAbsolute(filename),
    "Testnet state requires an explicit absolute file path",
  );
  const binding = hash(manifest);
  return {
    load() {
      if (!fs.existsSync(filename)) return null;
      const info = fs.lstatSync(filename);
      requireThat(
        info.isFile() &&
          !info.isSymbolicLink() &&
          (info.mode & 0o077) === 0 &&
          (process.getuid === undefined || info.uid === process.getuid()),
        "Testnet state must be an owner-only regular file",
        "STATE_PERMISSIONS",
        409,
      );
      const saved = JSON.parse(fs.readFileSync(filename, "utf8"));
      requireThat(
        saved.binding === binding && saved.version === 1,
        "State belongs to another testnet deployment; select a separate state file",
        "STATE_SCOPE",
        409,
      );
      return saved;
    },
    save(events, drafts) {
      const data = {
        version: 1,
        binding,
        events: [...events.values()].map((record) => ({
          eventId: record.deployment.eventId,
          definition: record.definition,
          revision: record.revision,
          observations: record.observations,
          batches: record.batches,
          transactions: record.transactions,
          participants: [...record.participants],
          personal: [...record.personal],
          publications: [...record.publications],
          nonces: [...record.nonces],
        })),
        drafts: [...drafts],
      };
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      const temp = `${filename}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temp, JSON.stringify(data), {
          mode: 0o600,
          flag: "wx",
        });
        fs.renameSync(temp, filename);
      } finally {
        fs.rmSync(temp, { force: true });
      }
    },
  };
}
