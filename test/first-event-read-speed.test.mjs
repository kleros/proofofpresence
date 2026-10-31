// Real isolated Ganache V10 contracts, factory, authoritative workbench and owner
// projection. Court code alone is mocked by the existing fixture. No public RPC,
// browser wallet, external key or private signing file is read by this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ethers } from "ethers";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";
import { INFURA_READ_METHOD_CREDITS } from "../src/rpc-read-scheduler.mjs";

const sourceFiles = ["src/workbench.mjs", "src/v10-upgrade-verification.mjs", "src/v10-mainnet-runtime.mjs", "src/chain.mjs", "src/v10-read-batch.mjs"];
const baseline = Object.freeze({ source: "fdffe383cc34db524da7ebc77192b487745ba2cb",
  rpcRequests: 296, estimatedInfuraCredits: 21255 });
const sourcePins = () => Object.fromEntries(sourceFiles.map(file => [file,
  createHash("sha256").update(fs.readFileSync(new URL(`../${file}`, import.meta.url))).digest("hex")]));

test("real V10 owner selected-bootstrap reports cold/warm RPC work and fresh delivery", { timeout: 180000 }, async t => {
  const pins = sourcePins(), managed = new Map();
  const f = await createV10AppFixture({ origin: "https://first-event-read-speed.example.invalid",
    firstEventManageScope: record => managed.get(record.definition.id)?.toLowerCase() === record.deployment.contract.toLowerCase() });
  t.after(() => f.close());
  assert(f.provider instanceof ethers.BrowserProvider, "Only the existing in-memory Ganache provider is accepted");
  assert.equal(Number((await f.provider.getNetwork()).chainId), 1);
  const w = f.workbench(), owner = { id: "synthetic-read-speed-owner", mode: "wallet", wallet: f.organizerAddress };
  const now = (await f.provider.getBlock("latest")).timestamp;
  const draft = await w.createFactoryDraft(owner, { title: "Synthetic owner read-speed event",
    lumaUrl: "https://luma.com/synthetic-read-speed", startsAt: new Date((now + 3600) * 1000).toISOString(),
    endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "UTC", depositEth: "0.000001" });
  await w.validateFactoryDraft(owner, draft.id);
  const sent = await f.sendSyntheticTransaction(1, draft.transaction); await sent.wait();
  await w.recordFactorySubmitted(owner, draft.id, sent.hash);
  const created = await w.reconcileFactorySubmission(owner, draft.id, sent.hash);
  assert.equal(created.status, "confirmed");
  managed.set(draft.eventId, created.contract);

  const originalSend = f.provider.send, phases = [];
  let observed = null;
  f.provider.send = async function(method, params) {
    if (observed) {
      assert(Object.hasOwn(INFURA_READ_METHOD_CREDITS, method), `Measured phase attempted non-read RPC ${method}`);
      observed.push({ method, params });
    }
    return originalSend.call(this, method, params);
  };
  t.after(() => { f.provider.send = originalSend; });
  async function measure(label, run) {
    const requests = [], started = performance.now(); observed = requests;
    let value;
    try { value = await run(); } finally { observed = null; }
    const elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;
    const methods = {}, frequencies = new Map();
    for (const request of requests) {
      methods[request.method] = (methods[request.method] ?? 0) + 1;
      const key = JSON.stringify([request.method, request.params]);
      frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    }
    const repeatedByMethod = {};
    for (const [key, count] of frequencies) if (count > 1) {
      const [method] = JSON.parse(key); repeatedByMethod[method] = (repeatedByMethod[method] ?? 0) + count - 1;
    }
    const credits = requests.reduce((sum, request) => sum + INFURA_READ_METHOD_CREDITS[request.method], 0);
    phases.push({ label, rpcRequests: requests.length, estimatedInfuraCredits: credits,
      repeatedIdenticalRPCs: Object.values(repeatedByMethod).reduce((sum, count) => sum + count, 0),
      methods, repeatedByMethod, elapsedMs });
    return value;
  }
  function assertOwnerProjection(result) {
    assert.equal(result.mode, "hosted-production");
    assert.equal(result.contractVersion, "kleros-event-v10-uups");
    assert.equal(result.chain.chainId, 1);
    assert.equal(result.selectedEvent.eventId, draft.eventId);
    assert.equal(result.selectedEvent.wallet.toLowerCase(), owner.wallet.toLowerCase());
    assert.equal(result.selectedEvent.detail.event.contract.toLowerCase(), created.contract.toLowerCase());
    assert.equal(result.selectedEvent.detail.event.role, "organizer");
    assert.equal(result.selectedEvent.detail.permissions.owner, true);
    assert.equal(result.selectedEvent.detail.deploymentTrust.status, "verified");
    assert.equal(Object.hasOwn(result, "factory"), false, "Selected-only event reads do not verify unrelated future-child setup");
    assert.equal(Object.hasOwn(result, "organizerSetup"), false);
  }
  const cold = await measure("first-owner-selected-bootstrap-after-creation", () => w.bootstrap(owner, { selectedEventId: draft.eventId, selectedOnly: true }));
  assertOwnerProjection(cold);
  const warm = await measure("warm-owner-selected-bootstrap-same-chain", () => w.bootstrap(owner, { selectedEventId: draft.eventId, selectedOnly: true }));
  assertOwnerProjection(warm);
  const delivered = await measure("fresh-owner-bootstrap-delivery", () => w.finalizeReadResult("bootstrap", structuredClone(warm), owner, draft.eventId));
  assertOwnerProjection(delivered);
  assert.notEqual(cold, warm, "Read results are separate projections, not a shared mutable private DTO");
  assert.notEqual(warm, delivered, "Delivery returns a detached projection after its own authority checks");
  assert(phases.every(phase => phase.rpcRequests > 0), "Every phase still makes authoritative chain reads");
  assert(phases[1].estimatedInfuraCredits <= phases[0].estimatedInfuraCredits,
    "An unchanged warm read must not perform more RPC work than the first selected read");
  for (const phase of phases.slice(0, 2)) {
    assert(phase.rpcRequests <= Math.floor(baseline.rpcRequests * 0.65), "Selected owner reads retain at least 35% fewer RPC requests than the measured baseline");
    assert(phase.estimatedInfuraCredits <= Math.floor(baseline.estimatedInfuraCredits * 0.60), "Selected owner reads retain at least 40% fewer weighted credits than the measured baseline");
  }
  assert.equal(f.stats.backendSigningCalls, 0);
  assert.equal(f.stats.walletRequests, 0);
  const finalPins = sourcePins();
  t.diagnostic(JSON.stringify({ kind: "actual-local-v10-selected-read-profile", baseline, phases,
    reductionVsBaseline: phases.slice(0, 2).map(phase => ({ label: phase.label,
      rpcPercent: Math.round((1 - phase.rpcRequests / baseline.rpcRequests) * 10000) / 100,
      weightedCreditPercent: Math.round((1 - phase.estimatedInfuraCredits / baseline.estimatedInfuraCredits) * 10000) / 100 })),
    warmCreditReductionPercent: Math.round((1 - phases[1].estimatedInfuraCredits / phases[0].estimatedInfuraCredits) * 10000) / 100,
    sourcePins: pins, sourceChangedDuringRun: JSON.stringify(pins) !== JSON.stringify(finalPins),
    limits: ["First selected read occurs after required local creation/adoption; any creation-warmed verifier cache is retained.",
      "Credit totals use repository weights, not live billing or measured hosted latency.",
      "Local elapsed time excludes the production RPC scheduler and network; compare RPC work instead."] }));
});
