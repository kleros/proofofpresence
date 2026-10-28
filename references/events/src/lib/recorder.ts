"use client";
// Event recording on the laptop: MediaRecorder chunks are written to IndexedDB as they
// arrive, so a crashed tab or a closed lid doesn't lose the talk. The session record keeps
// the title, speaker and slide marks; the slides PDF is stored once, under the session id in
// its own store, so a recovered recording can still be saved as a slide-synced talk without
// rewriting the PDF on every update.

import type { SlideMark } from "./types";

const DB = "kleros-events-rec";
// v1: sessions (PDF blob inside each record) + chunks. v2: PDFs move to their own store.
const VERSION = 2;

let dbp: Promise<IDBDatabase> | null = null;

/** One shared connection per tab; reopened if another tab upgrades the database or it closes. */
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((res, rej) => {
    if (typeof indexedDB === "undefined") { rej(new Error("IndexedDB is not available")); return; }
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = (ev) => {
      const db = r.result;
      const tx = r.transaction!;
      if (ev.oldVersion < 1) {
        db.createObjectStore("sessions", { keyPath: "id" });
        db.createObjectStore("chunks", { autoIncrement: true }).createIndex("session", "session");
      }
      if (ev.oldVersion < 2) {
        const pdfs = db.createObjectStore("pdfs");
        // move PDFs out of existing session records; keep everything else as it was
        const cur = tx.objectStore("sessions").openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          const { pdf, ...rest } = c.value as RecSession & { pdf?: Blob | null };
          if (pdf) pdfs.put(pdf, rest.id);
          c.update({ ...rest, hasPdf: !!pdf });
          c.continue();
        };
      }
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      db.onclose = () => { dbp = null; };
      res(db);
    };
    r.onerror = () => { dbp = null; rej(r.error); };
    r.onblocked = () => { dbp = null; rej(new Error("The recording backup is busy in another tab")); };
  });
  return dbp;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/** Session metadata only: small, rewritten every few seconds while recording. */
export interface RecSession {
  id: string;
  eventId: string;
  startedAt: number;
  mime: string;
  seconds: number;
  title?: string;
  speaker?: string;
  agendaId?: string | null;
  marks?: SlideMark[];
  pages?: number;
  hasPdf?: boolean;
  pdfName?: string;
  pdfBytes?: number;
  bytes?: number;
  updatedAt?: number;
}

export async function saveSession(s: RecSession) {
  const db = await open();
  const tx = db.transaction("sessions", "readwrite");
  tx.objectStore("sessions").put(s);
  await done(tx);
}

/** The slides for a session, written once when recording starts. */
export async function savePdf(session: string, pdf: Blob) {
  const db = await open();
  const tx = db.transaction("pdfs", "readwrite");
  tx.objectStore("pdfs").put(pdf, session);
  await done(tx);
}

export async function sessionPdf(session: string): Promise<Blob | null> {
  const db = await open();
  return ((await req(db.transaction("pdfs").objectStore("pdfs").get(session))) as Blob | undefined) ?? null;
}

export async function addChunk(session: string, blob: Blob) {
  const db = await open();
  const tx = db.transaction("chunks", "readwrite");
  tx.objectStore("chunks").add({ session, blob });
  await done(tx);
}

export async function unsavedSessions(eventId: string): Promise<RecSession[]> {
  const db = await open();
  const all = (await req(db.transaction("sessions").objectStore("sessions").getAll())) as RecSession[];
  return all.filter((s) => s.eventId === eventId).sort((a, b) => b.startedAt - a.startedAt);
}

export async function sessionBlob(s: RecSession): Promise<Blob> {
  const db = await open();
  const rows = (await req(db.transaction("chunks").objectStore("chunks").index("session").getAll(s.id))) as { blob: Blob }[];
  return new Blob(rows.map((r) => r.blob), { type: s.mime });
}

export async function dropSession(id: string) {
  const db = await open();
  const tx = db.transaction(["sessions", "chunks", "pdfs"], "readwrite");
  tx.objectStore("sessions").delete(id);
  tx.objectStore("pdfs").delete(id);
  const idx = tx.objectStore("chunks").index("session");
  const r = idx.openKeyCursor(IDBKeyRange.only(id));
  r.onsuccess = () => { const c = r.result; if (c) { tx.objectStore("chunks").delete(c.primaryKey); c.continue(); } };
  await done(tx);
}

/** Opus in WebM where available (Chrome, Edge, Firefox), AAC in MP4 for Safari. */
export function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"]) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* older Safari throws on unknown types */ }
  }
  return "";
}

export const canRecord = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export const audioExt = (type: string) => (/mp4|m4a|aac/.test(type) ? "m4a" : type.includes("ogg") ? "ogg" : "webm");
