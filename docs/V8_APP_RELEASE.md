# Simplified v8 application and Chiado release checkpoint

Branch: `codex/core-application`. The user-authorized controlled Chiado app is live at
[kleros-event-workbench-preview.netlify.app](https://kleros-event-workbench-preview.netlify.app).
Exact backend/frontend source commits, deployment IDs and image digest are in
[hosting evidence](../artifacts/testnet-hosting.json). This is the current checkpoint;
older v7 online-demo records are historical.

The interface presents one next action, four participant steps and expandable technical facts.
Exact transaction review, event/wallet isolation and receipt recovery remain authoritative. Native
currency/network labels follow trusted bootstrap metadata. The visual patterns are in `ui-registry.md`.

`CONTRACT_VERSION=kleros-event-v8` explicitly selects real factory-created local v8 events; v7 remains
the compatibility default. Version dispatch checks runtime/immutable terms/factory creation provenance.
Pending payer credits, admission and committed principal remain separate. The `withdrawPending`
action recovers only the signer's unused credit; canonical replay prevents reused returned receipts
and preserves admitted principal assembled from multiple deposits when excess credit is withdrawn.

`testnet` and `hosted-testnet` load only the reviewed Chiado10200 registry. They use signed wallet
nonce proof, external wallet signing, no demo impersonation/faucet/time/unlocked transactions and a
manifest-bound private state file. Hosted testnet requires one persistent volume. The root startup
helper owns only `/data`, drops to uid1000 before importing application code, then starts the server.
No keys or legacy mainnet registry enter the upload context.

Meaningful validation: build/typecheck; full164-check Node run with one capability-shape regression,
corrected and rechecked in19 hosted/runtime/tooling tests; focused tooling then10/10 after a bounded
fee-oracle safeguard. The new v8 application case covers deposit/recovery/old receipt rejection,
combined-credit admission, excess withdrawal, trusted check-in, matched dispute, normal payouts with
one held share, late winning ruling and full kickbacks with independent Event B. Browser suites
passed39 lifecycle +49 redesign +16 signing safety +4 context +35 HTTPS +13 simplev7 +18 simplev8 =174
checks plus Playwright expectations. External-runtime tests use actual loopback HTTPS/chain10200;
presentation fixtures are not public deployment evidence.

The public rehearsal uses test xDAI, explicit controllable V1 mocks and unchanged v8 contracts. A
separate real-Court phase still needs deployed resolver ABI/provider compatibility verification.
Public chain time is real: after attendance, challenge/matching windows last one day. Payout and
held-share settlement remain pending until their exact chain prerequisites. Do not automatically
rebroadcast, reset or modify public contract deadlines. See `docs/TESTNET_REHEARSAL.md` for stage
commands and recovery; transaction hashes are journaled before a single submission.

## Live loading correction

The first public run exposed7.57second bootstrap and18.92second anonymous event-detail reads from
repeated public-RPC proof work. External Chiado contexts now reuse only positive immutable proofs,
keyed by the complete trusted deployment/manifest identity. Every reuse still reads actual chainID,
event code, factory code and the canonical creation-block hash. A changed anchor/registry fails closed
or runs full verification. Mutable owner, balances, pending credit, fees, deadlines and financial
snapshots are never cached. Detail and summary reuse one request's verified snapshot.

Nine focused adapter/runtime tests passed after this correction, including actual code changes,
chain/reorg fault injection, registry tampering, reduced immutable RPC calls and fresh mutable-state
updates. The real HTTPS signature/deposit/restart test dropped from10.18seconds to3.98seconds locally;
public latency is measured again after deployment. This preserves real-time transaction validation.

A second correction groups independent mutable reads at one newly selected block instead of waiting
for each list/balance/credit round trip. This adds no state cache. The same nine focused tests passed,
including fresh owner/fee/credit changes. An official alternate Chiado archive RPC was read-only
benchmarked with exact deployment/code checks; its complete anonymous detail read took5.83seconds
locally. The final public latency remains an observed deployment check, not a promised bound.

## Public checkpoint and continuation — 29October2026, Asia/Bangkok

247 live wallet/API/UI checks and34 UI-challenge checks passed with fully loaded screenshots.
Canonical public deposits, excess-credit recovery, independent admission, app observations,
attendance and Bob's actual UI challenge/organizer matching are confirmed. The21 successful
transactions are7 deployment +14 rehearsal; no future stage is claimed complete.

The [match proof](../artifacts/chiado-dispute-proof.json) records Bob Disputed, resolver localID0 versus
arbitratorID1000, unruled. A is Listed, pool3e12wei, balance3.03e12wei, escrow30e9wei and held0 before
ordinary payout. B remains Listed with2e12wei/no cases; its full financial comparison is unchanged.
A/B application records and canonical deposit links survived actual deployed backend image replacement.

A challenge deadline is2026-10-29T17:18:00Z; B17:18:15Z: **30October00:18:00/00:18:15Bangkok**.
User-approved heartbeat `finish-kleros-testnet-kickbacks` is ACTIVE daily00:20Bangkok, next eligible
30October. It must verify fresh chain time/state, then review/execute ordinary payout with Bob still
unruled, audit UI/held share, deliver controlled ruling2, audit final-before-settlement, settle and audit
actual top-ups/owed balances and B isolation. It must pause after fully verified completion. The local
computer and Codex app must remain running for scheduled execution. No duplicate job or financial
operator; preserve exact private journals/plan. Existing hashes permit receipt checks only.

Read-only phase command: `node test/testnet-status.e2e.mjs --phase matched|ordinary|ruled|settled`.
The phase harness signs scoped authentication nonces only and never submits financial operations.
Public phase proofs are `artifacts/testnet-status-<phase>.json`; failure stops the next financial stage.

## Execution coverage

Deployment, funding, deposits, excess-credit recovery, on-chain admission, attendance and matching
were initiated by the once-only CLI. The browser acceptance linked their existing canonical receipts
and checked actual wallet/API/UI state. Bob's challenge was initiated through the real public UI
exactly once. Scheduled ordinary payout, controlled final ruling and settlement use the reviewed
CLI with browser/status and independent GET-only chain audits between every stage. This does not
claim a fresh browser-initiated public deposit, normal browser-extension coverage or real Court jury
execution. Preserve the closed fixture; do not replay deposits to fill a coverage gap.
