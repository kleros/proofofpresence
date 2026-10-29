// Pure browser-transport tests. No sockets, wallet, provider, publication or financial execution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrganizerJobClient } from "../public/luma-setup.js";

const factory = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "a".repeat(64);
const terms = () => ({
  title: "Synthetic event",
  lumaUrl: "https://luma.com/synthetic-event",
  startsAt: "2030-11-04T11:00:00.000Z",
  endsAt: "2030-11-04T13:00:00.000Z",
  timezone: "Asia/Bangkok",
  depositEth: "0.001",
});
const bootstrap = () => ({
  mode: "hosted-production",
  instanceId: "synthetic-instance",
  chain: { chainId: 1 },
  session: { mode: "wallet", wallet },
  factory: { address: factory, abiVersion: "kleros-event-v9-uups" },
});
const code = (expected) => (error) => error.code === expected;
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.fail("Synthetic asynchronous checkpoint was not reached");
}
class Storage {
  data = new Map([
    ["kleros-transactions:v1:submitted", "financial-hash-untouched"],
    ["kleros-factory-creation:v1:original", "financial-marker-untouched"],
  ]);
  get length() {
    return this.data.size;
  }
  key(index) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key) {
    return this.data.get(key) ?? null;
  }
  setItem(key, value) {
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}
function fixture() {
  let time = 1_000_000,
    serial = 0,
    timerId = 0,
    current = true;
  const storage = new Storage(),
    timers = new Map(),
    calls = [],
    jobs = new Map();
  const settings = {
    bootstrap: bootstrap(),
    storage,
    origin: "https://synthetic.invalid",
    now: () => time,
    isCurrent: () => current,
    newId: () => `synthetic-request-${++serial}`,
    setTimer: (callback, ms) => {
      const id = ++timerId;
      timers.set(id, { callback, at: time + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    request: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      if (body) jobs.set(body.requestId, body);
      const requestId =
        body?.requestId ?? decodeURIComponent(url.split("/").at(-1));
      const operation = body?.operation ?? jobs.get(requestId)?.operation;
      const call = {
        url,
        method: options.method ?? "GET",
        body,
        requestId,
        operation,
        signal: options.signal,
      };
      calls.push(call);
      return f.respond(call);
    },
  };
  const f = {
    storage,
    timers,
    calls,
    jobs,
    settings,
    envelope(call, patch = {}) {
      return {
        schemaVersion: 1,
        kind: "organizer-job",
        requestId: call.requestId,
        instanceId: settings.bootstrap.instanceId,
        operation: call.operation,
        chainId: 1,
        factory,
        contractVersion: "kleros-event-v9-uups",
        wallet,
        state: "ready",
        result: { id: "synthetic-result" },
        expiresAt: time + (call.operation === "validate" ? 5000 : 300000),
        ...patch,
      };
    },
    respond(call) {
      return f.envelope(call);
    },
    create(overrides = {}) {
      return createOrganizerJobClient({ ...settings, ...overrides });
    },
    advance(ms) {
      time += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
    },
    setTime(value) {
      time = value;
    },
    revoke() {
      current = false;
    },
    markers() {
      return [...storage.data].filter(([key]) =>
        key.startsWith("kleros-organizer-job:v1:"),
      );
    },
    financialUntouched() {
      assert.equal(
        storage.getItem("kleros-transactions:v1:submitted"),
        "financial-hash-untouched",
      );
      assert.equal(
        storage.getItem("kleros-factory-creation:v1:original"),
        "financial-marker-untouched",
      );
    },
  };
  f.client = f.create();
  return f;
}

test("one durable POST then bounded status GET returns the unchanged operation result", async () => {
  const f = fixture();
  f.respond = (call) => {
    const saved = f.markers().map(([, raw]) => JSON.parse(raw));
    assert.equal(
      saved[0].requestId,
      call.requestId,
      "Identity is durable before initial request",
    );
    assert.match(saved[0].payloadHash, /^[a-f0-9]{64}$/);
    assert.equal(
      JSON.stringify(saved).includes(terms().title),
      false,
      "Marker stores a terms hash, not form content",
    );
    return call.method === "POST"
      ? f.envelope(call, { state: "pending", pollAfterMs: 1000 })
      : f.envelope(call, {
          result: { exact: "server result", transaction: { data: "0xabcd" } },
        });
  };
  const pending = f.client.run("prepare", { input: terms() });
  await until(() => f.calls.length === 1 && f.timers.size === 2);
  assert.deepEqual(f.calls[0].body, {
    requestId: "synthetic-request-1",
    operation: "prepare",
    input: terms(),
  });
  f.advance(1000);
  assert.deepEqual(await pending, {
    exact: "server result",
    transaction: { data: "0xabcd" },
  });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["POST", "GET"],
  );
  assert.equal(
    f.calls[1].url,
    "/api/organizer/events/jobs/synthetic-request-1",
  );
  assert.equal(f.timers.size, 0);
  f.financialUntouched();
});

test("lost initial acknowledgement survives reload and resumes GET only for the same exact terms", async () => {
  const f = fixture();
  f.respond = () => {
    throw Object.assign(new Error("Synthetic lost acknowledgement"), {
      status: 504,
    });
  };
  await assert.rejects(
    f.client.run("prepare", { input: terms() }),
    /lost acknowledgement/,
  );
  f.client.dispose();
  assert.equal(f.markers().length, 1);
  f.respond = (call) => f.envelope(call);
  const reloaded = f.create();
  await reloaded.run("prepare", { input: { ...terms() } });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["POST", "GET"],
  );
  assert.equal(f.calls[0].requestId, f.calls[1].requestId);
  f.financialUntouched();
});

test("validate and reconcile use exact separate bodies, with canonical lowercase hash", async () => {
  const f = fixture();
  await f.client.run("validate", { draftId: "original-draft" });
  await f.client.run("reconcile", {
    draftId: "original-draft",
    hash: hash.toUpperCase().replace("0X", "0x"),
  });
  assert.deepEqual(f.calls[0].body, {
    requestId: "synthetic-request-1",
    operation: "validate",
    draftId: "original-draft",
  });
  assert.deepEqual(f.calls[1].body, {
    requestId: "synthetic-request-2",
    operation: "reconcile",
    draftId: "original-draft",
    hash,
  });
  f.financialUntouched();
});

test("every response binds schema, request, actor, operation and exact factory environment", async (t) => {
  for (const patch of [
    { schemaVersion: 2 },
    { kind: "other" },
    { requestId: "foreign" },
    { instanceId: "foreign" },
    { operation: "validate" },
    { chainId: 10200 },
    { factory: "0x" + "3".repeat(40) },
    { wallet: "0x" + "4".repeat(40) },
    { contractVersion: "kleros-event-v9-uups-chiado" },
    { state: "unknown" },
  ]) {
    await t.test(JSON.stringify(patch), async () => {
      const f = fixture();
      f.respond = (call) => f.envelope(call, patch);
      await assert.rejects(
        f.client.run("prepare", { input: terms() }),
        code("ORGANIZER_JOB_SCOPE"),
      );
      assert.equal(f.markers().length, 1);
      assert.equal(f.timers.size, 0);
      f.financialUntouched();
    });
  }
});

test("confirmed terminal unsigned job requires explicit reset; pending and transaction markers survive", async () => {
  const f = fixture();
  await f.client.run("prepare", { input: terms() });
  f.respond = (call) =>
    f.envelope(call, {
      state: "failed",
      error: {
        code: "STALE_DRAFT",
        error: "Review the current event terms again.",
      },
    });
  const terminal = await f.client
    .run("validate", { draftId: "original-draft" })
    .catch((error) => error);
  assert.equal(terminal.code, "STALE_DRAFT");
  assert.equal(terminal.organizerJob.state, "failed");
  f.respond = () => {
    throw Error("Keep ambiguous pending identity");
  };
  await assert.rejects(
    f.client.run("prepare", {
      input: { ...terms(), title: "Other unsigned form" },
    }),
    /ambiguous/,
  );
  assert.equal(f.markers().length, 3);
  f.respond = (call) =>
    f.envelope(call, {
      state: "failed",
      error: { code: "STALE_DRAFT", error: "Still terminal" },
    });
  await assert.rejects(
    f.client.run("validate", { draftId: "original-draft" }),
    code("STALE_DRAFT"),
  );
  assert.equal(
    f.calls.at(-1).method,
    "GET",
    "Terminal job does not restart automatically",
  );
  f.client.clearTerminal(terminal, { unsigned: true });
  assert.equal(
    f.markers().length,
    1,
    "Only unrelated ambiguous unsigned marker remains",
  );
  f.respond = (call) => f.envelope(call);
  await f.client.run("prepare", { input: terms() });
  assert.equal(f.calls.at(-1).method, "POST");
  assert.equal(f.calls.at(-1).requestId, "synthetic-request-4");
  f.financialUntouched();
});

test("status network failures and unknown IDs retain the original identity without a second POST", async () => {
  const f = fixture();
  f.respond = () => {
    throw Error("Synthetic network unavailable");
  };
  for (let i = 0; i < 3; i++)
    await assert.rejects(
      f.client.run("prepare", { input: terms() }),
      /unavailable/,
    );
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["POST", "GET", "GET"],
  );
  assert.equal(new Set(f.calls.map((call) => call.requestId)).size, 1);
  assert.throws(
    () =>
      f.client.clearTerminal({
        organizerJob: {
          key: f.markers()[0][0],
          requestId: "synthetic-request-1",
        },
      }),
    code("ORGANIZER_JOB_STORAGE"),
  );
  f.financialUntouched();
});

test("180 second wait limit aborts even an uncooperative transport and clears all timers", async () => {
  const f = fixture();
  f.respond = () => new Promise(() => {});
  const pending = f.client.run("prepare", { input: terms() });
  const rejected = assert.rejects(pending, code("ORGANIZER_JOB_WAIT_STOPPED"));
  await until(() => f.calls.length === 1);
  f.advance(180000);
  await rejected;
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.markers().length, 1);
  f.financialUntouched();
});

test("dispose aborts an outstanding poll without a new request or timer leak", async () => {
  const f = fixture();
  f.respond = (call) =>
    f.envelope(call, { state: "pending", pollAfterMs: 1000 });
  const pending = f.client.run("prepare", { input: terms() });
  const rejected = assert.rejects(pending, code("ORGANIZER_JOB_WAIT_STOPPED"));
  await until(() => f.timers.size === 2);
  f.client.dispose();
  await rejected;
  f.advance(180000);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
  await assert.rejects(
    f.client.run("prepare", { input: terms() }),
    code("ORGANIZER_JOB_STALE"),
  );
  f.financialUntouched();
});

test("changed form or session during an await rejects ready data before the caller can use it", async () => {
  for (const actorChanged of [false, true]) {
    const f = fixture();
    let sameForm = true;
    f.respond = (call) => {
      if (actorChanged) f.revoke();
      else sameForm = false;
      return f.envelope(call);
    };
    await assert.rejects(
      f.client.run(
        "prepare",
        { input: terms() },
        { isCurrent: () => sameForm },
      ),
      code("ORGANIZER_JOB_STALE"),
    );
    assert.equal(JSON.parse(f.markers()[0][1]).state, "pending");
    f.financialUntouched();
  }
});

test("parallel checks for the same payload cannot race into two POSTs", async () => {
  const f = fixture(),
    held = deferred();
  f.respond = () => held.promise;
  const first = f.client.run("prepare", { input: terms() });
  await until(() => f.calls.length === 1);
  await assert.rejects(
    f.client.run("prepare", { input: terms() }),
    code("ORGANIZER_JOB_BUSY"),
  );
  held.resolve(f.envelope(f.calls[0]));
  await first;
  assert.equal(f.calls.length, 1);
  f.financialUntouched();
});

test("validation expires immediately before send, but its deadline is consumed before the wallet opens", async () => {
  const f = fixture();
  await f.client.run("validate", { draftId: "fresh-draft" });
  f.advance(4999);
  f.client.consumeValidation();
  f.advance(20000);
  assert.equal(
    f.markers().length,
    1,
    "An open wallet does not rewrite transaction state after the deadline",
  );
  await assert.rejects(
    f.client.run("validate", { draftId: "other-draft" }).then(() => {
      f.advance(5000);
      f.client.consumeValidation();
    }),
    code("ORGANIZER_JOB_EXPIRED"),
  );
  assert.equal(JSON.parse(f.markers().at(-1)[1]).state, "expired");
  assert.throws(
    () => f.create().consumeValidation(),
    code("ORGANIZER_JOB_EXPIRED"),
  );
  f.financialUntouched();
});

test("missing, elapsed, implausible or nonnumeric ready deadline fails closed", async (t) => {
  for (const expiresAt of [
    undefined,
    1_000_000,
    1_005_001,
    "1005000",
    Number.NaN,
  ]) {
    await t.test(String(expiresAt), async () => {
      const f = fixture();
      f.respond = (call) => f.envelope(call, { expiresAt });
      await assert.rejects(
        f.client.run("validate", { draftId: "original-draft" }),
        code("ORGANIZER_JOB_EXPIRED"),
      );
      f.financialUntouched();
    });
  }
});

test("invalid or reversed device clock cannot open or consume validation", async () => {
  const f = fixture();
  await f.client.run("validate", { draftId: "original-draft" });
  f.setTime(999_999);
  assert.throws(
    () => f.client.consumeValidation(),
    code("ORGANIZER_JOB_CLOCK"),
  );
  f.setTime(Number.NaN);
  await assert.rejects(
    f.client.run("prepare", { input: terms() }),
    code("ORGANIZER_JOB_CLOCK"),
  );
  f.financialUntouched();
});

test("explicit terminal reconcile reset starts only a new check for the same submitted hash", async () => {
  const f = fixture();
  f.respond = (call) => f.envelope(call, { state: "expired" });
  const terminal = await f.client
    .run("reconcile", { draftId: "original-draft", hash })
    .catch((error) => error);
  assert.equal(terminal.organizerJob.operation, "reconcile");
  assert.throws(
    () => f.client.clearTerminal(terminal, { unsigned: true }),
    code("ORGANIZER_JOB_STORAGE"),
  );
  f.client.clearTerminal(terminal);
  f.respond = (call) => f.envelope(call);
  await f.client.run("reconcile", { draftId: "original-draft", hash });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls.at(-1).body.hash, hash);
  f.financialUntouched();
});

test("malformed input or unwritable/corrupt storage makes zero transport requests", async () => {
  const f = fixture();
  for (const [operation, args] of [
    ["prepare", { input: { ...terms(), extra: "bad" } }],
    ["validate", { draftId: "../bad" }],
    ["reconcile", { draftId: "draft", hash: "0x123" }],
  ])
    await assert.rejects(
      f.client.run(operation, args),
      code("ORGANIZER_JOB_INPUT"),
    );
  const blocked = f.create({
    storage: {
      getItem: () => null,
      setItem() {
        throw Error("blocked");
      },
    },
  });
  await assert.rejects(
    blocked.run("prepare", { input: terms() }),
    code("ORGANIZER_JOB_STORAGE"),
  );
  assert.equal(f.calls.length, 0);
  await f.client.run("prepare", { input: terms() });
  f.storage.setItem(f.markers()[0][0], "invalid JSON");
  await assert.rejects(
    f.client.run("prepare", { input: terms() }),
    code("ORGANIZER_JOB_STORAGE"),
  );
  assert.equal(f.calls.length, 1);
  f.financialUntouched();
});

test("saved unsigned checks are isolated by wallet, factory, server instance and origin", async () => {
  const f = fixture();
  await f.client.run("prepare", { input: terms() });
  for (const change of [
    { bootstrap: { ...bootstrap(), instanceId: "other-instance" } },
    {
      bootstrap: {
        ...bootstrap(),
        session: { mode: "wallet", wallet: "0x" + "3".repeat(40) },
      },
    },
    {
      bootstrap: {
        ...bootstrap(),
        factory: { ...bootstrap().factory, address: "0x" + "4".repeat(40) },
      },
    },
    { origin: "https://other-synthetic.invalid" },
  ]) {
    const scoped = change.bootstrap ?? bootstrap();
    f.respond = (call) =>
      f.envelope(call, {
        instanceId: scoped.instanceId,
        wallet: scoped.session.wallet,
        factory: scoped.factory.address,
      });
    await f.create(change).run("prepare", { input: terms() });
  }
  assert.equal(f.markers().length, 5);
  assert.equal(
    f.calls.every((call) => call.method === "POST"),
    true,
  );
  f.financialUntouched();
});

test("definitive rejected start and later missing-session status allow only explicit unsigned abandonment", async () => {
  for (const firstCode of ["ORGANIZER_JOB_BUSY", "ORGANIZER_JOB_CAPACITY"]) {
    const f = fixture();
    f.respond = () => {
      throw Object.assign(new Error("Synthetic rejected start"), {
        code: firstCode,
        status: 409,
      });
    };
    const first = await f.client
      .run("prepare", { input: terms() })
      .catch((error) => error);
    assert.equal(first.organizerJob.abandon, true);
    assert.equal(f.markers().length, 1);
    f.respond = () => {
      throw Object.assign(new Error("Synthetic private job not found"), {
        code: "ORGANIZER_JOB_NOT_FOUND",
        status: 404,
      });
    };
    const missing = await f.client
      .run("prepare", { input: terms() })
      .catch((error) => error);
    assert.equal(f.calls.at(-1).method, "GET");
    assert.equal(missing.organizerJob.requestId, first.organizerJob.requestId);
    assert.equal(f.markers().length, 1, "No implicit reset on failure");
    f.client.clearTerminal(missing, { unsigned: true });
    f.respond = (call) => f.envelope(call);
    await f.client.run("prepare", { input: terms() });
    assert.equal(f.calls.at(-1).method, "POST");
    assert.notEqual(f.calls.at(-1).requestId, first.organizerJob.requestId);
    f.financialUntouched();
  }
});

test("expired ready form and unknown receipt result retain explicit reset scope and original hash", async () => {
  const f = fixture();
  await f.client.run("prepare", { input: terms() });
  const stale = f.client.unusedResult(
    "prepare",
    Object.assign(new Error("Synthetic original draft expired"), {
      code: "STALE_DRAFT",
    }),
  );
  assert.equal(stale.organizerJob.state, "ready");
  assert.equal(stale.organizerJob.abandon, true);
  f.client.clearTerminal(stale, { unsigned: true });
  assert.equal(f.markers().length, 0);
  f.respond = () => {
    throw Object.assign(
      new Error("Synthetic missing old-session receipt check"),
      { status: 401 },
    );
  };
  const unavailable = await f.client
    .run("reconcile", { draftId: "original-draft", hash })
    .catch((error) => error);
  assert.equal(unavailable.organizerJob.hash, hash);
  assert.throws(
    () => f.client.clearTerminal(unavailable, { unsigned: true }),
    code("ORGANIZER_JOB_STORAGE"),
  );
  f.client.clearTerminal(unavailable);
  f.financialUntouched();
});
