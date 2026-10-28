"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { AttendanceStatus } from "@/lib/types";

export default function AttendanceButtons({ eventId, past, signedIn, slug }: { eventId: string; past: boolean; signedIn: boolean; slug: string }) {
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    const sb = supabaseBrowser();
    sb.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      sb.from("attendance").select("status, note").eq("event_id", eventId).eq("user_id", data.user.id).maybeSingle()
        .then(({ data: row }) => { if (row) { setStatus(row.status); setNote(row.note ?? ""); } });
    });
  }, [eventId, signedIn]);

  async function save(next: AttendanceStatus | null, nextNote = note) {
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getUser();
    if (!data.user) return;
    const res = next
      ? await sb.from("attendance").upsert({ user_id: data.user.id, event_id: eventId, status: next, note: nextNote || null, updated_at: new Date().toISOString() })
      : await sb.from("attendance").delete().eq("user_id", data.user.id).eq("event_id", eventId);
    if (res.error) { setMsg("Couldn't save: " + res.error.message); return; }
    setStatus(next);
    setMsg(next ? "Saved to My events" : "Removed");
  }

  const options: [AttendanceStatus, string][] = past ? [["saved", "☆ Save"], ["attended", "I was there"]] : [["saved", "☆ Save"], ["going", "✓ I'm going"]];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-flex">
        {signedIn
          ? options.map(([v, l]) => <button key={v} className={`btn sm ${status === v ? "on" : ""}`} onClick={() => save(status === v ? null : v)}>{l}</button>)
          : <Link className="btn sm" href={`/login?next=/events/${slug}`}>Sign in to save this event</Link>}
        {!past && <a className="btn sm" href={`/events/${slug}/calendar.ics`}>Add to calendar</a>}
      </div>
      {signedIn && status && (
        <div className="field">
          <label htmlFor="ev-note">My private notes</label>
          <textarea id="ev-note" value={note} placeholder="People I met, follow-ups…" onChange={(e) => setNote(e.target.value)} onBlur={() => save(status, note)} />
        </div>
      )}
      {msg && <span className="muted small" role="status">{msg}</span>}
    </div>
  );
}
