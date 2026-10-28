"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

type Req = { id: string; name: string; email: string; company: string | null; interest: string | null; message: string | null; handled: boolean; created_at: string; events: { title: string; slug: string } | null };

export default function RequestsTable({ rows }: { rows: Req[] }) {
  const [list, setList] = useState(rows);
  const [err, setErr] = useState("");
  async function toggle(r: Req) {
    setErr("");
    const { error } = await supabaseBrowser().from("meeting_requests").update({ handled: !r.handled }).eq("id", r.id);
    if (error) setErr("Could not save: " + error.message);
    else setList(list.map((x) => (x.id === r.id ? { ...x, handled: !x.handled } : x)));
  }
  if (!list.length) return <div className="empty"><b>No requests yet</b>Requests from the “Meet Kleros” box on event pages land here.</div>;
  const open = list.filter((r) => !r.handled);
  const done = list.filter((r) => r.handled);
  const row = (r: Req) => (
    <li key={r.id} className={`req${r.handled ? " done" : ""}`}>
      <div className="req-who">
        <b>{r.name}</b>
        <a className="small" href={`mailto:${r.email}`}>{r.email}</a>
        {r.company && <span className="muted small">{r.company}</span>}
      </div>
      <div className="req-body">
        <div className="meta">
          <span>{r.created_at.slice(0, 10)}</span>
          {r.interest && <span className="pill plain">{r.interest}</span>}
          {r.events && <Link href={`/events/${r.events.slug}`}>{r.events.title}</Link>}
        </div>
        {r.message && <p>{r.message}</p>}
      </div>
      <button className="btn sm" onClick={() => toggle(r)}>{r.handled ? "Reopen" : "Mark handled"}</button>
    </li>
  );
  return (
    <div className="stack">
      {err && <div className="note">{err}</div>}
      {open.length ? <ul className="req-list">{open.map(row)}</ul> : <div className="ok">All requests are handled.</div>}
      {done.length > 0 && (
        <details className="adm-details">
          <summary>Handled ({done.length})</summary>
          <ul className="req-list">{done.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
