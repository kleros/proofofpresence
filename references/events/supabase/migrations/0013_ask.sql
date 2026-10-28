-- The site assistant (/api/ask). Safe to run more than once.
--
--   * ask_take is needed, with SUPABASE_SERVICE_ROLE_KEY, before anyone outside the team can ask;
--     without it only the team can. 0014_security.sql creates the same counter, so running 0014
--     is enough for that. This file adds the transcript search on top.
--
--   * ask_take: question counts kept in the database, so the per-visitor and daily limits hold
--     across every server instance. Only the server calls it, with SUPABASE_SERVICE_ROLE_KEY; the
--     public key cannot read the counts or call the function.
--   * ask_search_transcripts: the assistant's transcript search returns only the matching lines
--     instead of downloading whole transcripts. It runs with the caller's own access, so private
--     and draft recordings stay hidden exactly as on the site.

-- ---------- question counts ----------
create table if not exists ask_usage (
  key text not null,          -- a hashed visitor address, a user id, 'all' for the daily total, or 'check' (the app checking that this works)
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

-- ---------- transcript search ----------
-- Transcripts that contain the terms (2 to 40 characters, no wildcards; the server cleans them
-- further), best first: a term found in few transcripts counts more than one found in most. For
-- each, six lines in time order: the first line for every term, then the lines with the most
-- terms. Any transcript with text is searched, whatever the state of its summary. Runs as the
-- caller, so the transcripts policy (material_visible) decides what is searched.
create or replace function ask_search_transcripts(p_terms text[])
returns table (material_id uuid, tldr text, score int, lines jsonb)
language sql stable security invoker set search_path = public as $$
  with t as (
    select array_agg(lower(x)) as terms
    from unnest(p_terms[1:6]) x where length(x) between 2 and 40 and x !~ '[%_]' and strpos(x, chr(92)) = 0
  ),
  low as (   -- each transcript's text lowered once (offset 0 keeps it from being redone per term)
    select tr.material_id, lower(tr.text) as l from transcripts tr where tr.text is not null offset 0
  ),
  th as (    -- one row per transcript and term it contains
    select low.material_id, x from low cross join t cross join lateral unnest(t.terms) x
    where t.terms is not null and strpos(low.l, x) > 0
  ),
  w as (     -- a term found in few transcripts counts more than one found in most of them
    select d.material_id, sum(1.0 / d.n) as wt
    from (select th.material_id, count(*) over (partition by th.x) as n from th) d
    group by d.material_id
  ),
  top as (   -- the best 12 and any tied with the 12th (at most 24), so the line count breaks ties
    select x.* from (select w.* from w order by round(1000 * w.wt) desc fetch first 12 rows with ties) x
    order by x.wt desc limit 24
  ),
  hit as (
    select tr.material_id, tr.summary->>'tldr' as tldr, tr.segments, top.wt
    from transcripts tr join top on top.material_id = tr.material_id
  ),
  m as (     -- one row per line and term it contains, numbered per term in time order
    select h.material_id, s.ord, s.v, x,
      row_number() over (partition by h.material_id, x order by s.ord) as nth
    from hit h cross join t
    cross join lateral jsonb_array_elements(h.segments) with ordinality s(v, ord)
    cross join lateral unnest(t.terms) x
    where jsonb_typeof(h.segments) = 'array' and strpos(lower(s.v->>'text'), x) > 0
  ),
  seg as (
    select m.material_id, m.ord, min(m.v::text)::jsonb as v, count(*)::int as sc, bool_or(m.nth = 1) as first_of_term,
      count(*) over (partition by m.material_id) as nlines
    from m group by m.material_id, m.ord
  ),
  best as (  -- the first line for each term, then the lines with the most terms, then the earliest
    select seg.*, row_number() over (partition by seg.material_id order by seg.first_of_term desc, seg.sc desc, seg.ord) as rn
    from seg
  )
  select b.material_id, max(h.tldr), round(1000 * max(h.wt))::int,
    jsonb_agg(jsonb_build_object('start', b.v->'start', 'text', b.v->'text') order by b.ord)
  from best b join hit h on h.material_id = b.material_id
  where b.rn <= 6
  group by b.material_id
  order by 3 desc, max(b.nlines) desc
  limit 8
$$;
grant execute on function ask_search_transcripts(text[]) to anon, authenticated;
