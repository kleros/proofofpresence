"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SlideMark } from "@/lib/types";
import type { PdfDoc } from "@/lib/pdf";
import { fmtDur } from "@/lib/format";
import { emitTime, onSeek } from "@/lib/transcript/client";
import { retryMedia, trackPlaying } from "@/lib/mediaRetry";

/**
 * Slides + audio, kept in step by slide-change marks.
 * - play:   listen back; the slide follows the audio, clicking a slide seeks.
 * - record: present live; each slide change while recording is stamped.
 * - sync:   play an existing recording and press Next when the speaker moves on.
 * - review: like play, with editable per-slide notes.
 */
export type StageMode = "play" | "record" | "sync" | "review";

export default function TalkStage({ pdf, mode, audioUrl, marks, notes, onNotes, onCaptured, onProgress, startAt = 0, knownDuration = 0 }: {
  pdf: PdfDoc | null; mode: StageMode; audioUrl?: string; marks: SlideMark[]; notes: Record<string, string>;
  onNotes?: (n: Record<string, string>) => void;
  onCaptured?: (r: { marks: SlideMark[]; duration: number; audio?: Blob }) => void;
  onProgress?: (t: number, ended: boolean) => void;
  startAt?: number;
  /** Length in seconds when the file itself does not say (MediaRecorder WebM has no duration header). */
  knownDuration?: number;
}) {
  const pages = pdf?.numPages ?? 1;
  const [page, setPage] = useState(1);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [recState, setRecState] = useState<"idle" | "rec">("idle");
  const [err, setErr] = useState("");
  const live = useRef<SlideMark[]>(mode === "sync" ? [{ p: 1, t: 0 }] : marks);
  const [, force] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; t0: number; chunks: Blob[] } | null>(null);
  const renderSeq = useRef(0);
  // the WebM duration fix in progress (its durationchange listener), and the moment the page asked for
  const fixing = useRef<(() => void) | null>(null);
  const sought = useRef<number | null>(null);
  // the fix ends after a render or two: it reads the resume point as it is then
  const startRef = useRef(startAt);
  startRef.current = startAt;
  const endFix = (a: HTMLMediaElement) => {
    if (fixing.current) a.removeEventListener("durationchange", fixing.current);
    fixing.current = null;
  };
  const onMeta = (a: HTMLMediaElement) => {
    if (isFinite(a.duration)) { setDur(a.duration); return; }
    if (fixing.current) return;
    // WebM from MediaRecorder reports Infinity until the browser has seen the end once
    const fix = () => {
      if (!isFinite(a.duration)) return;
      endFix(a);
      setDur(a.duration); a.currentTime = sought.current ?? (startRef.current || 0);
    };
    fixing.current = fix;
    a.addEventListener("durationchange", fix);
    a.currentTime = 1e101;
  };

  const sorted = () => [...live.current].sort((a, b) => a.t - b.t);
  const startOf = (p: number) => sorted().find((m) => m.p === p)?.t ?? 0;
  const pageAt = (t: number) => { let p = 1; for (const m of sorted()) if (m.t <= t + 0.05) p = m.p; return p; };

  useEffect(() => { if (mode !== "sync") live.current = marks; force((n) => n + 1); }, [marks, mode]);

  const draw = useCallback(async (n: number) => {
    if (!pdf || !canvas.current || !box.current) return;
    const seq = ++renderSeq.current;
    const pg = await pdf.getPage(n);
    if (seq !== renderSeq.current) return;
    const dpr = window.devicePixelRatio || 1;
    const v0 = pg.getViewport({ scale: 1 });
    const scale = Math.min(box.current.clientWidth / v0.width, box.current.clientHeight / v0.height) * dpr;
    const vp = pg.getViewport({ scale });
    const c = canvas.current;
    c.width = vp.width; c.height = vp.height; c.style.width = vp.width / dpr + "px";
    await pg.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
  }, [pdf]);

  useEffect(() => { draw(page); }, [page, draw]);
  useEffect(() => { const r = () => draw(page); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, [page, draw]);
  useEffect(() => () => { rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (audio.current && startAt && sought.current === null && !fixing.current) audio.current.currentTime = startAt; }, [startAt, audioUrl]);
  // a server-rendered element can load its metadata before React listens for it
  useEffect(() => { const a = audio.current; if (a && a.readyState >= HTMLMediaElement.HAVE_METADATA) onMeta(a); }, [audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  // transcript lines and chapters on the talk page ask the player to jump (play and review only)
  useEffect(() => {
    if (mode !== "play" && mode !== "review") return;
    return onSeek((t) => {
      const a = audio.current; if (!a) return false;
      sought.current = t;
      endFix(a);
      a.currentTime = t; a.play().catch(() => {});
    });
  }, [mode]);

  const go = (p: number) => {
    p = Math.max(1, Math.min(pages, p));
    if (mode === "record") {
      if (rec.current && p !== page) live.current.push({ p, t: (Date.now() - rec.current.t0) / 1000 });
      setPage(p); return;
    }
    if (mode === "sync") {
      const a = audio.current; if (!a) return;
      if (a.paused && a.currentTime === 0) { setErr("Press play first, then mark each slide change."); return; }
      if (p <= page) return;
      live.current.push({ p, t: a.currentTime }); setPage(p); force((n) => n + 1); return;
    }
    if (audio.current && audioUrl && live.current.length) { audio.current.currentTime = startOf(p); }
    setPage(p);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input, textarea")) return;
      if (["ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); go(page + 1); }
      if (["ArrowLeft", "PageUp"].includes(e.key) && mode !== "sync") { e.preventDefault(); go(page - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function toggleRec() {
    if (rec.current) { rec.current.mr.stop(); return; }
    setErr("");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setErr("Microphone access was refused. Allow it in the browser, or record elsewhere and use “I already have a recording”."); return; }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
    const r = { mr, stream, t0: Date.now(), chunks: [] as Blob[] };
    mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const duration = (Date.now() - r.t0) / 1000;
      rec.current = null; setRecState("idle");
      onCaptured?.({ marks: sorted(), duration, audio: new Blob(r.chunks, { type: mr.mimeType || "audio/webm" }) });
    };
    live.current = [{ p: page, t: 0 }];
    rec.current = r; mr.start(1000); setRecState("rec");
  }
  useEffect(() => {
    if (recState !== "rec") return;
    const i = setInterval(() => setTime((Date.now() - (rec.current?.t0 ?? Date.now())) / 1000), 500);
    return () => clearInterval(i);
  }, [recState]);

  const ms = sorted();
  const total = dur || knownDuration || 0;
  return (
    <div className="player" data-player>
      <div className="stack" style={{ gap: 10, minWidth: 0 }}>
        <div className="slide" ref={box}>{!pdf && <div className="ph">Loading slides…</div>}<canvas ref={canvas} hidden={!pdf} /></div>
        <div className="row-flex">
          {mode !== "sync" && <button className="btn sm" onClick={() => go(page - 1)} aria-label="Previous slide">‹</button>}
          <span className="mono small">{page} / {pages}</span>
          <button className="btn sm" onClick={() => go(page + 1)}>{mode === "sync" ? "Next slide → (mark here)" : "Next slide ›"}</button>
          <span style={{ flex: 1 }} />
          {mode === "sync" && onCaptured && ms.length > 1 && (
            <button className="btn sm" onClick={() => { const a = audio.current; a?.pause(); onCaptured({ marks: sorted(), duration: dur || knownDuration || a?.currentTime || 0 }); }}
              title="Stop here and keep the slide changes marked so far; the last slide stays up until the end">Done marking</button>
          )}
          {mode === "record" && (
            <span className={`row-flex ${recState === "rec" ? "recording" : ""}`}>
              <span className="dot" /><b className="mono">{fmtDur(recState === "rec" ? time : 0)}</b>
              <button className="btn sm primary" onClick={toggleRec}>{recState === "rec" ? "Stop" : "Start recording"}</button>
            </span>
          )}
        </div>
        {mode !== "record" && audioUrl && (
          <div className="row-flex">
            <button className="btn sm" onClick={() => (audio.current!.paused ? audio.current!.play() : audio.current!.pause())} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
            <span className="mono small" style={{ whiteSpace: "nowrap" }}>{fmtDur(time)} / {fmtDur(total)}</span>
            <div className="tl" onClick={(e) => { if (mode === "sync" || !total) return; const r = e.currentTarget.getBoundingClientRect(); audio.current!.currentTime = ((e.clientX - r.left) / r.width) * total; }}>
              {total && ms.length ? ms.map((m, i) => { const end = i + 1 < ms.length ? ms[i + 1].t : total; return <span key={i} className={m.p === page ? "cur" : ""} title={`Slide ${m.p} · ${fmtDur(m.t)}`} style={{ flex: Math.max(0.5, end - m.t) }} />; }) : <span style={{ flex: 1 }} />}
              <i className="head" style={{ left: total ? `${Math.min(100, (time / total) * 100)}%` : 0 }} />
            </div>
            <button className="btn sm ghost" onClick={() => { const r = [1, 1.25, 1.5, 2, 0.75]; const n = r[(r.indexOf(rate) + 1) % r.length]; audio.current!.playbackRate = n; setRate(n); }}>{rate}×</button>
            <audio ref={(n) => { audio.current = n; if (n) trackPlaying(n); }} src={audioUrl} preload="metadata" hidden
              onError={(e) => retryMedia(e.currentTarget)}
              onLoadedMetadata={(e) => onMeta(e.currentTarget)}
              onDurationChange={(e) => { if (!fixing.current && isFinite(e.currentTarget.duration)) setDur(e.currentTarget.duration); }}
              onPlay={(e) => { setPlaying(true); emitTime(e.currentTarget.currentTime, true); }} onPause={(e) => { setPlaying(false); emitTime(e.currentTarget.currentTime, false); }}
              onTimeUpdate={(e) => { if (fixing.current) return; const t = e.currentTarget.currentTime; setTime(t); emitTime(t, !e.currentTarget.paused); onProgress?.(t, false); if (mode === "play" || mode === "review") { const p = pageAt(t); if (p !== page) setPage(p); } }}
              onEnded={(e) => { onProgress?.(e.currentTarget.duration, true); if (mode === "sync") onCaptured?.({ marks: sorted(), duration: e.currentTarget.duration }); }} />
          </div>
        )}
        {err && <div className="note">{err}</div>}
      </div>
      <div className="stack" style={{ gap: 10, minWidth: 0 }}>
        <div className="eyebrow">Slide {page}{mode !== "record" && ms.length ? ` · ${fmtDur(startOf(page))}` : ""}</div>
        {mode === "review" && onNotes ? (
          <div className="field"><label htmlFor="slide-note">Notes or transcript for this slide</label>
            <textarea id="slide-note" value={notes[page] ?? ""} onChange={(e) => onNotes({ ...notes, [page]: e.target.value })} placeholder="What the speaker said on this slide" /></div>
        ) : <div style={{ whiteSpace: "pre-wrap" }}>{notes[page] ?? ""}</div>}
        <div className="eyebrow" style={{ marginTop: 6 }}>Slides</div>
        <div className="pages">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => {
            const m = ms.find((x) => x.p === p);
            return <button key={p} className={p === page ? "cur" : ""} onClick={() => mode !== "sync" && mode !== "record" && go(p)}>{p}{m && mode !== "record" ? ` · ${fmtDur(m.t)}` : ""}</button>;
          })}
        </div>
      </div>
    </div>
  );
}
