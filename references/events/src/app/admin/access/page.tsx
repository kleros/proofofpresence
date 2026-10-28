import type { Metadata } from "next";
import { requireTeam } from "@/lib/admin";
import { supabaseServer } from "@/lib/supabase/server";
import NotTeam from "@/components/NotTeam";
import AccessManager, { type AccessRow } from "@/components/admin/AccessManager";

export const metadata: Metadata = { title: "Access" };
export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const { user, isTeam, isAdmin } = await requireTeam("/admin/access");
  if (!isTeam) return <NotTeam />;

  const head = (
    <header className="adm-head">
      <div>
        <h1>Access</h1>
        <p className="muted">Anyone signing in with a confirmed @kleros.io email gets team access: they can create events and run them from the host console. Admins can give access to other people by email or remove it. Wei Wei is the master admin.</p>
      </div>
    </header>
  );

  if (!isAdmin) {
    return (
      <div className="wrap page stack adm-page adm-narrow">
        {head}
        <div className="panel"><p className="muted" style={{ margin: 0 }}>Only admins can add or remove people. Send the email address to Wei Wei, the master admin.</p></div>
      </div>
    );
  }

  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("team_directory");
  return (
    <div className="wrap page stack adm-page adm-narrow">
      {head}
      {error
        ? <div className="note">The access list could not load ({error.message}). The 0003_access migration may not be applied yet.</div>
        : <AccessManager rows={(data ?? []) as AccessRow[]} myId={user.id} />}
    </div>
  );
}
