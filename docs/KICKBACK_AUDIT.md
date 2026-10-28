# Kickback source review and local verification

Reviewed 28 October 2026. Checkout `references/kickback`, branch `main`, source HEAD
`57fc1c8233c60e31c1b5988c631ef57d7c3f1b81`; initially clean. This matches the handoff snapshot.
The canonical project brain is [../PROJECT_BRAIN.md](../PROJECT_BRAIN.md).

Read README, CLAUDE, REVIEW (including superseded v1–v6 notes), attendance policy,
deployment verification inputs, contract, verification/payout/owner/site/console scripts,
V1 mocks and contract/script/browser tests. Historical account/device permissions are not
current authorization. No upstream writes, mainnet transactions, public IPFS uploads, or guest
submissions were performed.

## Confirmed source behavior

- Native ETH; `deposit`/`receive` emit deposit evidence without registering the payer.
  The owner curates admission after receipt/log, sender, timing, approval, duplicate and return checks.
- Live v7 direct deployment is recorded at `0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D`,
  mainnet block 26290226. This is a repository record, not a fresh production-state observation.
  Current Solidity bytes equal the source in the recorded standard compiler input.
- V1 resolver local IDs identify evidence/appeals; arbitrator IDs identify Kleros cases.
  Appeal contributions come from funders directly. Final resolver `isRuled`/ruling governs settlement.
- One-day challenge and separate one-day matching periods; anyone can match. Expired unmatched
  cases become attended. Rulings 1/2/0 retain their existing attendance and challenge-money behavior.
- Normal payouts proceed with matched cases open. `heldShare`, later redistribution, `owed`,
  reserve protection and alternate-recipient claims are implemented and meaningfully tested.
  Cancellation is Open-only; no-list emergency withdrawal is after `claimDeadline`, not a bypass of disputes.
- Historical template and policy are immutable deployment inputs. A computed CID is not evidence
  of IPFS availability; existing publish/retry and failure visibility are preserved.

## Reproduced gaps and changes

1. `verified.csv`/`claims.csv` were unbound intermediates; payout generation attached the selected
   contract to their contents. They now carry event/deployment columns plus mandatory hashed sidecars.
   A wrong event/contract/chain/version, modified file or changed financial config is rejected.
2. Raw Luma/manual exports lack independently verifiable origin. Both stages now require a named
   organiser's explicit review bound to exact bytes, and disclose the trust limitation. Available
   event/chain/contract/Luma metadata conflicts are rejected before any review can override them.
3. Action plans now carry source/config/snapshot hashes, owner and (for attendance) exact registered
   staker set. The CLI refreshes those before signing; the event-aware console checks the same fields.
4. v7 ABI/bytecode is preserved in `abi/v7/` with source/artifact checksums. Unsupported versions fail
   closed, and compilation cannot silently replace the adapter used for historical contracts.
5. Guest copy and new case templates can name each event, venue/timezone and network. The historical
   Truth Pays template/policy/deployment files are unchanged. New guest transaction storage is scoped
   by environment, event, chain and contract. Console deployment memory gains event scope.
6. Playwright was undeclared and browser tests used machine-specific fallback paths. It is now pinned;
   path decoding uses `fileURLToPath`, fixing this workspace's spaces. Contract tests use a free local port.

The unchanged single-event console preserves legacy artifact checks for legacy configs; strict
event/config/snapshot checks activate with explicit `eventId`. New multi-event configs must set it.
The standalone console is an operator tool, not an authenticated multi-user service. The unified
application must protect its mounting routes. Raw review files are local operator records, not signed
attestations from Luma or a replacement for staff authentication.

## Executed baseline

Environment observed: Node 25.8.1, npm 11.11.0, macOS arm64. Dependency locks used, lifecycle scripts
disabled during install. Ganache falls back to pure JavaScript because this Node ABI has no bundled
native module. The initial sandbox run could not bind localhost; the successful runs permitted local
test servers. Browser network integrations are mocked by the suites.

| Command | Actual result |
|---|---|
| `npm ci --ignore-scripts` | Installed 355 packages; npm audit reported 37 inherited dependency advisories |
| `npm run compile` | Pass, solc 0.8.28, optimizer 200, Paris |
| `npm test` before changed script behavior | 45/45 pass, 279 seconds |
| `npm run test:site` after declaring Playwright and fixing paths | 180/180 pass |
| `npm run test:console` after declaring Playwright and fixing paths | 159/159 pass |
| `node --test test/provenance.test.mjs` | 7/7 pass: review, conflicts, substitution, stale config, ABI/source preservation, generic template |
| `node --test --test-name-pattern='two concurrent v7 events' test/contract.test.mjs` | Pass: real local v7 instances, distinct owners/deposits/schedules, one wallet both, A open case + held share, B settles independently |
| Changed script suite | 10/10 pass after provenance wiring and stale-action checks |
| Final combined `npm test` | 54/54 pass, 277.6 seconds (36 contract + 11 script integration + 7 provenance/compatibility) |
| Final guest `npm run test:site` | 180/180 pass with event-scoped storage and configurable event/network copy |
| Final organiser `npm run test:console` | 159/159 pass with fresh config/wallet/RPC checks immediately before signing |

The new script integration also proves cross-event intermediates, contradictory raw event metadata,
missing reviews and same-size registered-staker replacement cannot authorize the old payout plan.
The root TEST_REPORT aggregates these results with the unified application's verification.

### Clean root-only dependency check

A separate clean copy installed only the root lockfile (Node 25.8.1, ethers 6.16.0,
Playwright 1.58.2). Its first retained-contract run passed 53/54 and exposed a nonce-cache
race in `owner.mjs`: settling an unmatched challenge then immediately releasing payouts
could reuse the prior pending nonce. The CLI now uses `ethers.NonceManager` for sequential
transactions within one invocation. This changes nonce handling only; Solidity and financial
rules remain unchanged. The two relevant integration scenarios passed 2/2 after the fix,
and the complete clean `npm run test:contracts` then passed **54/54 in 253.4 seconds**.
The root-only clean guest browser suite passed **180/180**. Its standalone organiser server
initially looked for ethers' browser bundle under a nonexistent nested `node_modules`; it now
resolves the actual installed package location. After that path fix, the clean organiser browser
suite passed **159/159**. Both browser commands exited 0 with Playwright 1.58.2 and ethers 6.16.0.
Their external integrations remained mocked and all contract writes stayed on local Ganache.
`test:fork` was not run: no local mainnet fork was supplied. Local mocks reproduce the V1 interface,
not current production juror behavior or RPC availability. The inherited Ganache dependency audit
advisories remain; no broad forced upgrade was made during a financial compatibility refactor.

## Operational boundary

This work does not upgrade the deployed v7 instance. Existing users and funds remain under that
contract and its recorded policy. New events get independent deployments and their own immutable
template/policy. Public metadata sync, personal attended history, booth leads, merch progression and
marketing consent cannot authorize financial attendance. No new ERC20 deposit support is claimed.
