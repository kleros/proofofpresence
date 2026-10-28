import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeam } from "@/lib/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { eventMaterials } from "@/lib/data";
import { fmtRange, place } from "@/lib/format";
import NotTeam from "@/components/NotTeam";
import EventForm from "@/components/admin/EventForm";
import AgendaEditor from "@/components/admin/AgendaEditor";
import TeamPicker from "@/components/admin/TeamPicker";
import CollaboratorsEditor from "@/components/admin/CollaboratorsEditor";
import MaterialsManager from "@/components/admin/MaterialsManager";
import type { AgendaItem, EventRow, TeamMember } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, isTeam, isAdmin } = await requireTeam(`/admin/events/${id}`);
  const sb = await supabaseServer();
  // the team edits public events; a private event's creator and collaborators edit it, team or not
  const { data: event } = await sb.from("events").select("*").eq("id", id).maybeSingle();
  if (!event) return isTeam ? notFound() : <NotTeam />;
  const { data: canEdit } = await sb.rpc("can_edit_event", { p_event: id });
  if (!canEdit) return <NotTeam />;
  const e = event as EventRow;
  const isPrivate = e.visibility === "private";
  const [agenda, team, roster, materials, collabs, creator] = await Promise.all([
    sb.from("agenda_items").select("*").eq("event_id", id).order("starts_at"),
    sb.from("event_team").select("team_member_id, part").eq("event_id", id),
    sb.from("team_members").select("*").eq("active", true).order("sort"),
    eventMaterials(sb, id),
    isPrivate ? sb.from("event_collaborators").select("email, created_at").eq("event_id", id).order("created_at") : Promise.resolve({ data: [] }),
    isPrivate ? sb.rpc("event_creator_email", { p_event: id }) : Promise.resolve({ data: null }),
  ]);
  const sections = [
    { id: "details", label: "Details" },
    ...(isPrivate ? [{ id: "collaborators", label: "Collaborators" }] : []),
    { id: "agenda", label: "Agenda" },
    { id: "team", label: "Kleros team" },
    { id: "materials", label: "Materials" },
  ];

  return (
    <div className="adm-editor">
      <div className="ed-head">
        <div className="wrap">
          <div className="ed-top">
            <div className="ed-title">
              <Link href={isTeam ? "/admin" : "/me"} className="small muted ed-back">← {isTeam ? "Events desk" : "My events"}</Link>
              <h1>{e.title}</h1>
              <div className="meta">
                <span>{fmtRange(e.starts_on, e.ends_on)}</span><span aria-hidden>·</span><span>{place(e)}</span>
                {isPrivate ? <span className="pill draft">Private</span> : e.status === "draft" ? <span className="pill plain">Draft</span> : <span className="pill live">Published</span>}
              </div>
            </div>
            <div className="ed-acts">
              <Link className="btn primary" href={`/events/${e.slug}/host`}>Run live</Link>
              <Link className="btn" href={`/events/${e.slug}`} target="_blank">{isPrivate ? "View event page ↗" : "View public page ↗"}</Link>
            </div>
          </div>
          <nav className="ed-anchors" aria-label="Sections">
            {sections.map((s) => <a key={s.id} href={`#${s.id}`}>{s.label}</a>)}
          </nav>
        </div>
      </div>

      <div className="wrap ed-body">
        <section id="details" className="ed-sec">
          <div className="ed-sec-h"><h2>Details</h2><p className="muted small">Title, dates, place, description and the recap shown after the event.</p></div>
          {/* keyed so a saved change (a new address, a switch) resets the form instead of keeping old values */}
          <EventForm key={`${e.slug}:${e.updated_at}`} event={e} me={{ isTeam, isAdmin, userId: user.id }} />
        </section>
        {isPrivate && (
          <section id="collaborators" className="ed-sec">
            <div className="ed-sec-h"><h2>Collaborators</h2><p className="muted small">Who besides the creator can see and edit this private event.</p></div>
            <CollaboratorsEditor eventId={id} creatorEmail={(creator.data as string | null) ?? null} initial={(collabs.data ?? []) as { email: string; created_at: string }[]} />
          </section>
        )}
        <section id="agenda" className="ed-sec">
          <div className="ed-sec-h"><h2>Agenda</h2><p className="muted small">Sessions in order. Kleros sessions are highlighted on the public page.</p></div>
          <AgendaEditor eventId={id} initial={(agenda.data ?? []) as AgendaItem[]} />
        </section>
        <section id="team" className="ed-sec">
          <div className="ed-sec-h"><h2>Kleros team</h2><p className="muted small">Who attends for Kleros. Visitors can ask to meet them.</p></div>
          <TeamPicker eventId={id} roster={(roster.data ?? []) as TeamMember[]} initial={team.data ?? []} />
        </section>
        <section id="materials" className="ed-sec">
          <div className="ed-sec-h"><h2>Materials</h2><p className="muted small">Talks, slides, recordings and links, listed on the event page and in the archive.</p></div>
          <MaterialsManager event={e} initial={materials} />
        </section>
      </div>
    </div>
  );
}
