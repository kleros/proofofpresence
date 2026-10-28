# Implementation record

Chosen option C is detailed in [the ADR](ARCHITECTURE_DECISION.md). The active application is the
workspace root, with retained source modules in `references/` and one canonical root brain.

| Milestone | Implemented result | Verification |
|---|---|---|
| Reconcile source and safe baseline | Three exact pinned HEADs, all required instructions/migrations read; no live writes | Linked repository audits |
| Event/domain/registry | Stable IDs distinct from slug; separate editorial/registration/financial state; optional Luma/content mapping; per-event owner/roles/contract/version/policy | Root API/EVM tests + build artifact equality |
| Identity/deposits/admission | Demo-linked identities or signed EOA nonce; canonical receipt/log/amount/window/return verification; curated approved stakers | Root integration + existing verifier suites |
| Trusted attendance/imports | Authenticated scoped staff observations, nonces, reviewer/source records; normalized CSV plus explicit unknown-origin review; strict conflict/duplicate/staleness checks | Root provenance/authorization tests + CLI tests |
| v7 financial lifecycle | Challenges/matching/corrections, direct resolver evidence/appeals/rewards, held-share payouts/topups, ruling0/1/2, refund/cancel/withdraw/claim, ownership | Original Solidity suites + root EVM + real browser actions |
| Unified interface | Responsive event selection, participant and organizer desks, exact transaction review, reconciliation, imports, cases/recovery | Browser checks and inspected desktop/mobile screenshots |
| Preserve existing useful services | Content/media/Q&A/private data retained unchanged; booth retained separately and excluded from attendance authority | Effective migration review + offline booth boundary reproductions |
| Reproducibility/docs | Locked root dependencies, local-only defaults, checked JS/types, browser dependency, clean install verification, runbook/demo | TEST_REPORT and exact README commands |

## External work deliberately left for rollout

1. Replace local impersonation/in-memory projections with a persistent authenticated deployment,
   event membership and audited wallet/email verification suitable for the chosen host.
2. Supply an authorized staging content database and verify the existing RLS/migration behavior there.
   Keep private materials and assistant retrieval behind their current caller-session rules.
3. Approve exact future event policy/template, owner and trusted deployment manifest. Rehearse a local
   mainnet fork and validate live resolver fees/finality before an explicitly authorized deployment.
4. Publish policy/evidence/metaevidence to the approved IPFS service with byte/CID checks and retry
   monitoring. Current local storage deliberately makes no public-availability claim.
5. Decide whether booth migration is needed. If so, first fix queue/environment isolation and scoped
   identities/consent/server validation; rehearse a synthetic export/import. No booth data moved here.
6. Resolve inherited dependency advisories for any production runtime. Do not expose Ganache or demo
   account selection publicly. CI configuration is supplied; remote CI has not been run or published.

These are deployment and service-integration limits, not claimed completed production operations.
