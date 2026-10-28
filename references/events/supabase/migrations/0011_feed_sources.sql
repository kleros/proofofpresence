-- The feed file is served by every deployment of the site (Vercel now, Netlify too once Kleros
-- hosts it there). Read it from events.kleros.io first, and fall back to the Vercel address, so
-- the hourly sync keeps working whichever host the domain points at.

create or replace function feed_get() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r extensions.http_response;
  v_url text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  foreach v_url in array array['https://events.kleros.io', 'https://kleros-events.vercel.app'] loop
    begin
      r := extensions.http_get(v_url || '/updates/feed.json?t=' || extract(epoch from now())::bigint);
      if r.status = 200 and (r.content::jsonb) ? 'items' then
        return r.content::jsonb;
      end if;
    exception when others then
      null;  -- not reachable or not JSON: try the next address
    end;
  end loop;
  return null;
end $$;

revoke all on function feed_get() from public, anon, authenticated;
