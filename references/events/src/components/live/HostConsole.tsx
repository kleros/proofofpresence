"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgendaItem } from "@/lib/types";
import { screenOk, useQuestions } from "@/lib/useQuestions";
import BigScreenCard from "./BigScreenCard";
import QuestionsPanel from "./QuestionsPanel";
import Recorder, { type RecPhase, type RecTarget } from "./Recorder";
import { useQr } from "./ScreenView";
import { useFresh } from "./ScreenPage";
import SessionList from "./SessionList";
import { SCREEN_MODES, useScreenMode } from "./useScreenMode";

const LOCKED: RecPhase[] = ["starting", "recording", "stopping", "review", "saving"];

export default function HostConsole({ event, agenda, joinUrl, isTeam = true }: {
  event: { id: string; slug: string; title: string; starts_on: string; ends_on: string | null; venue: string | null; city: string | null; status?: "draft" | "published"; visibility?: "public" | "private" };
  agenda: AgendaItem[];
  joinUrl: string;
  /** false for a private event's collaborators outside the team: no automatic transcript */
  isTeam?: boolean;
}) {
  const { questions, loaded, live, error, reload } = useQuestions(event.id, { quick: true });
  const screen = useScreenMode(event.id, reload);
  const qr = useQr(joinUrl);
  const fresh = useFresh(loaded ? questions.filter(screenOk).map((q) => q.id) : null);
  const [target, setTarget] = useState<RecTarget | null>(null);
  const [phase, setPhase] = useState<RecPhase>("idle");
  const [recTitle, setRecTitle] = useState("");
  const [isToday, setIsToday] = useState(false);

  const autoPicked = useRef(false);

  useEffect(() => {
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const onDay = event.starts_on <= today && (event.ends_on ?? event.starts_on) >= today;
    setIsToday(onDay);
    // On the day, open the recorder on the session running now (the last one that has started),
    // or the next one if none has started yet, so the Start recording button is right there.
    if (!onDay || autoPicked.current) return;
    autoPicked.current = true;
    const clock = d.toTimeString().slice(0, 5);
    const timed = agenda.filter((a) => a.starts_at);
    const pick = [...timed].reverse().find((a) => a.starts_at!.slice(0, 5) <= clock) ?? timed[0];
    if (pick) setTarget((t) => t ?? { key: pick.id, agendaId: pick.id, title: pick.title, speaker: pick.speaker ?? "", time: pick.starts_at!.slice(0, 5) });
  }, [event.starts_on, event.ends_on, agenda]);

  const onPhase = useCallback((p: RecPhase, t?: string) => { setPhase(p); setRecTitle(t ?? ""); }, []);
  const onDone = useCallback(() => setTarget(null), []);
  const locked = LOCKED.includes(phase);

  const open = questions.filter((q) => q.status === "open").length;
  const answered = questions.filter((q) => q.status === "answered").length;
  const votes = questions.filter((q) => q.status !== "hidden").reduce((n, q) => n + q.votes, 0);
  const when = new Date(event.starts_on + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const recording = phase === "recording" || phase === "stopping";

  return (
    <div className="console">
      <header className="con-top">
        <a className="con-back" href={`/events/${event.slug}`} aria-label="Back to the event page">‹</a>
        <div className="con-heading">
          <div className="eyebrow">Host console</div>
          <h1 className="con-h1">{event.title}</h1>
          <div className="muted small">{[when, event.venue, event.city].filter(Boolean).join(" · ")}</div>
          {event.visibility === "private" ? (
            <div className="note" role="status" style={{ marginTop: 8 }}>This event is private. The phone and big screen pages open only for its creator and collaborators, signed in; guests scanning the QR code cannot ask questions.</div>
          ) : event.status === "draft" && (
            <div className="note" role="status" style={{ marginTop: 8 }}>This event is a draft. The phone and big screen pages still work.</div>
          )}
        </div>
        {recording && <span className="con-rec" title={recTitle}><span className="dot" /> Recording</span>}
        {phase === "review" && <span className="con-unsaved">Recording not saved</span>}
        <div className="con-screen" role="group" aria-label="What the big screen shows">
          <span className="con-screen-l">Big screen</span>
          <div className="seg">
            {SCREEN_MODES.map((m) => <button key={m.id} aria-pressed={screen.mode === m.id} onClick={() => screen.setMode(m.id)}>{m.label}</button>)}
          </div>
        </div>
        <div className="con-stats" aria-label="Live counts">
          <span className="con-stat"><b>{open}</b> open</span>
          <span className="con-stat"><b>{answered}</b> answered</span>
          <span className="con-stat"><b>{votes}</b> votes</span>
        </div>
        <a className="btn con-open" href={`/events/${event.slug}/screen`} target={`kleros-screen-${event.slug}`} rel="noopener"
          title="Opens a window for the projector. Drag it there, then double-click it for full screen.">Open big screen ↗</a>
      </header>

      <div className="con-grid">
        <div className="con-col con-left">
          <SessionList eventId={event.id} agenda={agenda} isToday={isToday} activeKey={target?.key ?? null} locked={locked} onPick={setTarget} />
        </div>
        <div className="con-col con-center">
          <Recorder eventId={event.id} slug={event.slug} eventTitle={event.title} target={target} onPhase={onPhase} onDone={onDone} autoTranscribe={isTeam} />
          <BigScreenCard title={event.title} joinUrl={joinUrl} qr={qr} mode={screen.mode}
            live={screen.live} error={screen.error} questions={questions} fresh={fresh}
            approval={screen.approval} approvalSupported={screen.approvalSupported} onApproval={screen.setApproval} />
        </div>
        <div className="con-col con-right">
          <QuestionsPanel eventId={event.id} questions={questions} loaded={loaded} live={live} error={error} reload={reload}
            onFeatured={() => { if (screen.mode !== "questions") screen.setMode("questions"); }} approval={screen.approval} />
        </div>
      </div>
    </div>
  );
}
