"use client";
import { useEffect, useRef, useState } from "react";
import TalkStage from "./TalkStage";
import { openPdf, type PdfDoc } from "@/lib/pdf";
import { retryMedia, trackPlaying } from "@/lib/mediaRetry";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { SlideMark } from "@/lib/types";

export default function TalkPlayer({ materialId, pdfUrl, audioUrl, marks, notes, signedIn }: {
  materialId: string; pdfUrl: string; audioUrl?: string; marks: SlideMark[]; notes: Record<string, string>; signedIn: boolean;
}) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [err, setErr] = useState("");
  const [resume, setResume] = useState(0);
  const lastSave = useRef(0);

  useEffect(() => { openPdf(pdfUrl).then(setPdf).catch((e) => setErr(String(e?.message ?? e))); }, [pdfUrl]);
  useEffect(() => {
    if (!signedIn || !audioUrl) return;
    const sb = supabaseBrowser();
    sb.auth.getUser().then(({ data }) => data.user && sb.from("talk_progress").select("position_seconds, finished").eq("material_id", materialId).eq("user_id", data.user.id).maybeSingle()
      .then(({ data: r }) => { if (r && !r.finished && r.position_seconds > 10) setResume(r.position_seconds); }));
  }, [materialId, signedIn, audioUrl]);

  // remember where signed-in visitors stopped, at most every 15 seconds
  async function progress(t: number, ended: boolean) {
    if (!signedIn || (!ended && Date.now() - lastSave.current < 15000)) return;
    lastSave.current = Date.now();
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getUser();
    if (data.user) await sb.from("talk_progress").upsert({ user_id: data.user.id, material_id: materialId, position_seconds: Math.floor(t), finished: ended, updated_at: new Date().toISOString() });
  }

  // without the slides the recording still plays
  if (err) return (
    <>
      <div className="note">Couldn&apos;t load the slides. <a href={pdfUrl} target="_blank" rel="noopener">Open the PDF</a> instead.</div>
      {audioUrl && <audio ref={(n) => { if (n) trackPlaying(n); }} controls preload="metadata" src={audioUrl} style={{ width: "100%" }} onError={(e) => retryMedia(e.currentTarget)} />}
    </>
  );
  return (
    <>
      {resume > 0 && <div className="ok">Picking up where you left off.</div>}
      <TalkStage pdf={pdf} mode="play" audioUrl={audioUrl} marks={marks} notes={notes} onProgress={progress} startAt={resume} />
    </>
  );
}
