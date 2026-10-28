# Parallel Option B UI handoff

Prepared 28 October 2026. The primary implementation session retains final integration ownership. This is a presentation change to the existing local v7 workbench, not a replacement application or a production rollout.

## Isolation and starting point

- UI branch: `codex/kleros-ui-redesign`.
- UI worktree: `/private/tmp/kleros-ui-redesign`.
- Starting commit: `a0bdecd636b3320e6cf81808c4fae4d9a37c6b95`.
- Shared Git metadata lives in the separate snapshot repository `/private/tmp/kleros-ui-snapshot-20261028/.git`.
- Source inspected: `/Users/hashmanansala/Documents/ChatGPT/Kleros projects`, unborn `main`, no `HEAD`, all application source uncommitted. The only listed worktree was that original directory.
- Because an unborn repository cannot supply a worktree base, its available source was copied into a separate local snapshot repository and committed there. Dependencies, generated runtimes/builds and Git metadata were excluded. A normal `git worktree add -b codex/kleros-ui-redesign` then created this UI worktree. The desktop managed-worktree tool could not accept the snapshot repository as a source outside its configured workspace; the separate local Git worktree avoids changing the original repository.
- No branch, reset, stash, commit, source file mutation, merge or push was performed in the primary session’s directory. Other-session progress was not assumed or incorporated after the snapshot.

## Implemented changes and files

- `public/index.html`, `public/styles.css`, `public/assets/`: selected dark plum/lavender system, original supplied SVGs, Instrument Serif/Geist/Geist Mono, exact font binaries with OFL notices and provenance; responsive layouts, mobile record tables, visible focus, primary targets and reduced motion.
- `public/app.js`: persistent selected event / full deployment / version / policy / verified deadline and snapshot; safe event switch; independent participant facts and one next action; free-route explanation and configured Luma link; retained content associations and personal history; guided source→exceptions→consequences→explicit apply; authoritative money and case presentation; appeal dates/costs; pending browser-wallet references; keyboard tabs, dialog containment and focus restoration.
- `public/reconciliation.js`: pure presentation parser and row-level source review. It retains every row, displays blocked mismatches/duplicate evidence, and explains outside-pool rows. New receipt hashes remain unverified pending server checks. It does not write registration, financial eligibility or attendance.
- `src/server.mjs`: **small presentation integration adapter only**. Exact static allowlist for the new helper, SVGs and fonts; correct SVG/WOFF2 MIME types and byte-preserving reads; existing server `instanceId` added to bootstrap. No financial, authentication, authorization or import mutation rules changed.
- `test/reconciliation.test.mjs`, `test/ui-runtime.test.mjs`, `test/ui-redesign.e2e.mjs`, `test/ui-safety.e2e.mjs`: parser/exception/authority boundaries; exact binary assets and per-server IDs; responsive, keyboard, review, event switching and real local contract behavior.
- `test/app.e2e.mjs`: existing full lifecycle checks adapted to the deliberate three-stage import flow, new wording and actual mobile home link. It additionally checks no mutation before either approval and direct server rejection of wrong-event input.
- `KLEROS_REDESIGN_HANDOFF/qa/browser-check.mjs`: two harness corrections, without editing the prototype: use exact event selector rather than ambiguous label match, and enter keyboard modality before asserting focus-visible. Assertions remain intact.
- `package.json`: `test:ui` and `test:ui:safety` commands; `verify` also runs both UI suites.
- `.gitignore` and `artifacts/`: isolated generated prototype outputs, actual command logs, updated regression screenshots, selected exact viewport screenshots and raw QA reports.
- `ui-registry.md`, `PROJECT_BRAIN.md`, `docs/TEST_REPORT.md`, this file: selected patterns, isolated branch reference, actual evidence and integration guidance.

Contracts, ABI/policy/template/deployment snapshots, finance/domain adapters, schemas, migrations, private access policy and retained applications are unchanged. Demo identities, local time controls and Court mocks remain explicitly local utilities; no prototype simulator was copied into application authority.

## Existing interfaces and assumptions

The UI consumes existing `/api/bootstrap`, event detail, participant/admission/check-in, atomic `/imports`, transaction draft/validation/execution/confirmation and case/evidence/appeal APIs. Existing hash navigation and vanilla Node ESM/static frontend remain.

- Stable `event.id` is the scope; `event.contract`, `chainId`, `contractVersion`, `abiVersion`, `policyURI`, `claimDeadline` and `depositDeadline` come from the existing trusted deployment projection.
- `participants` exposes only rows authorized by the server. Admission, verified receipt, `registered`, `attended` and `owedWei` remain separate. Staff observations use the event-scoped `attendance` projection; self-reported history has no financial authority.
- Case states are the actual `Waiting`, `Disputed`, `Resolved` strings. Waiting challenges have no Court IDs even though the current adapter serializes zero placeholders. A `finalRuling` of 0 is a final refused result, not missing data. Resolved unmatched acceptance does not require a final matched resolver ruling.
- Money cards use exact `heldBackWei`, `owedTotalWei`, `challengeEscrowWei`, `reservedWei`, balance and counts. The sent total is unavailable unless a separately defined authoritative transfer projection is supplied. It is never estimated from balance changes. Appeal costs/deadlines come from resolver data; no illustrative fee or payout amount is used.
- Reviewable imports are local previews of the exact CSV bytes. Before applying, the UI re-reads current event detail and compares the on-chain fingerprint plus participant/observation/import/event projection, event, wallet and view generation. Existing POST validates receipts/identity/provenance/owner/duplicates atomically again. Superseded file reads cannot overwrite a newer choice or leave a stale preview actionable; source bytes are checked at both review and commit. No source rows are silently excluded or rewritten. Financial registration and posting remain separate transaction reviews.
- Transaction drafts retain existing fresh simulation, value/wei, recipient, policy, expiry and server validation. Unresolved wallet intents are saved **before** requesting a signature and are replaced with returned hashes after submission, scoped in `sessionStorage` by origin and **server instance**, and each reference includes stable event and wallet. Event/wallet switches clear unsigned reviews but retain submitted references. A verified matching receipt clears its pending marker. Unresolved wallet intents and unconfirmed references block a duplicate action even after a dialog is closed or the event is switched. Known wallet rejection clears the intent; an ambiguous outcome remains explicitly unresolved. If storage is unavailable, in-flight guards and references survive SPA navigation in memory for the current page; a persistence guarantee cannot be claimed in that browser mode.
- New bootstrap `instanceId` is a random, non-secret runtime identifier already present internally in the server. It is required to preserve pending references without mixing restarted deterministic local chains. If the primary session relocates static hosting, route the listed assets there and retain equivalent server-instance scoping.

## Remaining integration dependencies

1. **Authoritative money sent and individual payout delivery.** The existing detail API does not expose cumulative successful transfers or a normalized per-wallet delivery ledger. Supply receipt-backed totals and per-wallet payout/refund/challenge/top-up/claim breakdowns, each scoped by event, deployment, server and canonical chain position. Define which successful transfer kinds belong in “sent”; never use pool-minus-balance. Current UI honestly says “Unavailable” / “No failed-transfer credit” and never infers completion from Finalized.
2. **Wallet-free registration.** This local backend requires an authenticated wallet for a new participant record. The public free route remains visible without connecting; it links to configured Luma registration, or explains that no wallet-free service is connected. Existing approved free guests remain outside the pool. A native email-only request service needs the primary session’s identity/access design. No fake registration success or anonymous authorization was added.
3. **Server-generated import preview / commit token.** The current API has one atomic validate-and-apply call, so the independent UI supplies a clearly labeled client preview and fresh read. A fully authoritative exception list before mutation needs a server preview returning immutable source/config hashes, authoritative receipt decisions, excluded reasons, revision/snapshot and an expiring owner/event-bound token. Commit must accept that expected revision/token atomically. The UI cannot close the final race between its fresh GET and the existing POST without this interface. Proven mismatches are blocked locally and by the current server; stale transaction drafts remain server-enforced.
4. **Retained content application.** Talks, calendar/search, recordings, private materials and Q&A stay in `references/events` and its existing deployment. Optional configured `contentUrl` links preserve access without inventing a root content API. Root workbench directory capabilities are retained. This session did not migrate or revalidate the separate content database/application.
5. **Production services.** Auth persistence, guest provider credentials, durable evidence publication, live Court, hosting and production migration remain primary-session work. Local evidence is explicitly local; all tests use synthetic people and valueless local ETH.

## Validation

| Command | Result in this worktree |
| --- | --- |
| `npm ci --ignore-scripts` | Passed; isolated dependencies. |
| `npm run build` | Passed; pinned v7 compiler equality retained. |
| `npm run typecheck` | Passed. |
| `npm test` | 47/47 passed, 0 skipped. |
| `node --test test/ui-runtime.test.mjs` | Additional 2/2 passed (added after the full run started). Current glob contains 49 tests, all covered across these two runs. |
| `npm run test:browser` | 39 assertions plus full lifecycle interactions passed. |
| `npm run test:ui` | 48 assertions plus Playwright expectations passed. |
| `npm run test:ui:safety` | 15 async-safety assertions plus Playwright expectations passed; no transaction broadcast. |
| `node KLEROS_REDESIGN_HANDOFF/qa/browser-check.mjs` | 59/59 passed after two harness-only fixes. |
| `git diff --check` | Passed. |

The browser suites use both requested viewports, keyboard focus/tab handling, actual 200% text enlargement and real local v7 execution. No external requests, uncaught page errors or failed font/script/style/image responses were observed; an intentional unavailable-state response and retry were tested. Exact viewport screenshots and the raw redesign result are in `artifacts/screenshots/ui-redesign/`. Primary and visual agents inspected desktop/mobile/default/enlarged captures.

Expanded results, command logs and earlier failed attempts are in `docs/TEST_REPORT.md`. Initial sandboxed local-chain attempts could not bind loopback and were rerun with approved local-listener execution. Ganache used its supported JavaScript fallback on this Node ABI; the Node suite also emitted a MaxListeners warning. Neither prevented the passing run. Initial prototype harness failures and real dialog/text-overflow findings were fixed and retested. Historical project counts are not counts from this session. This session did not run live services, screen-reader auditing, the separate content-app suite, a mainnet fork or a redundant legacy Solidity suite; no contracts changed.

## Review and integrate

Do not automatically merge this branch into the primary session. These commits belong to a separate snapshot repository because the original branch was unborn.

1. Read this file, then inspect `git -C /private/tmp/kleros-ui-redesign diff a0bdecd636b3320e6cf81808c4fae4d9a37c6b95 HEAD --stat` and the diff. Inspect the narrow `src/server.mjs` adapter and map it onto the primary session’s latest implementation.
2. A binary patch and self-contained Git bundle are exported to `/private/tmp/kleros-ui-delivery/`. The patch contains only changes after the snapshot; it does not replace the whole source tree. Keep both temporary repositories/worktree until integration or copy the delivery directory to durable project storage under the primary session’s control.
3. In a primary-session-owned integration branch/worktree with its current changes recorded, use `git apply --check /private/tmp/kleros-ui-delivery/kleros-ui-redesign.patch` before applying. Resolve conflicts against the **latest** primary interfaces; do not reset its working tree or overwrite files wholesale. The primary session may instead fetch the local bundle and review/cherry-pick the UI commit after its own source has a real baseline.
4. Install/run only in the integration worktree: `npm ci --ignore-scripts`, `npm run build`, `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run test:ui`, `npm run test:ui:safety`. The root `verify` command includes these checks. Rerun contract/provider/privacy checks if integration changes their behavior.
5. Review at 1440×900 and 400×800, including actual enlarged text, import exceptions, keyboard/dialog use, event switching and open held shares. Verify service gaps above remain honest.
6. To preview this independent copy without using the primary session’s ports: `PORT=3107 RPC_PORT=19547 npm run demo` from `/private/tmp/kleros-ui-redesign`, then open `http://127.0.0.1:3107`. This starts a new isolated local runtime; previous test data is not persisted.

No deployment, upstream push, live transaction, production migration, real message, public IPFS write or merge was performed.
