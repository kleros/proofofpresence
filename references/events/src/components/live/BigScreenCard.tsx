"use client";
import { useState } from "react";
import type { Question } from "@/lib/types";
import ScreenView, { shortUrl } from "./ScreenView";
import type { ScreenMode } from "./useScreenMode";

/** Preview of the projector and the join link. The mode switch lives in the console header. */
export default function BigScreenCard({ title, joinUrl, qr, mode, live, error, questions, fresh, approval, approvalSupported, onApproval }: {
  title: string; joinUrl: string; qr: string; mode: ScreenMode;
  live: boolean; error: string; questions: Question[]; fresh: Set<string>;
  /** the screen shows only questions a host approved; the switch shows once the database has it (0014) */
  approval: boolean; approvalSupported: boolean; onApproval: (on: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(joinUrl); }
    catch {
      const i = document.createElement("textarea"); i.value = joinUrl; document.body.appendChild(i); i.select();
      document.execCommand("copy"); i.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="con-panel bs" aria-labelledby="bs-h">
      <div className="con-panel-h">
        <h2 id="bs-h">Big screen</h2>
        <span className={`con-live ${live ? "" : "off"}`} title={live ? "The screen follows changes instantly" : "Live updates paused; the screen checks every 15 seconds"}>
          <span className="pip" />{live ? "Synced" : "Reconnecting"}
        </span>
      </div>

      <div className="bs-preview" aria-label="Preview of the big screen">
        <ScreenView preview title={title} joinUrl={joinUrl} qr={qr} mode={mode} questions={questions} fresh={fresh} />
      </div>

      <p className="muted small bs-help">The Open big screen button at the top opens this view in a new window. Drag it to the projector, then double-click it for full screen.</p>

      {approvalSupported && <label className="bs-approval">
        <input type="checkbox" checked={approval} onChange={(e) => onApproval(e.target.checked)} />
        <span>
          <b>Only approved questions on the big screen</b>
          <span className="muted small">{approval
            ? "Only questions a host approved go on the big screen. Questions from this event's hosts, and any question put on the big screen, count as approved. Phones and the event page still show every question as soon as it is sent; use Hide to remove one."
            : "Every open question can appear on the big screen as soon as it is sent."}</span>
        </span>
      </label>}

      <div className="bs-join">
        <span className="lbl">Join link for phones</span>
        <div className="bs-join-row">
          <a className="mono bs-url" href={joinUrl} target="_blank" rel="noopener">{shortUrl(joinUrl)}</a>
          <button className="btn sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </div>
      </div>

      {error && <div className="note" role="alert">{error}</div>}
    </section>
  );
}
