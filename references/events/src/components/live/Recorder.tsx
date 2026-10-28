"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { openPdf, type PdfDoc } from "@/lib/pdf";
import { addChunk, audioExt, canRecord, dropSession, pickMime, savePdf, saveSession, sessionBlob, sessionPdf, unsavedSessions, type RecSession } from "@/lib/recorder";
import { fmtDur, fmtSize, slugify } from "@/lib/format";
import type { SlideMark } from "@/lib/types";
import { uploadToStorage } from "@/lib/materials-client";
import TalkStage from "../TalkStage";
import { runTranscript } from "@/lib/transcript/client";
import type { TranscriptState } from "@/lib/transcript/types";
import SlideCanvas from "./SlideCanvas";

export interface RecTarget { key: string; agendaId: string | null; title: string; speaker: string; time?: string }
export type RecPhase = "idle" | "setup" | "starting" | "recording" | "stopping" | "review" | "saving" | "saved";

// 32 kbps Opus is plenty for speech: ~14 MB an hour, so up to about 1 h 45 min fits the
// 25 MB file limit of speech-to-text services in one piece (longer WebM recordings are split
// on the server), and the 48 MB stop below is reached only after about 3 h 20 min.
const BITRATE = 32_000;
// Each uploaded file must stay under 50 MB. The audio stops itself a little before that,
// and slides above 45 MB are refused when chosen.
const WARN_BYTES = 45e6;
const STOP_BYTES = 48e6;
const MAX_BYTES = 50e6;
const MAX_PDF_BYTES = 45e6;
const CAP_MSG = "Reached the 48 MB upload limit. Saved what was recorded; start a new recording for the rest.";
const LIVE_PING = "kleros-rec-live";

function micError(e: unknown) {
  const n = (e as Error)?.name;
  if (n === "NotAllowedError" || n === "SecurityError") return "The browser blocked the microphone. Click the microphone icon in the address bar, allow access, then press Start recording again.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No microphone was found. Plug one in or check the laptop's sound settings, then try again.";
  if (n === "NotReadableError" || n === "AbortError") return "The microphone is busy in another app (a video call, for example). Close it and try again.";
  return `The recording could not start: ${(e as Error)?.message || "unknown error"}.`;
}

/**
 * Recording clock. Elapsed time comes from the meter's AudioContext, whose currentTime only
 * advances while audio is actually flowing (it stops when the laptop sleeps, like the
 * recording does), so slide marks and the duration follow the audio rather than the wall
 * clock. If the context cannot run (no Web Audio, or the browser suspends it), it falls back
 * to the wall clock from that point on, which overcounts time the laptop spent asleep.
 */
interface RecClock { ctx: AudioContext | null; ctxT0: number; wallT0: number; useWall: boolean; stopAt: number | null }
const newClock = (): RecClock => ({ ctx: null, ctxT0: 0, wallT0: Date.now(), useWall: true, stopAt: null });
function clockNow(c: RecClock) {
  if (c.stopAt != null) return c.stopAt;
  if (!c.useWall && c.ctx && c.ctx.state === "running") return Math.max(0, c.ctx.currentTime - c.ctxT0);
  return Math.max(0, (Date.now() - c.wallT0) / 1000);
}

/** Clean slide marks for saving: sorted, one decimal, no repeats of the same slide back to back. */
function tidy(marks: SlideMark[]): SlideMark[] {
  const out: SlideMark[] = [];
  for (const m of [...marks].sort((a, b) => a.t - b.t)) {
    const t = Math.max(0, Math.round(m.t * 10) / 10);
    if (out.length && out[out.length - 1].p === m.p) continue;
    if (out.length && out[out.length - 1].t === t) out[out.length - 1] = { p: m.p, t };
    else out.push({ p: m.p, t });
  }
  return out;
}

/**
 * The recorder, shared by the host console, the team tools on the event page and /record.
 * With an event, the recording is saved to that event (and linked to it); with eventId null
 * it is saved on its own and can be linked to events afterwards (savedExtra renders the
 * controls for that under "Saved").
 */
export default function Recorder({ eventId, slug, eventTitle, target, onPhase, onDone, onSaved, savedExtra, autoTranscribe = true }: {
  eventId: string | null; slug?: string; eventTitle?: string; target: RecTarget | null;
  /** Start the transcript after saving (team accounts only: transcripts use paid services). */
  autoTranscribe?: boolean;
  onPhase?: (p: RecPhase, title?: string) => void; onDone?: () => void;
  onSaved?: (id: string, kind: "talk" | "audio") => void;
  savedExtra?: (id: string, title: string) => React.ReactNode;
}) {
  // unsaved recordings kept on this laptop are listed per event; recordings without one share a key
  const recKey = eventId ?? "standalone";
  const [phase, setPhaseState] = useState<RecPhase>(target ? "setup" : "idle");
  const [title, setTitle] = useState(target?.title ?? "");
  const [speaker, setSpeaker] = useState(target?.speaker ?? "");
  const [pdfFile, setPdfFile] = useState<Blob | null>(null);
  const [pdfName, setPdfName] = useState("");
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState("");
  const [page, setPage] = useState(1);
  const [marks, setMarks] = useState<SlideMark[]>([]);
  const [secs, setSecs] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [progress, setProgress] = useState("");
  const [saved, setSaved] = useState<{ id: string; kind: "talk" | "audio" } | null>(null);
  const [tx, setTx] = useState<TranscriptState | null>(null);
  const txFor = useRef("");
  const [leftovers, setLeftovers] = useState<RecSession[]>([]);
  const [confirm, setConfirm] = useState("");
  const [backup, setBackup] = useState(true);
  const [otherTab, setOtherTab] = useState(false);
  const [supported, setSupported] = useState(true);

  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const session = useRef<RecSession | null>(null);
  const chunks = useRef<Blob[]>([]);
  const wake = useRef<WakeLockSentinel | null>(null);
  const clock = useRef<RecClock>(newClock());
  const starting = useRef(false);
  const mounted = useRef(true);
  const marksRef = useRef<SlideMark[]>([]);
  const meterBar = useRef<HTMLSpanElement>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const uploaded = useRef<{ pdf?: string; audio?: string }>({});
  const liveIds = useRef<Map<string, number>>(new Map());
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Two-press confirm: the first press arms the button for 4 seconds, the second acts. */
  const arm = useCallback((key: string) => {
    setConfirm(key);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm((c) => (c === key ? "" : c)), 4000);
  }, []);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const setPhase = useCallback((p: RecPhase) => { setPhaseState(p); }, []);
  useEffect(() => { onPhase?.(phase, title || target?.title); }, [phase, title, target, onPhase]);
  useEffect(() => { setSupported(canRecord()); }, []);

  // a new session picked from the agenda (only possible while nothing is recorded)
  useEffect(() => {
    if (!target) return;
    setTitle(target.title); setSpeaker(target.speaker); setErr(""); setWarn("");
    setPhase("setup");
  }, [target, setPhase]);

  // ---------- recovery and other tabs ----------
  const refreshLeftovers = useCallback(async () => {
    try {
      const all = await unsavedSessions(recKey);
      const now = Date.now();
      // skip the one in progress here and any that another tab is still writing to
      setLeftovers(all.filter((s) => s.id !== session.current?.id && now - (liveIds.current.get(s.id) ?? 0) > 8000 && now - (s.updatedAt ?? 0) > 12000));
    } catch { setLeftovers([]); }
  }, [recKey]);
  useEffect(() => {
    refreshLeftovers();
    // a tab that crashed seconds ago still looks "in progress"; look again once it has gone quiet
    const t = setTimeout(refreshLeftovers, 13000);
    return () => clearTimeout(t);
  }, [refreshLeftovers]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(LIVE_PING);
    bc.onmessage = (e: MessageEvent<{ id: string; eventId: string | null }>) => {
      if (!e.data?.id || e.data.id === session.current?.id) return;
      liveIds.current.set(e.data.id, Date.now());
      setOtherTab(true);
    };
    const t = setInterval(() => {
      if (media.current?.state === "recording" && session.current) bc.postMessage({ id: session.current.id, eventId });
      const now = Date.now();
      const anyLive = [...liveIds.current.values()].some((ts) => now - ts < 8000);
      setOtherTab(anyLive);
    }, 3000);
    return () => { clearInterval(t); bc.close(); };
  }, [eventId]);

  // ---------- slides ----------
  async function choosePdf(f: File | undefined) {
    if (!f) return;
    setPdfErr("");
    if (f.size > MAX_PDF_BYTES) {
      setPdfErr(`"${f.name}" is ${fmtSize(f.size)}. Slides over 45 MB cannot be uploaded. Export a smaller PDF (fewer or lighter images), or record without slides.`);
      return;
    }
    setPdfBusy(true);
    try {
      const doc = await openPdf(await f.arrayBuffer());
      setPdf(doc); setPdfFile(f); setPdfName(f.name); setPage(1);
    } catch {
      setPdf(null); setPdfFile(null); setPdfName("");
      setPdfErr(`"${f.name}" could not be opened as a PDF. Choose another file, or record without slides.`);
    }
    setPdfBusy(false);
  }
  function removePdf() { setPdf(null); setPdfFile(null); setPdfName(""); setPage(1); setPdfErr(""); }

  const go = useCallback((p: number) => {
    if (!pdf) return;
    const n = Math.max(1, Math.min(pdf.numPages, p));
    if (n === page) return;
    if (media.current?.state === "recording") {
      const next = [...marksRef.current, { p: n, t: clockNow(clock.current) }];
      marksRef.current = next;
      setMarks(next);
      if (session.current) {
        session.current = { ...session.current, marks: next, updatedAt: Date.now() };
        saveSession(session.current).catch(() => setBackup(false));
      }
    }
    setPage(n);
  }, [pdf, page]);

  useEffect(() => {
    if (!pdf || !(phase === "setup" || phase === "recording")) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey || el.closest("input, textarea, select, [contenteditable]")) return;
      if (["ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); go(page + 1); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(page - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pdf, phase, page, go]);

  // ---------- recording ----------
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setSecs(clockNow(clock.current)), 500);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "recording") return;
    // the browser drops the wake lock when the tab is hidden; take it again on return
    const keep = () => { if (document.visibilityState === "visible") lockScreen(); };
    document.addEventListener("visibilitychange", keep);
    return () => document.removeEventListener("visibilitychange", keep);
  }, [phase]);

  useEffect(() => {
    if (!["starting", "recording", "stopping", "review", "saving"].includes(phase)) return;
    const warnLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warnLeave);
    return () => window.removeEventListener("beforeunload", warnLeave);
  }, [phase]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (media.current?.state === "recording") media.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      closeAudio();
      wake.current?.release().catch(() => {});
      wake.current = null;
    };
  }, []);

  useEffect(() => {
    if (!blob) { setBlobUrl(""); return; }
    const u = URL.createObjectURL(blob);
    setBlobUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  async function lockScreen() {
    const w = await navigator.wakeLock?.request("screen").catch(() => null);
    if (!w) return;
    // the recording may have stopped (or the console closed) while the request was pending
    if (!mounted.current || media.current?.state !== "recording") { w.release().catch(() => {}); return; }
    if (wake.current && wake.current !== w) wake.current.release().catch(() => {});
    wake.current = w;
  }

  function closeAudio() {
    const ctx = audioCtx.current;
    audioCtx.current = null;
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
  }

  /** Opens the AudioContext that drives both the level meter and the recording clock. */
  function startAudio() {
    const c = newClock();
    clock.current = c;
    try {
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      c.ctx = ctx;
      if (ctx.state === "running") { c.ctxT0 = ctx.currentTime; c.useWall = false; }
      ctx.onstatechange = () => {
        if (ctx.state === "running" || c.useWall || c.stopAt != null) return;
        // suspended or closed mid-recording: carry on from here on the wall clock
        c.wallT0 = Date.now() - Math.max(0, ctx.currentTime - c.ctxT0) * 1000;
        c.useWall = true;
      };
    } catch { /* no Web Audio: wall clock and no meter */ }
  }

  function meter(s: MediaStream) {
    const ctx = audioCtx.current;
    if (!ctx) return;
    try {
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        if (media.current?.state !== "recording" || ctx.state === "closed") { if (meterBar.current) meterBar.current.style.width = "0%"; return; }
        an.getByteTimeDomainData(buf);
        let sum = 0; for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        if (meterBar.current) meterBar.current.style.width = `${Math.round(lvl * 100)}%`;
        requestAnimationFrame(tick);
      };
      tick();
    } catch { /* the meter is a nicety; recording continues without it */ }
  }

  async function start() {
    // a double click, or a click while the previous recording is still finishing
    if (starting.current || (media.current && media.current.state !== "inactive")) return;
    starting.current = true;
    try { await begin(); } finally { starting.current = false; }
  }

  async function begin() {
    setErr(""); setWarn("");
    if (!canRecord()) { setErr("This browser cannot record audio. Use a recent version of Chrome, Edge, Firefox or Safari."); return; }
    setPhase("starting");
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { setErr(micError(e)); setPhase("setup"); return; }
    stream.current = s;

    const mime = pickMime();
    let mr: MediaRecorder;
    try { mr = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: BITRATE }); }
    catch { try { mr = new MediaRecorder(s); } catch (e) { s.getTracks().forEach((t) => t.stop()); setErr(micError(e)); setPhase("setup"); return; } }

    const startPage = pdf ? page : 1;
    marksRef.current = pdf ? [{ p: startPage, t: 0 }] : [];
    setMarks(marksRef.current);
    chunks.current = []; uploaded.current = {}; setBytes(0); setSecs(0); setSaved(null);

    const sess: RecSession = {
      id: crypto.randomUUID(), eventId: recKey, startedAt: Date.now(), mime: mr.mimeType || mime || "audio/webm", seconds: 0,
      title: title.trim(), speaker: speaker.trim(), agendaId: target?.agendaId ?? null,
      marks: marksRef.current, pages: pdf?.numPages, hasPdf: !!(pdf && pdfFile), pdfName, pdfBytes: pdf && pdfFile ? pdfFile.size : 0,
      bytes: 0, updatedAt: Date.now(),
    };
    session.current = sess;
    let ok = true;
    try {
      await saveSession(sess);
      if (pdf && pdfFile) await savePdf(sess.id, pdfFile); // once; the session record keeps only metadata
    } catch { ok = false; }
    setBackup(ok);

    let total = 0;
    mr.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.current.push(e.data);
      total += e.data.size;
      setBytes(total);
      if (total > WARN_BYTES) setWarn("This recording is close to 50 MB, the upload limit, and stops by itself at 48 MB. Stop at a natural break and start a new recording for the next part.");
      const cur = session.current;
      if (cur) {
        addChunk(cur.id, e.data).catch(() => setBackup(false));
        session.current = { ...cur, seconds: clockNow(clock.current), marks: marksRef.current, bytes: total, updatedAt: Date.now() };
        saveSession(session.current).catch(() => setBackup(false));
      }
      if (total >= STOP_BYTES && mr.state === "recording") { setWarn(CAP_MSG); stop(); }
    };
    mr.onerror = () => setErr("The browser reported a recording error. What was captured so far is kept.");
    mr.onstop = () => {
      const dur = clockNow(clock.current);
      clock.current.stopAt = dur;
      s.getTracks().forEach((t) => t.stop());
      closeAudio();
      setSecs(dur);
      const b = new Blob(chunks.current, { type: mr.mimeType || sess.mime });
      if (session.current) {
        session.current = { ...session.current, seconds: dur, marks: marksRef.current, updatedAt: Date.now() };
        saveSession(session.current).catch(() => {});
      }
      setBlob(b);
      setPhase("review");
    };
    s.getAudioTracks().forEach((t) => {
      t.onended = () => {
        if (media.current?.state === "recording") {
          setWarn("The microphone disconnected, so the recording stopped. Everything captured up to that point is below.");
          stop();
        }
      };
    });

    mr.start(4000);
    media.current = mr;
    startAudio();
    setPhase("recording");
    meter(s);
    await lockScreen();
  }

  /** The Stop button: asks once ("Stop and review?") so a stray click does not end a talk. */
  function requestStop() {
    if (confirm !== "stop") { arm("stop"); return; }
    setConfirm("");
    stop();
  }

  function stop() {
    if (media.current?.state === "recording") {
      // freeze the clock at the moment Stop is pressed; the last chunk arrives a little later
      clock.current.stopAt = clockNow(clock.current);
      setPhase("stopping");
      media.current.stop();
    }
    wake.current?.release().catch(() => {});
    wake.current = null;
  }

  // ---------- after stop ----------
  async function recover(s: RecSession) {
    setErr(""); setConfirm("");
    try {
      const b = await sessionBlob(s);
      if (!b.size) { setErr("Nothing was captured in that recording, so there is nothing to recover. It can be deleted."); return; }
      session.current = s;
      uploaded.current = {};
      setTitle(s.title || target?.title || ""); setSpeaker(s.speaker || target?.speaker || "");
      marksRef.current = s.marks ?? []; setMarks(marksRef.current);
      setSecs(s.seconds); setBytes(b.size);
      const kept = s.hasPdf ? await sessionPdf(s.id).catch(() => null) : null;
      if (kept) {
        try { setPdf(await openPdf(await kept.arrayBuffer())); setPdfFile(kept); setPdfName(s.pdfName || "slides.pdf"); }
        catch { setPdf(null); setPdfFile(null); setWarn("The slides kept with this recording could not be opened, so it will be saved as audio only."); }
      } else {
        setPdf(null); setPdfFile(null);
        if (s.hasPdf) setWarn("The slides kept with this recording could not be found, so it will be saved as audio only.");
      }
      setBlob(b);
      setLeftovers((l) => l.filter((x) => x.id !== s.id));
      setPhase("review");
    } catch (e) { setErr(`The recording could not be read from this laptop: ${(e as Error).message}`); }
  }

  async function deleteLeftover(s: RecSession) {
    if (confirm !== s.id) { arm(s.id); return; }
    setConfirm("");
    await dropSession(s.id).catch(() => {});
    refreshLeftovers();
  }

  async function save() {
    if (!blob || !session.current) return;
    setErr(""); setPhase("saving");
    const sb = supabaseBrowser();
    const name = title.trim() || (eventTitle ? `${eventTitle} recording` : "Untitled recording");
    const stamp = new Date(session.current.startedAt).toISOString().slice(0, 16).replace(":", "");
    try {
      const withSlides = !!(pdf && pdfFile);
      if (withSlides && !uploaded.current.pdf) {
        setProgress("Uploading slides…");
        uploaded.current.pdf = await uploadToStorage(eventId, pdfFile!, pdfName || "slides.pdf");
      }
      if (!uploaded.current.audio) {
        setProgress(`Uploading audio (${fmtSize(blob.size)})…`);
        uploaded.current.audio = await uploadToStorage(eventId, blob, `${slugify(name) || "recording"}-${stamp}.${audioExt(blob.type)}`);
      }
      setProgress(eventId ? "Saving to the event…" : "Saving…");
      const base = { event_id: eventId, title: name, speaker: speaker.trim() || null, duration_seconds: Math.round(secs) };
      const row: Record<string, unknown> = withSlides
        ? { ...base, kind: "talk", pdf_path: uploaded.current.pdf, audio_path: uploaded.current.audio, pages: pdf!.numPages, marks: tidy(marks.length ? marks : [{ p: 1, t: 0 }]), size_bytes: blob.size + pdfFile!.size }
        : { ...base, kind: "audio", file_path: uploaded.current.audio, size_bytes: blob.size };
      const { data, error } = await sb.from("materials").insert(row).select("id").single();
      if (error) throw error;
      await dropSession(session.current.id).catch(() => {});
      const id = (data as { id: string }).id;
      setSaved({ id, kind: withSlides ? "talk" : "audio" });
      setPhase("saved");
      if (autoTranscribe) transcribe(id);
      onSaved?.(id, withSlides ? "talk" : "audio");
    } catch (e) {
      const raw = (e as Error).message || "unknown error";
      const msg = /failed to fetch|network|load failed/i.test(raw) ? "the server could not be reached (check the wifi)" : raw;
      const big = blob.size > MAX_BYTES ? " The file is larger than 50 MB, which the storage plan does not accept. Download a copy and share it with an admin instead." : "";
      setErr(`Saving failed: ${msg}.${big} The recording is still safe on this laptop. Try again, or download a copy.`);
      setPhase("review");
    }
    setProgress("");
  }

  /**
   * Starts the transcript and summary for a saved recording. Runs on its own: the recording
   * is already saved, and a failure here only shows a note (it can be retried on the talk page).
   */
  function transcribe(id: string) {
    txFor.current = id;
    setTx({ status: "queued" });
    runTranscript(id, (s) => { if (txFor.current === id && mounted.current) setTx(s); })
      .then((s) => { if (txFor.current === id && mounted.current) setTx(s); })
      .catch(() => { if (txFor.current === id && mounted.current) setTx({ status: "error", error: "The transcript could not be started." }); });
  }

  function download() {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug || "kleros"}-${slugify(title) || "recording"}.${audioExt(blob.type)}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  function reset() {
    session.current = null; chunks.current = []; marksRef.current = []; uploaded.current = {};
    setBlob(null); setMarks([]); setSecs(0); setBytes(0); setErr(""); setWarn(""); setConfirm(""); setSaved(null);
    txFor.current = ""; setTx(null); // a run in progress carries on in the server; its result shows on the talk page
    removePdf();
  }

  async function discard() {
    if (confirm !== "discard") { arm("discard"); return; }
    // a save that failed half way may have uploaded the slides or the audio already
    const paths = [uploaded.current.pdf, uploaded.current.audio].filter((x): x is string => !!x);
    if (paths.length) {
      try { await supabaseBrowser().storage.from("materials").remove(paths); } catch { /* best effort */ }
    }
    if (session.current) await dropSession(session.current.id).catch(() => {});
    reset(); setPhase(target ? "setup" : "idle"); refreshLeftovers();
  }

  function finish() { reset(); setPhase("idle"); refreshLeftovers(); onDone?.(); }

  // ---------- view ----------
  const recording = phase === "recording" || phase === "stopping";
  const status = { idle: "", setup: "Ready", starting: "Starting", recording: "Recording", stopping: "Finishing", review: "Not saved yet", saving: "Saving", saved: "Saved" }[phase];
  const pages = pdf?.numPages ?? 0;

  const leftoverList = leftovers.length > 0 && (phase === "idle" || phase === "setup") && (
    <div className="rec-recover">
      <div className="rec-recover-h">Recover unsaved recording</div>
      <p className="muted small">These recordings stopped before they were saved (the tab closed or the laptop restarted). They are stored on this laptop only.</p>
      {leftovers.map((s) => (
        <div key={s.id} className="rec-recover-row">
          <div className="rec-recover-meta">
            <b>{s.title || "Untitled recording"}</b>
            <span className="muted small">{new Date(s.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {fmtDur(s.seconds)}{s.hasPdf ? " · with slides" : ""}</span>
          </div>
          <div className="row-flex">
            <button className="btn sm" onClick={() => recover(s)}>Recover</button>
            <button className="btn sm ghost" onClick={() => deleteLeftover(s)}>{confirm === s.id ? "Delete for good?" : "Delete"}</button>
          </div>
        </div>
      ))}
    </div>
  );

  if (phase === "idle") {
    return (
      <section className="con-panel rec rec-idle" aria-labelledby="rec-h">
        <div className="con-panel-h"><h2 id="rec-h">Recording</h2></div>
        <div className="rec-empty">
          <div className="rec-empty-icon" aria-hidden="true"><span className="dot" /></div>
          <b>Nothing is being recorded</b>
          <p className="muted">Pick a session from the agenda to record it with its title, or start now and name it afterwards. The laptop records the room audio; with the speaker&apos;s slides loaded, each slide change is time-stamped so the talk plays back in sync.</p>
        </div>
        <button className="btn primary rec-start rec-start-full" onClick={start} disabled={!supported}>
          <span className="dot" /> Start recording
        </button>
        {!supported && <div className="note">This browser cannot record audio. Use a recent version of Chrome, Edge, Firefox or Safari.</div>}
        {leftoverList}
        {err && <div className="note" role="alert">{err}</div>}
      </section>
    );
  }

  return (
    <section className={`con-panel rec ${recording ? "is-rec" : ""}`} aria-labelledby="rec-h">
      <div className="con-panel-h">
        <div className="rec-title">
          <div className="eyebrow">{target?.agendaId ? `Session${target.time ? ` · ${target.time}` : ""}` : eventId ? "Session not on the agenda" : "Recording"}</div>
          <h2 id="rec-h">{title || target?.title || "New recording"}</h2>
          {(speaker || target?.speaker) && phase !== "review" && <div className="muted small">{speaker || target?.speaker}</div>}
        </div>
        {status && <span className={`rec-status s-${phase}`}>{recording && <span className="dot" />}{status}</span>}
      </div>

      {otherTab && !recording && <div className="note">Another tab on this laptop is recording right now. Stop it there first, or the two recordings will share the microphone.</div>}

      {(phase === "setup" || phase === "starting") && (
        <div className="rec-setup">
          {!target?.agendaId && (
            <div className="two">
              <div className="field"><label htmlFor="rec-t">Title</label><input id="rec-t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What this session is called" /></div>
              <div className="field"><label htmlFor="rec-s">Speaker</label><input id="rec-s" value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="Full name" /></div>
            </div>
          )}

          <div className="rec-step">
            <div className="rec-step-h">
              <span className="lbl">Slides <span className="muted">(optional)</span></span>
              {pdf ? (
                <span className="row-flex">
                  <span className="muted small rec-file">{pdfName} · {pages} {pages === 1 ? "slide" : "slides"}</span>
                  <button className="btn sm ghost" onClick={removePdf}>Remove</button>
                </span>
              ) : (
                <label className={`btn sm ${pdfBusy ? "is-busy" : ""}`}>
                  {pdfBusy ? "Opening…" : "Choose PDF"}
                  <input type="file" hidden accept=".pdf,application/pdf" disabled={pdfBusy} onChange={(e) => { choosePdf(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
              )}
            </div>
            {!pdf && !pdfErr && <p className="muted small">With slides loaded, click along during the talk and every slide change is time-stamped. The saved talk then plays with the slides in sync. Without slides, only the audio is saved.</p>}
            {pdfErr && <div className="note">{pdfErr}</div>}
            {pdf && (
              <div className="rec-slides">
                <SlideCanvas pdf={pdf} page={page} />
                <div className="rec-slide-nav">
                  <button className="btn sm" onClick={() => go(page - 1)} disabled={page <= 1}>‹ Previous</button>
                  <span className="mono small">Start on slide {page} of {pages}</span>
                  <button className="btn sm" onClick={() => go(page + 1)} disabled={page >= pages}>Next ›</button>
                </div>
              </div>
            )}
          </div>

          <div className="rec-go">
            <button className="btn primary rec-start" onClick={start} disabled={phase === "starting" || !supported}>
              <span className="dot" /> {phase === "starting" ? "Waiting for the microphone…" : "Start recording"}
            </button>
            <p className="muted small">Audio is kept on this laptop every few seconds while recording, so nothing is lost if the tab closes. Keep the laptop plugged in.</p>
          </div>
          {!supported && <div className="note">This browser cannot record audio. Use a recent version of Chrome, Edge, Firefox or Safari.</div>}
        </div>
      )}

      {recording && (
        <div className="rec-live">
          <div className="rec-strip">
            <div className="rec-clock">
              <span className="mono rec-time" aria-live="off">{fmtDur(secs)}</span>
              <span className="rec-meter" aria-label="Microphone level"><span ref={meterBar} /></span>
            </div>
            <span className="muted small mono rec-bytes" title="Each file must stay under 50 MB to upload">
              {fmtSize(bytes) || "0 KB"}{pdfFile ? ` + ${fmtSize(pdfFile.size)} slides` : ""}
            </span>
            <button className={`btn rec-stop ${confirm === "stop" ? "armed" : ""}`} onClick={requestStop} disabled={phase === "stopping"}>
              <span className="sq" aria-hidden="true" /> {phase === "stopping" ? "Finishing…" : confirm === "stop" ? "Stop and review?" : "Stop"}
            </button>
          </div>

          {pdf ? (
            <div className="rec-slides live">
              <SlideCanvas pdf={pdf} page={page} />
              <div className="rec-slide-nav">
                <button className="btn" onClick={() => go(page - 1)} disabled={page <= 1}>‹ Previous</button>
                <span className="mono small">Slide {page} of {pages} · {Math.max(0, marks.length - 1)} {marks.length === 2 ? "change" : "changes"}</span>
                <button className="btn primary" onClick={() => go(page + 1)} disabled={page >= pages}>Next slide ›</button>
              </div>
              <p className="muted small rec-hint">Change slides when the speaker does. The ← and → keys and most presenter clickers work too.</p>
            </div>
          ) : (
            <div className="rec-audio-only">
              <b>Recording audio only</b>
              <span className="muted small">{eventId ? "Slides can be attached and synced later from the event page, under Talks." : "Slides can be attached later, once the recording is linked to an event."}</span>
            </div>
          )}
          {!backup && <div className="note">This browser is not keeping a backup copy (a private window, or storage is full). Keep this tab open until the recording is saved.</div>}
        </div>
      )}

      {(phase === "review" || phase === "saving") && blob && (
        <div className="rec-review">
          {pdf ? (
            <TalkStage pdf={pdf} mode="play" audioUrl={blobUrl} marks={tidy(marks)} notes={{}} knownDuration={secs} />
          ) : (
            <audio className="rec-audio" controls src={blobUrl || undefined} preload="metadata"
              onLoadedMetadata={(e) => {
                // MediaRecorder WebM has no duration header; seeking to the end once makes the browser compute it
                const a = e.currentTarget;
                if (isFinite(a.duration)) return;
                const fix = () => { if (isFinite(a.duration)) { a.removeEventListener("durationchange", fix); a.currentTime = 0; } };
                a.addEventListener("durationchange", fix);
                a.currentTime = 1e101;
              }} />
          )}
          <div className="two">
            <div className="field"><label htmlFor="rv-t">Title</label><input id="rv-t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={eventTitle ? `${eventTitle} recording` : "What this recording is called"} disabled={phase === "saving"} /></div>
            <div className="field"><label htmlFor="rv-s">Speaker</label><input id="rv-s" value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="Full name" disabled={phase === "saving"} /></div>
          </div>
          <div className="rec-facts mono small">
            <span>{fmtDur(secs)}</span><span>{fmtSize(blob.size)}{pdf && pdfFile ? ` + ${fmtSize(pdfFile.size)} slides` : ""}</span>
            <span>{pdf ? `${pages} slides · ${Math.max(0, tidy(marks).length - 1)} slide changes` : "Audio only"}</span>
          </div>
          {(blob.size > WARN_BYTES || (pdf && pdfFile && pdfFile.size > MAX_PDF_BYTES)) && (
            <div className="note">
              Each file must stay under 50 MB for the storage plan. The audio is {fmtSize(blob.size)}{pdf && pdfFile ? ` and the slides are ${fmtSize(pdfFile.size)}` : ""}. If saving fails, download a copy and share it with an admin.
            </div>
          )}
          <div className="rec-actions">
            <button className="btn primary" onClick={save} disabled={phase === "saving"}>{phase === "saving" ? progress || "Saving…" : `${pdf ? "Save talk" : "Save recording"}${eventId ? " to event" : ""}`}</button>
            <button className="btn" onClick={download} disabled={phase === "saving"}>Download copy</button>
            <span className="spacer" />
            <button className="btn ghost danger" onClick={discard} disabled={phase === "saving"}>{confirm === "discard" ? "Discard for good?" : "Discard"}</button>
          </div>
        </div>
      )}

      {phase === "saved" && saved && (
        <div className="rec-saved">
          <div className="ok">
            {eventId ? "Saved to the event. " : "Saved to the recordings library. "}
            {saved.kind === "talk" ? "It plays with the slides in sync on the talk page." : eventId ? "It is listed with the event's recordings." : "Link it to one or more events so it shows on their pages."}
          </div>
          {tx && <TxLine s={tx} href={`/talks/${saved.id}`} />}
          {!autoTranscribe && <div className="rec-tx" role="status">Transcripts are made by Kleros team accounts. A team member can make one from the talk page.</div>}
          {savedExtra?.(saved.id, title.trim() || (eventTitle ? `${eventTitle} recording` : "Untitled recording"))}
          <div className="row-flex">
            <a className="btn" href={`/talks/${saved.id}`} target="_blank" rel="noopener">Open the talk ↗</a>
            <button className="btn primary" onClick={finish}>{eventId ? "Record another session" : "Record something else"}</button>
          </div>
        </div>
      )}

      {warn && <div className="note" role="status">{warn}</div>}
      {err && <div className="note" role="alert">{err}</div>}
      {leftoverList}
    </section>
  );
}

/** One line under "Saved": where the automatic transcript and summary have got to. */
function TxLine({ s, href }: { s: TranscriptState; href: string }) {
  if (s.status === "done") {
    return <div className="rec-tx s-done" role="status">{s.error ? "Transcript ready, summary not set up" : "Transcript ready"} · <a href={href} target="_blank" rel="noopener">Open the talk</a></div>;
  }
  if (s.status === "error") {
    return (
      <div className="rec-tx s-error" role="status">
        {s.setup ? "Transcripts are not set up yet, so none was made. The recording is saved." : `The transcript could not be made: ${s.error || "unknown error"} The recording is saved; try again from the talk page.`}
      </div>
    );
  }
  const label = s.status === "summarising" ? "Writing summary…" : s.status === "transcribing" ? "Transcribing…" : "Starting the transcript…";
  return <div className="rec-tx" role="status"><span className="tx-spin" aria-hidden />{label}<span className="muted small">This can take a few minutes. It is fine to record the next session meanwhile.</span></div>;
}
