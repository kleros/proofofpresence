# Ethereum mainnet v8 readiness

Updated29October2026. Status: **production target recorded; source-only readiness review**.

The human specified Ethereum mainnet, chain1, using native ETH. Production uses
`kleros-event-v8`, VERSION8, with86400-second challenge and matching windows. The completed
[Chiado D rehearsal](CHIADO_UI_D_ACCEPTANCE.md) used a separate chain10200 profile, VERSION80015,
with900-second windows and controlled arbitration.

## Contract source

The production factory and child support native ETH and chain-scoped event identities without
a chain-specific Solidity change. Their reviewed sources remain unchanged:

- `contracts/KlerosEventV8.sol` SHA-256
  `e97e3f9a4adb2bb4a697adac609367e5ad2103379bb395a241d54cedc62a9769`.
- `contracts/KlerosEventFactoryV8.sol` SHA-256
  `8488bb19f34f90c302afb08af99759b6308ef04199bc10dc973fa5ad35558505`.

The test factory and child in`contracts/test/` explicitly reject construction outside chain10200,
including Ethereum chain1. Keep that test profile and the production profile separate. Historical
v7 contracts, policies, ABI and deployment verification inputs remain preserved.

## Remaining production preparation

1. **Chain1 runtime and manifest.** Current server modes in`src/server.mjs` provide demos and
   Chiado. `src/testnet-runtime.mjs` requires chain10200, XDAI and controlled arbitration.
   Existing deployment/signing tools also reject non10200 chains. A separate reviewed production
   runtime, chain1/ETH configuration and v8 deployment manifest are needed. The existing mainnet
   registry is historical v7 reference material.
2. **Real Kleros integration.** Production interfaces target V1; current v8 arbitration rehearsals
   use mocks. Verify the intended Ethereum resolver/arbitrator addresses, deployed bytecode, ABI,
   evidence, appeals, final ruling delivery and actual fees from authoritative deployed sources,
   then exercise them on a local fork. Historical addresses/comments and Chiado mock addresses
   are not fresh Ethereum verification.
3. **Owner, ETH budget and signing.** Use a separately reviewed production owner/signing method,
   current ETH fee budget, chain1 signing guard, exact constructor inputs, provenance and
   once-only journal. Synthetic role wallets, grants and testnet fee limits remain test fixtures.
   Do not infer the production owner or permissions from historical operator names or test roles.
4. **Production UI disclosures.** Currency rendering already follows bootstrap metadata, but
   `src/workbench.mjs` currently supplies controlled-test arbitration messaging. Production must
   identify Ethereum/ETH and the verified real Court correctly and exclude demo controls.
5. **Production provenance checks.** Apply full constructor/input, factory/child creation and
   canonical runtime verification to the chain1 release. `src/chain.mjs` currently has the
   strongest full-creation checks for the separate test profile.

The next reviewable production deliverable is an unsigned chain1 deployment/configuration plan
with the selected owner, verified real Kleros pair, policy/evidence inputs and explicit ETH budget,
backed by fork tests. Mainnet broadcasting, production hosting changes and IPFS publication need
their own concrete authorization after that result is reviewable.

This target clarification does not alter the completed D evidence or the older active A/B/C
contracts, origins, frozen operators and scheduled runs. Source inspection alone does not establish
that the current hosted app or deployment tooling is ready for Ethereum mainnet.
