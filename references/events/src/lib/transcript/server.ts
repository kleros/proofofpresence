// Speech to text and summaries, server side only. Providers are picked from whichever keys
// the deployment has: GROQ_API_KEY or OPENAI_API_KEY for transcription; ANTHROPIC_API_KEY,
// then GROQ_API_KEY, then OPENAI_API_KEY for the summary.
import Anthropic from "@anthropic-ai/sdk";
import type { Segment, Summary } from "./types";
import { cleanSegments, joinParts } from "./parse";
import { SUMMARY_SCHEMA, SUMMARY_SYSTEM, chunkSegments, extractJson, mergeSummaries, normaliseSummary, userPrompt, type TalkInfo } from "./summary";
import { isWebm, splitWebm } from "./webm";

const env = (k: string) => process.env[k]?.trim() || "";
const MB = 1024 * 1024;
// Base URLs can be overridden for testing against a local stand-in (the Anthropic SDK reads ANTHROPIC_BASE_URL itself).
const groqBase = () => env("GROQ_BASE_URL") || "https://api.groq.com/openai/v1";
const openaiBase = () => env("OPENAI_BASE_URL") || "https://api.openai.com/v1";

export function providers() {
  const groq = env("GROQ_API_KEY"), openai = env("OPENAI_API_KEY"), anthropic = env("ANTHROPIC_API_KEY");
  return {
    transcribe: groq ? "groq" : openai ? "openai" : null,
    summary: anthropic ? "anthropic" : groq ? "groq" : openai ? "openai" : null,
  } as const;
}

export class ProviderError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

// ---------------------------------------------------------------- HTTP helpers

async function withRetry(label: string, fn: () => Promise<Response>, tries = 3): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    const r = await fn();
    if (r.ok) return r;
    last = r;
    if (r.status !== 429 && r.status < 500) break;
    if (i === tries - 1) break;
    const wait = Math.min(20, Number(r.headers.get("retry-after")) || 2 * (i + 1));
    await new Promise((res) => setTimeout(res, wait * 1000));
  }
  const body = await last!.text().catch(() => "");
  let msg = body;
  try { const j = JSON.parse(body); msg = j.error?.message ?? j.message ?? body; } catch { /* plain text */ }
  throw new ProviderError(`${label} answered ${last!.status}: ${String(msg).slice(0, 300)}`, last!.status === 413 ? 413 : 502);
}

/** Content-Length of a public file, or 0 when the server does not say. */
async function remoteSize(url: string): Promise<number> {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!r.ok) throw new ProviderError(`The recording could not be found at its storage address (${r.status}).`, 422);
    return Number(r.headers.get("content-length")) || 0;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    return 0;
  }
}

async function download(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new ProviderError(`The recording could not be downloaded (${r.status}).`, 422);
  return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") || "" };
}

// ---------------------------------------------------------------- transcription

export interface TranscribeResult { segments: Segment[]; language: string | null; duration: number | null; provider: string }

interface VerboseJson { text?: string; language?: string; duration?: number; segments?: { start: number; end: number; text: string; no_speech_prob?: number }[] }

const vocabulary = (info: TalkInfo) =>
  [info.title, info.speaker, "Kleros, PNK, Pinakion, Kleros Court, Curate, Scout, Proof of Humanity, Escrow, Schelling point, jurors, appeal, Arbitrum, Gnosis, futarchy."]
    .filter(Boolean).join(". ").slice(0, 600);

function toSegments(j: VerboseJson): Segment[] {
  const segs = (j.segments ?? [])
    // Whisper sometimes "hears" a stock phrase in silence; drop segments it is sure are not speech
    .filter((s) => !(typeof s.no_speech_prob === "number" && s.no_speech_prob > 0.85 && s.text.trim().split(/\s+/).length < 6))
    .map((s) => ({ start: s.start, end: s.end, text: s.text }));
  if (!segs.length && j.text?.trim()) return [{ start: 0, end: j.duration ?? 0, text: j.text }];
  return segs;
}

const extFor = (type: string) => (/mp4|m4a|aac/.test(type) ? "m4a" : /mpeg|mp3/.test(type) ? "mp3" : /wav/.test(type) ? "wav" : /ogg/.test(type) ? "ogg" : "webm");

async function callWhisper(kind: "groq" | "openai", input: { url: string } | { bytes: Uint8Array; type: string }, info: TalkInfo): Promise<VerboseJson> {
  const groq = kind === "groq";
  const endpoint = `${groq ? groqBase() : openaiBase()}/audio/transcriptions`;
  const key = env(groq ? "GROQ_API_KEY" : "OPENAI_API_KEY");
  const model = groq ? env("GROQ_TRANSCRIBE_MODEL") || "whisper-large-v3-turbo" : env("OPENAI_TRANSCRIBE_MODEL") || "whisper-1";
  return (await withRetry(groq ? "Groq speech to text" : "OpenAI speech to text", () => {
    const f = new FormData();
    f.set("model", model);
    f.set("response_format", "verbose_json");
    f.append("timestamp_granularities[]", "segment");
    f.set("temperature", "0");
    f.set("prompt", vocabulary(info));
    if (env("TRANSCRIBE_LANGUAGE")) f.set("language", env("TRANSCRIBE_LANGUAGE"));
    if ("url" in input) f.set("url", input.url);
    else f.set("file", new Blob([input.bytes as BlobPart], { type: input.type || "audio/webm" }), `audio.${extFor(input.type)}`);
    return fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: f });
  })).json() as VerboseJson;
}

/**
 * Transcribes a public audio or video file.
 *
 * Groq fetches the file itself from `url`, so nothing large passes through this function.
 * Files above the provider's upload limit (GROQ_MAX_MB, default 25; OpenAI 25) are
 * downloaded here and, when they are WebM (everything the host console records outside
 * Safari), split at cluster boundaries into standalone parts that are transcribed in turn
 * and joined with their time offsets. Other formats over the limit get a clear error with
 * the transcript upload as the way out.
 */
export async function transcribe(url: string, info: TalkInfo): Promise<TranscribeResult> {
  const p = providers().transcribe;
  if (!p) throw new ProviderError("No speech to text key is configured.", 503);
  const limit = (Number(env(p === "groq" ? "GROQ_MAX_MB" : "OPENAI_MAX_MB")) || 25) * MB;
  const urlLimit = p === "groq" ? (Number(env("GROQ_URL_MAX_MB")) || limit / MB) * MB : 0;
  const size = await remoteSize(url);
  const model = p === "groq" ? env("GROQ_TRANSCRIBE_MODEL") || "whisper-large-v3-turbo" : env("OPENAI_TRANSCRIBE_MODEL") || "whisper-1";
  const provider = `${p}:${model}`;

  if (p === "groq" && size > 0 && size <= urlLimit) {
    try {
      const j = await callWhisper("groq", { url }, info);
      return { segments: cleanSegments(toSegments(j)), language: j.language ?? null, duration: j.duration ?? null, provider };
    } catch (e) {
      // too large for this plan after all: fall through to splitting
      if (!(e instanceof ProviderError && e.status === 413)) throw e;
    }
  }

  const { bytes, type } = await download(url);
  if (bytes.length <= limit * 0.98) {
    const j = await callWhisper(p, { bytes, type }, info);
    return { segments: cleanSegments(toSegments(j)), language: j.language ?? null, duration: j.duration ?? null, provider };
  }
  if (!isWebm(bytes)) {
    throw new ProviderError(`The recording is ${(bytes.length / MB).toFixed(1)} MB, above the ${Math.round(limit / MB)} MB speech to text limit, and only WebM recordings can be split automatically. Upload a transcript file (.srt, .vtt or .txt) instead.`, 413);
  }
  const parts = splitWebm(bytes, Math.min(limit * 0.8, 20 * MB));
  const done: { offset: number; segments: Segment[] }[] = [];
  let language: string | null = null;
  for (const part of parts) {
    const j = await callWhisper(p, { bytes: part.bytes, type: "audio/webm" }, info);
    language ??= j.language ?? null;
    done.push({ offset: part.offset, segments: toSegments(j) });
  }
  const segments = joinParts(done);
  return { segments, language, duration: segments.length ? segments[segments.length - 1].end : null, provider: `${provider} (${parts.length} parts)` };
}

// ---------------------------------------------------------------- summary

export interface SummaryResult { summary: Summary; provider: string }

/** Claude through the Anthropic SDK: one call, structured JSON output, refusal fallback on. */
async function summariseWithClaude(info: TalkInfo, segs: Segment[]): Promise<SummaryResult> {
  const model = env("ANTHROPIC_MODEL") || "claude-opus-5-5";
  const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), timeout: 240_000, maxRetries: 1 });
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: SUMMARY_SCHEMA as unknown as Record<string, unknown> } },
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: userPrompt(info, segs) }],
  });
  let msg;
  try { msg = await stream.finalMessage(); }
  catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ProviderError("The Anthropic key was refused. Check ANTHROPIC_API_KEY.", 502);
    if (e instanceof Anthropic.RateLimitError) throw new ProviderError("Anthropic rate limit reached. Try again in a minute.", 502);
    if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic answered ${e.status ?? "with an error"}: ${e.message.slice(0, 300)}`, 502);
    throw e;
  }
  if (msg.stop_reason === "refusal") throw new ProviderError("The summary model declined this transcript.", 502);
  if (msg.stop_reason === "max_tokens") throw new ProviderError("The summary was cut off before it finished.", 502);
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { summary: normaliseSummary(extractJson(text), segs), provider: `anthropic:${msg.model || model}` };
}

/** OpenAI-compatible chat completions (Groq or OpenAI) returning a JSON object. */
async function chatJson(kind: "groq" | "openai", system: string, user: string): Promise<unknown> {
  const groq = kind === "groq";
  const endpoint = `${groq ? groqBase() : openaiBase()}/chat/completions`;
  const model = groq ? env("GROQ_SUMMARY_MODEL") || "openai/gpt-oss-120b" : env("OPENAI_SUMMARY_MODEL") || "gpt-4.1-mini";
  const schemaNote = `\n\nThe JSON object has exactly these keys: ${JSON.stringify(SUMMARY_SCHEMA.properties)}`;
  const r = await withRetry(groq ? "Groq summary" : "OpenAI summary", () => fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env(groq ? "GROQ_API_KEY" : "OPENAI_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: system + schemaNote }, { role: "user", content: user }] }),
  }));
  const j = await r.json() as { choices?: { message?: { content?: string } }[] };
  return extractJson(j.choices?.[0]?.message?.content ?? "");
}

/**
 * Groq and OpenAI fallback. Long transcripts are summarised in chunks (Groq's free tier
 * allows only a few thousand tokens a minute per model), then the partial summaries are
 * merged in one more call; if the merge call fails the parts are combined mechanically.
 */
async function summariseWithChat(kind: "groq" | "openai", info: TalkInfo, segs: Segment[]): Promise<SummaryResult> {
  const max = Number(env(kind === "groq" ? "GROQ_SUMMARY_CHUNK_CHARS" : "OPENAI_SUMMARY_CHUNK_CHARS")) || (kind === "groq" ? 24_000 : 300_000);
  const model = kind === "groq" ? env("GROQ_SUMMARY_MODEL") || "openai/gpt-oss-120b" : env("OPENAI_SUMMARY_MODEL") || "gpt-4.1-mini";
  const chunks = chunkSegments(segs, max);
  if (chunks.length === 1) return { summary: normaliseSummary(await chatJson(kind, SUMMARY_SYSTEM, userPrompt(info, segs)), segs), provider: `${kind}:${model}` };
  const parts: Summary[] = [];
  for (const [i, c] of chunks.entries()) {
    const note = `This is part ${i + 1} of ${chunks.length} of the transcript; summarise only this part. Times stay as given. `;
    parts.push(normaliseSummary(await chatJson(kind, SUMMARY_SYSTEM, userPrompt(info, c, note)), c));
  }
  const merged = mergeSummaries(parts);
  try {
    const out = await chatJson(kind, SUMMARY_SYSTEM,
      `<talk>\nTitle: ${info.title}\nSpeaker(s): ${info.speaker || "not given"}\n</talk>\n\nThese are summaries of consecutive parts of one talk, as JSON. Merge them into one summary of the whole talk: one tl;dr, 4 to 8 key points without repeats, 3 to 10 chapters in order, up to 4 quotes, and all audience questions. Keep the times exactly as given.\n\n<parts>\n${JSON.stringify(parts)}\n</parts>`);
    return { summary: normaliseSummary(out, segs), provider: `${kind}:${model} (${chunks.length} parts)` };
  } catch {
    return { summary: normaliseSummary({ ...merged, tldr: parts[0].tldr, key_points: merged.key_points.slice(0, 8) }, segs), provider: `${kind}:${model} (${chunks.length} parts, merged locally)` };
  }
}

export async function summarise(info: TalkInfo, segs: Segment[]): Promise<SummaryResult> {
  const p = providers().summary;
  if (!p) throw new ProviderError("No summary key is configured.", 503);
  if (!segs.length) throw new ProviderError("The transcript is empty, so there is nothing to summarise.", 422);
  return p === "anthropic" ? summariseWithClaude(info, segs) : summariseWithChat(p, info, segs);
}
