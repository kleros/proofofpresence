import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer, supabaseConfigured } from "./supabase/server";
import type { AgendaItem, EventRow, EventTeamRow, Material } from "./types";

/**
 * Published public events, for the public listings (home, /events, /talks, /me). RLS lets the
 * team read drafts and members read private events too, so filter here; the desk (/admin) runs
 * its own query that includes them, and getEvent opens a draft's or private event's page
 * directly for those who may see it.
 */
export async function listEvents(): Promise<EventRow[]> {
  if (!supabaseConfigured) return [];
  const sb = await supabaseServer();
  const { data } = await sb.from("events").select("*").eq("status", "published").eq("visibility", "public").order("starts_on", { ascending: true });
  return (data ?? []) as EventRow[];
}

type Link = { material_id: string; event_id: string };

/**
 * Every material-to-event link the caller can see (0006 material_events), or null when the
 * table is not there yet, in which case callers fall back to materials.event_id.
 */
export async function listLinks(sb: SupabaseClient): Promise<Link[] | null> {
  const { data, error } = await sb.from("material_events").select("material_id, event_id").order("created_at");
  return error ? null : ((data ?? []) as Link[]);
}

/** Fills event_ids on each material: its links, primary event first. */
export function withEventIds<T extends Material>(materials: T[], links: Link[] | null): T[] {
  const by: Record<string, string[]> = {};
  if (links) for (const l of links) (by[l.material_id] ??= []).push(l.event_id);
  return materials.map((m) => {
    const ids = links ? by[m.id] ?? [] : m.event_id ? [m.event_id] : [];
    const ordered = m.event_id && ids.includes(m.event_id) ? [m.event_id, ...ids.filter((x) => x !== m.event_id)] : ids;
    return { ...m, event_ids: ordered };
  });
}

/** The events a material belongs to (event_ids when the helpers filled it, else the primary). */
export const eventIdsOf = (m: Pick<Material, "event_id" | "event_ids">) => m.event_ids ?? (m.event_id ? [m.event_id] : []);

export async function listMaterials(): Promise<Material[]> {
  if (!supabaseConfigured) return [];
  const sb = await supabaseServer();
  const [{ data }, links] = await Promise.all([
    sb.from("materials").select("*").order("created_at", { ascending: false }),
    listLinks(sb),
  ]);
  return withEventIds((data ?? []) as Material[], links);
}

/** Talks and files per event, counting every event a material is linked to. */
export function materialCounts(materials: Material[], isTalk: (m: Material) => boolean) {
  const talks: Record<string, number> = {};
  const items: Record<string, number> = {};
  for (const m of materials) {
    for (const id of eventIdsOf(m)) {
      items[id] = (items[id] ?? 0) + 1;
      if (isTalk(m)) talks[id] = (talks[id] ?? 0) + 1;
    }
  }
  return { talks, items };
}

export async function eventCounts(): Promise<Record<string, { going: number; attended: number }>> {
  if (!supabaseConfigured) return {};
  const sb = await supabaseServer();
  const { data } = await sb.from("event_counts").select("*");
  return Object.fromEntries((data ?? []).map((r: { event_id: string; going: number; attended: number }) => [r.event_id, { going: r.going, attended: r.attended }]));
}

/** Materials of one event: linked ones (0006), or by materials.event_id before the migration. */
export async function eventMaterials(sb: SupabaseClient, eventId: string): Promise<Material[]> {
  const linked = await sb.from("material_events").select("materials(*)").eq("event_id", eventId);
  let list: Material[];
  if (linked.error) {
    const { data } = await sb.from("materials").select("*").eq("event_id", eventId).order("created_at");
    list = (data ?? []) as Material[];
  } else {
    list = ((linked.data ?? []) as unknown as { materials: Material | null }[]).map((r) => r.materials).filter((m): m is Material => !!m);
  }
  list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!list.length || linked.error) return list.map((m) => ({ ...m, event_ids: m.event_id ? [m.event_id] : [] }));
  const { data: links } = await sb.from("material_events").select("material_id, event_id").in("material_id", list.map((m) => m.id)).order("created_at");
  return withEventIds(list, (links ?? []) as Link[]);
}

export async function getEvent(slug: string) {
  if (!supabaseConfigured) return null;
  const sb = await supabaseServer();
  const { data: event } = await sb.from("events").select("*").eq("slug", slug).maybeSingle();
  if (!event) return null;
  const [agenda, team, materials] = await Promise.all([
    sb.from("agenda_items").select("*").eq("event_id", event.id).order("starts_at"),
    sb.from("event_team").select("part, team_members(*)").eq("event_id", event.id),
    eventMaterials(sb, event.id),
  ]);
  return {
    event: event as EventRow,
    agenda: (agenda.data ?? []) as AgendaItem[],
    team: (team.data ?? []) as unknown as EventTeamRow[],
    materials,
  };
}

export type LiveEvent = Pick<EventRow, "id" | "slug" | "title" | "starts_on" | "ends_on" | "venue" | "city" | "status">;

/**
 * The few fields the phone ask page and the big screen need, for any event including drafts
 * (0004 live_event). Falls back to the regular lookup when the function is not there yet.
 */
export async function getLiveEvent(slug: string): Promise<LiveEvent | null> {
  if (!supabaseConfigured) return null;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("live_event", { p_slug: slug });
  if (!error) return ((data ?? []) as LiveEvent[])[0] ?? null;
  return (await getEvent(slug))?.event ?? null;
}

export type EventRef = Pick<EventRow, "id" | "slug" | "title" | "starts_on" | "ends_on" | "city" | "status" | "visibility">;

/**
 * One material with every event it is linked to that the caller can see (primary first).
 * `events` is the primary event, or the first visible linked one; null for a team-only
 * recording that is not linked to any event yet.
 */
export async function getMaterial(id: string) {
  if (!supabaseConfigured) return null;
  const sb = await supabaseServer();
  // materials and events are related twice (event_id, and material_events), so name the key
  const { data } = await sb.from("materials").select("*, events!materials_event_id_fkey(id, slug, title, starts_on, ends_on, city, status, visibility)").eq("id", id).maybeSingle();
  if (!data) return null;
  const m = data as Material & { events: EventRef | null };
  const linked = await sb.from("material_events").select("event_id, events(id, slug, title, starts_on, ends_on, city, status, visibility)").eq("material_id", id).order("created_at");
  let all: EventRef[] = linked.error
    ? (m.events ? [m.events] : [])
    : ((linked.data ?? []) as unknown as { events: EventRef | null }[]).map((r) => r.events).filter((e): e is EventRef => !!e);
  if (m.events && !all.some((e) => e.id === m.events!.id)) all = [m.events, ...all];
  all.sort((a, b) => (a.id === m.event_id ? -1 : b.id === m.event_id ? 1 : b.starts_on.localeCompare(a.starts_on)));
  return { ...m, events: all[0] ?? null, linkedEvents: all, event_ids: all.map((e) => e.id) };
}
