# Kleros Events

The public record of every event Kleros hosts or takes part in (conferences, side events, hackathons, meetups, Spaces), with the talks, slides and recordings to match. It doubles as promotion for Kleros: every page points visitors to the products, socials and the team.

## What's in it

**For visitors**
- **Events** by Kleros' role: hosted, co-hosted, speaking, sponsoring, booth, judging, attending. Filter by upcoming/past/month, type, topic and search.
- **Event pages** list the Kleros team who'll be there, the agenda, talks and materials, and an "Ask the speaker" Q&A with upvotes. A "Meet Kleros" box lets visitors request a meeting or book a team member's calendar, and product promos are picked from the event's topics.
- **Talk player:** the PDF deck is synced to the audio recording. Each slide change is timestamped, the timeline is split by slide, clicking a slide jumps the audio, and there are notes per slide.
- **My events** (magic-link sign-in): saved, going and attended events, private notes, recommendations from topics, region and role, "Talks you missed", and "Continue watching".
- Calendar file for every event (`/events/<slug>/calendar.ics`) and a projector view for live Q&A (`/events/<slug>/live`).
- **Ask** (the ✦ button on every page once it is set up): questions about events, talks and recordings, answered by Claude from the site's own data with links to the pages and to the moment in a recording (`/talks/<id>?t=<seconds>`). It reads with the visitor's own access, so private and draft events never reach an answer for someone who cannot see them. See "Site assistant" below.

**For the Kleros team** (`/admin`, for accounts with team access, see "Team access" below)
- Events desk: Upcoming, Past and Drafts tabs, each row with **Run live** (the host console at `/events/<slug>/host`), **Edit** and **View**. Past events with no materials are flagged "Needs materials". A Meeting requests tab holds the "Meet Kleros" inbox.
- Event editor (`/admin/events/<id>`): Details, Agenda, Kleros team and Materials sections under a header with **Run live** and **View public page**.
- **Access** (`/admin/access`, master admin only): who has team access, give access by email, remove or block.
- **Add a talk:** upload the PDF, then either present and record live in the browser (slide changes are stamped automatically) or upload an existing recording and tap Next as it plays back. Check the timing, add notes per slide, and save.
- Team roster with X handles and booking links.

## Stack

Next.js 15 (App Router) · Supabase (Postgres, auth, storage, realtime) · pdf.js · deploys to Vercel or Netlify.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Run the schema:** in the SQL editor, run the files in `supabase/migrations/` in order. Optionally run `supabase/seed.sql` for example events; they are marked "Example" and can be removed with `delete from events where is_example;`.
3. **Auth:** under Authentication → URL configuration, set the Site URL to your deployed URL, and add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback` as redirect URLs. Email magic links work out of the box. Under Authentication → Sign In / Providers, keep these on:
   - **Confirm email** must stay on. Team access, the master admin and private-event collaborators all rely on a confirmed email. With it off, Supabase marks each new email as confirmed as soon as the account is created, before anyone opens a link, so anyone could sign up with an `@kleros.io` address and get team access. The site only sends email links, but Supabase also takes password sign-ups from anyone with the public key, and no setting turns those off while keeping email links. Migration `0014_security.sql` empties every stored password, so a password that someone else set on an address before its owner signed in never works, and accounts made in the dashboard with a password sign in with an email link instead. Hosted projects have Confirm email on by default; `supabase/config.toml` turns it on for local copies, where the default is off.
   - **Allow new users to sign up**: the sign-in form creates an account the first time someone uses it.
   - **Allow anonymous sign-ins**: QR guests use it to ask and upvote.
   - Every other sign-in provider (phone, Google and the other OAuth providers, SSO) stays off. Team access trusts any address Supabase marks as confirmed, so check how a new provider confirms addresses before turning it on.
   - `supabase/checks/accounts.sql` (read-only) lists the accounts with team or admin rights, accounts that never confirmed their email, and any session that started with a password.
4. **Env:** copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL`.
5. **Run:** `npm install && npm run dev`, then open http://localhost:3000.
6. **Team access** (needs `0003_access.sql`):
   - Anyone signing in with an `@kleros.io` email gets team access automatically, once the email is confirmed (this is why Confirm email must stay on, see step 3).
   - `weiwei@kleros.io` is the master admin (`profiles.is_admin`). Only the master admin can open `/admin/access`, add people by email (stored in `team_access`), remove them, or block an address. A block removes access even for an `@kleros.io` email, but never for the master admin. Changes apply at once to existing accounts and on first sign-in for new ones.
   - Nobody can change their own `is_team` or `is_admin`, and `is_admin` can only be changed from the SQL editor, for example `update profiles set is_admin = true where id = (select id from auth.users where email = 'them@kleros.io');`
   - Anonymous guests (QR questions) never get team access.

## At the venue: event mode

Open an event while signed in with a Kleros account and press **Event mode** (or go to `/events/<slug>/live`). Put that tab on the projector.

- The screen shows the event title, the questions a host approved (or every open question when approval is off for the event, see below), and a QR code to `/q/<slug>`. Guests scan it and ask or upvote from their phone with no account (Supabase anonymous sign-in must be on: Authentication → Sign In / Providers → Allow anonymous sign-ins).
- Move the mouse to bring up the control bar. **Start recording** records from the laptop microphone. Audio is written to the browser's storage every few seconds, so a crash or a closed lid doesn't lose it; reopen event mode and press **Recover unsaved recording**.
- **Stop**, name the recording and press **Save to event**. It uploads to the event page as an audio file. **Download copy** keeps a local backup.
- Hover a question to show it big, mark it answered or hide it.
- By default the big screen shows only questions a host approved (migration `0014_security.sql`). The host console has an **Approve** button on each waiting question and a switch under the screen preview to turn approval off for the event. Questions from the event's hosts, and any question put on the big screen, count as approved.
- Each person can send up to 3 questions a minute and 20 per event; the event's hosts have no limit. Names sent without an account show with "(guest)" after them, and names sent from a team account with "(Kleros team)". A name that matches a public Kleros team name or X handle is refused unless a team member sends it. Each person can also add or take back up to 30 votes a minute.
- Guests get an anonymous Supabase session on their first question or vote. Supabase limits how many anonymous sign-ins one IP address can make per hour (Authentication → Rate Limits). At a venue everyone on the wifi usually shares one address, so for a large audience raise that limit rather than lower it.

## Site assistant

Off until the deployment has an Anthropic key; until then only the team sees the button, with a note on how to switch it on.

Visitors, QR guests and accounts outside the team get the button only once `SUPABASE_SERVICE_ROLE_KEY` is set and migration `0014_security.sql` (or `0013_ask.sql`) has been run, so that their question limits are kept in the database and hold across every server instance. Until both are in place only the team can ask, and the team's panel says what is missing. If the database stops answering, questions from outside the team are refused until it is back; the team's questions are then counted on each server instance. Visitors who are not signed in are counted by IP address, so at a venue everyone on the same wifi shares one visitor limit; signed-in accounts are counted one by one.

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns the assistant on (and talk summaries). In the Anthropic Console, spend limits are set per workspace, not per key: create the key in a workspace of its own and give that workspace a monthly limit. That workspace limit is the hard cap on what the assistant can spend; the settings below only bound how often people ask and how much one answer may read. |
| `ASK_ANTHROPIC_API_KEY` | Optional: a key for the assistant alone, from another workspace with its own limit, so the assistant reaching its limit never stops talk summaries. |
| `SUPABASE_SERVICE_ROLE_KEY` + migration `0014_security.sql` | Required before anyone outside the team can ask: question limits are kept in the database, so they hold across server instances. Without them only the team can ask. |
| `ASK_PUBLIC=off` | Only signed-in accounts can ask. QR guests count as visitors. |
| `ASK_MODEL`, `ASK_EFFORT` | Model (default `claude-opus-5-5`; `ANTHROPIC_MODEL` only changes the summaries) and effort (`low`, `medium` default, `high`). |
| `ASK_LIMIT_VISITOR`, `ASK_LIMIT_VISITOR_DAILY`, `ASK_LIMIT_SIGNED_IN`, `ASK_LIMIT_SIGNED_IN_DAILY`, `ASK_LIMIT_TEAM`, `ASK_LIMIT_DAILY_TOTAL` | Questions per 10 minutes and per day (defaults 8 and 30 for visitors, 20 and 60 for accounts, 60 per 10 minutes for the team, 600 a day in all outside the team). |
| `ASK_COST_UNITS` | Most one question may use, in input-token units (default 800000); past it the answer is written from what was read. |

Migration `0013_ask.sql` holds the same question counter and also lets the database pick the matching transcript lines, so a search does not download whole transcripts.

## Deploy

- **Vercel:** import the repo, add the env vars from `.env.example`, and deploy.
- **Netlify:** import the repo; `netlify.toml` holds the build settings. Steps, env vars, domain and sign-in notes are in [docs/deploy-netlify.md](docs/deploy-netlify.md).

Then point `events.kleros.io` at the host and make sure the Supabase redirect URLs include it.

## Notes

- Uploads go to the private `materials` storage bucket. Only team accounts can upload, and a private event's collaborators can upload to that event. The site serves each file at `/f/<path>`, which hands a signed storage address (valid for six hours) to visitors the database rules let see the file. The free Supabase tier caps single files at 50 MB, so keep talk recordings as compressed audio (the in-browser recorder makes about 20 MB per hour).
- Keynote and PowerPoint decks need exporting to PDF first. Google Slides, YouTube and X posts can be added as links.
- Data model and access rules are in `supabase/migrations/0001_init.sql`. Visitors only ever see their own attendance, notes and watch history.
