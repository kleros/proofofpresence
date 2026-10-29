# Verification report

## Separate test15m profile and D tooling — 29October2026

New profile VERSION80015/chain10200/900-second challenge and matching periods is explicitly dispatched;
production v8 one-day source and historical v7 snapshots are unchanged. Build and typecheck passed.
The loopback-enabled full Node run passed **251/251**, zero failures/skips/cancels,616.71seconds:
`artifacts/fast15m-npm-test.log`. The first sandbox run's loopback binding failures are retained at
`artifacts/fast15m-npm-test-sandbox.log`; they were not treated as successful execution or code defects.
`artifacts/fast15m-validation.json` records actual commands, results, source fingerprints and limits.

Focused final D tooling rerun passed8/8 after its last nonce/balance/prepare-cap hardening, including
real local10200 factory/child creation and receipt-only resume,900-second boundaries, ordinary
Alice paid/Bob held, ruling1 and actual same-Bob attendance payout plus separate collateral. It did
not use public D or real UI initiation. New backend7/7, legacy adapter/runtime9/9 and tooling10/10,
contract source/economics9/9, UI13 plus v7 browser49/v8 browser18/journal4, observer6/6, and final
UI-signing budget1/1 passed in separate runs. Counts are not added as new public transactions.
The full run may have loaded earlier D-only helper versions; focused final reruns cover those changes.
D financial pure guards22accepted/117rejected and status guards18/117 passed with zero access/signing.
The separately added `node --test test/test15m-app.test.mjs` passed1/1 in18.66seconds after the
full suite had enumerated its files. It uses a real synthetic10200 chain and CA-pinned local HTTPS
backend, signed HTTP sessions and seven reviewed Node-wallet transactions: credit recovery without
a contact record, canonical deposits, separate batch approval/registration, excess recovery to a
different destination preserving admitted principal, private owner inbox, static helper/policy200,
immutable deposit closure and actual posting/challenge block timestamps plus900seconds. Normal
v8/v7 controls stayed unchanged. This is local HTTP execution, not public UI-origin proof.

The exact immutable D plan/public policy and budget passed independent read-only review. At that
prepared-plan checkpoint, D funding, deployment and public UI execution were still pending; the later
live checkpoint below supersedes that status. The first
too-low1000wei preparation cap stopped before creating keys/plan/journal; the reviewed replacement
250000wei cap fits the existing operator priority-fee policy and protects A/B+C reserves. See
`artifacts/ui-d-preparation-stopped.json`, `ui-d-preparation.json`, `ui-d-plan-independent.json` and
`ui-d-policy-independent.json`. Existing A/B/C source preservation passed142 Git blob checks;
their reviewed operator source shares the canonical journals/lock/proof directory and schedules.

## D live hosting, deposits and admission — 29October2026,03:27UTC checkpoint

[D hosting evidence](../artifacts/ui-d-hosting.json) records successful Railway Linux deployment
`aef2933b-e7bf-4c05-855c-b39b77a96c7b` from backend source
`67ee1d9bfac68f6925ca5dff638b07b5e56b5eae`, runtime uid1000 and durable `/data` storage.
Netlify deploy `6ae2a28034076e4185468d63` serves frontend source
`7bdd40a3478e487f84b0c00aa0d58e25d13e0d5e` at the separate
[D application](https://kleros-fast15m-d-20261029-9fe71683.netlify.app).
These hosting records do not establish financial completion or change A/B/C hosting.

`node --test test/revise-ui-d-plan.test.mjs` passed **4/4** with temporary files and an injected
read-only verifier. It tests only-three-time-field changes, raw original/transaction-entry preservation,
idempotency after a later child, and fail-closed partial-pair recovery. It does not establish public
chain execution. The separate [applied revision proof](../artifacts/ui-d-start-revision-applied.json)
records the reviewed pre-child metadata revision, four retained setup hashes and zero signing-file
reads/signatures/broadcasts. The revised start03:30UTC/10:30Bangkok was used for the first actual child
creation `0x3c33411d377bec442f8e4831c8465f7d92f02966289fbae212807fb4de59507c`, block23740043;
no setup transaction was replayed. The deployed child terms are now immutable.

| Actual D stage/check | Result and distinct evidence |
|---|---|
| Financial UI `--stage deposits` | **42 checks passed**; two real synthetic registration forms, two nonce logins, two exact1e12wei deposit reviews, two wallet submissions/broadcasts and canonical UI receipt reconciliation. [Immutable UI proof](../artifacts/ui-d/deposits-2026-10-29T03-07-36.775Z-4b5ede2e/proof.json). |
| Financial UI `--stage admit` | **43 checks passed**; host approval through the actual UI, followed by one reviewed `registerStakers([Alice,Bob])` wallet submission/broadcast. [Immutable admission proof](../artifacts/ui-d/admit-2026-10-29T03-17-58.585Z-b7229940/proof.json). |
| Independent admitted observer | **131 checks passed**, anonymous GET/read RPC only, zero signatures/broadcasts. [Canonical API/chain proof](../artifacts/chiado-ui-d-flow-audit/2026-10-29T03-26-46-901Z-c0e4fb87-26b9-4fec-9040-6bce596eb75f.json). This observer does not establish UI initiation. |

The actual UI-origin deposit hashes are Alice
`0xe3b10808d5060b3ef2b6c5f6ccba1c81d3ebee041c5059c27f96f29eac21d682` (block23740304) and Bob
`0xde29bf8ffa52d94ed551a1b9cf2f65edfec933ffcf4e3220cd3bf92eb61f29eb` (block23740332).
The separate admission transaction is
`0x8376920fd03eb0c2cc8a34bcc25f0d79b9be11f7ce9746c4455cbf59e400e56d` (block23740440).
Each UI operation and both completed stages verified immediate A/B/C financial state unchanged.
Counts include repeated source/provenance guards, not42 or43 financial transactions.

At canonical block23740491, the admitted observer found D **Open**, Alice/Bob registered, pool/balance/
reserves2e12wei, pending credit0, attendees0, cases0, held0, owed0 and attendance payments0.
These are deposit/admission results. **No D kickback, controlled ruling or settlement has occurred
at this checkpoint.** The nonce-only admitted role audit and subsequent attendance/challenge/match
stages require their own passed proofs; later ordinary/ruled/settled UI and canonical audits remain
mandatory before financial completion can be claimed. See [D runbook](TESTNET_UI_D.md).

## Public Chiado v8 acceptance — 29October2026, Asia/Bangkok

The current hosted app uses real chain10200, unchanged v8 bytecode and controlled V1 mocks.

| Executed check | Actual result |
|---|---|
| Latest complete `npm test` | **221/221 passed**,618.65seconds; `artifacts/combined-final-node-tests.log`. This includes the final batch status/journal/selection and C tooling/resumed-funding guards. |
| Profile-free recovery regression | **1/1 passed** with real local HTTP nonce auth, plain transfer, different payout destination, stable detail/draft fingerprint, no contact record and unchanged committed principal/B state. |
| Status/browser guards on recovery release | Build/types passed; GET-only status10, v7 redesign49 and v8 simplified18 passed. These are local rendering/regression checks. |
| Wallet/API/UI acceptance `test/testnet-live.e2e.mjs` | **247 checks** plus browser expectations passed; fully loaded desktop/mobile screenshots. No contract transaction signed by this harness; canonical existing receipts linked. |
| UI challenge `test/testnet-ui-challenge.e2e.mjs` | **34 checks** plus expectations passed; exactly one Bob wallet submission/broadcast, successful canonical challenge, B unchanged. Local guard self-test19 checks. |
| Public protocol checkpoint | **21 canonical successful transactions**,7 deployment +14 rehearsal, through attendance/challenge/match. Bob Disputed, localID0/arbitratorID1000, unruled; independent B unchanged. |
| App bridge focused tests | **6/6 passed**, including stable per-wallet observation binding, endpoint restrictions, preserved records and full financial comparison. |
| External adapter/runtime regression | **9/9 passed** after immutable-anchor reuse and pinned-block parallel reads; actual code/chain/reorg/manifest tampering and fresh mutable values checked. |
| v8 app integration | Actual local credit recovery, mixed deposit admission, trusted attendance, matched case, ordinary held share, late win/full kickbacks and B isolation passed. |
| Durable state across deployed image replacement | Existing Alice A/B registration IDs and canonical receipt links preserved; after/before artifacts retained. |

Public proofs: [UI challenge](../artifacts/testnet-ui-challenge.json),
[match/full A-B state](../artifacts/chiado-dispute-proof.json),
[attendance](../artifacts/chiado-attendance-proof.json), [app sync](../artifacts/chiado-app-sync-proof.json)
and [hosting](../artifacts/testnet-hosting.json). Local browser counts below are separate validation,
not additional public financial operations. Earlier failed harness-only attempts stopped before signing.

Public ordinary payout, final ruling/held-share settlement and top-ups remain **pending** the unchanged
challenge deadline. A ends29October17:18:00Z; B17:18:15Z (30October00:18Bangkok). Existing user-approved
heartbeat00:20Bangkok must capture UI-versus-chain snapshots after ordinary payout, final ruling before
settlement, and settlement/top-ups. Controlled mocks do not prove an independent jury process;
real Court is a separate phase. No mainnet, real guest data or upstream push occurred.

Fresh read-only eligibility checkpoint at29October07:49Bangkok:
[canonical snapshot](../artifacts/testnet-eligibility-20261029T0047.json), block23738775,
timestamp2026-10-29T00:49:00Z. A/B/C are Listed and not yet eligible; both matched cases remain
unruled, C IDs1/1001, C balance2.03e12wei and held/owed/payoutShare0. Zero signing-file reads,
signatures or broadcasts. The initial diagnostic stopped on a positional ABI decoding assumption;
the corrected successful diagnostic used the existing named-field case guard. This is not a new
UI/financial-stage proof or full regression run. Independent read-only automation audit passed:
exactly two ACTIVE jobs, unchanged root target/times, A/B failure-only notifications, C normal
notifications and a read-only combined-completion barrier that prohibits replay or A/B operation.

## Contract inbox and separate batch actions — combined local verification

The portable UI source is `1b0ea0e1f6c3638e848ba6c2c59494dc3ab1ecb0`. Its five assets were
integrated into the current controller rather than replacing that controller. Integrated/source
hashes are recorded in `artifacts/portable-batch-assets-sha.json`.

| Executed check | Result and scope |
|---|---|
| Inbox financial/privacy suite |18 focused tests and14 final tests passed; local canonical payer credits, wrapper receipts, returns, owed/held amounts, current-owner privacy, reorg and timeout handling. |
| Inbox integrated browser |26 checks passed with real local crypto auth/HTTP and chain data. |
| Separate batch integrated browser |28 checks passed: exact selected registration, blocked unknown/returned rows, owner/staff scope, free check-in, lost commit response and full reload GET-only reconciliation, no financial changes. |
| Batch status/recovery focused |7 added status tests passed; terminal expired previews cannot be revived and post-auth completion races are covered. Earlier14 batch tests also passed. |
| Durable batch journal |4 tests passed; fail-closed storage, no contacts, preserved external-chain intent across instance changes, isolated local instances. |
| Selected on-chain registration |1 actual local v8 test passed: an unselected returned receipt does not block the explicitly selected valid payer; duplicate/invalid selection stops. |
| C foundation/operator |6 tests passed across focused suites (foundation4/4 and operator2/2), on isolated local10200: one-child/four-operation recovery, dynamic case targeting, attended winner payment and separate collateral proof. |
| C browser pure guards |20 accepted/109 rejected; no actual public browser transaction is claimed by this self-test. |
| Regression/build |v7 redesign49, v8 simplified18, build/pinned v7 and v8 equality/typecheck passed. |
| Recovered A/B public role audit |202 checks passed with8 fully loaded screenshots,3 nonce-auth signatures and zero financial signatures/broadcasts. Independent observer208 comparisons passed on the recovery release; combined f4643f8 rollout observer209 and fully loaded role audit226 passed (3nonceauth/0financial). |

The final full Node221-test run includes the status retirement/race, browser journal, selected
registration and C tooling/resumed-funding changes. Final typecheck also passed. Public C UI
execution was pending at that foundation checkpoint; the later C sections record actual canonical
browser-origin deposits, registration and matched dispute. The first A/B deposits
were CLI-origin; their browser receipt linkage is not labeled UI initiation. Luma remains deferred.

## Simplified v8 application and testnet integration — latest phase

Build/typecheck passed. The full Node run executed164 tests (163 passed, one hosted capabilities
shape assertion failed). The capability response was restored to its compatibility shape; the
focused hosted/runtime/tooling rerun passed19/19, including three new real-HTTPS external-chain
runtime tests. A later fee-oracle spike guard passed10/10 tooling tests. Logs:
`artifacts/simple-v8-full-verification.log`, `artifacts/simple-v8-targeted-verification.log` and
`artifacts/testnet-config-tests.log`. No financial contract source changed during these fixes.

The combined browser run passed39 lifecycle,49 redesign,16 signing safety,4 session/context,35 hosted
HTTPS,13 simplified v7 and18 simplified v8 checks: **174** plus Playwright expectations. A new v8 app
integration test also passed actual credit recovery, returned receipt rejection, payer credits combined
into admission, excess withdrawal preserving principal, trusted check-in, matched challenge, ordinary
payouts with one reserved share, late winning settlement/full kickbacks and independent Event B.
A presentation fixture is not public execution evidence. Public receipt/hosting records are maintained
separately in the Chiado registry and release/deployment artifacts after their actual checks.


## v8 stress campaign — 28 October 2026

The final `npm run stress:contracts` run **passed all four campaigns** in 222.97 seconds after
compilation. [Detailed report](CONTRACT_STRESS_TEST.md) and [machine summary](../artifacts/v8-stress-verification.json)
record seeds, workload, limitations, source/artifact hashes and evidence paths. The final run is
`2026-10-28T15-42-17-430Z-b75884be`; raw logs/metrics are retained under its ignored
`artifacts/stress/` directory. Source and used artifact fingerprints remained unchanged before/after.
Both production v8 contract hashes still match the earlier reviewed candidate; historical v7 is unchanged.

| Fresh command/check | Actual result |
|---|---|
| `npm run stress:contracts` | All four campaigns passed; 6,951 counted transactions in ledger/settlement/capacity, plus hostile-campaign activity. |
| Credit/admission model | 32 seeds, 2,048 generated/2,998 total actions, 2,241 mined transactions, 3,030 model snapshots, 55,098 assertions. |
| Settlement model | 64 scenarios, 32 paired seeds, 2,216 transactions, 71,479 assertions; exact custody/log/recipient reconciliation. |
| Capacity/factory | 2,494 transactions; 512 readmissions, 150 lifetime admissions, 149 simultaneous matched disputes, 32 factory events. |
| Hostile callbacks/fee changes | 187/187 callbacks blocked over 170 vectors; 35 mined atomic low-gas reverts and 11 complete payouts; 21 fee scenarios. |
| `npm run build` / `npm run typecheck` | Passed; pinned v7 equality and the separate v8 build retained. |
| `npm run test:contracts:v8` | **23/23 passed**, 28.59 seconds. |
| Deliberate invalid `V8_STRESS_SUITES` | Expected exit 1; failed preflight manifest/latest pointer recorded instead of stale success. |

No new contract defect was confirmed or contract source fix made. The documented direct batch with
149 expired unmatched gas-burning recipients exceeded 16,777,216 gas and reverted atomically.
149 individual permissionless resolutions (maximum 200,104 gas each), then a 10,911,405-gas payout,
completed while preserving pending/owed/reserved accounting. Worst hostile cancellation after
readmissions used 12,624,024 gas; worst late-case settlement 9,826,902; maximum valid factory payload
8,057,990. These successful paths retain a tested 30% allowance within the cap.

Independent review strengthened the test harness to count every callback (including two payments
in one settlement), require actual mined failure receipts, distinguish recipient/returndata cases,
and fingerprint artifacts as well as sources. The final combined run used those corrections.
Earlier exploratory/superseded runs are excluded from the reported final workload.

All chains/accounts were synthetic and in-process. Court adjudication was mocked. Synthetic
recipient-code replacement and balance injection are explicit fixtures. No mainnet fork, real Court
case, live transaction, external deployment, formal proof or professional audit occurred. Browser and
full root suites were not rerun in this test-only round; prior results below are historical evidence.
Fresh logs are `artifacts/v8-stress-final-run.log`, `v8-stress-build.log`, `v8-stress-typecheck.log`
and `v8-stress-regression.log`; raw per-suite logs are in the final run directory.

## New v8 factory and hardened event contracts — 28 October 2026

After the user confirmed the hardened option, separate [factory/event contracts](EVENT_FACTORY_V8.md)
were implemented. These results execute v8 custody and factory deployment locally; Court/resolver
adjudication uses explicit mocks. Existing UI/registry events continue using historical v7.

| Command actually executed | Actual result |
|---|---|
| `npm run build` | Passed; original v7 compilation and pinned equality retained. |
| `npm run typecheck` | Passed, including the explicit v8 helper module. |
| `node scripts/compile-contracts.mjs` / `npm run compile:v8` | Passed with isolated solc 0.8.38, optimizer 200, Paris; child/factory size checks passed. |
| `node --test test/event-v8.test.mjs` | **14/14 passed**, 25.1 seconds. |
| `node --test test/event-factory.test.mjs` | **5/5 passed** on final source. |
| `node --test test/event-v8-arbitration.test.mjs` | **4/4 passed**, 2.61 seconds. |
| `npm test` after adding v8 | **149/149 passed**, 452.8 seconds, including the 23 new v8/factory cases and five v7 characterizations. |
| `npm run test:browser` | **39 assertions passed**, plus UI interaction checks, after new contracts/dependencies were added. |

The focused suites total 23 tests. Child tests cover per-wallet reserves, phantom admission refusal,
pending withdrawals in every relevant phase, atomic credit consumption, refunds/readmission,
deadlines, invalid arbitrator, callback reentrancy, finality protection, evidence snapshots, four
seeded held-share outcomes/orders, and maximum capacity/metadata. Factory tests execute two event
deployments with different owners/terms, a common participant and independent settlement while one
has an open case. They also verify caller ownership, domain-separated keys, copied-key isolation,
constructor-failure rollback, configuration hashes and exact immutable child code. Arbitration tests
verify delivery/finality, both-funded and one-sided appeals, direct contributor rewards/refunds,
ruling-0 odd-wei splitting with pending reserves, cancellation and failed-payment claim reentrancy.

Measured gas: 150 failing-recipient payout **12,611,013**; 149 recipients plus open case
**12,576,884**; lost-case redistribution **9,188,135**; maximum 32-slot/12,288-byte encoded template
match **1,725,263**. Each retains a 30% allowance below 16,777,216. Recipient-failure tests explicitly
use synthetic account-code replacement after each payer funds its own credit, with snapshot/code
cleanup. The 150 bound is unique lifetime admissions, including refunded admissions; readmissions
never grow history. Expired unmatched challenges can be settled individually before large batches.

The v8 runtime/creation sizes are 21,206/24,258 bytes; factory runtime/creation 2,803/27,944 bytes.
Generated artifacts, settings and hashes are in `build/contracts/`. The production workbench build
retains its v7-only compiler path; the new compiler alias is a separate development dependency.
Logs: `artifacts/event-factory-build.log`, `event-factory-typecheck.log`, `event-v8-tests.log`,
`event-factory-tests.log`, `event-v8-arbitration-tests.log`, `event-factory-root-tests.log`,
`event-factory-browser.log`. The final template-helper check additionally compares the on-chain CID
with an independent JavaScript UnixFS calculation. [Verification summary](../artifacts/event-factory-verification.json)
records source hashes and actual results.

No new external deployment, mainnet transaction, live Court interaction, policy publication or
upstream push occurred. No mainnet fork, formal equivalence proof or professional audit is claimed.
Permissionless creation does not vet the event creator's attendance list, policy or arbitration provider.

## Smart contract security review — 28 October 2026

The bounded [security review](SMART_CONTRACT_SECURITY_REVIEW.md) preserves historical v7 and adds
[five characterization tests](../test/contract-security.test.mjs). They deliberately reproduce
unfixed trust/recovery/capacity limits; their passing result is not a remediation claim.

| Command executed during this review | Actual result |
|---|---|
| `npm run build` | Passed; pinned historical ABI/creation bytecode equality retained. |
| `npm run typecheck` | Passed. |
| `node --test test/contract-security.test.mjs` | **5/5 passed**, 8.35 seconds; in-process synthetic Ganache. |
| `npm run test:contracts` | **54/54 passed**, 324.5 seconds: 36 contract scenarios, 11 CLI integrations, 7 provenance checks. |
| `npm test` before v8 was added | **126/126 passed**, 418.1 seconds, including five v7 characterization tests. |
| `npm run test:browser` | **39 assertions passed**, plus UI wait/interaction checks. |

Logs: `artifacts/contract-security-build.log`, `contract-security-typecheck.log`,
`contract-security-probes.log`, `contract-security-baseline.log`, `contract-security-browser.log`.
[Compatibility evidence](../artifacts/contract-security-compatibility.json) also confirms source
equality with saved deployment input and recompilation of that input to the pinned creation bytecode.
The capacity fixture's 240 gas-consuming attendees require 20,123,447 gas; it first verifies atomic
failure at 16,777,216, then measures the successful oversized call on local Shanghai Ganache only.

The first retained-suite attempt failed because the sandbox disallowed loopback binding; its
`contract-security-baseline-sandbox-failed.log` is retained. The approved localhost-only retry passed.
Ganache used native-module JavaScript fallbacks and emitted a listener warning; no test failed on
the successful run. No current mainnet fork, live deployment/state inspection, formal proof or
fuzz campaign was performed. These earlier results cover v7; the subsequent approved v8 implementation
and its separate verification are recorded above.

## Earlier integrated verification

Verified locally on 28 October 2026 at integrated source commit
`52b66cc5687936cbdbb2eed3578105bb5b215d2d`, branch `codex/core-application`.
The delivered UI source was `923f517fccdd0bddefbd9acaf5454309ee6c9ecf`; its compatible changes were
integrated against the newer core, with the adaptations in [UI_INTEGRATION](UI_INTEGRATION.md).

Tests use synthetic contacts/wallets and localhost Ganache. No production transactions, real Court
cases, guest submissions, emails, live database migrations, public IPFS writes or upstream pushes
were performed. Node25.8.1/npm11.11.0 were observed on macOS arm64. Ganache used JavaScript fallbacks
for unavailable native bindings. Those warnings did not prevent the passing runs below.

## Final combined application checks

`npm run verify` completed with exit0 on the integrated source. Its complete output is preserved in
[`artifacts/final-verification.log`](../artifacts/final-verification.log).

| Check executed by `verify` | Result |
|---|---|
| `npm run build` | Passed: original v7 compilation, pinned ABI/bytecode equality and application syntax checks. |
| `npm run typecheck` | Passed for the checked JavaScript and TypeScript interfaces. |
| `npm test` | **91/91 passed**, zero skipped/failed, 370.2 seconds. |
| `npm run test:browser` | **39 assertions passed**, plus browser wait/interaction checks. |
| `npm run test:ui` | **49 assertions passed**, plus Playwright expectations. |
| `npm run test:ui:safety` | **16 assertions passed**, plus Playwright expectations; no wallet transaction broadcast. |
| `npm run test:ui:context` | **4 assertions passed**, plus Playwright expectations. |

The four browser suites total108 explicit assertions, plus their interaction/expectation checks.
The main desktop/mobile images are `artifacts/demo-desktop.png` and `artifacts/demo-mobile.png`.
Additional local viewport screenshots are under ignored `artifacts/screenshots/ui-redesign/`.
The core owner visually inspected the integrated desktop participant and mobile organizer views;
the UI suite also checks 400px mobile, desktop, keyboard/dialog behavior and enlarged text.

The Node and lifecycle browser tests execute unchanged v7 bytecode and inspect actual successful or
reverted local receipts, state, payment logs and ETH balances. V1 mocks supply adjudication only.
The tests cover:

- Two deployments with distinct owners, deposits, schedules and pools; one wallet participates in both.
- Event roles, private/draft recovery access, two-step financial ownership and authenticated staff scope.
- Canonical receipts, wrong deployment/amount/time/sender, duplicates, principal/stray return pairing,
  unmatched deposits, fresh readmission and separate admission/registration.
- Server-owned import previews, exact-byte source hashes, expiry/session/revision binding, atomic
  commit, duplicate evidence and known event/chain/contract/participant mismatch rejection. Unknown
  raw CSV origin remains an explicit organizer trust assumption.
- Personal attendance, merch and consent having no financial authority.
- Normal payouts with open cases and held reserves; late losses/top-ups, late winners, both settlement
  orders, ruling0/1/2 and independent EventB progression. Tested equal-entitlement fixtures use exact
  divisibility; retained contract tests additionally cover rounding and reserve accounting.
- Unmatched challenges using their own matching period without borrowing resolver case0; correct
  resolver-local versus arbitrator IDs, evidence, appeal funding/rewards and finality/override behavior.
- Cancellation, no-list emergency withdrawal, duplicate recovery refusal, failed recipients and
  alternate-destination owed claims.
- Exact expiring transaction reviews, one-use execution, stale context rejection, canonical submission
  confirmation, durable hash journaling, terminal reverts and factual receipt recovery after re-login
  or review expiry. Recovery never restores old signing authority or automatically rebroadcasts.
- Delayed event responses and captured transaction callbacks preserving the newly selected event;
  failed storage probes stopping new wallet prompts, and post-submission errors preserving the hash.
- Exact-byte local evidence publication/retry and per-event policy/participant aliases.

These results supersede the earlier37-test core checkpoint and bounded integration runs. Earlier
failures were reproduced, fixed and covered in the final run; they are not outstanding failures.
Ganache emitted a MaxListenersExceededWarning while many independent events were deployed. The
finite checks passed; this does not certify unbounded production process resource behavior.

## Reproducible setup and retained Kickback compatibility

A fresh `git archive` of integrated commit52b66cc in
`/private/tmp/kleros-integrated-clean.tXU1Ra` passed `npm ci --ignore-scripts --offline --no-audit --no-fund`,
`npm run build` and `npm run typecheck`. It installed363 packages with only root dependencies; no
nested reference node_modules, user handoff directory or machine-global JavaScript packages were copied.

The earlier clean `/private/tmp/kleros-clean.6VRQLU` copy also passed installation/build/typecheck and
the complete retained compatibility suites using root-installed ethers6.16.0/Playwright1.58.2:

| Executed in the clean copy | Result |
|---|---|
| `npm --prefix references/kickback test` | **54/54 passed**: contract, script and provenance checks; 253.4 seconds. |
| `npm --prefix references/kickback run test:site` | **180/180 passed**. |
| `npm --prefix references/kickback run test:console` | **159/159 passed**. |

The initial clean contract run exposed a sequential nonce-cache failure (53/54). NonceManager fixed
the failing sequence (targeted2/2), then the complete suite passed54/54. The initial clean console
attempt exposed a nested ethers UMD path assumption and stopped before financial actions; resolving
the package from the root dependency tree fixed it. Final logs are `/private/tmp/kleros-clean-contracts-final.log`,
`/private/tmp/kleros-clean-site.log` and `/private/tmp/kleros-clean-console.log`.

The deployed Solidity, historical policy/template, deployment records and verification inputs remain
preserved. Compiler output must match the pinned v7 artifact. No fresh mainnet-fork execution or
current live deployment verification is claimed.

## Retained content and booth modules

`references/events` retains source base `fa732b8ea20e57648516b6e46e1076c0bf2ab434`. All14 migrations
were read in order and effective final policies inspected; see [EVENTS_AUDIT](EVENTS_AUDIT.md).

| Command in `references/events` | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000` | Passed;80 packages installed. |
| `npm run typecheck` | Passed. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` with backend/AI environment unset | Passed after network access for declared Google Fonts; no backend credentials used. The sandbox-only attempt first failed DNS. |
| `npm run lint` | Failed: interactive ESLint setup, no declared ESLint dependency/config. This retained module has no reproducible lint gate. |

No Supabase CLI/disposable database was available; migrations and live RLS/storage/auth behavior were
not executed. Existing private-event/material/assistant controls remain in the linked module. That
limitation is separate from passing workbench role/privacy tests.

The booth remains unchanged and outside finance. Three VM tests execute legacy queue/tier functions
with fake fetch and synthetic payloads. They reproduce demo-origin queues flushing after a config
switch and promotional client reports affecting merch progression. These are retained legacy defects,
not fixes. The financial application never loads those queues or uses merch/newsletter state for payouts.

## Operational limits

This is a loopback local demo with ephemeral chain and projections, explicit identity impersonation
or verified EOA nonce linkage, and mock Court adjudication. General smart-wallet/UserOperation identity,
production auth/persistence, staging content RLS/migrations, public IPFS publishing and a fresh mainnet
fork remain external work. Dependency audit advisories remain in the development stack. No remote
CI or production rollout has been run. Follow [RUNBOOK](RUNBOOK.md) for the next authorized phase.

## Historical Netlify read-only preview

Following the user's online-viewing request, separate source commit
`8e1c59e1058e844e18fe15d66c29e62131a492b5` added a static preview without changing the core backend.
`npm run build:netlify` passed compilation/pinned-artifact checks and verified actual synthetic local
receipts before snapshot capture. Root typecheck passed. `npm run test:netlify` passed **34 assertions**
plus Playwright expectations locally, and the same command with `NETLIFY_PREVIEW_URL` passed **34**
against the published HTTPS site. No API/RPC/external-service or wallet request was attempted.
Visual inspection verified desktop/mobile notice placement and corrected an initial mobile-header
height issue, with3 regression assertions added to the original31-check preview suite.

Netlify reported deploy `6ae2003e06e5123259e8297c` ready. Page/snapshot requests returned200,
the captured bytes matched the local artifact exactly, and CSP/`nosniff` headers were present.
This historical **read-only viewing preview** was subsequently replaced at the primary URL by the
interactive demo below; its immutable deploy remains available as rollback. It is not a financial
production rollout. [NETLIFY_DEPLOYMENT](NETLIFY_DEPLOYMENT.md) records the URL,
source/deploy IDs, commands and limitations.

## Full interactive hosting: local and live evidence

After the user selected full interaction, explicit hosted mode, a Netlify gateway, secure sessions,
public-domain nonce auth, constrained signed RPC and unique-instance wallet checks were implemented.
The complete new verification passed build/typecheck, **121/121 Node tests** (zero failures/skips),
and browser suites with39 lifecycle,49 redesign,16 safety,4 context and35 hosted HTTPS assertions,
for **143 assertions** plus Playwright interactions/expectations. The Node run took384.1seconds.
`artifacts/hosted-full-verification.log` preserves the output. Financial domain/contract sources remain unchanged.

Focused checks include7 hosted server,19 gateway and4 wallet-instance tests. The35-check hosted browser
suite uses a real temporary local HTTPS frontend→real gateway→real backend, Secure cookies, actual
A/B deposits and isolated registration, RPC/Origin guards, advanced financial pages and mobile layout.
The gateway bundles with official Netlify CLI27.15.0. A clean closed package with only production
dependencies passed install/build and guest/console/settings smoke checks. Actual Railway Linux
build/deployment `2186138d-9268-4ec8-8ab9-575c76067ca7` subsequently succeeded with Node22, production-only
install and pinned v7 ABI/bytecode equality. A missing optional flag on Ganache's nested macOS-only
fsevents lock entry was corrected without changing versions. The healthy service has one replica
and sleeping disabled.

Netlify deploy `6ae2154852ea8b5634d56e84` is ready at the public URL. The deployed backend/frontend
source is immutable v7 commit `371b4c80b0c65ce7b7f571ca41d9f85c8720660b`, excluding concurrent v8 work.
`HOSTED_DEMO_URL=https://kleros-event-workbench-preview.netlify.app node test/hosted-live.e2e.mjs`
passed **370 live acceptance checks**, recording five actual synthetic chain1337 transaction hashes.
Coverage includes browser A/B deposits, owner A admission/registration with B unchanged, cross-event
403, Secure/HttpOnly sessions, public-domain nonce proof, an independent memory-only EOA's signed
RPC deposit and canonical reconciliation, instance guards, loaded assets and mobile bounds. No external
requests, browser runtime errors, state reset, automatic rebroadcast or persisted private keys occurred.
A normal browser extension was not used; full arbitration and payout flows retain prior local evidence.

Final read-only readiness checks confirmed backend health200, unkeyed API403, public bootstrap200,
mode hosted-demo, chain1337 and the same instance as live acceptance. Public artifacts are
`artifacts/hosted-live-verification.json`, `artifacts/hosted-readiness.json` and
`artifacts/hosted-deployment.json`. [HOSTED_DEPLOYMENT](HOSTED_DEPLOYMENT.md) records operations and limits.
This is a shared synthetic demo with valueless ETH, mock Court and restart resets, not a production rollout.


## C HTML source guard correction

Operator-only commit66715b4 followed the221-test application run. Its pure guards passed22 accepted/117 rejected.
The exact non-executable C-site hosting comment is excluded only from hash comparison; all other
HTML/script/style bytes must match and the actual published response reaches the browser unchanged.
A GET-only anonymous browser probe passed18 requests/15 verified assets with zero auth/signatures/
broadcasts. No application/frontend/backend change was needed. The first pre-auth stopped attempt is
archived and does not count as a deposit; public C receipts are recorded separately once reconciled.


## Actual isolated C UI deposits

Public sourcef4643f8/operator66715b4 passed42 checks with exactly2 nonce logins,2 wallet submissions
and2 canonical broadcasts. Both synthetic registrations, financial reviews and receipt reconciliation
used the real UI. Alice hash0x78763b7529bb0a37d6d3f363c4ec74286b2e94ede6539c16f963292c3c630d91,
Bob0x18c491e15bf50d8b10ba2f1b50fdf0dc36e3076bcd611e5ce9b4e345c7a38425.
Separate immutable per-operation proofs and actual review/confirmed screenshots are under
`artifacts/ui-c/deposits-2026-10-28T20-14-09.270Z-9dcf605b/`. Both have independent canonical
receipt acceptance; the C observer passed90 with pending2D/reserved2D/balance2D, pool0, stakers0
and no cases at the post-deposit checkpoint. C UI admission/registration subsequently passed39 checks with one canonical UI registration; attendance,
dispute, ordinary held-share batch, controlled ruling1 and same-Bob kickback remain future steps.
A/B financial facts were unchanged across each C operation and the complete C deposit stage.

The combined main owner-only inbox also passed141 public read-only checks,2 nonce logins and zero
financial signatures/broadcasts: exact canonical A payer rows, indexed financial amounts, historical
Alice2D deposit/currentD principal/actualD unused-credit return kept separate, role/privacy401/403,
participant UI hidden and no record writes. Its contact-masked screenshots/public proof are in
`artifacts/testnet-inbox-readonly/2026-10-28T20-17-57-634Z-f934db38/`. All actual A payers were
already linked; unknown-payer behavior remains local-test coverage.


## Final admitted C role readiness

Source0b62229 passed the strengthened actual three-role audit:83 auth/read requests,3 nonce
logins,6 desktop screenshots, zero financial signatures/broadcasts, failures[].
[Latest pointer](../artifacts/ui-c-status-admitted.json) binds the immutable proof/sourceSHA.
Visible admission, exact D receipt, contract registration, zero unused credit and no extra
deposit/credit withdrawal were verified for both actual depositors. No attendance, case or payout
was invented; normal release is disabled and there is no case to settle. Future matched/ordinary/
ruled/settled guards check dynamic IDs, held/owed/sent categories, finality and actual action states.
Pure guards18 accepted/117 rejected passed. The earlier admitted audit used80 auth/read requests;
its separate original proof remains archived and is superseded by this strengthened readiness.

Both local heartbeat jobs were verified ACTIVE in the root chat: C at29October04:50Bangkok for
attendance/dispute steps, and original A/B at30October00:20Bangkok for eligible payout stages.
C will reschedule the SAME job after its ACTUAL posted attendance challenge deadline. Source
f4643f8 remains deployed; these observer-only changes require no app redeployment. Full public
controlled kickbacks/settlement and later real Court remain outstanding, with actual gates recorded.


## Scheduled C attendance/dispute run — 29October2026, Asia/Bangkok

No application/contract/operator source changed and no prior transaction was replayed. The unchanged
financial guards22accepted/117rejected and status guards18accepted/117rejected passed before action.
Fresh admitted C observer93 and all seven prior canonical receipts/proof bindings passed first.

| Actual command/stage | Result |
|---|---|
| C financial UI `--stage attendance` |33checks passed, Alice-only trusted check-in and one canonical postAttendance broadcast; A/B unchanged. |
| C observer after attendance |96passed; actual posted challenge deadline1793311190 =30October04:59:50Bangkok. |
| C financial UI `--stage challenge` |31checks passed, exactly one Bob challenge broadcast/30e9; A/B unchanged. |
| C observer after challenge |110passed; Waiting has null Court IDs/period/finality/appeal, escrow30e9, no inherited A0/1000. |
| C financial UI `--stage match` |31checks passed, exactly one owner matching broadcast; receipt/mapping dynamically identify local1/arbitrator1001; A/B unchanged. |
| C observer after matching |115passed; Listed, Alice-only, Bob Disputed/unruled, balance/reserved2D+30e9, held/owed/paid0. |
| C status `--phase matched` |83auth/read requests,3nonce logins,6desktop captures,0financial signatures/broadcasts, no failures. Exact current auditorSHA and immutable proof verified. |

[Attendance](../artifacts/ui-c-attendance.json), [challenge](../artifacts/ui-c-challenge.json),
[match](../artifacts/ui-c-match.json) and [matched role](../artifacts/ui-c-status-matched.json) summaries
bind unique actual browser/receipt proofs. Counts include repeated source/provenance/transport guards;
they are not distinct financial workflows. Exactly three new financial transactions occurred.
Existing sourcef4643f8/Linux/build/typecheck/221Node results remain the application regression evidence;
this clocked, unchanged-source run did not rerun that entire suite. C actual captures remain desktop.

The same C automation is ACTIVE30October05:02Bangkok, 130seconds after the ACTUAL challenge deadline;
A/B's00:20job/config file remained byte-for-byte unchanged. No C payout/ruling/settlement has occurred.
Future ordinary/ruled/settled UI and canonical audits must pass before dependent financial actions.
