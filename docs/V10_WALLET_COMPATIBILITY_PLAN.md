# V10 application compatibility plan

Prepared locally after the human chose a new immediate-upgrade factory with new gas costs and
existing events kept separate (contract-chat user01a1885d-cdfd-7363-a6f8-bc385d1ecf88).
This is an implementation/review plan, not a deployment, account-support approval or financial send.
Contract lane owns the isolated V10 controller/contracts/ABI/build. Core owns application dispatch,
wallet and receipt compatibility, integration and publication. Do not implement competing governance.

## Preserve the current application

Production source09ac3a9 remains V9 with its original controller/policy/manifest and ordinary EOA
financial rule. Its original wrapped transaction and saved review remain preserved under the same
hash. A new factory cannot register or prove that old event, and no V9 record should be rewritten
as V10. The read-only inspector is not financial wallet support. Existing V7/V8 dispatch remains.

## Required account and transaction decision

The human's current Ethereum wallet has EIP7702 delegation code. Changing the factory does not remove
the account code or MetaMask's transaction wrapping. Before preparing any new deployment transaction,
review a V10-only account policy and prove it against an EIP7702-capable local chain. Existing
Ganache/synthetic transport evidence alone does not prove this wallet-extension/protocol behavior.

Proposed narrow support target is the reviewed MetaMask implementation/manager pair with source-bound
runtime pins, scoped ECDSA wallet authentication and exactly one supported execution. General contract
wallets/ERC1271/arbitrary delegate code remain outside this proposal. Unknown account code, manager,
delegation/permission context, batch, mode, target, value behavior or execution path stops signing.
Do not advise disabling wallet protection or overriding a security alert to fit a direct-only sender.

## Implementation boundaries

1. Add explicit version10 profile, ABI, artifact source and registry validation. Do not replace V9
   files or let generic upgradeable-version branches accept V10 implicitly. Update contract/policy
   disclosure for immediate upgrades and irreversible controller finalization only from the actual
   reviewed V10 interfaces. Keep the current V9 policy CID untouched.
2. Separate account ownership authentication from financial eligibility. A supported delegated
   wallet must prove its key with an origin/purpose/chain/nonce-bound signature, while each new
   financial review freshly verifies its exact delegate and implementation runtime at canonical
   anchors. Unsupported accounts get factual recovery access only, enforced by the server.
3. Define one canonical intent proof shared by V10 deployment/creation, deposit, admission,
   attendance, challenge/match, payout/settlement, withdrawal and governance receipts. Preserve the
   actual outer transaction. Direct transactions retain exact from/to/value/data/chain checks.
   A wrapped path must prove the exact reviewed sender and single intended execution against the
   approved framework and permission rules, plus canonical receipt/event/state facts. Do not pass
   a fabricated direct transaction to the verifier or count an EventCreated log alone as approval.
4. Resolve native-value behavior from actual local protocol/wallet evidence before enabling deposits
   or challenge collateral. The existing zero-value creation is insufficient evidence for value
   transfer semantics. Unknown or extra executions/outflows fail closed; do not accept broad wrappers
   just because their last event resembles the expected action.
5. Keep the original outer hash in durable once-only journals, with a distinct reviewed intent hash
   and explicit version/chain/factory/event/wallet/instance scope. Prepared/submitted/uncertain
   records permit receipt checking only, never automatic re-sign/rebroadcast/replacement/reset.
   Authentication, loading progress and inventory refresh cannot clear a financial record.
6. Prove creation/deployment birth before adoption using compiled creation/runtime, constructor/
   initializer, immutable terms/policy/template, canonical factory membership and current owner/
   controller/history. Check controller finalization from actual chain facts; a clicked button or
   zero owner field alone cannot establish that every upgrade/default-selection power is disabled.

## Focused acceptance before a wallet request

| Area | Required evidence |
| --- | --- |
| Version isolation | V9 inputs and URLs still select V9; V10 uses separate artifacts/policy/registry; legacy pending hashes cannot enter V10. |
| Accounts | Ordinary EOA and reviewed delegated account pass their own fresh checks; arbitrary delegation/ERC1271/wrong signer/replayed nonce/code change fail. |
| Execution | Actual direct and approved wrapped paths on a capable local chain preserve exact intent; extra calls/values/targets/contexts/modes and mismatched or reorged receipts fail. |
| Custody | Actual local deposit→admission→attendance→dispute→ordinary held-share payout→ruling→settlement flow preserves all financial economics and separate collateral/owed/pending credit. |
| Governance | Immediate upgrade/transfer and irreversible finalization follow the reviewed V10 contract; finalized controls cannot be re-enabled. |
| UX and records | One send per review, automatic bounded receipt updates, lost-ack GET-only recovery, actor-bound owned events and no private catalog leakage. |
| Deployment | Exact new bytecode/constructor/controller/owner/gas cap and account-compatible transaction bundle are reviewed before the human signs. Actual hashes/receipts are reconciled once. |

Wait for the contract lane's exact V10 handoff, then implement/test these boundaries locally. Prepare
an exact combined source and transaction plan before any new live financial send, policy publication
or hosting cutover. The human's fresh-factory choice is not authorization to replay old V9 creation,
skip wallet/security review, spend an unspecified gas amount or silently activate new mainnet code.
