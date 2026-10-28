# Resume here

Read the canonical [PROJECT_BRAIN](../PROJECT_BRAIN.md), then [TEST_REPORT](../docs/TEST_REPORT.md).
The parallel Option B UI handoff has been integrated by the core owner; review
[UI_INTEGRATION](../docs/UI_INTEGRATION.md) and [CORE_HANDOFF](../docs/CORE_HANDOFF.md) for source commits
and authoritative interfaces. Integrated source commit `52b66cc5687936cbdbb2eed3578105bb5b215d2d`
passed build/typecheck,91 Node tests and108 browser assertions plus interaction checks. A fresh archive
install/build/typecheck also passed. The local exercise and combined integration are complete.
The local exercise code is in `src/`, `public/`, and `references/kickback/`; run the root README commands
to seed a fresh two-event demo. It resets on restart. Financial logic is the preserved v7 contract.

The user subsequently requested online Netlify viewing. A clearly read-only
[preview](https://kleros-event-workbench-preview.netlify.app) is deployed from source `8e1c59e`.
Its34 browser assertions passed locally and against the live site. See
[NETLIFY_DEPLOYMENT](../docs/NETLIFY_DEPLOYMENT.md) for update commands and exact deployment provenance.
It has captured synthetic data and no hosted API/chain, wallet or personal-data entry. Full interactive
online operation needs a persistent backend and explicit HTTPS/RPC adapters.

Latest steering: the user chose **full interactive demo**. The explicit hosted-demo server/gateway,
shared sandbox UI and unique chain-instance signing guards are implemented and locally tested.
The full verification passed build/typecheck,121 Node tests and143 browser assertions plus expectations.
Railway authentication is pending after an expired existing login.
Continue [HOSTED_DEPLOYMENT](../docs/HOSTED_DEPLOYMENT.md), deploy the closed backend context, configure
runtime secrets privately, then replace the Netlify frontend only after backend health. Run the prepared
live acceptance test before declaring the full application online. Keep the verified read-only link
available until then. No mainnet write, live guest import, external message or upstream push is authorized.

The next development phase is persistent production auth/projections and authorized staging integration,
following [RUNBOOK](../docs/RUNBOOK.md). Rehearse private migrations and a local mainnet fork before a
concrete rollout review. Booth migration is separate and its retained queue/consent defects remain.
No external action is authorized by these notes. No recurring automation was created.
