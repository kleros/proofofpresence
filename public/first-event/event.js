// Fixed public identity; live eligibility and transaction terms remain authoritative server facts.
export const LEGACY_EVENT = Object.freeze({
  id: "event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5",
  title: "Truth Pays: Queryable Data, Prediction Markets & Onchain Justice",
  lumaUrl: "https://luma.com/qewnqhas",
  chainId: 1,
  contract: "0xCd7418413fBFA814D41799C9dFaCc4654f295c11",
  abiVersion: "kleros-event-v10-uups",
  depositWei: "10000000000000000",
  mode: "hosted-production",
  startsAt: "2026-11-04T11:00:00.000Z",
  endsAt: "2026-11-04T15:00:00.000Z",
  timezone: "Asia/Bangkok",
  dateLabel: "4 November 2026",
  hoursLabel: "18:00–22:00 Bangkok",
  depositClosesLabel: "4 November 2026, 18:00 Bangkok",
});
// Set only after the replacement's exact canonical creation record is verified.
// Never select a contract from a query parameter or a remotely supplied flag.
export const PROMOTED_EVENT = Object.freeze({
  ...LEGACY_EVENT,
  id: "event-3aac5a07-5074-4241-9246-2798d4111039",
  contract: "0xc069A460c5B1c577791Ee61E7F9ADcb7866068df",
  startsAt: "2026-11-04T12:30:00.000Z",
  endsAt: "2026-11-04T16:30:00.000Z",
  timezone: "Asia/Kolkata",
  hoursLabel: "18:00–22:00 India (IST)",
  depositClosesLabel: "4 November 2026, 18:00 India (IST)",
  adoption: Object.freeze({
    kind: "recorded-adoption",
    txHash: "0x79a20177c15ae2201fb6f8731f0ef17e719298fc60df2abdb1a3e61c8bd0cd2f",
    blockNumber: 26305185,
    blockHash: "0x3f52e49429d21e97448988ef13ac9ccbbdd8deaed93eb4b720049a1a26b9cd0c",
  }),
});
export const EVENT = PROMOTED_EVENT ?? LEGACY_EVENT;
export const FIRST_EVENTS = Object.freeze(EVENT.id === LEGACY_EVENT.id ? [EVENT] : [EVENT, LEGACY_EVENT]);
export const firstEventById = id => FIRST_EVENTS.find(event => event.id === id) ?? null;
export const isPreviousFirstEvent = event => EVENT.id !== LEGACY_EVENT.id && event?.id === LEGACY_EVENT.id &&
  typeof event.contract === "string" && event.contract.toLowerCase() === LEGACY_EVENT.contract.toLowerCase();
export const firstEventDepositorsPath = (event = EVENT) => event.id === EVENT.id
  ? "/api/first-event/depositors"
  : "/api/first-event/depositors?" + new URLSearchParams({ eventId: event.id });
export const firstEventRecoveryPath = (event = EVENT) => "/#" + new URLSearchParams({ event: event.id, view: "participant", deposit: "manage" });
