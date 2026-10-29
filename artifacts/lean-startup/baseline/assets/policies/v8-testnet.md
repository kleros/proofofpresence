# Synthetic v8 attendance rehearsal policy

This policy is only for events explicitly deployed as a Chiado testnet rehearsal.
All participants and evidence must be synthetic. Native test xDAI has no monetary
value. The first rehearsal uses a controlled test arbitrator, whose operator can
choose a ruling. It does not exercise an independent Kleros jury. Each event's
immutable addresses, times, deposit and metadata remain authoritative.

A deposit creates unused credit owned by its actual payer. Before admission, the
payer can recover that credit directly to a chosen recipient. Admission consumes
exactly the event deposit from that payer and commits it to the attendance pool.
Additional unused credit stays reserved and withdrawable in every phase. Admission
is curated by the event owner and is limited to 150 unique lifetime wallets.
Deposits close strictly at the event start. A receipt alone is not admission.

The organizer records trusted attendance and posts the attendance list after the
event starts. An admitted depositor omitted from the list can challenge during
the contract's one-day challenge window. A match must meet the contract's current
deposit and fee requirements during its one-day matching period. Unmatched and
matched disputes follow the contract's distinct resolution paths. The organizer
for a case is fixed when the challenge opens; ownership changes cannot rewrite it.

Ruling 1 means the synthetic participant attended under the event's stated terms.
Ruling 2 means they did not attend or attendance was not proven. Ruling 0 means
refusal to arbitrate: the participant is excluded from attendance and the remaining
challenge collateral is split between the parties as the contract specifies.

Established attendees can receive kickbacks while each unresolved matched case
retains a full provisional share. Later outcomes settle held shares and redistribute
any late top-ups using the contract's equal-share and integer-rounding rules. A
challenge, ruling, settlement and actual payment are separate facts. Failed transfers
become owed credit recoverable with claim; they are never reported as delivered.

Open-phase rejection, cancellation and no-list emergency recovery follow the
contract. Independent unused-credit recovery is distinct from withdrawal of an
already admitted commitment. Organizers cannot sweep pending credits, committed
pools, held shares, challenge collateral or owed balances as spare money.

Public testnet time cannot be advanced by this application. The contract's one-day
challenge/matching windows and minimum seven-day posting deadline remain unchanged.
Use real chain timestamps and resume a rehearsal at its recorded stage.
