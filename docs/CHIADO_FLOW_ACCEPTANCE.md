# Controlled Chiado full-flow acceptance

Status: **IN PROGRESS — public kickbacks and final settlement have not happened.**
Checkpoint date: 29 October 2026, Asia/Bangkok. This record covers only the existing
synthetic plan `9fe71683-1e9b-48a0-94bd-274da4cf3029` on chain10200. The contract
sources, deployed children, owners and real chain deadlines stay unchanged.

Latest parent checkpoint, **29October2026 around01:55Bangkok**: the public app is
healthy again on source `27377f19f8bf801fd5dd27a86119850f19471de2`. The stronger
observer passed **208** checks, including head balance/reserve/surplus agreement
for forced ETH that emits no child event:
[proof](../artifacts/chiado-flow-audit/2026-10-28T18-54-48-312Z.json).
The current visible A matched-controlled label, organizer snapshot, not-final
ruling and scoped activity copy passed; switching to B clears A and shows no
cases/balance+reserves `2000000000000` wei. Saved PNG/AX evidence is
`artifacts/screenshots/chiado-flow/{a-matched,b-listed}-source27377f1.{png,txt}`.

The receipt checker also passed its historical BobA CLI sanity test with fresh API
phase/head comparisons:
[receipt-checker proof](../artifacts/chiado-deposit-receipt-audit/2026-10-28T18-54-51-409Z-5a0731be-3f69-4e59-b1de-264fea64c7cb.json).
It explicitly reports `uiInitiationVerified:false`. **No C UI deposit or complete
public payout flow is established by these recovery checks.** Core is finishing
authenticated role acceptance before C setup. A final Alice participant assertion
(included financial attendance) was requested in addition to her payout assertion.
The incident/502 evidence below remains historical; healthy app checks supersede
it for current execution readiness, without claiming the global incident resolved.

That Alice assertion is now implemented and the matched role run passed **202**
checks at29October02:02Bangkok:
[archived role proof](../artifacts/testnet-status/matched-2026-10-28T18-58-28-661Z-89fe64a9/proof.json).
The parent independently matched the recorded harness SHA256 to the current file,
confirmed all8desktop/mobile screenshots exist, and visually checked Alice's
included financial attendance and Bob's open dispute/no attendance payout.
Roles were Bob, ownerA and Alice. The run signed/broadcast **zero** contract
transactions, made only wallet-authentication writes and recorded no HTTP failures.
It used restricted Node-held disposable wallets for login, not a wallet extension.
C's actual UI-origin deposit remains pending a separate reviewed event/environment.

## Ownership and evidence boundaries

The **Unify Kleros event deposits** chat is the sole transaction operator. The
**Implement Option B UI redesign** chat reviews UI states in its isolated worktree.
The contract chat independently observes public API/chain facts and visible UI;
it does not sign, broadcast or edit operator journals. These assignments follow
the user's explicit request to coordinate both chats.

The live app is <https://kleros-event-workbench-preview.netlify.app>.
Its manifest is [chiado-v8-controlled](../registry/chiado-v8-controlled.json).
The arbitrator is a deliberately controlled test implementation. This rehearsal
does not demonstrate independent Kleros jury adjudication.

Original deposits and excess-credit recovery were submitted by the operator CLI
and then reconciled through the app. The authenticated browser proof establishes
receipt linkage and status, **not browser-initiated deposit signing**. Bob's later
challenge was initiated through the live UI and produced exactly one broadcast.
Future payout/ruling/settlement CLI execution and browser status checks must also
be described separately. No historical checkpoint should be retroactively called
a fully browser-signed end-to-end flow.

## Confirmed checkpoints

| Step | Required app/chain behavior | Current evidence |
| --- | --- | --- |
| Deposits and admission | Correct event, payer, amount, canonical receipt and separate admission; shared Alice wallet remains isolated between A/B | [Live UI proof](../artifacts/screenshots/testnet-live/proof.json), [app sync](../artifacts/chiado-app-sync-proof.json) |
| Pending-credit recovery | AliceA's excess `1000000000000` wei returns separately from committed principal and attendance payments | Recovery receipt `0x3a4ef03362ac684db7cd961f01ebeb59007cd69ae74ad5f0e7d1dd7f57c19825`; observer canonical payment rows |
| Attendance | A lists Alice/Carol, omits Bob; B lists Alice; phase Listed; no kickback sent | [Attendance proof](../artifacts/chiado-attendance-proof.json) |
| Challenge | Bob UI challenge shows Waiting; no invented local/Court IDs before match; escrow protected | [UI challenge proof](../artifacts/testnet-ui-challenge.json), challenge tx `0xfa6b8126046539d918b1f8a4e3f889e320234c00630664537fb4da53ff62442c` |
| Matched dispute | A Disputed; resolver localID **0** and arbitratorID **1000**; no final ruling; sent/held shares0 before ordinary batch | [Dispute proof](../artifacts/chiado-dispute-proof.json), match tx `0x751979ac5cdfde1822bf47aefd4140861a1f9fb67531098933d403b7a91cb108` |
| Independent observer | API pinned-block facts, current chain, custody/reserve formula, every canonical payment recipient, immutable configuration, and unchanged control B | [Latest observer result](../artifacts/chiado-flow-status.json); inspect its status/timestamp and linked immutable evidence file |
| Current visible UI | Public A Waiting→matched; B Listed/no cases/balance+reserves `2000000000000` wei; controls disabled anonymously | Screenshots and accessibility exports under `artifacts/screenshots/chiado-flow/`; pre-copy-fix names are explicitly historical |

The integration review also found a profile-free payer recovery gap. The core
chat implemented `ownWallet` facts pinned to the same block and a local real-HTTP
plain-transfer regression, including an alternate recovery recipient. This is
local regression evidence; it is not another claimed Chiado deposit.

Parent verification actually run at this checkpoint:

- `node scripts/chiado-flow-audit.mjs --self-test` passed its pure local guards;
  `node test/testnet-status.e2e.mjs --self-test` passed13 phase assertions with
  zero network requests/contract transactions.
- `node scripts/chiado-flow-audit.mjs` passed **198** direct chain/API checks;
  [immutable proof](../artifacts/chiado-flow-audit/2026-10-28T18-07-54-267Z.json).
  It used no wallet, authentication, signature or broadcast. A payout/settlement
  remained ineligible. The earlier190-check proof predates the added active-status
  and eventless-fee guards.
- `git diff --check` passed for the shared working tree. Browser observation used
  the live app, and snapshots are labeled with the UI version actually seen.

These checks do not replace the core app's build/typecheck/Node/browser regression
runs recorded in [TEST_REPORT](TEST_REPORT.md). The parent changed only its observer,
this acceptance record and public evidence; it did not modify app/contract behavior.

## Ordered remaining checkpoints

An existing ACTIVE heartbeat `finish-kleros-testnet-kickbacks` belongs to the core
chat. Its next eligible run is **30 October2026 at00:20 Asia/Bangkok**. The machine
must be awake with Codex running. Re-read actual chain time and state; a scheduler
time alone never authorizes a contract action. A ends its challenge window at
`2026-10-29T17:18:00Z` (30October00:18 Bangkok); B at17:18:15Z. Eligibility is
strictly after the relevant deadline. Bob is already matched, so his old Waiting
match deadline is no longer a payout gate. Recheck every case rather than assume.

Run these **between** financial actions, preserving each intermediate state:

1. Before any new transaction, reconcile existing journaled hashes/receipts and
   actual eligibility. Never reset the plan, change deadlines, redeploy or replay.
2. Review and execute A's ordinary payout once. Before delivering a ruling run
   `node test/testnet-status.e2e.mjs --phase ordinary` and
   `node scripts/chiado-flow-audit.mjs`.
   A must be Finalized with Alice/Carol each paid `1000000000000` wei, Bob's full
   provisional share `1000000000000` wei held, one pending Disputed case, and no
   final ruling. “Finalized” means the ordinary batch was processed; it must not
   imply every case or payment is complete.
3. Review and deliver controlled absent ruling2 once. **Before settlement**, run
   `node test/testnet-status.e2e.mjs --phase ruled` and the independent observer.
   The UI must show “Final result available · settlement pending”; Bob remains
   Disputed, held funds are unchanged, and a final ruling alone adds no payment.
4. Review and execute settlement once. Run
   `node test/testnet-status.e2e.mjs --phase settled` and the independent observer.
   Bob must be Resolved; Alice/Carol each receive a `500000000000` wei top-up,
   totaling `1500000000000` wei each. Attendance paid totals `3000000000000` wei;
   Bob receives no attendance payment under ruling2. Matcher collateral is a
   separate obligation/payment, never counted as attendance. Pending cases, held
   shares, challenge escrow and owed credits must be zero for this EOA scenario.
5. At every stage authenticate Alice, Bob and ownerA through the existing
   read-only role harness; save screenshots and assertions for participant,
   organizer, disputes/payments, exact amounts and enabled/disabled next actions.
   Authentication signatures are distinct from financial transaction signatures.
   B must remain Listed, one attendee, no case/payout and unchanged `2e12` wei
   pool/balance/reserves throughout A's progression.
   Assert the selected event is A and the matching authenticated wallet detail
   has finished loading before reading amounts. Check Bob's participant view as
   well as cases: challenged before settlement, excluded under ruling2 after
   settlement, no attendance kickback. Check Alice is listed, and assert the
   displayed final-ruling datum equals the actual delivered0/1/2. A zero payment
   on stale anonymous data or on event B cannot satisfy an A role check.
6. A failed assertion stops the next financial action. Preserve canonical hashes,
   observed state, errors and screenshots. Refresh/reconcile rather than replay.
   Publish public proof paths back to the contract and UI chats for independent
   review. Pause the existing heartbeat only after verified completion.

Ruling0 is a valid final result, not a falsy missing value. Unknown/unsupported
rulings must disable settlement. Unmatched expiry and matched Court finality are
different paths. Failed transfers must appear as owed credit, never as sent.
Original `poolWei` remains the committed historical pool after payout; it is not
the remaining unpaid balance.

## Observer and UI acceptance

The independent command is GET-only against the fixed app origin and public RPC.
It has no private-wallet reads, authentication, signing or broadcasting. Run
`node scripts/chiado-flow-audit.mjs --self-test` for pure guard assertions.
The live command writes a unique timestamped proof plus the latest status file;
a failed run writes a failure result and must not leave an old pass as latest.

Its persisted `<planId>-control-baseline.json` is captured while A is still
matched/unruled and before ordinary payout. Do not replace it after payout to
manufacture an unchanged B result. Every later run checks that baseline's
canonical block and manifest binding.

`expectedUi` in observer JSON is a prediction, **not a DOM assertion**. Actual UI
evidence comes from saved browser screenshots/accessibility exports and the
core chat's strict phase/role harness. The matched label must identify controlled
arbitration. Empty activity must describe event/wallet/role visibility instead of
implying no on-chain transactions exist. Public views must protect private contact
records and signing journals. Event switches must clear the prior event while a
new snapshot loads and must never display A's case or obligations under B.

The observer's `passed-current-checkpoint` status is never a full-flow completion
claim. This document may become complete only when ordered ordinary, ruled and
settled public proofs, recipient reconciliation and role/UI screenshots all pass.
At this checkpoint the core chat is still completing the healthy frontend/backend
rollout and the stricter matched role audit. The review gaps above were sent to
both chats; no passing future/role result is inferred from an implemented harness.

## Additional human request: deposit initiated through the UI

The user subsequently requested a real UI-origin deposit followed by dispute and
kickback for the same scenario. A/B deposits are already closed. **No UI deposit
has yet been submitted for this additional request.** Keep their immutable
deployments, manifests, journals and pending settlement unchanged.

Core remains the sole signer/operator. Coordinate a new synthetic C factory child
with a future deposit window, reusing reviewed bytecode and controlled arbitration
where feasible. C needs an independent stable identity, reviewed plan/manifest,
transaction journal, durable state path and server/environment/origin scope. The
entire manifest hashes into the current durable-state binding: merely appending C
and resetting/rebinding A/B's saved file would invalidate existing evidence and
participant state. A separate preview must be identified by its actual URL in
proof; a local-chain exercise cannot be called a Chiado deposit.

The current generic deployment CLI hardcodes the original wallet/journal/lock and
requires a two-event plan. Do not invoke its default prepare/deploy workflow to
create C. A narrow reviewed child-creation adapter must keep the shared operator
lock while using explicitly isolated C plan/journal/manifest paths. Preflight the
existing disposable test balances and actual capped fees; no mainnet, purchase,
production key, paid infrastructure change or private key in browser/chat.

Recommended continuity scenario: Alice and Bob each deposit through the UI into C;
list Alice, omit Bob; Bob challenges through the UI and the owner matches. The
ordinary batch pays Alice and holds Bob's provisional share. Controlled attended
ruling1 followed by settlement pays Bob's held share, demonstrating that the
original UI depositor receives a kickback after the dispute. This complements A's
absent-ruling2/top-up scenario. Use actual C dispute IDs and chain deadlines.

For each deposit, preserve the selected event/wallet/chain, completed authenticated
detail, review dialog showing exact child/value/calldata, server validation,
one UI-generated `eth_sendTransaction`, pre-broadcast journaled hash, canonical
receipt and exact `Deposited`/pending-credit facts. Then prove separate curated
approval and contract admission. Screenshots must distinguish reviewing, submitting,
pending, confirmed credit and admission. Refresh/double-click/reconciliation must
not produce a second broadcast. Financial signatures must come only from the
dedicated test wallet outside browser JavaScript; disclose a restricted EIP1193
test bridge if used, rather than describing it as a browser-extension-wallet test.

The parent module `scripts/chiado-ui-deposit-guards.mjs` exports pure pre-send
request/draft/readiness guards. Its self-test passed3 accepted cases and22 rejection
cases with zero network requests, signatures or broadcasts. That result is **not**
deposit execution evidence. The operator must additionally bind actual origin,
public plan/source/manifest, fresh direct chain state, auth nonce, wallet file,
journal, receipt and resulting UI. Keep all new public proof artifacts unique by
scenario and run. Continue the same participant through intermediate status checks
and actual canonical kickback receipt; do not splice C's UI deposit onto A's dispute
and claim a single completed end-to-end flow.

Current additional-request checkpoint (29October2026, Asia/Bangkok): the core chat
confirmed the isolated C preview approach and owns its deployment/harness. No C
contract, role funding or UI deposit is confirmed. Reviewing a same-origin path
prefix found that root API routes, cookies, gateway forwarding and wallet-auth
origin would require coordinated changes; separate instances/origins avoid those
collisions. Normal temporary usage within
existing hosting plans is permitted for this test; no billing upgrade/purchase was
requested.

The parent read-only wallet snapshot at block23734609 is saved in
[budget observation](../artifacts/chiado-ui-deposit-budget.json). It is not an exact
deployment budget. The optional parent receipt checker is
`scripts/chiado-deposit-receipt-audit.mjs` and accepts the public manifest, eventID,
payer and txhash. It checks canonical deposit facts and historical isolated credit
deltas separately from a fresh API snapshot, including actual phase. It always
marks `uiInitiationVerified:false`; only actual browser evidence can establish UI
initiation. Its syntax check passed. Its first historical CLI sanity run
[failed closed](../artifacts/chiado-deposit-receipt-audit/2026-10-28T18-29-04-230Z.json)
because the public event API returned502. It is not a passing C deposit proof.
The core chat independently confirmed deployment-transition errors and stopped
new live signing/scenario creation until health recovers. Re-run the checker only
after a healthy service and eventually against C's actual UI transaction.

The parent independently read Railway's official
[Deployments stuck in initializing incident](https://status.railway.com/incident/Z1JDWW1W)
in the browser at approximately29October01:34Bangkok. It was Identified, affecting
deployment regions including Southeast Asia, with the latest notice dated
28October17:49UTC (29October00:49Bangkok). The provider reports delayed builds and
deployments while it fixes the cause. Browser evidence is saved as
`artifacts/screenshots/chiado-flow/railway-deployment-incident.png` and `.txt`.
This external incident is a concrete execution blocker, not evidence of a contract
failure or a successfully executed UI deposit. Core has persisted C continuation
in `PROJECT_BRAIN.md`; resume after hosting is healthy and bind actual future C
deadlines rather than reusing A's scheduled payout time.
