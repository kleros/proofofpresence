# Current single-owner V9 upgrade security

The human approved one wallet to deploy and initially control upgrades, with two-step transferable
ownership and a permanent48-hour minimum. The old multisig candidate417b2c0 is historical, preserved
under `verification/v9-multisig-417b2c0/`; its proofs do not verify this ownership delta.

## Authority and custody trust

The non-upgradeable timelock is the only upgrade authority for the factory and independent event
proxies. Its owner proposes/cancels; anyone can execute ready operations. A pending owner only gets
cancellation rights. Handover is proposed by the current owner and accepted by the recipient, with
both pending and executing operation counts0. Acceptance revokes old roles atomically. Renunciation,
external role management, zero/self/current-owner targets and empty batches reject. This prevents
old queued upgrades and execution callbacks from surviving ownership handover. The minimum remains
172800seconds, including after a new owner accepts.

Event financial ownership is separate and retains its existing two-step transfer. Factory default
changes affect future events; existing event implementation slots remain independent. Implementation
initializers are locked and proxies initialize atomically. Family/schema/revision/UUID checks reject
mistakes; compiler/source/layout review is still required.

**Authorized upgrade ownership can change custody logic.** One wallet/key initially controls it.
48hours provides review notice; admitted principal or disputed shares may remain committed. Neither
family IDs nor metadata prove benevolent replacement logic. There is no blanket financial freeze
while a proposal or ownership nomination is pending; only ownership acceptance requires a clear queue.

## Provenance and future transfers

Pin chain, proxy, factory, implementation slot/runtime, ABI, compiler/source input, immutable maps,
initial creation and controller code. Keep `initialUpgradeOwner` as the historical constructor pin;
read/replay current owner, pending owner, queued/executing counts and exact roles from the chain.
An authorized handover must not rewrite historical transaction inputs or reset persisted app state.
Unexpected implementations/history block new financial drafts while known submitted receipt recovery
remains available. The unchanged proxy bytecode alone cannot establish current logic.

Use exact OpenZeppelin5.7.0. [UUPS](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/proxy/utils/UUPSUpgradeable.sol),
[Ownable2Step](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/access/Ownable2Step.sol),
[TimelockController](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/governance/TimelockController.sol).
The controller additionally enforces its delay floor and queue/execution handover checks; stock
ownership alone would not cancel or invalidate old queued operations.

## Fresh completed checks

- Ownership5/5; base/capacity3/3; new independent handover attacks7/7; existing independent attacks9/9.
- Waiting and ready malicious queues both block acceptance. Pending recipients can cancel them.
  Changed/cancelled nominees lose their role; old accepted owners lose proposal/cancellation rights.
- Current/pending-owner callbacks demonstrated pending0/executing1 and exact OwnershipTransferBlocked.
  Nested/same-ID execution and failed batches roll back atomically. Nonempty batches count once;
  empty scheduling/execution rejects with both counters unchanged.
- Unauthorized/direct/family/schema/UUID/revision upgrades, initializer takeover, migration replay,
  failing migration rollback, funded A/B isolation and new-owner48-hour upgrades are covered.
-150hostile recipients retain owed/pending reserve protection and30%additional measured gas allowance.
- Current-source real-Kleros local fork1/1 covers five children, held-case upgrade and actual protocol
  appeal/refund/reward/finality code for rulings0/1/2; jury adjudication is simulated locally.
- Release-planner guards, exact four-CREATE ownership handover rehearsal and ordinary storage gate
  pass22/22combined checks. Current proof/pins are linked from [V9_CONTRACT_RELEASE](V9_CONTRACT_RELEASE.md).

Before every future implementation upgrade, separately review ERC7201 roots, namespace structs,
ERC1967 and hidden assembly slots. The generic storage gate reports `namespaceValidation:not-performed`;
it covers ordinary compiler persistent storage and cannot prove safe logic or invisible enum meaning.
Keep the previous revision's complete artifacts/inputs, rehearse funded migrations and failed rollback,
and require a new reviewed source/runtime pin. These local checks are not an independent audit or a
proof against malicious authorized ownership. No unchanged old broad-test result is passed off as
current-owner verification.
