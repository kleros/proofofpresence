# Post-event attendance, challenges and payouts

The deposit page follows the current event's on-chain state after deposits close.
This view provides status and navigation; existing signed-action controllers still
perform fresh authorization, transaction review, simulation and original-hash recovery.

## Current timing

After the event ends, the page waits for the owner to publish the final attendance
list. The displayed publication deadline is the actual recorded `claimDeadline`.
For the existing V10 event this is seven days after event start. A strict 24-hour
organizer window after event end is a proposed timing preview, not a deployed rule.

Publishing attendance starts a separate 24-hour omission challenge window. Each
challenge starts its own 24-hour matching window. A challenge becomes a Kleros Court
case only when someone contests it by matching the required payment.

Owner/admin/staff door observations are recorded during event hours. The owner
reviews actual attendance and posts the on-chain attendance list afterward. Deposits
must first have been approved and registered; a historical payment alone does not
establish admission or challenge eligibility.

## Wallet status

- Waiting for publication: show the real organizer deadline and preserve pending
  transaction/receipt recovery. Do not invent attendance or no-show counts.
- Listed as attended: show current registered/attendance counts and any provisional
  share estimate. Mark wallets absent from the list as provisional while challenges
  can change the outcome. With no no-shows, there is no no-show bonus.
- Missing from the list: registered wallets can open the existing reviewed challenge
  flow before its deadline. This requires a separately reviewed challenge payment.
  Unregistered payers instead receive recovery guidance for their pending credit.
- Awaiting a challenge response: show that challenge's matching deadline.
- Matched Court case: provide the existing case/evidence review path. Evidence uses
  a separately reviewed URI submission; this screen does not upload or publish files.
- Ready for release: a wallet still needs to submit a payout-release transaction.
  Passing time alone does not execute a transaction.
- Payout round released: ask the person to check their wallet. A saved Paid/Finalized
  status does not prove delivery; failed transfers become owed credit and can be claimed.

## Disputes and other attendees

An active challenge awaiting a matching response blocks payout release until the
matching period has ended or the challenge has otherwise been settled. Once payout
release is allowed, unresolved matched Court cases retain their own protected shares.
Ordinary confirmed attendees can receive payouts while those cases continue.

The contract automatically accepts expired unmatched challenges during payout
release. Estimates must include those prospective attendees in the denominator.
The initial payout share can change before release; later Court results can also
create top-up payments. Never describe the initial share as lifetime ETH received.
Historical Deposited totals include later withdrawals/refunds and cannot be used
as the current reward pool. Missing or invalid financial summaries show unavailable
amounts instead of inventing a return.

## Controls

The deposit page links to the existing scoped review screens for challenge,
refund/recovery, payouts and Court evidence. Simplified Manage Event also exposes
links to the existing full payout/case and recovery screens. These links neither
submit a transaction nor grant permission. Every action retains the current
contract, wallet, server-instance, policy, deposit provenance and draft checks.

No deployment, contract upgrade, live role grant or financial transaction is part
of the local preview. Existing financial rules, disputed-share treatment and ruling-0
economics are unchanged.


## Focused status page

After the event, the initial view shows the connected wallet's attendance, estimated
return and earliest release time. The date includes the event timezone and seconds,
with a local-time equivalent where different. Receipt, counts and recovery context
remain in native disclosures. Omitted wallets retain a prominent challenge action;
matched cases retain their case/evidence action. Pending or unverified original
transaction warnings expand their receipt instead of being hidden by simplification.

An existing wallet preference can restore display identity after fresh account and
chain checks. It never grants a private session, role or transaction permission.
A changed/locked/disconnected wallet clears personal status and requires selection.
A stale cache or a fast device clock cannot advertise payout readiness; the saved
canonical block must be strictly past the challenge and every Waiting match deadline.
The payout-release transaction remains explicit. Released does not mean delivered.

## Application rollout

Ship the frontend and its existing public display producer together. The production
frontend build is `npm run build:netlify:production` with Node 22, publishing
`dist/netlify-app` and the existing `netlify/functions` folder. Verify the current
canonical published Netlify deploy before the matching backend release. No contract,
policy, ABI, environment or database schema change is needed.

The backend update adds optional same-block `payoutState` alongside `eventState` in
the existing cached `GET /api/first-event/depositors` response. The HTTP read stays
SQL-only. Live acceptance requires a fresh successful background projection with
both valid sidecars; HTTP 200 or historical receipt totals alone do not establish a
payout estimate. Missing, stale or inconsistent projections suppress monetary values.
The local sample clock and synthetic wallets never enter the production build.
