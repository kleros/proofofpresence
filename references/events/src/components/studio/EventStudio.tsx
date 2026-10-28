"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgendaItem, Material } from "@/lib/types";
import Recorder, { type RecPhase, type RecTarget } from "../live/Recorder";
import AddMaterials from "../admin/AddMaterials";
import AttachSlides from "./AttachSlides";
import { STUDIO_EVENT, type StudioMode } from "./StudioButton";

const LOCKED: RecPhase[] = ["starting", "recording", "stopping", "review", "saving"];
const TABS: { id: StudioMode; label: string }[] = [
  { id: "record", label: "Record a session" },
  { id: "files", label: "Add files or links" },
  { id: "slides", label: "Attach slides to a recording" },
];
const free = (): RecTarget => ({ key: `free-${Date.now()}`, agendaId: null, title: "", speaker: "" });

/**
 * Team tools on the event page, inside the Talks section: record a session with the shared
 * recorder, add files or links, or attach slides to a recording saved without them. Closed
 * until a StudioButton (or #record in the address) opens it. Once opened it stays mounted and
 * is only hidden, so closing it or switching tabs never stops a recording.
 */
export default function EventStudio({ event, agenda, recordings, isTeam = true }: {
  event: { id: string; slug: string; title: string };
  agenda: AgendaItem[];
  recordings: Material[];
  /** false for a private event's collaborators outside the team: no automatic transcript */
  isTeam?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<StudioMode>("record");
  const [target, setTarget] = useState<RecTarget>(free);
  const [phase, setPhase] = useState<RecPhase>("idle");
  const [msg, setMsg] = useState("");
  const box = useRef<HTMLElement>(null);
  const locked = LOCKED.includes(phase);

  const show = useCallback((m: StudioMode) => {
    setOpen(true); setMounted(true); setTab(m); setMsg("");
    requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<StudioMode>).detail ?? "record");
    window.addEventListener(STUDIO_EVENT, on);
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (h === "record" || h === "add-files" || h === "attach-slides") show(h === "record" ? "record" : h === "add-files" ? "files" : "slides");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => { window.removeEventListener(STUDIO_EVENT, on); window.removeEventListener("hashchange", fromHash); };
  }, [show]);

  const onPhase = useCallback((p: RecPhase) => setPhase(p), []);
  const onDone = useCallback(() => setTarget(free()), []);
  const onSaved = useCallback(() => router.refresh(), [router]);

  function pickSession(id: string) {
    if (!id) { setTarget(free()); return; }
    const a = agenda.find((x) => x.id === id);
    if (a) setTarget({ key: a.id, agendaId: a.id, title: a.title, speaker: a.speaker ?? "", time: a.starts_at?.slice(0, 5) });
  }

  if (!mounted) return null;
  return (
    <section ref={box} className="studio" hidden={!open} aria-label="Team tools for this event">
      <div className="studio-h">
        <div className="studio-t">
          <span className="eyebrow">{isTeam ? "Team only" : "Event tools"}</span>
          <div className="seg studio-tabs" role="tablist" aria-label="Tool">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => { setTab(t.id); setMsg(""); }}>{t.label}</button>
            ))}
          </div>
        </div>
        <button className="btn ghost sm" onClick={() => setOpen(false)} disabled={locked}
          title={locked ? "Save or discard the recording first" : undefined}>Close</button>
      </div>

      <div hidden={tab !== "record"} className="studio-pane">
        <div className="studio-pick">
          <div className="field">
            <label htmlFor="st-session">Session</label>
            <select id="st-session" value={target.agendaId ?? ""} onChange={(e) => pickSession(e.target.value)} disabled={locked}>
              <option value="">Not on the agenda (type a title)</option>
              {agenda.map((a) => <option key={a.id} value={a.id}>{a.starts_at ? `${a.starts_at.slice(0, 5)} · ` : ""}{a.title}{a.speaker ? `, ${a.speaker}` : ""}</option>)}
            </select>
          </div>
          <p className="muted small">The saved recording is listed in Talks below{isTeam ? " and gets a transcript automatically" : ""}. For a full live setup with questions and the big screen, use Run this event.</p>
        </div>
        <Recorder eventId={event.id} slug={event.slug} eventTitle={event.title} target={target} onPhase={onPhase} onDone={onDone} onSaved={onSaved} autoTranscribe={isTeam} />
      </div>

      <div hidden={tab !== "files"} className="studio-pane">
        <p className="muted small">Slides, audio, video and documents are listed under Slides &amp; links (recordings and videos under Talks). Links can point to YouTube, an X post, Google Drive or any page.</p>
        <AddMaterials eventId={event.id} idPrefix="st" onAdded={() => router.refresh()} />
      </div>

      <div hidden={tab !== "slides"} className="studio-pane">
        <AttachSlides eventId={event.id} recordings={recordings} onSaved={(m) => { setMsg(m); router.refresh(); }} />
        {msg && <div className="ok" role="status">{msg}</div>}
      </div>
    </section>
  );
}
