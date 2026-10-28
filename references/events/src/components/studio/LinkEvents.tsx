"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { linkMaterial, loadPickEvents, unlinkMaterial, type PickEvent } from "@/lib/materials-client";
import { EVENT_TYPES, ROLE_LABEL } from "@/lib/kleros";
import { fmtRange, place, slugify, todayIso } from "@/lib/format";
import type { KlerosRole } from "@/lib/types";

/**
 * "Link to events": a dialog to pick any number of events (drafts included) for a recording,
 * or to create a new event on the spot, which is then linked too. Saving adds and removes
 * links (material_events) and refreshes the page.
 */
export default function LinkEvents({ materialId, title, linked, onChange, label = "Link to events", className = "btn", events: preloaded }: {
  materialId: string; title: string; linked: string[];
  onChange?: (ids: string[], events: PickEvent[]) => void;
  label?: string; className?: string; events?: PickEvent[];
}) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [events, setEvents] = useState<PickEvent[] | null>(preloaded ?? null);
  const [picked, setPicked] = useState<string[]>(linked);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  // 0010: a private event only takes items that are on private events alone (all editable by the caller)
  const [privOk, setPrivOk] = useState<boolean | null>(null);

  useEffect(() => { if (preloaded) setEvents(preloaded); }, [preloaded]);

  // until the answer is in, private events that are not picked yet stay locked
  function checkPrivOk() {
    setPrivOk(null);
    supabaseBrowser().rpc("material_private_only", { p_material: materialId })
      .then(({ data, error }) => setPrivOk(error ? null : !!data));
  }

  async function open() {
    setPicked(linked); setQ(""); setErr(""); setCreating(false);
    dlg.current?.showModal();
    checkPrivOk();
    if (!events) {
      try { setEvents(await loadPickEvents()); } catch (e) { setErr(`The events could not be loaded: ${(e as Error).message}`); }
    }
  }
  const close = () => dlg.current?.close();
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = (events ?? []).filter((e) => !needle || [e.title, e.city, e.country, e.starts_on, fmtRange(e.starts_on, e.ends_on), e.event_type].join(" ").toLowerCase().includes(needle));
    // linked ones first, then newest first
    return [...list].sort((a, b) => Number(linked.includes(b.id)) - Number(linked.includes(a.id)) || b.starts_on.localeCompare(a.starts_on));
  }, [events, needle, linked]);

  async function save() {
    setErr(""); setBusy("Saving…");
    const add = picked.filter((id) => !linked.includes(id));
    const drop = linked.filter((id) => !picked.includes(id));
    // one event at a time, private ones first: a public link would stop the item from going into a
    // private event, and a refused private pick must not cost the public ones
    const isPrivate = (id: string) => (events ?? []).find((e) => e.id === id)?.visibility === "private";
    // what is saved so far, so a refusal halfway still shows the links that were made
    let now = [...linked];
    const report = () => onChange?.(now, (events ?? []).filter((e) => now.includes(e.id)));
    try {
      for (const id of [...add].sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)))) { await linkMaterial(materialId, [id]); now = [...now, id]; }
      for (const id of drop) { await unlinkMaterial(materialId, id); now = now.filter((x) => x !== id); }
      report();
      close();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      if (now.length !== linked.length || now.some((id) => !linked.includes(id))) { report(); router.refresh(); }
      checkPrivOk();
    }
    setBusy("");
  }

  async function create(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); setErr("");
    const f = new FormData(ev.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim() || null;
    const name = s("title")!; const date = s("starts_on")!; const city = s("city");
    const base = slugify(`${name}-${date.slice(0, 7)}`) || "event";
    const row = {
      title: name, starts_on: date, city, region: city ? null : "Online", event_type: s("event_type") ?? "Other",
      kleros_role: (s("kleros_role") ?? "host") as KlerosRole, status: f.get("publish") ? "published" : "draft", topics: [] as string[],
    };
    setBusy("Creating the event…");
    const sb = supabaseBrowser();
    let res = await sb.from("events").insert({ ...row, slug: base }).select("id, slug, title, starts_on, ends_on, city, country, status, visibility, event_type").single();
    if (res.error && /slug/.test(res.error.message)) {
      res = await sb.from("events").insert({ ...row, slug: `${base}-${crypto.randomUUID().slice(0, 4)}` }).select("id, slug, title, starts_on, ends_on, city, country, status, visibility, event_type").single();
    }
    setBusy("");
    if (res.error) { setErr(res.error.message); return; }
    const made = res.data as PickEvent;
    setEvents((list) => [made, ...(list ?? [])]);
    setPicked((p) => [...p, made.id]);
    setCreating(false); setQ("");
  }

  const changed = picked.length !== linked.length || picked.some((id) => !linked.includes(id));
  return (
    <>
      <button type="button" className={className} onClick={open}>{label}</button>
      <dialog ref={dlg} className="le-dialog" aria-labelledby={`le-h-${materialId}`} onClick={(e) => { if (e.target === dlg.current) close(); }}>
        <div className="le-inner">
          <header className="le-head">
            <div className="le-title">
              <div className="eyebrow">Link to events</div>
              <h2 id={`le-h-${materialId}`}>{title}</h2>
              <p className="muted small">A recording can belong to several events. It shows in the Talks of each one, and in the archive under each.</p>
            </div>
            <button type="button" className="btn ghost sm le-x" onClick={close} aria-label="Close">✕</button>
          </header>

          {creating ? (
            <form className="le-create" onSubmit={create}>
              <div className="sub-h">New event</div>
              <div className="field"><label htmlFor={`le-t-${materialId}`}>Event name</label><input id={`le-t-${materialId}`} name="title" required autoFocus placeholder="Kleros Court Day Lisbon" /></div>
              <div className="two">
                <div className="field"><label htmlFor={`le-d-${materialId}`}>Date</label><input id={`le-d-${materialId}`} name="starts_on" type="date" required defaultValue={todayIso()} /></div>
                <div className="field"><label htmlFor={`le-c-${materialId}`}>City</label><input id={`le-c-${materialId}`} name="city" placeholder="Leave empty if online" /></div>
              </div>
              <div className="two">
                <div className="field"><label htmlFor={`le-f-${materialId}`}>Format</label><select id={`le-f-${materialId}`} name="event_type" defaultValue="Meetup">{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
                <div className="field"><label htmlFor={`le-r-${materialId}`}>Kleros&apos; role</label><select id={`le-r-${materialId}`} name="kleros_role" defaultValue="host">{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              </div>
              <label className="le-check"><input type="checkbox" name="publish" /> Publish now <span className="muted small">(otherwise it is saved as a draft, visible to the team only)</span></label>
              <div className="row-flex">
                <button className="btn primary sm" type="submit" disabled={!!busy}>{busy || "Create and select"}</button>
                <button className="btn ghost sm" type="button" onClick={() => setCreating(false)}>Back to the list</button>
              </div>
            </form>
          ) : (
            <>
              <div className="le-tools">
                <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, date or city" aria-label="Search events" />
                <button type="button" className="btn sm" onClick={() => setCreating(true)}>+ Create a new event</button>
              </div>
              <ul className="le-list" aria-label="Events">
                {!events && !err && <li className="muted small le-empty">Loading events…</li>}
                {events && !shown.length && <li className="muted small le-empty">No event matches. Try another word, or create a new event.</li>}
                {shown.map((e) => {
                  const on = picked.includes(e.id);
                  const locked = !on && e.visibility === "private" && privOk !== true && !linked.includes(e.id);
                  return (
                    <li key={e.id}>
                      <label className={`le-row${on ? " is-on" : ""}`} aria-disabled={locked || undefined}
                        title={locked ? "Only items that belong to private events can go into a private event. Add it there as a new link or upload instead." : undefined}>
                        <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(e.id)} />
                        <span className="le-main">
                          <b>{e.title}</b>
                          <span className="muted small">{fmtRange(e.starts_on, e.ends_on)} · {place(e)} · {e.event_type}</span>
                        </span>
                        {e.visibility === "private" ? <span className="pill draft">Private</span> : e.status === "draft" && <span className="pill draft">Draft</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {privOk === false && shown.some((e) => e.visibility === "private" && !linked.includes(e.id)) && (
                <p className="muted small">Private events only take items that belong to private events. To show this one in a private event, add it there as a new link or upload.</p>
              )}
            </>
          )}

          {err && <div className="note" role="alert">{err}</div>}
          {!creating && (
            <footer className="le-foot">
              <span className="muted small">{picked.length === 0 ? "No event selected: only the team can see it." : picked.length === 1 ? "1 event selected" : `${picked.length} events selected`}</span>
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={close}>Cancel</button>
              <button type="button" className="btn primary" onClick={save} disabled={!!busy || !changed}>{busy || "Save links"}</button>
            </footer>
          )}
        </div>
      </dialog>
    </>
  );
}
