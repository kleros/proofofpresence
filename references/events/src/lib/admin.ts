import { redirect } from "next/navigation";
import { currentUser } from "./supabase/server";

/**
 * Team desk gate. Signed-out visitors (and anonymous QR guests) go to the login page.
 * isTeam: may use /admin. isAdmin: master admin, may grant or block access.
 */
export async function requireTeam(next = "/admin") {
  const { user, profile } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const isAdmin = !!profile?.is_admin;
  return { user, profile, isTeam: isAdmin || !!profile?.is_team, isAdmin };
}

/** For admin-only pages: team members who are not admins go back to the desk. */
export async function requireAdmin(next = "/admin") {
  const ctx = await requireTeam(next);
  if (!ctx.isAdmin) redirect("/admin");
  return ctx;
}
