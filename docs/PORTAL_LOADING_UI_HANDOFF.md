# Faster public portal — isolated UI handoff

The public home now reads a lightweight, display-only directory before any financial bootstrap.
Opening an event or organizer setup still uses the existing fresh guarded APIs. This removes the
expensive bootstrap from the homepage rather than hiding it behind a different spinner.

## Source and ownership

- Branch: `codex/kleros-ui-ux-speed-audit`.
- Worktree: `/Users/hashmanansala/.codex/worktrees/kleros-ui-ux-speed-audit/Kleros projects`.
- Performance starting commit: `04bf04ba60338e72176b4d8490a719c5571eb706`.
- Primary owns backend, integration and deployment. No primary checkout file was changed here.
- Four production UI files: `public/app.js`, `public/event-search.js`, `public/index.html`,
  `public/loading.css`. Exact hashes and test provenance: `artifacts/portal-loading/ui-candidate-proof.json`.
- The independently reviewed date widget is included in local test asset pins at SHA256
  `390aac988b6eb37bc5a6d0549961c74749486c3125211559b8771ec2c61a5cd6`.
  It is already owned/published separately by Core; do not cherry-pick an older setup widget over it.

## Interfaces and trust boundary

Home only (no event/setup route) requests `GET /api/public-catalog`. Schema1, kind `public-catalog`,
mode `hosted-production`, instance ID, Ethereum chain1/native ETH metadata, generated ISO timestamp,
and `catalog:{metadataOnly:true,currentFinancialState:'not-loaded',source:'recorded-adoption'}`
are required. Supported rows carry chain1, both version strings `kleros-event-v9-uups`, explicit
public/published flags and recorded-adoption transaction/block hashes and positive block number.
The server must bind those records to its immutable Luma/policy/factory/draft adoption evidence.

Client filtering removes nonpublic/unpublished/unsupported/malformed/duplicate IDs before title
search/count/DOM. Only id/title/date/timezone/deposit/status text survive the frozen projection.
The catalog lives in separate `displayCatalog`, clears old bootstrap/detail presentation, and grants
no identity, current canonical verification, financial phase, eligibility, balance, owner or capability.
Rows say **Check status on open**. There is no automatic financial bootstrap after a catalog success.

Only HTTP404 permits one existing-bootstrap compatibility fallback for older/demo/testnet servers.
403/500/503, invalid JSON and malformed successful envelopes show an explicit retry error rather
than an empty directory or heavy fallback. Setup/event navigation bypasses the catalog and retains
the existing guarded bootstrap/detail/draft/validate/recovery flow. Financial predicates are unchanged.
Navigation generations reject late catalog responses even if cancellation is ignored by transport.
A separate negative-only session marker retains account/network-change logout after the display
bootstrap is cleared. It is set only by an observed full wallet bootstrap or confirmed wallet-auth
acknowledgement; it cannot grant authority, and confirmed logout/fresh anonymous bootstrap clears it.

Search/clear stay local. Refreshing the same directory patches results while preserving the search
input/query/caret. A neutral compact initial shell avoids guessing a network before a response and
reduces the previous workspace-to-portal layout jump. No background refresh remounts a live setup.

## Validation actually run

- `node --test test/public-catalog-ui.test.mjs test/event-search.test.mjs`: **12/12 passed**.
- `npm run typecheck`: passed.
- `node scripts/build.mjs`: passed static syntax and pinned historical ABI/build check.
  Solidity was not recompiled and financial suites were not replayed.
- Focused local browser harness: **8 groups passed** on final app `3b121b18`, plus **13 offline loading safety guards** and **8 offline session-test guards**.
  Tests cover one catalog/zero bootstrap on home, local search/privacy,503/keyboard retry,
  malformed success without fallback, exactly404 fallback, fresh setup/event bootstrap and a late
  catalog response discarded after setup navigation. These eight groups are GET-only.
- Two separate synthetic wallet-session browser groups passed: previously observed wallet → catalog
  home → accountsChanged/chainChanged each causes exactly one mocked local logout; the next full
  setup bootstrap is anonymous. No repeated logout after confirmation. The only allowed write is
  exact fake loopback `DELETE /api/session` with body `{}`; provider requests/other writes are zero.
  A preliminary test-harness run rejected that existing body; its allowlist was corrected and the
  failed artifact retained. No product defect was reported by that harness failure.
- No actual wallet, authentication signature, external service or financial action occurred.
- Desktop1440, mobile390 and mobile200% text screenshots inspected by root: no clipping/overflow.

Both local before/after tests deliberately wait1500ms for their respective API response, use fresh
Chromium contexts and actual source assets, and do not measure the hosted backend. Mobile CLS
was **0.5644 → 0.0622**; desktop **0.4305 → 0.00674**. The earlier preceding UI checkpoint rendered in27/18ms.
Final local after-response rendering was14/15ms on mobile/desktop.
The ~24.8s old release checker wall time was not a measured bootstrap; earlier hosted bootstrap
measurements were ~21s. Core then measured the existing dated-widget release with the same new
controlled browser harness: FCP1.860s, homepage usable23.5568s, bootstrap response-end23.5478s.
Its primary-owned proof is linked in `ui-candidate-proof.json`. Only the matching live after check
can establish real online speed gains.

Evidence: `artifacts/portal-loading/before-public-catalog-2026-10-29T12-53-35.868Z/` and
`artifacts/portal-loading/final-public-catalog-2026-10-29T13-06-04.449Z/`.
Final session guard evidence: `artifacts/catalog-session/final-public-catalog-2026-10-29T13-05-48.885Z/`.
The intermediate291f source/browser result remains preserved separately. The baseline preserves its
original harness/fixture bytes. This is controlled local evidence, not field Core Web Vitals.

## Integration and remaining work

Review/apply only the four UI files, new focused tests and this evidence; retain Core's newer backend,
registry, canonical project memory and date widget. `event-search.js` is already a served asset, so
no new public module allowlist entry is needed. Integrate only with the exact agreed metadata endpoint.
The endpoint must return no session/private contacts/authority and make zero RPC calls, including for
an authenticated owner. Existing private/auth/financial APIs keep their full verification.

Core reports backend source `73fb2ff` reviewed with29 focused HTTP/privacy tests and actual canonical
create/disk-restart catalog coverage. Those are primary-owned checks, not rerun here. Core must finish
deployment and bounded anonymous live timing/desktop/mobile checks after resolving its pending human
backend-restart timing request. Do not claim this candidate is published or that setup/selected-event financial verification
is faster until separately measured. Preserve the human's active form/session and all durable
submission journals. No forced reload, new real financial action or schedule change is part of this work.
