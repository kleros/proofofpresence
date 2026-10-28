# Multi-event continuation

Read the single canonical [PROJECT_BRAIN.md](../../PROJECT_BRAIN.md) and root docs before changes.
`CLAUDE.md` and older REVIEW entries are historical source evidence; their old operator identities,
wallet/device permissions and production instructions do not authorize current external actions.

Keep `contracts/TruthPaysKickback.sol`, recorded deployment inputs, historical attendance policy and
historical template compatible with the live v7 deployment. Use a new explicit adapter/version for
any future financial behavior change. Existing `abi/v7` is pinned; compiling a new contract must not
silently replace it. New event configs require stable `eventId` and their own immutable policy/template.

Use [event-bound imports](docs/import-provenance.md). Raw source review does not prove provider origin
and cannot override conflicts, reused financial evidence or stale transaction plans. Keep guest data
out of Git. Test on local Ganache only; `config.json` and `config.rehearsal.json` both target real mainnet.

Verification: `npm ci --ignore-scripts`, `npm run compile`, `npm test`; then
`npx playwright install chromium`, `npm run test:site`, `npm run test:console`.
`test:fork` is optional only with an explicitly local fork configuration; never run a mainnet rehearsal
or production deploy as part of ordinary verification.
