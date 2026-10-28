-- Private events, second round (fixes from the review of 0010). Needs 0010. Safe to run more than once.
--
--   * Accounts can be deleted again: a deleted creator leaves created_by empty instead of blocking
--     the delete, and the SQL editor can hand an event to someone else
--     (update events set created_by = '<user id>' where id = '<event id>').
--   * A private event's address gets a new random ending whenever a member renames it, and goes back
--     to its plain address when it is made public.
--   * Making an event public clears its collaborators; the list only exists on private events.
--   * Only an event that was made private keeps its Luma event off the site. A private event that
--     just links to a Luma page no longer stops the hourly sync.
--   * Items: nobody can point an item at a file of an item they cannot edit; an item is deleted only by
--     someone who can edit every event it is on (others just take it off their event); moving an item
--     into a private event follows the same rules as linking it; an item with no primary event that
--     is still on an event is not shown as a library item.
--   * When an event is made private, its items that are also on public events take one of those as
--     their primary event, so the private event's id is not left where everyone can read it.

-- ---------- accounts can be deleted ----------
do $$ begin
  alter table events drop constraint if exists events_created_by_fkey;
  alter table events add constraint events_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
  alter table materials drop constraint if exists materials_created_by_fkey;
  alter table materials add constraint materials_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
  alter table meeting_requests drop constraint if exists meeting_requests_user_id_fkey;
  alter table meeting_requests add constraint meeting_requests_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;
end $$;

-- ---------- columns ----------
-- public_slug: a private event's address without its random ending, used when it is made public.
-- luma_hidden: the Luma event of an event that was made private, kept off the site by the Luma sync.
alter table events add column if not exists public_slug text;
alter table events add column if not exists luma_hidden text;
-- Rows from before this migration. Under 0010 (live from about 05:30 UTC on 27 Oct 2026) an event
-- created private got a random ending; one made private kept its public address, and anything older
-- was created public. A typed date at the end (20261210) is not a random ending.
update events set public_slug = regexp_replace(slug, '-[0-9a-f]{8}$', '')
 where visibility = 'private' and public_slug is null and slug ~ '-[0-9a-f]{8}$'
   and slug !~ '-((19|20)[0-9]{6}|[0-9]{4}(19|20)[0-9]{2})$'
   and created_at >= timestamptz '2026-10-27 05:30:00+00';
update events p set luma_hidden = luma_slug(p.url)
 where p.visibility = 'private' and p.luma_hidden is null and luma_slug(p.url) is not null
   and (p.public_slug is null or p.created_at < timestamptz '2026-10-27 05:30:00+00');

-- ---------- creator, visibility and address ----------
-- Only the creator switches an event between public and private (an older event with no creator:
-- the admin, who then becomes its creator). Making it public needs team access as well.
-- Signed-in people cannot change created_by; the SQL editor, the jobs and the clean-up when an
-- account is deleted (a cascade, one trigger level down) can.
create or replace function events_keep_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.importing', true), '') <> 'on' then
      new.created_by := coalesce(new.created_by, auth.uid());
    end if;
    if auth.uid() is not null then new.public_slug := null; new.luma_hidden := null; end if;
  else
    if auth.uid() is not null and new.visibility is distinct from old.visibility then
      if new.visibility = 'private' and not coalesce(old.created_by = auth.uid() or (old.created_by is null and is_admin()), false) then
        raise exception 'Only the person who created this event can make it private.' using errcode = '42501';
      end if;
      if new.visibility = 'public' and not coalesce(old.created_by = auth.uid(), false) then
        raise exception 'Only the person who created this event can make it public.' using errcode = '42501';
      end if;
      if new.visibility = 'public' and not is_team() then
        raise exception 'Making an event public needs a Kleros team account.' using errcode = '42501';
      end if;
    end if;
    -- a creator is only given when an event without one is made private (only an admin can, see
    -- above); a private event whose creator's account was deleted keeps an empty creator until the
    -- SQL editor hands it over
    if auth.uid() is not null and pg_trigger_depth() = 1 then
      new.created_by := coalesce(old.created_by, case when old.visibility = 'public' and new.visibility = 'private' then auth.uid() end);
    end if;
    -- kept by the rules below; only the SQL editor and the jobs may set them directly
    if auth.uid() is not null then new.public_slug := old.public_slug; new.luma_hidden := old.luma_hidden; end if;
  end if;

  -- made private: its Luma event stays off the site (see sync_luma)
  if tg_op = 'UPDATE' and old.visibility = 'public' and new.visibility = 'private' then
    new.luma_hidden := luma_slug(old.url);
  end if;
  -- An edit form (or a stale tab) sends back the plain part of a private event's address: that is
  -- not a new address.
  if tg_op = 'UPDATE' and old.visibility = 'private' and old.public_slug is not null and new.slug = old.public_slug then
    new.slug := old.slug;
  end if;
  -- A private event's address ends in a random part, so nobody can guess it or learn from a
  -- "slug taken" error that it exists: added when it is created private and whenever it gets a new
  -- address while private, including in the save that makes it private. Made private without a
  -- new address, an event keeps the one it had (it was public already, and the Luma and feed jobs
  -- know it by it).
  if new.visibility = 'private' and (tg_op = 'INSERT' or new.slug is distinct from old.slug) then
    new.public_slug := new.slug;
    new.slug := new.slug || '-' || left(md5(gen_random_uuid()::text), 8);
  elsif tg_op = 'UPDATE' and old.visibility = 'private' and new.visibility = 'public' then
    -- made public: back to the plain address when it is free
    if new.slug = old.slug and old.public_slug is not null
       and not exists (select 1 from events where slug = old.public_slug and id <> new.id) then
      new.slug := old.public_slug;
    end if;
    new.public_slug := null;
    new.luma_hidden := null;
  end if;

  -- a private event never counts as published, so making it public later starts as a draft
  if new.visibility = 'private' then new.status := 'draft'; end if;
  return new;
end $$;
drop trigger if exists events_keep_creator on events;
create trigger events_keep_creator before insert or update on events
  for each row execute function events_keep_creator();
revoke all on function events_keep_creator() from public, anon, authenticated;

-- What follows a switch: made private, its shared items take a public event as their primary one;
-- made public, its collaborators are removed and its items stop pointing at other private events.
create or replace function events_visibility_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.visibility = 'public' and new.visibility = 'private' then
    update materials m set event_id = (
        select me.event_id from material_events me join events e on e.id = me.event_id
         where me.material_id = m.id and e.visibility = 'public'
         order by me.created_at, me.event_id limit 1)
     where m.event_id = new.id
       and exists (select 1 from material_events me join events e on e.id = me.event_id
                    where me.material_id = m.id and e.visibility = 'public');
  elsif old.visibility = 'private' and new.visibility = 'public' then
    delete from event_collaborators where event_id = new.id;
    -- items on this event whose primary is another private event now show this one instead
    update materials m set event_id = new.id
      from events p
     where p.id = m.event_id and p.visibility = 'private'
       and exists (select 1 from material_events me where me.material_id = m.id and me.event_id = new.id);
  end if;
  return null;
end $$;
drop trigger if exists events_visibility_changed on events;
create trigger events_visibility_changed after update of visibility on events
  for each row when (old.visibility is distinct from new.visibility)
  execute function events_visibility_changed();
revoke all on function events_visibility_changed() from public, anon, authenticated;
-- events made public while 0010 was live kept their collaborators
delete from event_collaborators c using events e where e.id = c.event_id and e.visibility = 'public';

-- ---------- collaborators: private events only ----------
drop policy if exists "members see collaborators" on event_collaborators;
drop policy if exists "members remove collaborators" on event_collaborators;
create policy "members see collaborators" on event_collaborators for select to authenticated
  using (event_is_private(event_id) and is_event_member(event_id));
create policy "members remove collaborators" on event_collaborators for delete to authenticated
  using (event_is_private(event_id) and is_event_member(event_id));

create or replace function event_creator_email(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select lower(u.email) from events e join auth.users u on u.id = e.created_by
   where e.id = p_event and e.visibility = 'private' and is_event_member(p_event)
$$;

-- ---------- items (materials) ----------

-- No links at all: a library item. (Its primary event_id can be empty while a link remains.)
create or replace function material_unlinked(p_material uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from material_events me where me.material_id = p_material)
$$;

-- Every event the item is on is one the caller can edit.
create or replace function material_links_all_editable(p_material uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from material_events me where me.material_id = p_material and not can_edit_event(me.event_id))
$$;
grant execute on function material_unlinked(uuid), material_links_all_editable(uuid) to anon, authenticated;

drop policy if exists "materials are public" on materials;
create policy "materials are public" on materials for select
  using ((event_id is null and is_team() and material_unlinked(id))
         or (event_id is not null and can_see_event(event_id)) or material_visible(id));
-- Deleting an item takes it off every event it is on, so it needs all of them; anyone else takes it
-- off their own event instead (remove_material_from_event below).
drop policy if exists "editors remove materials" on materials;
create policy "editors remove materials" on materials for delete to authenticated
  using (material_editable(id) and material_links_all_editable(id));

-- An item's files: a path already used by an item the caller cannot edit, or one in the folder of an
-- event the caller cannot edit, is refused (it would hand the caller that file). Paths the item had
-- already are fine.
create or replace function material_paths_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  if auth.uid() is null then return new; end if;
  foreach p in array array[new.file_path, new.pdf_path, new.audio_path] loop
    continue when p is null or p ~ '^https?://';
    continue when tg_op = 'UPDATE' and p in (old.file_path, old.pdf_path, old.audio_path);
    if exists (select 1 from materials m where m.id <> new.id
                  and p in (m.file_path, m.pdf_path, m.audio_path) and not material_editable(m.id))
       or (storage_event_id(p) is not null and not can_edit_event(storage_event_id(p))) then
      raise exception 'This file belongs to an item you cannot edit.' using errcode = '42501';
    end if;
  end loop;
  -- an item that is also on an event the caller cannot edit keeps its files (dropping one would let
  -- the caller delete it as an unused file)
  if tg_op = 'UPDATE' and not material_links_all_editable(new.id)
     and not exists (select 1 from material_events me join events e on e.id = me.event_id
                      where me.material_id = new.id and e.visibility = 'public')
     and exists (select 1 from unnest(array[old.file_path, old.pdf_path, old.audio_path]) o
                  where o is not null and o !~ '^https?://'
                    and (o in (new.file_path, new.pdf_path, new.audio_path)) is not true) then
    raise exception 'This item is also on an event you cannot edit, so its files stay as they are.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists material_paths_check on materials;
create trigger material_paths_check before insert or update of file_path, pdf_path, audio_path on materials
  for each row execute function material_paths_check();
revoke all on function material_paths_check() from public, anon, authenticated;

-- An item's primary event (event_id, which everyone who sees the item can read) is never emptied or
-- set to a private event while the item is on a public event.
create or replace function material_keep_primary() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is null and old.event_id is not null then
    -- emptied: a public link first (the old one too, so a private one is never picked over it),
    -- otherwise another link
    select me.event_id into new.event_id from material_events me join events e on e.id = me.event_id
     where me.material_id = new.id and (e.visibility = 'public' or me.event_id <> old.event_id)
     order by (e.visibility = 'private'), me.created_at, me.event_id limit 1;
  elsif new.event_id is distinct from old.event_id
        and exists (select 1 from events where id = new.event_id and visibility = 'private') then
    select coalesce(
             (select me.event_id from material_events me join events e on e.id = me.event_id
               where me.material_id = new.id and e.visibility = 'public'
               order by me.created_at, me.event_id limit 1),
             new.event_id)
      into new.event_id;
  end if;
  return new;
end $$;

-- Moving an item's primary event (event_id) somewhere it is not linked yet follows the linking rules:
-- an event the caller can edit, and a private event only for items that are on private events alone.
create or replace function material_event_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.event_id is not null and new.event_id is distinct from old.event_id
     and not exists (select 1 from material_events me where me.material_id = new.id and me.event_id = new.event_id) then
    if not can_edit_event(new.event_id) then
      raise exception 'This item cannot be moved to an event you cannot edit.' using errcode = '42501';
    end if;
    if event_is_private(new.event_id) and not material_private_only(new.id) then
      raise exception 'Items from the recordings library or from a public event cannot be moved into a private event.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Files. Replacing, moving or deleting a file an item uses needs that item and every event it is on;
-- a file nobody uses follows its folder (0010). Whoever removed an item may delete its files for an
-- hour afterwards, wherever they are stored (a recording made on /record lives under standalone/).
create table if not exists material_file_releases (
  name text primary key,
  released_to uuid not null,
  released_at timestamptz not null default now()
);
alter table material_file_releases enable row level security;
revoke all on material_file_releases from public, anon, authenticated;

create or replace function storage_file_released(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not storage_file_used(p_name)
     and exists (select 1 from material_file_releases r
                  where r.name = p_name and r.released_to = auth.uid() and r.released_at > now() - interval '1 hour')
$$;

create or replace function storage_file_deletable(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (storage_file_editable(p_name)
          and not exists (select 1 from materials m
                           where p_name in (m.file_path, m.pdf_path, m.audio_path)
                             and not (material_editable(m.id) and material_links_all_editable(m.id))))
      or storage_file_released(p_name)
$$;
grant execute on function storage_file_released(text), storage_file_deletable(text) to anon, authenticated;

-- (a delete is also checked against the select policy)
drop policy if exists "materials files are public" on storage.objects;
create policy "materials files are public" on storage.objects for select
  using (bucket_id = 'materials' and (storage_file_visible(name) or storage_file_released(name)));
drop policy if exists "team uploads materials" on storage.objects;
-- (a file released to someone can be deleted by them, not uploaded or replaced)
create policy "team uploads materials" on storage.objects for insert
  with check (bucket_id = 'materials' and storage_file_editable(name) and storage_file_deletable(name));
drop policy if exists "team updates materials" on storage.objects;
create policy "team updates materials" on storage.objects for update
  using (bucket_id = 'materials' and storage_file_editable(name) and storage_file_deletable(name))
  with check (bucket_id = 'materials' and storage_file_editable(name) and storage_file_deletable(name));
drop policy if exists "team deletes materials" on storage.objects;
create policy "team deletes materials" on storage.objects for delete
  using (bucket_id = 'materials' and storage_file_deletable(name));

-- "Remove" on an event: takes the item off that event when it is on others too (including events the
-- caller cannot see), and deletes it when this was its last event. Then returns its files that
-- nothing else uses, which the caller may delete for the next hour.
create or replace function remove_material_from_event(p_material uuid, p_event uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare v_paths text[];
begin
  if auth.uid() is null then
    raise exception 'This item is not on an event you can edit.' using errcode = '42501';
  end if;
  -- one change to an item's events at a time (two people removing it from its two events at once)
  perform 1 from materials where id = p_material for update;
  if not can_edit_event(p_event)
     or not exists (select 1 from material_events where material_id = p_material and event_id = p_event) then
    raise exception 'This item is not on an event you can edit.' using errcode = '42501';
  end if;
  if exists (select 1 from material_events where material_id = p_material and event_id <> p_event) then
    delete from material_events where material_id = p_material and event_id = p_event;
    return '{}';
  end if;
  if not (material_editable(p_material) and material_links_all_editable(p_material)) then
    raise exception 'You cannot delete this item.' using errcode = '42501';
  end if;
  delete from materials where id = p_material
   returning array_remove(array[file_path, pdf_path, audio_path], null) into v_paths;
  select coalesce(array_agg(distinct x), '{}') into v_paths
    from unnest(v_paths) x where x !~ '^https?://' and not storage_file_used(x);
  delete from material_file_releases where released_at < now() - interval '1 day';
  insert into material_file_releases (name, released_to) select x, auth.uid() from unnest(v_paths) x
    on conflict (name) do update set released_to = excluded.released_to, released_at = now();
  return v_paths;
end $$;
revoke all on function remove_material_from_event(uuid, uuid) from public, anon;
grant execute on function remove_material_from_event(uuid, uuid) to authenticated;

-- The 0010 guards, now one at a time per item as well.
create or replace function material_keep_private_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from materials where id = old.material_id for update;
  if event_is_private(old.event_id)
     and exists (select 1 from materials where id = old.material_id)
     and not exists (select 1 from material_events where material_id = old.material_id and event_id <> old.event_id) then
    raise exception 'This item belongs only to a private event. Delete it, or link it to another event first.'
      using errcode = '42501';
  end if;
  return old;
end $$;

create or replace function events_private_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.visibility = 'private' then
    perform 1 from materials m
     where m.event_id = old.id
        or exists (select 1 from material_events me where me.material_id = m.id and me.event_id = old.id)
     order by m.id for update of m;
    delete from materials m
     where (m.event_id = old.id
            or exists (select 1 from material_events me where me.material_id = m.id and me.event_id = old.id))
       and not exists (select 1 from material_events me where me.material_id = m.id and me.event_id <> old.id);
  end if;
  return old;
end $$;

-- ---------- the hourly Luma job ----------
-- Same as in 0010, except: only events that were made private keep their Luma event off the site
-- (luma_hidden), and existing events are matched among public events only.
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
  -- the Luma event of an event that was made private is not added to the site again (a private
  -- event that only links to a Luma page stops nothing, and a public event that links to the same
  -- Luma event keeps syncing)
  select coalesce(array_agg(distinct p.luma_hidden), '{}') into v_private
    from events p where p.visibility = 'private' and p.luma_hidden is not null
     and not exists (select 1 from events q where q.visibility = 'public' and luma_slug(q.url) = p.luma_hidden);

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

    select id into v_id from events where luma_slug(url) = v_slug and visibility = 'public' limit 1;
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

-- Done. Reload the API schema cache so the new function is callable at once.
notify pgrst, 'reload schema';
