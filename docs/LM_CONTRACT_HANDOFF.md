# Current single-owner contract handoff

The current candidate replaces the historical417b2c0 multisig setup with one deployment wallet and
one transferable upgrade owner. The same wallet submits the four CREATE transactions. The contract
lane has submitted no mainnet transaction; core remains the sole deployment/integration operator and
the user signs reviewed mainnet requests through their own wallet.

## Governance

`KlerosUpgradeTimelockV9(address initialOwner)` exposes `owner()`, `pendingOwner()`,
`transferOwnership(address)`, `cancelOwnershipTransfer()`, `acceptOwnership()`,
`pendingOperationCount()` and `executingOperationCount()`.

The owner proposes/cancels; a pending owner can cancel but cannot propose. Acceptance requires an
empty, idle queue, atomically removes old authority and grants the new owner its roles. Zero/self/current
owner targets, renunciation, external role changes and empty batches reject. Every scheduled governed
action still waits at least172800seconds. Clearing an ownership handover never transfers event funds
or event-organizer ownership. Each event retains its existing independent two-step organizer transfer.

Production governance metadata is `kind: single-owner-timelock`, historical `initialOwner` and
`minimumDelaySeconds`. `deployment.initialUpgradeOwner` binds the timelock constructor. Current
owner/pending owner and counters are read and verified on chain; a valid handover must not reset app
state or rewrite historical creation inputs.

## Existing organizer factory API

The exact function is:

```solidity
createEvent(bytes32 eventKey, (
  uint256 depositAmount,
  string eventName,
  uint256 eventStart,
  uint256 claimDeadline,
  (address disputeResolver, bytes extraData, string[] metaEvidenceTemplate,
   bytes metaEvidenceSlots, string policyURI) arbitration
) config) returns (address child)
```

It is nonpayable. The authenticated transaction sender becomes the child financial owner. The shared
upgrade controller comes from the factory; organizers do not choose a different upgrade authority.
Deposits go directly to the child proxy after creation. Sending a deposit creates payer-owned pending
credit; separate admission/registration is still required. Luma metadata or redirects cannot establish
financial attendance or payout eligibility.

Required terms: nonzero eventKey and deposit; eventName1–256UTF8bytes; policyURI1–512bytes;
extraData≤128bytes; eventStart strictly after the mined creation block timestamp; claimDeadline at
least eventStart+604800seconds. Template slots≤32, pieces=slots+1, encoded template≤12288bytes;
each slot is1–5 and slots1(staker),2(contract),4(case organizer) are mandatory.
Historical templates retain `eventV8Template()` in `src/contracts-v8.mjs` byte-for-byte. New Luma
organizer creation uses the explicit `eventV9LumaTemplate()` in `src/contracts-v9-luma.mjs`, returning
`{pieces, slots}`. It binds each event's Luma URL, UTC interval, IANA timezone and policy SHA256 in
the immutable contract template/configuration hash. The frozen `V9_LUMA_ATTENDANCE_STANDARD` supports
verifiable in-person or online participation at some point during that interval, case-organizer
confirmation, and otherwise balance-of-probabilities evidence. New template checks passed7/7.
Production uses the reviewed real resolver and `abi.encode(uint256(0),uint256(3))`.
Challenge and match windows are86400seconds; lifetime unique admissions are capped at150.

The canonical factory receipt emits:

```solidity
EventCreated(bytes32 indexed eventId, address indexed creator,
 address indexed eventContract, bytes32 eventKey, uint256 version,
 bytes32 configurationHash)
```

`eventId = keccak256(abi.encode(chainId, factoryProxy, creator, eventKey))`;
`configurationHash = keccak256(abi.encode(creator, config))`; version=9.
Verify exact factory recipient/from/calldata/value0/chain/nonce, successful canonical receipt and
confirmations, the exact matching EventCreated log, registry membership, atomic child initialization,
child ERC1967 slot/runtime, approved implementation and current governance. Do not guess a child
address from the factory nonce: another permissionless creator can consume it before mining.
The case template fills the actual child address. Preserve all creation anchors for durable onboarding.

The minimal Luma portal needs no economic Solidity changes. Core must test a real local organizer
creation→participant deposit→admission→attendance→payout flow and interrupted-receipt recovery;
synthetic UI projection checks alone do not establish that acceptance.

## Current evidence and release inputs

Fresh tests: ownership5/5; base/capacity3/3; independent handover7/7 and security9/9. The fresh
real-Kleros fork passed1/1 with five children, a held-case48-hour upgrade, actual appeal/refund/reward
code and delivered rulings1/0/2. Jury adjudication alone is simulated locally. Upstream calls are
strictly read-only; no private signing files, upstream signatures or broadcasts were used.

Proof: `artifacts/mainnet-kleros/v9-owner-fork-ethereum-runtime-final.json`. Historical417b2c0
source/build inputs are archived under `verification/v9-multisig-417b2c0/`; its old proof hashes are
not current-candidate verification. Current public hashes are in `current-owner-pins.json` beside
the new fork proof. The unsigned release planner requires public deployer/nonce, matching initialOwner,
current max/priority fee ceilings, per-contract gas limits and an explicit total ETH budget.
It has no signer or broadcast capability. Core owns fresh live quotes, the final exact review and
user-wallet execution; no historical test wallet supplies mainnet authority.


## Publication remains a separate release gate

The shared, concrete policy draft is `docs/contracts/v9-luma-generic-policy.md`, with exact bytes and
SHA256 in `artifacts/mainnet-release/luma-v9-generic-policy-draft.json`. It has no event placeholders,
but is unpublished and unapproved. Per-event facts belong in the explicit V9 immutable template;
a mutable Luma page or server association cannot replace them. Historical event-specific policy
examples remain preserved. The four infrastructure CREATE transactions need no child policy.

A contract-computed `/ipfs/CID` for case metadata does not establish public availability. Real jurors
need the exact matching case bytes published and retrievable. The existing local-only server-copy
action is not IPFS publication. Core/management own the concrete publication/export workflow and its
release acceptance. Local controlled-Court flow tests must report this limitation honestly; this
contract lane has made no publication or hosting request.


## Final local application acceptance

The final publication-integrated `test/luma-launch-flow.e2e.mjs --run-local` passed14 groups and12
actual UI transactions, including same-Bob delivery, correct terminal UI, restart without resend,
two-event isolation, and exact Waiting/matched case downloads without any external publication.
Proof:`artifacts/luma-launch-flow/2026-10-29T09-20-13-099Z-099c9c6c/proof.json`, SHA256
`48558e9e31d1253b5565202cf8d69757833d84e17595877cec0ff3e96aca4581`. All79 source and26 asset pins
were independently checked. An exact source archive preserves this candidate before the later narrow
publication-store guard hardening. The test report distinguishes source snapshots, the prior stopped
attempt, controlled jury/in-memory scope, and remaining public release gates.
