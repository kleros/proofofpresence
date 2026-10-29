// Independent allowlisted source comparison: test timing must never change economics.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { checkTest15mSources } from "../scripts/generate-contracts-test15m.mjs";

const read = (relative) =>
  fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("test15m source differs from pinned production only by explicit test identity, chain guard, timing and timing docs", () => {
  for (const source of checkTest15mSources()) {
    let text = source.content.split("\n").slice(3).join("\n");
    text = text
      .replaceAll("KlerosEventV8Test15m", "KlerosEventV8")
      .replaceAll("KlerosEventFactoryV8Test15m", "KlerosEventFactoryV8")
      .replace(
        "uint256 public constant VERSION = 80015;",
        "uint256 public constant VERSION = 8;",
      )
      .replace("    error UnsupportedTestChain(uint256 chainId);\n", "")
      .replace(
        "        require(block.chainid == 10200, UnsupportedTestChain(block.chainid));\n",
        "",
      )
      .replace(
        "uint256 public constant CHALLENGE_PERIOD = 15 minutes;",
        "uint256 public constant CHALLENGE_PERIOD = 1 days;",
      )
      .replace(
        "uint256 public constant MATCH_PERIOD = 15 minutes;",
        "uint256 public constant MATCH_PERIOD = 1 days;",
      )
      .replace(
        "Opens the 15-minute test challenge window.",
        "Opens the 1-day challenge window.",
      )
      .replace(
        "match its deposit within 15 minutes (test only).",
        "match its deposit within 1 day.",
      );
    const original = read(source.productionSource);
    assert.equal(sha256(original), source.productionSha256);
    assert.equal(
      text,
      original,
      `${source.filename}: no additional logic change is permitted`,
    );
    assert.equal(
      read(source.filename),
      source.content,
      "committed generated source must match deterministic generation",
    );
  }
});

test("test15m ABI preserves all financial calls and events, and artifacts bind exact generated sources", () => {
  const manifest = JSON.parse(read("build/contracts-test15m/manifest.json"));
  assert.equal(manifest.profile, "kleros-event-v8-test15m");
  assert.equal(manifest.version, 80015);
  assert.equal(manifest.chainId, 10200);
  assert.equal(manifest.challengePeriod, 900);
  assert.equal(manifest.matchPeriod, 900);
  for (const source of checkTest15mSources()) {
    const name = source.filename.split("/").at(-1).replace(".sol", "");
    const originalName = name.replace("Test15m", "");
    const artifact = JSON.parse(read(`build/contracts-test15m/${name}.json`));
    const production = JSON.parse(read(`build/contracts/${originalName}.json`));
    const normalize = (abi) =>
      JSON.parse(
        JSON.stringify(abi)
          .replaceAll("KlerosEventV8Test15m", "KlerosEventV8")
          .replaceAll("KlerosEventFactoryV8Test15m", "KlerosEventFactoryV8"),
      );
    assert.deepEqual(
      normalize(
        artifact.abi.filter((entry) => entry.name !== "UnsupportedTestChain"),
      ),
      normalize(production.abi),
    );
    assert.equal(manifest.sources[source.filename], sha256(source.content));
    assert.equal(
      manifest.productionSources[source.productionSource],
      source.productionSha256,
    );
    assert.ok(manifest.contracts[name].runtimeBytes <= 24_576);
    assert.ok(manifest.contracts[name].creationBytes <= 49_152);
  }
});
