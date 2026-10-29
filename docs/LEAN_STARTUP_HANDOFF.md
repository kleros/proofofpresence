# Lean homepage startup — UI handoff

Branch `codex/kleros-ui-ux-speed-audit`; worktree
`/Users/hashmanansala/.codex/worktrees/kleros-ui-ux-speed-audit/Kleros projects`.
Starting commit `b0208ea4a0c902637a6d2a51ec453347e5b157cb` matches the entire published9cac8df
public tree, including Core's current async setup widget829d8c31. Core owns integration and publication.

## Change and scope

The home page previously waited for seventeen modules, including organizer and transaction code,
before requesting public events. `entry.js` now starts the existing catalog GET immediately and loads
only the lean renderer, search/profile helpers and keyboard helper: five modules total. Common styles,
loading and launch CSS remain; inbox/batch CSS are deferred to full-app handoff. Existing markup,
Kleros palette and event/search behavior are shared pure functions in `public-home.js`.

Only four product files: `public/entry.js`, `public/public-home.js`, `public/app.js`, `public/index.html`.
Full hashes are in `artifacts/lean-startup/ui-handoff-proof.json`. No widget, stylesheet, financial
method, contract, policy, backend API or transaction sender change is part of this UI optimization.

## Startup/handoff interface

`app.js` exports idempotent `startApp({legacyCatalogMissing:false,publicSearch:null})`. Importing it
alone performs no DOM, network or storage initialization. Journal setup and event handlers initialize
only through that explicit start. Entry disposes the lean controller synchronously before a sticky
handoff, loads the full module and both deferred styles, then starts against the latest hash. The full
app permanently owns later navigation; authenticated flows are never unloaded back to a lean router.

Only HTTP404 hands off to one fresh legacy bootstrap. `legacyCatalogMissing` affects only that first
home read and is discarded thereafter. 403/500/malformed results remain errors without heavy fallback.
Transferred search is display-only `{mode,instanceId,query<=120}`; it is applied only after a fresh
matching context. It never seeds bootstrap, identity, permissions or financial authority.

Initial/retry catalog reads retain the35s deadline through JSON body consumption. Late reads/imports
cannot repaint another route. Keyboard retry/search focus and same-scope caret are retained. Import
or deferred-CSS failures offer explicit user reload before full-app initialization; no automatic reload
or transaction resend. Full-app wallet epochs, negative session invalidation, known-hash recovery,
matching bootstrap and existing signing checks remain intact.

## Actual validation

- `node test/lean-startup.e2e.mjs --baseline`: two source-pinned controlled baseline visits.
- `node test/lean-startup.e2e.mjs --candidate`: ten focused groups passed, including graph/payload,
  strict projection/privacy, keyboard/retry,404 once, fresh setup/event startup, preserved pending hash,
  negative wallet invalidation, latest-route handoff, import failure and held-body timeout.
- `node test/selected-bootstrap-ui.e2e.mjs`: real isolated v7 and v8 startup compatibility passed:
  twelve groups/eighteen single selected GET loads/six synthetic demo session changes. No browser
  financial action, wallet request, public RPC or off-origin attempt. Only local setup contracts deployed.
- `npm run typecheck`, entry/home syntax, `node scripts/build.mjs` and whitespace checks passed.
  Static build compares historical pinned ABI/build; no Solidity compilation or broad economic suite.
- Root inspected desktop,390px mobile and doubled-text component images: no clipping found.

Cold-home JS decoded bytes:455,516 →29,394; modules17 →5. CSS83,709 →63,310; files5 →3.
Offline per-file gzip totals120,445 →9,645 are compression estimates, not wire-transfer measurements.
Both local timing versions use the SAME1500ms catalog delay and80ms per-static delay model. Mobile
usable2095 →1705ms, desktop2065 →1698ms; CLS unchanged. These are local modeled samples, not live
latency or field metrics. Exact candidate evidence:
`artifacts/lean-startup/candidate-2026-10-29T14-12-57.336Z/final-provenance.json`.
Actual legacy evidence: `artifacts/ui-ux-audit/integrated/joint-browser/2026-10-29T14-11-28-307Z/`.

Two preparation runs exposed overly specific harness assumptions (matching-query status and shared
pure renderer download on deep links); assertions were corrected without product changes. Their
source-specific artifacts remain preserved. One fake local DELETEsession is the only candidate test
mutation; no authentication POST, signature, provider request, financial endpoint or public request.

## Integration and remaining checks

Apply only the four product files plus focused test/docs/evidence. Preserve Core's entire current
`public/luma-setup.js`829d8c31 and backend/jobs/registry/canonical memory. Isolated `src/server.mjs`
has only the two static allowlist entries for compatibility tests and is EXCLUDED from this UI commit;
Core359d94c already owns those paths. Ensure packaging and source verification include both new modules.
Keep all public files in the Netlify context so deferred full-app imports remain available.

Core359d94c owns two separately reviewed pinned read reuses and its five local backend checks. These
remove small duplicates, preserve fresh closing checks and do not materially speed factory setup.
No generic cache, free-plan pacing change or billing upgrade is requested.

Core alone should integrate, publish and run the matching bounded live AFTER comparison against its
current9cac8df BEFORE2.6021s. The older3.3589s is historical, not this phase's comparator. Do not force
reload the human's active form or send transactions. Live timing/publication is pending at this handoff.
