import {
  isVerifiedProductionEvent,
  PRODUCTION_CONTRACT_VERSION,
} from "./contract-profiles.js";

const stableId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const address = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-f]{40}$/i.test(value) &&
  !/^0x0{40}$/i.test(value);
const phases = Object.freeze({
  Open: "Open",
  Listed: "Attendance posted",
  Finalized: "Payouts started",
  Cancelled: "Cancelled",
});
function timezone(value) {
  if (typeof value !== "string" || !value || value.length > 100) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}
const hash = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-f]{64}$/i.test(value) &&
  !/^0x0{64}$/i.test(value);
const timestamp = (value) =>
  typeof value === "string" &&
  value.length <= 100 &&
  /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value));
function publicUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}
// This is a display-only recorded-adoption envelope, never a bootstrap or a
// source of current deployment verification, financial phase or permissions.
export function validatePublicCatalog(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.kind !== "public-catalog" ||
    value.mode !== "hosted-production" ||
    typeof value.instanceId !== "string" ||
    !value.instanceId ||
    value.instanceId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value.instanceId) ||
    value.environment?.production !== true ||
    value.environment?.network !== "ethereum-mainnet" ||
    value.environment?.chainId !== 1 ||
    value.chain?.chainId !== 1 ||
    typeof value.chain.name !== "string" ||
    !value.chain.name.trim() ||
    value.chain.nativeCurrency?.name !== "Ether" ||
    value.chain.nativeCurrency?.symbol !== "ETH" ||
    value.chain.nativeCurrency?.decimals !== 18 ||
    !publicUrl(value.chain.rpcUrl) ||
    !timestamp(value.generatedAt) ||
    value.catalog?.metadataOnly !== true ||
    value.catalog?.currentFinancialState !== "not-loaded" ||
    value.catalog?.source !== "recorded-adoption" ||
    !Array.isArray(value.events)
  )
    throw Error(
      "The public event directory returned an unsupported response. Try again for fresh event details.",
    );
  const records = value.events.filter(
    (event) =>
      event?.visibility === "public" && event?.editorialStatus === "published",
  );
  const counts = new Map();
  for (const event of records)
    if (stableId(event.id))
      counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
  const events = records.flatMap((event) => {
    if (
      !stableId(event.id) ||
      counts.get(event.id) !== 1 ||
      event.chainId !== 1 ||
      event.contractVersion !== PRODUCTION_CONTRACT_VERSION ||
      event.abiVersion !== PRODUCTION_CONTRACT_VERSION ||
      !address(event.contract) ||
      typeof event.title !== "string" ||
      !event.title.trim() ||
      event.title.length > 256 ||
      event.adoption?.kind !== "recorded-adoption" ||
      !hash(event.adoption.txHash) ||
      !hash(event.adoption.blockHash) ||
      !Number.isSafeInteger(event.adoption.blockNumber) ||
      event.adoption.blockNumber <= 0
    )
      return [];
    const amount =
      typeof event.depositWei === "string" &&
      /^\d{1,78}$/.test(event.depositWei) &&
      BigInt(event.depositWei) > 0n &&
      BigInt(event.depositWei) < 2n ** 256n
        ? event.depositWei
        : null;
    return [
      Object.freeze({
        id: event.id,
        title: event.title.trim(),
        startsAt: timestamp(event.startsAt) ? event.startsAt : null,
        timezone: timezone(event.timezone),
        depositWei: amount,
        statusLabel: "Check status on open",
      }),
    ];
  });
  return Object.freeze({
    mode: "hosted-production",
    instanceId: value.instanceId,
    generatedAt: value.generatedAt,
    events: Object.freeze(events),
  });
}
// Filter privacy/publication flags before reading titles or building any search index.
// Only immutable display primitives leave this projection; no raw event is retained.
export function publicEventSearchEntries(events) {
  if (!Array.isArray(events)) return Object.freeze([]);
  const publicRecords = events.filter(
    (event) =>
      event?.visibility === "public" && event?.editorialStatus === "published",
  );
  const counts = new Map();
  for (const event of publicRecords)
    if (stableId(event.id))
      counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
  return Object.freeze(
    publicRecords.flatMap((event) => {
      if (
        !stableId(event.id) ||
        counts.get(event.id) !== 1 ||
        !isVerifiedProductionEvent(event) ||
        !address(event.contract) ||
        typeof event.title !== "string" ||
        !event.title.trim() ||
        event.title.length > 256
      )
        return [];
      const date =
        typeof event.startsAt === "string" &&
        event.startsAt.length <= 100 &&
        /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(event.startsAt) &&
        Number.isFinite(Date.parse(event.startsAt))
          ? event.startsAt
          : null;
      const amount =
        typeof event.depositWei === "string" &&
        /^\d{1,78}$/.test(event.depositWei) &&
        BigInt(event.depositWei) > 0n &&
        BigInt(event.depositWei) < 2n ** 256n
          ? event.depositWei
          : null;
      const phase =
        typeof event.financialPhase === "number"
          ? ["Open", "Listed", "Finalized", "Cancelled"][event.financialPhase]
          : event.financialPhase;
      return [
        Object.freeze({
          id: event.id,
          title: event.title.trim(),
          startsAt: date,
          timezone: timezone(event.timezone),
          depositWei: amount,
          statusLabel: Object.hasOwn(phases, phase)
            ? phases[phase]
            : "Status unavailable",
        }),
      ];
    }),
  );
}
function normalized(value) {
  return typeof value === "string"
    ? value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
    : "";
}
export function searchPublicEvents(entries, query) {
  const needle = normalized(
    typeof query === "string" ? query.slice(0, 120) : "",
  );
  return Object.freeze(
    entries.filter((event) => normalized(event.title).includes(needle)),
  );
}
