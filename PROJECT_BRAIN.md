# Current implementation — 28 October 2026

This root document is the **single canonical project brain**. The original supplied review is retained
below as historical source material; this section and linked current docs supersede its implementation
recommendations and unexecuted-test statements.

## Active workspace and decision

- Workspace: `/Users/hashmanansala/Documents/ChatGPT/Kleros projects`; root Git began as unborn `main`.
  Latest hosted implementation checkpoint `25c4797ea3475bb8e0a58c529ead0b62b8a6802d` is on
  `codex/core-application`; the integrated UI baseline is `52b66cc5687936cbdbb2eed3578105bb5b215d2d`.
  no upstream push or live financial/data write was made. A separate read-only Netlify viewing target
  is now published as recorded below; the financial backend remains local.
- All three fetched `main` heads exactly match the original review. Source bases and packaging are
  recorded in [references/SOURCES.json](references/SOURCES.json). Reference trees are vendored,
  not gitlinks; original cloned metadata is preserved locally under ignored `.runtime/source-history/`.
- **Option C selected and implemented:** a small coherent Node ESM finance/check-in workbench using
  unchanged v7 per-event contracts. The existing Next/Supabase content/media/Q&A application and booth
  marketing service are retained separately. See [ADR](docs/ARCHITECTURE_DECISION.md).
- Primary source: `src/`, `public/`, `registry/`; enhanced compatibility source: `references/kickback/`.
  Canonical mapping uses stable IDs independent of slugs, optional Luma/content IDs and explicit version
  dispatch. Editorial status, registration status and on-chain phases remain distinct.

## Implemented local behavior

- Two synthetic events with distinct owners, schedules, deposits, contracts, staff permissions and
  independent pools. One wallet participates in both. New local events and owner settings are usable.
- Explicit demo identity sessions or cryptographically signed EOA nonce authentication; declared email
  linked to the authenticated wallet, never a pasted-address ownership inference.
- Receipt/log/chain/contract/amount/time-window/canonical-block/duplicate/return verification, curated
  admission and registration, unmatched/return ledger, approved free participation outside pools.
- Reviewed raw imports with immutable identity/source/config hashes, known-mismatch rejection,
  no foreign participant-ID fallback, atomic commit and explicit unverified-origin limitation.
- Event-scoped authenticated/replay-safe staff observations; personal history and merch/consent have
  no financial authority. Current active stakers are separated from historical rejected/readmitted records.
- Exact reviewed/simulated expiring transaction drafts bound to event, wallet, deployment and authoritative
  snapshot; refresh before signing. Confirmations cannot reuse old matching transactions.
- Real local v7 challenges/matching/corrections, evidence/appeal/rewards sent to resolver local IDs,
  normal payouts with held shares, late top-ups, ruling0/1/2, cancellation/no-list recovery, owed claims
  and ownership transfer. Mock V1 adjudication only; pool accounting is original Solidity.
- Responsive participant/organizer/cases UI, precise wei/value/recipient/policy review, local publication
  status and retry, event reconciliation, privacy and separate content/Luma associations.
- Kickback scripts have mandatory raw provenance review, bound intermediates, source/version snapshots,
  stronger stale-plan checks, generic per-event copy/templates and reproducible browser dependencies.

## Evidence and compatibility

Current executed commands/results are maintained in [TEST_REPORT](docs/TEST_REPORT.md) and the final
`artifacts/final-verification.log`; build, typecheck and a fresh archive install have passed. The final
integrated run passed **91/91 Node tests and 108 browser assertions** plus interaction checks. The retained
Kickback final suite passed54/54, guest checks180/180 and console checks159/159. Root Node and browser
final counts are in that report. Desktop/mobile screenshots are in `artifacts/`.

The recorded live mainnet contract, Solidity, historical policy/template/CID and verification inputs
remain unchanged. The pinned v7 artifact must equal compiler output. No current production state,
mainnet-fork execution or production migration status is asserted from local tests.

Independent review found and corrected event-ID overwrite, foreign-ID relabeling, partial-import commits,
excess-return misclassification, refunded-attendee leakage, blocked readmission, private ownership
acceptance, stale confirmation reuse, deposit cutoff and generated-config environment collisions.
The UI integration also corrected unmatched resolver case0 leakage, delayed event-response races,
lost/mis-scoped submission hashes, terminal reverted-receipt handling and same-wallet session recovery.

## Operating boundary and remaining work

The root server is **local-demo only**. Chain and off-chain projections reset on restart. Demo account
selection is intentionally impersonation; EOA wallet signatures are verified, but email ownership,
general smart-wallet signature/UserOperation linkage and production session membership/persistence
require a real deployment design. Existing contract-wallet recovery remains supported by v7 tools/tests.
Court rulings are mocks, local evidence storage is not public IPFS, and no real provider writes occur.

Existing events'14 migrations were read completely; build/typecheck pass and later privacy protections
are retained. Live/local DB migration/RLS execution was not performed. Its lint command remains an
interactive legacy setup. Booth queue/uniqueness/consent defects remain in the isolated booth; offline
VM tests reproduce them and no financial ingestion consumes that data. Dependency audit advisories
remain in the development stack; production dependency surface needs remediation.

Next external phase: use [RUNBOOK](docs/RUNBOOK.md) to choose persistent auth/hosting, rehearse content
mapping/private migrations in disposable staging, run a local mainnet fork, review future immutable
policies/deployments and prepare exact authorized production actions. No production credentials are
needed for the completed local exercise. No production action is authorized by this memory.

## Parallel redesign integration

The separate UI session delivered `923f517fccdd0bddefbd9acaf5454309ee6c9ecf` on
`codex/kleros-ui-redesign`. Its isolated snapshot history was imported and preserved locally; compatible
presentation/assets/tests were integrated at the code checkpoint above. The core owner reviewed its
[UI_HANDOFF](docs/UI_HANDOFF.md), retained the newer backend and financial interfaces, resolved races
and recovery gaps, and completed the combined verification. See [CORE_HANDOFF](docs/CORE_HANDOFF.md)
for routes/interfaces and [UI_INTEGRATION](docs/UI_INTEGRATION.md) for source anchors and adaptations.
No additional visual polish or upstream push was performed. The local exercise is complete; the next
phase is the explicitly documented production preparation above.

## Online viewing preview

At the user's request for Netlify viewing, a separate static target was added at source commit
`8e1c59e1058e844e18fe15d66c29e62131a492b5` and published at
[kleros-event-workbench-preview.netlify.app](https://kleros-event-workbench-preview.netlify.app).
This is clearly labeled **read-only**: saved synthetic local v7 projections, browser-only identity
selection, no wallet signing/data entry/API backend or hosted chain. A has paid ordinary attendees
with one held disputed share; B remains independent. The full local application is unchanged.

`npm run build:netlify` verifies actual local receipts and artifact equality, then closes its chain.
The static preview passed34 browser assertions locally and the same34 against the live HTTPS site,
plus Playwright expectations. Hosted snapshot bytes matched the tested artifact and security headers
were verified. Deployment IDs, commands and limitations are in
[NETLIFY_DEPLOYMENT](docs/NETLIFY_DEPLOYMENT.md) and `artifacts/netlify-deployment.json`.
Only generated public assets and synthetic snapshots were uploaded; no upstream repository, backend,
credentials, user attachment or existing financial deployment was published or modified.

Netlify Functions cannot preserve this application's current in-memory Node/Ganache state across
ephemeral invocations. A full interactive online version still needs a persistent backend and explicit
HTTPS/Host/wallet-RPC adapters. The preview is not a completed production authentication or hosting migration.

The user subsequently selected the **full interactive demo**. At implemented checkpoint `25c4797`,
the hosted backend, Netlify gateway,
secure sessions/public nonce domain, bounded signed RPC and unique demo-instance signing checks are
now implemented locally. The shared online notice explains intentional demo impersonation, valueless
ETH/mock Court and state resets. Financial contracts/domain rules are unchanged. Focused validation
passed7 hosted server tests,19 gateway tests,4 wallet-instance tests and35 real local HTTPS integration
browser assertions. The full verification then passed build/typecheck,121 Node tests and143 browser
assertions plus expectations. A closed production-dependency package also
built and served the advanced guest/console/settings routes. The gateway bundles successfully.
See [HOSTED_DEPLOYMENT](docs/HOSTED_DEPLOYMENT.md) for the concrete Railway/Netlify rollout.
Railway sign-in is pending because the existing login expired. No interactive backend is deployed yet;
the public Netlify link remains the verified read-only preview until full live checks pass.

## Navigation

[Audit](docs/REPO_AUDIT.md) · [Implementation record](docs/IMPLEMENTATION_PLAN.md) ·
[Tests](docs/TEST_REPORT.md) · [Runbook](docs/RUNBOOK.md) · [Two-event demo](docs/DEMO.md) ·
[API](docs/API.md) · [UI patterns](ui-registry.md) · [Next action](project-brain/next-step.md).

---

# Historical supplied review (superseded where noted above)

# Kleros Events and Kickback Project Brain

Prepared on 28 October 2026. Refresh the repository snapshot before implementation.
Purpose: give Codex a durable, source-grounded starting point for continuing, improving, and finishing the supplied Kleros project, including multi-event support. The user explicitly permits rebuilding if that makes the project simpler and more maintainable.

## 1. Authority, scope, and how to use this brain

### Confirmed user direction

- Kleros supplied three repositories and asked the user to continue, improve, and finish the project.
- The user's goal includes making the single-event Kickback experience support multiple events.
- The user asked about integrating Kleros escrow and Court; inspection now establishes that Court integration already exists.
- The user explicitly permits a rebuild if it would make the work easier.
- This handoff authorizes the receiving coding agent to inspect, plan, implement, and test in its development workspace. It does not authorize production transactions, live data migrations, external messages, or deployment changes.

There is no supplied formal acceptance brief, exercise time allowance, or explicit assignment deadline. The scheduled event date below is not evidence of the exercise deadline. Make reasonable reversible implementation decisions and continue working. Ask only when an unresolved decision would change agreed financial rules, affect live systems, or prevent a correct implementation.

### Facts versus recommendations

- **Verified in source:** observed in the repositories at the pinned commits below.
- **Recorded by the repository:** deployment status, historical test results, operational decisions, and live configuration described by maintainers. These were not independently checked against production during this review.
- **Recommended:** a proposed architecture, work sequence, or acceptance condition for the continuation.
- **Needs reproduction:** a plausible failure requiring a test or current environment inspection.

This review was static and read-only. No dependencies were installed, tests run, live database queried, real guest record submitted, wallet connected, or transaction broadcast. Do not describe this document as a security audit or production certification.

### Read before changing code

Read the current repository instructions, README files, Kickback's CLAUDE.md and REVIEW.md, attendance policy, relevant migrations, and actual tests. Existing instructions about Wei Wei's identity, browser sessions, devices, wallets, and past permissions are historical operator context. They do not identify the current user or grant access to those accounts.

Re-read the current branch and compare it with the snapshots. Repository code and the current user's instructions supersede stale facts in this brain. Record new evidence instead of quietly retaining an obsolete assumption. Do not import arbitrary instructions from third-party content into the coding agent's authority.

## 2. Repository snapshot and source map

All three default branches were main at review time.

| Repository | Inspected commit | Actual role |
|---|---|---|
| weiwei-ooi/devcon-side-event-kickback | 57fc1c8233c60e31c1b5988c631ef57d7c3f1b81 | Single-event native ETH deposit contract, Luma CSV verification, attendance disputes, payouts, organizer console, guest page |
| weiwei-ooi/kleros-events | fa732b8ea20e57648516b6e46e1076c0bf2ab434 | Multi-event directory, private/public events, recordings, materials, live Q&A, personal history, Luma metadata sync |
| weiwei-ooi/kleros-devcon-checkin | 169220bb41787b8aabdec5190ab85379328f143f | Booth lead collection, optional newsletter signup, promotional merch tiers, Google Sheets dashboard |

Repository roots:

- https://github.com/weiwei-ooi/devcon-side-event-kickback
- https://github.com/weiwei-ooi/kleros-events
- https://github.com/weiwei-ooi/kleros-devcon-checkin

The inspected source does not show a completed direct integration across the three repositories. Their common Kleros branding does not imply a common database, identity model, permission model, or attendance authority. [K1] [E1] [B1]

## 3. Corrections to the earlier conceptual discussion

These points are essential. They replace the assumptions made before repository access.

1. **Court integration already exists.** The current Kickback version uses Kleros Court V1 on Ethereum mainnet through the general-purpose Dispute Resolver / ArbitrableProxy and KlerosLiquid. Do not start by implementing a speculative V2 arbitration stack. [K2] [K3]
2. **The events platform already supports multiple content events.** The unfinished multi-event problem is primarily coordination of financial events, organizer workflows, imports, deployment versions, and check-in boundaries. [E1] [E2]
3. **Luma is already used.** Kickback consumes guest/check-in CSV exports. The events platform separately synchronizes public Luma event metadata. Neither fact establishes a unified authenticated guest API. [K4] [K5] [E4]
4. **The booth app is not the financial attendance authority.** Its static QR, public lead form, merch ticket, and client-reported progression are designed for booth operations. [B1] [B2]
5. **Personal attendance is self-reported.** The events site's “I was there” button writes a user's own attendance record. It must never directly authorize a monetary payout. [E3]
6. **Matched disputes do not block all event payouts in v7.** The contract has an existing held-share algorithm that reserves a full provisional share for each open case and redistributes later losses fairly. Replacing this with a blanket freeze would change documented behavior. [K2]
7. **There is a recorded live contract.** A source rewrite cannot upgrade this direct deployment in place. Old deployments need compatible tooling and immutable historical metadata. [K3]
8. **Rehearsal is mainnet.** The committed rehearsal configuration uses real ETH and can create a real Kleros case. Local tests and a local mainnet fork are the development routes. [K1] [K11]

## 4. Product objective and boundaries

### Recommended primary outcome

Deliver a coherent multi-event experience in which an organizer can manage several events independently and a participant can understand registration, commitment, verified attendance, disputes, refunds, and payouts for each event.

The essential flow begins with creating or selecting an event and associating its verified financial deployment and policy. Organizers then register or import participants, verify deposits, approve committed spots, and record trusted attendance. After reviewing and posting attendance, they handle challenges, release payouts with the correct reserves, settle remaining Kleros cases, and recover failed transfers.

Preserve non-deposit participation: the current Luma workflow has a committed spot backed by a refundable deposit and a separately approved free request-to-join path. Free guests do not enter the deposited reward pool. [K1]

### Required separation of concepts

| Concept | Current meaning | Financial authority? |
|---|---|---|
| Event content | Description, venue, program, recordings, public/private visibility | No |
| Personal “saved/going/attended” record | User's own event history | No |
| Booth check-in | Lead intake / merch workflow | No |
| Luma registration approval | Organizer's admission decision | Necessary input for current workflow, not a deposit by itself |
| Verified deposit | Successful on-chain receipt linked to the relevant wallet and event contract | Financial evidence, subject to current admission model |
| Verified attendance record | Trusted event-specific check-in or organizer-approved evidence | Input to the attendance proposal |
| Contract attendance/payout state | On-chain state after proposal, challenge rules, and final case outcomes | Authoritative for settlement |
| Newsletter consent/confirmation | Marketing preference and subscription state | Never |

Product roles should distinguish attendee, event content editor, door/check-in staff, financial organizer/contract owner, and platform administrator. A content role or confirmed team email must not automatically acquire wallet signing authority.

### Scope discipline with rebuild permission

A rebuild is permitted, not mandatory. Rebuilding the interface, shared domain layer, backend, or repository organization may be useful. Changing deposit economics, custody, arbitration rules, live policies, or current contract deployments is a separate decision.

A unified user experience need not rewrite every existing subsystem in its first release. A working recordings/Q&A platform can remain a linked module while a new event finance/check-in interface is completed. State which capabilities are retained, migrated, integrated, or deliberately deferred; do not silently remove them.

## 5. Kickback current implementation

### 5.1 Stack and important files

- Solidity 0.8.28, optimizer 200, EVM paris in the recorded deployment.
- Node ESM scripts with ethers 6, csv-parse, and pinned solc.
- Ganache-based contract and script tests.
- Static guest page built with a selected configuration.
- Local organizer console with browser-wallet signing.
- Luma CSV input and optional manual door-list CSV.
- No multi-event application database or event registry in the inspected implementation. [K1] [K6]

| Path | Purpose |
|---|---|
| contracts/TruthPaysKickback.sol | Custody, admission state, attendance, challenge/matching, held shares, refunds, claims |
| scripts/lib.mjs | Configuration, chain constants, CSV helpers, RPC scans, matching, metaevidence construction |
| scripts/verify-deposits.mjs | Guest CSV + transaction receipt/log verification + approval categorization |
| scripts/build-payout.mjs | Trusted check-in import matched to verified identities and current stakers |
| scripts/owner.mjs | Developer CLI for organizer actions |
| scripts/console.mjs and console/index.html | Local organizer interface |
| scripts/build-site.mjs and site/index.html | Public guest/deposit/case interface |
| docs/attendance-policy.md | Published juror policy for the existing event |
| docs/metaevidence.template.json | Case description template |
| deployments/truth-pays-mainnet/ | Recorded deployment and verification inputs |
| test/ | Existing contract, script, browser, and local-fork test suites |
| CLAUDE.md and REVIEW.md | Operational memory and prior review history |

### 5.2 Recorded deployment

The repository records this deployment; verify current on-chain state separately if needed for implementation. Do not infer current balances or active users from the record. [K3]

| Field | Recorded value |
|---|---|
| Chain | Ethereum mainnet, chain ID 1 |
| Event | Truth Pays: Devcon Mumbai 2026 |
| Contract | 0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D |
| Deposit | 0.01 ETH |
| Deployment block | 26290226 |
| Deployment time | 28 October 2026, 09:07:59 UTC / 16:07:59 Asia/Bangkok |
| Event start | 4 November 2026, 18:00 Asia/Kolkata / 19:30 Asia/Bangkok |
| Attendance-posting deadline | 18 November 2026, 18:00 Asia/Kolkata |
| Recorded source revision | 21b8f58, v7 |
| Arbitrator route | Kleros V1 Dispute Resolver → KlerosLiquid, General Court, three jurors |
| Upgrade model | Direct deployment; no upgradeable proxy in this contract |

The contract's claimDeadline is used for timely attendance posting and the no-list emergency withdrawal path. Do not rename it in the UI as a universal deadline for every claim or arbitrated case.

The event's policy and metaevidence template are fixed at deployment. Preserve the recorded policy CID and exact historical template for this contract. New events require their own policy/template data and verified deployment records.

### 5.3 Deposit and registration trust model

deposit() and receive() accept positive ETH while the phase is Open and emit Deposited. They do not enforce exactly one depositAmount, automatically register the sender, maintain a refundable per-wallet deposit ledger, or enforce every off-chain deposit cutoff.

The owner calls registerStakers after verifying deposits and Luma approval. The contract checks aggregate solvency for registered stakers. It does not independently prove that each named wallet supplied its own deposit. This is a documented trusted organizer model.

The verification scripts therefore matter: they validate sender, receiver, successful deposit logs, amount, timing, approval, duplicates, prior returns, and unmatched funds. Preserve these checks when extracting a service/library. An on-chain transfer must not be treated as an approved committed spot until the workflow says so. [K2] [K4]

Unregistered payers currently rely on organizer return tooling. Registered stakers have specified refund and emergency-withdrawal paths. A future self-service registration or per-wallet ledger design is possible, but it is a versioned behavior change, not a transparent UI refactor.

### 5.4 Current attendance and dispute lifecycle

Contract phases are Open, Listed, Finalized, and Cancelled. Finalized does not mean every matched Kleros case has finished.

- Owner posts a nonempty list of registered stakers through postAttendance(list, expectedShare), after eventStart and by claimDeadline.
- expectedShare must agree with the contract's pool and initial attendance count.
- A one-day challenge period opens.
- A registered omitted staker can challenge, depositing the current arbitration fee.
- A separate one-day matching period starts for that challenge.
- Anyone can match it, paying the matching amount.
- The two deposits finance the exact current arbitration fee, with a guard against that fee exceeding both deposits combined.
- An expired unmatched challenge is accepted as attended and its challenge deposit is returned.
- The organizer can correct omissions during the challenge window while they are not in an already matched dispute.
- A matched dispute is decided through the existing V1 resolver and appeal process. The event contract's resolveChallenge reads the resolver's final isRuled and ruling. It does not implement a direct V2 rule callback. [K2]

Current ruling policy:

| Ruling | Attendance result | Remaining challenge deposits |
|---|---|---|
| 1, Attended | Participant becomes an attendee | Challenger receives the remainder after arbitration cost |
| 2, Did not attend | Participant remains excluded | Matcher receives that remainder |
| 0, Refused to arbitrate | Same attendance treatment as absent | Remainder split between challenger and matcher |

Do not invent a principal-refund fallback for ruling 0. The current deployed policy already specifies its treatment. [K2] [K7]

Evidence, appeal contributions, and appeal rewards use the external resolver. Preserve the distinction between the arbitrator dispute ID and the resolver local dispute ID. Appeal payments go directly from the contributor's wallet to the resolver so it credits the actual contributor. Do not route them through an application custody wallet.

Per-case ERC-1497 metaevidence names the event, depositing wallet, organizer, contract, and policy. The contract constructs the immutable text and computes its CID; the interface publishes the matching bytes. A computed CID is not proof that those bytes are available on IPFS. Maintain publication failure/retry visibility.

Historical fee and duration figures in README/CLAUDE.md are not current quotes. Query the relevant deployed resolver/arbitrator for live fees and deadlines; do not hardcode old ETH prices or convert them into promises.

### 5.5 Held-share settlement must survive the rebuild

Once the challenge window closes and no challenge is still waiting for a match, payouts can proceed even while matched cases are unresolved.

Let:

    P = depositAmount × stakerCount
    A = currently established attendees
    O = matched, unresolved cases
    S = floor(P / (A + O))

The contract pays S to each established attendee and reserves S in each open case's heldShare.

When a case later wins, the participant receives that case's complete accumulated heldShare and joins the attendee set. When a case loses or is refused, its held share is split among established attendees and still-open cases. Existing attendees receive a top-up, while open cases' heldShare increases.

For example, a 100-unit pool with eight established attendees and two unresolved cases initially pays/reserves ten units per person/case. A losing case redistributes its ten units across the nine remaining eligible-or-potential shares. A later winner receives its increased reserved amount. All eventual attendees receive the same cumulative payment, subject to integer rounding. The order of mixed case outcomes is explicitly covered by existing tests. [K2] [K10]

The invariant to preserve is:

    reserved =
      (registered pool while Open/Listed, otherwise heldBack)
      + owedTotal
      + challengeEscrow

Spare refunds and sweeps cannot consume reserved funds. Failed recipient payments become owed balances; they must not block everyone else's payout. Claims can use an alternate destination. Appeal money is outside this accounting.

The current implementation uses bounded-stipend batch payments and was designed/tested around approximately 150 guests. Multi-event support does not establish unlimited capacity per event. Preserve a tested capacity or separately implement and verify scaling.

### 5.6 Current corner cases to represent accurately

- Zero attendees cannot be posted; the system uses cancellation/no-list recovery rules instead of dividing by zero.
- Cancellation operates while the event is Open under its deadline rules.
- Registered stakers can emergency-withdraw after the deadline if no list was posted.
- This emergency path is not a generic override of a pending arbitrated case.
- Matched cases have no generic timeout that permits bypassing a final Kleros ruling.
- Returning accidentally sent ERC20 tokens does not mean token-denominated event deposits are supported.
- A claim means collecting an owed failed transfer in some interfaces; distinguish that from the ordinary batch-paid entitlement.
- Two-step ownership transfer exists; reflect pending/current owner state if exposing it.

### 5.7 Observed multi-event gaps

These are source-observed gaps in the current single-event application, rather than proof of failures in production:

- **Configuration and presentation:** scripts already support selected configurations/output directories, but normal defaults still target one event. The guest page, fallback Luma link and metaevidence contain event-specific wording. A multi-event change must parameterize these while retaining the live event's historical policy. [K8] [K12]
- **Input provenance:** new-stakers.json and refunds.json already carry contract, chain, deposit, block and generation stamps. However, verified.csv, claims.csv and raw attendance inputs are not bound to an event. build-payout.mjs stamps its result with the currently selected deployment even when a source file came from another event. Preserve existing output checks and add source-event validation before plan generation. [K4] [K5]
- **Version selection:** tooling assumes one current compiled contract/ABI. Future versions need explicit dispatch so a new ABI cannot silently replace the interface used for an older deployment. [K14]
- **Reproducibility:** no CI workflow or pinned Node engine was found in the inspected tree, and browser tests rely on undeclared/global Playwright setup. Establish a clean-checkout test path before treating the baseline as reproducible. [K6]
- **Operational history:** the project memory and review contain completed work alongside outstanding/stale checklist entries. Reconcile these with current evidence; do not report prior fixes as new defects or historical test counts as fresh results. [K9] [K13]

## 6. Events platform current implementation

### 6.1 Already functioning product surface

The repository contains a Next.js 15.5.28 / React 19.1.1 / TypeScript 5.9.2 application backed by Supabase. It includes multiple events, private-event collaboration, a recordings/materials archive, recording and slide tooling, transcripts, live questions and moderation, projector/QR views, personal event history, meeting requests, and a site assistant. [E1] [E2] [E5]

Most mutations use the authenticated Supabase client and PostgreSQL row-level security. Next route handlers handle files, auth callbacks, AI and transcript operations. There is no separate Express deposit backend.

Fourteen migrations are present. Later migrations supersede earlier definitions. Inspect the resulting schema and latest definitions rather than auditing only 0001_init.sql.

### 6.2 Attendance and Luma boundaries

AttendanceButtons.tsx permits the signed-in user to upsert saved, going, or attended for themselves. This is personal history. Add a distinct verified attendance/financial eligibility model if needed. [E3]

LumaSync.tsx invokes sync_luma() and sync_feed(). The latest inspected sync_luma definition is in 0012_private_events_round2.sql. It uses public api2.luma.com metadata, hard-coded host identifiers, and an initial 50-result limit for upcoming/past discovery. It does not import private guests, check-ins, wallet ownership, or deposits. [E4] [E6]

Recommended improvements when touching the adapter:

- Separate metadata sync from verified guest/check-in ingestion.
- Move host mappings into explicit configuration.
- Add pagination if complete history is a requirement.
- Validate response shapes and preserve prior usable data on upstream errors.
- Preserve privacy/ownership guards that prevent public sync from resurrecting private events.
- Keep imported editorial metadata from mutating financial terms after deposits begin.

### 6.3 Access and migrations

Confirmed team email and private-event creator/collaborator membership are material authorization boundaries. A team member or global content admin is not automatically allowed to read every private event. Keep server/database enforcement even if the UI hides actions.

The latest 0014_security.sql and related code already include important hardening: assistant usage limits, private question votes, projector moderation, private materials storage and access-controlled file URLs. Do not report superseded initial policies as current unfixed defects. Whether production has applied the latest migration is unknown. [E7]

That migration also changes auth records, including stored password handling, and documents rollout sequencing. Review and rehearse it before applying any upgrade. supabase/config.toml expressly prohibits pushing its local configuration to the live project because local auth URLs would break production sign-in. [E8]

### 6.4 Observed gaps relevant to this task

- No financial event association in EventRow: chain, contract, version, financial lifecycle, and policy references must be modeled explicitly.
- No wallet ownership or verified monetary attendance layer in the inspected app.
- No automated test files or CI configuration found in the inspected main tree.
- package.json has typecheck/build and next lint, but no test script or declared ESLint setup. Verify lint behavior before treating it as a gate.
- Date fields and optional human-readable timezone/start_time values are insufficient as sole financial deadline inputs. Use canonical timestamps plus IANA timezone.
- A possible transcript-job race needs reproduction if that subsystem is changed; do not expand this task into a transcript rewrite without a concrete dependency.

## 7. Booth check-in current implementation

### 7.1 Existing behavior worth preserving

Static HTML/JavaScript uses Google Apps Script and Google Sheets, with optional Ghost newsletter signup and Telegram membership checking. It has local retry queues, client IDs for idempotency, staff lead/merch views, matching rules, hot-lead intake, formula-injection protections, and printed QR assets. [B1] [B2] [B3]

The newsletter checkbox is optional. Repository notes say the waiting gate was turned off for Devcon; live Script Properties were not inspected. Do not turn marketing consent into an admission or deposit entitlement condition.

X/LinkedIn steps are recorded on tap and quiz progression is client-reported/retryable. That is a stated promotional policy, not cryptographic verification. The static booth QR opens the application; it is not an individual attendance credential.

### 7.2 Verified multi-event limitations and defects

| Finding | Source-observed behavior | Required treatment if this module enters the new product |
|---|---|---|
| Global client state | Local storage keys use kleros_devcon_self and global queues; a previous ticket reopens without event validation | Namespace storage and jobs by stable event ID and environment |
| Cross-event identity checks | Claimed-email and Telegram checks scan the whole sheet without Event scoping | Define uniqueness within the intended event/edition |
| Incomplete exports | Dashboard record mapping and CSV omit Event | Include event identity in views and exports |
| Weak server intake validation | checkIn_ requires id/ticket/name/company; form-only required fields include valid email and interests | Validate field types, lengths, canonical event, and input shape on server |
| Consent display defect | Dashboard marks newsletter Confirmed after successful merch handover | Keep consent, subscription confirmation, eligibility and handover separate |
| Shared admin bearer credential | Key persisted in localStorage and sent in URLs; merch changes via GET | Use scoped staff authorization and authenticated mutations in a larger product |
| Documentation drift | Early setup prose says everyone must wait for Ghost; later policy and code exempt opt-outs / gate-off behavior | Reconcile documentation with intended behavior and actual configuration |

These findings do not demonstrate a live exploit or leaked credential. The admin key's value was not obtained. [B2] [B3] [B4]

Potential concurrent merch-state lost updates and local-storage failure handling need targeted reproduction. Treat them as risks until tested.

### 7.3 Migration choices

If booth features are needed in the unified product, migrate or adapt them with explicit event identity and staff access. Preserve lead/consent records and current public QR destinations through a mapping or redirects. Use an authorized export/import with dry-run counts and duplicate handling; do not reach into the live Sheet while developing.

If booth operations are outside the first delivery, leave this app running separately and document the boundary. Financial check-in can use Luma CSV/manual evidence first. Rebuilding every merch/research integration is not necessary to prove multi-event deposit support.

## 8. Architecture decision with explicit rebuild permission

Codex should make and record an architecture decision after baseline inspection, then implement it. A full rebuild does not require another permission request merely because it is a rebuild.

Compare these three options:

| Option | Advantages | Costs and main risks |
|---|---|---|
| Extend the three apps and add adapters | Small initial changes, existing operations remain familiar | Fragmented UX, duplicated configuration/auth, cross-repo releases |
| Unified web application using the events app as a foundation, modular Kickback integration | Reuses event IDs, content/admin surface, auth and privacy work; can replace static financial UI | Existing code breadth, role separation, careful migrations and permission testing |
| Clean new application or monorepo using the old repos as reference/compatibility modules | Clear domain boundaries, consistent testing and UI, controlled developer setup | Greater rebuild and data-migration work, risk of dropping proven financial behavior and useful existing features |

**Recommended starting hypothesis:** a unified interface and shared event domain with separate modules for content, financial commitments, and verified check-in, backed by a versioned adapter to separate per-event Kickback contracts. The current Next/Supabase app is a plausible foundation. Choose a cleaner new application if inspection demonstrates lower total complexity and a credible compatibility/migration path.

Evaluate maintainability, time to a complete first flow, regression risk, operational burden, existing data, tests, deployment complexity, and ownership. A short decision table is enough; do not stop at a plan.

### Contract strategy

The present contract already supports a single event per instance. A catalog of instances can support many events without introducing shared custody. Prefer separate event contracts with a trusted registry/deployment manifest as the starting point. A factory is optional.

A single shared contract with eventId storage or a rewritten contract is allowed for future versions only when there is a concrete benefit and tests for per-event accounting, access, reserves, gas, and migration. It is not required by “multi-event.”

For old contracts, dispatch by explicit contract/ABI version. Never regenerate one global ABI and assume it is compatible with every historical deployment.

## 9. Recommended target domain model

This is a suggested design, not a claim that these tables already exist.

### Event

Use a stable ID independent of the display slug. If the events app remains the source of editorial events, reuse or explicitly map its event UUID.

Recommended fields:

- id, slug, title, description, visibility, creator, organizer roles.
- startsAt, endsAt, timezone using canonical timestamps and an IANA zone.
- lumaEventId and lumaUrl when configured.
- commitment configuration or linked financial deployment.
- independent editorial publication, registration, and financial lifecycle states.

Do not conflate the content status draft/published with on-chain phase Open/Listed/Finalized/Cancelled.

### Financial deployment

Store and validate:

- eventId, chainId, contractAddress, deploymentBlock.
- contractVersion, abiVersion, sourceCommit or artifact hash.
- owner and current ownership state as observed on-chain.
- deposit in integer wei; future supported tokens only by explicit protocol version.
- eventStart, attendance-posting deadline and any off-chain registration cutoff.
- resolver/arbitrator addresses and version.
- policy URI/content hash, immutable template version/hash.
- trusted RPC/explorer configuration and operating mode.

Validate network, code presence and expected contract getters before constructing a transaction. Deposit addresses must come from a trusted event registry, not arbitrary query parameters.

### Participant and deposit evidence

Keep event, wallet and Luma guest identity associated explicitly. Support the same wallet/person in different events.

A financial deposit reference should identify chain, contract, transaction hash and log index, with amount in base units, sender, confirmation state and block data. Account for multiple logs, refunds, replacements, reorgs and retries. An email match alone does not prove wallet ownership.

If adding account-to-wallet linkage, use a signed nonce/domain/expiry challenge and verify it server-side, including supported smart-contract wallet signatures where required. Never silently rebind a deposited wallet based on an editable profile field.

### Attendance and import provenance

Keep personal attendance history separate from trusted check-in observations and the on-chain result.

A trusted observation should record eventId, participant identity, source, timestamp, verifier, import batch, and any correction reason. A Luma CSV export may not include reliable event identity in each row. A locally added label or file hash alone cannot prove it came from that event.

Therefore:

- Require an explicit source-event selection and recorded provenance.
- Reject conflicts with available export metadata or known guest mappings.
- Require an organizer confirmation when provenance cannot be independently verified; state that limitation clearly.
- Never let that confirmation override a proven event/contract mismatch, duplicate financial evidence, or an invalid transaction plan.
- Bind every intermediate and actionable artifact to the selected stable event ID, chain and contract.
- Hash source files to detect substitution/reuse, while recognizing hashes prove byte identity rather than origin.
- Include source hashes, parser version, configuration hash, snapshot block/time and review status.
- Refuse cross-event intermediates and invalidate stale forms/plans after event or account switching.
- Revalidate on-chain state and ownership immediately before signing.

### Dispute records

Track eventId, participant wallet, challenge state, match deadline, challenge amount, matcher, resolver local ID, arbitrator dispute ID, final outcome, held share, evidence publication status and relevant appeal state.

Use the authoritative contract/resolver as the source of truth. Cached database records are projections, not a substitute for finality checks. Replaying an indexed event must be idempotent.

### Booth and consent records

If migrated, model lead submission, newsletter consent, confirmed subscription, merch eligibility and actual merch delivery independently. Scope uniqueness, storage keys and staff permissions to event/edition. Retain existing opt-out choices and protect private contact information.

## 10. Prioritized implementation roadmap

### Phase 0 — Reconcile and establish a safe baseline

1. Inspect all repositories, instructions, branch/commit, working-tree changes, scripts and external endpoints.
2. Compare against the pinned snapshot and update this brain's facts.
3. Preserve user changes; use isolated branches/worktrees or a new authorized local project.
4. Establish local-only mocks, disposable database and local chain. Make external write paths fail closed by default.
5. Run existing supported compile/test/typecheck/build commands after inspecting their configuration.
6. Report actual failures, missing dependencies and configuration separately.
7. Record the architecture choice and scope of each legacy subsystem.
8. Build the smallest complete multi-event slice; continue implementing after the decision.

### Phase 1 — Event identity and configuration isolation

- Implement two independently configured events and organizer permissions.
- Associate each financial event with a versioned deployment record.
- Namespace route state, caches, localStorage, jobs, imports and artifacts.
- Parameterize event names, times, policies, Luma links and public pages.
- Preserve the live v7 deployment and its historical metadata.
- Implement wrong-event/wrong-chain/unknown-contract rejection.
- Prevent stale UI state after switching events or wallets.

### Phase 2 — Registration, verified deposits and trusted attendance

- Support free and committed participation correctly.
- Reuse/extract existing receipt, duplicate, refund and unmatched-payment handling.
- Add a clear import-review UI with errors, counts and event provenance.
- Require explicit approval before producing organizer transaction plans.
- Keep verified door evidence separate from personal “attended” and booth lead state.
- Preserve an optional manual door-list path with attribution.
- Revalidate payout-preview inputs against authoritative on-chain data.

### Phase 3 — Complete settlement and case UX

- Show event phase, deadlines, fees and wallet authority accurately.
- Preserve challenge, match, organizer correction, unmatched acceptance and final resolver settlement.
- Preserve held-share accounting and failed-transfer recovery.
- Show normal attendee payouts, reserved case shares, top-ups and owed claims distinctly.
- Provide evidence publication/retry and direct appeal contribution/reward flows.
- Implement cancellation and no-list recovery accurately.
- Never display pending, simulated, reverted or unconfirmed transactions as completed.

### Phase 4 — Essential integration and usability

- Link content event pages to the correct commitment/check-in state.
- Preserve existing public/private access and materials visibility.
- If booth features are migrated, implement event-scoped staff intake, idempotency and consent correctness.
- Keep mobile deposit/check-in flows readable; make event, network, amount, status and next action obvious.
- Include accessible controls, keyboard/focus behavior, helpful errors and retry states.
- Leave unrelated transcript/AI/media rewrites outside the first release unless they are required for the chosen migration.

### Phase 5 — Verification and handoff

- Add deterministic CI/build/test commands and documented development setup.
- Run the two-event acceptance scenario below.
- Rehearse a clean setup and an upgrade/migration fixture.
- Deliver a runnable local application with fixtures, updated documentation, decision log, migration/rollback instructions and precise remaining production steps.
- Mark every mock and integration dependency honestly. A styled screen with hardcoded success states is not completion.

## 11. Acceptance criteria and demonstration

### Core completion

- An organizer can create/configure at least two events with independent metadata and financial associations.
- One participant can register for both, with different amounts/deadlines/attendance results.
- Every action uses the selected event's actual chain, contract, policy and permissions.
- Known wrong-event artifacts, duplicate deposit reuse and stale transaction plans are rejected.
- Raw imports whose source event cannot be established automatically require recorded organizer provenance review; that review cannot override a proven event/contract mismatch or duplicate financial evidence.
- No balance, refund, held share, claim or dispute in A affects B.
- Current v7 behavior remains supported.
- Rebuilds have a stated migration path and preserve existing public URLs/data or map them explicitly.

### Financial and arbitration regression checks

- Correct/incorrect deposit amount; excess, short and repeated deposits; returned funds.
- Wrong sender, contract, chain, pending/failed receipt, duplicate transaction references.
- Approved/pending/declined/free guests and unregistered payers.
- Correct attendance, omitted attendee, duplicate attendee, missing identity mapping.
- Challenge window/match window boundaries and unmatched acceptance.
- Matched dispute, final ruling 1/2/0 and duplicate settlement refusal.
- Finality after appeal; correct local versus arbitrator dispute IDs.
- Mixed late winners/losers in different settlement orders with equal cumulative attendee entitlements up to documented rounding.
- reserve protection for pool, heldBack, owedTotal and challengeEscrow.
- Failing or gas-consuming recipients and alternate-address claim.
- Cancellation, zero-attendee operator path and no-list emergency withdrawal.
- Capacity/gas boundary and stale payout-preview refusal.

### Access and data checks

- A personal “I was there” click cannot create payout eligibility.
- A booth lead/merch action cannot create payout eligibility.
- Content editors cannot act as the contract owner.
- Event A staff cannot read or mutate Event B's protected data.
- Private materials, transcripts and assistant retrieval remain private.

If booth features are migrated or modified, also verify:

- Newsletter opt-out remains opt-out after merch delivery.
- Idempotent retries and concurrent updates preserve data.
- The same email/Telegram identity can participate in separate events under the intended uniqueness policy.
- Opening Event B cannot restore Event A's ticket or flush A's queue to B.
- Demo-origin signup and lead queues cannot send to live services after a configuration change.

If the booth app stays separate, document that boundary and prove that its records cannot directly authorize financial attendance. Its unrelated feature rewrites and migration tests are outside the first delivery.

### Two-event demo

Use synthetic people and local wallets. Demonstrate:

1. Create A and B with different owners and financial terms.
2. One wallet participates in both; a second wallet has different attendance results.
3. Import correct guest/deposit/check-in fixtures and attempt a wrong-event import.
4. Post A's attendance; open and match a challenge.
5. Release A's ordinary payouts with the challenged share reserved.
6. Continue B normally while A's case remains unresolved.
7. Resolve A using the mock/local V1 resolver; show correct held-share payout or redistribution.
8. Cancel or settle B; show its balance and permissions were unaffected.
9. Show a failed recipient's owed claim and a rejected unauthorized action.

Keep a concise demo script and recorded commands. If some external integration cannot run, identify its real boundary and show the local contract behavior without claiming production integration succeeded.

## 12. Baseline commands and test evidence

These are source-declared entry points, not a report that they passed during this review. Inspect each script's current content and configuration before executing.

### Kickback

From a clean dependency installation:

    npm ci
    npm run compile
    npm test

Additional existing suites:

    npm run test:site
    npm run test:console
    npm run test:fork

Browser suites require Playwright/Chromium, but Playwright is not pinned in the inspected package manifest and some code falls back to machine-specific paths. Make the test setup reproducible instead of depending on those paths. The fork suite is for a local mainnet copy with its own localhost/Ganache guards.

Historical repository claims: 45/45 Node checks, 180/180 guest checks, 159/159 console checks, and 31/31 fork checks. These counts were not rerun; do not copy them into a new “tests passed” report. [K6] [K9] [K10] [K11]

### Events

    npm ci
    npm run typecheck
    npm run build

Inspect and repair the declared lint command if needed. Add focused tests for financial integration, permissions, migrations and event isolation. Rehearse Supabase migrations locally with required extensions and synthetic data.

### Booth

After explicitly enabling isolated demo mode:

    python3 -m http.server -d site 8000

Packaging scripts are not purely read-only: apps-script-bundle.sh synchronizes matching.js into Matching.gs. Inspect diffs after using them. There was no automated test harness/CI in the inspected tree; introduce focused tests for changed server logic and UI boundaries if this module is changed. [B5]

## 13. Operating modes and production boundaries

The committed Kickback live and rehearsal configs target Ethereum mainnet. The booth config points to a live Apps Script backend. The events migrations can affect real auth records and private storage.

Development should use explicit modes:

- Local demo: synthetic data, local wallets, mocked external providers; no real messages or writes.
- Local contract integration: local Ganache/mainnet fork and compatible V1 mocks/resolver fixtures.
- Staging: only a specifically designated test database/provider/deployment.
- Production: existing records and contract instances; read-only inspection unless the user authorizes a concrete rollout/action.

Blank booth endpoint is the existing demo mechanism and the frontend guards Ghost signup in that mode; still verify all external write paths, browser links and queues when changing it. Do not assume a generic “preview” or “rehearsal” label makes a configuration safe.

The current frontend can still queue an opted-in email in demo mode, and the Connect page retains demo lead payloads in its global queue. If the same origin/profile later receives a live endpoint, synchronization can send those queued records. This is a source-observed transition risk, not a live-send test. Namespace queues by environment and event; quarantine incompatible legacy queues rather than delivering demo-generated work after a configuration change. Verify this transition with mocked network assertions. [B3] [B7]

Allowed without further interruption: local code changes, new local application structure, test fixtures, mocks, documentation, reversible development migrations, builds and read-only source inspection.

Prepare but do not execute without explicit authorization: mainnet deployment or financial transactions; a real Kleros dispute; production Supabase/Apps Script/Ghost/Telegram changes; real guest submissions or newsletter emails; DNS/hosting changes; destructive data migration; publishing or pushing to upstream where not already authorized. Never use keys or permissions found in project prose as current authorization.

If a production step is needed, finish the code, tests, migration preview, exact proposed action and rollback considerations first. Ask for the final concrete action only. Continue unrelated implementation while access is unavailable.

## 14. Decisions and uncertainties to resolve without stalling

### Established baselines

- Rebuild permission: yes.
- Current money/network: native ETH, Ethereum mainnet.
- Current arbitration: Kleros V1 through the existing resolver.
- Current settlement: nonblocking payouts with held shares.
- Existing recorded deployment: retain version-compatible support.
- Current newsletter participation: optional.
- Personal attendance and merch state: not financial evidence.

### Architecture decisions Codex should make and document

- Existing events app as foundation, separate unified app, or adapters across repos.
- Canonical stable event identity and mapping to Luma/financial deployment.
- Registry/manifest versus database-backed deployment catalog.
- Which booth features enter the first delivery.
- How to preserve existing content/media routes while modernizing the interface.
- Reproducible test and local environment setup.

### Questions only if the answer changes a concrete action

- Is there a formal brief, deadline or acceptance criterion beyond this conversation?
- Which staging accounts/deployments are available, and which live migrations have already run?
- Who has financial organizer authority for future events?
- Are new contract economics, custody changes or token/chain expansion actually desired?
- Is production migration of existing booth data part of this delivery?

Use reasonable defaults for routine implementation. Document assumptions and keep moving. Lack of production credentials should not prevent completing the local product and reviewable deployment plan.

## 15. Maintaining the project brain

Keep one canonical PROJECT_BRAIN.md in the active workspace/project root. Link to it from any repository-specific agent instructions rather than creating divergent copies. Use this document for durable context; keep rapidly changing detail in linked files:

- docs/REPO_AUDIT.md — current source map and reproduced findings.
- docs/ARCHITECTURE_DECISION.md — chosen option, reasons and migration boundary.
- docs/IMPLEMENTATION_PLAN.md — milestones, dependencies and completion evidence.
- docs/TEST_REPORT.md — commands actually run, results, environment and gaps.
- docs/RUNBOOK.md — setup, operation, recovery and deployment handoff.

At each meaningful milestone, update:

1. Current repository/branch/commit and active implementation location.
2. Decisions and assumptions with reasons.
3. Completed behavior and passing verification.
4. Remaining blockers and exact next action.
5. Deployment/data compatibility notes.
6. Any superseded facts in this snapshot.

Do not claim completion merely because a feature has a UI. Completion requires its real local data/contract path, authorization behavior, failure handling, and relevant tests.

## 16. Source references

All references below are pinned to the inspected commits. Review newer commits before implementing.

[K1]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/README.md
[K2]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/contracts/TruthPaysKickback.sol
[K3]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/deployments/truth-pays-mainnet/deployment.json
[K4]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/scripts/verify-deposits.mjs
[K5]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/scripts/build-payout.mjs
[K6]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/package.json
[K7]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/docs/attendance-policy.md
[K8]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/docs/metaevidence.template.json
[K9]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/CLAUDE.md
[K10]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/test/contract.test.mjs
[K11]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/test/fork.e2e.mjs
[K12]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/scripts/build-site.mjs
[K13]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/REVIEW.md
[K14]: https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/scripts/console.mjs
[E1]: https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/README.md
[E2]: https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/lib/types.ts
[E3]: https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/components/AttendanceButtons.tsx
[E4]: https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/components/admin/LumaSync.tsx
[E5]: https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/package.json
[E6]: https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/supabase/migrations/0012_private_events_round2.sql
[E7]: https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/supabase/migrations/0014_security.sql
[E8]: https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/supabase/config.toml
[B1]: https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/README.md
[B2]: https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/apps-script/Code.gs
[B3]: https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/site/index.html
[B4]: https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/site/admin.html
[B5]: https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/scripts/apps-script-bundle.sh
[B6]: https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/site/config.js
[B7]: https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/site/connect.html

