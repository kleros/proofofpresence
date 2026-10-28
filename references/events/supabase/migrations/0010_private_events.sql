-- Private events.
--
-- Every event is public (as before) or private:
--   * public:  everyone sees it once published; the whole Kleros team sees and edits it, drafts included.
--   * private: only its creator and the collaborators they add (by email) see it, its agenda, team,
--              materials, links, transcripts, questions, live screen, RSVPs and uploaded files. Other
--              team members and admins do not. Creator and collaborators can edit it; only the creator
--              can delete it. A collaborator does not need team access: signing in with the listed
--              (confirmed) email is enough. A private event never shows on the public site.
-- Only the team (an @kleros.io email or access granted by an admin) can create events.
-- created_by is set to the creator on insert and cannot be changed afterwards; an older event with
-- no creator gets the person who makes it private as its creator.
--
-- Safe to run more than once.

-- ---------- columns and table ----------
alter table events add column if not exists visibility text not null default 'public';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_visibility_check' and conrelid = 'events'::regclass) then
    alter table events add constraint events_visibility_check check (visibility in ('public', 'private'));
  end if;
end $$;
-- created_by is filled in by the events_keep_creator trigger below (not by a column default), so
-- events the Luma and feed jobs import stay without a creator whoever presses Sync now.
alter table events alter column created_by drop default;
create index if not exists events_private on events (created_by) where visibility = 'private';

create table if not exists event_collaborators (
  event_id uuid not null references events on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%.__%'),
  added_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (event_id, email)
);
create index if not exists event_collaborators_email on event_collaborators (email);

-- ---------- helpers (security definer: they read events and collaborators whatever the caller sees) ----------

-- The caller's email, only once confirmed. Anonymous QR guests have none.
create or replace function my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(u.email) from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
$$;

create or replace function is_event_collaborator(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_collaborators c where c.event_id = p_event and c.email = my_email())
$$;

-- Creator or collaborator of the event (any visibility).
create or replace function is_event_member(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from events e
     where e.id = p_event
       and (e.created_by = auth.uid() or is_event_collaborator(e.id)))
$$;

create or replace function event_is_private(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select e.visibility = 'private' from events e where e.id = p_event), false)
$$;

-- What the caller may see: public and published for everyone, public drafts for the team,
-- private for its members. Unknown event: false.
create or replace function can_see_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when e.visibility = 'private' then is_event_member(e.id)
                else e.status = 'published' or is_team() end
      from events e where e.id = p_event), false)
$$;

-- What the caller may change: public events for the team, private ones for their members.
create or replace function can_edit_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when e.visibility = 'private' then is_event_member(e.id) else is_team() end
      from events e where e.id = p_event), false)
$$;

-- Visible to the caller unless it belongs to a private event they are not part of.
-- (For rows that were public to everyone before: agenda, Kleros team, live screen, questions.)
create or replace function not_hidden_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not event_is_private(p_event) or is_event_member(p_event)
$$;

-- A material is visible when one of its events is visible to the caller; a material on no
-- event at all (the team's recordings library) is visible to the team.
create or replace function material_visible(p_material uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from material_events me where me.material_id = p_material)
      then exists (select 1 from material_events me where me.material_id = p_material and can_see_event(me.event_id))
    else coalesce((select case when m.event_id is null then is_team() else can_see_event(m.event_id) end
                     from materials m where m.id = p_material), false)
  end
$$;

-- Who may change or delete a material: the team when it is on any public event (linking it to a
-- private event gives no rights over it), the members of one of its events when all its events are
-- private, and the team for a library material on no event.
create or replace function material_editable(p_material uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from material_events me join events e on e.id = me.event_id
                  where me.material_id = p_material and e.visibility = 'public')
      then is_team()
    when exists (select 1 from material_events me where me.material_id = p_material)
      then exists (select 1 from material_events me where me.material_id = p_material and can_edit_event(me.event_id))
    else coalesce((select case when m.event_id is null then is_team() else can_edit_event(m.event_id) end
                     from materials m where m.id = p_material), false)
  end
$$;

-- Public to everyone: linked to a published public event (used by older policies and the app).
create or replace function material_is_public(p_material uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from material_events me join events e on e.id = me.event_id
     where me.material_id = p_material and e.status = 'published' and e.visibility = 'public')
$$;

-- Storage paths in the materials bucket are "<event id>/<file>" or "standalone/<file>".
create or replace function storage_event_id(p_name text) returns uuid
language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end
$$;

-- A file that a material uses follows that material, wherever it is stored (a recording made on
-- /record lives under standalone/ even once it belongs to a private event). Files no material uses
-- follow their folder: an event's folder its event, standalone/ the team, and the folder of an
-- event that no longer exists nobody (an admin can still clean up from the SQL editor).
create or replace function storage_file_used(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from materials m where p_name in (m.file_path, m.pdf_path, m.audio_path))
$$;

create or replace function storage_file_in_use(p_name text, p_edit boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from materials m
     where p_name in (m.file_path, m.pdf_path, m.audio_path)
       and case when p_edit then material_editable(m.id) else material_visible(m.id) end)
$$;

create or replace function storage_file_visible(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when storage_file_used(p_name) then storage_file_in_use(p_name, false)
    when storage_event_id(p_name) is null then is_team()
    when exists (select 1 from events where id = storage_event_id(p_name)) then not_hidden_event(storage_event_id(p_name))
    else false
  end
$$;

create or replace function storage_file_editable(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when storage_file_used(p_name) then storage_file_in_use(p_name, true)
    when storage_event_id(p_name) is null then is_team()
    when exists (select 1 from events where id = storage_event_id(p_name)) then can_edit_event(storage_event_id(p_name))
    else false
  end
$$;

-- The files to remove with a private event: files in its folder and files its own items use
-- elsewhere, except files that an item staying on the site (on another event, or in the
-- library) also uses. For the event's creator only.
create or replace function private_event_files(p_event uuid) returns setof text
language sql stable security definer set search_path = public, storage as $$
  with mine as (   -- items that go with the event
    select m.id, m.file_path, m.pdf_path, m.audio_path from materials m
     where (m.event_id = p_event or exists (select 1 from material_events me where me.material_id = m.id and me.event_id = p_event))
       and not exists (select 1 from material_events me where me.material_id = m.id and me.event_id <> p_event)
  )
  select o.name from storage.objects o
   where o.bucket_id = 'materials'
     and exists (select 1 from events e where e.id = p_event and e.visibility = 'private' and e.created_by = auth.uid())
     and (o.name like p_event::text || '/%'
          or exists (select 1 from mine where o.name in (mine.file_path, mine.pdf_path, mine.audio_path)))
     and not exists (select 1 from materials m
                      where o.name in (m.file_path, m.pdf_path, m.audio_path)
                        and m.id not in (select id from mine))
$$;
revoke all on function private_event_files(uuid) from public, anon;
grant execute on function private_event_files(uuid) to authenticated;

-- The creator's email, for the event's members only (shown in the collaborators list).
create or replace function event_creator_email(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select lower(u.email) from events e join auth.users u on u.id = e.created_by
   where e.id = p_event and is_event_member(p_event)
$$;

grant execute on function event_creator_email(uuid), my_email(), is_event_collaborator(uuid), is_event_member(uuid), event_is_private(uuid),
  can_see_event(uuid), can_edit_event(uuid), not_hidden_event(uuid), material_visible(uuid), material_editable(uuid),
  material_is_public(uuid), storage_event_id(text), storage_file_visible(text), storage_file_editable(text),
  storage_file_in_use(text, boolean), storage_file_used(text)
  to anon, authenticated;

-- ---------- creator: set on insert, never changed; only the creator switches visibility ----------
-- Making an event private or public again is the creator's call (an older event with no creator:
-- the admin's, who then becomes its creator). Collaborators and other team members cannot.
-- Jobs and the SQL editor (no signed-in user) are not limited.
create or replace function events_keep_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.importing', true), '') <> 'on' then
      new.created_by := coalesce(new.created_by, auth.uid());
    end if;
  else
    if auth.uid() is not null and new.visibility is distinct from old.visibility then
      if new.visibility = 'private' and not coalesce(old.created_by = auth.uid() or (old.created_by is null and is_admin()), false) then
        raise exception 'Only the person who created this event can make it private.' using errcode = '42501';
      end if;
      if new.visibility = 'public' and not coalesce(old.created_by = auth.uid() and is_team(), false) then
        raise exception 'Only the person who created this event can make it public.' using errcode = '42501';
      end if;
    end if;
    new.created_by := coalesce(old.created_by, case when new.visibility = 'private' then auth.uid() end);
  end if;
  -- an event created private gets a random ending on its address, so nobody can guess it (or
  -- learn that it exists from a "slug taken" error)
  -- (an event made private later keeps its address: it was public already, and the Luma and feed
  -- jobs recognise it by it and leave it alone)
  if tg_op = 'INSERT' and new.visibility = 'private' and new.slug !~ '-[0-9a-f]{8}$' then
    new.slug := new.slug || '-' || left(md5(gen_random_uuid()::text), 8);
  elsif tg_op = 'UPDATE' and old.visibility = 'private' and new.visibility = 'public' and new.slug = old.slug
        and new.slug ~ '-[0-9a-f]{8}$'
        and not exists (select 1 from events where slug = regexp_replace(new.slug, '-[0-9a-f]{8}$', '') and id <> new.id) then
    -- made public again: back to the plain address when it is free
    new.slug := regexp_replace(new.slug, '-[0-9a-f]{8}$', '');
  end if;
  -- a private event never counts as published, so making it public later starts as a draft
  if new.visibility = 'private' then new.status := 'draft'; end if;
  return new;
end $$;
drop trigger if exists events_keep_creator on events;
create trigger events_keep_creator before insert or update on events
  for each row execute function events_keep_creator();
revoke all on function events_keep_creator() from public, anon, authenticated;

-- ---------- events ----------
drop policy if exists "published events are public" on events;
drop policy if exists "team manages events" on events;
drop policy if exists "events visible to the caller" on events;
drop policy if exists "team creates events" on events;
drop policy if exists "editors update events" on events;
drop policy if exists "owners delete events" on events;

-- Private rows are checked on their own columns (not through is_event_member, which looks the
-- event up again): a row being inserted is not visible to that lookup yet.
create policy "events visible to the caller" on events for select
  using (case when visibility = 'private' then created_by = auth.uid() or is_event_collaborator(id)
              else status = 'published' or is_team() end);
create policy "team creates events" on events for insert to authenticated
  with check (is_team() and created_by = auth.uid());
create policy "editors update events" on events for update to authenticated
  using (case when visibility = 'private' then created_by = auth.uid() or is_event_collaborator(id) else is_team() end)
  with check (case when visibility = 'private' then created_by = auth.uid() or is_event_collaborator(id)
                   else is_team() end);
create policy "owners delete events" on events for delete to authenticated
  using (case when visibility = 'private' then created_by = auth.uid() else is_team() end);

-- ---------- collaborators ----------
alter table event_collaborators enable row level security;
grant select, insert, delete on event_collaborators to authenticated;
drop policy if exists "members see collaborators" on event_collaborators;
drop policy if exists "members add collaborators" on event_collaborators;
drop policy if exists "members remove collaborators" on event_collaborators;
create policy "members see collaborators" on event_collaborators for select to authenticated
  using (is_event_member(event_id));
create policy "members add collaborators" on event_collaborators for insert to authenticated
  with check (event_is_private(event_id) and is_event_member(event_id));
create policy "members remove collaborators" on event_collaborators for delete to authenticated
  using (is_event_member(event_id));

-- ---------- agenda and Kleros team of an event ----------
drop policy if exists "event team is public" on event_team;
drop policy if exists "team manages event team" on event_team;
create policy "event team is public" on event_team for select using (not_hidden_event(event_id));
create policy "team manages event team" on event_team for all to authenticated
  using (can_edit_event(event_id)) with check (can_edit_event(event_id));

drop policy if exists "agenda is public" on agenda_items;
drop policy if exists "team manages agenda" on agenda_items;
create policy "agenda is public" on agenda_items for select using (not_hidden_event(event_id));
create policy "team manages agenda" on agenda_items for all to authenticated
  using (can_edit_event(event_id)) with check (can_edit_event(event_id));

-- ---------- materials and their links ----------
-- The row's own event_id is checked directly as well: right after an insert, the link that
-- the 0006 trigger adds is not visible yet to the policy check on the returned row.
drop policy if exists "materials are public" on materials;
drop policy if exists "team manages materials" on materials;
drop policy if exists "editors add materials" on materials;
drop policy if exists "editors change materials" on materials;
drop policy if exists "editors remove materials" on materials;
create policy "materials are public" on materials for select
  using ((event_id is null and is_team()) or (event_id is not null and can_see_event(event_id)) or material_visible(id));
create policy "editors add materials" on materials for insert to authenticated
  with check (case when event_id is null then is_team() else can_edit_event(event_id) end);
create policy "editors change materials" on materials for update to authenticated
  using (material_editable(id)) with check (material_editable(id));
create policy "editors remove materials" on materials for delete to authenticated
  using (material_editable(id));

-- A material's primary event (event_id) is a public one whenever it has a public link, so a
-- shared material never carries a private event's id where everyone can read it. Same triggers as
-- in 0006, with that preference added.
create or replace function material_keep_primary() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is null and old.event_id is not null then
    select me.event_id into new.event_id from material_events me join events e on e.id = me.event_id
     where me.material_id = new.id and me.event_id <> old.event_id
     order by (e.visibility = 'private'), me.created_at, me.event_id limit 1;
  end if;
  return new;
end $$;

create or replace function material_link_added() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update materials m set event_id = new.event_id
   where m.id = new.material_id
     and (m.event_id is null or (event_is_private(m.event_id) and not event_is_private(new.event_id)));
  return null;
end $$;

create or replace function material_link_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update materials m set event_id = (
      select me.event_id from material_events me join events e on e.id = me.event_id
       where me.material_id = old.material_id and me.event_id <> old.event_id
       order by (e.visibility = 'private'), me.created_at, me.event_id limit 1)
   where m.id = old.material_id and m.event_id = old.event_id;
  return null;
end $$;

-- Moving a material's primary event (event_id) to an event the caller cannot edit, and that it
-- is not linked to already, is refused.
create or replace function material_event_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.event_id is not null and new.event_id is distinct from old.event_id
     and not can_edit_event(new.event_id)
     and not exists (select 1 from material_events me where me.material_id = new.id and me.event_id = new.event_id) then
    raise exception 'This item cannot be moved to an event you cannot edit.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists material_event_change on materials;
create trigger material_event_change before update of event_id on materials
  for each row execute function material_event_change();
revoke all on function material_event_change() from public, anon, authenticated;

drop policy if exists "links of visible events are public" on material_events;
drop policy if exists "team links materials" on material_events;
drop policy if exists "team unlinks materials" on material_events;
create policy "links of visible events are public" on material_events for select
  using (can_see_event(event_id));
-- A private event can only take materials that already belong to private events only, all of
-- which the caller can edit. Library items and anything on a public event stay with the team:
-- to show a public video in a private event, add it there as a new link.
create or replace function material_private_only(p_material uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from material_events me where me.material_id = p_material)
     and not exists (select 1 from material_events me join events e on e.id = me.event_id
                      where me.material_id = p_material and not (e.visibility = 'private' and can_edit_event(e.id)))
$$;
grant execute on function material_private_only(uuid) to authenticated;
create policy "team links materials" on material_events for insert to authenticated
  with check (can_edit_event(event_id) and material_visible(material_id)
              and (not event_is_private(event_id) or material_private_only(material_id)));
create policy "team unlinks materials" on material_events for delete to authenticated
  using (can_edit_event(event_id));

-- transcripts follow their material
do $$ begin
  if to_regclass('public.transcripts') is not null then
    execute 'drop policy if exists "transcripts are public" on transcripts';
    execute 'drop policy if exists "team adds transcripts" on transcripts';
    execute 'drop policy if exists "team updates transcripts" on transcripts';
    execute 'drop policy if exists "team deletes transcripts" on transcripts';
    execute 'create policy "transcripts are public" on transcripts for select using (material_visible(material_id))';
    execute 'create policy "team adds transcripts" on transcripts for insert to authenticated with check (is_team() and material_editable(material_id))';
    execute 'create policy "team updates transcripts" on transcripts for update to authenticated using (is_team() and material_editable(material_id)) with check (is_team() and material_editable(material_id))';
    execute 'create policy "team deletes transcripts" on transcripts for delete to authenticated using (is_team() and material_editable(material_id))';
  end if;
end $$;

-- ---------- questions, votes, live screen, RSVPs ----------
drop policy if exists "visible questions" on questions;
drop policy if exists "signed-in visitors ask" on questions;
drop policy if exists "team moderates questions" on questions;
drop policy if exists "team deletes questions" on questions;
create policy "visible questions" on questions for select
  using (case when event_is_private(event_id) then is_event_member(event_id) else status <> 'hidden' or is_team() end);
create policy "signed-in visitors ask" on questions for insert to authenticated
  with check (author_id = auth.uid() and status = 'open' and featured = false and not_hidden_event(event_id));
create policy "team moderates questions" on questions for update using (can_edit_event(event_id));
create policy "team deletes questions" on questions for delete using (can_edit_event(event_id));

-- question_scores runs as its owner (it reads author_id), so it repeats the questions rule itself.
create or replace view question_scores with (security_invoker = false) as
  select q.id, q.event_id, q.body, q.anonymous,
         case when q.anonymous then null else q.author_id end as author_id,
         q.author_name, q.status, q.featured, q.created_at,
         coalesce(v.votes, 0) as votes,
         coalesce(q.author_id = auth.uid(), false) as mine
    from questions q
    left join (select question_id, count(*)::int as votes from question_votes group by question_id) v
      on v.question_id = q.id
   where case when event_is_private(q.event_id) then is_event_member(q.event_id)
              else q.status <> 'hidden' or is_team() end;
grant select on question_scores to anon, authenticated;

drop policy if exists "votes are public" on question_votes;
drop policy if exists "own votes" on question_votes;
create policy "votes are public" on question_votes for select
  using (exists (select 1 from questions q where q.id = question_votes.question_id));
create policy "own votes" on question_votes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from questions q where q.id = question_votes.question_id));

drop policy if exists "live state is public" on live_state;
drop policy if exists "team starts live state" on live_state;
drop policy if exists "team updates live state" on live_state;
create policy "live state is public" on live_state for select using (not_hidden_event(event_id));
create policy "team starts live state" on live_state for insert to authenticated with check (can_edit_event(event_id));
create policy "team updates live state" on live_state for update to authenticated
  using (can_edit_event(event_id)) with check (can_edit_event(event_id));

drop policy if exists "own attendance" on attendance;
drop policy if exists "team sees attendance" on attendance;
create policy "own attendance" on attendance for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and not_hidden_event(event_id));
create policy "team sees attendance" on attendance for select
  using (case when event_is_private(event_id) then is_event_member(event_id) else is_team() end);

-- going counts without names; private events only for their members
create or replace view event_counts with (security_invoker = false) as
  select event_id,
         count(*) filter (where status = 'going')::int as going,
         count(*) filter (where status = 'attended')::int as attended
  from attendance
  where not_hidden_event(event_id)
  group by event_id;
grant select on event_counts to anon, authenticated;

-- ---------- live pages and the big screen ----------
create or replace function feature_question(p_question uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event uuid;
begin
  select event_id into v_event from questions where id = p_question;
  if v_event is null or not can_edit_event(v_event) then
    raise exception 'only the event''s hosts can change the big screen' using errcode = '42501';
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

-- The phone ask page and the big screen work for public drafts (as before) and, for their
-- members only, for private events.
create or replace function live_event(p_slug text)
returns table (id uuid, slug text, title text, starts_on date, ends_on date, venue text, city text, status event_status)
language sql stable security definer set search_path = public as $$
  select e.id, e.slug, e.title, e.starts_on, e.ends_on, e.venue, e.city, e.status
    from events e
   where e.slug = p_slug and (e.visibility = 'public' or is_event_member(e.id))
$$;
revoke execute on function live_event(text) from public;
grant execute on function live_event(text) to anon, authenticated;

-- ---------- uploaded files ----------
-- The bucket stays public (files are served by unguessable path), but listing a private
-- event's folder is limited to its members, and only an event's editors upload into it.
drop policy if exists "materials files are public" on storage.objects;
drop policy if exists "team uploads materials" on storage.objects;
drop policy if exists "team updates materials" on storage.objects;
drop policy if exists "team deletes materials" on storage.objects;
create policy "materials files are public" on storage.objects for select
  using (bucket_id = 'materials' and storage_file_visible(name));
create policy "team uploads materials" on storage.objects for insert
  with check (bucket_id = 'materials' and storage_file_editable(name));
create policy "team updates materials" on storage.objects for update
  using (bucket_id = 'materials' and storage_file_editable(name));
create policy "team deletes materials" on storage.objects for delete
  using (bucket_id = 'materials' and storage_file_editable(name));

-- ---------- keeping private items private ----------
-- A material whose only event is private would otherwise fall back into the team's recordings
-- library (visible to the whole team) when that last link goes. So: unlinking it is refused
-- (delete it, or link it to another event first), and deleting a private event deletes the
-- materials that belong to it alone. Uploaded files stay in storage under the event's folder,
-- at unguessable paths that nothing lists any more; the app removes them when it can.
create or replace function material_keep_private_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if event_is_private(old.event_id)
     and exists (select 1 from materials where id = old.material_id)
     and not exists (select 1 from material_events where material_id = old.material_id and event_id <> old.event_id) then
    raise exception 'This item belongs only to a private event. Delete it, or link it to another event first.'
      using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists material_keep_private_link on material_events;
create trigger material_keep_private_link before delete on material_events
  for each row execute function material_keep_private_link();
revoke all on function material_keep_private_link() from public, anon, authenticated;

create or replace function events_private_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.visibility = 'private' then
    delete from materials m
     where (m.event_id = old.id
            or exists (select 1 from material_events me where me.material_id = m.id and me.event_id = old.id))
       and not exists (select 1 from material_events me where me.material_id = m.id and me.event_id <> old.id);
  end if;
  return old;
end $$;
drop trigger if exists events_private_cleanup on events;
create trigger events_private_cleanup before delete on events
  for each row execute function events_private_cleanup();
revoke all on function events_private_cleanup() from public, anon, authenticated;

-- ---------- the hourly Luma and socials jobs leave private events alone ----------
-- Same functions as in 0007 and 0009, except: Luma only matches public events (a private copy of a
-- Luma event never stops the public one from being added), the feed refuses a slug that belongs to
-- a private event, and a feed material never reuses a material of a private event.
create or replace function sync_luma() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  kleros_user constant text := 'usr-os3CTvva2Xzo04A';   -- Kleros | Events
  kleros_people constant text[] := array['usr-os3CTvva2Xzo04A', 'usr-nqQ4AAYbAF7ZFFv'];  -- + Wei Wei
  v_slugs text[] := '{}';
  v_slug text;
  v_list jsonb;
  v_entry jsonb;
  d jsonb; e jsonb; g jsonb;
  v_start timestamptz; v_end timestamptz; v_tz text;
  v_checked int := 0; v_updated int := 0; v_added int := 0; v_errors text[] := '{}';
  v_id uuid; v_new_slug text; v_hosts text[]; v_region text; v_rows int;
  u text; p text; v_kleros_hosted boolean;
  v_private text[];
begin
  if auth.uid() is not null and not is_team() then
    raise exception 'Only the Kleros team can sync from Luma';
  end if;
  perform set_config('app.importing', 'on', true);

  -- 1. events already on the site that point at Luma
  select coalesce(array_agg(distinct luma_slug(url)), '{}') into v_slugs
    from events where luma_slug(url) is not null and visibility = 'public';
  -- Luma events that a private event points at are left alone (an event made private stays off the site)
  select coalesce(array_agg(distinct luma_slug(url)), '{}') into v_private
    from events where luma_slug(url) is not null and visibility = 'private';

  -- 2. public events hosted by Kleros | Events or Wei Wei, upcoming and past
  foreach u in array kleros_people loop
    foreach p in array array['', '&period=past'] loop
      v_list := luma_get('/user/profile/events-hosting?user_api_id=' || u || '&pagination_limit=50' || p);
      for v_entry in select * from jsonb_array_elements(coalesce(v_list -> 'entries', '[]'::jsonb)) loop
        if exists (select 1 from jsonb_array_elements(v_entry -> 'hosts') h where h ->> 'api_id' = kleros_user)
           and (v_entry #>> '{event,visibility}') = 'public' then
          v_slugs := array_append(v_slugs, v_entry #>> '{event,url}');
        end if;
      end loop;
    end loop;
  end loop;

  foreach v_slug in array (select coalesce(array_agg(distinct s), '{}') from unnest(v_slugs) s where s is not null and s <> all (v_private)) loop
    v_checked := v_checked + 1;
    d := luma_get('/url?url=' || v_slug);
    if d is null or d ->> 'kind' <> 'event' then
      v_errors := array_append(v_errors, v_slug || ': not readable on Luma');
      continue;
    end if;
    d := d -> 'data';
    e := d -> 'event';
    g := e -> 'geo_address_info';
    v_tz := coalesce(e ->> 'timezone', 'UTC');
    v_start := (e ->> 'start_at')::timestamptz;
    v_end := (e ->> 'end_at')::timestamptz;

    select id into v_id from events where luma_slug(url) = v_slug limit 1;
    v_kleros_hosted := exists (select 1 from jsonb_array_elements(d -> 'hosts') h where h ->> 'api_id' = kleros_user);
    if v_id is not null and not v_kleros_hosted then
      -- someone else's event (Kleros spoke, sponsored or ran one session): only the image follows Luma,
      -- the title, date and time stay those of Kleros's part
      update events set cover_path = e ->> 'cover_url', updated_at = now()
       where id = v_id and nullif(e ->> 'cover_url', '') is not null and cover_path is distinct from e ->> 'cover_url';
      get diagnostics v_rows = row_count;
      v_updated := v_updated + v_rows;
    elsif v_id is not null then
      update events set
        title = coalesce(nullif(e ->> 'name', ''), title),
        cover_path = coalesce(nullif(e ->> 'cover_url', ''), cover_path),
        starts_on = (v_start at time zone v_tz)::date,
        ends_on = case when (v_end at time zone v_tz)::date > (v_start at time zone v_tz)::date
                       then (v_end at time zone v_tz)::date end,
        start_time = (v_start at time zone v_tz)::time,
        timezone = gmt_label(v_start, v_tz),
        venue = coalesce(nullif(g ->> 'address', ''), venue),
        updated_at = now()
      where id = v_id
        and (title, cover_path, starts_on, ends_on, start_time, timezone, venue)
            is distinct from (
              coalesce(nullif(e ->> 'name', ''), title),
              coalesce(nullif(e ->> 'cover_url', ''), cover_path),
              (v_start at time zone v_tz)::date,
              case when (v_end at time zone v_tz)::date > (v_start at time zone v_tz)::date then (v_end at time zone v_tz)::date end,
              (v_start at time zone v_tz)::time,
              gmt_label(v_start, v_tz),
              coalesce(nullif(g ->> 'address', ''), venue));
      get diagnostics v_rows = row_count;
      v_updated := v_updated + v_rows;
    else
      -- a new Kleros-hosted event
      select array_agg(h ->> 'api_id') into v_hosts from jsonb_array_elements(d -> 'hosts') h;
      v_region := case
        when e ->> 'location_type' = 'online' then 'Online'
        when v_tz like 'Europe/%' then 'Europe'
        when v_tz like 'Asia/%' then 'Asia'
        when v_tz like 'Africa/%' then 'Africa'
        when v_tz like 'Australia/%' or v_tz like 'Pacific/%' then 'Oceania'
        when v_tz like 'America/Argentina/%' or v_tz in ('America/Sao_Paulo', 'America/Santiago', 'America/Bogota',
             'America/Lima', 'America/Mexico_City', 'America/Montevideo', 'America/Caracas') then 'Latin America'
        when v_tz like 'America/%' then 'North America'
      end;
      v_new_slug := trim(both '-' from regexp_replace(lower(unaccent_safe(e ->> 'name')), '[^a-z0-9]+', '-', 'g'));
      v_new_slug := left(v_new_slug, 60) || '-' || to_char(v_start at time zone v_tz, 'YYYY');
      if exists (select 1 from events where slug = v_new_slug) then
        v_new_slug := v_new_slug || '-' || lower(v_slug);
      end if;
      insert into events (slug, title, kleros_role, organizer, event_type, starts_on, ends_on, start_time, timezone,
                          city, country, region, venue, url, cover_path, description, status)
      values (
        v_new_slug, e ->> 'name',
        case when v_hosts <@ kleros_people then 'host'::kleros_role else 'co_host'::kleros_role end,
        (select string_agg(h ->> 'name', ', ') from jsonb_array_elements(d -> 'hosts') h
          where h ->> 'api_id' <> all (kleros_people)),
        case when e ->> 'location_type' = 'online' then 'Online talk / Space' else 'Meetup' end,
        (v_start at time zone v_tz)::date,
        case when (v_end at time zone v_tz)::date > (v_start at time zone v_tz)::date then (v_end at time zone v_tz)::date end,
        (v_start at time zone v_tz)::time,
        gmt_label(v_start, v_tz),
        nullif(split_part(coalesce(g ->> 'city_state', ''), ',', 1), ''),
        nullif(g ->> 'country', ''),
        v_region,
        nullif(g ->> 'address', ''),
        'https://luma.com/' || v_slug,
        nullif(e ->> 'cover_url', ''),
        left(luma_text(d -> 'description_mirror'), 1200),
        'published');
      v_added := v_added + 1;
    end if;
  end loop;

  insert into luma_sync_log (checked, updated, added, errors, ran_by)
  values (v_checked, v_updated, v_added, v_errors, auth.uid());
  return jsonb_build_object('checked', v_checked, 'updated', v_updated, 'added', v_added, 'errors', to_jsonb(v_errors));
end $$;

create or replace function sync_feed() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_feed jsonb;
  it jsonb;
  ev events;
  v_id uuid;
  v_mid uuid;
  v_applied int := 0; v_failed int := 0;
  v_note text;
begin
  if auth.uid() is not null and not is_team() then
    raise exception 'Only the Kleros team can sync the feed';
  end if;
  perform set_config('app.importing', 'on', true);

  v_feed := feed_get();
  if v_feed is null then
    return jsonb_build_object('applied', 0, 'failed', 0, 'errors', jsonb_build_array('feed not readable'));
  end if;

  for it in select * from jsonb_array_elements(coalesce(v_feed -> 'items', '[]'::jsonb)) loop
    continue when nullif(it ->> 'id', '') is null
               or exists (select 1 from feed_applied where item_id = it ->> 'id' and ok);
    v_note := null;
    begin
      if it ->> 'kind' = 'event' then
        ev := jsonb_populate_record(null::events, it -> 'event');
        if ev.slug is null then raise exception 'event without slug'; end if;
        select id into v_id from events where slug = ev.slug;
        if v_id is not null and event_is_private(v_id) then raise exception 'slug % is not available', ev.slug; end if;
        if v_id is null then
          if ev.title is null or ev.starts_on is null then
            raise exception 'new event needs title and starts_on';
          end if;
          insert into events (slug, title, kleros_role, organizer, event_type, starts_on, ends_on, start_time,
                              timezone, city, country, region, venue, url, description, topics, cover_path, recap, status)
          values (ev.slug, ev.title, coalesce(ev.kleros_role, 'attending'), ev.organizer,
                  coalesce(ev.event_type, 'Conference'), ev.starts_on, ev.ends_on, ev.start_time, ev.timezone,
                  ev.city, ev.country, ev.region, ev.venue, ev.url, ev.description,
                  coalesce(ev.topics, '{}'), ev.cover_path, ev.recap, 'published');
          v_note := 'added';
        else
          -- fill in or correct only the fields the item carries
          update events e set
            title = coalesce(ev.title, e.title),
            kleros_role = coalesce(ev.kleros_role, e.kleros_role),
            organizer = coalesce(ev.organizer, e.organizer),
            event_type = coalesce(ev.event_type, e.event_type),
            starts_on = coalesce(ev.starts_on, e.starts_on),
            ends_on = coalesce(ev.ends_on, e.ends_on),
            start_time = coalesce(ev.start_time, e.start_time),
            timezone = coalesce(ev.timezone, e.timezone),
            city = coalesce(ev.city, e.city),
            country = coalesce(ev.country, e.country),
            region = coalesce(ev.region, e.region),
            venue = coalesce(ev.venue, e.venue),
            url = coalesce(ev.url, e.url),
            description = coalesce(ev.description, e.description),
            topics = case when it -> 'event' ? 'topics' then ev.topics else e.topics end,
            cover_path = coalesce(ev.cover_path, e.cover_path),
            recap = coalesce(ev.recap, e.recap),
            updated_at = now()
          where e.id = v_id;
          v_note := 'updated';
        end if;

      elsif it ->> 'kind' = 'material' then
        select id into v_id from events where slug = it ->> 'event_slug' and visibility = 'public';
        if v_id is null then raise exception 'no event with slug %', it ->> 'event_slug'; end if;
        if nullif(it ->> 'url', '') is null or nullif(it ->> 'title', '') is null then
          raise exception 'material needs url and title';
        end if;
        select m.id into v_mid from materials m
         where m.url = it ->> 'url'
           and not exists (select 1 from material_events me join events e on e.id = me.event_id
                            where me.material_id = m.id and e.visibility = 'private')
         limit 1;
        if v_mid is null then
          insert into materials (event_id, kind, title, speaker, url)
          values (v_id, (it ->> 'material_kind')::material_kind, it ->> 'title', it ->> 'speaker', it ->> 'url');
          v_note := 'material added';
        else
          insert into material_events (material_id, event_id) values (v_mid, v_id) on conflict do nothing;
          v_note := 'material linked';
        end if;

      else
        raise exception 'unknown kind %', it ->> 'kind';
      end if;

      insert into feed_applied (item_id, kind, slug, ok, note, source, url)
      values (it ->> 'id', it ->> 'kind', coalesce(it #>> '{event,slug}', it ->> 'event_slug'), true, v_note, it ->> 'source', it ->> 'url')
      on conflict (item_id) do update set applied_at = now(), ok = true, note = excluded.note;
      v_applied := v_applied + 1;
    exception when others then
      insert into feed_applied (item_id, kind, slug, ok, note, source, url)
      values (it ->> 'id', it ->> 'kind', coalesce(it #>> '{event,slug}', it ->> 'event_slug'), false, sqlerrm, it ->> 'source', it ->> 'url')
      on conflict (item_id) do update set applied_at = now(), note = excluded.note;
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('applied', v_applied, 'failed', v_failed);
end $$;
