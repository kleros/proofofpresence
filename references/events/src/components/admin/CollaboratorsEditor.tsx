"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseEmails } from "./EventForm";

type Row = { email: string; created_at: string };

/**
 * People who can see and edit a private event besides its creator (0010 event_collaborators).
 * Anyone on the list can add or remove others. Access follows the email: it works once that
 * person signs in with it, Kleros account or not.
 */
export default function CollaboratorsEditor({ eventId, creatorEmail, initial }: {
  eventId: string; creatorEmail: string | null; initial: Row[];
}) {
  const [list, setList] = useState(initial);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(ev: React.FormEvent) {
    ev.preventDefault(); setErr("");
    const { ok, bad } = parseEmails(text);
    if (bad.length) { setErr(`Not an email address: ${bad.join(", ")}`); return; }
    const fresh = ok.filter((e) => e !== creatorEmail && !list.some((r) => r.email === e));
    if (!fresh.length) { setText(""); return; }
    setBusy(true);
    const { data, error } = await supabaseBrowser().from("event_collaborators")
      .insert(fresh.map((email) => ({ event_id: eventId, email }))).select("email, created_at");
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setList([...list, ...((data ?? []) as Row[])]);
    setText("");
  }

  async function remove(email: string) {
    setErr("");
    const { error } = await supabaseBrowser().from("event_collaborators").delete().eq("event_id", eventId).eq("email", email);
    if (error) { setErr(error.message); return; }
    setList(list.filter((r) => r.email !== email));
  }

  return (
    <div className="panel stack">
      <ul className="collab-list">
        {creatorEmail && <li><span>{creatorEmail}</span><span className="pill plain">Creator</span></li>}
        {list.map((r) => (
          <li key={r.email}>
            <span>{r.email}</span>
            <button className="btn sm ghost" type="button" onClick={() => remove(r.email)} aria-label={`Remove ${r.email}`}>Remove</button>
          </li>
        ))}
        {!list.length && <li className="muted small">No collaborators yet. Only the creator can see this event.</li>}
      </ul>
      <form className="row-flex" onSubmit={add}>
        <input className="collab-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="name@kleros.io, partner@example.org" aria-label="Collaborator emails" />
        <button className="btn" type="submit" disabled={busy || !text.trim()}>{busy ? "Adding…" : "Add"}</button>
      </form>
      {err && <div className="note">{err}</div>}
      <p className="muted small" style={{ margin: 0 }}>Collaborators see the event, its materials and questions, and can edit it, once they sign in with the email listed here. Nobody is notified automatically, so send them the link.</p>
    </div>
  );
}
