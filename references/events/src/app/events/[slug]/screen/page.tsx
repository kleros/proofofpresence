import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLiveEvent } from "@/lib/data";
import { SITE_URL } from "@/lib/kleros";
import ScreenPage from "@/components/live/ScreenPage";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const ev = await getLiveEvent((await params).slug);
  return { title: ev ? `Big screen · ${ev.title}` : "Big screen", robots: { index: false } };
}

export default async function BigScreen({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // drafts too: guests and the projector use these pages before an event is published
  const ev = await getLiveEvent(slug);
  if (!ev) notFound();
  return <ScreenPage eventId={ev.id} title={ev.title} joinUrl={`${SITE_URL}/q/${slug}`} />;
}
