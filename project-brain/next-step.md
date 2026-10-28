# Resume here

Read the canonical [PROJECT_BRAIN](../PROJECT_BRAIN.md), then [TEST_REPORT](../docs/TEST_REPORT.md).
The parallel Option B UI handoff has been integrated by the core owner; review
[UI_INTEGRATION](../docs/UI_INTEGRATION.md) and [CORE_HANDOFF](../docs/CORE_HANDOFF.md) for source commits
and authoritative interfaces. Integrated source commit `52b66cc5687936cbdbb2eed3578105bb5b215d2d`
passed build/typecheck,91 Node tests and108 browser assertions plus interaction checks. A fresh archive
install/build/typecheck also passed. The local exercise and combined integration are complete.
The local exercise code is in `src/`, `public/`, and `references/kickback/`; run the root README commands
to seed a fresh two-event demo. It resets on restart. Financial logic is the preserved v7 contract.

The user requested Netlify hosting and selected the **full interactive demo**. It is now
[live](https://kleros-event-workbench-preview.netlify.app), using Netlify's frontend/gateway and one
persistent Railway backend. Deployed v7 source: `371b4c80b0c65ce7b7f571ca41d9f85c8720660b`, branch
`codex/core-application`. Netlify deploy `6ae2154852ea8b5634d56e84` is ready; Railway deployment
`2186138d-9268-4ec8-8ab9-575c76067ca7` is healthy. The actual Linux image compiled with pinned artifact
equality. Local verification passed build/typecheck,121 Node tests and143 browser assertions;
**370 live acceptance checks** then passed with actual synthetic A/B deposits, isolated admission,
secure sessions, signed EOA deposit/reconciliation and mobile layout. See
[HOSTED_DEPLOYMENT](../docs/HOSTED_DEPLOYMENT.md) and its linked public evidence.

The hosting request is complete. Preserve the accepted shared state; do not automatically rerun the
fresh-seed live financial test, rebroadcast or reset the backend. Shared identities intentionally allow
demo impersonation, ETH is valueless, Court is mocked, and state resets on backend restart. The separate
concurrent v8 experiment in the shared worktree was preserved and excluded from deployment. The earlier
read-only deployment remains an immutable rollback artifact in
[NETLIFY_DEPLOYMENT](../docs/NETLIFY_DEPLOYMENT.md). No mainnet write, real guest import, external message,
upstream push or billing upgrade was performed or newly authorized.

The next development phase is persistent production auth/projections and authorized staging integration,
following [RUNBOOK](../docs/RUNBOOK.md). Rehearse private migrations and a local mainnet fork before a
concrete rollout review. Booth migration is separate and its retained queue/consent defects remain.
No external action is authorized by these notes. No recurring automation was created.
