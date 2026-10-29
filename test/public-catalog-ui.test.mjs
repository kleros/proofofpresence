import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePublicCatalog,
  searchPublicEvents,
} from "../public/event-search.js";
import { PRODUCTION_CONTRACT_VERSION } from "../public/contract-profiles.js";

// Synthetic display metadata only. These fixtures prove neither live provenance
// nor current chain state, and are never loaded by production code.
function fixture() {
  return {
    schemaVersion: 1,
    kind: "public-catalog",
    mode: "hosted-production",
    instanceId: "synthetic-catalog-runtime",
    environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
    chain: {
      chainId: 1,
      name: "Ethereum",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrl: "https://example.test/public-rpc",
    },
    generatedAt: "2026-10-29T12:00:00.000Z",
    catalog: {
      metadataOnly: true,
      currentFinancialState: "not-loaded",
      source: "recorded-adoption",
    },
    events: [
      {
        id: "synthetic-public-event",
        title: "Café community",
        startsAt: "2026-11-01T12:00:00Z",
        endsAt: "2026-11-01T14:00:00Z",
        timezone: "Asia/Bangkok",
        depositWei: "10000000000000000",
        chainId: 1,
        contract: "0x1111111111111111111111111111111111111111",
        contractVersion: PRODUCTION_CONTRACT_VERSION,
        abiVersion: PRODUCTION_CONTRACT_VERSION,
        visibility: "public",
        editorialStatus: "published",
        adoption: {
          kind: "recorded-adoption",
          txHash: "0x" + "2".repeat(64),
          blockNumber: 100,
          blockHash: "0x" + "3".repeat(64),
        },
      },
    ],
  };
}

test("Recorded catalog projects only frozen display primitives, even when mutable authority is grafted on", () => {
  const dto = fixture();
  Object.assign(dto, {
    session: { wallet: "secret-wallet" },
    factory: { verified: true },
    capabilities: { financial: true },
  });
  Object.assign(dto.events[0], {
    role: "owner",
    owner: "secret-owner",
    email: "secret@example.test",
    financialPhase: "Finalized",
    profile: { verified: true },
    balanceWei: "99",
  });
  const projected = validatePublicCatalog(dto);
  assert.deepEqual(Object.keys(projected).sort(), [
    "events",
    "generatedAt",
    "instanceId",
    "mode",
  ]);
  assert.deepEqual(Object.keys(projected.events[0]).sort(), [
    "depositWei",
    "id",
    "startsAt",
    "statusLabel",
    "timezone",
    "title",
  ]);
  assert.equal(projected.events[0].statusLabel, "Check status on open");
  assert(!JSON.stringify(projected).includes("secret"));
  assert(
    Object.isFrozen(projected) &&
      Object.isFrozen(projected.events) &&
      Object.isFrozen(projected.events[0]),
  );
});

test("Wrong environment, unsupported envelope or readiness claims fail instead of becoming an empty trusted directory", () => {
  for (const alter of [
    (d) => {
      d.schemaVersion = 2;
    },
    (d) => {
      d.kind = "bootstrap";
    },
    (d) => {
      d.mode = "hosted-testnet";
    },
    (d) => {
      d.instanceId = "";
    },
    (d) => {
      d.environment.production = false;
    },
    (d) => {
      d.environment.network = "chiado";
    },
    (d) => {
      d.environment.chainId = 10200;
    },
    (d) => {
      d.chain.chainId = 10200;
    },
    (d) => {
      d.chain.nativeCurrency.symbol = "XDAI";
    },
    (d) => {
      d.chain.nativeCurrency.decimals = 6;
    },
    (d) => {
      d.chain.rpcUrl = "https://username:password@example.test/rpc";
    },
    (d) => {
      d.generatedAt = "yesterday";
    },
    (d) => {
      d.catalog.metadataOnly = false;
    },
    (d) => {
      d.catalog.currentFinancialState = "verified";
    },
    (d) => {
      d.catalog.source = "current-chain";
    },
    (d) => {
      d.events = {};
    },
  ]) {
    const dto = fixture();
    alter(dto);
    assert.throws(() => validatePublicCatalog(dto), /unsupported response/);
  }
});

test("Private, draft and missing-visibility records are removed before reading titles or indexing", () => {
  const dto = fixture();
  for (const flags of [
    { visibility: "private", editorialStatus: "published" },
    { visibility: "public", editorialStatus: "draft" },
    { editorialStatus: "published" },
  ])
    dto.events.push({
      ...flags,
      get title() {
        throw Error("private title read");
      },
    });
  const entries = validatePublicCatalog(dto).events;
  assert.equal(entries.length, 1);
  assert.equal(searchPublicEvents(entries, "private").length, 0);
});

test("Unsupported identities and incomplete adoption records never become event links", () => {
  for (const alter of [
    (e) => {
      e.id = "../foreign";
    },
    (e) => {
      e.chainId = 10200;
    },
    (e) => {
      e.contractVersion = "truth-pays-v7";
    },
    (e) => {
      e.abiVersion = "unknown";
    },
    (e) => {
      e.contract = "0x" + "0".repeat(40);
    },
    (e) => {
      e.title = "";
    },
    (e) => {
      delete e.adoption;
    },
    (e) => {
      e.adoption.kind = "unverified";
    },
    (e) => {
      e.adoption.txHash = "0x" + "0".repeat(64);
    },
    (e) => {
      e.adoption.blockHash = "not-a-hash";
    },
    (e) => {
      e.adoption.blockNumber = -1;
    },
    (e) => {
      e.adoption.blockNumber = "100";
    },
  ]) {
    const dto = fixture();
    alter(dto.events[0]);
    assert.deepEqual(validatePublicCatalog(dto).events, []);
  }
  const dto = fixture();
  dto.events.push(structuredClone(dto.events[0]));
  assert.deepEqual(validatePublicCatalog(dto).events, []);
});

test("Unknown display values remain unavailable and mutable phase never promises payout or deposit readiness", () => {
  for (const depositWei of ["0", "-1", "no-value", String(2n ** 256n)]) {
    const dto = fixture();
    Object.assign(dto.events[0], {
      depositWei,
      startsAt: "invalid",
      timezone: "invalid/zone",
      financialPhase: "Open",
      depositEligible: true,
    });
    const [entry] = validatePublicCatalog(dto).events;
    assert.equal(entry.depositWei, null);
    assert.equal(entry.startsAt, null);
    assert.equal(entry.timezone, null);
    assert.equal(entry.statusLabel, "Check status on open");
  }
});

test("Empty catalogs remain honest, local title filtering is bounded, and the original DTO is unchanged", () => {
  const dto = fixture(),
    before = JSON.stringify(dto);
  const entries = validatePublicCatalog(dto).events;
  assert.equal(searchPublicEvents(entries, "  CAFE  ").length, 1);
  assert.equal(searchPublicEvents(entries, "Asia/Bangkok").length, 0);
  assert.deepEqual(searchPublicEvents(entries, "[.*"), []);
  assert.equal(JSON.stringify(dto), before);
  dto.events = [];
  assert.deepEqual(validatePublicCatalog(dto).events, []);
});
