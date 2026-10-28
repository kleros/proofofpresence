// What the site assistant can look up. Every query runs through the visitor's own Supabase
// session, so row level security decides what it sees: published public events for everyone,
// drafts for the team, private events for their members only. Nothing here writes.
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDur } from "@/lib/format";
import type { Segment, Summary } from "@/lib/transcript/types";

export interface Source { href: string; label: string }

export interface ToolContext {
  sb: SupabaseClient;
  /** today, YYYY-MM-DD */
  today: string;
  /** pages the answer drew on, for the links under it */
  sources: Map<string, Source>;
  /** external addresses from the site's own link fields: the only ones the answer may link to */
  links: Set<string>;
}

type Json = Record<string, unknown>;

const MAX_RESULT_CHARS = 60_000;
const TRANSCRIPT_PAGE_CHARS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

// ---------------------------------------------------------------- definitions

const tool = (name: string, description: string, properties: Json, required: string[]): Anthropic.Beta.BetaTool => ({
  name, description, strict: true, eager_input_streaming: true,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  tool("list_events",
    "List the events on the site that this visitor can see, newest first for past events and soonest first for upcoming ones. Each row has the slug to pass to get_event. Use query to narrow by words in the title, city, country, organiser, type or topics.",
    {
      when: { type: "string", enum: ["upcoming", "past", "all"], description: "upcoming: starting today or later; past: before today" },
      query: { type: ["string", "null"], description: "Optional words to match, for example \"Devcon\", \"Buenos Aires\" or \"AI agents\"" },
    }, ["when", "query"]),
  tool("get_event",
    "Everything the site has on one event: dates, place, Kleros' role, description, recap, agenda, which Kleros team members go, and its materials (talks, recordings, slides, links) with ids and transcript summaries.",
    { slug: { type: "string", description: "The event slug from list_events or search, or from the page the visitor is on" } },
    ["slug"]),
  tool("search",
    "Search the whole site at once: event titles, descriptions and recaps, agenda items, material titles and speakers, and the text of every transcript. Returns matches with links, and for transcripts the matching lines with their times. Use it for questions about a topic or a person, or when you do not know which event something was at.",
    { query: { type: "string", description: "A few distinctive words, for example \"Schelling point\", \"Federico Ast\" or \"escrow demo\"" } },
    ["query"]),
  tool("get_transcript",
    "The transcript of one recording or talk: its summary, then the timestamped lines. Long transcripts come in pages; when the result says it continues, call again with from_seconds set to the time it gives, until the end.",
    {
      material_id: { type: "string", description: "The material id from get_event or search" },
      from_seconds: { type: ["integer", "null"], description: "Where to start reading, in seconds; null for the beginning" },
    }, ["material_id", "from_seconds"]),
  tool("list_team",
    "The Kleros team members listed on the site, with their roles and booking links where they have one.",
    {}, []),
];

// ---------------------------------------------------------------- helpers

const str = (v: unknown) => (typeof v === "string" ? v : "");
const trimTo = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
/** slice without splitting a surrogate pair (a lone half of an emoji makes the API reject the request) */
export const cutAt = (s: string, n: number) => {
  let i = Math.max(0, Math.min(n, s.length));
  if (i > 0 && i < s.length && /[\uD800-\uDBFF]/.test(s[i - 1])) i--;
  return s.slice(0, i);
};

function placeOf(e: { venue?: string | null; city?: string | null; country?: string | null; region?: string | null }) {
  return [e.venue, e.city, e.country].filter(Boolean).join(", ") || (e.region === "Online" ? "Online" : e.region ?? "");
}

function dates(e: { starts_on: string; ends_on?: string | null; start_time?: string | null; timezone?: string | null }) {
  const d = e.ends_on && e.ends_on !== e.starts_on ? `${e.starts_on} to ${e.ends_on}` : e.starts_on;
  return e.start_time ? `${d}, ${e.start_time.slice(0, 5)}${e.timezone ? ` (${e.timezone})` : ""}` : d;
}

function flags(e: { status?: string; visibility?: string }) {
  return [e.visibility === "private" ? "private (only its members can see it)" : "", e.status === "draft" ? "draft (team only, not published)" : ""].filter(Boolean);
}

const ROLE: Record<string, string> = {
  host: "Kleros hosts it", co_host: "Kleros co-hosts it", speaking: "Kleros speaks there", sponsor: "Kleros sponsors it",
  booth: "Kleros has a booth", judging: "Kleros judges there", attending: "Kleros attends",
};

/** Words worth searching for: letters and digits only, so they are safe inside a PostgREST filter. */
const STOP = new Set("the and for with that this what when where which who whom whose about from into over under than then them they their there were was are is be been being have has had does did do not but you your our out all any can could would should will just more most some such only own same very how why its it's of to in on at by an a or as if".split(" "));
export function searchTerms(q: string): string[] {
  const words = q.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [];
  const out: string[] = [];
  for (const w of words) {
    const t = w.replace(/^-+|-+$/g, "");
    if (t.length < 2 || STOP.has(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length === 6) break;
  }
  return out;
}

const orIlike = (cols: string[], terms: string[]) => cols.flatMap((c) => terms.map((t) => `${c}.ilike.*${t}*`)).join(",");
const hits = (text: string, terms: string[]) => { const l = text.toLowerCase(); return terms.filter((t) => l.includes(t)).length; };

// Fields that hold an address the team set (event page, slides, material link, booking link).
// Addresses inside descriptions or transcripts are not collected: anyone can put words there.
const LINK_KEYS = new Set(["event_link", "link", "slides_link", "book_a_meeting"]);
function collectLinks(v: unknown, into: Set<string>) {
  if (Array.isArray(v)) { for (const x of v) collectLinks(x, into); return; }
  if (!v || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v)) {
    if (LINK_KEYS.has(k) && typeof x === "string") { if (/^https?:\/\//.test(x)) into.add(x); }
    else collectLinks(x, into);
  }
}

function remember(ctx: ToolContext, href: string, label: string) {
  if (!ctx.sources.has(href)) ctx.sources.set(href, { href, label });
}

/** Where a material can be opened on the site, if it has a page of its own. */
function pageOf(m: { id: string; kind: string; file_path: string | null }) {
  return m.kind === "talk" || m.kind === "video" || ((m.kind === "audio" || m.kind === "slides") && m.file_path) ? `/talks/${m.id}` : null;
}

// ---------------------------------------------------------------- tools

type EventLite = {
  id: string; slug: string; title: string; kleros_role: string; organizer: string | null; event_type: string;
  starts_on: string; ends_on: string | null; start_time: string | null; timezone: string | null;
  city: string | null; country: string | null; region: string | null; venue: string | null; topics: string[] | null;
  status: string; visibility: string; recap: string | null;
};

async function listEvents(ctx: ToolContext, input: { when: string; query: string | null }) {
  const { data, error } = await ctx.sb.from("events")
    .select("id, slug, title, kleros_role, organizer, event_type, starts_on, ends_on, start_time, timezone, city, country, region, venue, topics, status, visibility, recap")
    .eq("is_example", false).order("starts_on", { ascending: true }).limit(500);
  if (error) throw new Error(`The events could not be read: ${error.message}`);
  let rows = (data ?? []) as EventLite[];
  if (input.when === "upcoming") rows = rows.filter((e) => (e.ends_on ?? e.starts_on) >= ctx.today);
  if (input.when === "past") rows = rows.filter((e) => (e.ends_on ?? e.starts_on) < ctx.today).reverse();
  const terms = input.query ? searchTerms(input.query) : [];
  if (terms.length) {
    const scored = rows.map((e) => ({ e, n: hits([e.title, e.city, e.country, e.region, e.venue, e.organizer, e.event_type, ...(e.topics ?? [])].join(" "), terms) }));
    rows = scored.filter((x) => x.n > 0).sort((a, b) => b.n - a.n).map((x) => x.e);
  }
  const total = rows.length;
  return {
    today: ctx.today,
    count: total,
    events: rows.slice(0, 80).map((e) => ({
      slug: e.slug, title: e.title, dates: dates(e), place: placeOf(e), kleros: ROLE[e.kleros_role] ?? e.kleros_role,
      organiser: e.organizer, type: e.event_type, topics: e.topics?.length ? e.topics : undefined,
      has_recap: !!e.recap?.trim() || undefined, notes: flags(e).length ? flags(e) : undefined,
    })),
    ...(total > 80 ? { note: `Showing 80 of ${total}. Narrow with query.` } : {}),
  };
}

type MaterialRow = {
  id: string; kind: string; title: string; speaker: string | null; url: string | null; file_path: string | null;
  pdf_path: string | null; audio_path: string | null; pages: number | null; duration_seconds: number | null; created_at: string;
};

async function getEvent(ctx: ToolContext, input: { slug: string }) {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG.test(slug)) return { error: "That is not a valid event slug. Use list_events or search to find it." };
  const { data: e } = await ctx.sb.from("events").select("*").eq("slug", slug).maybeSingle();
  if (!e) return { error: `No event with the slug "${slug}" that this visitor can see. It may not exist, or it may be private or unpublished.` };
  const [agenda, team, links] = await Promise.all([
    ctx.sb.from("agenda_items").select("starts_at, title, speaker, is_kleros").eq("event_id", e.id).order("starts_at"),
    ctx.sb.from("event_team").select("part, team_members(name, title)").eq("event_id", e.id),
    ctx.sb.from("material_events").select("materials(id, kind, title, speaker, url, file_path, pdf_path, audio_path, pages, duration_seconds, created_at)").eq("event_id", e.id),
  ]);
  const materials = ((links.data ?? []) as unknown as { materials: MaterialRow | null }[])
    .map((r) => r.materials).filter((m): m is MaterialRow => !!m)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ids = materials.map((m) => m.id);
  const tx = ids.length
    ? ((await ctx.sb.from("transcripts").select("material_id, status, tldr:summary->>tldr, first:segments->0").in("material_id", ids)).data ?? []) as { material_id: string; status: string; tldr: string | null; first: unknown }[]
    : [];
  const txBy = Object.fromEntries(tx.map((t) => [t.material_id, t]));
  remember(ctx, `/events/${e.slug}`, e.title);
  return {
    slug: e.slug, title: e.title, page: `/events/${e.slug}`, dates: dates(e), place: placeOf(e),
    kleros: ROLE[e.kleros_role] ?? e.kleros_role, organiser: e.organizer, type: e.event_type,
    event_link: e.url, topics: e.topics, notes: flags(e).length ? flags(e) : undefined,
    description: e.description ? trimTo(e.description, 6000) : null,
    recap: e.recap ? trimTo(e.recap, 6000) : null,
    agenda: ((agenda.data ?? []) as { starts_at: string | null; title: string; speaker: string | null; is_kleros: boolean }[])
      .map((a) => ({ time: a.starts_at?.slice(0, 5) ?? null, title: a.title, speaker: a.speaker, kleros_session: a.is_kleros || undefined })),
    kleros_team: ((team.data ?? []) as unknown as { part: string | null; team_members: { name: string; title: string | null } | null }[])
      .filter((t) => t.team_members).map((t) => ({ name: t.team_members!.name, role: t.team_members!.title, part: t.part })),
    materials: materials.map((m) => {
      const t = txBy[m.id];
      const recording = m.kind === "talk" || m.kind === "video" || (m.kind === "audio" && !!m.file_path);
      return {
        material_id: m.id, kind: m.kind === "audio" ? "audio recording" : m.kind === "talk" ? "talk (slides synced with audio)" : m.kind,
        title: m.title, speaker: m.speaker, page: pageOf(m),
        // a recording's url is its slides link; other kinds keep theirs as the link itself
        link: m.url && /^https?:\/\//.test(m.url) ? m.url : null,
        link_is_slides: m.kind === "audio" && !!m.url || undefined,
        length: m.duration_seconds ? fmtDur(m.duration_seconds) : undefined, slides: m.pages ?? undefined,
        transcript: recording ? (t?.first != null ? (t.tldr ? `yes, summary: ${trimTo(t.tldr, 600)}` : "yes, no summary yet") : t && t.status !== "none" ? `not ready (${t.status})` : "none yet") : undefined,
      };
    }),
  };
}

async function search(ctx: ToolContext, input: { query: string }) {
  const terms = searchTerms(input.query);
  if (!terms.length) return { error: "Give a few distinctive words to search for." };
  const [ev, ag, mat, txRows] = await Promise.all([
    ctx.sb.from("events").select("slug, title, starts_on, ends_on, city, country, organizer, description, recap, status, visibility")
      .eq("is_example", false).or(orIlike(["title", "description", "recap", "organizer", "city", "country", "venue"], terms)).limit(60),
    ctx.sb.from("agenda_items").select("title, speaker, starts_at, events(slug, title, starts_on)")
      .or(orIlike(["title", "speaker"], terms)).limit(60),
    ctx.sb.from("materials").select("id, kind, title, speaker, url, file_path, events!materials_event_id_fkey(slug, title, starts_on)")
      .or(orIlike(["title", "speaker"], terms)).limit(60),
    searchTranscripts(ctx, terms),
  ]);
  if (ev.error && mat.error) throw new Error(`Search failed: ${ev.error.message}`);

  type EvHit = { slug: string; title: string; starts_on: string; ends_on: string | null; city: string | null; country: string | null; organizer: string | null; description: string | null; recap: string | null; status: string; visibility: string };
  const events = ((ev.data ?? []) as EvHit[])
    .map((e) => ({ e, n: hits([e.title, e.organizer, e.city, e.country, e.description, e.recap].join(" "), terms) }))
    .sort((a, b) => b.n - a.n).slice(0, 12)
    .map(({ e }) => ({ slug: e.slug, title: e.title, dates: dates(e), place: placeOf(e), page: `/events/${e.slug}`, notes: flags(e).length ? flags(e) : undefined, snippet: snippet([e.description, e.recap].filter(Boolean).join(" \n"), terms) }));

  type AgHit = { title: string; speaker: string | null; starts_at: string | null; events: { slug: string; title: string; starts_on: string } | null };
  const agenda = ((ag.data ?? []) as unknown as AgHit[]).filter((a) => a.events)
    .map((a) => ({ a, n: hits(`${a.title} ${a.speaker ?? ""}`, terms) })).sort((x, y) => y.n - x.n).slice(0, 12)
    .map(({ a }) => ({ title: a.title, speaker: a.speaker, time: a.starts_at?.slice(0, 5) ?? null, event: a.events!.title, event_slug: a.events!.slug, date: a.events!.starts_on }));

  type MatHit = { id: string; kind: string; title: string; speaker: string | null; url: string | null; file_path: string | null; events: { slug: string; title: string; starts_on: string } | null };
  const materials = ((mat.data ?? []) as unknown as MatHit[])
    .map((m) => ({ m, n: hits(`${m.title} ${m.speaker ?? ""}`, terms) })).sort((a, b) => b.n - a.n).slice(0, 15)
    .map(({ m }) => ({ material_id: m.id, kind: m.kind, title: m.title, speaker: m.speaker, page: pageOf(m), link: m.url && /^https?:\/\//.test(m.url) ? m.url : null, event: m.events?.title ?? null, event_slug: m.events?.slug ?? null }));

  // transcript lines that match, with their times; the material rows say which talk they are
  const txMeta = txRows?.length
    ? (((await ctx.sb.from("materials").select("id, title, speaker, kind, file_path, events!materials_event_id_fkey(slug, title)").in("id", txRows.map((t) => t.material_id))).data ?? []) as unknown as { id: string; title: string; speaker: string | null; kind: string; file_path: string | null; events: { slug: string; title: string } | null }[])
    : [];
  const metaBy = Object.fromEntries(txMeta.map((m) => [m.id, m]));
  const transcripts = (txRows ?? []).filter((t) => metaBy[t.material_id]).map((t) => {
    const m = metaBy[t.material_id];
    return {
      material_id: t.material_id, title: m.title, speaker: m.speaker, event: m.events?.title ?? null, event_slug: m.events?.slug ?? null,
      page: `/talks/${t.material_id}`, tldr: t.tldr ? trimTo(t.tldr, 400) : undefined,
      score: t.score,
      lines: t.lines.map((x) => ({ at: fmtDur(x.start), seconds: Math.floor(x.start), text: trimTo(x.text, 300) })),
    };
  }).sort((a, b) => b.score - a.score).slice(0, 8).map(({ score: _score, ...rest }) => rest);

  // a part that could not be searched must not read as "nothing found"
  const failed = [ev.error && "events", ag.error && "agenda", mat.error && "materials", !txRows && "transcripts"].filter(Boolean);
  const not_searched = failed.length
    ? `The search could not check ${failed.join(", ")} this time. Do not say the site has nothing on this; say that part could not be searched, or look in a likely event or recording directly.`
    : undefined;
  return { terms, events, agenda, materials, transcripts, not_searched };
}

type TxHit = { material_id: string; tldr: string | null; score: number; lines: { start: number; text: string }[] };

/**
 * Transcripts that mention the terms, with their best matching lines. The database does the
 * matching (ask_search_transcripts, migration 0013) so only those lines travel; until that is
 * set up, the rows come back whole and are matched here.
 */
async function searchTranscripts(ctx: ToolContext, terms: string[]): Promise<TxHit[] | null> {
  const rpc = await ctx.sb.rpc("ask_search_transcripts", { p_terms: terms });
  if (!rpc.error) return ((rpc.data ?? []) as TxHit[]).map((t) => ({ ...t, lines: (t.lines ?? []).filter((l) => typeof l.start === "number" && typeof l.text === "string") }));
  // only a missing function means "not set up yet"; after a timeout or other failure, downloading
  // whole transcripts would cost more than the search is worth (null: not searched)
  if (rpc.error.code !== "PGRST202" && rpc.error.code !== "42883") return null;

  // rank by the terms each transcript contains (rarer terms count more), then fetch the best few
  const found = await Promise.all(terms.map((t) => ctx.sb.from("transcripts").select("material_id").ilike("text", `%${t}%`).limit(500)));
  if (found.some((r) => r.error)) return null;
  const weight = new Map<string, number>();
  found.forEach((r) => { const ids = (r.data ?? []) as { material_id: string }[]; for (const { material_id } of ids) weight.set(material_id, (weight.get(material_id) ?? 0) + 1 / ids.length); });
  // the best 12 and any tied with the 12th (at most 24), so the number of matching lines breaks ties
  const ranked = [...weight].map(([id, w]) => [id, Math.round(1000 * w)] as const).sort((a, b) => b[1] - a[1]);
  const top = ranked.filter(([, w], i) => i < 12 || (ranked.length > 11 && w === ranked[11][1])).slice(0, 24).map(([id]) => id);
  if (!top.length) return [];
  const { data, error } = await ctx.sb.from("transcripts").select("material_id, segments, tldr:summary->>tldr").in("material_id", top);
  if (error) return null;
  const rows = (data ?? []) as unknown as { material_id: string; segments: Segment[] | null; tldr: string | null }[];
  return rows.map((t) => {
    const lines = (t.segments ?? []).map((s) => ({ s, has: terms.filter((x) => s.text.toLowerCase().includes(x)) })).filter((x) => x.has.length);
    // the first line for each term, then the lines with most terms, then the earliest
    const firsts = new Set(terms.map((x) => lines.find((l) => l.has.includes(x))).filter(Boolean));
    const best = [...lines].sort((a, b) => Number(firsts.has(b)) - Number(firsts.has(a)) || b.has.length - a.has.length || a.s.start - b.s.start)
      .slice(0, 6).sort((a, b) => a.s.start - b.s.start);
    return { material_id: t.material_id, tldr: t.tldr, score: Math.round(1000 * (weight.get(t.material_id) ?? 0)), n: lines.length, lines: best.map((x) => ({ start: x.s.start, text: x.s.text })) };
  }).filter((t) => t.lines.length)
    // best first, as the database search orders them: score, then how many lines match
    .sort((a, b) => b.score - a.score || b.n - a.n).map(({ n: _n, ...t }) => t);
}

function snippet(text: string, terms: string[]) {
  if (!text) return undefined;
  const l = text.toLowerCase();
  const at = terms.map((t) => l.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return trimTo(text, 240);
  const from = Math.max(0, at - 120);
  return (from ? "…" : "") + trimTo(text.slice(from, at + 200), 320);
}

async function getTranscript(ctx: ToolContext, input: { material_id: string; from_seconds: number | null }) {
  const id = input.material_id.trim();
  if (!UUID.test(id)) return { error: "That is not a valid material id. Use get_event or search to find it." };
  const { data: m } = await ctx.sb.from("materials")
    .select("id, kind, title, speaker, url, file_path, duration_seconds, events!materials_event_id_fkey(slug, title, starts_on)").eq("id", id).maybeSingle();
  if (!m) return { error: "No recording with that id that this visitor can see." };
  const mat = m as unknown as { id: string; kind: string; title: string; speaker: string | null; url: string | null; file_path: string | null; duration_seconds: number | null; events: { slug: string; title: string; starts_on: string } | null };
  const { data: t } = await ctx.sb.from("transcripts").select("status, segments, summary, provider, language").eq("material_id", id).maybeSingle();
  const row = t as { status: string; segments: Segment[] | null; summary: Summary | null; provider: string | null; language: string | null } | null;
  const segs = row?.segments ?? [];
  remember(ctx, `/talks/${id}`, mat.title);
  const head = {
    material_id: id, title: mat.title, speaker: mat.speaker, page: `/talks/${id}`,
    event: mat.events ? { title: mat.events.title, slug: mat.events.slug, date: mat.events.starts_on } : null,
    length: mat.duration_seconds ? fmtDur(mat.duration_seconds) : null,
    slides_link: mat.kind === "audio" && mat.url && /^https?:\/\//.test(mat.url) ? mat.url : undefined,
  };
  if (!segs.length) return { ...head, transcript: row ? `No transcript text yet (status: ${row.status}).` : "This recording has no transcript on the site yet." };

  const from = Math.max(0, input.from_seconds ?? 0);
  const startIdx = Math.max(0, segs.findIndex((s) => s.end > from));
  let text = "";
  let i = startIdx;
  for (; i < segs.length; i++) {
    const line = `[${fmtDur(segs[i].start)}] ${segs[i].text.trim()}\n`;
    if (text.length + line.length > TRANSCRIPT_PAGE_CHARS && text) break;
    text += line;
  }
  const s = row?.summary;
  return {
    ...head,
    language: row?.language ?? undefined,
    // uploaded plain text has estimated times
    times_are_estimates: row?.provider?.includes("untimed") || undefined,
    summary: from === 0 && s ? { tldr: s.tldr, key_points: s.key_points, chapters: s.chapters?.map((c) => `${fmtDur(c.t)} ${c.title}`) } : undefined,
    lines_from: fmtDur(segs[startIdx]?.start ?? 0),
    transcript: text,
    ...(i < segs.length
      ? { continues: `More follows. Call get_transcript again with from_seconds ${Math.floor(segs[i].start)}.` }
      : { end: "This is the end of the transcript." }),
  };
}

async function listTeam(ctx: ToolContext) {
  const { data, error } = await ctx.sb.from("team_members").select("name, title, x_handle, calendar_url").eq("active", true).order("sort");
  if (error) throw new Error(`The team list could not be read: ${error.message}`);
  return { team: (data ?? []).map((t) => ({ name: t.name, role: t.title, x: t.x_handle ? `@${String(t.x_handle).replace(/^@/, "")}` : undefined, book_a_meeting: t.calendar_url ?? undefined })) };
}

// ---------------------------------------------------------------- dispatch

/** Input checks: with eager input streaming the API does not validate tool input, so this does. */
function parse(name: string, raw: unknown): Json | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "The tool input must be a JSON object.";
  const i = raw as Json;
  const nullableStr = (k: string) => i[k] === undefined || i[k] === null || typeof i[k] === "string";
  switch (name) {
    case "list_events":
      if (!["upcoming", "past", "all"].includes(str(i.when))) return "when must be upcoming, past or all.";
      if (!nullableStr("query")) return "query must be a string or null.";
      return { when: i.when, query: i.query ? str(i.query).slice(0, 200) : null };
    case "get_event":
      if (!str(i.slug)) return "slug is required.";
      return { slug: str(i.slug).slice(0, 220) };
    case "search":
      if (!str(i.query).trim()) return "query is required.";
      return { query: str(i.query).slice(0, 300) };
    case "get_transcript": {
      if (!str(i.material_id)) return "material_id is required.";
      const f = i.from_seconds;
      if (!(f === undefined || f === null || (typeof f === "number" && Number.isFinite(f)))) return "from_seconds must be a number of seconds or null.";
      return { material_id: str(i.material_id), from_seconds: typeof f === "number" ? Math.floor(f) : null };
    }
    case "list_team":
      return {};
    default:
      return `There is no tool called ${name}.`;
  }
}

export const STATUS: Record<string, string> = {
  list_events: "Looking through the events",
  get_event: "Opening the event",
  search: "Searching the site",
  get_transcript: "Reading the transcript",
  list_team: "Checking the team list",
};

/** Runs one tool call and returns the text for its tool_result (JSON), and whether it failed. */
export async function runTool(ctx: ToolContext, name: string, raw: unknown): Promise<{ content: string; isError: boolean }> {
  const input = parse(name, raw);
  if (typeof input === "string") return { content: input, isError: true };
  try {
    const out = name === "list_events" ? await listEvents(ctx, input as { when: string; query: string | null })
      : name === "get_event" ? await getEvent(ctx, input as { slug: string })
      : name === "search" ? await search(ctx, input as { query: string })
      : name === "get_transcript" ? await getTranscript(ctx, input as { material_id: string; from_seconds: number | null })
      : await listTeam(ctx);
    const text = JSON.stringify(out);
    collectLinks(out, ctx.links);
    const isError = typeof out === "object" && out !== null && "error" in out;
    return { content: text.length > MAX_RESULT_CHARS ? cutAt(text, MAX_RESULT_CHARS) + "…(cut off)" : text, isError };
  } catch (e) {
    return { content: (e as Error).message || "The lookup failed.", isError: true };
  }
}
