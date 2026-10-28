import type { Metadata } from "next";
import { listEvents, listMaterials, eventCounts, materialCounts } from "@/lib/data";
import EventBrowser, { type View, type When } from "@/components/EventBrowser";
import { isWatchable } from "@/components/MaterialRow";
import SetupNotice from "@/components/SetupNotice";
import { todayIso } from "@/lib/format";

export const metadata: Metadata = { title: "Events" };
export const revalidate = 60;

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ when?: string; view?: string }> }) {
  const [{ when, view }, events, materials, attendance] = await Promise.all([searchParams, listEvents(), listMaterials(), eventCounts()]);
  const { talks, items } = materialCounts(materials, isWatchable);
  const going = Object.fromEntries(Object.entries(attendance).map(([id, c]) => [id, c.going]));
  const initialWhen: When = when === "upcoming" || when === "past" ? when : "all";
  const initialView: View = view === "calendar" ? "calendar" : "list";
  return (
    <>
      <div className="page-band"><div className="wrap">
        <SetupNotice />
        <header className="page-head">
          <div className="eyebrow">Events</div>
          <h1>Where to find <em>Kleros</em></h1>
          <p className="lede">Conferences, meetups and workshops where Kleros hosts, speaks or has a booth, with the talks and slides from each one.</p>
        </header>
      </div></div>
      <div className="wrap page">
        <EventBrowser events={events} counts={{ talks, materials: items, going }} initialWhen={initialWhen} initialView={initialView} initialMonth={todayIso().slice(0, 7)} />
      </div>
    </>
  );
}
