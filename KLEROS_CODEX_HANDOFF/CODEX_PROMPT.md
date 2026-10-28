# Codex Handoff Prompt

Use this prompt with PROJECT_BRAIN.md in the same workspace or attached to the task.

---

You are taking over my final Kleros engineering exercise. Kleros has asked me to continue, improve, and finish the project represented by these repositories:

1. https://github.com/weiwei-ooi/devcon-side-event-kickback
2. https://github.com/weiwei-ooi/kleros-events
3. https://github.com/weiwei-ooi/kleros-devcon-checkin

My main goal is a usable, maintainable multi-event product with reliable event deposits, attendance verification, Kleros disputes, and payouts.

**You are explicitly allowed to rebuild or consolidate the project if that makes it simpler to finish and maintain.** Compare a focused refactor, a unified application built from the existing events app, and a clean new application/monorepo. Choose and document the best approach, then carry the work through implementation and testing. You do not need to ask permission for routine architecture choices, local development changes, or a justified rebuild.

Read the attached PROJECT_BRAIN.md first, then verify its findings against the current repositories. It contains a source-grounded review from 28 October 2026, including commit IDs, current behavior, known gaps, recommended architecture, and acceptance criteria. Update it when newer source or implementation decisions supersede it.

## 1. Understand the existing system before changing it

The repository review established these facts:

- devcon-side-event-kickback already implements native ETH deposits on Ethereum mainnet and attendance disputes through Kleros Court V1 using the Dispute Resolver / ArbitrableProxy and KlerosLiquid.
- It records a live v7 contract deployment. Preserve compatibility with that deployment; source edits cannot upgrade it in place.
- It already allows normal payouts while matched disputes remain open, using reserved held shares and later redistribution.
- kleros-events already supports multiple content events, private/public access, recordings/materials, live Q&A, and Luma public metadata synchronization.
- Its “I was there” attendance record is user-declared personal history.
- kleros-devcon-checkin is a separate booth lead and merchandise application using static frontend code, Apps Script and Google Sheets. Its public form, visual ticket and merch progression are not financial attendance evidence.
- Kickback uses Luma guest/check-in CSV exports. The events site's public metadata sync is a separate integration.
- The supplied apps are not already a complete unified system.

Read repository instructions, README files, Kickback's CLAUDE.md and REVIEW.md, its attendance policy, relevant scripts/contracts/tests, and the complete effective migration history. Older notes refer to Wei Wei and her devices/accounts; treat those as project history, not my identity or authorization to use those resources.

Inspect current branches, commit IDs and local changes. Preserve existing user work. If one repository is mounted, read or obtain the other accessible repositories in clearly separated reference directories. Do not let a missing live credential stop unrelated implementation.

## 2. Make an architecture decision and implement it

Evaluate:

A. Extend the three repositories with explicit adapters.
B. Use the existing Next.js/Supabase events app as the foundation for a unified product.
C. Build a clean application or monorepo, reusing the existing contracts, domain logic and useful components where appropriate.

Compare time to a complete working flow, maintainability, regression risk, migration work, testability, hosting and operational complexity. Record a short decision in docs/ARCHITECTURE_DECISION.md and proceed.

My starting preference is one coherent interface and shared event model with clear modules for event content, financial commitments and verified check-in. Separate per-event contracts with a trusted versioned deployment registry are a sensible baseline. Choose another approach if the code review provides a concrete reason.

A unified experience can retain existing media/Q&A or booth services as linked modules. Identify what is retained, migrated, integrated and deferred. Preserve user data, access rules and useful existing capabilities through the chosen transition. Avoid spending the exercise recreating unrelated recording, AI or marketing features.

## 3. Required product behavior

### Event management

- Create and manage multiple independent events.
- Give each event a stable identity, display slug, schedule/timezone, organizer permissions and optional Luma association.
- Associate financial events with the correct chain, contract, deployment block, contract/ABI version, deposit amount, deadlines and immutable policy/template.
- Keep editorial visibility/status separate from registration and financial lifecycle.
- Support events with free participation and optional committed spots.
- Scope every route, cache, import, job, local-storage entry and transaction draft to the correct event.

### Participant experience

- Browse/select an event and understand its location, timing, participation choices and deposit rules.
- Connect the appropriate wallet and see the selected event, network, contract and exact amount before signing.
- Show actual transaction states, verified deposit/admission status, trusted attendance status and the next available action.
- Preserve participant access to attendance challenges, evidence, appeals, refunds, held-share outcomes and failed-transfer claims as supported by the selected contract version.
- Support one wallet/person participating in several events independently.
- Keep email identity, wallet identity and attendance evidence explicitly linked; do not infer ownership from a pasted address alone.

### Organizer experience

- Select an event and see only actions their role and wallet can perform.
- Import and review guest/deposit/check-in data, duplicates, errors, refunds and unmatched deposits.
- Review a proposed attendance list and payout calculation before signing.
- Preserve registration, rejection/refund, organizer correction, challenge matching, settlement and cancellation/recovery workflows.
- Make event, network, contract, policy and action consequences visible at transaction time.
- Refresh/revalidate authoritative contract state before signing and invalidate stale drafts when event or wallet changes.

### Verified attendance

Personal “attended” history, booth lead submissions, newsletter confirmation, a static QR visit and client-reported merch progression must not authorize payouts.

Preserve the current Luma CSV/manual-door-list route as a functioning baseline. If adding integrated staff check-in, make it authenticated, event-scoped, replay-safe and linked to a verified participant. Record the evidence source and reviewer. Marketing consent remains optional and separate.

## 4. Preserve the financial and dispute behavior that already exists

Use the current deployed v7 behavior as the compatibility baseline:

- Native ETH and Ethereum mainnet for that existing deployment.
- Owner-curated staker registration backed by the verification workflow; a deposit log alone does not automatically register someone.
- One-day omitted-attendee challenge window and separate one-day matching period.
- Anyone can match; expired unmatched challenges count as attended.
- Matched cases use the existing V1 resolver and final ruling.
- Ruling 1 means attended; ruling 2 means absent; ruling 0 keeps the participant excluded and splits the remaining challenge deposits.
- Evidence and appeal operations must use the correct resolver local ID versus arbitrator dispute ID.
- Appeal contributions go directly to the resolver from the contributor's wallet.
- Preserve per-case metaevidence, policy linkage and publish/retry behavior.
- Preserve held-share payouts while matched cases remain open, later top-ups, reserve accounting, integer rounding and failed-payment recovery.
- Preserve the exact supported cancellation and no-attendance-list emergency withdrawal conditions.

Do not replace the held-share algorithm with a blanket payout freeze or invent different ruling-0/refund rules as an incidental refactor. If a genuinely better future contract model is needed, isolate it as a new version, explain the behavior change, and prove the accounting and compatibility with tests.

Keep existing deployment records, policy CIDs and verification inputs. Never use a new global ABI indiscriminately for older contracts. Do not assume current token-return support means ERC20 event deposits are implemented.

## 5. Prioritize these observed gaps

1. **Cross-event import contamination.** Some action JSON already contains contract/chain/deposit stamps, but verified.csv, claims.csv and raw check-in inputs lack reliable event provenance. A wrong-event CSV can be relabeled into a plan for the selected contract. Bind intermediates to stable event/deployment identity and source hashes; validate available source-event metadata. Where a raw export lacks verifiable event identity, require an explicit organizer provenance review and disclose that limitation. A hash alone does not prove source origin. Manual review cannot override a proven event/contract mismatch, duplicate financial evidence or a stale transaction plan.
2. **Single-event presentation/configuration.** Public page copy, default Luma links and metaevidence contain Truth Pays-specific wording. Generate correct per-event content while preserving the historical live event.
3. **Versioned deployments and permissions.** Introduce clear contract/ABI dispatch, trusted address configuration, event-specific owner checks and stale-state protection.
4. **Reproducible development/testing.** Kickback browser tests depend on undeclared/global Playwright setup; the events/booth repos lack a meaningful automated test baseline in the inspected tree.
5. **Booth isolation if migrated.** Current localStorage, queues, email/Telegram uniqueness and dashboard exports are not consistently event-scoped. Fix server validation and the dashboard's conflation of merch handover with newsletter confirmation.
6. **Existing privacy/security work.** Preserve current Supabase RLS, private-event access, materials privacy and assistant access controls. Inspect later migrations before declaring an older behavior an unfixed issue.

Verify these findings against current HEAD and reproduce failures where possible. Separate confirmed defects, intentional trust assumptions, and untested risks.

## 6. Work sequence

1. Produce a concise current-state audit and baseline test report.
2. Establish safe local/demo configurations and synthetic fixtures.
3. Decide the architecture, create the implementation plan, and start building.
4. Complete the event registry/domain and two-event isolation.
5. Complete registration/deposit verification and trusted attendance.
6. Complete current-contract settlement/dispute/refund UX.
7. Integrate the necessary events and check-in surfaces.
8. Add focused regression, authorization and end-to-end tests.
9. Finish setup, migration, operation and demo documentation.

Keep working after the audit and plan. Use parallel tasks for independent reviews or components when available, with clear ownership of edits. Send concise progress updates describing findings, decisions, verified behavior and remaining blockers.

## 7. Development and production boundaries

Inspect scripts and endpoints before running them. The committed Kickback rehearsal uses real Ethereum mainnet ETH and can open a real court dispute. The booth configuration points to a live Apps Script endpoint. Some Supabase migrations alter auth records and private storage.

Use local chains, compatible V1 mocks/local forks, a disposable database and synthetic data for development. Default to no external writes. Build a usable local demo when production credentials are unavailable.

Namespace queued work by environment and event. The booth demo blocks immediate sending but can retain signup/lead payloads; those must never become eligible for live delivery after a configuration change. Quarantine incompatible legacy queues and test that transition with mocked network requests if changing the booth module.

Do not broadcast real financial transactions, open a live dispute, deploy to production, change DNS/hosting, migrate a live database/Sheet, submit real guest records, send signup emails/messages, or publish upstream changes without explicit authorization. Prepare the implementation, tests and concrete rollout plan first. These boundaries should not interrupt ordinary local development.

Never expose secrets, private keys, admin bearer tokens, real guest information or personal contact data in logs, fixtures, commits or generated documentation. Keep trusted public deployment addresses distinct from credentials.

## 8. Acceptance tests

At minimum, demonstrate:

- Two concurrent events with different organizers, deposits, schedules and contract identities.
- One wallet participating independently in both.
- Correct rejection of cross-event artifacts, wrong chain/contract and unauthorized staff actions.
- Clear handling of raw attendance imports whose event origin cannot be verified automatically.
- Self-reported attendance and merch state having no financial effect.
- Confirmed deposits and admission decisions producing correct registered stakers.
- A challenge in Event A, normal payouts with a reserved share, and a final attended/absent/refused outcome applied correctly.
- Mixed late winning/losing cases settling in different orders without violating equal cumulative entitlements or reserves, apart from documented rounding.
- Event B continuing normally while A has an open case.
- Cancellation/no-list recovery, duplicate-claim rejection and failed-transfer recovery.
- No production writes or real messages from automated tests.
- Existing v7 deployment compatibility and preservation of event/content privacy.
- A reproducible clean setup, build/typecheck/test run and mobile-friendly organizer/attendee flow.

Use existing meaningful tests and add tests for changed behavior. Do not replace real contract/integration verification with hardcoded successful UI states.

## 9. Deliverables and project memory

Deliver:

- Working source code and a runnable local demo with at least two seeded events.
- A concise architecture decision and migration/compatibility plan.
- Updated README with exact setup and verification commands.
- Meaningful tests and actual results.
- A short two-event demo script.
- A runbook for organizer operations, recovery and future deployment.
- Updated PROJECT_BRAIN.md with current decisions, completed work, blockers and next actions.

Maintain a single canonical brain in the active workspace/project root; link to it from repository-specific guidance. Keep source maps, implementation tasks and test results in linked docs as useful.

Finish by explaining what works, the chosen architecture, changed repositories/components, commands actually run, their results, compatibility with the existing deployment, and any external step that still requires credentials or authorization. Distinguish fully implemented behavior from mocks, deferred modules and production rollout work.

Start with repository inspection and safe baseline checks, then proceed with implementation.

