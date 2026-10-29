# Fast Chiado UI rehearsal D — acceptance record

Status: **IN PROGRESS — no public D payment claimed.** Updated 29 October 2026, Asia/Bangkok.

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
| Integration | Build/typecheck, version/chain rejection, new UI labels/deadlines, pending-credit and batch compatibility | Build/typecheck passed; full Node suite251/251 passed. Final D-only signing-guard changes require core's separate focused results. |
| Deployment | Exact reviewed source/creation hashes, approved budget, separate D origin/manifest/state/roles, canonical factory/child receipts | Public plan independently reviewed; deployment receipts pending. |
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
its focused command/result is also separate from the251-test count.

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
