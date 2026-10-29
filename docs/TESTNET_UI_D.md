# Controlled 15-minute UI rehearsal D

Core is the sole financial operator. Use synthetic participants and Chiado10200 only.
Production v8 and existing A/B/C terms, origins, journals and scheduled jobs remain unchanged.

## Authoritative identity

- Origin: `https://kleros-fast15m-d-20261029-9fe71683.netlify.app`.
- Plan/event: `70688861-87e2-4936-9e2e-bdc9a7c7a5fd` /
  `chiado-ui-70688861-87e2-4936-9e2e-bdc9a7c7a5fd-d`.
- Active fingerprint: `2d195b00bec7ffe8436bf2146f2d25dacb6d289ab76329cd92901e8fc07c70d1`.
- Child: `0x8E1eCFb62465E1b333CBcf30763a2F8aCE2ABb88`.
- Factory: `0x0947D4438489f159E4B1BdC8BA63A1C07D642465`.
- Profile: `kleros-event-v8-test15m`, VERSION80015, both periods900seconds.
- Owner: `0x348800A6690898b36be3CAe18555F80E16401cD7`.
- Alice: `0x64ef8E882a489FA9b1fbfd87815A5A972F3Cd38c`.
- Bob: `0x8f9cA1dCdB1eB1842C21BBc20C7737de8d82b501`.
- D means exactly `1000000000000` wei of test XDAI.
- Event start/deposit cutoff1793244600 = **29October10:30Bangkok**,03:30UTC.
  App check-in hours end12hours later. Claim/posting term remains seven days.

The ACTUAL challenge deadline is attendance receipt block time+900seconds. Each actual Waiting
case has its own challenge receipt time+900seconds. Never derive eligibility from event start,
the calendar reminder, A/B/C deadlines or a previously observed block. A matched case no longer
has a Waiting matching gate; read its actual current state and resolver/arbitrator ID pair.

## Complete checkpoint — 29 October 2026, 05:04 UTC

**D is complete. Do not rerun its financial stages.** Actual UI deposits, admission, Alice-only
attendance, the same Bob's challenge, matching, ordinary payout and settlement are verified, with
one separate controlled ruling1 for the observed local2/arbitrator1002 pair. There are14 confirmed
transactions:5 setup,8 unique actual UI operations and1 controlled ruling. No financial replay,
replacement or journal reset occurred. Earlier checkpoints below remain historical evidence.

The owner submitted one actual UI `resolveChallenge(Bob)` request/broadcast:
`0xc27fb4878a820914c134be76e693057c6a700948f1d56350aabdf62f04063a0e`, block23741297,
owner nonce7. The [passed operation](../artifacts/ui-d/settle-2026-10-29T04-37-17.469Z-6739bf8b/ui-d-resolve-bob.proof.json)
has SHA256 `0ba2ec8145b0799523d007056c6dd2fde177456513d853e2d33728514f2341b7`.
Bob received his fullD attendance payment plus separately proved30e9wei collateral; Alice receivedD.
Total delivered attendance is2D. Held/owed/pending/escrow/reserves and child balance are0, with Bob's
case resolved/final1. Delivery is proved by canonical payments and Bob's balance, not merely an owed entry.

The [final canonical verifier](../artifacts/ui-d/verify-2026-10-29T04-53-08-491Z-03585c97/operator-proof.json)
passed with zero additional broadcasts; SHA256
`cfe988e24a66ca6e287fd25591b16a78e2e602a974411c3ce703fae823121bbe`.
The [settled role audit](../artifacts/ui-d/status-settled-2026-10-29T04-45-26-924Z-973b436d/proof.json),
SHA256 `8f74f78ae82cc084917ca7bd5dd9ada1451949eff464e375d8b983080993fd2c`, passed86 read/auth
requests,3 nonce authentications and6 desktop captures with0 financial actions. Both independent
settled observers passed161 checks. The UI peer independently passed all6 final presentation captures:
Bob's personalD paid and challenge settled, AliceD paid, event Sent2D and all obligations0.

The original full payout, ruling and settlement runs remain **stopped** after their actual successful
operations; their exact post-operation errors remain unproven. The original settlement wrapper retains32
checks and SHA256 `dc0970ddb939c806b7783641722c79cde3c1ac111128f4fe9ff63e5d777a4ef0`.
Passed per-operation evidence, the payout read-only supplement and the existing receipt-only ruling
recovery are separate records. The first ruling-recovery diagnostic's reporting ReferenceError was
corrected with0 chain actions. No original proof or confirmed operation was rewritten or replayed.

The final [compositional settlement supplement](../artifacts/ui-d/settle-completions/2026-10-29T04-56-38-478Z-23d75c35/proof.json),
SHA256 `b55d3c5b1ea86666242ecbb24a14b1ffe7c2c844b41ba389f6024e91cc7f3c78`, verifies7 input
proofs,13 operator files,26 public files and14 canonical headers. It proves the original settlement's
A/B/C before/after equals the final verifier's A/B/C, all current D obligations are0 and original journal
bytes are unchanged, with0 signing-file reads/signatures/broadcasts. Its
[new completion pointer](../artifacts/ui-d-settle-completion.json) supplements the original stopped
wrapper; it does not claim that wrapper passed. See [final acceptance](CHIADO_UI_D_ACCEPTANCE.md).

This is controlled mock arbitration, not real jury adjudication. Normal extension-wallet prompts are
outside this bridge's coverage. A/B and C are still pending with their existing ACTIVE jobs, frozen
sources and142 unchanged preservation checks; no D heartbeat was created. D-only UX release follows
the final financial Git checkpoint/baseline, with no app-source change made by this completion record.
The separate [production target](ETHEREUM_MAINNET_V8_READINESS.md) is Ethereum1/native ETH and normal
v8 VERSION8/86400-second periods, not mainnet broadcast approval.

## Preserved setup and planning revision

Three role grants and one fast-factory creation are confirmed. The initial child was never submitted.
The original prepared09:24:20Bangkok plan and its four-entry journal were archived raw and unmodified
under `.runtime/testnet/ui-d-revisions/2690bb4088e4ab7da792b9886265730b81a52e417784417c1ec14e8b2a9c9cdd`.
The tested, independently reviewed metadata revision changed only the three undeployed event time
fields and the journal's plan binding, with append-only revision history and byte-equivalent transaction
entries. It used the existing full-test human authorization; no public D terms existed at that point.
[Applied proof](../artifacts/ui-d-start-revision-applied.json) records0signatures/broadcasts.

The first actual child creation is canonical:
`0x3c33411d377bec442f8e4831c8465f7d92f02966289fbae212807fb4de59507c`, block23740043.
[Manifest](../registry/chiado-v8-ui-d.json) raw SHA256
`56eca833e2c196a4de7e3c788165cd856ebacdd81f29342caa9911888a0292bd`.
No original setup action was replayed. D2 was considered and rejected; no D2 plan, keys, journal or
contract exists. The active child terms above are immutable. Do not run the revision tool to change them.

Private signing files stay fixed: `ui-d-wallets.json`; active plan `ui-d-plan.json`; once-only journal
`ui-d-journal.json` under `.runtime/testnet/`. All operators share `chiado-operation.lock`.
Keys stay in Node memory. Never print keys, signatures, signed bytes or cookies. An existing
prepared/submitted/uncertain hash allows receipt inspection only. Never replay, reset, replace,
rotate wallets, deploy a replacement or advance public chain time.

## Admitted checkpoint — 29October2026,03:27UTC

[Live hosting proof](../artifacts/ui-d-hosting.json) records backend source
`67ee1d9bfac68f6925ca5dff638b07b5e56b5eae` in successful Railway Linux deployment
`aef2933b-e7bf-4c05-855c-b39b77a96c7b`, uid1000 with durable `/data`. Separate Netlify deploy
`6ae2a28034076e4185468d63` uses frontend source `7bdd40a3478e487f84b0c00aa0d58e25d13e0d5e`.
A/B/C hosting and financial state were not changed by the D stages below.

The revision helper's four temporary-file/injected-verifier tests passed4/4; that is local validation,
separate from its [actual metadata-only revision](../artifacts/ui-d-start-revision-applied.json) and
the actual browser transactions. Original setup records were preserved and no setup send was replayed.

| Actual completed stage | Canonical result |
|---|---|
| [UI deposits:42 checks](../artifacts/ui-d/deposits-2026-10-29T03-07-36.775Z-4b5ede2e/proof.json) | Alice and Bob each self-registered and deposited exactly1e12wei through their actual wallet-authenticated UI; two financial submissions/broadcasts, canonical UI reconciliation and four review/confirmed captures. |
| [UI admission:43 checks](../artifacts/ui-d/admit-2026-10-29T03-17-58.585Z-b7229940/proof.json) | Host approved both through the UI, then separately reviewed and signed one exact two-wallet contract registration. |
| [Independent admitted observer:131 checks](../artifacts/chiado-ui-d-flow-audit/2026-10-29T03-26-46-901Z-c0e4fb87-26b9-4fec-9040-6bce596eb75f.json) | Anonymous GET/read RPC, zero signatures/broadcasts; Open, stakers2, pool/balance/reserves2D, pending0, attendees/cases/held/owed/paid0 at block23740491. |

Alice deposit: `0xe3b10808d5060b3ef2b6c5f6ccba1c81d3ebee041c5059c27f96f29eac21d682`, block23740304.
Bob deposit: `0xde29bf8ffa52d94ed551a1b9cf2f65edfec933ffcf4e3220cd3bf92eb61f29eb`, block23740332.
Registration: `0x8376920fd03eb0c2cc8a34bcc25f0d79b9be11f7ce9746c4455cbf59e400e56d`, block23740440.
Every financial UI operation and both full stages proved immediate A/B/C isolation. The read-only
observer supplies separate canonical evidence and does not itself prove browser initiation.

No D kickback, controlled ruling or settlement has occurred at this checkpoint. The nonce-only admitted
role audit is separate readiness evidence; attendance, Bob's challenge/matching, ordinary payout with
his share held, controlled ruling1 and same-Bob settlement each need their own actual passed proofs.
Neither local tests nor confirmed deposits/admission establish full public financial completion.

## Ordinary payout checkpoint — 29 October 2026,04:14:47UTC

The ordinary payout operation is canonical:
`0x07ff1e1718ffc9aaa7e9bb2c44d6656e8a955d0878ae1d731e0b2f5e89e4fbd3`, block23740796,
owner nonce5. It used one actual UI wallet request and one broadcast. The
[full payout run](../artifacts/ui-d/payout-2026-10-29T03-51-39.182Z-3960b430/proof.json) recorded32
checks and no blocked requests, but **stopped after saving its passed operation**. The remaining
cleanup/final-read error's exact cause is unproven; do not describe the entire UI stage as passed.
The [passed operation sidecar](../artifacts/ui-d/payout-2026-10-29T03-51-39.182Z-3960b430/ui-d-release-payouts.proof.json)
has SHA256 `2697495cdc9304e1166c88dc68e9537854e0c6962b5a45e0574be4f7251021f5`,14 observed
confirmations, actual review/confirmed captures and unchanged immediate A/B/C financial snapshots.
No UI action was replayed and no original proof or journal was rewritten.

The separate [ordinary role audit](../artifacts/ui-d/status-ordinary-2026-10-29T03-58-30-360Z-2178dda7/proof.json)
passed86 read/auth requests,3 nonce authentications and6 desktop captures with zero financial
signatures/broadcasts. The [ordinary observer](../artifacts/chiado-ui-d-flow-audit/2026-10-29T03-58-06-211Z-2b8f5d98-0cd7-4a0b-9b30-da725e548b5e.json)
passed158 independent GET/read-RPC checks. Neither verifier initiated the payout.

A separately reviewed read-only helper, source SHA
`5150a82e1596f0e7280efa6f38981f362c37a4271d201a201020bb62e6ba098d`, passed5/5 public-fixture
guard tests and completed the missing aggregate checks without opening signing files, signing or
broadcasting. Its [immutable supplement](../artifacts/ui-d/payout-completions/2026-10-29T04-14-47-517Z-854653ed/proof.json)
has SHA256 `4824515ff70118d66076019f2935e8b7ca4f82b3e474c34af48112531cd6c7a9` and status
`passed-read-only-supplement`; [its new pointer](../artifacts/ui-d-payout-completion.json) keeps
`originalRunStatus: stopped`. It rechecked all historical and fresh D/A/B/C anchors, exact source
closure, unchanged A/B/C aggregates, unchanged original records and the final pinned payment block.
This supplement establishes the missing financial aggregates, not successful original harness cleanup.

At that checkpoint Alice has actually receivedD attendance payment, Bob's fullD remains held with
owed0 and30e9wei challenge escrow. His observed dynamic pair is local2/arbitrator1002, still Disputed
and unruled. A subsequent controlled ruling1 and settlement each require their own passed proofs;
the same Bob's late payment and full controlled completion are not yet established by this record.

## Controlled ruling checkpoint — 29 October 2026,04:33UTC

The controlled arbitrator delivered attended ruling1 for the observed local2/arbitrator1002 pair in
one CLI transaction: `0x9a273700b4757d5279797f795a4f71d03352c3f1c6bc96c175519ec3700610cf`,
block23741046, owner nonce6. This result comes from the explicit controlled mock, not an independent jury.
The original operator confirmed the transaction but then stopped on a generic final-check error;
its exact cause remains unproven. Neither the transaction nor the original run was replayed/reclassified.

The frozen existing receipt-only branch then passed with zero new broadcasts. Its
[immutable proof](../artifacts/ui-d/ruling-2026-10-29T04-30-41-044Z-745755c9/operator-proof.json), SHA256
`e83194878dea9d62f0ea48f04c0c956c5c37d8dfc16d2e6c1ac2bbaf190a38b1`, is separate from the stopped
original. [Recovery output](../artifacts/ui-d-ruling-receipt-output.json) records that result. Guards
prevented signing-file reads, signing, sending and mutable RPCs, and raw journal bytes were unchanged.
The first read-only recovery diagnostic hit a reporting-wrapper ReferenceError; correcting that
reporting issue made no chain action and does not explain the original operator error.

[Original-interval recovery evidence](../artifacts/ui-d-ruling-recovery.json), SHA256
`0ded2365f214e8f973af78e6ef6d83116a036d2e700708d04a717f1c457d778b`, verifies the exact ruling
call and nonce,10 unique canonical anchors, and persisted pre-ruling/public payout-completion baseline
against recovered A/B/C before/after. The original ruling interval, not merely its receipt-recovery
interval, left A/B/C unchanged. No original proof or transaction record was rewritten.

The separate [ruled role audit](../artifacts/ui-d/status-ruled-2026-10-29T04-20-57-035Z-219650d8/proof.json)
passed86 read/auth requests,3 nonce authentications and6 captures with0 financial signatures/broadcasts;
the [ruled observer](../artifacts/chiado-ui-d-flow-audit/2026-10-29T04-20-23-492Z-f62510b1-6be5-46c4-b4fd-5e951a7522e6.json)
passed158 checks. Final1 is delivered, but Bob's D remains held and owed0; Alice has her earlier D.
UI settlement and final settled UI/chain/payment/collateral checks are still separate requirements.
This checkpoint does not claim Bob has received his late payout or that D is fully complete.

## Actual browser stages

The following commands document the completed execution. All D financial actions are now present;
do not rerun them. For any future separately authorized rehearsal, review its own current stage and
source-bound proof first and execute only its missing action:

```sh
UI_D_EXECUTE=1 \
UI_D_APP_URL=https://kleros-fast15m-d-20261029-9fe71683.netlify.app \
TESTNET_RPC_URL=https://rpc.chiado.gnosis.gateway.fm \
node test/testnet-ui-d.e2e.mjs --stage STAGE
```

Stages are `deposits`, `admit`, `attendance`, `challenge`, `match`, `payout`, `settle`.
Actual UI review→draft validation→wallet request→single broadcast→canonical UI confirmation is required.
Each completed action must have its immutable UI sidecar, canonical once-journal receipt and unchanged
immediate A/B/C financial before/after proofs. A CLI-origin deposit or API shortcut is not UI initiation.
Never rerun a successful or uncertain stage to improve its screenshots. Missing proof stops dependent work.

After exact Alice/Bob UI deposits, owner approval and separate UI registration must commit exactly2D,
pending0/pool2D/stakers2. Require admitted Alice/Bob/owner UI proof before event attendance. During real
event hours, check in Alice only and post her attendance through the UI. Bob challenges his omission,
then the owner matches through the UI. Re-read the actual dynamic case IDs; do not borrow A0/1000 or
C1/1001, or assume D2/1002 before observing it.

Run the scoped independent observer after each stage. Use the exact manifest hash, plan/fingerprint,
origin/event/child pins in this document. The observer uses only anonymous GET/read RPC and deliberately
does not claim UI initiation. Its namespace is `artifacts/chiado-ui-d-flow-audit` with a latest status pointer.

Require fresh read-only role phases before every dependent financial action:

```sh
UI_D_STATUS_EXECUTE=1 \
UI_D_APP_URL=https://kleros-fast15m-d-20261029-9fe71683.netlify.app \
TESTNET_RPC_URL=https://rpc.chiado.gnosis.gateway.fm \
node test/testnet-ui-d-status.e2e.mjs --phase PHASE
```

Phases: `admitted`, `matched`, `ordinary`, `ruled`, `settled`. Auth nonces only; no financial methods.
Fully loaded participant/owner/cases views must match a fresh canonical API block and direct payments.
These audits capture desktop views; normal browser-extension prompts are outside the restricted bridge.

## Held share, ruling and actual payment

When freshly eligible, keep Bob matched and UNRULED, then perform UI `payout`. Require ordinary role
audit and observer BEFORE any ruling: Alice directly paidD, Bob's fullD held, owed0. `Finalized` means
ordinary batch processed and does not mean all cases settled or payments delivered.

Review `node scripts/testnet-ui-d-rehearsal.mjs --stage ruling`, then its explicit `--execute` only after
ordinary proofs pass. It may give only controlled attended ruling1 to this actual dynamic D case.
Require `ruled` role audit and observer before UI settlement, proving the final delivered ruling while
Bob's held attendance share remains unpaid. Then use actual UI stage `settle`.

Require settled role audit/observer, then review and execute the operator's `--stage verify --execute`
read-only canonical reconciliation. The SAME Bob UI depositor must receive exactlyD attendance payment,
AliceD, with held/pending/owed/reserve obligations0. Reconcile separate unlogged challenge collateral
against canonical recipient balances/gas. Collateral, pending-credit withdrawal or fungible claims are
not attendance payments. A failed audit stops the next dependent financial action.

Arbitration is intentionally controlled, not an independent Kleros jury. Real Court is a later separate
ABI/provider/funding phase. No mainnet, real guest writes, upstream push, IPFS publication or billing upgrade.

## Continuation

D has completed all financial and final presentation gates; no D heartbeat was created and no D
financial continuation is missing. Preserve A/B and C's independent ACTIVE jobs and frozen operators.
The next authorized D-only UX work follows the final financial Git checkpoint/baseline and must retain
these public proofs and immutable terms. It does not authorize replaying this completed exercise or
broadcasting on mainnet. Public proof paths/outcomes only may be sent to the two human-authorized
UI/contract chats for independent read-only review.
