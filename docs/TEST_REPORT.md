# Verification report

Verified locally on 28 October 2026 at integrated source commit
`52b66cc5687936cbdbb2eed3578105bb5b215d2d`, branch `codex/core-application`.
The delivered UI source was `923f517fccdd0bddefbd9acaf5454309ee6c9ecf`; its compatible changes were
integrated against the newer core, with the adaptations in [UI_INTEGRATION](UI_INTEGRATION.md).

Tests use synthetic contacts/wallets and localhost Ganache. No production transactions, real Court
cases, guest submissions, emails, live database migrations, public IPFS writes or upstream pushes
were performed. Node25.8.1/npm11.11.0 were observed on macOS arm64. Ganache used JavaScript fallbacks
for unavailable native bindings. Those warnings did not prevent the passing runs below.

## Final combined application checks

`npm run verify` completed with exit0 on the integrated source. Its complete output is preserved in
[`artifacts/final-verification.log`](../artifacts/final-verification.log).

| Check executed by `verify` | Result |
|---|---|
| `npm run build` | Passed: original v7 compilation, pinned ABI/bytecode equality and application syntax checks. |
| `npm run typecheck` | Passed for the checked JavaScript and TypeScript interfaces. |
| `npm test` | **91/91 passed**, zero skipped/failed, 370.2 seconds. |
| `npm run test:browser` | **39 assertions passed**, plus browser wait/interaction checks. |
| `npm run test:ui` | **49 assertions passed**, plus Playwright expectations. |
| `npm run test:ui:safety` | **16 assertions passed**, plus Playwright expectations; no wallet transaction broadcast. |
| `npm run test:ui:context` | **4 assertions passed**, plus Playwright expectations. |

The four browser suites total108 explicit assertions, plus their interaction/expectation checks.
The main desktop/mobile images are `artifacts/demo-desktop.png` and `artifacts/demo-mobile.png`.
Additional local viewport screenshots are under ignored `artifacts/screenshots/ui-redesign/`.
The core owner visually inspected the integrated desktop participant and mobile organizer views;
the UI suite also checks 400px mobile, desktop, keyboard/dialog behavior and enlarged text.

The Node and lifecycle browser tests execute unchanged v7 bytecode and inspect actual successful or
reverted local receipts, state, payment logs and ETH balances. V1 mocks supply adjudication only.
The tests cover:

- Two deployments with distinct owners, deposits, schedules and pools; one wallet participates in both.
- Event roles, private/draft recovery access, two-step financial ownership and authenticated staff scope.
- Canonical receipts, wrong deployment/amount/time/sender, duplicates, principal/stray return pairing,
  unmatched deposits, fresh readmission and separate admission/registration.
- Server-owned import previews, exact-byte source hashes, expiry/session/revision binding, atomic
  commit, duplicate evidence and known event/chain/contract/participant mismatch rejection. Unknown
  raw CSV origin remains an explicit organizer trust assumption.
- Personal attendance, merch and consent having no financial authority.
- Normal payouts with open cases and held reserves; late losses/top-ups, late winners, both settlement
  orders, ruling0/1/2 and independent EventB progression. Tested equal-entitlement fixtures use exact
  divisibility; retained contract tests additionally cover rounding and reserve accounting.
- Unmatched challenges using their own matching period without borrowing resolver case0; correct
  resolver-local versus arbitrator IDs, evidence, appeal funding/rewards and finality/override behavior.
- Cancellation, no-list emergency withdrawal, duplicate recovery refusal, failed recipients and
  alternate-destination owed claims.
- Exact expiring transaction reviews, one-use execution, stale context rejection, canonical submission
  confirmation, durable hash journaling, terminal reverts and factual receipt recovery after re-login
  or review expiry. Recovery never restores old signing authority or automatically rebroadcasts.
- Delayed event responses and captured transaction callbacks preserving the newly selected event;
  failed storage probes stopping new wallet prompts, and post-submission errors preserving the hash.
- Exact-byte local evidence publication/retry and per-event policy/participant aliases.

These results supersede the earlier37-test core checkpoint and bounded integration runs. Earlier
failures were reproduced, fixed and covered in the final run; they are not outstanding failures.
Ganache emitted a MaxListenersExceededWarning while many independent events were deployed. The
finite checks passed; this does not certify unbounded production process resource behavior.

## Reproducible setup and retained Kickback compatibility

A fresh `git archive` of integrated commit52b66cc in
`/private/tmp/kleros-integrated-clean.tXU1Ra` passed `npm ci --ignore-scripts --offline --no-audit --no-fund`,
`npm run build` and `npm run typecheck`. It installed363 packages with only root dependencies; no
nested reference node_modules, user handoff directory or machine-global JavaScript packages were copied.

The earlier clean `/private/tmp/kleros-clean.6VRQLU` copy also passed installation/build/typecheck and
the complete retained compatibility suites using root-installed ethers6.16.0/Playwright1.58.2:

| Executed in the clean copy | Result |
|---|---|
| `npm --prefix references/kickback test` | **54/54 passed**: contract, script and provenance checks; 253.4 seconds. |
| `npm --prefix references/kickback run test:site` | **180/180 passed**. |
| `npm --prefix references/kickback run test:console` | **159/159 passed**. |

The initial clean contract run exposed a sequential nonce-cache failure (53/54). NonceManager fixed
the failing sequence (targeted2/2), then the complete suite passed54/54. The initial clean console
attempt exposed a nested ethers UMD path assumption and stopped before financial actions; resolving
the package from the root dependency tree fixed it. Final logs are `/private/tmp/kleros-clean-contracts-final.log`,
`/private/tmp/kleros-clean-site.log` and `/private/tmp/kleros-clean-console.log`.

The deployed Solidity, historical policy/template, deployment records and verification inputs remain
preserved. Compiler output must match the pinned v7 artifact. No fresh mainnet-fork execution or
current live deployment verification is claimed.

## Retained content and booth modules

`references/events` retains source base `fa732b8ea20e57648516b6e46e1076c0bf2ab434`. All14 migrations
were read in order and effective final policies inspected; see [EVENTS_AUDIT](EVENTS_AUDIT.md).

| Command in `references/events` | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000` | Passed;80 packages installed. |
| `npm run typecheck` | Passed. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` with backend/AI environment unset | Passed after network access for declared Google Fonts; no backend credentials used. The sandbox-only attempt first failed DNS. |
| `npm run lint` | Failed: interactive ESLint setup, no declared ESLint dependency/config. This retained module has no reproducible lint gate. |

No Supabase CLI/disposable database was available; migrations and live RLS/storage/auth behavior were
not executed. Existing private-event/material/assistant controls remain in the linked module. That
limitation is separate from passing workbench role/privacy tests.

The booth remains unchanged and outside finance. Three VM tests execute legacy queue/tier functions
with fake fetch and synthetic payloads. They reproduce demo-origin queues flushing after a config
switch and promotional client reports affecting merch progression. These are retained legacy defects,
not fixes. The financial application never loads those queues or uses merch/newsletter state for payouts.

## Operational limits

This is a loopback local demo with ephemeral chain and projections, explicit identity impersonation
or verified EOA nonce linkage, and mock Court adjudication. General smart-wallet/UserOperation identity,
production auth/persistence, staging content RLS/migrations, public IPFS publishing and a fresh mainnet
fork remain external work. Dependency audit advisories remain in the development stack. No remote
CI or production rollout has been run. Follow [RUNBOOK](RUNBOOK.md) for the next authorized phase.
