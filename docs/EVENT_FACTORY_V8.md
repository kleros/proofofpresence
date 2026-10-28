# Isolated event factory and hardened v8 contract

Implemented locally on 28 October 2026 after the user confirmed the hardened-child design.
The contracts are [KlerosEventFactoryV8](../contracts/KlerosEventFactoryV8.sol) and
[KlerosEventV8](../contracts/KlerosEventV8.sol). Existing v7 source, policy, template, ABI and deployment
verification inputs are preserved. No external deployment or transaction was performed.

## Architecture

Anyone can create an event through `createEvent(bytes32 eventKey, EventParameters config)`.
The caller becomes its initial owner. Each event is a separate, fully constructed contract with
its own funds, participants, dates, policy/template, owed balances, challenges and held shares.
The factory does not hold participant deposits or have an administrator, fees, upgrade function,
withdrawal function, arbitrary-code deployment endpoint or authority over child owners.

An ID is `keccak256(abi.encode(chainId, factoryAddress, creator, eventKey))`. The key must be nonzero
and unused by that creator in that factory. Copying someone else's key creates an independent
identity. `eventsById`, `eventFor`, `isEvent`, `eventCount`, and `EventCreated` support discovery.
The creation event records creator, child, key, version and the hash of the creator/config tuple.
Ownership changes on a child do not change its original deployment identity.

The factory deploys only compiler-fixed v8 creation code from immutable STOP-prefixed code storage.
Constructor arguments are explicitly encoded; callers cannot replace executable code. This avoids
putting the full child creation code into the factory runtime. Constructor failure rolls back the
entire deployment and registry update. The creation path is non-reentrant.

Factory membership proves deployment by this version of the factory. It **does not** certify a
creator's attendance honesty, arbitration provider, policy, event identity or template contents.
Those immutable inputs still require review before depositing. Ordinary ETH transfers to the
factory revert; ETH forcibly sent there has no recovery path. Deposits belong at the child address.

## Security changes from v7

| Concern                          | v8 behavior                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unregistered and excess deposits | `pendingDeposits(wallet)` and `pendingTotal` track actual sender credits. All are reserved in every phase.                                                                        |
| Registration                     | Consumes exactly `depositAmount` of that wallet's own credit. Aggregate money cannot substitute a nonpayer.                                                                       |
| Credit recovery                  | `withdrawPending(to, amount)` lets the payer recover any unused credit in any phase, independently of organizer action.                                                           |
| Deposit cutoff                   | `deposit` and `receive` accept nonzero ETH only while Open and strictly before `eventStart`; both are reentrancy guarded.                                                         |
| Capacity                         | At most 150 unique wallets can ever be admitted. Readmitting one of them reuses its history entry; refunds do not reopen a lifetime slot.                                         |
| Gas and metadata                 | At most 32 runtime template slots and 12,288 bytes of ABI-encoded template; additional name/policy/extra-data limits and EVM size checks.                                         |
| Dispute finality                 | Organizer corrections cannot override any already-resolved challenge, including rapid absent/refusal rulings.                                                                     |
| Evidence identity                | `caseOrganizer(wallet)` snapshots the owner when the challenge opens. Before that, descriptions reflect the current owner; afterward their text/CID stays fixed across transfers. |
| Compiler                         | Separate exact `solc-hardened` alias 0.8.38; v7 continues using exact 0.8.28.                                                                                                     |

Admission remains curated. An admitted person's principal cannot be withdrawn freely once committed;
Open-phase rejection/cancellation and no-list emergency recovery retain their roles. Unused credit is
separate from committed principal and remains withdrawable. `rejectAndRefund` returns principal from
an active Open staker, or one deposit from that payer's own pending balance. Short/excess credits can
always be withdrawn directly. Failed batch refunds/payouts become `owed`; `claim(to)` recovers them.

Held-share payouts, equal late redistribution (with existing rounding dust), native ETH, V1 local
versus Court IDs, appeal crowdfunding directly on the resolver, and ruling-0 economics are preserved.
The owner still controls initial attendance inclusions; falsely included attendees are not subject
to an additional new challenge mechanism. The preserved matching behavior depends on the chosen
Court/resolver's availability and fees. Arbitrator addresses must contain code, but that alone does
not establish that a provider is trustworthy or that its rules match the supplied policy.

## Building and using the contracts locally

```sh
npm ci --ignore-scripts
npm run compile             # historical v7, exact compiler and pinned artifact
npm run compile:v8          # separate new contracts and size checks
npm run test:contracts:v8   # child, factory, arbitration/security suites
npm run stress:contracts   # isolated seeded and maximum-capacity campaigns
npm test                   # full root suite, compiling v8 first
```

New artifacts, compiler standard input, sizes and hashes are generated in `build/contracts/`.
The build checks runtime<=24,576 bytes and creation code<=49,152 bytes; the factory also checks the
full child constructor payload before `CREATE`. The code-storage data chunk limit is24,575 bytes.
These correspond to [EIP-170](https://eips.ethereum.org/EIPS/eip-170) and
[EIP-3860](https://eips.ethereum.org/EIPS/eip-3860). Current sizes are:

| Contract             | Creation bytes | Runtime bytes |
| -------------------- | -------------: | ------------: |
| KlerosEventV8        |         24,258 |        21,206 |
| KlerosEventFactoryV8 |         27,944 |         2,803 |

[`src/contracts-v8.mjs`](../src/contracts-v8.mjs) provides explicit `kleros-event-v8` artifact loading,
domain-separated ID calculation and an event-specific ERC-1497 template helper. The helper produces
slots 1/2/3/4/5 for challenger/contract/lowercase challenger/organizer/lowercase organizer, safely
escaping event details. Templates must include slots 1, 2, 4. Use a separately reviewed event-specific
policy based on the [new v8 policy template](contracts/v8-attendance-policy.template.md); do not reuse
the historical v7 policy as if it described the new credit/cutoff/evidence rules.

The workbench now explicitly supports both versions. Historical v7 remains the default; select
`CONTRACT_VERSION=kleros-event-v8` for a factory-backed sandbox, or use the separately reviewed
Chiado registry in wallet-only testnet mode. Existing events and funds are never silently migrated.
The simplified interface exposes payer credit and direct recovery separately from admitted principal.
[V8_APP_RELEASE](V8_APP_RELEASE.md) records application integration and
[TESTNET_REHEARSAL](TESTNET_REHEARSAL.md) records the controlled public rollout and later real-Court work.

## Verification and limits

The focused suites cover payer-bound credit, failed recipients/reentrancy, deadline recovery, the
lifetime capacity/history bound, maximum metadata, organizer snapshots, held-share permutations,
appeal delivery/overrides/rewards, ruling0, creation rollback, identity domains and two factory-created
events sharing a participant while settling independently. Exact commands/counts are in
[TEST_REPORT](TEST_REPORT.md). The subsequent [stress campaign](CONTRACT_STRESS_TEST.md) passed
over 6,900 counted transactions and the maximum-capacity/hostile-recipient workloads without a
new contract defect. Its operational unmatched-challenge preprocessing requirement remains explicit.

Measured 150 failing-recipient release uses 12,611,013 gas; 149 failing recipients with an open case
use 12,576,884; later lost-case redistribution uses 9,188,135. The largest permitted template match
uses 1,725,263. Each retains a 30% allowance below the 16,777,216 transaction cap. The gas tests explicitly
swap synthetic account code after each wallet deposits, then restore snapshots; they are local
worst-case fixtures rather than a mainnet execution claim. Settle expired unmatched challenges
individually before a maximum batch, as with v7.

This is a tested deployment candidate. It has not been deployed, run against a current mainnet fork,
formally verified or audited by an independent professional. Review final per-event immutable inputs
and the whole final candidate before authorizing real-fund use. The [v7 security review](SMART_CONTRACT_SECURITY_REVIEW.md)
continues to apply to historical v7 deployments; adding a factory cannot patch them.
