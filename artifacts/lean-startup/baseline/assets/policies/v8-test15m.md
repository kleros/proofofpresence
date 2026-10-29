# TEST ONLY — Chiado v8 15-minute attendance rehearsal

This policy applies only to events explicitly deployed with contract/ABI profile
`kleros-event-v8-test15m`, numeric version80015, on Chiado chain10200. These events
use synthetic participants and test xDAI. A controlled test arbitrator chooses
the rehearsal rulings; this is not independent Kleros jury arbitration.

The challenge window is900seconds after attendance is actually posted on-chain.
Each challenge opens its own900-second matching window. The current contract's
`challengeEndsAt` and each case's `matchEndsAt` are authoritative. This does not
promise that setup, deposits or the complete rehearsal finish within15minutes.
Production v8 and the existing A/B/C rehearsals keep their one-day windows.

Deposits close at the immutable event start. A deposit creates credit belonging
to its payer, recoverable to a chosen destination until consumed by admission.
Owner approval and on-chain admission are separate. Admission consumes exactly
one deposit into the attendance pool, with150 unique lifetime admission slots.
Additional unused credit remains reserved and recoverable in every phase.

Trusted observations determine the posted attendance list. An admitted omitted
participant may challenge within the actual challenge window. Matching must meet
the contract's collateral and current arbitration fee requirements. An expired
unmatched challenge and a matched dispute follow their separate resolution paths.
The case organizer is fixed when the challenge opens.

Ruling1 means attended; ruling2 means absent or not proven. Ruling0 means refusal
to arbitrate: exclude the participant and split remaining challenge collateral
as the contract specifies. These economic rules are unchanged from production v8.

Ordinary release pays established attendees and holds a complete provisional
share for each unresolved matched case. A final ruling and settlement are separate
actions. Settlement applies the held share and any equal-share top-ups according
to the unchanged rounding rules. A successful attendance payout is distinct from
challenge collateral, unused-credit recovery and owed credit. Failed delivery
creates owed credit recoverable by its wallet; it is not reported as paid.

Cancellation, rejection and no-list emergency recovery follow the contract.
Pending credit, admitted principal, held shares, collateral and owed funds cannot
be swept as organizer spare funds. The minimum seven-day posting deadline remains
unchanged. No public chain clock is advanced. The15-minute test contracts reject
construction on any chain except10200. No mainnet deployment is authorized.
