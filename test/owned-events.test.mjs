import test, { after } from "node:test";
import assert from "node:assert/strict";
import { makePublicEventSearchFixture } from "./fixtures/public-event-search-fixture.mjs";
import { FIXTURE_WALLET as wallet } from "./fixtures/production-ui-fixture.mjs";

// TEST ONLY: ordinary-wallet fixture authority. No real authentication,7702 or backend.
const effects = { request: 0, provider: 0, storage: 0, dom: 0 };
const original = new Map();
for (const [name, effect] of [
  ["fetch", "request"],
  ["ethereum", "provider"],
  ["localStorage", "storage"],
  ["sessionStorage", "storage"],
  ["window", "dom"],
]) {
  original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      effects[effect]++;
      throw Error("Pure owned renderer must not access " + name);
    },
  });
}
const { projectOwnedEvents, renderOwnedEvents } = await import(
  "../public/owned-events.js"
);
after(() => {
  for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  assert.deepEqual(effects, { request: 0, provider: 0, storage: 0, dom: 0 });
});
function fixture() {
  const bootstrap = makePublicEventSearchFixture({
    signedOwner: true,
  }).bootstrap;
  const sample = bootstrap.events[0];
  bootstrap.events = [
    {
      ...sample,
      id: "owned-private-draft",
      title: 'Private <img src=x onerror="alert(1)"> event',
      role: "organizer",
      visibility: "private",
      editorialStatus: "draft",
      organizerEmail: "SECRET_CONTACT@example.test",
      capabilities: { send: true },
    },
    {
      ...sample,
      id: "owned-public",
      title: "Public owned event",
      role: "organizer",
      visibility: "public",
      editorialStatus: "published",
    },
    {
      ...sample,
      id: "participant-private",
      title: "PRIVATE_PARTICIPANT_ONLY",
      role: "participant",
    },
    {
      ...sample,
      id: "creator-not-owner",
      title: "CREATOR_IS_NOT_CURRENT_OWNER",
      role: "creator",
      creator: wallet,
    },
    {
      ...sample,
      id: "unsupported-owner",
      title: "UNSUPPORTED_PROFILE",
      role: "organizer",
      contractVersion: "kleros-event-v8",
      abiVersion: "kleros-event-v8",
    },
    {
      ...sample,
      id: "duplicate-owner",
      title: "DUPLICATE_OWNER_ONE",
      role: "organizer",
    },
    {
      ...sample,
      id: "duplicate-owner",
      title: "DUPLICATE_OWNER_TWO",
      role: "organizer",
    },
  ];
  return {
    bootstrap,
    context: {
      mode: "hosted-production",
      instanceId: bootstrap.instanceId,
      wallet,
    },
  };
}
test("unavailable/mismatched context rejects before reading private inventory and exposes no count", () => {
  for (const patch of [
    { wallet: "0x" + "9".repeat(40) },
    { instanceId: "old-instance" },
    { mode: "hosted-testnet" },
  ]) {
    const { bootstrap, context } = fixture();
    Object.defineProperty(bootstrap, "events", {
      get() {
        throw Error("Private inventory was read before matching context");
      },
    });
    assert.equal(projectOwnedEvents(bootstrap, { ...context, ...patch }), null);
  }
  const { bootstrap, context } = fixture();
  bootstrap.session = null;
  assert.equal(projectOwnedEvents(bootstrap, context), null);
  const unavailable = renderOwnedEvents(null);
  assert.match(unavailable, /data-owned-state="unavailable"/);
  assert(!unavailable.includes("owned-private-draft"));
  assert(!unavailable.includes("No verified events available"));
  assert(!/\b\d+\s+(?:owned\s+)?events\b/.test(unavailable));
});
test("matching current ordinary-wallet context exposes only supported organizer rows, including authorized private drafts", () => {
  const { bootstrap, context } = fixture();
  Object.defineProperty(bootstrap.events[2], "title", {
    get() {
      throw Error("Participant private title must never be read");
    },
  });
  const rows = projectOwnedEvents(bootstrap, context);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["owned-private-draft", "owned-public"],
  );
  assert.equal(rows[0].visibility, "private");
  assert.equal(rows[0].editorialStatus, "draft");
  for (const row of rows)
    assert.deepEqual(
      Object.keys(row).sort(),
      [
        "id",
        "title",
        "startsAt",
        "timezone",
        "visibility",
        "editorialStatus",
      ].sort(),
    );
  const encoded = JSON.stringify(rows);
  for (const forbidden of [
    "SECRET_CONTACT",
    "capabilities",
    "send",
    "CREATOR_IS_NOT_CURRENT_OWNER",
    "UNSUPPORTED_PROFILE",
    "DUPLICATE_OWNER",
  ])
    assert(!encoded.includes(forbidden));
});
test("projection is frozen/detached and HTML escapes titles while generating exact stable manage links", () => {
  const { bootstrap, context } = fixture(),
    rows = projectOwnedEvents(bootstrap, context);
  assert(Object.isFrozen(rows) && rows.every(Object.isFrozen));
  const originalTitle = rows[0].title;
  bootstrap.events[0].title = "MUTATED";
  assert.equal(rows[0].title, originalTitle);
  assert.throws(() => {
    rows[0].title = "unsafe mutation";
  }, TypeError);
  const html = renderOwnedEvents(rows);
  assert(!html.includes("<img"));
  assert(html.includes("&lt;img"));
  assert(!html.includes("SECRET_CONTACT"));
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1].replaceAll("&amp;", "&"),
  );
  assert.deepEqual(
    links,
    rows.map(
      (row) => "#" + new URLSearchParams({ event: row.id, view: "organizer" }),
    ),
  );
  assert(!html.includes("claim"));
  assert(!html.includes("data-tx"));
});
test("empty and unavailable remain distinct; profile or later-session changes cannot reuse previous private rows", () => {
  const { bootstrap, context } = fixture();
  bootstrap.events = [];
  const empty = projectOwnedEvents(bootstrap, context);
  assert.deepEqual(empty, []);
  assert.match(renderOwnedEvents(empty), /data-owned-state="empty"/);
  assert.match(
    renderOwnedEvents(empty),
    /No verified events available for this wallet yet/,
  );
  const old = fixture();
  assert.equal(
    projectOwnedEvents(old.bootstrap, {
      ...old.context,
      wallet: "0x" + "8".repeat(40),
    }),
    null,
  );
  old.bootstrap.contractProfile.verified = false;
  assert.equal(projectOwnedEvents(old.bootstrap, old.context), null);
  assert.deepEqual(effects, { request: 0, provider: 0, storage: 0, dom: 0 });
});
