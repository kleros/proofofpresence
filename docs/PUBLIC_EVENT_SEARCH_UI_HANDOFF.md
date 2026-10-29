# Searchable public events UI handoff

29October2026. Isolated branch codex/kleros-ui-ux-speed-audit, worktree
/Users/hashmanansala/.codex/worktrees/kleros-ui-ux-speed-audit/Kleros projects.
Starting commit39b4c4cedcafced4d46fa374e48c5f01b7d5a114. Core owns integration/publication.

The human directly requested a searchable event list on the homepage so guests can choose an event
without pasting a link. This supersedes the earlier link-guidance-only homepage scope. Direct guest
links, generated organizer Copy/Open links and organizer setup remain supported.

## Source and data boundary

- public/app.js: production homepage search/results/status/clear and native Open event links. Filtering
  updates only results/status, preserving input focus. Query is transient and scoped to mode/instance.
- public/event-search.js: privacy-first projection and local title search. Filter explicitly
  visibility===public AND editorialStatus===published before reading titles or indexing. Reuse the
  existing verified Ethereum v9 profile predicate; validate stable ID/address, exclude conflicting
  duplicate IDs, and allow only id,title,startsAt,timezone,depositWei,statusLabel display primitives.
  Authorized owner summaries can contain private data; never spread them into cards, datasets or ARIA.
- public/luma-launch.css: scoped list rows/search controls and responsive wrapping using the existing
  plum/lavender/cyan tokens. No image fetches, global redesign, form signup or wallet sender.
- src/server.mjs: isolated test server static allowlist adds ONLY /event-search.js. Core must retain
  its newer backend and own the equivalent source allowlist; never copy this older server wholesale.

Core confirmed existing bootstrap.events supplies the needed fields and final authority filtering.
No new API, per-event request or per-keystroke request is introduced. Search is title-only, insensitive
to case/accents, bounded and non-regex. The public catalog excludes private, draft, missing-flag,
unsupported chain/profile and malformed identities even when the signed-in owner can otherwise access
those records. It does not change backend authorization or private direct-link access.

Display uses the configured exact ETH deposit, date/timezone and financialPhase. Missing/unsupported
display metadata is unavailable; zero is not described as a free deposit. Finalized is labeled Payouts
started and does not assert every case/payment is settled. Open event is a generic navigation action;
fresh selected-event guards continue to decide deposit/recovery eligibility. Empty and no-match states
are distinct, with a clear-search action and useful organizer setup path. No production examples or
synthetic events are added. Real events become listable only through the existing canonical backend.

## Final source hashes

- app.js:152b30c36ab6ac96577869ee2c4b62183b349ea407b30edb75fd28b4e912cf51
- event-search.js:bf5ac5f365f81ca477d0cf4904bdd64d51108efd96dfa4f96e9ed66923decc9e
- luma-launch.css:47e0874cb063eb8cbcecfef80a4e99524b6ebee0f668b60033cc8b48119d37e5

## Actual validation and limits

- npm run typecheck and node scripts/build.mjs:PASS on final source. This isolated build checks the
  retained pinned local context; Core owns the complete newer production build.
- node --test test/event-search.test.mjs:6/6 PASS. Counterexamples cover private/draft/missing flags,
  malformed and duplicate IDs, unsupported deployments, safe primitive projection, title-only search,
  unchanged source data and honest unsupported/zero display values.
- LUMA_LAUNCH_ARTIFACT_DIR=artifacts/luma-event-search node test/luma-launch.e2e.mjs --self-test:
  14offline fixture cases PASS.
- The same command with --run-loopback:29 browser groups PASS, consisting of the previous26 plus
  3 bounded public-search groups. Covers authenticated-owner privacy, safe XSS text, same-title events
  with distinct IDs/dates, local filtering/clear/focus/status, no request while typing, native Open
  route, empty list, desktop/390px/doubled text and44px controls. Existing direct deposit and canonical
  generated Copy/Open URL checks remain included.
- Final run has two fake provider attempts, one literal submitted hash, and zero real sends,
  public/external/forbidden requests or uncaught page errors. Initial pre-zero-helper evidence is
  retained as predecessor only; final proof must match all three hashes above.
- Local historical compatibility after adding the new shared import/static path: v7 simpleUI13 and
  v8 simpleUI18 PASS, including actual isolated-chain deposit and unused-credit recovery.
- Independent source review PASS; readonly release checker96 offline guards PASS with zero network or
  browser. Its source-aware asset list now requires event-search.js only when present at selected Git.
- Root inspected desktop and390px catalog screenshots. The final doubled-text capture scrolls the
  new search/results into view; no broad WCAG certification is claimed. Existing header wrapping at
  doubled text is retained outside this component scope.

Evidence is isolated in artifacts/luma-event-search; historical Luma/case proofs are not overwritten.
Fixtures are test-only. These checks do not execute a real factory creation, mainnet deposit, public
Court ruling or publication. Core's prior financial/proxy proofs remain separate acceptance evidence.

## Core integration and publication

Copy the three exact public files together. Add /event-search.js to the repository's hardcoded static
allowlist for all modes so historical demos can load the top-level import on future backend builds.
The active mainnet backend/API is unchanged: serve the new module statically through Netlify without
restarting or replacing the healthy backend while the human is using organizer setup. Never force
refresh their current tab, reset state, seed events or replay a pending creation/deposit.

Selectors: [data-public-event-search] (label Search by event name), [data-public-event-results],
[data-public-event-status], [data-public-event-clear], [data-public-event-row], [data-public-event-open].
The section heading is Find your event. No public events yet. is the empty-state text; a typed query
with no matches has separate guidance. Native event links use #event=id&view=participant.

Core must update its public read-only check to use the ACTUAL current public bootstrap, not assume
static registry events[] means zero dynamic children. The human is actively creating the first real
event and may finish before this UI release: preserve its canonical adoption/once-journal and describe
its actual state. Do not fabricate records to make the catalog nonempty. Report publication only after
source and public desktop/mobile checks pass. The deferred JSON keyboard attributes remain excluded;
both retired financial schedules stay PAUSED. The report follow-up now waits for this catalog release.
