# Organizer and deployment runbook

## Local start and identity

Use the root README commands. The only supported server mode is `local-demo`, binding `127.0.0.1`.
`PORT` defaults to 3000, `RPC_PORT` to 18545; tests allocate independent ports and runtime namespaces.
Choose an organizer or door identity explicitly. A content editor, attendee or Event A staff member
does not acquire Event B ownership. Current contract owner and pending owner are read from chain;
ownership transfers require acceptance. Private financial events include those financial owners
without granting them access to an unrelated private content event.

Browser EOA authentication uses a domain/URI/chain/wallet/expiry-bound signed nonce. Nonces are
single-use. The local faucet is explicit, available only to a verified browser wallet with less than
1 local ETH, and sends valueless funds only. Entered email is a declared contact associated with the
authenticated wallet; it is not a verified email account. No ownership is inferred from a pasted address.
General smart-wallet signature/UserOperation linking is deferred; retained v7 contract tools continue
to support registered contract wallets and alternate-destination claims.

The process owns both an ephemeral chain and in-memory off-chain projections. Restart resets the demo.
Do not use it to retain production contacts or expose its RPC/account picker publicly. `.runtime/`
contains generated synthetic/public configuration, not a production database. The HTTP API uses
SameSite/HttpOnly sessions, strict Host/Origin/content-type checks, and a read-only application RPC.

## Create, configure and admit

1. Create a local event as a demo organizer. Stable ID is assigned by the registry; slug is a display
   address, never authority. Dates carry explicit UTC offsets and an IANA display timezone.
2. Review the event's chain, version, contract, deploy block, deposit in wei, owner, policy/template,
   event start and attendance-list deadline. Financial terms are immutable. A new schedule/deposit
   requires a new deployment; editorial visibility and registration status are separate.
3. Optional Luma ID/URL and mapped content UUID/URL are owner-controlled associations. They provide
   links/consistency checks, never guest synchronization or cross-system permissions. Public metadata
   sync cannot mutate deployed finance terms.
4. Review actual receipt evidence separately from admission. Paying alone does not register a guest.
   Approved verified deposits enter `registerStakers`; approved free guests never enter the pool.
   Declined deposited guests use reject/refund. Short/late/excess/duplicate/unmatched payments require
   reconciliation and a previewed spare-ETH return. The ledger excludes already returned funds and
   registered principal; a spare excess return does not invalidate the remaining legitimate principal.
5. Every transaction is simulated, reviewed with exact network/event/address/value/policy/calldata,
   then revalidated. A changed wallet/config/event/state invalidates the draft. Rebuild rather than
   relabeling a stale list. The browser-wallet flow revalidates immediately before asking for a signature;
   confirmation requires the exact new canonical successful transaction, not an old matching hash.

The underlying v7 contract can accept late ETH while Open; the app's deposit cutoff is earlier and
its verifier rejects outside-window receipts for registration. Late unregistered payers need organizer
return tooling. This retains the existing off-chain admission trust model.

## Imports and attendance

The root app accepts normalized CSV fields documented in [API](API.md). Use its downloadable synthetic
fixture to learn the shape. `participant_id`, email and wallet must consistently refer to an existing
authenticated identity in the selected event; a foreign explicit ID cannot fall back to matching email.
Any available event, chain, contract or configured Luma metadata conflict rejects the whole batch.
Duplicate headers/participants/financial evidence and changed state also reject before committing rows.

Raw exports require explicit organizer source review even when labels match. Record the export screen,
event selection and reviewer in the note. Hashes bind bytes, not origin. Import records retain event,
deployment, source hash, parser/config version, reviewer and block snapshot. Manual confirmation
cannot override a proven mismatch, duplicate receipt or stale transaction plan.

The current Luma guest/check-in and manual-door-list CLI remains functional. Follow
[the exact retained import commands](../references/kickback/docs/import-provenance.md) using separate
configs/private inputs/output directories per environment and event. Preserve mandatory CSV sidecars.
Legacy unbound intermediates must be regenerated, not manually stamped. Do not run the committed
live/rehearsal configuration in automated development; both target real mainnet.

Integrated door check-in requires event staff/owner, a verified linked participant, event hours and a
fresh nonce. Source/reviewer/timestamp/note are recorded. Reviewed historical CSV timestamps must fall
within the event schedule and cannot be in the local chain's future. Marketing consent, personal
"I was there", booth QR/lead/merch progression never appear in a financial attendance proposal.

Before posting, settle unresolved paid admission/refund decisions and inspect the nonempty list of
currently registered trusted attendees and exact initial share. Refunded/historical duplicate staker
records are excluded. Zero attendance cannot be posted: use the contract's appropriate cancellation
or no-list recovery route. Posting opens the one-day omitted-attendee challenge period.

## Challenges, appeals and payouts

- An omitted registered wallet challenges with the current arbitration fee. Each challenge has its own
  separate one-day matching deadline. Anyone may match. Unmatched expired cases count as attended.
- During the challenge window the owner can correct a trusted omission until it has been matched.
  Once matched, submit evidence and follow the resolver's final ruling.
- The resolver **local ID** identifies evidence, appeal funding and rewards. The arbitrator ID identifies
  the Court case. Contributions go directly from the contributor's wallet to the resolver; the app holds
  no appeal funds. Current fees, contribution totals and deadlines must be read again for each action.
- If automatic ruling delivery has not happened, use the reviewed **Advance expired appeal** and
  **Deliver final ruling** actions. They call the arbitrator with its own case ID, preserve the resolver's
  one-sided funding override, and leave event settlement as a separate reviewed action.
- Option 1 attends; option 2 stays excluded; option 0 stays excluded and splits remaining challenge
  deposits. A one-sided funded appeal can supersede a prior vote, including ruling 0. Only finality counts.
- Publish exact per-case bytes and verify CID/availability. Local publication in this demo is labeled
  `local-only` and is not an IPFS pin. The retained UI has publication/retry paths for a separately
  authorized rollout. Failed publication must remain visible even if a case exists on chain.
- After the challenge window and any waiting-match periods, release normal payouts while matched
  cases remain open. `S = floor(pool / (attendees + open cases))`; open cases hold a full provisional
  share. A late winner receives its accumulated held share; a loser/refusal redistributes it as top-ups
  to attendees and remaining open cases. Small integer dust remains reserved/spare as Solidity specifies.

Never replace that behavior with a blanket payout freeze. Event B can continue independently while
Event A has unresolved cases. For many unmatched expired challenges, resolve individually before a
large batch to stay within the tested gas cap. Existing capacity tests cover 150 recipients, not unlimited
event size. There is no generic timeout to bypass a matched Court case.

## Recovery

| Condition | Supported action |
|---|---|
| Open event, within attendance-list deadline, organizer cancels | `cancel`: registered deposit refunds; failed sends become owed |
| Still Open after list deadline with no attendance list | Registered wallet `emergencyWithdraw(to)`; early calls fail |
| Batch payment failed | Wallet `claim(to)` using an alternate destination if needed; duplicate claim fails |
| Unregistered/short/late/overpaid deposit | Review return ledger, then owner `refund(to,amount)` from spare only |
| Settled/cancelled rounding dust or stray ETH | Owner `sweep(to)`; held/owed/escrow reserves remain protected |
| Wrong token sent | Existing v7 `returnToken` tooling; token return is not ERC20 deposit support |
| Owner changes | Owner `transferOwnership`, then new wallet `acceptOwnership` |

Core reserve invariant: registered pool while Open/Listed (otherwise heldBack), plus owedTotal and
challengeEscrow. Return/sweep may never consume it. A failed recipient does not block everyone else.
No-list withdrawal cannot bypass a posted list or matched dispute.

## Production transition and approval boundary

No live data migrated and no upstream changes published. The historical mainnet direct deployment,
source verification inputs, policy CID and template remain unchanged. Keep its old URL available or
prepare explicit redirects only after verifying compatibility; source changes cannot upgrade it.

Before an authorized rollout:

1. Choose persistent hosting/auth, remove demo impersonation/faucet/mock controls, and isolate the chain
   adapter from Ganache. Resolve applicable dependency advisories. Enforce event roles server-side.
2. Map content UUIDs explicitly and rehearse against a disposable staging database with all existing
   migrations. Preserve caller-session RLS/private materials/assistant access. Existing migration0014
   changes auth records; never apply it blindly. Never push local Supabase auth URLs to production.
3. Export and reconcile counts with synthetic dry runs before any private data migration. Keep old data
   as the rollback source; no new application may widen access because a content link exists.
4. Preserve the existing live v7 registry record read-only. Verify current code/getters/owner/policy/template,
   deployment block and V1 resolver/finality on a local mainnet fork. New policies/templates need exact
   immutable byte review and verified publication. Never reuse a latest ABI for an older version.
5. Prepare exact future transaction/deployment/migration/hosting actions and rollback considerations.
   Obtain explicit authorization for production broadcasts, real Court cases, provider writes, guest
   submissions/messages, public IPFS publication, DNS/hosting changes or upstream publishing.
6. If booth migration is later requested, first isolate event/environment queues and quarantine legacy
   payloads; demo-origin work must never become deliverable after switching to live configuration.
   Fix server validation, scoped uniqueness and consent/merch reporting, then rehearse a private export.

Credentials and production authorization are intentionally not prerequisites for the passing local demo.
