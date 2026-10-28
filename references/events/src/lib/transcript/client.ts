"use client";
// Browser side of transcripts: start a run through the API route and follow it to the end,
// and a tiny event bus so transcript lines and chapters can seek whichever player is on the page.
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BUSY, type Segment, type TranscriptRow, type TranscriptState } from "./types";

type Step = "auto" | "transcript" | "summary" | "import";

/** Reads the stored row (public). Null when there is none or the table is missing. */
export async function fetchTranscript(materialId: string): Promise<TranscriptRow | null> {
  const { data, error } = await supabaseBrowser().from("transcripts").select("*").eq("material_id", materialId).maybeSingle();
  return error ? null : (data as TranscriptRow | null);
}

/** Polls the stored row until the run ends (or about 7 minutes pass). */
export async function waitForTranscript(materialId: string, onStatus: (s: TranscriptState) => void, maxMs = 7 * 60_000): Promise<TranscriptState> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000));
    const row = await fetchTranscript(materialId).catch(() => null);
    if (!row) continue;
    const s: TranscriptState = { status: row.status, error: row.error };
    onStatus(s);
    if (!BUSY.includes(row.status)) return s;
  }
  return { status: "error", error: "This is taking longer than expected. Reload the page later to see the result." };
}

/**
 * Starts (or continues) a transcript run and follows it until it is done or fails. Never
 * throws: problems come back as { status: "error" }.
 */
export async function runTranscript(materialId: string, onStatus: (s: TranscriptState) => void, opts: { step?: Step; body?: unknown } = {}): Promise<TranscriptState> {
  let step: Step = opts.step ?? "auto";
  onStatus({ status: step === "summary" || step === "import" ? "summarising" : "transcribing" });
  for (let i = 0; i < 4; i++) {
    let res: Response;
    try {
      res = await fetch(`/api/transcripts/${materialId}?step=${step}`, {
        method: "POST",
        headers: opts.body && step === "import" ? { "content-type": "application/json" } : undefined,
        body: opts.body && step === "import" ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      // the connection dropped; the server may still be working, so watch the row
      return waitForTranscript(materialId, onStatus);
    }
    let s: TranscriptState & { busy?: boolean };
    try { s = await res.json(); }
    catch {
      // a platform timeout page (504) rather than our JSON: follow the stored status instead
      if (res.status === 504 || res.status === 502) return waitForTranscript(materialId, onStatus);
      s = { status: "error", error: `The server answered ${res.status}.` };
    }
    onStatus(s);
    if (s.busy) return waitForTranscript(materialId, onStatus);
    if (s.more) { step = "summary"; continue; }
    return s;
  }
  return { status: "error", error: "The transcript did not finish. Try again." };
}

// ---------------------------------------------------------------- media bus

const SEEK = "kleros:media-seek";
const TIME = "kleros:media-time";
type MediaTime = { t: number; playing: boolean };

/** Asks the player on the page to jump to t seconds and play. Returns whether a player took it. */
export function seekTo(t: number): boolean {
  return !window.dispatchEvent(new CustomEvent(SEEK, { detail: t, cancelable: true }));
}

/** Players call this on timeupdate / play / pause. */
export function emitTime(t: number, playing: boolean) {
  window.dispatchEvent(new CustomEvent<MediaTime>(TIME, { detail: { t, playing } }));
}

/** Players subscribe to seek requests; a handler returns false when it could not take one. Returns the unsubscribe function. */
export function onSeek(fn: (t: number) => boolean | void) {
  const h = (e: Event) => { if (fn((e as CustomEvent<number>).detail) !== false) e.preventDefault(); };
  window.addEventListener(SEEK, h);
  return () => window.removeEventListener(SEEK, h);
}

/** Current playback time and state of whichever player is on the page. */
export function useMediaTime() {
  // starts at rest on every page: a player reports within a moment once it plays
  const [s, set] = useState<MediaTime>({ t: 0, playing: false });
  useEffect(() => {
    const h = (e: Event) => set((e as CustomEvent<MediaTime>).detail);
    window.addEventListener(TIME, h);
    return () => window.removeEventListener(TIME, h);
  }, []);
  return s;
}

/** Downloads text as a file. */
export function saveText(name: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export type { Segment };
