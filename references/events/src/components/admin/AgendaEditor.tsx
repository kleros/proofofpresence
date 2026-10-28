"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { AgendaItem } from "@/lib/types";

export default function AgendaEditor({ eventId, initial }: { eventId: string; initial: AgendaItem[] }) {
  const [items, setItems] = useState(initial);
  const [err, setErr] = useState("");
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { data, error } = await supabaseBrowser().from("agenda_items").insert({
      event_id: eventId, starts_at: String(f.get("t")) || null, title: String(f.get("title")), speaker: String(f.get("speaker")) || null, is_kleros: f.get("k") === "on",
    }).select("*").single();
    if (error) { setErr(error.message); return; }
    setItems([...items, data as AgendaItem].sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? "")));
    e.currentTarget.reset();
  }
  async function remove(id: string) {
    const { error } = await supabaseBrowser().from("agenda_items").delete().eq("id", id);
    if (!error) setItems(items.filter((x) => x.id !== id));
  }
  return (
    <div className="panel">
      <div className="agenda">
        {items.map((a) => (
          <div key={a.id} className="ag" style={{ gridTemplateColumns: "70px minmax(0,1fr) auto" }}>
            <span className="tm">{a.starts_at?.slice(0, 5)}</span>
            <div><div className={a.is_kleros ? "k" : ""} style={{ fontWeight: 600 }}>{a.title}</div>{a.speaker && <div className="muted small">{a.speaker}</div>}</div>
            <button className="btn sm ghost" onClick={() => remove(a.id)} aria-label="Remove">✕</button>
          </div>
        ))}
        {!items.length && <div className="muted small">No sessions yet.</div>}
      </div>
      <form className="row-flex" onSubmit={add}>
        <input name="t" type="time" aria-label="Time" className="search" style={{ flex: "0 0 120px" }} />
        <input name="title" required placeholder="Session title" aria-label="Session title" className="search" />
        <input name="speaker" placeholder="Speaker" aria-label="Speaker" className="search" />
        <label className="small"><input type="checkbox" name="k" /> Kleros session</label>
        <button className="btn sm primary" type="submit">Add</button>
      </form>
      {err && <div className="note">{err}</div>}
    </div>
  );
}
