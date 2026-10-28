-- Example content so a fresh install doesn't look empty. Every row is marked
-- is_example = true and titled "Example: …"; delete them once real events exist:
--   delete from events where is_example;

insert into events (slug, title, kleros_role, organizer, event_type, starts_on, ends_on, start_time, timezone, city, country, region, venue, url, description, topics, status, is_example) values
  ('example-court-day', 'Example: Kleros Court Day', 'host', 'Kleros', 'Juror training', current_date + 25, null, '14:00', 'WET', 'Lisbon', 'Portugal', 'Europe', 'Sample venue', 'https://kleros.io',
   'A half-day session on how jurors are drawn, how staking works and how appeals play out, followed by drinks with the team.', '{Jurors,Arbitration,Community}', 'published', true),
  ('example-ai-agents-space', 'Example: Who judges AI agents? (X Space)', 'host', 'Kleros', 'Online talk / Space', current_date + 12, null, '16:00', 'UTC', null, null, 'Online', 'X Spaces', 'https://x.com/kleros_io',
   'When autonomous agents transact, who resolves their disputes? A live conversation with audience questions.', '{AI agents,Arbitration,Research}', 'published', true),
  ('example-hackathon-bounty', 'Example: Hackathon with a Kleros bounty', 'judging', 'Partner hackathon', 'Hackathon', current_date + 40, current_date + 42, null, null, 'Bangkok', 'Thailand', 'Asia', null, null,
   'Kleros offers a bounty for the best build using Kleros arbitration and runs a mentoring table all weekend.', '{Smart contracts,Oracles,DeFi}', 'published', true),
  ('example-legal-tech-panel', 'Example: Legal tech conference panel', 'speaking', 'Conference organizer', 'Panel', current_date + 70, current_date + 71, null, null, 'New York', 'USA', 'North America', null, null,
   'Decentralized arbitration next to traditional ADR: where each one fits.', '{Legal tech,Arbitration,Governance}', 'published', true),
  ('example-prediction-markets-night', 'Example: Prediction markets night', 'co_host', 'Kleros and a partner', 'Side event', current_date - 10, null, '18:00', 'GMT+7', 'Chiang Mai', 'Thailand', 'Asia', null, null,
   'An evening on prediction markets as an information layer, with live markets and two short talks.', '{Prediction markets,Oracles,AI agents}', 'published', true),
  ('example-integration-workshop', 'Example: Integrating Kleros workshop', 'speaking', 'University blockchain club', 'Workshop', current_date - 60, null, null, null, 'Buenos Aires', 'Argentina', 'Latin America', null, null,
   'Wiring an arbitrable contract to Kleros Court, step by step.', '{Smart contracts,Oracles}', 'published', true);

insert into agenda_items (event_id, starts_at, title, speaker, is_kleros)
select e.id, a.t, a.title, a.speaker, a.k from events e, (values
  ('14:00'::time, 'Arrival and coffee', null, false),
  ('14:30'::time, 'How jurors are drawn', 'Kleros team', true),
  ('15:15'::time, 'Staking and appeals walkthrough', 'Kleros team', true),
  ('16:00'::time, 'Q&A and drinks', null, false)) as a(t, title, speaker, k)
where e.slug = 'example-court-day';

insert into materials (event_id, kind, title, url)
select id, 'link'::material_kind, 'Example: Kleros blog', 'https://blog.kleros.io' from events where slug = 'example-prediction-markets-night'
union all
select id, 'doc'::material_kind, 'Example: Kleros developer docs', 'https://docs.kleros.io' from events where slug = 'example-integration-workshop';
