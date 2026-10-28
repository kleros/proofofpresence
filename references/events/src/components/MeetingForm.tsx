"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MEETING_INTERESTS } from "@/lib/kleros";

export default function MeetingForm({ eventId }: { eventId: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    const { error } = await supabaseBrowser().from("meeting_requests").insert({
      event_id: eventId, name: String(f.get("name")), email: String(f.get("email")), company: String(f.get("company") || "") || null,
      interest: String(f.get("interest")), message: String(f.get("message") || "") || null,
    });
    if (error) { setErr(error.message); setState("error"); return; }
    setState("sent");
  }

  if (state === "sent") return <div className="ok">Thanks. The Kleros team will reply by email.</div>;
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>Request a meeting</button>;
  return (
    <form onSubmit={submit} className="stack form-tight">
      <div className="field"><label htmlFor="mr-name">Name</label><input id="mr-name" name="name" required /></div>
      <div className="field"><label htmlFor="mr-email">Email</label><input id="mr-email" name="email" type="email" required /></div>
      <div className="field"><label htmlFor="mr-company">Company or project</label><input id="mr-company" name="company" /></div>
      <div className="field"><label htmlFor="mr-interest">I&apos;d like to talk about</label><select id="mr-interest" name="interest">{MEETING_INTERESTS.map((i) => <option key={i}>{i}</option>)}</select></div>
      <div className="field"><label htmlFor="mr-msg">Anything else</label><textarea id="mr-msg" name="message" /></div>
      {state === "error" && <div className="note">Couldn&apos;t send: {err}</div>}
      <button className="btn primary sm" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send request"}</button>
    </form>
  );
}
