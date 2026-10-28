"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";

export default function RosterEditor({ initial }: { initial: TeamMember[] }) {
  const [list, setList] = useState(initial);
  const [err, setErr] = useState("");
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "").trim() || null;
    const { data, error } = await supabaseBrowser().from("team_members").insert({ name: g("name"), title: g("title"), x_handle: g("x"), calendar_url: g("cal"), avatar_url: g("avatar"), sort: list.length }).select("*").single();
    if (error) { setErr(error.message); return; }
    setList([...list, data as TeamMember]); e.currentTarget.reset();
  }
  async function patch(id: string, p: Partial<TeamMember>) {
    const { error } = await supabaseBrowser().from("team_members").update(p).eq("id", id);
    if (error) setErr(error.message); else setList(list.map((m) => (m.id === id ? { ...m, ...p } : m)));
  }
  async function remove(id: string) {
    const { error } = await supabaseBrowser().from("team_members").update({ active: false }).eq("id", id);
    if (!error) setList(list.filter((m) => m.id !== id));
  }
  return (
    <div className="stack">
      {list.length === 0 && <div className="empty"><b>Nobody on the roster yet</b>Add the first person below.</div>}
      <div className="table-wrap" hidden={list.length === 0}><table className="table">
        <thead><tr><th>Name</th><th>Title</th><th>X handle</th><th>Booking link</th><th></th></tr></thead>
        <tbody>{list.map((m) => (
          <tr key={m.id}>
            <td><b>{m.name}</b></td>
            <td><input className="search" defaultValue={m.title ?? ""} onBlur={(e) => patch(m.id, { title: e.target.value || null })} aria-label="Title" /></td>
            <td><input className="search" defaultValue={m.x_handle ?? ""} onBlur={(e) => patch(m.id, { x_handle: e.target.value || null })} aria-label="X handle" /></td>
            <td><input className="search" defaultValue={m.calendar_url ?? ""} onBlur={(e) => patch(m.id, { calendar_url: e.target.value || null })} aria-label="Booking link" placeholder="https://cal.com/…" /></td>
            <td><button className="btn sm ghost" onClick={() => remove(m.id)}>Remove</button></td>
          </tr>))}</tbody>
      </table></div>
      <form className="panel" onSubmit={add}>
        <h3>Add a person</h3>
        <div className="two"><div className="field"><label htmlFor="n">Name</label><input id="n" name="name" required /></div><div className="field"><label htmlFor="ti">Title</label><input id="ti" name="title" placeholder="Head of BD" /></div></div>
        <div className="two"><div className="field"><label htmlFor="x">X handle</label><input id="x" name="x" placeholder="@handle" /></div><div className="field"><label htmlFor="cal">Booking link</label><input id="cal" name="cal" type="url" placeholder="https://cal.com/…" /></div></div>
        <div className="field"><label htmlFor="av">Photo URL</label><input id="av" name="avatar" type="url" /></div>
        {err && <div className="note">{err}</div>}
        <button className="btn primary" type="submit">Add to roster</button>
      </form>
    </div>
  );
}
