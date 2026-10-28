-- Transcripts and summaries for talk recordings (talk, audio and video materials).
-- One row per material, in its own table so the listings that select * from materials
-- do not pull long transcript text. Anyone can read (like materials); only the team
-- writes, either from the browser or through /api/transcripts/[materialId], which uses
-- the caller's session (or the service role key when the deployment has one).
-- Safe to run more than once.

create table if not exists transcripts (
  material_id uuid primary key references materials on delete cascade,
  status text not null default 'none',
  text text,                                  -- the whole transcript as plain text
  segments jsonb not null default '[]',       -- [{ "start": s, "end": s, "text": "..." }]
  language text,
  summary jsonb,                              -- { tldr, key_points[], chapters[{t,title}], quotes[{t,text,speaker?}], audience_questions?[] }
  error text,
  provider text,                              -- e.g. "groq:whisper-large-v3-turbo + anthropic:claude-opus-5-5", "upload:srt"
  source text,                                -- 'audio' (our own recording) or 'upload' (a transcript file)
  duration_seconds numeric,
  started_at timestamptz,                     -- when the current run began (stale-run detection)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

-- columns added after the first version of this file
alter table transcripts add column if not exists source text;
alter table transcripts add column if not exists duration_seconds numeric;
alter table transcripts add column if not exists started_at timestamptz;

alter table transcripts drop constraint if exists transcripts_status_check;
alter table transcripts add constraint transcripts_status_check
  check (status in ('none', 'queued', 'transcribing', 'summarising', 'done', 'error'));
alter table transcripts drop constraint if exists transcripts_segments_array;
alter table transcripts add constraint transcripts_segments_array check (jsonb_typeof(segments) = 'array');
alter table transcripts drop constraint if exists transcripts_summary_object;
alter table transcripts add constraint transcripts_summary_object check (summary is null or jsonb_typeof(summary) = 'object');

create or replace function transcripts_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists transcripts_touch on transcripts;
create trigger transcripts_touch before insert or update on transcripts
  for each row execute function transcripts_touch();

alter table transcripts enable row level security;

drop policy if exists "transcripts are public" on transcripts;
create policy "transcripts are public" on transcripts for select using (true);
drop policy if exists "team adds transcripts" on transcripts;
create policy "team adds transcripts" on transcripts for insert to authenticated with check (is_team());
drop policy if exists "team updates transcripts" on transcripts;
create policy "team updates transcripts" on transcripts for update to authenticated using (is_team()) with check (is_team());
drop policy if exists "team deletes transcripts" on transcripts;
create policy "team deletes transcripts" on transcripts for delete to authenticated using (is_team());

grant select on transcripts to anon, authenticated;
grant insert, update, delete on transcripts to authenticated;
