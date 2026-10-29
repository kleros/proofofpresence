import { test } from "node:test";
import assert from "node:assert/strict";
import { createFactoryRefresh } from "../src/shared-factory-refresh.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("overlapping bootstrap refreshes await one complete verification, then the next request verifies afresh", async () => {
  const chain = { factoryTrust: null, verifiedFactory: false },
    deployment = { factory: "synthetic-factory-a" },
    first = deferred(),
    second = deferred(),
    calls = [],
    refresh = createFactoryRefresh(chain, deployment, (...args) => {
      calls.push(args);
      return calls.length === 1 ? first.promise : second.promise;
    });
  let returned = 0;
  const a = refresh().then(() => returned++),
    b = refresh().then(() => returned++);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], chain);
  assert.equal(calls[0][1], deployment);
  assert.equal(
    returned,
    0,
    "neither caller returns while full verification is pending",
  );
  const trust = { anchor: { number: 10 }, verified: "synthetic-full-proof" };
  first.resolve(trust);
  await Promise.all([a, b]);
  assert.equal(returned, 2);
  assert.equal(chain.factoryTrust, trust);
  assert.equal(chain.verifiedFactory, true);
  const next = refresh();
  await Promise.resolve();
  assert.equal(calls.length, 2, "there is no TTL or completed-result cache");
  const freshTrust = { anchor: { number: 11 } };
  second.resolve(freshTrust);
  assert.equal(await next, undefined);
  assert.equal(chain.factoryTrust, freshTrust);
});

test("shared failure closes factory trust without reflecting errors and permits a fresh retry", async () => {
  const chain = { factoryTrust: { old: true }, verifiedFactory: true },
    failed = deferred(),
    calls = [],
    trust = { anchor: { number: 20 } },
    refresh = createFactoryRefresh(
      chain,
      { factory: "synthetic-factory" },
      () => {
        calls.push("verify");
        return calls.length === 1 ? failed.promise : trust;
      },
    ),
    a = refresh(),
    b = refresh();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  failed.reject(
    new Error("private RPC URL, parameters and remote diagnostics"),
  );
  assert.deepEqual(await Promise.all([a, b]), [undefined, undefined]);
  assert.equal(chain.factoryTrust, null);
  assert.equal(chain.verifiedFactory, false);
  await refresh();
  assert.equal(calls.length, 2);
  assert.equal(chain.factoryTrust, trust);
  assert.equal(chain.verifiedFactory, true);
});

test("synchronous verifier failure also clears singleflight for a later request", async () => {
  const chain = { factoryTrust: { old: true }, verifiedFactory: true };
  let calls = 0;
  const refresh = createFactoryRefresh(
    chain,
    { factory: "synthetic-factory" },
    () => {
      calls++;
      if (calls === 1) throw new Error("private verifier detail");
      return { verified: true };
    },
  );
  await Promise.all([refresh(), refresh()]);
  assert.equal(calls, 1);
  assert.equal(chain.factoryTrust, null);
  assert.equal(chain.verifiedFactory, false);
  await refresh();
  assert.equal(calls, 2);
  assert.equal(chain.verifiedFactory, true);
});

test("independent workbench or factory closures never coalesce across boundaries", async () => {
  const firstChain = {},
    secondChain = {},
    factoryA = { factory: "factory-a" },
    factoryB = { factory: "factory-b" },
    gates = [deferred(), deferred(), deferred()],
    calls = [],
    verify = (chain, deployment) => {
      const gate = gates[calls.length];
      calls.push({ chain, deployment });
      return gate.promise;
    },
    refreshes = [
      createFactoryRefresh(firstChain, factoryA, verify),
      createFactoryRefresh(secondChain, factoryA, verify),
      createFactoryRefresh(firstChain, factoryB, verify),
    ],
    work = refreshes.map((refresh) => refresh());
  await Promise.resolve();
  assert.equal(calls.length, 3);
  assert.equal(calls[0].chain, firstChain);
  assert.equal(calls[1].chain, secondChain);
  assert.equal(calls[2].deployment, factoryB);
  gates.forEach((gate, index) => gate.resolve({ proof: index }));
  await Promise.all(work);
});

test("an absent deployment is a no-op without verifier calls or trust mutation", async () => {
  const chain = { factoryTrust: { retained: true }, verifiedFactory: true },
    before = structuredClone(chain);
  for (const deployment of [undefined, null]) {
    let calls = 0;
    const refresh = createFactoryRefresh(chain, deployment, () => {
      calls++;
    });
    assert.deepEqual(await Promise.all([refresh(), refresh()]), [
      undefined,
      undefined,
    ]);
    assert.equal(calls, 0);
    assert.deepEqual(chain, before);
  }
});
