# Kleros Event Workbench

A unified local application for independent event deposits, reviewed admission, trusted check-in,
V1 Court challenges, held-share settlement and recovery. The local demo executes the original
v7 Solidity on Ganache. Court adjudication uses explicit V1 mocks.

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

For online viewing, the separate [Netlify target](docs/NETLIFY_DEPLOYMENT.md) builds a clearly labeled
read-only preview from synthetic local contract snapshots. The interactive application still uses
the local runtime above; the preview does not accept deposits, wallet connections or personal data.

```sh
npx playwright install chromium
npm run verify           # build, types, Node integration, lifecycle/UI/safety/context browser checks
npm run test:contracts   # unchanged-v7 accounting + enhanced script/provenance checks (~5 min)
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
