import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvent, eventCounts } from "@/lib/data";
import { fmtRange, isPast, place } from "@/lib/format";
import { ROLE_LABEL, productsFor } from "@/lib/kleros";
import { EventCover, RolePill, statusLabel } from "@/components/EventCard";
import MaterialRow, { MATERIAL_GROUPS, TalkCard, isTalkLike, linkUrl } from "@/components/MaterialRow";
import AttendanceButtons from "@/components/AttendanceButtons";
import AskTheSpeaker from "@/components/AskTheSpeaker";
import MeetingForm from "@/components/MeetingForm";
import { currentUser } from "@/lib/supabase/server";
import EventStudio from "@/components/studio/EventStudio";
import StudioButton from "@/components/studio/StudioButton";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await getEvent(slug);
  // a signed-out visitor gets a sign-in page here rather than a 404, which search engines must not keep
  if (!data) return { title: "Event not found", robots: { index: false } };
  const e = data.event;
  return { title: e.title, description: `${ROLE_LABEL[e.kleros_role]} · ${fmtRange(e.starts_on, e.ends_on)} · ${place(e)}. ${e.description ?? ""}`.slice(0, 200) };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [data, counts, { user, profile }] = await Promise.all([getEvent(slug), eventCounts(), currentUser()]);
  if (!data) {
    // a private event is only readable once signed in with an invited email; the same page shows for
    // every unknown address, so it says nothing about whether this one exists
    if (!user) return (
      <div className="wrap page con-gate">
        <div className="eyebrow">Event</div>
        <h1>Sign in to open this event</h1>
        <p className="muted">This event was not found. If it is a private event that was shared with you, sign in with the email address it was shared with.</p>
        <div className="row-flex">
          <Link className="btn primary" href={`/login?next=${encodeURIComponent(`/events/${slug}`)}`}>Sign in</Link>
          <Link className="btn" href="/events">All events</Link>
        </div>
      </div>
    );
    notFound();
  }
  const { event: e, agenda, team, materials } = data;
  const past = isPast(e);
  const isTeam = !!profile?.is_team;
  // a private event only reaches this page for its creator and collaborators, who may edit it
  const canEdit = isTeam || (!!user && e.visibility === "private");
  const status = statusLabel(e);
  // talks with slides, videos, and recordings (audio files) are all listed under Talks
  const talks = materials.filter(isTalkLike);
  const groups = MATERIAL_GROUPS.map((g) => ({ ...g, items: materials.filter((m) => g.kinds.includes(m.kind) && !isTalkLike(m)) })).filter((g) => g.items.length);
  // recordings saved without slides, for "Attach slides to a recording"
  const bareRecordings = materials.filter((m) => m.kind === "audio" && !!m.file_path);
  const otherCount = groups.reduce((s, g) => s + g.items.length, 0);
  const c = counts[e.id] ?? { going: 0, attended: 0 };
  const products = productsFor(e.topics);
  const booker = team.map((t) => t.team_members).find((m) => m?.calendar_url);
  const time = e.start_time ? `${e.start_time.slice(0, 5)}${e.timezone ? ` ${e.timezone}` : ""}` : "";
  const where = [e.venue, place(e)].filter(Boolean).join(", ");
  const hasAbout = !!(e.description || e.recap);
  const ticketLabel = e.url && /luma\.com|lu\.ma/.test(e.url) ? "RSVP on Luma" : "Get tickets";

  const stats = ([
    past ? [c.attended, "attended"] : [c.going, "going"],
    [talks.length, talks.length === 1 ? "talk" : "talks"],
    [otherCount, otherCount === 1 ? "file or link" : "files and links"],
    [agenda.length, agenda.length === 1 ? "agenda item" : "agenda items"],
    [team.length, "from Kleros"],
  ] as [number, string][]).filter(([n]) => n > 0).slice(0, 3);

  const sections = [
    hasAbout && ["about", "About"],
    (talks.length > 0 || canEdit) && ["talks", talks.length ? `Talks (${talks.length})` : "Talks"],
    otherCount > 0 && ["materials", `Slides & links (${otherCount})`],
    agenda.length > 0 && ["agenda", "Agenda"],
    team.length > 0 && ["team", "Kleros team"],
    ["ask", "Ask the speaker"],
    ["meet", "Meet Kleros"],
  ].filter(Boolean) as [string, string][];

  return (
    <>
    <div className="ev-band">
      <header className="wrap ev-head">
        <div className="ev-title">
          <Link className="back" href="/events">← All events</Link>
          <div className="meta">
            <RolePill e={e} />
            <span className="pill plain">{e.event_type}</span>
            {status ? <span className={`pill ${status.cls}`}>{status.text}</span> : past ? <span className="pill plain">Ended</span> : null}
          </div>
          <h1>{e.title}</h1>
          <div className="when-where">
            <span>{fmtRange(e.starts_on, e.ends_on)}{time && ` · ${time}`}</span>
            <span>{where}</span>
          </div>
          {(e.url && !past) || canEdit ? (
            <div className="row-flex">
              {e.url && !past && <a className="btn cta" href={e.url} target="_blank" rel="noopener">{ticketLabel} ↗</a>}
              {canEdit && <Link className="btn" href={`/events/${e.slug}/host`}>Run this event</Link>}
              {canEdit && <StudioButton mode="record" className="btn"><span className="dot" aria-hidden /> Record a session</StudioButton>}
              {canEdit && <Link className="btn ghost" href={`/admin/events/${e.id}`}>Edit</Link>}
            </div>
          ) : null}
          {e.visibility === "private"
            ? <div className="note">Private. Only its creator and the collaborators they added can see this event, its materials and its questions.</div>
            : e.status === "draft" && <div className="note">Draft. Only the Kleros team can see this event until it is published.</div>}
        </div>
        <EventCover e={e} className="ev-cover" />
      </header>
    </div>
    <div className="wrap">
      <nav className="anchors" aria-label="On this page">
        {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      <div className="detail">
        <div className="sections">
          {hasAbout && (
            <section id="about" className="sec">
              <h2>About</h2>
              {e.recap && (
                <div className="recap">
                  <div className="eyebrow">Recap</div>
                  <p className="desc">{e.recap}</p>
                </div>
              )}
              {e.description && <p className="desc">{e.description}</p>}
            </section>
          )}

          {(talks.length > 0 || canEdit) && (
            <section id="talks" className="sec">
              <h2>Talks</h2>
              {canEdit && (
                <div className="sec-tools" aria-label="Team tools">
                  <StudioButton mode="record" className="btn sm primary"><span className="dot" aria-hidden /> Record a session</StudioButton>
                  <StudioButton mode="files" className="btn sm">Add files or links</StudioButton>
                  {bareRecordings.length > 0 && <StudioButton mode="slides" className="btn sm">Attach slides to a recording</StudioButton>}
                  {isTeam && <Link className="btn sm ghost" href="/admin/recordings">Recordings library</Link>}
                </div>
              )}
              {canEdit && <EventStudio event={{ id: e.id, slug: e.slug, title: e.title }} agenda={agenda} recordings={bareRecordings} isTeam={isTeam} />}
              {talks.length > 0
                ? <div className="grid two-up">{talks.map((m) => <TalkCard key={m.id} m={m} event={e} />)}</div>
                : <p className="quiet-empty">No talks yet. Record a session here, or add a recording or video link.</p>}
            </section>
          )}

          {groups.length > 0 && (
            <section id="materials" className="sec">
              <h2>Slides &amp; links</h2>
              {groups.map((g) => (
                <div key={g.label} className="mgroup">
                  <h3 className="sub-h">{g.label}</h3>
                  <div className="lib">{g.items.map((m) => <MaterialRow key={m.id} m={m} />)}</div>
                </div>
              ))}
            </section>
          )}

          {agenda.length > 0 && (
            <section id="agenda" className="sec">
              <h2>Agenda</h2>
              <div className="agenda">
                {agenda.map((a) => (
                  <div key={a.id} className="ag">
                    <span className="tm">{a.starts_at?.slice(0, 5)}</span>
                    <div>
                      <div className={a.is_kleros ? "k" : ""} style={{ fontWeight: 600 }}>{a.title}{a.is_kleros && " · Kleros"}</div>
                      {a.speaker && <div className="muted small">{a.speaker}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {team.length > 0 && (
            <section id="team" className="sec">
              <h2>Kleros team</h2>
              <p className="muted small">{past ? "Who was there for Kleros." : "Who will be there for Kleros."}</p>
              <div className="team">
                {team.filter((t) => t.team_members).map(({ team_members: m, part }) => (
                  <div key={m.id} className="person">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <span className="av">{m.avatar_url ? <img src={linkUrl(m.avatar_url)} alt="" /> : m.name[0]}</span>
                    <span className="who">
                      <b>{m.name}</b>
                      {(part || m.title) && <span className="muted">{part || m.title}</span>}
                    </span>
                    {m.x_handle && <a className="x" href={`https://x.com/${m.x_handle.replace(/^@/, "")}`} target="_blank" rel="noopener">@{m.x_handle.replace(/^@/, "")}</a>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section id="ask" className="sec">
            <h2>Ask the speaker</h2>
            <AskTheSpeaker eventId={e.id} signedIn={!!user} isTeam={canEdit} displayName={profile?.display_name ?? ""} slug={e.slug} />
          </section>

          <section id="meet" className="sec">
            <h2>Meet Kleros</h2>
            <div className="panel meet">
              <p>{past
                ? "Missed the team at this one? Send a request anyway. The team follows up on every one."
                : "Book time with the team to talk about integrating Kleros, becoming a juror, or partnering."}</p>
              <div className="row-flex">
                {booker?.calendar_url && <a className="btn sm primary" href={booker.calendar_url} target="_blank" rel="noopener">Pick a time with {booker.name.split(" ")[0]} ↗</a>}
              </div>
              {/* requests are read by the whole team, so none from a private event's page */}
              {e.visibility !== "private" && <MeetingForm eventId={e.id} />}
            </div>
            <div className="prods">
              {products.map((p) => (
                <a key={p.name} className="prod" href={p.url} target="_blank" rel="noopener">
                  <b>{p.name}</b>
                  <span className="muted small">{p.pitch}</span>
                  <span className="small">{p.cta} ↗</span>
                </a>
              ))}
            </div>
          </section>
        </div>

        <aside className="side">
          <div className="panel">
            {stats.length > 0 && (
              <div className="counts">
                {stats.map(([n, label]) => <div key={label}><b>{n}</b><span>{label}</span></div>)}
              </div>
            )}
            <AttendanceButtons eventId={e.id} past={past} signedIn={!!user} slug={e.slug} />
            <dl className="kv">
              {e.organizer && <><dt>Organiser</dt><dd>{e.organizer}</dd></>}
              <dt>Format</dt><dd>{e.event_type}</dd>
              {e.topics.length > 0 && <><dt>Topics</dt><dd>{e.topics.join(", ")}</dd></>}
              <dt>Kleros</dt><dd>{ROLE_LABEL[e.kleros_role]}</dd>
              {past && e.url && <><dt>Event page</dt><dd><a href={e.url} target="_blank" rel="noopener">Open ↗</a></dd></>}
            </dl>
          </div>
        </aside>
      </div>
    </div>
    </>
  );
}
