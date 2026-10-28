-- Recordings and materials that belong to several events, and recordings with no event yet.
--
-- material_events links a material to any number of events. materials.event_id stays as the
-- "primary event" (older code and the transcript prompt read it), and is kept in step:
--   * inserting or changing materials.event_id adds the matching link;
--   * linking a material that has no primary event makes that event its primary;
--   * unlinking the primary event moves the primary to another linked event, or to null.
-- materials.event_id becomes nullable (a recording made on /record has no event at first), and
-- deleting an event no longer deletes recordings that are still linked to other events: the
-- foreign key now sets null, and the material moves to another linked event if it has one.
-- A material linked to no event at all stays in the team library (/admin/recordings).
--
-- Visibility: a material (and its transcript) is public when it is linked to at least one
-- published event; everything else is team only. Before this migration every material row
-- was public, including those of draft events.
--
-- Safe to run more than once.

-- ---------- join table ----------
create table if not exists material_events (
  material_id uuid not null references materials on delete cascade,
  event_id uuid not null references events on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  primary key (material_id, event_id)
);
create index if not exists material_events_event on material_events (event_id);
alter table material_events alter column created_by set default auth.uid();

-- backfill from the primary event
insert into material_events (material_id, event_id, created_at, created_by)
select m.id, m.event_id, m.created_at, m.created_by from materials m
 where m.event_id is not null
on conflict do nothing;

-- ---------- materials.event_id: nullable, set null on event delete ----------
alter table materials alter column event_id drop not null;
alter table materials drop constraint if exists materials_event_id_fkey;
alter table materials add constraint materials_event_id_fkey
  foreign key (event_id) references events on delete set null;

-- ---------- keep event_id and the links in step ----------
-- A new or changed primary event is always also a link.
create or replace function material_primary_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is not null and (tg_op = 'INSERT' or new.event_id is distinct from old.event_id) then
    insert into material_events (material_id, event_id, created_by)
    values (new.id, new.event_id, auth.uid())
    on conflict do nothing;
  end if;
  return null;
end $$;

drop trigger if exists material_primary_link on materials;
create trigger material_primary_link after insert or update of event_id on materials
  for each row execute function material_primary_link();

-- The primary event cannot be cleared while other links remain (an event delete sets it to
-- null; this moves it to the oldest remaining link instead).
create or replace function material_keep_primary() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is null and old.event_id is not null then
    select me.event_id into new.event_id from material_events me
     where me.material_id = new.id and me.event_id <> old.event_id
     order by me.created_at, me.event_id limit 1;
  end if;
  return new;
end $$;

drop trigger if exists material_keep_primary on materials;
create trigger material_keep_primary before update of event_id on materials
  for each row execute function material_keep_primary();

-- Linking a material without a primary event makes this event its primary.
create or replace function material_link_added() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update materials set event_id = new.event_id where id = new.material_id and event_id is null;
  return null;
end $$;

drop trigger if exists material_link_added on material_events;
create trigger material_link_added after insert on material_events
  for each row execute function material_link_added();

-- Unlinking the primary event moves the primary to another link, or clears it.
create or replace function material_link_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update materials m set event_id = (
      select me.event_id from material_events me
       where me.material_id = old.material_id and me.event_id <> old.event_id
       order by me.created_at, me.event_id limit 1)
   where m.id = old.material_id and m.event_id = old.event_id;
  return null;
end $$;

drop trigger if exists material_link_removed on material_events;
create trigger material_link_removed after delete on material_events
  for each row execute function material_link_removed();

revoke all on function material_primary_link() from public, anon, authenticated;
revoke all on function material_keep_primary() from public, anon, authenticated;
revoke all on function material_link_added() from public, anon, authenticated;
revoke all on function material_link_removed() from public, anon, authenticated;

-- ---------- row level security ----------
alter table material_events enable row level security;
grant select on material_events to anon, authenticated;
grant insert, delete on material_events to authenticated;

-- A link is visible when its event is: published, or any event for the team.
drop policy if exists "links of visible events are public" on material_events;
create policy "links of visible events are public" on material_events for select
  using (is_team() or exists (select 1 from events e where e.id = material_events.event_id and e.status = 'published'));
drop policy if exists "team links materials" on material_events;
create policy "team links materials" on material_events for insert to authenticated with check (is_team());
drop policy if exists "team unlinks materials" on material_events;
create policy "team unlinks materials" on material_events for delete to authenticated using (is_team());

-- Whether anyone may see a material: linked to a published event. Security definer so the
-- check does not depend on the caller's view of events and links (the team sees all anyway).
create or replace function material_is_public(p_material uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from material_events me join events e on e.id = me.event_id
     where me.material_id = p_material and e.status = 'published')
$$;
grant execute on function material_is_public(uuid) to anon, authenticated;

drop policy if exists "materials are public" on materials;
create policy "materials are public" on materials for select
  using (is_team() or material_is_public(id));

-- Transcripts follow their material.
do $$ begin
  if to_regclass('public.transcripts') is not null then
    execute 'drop policy if exists "transcripts are public" on transcripts';
    execute 'create policy "transcripts are public" on transcripts for select using (is_team() or material_is_public(material_id))';
  end if;
end $$;
