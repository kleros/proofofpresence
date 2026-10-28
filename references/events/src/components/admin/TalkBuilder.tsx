"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { openPdf, type PdfDoc } from "@/lib/pdf";
import type { Material, SlideMark } from "@/lib/types";
import TalkStage, { type StageMode } from "../TalkStage";
import { uploadToStorage } from "./MaterialsManager";

type Step = "setup" | StageMode;

export default function TalkBuilder({ eventId, onSaved }: { eventId: string; onSaved: (m: Material) => void }) {
  const [step, setStep] = useState<Step>("setup");
  const [title, setTitle] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [marks, setMarks] = useState<SlideMark[]>([]);
  const [duration, setDuration] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState("");

  async function needPdf() {
    if (!pdfFile) { setErr("Choose the slides as a PDF first."); return false; }
    try { setPdf(await openPdf(await pdfFile.arrayBuffer())); return true; }
    catch (e) { setErr("Couldn't open that PDF: " + (e as Error).message); return false; }
  }
  async function startLive() { setErr(""); if (await needPdf()) setStep("record"); }
  async function useRecording(f: File | undefined) {
    if (!f) return; setErr("");
    if (!(await needPdf())) return;
    setAudio(f); setAudioUrl(URL.createObjectURL(f)); setStep("sync");
  }
  function captured(r: { marks: SlideMark[]; duration: number; audio?: Blob }) {
    setMarks(r.marks); setDuration(r.duration);
    if (r.audio) { setAudio(r.audio); setAudioUrl(URL.createObjectURL(r.audio)); }
    setStep("review");
  }
  async function save() {
    if (!pdfFile || !audio || !pdf) return;
    setErr("");
    try {
      setSaving("Uploading slides…");
      const pdfPath = await uploadToStorage(eventId, pdfFile, pdfFile.name);
      setSaving("Uploading recording…");
      const ext = /mp4|m4a/.test(audio.type) ? "m4a" : audio.type.includes("mpeg") ? "mp3" : "webm";
      const audioPath = await uploadToStorage(eventId, audio, (audio as File).name || `talk.${ext}`);
      setSaving("Saving…");
      const { data, error } = await supabaseBrowser().from("materials").insert({
        event_id: eventId, kind: "talk", title: title.trim() || pdfFile.name.replace(/\.pdf$/i, ""), speaker: speaker.trim() || null,
        pdf_path: pdfPath, audio_path: audioPath, pages: pdf.numPages, duration_seconds: Math.round(duration),
        marks: marks.map((m) => ({ p: m.p, t: Math.round(m.t * 10) / 10 })), notes: Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim())),
        size_bytes: pdfFile.size + audio.size,
      }).select("*").single();
      if (error) throw error;
      onSaved(data as Material);
    } catch (e) { setErr((e as Error).message); }
    setSaving("");
  }

  const stepNo = step === "setup" ? 0 : step === "review" ? 2 : 1;
  return (
    <div className="panel">
      <div className="mono small muted">{["Slides", "Record or sync", "Check & save"].map((s, i) => <span key={s} style={i === stepNo ? { color: "var(--fg)", fontWeight: 600 } : undefined}>{i ? " · " : ""}{i + 1}. {s}</span>)}</div>
      {step === "setup" && (
        <div className="stack">
          <div className="two">
            <div className="field"><label htmlFor="tk-t">Talk title</label><input id="tk-t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Paid to be right" /></div>
            <div className="field"><label htmlFor="tk-s">Speaker</label><input id="tk-s" value={speaker} onChange={(e) => setSpeaker(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="tk-pdf">Slides (PDF)</label><input id="tk-pdf" type="file" accept=".pdf,application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} /></div>
          <div className="row-flex">
            <button className="btn primary sm" onClick={startLive}><span className="dot" /> Present &amp; record live</button>
            <label className="btn sm">I already have a recording<input type="file" hidden accept="audio/*,video/webm,video/mp4,.m4a,.mp3" onChange={(e) => { useRecording(e.target.files?.[0]); e.target.value = ""; }} /></label>
          </div>
          <div className="muted small">Live: present from this screen and every slide change is timestamped as you go. Already recorded: play it back once and press Next slide (or →) whenever the speaker moves on.</div>
        </div>
      )}
      {(step === "record" || step === "sync") && (
        <TalkStage pdf={pdf} mode={step} audioUrl={step === "sync" ? audioUrl : undefined} marks={[]} notes={{}} onCaptured={captured} />
      )}
      {step === "review" && (
        <>
          <TalkStage pdf={pdf} mode="review" audioUrl={audioUrl} marks={marks} notes={notes} onNotes={setNotes} />
          <div className="row-flex">
            <button className="btn primary" onClick={save} disabled={!!saving}>{saving || "Save talk to event"}</button>
            <button className="btn ghost" onClick={() => { setStep("setup"); setMarks([]); }}>Start over</button>
          </div>
        </>
      )}
      {err && <div className="note">{err}</div>}
    </div>
  );
}
