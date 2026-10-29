# Active core launch integration

Latest schedule override: the human explicitly retired old A/B/C runs in the UI chat. Core read the
actual message and verified `finish-kleros-testnet-kickbacks` and `finish-kleros-ui-testnet-flow-c`
are PAUSED. Older statements about ACTIVE/unchanged schedules are historical. Do not resume or run
their financial stages. They remain incomplete with funds/proofs/journals preserved; no chain cleanup.

The latest human target is Ethereum mainnet using their own wallet, superseding the briefly requested
new Chiado E deployment. Wallet: `0x2bb03593892724d225071068E59ab1E48aF05b55` (checksum valid).
The human signed four mainnet setup transactions, now canonical and fully verified. Only the human
signed through their wallet; no CLI signing key or operator broadcast was used.
A/B/C hosting/assets/journals and both scheduled operators remain untouched. E has only fresh local
wallets and a blank Netlify site; E financial entry points are on HOLD, with no E on-chain transaction.

Contract lane checkpoint: `6c7803fd6c1a16541ded8f55ae38d5992f0d08c6`. Single transferable upgrade
owner, two-step handover and permanent48-hour timelock; current contract/source/protocol tests passed.
See `docs/LM_CONTRACT_HANDOFF.md`. The old417b multisig candidate is archived, not current proof.

Current branch is `codex/core-application`, committed contract/policy checkpoint
`d7687b998c72758e03c3773465b8eca3aae6f06c`; core integration below is uncommitted WIP.
The current four-CREATE proposal is
`artifacts/mainnet-release/user-2bb03593-four-create-feehistory-1793262570717.json`, canonical SHA256
`542e3df4ee6eea7827286c3dfcb084ceadd9d12744a0815d2da11b8a0d1b4ba0`.
Its maximum total gas cost is0.0010174541274ETH, with zero native value and four infrastructure
contracts only. The earlier0.000903774876ETH proposal is historical and unapproved.
Fresh read-only step1 preflight passed at block26297303: balance0.00985ETH, nonce0/EOA/source/Court
checks, first estimate1713747gas below2250000 and base fee52677481wei below91662534wei cap.
The local review page is running at http://127.0.0.1:8787 with signingEnabled false.
Approval hash `e23f190b9f94fdc118d2eed87826be57d7b46f0253ad4115d02c07d9789cd151` is a computed
binding, not human approval. Spending approval remains false; no wallet request or mainnet write.
A fresh source/nonce/balance/fee/canonical preflight is required before each wallet handoff. No automatic
fee increases, nonce rebuild, resubmission or replacement signing is authorized.

## Product/API ownership

Core owns existing src/server.mjs/workbench.mjs/utils.mjs/batches.mjs/deposit-inbox.mjs and final integration.
Core agent simple_ui owns upgrade-verification plus its tests and the actual reusable
`test/fixtures/luma-launch-runtime.mjs` / production-workbench tests. Core agent testnet_readiness owns
factory-onboarding.mjs + tests (8real local checks passed; current race/recovery/seal corrections closed).
Core agent v8_chain_adapter owns mainnet-runtime/storage and NEW mainnet wallet review bridge files.
The UI chat owns compact public UI in its isolated worktree; no hosting/signing/publish there.
The contract chat owns NEW test/luma-launch-flow.e2e.mjs, the one actual integrated browser financial runner.
The management chat owns read-only acceptance and guiding the human in Brave, including concrete budget
review questions. Root remains the sole RPC/journal/integration operator. Avoid duplicate questions.

## Implemented core WIP

Verified factory-only production context supports events[] and durable dynamic onboarding. Strict chain1,
actual Kleros pair, source/ABI/storage/runtime/immutable and transferable-controller provenance remain.
Factory service creates unsigned wallet drafts, exactly verifies canonical EventCreated/source/init and
saves new child before confirmed onboarding. Per-draft locks, durable known hash before slow verification,
terminal idempotency, final wallet-block factory/governance seal and same-wallet receipt-only recovery
are covered by local tests. No server signer or execute endpoint exists.

Routes: POST /api/organizer/events/drafts; GET /:id; POST /:id/validate, /submitted, /reconcile.
Validate returns {draft,transaction}; confirmed reconcile returns actual child + participantUrl
`#event=<stableId>&view=participant`. Draft contract is the FACTORY; createdContract is the child.
Six setup inputs: title,lumaUrl,startsAt,endsAt,timezone,depositEth. Only approved published F.policy
{uri,sha256,text} with trusted policyStatus published is accepted. The real policy is still unpublished.

Production deposits create only a minimal wallet record: no name/email, walletVerified true,
identityVerified false, no inferred Luma registration or admission. Admission/check-in eligibility uses
wallet proof independently of optional identity. DepositAction gives authoritative remaining commitment,
blocks duplicate/pending/admitted/rejected/closed payments; legacy7/8 economics remain unchanged.
Canonical ownWallet.deposit has DIRECT wallet,eventId,chainId,contract,abiVersion scope fields.
Partial top-up receipt verification uses positive contribution + complete aggregate current credit;
registered principal remains separately tracked. Existing held-share/ruling0/payment/owed semantics stay.

## Integrated UI and current verification

Integrated exact compact UI checkpoint `613c79a7474ca366eb0694f7d89d392ccfb72e32` from the
isolated UI worktree. All21 asset hashes match its final provenance, including the supplied palette.
Root server allows the four new Luma assets. Root uses the current backend, never the UI worktree's
historical backend. Newly copied synthetic fixture dependencies use current transferable governance.
Integrated pure Luma guards12/12 and root typecheck pass; mainnet runtime fixtures16/16 pass.
The actual financial browser runner is executing under an explicit src/public freeze. Its earlier
stopped attempt completed creation/restart recovery and deposits but stopped at a test navigation
issue after admission; it is not counted as passed. The corrected test opens the collapsed control
before registration and runs fresh isolated state. No product source or public finance was changed.

Wallet bridge12/12 local tests and management's15 browser checks pass on the same five-file bridge
source closure `c85876cca7271f09547cd0d150ea8ec189b45f69e3d9b37a9ef9aace64ab491c`.
They cover four synthetic CREATEs, actual final factory verification, source/fee/nonce boundaries,
uncertainty, replacement-candidate validation, lost-response recovery and double-click protection.
They do not establish actual wallet extension behavior or deployment.

Frozen A/B/C operator closure was freshly verified:142 files, zero signing files read/signatures/
broadcasts. The independent A/B and C schedules and all old origins/manifests/journals stay unchanged.

## Still required before launch

Finish actual browser organizer creation -> wallet-only deposits -> dispute ->
ordinary Alice payment/Bob held unruled -> delivered ruling -> same-Bob settlement/collateral, plus
restart/lost-response one-send and private/context isolation. Use local chain time only. Freeze one current
source, then build/typecheck/appropriate regression/browser checks, record exact commands honestly.

Finish the explicit public case-artifact export/review/verification route and durable one-upload intent.
Management owns `src/mainnet-case-publication.mjs` and its pure mocked-transport tests; an ownership
collision superseded the earlier child service and its tests. Only current-module tests count.
Publication needs both artifact SHA and case-scope approval, atomic persisted intent and truthful
gateway verification. It must never block challenge/match deadline rights. No publication or paid
gateway action has occurred. Generic policy SHA
`24e3608d8ed5daf919671193a71c6e91ebac90095a2780a8946a20cda41f8308` remains unapproved/unpublished.

The wallet review bridge is NEW src/mainnet-wallet-deployment.mjs,
scripts/serve-mainnet-deployment.mjs and tools/mainnet-wallet/. Default is read-only. Signing stays disabled
until concrete human review binds exact plan and fee ceiling. Completed reviewed corrections: detached
immutable plan/tx DTOs; append-only exact same-nonce candidate-hash recovery within approved fee/gas/data
bounds; final actual factory/controller proof; restore validated local saved hash after lost server response.
Never use E or historical wallet files for mainnet. The human owns the signing wallet in Brave.

First real event uses the organizer's self-service HTTPS Luma destination and immutable six-field review.
The generic `luma-v9-generic-policy-draft.json` has no placeholders but remains unapproved/unpublished;
do not substitute the historical first-event draft containing placeholders. Production policyURI is the
canonical HTTPS IPFS gateway URL; the policy proof also records its raw /ipfs/ path and byte SHA256.

All four infrastructure deployments are now canonical and the actual production runtime verifies the
source, factory slots/default, owner and48-hour governance. Public receipt proofs are
`artifacts/mainnet-release/user-2bb03593-step{1,2,3,4}-confirmed-*.json`. Factory proxy
`0xEe049D03a007e150ec8ec46B066823043BAcf14E`; total gas466986018937392wei, below the approved
1017454127400000wei cap. All four once-journal attempts are1. The earlier report of no actual first
transaction was clarified by the human before signing began. The later nonce guard stopped correctly
because transaction4 was already submitted, and was resolved by its known receipt without replay.
No more infrastructure wallet sends are needed.

New mainnet-only hosting resources are prepared but have no app release: Netlify site
5daad91a-3e1c-44f8-a43e-a42adacd6936, https://kleros-luma-ethereum.netlify.app; Railway project
fc82ba7d-dbd8-46a1-90b0-46c150405823, environment da2b097e-6883-424e-8539-99fb7422df10,
service5de64f0d-3712-41c9-b6ae-a5df868e716a, volumeff8af62f-9282-4205-ac81-6aac49c06ef0.
The new volume mount was corrected to the reviewed fixed /data path before any deployment. Runtime
uses /data/workbench-state.json and drops bootstrap privileges to uid1000. Root's old Netlify link,
old projects/volumes, A/B/C schedules and all old sites remain unchanged. Packaging supports
`node scripts/prepare-hosted-backend.mjs COMMIT --mainnet-context` and exact production-manifest
allowlisting, preserving the old context directory and excluding unsigned wallet plans/private data.
