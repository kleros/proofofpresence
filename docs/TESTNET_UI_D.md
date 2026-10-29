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

## Actual browser stages

Review the selected current stage and prior source-bound proof first. Execute only its missing action:

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

Keep only one D continuation in this root chat. Schedule attendance after the immutable event start;
after matching, use the ACTUAL posted challenge deadline plus at least120seconds if another wake is
needed. Reuse that same D job, never another operator. Stay quiet while unchanged/non-actionable;
notify material failure, needed action or verified same-Bob payment plus correct final UI. Delete only
the completed D job after all final checks; preserve A/B and C's independent jobs. Local scheduling
requires this computer awake with Codex running. Public proof paths/outcomes only may be sent to the
two human-authorized UI/contract chats for independent read-only review.
