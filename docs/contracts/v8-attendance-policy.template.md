# Attendance policy template for a new v8 event

Local template only. Fill and review all event details before creating immutable deployment inputs.
This file has not been published or approved for a live event and does not replace historical v7 policy.

Event: {{eventName}}. Venue: {{venue}}. Attendance interval/timezone: {{attendanceInterval}}.
Deposit: {{depositAmount}} native ETH. Chain/factory/creator/stable event key: {{deploymentIdentity}}.
Evidence requirements and any organizer-approved ticket transfers: {{attendanceEvidenceRules}}.

The actual child contract address is filled by the contract into each case description and can be
verified against the factory's event mapping. Do not guess a future ordinary-CREATE child address
when preparing this policy; intervening deployments can change that address.

## Deposits and admission

Pay the event contract directly from your own wallet, while Open and strictly before its immutable
`eventStart`. Sending funds creates pending credit, not admission. The organizer curates admission;
registration consumes exactly one deposit from that wallet's credit. There can be at most 150 unique
lifetime admitted wallets, including previously admitted wallets later refunded. A readmission
uses the same lifetime entry but needs fresh collateral.

Unused, excess, short and unadmitted credits belong to their payer. The payer can call
`withdrawPending(to, amount)` in any phase without organizer approval. This does not withdraw a
registered commitment. Open-phase rejection or cancellation returns registered principal; a failed
batch payment becomes `owed` and can be recovered with `claim(to)`. If no attendance list is posted
by `claimDeadline`, registered wallets can recover principal with `emergencyWithdraw(to)` afterward.

## Attendance and disputes

The organizer publishes a nonempty list of admitted attendees after `eventStart` and no later than
`claimDeadline`. This policy must define what evidence makes attendance more likely than not for
the event above. Initial list inclusions remain the organizer's responsibility.

An admitted wallet omitted from the list can challenge within one day after posting, funding the
current arbitration fee. Anyone may match the challenge deposit within one day after challenge.
Unmatched expired challenges count as attended and return their challenge deposit. A matched case
goes to the immutable V1 resolver/Court. If the current arbitration fee exceeds both deposits, matching
is refused under the contract rules. Organizer corrections cannot override a matched or resolved case.

The organizer authorized to make statements **for each case** is `caseOrganizer(challenger)`, the
event owner when that challenge opened, named in its contract-generated description. Transfer of
ownership changes the authority for future challenges and cannot rewrite an existing case's identity.
Neither the current owner alone nor an old deployment-time owner substitutes for that case snapshot.

Ruling 1 means the registered person attended under this policy; ruling 2 means absent or not sufficiently
proven. Ruling 0 (refusal) excludes the challenger, like absence. Use final resolver-delivered rulings,
including appeals; an intermediate juror vote is not final settlement.
If the organizer named for this case confirms attendance, rule Attended. The challenger otherwise
must make attendance more likely than not; a missing door scan alone does not establish absence.

Appeal contributors fund the V1 resolver directly. One fully funded side can override a vote when
the other side does not fund; this includes ruling 0 where the resolver allows it. Observe the actual
winner/loser deadlines and multipliers. Contributions/rewards are separate from event custody and
are recovered by the actual contributors from the resolver under its rules.

## Settlement

Attendees share registered principal, including forfeited no-show deposits. Payouts may proceed
while matched cases remain open, reserving one provisional share for each. A late winner receives
its reserved share; a late loser redistributes it among attendees and remaining cases, preserving
equal cumulative entitlement up to rounding dust. Failed payments wait in `owed` for recovery.

The challenge winner receives the remaining challenge collateral after the arbitration fee. On
ruling 0, split that collateral equally, assigning any odd remainder to the matcher; the challenger
is not added to attendance. Pending payer credit is never part of the reward pool or owner spare.
The organizer may recover only actual spare funds, such as rounding dust or forcibly sent ETH.
