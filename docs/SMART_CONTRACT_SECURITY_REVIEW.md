# Smart contract security review — 28 October 2026

The existing contract is accessible: [TruthPaysKickback v7](../references/kickback/contracts/TruthPaysKickback.sol).
This review found a reproducible settlement gas-limit failure outside the tested event capacity,
an unregistered-depositor recovery gap, and important organizer trust and evidence-rotation limits.
No critical outsider theft or reentrancy exploit was confirmed within the reviewed paths. That is
a bounded review result, not a security guarantee or an independent professional audit.

## Scope and compatibility

Reviewed workspace HEAD `79e3e7241ae07206c49417cf1778400698b54c9e`, branch `codex/core-application`.
Reviewed the Solidity, pinned artifact, historical compiler input, admission/attendance policy,
case template, compiler script and existing contract tests. Independent parallel reviews checked
pool accounting and arbitration/access paths. All execution used synthetic local Ganache accounts;
Court and resolver behavior was supplied by the existing mocks.

The historical Solidity, policy, template, ABI and deployment inputs were preserved. The v7 contract
was not replaced. A separate v8 implementation was subsequently authorized, as described below;
no external deployment, live transaction, public IPFS upload or upstream push was made. The recorded
mainnet address was not queried; this review does not establish its current balance or state.
v7 is a direct immutable deployment, so a future financial change needs a new explicit version and
separate deployment/policy review. Held-share payouts and ruling-0 economics remain intact.

Compatibility checks independently established:

- Source SHA-256: `7d9a7854c43826453f7a3ac610d2350b48626cf6e18ee2c44530081af8f80a51`.
- Source equals the saved deployment standard-input source.
- Compiler: `0.8.28+commit.7893614a.Emscripten.clang`; optimizer 200, EVM Paris, legacy pipeline.
- Compiled ABI/creation bytecode equal pinned v7; compiling the historical standard input also
  yields the pinned creation bytecode. This does not independently compare live deployed code.

Machine-readable evidence: [contract-security-compatibility.json](../artifacts/contract-security-compatibility.json).

## Findings and design limits

### SC-01 — Medium: admitted events can exceed the atomic settlement gas limit

`registerStakers` (lines 508–523) and `addAttendees` (601–616) impose no on-chain event-size cap.
`releasePayouts` (712–747), `cancel` (751–765), and losing held-share settlement (840–871) iterate
over growing arrays. Cancellation also scans historical registrations, including readmissions;
limiting only the active staker count would not bound that history.

**Reproduced:** fund 240 synthetic gas-consuming recipient contracts, admit them in batches,
post them as attendees, wait out the challenge window, and call `releasePayouts` with 16,777,216 gas.
The transaction reverts atomically, leaving phase `Listed`, the full 2.4 ETH reserved, and no `owed`
claim created. The same operation with a larger local allowance consumes **20,123,447 gas**.
Ganache Shanghai permits that larger measurement transaction; it is not evidence that Ethereum
would accept it. [EIP-7825](https://eips.ethereum.org/EIPS/eip-7825) caps a transaction at 16,777,216 gas.

There is no individual attendee exit in `Listed`: `emergencyWithdraw` requires `Open`, and `claim`
only pays existing `owed`. Retrying this state with the maximum allowance does not complete it.
An independent 250-recipient local probe likewise required 20,958,157 gas.

**Precondition:** the organizer admits more expensive recipients than the documented 150-person
envelope. This is an operator/configuration liveness failure, not an arbitrary outsider admission
attack. Existing 150-recipient tests pass; they do not enforce a contract-level limit.

**Future-version remedy:** enforce measured bounds on all settlement work, including lifetime
history, or implement bounded settlement/withdrawals with explicit accounting for held shares and
late redistribution. Validate the worst combination of recipients, open cases and readmissions.
For preserved v7, stay within the existing tested envelope and simulate every payout/cancel/split;
do not treat it as an unlimited-capacity contract. This review did not reproduce an in-envelope
settlement failure after the documented unmatched-challenge preprocessing.

### SC-02 — Medium: unregistered payers have no autonomous recovery, even after the deadline

`_deposit` (819–822) checks only `Open` and nonzero value. It accepts ETH after `claimDeadline` if
the organizer has never posted or cancelled. Deposits emit an event without storing a payer credit.
`emergencyWithdraw` (781–787) requires `Status.Staker`; `claim` (770–776) requires `owed`.

**Reproduced:** a registered staker exits after the deadline; a different wallet then successfully
deposits into the still-Open contract. Its `emergencyWithdraw` reverts `NotAStaker`, its `claim`
reverts `NothingToClaim`, and its deposit is classified as spare. With an inactive/lost organizer
key, no contract function lets that payer recover the money. A payer awaiting approval before
the deadline has the same dependency on organizer cooperation.

The root verifier rejects out-of-window deposits for registration, but this does not prevent direct
contract transfers or provide their recovery. The owner's `refund` remains the recovery path when
the key is available. This is a consequence of v7's documented off-chain admission model.

**Future-version remedy:** maintain and reserve per-payer pending credits, stop deposits at an
explicit immutable cutoff, and define permissionless recovery for credits never admitted. Test
partial/excess/repeated deposits, refunds, approval, cancellation and organizer-key loss together.
Exact admission/refund semantics require an explicit versioned design, not an incidental v7 patch.

### SC-03 — High-impact trust assumption: organizer controls deposit attribution and inclusions

`reserved` (400–410) excludes unregistered deposits. `refund` (552–555) can send that spare ETH to
any valid recipient chosen by the owner. `registerStakers` checks aggregate collateral, not proof
that each registered wallet paid. Only registered omitted wallets can call `challenge` (623–628);
there is no challenge to a falsely included attendee.

**Reproduced:** an outsider cannot call `refund`, but the owner can redirect a pending payer's
entire deposit. In a separate fixture, one wallet pays, the owner registers a nonpaying wallet
against that balance and lists it as attended, and that wallet receives the pool. The real payer
cannot challenge because it was never registered.

These powers are intentional and disclosed in v7 source, not a newly discovered access-control
bypass. A compromised or dishonest owner is therefore inside the custody/attendance trust boundary.
Kleros does not authenticate initial admission or make the whole workflow trustless.

**Future-version decision:** explicitly retain and disclose curated custody, or require payer-bound
collateral and define reviewable attendance authority. Protect the organizer key and require verified
admission inputs. Changing inclusion disputes, ownership governance or deposit economics requires
product/policy approval and a new contract version.

### SC-04 — Low / operational: administrative ownership rotation leaves evidence identity fixed

The deployment template embeds the original organizer address and aliases (`scripts/lib.mjs`
lines 223–230). `transferOwnership`/`acceptOwnership` (802–813) update administrative authority
only. The historical template explicitly treats the deployment-time wallet as the organizer's
evidence identity.

**Reproduced:** after two-step transfer, `owner` changes, while the case description and CID remain
byte-identical, still naming the old wallet and omitting the new owner. Transferring administrative
ownership therefore does not rotate authoritative organizer statements. If the old key was compromised,
transferring ownership alone does not remove its stated evidence authority.

**Future-version remedy:** distinguish administrative and evidence roles in the immutable policy,
and define how an evidence identity is authenticated and rotated. For v7, disclose the original
evidence role when handing off ownership; no policy/CID edits were made here.

### SC-05 — Unresolved compiler assurance item

The pinned compiler remains necessary to reproduce historical v7. The Solidity team's
[22 October 2026 optimizer advisory](https://www.soliditylang.org/blog/2026/10/22/yul-optimizer-knowledge-base-stale-bookkeeping-bug/)
includes 0.8.28 when the Yul optimizer is enabled; it is fixed in 0.8.38. The legacy pipeline narrows
the potentially affected code to certain inline assembly and generated helpers. No miscompilation
of this contract was demonstrated. Source inspection and passing tests do not exclude it.

The [current known-bug list](https://docs.soliditylang.org/en/latest/bugs.html) also includes several
IR-only issues (IR is disabled here), a memory-bytes `delete` issue (that operation is absent), and
a storage-boundary issue (no intentional wraparound layout here). This is applicability screening,
not a compiler correctness proof. No patched-compiler equivalence comparison was performed.

Before new deployments, use a reviewed compiler release containing relevant fixes and rerun contract
and integration checks under the new explicit version. For historical v7 assurance, follow the
advisory's compiler comparison procedure without replacing the pinned artifact.

## Protections that were reviewed

- Balance-sensitive ETH paths use the reentrancy guard, update accounting before payments, and
  preserve `pool/heldBack + owedTotal + challengeEscrow` reserves from owner spare withdrawals.
- Failed batch payments use bounded gas without copying returndata; failed amounts become
  wallet-owned `owed`, claimable to an alternate destination.
- Open matched cases hold an individual share while ordinary attendees receive payouts; later
  losses grow remaining held shares and top up attendees. Rounding remains the existing dust rule.
- Challenges use resolver-local IDs for evidence/appeals and arbitrator IDs for Court cases.
  Settlement reads the resolver's final `isRuled/ruling`, including the one-sided appeal override.
- Rulings 0/1/2, permissionless settlement, deadline separation for no-list recovery, cancellation,
  reserve protection and two-step ownership have existing local regression coverage.

Conditional portability edge: `addAttendees` refuses `Disputed` but not a resolved absent/refusal
case. A resolver able to finalize inside the one-day challenge window would let the organizer add
that wallet afterward. Documented General Court timing exceeds that window; this review did not
identify a reachable attack under the recorded configuration. Reassess before using a faster court.

## Subsequent approved factory and hardening

The user then confirmed a factory deploying a new hardened version. The separate
[v8 implementation](EVENT_FACTORY_V8.md) addresses payer collateral/recovery, tested lifetime capacity,
metadata complexity, fast-ruling correction finality and organizer snapshots. It uses a separate
0.8.38 compiler and preserves v7. Curated attendance and creator-selected arbitration/policy remain
explicit trust boundaries. The characterization tests below still execute v7 and remain intentionally
positive reproductions of v7's limitations; they do not describe v8's fixed behavior.

## Reproduction and test interpretation

Run from the repository root:

```sh
npm run build
npm run typecheck
node --test test/contract-security.test.mjs
npm run test:contracts
npm test
npm run test:browser
```

The five new [security characterization tests](../test/contract-security.test.mjs) all pass while
asserting the limitations above. **Passing means the risky behavior was reproduced; it does not
mean those findings were fixed.** The fixtures never load live configs or RPC URLs; Ganache runs
in-process. Existing contract/integration/browser tests bind localhost only.

Executed results and logs are recorded in [TEST_REPORT](TEST_REPORT.md). There was no fuzzing,
symbolic/formal proof, current mainnet fork, live bytecode/state review, juror exercise, full web-app
security audit or new independent professional audit. Historical source verification is preserved
but does not confer production readiness. Address the explicit trust/version decisions and findings,
then independently audit the final new deployment candidate before entrusting it with real deposits.
