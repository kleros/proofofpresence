# Luma deposit portal launch

Management record: 29 October 2026, 14:41 Asia/Bangkok.
Integration/deployment owner: **Unify Kleros event deposits**.
This record defines the narrowed launch scope and preserves its verification/release progression.

## Current verified state — 29 October 2026

The four approved mainnet setup deployments are complete, one human wallet submission each:

| Setup | Ethereum address | Transaction |
| --- | --- | --- |
| Owner timelock | `0xd895AD679c8bDd4B6782EbC5d5AfA2958cC1aFd7` | `0xfdf55b2e83c5b93eadc492a8e8b2fc4ef26a928b75da9e7f7c76d141d1b065c0` |
| Event implementation | `0xE659A187f0b7B210CBa7F58bF4017Edf56800F92` | `0xb81d9691bfb2427dc869e736f4d46715be4570f66b5481ce6eb6be10c32c7851` |
| Factory implementation | `0xb99299166d31B008Bc4ED5a35c5b11e16D6786AD` | `0xe77c743b697a5bafe5b8d58cfdd63ade0d4c14a020d74c3bef0040f6d8af52f7` |
| Initialized factory proxy | `0xEe049D03a007e150ec8ec46B066823043BAcf14E` | `0x0b13cabff8fda7fdaccfa577833c19ba2aca75ff41e49133e0edb6a86d1c17f2` |

Actual gas paid totals **0.000466986018937392 ETH**, below the approved **0.0010174541274 ETH**.
Core's same journal verified transaction/calldata/fee/runtime bindings and final proxy slots,
implementation, upgrade authority, owner, history and permanent 172800-second floor at block26297509.
No additional infrastructure request is needed. The late NONCE_CHANGED check correctly detected
the already-submitted fourth transaction; it was reconciled without replay or a new plan.
The local deployment page is now review-only with the completed once-journal preserved.

The human separately approved one exact policy publication. The public readback is verified:
8246bytes, SHA256 `24e3608d8ed5daf919671193a71c6e91ebac90095a2780a8946a20cda41f8308`,
`https://cdn.kleros.link/ipfs/QmYyofYYD211etbQAabmdoqLeoM5w54STNZW5yfQECYwG1`.
Management independently compared the saved downloaded bytes with the approved source: identical.
No paid gateway, other-file upload or retry occurred. Original drafts remain immutable.

Final actual local browser acceptance is saved at `418affa`: 14 groups, 12 unique financial UI
operations and case exports, with exact source archives and no public financial broadcasts/uploads.
The subsequent narrow original-artifact/own-intent disk guard passed21/21 actual store tests.
App checkpoint `fe476ee` and final mainnet configuration `e887f05` retain those accepted changes.
The exact mainnet manifest Docker allowlist fix is `2f59766`; both root and selected backend context
now include `!registry/ethereum-v9-luma-mainnet.json`. The initial unactivated build attempt is
preserved; the corrected backend image builds successfully. Selected frontend assets and protocol
inputs passed the bounded package audit. Cloud runtime health and the public portal launch remain
**blocked on an archive-capable Ethereum RPC connection**.

New production target: `https://kleros-luma-ethereum.netlify.app`, with a dedicated new Railway
project/service/volume. The human approved storing the new app-only gateway secret in these two
services after automatic approval review rejected its first unexecuted storage command. The retry
was allowed, both configurations succeeded, and no wallet key or secret value was disclosed.
This secret-storage permission is resolved. Core owns the sole hosting/release writer.

Startup fails closed during historical verification. PublicNode returns HTTP403 for the deployment
block's `eth_getCode` and requires an archive token. dRPC accepts a single-block log read but rejects
the valid inclusive475-block range26297406–26297880 with HTTP400/code35 and an incorrect
“over10000blocks” message; removing topics does not fix it. The verifier already pages history in
5000-block ranges. Ankr requires API authentication. These are observed provider limitations, not
evidence that deployment or canonical-history checks failed. Do not weaken or skip those checks.
Public diagnostic proofs are `artifacts/mainnet-release/mainnet-{drpc-log-ranges,drpc-log-diagnostic,
ankr-full-diagnostic}.json` and `public-rpc-historical-diagnostic.json`.

Core has one pending human request in **Unify Kleros event deposits**: set `MAINNET_RPC_URL` directly
in the NEW Railway service's Variables to an authenticated Ethereum mainnet RPC supporting historical
code and logs, then reply “RPC configured.” No credential or wallet key should be pasted into chat.
The service is `luma-mainnet-backend`, project
`https://railway.com/project/fc82ba7d-dbd8-46a1-90b0-46c150405823`. Normal startup is restored to
`node src/container.mjs`; the temporary diagnostic observer is removed from current configuration.
Frontend publication stays held until strict backend trust/health passes, followed by independent
public/browser verification. No further infrastructure wallet signatures are required.

Latest human override in the UI chat retired the old v8 jobs; Core independently verified both
`finish-kleros-testnet-kickbacks` and `finish-kleros-ui-testnet-flow-c` are PAUSED. A/B/C are
**retired incomplete**, not settled. This supersedes older keep-active prose below. Do not resume,
execute or clean up their financial stages without a new human request. Preserve funds, contracts,
plans, proofs, private journals and the frozen operator. D remains independently complete.

Latest steering: the human explicitly requested completion of app verification and a guided
four-transaction mainnet signing session. They selected **Brave**. This management chat owns the
human walkthrough and concrete plan/budget questions; core remains sole integration/RPC/journal
operator. Core's existing wallet-deployment worker owns the new local review service/page/tests;
management must not create a second sender. Human wallet approvals remain manual.

## Outcome and decisions

The human requested Ethereum mainnet launch preparation now, using their own wallet, and authorized
this management chat to coordinate the three existing chats directly. The finite product scope is:

- Participants open the event's deposit link, connect a supported wallet, review and deposit ETH,
  see canonical confirmation, then choose **Return to Luma**.
- Organizers connect a wallet, supply their Luma event URL, configure and review the kickback terms,
  create the event through the verified factory, and receive a participant deposit link. A compact
  organizer view supports admission, attendance and payouts needed to operate the kickback.

Luma remains the registration/event platform. A deposit does not establish Luma registration,
approval, attendance or a guaranteed payout. The portal must explain that distinction briefly.
Do not require a second portal name/email signup to pay. A wallet-only payer record must not be
presented as a verified Luma guest, and organizer approval/contract registration remain separate.

The human selected one deployment wallet with transferable upgrade ownership and the existing
permanent 172800-second minimum timelock. Upgrade ownership and event organizer ownership are
different roles. Supplied public deployer/initial owner:
`0x2bb03593892724d225071068E59ab1E48aF05b55`. Its checksum was independently checked locally;
account type, nonce, funds and fee coverage require the core owner's fresh canonical preflight.
Do not ask for or import this wallet's private key or seed phrase.

Decision: deliver actual organizer setup and wallet-first deposits. Reason: both are explicit user
flows and currently require backend changes. Tradeoff: this is more than hiding navigation; an
assisted first-event setup alone must not be reported as open organizer self-service.

## Scope to hide or defer

The launch shell has two entries: **Deposit for your event** and **Set up kickback**. A participant
deep link opens the selected event directly. Hide general event discovery, decorative event cards,
content/recordings/materials, booth/marketing flows, personal-history dashboards, duplicate free signup,
and general event-platform editing. Preserve historical code and compatibility outside this shell.
Do not expose private event metadata through a replacement directory or event-link picker.

Keep concise terms before signing and contextual access to funds recovery, unused-credit withdrawal,
owed-credit claims, cancellation/no-list recovery, attendance challenges and cases. Preserve pending
transaction hashes and recovery even if deployment verification later becomes unavailable. The
48-hour delay is review notice; it does not guarantee withdrawal before an authorized upgrade.

The return destination is the selected event's server-validated HTTPS Luma association. Do not use an
arbitrary URL query parameter or append wallet/email/receipt data to the external URL. Do not claim
Luma API integration, automatic Luma registration or automatic Luma approval without implementation.
Use an explicit return action after confirmation; a wallet request or unconfirmed submission is not
payment success.

## Evidence at assignment

Observed locally against HEAD `417b2c075f5129ecf0cf61dc6f1ca3d9f87857a9` plus active uncommitted work:

- Production advertises `createEvents:false` and rejects `POST /api/events` in `src/server.mjs`.
  `src/workbench.mjs:createEvent` is local-demo-only. Production runtime loads reviewed manifest events.
- `src/workbench.mjs` deposit drafting calls `participantFor`; `public/app.js` asks for name/email.
  Removing the form without changing the API would break deposits.
- `public/app.js` has selected-event deep links and a scoped wallet submission/recovery path, but no
  primary confirmed-deposit return-to-Luma state. `src/utils.mjs:associations` validates Luma URLs.
- `contracts/v9/KlerosUpgradeTimelockV9.sol` and release/runtime verification code are being changed
  from historical multisig governance to the requested transferable single owner. The older canonical
  checkpoint, release docs and historical proof counts do not verify the changed candidate.
- No concrete `registry/ethereum-v9-*.json` existed at this audit. The unsigned release preparer encodes
  four infrastructure CREATE requests; it does not create a participant event or sign/broadcast.

Reported by the existing chats: the previous `417b2c0` candidate passed the recorded broad,
contract/fork, UI and Linux checks. Those claims remain historical until the changed source is frozen
and appropriately reverified. Current launch implementation, public deployment and actual mainnet
receipts are **unverified**. This management pass performed no financial or hosting operation.

## Assignments and ownership

All three assignments were **Sent** through the chat tool on 29 October 2026 after direct human
authorization. A sent assignment is not a claim of acceptance or completion. Workers keep product
file ownership; this chat owns this record and the short canonical-memory link.

| Task | Owner and workspace | Bounded responsibility | Dependency / return evidence |
| --- | --- | --- | --- |
| LM-CORE | **Unify Kleros event deposits**, root checkout, `codex/core-application` | Existing server/workbench/runtime, wallet-first payer ledger and organizer operations, verified factory creation/onboarding, durable state, final integration, public configuration, sole deployment execution | Publish API/DTO contract to UI first. Return current source revision, meaningful local execution and browser proof, public unsigned deployment bundle, first-event/policy/manifest and hosting plan, fee estimate and unresolved inputs. |
| LM-UI | **Implement Option B UI redesign**, isolated `kleros-ui-ux-speed-audit` worktree | All public UI, compact launch shell, participant states/return action, organizer wizard, conditional recovery, keyboard/mobile checks and `ui-registry.md` patterns | Develop fixtures while core publishes APIs. Return isolated commit, actual changed files, screenshots and browser results; distinguish projection fixtures from actual transaction execution. Core integrates the exact delta. |
| LM-CONTRACT | **Review Kleros smart contract**, root checkout | Current owner-transfer/timelock changes, contract security/storage/ABI/runtime pins, release preparation and current-source local Kleros fork, associated release/security evidence | Send exact existing factory creation ABI, immutable constraints, event-owner semantics and creation/proxy verification inputs to core/UI. Return current source-bound proofs/commit and commands actually run. Avoid new economics or optional testnet scope. |

Core and contract chats already share some runtime verification work. Keep their existing explicit
file ownership and coordinate any transfer before editing. Management creates no second broadcaster,
new production site, testnet operator or duplicate deployment journal. Optional new E/testnet work
and unrelated visual polish are deferred under the mainnet priority.

## Minimum data boundary for core implementation

Use an immutable reviewed factory/governance trust root and a separately persisted, append-only
registry of server-derived child birth proofs. The existing state store binds an exact manifest and
event set; adding a child only to an in-memory map will fail restart or weaken provenance. Verify
each child's birth before hydrating its private state. A zero-event factory needs verified setup
readiness distinct from event transaction readiness; remove all implicit `events[0]` assumptions.

Creation drafts need their own scope before a child exists: server/environment, authenticated wallet,
chain, factory, event key and configuration hash. Persist reviewed intent before signing. Verify exact
canonical sender/target/value/calldata, factory emitter, event key/configuration, derived ID, birth
implementation, factory membership, proxy slots and immutable terms. Use the existing verifier;
never trust client deployment hashes or a later factory default as evidence of the birth implementation.
The factory creator (`tx.from`) is the event organizer; the project deployer is not every event owner.

Reuse event-local wallet records with optional contact fields and a nonce-authenticated identity
source. Cover deposit drafting, confirmation/linking, reconciliation, approval and registration, not
only the initial `participantFor` check. No fabricated name/email or automatic admission. Preserve
canonical credit/owed reads for wallets without guest records. A Luma URL is a configured association,
not proof of Luma host ownership. Two organizers may configure the same URL without sharing authority.

## Acceptance criteria

1. A cold participant link opens the correct event deposit screen on mobile and desktop. No account
   creation or public event browsing intervenes. Event/chain/contract/policy are clear before signing.
2. A supported wallet can pay without name/email signup. The receipt is bound to the actual sender,
   event, chain, destination, calldata and value. Neither a pasted wallet nor receipt grants authority.
3. Wrong chain, unsupported account, insufficient ETH, rejected request, pending, reverted and
   confirmed states differ. Only a verified canonical receipt produces **Deposit confirmed**.
4. One explicit deposit produces one wallet request/broadcast. Refresh, reentry and uncertain-response
   recovery retain the submitted hash and do not retry a financial transaction automatically.
5. Confirmed state offers **Return to Luma** for the same event's validated configured destination and
   explains that Luma registration/approval is separate. External URLs carry no private portal data.
6. Switching event, wallet, chain, server instance or environment invalidates unsigned drafts and
   clears private data. Durable submitted references remain scoped and recoverable for their wallet.
7. An authenticated organizer configures a Luma kickback, reviews immutable terms/ownership, signs a
   real factory call, obtains a canonically verified child and durable event record, and can share its
   deposit link. Reject stale or unrelated receipts, unauthorized association changes and duplicates.
8. Organizers can review/approve wallet-only deposits without inventing guest contacts; on-chain
   registration remains explicit. They can post trusted attendance and release payouts. Ordinary
   payout, unresolved held shares, ruling0, settlement, direct delivery and owed credits stay distinct.
9. Participants retain relevant refund/claim/challenge access. Pending or failed verification cannot
   erase a known submitted hash. Hidden event-platform features are absent in the production shell.
10. Current-source tests execute the actual local production factory/proxies through organizer setup,
    wallet-first deposit and organizer operations. Browser tests cover the narrow journey, keyboard,
    mobile, rejection/pending/reload and isolation. Projection-only UI tests are identified honestly.
11. One frozen integrated revision passes root build/typecheck and risk-appropriate compatibility,
    application, contract/security and current-source real-Kleros local-fork checks. Record actual
    commands/results in `docs/TEST_REPORT.md`; preserve prior immutable proof records.
12. Start from a verified factory with zero events, create exactly once, adopt the canonical child,
    restart, and recover the same event/submissions. Exercise two organizers/events (including the
    same Luma URL), forged or reorged birth receipts, changed factory default, and a lost response or
    expired draft after successful creation. No duplicate creation signature or weakened trust root.

## Release sequence and unresolved inputs

Core owns this sequence; the other chats must not independently sign or publish it. The separately
reviewable, tested four-contract infrastructure deployment can proceed in parallel with portal work
after the human's concrete call/fee review and fresh preflight. Keep first-event/public participant
activity gated on integrated app/policy/configuration acceptance; do not serialize empty-factory
deployment behind unrelated UI work or treat it as completion of the portal launch.

1. Agree bounded backend/UI interfaces and finish the three assigned changes. Review exact deltas,
   freeze a current integrated revision, and complete acceptance above before opening participant
   activity. Keep staging/synthetic data local. Infrastructure preparation can run in parallel.
2. Prepare the concrete chain1 four-CREATE plan for the supplied wallet, with current nonce,
   predicted addresses, source/ABI/runtime hashes, rehearsed gas limits, explicit fee ceilings and a
   worst-case ETH spend. Prepare wallet-native review/signing without private-key export.
3. Resolve actual fee/spend approval, production origins/durable storage, first event's Luma URL and
   immutable terms, and exact policy/evidence publication. Inspect pending questions in core before
   asking the user again; delegated judgment cannot invent these missing facts.
4. Before each wallet execution, refresh the relevant read-only canonical and nonce/fee/account
   checks. Preserve a once-only journal and reconcile known submissions instead of replaying them.
   Record the user's concrete reviewed transaction approval before any irreversible step. A tested,
   reviewed empty infrastructure deployment need not wait for completion of the compact portal.
5. Verify deployed runtime/proxy/governance/Kleros state and the first event; bind the production
   manifest. Publish the separate production app and policy under the concrete reviewed release plan.
   Check public HTTPS/frontend/backend health and configuration without changing rehearsal origins.
6. Verify the deployed journey and report exact addresses, source and URLs, receipt evidence and
   any remaining limits. A local pass or hosting success alone is not end-to-end launch completion.

The human's mainnet request supersedes the earlier mainnet hold for this launch objective. It does
not authorize choosing an unknown spend cap, signing with legacy keys, replaying old submissions,
silently changing live migrations or publishing unrelated resources. Ask only for unavailable
concrete inputs or final review that is actually needed; do all independent preparation first.

Preserve A/B/C assets, frozen financial source, immutable plans/journals and scheduled runs; preserve
D completion evidence and private signing files. Never change public chain time. Legacy v7 remains
the default compatibility version; dispatch v8/80015/v9 explicitly and preserve historical Solidity,
policies/templates/ABIs and deployment inputs.

## Management verification log

- Read canonical memory and the three chats' recent human requests and progress; inspected actual
  root/worktree code read-only through two independent audit agents.
- Independently checked the supplied address checksum and root HEAD locally.
- Audit ran `node scripts/mainnet/prepare-release.mjs` in instructions-only mode: zero network
  requests, private files read, signatures or broadcasts.
- No application tests were run by management for these documentation-only changes. Worker results
  are pending. Do not reuse old pass counts as verification of the new launch scope.

Next action: core sends the bounded API contract, contract owner returns current factory/governance
inputs, UI implements the compact journey, and management reviews their source-bound return evidence.

### Worker returns and independent review

- **LM-CONTRACT — Verified complete for the contract handoff.** Saved locally as
  `6c7803fd6c1a16541ded8f55ae38d5992f0d08c6`; management checked the commit and retained proof hash.
  This acceptance covers the contract/interface/provenance handoff, not the integrated portal launch.
  The contract owner
  reports new owner/security/handover checks and a passing fresh real-Kleros local fork. Management's
  independent read-only audit rehashed
  `artifacts/mainnet-kleros/v9-owner-fork-ethereum-runtime-final.json` and 109 source/compiler/artifact
  comparisons with zero mismatches. Proof SHA256:
  `05835760838dd1877dc74ba92d9f3001beebf189397ae27b1dee9415a25f00be`.
  It binds seven source pins, 28 compiler sources, canonical build manifest
  `10202cfd4a9657215b6ba6645fbf6dd649287da97e27e17cb485f098564d1e84` and canonical compiler input
  `559709d4b23f5d8b2396eaa72017c85dbc7ebc2a5df30625dec267c05600a073`.
  The proof reports 264 upstream reads and zero upstream signatures, broadcasts or private signing
  reads. This review verifies current-file binding; management did not rerun the compiler/fork or
  check live block canonicality. Contract release closure remains with its owner.
  Subsequent handoff: contract source is frozen; the owner reports ownership5, base/capacity3,
  handover7, security9, release/layout/rehearsal22 and fork1 passing. Management additionally checked
  the factory interface/constraints and current pin record (24 comparisons, zero mismatches).
  Release/security/production instructions now present the single-owner design. The contract commit
  includes the current TEST_REPORT supersession. The policy draft remains unpublished
  with unresolved event placeholders; do not treat its draft record as a production policy URI.
- **LM-UI — In progress.** The UI chat acknowledged the narrowed scope and reports a separate
  governance UI checkpoint `0a6fbda0e20b51dd4957aa84fc6b2a4acb24222e`. Compact launch work is next;
  this checkpoint is not acceptance of the new Luma journey. Its integration depends on core's final
  DTO. Core owns publishing; the UI chat holds hosting changes.
- **LM-CORE — In progress; assignment acknowledged.** Core reports it has sent UI the bounded
  factory bootstrap/policy/setup and wallet-first deposit contract, including organizer creation
  draft, validate, submitted, reconcile and status routes under `/api/organizer/events/drafts`.
  Backend responsibilities are divided among its existing agents; core retains final integration
  and sole execution. API implementation and real journey acceptance remain pending. Its current
  initial read-only account check reported nonce zero, no account code and zero ETH for the wallet;
  the subsequent 14:47 Bangkok quote below supersedes that balance observation.
  core will collect spend/funding and first-event/publication inputs after concrete preparation.
  Do not duplicate those user questions from this management chat.

### Concrete unsigned infrastructure proposal

The contract owner prepared the public plan
`artifacts/mainnet-release/user-2bb03593-four-create-proposed.json`, configuration
`registry/ethereum-v9-user-2bb03593-proposed.json`, and read-only fee/account snapshot
`artifacts/mainnet-release/user-wallet-fee-proposal-1793260073147.json`.
The snapshot is 29 October 2026, 14:47:53 Bangkok: nonce zero, EOA code `0x`, balance **0.00985 ETH**.
This is a dated observation, not a continuing balance or fee guarantee.

Management independently checked all four sender/chain/nonce/value/fee/gas/address bindings, CREATE
address derivations and creation calldata against the current pinned artifacts, including atomic
factory proxy initialization. All matched. The aggregate gas limit is 11100000; multiplying it by
the proposed 81421160-wei max fee gives an exact maximum gas proposal of **0.000903774876 ETH**.
All four native values are zero. This covers infrastructure only, not creation of the first event,
policy/hosting costs, later operations or participant deposits. The quoted balance covers this
proposal. Local gas measurements/buffers remain subject to the core's final review and fresh preflight.

The plan remains `unsigned-review-only`, `gasEstimatesVerified:false`,
`deploymentAuthorized:false`, with zero signatures and broadcasts. No spending approval is inferred.
Core owns the final complete review, fee refresh and wallet-native signing; management will not
duplicate its user questions or submit these requests.

Fresh unapproved fee-history proposal at 29 October 2026, 15:29:30 Bangkok:
`artifacts/mainnet-release/user-2bb03593-four-create-feehistory-1793262570717.json`.
The exact proposed cap is **0.0010174541274 ETH**, max fee 91662534 wei/gas and priority fee
9034814 wei/gas, using recent-block reward data. Core's fresh account observation reports nonce zero,
EOA code and 0.00985 ETH. The four zero-value CREATE payloads, gas ceilings and predicted addresses
match the earlier source-pinned proposal; management independently checked them and the arithmetic.
Canonical plan SHA256 is `542e3df4ee6eea7827286c3dfcb084ceadd9d12744a0815d2da11b8a0d1b4ba0`;
raw formatted-file SHA256 is `e75c20042bd3a553d29f0e0858915ed95b80f1ad0f7a8776c2ebd180dc1f0f0e`.
Earlier quotes remain preserved and unapproved. Final bridge source/approval binding and a fresh
preflight must be ready before the single concrete human approval question.

### Early implementation review

Read-only review of the new factory-onboarding/runtime work found issues in the initial draft:
inconsistent persistence fingerprinting, concurrent/nonmonotonic submission updates, loss of a
known hash on slow adoption failure, and incomplete final factory/governance resealing. All four
were sent to LM-CORE for focused corrections and regressions. These are WIP review findings, not
final acceptance. Fingerprint and final factory-slot checks were already evolving during review;
verify the final frozen implementation rather than treating old line numbers as current defects.

Follow-up independent review found all four corrected, with explicit regression coverage. The audit
ran `node --test --test-concurrency=1 test/factory-onboarding.test.mjs`: **8 passed, 0 failed**.
This includes actual local factory/child creation, forged receipt rejection, expired/new-session
recovery, failed creation, governance mutation at final signing checks, durable recovery after
provenance failure, and concurrent competing hashes. No compiler/public-chain mutation occurred.
This accepts the bounded onboarding corrections, not unfinished server/UI integration or the full
browser journey. Contract chat owns the single real-proxy browser acceptance lane at
`test/luma-launch-flow.e2e.mjs`; do not duplicate that run while sources change.

Additional current reviews (open until source-bound closure): wallet-review service must detach its
returned plan/transaction data, explicitly reconcile approved same-nonce replacement candidates,
verify final factory/governance state, and restore validated locally saved hashes after a lost server
recording response/reload. The portal setup marker must preserve uncertain requests across backend
instance changes while revoking all old unsigned signing authority. Core/UI own these corrections;
management/contract reviewers have made no competing product edits.

Management added only `test/mainnet-wallet-browser.e2e.mjs`. Its focused actual Chromium run passed
15 checks across four scenarios with ten source hashes stable, covering exact CREATE requests,
double-click protection, restored local hashes after lost server recording/reload, unknown-response
lock, foreign-context rejection, review-only denial and mobile isolation. This uses synthetic
wallet/chain responses: zero public RPC, keys, signatures or broadcasts. Proof:
`artifacts/mainnet-release/wallet-browser/2026-10-29T08-43-49.418Z-3dd09612/proof.json`, SHA256
`51440fe0215f1384da4628da40e07aefefc5b8df239bc03434d7451f9286de50`.
The initial sandboxed browser launch failed before checks; its stopped proof remains retained.
The successful run used scoped escalation. Final acceptance requires the bridge owner to freeze
the same sources and close the actual local-contract/service checks.

Policy coherence also needs resolution before opening organizer creation: the current draft contains
event-specific placeholders while factory setup expects one shared approved policy. Reusing a filled
first-event policy for unrelated organizers is invalid. Core and contract owner must choose a reviewed
shared financial policy with immutable event-specific evidence/context in the explicit V9 template,
or a true per-event approved publication flow, preserving historical templates and financial rules.
This does not block the separately reviewable empty four-CREATE infrastructure deployment. Any real
publication still requires concrete reviewed text; a synthetic fixture policy is not launch acceptance.

Contract checkpoint `d7687b9` adds an explicit V9 Luma template and a generic policy draft, with 7/7
focused tests reported passing. The fixed standard supports participation in person or online, with
immutable event URL/start/end/timezone/policy hash. Policy draft SHA256:
`24e3608d8ed5daf919671193a71c6e91ebac90095a2780a8946a20cda41f8308`; URI remains null, unpublished
and unapproved. UI checkpoint `613c79a7474ca366eb0694f7d89d392ccfb72e32` is frozen for core
integration, with 26 browser groups/14 offline/12 pure checks reported passing. Real-contract browser
acceptance remains separate with the contract owner.

A further real-Court launch gap was identified: storing case JSON locally does not publish its
deterministic `/ipfs/` URI. Management owns new isolated `src/mainnet-case-publication.mjs` and its
focused test; core owns canonical chain reads/auth/persistence/routes and UI chat owns explicit
review/export/publish/verify controls. Publication requires exact content consent and a durable intent
before one POST; public verification compares the expected CID and every retrieved byte. No automatic
upload, retry, payment or signing is permitted. Challenge/match deadlines cannot depend on service
availability. Current official Kleros CLI/source documents one multipart `file` upload and readback
through its fixed gateway; this confirms API shape, not live service availability. Tests mock transport
and no real policy/case file has been published by this management work.

### Verification approach agreed for review

Reuse actual local V9 factory/proxy execution from `test/production-workbench.test.mjs`, the real
loopback HTTPS/gateway server setup from `test/hosted-integration.e2e.mjs`, and the synthetic browser
wallet bridge pattern from `test/app.e2e.mjs`. One focused production journey should execute real
organizer creation and wallet-only deposit/approval/registration/attendance/payout, then cover lost
response plus reload without a second send. Block external traffic and intercept the Luma return
link. Exercise distinct upgrade owner, event organizer and participant identities. Existing
`production-ui.e2e.mjs` financial blocking/fake signatures and `production-http.test.mjs` stub are
valid projection/HTTP coverage, but neither proves the new transaction journey. This is a proposed
review approach, not a claim that a new harness has been implemented or run.
