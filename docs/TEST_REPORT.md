# Verification report

## Public Chiado v8 acceptance — 29October2026, Asia/Bangkok

The current hosted app uses real chain10200, unchanged v8 bytecode and controlled V1 mocks.

| Executed check | Actual result |
|---|---|
| Latest complete `npm test` | **206/206 passed**,555.8seconds; `artifacts/combined-inbox-batch-node-tests.log`. Later focused additions listed below were verified separately. |
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
| C foundation/operator |5 tests passed,38.05seconds, on isolated local10200: one-child/four-operation recovery, dynamic case targeting, attended winner payment and separate collateral proof. |
| C browser pure guards |20 accepted/109 rejected; no actual public browser transaction is claimed by this self-test. |
| Regression/build |v7 redesign49, v8 simplified18, build/pinned v7 and v8 equality/typecheck passed. |
| Recovered A/B public role audit |202 checks passed with8 fully loaded screenshots,3 nonce-auth signatures and zero financial signatures/broadcasts. Independent observer208 comparisons passed. |

The full Node206-test run preceded the final status retirement/race, browser journal, selected
registration and C tooling additions; those later changes have focused evidence above. Public C UI
execution remains pending actual hosting and canonical browser-origin receipts. The first A/B deposits
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
