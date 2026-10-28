export type KlerosRole = "host" | "co_host" | "speaking" | "sponsor" | "booth" | "judging" | "attending";
export type MaterialKind = "talk" | "slides" | "audio" | "video" | "doc" | "image" | "link" | "social";
export type AttendanceStatus = "saved" | "going" | "attended";

export interface EventRow {
  id: string;
  slug: string;
  title: string;
  kleros_role: KlerosRole;
  organizer: string | null;
  event_type: string;
  starts_on: string;
  ends_on: string | null;
  start_time: string | null;
  timezone: string | null;
  city: string | null;
  country: string | null;
  region: string | null;
  venue: string | null;
  url: string | null;
  description: string | null;
  topics: string[];
  cover_path: string | null;
  recap: string | null;
  status: "draft" | "published";
  /** private: only its creator and collaborators can see it (0010) */
  visibility: "public" | "private";
  created_by: string | null;
  is_example: boolean;
  updated_at?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  title: string | null;
  avatar_url: string | null;
  x_handle: string | null;
  calendar_url: string | null;
}

export interface EventTeamRow {
  part: string | null;
  team_members: TeamMember;
}

export interface AgendaItem {
  id: string;
  event_id: string;
  starts_at: string | null;
  title: string;
  speaker: string | null;
  is_kleros: boolean;
}

export interface SlideMark {
  p: number;
  t: number;
}

export interface Material {
  id: string;
  /** The primary event, kept for older code; null for a recording not linked to any event yet. */
  event_id: string | null;
  /** Every event the material is linked to (material_events), primary first. Set by the data helpers. */
  event_ids?: string[];
  kind: MaterialKind;
  title: string;
  speaker: string | null;
  url: string | null;
  file_path: string | null;
  pdf_path: string | null;
  audio_path: string | null;
  pages: number | null;
  duration_seconds: number | null;
  marks: SlideMark[];
  notes: Record<string, string>;
  size_bytes: number | null;
  created_at: string;
}

export interface Question {
  id: string;
  event_id: string;
  body: string;
  anonymous: boolean;
  author_id: string | null;
  author_name: string | null;
  status: "open" | "answered" | "hidden";
  featured: boolean;
  created_at: string;
  votes: number;
  /** from question_scores: the signed-in viewer wrote it (author_id is null for anonymous questions) */
  mine?: boolean;
  /** from question_scores (0014): sent without an account, set by the database; null for anonymous questions */
  guest?: boolean | null;
  /** from question_scores (0014): a host approved it for the big screen */
  approved?: boolean;
  /** from question_scores (0014): the big screen may show it. Missing before 0014 runs: treated as true. */
  screen_ok?: boolean;
  /** from question_scores (0014): sent from a Kleros team account, set by the database; null for anonymous questions */
  team?: boolean | null;
}

export interface Profile {
  id: string;
  display_name: string | null;
  visitor_role: string | null;
  region: string | null;
  interests: string[];
  include_online: boolean;
  is_team: boolean;
  is_admin?: boolean;
}
