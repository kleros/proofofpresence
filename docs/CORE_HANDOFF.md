# Core application integration checkpoint

The latest requested phase adds simpler screens, explicit v8 dispatch and the controlled Chiado
rehearsal. See [V8_APP_RELEASE](V8_APP_RELEASE.md) for interfaces/checks and
[TESTNET_REHEARSAL](TESTNET_REHEARSAL.md) for public deployment stages. The v7 checkpoints below
remain historical compatibility evidence; public testnet payouts must wait for real chain deadlines.

28 October 2026. Main implementation owner: this chat (`Unify Kleros event deposits`).
Core branch: `codex/core-application`. Integrated stable code checkpoint:
`52b66cc5687936cbdbb2eed3578105bb5b215d2d`. Initial core:
`28f2c3f50563a699a62bf9e4085f0aa6a7464828`; authoritative preview/payment/journal checkpoint:
`b81607ac2bbb86973f3b48b9dd93c2beb756de32`. No upstream push or production deployment occurred.

Deployed hosted source: `371b4c80b0c65ce7b7f571ca41d9f85c8720660b` on the same branch.
The full interactive [Netlify demo](https://kleros-event-workbench-preview.netlify.app) is live with
one persistent Railway backend. Build/typecheck,121 Node tests,143 local browser assertions and370
live acceptance checks passed. [HOSTED_DEPLOYMENT](HOSTED_DEPLOYMENT.md) records exact deployment IDs.
The concurrent v8 experiment is excluded from this immutable v7 deployment.

## Architecture and authoritative interfaces

The root Node ESM app supports loopback local-demo and explicit hosted-demo using unchanged v7
per-event contracts and V1 Court mocks. The existing Next/Supabase content and separate booth systems remain retained source modules.
OptionC is the application architecture; the redesign's **OptionB is a presentation choice**, not an
instruction to replace this backend or merge financial identities into content/merch history.

`docs/API.md` and `src/domain.ts` describe the public interface. The HTTP entry is `src/server.mjs`;
domain operations are `src/workbench.mjs`, provenance is `src/imports.mjs`, authoritative on-chain
state/version checks are `src/chain.mjs`. `public/app.js` currently consumes these real interfaces.

| Surface | Implemented contract |
|---|---|
| Directory/event routes | UI `/#event=<stable-id>&view=participant\|organizer\|cases`; `GET /api/bootstrap`, `GET /api/events/:id` |
| Auth | Demo session picker is explicitly simulated; EOA nonce challenge/verify proves wallet control. Session state returned by bootstrap is authoritative. |
| Create/manage | `POST /api/events`, owner-only `PATCH /api/events/:id`; stable ID assigned by server. Immutable deployment terms cannot be edited. Optional Luma/content mappings grant no role. |
| Registration | Self-registration links the authenticated wallet and declared contact; admission is owner-only. Successful deposit, approved admission and on-chain registration remain distinct states. |
| Deposits/reconciliation | Receipt verification includes successful/canonical log, sender, selected chain/contract, amount, cutoff, duplicates and return pairing. Detail includes participant evidence plus privileged deposit/unmatched ledgers. |
| Attendance | Event staff/owner check-in records source/reviewer/nonce/time; reviewed raw CSV requires origin acknowledgement and rejects known conflicts. Personal history/merch/consent never enter proposals. |
| Financial actions | Draft preview→validate/execute→confirmed receipt. Event/wallet/deployment/revision/fingerprint/expiry are bound; changing context invalidates the review. Browser wallet uses validate→wallet send→confirm. |
| Court/settlement | Challenge/match/correct/resolve/release, evidence, direct resolver appeal funding/rewards; reviewed `passPeriod` and `deliverRuling` use arbitrator IDs, preserving the resolver's finality/appeal override. |
| Recovery | Reject/refund, cancellation, no-list withdrawal, owed claim, spare refund/sweep, two-step ownership. Contract rules and reserves remain authoritative. |
| Local compatibility | `/finance/:id/guest/`, owner-only `/finance/:id/console/`; per-instance event config, pinned ABI, local upload/gateway and chain-time eligibility. Main workflow uses root drafts; file-driven legacy plans are prepared with retained scripts. |

## UI integration invariants

- `state.phase` is Open/Listed/Finalized/Cancelled. Finalized can coexist with unresolved matched cases.
  Normal payouts must remain available with appropriate reserves; a late loser redistributes top-ups.
- Distinguish registration/admission, verified deposit, staff observations, posted monetary attendance,
  challenge state, owed payment, and newsletter/personal-history state. A visual status must not infer one
  from another or manufacture a successful transaction.
- `event.role`, `permissions`, `state.owner` and `pendingOwner` derive from server/chain. Browser-hidden
  actions do not replace authorization. Private/editorial-draft events retain linked participant recovery
  access and financial owner/pending-owner access without widening content-app RLS.
- Resolver local IDs identify evidence/funding/rewards; arbitrator IDs identify Court delivery/cases.
  Display exact event/network/contract/recipient/wei/policy and the reviewed consequences before signing.
- Raw CSV labels/hashes do not authenticate origin. Manual review never overrides proven mismatch,
  stale plan, duplicate evidence or conflicting identity. Explicit foreign participant IDs cannot fall
  back to matching email.
- Demo wallet selector/time controls/mock rulings/faucet must remain labeled and isolated. Runtime has
  ephemeral in-memory state; no production persistence/authentication or public IPFS pin is claimed.

## Redesign ownership and integration

The parallel chat `Implement Option B UI redesign` owns presentation/accessibility/responsiveness.
It delivered from a separate snapshot repository at `/private/tmp/kleros-ui-snapshot-20261028`
and worktree `/private/tmp/kleros-ui-redesign`, branch `codex/kleros-ui-redesign`. This was necessary
because the main repository was initially unborn. Do not assume shared Git ancestry.

The delivered commit `923f517fccdd0bddefbd9acaf5454309ee6c9ecf` and original
[UI_HANDOFF](UI_HANDOFF.md) were reviewed against the current core and imported locally as
`refs/remotes/ui-handoff/redesign`. Compatible UI/assets/tests were applied with scoped three-way
integration; newer backend files and canonical project records were retained. Static asset serving
was adapted manually. [UI_INTEGRATION](UI_INTEGRATION.md) records the accepted changes and corrections.
The main owner deferred further visual polish and completed the combined application checks.

## Verification and remaining work

Final `npm run verify` at the integrated code checkpoint passed build/typecheck, **91/91 Node tests**,
and four browser suites: lifecycle39, redesign49, safety16 and context4 assertions, plus their
interaction/expectation checks. A fresh archive of that commit passed offline root-only installation,
build and typecheck. Clean retained compatibility checks passed contract/script/provenance54/54,
guest180/180 and console159/159. [TEST_REPORT](TEST_REPORT.md) records the commands and limits.

The local implementation and UI integration are complete. Explicit unmatched case dispatch, scoped
sessions/previews, log-backed payment facts, durable submission hashes, terminal failed receipts,
factual re-login recovery and event-switch response guards all use the authoritative core interfaces.
External work remains persistent production auth/storage, staging RLS and
private-content mapping rehearsal, a fresh mainnet fork, dependency remediation and an explicitly
authorized rollout. Backend/financial behavior remains owned by the core implementation session.

## Hosted-demo interface additions

The user requested full interactive Netlify hosting. The frontend/gateway target is separate from
the one persistent Node/Ganache backend. `hosted-demo` requires exact HTTPS public/backend origins
and a server-only proxy key; local defaults remain loopback. Sessions become Secure cookies and
nonce signatures bind the public URI. The same-origin RPC has a cookie-free public transport for
bounded reads and signed1337 transactions; API writes retain exact actual-Origin checks.
Unique instance-marker block hashes guard browser and legacy-page signing against another1337 RPC.
No contract/economic/domain rules changed. Shared synthetic identities and restart resets are explicit.
The gateway bundles and the closed production-dependency package builds/serves advanced routes.
The actual Railway/Linux image built successfully with pinned artifact equality and passed health
checks. The production Netlify URL passed370 live acceptance checks, including actual A/B deposits,
owner A registration, independent EOA signing/reconciliation, secure sessions and mobile bounds.
The full arbitration/payout lifecycle remains covered by prior local verification. Remaining work is
production auth/durable storage, dependency remediation and the staging/fork rehearsals above.
