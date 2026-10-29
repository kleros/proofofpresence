# V9 contract release inputs

The human selected a project multisig and a minimum48-hour timelock. This implementation is a new
`kleros-event-v9-uups` family, VERSION9. Existing immutable v8 and test15m deployments are unchanged.
No production broadcast is implemented by the contract compiler or tests.

## Contracts and ABI

- `KlerosUpgradeTimelockV9(address projectMultisig)`: non-upgradeable; fixed initial172800-second
  delay; self administrator; supplied contract proposes/cancels; execution is permissionless after
  readiness. Both construction and `updateDelay` enforce the48-hour floor. There is no deployer admin.
- `KlerosEventFactoryV9.initialize(address eventImplementation_, address upgradeAuthority_)`:
  passed atomically to `ERC1967Proxy` construction. The authority must have the exact reviewed
  timelock runtime. The factory is independently UUPS upgradeable.
- `KlerosEventV9.initialize(uint256 depositAmount_, string eventName_, address owner_,
  uint256 eventStart_, uint256 claimDeadline_, Arbitration arbitration_, address originatingFactory_)`:
  called atomically by factory proxy creation. The organizer is the authenticated creator; the
  project authority comes from the factory and cannot be selected by that organizer.

The child retains every v8 financial ABI entry and the entire financial-method source body. Six
per-event immutables become proxy storage; initialization sets the financial guard busy before
external calls and ready afterward. Pending credits, held shares, refusal economics, owed claims,
150-wallet lifetime capacity and86400-second challenge/match periods are preserved.

Additional getters: `UPGRADE_FAMILY()`, `storageSchema()`, `implementationRevision()`,
`upgradeAuthority()`; events also expose `originatingFactory()`. Factory creation retains the v8
`EventParameters` tuple and `EventCreated` event with version9. Its `eventImplementation()` default
changes only through the timelock and affects future children. Each existing event has an independent
ERC1967 implementation slot; there is no shared beacon.

Families are `keccak256("kleros.event.v9.uups")` and `keccak256("kleros.factory.v9.uups")`.
Schemas are `keccak256("kleros.event.v9.storage.1")` and the factory equivalent. Replacement code
must be VERSION9, the same family/schema, a higher revision and UUPS compatible. These metadata
checks prevent mistakes; authorized governance can still change custody logic. The48-hour review
period is not a guarantee that admitted or disputed principal can immediately exit. Financial
operations are not frozen during the delay.

## Build and runtime provenance

`node scripts/compile-contracts-v9.mjs` uses exact OpenZeppelin Contracts5.7.0,
solc0.8.38, optimizer200runs, viaIR and Paris. It writes only `build/contracts-v9/`, including the
complete inline compiler input, ABI, bytecode, compiler storage layouts, reference maps and manifest.
V7/v8 output directories are not overwritten.

| Artifact | Creation bytes | Runtime bytes |
| --- | ---: | ---: |
| KlerosEventV9 |26961|21028|
| KlerosEventFactoryV9 |13146|7213|
| KlerosUpgradeTimelockV9 |6834|5609|
| ERC1967Proxy |720|134|

The event has3548bytes remaining below EIP170. Every artifact is below the initcode/runtime limits.
No financial-code extraction was necessary.

Implementation runtimes contain two immutable values. Read their compiler-produced IDs and offsets;
never hardcode the IDs:

- `__self`: the deployed implementation address padded to32bytes.
- `_timelockCodeHash`: the exact32-byte reviewed timelock runtime hash,
  `0x9691b7584dc7b3887f5be389a818b874cc03ce1acf4fe9f8c9ec4d74cf1d5af5`.

Artifacts expose `immutableReferences`, `immutableValues`, `linkReferences` and `storageLayout`.
The raw `deployedBytecode` is unpatched; its hash is not the actual implementation runtime hash.
The timelock and proxy have no immutables. Their runtime hashes can be checked directly. The project
authority is proxy state in the fixed ERC7201 namespace
`0xe52709d5d2584d7781be7bdd5de93156c9489d44a4f5977e28a0120cffd25300`.
Future revisions must separately preserve this namespace and the ordinary compiler storage layout.

## Verification evidence

Basic local tests prove the retained ABI/body, actual timelocked event/factory migrations, exact
liability snapshots, registry preservation and independently upgraded children. The independent
[upgrade-security suite](V9_UPGRADE_SECURITY.md) covers initialization and authority attacks,
family/schema/UUID rejection, exact ETA, rollback/replay, owed/pending/disputed balances and payment
callbacks attempting a ready upgrade.

The maximum-capacity test creates a real proxy with150admissions, then gives all recipients hostile
gas-consuming code on the isolated chain. Cancellation used12,609,857gas and payout12,591,247gas,
both below16,777,216 even after adding30%to measured consumption. This means30%additional gas
allowance, not30%of the transaction cap unused. Failed sends become protected owed balances;
unadmitted credits remain recoverable separately. The test simulates the cap explicitly on Ganache
Shanghai and does not claim that Ganache itself enforces newer mainnet fork rules.

The actual real-Kleros V9 fork passed with five proxy children, exact compiler/artifact equality,
immutable-patched implementation runtime checks, nativeETH custody, evidence, rulings0/1/2 and
positive appeals/refunds/rewards. One held dispute was upgraded through the48-hour timelock before
continuing through the actual resolver/Liquid code. Only jury adjudication is simulated locally;
all external Ethereum RPC requests are read-only. The original publicnode endpoint returned403
before fork execution; the completed run explicitly used `https://eth.drpc.org` after chain1 and
code verification.

Command:

```sh
MAINNET_KLEROS_V9_FORK=1 MAINNET_FORK_RPC=https://eth.drpc.org \
  MAINNET_V9_FORK_REPORT=artifacts/mainnet-kleros/v9-fork-ethereum-final.json \
  node --test --test-concurrency=1 test/mainnet-kleros-v9-fork.test.mjs
```

Result: passed1/1 in100.9seconds;322upstream reads, zero upstream signatures/broadcasts.
[V9 fork proof](../artifacts/mainnet-kleros/v9-fork-ethereum-final.json) SHA256:
`39aa37425abb95b8bda9075e07fb98d968e39347abdcc1df58330363ec9fa8d0`.
The exact selected real-Kleros pair, EOA payment limitation and public verification are documented
in [Ethereum Kleros verification](ETHEREUM_KLEROS_VERIFICATION.md).

Mainnet release preparation must bind the actual multisig, threshold, timelock roles, proxy slots,
implementation runtime hashes, layouts, dependencies, Court pair and current fee budget. The
contract-side tests do not replace that application/release acceptance or authorize deployment.
