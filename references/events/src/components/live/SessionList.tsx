"use client";
import { useEffect, useState } from "react";
import type { AgendaItem } from "@/lib/types";
import type { RecTarget } from "./Recorder";

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function SessionList({ eventId, agenda, isToday, activeKey, locked, onPick }: {
  eventId: string; agenda: AgendaItem[]; isToday: boolean; activeKey: string | null; locked: boolean;
  onPick: (t: RecTarget) => void;
}) {
  // "Now" marker: the last session whose start time has passed, on the day of the event
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toTimeString().slice(0, 5));
    tick();
    const t = setInterval(tick, 60000);
    return () => clearInterval(t);
  }, []);
  const timed = agenda.filter((a) => a.starts_at);
  const nowId = isToday && clock ? [...timed].reverse().find((a) => hhmm(a.starts_at) <= clock)?.id : undefined;

  const pick = (a: AgendaItem) => onPick({ key: a.id, agendaId: a.id, title: a.title, speaker: a.speaker ?? "", time: hhmm(a.starts_at) });

  return (
    <section className="con-panel sl" aria-labelledby="sl-h">
      <div className="con-panel-h">
        <h2 id="sl-h">Sessions</h2>
        {agenda.length > 0 && <span className="muted small">{agenda.length} on the agenda</span>}
      </div>

      {agenda.length ? (
        <ol className="sl-list">
          {agenda.map((a) => {
            const active = activeKey === a.id;
            return (
              <li key={a.id} className={`sl-item ${active ? "is-active" : ""} ${nowId === a.id ? "is-now" : ""}`}>
                <span className="sl-time mono">{hhmm(a.starts_at) || "--:--"}</span>
                <div className="sl-main">
                  <div className="sl-title">{a.title}{nowId === a.id && <span className="pill live sl-now">Now</span>}</div>
                  {a.speaker && <div className="sl-speaker">{a.speaker}</div>}
                  {active ? (
                    <span className="sl-sel">{locked ? "Recording this session" : "Selected for recording"}</span>
                  ) : (
                    <button className="btn sm sl-btn" onClick={() => pick(a)} disabled={locked} title={locked ? "Finish the current recording first" : undefined}>
                      <span className="dot" /> Record this session
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="empty con-empty">
          <b>No agenda yet</b>
          Add the sessions with times and speakers, and each one can be recorded with its title filled in.
          <div><a className="btn sm" href={`/admin/events/${eventId}`} style={{ marginTop: 12 }}>Add the agenda</a></div>
        </div>
      )}

      <button
        className={`btn sl-extra ${activeKey === "extra" ? "on" : ""}`}
        disabled={locked}
        onClick={() => onPick({ key: "extra", agendaId: null, title: "", speaker: "" })}
      >
        + Record a session not on the agenda
      </button>
    </section>
  );
}
