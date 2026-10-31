// Actual isolated V10 factory, full provenance/account checks and original receipt
// adoption. No public network or real signing files are involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";
import { factorySetupIssue, assertCreationDraft } from "../public/luma-factory.js";
import { INFURA_READ_METHOD_CREDITS } from "../src/rpc-read-scheduler.mjs";

test("existing successful creation proof supplies the context without a preliminary bootstrap", { timeout: 180000 }, async t => {
  const f = await createV10AppFixture({ origin: "https://creation-context.example.invalid" });
  t.after(() => f.close());
  const now = (await f.provider.getBlock("latest")).timestamp;
  const input = { title: "Synthetic prepared creation context", lumaUrl: "https://luma.com/synthetic-creation-context",
    startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(),
    timezone: "Asia/Kolkata", depositEth: "0.01" };
  async function request(route, payload) {
    const response = await f.forward(route, { method: payload === undefined ? "GET" : "POST",
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    assert.equal(response.headers["set-cookie"], undefined);
    return { ...response, data: JSON.parse(response.body.toString()) };
  }
  const minted = await request("/api/public-transactions", { wallet: f.organizerAddress, kind: "create" });
  assert.equal(minted.status, 201);
  const base = `/api/public-transactions/${minted.data.token}`;
  const send = f.provider.send, profiles = {}; let phase = null;
  f.provider.send = async function(method, params) {
    if (phase) (profiles[phase] ??= []).push(method);
    return send.call(this, method, params);
  };
  t.after(() => { f.provider.send = send; });
  async function job(operation, body) {
    const requestId = randomUUID(), started = await request(base + "/organizer-jobs", { requestId, operation, ...body });
    assert.equal(started.status, 202, started.body.toString());
    for (let i = 0; i < 400; i++) {
      const result = await request(base + "/organizer-jobs/" + requestId);
      assert.equal(result.status, 200, result.body.toString());
      if (result.data.state !== "pending") {
        assert.equal(result.data.state, "ready", result.body.toString()); return result.data.result;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail("Synthetic creation job did not finish");
  }
  phase = "prepare"; const draft = await job("prepare", { input }); phase = null;
  const context = draft.creationContext;
  assert.equal(context.kind, "verified-creation-context-v1"); assert.equal(context.draftId, draft.id);
  assert.equal(context.snapshot, draft.snapshot); assert.equal(context.origin, f.origin);
  assert.equal(context.instanceId, minted.data.instanceId); assert.equal(context.wallet, f.organizerAddress);
  assert.equal(context.session.wallet, f.organizerAddress); assert.equal(context.session.mode, "wallet");
  assert.equal(context.chain.chainId, 1); assert.equal(context.factory.address, f.manifest.factoryDeployment.factory);
  assert.equal(context.factory.verified, true); assert.equal(context.factory.deploymentTrust.status, "verified");
  assert.equal(context.factory.upgrade.version, 10); assert.equal(context.factory.upgrade.delaySeconds, 0);
  assert.equal(context.organizerSetup.policyStatus, "verified"); assert.equal(context.capabilities.createEvents, true);
  assert.deepEqual(context.events, []); assert.deepEqual(context.recoveryEvents, []);
  assert.equal(factorySetupIssue(context, { requireWallet: true }), null);
  assert.equal(assertCreationDraft(draft, context, input).id, draft.id);
  phase = "validate"; const validated = await job("validate", { draftId: draft.id }); phase = null;
  assert.deepEqual(validated.transaction, draft.transaction);
  assert.equal(assertCreationDraft(validated.draft, context, input).id, draft.id);
  t.diagnostic(JSON.stringify({ measuredCreationReads: Object.fromEntries(Object.entries(profiles).map(([name, methods]) => [name, {
    rpc: methods.length, credits: methods.reduce((sum, method) => sum + INFURA_READ_METHOD_CREDITS[method], 0),
    methods: Object.fromEntries([...new Set(methods)].map(method => [method, methods.filter(value => value === method).length])),
  }])) }));
  const allReads = Object.values(profiles).flat();
  assert(allReads.length <= Math.floor(280 * 0.80), "Creation keeps at least 20% fewer RPCs than the measured baseline");
  assert(allReads.reduce((sum, method) => sum + INFURA_READ_METHOD_CREDITS[method], 0) <= Math.floor(15090 * 0.75),
    "Creation keeps at least 25% fewer provider credits without skipping its three complete proofs");
  assert.equal(profiles.prepare.filter(method => method === "eth_getLogs").length, 4,
    "Preparation still performs both complete historical factory proofs");
  assert.equal(profiles.validate.filter(method => method === "eth_getLogs").length, 2,
    "Final validation still performs its complete historical factory proof");
  const sent = await f.sendSyntheticTransaction(1, draft.transaction); await sent.wait();
  const submitted = await request(base + "/submitted", { draftId: draft.id, hash: sent.hash });
  assert.equal(submitted.status, 200, submitted.body.toString());
  const confirmed = await job("reconcile", { draftId: draft.id, hash: sent.hash });
  assert.equal(confirmed.status, "confirmed"); assert.equal(confirmed.hash, sent.hash);
  assert.equal(confirmed.participantUrl, `${f.origin}/#event=${draft.eventId}&view=participant`);
  const record = f.workbench().events.get(draft.eventId);
  assert.equal(record.definition.timezone, input.timezone); assert.equal(record.definition.startsAt, input.startsAt);
  assert.equal(record.definition.endsAt, input.endsAt); assert.equal(record.deployment.eventStart, Date.parse(input.startsAt) / 1000);
  assert.equal(record.deployment.claimDeadline, Date.parse(input.startsAt) / 1000 + 7 * 86400);
  const saved = f.savedState().drafts.find(([id]) => id === draft.id)[1];
  assert.equal(saved.submittedHash, sent.hash); assert.equal(saved.confirmedHash, sent.hash); assert(saved.v10Intent);
  assert(saved.submissionWitness); assert(saved.v10Submission); assert.equal(saved.creationContext, undefined,
    "Returned proof context does not alter the original persistent review/journal fields");
  assert.equal(f.stats.authSignatures, 0); assert.equal(f.stats.backendSigningCalls, 0);
  t.diagnostic(JSON.stringify({ kind: "actual-local-v10-creation-speed", baselineRPC: 280,
    phases: Object.fromEntries(Object.entries(profiles).map(([name, methods]) => [name, {
      rpc: methods.length, credits: methods.reduce((sum, method) => sum + INFURA_READ_METHOD_CREDITS[method], 0),
      methods: Object.fromEntries([...new Set(methods)].map(method => [method, methods.filter(value => value === method).length])),
    }])) }));
});
