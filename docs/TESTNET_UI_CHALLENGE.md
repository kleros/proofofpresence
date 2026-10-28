# Public UI challenge and matched-dispute verification

On 29 October 2026 (Asia/Bangkok), the published application completed Bob's one actual omission
challenge on Chiado10200 through its browser wallet transaction flow. The contract transaction used
only the dedicated disposable rehearsal Bob wallet. The private key remained in Node; the browser
received an EIP1193 bridge, account address, nonce signature and transaction hash.

- App: [Kleros Event Workbench](https://kleros-event-workbench-preview.netlify.app).
- Action in the shared once-only journal: `challenge-bob-a`.
- Event A: `0x68D27419c693aD87Daa51AEF133896DDe9BC5Af2`.
- Bob: `0x083343A3247DF539a460a4a26be8393a3F0feDE2`.
- Transaction: [canonical challenge receipt](https://gnosis-chiado.blockscout.com/tx/0xfa6b8126046539d918b1f8a4e3f889e320234c00630664537fb4da53ff62442c).
- Block: `23734013`; block hash `0x97b4796f9c434ae2b5b97202f9c36f38ba6ba0a097a635f75c009e47aa1f1c0b`.
- Value: `30000000000` wei of native test XDAI; gas used: `204831`.
- Observed outcome: one successful canonical `Challenged` log; Bob's challenge was `Waiting` for a
  match. Event B's on-chain financial state and public application accounting were unchanged.

`test/testnet-ui-challenge.e2e.mjs` passed **34 live checks** plus Playwright expectations. It verified
exact application-issued origin/chain/wallet nonce proof and Secure/HttpOnly/SameSite Strict session,
actual backend-created review and validation, expanded exact signing terms, one wallet submission and
one raw broadcast, actual UI confirmation, canonical transaction/log proof, distinct event accounting
and mobile layout. No unexpected requests, browser errors or missing assets occurred. Desktop and
mobile confirmation/case screenshots were visually inspected.

Public evidence is `artifacts/testnet-ui-challenge.json`; output is
`artifacts/testnet-ui-challenge-live.log`. Screenshots are in
`artifacts/screenshots/testnet-ui-challenge/`.

## Subsequent canonical organizer match

After the UI challenge confirmed, the separate eventA organizer reviewed and executed exactly one
`match-bob-a` operation through the guarded protocol CLI. Its value was30,000,000,000wei of native
testXDAI, sent to the exact same v8 child for Bob's existing challenge.

- Match: [canonical match receipt](https://gnosis-chiado.blockscout.com/tx/0x751979ac5cdfde1822bf47aefd4140861a1f9fb67531098933d403b7a91cb108).
- Block23734075; hash `0x5334d4a24dd5560b04bf96210c7a1975fc7dd940a2124e9cad00a540fb1b865e`.
- Bob is now **Disputed**, with resolver-local ID **0** and arbitrator-side ID **1000**.
- The controlled arbitrator is in evidence period0; no final resolver ruling exists.
- A's pool is3,000,000,000,000wei, challenge escrow30,000,000,000wei and balance3,030,000,000,000wei.
  Its future payout/held-share amounts have not been assigned.
- B remains Listed, with one attendee, a2,000,000,000,000wei pool/balance and no cases. Its full
  financial projection matches the historical Listed attendance checkpoint at block23733887.

`artifacts/chiado-dispute-proof.json` records the canonical UI challenge and organizer match, both full
states and the historical B comparison at checked block23734094. Actual journals contain **21 distinct
confirmed top-level transactions**:7deployment and14rehearsal transactions. Off-chain app records and
authentication messages are excluded from that count.

A's unchanged challenge window ends **30October2026 at00:18:00Asia/Bangkok** (1793294280); B's ends
at00:18:15 (1793294295). Payouts require a later chain timestamp. Bob's original match deadline was
00:30:40 (1793295040); that match has already confirmed.

## Scheduled UI evidence — pending

The user-approved existing heartbeat `finish-kleros-testnet-kickbacks` is active at00:20Bangkok; its
next eligible run is30October2026. It must preserve the once-only journal and validate live UI between
financial stages. The scheduled browser checks are:

1. `node test/testnet-status.e2e.mjs --phase ordinary` immediately after ordinary payouts and before
   ruling. Capture the delivered ordinary shares alongside Bob's unresolved held share.
2. `node test/testnet-status.e2e.mjs --phase ruled` after the final controlled ruling reaches the
   resolver, before event settlement. Show the final decision and remaining unsettled reserve distinctly.
3. `node test/testnet-status.e2e.mjs --phase settled` after settlement/top-ups, plus the GET-only chain
   audit when available. Capture actual cumulative paid/owed facts, resolved case and organizer totals.

Wait for actual detail panels, selected event/wallet and expected financial facts before desktop/mobile
capture. Any phase-check failure stops the next financial operation. These future snapshots and the
full public kickback result remain pending; no payout, final ruling or event settlement has run yet.

## Execution boundary

The default command is review-only and reads no keys or network. `--self-test` passes19 local guard
checks with an ephemeral in-memory wallet, no network and no broadcasts. Live execution requires the
exact primary `TESTNET_APP_URL`, `TESTNET_EXECUTE_CHALLENGE=1` and an explicit operator go after
attendance is posted. It takes the protocol CLI's same `chiado-operation.lock`, loads the same plan-
bound journal and calls the existing `sendOnce` helper with decimal-normalized value. The exact signed
hash must be journaled before its one broadcast. Origin, wallet, chain10200, child address, method,
calldata, current challenge amount, review expiry and version are checked before signing.

**This fixture's action is consumed. Do not rerun its financial UI flow.** Any existing
`challenge-bob-a` journal entry stops this script. Pending/uncertain receipts are inspected or resumed
through the protocol CLI with the same saved hash; there is no reset or automatic rebroadcast. An
optional `TESTNET_REVIEW_CHALLENGE_ONLY=1` guard stops before a financial wallet request, but the same
existing-entry rule still applies. The harness accepts the API's correct HTTP201 Created response and
allows Netlify's exact same-origin `/.netlify/scripts/hud` asset.

The challenge harness verifies a public testnet browser transaction using the controlled arbitrator;
the later matching proof is a separately reviewed organizer transaction. Independent Kleros jury
arbitration and browser-extension compatibility remain outside this fixture. Public ruling, kickback
payout and settlement are pending stages with the unchanged contract time windows. Real Court needs
its separate deployed-provider/ABI review and a subsequent rehearsal.
