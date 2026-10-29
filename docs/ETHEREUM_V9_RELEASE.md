# Ethereum V9 single-wallet release preparation

Updated29October2026. This supersedes the multisig instructions at417b2c0. The human selected one
wallet to deploy and initially control upgrades, with transferable ownership and the permanent48-hour
minimum. Historical source/build inputs and proofs remain preserved under
`verification/v9-multisig-417b2c0/` and Git417b2c0; they do not verify the changed controller.

## One wallet, four setup transactions

The same EOA submits four consecutive CREATE requests: `KlerosUpgradeTimelockV9(initialOwner)`,
`KlerosEventV9`, `KlerosEventFactoryV9`, then the atomically initialized `ERC1967Proxy` factory.
The initialOwner must equal that deployer. No multisig setup or private-key export is required.
The factory and each event remain independently upgradeable through the timelock; selecting a new
factory default affects future events. Actual implementation upgrades still require172800seconds.

`node scripts/mainnet/prepare-release.mjs` is review-only by default. It has no signer, broadcast or
deployment option. Its public input is an explicit `registry/ethereum-v9-*.json` file:

```json
{
  "schemaVersion": 1,
  "chainId": 1,
  "contractVersion": "kleros-event-v9-uups",
  "deployer": "REVIEWED_PUBLIC_WALLET",
  "deployerNonce": 0,
  "governance": {
    "kind": "single-owner-timelock",
    "initialOwner": "SAME_PUBLIC_WALLET",
    "minimumDelaySeconds": 172800
  },
  "fees": {
    "maxFeePerGasWei": "REVIEWED_CURRENT_CEILING",
    "maxPriorityFeePerGasWei": "REVIEWED_CURRENT_PRIORITY_FEE"
  },
  "gasLimits": {
    "KlerosUpgradeTimelockV9": "REHEARSED_LIMIT",
    "KlerosEventV9": "REHEARSED_LIMIT",
    "KlerosEventFactoryV9": "REHEARSED_LIMIT",
    "ERC1967Proxy": "REHEARSED_LIMIT"
  },
  "maxTotalGasCostWei": "EXPLICIT_TOTAL_WEI_BUDGET"
}
```

Placeholders fail validation. `--plan registry/ethereum-v9-public-plan.json` independently recompiles
current inline sources and verifies ABI, bytecode, layouts, immutable maps and manifest hashes before
encoding all four requests. Gas limits cannot exceed16777216, the
[EIP-7825 cap](https://eips.ethereum.org/EIPS/eip-7825). Optional `--preflight` performs bounded,
allowlisted read-only checks of chain, Court code/fees, canonical headers, EOA code, latest/pending
nonce, balance, fee coverage and unoccupied predicted addresses. It copies the plan before awaits.
A nonce change requires a complete new plan. No signing or replacement transaction can occur here.

The proposed user-specific config and exact unsigned bundle are
`registry/ethereum-v9-user-2bb03593-proposed.json` and
`artifacts/mainnet-release/user-2bb03593-four-create-proposed.json`.
The separate budget record is `artifacts/mainnet-release/user-2bb03593-budget-proposed.json`.
Its fee quote was read at29October14:47Bangkok; it is a proposal, not spending approval or a perpetual
fee guarantee. All four native values are0. First-event creation and policy publication are separate.
Core owns fresh checks, the exact user review and user-wallet execution. Never substitute a historical
Chiado wallet or request a private key.

## Transfer upgrade ownership later

Call `transferOwnership(newOwner)` on the timelock, then have that recipient call `acceptOwnership()`.
Only the current owner can nominate or cancel; only the nominated recipient can accept. The proposed
owner can cancel queued operations but cannot propose them. Acceptance requires both pending and
executing operation counts to be0, then atomically removes the old owner's roles. Empty batches,
zero/self/current-owner targets, renunciation and external role changes reject. No old queued upgrade
can survive an accepted handover. The48-hour floor remains afterward.

The timelock address remains each proxy's upgrade authority. This transfer affects shared project
upgrade control; it does not transfer financial ownership of individual events or alter case-organizer
snapshots. Each event retains its separate existing two-step organizer ownership transfer.
Authorized upgrade ownership can change custody logic. The delay is review notice, not a guaranteed
withdrawal window for admitted principal or disputed shares.

## Current verification

Current artifacts use28inline sources with exact OpenZeppelin5.7.0, solc0.8.38, viaIR/optimizer200 and
Paris. Pins and sizes are in `artifacts/mainnet-kleros/current-owner-pins.json`. The plan's
`provenance.v9BuildManifestSha256` and `v9StandardInputSha256` use canonical JSON hashes; a separate
`standardInputFileSha256` records formatting-sensitive raw input bytes. Every manifest contract entry
also pins `abiSha256`. Immutable IDs/offsets are compiler-produced, never hardcoded.

Fresh checks: ownership5/5; base/capacity3/3; independent handover7/7 and security9/9; real-Kleros
owner fork1/1; release-planner guards, exact four-CREATE/two-step-handover rehearsal and ordinary
storage gate22/22. The fork retains actual deployed Court/resolver code, with jury adjudication
simulated locally, and makes no upstream write. See [contract evidence](V9_CONTRACT_RELEASE.md),
[upgrade security](V9_UPGRADE_SECURITY.md) and [launch handoff](LM_CONTRACT_HANDOFF.md).

Future upgrades must preserve old compiler inputs, ABI, storage layouts, immutable maps and historical
creation anchors, then validate ordinary and explicit namespace layouts, funded-state migration and
rollback. New approved implementation evidence must be reviewed before updating app trust. Unknown
code blocks new financial actions while known submitted receipts remain recoverable. No unchanged
historical broad-test count is claimed as current-owner verification.
