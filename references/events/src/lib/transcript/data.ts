// Server-side reads of transcripts, for pages (public; RLS allows anyone to read).
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import type { TranscriptRow } from "./types";

/** The transcript row for one material, or null (also when the 0005 migration is not applied yet). */
export async function getTranscript(materialId: string): Promise<TranscriptRow | null> {
  if (!supabaseConfigured) return null;
  const sb = await supabaseServer();
  const { data, error } = await sb.from("transcripts").select("*").eq("material_id", materialId).maybeSingle();
  return error ? null : (data as TranscriptRow | null);
}

export interface TranscriptFlag { transcript: boolean; summary: boolean }

/**
 * Which materials have a finished transcript and summary, for small indicators on talk
 * cards and archive rows: `const flags = await transcriptFlags(ids)`, then
 * `flags[m.id]?.summary`. One query, only small columns. Empty when the table is missing.
 */
export async function transcriptFlags(materialIds: string[]): Promise<Record<string, TranscriptFlag>> {
  if (!supabaseConfigured || !materialIds.length) return {};
  const sb = await supabaseServer();
  const { data, error } = await sb.from("transcripts").select("material_id, tldr:summary->>tldr, first:segments->0").in("material_id", materialIds);
  if (error || !data) return {};
  const out: Record<string, TranscriptFlag> = {};
  for (const r of data as unknown as { material_id: string; tldr: string | null; first: unknown }[]) {
    out[r.material_id] = { transcript: r.first != null, summary: !!r.tldr };
  }
  return out;
}

/** Server-side: which providers this deployment has keys for (booleans only, safe to pass to the browser). */
export function transcriptSetup() {
  const has = (k: string) => !!process.env[k]?.trim();
  return { transcribe: has("GROQ_API_KEY") || has("OPENAI_API_KEY"), summary: has("ANTHROPIC_API_KEY") || has("GROQ_API_KEY") || has("OPENAI_API_KEY") };
}
