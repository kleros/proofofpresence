# Simplified v8 application and Chiado release checkpoint

Branch: `codex/core-application`. This source checkpoint prepares the user-authorized controlled
Chiado rehearsal; the public deployment record is saved separately after health and live checks.

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
