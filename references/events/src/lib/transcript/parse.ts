// Transcript text utilities with no browser or server dependencies: parse .srt / .vtt /
// .txt files into segments, clean and merge segments, and write .srt / .txt back out.
import type { Segment } from "./types";

const TS = /(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/;

/** "01:02:03,450", "02:03.450", "2:03" or "1:02:03" to seconds; NaN when it is not a time. */
export function parseTime(s: string): number {
  const m = s.trim().match(new RegExp(`^${TS.source}$`));
  if (!m) return NaN;
  const [, h, mm, ss, ms] = m;
  return (Number(h ?? 0) * 3600) + Number(mm) * 60 + Number(ss) + (ms ? Number(ms.padEnd(3, "0")) / 1000 : 0);
}

function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }

/** 3725.4 to "01:02:05,400" (SRT) or "01:02:05.400" (VTT). */
export function srtTime(t: number, sep = ",") {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

/** 65 to "1:05", 3725 to "1:02:05". */
export function clock(t: number) {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

/** The speaker of a VTT voice tag (<v Ana>), kept as a "Ana: " prefix. */
const voice = (s: string) => s.replace(/<v(?:\.[\w.-]+)?\s+([^>]+)>/g, (_, who) => `${who.trim()}: `);

/** Parses SRT or WebVTT cues. Tolerates missing indexes, CRLF, BOM, cue settings, tags and NOTE/STYLE blocks. */
export function parseCues(src: string): Segment[] {
  const blocks = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const out: Segment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue; // WEBVTT header, NOTE, STYLE, REGION, or stray text
    const [a, rest] = lines[i].split("-->");
    const start = parseTime(a);
    const end = parseTime(rest.trim().split(/\s+/)[0] ?? "");
    if (!isFinite(start)) continue;
    const text = lines.slice(i + 1).map((l) => stripTags(voice(l)).trim()).filter(Boolean).join(" ");
    if (!text) continue;
    out.push({ start, end: isFinite(end) && end >= start ? end : start, text });
  }
  return dedupeRolling(out);
}

/**
 * YouTube auto-captions repeat the previous line at the start of the next cue ("rolling"
 * captions). Drop the repeated prefix so the text reads once.
 */
function dedupeRolling(cues: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    if (prev && c.text === prev.text) { prev.end = Math.max(prev.end, c.end); continue; }
    if (prev && c.text.startsWith(prev.text + " ") && c.start - prev.start < 10) {
      const rest = c.text.slice(prev.text.length + 1).trim();
      if (rest) out.push({ ...c, text: rest });
      continue;
    }
    out.push({ ...c });
  }
  return out;
}

const LEAD_TS = new RegExp(`^\\[?\\(?(${TS.source})\\]?\\)?\\s*[-:\\u2013]?\\s*(.*)$`);

/**
 * Plain text. Understands lines that start with a timestamp ("[01:05] text", "1:05 text"),
 * timestamps on their own line followed by text (the YouTube "Show transcript" copy), and
 * text with no timestamps at all, which becomes one segment per paragraph with times
 * estimated from word count. `timed` says which happened.
 */
export function parseText(src: string, durationHint?: number): { segments: Segment[]; timed: boolean } {
  const lines = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const stamped: { t: number; text: string }[] = [];
  let anyTs = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(LEAD_TS);
    const t = m ? parseTime(m[1]) : NaN;
    if (m && isFinite(t)) { anyTs++; stamped.push({ t, text: m[m.length - 1].trim() }); }
    else if (stamped.length) stamped[stamped.length - 1].text += (stamped[stamped.length - 1].text ? " " : "") + line;
    else stamped.push({ t: NaN, text: line });
  }
  if (anyTs >= 2) {
    const rows = stamped.filter((r) => isFinite(r.t) && r.text);
    const segs = rows.map((r, i) => ({ start: r.t, end: rows[i + 1]?.t ?? r.t + Math.max(2, words(r.text) / 2.5), text: r.text }));
    return { segments: segs.sort((a, b) => a.start - b.start), timed: true };
  }
  // no timestamps: paragraphs (or sentences of a single wall of text) at ~150 words a minute
  let paras = src.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (paras.length < 3) paras = chunkSentences(paras.join(" "), 60);
  const total = paras.reduce((n, p) => n + words(p), 0) || 1;
  const rate = durationHint && durationHint > 0 ? total / durationHint : 2.5; // words per second
  let t = 0;
  const segments = paras.map((p) => { const d = words(p) / rate; const s = { start: t, end: t + d, text: p }; t += d; return s; });
  return { segments, timed: false };
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function chunkSentences(s: string, maxWords: number): string[] {
  const sentences = s.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [s];
  const out: string[] = [];
  let cur = "";
  for (const x of sentences) {
    if (cur && words(cur) + words(x) > maxWords) { out.push(cur.trim()); cur = ""; }
    cur += x;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Picks the parser from the file name or the content. */
export function parseTranscriptFile(name: string, src: string, durationHint?: number): { segments: Segment[]; timed: boolean; format: "srt" | "vtt" | "txt" } {
  const ext = name.toLowerCase().split(".").pop();
  const looksCues = /\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*\d/.test(src);
  if (ext === "srt" || ext === "vtt" || looksCues) {
    const segments = parseCues(src);
    if (segments.length) return { segments, timed: true, format: /^﻿?WEBVTT/.test(src) || ext === "vtt" ? "vtt" : "srt" };
  }
  return { ...parseText(src, durationHint), format: "txt" };
}

/**
 * Tidies segments from any source: trims, collapses whitespace, drops empties and exact
 * back-to-back repeats (a Whisper habit on silence), sorts, and keeps end >= start and
 * starts non-decreasing.
 */
export function cleanSegments(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of [...segs].filter((x) => x && isFinite(x.start)).sort((a, b) => a.start - b.start)) {
    const text = String(s.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const start = Math.max(0, Math.round(s.start * 100) / 100);
    const end = Math.max(start, Math.round((isFinite(s.end) ? s.end : start) * 100) / 100);
    const prev = out[out.length - 1];
    if (prev && prev.text === text && start - prev.end < 2) { prev.end = Math.max(prev.end, end); continue; }
    out.push({ start, end, text });
  }
  return out;
}

/** Shifts each part's segments by its start time and joins them into one list. */
export function joinParts(parts: { offset: number; segments: Segment[] }[]): Segment[] {
  return cleanSegments(parts.flatMap((p) => p.segments.map((s) => ({ start: s.start + p.offset, end: s.end + p.offset, text: s.text }))));
}

export const plainText = (segs: Segment[]) => segs.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();

/**
 * Display paragraphs: consecutive segments merged until a sentence ends and the paragraph
 * is long enough, a pause of over 2.5 s, or 60 s of speech. Each keeps the start of its
 * first segment, so clicking it seeks there.
 */
export function paragraphs(segs: Segment[], { minChars = 220, maxSecs = 60, gap = 2.5 } = {}): Segment[] {
  const out: Segment[] = [];
  let cur: Segment | null = null;
  for (const s of segs) {
    if (cur && (s.start - cur.end > gap || s.start - cur.start > maxSecs || (cur.text.length >= minChars && /[.!?]["')\]]*$/.test(cur.text)))) {
      out.push(cur); cur = null;
    }
    cur = cur ? { start: cur.start, end: Math.max(cur.end, s.end), text: `${cur.text} ${s.text}` } : { ...s };
  }
  if (cur) out.push(cur);
  return out;
}

/** Index of the item playing at time t (the last one that started at or before t), or -1. */
export function indexAt(items: { start: number }[], t: number): number {
  let lo = 0, hi = items.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (items[mid].start <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

export function toSrt(segs: Segment[]): string {
  return segs.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(Math.max(s.end, s.start + 0.5))}\n${s.text}\n`).join("\n");
}

export function toTxt(segs: Segment[], header = "", timed = true): string {
  const body = segs.map((s) => (timed ? `[${clock(s.start)}] ` : "") + s.text).join("\n\n");
  return (header ? header + "\n\n" : "") + body + "\n";
}
