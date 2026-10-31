// Anonymous public GETs only; default invocation is inert.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { EVENT, LEGACY_EVENT } from "../../public/first-event/event.js";
const root = new URL("../../", import.meta.url);
const origin = "https://kleros-kickback.netlify.app";
async function run() {
  assert(/^[0-9a-f]{40}$/.test(process.env.EXPECTED_RELEASE ?? ""));
  const before = JSON.parse(await fs.readFile(new URL("artifacts/truth-pays-ist/catalog-after-creation.json", root), "utf8"));
  const old = JSON.parse(await fs.readFile(new URL("artifacts/truth-pays-ist/old-depositors-before-promotion.json", root), "utf8"));
  async function get(path) {
    assert(["/api/public-catalog", "/api/first-event/depositors", "/api/first-event/depositors?eventId=" + LEGACY_EVENT.id].includes(path));
    const response = await fetch(origin + path, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /application\/json/);
    return response.json();
  }
  const catalog = await get("/api/public-catalog");
  assert(/^[A-Za-z0-9_-]{1,160}$/.test(catalog.instanceId ?? ""));
  assert.notEqual(catalog.instanceId, before.instanceId);
  const adopted = catalog.events.find(row => row.id === EVENT.id);
  assert.equal(adopted?.contract, EVENT.contract); assert.equal(adopted.adoption.kind, "recorded-adoption");
  assert.deepEqual(adopted, before.events.find(row => row.id === EVENT.id));
  const current = await get("/api/first-event/depositors");
  const legacy = await get("/api/first-event/depositors?eventId=" + LEGACY_EVENT.id);
  for (const [data, event] of [[current, EVENT], [legacy, LEGACY_EVENT]]) {
    assert.equal(data.kind, "first-event-depositors"); assert.equal(data.displayOnly, true);
    assert.equal(data.instanceId, catalog.instanceId); assert.equal(data.eventId, event.id);
    assert.equal(data.contract.toLowerCase(), event.contract.toLowerCase()); assert.equal(data.chainId, 1);
    assert(["current", "stale"].includes(data.status)); assert(Array.isArray(data.depositors));
  }
  let preservedReceipts = 0;
  for (const row of old.depositors) {
    const after = legacy.depositors.find(candidate => candidate.wallet.toLowerCase() === row.wallet.toLowerCase());
    assert(after); assert(BigInt(after.totalReceivedWei) >= BigInt(row.totalReceivedWei));
    for (const lot of row.deposits) {
      assert.deepEqual(after.deposits.find(candidate => candidate.txHash === lot.txHash && candidate.logIndex === lot.logIndex), lot);
      preservedReceipts++;
    }
  }
  const proof = { status: "passed", sourceCommit: process.env.EXPECTED_RELEASE, origin, beforeInstanceId: before.instanceId,
    afterInstanceId: catalog.instanceId, identicalRecordedAdoption: true, currentEventId: current.eventId,
    legacyEventId: legacy.eventId, currentDepositorWallets: current.depositors.length,
    legacyDepositorWallets: legacy.depositors.length, preservedReceipts, publicGETs: 3,
    checkedAt: new Date().toISOString(), limits: ["Anonymous catalog and SQL readback; no wallet/auth/transaction action or private state access."] };
  for (const [name, value] of [["catalog-after-promotion.json", catalog], ["depositors-after-promotion.json", { current, legacy }], ["persistence-after-promotion.json", proof]])
    await fs.writeFile(new URL("artifacts/truth-pays-ist/" + name, root), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ ...proof, proofPath: fileURLToPath(new URL("artifacts/truth-pays-ist/persistence-after-promotion.json", root)) }));
}
if (process.argv.length === 2) console.log("Prepared anonymous persistence readback; no network performed.");
else { assert.deepEqual(process.argv.slice(2), ["--execute"]); await run(); }
