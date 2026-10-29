import assert from "node:assert/strict";
import test from "node:test";
import {
  publicEventSearchEntries,
  searchPublicEvents,
} from "../public/event-search.js";
import {
  makePublicEventSearchFixture,
  PUBLIC_SEARCH_A,
  PUBLIC_SEARCH_B,
  PUBLIC_SEARCH_TITLE,
} from "./fixtures/public-event-search-fixture.mjs";

test("Public search excludes owner-private, draft, missing flags and malformed deployment identities", () => {
  const fixture = makePublicEventSearchFixture({ signedOwner: true });
  const entries = publicEventSearchEntries(fixture.bootstrap.events);
  assert.deepEqual(
    entries.map((value) => value.id).sort(),
    [PUBLIC_SEARCH_A, PUBLIC_SEARCH_B].sort(),
  );
});
test("Projection drops authorized-owner and contact data while retaining two same-title stable identities", () => {
  const entries = publicEventSearchEntries(
    makePublicEventSearchFixture({ signedOwner: true }).bootstrap.events,
  );
  for (const entry of entries) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      [
        "id",
        "title",
        "startsAt",
        "timezone",
        "depositWei",
        "statusLabel",
      ].sort(),
    );
    assert.equal(entry.title, PUBLIC_SEARCH_TITLE);
  }
  assert.equal(new Set(entries.map((value) => value.startsAt)).size, 2);
  assert(!JSON.stringify(entries).includes("SHOULD_NOT_PROJECT"));
});
test("Title search is case insensitive and never searches private metadata or unrelated fields", () => {
  const entries = publicEventSearchEntries(
    makePublicEventSearchFixture().bootstrap.events,
  );
  assert.equal(searchPublicEvents(entries, "  aLpHa  ").length, 2);
  assert.deepEqual(searchPublicEvents(entries, "PRIVATE OWNER"), []);
  assert.deepEqual(searchPublicEvents(entries, "SHOULD_NOT_PROJECT"), []);
  assert.deepEqual(
    searchPublicEvents(
      entries,
      entries.find((event) => event.id === PUBLIC_SEARCH_B).statusLabel,
    ),
    [],
  );
});
test("Empty inputs stay empty without fabricated entries and filtering leaves the supplied catalog unchanged", () => {
  assert.deepEqual(publicEventSearchEntries([]), []);
  assert.deepEqual(publicEventSearchEntries(null), []);
  const events = makePublicEventSearchFixture().bootstrap.events,
    before = JSON.stringify(events);
  const entries = publicEventSearchEntries(events);
  searchPublicEvents(entries, "nothing matches");
  assert.equal(JSON.stringify(events), before);
  assert.deepEqual(searchPublicEvents(entries, ""), entries);
});

test("Conflicting duplicate stable IDs are excluded rather than choosing a deployment by title or array order", () => {
  const fixture = makePublicEventSearchFixture();
  fixture.bootstrap.events.push(structuredClone(fixture.bootstrap.events[0]));
  assert.deepEqual(
    publicEventSearchEntries(fixture.bootstrap.events).map((event) => event.id),
    [PUBLIC_SEARCH_B],
  );
});

test("Unsupported display metadata stays honest and zero never becomes a free-deposit claim", () => {
  for (const depositWei of ["0", "-1", "not-wei", (2n ** 256n).toString()]) {
    const fixture = makePublicEventSearchFixture();
    Object.assign(fixture.bootstrap.events[0], {
      depositWei,
      startsAt: "not-a-date",
      timezone: "not-a-zone",
      financialPhase: "unknown-phase",
    });
    const entry = publicEventSearchEntries(fixture.bootstrap.events).find(
      (event) => event.id === PUBLIC_SEARCH_A,
    );
    assert(entry);
    assert.equal(entry.depositWei, null);
    assert.equal(entry.startsAt, null);
    assert.equal(entry.timezone, null);
    assert.equal(entry.statusLabel, "Status unavailable");
  }
});
