import { getEvent } from "@/lib/data";
import { endOf, place } from "@/lib/format";
import { ROLE_LABEL, SITE_URL } from "@/lib/kleros";

const esc = (s: string) => s.replace(/[\\,;]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
const plusDay = (d: string) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getEvent(slug);
  if (!data) return new Response("Not found", { status: 404 });
  const e = data.event;
  const url = `${SITE_URL}/events/${e.slug}`;
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kleros Events//EN",
    "BEGIN:VEVENT",
    `UID:${e.id}@kleros-events`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${e.starts_on.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${plusDay(endOf(e)).replace(/-/g, "")}`,
    `SUMMARY:${esc(e.title)}`,
    `LOCATION:${esc([e.venue, place(e)].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${esc(`${ROLE_LABEL[e.kleros_role]}${e.start_time ? " · starts " + e.start_time.slice(0, 5) : ""}\n${e.description ?? ""}\n${url}`)}`,
    `URL:${url}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${e.slug}.ics"` } });
}
