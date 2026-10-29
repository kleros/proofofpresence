# Fast Chiado UI rehearsal D — acceptance record

Status: **IN PROGRESS — same-D pre-child schedule revision being prepared. No D deposit or payment.**
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
| Deployment | Exact reviewed source/creation hashes, approved budget, separate D origin/manifest/state/roles, canonical factory/child receipts | Three grants and factory independently confirmed; child creation pending after a safe stop. |
| Deposits | Alice and Bob each initiate the real UI deposit; one reviewed request/broadcast per wallet; canonical payer-owned credit | Pending. |
| Admission | Owner uses UI; exactly two admitted principals, pending credit0, no attendance payments | Pending. |
| Attendance and dispute | UI attendance omits Bob; Bob challenges; owner matches; actual dynamic resolver/arbitrator IDs and 900-second deadlines | Pending. |
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
Planned event start is29October09:24:20Asia/Bangkok; the challenge deadline must come from actual
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

The final same-plan attempt also stopped at its strict operational time margin. Core verified no D
child journal entry, no D manifest and no unknown child hash. The four setup transactions remain
confirmed. The prepared10:30 start-revision proposal was **not applied**; the original D plan,
fingerprint, scheduled times and journal are retained unchanged. No deployed contract deadline changed.

Core selected an append-only same-D pre-child schedule revision as the more bounded continuation
under the human's explicit request to finish the full fast UI test. The human did not prescribe the
original synthetic09:24 start; no event child exists and no additional funds/roles/source are needed.
The revised proposed start is10:30Asia/Bangkok, with only event start/end/claim-deadline plan fields
changing. Original raw plan/journal snapshots and all four transaction entries must remain preserved.
No new human approval question was sent. The independent public proposal review passed; the actual
metadata migration requires its own guarded implementation/test/apply evidence before deployment.

The D2 contingency design/observer/tests were prepared but never activated. D2 has no plan, journal,
child, signing or payment. The three parent-created files were reversibly archived with unchanged
hashes under`.runtime/unused-d2-review/` and removed from the active source/test tree. Active financial execution continues through
the single canonical D plan/journal with an auditable revision, the same factory and funded wallets,
and no new grants or factory deployment. D is not labeled a completed UI rehearsal; none of its local
tests or setup receipts prove Bob paid.
