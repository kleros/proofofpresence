# V10 infrastructure deployment review

Checkpoint: 29 October 2026, 23:51 Bangkok. Branch `codex/core-application`.
The preceding integrated checkpoint is `7841d6e032384a4524c04574e8b45e5856e6c4ea`:
frozen V10 contracts were integrated as `c4e53c1`, then the finite UI projections as `7841d6e`.
This review prepares four Ethereum mainnet setup contracts. It creates no guest event, publishes
no policy and enables no application financial action. Existing V9 and A/B/C remain separate.

## Exact unsigned proposal

Public plan: `artifacts/v10-release/user-2bb-nonce6-reviewed-account-proposed.json`.
Canonical SHA256 (JSON.stringify of parsed plan):
`2e525e6de33c768b7a592b075d002540447dea7fd5205716519cef5bc1bf0e37`.
Configuration: `registry/ethereum-v10-public-2bb-nonce6-20261029.json`.

| Nonce | Contract | Predicted address | Proposed gas limit |
| --- | --- | --- | ---: |
| 6 | Upgrade controller | `0x8819994609eC122AaC2B4CC2200e694C6b039Cd2` | 850,000 |
| 7 | Event implementation | `0x411ADfb7490C664362D7F933f693B41eE4E997c3` | 5,600,000 |
| 8 | Factory implementation | `0x5bD88F176d66e7daF87BD3Ff1d783DC26322B829` | 2,000,000 |
| 9 | Initialized factory proxy | `0x2E10024bD326FD34757b021A72F46813Fc1C61D2` | 300,000 |

Each request is a direct type-2 CREATE from wallet
`0x2bb03593892724d225071068E59ab1E48aF05b55`, chain 1, no recipient, zero ETH value.
The four gas limits total 8,750,000. Proposed maximum fee is 0.75 gwei and maximum tip is
0.01 gwei. The maximum total gas cost is **0.0065625 ETH**, currently **unapproved**.
There is no automatic ownership renunciation. This wallet initially controls immediate upgrades;
renunciation later permanently removes that controller authority.

The preliminary canonical public observation at block 26299673, 16:44:20 UTC, found
latest = pending = pinned nonce 6, balance 0.009129904262762008 ETH, base fee 0.285820286 gwei
and the exact reviewed MetaMask delegation designation. This neither reserves the nonce nor
guarantees future fees. Proof:
`artifacts/v10-release/account-observation-2026-10-29T16-44-20.090Z-3e34449e-c2da-4357-ba78-9317ba3cecd5.json`,
SHA256 `8890a6d8be7cd5734edd5ade016cc8dc886491606f35339706d8ec8fccb40e6f`.

## Wallet and source evidence

All three framework runtimes were reproduced with exact solc 0.8.23, official release and dependency
source blobs, compiler settings, metadata and independently derived immutable values:
`artifacts/v10-integration/metamask-source-verification-6ea176ca-3ea1-49eb-a290-1013d6492a15.json`,
SHA256 `7108974bc07ca8b46964d855887d9c26c1891386d21c5cf1bdb3f628fb7cb17c`.

The separate actual local Prague protocol test passed 37 checks / 14 local transactions, including
a real type-4 authorization, then four direct type-2 CREATEs from that delegated account, protected
event creation, native deposit and withdrawal with exact custody/gas reconciliation:
`artifacts/v10-integration/eip7702/2026-10-29T16-40-03.581Z-d5123ece-de5d-4d69-a5a0-1d5a2236535c/proof.json`,
SHA256 `11ac36fe9af1158934012175c453dd9056e55962b644090d6c065497beea9ad3`.
These are synthetic local signatures, not this user's signature or mainnet deployment.

The opt-in account review is narrowly scoped to the four direct CREATEs:
`artifacts/v10-release/delegated-four-create-review.json`,
SHA256 `8769e4c2663c1746e083428b0681c84c66e6de68daa93f0cd256376e7d9c5a14`.
Unknown code fails closed. Application financial eligibility remains false. The planner's prerequisite
description now explicitly requires this separate review for nonempty code; transaction data, frozen
Solidity and compiler output did not change. The earlier unsigned proposal is retained as history.

## Checks and remaining work at this checkpoint

Passed: 13 preflight tests, 6 exact-bundle guard tests, 4 preliminary-observer tests, 17 wallet-helper
tests, 7 source-verifier rejection checks, the actual 37-check local protocol test and typecheck.
The affected planner test also passed after its prerequisite-description change. The final raw-envelope
mutation fences each passed their targeted actual-local regression. The separate contract handoff's
20 financial/security/planning tests remain its source-bound evidence and were not broadly rerun.

The operators were committed as `2a281c606445d2eb646b3ab6d47b97f83449dad9`. The exact sequential
nonce-6 bundle passed on fresh, unforked local Anvil Prague. Per-step estimate = gas used:
669,197 / 4,641,208 / 1,654,634 / 229,827, total **7,194,866**. All four runtime bytes and initial
controller/factory state matched. Proof:
`artifacts/v10-integration/bundle/2026-10-29T16-52-27-140Z-78a7539c-5d32-4f4a-8bd8-d4c71b765070/proof.json`,
SHA256 `d8b569a5675e247ee4ab3d716c3b7f96f4a7242bbe91a8203abd033a69e43022`.
Local impersonation and designation/nonce fixtures are explicitly disclosed. Its local paid cost
uses simulated declining base fees and is not a live price quote.

The first fresh public preflight stopped with `RPC_READ_FAILED`; its exact method was unavailable
under the initial redaction. Preserve `artifacts/v10-release/preflight-stopped-2026-10-29T16-52-34-151Z.json`.
The follow-up operator adds sanitized method/read-index/HTTP/RPC-code diagnostics and permits the
already-used fixed public dRPC origin explicitly as primary. It retains all account/framework,
canonical head, nonce, address, fee and balance checks, with no retries or signing interface.

The complete fresh dRPC public preflight subsequently passed **35 reads / zero blockers**:
`artifacts/v10-release/preflight-2026-10-29T16-57-39.475Z-62d64915-72f8-416b-ad79-4841921f9533.json`,
SHA256 `21b84ada92099187e80de0a3f9af3c122eb5a74c077af7f3de58c8379498eca7`, source
`009bad57847e885f4562c18e677a50362859f88e`. At canonical block 26299743, nonce 6 remained
latest = pending = pinned, the exact designation and three framework runtimes matched initial/final
anchors, all four predicted addresses had empty code and nonce zero, and the balance covered the cap.
Observed base fee was 0.259203805 gwei. With the chosen 0.01 gwei tip and rehearsed gas, the indicative
cost is **0.00193688530366513 ETH** (about 0.00194); the hard maximum remains **0.0065625 ETH**.

The separate V10 loopback wallet handoff is frozen with signing disabled. Source/backend SHA256:
`cc74e502d2861bf1714d15aeed6a6b2d5c3580babb038f84269814fdf7aae86c`.
Exact plan + normalized reviewed account proof + bridge-source approval hash:
`93adbbfe5fe7b192bd4c82a30e87c9df65c8e4046b35885e27b897c5b5b09cf0`.
It preserves isolated private journals, original hashes, uncertain-state locks, two canonical confirmations,
strict direct type-2 receipt matching, runtime and full V10 factory/governance verification, plus fresh
per-step account/framework/canonical/nonce/address/balance/fee/gas checks. Backend RPC is read-only,
serially paced at least 1500 ms, cancellation-aware and without retries. Only the human's browser wallet
can sign. No event creation, policy publication, ownership renunciation or old-event migration is included.

Wallet checks: initial 10 focused tests passed, including actual local four-CREATE/full V10 factory proof.
An expanded 12-test run had 11 passes and one HTTP test-harness failure (Host override); the harness
was fixed to use the actual node:http Host header and both affected HTTP/pacing tests then passed.
This is not a claim of an additional all-12 rerun. Final three browser groups passed on desktop/mobile,
zero RPC/wallet requests/signatures/broadcasts:
`artifacts/v10-wallet-browser/2026-10-29T17-03-00-470Z-39ab218e-bcbc-4682-8fbb-6882628aba3a/proof.json`,
SHA256 `873ac01e3255fa601902b895743a5ab944b3d7e6f46ff78f315c32aa37158250`.
Root inspected the images; their bytes match the preceding inspected screenshots. Independent bounded
source review found no material blocker at these final hashes. Typecheck and diff checks passed.

The final handoff was committed as `df75dfab9cbc604e20b040abc7a5be4abcfe0ccf`. The source-bound public
readiness record passed its offline checks:
`artifacts/v10-release/deployment-readiness-2026-10-29T17-06-55.343Z-36f42093-1448-4ef8-b51d-67a1c619e518.json`,
SHA256 `47e59faf11c11659b88e81b50240b00e12bb99ee7d9af53d8615a41d7b9a9dda`.
It records `readyForHumanBudgetReview=true` and budget approval `NONE`, with signing disabled.
The contract chat has presented the single exact cap approval; a human answer is still required.

The actual review-only server runs at `http://127.0.0.1:8788/`. Actual GET `/api/plan` returned 200 with
the exact final plan/approval hashes and signing false. It uses only `.runtime/mainnet-v10/` journals.
Loopback GET routes are `/api/plan`, `/api/state`, `/api/check?step=N`; origin-checked POST routes are
`/api/prepare-step`, `/api/record-submitted`, `/api/wallet-error`, `/api/receipt`,
`/api/recover-candidate`, `/api/verify-setup`. The backend cannot sign or broadcast. Next, enable only
this frozen handoff if the human approves. Each transaction still requires fresh checks and the
human's own wallet confirmation. No signing or broadcast is authorized by this file.

New V10 backend modules exist locally with explicit version dispatch, separate manifest/state,
immediate-governance verifiers and onboarding. No V10 production route or financial capability is
live yet. Remaining application work includes scoped delegated authentication, receipt intent proof,
server/client dispatch, canonical adoption → Your events/homepage checks, policy publication approval,
an isolated V10 hosting configuration and the tested Netlify update.
