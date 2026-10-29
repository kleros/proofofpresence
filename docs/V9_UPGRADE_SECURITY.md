# V9 upgrade security

**Status: local implementation under verification; not deployed.** The human selected a project
multisig with a minimum 48-hour timelock. Multisig members, threshold and production addresses still
require concrete review. This document does not authorize deployment. Existing v7, immutable v8 and
Chiado 80015 contracts, funds, proofs and scheduled operators remain unchanged.

## Selected authority

Event operations and upgrade authority are separate roles. The project multisig proposes and cancels
timelock operations; execution is open once a scheduled operation becomes ready. No organizer EOA
receives direct upgrade permission. The timelock administers itself, without a deployer administrator.

## Architecture and trust

- Each event has its own ERC1967 proxy and native-ETH custody. The factory has a separate proxy;
  there is no shared upgradeable beacon. Changing the factory's default event implementation affects
  future children. Existing children require explicit, individually targeted upgrade operations.
- UUPS `_authorizeUpgrade` permits only the selected timelock. Distinct event/factory family IDs
  reject accidental cross-upgrades, alongside the standard UUPS UUID checks. Family IDs, version
  getters and storage validation cannot establish that authorized replacement code is benevolent.
- **Authorized governance can change custody logic.** 48 hours is a review delay, not a guaranteed
  withdrawal window: admitted principal and disputed shares can remain committed during that time.
- Application provenance must bind chain, event, proxy, factory, implementation slot, implementation
  code hash and approved version. An unchanged proxy runtime hash does not identify its current logic.

OpenZeppelin 5.7 implements UUPS authorization through `_authorizeUpgrade`, protects upgrades with
`onlyProxy`, and makes `proxiableUUID` unavailable through delegation. These checks do not enforce
application-specific financial rules. See the exact [UUPS source](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/proxy/utils/UUPSUpgradeable.sol).

## Required controls

1. Pin the reviewed OpenZeppelin 5.7.0 sources and dependency integrity. Preserve compiler inputs,
   storage layouts and implementation hashes for every version. Require a previous-version reference
   in upgrade validation; do not bypass storage checks. [Validation API](https://docs.openzeppelin.com/upgrades-plugins/api-core)
2. Lock implementation contracts with `_disableInitializers()`. Initialize each proxy atomically
   through constructor calldata, passing its organizer and upgrade authority explicitly. Port
   per-event immutable values into protected proxy storage and initialize `_locked = 1` there.
   Declaration initializers do not initialize proxy storage. Guard migrations against unauthorized
   calls and replay; execute them atomically with `upgradeToAndCall`.
   [Initializable](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/proxy/utils/Initializable.sol),
   [ERC1967Proxy](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/proxy/ERC1967/ERC1967Proxy.sol),
   [initializer guidance](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable)
3. Use a reviewed, non-upgradeable timelock with a 48-hour floor enforced at construction and in
   `updateDelay`. Stock `TimelockController` permits a scheduled reduction. Use self-administration
   without a residual deployer/EOA admin or alternate upgrade route. Verify proposer, canceller and
   executor roles. V9 initialization requires the exact reviewed timelock runtime code hash, as well
   as the delay getters. A contract merely reporting `getMinDelay() >= 48 hours` is rejected.
   [TimelockController 5.7.0](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/governance/TimelockController.sol)
4. Preserve pending-credit ownership, held-share payouts, ruling 0 economics, 150 lifetime admissions,
   ordinary one-day challenge/match periods and the existing settlement terms. Namespace storage
   consistently and validate changes inside each namespace. Reinitializers require explicit review;
   plugin initializer checks do not validate them automatically.
   [Storage and reinitializer guidance](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable)

## Acceptance checklist

- [x] Implementation initialization, repeated proxy initialization and unauthorized migrations fail;
  failed initialization leaves no usable child or registry entry.
- [x] Direct implementation upgrades, delegated `proxiableUUID`, EOAs, non-UUPS implementations,
  wrong UUIDs and event/factory cross-upgrades fail. Organizer ownership transfer cannot grant upgrades.
- [x] Unscheduled or early execution fails; execution at the scheduled ETA succeeds. Delays below 48 hours,
  unauthorized role changes and alternate upgrade/admin routes fail.
- [x] The ordinary compiler-storage gate rejects deleted, reordered or incompatible fields,
  mappings and structs; valid append-only layouts pass against their recorded references.
- [ ] Before each upgrade, separately review namespace IDs, root derivation/collisions and namespace
  struct layouts, including ERC7201, ERC1967 and hidden assembly slots. The generic gate does not
  discover or validate these roots; `namespaceValidation` explicitly remains `not-performed`.
- [x] Upgrades preserve exact native balances, reserves, pending credits, admitted histories, owed
  credit, challenge escrow, held shares, case organizer and resolver/arbitrator IDs across funded,
  waiting, disputed and delivered-but-unsettled states. Continue through rulings 0/1/2, ordinary payout,
  held-share redistribution and failed-recipient recovery.
- [x] A reverting migration restores the implementation slot, state and balances atomically; a
  successful migration cannot replay.
- [x] A recipient callback cannot execute a ready, authorized upgrade while a financial payment is
  running; the same scheduled operation remains executable after the payment finishes.
- [x] Upgrading event A leaves event B unchanged. Factory upgrades preserve registry membership and
  existing child implementations; new children use the reviewed default with the correct authorities.
- [x] Capacity/gas and adversarial-recipient checks pass through proxies with 150 admitted wallets,
  atomic over-capacity rejection, reserved owed/pending credit and alternate-recipient recovery.

## Independent local evidence

`node --test --test-concurrency=1 test/event-v9-upgrade-security.test.mjs` passed 9/9
tests using synthetic accounts and an in-process Ganache chain; Court adjudication alone is mocked.
Its fixtures compile against the exact V9 compiler input and verify the authority runtime matches.
Production v8 source SHA-256 pins pass, and its complete financial-method tail is byte-identical to
V9 (33,465 bytes). The callback test forwards caller-supplied gas, verifies `UpgradeWhileBusy` rather
than an out-of-gas failure, and then executes the same operation successfully.

Separate completed checks:

- `test/event-v9.test.mjs`: 2/2 passed for the mechanical financial port and basic funded upgrade.
- `test/event-v9-capacity.test.mjs`: 1/1 passed. Cancellation with 150 hostile recipients used
  12,609,857 gas; payout used 12,591,247. Each measured cost multiplied by 1.30 remains below the
  16,777,216 transaction cap. This is a 30% allowance on measured cost, not 30% unused cap.
- `test/mainnet-storage-layout.test.mjs`: 13/13 passed using real compiler layout fixtures. The
  [gate](../scripts/mainnet/storage-layout.mjs) covers declared persistent storage and reports its
  namespace/manual-review limitations explicitly.
- `test/mainnet-kleros-v9-fork.test.mjs`: 1/1 passed on a **local** mainnet fork, including a held
  disputed case upgraded through the 48-hour timelock, real Court appeal/refund/reward code and
  settlement. [Retained proof](../artifacts/mainnet-kleros/v9-fork-ethereum-final.json) binds the
  reviewed compiler/source inputs and canonical source block. Jury state and final Court callbacks
  were simulated locally; this was not a public dispute or jury vote. Upstream signatures and
  broadcasts were both zero.
- `test/mainnet-release-rehearsal.test.mjs`: 1/1 passed for all four unsigned CREATE requests on an
  in-process chain, checking predicted addresses, exact deployed runtime hashes and governance roles.
  Concrete production multisig/funding/fee inputs still require their own review and fresh preflight.

These local tests are not an independent audit or proof that authorized replacement code is safe.
