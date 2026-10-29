// Exact V10 production provenance: filesystem reads only; no compiler or provider.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { hash } from "./utils.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const V10_SOURCE_FILES = Object.freeze([
  "@openzeppelin/contracts/access/Ownable.sol",
  "@openzeppelin/contracts/access/Ownable2Step.sol",
  "@openzeppelin/contracts/interfaces/IERC1967.sol",
  "@openzeppelin/contracts/interfaces/draft-IERC1822.sol",
  "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol",
  "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol",
  "@openzeppelin/contracts/proxy/Proxy.sol",
  "@openzeppelin/contracts/proxy/beacon/IBeacon.sol",
  "@openzeppelin/contracts/proxy/utils/Initializable.sol",
  "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol",
  "@openzeppelin/contracts/utils/Address.sol",
  "@openzeppelin/contracts/utils/Context.sol",
  "@openzeppelin/contracts/utils/Errors.sol",
  "@openzeppelin/contracts/utils/LowLevelCall.sol",
  "@openzeppelin/contracts/utils/StorageSlot.sol",
  "contracts/v10/KlerosEventFactoryV10.sol",
  "contracts/v10/KlerosEventV10.sol",
  "contracts/v10/KlerosUpgradeControllerV10.sol",
  "contracts/v10/KlerosUpgradeGateV10.sol",
]);
const NAMES = [
  "KlerosEventV10",
  "KlerosEventFactoryV10",
  "KlerosUpgradeControllerV10",
  "ERC1967Proxy",
];
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
const keys = (value, expected) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...expected].sort().join();
const pin = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const check = (ok) => {
  if (!ok)
    throw Object.assign(
      new Error("V10 artifacts differ from approved source provenance"),
      { code: "V10_ARTIFACT_PROVENANCE", status: 409 },
    );
};
const read = (root, name) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));

// root is a trusted offline-test dependency, never manifest or request input.
export function verifyV10ArtifactSources(provenance, { root = ROOT } = {}) {
  check(
    keys(provenance, ["v10BuildManifestSha256", "v10StandardInputSha256"]) &&
      pin(provenance.v10BuildManifestSha256) &&
      pin(provenance.v10StandardInputSha256),
  );
  try {
    const manifest = read(root, "build/contracts-v10/manifest.json"),
      input = read(root, "build/contracts-v10/standard-input.json"),
      oz = read(root, "node_modules/@openzeppelin/contracts/package.json");
    check(
      hash(manifest) === provenance.v10BuildManifestSha256 &&
        hash(input) === provenance.v10StandardInputSha256 &&
        manifest.profile === "kleros-event-v10-uups" &&
        manifest.version === 10 &&
        manifest.compiler === COMPILER &&
        manifest.openzeppelin === "5.7.0" &&
        oz.name === "@openzeppelin/contracts" &&
        oz.version === "5.7.0" &&
        manifest.minimumUpgradeDelay === 0 &&
        manifest.governanceKind === "single-owner-immediate" &&
        manifest.renounceable === true &&
        keys(input, ["language", "sources", "settings"]) &&
        input.language === "Solidity" &&
        hash(input.settings) === hash(SETTINGS) &&
        hash(manifest.settings) === hash(SETTINGS) &&
        keys(input.sources, V10_SOURCE_FILES) &&
        keys(manifest.sources, V10_SOURCE_FILES) &&
        keys(manifest.contracts, NAMES),
    );
    for (const name of V10_SOURCE_FILES) {
      const source = input.sources[name],
        disk = name.startsWith("@openzeppelin/")
          ? `node_modules/${name}`
          : name;
      check(
        keys(source, ["content"]) &&
          typeof source.content === "string" &&
          pin(manifest.sources[name]) &&
          hash(source.content) === manifest.sources[name] &&
          hash(fs.readFileSync(path.join(root, disk))) ===
            manifest.sources[name],
      );
    }
    return manifest;
  } catch {
    check(false);
  }
}

export function loadV10UpgradeableArtifacts({ root = ROOT } = {}) {
  try {
    const manifest = read(root, "build/contracts-v10/manifest.json");
    check(
      manifest.profile === "kleros-event-v10-uups" &&
        manifest.version === 10 &&
        manifest.compiler === COMPILER &&
        manifest.openzeppelin === "5.7.0" &&
        manifest.minimumUpgradeDelay === 0 &&
        manifest.governanceKind === "single-owner-immediate" &&
        manifest.renounceable === true &&
        keys(manifest.contracts, NAMES),
    );
    const result = {};
    for (const [key, name] of [
      ["event", NAMES[0]],
      ["factory", NAMES[1]],
      ["controller", NAMES[2]],
      ["proxy", NAMES[3]],
    ]) {
      const artifact = read(root, `build/contracts-v10/${name}.json`),
        expected = manifest.contracts[name];
      check(
        artifact.compiler === COMPILER &&
          ethers.keccak256(artifact.bytecode) === expected.creationCodeHash &&
          ethers.keccak256(artifact.deployedBytecode) ===
            expected.unpatchedRuntimeCodeHash &&
          hash(artifact.abi) === expected.abiSha256 &&
          hash(artifact.storageLayout) === expected.storageLayoutSha256 &&
          hash(artifact.immutableReferences) ===
            hash(expected.immutableReferences) &&
          hash(artifact.immutableValues) === hash(expected.immutableValues) &&
          keys(artifact.linkReferences ?? {}, []),
      );
      result[key] = artifact;
    }
    const controllerHash = ethers.keccak256(result.controller.deployedBytecode);
    for (const key of ["event", "factory"]) {
      const values = Object.values(result[key].immutableValues);
      check(
        values.length === 2 &&
          values.some(
            (v) =>
              v.name === "__self" &&
              v.type === "address" &&
              v.value === "implementation-address",
          ) &&
          values.some(
            (v) =>
              v.name === "_controllerCodeHash" &&
              v.type === "bytes32" &&
              v.value === controllerHash,
          ),
      );
    }
    for (const key of ["controller", "proxy"])
      check(
        keys(result[key].immutableReferences, []) &&
          keys(result[key].immutableValues, []),
      );
    return result;
  } catch {
    check(false);
  }
}
