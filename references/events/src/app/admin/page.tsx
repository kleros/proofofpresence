import type { Metadata } from "next";
import Link from "next/link";
import { requireTeam } from "@/lib/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { fmtRange, isLive, isPast, place } from "@/lib/format";
import { ROLE_SHORT } from "@/lib/kleros";
import type { EventRow } from "@/lib/types";
import NotTeam from "@/components/NotTeam";
import RequestsTable from "@/components/RequestsTable";
import LumaSync, { type SyncLog } from "@/components/admin/LumaSync";

export const metadata: Metadata = { title: "Events desk" };
export const dynamic = "force-dynamic";

const TABS = ["upcoming", "past", "drafts", "private", "requests"] as const;
type Tab = (typeof TABS)[number];

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { isTeam } = await requireTeam();
  if (!isTeam) return <NotTeam />;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "upcoming";

  const sb = await supabaseServer();
  const [ev, mats, reqs, counts, sync] = await Promise.all([
    sb.from("events").select("*").order("starts_on", { ascending: true }),
    sb.from("material_events").select("event_id"),
    sb.from("meeting_requests").select("*, events(title, slug)").order("created_at", { ascending: false }).limit(200),
    sb.from("event_counts").select("*"),
    sb.from("luma_sync_log").select("ran_at, checked, updated, added, errors").order("ran_at", { ascending: false }).limit(1),
  ]);
  const events = (ev.data ?? []) as EventRow[];
  // links (0006); before that migration, count by materials.event_id
  const linkRows = mats.error ? (await sb.from("materials").select("event_id")).data : mats.data;
  const matCount: Record<string, number> = {};
  for (const m of (linkRows ?? []) as { event_id: string | null }[]) if (m.event_id) matCount[m.event_id] = (matCount[m.event_id] ?? 0) + 1;
  const going: Record<string, number> = Object.fromEntries(
    ((counts.data ?? []) as { event_id: string; going: number }[]).map((c) => [c.event_id, c.going]),
  );

  // private events reach this list only for their creator and collaborators (RLS, 0010)
  const pub = events.filter((e) => e.visibility !== "private");
  const published = pub.filter((e) => e.status === "published");
  const lists = {
    upcoming: published.filter((e) => !isPast(e)),
    past: published.filter((e) => isPast(e)).reverse(),
    drafts: pub.filter((e) => e.status === "draft"),
    private: events.filter((e) => e.visibility === "private"),
  };
  const needsMaterials = lists.past.filter((e) => !matCount[e.id]);
  const requests = reqs.data ?? [];
  const openRequests = requests.filter((r: { handled: boolean }) => !r.handled).length;

  const tabs: { id: Tab; label: string; n: number; hint?: boolean }[] = [
    { id: "upcoming", label: "Upcoming", n: lists.upcoming.length },
    { id: "past", label: "Past", n: lists.past.length, hint: needsMaterials.length > 0 },
    { id: "drafts", label: "Drafts", n: lists.drafts.length },
    { id: "private", label: "Private", n: lists.private.length },
    { id: "requests", label: "Meeting requests", n: openRequests, hint: openRequests > 0 },
  ];

  return (
    <div className="wrap page stack adm-page">
      <header className="adm-head">
        <div>
          <h1>Events desk</h1>
          <p className="muted">Plan events, run them live, and keep talks and slides together afterwards.</p>
        </div>
        <Link className="btn primary" href="/admin/events/new">Add event</Link>
      </header>
      <LumaSync last={((sync.data ?? [])[0] as SyncLog | undefined) ?? null} />

      <div className="seg adm-tabs" role="tablist" aria-label="Desk sections">
        {tabs.map((t) => (
          <Link key={t.id} href={t.id === "upcoming" ? "/admin" : `/admin?tab=${t.id}`} role="tab"
            aria-selected={tab === t.id} aria-current={tab === t.id ? "page" : undefined}>
            {t.label} <span className={`adm-count${t.hint ? " hint" : ""}`}>{t.n}</span>
          </Link>
        ))}
      </div>

      {tab === "requests" ? (
        <section className="stack" aria-label="Meeting requests">
          <p className="muted small" style={{ margin: 0 }}>Sent from the “Meet Kleros” box on event pages. Mark a request handled once someone has replied.</p>
          <RequestsTable rows={requests} />
        </section>
      ) : (
        <section className="stack" aria-label={tab}>
          {tab === "past" && needsMaterials.length > 0 && (
            <p className="note" style={{ margin: 0 }}>
              {needsMaterials.length === 1 ? "1 past event has" : `${needsMaterials.length} past events have`} no slides or recordings yet.
            </p>
          )}
          <EventList events={lists[tab]} tab={tab} matCount={matCount} going={going} />
        </section>
      )}
    </div>
  );
}

const EMPTY: Record<Exclude<Tab, "requests">, [string, string]> = {
  upcoming: ["No upcoming events", "Published events with a future date show up here."],
  past: ["No past events yet", "Events move here the day after they end."],
  drafts: ["No drafts", "Events saved as draft stay hidden from the public site until published."],
  private: ["No private events", "Private events are seen only by their creator and the collaborators they add. Choose Private when adding an event."],
};

function EventList({ events, tab, matCount, going }: {
  events: EventRow[]; tab: Exclude<Tab, "requests">; matCount: Record<string, number>; going: Record<string, number>;
}) {
  if (!events.length) {
    const [title, body] = EMPTY[tab];
    return <div className="empty"><b>{title}</b>{body}</div>;
  }
  return (
    <ul className="desk-list">
      {events.map((e) => {
        const mats = matCount[e.id] ?? 0;
        const past = isPast(e);
        return (
          <li key={e.id} className="desk-row">
            <div className="desk-date">{fmtRange(e.starts_on, e.ends_on)}</div>
            <div className="desk-main">
              <Link className="desk-title" href={`/admin/events/${e.id}`}>{e.title}</Link>
              <div className="meta">
                <span>{ROLE_SHORT[e.kleros_role]}</span><span aria-hidden>·</span><span>{place(e)}</span>
                {isLive(e) && e.status === "published" && <span className="pill live">Today</span>}
                {e.is_example && <span className="pill ex">Example</span>}
                {e.visibility === "private" && <span className="pill draft">Private</span>}
              </div>
            </div>
            <div className="desk-stats">
              {!past && <span><b className="mono">{going[e.id] ?? 0}</b> going</span>}
              {past && mats === 0 && e.status === "published"
                ? <span className="pill ex">Needs materials</span>
                : (past || mats > 0) && <span><b className="mono">{mats}</b> {mats === 1 ? "material" : "materials"}</span>}
            </div>
            <div className="desk-acts">
              <Link className="btn sm" href={`/events/${e.slug}/host`}>Run live</Link>
              <Link className="btn sm" href={`/admin/events/${e.id}`}>Edit</Link>
              <Link className="btn sm ghost" href={`/events/${e.slug}`}>View</Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
