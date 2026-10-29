# Production application integration

Current branch: `codex/core-application`. Last committed financial checkpoint:
`40b20de125dd84d8805a16deb142b084580d8f48`. The completed production candidate is recorded in the
local source checkpoint accompanying this document; it has not been deployed or pushed.
`PROJECT_BRAIN.md` is canonical. The human authorized preparation and testing, with no mainnet deployment.

## Runtime and interfaces

`MODE=hosted-production` is the only production mode. It requires exact HTTPS public/backend origins,
a gateway secret, an explicit `MAINNET_MANIFEST`, durable `MAINNET_STATE_FILE`, and optionally a private
`MAINNET_RPC_URL` override. Public bootstrap metadata contains only the manifest's credential-free
public Ethereum RPC. The backend has no signer, unlocked accounts, transaction broadcast, faucet,
clock control, mock rulings or automatic deployment. Its RPC endpoint admits bounded read-only batches.
The existing v7, v8 and Chiado modes keep explicit dispatch; production uses only
`kleros-event-v9-uups` / VERSION9 / chain1 / ETH18, with v8 financial economics and86400-second windows.

Existing scoped routes remain authoritative: signed nonce authentication, event detail, participant
records, imports/batches, draft creation/validation, submitted hashes and canonical reconciliation.
`GET /api/bootstrap?selectedEventId=...` preserves the selected bootstrap union. Production bootstrap
adds explicit environment, wallet/account support, real arbitration and transaction capabilities.
Production detail adds `deploymentTrust` and `upgrade`. Governance metadata includes implementation
address/runtime hash, family, storage schema/revision, timelock authority, multisig, actual delay and
verified pending operation identity/deadline. A factory default selection affects future children only.

The runtime verifies the reviewed ARRAY-rewards resolver
`0x4B89e798B10478A839Ea0Abcf86C4B94A3C782A4` and Liquid V1
`0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069`. The scalar-rewards resolver is incompatible.
Fees and action simulations are fresh; there is no hard-coded production dispute price.
`state.cases[].appeal.withdrawableWei` is null before delivered resolver finality and for anonymous
viewers. After finality it is a successful pinned quote for the authenticated wallet; actual zero is
separate from unavailable. Attendance payment, held share, owed credit and appeal rewards stay separate.

Production currently supports standard EOAs. Authentication and draft creation/validation check fresh
bytecode and canonicality, rejecting contracts, ERC1271 and EIP7702 delegation. Final draft checks run
provenance before a fresh wallet check, then compare event/factory slots at that wallet's block and
recheck the canonical anchor. These are reviewed read-time facts, not a guarantee about future blocks.
A scoped submitted/reconcile/status route remains available even when current implementation trust
has changed. It confirms only the original wallet/event/chain/calldata/value/hash and canonical receipt;
it never grants new signing authority or replays a transaction.

## Upgrade provenance and release boundary

The initial production adapter accepts source-pinned revision1 implementations, exact ERC1967 proxies,
constructor-only initialization and direct CREATE provenance. It checks compiler-declared runtime
immutables, exact non-upgradeable timelock code, role history, minimum172800-second delay, and actual
multisig code hash. Unexpected implementation/history/governance changes block new financial drafts.
Later reviewed implementation revisions require an explicit artifact/provenance migration review;
the initial adapter does not silently accept arbitrary upgrades. A queued upgrade is disclosed and
bound into draft review; it does not blanket-freeze held-share payouts.

Human inputs for an actual release remain: reviewed multisig/deployer identities and governance setup,
fee/budget/funding, immutable policy/template publication and concrete deployment manifest. No private
signing material belongs in public configuration, proof files, API errors or browser state. Production
API errors use fixed messages and never reflect provider payloads or authentication signatures.

## Validation scope and deployment inputs

Contract lane evidence covers actual v9 proxy execution, storage/upgrade attacks,150-wallet capacity,
unsigned CREATE rehearsal, and the real deployed Kleros code on a strictly read-only upstream/local fork.
Root application tests cover the production routing/runtime/account boundary separately from the real
proxy-backed application financial flow. UI fixtures cover production network/account/governance and
reward-readiness behavior. Neither synthetic HTTP fixtures nor the completed Chiado80015 D flow are
claimed as a production v9 browser-to-mainnet test.

The final UI handoff is integrated and source-bound. Broad Node, final focused production/proxy/privacy,
typecheck and compatibility browser checks pass; the final Linux image builds and its non-root,
network-isolated runtime/artifact/loopback smoke checks pass. Exact commands, counts, preserved initial
failures and scope limits are recorded in [TEST_REPORT](TEST_REPORT.md). The initial missing local Docker
daemon was resolved with a separate temporary VM, which was deleted after verification.

The optional D preview publish is deferred. A/B and C retain their original hosted
assets, frozen142-file operator closure, once-only journals and independent schedules. Real mainnet
broadcasts, production hosting changes and a live independent jury run remain outside authorization.
