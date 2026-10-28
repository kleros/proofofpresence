"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago } from "@/lib/useQuestions";

export type SyncLog = { ran_at: string; checked: number; updated: number; added: number; errors: string[] };

/** Luma and the socials feed keep the events in step every hour; this shows the last Luma run and lets the team run both now. */
export default function LumaSync({ last }: { last: SyncLog | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true);
    setMsg("");
    const sb = supabaseBrowser();
    const [luma, feed] = await Promise.all([sb.rpc("sync_luma"), sb.rpc("sync_feed")]);
    setBusy(false);
    if (luma.error || feed.error) return setMsg((luma.error ?? feed.error)!.message);
    const r = luma.data as { checked: number; updated: number; added: number };
    const f = feed.data as { applied: number; failed?: number; errors?: string[]; busy?: boolean };
    const socials = f.busy
      ? "The socials feed is already syncing."
      : f.errors?.length
        ? "The socials feed could not be read."
        : `${f.applied} new updates from socials${f.failed ? `, ${f.failed} not applied yet` : ""}.`;
    setMsg(`Checked ${r.checked} Luma events: ${r.updated} updated, ${r.added} added. ${socials}`);
    router.refresh();
  }

  return (
    <div className="luma-sync small">
      <span className="muted">
        {last
          ? `Luma and socials sync every hour. Last Luma run ${ago(last.ran_at)}: ${last.updated} updated, ${last.added} added${last.errors.length ? `, ${last.errors.length} not readable` : ""}.`
          : "Luma and socials sync every hour."}
      </span>
      <button className="btn sm" onClick={run} disabled={busy}>{busy ? "Syncing…" : "Sync now"}</button>
      {msg && <span role="status">{msg}</span>}
    </div>
  );
}
