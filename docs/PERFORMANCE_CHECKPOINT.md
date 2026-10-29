# Portal loading checkpoint — 29 October 2026

Core owns application/backend verification and final hosting integration on `codex/core-application`.
Backend candidate: `73fb2ff09c112b40873bc9571f1ea34fb2b6e37b`.
Date-only frontend release: `d137d100d5e97503a5de004574f412b73c3972e7`, Netlify
`6ae34352f4042839082e7733`, actual served setup SHA256
`390aac988b6eb37bc5a6d0549961c74749486c3125211559b8771ec2c61a5cd6`.
Stable backend remains `ae63380642173ebd92afbf76a97d827a3aaa06f3` / Railway
`d112f94a-0027-41be-b9c4-99e81064f95a`. The human approved Restart now; backend candidate rollout
`3ca7a15d-c52f-447f-a40c-f8b4f8979384` is building. Frontend publication/final live checks are pending.

## Interfaces and decisions

`GET /api/public-catalog` is production-only, exact GET with no query, behind the unchanged
Host/proxy gateway checks and before session lookup. It returns schema1/kind public-catalog,
mode/instance, public chain metadata, generatedAt, catalog metadataOnly/not-loaded/recorded-adoption,
and whitelisted public/published event display terms plus historical creation tx/block/hash.
No RPC, session access, trust-map updates, current financial phase, owner/capability/recovery fields
or signing eligibility occur. Each row requires its exact durable confirmed factory-create review,
verified historical adoption, immutable policy/Luma/template/profile/factory/child/call/hash bindings.
Changing publication visibility is reflected immediately; malformed/unbound/pending records are omitted.

Home UI consumes this separate display state, labels rows Check status on open, and does not start
an automatic full bootstrap. HTTP404 alone permits one legacy/demo compatibility bootstrap fallback.
Selected events, setup, wallet, review, drafts and validation retain existing current source/canonical/
owner/upgrade guards. Financial economics and v7/v8/v9 dispatch are unchanged.

## Evidence and remaining work

Focused backend29 HTTP/privacy/pure checks and one actual local factory-create/canonical-adoption/
0600 disk-restart check passed; zero provider calls during catalog reads. Typecheck and static/pinned
ABI build passed. Detailed source pins: `artifacts/mainnet-release/public-catalog-backend-checks.json`.
Independent bounded source review found no actionable issue. Closed115-file backend package proof:
`artifacts/mainnet-release/backend-context-catalog-clean.json`. No private/runtime/untracked source included.

One actual before-release anonymous controlled cold browser check passed on the date release:
FCP1860ms, usable home/search23556.8ms, API responseEnd23547.8ms. This is browser readiness, not
checker wall time; routing disables cache, so no warm-cache or field-Web-Vitals claim is made.
Proof: `artifacts/portal-performance-readonly/2026-10-29T13-05-55-843Z-baseline-2f1997f6-e33a-4616-97d7-58be1eb367ef/proof.json`,
SHA256 `cdeceaa99455fa51db0b328716a2d1c6e1d712eab1a459c1ca02bbb664c4d6a5`.
Exactly1 API,27 requests,2 same-page desktop/mobile screenshots,0 errors/auth/financial actions;
public catalog was honestly0 at that observation. Both screenshots visually inspected.

Accepted UI source `354e04562ada1e40e1f88cefcb82b70071670cd5` is integrated: four exact product
assets, source-bound8 GET-only browser groups,2 synthetic wallet-change invalidation groups and
independent source review passed. Root repeated12 pure UI checks, typecheck/static build and an actual
backend-to-frontend empty-catalog round trip, which granted no current verification or financial authority.
Remaining: ordinary backend build/health completion, frontend publication and exactly one matching
after-release browser check. The brief volume-backed backend restart ends in-memory
wallet sessions; an open form must not be forcibly refreshed and durable journals remain untouched.
The human explicitly answered Restart now before the backend deployment began. A/B/C stay retired incomplete/PAUSED,
D complete, E unused. No new financial transactions, Court test, policy upload, billing or upstream push.
