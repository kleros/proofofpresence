# V10 immediate upgrades: isolated fresh deployment

The human selected a **new immediate-upgrade factory**, with new deployment gas costs and existing
V9 events kept separate. This is a fresh VERSION10 family, not a V9 migration. No mainnet transaction,
policy publication, hosting change or existing event/journal mutation is part of this source handoff.

## Contract behavior

- Profile: `kleros-event-v10-uups`; compiler Solidity0.8.38, OpenZeppelin5.7.0, Paris EVM, viaIR,
  optimizer200. Artifacts live only in `build/contracts-v10/`.
- Deploy in order: `KlerosUpgradeControllerV10(initialOwner)`, `KlerosEventV10`,
  `KlerosEventFactoryV10`, then `ERC1967Proxy(factoryImplementation, initialize(eventImplementation, controller))`.
  All four CREATE calls carry zero ETH. Factory initialization is atomic with proxy creation.
- The controller is non-upgradeable. Its owner can call `upgrade(proxy, implementation, data)` or
  `setEventImplementation(factory, implementation)` immediately. No queue or delay applies.
- The controller supports `transferOwnership`, `acceptOwnership`, `cancelOwnershipTransfer`,
  `renounceOwnership`, `owner`, `pendingOwner`, `upgradesDisabled` and `UPGRADE_DELAY_SECONDS() == 0`.
  Zero/self/current-owner nominations fail. A common idle guard protects forwarding and every
  ownership mutation against nested callbacks.
- Proxy authorization requires the exact controller runtime, VERSION10, correct UUPS UUID,
  event/factory family, unchanged storage schema and increasing implementation revision. Those
  metadata checks are compatibility guards, not proof that replacement logic is safe.
- Changing the factory default affects future children only. Each existing child's ERC1967
  implementation slot must be upgraded separately. The factory holds no participant deposits.
- Financial organizer ownership is separate. The V9 event financial body, reserves, pending credit,
  held shares, admission capacity150, challenge/match windows86400seconds each and ruling0 economics
  are preserved. Historical V9 and earlier sources remain unchanged.

## Permanent finalization

Renounce the **upgrade controller**, not the event financial organizer. In the reviewed controller,
renunciation clears both owner and pending owner and leaves no role, queue, recovery administrator
or method to restore authority. The reviewed proxy gates also reject disabled authority explicitly.

Before renunciation, review the factory's actual implementation/default and all children from its
canonical `EventCreated` history, checking the inventory against `eventCount` and registry mappings.
For every child verify current implementation/runtime, shared authority, schema and expected storage.
Check that the deployed controller runtime is exact, and that no previously authorized implementation
installed alternate upgrade or custody powers. A version number or schema string cannot establish that.

After the separately authorized renunciation transaction is canonical, verify controller owner=0,
pendingOwner=0 and upgradesDisabled=true, with all reviewed implementation/default/authority values
unchanged. With those reviewed implementations this freezes factory/default/existing events. New
children can still be created afterward and inherit the disabled authority. Financial lifecycle,
refunds, pending recovery and dispute settlement continue. Finalization itself settles no funds or cases.

An earlier malicious authorized implementation could install a backdoor. Renouncing a shared
controller cannot prove arbitrary prior code safe or freeze powers outside it. The owner has full
immediate upgrade trust until this reviewed finalization; users must see that disclosure before paying.

## Integration boundary

Core owns application integration and live operations; UI owns presentation. Dispatch VERSION10 and
its profile explicitly. Do not relax the live V9 delay/queue/verifier rules to accommodate V10. Preserve
old manifests, policies, deployments, event namespaces and journals. A fresh factory does not resolve
existing delegated-wallet authentication or transaction-envelope compatibility on its own.

V10 needs a new policy with its own digest and URI. `v10-luma-generic-policy.md` is an **unpublished
draft**; its digest/status are in `artifacts/v10-release/v10-luma-policy-draft.json`. The published V9
policy describes48hours and must never be reused or edited to imply immediate governance.

Required V10 integration checks include fresh deployment provenance, explicit controller owner/frozen
status, no pending-operation fiction, correct account/chain/envelope checks and the existing financial
review/receipt boundaries. A local contract test does not prove the production app or a public Court
cycle. Keep V10 finance disabled until its own source-bound deployment and integration are verified.

## Local release review

Use `npm run compile:v10` and `npm run test:contracts:v10`. The unsigned planner
`scripts/mainnet/prepare-v10-release.mjs` has no RPC, signer or deployment mode; run it with no arguments
for its exact input schema. Its in-process chain1 rehearsal creates the exact four-contract bundle,
checks runtime/authority/default/ownership and records gas. Synthetic nonce/address and measured gas
are rehearsal evidence, not a mainnet quote or permission to send.

Core must prepare a fresh account/nonce/chain/fee/balance preflight and an exact reviewed transaction
bundle within a newly approved total gas cap. Do not reuse the old V9 deployment approval or gas cap.
The human approves/signs any mainnet sends. No automatic renunciation is included in deployment.
