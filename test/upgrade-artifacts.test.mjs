// Offline filesystem fixtures only. No compiler, provider, wallet or public network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  V9_SOURCE_FILES,
  verifyV9ArtifactSources,
} from "../src/upgrade-artifacts.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalHash = (value) => sha256(JSON.stringify(value));
const readJson = (root, name) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const pins = (root) => ({
  v9BuildManifestSha256: canonicalHash(
    readJson(root, "build/contracts-v9/manifest.json"),
  ),
  v9StandardInputSha256: canonicalHash(
    readJson(root, "build/contracts-v9/standard-input.json"),
  ),
});
const sourcePath = (name) =>
  name.startsWith("@openzeppelin/") ? `node_modules/${name}` : name;
const reject = (error) =>
  error.code === "V9_ARTIFACT_PROVENANCE" && error.status === 409;
function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "kleros-v9-artifact-synthetic-"),
  );
  const files = [
    "build/contracts-v9/manifest.json",
    "build/contracts-v9/standard-input.json",
    "node_modules/@openzeppelin/contracts/package.json",
    ...V9_SOURCE_FILES.map(sourcePath),
  ];
  for (const name of files) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, name), path.join(root, name));
  }
  return {
    root,
    provenance: pins(root),
    read: (name) => readJson(root, `build/contracts-v9/${name}.json`),
    write: (name, value) =>
      fs.writeFileSync(
        path.join(root, `build/contracts-v9/${name}.json`),
        JSON.stringify(value),
      ),
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("approved canonical build/input pins verify exactly26 current V9/OZ sources without a compiler", () => {
  const provenance = pins(ROOT);
  const result = verifyV9ArtifactSources(provenance);
  assert.equal(result.profile, "kleros-event-v9-uups");
  assert.equal(result.compiler, "0.8.38+commit.1835d247.Emscripten.clang");
  assert.equal(Object.keys(result.sources).length, 26);
  assert.deepEqual(Object.keys(result.sources).sort(), [...V9_SOURCE_FILES]);
  assert.equal(
    Object.hasOwn(result.sources, "contracts/KlerosEventV8.sol"),
    false,
  );
  const f = fixture();
  try {
    // Formatting is not release identity; approved pins hash the parsed canonical JSON.
    f.write("manifest", f.read("manifest"));
    f.write("standard-input", f.read("standard-input"));
    assert.equal(verifyV9ArtifactSources(f.provenance, f).version, 9);
    // No unbound positive cache may survive a subsequent source mutation.
    fs.appendFileSync(
      path.join(f.root, "contracts/v9/KlerosEventV9.sol"),
      "\n// synthetic changed source",
    );
    assert.throws(() => verifyV9ArtifactSources(f.provenance, f), reject);
  } finally {
    f.close();
  }
});

test("missing or malformed trusted release pins fail before filesystem access", () => {
  for (const provenance of [
    undefined,
    {},
    { v9BuildManifestSha256: "f".repeat(64) },
    {
      v9BuildManifestSha256: "F".repeat(64),
      v9StandardInputSha256: "a".repeat(64),
    },
    { ...pins(ROOT), skip: true },
  ]) {
    assert.throws(
      () =>
        verifyV9ArtifactSources(provenance, { root: "/not-a-runtime-fixture" }),
      reject,
    );
  }
});

test("input/artifact-manifest replacement cannot replace approved release hashes", () => {
  for (const kind of ["input", "manifest", "self-consistent"]) {
    const f = fixture();
    try {
      const manifest = f.read("manifest"),
        input = f.read("standard-input");
      const filename = "contracts/v9/KlerosEventV9.sol";
      if (kind !== "manifest") {
        input.sources[filename].content +=
          "\n// synthetic new financial implementation";
        f.write("standard-input", input);
      }
      if (kind !== "input") {
        manifest.sources[filename] = sha256(input.sources[filename].content);
        manifest.contracts.KlerosEventV9.creationCodeHash =
          "0x" + "a".repeat(64);
        f.write("manifest", manifest);
      }
      if (kind === "self-consistent")
        fs.writeFileSync(
          path.join(f.root, filename),
          input.sources[filename].content,
        );
      assert.throws(() => verifyV9ArtifactSources(f.provenance, f), reject);
    } finally {
      f.close();
    }
  }
});

test("repository, dependency and exact installed OZ package changes fail without recompilation", () => {
  for (const filename of [
    "contracts/v9/KlerosUpgradeGateV9.sol",
    "node_modules/@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol",
    "node_modules/@openzeppelin/contracts/package.json",
  ]) {
    const f = fixture();
    try {
      const target = path.join(f.root, filename);
      if (filename.endsWith("package.json")) {
        const pkg = readJson(f.root, filename);
        pkg.version = "5.7.1";
        fs.writeFileSync(target, JSON.stringify(pkg));
      } else fs.appendFileSync(target, "\n// synthetic changed source");
      assert.throws(() => verifyV9ArtifactSources(f.provenance, f), reject);
    } finally {
      f.close();
    }
  }
});

test("even newly approved pins cannot widen the exact profile compiler/settings/source boundary", () => {
  for (const kind of [
    "extra-source",
    "missing-source",
    "settings",
    "compiler",
    "openzeppelin",
    "source-hash",
    "urls",
  ]) {
    const f = fixture();
    try {
      const manifest = f.read("manifest"),
        input = f.read("standard-input");
      const filename = "contracts/v9/KlerosEventV9.sol";
      if (kind === "extra-source") {
        input.sources["contracts/unreviewed.sol"] = { content: "// synthetic" };
        manifest.sources["contracts/unreviewed.sol"] = sha256("// synthetic");
      }
      if (kind === "missing-source") {
        delete input.sources[filename];
        delete manifest.sources[filename];
      }
      if (kind === "settings") {
        input.settings.optimizer.runs = 201;
        manifest.settings.optimizer.runs = 201;
      }
      if (kind === "compiler") manifest.compiler = "0.8.39+unreviewed";
      if (kind === "openzeppelin") manifest.openzeppelin = "5.7.1";
      if (kind === "source-hash") manifest.sources[filename] = "f".repeat(64);
      if (kind === "urls")
        input.sources[filename].urls = [
          "https://example.invalid/unreviewed.sol",
        ];
      f.write("manifest", manifest);
      f.write("standard-input", input);
      assert.throws(() => verifyV9ArtifactSources(pins(f.root), f), reject);
    } finally {
      f.close();
    }
  }
});

test("missing or malformed public build inputs fail with bounded non-path diagnostics", () => {
  const f = fixture();
  try {
    fs.writeFileSync(
      path.join(f.root, "build/contracts-v9/standard-input.json"),
      "malformed fixture",
    );
    assert.throws(
      () => verifyV9ArtifactSources(f.provenance, f),
      (error) =>
        reject(error) &&
        !error.message.includes(f.root) &&
        !error.message.includes("malformed fixture"),
    );
  } finally {
    f.close();
  }
});
