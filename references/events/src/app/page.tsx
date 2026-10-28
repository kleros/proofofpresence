import Link from "next/link";
import { listEvents, listMaterials, eventCounts, eventIdsOf, materialCounts } from "@/lib/data";
import { fmtRange, isLive, isPast, newestFirst, place, soonestFirst } from "@/lib/format";
import { LUMA_URL } from "@/lib/kleros";
import EventCard, { EventCover, RolePill, statusLabel } from "@/components/EventCard";
import { TalkCard, isWatchable } from "@/components/MaterialRow";
import PromoStrip from "@/components/PromoStrip";
import SetupNotice from "@/components/SetupNotice";

export const revalidate = 60;

export default async function Home() {
  const [events, materials, counts] = await Promise.all([listEvents(), listMaterials(), eventCounts()]);
  const upcoming = events.filter((e) => !isPast(e)).sort(soonestFirst);
  const next = upcoming[0];
  const later = upcoming.slice(1, 4);
  const recent = events.filter(isPast).sort(newestFirst).slice(0, 3);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  // Talks from events the visitor can see, newest event first.
  // A talk linked to several events shows with the newest one the visitor can see.
  const shownWith = (m: (typeof materials)[number]) => eventIdsOf(m).map((id) => byId[id]).filter(Boolean).sort(newestFirst)[0];
  const talks = materials.filter((m) => isWatchable(m) && shownWith(m))
    .sort((a, b) => newestFirst(shownWith(a), shownWith(b)) || b.created_at.localeCompare(a.created_at));
  const perEvent = materialCounts(materials, isWatchable);
  const talkCount = (id: string) => perEvent.talks[id] ?? 0;
  const itemCount = (id: string) => perEvent.items[id] ?? 0;
  const cities = new Set(events.filter((e) => e.city).map((e) => e.city)).size;
  const nextStatus = next && statusLabel(next);

  return (
    <>
      <div className="hero-band">
        <div className="wrap hero">
          <div className="hero-copy">
            <SetupNotice />
            <div className="eyebrow">Kleros on stage and on the road</div>
            <h1 className="hero-title">Where Kleros shows up, <em>and what was said there.</em></h1>
            <p className="lede">The events Kleros hosts, sponsors and speaks at. Find the next one, rewatch past talks with their slides, ask the speakers questions and meet the team.</p>
            <div className="row-flex actions">
              <a className="btn cta" href={LUMA_URL} target="_blank" rel="noopener">Follow Kleros on Luma ↗</a>
              <Link className="btn" href="/talks">Watch the talks</Link>
            </div>
            {events.length > 0 && (
              <dl className="stats">
                <div className="stat"><dt>upcoming</dt><dd>{upcoming.length}</dd></div>
                <div className="stat"><dt>events on record</dt><dd>{events.length}</dd></div>
                <div className="stat"><dt>recorded talks</dt><dd>{talks.length}</dd></div>
                {cities > 0 && <div className="stat"><dt>cities</dt><dd>{cities}</dd></div>}
              </dl>
            )}
          </div>
          {next && (
            <Link className="feature" href={`/events/${next.slug}`}>
              <EventCover e={next} />
              <span className="feature-body">
                <span className="eyebrow accent">{isLive(next) ? "Happening now" : "Next up"}</span>
                <h2>{next.title}</h2>
                <span className="when">{fmtRange(next.starts_on, next.ends_on)}{next.start_time ? ` · ${next.start_time.slice(0, 5)}` : ""} · {place(next)}</span>
                <span className="meta">
                  <RolePill e={next} />
                  <span className="pill plain">{next.event_type}</span>
                  {nextStatus && nextStatus.cls !== "live" && <span className={`pill ${nextStatus.cls}`}>{nextStatus.text}</span>}
                </span>
                <span className="feature-go">See the event →</span>
              </span>
            </Link>
          )}
        </div>
      </div>

      <div className="wrap">
        <PromoStrip />

        {later.length > 0 && (
          <section className="block">
            <div className="section-h"><h2>Coming up</h2><Link href="/events?when=upcoming">All upcoming →</Link></div>
            <div className="grid">{later.map((e) => <EventCard key={e.id} e={e} talks={talkCount(e.id)} materials={itemCount(e.id)} going={counts[e.id]?.going} />)}</div>
          </section>
        )}
        {!upcoming.length && (
          <section className="block">
            <div className="section-h"><h2>Coming up</h2></div>
            <p className="quiet-empty">No upcoming events announced yet. New ones are posted on <a href={LUMA_URL} target="_blank" rel="noopener">Luma</a> first.</p>
          </section>
        )}

        <section className="block">
          <div className="section-h"><h2>Latest talks</h2>{talks.length > 0 && <Link href="/talks">Talk archive →</Link>}</div>
          {talks.length
            ? <div className="grid">{talks.slice(0, 3).map((m) => <TalkCard key={m.id} m={m} event={shownWith(m)} />)}</div>
            : <p className="quiet-empty">Talks appear here with their slides once the team uploads them after an event.</p>}
        </section>

        {recent.length > 0 && (
          <section className="block">
            <div className="section-h"><h2>Recently</h2><Link href="/events?when=past">All past events →</Link></div>
            <div className="grid">{recent.map((e) => <EventCard key={e.id} e={e} talks={talkCount(e.id)} materials={itemCount(e.id)} />)}</div>
          </section>
        )}
      </div>
    </>
  );
}
