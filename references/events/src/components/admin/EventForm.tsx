"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { removeFiles } from "@/lib/materials-client";
import { EVENT_TYPES, REGIONS, ROLE_LABEL, TOPICS } from "@/lib/kleros";
import { slugify } from "@/lib/format";
import type { EventRow, KlerosRole } from "@/lib/types";

/** Emails typed in a box: split on commas, spaces or new lines, lower-cased, deduplicated. */
export function parseEmails(text: string) {
  const all = text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ok = [...new Set(all.filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(x)))];
  return { ok, bad: all.filter((x) => !ok.includes(x)) };
}

/**
 * Create or edit an event. `me` describes the editor. Only the team creates events. Switching an
 * existing event between public and private is its creator's call (the database enforces it in
 * 0010); an older event with no creator can only be made private by the admin. Only the creator
 * deletes a private event; the team deletes public ones.
 */
export default function EventForm({ event, me }: { event?: EventRow; me?: { isTeam: boolean; isAdmin?: boolean; userId: string } }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [topics, setTopics] = useState<string[]>(event?.topics ?? []);
  const [visibility, setVisibility] = useState<"public" | "private">(event?.visibility ?? "public");
  const [collabs, setCollabs] = useState("");
  const isTeam = me?.isTeam ?? true;
  const isCreator = !!event?.created_by && event.created_by === me?.userId;
  const canMakePublic = isTeam && (!event || event.visibility === "public" || isCreator);
  const canMakePrivate = !event || event.visibility === "private" || isCreator || (!event.created_by && !!me?.isAdmin);
  const canDelete = event ? (event.visibility === "private" ? event.created_by === me?.userId : isTeam) : false;

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); setErr("");
    const f = new FormData(ev.currentTarget);
    const s = (k: string) => (String(f.get(k) ?? "").trim() || null);
    const row = {
      title: s("title")!, kleros_role: s("kleros_role") as KlerosRole, organizer: s("organizer"), event_type: s("event_type")!,
      starts_on: s("starts_on")!, ends_on: s("ends_on"), start_time: s("start_time"), timezone: s("timezone"),
      city: s("city"), country: s("country"), region: s("region") ?? (s("city") ? null : "Online"), venue: s("venue"), url: s("url"), cover_path: s("cover_path"),
      description: s("description"), recap: s("recap"), topics, visibility,
      // a private event is never "published"; made public later, it starts as a draft
      status: (visibility === "private" ? "draft" : s("status") ?? "draft") as "draft" | "published",
      // an emptied slug box keeps the current address when editing (a private event's has a random ending)
      slug: s("slug") ?? event?.slug ?? slugify(`${s("title")}-${s("starts_on")?.slice(0, 7)}`), updated_at: new Date().toISOString(),
    };
    if (row.ends_on && row.ends_on < row.starts_on) { setErr("The end date is before the start date."); return; }
    const emails = parseEmails(collabs);
    if (!event && visibility === "private" && emails.bad.length) { setErr(`Not an email address: ${emails.bad.join(", ")}`); return; }
    setBusy(true);
    const sb = supabaseBrowser();
    const res = event ? await sb.from("events").update(row).eq("id", event.id).select("id").single() : await sb.from("events").insert(row).select("id").single();
    if (res.error) { setBusy(false); setErr(saveError(res.error.message, visibility)); return; }
    // made public: the collaborator list goes (the database does this too from 0012)
    if (event?.visibility === "private" && visibility === "public") await sb.from("event_collaborators").delete().eq("event_id", event.id);
    if (!event && visibility === "private" && emails.ok.length) {
      const { error } = await sb.from("event_collaborators").insert(emails.ok.map((email) => ({ event_id: res.data.id, email })));
      if (error) { setBusy(false); setErr(`The event was created, but the collaborators were not added: ${error.message}`); router.push(`/admin/events/${res.data.id}#collaborators`); return; }
    }
    setBusy(false);
    if (!event) router.push(`/admin/events/${res.data.id}`); else router.refresh();
  }
  async function remove() {
    if (!event) return;
    if (!confirmDel) { setConfirmDel(true); return; }
    const sb = supabaseBrowser();
    // a private event's uploaded files go with it, except files of items also on another event
    // (the database deletes the items that belong to this event alone). Files first: once the event
    // is gone, what is left in its folder can only be deleted from the Supabase dashboard, so the
    // event stays until its files are gone.
    if (event.visibility === "private") {
      const { data: files, error: fErr } = await sb.rpc("private_event_files", { p_event: event.id });
      if (fErr) { setErr(fErr.message); return; }
      if (!(await removeFiles((files ?? []) as string[]))) {
        setErr("Some of the event's files could not be deleted from storage, so the event is still here. Try again in a minute.");
        setConfirmDel(false); return;
      }
    }
    const { data, error } = await sb.from("events").delete().eq("id", event.id).select("id");
    if (error) { setErr(error.message); return; }
    if (!data?.length) { setErr("Only the person who created this private event can delete it."); setConfirmDel(false); return; }
    router.push("/admin");
  }

  const v = event;
  return (
    <form className="panel" onSubmit={submit}>
      <div className="field"><label htmlFor="title">Event name</label><input id="title" name="title" required defaultValue={v?.title} placeholder="Kleros Court Day Lisbon" /></div>
      <div className="two">
        <div className="field"><label htmlFor="kleros_role">Kleros&apos; role</label><select id="kleros_role" name="kleros_role" defaultValue={v?.kleros_role ?? "host"}>{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="organizer">Organizer</label><input id="organizer" name="organizer" defaultValue={v?.organizer ?? ""} placeholder="Kleros, ETHGlobal, a university…" /></div>
      </div>
      <div className="two">
        <div className="field"><label htmlFor="event_type">Type</label><select id="event_type" name="event_type" defaultValue={v?.event_type ?? "Conference"}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        {visibility === "public"
          ? <div className="field"><label htmlFor="status">Status</label><select id="status" name="status" defaultValue={v?.status ?? "draft"}><option value="draft">Draft (team only)</option><option value="published">Published</option></select></div>
          : <div className="field"><span className="lbl">Status</span><p className="muted small" style={{ margin: "6px 0 0" }}>Private events are never listed on the public site.</p></div>}
      </div>
      <fieldset className="field vis-choice">
        <legend className="lbl">Who can see it</legend>
        <label className="vis-opt" data-on={visibility === "public"} aria-disabled={!canMakePublic && visibility !== "public"}>
          <input type="radio" name="visibility" value="public" checked={visibility === "public"} disabled={!canMakePublic && visibility !== "public"} onChange={() => setVisibility("public")} />
          <span><b>Public</b><span className="muted small">Listed on the site once published. The whole Kleros team can see and edit it.{!canMakePublic && (isCreator ? " Making an event public needs a Kleros team account." : " Only the person who created this event can make it public.")}</span></span>
        </label>
        <label className="vis-opt" data-on={visibility === "private"} aria-disabled={!canMakePrivate && visibility !== "private"}>
          <input type="radio" name="visibility" value="private" checked={visibility === "private"} disabled={!canMakePrivate && visibility !== "private"} onChange={() => setVisibility("private")} />
          <span><b>Private</b><span className="muted small">Only {event && event.created_by && event.created_by !== me?.userId ? "its creator" : "you"} and the collaborators added can see it, open its materials and questions, and edit it. Other team members and admins cannot.{!canMakePrivate && (event?.created_by ? " Only the person who created this event can make it private." : " Events added before private events existed can only be made private by the admin.")}</span></span>
        </label>
      </fieldset>
      {visibility === "private" && !event && (
        <div className="field"><label htmlFor="collabs">Collaborators</label>
          <textarea id="collabs" value={collabs} onChange={(e) => setCollabs(e.target.value)} placeholder={"name@kleros.io, partner@example.org"} style={{ minHeight: 60 }} />
          <span className="muted small">Email addresses, separated by commas or new lines. They see the event once they sign in with that email. More can be added later.</span>
        </div>
      )}
      {visibility === "private" && event?.visibility === "public" && (
        <p className="note" style={{ margin: 0 }}>Saving makes this event private: it leaves the public site, and other team members lose access to it, its materials and its questions. {!event.created_by && "You become its creator."}</p>
      )}
      {visibility === "public" && event?.visibility === "private" && (
        <p className="note" style={{ margin: 0 }}>Saving makes this event public: the whole Kleros team can see and edit it, its materials and its questions. It stays off the public site until its status is set to Published. The collaborator list is cleared.</p>
      )}
      <div className="two">
        <div className="field"><label htmlFor="starts_on">Starts</label><input id="starts_on" name="starts_on" type="date" required defaultValue={v?.starts_on} /></div>
        <div className="field"><label htmlFor="ends_on">Ends</label><input id="ends_on" name="ends_on" type="date" defaultValue={v?.ends_on ?? ""} /></div>
      </div>
      <div className="two">
        <div className="field"><label htmlFor="start_time">Start time</label><input id="start_time" name="start_time" type="time" defaultValue={v?.start_time?.slice(0, 5) ?? ""} /></div>
        <div className="field"><label htmlFor="timezone">Time zone</label><input id="timezone" name="timezone" defaultValue={v?.timezone ?? ""} placeholder="GMT+7" /></div>
      </div>
      <div className="two">
        <div className="field"><label htmlFor="city">City</label><input id="city" name="city" defaultValue={v?.city ?? ""} placeholder="Leave empty if online" /></div>
        <div className="field"><label htmlFor="country">Country</label><input id="country" name="country" defaultValue={v?.country ?? ""} /></div>
      </div>
      <div className="two">
        <div className="field"><label htmlFor="region">Region</label><select id="region" name="region" defaultValue={v?.region ?? ""}><option value="">–</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="field"><label htmlFor="venue">Venue or stream</label><input id="venue" name="venue" defaultValue={v?.venue ?? ""} /></div>
      </div>
      <div className="two">
        <div className="field"><label htmlFor="url">Event page (Luma, Eventbrite…)</label><input id="url" name="url" type="url" defaultValue={v?.url ?? ""} placeholder="https://" /></div>
        <div className="field"><label htmlFor="cover_path">Cover image URL</label><input id="cover_path" name="cover_path" type="url" defaultValue={v?.cover_path ?? ""} placeholder="Right-click the Luma cover → Copy image address" /></div>
      </div>
      <div className="field"><span className="lbl">Topics (drive recommendations and the product promos shown)</span>
        <div className="chips" style={{ margin: 0 }}>{TOPICS.map((t) => <button type="button" key={t} className="chip" aria-pressed={topics.includes(t)} onClick={() => setTopics(topics.includes(t) ? topics.filter((x) => x !== t) : [...topics, t])}>{t}</button>)}</div></div>
      <div className="field"><label htmlFor="description">Description</label><textarea id="description" name="description" defaultValue={v?.description ?? ""} /></div>
      <div className="field"><label htmlFor="recap">Recap (after the event)</label><textarea id="recap" name="recap" defaultValue={v?.recap ?? ""} placeholder="What happened, who attended, key takeaways" /></div>
      <div className="field"><label htmlFor="slug">URL slug</label><input id="slug" name="slug" defaultValue={v?.slug ?? ""} placeholder={event ? "Keeps the current address if empty" : "Generated from the name if empty"} /></div>
      {err && <div className="note">{err}</div>}
      <div className="row-flex">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : event ? "Save changes" : "Create event"}</button>
        {event && canDelete && <button className="btn ghost" type="button" onClick={remove}>{confirmDel ? (event.visibility === "private" ? "Click again to delete this event and its materials" : "Click again to delete this event") : "Delete event"}</button>}
      </div>
    </form>
  );
}

/** Plain-language reasons for the database refusals a save can hit. */
function saveError(msg: string, visibility: "public" | "private") {
  if (msg.includes("events_slug_key")) return "Another event already uses this URL slug.";
  if (/Only the person who created this event|needs a Kleros team account/.test(msg)) return msg;
  if (/row-level security/i.test(msg)) {
    return visibility === "private"
      ? "This account cannot save this private event."
      : "Only Kleros team members can create or edit public events.";
  }
  if (/0 rows|no rows|multiple \(or no\) rows/i.test(msg)) return "This account cannot edit this event.";
  return msg;
}
