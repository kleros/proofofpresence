import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLiveEvent } from "@/lib/data";
import QuickAsk from "@/components/QuickAsk";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const ev = await getLiveEvent((await params).slug);
  return { title: ev ? `Ask · ${ev.title}` : "Ask a question" };
}

export default async function AskPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // drafts too: guests and the projector use these pages before an event is published
  const ev = await getLiveEvent(slug);
  if (!ev) notFound();
  return <QuickAsk eventId={ev.id} title={ev.title} slug={slug} />;
}
