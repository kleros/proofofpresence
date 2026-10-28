# v8 contract stress campaign — 28 October 2026

**The final combined campaign passed. No new contract defect was confirmed.** The tests found no
custody, reserve, payout-order or reentrancy discrepancy under the tested inputs. The documented
maximum unmatched-challenge batch limit was reproduced with its permissionless recovery path.
This is bounded testing, not a proof of complete safety or an independent professional audit.

Both production contract sources and creation-code hashes remain identical to the previously
reviewed v8 candidate. Historical v7 is unchanged. Only stress fixtures, test orchestration,
compiler provenance reporting and documentation changed in this round.

## Reproduce

From the repository root with dependencies installed:

```sh
npm run stress:contracts
```

The command compiles historical v7 and new v8 separately, then runs four isolated in-process
Ganache campaigns. It does not load a live RPC URL, service configuration or wallet credentials.
Each invocation saves raw logs, seeds, action traces on failure, metrics and a manifest under
`artifacts/stress/<unique-run-id>/`. These generated directories are ignored by Git and retained
locally. `artifacts/v8-stress-latest.json` identifies the latest invocation and explicitly labels
its status and requested suites. The durable [verification summary](../artifacts/v8-stress-verification.json)
records this completed run's metrics, source/artifact hashes and raw evidence paths.

Sources, used mock artifacts, compiler manifest and standard input are fingerprinted before and
after execution. The runner rejects stale compiled sources, wrong creation-code hashes or changed
historical source. Preflight failure records a failed manifest and pointer; an invalid-suite negative
check verified that a previous successful pointer cannot masquerade as that failed invocation.
Success requires every requested process to exit 0 and write a successful report, with all hashes stable.

## Executed coverage

Final run: `2026-10-28T15-42-17-430Z-b75884be`. The campaigns completed in **222.97 seconds**, after
compilation, on the local macOS/Node environment. Runtime will vary by machine.

| Campaign                           | Actual workload and results                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent admission/credit model | 32 seeds, 2,048 generated actions and 2,998 total actions; 2,241 mined transactions, including 816 expected atomic reverts; 3,030 complete model snapshots; 55,098 counted assertions.                                                                                                                                                                                                                          |
| Independent settlement model       | 64 scenarios from 32 paired seeds with reversed late settlement orders; 2,216 transactions and 71,479 counted assertions. 188 matched and 38 unmatched cases, rulings 0/1/2, early/late settlement, 251 failed payments, 106 alternate claims and 438 pending withdrawals.                                                                                                                                      |
| Maximum capacity/factory           | 2,494 transactions; 150 lifetime admissions, 512 refund/readmission cycles, 149 waiting challenges, 149 simultaneous matched disputes, and 32 events from four creators. Valid maximum payloads, actual reverted duplicate/invalid creation, ownership isolation and rollback were checked.                                                                                                                     |
| Hostile callbacks/fees             | 170 financial-entry vectors across ten payment paths produced **187 actual callbacks**, all rejected with `Reentrancy`. 46 gas allowances produced 35 confirmed mined atomic reverts and 11 complete payouts. Four hostile recipient modes include two 32-KiB success/revert returndata cases. 21 fee-change scenarios cover zero, the exact two-deposit boundary, values above it and a maximum-uint256 quote. |

The first three campaigns alone count **6,951 mined transactions**. Hostile-campaign transactions
are additional and not included in that total. Ledger and settlement models record **126,577
assertions**; capacity and hostile campaigns additionally check state invariants. These are operations
and assertions, not thousands of independent test cases. Expected reverts demonstrate rejected
actions or atomic insufficient-gas behavior and are not counted as test failures.

The ledger model independently checks wallet credits, status, active/lifetime sets, recipient balances
including transaction gas, principal/credit separation, total custody, reserves and actual spare funds
after every action. It exercises unauthorized operations, duplicate/partially valid batches, credit
reuse, failed admission, repeated readmission, cancellation and exact cutoff/no-list recovery.

The settlement model independently computes integer holder entitlements, escrow, cash and pending/owed
ledgers. It reconciles actual payment/failure logs and external balances, compares paired outcome
permutations and checks documented rounding bounds. Mock rulings supply adjudication; the actual
v8 bytecode handles custody, distribution and claims. The normal arbitration regressions also verify
delivered finality, appeals, contributor rewards and ruling-0 collateral splitting.

Hostile fixtures return/revert with 32 KiB, refuse ETH, exhaust forwarded gas, or call back into each
of 17 balance-sensitive entrypoints. Packed counters verify **every** callback, so one successful
callback cannot be hidden by a later blocked callback. A low-gas exception counts as an atomic revert
only when its mined receipt has status 0; transport or unrelated errors fail the test. Forced ETH is
also tested separately from payer deposits. Test-only Solidity is never deployed by the application
or event factory.

## Gas and the reproduced operating limit

All transactions below use an explicit 16,777,216 gas ceiling on Ganache. The simulated EVM is
Shanghai; this tests execution within that allowance rather than certifying a newer mainnet fork.

| Operation                                                         | Measured gas |
| ----------------------------------------------------------------- | -----------: |
| Cancel 150 hostile recipients after 512 readmission cycles        |   12,624,024 |
| Release with 149 matched cases still open                         |    4,580,592 |
| Worst individual settlement among 149 cases                       |    9,826,902 |
| Largest valid factory constructor payload                         |    8,057,990 |
| Individual expired unmatched resolution, maximum                  |      200,104 |
| Release 150 recipients after 149 individual unmatched resolutions |   10,911,405 |

**Known limit:** directly releasing payouts while 149 expired unmatched challenges also need refunds
uses more than the transaction cap with gas-consuming recipients. The transaction reverts atomically;
it does not partially pay or remove reserves. Any caller can resolve each expired challenge separately,
then call `releasePayouts`. The campaign executed all 149 permissionless resolutions, followed by the
successful 10,911,405-gas payout. Large releases, cancellations, held-share settlements and factory
payloads retain a tested 30% allowance within the cap after this documented preprocessing.

The lifetime list stayed at 150 through 512 readmissions. In the 149-case workload, 147 winners plus
absent/refusal rulings settled with exact held/owed/pending/dust accounting. Pending creditors remained
able to recover their funds. Synthetic recipient-code replacement and forced-balance injection are
explicit fixtures; they do not claim production smart-wallet or Court compatibility.

## Companion checks and remaining assurance

Fresh `npm run build`, `npm run typecheck` and `npm run test:contracts:v8` passed; the latter ran
**23/23** contract/factory/arbitration regressions in 28.59 seconds. The full root and browser suites
were not rerun in this test-only round; their earlier results remain recorded in [TEST_REPORT](TEST_REPORT.md).

The final combined run includes the stronger callback, receipt and artifact-provenance checks added
after independent review of the test harness. Earlier exploratory runs are not added to the final
counts. No contract source fix was necessary from this campaign.

There was no current mainnet fork, real juror exercise, production deployment, live-state inspection,
formal equivalence proof or independent professional audit. The organizer still controls initial
attendance decisions, and event creators choose their policy and arbitration dependencies. These
tests cannot establish that those external inputs or human decisions are honest. Review final
deployment inputs and obtain independent audit before real-fund use.
