-- Keep events in step with Luma, from inside the database (no API keys involved).
--
-- sync_luma() reads Luma's public event data with the http extension:
--   * every event whose url is a Luma link is refreshed. When Kleros | Events is a Luma host, the title,
--     cover image, date, start time, time zone and venue follow Luma; for other organisers' events only
--     the cover image does. Descriptions, recaps, roles and materials always stay as written;
--   * new public events hosted by the Kleros | Events account (directly or with Wei Wei) are added
--     as published events, with the Luma description as a first draft of the text.
-- pg_cron runs it every hour; team members can also run it from /admin ("Sync from Luma now").
-- Each run is logged in luma_sync_log. Safe to run more than once.

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create table if not exists luma_sync_log (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  checked int not null default 0,
  updated int not null default 0,
  added int not null default 0,
  errors text[] not null default '{}',
  ran_by uuid
);
alter table luma_sync_log enable row level security;
drop policy if exists "team reads the sync log" on luma_sync_log;
create policy "team reads the sync log" on luma_sync_log for select using (is_team());
grant select on luma_sync_log to authenticated;

-- The Luma slug of an event url (luma.com/abc123, lu.ma/abc123), or null.
create or replace function luma_slug(p_url text) returns text
language sql immutable as $$
  select (regexp_match(p_url, '^https?://(?:www\.)?(?:luma\.com|lu\.ma)/([A-Za-z0-9_-]+)/?(?:\?.*)?$'))[1]
$$;

create or replace function luma_get(p_path text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r extensions.http_response;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  r := extensions.http_get('https://api2.luma.com' || p_path);
  if r.status <> 200 then return null; end if;
  return r.content::jsonb;
exception when others then
  return null;
end $$;

-- "GMT+5:30" style label for a time zone at a moment.
create or replace function gmt_label(p_at timestamptz, p_tz text) returns text
language sql stable as $$
  with o as (select (p_at at time zone p_tz) - (p_at at time zone 'UTC') as off)
  select 'GMT' || case when off < interval '0' then '-' else '+' end
         || extract(hour from abs_off)::int
         || case when extract(minute from abs_off) <> 0 then ':' || lpad(extract(minute from abs_off)::int::text, 2, '0') else '' end
  from (select off, case when off < interval '0' then -off else off end as abs_off from o) x
$$;

-- Plain text from Luma's ProseMirror description.
create or replace function luma_text(p_doc jsonb) returns text
language sql immutable as $$
  select nullif(trim(string_agg(para, E'\n\n')), '')
  from (
    select (select string_agg(t #>> '{}', '') from jsonb_path_query(block, 'strict $.**.text') t) as para
    from jsonb_array_elements(coalesce(p_doc -> 'content', '[]'::jsonb)) block
  ) p
  where para is not null and para <> ''
$$;

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
begin
  if auth.uid() is not null and not is_team() then
    raise exception 'Only the Kleros team can sync from Luma';
  end if;

  -- 1. events already on the site that point at Luma
  select coalesce(array_agg(distinct luma_slug(url)), '{}') into v_slugs
    from events where luma_slug(url) is not null;

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

  foreach v_slug in array (select coalesce(array_agg(distinct s), '{}') from unnest(v_slugs) s where s is not null) loop
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

-- Accents out of slugs without needing the unaccent extension.
create or replace function unaccent_safe(p text) returns text
language sql immutable as $$
  select translate(coalesce(p, ''),
    'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
    'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')
$$;

revoke all on function sync_luma() from public, anon;
grant execute on function sync_luma() to authenticated;
revoke all on function luma_get(text) from public, anon, authenticated;

-- every hour, at minute 7
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'sync-luma';
  perform cron.schedule('sync-luma', '7 * * * *', 'select public.sync_luma()');
end $$;
