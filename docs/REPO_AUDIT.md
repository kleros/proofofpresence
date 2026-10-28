# Current source and baseline audit

28 October 2026. The workspace initially contained an unborn `main` Git repository and the supplied
handoff folder/archive, with no application source. Those inputs were preserved. Public repositories
were obtained into separate reference directories; each checkout was initially clean on `main`.

| Source | Current fetched HEAD | Handoff comparison |
|---|---|---|
| Kickback | `57fc1c8233c60e31c1b5988c631ef57d7c3f1b81` | Exact match |
| Events | `fa732b8ea20e57648516b6e46e1076c0bf2ab434` | Exact match |
| Booth | `169220bb41787b8aabdec5190ab85379328f143f` | Exact match |

Detailed source maps and executed baseline checks: [Kickback](KICKBACK_AUDIT.md),
[events, including all 14 effective migrations](EVENTS_AUDIT.md), [booth](BOOTH_AUDIT.md).
For portable delivery these are now vendored source directories, not embedded Git links. Original cloned
metadata is preserved locally in ignored `.runtime/source-history/`; source bases are in
`references/SOURCES.json`. Tracked Kickback changes are recorded in `docs/patches/kickback.patch`, with
new source files included directly. No upstream branch, commit or working source was discarded.

## Confirmed defects addressed

- Cross-event verified/claims CSV relabeling: event/deployment/config/source hashes and explicit raw
  origin review now precede actionable preparation. Available source metadata conflicts fail closed.
- Global latest ABI dispatch: v7 gets a pinned artifact with explicit version rejection and source checks.
- Truth Pays presentation leakage: new event templates/copy/config are per-event; historical bytes remain.
- Unreproducible browser setup and path-with-spaces failure: pinned Playwright and `fileURLToPath`.
- New app defects found by independent reviewers and regression tests: caller-controlled registry IDs,
  foreign participant-ID email fallback, excess-refund evidence invalidation, historical rejected stakers,
  readmission after refund, stale/old confirmation records, private ownership acceptance, atomic import
  commits, deposit cutoffs, and server-instance configuration collisions.

## Explicit trust assumptions

- v7 admission is owner-curated and aggregate-solvency based. A deposit log alone cannot authorize a spot.
- A raw Luma/manual CSV has no authenticated origin. Hashes bind bytes; the named organizer records a
  source review. This does not override a known event/chain/contract/identity conflict or duplicate receipt.
- Demo identities deliberately simulate authentication using local funded signers. Browser EOA nonce
  authentication proves wallet control; entered email is a declared contact, not proof of email ownership.
- Door staff observations are event scoped, authenticated and nonce protected. They remain staff evidence;
  final monetary attendance is determined by contract posting/challenge/ruling rules.

## Retained defects / untested risks

Booth global queues, unscoped uniqueness and consent/merch display defects are reproduced/documented,
but the booth is not migrated or loaded by the finance app. Its source cannot authorize payouts here.
No live Sheet, provider settings, private guests, mainnet state or migration status were queried.
Events' late security migrations already protect private storage/assistant access; those were not
misreported as new issues. Database RLS behavior was source reviewed, not exercised against a local DB.
No fresh mainnet fork was available. Dependency advisories and the demo-only persistence/auth boundary
remain explicit production rollout work.
