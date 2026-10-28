import type { Metadata } from "next";
import { requireTeam } from "@/lib/admin";
import NotTeam from "@/components/NotTeam";
import AdminNav from "@/components/admin/AdminNav";
import RecordStudio from "@/components/studio/RecordStudio";

export const metadata: Metadata = { title: "Record", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function RecordPage() {
  const { isTeam, isAdmin } = await requireTeam("/record");
  if (!isTeam) return <NotTeam />;
  return (
    <>
      <AdminNav isAdmin={isAdmin} />
      <RecordStudio />
    </>
  );
}
