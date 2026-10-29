# Ethereum V9 release preparation

The production candidate uses `kleros-event-v9-uups`, VERSION9, chain1 and native ETH. The human
selected a **project multisig with a minimum48-hour timelock** on29October2026. Existing v7, v8 and
Chiado80015 deployments remain separate. No mainnet deployment, hosting change or policy publication
is authorized by this document.

Each event has an independent UUPS/ERC1967 proxy. A separate factory proxy creates events; changing
its default implementation affects future events. The project multisig proposes/cancels timelock
operations. Anyone may execute a ready operation after its delay. The timelock is not upgradeable,
has no residual deployer admin and cannot reduce its delay below172800seconds. Authorized upgrades
can change custody logic; the delay does not guarantee participants can withdraw committed deposits.
See [upgrade security](V9_UPGRADE_SECURITY.md) for the acceptance evidence and trust boundary.

## Unsigned deployment preparation

`node scripts/mainnet/prepare-release.mjs` displays instructions with zero network requests,
signatures or broadcasts. There is deliberately no deployment or signing option. Public configuration
must be an explicit `registry/ethereum-v9-*.json` file; private wallet/journal paths are rejected.

The required public configuration is:

```json
{
  "schemaVersion": 1,
  "chainId": 1,
  "contractVersion": "kleros-event-v9-uups",
  "deployer": "REVIEWED_EOA_ADDRESS",
  "deployerNonce": 0,
  "governance": {
    "kind": "project-multisig",
    "multisig": "REVIEWED_PROJECT_MULTISIG_ADDRESS",
    "expectedCodeHash": "REVIEWED_MULTISIG_RUNTIME_HASH",
    "minimumDelaySeconds": 172800
  },
  "fees": {
    "maxFeePerGasWei": "EXPLICIT_CURRENT_FEE_CEILING",
    "maxPriorityFeePerGasWei": "EXPLICIT_CURRENT_PRIORITY_FEE"
  },
  "gasLimits": {
    "KlerosUpgradeTimelockV9": "REHEARSED_GAS_LIMIT",
    "KlerosEventV9": "REHEARSED_GAS_LIMIT",
    "KlerosEventFactoryV9": "REHEARSED_GAS_LIMIT",
    "ERC1967Proxy": "REHEARSED_GAS_LIMIT"
  },
  "maxTotalGasCostWei": "EXPLICIT_TOTAL_ETH_BUDGET_IN_WEI"
}
```

Placeholders deliberately fail validation. No production address or budget is inferred from old test
wallets, operator names or historical configurations. The multisig address, signers, threshold,
modules and recovery process still need review when concrete deployment inputs are supplied.

After compiling V9, `--plan registry/ethereum-v9-public-plan.json` independently recompiles the
saved Solidity input, compares its sources and artifacts, checks code limits and encodes four unsigned
CREATE requests: timelock, event implementation, factory implementation, atomically initialized factory
proxy. All nonces, predicted addresses, constructor data, chain and explicit gas/fee ceilings are bound
to the plan. Deployer nonce changes require rebuilding the complete plan.
Individual gas limits cannot exceed16777216, the [EIP-7825 cap](https://eips.ethereum.org/EIPS/eip-7825).

Optional `--preflight` uses an allowlisted read-only transport with bounded retries and canonical
snapshots. It refreshes the reviewed real Kleros pair/ABI/fees, verifies deployer nonce/account code,
multisig runtime hash, balance, current base-fee coverage and unoccupied predicted addresses. Pending
nonce checks before and after the snapshot reject known competing transactions. The plan is copied
before asynchronous reads so caller mutation cannot replace its reviewed requests. It does
not verify multisig governance quality or estimate the complete dependent deployment sequence.
Gas limits must be validated by a complete local-fork deployment rehearsal before deployment approval.
`--output artifacts/mainnet-release/name.json` writes a new public file without replacing evidence.

This tool cannot broadcast. The future deployment requires a concrete reviewed plan, current
governance and funding inputs, successful application/contract acceptance checks and separate human
authorization. Production event policy and evidence publication are also separate actions.

## Verified release-tool checks

The focused command below passed49/49 tests on29October2026. It covers the read-only real-Court
verifier, bounded retry/reorg/receipt handling, ordinary Solidity storage compatibility and unsigned
request validation. Independent review found pending-nonce and asynchronous caller-mutation gaps;
both were fixed and regression-tested. Storage compatibility does not automatically validate hidden
ERC7201 roots or prove benevolent replacement code.

```sh
node --test test/mainnet-release-plan.test.mjs test/mainnet-storage-layout.test.mjs \
  test/mainnet-verification-runtime.test.mjs test/mainnet-kleros-verifier.test.mjs
```

`node --test test/mainnet-release-rehearsal.test.mjs` separately passed1/1. It independently recompiles
the26source input and executes all four unsigned requests on an isolated in-process chain1. Each
predicted address and immutable-patched runtime hash matched. Factory initialization was atomic,
reinitialization failed, and timelock proposer/canceller/executor/self-admin roles matched the design.
The permissionless test helper is explicitly synthetic, not a production multisig candidate.

| Local deployment | Gas used |
| --- | ---: |
| Timelock |1409070|
| Event implementation |4714045|
| Factory implementation |1728158|
| Factory proxy and initialization |234173|

These are local execution measurements, not a current mainnet fee quotation or an approved budget.
Plans retain `gasEstimatesVerified:false` until their concrete deployment inputs and rehearsal are
reviewed. Compiler evidence uses `standardInputSha256` for compact `JSON.stringify(parsedInput)`;
`standardInputFileSha256` separately identifies the raw saved file, including formatting.
The plan's `provenance.v9BuildManifestSha256` and `provenance.v9StandardInputSha256` bind the
reviewed canonical manifest and compiler input for production runtime checks. Each contract manifest
entry also pins `abiSha256`; bytecode-compatible source is insufficient if its supplied ABI changes.

The [contract release record](V9_CONTRACT_RELEASE.md) contains the separate12/12 contract/security/
capacity tests and1/1 real-Kleros V9 fork. Root independently rehashed the fork proof's six source pins,
canonical compiler input and four creation-code hashes; all matched, with322allowlisted upstream
reads and zero upstream signatures/broadcasts. Only jury adjudication was simulated locally.
Application/runtime/browser acceptance is recorded separately by the core and UI lanes.

## Future upgrades

Archive the previous revision's complete compiler input, ABI, storage layout, immutable maps and
approved runtime hashes before preparing a replacement. Keep the original factory/child creation
evidence separately from the current implementation evidence. Validate ordinary layouts and the
explicit namespace roots/structs, rehearse funded-state migration and failure rollback, and review
the exact timelock target/calldata. Record each event's operation separately. The app must receive
the reviewed implementation evidence and manifest pins; it must not automatically trust arbitrary
replacement code merely because the timelock executed it. Unknown upgrades block new financial
actions while submitted transaction receipts remain available for reconciliation.
