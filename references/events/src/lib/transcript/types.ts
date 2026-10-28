// Shapes shared by the transcript route, the talk page and the host console.

export type TranscriptStatus = "none" | "queued" | "transcribing" | "summarising" | "done" | "error";

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Chapter { t: number; title: string }
export interface Quote { t: number; text: string; speaker?: string }
export interface AudienceQuestion { t: number; question: string; answer?: string }

export interface Summary {
  tldr: string;
  key_points: string[];
  chapters: Chapter[];
  quotes: Quote[];
  audience_questions?: AudienceQuestion[];
}

export interface TranscriptRow {
  material_id: string;
  status: TranscriptStatus;
  text: string | null;
  segments: Segment[];
  language: string | null;
  summary: Summary | null;
  error: string | null;
  provider: string | null;
  source: "audio" | "upload" | null;
  duration_seconds: number | null;
  started_at: string | null;
  updated_at: string;
}

/** What the route answers with, and what the panels show. */
export interface TranscriptState {
  status: TranscriptStatus;
  error?: string | null;
  /** true when a later call is needed to finish (the summary did not fit in this request) */
  more?: boolean;
  setup?: boolean;
}

export const BUSY: TranscriptStatus[] = ["queued", "transcribing", "summarising"];

/** Uploaded plain text without timestamps: times are estimates, so the UI does not offer seeking. */
export const isUntimed = (provider: string | null | undefined) => !!provider && provider.includes("untimed");

export const NOT_SET_UP =
  "Transcripts are not set up yet. An admin can add GROQ_API_KEY (speech to text) and ANTHROPIC_API_KEY (summaries) in Vercel, Project, Settings, Environment Variables, then redeploy.";
