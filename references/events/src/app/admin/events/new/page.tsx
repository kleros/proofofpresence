import Link from "next/link";
import { requireTeam } from "@/lib/admin";
import NotTeam from "@/components/NotTeam";
import EventForm from "@/components/admin/EventForm";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const { user, isTeam } = await requireTeam("/admin/events/new");
  if (!isTeam) return <NotTeam />;
  return (
    <div className="wrap page stack adm-page adm-narrow">
      <header className="adm-head">
        <div>
          <Link href="/admin" className="small muted ed-back">← Events desk</Link>
          <h1>Add an event</h1>
          <p className="muted">Public events can be saved as a draft to keep them off the site until ready. Private events are only for you and the collaborators you add. Agenda, team and materials can be added after saving.</p>
        </div>
      </header>
      <EventForm me={{ isTeam, userId: user.id }} />
    </div>
  );
}
