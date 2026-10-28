"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";

export default function TeamPicker({ eventId, roster, initial }: { eventId: string; roster: TeamMember[]; initial: { team_member_id: string; part: string | null }[] }) {
  const [sel, setSel] = useState<Record<string, string>>(Object.fromEntries(initial.map((r) => [r.team_member_id, r.part ?? ""])));
  async function toggle(m: TeamMember) {
    const sb = supabaseBrowser();
    if (m.id in sel) {
      await sb.from("event_team").delete().eq("event_id", eventId).eq("team_member_id", m.id);
      const n = { ...sel }; delete n[m.id]; setSel(n);
    } else {
      await sb.from("event_team").insert({ event_id: eventId, team_member_id: m.id, part: null });
      setSel({ ...sel, [m.id]: "" });
    }
  }
  async function setPart(id: string, part: string) {
    setSel({ ...sel, [id]: part });
    await supabaseBrowser().from("event_team").update({ part: part || null }).eq("event_id", eventId).eq("team_member_id", id);
  }
  if (!roster.length) return <div className="empty"><b>No team members yet</b><Link href="/admin/team">Add the Kleros team roster</Link> first.</div>;
  return (
    <div className="panel">
      {roster.map((m) => (
        <div key={m.id} className="row-flex">
          <button className={`btn sm ${m.id in sel ? "on" : ""}`} onClick={() => toggle(m)}>{m.id in sel ? "✓ " : ""}{m.name}</button>
          {m.id in sel && <input className="search" style={{ maxWidth: 260 }} placeholder="Part: speaker, booth, judge…" defaultValue={sel[m.id]} onBlur={(e) => setPart(m.id, e.target.value)} aria-label={`${m.name}'s part`} />}
          {!m.calendar_url && m.id in sel && <span className="muted small">No booking link</span>}
        </div>
      ))}
    </div>
  );
}
