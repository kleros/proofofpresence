import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvent } from "@/lib/data";
import { SITE_URL } from "@/lib/kleros";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import HostConsole from "@/components/live/HostConsole";

export const metadata: Metadata = { title: "Host console", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function HostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, profile } = await currentUser();
  const next = encodeURIComponent(`/events/${slug}/host`);
  // the team runs public events; a private event's creator and collaborators run it
  const data = user ? await getEvent(slug) : null;
  if (user && !data) notFound();
  const canRun = !!data && !!(await (await supabaseServer()).rpc("can_edit_event", { p_event: data.event.id })).data;

  if (!user || !data || !canRun) {
    return (
      <div className="wrap page con-gate">
        <div className="eyebrow">Host console</div>
        <h1>Event admins only</h1>
        {user ? (
          <p className="muted">This account is signed in but is not on the Kleros team, so it cannot run events. Team accounts use an @kleros.io email. If this is a mistake, ask an admin to add the account to the team.</p>
        ) : (
          <p className="muted">The host console records sessions and moderates questions. Sign in with a Kleros team account, or, for a private event, with the email address its creator added.</p>
        )}
        <div className="row-flex">
          {!user && <Link className="btn primary" href={`/login?next=${next}`}>Sign in</Link>}
          <Link className="btn" href={`/events/${slug}`}>Back to the event</Link>
        </div>
      </div>
    );
  }

  const { event, agenda } = data;
  return (
    <HostConsole
      event={{ id: event.id, slug: event.slug, title: event.title, starts_on: event.starts_on, ends_on: event.ends_on, venue: event.venue, city: event.city, status: event.status, visibility: event.visibility }}
      agenda={agenda}
      joinUrl={`${SITE_URL}/q/${slug}`}
      isTeam={!!profile?.is_team}
    />
  );
}
