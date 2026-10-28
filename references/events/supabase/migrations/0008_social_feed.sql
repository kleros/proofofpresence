-- Updates found on socials and in team channels reach the site through a feed file in the repo.
--
-- A daily Claude check reads the Kleros X and LinkedIn posts, YouTube uploads, Luma and the team's
-- Slack channels, and appends what it finds to public/updates/feed.json (format in
-- docs/social-feed.md). Vercel publishes that file with the site, and sync_feed() reads it from
-- there with the http extension, so no keys or tokens are involved anywhere.
--
-- Each feed item is applied once, by its id, and recorded in feed_applied. A later edit made by
-- the team on the site therefore stays: the feed never re-applies an item it has already applied.
-- An item that failed (say, its event was not on the site yet) is tried again on the next run.
--   * "event" items add a new published event, or fill in fields of an existing one (by slug);
--   * "material" items add a recording, slides, photo album or post link to an event, or link an
--     existing material (same url) to one more event.
-- pg_cron runs it every hour at minute 17; the admin "Sync now" button runs it too.

create table if not exists feed_applied (
  item_id text primary key,
  applied_at timestamptz not null default now(),
  kind text,
  slug text,
  ok boolean not null,
  note text,
  source text
);
alter table feed_applied enable row level security;
drop policy if exists "team reads applied feed items" on feed_applied;
create policy "team reads applied feed items" on feed_applied for select using (is_team());
grant select on feed_applied to authenticated;

create or replace function feed_get() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r extensions.http_response;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  r := extensions.http_get('https://kleros-events.vercel.app/updates/feed.json?t=' || extract(epoch from now())::bigint);
  if r.status <> 200 then return null; end if;
  return r.content::jsonb;
exception when others then
  return null;
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
        select id into v_id from events where slug = it ->> 'event_slug';
        if v_id is null then raise exception 'no event with slug %', it ->> 'event_slug'; end if;
        if nullif(it ->> 'url', '') is null or nullif(it ->> 'title', '') is null then
          raise exception 'material needs url and title';
        end if;
        select id into v_mid from materials where url = it ->> 'url' limit 1;
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

      insert into feed_applied (item_id, kind, slug, ok, note, source)
      values (it ->> 'id', it ->> 'kind', coalesce(it #>> '{event,slug}', it ->> 'event_slug'), true, v_note, it ->> 'source')
      on conflict (item_id) do update set applied_at = now(), ok = true, note = excluded.note;
      v_applied := v_applied + 1;
    exception when others then
      insert into feed_applied (item_id, kind, slug, ok, note, source)
      values (it ->> 'id', it ->> 'kind', coalesce(it #>> '{event,slug}', it ->> 'event_slug'), false, sqlerrm, it ->> 'source')
      on conflict (item_id) do update set applied_at = now(), note = excluded.note;
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('applied', v_applied, 'failed', v_failed);
end $$;

revoke all on function sync_feed() from public, anon;
grant execute on function sync_feed() to authenticated;
revoke all on function feed_get() from public, anon, authenticated;

-- every hour, at minute 17
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'sync-feed';
  perform cron.schedule('sync-feed', '17 * * * *', 'select public.sync_feed()');
end $$;
