# Current portable inbox and batch integration — 29October2026

Core branch `codex/core-application`; portable UI source
`1b0ea0e1f6c3638e848ba6c2c59494dc3ab1ecb0`. The contract inbox, selection model and separate
approval/check-in modules were integrated around the latest core controller. Source/integrated
asset hashes are in [portable-batch-assets-sha](../artifacts/portable-batch-assets-sha.json).

Backend authority supplies eligibility and opaque preview/commit tokens. Approval and trusted
check-in are separate atomic off-chain actions; registration and posting monetary attendance still
require a fresh reviewed contract transaction. Unknown depositors remain wallets, never inferred
contacts. Filters and event/account changes invalidate unsigned selections and reviews. Submitted
financial hashes survive those changes.

The durable batch marker saves only scoped IDs/nonces/wallets before a commit POST. After an
uncertain response or reload, explicit GET status reconciles the same intent; no POST is retried.
External-chain intent remains discoverable after an instance restart; known terminal expiry prevents
an old preview from reviving. Storage failure blocks a new commit. Wallet listeners are installed
on restored sessions as well as fresh connection, and logout meets the JSON body guard.

Combined local browser checks passed26 inbox +28 batch checks; v7 redesign49 and v8 simplified18
regressions passed, as did build/types. Actual chain/public proof and synthetic presentation tests
remain distinguished in [TEST_REPORT](TEST_REPORT.md). Luma approval stays manual outside the app;
no Luma key, source, route or fetch was activated. No further visual polish was added.

## Historical original redesign integration


The primary core branch is `codex/core-application`. Integration anchors:

- Initial core: `28f2c3f50563a699a62bf9e4085f0aa6a7464828`.
- Backend review/journal/payment checkpoint: `b81607ac2bbb86973f3b48b9dd93c2beb756de32`.
- Integrated code: `52b66cc5687936cbdbb2eed3578105bb5b215d2d`.
- UI snapshot base: `a0bdecd636b3320e6cf81808c4fae4d9a37c6b95`.
- Delivered UI: `923f517fccdd0bddefbd9acaf5454309ee6c9ecf`, preserved locally as
  `refs/remotes/ui-handoff/redesign` after importing its self-contained local bundle.

The UI had separate snapshot ancestry because the original workspace was initially unborn.
The completed [UI_HANDOFF](UI_HANDOFF.md) was reviewed before integration. A scoped binary/three-way
patch applied only public UI/assets, UI tests, package scripts, ignore patterns and ui-registry.
The current core was not replaced with snapshot backend files. The server's small static-asset adapter
was applied manually: explicit asset allowlist, SVG/WOFF2 MIME types and binary-safe reads. Its new
bootstrap instance ID already existed in the current core. Canonical brain/test documents were retained
and updated instead of importing the UI snapshot copies.

## Accepted presentation

All four selected design areas are integrated: persistent stable event/deployment context; independent
participant facts and next actions; guided source/exception/consequence review; and payout/case/owed
obligation status. Fonts/logos preserve supplied bytes, provenance and licenses. The delivered desktop,
mobile, keyboard/dialog, enlarged-text and async-safety checks remain part of verification.

## Core interface integration

- Import review now obtains a server-owned preview and commits its opaque token with explicit source
  provenance review. The exact received CSV text, owner/session/event/deployment/source/config/state
  are revalidated atomically. The client exception table is presentation, never an admission oracle.
- Sent shows successful direct attendance payments from canonical event logs. Principal returns,
  claims, held shares, owed credits and Court funds remain distinct. The projection deliberately does
  not claim complete native transfer history. The former `Unavailable` test was replaced by comparison
  with actual emitted Payout events and the expected local 0.01 ETH normal share.
- Actual matching controls Court IDs and operations. Resolved unmatched attendance cannot inherit
  another event's resolver case0. Finalized does not freeze pending-case settlement or imply all funds
  were delivered; normal release is offered only while Listed and after its required windows.
- Wallet submissions use a durable journal scoped to server instance/environment/event/chain/contract/
  ABI/wallet. A failed persistence probe stops a new wallet request; a post-submission failure preserves
  its hash. Pre-hash UI guards remain. No transaction is automatically rebroadcast.
- Submitted transactions can be factually reconciled after the same wallet authenticates again or a
  review expires, using captured exact transaction terms and a canonical post-review receipt. This
  never restores old signing authority. Manual receipt verification also clears matching pending
  deposit references, allowing legitimate fresh deposits after an actual return.
- Canonical reverted receipts are terminal failed states, not successful deposits or permanently pending
  intentions. They remain visible and do not block another eligible reviewed action. Unknown transport
  outcomes remain explicitly unresolved. Separate tests cover these cases.
- Delayed event-detail results are checked against their generation before updating shared context.
  Captured event/wallet callbacks cannot overwrite another event's view, settings, review or submission.

## Independent findings and verification

[UI_INTEGRATION_REVIEW](UI_INTEGRATION_REVIEW.md) records the independent review, reproduced defects
and their regression tests. Actual combined results are in [TEST_REPORT](TEST_REPORT.md) and
`artifacts/final-verification.log`. Source UI test results are historical handoff evidence; they are
not substituted for checks on this integrated application.

The final combined command completed successfully: build/typecheck,91/91 Node tests and browser suites
with39 lifecycle,49 redesign,16 safety and4 context assertions, plus interaction/expectation checks.
A fresh archive of integrated commit52b66cc also passed offline installation, build and typecheck.

No further visual polish was added. New changes after the handoff are interface wiring, financial
truthfulness, transaction recovery and demonstrated race corrections. No production deployment,
provider write, real Court case, real message or upstream push occurred.

Native walletless registration, durable production auth/storage, content RLS staging rehearsal and
authorized live deployment remain the documented operational boundaries. Configured Luma free
participation and retained content links stay explicit; no simulated registration success was added.
