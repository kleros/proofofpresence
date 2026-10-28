"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { openPdf, type PdfDoc } from "@/lib/pdf";
import { linkMaterial, uploadToStorage } from "@/lib/materials-client";
import { fmtDur, fmtSize } from "@/lib/format";
import type { Material, SlideMark } from "@/lib/types";
import TalkStage from "../TalkStage";
import { fileUrl } from "../MaterialRow";

const MAX_PDF_BYTES = 45e6;
type Step = "pick" | "sync" | "review" | "done";

/**
 * Attach a slides PDF to a recording that was saved without one. Either sync it (play the
 * recording and mark each slide change; the recording becomes a slide-synced talk), or attach
 * the PDF as related slides, listed next to the recording on every event it belongs to.
 */
export default function AttachSlides({ eventId, recordings, onSaved }: {
  eventId: string; recordings: Material[]; onSaved: (msg: string) => void;
}) {
  const [recId, setRecId] = useState(recordings[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [marks, setMarks] = useState<SlideMark[]>([]);
  const [duration, setDuration] = useState(0);
  const [step, setStep] = useState<Step>("pick");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [doneId, setDoneId] = useState("");
  const rec = recordings.find((r) => r.id === recId) ?? null;

  useEffect(() => { if (!recordings.some((r) => r.id === recId)) setRecId(recordings[0]?.id ?? ""); }, [recordings, recId]);

  async function choose(f: File | undefined) {
    if (!f) return;
    setErr("");
    if (f.size > MAX_PDF_BYTES) { setErr(`"${f.name}" is ${fmtSize(f.size)}. Slides over 45 MB cannot be uploaded; export a lighter PDF.`); return; }
    try { setPdf(await openPdf(await f.arrayBuffer())); setFile(f); }
    catch { setPdf(null); setFile(null); setErr(`"${f.name}" could not be opened as a PDF.`); }
  }

  function reset() { setStep("pick"); setFile(null); setPdf(null); setMarks([]); setDuration(0); setErr(""); }

  async function saveSynced() {
    if (!rec || !file || !pdf) return;
    setErr(""); setBusy("Uploading slides…");
    try {
      const path = await uploadToStorage(eventId, file, file.name);
      setBusy("Saving…");
      const clean = marks.map((m) => ({ p: m.p, t: Math.round(m.t * 10) / 10 }));
      const { error } = await supabaseBrowser().from("materials").update({
        kind: "talk", pdf_path: path, audio_path: rec.file_path, file_path: null, pages: pdf.numPages,
        marks: clean.length ? clean : [{ p: 1, t: 0 }], duration_seconds: rec.duration_seconds || Math.round(duration) || null,
        size_bytes: (rec.size_bytes ?? 0) + file.size,
      }).eq("id", rec.id);
      if (error) throw error;
      setDoneId(rec.id); setStep("done");
      onSaved(`Slides synced to "${rec.title}". It now plays as a talk with slides.`);
    } catch (e) { setErr(`Saving failed: ${(e as Error).message}`); }
    setBusy("");
  }

  async function saveRelated() {
    if (!rec || !file || !pdf) return;
    setErr(""); setBusy("Uploading slides…");
    try {
      const path = await uploadToStorage(eventId, file, file.name);
      setBusy("Saving…");
      const { data, error } = await supabaseBrowser().from("materials").insert({
        event_id: eventId, kind: "slides", title: `Slides: ${rec.title}`, speaker: rec.speaker, file_path: path, pages: pdf.numPages, size_bytes: file.size,
      }).select("id").single();
      if (error) throw error;
      // list the slides on every event the recording belongs to
      const others = (rec.event_ids ?? []).filter((id) => id !== eventId);
      if (others.length) await linkMaterial((data as { id: string }).id, others).catch(() => {});
      setDoneId(rec.id); setStep("done");
      onSaved(`Slides attached next to "${rec.title}".`);
    } catch (e) { setErr(`Saving failed: ${(e as Error).message}`); }
    setBusy("");
  }

  if (!recordings.length && step !== "done") {
    return <div className="empty"><b>No recording without slides</b>Recordings saved as audio only appear here, so their slides can be attached afterwards.</div>;
  }

  return (
    <div className="stack">
      {step === "pick" && (
        <>
          <div className="two">
            <div className="field">
              <label htmlFor="as-rec">Recording</label>
              <select id="as-rec" value={recId} onChange={(e) => setRecId(e.target.value)}>
                {recordings.map((r) => <option key={r.id} value={r.id}>{r.title}{r.speaker ? `, ${r.speaker}` : ""}{r.duration_seconds ? ` (${fmtDur(r.duration_seconds)})` : ""}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="lbl">Slides (PDF)</span>
              <div className="row-flex">
                <label className="btn sm">{file ? "Choose another PDF" : "Choose PDF"}<input type="file" hidden accept=".pdf,application/pdf" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} /></label>
                {file && pdf && <span className="muted small as-file">{file.name} · {pdf.numPages} slides</span>}
              </div>
            </div>
          </div>
          <p className="muted small">Sync: the recording plays here and each press of Next slide (or the → key) marks a slide change. Use the speed button to go faster, and Done marking once the last slide is up. Related slides: the PDF is listed next to the recording, without timing.</p>
          <div className="row-flex">
            <button className="btn primary" disabled={!pdf || !rec} onClick={() => { setMarks([]); setStep("sync"); }}>Sync slide changes</button>
            <button className="btn" disabled={!pdf || !rec || !!busy} onClick={saveRelated}>{busy || "Attach as related slides"}</button>
          </div>
        </>
      )}

      {step === "sync" && rec && (
        <>
          <div className="muted small">Press play, then Next slide each time the speaker moves on.</div>
          <TalkStage pdf={pdf} mode="sync" audioUrl={fileUrl(rec.file_path)} marks={[]} notes={{}} knownDuration={rec.duration_seconds ?? 0}
            onCaptured={(r) => { setMarks(r.marks); setDuration(r.duration); setStep("review"); }} />
          <div className="row-flex"><button className="btn ghost" onClick={reset}>Cancel</button></div>
        </>
      )}

      {step === "review" && rec && (
        <>
          <div className="muted small">Check the timing: the slides now follow the audio. {Math.max(0, marks.length - 1)} slide changes marked.</div>
          <TalkStage pdf={pdf} mode="play" audioUrl={fileUrl(rec.file_path)} marks={marks} notes={{}} knownDuration={rec.duration_seconds || duration} />
          <div className="row-flex">
            <button className="btn primary" onClick={saveSynced} disabled={!!busy}>{busy || "Save synced talk"}</button>
            <button className="btn" onClick={() => { setMarks([]); setStep("sync"); }} disabled={!!busy}>Mark again</button>
            <button className="btn ghost" onClick={reset} disabled={!!busy}>Cancel</button>
          </div>
        </>
      )}

      {step === "done" && (
        <div className="row-flex">
          {doneId && <a className="btn" href={`/talks/${doneId}`}>Open the talk</a>}
          <button className="btn" onClick={reset}>Attach other slides</button>
        </div>
      )}
      {err && <div className="note" role="alert">{err}</div>}
    </div>
  );
}
