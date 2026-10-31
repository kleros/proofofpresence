// Event wall clocks are interpreted in the selected IANA zone, independently
// of the browser zone. Ambiguous repeated hours require an explicit new choice.
const formatters = new Map();
const fail = (message, code) => { throw Object.assign(Error(message), { code }); };
export function validateEventTimeZone(value) {
  const zone = typeof value === "string" ? value.trim() : "";
  if (!zone || zone.length > 100 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(zone))
    fail("Choose a valid IANA event timezone, such as Asia/Bangkok or UTC.", "EVENT_TIMEZONE_INVALID");
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(0); }
  catch { fail("Choose a valid IANA event timezone, such as Asia/Bangkok or UTC.", "EVENT_TIMEZONE_INVALID"); }
  return zone;
}
function formatter(zone) {
  if (!formatters.has(zone)) {
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value);
    formatters.set(zone, new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }));
  }
  return formatters.get(zone);
}
function parts(instant, zone) {
  return Object.fromEntries(formatter(zone).formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}
function utc(parts) {
  const date = new Date(0);
  date.setUTCFullYear(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  date.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second ?? 0), 0);
  return date.valueOf();
}
const wall = parts => `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
function parseWall(value) {
  const match = typeof value === "string" && /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(value);
  if (!match || Number(match[1]) < 1) fail("Choose a valid event date and time.", "EVENT_TIME_INVALID");
  const [, year, month, day, hour, minute] = match, wanted = { year, month, day, hour, minute };
  const milliseconds = utc(wanted), date = new Date(milliseconds);
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day) ||
      date.getUTCHours() !== Number(hour) || date.getUTCMinutes() !== Number(minute))
    fail("Choose a valid event date and time.", "EVENT_TIME_INVALID");
  return { milliseconds, wanted };
}
export function eventTimeToUtc(value, timeZone) {
  const zone = validateEventTimeZone(timeZone), { milliseconds } = parseWall(value), offsets = new Set();
  // Inspect both sides of nearby transitions, including non-hour offsets and
  // date-line changes. Matching the resulting wall clock rejects gaps and folds.
  for (let hours = -48; hours <= 48; hours += 3) {
    const sampled = milliseconds + hours * 3600000;
    offsets.add(utc(parts(sampled, zone)) - sampled);
  }
  const matches = [...offsets].map(offset => milliseconds - offset).filter(candidate => {
    const rendered = parts(candidate, zone);
    return wall(rendered) === value && rendered.second === "00";
  });
  if (!matches.length) fail("That event time does not exist because the clocks change. Choose another time or UTC.", "EVENT_TIME_GAP");
  if (matches.length !== 1) fail("That event time occurs twice because the clocks change. Choose UTC or another unambiguous time.", "EVENT_TIME_AMBIGUOUS");
  return new Date(matches[0]).toISOString();
}
export function eventTimeFromUtc(value, timeZone) {
  const zone = validateEventTimeZone(timeZone), date = new Date(value);
  if (!Number.isFinite(date.valueOf())) fail("Choose a valid event instant.", "EVENT_TIME_INVALID");
  return wall(parts(date, zone));
}
export function formatEventTime(value, timeZone) {
  const zone = validateEventTimeZone(timeZone);
  return `${eventTimeFromUtc(value, zone).replace("T", " ")} ${zone}`;
}
export function eventTimeZones(defaultZone = "UTC") {
  let supported = [];
  try { supported = Intl.supportedValuesOf?.("timeZone") ?? []; } catch { /* Common zones remain available. */ }
  return [...new Set(["UTC", validateEventTimeZone(defaultZone), "Asia/Bangkok", "Asia/Kolkata", "Asia/Kathmandu", "America/New_York", ...supported])].sort();
}
