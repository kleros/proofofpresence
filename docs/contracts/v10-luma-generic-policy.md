# V10 Luma attendance policy, version 1

This policy applies to the initially reviewed Ethereum V10 event contract identified in the case's
contract-generated meta-evidence. The event's immutable meta-evidence also fixes its title, Luma
event URL, attendance start and end in UTC, display timezone, ETH deposit, and this policy's SHA256.
The template identifies the challenger, the actual child contract, and the organizer recorded for
this particular case. Verify those facts and the policy digest against the original factory creation
configuration. A later website edit, redirect, ownership change, or revised Luma listing cannot
replace these fixed terms. A Luma URL is an event reference; it does not prove that the creator owns
that Luma page or is affiliated with Luma.

## Attendance standard and evidence

The supported standard is **event participation**, whether in person or online. The person associated
with the admitted wallet qualifies through verifiable presence or participation in the identified
event at any time during the fixed UTC attendance interval. Staying for the entire event is not
required. A different minimum-duration or eligibility rule requires a separately reviewed policy and
event configuration before anyone deposits.

For each case, the authoritative organizer is the address returned by `caseOrganizer(challenger)`
when that challenge opened, also named in the contract-generated description. If that organizer
explicitly confirms the challenger's attendance for this event, rule **Attended**. Otherwise, the
challenger must establish qualifying presence or participation as more likely than not. Consider
credible, contemporaneous evidence such as organizer or staff statements, event-specific scans or
online-session records, timestamped photos or participation logs, ticket-transfer evidence, and
corroborated witness accounts. Weigh reliability and conflicts;
one missing door scan alone does not prove absence. Submit only information relevant to the case.

A Luma RSVP, ticket purchase, ETH deposit, portal approval, wallet authentication, personal attendance
mark, or return-to-Luma action alone does not prove event participation. Wallet authentication proves
control of that wallet. Admission remains the organizer's decision, including any accepted association
between a wallet and a guest or approved ticket transferee. No automatic Luma registration or approval
is promised.

## Deposits, admission and recovery

Before depositing, review the child contract, fixed terms, current verified implementation, upgrade
authority and ownership status. Pay the child proxy directly from your own supported wallet while
the contract is Open and strictly before its configured `eventStart`. Payment creates payer-owned
pending credit. It does not admit or register the payer. Organizer approval and on-chain registration
are separate; registration consumes one configured deposit from that wallet's pending credit.
The initial implementation admits at most150 distinct wallets over its lifetime, including wallets
later refunded. Readmission requires fresh collateral but reuses the existing lifetime entry.

Unused, excess, short and unadmitted pending credit remains the payer's property and is excluded from
the attendance pool and organizer spare funds. The payer can recover it with `withdrawPending` under
the contract's rules. Registered principal follows the event lifecycle. Open-phase rejection or
cancellation returns registered principal. Failed native payments become separate `owed` credit,
recoverable with `claim`. If the organizer never posts attendance by the configured `claimDeadline`,
registered wallets can use the contract's no-list recovery afterward. These recovery paths do not
turn a registered or disputed commitment into freely withdrawable pending credit.

## Attendance lists and challenges

The organizer should post the trusted attendance list after the fixed attendance interval ends.
The initial contract permits posting after `eventStart` and no later than `claimDeadline`; it does
not enforce the separate end time. A list is an on-chain claim about attendance, not a final Court
ruling. Participants must monitor the actual list and its contract deadlines. The fixed attendance
interval does not extend or restart a challenge or matching deadline.

An admitted, registered wallet omitted from the list can challenge within86400seconds after posting,
funding the quoted arbitration collateral. Anyone may match within86400seconds after that challenge,
subject to the contract's current-fee and funding checks. Use the actual on-chain timestamps and
fresh fee quotes. An expired unmatched challenge counts as attended and returns its collateral under
the initial rules. A matched challenge goes to the configured Kleros resolver and Court. Organizer
corrections cannot override a matched or resolved case.

Ruling1 means Attended. Ruling2 means absent or qualifying attendance not sufficiently proven.
Ruling0, refusal to arbitrate, also excludes the challenger from attendance. Use only the final ruling
delivered by the resolver, including appeals. An intermediate juror decision or an appeal-funding
screen is not final event settlement. Changing the event owner affects future case-organizer snapshots
and cannot rewrite the organizer named for an existing case.

Appeal contributions are paid to the resolver separately from event custody. Actual funding deadlines,
multipliers, potential funding-default overrides, and contributor reward withdrawals follow that
resolver's rules. A contributor's appeal reward is distinct from an attendance payment, challenge
collateral, pending credit or `owed` credit.

## Payouts and collateral

Qualifying attendees share registered principal, including forfeited no-show deposits. Ordinary
payouts can proceed while matched cases remain unresolved, reserving a provisional share for each.
A late attendance winner receives its reserved share. A late loser redistributes the reserved amount
among attendees and remaining cases under the contract's cumulative-entitlement and rounding rules.
Do not treat a held share, delivered ruling, queued settlement, or failed transfer as money received.
Successful native transfer and recoverable `owed` credit are different outcomes.

Under the initial rules, an attendance winner receives the remaining challenge collateral after the
arbitration fee. On ruling2, the matcher receives the remaining challenge collateral and the challenger
does not receive an attendance share. On ruling0, the remaining
challenge collateral is split equally, with an odd remainder assigned to the matcher, and the
challenger remains excluded from attendance. Attendance payment and collateral return must be
accounted for separately. The organizer can recover only actual spare funds allowed by the contract,
including rounding dust or forcibly sent ETH, without consuming pending credit or protected reserves.

## Upgrade authority and permanent finalization

The factory and each event have independently upgradeable UUPS proxies. A shared, non-upgradeable
project controller initially permits its owner to upgrade them immediately. There is **no upgrade
waiting period**, no proposal queue and no guaranteed opportunity to withdraw before a change.
Authorized replacement code can change custody, financial rules and stored configuration. Depositors
must trust the current upgrade owner while this authority remains active. This policy describes the
initially reviewed implementation; it cannot make arbitrary future replacement code safe.

Factory default implementation selection affects future events. It does not automatically upgrade
existing children. Event financial ownership and project upgrade ownership are separate roles.
An organizer cannot upgrade solely by holding the event's financial owner role.

Project upgrade ownership transfers through nomination and acceptance. The current owner retains
control until the nominee accepts and can cancel the nomination. Acceptance removes the former
owner's control. The new owner has the same immediate authority; a transfer introduces no delay.

The controller owner can permanently renounce project upgrade ownership. In the reviewed controller,
renunciation clears both the owner and pending owner, disables every upgrade/default-selection path,
and provides no recovery administrator or ownership restoration mechanism. With the reviewed factory
and event implementations, this freezes the factory, its default implementation and every event bound
to that controller. Permissionless creation of new events can continue afterward using that frozen
default; their upgrade authority is also disabled.

Before calling renunciation final, verify the current code and implementation of the factory, its
default and every existing child, their controller authority and the controller's zero owner and zero
pending owner. An earlier authorized implementation could have introduced an alternate authority or
backdoor; renouncing the original controller cannot prove such code safe or disable powers outside
that controller. A familiar version or storage-schema label alone is insufficient verification.

Renounce the **project upgrade controller**, not an event's financial organizer, to freeze upgrades.
Finalization does not cancel an event, refund deposits, decide disputes, advance deadlines or disable
ordinary financial operations in the reviewed implementation. Participants must continue to follow
the contract's actual lifecycle and recovery rules.

Review the verified current implementations, authority and ownership before committing funds. If a
fetched policy differs from the immutable SHA256, use the correctly matching original bytes rather
than substituting new rules. Existing V9 events retain their original 48-hour governance and published
policy; this V10 policy does not amend them.
