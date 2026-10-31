import assert from "node:assert/strict";
import test from "node:test";
import { isSelectedBootstrapQuery } from "./fixtures/selected-bootstrap-query.mjs";

test("selected bootstrap fixtures accept legacy and exact opt-in queries", () => {
  for (const search of [
    "selectedEventId=event-a",
    "selectedEventId=event-a&selectedOnly=1",
    "selectedOnly=1&selectedEventId=event-a",
    "selectedEventId=event%2Da&selectedOnly=1",
  ])
    assert.equal(
      isSelectedBootstrapQuery(new URLSearchParams(search), "event-a"),
      true,
      search,
    );
});

test("selected bootstrap fixtures reject foreign actors, duplicates and unknown flags", () => {
  for (const search of [
    "",
    "selectedOnly=1",
    "selectedEventId=",
    "selectedEventId=event-b",
    "selectedEventId=event-b&selectedOnly=1",
    "selectedEventId=event-a&selectedEventId=event-a",
    "selectedEventId=event-a&selectedEventId=event-b&selectedOnly=1",
    "selectedEventId=event-a&selectedOnly=1&selectedOnly=1",
    "selectedEventId=event-a&selectedOnly=1&selectedOnly=0",
    "selectedEventId=event-a&selectedOnly=",
    "selectedEventId=event-a&selectedOnly=0",
    "selectedEventId=event-a&selectedOnly=true",
    "selectedEventId=event-a&selectedOnly=2",
    "selectedEventId=event-a&wallet=foreign",
    "selectedEventId=event-a&selectedOnly=1&wallet=foreign",
    "selectedEventId=event-a&unknown=1",
    "selectedEventId=event-a&selectedOnly=1&unknown=1",
  ])
    assert.equal(
      isSelectedBootstrapQuery(new URLSearchParams(search), "event-a"),
      false,
      search,
    );
});

test("selected bootstrap fixture matching needs an explicit expected event", () => {
  const query = new URLSearchParams("selectedEventId=event-a&selectedOnly=1");
  for (const eventId of [null, undefined, "", 1])
    assert.equal(isSelectedBootstrapQuery(query, eventId), false);
  assert.equal(isSelectedBootstrapQuery(null, "event-a"), false);
  assert.equal(
    isSelectedBootstrapQuery("selectedEventId=event-a", "event-a"),
    false,
  );
});
