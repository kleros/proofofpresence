import type { Metadata } from "next";
import { currentUser } from "@/lib/supabase/server";
import AdminNav from "@/components/admin/AdminNav";

export const metadata: Metadata = { title: "Team desk" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await currentUser();
  const isAdmin = !!profile?.is_admin;
  const isTeam = isAdmin || !!profile?.is_team;
  return (
    <>
      {isTeam && <AdminNav isAdmin={isAdmin} />}
      {children}
    </>
  );
}
