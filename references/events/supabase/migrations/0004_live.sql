-- Live event state shared between the host console and the big screen window.
-- One row per event; the host console writes it, the projector page reads it over realtime.
create table if not exists live_state (
  event_id uuid primary key references events on delete cascade,
  screen_mode text not null default 'questions' check (screen_mode in ('questions', 'join', 'blank')),
  updated_at timestamptz default now()
);

alter table live_state enable row level security;

drop policy if exists "live state is public" on live_state;
create policy "live state is public" on live_state for select using (true);
drop policy if exists "team starts live state" on live_state;
create policy "team starts live state" on live_state for insert to authenticated with check (is_team());
drop policy if exists "team updates live state" on live_state;
create policy "team updates live state" on live_state for update to authenticated using (is_team()) with check (is_team());

grant select on live_state to anon, authenticated;
grant insert, update on live_state to authenticated;

do $$ begin
  alter publication supabase_realtime add table live_state;
exception when duplicate_object then null;
end $$;


-- ---------- one featured question per event ----------
-- Keep only the newest featured question per event before adding the index.
update questions q set featured = false
 where q.featured
   and exists (
     select 1 from questions q2
      where q2.event_id = q.event_id and q2.featured
        and (q2.created_at, q2.id) > (q.created_at, q.id)
   );

create unique index if not exists questions_one_featured on questions (event_id) where featured;

-- Put a question on the big screen (p_on = true) or take it off (false), atomically:
-- any other featured question of the same event is taken off in the same transaction.
create or replace function feature_question(p_question uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event uuid;
begin
  if not is_team() then
    raise exception 'only the Kleros team can change the big screen' using errcode = '42501';
  end if;
  select event_id into v_event from questions where id = p_question;
  if v_event is null then
    raise exception 'question not found' using errcode = 'P0002';
  end if;
  -- serialise concurrent clicks for the same event
  perform 1 from events where id = v_event for update;
  if p_on then
    update questions set featured = false where event_id = v_event and featured and id <> p_question;
    update questions set featured = true, status = 'open' where id = p_question;
  else
    update questions set featured = false where id = p_question;
  end if;
end $$;

revoke execute on function feature_question(uuid, boolean) from public, anon;
grant execute on function feature_question(uuid, boolean) to authenticated;

-- ---------- minimal public info for live pages, drafts included ----------
-- The phone ask page (/q/slug) and the big screen work for draft events too.
create or replace function live_event(p_slug text)
returns table (id uuid, slug text, title text, starts_on date, ends_on date, venue text, city text, status event_status)
language sql stable security definer set search_path = public as $$
  select e.id, e.slug, e.title, e.starts_on, e.ends_on, e.venue, e.city, e.status
    from events e where e.slug = p_slug
$$;

revoke execute on function live_event(text) from public;
grant execute on function live_event(text) to anon, authenticated;

-- ---------- questions privacy and limits ----------
update questions set author_name = left(author_name, 60) where char_length(author_name) > 60;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'questions_author_name_len' and conrelid = 'questions'::regclass) then
    alter table questions add constraint questions_author_name_len check (char_length(author_name) <= 60);
  end if;
end $$;
-- body length (3 to 280) is already checked since 0001.

-- author_id is no longer readable from the API: who wrote an anonymous question stays private.
-- The view exposes author_id only for named questions, plus `mine` for the viewer's own.
revoke select on questions from anon, authenticated;
grant select (id, event_id, body, anonymous, author_name, status, featured, created_at) on questions to anon, authenticated;

-- The view runs as its owner (it reads author_id), so it repeats the questions
-- select policy itself: hidden questions only for the team.
drop view if exists question_scores;
create view question_scores with (security_invoker = false) as
  select q.id, q.event_id, q.body, q.anonymous,
         case when q.anonymous then null else q.author_id end as author_id,
         q.author_name, q.status, q.featured, q.created_at,
         coalesce(v.votes, 0) as votes,
         coalesce(q.author_id = auth.uid(), false) as mine
    from questions q
    left join (select question_id, count(*)::int as votes from question_votes group by question_id) v
      on v.question_id = q.id
   where q.status <> 'hidden' or is_team();

grant select on question_scores to anon, authenticated;
