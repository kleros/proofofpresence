# Isolated public UI deposit rehearsal C

This scenario implements the human request to test fresh deposits through the actual app, then
follow the same depositor through dispute and kickback. Root is the sole financial operator.
Only disposable synthetic wallets and Chiado chain10200 are used. Existing A/B scenarios, deadlines,
manifest, application records and scheduled payout operation remain independent.

## Confirmed checkpoint

C plan fingerprint: `3637ba50a2b8f1d46cedbe6d678b747c25d19c15e976ae6ea87e63c8be0126fb`.
[Public manifest](../registry/chiado-v8-ui-c.json) identifies event
`chiado-ui-cb5736f0-f41d-470c-b491-c0c384695281-c` and child
`0x9175260daa4D430C8a0c48BFd7fEa7cEbFA06cef`. Three1e13wei role grants and one child creation
are canonically confirmed; creation hash
`0x4aae6f292e9f6e7dbc65751631218a99f3c7bb74e68ea4d768d12f0235efc9cf`, block23735598.
[Deployment proof](../artifacts/ui-c-deployment-proof.json) contains all four receipts and fee budget.
No UI deposit or admission is claimed by this checkpoint. Hosting publication is pending.

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

The existing `finish-kleros-testnet-kickbacks` job owns A/B only. Once C deposits/admission are
confirmed, C needs its own concrete continuation schedule after its actual start, then after the
observed attendance challenge deadline. Keep each job scoped, use the shared lock, and pause a job
only after its own verified completion. Local scheduling requires the computer awake and Codex running.
