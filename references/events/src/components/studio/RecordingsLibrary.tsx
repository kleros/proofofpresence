"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Material } from "@/lib/types";
import { unlinkMaterial, type PickEvent } from "@/lib/materials-client";
import { fmtDur, fmtRange, plural } from "@/lib/format";
import LinkEvents from "./LinkEvents";
import EventChip from "./EventChip";

type Filter = "all" | "unlinked" | "notx";
const KIND_LABEL: Record<string, string> = { talk: "Talk with slides", audio: "Audio", video: "Video" };
const TX_LABEL: Record<string, [string, string]> = {
  done: ["Transcript ready", "live"], queued: ["Transcribing", "plain"], transcribing: ["Transcribing", "plain"],
  summarising: ["Writing summary", "plain"], error: ["Transcript failed", "ex"],
};

/** /admin/recordings: every talk, recording and video, with the events each one is linked to. */
export default function RecordingsLibrary({ materials, events, txStatus, linksReady }: {
  materials: Material[]; events: PickEvent[]; txStatus: Record<string, string>; linksReady: boolean;
}) {
  const router = useRouter();
  const [links, setLinks] = useState<Record<string, string[]>>(() => Object.fromEntries(materials.map((m) => [m.id, m.event_ids ?? []])));
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [armed, setArmed] = useState("");
  const [err, setErr] = useState("");
  const byId = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events]);

  // after a refresh (a new event, a link made elsewhere) take the server's view
  useEffect(() => { setLinks(Object.fromEntries(materials.map((m) => [m.id, m.event_ids ?? []]))); }, [materials]);

  const needle = q.trim().toLowerCase();
  const evsOf = (m: Material) => (links[m.id] ?? []).map((id) => byId[id]).filter(Boolean);
  const counts = {
    all: materials.length,
    unlinked: materials.filter((m) => !(links[m.id] ?? []).length).length,
    notx: materials.filter((m) => txStatus[m.id] !== "done").length,
  };
  const list = materials.filter((m) => {
    if (filter === "unlinked" && (links[m.id] ?? []).length) return false;
    if (filter === "notx" && txStatus[m.id] === "done") return false;
    if (needle && ![m.title, m.speaker, ...evsOf(m).map((e) => `${e.title} ${e.city ?? ""}`)].join(" ").toLowerCase().includes(needle)) return false;
    return true;
  });

  async function unlink(m: Material, eventId: string) {
    const key = `${m.id}:${eventId}`;
    if (armed !== key) { setArmed(key); setTimeout(() => setArmed((a) => (a === key ? "" : a)), 4000); return; }
    setArmed(""); setErr("");
    try {
      await unlinkMaterial(m.id, eventId);
      setLinks((l) => ({ ...l, [m.id]: (l[m.id] ?? []).filter((x) => x !== eventId) }));
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="wrap page stack adm-page">
      <header className="adm-head">
        <div>
          <h1>Recordings</h1>
          <p className="muted">Every talk, recording and video, with the events it belongs to. A recording can be linked to several events. One with no published event is visible to the team only, and one that belongs only to private events is visible only to their creators and collaborators.</p>
        </div>
        <Link className="btn primary" href="/record"><span className="dot" aria-hidden /> Record new</Link>
      </header>

      {!linksReady && <p className="note" style={{ margin: 0 }}>Linking to several events needs the database update in supabase/migrations/0006_material_links.sql. Until it runs, each recording shows its one event.</p>}

      <div className="recl-tools">
        <div className="seg" role="group" aria-label="Show">
          {([["all", "All"], ["unlinked", "Not linked"], ["notx", "No transcript"]] as [Filter, string][]).map(([v, label]) => (
            <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{label} <span className="n">{counts[v]}</span></button>
          ))}
        </div>
        <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, speaker or event" aria-label="Search recordings" />
      </div>
      {err && <div className="note" role="alert">{err}</div>}

      {list.length ? (
        <ul className="recl-list">
          {list.map((m) => {
            const evs = evsOf(m);
            const tx = TX_LABEL[txStatus[m.id] ?? ""];
            const sub = [m.speaker, KIND_LABEL[m.kind] ?? m.kind, m.duration_seconds ? fmtDur(m.duration_seconds) : "", `added ${fmtRange(m.created_at.slice(0, 10))}`].filter(Boolean).join(" · ");
            return (
              <li key={m.id} className="recl-row">
                <span className={`ico ${m.kind}`} aria-hidden>▶</span>
                <div className="recl-main">
                  <Link className="recl-title" href={`/talks/${m.id}`}>{m.title}</Link>
                  <div className="muted small">{sub}</div>
                  <div className="recl-evs">
                    {evs.length ? evs.map((e) => (
                      <EventChip key={e.id} e={e}>
                        {linksReady && (
                          <button type="button" className={`chip-x${armed === `${m.id}:${e.id}` ? " armed" : ""}`} onClick={() => unlink(m, e.id)}
                            aria-label={`Unlink from ${e.title}`} title="Unlink from this event">{armed === `${m.id}:${e.id}` ? "Unlink?" : "✕"}</button>
                        )}
                      </EventChip>
                    )) : <span className="pill ex">Not linked to an event</span>}
                  </div>
                </div>
                <div className="recl-side">
                  {tx ? <span className={`pill ${tx[1]}`}>{tx[0]}</span> : <span className="pill plain">No transcript</span>}
                  {linksReady && (
                    <LinkEvents materialId={m.id} title={m.title} linked={links[m.id] ?? []} events={events} className="btn sm"
                      label="Link to events"
                      onChange={(ids) => setLinks((l) => ({ ...l, [m.id]: ids }))} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">
          <b>{materials.length ? "Nothing matches" : "No recordings yet"}</b>
          {materials.length ? "Try another filter or a shorter search." : "Recordings made on an event page, in the host console or on the Record page appear here."}
        </div>
      )}
      <p className="muted small">{plural(list.length, "recording")} shown</p>
    </div>
  );
}
