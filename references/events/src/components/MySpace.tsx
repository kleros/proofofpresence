"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventRow, Material, Profile } from "@/lib/types";
import { REGIONS, TOPICS, VISITOR_ROLES } from "@/lib/kleros";
import { isPast, fmtDur } from "@/lib/format";
import { scoreEvent } from "@/lib/recommend";
import { supabaseBrowser } from "@/lib/supabase/client";
import EventCard from "./EventCard";
import { TalkCard } from "./MaterialRow";

type Att = { event_id: string; status: string; note: string | null };
type Prog = { material_id: string; position_seconds: number; finished: boolean };

export default function MySpace({ profile, email, events, materials, attendance, progress, privateEvents = [], userId }: {
  profile: Profile; email: string; events: EventRow[]; materials: Material[]; attendance: Att[]; progress: Prog[];
  privateEvents?: EventRow[]; userId?: string;
}) {
  const router = useRouter();
  const [p, setP] = useState(profile);
  const [saved, setSaved] = useState("");
  const [tab, setTab] = useState<"going" | "saved" | "attended">("going");
  const status = Object.fromEntries(attendance.map((a) => [a.event_id, a.status]));
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  // the first linked event the visitor can see
  const evOf = (m: Material) => (m.event_ids ?? (m.event_id ? [m.event_id] : [])).map((id) => byId[id]).find(Boolean);

  async function update(patch: Partial<Profile>) {
    const next = { ...p, ...patch }; setP(next); setSaved("Saving…");
    const { error } = await supabaseBrowser().from("profiles").update({
      display_name: next.display_name, visitor_role: next.visitor_role, region: next.region, interests: next.interests, include_online: next.include_online,
    }).eq("id", p.id);
    setSaved(error ? "Couldn't save: " + error.message : "Saved");
  }
  async function signOut() {
    await supabaseBrowser().auth.signOut();
    // the assistant's conversation was answered with this account's access
    try { for (const k of Object.keys(sessionStorage)) if (k.startsWith("kleros-ask")) sessionStorage.removeItem(k); } catch { /* storage off */ }
    router.push("/"); router.refresh();
  }

  const picks = events.filter((e) => !isPast(e) && !status[e.id]).map((e) => ({ e, ...scoreEvent(e, p) }))
    .filter((x) => x.score > 0 || !p.interests.length).sort((a, b) => b.score - a.score || a.e.starts_on.localeCompare(b.e.starts_on)).slice(0, 6);
  const watching = progress.filter((x) => !x.finished).map((x) => ({ x, m: materials.find((m) => m.id === x.material_id) })).filter((r) => r.m);
  const watched = new Set(progress.map((x) => x.material_id));
  const missed = materials.filter((m) => m.kind === "talk" && !watched.has(m.id) && evOf(m) && status[evOf(m)!.id] !== "attended")
    .map((m) => ({ m, s: scoreEvent(evOf(m)!, p).score })).filter((r) => r.s > 0 || !p.interests.length).sort((a, b) => b.s - a.s).slice(0, 5);
  const mine = events.filter((e) => status[e.id] === tab).sort((a, b) => a.starts_on.localeCompare(b.starts_on));

  return (
    <div className="wrap page me-grid">
      <aside className="panel" style={{ alignSelf: "start" }}>
        <div className="eyebrow">My events</div>
        <div className="field"><label htmlFor="dn">Display name</label><input id="dn" value={p.display_name ?? ""} onChange={(e) => setP({ ...p, display_name: e.target.value })} onBlur={() => update({})} /></div>
        <div className="muted small">{email}</div>
        <div className="field"><label htmlFor="role">I mostly come to Kleros events as a</label>
          <select id="role" value={p.visitor_role ?? ""} onChange={(e) => update({ visitor_role: e.target.value || null })}><option value="">Pick one</option>{VISITOR_ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="field"><label htmlFor="region">Home region</label>
          <select id="region" value={p.region ?? ""} onChange={(e) => update({ region: e.target.value || null })}><option value="">Anywhere</option>{REGIONS.filter((r) => r !== "Online").map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="field"><span className="lbl">Topics I follow</span>
          <div className="chips" style={{ margin: 0 }}>{TOPICS.map((t) => <button key={t} className="chip" aria-pressed={p.interests.includes(t)} onClick={() => update({ interests: p.interests.includes(t) ? p.interests.filter((x) => x !== t) : [...p.interests, t] })}>{t}</button>)}</div></div>
        <label className="small"><input type="checkbox" checked={p.include_online} onChange={(e) => update({ include_online: e.target.checked })} /> Include online events</label>
        <div className="row-flex"><span className="muted small" role="status">{saved}</span><span style={{ flex: 1 }} /><button className="btn sm ghost" onClick={signOut}>Sign out</button></div>
      </aside>
      <div>
        {privateEvents.length > 0 && (<>
          <div className="section-h first"><div><div className="eyebrow">Private</div><h2>Private events you can open</h2></div></div>
          <div className="grid">{privateEvents.map((e) => <EventCard key={e.id} e={e} mine={e.created_by === userId ? "You created this" : "Shared with you"} />)}</div>
        </>)}
        {watching.length > 0 && (<>
          <div className={privateEvents.length ? "section-h" : "section-h first"}><h2>Continue watching</h2></div>
          <div className="grid">{watching.map(({ x, m }) => <TalkCard key={x.material_id} m={m!} event={evOf(m!)} note={`Stopped at ${fmtDur(x.position_seconds)}`} />)}</div>
        </>)}
        <div className={watching.length || privateEvents.length ? "section-h" : "section-h first"}><div><div className="eyebrow">Picked for you</div><h2>Upcoming events that match your interests</h2></div></div>
        <div className="grid">
          {picks.map((x) => <EventCard key={x.e.id} e={x.e} why={x.why} />)}
          {!picks.length && <p className="quiet-empty" style={{ gridColumn: "1/-1" }}>{p.interests.length ? "Nothing upcoming fits these topics yet. Try following a few more." : "Follow a few topics to get recommendations."}</p>}
        </div>
        <div className="section-h"><div><div className="eyebrow">Catch up</div><h2>Talks you missed</h2></div></div>
        {missed.length
          ? <div className="grid">{missed.map(({ m }) => <TalkCard key={m.id} m={m} event={evOf(m)} />)}</div>
          : <p className="quiet-empty">All caught up. Talks from events you missed will show up here.</p>}
        <div className="section-h">
          <div><div className="eyebrow">Your list</div><h2>Going, saved, attended</h2></div>
          <div className="seg" role="group" aria-label="My list">{(["going", "saved", "attended"] as const).map((t) => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        </div>
        <div className="grid">
          {mine.map((e) => <EventCard key={e.id} e={e} />)}
          {!mine.length && <p className="quiet-empty" style={{ gridColumn: "1/-1" }}>Nothing here yet. Open an event and use Save, I&apos;m going or I was there. <Link href="/events">Browse events</Link></p>}
        </div>
      </div>
    </div>
  );
}
