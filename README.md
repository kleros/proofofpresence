# Kleros Event Workbench

A unified local application for independent event deposits, reviewed admission, trusted check-in,
V1 Court challenges, held-share settlement and recovery. The local demo executes the original
v7 Solidity on Ganache. Court adjudication uses explicit V1 mocks.

[Open the full interactive demo](https://kleros-event-workbench-preview.netlify.app).
Netlify serves the interface and gateway; one persistent Railway backend runs the unchanged v7 demo.
Choose a synthetic demo identity to try deposits, admission and event workflows. ETH has no value,
Court rulings are mocks, and shared chain/session state resets on backend restart.

The deployed source is `371b4c80b0c65ce7b7f571ca41d9f85c8720660b` on `codex/core-application`.
All **370 live acceptance checks** passed. [HOSTED_DEPLOYMENT](docs/HOSTED_DEPLOYMENT.md) records
source/deployment IDs, checks and operating limits.

The new [v8 event factory](docs/EVENT_FACTORY_V8.md) creates isolated event contracts with payer-bound
credits, independent recovery and bounded admission. It is a locally tested deployment candidate;
the existing workbench and historical deployments continue to use v7. See the
[contract security review](docs/SMART_CONTRACT_SECURITY_REVIEW.md) for findings and remaining trust boundaries.

## Simpler v8 workflow and Chiado rehearsal

The new release adds one clear next action, a four-step participant journey and expandable technical
facts. Exact transaction review and financial isolation remain authoritative. Run `npm run demo:v8`
to use actual factory-created v8 contracts locally; the historical v7 default stays available.

The controlled Chiado rehearsal uses chain10200 and testXDAI, signed wallets and a separate trusted
registry. It has no identity impersonation or time controls. Public deployments and staged commands
are in [TESTNET_REHEARSAL](docs/TESTNET_REHEARSAL.md); the latest source/checkpoint and current cloud
status are in [V8_APP_RELEASE](docs/V8_APP_RELEASE.md). Real public challenge windows last one day.

## Run

Requires Node **22.15 or later**, npm, and a browser. Verified here on Node 25.8.1 / npm 11.11.0 /
macOS arm64; Ganache uses its JavaScript fallback on that Node ABI. No wallet keys or service
credentials are needed. Run from this directory:

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm run demo
```

Open [the local app](http://127.0.0.1:3000). Choose a clearly labeled local demo identity.
Two seeded events have different organizers, schedules, contracts and 0.01/0.02 ETH commitments.
Alice, Bob and Carol have separately linked registrations in both. Door staff A has authority only
in A. The optional browser-wallet flow verifies a signed nonce, adds the local chain, and offers an
explicit local-only faucet. Every financial action requires a review and an actual EVM receipt.

**This is a local demo runtime:** it binds loopback only, uses valueless ETH, resets chain and
off-chain state on restart, and cannot load a mainnet write registry. Generated compatibility
pages are isolated under `.runtime/<server-instance>/<event-id>/`. No live Supabase, Sheets,
Ghost, Telegram, Luma guest API, IPFS publication or Court service is connected. Local evidence
storage is labeled `local-only`; a CID alone is never reported as a successful public pin.

## Verify

The [interactive hosted demo](docs/HOSTED_DEPLOYMENT.md) uses the same authoritative v7 application.
The earlier [read-only Netlify target](docs/NETLIFY_DEPLOYMENT.md) remains an immutable rollback artifact.
Live acceptance checks made actual synthetic deposits and verified sessions, isolation and mobile layout.

```sh
npx playwright install chromium
npm run verify           # build, types, Node integration, lifecycle/UI/safety/context browser checks
npm run test:contracts   # unchanged-v7 accounting + enhanced script/provenance checks (~5 min)
npm run test:contracts:v8 # new factory, payer-credit, gas and arbitration regressions
npm run stress:contracts # seeded v8/factory stress; saves isolated per-run evidence
npm --prefix references/kickback run test:site
npm --prefix references/kickback run test:console
```

Root dependencies supply the compiler, ethers, CSV parser and test browser to the retained modules;
no global Playwright installation is required. The separate content app has its own dependency lock:

```sh
npm --prefix references/events ci --ignore-scripts
npm --prefix references/events run typecheck
npm --prefix references/events run build
```

That build fetches Google Fonts. Its existing lint command requests interactive ESLint setup and is
not a working unattended gate. No database migration is needed to run the workbench. See the actual
results and limitations in [TEST_REPORT](docs/TEST_REPORT.md), not historical README test counts.

## Implementation and retained modules

| Location | Responsibility |
|---|---|
| `src/chain.mjs`, `registry/` | Trusted version dispatch, immutable deployment checks, atomic on-chain snapshots |
| `src/workbench.mjs`, `src/imports.mjs` | Event roles, linked wallet identities, receipts/returns, reviewed CSVs, drafts and actions |
| `src/server.mjs`, `public/` | Local authenticated HTTP API and responsive participant/organizer interface |
| `references/kickback/` | Retained v7 Solidity, guest/owner tools, improved scripts, pinned ABI, tests and deployment history |
| `contracts/`, `src/contracts-v8.mjs` | New isolated v8 event/factory contracts and explicit future-deployment adapter; separate compiler/artifacts |
| `references/events/` | Retained Next/Supabase content, recordings, private materials, Q&A and public Luma metadata sync |
| `references/booth/` | Retained separate booth marketing/merch source; **never launched with its live config by this demo** |

The architecture comparison and transition are in [ARCHITECTURE_DECISION](docs/ARCHITECTURE_DECISION.md).
Reference sources are vendored directories, not submodules: a clean root checkout includes the changed
Kickback code. [SOURCES.json](references/SOURCES.json) records exact upstream bases; original cloned
Git metadata is preserved locally under ignored `.runtime/source-history/`. No upstream history changed.
Existing content and booth data remain in their original systems. Owner-controlled optional
`contentEventId`/`contentUrl` and `lumaEventId`/`lumaUrl` associations link them without granting access
or allowing metadata sync to rewrite financial terms. Financial attendance never reads personal
history, merch, newsletter consent or booth queues.

The historical mainnet deployment at `0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D` remains untouched.
Its policy, historical template, verification inputs and Solidity are preserved; build verification
requires the compiler output to equal the pinned v7 ABI/bytecode. It cannot be upgraded by source edits.

## Operate and demonstrate

- [DEMO](docs/DEMO.md): reproducible two-event walkthrough.
- [RUNBOOK](docs/RUNBOOK.md): imports, admission, attendance, disputes, payouts, recovery and rollout.
- [REPO_AUDIT](docs/REPO_AUDIT.md): current source and verified findings.
- [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md): completion evidence and external work.
- [API](docs/API.md): local endpoint contracts and error behavior.
- [UI integration](docs/UI_INTEGRATION.md): delivered Option B source, preserved core interfaces and combined review.
- [PROJECT_BRAIN](PROJECT_BRAIN.md): **canonical project memory**; the original handoff is historical input.

The npm audit report retains inherited Ganache/bundled dependency advisories. This runtime is an
isolated development harness; production hosting requires replacing demo impersonation and memory
storage, resolving the deployment dependency surface and rehearsing the authorized migration plan.
No production readiness or fresh mainnet-fork certification is claimed.
