-- Real Kleros events (Oct–Nov 2026), from Luma, Wei Wei's X posts and the Drive talk folder.
-- Replaces the example rows from seed.sql.
delete from events where is_example;

-- Anonymous guests (QR "ask a question") have no email, so is_team must not be null.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, is_team)
  values (new.id, split_part(new.email, '@', 1), coalesce(lower(new.email) like '%@kleros.io', false));
  return new;
end $$;

insert into events (slug, title, kleros_role, organizer, event_type, starts_on, ends_on, start_time, timezone, city, country, region, venue, url, cover_path, description, topics, recap, status) values
('token2049-singapore-2026', 'TOKEN2049 Singapore', 'attending', 'TOKEN2049', 'Conference', '2026-10-07', '2026-10-08', null, 'GMT+8', 'Singapore', 'Singapore', 'Asia', null, 'https://www.asia.token2049.com', null,
 'The Kleros team spent TOKEN2049 week in Singapore talking agents, payment rails and trust, including at Banking the Agent Economy.', '{AI agents,Prediction markets,DeFi}', null, 'published'),
('agentic-finance-summit-the-odds', 'Agentic Finance Summit + The Odds: Prediction Markets Live', 'speaking', 'more&more', 'Side event', '2026-10-08', null, null, 'GMT+8', 'Singapore', 'Singapore', 'Asia', null, null, null,
 'A TOKEN2049 side event on agentic finance and prediction markets. Clément Lesaege spoke on the rise of the autonomous trader: what happens when agents start trading on their own.', '{AI agents,Prediction markets}', null, 'published'),
('proof-of-humanity-irl', 'Proof of Humanity: IRL', 'host', 'Kleros', 'Meetup', '2026-10-13', null, '18:00', 'GMT+7', 'Chiang Mai', 'Thailand', 'Asia', '4Seas Nimman Coliving Coworking Space', 'https://luma.com/6z1ed50q', 'https://images.lumacdn.com/uploads/95/df0b0261-1e3f-4d82-958a-70940415b913.jpg',
 'An introduction to Proof of Humanity, the registry that establishes each profile belongs to a unique human. As the internet fills with bots, fake accounts and AI-generated identities, proving you are a real person matters more every month.', '{Identity,Community,AI agents}',
 'Good food, good conversations and new connections at 4Seas. Clément Lesaege closed the night with a talk on the Singularity: AI has passed humans on intelligence, is drawing level on taste, and trails on agency.', 'published'),
('the-future-is-tradable', 'The Future Is Tradable', 'host', 'Kleros & Seer', 'Meetup', '2026-10-15', null, '18:00', 'GMT+7', 'Chiang Mai', 'Thailand', 'Asia', '4Seas Nimman Coliving Coworking Space', 'https://luma.com/v5nn24mq', 'https://images.lumacdn.com/uploads/14/79c65f99-1db3-4d98-97db-37c055b11ba5.jpg',
 'Prediction markets, AI, and the business of knowing what happens next. An interactive evening with Kleros and Seer on where prediction markets are heading, and what happens when markets become a source of information for humans, applications and AI agents.', '{Prediction markets,AI agents,Oracles}',
 'Six talks, from market probabilities to AI agents that trade for you. All six are below with their slides and subtitles.', 'published'),
('ai-that-acts', 'AI That Acts: Inside the Agentic Economy', 'host', 'Kleros', 'Meetup', '2026-10-22', null, '18:00', 'GMT+7', 'Chiang Mai', 'Thailand', 'Asia', '4Seas Nimman Coliving Coworking Space', 'https://luma.com/clrlo1dj', 'https://images.lumacdn.com/uploads/t1/4b9a6f5b-266e-4e32-8b84-af2429b21413.jpg',
 'AI agents are moving beyond chat: making decisions, transacting, negotiating and acting on people''s behalf. As agents become economic actors they need ways to identify and trust each other, transact, build reputation, and resolve disputes when things go wrong. This is where AI and Web3 meet.', '{AI agents,Arbitration}',
 'Two talks on what happens when AI stops assisting and starts acting. Fortunato Cinquepalmi on how agents act (once an agent pays, hires and decides for you, it needs an ID, a record and a court), with a live demo of a scooter shop agent billing for scratches already in its own photos. Clément Lesaege on why the Singularity is near.', 'published'),
('devcon-8-mumbai', 'Devcon 8', 'booth', 'Ethereum Foundation', 'Conference', '2026-11-03', '2026-11-06', null, 'GMT+5:30', 'Mumbai', 'India', 'Asia', 'Jio World Centre', 'https://devcon.org', null,
 'Kleros is a Devcon 8 Supporter, with a booth, contributing across the Legal & Governance, Agentic and Prediction Markets hubs. Building around oracles, prediction markets, registries, decentralized justice or the agentic economy? The team is there to talk.', '{Arbitration,AI agents,Prediction markets,Governance}', null, 'published'),
('onchain-legal-summit-devcon-india', 'Onchain Legal Summit :: Devcon India 2026', 'co_host', 'Entity', 'Side event', '2026-11-04', null, '09:00', 'GMT+5:30', 'Mumbai', 'India', 'Asia', 'Jio World Convention Centre', 'https://luma.com/cw0h549b', 'https://images.lumacdn.com/uploads/hd/ce6ed4b8-bd25-40a7-aa3c-1a2a69b85de7.png',
 'The third Entity Legal Summit, after Devconnect Buenos Aires (2025) and Consensus HK (2026). One room, one question: what is an onchain entity, legally, and who answers for the AI agents inside it? A working summit for founders, lawyers, protocol designers and governance architects: law as code, agent personhood and ERC-8004, decentralized justice and AI arbitration, borderless entities and liability.', '{Legal tech,AI agents,Arbitration,Governance}', null, 'published'),
('ground-truth-mumbai', 'Ground Truth: Queryable Data, Prediction Markets & Decentralised Justice on Ethereum', 'host', 'Kleros, Arkiv Network & Web3 Mumbai', 'Side event', '2026-11-04', null, '18:00', 'GMT+5:30', 'Mumbai', 'India', 'Asia', 'Hitchki', 'https://luma.com/qewnqhas', 'https://images.lumacdn.com/uploads/on/14282126-3d51-493c-97ca-65fa976922c2.png',
 'An evening during Devcon week on queryable onchain data, prediction markets and decentralized justice on Ethereum.', '{Prediction markets,Oracles,Arbitration}', null, 'draft');

-- materials: (slug, kind, title, speaker, url, ordinal)
insert into materials (event_id, kind, title, speaker, url, created_at)
select e.id, m.kind::material_kind, m.title, m.speaker, m.url, now() + (m.n || ' seconds')::interval
from (values
  ('token2049-singapore-2026', 'social', 'Kleros at TOKEN2049', null, 'https://x.com/weiwei_ooi/status/2107743924278431880', 1),
  ('agentic-finance-summit-the-odds', 'social', 'The rise of the autonomous trader (clip)', 'Clément Lesaege', 'https://x.com/weiwei_ooi/status/2108248176818061648', 1),
  ('proof-of-humanity-irl', 'social', 'The Singularity (talk clip)', 'Clément Lesaege', 'https://x.com/weiwei_ooi/status/2110023524316565898', 1),
  ('proof-of-humanity-irl', 'social', 'Photos from the night', null, 'https://x.com/weiwei_ooi/status/2110365309341450500', 2),
  ('the-future-is-tradable', 'video', 'From Event Markets to Information Finance', 'Clément Lesaege', 'https://drive.google.com/file/d/1Bi9b5GEKSBpXkEq54PBUg7sixv-gLnyx/view', 1),
  ('the-future-is-tradable', 'video', 'Paid to Be Right', 'Clément Lesaege', 'https://drive.google.com/file/d/1ecgApbLyt9GipB5e6xbJZsnv_O0wXq4c/view', 2),
  ('the-future-is-tradable', 'video', 'Prediction Market Basics', 'Devansh Mehta', 'https://drive.google.com/file/d/1IxuRuXhdDNBCFa5UaD18WShmTF8o-KUL/view', 3),
  ('the-future-is-tradable', 'video', 'Creating an AI Skill to Trade on Seer', 'Mohammad', 'https://drive.google.com/file/d/1EdQemipgq7zFbxxqULIj-8EdvtSbw73v/view', 4),
  ('the-future-is-tradable', 'video', 'Who Decides What Happened', 'Juan Ramiro Garza', 'https://drive.google.com/file/d/1a-7gwOxX7mb40oMgEb-Ldv28EQoI8J2T/view', 5),
  ('the-future-is-tradable', 'video', 'Buying Answers, Not Probabilities', 'distbit', 'https://drive.google.com/file/d/18st1ejZ2LSjYyENeaIIwSStAOeOs5BCt/view', 6),
  ('the-future-is-tradable', 'link', 'All six talks with slides and subtitles (Drive)', null, 'https://drive.google.com/drive/folders/1snsDFSSPgbNgUlNBiA68hQyu5h9zPLco', 7),
  ('the-future-is-tradable', 'social', 'Recap thread on X', null, 'https://x.com/weiwei_ooi/status/2112050092492693597', 8),
  ('ai-that-acts', 'slides', 'How AI Agents Act', 'Fortunato Cinquepalmi', 'https://claude.ai/artifact/ATGBH5TtN2JgrYZyw36itP', 1),
  ('ai-that-acts', 'slides', 'The Singularity Is Near', 'Clément Lesaege', 'https://claude.ai/artifact/LcU3vBwy8gjpaa6EhQnzyb', 2),
  ('ai-that-acts', 'link', 'Kleros AI: Trust at Machine Speed', null, 'https://ai.kleros.io', 3),
  ('ai-that-acts', 'social', 'Recap thread on X', null, 'https://x.com/weiwei_ooi/status/2113566568412238163', 4),
  ('ai-that-acts', 'social', 'Highlights video', null, 'https://x.com/weiwei_ooi/status/2113566563307868499', 5),
  ('devcon-8-mumbai', 'social', 'Kleros at Devcon 8', null, 'https://x.com/weiwei_ooi/status/2105674182193553749', 1)
) as m(slug, kind, title, speaker, url, n)
join events e on e.slug = m.slug;

select slug, status, (select count(*) from materials m where m.event_id = events.id) as materials from events order by starts_on;
