# Fast Chiado UI rehearsal D — acceptance record

Status: **COMPLETE — controlled Chiado D UI flow verified; Bob paid and final UI settled. Original verification stops retained with read-only completions.**
Updated 29 October 2026, Asia/Bangkok.

The human requested the completed public UI deposit → dispute → kickback path using the separate
15-minute Chiado test profile. Core is the only signing/deployment operator. This contract chat owns
independent read-only provenance/payment checks; the UI chat reviews role screenshots and final
presentation. Existing A/B/C deployments, journals, origins and scheduled jobs stay independent.

Contract scope: `kleros-event-v8-test15m`, `VERSION()`80015, chain10200 only, 900-second challenge
and match windows. The timer starts after actual attendance posting; setup, admission and event start
come first. Production v8 keeps its one-day windows. See [profile provenance](TESTNET_15M_PROFILE.md).

## Public execution gates

| Stage | Required evidence | Current result |
|---|---|---|
| Integration | Build/typecheck, version/chain rejection, new UI labels/deadlines, pending-credit and batch compatibility | Build/typecheck and full Node suite251/251 passed; core's final HTTP1/1 and signing/UI guard checks also passed separately. |
| Deployment | Exact reviewed source/creation hashes, approved budget, separate D origin/manifest/state/roles, canonical factory/child receipts | Three grants, factory and revised-plan child independently confirmed; live app Open checkpoint passed122 independent checks. |
| Deposits | Alice and Bob each initiate the real UI deposit; one reviewed request/broadcast per wallet; canonical payer-owned credit | Actual UI stage passed42 checks;2 wallet requests/2 broadcasts, exactD pending credit each. Independent deposited observer passed128 checks. |
| Admission | Owner uses UI; exactly two admitted principals, pending credit0, no attendance payments | Actual UI stage passed43 checks;1 wallet request/broadcast. Independent admitted observer passed131 checks; public UI agrees. |
| Attendance and dispute | UI attendance omits Bob; Bob challenges; owner matches; actual dynamic resolver/arbitrator IDs and 900-second deadlines | Attendance UI35/Listed135, challenge UI33/Waiting150, match UI33/Matched155 passed. Dynamic IDs2/1002, Bob Disputed/unruled. |
| Ordinary payout | After actual deadline, UI pays AliceD; Bob remains unruled with D held; UI says unresolved, not fully paid | Complete through passed UI operation, observer158, three-role86 and separate read-only aggregate supplement. Original runner STOPPED is preserved. |
| Delivered ruling | Controlled attended ruling1; role UI shows final result with settlement pending; Bob's D still held | Complete: exact receipt, Ruled observer158, three-role86, independent all6 screenshot review, receipt-only operator recovery and original A/B/C interval comparison passed. |
| Settlement | UI settlement, canonical BobD attendance payment, separate collateral balance proof, no pending/held/owed/reserve obligations | Complete: actual UI operation, independent BobD +30e9 collateral/balance proof, final canonical verifier and original-interval aggregate supplement passed. Original wrapper STOPPED is preserved. |
| Final UI | Bob, Alice, owner and cases views agree with canonical settled state and delivered payments | Complete: three-role86 checks, independent all6 screenshot review, parent Bob screenshot/live case view and consolidated final proof passed. |

`D` is exactly `1000000000000` wei of test XDAI. The Bob receiving this kickback must be the same
wallet whose UI deposit and challenge were recorded in this D rehearsal. Do not confuse this role
with Bob in the older A or C scenarios.

The case uses a deliberately controlled test arbitrator. This run does not establish independent
Kleros jury arbitration. A final ruling, ordinary `Finalized` phase, transaction hash, collateral return,
pending-credit recovery or owed credit alone is insufficient to report Bob's kickback delivered.

## Independent checks

The independent observer must use the exact raw manifest SHA-256, plan ID/fingerprint, D origin,
event ID and child address received from the reviewed public deployment. It only performs anonymous
GET requests and Chiado RPC reads. Each run pins the app state/payment snapshot to a canonical
block, checks deployment/version/timers, compares direct contract state and accounting, and
reconciles every reported attendance payment with canonical logs and receipts. It does not claim UI
initiation; that evidence comes from the source-bound browser operator and its screenshots.

Before any D grant, core must verify deterministic source generation, exact approved-plan artifact
binding, fresh deployer nonce/predicted factory address, and sufficient budget preserving A/B/C gas.
The approved fee ceiling must also hold on the populated transaction immediately before signing.
The missing-factory-provenance helper regression now rejects before creating any child. Independent
negative checks for altered timing/financial source with matching mutable manifests also reject.

Existing operator preservation independently passed `node scripts/verify-frozen-chiado-operator.mjs`:
142 reviewed source files, canonical shared runtime/journals/lock/proofs, no signing files read and no
signatures/broadcasts. This preservation check is separate from D financial execution.

Parent broad validation actually executed `npm run build`, `npm run typecheck`, then `npm test`.
Build and typecheck passed. The full Node rerun passed251/251, with no failures/skips/cancellations,
in616.71seconds. [Validation record](../artifacts/fast15m-validation.json) binds full log hashes and
after-run source fingerprints. The first restricted attempt could not bind local Ganache listeners:
157passed/93failed from250, followed by the successful loopback-enabled rerun. Both logs are retained.
This is local synthetic execution, not public UI/payment evidence. D-only guard improvements were
made during the run; core's final focused guard results must be recorded separately.
The late-added`test/test15m-app.test.mjs` HTTP integration fixture was not in the original shell glob;
its focused command/result is also separate from the251-test count. Core reported its final focused
run passed1/1 in18.66seconds, using actual local CA-pinned HTTPS and chain10200 with no application
source fix required. Core's final financial UI guards accepted22valid fixtures and rejected117invalid
ones; role-status guards accepted18valid fixtures and rejected117invalid ones. The populated-
transaction signing-budget test passed1/1. These are separate local
checks, not public transactions. The reviewed local source checkpoint is`7bdd40a`; its50-file
expanded secret scan found0matches. No upstream push occurred.

## Completion record

Current public app: [D cases and kickbacks](https://kleros-fast15m-d-20261029-9fe71683.netlify.app/#event=chiado-ui-70688861-87e2-4936-9e2e-bdc9a7c7a5fd-d&view=cases).
Child:`0x8E1eCFb62465E1b333CBcf30763a2F8aCE2ABb88`, chain10200, VERSION80015.
Active plan fingerprint:`2d195b00bec7ffe8436bf2146f2d25dacb6d289ab76329cd92901e8fc07c70d1`.
Bob's attendance paymentD and separate30e9wei collateral return are independently confirmed;
the final role screenshots and original-interval aggregate recovery pass. Full acceptance is
complete for this controlled D rehearsal. This does not mark the older A/B/C runs complete or
establish independent jury arbitration. Ethereum mainnet preparation is tracked separately in
[Ethereum v8 readiness](ETHEREUM_MAINNET_V8_READINESS.md).

All eight financial UI operations have canonical passed per-operation proofs. Each used exactly
one wallet request and one broadcast; the original full-stage wrappers and their read-only
recovery records are retained separately below.

| Actual UI operation | Canonical transaction | Block |
|---|---|---|
| Alice deposit | `0xe3b10808d5060b3ef2b6c5f6ccba1c81d3ebee041c5059c27f96f29eac21d682` |23740304|
| Bob deposit | `0xde29bf8ffa52d94ed551a1b9cf2f65edfec933ffcf4e3220cd3bf92eb61f29eb` |23740332|
| Owner admission | `0x8376920fd03eb0c2cc8a34bcc25f0d79b9be11f7ce9746c4455cbf59e400e56d` |23740440|
| Alice-only attendance | `0x77ffa4f018c04050acd95873823e06489c7a6681706ad3926beb38e9d62b7deb` |23740574|
| Bob omission challenge | `0xcbfc9894bbca380818dd9e90d132819c612f79adcdafe7a0d8dae4a17fc8d993` |23740616|
| Owner matching | `0x1dd3a2e9ef04d36387bd5e2ed042ebacc795f4dbe694b0b5aba0fa93b29c7fb3` |23740671|
| Ordinary Alice payout / Bob held | `0x07ff1e1718ffc9aaa7e9bb2c44d6656e8a955d0878ae1d731e0b2f5e89e4fbd3` |23740796|
| Bob settlement/payment | `0xc27fb4878a820914c134be76e693057c6a700948f1d56350aabdf62f04063a0e` |23741297|

The intervening controlled attended ruling used the Node operator, not a jury or a UI wallet popup:
`0x9a273700b4757d5279797f795a4f71d03352c3f1c6bc96c175519ec3700610cf`, block23741046.
The actual attendance challenge window ran03:34:30–03:49:30UTC, exactly900seconds. Production
v8 and the older A/B/C runs retain their one-day challenge/match windows.

Original pre-child plan identity (historical): plan`70688861-87e2-4936-9e2e-bdc9a7c7a5fd`, fingerprint
`23529f6b0418f310d0aed84444d444759ed7c5187291c0a07df07eacf0d427f8`, event
`chiado-ui-70688861-87e2-4936-9e2e-bdc9a7c7a5fd-d`,
[separate origin](https://kleros-fast15m-d-20261029-9fe71683.netlify.app).
The original planned start was29October09:24:20Asia/Bangkok; the challenge deadline must come from actual
attendance posting, not this planned start. BobD is`0x8f9cA1dCdB1eB1842C21BBc20C7737de8d82b501`.

[Independent plan review](../artifacts/ui-d-plan-independent.json) passed exact plan/source/creation
hashes, isolated identities and budget at a250,000wei maximum gas fee. Maximum factory+child gas
cost is5e12wei; three grants plus maximum grant gas need30,015,750,000,000wei while preserving
the older scenarios'10e12wei gas reserve. This is a reviewed maximum, not actual spend.
[Independent public policy check](../artifacts/ui-d-policy-independent.json) confirmed HTTP200 and
the exact2,656bytes/SHA-256`d8df68ee6438a490569a6391a205913107d24beb90e4f5b4b3278cf92acb7e09`.
The first1,000wei preparation cap safely stopped before creating a plan/wallet/journal or moving
funds; its diagnostic is retained separately. None of these checks claim deployment or payment.

The later setup transaction step confirmed all three grants and the new factory. The operator then
stopped before preparing the child; no child hash existed in its journal. The original redacted error
did not establish a precise cause. [Stop diagnostic](../artifacts/ui-d-deployment-stopped.json) retains
the four confirmed hashes; none may be signed or broadcast again. The same-plan continuation must
preserve those receipts and every immutable parameter.

[Independent setup receipt check](../artifacts/ui-d-setup-receipts-independent.json), at canonical
block23739339, verified all four status1 receipts with at least two confirmations, exact grant
from/to/value, fee ceilings, and exact factory constructor bytecode/nonce0/address. Factory
`0x0947D4438489f159E4B1BdC8BA63A1C07D642465` has code hash
`0xa9180dc69fe79ca800e5e8bde34b3729da08f7e003d0f2dd3b4e756fd1807024`, version80015 and the exact
reviewed child creation code. Its D event registry entry was zero at that snapshot. This confirms
setup receipts; it does not claim a child deployment, UI deposit or Bob payment.

The same-plan resume subsequently hit a setup-time heuristic that required the entire fresh45-minute
margin after setup had already completed. Recovery was narrowed to the never-submitted child:
all four exact receipts must freshly be canonical with two confirmations, the factory code/creation
must match, the owner pending nonce must be1 and the event key unused. Fresh/partial setup still
requires more than45minutes. A known-setup20-minute operational margin is permitted only after the
reviewed Linux backend build passes; it is checked again immediately before signing. All immutable
contract times,900-second windows, roles and budget stay unchanged. Any existing child journal
entry blocks **all** new signatures, including funding actions, even if other journal entries are
missing. Known setup sender calls are skipped. Independent memory probes verified exact20-minute,
expired, nonce/key and individual confirmation failures with zero key use; focused pure tests5/5
passed. Core's actual local recovery/lifecycle run passed8/8 in38.81seconds. These operational
recovery changes are not production Solidity changes.

[Linux build preparation](../artifacts/ui-d-backend-build-preparation.json) records source
`a20ed478691bf3dade6da24a2c53b3eeb2afe5f3`, application source
`7bdd40a3478e487f84b0c00aa0d58e25d13e0d5e`, deployment
`1a2d78d2-94bd-4f1d-9253-3cc0dbebdd9d` and image
`sha256:b1603702571b564c340f903a9293da0e829745deef89990fe4e21fb4c2a1a8f3`.
The actual Linux build passed pinned compilation. Startup intentionally remains unready without
the canonical D manifest. Recovery checkpoint`3332f67` retains the same source/plan; no UI deposit,
child confirmation or Bob payment is claimed by this build record.

## D stopped before event creation; bounded same-D continuation

The final original-plan attempt also stopped at its strict operational time margin. Core verified no D
child journal entry, no D manifest and no unknown child hash. The four setup transactions remained
confirmed. The10:30 proposal was initially held for review with originals unchanged; the later guarded
same-D application is recorded below. No deployed contract deadline changed.

Core selected an append-only same-D pre-child schedule revision as the more bounded continuation
under the human's explicit request to finish the full fast UI test. The human did not prescribe the
original synthetic09:24 start; no event child exists and no additional funds/roles/source are needed.
The revised start is10:30Asia/Bangkok, with only event start/end/claim-deadline plan fields
changing. Original raw plan/journal snapshots and all four transaction entries must remain preserved.
No new human approval question was sent. The independent public proposal review passed; the guarded
implementation/test/apply evidence is recorded below and must precede deployment.

The D2 contingency design/observer/tests were prepared but never activated. D2 has no plan, journal,
child, signing or payment. The three parent-created files were reversibly archived with unchanged
hashes under`.runtime/unused-d2-review/` and removed from the active source/test tree. Active financial execution continues through
the single canonical D plan/journal with an auditable revision, the same factory and funded wallets,
and no new grants or factory deployment. D is not labeled a completed UI rehearsal; none of its local
tests or setup receipts prove Bob paid.

### Applied pre-child schedule revision

The reviewed helper`f013331da8905ca4fd0fb4449979560ff6e8b543860b643001fba78d798ea0bd`
passed focused4/4 tests, with independent synthetic interruption/idempotence/lost-record probes.
The public applied proof is
`artifacts/ui-d/plan-revisions/2026-10-29T02-41-27-804Z-71e38ba4/proof.json`, SHA-256
`8636fcb165e28ddfcd7e7ee658e522747c6a76e18a7f00a4fb6ac68e94dd363a`.
It records exactly two metadata writes, preserves all four setup transaction hashes and original raw
snapshots, and changes the active plan fingerprint to
`2d195b00bec7ffe8436bf2146f2d25dacb6d289ab76329cd92901e8fc07c70d1`.
The new budget-review hash is
`0bfc044588f0fac2d4fd6b164fc08bd0276054512448d44fcad4c5b97331a209`.
The actual read-only gate at canonical block23739989 checked chain10200, four setup receipts,
latest/pending owner nonce1 and the unused key. The helper signed and broadcast nothing.

The active planned event start is now**29October10:30:00Asia/Bangkok** (`1793244600`). The original
09:24 plan remains preserved as an immutable snapshot; no deployed contract deadline changed.
The challenge deadline must still come from actual attendance posting. Child creation, deposits
and Bob's payment were pending at that revision checkpoint.

### Confirmed child creation

[Independent child receipt proof](../artifacts/ui-d-child-receipt-independent.json) verified transaction
`0x3c33411d377bec442f8e4831c8465f7d92f02966289fbae212807fb4de59507c`, canonical block23740043,
status1 with at least two confirmations. The owner used nonce1 through the existing factory with
the exact revised plan calldata and no principal sent. The child
`0x8E1eCFb62465E1b333CBcf30763a2F8aCE2ABb88` also matches the first child address independently
derived from factory nonce2. At fresh block23740069 it was Open with0stakers and0pending credit.
Its on-chain version is80015, challenge/match periods900seconds, minimum posting window7days,
depositD, owner and revised immutable times all match. Runtime hash is
`0xe2752e59cd662c74def35b0a99b6f889332c6deeaabc0a3b6db5b4ce523e0edf`.

Public manifest`registry/chiado-v8-ui-d.json` SHA-256 is
`56eca833e2c196a4de7e3c788165cd856ebacdd81f29342caa9911888a0292bd`; active plan fingerprint is
`2d195b00bec7ffe8436bf2146f2d25dacb6d289ab76329cd92901e8fc07c70d1`.
This proves event creation and timers. It does not prove UI deposits or Bob's payment.

### Live application and pre-deposit checkpoint

The isolated D application is live at the separate origin above. Backend deployment
`aef2933b-e7bf-4c05-855c-b39b77a96c7b` uses source`67ee1d9`, including the exact D manifest;
the frontend uses reviewed application source`7bdd40a`. The independent anonymous Open audit
passed122 checks at canonical block23740243 with API instance
`72e1375c-078c-4519-a70d-b6de60d73e12`. Its immutable proof is
`artifacts/chiado-ui-d-flow-audit/2026-10-29T03-04-23-865Z-8083a2bd-0ab7-464f-aeeb-680f155dcbbd.json`,
SHA-256`7db2c1a5349d779cac0e0d3cf58d4343b7c3f29a229fa91e6bc2f5584b134415`.
It verified deployment, profile, timers, canonical accounting and a fresh, empty Open event.
The actual anonymous browser also showed the15-minute test banner, chain10200, correct event
start, zero custody/obligations and no cases. This is readiness evidence; the financial UI operator
has started the separate deposits stage and must report its canonical completion before the next audit.

The observer now also checks Listed-before-challenge and Waiting-before-match states, with
canonical receipt-block timestamps plus900seconds for both deadlines. Focused tests passed9/9;
observer source SHA-256`087374e8dc0f7fb79929a27736aaa3822307a520264be0f50d557f9094157124`.
These local guard tests and the Open checkpoint do not establish Bob's payment.

### Actual UI deposits

`artifacts/ui-d-deposits.json` points to immutable browser proof
`artifacts/ui-d/deposits-2026-10-29T03-07-36.775Z-4b5ede2e/proof.json`,
SHA-256`7f69e386fffe35776732c1ab5e78c0d6efb993429b005873602a83904dbda3e0`.
The source-bound UI completed exactly two wallet requests and two broadcasts, with canonical
confirmation and unchanged A/B/C financial snapshots:

| Wallet | Deposit transaction | Block |
|---|---|---|
| AliceD | `0xe3b10808d5060b3ef2b6c5f6ccba1c81d3ebee041c5059c27f96f29eac21d682` |23740304|
| BobD | `0xde29bf8ffa52d94ed551a1b9cf2f65edfec933ffcf4e3220cd3bf92eb61f29eb` |23740332|

Independent deposited audit passed128 checks. Proof
`artifacts/chiado-ui-d-flow-audit/2026-10-29T03-16-33-132Z-49522770-2964-4bc2-914d-1a1db825bc09.json`,
SHA-256`40ad621c7035f7e97bb783b1ebfdf6674084995801d1ddd9faef37399b74fab6`.
Bob's actual confirmed screenshot visibly shows **Deposit received · admission pending**, unused
creditD and zero registered guests. These deposits are payer-owned pending credit; they do not yet
establish admission, attendance or any kickback payment.

### Actual UI admission

The owner approved both synthetic registrations and admitted exactly AliceD and BobD through the UI.
`artifacts/ui-d-admit.json` binds immutable proof
`artifacts/ui-d/admit-2026-10-29T03-17-58.585Z-b7229940/proof.json`,
SHA-256`6af44a5bc69dc2465d6ac95ef8fb4a0fe19863d43ee2896abf432a8b9c56358c`.
The canonical registration transaction is
`0x8376920fd03eb0c2cc8a34bcc25f0d79b9be11f7ce9746c4455cbf59e400e56d`, block23740440.
The stage passed43 checks with exactly one wallet transaction/broadcast and unchanged A/B/C state;
all13 recorded operator source hashes independently matched the current files.
An earlier invocation omitted the explicit execution environment and stopped before runtime/network
access; it sent no transaction. The successful source-bound stage is the evidence above.

Independent admitted observer passed131 checks. Proof
`artifacts/chiado-ui-d-flow-audit/2026-10-29T03-26-46-901Z-c0e4fb87-26b9-4fec-9040-6bce596eb75f.json`,
SHA-256`c1e782a287eb42cdf23293994788cb21cbad23136692a872e11f1e1ba26fe7c1`.
The actual anonymous public cases UI agrees: registered guests2, pending credit0, protected
contract balance2D, attendance payments0, held/owed/escrow0 and cases0. Attendance has not been
posted, so the omission challenge deadline has not opened. Bob's kickback is still pending.

The admitted Alice/Bob/owner role audit passed86 read/auth requests,3 nonce logins and6 captures,
with0 financial signatures/broadcasts and no failures. Immutable proof
`artifacts/ui-d/status-admitted-2026-10-29T03-27-57-069Z-8a202a7c/proof.json`,
SHA-256`c92ff97c9ffb3682b8ce296ffbdd69b3030758af19edf16fa369d30d40ecd55a`.
Independent local proof and image review confirmed Bob's registered status, confirmedD receipt,
zero unused credit, no established attendance or direct payment; the owner view shows exactly2
registered guests and pool2D. The owner screenshot still shows its deposit-observation inbox loading,
so that capture does not visually establish the inbox rows. This limitation does not change the
independently verified admission/accounting result.

### Actual UI attendance and opened challenge window

The attendance UI stage passed35 checks with one wallet request/broadcast and unchanged A/B/C
financial snapshots. Immutable proof
`artifacts/ui-d/attendance-2026-10-29T03-31-39.985Z-0efbea56/proof.json`,
SHA-256`c3fde729ccfaa618ed783e96bd1441f71b0918ff683155bb471919157c14a605`.
Transaction`0x77ffa4f018c04050acd95873823e06489c7a6681706ad3926beb38e9d62b7deb`,
block23740574, posted Alice alone with pool2D and no principal sent. Bob remains omitted.
The canonical posting timestamp1793244870 plus900seconds is the stored actual deadline1793245770:
**29October03:49:30UTC /10:49:30Asia/Bangkok**. Ordinary payout requires chain time strictly after
this deadline and fresh case eligibility checks; event start plus900seconds is not the payout gate.

The Listed observer passed135 checks. Immutable proof
`artifacts/chiado-ui-d-flow-audit/2026-10-29T03-35-38-460Z-e92d5f37-2635-4a20-8b01-62db8b7f9425.json`,
SHA-256`0763135317132983b140d8115209617ed6d3fceb24eebf1b4b36a1f6632304d5`.
Independent local artifact/image review matched all13 operator and26 public source pins, the
canonical transaction/logs, two registered guests, Alice alone included, reserve/balance2D and no
payments/cases/held/owed/escrow. The owner capture also visibly shows the deposit inbox loaded
with2of2 wallets and committedD each, resolving the earlier admitted-capture loading limitation.
This checkpoint does not establish a challenge, ruling, settlement or Bob payment.

### Bob's actual UI challenge and Waiting state

The SAME BobD depositor challenged through the UI, sending30e9wei collateral exactly once.
Transaction`0xcbfc9894bbca380818dd9e90d132819c612f79adcdafe7a0d8dae4a17fc8d993`,
block23740616, is canonically confirmed. Immutable browser proof
`artifacts/ui-d/challenge-2026-10-29T03-36-05.476Z-7ad6e763/proof.json`,
SHA-256`81b44f34d9b327c627cb598ba20c4eca912da4af9795a10dc031cdd2a3c8eb74`.
The UI stage passed33 checks, one wallet request/broadcast, matching all13 operator and26 public
source pins. A/B/C financial state stayed unchanged.

Waiting observer passed150 checks at block23740632. Immutable proof
`artifacts/chiado-ui-d-flow-audit/2026-10-29T03-39-47-332Z-33675070-18f5-4878-8183-113111aa2121.json`,
SHA-256`9d4691abd72dd19b634982c9a410aecc8304672c8986e81409732d2cb09e9c10`.
Bob is Waiting/unmatched; resolver/arbitrator IDs, final ruling, case URI and appeal fields are null.
Raw storage zeros are unassigned placeholders, not real Court case0. Contract balance/reserve is
2.03e12wei, including30e9 challenge escrow; paid/held/owed/pending credit remain0. The canonical
challenge timestamp03:38:25UTC plus900seconds gives match deadline03:53:25UTC /
**10:53:25Bangkok**. The global challenge deadline stays10:49:30Bangkok.

Independent local screenshot review confirms Bob's UI says **Waiting for a match** and **Your
attendance case is open**, with confirmed deposit/registration and no payout. This participant
capture omits the case-detail IDs and match deadline; those are established by the saved observer
proof. A challenge is not a ruling or a delivered kickback.

### Actual UI matching and unruled case

The D owner matched Bob's challenge through the UI, sending30e9wei exactly once.
Transaction`0x1dd3a2e9ef04d36387bd5e2ed042ebacc795f4dbe694b0b5aba0fa93b29c7fb3`,
block23740671, canonically records `ChallengeMatched` with dynamic resolver localID2 and
arbitrator disputeID1002. Immutable browser proof
`artifacts/ui-d/match-2026-10-29T03-40-23.107Z-931481be/proof.json`,
SHA-256`9fb4649d22e67c0d93f867cb14a6283399c92b750e9b961337568fc6b8d1ea9f`.
The stage passed33 checks, one wallet request/broadcast, exact13 operator/26 public source pins
and unchanged A/B/C financial snapshots.

The parent independently reran the live Matched observer:155 checks passed. Immutable proof
`artifacts/chiado-ui-d-flow-audit/2026-10-29T03-45-50-244Z-098af708-6c7e-490e-bb80-c0296f226c92.json`,
SHA-256`aca94ba6bc1ebfb4623868b5d6303adbbe8e40ef089acf159acef48314655684`.
Bob is Disputed/unruled; remaining challenge escrow30e9 and balance/reserve2.03e12wei.
Held shares, owed credit, pending credit, payout share and direct attendance payments are all0
before ordinary release. The paid arbitration fee30e9 is accounted for separately.

The parent's actual anonymous browser confirmed **Matched controlled test dispute · awaiting
final result**, resolver ID2, arbitrator ID1002 and **Not final**, with Sent/held/owed0.
It displays the actual03:49:30UTC omission deadline and protected balance2.03e12wei. This live
UI read also establishes the case heading/local ID obscured by the sticky header in the financial
operator's full-page screenshot. The three-role matched audit and strict fresh-chain deadline
check must pass before ordinary release. No Bob payment is established by matching.

The completed three-role Matched audit passed86 read/auth requests,3 nonce logins and6 captures,
with0 financial signatures/broadcasts and no failures. Immutable proof
`artifacts/ui-d/status-matched-2026-10-29T03-46-00-743Z-fbec845c/proof.json`,
SHA-256`d1f2653101c37cc25229378919b15e479d52e33e22d0f859202d557567c28625`.
The challenge deadline has passed by the03:53UTC review; financial execution still requires a fresh
canonical chain eligibility check, unchanged sources and the existing once-only journal guards.

### Ordinary payout confirmed; aggregate verification recovery

The actual UI ordinary payout transaction
`0x07ff1e1718ffc9aaa7e9bb2c44d6656e8a955d0878ae1d731e0b2f5e89e4fbd3`, block23740796,
confirmed after the challenge deadline. The passed, journal-bound per-operation proof is
`artifacts/ui-d/payout-2026-10-29T03-51-39.182Z-3960b430/ui-d-release-payouts.proof.json`,
SHA-256`2697495cdc9304e1166c88dc68e9537854e0c6962b5a45e0574be4f7251021f5`.
It records one actual UI wallet request/broadcast, canonical confirmation, AliceD delivered,
BobD held with case2/1002 still unruled, and immediate unchanged A/B/C financial snapshots.
The owner-confirmed capture visibly shows SentD, reserved shareD, owed0 and **Not final**.

The original top-level stage proof remains **STOPPED**:
`artifacts/ui-d/payout-2026-10-29T03-51-39.182Z-3960b430/proof.json`,
SHA-256`d32c76415b787cb531c82d0819c81732fe49ef2394b51ad21fe406bb4dcd4274`.
The exception occurred after the passed operation sidecar was persisted, before final aggregate
verification returned. The exact cleanup/read failure cause is unproven from public artifacts.
Neither the transaction nor the original proofs/journal may be replayed, reset or rewritten.

The parent independently ran the read-only Ordinary observer:158 checks passed. Proof
`artifacts/chiado-ui-d-flow-audit/2026-10-29T03-58-50-597Z-8edadf2d-dd8f-463d-a703-44685f2a026b.json`,
SHA-256`1160e5d4dfe3802c4d184742a373fa76cdbc602148e9a69e41797e06183b8720`.
It confirms canonical Alice attendance paymentD, Bob unpaid/heldD, escrow30e9,
balance/reserve1.03e12wei and pending/owed0. Finalized is only the ordinary batch state.

Independent source review established that the exact original outer A/B/C baseline is preserved
in the passed sidecar, which the stopped proof embeds unchanged. A new source-bound read-only
supplement may close only the missing aggregate checks: verify existing proof/source/receipt and
baseline canonicality, compare fresh A/B/C financial state to that original baseline, and record
fresh D ordinary state. It must preserve both originals, declare zero new financial actions and
establish completion at its new block without retrospectively changing the stopped run to PASS.
The ordinary three-role UI audit and supplement must both pass before any controlled ruling.
Bob's kickback remains undelivered at this checkpoint.

The completed ordinary three-role audit passed86 read/auth requests,3 nonce signatures and6
screenshots, with0 financial signatures/broadcasts and no failures. Immutable proof
`artifacts/ui-d/status-ordinary-2026-10-29T03-58-30-360Z-2178dda7/proof.json`,
SHA-256`b9d69a2d4b901a841e6ec345f994927cf3ff06fa6c0dd432300df66f5de06552`.
The parent's fresh actual public browser independently shows **Ordinary batch processed**,
SentD, reserved shareD, owed0, escrow30e9, Bob case2/1002 **Not final**, and no full-settlement
claim. The separately reviewed read-only aggregate supplement remains required before ruling.

The coordinated UI chat independently reviewed all6 ordinary screenshots and the exact proof
digest above. Presentation passed: Alice's personal direct paymentD; Bob's personal direct,
principal-refund and claim payments0, with heldD and no final ruling; owner SentD/heldD/owed0.
The cases-view SentD is an event aggregate and is not Bob's personal payment. This review closes
presentation only, not the missing aggregate recovery gate.

### Completed read-only aggregate supplement

The separate helper`5150a82e1596f0e7280efa6f38981f362c37a4271d201a201020bb62e6ba098d`
passed independent source review and5/5 focused negative/guard tests. It checks all11 retained
D/A/B/C/role/observer block anchors, fresh protected snapshots and the final payment projection's
exact block/identity; its last asynchronous read rechecks the final canonical D block. Default
invocation reads no runtime/network/key material. The helper remains outside the13 frozen
financial operator files, reads no signing keys and has no signing, broadcasting or journal-write path.

Actual supplement passed at fresh canonical D block23741012:
`artifacts/ui-d/payout-completions/2026-10-29T04-14-47-517Z-854653ed/proof.json`,
SHA-256`4824515ff70118d66076019f2935e8b7ca4f82b3e474c34af48112531cd6c7a9`.
The parent independently rehashed all4 original proof inputs, the reviewed helper, current13-file
closure and8 linked screenshots; compared the preserved and fresh A/B/C financial objects; and
verified the current D ordinary state and exact payment projection/block binding. The supplement
records0 signing files read,0 signatures,0 broadcasts and all original files untouched.
Alice has direct paymentD; Bob still has heldD and unruled case2/1002, with pending/owed0 and
balance/reserve1.03e12wei. The original runner remains **STOPPED**; the missing aggregate is now
separately completed, without replaying its transaction or establishing the original cleanup/read
failure's exact cause. This closes the ordinary gate and permits only the planned controlled
attended ruling1; settlement still requires its own delivered-ruling/unsettled UI/observer gate.

### Delivered attended ruling; settlement still held

The controlled ruling transaction received a confirmed receipt, then its final operator verification
stopped. The operator's existing known-hash recovery branch refuses transaction preparation and
signing; recovery must inspect the existing canonical hash and complete only the outstanding reads.
The exact original failure cause remains unproven. The original ruling baseline is preserved in
`operatorBeforeRulingABC`; recovery must compare that baseline, or the earlier public completion
baseline, with fresh A/B/C financial state in addition to checking the recovery interval itself.

At canonical block23741129, the parent's small independent RPC diagnostic confirmed the actual
resolver case2 has `isRuled=true`, `ruling=1` and arbitrator ID1002. The child still has Bob's
case Disputed, held shareD, owed0 and balance1.03e12wei. This establishes a delivered resolver
result, not merely a controlled-arbitrator vote. It does not establish Bob paid.

The parent then independently ran the full read-only Ruled observer:158 checks passed.
Immutable proof
`artifacts/chiado-ui-d-flow-audit/2026-10-29T04-28-18-484Z-f132c8ee-9351-4c3e-9b88-f912d618eb93.json`,
SHA-256`75f18f9d02f3be4b7af21176b5489368cc69b58983e52fbcd38f31a7cc04d53d`.
The canonical app and direct chain state agree: final1, Bob unpaid with heldD, no owed credit,
and case2/1002 still unsettled. The ruling receipt/baseline recovery and actual three-role
delivered-ruling UI captures must complete before the separate UI settlement.

The parent's independent public receipt proof is
`artifacts/ui-d-ruling-receipt-independent.json`,
SHA-256`321e41b9e55299ce96af65ee9b31f9281b5ed00aaf325dbbe9ed089c973dbff0`.
It verified status1 transaction
`0x9a273700b4757d5279797f795a4f71d03352c3f1c6bc96c175519ec3700610cf`, block23741046,
ownerD nonce6, zero value and exact`giveFinalRuling(1002,1)` calldata to the reviewed controlled
arbitrator. The canonical resolver log records ruling1 for arbitrator case1002. It had160 observed
confirmations, and the fresh child/proxy state still showed Bob heldD and unpaid. This independent
receipt check signs/broadcasts nothing and does not replace the original aggregate recovery.

The delivered-ruling three-role audit passed86 read/auth requests,3 nonce signatures and6
screenshots, with0 financial signatures/broadcasts and no failures. Immutable proof
`artifacts/ui-d/status-ruled-2026-10-29T04-20-57-035Z-219650d8/proof.json`,
SHA-256`1f287634a61089d7a87e843576f650494f36691e5efa660013452a70c9aa4a7c`.
The parent's fresh actual anonymous browser also shows **Final result available · settlement
pending**, **1 · Attended**, Bob's reservedD and event SentD/owed0. It explicitly says the event
contract still needs a confirmed settlement transaction. No direct Bob payment is established yet.

### Ruling receipt-only recovery and original interval completed

The existing frozen operator completed its known-hash receipt-only branch with0 additional
broadcasts, unchanged source and unchanged private journal bytes. Immutable recovered proof
`artifacts/ui-d/ruling-2026-10-29T04-30-41-044Z-745755c9/operator-proof.json`,
SHA-256`e83194878dea9d62f0ea48f04c0c956c5c37d8dfc16d2e6c1ac2bbaf190a38b1`.
The separate original-interval comparison is
`artifacts/ui-d-ruling-recovery.json`,
SHA-256`0ded2365f214e8f973af78e6ef6d83116a036d2e700708d04a717f1c457d778b`.
It compares the preserved original pre-Court A/B/C financial baseline at block23741038 against
both recovered snapshots, and also against the earlier public payout-completion baseline. The
parent independently rehashed all linked inputs, compared those financial objects, rechecked all10
unique block hashes/timestamps over public RPC, and verified all13 financial operator and26 public
source hashes unchanged. The record reports0 signing files read,0 signatures and0 new broadcasts.
The initial stopped operation remains recorded; no ruling was signed or broadcast again.

The coordinated UI reviewer independently viewed all6 delivered-ruling captures and passed their
presentation against the exact`1f287634...` proof above: Bob has final1 but personal payment0 and
heldD; Alice's personalD is paid; owner event SentD/heldD/owed0. The parent's actual public browser
also agrees. Together these close the delivered-ruling gate. Only the missing owner UI
`resolveChallenge(BobD)` is authorized next, followed by canonical Bob payment/collateral, final
three-role UI, independent observer/balance checks and unchanged A/B/C verification.

### Bob's actual UI settlement and independent payment proof

The owner submitted exactly one actual UI settlement, transaction
`0xc27fb4878a820914c134be76e693057c6a700948f1d56350aabdf62f04063a0e`, block23741297,
owner nonce7, zero value and exact`resolveChallenge(BobD)` calldata. The passed operation proof is
`artifacts/ui-d/settle-2026-10-29T04-37-17.469Z-6739bf8b/ui-d-resolve-bob.proof.json`,
SHA-256`0ba2ec8145b0799523d007056c6dd2fde177456513d853e2d33728514f2341b7`.
It records one wallet request/broadcast, canonical app confirmation, resolved case3, held0 and
all pending/owed/escrow/reserves/balance0, with unchanged A/B/C financial snapshots.

The original full-stage wrapper again stopped after that passed operation. Its immutable stopped
proof is`artifacts/ui-d/settle-2026-10-29T04-37-17.469Z-6739bf8b/proof.json`,
SHA-256`dc0970ddb939c806b7783641722c79cde3c1ac111128f4fe9ff63e5d777a4ef0`.
The original is retained; its confirmed settlement must not be signed or broadcast again.
The existing read-only final verifier and an explicit original-sidecar A/B/C comparison must close
the missing aggregate separately, alongside the final role screenshots and observer.

The parent's independent public receipt/balance proof is
`artifacts/ui-d-payment-independent.json`,
SHA-256`b9bef4afee008016311cdc9956ccbf87d0faabcd03b8677256d36c78be294bd9`.
At36 observed confirmations it verified the exact successful settlement, positive canonical
`Payout` to the SAME BobD who sent the original UI deposit and challenge, and no `PayoutFailed`.
Bob received attendanceD=`1000000000000`wei and separately returned challenge collateral
`30000000000`wei. His canonical block-before/block-after balance increased exactly
`1030000000000`wei; Bob remained an EOA with unchanged nonce2 and paid0 settlement gas.
The owner paid the gas. The recorded child state has Bob paid/attended, resolved case3 and zero
held, owed, challenge escrow, pending credit/challenges, reserves and balance. This confirms Bob's
payment on-chain; final role presentation and aggregate closure remain required for full completion.

The parent's live read-only Settled observer passed161 checks:
`artifacts/chiado-ui-d-flow-audit/2026-10-29T04-46-56-133Z-0786afbb-2be2-4f79-af96-2613608cf801.json`,
SHA-256`c2df436bd400e7d6ee5d5482ad2be1d3b26025a42e657649ce01efcd913b5d89`.
Its current canonical API and direct chain state agree: both attendance paymentsD delivered,
Bob's case resolved/final1, all financial obligations and child balance0.

Final three-role UI audit passed86 read/auth requests,3 nonce signatures and6 captures with no
financial signatures/broadcasts or failures. Immutable proof
`artifacts/ui-d/status-settled-2026-10-29T04-45-26-924Z-973b436d/proof.json`,
SHA-256`8f74f78ae82cc084917ca7bd5dd9ada1451949eff464e375d8b983080993fd2c`.
The parent independently viewed Bob's actual personal screenshot: **Challenge settled**,
**Included in on-chain attendance**, **0.000001 XDAI directly paid**, no principal-refund/claim
substitution, and unused credit0. The live anonymous case UI agrees with **Challenge settled**,
**1 · Attended**, Sent2D and all obligation cards0, with further release/settlement actions disabled.
The settlement's public Blockscout page also loads successfully and shows status **Success**,
method`resolveChallenge` and block23741297. Independent all6-image review and the original
aggregate comparison remain pending at this checkpoint.

Post-payment preservation checks passed:142 frozen A/B/C operator source files and canonical
runtime/proof links remain intact, with0 key reads/signatures/broadcasts. Both existing heartbeats
remain ACTIVE at00:20 and05:02Asia/Bangkok respectively, with unchanged notification policies;
they were inspected read-only and were not modified by this D rehearsal.

### Final full-flow acceptance

The existing final operator completed read-only verification of all8 actual UI operations,
canonical AliceD/BobD attendance payments and separate challenge-collateral delivery:
`artifacts/ui-d/verify-2026-10-29T04-53-08-491Z-03585c97/operator-proof.json`,
SHA-256`cfe988e24a66ca6e287fd25591b16a78e2e602a974411c3ce703fae823121bbe`.
It reports0 additional broadcasts. Its Bob balances, attendanceD, collateral30e9 and gas0 match
the parent's independently collected payment proof exactly. All child financial obligations are0.

The final append-only aggregate completion is
`artifacts/ui-d/settle-completions/2026-10-29T04-56-38-478Z-23d75c35/proof.json`,
SHA-256`b55d3c5b1ea86666242ecbb24a14b1ffe7c2c844b41ba389f6024e91cc7f3c78`,
linked by`artifacts/ui-d-settle-completion.json`. The parent independently rehashed all7 linked
inputs, all13 financial operator and26 public source files; compared the original settlement
before/after and pre-Court A/B/C financial baselines to both final verifier snapshots; and re-read
all14 unique retained/fresh canonical block headers. Every check passed. The original journal
bytes are preserved, with0 signing-file reads,0 signatures and0 new broadcasts during completion.
The original stopped wrappers remain stopped; these records complete their outstanding reads
without rewriting history or replaying a transaction. Their exact cleanup/read failure causes
remain unproven.

The coordinated UI chat independently reviewed all6 final captures against the exact`8f74f78a...`
proof digest and passed presentation. Bob personally has direct attendanceD paid, case settled,
final1, correct IDs2/1002 and unused credit0. Alice's personalD is unchanged. The owner sees
event Sent2D and held/owed/escrow/credit/balance/reserves0. Trusted staff observations1 and
financial attendance2 remain distinct. Static screenshots do not establish DOM disabled state;
the role audit and the parent's actual public browser supply the corresponding live UI checks.

Outcome: BobD received **0.000001 test XDAI attendance kickback**, plus **0.00000003 test XDAI
returned collateral**, from the actual owner UI settlement. The UI shows **Challenge settled**
and **1 · Attended**, with no held or owed funds. The challenge/match windows were900seconds;
production Solidity retains86400seconds. This used a scoped Node test-wallet bridge and a
controlled test arbitrator; wallet-extension popup UX and real Kleros jury adjudication were outside
this rehearsal. No further D financial action is required.
