# Verification report

Local verification on 28 October 2026. Tests use synthetic contacts/wallets and localhost Ganache. No production RPC transactions, Court cases, guest submissions, emails, live database migrations or upstream writes were performed. Node v25.8.1 / npm 11.11.0 were observed on this machine; Ganache used its JavaScript fallbacks when native bindings were unavailable. Those warnings did not prevent the passing runs below.

## Current application

| Check | Executed result |
|---|---|
| `npm run build` | Passed in the root agent's implementation run; final build is recorded below when rerun. |
| `npm run typecheck` | Passed in the root agent's implementation run; final check is recorded below when rerun. |
| `node --test --test-concurrency=1 --test-timeout=30000 test/http.test.mjs` | **7/7 passed** in 14.7 seconds after the final configuration-window and draft-privacy changes, including concurrent independent servers, private/draft event routes, sessions, nonce signatures, request origin/Host validation and event-scoped compatibility views. |
| `test/workbench.test.mjs` within the final `npm test` | **25/25 passed** using actual local EVM state/receipts. Earlier runs and focused reproductions identified bugs that were repaired and covered by this final run. |
| Focused deployment-corruption regression | **1/1 passed** for wrong chain, contract, ABI version and immutable deposit terms. |
| Focused unmatched-deposit regression | **1/1 passed** for independent event ledgers, spare ETH return and reserved principal protection. |
| `npm test > /tmp/workbench-final.log 2>&1` | **34/34 passed**, 0 skipped, in 246.4 seconds: 25 Workbench integration tests, 6 HTTP tests and 3 retained-boundary reproductions. One HTTP draft-privacy test was added afterwards; the complete latest HTTP suite then passed 7/7. The current tree therefore contains 35 distinct Node tests, covered across those two runs. An intermediate HTTP assertion failed on `new URL(relativePath)` without a base; the corrected test resolves local URLs against the origin. |

The Workbench integration tests execute unchanged v7 bytecode and inspect successful receipts, contract state, emitted payment events and real local ETH balance changes. Mock V1 Court controls supply adjudication outcomes only. Tests prove:

- Two deployments with different organizers, deposits and schedules; one wallet participates independently in both.
- Authenticated staff are event-scoped; attendee contacts and private events are access-controlled.
- Known event/chain/contract/participant-ID mismatches cannot be relabeled by manual provenance review; unknown raw CSV origin remains an explicitly recorded organizer trust assumption.
- Personal history and merch payloads have no financial effect. Deposit evidence, admission, registration and door evidence remain separate.
- Normal payouts proceed with matched cases open; held reserves grow after losses and pay late winners. Both mixed settlement orders produce equal cumulative attendee entitlements in the tested exact-divisibility fixtures. Ruling 0 excludes the challenger and splits only the remaining challenge deposits.
- Event B continues while A has open cases; cancellation, no-list recovery, expired unmatched acceptance, duplicate recovery refusal and alternate-destination failed-payment claims use actual contract paths.
- Drafts bind event/wallet/deployment/snapshot, are single-use, and revalidate authoritative state. New regressions cover historical transaction confirmation, expiry and concurrent import admission changes.

The tests exercise a finite local demonstration, not production authentication, distributed persistence or a live Court integration. Browser extension signing is a real wallet nonce path on the local chain; the demo identity picker is explicitly simulated authentication.

## Retained Kickback compatibility module

The Kickback worker reported these final local runs. The root agent received the results; logs are local temporary diagnostic artifacts.

| Command in `references/kickback` | Result |
|---|---|
| `npm test` | **54/54 passed**: 36 contract, 11 script and 7 provenance tests; reported duration 277.6 seconds. Log: `/tmp/kickback-final.log`. |
| `npm run test:site` | **180/180 checks passed**. Log: `/tmp/kickback-site-updated.log`. |
| `npm run test:console` | **159/159 checks passed**. Log: `/tmp/kickback-console-final.log`. |

The deployed v7 Solidity and recorded historical policy/deployment inputs are preserved. The local suites cover held shares, reserves, rounding, failed transfer recovery, final V1 rulings and appeal logic. No live mainnet fork or production deployment verification is claimed here.

## Existing content application

`references/events` remains at the handoff HEAD `fa732b8ea20e57648516b6e46e1076c0bf2ab434`. All 14 migrations were read in order and effective final policies inspected. See [EVENTS_AUDIT.md](EVENTS_AUDIT.md).

| Command in `references/events` | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000` | Passed; 80 packages installed. |
| `npm run typecheck` | Passed. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` with backend/AI environment unset | Passed after granting network access for declared Google Fonts; no backend credentials used. Sandbox-only attempt first failed DNS. |
| `npm run lint` | Failed: interactive ESLint setup, no declared ESLint dependency/config. This retained reference has no reproducible lint gate. |

No Supabase CLI was available and no disposable database was started. No migrations or live RLS/storage/auth tests were executed. The existing private-event/material/assistant boundaries are retained as a linked module; production migration state is unknown. This limitation is separate from passing local Workbench role/privacy checks.

## Retained booth boundary

The booth remains unchanged outside finance. Three VM-based tests execute legacy queue/tier functions with fake fetch and synthetic payloads. They reproduce that demo-origin queues can flush after a configuration switch and that merch progression accepts promotional client reports. These are retained legacy risks, not fixed behavior. The new financial application neither loads those queues nor consumes merch/newsletter state as payout authority.

## Latest full verification

The final consolidated Node run passed 34/34; the subsequent latest HTTP suite passed 7/7 after adding exact compatibility-window assertions and the editorial-draft recovery/privacy scenario. The latter run supersedes the six-test HTTP subset from the consolidated run. The Workbench result includes event-specific ERC-1497 policy/alias validation and exact-byte repeatable local publication.

Temporary logs: `/tmp/workbench-final.log` and `/tmp/workbench-http-final.log`. Ganache emitted a MaxListenersExceededWarning while the suite deployed many independent events. It did not fail tests or change asserted outcomes; this report does not certify unbounded long-running event creation or production process resource behavior.
