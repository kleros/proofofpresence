// Production artifact provenance only: filesystem reads, no compiler, RPC or wallet access.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const V9_SOURCE_FILES = Object.freeze([
  "@openzeppelin/contracts/access/AccessControl.sol",
  "@openzeppelin/contracts/access/IAccessControl.sol",
  "@openzeppelin/contracts/access/Ownable.sol",
  "@openzeppelin/contracts/access/Ownable2Step.sol",
  "@openzeppelin/contracts/governance/TimelockController.sol",
  "@openzeppelin/contracts/interfaces/IERC1967.sol",
  "@openzeppelin/contracts/interfaces/draft-IERC1822.sol",
  "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol",
  "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol",
  "@openzeppelin/contracts/proxy/Proxy.sol",
  "@openzeppelin/contracts/proxy/beacon/IBeacon.sol",
  "@openzeppelin/contracts/proxy/utils/Initializable.sol",
  "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol",
  "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol",
  "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol",
  "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol",
  "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol",
  "@openzeppelin/contracts/utils/Address.sol",
  "@openzeppelin/contracts/utils/Context.sol",
  "@openzeppelin/contracts/utils/Errors.sol",
  "@openzeppelin/contracts/utils/LowLevelCall.sol",
  "@openzeppelin/contracts/utils/StorageSlot.sol",
  "@openzeppelin/contracts/utils/introspection/ERC165.sol",
  "@openzeppelin/contracts/utils/introspection/IERC165.sol",
  "contracts/v9/KlerosEventFactoryV9.sol",
  "contracts/v9/KlerosEventV9.sol",
  "contracts/v9/KlerosUpgradeGateV9.sol",
  "contracts/v9/KlerosUpgradeTimelockV9.sol",
]);
const COMPILER = "0.8.38+commit.1835d247.Emscripten.clang";
const SETTINGS = {
  optimizer: { enabled: true, runs: 200 },
  viaIR: true,
  evmVersion: "paris",
  outputSelection: {
    "*": {
      "": ["ast"],
      "*": [
        "abi",
        "storageLayout",
        "evm.bytecode.object",
        "evm.bytecode.linkReferences",
        "evm.deployedBytecode.object",
        "evm.deployedBytecode.immutableReferences",
      ],
    },
  },
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalHash = (value) => sha256(JSON.stringify(value));
const pin = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const keys = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
const sameKeys = (value, expected) =>
  JSON.stringify(keys(value)) === JSON.stringify([...expected].sort());
const check = (ok, message) => {
  if (!ok)
    throw Object.assign(new Error(message), {
      code: "V9_ARTIFACT_PROVENANCE",
      status: 409,
    });
};

/** Pins are approved release metadata. The optional root is a trusted test dependency, never manifest input. */
export function verifyV9ArtifactSources(provenance, { root = ROOT } = {}) {
  check(
    sameKeys(provenance, ["v9BuildManifestSha256", "v9StandardInputSha256"]) &&
      pin(provenance.v9BuildManifestSha256) &&
      pin(provenance.v9StandardInputSha256),
    "Production requires approved v9 build and compiler-input SHA256 pins",
  );
  let manifest, input, openzeppelin;
  const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");
  try {
    manifest = JSON.parse(read("build/contracts-v9/manifest.json"));
    input = JSON.parse(read("build/contracts-v9/standard-input.json"));
    openzeppelin = JSON.parse(
      read("node_modules/@openzeppelin/contracts/package.json"),
    );
  } catch {
    check(
      false,
      "Reviewed v9 build inputs or dependency sources are unavailable",
    );
  }
  check(
    canonicalHash(manifest) === provenance.v9BuildManifestSha256 &&
      canonicalHash(input) === provenance.v9StandardInputSha256,
    "V9 build or compiler input differs from the approved release",
  );
  check(
    manifest.profile === "kleros-event-v9-uups" &&
      manifest.version === 9 &&
      manifest.compiler === COMPILER &&
      manifest.openzeppelin === "5.7.0" &&
      manifest.minimumUpgradeDelay === 172800 &&
      openzeppelin.name === "@openzeppelin/contracts" &&
      openzeppelin.version === "5.7.0" &&
      input.language === "Solidity" &&
      sameKeys(input, ["language", "sources", "settings"]) &&
      JSON.stringify(manifest.settings) === JSON.stringify(SETTINGS) &&
      JSON.stringify(input.settings) === JSON.stringify(SETTINGS),
    "V9 compiler, dependency or settings differ from the reviewed profile",
  );
  check(
    sameKeys(manifest.sources, V9_SOURCE_FILES) &&
      sameKeys(input.sources, V9_SOURCE_FILES) &&
      sameKeys(manifest.contracts, [
        "KlerosEventV9",
        "KlerosEventFactoryV9",
        "KlerosUpgradeTimelockV9",
        "ERC1967Proxy",
      ]),
    "V9 build must contain exactly the reviewed contracts and26 source files",
  );
  for (const filename of V9_SOURCE_FILES) {
    const source = input.sources[filename];
    check(
      sameKeys(source, ["content"]) &&
        typeof source.content === "string" &&
        pin(manifest.sources[filename]) &&
        sha256(source.content) === manifest.sources[filename],
      "V9 compiler input does not match its source manifest",
    );
    let content;
    try {
      content = read(
        filename.startsWith("@openzeppelin/")
          ? `node_modules/${filename}`
          : filename,
      );
    } catch {
      check(
        false,
        "Reviewed v9 repository or dependency source is unavailable",
      );
    }
    check(
      sha256(content) === manifest.sources[filename],
      "Current repository or dependency source differs from the approved v9 build",
    );
  }
  return manifest;
}
