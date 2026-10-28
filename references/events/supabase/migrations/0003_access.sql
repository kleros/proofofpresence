-- Access: who can use the Kleros team desk (/admin).
--
-- Rule: a profile is admin when
--   its confirmed email is the master admin's (weiwei@kleros.io), or
--   profiles.admin_by_sql is true (set by hand from SQL, never from the API).
-- A profile is team when
--   it is admin, or
--   its email is confirmed and listed in team_access and not blocked, or
--   its email is confirmed, ends with @kleros.io and is not blocked in team_access.
-- An unconfirmed email never grants anything: Supabase magic-link sign-up inserts
-- the user first and sets email_confirmed_at on the first click, and the update
-- trigger below grants access at that moment.
-- Anonymous guests (QR questions) have no confirmed email and are never team.
-- Only admins can grant, block or remove access. Nobody can change their own
-- is_team / is_admin / admin_by_sql, and admin_by_sql can only be changed from SQL:
--   update profiles set admin_by_sql = true where id = '<user id>';
--
-- Safe to run once on a database that already has 0001, 0002 and the content SQL,
-- and safe to re-run.

-- ---------- columns and table ----------
alter table profiles add column if not exists is_admin boolean not null default false;
alter table profiles add column if not exists admin_by_sql boolean not null default false;

create table if not exists team_access (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  blocked boolean not null default false,       -- true removes team access, even for @kleros.io
  granted_by uuid references auth.users on delete set null,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- helpers ----------
create or replace function master_admin_email() returns text
language sql immutable as $$ select 'weiwei@kleros.io'::text $$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

-- True when this auth user has confirmed the master admin email.
create or replace function is_master_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_user
       and lower(u.email) = master_admin_email()
       and u.email_confirmed_at is not null
  )
$$;

-- The access rule in one place. p_confirmed: the email has been confirmed.
drop function if exists team_status_for(text, boolean);
create or replace function team_status_for(p_email text, p_confirmed boolean, p_is_admin boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_is_admin, false) then true
    when not coalesce(p_confirmed, false) then false
    when p_email is null or p_email = '' then false
    else coalesce(
      (select not ta.blocked from team_access ta where ta.email = lower(p_email)),
      lower(p_email) like '%@kleros.io'
    )
  end
$$;

-- Recompute is_team for every profile whose auth email matches. An unconfirmed
-- email gets no access from a grant (team_status_for returns false for it).
create or replace function sync_team_for_email(p_email text) returns void
language sql security definer set search_path = public as $$
  update profiles p
     set is_team = team_status_for(u.email, u.email_confirmed_at is not null, p.is_admin)
    from auth.users u
   where u.id = p.id
     and lower(u.email) = lower(p_email)
     and p.is_team is distinct from team_status_for(u.email, u.email_confirmed_at is not null, p.is_admin)
$$;

-- ---------- new sign-ups ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_confirmed boolean := new.email_confirmed_at is not null;
  v_admin boolean := v_confirmed and coalesce(lower(new.email) = master_admin_email(), false);
begin
  insert into profiles (id, display_name, is_team, is_admin)
  values (new.id, split_part(new.email, '@', 1), team_status_for(new.email, v_confirmed, v_admin), v_admin)
  on conflict (id) do update
    set is_admin = profiles.admin_by_sql or excluded.is_admin,
        is_team  = team_status_for(new.email, v_confirmed, profiles.admin_by_sql or excluded.is_admin);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- An email change or a confirmation (the first magic-link click) re-applies the rule.
-- Admin from the master email is recomputed, so changing away from it drops admin;
-- admin_by_sql is kept.
create or replace function handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_confirmed boolean := new.email_confirmed_at is not null;
  v_master boolean := v_confirmed and coalesce(lower(new.email) = master_admin_email(), false);
begin
  update profiles p
     set is_admin = v_master or p.admin_by_sql,
         is_team  = team_status_for(new.email, v_confirmed, v_master or p.admin_by_sql)
   where p.id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email, email_confirmed_at on auth.users
  for each row when (old.email is distinct from new.email or old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function handle_user_email_change();

-- ---------- grants and blocks apply to existing accounts at once ----------
create or replace function handle_team_access_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform sync_team_for_email(old.email); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform sync_team_for_email(new.email); end if;
  return null;
end $$;

drop trigger if exists on_team_access_change on team_access;
create trigger on_team_access_change after insert or update or delete on team_access
  for each row execute function handle_team_access_change();

-- Record who granted access when the app does not say.
create or replace function team_access_defaults() returns trigger
language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  if new.granted_by is null then new.granted_by := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists team_access_defaults on team_access;
create trigger team_access_defaults before insert or update on team_access
  for each row execute function team_access_defaults();

-- ---------- protect the flags ----------
-- From the API (roles anon / authenticated): nobody changes is_admin or
-- admin_by_sql, and only admins change is_team. Triggers above run as the owner,
-- so they pass. is_admin is always derived (confirmed master email or admin_by_sql),
-- so it cannot stick after an email change. Admins are always team.
create or replace function protect_profile_flags() returns trigger
language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.is_admin is distinct from old.is_admin or new.admin_by_sql is distinct from old.admin_by_sql then
      raise exception 'admin rights can only be changed by the database owner' using errcode = '42501';
    end if;
    if new.is_team is distinct from old.is_team and not is_admin() then
      raise exception 'only admins can change team access' using errcode = '42501';
    end if;
  end if;
  new.is_admin := coalesce(new.admin_by_sql, false) or is_master_user(new.id);
  if new.is_admin then new.is_team := true; end if;
  return new;
end $$;

drop trigger if exists protect_profile_flags on profiles;
create trigger protect_profile_flags before update on profiles
  for each row execute function protect_profile_flags();

-- ---------- row level security ----------
alter table team_access enable row level security;

drop policy if exists "team reads access list" on team_access;
create policy "team reads access list" on team_access for select using (is_team());
drop policy if exists "admins grant access" on team_access;
create policy "admins grant access" on team_access for insert with check (is_admin());
drop policy if exists "admins change access" on team_access;
create policy "admins change access" on team_access for update using (is_admin()) with check (is_admin());
drop policy if exists "admins remove access" on team_access;
create policy "admins remove access" on team_access for delete using (is_admin());

drop policy if exists "update own profile" on profiles;
create policy "update own profile" on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and is_team = is_team() and is_admin = is_admin());
-- Before: any team member could edit any profile (including is_team). Now admins only.
drop policy if exists "team edits profiles" on profiles;
drop policy if exists "admins edit profiles" on profiles;
create policy "admins edit profiles" on profiles for update using (is_admin()) with check (is_admin());

grant select, insert, update, delete on team_access to authenticated;
revoke all on team_access from anon;

-- ---------- admin directory (profiles has no email column) ----------
-- Everyone with team access, everyone granted or blocked by email. Admins only.
create or replace function team_directory()
returns table (
  email text, user_id uuid, display_name text, is_team boolean, is_admin boolean,
  kleros_email boolean, granted boolean, blocked boolean, note text,
  granted_at timestamptz, last_sign_in timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return query
    with members as (
      select lower(u.email) as email, u.id as user_id, p.display_name, p.is_team, p.is_admin,
             u.last_sign_in_at
        from profiles p join auth.users u on u.id = p.id
       where u.email is not null and (p.is_team or p.is_admin)
    )
    select coalesce(m.email, ta.email)::text,
           coalesce(m.user_id, (select u2.id from auth.users u2 where lower(u2.email) = ta.email limit 1)),
           coalesce(m.display_name, (select p2.display_name from profiles p2 join auth.users u3 on u3.id = p2.id where lower(u3.email) = ta.email limit 1)),
           coalesce(m.is_team, false), coalesce(m.is_admin, false),
           coalesce(m.email, ta.email) like '%@kleros.io',
           ta.email is not null and not ta.blocked, coalesce(ta.blocked, false), ta.note,
           ta.created_at, m.last_sign_in_at
      from members m
      full join team_access ta on ta.email = m.email
     order by coalesce(m.is_admin, false) desc, coalesce(ta.blocked, false), coalesce(m.email, ta.email);
end $$;

revoke execute on function team_directory() from public, anon;
grant execute on function team_directory() to authenticated;
revoke execute on function sync_team_for_email(text) from public, anon, authenticated;
-- internal helpers: would reveal who is granted or blocked
revoke execute on function team_status_for(text, boolean, boolean) from public, anon, authenticated;
revoke execute on function is_master_user(uuid) from public, anon;
-- protect_profile_flags runs as the caller and needs it; it only says whether one id is the master.
grant execute on function is_master_user(uuid) to authenticated;

-- ---------- existing accounts ----------
-- Keep anyone with a confirmed email who was given team access by hand before this migration.
insert into team_access (email, note)
select lower(u.email), 'Kept from manual access before 0003'
  from profiles p join auth.users u on u.id = p.id
 where p.is_team and u.email is not null and u.email_confirmed_at is not null
   and lower(u.email) not like '%@kleros.io'
   and lower(u.email) <> master_admin_email()
on conflict (email) do nothing;

-- is_admin is recomputed by protect_profile_flags on every update.
update profiles p set is_admin = (p.admin_by_sql or is_master_user(p.id))
 where p.is_admin is distinct from (p.admin_by_sql or is_master_user(p.id));

update profiles p set is_team = team_status_for(u.email, u.email_confirmed_at is not null, p.is_admin)
  from auth.users u
 where u.id = p.id
   and p.is_team is distinct from team_status_for(u.email, u.email_confirmed_at is not null, p.is_admin);
