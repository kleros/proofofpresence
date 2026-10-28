# Core application integration checkpoint

## Current authoritative phase — 29October2026, Asia/Bangkok

Branch `codex/core-application`. The simpler UI and explicit v8 adapter are deployed at the
[public app](https://kleros-event-workbench-preview.netlify.app) against controlled Chiado10200
contracts. [V8_APP_RELEASE](V8_APP_RELEASE.md) and
[hosting evidence](../artifacts/testnet-hosting.json) identify exact current source/deployments.
The existing local v7 runtime remains compatible; historical v7 hosting sections below are archived.
Deployed combined application source: `f4643f8b3a2938d4cbcebe233e202656847a3084`; final Node221/221,
local inbox26/batch28, live main role226/owner inbox141 and independent observer209 passed.
Operator guard66715b4 and C read-only phase auditor0b62229 are separate local tools.
C real UI deposits42/registration39 and attendance33/challenge31/match31 are confirmed. Its
matched three-role83auth/read audit passed. C is unruled with local1/arbitrator1001; the SAME job
is ACTIVE05:02Bangkok30October after its actual challenge deadline04:59:50. A/B remains ACTIVE
00:20Bangkok30October, unchanged.

Public interfaces remain directory and event participant/organizer/cases routes; bootstrap/event reads,
signed wallet nonce authentication, private registration and approval, canonical receipt reconciliation,
trusted check-in and reviewed financial drafts. V8 adds payer-owned pending credit, independent
`withdrawPending(to,amountWei)`, factory/immutable provenance and isolated external-chain runtime.
[API](API.md) is the interface reference. Additional integrated v8 interfaces are owner-only
`deposit-inbox`/refresh and separate batch preview→commit→GET-status recovery. The portable source
is `1b0ea0e1f6c3638e848ba6c2c59494dc3ab1ecb0`; approval/check-in remain app curation and do not
automatically register stakers or publish monetary attendance. [API](API.md) is the interface reference. Chain balances, deadlines, cases and payment logs remain
financial authority; editorial/contact/door records do not imply monetary attendance or admission.

`hosted-testnet` has signed-wallet sessions, no synthetic identity picker or clock/faucet controls,
private manifest-bound `/data` persistence and an RPC proxy restricted to reads. Browser wallets
broadcast their own reviewed transactions to chain10200. Application state survived source/image
replacement with existing IDs and canonical receipt links preserved. The container initializes only
its fixed mount and drops to uid1000 before application import. Runtime immutable proof reuse checks
actual chain/code/factory/creation anchors every time; financial reads are fresh and pinned to one block.

Verified public sequence: deposits, excess-credit withdrawal, A/B admission, attendance, one Bob UI
challenge and organizer match. Bob is Disputed with resolver localID0 and arbitratorID1000; A remains
Listed, no ordinary payouts or held-share settlement yet. B's independent state is unchanged.
Public acceptance passed247 checks, then34 UI-challenge checks including exactly one broadcast.
See [dispute proof](../artifacts/chiado-dispute-proof.json) and [TEST_REPORT](TEST_REPORT.md).

The unchanged A/B challenge windows end30October00:18:00/00:18:15Bangkok. Existing user-approved
heartbeat `finish-kleros-testnet-kickbacks` runs00:20Bangkok daily (next30October) and must re-read
chain eligibility. It must snapshot ordinary payout with held share before ruling, final ruling
before settlement, and settlement/top-ups afterward. Finalized is only ordinary batch processed.
Never duplicate that operator/job, rebroadcast journaled hashes or reset deployed contracts.
Real Court follows a separate compatibility/funding review. No mainnet, real guest import, upstream
push or billing upgrade is authorized. Core integration remains owned here; UI changes stay isolated
until reviewed against these interfaces.

Separate fresh UI-deposit C uses its own child/manifest/site/service/volume; see
[TESTNET_UI_C](TESTNET_UI_C.md). Never merge it into A/B persisted state. Existing A/B historical
deposits are CLI-origin, while Bob's challenge was UI-origin.

## Historical v7 implementation and hosting

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
