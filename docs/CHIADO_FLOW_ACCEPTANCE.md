# Controlled Chiado full-flow acceptance

Status: **IN PROGRESS — public kickbacks and final settlement have not happened.**
Checkpoint date: 29 October 2026, Asia/Bangkok. This record covers only the existing
synthetic plan `9fe71683-1e9b-48a0-94bd-274da4cf3029` on chain10200. The contract
sources, deployed children, owners and real chain deadlines stay unchanged.

First actual C UI deposit accepted: Alice submitted exactly1e12wei through the app,
transaction `0x78763b7529bb0a37d6d3f363c4ec74286b2e94ede6539c16f963292c3c630d91`,
block23735838. [UI operation proof](../artifacts/ui-c/deposits-2026-10-28T20-14-09.270Z-9dcf605b/ui-c-deposit-alice.proof.json)
records one `eth_sendTransaction`, one broadcast, the captured reviewed draft and
canonical event. Parent visual review confirmed exact C child/network/payer/value
in the review dialog and "Deposit received · admission pending" with1e12wei unused
credit/zero registered stakers afterward. All7recorded operator source hashes,
both manifests and the public app hash match the current reviewed files; protected
A/B before/after financial records are identical.

The parent independently passed Alice's canonical receipt, isolated historical
credit/reserve/custody increase, unchanged on-chain registration and fresh public
API/head checks:
[independent receipt proof](../artifacts/chiado-deposit-receipt-audit/2026-10-28T20-20-30-371Z-cc0a2d8e-9924-49aa-8c99-9ef476b126cf.json).
That chain-only checker deliberately reports UI initiation unverified on its own;
the paired source-bound browser evidence establishes UI origin. Bob's deposit is
still pending at this checkpoint. C admission, dispute and kickback remain future
stages. These actual UI deposits use a restricted EIP1193 bridge with disposable
keys held in Node; normal browser-extension wallet UI has not been tested.

Bob's later UI deposit is now accepted too: exact1e12wei, transaction
`0x18c491e15bf50d8b10ba2f1b50fdf0dc36e3076bcd611e5ce9b4e345c7a38425`,
block23735879. [Bob UI proof](../artifacts/ui-c/deposits-2026-10-28T20-14-09.270Z-9dcf605b/ui-c-deposit-bob.proof.json)
records one wallet transaction and one broadcast. The parent reviewed Bob's actual
review/confirmed screenshots, matched all operator/manifest/app fingerprints, and
confirmed protected A/B records are identical across the action.
[Independent Bob receipt proof](../artifacts/chiado-deposit-receipt-audit/2026-10-28T20-23-13-555Z-dd0392ab-c74e-46fb-b437-538a28940acc.json)
passed canonical deposit and historical credit checks. The independent C flow
observer passed90 checks:
[post-deposit C proof](../artifacts/chiado-ui-c-flow-audit/2026-10-28T20-23-16-455Z.json).
C was Open with2e12wei pending/balance/reserves, zero committed pool, zero
registered stakers/cases/owed funds, and150lifetime admission slots. Each payer's
credit was1e12wei. **UI deposit initiation is now tested for both Alice and Bob.**
Owner approval/registration and all later C stages remain separate required facts.

Owner approval and UI contract registration have now passed as a separate39-check
stage with one financial submission/broadcast:
[admission stage](../artifacts/ui-c/admit-2026-10-28T20-24-27.545Z-3ec384d7/proof.json).
Registration transaction
`0x5a67239bb778dea7a9607b1a5240d1ca25b1b9fa8ccf8942e02afdd8f7333367`
in block23735984 calls `registerStakers([AliceC,BobC])` from the C owner with0value.
It consumes each payer's1e12wei credit, changes both statuses to Staker, and keeps
the2e12wei balance/reserves protected as committed principal. A/B financial records
remain unchanged. The parent independently passed93 checks and reconciled the two
canonical registration logs:
[post-admission C proof](../artifacts/chiado-ui-c-flow-audit/2026-10-28T20-32-31-934Z.json).
Current C has2registered stakers,148remaining lifetime slots, pool2e12wei,
pending/owed/cases0. Attendance is not yet posted; dispute and kickback are pending
the real event start/challenge period. Fresh nonce-auth-only participant UI checks
after admission were requested separately from the owner's confirmed screenshot.

The first C read-only admitted role audit passed for Alice, Bob and owner, with
three nonce logins, six screenshots and **zero financial signatures/broadcasts**:
[role proof](../artifacts/ui-c/status-admitted-2026-10-28T20-35-31-038Z-fb8c69a2/proof.json).
The parent matched its harness/manifest/public-app hashes and visually confirmed
both participant screens show approved host admission, a confirmed1e12wei receipt,
registration in the correct C child, zero unused credit, no withdrawal/new-deposit
action, and no financial attendance or payout yet. The actual UI is correct at
this checkpoint. The auditor is receiving a bounded test-only follow-up to assert
those visible facts and release/settlement button eligibility automatically for
later phases, followed by one final admitted run; no financial action is repeated.

C continuation `finish-kleros-ui-testnet-flow-c` is **ACTIVE at29October04:50Bangkok**
in the sole operator's core chat. The parent inspected the native automation view,
its saved configuration and [continuation evidence](../artifacts/ui-c-continuation.json).
It pins the exact C plan/fingerprint/child/origin, preserves the independent A/B job,
uses the shared operator lock, and requires current source/receipts/UI evidence.
The first eligible run posts Alice's attendance, opens Bob's UI challenge and
matches through the UI. It then reschedules this same C job using actual
`challengeEndsAt` plus margin. Ordinary held-share, final-delivered-but-unsettled
and settled states each require role UI and `--scenario c` observer checks before
the next financial action. Controlled ruling1 and the same Bob's actual attendance
payment plus separate collateral delivery must be proven before C completion.
This is local scheduling: the machine must be awake with Codex running.

C setup checkpoint, **29October2026 around03:04Bangkok**: the new child
`0x9175260daa4D430C8a0c48BFd7fEa7cEbFA06cef` is deployed under the existing reviewed
factory, with separate C owner/Alice/Bob roles and an isolated app origin:
<https://kleros-ui-c-20261029-9fe71683.netlify.app>.
The parent independently passed26 creation/funding/initial-state checks at
block23735685: [creation review](../artifacts/ui-c-parent-creation-review.json).
It confirmed exact canonical role grants/creator transaction, full factory and
immutable provenance, unchanged v8 artifact/compiler/source bindings, empty Open C
state, A/B financial preservation and protected A/B gas coverage. C's immutable
deposit cutoff is **29October04:45:35Bangkok**. The actual C public page shows only
that event, the correct child, Open/Chiado10200 and1e12wei deposit; PNG/AX evidence
is under `artifacts/screenshots/ui-c-parent/`.

**No C UI deposit is yet established at this checkpoint.** The first browser run
stopped before authentication/signing because raw home-page HTML differs from the
source by Netlify's known C-site metadata comment. Its stopped proof is
`artifacts/ui-c/deposits-2026-10-28T20-02-25.834Z-e65c6463/proof.json`; operations and
screenshots were empty. The operator is correcting that narrow guard; fresh UI
execution still must prove a single wallet submission and canonical receipt.
See [C's operator record](TESTNET_UI_C.md) and
[C manifest](../registry/chiado-v8-ui-c.json). A/B's existing continuation remains
separate. This C deployment supersedes earlier "no C contract" planning statements
below; those remain historical preparation records.

The subsequent C GET-only browser probe passed18 requests and15 static assets,
with0authentication/signature/broadcast activity:
[probe](../artifacts/ui-c/root-source-readonly-probe.json). It validated the exact
326-byte hosting comment for the C site at byte71 and delivered the published
response unchanged. Other HTML bytes and scripts remain fully checked. This
clears the first browser guard problem, while actual deposits remain a separate
required execution step.

After the main combined release was confirmed healthy, the parent A/B regression
audit passed209 checks:
[current A/B proof](../artifacts/chiado-flow-audit/2026-10-28T20-14-01-924Z.json).
An intervening502 corresponded to the authorized main rollout; its failed proof
was retained and was not called a contract regression. The generic observer now
accepts `--scenario c` for the exact C planID/fingerprint/event/child/origin, writes
only separate C evidence/latest paths, and leaves A/B's control baseline unchanged.
Pure tests reject substituted C plans, fingerprints, event IDs and child contracts.
C's future phase audit must still pair those API/chain checks with actual UI proof
and the operator's per-operation A/B financial comparisons.

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
