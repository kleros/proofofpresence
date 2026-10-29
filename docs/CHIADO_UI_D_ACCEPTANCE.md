# Fast Chiado UI rehearsal D — acceptance record

Status: **IN PROGRESS — actual UI dispute matched and independently verified; ordinary payout/ruling/settlement pending. Bob payment pending.**
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
| Ordinary payout | After actual deadline, UI pays AliceD; Bob remains unruled with D held; UI says unresolved, not fully paid | Pending. |
| Delivered ruling | Controlled attended ruling1; role UI shows final result with settlement pending; Bob's D still held | Pending. |
| Settlement | UI settlement, canonical BobD attendance payment, separate collateral balance proof, no pending/held/owed/reserve obligations | Pending. |
| Final UI | Bob, Alice, owner and cases views agree with canonical settled state and delivered payments | Pending. |

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

Public manifest/origin, exact stage transaction hashes, immutable browser/observer proof paths and
final Bob balance/receipt evidence will be added after actual execution. Notify the human only after
the on-chain payment and final UI checks both pass, or on a material failure requiring action.

Prepared public D identity: plan`70688861-87e2-4936-9e2e-bdc9a7c7a5fd`, fingerprint
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
