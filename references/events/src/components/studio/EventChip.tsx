import Link from "next/link";
import { fmtRange } from "@/lib/format";
import type { EventRow } from "@/lib/types";

/** A small linked-event chip: title, date, and Private or Draft when it is one. */
export default function EventChip({ e, children }: {
  e: Pick<EventRow, "slug" | "title" | "starts_on" | "status"> & { visibility?: EventRow["visibility"] }; children?: React.ReactNode;
}) {
  return (
    <span className="ev-chip">
      <Link href={`/events/${e.slug}`}>{e.title}<span className="muted"> · {fmtRange(e.starts_on)}</span></Link>
      {e.visibility === "private" ? <span className="pill draft">Private</span> : e.status === "draft" && <span className="pill draft">Draft</span>}
      {children}
    </span>
  );
}
