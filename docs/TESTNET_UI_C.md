# Isolated public UI deposit rehearsal C

This scenario implements the human request to test fresh deposits through the actual app, then
follow the same depositor through dispute and kickback. Root is the sole financial operator.
Only disposable synthetic wallets and Chiado chain10200 are used. Existing A/B scenarios, deadlines,
manifest, application records and scheduled payout operation remain independent.

## Current matched checkpoint — automatic run29October

Actual UI attendance33, Bob challenge31 and owner matching31 checks passed, with exactly one
financial request/broadcast per stage. [Attendance](../artifacts/ui-c-attendance.json),
[challenge](../artifacts/ui-c-challenge.json) and [match](../artifacts/ui-c-match.json) summaries bind
all immutable source/receipt/UI proofs. Independent post-stage observers passed96/110/115.
A/B financial state stayed unchanged across each operation and each complete stage.

C is Listed with Alice alone; the SAME Bob UI depositor is Disputed and unruled. Its dynamically
verified resolver/arbitrator IDs are1/1001. Two principals total2D; balance/reserved2D+30e9 escrow;
unused credit, held share, owed credit and attendance sent are all0. The earlier Waiting case correctly
had no Court IDs/period/finality and did not inherit A's0/1000. The current matched role audit passed
83read/auth requests,3nonce signatures,6desktop screenshots and zero financial signatures/broadcasts:
[latest pointer](../artifacts/ui-c-status-matched.json). The root visually reviewed Bob's actual UI.

ACTUAL attendance challengeEndsAt1793311190 is **30October04:59:50Bangkok**
(29October21:59:50UTC). The SAME C job is ACTIVE at **30October05:02Bangkok**, after this deadline.
Its old04:50attendance schedule is superseded. No ordinary payout, controlled ruling or settlement
has occurred. Remaining stages below must preserve the unruled held-share test before ruling1.

## Earlier deposits and registration


C plan fingerprint: `3637ba50a2b8f1d46cedbe6d678b747c25d19c15e976ae6ea87e63c8be0126fb`.
[Public manifest](../registry/chiado-v8-ui-c.json) identifies event
`chiado-ui-cb5736f0-f41d-470c-b491-c0c384695281-c` and child
`0x9175260daa4D430C8a0c48BFd7fEa7cEbFA06cef`. Three1e13wei role grants and one child creation
are canonically confirmed; creation hash
`0x4aae6f292e9f6e7dbc65751631218a99f3c7bb74e68ea4d768d12f0235efc9cf`, block23735598.
[Deployment proof](../artifacts/ui-c-deployment-proof.json) contains all four receipts and fee budget.
The actual C UI deposit stage **passed42 checks** with exactly two wallet submissions and two
broadcasts. Alice and Bob self-registered through the real forms, reviewed the exact1e12wei calls,
and canonically reconciled their receipts through the UI:

- Alice: `0x78763b7529bb0a37d6d3f363c4ec74286b2e94ede6539c16f963292c3c630d91`, block23735838.
- Bob: `0x18c491e15bf50d8b10ba2f1b50fdf0dc36e3076bcd611e5ce9b4e345c7a38425`, block23735879.

[Actual UI proof](../artifacts/ui-c/deposits-2026-10-28T20-14-09.270Z-9dcf605b/proof.json) binds
per-operation source hashes, review/confirmed screenshots, canonical receipts and unchanged A/B
financial before/after states. Independent receipt checks accepted both; C's generic observer passed90
at the post-deposit checkpoint: pending2e12wei, balance/reserved2e12wei, pool0, stakers0, no cases.
Owner UI approval and separately signed registration **passed39 checks**, with exactly one
financial wallet request/broadcast. Registration hash
`0x5a67239bb778dea7a9607b1a5240d1ca25b1b9fa8ccf8942e02afdd8f7333367`, block23735984.
[Admission UI proof](../artifacts/ui-c/admit-2026-10-28T20-24-27.545Z-3ec384d7/proof.json)
shows exact Alice/Bob registration, pending0, stakers2, balance/reserved/pool2D and no cases or
attendance. Each C operation left A/B financial state unchanged. Independent post-admission
C observer93 passed. Final strengthened read-only role audit **passed**83 auth/read requests,3 nonce logins and6
desktop captures, with zero financial signatures/broadcasts and no failures.
[Latest readiness pointer](../artifacts/ui-c-status-admitted.json) binds the source0b62229 and
[immutable role proof](../artifacts/ui-c/status-admitted-2026-10-28T20-44-19-428Z-07236594/proof.json). It explicitly verifies visible approval,
registered contract state, confirmed D receipts, zero unused credit/no deposit-withdraw actions,
no attendance/payout yet and disabled premature payout/settlement controls. Desktop-only C
captures are distinct from the main desktop/mobile audit.

Hosting from source `f4643f8b3a2938d4cbcebe233e202656847a3084` is healthy;
[hosting evidence](../artifacts/ui-c-hosting.json) records C Netlify/Railway IDs and uid1000.
The first stopped pre-auth attempt was a genuine source-guard refusal, with zero signatures or
broadcasts. Only C's optional Netlify badge was disabled; operator correction66715b4 recognizes the
exact non-executable hosting comment for hash verification and passes the unchanged served response
to the browser. All other HTML/script/style bytes and financial guards remain strict. Pure guards22/117
and an anonymous18-request/15-asset probe passed before the successful financial run.

The app origin is `https://kleros-ui-c-20261029-9fe71683.netlify.app`; separate backend service
`44d00bdc-2d7e-46cb-aa9c-18f4d3fa2547` and `/data` volume
`f44ba3f8-c527-4eba-9d7a-7fc85e1e7648` avoid modifying A/B's persisted whole-manifest binding.
C uses the existing factory/resolver/arbitrator and published generic policy, with unchanged v8
source,30e9wei challenge cost and24-hour contract challenge window. It deploys no replacement stack.

The immutable deposit cutoff/start is **2026-10-28T21:45:35Z**, **29October04:45:35Bangkok**.
The synthetic app check-in calendar lasts12hours after that start; claim deadline is seven days
after start. These times are fixed in the prepared plan. Never move them, reset the plan or
recreate a child to recover a failed test. C follows real chain time throughout.

## Intended actual sequence

1. Alice and Bob each self-register and deposit exactly1e12wei through the public UI.
2. Owner approves both through the UI, separately reviews and signs their contract registration.
3. During the real event hours, check in Alice only and post attendance through the UI.
4. Bob challenges his omission through the UI; owner matches through the UI. Resolve actual dynamic
   local/arbitrator IDs from this C case, rather than borrowing A's0/1000 pair.
5. After real challenge/Waiting-case deadlines, ordinary UI release pays Alice and retains Bob's
   share while his matched case is unruled. Capture fully loaded UI and canonical financial facts.
6. The narrow operator gives controlled attended ruling1. Capture final delivered-but-unsettled state.
7. UI settlement pays the **same Bob UI depositor** his held attendance share. Independently verify
   attendance Payout logs, current owed amounts and separate unlogged challenge collateral delivery.

A's planned absent ruling2/top-ups remains separate. The controllable mock is not an independent
jury. Real Court requires a later compatibility/funding review.

## Tools and recovery

`test/testnet-ui-c.e2e.mjs` defaults to zero-access review; `--self-test` checks pure guards only.
Actual stages require both `UI_C_EXECUTE=1` and `UI_C_APP_URL` equal to C's exact origin, plus healthy
source-matched frontend/backend and compiled provenance. Stage names are `deposits`, `admit`,
`attendance`, `challenge`, `match`, `payout`, `settle`. The harness uses actual UI review, wallet send
and canonical UI confirmation, not API financial shortcuts. Keys stay in Node memory. No automatic
mock-ruling control is exposed in the public app.

`node scripts/testnet-ui-c-rehearsal.mjs --stage ruling` reviews the narrow attended-ruling step;
only an explicit `--execute` can give ruling1 after canonical ordinary-payout evidence. Stage
`verify --execute` performs read-only final payment/collateral verification. Default review reads
no signing/runtime files and makes no network calls.

All operations share `.runtime/testnet/chiado-operation.lock`. Private C plan,0600wallets and journal
use separate fixed `ui-c-*` paths. A signed transaction hash is saved before the single broadcast.
Any consumed action stops a fresh UI run: inspect the same canonical receipt, never re-sign,
rebroadcast, erase a journal or reuse a successful deposit. If Alice alone completed the deposit
stage, a separately reviewed `--stage deposits --role bob` may complete only Bob's missing action.
Unknown outcomes stop dependent financial stages. Never use the helper's local test result as a
public browser receipt or substitute a CLI-origin deposit.

Every stage records unique source-bound proof paths under `artifacts/ui-c/`, per-operation hashes
and immediate A/B financial before/after comparisons. Legitimate scheduled A/B settlement between
separate C stages is permitted; an individual C operation must leave A/B unchanged. Pair actual
browser evidence with `scripts/chiado-deposit-receipt-audit.mjs` for independent canonical receipt
checks; that receipt-only tool deliberately reports `uiInitiationVerified:false`.

The existing `finish-kleros-testnet-kickbacks` job owns A/B only and remains unchanged at
30October00:20Bangkok. C job `finish-kleros-ui-testnet-flow-c` was rescheduled in place to
30October05:02Bangkok, after its ACTUAL attendance challenge deadline. Its next run must freshly
verify current matched source/state/UI, then ordinary payout with Bob unruled. Role phases ordinary,
ruled-before-settlement and settled plus the C observer gate every next financial stage. Same-Bob
attendance payment and separate unlogged collateral delivery require final independent verification.
[Continuation record](../artifacts/ui-c-continuation.json) records exact scope, timing and preservation
of A/B's job. The read-only auditor source0b62229/18accepted117rejected guards is unchanged.
After verified C completion, read A/B's final public proofs and canonical payment/held/owed facts
without operating A/B. The human requested one combined completion notice. If A/B is unfinished,
retain the completed C proofs and reuse this SAME C follow-up for a bounded read-only check;
never repeat completed C stages. Delete only C after verified combined completion, preserving
A/B's independent job and status. A/B has failure-only notifications; C uses normal notifications.
Both schedules and all financial guards are unchanged. Local scheduling needs this computer awake
with Codex running. The [29October07:49Bangkok eligibility snapshot](../artifacts/testnet-eligibility-20261029T0047.json)
confirmed canonical block23738775 and no eligible payout, with zero signing-file reads/signatures/broadcasts.
