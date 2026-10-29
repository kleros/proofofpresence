# Organizer timeout + wallet feedback repair LIVE — 29 October 2026

The human’s Review event setup request was cut off after29942ms (Railway origin499; browser504).
They confirmed the error occurred BEFORE MetaMask opened. No wallet transaction was requested by
that Review click. An unsigned review may have persisted after the disconnect; all state is preserved.
The observed cutoff does not establish a general fixed Netlify plan limit.

Repair LIVE at https://kleros-luma-ethereum.netlify.app. Branch codex/core-application.
Frontend source9cac8df641ec0d3d8ac66531bfaa48936282e4f5, Netlify production
6ae34f33c420d0953a515606. Backend4028e8c04b490507ddef2b2899ceadd0713ac1fe, Railway
30d0d598-a118-46c3-b523-0f9858e7a8e6 SUCCESS/health200. Published appa61e10c9,
CSS38ff0705 and widget829d8c31 are exact source matches. Anonymous jobs GET returns401; catalog
is200 metadata-only. Proof: artifacts/mainnet-release/organizer-jobs-live-readback.json, SHA256
74d844f3fb984f66f814241a32dd27eb2ee5fb33196e9c64b8b0d4397ae664b8. No human tab was refreshed, real event posted or wallet requested.

Prepare, validate and known-hash reconcile use authenticated background jobs: fast202 reserves the
original session/wallet/factory/instance/request ID before unchanged verification runs. GET polls
without RPC or rerun. IDs remain consumed, foreign/revoked sessions disclose no result, active/capacity
limits fail closed. Validation ready expiry is at most5s and capped to underlying draft expiry; the
client checks it again immediately before eth_sendTransaction, then consumes the deadline so a human
wallet prompt can remain open safely. Lost ACKs resume GET-only; only explicit unsigned-check
abandonment can prepare again. Receipt retries keep the SAME hash and cannot resend a transaction.
ALL full source/history/canonical/EOA/governance/simulation, sender and once-journal guards remain.
No src/factory-onboarding, workbench financial, upgrade verifier or transaction sender change.

The combined UI also fixes blank content during wallet authentication: stable loading skeleton,
persistent error/retry, operation epochs, duplicate-connect guard and explicit reload for changed
server context. Date defaults/manual edits remain correct. Root70 unit/HTTP, type/static build,
10 combined async-enabled auth/feedback browser groups passed; widget3 and date8 groups passed.
Two combined mobile loading/error screenshots inspected. Evidence: organizer-jobs-combined-checks.json,
organizer-jobs-backend-checks.json, setup-wallet-feedback final13-47-35 and organizer-jobs-ui final13-45-16.
The combined harness archived a stale390aac prose limit; its actual asset pins prove829d8c and the
current harness corrects only that sentence. No passing test result or archived bytes were rewritten.

Human should use a fresh setup tab, keeping the old form to copy terms, reconnect and select Review
event setup. The human alone can retry authenticated mainnet review/confirm; no real created event,
financial cycle or jury outcome is claimed by the repair. Source/interface/deployment details:
docs/ORGANIZER_SETUP_REPAIR.md; current machine pointer mainnet-portal-release.json.
A/B/C retired incomplete/PAUSED, D complete, E unused. No billing upgrade/upstream push/policy upload.

NEXT SEPARATE AUTHORIZED PHASE: UI human turn01a187e9-f8f2-7eb3-a3cb-c5ada8012f6d explicitly asks
frontend + duplicate-RPC optimization first, free plans/transaction checks intact, coordinate withCore
and updateNetlify after testing. Finish this repair checkpoint before new writes. UI owns lean-home
entry/app modules; Core owns backend read audit, integration and sole public/RPC profiling. Never
cache closing/current-authority/latest/chain-ID/EOA/slots or cross bootstrap→draft→validate boundaries.
Only equivalent SAMEphase/snapshot in-flight sharing may be considered; no completed mutable trustTTL.
No optimization source edits yet. Read-only audit found few guaranteed safe duplicates; do not invent
a genericprovidercache or trade away history coverage to claim a speedup.

## Interfaces

POST /api/organizer/events/jobs accepts exact requestId +operation with prepare input(sixterms),
validate draftId, or reconcile draftId/hash. GET /jobs/:requestId is owner/session-scoped and returns
pending/ready/failed/expired. Ready result preserves the prior API DTO and includes expiresAt.
Server capability organizerJobs:true gates the client; historical/demo fixtures keep direct behavior.
POST /drafts/:id/submitted remains the exact original hash report. No new signer/server transaction
path exists. App-only job markers use a separate origin/instance/factory/wallet/operation/payloadSHA
namespace and never clear transaction journals. Old API compatibility remains available.

Closed source-only packages: backend-context-jobs-clean.json116files; frontend-context-jobs-clean.json
38trackedfiles+exact headers, both artifacts/mainnet-release. No private/runtime/untracked files uploaded.
