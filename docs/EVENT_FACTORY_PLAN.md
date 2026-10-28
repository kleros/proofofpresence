# Event factory proposal

Requested 28 October 2026. **The user confirmed the hardened-child option; implementation is now
documented in [EVENT_FACTORY_V8](EVENT_FACTORY_V8.md).** This file retains the accepted design.
The [security review](SMART_CONTRACT_SECURITY_REVIEW.md) covers existing v7; new v8 results are separate.

## Meaning of the factory

- **Factory:** a deployment and discovery contract that creates an event contract and records its address.
- **Event contract:** an independent escrow/attendance/dispute state machine for one stable event.
- **Organizer:** the caller creating the event, installed as its initial owner atomically.
- **Version:** an exact, reproducible child implementation with its own ABI, policy and tests.

Each event has its own ETH balance, participants, owner, dates, policy/template, challenge IDs,
held shares, owed claims and settlement. A common factory does not combine these balances.
The factory has no financial owner, withdrawal function, fees, upgrade mechanism or participant funds.
Any deposits go directly to the corresponding event contract.

## Proposed implementation

1. Add new root `contracts/` sources and a separate versioned build path. Preserve the historical
   `references/kickback/contracts/TruthPaysKickback.sol`, compiler, `abi/v7`, policy and deployment inputs.
2. Use one immutable factory per exact child version. Accept typed event parameters and a stable
   `bytes32 eventKey`, not arbitrary executable bytecode, an initializer or a caller-supplied creator.
3. Scope event keys to `msg.sender`; reject duplicate keys for that creator. A different creator
   cannot occupy another creator's key by copying a pending transaction. The factory address and
   chain remain part of the deployment identity; the key is not derived from a mutable URL slug.
4. Construct the child with the caller as owner, validate times/amounts/immutable arbitration inputs,
   and record it only on successful deployment. Emit creator, key, child address, exact version and
   configuration hash. Use ordinary `CREATE` unless deterministic deployment is separately needed.
5. Measure child/factory runtime and initialization sizes against EVM limits. Start with direct
   construction; if the factory would exceed the code-size limit, hold the fixed child creation code
   in immutable code-storage chunks created by the factory constructor. The caller can never supply
   or replace executable child code. Publish/check the exact compiled creation-code hash.
6. Add factory/child tests on synthetic local chains and an explicit standalone adapter
   for that version. Keep current workbench v7 event dispatch intact. Do not silently move existing event funds or
   replace recorded contract addresses.

## Recommended child: a new hardened version

This choice addresses reproduced findings rather than merely packaging v7 in a factory:

- Record per-wallet pending deposits and include them in reserves. Registration must consume that
  wallet's collateral; another payer's funds cannot stand in for it. Define a direct recovery path
  for credits that were never registered and enforce an immutable deposit cutoff.
- Enforce tested capacity and bounded lifetime iteration, including readmissions. Either avoid
  duplicate historical entries or account for their gas explicitly. Pending credits outside the
  admitted population must not grow any settlement loop.
- Define organizer evidence identity/rotation in the new policy and template. Do not silently
  reinterpret existing immutable v7 evidence.
- Retain curated admission, native ETH, V1 resolver ID semantics, permissionless final settlement,
  equal held-share redistribution, failed-payment claims and existing ruling-0 economics.
- Use a reviewed compiler with relevant known fixes in a separate dependency/build path, while
  retaining exact v7 reproduction. The new contract is a new deployment candidate requiring review.

Alternative: the factory creates byte-identical v7 children. This supplies multi-event deployment
and discovery but **does not fix** the review's custody/recovery/gas-limit findings. It must be labeled
accordingly and remain within v7's tested operational envelope.

## Acceptance checks

- Two factory-created events with different creators, deposits, dates and immutable policies; one
  participant in both. Ownership, refunds, payouts and disputed reserves in A cannot affect B.
- Duplicate creator/key rejection, independent reuse by another creator, front-running resistance,
  constructor-revert rollback, exact owner installation, emitted configuration/version correctness.
- No factory balance/custody or administrative path into children; no arbitrary code/initializer.
- Exact version/code hash and EVM code/initcode size limits; all valid deployment payloads are bounded.
- Under the hardened option: payer-bound collateral, pending-credit recovery, deadline boundaries,
  maximum-capacity/readmission gas tests, reserve invariants, reentrancy/failed-recipient behavior,
  held-share settlement in different orders, final appeal overrides and rulings 0/1/2.
- Root build/typecheck, relevant contract/application/browser regression checks, honest TEST_REPORT
  evidence, and explicit deployment/version documentation. All writes remain local until a concrete
  external deployment is authorized.
