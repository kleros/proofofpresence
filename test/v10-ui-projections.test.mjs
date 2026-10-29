import assert from "node:assert/strict";
import test, { after } from "node:test";
import { makePublicEventSearchFixture } from "./fixtures/public-event-search-fixture.mjs";
import { FIXTURE_WALLET as wallet } from "./fixtures/production-ui-fixture.mjs";

// TEST ONLY: synthetic display DTOs. No backend, signer, wallet-extension,
// receipt verification, adoption, controller or financial permission is proved.
const effects = { request: 0, provider: 0, storage: 0, dom: 0 };
const descriptors = new Map();
for (const [name, effect] of [
  ["fetch", "request"],
  ["XMLHttpRequest", "request"],
  ["ethereum", "provider"],
  ["localStorage", "storage"],
  ["sessionStorage", "storage"],
  ["window", "dom"],
  ["document", "dom"],
]) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      effects[effect]++;
      throw Error("Pure V10 projection must not access " + name);
    },
  });
}
const profiles = await import("../public/contract-profiles.js");
const { validatePublicCatalog, publicEventSearchEntries, searchPublicEvents } =
  await import("../public/event-search.js");
const { projectOwnedEvents, renderOwnedEvents } = await import(
  "../public/owned-events.js"
);
after(() => {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  assert.deepEqual(effects, { request: 0, provider: 0, storage: 0, dom: 0 });
});
const V9 = "kleros-event-v9-uups";
const V10 = "kleros-event-v10-uups";
const copy = (value) => structuredClone(value);
function profile10() {
  return {
    contractVersion: V10,
    abiVersion: V10,
    version: 10,
    financialModel: "v8",
    upgradeable: true,
    verified: true,
    challengeWindowSeconds: 86400,
    matchWindowSeconds: 86400,
    testOnly: false,
    chainId: 1,
  };
}
function fixture10() {
  const bootstrap = copy(
    makePublicEventSearchFixture({ signedOwner: true }).bootstrap,
  );
  const event = {
    ...copy(bootstrap.events[0]),
    id: "synthetic-v10-owned-public",
    title: 'V10 Café <img src=x onerror="alert(1)">',
    role: "organizer",
    contractVersion: V10,
    abiVersion: V10,
    contractProfile: profile10(),
    visibility: "public",
    editorialStatus: "published",
    organizerEmail: "PRIVATE_CONTACT@example.test",
    capabilities: { financial: true },
  };
  Object.assign(bootstrap, {
    contractVersion: V10,
    abiVersion: V10,
    contractProfile: profile10(),
    events: [event],
  });
  return {
    bootstrap,
    event,
    scope: {
      mode: "hosted-production",
      instanceId: bootstrap.instanceId,
      wallet,
    },
  };
}
function catalog(event) {
  const recorded = copy(event);
  // Real schema1 recorded rows omit the current verified contract profile.
  delete recorded.contractProfile;
  return {
    schemaVersion: 1,
    kind: "public-catalog",
    mode: "hosted-production",
    instanceId: "synthetic-v10-catalog-instance",
    environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
    chain: {
      chainId: 1,
      name: "Ethereum",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrl: "https://example.test/rpc",
    },
    generatedAt: "2026-10-29T12:00:00.000Z",
    catalog: {
      metadataOnly: true,
      currentFinancialState: "not-loaded",
      source: "recorded-adoption",
    },
    events: [
      {
        ...recorded,
        adoption: {
          kind: "recorded-adoption",
          txHash: "0x" + "a".repeat(64),
          blockNumber: 100,
          blockHash: "0x" + "b".repeat(64),
        },
      },
    ],
  };
}
function unreadPrivate(flags) {
  return {
    ...flags,
    get id() {
      throw Error("Excluded private record id read");
    },
    get title() {
      throw Error("Excluded private record title read");
    },
    get contractProfile() {
      throw Error("Excluded private record profile read");
    },
  };
}

test("V10 requires its complete exact verified production profile and explicit dispatch", () => {
  assert.equal(profiles.V10_PRODUCTION_CONTRACT_VERSION, V10);
  assert.equal(profiles.PRODUCTION_CONTRACT_VERSION, V9);
  assert.equal(profiles.isVerifiedV10ProductionProfile(profile10()), true);
  assert.equal(
    profiles.isVerifiedSupportedProductionProfile(profile10(), V10),
    true,
  );
  assert.equal(profiles.isVerifiedProductionProfile(profile10()), false);
  for (const key of Object.keys(profile10())) {
    const missing = profile10();
    delete missing[key];
    assert.equal(
      profiles.isVerifiedV10ProductionProfile(missing),
      false,
      "Missing required V10 profile field: " + key,
    );
  }
  for (const patch of [
    { contractVersion: V9 },
    { abiVersion: V9 },
    { version: 9 },
    { financialModel: "v7" },
    { upgradeable: false },
    { verified: false },
    { challengeWindowSeconds: 900 },
    { matchWindowSeconds: 900 },
    { testOnly: true },
    { chainId: 10200 },
  ])
    assert.equal(
      profiles.isVerifiedV10ProductionProfile({ ...profile10(), ...patch }),
      false,
    );
  for (const unknown of [undefined, null, V10 + "-preview", "10", 10, V9 + "x"])
    assert.equal(profiles.isSupportedProductionVersion(unknown), false);
  assert.equal(profiles.isSupportedProductionVersion(V9), true);
  assert.equal(profiles.isSupportedProductionVersion(V10), true);
  for (const explicit of [undefined, null, V9, V10 + "-preview"])
    assert.equal(
      profiles.isVerifiedSupportedProductionProfile(profile10(), explicit),
      false,
    );
});

test("Existing V9 predicates keep optional profile metadata compatibility and reject V10", () => {
  const bootstrap = makePublicEventSearchFixture({
    signedOwner: true,
  }).bootstrap;
  const event = copy(bootstrap.events[0]);
  for (const key of ["contractVersion", "abiVersion", "chainId"])
    delete event.contractProfile[key];
  assert.equal(
    profiles.isVerifiedProductionProfile(event.contractProfile),
    true,
  );
  assert.equal(profiles.isVerifiedProductionEvent(event), true);
  assert.equal(profiles.isVerifiedSupportedProductionEvent(event), true);
  assert.equal(
    profiles.isVerifiedSupportedProductionProfile(event.contractProfile, V9),
    true,
  );
  assert.equal(
    profiles.isVerifiedV10ProductionProfile(event.contractProfile),
    false,
  );
  assert.equal(profiles.isVerifiedV10ProductionEvent(event), false);
  const scope = {
    mode: "hosted-production",
    instanceId: bootstrap.instanceId,
    wallet,
  };
  bootstrap.events = [{ ...event, role: "organizer" }];
  delete bootstrap.abiVersion;
  assert.equal(projectOwnedEvents(bootstrap, scope).length, 1);
});

test("V10 event identity requires matching event and profile tuples without prefix support", () => {
  const { event } = fixture10();
  assert.equal(profiles.isVerifiedV10ProductionEvent(event), true);
  assert.equal(profiles.isVerifiedSupportedProductionEvent(event), true);
  assert.equal(profiles.isVerifiedProductionEvent(event), false);
  for (const alter of [
    (e) => {
      delete e.abiVersion;
    },
    (e) => {
      e.contractVersion = V10 + "-unknown";
    },
    (e) => {
      e.abiVersion = V9;
    },
    (e) => {
      e.chainId = 10200;
    },
    (e) => {
      e.contractProfile = null;
    },
    (e) => {
      e.contractProfile.version = 9;
    },
    (e) => {
      delete e.contractProfile.abiVersion;
    },
    (e) => {
      e.contractProfile.verified = false;
    },
  ]) {
    const malformed = copy(event);
    alter(malformed);
    assert.equal(profiles.isVerifiedV10ProductionEvent(malformed), false);
    assert.equal(profiles.isVerifiedSupportedProductionEvent(malformed), false);
  }
});

test("V10 public summaries filter privacy flags before reading data and stay local display projections", () => {
  const { event } = fixture10();
  const dto = catalog(event);
  for (const flags of [
    { visibility: "private", editorialStatus: "published" },
    { visibility: "public", editorialStatus: "draft" },
    { editorialStatus: "published" },
    { visibility: "public" },
  ])
    dto.events.push(unreadPrivate(flags));
  const recorded = validatePublicCatalog(dto);
  assert.equal(recorded.events.length, 1);
  assert.equal(recorded.events[0].statusLabel, "Check status on open");
  assert.deepEqual(Object.keys(recorded.events[0]).sort(), [
    "depositWei",
    "id",
    "startsAt",
    "statusLabel",
    "timezone",
    "title",
  ]);
  assert(Object.isFrozen(recorded) && Object.isFrozen(recorded.events));
  assert(Object.isFrozen(recorded.events[0]));
  assert.equal(dto.events[0].contractProfile, undefined);
  const current = publicEventSearchEntries([event, ...dto.events.slice(1)]);
  assert.equal(current.length, 1);
  assert.equal(searchPublicEvents(recorded.events, "CAFE").length, 1);
  assert.equal(searchPublicEvents(current, "private").length, 0);
  assert.equal(
    searchPublicEvents(recorded.events, "PRIVATE_CONTACT").length,
    0,
  );
  const text = JSON.stringify(recorded);
  assert(!text.includes("PRIVATE_CONTACT"));
  assert(!text.includes("capabilities"));
  assert(!text.includes("contractProfile"));
});

test("V10 catalog links require exact supported ABI and complete recorded adoption", () => {
  const { event } = fixture10();
  for (const alter of [
    (e) => {
      e.abiVersion = V9;
    },
    (e) => {
      delete e.abiVersion;
    },
    (e) => {
      e.contractVersion = V10 + "-future";
    },
    (e) => {
      e.chainId = 10200;
    },
    (e) => {
      e.id = "../foreign";
    },
    (e) => {
      delete e.adoption;
    },
    (e) => {
      e.adoption.kind = "pending";
    },
    (e) => {
      e.adoption.txHash = "0x" + "0".repeat(64);
    },
    (e) => {
      e.adoption.blockHash = "not-a-hash";
    },
    (e) => {
      e.adoption.blockNumber = 0;
    },
  ]) {
    const dto = catalog(event);
    alter(dto.events[0]);
    assert.deepEqual(validatePublicCatalog(dto).events, []);
  }
  const duplicate = catalog(event);
  duplicate.events.push(copy(duplicate.events[0]));
  assert.deepEqual(validatePublicCatalog(duplicate).events, []);
  const dto = catalog(event);
  const view = validatePublicCatalog(dto);
  dto.events[0].title = "CHANGED AFTER PROJECTION";
  assert.notEqual(view.events[0].title, dto.events[0].title);
});

test("Matching V10 owned summaries retain only immutable escaped display fields", () => {
  const { bootstrap, event, scope } = fixture10();
  bootstrap.events.push({
    ...copy(event),
    id: "synthetic-v10-private-draft",
    title: 'Private <img src=x onerror="alert(1)">',
    visibility: "private",
    editorialStatus: "draft",
  });
  const rows = projectOwnedEvents(bootstrap, scope);
  assert.equal(rows.length, 2);
  assert(Object.isFrozen(rows) && rows.every(Object.isFrozen));
  for (const row of rows)
    assert.deepEqual(Object.keys(row).sort(), [
      "editorialStatus",
      "id",
      "startsAt",
      "timezone",
      "title",
      "visibility",
    ]);
  const originalTitle = rows[0].title;
  bootstrap.events[0].title = "MUTATED";
  assert.equal(rows[0].title, originalTitle);
  const html = renderOwnedEvents(rows);
  assert(html.includes("&lt;img"));
  assert(!html.includes("<img"));
  assert(!html.includes("PRIVATE_CONTACT"));
  assert(!html.includes("data-tx"));
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) =>
    m[1].replaceAll("&amp;", "&"),
  );
  assert.deepEqual(
    links,
    rows.map(
      (row) => "#" + new URLSearchParams({ event: row.id, view: "organizer" }),
    ),
  );
});

test("V10 owned inventory is unavailable before exact actor, instance, environment and ABI guards", () => {
  for (const alter of [
    (b, s) => {
      s.wallet = "0x" + "9".repeat(40);
    },
    (b, s) => {
      s.instanceId = "stale-instance";
    },
    (b, s) => {
      s.mode = "hosted-v9-testnet";
    },
    (b) => {
      b.session = null;
    },
    (b) => {
      b.session.mode = "recovery";
    },
    (b) => {
      b.environment.production = false;
    },
    (b) => {
      b.environment.chainId = 10200;
    },
    (b) => {
      b.chain.chainId = 10200;
    },
    (b) => {
      b.contractProfile.verified = false;
    },
    (b) => {
      delete b.abiVersion;
    },
    (b) => {
      b.abiVersion = V9;
    },
  ]) {
    const { bootstrap, scope } = fixture10();
    alter(bootstrap, scope);
    Object.defineProperty(bootstrap, "events", {
      configurable: true,
      get() {
        throw Error("Private inventory read before context match");
      },
    });
    assert.equal(projectOwnedEvents(bootstrap, scope), null);
  }
  assert.match(renderOwnedEvents(null), /data-owned-state="unavailable"/);
  assert(!renderOwnedEvents(null).includes("synthetic-v10-private-draft"));
});

test("V10 owned role and identity filtering never infer ownership or reuse stale private rows", () => {
  const { bootstrap, event, scope } = fixture10();
  for (const role of ["participant", "creator", "owner"])
    bootstrap.events.push({
      ...copy(event),
      role,
      id: "not-organizer-" + role,
      creator: wallet,
      organizers: [wallet],
      get title() {
        throw Error("Nonorganizer private title read");
      },
    });
  const bad = { ...copy(event), id: "bad-v10-identity", abiVersion: V9 };
  Object.defineProperty(bad, "title", {
    get() {
      throw Error("Invalid event identity title read");
    },
  });
  bootstrap.events.push(bad);
  const otherFamily = copy(
    makePublicEventSearchFixture({ signedOwner: true }).bootstrap.events[0],
  );
  otherFamily.id = "other-production-family";
  otherFamily.role = "organizer";
  Object.defineProperty(otherFamily, "title", {
    get() {
      throw Error("Other active contract family title read");
    },
  });
  bootstrap.events.push(otherFamily);
  assert.deepEqual(
    projectOwnedEvents(bootstrap, scope).map((row) => row.id),
    [event.id],
  );
  bootstrap.events = [];
  assert.deepEqual(projectOwnedEvents(bootstrap, scope), []);
  assert.match(renderOwnedEvents([]), /data-owned-state="empty"/);
  bootstrap.session.wallet = "0x" + "8".repeat(40);
  assert.equal(projectOwnedEvents(bootstrap, scope), null);
  assert.deepEqual(effects, { request: 0, provider: 0, storage: 0, dom: 0 });
});
