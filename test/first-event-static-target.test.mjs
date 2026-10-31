// Offline source/receipt-metadata/QR proof matching only. No chain or wallet.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { EVENT, LEGACY_EVENT, FIRST_EVENTS, firstEventById, isPreviousFirstEvent } from "../public/first-event/event.js";
const read = path => fs.readFileSync(new URL("../" + path, import.meta.url));

test("replacement static identity and schedule match the canonical recorded adoption while legacy recovery stays separate", () => {
  const catalog = JSON.parse(read("artifacts/truth-pays-ist/catalog-after-creation.json")), adopted = catalog.events.find(event => event.id === EVENT.id);
  assert(adopted); assert.equal(EVENT.id, "event-3aac5a07-5074-4241-9246-2798d4111039");
  for (const field of ["contract", "startsAt", "endsAt", "timezone", "depositWei", "chainId"]) assert.equal(EVENT[field], adopted[field]);
  assert.deepEqual(EVENT.adoption, adopted.adoption);
  assert.equal(LEGACY_EVENT.id, "event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5");
  assert.equal(LEGACY_EVENT.contract, "0xCd7418413fBFA814D41799C9dFaCc4654f295c11");
  assert.equal(LEGACY_EVENT.startsAt, "2026-11-04T11:00:00.000Z");
  assert.equal(LEGACY_EVENT.timezone, "Asia/Bangkok");
  assert.deepEqual(FIRST_EVENTS.map(event => event.id), [EVENT.id, LEGACY_EVENT.id]);
  assert.equal(firstEventById("unknown-event"), null); assert(isPreviousFirstEvent(LEGACY_EVENT)); assert(!isPreviousFirstEvent(EVENT));
  assert(!isPreviousFirstEvent({ ...LEGACY_EVENT, contract: EVENT.contract }));
  const html = read("public/first-event/index.html").toString();
  assert(html.includes('data-qr-contract="' + EVENT.contract + '"'));
  assert(html.includes('data-contract-address tabindex="0">' + EVENT.contract + '</code>'));
  assert(html.includes('datetime="2026-11-04T18:00:00+05:30"'));
  assert.equal(new Date("2026-11-04T18:00:00+05:30").toISOString(), EVENT.startsAt);
  assert(html.includes(EVENT.hoursLabel)); assert(html.includes(EVENT.depositClosesLabel));
  assert(html.includes('data-manage-event href="/#event=' + EVENT.id + '&amp;view=participant&amp;deposit=manage"'));
  assert(html.includes('data-legacy-event hidden>Paid the original event?'));
  assert(html.includes('/#event=' + LEGACY_EVENT.id + '&amp;view=participant&amp;deposit=manage'));
});

test("saved QR bytes match the independently decoded chain1 exact native deposit request", () => {
  const proof = JSON.parse(read("artifacts/truth-pays-ist/replacement-qr-proof.json"));
  const actualHash = createHash("sha256").update(read("public/first-event/qr.svg")).digest("hex");
  assert.equal(proof.svgSha256, actualHash); assert.equal(proof.eventId, EVENT.id); assert.equal(proof.contract, EVENT.contract);
  assert.equal(proof.decoder, "macOS Vision VNDetectBarcodesRequest");
  assert.equal(proof.rasterizedFrom, "saved public/first-event/qr.svg via Chromium");
  assert.equal(proof.decodedPayload, `ethereum:${EVENT.contract}@${EVENT.chainId}?value=${EVENT.depositWei}`);
  assert.equal(proof.valueWei, EVENT.depositWei); assert.equal(proof.financialActions, 0); assert.equal(proof.publicNetworkRequests, 0);
});
