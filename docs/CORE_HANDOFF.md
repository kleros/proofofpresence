# Core application integration checkpoint

28 October 2026. Main implementation owner: this chat (`Unify Kleros event deposits`).
Core branch: `codex/core-application`. Initial stable code checkpoint:
`28f2c3f50563a699a62bf9e4085f0aa6a7464828`. There is no upstream push or production deployment.
Later core additions and the final integration commit are recorded in this document as they land.

## Architecture and authoritative interfaces

The root Node ESM app is a local-only workbench using unchanged v7 per-event contracts and V1 Court
mocks. The existing Next/Supabase content and separate booth systems remain retained source modules.
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
It currently works from a separate snapshot repository at `/private/tmp/kleros-ui-snapshot-20261028`
and worktree `/private/tmp/kleros-ui-redesign`, branch `codex/kleros-ui-redesign`. This was necessary
because the main repository was initially unborn. Do not assume shared Git ancestry.

The main owner defers further visual polish. Once `UI_HANDOFF.md` is available, read its starting
commit, changed files, data assumptions and actual tests. Compare its patch to that starting snapshot
and to this latest core; preserve new financial actions and backend contracts. Import only compatible
UI/assets/tests/documentation, resolve conflicts in the main branch, and rerun build/typecheck/Node,
browser, desktop/mobile and relevant financial compatibility checks. No automatic whole-tree overwrite
or upstream merge is authorized by the handoff itself. Record the accepted/rejected changes and results.

## Verification and remaining work

The initial checkpoint's consolidated `npm run verify` passed: build/typecheck,37/37Node tests and
36 browser assertions plus interactions. Clean root-only dependency verification also passed retained
contract/script/provenance54/54, guest180/180 and console159/159. TEST_REPORT records prior reproductions
and the nonce/hoisted-dependency fixes. Subsequent core changes are checked before UI integration.

Core additions now implemented and checked: explicit unmatched-versus-matched case projection/dispatch
(unmatched resolved challenges never inherit resolver case0), login-instance scoping for drafts/previews,
server-owned import previews, log-backed payment projections, submitted-hash routes and the nonvisual
durable transaction journal. The bounded integration run passed34/34 tests (preview12, journal16,
payments2, submissions2, unmatched1, appeal1); latest HTTP routes passed10/10. Build/typecheck pass.
The full combined redesign suite is still required after its finished handoff is integrated.

The delivered UI923f517 is now integrated with those newer authoritative interfaces; see
[UI_INTEGRATION](UI_INTEGRATION.md) for accepted files, deliberate adaptations and race/recovery fixes.
Remaining local work is completing the final combined verification and recording its results/commit.
External work remains persistent production auth/storage, staging RLS and
private-content mapping rehearsal, a fresh mainnet fork, dependency remediation and an explicitly
authorized rollout. Backend/financial behavior remains owned by the core implementation session.
