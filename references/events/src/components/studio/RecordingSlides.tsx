"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Material } from "@/lib/types";
import { fileUrl, linkUrl } from "../MaterialRow";
import { removeFiles } from "@/lib/materials-client";

type Rec = Pick<Material, "id" | "kind" | "url" | "pdf_path" | "audio_path" | "file_path" | "pages">;

/** Google Slides can sit in the page; other decks (a claude.ai artifact, Pitch, Canva) refuse to be framed. */
const googleSlidesId = (url: string) => url.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/)?.[1];

/**
 * The slides of a recording that live elsewhere (a recording's `url`): shown in the page when
 * the deck allows it, otherwise opened in a window of their own so the audio keeps playing. Editors
 * set or change the link here, and can take off the PDF of a slide-synced talk (the audio stays).
 */
export default function RecordingSlides({ m, canEdit }: { m: Rec; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [armed, setArmed] = useState(false);
  const stored = m.url && /^https?:\/\//.test(m.url) ? m.url : "";
  // an old public file address opens through /f/
  const url = linkUrl(stored);
  const gs = stored ? googleSlidesId(stored) : undefined;

  function openSide() {
    const w = Math.round(window.screen.availWidth * 0.62), h = Math.round(window.screen.availHeight * 0.85);
    const win = window.open(url, "kleros-slides", `popup,width=${w},height=${h},left=0,top=0`);
    if (!win) window.open(url, "_blank", "noopener");
  }

  async function saveLink(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); setErr(""); setMsg("");
    const next = String(new FormData(ev.currentTarget).get("slides_url") ?? "").trim();
    if (next && !/^https:\/\/\S+$/.test(next)) { setErr("Paste the full link, starting with https://"); return; }
    setBusy("Saving…");
    const { error } = await supabaseBrowser().from("materials").update({ url: next || null }).eq("id", m.id).select("id").single();
    setBusy("");
    if (error) { setErr(`The link was not saved: ${error.message}`); return; }
    setMsg(next ? "Slides linked." : "Slides link removed.");
    router.refresh();
  }

  // a slide-synced talk becomes a plain recording: the audio stays, the PDF goes
  async function dropPdf() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 6000); return; }
    setArmed(false); setErr(""); setMsg(""); setBusy("Removing the PDF…");
    const sb = supabaseBrowser();
    const old = m.pdf_path;
    // the size shown becomes the audio's alone
    const head = m.audio_path ? await fetch(fileUrl(m.audio_path), { method: "HEAD" }).catch(() => null) : null;
    const size = Number(head?.ok && head.headers.get("content-length")) || undefined;
    const { error } = await sb.from("materials")
      .update({ kind: "audio", file_path: m.audio_path, audio_path: null, pdf_path: null, pages: null, marks: [], ...(size ? { size_bytes: size } : {}) })
      .eq("id", m.id).select("id").single();
    if (error) { setBusy(""); setErr(`Nothing changed: ${error.message}`); return; }
    // the file goes too, unless another item uses it
    let fileGone = true;
    if (old && !/^https?:\/\//.test(old)) {
      const uses = await Promise.all((["file_path", "pdf_path", "audio_path"] as const).map((c) =>
        sb.from("materials").select("id", { count: "exact", head: true }).eq(c, old)));
      if (uses.every((r) => !r.error && !r.count)) fileGone = await removeFiles([old]);
    }
    setBusy(""); setMsg(fileGone ? "The PDF is off. The recording plays as audio." : "The PDF is off. The recording plays as audio. The PDF file could not be deleted from storage.");
    router.refresh();
  }

  const editable = canEdit && (m.kind === "talk" || m.kind === "audio");
  if (!url && !editable) return null;
  return (
    <div className="rec-slides stack">
      {url && (gs ? (
        <div className="video"><iframe src={`https://docs.google.com/presentation/d/${gs}/embed`} allowFullScreen title="Slides" /></div>
      ) : (
        <div className="panel rec-slides-card">
          <div>
            <div className="eyebrow">Slides</div>
            <p className="muted small">The slides open in a window of their own, so the recording keeps playing here.</p>
          </div>
          <div className="row-flex">
            <button type="button" className="btn primary" onClick={openSide}>Open the slides ↗</button>
            <a className="btn ghost" href={url} target="_blank" rel="noopener">New tab</a>
          </div>
        </div>
      ))}
      {editable && (
        <details className="panel rec-slides-edit">
          <summary>Slides for this recording</summary>
          <form className="stack" onSubmit={saveLink}>
            <div className="field">
              <label htmlFor={`rs-${m.id}`}>Link to the slides</label>
              <input id={`rs-${m.id}`} name="slides_url" type="url" defaultValue={stored} placeholder="https://claude.ai/artifact/…, Google Slides, Pitch…" />
              <span className="muted small">Shown above the recording. Leave empty and save to remove it.</span>
            </div>
            <div className="row-flex"><button className="btn sm primary" type="submit" disabled={!!busy}>{busy || "Save link"}</button></div>
          </form>
          {m.kind === "talk" && m.pdf_path && (
            <div className="stack rec-slides-pdf">
              <p className="muted small">This recording plays with a PDF{m.pages ? ` of ${m.pages} slide${m.pages === 1 ? "" : "s"}` : ""}. Taking it off keeps the audio and deletes the PDF file.</p>
              <div className="row-flex">
                <button type="button" className={`btn sm${armed ? " danger-armed" : ""}`} onClick={dropPdf} disabled={!!busy}>{armed ? "Confirm: take the PDF off" : "Take the PDF off"}</button>
              </div>
            </div>
          )}
          {msg && <div className="ok" role="status">{msg}</div>}
          {err && <div className="note" role="alert">{err}</div>}
        </details>
      )}
    </div>
  );
}
