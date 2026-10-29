# Current single-owner V9 contract release inputs

Updated29October2026. The human changed upgrade control to one transferable wallet, retaining48hours.
This supersedes the multisig release at417b2c0; its source/build snapshot and proofs remain preserved.
Production profile/ABI is `kleros-event-v9-uups`, VERSION9, Ethereum1/native ETH. Mainnet execution
belongs to core's reviewed user-wallet flow; this contract lane has no signer or broadcast capability.

## ABI and ownership

- `KlerosUpgradeTimelockV9(address initialOwner)` is non-upgradeable. It provides `owner`,
  `pendingOwner`, `transferOwnership`, `cancelOwnershipTransfer`, `acceptOwnership`,
  `pendingOperationCount`, `executingOperationCount`, and the standard timelock API.
- The current owner is the only proposer. Owner and pending owner can cancel. Acceptance requires an
  empty, idle queue and removes the old roles atomically. Role changes, ownership/role renunciation,
  invalid recipients and empty batches reject. Executor is open; default admin is the timelock itself.
  Every scheduled action waits at least172800seconds. There is no fast upgrade or deployer-admin bypass.
- Factory `initialize(address eventImplementation_, address upgradeAuthority_)` is atomically passed
  to ERC1967Proxy construction. Event `initialize` retains the six financial constructor arguments
  plus `originatingFactory`; creator becomes financial owner, while upgrade authority comes from the
  factory. Financial event/factory/gate source remains unchanged by this ownership update.

The exact organizer createEvent ABI, receipt, metadata/time bounds and owner semantics are recorded
in [LM_CONTRACT_HANDOFF](LM_CONTRACT_HANDOFF.md). Existing pending-credit, held-share, ruling0,
failed-recipient owed recovery,150-wallet capacity and one-day windows are unchanged. A factory
upgrade/default selection does not automatically upgrade existing child proxies.

## Build and current pins

Exact compiler: solc0.8.38+commit.1835d247, OpenZeppelin Contracts5.7.0, viaIR, optimizer200, Paris.
Ownable and Ownable2Step add two sources:28inline sources total. The event/factory storage layouts
retain their financial structure; compiler type IDs can change when imports change.

| Artifact | Creation bytes | Runtime bytes |
| --- | ---: | ---: |
| KlerosEventV9 |28188|21028|
| KlerosEventFactoryV9 |14373|7213|
| KlerosUpgradeTimelockV9 |8170|6836|
| ERC1967Proxy |720|134|

Current controller source SHA256:
`bd0c37a72bbfb0341530768896035046dab67e01870fadd03e406a618c04926e`.
Controller runtime hash:
`0xdf9ad6220524728c4a87a674e2449a064dd16ac7b8f525fcf22273f84f61d220`.
Canonical build/input and creation/ABI/layout hashes are in
`artifacts/mainnet-kleros/current-owner-pins.json`; do not use old417b2c0 pins.

Implementation runtime immutables remain compiler-declared `__self` (deployed implementation address)
and `_timelockCodeHash` (the exact current controller hash). The unpatched deployedBytecode hash is
not the final runtime hash. Read `immutableReferences`/`immutableValues` by names, not numeric IDs.
The timelock/proxy have no immutables. Fixed authority storage uses the preserved ERC7201 root
`0xe52709d5d2584d7781be7bdd5de93156c9489d44a4f5977e28a0120cffd25300`.

## Fresh executed checks

- `test/event-v9-owner.test.mjs`:5/5passed, including same-EOA setup,48-hour upgrade, handover,
  role/floor protection, cancellation, queue/depth rollback and empty-batch rejection.
- `test/event-v9.test.mjs` + `test/event-v9-capacity.test.mjs`:3/3passed on current artifacts.
  Financial source/ABI pins and funded event/factory isolation remain valid.150hostile recipients used
  12609857gas for cancellation and12591247for payout; each measured value×1.30 remains below16777216.
- `test/event-v9-owner-handover-security.test.mjs`:7/7passed; existing
  `test/event-v9-upgrade-security.test.mjs`:9/9passed against the fresh guarded controller.
- Release planner/rehearsal/storage combined command:22/22passed. The same wallet deployed all four
  exact unsigned requests and completed a two-step ownership transfer locally.
- Explicit current owner real-Kleros fork:1/1passed in58.51seconds, five children, held-case48-hour
  upgrade, actual appeal/passPeriod/executeRuling/refund/reward logic and delivered rulings1/0/2.
  There were264upstream read-only requests, zero upstream signatures/broadcasts/private signing files.
  Jury state/final Court callbacks were simulated locally; no independent jury vote is claimed.

The first owner-fork attempt found a fixture's incorrect nonce0 assumption; it was corrected to the
actual fork account nonce. A later run stopped on HTTP429 before producing a complete proof. They
are not passes. The final run uses the existing bounded verification runtime and serialized reads,
without replaying a public transaction or duplicating retry policy.

Current proof: `artifacts/mainnet-kleros/v9-owner-fork-ethereum-runtime-final.json`, SHA256
`05835760838dd1877dc74ba92d9f3001beebf189397ae27b1dee9415a25f00be`.
Parent independently rehashed seven source pins, canonical compiler input and four creation hashes;
all match the current candidate. App/provenance/organizer workflow and live release checks are core's
separate acceptance, not inferred from these contract tests.
