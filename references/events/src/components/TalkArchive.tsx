"use client";
import { useState } from "react";
import Link from "next/link";
import type { EventRow, Material, MaterialKind } from "@/lib/types";
import { fmtRange, newestFirst, place, plural } from "@/lib/format";
import { ArchiveRow, TalkCard, isWatchable } from "./MaterialRow";
import { EventCover } from "./EventCard";

type Tab = "all" | "talks" | "slides" | "posts";
const TABS: { v: Tab; label: string; kinds: MaterialKind[] | null }[] = [
  { v: "all", label: "All", kinds: null },
  { v: "talks", label: "Talks", kinds: ["talk", "video", "audio"] },
  { v: "slides", label: "Slides", kinds: ["slides", "doc"] },
  { v: "posts", label: "Photos and posts", kinds: ["image", "social", "link"] },
];

type Ev = EventRow;

export default function TalkArchive({ materials, events }: { materials: Material[]; events: Ev[] }) {
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  const kinds = TABS.find((t) => t.v === tab)!.kinds;
  const needle = q.trim().toLowerCase();

  // A material linked to several events is listed under each of them.
  const evs = (m: Material) => (m.event_ids ?? (m.event_id ? [m.event_id] : [])).map((id) => byId[id]).filter(Boolean);
  const pairs = materials.flatMap((m) => evs(m).map((e) => ({ m, e })));
  const list = pairs.filter(({ m, e }) => {
    if (kinds && !kinds.includes(m.kind)) return false;
    if (needle && ![m.title, m.speaker, e.title, e.city, e.country].join(" ").toLowerCase().includes(needle)) return false;
    return true;
  });
  const groups = [...new Set(list.map(({ e }) => e.id))].map((id) => byId[id]).sort(newestFirst)
    .map((e) => ({ e, items: list.filter((x) => x.e.id === e.id).map((x) => x.m).sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
  const tabCount = (t: (typeof TABS)[number]) => materials.filter((m) => evs(m).length && (!t.kinds || t.kinds.includes(m.kind))).length;
  const shown = new Set(list.map(({ m }) => m.id)).size;

  return (
    <div className="browser">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Type">
          {TABS.map((t) => <button key={t.v} aria-pressed={tab === t.v} onClick={() => setTab(t.v)}>{t.label} <span className="n">{tabCount(t)}</span></button>)}
        </div>
      </div>
      <div className="refine">
        <input className="search" type="search" placeholder="Search by title, speaker or event" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the archive" />
      </div>
      <div className="result-line" role="status">
        <span>{plural(shown, "item")} from {plural(groups.length, "event")}</span>
        {needle && <button className="link-btn" onClick={() => setQ("")}>Clear search</button>}
      </div>

      {groups.map(({ e, items }) => {
        const watch = items.filter(isWatchable);
        const rest = items.filter((m) => !isWatchable(m));
        return (
          <section key={e.id} className="arch-event">
            <header className="arch-h">
              <Link className="arch-cover" href={`/events/${e.slug}`} tabIndex={-1} aria-hidden><EventCover e={e} /></Link>
              <div className="arch-t">
                <h2><Link href={`/events/${e.slug}`}>{e.title}</Link></h2>
                <span className="muted small">{fmtRange(e.starts_on, e.ends_on)} · {place(e)} · {plural(items.length, "item")}</span>
              </div>
              <Link className="btn sm ghost arch-go" href={`/events/${e.slug}`}>Event page →</Link>
            </header>
            {/* talk cards first, then slides, audio and links in one panel below */}
            {watch.length > 0 && <div className="media">
              {watch.map((m) => <TalkCard key={m.id} m={m} event={e} />)}
            </div>}
            {rest.length > 0 && (
              <div className="files">
                <h3 className="sub-h">Slides, audio and links</h3>
                <div className="lib cols">{rest.map((m) => <ArchiveRow key={m.id} m={m} eventSlug={e.slug} />)}</div>
              </div>
            )}
          </section>
        );
      })}
      {!groups.length && (
        <div className="empty">
          <b>{materials.length ? "Nothing matches" : "Nothing in the archive yet"}</b>
          {materials.length ? "Try another type or a shorter search." : "Talks, slides and recordings appear here after each event."}
        </div>
      )}
    </div>
  );
}
