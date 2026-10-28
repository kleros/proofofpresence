-- Kleros Events: schema, row level security and storage.
-- Public visitors read published content; signed-in visitors keep their own
-- event list, notes and watch history; Kleros team members (profiles.is_team)
-- manage everything.

create extension if not exists "pgcrypto";

-- ---------- types ----------
create type kleros_role as enum ('host', 'co_host', 'speaking', 'sponsor', 'booth', 'judging', 'attending');
create type event_status as enum ('draft', 'published');
create type material_kind as enum ('talk', 'slides', 'audio', 'video', 'doc', 'image', 'link', 'social');
create type attendance_status as enum ('saved', 'going', 'attended');
create type question_status as enum ('open', 'answered', 'hidden');

-- ---------- people ----------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  visitor_role text,               -- builder, juror, researcher, legal, partner, investor, community
  region text,
  interests text[] not null default '{}',
  include_online boolean not null default true,
  is_team boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_team from profiles where id = auth.uid()), false)
$$;

-- new auth users get a profile row
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name) values (new.id, split_part(new.email, '@', 1));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create table team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  avatar_url text,
  x_handle text,
  calendar_url text,               -- Calendly / cal.com link for "book a meeting"
  sort int not null default 0,
  active boolean not null default true
);

-- ---------- events ----------
create table events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  kleros_role kleros_role not null default 'host',
  organizer text,
  event_type text not null default 'Conference',
  starts_on date not null,
  ends_on date,
  start_time time,
  timezone text,
  city text,
  country text,
  region text,                     -- Europe, Asia, ... or Online
  venue text,
  url text,                        -- Luma / Eventbrite / conference page
  description text,
  topics text[] not null default '{}',
  cover_path text,
  recap text,                      -- written after the event
  status event_status not null default 'draft',
  is_example boolean not null default false,
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index events_starts_on on events (starts_on);

create table event_team (
  event_id uuid references events on delete cascade,
  team_member_id uuid references team_members on delete cascade,
  part text,                       -- "Speaker", "Booth", "Judge"...
  primary key (event_id, team_member_id)
);

create table agenda_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  starts_at time,
  title text not null,
  speaker text,
  is_kleros boolean not null default false
);

-- ---------- materials ----------
-- A "talk" is a deck (pdf_path) plus a recording (audio_path) with slide
-- change marks [{ "p": page, "t": seconds }] and optional notes per page.
create table materials (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  kind material_kind not null,
  title text not null,
  speaker text,
  url text,                        -- external links (YouTube, X post, Google Slides)
  file_path text,                  -- storage path for single files
  pdf_path text,
  audio_path text,
  pages int,
  duration_seconds int,
  marks jsonb not null default '[]',
  notes jsonb not null default '{}',
  size_bytes bigint,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index materials_event on materials (event_id);

-- ---------- visitors ----------
create table attendance (
  user_id uuid references auth.users on delete cascade,
  event_id uuid references events on delete cascade,
  status attendance_status not null,
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table talk_progress (
  user_id uuid references auth.users on delete cascade,
  material_id uuid references materials on delete cascade,
  position_seconds int not null default 0,
  finished boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, material_id)
);

-- ---------- ask the speaker ----------
create table questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  body text not null check (char_length(body) between 3 and 280),
  anonymous boolean not null default false,
  author_id uuid references auth.users on delete set null default auth.uid(),
  author_name text,
  status question_status not null default 'open',
  featured boolean not null default false,
  created_at timestamptz not null default now()
);
create index questions_event on questions (event_id);

create table question_votes (
  question_id uuid references questions on delete cascade,
  user_id uuid references auth.users on delete cascade default auth.uid(),
  primary key (question_id, user_id)
);

create view question_scores with (security_invoker = true) as
  select q.*, coalesce(v.votes, 0) as votes
  from questions q
  left join (select question_id, count(*)::int as votes from question_votes group by question_id) v
    on v.question_id = q.id;

-- ---------- leads ----------
create table meeting_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events on delete set null,
  name text not null,
  email text not null,
  company text,
  interest text,                   -- Court, Escrow, Curate, becoming a juror, partnership...
  message text,
  user_id uuid references auth.users default auth.uid(),
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

-- public going counts without exposing who
create view event_counts with (security_invoker = false) as
  select event_id,
         count(*) filter (where status = 'going')::int as going,
         count(*) filter (where status = 'attended')::int as attended
  from attendance group by event_id;

-- ---------- row level security ----------
alter table profiles enable row level security;
alter table team_members enable row level security;
alter table events enable row level security;
alter table event_team enable row level security;
alter table agenda_items enable row level security;
alter table materials enable row level security;
alter table attendance enable row level security;
alter table talk_progress enable row level security;
alter table questions enable row level security;
alter table question_votes enable row level security;
alter table meeting_requests enable row level security;

create policy "own profile" on profiles for select using (id = auth.uid() or is_team());
create policy "update own profile" on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and is_team = is_team());
create policy "team edits profiles" on profiles for update using (is_team());

create policy "team roster is public" on team_members for select using (true);
create policy "team manages roster" on team_members for all using (is_team()) with check (is_team());

create policy "published events are public" on events for select using (status = 'published' or is_team());
create policy "team manages events" on events for all using (is_team()) with check (is_team());

create policy "event team is public" on event_team for select using (true);
create policy "team manages event team" on event_team for all using (is_team()) with check (is_team());

create policy "agenda is public" on agenda_items for select using (true);
create policy "team manages agenda" on agenda_items for all using (is_team()) with check (is_team());

create policy "materials are public" on materials for select using (true);
create policy "team manages materials" on materials for all using (is_team()) with check (is_team());

create policy "own attendance" on attendance for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "team sees attendance" on attendance for select using (is_team());

create policy "own progress" on talk_progress for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "visible questions" on questions for select using (status <> 'hidden' or is_team());
create policy "signed-in visitors ask" on questions for insert to authenticated
  with check (author_id = auth.uid() and status = 'open' and featured = false);
create policy "team moderates questions" on questions for update using (is_team());
create policy "team deletes questions" on questions for delete using (is_team());

create policy "votes are public" on question_votes for select using (true);
create policy "own votes" on question_votes for insert to authenticated with check (user_id = auth.uid());
create policy "remove own votes" on question_votes for delete using (user_id = auth.uid());

create policy "anyone can request a meeting" on meeting_requests for insert with check (true);
create policy "team reads requests" on meeting_requests for select using (is_team());
create policy "team updates requests" on meeting_requests for update using (is_team());

-- ---------- realtime for live Q&A ----------
alter publication supabase_realtime add table questions, question_votes;

-- ---------- storage ----------
insert into storage.buckets (id, name, public) values ('materials', 'materials', true)
  on conflict (id) do nothing;
create policy "materials files are public" on storage.objects for select using (bucket_id = 'materials');
create policy "team uploads materials" on storage.objects for insert with check (bucket_id = 'materials' and is_team());
create policy "team updates materials" on storage.objects for update using (bucket_id = 'materials' and is_team());
create policy "team deletes materials" on storage.objects for delete using (bucket_id = 'materials' and is_team());
