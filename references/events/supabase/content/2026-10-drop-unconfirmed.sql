-- Drop the 22 events that still needed verification (Wei Wei, 26 Oct 2026: only confirmed events are posted).
-- Their URL-only materials go with them. Uploaded files, recordings and anything with a transcript are kept:
-- they stay in the team library (/admin/recordings) or on another linked event.
begin;
create temp table _drop on commit drop as
  select id from events where slug in ('open-source-ai-hackathon-dobby-2025', 'orchestration-lounge-ethdenver-2025', 'upf-phd-examination-zhuk-2025', 'ethsf-2025', 'freelancing-without-fear-lisbon-2025', 'it-rock-partners-friends-2025', 'unctad-consumer-protection-2025', 'legal-week-latam-2025', 'oxford-crypto-defi-private-governance-2025', 'schelling-point-buenos-aires-2025', 'uniswap-cup-buenos-aires-2025', 'flows-orchestration-lounge-devconnect-2025', 'del-hate-al-like-webinar-2026', 'ymax-happy-hour-new-york-2026', 'arbitrum-founders-eve-berlin-2026', 'arbitrum-open-house-london-2026', 'pick-our-party-devcon-2026', 'founder-house-singapore-2026', 'arbiverse-mumbai-2026', 'icp-paris-ai-law-hackathon-2026', 'enm-cycle-approfondi-numerique-2025', 'dappcon-berlin-2025');
delete from materials m
 where m.file_path is null and m.pdf_path is null and m.audio_path is null
   and exists (select 1 from material_events me where me.material_id = m.id and me.event_id in (select id from _drop))
   and not exists (select 1 from material_events me where me.material_id = m.id and me.event_id not in (select id from _drop))
   and not exists (select 1 from transcripts t where t.material_id = m.id);
delete from events where id in (select id from _drop);
commit;
select status, count(*) from events group by status;
select count(*) as materials, count(*) filter (where event_id is null) as standalone from materials;
