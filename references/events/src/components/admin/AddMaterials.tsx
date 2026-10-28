"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { kindOf, uploadToStorage } from "@/lib/materials-client";
import type { Material, MaterialKind } from "@/lib/types";

/**
 * Upload files (slides, audio, video, documents, photos) or add a link to an event. Used by
 * the event editor and the team tools on the event page. `extra` renders more buttons in the
 * same row (the event editor puts "Add a talk" there).
 */
export default function AddMaterials({ eventId, onAdded, extra, idPrefix = "am" }: {
  eventId: string; onAdded: (m: Material) => void; extra?: React.ReactNode; idPrefix?: string;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [over, setOver] = useState(false);

  async function addRow(row: Partial<Material>) {
    const { data, error } = await supabaseBrowser().from("materials").insert({ event_id: eventId, ...row }).select("*").single();
    if (error) throw error;
    onAdded(data as Material);
  }
  async function upload(files: File[]) {
    setErr(""); setDone("");
    let n = 0;
    for (const f of files) {
      setBusy(`Uploading ${f.name}…`);
      try {
        const path = await uploadToStorage(eventId, f, f.name);
        let pages: number | undefined;
        if (kindOf(f) === "slides") { const { openPdf } = await import("@/lib/pdf"); pages = (await openPdf(await f.arrayBuffer())).numPages; }
        await addRow({ kind: kindOf(f), title: f.name.replace(/\.[^.]+$/, ""), file_path: path, size_bytes: f.size, pages });
        n++;
      } catch (e) { setErr(`${f.name}: ${(e as Error).message}`); }
    }
    setBusy("");
    if (n) setDone(n === 1 ? "Added 1 file." : `Added ${n} files.`);
  }
  async function addLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(""); setDone("");
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await addRow({ kind: String(f.get("kind")) as MaterialKind, title: String(f.get("title")), url: String(f.get("url")), speaker: String(f.get("speaker")) || null });
      form.reset(); setLinkOpen(false); setDone("Link added.");
    } catch (er) { setErr((er as Error).message); }
  }

  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="stack">
      <div className="row-flex">
        {extra}
        <label className="btn">Upload files<input type="file" multiple hidden accept=".pdf,image/*,video/*,audio/*,.m4a,.mp3,.doc,.docx,.txt,.md" onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} /></label>
        <button className="btn" type="button" onClick={() => setLinkOpen(!linkOpen)} aria-expanded={linkOpen}>Add a link or post</button>
      </div>
      <div className={`am-drop${over ? " is-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}>
        <span className="muted small">Drop slides (PDF), audio, video, documents or photos here. Export Keynote or PowerPoint decks to PDF first. Each file must stay under 50 MB.</span>
      </div>
      {busy && <div className="muted small" role="status">{busy}</div>}
      {done && !busy && <div className="ok" role="status">{done}</div>}
      {err && <div className="note">{err}</div>}
      {linkOpen && (
        <form className="box" onSubmit={addLink}>
          <div className="two">
            <div className="field"><label htmlFor={id("t")}>Title</label><input id={id("t")} name="title" required placeholder="Panel recording on YouTube" /></div>
            <div className="field"><label htmlFor={id("k")}>Type</label><select id={id("k")} name="kind"><option value="video">Video (YouTube, Drive)</option><option value="social">Social post (X, LinkedIn)</option><option value="link">Article or link</option><option value="slides">Slides (Google Slides, Docsend)</option><option value="doc">Doc</option></select></div>
          </div>
          <div className="two">
            <div className="field"><label htmlFor={id("u")}>URL</label><input id={id("u")} name="url" type="url" required placeholder="https://" /></div>
            <div className="field"><label htmlFor={id("s")}>Speaker</label><input id={id("s")} name="speaker" /></div>
          </div>
          <div className="row-flex">
            <button className="btn primary sm" type="submit">Add link</button>
            <button className="btn ghost sm" type="button" onClick={() => setLinkOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
