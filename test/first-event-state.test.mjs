// Strict read-only provider: decodes the actual deployless helper and each V10
// ABI request. No signer, RPC endpoint, external chain or private file exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ethers } from "ethers";
import { collectFirstEventState, publicFirstEventState } from "../src/first-event-state.mjs";
import { createFirstEventDisplay } from "../src/first-event-display.mjs";
import { FIRST_EVENT_MANAGE_SCOPE as scope } from "../src/first-event-manage-scope.mjs";
import { loadV10UpgradeableArtifacts } from "../src/v10-upgrade-artifacts.mjs";
import { v10RuntimeCode } from "../scripts/mainnet/v10-runtime-code.mjs";
import { V10_READ_BATCH_BYTECODE } from "../src/v10-read-batch.mjs";
import { withReadJobScope } from "../src/read-job-scope.mjs";
import { hash } from "../src/utils.mjs";
import { createV10AppFixture } from "./fixtures/v10-app-fixture.mjs";

const address = n => ethers.getAddress("0x" + n.toString(16).padStart(40, "0"));
const digest = n => "0x" + n.toString(16).padStart(64, "0");
const coder = ethers.AbiCoder.defaultAbiCoder();
function fixture(count = 2) {
  const a = loadV10UpgradeableArtifacts(), controllerHash = ethers.keccak256(a.controller.deployedBytecode);
  const d = { ...scope, abiVersion: scope.contractVersion, eventId: scope.eventId,
    factory: address(2), implementation: address(3), factoryImplementation: address(4), upgradeAuthority: address(5), initialUpgradeOwner: address(6),
    codeHash: ethers.keccak256(a.proxy.deployedBytecode), factoryCodeHash: ethers.keccak256(a.proxy.deployedBytecode),
    implementationCodeHash: ethers.keccak256(v10RuntimeCode(a.event, address(3), controllerHash)),
    factoryImplementationCodeHash: ethers.keccak256(v10RuntimeCode(a.factory, address(4), controllerHash)), upgradeAuthorityCodeHash: controllerHash,
    eventStart: 1000, claimDeadline: 1000 + 7 * 86400, depositWei: "10000000000000000", deploymentBlock: 10, deploymentTxHash: digest(10) };
  const record = { definition: { id: scope.eventId, startsAt: new Date(1000000).toISOString(), endsAt: new Date(2000000).toISOString() }, deployment: d };
  const wallets = Array.from({ length: count }, (_, i) => address(100 + i));
  const event = new ethers.Interface(a.event.abi), factory = new ethers.Interface(a.factory.abi), controller = new ethers.Interface(a.controller.abi);
  const interfaces = new Map([[d.contract.toLowerCase(), event], [d.factory.toLowerCase(), factory], [d.upgradeAuthority.toLowerCase(), controller]]);
  const hashes = new Map([[d.contract, d.codeHash], [d.factory, d.factoryCodeHash], [d.implementation, d.implementationCodeHash],
    [d.factoryImplementation, d.factoryImplementationCodeHash], [d.upgradeAuthority, d.upgradeAuthorityCodeHash]].map(([key, value]) => [key.toLowerCase(), value]));
  const block = { number: 123, hash: digest(123), timestamp: 3000 }, calls = [], reads = [];
  let corruptCode = false, corruptSlot = false, instanceId = "display-state-first", override = null, afterCall = null;
  const value = (target, method, args) => {
    const family = target.toLowerCase() === d.factory.toLowerCase() ? "factory" : "event";
    const base = { VERSION: 10n, UPGRADE_FAMILY: ethers.id(`kleros.${family}.v10.uups`), implementationRevision: 1n,
      storageSchema: ethers.id(`kleros.${family}.v10.storage.1`), upgradeAuthority: d.upgradeAuthority,
      UPGRADE_DELAY_SECONDS: 0n, upgradesDisabled: false, pendingOwner: ethers.ZeroAddress,
      owner: target.toLowerCase() === d.upgradeAuthority.toLowerCase() ? d.initialUpgradeOwner : address(7),
      eventStart: BigInt(d.eventStart), claimDeadline: BigInt(d.claimDeadline), depositAmount: BigInt(d.depositWei),
      phase: 1n, challengeEndsAt: 90000n, challengeDeposit: 12n, stakers: wallets, CHALLENGE_PERIOD: 86400n, MATCH_PERIOD: 86400n,
      status: 1n, attended: args[0]?.toLowerCase() === wallets[0]?.toLowerCase(),
      challenges: [0n, ethers.ZeroAddress, 0n, 0n, 0n, 0n, 0n, 0n] };
    return override?.(target, method, args, base[method]) ?? base[method];
  };
  const provider = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_getStorageAt") {
        assert.equal(params[2], ethers.toQuantity(block.number));
        return corruptSlot ? ethers.ZeroHash : ethers.zeroPadValue(params[0].toLowerCase() === d.contract.toLowerCase() ? d.implementation : d.factoryImplementation, 32);
      }
      assert.equal(method, "eth_call", "No action or unrelated RPC is allowed");
      assert.equal(params[1], ethers.toQuantity(block.number));
      assert.equal(params[0].to, undefined); assert(params[0].data.startsWith(V10_READ_BATCH_BYTECODE));
      const [targets, inputs, codeOnly] = coder.decode(["address[]", "bytes[]", "bool"], "0x" + params[0].data.slice(V10_READ_BATCH_BYTECODE.length));
      const results = targets.map((target, i) => {
        if (codeOnly) return corruptCode ? digest(999) : hashes.get(target.toLowerCase());
        const iface = interfaces.get(target.toLowerCase()); assert(iface, "Only exact public contracts may be read");
        const parsed = iface.parseTransaction({ data: inputs[i] });
        assert(["view", "pure"].includes(parsed.fragment.stateMutability));
        reads.push({ target, method: parsed.name, args: [...parsed.args], block: params[1] });
        const result = value(target, parsed.name, [...parsed.args]);
        return iface.encodeFunctionResult(parsed.fragment, parsed.fragment.outputs.length === 1 ? [result] : result);
      });
      const result = coder.encode(["bytes[]"], [results]); afterCall?.(); return result;
    },
    async getBlock(number) { calls.push({ method: "getBlock", params: [number] }); return number === "latest" || number === block.number ? { ...block } : { number, hash: digest(number), timestamp: 1 }; },
    async getLogs() { calls.push({ method: "getLogs", params: [] }); return []; },
  };
  const chain = { provider, production: true, chainId: 1, governance: { kind: "single-owner-immediate", initialOwner: d.initialUpgradeOwner, upgradeDelaySeconds: 0, renounceable: true },
    manifest: { provenance: Object.fromEntries([["v10BuildManifestSha256", "manifest"], ["v10StandardInputSha256", "standard-input"]]
      .map(([key, file]) => [key, hash(JSON.parse(fs.readFileSync(new URL(`../build/contracts-v10/${file}.json`, import.meta.url))))])) } };
  const rows = new Map(), store = { async read(key) { return structuredClone(rows.get(key) ?? null); },
    async write(key, binding, snapshot) { rows.set(key, structuredClone({ binding, snapshot })); },
    async withLease(_key, callback) { return callback(store); } };
  const w = { chain, provider, record: () => record, firstEventManageAvailable: () => true,
    publicCatalog: () => ({ mode: "hosted-production", instanceId, environment: { production: true, chainId: 1 },
      events: [{ id: scope.eventId, ...scope, visibility: "public", editorialStatus: "published",
        adoption: { kind: "recorded-adoption", txHash: d.deploymentTxHash, blockNumber: 10, blockHash: digest(10) } }] }),
    state() { throw Error("Private/full state forbidden"); }, bootstrap() { throw Error("Bootstrap forbidden"); }, owner() { throw Error("Private role verification forbidden"); } };
  const collect = extra => collectFirstEventState({ provider, chain, record, block, ...extra });
  const display = id => { instanceId = id; return createFirstEventDisplay(w, { instanceId, origin: "https://state.example.invalid", store, now: () => 10000000 }); };
  return { d, record, chain, provider, block, calls, reads, rows, wallets, collect, display,
    corruptCode: () => { corruptCode = true; }, corruptSlot: () => { corruptSlot = true; },
    override: callback => { override = callback; }, afterCall: callback => { afterCall = callback; } };
}

test("public event hints use source-pinned V10 batch getters and two slots at exactly the receipt block", async () => {
  const f = fixture();
  f.override((_target, method, args, normal) => method === "challenges" && args[0].toLowerCase() === f.wallets[1].toLowerCase()
    ? [2n, address(9), 90003n, 13n, 999n, 17n, 7n, 8n] : normal);
  const state = await f.collect();
  assert.equal(state.phase, "Listed"); assert.equal(state.owner, address(7)); assert.equal(state.eventStart, 1000); assert.equal(state.endsAt, 2000);
  assert.equal(state.chainTimestamp, 3000); assert.equal(state.challengeDepositWei, "12"); assert.equal(state.stakers.length, 2);
  assert.deepEqual(state.stakers[0], { wallet: f.wallets[0], status: 1, attended: true, challenge: { state: 0, depositWei: "0", matchDeadline: 0, localId: "0" } });
  assert.deepEqual(state.stakers[1].challenge, { state: 2, depositWei: "13", matchDeadline: 90003, localId: "17" });
  assert.equal(f.calls.filter(row => row.method === "eth_getStorageAt").length, 2);
  assert(f.reads.every(row => row.block === "0x7b")); assert.equal(f.reads.length, 25 + 6);
  assert.equal(Object.hasOwn(state, "verified"), false); assert.equal(Object.hasOwn(state, "capabilities"), false);
});

test("maximum 150 stakers stay within the 512-read bound; duplicate and excessive history are rejected", async () => {
  const full = fixture(150), state = await full.collect();
  assert.equal(state.stakers.length, 150); assert.equal(full.reads.length, 475);
  assert.equal(full.calls.filter(row => row.method === "eth_call").length, 10, "One code-hash, one header, eight row chunks");
  for (const count of [151, 2]) {
    const f = fixture(count); if (count === 2) f.wallets[1] = f.wallets[0];
    await assert.rejects(f.collect()); assert(!f.reads.some(row => row.method === "status"));
  }
});

test("an empty decoded ethers Result creates no row requests or phantom stakers", async () => {
  const f = fixture(0), state = await f.collect();
  assert.deepEqual(state.stakers, []);
  assert.equal(f.reads.length, 25, "Only public header getters run for an empty history");
  assert.equal(f.calls.filter(row => row.method === "eth_call").length, 2, "Code hashes and header only; no empty row batch");
});

test("actual local V10 Open event with no registered stakers yields usable optional state", { timeout: 90000 }, async t => {
  const f = await createV10AppFixture(); t.after(() => f.close());
  const w = f.workbench(), actor = { id: "synthetic-public-state-regression", mode: "wallet", wallet: f.organizerAddress };
  const now = (await f.provider.getBlock("latest")).timestamp;
  const draft = await w.createFactoryDraft(actor, { title: "Synthetic empty registered history", lumaUrl: "https://luma.com/synthetic-empty-state",
    startsAt: new Date((now + 3600) * 1000).toISOString(), endsAt: new Date((now + 7200) * 1000).toISOString(), timezone: "UTC", depositEth: "0.000001" });
  await w.validateFactoryDraft(actor, draft.id);
  const sent = await f.sendSyntheticTransaction(1, draft.transaction); await sent.wait();
  await w.recordFactorySubmitted(actor, draft.id, sent.hash);
  const created = await w.reconcileFactorySubmission(actor, draft.id, sent.hash); assert.equal(created.status, "confirmed");
  const block = await f.provider.getBlock("latest");
  const state = await collectFirstEventState({ provider: w.provider, chain: w.chain, record: w.record(draft.eventId), block });
  assert.equal(state.phase, "Open"); assert.equal(state.owner, f.organizerAddress); assert.deepEqual(state.stakers, []);
  assert.equal(state.eventStart, now + 3600); assert.equal(state.endsAt, now + 7200); assert.equal(state.chainTimestamp, block.timestamp);
  assert.equal(Object.hasOwn(state, "verified"), false); assert.equal(Object.hasOwn(state, "capabilities"), false);
});

test("source, implementation, governance and immutable-term mismatches cannot produce optional state", async () => {
  for (const corrupt of [f => { f.d.codeHash = digest(99); }, f => f.corruptCode(), f => f.corruptSlot(),
    f => { f.chain.governance.upgradeDelaySeconds = 1; }, f => { f.chain.manifest.provenance.v10BuildManifestSha256 = "0".repeat(64); },
    f => f.override((_target, method, _args, normal) => method === "eventStart" ? 1001n : normal),
    f => f.override((_target, method, _args, normal) => method === "phase" ? 4n : normal),
    f => f.override((_target, method, _args, normal) => method === "status" ? 4n : normal)]) {
    const f = fixture(); corrupt(f); await assert.rejects(f.collect());
  }
});

test("JSONB hint projection rejects cross-row, private, enum, integer and immutable-term corruption", async () => {
  const f = fixture(), valid = await f.collect();
  for (const corrupt of [s => { s.stakers[1].wallet = s.stakers[0].wallet; }, s => { s.permissions = { owner: true }; },
    s => { s.stakers[0].email = "synthetic-private@example.invalid"; }, s => { s.stakers[0].challenge.actor = address(2); },
    s => { s.phase = "Settled"; }, s => { s.endsAt++; }, s => { s.stakers[0].attended = 1; },
    s => { s.stakers[0].challenge.state = 4; }, s => { s.challengeDepositWei = (ethers.MaxUint256 + 1n).toString(); },
    s => { s.stakers[0].challenge.matchDeadline = Number.MAX_SAFE_INTEGER + 1; }]) {
    const changed = structuredClone(valid); corrupt(changed); assert.equal(publicFirstEventState(changed, f.record), null);
  }
  const detached = publicFirstEventState(valid, f.record); detached.stakers.length = 0; assert.equal(valid.stakers.length, 2);
  assert.equal(publicFirstEventState(undefined, f.record), null);
});

test("SQL-only read/restart serves optional hints; failed state refresh or invalid hints preserve receipt availability", async () => {
  const f = fixture(), first = f.display("display-state-first");
  await first.refresh(); const afterRefresh = f.calls.length;
  const result = await first.read(); assert.equal(result.eventState.phase, "Listed"); assert.equal(f.calls.length, afterRefresh);
  await first.close(); const restarted = f.display("display-state-restarted");
  assert.equal((await restarted.read()).eventState.stakers.length, 2); assert.equal(f.calls.length, afterRefresh);
  f.rows.values().next().value.snapshot.eventState.privateContacts = ["synthetic-private"];
  assert.equal(Object.hasOwn(await restarted.read(), "eventState"), false); assert.equal(f.calls.length, afterRefresh);
  f.corruptCode(); await restarted.refresh(); const afterFailure = f.calls.length;
  const receipts = await restarted.read(); assert.deepEqual(receipts.depositors, []); assert.equal(Object.hasOwn(receipts, "eventState"), false);
  assert.equal(f.calls.length, afterFailure); await restarted.close();
});

test("aborted collection propagates cancellation and stops before another pinned batch", async () => {
  const f = fixture(150), controller = new AbortController();
  f.afterCall(() => { controller.abort(new DOMException("Synthetic read cancelled", "AbortError")); });
  await assert.rejects(withReadJobScope(controller.signal, () => f.collect({ signal: controller.signal })), error => error.name === "AbortError");
  assert.equal(f.calls.filter(row => row.method === "eth_call").length, 1); assert.equal(f.reads.length, 0);
});
