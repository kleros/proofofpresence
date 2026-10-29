# V10 display projection handoff

29 October2026. **Local, tested, ready for Core integration; V10 is not published by this work.**

## Branch and starting point

- Branch: `codex/kleros-ui-ux-speed-audit`.
- Worktree: `/Users/hashmanansala/.codex/worktrees/kleros-ui-ux-speed-audit/Kleros projects`.
- Starting commit: `1878acae9492bbeb58f4b7b852832c1730336955`.
- Contract handoff reviewed: `60a841f`, `codex/instant-upgrades-v10`.
- Core approved this exact three-helper scope and confirmed its DTO facts. Core alone owns integration,
  account and receipt support, event adoption, app/widget/environment wiring and publication.

The human wants to create a public V10 event, see it under Your events, then find it on the public
homepage. These changes remove the display projections' V9-only rejection while keeping financial
and account authority with the backend. The current live09ac3a9 V9 portal is not a V10 release.

## Files changed

| File | Change |
| --- | --- |
| `public/contract-profiles.js` | Additive exact V10 profile/event predicates and explicit supported-production dispatch. |
| `public/event-search.js` | Allow supported exact V9/V10 profile/ABI pairs in public projections; keep adoption and public/publication filters. |
| `public/owned-events.js` | Allow either explicit production bootstrap family; each canonical organizer row must match that family and exact actor/instance scope. |
| `test/v10-ui-projections.test.mjs` | Eight focused pure V10/privacy/compatibility test groups. |
| `artifacts/v10-ui/`, bounded catalog-session artifact directory | Exact source hashes, test logs and local regression proof. |
| `UI_HANDOFF.md`, this file | Integration requirements and validation limits. |

No styles, visual tokens, app, widget, sender, environment, auth, backend, contract, policy or deployment
file is changed. No private signing or transaction journal is changed. The existing unrelated dirty
server allowlist/audit files in this worktree are excluded from the delivery.

## Explicit interface

New exports in `contract-profiles.js`:

```js
V10_PRODUCTION_CONTRACT_VERSION // 'kleros-event-v10-uups'
isVerifiedV10ProductionProfile(metadata)
isVerifiedV10ProductionEvent(event)
isSupportedProductionVersion(version)
isVerifiedSupportedProductionProfile(metadata, explicitVersion)
isVerifiedSupportedProductionEvent(event)
```

The V10 metadata tuple is exact: contractVersion and abiVersion both `kleros-event-v10-uups`,
version10, financialModel `v8`, upgradeable/verified true, challenge/match windows86400, testOnly false
and chainId1. No prefix or schema similarity grants support. Existing V9 exports/predicates retain
their prior semantics, including optional metadata compatibility.

Public catalog remains schema1, kind `public-catalog`, mode `hosted-production`, recorded-adoption
metadata only. Public and published flags are filtered before titles are read/indexed. Each row needs
an exact supported version and matching ABI, chain1, stable identity and complete recorded-adoption
hash/block reference. It returns detached frozen display fields and says Check status on open;
it never establishes current financial state, live provenance, account eligibility or permissions.
Search remains local; native event links remain generated from stable IDs.

Owned projection requires fresh authoritative bootstrap, matching acknowledged wallet/session, mode,
server instance and production chain/profile. V10 bootstrap ABI must be exact; V9's prior optional
bootstrap ABI compatibility remains. Each row must be `role: organizer`, match the bootstrap family
and pass the exact row predicate. Core explicitly confirmed this single-family inventory contract;
there is no mixed V9/V10 inventory assumption. Authorized private/draft rows stay confined to that
current actor. Invalid context returns null/unavailable; verified empty is a distinct array. Output
and markup remain the existing frozen six-field shape, escaped titles and exact Manage event links.
The projection cannot establish freshness or authenticate a wallet; the caller owns both.

## Checks actually run

-18/18 pure tests passed:8new V10,4existing owned and6existing catalog tests. Command and logs:
  `artifacts/v10-ui/projections-2026-10-29T16-22-30.119Z/proof.json`.
-2existing catalog-session browser groups passed: synthetic account/chain invalidation, acknowledged
  fake signout and fresh anonymous setup. Provider requests0; exactly2local fake DELETE session
  actions. No real authentication or RPC. Proof:
  `artifacts/catalog-session/v10-projection-v9-regression-2026-10-29T16-21-59.983Z/results.json`.
-8offline catalog-session harness guards passed, zero requests/browser launches.
-`npm run typecheck`, `node scripts/build.mjs`, module syntax, formatting and diff checks passed.
  The static build checks existing app/historical ABI; it does not compile V10 contracts.
-Independent bounded source review passed on all three final hashes. No new CSS or layout was built;
  prior component geometry is reused, and no new visual-polish work is included.

Combined source pins/limits: `artifacts/v10-ui/final-provenance.json`. The browser regression uses
this isolated worktree's older full app and synthetic V9 session fixtures. It is not evidence for
Core's new V10 controller, delegated account support or real creation/adoption. No live visit occurred.

## Core integration and remaining requirements

1. Apply only this finite delivery to the newer Core source. Preserve the current app/widget/backend,
   live V9 release, old original-hash recovery, manifests, policy, namespaces and private state.
2. Core explicitly retains V10 additions to `contractProfileForEvent`, `hasV8FinancialInterface` and
   `supportsBatchJournalProfile`; those permission-adjacent maps remain unchanged here. Add exact
   V10 branches with correct chain/mode restrictions during the combined integration.
3. Complete V10 environment/account/governance/draft/job/receipt/adoption checks and explicit dispatch.
   New display predicates do not enable a wallet or a financial action. A new factory alone cannot
   support the existing delegated wallet or adopt its old V9 child.
4. Core retains real adopted-event defaults public+published and will disclose public listing in
   the review before the wallet opens. These helpers do not invent a visibility selector/backend.
5. Prove the actual local V10 creation→canonical adoption→fresh owned list→public catalog chain,
   including private/draft exclusion and failure/unadopted cases. Separately verify full-app one-send,
   original-hash progress, onComplete fresh inventory and receipt/share preservation. Synthetic
   projection success is not canonical adoption evidence.
6. Keep immediate-upgrade governance disclosure separate from V9's permanent48h minimum. New V10
   policy/publication, source-bound deployment and any mainnet signing need Core's concrete reviewed
   process. Never label V10 upgrades permanently disabled from a zero owner field alone.
7. After combined checks, Core publishes the exact backend/frontend bundle, verifies source assets
   and responsive public pages, and shares the live link. The human alone tests their authenticated
   wallet and creates a real event. No agent impersonation or real test event is part of this proof.

No deployment, push, merge into Core, financial transaction, policy upload or schedule mutation was
performed. Retired A/B/C financial schedules remain paused and untouched.
