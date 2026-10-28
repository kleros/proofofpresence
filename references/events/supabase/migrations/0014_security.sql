-- Fixes from the security review of 28 October 2026. Needs 0010 and 0012. Safe to run more than
-- once, and all or nothing: if any statement fails, nothing is changed. The last statement prints
-- a short report.
--
-- Before Run:
--   * The site version that ships with this file is live on every host (Vercel, and Netlify after
--     Sync fork if it builds from a fork): https://<host>/f/x/y answers 404 with
--     "cache-control: private, no-store". Until then pages link to the file addresses section 7
--     switches off.
--   * Reload every host console, big screen and /q/ page that was open before that deploy.
--   * Run it the same day as the deploy, outside a live event.
--
--   1. Ask: the question counts the assistant needs before anyone outside the team can ask
--      (the same as the first part of 0013, so this file is enough on its own).
--   2. Socials feed: read from GitHub or events.kleros.io only, https links only, and the title and
--      link of an event the feed did not add stay as the team set them.
--   3. Sign-in: no stored passwords, so nobody can set one on an address before its owner signs in.
--   4. Votes: no longer readable by others or sent over realtime.
--   5. Live Q&A: limits per person, guest and team marks set by the database, reserved names, and
--      host approval before a question goes on the big screen.
--   6. Votes: the automatic self-votes from before 26 October are removed.
--   7. Uploaded files: a private bucket, served by the site at /f/<path>.

-- ---------- 0. what this file needs ----------
do $$
begin
  if to_regprocedure('public.can_edit_event(uuid)') is null
     or to_regprocedure('public.remove_material_from_event(uuid,uuid)') is null
     or to_regprocedure('public.material_paths_check()') is null then
    raise exception 'Run 0010_private_events.sql and 0012_private_events_round2.sql first, then run this file again.';
  end if;
end $$;

-- ---------- 1. Ask: question counts kept in the database ----------
-- The assistant takes questions from visitors, QR guests and accounts outside the team only while
-- these counts work (with SUPABASE_SERVICE_ROLE_KEY set on the host), so its limits hold across
-- every server instance. The same as the first part of 0013; the transcript search stays in 0013.
create table if not exists ask_usage (
  key text not null,          -- a hashed visitor address, a user id, 'all' for the daily total, or 'check' (the site checking that this works)
  bucket text not null,       -- '10m:<number>' or 'day:<YYYY-MM-DD>' (UTC)
  n int not null default 0,
  day date not null default (now() at time zone 'utc')::date,
  primary key (key, bucket)
);
alter table ask_usage enable row level security;   -- no policies: nobody reads it through the API
revoke all on ask_usage from anon, authenticated;

-- Counts one question and returns null, or which limit it is over ('burst', 'daily', 'overall').
-- A question over a limit is not counted. 0 means no limit.
create or replace function ask_take(p_key text, p_burst int, p_daily int, p_overall int)
returns text language plpgsql security definer set search_path = public as $$
declare
  b10 text := '10m:' || floor(extract(epoch from now()) / 600)::bigint;
  bday text := 'day:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  n10 int; nday int; nall int := 0;
  over text;
begin
  if p_key is null or p_key = '' or p_key = 'all' then raise exception 'bad key'; end if;
  insert into ask_usage as u (key, bucket, n) values (p_key, b10, 1)
    on conflict (key, bucket) do update set n = u.n + 1 returning n into n10;
  insert into ask_usage as u (key, bucket, n) values (p_key, bday, 1)
    on conflict (key, bucket) do update set n = u.n + 1 returning n into nday;
  if p_overall > 0 then
    insert into ask_usage as u (key, bucket, n) values ('all', bday, 1)
      on conflict (key, bucket) do update set n = u.n + 1 returning n into nall;
  end if;
  over := case
    when p_burst > 0 and n10 > p_burst then 'burst'
    when p_daily > 0 and nday > p_daily then 'daily'
    when p_overall > 0 and nall > p_overall then 'overall'
  end;
  if over is not null then
    update ask_usage set n = n - 1 where key = p_key and bucket in (b10, bday);
    if p_overall > 0 then update ask_usage set n = n - 1 where key = 'all' and bucket = bday; end if;
  end if;
  -- now and then, forget counts older than two days
  if random() < 0.01 then delete from ask_usage where day < (now() at time zone 'utc')::date - 2; end if;
  return over;
end $$;
revoke execute on function ask_take(text, int, int, int) from public, anon, authenticated;
grant execute on function ask_take(text, int, int, int) to service_role;

-- ---------- 2. Socials feed: where it is read from, and https links only ----------
-- sync_feed() runs every hour from pg_cron with full rights, so what it reads must come from an
-- address only Kleros controls, and what it writes must be plain https links.
--   * The feed is read from the copy on GitHub (main branch of weiwei-ooi/kleros-events, the
--     repository the site is built from) and, when GitHub fails, from https://events.kleros.io.
--     kleros-events.vercel.app is no longer read: once that Vercel project is switched off,
--     anyone could take the name and serve a feed. GitHub caches the file for up to five minutes.
--     If the repository moves or the account is renamed, change the address here first.
--   * Every link an item carries (source, url, event url, event cover_path) must be a plain https
--     link: https://, a host name, printable ASCII only, no user name or password, at most 2048
--     characters. An item with any other link is not applied; the reason goes to feed_applied and
--     the item is tried again every hour until it is corrected in the feed.
--   * The title and link of an event the feed did not add belong to the team (or to Luma): an
--     item that would set or change either is not applied.
--   * One run at a time: a second run while one is going returns {"busy": true}.

create or replace function feed_get() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r extensions.http_response;
  v_url text;
  v_feed jsonb;
begin
  -- two addresses at most 3 s each, so that Sync now on /admin (8 s statement limit for signed-in
  -- users) still answers
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '3');
  foreach v_url in array array[
    'https://raw.githubusercontent.com/weiwei-ooi/kleros-events/main/public/updates/feed.json',
    'https://events.kleros.io/updates/feed.json'
  ] loop
    begin
      r := extensions.http_get(v_url || '?t=' || extract(epoch from now())::bigint);
      if r.status = 200 then
        v_feed := r.content::jsonb;
        if jsonb_typeof(v_feed) = 'object' and jsonb_typeof(v_feed -> 'items') = 'array' then
          return v_feed;
        end if;
      end if;
    exception when others then
      null;  -- not reachable or not JSON: try the next address
    end;
  end loop;
  return null;
end $$;
revoke all on function feed_get() from public, anon, authenticated;

-- Why a link from the feed cannot be used, or null when it can (or when there is no link).
create or replace function feed_url_problem(p_url text) returns text
language sql immutable as $$
  select case
    when p_url is null then null
    when length(p_url) > 2048 then 'is longer than 2048 characters'
    when p_url !~ '^https://' then 'must start with https://'
    when p_url ~ '[^!-~]' then 'has spaces, control characters or characters outside printable ASCII'
    when p_url !~ '^https://[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+(?::[0-9]{1,5})?(?:[/?#].*)?$'
      then 'has no valid host name, or has a user name or password in it'
  end
$$;
revoke all on function feed_url_problem(text) from public, anon, authenticated;

create or replace function sync_feed() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_feed jsonb;
  it jsonb;
  ev events;
  v_id uuid;
  v_mid uuid;
  v_title text; v_url text; v_created timestamptz;
  v_applied int := 0; v_failed int := 0;
  v_note text;
  v_problem text;
begin
  if auth.uid() is not null and not is_team() then
    raise exception 'Only the Kleros team can sync the feed';
  end if;
  perform set_config('app.importing', 'on', true);
  -- one run at a time: the hourly job and Sync now pressed at minute 17 would otherwise both add
  -- the same new event or material
  if not pg_try_advisory_xact_lock(hashtext('public.sync_feed')) then
    return jsonb_build_object('applied', 0, 'failed', 0, 'busy', true);
  end if;

  v_feed := feed_get();
  if v_feed is null then
    return jsonb_build_object('applied', 0, 'failed', 0, 'errors', jsonb_build_array('feed not readable'));
  end if;

  for it in select * from jsonb_array_elements(coalesce(v_feed -> 'items', '[]'::jsonb)) loop
    continue when nullif(it ->> 'id', '') is null
               or exists (select 1 from feed_applied where item_id = it ->> 'id' and ok);
    v_note := null;
    begin
      -- every link is checked before anything is written
      v_problem := coalesce('source ' || feed_url_problem(it ->> 'source'),
                            'url ' || feed_url_problem(it ->> 'url'));
      if v_problem is not null then raise exception '%', v_problem; end if;

      if it ->> 'kind' = 'event' then
        ev := jsonb_populate_record(null::events, it -> 'event');
        v_problem := coalesce('event url ' || feed_url_problem(ev.url),
                              'event cover_path ' || feed_url_problem(ev.cover_path));
        if v_problem is not null then raise exception '%', v_problem; end if;
        if ev.slug is null then raise exception 'event without slug'; end if;
        select id, title, url, created_at into v_id, v_title, v_url, v_created from events where slug = ev.slug;
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
          -- An event the feed did not add keeps its title and link: an item may repeat them but not
          -- set or change them. The feed added it when its "added" record was written in the same run that
          -- created the event (same transaction, so the same time); an event the team deleted and
          -- created again under the same address does not count.
          if not exists (select 1 from feed_applied f
                          where f.kind = 'event' and f.ok and f.note = 'added'
                            and f.slug = ev.slug and f.applied_at = v_created) then
            if ev.title is not null and ev.title is distinct from v_title then
              raise exception 'the title of an event the feed did not add can only be changed on the site';
            end if;
            if ev.url is not null and ev.url is distinct from v_url then
              raise exception 'the link of an event the feed did not add can only be changed on the site';
            end if;
          end if;
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

      -- an item corrected in the feed after a failure records its current link, so that the event
      -- history script (supabase/content/2026-10-event-history.sql) keeps the right material
      insert into feed_applied (item_id, kind, slug, ok, note, source, url)
      values (it ->> 'id', it ->> 'kind', coalesce(it #>> '{event,slug}', it ->> 'event_slug'), true, v_note, it ->> 'source', it ->> 'url')
      on conflict (item_id) do update set applied_at = now(), ok = true, note = excluded.note,
        kind = excluded.kind, slug = excluded.slug, source = excluded.source, url = excluded.url;
      v_applied := v_applied + 1;
    exception when others then
      -- a link that failed the check is not stored, only the reason
      insert into feed_applied (item_id, kind, slug, ok, note, source, url)
      values (it ->> 'id', it ->> 'kind', coalesce(it #>> '{event,slug}', it ->> 'event_slug'), false, sqlerrm,
              case when feed_url_problem(it ->> 'source') is null then it ->> 'source' end,
              case when feed_url_problem(it ->> 'url') is null then it ->> 'url' end)
      on conflict (item_id) do update set applied_at = now(), note = excluded.note,
        kind = excluded.kind, slug = excluded.slug, source = excluded.source, url = excluded.url
        where not feed_applied.ok;
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('applied', v_applied, 'failed', v_failed);
end $$;
revoke all on function sync_feed() from public, anon;
grant execute on function sync_feed() to authenticated;

-- ---------- 3. Sign-in: no stored passwords ----------
-- The site signs people in only with email links and guest sessions. Supabase Auth still takes a
-- password at /auth/v1/signup from anyone with the public key, and no setting turns that off while
-- keeping email links. On an address with no account yet, that password stays on the new account,
-- and when the real owner later confirms it with an email link, whoever set the password can sign
-- in as them (team access for an @kleros.io address). This trigger empties the stored password on
-- every write to auth.users, so a password sign-in always fails ("Invalid login credentials").
-- Email links and guest sessions never use it. An account made in the dashboard with a password
-- signs in with an email link instead. Confirm email must still stay on (README, Setup, step 3).
create or replace function public.clear_auth_password() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.encrypted_password := '';
  return new;
end $$;
revoke all on function public.clear_auth_password() from public, anon, authenticated;

drop trigger if exists clear_auth_password on auth.users;
create trigger clear_auth_password
  before insert or update on auth.users
  for each row
  when (new.encrypted_password is not null and new.encrypted_password <> '')
  execute function public.clear_auth_password();

-- Passwords already stored: email-link accounts carry a random one Supabase made at sign-up, and an
-- address registered by someone else first may carry theirs. If auth.users cannot be written from
-- here, the trigger still clears each one at that account's next write.
do $$
begin
  update auth.users set encrypted_password = ''
   where encrypted_password is not null and encrypted_password <> '';
exception when insufficient_privilege then
  raise notice 'auth.users is not writable here; stored passwords are cleared at each account''s next write';
end $$;

-- ---------- 4. Votes: no longer readable by others or sent over realtime ----------
-- question_votes (question_id, user_id) was readable by anyone who could see the question and went
-- out over realtime, where a DELETE skips the row rules and carries both columns. A voter's id
-- could then point at who asked an anonymous question (before 26 October the app upvoted every new
-- question for its author). From here on each visitor reads only their own votes (the app needs
-- them to show its arrows as voted), and votes reach open pages through their question (section 5).
-- Counts are not stored anywhere: question_scores counts the votes on every read.
do $$
begin
  if exists (select 1 from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
              where p.pubname = 'supabase_realtime' and pr.prrelid = 'public.question_votes'::regclass) then
    alter publication supabase_realtime drop table question_votes;
  end if;
end $$;

drop policy if exists "votes are public" on question_votes;
drop policy if exists "own votes are visible" on question_votes;
create policy "own votes are visible" on question_votes for select to authenticated
  using (user_id = auth.uid());
-- visitors without a session never vote: the app signs them in as a guest first
revoke all on question_votes from anon;

-- ---------- 5. Live Q&A: limits, guest and team marks, host approval for the big screen ----------
--   * One person (one account, guest or signed in) can send at most 3 questions a minute and 20 per
--     event, and change at most 30 votes a minute. The event's hosts have no question limit.
--     created_at is always the time of sending.
--   * The database marks who sent a question: by_guest (no account) and by_team (a team account).
--     A name that matches a public Kleros team name or X handle, contains the word "Kleros", or is
--     "host", "admin" or "moderator", is refused unless a team member or one of the event's hosts
--     sends it.
--   * The big screen can show only the questions a host approved (live_state.screen_needs_approval,
--     on by default, a checkbox in the host console). Questions from the event's hosts and featured
--     questions count as approved. Questions from before this file are approved, so nothing leaves
--     a screen.
--   * A vote touches its question (votes_changed_at), so open pages learn about votes through the
--     questions of their own event.

-- ---------- columns ----------
do $$
declare
  v_add_approved boolean := not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'questions' and column_name = 'approved_at');
  v_add_guest boolean := not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'questions' and column_name = 'by_guest');
  v_add_team boolean := not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'questions' and column_name = 'by_team');
begin
  if v_add_approved then alter table questions add column approved_at timestamptz; end if;
  if v_add_guest then alter table questions add column by_guest boolean not null default false; end if;
  if v_add_team then alter table questions add column by_team boolean not null default false; end if;
  -- once, when the columns are new: older questions stay on the screen, and older questions get
  -- the marks of the account that sent them
  if v_add_approved or v_add_guest or v_add_team then
    update questions q
       set approved_at = case when v_add_approved then q.created_at else q.approved_at end,
           by_guest = case when v_add_guest
                           then coalesce((select u.is_anonymous from auth.users u where u.id = q.author_id), false)
                           else q.by_guest end,
           by_team = case when v_add_team
                          then coalesce((select p.is_team from profiles p where p.id = q.author_id), false)
                          else q.by_team end;
  end if;
end $$;

alter table questions add column if not exists votes_changed_at timestamptz;
-- readable like the other public columns, so a vote's realtime change carries a column pages can see
grant select (votes_changed_at) on questions to anon, authenticated;
alter table live_state add column if not exists screen_needs_approval boolean not null default true;

create index if not exists questions_author on questions (author_id, created_at);

-- ---------- names that must not pass as the team ----------
-- Invisible, direction and tag characters are dropped and spaces collapsed in the stored name.
create or replace function question_name_clean(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(coalesce(p, ''),
      '[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ󠀀-󠿿]',
      '', 'g'),
    '\s+', ' ', 'g')), '')
$$;

-- The words of a name, for matching: compatibility forms folded (fullwidth and mathematical
-- letters), lower case, common Cyrillic and Greek look-alikes read as Latin letters, accents
-- dropped, punctuation and spaces collapsed. "Lucía  Bocalandro." gives "lucia bocalandro".
create or replace function question_name_key(p text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
    regexp_replace(translate(lower(normalize(coalesce(question_name_clean(p), ''), NFKD)),
                             'аеорсухкіјѕԁԛԝһӏүκνορτυιαϲօ', 'aeopcyxkijsdqwhlykvoptuiaco'),
                   '[̀-ͯ]', '', 'g'),
    '[^[:alnum:]]+', ' ', 'g'))
$$;

-- Reserved: the fixed words; the word Kleros anywhere in the name ("Wei (Kleros team)", "Kleros
-- io"); a public roster name of two words or more found as whole words in the
-- name ("Dr. Federico Ast"); the same letters without spaces ("Wei Wei" and "weiwei"); or a roster
-- X handle. Only public names are used (the roster on event pages), so a refused name tells nobody
-- anything new, and a first name alone ("Federico") stays free for guests.
create or replace function question_name_reserved(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  with k as (select question_name_key(p_name) as w)
  select k.w <> '' and (
       replace(k.w, ' ', '') in ('kleros', 'klerosteam', 'theklerosteam', 'teamkleros', 'host', 'admin', 'moderator')
    or k.w ~ '(^| )(the)?kleros(team|io)?( |$)'
    or exists (select 1 from team_members tm, lateral (select question_name_key(tm.name) as r) x
                where x.r <> '' and (replace(x.r, ' ', '') = replace(k.w, ' ', '')
                                     or (x.r like '% %' and position(' ' || x.r || ' ' in ' ' || k.w || ' ') > 0)))
    or exists (select 1 from team_members tm
                where coalesce(tm.x_handle, '') <> ''
                  and replace(question_name_key(ltrim(tm.x_handle, '@')), ' ', '') = replace(k.w, ' ', '')))
  from k
$$;
revoke execute on function question_name_reserved(text) from public, anon, authenticated;

-- ---------- checks on every question sent from the site ----------
create or replace function questions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_host boolean;
  v_recent int;
  v_total int;
begin
  if tg_op = 'UPDATE' then
    -- hosts moderate questions; who sent one is not theirs to change, and an anonymous question
    -- stays anonymous
    if v_uid is not null then
      new.author_id := old.author_id;
      new.by_guest := old.by_guest;
      new.by_team := old.by_team;
      if old.anonymous then new.anonymous := true; new.author_name := null; end if;
    end if;
    return new;
  end if;

  -- marks of the account that sent it, whoever inserts the row
  new.by_guest := coalesce((select u.is_anonymous from auth.users u where u.id = new.author_id), false);
  new.by_team := coalesce((select p.is_team from profiles p where p.id = new.author_id), false);
  -- the SQL editor and the jobs (no signed-in caller) are not checked
  if v_uid is null then return new; end if;

  v_host := can_edit_event(new.event_id);
  new.created_at := now();
  new.votes_changed_at := null;
  new.author_name := question_name_clean(new.author_name);
  if new.anonymous then new.author_name := null; end if;
  if new.author_name is null then new.anonymous := true; end if;
  new.approved_at := case when v_host then now() end;

  if v_host then return new; end if;

  if new.author_name is not null and not is_team() and question_name_reserved(new.author_name) then
    raise exception 'That name is reserved on this site. Use another name, or leave it empty to ask anonymously.'
      using errcode = 'PT422';
  end if;

  -- one sender at a time, so two questions sent together cannot both slip under the limit
  perform pg_advisory_xact_lock(hashtext('kleros-questions:' || v_uid::text));
  select count(*) filter (where q.created_at > now() - interval '1 minute'),
         count(*) filter (where q.event_id = new.event_id)
    into v_recent, v_total
    from questions q
   where q.author_id = v_uid;
  if v_total >= 20 then
    raise exception 'You have sent 20 questions to this event, the most one person can send.'
      using errcode = 'PT429';
  end if;
  if v_recent >= 3 then
    raise exception 'You can send up to 3 questions a minute. Wait a moment, then send it again.'
      using errcode = 'PT429';
  end if;
  return new;
end $$;
revoke all on function questions_guard() from public, anon, authenticated;

drop trigger if exists questions_guard on questions;
create trigger questions_guard before insert or update on questions
  for each row execute function questions_guard();

-- ---------- votes: a limit per person, and each vote touches its question ----------
create table if not exists question_vote_rate (
  user_id uuid primary key,
  window_start timestamptz not null default now(),
  n int not null default 0
);
alter table question_vote_rate enable row level security;   -- no policies: nobody reads it through the API
revoke all on question_vote_rate from anon, authenticated;

-- At most 30 votes added or taken back a minute per person. Deletes that follow a deleted
-- question or account (cascades), and the SQL editor, are not counted.
create or replace function question_votes_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  insert into question_vote_rate as r (user_id, window_start, n) values (v_uid, now(), 1)
  on conflict (user_id) do update set
    n = case when r.window_start > now() - interval '1 minute' then r.n + 1 else 1 end,
    window_start = case when r.window_start > now() - interval '1 minute' then r.window_start else now() end
  returning n into v_n;
  if v_n > 30 then
    raise exception 'That is a lot of votes in a short time. Wait a minute, then try again.'
      using errcode = 'PT429';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function question_votes_limit() from public, anon, authenticated;

drop trigger if exists question_votes_limit on question_votes;
create trigger question_votes_limit before insert or delete on question_votes
  for each row execute function question_votes_limit();

-- Realtime on questions is filtered by event, so a vote now reaches only the pages of its own event.
create or replace function question_votes_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update questions set votes_changed_at = now()
   where id = case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  return null;
end $$;
revoke all on function question_votes_touch() from public, anon, authenticated;

drop trigger if exists question_votes_touch on question_votes;
create trigger question_votes_touch after insert or delete on question_votes
  for each row execute function question_votes_touch();

-- ---------- featuring a question approves it ----------
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
    update questions set featured = true, status = 'open', approved_at = coalesce(approved_at, now()) where id = p_question;
  else
    update questions set featured = false where id = p_question;
  end if;
end $$;
revoke execute on function feature_question(uuid, boolean) from public, anon;
grant execute on function feature_question(uuid, boolean) to authenticated;

-- ---------- what pages read ----------
-- New columns at the end (create or replace view cannot reorder). The where clause is the one from 0010.
--   guest      sent without an account (null for anonymous questions, which show no name)
--   approved   a host approved it
--   screen_ok  the big screen may show it: approved, featured, or the event does not ask for approval
--   team       sent from a Kleros team account (null for anonymous questions)
create or replace view question_scores with (security_invoker = false) as
  select q.id, q.event_id, q.body, q.anonymous,
         case when q.anonymous then null else q.author_id end as author_id,
         q.author_name, q.status, q.featured, q.created_at,
         coalesce(v.votes, 0) as votes,
         coalesce(q.author_id = auth.uid(), false) as mine,
         case when q.anonymous then null else q.by_guest end as guest,
         q.approved_at is not null as approved,
         (q.approved_at is not null or q.featured
           or not coalesce((select ls.screen_needs_approval from live_state ls where ls.event_id = q.event_id), true)) as screen_ok,
         case when q.anonymous then null else q.by_team end as team
    from questions q
    left join (select question_id, count(*)::int as votes from question_votes group by question_id) v
      on v.question_id = q.id
   where case when event_is_private(q.event_id) then is_event_member(q.event_id)
              else q.status <> 'hidden' or is_team() end;
grant select on question_scores to anon, authenticated;

-- ---------- 6. Votes: old self-votes removed ----------
-- A question without a name is anonymous. The first version of the app saved a signed-in question
-- with an empty display name as anonymous = false and no name: pages showed "Anonymous", but
-- question_scores returned its author_id.
update questions set anonymous = true, author_name = null
 where not anonymous and coalesce(btrim(author_name), '') = '';

-- Before 26 October (commit 4bd8ec7) the app upvoted every new question for its author. Votes have
-- no timestamp, so those cannot be told apart from later clicks: every vote an author cast on their
-- own question from before this fix goes. Votes are private from section 4 on, so self-votes on
-- newer questions reveal nothing and stay, also when this file is run again.
delete from question_votes v using questions q
 where q.id = v.question_id and v.user_id = q.author_id
   and q.created_at < timestamptz '2026-10-29 00:00+00';

-- ---------- 7. Uploaded files: a private bucket, served by the site at /f/<path> ----------
-- Needs the site version with src/app/f/[...path]/route.ts live on every host first (Vercel, and
-- Netlify once it serves the site): until then pages link to the public addresses this switches off.
--
-- The materials bucket stops being public, so /storage/v1/object/public/materials/... addresses
-- stop working, including links copied before. The site serves each file at /f/<path>: it asks
-- storage for a signed address with the visitor's own session, and storage signs only files the
-- select policy on storage.objects lets that visitor see ("materials files are public", 0012).
-- Pages still rewrite an old public address stored in an item, a cover or a roster photo to /f/.

-- Stored file paths are plain bucket paths: no "%", "\", "?", "#" or control characters, and no
-- empty, "." or ".." parts (spaces around them count as nothing). The site puts them into storage addresses as they are, where an encoded
-- ".." would point at another Supabase endpoint. Paths already on an item are left alone.
create or replace function material_path_ok(p text) returns boolean
language sql immutable as $$
  select p is null or p ~ '^https?://'
      or (p !~ '[%\\?#[:cntrl:]]' and length(p) <= 1024
          and not exists (select 1 from unnest(string_to_array(p, '/')) s where btrim(s) in ('', '.', '..')))
$$;

create or replace function material_paths_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  foreach p in array array[new.file_path, new.pdf_path, new.audio_path] loop
    continue when tg_op = 'UPDATE' and p in (old.file_path, old.pdf_path, old.audio_path);
    if not material_path_ok(p) then
      raise exception 'This file path is not a valid storage path.' using errcode = '22023';
    end if;
  end loop;
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

revoke all on function material_paths_check() from public, anon, authenticated;

update storage.buckets set public = false where id = 'materials' and public;

-- A file that no item uses (an upload whose item is not saved yet, or a file left behind when
-- deleting it from storage failed) is for the people who may upload into its folder: the team for
-- standalone/ and public events, the members for a private event, nobody for the folder of an
-- event that no longer exists. Before, such a file in any public event's folder, draft or
-- published, was visible to everyone. Files that items use follow those items, as before (0010).
create or replace function storage_file_visible(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when storage_file_used(p_name) then storage_file_in_use(p_name, false)
    else storage_file_editable(p_name)
  end
$$;

-- Files that no item uses, for an occasional clean-up (delete them in Storage, bucket materials;
-- the dashboard deletes through the Storage API, which also removes the stored bytes):
--   select o.name, o.created_at, o.metadata ->> 'size' as bytes from storage.objects o
--    where o.bucket_id = 'materials' and not storage_file_used(o.name)
--      and o.created_at < now() - interval '1 day' order by o.created_at;

-- ---------- report ----------
-- What the SQL editor shows after the run. Every line has the value it should have in brackets.
select t.check, t.result from (values
  (1, 'materials bucket is public (false)',
      (select public::text from storage.buckets where id = 'materials')),
  (2, 'votes sent over realtime (false)',
      (select (count(*) > 0)::text from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'question_votes')),
  (3, 'visitors without a session can read votes (false)',
      has_table_privilege('anon', 'public.question_votes', 'select')::text),
  (4, 'self-votes left on questions from before 29 October (0)',
      (select count(*)::text from question_votes v join questions q on q.id = v.question_id
        where v.user_id = q.author_id and q.created_at < timestamptz '2026-10-29 00:00+00')),
  (5, 'stored passwords (0)',
      (select count(*)::text from auth.users where coalesce(encrypted_password, '') <> '')),
  (6, 'old public file addresses still in the data (0, or fix them by hand)',
      (select count(*)::text from (
         select cover_path a from events union all select url from events
         union all select description from events union all select recap from events
         union all select url from materials union all select file_path from materials
         union all select pdf_path from materials union all select audio_path from materials
         union all select avatar_url from team_members) x
        where a like '%/storage/v1/object/public/materials/%')),
  (7, 'realtime leaves out columns a visitor cannot read (true)',
      (select coalesce(bool_or(position('has_column_privilege' in p.prosrc) > 0), false)::text
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'realtime' and p.proname = 'apply_rls')),
  (8, 'socials feed can be read (true)',
      (feed_get() is not null)::text)
) t(n, "check", result)
order by t.n;
