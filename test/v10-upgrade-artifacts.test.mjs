// Filesystem-only provenance tests; no compiler, provider or wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { hash } from "../src/utils.mjs";
import {
  V10_SOURCE_FILES,
  verifyV10ArtifactSources,
  loadV10UpgradeableArtifacts,
} from "../src/v10-upgrade-artifacts.mjs";
import { v10RuntimeCode } from "../scripts/mainnet/v10-runtime-code.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (root, name) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const write = (root, name, value) =>
  fs.writeFileSync(path.join(root, name), JSON.stringify(value));
const pins = (root) => ({
  v10BuildManifestSha256: hash(read(root, "build/contracts-v10/manifest.json")),
  v10StandardInputSha256: hash(
    read(root, "build/contracts-v10/standard-input.json"),
  ),
});
const rejects = (f) =>
  assert.throws(
    f,
    (e) => e.code === "V10_ARTIFACT_PROVENANCE" && !e.message.includes(ROOT),
  );
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v10-source-"));
  try {
    const files = [
      ...V10_SOURCE_FILES.map((name) =>
        name.startsWith("@") ? `node_modules/${name}` : name,
      ),
      "node_modules/@openzeppelin/contracts/package.json",
      ...[
        "manifest",
        "standard-input",
        "KlerosEventV10",
        "KlerosEventFactoryV10",
        "KlerosUpgradeControllerV10",
        "ERC1967Proxy",
      ].map((name) => `build/contracts-v10/${name}.json`),
    ];
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, file), path.join(root, file));
    }
    return run(root, pins(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("V10 exact 19-source/compiler/governance provenance and all four artifacts validate without solc", () => {
  assert.equal(V10_SOURCE_FILES.length, 19);
  const manifest = verifyV10ArtifactSources(pins(ROOT));
  assert.equal(manifest.governanceKind, "single-owner-immediate");
  const a = loadV10UpgradeableArtifacts();
  assert.deepEqual(Object.keys(a).sort(), [
    "controller",
    "event",
    "factory",
    "proxy",
  ]);
  const controllerHash = ethers.keccak256(a.controller.deployedBytecode);
  const patched = v10RuntimeCode(
    a.event,
    "0x1111111111111111111111111111111111111111",
    controllerHash,
  );
  assert.equal(patched.length, a.event.deployedBytecode.length);
  assert.notEqual(patched, a.event.deployedBytecode);
  assert.equal(
    v10RuntimeCode(
      a.proxy,
      "0x1111111111111111111111111111111111111111",
      controllerHash,
    ),
    a.proxy.deployedBytecode,
  );
});
test("approved canonical JSON pins tolerate formatting and reject extra/missing pin keys", () =>
  fixture((root, approved) => {
    fs.writeFileSync(
      path.join(root, "build/contracts-v10/manifest.json"),
      JSON.stringify(read(root, "build/contracts-v10/manifest.json"), null, 4),
    );
    assert.equal(verifyV10ArtifactSources(approved, { root }).version, 10);
    rejects(() =>
      verifyV10ArtifactSources({ ...approved, skip: true }, { root }),
    );
    rejects(() =>
      verifyV10ArtifactSources(
        { v10BuildManifestSha256: approved.v10BuildManifestSha256 },
        { root },
      ),
    );
  }));
test("no positive cache permits changed on-disk source; self-consistent replacements need new trusted pins", () =>
  fixture((root, approved) => {
    verifyV10ArtifactSources(approved, { root });
    const file = "contracts/v10/KlerosEventV10.sol",
      text = fs.readFileSync(path.join(root, file), "utf8") + "\n// replaced\n";
    fs.writeFileSync(path.join(root, file), text);
    rejects(() => verifyV10ArtifactSources(approved, { root }));
    const input = read(root, "build/contracts-v10/standard-input.json"),
      manifest = read(root, "build/contracts-v10/manifest.json");
    input.sources[file].content = text;
    manifest.sources[file] = hash(text);
    write(root, "build/contracts-v10/standard-input.json", input);
    write(root, "build/contracts-v10/manifest.json", manifest);
    rejects(() => verifyV10ArtifactSources(approved, { root }));
  }));
test("even newly hash-bound input rejects extra source paths and changed compiler/settings/governance", () => {
  for (const mutate of [
    (r) => {
      const x = read(r, "build/contracts-v10/standard-input.json");
      x.sources["evil.sol"] = { content: "" };
      write(r, "build/contracts-v10/standard-input.json", x);
    },
    (r) => {
      const x = read(r, "build/contracts-v10/standard-input.json");
      x.settings.optimizer.runs = 1;
      write(r, "build/contracts-v10/standard-input.json", x);
    },
    (r) => {
      const x = read(r, "build/contracts-v10/manifest.json");
      x.compiler = "unreviewed";
      write(r, "build/contracts-v10/manifest.json", x);
    },
    (r) => {
      const x = read(r, "build/contracts-v10/manifest.json");
      x.minimumUpgradeDelay = 172800;
      write(r, "build/contracts-v10/manifest.json", x);
    },
    (r) => {
      const x = read(r, "node_modules/@openzeppelin/contracts/package.json");
      x.version = "5.6.0";
      write(r, "node_modules/@openzeppelin/contracts/package.json", x);
    },
  ])
    fixture((root) => {
      mutate(root);
      rejects(() => verifyV10ArtifactSources(pins(root), { root }));
    });
});
test("artifact bytecode, ABI, storage layout and immutable metadata are pinned independently", () => {
  for (const mutate of [
    (a) => {
      a.bytecode += "00";
    },
    (a) => {
      a.abi.pop();
    },
    (a) => {
      a.storageLayout.storage.push({ slot: "999", label: "forged" });
    },
    (a) => {
      Object.values(a.immutableValues)[0].value = "unreviewed";
    },
    (a) => {
      Object.values(a.immutableReferences)[0][0].start += 1;
    },
  ])
    fixture((root) => {
      const file = "build/contracts-v10/KlerosEventV10.json",
        a = read(root, file);
      mutate(a);
      write(root, file, a);
      rejects(() => loadV10UpgradeableArtifacts({ root }));
    });
});
test("immutable patching rejects unknown, overlapping and incomplete locations", () => {
  const a = loadV10UpgradeableArtifacts(),
    owner = "0x1111111111111111111111111111111111111111",
    codeHash = ethers.keccak256(a.controller.deployedBytecode);
  for (const mutate of [
    (x) => {
      Object.values(x.immutableValues)[0].name = "other";
    },
    (x) => {
      const locations = Object.values(x.immutableReferences)[0];
      locations.push({ ...locations[0] });
    },
    (x) => {
      delete x.immutableValues[Object.keys(x.immutableValues)[0]];
    },
  ]) {
    const x = structuredClone(a.event);
    mutate(x);
    assert.throws(() => v10RuntimeCode(x, owner, codeHash));
  }
});
