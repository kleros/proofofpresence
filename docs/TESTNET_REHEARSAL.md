# v8 public testnet rehearsal

The first public rehearsal uses **Chiado chain10200**, the unchanged new v8 factory/child bytecode,
and a deliberately controlled V1 test arbitrator/resolver. Test coins have no value. Anyone can use
the mock arbitrator's ruling and fee hooks, so this checks actual custody, receipts, UI and settlement
without claiming decentralized jury arbitration. A second rehearsal must verify and use real Court.

The app's existing v7 deployments remain separate and unchanged. Never load historical operator keys,
production provider configs or a mainnet registry into these tools.

## Current public checkpoint — 29 October 2026 (Asia/Bangkok)

The controlled deployment is verified on Chiado. Public manifest:
`registry/chiado-v8-controlled.json`.

- Factory: [0xe39e01873814c1959e9e678c1f088788bECa15B8](https://gnosis-chiado.blockscout.com/address/0xe39e01873814c1959e9e678c1f088788bECa15B8).
- EventA: [0x68D27419c693aD87Daa51AEF133896DDe9BC5Af2](https://gnosis-chiado.blockscout.com/address/0x68D27419c693aD87Daa51AEF133896DDe9BC5Af2).
- EventB: [0xC5C3e604E8852Ae5AB79cdaC3600384498c383eB](https://gnosis-chiado.blockscout.com/address/0xC5C3e604E8852Ae5AB79cdaC3600384498c383eB).
- Controlled resolver: `0x45DE965E607F16FC9b8f8a912dfAc6a98411B9eb`;
  controlled arbitrator: `0x7660A60D3f89987D688E0CF826881D868Fc8141c`.

There are **21 distinct confirmed top-level transactions**:7in the deployment journal and14in the
rehearsal journal. They cover deployment/funding, four deposits, excess-credit recovery, separate
organizer registrations, two attendance lists, Bob's one browser-initiated challenge and one organizer
match. The app's wallet-proven synthetic registrations, approvals and trusted door observations are
off-chain operations and are excluded from that transaction count.

At checked block23734094, A was **Listed**, with3registered stakers, Alice/Carol listed as attendees,
one matched Bob dispute, a3,000,000,000,000wei pool and30,000,000,000wei challenge escrow. Its balance
was3,030,000,000,000wei. No payout share or held-share amount has yet been assigned. B remained Listed
with Alice as its one attendee, one staker, a2,000,000,000,000wei pool/balance and no cases. Its complete
financial state matched the historical Listed attendance checkpoint at block23733887.

The canonical organizer match is
[0x751979ac5cdfde1822bf47aefd4140861a1f9fb67531098933d403b7a91cb108](https://gnosis-chiado.blockscout.com/tx/0x751979ac5cdfde1822bf47aefd4140861a1f9fb67531098933d403b7a91cb108),
block23734075. The resolver-local dispute ID is **0**; its arbitrator-side ID is **1000**. The
controlled arbitrator is in its evidence period, the resolver has no final ruling, and the event's
challenge state is Disputed. [Public dispute proof](../artifacts/chiado-dispute-proof.json) records
both canonical receipts, the exact mapping, full A/B states and the historical B comparison.

Both deposits closed on28October2026 at23:21:25Asia/Bangkok. Their claim deadline is4November2026 at
the same time. Actual unchanged challenge-window deadlines are **30October2026 at00:18:00Bangkok
for A** (timestamp1793294280) and **00:18:15for B** (1793294295). Payouts require a strictly later
chain timestamp. Bob's original match deadline was00:30:40 (1793295040); the match already confirmed.

**Full public kickback completion remains pending.** No payout, controlled final ruling or event
settlement has run. The existing user-approved heartbeat `finish-kleros-testnet-kickbacks` is active;
its next eligible00:20Bangkok run is30October2026. It must recheck chain state/journals, preserve all
existing hashes and stop if a transaction or required UI checkpoint fails. The scheduled stages and
screenshots below remain future verification work. Real Kleros Court is a separate subsequent phase.

The ignored `.runtime/testnet/chiado-pre-attendance.json` remains historical evidence of the earlier
17-transaction checkpoint. App-sync and attendance proofs preserve the later transitions; journals
retain recovery data without storing signed bytes or private keys.

## Network and funding

The [official Chiado network documentation](https://docs.gnosischain.com/about/networks/chiado)
defines chain10200, RPC `https://rpc.chiadochain.net`, native18-decimal testXDAI and
[Blockscout](https://gnosis-chiado.blockscout.com). The
[official faucet](https://faucet.gnosischain.com/?chain=chiado) may require email verification and a
wallet signature; complete those personally. Do not send private keys or seed phrases in chat or
paste the generated signing file into a website. If the faucet funds your own wallet, send a small
testXDAI transfer on **Chiado10200** to the dedicated public deployer address printed by `--prepare`.

The initial0.2testXDAI budget was reduced after measuring actual network costs. At read-only block
23733022, Chiado reported gasPrice7wei, maxFee14wei and blockgaslimit17,000,000. Unsigned estimates
were1,211,581gas for the mock arbitrator,1,862,033 for the resolver and6,078,094 for the factory.
These are observations, not future fee guarantees. The fixtures now use deposits0.000001/0.000002XDAI,
0.00000001XDAI per mock juror,0.00001 organizerB gas funding and0.00002 per participant. Total planned
wallet distributions are0.00007XDAI; **0.0002testXDAI** is the current conservative rehearsal estimate.
The official faucet's observed0.001 grant can cover that budget at these measured fees. Tools check
the actual fee/balance before each submission and stop if insufficient; they never buy coins.

The first rollout observed the priority-fee oracle spike to approximately4.17gwei while the actual
base fee remained7wei. New operations therefore use an explicitly bounded100,000wei priority fee
and `maxFeePerGas = 2 * currentBaseFee + priority` (legacy gas price is similarly bounded). An existing
journaled transaction is never replaced to change fees. Before first broadcast, the tool reserves
the planned role funding plus50milliongas at that bounded ceiling; each submission also checks its
actual gas/value/balance. Low-priority transactions may take longer to confirm. A timed-out receipt
wait is not proof of failure: inspect its saved hash and resume receipt checks without rebroadcasting.

## Prepare and review

```sh
npm run compile
npm run compile:v8
node scripts/testnet-deploy.mjs --prepare \
  --public-origin https://kleros-event-workbench-preview.netlify.app \
  --start-in-minutes 120
node scripts/testnet-deploy.mjs
```

Preparation creates/reuses an owner-only0600 signing file under ignored
`.runtime/testnet/chiado-deployer.json`, with independent organizerA/organizerB/Alice/Bob/Carol wallets.
Private keys never appear in the plan, manifest, journal or command output. Only the public deployer
address needs initial funding; explicit deployment/rehearsal stages fund the disposable role wallets.
Keep that private file locally for later organizer/participant signing and receipt recovery.

The unsigned plan is `.runtime/testnet/chiado-plan.json`. It binds network, public addresses, separate
event keys/amounts/owners/dates, exact source hashes/compiler/creation bytecode and the SHA256 of
`public/policies/v8-testnet.md`. Both compilers recompile saved inputs and compare actual artifacts.
The v7 compiler remains0.8.28 and the new v8 compiler remains0.8.38. Re-running `--prepare` can refresh
an expired unsigned schedule while retaining wallets/plan identity, **only before any deployment
transaction has been journaled**. Once deployment begins, preserve the exact plan.

Publish the exact policy at the configured public origin before deployment. The deployment command
requires200 with the reviewed bytes and does not follow redirects. It does not claim an IPFS pin.
The policyURL is immutable in each contract; its HTTPS hosting is still mutable, so the public manifest
also records the reviewed content hash. Real-fund/real-Court policy publication needs separate review.

## Explicit deployment and recovery

```sh
node scripts/testnet-deploy.mjs --deploy
```

This is the only deployment broadcast command. It refuses every chain except a directly reported
Chiado10200, validates source/policy bindings, uses the dedicated local keys and permits one operation
at a time. It deploys the mocks, sets the explicit synthetic fee, deploys the fixed-code v8 factory,
funds organizerB's gas wallet, then creates two isolated children with different owners and deposits.
Creation logs, immutable terms, provider links, version and factory creation code are checked.

Before each single broadcast, the signed hash/nonce/expected public call are atomically journaled in
`.runtime/testnet/chiado-deployment-journal.json`. Signed bytes/private keys are never journaled. The
tool waits for two confirmations and verifies successful canonical receipts against sender, nonce,
target, calldata, value and chain. That is confirmation evidence, not an assertion of finality.

If a connection is interrupted, repeat the **same command and plan** to check saved hashes. It never
automatically signs/rebroadcasts an existing operation. A hash prepared before a crash may not have
reached the network: inspect its nonce/hash and decide recovery manually rather than creating a
second transaction. A reverted transaction stops the rollout. A stale lock also requires journal
inspection before manual removal. Do not delete journals or reset a public deployment to bypass a stop.

Only after both children verify does the command atomically write
`registry/chiado-v8-controlled.json`. It contains public chain/arbitration/factory/definition/deployment
metadata and v8 receipt/configuration provenance. It contains no signing material. Backend attachment
must re-verify every event against this manifest; the browser signs transactions itself.

## Bridge existing public receipts into the app

After the first live browser acceptance and while both events are still Open, synchronize the
synthetic on-chain fixture with the app's separate registration/admission/check-in records:

```sh
node scripts/testnet-sync-app.mjs
node scripts/testnet-sync-app.mjs --execute
```

The default command performs public reads only and prints a review. Execution is explicitly limited
to the main Netlify origin, controlled Chiado10200 and the exact deployed registry. The disposable
Alice/Bob/Carol wallets sign only fresh server-issued authentication messages bound to origin,
chain and wallet. Session cookies stay in memory and are closed afterward. No key or cookie is
written to proof/log output. There is no contract-transaction signing or broadcast API in this helper.

The helper preserves existing Alice registrations from live acceptance. It self-registers only missing
synthetic wallet records, verifies each actual journaled deposit against canonical public RPC data,
links only missing receipts, and has the correct separately authenticated organizer approve pending
off-chain admissions. Existing names/contacts, linked receipts and prior decisions are preserved;
conflicting evidence or a declined/free decision stops for inspection rather than being overwritten.

During the reviewed event hours, the authenticated organizers can record explicit synthetic staff-door
observations for Alice/Carol in A and Alice in B, using stable per-fixture replay nonces. Bob receives
no observation, preparing the intended omission/challenge scenario. Already recorded observations
are preserved. Outside event hours the helper records a skipped action and
`trustedObservationsReady:false`; it does not manufacture a time or financial attendance list.

Before and after synchronization it compares A/B authoritative financial projections while protocol
operations are quiet, proving the helper did not change their visible financial state. Its endpoint
allowlist excludes financial drafts/execution, funds, time controls, mock rulings, imports and RPC sends.
Public proof is saved in ignored `.runtime/testnet/chiado-app-sync-proof.json`. Inspect the actions and
observation-readiness flag before reviewing the later attendance transaction. Six focused mock-API
tests cover endpoint restrictions, same-event attendee/owner nonce handling, nonce binding, canonical
receipt matching, existing-record preservation/idempotence and complete financial comparison.

## Deposit → dispute → kickback stages

Each stage first prints its public reviewed operations. Add `--execute` to submit that stage once;
resume checks use its saved hashes. Default/no-stage invocation is read-only status.

```sh
node scripts/testnet-rehearsal.mjs
node scripts/testnet-rehearsal.mjs --stage fund
node scripts/testnet-rehearsal.mjs --stage fund --execute
```

Run the remaining explicit stages in this order:

1. `deposit`: Alice sends one A transfer worth two deposits, Bob/Carol one A deposit each, and Alice
   one independent B deposit: four transactions in total.
2. `recover-credit`: Alice withdraws her own excess A credit before admission, exercising autonomous recovery.
3. `admit`: organizerA registers three payer-backed participants; organizerB registers Alice independently.
4. `attendance`: **wait until eventStart**, then post Alice/Carol in A and Alice in B. Bob is omitted in A.
5. `challenge`: Bob pays the current A challenge deposit. Do this inside the unchanged one-day window.
6. `match`: organizerA matches it before the match deadline, opening a resolver-local/Court-arbitrator case.
7. `payout`: **wait until after challengeEndsAt (one full day)**. Ordinary A attendees receive their shares
   while Bob's unresolved case retains a held share. No jury ruling is fabricated during this wait.
8. `ruling`: explicit controlled ruling2 by default (`--ruling 0|1|2` selects a fresh scenario's outcome).
9. `settle`: settle the final resolver ruling. A lost/refused case redistributes its held share equally;
   a won case pays Bob. Compare B's balances/counts/phase before and after A settlement.
10. `verify`: verify canonical payout logs, zero remaining A pending/held/challenge reserves and unchanged
    B. With `--execute`, save public proof in `.runtime/testnet/chiado-rehearsal-proof.json`.

Do not run these scripts against an event being simultaneously altered through the browser; they are
dedicated synthetic fixture scenarios with exact prerequisites. Use a new explicitly prepared instance
for a different ruling permutation. Admission/registration, pending credit and committed principal
remain distinct. The scripts do not change contract durations or call time/balance manipulation RPCs
on public networks. A public complete rehearsal therefore takes at least one day after attendance.

The direct contract fixture stages complement browser acceptance; they do not prove off-chain user
registration, email ownership, browser-extension behavior, public evidence publication or a real jury
appeal process. Those checks belong in the app integration and second Court rehearsal.

## Scheduled payout and UI checkpoints — pending

The existing00:20Bangkok heartbeat must follow the canonical state and existing once-only journal,
with ordinary A payouts before its controlled final ruling and event settlement. It must capture and
validate the live UI at each boundary; a failed/missing check stops the next financial stage.

1. After the ordinary payout batch, **before any ruling**, run
   `node test/testnet-status.e2e.mjs --phase ordinary`. Verify Alice/Carol's actual ordinary payment
   facts and Bob's still-open reserved share. Expected fixture values are1,000,000,000,000wei paid to
   each ordinary attendee and1,000,000,000,000wei held for Bob. The event phase is Finalized while
   Bob's challenge remains Disputed. Capture fully loaded organizer, participant and case screens
   with the unresolved dispute visible.
2. After the controlled final ruling is delivered to the resolver, **before event settlement**, run
   `node test/testnet-status.e2e.mjs --phase ruled`. Verify final resolver ruling2 separately from the
   Bob challenge's still-unsettled Disputed state and retained share; the event remains Finalized.
   Capture the final-decision/settlement controls without labeling that reserve as delivered kickback.
3. After the event's canonical settlement and top-ups, run
   `node test/testnet-status.e2e.mjs --phase settled`, followed by the GET-only chain audit when
   available. Verify actual payout logs, any owed payments, the resolved case and zero remaining A
   held/challenge reserves. Expected successful EOA cumulative payments are1,500,000,000,000wei each
   for Alice and Carol. Capture fully loaded participant totals and organizer/case settlement views.

Wait for the selected event, wallet, actual detail panel and expected monetary facts before each
screenshot. Preserve desktop/mobile evidence with the matching canonical receipt/block references.
Screenshots establish rendered behavior; canonical receipts and logs establish delivery. B must remain
financially unchanged through the A settlement proof. These scheduled checks have not run yet, and
this document does not claim their expected outcomes as completed public evidence.

## Real Court phase

[Kleros's official deployment list](https://docs.kleros.io/developer/deployment-addresses) lists Chiado
V1 xKlerosLiquid `0xD8798DfaE8194D6B4CD6e2Da6187ae4209d06f27` and ArbitrableProxy
`0x4BEf0321BD7fa943f85ae55e07f790c6beCbd177`. Read-only checks at block23732922 found code at both,
the proxy's `arbitrator()` matched that address, `getMultipliers()` returned10000/20000/5000/10000,
and court0/three-juror `arbitrationCost` was0.03nativeXDAI. Query current fees at review/signing time.

The public resolver is currently reported **unverified** by Blockscout's ABI endpoint. Its core views
respond, but full interface equivalence is not established. In particular, the official GitHub proxy
source uses scalar withdrawal arguments in one version, while this workbench's deployed-version mock
uses arrays. Verify the precise deployed ABI, events, evidence, local versus arbitrator IDs, appeal
funding/withdrawal functions and currently available jurors before committing a new immutable child
to that resolver. Real cases advance through actual voting/appeal periods and cannot promise an
immediate final ruling. Never use the controlled mock's vote hooks as evidence of a real Court result.

Kleros V2 on Arbitrum Sepolia has a different resolver/template model. It requires a reviewed adapter;
substituting V2 addresses into the V1 constructor is not compatible. The current deployment tool is
deliberately controlled-Chiado only and cannot silently switch to another provider or chain.
