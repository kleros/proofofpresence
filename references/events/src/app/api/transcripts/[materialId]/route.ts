import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentUser, supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import { ProviderError, providers, summarise, transcribe } from "@/lib/transcript/server";
import { cleanSegments, plainText } from "@/lib/transcript/parse";
import { BUSY, NOT_SET_UP, type Segment, type TranscriptRow, type TranscriptState } from "@/lib/transcript/types";
import type { TalkInfo } from "@/lib/transcript/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Transcribing a two-hour recording on Groq takes well under a minute; the summary another
// minute or two. If the transcript step runs long, the summary is left for a second call.
// Vercel honours maxDuration; Netlify stops every request at 60 seconds, so there the summary
// always gets a call of its own (HOSTING is set at build time in next.config.ts).
export const maxDuration = 300;

const ON_NETLIFY = process.env.HOSTING === "netlify";
const SUMMARY_BUDGET_MS = ON_NETLIFY ? 0 : 150_000;   // start the summary in the same call only before this
const STALE_MS = (ON_NETLIFY ? 2 : 6) * 60_000;       // a run older than this is assumed dead (function timed out)

type Step = "auto" | "transcript" | "summary" | "import";

/**
 * An address the speech to text provider can fetch for a recording: for a file in the private
 * materials bucket, a signed address made with the caller's own session (storage signs only files
 * the caller may see), valid for an hour; a full URL stays as it is.
 */
async function recordingUrl(sb: SupabaseClient, path: string) {
  if (/^https?:\/\//.test(path)) return path;
  const { data, error } = await sb.storage.from("materials").createSignedUrl(path, 60 * 60);
  if (error) throw new ProviderError(`The recording could not be found in storage (${error.message}).`, 422);
  return data.signedUrl;
}

const json = (body: TranscriptState & Record<string, unknown>, status = 200) => NextResponse.json(body, { status });

/**
 * POST /api/transcripts/:materialId
 *   (no step)        transcribe if there is no transcript yet, then summarise. Idempotent:
 *                    a finished transcript is not redone; a run in progress is not doubled.
 *   ?step=transcript transcribe again (and summarise), replacing what is there
 *   ?step=summary    write the summary again from the stored transcript
 *   ?step=import     body { segments, format, timed, language? } from an uploaded .srt/.vtt/.txt
 * Team only. Answers { status, error?, more? }; `more` means call again with ?step=summary.
 */
export async function POST(req: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const t0 = Date.now();
  const { materialId } = await params;
  const step = (new URL(req.url).searchParams.get("step") || "auto") as Step;
  if (!["auto", "transcript", "summary", "import"].includes(step)) return json({ status: "error", error: "Unknown step" }, 400);
  if (!supabaseConfigured) return json({ status: "error", error: "The database is not configured." }, 503);

  const { user, profile } = await currentUser();
  if (!user) return json({ status: "error", error: "Sign in with a team account first." }, 401);
  if (!(profile?.is_team || profile?.is_admin)) return json({ status: "error", error: "Only the team can make transcripts." }, 403);

  const session = await supabaseServer();
  // Writes go through the caller's session (RLS: team only). A service role key, when the
  // deployment has one, is used instead so a run can always record its own failure.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const db: SupabaseClient = serviceKey
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : session;

  const { data: m } = await session.from("materials").select("*, events!materials_event_id_fkey(title, starts_on)").eq("id", materialId).maybeSingle();
  if (!m) return json({ status: "error", error: "Material not found." }, 404);
  if (!["talk", "audio", "video"].includes(m.kind)) return json({ status: "error", error: "Only talks, recordings and videos get transcripts." }, 422);

  const { data: existing, error: readErr } = await db.from("transcripts").select("*").eq("material_id", materialId).maybeSingle();
  if (readErr) return json({ status: "error", error: /does not exist|schema cache/i.test(readErr.message) ? "The transcripts table is missing. Run supabase/migrations/0005_transcripts.sql." : readErr.message }, 500);
  const row = existing as TranscriptRow | null;

  const info: TalkInfo = { title: m.title, speaker: m.speaker, event: m.events?.title ?? null, date: m.events?.starts_on ?? null };
  const save = async (patch: Partial<TranscriptRow>) => {
    // updated_by is set by the database from the session; with the service key it has no session
    const { error } = await db.from("transcripts").upsert({ material_id: materialId, updated_by: user.id, ...patch }, { onConflict: "material_id" });
    if (error) throw new ProviderError(`Saving the transcript failed: ${error.message}`, 500);
  };
  const fail = async (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    await save({ status: "error", error: msg.slice(0, 800) }).catch(() => {});
    const code = e instanceof ProviderError ? (e.status === 503 ? 503 : e.status === 413 || e.status === 422 ? 422 : e.status === 500 ? 500 : 502) : 500;
    return json({ status: "error", error: msg, ...(code === 503 ? { setup: true } : {}) }, code);
  };

  const keys = providers();
  const hasTranscript = !!row?.segments?.length;

  // ---------- an uploaded transcript file
  if (step === "import") {
    let body: { segments?: Segment[]; format?: string; timed?: boolean; language?: string };
    try { body = await req.json(); } catch { return json({ status: "error", error: "The request body was not JSON." }, 400); }
    const segs = cleanSegments(Array.isArray(body.segments) ? body.segments.slice(0, 50_000).map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text ?? "").slice(0, 4000) })) : []);
    if (!segs.length) return json({ status: "error", error: "No text was found in that file." }, 422);
    const format = ["srt", "vtt", "txt"].includes(body.format ?? "") ? body.format : "txt";
    const provider = `upload:${format}${body.timed === false ? "-untimed" : ""}`;
    try {
      await save({
        segments: segs, text: plainText(segs), language: typeof body.language === "string" ? body.language.slice(0, 12) : row?.language ?? null,
        provider, source: "upload", summary: null, error: null, duration_seconds: segs[segs.length - 1].end,
        status: keys.summary ? "summarising" : "done", started_at: new Date().toISOString(),
      });
      if (!keys.summary) return json({ status: "done", error: "Transcript saved. Summaries are not set up yet (add ANTHROPIC_API_KEY)." });
      if (ON_NETLIFY) return json({ status: "summarising", more: true });
      const s = await summarise(info, segs);
      await save({ summary: s.summary, provider: `${provider} + ${s.provider}`, status: "done", error: null });
      return json({ status: "done" });
    } catch (e) { return fail(e); }
  }

  // ---------- a run already in progress (another tab, or the host console)
  const fresh = row?.started_at && Date.now() - new Date(row.started_at).getTime() < STALE_MS;
  const continuing = step === "summary" && row?.status === "summarising";
  if (row && BUSY.includes(row.status) && fresh && !continuing) return json({ status: row.status, busy: true }, 202);

  // ---------- nothing to do
  if (step === "auto" && hasTranscript && (row!.summary || !keys.summary)) return json({ status: "done" });

  // ---------- transcribe
  let segs: Segment[] = row?.segments ?? [];
  let tProvider = row?.provider?.split(" + ")[0] ?? null;
  const needTranscript = step === "transcript" || (step === "auto" && !hasTranscript);
  if (step === "summary" && !hasTranscript) return json({ status: "error", error: "There is no transcript to summarise yet." }, 422);

  if (needTranscript) {
    const path = m.kind === "talk" ? m.audio_path : m.file_path;
    if (!path) return json({ status: "error", error: "This item has no recording stored on the site. Upload a transcript file (.srt, .vtt or .txt) instead." }, 422);
    if (!keys.transcribe) return json({ status: "error", error: NOT_SET_UP, setup: true }, 503);
    try {
      await save({ status: "transcribing", error: null, started_at: new Date().toISOString(), source: "audio" });
      const r = await transcribe(await recordingUrl(session, path), info);
      if (!r.segments.length) throw new ProviderError("No speech was found in the recording.", 422);
      segs = r.segments; tProvider = r.provider;
      await save({
        segments: segs, text: plainText(segs), language: r.language, provider: r.provider, source: "audio",
        duration_seconds: r.duration ?? segs[segs.length - 1].end, summary: null,
        status: keys.summary ? "summarising" : "done",
      });
    } catch (e) { return fail(e); }
    if (!keys.summary) return json({ status: "done", error: "Transcript saved. Summaries are not set up yet (add ANTHROPIC_API_KEY)." });
    if (Date.now() - t0 > SUMMARY_BUDGET_MS) return json({ status: "summarising", more: true });
  }

  // ---------- summarise
  if (!keys.summary) return json({ status: "error", error: NOT_SET_UP, setup: true }, 503);
  try {
    await save({ status: "summarising", error: null, ...(needTranscript ? {} : { started_at: new Date().toISOString() }) });
    const s = await summarise(info, segs);
    await save({ summary: s.summary, status: "done", error: null, provider: [tProvider, s.provider].filter(Boolean).join(" + ") });
    return json({ status: "done" });
  } catch (e) { return fail(e); }
}
