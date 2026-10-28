# Workbench API

The explicit v8 extension supports `CONTRACT_VERSION=kleros-event-v8` for a synthetic demo, or
`MODE=testnet|hosted-testnet` for the reviewed Chiado manifest. Historical v7 remains the default.
See [TESTNET_REHEARSAL](TESTNET_REHEARSAL.md) for deployment and clock boundaries.

For v8, event summaries declare `contractVersion` and participant details expose authoritative
`pendingCreditWei`; authenticated detail also returns `ownWallet:{wallet,owedWei,pendingCreditWei}`
independently of contact/participant registration, read at `state.blockNumber`. Anonymous detail returns
`ownWallet:null`; v7 omits its inapplicable pending-credit field. The signed wallet is included in
v8 credit reads even after a plain transfer without an app record. Snapshots additionally expose
`pendingTotalWei`, `pendingCredits` by lowercase
wallet, lifetime admission count and remaining slots. `withdrawPending` drafts accept `{to,amountWei}`
and recover only the signer's unused credit. Credit withdrawals are separate log-backed payments.
Returned/recovered receipt evidence cannot be reused for admission. Aggregate credit consumed into
an admitted principal stays valid when its remaining unused excess is recovered.

Testnet bootstrap has chain10200, Chiado/XDAI metadata, no synthetic identities and a controlled-
arbitrator notice. Nonce signatures bind that actual chain and origin. Wallets sign externally;
the server has no unlocked accounts or signing keys. Demo session/faucet/time/ruling endpoints are
forbidden, `/rpc` is read-only, and v7 compatibility pages return `WRONG_VERSION`. Registrations,
drafts, imports and transaction recovery records use a private manifest-bound state file. Hosted
testnet uses Secure cookies, the existing fixed-destination gateway and one persistent volume.

All application mutations require same-origin JSON and a session cookie. The default server supports
the loopback local demo; explicit `hosted-demo` adds the protected HTTPS deployment described below.
Selecting demo identities intentionally simulates authentication. A real EOA can sign a nonce to prove
wallet control on the synthetic chain. No mainnet registry entry is writable.

- `GET /api/bootstrap` → `{mode:'local-demo', identities:[{id,label,wallet}], session:{wallet,label,mode}|null, events:[EventSummary], chain:{chainId:1337,rpcUrl}, now}`. Seed IDs `event-a`, `event-b`; identities `organizer-a`, `organizer-b`, `staff-a`, `alice`, `bob`, `carol`. Events include id, slug, title, description, startsAt, endsAt, timezone, location, depositWei, contract, chainId, financialPhase, role, visibility, editorialStatus, registrationStatus, lumaUrl/contentUrl optional.
- `POST /api/session` `{identity:'alice'}` → session (demo signers only).
- `DELETE /api/session` → logged out.
- `POST /api/auth/challenge` `{wallet}` → a single-use nonce plus a message bound to domain, URI, chain1337, wallet and expiry. `POST /api/auth/verify` `{nonce,signature}` verifies an EOA signature server-side and sets a wallet session. Entered email remains a declared contact. `POST /api/demo/fund` `{}` explicitly supplies 1 valueless local ETH to that verified wallet if its balance is below1ETH.
- `GET /api/events/:id` → `{event, state, ownWallet, payments, participants, imports, attendance, personal, transactions, permissions, now}`. state: `{phase,owner,pendingOwner,depositWei,poolWei,balanceWei,reservedWei,heldBackWei,owedTotalWei,challengeEscrowWei,stakerCount,attendeeCount,challengeEndsAt,challengeDepositWei,stakers,attendees,cases:[{wallet,state,matcher,matchEndsAt,depositWei,localDisputeID,arbitratorDisputeID,heldShareWei,finalRuling,caseURI,publication,appeal}],fingerprint}`. participants for authorized owner/staff: `{id,name,email,wallet,admission:'pending'|'approved'|'declined'|'free',deposit:{txHash,logIndex,amountWei,verified}|null,registered,attended,owedWei}`; own participant visible to attendee. Every participant has eventId.
- `POST /api/events` demo session `{title,slug,description,timezone,location,startsAt,endsAt,depositEth:'0.01'}` → newly deployed **local** v7 event. The creator becomes organizer/contract owner. Free participation available at every event. Optional validated `lumaEventId/lumaUrl/contentEventId/contentUrl` map linked modules. Caller-supplied stable IDs are rejected. `PATCH /api/events/:id` owner-only edits description/location/editorialStatus/visibility/registrationStatus and those associations; financial terms stay immutable. Draft editorial content is hidden from outsiders while linked participants retain financial access.
- `POST /api/events/:id/participants` `{name,email}` → self-registration linked to authenticated wallet (or `{name,email,participantId?,admission}` owner edits existing admission). Identity is never inferred from arbitrary pasted wallet. Seed Alice/Bob/Carol are already linked in both events.
- `PATCH /api/events/:id/participants/:participantId` `{admission:'approved'|'declined'|'free'|'pending'}` owner only.
- `POST /api/events/:id/deposits` `{txHash}` verifies own wallet successful receipt/log/chain/contract/amount and links to participant. Successful demo `deposit` action does this automatically. Owner can pass participantId for imported registration after signed wallet proof or prelinked identity.
- `POST /api/events/:id/checkins` `{participantId,nonce,source:'staff-door',note}` → authenticated owner/staff observation; replay nonce rejected; participant must be linked to wallet. No merch/history fields accepted as authority.
- `POST /api/events/:id/personal` `{attended:true}` self-reported history only.
- `POST /api/events/:id/imports` `{kind:'attendance'|'guests',csv,sourceEventId?,review?:{confirmed:true,note}}` → `{batch,rows,errors,limitation}`. CSV columns `event_id,chain_id,contract,participant_id,email,wallet,checked_in_at,tx_hash,admission`; known mismatches rejected even when review supplied. Unstamped raw CSV requires owner provenance review. Attendance rows must map to existing linked participant; owner review recorded. Test import synthetic fixture downloadable `GET /api/events/:id/fixture?kind=attendance|guests`.
- `POST /api/events/:id/drafts` `{action,params:{...}}` → `{id,eventId,action,wallet,chainId,contract,valueWei,method,args,summary,expiresAt,snapshot,transaction:{to,data,value,chainId}}`. Actions: `deposit`, `register`, `reject` (`wallets` optional; every explicitly selected wallet must remain eligible), `postAttendance` (server uses trusted observations and computes share), `challenge`, `match` `{wallet}`, `addAttendees` `{wallets}`, `resolve` `{wallet}`, `release`, `cancel`, `emergencyWithdraw` `{to?}`, `claim` `{to?}`, `refund` `{to,amountWei}`, `sweep` `{to}`, `transferOwnership` `{to}`, `acceptOwnership`, `evidence` `{wallet,uri}`, `fundAppeal` `{wallet,side:0|1|2,amountWei}`, `appealRewards` `{wallet,sides:[0,1,2]}`. Every action simulates, checks identity, authority, and contract state. `register` excludes unverified/unapproved/free/duplicate financial evidence. An explicit `register`/`reject` selection validates those exact wallets without silently dropping a selected row or inspecting unrelated unselected returned receipts. `postAttendance` requires all unresolved admission decisions addressed and nonempty registered trusted attendance. Immutable registry terms shown in every preview.
- `POST /api/events/:id/drafts/:draftId/execute` `{}` sends **local** transaction using authenticated demo identity; rejects stale/wrong event/wallet/chain/used draft; returns `{hash,status:'confirmed',blockNumber,action}`; UI show preparing → awaiting review → submitting → confirmed / error. For signed wallet sessions `POST .../validate` `{}` revalidates and returns the raw exact transaction object; client rechecks wallet/chain and sends through its wallet. Then `POST .../confirm` `{hash}` validates exact canonical receipt, wallet/chain/target/calldata/value, registry/revision/expiry, post-review block and duplicate hash.
- `POST /api/events/:id/cases/:wallet/publish` `{}` exact on-chain case bytes verified and stored locally → `{uri,status:'local-only',sha256}`; no IPFS network write. Failed/retry status visible. Production IPFS service remains in retained legacy modules and requires rollout authorization.
- `POST /local-upload` same-origin authenticated multipart `data` file up to one256KiBIPFS block → `{path,status:'local-only'}`; `GET /local-ipfs/ipfs/:cid` returns exact locally stored bytes. No public pin or external write is implied. Generated local guest/console pages use chain time for financial eligibility while retaining wall-clock transaction timeouts.
- `POST /api/demo/advance` `{seconds:...}` local-chain time only, bounded 1..30days; all sessions allowed in explicit demo. Useful buttons: `+1 hour`, `+1 day`, `+15 days`.
- `POST /api/events/:id/demo/ruling` `{wallet,ruling:0|1|2}` owner only; writes to **mock** KlerosLiquid then still requires `resolve` action for real contract settlement. `POST .../demo/appeal` `{wallet,ruling,duration:3600}` opens mock voting/appeal period. These endpoints never exist for a live deployment.

API failures return JSON `{error,code}` with an appropriate HTTP error status. Amounts are integer
strings in wei. Chain `now` and financial deadlines use Unix seconds; auth challenges, transaction
reviews and import previews use wall-clock milliseconds for `createdAt`/`expiresAt`. Public schedules
use ISO dates plus an IANA timezone. Chain dates are explicit demo time. Root `/finance/:id/guest/`
and `/finance/:id/console/` retain advanced v7 surfaces with scoped config and local endpoints.

`passPeriod` and `deliverRuling` are additional reviewed participant actions with `{wallet}`. They call
the arbitrator using its dispute ID to advance an expired appeal and deliver the final vote to the
resolver. The resolver's one-sided funding override still decides finality; `resolve` applies it to the
event separately. These are permissionless contract operations and do not choose a new vote.

Cases additionally expose `matched` and `outcome`. An expired unmatched case has
`outcome:'attended-unmatched'` and null resolver/arbitrator IDs, finalRuling, caseURI and appeal data.
It never reads or acts on resolver case0. Evidence, appeal, rewards and publication require an actual
nonzero matcher. HTTP demo login instances use unique internal session IDs even for the same wallet.

New core integration interfaces:

- Bootstrap includes `instanceId`; persisted transaction context must include it alongside mode,
  stable event ID, chain, contract/ABI version and wallet. Restarted deterministic demo chains are separate environments.
- `POST /api/events/:id/imports/preview` accepts the existing CSV input and returns an opaque,
  five-minute `id/previewId`, proposed rows, exact received-text source hash, parser/config hash,
  revision/block/fingerprint and `originReviewRequired`. It makes no record mutations.
  `POST /api/events/:id/imports/:previewId/commit` `{review:{confirmed:true,note}}` atomically revalidates
  stored bytes, current owner/session/deployment/revision/state, then applies once. No acknowledgement
  overrides known mismatches or stale data. Direct `/imports` remains a compatibility interface.
- Detail includes `payments`: canonical-block-bound successful direct attendance payouts, principal
  refunds, spare returns/sweeps, failed credits and separately reported claims. Read its semantics and
  limitations; a sent total must never be derived from current pool/balance/reserves.
- `POST /api/events/:id/drafts/:draftId/submitted` `{hash}` records a scoped pending reference without
  verifying admission/deposit or changing financial state. It checks an available transaction against
  exact reviewed terms and blocks reuse of the review/another pending deposit. `GET
  /api/events/:id/submissions/:hash` reports the wallet's canonical receipt state. A mined reference
  remains distinct from `/confirm`, which verifies and records the reviewed action exactly once.
- `public/transaction-context.js` supplies a nonvisual signing/journal helper. It captures original
  context, revalidates before signing, durably saves the returned hash before async confirmation, never
  resends automatically and preserves hashes on navigation or post-submission errors. Integrate it with
  the redesigned view's pending-reference presentation.

`POST /api/events/:id/submissions/reconcile` `{draftId,hash}` is a factual receipt-recovery operation
for the same authenticated wallet, including a new session or an expired review. It verifies original
reviewed terms, deployment, sender, chain and canonical post-review receipt. It never revives signing
authority or broadcasts. It returns pending/confirmed/failed and idempotently updates receipt projections;
a valid deposit can regain its verified identity link. Reverted receipts are terminal failed journal
states. Successful manual deposit linking also resolves its pending record, so a later genuine refund
does not permanently block readmission. New UI requests fail before wallet signing when durable journal
storage is unavailable; post-submission errors always retain the returned hash.

## Contract deposit inbox

V8 bootstrap advertises `capabilities.contractInbox:true`. The owner UI uses this read-only source;
historical v7/staff views retain their existing receipt presentation. The inbox endpoints authorize
the **current on-chain event owner** before cache access and again before disclosure. Staff,
participants and an owner of another event cannot read its contacts. An unavailable ownership check
returns HTTP 503 `INBOX_OWNER_UNAVAILABLE` without cached inbox data.

- `GET /api/events/:id/deposit-inbox` → HTTP200 inbox status.
- `POST /api/events/:id/deposit-inbox/refresh` `{}` → the same status shape. Extra fields are rejected.
  Refresh is informational and cannot approve, register, refund or submit a transaction.

The status contains `source:'contract'`, `eventId`, `chainId`, `contract`, `contractVersion`,
`indexedBlock:{number,hash,timestamp}|null`, `latestBlock`, `lastSyncedAt`, `nextRefreshAt`, `stale`,
`error:{code,message}|null`, `syncing`, `actionable`, `counts:{payers,linked,unlinked,transactions}` and
`rows`. `indexedBlock.timestamp` is chain Unix seconds; `lastSyncedAt` and `nextRefreshAt` are ISO
wall-clock strings, with `lastSyncedAt:null` before a completed index. `counts.transactions` counts
unique transaction hashes rather than individual deposit logs.

Each wallet row includes `participantId`, `name`, `email`, `linked`, `receiptLinked`, `actionable`,
`registered`, `registrationState`, `transactions` and the following decimal wei strings:

| Field | Meaning at the indexed block |
| --- | --- |
| `receivedWei` | Historical canonical deposit lots from this payer. |
| `pendingCreditWei` | Current v8 payer-owned unused credit; `null` for v7. |
| `committedPrincipalWei` | Current registered principal before ordinary payout/cancellation. |
| `registrationBasisWei` | Historical admission basis, not a recoverable balance. |
| `returnedWei` | Delivered direct principal/spare returns and pending-credit withdrawals. |
| `unallocatedWei` | V8 pending credit; v7 aggregate-spare allocation, not payer-owned credit. |
| `owedWei`, `heldShareWei` | Separate current owed credit and reserved case share. |
| `attendancePaidWei`, `creditWithdrawnWei`, `claimsPaidWei` | Separate delivered payment categories; fungible claims are not relabelled attendance or direct principal returns. |

These observations overlap and must not be added as disjoint obligations. Unknown payers have
`participantId/name/email:null` and `linked:false`. Contacts require an identity-verified participant
with the exact stable event and wallet. `receiptLinked` reports an application deposit link separately;
a transfer alone does not establish identity, admission or contract registration.

Each transaction is `{txHash,logIndex,amountWei,blockNumber,blockHash,confirmations,status}`.
`status:'confirmed'` means a successful canonical receipt/log observed with at least two confirmations;
one confirmation is `confirming`. Neither promises finality or unseen mempool coverage. A contract
wallet's canonical `Deposited.from` is the payer even when the outer sender differs.

The informational cache is scoped to environment/server instance and the full deployment identity,
with 30-second refresh and a 5-second manual minimum. Reuse verifies provenance and the canonical
indexed anchor; concurrent reads share one bounded index attempt. Transient index failures can return
HTTP200 with stale last-good rows, an error and `actionable:false` on the status and each row. A proven
orphan instead clears rows and the indexed anchor; failed rebuilding reports `INBOX_REORG`,
`indexedBlock:null`. An initial failed index is empty/stale. `actionable:true` is a UI hint, never
financial signing authority. Financial drafts do not consume this cache. See
[inbox accounting and bounds](CONTRACT_DEPOSIT_INBOX.md).

## Separate batch admission and trusted check-in

V8 bootstrap advertises `capabilities.batchActions:true`. Authorized event details include
`participants[].batchEligibility` with `approve-admission` and `check-in` entries containing
`{eligible,reasonCode,reason}`. These current hints are revalidated by the server for every preview
and commit; clients must not infer eligibility from a name, historical receipt total or staker status.

| Action | Current required role | Saved app effect |
| --- | --- | --- |
| `approve-admission` | Event contract owner | Exactly the selected eligible admissions become `approved`; current canonical unreturned deposit evidence and phase `Open` are required. |
| `check-in` | Event owner or event-specific trusted staff | Exactly the selected linked participants receive `staff-door` observations at actual chain time, during event hours, with reviewer and replay-safe nonces. Free guests are allowed. |

Neither operation registers stakers, publishes financial attendance or transfers funds. Luma approval
is manual outside this app. Contract registration and attendance posting remain separately reviewed,
simulated and signed `register`/`postAttendance` actions.

`POST /api/events/:id/batches/preview` accepts only:

```js
{ action: 'approve-admission' | 'check-in',
  items: [{ participantId: null | 'exact-event-participant-id', wallet: '0x…' }],
  nonce: 'unique-request-nonce', note: 'optional staff note' }
```

Select 1–150 unique valid wallets and unique non-null participant IDs. Nonces are 8–64 characters;
notes are at most 500 characters. Unknown/unverified/mismatched wallet links stay explicit blocked
rows with no contact disclosure. HTTP201 returns
`{id,eventId,action,nonce,actorWallet,chainId,contract,contractVersion,revision,snapshot,blockNumber,expiresAt,counts,canCommit,tokenStatus,rows,requiresFinancialTransaction:false,consequences}`.
`counts` is `{selected,eligible,blocked}`; every row is
`{participantId,wallet,name,email,eligible,reasonCode,reason}`. `tokenStatus` is `ready` or `blocked`.
`expiresAt` is wall-clock Unix milliseconds, five minutes after creation. Preview makes no app-record
or financial mutation and rechecks current role after asynchronous receipt validation.

`POST /api/events/:id/batches/:batchId/commit` requires `{nonce,confirmed:true}`. Applying a pending
review is bound to its original authenticated session, actor wallet, event, deployment, app revision,
selected records, canonical financial snapshot and expiry. All selected rows must remain eligible;
there is no silent filtering or partial apply. One complete mutation/audit/revision is saved atomically;
synchronous save failure rolls back admissions, observations, nonce use and audit/revision changes.
HTTP200 returns:

```js
{ id, eventId, action, status: 'committed', appliedCount, participantIds,
  observationIds, committedAt, chainId, contract, contractVersion, actorWallet,
  requiresFinancialTransaction: false,
  nextAction: 'review-staker-registration' | 'review-post-attendance', replayed }
```

`committedAt` is an ISO wall-clock string. Approval has no observation IDs; check-in returns one per
selected person. A previously committed audit result is idempotently returned for the original
wallet/nonce after current-role authorization, including after a new login; it never reapplies.
Typical rejection codes include `BATCH_SCOPE`, `STALE_BATCH`, `BATCH_IN_PROGRESS`,
`ATTENDANCE_TIME_MISMATCH`, `REPLAY` and `BATCH_LIMIT`. Role failures remain HTTP401/403.

`GET /api/events/:id/batches/:batchId` is authenticated recovery. The original wallet may read with a
fresh valid session, but must still hold the action's current role. A completed batch returns the
committed result above with `replayed:true`. Otherwise HTTP200 returns only
`{id,eventId,action,actorWallet,chainId,contract,contractVersion,status,requiresFinancialTransaction:false}`,
without contacts, selected rows or nonce:

| Status | Recovery meaning |
| --- | --- |
| `ready`, `blocked` | A review is known; this does not settle an uncertain earlier save. |
| `committing` | This exact token is actively committing, including after its TTL has elapsed. |
| `expired` | A known stale/expired, uncommitted token has been permanently retired before this response. A delayed POST cannot revive it after clock rewind or restored state. |
| `unknown` | No known live token/completed receipt; `action:null`. Missing state or restart is ambiguous, not proof that no save occurred. |

Status rechecks completion after authorization awaits, preventing a completed batch from being
misreported as expired. Only a fully scoped committed result or known terminal `expired` response
resolves an uncertain save. Ready/blocked/committing/unknown, HTTP404, elapsed client time or a server
restart cannot release that uncertainty by themselves. Never automatically retry the commit POST.

The UI injects [the durable batch journal](../public/batch-pending.js). It saves/readbacks a contact-free
intent marker **before** sending the one commit request; storage failure visibly locks saving. The
marker retains batch ID/nonce, selected participant IDs/wallets, phase and original scope, without
names, emails, cookies or signing keys. Origin, event, wallet, chain, contract/version and action remain
isolated. External Chiado markers can survive a backend-instance replacement for the same deployment;
ephemeral chain 1337 markers stay instance-specific. A full reload restores the lock and requires
explicit authenticated status GET; missing status keeps it locked. Remove only the expected marker
after validated committed/terminal-expired recovery, preserving independent submitted financial
journals. Saving approval offers a separate explicit registration review for its exact approved set;
changed eligibility blocks that whole set with reasons.

### Integration provenance and local evidence

The portable inbox/batch assets came from UI source
`1b0ea0e1f6c3638e848ba6c2c59494dc3ab1ecb0`; [verified delivery and integrated hashes](../artifacts/portable-batch-assets-sha.json)
record the five assets and compatibility patches. The current core controller was preserved.
[Batch browser evidence](../artifacts/screenshots/batch-actions-app/results.json) records 28 checks from
`node test/batch-actions-app.e2e.mjs`; [inbox browser evidence](../artifacts/screenshots/contract-inbox-app/results.json)
records 26 from `node test/contract-inbox-app.e2e.mjs`. These used real isolated local v8 contracts,
HTTP and nonce authentication. The batch suite deliberately dropped one successful commit response
to verify reload/GET-only recovery; the inbox orphan-error client branch used a controlled transport
fixture. They do not establish public-testnet batch operation or payout completion. No tests were
rerun solely for this documentation update.

## Explicit hosted demo transport

`MODE=hosted-demo` requires exact HTTPS `PUBLIC_ORIGIN`/`BACKEND_ORIGIN` and a generated server-only
`PROXY_SECRET`. Only minimal `GET /healthz` is public at the backend; every other route requires the
exact backend Host and constant-time proxy-key verification. The Netlify gateway preserves actual API
write Origins, private/no-store responses and Secure/HttpOnly/SameSite session cookies. It never sends
the key to the browser. Nonce messages use the public HTTPS URI/domain.

Bootstrap returns `mode:'hosted-demo'`, shared-demo capabilities and an absolute same-origin RPC URL.
`chain.instanceMarker:{blockNumber,blockHash}` identifies a random zero-value self-transfer created
for this process. Browser and advanced-page wallet requests verify it before signing, distinguishing
this sandbox from another wallet RPC with the same1337 chain ID. Restart changes this identity.

`POST /rpc` accepts bounded public chain reads plus `eth_sendRawTransaction` for signed chain1337
transactions targeting this demo's registered event/resolver/arbitrator contracts (gas≤6million,
data≤64KiB, type0/1/2, at most one signed transaction per batch). No unlocked `eth_sendTransaction`,
admin operation or foreign-chain send is allowed. The gateway deliberately makes only this RPC route
public/CORS-readable and cookie-free, normalizing its transport Origin without authorizing API writes.
`OPTIONS /rpc` supplies its preflight. Root local-demo RPC remains read-only.

These are shared synthetic demo semantics, not production auth/durability. See
[HOSTED_DEPLOYMENT](HOSTED_DEPLOYMENT.md) for the concrete rollout and current deployment status.
