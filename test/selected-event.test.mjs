import { test } from "node:test";
import assert from "node:assert/strict";
import { selectedEventResult } from "../public/selected-event.js";

const alice = `0x${"a".repeat(40)}`;
const bob = `0x${"b".repeat(40)}`;
const contract = `0x${"c".repeat(40)}`;
const eventId = "synthetic-event-a";
const context = () => ({
  eventId,
  capturedWallet: alice,
  hasCapturedSession: true,
});
const copy = (value) => JSON.parse(JSON.stringify(value));

function fixture(version = "kleros-event-v8", actor = alice) {
  const event = {
    id: eventId,
    title: "Synthetic event",
    chainId: version === "truth-pays-v7" ? 1337 : 10200,
    contract,
    deploymentBlock: 123,
    contractVersion: version,
    abiVersion: version,
    policyURI: "/synthetic-policy",
    templateHash: `0x${"d".repeat(64)}`,
  };
  return {
    instanceId: "synthetic-server-instance",
    chain: { chainId: event.chainId },
    session: actor === null ? null : { wallet: actor, mode: "wallet" },
    capabilities: { selectedEventBootstrap: true },
    events: [copy(event)],
    selectedEvent: {
      instanceId: "synthetic-server-instance",
      eventId,
      wallet: actor,
      detail: {
        event,
        state: { fingerprint: "synthetic-snapshot", blockNumber: 456 },
        transactions: [],
        participants: [],
      },
      error: null,
    },
  };
}

function resultWithoutMutation(bootstrap, captured = context()) {
  const before = JSON.stringify(bootstrap);
  const capturedBefore = JSON.stringify(captured);
  const result = selectedEventResult(bootstrap, captured);
  assert.equal(
    JSON.stringify(bootstrap),
    before,
    "does not mutate the response",
  );
  assert.equal(
    JSON.stringify(captured),
    capturedBefore,
    "does not mutate captured scope",
  );
  return result;
}

for (const version of [
  "truth-pays-v7",
  "kleros-event-v8",
  "kleros-event-v8-test15m",
]) {
  test(`accepts exact capability-bound ${version} detail without mutation`, () => {
    const bootstrap = fixture(version);
    const result = resultWithoutMutation(bootstrap);
    assert.deepEqual(result, { detail: bootstrap.selectedEvent.detail });
    assert.equal(result.detail, bootstrap.selectedEvent.detail);
  });
}

test("old backend and unsupported capability preserve serial GET fallback", () => {
  for (const edit of [
    (value) => delete value.capabilities,
    (value) => delete value.capabilities.selectedEventBootstrap,
    (value) => {
      value.capabilities.selectedEventBootstrap = false;
    },
    (value) => {
      value.capabilities.selectedEventBootstrap = "true";
    },
    (value) => delete value.selectedEvent,
    (value) => {
      value.selectedEvent = null;
    },
  ]) {
    const bootstrap = fixture();
    edit(bootstrap);
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
  assert.equal(selectedEventResult(null, context()), null);
  assert.equal(selectedEventResult(fixture(), { eventId: null }), null);
});

test("instance and selected/detail event mismatches cannot reuse bundled data", () => {
  for (const edit of [
    (value) => {
      value.instanceId = "another-instance";
    },
    (value) => {
      value.instanceId = "";
    },
    (value) => {
      value.instanceId = 123;
    },
    (value) => delete value.selectedEvent.instanceId,
    (value) => {
      value.selectedEvent.eventId = "synthetic-event-b";
    },
    (value) => {
      value.selectedEvent.detail.event.id = "synthetic-event-b";
    },
    (value) => {
      value.events[0].id = "synthetic-event-b";
    },
  ]) {
    const bootstrap = fixture();
    edit(bootstrap);
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
});

test("response actor, captured actor and explicit anonymous session must agree", () => {
  const changedActor = fixture(undefined, bob);
  assert.equal(resultWithoutMutation(changedActor), null);
  const selectedActor = fixture();
  selectedActor.selectedEvent.wallet = bob;
  assert.equal(resultWithoutMutation(selectedActor), null);
  const knownAnonymous = {
    eventId,
    capturedWallet: null,
    hasCapturedSession: true,
  };
  assert.equal(resultWithoutMutation(fixture(), knownAnonymous), null);
  assert.deepEqual(
    resultWithoutMutation(fixture(undefined, null), knownAnonymous),
    {
      detail: fixture(undefined, null).selectedEvent.detail,
    },
  );
  assert.equal(resultWithoutMutation(fixture(undefined, null)), null);
});

test("unknown first-load session can be established only by one internally bound response", () => {
  const captured = { eventId, capturedWallet: null, hasCapturedSession: false };
  for (const actor of [alice, null]) {
    const bootstrap = fixture(undefined, actor);
    assert.deepEqual(resultWithoutMutation(bootstrap, captured), {
      detail: bootstrap.selectedEvent.detail,
    });
  }
  const bootstrap = fixture();
  bootstrap.selectedEvent.wallet = bob;
  assert.equal(resultWithoutMutation(bootstrap, captured), null);
});

test("wallet comparison is address-case insensitive without rewriting inputs", () => {
  const bootstrap = fixture();
  bootstrap.session.wallet = `0x${"A".repeat(40)}`;
  bootstrap.selectedEvent.detail.event.contract = `0x${"C".repeat(40)}`;
  assert.deepEqual(resultWithoutMutation(bootstrap), {
    detail: bootstrap.selectedEvent.detail,
  });
});

test("malformed response and captured wallets never normalize into anonymity", () => {
  const malformed = ["", "not-a-wallet", "0x123", 0, false, {}, []];
  for (const bad of malformed) {
    const server = fixture();
    server.session.wallet = bad;
    assert.equal(resultWithoutMutation(server), null);
    const selected = fixture();
    selected.selectedEvent.wallet = bad;
    assert.equal(resultWithoutMutation(selected), null);
    const anonymous = fixture(undefined, null);
    assert.equal(
      resultWithoutMutation(anonymous, {
        eventId,
        capturedWallet: bad,
        hasCapturedSession: true,
      }),
      null,
    );
    assert.equal(
      resultWithoutMutation(anonymous, {
        eventId,
        capturedWallet: bad,
        hasCapturedSession: false,
      }),
      null,
    );
  }
  const bootstrap = fixture(undefined, null);
  delete bootstrap.selectedEvent.wallet;
  assert.equal(resultWithoutMutation(bootstrap, { eventId }), null);
});

test("chain and deployed contract disagreement requires a separate event GET", () => {
  for (const edit of [
    (value) => {
      value.chain.chainId = 1337;
    },
    (value) => {
      value.selectedEvent.detail.event.chainId = 1337;
    },
    (value) => {
      value.events[0].chainId = 1337;
    },
    (value) => {
      value.selectedEvent.detail.event.contract = bob;
    },
    (value) => {
      value.events[0].contract = "0x123";
    },
    (value) => {
      value.selectedEvent.detail.event.contract = null;
    },
  ]) {
    const bootstrap = fixture();
    edit(bootstrap);
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
  for (const bad of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "not-a-chain",
    null,
  ]) {
    const bootstrap = fixture();
    bootstrap.events[0].chainId = bad;
    bootstrap.chain.chainId = bad;
    bootstrap.selectedEvent.detail.event.chainId = bad;
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
});

for (const field of [
  "deploymentBlock",
  "contractVersion",
  "abiVersion",
  "policyURI",
  "templateHash",
]) {
  test(`${field} mismatch or jointly missing binding never qualifies as bundled detail`, () => {
    const changed = fixture();
    changed.selectedEvent.detail.event[field] =
      field === "deploymentBlock" ? 124 : "different";
    assert.equal(resultWithoutMutation(changed), null);
    const missing = fixture();
    delete missing.events[0][field];
    delete missing.selectedEvent.detail.event[field];
    assert.equal(resultWithoutMutation(missing), null);
    const invalid = fixture();
    invalid.events[0][field] = field === "deploymentBlock" ? -1 : "";
    invalid.selectedEvent.detail.event[field] = invalid.events[0][field];
    assert.equal(resultWithoutMutation(invalid), null);
  });
}

test("malformed event lists and missing detail structure fall back without throwing", () => {
  for (const bad of [
    undefined,
    null,
    {},
    "events",
    1,
    [null],
    [1],
    ["event"],
  ]) {
    const bootstrap = fixture();
    bootstrap.events = bad;
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
  for (const edit of [
    (value) => {
      value.selectedEvent.detail = null;
    },
    (value) => delete value.selectedEvent.detail.event,
    (value) => {
      value.selectedEvent.detail.state = null;
    },
    (value) => {
      value.selectedEvent.detail.state = "state";
    },
    (value) => {
      value.selectedEvent.detail.state = [];
    },
    (value) => {
      value.selectedEvent.detail.transactions = {};
    },
    (value) => {
      value.selectedEvent.detail.participants = null;
    },
  ]) {
    const bootstrap = fixture();
    edit(bootstrap);
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
});

function errorFixture(status = 404) {
  const bootstrap = fixture();
  bootstrap.events = [];
  bootstrap.selectedEvent.detail = null;
  bootstrap.selectedEvent.error = {
    status,
    message: "Event unavailable",
    code: "NOT_FOUND",
  };
  return bootstrap;
}

test("a bound 4xx/5xx error needs no public summary or extra private detail read", () => {
  for (const status of [400, 401, 403, 404, 409, 500, 599]) {
    const bootstrap = errorFixture(status);
    assert.deepEqual(resultWithoutMutation(bootstrap), {
      error: bootstrap.selectedEvent.error,
    });
  }
  const bootstrap = errorFixture();
  delete bootstrap.selectedEvent.error.code;
  assert.deepEqual(resultWithoutMutation(bootstrap), {
    error: bootstrap.selectedEvent.error,
  });
});

test("unbound errors and malformed error statuses cannot replace the event read", () => {
  for (const edit of [
    (value) => {
      value.selectedEvent.eventId = "another-event";
    },
    (value) => {
      value.selectedEvent.instanceId = "another-instance";
    },
    (value) => {
      value.selectedEvent.wallet = bob;
    },
    (value) => delete value.selectedEvent.detail,
    (value) => {
      value.selectedEvent.error.message = null;
    },
  ]) {
    const bootstrap = errorFixture();
    edit(bootstrap);
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
  for (const status of [200, 399, 600, 404.5, "404", null]) {
    const bootstrap = errorFixture();
    bootstrap.selectedEvent.error.status = status;
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
});

test("detail and error are an exclusive union", () => {
  const bootstrap = fixture();
  bootstrap.selectedEvent.error = { status: 403, message: "Denied" };
  assert.equal(resultWithoutMutation(bootstrap), null);
});

test("deeply frozen response and capture are accepted without mutation", () => {
  const freeze = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const bootstrap = freeze(fixture());
  const captured = freeze(context());
  assert.deepEqual(resultWithoutMutation(bootstrap, captured), {
    detail: bootstrap.selectedEvent.detail,
  });
});

function projectedFixture(role = "participant", actor = alice) {
  const bootstrap = fixture(undefined, actor);
  const detail = bootstrap.selectedEvent.detail;
  detail.permissions = {
    authenticated: actor !== null,
    owner: actor !== null && role === "owner",
    staff: actor !== null && (role === "owner" || role === "staff"),
  };
  detail.ownWallet =
    actor === null
      ? null
      : {
          wallet: actor,
          pendingCreditWei: "12",
          owedWei: "3",
        };
  detail.deposits = [];
  detail.unmatched = [];
  detail.imports = [];
  detail.attendance = [];
  detail.personal = null;
  return bootstrap;
}

const unknownSession = () => ({
  eventId,
  capturedWallet: null,
  hasCapturedSession: false,
});

test("profile-free own-wallet facts must belong to the authenticated response actor", () => {
  for (const version of [
    "truth-pays-v7",
    "kleros-event-v8",
    "kleros-event-v8-test15m",
  ]) {
    const bootstrap = projectedFixture();
    bootstrap.events[0].contractVersion = version;
    bootstrap.events[0].abiVersion = version;
    bootstrap.selectedEvent.detail.event.contractVersion = version;
    bootstrap.selectedEvent.detail.event.abiVersion = version;
    if (version === "truth-pays-v7")
      delete bootstrap.selectedEvent.detail.ownWallet.pendingCreditWei;
    bootstrap.selectedEvent.detail.ownWallet.wallet = `0x${"A".repeat(40)}`;
    assert.deepEqual(resultWithoutMutation(bootstrap), {
      detail: bootstrap.selectedEvent.detail,
    });
    bootstrap.selectedEvent.detail.ownWallet.wallet = bob;
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
});

test("malformed own-wallet projection is rejected even in a correctly bound envelope", () => {
  for (const bad of [
    true,
    false,
    "wallet",
    [],
    {},
    { wallet: null },
    { wallet: "0x123" },
  ]) {
    const bootstrap = projectedFixture();
    bootstrap.selectedEvent.detail.ownWallet = bad;
    assert.equal(resultWithoutMutation(bootstrap), null);
  }
});

test("anonymous projection accepts only false permissions and empty protected fields", () => {
  const bootstrap = projectedFixture("participant", null);
  for (const capture of [
    unknownSession(),
    {
      eventId,
      capturedWallet: null,
      hasCapturedSession: true,
    },
  ]) {
    assert.deepEqual(resultWithoutMutation(bootstrap, capture), {
      detail: bootstrap.selectedEvent.detail,
    });
  }
  for (const flag of ["authenticated", "owner", "staff"]) {
    const privileged = projectedFixture("participant", null);
    privileged.selectedEvent.detail.permissions[flag] = true;
    assert.equal(resultWithoutMutation(privileged, unknownSession()), null);
  }
});

test("anonymous envelope rejects every protected payload rather than stripping data", () => {
  const leaked = {
    wallet: bob,
    name: "Synthetic Bob",
    email: "bob@example.test",
  };
  for (const field of [
    "participants",
    "deposits",
    "unmatched",
    "imports",
    "attendance",
    "transactions",
  ]) {
    const bootstrap = projectedFixture("participant", null);
    bootstrap.selectedEvent.detail[field] = [copy(leaked)];
    assert.equal(
      resultWithoutMutation(bootstrap, unknownSession()),
      null,
      field,
    );
  }
  for (const field of ["personal", "ownWallet"]) {
    const bootstrap = projectedFixture("participant", null);
    bootstrap.selectedEvent.detail[field] = copy(leaked);
    assert.equal(
      resultWithoutMutation(bootstrap, unknownSession()),
      null,
      field,
    );
  }
});

test("malformed optional permission or protected-array shapes cannot bypass redaction", () => {
  for (const bad of [[], true, "anonymous"]) {
    const bootstrap = projectedFixture("participant", null);
    bootstrap.selectedEvent.detail.permissions = bad;
    assert.equal(resultWithoutMutation(bootstrap, unknownSession()), null);
  }
  for (const flag of ["authenticated", "owner", "staff"]) {
    for (const bad of ["false", "true", 0, 1, null]) {
      const bootstrap = projectedFixture("participant", null);
      bootstrap.selectedEvent.detail.permissions[flag] = bad;
      assert.equal(resultWithoutMutation(bootstrap, unknownSession()), null);
    }
  }
  for (const field of ["deposits", "unmatched", "imports", "attendance"]) {
    for (const bad of [null, {}, "", false]) {
      const bootstrap = projectedFixture("participant", null);
      bootstrap.selectedEvent.detail[field] = bad;
      assert.equal(resultWithoutMutation(bootstrap, unknownSession()), null);
    }
  }
});

test("legitimate owner and staff keep their server-authorized guest projections", () => {
  for (const role of ["owner", "staff"]) {
    const bootstrap = projectedFixture(role);
    const detail = bootstrap.selectedEvent.detail;
    detail.participants = [
      {
        id: "synthetic-bob",
        eventId,
        wallet: bob,
        name: "Synthetic Bob",
        email: "bob@example.test",
      },
    ];
    detail.deposits = [{ wallet: bob, receivedWei: "50" }];
    detail.unmatched = [{ wallet: bob, unallocatedWei: "10" }];
    detail.imports = [{ id: "synthetic-import" }];
    detail.attendance = [{ participantId: "synthetic-bob" }];
    detail.transactions = [{ wallet: bob, action: "deposit" }];
    for (const capture of [context(), unknownSession()])
      assert.deepEqual(resultWithoutMutation(bootstrap, capture), { detail });
  }
});

test("legitimate participants and first-load cookies retain only their own contact rows", () => {
  const bootstrap = projectedFixture();
  const detail = bootstrap.selectedEvent.detail;
  detail.participants = [
    {
      id: "synthetic-alice",
      eventId,
      wallet: `0x${"A".repeat(40)}`,
      name: "Synthetic Alice",
      email: "alice@example.test",
    },
  ];
  detail.attendance = [{ participantId: "synthetic-alice" }];
  detail.transactions = [{ wallet: alice, action: "deposit" }];
  detail.personal = { attended: true };
  for (const capture of [context(), unknownSession()])
    assert.deepEqual(resultWithoutMutation(bootstrap, capture), { detail });
  // Missing optional permissions never implicitly grants owner/staff projection.
  delete detail.permissions;
  assert.deepEqual(resultWithoutMutation(bootstrap), { detail });
});

test("unprivileged participant projections reject another wallet or malformed contact row", () => {
  for (const row of [
    null,
    {},
    { wallet: "0x123" },
    {
      wallet: bob,
      name: "Synthetic Bob",
      email: "bob@example.test",
    },
  ]) {
    for (const explicitPermissions of [true, false]) {
      const bootstrap = projectedFixture();
      bootstrap.selectedEvent.detail.participants = [row];
      if (!explicitPermissions)
        delete bootstrap.selectedEvent.detail.permissions;
      assert.equal(resultWithoutMutation(bootstrap), null);
    }
  }
  const bootstrap = projectedFixture();
  bootstrap.selectedEvent.detail.permissions.authenticated = false;
  assert.equal(resultWithoutMutation(bootstrap), null);
});
