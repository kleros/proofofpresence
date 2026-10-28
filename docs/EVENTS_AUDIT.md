# Events reference audit

Reviewed 28 October 2026 against `references/events`, default branch `main`, commit `fa732b8ea20e57648516b6e46e1076c0bf2ab434`. The tracked checkout was clean before inspection. HEAD matches the handoff snapshot. No repository-specific AGENTS.md or CLAUDE.md was present. This is a source review plus local build baseline, not a live database or production security certification.

## Role and architecture implications

The existing Next.js 15.5.28 / React 19.1.1 / TypeScript 5.9.2 app is already a multi-event content platform. It has event UUIDs and slugs, public/private editorial state, agenda, team roster, materials shared across events, synchronized talk playback, transcripts, live Q&A, personal event history, meeting requests, and an assistant. It uses Supabase Auth, RLS, storage and realtime. Rebuilding its media or assistant functionality is unnecessary for the requested financial product.

`src/lib/types.ts:6` has the editorial EventRow. It has no deployment, chain, deposit, policy, wallet ownership or verified financial attendance association. Its `starts_on` / optional `start_time` and human-readable `timezone` are content values, not canonical financial deadlines. Add a separate typed financial registry with a stable mapping to these UUIDs; never let public metadata synchronization alter deployed terms.

`src/components/AttendanceButtons.tsx:27` upserts the current user's own status; line 34 labels the past-event action “I was there”. This is self-declared history. There is no wallet proof or door verification here. No finance adapter should consume this table as payout authority.

Recommendation: retain this platform as the content module and map its stable event UUIDs into the new financial event domain. A coherent financial/check-in interface can link to the existing event's materials/Q&A with the same authenticated Supabase access. Keeping content as a linked module avoids requiring a live Supabase migration to demonstrate local contract flows and preserves existing URLs and privacy. If the events app becomes the UI foundation later, add the finance module without replacing current auth/storage policies or giving team editors contract-owner powers.

## Complete effective migration history

All fourteen migration files were inspected in order. Later replacements supersede initial policies; the original public bucket and public transcript policies are not the effective source state.

| Migration | Introduces / effective relevance |
|---|---|
| 0001_init | Base event/profile/material/attendance/questions/votes/meeting schema, RLS, storage and realtime; several permissive initial policies are superseded below. |
| 0002_team_and_grants | API grants and initial email-based team assignment; assignment superseded by 0003. |
| 0003_access | Confirmed email team/admin derivation, team grants/blocks, protected profile flags, admin directory. Historic master admin identity remains configuration, not current-user authorization. |
| 0004_live | Per-event live state, atomic featured question, live event lookup, anonymous author protection through column grants and question_scores. Live lookup/privacy updated by 0010; Q&A hardened by 0014. |
| 0005_transcripts | Transcript/summary state and grants; visibility is superseded by 0006/0010. |
| 0006_material_links | Many-event material links and primary-event synchronization, nullable library material, transcript visibility follows material. |
| 0007_luma_sync | HTTP/pg_cron metadata sync and log; latest sync_luma implementation is in 0012. |
| 0008_social_feed | Idempotent feed imports and cron; latest feed implementation is in 0014. |
| 0009_feed_material_urls | Feed URL provenance bookkeeping; feed implementation superseded. |
| 0010_private_events | Creator/confirmed-email collaborators, can_see_event/can_edit_event, private materials/transcripts/live/attendance boundaries; links/storage/mutation guards; privacy-aware sync. |
| 0011_feed_sources | Feed host fallback; source selection superseded by 0014. |
| 0012_private_events_round2 | Creator deletion/slug/visibility behavior; collaborator cleanup; no private material fallback into global library; shared-item path/link/delete restrictions; latest privacy-aware sync_luma. |
| 0013_ask | Service-only shared usage counters; transcript search runs as security invoker and inherits material visibility. |
| 0014_security | Latest feed source/URL checks and serial execution, clear auth passwords, own-only votes/no vote realtime, rate-limited/moderated Q&A, path validation, private materials bucket and stricter unused-file visibility. |

### Effective boundaries that must survive integration

- Confirmed email controls team/admin and private collaboration. Local `supabase/config.toml` enables confirmation and explicitly prohibits pushing that configuration to the live project. Team access is content authority, not wallet ownership or financial authority.
- Private events are creator/collaborator-only even for unrelated team admins (`0010_private_events.sql:67`, `:76`, `:258`). Public drafts remain visible to the team. `not_hidden_event` deliberately lets public draft live pages operate; this is existing behavior, not evidence of private-event exposure.
- Materials are visible through visible linked events; private-only items do not enter the global library when unlinked. Deleting or replacing shared file data requires appropriate rights to all affected events (`0012_private_events_round2.sql:163` onwards).
- Transcripts inherit material visibility (`0010_private_events.sql:392`). Assistant lookups use the caller's Supabase session (`src/app/api/ask/route.ts:59`, `src/lib/ask/tools.ts`); `ask_search_transcripts` is security invoker. The service role is used for usage counters, not assistant content retrieval. Outside-team assistant calls fail closed without shared rate counters.
- Migration 0014 sets the materials bucket private at line 670. `/f/<path>` validates paths, signs with the visitor's session, and returns private-cache redirects (`src/app/f/[...path]/route.ts:34`). Signed URLs live for six hours, which is a documented revocation/cache tradeoff, not instant revocation.
- Vote rows are own-only and removed from realtime; question_scores redacts anonymous author identity and explicitly repeats private-event visibility because it runs as owner (`0014_security.sql:582`).

### Synchronization and operational cautions

Latest `sync_luma` (`0012_private_events_round2.sql:371`) consumes public `api2.luma.com` metadata. Host IDs are hardcoded; upcoming/past discovery requests a first page of 50 (`:405`) without pagination. It excludes the appropriate hidden Luma mappings and matches existing public events only. It imports no private guest/check-in data, wallet proof or deposits.

Migration 0014 reads a trusted GitHub feed with events.kleros.io fallback, validates HTTPS URLs, serializes feed jobs and preserves team-owned titles/links. Earlier Vercel feed fallback is superseded. Do not claim that old fallback is a current defect.

Migrations are not inert fixtures: 0007/0008 schedule jobs; 0014 changes auth records/password behavior, removes historical votes, changes bucket access and performs a final external feed read. No migrations were executed. Their application in production is unknown. A future migration rehearsal needs a disposable Supabase instance with auth/storage/realtime, HTTP and pg_cron support and network jobs suppressed. Do not push local auth configuration to production.

## Local baseline

Environment observed: macOS host, Node v25.8.1, npm 11.11.0. No backend credentials were supplied or loaded. Dependency scripts were suppressed.

| Command | Actual result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000` | Passed; 80 packages installed. Initial sandbox-only attempt was interrupted because network resolution was unavailable; retry with network access completed. |
| `npm run typecheck` | Passed (`tsc --noEmit`, exit 0). |
| `npm run lint` | Failed (exit 1): enters Next's interactive ESLint configuration. No ESLint dependency/config is declared. This is not a usable CI gate. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` with backend/AI env variables unset | Passed on network-enabled retry, exit 0: compiled, types checked, 8 static pages generated and production routes emitted. Sandbox attempt first failed fetching Google Fonts (Geist, Geist Mono, Instrument Serif) with ENOTFOUND. |

No test/spec files, test script or CI workflow were found in the inspected tree. No Supabase CLI was available on PATH. No database was queried, no migration was run, no login/email was initiated, and no external write occurred. Baseline checks do not establish RLS execution correctness or a live migration state.

## Findings classification

**Confirmed integration gaps:** no financial event mapping or wallet model; personal attendance cannot prove financial attendance; public metadata sync is separate from guest CSV ingestion; no automated test baseline; lint is interactive. Build depends on external fonts and Next warns about the inferred workspace tracing root when this checkout lives under a parent with another lockfile.

**Intentional trust/operational assumptions:** confirmed-email auth is authoritative for content roles; event members decide private content; public draft live-event pages remain accessible; signed URLs have a six-hour validity; service-role transcript operations are gated first by team identity and caller-visible material. These must be re-evaluated only if the modules change.

**Not reproduced / not certified:** live RLS state, migration rollout, transcript-job concurrency, production storage/auth configuration, upstream metadata completeness, availability of existing media. No claims of defects or fixes are made for these untested conditions.

## Transition recommendation

Retain content/media/Q&A/assistant data and URLs in place. Link by stable UUID plus trusted mapped URL; never bulk-export private records into a public financial manifest. Preserve self-reported attendance as personal history. Introduce financial roles and staff verification separately, and require a verified wallet link/receipt plus explicit admission for committed spots. For local delivery, synthetic content links or local fixtures should be clearly labeled; do not present them as synchronized production records.
