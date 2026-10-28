import Link from "next/link";
import type { EventRow } from "@/lib/types";
import { KLEROS_HOSTED, ROLE_LABEL } from "@/lib/kleros";
import { fmtRange, isLive, plural, place } from "@/lib/format";
import { fileUrl } from "./MaterialRow";
import Thumb from "./Thumb";
import GenCover from "./Cover";

/** One quiet status label at most: private beats draft beats live beats example. */
export function statusLabel(e: Pick<EventRow, "status" | "starts_on" | "ends_on" | "is_example"> & { visibility?: EventRow["visibility"] }) {
  if (e.visibility === "private") return { cls: "draft", text: "Private" };
  if (e.status === "draft") return { cls: "draft", text: "Draft" };
  if (isLive(e)) return { cls: "live", text: "Happening now" };
  if (e.is_example) return { cls: "ex", text: "Example" };
  return null;
}

/** Kleros's part in the event, coloured: violet when Kleros runs it, cyan when it takes part. */
export function RolePill({ e }: { e: Pick<EventRow, "kleros_role"> }) {
  return <span className={`pill ${KLEROS_HOSTED.includes(e.kleros_role) ? "host" : "part"}`}>{ROLE_LABEL[e.kleros_role]}</span>;
}

/** Date tile: day number over the short month. */
export function DateTile({ iso }: { iso: string }) {
  const d = new Date(iso + "T12:00:00");
  return (
    <span className="date-tile" aria-hidden>
      <b>{d.getDate()}</b>
      <span>{d.toLocaleDateString("en-GB", { month: "short" })}</span>
    </span>
  );
}

/** The visual top of an event: its Luma cover, or a generated one with the city. */
export function EventCover({ e, className = "" }: { e: EventRow; className?: string }) {
  const gen = <GenCover seed={e.slug} big={e.city || "Online"} small={e.event_type} />;
  return (
    <span className={`cover ${className}`}>
      {e.cover_path ? <Thumb src={fileUrl(e.cover_path)} contain fallback={gen} /> : gen}
    </span>
  );
}

export default function EventCard({ e, talks = 0, materials = 0, going = 0, why, mine }: {
  e: EventRow; talks?: number; materials?: number; going?: number; why?: string; mine?: string;
}) {
  const status = statusLabel(e);
  const count = talks ? plural(talks, "talk") : materials ? plural(materials, "item") : going ? `${going} going` : "";
  return (
    <Link className="card ev" href={`/events/${e.slug}`}>
      <span className="cover-wrap">
        <EventCover e={e} />
        <span className="on-cover oc-tl"><DateTile iso={e.starts_on} /></span>
        {status && <span className={`pill ${status.cls} on-cover oc-tr`}>{status.text}</span>}
      </span>
      <span className="body">
        <span className="date">{fmtRange(e.starts_on, e.ends_on)}</span>
        <h3>{e.title}</h3>
        <span className="meta"><RolePill e={e} /><span className="pill plain">{e.event_type}</span></span>
        {e.description && <span className="desc-clamp">{e.description}</span>}
        {why && <span className="why">{why}</span>}
        {mine && <span className="why">{mine}</span>}
        <span className="foot">
          <span>{place(e)}</span>
          {count && <span className="mono">{count}</span>}
        </span>
      </span>
    </Link>
  );
}

