# Compact Luma launch UI handoff

29October2026. Isolated branch codex/kleros-ui-ux-speed-audit, worktree
/Users/hashmanansala/.codex/worktrees/kleros-ui-ux-speed-audit/Kleros projects.
Launch UI starting checkpoint:0a6fbda0e20b51dd4957aa84fc6b2a4acb24222e.
Status: locally validated compact UI is frozen for primary integration review.
Core alone owns integration, actual backend/proxy validation, wallet deployment and hosting.
This chat has not requested a mainnet signature, sent a transaction, published the app or changed
old preview sites, financial operators or schedules.

## Public source

- public/app.js and index.html: production-only compact root and event journeys, wallet-first
  participant state, exact authoritative deposit amount, scoped receipt confirmation/Luma return,
  contextual financial rights, compact authorized organizer operations and setup lifecycle.
- public/luma-launch.js: strict selected-event Luma URL and direct scoped receipt presentation guard.
- public/luma-setup.js: organizer form, immutable-term review, existing generic wallet submission,
  canonical child adoption/share card, durable uncertainty/restart recovery and explicit next event.
- public/luma-factory.js: factory-only trust/policy checks, exact creation draft/validation/receipt
  scope and same-origin canonical participant URL guard.
- public/luma-launch.css: scoped compact teal presentation using existing local fonts and tokens.
- public/environment.js: exports the existing reviewed upgrade verifier for the factory helper.
- src/server.mjs: isolated test-server allowlist only for the four new public assets. Core must
  retain its newer server and add corresponding paths itself, not copy this old backend wholesale.
- test/luma-launch-guards.test.mjs:12pure guard tests passed.
- test/luma-launch.e2e.mjs and test/fixtures/luma-launch-fixture.mjs: strict loopback UI and stubbed
  user-wallet protocol coverage, final26browser groups and14offline fixture cases passed.

## Participant behavior

Cold #event=stable-id&view=participant opens one compact selected event, native ETH commitment,
wallet connect and exact reviewed deposit. Production has no guest name/email signup, free-entry
registration, content/history/marketing surfaces, event directory or general event editing.
The root offers Deposit for your event and Set up kickback only; it does not enumerate private events.

The server supplies ownWallet.depositAction{eligible,amountWei,reasonCode,reason}. UI displays and
reviews that exact amount; it does not invent remaining-credit financial rules. Full credit,
registered commitments, rejected/cancelled events and uncertain submissions do not offer a duplicate
payment. A fresh draft amount must still agree with that authoritative review context.

ownWallet.deposit uses DIRECT fields{status,hash?,amountWei?,blockNumber?,wallet,eventId,chainId,
contract,abiVersion}. Only a fully matching current-wallet/event receipt with supported final status,
positive exact amount, hash and canonical block can present confirmation. Historical returned funding,
wrong/missing scope, pending wallet request, submitted hash, failed receipt and cancellation are distinct.

Return to Luma uses only the selected event's server-validated HTTPS luma.com association, with no
credentials, query or fragment. It never reads arbitrary returnUrl query input or appends wallet,
email or transaction data. The user may copy the full confirmed transaction ID manually. There is no
automatic redirect, native Luma API integration or admission assertion.

Unused payer credit, owed-credit claims, cancellation, no-list recovery, omission challenge,
case settlement/evidence/appeal and actual payout facts remain available contextually. Organizer
approval, financial registration and trusted check-in remain separate actions. The wallet-first
participant is walletVerified, not a verified Luma identity; legacy identity gates remain unchanged.

## Canonical attendance terms

The final follow-up accepts exactly these three own string fields, without aliases:

```json
{"attendanceMode":"event-participation","attendanceRule":"presence-during-immutable-interval-v1","evidenceRule":"balance-of-probabilities-with-case-organizer-confirmation-v1"}
```

Core supplies this standard at bootstrap.organizerSetup.attendanceStandard,
selectedDetail.event.attendanceStandard and creationDraft.terms.attendanceStandard. Creation terms
must exactly match the verified bootstrap standard. Missing or unsupported metadata blocks new
production deposits and creation before a wallet request. Existing receipt recovery, owed-credit
claims and contextual financial rights remain available.

Read-only terms explain participation in person OR online at some point during the immutable event
interval, with no full-duration minimum. Payment, Luma registration or a personal attendance mark
alone does not prove attendance. Organizer confirmation governs; otherwise the jury applies the
balance of probabilities. The actual posted-list24h challenge deadline applies; the UI does not claim
that the contract enforces the event end time. Text appears in exact material reviews and contextual
contract/terms details, with no new form choice or primary-card clutter. Policy publication, immutable
onchain bindings and verified server metadata remain Core/contract responsibilities.

The shared palette follows the supplied29October references: cyan actions, lavender links/focus and
plum surfaces. Palette source and contrast review remain in Core's docs/UI_COLOR_PALETTE.md.

## Organizer API and sender assumptions

Bootstrap capabilities:lumaDepositPortal, walletFirstDeposits, createEvents plus strict existing
production wallet capabilities. bootstrap.factory has chainId,address,contractVersion,abiVersion,
verified,deploymentTrust and upgrade. bootstrap.organizerSetup has policyURI, policySha256,
policyStatus verified|unpublished, challenge/match86400 and minimumClaimDays7 and the canonical attendanceStandard above. A factory-only bootstrap
may have events[]empty and event transactionsReady false while independently verified createEvents
is true. An unpublished/unverified policy or factory blocks creation before any wallet request.

POST /api/organizer/events/drafts accepts ONLY title,lumaUrl,startsAt,endsAt,timezone,depositEth.
Browser-local datetime is converted to explicit UTC ISO; browser IANA zone is shown read-only.
The immutable review includes fixed150 capacity,7-day claim term, one-day challenge/match windows,
exact ETH/wei, dates, policy/hash, wallet/factory, chain, gas estimate and expiration.

Creation drafts use stable preassigned eventId (distinct from eventKey), contract=factory address,
abiVersion v9-uups, mode hosted-production, action createEvent and valueWei0. createdAt/expiresAt are
milliseconds; reviewBlock is a numeric height. SHA256 fingerprints are64hex without0x. Validation
returns{draft,transaction}; submitted/reconcile take{hash}; GETdraft is wallet-scoped. Final canonical
reconciliation must keep the same eventId and include hash,wallet,chainId,blockNumber, actual child
contract and same-origin/#event=id&view=participant URL. The child is verified from EventCreated,
never guessed from a deployer nonce. Core owns exact source/provenance and durable onboarding.

The setup reuses createTransactionJournal/submitWalletDraft without introducing another sender.
The server gasLimit is displayed as an estimate; the existing wallet sender lets the wallet estimate
network gas. No backend signer, sandbox execute or automatic resend is introduced.

## Restart and recovery

A wallet-requested marker is durable BEFORE requesting a send. Known wallet hashes remain immutable.
After a backend instance changes, bounded old matching local markers are discovered only for the same
origin/mode/chain/factory/profile/wallet, preserving the ORIGINAL journal instance for receipt-only
recovery. No old unsigned review gains signing authority. Uncertain records block fresh creation.
Pure unsigned prepared records can be replaced by a fresh current review.

Manually typed unknown hash candidates are not bound to the once-only journal before authoritative
canonical terminal proof. A typo/foreign hash remains repairable; pending/error never permits a new
send. An explicit next-event action appears only after fresh canonical terminal adoption, clears only
the active setup pointer, preserves journal history and rescans other uncertainty before a new form.

## Integration and review boundary

Core/contract lane owns the actual local-proxy browser factory-create→wallet-only deposit→approval→
registration→attendance→dispute→ordinary payout with held share→finality→settlement proof. Synthetic
loopback coverage here complements that proof and does not establish economics, mainnet deployment,
real-wallet extension behavior or real receipt delivery. Final UI source/proof must be copied together;
do not merge this worktree's frozen brain/contracts/runtime or financial artifacts over primary.

Review and serve /luma-launch.js,/luma-launch.css,/luma-setup.js,/luma-factory.js. Preserve all existing
production guards, manifests and financial jobs. The earlier blank Chiado E Netlify site remains
unused; hosting follows Core's current concrete release decision, not this UI worktree's old target.

## Actual verification and limits

- Final npm run typecheck and node scripts/build.mjs: PASS. The build checks the existing pinned
  local v7/v8/test15m context here; Core owns its newer production-contract build.
- node --test test/luma-launch-guards.test.mjs:12/12 PASS on final source.
- node test/luma-launch.e2e.mjs --self-test:14fixture cases PASS, no browser/network.
- node test/luma-launch.e2e.mjs --run-loopback: final26groups PASS. Covers compact root, cold wallet
  entry, direct receipt-scope failures, safe Luma destination, authoritative partial/full/returned
  credit and cancellation, separate organizer operations, exact fresh deposit review, wrong wallet
  and chain, rejection/nohash, one synthetic submitted hash, double-click/reentry without resend,
  setup review, old/current-instance known and unknown hash recovery, repairable foreign candidates,
  fresh terminal-only next event, mobile390/doubled text/keyboard44px. Confirmed Return to Luma is
  within390x844 without scrolling; full reference still copies exactly. The two added groups cover
  known, missing and unknown attendance metadata, exact review text, and preserved owed recovery.
- Exactly TWO fake provider send attempts occurred across explicit local user clicks: one rejection,
  one literal fake submitted hash. No real wallet key, broadcast, public/API/RPC request or factory
  send was used. Organizer sender success still requires the separate actual-proxy integration test.
- Existing local browser compatibility after compact implementation: v7 simpleUI13PASS, v8 simpleUI
  18PASS at compact checkpoint7fd933b. The subsequent attendance guards and supplied palette are
  covered by the final26groups; those legacy suites were not repeated after this follow-up.
- Source whitespace, syntax and formatting passed. Root inspected final desktop root and mobile
  confirmation; agent inspected organizer review and doubled-text captures.

Evidence: artifacts/luma-launch/{results.json,final-provenance.json,final-attendance-run.log,
final-attendance-self-test.log} and11PNGs. Initial fixture-only failures and predecessor24-group proof retained
separately. All tested asset hashes match current source. No broad production/backend suite or actual
proxy economic flow is claimed here; contract/Core lane owns test/luma-launch-flow.e2e.mjs and its
12operation/two-event actual integration, plus current Solidity/provenance and wallet review tests.

Known limit: second browser storage-origin was not mounted in the projection harness; cross-origin
network requests are blocked and pure canonical URL checks cover origin binding. Actual API/private
wallet/event/backend isolation remains a required Core acceptance boundary.

## Remaining release dependencies

1. Core integrates exact public source plus new asset allowlist and finalized wallet-first/factory
   DTOs, then runs the real synthetic proxy browser flow and full relevant server guards.
2. Core binds the canonical mode-neutral attendance standard and exact immutable Luma/date/policy
   terms to verified onchain templates. The UI follow-up is complete and tested against the exact
   three-location DTO above. A generic policy proposal remains unapproved/unpublished; creation
   stays disabled until Core supplies a verified, approved policy URI/hash and matching provenance.
3. Primary alone owns a concrete reviewed wallet deployment and hosting decision. No primary
   source, old site, operator, signing file or schedule was modified by this UI implementation.
