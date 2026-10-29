# Chiado 15-minute rehearsal profile

The human requested a faster test round on 29 October 2026. This is a separate profile for new
Chiado deployments. Existing A/B/C deployments and their scheduled continuations keep their original
deadlines. A deployed contract's constants cannot be changed.

| Property | Production v8 | Fast test profile |
|---|---|---|
| Application version | `kleros-event-v8` | `kleros-event-v8-test15m` |
| On-chain `VERSION()` | `8` | `80015` |
| Child | `KlerosEventV8` | `KlerosEventV8Test15m` |
| Factory | `KlerosEventFactoryV8` | `KlerosEventFactoryV8Test15m` |
| Challenge window after attendance is posted | 86,400 seconds | 900 seconds |
| Matching window after a challenge opens | 86,400 seconds | 900 seconds |
| Minimum attendance-list deadline after event start | 7 days | 7 days |
| Constructor chain restriction | Existing production rules | Chain `10200` only, factory and child |
| Build output | `build/contracts/` | `build/contracts-test15m/` |

The 15-minute timer begins when attendance is posted on-chain. Event preparation, deposits,
admission, and the event start precede that timer. It is not a promise that the entire test completes
within 15 minutes. Controlled arbitration still needs an explicit result before disputed funds settle.

## Source and build separation

New Solidity sources live in `contracts/test/`. The deterministic generator
`scripts/generate-contracts-test15m.mjs` pins both reviewed production source hashes and checks exact
replacement counts. The allowed changes are contract/import names, the distinct version, the two
timers, a chain guard in each constructor, generated-source banners, and matching timing comments.
Payout, reserve, pending recovery, capacity, refusal/ruling0, collateral and held-share logic are copied
without changes. If production sources change, generation fails until a new review updates the pins.

Pinned production SHA-256:

| Source | SHA-256 |
|---|---|
| `contracts/KlerosEventV8.sol` | `e97e3f9a4adb2bb4a697adac609367e5ad2103379bb395a241d54cedc62a9769` |
| `contracts/KlerosEventFactoryV8.sol` | `8488bb19f34f90c302afb08af99759b6308ef04199bc10dc973fa5ad35558505` |

`scripts/compile-contracts-test15m.mjs` checks generated sources before compiling. It uses the same
pinned Solidity 0.8.38 compiler, Paris EVM target and 200 optimizer runs. It checks creation/runtime
size limits. Its separate artifacts retain the production `abi`, `bytecode`, `deployedBytecode` and
`compiler` fields. The manifest also records the explicit profile, version, chain, timers, source pins,
source hashes, bytecode hashes and code sizes. The test factory embeds only the guarded test child.

```sh
node scripts/generate-contracts-test15m.mjs --check
node scripts/compile-contracts-test15m.mjs
```

The existing production compiler and production Solidity are unchanged. A mainnet deployment must
select the reviewed production profile with the full windows; the fast profile cannot be deployed
through its reviewed constructors on Ethereum chain1 or Gnosis chain100. Application version,
chain and provenance checks must also reject using the fast profile outside Chiado. These guards do
not replace a security review of a future production deployment.

## Rehearsal and completion requirements

Core integration is the sole Chiado signing operator. A fresh fast D rehearsal must use a separate
manifest, event identity, wallets, journal, server state and frontend origin. Do not append it to an
existing deployment manifest, rotate A/B/C identities, reset journals, replay submitted transactions,
or broaden the existing scheduled jobs' financial scope. Shared transaction locking remains required.

Before the first grant or deployment, the operator must check deterministic source generation,
compare current source/artifact provenance and both creation-code hashes with the reviewed immutable
plan, and check the fresh deployer nonce and predicted factory address. An approved gas-fee ceiling
must be enforced on the populated transaction immediately before signing, even if a quote was read
earlier. Factory constructor provenance must be verified before creating a child. A rejected preflight
must leave funding and factory event count unchanged. These are app/operator integration gates in
addition to the constructor and contract tests below.

The UI must identify the fast profile as a 15-minute Chiado test, display actual on-chain deadlines,
and keep each submitted stage pending until its canonical receipt is confirmed. The intended path is:

1. Alice and Bob deposit through the actual UI; confirm exact payment and payer-owned pending credit.
2. Admit them, post attendance omitting Bob, have Bob challenge, and have the organizer match.
3. After the actual challenge deadline, process ordinary payouts while Bob is unresolved. Confirm
   the UI distinguishes ordinary finalization, Bob's held share, and an unresolved dispute.
4. Deliver the controlled attended ruling1. Before settlement, show that the result is final while
   Bob's payment still awaits settlement.
5. Settle through the UI. Verify Bob's kickback using canonical payment logs, exact recipient/amount,
   balance change after gas, and reserve/owed-credit accounting. Verify the final UI reflects delivery.

A transaction hash, a `Finalized` event, or an adjudication result alone is insufficient to report
Bob paid. Notify the human when the on-chain payment and final UI proof both pass, or on a material
failure requiring action. Keep the existing C scheduled continuation active independently.

## Executed validation

The contract implementation agent executed these commands on 29 October 2026:

| Command | Actual result |
|---|---|
| `node scripts/generate-contracts-test15m.mjs --check` | Passed; exact generated source and production pins. |
| `node scripts/compile-contracts-test15m.mjs` | Passed; separate artifacts, compiler and EVM size checks. |
| `node --test test/test15m-source.test.mjs` | 2/2 passed; full normalized source equality and financial ABI equality. |
| `node --test --test-concurrency=1 test/event-v8-test15m.test.mjs` | 7/7 passed, final run 3.54 seconds. |

The financial tests use isolated in-process chain10200 and synthetic accounts, with only Court
adjudication mocked. They execute actual reverted deployments on chains1,100,1337; verify factory
fixed child code, separate owners/credits, strict deadline boundaries, late unmatched challenges,
ordinary payout with Bob's share held, delivered ruling1 before settlement, Bob's exact kickback and
separate collateral, odd ruling0 collateral splitting, and recovery of protected pending credit.

An independent reviewer found no blocker, reproduced exact ABI/creation/runtime artifacts with an
in-memory compilation, checked all source differences, reran the 2 source/ABI checks, and separately
probed constructor errors on the unsupported chains. Parent rechecked unchanged production source
hashes. No public transactions or deployment occurred during these contract tests. Historical broader
stress results for production v8 remain separate evidence; they were not rerun for this profile.

| Artifact | Source SHA-256 | Creation-code Keccak-256 | Creation/runtime bytes |
|---|---|---|---|
| `KlerosEventV8Test15m` | `46530aaf048f6a2026cdfd8e7e4cc820acce7da6a55472c10448dd7b32f638e7` | `0x5bf9454fa2653055199c63aded037886758c4f1e0b276e9290b6424cab5771c0` | 24,305 / 21,205 |
| `KlerosEventFactoryV8Test15m` | `8ee8382bf9a1dd3e8997a63cf51950ae10cdcbbf41c92c96895195e10e9a2e90` | `0x263f1f460ceb46abe9e77222d4fcfd0ffbf16f027522aea4fbac2b41391fc433` | 28,043 / 2,807 |

Core must compile the separate ignored artifacts before root build/test workflows on a clean
checkout. Application integration/build/browser validation, public D deployment, and Bob's public
payment remain separate pending evidence. This record does not claim those stages are complete.
