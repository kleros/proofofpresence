# Local workbench API

All mutations require same-origin JSON and a session cookie. This server supports **local demo only**; selecting demo identities is intentionally a local simulation of authentication. A real wallet can additionally sign a nonce to authenticate on this local chain. No live registry entry is writable.

- `GET /api/bootstrap` → `{mode:'local-demo', identities:[{id,label,wallet}], session:{wallet,label,mode}|null, events:[EventSummary], chain:{chainId:1337,rpcUrl}, now}`. Seed IDs `event-a`, `event-b`; identities `organizer-a`, `organizer-b`, `staff-a`, `alice`, `bob`, `carol`. Events include id, slug, title, description, startsAt, endsAt, timezone, location, depositWei, contract, chainId, financialPhase, role, visibility, editorialStatus, registrationStatus, lumaUrl/contentUrl optional.
- `POST /api/session` `{identity:'alice'}` → session (demo signers only).
- `DELETE /api/session` → logged out.
- `POST /api/auth/challenge` `{wallet}` → a single-use nonce plus a message bound to domain, URI, chain1337, wallet and expiry. `POST /api/auth/verify` `{nonce,signature}` verifies an EOA signature server-side and sets a wallet session. Entered email remains a declared contact. `POST /api/demo/fund` `{}` explicitly supplies 1 valueless local ETH to that verified wallet if its balance is below1ETH.
- `GET /api/events/:id` → `{event, state, participants, imports, attendance, personal, transactions, permissions, now}`. state: `{phase,owner,pendingOwner,depositWei,poolWei,balanceWei,reservedWei,heldBackWei,owedTotalWei,challengeEscrowWei,stakerCount,attendeeCount,challengeEndsAt,challengeDepositWei,stakers,attendees,cases:[{wallet,state,matcher,matchEndsAt,depositWei,localDisputeID,arbitratorDisputeID,heldShareWei,finalRuling,caseURI,publication,appeal}],fingerprint}`. participants for authorized owner/staff: `{id,name,email,wallet,admission:'pending'|'approved'|'declined'|'free',deposit:{txHash,logIndex,amountWei,verified}|null,registered,attended,owedWei}`; own participant visible to attendee. Every participant has eventId.
- `POST /api/events` demo session `{title,slug,description,timezone,location,startsAt,endsAt,depositEth:'0.01'}` → newly deployed **local** v7 event. The creator becomes organizer/contract owner. Free participation available at every event. Optional validated `lumaEventId/lumaUrl/contentEventId/contentUrl` map linked modules. Caller-supplied stable IDs are rejected. `PATCH /api/events/:id` owner-only edits description/location/editorialStatus/visibility/registrationStatus and those associations; financial terms stay immutable. Draft editorial content is hidden from outsiders while linked participants retain financial access.
- `POST /api/events/:id/participants` `{name,email}` → self-registration linked to authenticated wallet (or `{name,email,participantId?,admission}` owner edits existing admission). Identity is never inferred from arbitrary pasted wallet. Seed Alice/Bob/Carol are already linked in both events.
- `PATCH /api/events/:id/participants/:participantId` `{admission:'approved'|'declined'|'free'|'pending'}` owner only.
- `POST /api/events/:id/deposits` `{txHash}` verifies own wallet successful receipt/log/chain/contract/amount and links to participant. Successful demo `deposit` action does this automatically. Owner can pass participantId for imported registration after signed wallet proof or prelinked identity.
- `POST /api/events/:id/checkins` `{participantId,nonce,source:'staff-door',note}` → authenticated owner/staff observation; replay nonce rejected; participant must be linked to wallet. No merch/history fields accepted as authority.
- `POST /api/events/:id/personal` `{attended:true}` self-reported history only.
- `POST /api/events/:id/imports` `{kind:'attendance'|'guests',csv,sourceEventId?,review?:{confirmed:true,note}}` → `{batch,rows,errors,limitation}`. CSV columns `event_id,chain_id,contract,participant_id,email,wallet,checked_in_at,tx_hash,admission`; known mismatches rejected even when review supplied. Unstamped raw CSV requires owner provenance review. Attendance rows must map to existing linked participant; owner review recorded. Test import synthetic fixture downloadable `GET /api/events/:id/fixture?kind=attendance|guests`.
- `POST /api/events/:id/drafts` `{action,params:{...}}` → `{id,eventId,action,wallet,chainId,contract,valueWei,method,args,summary,expiresAt,snapshot,transaction:{to,data,value,chainId}}`. Actions: `deposit`, `register`, `reject` (`wallets` optional filtered eligible), `postAttendance` (server uses trusted observations and computes share), `challenge`, `match` `{wallet}`, `addAttendees` `{wallets}`, `resolve` `{wallet}`, `release`, `cancel`, `emergencyWithdraw` `{to?}`, `claim` `{to?}`, `refund` `{to,amountWei}`, `sweep` `{to}`, `transferOwnership` `{to}`, `acceptOwnership`, `evidence` `{wallet,uri}`, `fundAppeal` `{wallet,side:0|1|2,amountWei}`, `appealRewards` `{wallet,sides:[0,1,2]}`. Every action simulates, checks identity, authority, and contract state. `register` excludes unverified/unapproved/free/duplicate financial evidence. `postAttendance` requires all unresolved admission decisions addressed and nonempty registered trusted attendance. Immutable registry terms shown in every preview.
- `POST /api/events/:id/drafts/:draftId/execute` `{}` sends **local** transaction using authenticated demo identity; rejects stale/wrong event/wallet/chain/used draft; returns `{hash,status:'confirmed',blockNumber,action}`; UI show preparing → awaiting review → submitting → confirmed / error. For signed wallet sessions `POST .../validate` `{}` revalidates and returns the raw exact transaction object; client rechecks wallet/chain and sends through its wallet. Then `POST .../confirm` `{hash}` validates exact canonical receipt, wallet/chain/target/calldata/value, registry/revision/expiry, post-review block and duplicate hash.
- `POST /api/events/:id/cases/:wallet/publish` `{}` exact on-chain case bytes verified and stored locally → `{uri,status:'local-only',sha256}`; no IPFS network write. Failed/retry status visible. Production IPFS service remains in retained legacy modules and requires rollout authorization.
- `POST /local-upload` same-origin authenticated multipart `data` file up to one256KiBIPFS block → `{path,status:'local-only'}`; `GET /local-ipfs/ipfs/:cid` returns exact locally stored bytes. No public pin or external write is implied. Generated local guest/console pages use chain time for financial eligibility while retaining wall-clock transaction timeouts.
- `POST /api/demo/advance` `{seconds:...}` local-chain time only, bounded 1..30days; all sessions allowed in explicit demo. Useful buttons: `+1 hour`, `+1 day`, `+15 days`.
- `POST /api/events/:id/demo/ruling` `{wallet,ruling:0|1|2}` owner only; writes to **mock** KlerosLiquid then still requires `resolve` action for real contract settlement. `POST .../demo/appeal` `{wallet,ruling,duration:3600}` opens mock voting/appeal period. These endpoints never exist for a live deployment.

All API failures JSON `{error,code}` with HTTP 400/401/403/404/409. Amounts integer strings in wei, times Unix seconds; public schedule ISO+IANA timezone. Dates from local chain are explicit demo time. Root /finance/:id/guest/ and /finance/:id/console/ retain advanced v7 financial surfaces with scoped config and local endpoints; shared UI primary actions above.

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
