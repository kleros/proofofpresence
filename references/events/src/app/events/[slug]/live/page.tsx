import { redirect } from "next/navigation";

// The old combined "event mode" page now lives in two places: the host console for the
// team, and /screen for the projector.
export default async function LivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/events/${slug}/host`);
}
